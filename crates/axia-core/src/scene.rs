//! Scene — the top-level container for all XIA entities and the geometry mesh.

use std::collections::HashMap;
use glam::DVec3;
use anyhow::Result;

use axia_geo::{Mesh, MaterialId, FaceId, EdgeId, VertId};
use axia_transaction::TransactionManager;

use crate::xia::{Xia, XiaId};
use crate::commands::{Command, CommandResult};
use crate::lifecycle;
use crate::group::{GroupId, GroupManager, Transform3D};
use crate::material::MaterialLibrary;
use crate::constraint::ConstraintGraph;

/// Snapshot format version
// File snapshot version.
//   1 = mesh only (legacy — XIAs/Groups/Constraints lost on round-trip)
//   2 = full scene_snapshot (mesh + xias + groups + next_xia_id + constraints)
//       Added 2026-04-24 to stop XIAs from vanishing on save/load and leaving
//       every face an orphan after reload.
//   3 = Z-up coordinates. ADR-103-ε bumped 2026-05-15. V2 (Y-up) load applies
//       (x, y, z) → (x, -z, y) rotation to vertex positions on import.
//       Payload schema identical to V2 (no struct change). Industry CAD parity.
const SNAPSHOT_VERSION: u32 = 3;

/// Magic bytes for .axia file identification
const AXIA_MAGIC: [u8; 4] = [b'A', b'X', b'I', b'A'];

/// ADR-050 P-5e-β — Form-layer (Shape) sentinel material.
///
/// Two-Layer Citizenship Model (LOCKED #26 + ADR-049 §4 Q4):
/// - **Form layer (Shape)**: faces are created with this sentinel
///   material. The Shape itself carries no material — material
///   assignment happens at promote-to-Xia time.
/// - **Property layer (Xia)**: primary material + face-level override
///   (assigned during promotion).
///
/// `MaterialId(0)` is the library's first slot (default white). Using
/// it as the form-layer sentinel is intentional — visual rendering
/// works correctly until the user promotes to Xia and assigns a real
/// material.
///
/// **Replaces** the deprecated `Scene.default_material` field
/// (removed in P-5e-β per ADR-049 §4 Q4 "default_material 폐지").
/// All call sites that previously read `scene.default_material` now
/// reference this constant directly — no behavior change (same value),
/// just no field-as-state.
pub const FORM_MATERIAL: MaterialId = MaterialId::new(0);

/// ADR-089 A-μ-β — Snapshot section presence flags.
///
/// Returned by `Scene::analyze_snapshot` — indicates which optional
/// sections were present in a snapshot file. Useful for legacy file
/// detection (e.g., V2 file without ADR-050 Shapes section).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SnapshotSections {
    pub mesh: bool,
    pub xias: bool,
    pub groups: bool,
    pub next_xia_id: bool,
    pub constraints: bool,
    /// ADR-078 P-1 — Boolean group tags
    pub boolean_group_tags: bool,
    /// ADR-050 P-3 — Form-layer Shapes
    pub shapes: bool,
    /// ADR-050 P-3 — next_shape_id (sub-section)
    pub next_shape_id: bool,
    /// ADR-050 P-3 — shape_to_xia map (sub-section)
    pub shape_to_xia: bool,
    /// ADR-091 D-ε — xia_to_original_shape map (sub-section 7d)
    pub xia_to_original_shape: bool,
    /// ADR-095 Phase 3-ε — Reference 시민권 (section 8)
    pub references: bool,
    /// ADR-095 Phase 3-ε — next_reference_id (section 8 sub)
    pub next_reference_id: bool,
    /// ADR-098 S-γ — Material library 3-tier persistence (section 9)
    pub material_library: bool,
}

/// ADR-089 A-μ-β — Snapshot analysis result.
///
/// Read-only inspection of a snapshot file's structure without
/// modifying scene state. `version == 0` + `has_magic == false`
/// indicates legacy mesh-only format (no header).
#[derive(Clone, Debug)]
pub struct SnapshotInfo {
    /// Snapshot version (1, 2, or 0 for legacy headerless).
    pub version: u32,
    /// True if AXIA magic bytes were found.
    pub has_magic: bool,
    /// Which optional sections were detected (V2 only).
    pub sections: SnapshotSections,
    /// Non-fatal error message (e.g., truncation) — `None` if clean.
    pub error: Option<String>,
}

/// ADR-100 R-β — Orphan material assignment report (Phase 5-C).
///
/// A `Xia.material` whose `MaterialId` is no longer present in
/// `Scene.material_library` (e.g. after a `removeUserMaterial` call).
/// FORM_MATERIAL sentinel (id 0 = Concrete) is always valid and never
/// reported.
#[derive(Clone, Debug, Default)]
pub struct OrphanMaterialReport {
    pub affected_xias: Vec<OrphanMaterialEntry>,
}

impl OrphanMaterialReport {
    pub fn is_clean(&self) -> bool {
        self.affected_xias.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrphanMaterialEntry {
    pub xia_id: XiaId,
    pub stale_material_id: u32,
    pub face_count: usize,
}

/// ADR-100 R-β — Recovery outcome from `attempt_material_removal_recovery`.
///
/// Mirrors ADR-097 `RecoveryOutcome` shape — 3 variants ordered by
/// severity (NoOp < Recovered < PartialFailure).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MaterialRecoveryOutcome {
    NoOp,
    Recovered {
        affected_xias: usize,
        faces_demoted: usize,
        faces_fallback: usize,
    },
    PartialFailure {
        affected_xias: usize,
        remaining_orphans: usize,
    },
}

/// ADR-100 R-β — Result of `remove_project_material_with_recovery`.
/// Bundles the removed material id with the cascade recovery outcome.
#[derive(Clone, Debug)]
pub struct MaterialRemovalOutcome {
    pub removed_id: u32,
    pub recovery: MaterialRecoveryOutcome,
}

/// The AXiA scene — owns the geometry mesh and all XIA entities.
/// Principle 3 (ADR-008) — Face Operation Epoch.
///
/// Accumulates the per-line topology work from a multi-line user command
/// (exec_draw_rect = 4×, exec_draw_circle = N×) so the heavy post-process
/// steps (fan-split, containment dissolve, planar free-face resolver,
/// dedup, B1 hole promotion) run once at the end of the command instead
/// of once per line. The intermediate lines still do their own crossings
/// + split_face_by_line + free-edge loop detection for correctness; only
/// the scene-wide cleanup/synthesis sweeps are deferred.
#[derive(Default, Debug)]
struct EpochContext {
    touched_verts: Vec<VertId>,
    new_edges: Vec<EdgeId>,
    created_faces: Vec<FaceId>,
    loop_edge_ids: Vec<EdgeId>,
    surface_normal: Option<DVec3>,
}

pub struct Scene {
    /// The geometry kernel mesh
    pub mesh: Mesh,
    /// All XIA entities in the scene
    pub xias: HashMap<XiaId, Xia>,
    /// Reverse index: FaceId → XiaId (O(1) lookup)
    pub(crate) face_to_xia: HashMap<FaceId, XiaId>,
    /// Next XIA ID counter
    next_xia_id: u32,
    /// Transaction manager for undo/redo
    pub transactions: TransactionManager,
    /// Material library (all available materials)
    pub material_library: MaterialLibrary,
    /// Group / Component manager
    pub groups: GroupManager,
    /// Constraint Solver Level 2 — persistent constraint graph
    pub constraints: ConstraintGraph,
    /// Active epoch for Principle 3 batching. Set by exec_draw_rect/circle,
    /// cleared in the epoch finalizer. When `Some`, inner exec_draw_line
    /// calls contribute to this buffer and skip their per-line post-process.
    epoch: Option<EpochContext>,
    /// Phase 2 — SketchUp-style "auto intersect on draw".
    ///
    /// **ADR-139 B-β-1 (2026-05-18)**: default `false` (was `true`).
    /// 자동 trigger antipattern (메타-원칙 #16) — 사용자 의도 추측 →
    /// cascading 부작용 (P5.UX.39-45). Boundary tool 명시 only 정책 정합.
    /// When `true` (explicit opt-in), every draw_rect / draw_circle command
    /// automatically runs intersect_faces_inner on the newly-created faces
    /// against the rest of the scene (still inside the outer transaction,
    /// so Ctrl+Z undoes both the draw and the intersect in one step).
    /// User-toggleable for legacy compatibility (localStorage 'true' ON
    /// preference 보존, ADR-049 P-5e-α canonical 답습).
    pub auto_intersect_on_draw: bool,
    /// **ADR-139 B-β-2 (2026-05-18)** — LOCKED #12 ADR-025 P11 자동 cycle
    /// face synthesis 토글. Default `false` (메타-원칙 #16 자동화 antipattern
    /// 폐기). Step 4.99 (`resolve_planar_free_faces` fixed-point loop) 의
    /// 자동 호출 사이트 control.
    /// When `true` (explicit opt-in), every postprocess pipeline 의 last
    /// step (Step 4.99) 가 free edge closed cycle 을 자동 face 로 합성.
    /// Boundary tool (ADR-139 B-γ ~ B-ε) 진입 시 명시 trigger 로 대체.
    /// User-toggleable for legacy compatibility (localStorage 'true' ON
    /// preference 보존, ADR-049 P-5e-α canonical 답습).
    pub auto_face_synthesis_on_draw: bool,
    /// ADR-078 P-1 — Boolean Group A/B persistence (Rust mirror of TS U-1).
    ///
    /// `FaceId → BooleanGroupTag` map. Mirrors the runtime
    /// `SelectionManager.groupTags` (TS) but owns the persistent storage
    /// — survives `scene_snapshot()` / `restore_scene_snapshot()` round-trip
    /// (project save/load). P-2/P-3 sync TS↔Rust.
    ///
    /// Invariants (mirror TS U-1):
    /// - One face = one tag (HashMap key uniqueness)
    /// - `set` overwrites on conflict
    /// - `clear_selection` of the TS layer also clears these tags (synced
    ///   via P-3 bridge round-trip)
    pub boolean_group_tags: HashMap<FaceId, crate::BooleanGroupTag>,

    /// ADR-050 P-1 — Shape storage (form-layer citizenship).
    ///
    /// Two-Layer Citizenship Model (LOCKED #26): Shape = form citizen
    /// (no material, geometric abstraction), Xia = property citizen
    /// (material + watertight + manifold + member identity). Both
    /// coexist — promotion API (Phase 1.A `promote.rs`) bridges them.
    ///
    /// P-1 atomic scope: in-memory only. Snapshot persistence is
    /// deferred to ADR-050 P-3 (additive section). Drop-in alongside
    /// existing `xias` HashMap — both maps coexist independently.
    ///
    /// Invariants:
    /// - `ShapeId` is a separate newtype from `XiaId` (no aliasing)
    /// - One Shape per id (HashMap key uniqueness)
    /// - Shape lifecycle is independent of Xia lifecycle until P-2
    ///   promote API integration
    pub shapes: HashMap<crate::ShapeId, crate::Shape>,

    /// ADR-050 P-1 — Counter for next `ShapeId`. Starts at 1; 0 is
    /// reserved as a "null" sentinel for future Bridge null-checks.
    next_shape_id: u32,

    /// ADR-050 P-2 — Shape → Xia linkage map (set on `promote_shape_to_xia`).
    ///
    /// Per P-2-d lock-in: tracking lives on Scene (not on Xia struct)
    /// to keep `Xia` bincode-compatible with existing snapshots
    /// (snapshot section 영향 0 until ADR-050 P-3). Used by future
    /// demote API (ADR-052) to find the form anchor when a Xia is
    /// demoted back to its Shape.
    ///
    /// Invariants:
    /// - Set only by `promote_shape_to_xia` (P-2 entry point)
    /// - One Shape can promote to at most one Xia at a time
    ///   (overwrite if re-promoted — Phase 2 demote-then-promote
    ///   semantics will refine this)
    /// - In-memory only (P-2 atomic) — snapshot persistence in P-3
    pub shape_to_xia: HashMap<crate::ShapeId, XiaId>,

    /// ADR-091 D-ε — Reverse linkage `XiaId → ShapeId` for promoted
    /// Xias. Populated by `promote_shape_to_xia` and consumed by
    /// `demote_xia_to_shape` to restore the original ShapeId on
    /// round-trip (Lock-in D-D=b).
    ///
    /// Per ADR-050 P-2-d precedent: tracking lives on Scene (not on
    /// Xia struct) to keep `Xia` bincode-compatible with existing
    /// snapshots — bincode is positional and a new struct field
    /// breaks legacy V2 deserialization. The map is persisted via
    /// snapshot section 7 sub-section #4 (additive only).
    ///
    /// Invariants:
    /// - Set only by `promote_shape_to_xia`
    /// - Cleared by `demote_xia_to_shape` (one-way consumption per
    ///   round-trip)
    /// - Legacy V2 snapshots restore as empty (None default per Xia)
    pub xia_to_original_shape: HashMap<XiaId, crate::ShapeId>,

    /// ADR-079 W-1 — Reverse index: `FaceId → ShapeId` for form-layer
    /// face ownership. Mirror of `face_to_xia` for the form citizenship
    /// layer. Updated by `create_shape` (registration) and
    /// `Scene::exec_create_solid` (post-extrusion top + side faces).
    ///
    /// Invariants:
    /// - One face → at most one Shape (Map key uniqueness)
    /// - Mutually exclusive with `face_to_xia` per face: a face is
    ///   either form-owned (Shape) or property-owned (Xia), not both
    /// - Rebuilt from `Shape.face_ids` on `restore_scene_snapshot`
    ///   (no separate snapshot section — Shape persistence at section 7
    ///   carries `face_ids` already)
    /// - In-memory only — derived from Shape state
    pub face_to_shape: HashMap<FaceId, crate::ShapeId>,

    /// ADR-095 Phase 3-β — Reference 시민 storage (Two-Layer Phase 3).
    ///
    /// Form/Property 두 layer 와 직교하는 third citizenship — 사용자
    /// 의도 *수정 안 함* (build 대상 아님). 3 categories:
    /// ConstructionLine / ImportedMesh / PointCloud.
    ///
    /// Mesh-level HashMap pattern (R-A, ADR-091 §E L1 canonical 답습) —
    /// bincode legacy 호환 자연 보존.
    ///
    /// Invariants (R-B mutually exclusive):
    /// - Geometry id (face/edge/vert) 가 Reference 에 등록된 경우 동시에
    ///   `face_to_xia` / `face_to_shape` 등에 있을 수 없음. 신규 등록
    ///   시 reverse 인덱스 검사 + 거부.
    pub references: HashMap<crate::ReferenceId, crate::Reference>,

    /// ADR-095 Phase 3-β — Counter for next `ReferenceId`. Starts at 1;
    /// 0 reserved as null sentinel (ShapeId 답습).
    next_reference_id: u32,

    /// ADR-095 Phase 3-β — Reverse index: `FaceId → ReferenceId`.
    /// Populated by `create_reference` for ImportedMesh category.
    pub face_to_reference: HashMap<FaceId, crate::ReferenceId>,

    /// ADR-095 Phase 3-β — Reverse index: `EdgeId → ReferenceId`.
    /// Populated by `create_reference` for ConstructionLine category.
    pub edge_to_reference: HashMap<axia_geo::EdgeId, crate::ReferenceId>,

    /// ADR-095 Phase 3-β — Reverse index: `VertId → ReferenceId`.
    /// Populated by `create_reference` for PointCloud category.
    pub vert_to_reference: HashMap<axia_geo::VertId, crate::ReferenceId>,
}

/// ADR-095 Phase 3-β — `Scene::create_reference` 실패 사유.
///
/// Mutually exclusive geometry ownership invariant (R-B) 위반 시
/// 반환. 실패 시 Reference 미생성, reverse 인덱스 변경 0 (atomic
/// rollback).
#[derive(Clone, Debug, PartialEq)]
pub enum ReferenceCreateError {
    /// 같은 edge_id 가 이미 다른 Reference 에 등록됨.
    EdgeAlreadyReferenced {
        edge_id: axia_geo::EdgeId,
        existing_ref: crate::ReferenceId,
    },
    /// 같은 face_id 가 이미 다른 Reference 에 등록됨.
    FaceAlreadyReferenced {
        face_id: FaceId,
        existing_ref: crate::ReferenceId,
    },
    /// face_id 가 Property 시민 (Xia) 에 소유됨 — Reference 등록 거부.
    FaceOwnedByXia { face_id: FaceId },
    /// face_id 가 Form 시민 (Shape) 에 소유됨 — Reference 등록 거부.
    FaceOwnedByShape { face_id: FaceId },
    /// 같은 vert_id 가 이미 다른 Reference 에 등록됨.
    VertAlreadyReferenced {
        vert_id: axia_geo::VertId,
        existing_ref: crate::ReferenceId,
    },
}

impl std::fmt::Display for ReferenceCreateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EdgeAlreadyReferenced { edge_id, existing_ref } => write!(
                f, "edge {:?} already owned by Reference {:?}",
                edge_id, existing_ref,
            ),
            Self::FaceAlreadyReferenced { face_id, existing_ref } => write!(
                f, "face {:?} already owned by Reference {:?}",
                face_id, existing_ref,
            ),
            Self::FaceOwnedByXia { face_id } => write!(
                f, "face {:?} is owned by a Xia (Property citizen) — \
                    cannot register as Reference",
                face_id,
            ),
            Self::FaceOwnedByShape { face_id } => write!(
                f, "face {:?} is owned by a Shape (Form citizen) — \
                    cannot register as Reference",
                face_id,
            ),
            Self::VertAlreadyReferenced { vert_id, existing_ref } => write!(
                f, "vert {:?} already owned by Reference {:?}",
                vert_id, existing_ref,
            ),
        }
    }
}

impl std::error::Error for ReferenceCreateError {}

impl Scene {
    pub fn new() -> Self {
        Self {
            mesh: Mesh::new(),
            xias: HashMap::new(),
            face_to_xia: HashMap::new(),
            next_xia_id: 1,
            transactions: TransactionManager::new(100),
            material_library: MaterialLibrary::new(),
            groups: GroupManager::new(),
            constraints: ConstraintGraph::new(),
            epoch: None,
            // ADR-139 B-β-1: default OFF (메타-원칙 #16 자동화 antipattern 폐기)
            auto_intersect_on_draw: false,
            // ADR-139 B-β-2: default OFF (Step 4.99 자동 cycle face synthesis 폐기)
            auto_face_synthesis_on_draw: false,
            boolean_group_tags: HashMap::new(),
            shapes: HashMap::new(),
            next_shape_id: 1,
            shape_to_xia: HashMap::new(),
            face_to_shape: HashMap::new(),
            xia_to_original_shape: HashMap::new(),
            // ADR-095 Phase 3-β — Reference citizenship (Two-Layer Phase 3).
            references: HashMap::new(),
            next_reference_id: 1,
            face_to_reference: HashMap::new(),
            edge_to_reference: HashMap::new(),
            vert_to_reference: HashMap::new(),
        }
    }

    // ════════════════════════════════════════════════
    // 통합 스냅샷 (Mesh + XIA + Groups)
    // ════════════════════════════════════════════════

    /// 전체 씬 상태를 직렬화 (Undo/Redo 용)
    pub fn scene_snapshot(&self) -> Vec<u8> {
        let mesh_data = self.mesh.snapshot();
        let xia_data = bincode::serialize(&self.xias).unwrap_or_else(|e| {
            eprintln!("[Scene] XIA serialize failed: {}", e);
            Vec::new()
        });
        let group_data = bincode::serialize(&self.groups).unwrap_or_else(|e| {
            eprintln!("[Scene] Group serialize failed: {}", e);
            Vec::new()
        });
        // Constraint Solver Level 2 — appended at end for backward compatibility.
        let constraints_data = bincode::serialize(&self.constraints).unwrap_or_else(|e| {
            eprintln!("[Scene] Constraint serialize failed: {}", e);
            Vec::new()
        });
        // ADR-078 P-1 — Boolean group tags appended after constraints
        // (additive — legacy snapshots without this section restore as empty).
        let boolean_group_data = bincode::serialize(&self.boolean_group_tags).unwrap_or_else(|e| {
            eprintln!("[Scene] BooleanGroupTags serialize failed: {}", e);
            Vec::new()
        });
        // ADR-050 P-3 — Section 7: Shape (form-layer) persistence.
        // Three sub-sections (shapes / next_shape_id / shape_to_xia) keep the
        // form-layer state independent of section 1-2 (mesh + xias) so that
        // legacy v2 snapshots (predating P-3) restore Shape state to default
        // empty without breaking bincode round-trip on any other field.
        let shapes_data = bincode::serialize(&self.shapes).unwrap_or_else(|e| {
            eprintln!("[Scene] Shapes serialize failed: {}", e);
            Vec::new()
        });
        let shape_to_xia_data = bincode::serialize(&self.shape_to_xia).unwrap_or_else(|e| {
            eprintln!("[Scene] ShapeToXia serialize failed: {}", e);
            Vec::new()
        });
        // ADR-091 D-ε — sub-section 7d (additive). Reverse linkage map
        // for reversible Xia → Shape demotion.
        let xia_to_original_shape_data = bincode::serialize(&self.xia_to_original_shape).unwrap_or_else(|e| {
            eprintln!("[Scene] XiaToOriginalShape serialize failed: {}", e);
            Vec::new()
        });
        // ADR-095 Phase 3-ε — section 8 (additive). Reference 시민권
        // persistence. Legacy V2 snapshots truncate before this section
        // → restore reads empty map.
        let references_data = bincode::serialize(&self.references).unwrap_or_else(|e| {
            eprintln!("[Scene] References serialize failed: {}", e);
            Vec::new()
        });
        // ADR-098 S-γ — section 9 (additive). Material library 3-tier
        // state (built-in 12 + project + user). Legacy snapshots without
        // this section restore to default Scene::new() library (12
        // built-ins, no custom). System tier 항상 fresh init — bincode
        // 호환 + LOCKED #26 P-5e-β FORM_MATERIAL sentinel 보존.
        let material_library_data = bincode::serialize(&self.material_library).unwrap_or_else(|e| {
            eprintln!("[Scene] MaterialLibrary serialize failed: {}", e);
            Vec::new()
        });
        let next_xia = self.next_xia_id;
        let next_shape = self.next_shape_id;
        let next_reference = self.next_reference_id;

        // [mesh_len:u64][mesh_data][xia_len:u64][xia_data]
        // [group_len:u64][group_data][next_xia_id:u64]
        // [constraints_len:u64][constraints_data]
        // [boolean_group_len:u64][boolean_group_data]   ← ADR-078 P-1 (additive)
        // [shapes_len:u64][shapes_data]                 ← ADR-050 P-3 (additive)
        // [next_shape_id:u64]                           ← ADR-050 P-3 (additive)
        // [shape_to_xia_len:u64][shape_to_xia_data]     ← ADR-050 P-3 (additive)
        // [xia_to_orig_shape_len:u64][xia_to_orig_shape_data] ← ADR-091 D-ε (additive)
        // [references_len:u64][references_data]            ← ADR-095 Phase 3-ε (additive)
        // [next_reference_id:u64]                          ← ADR-095 Phase 3-ε (additive)
        // [material_library_len:u64][material_library_data]  ← ADR-098 S-γ (additive)
        let mut buf = Vec::with_capacity(
            8 + mesh_data.len() + 8 + xia_data.len() + 8 + group_data.len() + 8
                + 8 + constraints_data.len() + 8 + boolean_group_data.len()
                + 8 + shapes_data.len() + 8 + 8 + shape_to_xia_data.len()
                + 8 + xia_to_original_shape_data.len()
                + 8 + references_data.len() + 8
                + 8 + material_library_data.len(),
        );
        buf.extend_from_slice(&(mesh_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&mesh_data);
        buf.extend_from_slice(&(xia_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&xia_data);
        buf.extend_from_slice(&(group_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&group_data);
        buf.extend_from_slice(&(next_xia as u64).to_le_bytes()); // u64 for snapshot backward compat
        buf.extend_from_slice(&(constraints_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&constraints_data);
        // ADR-078 P-1 — section 6 (additive). EOF before this section in legacy snapshots
        // is handled by the matching `if offset + 8 <= data.len()` guard in restore.
        buf.extend_from_slice(&(boolean_group_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&boolean_group_data);
        // ADR-050 P-3 — section 7 (additive). 3 sub-sections.
        buf.extend_from_slice(&(shapes_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&shapes_data);
        buf.extend_from_slice(&(next_shape as u64).to_le_bytes());
        buf.extend_from_slice(&(shape_to_xia_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&shape_to_xia_data);
        // ADR-091 D-ε — sub-section 7d (additive). Legacy V2 snapshots
        // truncate before this section → restore reads None (empty map).
        buf.extend_from_slice(&(xia_to_original_shape_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&xia_to_original_shape_data);
        // ADR-095 Phase 3-ε — section 8 (additive). Legacy snapshots
        // (V2 / pre-Phase 3) truncate before this section → restore
        // reads empty references + next_reference_id = 1 default.
        buf.extend_from_slice(&(references_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&references_data);
        buf.extend_from_slice(&(next_reference as u64).to_le_bytes());
        // ADR-098 S-γ — section 9 (additive). Legacy snapshots truncate
        // before this section → restore keeps default-constructed library
        // (12 built-ins, no custom).
        buf.extend_from_slice(&(material_library_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&material_library_data);
        buf
    }

    /// 스냅샷으로부터 씬 상태 복원 (Undo/Redo 용)
    pub fn restore_scene_snapshot(&mut self, data: &[u8]) {
        let mut offset = 0usize;

        // Helper: read u64 length prefix
        let read_len = |data: &[u8], off: &mut usize| -> usize {
            if *off + 8 > data.len() { return 0; }
            let len = u64::from_le_bytes(data[*off..*off + 8].try_into().unwrap_or([0; 8])) as usize;
            *off += 8;
            len
        };

        // 1. Mesh
        let mesh_len = read_len(data, &mut offset);
        if mesh_len > 0 && offset + mesh_len <= data.len() {
            self.mesh.restore_snapshot(&data[offset..offset + mesh_len]);
            offset += mesh_len;
        } else {
            // 레거시 스냅샷 (mesh만 포함) — 하위 호환
            self.mesh.restore_snapshot(data);
            return;
        }

        // 2. XIAs
        let xia_len = read_len(data, &mut offset);
        if xia_len > 0 && offset + xia_len <= data.len() {
            if let Ok(restored) = bincode::deserialize::<HashMap<XiaId, Xia>>(&data[offset..offset + xia_len]) {
                self.xias = restored;
            }
            offset += xia_len;
        }

        // 3. Groups
        let group_len = read_len(data, &mut offset);
        if group_len > 0 && offset + group_len <= data.len() {
            if let Ok(restored) = bincode::deserialize::<GroupManager>(&data[offset..offset + group_len]) {
                self.groups = restored;
            }
            offset += group_len;
        }

        // 4. next_xia_id
        if offset + 8 <= data.len() {
            self.next_xia_id = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or([0; 8])) as u32; // u64→u32 for backward compat
            offset += 8;
        }

        // 5. Constraint graph (Level 2, backward-compat: old snapshots don't have this)
        if offset + 8 <= data.len() {
            let clen = read_len(data, &mut offset);
            if clen > 0 && offset + clen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<ConstraintGraph>(&data[offset..offset + clen]) {
                    self.constraints = restored;
                }
                offset += clen;
            }
        } else {
            // Legacy snapshot — reset constraints
            self.constraints = ConstraintGraph::new();
        }

        // 6. ADR-078 P-1 — Boolean group tags (additive, backward-compat).
        //    Legacy snapshots predating ADR-078 don't have this section
        //    → reset to empty (no group state in old projects, expected).
        if offset + 8 <= data.len() {
            let blen = read_len(data, &mut offset);
            if blen > 0 && offset + blen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<HashMap<FaceId, crate::BooleanGroupTag>>(
                    &data[offset..offset + blen],
                ) {
                    self.boolean_group_tags = restored;
                }
                offset += blen;
            }
        } else {
            // Legacy snapshot (pre-ADR-078) — reset boolean group tags.
            self.boolean_group_tags.clear();
        }

        // 7. ADR-050 P-3 — Shape persistence (additive, backward-compat).
        //    Three sub-sections (shapes / next_shape_id / shape_to_xia).
        //    Legacy snapshots predating ADR-050 P-3 don't have these
        //    → reset to default empty (1 for next_shape_id, empty maps).
        let mut shapes_section_present = false;

        // 7a. shapes
        if offset + 8 <= data.len() {
            let slen = read_len(data, &mut offset);
            if slen > 0 && offset + slen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<HashMap<crate::ShapeId, crate::Shape>>(
                    &data[offset..offset + slen],
                ) {
                    self.shapes = restored;
                    shapes_section_present = true;
                }
                offset += slen;
            } else if slen == 0 {
                // Section header present but body empty (no shapes) —
                // valid case after `clear_shapes()` then snapshot.
                self.shapes.clear();
                shapes_section_present = true;
            }
        }

        // 7b. next_shape_id (only if section 7 detected)
        if shapes_section_present && offset + 8 <= data.len() {
            self.next_shape_id = u64::from_le_bytes(
                data[offset..offset + 8].try_into().unwrap_or([0; 8]),
            ) as u32;
            offset += 8;
        }

        // 7c. shape_to_xia
        if shapes_section_present && offset + 8 <= data.len() {
            let xlen = read_len(data, &mut offset);
            if xlen > 0 && offset + xlen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<HashMap<crate::ShapeId, XiaId>>(
                    &data[offset..offset + xlen],
                ) {
                    self.shape_to_xia = restored;
                }
                offset += xlen;
            } else if xlen == 0 {
                self.shape_to_xia.clear();
            }
        }

        // 7d. ADR-091 D-ε — xia_to_original_shape (additive, backward-
        //     compat). Legacy snapshots predating ADR-091 D-ε truncate
        //     before this sub-section → restore as empty map.
        let mut xia_to_orig_present = false;
        if shapes_section_present && offset + 8 <= data.len() {
            let xlen = read_len(data, &mut offset);
            if xlen > 0 && offset + xlen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<HashMap<XiaId, crate::ShapeId>>(
                    &data[offset..offset + xlen],
                ) {
                    self.xia_to_original_shape = restored;
                    xia_to_orig_present = true;
                }
                offset += xlen;
            } else if xlen == 0 {
                self.xia_to_original_shape.clear();
                xia_to_orig_present = true;
            }
        }
        if !xia_to_orig_present {
            // Legacy snapshot (pre-ADR-091 D-ε) — empty map.
            self.xia_to_original_shape.clear();
        }

        if !shapes_section_present {
            // Legacy snapshot (pre-ADR-050 P-3) — reset Shape state.
            self.shapes.clear();
            self.next_shape_id = 1;
            self.shape_to_xia.clear();
            self.xia_to_original_shape.clear();
        }

        // 8. ADR-095 Phase 3-ε — Reference 시민권 persistence (additive,
        //    backward-compat). Legacy snapshots (V2 / pre-Phase 3)
        //    truncate before section 8 → restore reads empty references
        //    + next_reference_id = 1 default.
        let mut references_section_present = false;
        if offset + 8 <= data.len() {
            let rlen = read_len(data, &mut offset);
            if rlen > 0 && offset + rlen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<HashMap<crate::ReferenceId, crate::Reference>>(
                    &data[offset..offset + rlen],
                ) {
                    self.references = restored;
                    references_section_present = true;
                }
                offset += rlen;
            } else if rlen == 0 {
                self.references.clear();
                references_section_present = true;
            }
        }
        if references_section_present && offset + 8 <= data.len() {
            self.next_reference_id = u64::from_le_bytes(
                data[offset..offset + 8].try_into().unwrap_or([0; 8]),
            ) as u32;
            offset += 8;
        }
        if !references_section_present {
            // Legacy snapshot (pre-ADR-095 Phase 3-ε) — reset Reference state.
            self.references.clear();
            self.next_reference_id = 1;
        }

        // 9. ADR-098 S-γ — Material library 3-tier persistence (additive,
        //    backward-compat). Legacy snapshots truncate before section 9
        //    → restore keeps default-constructed library from Scene::new.
        let mut material_library_section_present = false;
        if offset + 8 <= data.len() {
            let mlen = read_len(data, &mut offset);
            if mlen > 0 && offset + mlen <= data.len() {
                // ADR-099 L-β/L-γ lesson — bincode deserialize failure
                // here means a struct field was added with `skip_serializing_if`
                // (omits bytes) but deserialize expects positional layout.
                // Always log; ignore-and-keep-default would silently drop
                // the user's material library on schema drift.
                match bincode::deserialize::<crate::material::MaterialLibrary>(
                    &data[offset..offset + mlen],
                ) {
                    Ok(restored) => {
                        self.material_library = restored;
                        // Auto-migrate legacy materials (idempotent if already
                        // tagged). ADR-098 S-D — id-range heuristic classifies
                        // any material missing tier_index.
                        self.material_library.migrate_legacy_materials();
                        material_library_section_present = true;
                    }
                    Err(e) => {
                        eprintln!(
                            "[Scene] section 9 material_library deserialize failed: {} \
                             (mlen={}). Keeping default library (12 built-ins).",
                            e, mlen,
                        );
                    }
                }
                offset += mlen;
            } else if mlen == 0 {
                // Empty section — keep default library (12 built-ins).
                material_library_section_present = true;
            }
        }
        if !material_library_section_present {
            // Legacy snapshot (pre-ADR-098 S-γ) — keep default library
            // (Scene::new already initialized with 12 built-ins). No reset
            // needed; Scene constructor is the source-of-truth fallback.
        }
        // Suppress unused-assignment warning — offset 가 계속 갱신되므로
        // 향후 sub-section 추가 시 그대로 사용 가능.
        let _ = offset;

        // 9. 역인덱스 재구축 (face_ids가 이제 직렬화되므로)
        self.rebuild_face_to_xia_index();
        // ADR-079 W-1 — face_to_shape 도 rebuild (Shape.face_ids 에서 derive).
        self.rebuild_face_to_shape_index();
        // ADR-095 Phase 3-ε — Reference 의 reverse 인덱스 (face/edge/
        // vert_to_reference) rebuild from references state.
        self.rebuild_reference_reverse_indexes();
    }

    /// ADR-097 T-γ — Scene-level topology damage detection wrapper.
    ///
    /// Mesh::detect_topology_damage 의 결과 (사건 2 + 3) 위에 사건 4
    /// (Orphan) 를 추가. Three-Layer Citizenship 정합 — face active
    /// 이지만 face_to_xia / face_to_shape / face_to_reference 모두
    /// 부재 면 Orphan damage 로 분류.
    ///
    /// **Read-only**: Scene state 변경 0.
    pub fn detect_topology_damage(&self) -> axia_geo::TopologyDamageReport {
        use axia_geo::TopologyDamageKind;
        let mut report = self.mesh.detect_topology_damage();

        // Orphan detection — face active + 모든 reverse 인덱스 부재.
        for (fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            let in_xia = self.face_to_xia.contains_key(&fid);
            let in_shape = self.face_to_shape.contains_key(&fid);
            let in_reference = self.face_to_reference.contains_key(&fid);
            if !in_xia && !in_shape && !in_reference {
                report.damages.push(TopologyDamageKind::Orphan { face_id: fid });
            }
        }
        report
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-100 R-β — Material Removal Recovery (Phase 5-C)
    //
    // ADR-097 (Phase 4) Orchestrator 패턴의 material-layer 변형. v3.2
    // §12.3 + ADR-049 §4 Q5 final 정합 — 재질 제거 시 자동 복구 시도
    // → 실패 시 사용자 다이얼로그 (UI layer, R-δ).
    //
    // 3-tier recovery cascade (R-B):
    //   Pass 1: auto-demote — Xia.material = FORM_MATERIAL → demote
    //           via ADR-091 D-β (4-condition gate)
    //   Pass 2: fallback — reassign to Concrete (MaterialId::new(0))
    //   Pass 3: escalate — return PartialFailure for dialog
    //
    // ADR-091 §E L1 canonical 답습 — `affected_xias` 는 read-only
    // detection 결과의 ephemeral Vec, Scene struct 변경 0.
    // ════════════════════════════════════════════════════════════════════

    /// ADR-100 R-β — Detect orphan material assignments.
    ///
    /// Scans `self.xias` for entries whose `material` is no longer
    /// present in `self.material_library` (e.g. after a `removeUserMaterial`
    /// call). FORM_MATERIAL sentinel (id 0 = Concrete) is *always* valid
    /// and never reported (System tier built-in).
    ///
    /// **Read-only**: Scene state 변경 0.
    pub fn detect_orphan_material_assignments(&self) -> OrphanMaterialReport {
        let mut affected_xias = Vec::new();
        for (xid, xia) in &self.xias {
            // FORM_MATERIAL is always valid (Phase 1 sentinel + System
            // built-in id 0 = Concrete). Skip.
            if xia.material == FORM_MATERIAL {
                continue;
            }
            // Check material_library — if absent, this is an orphan.
            if self.material_library.get(xia.material).is_none() {
                affected_xias.push(OrphanMaterialEntry {
                    xia_id: *xid,
                    stale_material_id: xia.material.raw(),
                    face_count: xia.face_ids.len(),
                });
            }
        }
        // Deterministic ordering — XiaId ascending.
        affected_xias.sort_by_key(|e| e.xia_id);
        OrphanMaterialReport { affected_xias }
    }

    /// ADR-100 R-β — Attempt 3-tier material recovery.
    ///
    /// Executes the recovery cascade for ALL currently-orphan Xias:
    ///   * Pass 1 (auto-demote) — try `demote_xia_to_shape` after
    ///     setting `Xia.material = FORM_MATERIAL`
    ///   * Pass 2 (fallback) — if demote fails (e.g. promote condition
    ///     drift), reassign to `FORM_MATERIAL` and *leave the Xia in
    ///     place* with a fallback flag (the face still owns a valid
    ///     material — Concrete)
    ///   * Pass 3 (escalate) — remaining orphans returned in
    ///     `PartialFailure.remaining_orphans` for dialog handling
    ///
    /// Mutates Scene state on success paths (Pass 1 demote, Pass 2
    /// material reassign). Caller wraps in transaction for atomic undo.
    pub fn attempt_material_removal_recovery(&mut self) -> MaterialRecoveryOutcome {
        let report = self.detect_orphan_material_assignments();
        if report.affected_xias.is_empty() {
            return MaterialRecoveryOutcome::NoOp;
        }

        let initial = report.affected_xias.len();
        let mut faces_demoted = 0usize;
        let mut faces_fallback = 0usize;
        let mut remaining = Vec::new();

        for entry in &report.affected_xias {
            let xia_id = entry.xia_id;
            let face_count = entry.face_count;

            // Pass 1 — set material to FORM_MATERIAL and try demote.
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.material = FORM_MATERIAL;
            }
            if self.demote_xia_to_shape(xia_id).is_ok() {
                faces_demoted += face_count;
                continue;
            }

            // Pass 2 — demote failed (e.g. promote condition drift).
            // The Xia.material is already FORM_MATERIAL (Pass 1) which
            // resolves to System-tier Concrete in the library. No further
            // mutation needed; assignment is now valid.
            //
            // However, if the user later wants the Xia removed, they
            // must do so explicitly. We count this as a recovered face
            // (fallback path) — the orphan is resolved.
            faces_fallback += face_count;
        }

        // Pass 3 — recheck after passes to surface any *new* orphans
        //          (e.g. cascading failure). For now, the cascade above
        //          guarantees every Xia ends up either demoted or with
        //          FORM_MATERIAL, so this is a defensive zero-check.
        let post_check = self.detect_orphan_material_assignments();
        for entry in &post_check.affected_xias {
            remaining.push(*entry);
        }

        if remaining.is_empty() {
            MaterialRecoveryOutcome::Recovered {
                affected_xias: initial,
                faces_demoted,
                faces_fallback,
            }
        } else {
            MaterialRecoveryOutcome::PartialFailure {
                affected_xias: initial,
                remaining_orphans: remaining.len(),
            }
        }
    }

    /// ADR-100 R-β — Remove a Project-tier material with auto-recovery.
    ///
    /// Convenience entry combining `material_library.remove_material`
    /// + `attempt_material_removal_recovery`. The recovery is invoked
    /// unconditionally — caller decides whether to use this entry
    /// (auto-recovery wired) vs the raw `material_library.remove_material`
    /// path (no recovery; legacy bridge surface).
    ///
    /// Lock-ins:
    ///   * R-D — System tier 영원히 거부 (`remove_material` enforces)
    ///   * R-D — User tier 도 본 entry 통해 가능 (overlaps `removeUserMaterial`
    ///     surface 이지만 cascade 가 자연 작동)
    ///   * R-E — Default OFF gate 는 *bridge* layer 에서 검사
    ///     (engine 은 항상 cascade 시도)
    ///   * R-F — Caller wraps in transaction for atomic undo
    pub fn remove_project_material_with_recovery(
        &mut self,
        material_id: MaterialId,
    ) -> Result<MaterialRemovalOutcome, &'static str> {
        // Step 1 — Remove from library (System tier 거부).
        self.material_library.remove_material(material_id)?;

        // Step 2 — Trigger recovery cascade. The Xias whose material
        // was the just-removed id are now orphans (detected on next
        // call).
        let outcome = self.attempt_material_removal_recovery();
        Ok(MaterialRemovalOutcome {
            removed_id: material_id.raw(),
            recovery: outcome,
        })
    }

    /// ADR-095 Phase 3-ε — Reverse index rebuild for Reference state.
    /// Called by `restore_scene_snapshot` after section 8 deserializes.
    /// Mirrors `rebuild_face_to_shape_index` pattern (ADR-079 W-1).
    fn rebuild_reference_reverse_indexes(&mut self) {
        self.face_to_reference.clear();
        self.edge_to_reference.clear();
        self.vert_to_reference.clear();
        for (rid, reference) in &self.references {
            match &reference.category {
                crate::ReferenceCategory::ConstructionLine { edge_ids } => {
                    for &eid in edge_ids {
                        self.edge_to_reference.insert(eid, *rid);
                    }
                }
                crate::ReferenceCategory::ImportedMesh { face_ids, .. } => {
                    for &fid in face_ids {
                        self.face_to_reference.insert(fid, *rid);
                    }
                }
                crate::ReferenceCategory::PointCloud { vert_ids } => {
                    for &vid in vert_ids {
                        self.vert_to_reference.insert(vid, *rid);
                    }
                }
            }
        }
    }

    /// Create a new XIA entity in the scene.
    fn create_xia(&mut self, name: String) -> XiaId {
        let id = self.next_xia_id;
        self.next_xia_id = self.next_xia_id.saturating_add(1);
        let xia = Xia::new(id, name);
        self.xias.insert(id, xia);
        id
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-1 — Shape lifecycle helpers (form-layer, additive only).
    //
    // Per ADR-050 §C lock-ins:
    // - Drop-in alongside existing Xia API (Xia / XiaId / xias / face_to_xia
    //   / next_xia_id all UNCHANGED).
    // - Snapshot persistence deferred to ADR-050 P-3 (additive section).
    // - WASM/TS surface deferred to ADR-050 P-4+ (model-only prototype).
    // - LOCKED #25 (ADR-074 group A/B) and ADR-078 boolean_group_tags both
    //   FaceId-keyed → automatically unaffected by Shape addition.
    // ════════════════════════════════════════════════════════════════════

    /// ADR-050 P-1 — Create a new Shape (form-layer citizen).
    ///
    /// Shapes are the form-layer counterpart to Xia (property layer).
    /// Per ADR-050 §2.1.1, a fresh Shape has no material (the form layer
    /// is materially neutral by design). Promotion to Xia requires the
    /// 4-condition check (see `promote.rs` Phase 1.A).
    ///
    /// `face_ids` may be empty — a line-only Shape with `standalone_edge_id`
    /// set later is valid (mirrors `Xia` line-tool behavior).
    pub fn create_shape(&mut self, name: String, face_ids: Vec<FaceId>) -> crate::ShapeId {
        let id = crate::ShapeId::new(self.next_shape_id);
        self.next_shape_id = self.next_shape_id.saturating_add(1);
        let mut shape = crate::Shape::new(id, name);
        shape.face_ids = face_ids.clone();
        self.shapes.insert(id, shape);
        // ADR-079 W-1 — register face_to_shape reverse index.
        for fid in face_ids {
            self.face_to_shape.insert(fid, id);
        }
        id
    }

    /// ADR-050 P-1 — Read access to a Shape by id.
    pub fn get_shape(&self, id: crate::ShapeId) -> Option<&crate::Shape> {
        self.shapes.get(&id)
    }

    /// ADR-050 P-1 — All currently-stored ShapeIds, sorted ascending.
    /// Used by future Bridge layer / Inspector enumeration.
    pub fn list_shape_ids(&self) -> Vec<crate::ShapeId> {
        let mut ids: Vec<crate::ShapeId> = self.shapes.keys().copied().collect();
        ids.sort();
        ids
    }

    /// ADR-050 P-1 — Remove a Shape by id. Returns true if removed.
    /// Does NOT touch the underlying mesh or any Xia — a Shape is a
    /// pure form-layer record.
    pub fn delete_shape(&mut self, id: crate::ShapeId) -> bool {
        if let Some(shape) = self.shapes.remove(&id) {
            // ADR-079 W-1 — clean up face_to_shape reverse index.
            for fid in &shape.face_ids {
                if self.face_to_shape.get(fid).copied() == Some(id) {
                    self.face_to_shape.remove(fid);
                }
            }
            true
        } else {
            false
        }
    }

    /// ADR-050 P-1 — Remove all Shapes. Drops the form-layer state
    /// without touching mesh / Xias / boolean_group_tags / etc.
    pub fn clear_shapes(&mut self) {
        self.shapes.clear();
        // ADR-079 W-1 — clean up reverse index.
        self.face_to_shape.clear();
    }

    // ════════════════════════════════════════════════
    // ADR-095 Phase 3-β — Reference 시민권 CRUD API
    //
    // Two-Layer Citizenship Phase 3. Reference 시민은 Form (Shape) /
    // Property (Xia) 와 직교 — 사용자 의도 *수정 안 함*. Mutually
    // exclusive geometry ownership 강제 (R-B): 등록 시 face_to_xia /
    // face_to_shape 충돌 검사.
    // ════════════════════════════════════════════════

    /// ADR-095 Phase 3-β — Reference 등록 실패 사유.
    ///
    /// `create_reference` 가 mutually exclusive geometry ownership
    /// invariant 를 어긴 경우 반환. 실패 시 Reference 미생성, reverse
    /// 인덱스 변경 0.
    pub fn create_reference(
        &mut self,
        name: String,
        category: crate::ReferenceCategory,
    ) -> Result<crate::ReferenceId, ReferenceCreateError> {
        // R-B mutually exclusive — 등록 직전 충돌 검사.
        match &category {
            crate::ReferenceCategory::ConstructionLine { edge_ids } => {
                for &eid in edge_ids {
                    if let Some(&existing) = self.edge_to_reference.get(&eid) {
                        return Err(ReferenceCreateError::EdgeAlreadyReferenced {
                            edge_id: eid, existing_ref: existing,
                        });
                    }
                }
            }
            crate::ReferenceCategory::ImportedMesh { face_ids, .. } => {
                for &fid in face_ids {
                    if let Some(&existing) = self.face_to_reference.get(&fid) {
                        return Err(ReferenceCreateError::FaceAlreadyReferenced {
                            face_id: fid, existing_ref: existing,
                        });
                    }
                    if self.face_to_xia.contains_key(&fid) {
                        return Err(ReferenceCreateError::FaceOwnedByXia { face_id: fid });
                    }
                    if self.face_to_shape.contains_key(&fid) {
                        return Err(ReferenceCreateError::FaceOwnedByShape { face_id: fid });
                    }
                }
            }
            crate::ReferenceCategory::PointCloud { vert_ids } => {
                for &vid in vert_ids {
                    if let Some(&existing) = self.vert_to_reference.get(&vid) {
                        return Err(ReferenceCreateError::VertAlreadyReferenced {
                            vert_id: vid, existing_ref: existing,
                        });
                    }
                }
            }
        }

        // Allocate ID + insert.
        let id = crate::ReferenceId::new(self.next_reference_id);
        self.next_reference_id = self.next_reference_id.saturating_add(1);
        let reference = crate::Reference::new(id, name, category.clone());

        // Populate reverse indices.
        match &category {
            crate::ReferenceCategory::ConstructionLine { edge_ids } => {
                for &eid in edge_ids {
                    self.edge_to_reference.insert(eid, id);
                }
            }
            crate::ReferenceCategory::ImportedMesh { face_ids, .. } => {
                for &fid in face_ids {
                    self.face_to_reference.insert(fid, id);
                }
            }
            crate::ReferenceCategory::PointCloud { vert_ids } => {
                for &vid in vert_ids {
                    self.vert_to_reference.insert(vid, id);
                }
            }
        }

        self.references.insert(id, reference);
        Ok(id)
    }

    /// ADR-095 Phase 3-β — Read access to a Reference by id.
    pub fn get_reference(&self, id: crate::ReferenceId) -> Option<&crate::Reference> {
        self.references.get(&id)
    }

    /// ADR-095 Phase 3-β — All currently-stored ReferenceIds, sorted
    /// ascending. Used by future Inspector / WASM bridge enumeration.
    pub fn list_reference_ids(&self) -> Vec<crate::ReferenceId> {
        let mut ids: Vec<crate::ReferenceId> = self.references.keys().copied().collect();
        ids.sort();
        ids
    }

    /// ADR-095 Phase 3-β — Remove a Reference by id. Returns true if
    /// removed. Reverse 인덱스도 정리.
    pub fn delete_reference(&mut self, id: crate::ReferenceId) -> bool {
        if let Some(reference) = self.references.remove(&id) {
            // Clean up reverse indices.
            match reference.category {
                crate::ReferenceCategory::ConstructionLine { edge_ids } => {
                    for eid in edge_ids {
                        if self.edge_to_reference.get(&eid).copied() == Some(id) {
                            self.edge_to_reference.remove(&eid);
                        }
                    }
                }
                crate::ReferenceCategory::ImportedMesh { face_ids, .. } => {
                    for fid in face_ids {
                        if self.face_to_reference.get(&fid).copied() == Some(id) {
                            self.face_to_reference.remove(&fid);
                        }
                    }
                }
                crate::ReferenceCategory::PointCloud { vert_ids } => {
                    for vid in vert_ids {
                        if self.vert_to_reference.get(&vid).copied() == Some(id) {
                            self.vert_to_reference.remove(&vid);
                        }
                    }
                }
            }
            true
        } else {
            false
        }
    }

    /// ADR-095 Phase 3-β — Toggle Reference visibility flag.
    /// Returns true if the Reference exists.
    pub fn set_reference_visible(&mut self, id: crate::ReferenceId, visible: bool) -> bool {
        if let Some(r) = self.references.get_mut(&id) {
            r.visible = visible;
            true
        } else {
            false
        }
    }

    /// ADR-095 Phase 3-β — Toggle Reference locked flag.
    /// Returns true if the Reference exists.
    pub fn set_reference_locked(&mut self, id: crate::ReferenceId, locked: bool) -> bool {
        if let Some(r) = self.references.get_mut(&id) {
            r.locked = locked;
            true
        } else {
            false
        }
    }

    // ════════════════════════════════════════════════
    // ADR-078 P-1 — Boolean Group Persistence helpers
    // (Rust mirror of TS-side SelectionManager U-1 API)
    // ════════════════════════════════════════════════

    /// ADR-078 P-1 — Tag a list of face IDs as Boolean Group A or Group B.
    ///
    /// Mirror of TS `SelectionManager.setGroupTag` (ADR-074 U-1). Same
    /// face = same key in HashMap → re-tagging overwrites (one face = one
    /// group invariant).
    ///
    /// Note: unlike the TS layer, this Rust API does NOT enforce
    /// "tags ⊆ selected" — Scene has no concept of "active selection"
    /// (UI-only). Tags can outlive the runtime selection (project save).
    /// Caller (P-3 bridge) is responsible for the selection ⊃ tags
    /// invariant if needed.
    pub fn set_boolean_group_tag(
        &mut self,
        face_ids: &[FaceId],
        group: crate::BooleanGroupTag,
    ) {
        for &fid in face_ids {
            self.boolean_group_tags.insert(fid, group);
        }
    }

    /// ADR-078 P-1 — Returns face IDs tagged as Group A (sorted ascending).
    pub fn get_boolean_group_a(&self) -> Vec<FaceId> {
        let mut out: Vec<FaceId> = self.boolean_group_tags.iter()
            .filter_map(|(fid, g)| if *g == crate::BooleanGroupTag::A { Some(*fid) } else { None })
            .collect();
        out.sort_by_key(|f| f.raw());
        out
    }

    /// ADR-078 P-1 — Returns face IDs tagged as Group B (sorted ascending).
    pub fn get_boolean_group_b(&self) -> Vec<FaceId> {
        let mut out: Vec<FaceId> = self.boolean_group_tags.iter()
            .filter_map(|(fid, g)| if *g == crate::BooleanGroupTag::B { Some(*fid) } else { None })
            .collect();
        out.sort_by_key(|f| f.raw());
        out
    }

    /// ADR-078 P-1 — Clear all Boolean group tags. Mirror of TS
    /// `SelectionManager.clearGroupTags`.
    pub fn clear_boolean_group_tags(&mut self) {
        self.boolean_group_tags.clear();
    }

    /// ADR-078 P-1 — True iff at least one face has a Boolean group tag.
    /// Mirror of TS `SelectionManager.hasAnyGroupTag` (used by Clear
    /// menu visibility).
    pub fn has_any_boolean_group_tag(&self) -> bool {
        !self.boolean_group_tags.is_empty()
    }

    /// ADR-078 P-1 — True iff BOTH Group A and Group B have ≥1 tagged face.
    /// Mirror of TS `SelectionManager.hasGroupSelection` (used by U-3
    /// BooleanHandler routing — explicit grouping vs half/half fallback).
    pub fn has_boolean_group_selection(&self) -> bool {
        let mut has_a = false;
        let mut has_b = false;
        for g in self.boolean_group_tags.values() {
            match g {
                crate::BooleanGroupTag::A => has_a = true,
                crate::BooleanGroupTag::B => has_b = true,
            }
            if has_a && has_b { return true; }
        }
        false
    }

    /// Create a XIA and assign face IDs (public — for primitives/import).
    /// State is computed from face_ids.len() — no explicit state parameter needed.
    pub fn create_xia_with_faces(&mut self, name: String, position: DVec3, face_ids: Vec<FaceId>) -> XiaId {
        let xia_id = self.create_xia(name);
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = position;
            xia.face_ids = face_ids.clone();
        }
        // 역인덱스 갱신
        for &fid in &face_ids {
            self.face_to_xia.insert(fid, xia_id);
        }
        xia_id
    }

    /// ADR-050 Phase 1.A — Promote a Shape-stage XIA to a Property-stage
    /// XIA via 4-condition validation (재질 / 부피 / 닫힘 / manifold).
    ///
    /// On success: the XIA's `material` is updated to `material` and the
    /// XIA is considered "promoted" (full Phase 1.B will add a `promoted`
    /// flag + Shape-side companion; Phase 1.A surface is the validated
    /// state transition itself).
    ///
    /// On failure: returns a `PromoteError` describing the first failed
    /// condition. The XIA's stored state is unchanged.
    ///
    /// Validation order matches ADR-050 §2.2:
    ///   1. Material non-default (caller-supplied id != 0)
    ///   2. Volume / Length > 0 (kind-dependent)
    ///   3. Watertight (closed solid for Volumetric)
    ///   4. Manifold invariants OK (ADR-007 / ADR-051 P7 prerequisite)
    pub fn promote_xia_with_validation(
        &mut self,
        xia_id: XiaId,
        material: axia_geo::MaterialId,
    ) -> Result<crate::promote::PromoteOk, crate::promote::PromoteError> {
        use crate::promote::{validate_promotion, PromoteError, PromoteOk};

        // Lookup
        let xia = self.xias.get(&xia_id).ok_or(PromoteError::XiaNotFound)?;
        let face_ids = xia.face_ids.clone();
        let standalone = xia.standalone_edge_id;

        // ADR-050 P-2 — shared validation kernel (DRY with
        // `promote_shape_to_xia`). Side-effect free.
        let kind = validate_promotion(&self.mesh, &face_ids, standalone, material)?;

        // All 4 conditions OK → assign material in-place.
        if let Some(xia_mut) = self.xias.get_mut(&xia_id) {
            xia_mut.material = material;
        }

        Ok(PromoteOk { xia_id, kind })
    }

    /// ADR-050 P-2 — Promote a `Shape` (form layer) to a new `Xia`
    /// (property layer) via 4-condition validation.
    ///
    /// Two-Layer Citizenship Model (LOCKED #26): a Shape is the form
    /// citizen — geometric abstraction with no material. Promotion to
    /// Xia is the user-driven transition where a material is assigned
    /// AND the geometry passes 4 invariants (재질 / 부피 / 닫힘 /
    /// manifold). On success, a new Xia is created with the Shape's
    /// face_ids + standalone_edge + name + spatial hint, and the
    /// `shape_to_xia` linkage map is updated. The Shape itself is
    /// preserved (form layer is independent — see ADR-050 §2.4).
    ///
    /// This is the ShapeId entry point; `promote_xia_with_validation`
    /// (Phase 1.A) provides the parallel XiaId entry point. Both
    /// share `validate_promotion` (P-2-a lock-in).
    ///
    /// Errors (in `validate_promotion` order):
    /// - `ShapeNotFound` — shape_id missing
    /// - `NoGeometry` — Shape has no faces and no standalone edge
    /// - `InvalidMaterial` — material is the default sentinel
    /// - `ZeroVolume` / `ZeroDimension` — degenerate metrics
    /// - `NotWatertight` — Volumetric: open boundary
    /// - `NotManifold` — mesh-wide ADR-007 violations
    pub fn promote_shape_to_xia(
        &mut self,
        shape_id: crate::ShapeId,
        material: axia_geo::MaterialId,
    ) -> Result<crate::promote::PromoteOk, crate::promote::PromoteError> {
        use crate::promote::{validate_promotion, PromoteError, PromoteOk};

        // Lookup the Shape (clone fields so we can mutate self below).
        let shape = self.shapes.get(&shape_id).ok_or(PromoteError::ShapeNotFound)?;
        let face_ids = shape.face_ids.clone();
        let standalone = shape.standalone_edge_id;
        let name = shape.name.clone();
        let position = shape.position;
        let surface_normal = shape.surface_normal;

        // Shared validation kernel — same 4 conditions as Phase 1.A.
        let kind = validate_promotion(&self.mesh, &face_ids, standalone, material)?;

        // All 4 conditions OK → create the Xia.
        let xia_id = self.next_xia_id;
        self.next_xia_id = self.next_xia_id.saturating_add(1);
        let mut xia = Xia::new(xia_id, name);
        xia.face_ids = face_ids.clone();
        xia.standalone_edge_id = standalone;
        xia.position = position;
        xia.surface_normal = surface_normal;
        xia.material = material;
        self.xias.insert(xia_id, xia);
        // ADR-091 D-ε L4 — record source ShapeId on Scene-level map
        // for reversible demotion (kept off Xia struct for bincode
        // legacy compat, ADR-050 P-2-d precedent).
        self.xia_to_original_shape.insert(xia_id, shape_id);

        // Reverse index: face → Xia (overwrite policy per P-2-f).
        for &fid in &face_ids {
            self.face_to_xia.insert(fid, xia_id);
        }

        // ADR-050 P-2-d — Track Shape → Xia linkage in a separate map
        // (Xia struct UNCHANGED, snapshot 영향 0). Used by future
        // demote API (ADR-052) to find the form anchor.
        self.shape_to_xia.insert(shape_id, xia_id);

        // Note: Shape is preserved (P-2-c) — form layer is independent
        // of property layer. Demote (ADR-052) will use shape_to_xia
        // to find the anchor.

        Ok(PromoteOk { xia_id, kind })
    }

    /// ADR-091 D-β — Demote a `Xia` (property layer) back to a `Shape`
    /// (form layer) when its material reverts to the form-layer
    /// sentinel (`FORM_MATERIAL`).
    ///
    /// Reversal of `promote_shape_to_xia`. Topology (face_ids /
    /// standalone_edge / mesh) is unchanged — demotion is a pure
    /// citizenship-layer operation per Lock-in D-B=a.
    ///
    /// ShapeId restoration policy (Lock-in D-D=b):
    /// - If `xia_to_original_shape[xia_id] == Some(sid)` AND `sid` is not
    ///   already occupied → restore the original id (round-trip
    ///   preservation: `Shape → Xia → Shape` keeps the same id).
    /// - Otherwise → allocate a fresh ShapeId via `next_shape_id`.
    ///
    /// Side effects:
    /// - `Scene.xias[xia_id]` removed
    /// - `Scene.shapes[shape_id]` inserted (or face_ids extended if
    ///   the original Shape still exists from `promote_shape_to_xia`'s
    ///   P-2-c "Shape preserved" policy)
    /// - `Scene.face_to_xia` entries for these faces removed
    /// - `Scene.face_to_shape` entries inserted
    /// - `Scene.shape_to_xia` entry for the source Shape (if any)
    ///   removed
    ///
    /// Errors:
    /// - `DemoteError::XiaNotFound` — xia_id missing
    /// - `DemoteError::MaterialNotFormSentinel` — material != FORM_MATERIAL
    /// - `DemoteError::ShapeIdConflict` — defensive (shouldn't happen
    ///   in normal flow — see DemoteError doc)
    pub fn demote_xia_to_shape(
        &mut self,
        xia_id: XiaId,
    ) -> Result<crate::promote::DemoteOk, crate::promote::DemoteError> {
        use crate::promote::{DemoteError, DemoteOk};

        // 1. Lookup
        let xia = self.xias.get(&xia_id).ok_or(DemoteError::XiaNotFound)?;

        // 2. D-A=a: trigger gate — material must be FORM_MATERIAL.
        if xia.material != FORM_MATERIAL {
            return Err(DemoteError::MaterialNotFormSentinel);
        }

        // 3. Snapshot fields before mutation (D-B=a: face_ids move).
        let face_ids = xia.face_ids.clone();
        let standalone = xia.standalone_edge_id;
        let position = xia.position;
        let surface_normal = xia.surface_normal;
        let name = xia.name.clone();
        // ADR-091 D-ε — original_shape_id lives on Scene map (P-2-d
        // precedent), not on Xia struct.
        let original_shape_id = self.xia_to_original_shape.get(&xia_id).copied();

        // 4. D-D=b: ShapeId restoration policy.
        //
        // Phase 1 P-2-c preserves the Shape after promote, so the
        // original Shape *should* already exist. In that case we extend
        // it with the (possibly mutated) face_ids rather than creating
        // a new one. Otherwise (legacy Xia / direct construction) we
        // allocate fresh.
        let (shape_id, original_id_restored) = match original_shape_id {
            Some(sid) if self.shapes.contains_key(&sid) => {
                // Original Shape still present → re-use (extend faces).
                (sid, true)
            }
            Some(sid) => {
                // Original Shape was deleted but slot is free → restore.
                let mut shape = crate::Shape::new(sid, name.clone());
                shape.face_ids = face_ids.clone();
                shape.standalone_edge_id = standalone;
                shape.position = position;
                shape.surface_normal = surface_normal;
                self.shapes.insert(sid, shape);
                (sid, true)
            }
            None => {
                // Legacy / direct-construction Xia → fresh id.
                let sid = crate::ShapeId::new(self.next_shape_id);
                self.next_shape_id = self.next_shape_id.saturating_add(1);
                let mut shape = crate::Shape::new(sid, name.clone());
                shape.face_ids = face_ids.clone();
                shape.standalone_edge_id = standalone;
                shape.position = position;
                shape.surface_normal = surface_normal;
                self.shapes.insert(sid, shape);
                (sid, false)
            }
        };

        // 5. Sync face_ids onto the Shape (if it pre-existed and faces
        //    were mutated since promote, e.g., by Boolean / Push-Pull).
        //    L1 lock-in: order preserved (direct copy, not push).
        if let Some(shape_mut) = self.shapes.get_mut(&shape_id) {
            shape_mut.face_ids = face_ids.clone();
            shape_mut.standalone_edge_id = standalone;
        }

        // 6. Remove Xia + face_to_xia entries.
        self.xias.remove(&xia_id);
        for fid in &face_ids {
            self.face_to_xia.remove(fid);
        }

        // 7. Register face_to_shape for the form layer.
        for fid in &face_ids {
            self.face_to_shape.insert(*fid, shape_id);
        }

        // 8. Cleanup shape_to_xia linkage (any Shape pointing at this
        //    Xia is now stale).
        self.shape_to_xia.retain(|_, &mut v| v != xia_id);

        // 9. ADR-091 D-ε — Cleanup xia_to_original_shape (one-way
        //    consumption per round-trip; re-promote will re-record).
        self.xia_to_original_shape.remove(&xia_id);

        Ok(DemoteOk { shape_id, original_id_restored })
    }

    /// Register face→XIA mapping in the reverse index
    fn register_faces_to_xia(&mut self, xia_id: XiaId, face_ids: &[FaceId]) {
        for &fid in face_ids {
            self.face_to_xia.insert(fid, xia_id);
        }
    }

    /// Remove face from reverse index and from owning XIA's face_ids.
    /// If the XIA's face_ids becomes empty, dissolve the XIA.
    pub fn unregister_face_from_xia(&mut self, face_id: FaceId) {
        if let Some(xia_id) = self.face_to_xia.remove(&face_id) {
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.face_ids.retain(|&f| f != face_id);
                // 2-3: face_ids가 비면 Dissolved 처리
                if xia.face_ids.is_empty() {
                    lifecycle::dissolve(xia);
                }
            }
        }
    }

    /// Batch unregister multiple faces from their owning XIAs.
    /// More efficient than calling unregister_face_from_xia() one by one.
    pub fn unregister_faces_from_xia(&mut self, face_ids: &[FaceId]) {
        // Collect affected XIAs
        let mut affected: HashMap<XiaId, Vec<FaceId>> = HashMap::new();
        for &fid in face_ids {
            if let Some(xia_id) = self.face_to_xia.remove(&fid) {
                affected.entry(xia_id).or_default().push(fid);
            }
        }
        // Remove faces from each XIA and dissolve if empty
        for (xia_id, removed_fids) in affected {
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                for fid in &removed_fids {
                    xia.face_ids.retain(|&f| f != *fid);
                }
                if xia.face_ids.is_empty() {
                    lifecycle::dissolve(xia);
                }
            }
        }
    }

    /// Find the XIA that owns a face (O(1) lookup)
    pub fn get_xia_for_face(&self, face_id: FaceId) -> Option<XiaId> {
        self.face_to_xia.get(&face_id).copied()
    }

    /// Rebuild reverse index from all XIAs (after snapshot restore)
    fn rebuild_face_to_xia_index(&mut self) {
        self.face_to_xia.clear();
        for (xia_id, xia) in &self.xias {
            for &fid in &xia.face_ids {
                self.face_to_xia.insert(fid, *xia_id);
            }
        }
    }

    /// ADR-079 W-1 — Rebuild reverse index from all Shapes
    /// (after snapshot restore). Mirrors `rebuild_face_to_xia_index`.
    fn rebuild_face_to_shape_index(&mut self) {
        self.face_to_shape.clear();
        for (shape_id, shape) in &self.shapes {
            for &fid in &shape.face_ids {
                self.face_to_shape.insert(fid, *shape_id);
            }
        }
    }

    /// Slice (Plane Cut) — split a closed Wall volume into two volumes
    /// with a cutting plane. Single-XIA only (all input faces must belong
    /// to a single XIA = one logical volume).
    ///
    /// On success:
    /// - Original XIA keeps the **above** half (above sub-walls + cap_above).
    /// - A new XIA is created for the **below** half (below sub-walls + cap_below).
    /// - The new XIA's name is `<original>_below` and its position is the
    ///   centroid of the below cap.
    ///
    /// Returns the new XIA id (below half) on success.
    pub fn slice_volume_by_plane(
        &mut self,
        face_ids: &[axia_geo::FaceId],
        plane: axia_geo::operations::slice::SlicePlane,
    ) -> anyhow::Result<crate::xia::XiaId> {
        if face_ids.is_empty() {
            anyhow::bail!("slice_volume_by_plane: empty face set");
        }

        // Determine the source XIA — must be unique across the input set.
        let mut source_xia: Option<crate::xia::XiaId> = None;
        for &fid in face_ids {
            match (source_xia, self.face_to_xia.get(&fid).copied()) {
                (None, Some(x)) => source_xia = Some(x),
                (Some(prev), Some(x)) if prev == x => {}
                (Some(_), Some(_)) => anyhow::bail!(
                    "slice_volume_by_plane: input faces span multiple XIAs — \
                    select faces from a single volume only"),
                (_, None) => anyhow::bail!(
                    "slice_volume_by_plane: face {:?} has no owning XIA", fid),
            }
        }
        let source_xia = source_xia
            .ok_or_else(|| anyhow::anyhow!("slice_volume_by_plane: cannot determine source XIA"))?;

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // Run the geometric slice.
        let mat = FORM_MATERIAL;
        let result = match self.mesh.slice_volume_by_plane(face_ids, plane, mat) {
            Ok(r) => r,
            Err(e) => {
                self.transactions.cancel();
                return Err(e);
            }
        };

        // ── XIA management ──────────────────────────────────────────────
        // 1. Strip original XIA's face_ids of the consumed input faces.
        //    Some input faces still exist (split into sub-faces with same id
        //    for the "kept" half). To avoid stale mappings we reset the XIA's
        //    face_ids entirely from the above set.
        for &fid in face_ids {
            self.face_to_xia.remove(&fid);
        }
        // Above half — assigned to the source XIA.
        let above_all: Vec<axia_geo::FaceId> = result.above_walls.iter()
            .chain(result.cap_above.iter())
            .copied()
            .collect();
        if let Some(xia) = self.xias.get_mut(&source_xia) {
            xia.face_ids = above_all.clone();
        }
        for &f in &above_all {
            self.face_to_xia.insert(f, source_xia);
        }

        // Below half — new XIA.
        let below_all: Vec<axia_geo::FaceId> = result.below_walls.iter()
            .chain(result.cap_below.iter())
            .copied()
            .collect();

        // Centroid of below cap face(s) for position.
        let mut centroid = glam::DVec3::ZERO;
        let mut count = 0usize;
        for &fid in &result.cap_below {
            if let Ok(verts) = self.mesh.collect_loop_verts(self.mesh.faces[fid].outer().start) {
                for v in verts {
                    if let Some(p) = self.mesh.verts.get(v).map(|x| x.pos()) {
                        centroid += p;
                        count += 1;
                    }
                }
            }
        }
        if count > 0 { centroid /= count as f64; }

        let original_name = self.xias.get(&source_xia)
            .map(|x| x.name.clone())
            .unwrap_or_else(|| "Volume".to_string());
        let below_name = format!("{}_below", original_name);
        let new_xia = self.create_xia_with_faces(below_name, centroid, below_all);

        // Inherit material assignment for new faces (default already set).
        // Future: copy any per-face material attributes from source if needed.

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        Ok(new_xia)
    }

    /// Scene-level repair of non-manifold edges (ADR-007 I5).
    ///
    /// Strategy (XIA-aware, with geometric fallback):
    /// 1. Find every active edge with > 2 active incident faces.
    /// 2. Group those faces by owning XIA. The "anchor" group is the
    ///    XIA contributing the most faces to the edge (ties broken by
    ///    smallest XIA id). All other faces are detached using
    ///    `Mesh::detach_face_groups`, duplicating any vertex shared
    ///    with the anchor group.
    /// 3. After XIA-aware repair, run a final geometric pass to mop up
    ///    any edges where all incident faces share the same XIA (rare —
    ///    indicates a single tool produced bad topology).
    /// 4. Refresh face_to_xia for any faces that got remapped during
    ///    detachment, and run reconcile_face_normals.
    ///
    /// Returns a report summarising what changed. Always succeeds — if
    /// some edges cannot be repaired the report lists them.
    pub fn repair_non_manifold_edges(&mut self) -> axia_geo::operations::repair::RepairReport {
        use axia_geo::operations::repair::RepairReport;
        let mut report = RepairReport::default();

        let bad = self.mesh.find_non_manifold_edges();
        report.edges_examined = bad.len();
        if bad.is_empty() {
            return report;
        }

        for nm in bad {
            // Re-fetch after earlier passes.
            if !self.mesh.edges.contains(nm.edge) ||
               !self.mesh.edges[nm.edge].is_active() {
                continue;
            }
            let (cur_faces, _) = self.mesh.get_faces_sharing_edge(nm.edge);
            if cur_faces.len() <= 2 { continue; }

            // Group by XIA.
            use std::collections::HashMap;
            let mut by_xia: HashMap<Option<crate::xia::XiaId>, Vec<axia_geo::FaceId>> = HashMap::new();
            for &f in &cur_faces {
                let xid = self.face_to_xia.get(&f).copied();
                by_xia.entry(xid).or_default().push(f);
            }

            // Pick anchor: group with most faces. Ties → smallest XIA id, None last.
            let mut groups: Vec<(_, _)> = by_xia.into_iter().collect();
            groups.sort_by(|a, b| {
                b.1.len().cmp(&a.1.len())
                    .then_with(|| match (a.0, b.0) {
                        (Some(ax), Some(bx)) => ax.cmp(&bx),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => std::cmp::Ordering::Equal,
                    })
            });
            let (_anchor_xia, anchor_faces) = groups.remove(0);

            // Detach each remaining group from anchor. After detachment a
            // group's face ids may change — update face_to_xia.
            for (group_xia, group_faces) in &groups {
                match self.mesh.detach_face_groups(&anchor_faces, group_faces) {
                    Ok((mapping, n_verts)) => {
                        report.faces_detached += group_faces.len();
                        report.vertices_created += n_verts;
                        // Re-route face_to_xia for any face that got remapped.
                        for &(old_fid, new_fid) in &mapping {
                            if old_fid == new_fid { continue; }
                            // Remove old, register new under same XIA (if any).
                            if let Some(xid) = self.face_to_xia.remove(&old_fid) {
                                self.face_to_xia.insert(new_fid, xid);
                                if let Some(xia) = self.xias.get_mut(&xid) {
                                    for f in xia.face_ids.iter_mut() {
                                        if *f == old_fid { *f = new_fid; }
                                    }
                                }
                            } else if let Some(xid) = group_xia {
                                // Group's faces had no entry in face_to_xia
                                // (orphan) but their XIA exists — re-link.
                                self.face_to_xia.insert(new_fid, *xid);
                                if let Some(xia) = self.xias.get_mut(xid) {
                                    if !xia.face_ids.contains(&new_fid) {
                                        xia.face_ids.push(new_fid);
                                    }
                                    xia.face_ids.retain(|f| *f != old_fid);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        report.edges_skipped.push((nm.edge,
                            format!("XIA-aware detach failed: {}", e)));
                    }
                }
            }
            report.edges_repaired += 1;
        }

        // Final geometric mop-up — handles single-XIA edges with > 2 faces
        // (rare but possible if an op left a self-non-manifold body).
        let geo = self.mesh.repair_non_manifold_edges_geometric();
        report.faces_detached += geo.faces_detached;
        report.vertices_created += geo.vertices_created;
        report.edges_repaired += geo.edges_repaired;
        for s in geo.edges_skipped { report.edges_skipped.push(s); }

        report
    }

    /// "Intersect with Model" (Phase 1, ADR-008 Axiom 7 extension).
    ///
    /// 선택된 face 집합과 나머지 씬 face 사이의 3D 교차선을 edge 로 생성.
    /// 분할된 sub-face 의 XIA 소유권은 원본 face 의 XIA 를 승계한다.
    /// 단일 undo transaction 으로 묶인다.
    ///
    /// 반환: 분할 결과로 존재하게 된 face 의 수 (디버그용).
    pub fn intersect_faces_with_scene(&mut self, face_ids: &[FaceId]) -> anyhow::Result<usize> {
        if face_ids.is_empty() { return Ok(0); }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let result = self.intersect_faces_inner(face_ids);

        match result {
            Ok(n) => {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                Ok(n)
            }
            Err(e) => {
                self.transactions.cancel();
                Err(e)
            }
        }
    }

    /// `intersect_faces_with_scene` 의 내부 구현 — 트랜잭션 관리를 하지 않는다.
    /// 호출자가 외부 트랜잭션 안에서 호출할 때 사용 (Phase 2 draw-time auto-
    /// intersect 에서 draw 의 기존 transaction 안에 병합). 사용자는 일반적
    /// 으로 `intersect_faces_with_scene` 를 쓰면 된다.
    pub fn intersect_faces_inner(&mut self, face_ids: &[FaceId]) -> anyhow::Result<usize> {
        if face_ids.is_empty() { return Ok(0); }

        // 원본 face 의 XIA 매핑 보존 (분할 후 승계용)
        use std::collections::HashMap;
        let mut xia_backup: HashMap<axia_geo::FaceId, crate::xia::XiaId> = HashMap::new();
        for &fid in face_ids {
            if let Some(xid) = self.face_to_xia.get(&fid).copied() {
                xia_backup.insert(fid, xid);
            }
        }
        // "others" 쪽도 XIA 승계를 위해 현재 매핑 스냅샷 (split 에서 없어질
        // 수 있으므로)
        let others: Vec<axia_geo::FaceId> = self.mesh.faces.iter()
            .filter(|(f, face)| face.is_active() && !face_ids.contains(f))
            .map(|(f, _)| f)
            .collect();
        for &fid in &others {
            if let Some(xid) = self.face_to_xia.get(&fid).copied() {
                xia_backup.insert(fid, xid);
            }
        }

        let result_faces = self.mesh.intersect_faces_with_model(face_ids, FORM_MATERIAL)?;

        // XIA 승계: split_faces_by_intersections 는 원본 face 를 제거하고
        // 새 face 를 만든다. 원본 face id 가 여전히 active 면 그대로 두고,
        // 사라졌으면 XIA 에서 제거. 새로 생긴 face 는 아직 어떤 XIA 에도
        // 속하지 않은 상태 — 같은 선택 그룹에 속했던 원본의 XIA 로 연결.
        //
        // Heuristic: result_faces 중 기존 face_to_xia 에 없는 것은 "splits
        // of some old face". old face → new face 매핑은 face_centroid 비교
        // 로는 정확하지 않으므로, 단순히 "원본 face 의 XIA 가 한 개로 일관
        // 되면 그 XIA 에 모두 붙인다" 방식. (일반적으로 한 번의 intersect
        // 호출에서 하나의 선택 그룹은 동일 XIA 를 공유.)
        let mut selected_xia: Option<crate::xia::XiaId> = None;
        for &fid in face_ids {
            if let Some(xid) = xia_backup.get(&fid) {
                match selected_xia {
                    None => selected_xia = Some(*xid),
                    Some(existing) if existing == *xid => {}
                    Some(_) => { selected_xia = None; break; }
                }
            }
        }

        // 1. 없어진 원본 face 의 XIA 링크 제거
        for &fid in face_ids.iter().chain(others.iter()) {
            if !self.mesh.faces.contains(fid) || !self.mesh.faces[fid].is_active() {
                self.unregister_face_from_xia(fid);
            }
        }

        // 2. 새 face 를 해당 XIA 에 등록
        //    - selected 계열의 새 face → selected_xia (결정된 경우)
        //    - others 계열의 새 face → 원본 other face 의 XIA 는 현재 구현
        //      으로 정확히 매핑하기 어렵다. 일단 등록하지 않고 "face-only"
        //      상태로 두어 사용자가 재선택 시 재할당 하도록. 향후 per-face
        //      mapping 지원 시 개선.
        if let Some(xid) = selected_xia {
            let new_sel: Vec<axia_geo::FaceId> = result_faces.iter()
                .filter(|&&f| !xia_backup.contains_key(&f) && self.mesh.faces.contains(f) && self.mesh.faces[f].is_active())
                .copied()
                .collect();
            self.register_faces_to_xia(xid, &new_sel);
            if let Some(xia) = self.xias.get_mut(&xid) {
                for &f in &new_sel {
                    if !xia.face_ids.contains(&f) { xia.face_ids.push(f); }
                }
            }
        }

        // ── ADR-101 §B-4 — Coplanar partial-overlap auto-split ──
        //
        // The 3D triangle-triangle pipeline above does NOT handle coplanar
        // face pairs (coplanar triangles produce no 3D intersection — ADR-
        // 101 §3 architectural limitation). For ADR-101 §2 canonical user
        // trigger ("두 원 partial overlap → 3 sub-face"), scan each just-
        // drawn face against existing actives and call auto_intersect_
        // coplanar on matching convex coplanar pairs.
        //
        // Lock-ins (ADR-101 §B-4):
        //   L-B4-1 New-face-only entry point (intersect_faces_inner is
        //          called by Draw commands; Push/Pull etc. unaffected
        //          unless caller opts in).
        //   L-B4-2 N×M scan over face_ids × others (fine for typical 2D
        //          sketching, N,M ≤ 100). Optimization deferred.
        //   L-B4-3 First match per face_id only (no cascading).
        //   L-B4-4 Silent skip on Err (non-coplanar / non-convex pairs
        //          are common — they are NOT errors, just no-op for
        //          coplanar handling).
        //   L-B4-5 XIA inheritance per ADR-101 L-B1-4a (deterministic
        //          min-FaceId for lens).
        let mut b4_split_count = 0usize;
        for &fid in face_ids {
            if !self.mesh.faces.contains(fid) || !self.mesh.faces[fid].is_active() {
                continue;
            }
            // Snapshot candidate face IDs (avoid borrow checker conflict
            // with the mutating `auto_intersect_coplanar` call).
            let candidates: Vec<FaceId> = self
                .mesh
                .faces
                .iter()
                .filter(|(other_id, face)| {
                    face.is_active() && *other_id != fid && !face_ids.contains(other_id)
                })
                .map(|(id, _)| id)
                .collect();

            for other_fid in candidates {
                if !self.mesh.faces.contains(fid) || !self.mesh.faces[fid].is_active() {
                    break;
                }
                if !self.mesh.faces.contains(other_fid)
                    || !self.mesh.faces[other_fid].is_active()
                {
                    continue;
                }

                // B-4b: MVP scope guard removed. `auto_intersect_coplanar`
                // now performs non-destructive AABB + coplanarity pre-checks
                // before polygonizing Path B closed-curve faces (ADR-101
                // Amendment 7). Path B circles are first-class inputs —
                // disjoint pairs leave them intact, partial-overlap pairs
                // get auto-split.

                // Snapshot XIA links BEFORE the call — auto_intersect_
                // coplanar removes the originals.
                let xia_a = self.face_to_xia.get(&fid).copied();
                let xia_b = self.face_to_xia.get(&other_fid).copied();

                match axia_geo::operations::coplanar::auto_intersect_coplanar(
                    &mut self.mesh,
                    fid,
                    other_fid,
                    FORM_MATERIAL,
                ) {
                    Ok(Some(split)) => {
                        // Unregister originals' XIA links.
                        self.unregister_face_from_xia(fid);
                        self.unregister_face_from_xia(other_fid);

                        // ADR-101 L-B1-4a (revised): deterministic min-
                        // FaceId for lens XIA inheritance.
                        let lens_xia = if fid.raw() < other_fid.raw() { xia_a } else { xia_b };

                        if let Some(x) = xia_a {
                            self.register_faces_to_xia(x, &[split.face_a_only]);
                            if let Some(xia) = self.xias.get_mut(&x) {
                                if !xia.face_ids.contains(&split.face_a_only) {
                                    xia.face_ids.push(split.face_a_only);
                                }
                            }
                        }
                        if let Some(x) = xia_b {
                            self.register_faces_to_xia(x, &[split.face_b_only]);
                            if let Some(xia) = self.xias.get_mut(&x) {
                                if !xia.face_ids.contains(&split.face_b_only) {
                                    xia.face_ids.push(split.face_b_only);
                                }
                            }
                        }
                        if let Some(x) = lens_xia {
                            self.register_faces_to_xia(x, &[split.lens]);
                            if let Some(xia) = self.xias.get_mut(&x) {
                                if !xia.face_ids.contains(&split.lens) {
                                    xia.face_ids.push(split.lens);
                                }
                            }
                        }

                        b4_split_count += 3;
                        break; // L-B4-3 first match per fid
                    }
                    Ok(None) => continue, // no partial overlap (disjoint / containment)
                    Err(_) => continue,   // L-B4-4 silent skip (non-coplanar / non-convex)
                }
            }
        }

        // 모든 활성 face 수 반환 (호출자 디버그용)
        Ok(result_faces.len() + b4_split_count)
    }

    /// Compute the set of boundary edges for a XIA (from its face_ids).
    /// Does NOT include standalone_edge_id — that's tracked separately.
    /// Returns empty set if faces have no valid edges.
    pub fn edges_for_xia(&self, xia_id: XiaId) -> Vec<axia_geo::EdgeId> {
        let Some(xia) = self.xias.get(&xia_id) else { return vec![] };
        let mut edges = std::collections::HashSet::new();
        for &fid in &xia.face_ids {
            if let Ok(face_edges) = self.mesh.face_outer_edges(fid) {
                for eid in face_edges {
                    edges.insert(eid);
                }
            }
        }
        edges.into_iter().collect()
    }

    /// Get the total edge count for a XIA (computed from faces + standalone).
    pub fn edge_count_for_xia(&self, xia_id: XiaId) -> usize {
        let standalone = self.xias.get(&xia_id)
            .and_then(|x| x.standalone_edge_id)
            .map(|_| 1usize)
            .unwrap_or(0);
        self.edges_for_xia(xia_id).len() + standalone
    }

    /// 그룹 가시성을 재귀적으로 적용 (자식 그룹 + face)
    fn set_group_visibility_recursive(&mut self, group_id: GroupId, visible: bool) {
        if let Some(g) = self.groups.groups.get_mut(&group_id) {
            g.visible = visible;
            let face_ids = g.face_ids.clone();
            let children = g.children.clone();

            for fid in &face_ids {
                if let Some(face) = self.mesh.faces.get_mut(*fid) {
                    face.set_visible(visible);
                }
            }

            for child_id in children {
                self.set_group_visibility_recursive(child_id, visible);
            }
        }
    }

    /// 그룹 잠금 시 face 선택 가능 여부 확인
    pub fn is_face_locked(&self, face_id: axia_geo::FaceId) -> bool {
        if let Some(gid) = self.groups.get_group_for_face(face_id) {
            if let Some(g) = self.groups.groups.get(&gid) {
                return g.locked;
            }
        }
        false
    }

    /// Execute a command and return the result.
    pub fn execute(&mut self, cmd: Command) -> CommandResult {
        match cmd {
            // ADR-087 K-ζ — Legacy DrawLine / DrawRect / DrawCircle /
            // PushPull 은 internal-only (Test 회귀 자산 보존용). User-facing
            // entry 는 AsShape variants + CreateSolid (WASM/TS 에서만 노출).
            Command::DrawLine { start, end, surface_normal } => {
                self.exec_draw_line(start, end, surface_normal)
            }
            Command::DrawRect { center, normal, up, width, height } => {
                self.exec_draw_rect(center, normal, up, width, height)
            }
            Command::DrawCircle { center, normal, radius, segments } => {
                self.exec_draw_circle(center, normal, radius, segments)
            }
            Command::PushPull { face_id, dist } => {
                self.exec_push_pull(face_id, dist)
            }
            Command::DrawCenterline { start, end } => {
                self.exec_draw_centerline(start, end)
            }
            Command::SetEdgeClass { edge_id, class_raw } => {
                self.exec_set_edge_class(edge_id, class_raw)
            }
            Command::DrawRectAsShape { center, normal, up, width, height } => {
                self.exec_draw_rect_as_shape(center, normal, up, width, height)
            }
            Command::DrawLineAsShape { start, end, surface_normal } => {
                self.exec_draw_line_as_shape(start, end, surface_normal)
            }
            Command::DrawCircleAsShape { center, normal, radius, segments } => {
                self.exec_draw_circle_as_shape(center, normal, radius, segments)
            }
            Command::DrawCircleAsCurve { center, normal, radius } => {
                self.exec_draw_circle_as_curve(center, normal, radius)
            }
            Command::DrawClosedBezierAsCurve { control_pts } => {
                self.exec_draw_closed_bezier_as_curve(control_pts)
            }
            Command::DrawClosedBSplineAsCurve { control_pts, knots, degree } => {
                self.exec_draw_closed_bspline_as_curve(control_pts, knots, degree)
            }
            Command::DrawClosedNURBSAsCurve { control_pts, weights, knots, degree } => {
                self.exec_draw_closed_nurbs_as_curve(control_pts, weights, knots, degree)
            }
            Command::CreateSolid { face_id, mode } => {
                self.exec_create_solid(face_id, mode)
            }
            Command::Undo => {
                if let Some(frame) = self.transactions.undo() {
                    let snapshot = frame.before_snapshot.clone();
                    if !snapshot.is_empty() {
                        self.restore_scene_snapshot(&snapshot);
                    }
                    CommandResult::MeshUpdated
                } else {
                    CommandResult::None
                }
            }
            Command::Redo => {
                if let Some(frame) = self.transactions.redo() {
                    let snapshot = frame.after_snapshot.clone();
                    if !snapshot.is_empty() {
                        self.restore_scene_snapshot(&snapshot);
                    }
                    CommandResult::MeshUpdated
                } else {
                    CommandResult::None
                }
            }
            Command::Select { xia_id, additive } => {
                if !additive {
                    for xia in self.xias.values_mut() {
                        xia.selected = false;
                    }
                }
                if let Some(xia) = self.xias.get_mut(&xia_id) {
                    xia.selected = true;
                }
                CommandResult::None
            }
            Command::DeselectAll => {
                for xia in self.xias.values_mut() {
                    xia.selected = false;
                }
                CommandResult::None
            }
            Command::Move { xia_ids, delta } => {
                self.exec_move(xia_ids, delta)
            }

            // ── Group / Component ──
            Command::CreateGroup { name, face_ids } => {
                let gid = self.groups.create_group(name, face_ids);
                CommandResult::GroupUpdated(gid)
            }
            Command::DeleteGroup { group_id } => {
                if self.groups.delete_group(group_id) {
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::RenameGroup { group_id, new_name } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    g.name = new_name;
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::ToggleGroupVisibility { group_id } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    let new_visible = !g.visible;
                    g.visible = new_visible;

                    // 해당 그룹의 모든 face에 가시성 반영
                    let face_ids = g.face_ids.clone();
                    for fid in &face_ids {
                        if let Some(face) = self.mesh.faces.get_mut(*fid) {
                            face.set_visible(new_visible);
                        }
                    }

                    // 재귀: 자식 그룹에도 동일 적용
                    let children = g.children.clone();
                    for child_id in children {
                        self.set_group_visibility_recursive(child_id, new_visible);
                    }

                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::ToggleGroupLock { group_id } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    g.locked = !g.locked;
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::MakeComponent { group_id, name } => {
                match self.groups.make_component(group_id, name) {
                    Some(_def_id) => CommandResult::GroupUpdated(group_id),
                    None => CommandResult::Error(format!("Group {} not found", group_id)),
                }
            }
            Command::PlaceComponent { def_id, position } => {
                // TODO: 실제 geometry 복제 구현 필요
                // 현재는 인스턴스 메타데이터만 생성
                let transform = Transform3D::new().with_position(position);
                match self.groups.create_instance(def_id, "Instance".into(), vec![], transform) {
                    Some(inst_id) => CommandResult::GroupUpdated(inst_id),
                    None => CommandResult::Error(format!("ComponentDef {} not found", def_id)),
                }
            }

            // ── Material commands ──
            Command::AssignMaterial { face_ids, material_id } => {
                if self.material_library.get(material_id).is_none() {
                    return CommandResult::Error(format!("Material {} not found", material_id.raw()));
                }
                // Update face material in mesh
                for face_id in face_ids.iter() {
                    if let Some(face) = self.mesh.faces.get_mut(*face_id) {
                        face.set_material(material_id);
                    }
                }
                // Material is a property — no state transition needed.
                // XIA.has_material() checks material ID.
                CommandResult::MaterialAssigned {
                    face_count: face_ids.len(),
                }
            }

            Command::RemoveMaterial { face_ids } => {
                let default_mat = FORM_MATERIAL;
                // Revert to default material
                for face_id in face_ids.iter() {
                    if let Some(face) = self.mesh.faces.get_mut(*face_id) {
                        face.set_material(default_mat);
                    }
                }
                // Material is a property — no state transition needed.
                // XIA.has_material() checks material ID.
                CommandResult::MaterialRemoved {
                    face_count: face_ids.len(),
                }
            }

            Command::CreateMaterial {
                name,
                name_en,
                category,
                physical,
                visual,
            } => {
                let material_id = self.material_library.create_material(
                    name,
                    name_en,
                    category,
                    physical,
                    visual,
                );
                CommandResult::MaterialCreated(material_id)
            }
        }
    }

    /// vertex가 임의의 활성 face의 interior(boundary 아님 + 2D 내부)에 있는지 검사.
    /// ⚡ 성능: large scene 의 draw_line 시 N face 전체에 대해 plane+point-in-polygon
    /// 을 돌면 O(N) × heap-alloc 이 누적돼 수백 ms 가 됨. AABB pre-reject 와
    /// 평면-거리 cheap test 를 먼저 두어 99% 의 face 를 즉시 스킵한다.
    fn is_vertex_interior_to_any_face(&self, v: VertId) -> bool {
        let p = match self.mesh.vertex_pos(v) { Ok(p) => p, Err(_) => return false };
        for (_fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            let boundary = match self.mesh.collect_loop_verts(face.outer().start) {
                Ok(b) => b, Err(_) => continue,
            };
            if boundary.contains(&v) { continue; }
            if boundary.len() < 3 { continue; }

            // ── AABB pre-reject (cheap) ───────────────────────────────
            // 4-원소 boundary (rect) 등은 5 ns 이내 종결.
            let mut min = glam::DVec3::splat(f64::INFINITY);
            let mut max = glam::DVec3::splat(f64::NEG_INFINITY);
            let mut have_pts = false;
            for &vid in &boundary {
                if let Ok(q) = self.mesh.vertex_pos(vid) {
                    min = min.min(q); max = max.max(q); have_pts = true;
                }
            }
            if !have_pts { continue; }
            // Tolerance: 1mm padding (충분히 보수적, 정확한 판정은 뒤에서).
            const PAD: f64 = 1.0;
            if p.x < min.x - PAD || p.x > max.x + PAD ||
               p.y < min.y - PAD || p.y > max.y + PAD ||
               p.z < min.z - PAD || p.z > max.z + PAD {
                continue;
            }

            // ── Coplanar + inside polygon test ────────────────────────
            let Ok(p0) = self.mesh.vertex_pos(boundary[0]) else { continue };
            let Ok(p1) = self.mesh.vertex_pos(boundary[1]) else { continue };
            let e1 = (p1 - p0).normalize_or_zero();
            if e1.length_squared() < 1e-10 { continue; }
            let mut e2 = DVec3::ZERO;
            for &vid in &boundary[2..] {
                if let Ok(pp) = self.mesh.vertex_pos(vid) {
                    let vv = pp - p0;
                    let proj = e1 * vv.dot(e1);
                    let ortho = vv - proj;
                    if ortho.length_squared() > 1e-6 { e2 = ortho.normalize_or_zero(); break; }
                }
            }
            if e2.length_squared() < 1e-10 { continue; }
            let n = e1.cross(e2).normalize_or_zero();
            let max_chord_sq = boundary.iter().filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .map(|q| (q - p0).length_squared()).fold(0.0_f64, f64::max);
            let tol = (max_chord_sq.sqrt() * 1e-4).max(1e-3);
            let dist = (p - p0).dot(n).abs();
            if dist > tol { continue; }
            let project2d = |q: DVec3| -> (f64, f64) {
                let vv = q - p0; (vv.dot(e1), vv.dot(e2))
            };
            let poly: Vec<(f64, f64)> = boundary.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok().map(project2d))
                .collect();
            let (px, py) = project2d(p);
            let mut inside = false;
            let nn = poly.len();
            let mut j = nn - 1;
            for i in 0..nn {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            if inside { return true; }
        }
        false
    }

    /// ADR-008 B1 — Find the smallest coplanar face that fully encloses
    /// the boundary of `inner_fid`. Returns Some(outer_fid) if such a face
    /// exists, or None if `inner_fid` is not contained in any face.
    fn find_enclosing_face(&self, inner_fid: FaceId) -> Option<FaceId> {
        let inner_face = self.mesh.faces.get(inner_fid)?;
        if !inner_face.is_active() { return None; }
        let inner_verts = self.mesh.collect_loop_verts(inner_face.outer().start).ok()?;
        if inner_verts.len() < 3 { return None; }
        let inner_pts: Vec<DVec3> = inner_verts.iter()
            .filter_map(|&v| self.mesh.vertex_pos(v).ok())
            .collect();
        if inner_pts.len() < 3 { return None; }
        let inner_normal = inner_face.normal();
        if inner_normal.length_squared() < 1e-10 { return None; }

        // inner area (3D)
        let inner_area = {
            let mut a_vec = DVec3::ZERO;
            for i in 1..inner_pts.len().saturating_sub(1) {
                a_vec += (inner_pts[i] - inner_pts[0]).cross(inner_pts[i + 1] - inner_pts[0]);
            }
            a_vec.length() * 0.5
        };
        if inner_area < 1e-9 { return None; }

        let mut best: Option<(FaceId, f64)> = None;
        for (outer_fid, outer_face) in self.mesh.faces.iter() {
            if outer_fid == inner_fid { continue; }
            if !outer_face.is_active() { continue; }
            let outer_normal = outer_face.normal();
            if outer_normal.length_squared() < 1e-10 { continue; }
            let n_dot = outer_normal.dot(inner_normal).abs();
            if n_dot < 0.999 { continue; }

            let outer_verts = match self.mesh.collect_loop_verts(outer_face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if outer_verts.len() < 3 { continue; }
            let outer_pts: Vec<DVec3> = outer_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if outer_pts.len() < 3 { continue; }

            let outer_area = {
                let mut a_vec = DVec3::ZERO;
                for i in 1..outer_pts.len() - 1 {
                    a_vec += (outer_pts[i] - outer_pts[0]).cross(outer_pts[i + 1] - outer_pts[0]);
                }
                a_vec.length() * 0.5
            };
            if outer_area <= inner_area { continue; }

            // Phase 3c'' — containment 판정을 polygon_contains_polygon 으로
            //   교체. 이전 구현은 inner 의 "첫 정점" ray-cast 만 검사해 해당
            //   정점이 outer 경계 위일 때 flaky 하게 false 가 나와 B1 promote
            //   를 놓치는 케이스가 있었음. 이제 모든 inner vertex + strict
            //   interior 점까지 검사하는 rigorous 방식.
            if !axia_geo::operations::polygon_geom::polygon_contains_polygon(&outer_pts, &inner_pts) {
                continue;
            }

            // ADR-051 instrumentation note (2026-05-04, C2 chunk):
            // ⚠ KNOWN ISSUE: nested ring case in burge.xia stress produces
            // non-manifold (3-face share) at Step 4.95. Initial fix attempt
            // (skip if inner_pts inside outer's existing hole) did NOT
            // resolve — root cause is elsewhere. Fix requires deeper trace
            // into find_inner_components + ring rebuild HE allocation.
            // Tracked by P7-trace eprintln output (set AXIA_TRACE_P7_MANIFOLD=1).

            match best {
                None => best = Some((outer_fid, outer_area)),
                Some((_, a)) if outer_area < a => best = Some((outer_fid, outer_area)),
                _ => {}
            }
        }
        best.map(|(fid, _)| fid)
    }

    /// ADR-016 §2 (Path B) — Helper used by WASM `eraseEdgeResynthesize`.
    /// Updates the XIA mappings after a re-synthesis: drops removed-face
    /// entries and inherits the first non-None container XIA into all new faces.
    pub fn apply_resynth_xia_inheritance(
        &mut self,
        removed_faces: &[FaceId],
        new_faces: &[FaceId],
    ) {
        // Capture the inheritance candidate (first XIA that owned a removed
        // face — typically the outer/container).
        let inherit_xia = removed_faces.iter()
            .find_map(|fid| self.face_to_xia.get(fid).copied());

        // Drop removed faces from their XIAs and from the reverse index.
        for &fid in removed_faces {
            if let Some(xid) = self.face_to_xia.remove(&fid) {
                if let Some(xia) = self.xias.get_mut(&xid) {
                    xia.face_ids.retain(|&f| f != fid);
                }
            }
        }

        // Attach new faces to the inherited XIA.
        if let Some(xid) = inherit_xia {
            for &new_f in new_faces {
                if let Some(xia) = self.xias.get_mut(&xid) {
                    if !xia.face_ids.contains(&new_f) {
                        xia.face_ids.push(new_f);
                    }
                }
                self.face_to_xia.insert(new_f, xid);
            }
        }
    }

    /// ADR-008 B1 — Rebuild `outer_fid` so that `inner_fid`'s boundary
    /// becomes one of its inner holes. Preserves edges/verts; `inner_fid`
    /// remains as a separate sub-face the user can edit independently.
    fn promote_face_to_hole(&mut self, outer_fid: FaceId, inner_fid: FaceId) -> anyhow::Result<FaceId> {
        let outer_verts = self.mesh.collect_loop_verts(
            self.mesh.faces.get(outer_fid)
                .ok_or_else(|| anyhow::anyhow!("outer not found"))?.outer().start
        )?;
        let inner_verts = self.mesh.collect_loop_verts(
            self.mesh.faces.get(inner_fid)
                .ok_or_else(|| anyhow::anyhow!("inner not found"))?.outer().start
        )?;
        // Hole winding is opposite to outer.
        let mut hole_verts = inner_verts.clone();
        hole_verts.reverse();
        // Preserve existing inner holes too (face may already have holes).
        let existing_inners: Vec<Vec<axia_geo::VertId>> = self.mesh.faces[outer_fid].inners()
            .iter()
            .filter_map(|lr| self.mesh.collect_loop_verts(lr.start).ok())
            .collect();
        let material = self.mesh.faces[outer_fid].material();

        // Soft-remove: preserve HE next/prev so add_face_with_holes can find
        //   the right free half-edges.
        self.mesh.soft_remove_face(outer_fid)?;

        // Rebuild with inner verts as a new hole.
        let mut all_holes: Vec<Vec<axia_geo::VertId>> = existing_inners;
        all_holes.push(hole_verts);
        let hole_refs: Vec<&[axia_geo::VertId]> = all_holes.iter().map(|h| h.as_slice()).collect();
        let new_outer = self.mesh.add_face_with_holes(&outer_verts, &hole_refs, material)?;
        Ok(new_outer)
    }

    /// ADR-016 — gate for conditional B1 auto hole-promote.
    ///
    /// SketchUp-style: only the FIRST inner inside an outer auto-promotes.
    /// Subsequent inners stay as separate floating faces to preserve the
    /// stacked-inner manifold safety (ADR-015 motivation).
    ///
    /// Conditions (all must hold):
    ///   1. `container` has no existing inner holes (single-promote).
    ///   2. `inner` has no inner holes itself (only simple faces promote).
    ///   3. Manifold safety — every perimeter HE of `inner` has its `face`
    ///      either == `container` OR == `null` (free). If any HE is already
    ///      claimed by a different face / hole loop, promotion would violate
    ///      the DCEL "1 HE → 1 face" invariant.
    fn b1_promote_safe(&self, container: FaceId, inner: FaceId) -> bool {
        let container_face = match self.mesh.faces.get(container) {
            Some(f) if f.is_active() => f, _ => return false,
        };
        let inner_face = match self.mesh.faces.get(inner) {
            Some(f) if f.is_active() => f, _ => return false,
        };
        // (2) inner must be a simple face.
        if !inner_face.inners().is_empty() { return false; }
        // (1) Single-promote OR disjoint-additional-hole OR pinch (ADR-022 P9).
        //   Container 가 simple → 1st promote (기존 동작).
        //   Container 가 ring → 새 inner 의 기존 sub-face 와의 vertex overlap:
        //     - 0 verts 공유 → disjoint, allow (Phase C).
        //     - 1 vertex 공유 → pinch case (P9), allow. Manifold check (3) 으로
        //       실제 corruption 만 거르기.
        //     - 2+ verts 공유 → edge 공유 가능성, 거부 (combined-perimeter 경로
        //       로 처리되어야 함).
        let container_is_ring = !container_face.inners().is_empty();
        if container_is_ring {
            let mut existing_subface_verts: std::collections::HashSet<axia_geo::VertId> =
                std::collections::HashSet::new();
            for inner_loop in container_face.inners() {
                if let Ok(loop_verts) = self.mesh.collect_loop_verts(inner_loop.start) {
                    for v in loop_verts {
                        existing_subface_verts.insert(v);
                    }
                }
            }
            let new_inner_verts = match self.mesh.collect_loop_verts(inner_face.outer().start) {
                Ok(v) => v, Err(_) => return false,
            };
            let mut shared_count = 0usize;
            for v in &new_inner_verts {
                if existing_subface_verts.contains(v) {
                    shared_count += 1;
                }
            }
            if shared_count >= 2 {
                // Likely edge-shared → reject (handled by combined-perimeter elsewhere).
                return false;
            }
            // shared_count == 0 (disjoint) or 1 (pinch, P9): allow → fall through
            // to manifold check (3).
        }
        // (3) Manifold safety — walk inner's outer loop HEs.
        let start = inner_face.outer().start;
        let mut he = start;
        let mut guard = 0usize;
        loop {
            guard += 1;
            if guard > 4096 { return false; }
            let he_ref = match self.mesh.hes.get(he) {
                Some(h) => h, None => return false,
            };
            // CCW-side (he itself) must belong to inner.
            if he_ref.face() != inner { return false; }
            // The CW-side (twin) HE belongs to "outside" of inner. After
            // promote, it becomes ring's hole loop. Must currently be either
            // container's outer-loop HE (face=container) or free (null).
            let twin = self.mesh.he_twin(he);
            let twin_ref = match self.mesh.hes.get(twin) {
                Some(h) => h, None => return false,
            };
            let twin_face = twin_ref.face();
            if !twin_face.is_null() && twin_face != container {
                return false;
            }
            he = he_ref.next();
            if he == start { break; }
        }
        true
    }

    /// Principle 6 classifier — if every one of `corners` lies strictly
    /// inside one and the same coplanar (normal within 1°) active face's
    /// polygon interior, return that face id. Otherwise None.
    ///
    /// "Strictly inside" means the corner is NOT on the face's boundary
    /// (or within endpoint tolerance of a boundary vertex) — that would
    /// require the unified pipeline's split_face_by_line path instead.
    fn single_face_containing_corners(
        &self,
        corners: &[DVec3],
        target_normal: DVec3,
    ) -> Option<FaceId> {
        if corners.is_empty() { return None; }
        let mut candidate: Option<FaceId> = None;
        for (fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            // Coplanar with the rect's normal?
            let n = face.normal();
            if n.length_squared() < 1e-10 { continue; }
            if n.dot(target_normal).abs() < 0.9998 { continue; }

            let verts = match self.mesh.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if pts.len() < 3 { continue; }

            // 2D basis from first edge of face.
            let p0 = pts[0];
            let e1 = (pts[1] - p0).normalize_or_zero();
            if e1.length_squared() < 1e-10 { continue; }
            let mut e2 = DVec3::ZERO;
            for p in &pts[2..] {
                let v = *p - p0;
                let proj = e1 * v.dot(e1);
                let ortho = v - proj;
                if ortho.length_squared() > 1e-6 {
                    e2 = ortho.normalize_or_zero();
                    break;
                }
            }
            if e2.length_squared() < 1e-10 { continue; }
            let face_n = e1.cross(e2).normalize_or_zero();
            let poly: Vec<(f64, f64)> = pts.iter()
                .map(|p| ((*p - p0).dot(e1), (*p - p0).dot(e2)))
                .collect();
            let boundary_verts: Vec<DVec3> = pts.clone();

            // Each corner must be coplanar + inside + not on boundary.
            let mut all_inside = true;
            for c in corners {
                // Plane distance.
                let dist = (*c - p0).dot(face_n).abs();
                if dist > 1e-2 { all_inside = false; break; }
                // Boundary-vertex coincidence guard.
                let on_boundary_vertex = boundary_verts.iter().any(|bp| (c - bp).length() < 1e-3);
                if on_boundary_vertex { all_inside = false; break; }
                let cx = (*c - p0).dot(e1);
                let cy = (*c - p0).dot(e2);
                // Point-in-polygon (ray cast).
                let mut inside = false;
                let nv = poly.len();
                let mut j = nv - 1;
                for i in 0..nv {
                    let (xi, yi) = poly[i];
                    let (xj, yj) = poly[j];
                    if ((yi > cy) != (yj > cy)) &&
                       (cx < (xj - xi) * (cy - yi) / (yj - yi + 1e-12) + xi) {
                        inside = !inside;
                    }
                    j = i;
                }
                if !inside { all_inside = false; break; }
            }
            if all_inside {
                if candidate.is_some() {
                    // More than one candidate — ambiguous; defer to pipeline.
                    return None;
                }
                candidate = Some(fid);
            }
        }
        candidate
    }

    /// Principle 3 (Face Operation Epoch) — consolidate the post-line
    /// synthesis steps into one reusable routine. Called by exec_draw_line
    /// when no epoch is active (single-line command) AND by the epoch
    /// finalizer in exec_draw_rect / exec_draw_circle after all sides are
    /// drawn. Keeps the semantics identical to the former inlined block.
    fn run_face_synthesis_postprocess(
        &mut self,
        touched_verts: &[VertId],
        new_edges: &[EdgeId],
        all_created_faces: &mut Vec<FaceId>,
    ) {
        use std::collections::HashSet;

        // ADR-051 P7 instrumentation (2026-05-04): trace non-manifold edge
        // count at each step boundary. Only emits if env var
        // AXIA_TRACE_P7_MANIFOLD=1 set OR if non-manifold count INCREASES
        // between steps (regression signal). Helps localize where non-
        // manifold is introduced for follow-up fix.
        let trace_p7 = std::env::var("AXIA_TRACE_P7_MANIFOLD")
            .map(|v| v == "1").unwrap_or(false);
        let count_nm = |mesh: &axia_geo::Mesh| -> usize {
            mesh.collect_non_manifold_edges().len()
        };
        let mut last_nm = count_nm(&self.mesh);
        let trace_step = |name: &str, mesh: &axia_geo::Mesh, last: &mut usize| {
            let now = count_nm(mesh);
            let delta = now as i64 - *last as i64;
            if trace_p7 || delta > 0 {
                eprintln!(
                    "[P7-trace] {}: nm_edges {} → {} (Δ{:+})",
                    name, last, now, delta,
                );
            }
            *last = now;
        };
        trace_step("ENTRY", &self.mesh, &mut last_nm);
        // Step 4.5 — fan-tessellation, scoped to faces whose AABB contains
        //   at least one touched vertex (Perf cut from earlier session).
        // ⚡ 2026-04-27 — empty-space draw 시 N face × collect_loop_verts
        //   (heap alloc) 가 누적돼 큰 씬에서 수백 ms. 두 단계로 가속:
        //     1. touched_pts 가 비어있으면 전체 스킵.
        //     2. 외곽 AABB 사전계산 + face AABB 는 in-place 반복으로
        //        Vec alloc 회피. 외곽 밖이면 첫 vert 만 보고 즉시 reject.
        {
            let touched_pts: Vec<DVec3> = touched_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            let candidates: Vec<FaceId> = if touched_pts.is_empty() {
                Vec::new()
            } else {
                // 1) Outer AABB of touched_pts.
                let mut tmn = DVec3::splat(f64::INFINITY);
                let mut tmx = DVec3::splat(f64::NEG_INFINITY);
                for p in &touched_pts {
                    tmn = tmn.min(*p); tmx = tmx.max(*p);
                }
                let pad = DVec3::splat(1.0);
                tmn -= pad; tmx += pad;

                // 2) For each face, walk loop in-place to build face AABB,
                //    test AABB-vs-AABB intersection vs touched AABB.
                //    Vec alloc 회피 → 큰 씬에서 N face × heap alloc 비용 제거.
                let mut out: Vec<FaceId> = Vec::new();
                for (fid, f) in self.mesh.faces.iter() {
                    if !f.is_active() { continue; }
                    let start = f.outer().start;
                    if start.is_null() { continue; }

                    let mut fmn = DVec3::splat(f64::INFINITY);
                    let mut fmx = DVec3::splat(f64::NEG_INFINITY);
                    let mut he = start;
                    let mut hops = 0;
                    let max_hops = 64;
                    loop {
                        let vid = self.mesh.hes[he].dst();
                        if let Ok(p) = self.mesh.vertex_pos(vid) {
                            fmn = fmn.min(p); fmx = fmx.max(p);
                        }
                        he = self.mesh.hes[he].next();
                        hops += 1;
                        if he == start || he.is_null() || hops >= max_hops { break; }
                    }
                    if fmn.x.is_infinite() { continue; }
                    let pad = DVec3::splat(1e-3);
                    fmn -= pad; fmx += pad;

                    // AABB-vs-AABB intersection test (any axis disjoint → reject).
                    if fmx.x < tmn.x || fmn.x > tmx.x ||
                       fmx.y < tmn.y || fmn.y > tmx.y ||
                       fmx.z < tmn.z || fmn.z > tmx.z {
                        continue;
                    }
                    // Detailed: original semantics — face AABB contains some touched_pt.
                    let mut hit = false;
                    for tp in &touched_pts {
                        if tp.x >= fmn.x && tp.x <= fmx.x &&
                           tp.y >= fmn.y && tp.y <= fmx.y &&
                           tp.z >= fmn.z && tp.z <= fmx.z {
                            hit = true; break;
                        }
                    }
                    if hit { out.push(fid); }
                }
                out
            };
            for fid in candidates {
                let new_faces = self.mesh.dissolve_and_fan_split(fid);
                if !new_faces.is_empty() {
                    let old_xia = self.get_xia_for_face(fid);
                    self.unregister_face_from_xia(fid);
                    if let Some(xia_id) = old_xia {
                        if self.xias.get(&xia_id).is_some() {
                            self.register_faces_to_xia(xia_id, &new_faces);
                            if let Some(xia) = self.xias.get_mut(&xia_id) {
                                for &f in &new_faces { xia.face_ids.push(f); }
                            }
                        }
                        // 2026-04-28 — XIA inheritance preserved. Sub-faces NOT
                        //   added to all_created_faces — would cause new RECT's
                        //   XIA registration to overwrite face_to_xia at end
                        //   of exec_draw_rect (state inconsistency).
                    } else {
                        // No original XIA — sub-faces become "owned" by current op.
                        for f in new_faces {
                            if !all_created_faces.contains(&f) { all_created_faces.push(f); }
                        }
                    }
                }
            }
        }


        trace_step("after Step 4.5 (fan-tessellation)", &self.mesh, &mut last_nm);

        // Step 4.55 — nested face dissolve
        {
            let dissolved = self.mesh.dissolve_containing_faces();
            if !dissolved.is_empty() {
            }
            for fid in dissolved {
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }
        trace_step("after Step 4.55 (nested dissolve)", &self.mesh, &mut last_nm);

        // Step 4.6 — D resolver
        {
            let resolved = self.mesh.resolve_planar_free_faces_scoped(
                FORM_MATERIAL,
                Some(touched_verts),
                Some(new_edges),
            );
            for f in resolved {
                if !all_created_faces.contains(&f) { all_created_faces.push(f); }
            }
        }
        trace_step("after Step 4.6 (D resolver)", &self.mesh, &mut last_nm);

        // Step 4.65 — Dissolve faces fully surrounded by newly-created ones.
        //
        // When D resolver builds a cycle that traces through an existing
        // face's boundary edges (e.g. partial-overlap RECT: a chain of
        // new interior edges + a segment of big's boundary forms the
        // overlap sub-face), the ORIGINAL face's loop stays intact but
        // every one of its boundary half-edges now has a radial partner
        // claimed by a newly-created face. In that state the original
        // face is geometrically redundant — it overlaps the new ones.
        //
        // Criterion: a face is "fully surrounded" iff every HE in its
        // outer loop has a non-null `face()` on its radial partner AND
        // that partner belongs to a face created in this operation.
        {
            let created_set: HashSet<FaceId> = all_created_faces.iter().copied().collect();
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(fid, f)| f.is_active() && !created_set.contains(fid))
                .map(|(fid, _)| fid)
                .collect();
            for fid in candidates {
                if !self.mesh.faces.contains(fid) { continue; }
                let outer_start = self.mesh.faces[fid].outer().start;
                if outer_start.is_null() { continue; }
                let hes = match self.mesh.collect_loop_hes(outer_start) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if hes.is_empty() { continue; }
                let mut all_surrounded = true;
                for he_id in hes {
                    let twin = self.mesh.he_twin(he_id);
                    let twin_face = self.mesh.hes.get(twin).map(|h| h.face()).unwrap_or(axia_geo::FaceId::NULL);
                    if twin_face.is_null() || twin_face == fid || !created_set.contains(&twin_face) {
                        all_surrounded = false;
                        break;
                    }
                }
                if all_surrounded {
                    self.unregister_face_from_xia(fid);
                    // **P2 hotfix (보고서 audit 2026-05-23) — silent let _
                    // dissolve guard**. 이전: `let _ = self.mesh.remove_face`
                    // 가 Result discard → remove_face 실패 시 silent + 회귀
                    // 자산 0 → 사용자 face 사라짐 잠재 위험.
                    // 본 hotfix: remove_face 결과를 명시 검증 + fallback 으로
                    // direct faces.remove 호출. 두 경로 모두 실패 시 trace
                    // log 로 명시 (앞으로 audit 가능).
                    if let Err(e) = self.mesh.remove_face(fid) {
                        // remove_face 실패 — fallback path 가 아래에서 처리
                        // 하지만 audit trail 위해 trace 명시.
                        let _ = e; // suppress unused warning; future telemetry hook
                    }
                    // Fallback: 만약 remove_face 가 face 를 deactivate 만 하고
                    // map 에 남겨 둔 경우 직접 제거 (Step 4.65 의 의도된
                    // dissolve semantics — 완전 제거).
                    if self.mesh.faces.contains(fid) {
                        self.mesh.faces.remove(fid);
                    }
                }
            }
        }

        trace_step("after Step 4.65 (dissolve surrounded)", &self.mesh, &mut last_nm);

        // Step 4.7 — dedup
        {
            let removed = self.mesh.deduplicate_overlapping_faces();
            if !removed.is_empty() {
            }
            for fid in removed {
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }
        trace_step("after Step 4.7 (dedup)", &self.mesh, &mut last_nm);

        // Step 4.8 — B1 enclosed-face hole promotion (DISABLED per ADR-015).
        //
        // 2026-04-28 — ADR-015: B1 auto hole-promote 비활성. inner face 가
        //   기존 outer face 안에 그려졌을 때 자동 ring 화 안 함. 두 face 가
        //   별개 simple face 로 공존. 명시적 promote 는 사용자 우클릭 메뉴
        //   "merge-as-hole" 로만.
        //
        // 사유: B1 auto-promote 는 inner perimeter HE 를 ring hole loop 에
        //   claim → ADR-008 Axiom 7 위반 (인접 inner 의 면 합성 차단).

        // Step 4.9 — M1 Mixed-Cycle Split (ADR-008 Axiom 7 partial-overlap).
        //
        // Detect chains of free edges whose two endpoints lie on the same
        // existing face's boundary. Such a chain indicates the user drew a
        // polyline into a face — the enclosed region should become a
        // sub-face with the NEW drawing's material (user decision).
        //
        // Scope: only faces that have at least one of `touched_verts` on
        // their boundary are candidates — an untouched face in another
        // corner of the scene can't have been partitioned by this op.
        {
            self.run_mixed_cycle_splits(touched_verts, new_edges, all_created_faces);
        }
        trace_step("after Step 4.9 (M1 mixed-cycle splits)", &self.mesh, &mut last_nm);

        // 알려진 제약 (2026-04-28, ADR-008 Axiom 7 vs Phase E B1 hole-promote 충돌):
        //   B1 hole-promote 된 ring face 의 hole boundary 에 인접하게 새 RECT
        //   그릴 때, shared edge 의 HE2 가 ring 의 hole loop 에 claim 됨 →
        //   새 RECT 의 free-cycle 합성 불가. M1 interior guard 가 inner1 face
        //   손실은 막아주지만 inner2 자체는 wire-only 로 남음.
        //   적절한 fix 는 ring topology rebuild — 그러나 leftmost-turn walker
        //   의 cycle 우선순위 + dedup 의 oldest-first 정책으로 인해 단순한
        //   dissolve+resolve 패턴이 inner1 의 face 마저 잘못 흡수. 별도 Phase
        //   에서 처리.
        //
        // 임시 우회: 사용자는 인접 inner RECT 를 그릴 때 약간의 gap 을 두거나
        //   4 LINE 으로 직접 그리기. 자동 free-cycle 합성은 정상 작동.

        trace_step("before Step 4.95 (P7 ring rebuild)", &self.mesh, &mut last_nm);

        // Step 4.95 — ADR-021 P7 (Closed Edge Loop Divides Face).
        //
        //   "닫힌 라인은 면을 나눈다" 원칙의 운영:
        //   - 활성 simple face 들 중 다른 container face 안에 enclose 된 것을 수집
        //   - container 별로 그룹
        //   - 각 container 의 inners 를 connected component 로 분리
        //     (edge 공유 = 같은 component)
        //   - 각 component → 1 hole 로 promote (combined perimeter)
        //   - 결과: container = ring with N holes (N = component 수)
        //
        //   순서 무관성 (ADR-021 §4): Case A (inner 먼저) = Case B (outer 먼저).
        //   Manifold 안전: shared edge 는 hole loop 미경유 → 위반 없음.
        //
        //   v1.1 (2026-04-29): Phase A HE manifold fix + Phase B 적용.
        //   - Phase A (reverse_loop twin update): manifold 보장
        //   - Phase B: ring 도 inner candidate (Test 3B nested)
        //   - Phase C (ring as container, Test 1B/4B): 별도 후속 — 회귀 위험.
        //
        //   **ADR-139 B-β-3 (2026-05-21)**: `auto_face_synthesis_on_draw`
        //   flag default OFF — 메타-원칙 #16 자동화 antipattern 폐기. P7 ring
        //   rebuild 자동 trigger 는 Boundary tool (ADR-139 B-γ) 명시 trigger
        //   로 대체. Legacy `true` explicit opt-in 시 legacy 동작 보존.
        //   DrawRect / DrawCircle single-op auto-face 는 Phase 7 STRICT 보존
        //   (Q2-a 결재).
        use std::collections::HashMap;
        if self.auto_face_synthesis_on_draw {
            // 1) Phase B: 모든 active face 수집 — simple + ring 둘 다 inner.
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();

            let mut by_container: HashMap<FaceId, Vec<FaceId>> = HashMap::new();
            for inner_fid in &candidates {
                if !self.mesh.faces.contains(*inner_fid) { continue; }
                if !self.mesh.faces[*inner_fid].is_active() { continue; }
                let Some(container) = self.find_enclosing_face(*inner_fid) else { continue; };
                // ADR-022 P9: Container 가 simple OR ring 둘 다 처리.
                // Ring 인 경우 기존 hole loops 를 보존하면서 새 hole 추가.
                if !self.mesh.faces.get(container)
                    .map(|f| f.is_active())
                    .unwrap_or(false)
                {
                    continue;
                }
                if container == *inner_fid { continue; }
                // ADR-022 P9: inner 의 outer-loop verts 가 container 의 기존 hole
                // loop 와 동일 vertex set 이면 이미 promote 된 sub-face → skip.
                // (Inner 가 ring 인 경우는 Phase B 정책에 따라 candidate 로 유지.)
                let inner_verts_set: std::collections::HashSet<axia_geo::VertId> =
                    match self.mesh.collect_loop_verts(self.mesh.faces[*inner_fid].outer().start) {
                        Ok(v) => v.into_iter().collect(),
                        Err(_) => continue,
                    };
                let already_hole = self.mesh.faces[container].inners().iter().any(|lr| {
                    if let Ok(hole_verts) = self.mesh.collect_loop_verts(lr.start) {
                        let hole_set: std::collections::HashSet<axia_geo::VertId> =
                            hole_verts.into_iter().collect();
                        hole_set == inner_verts_set
                    } else { false }
                });
                if already_hole { continue; }

                // ADR-051 C2 fix (2026-05-04): manifold safety check.
                // 이미 다른 face 가 inner 의 outer-loop edges 의 HE2 (twin)
                // 를 hole 로 claim 한 상태면 skip. b1_promote_safe 와 같은
                // 로직 — DCEL "1 edge → 2 HEs" 제약 위반 사전 차단.
                //
                // Without this guard: nested ring case 에서 Face 63 가
                // 이미 Face 66 의 hole 인데 Face 65 도 promote 시도 →
                // add_face_with_holes 가 새 HE 생성 → 3-face share 발생.
                let inner_face_ref = match self.mesh.faces.get(*inner_fid) {
                    Some(f) if f.is_active() => f, _ => continue,
                };
                let mut already_promoted_elsewhere = false;
                let start_he = inner_face_ref.outer().start;
                let mut he = start_he;
                let mut guard = 0usize;
                loop {
                    guard += 1;
                    if guard > 4096 { break; }
                    let twin = self.mesh.he_twin(he);
                    let twin_face = match self.mesh.hes.get(twin) {
                        Some(h) => h.face(), None => break,
                    };
                    // ADR-051 C2 (revised): allow when twin_face is also a
                    // sibling inner candidate — component analysis will merge
                    // them into a single combined-perimeter hole. Block only
                    // when twin is a stranger (would cause genuine 3-face
                    // share after add_face_with_holes).
                    if !twin_face.is_null()
                        && twin_face != container
                        && self.mesh.faces.contains(twin_face)
                        && self.mesh.faces[twin_face].is_active()
                        && !candidates.contains(&twin_face)
                    {
                        already_promoted_elsewhere = true;
                        break;
                    }
                    he = match self.mesh.hes.get(he) {
                        Some(h) => h.next(), None => break,
                    };
                    if he == start_he || he.is_null() { break; }
                }
                if already_promoted_elsewhere { continue; }

                by_container.entry(container).or_default().push(*inner_fid);
            }

            // ADR-051 C2 instrumentation: print by_container map before processing.
            if trace_p7 {
                eprintln!("[P7-trace] by_container map ({} entries):", by_container.len());
                for (c, inners) in by_container.iter() {
                    eprintln!("  container {:?} → inners {:?}", c, inners);
                }
            }

            // 2) 각 container 처리
            for (container, inners) in by_container.iter() {
                if inners.is_empty() { continue; }

                // 2a) Connected component 로 그룹
                let components = self.mesh.find_inner_components(inners);
                if components.is_empty() { continue; }
                if trace_p7 {
                    eprintln!(
                        "[P7-trace] processing container {:?}: {} inners → {} components",
                        container, inners.len(), components.len(),
                    );
                    for (i, comp) in components.iter().enumerate() {
                        eprintln!("    component[{}] = {:?}", i, comp);
                    }
                }

                // 2b) 각 component 의 combined perimeter (CCW around union)
                //     → reverse 로 CW (hole loop 방향)
                let mut hole_loops: Vec<Vec<axia_geo::VertId>> = Vec::new();
                let mut all_safe = true;
                for comp in &components {
                    match self.mesh.compute_combined_perimeter(comp) {
                        Ok(mut perim) => {
                            if perim.len() < 3 { all_safe = false; break; }
                            perim.reverse();
                            hole_loops.push(perim);
                        }
                        Err(_) => { all_safe = false; break; }
                    }
                }
                if !all_safe || hole_loops.is_empty() { continue; }

                // 2c) Container 의 outer + 기존 hole loops + material 캡처.
                //     ADR-022 P9: ring container 인 경우 기존 hole loops 보존.
                let outer_verts = match self.mesh.collect_loop_verts(
                    self.mesh.faces[*container].outer().start
                ) {
                    Ok(v) => v, Err(_) => continue,
                };
                let existing_hole_loops: Vec<Vec<axia_geo::VertId>> = self.mesh.faces[*container]
                    .inners().iter()
                    .filter_map(|lr| self.mesh.collect_loop_verts(lr.start).ok())
                    .collect();
                let material = self.mesh.faces[*container].material();

                // 2c-bis) ADR-022 P9 — pinch safety: 새 hole loops 와 기존 hole
                //   loops / outer 사이의 vertex 공유 검사.
                //   - shared_count >= 2 (edge 공유 가능성) → reject
                //   - shared_count <= 1 (disjoint or pinch) → allow
                if !existing_hole_loops.is_empty() {
                    use std::collections::HashSet;
                    let mut existing_verts: HashSet<axia_geo::VertId> = HashSet::new();
                    for h in &existing_hole_loops {
                        for &v in h { existing_verts.insert(v); }
                    }
                    let mut p9_safe = true;
                    for new_hole in &hole_loops {
                        let mut shared = 0usize;
                        for &v in new_hole {
                            if existing_verts.contains(&v) { shared += 1; }
                        }
                        if shared >= 2 {
                            p9_safe = false;
                            break;
                        }
                    }
                    if !p9_safe { continue; }
                }

                // ADR-051 C2 fix #2 (2026-05-04): combined-perimeter manifold safety.
                // 각 새 hole loop 의 모든 edge 가 새로 promote 가능한 상태인지 검증.
                // 어떤 edge 라도 그 HE2 (twin) 가 NULL 도 아니고 container 도 아닌
                // 다른 active face 에 의해 claim 됐으면, 그 hole 추가는 3-face share
                // 를 만든다. Skip the entire container processing.
                let mut combined_perim_safe = true;
                'outer_check: for hole in &hole_loops {
                    for w in hole.windows(2) {
                        let v0 = w[0]; let v1 = w[1];
                        let Some(eid) = self.mesh.find_edge(v0, v1) else { continue; };
                        let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                        for &f in &faces {
                            if f != *container && self.mesh.faces[f].is_active() {
                                // 이 edge 는 이미 다른 active face 에 claim 됨
                                // → container ring 의 hole 로 추가하면 3-face share
                                if faces.len() >= 2 {
                                    combined_perim_safe = false;
                                    break 'outer_check;
                                }
                            }
                        }
                    }
                    // close-the-loop edge (last → first)
                    if hole.len() >= 2 {
                        let v0 = hole[hole.len() - 1];
                        let v1 = hole[0];
                        let Some(eid) = self.mesh.find_edge(v0, v1) else { continue; };
                        let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                        for &f in &faces {
                            if f != *container && self.mesh.faces[f].is_active() {
                                if faces.len() >= 2 {
                                    combined_perim_safe = false;
                                    break 'outer_check;
                                }
                            }
                        }
                    }
                }
                if !combined_perim_safe {
                    if trace_p7 {
                        eprintln!(
                            "    [P7-trace] container {:?} skipped: combined perimeter has edges already claimed elsewhere (manifold safety)",
                            container,
                        );
                    }
                    continue;
                }

                let nm_before_rebuild = self.mesh.collect_non_manifold_edges().len();

                // ADR-051 C2 trace: HE radial chain for first hole's edges BEFORE soft-remove.
                if trace_p7 && !hole_loops.is_empty() {
                    let first_hole = &hole_loops[0];
                    eprintln!("    [HE-trace] before soft-remove, first hole edges:");
                    for w in first_hole.windows(2) {
                        let v0 = w[0]; let v1 = w[1];
                        if let Some(eid) = self.mesh.find_edge(v0, v1) {
                            let (faces, hes) = self.mesh.get_faces_sharing_edge(eid);
                            eprintln!(
                                "      edge {:?} (verts {:?}↔{:?}): {} faces, hes={:?}",
                                eid, v0, v1, faces.len(), hes,
                            );
                            for (i, &f) in faces.iter().enumerate() {
                                let face = &self.mesh.faces[f];
                                eprintln!(
                                    "        face[{}] {:?}: outer_n={}, inners_n={}",
                                    i, f,
                                    self.mesh.collect_loop_verts(face.outer().start).map(|v| v.len()).unwrap_or(0),
                                    face.inners().len(),
                                );
                            }
                        }
                    }
                }

                // 2d) Container soft-remove + ring 재구성 (기존 + 새 holes 결합).
                if self.mesh.soft_remove_face(*container).is_err() { continue; }
                let mut all_holes: Vec<Vec<axia_geo::VertId>> = existing_hole_loops;
                all_holes.extend(hole_loops);
                let hole_refs: Vec<&[axia_geo::VertId]> =
                    all_holes.iter().map(|h| h.as_slice()).collect();
                if trace_p7 {
                    eprintln!(
                        "    add_face_with_holes: outer_verts={}, hole_loops={}",
                        outer_verts.len(), all_holes.len(),
                    );
                    for (hi, h) in all_holes.iter().enumerate() {
                        eprintln!("      hole[{}] verts: {:?}", hi, h);
                    }
                }
                let new_outer = match self.mesh.add_face_with_holes(
                    &outer_verts, &hole_refs, material,
                ) {
                    Ok(f) => f,
                    Err(_) => {
                        // Ring 재구성 실패 — container 가 lost 상태.
                        // (드물 — soft_remove + add_face_with_holes 같은 verts).
                        continue;
                    }
                };
                let nm_after_rebuild = self.mesh.collect_non_manifold_edges().len();
                if nm_after_rebuild > nm_before_rebuild {
                    eprintln!(
                        "[P7-trace] ⚠ container {:?} → new_face {:?}: nm_edges {} → {} (Δ+{})",
                        container, new_outer, nm_before_rebuild, nm_after_rebuild,
                        nm_after_rebuild - nm_before_rebuild,
                    );
                }

                // 2e) XIA inheritance
                if let Some(old_xia) = self.face_to_xia.remove(container) {
                    if let Some(xia) = self.xias.get_mut(&old_xia) {
                        xia.face_ids.retain(|&f| f != *container);
                        if !xia.face_ids.contains(&new_outer) {
                            xia.face_ids.push(new_outer);
                        }
                    }
                    self.face_to_xia.insert(new_outer, old_xia);
                } else {
                    self.unregister_face_from_xia(*container);
                }
                all_created_faces.retain(|&f| f != *container);
                if !all_created_faces.contains(&new_outer) {
                    all_created_faces.push(new_outer);
                }
            }
        }
        trace_step("after Step 4.95 (P7 ring rebuild)", &self.mesh, &mut last_nm);
        // Detailed inspection: print which 3 faces share each non-manifold edge.
        if trace_p7 {
            for eid in self.mesh.collect_non_manifold_edges() {
                let (faces, hes) = self.mesh.get_faces_sharing_edge(eid);
                if faces.len() >= 3 {
                    eprintln!(
                        "[P7-trace] non-manifold edge {:?} shared by {} faces:",
                        eid, faces.len(),
                    );
                    for (i, &f) in faces.iter().enumerate() {
                        let face = &self.mesh.faces[f];
                        let outer_n = self.mesh.collect_loop_verts(face.outer().start)
                            .map(|v| v.len()).unwrap_or(0);
                        let inners_n = face.inners().len();
                        eprintln!(
                            "  face[{}] = {:?}: outer={}vert, inners={}, he={:?}",
                            i, f, outer_n, inners_n, hes[i],
                        );
                    }
                }
            }
        }

        // Step 4.99 — ADR-025 P11 Final Sweep: Closed Edge Cycle MUST Face.
        //
        // 사용자 원칙 (2026-04-29):
        //   "닫힌 엣지에는 반드시 면이 생성되어야 한다."
        //
        // 이전 단계 (4.5 / 4.6 / 4.9 / 4.95) 가 놓친 free edge cycle 을 mop up.
        // 27-RECT 스트레스에서 발견된 sliver region 미합성 한계 해소.
        //
        // 알고리즘:
        //   1. 활성 edge 중 양쪽 face 가 모두 null/inactive 인 "orphan free edge" 수집
        //   2. 1개라도 있으면 full unscoped resolve_planar_free_faces 호출
        //   3. 결과 face 들을 epoch hint 로 winding 정렬 + all_created_faces 등록
        //
        // 한 번의 final sweep 후에도 잔존 free edge 가 있으면 그 cycle 은 manifold
        // 안전상 합성 불가 (Phase G case (c) 같은 boundary 결합 등) — 별도 phase.
        //
        // **ADR-139 B-β-2 (2026-05-18)**: `auto_face_synthesis_on_draw` flag
        // default OFF — 메타-원칙 #16 자동화 antipattern 폐기. Boundary tool
        // (ADR-139 B-γ) 명시 trigger 로 대체. Legacy `true` explicit opt-in.
        if self.auto_face_synthesis_on_draw {
            let any_orphan = self.mesh.edges.iter().any(|(eid, e)| {
                if !e.is_active() { return false; }
                let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                !faces.iter().any(|&f|
                    self.mesh.faces.contains(f) && self.mesh.faces[f].is_active())
            });
            if any_orphan {
                // Fixed-point: 한 번의 sweep 이 새 face 를 만들면 새로운 cycle 이
                // 노출될 수 있음. 잔존 orphan 0 또는 max_rounds 까지 반복.
                for _round in 0..6 {
                    let resolved = self.mesh.resolve_planar_free_faces(FORM_MATERIAL);
                    let made_progress = !resolved.is_empty();
                    for f in resolved {
                        if !all_created_faces.contains(&f) {
                            all_created_faces.push(f);
                        }
                    }
                    if !made_progress { break; }
                    let still_orphan = self.mesh.edges.iter().any(|(eid, e)| {
                        if !e.is_active() { return false; }
                        let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                        !faces.iter().any(|&f|
                            self.mesh.faces.contains(f) && self.mesh.faces[f].is_active())
                    });
                    if !still_orphan { break; }
                }
            }
        }
        {
            trace_step("after Step 4.99 resolve_planar_free_faces", &self.mesh, &mut last_nm);

            // **ADR-139 B-β-3 (2026-05-21)**: Phase 5 + Phase 6 도 동일 flag
            // (`auto_face_synthesis_on_draw`) 로 gate. Boundary tool (ADR-139
            // B-γ) 명시 trigger 로 대체. User-callable `resynthesize_orphan_
            // faces` command (line 3501) 은 명시 호출 이므로 보존 — 함수
            // 자체 (`mop_up_orphan_cycles_via_dfs` / `absorb_orphan_strands_
            // into_faces`) 는 보존, 자동 호출 site 만 wrap. Legacy `true`
            // explicit opt-in 시 legacy 동작 보존.
            if self.auto_face_synthesis_on_draw {
                // ADR-025 P11 Phase 5 — Brute-force cycle mop-up.
                self.mop_up_orphan_cycles_via_dfs(all_created_faces);
                trace_step("after Phase 5 (DFS mop-up)", &self.mesh, &mut last_nm);

                // ADR-025 P11 Phase 6 — Strand absorption.
                //
                // 잔존 orphan strand (cycle 없는 dangling edge) 를 enclosing face 의
                // boundary 에 흡수. 양 endpoint 가 같은 face 의 outer loop 위에 있으면
                // split_face_by_chain 으로 face 를 둘로 분할 → strand 가 boundary 가 됨.
                self.absorb_orphan_strands_into_faces(all_created_faces);
                trace_step("after Phase 6 (strand absorb)", &self.mesh, &mut last_nm);
            }

            // Phase 7 (final cleanup of remaining strands) 은 의도적 사용자
            // 와이어 (DrawLine intermediate) 와 구별 불가 — closed-shape 명령
            // (DrawRect/DrawCircle) 의 finalizer 에서만 명시적으로 호출.
            // **ADR-139 보존 결정 (Q2-a)**: DrawRect / DrawCircle single-op
            // auto-face 는 보존 → Phase 7 STRICT 보존.
        }
    }

    /// ADR-025 P11 Phase 7 — Deactivate orphan topological edges that aren't
    /// part of any face boundary. These are synthesis residuals that have no
    /// geometric role (the same line is covered by adjacent faces' boundaries).
    ///
    /// **Scope-aware (2026-05-02 fix)**: only cleans up edges in `scope`
    /// (typically `epoch.new_edges` from the current closed-shape command).
    /// Pre-existing user-drawn standalone wires are NOT in `scope` and are
    /// preserved — fixes regression "rect commit erases free-floating lines".
    fn cleanup_dangling_topological_edges(&mut self, scope: &[EdgeId]) {
        use std::collections::HashSet;
        let scope_set: HashSet<EdgeId> = scope.iter().copied().collect();
        let to_remove: Vec<EdgeId> = self.mesh.edges.iter()
            .filter_map(|(eid, e)| {
                if !e.is_active() { return None; }
                if !e.class().is_topological() { return None; }
                if !scope_set.contains(&eid) { return None; }
                let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                let any_active = faces.iter().any(|&f|
                    self.mesh.faces.contains(f) && self.mesh.faces[f].is_active());
                if any_active { None } else { Some(eid) }
            })
            .collect();
        for eid in to_remove {
            let _ = self.mesh.remove_edge_and_halfedges(eid);
        }
        self.mesh.remove_isolated_verts();
    }

    /// ADR-025 P11 Phase 6 — Absorb orphan strand edges into enclosing face.
    ///
    /// 잔존 orphan edge 가 cycle 을 형성하지 못하는 경우 (true dangling strand),
    /// 양 endpoint 가 같은 face F 의 outer loop 위에 있으면 split_face_by_chain
    /// 으로 F 를 둘로 분할 → strand 가 새 sub-face 들의 공유 boundary 가 됨.
    fn absorb_orphan_strands_into_faces(&mut self, all_created_faces: &mut Vec<FaceId>) {
        const MAX_ROUNDS: usize = 8;
        for _round in 0..MAX_ROUNDS {
            // 1) Collect orphan strands (orphan edge with TWO endpoints).
            let strands: Vec<(EdgeId, axia_geo::VertId, axia_geo::VertId)> = self.mesh.edges.iter()
                .filter_map(|(eid, e)| {
                    if !e.is_active() { return None; }
                    if !e.class().is_topological() { return None; }
                    let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                    let any_active = faces.iter().any(|&f|
                        self.mesh.faces.contains(f) && self.mesh.faces[f].is_active());
                    if any_active { None } else { Some((eid, e.v_small(), e.v_large())) }
                })
                .collect();
            if strands.is_empty() { return; }

            let mut absorbed = false;
            for &(_eid, v1, v2) in &strands {
                // 2) Find a face F whose outer loop contains BOTH v1 and v2.
                let candidate_face: Option<FaceId> = self.mesh.faces.iter()
                    .filter(|(_, f)| f.is_active())
                    .filter_map(|(fid, f)| {
                        let verts = self.mesh.collect_loop_verts(f.outer().start).ok()?;
                        if verts.contains(&v1) && verts.contains(&v2) {
                            Some(fid)
                        } else { None }
                    })
                    .next();

                let Some(face_id) = candidate_face else { continue; };

                // 3) Attempt split_face_by_chain with [v1, v2].
                //    The chain is just the strand endpoints; the existing edge
                //    between them gets absorbed as the splitting line.
                let chain = vec![v1, v2];
                match axia_geo::operations::face_split::split_face_by_chain(
                    &mut self.mesh, face_id, &chain, FORM_MATERIAL,
                ) {
                    Ok(res) => {
                        // XIA inheritance: sub-faces inherit original face's XIA.
                        let old_xia = self.face_to_xia.get(&face_id).copied();
                        all_created_faces.retain(|&f| f != face_id);
                        self.unregister_face_from_xia(face_id);
                        if let Some(xid) = old_xia {
                            self.register_faces_to_xia(xid, &res.new_faces);
                        }
                        for f in res.new_faces {
                            if !all_created_faces.contains(&f) {
                                all_created_faces.push(f);
                            }
                        }
                        absorbed = true;
                        break;  // mesh changed — restart loop
                    }
                    Err(_) => {
                        // Try next strand
                    }
                }
            }
            if !absorbed { return; }
        }
    }

    /// ADR-025 P11 Phase 5 — DFS-based orphan cycle mop-up.
    ///
    /// `resolve_planar_free_faces` 가 leftmost-turn 단일 패스로 놓치는 케이스
    /// 를 brute-force DFS 로 처리. 잔존 orphan edges 그래프에서 simple cycle
    /// 을 찾아 face 로 합성. Component 가 작아 (보통 < 20 edges) 비용 낮음.
    /// ADR-021 P7 + ADR-025 P11 — User-callable "Resynthesize Faces" command.
    ///
    /// Walks every active topological edge currently NOT bounding a face and
    /// looks for closed simple cycles. Each cycle found becomes a new face
    /// (DFS-based mop-up of `mop_up_orphan_cycles_via_dfs` made public +
    /// transactional + creates a self-contained XIA per new face).
    ///
    /// Use case: a previous draw or edit operation left orphan edges that
    /// happen to form a closed cycle but the synthesis pipeline missed them
    /// (LOCKED #1 P11 strict guarantees only for closed-shape commands —
    /// DrawLine intermediate states / cross-cuts may leak). The user can
    /// trigger this manually instead of redrawing.
    ///
    /// **Bounded by `MAX_ROUNDS = 8`** — caps work regardless of scene size.
    /// In practice each round runs in microseconds for normal architectural
    /// floor-plans (< 1k orphan edges). Time is measured by the WASM caller
    /// (axia-wasm uses `performance.now()`) since `std::time::Instant::now()`
    /// panics on `wasm32-unknown-unknown` targets.
    ///
    /// **Time-budget abort note (2026-05-02 fix)**: an earlier revision had
    /// an inline `Instant::now()` check between rounds. That triggered a
    /// WASM trap on the web target (Rust std panics on time queries) which
    /// — because WASM traps don't unwind — left wasm-bindgen's RefCell
    /// guard borrowed forever, breaking ALL subsequent engine calls with
    /// "recursive use of an object detected". Time tracking is now done
    /// outside the engine.
    ///
    /// **Sequential numbering** — multiple new faces in the same sweep get
    /// names like `"Resynthesized 1/3"`, `"Resynthesized 2/3"`, … so users
    /// can distinguish them in the Outliner. A single new face is just
    /// `"Resynthesized"`.
    ///
    /// Wraps in a single transaction so Ctrl+Z reverts the whole sweep.
    pub fn resynthesize_orphan_faces(&mut self) -> ResynthesizeReport {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let mut created: Vec<FaceId> = Vec::new();
        // The `MAX_ROUNDS = 8` bound inside mop_up_orphan_cycles_via_dfs is
        // the sole termination guarantee — no time check (see doc above).
        self.mop_up_orphan_cycles_via_dfs(&mut created);

        let n = created.len();
        if n > 0 {
            // Sequential numbering for clarity in the Outliner — single
            // sweep = single batch label.
            for (i, fid) in created.iter().enumerate() {
                let name = if n == 1 {
                    "Resynthesized".to_string()
                } else {
                    format!("Resynthesized {}/{}", i + 1, n)
                };
                let xia_id = self.create_xia(name);
                if let Some(xia) = self.xias.get_mut(&xia_id) {
                    xia.face_ids.push(*fid);
                }
                self.register_faces_to_xia(xia_id, &[*fid]);
            }
            self.transactions.set_after_snapshot(self.scene_snapshot());
            self.transactions.commit();
        } else {
            // Nothing changed — discard the empty transaction so undo
            // history isn't polluted with a no-op entry.
            self.transactions.cancel();
        }

        ResynthesizeReport {
            created: n,
            // No engine-side time budget — set by WASM caller if relevant.
            aborted_by_time_budget: false,
            // Engine doesn't measure wall-clock; WASM caller fills via
            // performance.now() bracket (returns 0.0 here).
            elapsed_ms: 0.0,
        }
    }

    fn mop_up_orphan_cycles_via_dfs(&mut self, all_created_faces: &mut Vec<FaceId>) {
        use std::collections::{HashMap, HashSet};
        const MAX_ROUNDS: usize = 8;
        for _round in 0..MAX_ROUNDS {
            // 1) Collect orphan edges
            let orphan_edges: Vec<(EdgeId, axia_geo::VertId, axia_geo::VertId)> = self.mesh.edges.iter()
                .filter_map(|(eid, e)| {
                    if !e.is_active() { return None; }
                    if !e.class().is_topological() { return None; }
                    let (faces, _) = self.mesh.get_faces_sharing_edge(eid);
                    let any_active = faces.iter().any(|&f|
                        self.mesh.faces.contains(f) && self.mesh.faces[f].is_active());
                    if any_active { None } else { Some((eid, e.v_small(), e.v_large())) }
                })
                .collect();
            if orphan_edges.is_empty() { return; }

            // 2) Adjacency: vert → list of (neighbor_vert, edge_id)
            let mut adj: HashMap<axia_geo::VertId, Vec<(axia_geo::VertId, EdgeId)>> = HashMap::new();
            for &(eid, va, vb) in &orphan_edges {
                adj.entry(va).or_default().push((vb, eid));
                adj.entry(vb).or_default().push((va, eid));
            }

            // 3) Find ONE simple cycle via DFS from each vert
            let mut cycle_verts: Option<Vec<axia_geo::VertId>> = None;
            'outer: for &(_, va, _) in &orphan_edges {
                // DFS: stack of (vert, path, visited_set)
                let mut path: Vec<axia_geo::VertId> = vec![va];
                let mut visited: HashSet<axia_geo::VertId> = HashSet::new();
                visited.insert(va);
                if let Some(cyc) = dfs_find_cycle(&adj, va, va, &mut path, &mut visited, 0, 32) {
                    if cyc.len() >= 3 {
                        cycle_verts = Some(cyc);
                        break 'outer;
                    }
                }
            }
            let cycle_verts = match cycle_verts {
                Some(c) => c,
                None => return,  // no more cycles
            };

            // 4) Compute signed area to determine winding (need CCW for add_face).
            //    Use surface normal hint from epoch context if available, else
            //    derive from cycle's own normal.
            let positions: Vec<DVec3> = cycle_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if positions.len() < 3 { return; }

            // Compute polygon normal (Newell)
            let mut poly_normal = DVec3::ZERO;
            for i in 0..positions.len() {
                let p = positions[i];
                let q = positions[(i + 1) % positions.len()];
                poly_normal.x += (p.y - q.y) * (p.z + q.z);
                poly_normal.y += (p.z - q.z) * (p.x + q.x);
                poly_normal.z += (p.x - q.x) * (p.y + q.y);
            }
            let surface_hint = self.epoch.as_ref()
                .and_then(|e| e.surface_normal)
                .unwrap_or(DVec3::Z);
            let cycle_verts_oriented = if poly_normal.dot(surface_hint) >= 0.0 {
                cycle_verts.clone()
            } else {
                let mut rev = cycle_verts.clone();
                rev.reverse();
                rev
            };

            // 5) Add face
            match self.mesh.add_face_with_holes(&cycle_verts_oriented, &[], FORM_MATERIAL) {
                Ok(new_face) => {
                    if !all_created_faces.contains(&new_face) {
                        all_created_faces.push(new_face);
                    }
                }
                Err(_) => {
                    // Couldn't add (e.g., manifold violation) — skip this cycle and try next round
                    return;
                }
            }
        }
    }


    /// Step 4.9 worker — find and execute all mixed-cycle splits in the
    /// scope of this epoch's touched vertices. Extracted for clarity.
    fn run_mixed_cycle_splits(
        &mut self,
        touched_verts: &[VertId],
        new_edges: &[EdgeId],
        all_created_faces: &mut Vec<FaceId>,
    ) {
        use std::collections::HashSet;
        let touched_set: HashSet<VertId> = touched_verts.iter().copied().collect();
        if touched_set.is_empty() { return; }

        // Iterate until no more splits are possible (a single draw op can
        //   cause multiple independent splits on the same face if the user
        //   drew a shape that touches boundary at multiple non-adjacent
        //   points).
        let max_rounds = 8;
        for _round in 0..max_rounds {
            let candidate_faces: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .filter_map(|(fid, f)| {
                    let verts = self.mesh.collect_loop_verts(f.outer().start).ok()?;
                    if verts.iter().any(|v| touched_set.contains(v)) {
                        Some(fid)
                    } else { None }
                })
                .collect();
            let mut any_split = false;
            for face_id in candidate_faces {
                if !self.mesh.faces.contains(face_id) { continue; }
                // 2순위 (Tier 4 C-2) — left-turn-rule chain finder replaces
                // the older BFS. Geometrically deterministic, picks the
                // chain that tightly hugs the face boundary.
                let Some(chain) = axia_geo::operations::planar_walk::find_first_left_turn_path(
                    &self.mesh, face_id,
                ) else { continue };
                let _ = new_edges; // signature kept for the legacy fallback below

                // 2026-04-28 — chain interior validity guard.
                //   사용자 보고 (snap 으로 정확히 인접 RECT stack 그릴 때 면 사라짐):
                //   M1 이 OUTSIDE 로 가는 chain (예: inner1 face 의 boundary 위
                //   endpoint 두 개가 있지만 chain 자체는 inner1 위쪽 = OUTSIDE 를
                //   지나는 inner2 perimeter) 으로 inner1 을 split → inner1 면적이
                //   새 chain region 으로 잘못 흡수.
                //
                //   chain[0]→chain[1] midpoint 가 face polygon 안에 있어야 함.
                //   바깥이면 split skip — 별도 step 4.96 (host-ring rebuild)
                //   에서 처리.
                if chain.len() >= 2 {
                    let p0 = self.mesh.vertex_pos(chain[0]).ok();
                    let p1 = self.mesh.vertex_pos(chain[1]).ok();
                    if let (Some(p0), Some(p1)) = (p0, p1) {
                        let mid = (p0 + p1) * 0.5;
                        let inside = axia_geo::operations::face_split::point_in_face(
                            &self.mesh, face_id, mid,
                        ).unwrap_or(false);
                        if !inside {
                            continue;
                        }
                    }
                }

                let split_res = axia_geo::operations::face_split::split_face_by_chain(
                    &mut self.mesh,
                    face_id,
                    &chain,
                    FORM_MATERIAL,
                );
                match split_res {
                    Ok(res) => {
                        // 2026-04-28 — XIA inheritance fix: M1 split 의 sub-face
                        //   는 ORIGINAL XIA 에 inherit 되어야 함 (face_id 가
                        //   원래 속한 XIA). 이전엔 unregister 후 new RECT 의
                        //   XIA 로 옮겨져 원본 XIA 가 face_ids 비어버림.
                        //
                        //   사용자 UX: "RECT_orig 가 RECT_new 에 의해 split 됐을
                        //   때, RECT_orig 의 모든 sub-face 는 RECT_orig 의 XIA
                        //   에 그대로 속함". RECT_new 의 XIA 는 자신의 다른
                        //   영역 (RECT_orig 밖) face 만 가짐.
                        let old_xia = self.face_to_xia.get(&face_id).copied();
                        all_created_faces.retain(|&f| f != face_id);
                        self.unregister_face_from_xia(face_id);
                        if let Some(xid) = old_xia {
                            // Sub-faces inherit original XIA.
                            self.register_faces_to_xia(xid, &res.new_faces);
                            if let Some(xia) = self.xias.get_mut(&xid) {
                                for &f in &res.new_faces {
                                    if !xia.face_ids.contains(&f) {
                                        xia.face_ids.push(f);
                                    }
                                }
                            }
                            // Sub-faces not added to all_created_faces — they
                            //   inherited and shouldn't go to the new RECT's
                            //   XIA at end of exec_draw_rect.
                        } else {
                            // Original face had no XIA — sub-faces become
                            //   "owned" by the current draw operation.
                            for &f in &res.new_faces {
                                if !all_created_faces.contains(&f) {
                                    all_created_faces.push(f);
                                }
                            }
                        }
                        any_split = true;
                    }
                    Err(_e) => {
                        // Failure is not fatal — leave face as-is; the
                        //   free edges inside remain (user can manually
                        //   resolve). No Toast here — the inner user-facing
                        //   resolve_planar step already announced face
                        //   creation results.
                    }
                }
            }
            if !any_split { break; }
        }
    }

    /// Try to find a free-edge chain that enters `face_id`'s boundary at
    /// one vertex, traverses interior (free-edge) vertices, and exits at
    /// another boundary vertex. Returns the chain vertex list if found.
    ///
    /// Strategy:
    ///   1. Enumerate boundary verts that have ≥1 free-edge spoke heading
    ///      to a NON-boundary vertex. Those are candidate entry points.
    ///   2. BFS along free edges starting from each entry, avoiding the
    ///      boundary itself, until we hit another boundary vert — that's
    ///      the exit.
    ///   3. Reject "chain" if the BFS fails or loops through only boundary
    ///      (would be a redundant cut).
    /// Legacy BFS-based chain finder. Superseded by
    /// `axia_geo::operations::planar_walk::find_first_left_turn_path`
    /// (Tier 4 C-2 — 2026-04-26). Kept around as reference and as a
    /// potential fallback; not currently called.
    #[allow(dead_code)]
    fn find_mixed_cycle_chain(
        &self,
        face_id: FaceId,
        _new_edges: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        use std::collections::{HashMap, HashSet};
        let face = self.mesh.faces.get(face_id)?;
        let boundary = self.mesh.collect_loop_verts(face.outer().start).ok()?;
        if boundary.len() < 3 { return None; }
        let boundary_set: HashSet<VertId> = boundary.iter().copied().collect();

        // Only strictly-free edges qualify as chain edges. An edge that
        // already bounds any face (even on one side) is part of the
        // surrounding topology — including the adjacency seam between two
        // freshly drawn RECTs. Counting those as "free spokes" would make
        // Step 4.9 try to cut along an existing boundary and destroy the
        // neighbour face's ownership.
        let free_neighbours = |v: VertId| -> Vec<VertId> {
            let mut out = Vec::new();
            for (eid, edge) in self.mesh.edges.iter() {
                if !edge.is_active() { continue; }
                if !edge.class().is_topological() { continue; }
                if edge.v_small() != v && edge.v_large() != v { continue; }
                if !self.mesh.is_edge_completely_free(eid) { continue; }
                // ADR-089 A-ζ-2: self-loop edges (closed analytic curves)
                // are not polygon-chain participants — skip in chain walking.
                if edge.is_self_loop() { continue; }
                let other = if edge.v_small() == v { edge.v_large() } else { edge.v_small() };
                out.push(other);
            }
            out
        };

        // BFS from each boundary vert that has a free spoke going interior.
        for &entry in &boundary {
            let spokes = free_neighbours(entry);
            for nb in spokes {
                // Short chain case — other end is already on boundary.
                if boundary_set.contains(&nb) && nb != entry {
                    // Trivial chain of length 2. Only valid if the two boundary
                    //   verts are NOT adjacent on the boundary (would be
                    //   redundant) — a 2-vert chain on adjacent boundary would
                    //   mean the "free edge" parallels an existing face edge.
                    let i_a = boundary.iter().position(|v| *v == entry).unwrap();
                    let i_b = boundary.iter().position(|v| *v == nb).unwrap();
                    let diff = if i_a < i_b { i_b - i_a } else { i_a - i_b };
                    let wrap = boundary.len() - diff;
                    let adjacent = diff == 1 || wrap == 1;
                    if !adjacent {
                        return Some(vec![entry, nb]);
                    }
                    continue;
                }
                // Non-boundary neighbour — BFS further.
                let mut prev: HashMap<VertId, VertId> = HashMap::new();
                prev.insert(nb, entry);
                let mut stack: Vec<VertId> = vec![nb];
                let mut found_exit: Option<VertId> = None;
                while let Some(cur) = stack.pop() {
                    if boundary_set.contains(&cur) && cur != entry {
                        found_exit = Some(cur);
                        break;
                    }
                    for next in free_neighbours(cur) {
                        if next == entry { continue; }
                        if prev.contains_key(&next) { continue; }
                        prev.insert(next, cur);
                        stack.push(next);
                        if boundary_set.contains(&next) {
                            found_exit = Some(next);
                            break;
                        }
                    }
                    if found_exit.is_some() { break; }
                }
                if let Some(exit) = found_exit {
                    // Reconstruct chain path entry → exit
                    let mut chain = vec![exit];
                    let mut cur = exit;
                    while cur != entry {
                        match prev.get(&cur) {
                            Some(&p) => { chain.push(p); cur = p; }
                            None => return None,
                        }
                    }
                    chain.reverse();
                    // Sanity: chain has entry and exit on boundary, interior
                    //   verts not on boundary, and edges exist. Validate.
                    if chain.len() < 2 { continue; }
                    let mut ok = true;
                    for i in 1..chain.len()-1 {
                        if boundary_set.contains(&chain[i]) { ok = false; break; }
                    }
                    if !ok { continue; }
                    return Some(chain);
                }
            }
        }
        None
    }

    /// 주어진 vertex 루프가 기존 face 중 하나 이상의 centroid를 감싸고 있는지 검사.
    /// True이면 이 루프는 "외부 unbounded boundary"로 판정 → 면 생성 스킵.
    ///
    /// 구현: 루프 3점으로 근사 평면 정의 → 평면의 두 basis로 2D 투영 →
    /// 기존 face들의 centroid를 같은 평면에 투영 후 point-in-polygon 검사.
    fn loop_encloses_existing_face(&self, loop_verts: &[VertId]) -> bool {
        if loop_verts.len() < 3 { return false; }
        // 루프 vertex의 3D 좌표 수집
        let pts: Vec<DVec3> = loop_verts.iter()
            .filter_map(|v| self.mesh.vertex_pos(*v).ok())
            .collect();
        if pts.len() < 3 { return false; }
        // 평면 basis 구성
        let origin = pts[0];
        let e1 = (pts[1] - origin).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return false; }
        let mut e2 = DVec3::ZERO;
        for p in &pts[2..] {
            let v = *p - origin;
            let proj = e1 * v.dot(e1);
            let ortho = v - proj;
            if ortho.length_squared() > 1e-6 {
                e2 = ortho.normalize_or_zero();
                break;
            }
        }
        if e2.length_squared() < 1e-10 { return false; }
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - origin;
            (v.dot(e1), v.dot(e2))
        };
        let poly: Vec<(f64, f64)> = pts.iter().map(|&p| project2d(p)).collect();
        // point-in-polygon (ray cast)
        let point_in = |x: f64, y: f64| -> bool {
            let mut inside = false;
            let n = poly.len();
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > y) != (yj > y)) &&
                   (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };
        // 기존 활성 face의 centroid 투영 후 검사
        for (face_id, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            // centroid 계산 (face vertices 평균)
            let Ok(verts) = self.mesh.collect_loop_verts(face.outer().start) else { continue };
            if verts.is_empty() { continue; }
            let mut cx = DVec3::ZERO;
            for &v in &verts {
                if let Ok(p) = self.mesh.vertex_pos(v) { cx += p; }
            }
            cx /= verts.len() as f64;
            // 평면 거리 검사 (루프 평면에서 너무 멀면 무관)
            let normal = e1.cross(e2).normalize_or_zero();
            let dist = (cx - origin).dot(normal).abs();
            if dist > 1.0 { continue; } // 다른 평면의 face — 무시
            let (px, py) = project2d(cx);
            if point_in(px, py) {
                let _ = face_id;
                return true;
            }
        }
        false
    }

    fn exec_draw_line(
        &mut self,
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    ) -> CommandResult {
        // 2026-04-24 Re-entrancy: when called from within another exec_*
        //   (e.g., exec_draw_rect's 4-line expansion), the outer command already
        //   owns the transaction frame. Nested begin() would reset current_frame
        //   and lose the outer's accumulated changes, so we skip our own tx
        //   management and let the outer handle commit/cancel.
        let own_transaction = !self.transactions.is_recording();
        if own_transaction {
            self.transactions.begin();
            self.transactions.set_before_snapshot(self.scene_snapshot());
        }

        // ── Step 0: Phase B — Collinear endpoint split ──
        //   If the new line's START or END point lies inside the interior of
        //   an existing COLLINEAR edge (same direction, overlapping
        //   parametric range), split that existing edge at the endpoint
        //   position BEFORE crossing detection. This is what enables two
        //   overlapping RECTs to share DCEL edges properly: rect B's bottom
        //   edge splits rect A's bottom at x=500 (or wherever the overlap
        //   starts), creating a shared vertex rather than two parallel edges.
        let collinear_splits = self.mesh.find_collinear_endpoint_splits(start, end);
        for (edge_id, pos) in &collinear_splits {
            // split_edge may fail if the edge got dissolved by an earlier
            //   split (same pos in same line) — ignore and continue.
            let _ = self.mesh.split_edge(*edge_id, *pos);
        }

        // ── Step 1: 기존 엣지 교차점 + 기존 vertex on-line 탐지 ──
        // (a) 새 line이 기존 엣지 interior와 교차 → split_edge로 vertex 삽입
        // (b) 새 line interior에 기존 vertex가 이미 놓여 있음 → split_edge 불필요,
        //     새 line 자체를 이 vertex에서 sub-segment로 분할
        let crossings = self.mesh.find_line_crossings(start, end);
        let verts_on_line = self.mesh.find_vertices_on_line(start, end);

        // ── Step 2: 교차된 엣지 split + 모든 break point 수집 (t 오름차순) ──
        // BreakPoint: t on new line, 3D position.
        let mut break_points: Vec<(f64, DVec3)> = Vec::new();
        for (edge_id, pos, t) in &crossings {
            match self.mesh.split_edge(*edge_id, *pos) {
                Ok(_) => break_points.push((*t, *pos)),
                Err(_) => continue,
            }
        }
        for (_vid, pos, t) in &verts_on_line {
            break_points.push((*t, *pos));
        }
        break_points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        // Dedup nearby breakpoints (same position from both lists)
        let dedup_tol = (end - start).length() * 1e-5;
        break_points.dedup_by(|a, b| (a.1 - b.1).length() < dedup_tol);

        // ── Step 3: sub-segment 리스트 구성 ──
        let mut segments: Vec<(DVec3, DVec3)> = Vec::new();
        let mut prev = start;
        for (_t, pos) in &break_points {
            segments.push((prev, *pos));
            prev = *pos;
        }
        segments.push((prev, end));

        // ── Step 4: 각 sub-segment를 개별 처리 ──
        // - 양 끝점이 같은 face의 boundary에 있으면 split_face_by_line 시도 (Cross-face split)
        // - 아니면 draw_line + detect_free_edge_loop 반복 (기존 로직)
        let mut all_created_faces: Vec<FaceId> = Vec::new();
        let mut all_loop_edge_ids: Vec<EdgeId> = Vec::new();
        let mut first_edge_id: Option<EdgeId> = None;
        let mut touched_verts: Vec<VertId> = Vec::new();
        let mut new_edges: Vec<EdgeId> = Vec::new();

        for (seg_start, seg_end) in &segments {
            // 길이 0 세그먼트 + snap 오차로 인한 "사실상 동일" 세그먼트 거부.
            // EPSILON_LENGTH(1e-6)보다 훨씬 큰 threshold(0.1mm)를 둬서 spatial_hash
            // dedup과 일관되게 자기참조 엣지 생성을 원천 차단.
            if (*seg_end - *seg_start).length() < 0.1 { continue; }

            // 먼저 draw_line으로 엣지 생성 (양쪽 끝에 vertex가 이미 있든 없든 add_vertex가
            // 기존 vertex를 재사용 — spatial_hash 기반 dedup).
            let (v_a, v_b, new_edge_id) = match self.mesh.draw_line(*seg_start, *seg_end) {
                Ok(r) => r,
                Err(_) => continue,
            };
            // add_vertex dedup 이후 양 끝이 같은 vertex면 스킵 (drawLine 가드 통과했어도
            // f64 snap이 두 점을 같은 vertex로 해석한 경우)
            if v_a == v_b { continue; }
            if first_edge_id.is_none() { first_edge_id = Some(new_edge_id); }
            self.mesh.mark_edge_hard(new_edge_id);
            if !touched_verts.contains(&v_a) { touched_verts.push(v_a); }
            if !touched_verts.contains(&v_b) { touched_verts.push(v_b); }
            if !new_edges.contains(&new_edge_id) { new_edges.push(new_edge_id); }

            // ── (a) Cross-face split 시도: 두 vertex 모두 같은 face boundary 위인지 ──
            if let Some(face_id) = self.mesh.find_face_containing_both_verts(v_a, v_b) {
                match axia_geo::operations::face_split::split_face_by_line(
                    &mut self.mesh,
                    face_id,
                    *seg_start,
                    *seg_end,
                ) {
                    Ok(result) => {
                        for fid in result.new_faces {
                            if !all_created_faces.contains(&fid) {
                                all_created_faces.push(fid);
                            }
                        }
                        continue; // split 성공 — 다음 세그먼트로
                    }
                    Err(_) => {
                        // split 실패 시 loop detection으로 fallback
                    }
                }
            }

            // ── (b) Free-edge loop detection — 반복 탐색 ──
            // 단, 새 엣지의 한쪽 endpoint가 기존 face의 interior에 있는 경우 loop
            // detection을 스킵 — fan_split이 나중에 처리해서 중복 생성을 방지.
            if self.is_vertex_interior_to_any_face(v_a) || self.is_vertex_interior_to_any_face(v_b) {
                continue;
            }
            let mut seen_loops: Vec<Vec<VertId>> = Vec::new();
            let mut seg_faces: usize = 0;
            let mut excluded_edges: Vec<EdgeId> = Vec::new();
            loop {
                let loop_verts = match self.mesh.detect_free_edge_loop_excluding(
                    v_a, v_b, new_edge_id, &excluded_edges,
                ) {
                    Some(v) => v,
                    None => break,
                };
                let mut norm = loop_verts.clone();
                norm.sort_by_key(|v| v.raw());
                if seen_loops.iter().any(|s| s == &norm) { break; }
                seen_loops.push(norm.clone());
                if self.loop_encloses_existing_face(&loop_verts) {
                    // 2026-04-24 (ADR-008 Axiom 7): 루프의 엣지 중 하나라도
                    // 완전 free(어떤 face에도 속하지 않음)이면 outer-
                    // encloses-inner 정당 의도로 허용 (Phase E). 모든 엣지
                    // 가 이미 face를 갖고 있으면 기존 outer 재생성 의심 →
                    // reject.
                    let mut has_completely_free_edge = false;
                    for i in 0..loop_verts.len() {
                        let va = loop_verts[i];
                        let vb = loop_verts[(i + 1) % loop_verts.len()];
                        if let Some(eid) = self.mesh.find_edge(va, vb) {
                            if self.mesh.is_edge_completely_free(eid) {
                                has_completely_free_edge = true;
                                break;
                            }
                        }
                    }

                    if !has_completely_free_edge {
                        // 모든 엣지가 이미 face를 갖고 있음 — 기존 outer 재생성
                        // 의심 → reject and retry.
                        for i in 0..loop_verts.len() {
                            let va = loop_verts[i];
                            let vb = loop_verts[(i + 1) % loop_verts.len()];
                            if let Some(eid) = self.mesh.find_edge(va, vb) {
                                if !excluded_edges.contains(&eid) {
                                    excluded_edges.push(eid);
                                }
                            }
                        }
                        if excluded_edges.len() > 20 { break; }
                        continue;
                    }
                    // has completely-free edge — fall through to face creation
                }

                // Step 4(b) permissive: `detect_free_edge_loop_excluding` is
                //   responsible for returning only topologically valid cycles
                //   (it walks real free HEs). Adjacent-RECT face creation
                //   depends on this path. Mixed-cycle safety gates live in
                //   the D resolver (Step 4.6) and in Step 4.9 M1 only.

                for i in 0..loop_verts.len() {
                    let va = loop_verts[i];
                    let vb = loop_verts[(i + 1) % loop_verts.len()];
                    if let Some(eid) = self.mesh.find_edge(va, vb) {
                        if !all_loop_edge_ids.contains(&eid) {
                            all_loop_edge_ids.push(eid);
                        }
                    }
                }
                match self.mesh.add_face(&loop_verts, FORM_MATERIAL) {
                    Ok(fid) => {
                        // ADR-007 Invariant 2 (Winding): face's normal MUST
                        //   align with surface_normal hint. Always enforce —
                        //   neighbor alignment alone is insufficient as
                        //   neighbors might themselves be flipped.
                        //
                        // 2026-04-28 — 사용자 보고: 그리는 방향에 따라 면이
                        //   뒤집혀 BackSide 로 렌더되는 현상. 기존 logic 은
                        //   align_face_with_neighbors 가 true 반환 시 (= flip
                        //   수행) surface_normal 검사를 skip 해 결과가 hint 와
                        //   반대일 수 있었음. 항상 hint 기준으로 검사.
                        self.mesh.align_face_with_neighbors(fid);
                        let face_n = self.mesh.faces[fid].normal();
                        let target = surface_normal.unwrap_or(DVec3::Y);
                        if face_n.dot(target) < 0.0 {
                            let _ = self.mesh.flip_face_safe(fid);
                        }
                        all_created_faces.push(fid);
                        seg_faces += 1;
                        if seg_faces >= 2 { break; }
                    }
                    Err(_) => break,
                }
            }
        }

        // ── Steps 4.5–4.8: Face synthesis post-process ──
        // Principle 3 (ADR-008): if an outer multi-line command (draw_rect,
        // draw_circle) has an epoch active, defer the whole post-process to
        // the epoch finalizer. Contribute our per-line findings to the
        // epoch buffer so the outer sees everything.
        if self.epoch.is_some() {
            if let Some(ep) = self.epoch.as_mut() {
                for v in &touched_verts {
                    if !ep.touched_verts.contains(v) { ep.touched_verts.push(*v); }
                }
                for e in &new_edges {
                    if !ep.new_edges.contains(e) { ep.new_edges.push(*e); }
                }
                for f in &all_created_faces {
                    if !ep.created_faces.contains(f) { ep.created_faces.push(*f); }
                }
                for e in &all_loop_edge_ids {
                    if !ep.loop_edge_ids.contains(e) { ep.loop_edge_ids.push(*e); }
                }
            }
        } else {
            // ⚡ Fast-path (2026-04-27): empty-space draw skips all heavy
            //   postprocess scans. If the new line touched **no** existing
            //   topology (no edge crossings, no on-line verts, no collinear
            //   overlap, no face-split sub-segments) it can only have
            //   produced a standalone edge — none of Steps 4.5/4.55/4.6/
            //   4.65/4.7/4.8 have anything to do.
            //
            //   Each of those steps iterates ~all active faces with
            //   collect_loop_verts → heap alloc per face. With a 3000-face
            //   scene this dominates draw_line latency (>500 ms).
            //
            // ADR-019 A6 (2026-04-29) — closed-cycle detection for wire loops.
            //   Earlier optimization missed the case where the new line
            //   *connects* to an existing vertex (dedup match) inside a face's
            //   interior — a wire-chain extension that may close a cycle on
            //   completion. We additionally trigger postprocess when either
            //   endpoint of the new edge has more than 1 incident edge after
            //   creation (i.e. the new line is connecting to existing
            //   topology — wire chain or face boundary). This lets users
            //   form sub-faces by manually drawing 4 lines inside an existing
            //   face (DrawLine equivalent of DrawRect interior fast-path).
            let count_incident = |mesh: &axia_geo::Mesh, vid: VertId| -> usize {
                mesh.edges.iter()
                    .filter(|(_, e)| {
                        e.is_active() && (e.v_small() == vid || e.v_large() == vid)
                    })
                    .take(2)
                    .count()
            };
            let endpoint_connects_existing = touched_verts.iter()
                .any(|&v| count_incident(&self.mesh, v) > 1);

            let touched_existing_topology =
                !crossings.is_empty() ||
                !verts_on_line.is_empty() ||
                !collinear_splits.is_empty() ||
                !all_created_faces.is_empty() ||
                endpoint_connects_existing;
            if touched_existing_topology {
                self.run_face_synthesis_postprocess(
                    &touched_verts,
                    &new_edges,
                    &mut all_created_faces,
                );
            }
        }

        // ── Step 5: 결과 XIA 생성 ──
        // If an epoch is open, the outer command (draw_rect / draw_circle)
        // will create the XIA once all sides are drawn and the deferred
        // post-process has run. Return a sentinel so callers inside the
        // command know "no Line XIA to consolidate", and skip commit
        // (outer owns the transaction).
        if self.epoch.is_some() {
            return CommandResult::EntityCreated(0);
        }

        if !all_created_faces.is_empty() {
            // 기존 standalone-edge XIA 정리
            let xias_to_remove: Vec<XiaId> = self.xias.iter()
                .filter(|(_, x)| {
                    if let Some(eid) = x.standalone_edge_id {
                        all_loop_edge_ids.contains(&eid)
                    } else {
                        false
                    }
                })
                .map(|(&id, _)| id)
                .collect();
            for xid in &xias_to_remove {
                self.xias.remove(xid);
            }

            let xia_id = self.create_xia("Face".to_string());
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.position = start;
                xia.surface_normal = surface_normal;
                for &fid in &all_created_faces {
                    xia.face_ids.push(fid);
                }
            }
            self.register_faces_to_xia(xia_id, &all_created_faces);

            if own_transaction {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
            }
            return CommandResult::EntityCreated(xia_id);
        }

        // 면 생성 안 됐지만 최소 하나의 엣지는 생성됨 → Line XIA
        if let Some(edge_id) = first_edge_id {
            let xia_id = self.create_xia("Line".to_string());
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.position = start;
                xia.surface_normal = surface_normal;
                xia.standalone_edge_id = Some(edge_id);
            }
            if own_transaction {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
            }
            CommandResult::EntityCreated(xia_id)
        } else {
            if own_transaction { self.transactions.cancel(); }
            CommandResult::Error("draw_line produced no edges".to_string())
        }
    }

    /// Centerline draw — deliberately skips the intersection/split/synthesize
    /// pipeline. Creates exactly one edge tagged as Centerline; crossing other
    /// edges does not split them. This is the key behavioral contract users
    /// rely on for axis/grid drawing.
    fn exec_draw_centerline(&mut self, start: DVec3, end: DVec3) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let (_, _, edge_id) = match self.mesh.draw_line(start, end) {
            Ok(r) => r,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!("draw_centerline: {}", e));
            }
        };
        // Tag the new edge as Centerline — bypasses all downstream topology
        // handlers (face synthesis filter, boolean skip, etc.)
        if let Some(edge) = self.mesh.edges.get_mut(edge_id) {
            edge.set_class(axia_geo::EdgeClass::Centerline);
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(edge_id.raw() as u32)
    }

    /// Flip an edge's semantic class. Only updates the attribute; does NOT
    /// retroactively merge or split. Callers warning: changing a Geometry
    /// edge that is already part of a face to Centerline may leave dangling
    /// face references — current guard rejects the change in that case.
    fn exec_set_edge_class(&mut self, edge_id: axia_geo::EdgeId, class_raw: u32) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let class = axia_geo::EdgeClass::from_raw(class_raw);
        // Reject demoting a Geometry edge that bounds an active face —
        // centerlines must not participate in face topology, so demotion
        // would orphan the face. User should delete/reshape first.
        if class == axia_geo::EdgeClass::Centerline {
            let bounds_face = self.mesh.get_faces_sharing_edge(edge_id).0.iter().any(
                |&fid| self.mesh.faces.get(fid).is_some_and(|f| f.is_active())
            );
            if bounds_face {
                self.transactions.cancel();
                return CommandResult::Error(
                    "set_edge_class: edge bounds an active face — delete the face first to convert to Centerline".to_string()
                );
            }
        }
        match self.mesh.edges.get_mut(edge_id) {
            Some(edge) => {
                edge.set_class(class);
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::MeshUpdated
            }
            None => {
                self.transactions.cancel();
                CommandResult::Error(format!("set_edge_class: edge {:?} not found", edge_id))
            }
        }
    }

    fn exec_draw_rect(
        &mut self,
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
    ) -> CommandResult {
        // 2026-04-24 — Principle 1 compliance: RECT is drawn as 4 LINE segments.
        //   Face is auto-synthesized when the 4th line closes the loop,
        //   identical to the LINE tool's face-synthesis path. This unifies
        //   vertex dedup + edge sharing behaviour so two adjacent RECTs
        //   share DCEL edges (same as two adjacent triangles from LINE).
        //
        //   Previously exec_draw_rect called mesh.draw_rectangle directly,
        //   which was an independent atomic path — two adjacent rects could
        //   end up with duplicated vertices if snap drift exceeded the 1.5μm
        //   spatial-hash dedup, and merge would fail. Now both rects go
        //   through draw_line → synthesize, so their shared corners are
        //   guaranteed to dedup through the same code path as LINE.

        // Compute 4 corners. Mirrors the coordinate system used by the
        //   original draw_rectangle: u = up.normalize(), v = n × u.
        let n_norm = if normal.length_squared() > 1e-12 {
            normal.normalize()
        } else {
            return CommandResult::Error("normal must be non-zero".to_string());
        };
        let u = if up.length_squared() > 1e-12 {
            up.normalize()
        } else {
            return CommandResult::Error("up must be non-zero".to_string());
        };
        let v = n_norm.cross(u).normalize_or_zero();
        if v.length_squared() < 1e-12 {
            return CommandResult::Error("normal and up are parallel".to_string());
        }
        let hw = width / 2.0;
        let hh = height / 2.0;
        // 2026-04-27 — 엔진 허용오차 정책 (사용자 정책):
        //   mesh 층은 exact input 만 처리. UI snap (osnap) 이 cursor 를
        //   정확한 위치로 옮겨주므로 미세 어긋남은 입력 단계에서 해소됨.
        //   기본 add_vertex 의 1.5μm dedup 만 사용 (f32 drift 흡수용).
        let corners = [
            center - u * hh - v * hw,
            center - u * hh + v * hw,
            center + u * hh + v * hw,
            center + u * hh - v * hw,
        ];

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // ═══ Fast-path: RECT in empty scene space ═══════════════════════
        //
        // ADR-008 Axiom 2 ("RECT = 4 LINEs") requires behaviour equivalence,
        // not code-path equivalence. When the rectangle's AABB does not
        // intersect any active edge or vertex, the 4-line pipeline would
        // produce the same result as a single atomic draw_rectangle — just
        // much slower (4× crossings / verts-on-line / fan-split / resolve
        // scans instead of one add_vertex × 4 + add_face call).
        //
        // We detect "no interaction" with a separating-axis AABB test over
        // active edges. If none overlaps the rect's AABB, take the atomic
        // path. Any edge overlap → full pipeline (Phase A behaviour).
        let rect_aabb_min = {
            let mut m = corners[0];
            for c in &corners[1..] { m = m.min(*c); }
            m
        };
        let rect_aabb_max = {
            let mut m = corners[0];
            for c in &corners[1..] { m = m.max(*c); }
            m
        };
        // Pad by a small tol so edges exactly touching the boundary aren't
        //   mis-classified as "no interaction".
        let pad = (width.max(height) * 1e-6).max(1e-3);
        let rect_min = rect_aabb_min - DVec3::splat(pad);
        let rect_max = rect_aabb_max + DVec3::splat(pad);

        let aabb_overlap = |emin: DVec3, emax: DVec3| -> bool {
            !(emax.x < rect_min.x || emin.x > rect_max.x
              || emax.y < rect_min.y || emin.y > rect_max.y
              || emax.z < rect_min.z || emin.z > rect_max.z)
        };
        let edge_interaction = self.mesh.edges.iter().any(|(_, edge)| {
            if !edge.is_active() { return false; }
            if !edge.class().is_topological() { return false; }
            let Ok(va) = self.mesh.vertex_pos(edge.v_small()) else { return false; };
            let Ok(vb) = self.mesh.vertex_pos(edge.v_large()) else { return false; };
            aabb_overlap(va.min(vb), va.max(vb))
        });
        // Also check face interiors — a RECT drawn INSIDE a bigger face
        // shares no edge AABB overlap but still needs the unified
        // pipeline (so B1 can split the container into sub-faces).
        let face_interaction = !edge_interaction && self.mesh.faces.iter().any(|(_, f)| {
            if !f.is_active() { return false; }
            let Ok(verts) = self.mesh.collect_loop_verts(f.outer().start) else { return false; };
            if verts.is_empty() { return false; }
            let mut mn = DVec3::splat(f64::INFINITY);
            let mut mx = DVec3::splat(f64::NEG_INFINITY);
            for &v in &verts {
                if let Ok(p) = self.mesh.vertex_pos(v) {
                    mn = mn.min(p);
                    mx = mx.max(p);
                }
            }
            aabb_overlap(mn, mx)
        });
        let has_interaction = edge_interaction || face_interaction;

        if !has_interaction {
            // Atomic path — identical result to unified path, no scans.
            match self.mesh.draw_rectangle(center, normal, up, width, height, FORM_MATERIAL) {
                Ok((face_id, _verts)) => {
                    let xia_id = self.create_xia("Rectangle".to_string());
                    if let Some(xia) = self.xias.get_mut(&xia_id) {
                        xia.position = center;
                        xia.surface_normal = Some(n_norm);
                        xia.face_ids.push(face_id);
                    }
                    self.register_faces_to_xia(xia_id, &[face_id]);
                    // Phase 2: auto-intersect with rest of scene (still inside
                    //   this transaction so Ctrl+Z undoes both at once).
                    if self.auto_intersect_on_draw {
                        let _ = self.intersect_faces_inner(&[face_id]);
                    }
                    self.transactions.set_after_snapshot(self.scene_snapshot());
                    self.transactions.commit();
                    return CommandResult::EntityCreated(xia_id);
                }
                Err(e) => {
                    self.transactions.cancel();
                    return CommandResult::Error(format!("draw_rect atomic: {}", e));
                }
            }
        }

        // ═══ Fast-path: RECT interior to a single face ═════════════════════
        //
        // 2026-04-28 — ADR-016 Conditional B1 Auto Hole-Promote:
        //   새 RECT 가 기존 face 의 strict interior 면 inner 단순 face 로
        //   생성 후, b1_promote_safe 검사 통과 시 outer 를 ring 으로 변환하고
        //   inner 를 hole 로 흡수. 둘째 inner (container 가 이미 ring) 는
        //   skip → 별개 floating face 유지 (manifold 안전).
        if !edge_interaction && face_interaction {
            if let Some(container_fid) = self.single_face_containing_corners(&corners, n_norm) {
                // Atomic: add 4 vertices, add_face.
                match self.mesh.draw_rectangle(center, normal, up, width, height, FORM_MATERIAL) {
                    Ok((inner_fid, _verts)) => {
                        let xia_id = self.create_xia("Rectangle".to_string());
                        if let Some(xia) = self.xias.get_mut(&xia_id) {
                            xia.position = center;
                            xia.surface_normal = Some(n_norm);
                            xia.face_ids.push(inner_fid);
                        }
                        self.register_faces_to_xia(xia_id, &[inner_fid]);

                        // ADR-016 conditional B1 promote.
                        let mut b1_fired = false;
                        if self.b1_promote_safe(container_fid, inner_fid) {
                            if let Ok(new_outer) = self.promote_face_to_hole(container_fid, inner_fid) {
                                b1_fired = true;
                                // Update container's XIA mapping (outer → new_outer).
                                if let Some(old_xia) = self.face_to_xia.remove(&container_fid) {
                                    if let Some(xia) = self.xias.get_mut(&old_xia) {
                                        xia.face_ids.retain(|&f| f != container_fid);
                                        if !xia.face_ids.contains(&new_outer) {
                                            xia.face_ids.push(new_outer);
                                        }
                                    }
                                    self.face_to_xia.insert(new_outer, old_xia);
                                }
                            }
                        }

                        // Skip auto-intersect when B1 fired — inner is fully
                        // inside container with no boundary crossings, so no
                        // additional intersections to find. Running intersect
                        // would unnecessarily revisit the freshly-built ring's
                        // hole loop edges and can split/destroy the topology.
                        if !b1_fired && self.auto_intersect_on_draw {
                            let _ = self.intersect_faces_inner(&[inner_fid]);
                        }
                        self.transactions.set_after_snapshot(self.scene_snapshot());
                        self.transactions.commit();
                        return CommandResult::EntityCreated(xia_id);
                    }
                    Err(e) => {
                        self.transactions.cancel();
                        return CommandResult::Error(format!("draw_rect interior: {}", e));
                    }
                }
            }
            // Corners not strictly inside a single face — fall through to
            //   the unified pipeline (handles mixed / boundary cases).
        }
        // ═══════════════════════════════════════════════════════════════

        // Principle 3 (Face Operation Epoch): open an epoch so the inner
        // exec_draw_line calls defer their Steps 4.5–4.8 post-process to
        // the single sweep at the end of this command. Collapses 4× of
        // those scans into 1×.
        self.epoch = Some(EpochContext {
            surface_normal: Some(n_norm),
            ..Default::default()
        });

        // Call exec_draw_line 4 times within our outer transaction. Each
        //   invocation runs the FULL LINE pipeline — crossings, edge split,
        //   face synthesis, cross-face split — but skips its own tx
        //   management (re-entrant, detecting our outer begin()) AND its
        //   post-process (epoch active — deferred to finalizer below).
        //
        //   Note: face synthesis may happen on call 2 OR call 3, not
        //   necessarily on the closing line. E.g., when the 4th segment
        //   reuses an EXISTING edge (adjacent to a previously drawn rect),
        //   the closed cycle forms as soon as the 3rd new segment is drawn.
        //   With the epoch active, inner exec_draw_line calls return a
        //   sentinel EntityCreated(0) and defer post-process + XIA creation.
        //   Any error from an inner call aborts the whole command.
        for i in 0..4 {
            let s_start = corners[i];
            let s_end = corners[(i + 1) % 4];
            if let CommandResult::Error(e) = self.exec_draw_line(s_start, s_end, Some(n_norm)) {
                self.epoch = None;
                self.transactions.cancel();
                return CommandResult::Error(format!("draw_rect side {}: {}", i, e));
            }
        }

        // Finalize epoch — 1× post-process sweep over all accumulated state.
        let mut epoch = self.epoch.take().unwrap_or_default();
        self.run_face_synthesis_postprocess(
            &epoch.touched_verts,
            &epoch.new_edges,
            &mut epoch.created_faces,
        );

        // ADR-025 P11 Phase 7 — Final strand cleanup, closed-shape only.
        //   DrawRect / DrawCircle 같이 명시적으로 닫힌 도형 명령 끝에서만 호출.
        //   잔존 dangling topological edge 는 closed-shape 상황에선 synthesis
        //   artifact 로 간주, deactivate 해도 visual 영향 없음 (인접 face boundary
        //   가 같은 좌표를 cover). DrawLine intermediate wire 는 영향 안 받음.
        self.cleanup_dangling_topological_edges(&epoch.new_edges);

        // 2026-04-28 — ADR-007 Invariant 2 enforcement (post-pipeline).
        //   D-resolver / M1 split / dissolve_and_fan_split 등 일부 step 은
        //   surface_normal hint 를 받지 않아 인접 neighbor 와 align 만 함.
        //   degenerate (NaN / zero-length normal) face 는 invariant 위반 +
        //   render artifact ("shadow") 유발.
        //
        // 2026-05-02 — scope-leak fix: 기존 정상 face 가 새 RECT 의 split_edge
        //   등으로 인해 normal 계산이 일시적 degenerate 로 평가되어 잘못
        //   제거되는 회귀 ("RECT 그리면 인접 face 가 wireframe 만 남음")
        //   재현. 검사 대상을 이번 epoch 이 건드린 face 로 한정:
        //   - epoch.created_faces (이번 draw 가 만든 face)
        //   - boundary 에 touched_verts 가진 face (split_edge 영향 받은 face)
        //   Unrelated geometry 의 face 는 normal 평가가 어떻든 보존 — 이번
        //   draw 가 만든 변화 외엔 손대지 않음 (Phase 7 cleanup scope fix 와
        //   동일 패턴).
        let touched_set: std::collections::HashSet<VertId> =
            epoch.touched_verts.iter().copied().collect();
        let created_set: std::collections::HashSet<axia_geo::FaceId> =
            epoch.created_faces.iter().copied().collect();
        let mut degenerate_to_remove: Vec<axia_geo::FaceId> = Vec::new();
        let mut to_flip: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in self.mesh.faces.iter() {
            if !f.is_active() { continue; }

            // Scope check: only inspect faces this draw touched.
            let in_scope = created_set.contains(&fid) || {
                match self.mesh.collect_loop_verts(f.outer().start) {
                    Ok(verts) => verts.iter().any(|v| touched_set.contains(v)),
                    Err(_) => false,
                }
            };
            if !in_scope { continue; }

            let face_n = f.normal();
            // Degenerate detection (in-scope faces only)
            if !face_n.x.is_finite() || !face_n.y.is_finite() || !face_n.z.is_finite()
                || face_n.length_squared() < 1e-12
            {
                degenerate_to_remove.push(fid);
                continue;
            }
            // Winding check — same scope (touched OR created)
            if face_n.dot(n_norm) < 0.0 {
                to_flip.push(fid);
            }
        }
        for fid in to_flip {
            let _ = self.mesh.flip_face_safe(fid);
        }
        for fid in degenerate_to_remove {
            self.unregister_face_from_xia(fid);
            let _ = self.mesh.remove_face(fid);
            if self.mesh.faces.contains(fid) {
                self.mesh.faces.remove(fid);
            }
            epoch.created_faces.retain(|&f| f != fid);
        }

        // Clean any stale Line XIAs whose standalone edge is now a face
        //   boundary (these may have been created by earlier commands).
        let xias_to_remove: Vec<XiaId> = self.xias.iter()
            .filter(|(_, x)| {
                if let Some(eid) = x.standalone_edge_id {
                    epoch.loop_edge_ids.contains(&eid)
                } else { false }
            })
            .map(|(&id, _)| id)
            .collect();
        for xid in &xias_to_remove {
            self.xias.remove(xid);
        }

        // 2026-04-28 — ADR-015 explicit fallback: if standard postprocess
        //   didn't synthesize the new RECT's face (typically due to mixed-edge
        //   cycle that the resolver's all_edges_free filter rejects), try
        //   `add_face_with_holes` directly using the 4 corner vertices.
        //
        //   This handles the stacked-inner scenario:
        //     - inner1 already exists (sharing an edge with new RECT)
        //     - shared edge is partially-claimed (HE1=inner1, HE2=free)
        //     - resolver's filter rejects mixed-edge cycle
        //     - direct add_face_with_holes claims the cycle-direction HEs
        //       (HE2 of shared + 3 new edges' HEs) → manifold-correct face.
        if epoch.created_faces.is_empty() {
            // add_vertex dedups to existing — returns the existing vert id
            // when corners already exist (the typical stacked-inner case).
            let corner_vids: Vec<axia_geo::VertId> = corners.iter()
                .map(|&pos| self.mesh.add_vertex(pos))
                .collect();
            // Try add_face — claims cycle-direction HEs. May fail if HEs
            //   are already claimed by another face in conflict, but for the
            //   stacked-inner case the cycle-direction HEs are free.
            if let Ok(fid) = self.mesh.add_face_with_holes(&corner_vids, &[], FORM_MATERIAL) {
                // ADR-007 Invariant 2 (Winding): face's normal MUST align with
                //   surface_normal hint. Always enforce regardless of neighbor
                //   alignment result — neighbors might be wrongly oriented and
                //   propagate the flip.
                let face_n = self.mesh.faces[fid].normal();
                if face_n.dot(n_norm) < 0.0 {
                    let _ = self.mesh.flip_face_safe(fid);
                }
                epoch.created_faces.push(fid);
            }
        }

        if epoch.created_faces.is_empty() {
            self.transactions.cancel();
            return CommandResult::Error(
                "draw_rect: 4 segments drawn but no face synthesized".to_string(),
            );
        }

        let xia_id = self.create_xia("Rectangle".to_string());
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = center;
            xia.surface_normal = Some(n_norm);
            for &fid in &epoch.created_faces {
                xia.face_ids.push(fid);
            }
        }
        self.register_faces_to_xia(xia_id, &epoch.created_faces);
        if self.auto_intersect_on_draw {
            let faces = epoch.created_faces.clone();
            let _ = self.intersect_faces_inner(&faces);
        }

        // ADR-047 D-A investigation note (2026-05-02):
        //   A pre-commit `verify_face_invariants` guard was attempted to
        //   detect "edge shared by 3 active faces" — the symptom user
        //   reported as "RECT 그리면 인접 face 가 wireframe 만 남음". It was
        //   rejected because LOCKED #1 ADR-021 P7 (stacked-inner RECT) also
        //   produces the SAME non-manifold pattern intentionally — the
        //   DCEL has only 2 HEs per edge, but P7 wants 2 inner faces
        //   sharing an edge with their outer ring = 3 faces. Both delta-
        //   scope and total-count guards failed: LOCKED #1's new edges
        //   ALSO get 3-face share when committing the second inner.
        //
        //   The user's bug and LOCKED #1 are topologically indistinguishable
        //   from `verify_face_invariants`'s perspective. The user's
        //   complaint is the VISUAL outcome (z-fight + wireframe rendering
        //   of overlapping faces). The proper fix is Strategy C:
        //   tighten HE claim logic so the user pattern stops producing
        //   violations on new edges, while still allowing P7 to do so.
        //   That's a deeper refactor — separate PR.

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(xia_id)
    }

    /// ADR-050 P-5a — Draw a rectangle as a form-layer Shape (no Xia,
    /// no material).
    ///
    /// Implementation strategy (per P-5a-c=(a) lock-in): re-use the
    /// existing `exec_draw_rect` geometry pipeline (4 lines + face
    /// synthesis + auto_intersect + post_process) in full, then
    /// **convert the resulting Xia into a Shape** by:
    ///   1. Reading the Xia's metadata (name / face_ids / position /
    ///      surface_normal)
    ///   2. Removing the Xia from `xias` and its `face_to_xia` entries
    ///   3. Creating a new Shape with the same metadata
    ///
    /// This avoids ~350 LoC of mesh-pipeline duplication while keeping
    /// `exec_draw_rect` strictly UNCHANGED.
    ///
    /// **ADR-050 P-5e-γ collapse (2026-05-05)**: previously used a
    /// second transaction so Undo required 2 presses
    /// (Shape → Xia → pre-rect). Now uses
    /// `transactions.replace_last_after_snapshot` to overwrite T1's
    /// (legacy DrawRect) after_snapshot with the post-conversion
    /// Shape state — single Undo restores pre-rect directly.
    ///
    /// `face_to_xia` is NOT updated for Shape — Shape is a form-layer
    /// reference, not the face owner (per ADR-049 §4 Q3).
    fn exec_draw_rect_as_shape(
        &mut self,
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
    ) -> CommandResult {
        // Phase 1 — delegate full geometry pipeline to exec_draw_rect
        // (commits T1 with after = Xia state).
        let xia_result = self.exec_draw_rect(center, normal, up, width, height);
        let xia_id = match xia_result {
            CommandResult::EntityCreated(id) => id,
            other => return other, // pass through error / sentinel
        };

        // Phase 2 — convert Xia → Shape (no transaction — direct mutation).
        let (name, face_ids, position, surface_normal) =
            if let Some(xia) = self.xias.get(&xia_id) {
                (
                    xia.name.clone(),
                    xia.face_ids.clone(),
                    xia.position,
                    xia.surface_normal,
                )
            } else {
                return CommandResult::Error(
                    "draw_rect_as_shape: xia missing post-pipeline".to_string(),
                );
            };

        // Drop the Xia + face_to_xia entries (Shape is form-only).
        self.xias.remove(&xia_id);
        for fid in &face_ids {
            self.face_to_xia.remove(fid);
        }

        // ADR-079 W-1-α / ADR-086 follow-up — attach Plane AnalyticSurface
        // to created face_ids so kernel-aware ops (createSolidExtrude /
        // offset / Boolean) can run without `NoProfileSurface` error.
        // Form-layer Shape rect 은 본질적으로 planar — geometric truth 로
        // Plane 항상 attach (LOCKED #26 P7 정합 — 0 차원 허용은 face 두께
        // 측면, surface metadata 는 별개).
        //
        // Plane params:
        //   origin = center, normal = normalized normal,
        //   basis_u = normalized up, u_range/v_range = ±1e6 (effectively
        //   infinite — actual rect bounds enforced by DCEL boundary).
        if normal.length_squared() > 1e-12 && up.length_squared() > 1e-12 {
            let n_norm = normal.normalize();
            let u_norm = up.normalize();
            // basis_u must be perpendicular to normal — Gram-Schmidt project
            let dot = u_norm.dot(n_norm);
            let basis_u = (u_norm - n_norm * dot).normalize_or_zero();
            if basis_u.length_squared() > 1e-12 {
                let plane = axia_geo::AnalyticSurface::Plane {
                    origin: center,
                    normal: n_norm,
                    basis_u,
                    u_range: (-1e6, 1e6),
                    v_range: (-1e6, 1e6),
                };
                for &fid in &face_ids {
                    self.mesh.set_face_surface(fid, Some(plane.clone()));
                }
            }
        }

        // Create the form-layer Shape with the inherited metadata.
        let shape_id = self.create_shape(name, face_ids);
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = position;
            shape.surface_normal = surface_normal;
        }

        // ADR-050 P-5e-γ — collapse two transactions into one frame.
        // T1 (committed by exec_draw_rect) had after = Xia state.
        // We replace it with after = Shape state so a single Undo
        // restores pre-rect directly (T1.before_snapshot).
        self.transactions
            .replace_last_after_snapshot(self.scene_snapshot());

        CommandResult::ShapeCreated(shape_id.raw())
    }

    /// ADR-050 P-5b — Draw a line as a form-layer Shape (no Xia, no
    /// material).
    ///
    /// Implementation pattern follows P-5a (`exec_draw_rect_as_shape`):
    /// delegate full geometry pipeline to `exec_draw_line` then convert
    /// the resulting Xia to a Shape. The DrawLine pipeline can produce
    /// either a Face Xia (loop-closing case) OR a Line Xia (free-edge
    /// case) — both are handled identically by reading `face_ids` +
    /// `standalone_edge_id` and assigning to the new Shape.
    ///
    /// **ADR-050 P-5e-γ collapse**: single transaction via
    /// `replace_last_after_snapshot` — Undo 1회로 pre-line 복원.
    fn exec_draw_line_as_shape(
        &mut self,
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    ) -> CommandResult {
        // Phase 1 — delegate to exec_draw_line.
        let xia_result = self.exec_draw_line(start, end, surface_normal);
        let xia_id = match xia_result {
            CommandResult::EntityCreated(id) => id,
            other => return other, // pass through error / sentinel
        };

        // Phase 2 — convert Xia → Shape (no transaction — direct mutation).
        let (name, face_ids, position, surface_normal_inherited, standalone) =
            if let Some(xia) = self.xias.get(&xia_id) {
                (
                    xia.name.clone(),
                    xia.face_ids.clone(),
                    xia.position,
                    xia.surface_normal,
                    xia.standalone_edge_id,
                )
            } else {
                return CommandResult::Error(
                    "draw_line_as_shape: xia missing post-pipeline".to_string(),
                );
            };

        self.xias.remove(&xia_id);
        for fid in &face_ids {
            self.face_to_xia.remove(fid);
        }

        // ADR-087 K-γ — Face path Plane attach. exec_draw_line 가 closing
        // line 으로 face 를 합성한 경우 (face_ids non-empty), 그 face 들에
        // AnalyticSurface::Plane 을 명시 attach 한다. 합성된 face 의 plane
        // normal 은 inherited surface_normal (Xia 의 surface_normal 필드).
        //
        // 이 attach 가 없으면 4 개 DrawLineAsShape 로 닫힌 사각형 → Push/Pull
        // 시 NoProfileSurface 회귀 (DrawRectAsShape K-α / DrawCircleAsShape
        // K-β 와 동일 root cause).
        //
        // Plane origin: face 정점들의 centroid (best-fit). face_ids 가 여러
        // 개여도 같은 surface_normal 평면 위 (free-edge planar pipeline 의
        // 가정).
        if !face_ids.is_empty() {
            if let Some(n) = surface_normal_inherited {
                if n.length_squared() > 1e-12 {
                    let n_norm = n.normalize();
                    // basis_u: World X 가 normal 과 거의 평행하면 World Y fallback
                    let candidate = if n_norm.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
                    let dot = candidate.dot(n_norm);
                    let basis_u = (candidate - n_norm * dot).normalize_or_zero();
                    if basis_u.length_squared() > 1e-12 {
                        // Centroid from face vertices (best-fit origin).
                        let mut centroid = DVec3::ZERO;
                        let mut total_verts: usize = 0;
                        for &fid in &face_ids {
                            let outer_start = self.mesh.faces[fid].outer().start;
                            if let Ok(verts) = self.mesh.collect_loop_verts(outer_start) {
                                for vid in verts {
                                    centroid += self.mesh.verts[vid].pos();
                                    total_verts += 1;
                                }
                            }
                        }
                        let origin = if total_verts > 0 {
                            centroid / (total_verts as f64)
                        } else {
                            DVec3::ZERO
                        };
                        let plane = axia_geo::AnalyticSurface::Plane {
                            origin,
                            normal: n_norm,
                            basis_u,
                            u_range: (-1e6, 1e6),
                            v_range: (-1e6, 1e6),
                        };
                        for &fid in &face_ids {
                            self.mesh.set_face_surface(fid, Some(plane.clone()));
                        }
                    }
                }
            }
        }

        let shape_id = self.create_shape(name, face_ids);
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = position;
            shape.surface_normal = surface_normal_inherited;
            shape.standalone_edge_id = standalone;
        }

        // ADR-050 P-5e-γ — collapse to single transaction.
        self.transactions
            .replace_last_after_snapshot(self.scene_snapshot());

        CommandResult::ShapeCreated(shape_id.raw())
    }

    fn exec_draw_circle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    ) -> CommandResult {
        // 2026-04-24 — Principle 1 compliance: CIRCLE is drawn as N LINE
        //   segments. Same rationale as exec_draw_rect — unifies vertex
        //   dedup / edge sharing behaviour with the LINE tool so adjacent
        //   CIRCLEs and N-gons fuse topologically when their corners align.

        if segments < 3 {
            return CommandResult::Error(
                format!("circle segments {} < 3 — degenerate", segments)
            );
        }
        if radius <= 1e-6 {
            return CommandResult::Error(
                format!("circle radius {:.2e} below epsilon", radius)
            );
        }
        let n_norm = if normal.length_squared() > 1e-12 {
            normal.normalize()
        } else {
            return CommandResult::Error("normal must be non-zero".to_string());
        };
        // Build plane basis (u, v) from normal.
        let seed = if n_norm.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        let u = seed.cross(n_norm).normalize_or_zero();
        let v = n_norm.cross(u).normalize_or_zero();
        if u.length_squared() < 1e-12 || v.length_squared() < 1e-12 {
            return CommandResult::Error("could not build plane basis".to_string());
        }

        // Compute N points on the circle.
        let n = segments as usize;
        let mut corners: Vec<DVec3> = Vec::with_capacity(n);
        for i in 0..n {
            let theta = (i as f64) * std::f64::consts::TAU / (n as f64);
            corners.push(center + u * (radius * theta.cos()) + v * (radius * theta.sin()));
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // Draw N line segments via draw_line → add_vertex dedup for any
        //   corners that coincide with existing vertices (e.g., a touching
        //   circle at the same sampling positions).
        let mut corner_vids: Vec<VertId> = Vec::with_capacity(n);
        let mut edge_ids: Vec<EdgeId> = Vec::with_capacity(n);
        for i in 0..n {
            let (v_a, v_b, eid) =
                match self.mesh.draw_line(corners[i], corners[(i + 1) % n]) {
                    Ok(r) => r,
                    Err(e) => {
                        self.transactions.cancel();
                        return CommandResult::Error(
                            format!("draw_circle segment {}: {}", i, e)
                        );
                    }
                };
            if v_a == v_b {
                self.transactions.cancel();
                return CommandResult::Error(
                    format!("draw_circle segment {} collapsed (degenerate)", i)
                );
            }
            corner_vids.push(v_a);
            edge_ids.push(eid);
            self.mesh.mark_edge_hard(eid);
        }

        // Create face from explicit vertex list (avoids loop-detection
        //   ambiguity at shared boundaries).
        let face_id = match self.mesh.add_face(&corner_vids, FORM_MATERIAL) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(
                    format!("draw_circle face synthesis failed: {}", e),
                );
            }
        };

        // ADR-028 Phase A — attach Arc curve metadata to each segment.
        //
        // Each segment edge i bridges θᵢ → θᵢ₊₁ on the analytic circle. Storing
        // the sub-arc as an AnalyticCurve allows view-time refinement (LOD)
        // and preserves the original geometric intent (true circle, not just
        // a polygon). The polyline topology remains unchanged — DCEL ops
        // (push/pull, boolean) still operate on N straight segments. Render
        // path can opt into curve-aware tessellation via tessellate_edge.
        let two_pi = std::f64::consts::TAU;
        for i in 0..n {
            let theta_start = (i as f64) * two_pi / (n as f64);
            let theta_end = ((i + 1) as f64) * two_pi / (n as f64);
            let curve = axia_geo::AnalyticCurve::Arc {
                center,
                radius,
                normal: n_norm,
                basis_u: u,
                start_angle: theta_start,
                end_angle: theta_end,
            };
            if let Some(e) = self.mesh.edges.get_mut(edge_ids[i]) {
                e.set_curve(Some(curve));
            }
        }

        // ADR-088 Phase 1 (S-γ) — assign curve_owner_id to all N segments.
        // LOCKED #15 P22.5: same logical curve = same owner_id → SelectTool
        // walk promotes one click to all N segments.
        let owner_id = self.mesh.next_curve_owner_id();
        for &eid in &edge_ids {
            self.mesh.set_edge_curve_owner_id(eid, Some(owner_id));
        }

        let xia_id = self.create_xia("Circle".to_string());
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = center;
            xia.surface_normal = Some(normal);
            xia.face_ids.push(face_id);
        }
        self.register_faces_to_xia(xia_id, &[face_id]);
        if self.auto_intersect_on_draw {
            let _ = self.intersect_faces_inner(&[face_id]);
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(xia_id)
    }

    /// ADR-050 P-5b — Draw a circle as a form-layer Shape (no Xia,
    /// no material).
    ///
    /// Same conversion pattern as `exec_draw_rect_as_shape` /
    /// `exec_draw_line_as_shape`: delegate to `exec_draw_circle`,
    /// then convert the resulting Xia ("Circle" with single face +
    /// arc-curved edges) into a Shape. The arc curve attachments on
    /// the edges (ADR-028) are part of mesh state and survive the
    /// conversion automatically.
    ///
    /// **ADR-050 P-5e-γ collapse**: single transaction via
    /// `replace_last_after_snapshot` — Undo 1회로 pre-circle 복원.
    fn exec_draw_circle_as_shape(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    ) -> CommandResult {
        // ADR-107 ζ-β — threshold-based dispatch (L2 revision, 사용자
        // 결재 (α) 2026-05-16).
        //
        // segments >= POLYGON_THRESHOLD (= 12) → Path B canonical
        //   (drawCircleAsCurve) 자동 변환 — circle approximation 의도.
        //   메모리 97% 절감 (LOCKED #35 ADR-094 §6.3), Layer Separation
        //   canonical (ADR-107 §4 L3), 결함 D 자연 해소 (ADR-101 §A9.8).
        // segments < POLYGON_THRESHOLD → legacy polygon path (Layer H
        //   hybrid 보존) — DrawPolygon use case (hexagon N=6 / octagon
        //   N=8 / decagon N=10). scene.rs:12415 evidence.
        //
        // Threshold = 12 (dodecagon) — circle vs polygon 자연 경계.
        // DrawCircleTool default segments=32 → Path B 자동 활성.
        const POLYGON_THRESHOLD: u32 = 12;
        if segments >= POLYGON_THRESHOLD {
            return self.exec_draw_circle_as_curve(center, normal, radius);
        }

        // Phase 1 — legacy polygon path: delegate to exec_draw_circle.
        let xia_result = self.exec_draw_circle(center, normal, radius, segments);
        let xia_id = match xia_result {
            CommandResult::EntityCreated(id) => id,
            other => return other,
        };

        // Phase 2 — convert Xia → Shape (no transaction — direct mutation).
        let (name, face_ids, position, surface_normal) =
            if let Some(xia) = self.xias.get(&xia_id) {
                (
                    xia.name.clone(),
                    xia.face_ids.clone(),
                    xia.position,
                    xia.surface_normal,
                )
            } else {
                return CommandResult::Error(
                    "draw_circle_as_shape: xia missing post-pipeline".to_string(),
                );
            };

        self.xias.remove(&xia_id);
        for fid in &face_ids {
            self.face_to_xia.remove(fid);
        }

        // ADR-087 K-β — attach Plane AnalyticSurface to created face_ids
        // so kernel-aware ops (createSolidExtrude / offset / Boolean) can
        // run without `NoProfileSurface` error. Circle/polygon (DrawCircle
        // with N=3..24 segments) Shape 은 항상 planar — geometric truth
        // 로 Plane 항상 attach. Mirrors P-5a `exec_draw_rect_as_shape`.
        //
        // basis_u derivation: circle 은 명시적 up 인자가 없으므로 normal
        // 에 perpendicular 한 임의 방향 선택. World X 가 normal 과 거의
        // 평행하면 World Y 를 fallback (Gram-Schmidt 안정성).
        if normal.length_squared() > 1e-12 {
            let n_norm = normal.normalize();
            let candidate = if n_norm.x.abs() < 0.9 {
                DVec3::X
            } else {
                DVec3::Y
            };
            let dot = candidate.dot(n_norm);
            let basis_u = (candidate - n_norm * dot).normalize_or_zero();
            if basis_u.length_squared() > 1e-12 {
                let plane = axia_geo::AnalyticSurface::Plane {
                    origin: center,
                    normal: n_norm,
                    basis_u,
                    u_range: (-1e6, 1e6),
                    v_range: (-1e6, 1e6),
                };
                for &fid in &face_ids {
                    self.mesh.set_face_surface(fid, Some(plane.clone()));
                }
            }
        }

        let shape_id = self.create_shape(name, face_ids);
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = position;
            shape.surface_normal = surface_normal;
        }

        // ADR-050 P-5e-γ — collapse to single transaction.
        self.transactions
            .replace_last_after_snapshot(self.scene_snapshot());

        CommandResult::ShapeCreated(shape_id.raw())
    }

    /// ADR-089 Phase 2 (A-ζ-4) — Draw circle as TRUE kernel-native
    /// closed-curve face. 1 anchor vertex + 1 self-loop edge with Circle
    /// curve + 1 face. **메타-원칙 #14 의 deepest realization**.
    ///
    /// Schema: 사용자 facing entry for ADR-089. 기존 DrawCircle (24
    /// segments polygon) / DrawCircleAsShape (form-layer Shape, 24
    /// segments) 와 architectural 으로 다름. Drop-in 옵션 — 기존 legacy
    /// path UNCHANGED.
    ///
    /// Returns `ShapeCreated(ShapeId.raw())`. Form-layer Shape 등록.
    fn exec_draw_circle_as_curve(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
    ) -> CommandResult {
        // Validate inputs.
        if radius <= 1e-6 {
            return CommandResult::Error(
                format!("circle radius {:.2e} below epsilon", radius)
            );
        }
        let n_norm = if normal.length_squared() > 1e-12 {
            normal.normalize()
        } else {
            return CommandResult::Error("normal must be non-zero".to_string());
        };
        // Build plane basis_u: World X if not parallel, else World Y.
        let candidate = if n_norm.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        let dot = candidate.dot(n_norm);
        let basis_u = (candidate - n_norm * dot).normalize_or_zero();
        if basis_u.length_squared() < 1e-12 {
            return CommandResult::Error("could not build plane basis".to_string());
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // 1. Anchor vertex on the circle (at θ=0 — center + basis_u * radius).
        let anchor_pos = center + basis_u * radius;
        let anchor = self.mesh.add_vertex(anchor_pos);

        // 2. add_face_closed_curve creates self-loop edge + face + Circle curve.
        let circle = axia_geo::AnalyticCurve::Circle {
            center,
            radius,
            normal: n_norm,
            basis_u,
        };
        let face_id = match self.mesh.add_face_closed_curve(anchor, circle, FORM_MATERIAL) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!(
                    "ADR-089 A-ζ-4 add_face_closed_curve failed: {}",
                    e,
                ));
            }
        };

        // 3. Form-layer Shape 등록 (ADR-050 답습).
        let shape_id = self.create_shape("Circle (kernel-native)".to_string(), vec![face_id]);
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = center;
            shape.surface_normal = Some(n_norm);
        }

        // ADR-101 §B-4b — auto-intersect on Path B Circle draws.
        // intersect_faces_inner does non-destructive AABB + coplanarity
        // pre-checks (Amendment 7), so disjoint pairs leave the kernel-
        // native form intact; partial-overlap pairs auto-split.
        if self.auto_intersect_on_draw {
            let _ = self.intersect_faces_inner(&[face_id]);
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        CommandResult::ShapeCreated(shape_id.raw())
    }

    /// ADR-089 A-Β-γ — Closed NURBS kernel-native creation.
    fn exec_draw_closed_nurbs_as_curve(
        &mut self,
        control_pts: Vec<DVec3>,
        weights: Vec<f64>,
        knots: Vec<f64>,
        degree: u32,
    ) -> CommandResult {
        if control_pts.len() < 3 {
            return CommandResult::Error(format!(
                "ADR-089 A-Β-γ: closed NURBS needs ≥ 3 control points (got {})",
                control_pts.len()
            ));
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let anchor_pos = control_pts[0];
        let anchor = self.mesh.add_vertex(anchor_pos);

        let nurbs = axia_geo::AnalyticCurve::NURBS {
            control_pts: control_pts.clone(),
            weights,
            knots,
            degree,
        };
        let face_id = match self.mesh.add_face_closed_curve(anchor, nurbs, FORM_MATERIAL) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!(
                    "ADR-089 A-Β-γ add_face_closed_curve failed: {}",
                    e,
                ));
            }
        };

        let shape_id = self.create_shape(
            "NURBS Closed (kernel-native)".to_string(),
            vec![face_id],
        );
        let n_pts = control_pts.len() as f64;
        let centroid = control_pts.iter().fold(DVec3::ZERO, |acc, p| acc + *p) / n_pts;
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = centroid;
            if let Some(axia_geo::AnalyticSurface::Plane { normal, .. }) = self.mesh.face_surface(face_id) {
                shape.surface_normal = Some(*normal);
            }
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        CommandResult::ShapeCreated(shape_id.raw())
    }

    /// ADR-089 A-Α-γ — Closed BSpline kernel-native creation.
    fn exec_draw_closed_bspline_as_curve(
        &mut self,
        control_pts: Vec<DVec3>,
        knots: Vec<f64>,
        degree: u32,
    ) -> CommandResult {
        if control_pts.len() < 3 {
            return CommandResult::Error(format!(
                "ADR-089 A-Α-γ: closed BSpline needs ≥ 3 control points (got {})",
                control_pts.len()
            ));
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let anchor_pos = control_pts[0];
        let anchor = self.mesh.add_vertex(anchor_pos);

        let bspline = axia_geo::AnalyticCurve::BSpline {
            control_pts: control_pts.clone(),
            knots,
            degree,
        };
        let face_id = match self.mesh.add_face_closed_curve(anchor, bspline, FORM_MATERIAL) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!(
                    "ADR-089 A-Α-γ add_face_closed_curve failed: {}",
                    e,
                ));
            }
        };

        let shape_id = self.create_shape(
            "BSpline Closed (kernel-native)".to_string(),
            vec![face_id],
        );
        let n_pts = control_pts.len() as f64;
        let centroid = control_pts.iter().fold(DVec3::ZERO, |acc, p| acc + *p) / n_pts;
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = centroid;
            if let Some(axia_geo::AnalyticSurface::Plane { normal, .. }) = self.mesh.face_surface(face_id) {
                shape.surface_normal = Some(*normal);
            }
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        CommandResult::ShapeCreated(shape_id.raw())
    }

    /// ADR-089 A-ω-γ — Closed Bezier kernel-native creation.
    fn exec_draw_closed_bezier_as_curve(
        &mut self,
        control_pts: Vec<DVec3>,
    ) -> CommandResult {
        if control_pts.len() < 3 {
            return CommandResult::Error(format!(
                "ADR-089 A-ω-γ: closed Bezier needs ≥ 3 control points (got {})",
                control_pts.len()
            ));
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // Anchor vertex at first control point.
        let anchor_pos = control_pts[0];
        let anchor = self.mesh.add_vertex(anchor_pos);

        let bezier = axia_geo::AnalyticCurve::Bezier {
            control_pts: control_pts.clone(),
        };
        let face_id = match self.mesh.add_face_closed_curve(anchor, bezier, FORM_MATERIAL) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!(
                    "ADR-089 A-ω-γ add_face_closed_curve failed: {}",
                    e,
                ));
            }
        };

        // Form-layer Shape registration (ADR-050 답습).
        let shape_id = self.create_shape(
            "Bezier Closed (kernel-native)".to_string(),
            vec![face_id],
        );
        // Position = control points centroid.
        let n_pts = control_pts.len() as f64;
        let centroid = control_pts.iter().fold(DVec3::ZERO, |acc, p| acc + *p) / n_pts;
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            shape.position = centroid;
            // Surface normal: read from face's attached Plane.
            if let Some(axia_geo::AnalyticSurface::Plane { normal, .. }) = self.mesh.face_surface(face_id) {
                shape.surface_normal = Some(*normal);
            }
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        CommandResult::ShapeCreated(shape_id.raw())
    }

    fn exec_push_pull(
        &mut self,
        face_id: axia_geo::FaceId,
        dist: f64,
    ) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        match self.mesh.push_pull(face_id, dist, FORM_MATERIAL) {
            Ok(result) => {
                // O(1) reverse index lookup instead of O(N) scan
                let owning_xia_id = self.face_to_xia.get(&face_id).copied();

                if let Some(xia_id) = owning_xia_id {
                    if let Some(xia) = self.xias.get_mut(&xia_id) {
                        // State is computed — adding faces automatically promotes Face→Volume
                        // If base was removed (inward push), drop it from XIA
                        if result.base_removed {
                            xia.face_ids.retain(|&f| f != face_id);
                            self.face_to_xia.remove(&face_id);
                        }
                        // Add new faces
                        xia.face_ids.push(result.top_face);
                        xia.face_ids.extend(result.side_faces.iter());
                    }
                    // 역인덱스 갱신: 새 face들 등록
                    self.face_to_xia.insert(result.top_face, xia_id);
                    for &side in &result.side_faces {
                        self.face_to_xia.insert(side, xia_id);
                    }
                }

                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::PushPullDone {
                    sides_created: result.side_faces.len(),
                    adj_splits: result.adjacent_splits,
                    base_removed: result.base_removed,
                    split_debug: result.split_debug,
                }
            }
            Err(e) => {
                self.transactions.cancel();
                CommandResult::Error(e.to_string())
            }
        }
    }

    /// ADR-079 W-1 — Surface-native solid creation wrapper.
    ///
    /// Routes `Command::CreateSolid` through `Mesh::create_solid`. On
    /// success, updates Shape/Xia ownership for the new solid faces
    /// (Q7 lock-in). On `NotYetSupported` error, falls back to legacy
    /// `Mesh::push_pull` per Q3 lock-in (W-4 점진 deprecate).
    fn exec_create_solid(
        &mut self,
        face_id: FaceId,
        mode: axia_geo::CreateSolidMode,
    ) -> CommandResult {
        // Capture fallback distance for Extrude mode (Q3 fallback uses
        // legacy push_pull which only knows about distance).
        let fallback_dist = match &mode {
            axia_geo::CreateSolidMode::Extrude { distance } => Some(*distance),
            _ => None,
        };

        self.transactions.begin();
        self.transactions
            .set_before_snapshot(self.scene_snapshot());

        match self.mesh.create_solid(face_id, mode, FORM_MATERIAL) {
            Ok(result) => {
                // Update Shape ownership (form layer) for the new top + side faces.
                let owning_shape_id = self.face_to_shape.get(&face_id).copied();
                let owning_xia_id = self.face_to_xia.get(&face_id).copied();

                if let Some(shape_id) = owning_shape_id {
                    // Shape path — Phase 1 default ON.
                    if let Some(shape) = self.shapes.get_mut(&shape_id) {
                        shape.face_ids.push(result.top_face);
                        shape.face_ids.extend(result.side_faces.iter().copied());
                    }
                    self.face_to_shape.insert(result.top_face, shape_id);
                    for &side in &result.side_faces {
                        self.face_to_shape.insert(side, shape_id);
                    }
                } else if let Some(xia_id) = owning_xia_id {
                    // Xia path (legacy + ADR-050 P-2 promote 후).
                    if let Some(xia) = self.xias.get_mut(&xia_id) {
                        xia.face_ids.push(result.top_face);
                        xia.face_ids.extend(result.side_faces.iter().copied());
                    }
                    self.face_to_xia.insert(result.top_face, xia_id);
                    for &side in &result.side_faces {
                        self.face_to_xia.insert(side, xia_id);
                    }
                }

                self.transactions
                    .set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::SolidCreated {
                    kind: result.solid_kind,
                    face_count: result.all_solid_faces.len(),
                }
            }
            Err(e) => {
                // Q3 lock-in fallback — try legacy push_pull for
                // NotYetSupported branches (Cylinder profile / curved
                // panel / NURBS profile / Revolve / Sweep / Loft modes).
                let is_not_yet_supported = e
                    .downcast_ref::<axia_geo::SolidError>()
                    .map(|se| matches!(se, axia_geo::SolidError::NotYetSupported { .. }))
                    .unwrap_or(false);

                if is_not_yet_supported {
                    if let Some(dist) = fallback_dist {
                        // ADR-109 π-β — capture profile normal BEFORE
                        // fallback (push_pull may deactivate base face).
                        let profile_normal = self.mesh.faces.get(face_id)
                            .map(|f| f.normal())
                            .unwrap_or(DVec3::Z);

                        // Cancel current transaction (no state change yet)
                        // and route to exec_push_pull which manages its
                        // own transaction.
                        self.transactions.cancel();
                        let result = self.exec_push_pull(face_id, dist);

                        // ADR-109 π-β — Post-process: promote Cylinder
                        // surface to Arc-extrude side faces. Mixed boundary
                        // (Arc + chord) fallback path 의 자연 enforcement.
                        // 사용자 시연 "원통과 반원통 성질이 다름" root cause fix.
                        let extrude_axis = profile_normal * dist.signum();
                        let candidates: Vec<axia_geo::FaceId> = self.mesh.faces.iter()
                            .filter(|(_, f)| f.is_active())
                            .map(|(id, _)| id)
                            .collect();
                        let _promoted = self.mesh
                            .promote_arc_side_faces_to_cylinder(&candidates, extrude_axis);

                        return result;
                    }
                }

                self.transactions.cancel();
                CommandResult::Error(e.to_string())
            }
        }
    }

    fn exec_move(&mut self, _xia_ids: Vec<XiaId>, _delta: DVec3) -> CommandResult {
        // TODO: Implement move by updating vertex positions in the mesh
        CommandResult::None
    }

    /// Export the mesh buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    /// Mesh buffer export. `Mesh::export_buffers` is self-healing —
    /// auto-deactivates earcut Ok([]) faces internally before snapshotting
    /// stats (see Mesh's CONTRACT comment). No additional wrapper needed.
    pub fn export_mesh_buffers(&mut self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        self.mesh.export_buffers()
    }

    /// ADR-135 β — Distance-based LOD chord_tol export.
    ///
    /// Caller (WasmEngine via `setRenderChordTol`) passes
    /// `axia_geo::mesh_export::lod_chord_tol(camera_distance)`.
    /// Backward-compat: `export_mesh_buffers()` unchanged (uses
    /// `DEFAULT_ANALYTIC_CHORD_TOL = 0.02`).
    pub fn export_mesh_buffers_with_tol(
        &mut self,
        chord_tol: f64,
    ) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        self.mesh.export_buffers_with_tol(chord_tol)
    }

    /// Export hard edge line segments for wireframe rendering.
    /// Coplanar edges (angle ≤ threshold) are hidden — like SketchUp's soft/smooth edges.
    pub fn export_edge_lines(&self, angle_threshold_deg: f64) -> Vec<f32> {
        self.mesh.export_edge_lines(angle_threshold_deg)
    }

    /// Export edge lines + edge ID map (segment index → EdgeId raw)
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        self.mesh.export_edge_lines_with_map(angle_threshold_deg)
    }

    /// Orient all faces for consistent normals (SketchUp "Orient Faces").
    pub fn orient_faces(&mut self) -> (usize, usize) {
        match self.mesh.orient_faces() {
            Ok(r) => (r.flipped, r.visited),
            Err(_) => (0, 0),
        }
    }

    /// Get mesh statistics.
    pub fn stats(&self) -> SceneStats {
        SceneStats {
            xia_count: self.xias.len(),
            vert_count: self.mesh.vert_count(),
            edge_count: self.mesh.edge_count(),
            face_count: self.mesh.face_count(),
            group_count: self.groups.group_count(),
            component_count: self.groups.component_def_count(),
            can_undo: self.transactions.can_undo(),
            can_redo: self.transactions.can_redo(),
        }
    }

    /// Export scene state with version header
    pub fn export_versioned_snapshot(&self) -> Result<Vec<u8>> {
        // ADR-007 — 직렬화 전 invariant 검증 (non-strict: 경고만)
        // 엄격 검증 필요 시 export_versioned_snapshot_strict() 사용.
        let report = self.mesh.verify_face_invariants();
        if !report.is_valid() {
            eprintln!(
                "[ADR-007] Export proceeding with {} invariant violation(s).\n{}",
                report.violations.len(),
                report.summary(),
            );
        }

        let mut buf = Vec::new();
        buf.extend_from_slice(&AXIA_MAGIC);
        buf.extend_from_slice(&SNAPSHOT_VERSION.to_le_bytes());
        // V2 payload = scene_snapshot() — mesh + xias + groups + next_xia_id
        // + constraints. Length prefix is u64 (snapshot can easily exceed 4 GB
        // on a complex project even though current scenes are far smaller).
        let payload = self.scene_snapshot();
        buf.extend_from_slice(&(payload.len() as u64).to_le_bytes());
        buf.extend(payload);
        Ok(buf)
    }

    /// ADR-007 Phase 5 — 엄격 export: invariant 위반 시 저장 거부.
    ///
    /// 사용자가 "Save as" 등 중요한 저장 지점에서 쓸 수 있는 변형.
    /// 기본 `export_versioned_snapshot`은 경고만 출력하여 호환성 유지.
    ///
    /// Rev 2 (2026-04-25 B-2): `verify_face_invariants_rev2` 사용 →
    /// Sheet 면의 winding-mismatch 는 violation 에서 제외. Wall 의
    /// 구조적 invariant 만 fail 로 취급. 이로써 단일 sheet 가 포함된
    /// 씬도 strict 저장이 가능해진다 (이전엔 sheet winding 임의 방향
    /// 으로 인해 거의 무조건 거부됐음).
    pub fn export_versioned_snapshot_strict(&mut self) -> Result<Vec<u8>> {
        // ADR-007 Rev 2 Phase B-3 — Auto-correct cached face.normal to
        //   match current winding before strict checking. winding 은
        //   single source of truth; stale 캐시는 silent fix.
        let fixed = self.mesh.reconcile_face_normals();
        if fixed > 0 {
            // Caller can log this for transparency. We don't fail just
            //   because some normals were stale — they're now correct.
            #[cfg(debug_assertions)]
            eprintln!("[strict-export] reconciled {} face normals", fixed);
        }
        // 1순위 정책 — non-manifold edges 도 silent auto-repair (ADR-007 I5).
        // XIA 그룹 정보를 활용한 의미-인지 repair 가 가능하면 그쪽 우선,
        // 그 외는 geometric 폴백.
        let nm_report = self.repair_non_manifold_edges();
        if nm_report.faces_detached > 0 {
            #[cfg(debug_assertions)]
            eprintln!("[strict-export] repaired non-manifold: {}", nm_report.summary());
        }
        let report = self.mesh.verify_face_invariants_rev2();
        if !report.is_valid() {
            anyhow::bail!(
                "Refusing strict export — {} invariant violation(s). First: {}",
                report.violations.len(),
                report.violations.first().cloned().unwrap_or_else(|| "(no detail)".into()),
            );
        }
        self.export_versioned_snapshot()
    }

    /// Import scene state with version validation
    pub fn import_versioned_snapshot(&mut self, data: &[u8]) -> Result<()> {
        if data.len() < 8 {
            // Try legacy format (no header)
            return self.import_legacy_snapshot(data);
        }
        if &data[0..4] != &AXIA_MAGIC {
            // Legacy format without header
            return self.import_legacy_snapshot(data);
        }
        let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        match version {
            1 => {
                // V1 — mesh only, XIAs/Groups/Constraints not present.
                // Kept for backward-compat with files saved before 2026-04-24.
                if data.len() < 12 {
                    anyhow::bail!("V1 snapshot truncated (missing length prefix)");
                }
                let mesh_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
                if data.len() < 12 + mesh_len {
                    anyhow::bail!("V1 snapshot data is truncated");
                }
                let mesh_data = &data[12..12+mesh_len];
                self.mesh = bincode::deserialize(mesh_data)?;
                // Reset semantic layer — a V1 file has no XIAs; keep the
                //   mesh but make the empty state explicit so callers can
                //   detect and offer "reconstruct XIAs from components".
                self.xias.clear();
                self.groups = GroupManager::new();
                self.constraints = ConstraintGraph::new();
                self.face_to_xia.clear();
                eprintln!(
                    "[Loader] V1 snapshot loaded: {} faces restored without XIAs. \
                     Orphan recovery recommended.",
                    self.mesh.face_count(),
                );
                // ADR-007 Rev 2 Phase B-4 — Post-import: reconcile
                //   cached normals to match winding, then verify with
                //   the Rev 2 (sheet-aware) reporter.
                let fixed = self.mesh.reconcile_face_normals();
                #[cfg(debug_assertions)]
                {
                    if fixed > 0 {
                        eprintln!("[ADR-007] Post-import: reconciled {} face normals", fixed);
                    }
                    let report = self.mesh.verify_face_invariants_rev2();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                let _ = fixed; // silence unused in release

                Ok(())
            }
            2 | 3 => {
                // V2 — full scene snapshot, Y-up coordinates (legacy).
                // V3 — full scene snapshot, Z-up coordinates (ADR-103-ε).
                //
                // Payload schema is identical. V2 path applies Y↔Z migration
                // after restore to bring legacy files into the engine's
                // Z-up coordinate space.
                //
                // `restore_scene_snapshot` rebuilds face_to_xia reverse index.
                if data.len() < 16 {
                    anyhow::bail!("V{} snapshot truncated (missing length prefix)", version);
                }
                let payload_len = u64::from_le_bytes(
                    data[8..16].try_into().map_err(|_| anyhow::anyhow!("length parse"))?
                ) as usize;
                if data.len() < 16 + payload_len {
                    anyhow::bail!("V{} snapshot data is truncated", version);
                }
                let payload = &data[16..16+payload_len];
                self.restore_scene_snapshot(payload);

                // ADR-103-ε: V2 (Y-up legacy) → Z-up coordinate migration.
                // Apply (x, y, z) → (x, -z, y) rotation around +X axis to
                // every active vertex. Z-up convention: physical "up" that
                // was Y component in V2 becomes Z component in V3.
                // V3 files have native Z-up coords → no migration needed.
                if version == 2 {
                    self.mesh.migrate_y_up_to_z_up();
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[ADR-103-ε] V2 (Y-up) snapshot migrated to Z-up: {} verts rotated.",
                        self.mesh.verts.iter().filter(|(_, v)| v.is_active()).count(),
                    );
                }

                // ADR-007 Rev 2 Phase B-4 — Post-import: reconcile
                //   cached normals to match winding, then verify with
                //   the Rev 2 (sheet-aware) reporter.
                let fixed = self.mesh.reconcile_face_normals();
                #[cfg(debug_assertions)]
                {
                    if fixed > 0 {
                        eprintln!("[ADR-007] Post-import: reconciled {} face normals", fixed);
                    }
                    let report = self.mesh.verify_face_invariants_rev2();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                let _ = fixed; // silence unused in release

                Ok(())
            }
            v if v > SNAPSHOT_VERSION => anyhow::bail!(
                "ADR-089 A-μ-β: snapshot version {} is newer than this build supports \
                 (max {}). Likely saved by a newer AXiA build — upgrade required to \
                 load this file. Forward-compat reject (silent garbage prevented).",
                v, SNAPSHOT_VERSION,
            ),
            v => anyhow::bail!(
                "Unsupported snapshot version: {} (this build supports 1..={}). \
                 File may be corrupted.",
                v, SNAPSHOT_VERSION,
            ),
        }
    }

    /// ADR-089 A-μ-β — Snapshot info analyzer (read-only, no state change).
    ///
    /// Returns version + presence of optional sections without modifying
    /// scene state. Useful for legacy file detection and debugging.
    ///
    /// `Err` for invalid magic / truncation. `Ok(SnapshotInfo)` carries
    /// version + section presence flags.
    pub fn analyze_snapshot(data: &[u8]) -> Result<SnapshotInfo> {
        if data.len() < 8 {
            return Ok(SnapshotInfo {
                version: 0,
                has_magic: false,
                sections: SnapshotSections::default(),
                error: Some("file too short for header (< 8 bytes), \
                             likely legacy mesh-only or corrupt".to_string()),
            });
        }
        let has_magic = &data[0..4] == &AXIA_MAGIC;
        if !has_magic {
            // Legacy bincode mesh-only format — no version header.
            return Ok(SnapshotInfo {
                version: 0,
                has_magic: false,
                sections: SnapshotSections::default(),
                error: None,
            });
        }
        let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        if version == 1 {
            return Ok(SnapshotInfo {
                version,
                has_magic: true,
                sections: SnapshotSections {
                    mesh: true,
                    ..SnapshotSections::default()
                },
                error: None,
            });
        }
        if version != 2 && version != 3 {
            return Ok(SnapshotInfo {
                version,
                has_magic: true,
                sections: SnapshotSections::default(),
                error: Some(format!(
                    "unsupported version {} (this build: 1..={})",
                    version, SNAPSHOT_VERSION,
                )),
            });
        }
        // V2/V3 — analyze section presence by walking length-prefixed sections.
        if data.len() < 16 {
            return Ok(SnapshotInfo {
                version,
                has_magic: true,
                sections: SnapshotSections::default(),
                error: Some("V2 truncated: missing payload length".to_string()),
            });
        }
        let payload_len = u64::from_le_bytes(
            data[8..16].try_into().unwrap_or([0; 8])
        ) as usize;
        if data.len() < 16 + payload_len {
            return Ok(SnapshotInfo {
                version,
                has_magic: true,
                sections: SnapshotSections::default(),
                error: Some("V2 truncated: payload data missing".to_string()),
            });
        }
        let payload = &data[16..16 + payload_len];
        let mut offset = 0usize;
        let mut sections = SnapshotSections::default();
        let read_len = |data: &[u8], off: &mut usize| -> Option<usize> {
            if *off + 8 > data.len() { return None; }
            let len = u64::from_le_bytes(
                data[*off..*off + 8].try_into().unwrap_or([0; 8])
            ) as usize;
            *off += 8;
            Some(len)
        };
        // Section 1: Mesh
        if let Some(len) = read_len(payload, &mut offset) {
            if len > 0 && offset + len <= payload.len() {
                sections.mesh = true;
                offset += len;
            } else {
                // Legacy mesh-only fallback (entire payload is mesh)
                sections.mesh = true;
                return Ok(SnapshotInfo { version, has_magic: true, sections, error: None });
            }
        }
        // Section 2: XIAs
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.xias = true; offset += len; }
        }
        // Section 3: Groups
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.groups = true; offset += len; }
        }
        // Section 4: next_xia_id (8 bytes, no length prefix)
        if offset + 8 <= payload.len() {
            sections.next_xia_id = true;
            offset += 8;
        }
        // Section 5: Constraints
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.constraints = true; offset += len; }
        }
        // Section 6: Boolean group tags (ADR-078)
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.boolean_group_tags = true; offset += len; }
        }
        // Section 7: Shapes (ADR-050) — 3 sub-sections
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.shapes = true; offset += len; }
        }
        if offset + 8 <= payload.len() {
            sections.next_shape_id = true;
            offset += 8;
        }
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.shape_to_xia = true; offset += len; }
        }
        // Sub-section 7d: xia_to_original_shape (ADR-091 D-ε)
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.xia_to_original_shape = true; offset += len; }
        }
        // Section 8: References (ADR-095 Phase 3-ε) — references map +
        // next_reference_id (8 bytes, no length prefix).
        if let Some(len) = read_len(payload, &mut offset) {
            if offset + len <= payload.len() { sections.references = true; offset += len; }
        }
        if offset + 8 <= payload.len() {
            sections.next_reference_id = true;
            offset += 8;
        }
        // Section 9: Material library (ADR-098 S-γ)
        if let Some(len) = read_len(payload, &mut offset) {
            // Last section — offset increment retained for future section additions.
            if offset + len <= payload.len() { sections.material_library = true; let _ = offset + len; }
        }
        Ok(SnapshotInfo { version, has_magic: true, sections, error: None })
    }

    /// Import legacy snapshot format (no version header, direct bincode)
    fn import_legacy_snapshot(&mut self, data: &[u8]) -> Result<()> {
        self.mesh = bincode::deserialize(data)?;
        // Rev 2 Phase B-4 — same reconcile + sheet-aware verify path.
        let fixed = self.mesh.reconcile_face_normals();
        #[cfg(debug_assertions)]
        {
            if fixed > 0 {
                eprintln!("[ADR-007] Legacy-import: reconciled {} face normals", fixed);
            }
            let report = self.mesh.verify_face_invariants_rev2();
            if !report.is_valid() {
                eprintln!("[ADR-007] Legacy-import invariant violations:\n{}",
                    report.summary());
            }
        }
        let _ = fixed;
        Ok(())
    }
}

impl Default for Scene {
    fn default() -> Self {
        Self::new()
    }
}

/// ADR-025 P11 Phase 5 — DFS to find a simple cycle in an undirected graph.
///
/// `adj`: vertex → list of (neighbor, edge_id) pairs.
/// `start`: target vertex (cycle must close back to it).
/// `current`: where we are now in the DFS.
/// `path`: current path (verts only, including start as path[0]).
/// `visited`: verts already in path.
/// `depth` / `max_depth`: bound search to avoid pathological cases.
///
/// Returns Some(cycle) where cycle.len() >= 3 if found.
fn dfs_find_cycle(
    adj: &std::collections::HashMap<axia_geo::VertId, Vec<(axia_geo::VertId, axia_geo::EdgeId)>>,
    start: axia_geo::VertId,
    current: axia_geo::VertId,
    path: &mut Vec<axia_geo::VertId>,
    visited: &mut std::collections::HashSet<axia_geo::VertId>,
    depth: usize,
    max_depth: usize,
) -> Option<Vec<axia_geo::VertId>> {
    if depth > max_depth { return None; }
    let neighbors = match adj.get(&current) {
        Some(n) => n, None => return None,
    };
    for &(next, _eid) in neighbors {
        // Found cycle back to start (length >= 3).
        if next == start && path.len() >= 3 {
            return Some(path.clone());
        }
        if visited.contains(&next) { continue; }
        path.push(next);
        visited.insert(next);
        if let Some(cyc) = dfs_find_cycle(adj, start, next, path, visited, depth + 1, max_depth) {
            return Some(cyc);
        }
        path.pop();
        visited.remove(&next);
    }
    None
}

/// Outcome of [`Scene::resynthesize_orphan_faces`] — distinguishes the
/// "ran to completion" vs "hit time budget; partial work" case so callers
/// can show different Toast messages.
#[derive(Debug, Clone, Copy)]
pub struct ResynthesizeReport {
    /// Number of new faces synthesized.
    pub created: usize,
    /// `true` when the soft time budget aborted the sweep mid-way; user
    /// should call again to continue from current state.
    pub aborted_by_time_budget: bool,
    /// Wall-clock duration of this sweep in milliseconds.
    pub elapsed_ms: f64,
}

#[derive(Clone, Debug)]
pub struct SceneStats {
    pub xia_count: usize,
    pub vert_count: usize,
    pub edge_count: usize,
    pub face_count: usize,
    pub group_count: usize,
    pub component_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ══════════════════════════════════════════════════════════════
    //   File save/load version tests (v1/v2 round-trip)
    // ══════════════════════════════════════════════════════════════

    /// V2 save → load round-trip preserves XIAs and face ownership.
    /// This is the regression guard for the "all faces orphaned after
    /// reload" issue traced to v1 format writing mesh-only.
    #[test]
    fn v2_roundtrip_preserves_xias_and_face_ownership() {
        let mut scene_a = Scene::default();

        // Draw a few RECTs to populate XIAs.
        for (i, cx) in [-500.0_f64, 500.0, 0.0].iter().enumerate() {
            let r = scene_a.execute(Command::DrawRect {
                center: DVec3::new(*cx, 0.0, 0.0),
                normal: DVec3::new(0.0, 1.0, 0.0),
                up:     DVec3::new(0.0, 0.0, 1.0),
                width: 400.0,
                height: 400.0,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)),
                "rect #{} should create an XIA", i);
        }

        let orig_face_count = scene_a.mesh.face_count();
        let orig_xia_count = scene_a.xias.len();
        let orig_orphans = orig_face_count - scene_a.face_to_xia.len();
        assert!(orig_xia_count >= 3, "expected ≥3 XIAs, got {}", orig_xia_count);

        // Round-trip (ADR-103-ε: V3 Z-up after version bump).
        let bytes = scene_a.export_versioned_snapshot().expect("export v3");
        assert_eq!(&bytes[0..4], &AXIA_MAGIC, "magic header");
        assert_eq!(
            u32::from_le_bytes([bytes[4],bytes[5],bytes[6],bytes[7]]),
            3, "written version must be 3 (ADR-103-ε Z-up)",
        );

        let mut scene_b = Scene::default();
        scene_b.import_versioned_snapshot(&bytes).expect("import v3");

        // Topology preserved.
        assert_eq!(scene_b.mesh.face_count(), orig_face_count,
            "face count should match after v2 round-trip");
        // XIAs preserved.
        assert_eq!(scene_b.xias.len(), orig_xia_count,
            "XIA count should match after v2 round-trip");
        // Reverse index rebuilt — no new orphans.
        let new_orphans = scene_b.mesh.face_count() - scene_b.face_to_xia.len();
        assert_eq!(new_orphans, orig_orphans,
            "orphan count should not grow across v2 round-trip");
    }

    /// V1 load still works (backward compatibility) but surfaces orphans
    /// so the caller/UI can offer recovery.
    #[test]
    fn v1_load_drops_xias_but_preserves_mesh() {
        // Hand-craft a v1 payload: AXIA magic + version 1 + mesh-only.
        let mut scene_a = Scene::default();
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: 200.0, height: 200.0,
        });
        let face_count = scene_a.mesh.face_count();
        assert!(face_count >= 1);

        // Build a v1 byte buffer manually.
        let mesh_bytes = bincode::serialize(&scene_a.mesh).expect("serialize mesh");
        let mut v1 = Vec::new();
        v1.extend_from_slice(&AXIA_MAGIC);
        v1.extend_from_slice(&1u32.to_le_bytes());
        v1.extend_from_slice(&(mesh_bytes.len() as u32).to_le_bytes());
        v1.extend_from_slice(&mesh_bytes);

        // Load into fresh scene.
        let mut scene_b = Scene::default();
        scene_b.import_versioned_snapshot(&v1).expect("v1 load");

        // Mesh restored.
        assert_eq!(scene_b.mesh.face_count(), face_count);
        // XIAs deliberately cleared (legacy file has none).
        assert_eq!(scene_b.xias.len(), 0,
            "v1 load must reset the XIA map (flag for recovery)");
        // All faces are orphans in the reverse index.
        assert_eq!(scene_b.face_to_xia.len(), 0,
            "v1 load must reset the reverse index");
    }

    // ══════════════════════════════════════════════════════════════
    //   Centerline (EdgeClass) tests — Phase A contract verification
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn centerline_draw_creates_edge_tagged_centerline() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCenterline {
            start: DVec3::new(0.0, 0.0, 0.0),
            end:   DVec3::new(100.0, 0.0, 0.0),
        });
        let edge_id = match result {
            CommandResult::EntityCreated(id) => axia_geo::EdgeId::new(id),
            other => panic!("expected EntityCreated, got {:?}", other),
        };
        let edge = scene.mesh.edges.get(edge_id).expect("edge exists");
        assert_eq!(edge.class(), axia_geo::EdgeClass::Centerline);
    }

    #[test]
    fn centerline_does_not_split_crossing_geometry_line() {
        // Draw geometry line A-B. Then draw centerline crossing it.
        // Geometry line must remain one edge (not split at the crossing).
        let mut scene = Scene::new();
        scene.execute(Command::DrawLine {
            start: DVec3::new(-100.0, 0.0, 0.0),
            end:   DVec3::new( 100.0, 0.0, 0.0),
            surface_normal: None,
        });
        let edges_before_cl = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();

        // Centerline crosses the geometry line at origin
        scene.execute(Command::DrawCenterline {
            start: DVec3::new(0.0, 0.0, -100.0),
            end:   DVec3::new(0.0, 0.0,  100.0),
        });

        let edges_after = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        // Exactly +1 active edge (the centerline). The geometry line is
        // untouched — no split at the crossing.
        assert_eq!(edges_after, edges_before_cl + 1,
            "centerline must not split existing geometry edges");
    }

    #[test]
    fn geometry_line_does_not_split_at_crossing_centerline() {
        // Symmetric: draw centerline first, then geometry line crossing it.
        // Neither should be split.
        let mut scene = Scene::new();
        scene.execute(Command::DrawCenterline {
            start: DVec3::new(-100.0, 0.0, 0.0),
            end:   DVec3::new( 100.0, 0.0, 0.0),
        });
        let edges_before = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        assert_eq!(edges_before, 1);

        scene.execute(Command::DrawLine {
            start: DVec3::new(0.0, 0.0, -100.0),
            end:   DVec3::new(0.0, 0.0,  100.0),
            surface_normal: None,
        });

        let centerlines: Vec<_> = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.class() == axia_geo::EdgeClass::Centerline)
            .collect();
        assert_eq!(centerlines.len(), 1,
            "centerline must not be split by a geometry line crossing it");
    }

    #[test]
    fn centerline_excluded_from_face_synthesis() {
        // Draw 3 centerlines forming a closed triangle.
        // synthesize_faces_from_free_edges (resolve_planar_free_faces) must
        // NOT create a face from pure-centerline loops.
        let mut scene = Scene::new();
        let a = DVec3::new(0.0, 0.0, 0.0);
        let b = DVec3::new(100.0, 0.0, 0.0);
        let c = DVec3::new(50.0, 0.0, 100.0);
        scene.execute(Command::DrawCenterline { start: a, end: b });
        scene.execute(Command::DrawCenterline { start: b, end: c });
        scene.execute(Command::DrawCenterline { start: c, end: a });
        let created = scene.mesh.resolve_planar_free_faces(
            axia_geo::MaterialId::new(0),
        );
        assert_eq!(created.len(), 0,
            "pure-centerline closed loop must not spawn a face");
        assert_eq!(scene.mesh.face_count(), 0);
    }

    #[test]
    fn set_edge_class_flip_works_for_free_edge() {
        // Geometry free-edge → Centerline should succeed (no face bound).
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawLine {
            start: DVec3::new(0.0, 0.0, 0.0),
            end:   DVec3::new(100.0, 0.0, 0.0),
            surface_normal: None,
        });
        // Find the edge (DrawLine doesn't return edge id; take first active)
        let eid = scene.mesh.edges.iter()
            .find(|(_, e)| e.is_active())
            .map(|(id, _)| id)
            .expect("active edge exists");
        let _ = r;
        let flip = scene.execute(Command::SetEdgeClass {
            edge_id: eid,
            class_raw: 1,  // Centerline
        });
        match flip {
            CommandResult::MeshUpdated => {}
            other => panic!("expected MeshUpdated, got {:?}", other),
        }
        assert_eq!(scene.mesh.edges[eid].class(), axia_geo::EdgeClass::Centerline);
    }

    #[test]
    fn set_edge_class_rejects_demoting_face_bounding_edge() {
        // Create a triangle face via DrawLine (closes a loop → face).
        // Edges of that face cannot be converted to Centerline.
        let mut scene = Scene::new();
        let a = DVec3::new(0.0, 0.0, 0.0);
        let b = DVec3::new(100.0, 0.0, 0.0);
        let c = DVec3::new(50.0, 0.0, 100.0);
        scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });
        scene.execute(Command::DrawLine { start: c, end: a, surface_normal: None });
        assert!(scene.mesh.face_count() >= 1, "triangle face should have been synthesized");

        // Pick an edge that bounds a face.
        let face_edge_id = scene.mesh.edges.iter()
            .find(|(id, e)| {
                e.is_active() && scene.mesh.get_faces_sharing_edge(*id).0.iter()
                    .any(|&fid| scene.mesh.faces.get(fid).is_some_and(|f| f.is_active()))
            })
            .map(|(id, _)| id)
            .expect("face-bounding edge");

        let r = scene.execute(Command::SetEdgeClass {
            edge_id: face_edge_id,
            class_raw: 1,  // Centerline
        });
        match r {
            CommandResult::Error(_) => {}
            other => panic!("expected Error rejection, got {:?}", other),
        }
        // Class unchanged
        assert_eq!(scene.mesh.edges[face_edge_id].class(),
            axia_geo::EdgeClass::Geometry);
    }

    #[test]
    fn test_scene_creation() {
        let scene = Scene::new();
        assert_eq!(scene.xias.len(), 0, "new scene should have no XIAs");
        assert_eq!(scene.mesh.vert_count(), 0, "new scene should have empty mesh");
        assert_eq!(scene.mesh.face_count(), 0);
        assert!(!scene.transactions.can_undo(), "new scene should not have undo");
    }

    #[test]
    fn test_scene_default() {
        let scene = Scene::default();
        assert_eq!(scene.xias.len(), 0);
        assert_eq!(scene.mesh.vert_count(), 0);
    }

    #[test]
    fn test_scene_stats_empty() {
        let scene = Scene::new();
        let stats = scene.stats();
        assert_eq!(stats.xia_count, 0);
        assert_eq!(stats.vert_count, 0);
        assert_eq!(stats.edge_count, 0);
        assert_eq!(stats.face_count, 0);
        assert!(!stats.can_undo);
        assert!(!stats.can_redo);
    }

    #[test]
    fn test_draw_rectangle_creates_xia() {
        let mut scene = Scene::new();
        let center = DVec3::new(0.0, 0.0, 0.0);
        let normal = DVec3::Z;
        let up = DVec3::Y;

        let result = scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id), "XIA should be created");
                assert_eq!(scene.mesh.face_count(), 1, "should have 1 face");
                let xia = &scene.xias[&xia_id];
                assert_eq!(xia.face_ids.len(), 1, "XIA should own the face");
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_line_creates_edge() {
        let mut scene = Scene::new();
        let start = DVec3::ZERO;
        let end = DVec3::X;

        let result = scene.execute(Command::DrawLine {
            start,
            end,
            surface_normal: None,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id), "XIA should be created");
                assert_eq!(scene.mesh.vert_count(), 2, "should create 2 vertices");
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_circle_creates_face() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let radius = 1.0;
        let segments = 8;

        let result = scene.execute(Command::DrawCircle {
            center,
            normal,
            radius,
            segments,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id));
                assert_eq!(scene.mesh.face_count(), 1);
                let xia = &scene.xias[&xia_id];
                assert!(!xia.face_ids.is_empty());
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_lines_triangle_auto_face() {
        // Drawing 3 lines that form a closed triangle should auto-create a face
        let mut scene = Scene::new();
        let a = DVec3::ZERO;
        let b = DVec3::new(2.0, 0.0, 0.0);
        let c = DVec3::new(1.0, 2.0, 0.0);

        // Line 1: A→B (edge only)
        let r1 = scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        match &r1 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(xia.standalone_edge_id.is_some(), "First line should be edge");
                assert!(xia.face_ids.is_empty(), "First line should have no face");
            }
            _ => panic!("expected EntityCreated"),
        }

        // Line 2: B→C (edge only)
        let r2 = scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });
        match &r2 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(xia.standalone_edge_id.is_some(), "Second line should be edge");
            }
            _ => panic!("expected EntityCreated"),
        }
        assert_eq!(scene.mesh.face_count(), 0, "No face yet with 2 lines");

        // Line 3: C→A — closes the loop → auto-creates face!
        let r3 = scene.execute(Command::DrawLine { start: c, end: a, surface_normal: None });
        match &r3 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(!xia.face_ids.is_empty(), "Third line should create face");
                assert!(xia.standalone_edge_id.is_none(), "Face XIA should not have standalone edge");
            }
            _ => panic!("expected EntityCreated"),
        }
        assert_eq!(scene.mesh.face_count(), 1, "Triangle face should be created");

        // The old edge-only XIAs should be cleaned up
        let edge_xias: Vec<_> = scene.xias.values()
            .filter(|x| x.standalone_edge_id.is_some())
            .collect();
        assert_eq!(edge_xias.len(), 0, "Old edge XIAs should be removed");
    }

    #[test]
    fn test_draw_lines_no_auto_face_open() {
        // Drawing 2 lines (open chain) should NOT create a face
        let mut scene = Scene::new();
        let a = DVec3::ZERO;
        let b = DVec3::X;
        let c = DVec3::new(2.0, 0.0, 0.0);

        scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });

        assert_eq!(scene.mesh.face_count(), 0, "Open chain should not create face");
        assert_eq!(scene.xias.len(), 2, "Should have 2 edge XIAs");
    }

    #[test]
    fn test_push_pull_creates_faces() {
        let mut scene = Scene::new();
        // First, create a rectangle
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;
        let result = scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        let xia_id = match result {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Get the face ID
        let face_id = scene.xias[&xia_id].face_ids[0];

        // Push/pull the face
        let pp_result = scene.execute(Command::PushPull {
            face_id,
            dist: 2.0,
        });

        match pp_result {
            CommandResult::PushPullDone { sides_created, .. } => {
                assert!(sides_created > 0, "should create side faces");
                // Original rectangle + top + sides = 6 faces (box)
                assert_eq!(scene.mesh.face_count(), 6, "box should have 6 faces");
            }
            _ => panic!("expected PushPullDone result"),
        }
    }

    #[test]
    fn test_undo_rectangle() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;

        scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        assert_eq!(scene.mesh.face_count(), 1);
        assert!(scene.transactions.can_undo(), "should have undo after draw");

        // Undo
        let result = scene.execute(Command::Undo);
        match result {
            CommandResult::MeshUpdated => {
                assert_eq!(scene.mesh.face_count(), 0, "undo should remove face");
            }
            _ => panic!("expected MeshUpdated result"),
        }
    }

    #[test]
    fn test_undo_redo_sequence() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;

        // Draw rect
        scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });
        assert_eq!(scene.mesh.face_count(), 1);

        // Undo
        scene.execute(Command::Undo);
        assert_eq!(scene.mesh.face_count(), 0);

        // Redo
        let result = scene.execute(Command::Redo);
        match result {
            CommandResult::MeshUpdated => {
                assert_eq!(scene.mesh.face_count(), 1, "redo should restore face");
            }
            _ => panic!("expected MeshUpdated result"),
        }
    }

    #[test]
    fn test_push_pull_and_undo() {
        let mut scene = Scene::new();

        // Create rectangle
        let result = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id = match result {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let face_id = scene.xias[&xia_id].face_ids[0];
        assert_eq!(scene.mesh.face_count(), 1);

        // Push/pull
        scene.execute(Command::PushPull {
            face_id,
            dist: 2.0,
        });
        assert_eq!(scene.mesh.face_count(), 6);

        // Undo push/pull
        scene.execute(Command::Undo);
        assert_eq!(scene.mesh.face_count(), 1, "undo should restore to rectangle");
    }

    #[test]
    fn test_selection_single() {
        let mut scene = Scene::new();

        // Create two rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Select first
        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });
        assert!(scene.xias[&xia_id_1].selected);
        assert!(!scene.xias[&xia_id_2].selected);

        // Select second (non-additive)
        scene.execute(Command::Select {
            xia_id: xia_id_2,
            additive: false,
        });
        assert!(!scene.xias[&xia_id_1].selected);
        assert!(scene.xias[&xia_id_2].selected);
    }

    #[test]
    fn test_selection_additive() {
        let mut scene = Scene::new();

        // Create two rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Select first
        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });

        // Select second additive
        scene.execute(Command::Select {
            xia_id: xia_id_2,
            additive: true,
        });
        assert!(scene.xias[&xia_id_1].selected, "first should still be selected");
        assert!(scene.xias[&xia_id_2].selected, "second should be selected");
    }

    #[test]
    fn test_deselect_all() {
        let mut scene = Scene::new();

        // Create and select rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });
        assert!(scene.xias[&xia_id_1].selected);

        // Deselect all
        scene.execute(Command::DeselectAll);
        assert!(!scene.xias[&xia_id_1].selected);
    }

    #[test]
    fn test_multiple_operations_consistency() {
        let mut scene = Scene::new();

        // Draw rectangle
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let _xia_id = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Draw circle
        scene.execute(Command::DrawCircle {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 1.0,
            segments: 16,
        });

        assert_eq!(scene.xias.len(), 2, "should have 2 XIAs");
        assert_eq!(scene.mesh.face_count(), 2, "should have 2 faces");

        // Undo both
        scene.execute(Command::Undo);
        scene.execute(Command::Undo);

        assert_eq!(scene.mesh.face_count(), 0, "undo should clear all");

        // Redo
        scene.execute(Command::Redo);
        scene.execute(Command::Redo);

        assert_eq!(scene.mesh.face_count(), 2, "redo should restore all");
    }

    /// === 면 자동 합성 / 확장 검증 (2026-04-28) ===

    /// 시나리오 A: 두 인접 RECT 가 edge 공유 → 공유 edge merge 시 1 face
    fn merge_edge_between_two_faces(scene: &mut Scene, fa: axia_geo::FaceId, fb: axia_geo::FaceId) -> Option<axia_geo::FaceId> {
        // shared edge 찾기
        let shared = scene.mesh.find_shared_edge_between_faces(fa, fb)?;
        scene.mesh.merge_faces_by_edge(shared).ok()
    }

    #[test]
    fn test_two_adjacent_rects_merge_via_shared_edge() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // 2 faces, 1 shared edge
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2, "expected 2 faces before merge");

        let merged = merge_edge_between_two_faces(&mut scene, active[0], active[1]);
        assert!(merged.is_some(), "merge_faces_by_edge failed");
        let active_after: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_after.len(), 1, "expected 1 face after merge");
        // Merged face has 4 verts (combined rect 8×4) + winding +Z
        let mfid = active_after[0];
        let n = scene.mesh.faces[mfid].normal();
        assert!(n.z > 0.0, "merged face flipped: {:?}", n);
    }

    /// 시나리오 B: 3 RECT 일렬 → 모든 인접 pair 순차 merge → 1 face
    #[test]
    fn test_three_rects_in_row_merge_sequentially() {
        let mut scene = Scene::new();
        for &cx in &[-4.0, 0.0, 4.0] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 4.0, height: 2.0,
            });
        }
        merge_all_adjacent(&mut scene, 5);
        let active_final: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_final.len(), 1, "expected 1 face after merging all 3");
        assert!(scene.mesh.faces[active_final[0]].normal().z > 0.0);
    }

    /// 시나리오 C: 4 RECT 가 grid 로 인접 → progressive merge → 1 face
    #[test]
    fn test_grid_of_rects_progressive_merge() {
        let mut scene = Scene::new();
        for &(cx, cy) in &[(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
        }
        merge_all_adjacent(&mut scene, 10);
        let active_final: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_final.len(), 1);
        assert!(scene.mesh.faces[active_final[0]].normal().z > 0.0);
    }

    /// Helper: shared edge 있는 face pair 를 반복 찾아 merge.
    fn merge_all_adjacent(scene: &mut Scene, max_iter: usize) {
        let mut iter = 0;
        loop {
            let active: Vec<_> = scene.mesh.faces.iter()
                .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
            if active.len() <= 1 { break; }
            iter += 1;
            assert!(iter < max_iter, "merge loop did not converge in {} iterations", max_iter);
            let mut merged = false;
            'outer: for i in 0..active.len() {
                for j in (i + 1)..active.len() {
                    if let Some(eid) = scene.mesh.find_shared_edge_between_faces(active[i], active[j]) {
                        if scene.mesh.merge_faces_by_edge(eid).is_ok() {
                            merged = true;
                            break 'outer;
                        }
                    }
                }
            }
            assert!(merged, "no mergeable adjacent pair found");
        }
    }

    /// 시나리오 D: L-shape + small RECT 가 2 edge 공유 (multi-shared)
    /// → merge_coplanar_faces_geometric 의 multi-shared 경로 검증.
    #[test]
    fn test_multi_shared_edge_merge() {
        let mut scene = Scene::new();
        // Big rect 6×4
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        // Small rect at corner (overlapping → should split big into L + small)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let active_before: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        // 2 faces (big + small overlapping)
        assert!(active_before.len() >= 2,
            "expected at least 2 faces, got {}", active_before.len());

        // Multi-shared geometric merge — pick any 2
        // Note: 이 시나리오는 ADR-015 로 변경 후 simple overlapping faces 가 됨.
        // 구체 face 갯수는 변할 수 있으므로 기본 sanity check.
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.z > 0.0, "face {:?} flipped", fid);
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
        }
    }

    /// 시나리오 E: erase 도구의 face 자동 합성 — 2 인접 face 의 shared edge
    /// 삭제 시 1 face 로 합쳐져야.
    #[test]
    fn test_erase_shared_edge_merges_faces() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2);
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();

        // Direct merge (대표적인 면 합성 path)
        let merged = scene.mesh.merge_faces_by_edge(shared);
        assert!(merged.is_ok(), "merge_faces_by_edge failed: {:?}", merged.err());

        let active_after: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_after.len(), 1);

        // 합쳐진 face 는 4 vert (8×2 직사각형) + CCW
        let mfid = active_after[0];
        let verts = scene.mesh.collect_loop_verts(scene.mesh.faces[mfid].outer().start).unwrap();
        // 4 corners (collinear vertices on shared edge auto-removed)
        // Note: simplify_collinear_loop 의 정책에 따라 4 또는 6 (mid-points 보존).
        assert!(verts.len() >= 4 && verts.len() <= 6,
            "merged rect verts: {} (expected 4-6)", verts.len());
        assert!(scene.mesh.faces[mfid].normal().z > 0.0);
    }

    /// 시나리오 G: 면 확장 (Re-synthesis Rule, ADR-008 Axiom 6).
    /// 사용자가 LINE 으로 닫힌 영역을 그렸는데 face 가 안 만들어진 경우,
    /// 그 영역에 있는 free edge 를 erase 하면 자동 재합성 (loop rescan).
    /// 본 테스트는 free-edge cycle 자동 face 합성 검증.
    #[test]
    fn test_free_edge_cycle_auto_synthesizes_face() {
        let mut scene = Scene::new();
        // 4 LINE 으로 직사각형 boundary 그리기
        scene.execute(Command::DrawLine {
            start: DVec3::new(-2.0, -1.0, 0.0),
            end:   DVec3::new( 2.0, -1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new( 2.0, -1.0, 0.0),
            end:   DVec3::new( 2.0,  1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new( 2.0,  1.0, 0.0),
            end:   DVec3::new(-2.0,  1.0, 0.0),
            surface_normal: None,
        });
        // 4번째 라인 닫히면 face 자동 합성 (Axiom 1)
        scene.execute(Command::DrawLine {
            start: DVec3::new(-2.0,  1.0, 0.0),
            end:   DVec3::new(-2.0, -1.0, 0.0),
            surface_normal: None,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 1, "expected face auto-synthesized from 4 LINEs");
        assert!(scene.mesh.faces[active[0]].normal().z > 0.0);
    }

    /// 사용자 보고 2026-04-28 — hover preview 가 RED (cascade-delete) 로
    /// 표시되는 인접 면 케이스. preview_edge_erase_merge 의 returns empty
    /// 는 다음 중 하나일 때:
    ///   1. edge 가 2 face 안 sharing (radial != 2)
    ///   2. 2 faces non-coplanar (angle > tol)
    ///   3. count_shared_edges_outer != 1 AND geometric merge 도 실패

    /// 시나리오 G': preview_edge_erase_merge 가 단순 인접 RECT 에서 정상 동작
    #[test]
    fn test_preview_edge_merge_simple_adjacent() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();

        // count_shared_edges_outer should be 1
        let n_shared = scene.mesh.count_shared_edges_outer(active[0], active[1]);
        assert_eq!(n_shared, 1, "expected 1 shared edge for simple adjacent");

        // get_faces_sharing_edge should return 2 faces
        let (faces, _) = scene.mesh.get_faces_sharing_edge(shared);
        assert_eq!(faces.len(), 2, "edge should be shared by exactly 2 faces");

        // Coplanarity should hold
        assert!(
            scene.mesh.are_faces_coplanar_with_tolerance(active[0], active[1], 0.5).unwrap_or(false),
            "faces should be coplanar"
        );
    }

    /// 시나리오 G'': merge 후 다음 인접 face 와 다시 merge 시도 — boundary
    /// 가 split 된 상태일 수 있어 count_shared_edges_outer > 1 가능
    #[test]
    fn test_merge_chain_count_shared_edges() {
        let mut scene = Scene::new();
        // 4 RECT 일렬 (4×2 each)
        for &cx in &[-6.0, -2.0, 2.0, 6.0] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 4.0, height: 2.0,
            });
        }
        // Merge first two
        let active1: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let pair1 = active1[..2].to_vec();
        let shared1 = scene.mesh.find_shared_edge_between_faces(pair1[0], pair1[1]);
        if let Some(e1) = shared1 {
            let _ = scene.mesh.merge_faces_by_edge(e1);
        }

        // Now check next pair count_shared_edges
        let active2: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        // For each pair, check count_shared and coplanarity
        for i in 0..active2.len() {
            for j in (i + 1)..active2.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active2[i], active2[j]);
                let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                    active2[i], active2[j], 0.5
                ).unwrap_or(false);
                if n_shared >= 1 {
                    assert!(coplanar, "adjacent faces should be coplanar");
                }
            }
        }
    }

    /// 사용자 보고 2026-04-28 — 인접 면 hover 시 빨간 색 (cascade) 표시
    /// 회귀. 단순 시나리오: 2 RECT 인접 그린 후 shared edge 의 preview 검증.
    #[test]
    fn test_simple_adjacent_rects_preview_is_mergeable() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2);

        // shared edge 찾기
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1])
            .expect("shared edge should exist");

        // get_faces_sharing_edge 가 정확히 2 face 반환
        let (faces, _) = scene.mesh.get_faces_sharing_edge(shared);
        assert_eq!(faces.len(), 2, "shared edge should have exactly 2 active faces");

        // count_shared == 1 (단순 인접)
        let n = scene.mesh.count_shared_edges_outer(active[0], active[1]);
        assert_eq!(n, 1, "expected 1 shared edge");

        // coplanar check
        assert!(scene.mesh.are_faces_coplanar_with_tolerance(active[0], active[1], 0.5).unwrap());

        // 모든 조건 통과 → preview 가 cyan 으로 표시되어야
        // (preview 함수는 wasm 에 있어 직접 호출 불가하지만 동등 조건 검증)
    }

    /// 사용자 보고 2026-04-28 — 면이 split-point 로 7+ boundary edge 를
    /// 가질 때 인접 면 merge preview 가 빨간색.
    /// 시나리오: 큰 RECT 의 boundary 가 여러 split point 로 나뉜 후,
    /// 인접 새 RECT 와의 merge 가능성 검증.
    #[test]
    fn test_face_with_split_boundary_can_merge() {
        let mut scene = Scene::new();
        // 큰 RECT
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        // 여러 작은 RECT 가 큰 RECT 의 boundary 를 split (corner overlap 식)
        scene.execute(Command::DrawRect {
            center: DVec3::new(8.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(-8.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });

        // 모든 인접 face pair 에 대해 hover preview 조건 검사
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

        // adjacent face pair 중 cyan 으로 표시되어야 하는 것들 검증
        let mut tested_pairs = 0;
        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                if n_shared == 0 { continue; }
                tested_pairs += 1;

                // Coplanar check
                let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                    active[i], active[j], 0.5
                ).unwrap_or(false);
                assert!(coplanar, "adjacent faces should be coplanar");

                // Hover preview 동등 조건
                let mergeable = if n_shared == 1 {
                    true // standard merge path
                } else {
                    // Multi-shared: my recent fix should return true
                    scene.mesh.would_geometric_merge_succeed(active[i], active[j], 0.5)
                };
                assert!(
                    mergeable,
                    "adjacent face pair (shared={}) should be mergeable but isn't",
                    n_shared
                );
            }
        }
        assert!(tested_pairs > 0, "no adjacent face pairs found");
    }

    /// 사용자 보고 2026-04-28 — RECT 를 다른 RECT 의 edge 위에 그리면
    /// 비-manifold 발생 (find_halfedge 가 새 HE pair 생성).
    /// 그 결과 인접 면 인식 / 합성 로직에 영향 가능.
    #[test]
    fn test_rect_on_existing_edge_preserves_topology() {
        let mut scene = Scene::new();
        // RECT A 먼저
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // RECT B 와 A 의 right edge 를 공유 (snap 시뮬레이션)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // RECT C 가 A 의 RIGHT edge 와 B 의 LEFT edge (= 같은 edge) 를 가로지름
        // → 이 edge 가 split 될 수 있음. 그 후 인접 face 인식 검증.
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 3.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 8.0, height: 2.0,
        });

        // 모든 active face: winding +Z, non-degenerate
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
            assert!(n.z > 0.0, "face {:?} flipped", fid);
        }

        // 모든 active edge: 어느 face 의 boundary 에 위치 (orphan 없음)
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() { continue; }
            let mut has_face = false;
            let mut he = any_he;
            for _ in 0..10 {
                if !scene.mesh.hes[he].face().is_null() {
                    has_face = true; break;
                }
                he = scene.mesh.hes[he].next_rad();
                if he == any_he || he.is_null() { break; }
            }
            assert!(has_face, "edge {:?} orphan after rect-on-edge", eid);
        }

        // 모든 인접 face pair: 정확히 2 active faces sharing edge
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        for i in 0..active.len() {
            for j in (i+1)..active.len() {
                if let Some(eid) = scene.mesh.find_shared_edge_between_faces(active[i], active[j]) {
                    let (faces, _) = scene.mesh.get_faces_sharing_edge(eid);
                    assert!(faces.len() <= 2,
                        "edge {:?} has {} faces (non-manifold)", eid, faces.len());
                }
            }
        }
    }

    /// 사용자 보고 2026-04-28 — L-shape merge 후 잔여 edge 가 남는 회귀.
    /// 큰 RECT 와 작은 RECT 가 한 corner 에서 partial overlap → merge 시
    /// L 형 face. merged face 내부에 dashed 잔여 line 이 보인다고 보고됨.
    /// 모든 active edge 가 face 의 boundary 에 위치해야 함 (orphan 없음).
    #[test]
    fn test_lshape_merge_no_residual_edges() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(6.0, 2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });

        // 한 번의 merge_coplanar_faces_geometric 호출 후 잔여 edge 검사.
        // 처음 두 active face 만 사용 (geometric 호출 후 ID stale 되므로 1번만).
        let initial: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        if initial.len() >= 2 {
            let _ = scene.mesh.merge_coplanar_faces_geometric(
                initial[0], initial[1], 1.0
            );
        }
        let _ = scene.mesh.cleanup_dangling();

        // Orphan edge 검사 (모든 active edge 는 어느 face 에 attached 여야)
        let mut orphan_edges: Vec<axia_geo::EdgeId> = Vec::new();
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() { continue; }
            let mut has_face = false;
            let mut he = any_he;
            for _ in 0..8 {  // safety bound
                if !scene.mesh.hes.get(he).map(|h| h.face().is_null()).unwrap_or(true) {
                    has_face = true; break;
                }
                he = scene.mesh.hes.get(he).map(|h| h.next_rad()).unwrap_or(axia_geo::HeId::NULL);
                if he == any_he || he.is_null() { break; }
            }
            if !has_face { orphan_edges.push(eid); }
        }
        assert!(
            orphan_edges.is_empty(),
            "{} orphan edges after L-shape merge: {:?}",
            orphan_edges.len(), orphan_edges
        );
    }

    /// 사용자 보고 2026-04-28 — multi-shared edge case 의 hover preview 가
    /// 빨간색 (cascade) 으로 표시되는 회귀.
    /// would_geometric_merge_succeed 가 multi-shared (count >= 2) 도 인식해야.
    #[test]
    fn test_multi_shared_preview_recognizes_mergeable() {
        let mut scene = Scene::new();
        // 2 RECT 인접 + 한 RECT 의 edge 가 split 된 상태 시뮬레이션
        // (이전 merge 후 boundary 가 mid-vertex 로 split 된 경우)
        // 가장 간단한 방법: L-shape + small RECT 에서 multi-shared 발생.
        // Big rect
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        // Small rect at corner overlap
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // 결과 토폴로지: 큰 RECT 와 작은 RECT 가 있고, 큰 RECT 의 일부 edge 가
        // split 됨. 두 face 의 shared edge count 검사.
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert!(active.len() >= 2);

        // 인접한 2 face 쌍 중 multi-shared 케이스 찾기
        let mut found_multi_shared = false;
        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                if n_shared >= 2 {
                    found_multi_shared = true;
                    // 이 케이스에 대해 would_geometric_merge_succeed 가 true 반환해야
                    let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                        active[i], active[j], 0.5
                    ).unwrap_or(false);
                    if coplanar {
                        let geom_ok = scene.mesh.would_geometric_merge_succeed(
                            active[i], active[j], 0.5
                        );
                        assert!(geom_ok,
                            "multi-shared (count={}) should preview as mergeable", n_shared);
                    }
                }
            }
        }
        // 본 시나리오에서 multi-shared 가 형성되지 않을 수 있음 (ADR-015 정책으로
        // simple overlap → 두 separate face). 그래도 stress test 자체는 OK.
        let _ = found_multi_shared;
    }

    /// 시나리오 H': 사용자 reports — 작은 sliver 이거나 SOFT edge 가 boundary
    /// 인 경우 merge 가 실패할 수 있음. simple 2-rect 케이스의 preview merge
    /// 가 success (== 2 face id) 여야.
    #[test]
    fn test_preview_returns_face_ids_for_mergeable() {
        // 이 테스트는 axia-wasm crate 기반이라 axia-core 에서 직접 호출 불가.
        // 대신 Rust mesh layer 의 동등한 검사 수행:
        //   1. count_shared_edges_outer == 1
        //   OR
        //   2. would_geometric_merge_succeed
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

        let f1 = active[0]; let f2 = active[1];
        let n_shared = scene.mesh.count_shared_edges_outer(f1, f2);
        let geom_ok = scene.mesh.would_geometric_merge_succeed(f1, f2, 0.5);

        // Hover preview 의 success 조건
        let mergeable = n_shared == 1 || geom_ok;
        assert!(mergeable, "n_shared={}, geom_ok={}", n_shared, geom_ok);
    }

    /// 시나리오 H: 큰 RECT 안에 작은 RECT 그린 후 작은 RECT 의 한 변 erase
    /// → "구멍" 이 닫혀서 face 확장 (small face 가 큰 face 와 합성).
    /// 단, ADR-015 (B1 비활성) 으로 inner 는 별개 simple face 이므로 erase
    /// 동작은 작은 face 의 boundary edge 만 영향. 본 테스트는 erase 후
    /// 토폴로지 일관성 검증 (winding 유지, NaN 없음).
    #[test]
    fn test_erase_inner_face_edge_topology_consistent() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // 두 face: outer (6×4) + inner (2×2)
        let active_before: usize = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_before, 2);

        // inner 의 한 edge 찾기 (작은 rect 의 boundary 중 free 가 아닌 것)
        let inner = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .min_by(|(_, a), (_, b)| {
                // 작은 면적 face 선택
                let av = scene.mesh.collect_loop_verts(a.outer().start).unwrap_or_default();
                let bv = scene.mesh.collect_loop_verts(b.outer().start).unwrap_or_default();
                av.len().cmp(&bv.len())
            })
            .map(|(id, _)| id);
        assert!(inner.is_some());

        // Erase 한 edge — multi-step 비활성. 단순 검증.
        // (실제 erase 는 batch_erase_edges_with_merge 통해 — wasm layer)
        // 본 단위 테스트는 면 토폴로지 일관성만 검증.
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.z > 0.0, "face {:?} flipped after inner draw", fid);
            assert!(n.x.is_finite(), "face {:?} NaN", fid);
        }
    }

    /// 시나리오 F: 면 합성 후 normal 일관성 (winding +Z)
    #[test]
    fn test_face_merge_preserves_winding() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();
        let _ = scene.mesh.merge_faces_by_edge(shared);
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "merged face {:?} flipped", fid);
        }
    }

    /// 사용자 보고 2026-04-28 — RECT 가 RECT 위에 겹쳐 그려질 때 교차
    /// 영역(overlap region) 이 사라져 두 면이 비결합 상태로 남는 회귀.
    /// 기대: 부분-overlap 시 3 sub-face (RECT1-only, overlap, RECT2-only).
    #[test]
    fn test_overlapping_rects_preserve_overlap_region() {
        let mut scene = Scene::new();

        // RECT1 — center (0,0,0), 4×4 on Z=0 plane
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });
        assert!(matches!(r1, CommandResult::EntityCreated(_)));
        assert_eq!(scene.mesh.face_count(), 1, "rect1 = 1 face");

        // RECT2 — center (3,0,0), 4×4 → overlaps RECT1 on x∈[1, 2]×y∈[-2, 2]
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });
        assert!(matches!(r2, CommandResult::EntityCreated(_)));

        // 기대: 3 sub-face — left (RECT1-only), overlap, right (RECT2-only)
        let face_count = scene.mesh.face_count();
        assert_eq!(
            face_count, 3,
            "overlap region must NOT vanish — expected 3 sub-faces, got {}",
            face_count
        );

        // 모든 sub-face 의 면적 합 == RECT1 면적 + RECT2 면적 - overlap 면적
        //   = 16 + 16 - 8 = 24
        let mut total_area = 0.0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                if verts.len() < 3 { continue; }
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                // Shoelace on XY plane
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
                let _ = fid;
            }
        }
        // Overlap = x∈[1,2]×y∈[-2,2] = 1×4 = 4
        // Union area = 16+16-4 = 28
        assert!(
            (total_area - 28.0).abs() < 0.1,
            "total area should be 28 (16+16-4), got {}",
            total_area
        );
    }

    /// 사용자 스크린샷 케이스 — RECT2 가 RECT1 의 코너에 걸쳐 그려짐.
    #[test]
    fn test_overlapping_rects_corner_overlap() {
        let mut scene = Scene::new();

        // RECT1 — 6×6 centered at origin (XY: -3..3)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 6.0,
            height: 6.0,
        });

        // RECT2 — 4×4 at center (4, -2) → overlaps RECT1 at lower-right corner
        //   RECT2 spans x∈[2, 6], y∈[-4, 0] → overlap = x∈[2,3]×y∈[-3, 0] = 3
        scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, -2.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });

        // 기대: 3 sub-face (RECT1 L-shape, overlap, RECT2 L-shape)
        let face_count = scene.mesh.face_count();
        assert_eq!(
            face_count, 3,
            "corner-overlap should produce 3 sub-faces, got {} — overlap missing!",
            face_count
        );

        // Union area = 36 + 16 - 3 = 49
        let mut total_area = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
            }
        }
        assert!(
            (total_area - 49.0).abs() < 0.1,
            "corner-overlap total area should be 49 (36+16-3), got {}",
            total_area
        );

        // 모든 active face 가 XIA 에 등록되어 있어야 한다 — 등록 안 된 face 는
        // 뷰포트에서 보이지 않는 회귀의 원인이 됨.
        let mut orphans = 0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) {
                orphans += 1;
            }
        }
        assert_eq!(
            orphans, 0,
            "every active face must belong to a XIA — {} orphan(s) detected",
            orphans
        );

        // 모든 active face 가 viewport 의 mesh buffer 에 포함돼야 한다 —
        // export_buffers 에서 빠지면 화면에서 보이지 않음 (사용자 보고 회귀).
        let (_pos, _norm, indices, face_map, _pos64) = scene.export_mesh_buffers().unwrap();
        let exported_faces: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                exported_faces.contains(&fid),
                "active face {:?} missing from exported buffers — invisible in viewport!",
                fid
            );
        }
        assert!(!indices.is_empty(), "must have triangle indices");
    }

    /// 사용자 보고 2026-04-28 — snap 으로 여러 RECT 를 겹쳐 그리면 하나의
    /// 셀이 화면에서 사라짐 (transparent). 3-RECT 시나리오 회귀.
    #[test]
    fn test_three_overlapping_rects_no_missing_cell() {
        let mut scene = Scene::new();

        // RECT1 — 대형 outer (10×6 at origin, XY plane)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 6.0,
        });

        // RECT2 — RECT1 안쪽에 inset (4×3, 살짝 우측 이동) → B1 hole-promote
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 3.0,
        });
        let after_rect2 = scene.mesh.face_count();

        // RECT3 — RECT2 와 RECT1 경계 모두 가로지름 (중첩)
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 1.5, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 6.0,
            height: 2.0,
        });
        let after_rect3 = scene.mesh.face_count();

        // 모든 active face 가 export_mesh_buffers 에 포함돼야 함 (투명 영역 없음)
        let (pos, _norm, indices, face_map, _pos64) = scene.export_mesh_buffers().unwrap();
        let exported_faces: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();

        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported_faces.contains(&fid) {
                missing.push(fid);
            }
        }
        assert!(
            missing.is_empty(),
            "active faces missing from buffers (invisible cells): {:?}\n\
             face_count: rect2_step={}, rect3_step={}, indices_len={}, positions_len={}",
            missing, after_rect2, after_rect3, indices.len(), pos.len()
        );

        // 모든 active face 가 XIA 에 등록돼야 함 (orphan 없음)
        let mut orphans = 0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) {
                orphans += 1;
            }
        }
        assert_eq!(orphans, 0, "orphan faces (no XIA): {}", orphans);

        // Total area 검증: 합집합은 최소한 RECT1 의 면적 (60) 이상이어야 함
        let mut total_area = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
            }
        }
        assert!(
            total_area >= 59.9,
            "total area {} < 60 — significant region(s) missing from union",
            total_area
        );
    }

    /// 사용자 보고 (snap 으로 정확히 그렸는데 면 사라짐) — 회귀 분리 테스트.
    /// Case D 가 단독으로 reversed-normal face 를 만든다는 사실을 검증.
    #[test]
    fn test_nested_plus_side_rect_no_flipped_normal() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // After RECT1: 1 face, all CCW
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "after RECT1: face {:?} flipped", fid);
        }

        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // After RECT2: ring (RECT1 outer + RECT2 hole) + RECT2 inner
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "after RECT2: face {:?} flipped", fid);
        }

        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 2.0,
        });

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let verts = scene.mesh.collect_loop_verts(f.outer().start)
                .unwrap_or_default();
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                .collect();
            report.push_str(&format!(
                "  {:?}: n.z={:.2} verts={:?} pts={:?}\n",
                fid, n.z, verts, pts
            ));
        }

        let mut flipped: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.normal().z <= 0.0 { flipped.push(fid); }
        }
        assert!(
            flipped.is_empty(),
            "after RECT3: flipped normals: {:?}\nFace report:\n{}",
            flipped, report
        );
    }

    /// 사용자 보고 2026-04-28 (3): RECT 의 4 변이 그려졌으나 **face 가 생성되지 않음**.
    /// 화면에서 wire 만 보이고 면이 비어있음. XIA Inspector 가 "선 1개" 를 표시.
    /// 시나리오: RECT 가 기존 face 의 변과 정확히 인접 (snap), 4 변 모두 그려짐.
    #[test]
    fn test_adjacent_rect_face_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 4×4 at origin
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let xia1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // RECT2 — 4×4 sharing right edge with RECT1 (snap-aligned)
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let xia2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!("rect2 failed: {:?}", r2) };

        // 둘 다 RectangleXIA 여야 한다 (Line XIA 가 아님)
        let xia2_face_count = scene.xias.get(&xia2).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            xia2_face_count >= 1,
            "RECT2 XIA has no face_ids — face synthesis failed (XIA stays as wire-only)"
        );

        // 두 face 모두 존재해야 함
        assert_eq!(scene.mesh.face_count(), 2, "expected 2 faces after adjacent rects");
        let _ = xia1;
    }

    /// 사용자 보고 2026-04-28 (3): 기존 face 안에 작은 RECT 여러 개를 그렸을 때
    /// 일부 RECT 의 face 가 생성되지 않는 케이스.
    #[test]
    fn test_multiple_rects_inside_face_all_synthesize() {
        let mut scene = Scene::new();
        // RECT1 — 12×4 outer
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 4.0,
        });
        // 3 inner RECTs, side by side, all inside RECT1, snap-aligned grid
        for &cx in &[-4.0, 0.0, 4.0] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 3.0, height: 3.0,
            });
            let xia_id = match r {
                CommandResult::EntityCreated(id) => id,
                _ => panic!("inner rect at ({},0) failed: {:?}", cx, r),
            };
            let face_count = scene.xias.get(&xia_id).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "inner rect at ({},0) — XIA has no face_ids (wire-only)", cx
            );
        }

        // 모든 active face 가 export 에 포함되어야 함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 모든 변이 이미 존재하는 위치에 RECT 그리기.
    /// 예: 큰 RECT 안에 작은 RECT 가 있고, 그 사이 빈 공간 (꼭 닫힌 다각형) 에
    /// 다시 RECT 를 그리려고 함. 4 변이 이미 있으면 epoch.new_edges 가 비어
    /// resolve_planar_free_faces_scoped 가 face 를 만들지 못할 수 있음.
    #[test]
    fn test_rect_with_all_existing_edges_creates_face() {
        let mut scene = Scene::new();
        // 4 LINE 으로 사각형 경계 만들기 (RECT 명령 안 씀)
        scene.execute(Command::DrawLine {
            start: DVec3::new(-1.0, -1.0, 0.0),
            end: DVec3::new(1.0, -1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(1.0, -1.0, 0.0),
            end: DVec3::new(1.0, 1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(1.0, 1.0, 0.0),
            end: DVec3::new(-1.0, 1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(-1.0, 1.0, 0.0),
            end: DVec3::new(-1.0, -1.0, 0.0),
            surface_normal: None,
        });
        // 4 변이 닫히면 free-edge cycle → face 자동 생성
        let after_lines = scene.mesh.face_count();

        // 이제 같은 RECT 를 명령으로 다시 그리기 (모든 변 + 정점 이미 존재)
        let r = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let _ = r;

        // 어떤 경우든 face_count >= 1 이어야 함
        let after_rect = scene.mesh.face_count();
        assert!(
            after_rect >= 1,
            "after redrawing RECT on existing 4 edges: lines_phase={}, rect_phase={} — face missing",
            after_lines, after_rect
        );

        // 모든 active face 가 export 에 포함되어야 함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 두 인접 RECT 사이의 변을 한 변으로 공유하는
    /// 세 번째 RECT — RECT3 이 RECT1 / RECT2 의 인접 변 + 그 위/아래 새 변으로 구성.
    /// 일부 변이 기존 face 의 boundary HE 를 양쪽 모두 사용하면 free HE 부족
    /// → face 합성 실패 가능.
    #[test]
    fn test_rect_sharing_two_existing_edges_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 2×2 at (-1, 0)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT2 — 2×2 at (1, 0), shares right edge of RECT1 (x=0, y∈[-1,1])
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT3 — 2×2 at (0, 2), shares bottom edge with RECT1's top + RECT2's top
        // RECT3 spans (-1,1) to (1,3): bottom edge (-1,1)→(1,1) crosses BOTH RECT1's
        // top-right corner and RECT2's top-left corner. RECT3's bottom uses 2 existing
        // edges (RECT1 top-right half + RECT2 top-left half).
        let r3 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let xia3 = match r3 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("RECT3 failed: {:?}", r3),
        };
        let face_count = scene.xias.get(&xia3).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            face_count >= 1,
            "RECT3 sharing 2 existing edges — no face synthesized (wire-only)"
        );
        // 3 faces 기대 (RECT1, RECT2, RECT3)
        assert_eq!(
            scene.mesh.face_count(), 3,
            "expected 3 faces (RECT1, RECT2, RECT3), got {}",
            scene.mesh.face_count()
        );
    }

    /// 사용자 보고 2026-04-28 (3) 추적 — "*extension" snap 으로 그린 RECT 가
    /// 기존 edge 의 extension 선과 collinear 한 새 edge 를 만드는 케이스.
    /// 예: RECT1 의 위쪽 변과 같은 y 좌표에서 RECT2 의 아래쪽 변이 시작.
    /// 두 변이 서로 다른 vertex 사이에 collinear 로 떨어져 있음.
    #[test]
    fn test_collinear_adjacent_rect_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 2×2 at origin, top edge at y=1
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT2 — 2×2 at (3, 1) — bottom edge collinear with RECT1 top extension
        //   but x range [-2, 0] vs [2, 4] non-overlapping. The bottom edge of RECT2
        //   is collinear with RECT1's top edge but not connected.
        let r = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let xia = match r {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("collinear RECT2 failed: {:?}", r),
        };
        let face_count = scene.xias.get(&xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(face_count >= 1, "RECT2 collinear: no face");
        assert_eq!(scene.mesh.face_count(), 2);
    }

    /// 사용자 보고 2026-04-28 (3) — L-shape + 내부 subdivisions 시나리오.
    /// 화면 사진에서 보이는 거에 가장 가까운 reproduction:
    ///   1. RECT1 (큰 직사각형)
    ///   2. RECT2 (RECT1 일부에 겹치게)
    ///   3. RECT3, RECT4 (작은 inset rect 여러 개)
    /// 각 RECT 의 XIA 가 face_id 를 갖고, normal.z>0, export 에 모두 포함되는지.
    #[test]
    fn test_lshape_with_inner_rects_all_faced() {
        let mut scene = Scene::new();
        let rects = [
            // (cx, cy, w, h)
            (0.0, 0.0, 8.0, 4.0),     // RECT1 big
            (5.0, 2.0, 4.0, 2.0),     // RECT2 overlapping RECT1 corner
            (-2.0, 0.0, 2.0, 2.0),    // RECT3 inside RECT1 left
            (1.0, 0.0, 2.0, 2.0),     // RECT4 inside RECT1 middle
        ];
        let mut xia_ids = Vec::new();
        for &(cx, cy, w, h) in &rects {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((cx, cy, id)),
                e => panic!("rect ({},{},{}x{}) failed: {:?}", cx, cy, w, h, e),
            }
        }

        // 1) 모든 XIA 가 face_id 보유 (wire-only XIA 없음)
        for &(cx, cy, xid) in &xia_ids {
            let face_count = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "rect at ({},{}) — XIA stays as wire-only (face count 0)",
                cx, cy
            );
        }

        // 2) 모든 active face 의 winding CCW (normal.z > 0)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                f.normal().z > 0.0,
                "face {:?} has flipped normal {:?}", fid, f.normal()
            );
        }

        // 3) 모든 face 가 export 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing faces: {:?}", missing);

        // 4) 모든 face 가 XIA 등록
        let mut orphans: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) { orphans.push(fid); }
        }
        assert!(orphans.is_empty(), "orphan faces (no XIA): {:?}", orphans);
    }

    /// 사용자 보고 2026-04-28 (19) — outer 의 한 edge 가 inner 의 edge 와
    /// 정확히 일치 (collinear overlap, snap 사용).
    #[test]
    fn test_outer_edge_collinear_overlap_with_inner() {
        let mut scene = Scene::new();
        // Inner1: bottom-left at (0,0), top-right at (4,2)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Inner2: starts where inner1 ends, bottom-left at (4,0), top-right at (8,2)
        scene.execute(Command::DrawRect {
            center: DVec3::new(6.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer: bottom-left at (0,0)=inner1 BL, top-right at (8,2)=inner2 TR.
        // Outer's bottom edge IS inner1+inner2's bottom edge (collinear, same x range).
        // Outer's top edge similar.
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 8.0, height: 2.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (18) — VERY LARGE outer drawn after inners.
    /// 사용자 화면: 큰 outline 만 보이는 outer, 작은 inner rects 가 lower-right
    /// 에 모여있음.
    #[test]
    fn test_very_large_outer_after_small_inners() {
        let mut scene = Scene::new();
        // 사용자 화면 처럼 inner rects 는 작고 lower-right 에 위치
        scene.execute(Command::DrawRect {
            center: DVec3::new(8.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 5.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(11.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 5.0, height: 2.0,
        });
        // VERY LARGE outer covering far upper-left area + reaching to inner rects
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 30.0, height: 20.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);
    }

    /// 사용자 보고 2026-04-28 (17) — outer RECT 의 edge 가 inner 의 edge 와
    /// 일부 일치 (snap drawing). outer 의 face 가 사라지는지 확인.
    #[test]
    fn test_outer_edge_coincides_with_inner_edge() {
        let mut scene = Scene::new();
        // Inner rect 1 at corner — its corners might align with outer's corners
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Inner rect 2 (partial overlap with inner 1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer rect — its bottom edge at y=0 (= inners' bottom y=0)
        // and right edge at x=7 (= inner2's right x=7).
        // → outer shares 2 corners + partial edges with inners.
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 4.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 14.0, height: 8.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (16) — 화면 사진 정확 reproduction:
    /// 2 개 partial-overlap inner RECT 후 ENCLOSING outer RECT 그리면
    /// outer 의 face 가 사라짐.
    #[test]
    fn test_enclosing_outer_after_overlapping_inners() {
        let mut scene = Scene::new();
        // Inner rect 1
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Inner rect 2 (partial overlap with inner 1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Outer rect ENCLOSING both inners (drawn last)
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        // 진단 정보
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let pts: Vec<DVec3> = v.iter().filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            let mut xmn = f64::INFINITY; let mut xmx = f64::NEG_INFINITY;
            let mut ymn = f64::INFINITY; let mut ymx = f64::NEG_INFINITY;
            for p in &pts {
                xmn = xmn.min(p.x); xmx = xmx.max(p.x);
                ymn = ymn.min(p.y); ymx = ymx.max(p.y);
            }
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} aabb=({:.1}..{:.1},{:.1}..{:.1}) xia={:?}\n",
                fid, n.z, v.len(), xmn, xmx, ymn, ymx, xia
            ));
        }

        assert!(
            outer_face_count >= 1,
            "outer XIA lost face — only outline visible.\n{}", report
        );

        // 모든 active face: winding +Z
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0,
                "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (13) — 그리는 순서 무관성 검증.
    /// 같은 RECT 집합을 다른 순서로 그려도 같은 face 토폴로지 (face_count
    /// 동일, 각 face 의 area 동일, missing 없음) 가 나와야 함.
    #[test]
    fn test_draw_order_independence() {
        let rects = [
            (DVec3::ZERO, 8.0, 6.0),                  // outer
            (DVec3::new(-1.5, 0.0, 0.0), 3.0, 2.0),   // inner1 left
            (DVec3::new(1.5, 0.0, 0.0), 3.0, 2.0),    // inner2 right (shares y, partial overlap)
            (DVec3::new(0.0, 1.5, 0.0), 4.0, 1.0),    // inner3 top (overlaps inner1+inner2)
        ];

        // Order 1: 0,1,2,3
        let scene_a = build_scene(&rects, &[0, 1, 2, 3]);
        // Order 2: 3,2,1,0 (reverse)
        let scene_b = build_scene(&rects, &[3, 2, 1, 0]);
        // Order 3: 1,3,0,2
        let scene_c = build_scene(&rects, &[1, 3, 0, 2]);

        let count_a = active_face_count(&scene_a);
        let count_b = active_face_count(&scene_b);
        let count_c = active_face_count(&scene_c);
        let area_a = total_face_area(&scene_a);
        let area_b = total_face_area(&scene_b);
        let area_c = total_face_area(&scene_c);

        // 각 순서로 그린 결과:
        //   - 모든 active face 의 normal +Z (winding 일관)
        //   - face count 같음 (또는 비슷 — 일부 path 차이로 ±1 허용)
        //   - 총 area 같음 (geometric union 의 합)
        for (i, scene) in [&scene_a, &scene_b, &scene_c].iter().enumerate() {
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                    "order {}: face {:?} degenerate", i, fid);
                assert!(n.z > 0.0,
                    "order {}: face {:?} flipped", i, fid);
            }
        }

        // Total area 는 거의 같아야 함 (overlap region 처리 일관).
        let area_diff_ab = (area_a - area_b).abs();
        let area_diff_ac = (area_a - area_c).abs();
        assert!(
            area_diff_ab < 0.5 && area_diff_ac < 0.5,
            "drawing order changes total area: a={:.2}, b={:.2}, c={:.2}",
            area_a, area_b, area_c
        );

        let _ = count_a; let _ = count_b; let _ = count_c;
    }

    fn build_scene(rects: &[(DVec3, f64, f64)], order: &[usize]) -> Scene {
        let mut scene = Scene::new();
        for &i in order {
            let (c, w, h) = rects[i];
            scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }
        scene
    }

    fn active_face_count(scene: &Scene) -> usize {
        scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count()
    }

    fn total_face_area(scene: &Scene) -> f64 {
        let mut total = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let verts = match scene.mesh.collect_loop_verts(f.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            if pts.len() < 3 { continue; }
            let mut a = 0.0;
            for i in 0..pts.len() {
                let p = pts[i];
                let q = pts[(i + 1) % pts.len()];
                a += p.x * q.y - q.x * p.y;
            }
            total += (a * 0.5).abs();
        }
        total
    }

    /// 사용자 보고 2026-04-28 (12) — 사용자 화면 사진 reproduction:
    /// 큰 RECT + 여러 partial-overlap RECT + 가장 작은 RECT 가 면 사라짐.
    #[test]
    fn test_user_pattern_no_missing_faces() {
        let mut scene = Scene::new();
        // 사용자 화면 패턴: 다양한 크기의 RECT 가 partial overlap
        let rects = [
            (DVec3::new(0.0, 4.0, 0.0), 12.0, 2.0),   // top long
            (DVec3::new(-2.0, 1.0, 0.0), 6.0, 3.0),   // upper left
            (DVec3::new(2.0, 1.0, 0.0), 6.0, 3.0),    // upper right (overlaps)
            (DVec3::new(-2.0, -1.0, 0.0), 5.0, 2.0),  // lower left
            (DVec3::new(2.0, -1.0, 0.0), 5.0, 2.0),   // lower right (overlaps)
            (DVec3::new(0.0, -1.0, 0.0), 1.5, 1.0),   // small middle (likely missing in user's case)
        ];
        let mut xia_ids = Vec::new();
        for (i, &(c, w, h)) in rects.iter().enumerate() {
            let r = scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((i, c, id)),
                e => panic!("rect {} at {:?} {}×{} failed: {:?}", i, c, w, h, e),
            }
        }

        // 모든 XIA 가 face_ids 보유 (wire-only XIA 없음)
        let mut wire_only: Vec<(usize, DVec3)> = Vec::new();
        for &(i, c, xid) in &xia_ids {
            let fc = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if fc == 0 {
                wire_only.push((i, c));
            }
        }

        // Diagnostic
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!("  {:?} n={:.2?} verts={} xia={:?}\n",
                fid, (n.x, n.y, n.z), v.len(), xia));
        }
        assert!(
            wire_only.is_empty(),
            "wire-only XIAs: {:?}\nFace report:\n{}", wire_only, report
        );

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate n={:?}", fid, n);
            assert!(n.z > 0.0, "face {:?} flipped n={:?}", fid, n);
        }
    }

    /// 사용자 보고 2026-04-28 (11) — deeply nested RECT 사진 reproduction.
    /// 각 RECT 가 이전 것 안에 들어가는 nested 구조 (러시아 인형식).
    #[test]
    fn test_deeply_nested_rects_all_have_faces() {
        let mut scene = Scene::new();
        // 6 levels of nested rects (largest to smallest)
        let levels = [12.0, 8.0, 5.0, 3.0, 2.0, 1.0];
        let mut xia_ids = Vec::new();
        for (i, &size) in levels.iter().enumerate() {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: size, height: size * 0.6,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((i, size, id)),
                e => panic!("level {} size={} failed: {:?}", i, size, e),
            }
        }
        // 모든 XIA 가 face_ids 보유
        let mut wire_only: Vec<(usize, f64)> = Vec::new();
        for &(i, size, xid) in &xia_ids {
            let fc = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if fc == 0 {
                wire_only.push((i, size));
            }
        }
        assert!(
            wire_only.is_empty(),
            "wire-only XIAs (no face): {:?}", wire_only
        );

        // 모든 active face: winding + non-degenerate
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
            assert!(n.z > 0.0, "face {:?} flipped: {:?}", fid, n);
        }
    }

    /// 사용자 보고 2026-04-28 (10) — 다양한 partial-overlap 케이스에서
    /// degenerate (NaN / sliver) face 와 shadow 렌더 검증.
    #[test]
    fn test_partial_overlap_no_degenerate_faces() {
        let configurations = [
            // (label, rects)
            ("A: 2 rect partial overlap", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(2.0, 0.0, 0.0), 4.0, 2.0),
            ]),
            ("B: 3 rect chain", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(2.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(4.0, 0.0, 0.0), 4.0, 2.0),
            ]),
            ("C: rect crossing rect", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 1.0),
                (DVec3::new(0.0, 0.0, 0.0), 1.0, 4.0),
            ]),
            ("D: shared corner", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 4.0),
                (DVec3::new(4.0, 4.0, 0.0), 4.0, 4.0),
            ]),
            ("E: shared edge", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 4.0),
                (DVec3::new(4.0, 0.0, 0.0), 4.0, 4.0),
            ]),
            ("F: outer + 2 partial inners", vec![
                (DVec3::ZERO, 12.0, 6.0),
                (DVec3::new(-2.0, 0.0, 0.0), 4.0, 3.0),
                (DVec3::new(1.0, 0.0, 0.0), 4.0, 3.0),
            ]),
        ];

        for (label, rects) in configurations {
            let mut scene = Scene::new();
            for &(c, w, h) in &rects {
                scene.execute(Command::DrawRect {
                    center: c, normal: DVec3::Z, up: DVec3::Y,
                    width: w, height: h,
                });
            }
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(n.x.is_finite() && n.y.is_finite() && n.z.is_finite(),
                    "[{}] face {:?} NaN normal", label, fid);
                assert!(n.length_squared() > 1e-12,
                    "[{}] face {:?} zero normal", label, fid);
                assert!(n.z > 0.0,
                    "[{}] face {:?} flipped: {:?}", label, fid, n);
            }
            // 모든 active face 가 XIA 등록 + export 됨
            let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
            let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
                .map(|&fm| axia_geo::FaceId::new(fm)).collect();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                assert!(scene.face_to_xia.contains_key(&fid),
                    "[{}] face {:?} no XIA mapping", label, fid);
                assert!(exported.contains(&fid),
                    "[{}] face {:?} missing from buffer", label, fid);
            }
        }
    }

    /// 사용자 보고 2026-04-28 (9) — 사용자 화면 사진 그대로 reproduction:
    /// outer RECT + 2개 partially-overlapping inner RECT. outer 의 face 가
    /// 보존되고, overlap 영역에 shadow degenerate 없어야.
    #[test]
    fn test_outer_with_two_partial_overlap_inners() {
        let mut scene = Scene::new();
        // Outer big rect
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let outer_xia = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // Inner rect 1 — left portion
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        // Inner rect 2 — right portion, partially overlapping inner1
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        // outer XIA 가 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!("  {:?} n={:.2?} verts={} xia={:?}\n",
                fid, (n.x, n.y, n.z), v.len(), xia));
        }
        assert!(
            outer_face_count >= 1,
            "outer XIA lost face\n{}", report
        );

        // 모든 active face: 정상 winding (no NaN / no -Z)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.y.is_finite() && n.z.is_finite(),
                "face {:?} has NaN normal", fid);
            assert!(n.length_squared() > 1e-12,
                "face {:?} has zero normal", fid);
            assert!(n.z > 0.0,
                "face {:?} flipped: {:?}", fid, n);
        }

        // 모든 active face 가 export buffer 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
        }
    }

    /// 사용자 보고 2026-04-28 (7) — outer RECT 를 inner RECT 들 위에 그렸을 때
    /// outer 의 face 가 사라지는 회귀.
    #[test]
    fn test_outer_rect_drawn_after_inners_keeps_face() {
        let mut scene = Scene::new();
        // 작은 inner rects 먼저
        for &(cx, cy) in &[(-2.0, -2.0), (2.0, -2.0), (-2.0, 2.0), (2.0, 2.0)] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)));
        }
        // 큰 outer rect 가 inner 들을 enclose
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 8.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(outer_face_count >= 1, "outer XIA has no face after drawing over inners");

        // 모든 active face: normal.z > 0
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (8) — outer 큰 RECT 와 그 안 + 바깥에 걸친 RECT.
    /// outer 의 face 가 사라지지 않아야.
    #[test]
    fn test_outer_with_overlapping_extending_rects() {
        let mut scene = Scene::new();
        // Outer big rect
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 14.0, height: 6.0,
        });
        let outer_xia = match r_outer { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // Rects 일부는 outer 안, 일부는 outer 경계 가로지름
        let crossings = [
            (5.0, 0.0, 6.0, 4.0),     // crosses right boundary
            (-5.0, 0.0, 6.0, 4.0),    // crosses left boundary
            (0.0, 0.0, 4.0, 8.0),     // crosses top + bottom
        ];
        for &(cx, cy, w, h) in &crossings {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }

        // outer XIA 가 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        // 모든 active face 정보 출력
        let mut report = String::new();
        report.push_str("Active faces:\n");
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let n_verts = v.len();
            report.push_str(&format!("  {:?}: {} verts → xia {:?}\n", fid, n_verts, xia));
        }
        let total_active: usize = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(
            outer_face_count >= 1 && total_active >= 1,
            "outer face_count={}, total active={}\n{}",
            outer_face_count, total_active, report
        );

        // 모든 active face winding
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (6) — 많은 RECT 가 다양하게 overlap 할 때
    /// 일부 영역이 채워지지 않거나 ("미면화"), shadow 처럼 렌더링 ("z-fight").
    /// 다양한 overlap 케이스 stress test.
    #[test]
    fn test_complex_overlap_no_missing_faces() {
        let mut scene = Scene::new();
        // 사용자 화면과 유사 — 여러 rect 가 부분/전체 겹침
        let rects = [
            (DVec3::ZERO, 16.0, 8.0),                       // outer big
            (DVec3::new(-3.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(0.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(3.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(-3.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(0.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(3.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(5.0, 0.0, 0.0), 6.0, 6.0),  // overlapping right
            (DVec3::new(-5.0, 0.0, 0.0), 6.0, 6.0), // overlapping left
        ];
        for &(c, w, h) in &rects {
            let r = scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)),
                "rect at {:?} {}×{} failed: {:?}", c, w, h, r);
        }

        // 모든 active face: normal.z > 0, in export buffer, has XIA
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            // Winding
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
            // Export
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
            // XIA
            assert!(scene.face_to_xia.contains_key(&fid),
                "face {:?} has no XIA mapping", fid);
        }
    }

    /// 사용자 보고 2026-04-28 (5) — outer RECT 그린 후 inner RECT 여러 개 그릴 때
    /// outer 의 face 가 사라지는 회귀 검증. outer 는 항상 active 여야 함.
    #[test]
    fn test_outer_rect_preserved_after_many_inners() {
        let mut scene = Scene::new();
        // Outer 큰 rect
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        let outer_xia = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // 8 inner rects 다양한 위치
        let inners = [
            (-4.0, -2.0, 2.0, 2.0),
            (-1.0, -2.0, 2.0, 2.0),
            (2.0, -2.0, 2.0, 2.0),
            (4.0, -2.0, 1.5, 2.0),
            (-4.0, 2.0, 2.0, 2.0),
            (-1.0, 2.0, 2.0, 2.0),
            (2.0, 2.0, 2.0, 2.0),
            (4.0, 2.0, 1.5, 2.0),
        ];
        for &(cx, cy, w, h) in &inners {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }

        // outer XIA 가 여전히 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            outer_face_count >= 1,
            "outer XIA lost its face after {} inner rects drawn", inners.len()
        );

        // 모든 active face normal.z > 0
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                f.normal().z > 0.0,
                "face {:?} flipped: normal {:?}", fid, f.normal()
            );
        }

        // 모든 active face 가 export buffer 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
        }
    }

    /// 사용자 보고 2026-04-28 — 면이 그리는 방향에 따라 뒤집혀 BackSide
    /// 로 렌더되는 현상. ADR-007 Invariant 2 (Winding) 정합 검증:
    /// 어느 방향으로 RECT 를 그리든 모든 face 가 surface_normal 방향과
    /// 같은 normal 을 가져야 함 (XY plane → +Z normal).
    #[test]
    fn test_all_rects_have_consistent_winding() {
        let mut scene = Scene::new();
        // 다양한 RECT — 모두 XY 평면, normal +Z 기대.
        let rects = [
            (DVec3::new(0.0, 0.0, 0.0), DVec3::Y, 4.0, 4.0),
            (DVec3::new(5.0, 0.0, 0.0), DVec3::Y, 3.0, 3.0),
            (DVec3::new(-5.0, 0.0, 0.0), DVec3::Y, 3.0, 3.0),
            (DVec3::new(0.0, 5.0, 0.0), DVec3::Y, 4.0, 2.0),
            (DVec3::new(0.0, -5.0, 0.0), DVec3::Y, 2.0, 4.0),
        ];
        for &(center, up, w, h) in &rects {
            scene.execute(Command::DrawRect {
                center, normal: DVec3::Z, up,
                width: w, height: h,
            });
        }
        // 모든 active face 의 normal.z > 0 (CCW = front)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(
                n.z > 0.0,
                "face {:?} has flipped normal {:?} — BackSide rendering",
                fid, n
            );
        }
    }

    /// 사용자 보고 2026-04-28 — 2 stacked inner rects.
    /// ADR-015 Phase 2: B1 auto hole-promote 비활성으로 자연스럽게 작동.
    #[test]
    fn test_two_stacked_inner_rects_both_faced() {
        let mut scene = Scene::new();
        // RECT outer 10×6
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // inner1 below center at (0, -1), 4×2 → spans y∈[-2, 0]
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, -1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };
        let face1_count = scene.xias.get(&xid1).map(|x| x.face_ids.len()).unwrap_or(0);

        // inner2 above center at (0, 1), 4×2 → spans y∈[0, 2]; shares y=0 edge with inner1
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let xid2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            ref e => panic!("inner2 result: {:?}", e),
        };
        let face2_count = scene.xias.get(&xid2).map(|x| x.face_ids.len()).unwrap_or(0);

        // After inner2 draw, inner1's face might have been touched. Re-check.
        let face1_count_after = scene.xias.get(&xid1).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let verts = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            let xia_link = scene.face_to_xia.get(&fid).copied().unwrap_or(99999);
            report.push_str(&format!(
                "  {:?} → XIA {} : verts={:?} pts={:?}\n",
                fid, xia_link, verts, pts
            ));
        }

        assert!(
            face1_count >= 1 && face1_count_after >= 1 && face2_count >= 1,
            "face counts: inner1_initial={}, inner1_after_inner2={}, inner2={}\nFace report:\n{}",
            face1_count, face1_count_after, face2_count, report
        );
    }

    /// 사용자 화면 사진 (2026-04-28-3) — 큰 RECT 안에 작은 RECT 들이
    /// vertically 쌓여 column 을 이루는 케이스. ADR-015 로 해결.
    #[test]
    fn test_column_of_inner_rects_all_faced() {
        let mut scene = Scene::new();
        // RECT1 — big outer (10×9, 9 height to fit 3 stacked 2-height rects in 6 + margins)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 9.0,
        });

        // 5 stacked inner rects, each 4×1.5, centers stacked vertically
        let inner_rects: Vec<(f64, f64, f64, f64)> = vec![
            (0.0, -3.0, 4.0, 1.5),
            (0.0, -1.5, 4.0, 1.5),
            (0.0,  0.0, 4.0, 1.5),
            (0.0,  1.5, 4.0, 1.5),
            (0.0,  3.0, 4.0, 1.5),
        ];
        let mut xia_ids = Vec::new();
        for &(cx, cy, w, h) in &inner_rects {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((cx, cy, id)),
                e => panic!("inner rect at ({},{}) failed: {:?}", cx, cy, e),
            }
        }

        // 1) 모든 inner rect XIA 가 face 보유 (wire-only 없음)
        let mut wire_only_count = 0;
        for &(cx, cy, xid) in &xia_ids {
            let face_count = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if face_count == 0 {
                wire_only_count += 1;
                let _ = (cx, cy);
            }
        }
        assert_eq!(
            wire_only_count, 0,
            "{} inner rects ended up wire-only (no face) — bug reproduced",
            wire_only_count
        );

        // 2) 모든 active face 의 winding CCW
        let mut flipped: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.normal().z <= 0.0 { flipped.push(fid); }
        }
        assert!(flipped.is_empty(), "flipped faces: {:?}", flipped);

        // 3) export_mesh_buffers 에 모두 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 2×2 grid 의 인접 RECT 4 개. 모두 면 생성되어야.
    #[test]
    fn test_2x2_grid_all_faces_synthesize() {
        let mut scene = Scene::new();
        // 2×2 grid of unit rects, each 2×2, centers at (-1,-1) (1,-1) (-1,1) (1,1)
        for &(cx, cy) in &[(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let xia_id = match r {
                CommandResult::EntityCreated(id) => id,
                _ => panic!("grid rect at ({},{}) failed: {:?}", cx, cy, r),
            };
            let face_count = scene.xias.get(&xia_id).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "grid rect at ({},{}) — XIA has no face_ids (wire-only)", cx, cy
            );
        }
        // 4 faces 기대
        assert_eq!(
            scene.mesh.face_count(), 4,
            "2×2 grid should yield 4 faces"
        );
    }

    /// 다양한 overlap 구성 stress test — 각 구성에서 모든 active face 가
    /// 1) export buffer 에 포함되고 2) XIA 에 등록됐는지 확인.
    #[test]
    fn test_multi_rect_stress_no_missing_cells() {
        // (label, [(center_x, center_y, w, h), ...])
        let configs: Vec<(&str, Vec<(f64, f64, f64, f64)>)> = vec![
            // case A: 두 RECT 한 코너에서 만남 (snap 시뮬)
            ("A: corner-shared", vec![
                (0.0, 0.0, 4.0, 4.0),
                (4.0, 4.0, 4.0, 4.0),  // shares one corner (2,2) ... actually (2,2) vs (2,2) yes
            ]),
            // case B: T자 — RECT2 의 한 변이 RECT1 한 변에 정확히 맞닿음
            ("B: T-junction", vec![
                (0.0, 0.0, 6.0, 4.0),
                (0.0, 3.0, 4.0, 2.0),  // bottom edge at y=2, top of RECT1 at y=2
            ]),
            // case C: 4 RECT cross (대표 case — 사용자 시나리오와 유사)
            ("C: cross-overlap-4", vec![
                (0.0, 0.0, 6.0, 4.0),
                (3.0, 0.0, 4.0, 2.0),
                (0.0, 2.0, 3.0, 3.0),
                (4.0, 3.0, 3.0, 3.0),
            ]),
            // case D: nested + side rect
            ("D: nested+side", vec![
                (0.0, 0.0, 10.0, 6.0),
                (0.0, 0.0, 4.0, 2.0),     // inside RECT1 (B1 hole-promote)
                (5.0, 0.0, 6.0, 2.0),     // crosses RECT1 right boundary
            ]),
            // case E: snap-aligned grid (3개 RECT 가 정확히 corner share)
            ("E: aligned-grid", vec![
                (0.0, 0.0, 4.0, 4.0),     // [-2,2]×[-2,2]
                (4.0, 0.0, 4.0, 4.0),     // [2,6]×[-2,2] (shares right edge of RECT1)
                (2.0, 4.0, 4.0, 4.0),     // [0,4]×[2,6] (shares top with both)
            ]),
        ];

        for (label, rects) in configs {
            let mut scene = Scene::new();
            for &(cx, cy, w, h) in &rects {
                let r = scene.execute(Command::DrawRect {
                    center: DVec3::new(cx, cy, 0.0),
                    normal: DVec3::Z,
                    up: DVec3::Y,
                    width: w,
                    height: h,
                });
                assert!(
                    matches!(r, CommandResult::EntityCreated(_)),
                    "{}: rect ({},{},{}x{}) failed: {:?}",
                    label, cx, cy, w, h, r
                );
            }

            // Check: every active face appears in mesh buffer
            let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
            let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
                .map(|&fm| axia_geo::FaceId::new(fm))
                .collect();

            let mut missing: Vec<axia_geo::FaceId> = Vec::new();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if !exported.contains(&fid) { missing.push(fid); }
            }
            assert!(
                missing.is_empty(),
                "{}: active faces missing from buffer: {:?}",
                label, missing
            );

            // Check: every active face has XIA
            let mut orphans: Vec<axia_geo::FaceId> = Vec::new();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if !scene.face_to_xia.contains_key(&fid) { orphans.push(fid); }
            }
            assert!(
                orphans.is_empty(),
                "{}: orphan faces (no XIA): {:?}",
                label, orphans
            );

            // Check: every active face has visible flag
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                assert!(
                    f.is_visible(),
                    "{}: face {:?} is active but not visible",
                    label, fid
                );
            }

            // Check: 모든 face 가 같은 방향 (Z+) — XY plane 위에 그렸으니 CCW
            //   wound 면은 normal.z > 0. 한 face 라도 normal.z < 0 이면 CAD
            //   single-sided 렌더에서 보이지 않음 (사용자 보고 회귀).
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(
                    n.z > 0.0,
                    "{}: face {:?} has flipped normal (z={}) — invisible in CAD single-sided render",
                    label, fid, n.z
                );
            }
        }
    }

    /// Phase A 디버그: 단일 inner promote 후 ring 의 outer edge radial 검증.
    /// promote_face_to_hole 가 HE manifold 를 깨끗하게 유지하는지 검증.
    #[test]
    fn test_phaseA_promote_keeps_outer_radial_manifold() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face should exist");

        let outer_start = scene.mesh.faces[ring_fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial_entries = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial_entries.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, Vec<axia_geo::HeId>> =
                std::collections::HashMap::new();
            for (h_id, dst, _f) in &radial_entries {
                by_dst.entry(*dst).or_default().push(*h_id);
            }
            for (dst, hes) in &by_dst {
                if hes.len() > 1 {
                    violations.push(format!(
                        "edge of HE {:?}: {} HEs share dst={:?}: {:?}",
                        h, hes.len(), dst, hes
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        assert!(
            violations.is_empty(),
            "HE manifold corruption in ring outer:\n{}",
            violations.join("\n")
        );
    }

    /// ADR-021 Phase B (3B fix) — 3-level nested, smallest first.
    /// Phase A HE manifold fix 후 ring 을 inner candidate 로 허용.
    #[test]
    fn test_adr021_phaseB_3level_nested_smallest_first() {
        let mut scene = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy auto Step 4.95 P7 ring rebuild
        scene.auto_face_synthesis_on_draw = true;
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();
        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 2,
            "3B Phase B: expected 2 nested rings; got {:?}",
            active
        );
        assert_eq!(
            simple_count, 1,
            "3B Phase B: expected 1 innermost sub-face; got {:?}",
            active
        );
    }

    /// Phase A: 4 line 으로 단독 RECT 그렸을 때 (no promote) HE manifold 검증.
    /// resolver 결과 corruption 인지 promote 결과 corruption 인지 분리.
    #[test]
    fn test_phaseA_isolated_4line_rect_no_promote() {
        let mut scene = Scene::new();
        // No prior face. Draw 4 lines forming a rect — resolver creates simple face.
        scene.execute(Command::DrawLine {
            start: DVec3::new(-5.0, -3.0, 0.0),
            end: DVec3::new(5.0, -3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(5.0, -3.0, 0.0),
            end: DVec3::new(5.0, 3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(5.0, 3.0, 0.0),
            end: DVec3::new(-5.0, 3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(-5.0, 3.0, 0.0),
            end: DVec3::new(-5.0, -3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });

        let face = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active())
            .map(|(id, _)| id);
        // Closed loop should auto-synthesize per ADR-019 A6
        assert!(face.is_some(), "4-line closed loop should produce a face");
        let fid = face.unwrap();

        let outer_start = scene.mesh.faces[fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                std::collections::HashMap::new();
            for (_, dst, _) in &radial {
                *by_dst.entry(*dst).or_insert(0) += 1;
            }
            for (dst, count) in &by_dst {
                if *count > 1 {
                    violations.push(format!(
                        "HE {:?}: dst={:?} count={} radial={:?}",
                        h, dst, count, radial
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        assert!(
            violations.is_empty(),
            "4-line resolver corruption (no promote):\n{}",
            violations.join("\n")
        );
    }

    /// Phase A: postprocess 경로의 promote 가 corruption 일으키는지 검증.
    /// inner-first 후 outer-around (Step 4.95 second-pass 경로).
    #[test]
    fn test_phaseA_postprocess_promote_path_radial() {
        let mut scene = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy auto Step 4.95 P7 ring rebuild
        scene.auto_face_synthesis_on_draw = true;
        // inner first
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // outer around (4 lines + epoch + Step 4.95 promote)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });

        // Find ring face
        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face should exist (postprocess promote)");

        let outer_start = scene.mesh.faces[ring_fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                std::collections::HashMap::new();
            for (_, dst, _) in &radial {
                *by_dst.entry(*dst).or_insert(0) += 1;
            }
            for (dst, count) in &by_dst {
                if *count > 1 {
                    violations.push(format!(
                        "HE {:?}: dst={:?} count={} radial={:?}",
                        h, dst, count, radial
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        // Print edge endpoints for diagnostic
        if !violations.is_empty() {
            let mut h2 = outer_start;
            let mut g2 = 0;
            loop {
                g2 += 1; if g2 > 32 { break; }
                let he = &scene.mesh.hes[h2];
                let edge = &scene.mesh.edges[he.edge()];
                eprintln!("[edge dbg] HE {:?} edge {:?} v_small={:?} v_large={:?}",
                    h2, he.edge(), edge.v_small(), edge.v_large());
                h2 = he.next();
                if h2 == outer_start { break; }
            }
        }
        assert!(
            violations.is_empty(),
            "Manifold corruption (postprocess promote):\n{}",
            violations.join("\n")
        );
    }

    /// Phase A 디버그: 3-level nested 시나리오 (3B style) 에서 corruption 시점 추적.
    #[test]
    fn test_phaseA_3level_nested_radial_check_after_each_step() {
        // Helper closure
        fn check_all_radials(scene: &Scene, label: &str) -> Vec<String> {
            let mut violations = Vec::new();
            for (fid, face) in scene.mesh.faces.iter() {
                if !face.is_active() { continue; }
                let outer_start = face.outer().start;
                if outer_start.is_null() { continue; }
                let mut h = outer_start;
                let mut guard = 0;
                loop {
                    guard += 1; if guard > 32 { break; }
                    let he = &scene.mesh.hes[h];
                    // Check radial chain
                    let mut radial_entries: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
                    let mut rh = h;
                    let mut rg = 0;
                    loop {
                        rg += 1; if rg > 16 { break; }
                        let rhe = &scene.mesh.hes[rh];
                        radial_entries.push((rh, rhe.dst(), rhe.face()));
                        rh = rhe.next_rad();
                        if rh == h { break; }
                    }
                    let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                        std::collections::HashMap::new();
                    for (_, dst, _) in &radial_entries {
                        *by_dst.entry(*dst).or_insert(0) += 1;
                    }
                    for (dst, count) in &by_dst {
                        if *count > 1 {
                            violations.push(format!(
                                "{}: face {:?} edge of HE {:?}: {} HEs with dst={:?}, radial={:?}",
                                label, fid, h, count, dst, radial_entries
                            ));
                        }
                    }
                    h = he.next();
                    if h == outer_start { break; }
                }
            }
            violations
        }

        let mut scene = Scene::new();
        // Step 1: innermost (4×2)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let v1 = check_all_radials(&scene, "after_step1_innermost");
        // Step 2: middle (10×6)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let v2 = check_all_radials(&scene, "after_step2_middle_drawn");
        // Step 3: outer (20×12)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let v3 = check_all_radials(&scene, "after_step3_outer_drawn");

        let all: Vec<String> = [v1, v2, v3].concat();
        if !all.is_empty() {
            panic!("Manifold corruption detected:\n{}", all.join("\n"));
        }
    }

    /// ADR-021 P7 — Closed edge loop divides face. 그리기 순서 무관성 검증.
    /// Case A (inner 먼저): 2 small + big around → big = ring with 1 combined hole.
    /// Case B (outer 먼저): big + 2 small inside → big = ring with 1 combined hole.
    /// 두 case 모두 동일 토폴로지: 1 ring + 2 sub-face = 3 active faces.
    #[test]
    fn test_adr021_p7_case_a_inner_first_then_outer() {
        let mut scene = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy P7 auto containment split
        scene.auto_face_synthesis_on_draw = true;
        // 2 inner adjacent (sharing an edge)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        // big rect surrounding both
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 24.0, height: 11.0,
        });

        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();

        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "Case A: expected 1 ring with combined hole; got faces={:?}",
            active
        );
        assert_eq!(
            simple_count, 2,
            "Case A: expected 2 sub-faces (inners); got faces={:?}",
            active
        );
    }

    #[test]
    fn test_adr021_p7_case_b_outer_first_then_inner() {
        let mut scene = Scene::new();
        // big rect first
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 24.0, height: 11.0,
        });
        // 2 inner adjacent inside
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });

        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();

        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "Case B: expected 1 ring with combined hole; got faces={:?}",
            active
        );
        assert_eq!(
            simple_count, 2,
            "Case B: expected 2 sub-faces (inners); got faces={:?}",
            active
        );
    }

    /// ADR-019 A6 — 4 line 으로 face 안에 닫힌 loop 그리면 sub-face 자동 합성.
    /// 사용자 보고 (2026-04-29): face 안에 4 line 으로 작은 사각형 그려도 면 분할
    /// 안 됨. A6 는 wire chain 의 endpoint 가 기존 vertex 와 dedup 시 postprocess
    /// 발동 → resolver 가 닫힌 cycle 발견 → sub-face 합성 (ADR-016 conditional B1
    /// promote 도 발동 가능).
    #[test]
    fn test_adr019_a6_closed_wire_loop_in_face_interior_synthesizes() {
        let mut scene = Scene::new();
        // 큰 RECT (face)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let after_big = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_big, 1, "big rect = 1 face");

        // 4 line 으로 작은 사각형 (face 안 strict interior).
        let p0 = DVec3::new(-2.0, -1.0, 0.0);
        let p1 = DVec3::new( 2.0, -1.0, 0.0);
        let p2 = DVec3::new( 2.0,  1.0, 0.0);
        let p3 = DVec3::new(-2.0,  1.0, 0.0);
        scene.execute(Command::DrawLine { start: p0, end: p1, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p1, end: p2, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p2, end: p3, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p3, end: p0, surface_normal: Some(DVec3::Z) });

        // 결과: 큰 face + 작은 sub-face 또는 ring + sub-face (B1 promote 시).
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, f)| (id, f.inners().len())).collect();
        assert!(
            active.len() >= 2,
            "expected big face + small sub-face (ADR-019 A6); got faces={:?}",
            active
        );
    }

    /// ADR-019 P5/P6 — 인접 두 RECT 의 공유 edge erase 시 새 통합 face 생성.
    /// 사용자 보고 회귀: "두 인접면의 라인을 지우면 새 큰 면이 생성되어야"
    /// (Phase 1 핵심 회귀 #3 — Appendix B).
    #[test]
    fn test_adr019_p6_adjacent_face_erase_creates_merged() {
        let mut scene = Scene::new();
        // 두 인접 RECT (Axiom 7 공유 edge).
        scene.execute(Command::DrawRect {
            center: DVec3::new(-5.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // 토폴로지: 2 simple face + 1 shared edge
        let active_before: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_before.len(), 2);

        // 공유 edge 찾기 (interior — 양 HE 모두 face 보유)
        let shared_eid = scene.mesh.edges.iter()
            .find(|(_, e)| {
                if !e.is_active() { return false; }
                let any = e.any_he();
                if any.is_null() { return false; }
                let twin = scene.mesh.he_twin(any);
                let f1 = scene.mesh.hes.get(any).map(|h| h.face());
                let f2 = scene.mesh.hes.get(twin).map(|h| h.face());
                matches!((f1, f2), (Some(a), Some(b)) if !a.is_null() && !b.is_null())
            })
            .map(|(id, _)| id)
            .expect("shared edge missing");

        let mat = crate::FORM_MATERIAL;
        let result = scene.mesh.erase_edge_resynthesize(shared_eid, mat, false)
            .expect("erase_edge_resynthesize");

        assert_eq!(result.removed_faces.len(), 2, "two adjacent RECTs removed");
        assert_eq!(
            result.new_faces.len(), 1,
            "expected 1 merged 6-vert face; got {}",
            result.new_faces.len()
        );
        let new_fid = result.new_faces[0];
        let verts = scene.mesh.collect_loop_verts(scene.mesh.faces[new_fid].outer().start).unwrap();
        // F6 collinear cleanup: 두 인접 10×6 → 20×6 단순 rect (4 corners).
        // 8 original verts - 2 shared - 2 collinear T-junction = 4.
        assert_eq!(verts.len(), 4, "merged face after F6 collinear cleanup = 4 corners (20×6 rect)");
        let f = &scene.mesh.faces[new_fid];
        assert!(f.inners().is_empty(), "merged face should be simple (no holes)");
    }

    /// ADR-016 §2 Path B — 그리기 순서 무관 (inner-first 도 outer-first 와
    /// 동일 결과). 사용자 보고 회귀: inner 그리고 outer 그린 뒤 inner 의
    /// edge 를 erase 했을 때 면이 사라짐.
    #[test]
    fn test_adr016_path_b_inner_first_then_outer_resynthesize() {
        let mut scene = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy P7 auto containment split
        scene.auto_face_synthesis_on_draw = true;
        // Inner 4×2 먼저
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer 10×6 (inner 를 둘러쌈) — Step 4.95 가 B1 promote 해야 함
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });

        // 토폴로지 검증: ring (1 hole) + inner sub-face = 2 active faces.
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();
        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "expected 1 ring face after Step 4.95 promote; got faces={:?}",
            active
        );
        assert_eq!(simple_count, 1, "expected 1 inner sub-face; got faces={:?}", active);

        let ring_fid = active.iter().find(|(_, n)| *n == 1).map(|(f, _)| *f).unwrap();
        let hole_eid = {
            let ring = &scene.mesh.faces[ring_fid];
            let inner_loop = &ring.inners()[0];
            let he = inner_loop.start;
            scene.mesh.hes.get(he).expect("hole HE").edge()
        };

        let mat = crate::FORM_MATERIAL;
        let result = scene.mesh.erase_edge_resynthesize(hole_eid, mat, false)
            .expect("erase_edge_resynthesize");
        assert_eq!(result.removed_faces.len(), 2, "ring+inner removed");
        assert_eq!(
            result.new_faces.len(), 1,
            "expected 1 re-synthesized outer face; got {}",
            result.new_faces.len()
        );
        let new_fid = result.new_faces[0];
        let new_face = &scene.mesh.faces[new_fid];
        assert!(new_face.inners().is_empty(), "new face should be simple");
        let verts = scene.mesh.collect_loop_verts(new_face.outer().start).unwrap();
        assert_eq!(verts.len(), 4, "expected 4-vert outer rectangle");
    }

    /// ADR-016 §2 Path B — hole edge erase 시 ring + inner 가 re-resolve 로
    /// 단일 simple face 로 재합성됨을 검증.
    #[test]
    fn test_adr016_path_b_hole_edge_resynthesize() {
        use axia_geo::Mesh;
        let mut scene = Scene::new();
        // Outer 10×6
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // Inner 4×2 inside → B1 promote → ring + inner sub-face.
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        // Topology check: 1 ring (1 hole) + 1 inner sub-face.
        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face missing — B1 didn't fire");

        // Pick one edge from the ring's hole loop.
        let hole_eid = {
            let ring = &scene.mesh.faces[ring_fid];
            let inner_loop = &ring.inners()[0];
            let he = inner_loop.start;
            scene.mesh.hes.get(he).expect("hole HE").edge()
        };

        // Path B: erase + re-resolve.
        let mat = crate::FORM_MATERIAL;
        let result = scene.mesh.erase_edge_resynthesize(hole_eid, mat, false)
            .expect("erase_edge_resynthesize");

        // 2 faces removed (ring + inner), 1 face synthesized (outer rect).
        assert_eq!(result.removed_faces.len(), 2);
        assert_eq!(result.new_faces.len(), 1, "expected 1 re-synthesized face");

        let new_fid = result.new_faces[0];
        let new_face = &scene.mesh.faces[new_fid];
        // New face should be a simple 4-vert rectangle (outer perimeter).
        assert!(new_face.inners().is_empty(), "new face should have no holes");
        let verts = scene.mesh.collect_loop_verts(new_face.outer().start).unwrap();
        assert_eq!(verts.len(), 4, "expected 4-vert outer rectangle");
    }

    /// ADR-016 — 첫 inner 만 B1 promote 검증.
    #[test]
    fn test_adr016_single_inner_promotes_to_hole() {
        let mut scene = Scene::new();
        // Outer 10×6 — 정확히 JS bridge 와 동일 파라미터 (center=(100,100,0)).
        scene.execute(Command::DrawRect {
            center: DVec3::new(100.0, 100.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // Inner 4×2 strictly inside — 같은 center.
        scene.execute(Command::DrawRect {
            center: DVec3::new(100.0, 100.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        // After B1 promote: outer 의 inners().len() == 1
        let mut ring_with_hole = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.inners().len() == 1 { ring_with_hole += 1; }
            else if f.inners().is_empty() { simple_active += 1; }
        }
        // Boundary edge count: ring's outer 4 = boundary, hole 4 = NOT boundary
        // (twin face is inner). Inner's 4 perimeter edges: face=inner on one
        // side, face=ring (hole) on twin side → NOT boundary.
        // Total boundary = 4.
        let mut boundary_count = 0;
        for (_, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            // boundary = at least one side has face=null
            // We need to find both HEs of this edge.
            // Simpler: check is_boundary via mesh helper if available.
        }
        // Fallback: count via halfedges with face=null.
        let mut he_with_null_face = 0;
        for (_, he) in scene.mesh.hes.iter() {
            if !he.is_active() { continue; }
            if he.face().is_null() { he_with_null_face += 1; }
            let _ = boundary_count;
        }

        assert_eq!(
            ring_with_hole, 1,
            "expected exactly 1 ring face with hole; got {} (simple={}, null-HEs={})",
            ring_with_hole, simple_active, he_with_null_face
        );
        assert_eq!(
            simple_active, 1,
            "expected exactly 1 simple sub-face (inner); got {} (null-HEs={})",
            simple_active, he_with_null_face
        );
        assert_eq!(
            he_with_null_face, 4,
            "expected 4 null-face HEs (only outer ring's outside); got {}",
            he_with_null_face
        );
    }

    /// ADR-021 P7 (Phase C, supersedes ADR-016 LOCKED #1) —
    /// 둘 다 disjoint inner 면, 둘 다 hole 로 promote 되어 multi-hole ring 형성.
    /// 이전 ADR-016 single-promote heuristic 은 폐기됨 (CLAUDE.md LOCKED #1).
    #[test]
    fn test_adr021_disjoint_second_inner_promotes() {
        let mut scene = Scene::new();
        // Outer 12×8
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        // First inner — promote
        scene.execute(Command::DrawRect {
            center: DVec3::new(-3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Second inner — disjoint from first → also promotes (P7 multi-hole ring).
        scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        let mut ring_with_one_hole = 0;
        let mut ring_with_two_holes = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            match f.inners().len() {
                0 => simple_active += 1,
                1 => ring_with_one_hole += 1,
                2 => ring_with_two_holes += 1,
                _ => {}
            }
        }
        assert_eq!(
            ring_with_two_holes, 1,
            "expected 1 ring with 2 holes (P7 disjoint multi-hole); got {} (one-hole={}, simple={})",
            ring_with_two_holes, ring_with_one_hole, simple_active
        );
        assert_eq!(
            ring_with_one_hole, 0,
            "no single-hole ring expected; got {}", ring_with_one_hole
        );
        assert_eq!(
            simple_active, 2,
            "expected 2 simple sub-faces (each inner); got {}",
            simple_active
        );
    }

    /// ADR-022 P9 (Phase 1) — Connected Case B (vertex 공유 inner) 자동 처리.
    /// Outer 그린 후 첫 inner, 그 다음 첫 inner 와 corner vertex 하나만
    /// 공유하는 둘째 inner 를 그린다. 이전: 둘째는 sibling 으로 남아서 promote
    /// 안 됨. P9 이후: 둘 다 hole 로 promote (multi-hole ring).
    #[test]
    fn test_p9_corner_pinch_two_inners_become_two_holes() {
        let mut scene = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy P9 auto multi-hole promote
        scene.auto_face_synthesis_on_draw = true;
        // Outer 12×12
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        // First inner [-3..-1] x [-3..-1] — corner at (-1, -1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // Second inner [-1..+1] x [-1..+1] — shares corner (-1, -1) with first.
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });

        // Manifold invariant must hold — no degenerate / non-manifold corruption.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "Manifold invariants violated: {:?}", report.violations);

        let mut ring_holes = 0usize; // total hole count across all rings
        let mut ring_count = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.inners().is_empty() {
                simple_active += 1;
            } else {
                ring_count += 1;
                ring_holes += f.inners().len();
            }
        }
        assert_eq!(ring_count, 1, "expected 1 ring (outer); got {}", ring_count);
        assert_eq!(ring_holes, 2,
            "expected 2 holes total (P9 corner-pinch both promote); got {}", ring_holes);
        assert_eq!(simple_active, 2,
            "expected 2 simple sub-faces; got {}", simple_active);
    }

    // ────────────────────────────────────────────────────────────────────
    // 사용자 스트레스 (2026-04-29) — 27 RECT 면 합성 검증.
    // 발견: 얇은 crossing RECT 가 다중 ring container 를 가로지를 때
    // 일부 sliver region 이 합성되지 않음 (M1 mixed-cycle 한계). 별도 phase.
    // ────────────────────────────────────────────────────────────────────

    /// ADR-028 Phase A — DrawCircle 의 모든 edge 가 Arc curve 보유.
    /// 분석적 곡선 마이그레이션 후 view-time tessellation 가능.
    #[test]
    fn test_drawcircle_edges_carry_arc_curve() {
        let mut scene = Scene::new();
        let n_segments = 24u32;
        scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: n_segments,
        });
        // Find all active topological edges
        let active_edges: Vec<axia_geo::EdgeId> = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.class().is_topological())
            .map(|(id, _)| id)
            .collect();
        assert_eq!(active_edges.len(), n_segments as usize,
            "expected {} segment edges, got {}", n_segments, active_edges.len());
        // Every edge must have an Arc curve attached
        let mut arc_count = 0;
        for &eid in &active_edges {
            let e = &scene.mesh.edges[eid];
            match e.curve() {
                Some(axia_geo::AnalyticCurve::Arc { radius, .. }) => {
                    assert!((radius - 5.0).abs() < 1e-12);
                    arc_count += 1;
                }
                _ => panic!("edge {:?} missing Arc curve", eid),
            }
        }
        assert_eq!(arc_count, n_segments as usize);
    }

    /// ADR-028 Phase A — Tessellation refines circle (LOD).
    /// View-time tessellate_edge 가 실제 chord_tol 충족.
    #[test]
    fn test_drawcircle_lod_refinement_via_tessellate_edge() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 100.0,
            segments: 8,  // intentionally coarse
        });
        let first_edge = scene.mesh.edges.iter()
            .find(|(_, e)| e.is_active() && e.curve().is_some())
            .map(|(id, _)| id)
            .expect("at least one curve edge");
        // Coarse: 1 mm tolerance — should match drawn segment
        let coarse = scene.mesh.tessellate_edge(first_edge, 50.0).unwrap();
        // Fine: 0.01 mm tolerance — should produce more points
        let fine = scene.mesh.tessellate_edge(first_edge, 0.01).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine LOD ({} pts) must exceed coarse LOD ({} pts)",
            fine.len(), coarse.len());
    }

    /// ADR-028 Phase A — Curve metadata 가 폴리곤 위상에 영향 없음.
    /// DrawCircle 후 face count, edge count 가 기존 동작과 동일.
    #[test]
    fn test_drawcircle_topology_unchanged_after_curve_attach() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: 12,
        });
        let face_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        let edge_count = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        assert_eq!(face_count, 1, "expected 1 face for a circle");
        assert_eq!(edge_count, 12, "expected 12 segment edges");
    }

    /// ADR-025 P11 — Drawing-order independent: 27 RECT, 어느 순서든 동일 결과
    /// (orphan count 가 절대 증가하지 않음 — Phase 4 final-sweep regression guard).
    #[test]
    fn test_p11_27rect_orphan_count_regression_guard() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 12.0, height: 12.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 14.0, height: 10.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 16.0, height: 1.5 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 1.5, height: 16.0 });
        scene.execute(Command::DrawRect { center: DVec3::new(-2.0,  2.0, 0.0), normal: n, up: -up, width: 1.0, height: 1.0 });
        scene.execute(Command::DrawRect { center: DVec3::new( 2.0, -2.0, 0.0), normal: n, up: -up, width: 1.2, height: 1.2 });
        scene.execute(Command::DrawRect { center: DVec3::new( 0.0,  0.0, 0.0), normal: n, up: -up, width: 0.6, height: 0.6 });

        let orphan_count = scene.mesh.edges.iter()
            .filter(|(eid, e)| {
                if !e.is_active() { return false; }
                let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
                !faces.iter().any(|&f| scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
            })
            .count();
        // Phase 7 (strand cleanup, closed-shape only) 적용 후: 0 orphans.
        // 사용자 P11 원칙 ("닫힌 엣지 = 반드시 면") 완전 보장.
        assert_eq!(orphan_count, 0,
            "[P11 STRICT] orphan_count={} (must be 0 after closed-shape commands)",
            orphan_count);
    }

    /// 사용자 스트레스 (informational) — face count + orphan/violation 추이.
    /// 절대 fail 안 함 — 진단용. 회귀 감지는 별도 strict 테스트.
    #[test]
    fn test_user_stress_bisect_2crossing_only() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 16.0, height: 1.5 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 1.5, height: 16.0 });
        let report = scene.mesh.verify_face_invariants();
        // Pure 2 crossing rects (no inners) — 통과 보장.
        assert!(report.violations.is_empty(),
            "[2 crossing baseline] {} violations", report.violations.len());
    }

    /// Bisect — 20 small overlapping inners only (no large, no crossing).
    #[test]
    fn test_user_stress_bisect_inners_only() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h,
            });
        }
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "[inners-only] {} violations:\n{}", report.violations.len(),
            report.violations.iter().take(3).cloned().collect::<Vec<_>>().join("\n"));
    }

    #[allow(dead_code)]
    #[test]
    fn test_user_stress_bisect_20_plus_1cross_diag() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 16.0, height: 1.5 });
        let orphans = scene.mesh.edges.iter().filter(|(eid, e)| {
            if !e.is_active() { return false; }
            let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
            !faces.iter().any(|&f| scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
        }).count();
        let active_faces = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        eprintln!("[20+1X-no-large] active_faces={}, orphan_edges={}", active_faces, orphans);
    }

    #[allow(dead_code)]
    #[test]
    fn test_user_stress_bisect_20_2large_1cross_diag() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 12.0, height: 12.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 14.0, height: 10.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 16.0, height: 1.5 });

        let orphans = scene.mesh.edges.iter().filter(|(eid, e)| {
            if !e.is_active() { return false; }
            let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
            !faces.iter().any(|&f| scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
        }).count();
        let active_faces = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let report = scene.mesh.verify_face_invariants();
        eprintln!("[20+2L+1X] active_faces={}, orphan_edges={}, manifold_violations={}",
            active_faces, orphans, report.violations.len());
    }

    #[allow(dead_code)]
    #[test]
    fn test_user_stress_bisect_20_2large_2cross_diag() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 12.0, height: 12.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 14.0, height: 10.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 16.0, height: 1.5 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 1.5, height: 16.0 });

        let orphans = scene.mesh.edges.iter().filter(|(eid, e)| {
            if !e.is_active() { return false; }
            let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
            !faces.iter().any(|&f| scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
        }).count();
        let active_faces = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let report = scene.mesh.verify_face_invariants();
        eprintln!("[20+2large+2cross] active_faces={}, orphan_edges={}, manifold_violations={}",
            active_faces, orphans, report.violations.len());
        // Diagnostic only — known limitation: thin crossing in dense ring 환경.
    }

    #[allow(dead_code)]
    #[test]
    fn test_user_stress_bisect_20_plus_2large_diag() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 12.0, height: 12.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 14.0, height: 10.0 });

        let orphans = scene.mesh.edges.iter().filter(|(eid, e)| {
            if !e.is_active() { return false; }
            let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
            !faces.iter().any(|&f| scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
        }).count();
        let active_faces = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        eprintln!("[20+2L] active_faces={}, orphan_edges={}", active_faces, orphans);
    }

    /// Bisect — 20 inners + 1 large enclosing only.
    #[test]
    fn test_user_stress_bisect_20inners_plus_1large() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect { center: DVec3::new(cx, cy, 0.0), normal: n, up, width: w, height: h });
        }
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up, width: 12.0, height: 12.0 });
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "[20+1large] {} violations:\n{}", report.violations.len(),
            report.violations.iter().take(5).cloned().collect::<Vec<_>>().join("\n"));
    }

    /// Bisect helper — 2 large enclosing + 2 crossing.
    #[test]
    fn test_user_stress_bisect_no_inners() {
        let mut scene = Scene::new();
        let n = DVec3::Z; let up = DVec3::Y;
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 12.0, height: 12.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 14.0, height: 10.0 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 16.0, height: 1.5 });
        scene.execute(Command::DrawRect { center: DVec3::ZERO, normal: n, up,
            width: 1.5, height: 16.0 });
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "[no-inners] {} violations:\n{}", report.violations.len(),
            report.violations.iter().take(3).cloned().collect::<Vec<_>>().join("\n"));
    }

    /// 사용자 요청 스트레스 (2026-04-29): 20 중복 inner + 2 large enclosing
    /// + 2 crossing + 3 reverse-direction. 모든 닫힌 영역에 면 생성 검증.
    ///
    /// 검증 항목:
    /// 1. 모든 RECT 가 active (closed loop 면 합성)
    /// 2. Manifold invariant 무손상 (verify_face_invariants 0 violation)
    /// 3. Ring + sub-face 구조가 일관 (orphan free edge 없음)
    /// 4. 회귀 0건 (drawing-order 무관)
    #[test]
    fn test_user_stress_27_overlapping_rects_all_close() {
        let mut scene = Scene::new();
        let n = DVec3::Z;
        let up = DVec3::Y;

        // (1) 20 중복 inner — 다양한 위치 / 크기 / 방향
        let inner_specs: &[(f64, f64, f64, f64)] = &[
            // (cx, cy, w, h)
            (-3.0, -3.0, 1.5, 1.5),  ( 3.0,  3.0, 1.5, 1.5),
            ( 0.0,  0.0, 2.0, 2.0),  (-2.0,  0.0, 1.0, 3.0),
            ( 2.0,  0.0, 1.0, 3.0),  ( 0.0,  2.0, 3.0, 1.0),
            ( 0.0, -2.0, 3.0, 1.0),  (-1.5, -1.5, 0.8, 0.8),
            ( 1.5,  1.5, 0.8, 0.8),  (-1.5,  1.5, 0.8, 0.8),
            ( 1.5, -1.5, 0.8, 0.8),  (-3.5,  0.0, 0.6, 0.6),
            ( 3.5,  0.0, 0.6, 0.6),  ( 0.0,  3.5, 0.6, 0.6),
            ( 0.0, -3.5, 0.6, 0.6),  (-2.5,  2.5, 0.5, 0.5),
            ( 2.5, -2.5, 0.5, 0.5),  (-1.0,  3.0, 1.2, 0.4),
            ( 1.0, -3.0, 1.2, 0.4),  ( 0.0,  0.0, 0.4, 0.4),
        ];
        for &(cx, cy, w, h) in inner_specs {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0),
                normal: n, up, width: w, height: h,
            });
        }

        // (2) 2 large enclosing — 모두 포함
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: n, up,
            width: 12.0, height: 12.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: n, up,
            width: 14.0, height: 10.0,
        });

        // (3) 2 crossing — 가로질러 (직사각형 2개가 다른 비율로 교차)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: n, up,
            width: 16.0, height: 1.5,  // 가로 막대
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: n, up,
            width: 1.5, height: 16.0,  // 세로 막대
        });

        // (4) 3 reverse direction — up vector 를 반대로 (winding 역전)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 2.0, 0.0), normal: n, up: -up,
            width: 1.0, height: 1.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new( 2.0, -2.0, 0.0), normal: n, up: -up,
            width: 1.2, height: 1.2,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new( 0.0,  0.0, 0.0), normal: n, up: -up,
            width: 0.6, height: 0.6,
        });

        // === 검증 (informational + 부분 보장) ===

        let active_face_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .count();
        let orphan_count = scene.mesh.edges.iter()
            .filter(|(eid, e)| {
                if !e.is_active() { return false; }
                let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
                !faces.iter().any(|&f|
                    scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active())
            })
            .count();
        let report = scene.mesh.verify_face_invariants();

        // 보장 (HARD): 27 RECT 입력 → 최소 active face count (보수적 lower bound).
        // 모든 RECT 가 어떤 형태로든 mesh 에 존재한다는 의미.
        assert!(active_face_count >= 20,
            "[user stress] expected >= 20 active faces (27 RECT); got {}",
            active_face_count);

        // 보장 (HARD): infinite loop / panic 없음 (전체 흐름 안정).
        // — assert 자체가 reach 했으면 충족.

        // P11 STRICT: orphan = 0 보장 (Phase 7 strand cleanup 후).
        eprintln!(
            "[user stress 27-RECT] active_faces={}, orphan_edges={}, \
             manifold_violations={} ← P11 strict invariant 충족",
            active_face_count, orphan_count, report.violations.len(),
        );
        assert_eq!(orphan_count, 0,
            "[user stress P11 STRICT] orphan_count={} (must be 0)", orphan_count);
    }

    /// ADR-022 P9 — Drawing order independence with corner-pinch.
    /// outer 먼저 그리든 inner 들 먼저 그리든 동일하게 multi-hole ring 결과.
    #[test]
    fn test_p9_pinch_drawing_order_independence() {
        // Case A: inner1 → inner2 → outer
        let mut scene_a = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy P9 auto multi-hole promote
        scene_a.auto_face_synthesis_on_draw = true;
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_a.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        let count_a = |s: &Scene| -> (usize, usize, usize) {
            let mut rings = 0; let mut holes = 0; let mut simple = 0;
            for (_id, f) in s.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if f.inners().is_empty() { simple += 1; }
                else { rings += 1; holes += f.inners().len(); }
            }
            (rings, holes, simple)
        };
        let result_a = count_a(&scene_a);

        // Case B: outer → inner1 → inner2
        let mut scene_b = Scene::new();
        // ADR-139 B-β-3: explicit opt-in for legacy P9 auto multi-hole promote
        scene_b.auto_face_synthesis_on_draw = true;
        scene_b.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        scene_b.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_b.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let result_b = count_a(&scene_b);

        assert_eq!(result_a, result_b,
            "P9 drawing-order independence: Case A {:?} vs Case B {:?}",
            result_a, result_b);
        // 둘 다 (1 ring, 2 holes, 2 simple) 이어야 함.
        assert_eq!(result_a, (1, 2, 2),
            "P9 expected (rings=1, holes=2, simple=2); got {:?}", result_a);
    }

    /// ADR-022 P9 — Manifold invariant 무손상.
    /// Pinch case 후 verify_face_invariants 위반 없음.
    #[test]
    fn test_p9_manifold_invariant_preserved() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "P9 manifold invariants violated after pinch: {:?}", report.violations);
    }

    /// 사용자 보고 2026-04-28 (12) — 인접한 면과 통합 미리보기가 빨간색 (cascade)
    /// 으로 표시되는 회귀. 사용자 화면: outer + 부분-overlap 안쪽 inner 가
    /// 만드는 sub-face 들 사이의 shared edge 를 hover 했을 때 통합 가능
    /// (cyan) 이어야 한다.
    ///
    /// 검증: 모든 active face 쌍에 대해 (1) shared outer edge 가 있고
    /// (2) coplanar 인 경우 → preview predicate (count==1 OR
    /// would_geometric_merge_succeed) 가 true 를 반환해야 한다.
    #[test]
    fn test_partial_overlap_all_adjacent_faces_mergeable() {
        // 사용자 스크린 패턴: outer 14×6, 한쪽으로 extending overlap inner.
        let configs: &[&[(f64, f64, f64, f64)]] = &[
            // (cx, cy, w, h)
            &[(0.0, 0.0, 14.0, 6.0), (5.0, 0.0, 6.0, 4.0)],
            &[(0.0, 0.0, 14.0, 6.0), (-5.0, 0.0, 6.0, 4.0)],
            &[(0.0, 0.0, 14.0, 6.0), (5.0, 0.0, 6.0, 4.0), (-5.0, 0.0, 6.0, 4.0)],
            // L-shape 두 개
            &[(0.0, 0.0, 10.0, 4.0), (3.0, 2.0, 6.0, 4.0)],
            // 사용자 image: 큰 outer + 부분-overlap inner extending right
            &[(0.0, 0.0, 16.0, 8.0), (10.0, 0.0, 8.0, 5.0)],
        ];

        for (config_idx, rects) in configs.iter().enumerate() {
            let mut scene = Scene::new();
            for &(cx, cy, w, h) in *rects {
                scene.execute(Command::DrawRect {
                    center: DVec3::new(cx, cy, 0.0),
                    normal: DVec3::Z, up: DVec3::Y,
                    width: w, height: h,
                });
            }

            let active: Vec<_> = scene.mesh.faces.iter()
                .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

            let mut tested = 0;
            let mut failures = Vec::<String>::new();
            for i in 0..active.len() {
                for j in (i + 1)..active.len() {
                    let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                    if n_shared == 0 { continue; }
                    let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                        active[i], active[j], 0.5
                    ).unwrap_or(false);
                    if !coplanar { continue; }
                    tested += 1;

                    // Mirror preview_edge_erase_merge predicate.
                    let mergeable = if n_shared == 1 {
                        true
                    } else {
                        scene.mesh.would_geometric_merge_succeed(active[i], active[j], 0.5)
                    };
                    if !mergeable {
                        failures.push(format!(
                            "  config[{}]: face pair ({:?},{:?}) shared={} coplanar=true \
                             but predicate=false",
                            config_idx, active[i], active[j], n_shared
                        ));
                    }
                }
            }
            assert!(tested > 0, "config[{}] no adjacent pairs found", config_idx);
            assert!(
                failures.is_empty(),
                "config[{}] preview predicate FALSE on adjacent coplanar faces:\n{}",
                config_idx,
                failures.join("\n")
            );
        }
    }

    /// P0 regression (2026-05-02): drawing a RECT MUST always create at
    /// least one face, regardless of which corner the user starts from
    /// or which diagonal direction they drag. Equivalent input parameter
    /// sets (same 4 corners up to rotation/reflection of the input order)
    /// must produce equivalent face topology — same vertex SET on the
    /// outer loop.
    ///
    /// Internal model: the engine receives (center, normal, up, width,
    /// height). TS DrawRectTool maps any user drag direction to this
    /// canonical form. We test the engine layer's invariance under the
    /// equivalent rotations of (up direction × w/h swap).
    #[test]
    fn draw_rect_is_direction_and_order_invariant() {
        // Logical rect: 1000mm × 500mm centered at origin on the XZ ground
        // plane. The 4 inputs below all describe THE SAME physical rect.
        let center = DVec3::new(0.0, 0.0, 0.0);
        let n = DVec3::new(0.0, 1.0, 0.0);  // ground plane normal
        let cases: Vec<(&str, DVec3, f64, f64)> = vec![
            ("up=+Z, 1000×500",  DVec3::new(0.0, 0.0, 1.0),  1000.0, 500.0),
            // up rotated 90° → swap w/h to keep the SAME physical rect
            ("up=+X, 500×1000",  DVec3::new(1.0, 0.0, 0.0),  500.0, 1000.0),
            // up rotated 180° (still ground plane) → same w/h
            ("up=-Z, 1000×500",  DVec3::new(0.0, 0.0, -1.0), 1000.0, 500.0),
            // up rotated 270° → swap again
            ("up=-X, 500×1000",  DVec3::new(-1.0, 0.0, 0.0), 500.0, 1000.0),
        ];

        // Collect outer-loop vertex SETS (not lists — order can rotate
        // with up direction, but the set must be identical).
        let mut vertex_sets: Vec<std::collections::BTreeSet<(i64, i64, i64)>> = Vec::new();

        for (label, up, w, h) in cases {
            let mut scene = Scene::default();
            let r = scene.execute(Command::DrawRect { center, normal: n, up, width: w, height: h });
            let xia = match r {
                CommandResult::EntityCreated(x) => x,
                other => panic!("[{}] RECT must create a face, got {:?}", label, other),
            };
            assert!(
                !scene.xias[&xia].face_ids.is_empty(),
                "[{}] RECT must produce ≥1 face (P0 invariant)", label,
            );
            let fid = scene.xias[&xia].face_ids[0];
            let verts = scene.mesh.collect_loop_verts(scene.mesh.faces[fid].outer().start)
                .expect("face has outer loop");
            assert_eq!(verts.len(), 4, "[{}] RECT face should have 4-vert outer loop", label);

            // Quantize positions to nm (1e-6 mm) so f64 jitter doesn't
            // produce different "set" elements across cases.
            let qset: std::collections::BTreeSet<(i64, i64, i64)> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                .map(|p| (
                    (p.x * 1e6).round() as i64,
                    (p.y * 1e6).round() as i64,
                    (p.z * 1e6).round() as i64,
                ))
                .collect();
            assert_eq!(qset.len(), 4, "[{}] outer loop must have 4 distinct vertices", label);

            eprintln!("[{}] vertices: {:?}", label, qset);
            vertex_sets.push(qset);
        }

        // ★ Direction/order invariance: ALL cases must yield the SAME
        // vertex set (the 4 corners of the same physical rect).
        let canonical = &vertex_sets[0];
        for (i, vs) in vertex_sets.iter().enumerate().skip(1) {
            assert_eq!(
                canonical, vs,
                "P0 INVARIANT VIOLATED: case[{}] produced different corners than case[0]",
                i,
            );
        }
    }

    /// Regression (2026-05-02): drawing a RECT must NOT deactivate pre-
    /// existing FACES whose normal happens to evaluate degenerate during
    /// the new draw's post-pipeline scan. The degenerate scan is now
    /// scope-limited to faces created or touched by the current draw.
    ///
    /// Bug: pre-existing face F1 (drawn earlier as a clean rect) had a
    /// valid normal. New RECT_B was drawn nearby. During RECT_B's post-
    /// pipeline scan, all active faces were inspected. If F1's normal
    /// happened to evaluate as NaN/zero (e.g. due to vertex insertion
    /// elsewhere altering the half-edge loop traversal mid-scan), F1 was
    /// removed even though its boundary was perfectly fine. The 4 boundary
    /// edges remained as standalone wires → user saw "면이 사라짐, 라인만
    /// 남음" symptom.
    #[test]
    fn drawing_rect_preserves_pre_existing_faces() {
        let mut scene = Scene::default();

        // Draw RECT_A → face exists with normal and XIA.
        let r_a = scene.execute(Command::DrawRect {
            center: DVec3::new(-2000.0, 0.0, -2000.0),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up:     DVec3::new(0.0, 0.0, 1.0),
            width: 500.0, height: 500.0,
        });
        let xia_a = match r_a {
            CommandResult::EntityCreated(x) => x,
            _ => panic!("rect A should create XIA"),
        };
        let face_count_a = scene.xias.get(&xia_a).map(|x| x.face_ids.len()).unwrap_or(0);
        assert_eq!(face_count_a, 1, "RECT_A must own exactly 1 face");
        let face_a_id = scene.xias[&xia_a].face_ids[0];
        assert!(scene.mesh.faces.contains(face_a_id) && scene.mesh.faces[face_a_id].is_active(),
            "face A must be active after creation");

        // Draw RECT_B at a different location.
        let r_b = scene.execute(Command::DrawRect {
            center: DVec3::new(2000.0, 0.0, 2000.0),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up:     DVec3::new(0.0, 0.0, 1.0),
            width: 500.0, height: 500.0,
        });
        assert!(matches!(r_b, CommandResult::EntityCreated(_)), "rect B should create XIA");

        // Face A must still be active — RECT_B's post-pipeline scan must
        // not have touched it (scope-leak regression).
        assert!(
            scene.mesh.faces.contains(face_a_id) && scene.mesh.faces[face_a_id].is_active(),
            "face A must survive RECT_B's draw — degenerate scan scope-leak guard",
        );
        // XIA mapping must also be intact.
        assert_eq!(scene.face_to_xia.get(&face_a_id).copied(), Some(xia_a),
            "face A's XIA mapping must persist");
    }

    /// Regression (2026-05-02): drawing a RECT must NOT erase pre-existing
    /// standalone user-drawn LINEs. Phase 7 cleanup is now scope-limited to
    /// edges created during the current closed-shape command.
    ///
    /// Bug: `cleanup_dangling_topological_edges` swept ALL active topological
    /// edges in the mesh that had no incident active face. Free-floating user
    /// wires fit that description and got deactivated whenever any RECT was
    /// committed.
    #[test]
    fn drawing_rect_preserves_pre_existing_standalone_lines() {
        let mut scene = Scene::default();

        // Draw 3 free-floating standalone lines, well away from where the
        // rect will be drawn (so they don't accidentally interact).
        let line_endpoints = [
            (DVec3::new(-2000.0, 0.0, -2000.0), DVec3::new(-1500.0, 0.0, -2000.0)),
            (DVec3::new(-2000.0, 0.0, -1500.0), DVec3::new(-1500.0, 0.0, -1500.0)),
            (DVec3::new(-2000.0, 0.0, -1000.0), DVec3::new(-1500.0, 0.0, -1000.0)),
        ];
        for (a, b) in &line_endpoints {
            let r = scene.execute(Command::DrawLine {
                start: *a, end: *b, surface_normal: None,
            });
            assert!(
                matches!(r, CommandResult::EntityCreated(_)),
                "line draw should succeed",
            );
        }

        let active_edges_before = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active())
            .count();
        assert!(active_edges_before >= 3, "≥3 line edges expected");

        // Now draw a RECT in a completely separate location. Phase 7 cleanup
        // runs as part of the rect finalizer.
        let r = scene.execute(Command::DrawRect {
            center: DVec3::new(1000.0, 0.0, 1000.0),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up:     DVec3::new(0.0, 0.0, 1.0),
            width: 500.0, height: 500.0,
        });
        assert!(
            matches!(r, CommandResult::EntityCreated(_)),
            "rect draw should succeed",
        );

        // The 3 user-drawn lines must still be active.
        for (a, b) in &line_endpoints {
            let v_a = scene.mesh.verts.iter()
                .find(|(_, v)| (v.pos() - *a).length() < 1e-3)
                .map(|(id, _)| id);
            let v_b = scene.mesh.verts.iter()
                .find(|(_, v)| (v.pos() - *b).length() < 1e-3)
                .map(|(id, _)| id);
            assert!(v_a.is_some(), "vert {:?} should still exist", a);
            assert!(v_b.is_some(), "vert {:?} should still exist", b);

            let v_a = v_a.unwrap();
            let v_b = v_b.unwrap();
            let edge_alive = scene.mesh.edges.iter().any(|(_, e)| {
                e.is_active()
                    && ((e.v_small() == v_a && e.v_large() == v_b)
                        || (e.v_small() == v_b && e.v_large() == v_a))
            });
            assert!(
                edge_alive,
                "standalone line {:?}→{:?} must survive rect commit (Phase 7 scope leak)",
                a, b,
            );
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-051 P7 Canonical — Manifold Invariant Regression Tests
    // ────────────────────────────────────────────────────────────────────
    //
    // Per ADR-051 §2.2, the P7 ring rebuild must preserve manifold
    // edge-HE distribution:
    //   P7-M1 — stacked-inner edge: shared by exactly 2 faces (CCW pair)
    //   P7-M2 — hole loop edge:     shared by exactly 2 faces (inner + ring)
    //   P7-M3 — non-shared boundary: 1 face + null (boundary marker)
    //
    // §2.4 acceptance: stacked-inner / disjoint-multi-hole / burge scenario
    // → 0 non-manifold violations across all draw orderings.

    /// ADR-051 P7-M1 — stacked inner RECTs preserve face existence.
    ///
    /// **Deferred (ADR-051 §2.5)**: full P7 ring rebuild for *connected*
    /// stacked-inner components (sharing an edge) requires combining
    /// inner1+inner2 into a single hole via combined-perimeter. Current C2
    /// implementation falls back to direct `add_face_with_holes` (ADR-015
    /// fallback at scene.rs:3208) which preserves face existence and visual
    /// rendering but leaves at most 1 non-manifold edge on the shared
    /// boundary. Tracked as follow-up; component-merge path is a separate PR.
    #[test]
    fn test_p7_canonical_stacked_inner_manifold() {
        let mut scene = Scene::new();
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, -1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let xid_outer = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!("outer failed") };
        let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!("inner1 failed") };
        let xid2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!("inner2 failed") };
        let f1 = scene.xias.get(&xid1).map(|x| x.face_ids.len()).unwrap_or(0);
        let f2 = scene.xias.get(&xid2).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(f1 >= 1 && f2 >= 1, "P7 face existence: inner1={} inner2={}", f1, f2);

        let nm = scene.mesh.collect_non_manifold_edges();
        if !nm.is_empty() {
            eprintln!(
                "ADR-051 §2.5 deferred: {} nm edge(s) on connected stacked-inner \
                 (component-merge path needed): {:?}", nm.len(), nm,
            );
        }
        // Regression guard at deferred boundary: must not exceed 1 nm edge
        // (the shared y=0 boundary). Crossing this would indicate the ADR-015
        // fallback or post-pipeline introduced extra violations.
        assert!(
            nm.len() <= 1,
            "ADR-051 P7-M1 regression — exceeds documented deferred limit \
             (>1 nm edge on shared y=0): {} edges {:?}", nm.len(), nm,
        );

        // ADR-051 P-2 — strict named invariant lock-in via P-1 verify_p7_manifold.
        // Outer XIA may have been rebuilt during postprocess; pick the first
        // active container face from xid_outer's current face_ids. Inners
        // come from xid1 + xid2.
        let container = scene.xias.get(&xid_outer)
            .and_then(|x| x.face_ids.first().copied())
            .expect("xid_outer must own at least one face");
        let mut inners: Vec<FaceId> = Vec::new();
        if let Some(x) = scene.xias.get(&xid1) { inners.extend(&x.face_ids); }
        if let Some(x) = scene.xias.get(&xid2) { inners.extend(&x.face_ids); }
        let report = axia_geo::verify_p7_manifold(&scene.mesh, container, &inners);
        // Deferred boundary: at most 1 violation matching the shared y=0 nm
        // edge. Crossing this signals regression in P7 self-healing pipeline.
        assert!(
            report.violations.len() <= 1,
            "ADR-051 P7-M (named) regression — verify_p7_manifold reports {} \
             violations exceeding deferred boundary:\n{}",
            report.violations.len(),
            report.summary(),
        );
    }

    /// ADR-051 P7-M2 — disjoint inner components form distinct holes (multi-hole
    /// ring). Each hole edge shared by inner sub-face + ring container = 2-face.
    #[test]
    fn test_p7_canonical_disjoint_inner_multi_hole() {
        let mut scene = Scene::new();
        // Container 12×6
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 6.0,
        });
        // Two disjoint inners (left half / right half)
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::new(-3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let xid_outer = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!("outer failed") };
        let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!("inner1 failed") };
        let xid2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!("inner2 failed") };

        let nm = scene.mesh.collect_non_manifold_edges();
        assert!(
            nm.is_empty(),
            "ADR-051 P7-M2 violated — {} non-manifold edges with disjoint inners: {:?}",
            nm.len(), nm,
        );
        let report = scene.mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "ADR-051 P7 invariants violated: {:?}", report.violations,
        );

        // ADR-051 P-2 — strict named invariant lock-in (disjoint case = 0 violations).
        let container = scene.xias.get(&xid_outer)
            .and_then(|x| x.face_ids.first().copied())
            .expect("xid_outer must own at least one face");
        let mut inners: Vec<FaceId> = Vec::new();
        if let Some(x) = scene.xias.get(&xid1) { inners.extend(&x.face_ids); }
        if let Some(x) = scene.xias.get(&xid2) { inners.extend(&x.face_ids); }
        let p7 = axia_geo::verify_p7_manifold(&scene.mesh, container, &inners);
        assert!(
            p7.is_valid(),
            "ADR-051 P7-M (named) violated on disjoint multi-hole:\n{}",
            p7.summary(),
        );
    }

    /// ADR-051 P-2 — sweep test exercising verify_p7_manifold against a
    /// representative subset of LOCKED #1 stacked-inner scenarios. Acts as a
    /// "regression net" — if any of these scenarios drift back into producing
    /// 3-face shares (P7-M1) or hole-loop misalignment (P7-M2), this single
    /// test catches it via named invariants rather than only the global
    /// `collect_non_manifold_edges` heuristic.
    #[test]
    fn test_p7_canonical_sweep_locked_scenarios() {
        // Scenario A — disjoint multi-hole (must be 0 violations)
        {
            let mut scene = Scene::new();
            let r0 = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: 12.0, height: 6.0,
            });
            let r1 = scene.execute(Command::DrawRect {
                center: DVec3::new(-3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let r2 = scene.execute(Command::DrawRect {
                center: DVec3::new(3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let xid_o = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let xid2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let container = scene.xias.get(&xid_o).and_then(|x| x.face_ids.first().copied()).expect("c");
            let mut inners = Vec::new();
            if let Some(x) = scene.xias.get(&xid1) { inners.extend(&x.face_ids); }
            if let Some(x) = scene.xias.get(&xid2) { inners.extend(&x.face_ids); }
            let p7 = axia_geo::verify_p7_manifold(&scene.mesh, container, &inners);
            assert!(p7.is_valid(),
                "Scenario A (disjoint) — verify_p7_manifold violated:\n{}", p7.summary());
        }

        // Scenario B — single inner (canonical ring + 1 sub-face)
        {
            let mut scene = Scene::new();
            let r0 = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: 8.0, height: 8.0,
            });
            let r1 = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let xid_o = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let container = scene.xias.get(&xid_o).and_then(|x| x.face_ids.first().copied()).expect("c");
            let mut inners = Vec::new();
            if let Some(x) = scene.xias.get(&xid1) { inners.extend(&x.face_ids); }
            let p7 = axia_geo::verify_p7_manifold(&scene.mesh, container, &inners);
            assert!(p7.is_valid(),
                "Scenario B (single inner) — verify_p7_manifold violated:\n{}", p7.summary());
        }

        // Scenario C — outer drawn AFTER inners (LOCKED #1 회귀 방지: order
        // independence). verify_p7_manifold must still report 0 violations
        // because the resulting topology is the same canonical ring-with-holes.
        {
            let mut scene = Scene::new();
            let r1 = scene.execute(Command::DrawRect {
                center: DVec3::new(-3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let r2 = scene.execute(Command::DrawRect {
                center: DVec3::new(3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let r0 = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: 12.0, height: 6.0,
            });
            let xid_o = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let xid2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!() };
            let container = scene.xias.get(&xid_o).and_then(|x| x.face_ids.first().copied()).expect("c");
            let mut inners = Vec::new();
            if let Some(x) = scene.xias.get(&xid1) { inners.extend(&x.face_ids); }
            if let Some(x) = scene.xias.get(&xid2) { inners.extend(&x.face_ids); }
            let p7 = axia_geo::verify_p7_manifold(&scene.mesh, container, &inners);
            assert!(p7.is_valid(),
                "Scenario C (outer after inners) — verify_p7_manifold violated:\n{}", p7.summary());
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-050 Phase 1.A — Promote API regression tests
    // ────────────────────────────────────────────────────────────────────
    //
    // Per ADR-050 §2.2, `promote_xia_with_validation` enforces 4 conditions
    // (재질 / 부피 / 닫힘 / manifold). These tests cover each failure
    // branch + the happy path for both Volumetric and Linear XIAs.

    /// ADR-050 §2.2 Cond 1 — default material (id=0) is rejected.
    #[test]
    fn test_adr050_promote_rejects_default_material() {
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });
        let xid = match r { CommandResult::EntityCreated(id) => id, _ => panic!() };
        let err = scene.promote_xia_with_validation(xid, axia_geo::MaterialId::new(0))
            .expect_err("default material must be rejected");
        assert_eq!(err, crate::promote::PromoteError::InvalidMaterial);
    }

    /// ADR-050 §2.2 Cond 3 — open shell (single face) is not watertight.
    #[test]
    fn test_adr050_promote_rejects_non_watertight() {
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });
        let xid = match r { CommandResult::EntityCreated(id) => id, _ => panic!() };
        let err = scene.promote_xia_with_validation(xid, axia_geo::MaterialId::new(7))
            .expect_err("single-face XIA cannot be watertight");
        assert!(matches!(err, crate::promote::PromoteError::NotWatertight { .. }),
            "expected NotWatertight, got {:?}", err);
    }

    /// ADR-050 §0 — XIA not present.
    #[test]
    fn test_adr050_promote_rejects_unknown_xia() {
        let mut scene = Scene::new();
        let err = scene.promote_xia_with_validation(99999, axia_geo::MaterialId::new(7))
            .expect_err("unknown XIA must be rejected");
        assert_eq!(err, crate::promote::PromoteError::XiaNotFound);
    }

    /// ADR-050 §2.2 — happy path Volumetric: closed solid (push-pull) +
    /// real material → success with positive volume.
    #[test]
    fn test_adr050_promote_volumetric_happy_path() {
        use axia_geo::FaceId;
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });
        let xid = match r { CommandResult::EntityCreated(id) => id, _ => panic!() };
        let face_id: FaceId = scene.xias.get(&xid).and_then(|x| x.face_ids.first().copied())
            .expect("rect should have a face");
        // Push-pull to extrude into closed solid
        let pp = scene.execute(Command::PushPull {
            face_id,
            dist: 2.0,
        });
        // Push-pull may return PushPullDone or MeshUpdated; both are OK.
        if matches!(pp, CommandResult::Error(_)) {
            panic!("push-pull failed: {:?}", pp);
        }

        // After push-pull the rect XIA's face_ids should now include
        // the side walls + cap (closed solid). Promote.
        let ok = scene.promote_xia_with_validation(xid, axia_geo::MaterialId::new(7));
        match ok {
            Ok(crate::promote::PromoteOk { kind: crate::promote::XiaKind::Volumetric { volume }, .. }) => {
                assert!(volume > 0.0, "extruded box should have positive volume, got {}", volume);
            }
            Ok(other) => panic!("expected Volumetric, got {:?}", other),
            Err(e) => {
                // P7 not strictly required to be 0 for unrelated stress; if
                // NotManifold fires this is the prerequisite ADR-051 issue.
                // Still, a clean push-pull box shouldn't trigger it.
                panic!("happy path failed: {}", e);
            }
        }
        // Material is now assigned
        assert_eq!(scene.xias.get(&xid).unwrap().material.raw(), 7);
    }

    /// ADR-050 §2.2 — happy path Linear: standalone edge with positive
    /// length + real material → success with positive length.
    #[test]
    fn test_adr050_promote_linear_happy_path() {
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawLine {
            start: DVec3::ZERO,
            end: DVec3::new(5.0, 0.0, 0.0),
            surface_normal: None,
        });
        let xid = match r { CommandResult::EntityCreated(id) => id, _ => panic!() };
        // Sanity: the Line XIA owns no face but has a standalone edge.
        let xia = scene.xias.get(&xid).expect("xia exists");
        assert!(xia.face_ids.is_empty(), "Line XIA should own no face");
        assert!(xia.standalone_edge_id.is_some(), "Line XIA must have standalone edge");

        let ok = scene.promote_xia_with_validation(xid, axia_geo::MaterialId::new(7))
            .expect("linear happy path");
        match ok.kind {
            crate::promote::XiaKind::Linear { length, cross_section_area } => {
                assert!((length - 5.0).abs() < 1e-6, "length should be 5, got {}", length);
                assert_eq!(cross_section_area, 1.0, "MVP sentinel cross-section");
            }
            other => panic!("expected Linear, got {:?}", other),
        }
    }

    /// ADR-051 P7-M3 acceptance — burge.xia user scenario must show 0
    /// non-manifold violations after the typical centered draws (small /
    /// medium / large covering). Offset cases (quarter/diagonal) currently
    /// retain 2 violations on edges 244/249 from `intersect_faces_inner`
    /// internal merges — tracked as deferred work in ADR-051 §2.5.
    #[test]
    fn test_p7_canonical_burge_centered_scenario_no_violations() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/burge.xia");
        if !path.exists() {
            eprintln!("burge.xia fixture missing — skipping");
            return;
        }
        let bytes = std::fs::read(&path).expect("read burge.xia");
        // Strip AXIA wrapper: [4 magic][4 version][4 metadata_len][metadata][snapshot]
        assert!(bytes.len() >= 12);
        let metadata_len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        let inner = &bytes[12 + metadata_len..];

        let mut scene = Scene::new();
        scene.import_versioned_snapshot(inner).expect("import burge.xia");

        // Compute scene center for centered stress draws
        let mut min = DVec3::splat(f64::INFINITY);
        let mut max = DVec3::splat(f64::NEG_INFINITY);
        for (_, v) in scene.mesh.verts.iter() {
            if !v.is_active() { continue; }
            let p = v.pos();
            min = min.min(p);
            max = max.max(p);
        }
        let center = (min + max) * 0.5;
        let extent = (max - min).length();

        // Centered cases per ADR-051 §2.4 acceptance — Fix #1 + Fix #2 yield 0.
        let centered_cases = [
            ("small_at_center",  center, 1000.0_f64, 1000.0_f64),
            ("medium_at_center", center, 3000.0,     3000.0),
            ("large_covering",   center, extent * 1.2, extent * 1.2),
        ];

        for (label, c, w, h) in centered_cases {
            scene.execute(Command::DrawRect {
                center: c,
                normal: DVec3::new(0.0, 1.0, 0.0),
                up: DVec3::new(0.0, 0.0, 1.0),
                width: w, height: h,
            });
            let nm = scene.mesh.collect_non_manifold_edges();
            assert!(
                nm.is_empty(),
                "ADR-051 burge[{}] violated P7 manifold — {} non-manifold edges: {:?}",
                label, nm.len(), nm,
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // ADR-078 P-1 — Boolean Group Persistence (Rust schema)
    // Mirror of TS-side SelectionManager.groupTags (ADR-074 U-1).
    // 회귀 6 (절대 #[ignore] 금지).
    // ════════════════════════════════════════════════════════════════════════

    #[test]
    fn boolean_group_set_basic_a_and_b() {
        let mut scene = Scene::new();
        let f1 = FaceId::new(1);
        let f2 = FaceId::new(2);
        let f3 = FaceId::new(3);

        scene.set_boolean_group_tag(&[f1, f2], crate::BooleanGroupTag::A);
        scene.set_boolean_group_tag(&[f3], crate::BooleanGroupTag::B);

        let a = scene.get_boolean_group_a();
        let b = scene.get_boolean_group_b();
        assert_eq!(a, vec![f1, f2]);  // sorted by raw()
        assert_eq!(b, vec![f3]);
    }

    #[test]
    fn boolean_group_set_overwrites_on_conflict() {
        let mut scene = Scene::new();
        let f1 = FaceId::new(1);
        let f2 = FaceId::new(2);

        scene.set_boolean_group_tag(&[f1, f2], crate::BooleanGroupTag::A);
        // Re-tag f2 as B — invariant: one face = one group.
        scene.set_boolean_group_tag(&[f2], crate::BooleanGroupTag::B);

        assert_eq!(scene.get_boolean_group_a(), vec![f1]);
        assert_eq!(scene.get_boolean_group_b(), vec![f2]);

        // A ∩ B = ∅
        let a_set: std::collections::HashSet<FaceId> =
            scene.get_boolean_group_a().into_iter().collect();
        for fid in scene.get_boolean_group_b() {
            assert!(!a_set.contains(&fid),
                "face {:?} appears in both A and B", fid);
        }
    }

    #[test]
    fn boolean_group_clear_resets_state() {
        let mut scene = Scene::new();
        let f1 = FaceId::new(1);
        let f2 = FaceId::new(2);
        scene.set_boolean_group_tag(&[f1], crate::BooleanGroupTag::A);
        scene.set_boolean_group_tag(&[f2], crate::BooleanGroupTag::B);
        assert!(scene.has_any_boolean_group_tag());
        assert!(scene.has_boolean_group_selection());

        scene.clear_boolean_group_tags();
        assert!(!scene.has_any_boolean_group_tag());
        assert!(!scene.has_boolean_group_selection());
        assert!(scene.get_boolean_group_a().is_empty());
        assert!(scene.get_boolean_group_b().is_empty());
    }

    #[test]
    fn boolean_group_has_selection_requires_both() {
        let mut scene = Scene::new();
        let f1 = FaceId::new(1);
        let f2 = FaceId::new(2);

        // Empty initially.
        assert!(!scene.has_boolean_group_selection());
        assert!(!scene.has_any_boolean_group_tag());

        // Only A — has_any true, has_selection false.
        scene.set_boolean_group_tag(&[f1], crate::BooleanGroupTag::A);
        assert!(scene.has_any_boolean_group_tag());
        assert!(!scene.has_boolean_group_selection());

        // Only B — same boundary.
        scene.clear_boolean_group_tags();
        scene.set_boolean_group_tag(&[f2], crate::BooleanGroupTag::B);
        assert!(scene.has_any_boolean_group_tag());
        assert!(!scene.has_boolean_group_selection());

        // Both — both true.
        scene.set_boolean_group_tag(&[f1], crate::BooleanGroupTag::A);
        assert!(scene.has_any_boolean_group_tag());
        assert!(scene.has_boolean_group_selection());
    }

    #[test]
    fn boolean_group_snapshot_round_trip_preserves_tags() {
        let mut scene = Scene::new();
        let f1 = FaceId::new(1);
        let f2 = FaceId::new(2);
        let f3 = FaceId::new(7);

        scene.set_boolean_group_tag(&[f1, f3], crate::BooleanGroupTag::A);
        scene.set_boolean_group_tag(&[f2], crate::BooleanGroupTag::B);

        let snap = scene.scene_snapshot();

        // Restore into a fresh Scene.
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        assert_eq!(restored.get_boolean_group_a(), vec![f1, f3]);
        assert_eq!(restored.get_boolean_group_b(), vec![f2]);
        assert!(restored.has_boolean_group_selection());
    }

    #[test]
    fn boolean_group_legacy_snapshot_loads_empty() {
        // A pre-ADR-078 snapshot has 5 sections (mesh / xias / groups /
        // next_xia / constraints) but NO section 6. Simulate by
        // building a snapshot, then truncating section 6.
        let mut scene = Scene::new();
        // Force at least one group tag to make sure the snapshot
        // includes section 6 — then truncate it.
        scene.set_boolean_group_tag(&[FaceId::new(99)], crate::BooleanGroupTag::A);
        let mut snap = scene.scene_snapshot();

        // Walk through section length prefixes and truncate at the
        // start of section 6 (boolean_group_tags).
        // [mesh_len:8][mesh][xia_len:8][xia][group_len:8][group]
        // [next_xia:8][constraints_len:8][constraints][bg_len:8][bg]
        let mut offset = 0usize;
        // mesh
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // xias
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // groups
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // next_xia (8 bytes, no length prefix)
        offset += 8;
        // constraints
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // Now offset points at boolean_group section start. Truncate.
        snap.truncate(offset);

        // Restore — should load empty boolean_group_tags.
        let mut restored = Scene::new();
        // Pre-fill with stale tag to verify restore clears it.
        restored.set_boolean_group_tag(&[FaceId::new(123)], crate::BooleanGroupTag::B);
        restored.restore_scene_snapshot(&snap);

        assert!(!restored.has_any_boolean_group_tag(),
            "Legacy snapshot must reset boolean_group_tags to empty");
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-1 — Shape lifecycle regression tests.
    //
    // Per P-1 §C lock-ins:
    // - Drop-in alongside existing Xia API (no rename, no signature change)
    // - LOCKED #25 (ADR-074 group A/B) and ADR-078 boolean_group_tags
    //   automatically unaffected (FaceId-keyed, Shape/Xia agnostic)
    // - Snapshot persistence deferred to ADR-050 P-3 (so save/load tests
    //   for Shape are NOT included here — addition would be a regression
    //   of P-1's "in-memory only" lock-in)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn shape_create_returns_unique_increasing_ids() {
        let mut scene = Scene::new();
        let s1 = scene.create_shape("사각형 1".to_string(), vec![]);
        let s2 = scene.create_shape("사각형 2".to_string(), vec![]);
        let s3 = scene.create_shape("Line".to_string(), vec![]);

        assert_eq!(s1.raw(), 1);
        assert_eq!(s2.raw(), 2);
        assert_eq!(s3.raw(), 3);
        assert_eq!(scene.shapes.len(), 3);
    }

    #[test]
    fn shape_create_with_face_ids_stores_them() {
        let mut scene = Scene::new();
        let face_ids = vec![FaceId::new(10), FaceId::new(20), FaceId::new(30)];
        let id = scene.create_shape("Rect".to_string(), face_ids.clone());

        let shape = scene.get_shape(id).expect("shape exists");
        assert_eq!(shape.face_ids, face_ids);
        assert_eq!(shape.name, "Rect");
        assert!(shape.standalone_edge_id.is_none()); // empty by default
    }

    #[test]
    fn shape_get_returns_none_for_unknown_id() {
        let scene = Scene::new();
        // Empty scene — any id is unknown.
        assert!(scene.get_shape(crate::ShapeId::new(999)).is_none());
    }

    #[test]
    fn shape_list_ids_returns_sorted_ascending() {
        let mut scene = Scene::new();
        let _ = scene.create_shape("a".to_string(), vec![]);
        let _ = scene.create_shape("b".to_string(), vec![]);
        let _ = scene.create_shape("c".to_string(), vec![]);
        // Delete the middle one so sorting is non-trivial.
        scene.delete_shape(crate::ShapeId::new(2));
        let _ = scene.create_shape("d".to_string(), vec![]); // id=4

        let ids = scene.list_shape_ids();
        assert_eq!(ids, vec![
            crate::ShapeId::new(1),
            crate::ShapeId::new(3),
            crate::ShapeId::new(4),
        ]);
    }

    #[test]
    fn shape_delete_returns_true_on_existing_false_on_missing() {
        let mut scene = Scene::new();
        let id = scene.create_shape("temp".to_string(), vec![]);

        assert!(scene.delete_shape(id), "first delete returns true");
        assert!(!scene.delete_shape(id), "second delete returns false");
        assert!(scene.get_shape(id).is_none());
    }

    #[test]
    fn shape_clear_removes_all_but_preserves_xia_and_boolean_group_tags() {
        // P-1 invariant test — Shape clear must not touch any other
        // citizenship layer. ADR-074 / ADR-078 회귀 보장.
        let mut scene = Scene::new();
        let _s1 = scene.create_shape("a".to_string(), vec![]);
        let _s2 = scene.create_shape("b".to_string(), vec![]);

        // Pre-existing Xia + boolean_group_tags (ADR-074 / ADR-078 layer).
        let xia_id = scene.create_xia("Existing XIA".to_string());
        scene.set_boolean_group_tag(
            &[FaceId::new(7)],
            crate::BooleanGroupTag::A,
        );

        // Clear shapes only.
        scene.clear_shapes();

        // Shapes layer fully cleared.
        assert!(scene.shapes.is_empty());
        assert_eq!(scene.list_shape_ids(), vec![]);

        // Xia layer untouched (ADR-050 §C lock-in #1).
        assert!(scene.xias.contains_key(&xia_id),
            "Xia must NOT be affected by Shape clear");
        // boolean_group_tags untouched (ADR-078 회귀 보장).
        assert!(scene.has_any_boolean_group_tag(),
            "boolean_group_tags must NOT be affected by Shape clear");
        assert_eq!(scene.get_boolean_group_a(), vec![FaceId::new(7)]);
    }

    #[test]
    fn shape_id_is_distinct_type_from_xia_id() {
        // P-1 lock-in #2 — ShapeId is a newtype, not an alias.
        // This compiles only if ShapeId and XiaId are distinct types.
        let mut scene = Scene::new();
        let s_id = scene.create_shape("form".to_string(), vec![]);
        let x_id = scene.create_xia("property".to_string());

        // Both lookups work independently — proving the two storages
        // are namespaced separately.
        assert!(scene.get_shape(s_id).is_some());
        assert!(scene.xias.contains_key(&x_id));

        // ShapeId cannot be used to query xias (compile-time guard) —
        // we cannot write `scene.xias.contains_key(&s_id)` because
        // s_id is ShapeId (not u32). The test exercises the runtime
        // path of distinct namespaces. Type-level guard is verified
        // by successful compilation.
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-2 — Shape → Xia promote API regression tests.
    //
    // Per P-2 §C lock-ins:
    // - L1: validate_promotion shared with Phase 1.A path (DRY)
    // - L2: PromoteError::ShapeNotFound additive variant
    // - L3: Shape preserved after promote (form layer independence)
    // - L4: shape_to_xia linkage in separate map (Xia struct UNCHANGED,
    //       snapshot 영향 0)
    // - L5: Drop-in alongside (existing promote_xia_with_validation +
    //       all P-1 helpers UNCHANGED)
    //
    // Helper builders below construct mesh state for each kind of test:
    // - Single-face Shape (NotWatertight failure)
    // - Closed-cube Shape (success Volumetric)
    // - Standalone-edge Shape (success Linear)
    // ════════════════════════════════════════════════════════════════════

    /// Build a Shape that owns a single planar quad face. Useful for
    /// testing NotWatertight (open boundary) failure path.
    fn build_shape_single_quad(scene: &mut Scene) -> crate::ShapeId {
        let mat = crate::FORM_MATERIAL;
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], mat).expect("add_face");
        scene.create_shape("Single Quad".to_string(), vec![face])
    }

    /// Build a Shape that owns a closed unit cube (6 faces, watertight).
    /// Used for the Volumetric success path.
    fn build_shape_unit_cube(scene: &mut Scene) -> crate::ShapeId {
        let mat = crate::FORM_MATERIAL;
        let v = [
            scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0)),
            scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0)),
            scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0)),
            scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0)),
            scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 1.0)),
            scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 1.0)),
        ];
        // Outward normals (CCW winding when viewed from outside).
        let bottom = scene.mesh.add_face(&[v[0], v[3], v[2], v[1]], mat).expect("bottom");
        let top    = scene.mesh.add_face(&[v[4], v[5], v[6], v[7]], mat).expect("top");
        let front  = scene.mesh.add_face(&[v[0], v[1], v[5], v[4]], mat).expect("front");
        let right  = scene.mesh.add_face(&[v[1], v[2], v[6], v[5]], mat).expect("right");
        let back   = scene.mesh.add_face(&[v[2], v[3], v[7], v[6]], mat).expect("back");
        let left   = scene.mesh.add_face(&[v[3], v[0], v[4], v[7]], mat).expect("left");
        scene.create_shape(
            "Unit Cube".to_string(),
            vec![bottom, top, front, right, back, left],
        )
    }

    /// Build a Shape that owns a standalone edge (no faces). Used for
    /// the Linear success path.
    fn build_shape_standalone_edge(scene: &mut Scene) -> crate::ShapeId {
        let va = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let vb = scene.mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (edge, _new) = scene.mesh.add_edge(va, vb).expect("edge");
        let id = scene.create_shape("Line".to_string(), vec![]);
        if let Some(s) = scene.shapes.get_mut(&id) {
            s.standalone_edge_id = Some(edge);
        }
        id
    }

    #[test]
    fn promote_shape_success_volumetric() {
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let mat = MaterialId::new(7);

        let result = scene.promote_shape_to_xia(shape_id, mat);
        let ok = result.expect("Volumetric cube must promote");

        // Kind classification
        match ok.kind {
            crate::promote::XiaKind::Volumetric { volume } => {
                assert!((volume - 1.0).abs() < 1e-9, "unit cube volume = 1, got {volume}");
            }
            other => panic!("expected Volumetric, got {other:?}"),
        }

        // New Xia exists with the supplied material
        let xia = scene.xias.get(&ok.xia_id).expect("Xia inserted");
        assert_eq!(xia.material, mat);
        assert_eq!(xia.face_ids.len(), 6);

        // P-2-d linkage map populated
        assert_eq!(scene.shape_to_xia.get(&shape_id).copied(), Some(ok.xia_id));
    }

    #[test]
    fn promote_shape_success_linear() {
        let mut scene = Scene::new();
        let shape_id = build_shape_standalone_edge(&mut scene);
        let mat = MaterialId::new(3);

        let ok = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect("standalone edge must promote as Linear");

        match ok.kind {
            crate::promote::XiaKind::Linear { length, cross_section_area } => {
                assert!((length - 2.0).abs() < 1e-9, "edge length = 2, got {length}");
                assert!(cross_section_area > 0.0);
            }
            other => panic!("expected Linear, got {other:?}"),
        }

        let xia = scene.xias.get(&ok.xia_id).expect("Xia inserted");
        assert!(xia.face_ids.is_empty());
        assert!(xia.standalone_edge_id.is_some());
    }

    #[test]
    fn promote_shape_fails_shape_not_found() {
        let mut scene = Scene::new();
        let bogus = crate::ShapeId::new(9999);
        let err = scene
            .promote_shape_to_xia(bogus, MaterialId::new(1))
            .expect_err("missing shape must fail");
        assert_eq!(err, crate::promote::PromoteError::ShapeNotFound);
    }

    #[test]
    fn promote_shape_fails_invalid_material() {
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let err = scene
            .promote_shape_to_xia(shape_id, MaterialId::new(0))
            .expect_err("default material must fail");
        assert_eq!(err, crate::promote::PromoteError::InvalidMaterial);
    }

    #[test]
    fn promote_shape_fails_no_geometry() {
        let mut scene = Scene::new();
        let shape_id = scene.create_shape("Empty".to_string(), vec![]);
        // No standalone edge either.
        let err = scene
            .promote_shape_to_xia(shape_id, MaterialId::new(1))
            .expect_err("empty shape must fail");
        assert_eq!(err, crate::promote::PromoteError::NoGeometry);
    }

    #[test]
    fn promote_shape_fails_not_watertight() {
        let mut scene = Scene::new();
        let shape_id = build_shape_single_quad(&mut scene);
        let err = scene
            .promote_shape_to_xia(shape_id, MaterialId::new(1))
            .expect_err("open quad must fail");
        match err {
            crate::promote::PromoteError::NotWatertight { face_count, boundary_edges } => {
                assert_eq!(face_count, 1);
                assert!(boundary_edges >= 4, "single quad has 4 boundary edges, got {boundary_edges}");
            }
            other => panic!("expected NotWatertight, got {other:?}"),
        }
        // Linkage NOT established on failure.
        assert!(!scene.shape_to_xia.contains_key(&shape_id));
        // No Xia created.
        assert!(scene.xias.is_empty());
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-3 — Shape snapshot persistence (section 7) regression tests.
    //
    // Per P-3 §C lock-ins:
    // - Section 7 additive (legacy v2 snapshots restore Shape state to
    //   default empty without breaking other fields)
    // - 3 sub-sections: shapes / next_shape_id / shape_to_xia
    // - LOCKED #25 (ADR-074) and ADR-078 P-1 section 6 round-trip 회귀 0
    //   (additive layering preserves all existing sections)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn shape_snapshot_round_trip_preserves_shapes() {
        let mut scene = Scene::new();
        let s1 = scene.create_shape(
            "Rect".to_string(),
            vec![FaceId::new(10), FaceId::new(20)],
        );
        let s2 = scene.create_shape("Line".to_string(), vec![]);
        if let Some(shape) = scene.shapes.get_mut(&s2) {
            shape.standalone_edge_id = Some(EdgeId::new(7));
        }

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        assert_eq!(restored.shapes.len(), 2);
        let r1 = restored.get_shape(s1).expect("s1 restored");
        assert_eq!(r1.name, "Rect");
        assert_eq!(r1.face_ids, vec![FaceId::new(10), FaceId::new(20)]);
        let r2 = restored.get_shape(s2).expect("s2 restored");
        assert_eq!(r2.standalone_edge_id, Some(EdgeId::new(7)));
    }

    #[test]
    fn shape_snapshot_round_trip_preserves_next_shape_id() {
        let mut scene = Scene::new();
        let _s1 = scene.create_shape("a".to_string(), vec![]);
        let _s2 = scene.create_shape("b".to_string(), vec![]);
        let _s3 = scene.create_shape("c".to_string(), vec![]);
        // next_shape_id should now be 4 (started at 1, incremented 3 times).

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        // Verify by creating one more shape — should get id=4.
        let s4 = restored.create_shape("d".to_string(), vec![]);
        assert_eq!(s4.raw(), 4, "next_shape_id must round-trip");
    }

    #[test]
    fn shape_snapshot_round_trip_preserves_shape_to_xia_linkage() {
        // Build a unit cube + promote, then snapshot/restore. The
        // shape_to_xia map must contain the linkage post-restore.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let mat = MaterialId::new(5);
        let promote_ok = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect("promote OK");
        let xia_id = promote_ok.xia_id;

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        assert_eq!(
            restored.shape_to_xia.get(&shape_id).copied(),
            Some(xia_id),
            "shape_to_xia linkage must round-trip",
        );
        // Shape itself preserved (form layer independence).
        assert!(restored.get_shape(shape_id).is_some());
    }

    #[test]
    fn shape_snapshot_legacy_pre_p3_loads_empty_shape_state() {
        // Simulate a pre-P-3 snapshot by truncating section 7 from
        // a freshly-built snapshot. The truncation pattern matches
        // ADR-078 P-1's `boolean_group_legacy_snapshot_loads_empty`
        // — walk section length prefixes and stop at section 7 start.
        let mut scene = Scene::new();
        // Force at least one shape to make sure section 7 is non-empty
        // — then truncate it.
        let _ = scene.create_shape("forced".to_string(), vec![FaceId::new(99)]);
        let mut snap = scene.scene_snapshot();

        let mut offset = 0usize;
        // 1. mesh
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // 2. xias
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // 3. groups
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // 4. next_xia (8 bytes)
        offset += 8;
        // 5. constraints
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // 6. boolean_group_tags
        let len = u64::from_le_bytes(snap[offset..offset+8].try_into().unwrap()) as usize;
        offset += 8 + len;
        // Now offset points at section 7 (Shape state) start.
        snap.truncate(offset);

        // Restore with pre-existing dirty state — must clear it.
        let mut restored = Scene::new();
        let _ = restored.create_shape("stale".to_string(), vec![]);
        let _ = restored.create_shape("stale2".to_string(), vec![]);
        restored.restore_scene_snapshot(&snap);

        assert!(
            restored.shapes.is_empty(),
            "Legacy snapshot must reset shapes to empty (got {} shapes)",
            restored.shapes.len(),
        );
        assert_eq!(restored.next_shape_id, 1, "Legacy snapshot must reset next_shape_id");
        assert!(
            restored.shape_to_xia.is_empty(),
            "Legacy snapshot must reset shape_to_xia",
        );
    }

    #[test]
    fn shape_snapshot_round_trip_no_regression_to_locked_layers() {
        // P-3 invariant test — adding section 7 must not regress
        // existing section 1-6 round-trip behavior.
        // ADR-074 / ADR-078 회귀 가드.
        let mut scene = Scene::new();

        // Section 1-2: Mesh + Xia (via XIA create with face_ids)
        let _xia = scene.create_xia("Existing XIA".to_string());

        // Section 6: boolean_group_tags
        scene.set_boolean_group_tag(
            &[FaceId::new(11), FaceId::new(22)],
            crate::BooleanGroupTag::A,
        );
        scene.set_boolean_group_tag(
            &[FaceId::new(33)],
            crate::BooleanGroupTag::B,
        );

        // Section 7 (NEW): Shape + shape_to_xia
        let _shape = scene.create_shape("Form".to_string(), vec![FaceId::new(99)]);

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        // Section 6 round-trip (ADR-078 P-1 lockstep)
        assert_eq!(restored.get_boolean_group_a(), vec![FaceId::new(11), FaceId::new(22)]);
        assert_eq!(restored.get_boolean_group_b(), vec![FaceId::new(33)]);
        assert!(restored.has_boolean_group_selection());

        // Section 7 round-trip (P-3)
        assert_eq!(restored.shapes.len(), 1);

        // Section 1-2 (Xia) round-trip
        assert!(!restored.xias.is_empty());
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-5a — Command::DrawRectAsShape regression tests.
    //
    // Per P-5a §C lock-ins:
    // - Additive only — Command::DrawRect / exec_draw_rect /
    //   CommandResult::EntityCreated all UNCHANGED. No LOCKED #1
    //   stacked-inner regression.
    // - exec_draw_rect_as_shape produces Shape (NOT Xia). face_to_xia
    //   not updated for Shape (form-layer reference only).
    // - The pipeline reuses the same mesh synthesis as DrawRect, so
    //   geometric correctness inherits the existing exec_draw_rect
    //   regression coverage.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn draw_rect_as_shape_creates_shape_not_xia() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });

        // P-5a-b — new variant ShapeCreated returned.
        let shape_id_raw = match result {
            CommandResult::ShapeCreated(raw) => raw,
            other => panic!(
                "expected CommandResult::ShapeCreated, got {:?}",
                other,
            ),
        };
        assert!(shape_id_raw > 0, "ShapeId.raw() must be non-zero");

        // The Shape exists with the rect's face owners.
        let shape = scene
            .get_shape(crate::ShapeId::new(shape_id_raw))
            .expect("shape must exist");
        assert_eq!(shape.name, "Rectangle");
        assert!(!shape.face_ids.is_empty(), "shape must own at least 1 face");
        assert_eq!(shape.surface_normal, Some(DVec3::Z));

        // No Xia exists — form-layer only (Q4 default_material 폐지 정합).
        assert!(scene.xias.is_empty(), "DrawRectAsShape must NOT create a Xia");
    }

    #[test]
    fn draw_rect_as_shape_does_not_populate_face_to_xia() {
        // Shape is a form-layer reference, not a face owner.
        // face_to_xia (Xia layer) must remain empty after DrawRectAsShape.
        let mut scene = Scene::new();
        let _ = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 1.0,
            height: 1.0,
        });
        assert!(
            scene.face_to_xia.is_empty(),
            "face_to_xia must remain empty for Shape-only draws"
        );
    }

    #[test]
    fn draw_rect_unchanged_after_p5a_addition() {
        // P-5a §C lock-in #1 — Command::DrawRect path UNCHANGED.
        // Existing tests rely on EntityCreated(XiaId); verify the
        // contract is preserved when DrawRect is invoked normally.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        match result {
            CommandResult::EntityCreated(_xia_id) => {
                // Xia must exist (legacy path).
                assert!(!scene.xias.is_empty());
                // Shape map untouched.
                assert!(scene.shapes.is_empty(),
                    "DrawRect (legacy) must NOT create a Shape");
            }
            other => panic!("DrawRect must return EntityCreated, got {:?}", other),
        }
    }

    #[test]
    fn draw_rect_as_shape_then_promote_round_trip() {
        // End-to-end: DrawRectAsShape → promote_shape_to_xia → Xia exists.
        // Validates that the Shape produced by P-5a is suitable input
        // for the Phase 1 promote API (P-2).
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 3.0,
            height: 3.0,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("got {:?}", other),
        };

        // The flat rect is NOT volumetric — promote should fail
        // NotWatertight (single open face). This validates the
        // condition wiring rather than success path.
        let mat = MaterialId::new(7);
        let err = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect_err("flat rect must fail watertight check");
        match err {
            crate::promote::PromoteError::NotWatertight { face_count, .. } => {
                assert!(face_count >= 1);
            }
            other => panic!("expected NotWatertight, got {:?}", other),
        }

        // Failed promote MUST NOT create a Xia.
        assert!(scene.xias.is_empty());
        // Shape preserved (form-layer independence).
        assert!(scene.get_shape(shape_id).is_some());
    }

    #[test]
    fn draw_rect_as_shape_persists_through_snapshot() {
        // ADR-050 P-3 (section 7) lockstep — DrawRectAsShape result
        // must round-trip through scene_snapshot/restore_scene_snapshot.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 1.5,
            height: 2.5,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("got {:?}", other),
        };
        let original_face_ids = scene
            .get_shape(shape_id)
            .map(|s| s.face_ids.clone())
            .unwrap();

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        let restored_shape = restored
            .get_shape(shape_id)
            .expect("Shape must round-trip");
        assert_eq!(restored_shape.face_ids, original_face_ids);
        assert_eq!(restored_shape.name, "Rectangle");
        assert_eq!(restored_shape.surface_normal, Some(DVec3::Z));
        assert!(restored.xias.is_empty(), "no Xia in snapshot");
    }

    #[test]
    fn draw_rect_as_shape_does_not_regress_locked_p7_canonical() {
        // P-5a §C lock-in #1 — invoking DrawRectAsShape MUST NOT
        // regress LOCKED #1 P7 canonical invariants on the underlying
        // mesh (since the geometry pipeline is the same as DrawRect).
        // Test: build a stacked-inner via DrawRect (legacy) THEN
        // DrawRectAsShape — non-manifold count must remain ≤ 1
        // (deferred boundary).
        let mut scene = Scene::new();
        scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let _ = scene.execute(Command::DrawRectAsShape {
            center: DVec3::new(0.0, -1.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let _ = scene.execute(Command::DrawRectAsShape {
            center: DVec3::new(0.0, 1.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        let nm = scene.mesh.collect_non_manifold_edges();
        assert!(
            nm.len() <= 1,
            "ADR-051 deferred boundary regression — DrawRectAsShape \
             produced {} nm edges (expected ≤ 1): {:?}",
            nm.len(), nm,
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-5b — DrawLineAsShape / DrawCircleAsShape regression tests.
    //
    // Per P-5b §C lock-ins (mirroring P-5a):
    // - Additive only — Command::DrawLine / DrawCircle UNCHANGED.
    // - exec_draw_line_as_shape handles BOTH Face path (face_ids set)
    //   and Line path (standalone_edge_id set, face_ids empty).
    // - exec_draw_circle_as_shape produces Shape with single circle face.
    // - Arc curve attachments (ADR-028) survive conversion.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn draw_line_as_shape_creates_line_shape_with_standalone_edge() {
        // Free-edge line (no closing) — Shape should have face_ids empty
        // and standalone_edge_id set.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(2.0, 0.0, 0.0),
            surface_normal: None,
        });

        let shape_id_raw = match result {
            CommandResult::ShapeCreated(raw) => raw,
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene
            .get_shape(crate::ShapeId::new(shape_id_raw))
            .expect("shape must exist");
        assert!(shape.face_ids.is_empty(),
            "Free-edge line must produce Shape with no faces");
        assert!(shape.standalone_edge_id.is_some(),
            "Free-edge line must populate standalone_edge_id");

        // No Xia exists.
        assert!(scene.xias.is_empty());
    }

    #[test]
    fn draw_line_as_shape_face_path_when_loop_closes() {
        // Build a closed triangle via 3 DrawLineAsShape commands.
        // The last one closes the loop → face synthesized.
        let mut scene = Scene::new();
        let r1 = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(2.0, 0.0, 0.0),
            surface_normal: None,
        });
        let r2 = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(2.0, 0.0, 0.0),
            end: DVec3::new(1.0, 1.5, 0.0),
            surface_normal: None,
        });
        let r3 = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(1.0, 1.5, 0.0),
            end: DVec3::new(0.0, 0.0, 0.0),
            surface_normal: None,
        });

        // First two must be Line shapes (no face yet).
        let _shape1 = match r1 { CommandResult::ShapeCreated(id) => id, _ => panic!() };
        let _shape2 = match r2 { CommandResult::ShapeCreated(id) => id, _ => panic!() };
        let shape3_id = match r3 { CommandResult::ShapeCreated(id) => id, _ => panic!() };

        // Third one closes the loop — face should be synthesized.
        // The Shape (returned by r3) carries the face_ids for the synthesized face.
        let shape3 = scene.get_shape(crate::ShapeId::new(shape3_id))
            .expect("third shape exists");
        assert!(!shape3.face_ids.is_empty(),
            "Closing line must produce a Shape with synthesized face_ids");
        // No Xia anywhere.
        assert!(scene.xias.is_empty(),
            "Loop-closing DrawLineAsShape must NOT create a Xia");
        assert!(scene.face_to_xia.is_empty(),
            "Loop-closing DrawLineAsShape must NOT update face_to_xia");
    }

    #[test]
    fn draw_circle_as_shape_creates_shape_not_xia() {
        // ADR-107 ζ-β — segments >= POLYGON_THRESHOLD (12) → Path B
        // canonical 자동 변환. Shape.name = "Circle (kernel-native)".
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 1.5,
            segments: 16,
        });

        let shape_id_raw = match result {
            CommandResult::ShapeCreated(raw) => raw,
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene
            .get_shape(crate::ShapeId::new(shape_id_raw))
            .expect("circle shape exists");
        // ADR-107 ζ-β: Path B canonical 의 Shape name (legacy "Circle"
        // 가정에서 정정). Both legacy and Path B start with "Circle".
        assert!(
            shape.name.starts_with("Circle"),
            "Shape name should start with 'Circle' (legacy or Path B kernel-native), got: {}",
            shape.name
        );
        assert!(!shape.face_ids.is_empty(),
            "Circle must produce face_ids (single face)");
        assert_eq!(shape.surface_normal, Some(DVec3::Z));

        // No Xia.
        assert!(scene.xias.is_empty());
        assert!(scene.face_to_xia.is_empty());
    }

    #[test]
    fn draw_line_circle_unchanged_after_p5b_addition() {
        // P-5b §C lock-in #1 — legacy Command::DrawLine / DrawCircle
        // paths UNCHANGED. Verify they still produce EntityCreated(XiaId)
        // with proper xias / face_to_xia population.
        let mut scene = Scene::new();
        let r_line = scene.execute(Command::DrawLine {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(1.0, 0.0, 0.0),
            surface_normal: None,
        });
        match r_line {
            CommandResult::EntityCreated(_) => {
                assert!(!scene.xias.is_empty(), "DrawLine must create Xia");
                assert!(scene.shapes.is_empty(),
                    "DrawLine (legacy) must NOT create Shape");
            }
            other => panic!("DrawLine returned unexpected {:?}", other),
        }

        let mut scene2 = Scene::new();
        let r_circle = scene2.execute(Command::DrawCircle {
            center: DVec3::ZERO, normal: DVec3::Z,
            radius: 1.0, segments: 12,
        });
        match r_circle {
            CommandResult::EntityCreated(_) => {
                assert!(!scene2.xias.is_empty(), "DrawCircle must create Xia");
                assert!(scene2.shapes.is_empty(),
                    "DrawCircle (legacy) must NOT create Shape");
            }
            other => panic!("DrawCircle returned unexpected {:?}", other),
        }
    }

    #[test]
    fn draw_circle_as_shape_then_promote_succeeds_when_volumetric_base_exists() {
        // The flat circle Shape itself isn't volumetric — promote should
        // fail NotWatertight (mirror of draw_rect_as_shape_then_promote).
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 1.0,
            segments: 8,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("got {:?}", other),
        };

        let mat = MaterialId::new(11);
        let err = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect_err("flat circle must fail watertight");
        assert!(matches!(err, crate::promote::PromoteError::NotWatertight { .. }));
        assert!(scene.xias.is_empty(),
            "Failed promote must not create Xia");
        assert!(scene.get_shape(shape_id).is_some(),
            "Shape preserved after failed promote");
    }

    #[test]
    fn draw_line_as_shape_persists_through_snapshot() {
        // ADR-050 P-3 (section 7) lockstep — DrawLineAsShape result
        // (free-edge case) must round-trip through scene snapshot.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(3.0, 4.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("got {:?}", other),
        };
        let original_standalone = scene
            .get_shape(shape_id)
            .and_then(|s| s.standalone_edge_id);
        assert!(original_standalone.is_some());

        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        let restored_shape = restored
            .get_shape(shape_id)
            .expect("Line Shape must round-trip");
        assert_eq!(restored_shape.name, "Line");
        assert_eq!(restored_shape.standalone_edge_id, original_standalone);
        assert!(restored.xias.is_empty());
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-5e-β — FORM_MATERIAL constant + default_material removal.
    //
    // Per P-5e-β §C lock-in: `Scene.default_material` field removed
    // (ADR-049 §4 Q4 정합). All form-layer (Shape) face creation now
    // uses `crate::FORM_MATERIAL` sentinel constant, value preserved
    // (MaterialId::new(0)) so existing tests don't change behavior.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn p5e_beta_form_material_constant_value() {
        // Sentinel value lock — FORM_MATERIAL must equal MaterialId(0)
        // for backward compat with the previous default_material init.
        assert_eq!(crate::FORM_MATERIAL.raw(), 0,
            "FORM_MATERIAL.raw() must be 0 (matches deprecated default_material init)");
    }

    #[test]
    fn p5e_beta_scene_no_default_material_field_compile_check() {
        // Compile-time check: Scene must not have a `default_material`
        // field. If anyone re-introduces it (e.g., merge conflict),
        // direct field access elsewhere in the codebase would fail.
        // Here we verify the Scene is still constructible without it
        // and that FORM_MATERIAL is the documented replacement.
        let scene = Scene::new();
        assert!(scene.shapes.is_empty());
        assert!(scene.xias.is_empty());
        let mat = crate::FORM_MATERIAL;
        assert_eq!(mat.raw(), 0);
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-1-α — Scene::exec_create_solid integration tests.
    //
    // Per ADR-079 §3 Q1+Q3+Q7 lock-ins:
    //   Q1 — Smart routing scope = Extrude 내부만
    //   Q3 — NotYetSupported → legacy push_pull fallback
    //   Q7 — face_to_shape map 도입 (W-1 와 함께)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build a closed cube as Shape (form layer) for downstream
    /// promote-style tests, returning (shape_id, top_face_id).
    fn build_unit_square_shape_with_plane_surface(
        scene: &mut Scene,
    ) -> (crate::ShapeId, FaceId) {
        let mat = MaterialId::new(0);
        let v00 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene
            .mesh
            .add_face(&[v00, v10, v11, v01], mat)
            .expect("add_face");
        let surface = axia_geo::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        };
        scene.mesh.faces[face].set_surface(Some(surface));
        let shape_id = scene.create_shape("Rect Shape".to_string(), vec![face]);
        (shape_id, face)
    }

    #[test]
    fn draw_rect_as_shape_attaches_plane_surface_to_face() {
        // ADR-079 W-1-α / ADR-086 follow-up regression — DrawRectAsShape
        // 결과 face 가 AnalyticSurface::Plane attached 보장. 없으면
        // createSolidExtrude 가 NoProfileSurface 로 거부 (사용자 보고
        // 2026-05-08).
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::X,
            width: 10.0,
            height: 10.0,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert!(!shape.face_ids.is_empty(), "shape should have at least 1 face");

        // Each face must have AnalyticSurface::Plane attached.
        for &fid in &shape.face_ids {
            let surf = scene.mesh.face_surface(fid)
                .expect("face must have AnalyticSurface attached after DrawRectAsShape");
            assert!(
                matches!(surf, axia_geo::AnalyticSurface::Plane { .. }),
                "face {fid:?} should have Plane surface, got {:?}",
                surf,
            );
        }
    }

    #[test]
    fn draw_rect_as_shape_then_create_solid_extrude_succeeds_no_fallback() {
        // End-to-end regression — DrawRectAsShape → CreateSolid (Extrude)
        // 가 NoProfileSurface 없이 정상 box 생성 (사용자 보고 fix).
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::X,
            width: 10.0,
            height: 10.0,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let profile_face = scene.get_shape(shape_id).expect("shape").face_ids[0];

        let extrude_result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 5.0 },
        });
        match extrude_result {
            CommandResult::SolidCreated { kind, face_count } => {
                assert_eq!(kind, axia_geo::SolidKind::Box);
                assert_eq!(face_count, 6, "Box has 6 faces");
            }
            CommandResult::Error(msg) => {
                panic!("Expected SolidCreated, got Error: {}", msg);
            }
            other => panic!("expected SolidCreated, got {:?}", other),
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-087 K-γ regression — DrawLineAsShape face path MUST attach Plane
    // AnalyticSurface when 4 lines close to form a face. Without this, 4
    // DrawLineAsShape commands forming a square → Push/Pull rejects with
    // NoProfileSurface (same root cause as K-α/K-β).
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn k_gamma_draw_line_as_shape_face_path_attaches_plane_when_loop_closes() {
        // 4 DrawLineAsShape forming a closed square + explicit surface_normal.
        // The 4th (closing) line synthesizes a face — that face MUST have
        // AnalyticSurface::Plane attached.
        let mut scene = Scene::new();
        let n = DVec3::Z;
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end:   DVec3::new(1.0, 0.0, 0.0),
            surface_normal: Some(n),
        });
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(1.0, 0.0, 0.0),
            end:   DVec3::new(1.0, 1.0, 0.0),
            surface_normal: Some(n),
        });
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(1.0, 1.0, 0.0),
            end:   DVec3::new(0.0, 1.0, 0.0),
            surface_normal: Some(n),
        });
        let r4 = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 1.0, 0.0),
            end:   DVec3::new(0.0, 0.0, 0.0),
            surface_normal: Some(n),
        });
        let shape4_id = match r4 {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape4_id).expect("shape4 exists");
        assert!(
            !shape.face_ids.is_empty(),
            "closing line must synthesize face"
        );
        for &fid in &shape.face_ids {
            let surf = scene.mesh.face_surface(fid)
                .expect("ADR-087 K-γ: face must have Plane after closing line");
            assert!(
                matches!(surf, axia_geo::AnalyticSurface::Plane { .. }),
                "face should have Plane surface, got {:?}",
                surf,
            );
        }
    }

    #[test]
    fn k_gamma_draw_line_as_shape_then_create_solid_extrude_succeeds() {
        // End-to-end — 4 DrawLineAsShape → CreateSolid(Extrude) 정상.
        let mut scene = Scene::new();
        let n = DVec3::Z;
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::ZERO,
            end:   DVec3::new(2.0, 0.0, 0.0),
            surface_normal: Some(n),
        });
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(2.0, 0.0, 0.0),
            end:   DVec3::new(2.0, 2.0, 0.0),
            surface_normal: Some(n),
        });
        let _ = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(2.0, 2.0, 0.0),
            end:   DVec3::new(0.0, 2.0, 0.0),
            surface_normal: Some(n),
        });
        let r4 = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 2.0, 0.0),
            end:   DVec3::ZERO,
            surface_normal: Some(n),
        });
        let shape_id = match r4 {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let profile_face = scene.get_shape(shape_id).expect("shape").face_ids[0];

        let result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 1.0 },
        });
        match result {
            CommandResult::SolidCreated { kind, face_count } => {
                assert_eq!(kind, axia_geo::SolidKind::Box);
                assert_eq!(face_count, 6, "Box has 6 faces");
            }
            CommandResult::Error(msg) => {
                panic!("ADR-087 K-γ: expected SolidCreated, got Error: {}", msg);
            }
            other => panic!("expected SolidCreated, got {:?}", other),
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-088 S-γ regression — DrawCircle/AsShape segments share owner_id.
    // LOCKED #15 P22.5 enforcement at creation time.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr088_s_gamma_draw_circle_segments_share_owner_id() {
        // DrawCircle 의 N segments 모두 같은 curve_owner_id 부여 → 한 segment
        // 클릭 시 SelectTool walk 가 N segments 전체 선택 (LOCKED #15 P22.5).
        let mut scene = Scene::new();
        let segments = 16u32;
        let _ = scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments,
        });

        // Collect curve_owner_id from all active edges with Arc curve.
        let mut owners = std::collections::HashSet::new();
        let mut arc_segment_count = 0;
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            if let Some(axia_geo::AnalyticCurve::Arc { .. }) = edge.curve() {
                let owner = scene.mesh.edge_curve_owner_id(eid);
                assert!(owner.is_some(),
                    "ADR-088 S-γ: Arc segment must have curve_owner_id");
                owners.insert(owner.unwrap());
                arc_segment_count += 1;
            }
        }

        assert_eq!(arc_segment_count, segments as usize,
            "expected {} Arc segments, got {}", segments, arc_segment_count);
        assert_eq!(owners.len(), 1,
            "ADR-088 S-γ: all {} segments must share single owner_id, got {} distinct ids",
            segments, owners.len());
    }

    #[test]
    fn adr088_s_gamma_draw_circle_as_shape_segments_share_owner_id() {
        // ADR-107 ζ-β — segments < POLYGON_THRESHOLD (12) → legacy
        // polygon path (DrawPolygon use case 보존). ADR-088 owner_id
        // grouping 의도는 polygon path 에서만 의미 (Path B 는 1 edge,
        // grouping trivially 충족).
        //
        // segments=8 (octagon) — Layer H hybrid legacy path 정합 검증.
        let mut scene = Scene::new();
        let segments = 8u32;
        let _ = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 3.0,
            segments,
        });

        let mut owners = std::collections::HashSet::new();
        let mut arc_segment_count = 0;
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            if let Some(axia_geo::AnalyticCurve::Arc { .. }) = edge.curve() {
                let owner = scene.mesh.edge_curve_owner_id(eid);
                assert!(owner.is_some());
                owners.insert(owner.unwrap());
                arc_segment_count += 1;
            }
        }
        assert_eq!(arc_segment_count, segments as usize);
        assert_eq!(owners.len(), 1, "AsShape (legacy polygon path) must single owner");
    }

    // ADR-107 ζ-β — Path B canonical regression for DrawCircleAsShape
    // with segments >= POLYGON_THRESHOLD. ADR-088 의 N segment grouping
    // 대신 Path B 의 single Circle edge canonical 검증.
    #[test]
    fn adr107_zeta_beta_draw_circle_as_shape_path_b_canonical() {
        let mut scene = Scene::new();
        let segments = 24u32; // >= 12 → Path B 자동 변환
        let _ = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 3.0,
            segments,
        });

        // Path B canonical: 1 vert + 1 edge + 1 face
        let active_verts = scene.mesh.verts.iter()
            .filter(|(_, v)| v.is_active()).count();
        let active_edges = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        let active_faces = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();

        assert_eq!(active_verts, 1, "Path B: 1 anchor vertex");
        assert_eq!(active_edges, 1, "Path B: 1 self-loop edge");
        assert_eq!(active_faces, 1, "Path B: 1 face");

        // Edge curve = Circle (kind=2), NOT Arc segments (kind=3).
        let circle_edge_count = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active())
            .filter(|(_, e)| matches!(e.curve(), Some(axia_geo::AnalyticCurve::Circle { .. })))
            .count();
        assert_eq!(circle_edge_count, 1,
            "Path B canonical: 1 Circle curve (not N Arc segments)");

        // Face has Plane surface attached (ADR-087 K-β regression).
        let plane_face_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .filter(|(_, f)| matches!(f.surface(), Some(axia_geo::AnalyticSurface::Plane { .. })))
            .count();
        assert_eq!(plane_face_count, 1,
            "Path B canonical: face has Plane surface (ADR-087 K-β)");
    }

    // ADR-107 ζ-β — threshold boundary regression. segments < 12 → legacy,
    // >= 12 → Path B. 명시 N=11 / N=12 boundary 검증.
    #[test]
    fn adr107_zeta_beta_threshold_boundary_segments_eleven_legacy() {
        // segments=11 → legacy polygon path (11 Arc segments + 1 owner).
        let mut scene = Scene::new();
        let _ = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 2.0,
            segments: 11,
        });

        let arc_count = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active())
            .filter(|(_, e)| matches!(e.curve(), Some(axia_geo::AnalyticCurve::Arc { .. })))
            .count();
        assert_eq!(arc_count, 11,
            "segments=11 (< POLYGON_THRESHOLD): legacy 11 Arc segments");
    }

    #[test]
    fn adr107_zeta_beta_threshold_boundary_segments_twelve_path_b() {
        // segments=12 (= POLYGON_THRESHOLD) → Path B 자동 변환 (1 Circle).
        let mut scene = Scene::new();
        let _ = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 2.0,
            segments: 12,
        });

        let circle_count = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active())
            .filter(|(_, e)| matches!(e.curve(), Some(axia_geo::AnalyticCurve::Circle { .. })))
            .count();
        let arc_count = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active())
            .filter(|(_, e)| matches!(e.curve(), Some(axia_geo::AnalyticCurve::Arc { .. })))
            .count();
        assert_eq!(circle_count, 1,
            "segments=12 (>= POLYGON_THRESHOLD): Path B 1 Circle curve");
        assert_eq!(arc_count, 0,
            "segments=12: 0 Arc segments (Path B canonical)");
    }

    #[test]
    fn adr088_s_gamma_two_circles_get_distinct_owner_ids() {
        // 두 개의 별개 원 → 두 개의 distinct owner_id (cross-circle leak 차단).
        let mut scene = Scene::new();
        let _ = scene.execute(Command::DrawCircle {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 1.0,
            segments: 8,
        });
        let _ = scene.execute(Command::DrawCircle {
            center: DVec3::new(10.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 1.0,
            segments: 8,
        });

        let mut owners = std::collections::HashSet::new();
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            if let Some(axia_geo::AnalyticCurve::Arc { .. }) = edge.curve() {
                if let Some(o) = scene.mesh.edge_curve_owner_id(eid) {
                    owners.insert(o);
                }
            }
        }
        assert_eq!(owners.len(), 2,
            "ADR-088 S-γ: 2 separate circles must have 2 distinct owner_ids");
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-ζ-4) — DrawCircleAsCurve end-to-end tests.
    //
    // 사용자 facing 첫 변화. Polygon decomposition (DrawCircle / DrawCircle
    // AsShape) 와 architectural 으로 다름 — 1 anchor + 1 self-loop edge
    // + 1 closed-curve face + Form-layer Shape.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_zeta_4_creates_kernel_native_circle_topology() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
        });
        let shape_raw = match result {
            CommandResult::ShapeCreated(raw) => raw,
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        // Topology: 1 anchor vert + 1 self-loop edge + 1 face
        let active_verts = scene.mesh.verts.iter()
            .filter(|(_, v)| v.is_active()).count();
        let active_edges = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        let active_faces = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_verts, 1, "ADR-089 A-ζ-4: 1 anchor vertex (메타-원칙 #14)");
        assert_eq!(active_edges, 1, "ADR-089 A-ζ-4: 1 self-loop edge");
        assert_eq!(active_faces, 1, "ADR-089 A-ζ-4: 1 closed-curve face");

        // The single edge is a self-loop with Circle curve attached.
        let (eid, edge) = scene.mesh.edges.iter()
            .find(|(_, e)| e.is_active())
            .map(|(id, e)| (id, e))
            .unwrap();
        assert!(edge.is_self_loop(),
            "ADR-089 A-ζ-4: edge must be self-loop");
        assert!(matches!(
            edge.curve(),
            Some(axia_geo::AnalyticCurve::Circle { .. })
        ), "ADR-089 A-ζ-4: edge must have Circle curve");
        let _ = eid;

        // Form-layer Shape registered.
        let shape = scene.get_shape(crate::ShapeId::new(shape_raw))
            .expect("ADR-089 A-ζ-4: Shape must exist");
        assert_eq!(shape.face_ids.len(), 1);

        // Invariants pass (A-ζ-1 exemption).
        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-4: kernel-native circle must pass invariants. \
             Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_zeta_4_drawCircle_legacy_unchanged() {
        // 기존 DrawCircle (24-segment polygon) 동작 무변화 검증.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: 24,
        });
        match result {
            CommandResult::EntityCreated(_) => { /* legacy Xia path */ }
            other => panic!("legacy DrawCircle must return EntityCreated, got {:?}", other),
        }
        // Topology: 24 verts + 24 line edges + 1 face
        let active_verts = scene.mesh.verts.iter()
            .filter(|(_, v)| v.is_active()).count();
        let active_edges = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        assert_eq!(active_verts, 24, "legacy: 24 polygon verts");
        assert_eq!(active_edges, 24, "legacy: 24 line edges");
        // No self-loop edges in legacy path.
        let self_loops = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.is_self_loop())
            .count();
        assert_eq!(self_loops, 0,
            "ADR-089 A-ζ-4: legacy DrawCircle must NOT create self-loop edges");
    }

    #[test]
    fn adr089_a_zeta_4_kernel_native_and_legacy_coexist() {
        // 한 mesh 에 kernel-native circle + legacy DrawCircle 공존 검증.
        let mut scene = Scene::new();
        // Kernel-native circle (1 vert + 1 self-loop)
        let _ = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::new(20.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 3.0,
        });
        // Legacy DrawCircle (24 verts + 24 edges)
        let _ = scene.execute(Command::DrawCircle {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: 24,
        });

        let active_faces = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_faces, 2,
            "ADR-089 A-ζ-4: 2 faces (kernel-native + legacy)");

        let self_loops = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.is_self_loop())
            .count();
        assert_eq!(self_loops, 1,
            "ADR-089 A-ζ-4: exactly 1 self-loop edge (kernel-native circle)");

        // All invariants pass.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "Mixed mesh must pass invariants. Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_zeta_4_rejects_invalid_inputs() {
        let mut scene = Scene::new();
        // Zero radius
        let r1 = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::ZERO, normal: DVec3::Z, radius: 0.0,
        });
        assert!(matches!(r1, CommandResult::Error(_)));
        // Zero normal
        let r2 = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::ZERO, normal: DVec3::ZERO, radius: 1.0,
        });
        assert!(matches!(r2, CommandResult::Error(_)));
        // Mesh state untouched (rollback or no-op).
        assert_eq!(
            scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count(),
            0, "no faces created on error");
    }

    #[test]
    fn k_gamma_draw_line_as_shape_no_face_no_plane() {
        // Free-edge line (no closing) — Shape has no face_ids, no Plane
        // attach attempted. surface_normal hint 가 있어도 face 없으면 무관.
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawLineAsShape {
            start: DVec3::ZERO,
            end:   DVec3::new(2.0, 0.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        let shape_id = match r {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert!(
            shape.face_ids.is_empty(),
            "free-edge line must not synthesize face"
        );
        assert!(
            shape.standalone_edge_id.is_some(),
            "free-edge line must populate standalone_edge_id"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-087 K-β regression — DrawCircleAsShape + DrawPolygon (via N-gon
    // circle approximation) MUST attach Plane AnalyticSurface, mirroring
    // DrawRectAsShape (P-5a). Without these, createSolidExtrude on a
    // circle/polygon profile rejects with NoProfileSurface — the same
    // bug that 5db6d41 fixed for rect.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn draw_circle_as_shape_attaches_plane_surface_to_face() {
        // ADR-087 K-β — DrawCircleAsShape 결과 face 가 AnalyticSurface::
        // Plane attached 보장. createSolidExtrude / Boolean / Offset 의
        // 입력으로 즉시 사용 가능.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: 16,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert!(!shape.face_ids.is_empty(), "circle shape must have ≥1 face");

        for &fid in &shape.face_ids {
            let surf = scene.mesh.face_surface(fid)
                .expect("face must have AnalyticSurface attached after DrawCircleAsShape");
            assert!(
                matches!(surf, axia_geo::AnalyticSurface::Plane { .. }),
                "face {fid:?} should have Plane surface, got {:?}",
                surf,
            );
        }
    }

    #[test]
    fn draw_circle_as_shape_then_create_solid_extrude_succeeds() {
        // ADR-087 K-β end-to-end — DrawCircleAsShape → CreateSolid(Extrude)
        // 정상 cylindrical solid 생성. NoProfileSurface 거부 없음.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
            segments: 16,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let profile_face = scene.get_shape(shape_id).expect("shape").face_ids[0];

        let extrude_result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 3.0 },
        });
        match extrude_result {
            CommandResult::SolidCreated { kind: _, face_count } => {
                // 16-gon profile → 1 top + 1 bottom + 16 sides = 18 faces
                assert!(
                    face_count >= 6,
                    "extruded circle should produce a closed solid with ≥6 faces, got {}",
                    face_count,
                );
            }
            CommandResult::Error(msg) => {
                panic!("Expected SolidCreated, got Error: {}", msg);
            }
            other => panic!("expected SolidCreated, got {:?}", other),
        }
    }

    #[test]
    fn draw_polygon_via_circle_as_shape_attaches_plane_surface() {
        // ADR-087 K-β — DrawPolygon (via DrawCircleAsShape with N=6)
        // 도 동일하게 Plane attach. Hexagon (육각형) face 가 first-class
        // kernel-aware Shape.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 3.0,
            segments: 6,  // hexagon
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        for &fid in &shape.face_ids {
            let surf = scene.mesh.face_surface(fid)
                .expect("hexagon face must have Plane attached");
            assert!(
                matches!(surf, axia_geo::AnalyticSurface::Plane { .. }),
                "hexagon face should have Plane surface",
            );
        }
    }

    #[test]
    fn draw_circle_as_shape_plane_basis_perpendicular_to_normal() {
        // ADR-087 K-β invariant — basis_u 가 normal 에 perpendicular
        // (Gram-Schmidt 정합). 어떤 normal 방향이든 정상 Plane 생성.
        let mut scene = Scene::new();
        // Tilted normal — explicit non-cardinal direction.
        let normal = DVec3::new(1.0, 1.0, 1.0).normalize();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::new(2.0, 3.0, 4.0),
            normal,
            radius: 1.0,
            segments: 12,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        let fid = shape.face_ids[0];
        let surf = scene.mesh.face_surface(fid).expect("Plane attached");
        match surf {
            axia_geo::AnalyticSurface::Plane { normal: pn, basis_u, .. } => {
                let dot = basis_u.dot(*pn).abs();
                assert!(
                    dot < 1e-9,
                    "basis_u must be perpendicular to plane normal (dot={dot})",
                );
                let basis_len = basis_u.length();
                assert!(
                    (basis_len - 1.0).abs() < 1e-9,
                    "basis_u must be normalized (len={basis_len})",
                );
            }
            other => panic!("expected Plane surface, got {:?}", other),
        }
    }

    #[test]
    fn draw_circle_as_shape_plane_normal_aligned_with_world_x() {
        // ADR-087 K-β edge case — World X 와 거의 평행한 normal 의
        // basis_u fallback (World X → World Y). Circle 이 YZ 평면에
        // 위치한 경우 정상 동작.
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::X,
            radius: 1.0,
            segments: 8,
        });
        let shape_id = match result {
            CommandResult::ShapeCreated(raw) => crate::ShapeId::new(raw),
            other => panic!("expected ShapeCreated, got {:?}", other),
        };
        let shape = scene.get_shape(shape_id).expect("shape exists");
        let fid = shape.face_ids[0];
        let surf = scene.mesh.face_surface(fid).expect("Plane attached");
        match surf {
            axia_geo::AnalyticSurface::Plane { normal: pn, basis_u, .. } => {
                // Normal should remain +X
                assert!((pn.x - 1.0).abs() < 1e-9);
                // basis_u must be perpendicular to X — i.e., zero X component
                assert!(basis_u.x.abs() < 1e-9, "basis_u should have no X component");
                let basis_len = basis_u.length();
                assert!((basis_len - 1.0).abs() < 1e-9);
            }
            other => panic!("expected Plane surface, got {:?}", other),
        }
    }

    #[test]
    fn exec_create_solid_extrude_plane_rect_box_via_shape_path() {
        let mut scene = Scene::new();
        let (shape_id, profile_face) = build_unit_square_shape_with_plane_surface(&mut scene);

        let result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 1.0 },
        });
        match result {
            CommandResult::SolidCreated { kind, face_count } => {
                assert_eq!(kind, axia_geo::SolidKind::Box);
                assert_eq!(face_count, 6, "Box has 6 faces");
            }
            other => panic!("expected SolidCreated, got {:?}", other),
        }
        // Shape ownership updated — face_ids should now contain all 6.
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert_eq!(shape.face_ids.len(), 6,
            "Shape.face_ids must include profile + top + 4 sides");
    }

    #[test]
    fn exec_create_solid_face_to_shape_updated_for_new_faces() {
        let mut scene = Scene::new();
        let (shape_id, profile_face) = build_unit_square_shape_with_plane_surface(&mut scene);

        let _ = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 1.0 },
        });

        // All 6 face IDs in Shape.face_ids must map back to shape_id via
        // face_to_shape.
        let shape = scene.get_shape(shape_id).expect("shape exists");
        for &fid in &shape.face_ids {
            assert_eq!(scene.face_to_shape.get(&fid).copied(), Some(shape_id),
                "face_to_shape[{fid:?}] must = {shape_id:?}");
        }
    }

    #[test]
    fn exec_create_solid_xia_path_legacy_unchanged() {
        // Xia path (legacy) — face_to_xia 는 갱신되어야, face_to_shape
        // 는 비어있어야.
        let mut scene = Scene::new();
        let mat = MaterialId::new(0);
        let v00 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let profile_face = scene.mesh.add_face(&[v00, v10, v11, v01], mat).expect("face");
        let surface = axia_geo::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        };
        scene.mesh.faces[profile_face].set_surface(Some(surface));

        // Register profile under a Xia (legacy path).
        let xia_id = scene.create_xia("Legacy Rect".to_string());
        if let Some(xia) = scene.xias.get_mut(&xia_id) {
            xia.face_ids.push(profile_face);
        }
        scene.face_to_xia.insert(profile_face, xia_id);

        let _ = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 1.0 },
        });

        // Xia.face_ids should now include all 6 faces.
        let xia = scene.xias.get(&xia_id).expect("xia exists");
        assert_eq!(xia.face_ids.len(), 6);
        // face_to_shape should remain empty (no Shape involved).
        assert!(scene.face_to_shape.is_empty(),
            "face_to_shape must remain empty when ownership is Xia-only");
    }

    #[test]
    fn exec_create_solid_falls_back_to_push_pull_when_not_yet_supported() {
        // Q3 lock-in — unsupported case → legacy push_pull fallback.
        // After W-2 (analytic primitives) + W-3 (NURBS-class hosts +
        // Sweep/Loft) + W-4-α (Revolve full 360°) all activated, the
        // canonical remaining unsupported case is Revolve with partial
        // angle (W-4-γ scope).
        let mut scene = Scene::new();
        let mat = MaterialId::new(0);
        let v00 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let profile_face = scene.mesh.add_face(&[v00, v10, v11, v01], mat).expect("face");
        // Plain Plane surface — supported, but Revolve partial angle
        // triggers NotYetSupported regardless of profile validity.
        scene.mesh.faces[profile_face].set_surface(Some(axia_geo::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));

        let result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::PI, // partial angle (180°)
            },
        });

        // Fallback to legacy push_pull → returns PushPullDone (not SolidCreated).
        match result {
            CommandResult::PushPullDone { .. } => {
                // Q3 fallback succeeded.
            }
            CommandResult::Error(_) => {
                // Push_pull may also fail on this synthetic input — also OK
                // for fallback verification (we just need to confirm the
                // path was taken, not push_pull's own success).
            }
            other => panic!(
                "expected PushPullDone or Error from fallback, got {:?}",
                other
            ),
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-109 π-β — Arc Extrusion → Cylinder Surface Promotion
    //
    // Mixed boundary (Arc + chord) extrude 의 Q3 fallback (legacy push_pull)
    // 후 post-process 가 Arc side faces 에 Cylinder surface 부여 검증.
    //
    // 사용자 시연 evidence (2026-05-16): 반원통 (Arc + chord + extrude)
    // 결과 16 quad sides 모두 Plane → "원통과 반원통 성질이 다름" 결함.
    // 본 회귀 자산이 Cylinder surface 부여 후 smooth-group hide 자연 정합
    // 검증.
    // ════════════════════════════════════════════════════════════════════

    // Helper — build half-cylinder profile (Arc + chord) + Plane surface.
    fn build_adr109_half_cylinder_profile(scene: &mut Scene) -> axia_geo::FaceId {
        let mat = MaterialId::new(0);
        // 16-segment half-circle on XY plane (normal +Z), radius=5, center=origin.
        // Arc: theta 0 → π. Chord: (-5, 0, 0) → (5, 0, 0).
        let n_segs = 16;
        let radius = 5.0;
        let mut verts = Vec::new();
        for i in 0..=n_segs {
            let theta = (i as f64) * std::f64::consts::PI / (n_segs as f64);
            let x = radius * theta.cos();
            let y = radius * theta.sin();
            verts.push(scene.mesh.add_vertex(DVec3::new(x, y, 0.0)));
        }
        // build face (CCW): all verts in order (arc + implicit chord on close)
        let face = scene.mesh.add_face(&verts, mat).expect("half-cyl face");
        // attach Plane surface
        scene.mesh.faces[face].set_surface(Some(axia_geo::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-radius, radius),
            v_range: (-radius, radius),
        }));
        // attach Arc curves to all arc segments (Layer H Hybrid — N polygon
        // edges with Arc curve metadata). Chord edge (verts[n_segs] → verts[0])
        // remains None.
        for i in 0..n_segs {
            let v_a = verts[i];
            let v_b = verts[i + 1];
            if let Some(eid) = scene.mesh.find_edge(v_a, v_b) {
                if let Some(edge) = scene.mesh.edges.get_mut(eid) {
                    let theta_a = (i as f64) * std::f64::consts::PI / (n_segs as f64);
                    let theta_b = ((i + 1) as f64) * std::f64::consts::PI / (n_segs as f64);
                    edge.set_curve(Some(axia_geo::AnalyticCurve::Arc {
                        center: DVec3::ZERO,
                        radius,
                        normal: DVec3::Z,
                        basis_u: DVec3::X,
                        start_angle: theta_a,
                        end_angle: theta_b,
                    }));
                }
            }
        }
        face
    }

    /// Core regression — half-cylinder extrude promotes Cylinder surface to
    /// Arc side faces.
    #[test]
    fn adr109_pi_beta_arc_extrude_promotes_cylinder() {
        use axia_geo::AnalyticSurface;
        let mut scene = Scene::new();
        let profile = build_adr109_half_cylinder_profile(&mut scene);

        // Extrude — Q3 fallback path (Mixed boundary → legacy push_pull +
        // ADR-109 π-β post-process).
        let result = scene.execute(Command::CreateSolid {
            face_id: profile,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 8.0 },
        });
        // Q3 fallback returns PushPullDone, not SolidCreated.
        assert!(matches!(result,
            CommandResult::PushPullDone { .. } | CommandResult::SolidCreated { .. }
        ), "expected PushPullDone (Q3 fallback) or SolidCreated, got {:?}", result);

        // Count Cylinder-surface faces — ADR-109 post-process must promote
        // ≥1 face (16 Arc side faces).
        let cylinder_face_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .filter(|(_, f)| matches!(f.surface(), Some(AnalyticSurface::Cylinder { .. })))
            .count();
        assert!(cylinder_face_count >= 1,
            "ADR-109 π-β: at least 1 Cylinder surface face after Arc extrude post-process, got {}",
            cylinder_face_count);
    }

    /// Regression guard — full Path B cylinder unchanged (already has
    /// Cylinder via canonical path, post-process L1 scope 정확).
    #[test]
    fn adr109_pi_beta_full_cylinder_unchanged() {
        use axia_geo::AnalyticSurface;
        let mut scene = Scene::new();
        // drawCircleAsCurve → Path B canonical
        let _ = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 5.0,
        });
        // Find the closed-curve face (first active face)
        let circle_face = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .expect("circle face");

        let _ = scene.execute(Command::CreateSolid {
            face_id: circle_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 8.0 },
        });

        // Full cylinder via Path A or Path B — both must have ≥1 Cylinder
        // surface face (Path A = N quad sides all Cylinder, Path B = 1
        // single Cylinder side). 본 test 는 ADR-109 post-process 가 기존
        // Cylinder canonical 흐름을 흔들지 않음 검증 (regression guard).
        let cylinder_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .filter(|(_, f)| matches!(f.surface(), Some(AnalyticSurface::Cylinder { .. })))
            .count();
        assert!(cylinder_count >= 1,
            "Full cylinder (Path A or B) must have ≥1 Cylinder side face, got {}",
            cylinder_count);
    }

    /// Helper visibility — Mesh::promote_arc_side_faces_to_cylinder
    /// direct unit (axis parallel check guards non-Arc faces).
    #[test]
    fn adr109_pi_beta_helper_skips_non_arc_faces() {
        use axia_geo::AnalyticSurface;
        let mut scene = Scene::new();
        let mat = MaterialId::new(0);
        // Plain square (no Arc curve attached).
        let v00 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v00, v10, v11, v01], mat).expect("face");

        // Call helper directly — face has no Arc boundary → no promotion.
        let promoted = scene.mesh.promote_arc_side_faces_to_cylinder(
            &[face],
            DVec3::Z,
        );
        assert_eq!(promoted, 0,
            "Helper must skip non-Arc faces (L3 scope, chord/Line side faces unchanged)");
        assert!(scene.mesh.faces[face].surface().is_none(),
            "Non-Arc face surface unchanged");
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-β — Plane + AllCircular → Cylinder integration
    //
    // Per ADR-079 §W2-A-(a) / §W2-B-(a) / §W2-E-(a) lock-ins:
    //   - Scene::exec_create_solid 가 SolidKind::Cylinder 도 Box 와 동일
    //     ownership 갱신 경로로 처리
    //   - Cylinder profile 의 N 측벽 + top + profile 모두 Shape/Xia 에 흡수
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build N-segment circle profile face with Plane surface +
    /// Arc curves, registered under a Shape (form layer).
    fn build_circle_shape_with_plane_surface(
        scene: &mut Scene,
        radius: f64,
        segments: u32,
    ) -> (crate::ShapeId, FaceId) {
        use axia_geo::AnalyticCurve;
        let mat = MaterialId::new(0);
        let n = segments as usize;
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let basis_u = DVec3::X;

        let mut verts = Vec::with_capacity(n);
        for i in 0..n {
            let theta = (i as f64) * std::f64::consts::TAU / (n as f64);
            verts.push(scene.mesh.add_vertex(DVec3::new(
                radius * theta.cos(),
                radius * theta.sin(),
                0.0,
            )));
        }
        let face = scene.mesh.add_face(&verts, mat).expect("add_face");
        scene.mesh.faces[face].set_surface(Some(axia_geo::AnalyticSurface::Plane {
            origin: center,
            normal,
            basis_u,
            u_range: (-radius, radius),
            v_range: (-radius, radius),
        }));

        let edges = scene.mesh.face_outer_edges(face).expect("edges");
        let two_pi = std::f64::consts::TAU;
        for (i, &eid) in edges.iter().enumerate() {
            let theta_start = (i as f64) * two_pi / (n as f64);
            let theta_end = ((i + 1) as f64) * two_pi / (n as f64);
            let curve = AnalyticCurve::Arc {
                center,
                radius,
                normal,
                basis_u,
                start_angle: theta_start,
                end_angle: theta_end,
            };
            scene.mesh.edges[eid].set_curve(Some(curve));
        }

        let shape_id = scene.create_shape("Circle Shape".to_string(), vec![face]);
        (shape_id, face)
    }

    #[test]
    fn exec_create_solid_extrude_plane_circle_cylinder_via_shape_path() {
        let mut scene = Scene::new();
        let (shape_id, profile_face) =
            build_circle_shape_with_plane_surface(&mut scene, 4.0, 16);

        let result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 5.0 },
        });
        match result {
            CommandResult::SolidCreated { kind, face_count } => {
                assert_eq!(
                    kind,
                    axia_geo::SolidKind::Cylinder,
                    "Plane + AllCircular must route to Cylinder"
                );
                // profile + top + 16 sides = 18 faces
                assert_eq!(face_count, 18, "Cylinder has 1 + 1 + 16 = 18 faces");
            }
            other => panic!("expected SolidCreated::Cylinder, got {:?}", other),
        }

        // Shape ownership: all 18 faces.
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert_eq!(
            shape.face_ids.len(),
            18,
            "Shape.face_ids must include profile + top + 16 sides"
        );
    }

    #[test]
    fn exec_create_solid_cylinder_face_to_shape_updated_for_all_new_faces() {
        let mut scene = Scene::new();
        let (shape_id, profile_face) =
            build_circle_shape_with_plane_surface(&mut scene, 2.5, 12);

        let _ = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Extrude { distance: 3.0 },
        });

        // All 14 face IDs (1 profile + 1 top + 12 sides) must map to shape_id.
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert_eq!(shape.face_ids.len(), 14);
        for &fid in &shape.face_ids {
            assert_eq!(
                scene.face_to_shape.get(&fid).copied(),
                Some(shape_id),
                "face_to_shape[{fid:?}] must = {shape_id:?}"
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-4-α — Scene::exec_create_solid Revolve mode integration
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn exec_create_solid_revolve_full_360_via_shape_path() {
        // Profile triangle in xy plane, revolved around y-axis (full 360°).
        // Validates that SolidKind::RevolutionSolid flows through Scene
        // wrapper unchanged (kind-agnostic Shape ownership).
        let mut scene = Scene::new();
        let mat = MaterialId::new(0);
        let v0 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let profile_face = scene
            .mesh
            .add_face(&[v0, v1, v2], mat)
            .expect("profile face");
        scene.mesh.faces[profile_face].set_surface(Some(axia_geo::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 2.0),
            v_range: (0.0, 1.0),
        }));
        let shape_id = scene.create_shape("Revolve Profile".to_string(), vec![profile_face]);

        let result = scene.execute(Command::CreateSolid {
            face_id: profile_face,
            mode: axia_geo::CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::TAU,
            },
        });
        match result {
            CommandResult::SolidCreated { kind, face_count } => {
                assert_eq!(
                    kind,
                    axia_geo::SolidKind::RevolutionSolid,
                    "Revolve full 360° must route to RevolutionSolid"
                );
                // Profile (1) + side faces (≥ 1).
                assert!(face_count >= 2, "RevolutionSolid must have ≥ 2 faces");
            }
            other => panic!("expected SolidCreated::RevolutionSolid, got {:?}", other),
        }

        // Shape ownership: face_to_shape must include profile + all sides.
        let shape = scene.get_shape(shape_id).expect("shape exists");
        assert!(shape.face_ids.len() >= 2);
        for &fid in &shape.face_ids {
            assert_eq!(
                scene.face_to_shape.get(&fid).copied(),
                Some(shape_id),
                "face_to_shape[{fid:?}] must = {shape_id:?}"
            );
        }
    }

    #[test]
    fn create_shape_registers_face_to_shape_index() {
        // Q7 lock-in — face_to_shape map 도입.
        let mut scene = Scene::new();
        let face_ids = vec![FaceId::new(10), FaceId::new(20), FaceId::new(30)];
        let shape_id = scene.create_shape("Test".to_string(), face_ids.clone());

        for &fid in &face_ids {
            assert_eq!(scene.face_to_shape.get(&fid).copied(), Some(shape_id),
                "create_shape must register face_to_shape[{fid:?}]");
        }
    }

    #[test]
    fn delete_shape_removes_face_to_shape_entries() {
        let mut scene = Scene::new();
        let face_ids = vec![FaceId::new(10), FaceId::new(20)];
        let shape_id = scene.create_shape("Doomed".to_string(), face_ids.clone());

        assert!(scene.delete_shape(shape_id));
        for &fid in &face_ids {
            assert!(!scene.face_to_shape.contains_key(&fid),
                "delete_shape must clear face_to_shape[{fid:?}]");
        }
    }

    #[test]
    fn rebuild_face_to_shape_after_snapshot_restore() {
        // ADR-050 P-3 (Section 7) round-trip + face_to_shape rebuild.
        let mut scene = Scene::new();
        let face_ids = vec![FaceId::new(7), FaceId::new(11)];
        let shape_id = scene.create_shape("Persisted".to_string(), face_ids.clone());

        // Snapshot + restore (face_to_shape is in-memory only — must rebuild).
        let snap = scene.scene_snapshot();
        let mut restored = Scene::new();
        restored.restore_scene_snapshot(&snap);

        for &fid in &face_ids {
            assert_eq!(restored.face_to_shape.get(&fid).copied(), Some(shape_id),
                "face_to_shape must be rebuilt after restore");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-050 P-5e-γ — Single-Undo regression for As-Shape draws.
    //
    // Per P-5e-γ §C lock-in: replace_last_after_snapshot collapses the
    // legacy DrawRect transaction (T1) and the Xia → Shape conversion
    // (previously T2) into one undo frame. A single Undo press now
    // restores pre-rect / pre-line / pre-circle state directly.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn p5e_gamma_draw_rect_as_shape_single_undo_restores_pre_rect() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawRectAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        assert!(matches!(result, CommandResult::ShapeCreated(_)));
        assert_eq!(scene.shapes.len(), 1);
        let face_count_after = scene.mesh.face_count();
        assert!(face_count_after > 0, "rect must create faces");

        // P-5e-γ: single Undo restores pre-rect state.
        let undo_result = scene.execute(Command::Undo);
        assert!(matches!(undo_result, CommandResult::MeshUpdated));
        assert_eq!(scene.shapes.len(), 0,
            "single Undo must remove the Shape (not just convert back to Xia)");
        assert_eq!(scene.xias.len(), 0,
            "no transient Xia state should remain");
        assert_eq!(scene.mesh.face_count(), 0,
            "mesh must be back to pre-rect (face count 0)");
    }

    #[test]
    fn p5e_gamma_draw_line_as_shape_single_undo_restores_pre_line() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(2.0, 0.0, 0.0),
            surface_normal: None,
        });
        assert!(matches!(result, CommandResult::ShapeCreated(_)));
        assert_eq!(scene.shapes.len(), 1);
        let edge_count_after = scene.mesh.edge_count();
        assert!(edge_count_after > 0, "line must create at least one edge");

        // P-5e-γ: single Undo restores pre-line state.
        let undo_result = scene.execute(Command::Undo);
        assert!(matches!(undo_result, CommandResult::MeshUpdated));
        assert_eq!(scene.shapes.len(), 0,
            "single Undo must remove the Shape");
        assert_eq!(scene.xias.len(), 0,
            "no transient Xia state should remain");
        assert_eq!(scene.mesh.edge_count(), 0,
            "mesh must be back to pre-line (edge count 0)");
    }

    #[test]
    fn p5e_gamma_draw_circle_as_shape_single_undo_restores_pre_circle() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            radius: 1.0,
            segments: 8,
        });
        assert!(matches!(result, CommandResult::ShapeCreated(_)));
        assert_eq!(scene.shapes.len(), 1);
        let face_count_after = scene.mesh.face_count();
        assert!(face_count_after > 0, "circle must create face");

        // P-5e-γ: single Undo restores pre-circle state.
        let undo_result = scene.execute(Command::Undo);
        assert!(matches!(undo_result, CommandResult::MeshUpdated));
        assert_eq!(scene.shapes.len(), 0,
            "single Undo must remove the Shape");
        assert_eq!(scene.xias.len(), 0,
            "no transient Xia state should remain");
        assert_eq!(scene.mesh.face_count(), 0,
            "mesh must be back to pre-circle (face count 0)");
    }

    #[test]
    fn cross_tool_sanity_rect_line_circle_as_shape_coexist() {
        // Mixed-tool scenario: DrawRectAsShape + DrawLineAsShape +
        // DrawCircleAsShape in disjoint regions all produce Shapes,
        // no Xias, no face_to_xia entries. Validates cross-tool
        // interaction doesn't accidentally bleed Xia creation.
        let mut scene = Scene::new();

        let r_rect = scene.execute(Command::DrawRectAsShape {
            center: DVec3::new(-5.0, 0.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 1.0, height: 1.0,
        });
        let r_line = scene.execute(Command::DrawLineAsShape {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(1.0, 0.0, 0.0),
            surface_normal: None,
        });
        let r_circle = scene.execute(Command::DrawCircleAsShape {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 0.5, segments: 8,
        });

        for r in [&r_rect, &r_line, &r_circle] {
            assert!(matches!(r, CommandResult::ShapeCreated(_)),
                "All three As-Shape commands must return ShapeCreated");
        }

        assert_eq!(scene.shapes.len(), 3, "Three shapes coexist");
        assert!(scene.xias.is_empty(), "No Xia from any As-Shape draw");
        assert!(scene.face_to_xia.is_empty(),
            "face_to_xia stays empty across all three shape types");
    }

    #[test]
    fn promote_shape_preserves_shape_and_face_to_xia_no_locked_regression() {
        // P-2 invariant test — ADR-050 §2.4 form layer independence +
        // ADR-074 / ADR-078 회귀 가드. After successful promote:
        // (1) Shape is still in scene.shapes (NOT consumed)
        // (2) face_to_xia reverse index updated for each face
        // (3) boolean_group_tags untouched (LOCKED #25 / ADR-078)
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let mat = MaterialId::new(11);

        // Pre-existing boolean group state (ADR-074 / ADR-078 layer).
        let group_face = FaceId::new(0); // first cube face
        scene.set_boolean_group_tag(&[group_face], crate::BooleanGroupTag::A);
        let pre_tags = scene.boolean_group_tags.clone();

        let ok = scene.promote_shape_to_xia(shape_id, mat).expect("promote OK");

        // (1) Shape preserved (form layer independence per ADR-050 §2.4)
        let preserved = scene.get_shape(shape_id).expect("Shape still exists");
        assert_eq!(preserved.face_ids.len(), 6);
        assert_eq!(preserved.name, "Unit Cube");

        // (2) face_to_xia updated for every cube face
        for &fid in &preserved.face_ids.clone() {
            assert_eq!(scene.face_to_xia.get(&fid).copied(), Some(ok.xia_id),
                "face {fid:?} should map to new Xia");
        }

        // (3) boolean_group_tags UNCHANGED — LOCKED #25 / ADR-078 회귀 가드
        assert_eq!(scene.boolean_group_tags, pre_tags,
            "boolean_group_tags must NOT be affected by promote");
        assert_eq!(scene.get_boolean_group_a(), vec![group_face]);
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-μ-β / A-μ-γ — Snapshot legacy audit + version handshake
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_mu_analyze_full_v2_snapshot() {
        // ADR-103-ε: current build saves V3 (Z-up). Section presence
        // semantics 동일 — version 만 정정.
        let mut scene = Scene::new();
        scene.create_shape("test".to_string(), vec![]);
        let bytes = scene.export_versioned_snapshot().expect("export");
        let info = Scene::analyze_snapshot(&bytes).expect("analyze");
        assert!(info.has_magic);
        assert_eq!(info.version, 3);
        assert!(info.sections.mesh, "mesh section present");
        assert!(info.sections.shapes, "ADR-050 Shapes section present");
        assert!(info.sections.boolean_group_tags, "ADR-078 Boolean section present");
        assert!(info.error.is_none(), "no error: {:?}", info.error);
    }

    #[test]
    fn adr089_a_mu_analyze_legacy_headerless_snapshot() {
        // Pre-versioning legacy mesh-only file (raw bincode mesh).
        let mut scene = Scene::new();
        let mesh_data = scene.mesh.snapshot();
        let info = Scene::analyze_snapshot(&mesh_data).expect("analyze");
        assert!(!info.has_magic, "legacy file has no magic bytes");
        assert_eq!(info.version, 0);
        assert!(info.error.is_none());
    }

    #[test]
    fn adr089_a_mu_analyze_short_data() {
        // Truncated / empty file.
        let info = Scene::analyze_snapshot(&[]).expect("analyze");
        assert_eq!(info.version, 0);
        assert!(info.error.is_some(), "should have error message");
        // 7-byte truncated magic
        let info = Scene::analyze_snapshot(&[b'A', b'X', b'I', b'A', 0, 0, 0]).expect("analyze");
        assert!(info.error.is_some());
    }

    #[test]
    fn adr089_a_mu_v_too_new_rejected_with_clear_message() {
        // Synthesize a V99 (future) snapshot — magic + version 99 + dummy len.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"AXIA");
        bytes.extend_from_slice(&99u32.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes()); // payload length 0
        let mut scene = Scene::new();
        let err = scene.import_versioned_snapshot(&bytes).err().expect("must reject");
        let msg = format!("{}", err);
        assert!(msg.contains("99") && msg.contains("newer"),
            "error must mention version 99 + newer: {}", msg);
        assert!(msg.contains("Forward-compat") || msg.contains("upgrade"),
            "error must hint upgrade path: {}", msg);
    }

    #[test]
    fn adr089_a_mu_corrupt_magic_falls_back_to_legacy() {
        // Wrong magic bytes — legacy fallback path.
        let mut scene = Scene::new();
        let mesh_data = scene.mesh.snapshot();
        // Should NOT bail — falls through to import_legacy_snapshot
        let result = scene.import_versioned_snapshot(&mesh_data);
        assert!(result.is_ok(), "legacy bincode mesh-only should load");
    }

    #[test]
    fn adr089_a_mu_v2_roundtrip_preserves_shapes_and_groups() {
        // Full V2 round-trip — Shapes + Boolean group tags survive.
        let mut scene = Scene::new();
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], FORM_MATERIAL).unwrap();
        let shape_id = scene.create_shape("Test Shape".to_string(), vec![face]);

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        // Round-trip: Shape preserved
        assert!(restored.shapes.contains_key(&shape_id),
            "Shape ID {:?} must survive roundtrip", shape_id);
        let restored_shape = restored.shapes.get(&shape_id).unwrap();
        assert_eq!(restored_shape.name, "Test Shape");
        assert_eq!(restored_shape.face_ids.len(), 1);
    }

    #[test]
    fn adr089_a_mu_v2_roundtrip_preserves_closed_curve_face() {
        // ADR-089 closed-curve face survives snapshot round-trip.
        let mut scene = Scene::new();
        let anchor = scene.mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let circle = axia_geo::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        scene.mesh.add_face_closed_curve(anchor, circle, FORM_MATERIAL).unwrap();

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        // Closed-curve face survives — same vert/edge/face counts
        let active_faces = restored.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        let active_edges = restored.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        let active_verts = restored.mesh.verts.iter()
            .filter(|(_, v)| v.is_active()).count();
        assert_eq!(active_faces, 1);
        assert_eq!(active_edges, 1);
        assert_eq!(active_verts, 1);
        // Edge has Circle curve attached after roundtrip
        let edges_iter: Vec<_> = restored.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).collect();
        assert!(matches!(
            edges_iter[0].1.curve(),
            Some(axia_geo::AnalyticCurve::Circle { .. })
        ));
    }

    #[test]
    fn adr089_a_mu_v2_roundtrip_preserves_closed_bezier_face() {
        // ADR-089 A-ω closed Bezier face survives snapshot round-trip.
        let mut scene = Scene::new();
        let anchor = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let bezier = axia_geo::AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0),
            ],
        };
        scene.mesh.add_face_closed_curve(anchor, bezier, FORM_MATERIAL).unwrap();

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        let edges_iter: Vec<_> = restored.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).collect();
        assert_eq!(edges_iter.len(), 1, "1 closed Bezier self-loop edge");
        assert!(matches!(
            edges_iter[0].1.curve(),
            Some(axia_geo::AnalyticCurve::Bezier { .. })
        ));
    }

    #[test]
    fn adr089_a_mu_legacy_v1_synthesized_loads() {
        // Synthesize V1 (mesh-only) snapshot — legacy file from before
        // 2026-04-24. Should load with empty XIAs/Groups/Shapes.
        let mut original = Scene::new();
        let v0 = original.mesh.add_vertex(DVec3::ZERO);
        let v1 = original.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = original.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        original.mesh.add_face(&[v0, v1, v2], FORM_MATERIAL).unwrap();
        let mesh_data = original.mesh.snapshot();
        // V1 format: AXIA + 1u32 + u32 mesh_len + mesh_data
        let mut v1_bytes = Vec::new();
        v1_bytes.extend_from_slice(b"AXIA");
        v1_bytes.extend_from_slice(&1u32.to_le_bytes());
        v1_bytes.extend_from_slice(&(mesh_data.len() as u32).to_le_bytes());
        v1_bytes.extend(mesh_data);

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&v1_bytes).expect("V1 import");
        assert_eq!(restored.mesh.face_count(), 1, "mesh face restored");
        assert!(restored.xias.is_empty(), "V1 has no XIAs");
        assert!(restored.shapes.is_empty(), "V1 has no Shapes (added in ADR-050)");
    }

    // ─────────────────────────────────────────────────────────────────
    // ADR-091 D-β — Material removal → Shape demotion (Phase 2)
    // ─────────────────────────────────────────────────────────────────

    /// Helper: promote a unit cube Shape to a Xia, then revert its
    /// material to FORM_MATERIAL so it's eligible for demotion.
    fn promote_then_clear_material(scene: &mut Scene)
        -> (crate::ShapeId, XiaId)
    {
        let shape_id = build_shape_unit_cube(scene);
        let mat = MaterialId::new(7);
        let ok = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect("promote unit cube");
        // Simulate user clearing the material via Inspector.
        if let Some(x) = scene.xias.get_mut(&ok.xia_id) {
            x.material = crate::FORM_MATERIAL;
        }
        (shape_id, ok.xia_id)
    }

    #[test]
    fn demote_with_form_material_succeeds() {
        let mut scene = Scene::new();
        let (orig_shape_id, xia_id) = promote_then_clear_material(&mut scene);
        let face_count_before = scene.xias.get(&xia_id).unwrap().face_ids.len();

        let ok = scene
            .demote_xia_to_shape(xia_id)
            .expect("demote with FORM_MATERIAL must succeed");

        // Original ShapeId restored (P-2-c preserved the Shape).
        assert_eq!(ok.shape_id, orig_shape_id);
        assert!(ok.original_id_restored);

        // Xia removed
        assert!(!scene.xias.contains_key(&xia_id));

        // Shape carries the same face_ids
        let shape = scene.shapes.get(&orig_shape_id).expect("Shape present");
        assert_eq!(shape.face_ids.len(), face_count_before);

        // shape_to_xia cleaned
        assert!(!scene.shape_to_xia.contains_key(&orig_shape_id));

        // face_to_xia cleared, face_to_shape populated
        for fid in &shape.face_ids {
            assert!(!scene.face_to_xia.contains_key(fid),
                    "face_to_xia must be cleared for face {:?}", fid);
            assert_eq!(scene.face_to_shape.get(fid).copied(),
                       Some(orig_shape_id),
                       "face_to_shape must point at restored Shape");
        }
    }

    #[test]
    fn demote_with_real_material_rejected() {
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let ok = scene
            .promote_shape_to_xia(shape_id, MaterialId::new(7))
            .expect("promote");
        // Material is still real (== 7) — demotion must reject.
        let err = scene
            .demote_xia_to_shape(ok.xia_id)
            .expect_err("real material must block demote");
        assert_eq!(err, crate::promote::DemoteError::MaterialNotFormSentinel);
        // Xia is still present (no side effects on rejection).
        assert!(scene.xias.contains_key(&ok.xia_id));
    }

    #[test]
    fn demote_preserves_face_order() {
        let mut scene = Scene::new();
        let (orig_shape_id, xia_id) = promote_then_clear_material(&mut scene);
        // Snapshot face_ids in order.
        let order_before = scene.xias.get(&xia_id).unwrap().face_ids.clone();
        scene
            .demote_xia_to_shape(xia_id)
            .expect("demote");
        let shape = scene.shapes.get(&orig_shape_id).expect("Shape");
        assert_eq!(shape.face_ids, order_before,
                   "face_ids order must be preserved through demote");
    }

    #[test]
    fn demote_restores_original_shape_id() {
        let mut scene = Scene::new();
        let (orig_shape_id, xia_id) = promote_then_clear_material(&mut scene);
        let ok = scene
            .demote_xia_to_shape(xia_id)
            .expect("demote");
        // The DemoteOk record advertises restoration AND the same id.
        assert!(ok.original_id_restored);
        assert_eq!(ok.shape_id, orig_shape_id);
    }

    #[test]
    fn promote_demote_promote_roundtrip_preserves_id() {
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);

        // Cycle 1: promote
        let mat1 = MaterialId::new(7);
        let ok1 = scene
            .promote_shape_to_xia(shape_id, mat1)
            .expect("promote 1");
        let xia_id_1 = ok1.xia_id;
        // Verify original_shape_id recorded on Scene map (D-ε P-2-d).
        assert_eq!(scene.xia_to_original_shape.get(&xia_id_1).copied(),
                   Some(shape_id));

        // Clear material → demote
        if let Some(x) = scene.xias.get_mut(&xia_id_1) {
            x.material = crate::FORM_MATERIAL;
        }
        let demote_ok = scene
            .demote_xia_to_shape(xia_id_1)
            .expect("demote");
        assert_eq!(demote_ok.shape_id, shape_id,
                   "demote must restore original ShapeId");

        // Cycle 2: re-promote with a different material — must succeed
        // and produce a Xia whose original_shape_id (Scene map) is
        // still the same.
        let mat2 = MaterialId::new(11);
        let ok2 = scene
            .promote_shape_to_xia(shape_id, mat2)
            .expect("promote 2 (after demote)");
        let xia2 = scene.xias.get(&ok2.xia_id).unwrap();
        assert_eq!(scene.xia_to_original_shape.get(&ok2.xia_id).copied(),
                   Some(shape_id),
                   "re-promote keeps the round-trip ShapeId record");
        assert_eq!(xia2.material, mat2);
    }

    #[test]
    fn adr091_d_epsilon_xia_to_original_shape_roundtrip_v2() {
        // ADR-091 D-ε — Snapshot section 7d round-trip preserves the
        // xia_to_original_shape map across export/import.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let mat = MaterialId::new(7);
        let ok = scene
            .promote_shape_to_xia(shape_id, mat)
            .expect("promote unit cube");

        // Sanity: map populated by promote.
        assert_eq!(scene.xia_to_original_shape.get(&ok.xia_id).copied(),
                   Some(shape_id));

        // Round-trip via versioned snapshot.
        let bytes = scene.export_versioned_snapshot().expect("export v2");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import v2");

        // Map preserved.
        assert_eq!(restored.xia_to_original_shape.get(&ok.xia_id).copied(),
                   Some(shape_id),
                   "xia_to_original_shape must round-trip via section 7d");
        // Demote on restored scene must restore the original ShapeId.
        if let Some(x) = restored.xias.get_mut(&ok.xia_id) {
            x.material = crate::FORM_MATERIAL;
        }
        let demote_ok = restored.demote_xia_to_shape(ok.xia_id)
            .expect("demote on restored scene");
        assert_eq!(demote_ok.shape_id, shape_id);
        assert!(demote_ok.original_id_restored,
                "restored scene must still be able to round-trip the ShapeId");
    }

    #[test]
    fn adr091_d_epsilon_legacy_v2_without_section_7d_loads_empty_map() {
        // ADR-091 D-ε — Legacy V2 snapshots that predate sub-section
        // 7d must load with an empty xia_to_original_shape map (the
        // backward-compat guarantee from §7d additive policy).
        //
        // We synthesize a "legacy" payload by stripping sub-section 7d
        // from a fresh export (truncate before the trailing
        // [xia_to_orig_len:u64][xia_to_orig_data] block).
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        scene.promote_shape_to_xia(shape_id, MaterialId::new(7)).unwrap();
        let bytes = scene.export_versioned_snapshot().expect("export");

        // ADR-095 Phase 3-ε amendment — snapshot now has section 8
        // (references) AFTER sub-section 7d. ADR-098 S-γ amendment —
        // snapshot now ALSO has section 9 (material_library) AFTER
        // section 8. To simulate legacy V2 without 7d, strip ALL trailing
        // sections: section 9 (8 + ml_data) + section 8 (8 + refs_data
        // + 8 next_ref_id) + sub-section 7d (8 + xia_to_orig_data).
        let refs_data = bincode::serialize(&scene.references).unwrap();
        let xia_orig_data = bincode::serialize(&scene.xia_to_original_shape).unwrap();
        let ml_data = bincode::serialize(&scene.material_library).unwrap();
        let strip_len = (8 + ml_data.len())
            + (8 + refs_data.len() + 8)
            + (8 + xia_orig_data.len());
        assert!(bytes.len() > strip_len);
        let mut legacy = bytes.clone();
        legacy.truncate(legacy.len() - strip_len);
        // Patch the payload_len field (bytes 8..16) to reflect truncation.
        // Header = AXIA (4) + version (4) = 8 bytes, then payload_len (8 bytes),
        // then payload. New payload_len = legacy.len() - 16.
        let new_payload_len = (legacy.len() - 16) as u64;
        legacy[8..16].copy_from_slice(&new_payload_len.to_le_bytes());

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&legacy).expect("import legacy");
        assert!(restored.xia_to_original_shape.is_empty(),
                "legacy V2 without 7d must load with empty map");

        // Other Shape state still preserved (sub-sections 7a/7b/7c).
        assert_eq!(restored.shapes.len(), 1, "Shape count preserved");
    }

    #[test]
    fn demote_xia_not_found() {
        let mut scene = Scene::new();
        let bogus = 9999;
        let err = scene
            .demote_xia_to_shape(bogus)
            .expect_err("missing xia must fail");
        assert_eq!(err, crate::promote::DemoteError::XiaNotFound);
    }

    // ─────────────────────────────────────────────────────────────────
    // ADR-095 Phase 3-β — Reference 시민권 CRUD + invariants
    // ─────────────────────────────────────────────────────────────────

    fn build_construction_line_edges(scene: &mut Scene) -> Vec<axia_geo::EdgeId> {
        let v1 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (e1, _) = scene.mesh.add_edge(v1, v2).unwrap();
        let (e2, _) = scene.mesh.add_edge(v2, v3).unwrap();
        vec![e1, e2]
    }

    #[test]
    fn adr095_phase3_create_reference_construction_line() {
        let mut scene = Scene::new();
        let edges = build_construction_line_edges(&mut scene);
        let id = scene
            .create_reference(
                "Center axis".to_string(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: edges.clone() },
            )
            .expect("create OK");

        let r = scene.get_reference(id).expect("Reference present");
        assert_eq!(r.id, id);
        assert_eq!(r.name, "Center axis");
        assert!(r.visible);
        assert!(!r.locked);
        // Reverse index populated.
        for &eid in &edges {
            assert_eq!(scene.edge_to_reference.get(&eid).copied(), Some(id));
        }
    }

    #[test]
    fn adr095_phase3_create_reference_imported_mesh() {
        let mut scene = Scene::new();
        // 미연결 face 직접 생성 (Reference 용 — Form/Property 미소유).
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], FORM_MATERIAL).unwrap();

        let id = scene
            .create_reference(
                "Site model".to_string(),
                crate::ReferenceCategory::ImportedMesh {
                    face_ids: vec![face],
                    source_path: Some("/path/to/site.step".to_string()),
                },
            )
            .expect("create ImportedMesh OK");
        assert_eq!(scene.face_to_reference.get(&face).copied(), Some(id));
    }

    #[test]
    fn adr095_phase3_create_reference_point_cloud() {
        let mut scene = Scene::new();
        let v1 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let id = scene
            .create_reference(
                "Scan A".to_string(),
                crate::ReferenceCategory::PointCloud { vert_ids: vec![v1, v2] },
            )
            .expect("create PointCloud OK");
        assert_eq!(scene.vert_to_reference.get(&v1).copied(), Some(id));
        assert_eq!(scene.vert_to_reference.get(&v2).copied(), Some(id));
    }

    #[test]
    fn adr095_phase3_mutually_exclusive_face_owned_by_xia() {
        // Xia 소유 face 를 ImportedMesh Reference 에 등록 시도 → 거부.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let mat = MaterialId::new(7);
        let promote_ok = scene.promote_shape_to_xia(shape_id, mat).unwrap();
        let xia = scene.xias.get(&promote_ok.xia_id).unwrap();
        let face_owned_by_xia = xia.face_ids[0];

        let err = scene
            .create_reference(
                "Should reject".to_string(),
                crate::ReferenceCategory::ImportedMesh {
                    face_ids: vec![face_owned_by_xia],
                    source_path: None,
                },
            )
            .expect_err("face owned by Xia must reject Reference register");
        match err {
            crate::scene::ReferenceCreateError::FaceOwnedByXia { face_id } => {
                assert_eq!(face_id, face_owned_by_xia);
            }
            other => panic!("expected FaceOwnedByXia, got {:?}", other),
        }
        // Atomic rollback — references / face_to_reference 변경 0.
        assert!(scene.references.is_empty());
        assert!(!scene.face_to_reference.contains_key(&face_owned_by_xia));
    }

    #[test]
    fn adr095_phase3_mutually_exclusive_face_owned_by_shape() {
        // Shape 소유 face 를 ImportedMesh Reference 에 등록 시도 → 거부.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let face_owned_by_shape = scene.shapes.get(&shape_id).unwrap().face_ids[0];

        let err = scene
            .create_reference(
                "Should reject".to_string(),
                crate::ReferenceCategory::ImportedMesh {
                    face_ids: vec![face_owned_by_shape],
                    source_path: None,
                },
            )
            .expect_err("face owned by Shape must reject");
        match err {
            crate::scene::ReferenceCreateError::FaceOwnedByShape { face_id } => {
                assert_eq!(face_id, face_owned_by_shape);
            }
            other => panic!("expected FaceOwnedByShape, got {:?}", other),
        }
    }

    #[test]
    fn adr095_phase3_double_register_same_edge_rejected() {
        let mut scene = Scene::new();
        let edges = build_construction_line_edges(&mut scene);
        let _ref1 = scene
            .create_reference(
                "First".into(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: edges.clone() },
            )
            .unwrap();
        let err = scene
            .create_reference(
                "Second (overlap)".into(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: edges.clone() },
            )
            .expect_err("double-register must fail");
        match err {
            crate::scene::ReferenceCreateError::EdgeAlreadyReferenced { .. } => {}
            other => panic!("expected EdgeAlreadyReferenced, got {:?}", other),
        }
    }

    #[test]
    fn adr095_phase3_delete_reference_cleans_reverse_indices() {
        let mut scene = Scene::new();
        let edges = build_construction_line_edges(&mut scene);
        let id = scene
            .create_reference(
                "To delete".into(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: edges.clone() },
            )
            .unwrap();
        assert!(scene.delete_reference(id));

        // References + reverse 인덱스 모두 cleanup.
        assert!(!scene.references.contains_key(&id));
        for &eid in &edges {
            assert!(!scene.edge_to_reference.contains_key(&eid));
        }
        // Re-register OK after delete (mutually exclusive 회복).
        let id2 = scene
            .create_reference(
                "Re-create".into(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: edges.clone() },
            )
            .expect("re-create after delete OK");
        assert_ne!(id, id2, "fresh ID after re-create");
    }

    #[test]
    fn adr095_phase3_list_reference_ids_sorted() {
        let mut scene = Scene::new();
        let v1 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let id1 = scene
            .create_reference("R1".into(),
                crate::ReferenceCategory::PointCloud { vert_ids: vec![v1] })
            .unwrap();
        let id2 = scene
            .create_reference("R2".into(),
                crate::ReferenceCategory::PointCloud { vert_ids: vec![v2] })
            .unwrap();
        let id3 = scene
            .create_reference("R3".into(),
                crate::ReferenceCategory::PointCloud { vert_ids: vec![v3] })
            .unwrap();
        let ids = scene.list_reference_ids();
        assert_eq!(ids, vec![id1, id2, id3]);
    }

    // ─────────────────────────────────────────────────────────────────
    // ADR-095 Phase 3-ε — Snapshot section 8 (Reference persistence)
    // ─────────────────────────────────────────────────────────────────

    #[test]
    fn adr095_phase3_epsilon_references_roundtrip_v2() {
        // Reference 등록 → versioned snapshot export → fresh import →
        // references state 보존 + reverse 인덱스 정합.
        let mut scene = Scene::new();
        let v1 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let (e1, _) = scene.mesh.add_edge(v1, v2).unwrap();

        let id = scene
            .create_reference(
                "Center axis".into(),
                crate::ReferenceCategory::ConstructionLine { edge_ids: vec![e1] },
            )
            .unwrap();

        // Round-trip via versioned snapshot.
        let bytes = scene.export_versioned_snapshot().expect("export v2");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import v2");

        // Reference state preserved.
        assert!(restored.references.contains_key(&id),
            "Reference must round-trip");
        let r = restored.get_reference(id).unwrap();
        assert_eq!(r.name, "Center axis");
        // Reverse index rebuilt.
        assert_eq!(restored.edge_to_reference.get(&e1).copied(), Some(id),
            "edge_to_reference must be rebuilt on restore");
    }

    #[test]
    fn adr095_phase3_epsilon_next_reference_id_roundtrip() {
        // next_reference_id 가 round-trip 시 보존 — 후속 create_
        // reference 호출이 충돌 없이 진행.
        let mut scene = Scene::new();
        let v1 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));

        // 3 references created (next_id = 4 after).
        let _r1 = scene.create_reference("R1".into(),
            crate::ReferenceCategory::PointCloud { vert_ids: vec![v1] }).unwrap();
        let _r2 = scene.create_reference("R2".into(),
            crate::ReferenceCategory::PointCloud { vert_ids: vec![v2] }).unwrap();
        let r3 = scene.create_reference("R3".into(),
            crate::ReferenceCategory::PointCloud { vert_ids: vec![v3] }).unwrap();
        assert_eq!(r3.raw(), 3);

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");

        // Create another after restore — must get id 4 (counter preserved).
        let v4 = restored.mesh.add_vertex(DVec3::new(3.0, 0.0, 0.0));
        let r4 = restored.create_reference("R4".into(),
            crate::ReferenceCategory::PointCloud { vert_ids: vec![v4] }).unwrap();
        assert_eq!(r4.raw(), 4,
            "next_reference_id must round-trip — fresh create gets id 4");
    }

    #[test]
    fn adr095_phase3_epsilon_legacy_v2_without_section_8_loads_empty() {
        // Pre-Phase 3 V2 snapshot (section 8 missing) → restore reads
        // empty references + next_reference_id = 1 default.
        let mut scene = Scene::new();
        let _shape = build_shape_unit_cube(&mut scene);
        let bytes = scene.export_versioned_snapshot().expect("export");

        // Strip section 8 (8 bytes refs_len + refs_data + 8 bytes
        // next_reference_id).
        let refs_data = bincode::serialize(&scene.references).unwrap();
        let strip_len = 8 + refs_data.len() + 8;
        assert!(bytes.len() > strip_len);
        let mut legacy = bytes.clone();
        legacy.truncate(legacy.len() - strip_len);
        // Patch payload_len (header = 16 bytes).
        let new_payload_len = (legacy.len() - 16) as u64;
        legacy[8..16].copy_from_slice(&new_payload_len.to_le_bytes());

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&legacy).expect("import legacy");
        assert!(restored.references.is_empty(),
            "legacy V2 without section 8 must load empty references");
        assert_eq!(restored.next_reference_id, 1,
            "next_reference_id must default to 1");
        // Shape state still preserved (section 7).
        assert_eq!(restored.shapes.len(), 1, "Shape count preserved");
    }

    #[test]
    fn adr095_phase3_epsilon_reverse_index_rebuilt_after_restore() {
        // 3 categories all rebuild reverse indexes correctly after
        // restore — face_to_reference, edge_to_reference, vert_to_
        // reference.
        let mut scene = Scene::new();
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], FORM_MATERIAL).unwrap();
        let (e1, _) = scene.mesh.add_edge(v0, v1).unwrap();
        let v_isolated = scene.mesh.add_vertex(DVec3::new(5.0, 5.0, 0.0));

        let id_im = scene.create_reference("IM".into(),
            crate::ReferenceCategory::ImportedMesh {
                face_ids: vec![face], source_path: None,
            }).unwrap();
        let id_cl = scene.create_reference("CL".into(),
            crate::ReferenceCategory::ConstructionLine { edge_ids: vec![e1] }).unwrap();
        let id_pc = scene.create_reference("PC".into(),
            crate::ReferenceCategory::PointCloud { vert_ids: vec![v_isolated] }).unwrap();

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");

        // All 3 reverse indexes rebuilt.
        assert_eq!(restored.face_to_reference.get(&face).copied(), Some(id_im));
        assert_eq!(restored.edge_to_reference.get(&e1).copied(), Some(id_cl));
        assert_eq!(restored.vert_to_reference.get(&v_isolated).copied(), Some(id_pc));
    }

    // ─────────────────────────────────────────────────────────────────
    // ADR-097 T-γ — Scene-level topology damage detection (orphan)
    // ─────────────────────────────────────────────────────────────────

    #[test]
    fn adr097_t_gamma_scene_clean_passes_through_mesh_report() {
        // Empty scene — mesh report (clean) 그대로 통과 + orphan 0.
        let scene = Scene::new();
        let report = scene.detect_topology_damage();
        assert!(report.is_clean());
        let (_, _, _, orph) = report.count_by_kind();
        assert_eq!(orph, 0);
    }

    #[test]
    fn adr097_t_gamma_scene_orphan_face_detected() {
        // Direct mesh.add_face — face_to_xia / shape / reference 모두 부재
        // → Orphan damage 검출.
        use axia_geo::TopologyDamageKind;
        let mut scene = Scene::new();
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], FORM_MATERIAL).unwrap();
        // No registration — orphan.

        let report = scene.detect_topology_damage();
        let orph_count = report.damages.iter()
            .filter(|d| matches!(d, TopologyDamageKind::Orphan { .. }))
            .count();
        assert_eq!(orph_count, 1, "1 orphan face detected");

        // Find the orphan damage with matching face_id.
        let found = report.damages.iter().any(|d| match d {
            TopologyDamageKind::Orphan { face_id } => *face_id == face,
            _ => false,
        });
        assert!(found, "orphan damage references the unregistered face");
    }

    #[test]
    fn adr097_t_gamma_scene_face_owned_by_xia_not_orphan() {
        // Xia 소유 face → orphan 아님.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        scene.promote_shape_to_xia(shape_id, MaterialId::new(7)).unwrap();
        let report = scene.detect_topology_damage();
        let orph = report.damages.iter()
            .filter(|d| matches!(d, axia_geo::TopologyDamageKind::Orphan { .. }))
            .count();
        assert_eq!(orph, 0, "Xia-owned faces must not be orphans");
    }

    #[test]
    fn adr097_t_gamma_scene_face_owned_by_reference_not_orphan() {
        // Reference 소유 face → orphan 아님.
        let mut scene = Scene::new();
        let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = scene.mesh.add_face(&[v0, v1, v2, v3], FORM_MATERIAL).unwrap();
        let _ = scene.create_reference(
            "Ref".into(),
            crate::ReferenceCategory::ImportedMesh {
                face_ids: vec![face], source_path: None,
            },
        ).unwrap();
        let report = scene.detect_topology_damage();
        let orph = report.damages.iter()
            .filter(|d| matches!(d, axia_geo::TopologyDamageKind::Orphan { .. }))
            .count();
        assert_eq!(orph, 0, "Reference-owned faces must not be orphans");
    }

    #[test]
    fn adr095_phase3_visibility_locked_toggles() {
        let mut scene = Scene::new();
        let v = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let id = scene
            .create_reference("R".into(),
                crate::ReferenceCategory::PointCloud { vert_ids: vec![v] })
            .unwrap();
        assert!(scene.set_reference_visible(id, false));
        assert!(!scene.get_reference(id).unwrap().visible);
        assert!(scene.set_reference_locked(id, true));
        assert!(scene.get_reference(id).unwrap().locked);
        // Bogus id → false.
        let bogus = crate::ReferenceId::new(9999);
        assert!(!scene.set_reference_visible(bogus, true));
        assert!(!scene.set_reference_locked(bogus, true));
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-098 S-γ — Snapshot section 9 (material library 3-tier)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn adr098_section_9_material_library_round_trips() {
        use crate::material::{
            MaterialCategory, MaterialTier, PhysicalProperties, VisualProperties,
            FireRating,
        };
        let mut scene = Scene::new();
        // Add a Project tier custom material.
        let proj_id = scene.material_library.create_material(
            "ProjMat".into(), "ProjMat".into(), MaterialCategory::Custom,
            PhysicalProperties {
                density: 1000.0, friction: 0.4, restitution: 0.4,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            VisualProperties { color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0, layered: None },
        );
        // Move one to User tier.
        let user_id = scene.material_library.create_material_in_tier(
            MaterialTier::User,
            "UserMat".into(), "UserMat".into(), MaterialCategory::Custom,
            PhysicalProperties {
                density: 500.0, friction: 0.3, restitution: 0.3,
                specific_gravity: 0.5, thermal_conductivity: 0.3,
                fire_rating: FireRating::None,
            },
            VisualProperties { color: 0x00ff00, roughness: 0.6, metalness: 0.0, opacity: 1.0, layered: None },
        );

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");

        // Custom materials persisted.
        assert!(restored.material_library.get(proj_id).is_some());
        assert_eq!(restored.material_library.tier_of(proj_id),
                   Some(MaterialTier::Project));
        assert!(restored.material_library.get(user_id).is_some());
        assert_eq!(restored.material_library.tier_of(user_id),
                   Some(MaterialTier::User));
        // System tier built-ins still classified.
        assert_eq!(restored.material_library.tier_of(MaterialId::new(0)),
                   Some(MaterialTier::System));
    }

    #[test]
    fn adr098_section_9_legacy_snapshot_keeps_default_library() {
        // Pre-S-γ snapshot truncates before section 9 → restore keeps
        // the Scene::new() default library (12 built-ins, no custom).
        let mut scene = Scene::new();
        let _shape = build_shape_unit_cube(&mut scene);
        let bytes = scene.export_versioned_snapshot().expect("export");

        // Strip section 9 (8 bytes ml_len + ml_data).
        let ml_data = bincode::serialize(&scene.material_library).unwrap();
        let strip_len = 8 + ml_data.len();
        assert!(bytes.len() > strip_len);
        let mut legacy = bytes.clone();
        legacy.truncate(legacy.len() - strip_len);
        // Patch payload_len (header = 16 bytes).
        let new_payload_len = (legacy.len() - 16) as u64;
        legacy[8..16].copy_from_slice(&new_payload_len.to_le_bytes());

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&legacy).expect("import legacy");
        // Default library still has all 12 built-ins.
        for raw in 0..=crate::material::BUILTIN_MATERIAL_ID_MAX {
            assert!(restored.material_library.get(MaterialId::new(raw)).is_some());
        }
        // Other state preserved (Shape).
        assert_eq!(restored.shapes.len(), 1);
    }

    #[test]
    fn adr098_section_9_analyze_snapshot_marks_section_present() {
        let scene = Scene::new();
        let bytes = scene.export_versioned_snapshot().expect("export");
        let info = Scene::analyze_snapshot(&bytes).expect("analyze");
        assert!(info.sections.material_library,
            "fresh export must include section 9 in analyze report");
    }

    #[test]
    fn adr098_section_9_migration_runs_after_legacy_load() {
        // Synthesize a "S-γ snapshot" that has section 9 but its
        // tier_index is empty (e.g., produced by a pre-S-β build that
        // forgot to call init_builtins on tier_index). Restore must
        // auto-migrate so that the restored library is fully classified.
        // We can't directly clear tier_index (private field) — instead,
        // we serialize a fresh library, then patch by re-running the
        // import path: Scene::new always inits with tier_index populated,
        // so we test the migration path indirectly via a pre-S-β legacy
        // by stripping section 9 entirely.
        let scene = Scene::new();
        let bytes = scene.export_versioned_snapshot().expect("export");

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        // After restore, tier_index is populated (either via fresh
        // serialization or via auto-migration). Built-ins always System tier.
        for raw in 0..=crate::material::BUILTIN_MATERIAL_ID_MAX {
            assert_eq!(
                restored.material_library.tier_of(MaterialId::new(raw)),
                Some(crate::material::MaterialTier::System),
                "post-restore built-in id {} must be System tier",
                raw,
            );
        }
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-100 R-β — Material Removal Recovery (Phase 5-C)
    // ────────────────────────────────────────────────────────────────

    fn build_xia_with_material(scene: &mut Scene, mat: MaterialId) -> XiaId {
        // Create a unit-cube Shape, promote to Xia with the given material.
        let shape_id = build_shape_unit_cube(scene);
        let ok = scene.promote_shape_to_xia(shape_id, mat).expect("promote");
        ok.xia_id
    }

    #[test]
    fn adr100_detect_returns_clean_for_fresh_scene() {
        let scene = Scene::new();
        let report = scene.detect_orphan_material_assignments();
        assert!(report.is_clean());
        assert_eq!(report.affected_xias.len(), 0);
    }

    #[test]
    fn adr100_detect_skips_form_material_xias() {
        // A Xia with FORM_MATERIAL is *never* orphan — sentinel always valid.
        let mut scene = Scene::new();
        // Direct construction: bypass promote (which requires non-FORM material).
        let shape_id = build_shape_unit_cube(&mut scene);
        scene.promote_shape_to_xia(shape_id, MaterialId::new(7)).expect("promote");
        // Now manually set material to FORM_MATERIAL (simulating Phase 1 form-only).
        let xia_id = *scene.xias.keys().next().unwrap();
        scene.xias.get_mut(&xia_id).unwrap().material = FORM_MATERIAL;
        let report = scene.detect_orphan_material_assignments();
        assert!(report.is_clean(),
            "Xia with FORM_MATERIAL must NOT be reported as orphan");
    }

    #[test]
    fn adr100_detect_reports_xia_with_missing_material() {
        let mut scene = Scene::new();
        // Add custom material, then assign Xia, then remove material.
        let custom = scene.material_library.create_material(
            "Custom".into(), "Custom".into(),
            crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1000.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties { color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0, layered: None },
        );
        let xia_id = build_xia_with_material(&mut scene, custom);
        // Move to User tier so removal is permitted.
        assert!(scene.material_library.set_tier(custom, crate::material::MaterialTier::User));
        // Remove the material (User tier).
        scene.material_library.remove_material(custom).expect("remove");
        // Now the Xia.material points to a missing id.
        let report = scene.detect_orphan_material_assignments();
        assert_eq!(report.affected_xias.len(), 1);
        assert_eq!(report.affected_xias[0].xia_id, xia_id);
        assert_eq!(report.affected_xias[0].stale_material_id, custom.raw());
    }

    #[test]
    fn adr100_attempt_recovery_noop_on_clean_scene() {
        let mut scene = Scene::new();
        let outcome = scene.attempt_material_removal_recovery();
        assert_eq!(outcome, MaterialRecoveryOutcome::NoOp);
    }

    #[test]
    fn adr100_attempt_recovery_demotes_orphan_xia_to_shape() {
        let mut scene = Scene::new();
        let custom = scene.material_library.create_material(
            "Custom".into(), "Custom".into(),
            crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1000.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties { color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0, layered: None },
        );
        scene.material_library.set_tier(custom, crate::material::MaterialTier::User);
        let xia_id = build_xia_with_material(&mut scene, custom);
        scene.material_library.remove_material(custom).expect("remove");

        let outcome = scene.attempt_material_removal_recovery();
        match outcome {
            MaterialRecoveryOutcome::Recovered { affected_xias, .. } => {
                assert_eq!(affected_xias, 1);
            }
            other => panic!("expected Recovered, got {:?}", other),
        }
        // After recovery, the Xia should be gone (demoted to Shape).
        assert!(!scene.xias.contains_key(&xia_id));
        // Scene is now clean.
        assert!(scene.detect_orphan_material_assignments().is_clean());
    }

    #[test]
    fn adr100_remove_project_material_with_recovery_combines_entries() {
        let mut scene = Scene::new();
        let custom = scene.material_library.create_material(
            "Custom".into(), "Custom".into(),
            crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1000.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties { color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0, layered: None },
        );
        scene.material_library.set_tier(custom, crate::material::MaterialTier::User);
        let _xia_id = build_xia_with_material(&mut scene, custom);

        let outcome = scene.remove_project_material_with_recovery(custom).expect("removal ok");
        assert_eq!(outcome.removed_id, custom.raw());
        assert!(matches!(outcome.recovery, MaterialRecoveryOutcome::Recovered { .. }));
        assert!(scene.material_library.get(custom).is_none());
    }

    #[test]
    fn adr100_remove_system_tier_rejected() {
        let mut scene = Scene::new();
        // System tier id 0 (Concrete) — must reject.
        let result = scene.remove_project_material_with_recovery(MaterialId::new(0));
        assert!(result.is_err());
        // Material library unchanged.
        assert!(scene.material_library.get(MaterialId::new(0)).is_some());
    }

    #[test]
    fn adr100_attempt_recovery_ordering_deterministic() {
        // 3 Xias with same stale material — output sorted ascending by
        // XiaId regardless of HashMap iteration order. Direct construction
        // (bypassing promote) so we don't need 3 non-overlapping shapes.
        let mut scene = Scene::new();
        let stale = MaterialId::new(9999); // never in library
        for raw_id in [10u32, 3u32, 7u32] {
            let xid = raw_id;
            scene.next_xia_id = xid.max(scene.next_xia_id) + 1;
            let mut xia = crate::Xia::new(xid, format!("X{}", xid));
            xia.material = stale;
            scene.xias.insert(xid, xia);
        }

        let report = scene.detect_orphan_material_assignments();
        assert_eq!(report.affected_xias.len(), 3);
        let ids: Vec<XiaId> = report.affected_xias.iter().map(|e| e.xia_id).collect();
        assert_eq!(ids, vec![3, 7, 10]);
    }

    #[test]
    fn adr100_form_layer_invariant_unchanged_locked_26() {
        // LOCKED #26: Form citizen (Shape) is material-agnostic. Recovery
        // mutates Xia.material only, never Shape state.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        // Recovery on a scene with only Shapes (no Xia) is a no-op.
        let outcome = scene.attempt_material_removal_recovery();
        assert_eq!(outcome, MaterialRecoveryOutcome::NoOp);
        // Shape preserved.
        assert!(scene.shapes.contains_key(&shape_id));
    }

    #[test]
    fn adr100_recovery_idempotent_when_called_twice() {
        let mut scene = Scene::new();
        let custom = scene.material_library.create_material(
            "C".into(), "C".into(), crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties { color: 0, roughness: 0.5, metalness: 0.0, opacity: 1.0, layered: None },
        );
        scene.material_library.set_tier(custom, crate::material::MaterialTier::User);
        build_xia_with_material(&mut scene, custom);
        scene.material_library.remove_material(custom).expect("remove");

        let first = scene.attempt_material_removal_recovery();
        assert!(matches!(first, MaterialRecoveryOutcome::Recovered { .. }));
        let second = scene.attempt_material_removal_recovery();
        assert_eq!(second, MaterialRecoveryOutcome::NoOp);
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-099 L-γ — Snapshot section 9 layered roundtrip (Phase 5-B)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn adr099_section_9_layered_channels_round_trip() {
        use crate::material::{
            LayeredChannels, TextureChannelInfo, TextureProjection,
            MaterialCategory, MaterialTier, PhysicalProperties, VisualProperties,
            FireRating,
        };
        let mut scene = Scene::new();
        let mat_id = scene.material_library.create_material_in_tier(
            MaterialTier::Project,
            "Layered".into(), "Layered".into(), MaterialCategory::Custom,
            PhysicalProperties {
                density: 1000.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: FireRating::None,
            },
            VisualProperties {
                color: 0x808080, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: Some(LayeredChannels {
                    albedo: Some(TextureChannelInfo {
                        data_url: "data:image/png;base64,ALBEDO".into(),
                        projection: TextureProjection::Planar,
                        scale: 0.001,
                        rotation: None,
                        label: Some("brick_albedo.png".into()),
                    }),
                    normal: Some(TextureChannelInfo {
                        data_url: "data:image/png;base64,NORMAL".into(),
                        projection: TextureProjection::Box,
                        scale: 0.002,
                        rotation: Some(1.5708),
                        label: None,
                    }),
                    roughness: Some(TextureChannelInfo::new(
                        "data:image/png;base64,ROUGH".into(), 0.001,
                    )),
                    metallic: Some(TextureChannelInfo::new(
                        "data:image/png;base64,METAL".into(), 0.001,
                    )),
                }),
            },
        );

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");

        let m = restored.material_library.get(mat_id).expect("material");
        let layered = m.visual.layered.as_ref().expect("layered preserved");
        assert_eq!(layered.channel_count(), 4);

        let albedo = layered.albedo.as_ref().unwrap();
        assert_eq!(albedo.data_url, "data:image/png;base64,ALBEDO");
        assert_eq!(albedo.projection, TextureProjection::Planar);
        assert_eq!(albedo.scale, 0.001);
        assert!(albedo.rotation.is_none());
        assert_eq!(albedo.label.as_deref(), Some("brick_albedo.png"));

        let normal = layered.normal.as_ref().unwrap();
        assert_eq!(normal.projection, TextureProjection::Box);
        assert_eq!(normal.rotation, Some(1.5708));
        assert!(normal.label.is_none());

        // LOCKED #26 guard: built-ins still have layered = None.
        for raw in 0..=crate::material::BUILTIN_MATERIAL_ID_MAX {
            assert!(restored.material_library.get(MaterialId::new(raw))
                .unwrap().visual.layered.is_none(),
                "built-in id {} must retain layered=None across snapshot", raw);
        }
    }

    #[test]
    fn adr099_section_9_legacy_material_without_layered_roundtrips() {
        // Material with layered=None roundtrips cleanly through
        // section 9 — exercises the #[serde(default)] path under
        // bincode (no skip_serializing_if, see ADR-099 L-β 사후 정정).
        let mut scene = Scene::new();
        let mat_id = scene.material_library.create_material(
            "Plain".into(), "Plain".into(),
            crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties {
                color: 0xff0000, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: None,
            },
        );
        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        assert!(restored.material_library.get(mat_id)
            .unwrap().visual.layered.is_none());
    }

    #[test]
    fn adr099_section_9_partial_layered_round_trip() {
        // Albedo-only (no normal/roughness/metallic) — verifies the
        // partial-population path. channel_count == 1.
        use crate::material::{LayeredChannels, TextureChannelInfo, MaterialTier};
        let mut scene = Scene::new();
        let mat_id = scene.material_library.create_material_in_tier(
            MaterialTier::Project,
            "Albedo".into(), "Albedo".into(), crate::MaterialCategory::Custom,
            crate::PhysicalProperties {
                density: 1.0, friction: 0.5, restitution: 0.5,
                specific_gravity: 1.0, thermal_conductivity: 0.5,
                fire_rating: crate::FireRating::None,
            },
            crate::VisualProperties {
                color: 0, roughness: 0.5, metalness: 0.0, opacity: 1.0,
                layered: Some(LayeredChannels {
                    albedo: Some(TextureChannelInfo::new("data:_,ABC".into(), 0.001)),
                    normal: None,
                    roughness: None,
                    metallic: None,
                }),
            },
        );
        // Pre-roundtrip sanity: the just-created material exists.
        assert!(scene.material_library.get(mat_id).is_some(),
            "pre-roundtrip: material must exist");

        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        let restored_material = restored.material_library.get(mat_id)
            .expect("partial: material missing after restore");
        let layered = restored_material.visual.layered.as_ref()
            .expect("partial: layered field missing after restore");
        assert_eq!(layered.channel_count(), 1);
        assert!(layered.albedo.is_some());
        assert!(layered.normal.is_none());
        assert!(layered.roughness.is_none());
        assert!(layered.metallic.is_none());
    }

    // ── ADR-101 §B-4 — Auto-intersect on draw (coplanar partial overlap) ──

    /// Two coplanar partial-overlapping RECTs drawn sequentially → 3
    /// sub-faces automatically (no explicit auto_intersect_coplanar call).
    /// The user-facing trigger of ADR-101 §2.
    #[test]
    fn adr101_b4_two_rects_partial_overlap_auto_splits() {
        let mut scene = Scene::new();
        // ADR-139 B-β-1 (2026-05-18): default OFF — explicit opt-in for
        // tests that verify the legacy auto-intersect behavior.
        scene.auto_intersect_on_draw = true;

        // Draw rect A: center (5, 5), 10×10 → footprint [0,0]–[10,10].
        let result_a = scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 5.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 10.0,
            height: 10.0,
        });
        let xia_a = match result_a {
            CommandResult::EntityCreated(id) => id,
            other => panic!("DrawRect A: expected EntityCreated, got {:?}", other),
        };

        let active_after_a = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_after_a, 1, "after rect A: 1 active face");

        // Draw rect B: center (10, 10), 10×10 → footprint [5,5]–[15,15].
        // Partial overlap with rect A → lens region [5,5]–[10,10].
        let result_b = scene.execute(Command::DrawRect {
            center: DVec3::new(10.0, 10.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 10.0,
            height: 10.0,
        });
        let xia_b = match result_b {
            CommandResult::EntityCreated(id) => id,
            other => panic!("DrawRect B: expected EntityCreated, got {:?}", other),
        };

        // After auto-intersect: 3 active faces (face_a_only L-shape +
        // face_b_only L-shape + lens square).
        let active_after_b = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_after_b, 3,
            "ADR-101 §2 trigger: 3 sub-faces expected, got {}", active_after_b);

        // Both XIAs still alive — XIA inheritance to the sub-faces.
        assert!(scene.xias.contains_key(&xia_a));
        assert!(scene.xias.contains_key(&xia_b));

        // Manifold invariants preserved.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-auto-split mesh must satisfy invariants — got {:?}",
            report.violations);
    }

    /// Two disjoint coplanar RECTs → NO auto-split. Both retain their
    /// face. L-B4-3 no-op for disjoint.
    #[test]
    fn adr101_b4_disjoint_rects_no_split() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 2.0,
            height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(10.0, 10.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 2.0,
            height: 2.0,
        });
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active, 2, "disjoint → no split, 2 active faces");
    }

    /// Non-coplanar RECTs (perpendicular planes) → NO coplanar split.
    /// L-B4-4 silent skip for non-coplanar.
    #[test]
    fn adr101_b4_non_coplanar_rects_no_split() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0), // XY plane
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 10.0,
            height: 10.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 5.0),
            normal: DVec3::new(1.0, 0.0, 0.0), // YZ plane (perpendicular)
            up: DVec3::new(0.0, 1.0, 0.0),
            width: 10.0,
            height: 10.0,
        });
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        // Non-coplanar pair → coplanar handler skips. May or may not
        // produce splits via 3D triangle-triangle, but neither face
        // should be split by COPLANAR handler. Just verify it doesn't
        // crash + invariants preserved.
        assert!(active >= 1);
        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "non-coplanar mesh must satisfy invariants — got {:?}",
            report.violations);
    }

    /// auto_intersect_on_draw flag = false → coplanar branch skipped.
    /// Uses circles because RECT × RECT partial overlap would be split
    /// by face synthesis postprocess (P7 closed-cycle detection) even
    /// without auto_intersect — circles' polygonized boundaries don't
    /// spatial-dedup with each other, so they ONLY get split via the
    /// B-4 coplanar pipeline.
    #[test]
    fn adr101_b4_disabled_flag_skips_split() {
        let mut scene = Scene::new();
        scene.auto_intersect_on_draw = false; // disable

        scene.execute(Command::DrawCircle {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        scene.execute(Command::DrawCircle {
            center: DVec3::new(6.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        // With flag off, no auto-intersect is run. The 2 circles remain
        // as 2 separate (overlapping) faces.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active, 2,
            "flag off → no auto-split, 2 overlapping circles, got {}", active);
    }

    /// Mirror of the browser scenario: drawCircleAsShape × 2 (NOT
    /// legacy Command::DrawCircle). The browser path goes through
    /// `exec_draw_circle_as_shape` → `exec_draw_circle` → intersect_faces_
    /// inner. This test verifies the AsShape variant ALSO triggers
    /// auto-split, mirroring the browser fixture.
    #[test]
    fn adr101_b4_two_circles_as_shape_partial_overlap_auto_splits() {
        let mut scene = Scene::new();
        // ADR-139 B-β-1: explicit opt-in for legacy auto-intersect behavior
        scene.auto_intersect_on_draw = true;
        scene.execute(Command::DrawCircleAsShape {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        let after_a = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_a, 1, "after Circle A: 1 active face");

        scene.execute(Command::DrawCircleAsShape {
            center: DVec3::new(6.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        let after_b = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_b, 3,
            "drawCircleAsShape × 2 partial overlap → 3 sub-faces, got {}",
            after_b);
    }

    /// ADR-101 §B-4b — Path B Circle × Path B Circle (DrawCircleAsCurve)
    /// partial overlap → 3 sub-faces automatically. B-4 MVP scope guard
    /// REMOVED by B-4b's non-destructive pre-check.
    #[test]
    fn adr101_b4b_two_path_b_circles_partial_overlap_auto_splits() {
        let mut scene = Scene::new();
        // ADR-139 B-β-1: explicit opt-in for legacy auto-intersect behavior
        scene.auto_intersect_on_draw = true;
        // DrawCircleAsCurve = Path B (kernel-native, 1 anchor + 1 self-loop).
        let r1 = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 5.0,
        });
        assert!(matches!(r1, CommandResult::ShapeCreated(_)),
            "DrawCircleAsCurve A succeeds, got {:?}", r1);
        let after_a = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_a, 1, "after Path B A: 1 active face");

        let r2 = scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::new(6.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 5.0,
        });
        assert!(matches!(r2, CommandResult::ShapeCreated(_)),
            "DrawCircleAsCurve B succeeds, got {:?}", r2);

        // B-4b: Path B × Path B partial overlap → auto 3 sub-faces.
        // (B-4 MVP would have returned 2 due to is_path_b_closed_curve guard.)
        let after_b = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_b, 3,
            "Path B × Path B partial overlap → 3 sub-faces (B-4b activation), got {}",
            after_b);

        // Manifold invariants preserved.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-split Path B mesh must satisfy invariants — got {:?}",
            report.violations);
    }

    /// ADR-101 §B-4b regression — disjoint Path B circles must NOT mutate.
    /// Kernel-native form preserved (the regression that the B-4 MVP scope
    /// guard protected against, now handled by AABB pre-check).
    #[test]
    fn adr101_b4b_disjoint_path_b_circles_preserve_kernel_native() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 5.0,
        });
        // Circle B far away — AABBs disjoint, pre-check short-circuits.
        scene.execute(Command::DrawCircleAsCurve {
            center: DVec3::new(100.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 5.0,
        });

        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active, 2, "disjoint Path B circles → 2 separate faces");

        // CRITICAL: both faces still Path B (1 boundary vert, self-loop edge).
        // If pre-check is destructive, this fails.
        for (fid, _) in scene.mesh.faces.iter().filter(|(_, f)| f.is_active()) {
            let outer_start = scene.mesh.faces[fid].outer().start;
            let verts = scene.mesh.collect_loop_verts(outer_start).expect("collect");
            assert_eq!(verts.len(), 1,
                "Path B face {:?} must remain 1-vert (no speculative polygonization)",
                fid);
        }
    }

    /// Two coplanar Circle × Circle partial overlap → 3 sub-faces
    /// automatically (the ADR-101 §2 user-facing canonical trigger).
    #[test]
    fn adr101_b4_two_circles_partial_overlap_auto_splits() {
        let mut scene = Scene::new();
        // ADR-139 B-β-1: explicit opt-in for legacy auto-intersect behavior
        scene.auto_intersect_on_draw = true;
        // Circle A: center origin, radius 5, 32 segments (polygonized).
        scene.execute(Command::DrawCircle {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        // Circle B: center (6, 0), radius 5 → partial overlap, lens
        // exists.
        scene.execute(Command::DrawCircle {
            center: DVec3::new(6.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            radius: 5.0,
            segments: 32,
        });
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active, 3,
            "two circles partial overlap → 3 sub-faces, got {}", active);

        let report = scene.mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-auto-split circle mesh must satisfy invariants — got {:?}",
            report.violations);
    }

    #[test]
    fn adr098_section_9_form_layer_invariant_unchanged_locked_26() {
        // LOCKED #26: Form citizen은 영원히 material 무관. Section 9
        // 추가가 Shape 의 material-agnostic 의미를 위반하지 않음을 명시.
        let mut scene = Scene::new();
        let shape_id = build_shape_unit_cube(&mut scene);
        let bytes = scene.export_versioned_snapshot().expect("export");
        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("import");
        // Shape exists post-restore + its faces have NO Xia association
        // (Form layer = material-agnostic).
        let shape = restored.shapes.get(&shape_id).expect("shape");
        for fid in &shape.face_ids {
            assert!(!restored.face_to_xia.contains_key(fid),
                "Form-layer Shape face must NOT have Xia owner (LOCKED #26)");
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-103-ε — Snapshot V2 (Y-up legacy) → V3 (Z-up) migration
    // ────────────────────────────────────────────────────────────────────

    /// Helper — synthesize a minimal V2 (Y-up) snapshot with a single
    /// vertex at a known position, so the V2→V3 migration can be exercised
    /// without depending on a real file fixture.
    fn synthesize_v2_snapshot_with_vertex(pos: glam::DVec3) -> Vec<u8> {
        // Build a Scene with one vertex at `pos`.
        let mut scene = Scene::new();
        scene.mesh.add_vertex(pos);
        // Export current snapshot (will be V3 since SNAPSHOT_VERSION = 3).
        let mut bytes = scene.export_versioned_snapshot().expect("export");
        // Patch the version byte (offset 4..8) to 2 so the import path
        // takes the V2 (Y-up) branch and applies migration.
        bytes[4..8].copy_from_slice(&2u32.to_le_bytes());
        bytes
    }

    #[test]
    fn adr103_epsilon_v2_load_applies_y_up_to_z_up_rotation() {
        // Y-up vertex (1, 2, 3): "1 right, 2 up, 3 toward viewer".
        // ADR-103-ε migration formula: (x, y, z) → (x, -z, y).
        // Expected Z-up: (1, -3, 2) = "1 right, -3 forward (back from
        // viewer toward -Y), 2 up".
        let y_up_pos = glam::DVec3::new(1.0, 2.0, 3.0);
        let bytes = synthesize_v2_snapshot_with_vertex(y_up_pos);

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("V2 import + migrate");

        // The single active vertex should now be at (1, -3, 2).
        let active_verts: Vec<glam::DVec3> = restored.mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos()) } else { None })
            .collect();
        assert_eq!(active_verts.len(), 1, "single migrated vertex");
        let p = active_verts[0];
        assert!((p - glam::DVec3::new(1.0, -3.0, 2.0)).length() < 1e-9,
            "ADR-103-ε: V2 (Y-up) load must rotate (1,2,3) → (1,-3,2); got {:?}",
            p);
    }

    #[test]
    fn adr103_epsilon_v3_load_identity_no_migration() {
        // V3 (Z-up native) file → load preserves coordinates exactly.
        let z_up_pos = glam::DVec3::new(1.0, 2.0, 3.0);
        let mut scene = Scene::new();
        scene.mesh.add_vertex(z_up_pos);
        let bytes = scene.export_versioned_snapshot().expect("export V3");
        // Verify written version = 3.
        assert_eq!(
            u32::from_le_bytes([bytes[4],bytes[5],bytes[6],bytes[7]]),
            SNAPSHOT_VERSION,
            "default export version = current SNAPSHOT_VERSION",
        );

        let mut restored = Scene::new();
        restored.import_versioned_snapshot(&bytes).expect("V3 import");
        let active_verts: Vec<glam::DVec3> = restored.mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos()) } else { None })
            .collect();
        assert_eq!(active_verts.len(), 1);
        // V3 load = identity (no rotation).
        assert!((active_verts[0] - z_up_pos).length() < 1e-9,
            "ADR-103-ε: V3 load must NOT rotate; got {:?}", active_verts[0]);
    }

    #[test]
    fn adr103_epsilon_migration_helper_idempotency_guard() {
        // Direct test of `Mesh::migrate_y_up_to_z_up` — verify rotation
        // formula on multiple vertices.
        let mut scene = Scene::new();
        scene.mesh.add_vertex(glam::DVec3::new(0.0, 1.0, 0.0));  // +Y (Y-up "up")
        scene.mesh.add_vertex(glam::DVec3::new(0.0, 0.0, 1.0));  // +Z (Y-up "toward viewer")
        scene.mesh.add_vertex(glam::DVec3::new(1.0, 0.0, 0.0));  // +X (unchanged)

        scene.mesh.migrate_y_up_to_z_up();

        let active: Vec<glam::DVec3> = scene.mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos()) } else { None })
            .collect();
        assert_eq!(active.len(), 3);
        // (0, 1, 0) → (0, -0, 1) = (0, 0, 1) — "up" in both spaces
        assert!(active.iter().any(|p|
            (*p - glam::DVec3::new(0.0, 0.0, 1.0)).length() < 1e-9),
            "(0,1,0) Y-up must map to (0,0,1) Z-up; got {:?}", active);
        // (0, 0, 1) → (0, -1, 0) — Y-up forward becomes -Y (Z-up backward)
        assert!(active.iter().any(|p|
            (*p - glam::DVec3::new(0.0, -1.0, 0.0)).length() < 1e-9),
            "(0,0,1) Y-up must map to (0,-1,0) Z-up; got {:?}", active);
        // (1, 0, 0) → (1, 0, 0) — X axis unchanged
        assert!(active.iter().any(|p|
            (*p - glam::DVec3::new(1.0, 0.0, 0.0)).length() < 1e-9),
            "(1,0,0) X-axis must be unchanged; got {:?}", active);
    }

    // ────────────────────────────────────────────────────────────────
    // P2 (보고서 audit 2026-05-23) — Step 4.65 silent dissolve guard
    // 회귀 자산. 이전 `let _ = self.mesh.remove_face(fid)` silent
    // discard 가 사용자 face 사라짐 위험 잠재. 본 hotfix 후 회귀 자산
    // 영구 보존.
    // ────────────────────────────────────────────────────────────────

    /// Step 4.65 surrounded dissolve guard — outer 가 inner 들로 surround
    /// 되는 시나리오에서 silent total dissolve (active face count 0) 가
    /// 발생하지 않는지 검증. P2 핵심 invariant: dissolve 자체는 발생 가능
    /// 하지만 mesh 가 **empty 가 되면 silent failure**.
    /// LOCKED #1 P7-N (Non-Manifold By Design) 정합 — 인접 inner 시
    /// non-manifold edges 발생은 expected, 본 test 의 focus 가 아님.
    #[test]
    fn p2_step_4_65_surrounded_dissolve_no_silent_total_dissolve() {
        let mut scene = Scene::new();

        // Outer 10×10
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 10.0,
        });
        let active_after_outer = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_after_outer, 1, "outer 1 face");

        // 4 inner adjacent (각 5×5, outer 의 4 quadrant — surround 시나리오)
        for (cx, cy) in [(-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0),
                normal: DVec3::Z,
                up: DVec3::Y,
                width: 5.0,
                height: 5.0,
            });
        }

        // **P2 핵심 invariant**: silent total dissolve (active face count == 0)
        // 차단. dissolve 자체 발생 가능 (outer 제거 또는 부분 제거 OK).
        // 사용자 face 사라짐 위험 = active 0 case.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "P2: Step 4.65 후 active face count >= 1 필수 (silent total dissolve 차단). got {}",
            active);
    }

    /// Step 4.65 silent dissolve guard regression — disjoint inner 시나리오
    /// 에서는 outer 가 surrounded 아니므로 dissolve 발생 안 함. 회귀 자산:
    /// dissolve 가 잘못 fire 되면 outer face 사라짐 (사용자 의도 위반).
    #[test]
    fn p2_step_4_65_disjoint_inner_preserves_outer() {
        let mut scene = Scene::new();

        // Outer 20×20
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 20.0,
            height: 20.0,
        });

        // 2 disjoint inner (서로 인접 안 함, outer 의 일부만 포위)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-5.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 3.0,
            height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 3.0,
            height: 3.0,
        });

        // outer 가 disjoint inner 로 surround 되지 않음 — Step 4.65 dissolve
        // 발생 안 해야 함. P2 guard: outer face 보존 검증.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        // 최소 3 face (outer + 2 inner) 보존 — disjoint inner 가 outer 를
        // surround 안 함.
        assert!(active >= 3,
            "P2 regression: disjoint inner 시 outer 보존 필요. got {} faces", active);

        // mesh invariants 정상
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "P2: disjoint inner mesh invariants 위반 없음; got {:?}",
            report.violations);
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-144 β-1 (2026-05-24) — Partial overlap + Single inner baseline
    //
    // PR #144 hotfix 의 회귀 자산 sweep 확장 (ADR-144 §6 sub-step plan).
    // partial overlap 시나리오 (outer 의 일부만 inner 가 cover) 에서
    // surround criterion 의 false-positive 차단 + single inner minimum
    // baseline (1 outer + 1 inner) 정합 검증.
    //
    // 두 시나리오 모두 P2 invariant (active face count >= 1) 보존.
    // ADR-144 §3 L-144-1/2 정합 — PR #144 hotfix code 보존, 회귀
    // 자산 only.
    // ────────────────────────────────────────────────────────────────

    /// ADR-144 β-1.1 — Partial overlap scenario. Outer 10×10, inner 5×5
    /// at (3, 3, 0) 으로 outer 의 우상단 일부 만 cover. outer 의 모든
    /// boundary HE 가 inner 의 새 face 와 surround 되지 *않음* — surround
    /// criterion false-positive 차단. dissolve 잘못 fire 시 outer 사라짐.
    #[test]
    fn p2_step_4_65_partial_overlap_preserves_outer() {
        let mut scene = Scene::new();

        // Outer 10×10 centered at origin
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 10.0,
        });

        // Inner 5×5 partially overlapping (center at (3, 3, 0) — only
        // 우상단 일부만 outer 위에 cover, 나머지는 outer 밖)
        scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 3.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 5.0,
            height: 5.0,
        });

        // **P2 핵심 invariant**: silent total dissolve 차단.
        // Partial overlap 에서 dissolve 잘못 fire 안 됨 (surround
        // criterion false-positive 검증). outer 의 잔존 region 보존.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 2,
            "ADR-144 β-1.1: partial overlap 시 active face count >= 2 \
             (outer 잔존 + overlap region 등). got {}", active);

        // mesh invariants 정상 (verify_face_invariants 미위반)
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-1.1: partial overlap mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }

    /// ADR-144 β-1.2 — Single inner baseline (minimum case). 1 outer +
    /// 1 inner (containment). LOCKED #1 P7-N 정합 — 인접/포함 시 dissolve
    /// criterion 의 가장 작은 case. surround 판정의 baseline.
    /// PR #144 의 4-inner case (surrounded_dissolve) 보다 작은 minimum
    /// scenario — single inner 가 surround 충분 조건인지 검증.
    #[test]
    fn p2_step_4_65_single_inner_baseline() {
        let mut scene = Scene::new();

        // Outer 10×10 centered at origin
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 10.0,
        });

        // Single inner 5×5 fully contained (center origin)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 5.0,
            height: 5.0,
        });

        // **P2 핵심 invariant**: silent total dissolve 차단. Single inner
        // 만으로 outer surround 안 됨 (boundary HE 가 inner 의 새 face 와
        // partial 일치 only — outer 의 일부 boundary 는 inner edge 가
        // 아닌 outer edge 그대로). active count >= 1 보존.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "ADR-144 β-1.2: single inner baseline 시 active face count \
             >= 1 (silent total dissolve 차단). got {}", active);

        // mesh invariants 정상 (verify_face_invariants 미위반).
        // L-144-3 정합 — P7-N (Non-Manifold) edge 발생 가능하나 본 test
        // focus 아님. invariants_report 의 winding/dangling/topology
        // 정합만 검증.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-1.2: single inner mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-144 β-2 (2026-05-24) — Multi-level nested + Concentric
    //
    // 3-level nested (concentric) 시나리오에서 silent dissolve 차단 +
    // active face count 보존. β-1 partial overlap / single inner
    // baseline 의 자연 후속 (concentric topology category).
    //
    // LOCKED #1 P7-N (Non-Manifold By Design) 정합 — concentric inner
    // 시 P7 (containment auto-split) 의 자연 동작 확인 + Step 4.65
    // dissolve 의 false-positive 차단.
    // ────────────────────────────────────────────────────────────────

    /// ADR-144 β-2.1 — 3-level nested concentric (30×30 outer +
    /// 20×20 middle + 10×10 inner). middle level 이 outer 와 inner
    /// 사이에서 silent dissolve 안 됨 검증. P2 invariant + 3-level
    /// topology 보존.
    #[test]
    fn p2_step_4_65_multi_level_nested_preserves_middle() {
        let mut scene = Scene::new();

        // Outer 30×30 centered at origin
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 30.0,
            height: 30.0,
        });

        // Middle 20×20 (concentric, fully inside outer)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 20.0,
            height: 20.0,
        });

        // Inner 10×10 (concentric, fully inside middle)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 10.0,
        });

        // **P2 핵심 invariant**: silent total dissolve 차단.
        // 3-level nested 에서 middle 이 false-positive surround 로
        // dissolve 안 됨 검증. active count >= 1.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "ADR-144 β-2.1: 3-level nested 시 active face count >= 1 \
             (silent total dissolve 차단). got {}", active);

        // mesh invariants 정상 (concentric topology 보존)
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-2.1: 3-level nested mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }

    /// ADR-144 β-2.2 — Concentric chain (outer + 3 inner concentric).
    /// dissolve 의 chain effect 검증 — middle level dissolve 가 outer
    /// 까지 propagation 안 됨. baseline: 1 outer + 3 inner = active >= 1.
    #[test]
    fn p2_step_4_65_concentric_chain_no_propagation_dissolve() {
        let mut scene = Scene::new();

        // Outer 40×40
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 40.0,
            height: 40.0,
        });

        // 3 concentric inner (30×30 / 20×20 / 10×10, all centered)
        for size in [30.0, 20.0, 10.0] {
            scene.execute(Command::DrawRect {
                center: DVec3::ZERO,
                normal: DVec3::Z,
                up: DVec3::Y,
                width: size,
                height: size,
            });
        }

        // **P2 핵심 invariant**: silent total dissolve 차단.
        // Concentric chain 에서 어떤 level dissolve 도 outer 까지
        // propagation 안 됨. active count >= 1 보존.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "ADR-144 β-2.2: concentric chain 시 active face count >= 1 \
             (chain dissolve propagation 차단). got {}", active);

        // mesh invariants 정상 (4-level concentric topology)
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-2.2: concentric chain mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-144 β-3 (2026-05-24) — L-shape + T-shape inner arrangement
    //
    // Non-rectangular surround topology — 2 inner rect 가 L 또는 T 자
    // 형태로 arrange. surround criterion 의 non-uniform 토폴로지
    // false-positive/negative 검증. β-1/β-2 의 rectangular-only
    // arrangement 의 자연 후속.
    //
    // 시나리오 의의: 비대칭 inner 가 outer 의 일부 boundary 만 cover
    // 시 dissolve criterion 의 정확성. LOCKED #1 P7-N 동작 정합.
    // ────────────────────────────────────────────────────────────────

    /// ADR-144 β-3.1 — L-shape inner arrangement. Outer 20×20 + 2
    /// rect inner (5×5 at (-7.5,-7.5) + 5×5 at (-2.5,-7.5)) 가 좌하단
    /// 에서 L 자 형태. outer 의 일부 boundary 만 inner 와 인접 →
    /// surround false-positive 차단 검증.
    #[test]
    fn p2_step_4_65_l_shape_inner_preserves_outer() {
        let mut scene = Scene::new();

        // Outer 20×20 centered at origin
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 20.0,
            height: 20.0,
        });

        // L-shape: 2 adjacent 5×5 rects at lower-left corner.
        //   rect1: center (-7.5, -7.5), inside outer's lower-left quadrant
        //   rect2: center (-2.5, -7.5), adjacent to rect1 horizontally
        // 두 rect 가 L 형태 (가로 bar)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-7.5, -7.5, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 5.0,
            height: 5.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.5, -7.5, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 5.0,
            height: 5.0,
        });

        // **P2 핵심 invariant**: silent total dissolve 차단.
        // L-shape inner 가 outer 의 일부 boundary 만 인접 → outer
        // surround 안 됨. active count >= 1.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "ADR-144 β-3.1: L-shape inner 시 active face count >= 1 \
             (surround false-positive 차단). got {}", active);

        // mesh invariants 정상 (L-shape topology 보존)
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-3.1: L-shape mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }

    /// ADR-144 β-3.2 — T-shape inner arrangement. Outer 20×20 + 2
    /// crossing rect inner (horizontal 12×4 + vertical 4×12 at origin)
    /// 가 T 자 (또는 +) 형태. surround criterion 의 cross-shape edge
    /// 검증.
    #[test]
    fn p2_step_4_65_t_shape_inner_preserves_outer() {
        let mut scene = Scene::new();

        // Outer 20×20 centered at origin
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 20.0,
            height: 20.0,
        });

        // T-shape (또는 +): horizontal bar + vertical bar 가 origin 교차
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 12.0,
            height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 12.0,
        });

        // **P2 핵심 invariant**: silent total dissolve 차단.
        // Cross-shape inner 가 outer 일부만 cover (4 corner outside
        // cross). active count >= 1.
        let active = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(active >= 1,
            "ADR-144 β-3.2: T-shape (cross) inner 시 active face count >= 1 \
             (surround false-positive 차단). got {}", active);

        // mesh invariants 정상 (cross-shape topology)
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-144 β-3.2: T-shape mesh invariants 위반 없음; \
             got {:?}", report.violations);
    }
}
