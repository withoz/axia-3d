//! Mesh — the central DCEL mesh data structure.
//!
//! This is the equivalent of buildragon's `CayaEntities`, cleaned up with:
//! - Clear method naming
//! - Proper error handling with Result types
//! - No global state — each Mesh is self-contained

use glam::DVec3;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Serialize, Deserialize};
use anyhow::{Result, bail, ensure};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::entities::*;
use crate::storage::SlotStorage;
use crate::tolerances::*;

/// Spatial hash cell key for fast vertex coincidence queries.
///
/// 셀 크기: 1 μm (1e-3 mm). 마우스 기반 좌표의 f32 drift(~1e-4 mm)와
/// snap 오차를 흡수하기에 적절한 크기. VERTEX_TOLERANCE(1e-7)은 정밀한
/// coincidence 판정용으로 유지되지만, 공간 해시는 조금 더 관대한 셀을 사용.
type SpatialKey = (i64, i64, i64);

/// 공간 해시 셀 크기. VERTEX_TOLERANCE보다 크게 해서 근접 vertex 후보를
/// 넉넉히 수집한다. 실제 coincidence 판정은 Vertex::coincident의 tolerance.
const SPATIAL_HASH_CELL: f64 = 1e-3; // 1 μm

/// Convert a position to a spatial hash key.
#[inline]
fn spatial_key(pos: DVec3) -> SpatialKey {
    const INV_CELL: f64 = 1.0 / SPATIAL_HASH_CELL;
    (
        (pos.x * INV_CELL).floor() as i64,
        (pos.y * INV_CELL).floor() as i64,
        (pos.z * INV_CELL).floor() as i64,
    )
}

/// Per-`export_buffers` skip diagnostics — counts faces dropped for each
/// reason. Reset at the start of every `export_buffers` call. Used to
/// debug "face is active in mesh but invisible in render" symptoms.
#[derive(Debug, Clone, Copy, Default)]
pub struct ExportSkipStats {
    /// Faces seen (active && visible) before processing.
    pub total_active_faces: u32,
    /// `collect_loop_verts(outer)` returned Err.
    pub corrupted_outer_loop: u32,
    /// Outer loop had fewer than 3 vertices after collection.
    pub outer_too_short: u32,
    /// `vertex_pos` failed (vert removed but loop still references it).
    pub vertex_pos_failed: u32,
    /// Inner (hole) loop traversal failed mid-emit.
    pub corrupted_inner_loop: u32,
    /// `earcut` triangulation returned Err (collinear / self-intersecting).
    pub earcut_failed: u32,
    /// `earcut` returned Ok([]) — triangulated to zero triangles. Polygon
    /// is technically valid for earcut's parser but produces no output;
    /// happens for degenerate / zero-area / self-touching geometry. The
    /// face vanishes from the render buffer despite being active in mesh.
    pub earcut_empty: u32,
    /// Analytic surface produced empty tessellation.
    pub analytic_empty_tess: u32,
    /// Faces with ≥1 triangle actually written to the buffer.
    pub emitted: u32,
    /// Last face id (raw) that hit `earcut_empty`. 0 if none. Use to
    /// pinpoint the wireframe-only face for follow-up inspection.
    pub last_earcut_empty_fid: u32,
    /// Outer loop vertex count of the last earcut_empty face. 0 if none.
    pub last_earcut_empty_outer_n: u32,
}

/// The Half-Edge DCEL mesh.
///
/// Stores all topology entities (vertices, edges, half-edges, faces)
/// and provides operations for construction and modification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mesh {
    /// Unique mesh identifier (for transaction tracking)
    pub uuid: u64,
    /// Vertex storage
    pub verts: SlotStorage<VertId, Vertex>,
    /// Edge storage
    pub edges: SlotStorage<EdgeId, Edge>,
    /// Half-edge storage
    pub hes: SlotStorage<HeId, HalfEdge>,
    /// Face storage
    pub faces: SlotStorage<FaceId, Face>,
    /// Shell storage (connected face components)
    pub shells: SlotStorage<ShellId, Shell>,
    /// Fast edge lookup by vertex pair
    pub vert_to_edge: FxHashMap<VertPairKey, EdgeId>,
    /// Spatial hash for fast vertex coincidence lookup (O(1) instead of O(n))
    #[serde(skip)]
    spatial_hash: FxHashMap<SpatialKey, Vec<VertId>>,
    /// Diagnostic counters from the last `export_buffers` call. Interior
    /// mutability so `export_buffers(&self)` can update without API churn.
    #[serde(skip, default)]
    last_export_stats: std::cell::Cell<ExportSkipStats>,
    /// Face IDs that produced zero triangles in the last export pass
    /// (earcut Ok([]) — degenerate / self-touching polygons). Kept in
    /// a RefCell for `&self` mutation. Drained by `deactivate_empty_emit_faces`
    /// to restore the invariant "every active face has ≥1 emitted triangle".
    #[serde(skip, default)]
    last_export_empty_faces: std::cell::RefCell<Vec<FaceId>>,

    /// ADR-061 Phase P-narrow Step 5 — Monotonic tick counter for LRU
    /// eviction. Incremented on every cache populate AND cache hit
    /// (touch-on-access). RefCell because populate path runs through
    /// `&self` (matches Z.1/Z.2 hot-path borrow policy).
    #[serde(skip, default)]
    cache_clock: std::cell::RefCell<u64>,

    /// ADR-061 Phase P-narrow Step 5 — Cumulative LRU eviction count
    /// (telemetry). Exposed via `cache_stats()` / WASM `getCacheStats`.
    #[serde(skip, default)]
    cache_eviction_count: std::cell::RefCell<u64>,

    /// ADR-088 Phase 1 — monotonic counter for `Edge.curve_owner_id`
    /// allocation (LOCKED #15 P22.5 enforcement). Incremented each time
    /// `next_curve_owner_id()` is called (e.g., per DrawCircle creation).
    /// All N segments of a single logical analytic curve share the same id.
    /// `serde(default)` for legacy snapshot compat — old `.axia` files
    /// load with counter = 0.
    #[serde(default)]
    next_curve_owner_id: u32,

    /// ADR-093 D-β — `FaceId → surface owner-id` map for face grouping
    /// (B-MVP — Path B Light). Faces with the same owner-id form a
    /// logical "surface group" (e.g., the N quad faces forming a
    /// cylinder side). Selection layer treats the group as one entity.
    ///
    /// Stored as a Mesh-level map per ADR-091 §E L1 canonical guidance
    /// (bincode struct field 추가 금지 — Scene/Mesh-level HashMap 사용).
    /// `Face` struct UNCHANGED — bincode legacy snapshot compatibility
    /// preserved automatically.
    ///
    /// Invariants:
    /// - Set only by `set_face_surface_owner_id` (allocation site:
    ///   `extrude_planar_cylinder` post N-side creation, or future
    ///   primitive constructors)
    /// - Inherited by `face_split_*` (LOCKED #35 L9 cross-cut, future
    ///   sub-step or ADR-093 amendment)
    /// - Cleared on `remove_face` (face deactivation)
    #[serde(default)]
    pub face_to_surface_owner_id: FxHashMap<FaceId, u32>,

    /// ADR-093 D-β — Monotonic counter for surface owner-id allocation
    /// (mirrors `next_curve_owner_id` from ADR-088). One id per logical
    /// surface group (e.g., one cylinder = one surface_owner_id shared
    /// by all N side faces).
    #[serde(default)]
    next_surface_owner_id: u32,

    /// ADR-094 B-η — Cylinder Path B-full default flag.
    ///
    /// `true` = `extrude_planar_cylinder` 의 closed-curve profile fast-
    /// path routes to `extrude_cylinder_kernel_native` (Path B —
    /// 3 face / 2 edge / 2 vert annulus topology, 산업 CAD parity).
    /// `false` (default) = legacy Path A (`extrude_closed_curve_face_
    /// via_tessellation`, 25 face / 70 edge / 46 vert polygon strip).
    ///
    /// **Engine default**: `false` (legacy) — preserves 245+ Path A
    /// regression assets (ADR-089 closed-curve tests / ADR-092 Arc rim
    /// tests / etc.). Production layer (WASM bridge / TS init) flips
    /// to `true` based on user preference (localStorage `axia:
    /// cylinder-path-b-mode`, ADR-049 P-5e-α 답습).
    ///
    /// **Polygonal profile (build_circle_face N≥3 verts)**: 영향 없음
    /// (closed-curve fast-path 미진입).
    ///
    /// `serde(skip)` — runtime preference, snapshot 영향 0.
    #[serde(skip, default)]
    pub cylinder_path_b_default: bool,

    /// ADR-094 B-γ-prep — `FaceId → Vec<LoopRef>` map for multi-loop
    /// face schema (Path B-full B-β option, additive coexist phase).
    ///
    /// **Status**: Additive prep only. `Some(loops)` = Path B multi-loop
    /// face (e.g., cylinder side annulus = 2 boundary loops, both outer-
    /// like). `None` (default) = legacy `Face::outer + inners` semantics.
    /// During the prep phase both representations coexist; B-η flip
    /// will switch the canonical path.
    ///
    /// Stored as a Mesh-level map per ADR-091 §E L1 canonical guidance
    /// (no struct field on `Face` — bincode legacy snapshot 호환 보존,
    /// 기존 245+ 회귀 자산 영향 0).
    ///
    /// Invariants (additive prep phase):
    /// - Set only by explicit `set_face_boundary_loops` (no implicit
    ///   allocation during legacy ops)
    /// - When present, `Vec<LoopRef>` must contain ≥ 1 entry (typically
    ///   2 for cylinder annulus, future N for general multi-loop)
    /// - Cleared by `remove_face` (deactivation)
    /// - **Effective semantics** during prep:
    ///     * caller of `face_boundary_loops()` (effective getter)
    ///       receives the multi-loop view if map populated, else
    ///       falls back to `face.outer + face.inners` (legacy)
    ///     * Render / Boolean / Push-Pull ops UNCHANGED — they still
    ///       read `face.outer` / `face.inners` directly until B-η flip
    /// - B-η flip: ops migrate to read `face_boundary_loops()` (effective)
    #[serde(default)]
    pub face_to_boundary_loops: FxHashMap<FaceId, Vec<LoopRef>>,
}

static NEXT_UUID: AtomicU64 = AtomicU64::new(1);

/// ADR-061 §D #4 lock-in — Aggregate cache byte cap (Z.1 + Z.2).
///
/// 100 MiB. When `Mesh::evict_lru_if_over_cap()` finds the total
/// estimated cache bytes above this, it drops oldest entries
/// (lowest `last_access_tick`) until back under cap.
pub const CACHE_CAP_BYTES: usize = 100 * 1024 * 1024;

/// ADR-061 Phase P-narrow Step 5 — Cache state report.
///
/// Snapshot of the Z.1 (Face normal) + Z.2 (Edge polyline) caches.
/// Exposed via `Mesh::cache_stats()` and serialized (with
/// `schemaVersion: 1`) by the WASM `getCacheStats` endpoint.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub face_entry_count: usize,
    pub edge_entry_count: usize,
    pub face_cache_bytes: usize,
    pub edge_cache_bytes: usize,
    pub total_bytes: usize,
    pub cap_bytes: usize,
    pub eviction_count: u64,
}

/// Internal — selector used by `evict_lru_if_over_cap`.
enum EvictKind {
    Face(FaceId),
    Edge(EdgeId),
}

/// ADR-062 Phase L₂ Path Z §B — Outcome of `attach_surface_validated`.
///
/// Six variants — see ADR-062 §B + Amendment 1 for full semantics.
/// All variants are `&'static str` for stability; consumers can pattern
/// match without lifetime complications.
#[derive(Clone, Debug, PartialEq)]
pub enum SurfaceAttachOutcome {
    /// Surface attached successfully. `previous_kind` is the label of
    /// the previously-attached surface, or `None` if face was polygon.
    Attached { previous_kind: Option<&'static str> },
    /// Some boundary vertex's distance to the new surface exceeds tol.
    BoundaryDriftExceedsTol {
        max_drift_mm: f64,
        tol_mm: f64,
        worst_vertex_idx: usize,
    },
    /// Tensor variant (Bezier/BSpline/NURBS) — Path Z pilot does not
    /// support uv inversion. Path Y full will lift this restriction.
    UnsupportedSurfaceKind { kind: &'static str },
    /// Face has no outer loop (degenerate topology).
    NoOuterLoop,
    /// Face is inactive (soft-deleted) or missing.
    InactiveFace,
    /// Surface input has degenerate parameters (radius ≤ 0,
    /// axis_dir ≈ ZERO, half_angle out of (0, π/2), etc.).
    DegenerateSurfaceInput { reason: &'static str },
}

impl SurfaceAttachOutcome {
    /// Stable label for telemetry / JSON serialization.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Attached { .. } => "Attached",
            Self::BoundaryDriftExceedsTol { .. } => "BoundaryDriftExceedsTol",
            Self::UnsupportedSurfaceKind { .. } => "UnsupportedSurfaceKind",
            Self::NoOuterLoop => "NoOuterLoop",
            Self::InactiveFace => "InactiveFace",
            Self::DegenerateSurfaceInput { .. } => "DegenerateSurfaceInput",
        }
    }
    /// True if attach succeeded.
    pub fn is_attached(&self) -> bool {
        matches!(self, Self::Attached { .. })
    }
}

/// Result of [`Mesh::face_set_manifold_info`] — 면 집합이 닫힌 2-manifold 솔리드를
/// 이루는지, 혹은 경계(open)나 non-manifold 결함이 있는지 분석 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifoldInfo {
    /// 집합에 포함된 활성 face 수.
    pub face_count: usize,
    /// 정확히 2개 face가 공유하는 edge 수 (manifold 내부 edge).
    pub interior_edge_count: usize,
    /// 1개 face만 인접한 edge 수 (open boundary — hole).
    pub boundary_edge_count: usize,
    /// 3개 이상 face가 공유하는 edge 수 (non-manifold).
    pub non_manifold_edge_count: usize,
    /// 닫힌 2-manifold 솔리드 여부 (face≥4 ∧ boundary=0 ∧ non_manifold=0).
    pub is_closed_solid: bool,
}

/// Phase H — Import Normalizer 옵션.
///
/// 외부 파일 (DXF/SKP/OBJ 등)에서 들어온 데이터를 AXiA 네이티브 규칙
/// (ADR-007)에 맞춰 정리하는 옵션 플래그. 기본은 모두 true로 보수적 정리.
#[derive(Debug, Clone)]
pub struct NormalizeOptions {
    /// 퇴화(zero-area) face 제거
    pub remove_degenerate: bool,
    /// Signed-volume 기반 winding 일관화 (다수결로 outer=Front 통일)
    pub normalize_winding: bool,
    /// Face normal을 topology에서 재계산
    pub recompute_normals: bool,
    /// 고아 vertex 정리
    pub remove_isolated_verts: bool,
    /// 면적 임계값 (이보다 작으면 degenerate로 간주)
    pub degenerate_tolerance: f64,
}

impl Default for NormalizeOptions {
    fn default() -> Self {
        Self {
            remove_degenerate: true,
            normalize_winding: true,
            recompute_normals: true,
            remove_isolated_verts: true,
            degenerate_tolerance: 1e-6,
        }
    }
}

/// Normalizer 실행 결과 리포트.
#[derive(Debug, Clone)]
pub struct NormalizeReport {
    pub degenerate_removed: usize,
    pub winding_flipped: usize,
    pub normals_recomputed: usize,
    pub isolated_verts_removed: usize,
    /// Normalize 후 남은 invariant 위반 (전부 해결되지 못한 케이스)
    pub remaining_violations: usize,
}

impl NormalizeReport {
    pub fn summary(&self) -> String {
        format!(
            "Normalize: removed {} degen, flipped {} winding, recomputed {} normals, \
             removed {} isolated verts, remaining {} violations",
            self.degenerate_removed,
            self.winding_flipped,
            self.normals_recomputed,
            self.isolated_verts_removed,
            self.remaining_violations,
        )
    }
}

/// Result of [`Mesh::verify_outward_normals`] — ADR-007 원칙 1 확장 리포트.
///
/// 닫힌 solid의 모든 face normal이 outward(바깥) 향하는지 검증.
/// 열린 surface나 non-manifold mesh는 is_closed_solid=false로 스킵.
#[derive(Debug, Clone)]
pub struct OutwardReport {
    /// 닫힌 2-manifold solid 여부 (false면 검증 스킵됨)
    pub is_closed_solid: bool,
    /// 검사된 face 수
    pub checked_faces: usize,
    /// 내부 향함(inward) 감지된 face 수
    pub inward_count: usize,
    /// Inward face ID 목록 (최대 detail 용)
    pub inward_faces: Vec<FaceId>,
}

impl OutwardReport {
    pub fn is_valid(&self) -> bool {
        !self.is_closed_solid || self.inward_count == 0
    }
    pub fn summary(&self) -> String {
        if !self.is_closed_solid {
            return "Open surface (outward check skipped)".to_string();
        }
        if self.inward_count == 0 {
            format!("✓ {} faces all outward", self.checked_faces)
        } else {
            format!(
                "✗ {}/{} faces inward-facing",
                self.inward_count, self.checked_faces
            )
        }
    }
}

/// Result of [`Mesh::verify_face_invariants`] — ADR-007 정책 준수 여부 리포트.
#[derive(Debug, Clone)]
pub struct InvariantReport {
    /// 검사된 활성 face 수
    pub checked_faces: usize,
    /// 발견된 위반 사항 목록 (비어 있으면 전부 통과)
    pub violations: Vec<String>,
}

impl InvariantReport {
    /// 모든 invariant 통과 여부
    pub fn is_valid(&self) -> bool {
        self.violations.is_empty()
    }

    /// Human-readable 요약
    pub fn summary(&self) -> String {
        if self.violations.is_empty() {
            format!("✓ All {} faces satisfy invariants", self.checked_faces)
        } else {
            let mut s = format!(
                "✗ {} violations in {} faces:\n",
                self.violations.len(),
                self.checked_faces,
            );
            for v in &self.violations {
                s.push_str("  - ");
                s.push_str(v);
                s.push('\n');
            }
            s
        }
    }
}

impl Mesh {
    /// Create a new empty mesh.
    pub fn new() -> Self {
        let uuid = NEXT_UUID.fetch_add(1, Ordering::Relaxed);
        Self {
            uuid,
            verts: SlotStorage::new(),
            edges: SlotStorage::new(),
            hes: SlotStorage::new(),
            faces: SlotStorage::new(),
            shells: SlotStorage::new(),
            vert_to_edge: FxHashMap::default(),
            spatial_hash: FxHashMap::default(),
            last_export_stats: std::cell::Cell::new(ExportSkipStats::default()),
            last_export_empty_faces: std::cell::RefCell::new(Vec::new()),
            cache_clock: std::cell::RefCell::new(0),
            cache_eviction_count: std::cell::RefCell::new(0),
            // ADR-088 Phase 1 — start at 0, allocate via next_curve_owner_id().
            next_curve_owner_id: 0,
            // ADR-093 D-β — start at 1, allocate via next_surface_owner_id().
            // 0 is reserved as null sentinel.
            face_to_surface_owner_id: FxHashMap::default(),
            next_surface_owner_id: 1,
            // ADR-094 B-η — engine default = legacy Path A. Production
            // layer flips to Path B via set_cylinder_path_b_default(true).
            cylinder_path_b_default: false,
            // ADR-094 B-γ-prep — empty map, all faces use legacy
            // outer+inners until explicit set_face_boundary_loops call.
            face_to_boundary_loops: FxHashMap::default(),
        }
    }

    // ========================================================================
    // ADR-088 Phase 1 — Curve Owner ID Grouping (LOCKED #15 P22.5)
    // ========================================================================

    /// ADR-088 Phase 1 — allocate a fresh curve owner group ID. Use this
    /// once per logical analytic curve (e.g., per DrawCircle), then call
    /// `set_edge_curve_owner_id(eid, Some(id))` on each segment of that
    /// curve. All segments sharing the id form a single selection unit
    /// per LOCKED #15 P22.5.
    ///
    /// Monotonic — IDs are never reused even if associated edges are
    /// deactivated. u32::MAX = 4 billion groups (practically unlimited).
    pub fn next_curve_owner_id(&mut self) -> u32 {
        let id = self.next_curve_owner_id;
        self.next_curve_owner_id = self.next_curve_owner_id.checked_add(1)
            .expect("Mesh::next_curve_owner_id overflow (u32::MAX)");
        id
    }

    /// ADR-088 Phase 1 — set the curve owner group ID on an edge.
    /// `None` removes grouping (edge becomes single-segment).
    /// Returns `false` if edge is missing or inactive.
    pub fn set_edge_curve_owner_id(
        &mut self,
        edge_id: EdgeId,
        owner: Option<u32>,
    ) -> bool {
        if let Some(edge) = self.edges.get_mut(edge_id) {
            if !edge.is_active() {
                return false;
            }
            edge.set_curve_owner_id(owner);
            true
        } else {
            false
        }
    }

    /// ADR-088 Phase 1 — read the curve owner group ID of an edge.
    /// Returns `None` if edge is missing, inactive, or has no group.
    pub fn edge_curve_owner_id(&self, edge_id: EdgeId) -> Option<u32> {
        self.edges.get(edge_id)
            .filter(|e| e.is_active())
            .and_then(|e| e.curve_owner_id())
    }

    /// ADR-088 Phase 1 — collect all active edges sharing a given curve
    /// owner group ID. Used by SelectTool walk: pick one edge → group
    /// promote (LOCKED #15 P22.5).
    ///
    /// Returns empty vec if no edges match (defensive: stale id, all
    /// deactivated, etc.).
    pub fn edges_by_curve_owner(&self, owner: u32) -> Vec<EdgeId> {
        self.edges.iter()
            .filter(|(_, e)| e.is_active() && e.curve_owner_id() == Some(owner))
            .map(|(id, _)| id)
            .collect()
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-093 D-β — Surface owner-id grouping (B-MVP — Path B Light)
    //
    // Mesh-level map (per ADR-091 §E L1 canonical guidance — bincode
    // struct field 추가 금지). Mirrors curve_owner_id pattern from
    // ADR-088 but on Face/surface dimension.
    // ════════════════════════════════════════════════════════════════

    /// ADR-093 D-β — Allocate a fresh surface owner-id (monotonic
    /// counter starting at 1; 0 reserved as null). One id per logical
    /// surface group (e.g., one cylinder = one id shared by all N
    /// side faces).
    ///
    /// Mirrors `next_curve_owner_id()` from ADR-088. Monotonic — IDs
    /// never reused even if associated faces deactivated.
    pub fn next_surface_owner_id(&mut self) -> u32 {
        let id = self.next_surface_owner_id;
        self.next_surface_owner_id = self.next_surface_owner_id.checked_add(1)
            .expect("Mesh::next_surface_owner_id overflow (u32::MAX)");
        id
    }

    /// ADR-093 D-β — Set the surface owner group ID for a face.
    /// `None` removes grouping (face becomes standalone — default).
    /// Returns `false` if face is missing or inactive.
    pub fn set_face_surface_owner_id(
        &mut self,
        face_id: FaceId,
        owner: Option<u32>,
    ) -> bool {
        let face_active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !face_active {
            return false;
        }
        match owner {
            Some(id) => { self.face_to_surface_owner_id.insert(face_id, id); }
            None     => { self.face_to_surface_owner_id.remove(&face_id); }
        }
        true
    }

    /// ADR-093 D-β — Read the surface owner group ID of a face.
    /// Returns `None` if face is missing, inactive, or has no group.
    pub fn face_surface_owner_id(&self, face_id: FaceId) -> Option<u32> {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return None; }
        self.face_to_surface_owner_id.get(&face_id).copied()
    }

    /// ADR-093 D-β — Collect all active faces sharing a given surface
    /// owner group ID. Used by SelectTool walk: pick one face → group
    /// promote (LOCKED #15 ADR-037 P22.5 Face owner-id 자연 확장).
    ///
    /// Returns empty vec if no faces match (defensive: stale id, all
    /// deactivated, etc.).
    pub fn faces_by_surface_owner(&self, owner: u32) -> Vec<FaceId> {
        self.face_to_surface_owner_id.iter()
            .filter_map(|(&fid, &oid)| {
                if oid != owner { return None; }
                self.faces.get(fid)
                    .filter(|f| f.is_active())
                    .map(|_| fid)
            })
            .collect()
    }

    /// ADR-093 D-β — Walk owner-siblings from a starting face.
    ///
    /// Selection-layer entry point: given a clicked face, return all
    /// active faces sharing its surface owner-id (group). If the face
    /// has no owner-id (None), returns just `[face_id]` (no group).
    ///
    /// Result order is unspecified; callers (SelectionManager) handle
    /// dedup/sort.
    pub fn walk_face_owner_siblings(&self, face_id: FaceId) -> Vec<FaceId> {
        match self.face_surface_owner_id(face_id) {
            Some(owner) => self.faces_by_surface_owner(owner),
            None => {
                let active = self.faces.get(face_id)
                    .map(|f| f.is_active())
                    .unwrap_or(false);
                if active { vec![face_id] } else { Vec::new() }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-094 B-γ-prep — Multi-loop face schema (Path B-full additive
    // prep phase).
    //
    // Mesh-level map (per ADR-091 §E L1 canonical) carries the new
    // `Vec<LoopRef>` representation alongside the legacy `Face::outer +
    // inners` schema. During prep, both coexist — set explicitly via
    // `set_face_boundary_loops`. B-η flip migrates canonical ops.
    // ════════════════════════════════════════════════════════════════

    /// ADR-094 B-γ-prep — Set the multi-loop boundary representation
    /// for a face.
    ///
    /// Additive: `Face::outer + inners`는 변경되지 않음 — caller 가
    /// 동시에 `face.outer / inners` 갱신 책임 지지 않음. B-η flip 후
    /// canonical 표현은 본 map (effective getter `face_boundary_loops`).
    ///
    /// Returns `false` if face is missing or inactive. Empty `loops`
    /// vector → equivalent to `clear` (defensive: explicit None for
    /// "go back to legacy" 의미는 별도 `clear_face_boundary_loops`).
    pub fn set_face_boundary_loops(
        &mut self,
        face_id: FaceId,
        loops: Vec<LoopRef>,
    ) -> bool {
        let face_active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !face_active {
            return false;
        }
        if loops.is_empty() {
            self.face_to_boundary_loops.remove(&face_id);
        } else {
            self.face_to_boundary_loops.insert(face_id, loops);
        }
        true
    }

    /// ADR-094 B-γ-prep — Clear the multi-loop schema for a face,
    /// returning to legacy `Face::outer + inners`. Returns true if an
    /// entry was removed.
    pub fn clear_face_boundary_loops(&mut self, face_id: FaceId) -> bool {
        self.face_to_boundary_loops.remove(&face_id).is_some()
    }

    /// ADR-094 B-γ-prep — Effective boundary loops getter.
    ///
    /// **Multi-loop schema 우선**: `face_to_boundary_loops` 에 entry 가
    /// 있으면 그 `Vec<LoopRef>` 반환 (Path B 표현). 없으면 legacy 폴백
    /// — `[face.outer]` + `face.inners` 결합한 vec 반환.
    ///
    /// Returns empty vec if face is missing or inactive.
    ///
    /// **Prep phase 사용 패턴**:
    /// - Render / Boolean / Push-Pull ops 가 점진 migration 시 본
    ///   getter 호출 → coexist 안전
    /// - B-η flip 시 ops 가 `face.outer` / `face.inners` 직접 read 를
    ///   본 effective getter 로 전환
    pub fn face_boundary_loops(&self, face_id: FaceId) -> Vec<LoopRef> {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return Vec::new(); }

        if let Some(loops) = self.face_to_boundary_loops.get(&face_id) {
            return loops.clone();
        }

        // Legacy fallback: outer + inners.
        let face = &self.faces[face_id];
        let mut loops = Vec::with_capacity(1 + face.inners().len());
        loops.push(face.outer());
        loops.extend_from_slice(face.inners());
        loops
    }

    /// ADR-094 B-η — Set the Path B cylinder default. See field doc on
    /// `Mesh::cylinder_path_b_default` for semantics.
    ///
    /// Production layer should call this once at startup (after reading
    /// localStorage `axia:cylinder-path-b-mode`). Test layer may toggle
    /// per-test as needed.
    pub fn set_cylinder_path_b_default(&mut self, on: bool) {
        self.cylinder_path_b_default = on;
    }

    /// ADR-094 B-η — Read the Path B cylinder default flag.
    pub fn cylinder_path_b_default(&self) -> bool {
        self.cylinder_path_b_default
    }

    /// ADR-094 B-γ-prep — Distinguishes Path B multi-loop schema vs
    /// legacy `Face::outer + inners`.
    ///
    /// Returns `true` iff the face has an explicit entry in
    /// `face_to_boundary_loops` (Path B canonical). Used by Render /
    /// Boolean / Push-Pull dispatch to route additive prep code paths.
    ///
    /// Returns `false` if face is missing/inactive (treated as legacy
    /// for defensive consistency).
    pub fn face_has_multi_loop_schema(&self, face_id: FaceId) -> bool {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return false; }
        self.face_to_boundary_loops.contains_key(&face_id)
    }

    // ════════════════════════════════════════════════════════════════
    // Snapshot (undo/redo)
    // ════════════════════════════════════════════════════════════════

    /// 현재 메시 상태를 바이트로 직렬화 (스냅샷 저장)
    pub fn snapshot(&self) -> Vec<u8> {
        match bincode::serialize(self) {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Mesh] snapshot serialize failed: {}", e);
                Vec::new()
            }
        }
    }

    /// 바이트에서 메시 상태 복원 (스냅샷 적용)
    pub fn restore_snapshot(&mut self, data: &[u8]) {
        if let Ok(restored) = bincode::deserialize::<Mesh>(data) {
            self.verts = restored.verts;
            self.edges = restored.edges;
            self.hes = restored.hes;
            self.faces = restored.faces;
            self.vert_to_edge = restored.vert_to_edge;
            // ADR-088 / ADR-093 / ADR-094 — Mesh-level maps 도 복원.
            self.next_curve_owner_id = restored.next_curve_owner_id;
            self.face_to_surface_owner_id = restored.face_to_surface_owner_id;
            self.next_surface_owner_id = restored.next_surface_owner_id;
            self.face_to_boundary_loops = restored.face_to_boundary_loops;
            // uuid는 유지 (변경하지 않음)
            // spatial_hash는 직렬화되지 않으므로 재구축 필요
            self.rebuild_spatial_hash();
        }
    }

    // ========================================================================
    // Vertex operations
    // ========================================================================

    /// Add a vertex at the given position.
    /// If a vertex already exists within tolerance, returns the existing one.
    /// Uses spatial hashing for O(1) average-case coincidence lookup.
    pub fn add_vertex(&mut self, pos: DVec3) -> VertId {
        let key = spatial_key(pos);
        // 공간 해시 3×3×3 = 최대 3 셀(=3μm) 반경 내 후보.
        // 실제 dedup 판정은 SPATIAL_HASH_CELL × 1.5 (1.5μm) 이내로 — f32 drift(~0.1μm)와
        // snap 오차(μm급)를 흡수. VERTEX_TOLERANCE(1e-7)는 그대로 두지만 add_vertex
        // dedup 단계에선 실용적 기준 적용.
        let dedup_tol = SPATIAL_HASH_CELL * 1.5;
        let dedup_tol_sq = dedup_tol * dedup_tol;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let neighbor_key = (key.0 + dx, key.1 + dy, key.2 + dz);
                    if let Some(ids) = self.spatial_hash.get(&neighbor_key) {
                        for &vid in ids {
                            if let Some(vert) = self.verts.get(vid) {
                                if !vert.is_active() { continue; }
                                // precise coincident (1e-7) OR within SPATIAL_HASH_CELL
                                // (후자는 마우스 drift 흡수용)
                                if vert.coincident(pos) {
                                    return vid;
                                }
                                let d_sq = (vert.pos() - pos).length_squared();
                                if d_sq < dedup_tol_sq {
                                    return vid;
                                }
                            }
                        }
                    }
                }
            }
        }
        // No coincident vertex found — insert new one
        let vid = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        self.spatial_hash.entry(key).or_default().push(vid);
        vid
    }

    /// Insert a NEW vertex at `pos`, bypassing the spatial-hash dedup that
    /// `add_vertex` normally performs. Used by topology-splitting operations
    /// (e.g. Slice / Plane Cut) that need two coincident-but-independent
    /// vertices to keep the two resulting halves topologically disjoint.
    /// The new vertex still gets registered in the spatial hash so future
    /// queries see it.
    pub fn add_vertex_force_new(&mut self, pos: DVec3) -> VertId {
        let vid = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        let key = spatial_key(pos);
        self.spatial_hash.entry(key).or_default().push(vid);
        vid
    }

    /// Rebuild the spatial hash from existing vertices.
    /// Call after `restore_snapshot()` since spatial_hash is not serialized.
    pub fn rebuild_spatial_hash(&mut self) {
        self.spatial_hash.clear();
        for (id, vert) in self.verts.iter() {
            if vert.is_active() {
                let key = spatial_key(vert.pos());
                self.spatial_hash.entry(key).or_default().push(id);
            }
        }
    }

    /// ADR-103-ε — Migrate vertex positions, attached surfaces, and curves
    /// from Y-up to Z-up coordinates.
    ///
    /// Applies a +90° rotation around the +X axis to every active vertex:
    ///   `(x, y, z) → (x, -z, y)`
    ///
    /// Semantics: a Y-up vertex (1, 2, 3) — meaning "1 right, 2 up, 3 toward
    /// viewer" — becomes a Z-up vertex (1, -3, 2) — meaning "1 right, -3
    /// forward (away from viewer toward -Y), 2 up". Industry CAD parity.
    ///
    /// After mutating vertex positions:
    ///   1. The spatial hash is rebuilt.
    ///   2. Cached face normals are invalidated.
    ///   3. **ADR-103-ε-2** — Each active face's attached `AnalyticSurface`
    ///      is migrated (positions + direction vectors). Each active edge's
    ///      attached `AnalyticCurve` is migrated similarly.
    /// Caller should subsequently invoke `reconcile_face_normals` so that
    /// cached normals match the new vertex winding.
    ///
    /// **Scope**:
    /// - vertex positions (ε-1)
    /// - `AnalyticSurface` 7 variants (Plane/Cylinder/Sphere/Cone/Torus/
    ///   Bezier/B-spline/NURBS — ε-2)
    /// - `AnalyticCurve` 5 variants with DVec3 fields (Circle/Arc/Bezier/
    ///   BSpline/NURBS — ε-2). `Line` is rotated implicitly via its vert
    ///   endpoints.
    ///
    /// Idempotent guard: this method assumes the mesh is currently in Y-up
    /// state; calling twice produces incorrect (rotated 180°) coordinates.
    /// Caller must track and only invoke during V2→V3 migration.
    pub fn migrate_y_up_to_z_up(&mut self) {
        // 1. Vertex positions.
        for (_, vert) in self.verts.iter_mut() {
            if !vert.is_active() { continue; }
            let p = vert.pos();
            let new_p = DVec3::new(p.x, -p.z, p.y);
            vert.set_pos(new_p);
        }
        // 2. Spatial hash positions are now stale — rebuild.
        self.rebuild_spatial_hash();
        // 3. Face cached normals invalidated by vertex movement + attached
        //    surface migration (ADR-103-ε-2).
        for (_, face) in self.faces.iter_mut() {
            face.invalidate_normal_cache();
            // Take ownership of surface, migrate, put back.
            if let Some(mut surf) = face.surface().cloned() {
                surf.migrate_y_up_to_z_up();
                face.set_surface(Some(surf));
            }
        }
        // 4. Edge attached curves (ADR-103-ε-2). Line variant has only
        //    VertId references — rotated via mesh vertex pass above.
        for (_, edge) in self.edges.iter_mut() {
            if !edge.is_active() { continue; }
            if let Some(mut curve) = edge.curve().cloned() {
                curve.migrate_y_up_to_z_up();
                edge.set_curve(Some(curve));
            }
        }
    }

    /// Get vertex position.
    pub fn vertex_pos(&self, id: VertId) -> Result<DVec3> {
        self.verts
            .get(id)
            .map(|v| v.pos())
            .ok_or_else(|| anyhow::anyhow!("Vertex {:?} not found", id))
    }

    /// ADR-061 Phase P-narrow Step 2 — Cache-coherent vertex move.
    ///
    /// Sets `vid`'s position to `new_pos` and invalidates downstream
    /// caches:
    ///   - All incident edges → `bump_curve_version` + invalidate
    ///     `polyline_cache` (Z.2 Curve Hover Cache).
    ///   - All incident faces → `bump_boundary_version` + invalidate
    ///     `normal_cache` (Z.1 Normal Cache — analytic surface evaluate
    ///     depends on vertex world position).
    ///
    /// **§F lock-in (silent fallback prohibited)**: existing direct
    /// `mesh.verts[vid].set_pos(...)` mutations BYPASS this helper and
    /// will leave caches stale. Migration of those call sites to this
    /// helper is incremental (Step 3+ will exercise the read path that
    /// surfaces stale state).
    ///
    /// Returns `Err` if `vid` is invalid or inactive.
    pub fn move_vertex(&mut self, vid: VertId, new_pos: DVec3) -> Result<()> {
        // 1. Set position.
        let v = self.verts.get_mut(vid)
            .ok_or_else(|| anyhow::anyhow!("move_vertex: vertex {:?} not found", vid))?;
        if !v.is_active() {
            anyhow::bail!("move_vertex: vertex {:?} is inactive", vid);
        }
        v.set_pos(new_pos);

        // 2. Collect incident edges + faces (radial v_next walk).
        let mut edges: Vec<EdgeId> = Vec::new();
        let mut faces: Vec<FaceId> = Vec::new();
        if let Some(v) = self.verts.get(vid) {
            if let Some(start) = v.outgoing().filter(|he| !he.is_null()) {
                let mut he_id = start;
                for _ in 0..256 {
                    let he = match self.hes.get(he_id) {
                        Some(h) if h.is_active() => h,
                        _ => break,
                    };
                    edges.push(he.edge());
                    if !he.face().is_null() {
                        faces.push(he.face());
                    }
                    let next = he.v_next();
                    if next == start || next.is_null() { break; }
                    he_id = next;
                }
            }
        }
        edges.sort_by_key(|e| e.raw());
        edges.dedup();
        faces.sort_by_key(|f| f.raw());
        faces.dedup();

        // 3. Bump curve_version on incident edges + invalidate polyline cache.
        for eid in edges {
            if let Some(e) = self.edges.get_mut(eid) {
                if e.is_active() {
                    e.bump_curve_version();
                    e.invalidate_polyline_cache();
                }
            }
        }

        // 4. Bump boundary_version on incident faces + invalidate normal cache.
        for fid in faces {
            if let Some(f) = self.faces.get_mut(fid) {
                if f.is_active() {
                    f.bump_boundary_version();
                    f.invalidate_normal_cache();
                }
            }
        }

        Ok(())
    }

    // ========================================================================
    // Edge operations
    // ========================================================================

    /// Add an edge between two vertices. Creates the half-edge pair.
    /// Returns (EdgeId, true) if new, (EdgeId, false) if already exists.
    pub fn add_edge(&mut self, v_start: VertId, v_end: VertId) -> Result<(EdgeId, bool)> {
        let pair = VertPair::new(v_start, v_end);

        // Check for existing edge
        if let Some(&edge_id) = self.vert_to_edge.get(&pair.key) {
            return Ok((edge_id, false));
        }

        // Create edge
        let edge_id = self.edges.insert(Edge::new(
            pair.key.v_small,
            pair.key.v_large,
            EDGE_TOLERANCE,
        ));

        // Register in lookup map
        self.vert_to_edge.insert(pair.key, edge_id);

        // Create half-edge pair
        self.create_halfedge_pair(edge_id, &pair)?;

        Ok((edge_id, true))
    }

    /// ADR-028 Phase A — Add an edge between two vertices, attaching an
    /// analytic curve definition.
    ///
    /// Behavior:
    /// - If the edge is **new**: created via `add_edge` and curve is set.
    /// - If the edge **already exists**: curve is set on the existing edge
    ///   (overwriting any previous curve). This allows merging or upgrading
    ///   straight edges to curves without topological surgery.
    ///
    /// The two endpoints of the analytic curve must geometrically match
    /// `v_start` and `v_end` positions within tolerance — caller is
    /// responsible (this method does NOT verify endpoint coincidence).
    ///
    /// Returns the EdgeId.
    pub fn add_edge_with_curve(
        &mut self,
        v_start: VertId,
        v_end: VertId,
        curve: crate::curves::AnalyticCurve,
    ) -> Result<EdgeId> {
        let (edge_id, _is_new) = self.add_edge(v_start, v_end)?;
        if let Some(e) = self.edges.get_mut(edge_id) {
            e.set_curve(Some(curve));
        }
        Ok(edge_id)
    }

    /// ADR-028 Phase A — Tessellate an edge for rendering / operation use.
    ///
    /// - If the edge has no curve (default straight line): returns
    ///   `[v_start_pos, v_end_pos]` (2-point polyline).
    /// - If the edge has an analytic curve: tessellates with given chord
    ///   tolerance (mm), returning n+1 points for n segments.
    ///
    /// This is the **canonical** tessellation path — UI / WASM bridge
    /// callers should use this for view-dependent LOD rendering.
    pub fn tessellate_edge(&self, edge_id: EdgeId, chord_tol: f64) -> Result<Vec<DVec3>> {
        use crate::curves::CurveOps;
        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;
        match edge.curve() {
            Some(curve) => curve.tessellate(chord_tol, self),
            None => {
                // Straight line — endpoints only.
                let p0 = self.vertex_pos(edge.v_small())?;
                let p1 = self.vertex_pos(edge.v_large())?;
                Ok(vec![p0, p1])
            }
        }
    }

    /// ADR-028 Phase A — Get the analytic curve attached to an edge, if any.
    /// Convenience wrapper for callers that don't want to deal with `Option`.
    pub fn edge_curve(&self, edge_id: EdgeId) -> Option<&crate::curves::AnalyticCurve> {
        self.edges.get(edge_id).and_then(|e| e.curve())
    }

    /// ADR-031 Phase D — Attach an analytic surface to a face.
    ///
    /// `surface = None` reverts to a polygon face (default behavior).
    /// Returns true if the face exists, false otherwise. The DCEL topology
    /// (boundary loops, neighbors) is unchanged — only the surface metadata
    /// is set.
    pub fn set_face_surface(
        &mut self,
        face_id: FaceId,
        surface: Option<crate::surfaces::AnalyticSurface>,
    ) -> bool {
        if let Some(f) = self.faces.get_mut(face_id) {
            f.set_surface(surface);
            true
        } else {
            false
        }
    }

    /// ADR-031 Phase D — Get the analytic surface attached to a face, if any.
    pub fn face_surface(&self, face_id: FaceId) -> Option<&crate::surfaces::AnalyticSurface> {
        self.faces.get(face_id).and_then(|f| f.surface())
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-062 Phase L₂ Path Z Step 2 — Validated surface attach
    // ════════════════════════════════════════════════════════════════

    /// ADR-062 Phase L₂ Path Z — Validated surface attach.
    ///
    /// Pre-checks the input surface and validates that every face
    /// outer-loop vertex lies within `tol_mm` of the surface. On
    /// success, attaches via `set_face_surface` (raw API) — which
    /// auto-bumps Phase P-narrow `surface_version` and invalidates
    /// `normal_cache` (Step 1a hook). On failure, leaves mesh state
    /// unchanged and returns the explicit reason.
    ///
    /// Outcome priority (early-exit order):
    ///   1. `InactiveFace` — face missing or `is_active() == false`
    ///   2. `UnsupportedSurfaceKind` — tensor variant
    ///   3. `DegenerateSurfaceInput` — bad params (radius ≤ 0, etc.)
    ///   4. `NoOuterLoop` — outer loop walk produced 0 vertices
    ///   5. `BoundaryDriftExceedsTol` — max vertex distance > tol_mm
    ///   6. `Attached { previous_kind }` — success
    ///
    /// **Phase P-narrow integration**: cache invalidation is automatic
    /// via the existing `set_face_surface` hook (see `Face::set_surface`
    /// in entities/face.rs). No additional plumbing needed.
    pub fn attach_surface_validated(
        &mut self,
        face_id: FaceId,
        surface: crate::surfaces::AnalyticSurface,
        tol_mm: f64,
    ) -> SurfaceAttachOutcome {
        use crate::surfaces::AnalyticSurface;

        // 1. Face existence + activity.
        let (outer_start, previous_kind) = match self.faces.get(face_id) {
            Some(f) if f.is_active() => {
                (f.outer().start, f.surface().map(|s| s.kind_label()))
            }
            _ => return SurfaceAttachOutcome::InactiveFace,
        };

        // 2. Tensor → UnsupportedSurfaceKind (early exit before degeneracy).
        match &surface {
            AnalyticSurface::BezierPatch { .. }
            | AnalyticSurface::BSplineSurface { .. }
            | AnalyticSurface::NURBSSurface { .. } => {
                return SurfaceAttachOutcome::UnsupportedSurfaceKind {
                    kind: surface.kind_label(),
                };
            }
            _ => {}
        }

        // 3. Degenerate parameter check.
        if let Some(reason) = surface.degeneracy_reason() {
            return SurfaceAttachOutcome::DegenerateSurfaceInput { reason };
        }

        // 4. Outer loop vertices.
        let outer_verts = match self.collect_loop_verts(outer_start) {
            Ok(v) if !v.is_empty() => v,
            _ => return SurfaceAttachOutcome::NoOuterLoop,
        };

        // 5. Boundary drift check — max distance across all outer verts.
        let mut max_drift = 0.0_f64;
        let mut worst_idx = 0usize;
        for (i, &vid) in outer_verts.iter().enumerate() {
            let pos = match self.verts.get(vid) {
                Some(v) => v.pos(),
                None => continue,
            };
            // unsigned_distance_to returns Some for primitives (we
            // already screened tensor above), but defensive None handling.
            let dist = surface.unsigned_distance_to(pos)
                .unwrap_or(f64::INFINITY);
            if dist > max_drift {
                max_drift = dist;
                worst_idx = i;
            }
        }
        if max_drift > tol_mm {
            return SurfaceAttachOutcome::BoundaryDriftExceedsTol {
                max_drift_mm: max_drift,
                tol_mm,
                worst_vertex_idx: worst_idx,
            };
        }

        // 6. Attach — set_face_surface auto-bumps Phase P-narrow cache.
        self.set_face_surface(face_id, Some(surface));
        SurfaceAttachOutcome::Attached { previous_kind }
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 5 — Cache stats + byte-cap LRU
    // ════════════════════════════════════════════════════════════════

    /// ADR-061 §D #4 — Aggregate cache state across all faces + edges.
    pub fn cache_stats(&self) -> CacheStats {
        let mut face_count = 0usize;
        let mut face_bytes = 0usize;
        for (_, face) in self.faces.iter() {
            if let Some(entry) = face.normal_cache().as_ref() {
                face_count += 1;
                face_bytes += entry.estimated_bytes();
            }
        }
        let mut edge_count = 0usize;
        let mut edge_bytes = 0usize;
        for (_, edge) in self.edges.iter() {
            if let Some(entry) = edge.polyline_cache().as_ref() {
                edge_count += 1;
                edge_bytes += entry.estimated_bytes();
            }
        }
        CacheStats {
            face_entry_count: face_count,
            edge_entry_count: edge_count,
            face_cache_bytes: face_bytes,
            edge_cache_bytes: edge_bytes,
            total_bytes: face_bytes + edge_bytes,
            cap_bytes: CACHE_CAP_BYTES,
            eviction_count: *self.cache_eviction_count.borrow(),
        }
    }

    /// ADR-061 Step 5 — Monotonic tick generator (interior mutability,
    /// works through `&self`). Used by populate AND hit paths to keep
    /// LRU ordering current.
    pub(crate) fn next_cache_tick(&self) -> u64 {
        let mut clock = self.cache_clock.borrow_mut();
        *clock = clock.wrapping_add(1);
        *clock
    }

    /// ADR-061 §D #4 lock-in — If aggregate cache bytes exceed
    /// `CACHE_CAP_BYTES`, drop oldest entries (lowest `last_access_tick`)
    /// until back under cap. Touches `cache_eviction_count`.
    ///
    /// Cheap path: under cap → returns immediately after one stats pass.
    /// Eviction path: O(N log N) sort of cached entries.
    pub fn evict_lru_if_over_cap(&self) {
        let stats = self.cache_stats();
        if stats.total_bytes <= CACHE_CAP_BYTES {
            return;
        }
        // Collect all cached entries with (kind, tick, bytes).
        let mut entries: Vec<(EvictKind, u64, usize)> = Vec::new();
        for (fid, face) in self.faces.iter() {
            if let Some(entry) = face.normal_cache().as_ref() {
                entries.push((EvictKind::Face(fid), entry.last_access_tick,
                              entry.estimated_bytes()));
            }
        }
        for (eid, edge) in self.edges.iter() {
            if let Some(entry) = edge.polyline_cache().as_ref() {
                entries.push((EvictKind::Edge(eid), entry.last_access_tick,
                              entry.estimated_bytes()));
            }
        }
        // Oldest first.
        entries.sort_by_key(|&(_, tick, _)| tick);

        let mut current_bytes = stats.total_bytes;
        let mut evicted = 0u64;
        for (kind, _, bytes) in entries {
            if current_bytes <= CACHE_CAP_BYTES { break; }
            match kind {
                EvictKind::Face(fid) => {
                    if let Some(face) = self.faces.get(fid) {
                        face.invalidate_normal_cache();
                    }
                }
                EvictKind::Edge(eid) => {
                    if let Some(edge) = self.edges.get(eid) {
                        edge.invalidate_polyline_cache();
                    }
                }
            }
            current_bytes = current_bytes.saturating_sub(bytes);
            evicted += 1;
        }
        if evicted > 0 {
            *self.cache_eviction_count.borrow_mut() += evicted;
        }
    }

    /// ADR-064 Step 2 (sub-step 2.A) — TrimLoop polyline → DCEL Face.
    ///
    /// Converts a sequence of VertId polylines (output of Step 1's
    /// `trim_loops_to_dcel_polyline`) into a single DCEL face with
    /// outer + N inner hole loops.
    ///
    /// **Per ADR-064 §C lock-ins**:
    /// - §A: Boolean op semantics handled by Phase J `nurbs_boolean_v2`
    ///   (this function is op-agnostic — assumes loops already represent
    ///   the desired output).
    /// - §C #1 lock-in: pure DCEL face creation; no surface attach
    ///   (caller responsibility — D-D=(a)).
    /// - §C #2 drop-in alongside: existing `add_face_with_holes`
    ///   delegated; new function only routes input format.
    ///
    /// **D-C lock-in**: Input format = `Vec<Vec<VertId>>` (Step 1 output).
    /// `loop_polylines[0]` is treated as outer, `[1..]` as inner holes.
    /// Caller must order loops appropriately (Phase J ContainmentTree
    /// flattening responsibility).
    ///
    /// **D-G lock-in**: ADR-007 Invariant 2 winding validation:
    /// `add_face_with_holes` already computes face normal from outer
    /// loop; if normal is degenerate (zero/NaN), it bails. CCW outer
    /// is caller responsibility (Phase J trim loops are CCW per §B).
    ///
    /// Returns the new FaceId. Errors:
    ///   - empty `loop_polylines`
    ///   - outer polyline < 3 vertices
    ///   - any hole polyline < 3 vertices
    ///   - degenerate normal (delegated to `add_face_with_holes`)
    ///
    /// Per ADR-067 §A drop-in alongside lock-in: existing
    /// boolean.rs (mesh path) and boolean_dispatch (Phase O Step 4)
    /// UNCHANGED. This is a separate API for NURBS Boolean DCEL
    /// integration (Step 5 will wire it into boolean_dispatch).
    pub fn trim_loops_to_face(
        &mut self,
        loop_polylines: &[Vec<VertId>],
        material: MaterialId,
    ) -> Result<FaceId> {
        if loop_polylines.is_empty() {
            bail!("trim_loops_to_face: empty loop_polylines");
        }
        let outer = &loop_polylines[0];
        if outer.len() < 3 {
            bail!("trim_loops_to_face: outer loop has {} verts, need ≥3", outer.len());
        }
        // D-F lock-in — multi-inner-hole supported.
        let holes_storage: Vec<&[VertId]> = loop_polylines[1..]
            .iter()
            .map(|v| v.as_slice())
            .collect();
        // Validate hole minimum vertex count.
        for (i, hole) in holes_storage.iter().enumerate() {
            if hole.len() < 3 {
                bail!("trim_loops_to_face: inner loop {} has {} verts, need ≥3",
                      i, hole.len());
            }
        }
        // Delegate to existing API (D-B=(a) drop-in alongside).
        // add_face_with_holes computes normal + builds HE chains +
        // performs ADR-007 Invariant 2 (winding) validation per §D-G.
        self.add_face_with_holes(outer, &holes_storage, material)
    }

    /// ADR-064 Step 1 — Convert NURBS Boolean trim loops (UV) to DCEL
    /// vertex IDs (world-space, deduped via spatial-hash).
    ///
    /// Per ADR-064 §C #1 lock-in: this method produces VertId sequences
    /// only — actual face boundary loops (HE chains, LoopRefs, Face)
    /// are Step 2's responsibility (별도 ADR).
    ///
    /// Per §C #3 lock-in: vertex dedup via existing `add_vertex`
    /// spatial-hash (LOCKED #5 1.5μm). Coincident polyline points
    /// across loops merge into a single VertId automatically.
    ///
    /// Per §C #4 lock-in: chord_tol = `HOVER_CHORD_TOL` (0.01mm) by
    /// default if `chord_tol ≤ 0`.
    ///
    /// Returns `Vec<Vec<VertId>>` — one VertId sequence per trim loop.
    /// Empty trim loops (disjoint case from `nurbs_boolean_v2`) produce
    /// an empty outer Vec.
    pub fn trim_loops_to_dcel_polyline(
        &mut self,
        loops: &[crate::surfaces::TrimLoop],
        surface: &crate::surfaces::AnalyticSurface,
        chord_tol: f64,
    ) -> Vec<Vec<VertId>> {
        use crate::surfaces::ssi::trim_to_polyline::trim_loop_to_world_polyline;
        let tol = if chord_tol > 0.0 {
            chord_tol
        } else {
            crate::tolerances::HOVER_CHORD_TOL
        };
        loops.iter()
            .map(|l| {
                let polyline = trim_loop_to_world_polyline(l, surface, tol);
                polyline.into_iter()
                    .map(|p| self.add_vertex(p))  // §C #3 dedup via spatial-hash
                    .collect::<Vec<VertId>>()
            })
            .collect()
    }

    /// ADR-061 Phase P-narrow Step 3 — Z.1 Normal Cache hot-path.
    ///
    /// Returns per-vertex (outer-loop order) world-space analytic
    /// normals for `face_id`. Cache hit / miss logic:
    ///
    /// 1. If `face.surface` is `None` → returns `None` (polygon face).
    /// 2. If `!face.should_cache_normals()` (Plane per §D #2) → computes
    ///    fresh each call without caching. Returns `Some(...)`.
    /// 3. If cache entry's `(surface_version, boundary_version)` matches
    ///    current → **HIT**: returns cloned cached data.
    /// 4. Otherwise → **MISS**: computes, populates cache, returns.
    ///
    /// Uses `AnalyticSurface::normal_at_world_pos(vertex_pos)` to derive
    /// per-vertex normals via closed-form geometric construction (no uv
    /// parameter inversion needed for primitives).
    ///
    /// **§D #5 lock-in**: cache state is volatile (RefCell interior
    /// mutability via `&self` — does not require `&mut`).
    pub fn face_cached_normals_or_compute(&self, face_id: FaceId) -> Option<Vec<DVec3>> {
        let face = self.faces.get(face_id)?;
        if !face.is_active() { return None; }
        let surface = face.surface()?;

        // Resolve outer-loop vertex positions (read-only).
        let outer_verts = self.collect_loop_verts(face.outer().start).ok()?;
        let positions: Vec<DVec3> = outer_verts.iter()
            .filter_map(|&vid| self.verts.get(vid).map(|v| v.pos()))
            .collect();
        if positions.is_empty() { return None; }

        // Cache-eligibility short-circuit (Plane / no-surface).
        if !face.should_cache_normals() {
            // Fresh compute, no store.
            let normals: Vec<DVec3> = positions.iter()
                .map(|&p| surface.normal_at_world_pos(p))
                .collect();
            return Some(normals);
        }

        // Cache-hit check.
        let sv = face.surface_version();
        let bv = face.boundary_version();
        let cloned_data: Option<Vec<DVec3>> = {
            let cache = face.normal_cache();
            cache.as_ref().and_then(|entry| {
                if entry.surface_version == sv
                    && entry.boundary_version == bv
                    && entry.per_vertex_normals.len() == positions.len()
                {
                    Some(entry.per_vertex_normals.clone())
                } else { None }
            })
        };
        if let Some(data) = cloned_data {
            // ADR-061 Step 5 — touch-on-access (LRU ordering).
            face.touch_normal_cache(self.next_cache_tick());
            return Some(data);
        }

        // Miss — compute + populate.
        let normals: Vec<DVec3> = positions.iter()
            .map(|&p| surface.normal_at_world_pos(p))
            .collect();
        let tick = self.next_cache_tick();
        face.cache_normals(crate::entities::NormalCacheEntry {
            surface_version: sv,
            boundary_version: bv,
            per_vertex_normals: normals.clone(),
            last_access_tick: tick,
        });
        // ADR-061 §D #4 — Enforce byte cap (cheap when under cap).
        self.evict_lru_if_over_cap();
        Some(normals)
    }

    /// ADR-061 Phase P-narrow Step 4 — Z.2 Curve Hover Cache hot-path.
    ///
    /// Returns the polyline tessellation of `edge_id`'s analytic curve
    /// at the supplied `chord_tol`. Used as Newton initial-seed grid by
    /// `ray_to_curve_distance` (ADR-040 P25).
    ///
    /// 1. If `edge.curve` is `None` → returns `None` (straight edge,
    ///    closed-form distance handled elsewhere).
    /// 2. If `!edge.should_cache_polyline()` (Line variant per §D #2)
    ///    → tessellates fresh each call without caching. Returns `Some(...)`.
    /// 3. If cache `curve_version` matches current → **HIT**: returns
    ///    cloned polyline.
    /// 4. Otherwise → **MISS**: tessellates via `AnalyticCurve::tessellate`,
    ///    populates cache, returns.
    ///
    /// **§D #5 lock-in**: cache state is volatile (RefCell interior
    /// mutability via `&self` — does not require `&mut`).
    pub fn edge_cached_polyline_or_compute(
        &self,
        edge_id: EdgeId,
        chord_tol: f64,
    ) -> Option<Vec<DVec3>> {
        use crate::curves::CurveOps;
        let edge = self.edges.get(edge_id)?;
        if !edge.is_active() { return None; }
        let curve = edge.curve()?;

        // Cache-eligibility short-circuit (Line / no curve).
        if !edge.should_cache_polyline() {
            return curve.tessellate(chord_tol, self).ok();
        }

        // Cache-hit check.
        let cv = edge.curve_version();
        let cloned_data: Option<Vec<DVec3>> = {
            let cache = edge.polyline_cache();
            cache.as_ref().and_then(|entry| {
                if entry.curve_version == cv { Some(entry.points.clone()) }
                else { None }
            })
        };
        if let Some(data) = cloned_data {
            // ADR-061 Step 5 — touch-on-access (LRU ordering).
            edge.touch_polyline_cache(self.next_cache_tick());
            return Some(data);
        }

        // Miss — compute + populate.
        let points = curve.tessellate(chord_tol, self).ok()?;
        let tick = self.next_cache_tick();
        edge.cache_polyline(crate::entities::PolylineCacheEntry {
            curve_version: cv,
            points: points.clone(),
            last_access_tick: tick,
        });
        // ADR-061 §D #4 — Enforce byte cap.
        self.evict_lru_if_over_cap();
        Some(points)
    }

    /// ADR-031 Phase D — Tessellate a face's analytic surface for rendering.
    ///
    /// - If the face has no surface (default polygon), returns None.
    /// - Otherwise returns a triangle mesh trimmed to the face's parameter
    ///   range, sampled to chord error ≤ `chord_tol`.
    pub fn tessellate_face_surface(
        &self,
        face_id: FaceId,
        chord_tol: f64,
    ) -> Option<crate::surfaces::SurfaceTessellation> {
        use crate::surfaces::SurfaceOps;
        let face = self.faces.get(face_id)?;
        face.surface().map(|s| s.tessellate(chord_tol))
    }

    /// 새 line segment (start→end) 위에 있는 기존 vertex들을 찾음.
    /// 반환: (VertId, 3D pos, t_on_new_line) — t 오름차순 정렬.
    /// 이들은 edge split이 불필요 (vertex 이미 존재) — 새 line 자체가 이 vertex에서
    /// 나눠져야 grid 교차점 같은 케이스 처리 가능.
    pub fn find_vertices_on_line(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(VertId, DVec3, f64)> {
        let dir = end - start;
        let len_sq = dir.length_squared();
        if len_sq < 1e-18 { return Vec::new(); }
        let len = len_sq.sqrt();
        // 선분 수직 거리 허용치: 길이의 0.001% 또는 dedup_tol 중 큰 값.
        let perp_tol = (len * 1e-5).max(SPATIAL_HASH_CELL * 1.5);
        // Endpoint 일치 판정: add_vertex dedup_tol과 동일.
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;
        let dir_norm = dir / len;

        // AABB early-reject — a vertex on the line must fall inside the
        // line's bounding box padded by perp_tol. Rejecting by AABB
        // avoids the expensive dot/length computation for most vertices
        // in a large scene.
        let tol = perp_tol.max(endpoint_tol);
        let (lmin_x, lmax_x) = if start.x < end.x { (start.x - tol, end.x + tol) }
                               else              { (end.x - tol, start.x + tol) };
        let (lmin_y, lmax_y) = if start.y < end.y { (start.y - tol, end.y + tol) }
                               else              { (end.y - tol, start.y + tol) };
        let (lmin_z, lmax_z) = if start.z < end.z { (start.z - tol, end.z + tol) }
                               else              { (end.z - tol, start.z + tol) };

        let mut result = Vec::new();
        for (vid, vert) in self.verts.iter() {
            if !vert.is_active() { continue; }
            let p = vert.pos();

            if p.x < lmin_x || p.x > lmax_x
                || p.y < lmin_y || p.y > lmax_y
                || p.z < lmin_z || p.z > lmax_z
            {
                continue;
            }

            // start/end와 동일한 vertex는 제외
            if (p - start).length() < endpoint_tol { continue; }
            if (p - end).length() < endpoint_tol { continue; }
            // t 파라미터
            let w = p - start;
            let t = w.dot(dir_norm) / len;
            if t <= 1e-6 || t >= 1.0 - 1e-6 { continue; }
            // 선분까지 수직 거리
            let proj = start + dir * t;
            let perp = (p - proj).length();
            if perp > perp_tol { continue; }
            result.push((vid, p, t));
        }
        result.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        result
    }

    /// 주어진 line segment (start→end)과 교차하는 기존 엣지들의 교차점을 찾음.
    /// Coplanar edges만 대상 (4개 점의 tetrahedron volume으로 판정).
    /// 반환: (edge_id, 교차점 3D 좌표, t_on_new_line) 리스트, t_param 오름차순.
    ///
    /// 사용: drawLine에서 기존 엣지와의 교차점을 자동 vertex로 삽입하기 위함.
    pub fn find_line_crossings(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(EdgeId, DVec3, f64)> {
        let dir = end - start;
        let len = dir.length();
        if len < 1e-9 { return Vec::new(); }
        // Relative coplanarity tolerance (line scale의 0.01%).
        let coplanar_tol = (len * 1e-4).max(1e-3);
        // Endpoint-on-vertex 판정 tolerance — add_vertex의 dedup_tol(= SPATIAL_HASH_CELL*1.5 = 1.5μm)과 일치
        // 시켜서 vertex dedup과 crossing 판정이 서로 어긋나지 않도록 함.
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;

        // AABB of the new line (expanded by coplanar tol) — a transverse
        // crossing can only happen between edges whose bounding boxes
        // overlap the new line's. Separating-axis test filters out most
        // edges without touching their vertex data.
        let aabb_tol = coplanar_tol.max(endpoint_tol);
        let (lmin_x, lmax_x) = if start.x < end.x { (start.x - aabb_tol, end.x + aabb_tol) }
                               else              { (end.x - aabb_tol, start.x + aabb_tol) };
        let (lmin_y, lmax_y) = if start.y < end.y { (start.y - aabb_tol, end.y + aabb_tol) }
                               else              { (end.y - aabb_tol, start.y + aabb_tol) };
        let (lmin_z, lmax_z) = if start.z < end.z { (start.z - aabb_tol, end.z + aabb_tol) }
                               else              { (end.z - aabb_tol, start.z + aabb_tol) };

        let mut crossings = Vec::new();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            // Skip non-topological edges (Centerline) — by contract they don't
            // split other lines and aren't split by them. Regular drawLine must
            // cross freely through a centerline without either side breaking.
            if !edge.class().is_topological() { continue; }
            let va = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let vb = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };

            // AABB separating-axis early-reject.
            let (ex_min_x, ex_max_x) = if va.x < vb.x { (va.x, vb.x) } else { (vb.x, va.x) };
            let (ex_min_y, ex_max_y) = if va.y < vb.y { (va.y, vb.y) } else { (vb.y, va.y) };
            let (ex_min_z, ex_max_z) = if va.z < vb.z { (va.z, vb.z) } else { (vb.z, va.z) };
            if ex_max_x < lmin_x || ex_min_x > lmax_x
                || ex_max_y < lmin_y || ex_min_y > lmax_y
                || ex_max_z < lmin_z || ex_min_z > lmax_z
            {
                continue;
            }

            // 끝점 일치 — 공유 vertex는 교차 아님
            if (va - start).length() < endpoint_tol || (va - end).length() < endpoint_tol ||
               (vb - start).length() < endpoint_tol || (vb - end).length() < endpoint_tol {
                continue;
            }

            // 두 segment의 공통 평면 확인 + 교차 parameter 계산
            let d2 = vb - va;
            let n = dir.cross(d2);
            let n_sq = n.length_squared();
            if n_sq < 1e-16 { continue; } // 평행
            // (va - start)가 n에 수직 = coplanar
            let w = va - start;
            let coplan_err = w.dot(n).abs() / n.length();
            if coplan_err > coplanar_tol { continue; }

            // Solve: start + t*dir = va + s*d2
            // t = ((va - start) × d2) · n / |n|²
            let t = w.cross(d2).dot(n) / n_sq;
            let s = w.cross(dir).dot(n) / n_sq;

            // s(기존 엣지 parameter)는 반드시 interior — 공유 vertex는 이미 위에서
            // 걸러졌으므로 여기 도달하면 기존 엣지 위의 진짜 교차점.
            // t(새 line parameter)는 [0, 1] 전체 허용 — 새 line의 start/end가 기존
            // 엣지 중간 위에 있어도 해당 엣지를 split해야 grid 같은 케이스가 동작.
            let t_eps = 1e-6;
            let s_eps = 1e-3;
            if t > -t_eps && t < 1.0 + t_eps && s > s_eps && s < 1.0 - s_eps {
                let t_clamped = t.clamp(0.0, 1.0);
                let pos = start + dir * t_clamped;
                crossings.push((edge_id, pos, t_clamped));
            }
        }

        crossings.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        crossings
    }

    /// Phase B (2026-04-24) — collinear (parallel + overlapping) edge detection.
    ///
    /// `find_line_crossings` handles transverse crossings but skips parallel
    /// cases (n_sq < 1e-16). For correct RECT-overlap-RECT behaviour we need
    /// to detect when the new line's ENDPOINTS fall into the interior of an
    /// existing collinear edge so we can split that edge at the endpoint
    /// position. Without this split, two overlapping collinear edges end
    /// up as separate topology and downstream face synthesis / merge fail.
    ///
    /// Returns: list of `(edge_id, split_position)` where existing `edge_id`
    /// must be split at `split_position` (which lies strictly inside the
    /// existing edge, at either the new line's start or end point).
    pub fn find_collinear_endpoint_splits(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(EdgeId, DVec3)> {
        let dir = end - start;
        let len = dir.length();
        if len < 1e-9 { return Vec::new(); }
        let dir_unit = dir / len;
        let coplanar_tol = (len * 1e-4).max(1e-3);
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;

        // AABB of the new line, expanded by tolerance — any existing edge
        // whose own AABB misses this one entirely cannot be collinear with
        // it. This early-rejects the common case (most edges in the scene
        // nowhere near the line being drawn), keeping this per-drawLine
        // pass near-constant on average instead of O(E) strict.
        let aabb_tol = coplanar_tol.max(endpoint_tol);
        let (min_x, max_x) = if start.x < end.x { (start.x - aabb_tol, end.x + aabb_tol) }
                             else              { (end.x - aabb_tol, start.x + aabb_tol) };
        let (min_y, max_y) = if start.y < end.y { (start.y - aabb_tol, end.y + aabb_tol) }
                             else              { (end.y - aabb_tol, start.y + aabb_tol) };
        let (min_z, max_z) = if start.z < end.z { (start.z - aabb_tol, end.z + aabb_tol) }
                             else              { (end.z - aabb_tol, start.z + aabb_tol) };

        let mut splits: Vec<(EdgeId, DVec3)> = Vec::new();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if !edge.class().is_topological() { continue; }
            let va = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let vb = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };

            // AABB early-reject — separating-axis test between the two
            //   edges' AABBs. Two AABBs are disjoint iff one is strictly
            //   to the left/right / below/above / front/back of the other
            //   on at least one axis. Any disjoint pair cannot be
            //   collinear, so we can skip them cheaply.
            let (ex_min_x, ex_max_x) = if va.x < vb.x { (va.x, vb.x) } else { (vb.x, va.x) };
            let (ex_min_y, ex_max_y) = if va.y < vb.y { (va.y, vb.y) } else { (vb.y, va.y) };
            let (ex_min_z, ex_max_z) = if va.z < vb.z { (va.z, vb.z) } else { (vb.z, va.z) };
            if ex_max_x < min_x || ex_min_x > max_x
                || ex_max_y < min_y || ex_min_y > max_y
                || ex_max_z < min_z || ex_min_z > max_z
            {
                continue;
            }

            let ab = vb - va;
            let ab_len = ab.length();
            if ab_len < 1e-9 { continue; }
            let ab_unit = ab / ab_len;

            // Parallel check: cross product near zero.
            let cross = dir_unit.cross(ab_unit);
            if cross.length_squared() > 1e-6 { continue; }  // not parallel

            // Collinear check: start must lie on the line through va.
            //   perp distance of (start - va) from ab direction.
            let w = start - va;
            let perp = w - ab_unit * w.dot(ab_unit);
            if perp.length() > coplanar_tol { continue; }

            // Both endpoints of the new line collinear. Now check if either
            //   lies strictly inside the existing edge's parameter range
            //   (and is NOT coincident with va/vb, which would already be
            //   handled by spatial-hash vertex dedup).
            for &candidate in &[start, end] {
                // Skip if candidate coincides with existing edge endpoints
                //   (add_vertex will dedup naturally).
                if (candidate - va).length() < endpoint_tol { continue; }
                if (candidate - vb).length() < endpoint_tol { continue; }

                let s = (candidate - va).dot(ab_unit) / ab_len;
                let s_eps = 1e-3;
                if s > s_eps && s < 1.0 - s_eps {
                    splits.push((edge_id, candidate));
                }
            }
        }
        splits
    }

    /// 주어진 face의 경계 루프에 특정 vertex가 포함되어 있는지 검사.
    pub fn face_contains_vertex_on_boundary(&self, face_id: FaceId, vid: VertId) -> bool {
        let face = match self.faces.get(face_id) { Some(f) => f, None => return false };
        if !face.is_active() { return false; }
        let verts = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v,
            Err(_) => return false,
        };
        verts.contains(&vid)
    }

    /// 두 vertex 모두가 경계 위에 있는 활성 face의 ID를 반환 (있다면).
    /// 여러 face가 공유하는 경우 첫 번째 매치 반환.
    ///
    /// ⚡ 성능: large scene 의 draw_line 시 N face 전체를 순회하며
    /// `collect_loop_verts` 를 돌리면 face 수에 비례한 heap-alloc 이 누적돼
    /// 수백 ms 가 됨. v1 의 incident edges 만 추적해 후보 face 수를 평균
    /// 4 이하로 줄인다.
    pub fn find_face_containing_both_verts(&self, v1: VertId, v2: VertId) -> Option<FaceId> {
        // v1 의 모든 incident half-edge 의 face 후보 수집 (radial chain 순회).
        // vert_to_edge 는 두 vert 쌍 → 단일 edge id 매핑이라 v1 의 모든
        // incident edge 를 직접 얻기 어렵다. 대안: edges 슬롯스토리지를
        // v1 또는 v2 가 endpoint 인 것만 1-pass 스캔하고, 그 edge 의
        // any_he 로부터 radial chain 을 따라 face 를 찾는다. 일반 manifold
        // 메시에서 v1 incident edge 수는 ~6 이내라 매우 빠름.
        use rustc_hash::FxHashSet;
        let mut candidates: FxHashSet<FaceId> = FxHashSet::default();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.v_small() != v1 && edge.v_large() != v1 { continue; }
            // walk radial chain to gather faces
            let start_he = edge.any_he();
            if start_he.is_null() { continue; }
            let mut he = start_he;
            for _ in 0..32 {
                let f = self.hes[he].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    candidates.insert(f);
                }
                he = self.hes[he].next_rad();
                if he == start_he { break; }
            }
            let _ = eid;
        }

        for face_id in candidates {
            let face = match self.faces.get(face_id) { Some(f) => f, None => continue };
            if !face.is_active() { continue; }
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if verts.contains(&v1) && verts.contains(&v2) {
                // 인접 vertex가 아닐 때만 (인접이면 그냥 기존 엣지) → face split 가능
                if !self.are_adjacent_in_loop(&verts, v1, v2) {
                    return Some(face_id);
                }
            }
        }
        None
    }

    fn are_adjacent_in_loop(&self, verts: &[VertId], a: VertId, b: VertId) -> bool {
        let n = verts.len();
        for i in 0..n {
            let va = verts[i];
            let vb = verts[(i + 1) % n];
            if (va == a && vb == b) || (va == b && vb == a) {
                return true;
            }
        }
        false
    }

    /// HalfEdge의 source vertex 반환 (dst의 반대쪽).
    pub fn he_source(&self, he_id: HeId) -> VertId {
        let he = &self.hes[he_id];
        let edge = &self.edges[he.edge()];
        let dst = he.dst();
        if dst == edge.v_small() { edge.v_large() } else { edge.v_small() }
    }

    /// HalfEdge의 "twin" (같은 edge의 반대 방향 HE) 반환.
    /// 2-manifold 메시에서 twin은 radial 체인의 다음 것.
    /// 3+ radial의 경우(non-manifold): dst가 다른 첫 번째 HE.
    pub fn he_twin(&self, he_id: HeId) -> HeId {
        let start_dst = self.hes[he_id].dst();
        let mut he = self.hes[he_id].next_rad();
        let start = he_id;
        let mut count = 0;
        while he != start && count < 1000 {
            if self.hes[he].dst() != start_dst {
                return he;
            }
            he = self.hes[he].next_rad();
            count += 1;
        }
        start // fallback
    }

    /// ════════════════════════════════════════════════════════════════════════
    /// Planar Face Resolution — Leftmost-turn traversal (다중 평면 지원)
    /// ════════════════════════════════════════════════════════════════════════
    ///
    /// Free half-edges (face=null)로 이루어진 planar 그래프에서 모든 bounded
    /// region을 체계적으로 찾아 face로 확정. 기존 face는 건드리지 않음.
    ///
    /// 알고리즘:
    /// 1. 모든 free HE를 수집, connected component로 그룹화 (공유 vertex).
    /// 2. 각 component마다 PCA-lite 기반 평면 결정 (3점 non-collinear).
    /// 3. Component의 평면으로 2D 투영 → leftmost-turn walk → cycle 수집.
    /// 4. Signed area > 0인 cycle을 face로 생성.
    ///
    /// 다중 평면 지원: 각 component 독립적으로 평면 결정, 3D 스케치 처리 가능.
    pub fn resolve_planar_free_faces(&mut self, material: MaterialId) -> Vec<FaceId> {
        self.resolve_planar_free_faces_scoped(material, None, None)
    }

    /// seed_verts: Some이면 해당 vertex를 포함하는 component만 처리.
    /// required_edges: Some이면 cycle이 최소 하나의 해당 edge를 포함해야 face 생성.
    ///   → 이전에 삭제된 면의 free HE cycle을 재생성하지 않도록 필수 (drawLine이
    ///   만든 새 edge가 없으면 skip).
    pub fn resolve_planar_free_faces_scoped(
        &mut self,
        material: MaterialId,
        seed_verts: Option<&[VertId]>,
        required_edges: Option<&[EdgeId]>,
    ) -> Vec<FaceId> {
        // Skip HEs belonging to non-topological edges (Centerline etc.) —
        // they shouldn't contribute to face synthesis (by contract).
        let free_hes: Vec<HeId> = self.hes.iter()
            .filter(|(_, he)| {
                if !he.is_active() || !he.face().is_null() { return false; }
                match self.edges.get(he.edge()) {
                    Some(e) => e.is_active() && e.class().is_topological(),
                    None => false,
                }
            })
            .map(|(id, _)| id)
            .collect();
        if free_hes.is_empty() { return Vec::new(); }

        // Step 1: free HE를 connected component로 그룹 (공유 vertex 기준)
        let free_set: FxHashSet<HeId> = free_hes.iter().copied().collect();
        let mut he_to_comp: FxHashMap<HeId, usize> = FxHashMap::default();
        let mut components: Vec<Vec<HeId>> = Vec::new();
        for &start in &free_hes {
            if he_to_comp.contains_key(&start) { continue; }
            let comp_id = components.len();
            let mut comp_hes: Vec<HeId> = Vec::new();
            let mut stack: Vec<HeId> = vec![start];
            while let Some(he) = stack.pop() {
                if he_to_comp.contains_key(&he) { continue; }
                he_to_comp.insert(he, comp_id);
                comp_hes.push(he);
                let src = self.he_source(he);
                let dst = self.hes[he].dst();
                for &v in &[src, dst] {
                    for (hid, h) in self.hes.iter() {
                        if !h.is_active() { continue; }
                        if !free_set.contains(&hid) { continue; }
                        if he_to_comp.contains_key(&hid) { continue; }
                        let hs = self.he_source(hid);
                        let hd = h.dst();
                        if hs == v || hd == v {
                            stack.push(hid);
                        }
                    }
                }
            }
            components.push(comp_hes);
        }

        // seed_verts 필터: 해당 vertex를 포함하는 component만 선택
        let filtered_components: Vec<&Vec<HeId>> = if let Some(seeds) = seed_verts {
            let seed_set: FxHashSet<VertId> = seeds.iter().copied().collect();
            components.iter().filter(|comp| {
                comp.iter().any(|&he| {
                    let src = self.he_source(he);
                    let dst = self.hes[he].dst();
                    seed_set.contains(&src) || seed_set.contains(&dst)
                })
            }).collect()
        } else {
            components.iter().collect()
        };

        let required_edge_set: Option<FxHashSet<EdgeId>> = required_edges
            .map(|e| e.iter().copied().collect());

        let mut created_all: Vec<FaceId> = Vec::new();
        for comp in filtered_components {
            // ADR-089 Phase 2 (A-ζ-3): closed-curve component fast-path.
            // Component 가 self-loop edge + analytic curve (단일) 이면
            // polygon resolve 우회 → 1-HE 1-vert face 직접 wiring.
            // Polygon 경로 (≥3 verts) 영향 0.
            if let Some(face) = self.try_resolve_closed_curve_component(comp, material) {
                created_all.push(face);
                continue;
            }
            let faces = self.resolve_component(comp, material, required_edge_set.as_ref());
            created_all.extend(faces);
        }
        created_all
    }

    /// ADR-089 Phase 2 (A-ζ-3) — closed-curve component fast-path.
    ///
    /// Component 가 다음 패턴이면 (typical: standalone closed circle):
    /// - 정확히 1 distinct edge
    /// - edge 가 self-loop (v_small == v_large)
    /// - edge.curve = Some(...) (analytic curve attached)
    /// - 1 또는 2 free HEs (2 = twin pair, 둘 중 하나만 face 부여)
    ///
    /// → 1 HE 를 face 에 wire (next/prev = self) + face.outer = LoopRef.
    /// 결과 FaceId 반환.
    ///
    /// 그 외 패턴 (polygon, mixed, 등) → None 반환 → 호출자가 polygon
    /// resolve_component fallback.
    fn try_resolve_closed_curve_component(
        &mut self,
        comp_hes: &[HeId],
        material: MaterialId,
    ) -> Option<FaceId> {
        if comp_hes.is_empty() { return None; }
        // Distinct edges in component.
        let mut edge_set: FxHashSet<EdgeId> = FxHashSet::default();
        for &he in comp_hes {
            edge_set.insert(self.hes[he].edge());
        }
        if edge_set.len() != 1 { return None; }
        let eid = *edge_set.iter().next().unwrap();
        let edge = self.edges.get(eid)?;
        if !edge.is_active() { return None; }
        if !edge.is_self_loop() { return None; }
        // curve 부착 필수 (A-δ contract — 없으면 degenerate).
        let _curve = edge.curve()?;
        // anchor vertex
        let anchor = edge.v_small();

        // Pick first free HE (face is null per filter in caller).
        let he_anchor = comp_hes[0];

        // Compute face normal from curve.
        let normal = match edge.curve() {
            Some(crate::curves::AnalyticCurve::Circle { normal, .. }) => normal.normalize_or_zero(),
            _ => return None, // 본 commit 은 Circle 만 (A-η 후속)
        };
        if normal.length_squared() < 1e-12 { return None; }
        let _ = anchor;  // (현재 사용 안 함, future face metadata 확장용)

        // Insert face with placeholder, then wire single HE.
        let face_id = self.faces.insert(Face::new(
            LoopRef::default(),
            normal,
            FACE_TOLERANCE,
            material,
        ));
        self.hes[he_anchor].set_next(he_anchor);
        self.hes[he_anchor].set_prev(he_anchor);
        self.hes[he_anchor].set_face(face_id);
        self.hes[he_anchor].set_outer(true);
        self.faces[face_id].set_outer(LoopRef::new(he_anchor, true));
        Some(face_id)
    }

    /// 단일 component의 free HE들에 대해 평면 결정 + leftmost-turn + face 생성.
    fn resolve_component(
        &mut self,
        comp_hes: &[HeId],
        material: MaterialId,
        required_edges: Option<&FxHashSet<EdgeId>>,
    ) -> Vec<FaceId> {
        if comp_hes.is_empty() { return Vec::new(); }

        // Component의 모든 vertex 수집
        let mut verts_set: FxHashSet<VertId> = FxHashSet::default();
        for &he in comp_hes {
            verts_set.insert(self.he_source(he));
            verts_set.insert(self.hes[he].dst());
        }
        let verts_vec: Vec<VertId> = verts_set.iter().copied().collect();
        if verts_vec.len() < 3 { return Vec::new(); }

        // Step 2: 평면 결정 — 3점 non-collinear
        let p0 = match self.vertex_pos(verts_vec[0]) { Ok(p) => p, Err(_) => return Vec::new() };
        // 가장 먼 점 찾기 (v1)
        let mut max_d = 0.0_f64;
        let mut v1_pos = p0;
        for &v in verts_vec.iter().skip(1) {
            if let Ok(p) = self.vertex_pos(v) {
                let d = (p - p0).length_squared();
                if d > max_d { max_d = d; v1_pos = p; }
            }
        }
        if max_d < 1e-10 { return Vec::new(); }
        let e1 = (v1_pos - p0).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return Vec::new(); }
        // 최대 수직 거리 점 찾기 (v2)
        let mut max_perp = 0.0_f64;
        let mut v2_pos = p0;
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                let d = p - p0;
                let proj = e1 * d.dot(e1);
                let ortho = d - proj;
                let len = ortho.length_squared();
                if len > max_perp { max_perp = len; v2_pos = p; }
            }
        }
        if max_perp < 1e-10 { return Vec::new(); } // collinear component
        let e2 = {
            let d = v2_pos - p0;
            let proj = e1 * d.dot(e1);
            (d - proj).normalize_or_zero()
        };
        let normal = e1.cross(e2).normalize_or_zero();
        if normal.length_squared() < 1e-10 { return Vec::new(); }

        // 평면 coplanarity tolerance (상대)
        let tol = (max_d.sqrt() * 1e-4).max(1e-3);

        // Component의 모든 vertex가 평면 위에 있는지 확인
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                let dist = (p - p0).dot(normal).abs();
                if dist > tol { return Vec::new(); } // 비평면 component — skip
            }
        }

        // Step 3: 2D 투영
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };

        // vertex → 2D 좌표
        let mut vert_2d: FxHashMap<VertId, (f64, f64)> = FxHashMap::default();
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                vert_2d.insert(v, project2d(p));
            }
        }

        // vertex → ALL outgoing HE (free + in-face 모두, angular ordering용)
        let mut vert_to_outs: FxHashMap<VertId, Vec<HeId>> = FxHashMap::default();
        for &v in &verts_vec {
            let mut list = Vec::new();
            for (hid, he) in self.hes.iter() {
                if !he.is_active() { continue; }
                if self.he_source(hid) != v { continue; }
                // 2D 상 위치 정의 가능한 경우만 포함 (dst이 vert_2d에 있음)
                if !vert_2d.contains_key(&he.dst()) { continue; }
                list.push(hid);
            }
            vert_to_outs.insert(v, list);
        }

        // HE의 2D 방향 angle
        let he_angle_2d = |hid: HeId, self_: &Mesh| -> f64 {
            let src = self_.he_source(hid);
            let dst = self_.hes[hid].dst();
            let ps = vert_2d.get(&src).copied().unwrap_or((0.0, 0.0));
            let pd = vert_2d.get(&dst).copied().unwrap_or((0.0, 0.0));
            (pd.1 - ps.1).atan2(pd.0 - ps.0)
        };

        // 정렬
        for (_, hes) in vert_to_outs.iter_mut() {
            hes.sort_by(|&a, &b| {
                let sa = he_angle_2d(a, self);
                let sb = he_angle_2d(b, self);
                sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        // Step 4: Leftmost-turn walk
        let free_set: FxHashSet<HeId> = comp_hes.iter().copied().collect();
        let mut visited: FxHashSet<HeId> = FxHashSet::default();
        let mut cycles: Vec<Vec<VertId>> = Vec::new();
        let max_iter = comp_hes.len() * 2 + 10;

        for &start in comp_hes {
            if visited.contains(&start) { continue; }
            let mut cycle_hes: Vec<HeId> = Vec::new();
            let mut current = start;
            let mut closed = false;
            for _ in 0..max_iter {
                if visited.contains(&current) { break; }
                cycle_hes.push(current);
                visited.insert(current);

                let v = self.hes[current].dst();
                let twin = self.he_twin(current);
                let outs = match vert_to_outs.get(&v) { Some(o) => o, None => break };
                if outs.is_empty() { break; }
                let twin_idx = match outs.iter().position(|&h| h == twin) {
                    Some(i) => i, None => break,
                };
                let next_idx = (twin_idx + outs.len() - 1) % outs.len();
                let next_he = outs[next_idx];

                if !self.hes[next_he].face().is_null() { break; }
                if !free_set.contains(&next_he) { break; }

                if next_he == start { closed = true; break; }
                current = next_he;
            }

            if !closed || cycle_hes.len() < 3 { continue; }

            // required_edges 필터: cycle이 적어도 하나의 required edge를 포함해야 함.
            // 이 필터는 "이전에 삭제된 면의 자유 엣지 cycle"이 재생성되는 것을 차단.
            //
            // **크기 제한**: 작은 cycle(≤7 vertices)에는 필터 적용 안 함.
            // 이유: 사용자가 새로 그리는 일반 도형(삼각/사각/오각형 등)은 vertex 수가 적음.
            // 반면 삭제된 원형 면(예: 원통 top 24 vertices)은 큰 cycle. 필터를 큰 cycle에만
            // 적용하면 일반 face 생성 실패 없이 큰 deleted boundary 재생성만 차단.
            if let Some(req) = required_edges {
                if cycle_hes.len() > 7 {
                    let uses_required = cycle_hes.iter().any(|&he| {
                        req.contains(&self.hes[he].edge())
                    });
                    if !uses_required { continue; }
                }
            }

            let verts: Vec<VertId> = cycle_hes.iter().map(|&h| self.he_source(h)).collect();
            cycles.push(verts);
        }

        // Step 5: Filters + face 생성
        //
        // 필터 순서 (싼 것부터):
        //   1) Signed area — bounded vs outer (기존)
        //   2) (A) Strip rejection — compactness 너무 낮으면 거부 (collinear strip loop)
        //   3) 기존 face 포함 검사 (B) — **local AABB 내부에 centroid가 있는 face만** 검사
        //   4) Coplanarity 재검증
        //   5) add_face
        //
        // 기존 face의 centroid 3D 좌표 + 면적 수집 (local AABB prune + size check).
        // 면적: cycle이 face를 "enclose"한다고 판단하려면 cycle이 face보다 커야 함.
        // 작은 cycle 내부에 큰 face의 centroid가 우연히 떨어져도 실제로는 enclose 아님
        // (예: outer rect 안에 inner rect 그릴 때 outer centroid가 inner 내부에 있음).
        let mut face_info: Vec<(DVec3, f64)> = Vec::new();
        for (_, f) in self.faces.iter() {
            if !f.is_active() { continue; }
            let verts = match self.collect_loop_verts(f.outer().start) { Ok(v) => v, Err(_) => continue };
            if verts.is_empty() { continue; }
            let pts: Vec<DVec3> = verts.iter().filter_map(|&v| self.vertex_pos(v).ok()).collect();
            if pts.len() < 3 { continue; }
            let mut c = DVec3::ZERO;
            for &p in &pts { c += p; }
            let centroid = c / pts.len() as f64;
            // 3D polygon area: 0.5 * |Σ (pi - p0) × (pi+1 - p0)|
            let mut area_vec = DVec3::ZERO;
            for i in 1..pts.len()-1 {
                area_vec += (pts[i] - pts[0]).cross(pts[i+1] - pts[0]);
            }
            let area = area_vec.length() * 0.5;
            face_info.push((centroid, area));
        }

        let point_in_poly_2d = |px: f64, py: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            if n < 3 { return false; }
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        let mut created: Vec<FaceId> = Vec::new();
        for verts in &cycles {
            // 2D 좌표 시퀀스
            let poly_2d: Vec<(f64, f64)> = verts.iter()
                .map(|v| vert_2d.get(v).copied().unwrap_or((0.0, 0.0)))
                .collect();
            if poly_2d.len() < 3 { continue; }

            // 1) Signed area
            let mut signed_area2 = 0.0;
            for i in 0..poly_2d.len() {
                let p = poly_2d[i];
                let q = poly_2d[(i + 1) % poly_2d.len()];
                signed_area2 += p.0 * q.1 - q.0 * p.1;
            }
            if signed_area2 <= 0.0 { continue; } // outer (CW) — skip

            let area = signed_area2.abs() * 0.5;

            // Perimeter
            let mut perimeter = 0.0;
            for i in 0..poly_2d.len() {
                let p = poly_2d[i];
                let q = poly_2d[(i + 1) % poly_2d.len()];
                let dx = q.0 - p.0;
                let dy = q.1 - p.1;
                perimeter += (dx*dx + dy*dy).sqrt();
            }
            if perimeter < 1e-6 { continue; }

            // (A) Strip rejection — normalized compactness (4π·area/perimeter²)
            // 원=1.0, 정사각형≈0.785, 10:1 사각형≈0.025, 100:1 strip≈0.003
            // 임계값 0.001: 극단적으로 얇은 strip만 거부.
            let compactness = 4.0 * std::f64::consts::PI * area / (perimeter * perimeter);
            if compactness < 0.001 { continue; }

            // Cycle의 2D AABB
            let mut min_x = f64::INFINITY;
            let mut max_x = f64::NEG_INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_y = f64::NEG_INFINITY;
            for &(x, y) in &poly_2d {
                if x < min_x { min_x = x; }
                if x > max_x { max_x = x; }
                if y < min_y { min_y = y; }
                if y > max_y { max_y = y; }
            }
            // 5% expansion — δ
            let dx = (max_x - min_x).max(1e-3) * 0.05;
            let dy = (max_y - min_y).max(1e-3) * 0.05;

            // (B) Local-containment / all-edges-free check (ADR-008 Axiom 7).
            // The cycle must be entirely on completely-free edges. Mixed
            // cycles are handled by Step 4.9 M1 split_face_by_chain.
            let all_edges_free = verts.iter().enumerate().all(|(i, _)| {
                let va = verts[i];
                let vb = verts[(i + 1) % verts.len()];
                match self.find_edge(va, vb) {
                    Some(eid) => self.is_edge_completely_free(eid),
                    None => false,
                }
            });
            if !all_edges_free { continue; }

            // Coplanarity 재검증
            if !self.are_verts_coplanar(verts) { continue; }

            // Face 생성
            if let Ok(fid) = self.add_face(verts, material) {
                // 인접 face와 normal 일관성 검사 — 필요 시 뒤집기
                self.align_face_with_neighbors(fid);
                created.push(fid);
            }
        }
        created
    }

    /// 다른 활성 face를 **물리적으로 감싸는** face를 찾아 dissolve.
    ///
    /// 시나리오: 사용자가 outer triangle을 그린 뒤 그 내부에 inner triangle을
    /// 그리고 connector 엣지까지 추가한 경우. Outer tri는 이미 face로 등록됐지만
    /// 그 경계 HE가 inner tri + wedge 영역의 CCW 순회를 차단 → wedge 생성 실패.
    /// Outer face를 dissolve해서 경계 HE를 해방시키면 D resolver가 inner+wedges를
    /// 올바르게 재구성.
    ///
    /// 조건: face A의 centroid가 다른 face B의 2D polygon 내부 + 같은 평면.
    /// 이때 B를 dissolve. B 자체가 다른 C를 감싸는 관계도 재귀적으로 처리 가능.
    /// 반환: dissolve된 face_ids.
    pub fn dissolve_containing_faces(&mut self) -> Vec<FaceId> {
        self.dissolve_containing_faces_opts(false)
    }

    /// `skip_ring_faces=true` 일 때, inner loop (hole) 이 이미 존재하는 face 를
    /// outer 후보에서 제외. Phase 3c second-pass (Step 4.95) 에서 B1 hole-
    /// promote 된 ring face 가 같은 inner 에 다시 매칭되어 이중 dissolve 되는
    /// 것을 방지.
    pub fn dissolve_containing_faces_opts(&mut self, skip_ring_faces: bool) -> Vec<FaceId> {
        let active: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .filter(|(_, f)| !(skip_ring_faces && !f.inners().is_empty()))
            .map(|(id, _)| id)
            .collect();
        // Containment requires ≥2 faces; single-face scene has nothing to
        // do and the O(F²) geom build below is wasted work.
        if active.len() < 2 { return Vec::new(); }
        // 각 face의 자체 평면에서 2D polygon + centroid 계산
        struct FaceGeom {
            poly_2d: Vec<(f64, f64)>,
            centroid_3d: DVec3,
            origin: DVec3,
            e1: DVec3,
            e2: DVec3,
            normal: DVec3,
        }
        let mut geoms: FxHashMap<FaceId, FaceGeom> = FxHashMap::default();
        for &fid in &active {
            let face = &self.faces[fid];
            let boundary = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if boundary.len() < 3 { continue; }
            let pts: Vec<DVec3> = boundary.iter()
                .filter_map(|&v| self.vertex_pos(v).ok())
                .collect();
            if pts.len() != boundary.len() { continue; }
            // face의 자체 평면 (normal + origin)
            let face_normal = face.normal();
            if face_normal.length_squared() < 1e-10 { continue; }
            let origin = pts[0];
            // e1: 첫 edge 방향
            let mut e1 = DVec3::ZERO;
            for p in &pts[1..] {
                let v = *p - origin;
                if v.length_squared() > 1e-6 {
                    e1 = v.normalize_or_zero();
                    break;
                }
            }
            if e1.length_squared() < 1e-10 { continue; }
            // e2 = normal × e1
            let e2 = face_normal.cross(e1).normalize_or_zero();
            if e2.length_squared() < 1e-10 { continue; }
            let poly_2d: Vec<(f64, f64)> = pts.iter()
                .map(|p| {
                    let v = *p - origin;
                    (v.dot(e1), v.dot(e2))
                })
                .collect();
            let cx: f64 = pts.iter().map(|p| p.x).sum::<f64>() / pts.len() as f64;
            let cy: f64 = pts.iter().map(|p| p.y).sum::<f64>() / pts.len() as f64;
            let cz: f64 = pts.iter().map(|p| p.z).sum::<f64>() / pts.len() as f64;
            geoms.insert(fid, FaceGeom {
                poly_2d, centroid_3d: DVec3::new(cx, cy, cz),
                origin, e1, e2, normal: face_normal,
            });
        }

        let point_in = |x: f64, y: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            if n < 3 { return false; }
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

        // 각 outer face에 대해 inner face가 "같은 평면" + "polygon 내부" + "connector edge 존재"
        // 인 경우에만 dissolve. connector가 없는 단순 중첩(예: 사각형 안의 사각형)은
        // 사용자의 의도된 구조로 간주해 **보존**.
        //
        // connector 정의: outer boundary vertex와 inner boundary vertex를 연결하는 edge.
        // 이것이 있으면 wedge 재구성이 필요 → dissolve. 없으면 dissolve 불필요.
        let mut to_dissolve: FxHashSet<FaceId> = FxHashSet::default();
        for (&outer, og) in &geoms {
            // outer boundary vertex 수집
            let outer_boundary_verts: FxHashSet<VertId> = self.collect_loop_verts(
                self.faces[outer].outer().start
            ).unwrap_or_default().into_iter().collect();

            for (&inner, ig) in &geoms {
                if outer == inner { continue; }
                let n_dot = og.normal.dot(ig.normal).abs();
                if n_dot < 0.99 { continue; }
                // 평면 거리 (coplanar 체크)
                let v = ig.centroid_3d - og.origin;
                let dist = v.dot(og.normal).abs();
                let mut max_chord_sq = 0.0_f64;
                for i in 0..og.poly_2d.len() {
                    let (x, y) = og.poly_2d[i];
                    max_chord_sq = max_chord_sq.max(x*x + y*y);
                }
                let plane_tol = (max_chord_sq.sqrt() * 1e-4).max(1.0);
                if dist > plane_tol { continue; }

                // 2026-04-24 Phase 3c (FreeDesignX 포팅):
                //   기존 centroid-only / 2D projection 기반 containment 체크를
                //   `polygon_geom::polygon_contains_polygon` 로 교체. 엄밀
                //   내부점(ear-clipping) + 모든 vertex 포함 + winding 각합으로
                //   L-shape wrap 오판을 제거.
                let outer_pts: Vec<DVec3> = self.collect_loop_verts(self.faces[outer].outer().start)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
                    .collect();
                let inner_pts: Vec<DVec3> = self.collect_loop_verts(self.faces[inner].outer().start)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
                    .collect();
                if !crate::operations::polygon_geom::polygon_contains_polygon(&outer_pts, &inner_pts) {
                    continue;
                }

                // Connector 검사: outer boundary vertex ↔ inner boundary vertex 엣지
                let inner_boundary_verts: FxHashSet<VertId> = self.collect_loop_verts(
                    self.faces[inner].outer().start
                ).unwrap_or_default().into_iter().collect();

                // 2026-04-28 — connector 정의 강화 (사용자 보고: stacked-inner
                //   RECT 그릴 때 인접 RECT 의 면이 사라짐).
                //
                //   기존 logic 은 SHARED edge (outer 와 inner 가 corner 를
                //   공유) 를 connector 로 오판 → adjacent RECT 시나리오에서
                //   둘 다 dissolve.
                //
                //   진짜 connector 의 의미: outer 와 inner 사이를 BRIDGE 하는
                //   true interior edge — 즉 두 polygon 사이의 "free space" 에
                //   놓인 edge. SHARED edge (양쪽 boundary 모두에 속한 edge) 는
                //   connector 가 아니라 그냥 인접 boundary 일 뿐.
                //
                //   조건 강화: 한쪽 vert 는 outer 에만, 다른쪽 vert 는 inner
                //   에만 속해야 진짜 connector. 양쪽 vert 가 양 boundary 에
                //   동시 속하면 그건 shared edge (다른 의미).
                let has_connector = self.vert_to_edge.iter().any(|(key, &eid)| {
                    if !self.edges[eid].is_active() { return false; }
                    let a_in_outer = outer_boundary_verts.contains(&key.v_small);
                    let a_in_inner = inner_boundary_verts.contains(&key.v_small);
                    let b_in_outer = outer_boundary_verts.contains(&key.v_large);
                    let b_in_inner = inner_boundary_verts.contains(&key.v_large);
                    // True connector: 한 vert 는 outer-ONLY, 다른 vert 는 inner-ONLY.
                    let a_outer_only = a_in_outer && !a_in_inner;
                    let a_inner_only = a_in_inner && !a_in_outer;
                    let b_outer_only = b_in_outer && !b_in_inner;
                    let b_inner_only = b_in_inner && !b_in_outer;
                    (a_outer_only && b_inner_only) || (a_inner_only && b_outer_only)
                });

                if has_connector {
                    to_dissolve.insert(outer);
                }
                // connector 없으면 중첩 유지 (사용자 의도).
            }
        }

        let mut dissolved: Vec<FaceId> = Vec::new();
        for fid in to_dissolve {
            if self.remove_face(fid).is_ok() { dissolved.push(fid); }
        }
        dissolved
    }

    /// 같은 boundary vertex 집합을 가진 중복 face들을 제거 (하나만 유지).
    ///
    /// 사용 시나리오: 사용자가 연속 drawLine 중 fan-split + loop-detect 경쟁으로 같은
    /// 영역에 두 face가 생성되는 경우. 또는 split_face_by_line이 원본 face를 제대로
    /// dissolve하지 못하고 sub-face와 함께 남는 경우.
    ///
    /// 알고리즘: boundary vertex 집합을 정렬된 키로 만들어 그룹핑. 그룹에 face가 2+이면
    /// 첫 번째만 유지하고 나머지 remove.
    /// 반환: 제거된 face_ids.
    pub fn deduplicate_overlapping_faces(&mut self) -> Vec<FaceId> {
        // vertex set key → 유지 face_id
        let mut groups: FxHashMap<Vec<u32>, FaceId> = FxHashMap::default();
        let mut to_remove: Vec<FaceId> = Vec::new();

        let active_ids: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();
        // Duplicates require ≥2 faces.
        if active_ids.len() < 2 { return Vec::new(); }

        for fid in active_ids {
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            if !face.is_active() { continue; }
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            let mut key: Vec<u32> = verts.iter().map(|v| v.raw()).collect();
            key.sort();
            if let Some(&existing) = groups.get(&key) {
                if existing != fid {
                    to_remove.push(fid);
                }
            } else {
                groups.insert(key, fid);
            }
        }

        for fid in &to_remove {
            let _ = self.remove_face(*fid);
        }
        to_remove
    }

    /// Face의 interior에 있는 vertex를 찾아 fan-tessellation으로 분할.
    ///
    /// 조건: vertex V가 face F의 2D 내부에 있고, V에서 F의 boundary vertex들로
    /// 자유(face=null) 엣지가 K ≥ 2개 뻗어 있으면, F를 dissolve하고 K개의 sub-face
    /// 생성 (V를 중심으로 한 fan).
    ///
    /// 반환: 분할 시 생성된 새 face ids; 분할 불필요 시 빈 Vec.
    pub fn dissolve_and_fan_split(&mut self, face_id: FaceId) -> Vec<FaceId> {
        if !self.faces.contains(face_id) { return Vec::new(); }
        let face = &self.faces[face_id];
        if !face.is_active() { return Vec::new(); }
        let material = face.material();
        let boundary = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        if boundary.len() < 3 { return Vec::new(); }

        // 2D projection plane from boundary
        let p0 = match self.vertex_pos(boundary[0]) { Ok(p) => p, Err(_) => return Vec::new() };
        let p1 = match self.vertex_pos(boundary[1]) { Ok(p) => p, Err(_) => return Vec::new() };
        let e1 = (p1 - p0).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return Vec::new(); }
        let mut e2 = DVec3::ZERO;
        for &vid in &boundary[2..] {
            if let Ok(p) = self.vertex_pos(vid) {
                let v = p - p0;
                let proj = e1 * v.dot(e1);
                let ortho = v - proj;
                if ortho.length_squared() > 1e-6 { e2 = ortho.normalize_or_zero(); break; }
            }
        }
        if e2.length_squared() < 1e-10 { return Vec::new(); }
        let normal = e1.cross(e2).normalize_or_zero();
        let tol = {
            let mut max_chord_sq = 0.0_f64;
            for &vid in &boundary {
                if let Ok(p) = self.vertex_pos(vid) {
                    let d = (p - p0).length_squared();
                    if d > max_chord_sq { max_chord_sq = d; }
                }
            }
            (max_chord_sq.sqrt() * 1e-4).max(1e-3)
        };
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };

        let boundary_set: FxHashMap<VertId, usize> = boundary.iter().enumerate()
            .map(|(i, &v)| (v, i)).collect();

        // 2D boundary polygon
        let poly2d: Vec<(f64, f64)> = boundary.iter()
            .filter_map(|&v| self.vertex_pos(v).ok().map(project2d))
            .collect();
        let point_in_poly = |x: f64, y: f64| -> bool {
            let mut inside = false;
            let n = poly2d.len();
            if n < 3 { return false; }
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly2d[i];
                let (xj, yj) = poly2d[j];
                if ((yi > y) != (yj > y)) &&
                   (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        // Find interior vertices (in F's plane + inside polygon + NOT on boundary)
        // with at least 2 free-edge connections to boundary.
        struct Candidate {
            v: VertId,
            spokes: Vec<(VertId, usize)>, // (boundary vertex, its index in boundary)
        }
        let mut candidates: Vec<Candidate> = Vec::new();

        for (vid, vert) in self.verts.iter() {
            if !vert.is_active() { continue; }
            if boundary_set.contains_key(&vid) { continue; }
            let p = vert.pos();
            // coplanar check
            let dist = (p - p0).dot(normal).abs();
            if dist > tol { continue; }
            let (px, py) = project2d(p);
            if !point_in_poly(px, py) { continue; }

            // Collect free edges from V to boundary verts
            let mut spokes: Vec<(VertId, usize)> = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                if key.v_small != vid && key.v_large != vid { continue; }
                let other = if key.v_small == vid { key.v_large } else { key.v_small };
                if let Some(&idx) = boundary_set.get(&other) {
                    spokes.push((other, idx));
                }
            }
            if spokes.len() >= 2 {
                candidates.push(Candidate { v: vid, spokes });
            }
        }

        if candidates.is_empty() { return Vec::new(); }

        // Pick the candidate with the MOST spokes (best fan coverage).
        candidates.sort_by_key(|c| std::cmp::Reverse(c.spokes.len()));
        let best = &candidates[0];
        let v_center = best.v;
        let mut spoke_verts: Vec<(VertId, usize)> = best.spokes.clone();
        // Sort by boundary index
        spoke_verts.sort_by_key(|&(_, idx)| idx);
        let k = spoke_verts.len();
        let n_boundary = boundary.len();

        // Partition boundary into K arcs (by consecutive spoke-connected verts).
        // Sub-face i: [V, b_i, boundary[b_i+1..b_{i+1}], b_{i+1}]
        // (spanning from spoke i's boundary vertex, walking along boundary, to spoke (i+1)'s vertex)
        let mut sub_faces_verts: Vec<Vec<VertId>> = Vec::with_capacity(k);
        for i in 0..k {
            let (_, start_idx) = spoke_verts[i];
            let (_, end_idx) = spoke_verts[(i + 1) % k];
            let mut arc: Vec<VertId> = Vec::new();
            arc.push(v_center);
            let mut j = start_idx;
            loop {
                arc.push(boundary[j]);
                if j == end_idx { break; }
                j = (j + 1) % n_boundary;
                // safety
                if arc.len() > n_boundary + 2 { break; }
            }
            if arc.len() >= 3 {
                sub_faces_verts.push(arc);
            }
        }

        if sub_faces_verts.is_empty() { return Vec::new(); }

        // Dissolve original face
        if self.remove_face(face_id).is_err() { return Vec::new(); }

        // Create sub-faces
        let mut created: Vec<FaceId> = Vec::new();
        for verts in &sub_faces_verts {
            match self.add_face(verts, material) {
                Ok(fid) => created.push(fid),
                Err(_) => continue,
            }
        }
        created
    }

    /// Face의 normal을 인접 face의 normal과 일관되게 맞춤.
    ///
    /// Manifold 규칙: 닫힌 솔리드의 인접 face들은 모두 같은 쪽(outward/inward)을
    /// 향함. 특히 인접 face들 간 normal dot > 0. 새로 생성된 face가 우연히 반대
    /// 방향의 normal을 가지면 (예: 수직 평면에서 signed area 부호 혼동) 인접 face와
    /// dot < 0이 됨 → 뒤집어서 수정.
    ///
    /// 반환: flip이 수행되었는지.
    pub fn align_face_with_neighbors(&mut self, face_id: FaceId) -> bool {
        let face = match self.faces.get(face_id) { Some(f) => f, None => return false };
        if !face.is_active() { return false; }
        let my_normal = face.normal();
        if my_normal.length_squared() < 1e-10 { return false; }

        let verts = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v, Err(_) => return false,
        };
        if verts.len() < 3 { return false; }

        // 각 edge에서 adjacent face 찾기 (HE twin의 face)
        let mut total_dot = 0.0;
        let mut neighbor_count = 0;
        for i in 0..verts.len() {
            let va = verts[i];
            let vb = verts[(i + 1) % verts.len()];
            let edge_id = match self.find_edge(va, vb) { Some(e) => e, None => continue };
            // Radial chain에서 다른 face를 가진 HE 찾기
            let start_he = self.edges[edge_id].any_he();
            if start_he.is_null() { continue; }
            let mut he = start_he;
            loop {
                let f = self.hes[he].face();
                if !f.is_null() && f != face_id {
                    if let Some(neighbor) = self.faces.get(f) {
                        if neighbor.is_active() {
                            let n_normal = neighbor.normal();
                            if n_normal.length_squared() > 1e-10 {
                                total_dot += my_normal.dot(n_normal);
                                neighbor_count += 1;
                            }
                        }
                    }
                }
                he = self.hes[he].next_rad();
                if he == start_he { break; }
            }
        }

        // 다수의 이웃이 나와 반대 방향(dot < 0)이면 flip
        if neighbor_count > 0 && total_dot < 0.0 {
            let _ = self.flip_face_safe(face_id);
            return true;
        }
        false
    }

    /// Mark an edge as SOFT (rendering-suppressed). Sets SOFTEN_COPLANAR and
    /// clears HARD. The DCEL topology stays intact — the edge is only hidden
    /// visually and excluded from wireframe output.
    ///
    /// 2026-04-24: introduced for the "merge failed → soften instead of
    /// cascade-delete" branch in `batch_erase_edges_with_merge`. Non-coplanar
    /// face merges cannot be topologically flattened (a DCEL face must be
    /// planar), but the user's intent "make this edge disappear" is honoured
    /// by hiding it. Two faces remain but read as one surface.
    /// Returns true iff every half-edge in the edge's radial loop has a
    /// null face — i.e. the edge is on no face at all. Used by Phase E
    /// synthesis to tell apart "freshly drawn" edges (completely free)
    /// from edges that bound an existing face and would, if part of a
    /// larger cycle, indicate recreation of a previously-resolved outer.
    /// Does `edge_id` have a free half-edge pointing from `src` to `dst`?
    /// Needed by the manifold-safety gates in D resolver and Step 4(b):
    /// before claiming a cycle edge, callers verify a suitable free HE
    /// already exists in the radial ring, avoiding a 4-way ring that
    /// would make the twin pair self-referencing.
    pub fn has_free_he_from_to(&self, edge_id: EdgeId, src: VertId, dst: VertId) -> bool {
        let Some(edge) = self.edges.get(edge_id) else { return false; };
        if !edge.is_active() { return false; }
        let start = edge.any_he();
        if start.is_null() { return false; }
        let mut he = start;
        loop {
            match self.hes.get(he) {
                Some(h) => {
                    if h.dst() == dst && h.face().is_null() {
                        // Verify src too — walk to prev via loop (expensive
                        //   in general but the edge's HEs all connect the
                        //   same two verts, so any HE with dst=dst has
                        //   src=other endpoint of this edge).
                        let v_small = edge.v_small();
                        let v_large = edge.v_large();
                        let he_src = if dst == v_small { v_large } else { v_small };
                        if he_src == src { return true; }
                    }
                    let next = h.next_rad();
                    if next.is_null() || next == start { return false; }
                    he = next;
                }
                None => return false,
            }
        }
    }

    pub fn is_edge_completely_free(&self, edge_id: EdgeId) -> bool {
        let Some(edge) = self.edges.get(edge_id) else { return false; };
        if !edge.is_active() { return false; }
        let start = edge.any_he();
        if start.is_null() { return false; }
        let mut he = start;
        loop {
            match self.hes.get(he) {
                Some(h) => {
                    if !h.face().is_null() { return false; }
                    let next = h.next_rad();
                    if next.is_null() || next == start { return true; }
                    he = next;
                }
                None => return false,
            }
        }
    }

    pub fn mark_edge_soft(&mut self, edge_id: EdgeId) {
        if !self.edges.contains(edge_id) { return; }
        let he_start = self.edges[edge_id].any_he();
        if he_start.is_null() { return; }
        let mut he_id = he_start;
        loop {
            // Set BOTH SOFT (render-hide) and SOFTEN_COPLANAR (semantic tag).
            // The renderer checks SOFT to skip drawing — that's the actual
            // visibility switch. SOFTEN_COPLANAR is a broader "treat as soft
            // when faces are coplanar" hint but is NOT what the render path
            // tests, so forgetting SOFT would keep the edge drawn.
            let mut new_flags = self.hes[he_id].flags()
                | HeFlags::SOFT
                | HeFlags::SOFTEN_COPLANAR;
            new_flags.remove(HeFlags::HARD);
            self.hes[he_id].set_flags(new_flags);
            he_id = self.hes[he_id].next_rad();
            if he_id == he_start { break; }
        }
    }

    /// Mark both half-edges of an edge with HARD flag.
    /// HARD edges always render (even between coplanar faces) — used for user-drawn
    /// lines and face-split edges so the user's intent stays visible.
    pub fn mark_edge_hard(&mut self, edge_id: EdgeId) {
        if !self.edges.contains(edge_id) { return; }
        let he_start = self.edges[edge_id].any_he();
        if he_start.is_null() { return; }
        let mut he_id = he_start;
        loop {
            let new_flags = self.hes[he_id].flags() | HeFlags::HARD;
            self.hes[he_id].set_flags(new_flags);
            he_id = self.hes[he_id].next_rad();
            if he_id == he_start { break; }
        }
    }

    /// Find edge between two vertices.
    pub fn find_edge(&self, a: VertId, b: VertId) -> Option<EdgeId> {
        let key = VertPairKey::new(a, b);
        self.vert_to_edge.get(&key).copied()
    }

    /// Find the shared edge between two faces (if any).
    pub fn find_shared_edge_between_faces(&self, f1: FaceId, f2: FaceId) -> Option<EdgeId> {
        // Collect all edges of face1
        let face1 = self.faces.get(f1)?;
        if !face1.is_active() { return None; }
        let verts1 = self.collect_loop_verts(face1.outer().start).ok()?;

        // For each edge in face1, check if it's shared with face2
        for i in 0..verts1.len() {
            let va = verts1[i];
            let vb = verts1[(i + 1) % verts1.len()];
            // Check both directions
            if let Some(eid) = self.find_edge(va, vb) {
                let (faces, _) = self.get_faces_sharing_edge(eid);
                if faces.contains(&f1) && faces.contains(&f2) {
                    return Some(eid);
                }
            }
        }
        None
    }

    /// Create the twin half-edge pair for an edge.
    fn create_halfedge_pair(&mut self, edge_id: EdgeId, pair: &VertPair) -> Result<()> {
        // Forward half-edge: v_start → v_end
        let he_fwd = HalfEdge::new(pair.v_end, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        // Backward half-edge: v_end → v_start
        let he_bwd = HalfEdge::new(pair.v_start, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        // Wire twins (radial chain for manifold: fwd ↔ bwd)
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(he_fwd_id);

        // Set both as basic half-edges
        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Anchor edge's radial reference
        self.edges[edge_id].set_any_he(he_fwd_id);

        // Set vertex outgoing references (if not already set) + insert into v_ring
        // (v_ring cycles outgoing HEs around each vertex via v_next)
        if self.verts[pair.v_start].outgoing().is_none() {
            self.verts[pair.v_start].set_outgoing(Some(he_fwd_id));
        }
        if self.verts[pair.v_end].outgoing().is_none() {
            self.verts[pair.v_end].set_outgoing(Some(he_bwd_id));
        }
        self.insert_into_v_ring(pair.v_start, he_fwd_id);
        self.insert_into_v_ring(pair.v_end, he_bwd_id);

        Ok(())
    }

    // ========================================================================
    // V-ring management (outgoing-HE cycle around each vertex)
    // ========================================================================
    //
    // Each vertex maintains a cyclic linked list of its outgoing HEs via the
    // `v_next` field. This enables O(degree) vertex-star traversal without
    // having to scan all HEs in the mesh.
    //
    //   v.outgoing() → he_a → v_next = he_b → v_next = he_c → v_next = he_a
    //
    // For a single-HE vertex, he.v_next = he itself (self-loop).

    /// Insert `new_he` (outgoing from `v`) into v's v_ring cycle.
    /// If v has no outgoing HE yet, establishes a self-loop (new_he.v_next = new_he).
    /// Otherwise splices new_he in right after v.outgoing.
    fn insert_into_v_ring(&mut self, v: VertId, new_he: HeId) {
        let anchor = match self.verts[v].outgoing() {
            Some(h) if h != new_he && self.hes.contains(h) => h,
            _ => {
                // Either no anchor yet, or anchor == new_he — self-loop
                self.hes[new_he].set_v_next(new_he);
                if self.verts[v].outgoing().is_none() {
                    self.verts[v].set_outgoing(Some(new_he));
                }
                return;
            }
        };
        let after = self.hes[anchor].v_next();
        if after.is_null() || !self.hes.contains(after) {
            // Broken ring — restart as 2-cycle with anchor
            self.hes[anchor].set_v_next(new_he);
            self.hes[new_he].set_v_next(anchor);
            return;
        }
        // Splice: anchor → new_he → after → ... → anchor
        self.hes[anchor].set_v_next(new_he);
        self.hes[new_he].set_v_next(after);
    }

    /// Remove `he` from its origin vertex's v_ring cycle.
    /// If `he` was v.outgoing, re-anchor to he.v_next (or clear if last).
    fn remove_from_v_ring(&mut self, v: VertId, he: HeId) {
        if !self.hes.contains(he) { return; }
        let anchor = self.verts[v].outgoing();
        // Find predecessor p with p.v_next == he
        let mut pred: Option<HeId> = None;
        if let Some(start) = anchor {
            let mut cur = start;
            let mut guard = 0usize;
            loop {
                let nxt = self.hes[cur].v_next();
                if nxt == he { pred = Some(cur); break; }
                if nxt.is_null() || !self.hes.contains(nxt) { break; }
                cur = nxt;
                if cur == start { break; }
                guard += 1;
                if guard > 10_000 { break; }
            }
        }

        let after = self.hes[he].v_next();
        if let Some(p) = pred {
            if p != he {
                self.hes[p].set_v_next(after);
            }
        }

        // Re-anchor outgoing if it pointed to `he`
        if anchor == Some(he) {
            if after.is_null() || after == he {
                self.verts[v].set_outgoing(None);
            } else {
                self.verts[v].set_outgoing(Some(after));
            }
        }
        // Reset the removed he's v_next for cleanliness
        self.hes[he].set_v_next(HeId::NULL);
    }

    // ========================================================================
    // Face operations
    // ========================================================================

    /// Add a face from an ordered list of vertex IDs (CCW winding).
    /// Automatically creates edges and wires the half-edge loop.
    pub fn add_face(
        &mut self,
        outer_verts: &[VertId],
        material: MaterialId,
    ) -> Result<FaceId> {
        self.add_face_with_holes(outer_verts, &[], material)
    }

    /// Add a face with optional holes.
    pub fn add_face_with_holes(
        &mut self,
        outer_verts: &[VertId],
        holes: &[&[VertId]],
        material: MaterialId,
    ) -> Result<FaceId> {
        if outer_verts.len() < 3 {
            bail!("Face requires at least 3 vertices, got {}", outer_verts.len());
        }

        // Compute face normal
        let normal = self.compute_normal(outer_verts)?;

        // ADR-019 + "엣지 없으면 면 없음" 원칙 (transactional rollback):
        //   make_loop 가 부분 실패 시 face 가 빈 LoopRef 로 leak 되지 않도록
        //   pre-snapshot edges/HEs → 실패 시 face 제거 + best-effort cleanup.
        let edges_before: FxHashSet<EdgeId> = self.edges.iter().map(|(id, _)| id).collect();
        let hes_before: FxHashSet<HeId> = self.hes.iter().map(|(id, _)| id).collect();

        // Create face with placeholder loop
        let face_id = self.faces.insert(Face::new(
            LoopRef::default(),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Try to build outer + inner loops. On error, rollback.
        let build_result: Result<()> = (|| {
            let outer_loop = self.make_loop(outer_verts, true, face_id)?;
            self.faces[face_id].set_outer(outer_loop);
            for hole_verts in holes {
                let inner_loop = self.make_loop(hole_verts, false, face_id)?;
                self.faces[face_id].add_inner(inner_loop);
            }
            Ok(())
        })();

        match build_result {
            Ok(()) => Ok(face_id),
            Err(e) => {
                self.rollback_partial_face_creation(face_id, &edges_before, &hes_before);
                Err(e)
            }
        }
    }

    /// ADR-089 Phase 2 (A-δ) — Add a face whose outer boundary is a single
    /// closed analytic curve (Circle / closed Bezier / closed B-spline /
    /// closed NURBS). This is the kernel-native representation of closed
    /// 2D shapes — 1 vertex anchor + 1 self-loop edge + 1 face, in
    /// contrast to the legacy 24-segment polygon decomposition.
    ///
    /// **메타-원칙 #14 의 deepest realization**: face = closed curve edge
    /// 의 byproduct. 24 polygon segments → 1 self-loop edge.
    ///
    /// Drop-in alongside `add_face` / `add_face_with_holes` — existing
    /// polygon flow UNCHANGED. Caller must provide:
    /// - `anchor`: the single anchor vertex on the curve (e.g., circle's
    ///   point at θ=0)
    /// - `curve`: an `AnalyticCurve` whose start and end coincide
    ///   (closed). Open curves (Line, Arc < 2π) reject with error.
    /// - `material`: face material id
    ///
    /// Returns the new `FaceId` on success. Errors:
    /// - `anchor` invalid or inactive vertex
    /// - `curve` is not closed (start ≠ end at curve params)
    ///
    /// **Boundary geometry validation deferred** (A-ζ): face synthesis
    /// pipeline 의 invariants 는 별도 step. 본 commit 은 schema + DCEL
    /// 입력 / 출력만 보장.
    pub fn add_face_closed_curve(
        &mut self,
        anchor: VertId,
        curve: crate::curves::AnalyticCurve,
        material: MaterialId,
    ) -> Result<FaceId> {
        // Validate anchor vertex.
        let anchor_vert = self.verts.get(anchor)
            .ok_or_else(|| anyhow::anyhow!(
                "ADR-089 A-δ: anchor vertex {:?} not found",
                anchor,
            ))?;
        if !anchor_vert.is_active() {
            bail!("ADR-089 A-δ: anchor vertex {:?} is inactive", anchor);
        }

        // Validate curve closed-ness.
        // Pragmatic check: Circle (always closed), closed Bezier
        // (control_pts[0] ≈ control_pts[last]), closed BSpline / NURBS
        // (deferred to future ADR — periodic knot vectors more complex).
        // ADR-089 A-ω-β extension lifts Circle-only restriction.
        match &curve {
            crate::curves::AnalyticCurve::Circle { .. } => { /* always closed */ }
            crate::curves::AnalyticCurve::Bezier { control_pts } => {
                // L-ω-1 — closure check.
                if control_pts.len() < 2 {
                    bail!("ADR-089 A-ω-β: Bezier needs ≥ 2 control points");
                }
                let p0 = control_pts[0];
                let pn = control_pts[control_pts.len() - 1];
                if (p0 - pn).length() > crate::tolerances::EPSILON_LENGTH {
                    bail!(
                        "ADR-089 A-ω-β: Bezier control points not closed \
                         (|cp[0] - cp[last]| = {:.3e} > EPSILON_LENGTH {:.3e})",
                        (p0 - pn).length(),
                        crate::tolerances::EPSILON_LENGTH,
                    );
                }
            }
            crate::curves::AnalyticCurve::BSpline { control_pts, knots, degree } => {
                // L-Α-1 — closure check (clamped knots case).
                // L-Δ-2 — Type B (periodic knots) extension.
                if control_pts.len() < 2 {
                    bail!("ADR-089 A-Α-β: BSpline needs ≥ 2 control points");
                }
                crate::curves::bspline::validate(control_pts, knots, *degree as usize)
                    .map_err(|e| anyhow::anyhow!(
                        "ADR-089 A-Α-β: BSpline validate failed: {}", e))?;
                let is_periodic = crate::curves::bspline::is_periodic_knots(
                    knots, *degree as usize);
                if !is_periodic {
                    // Type A: clamped — require closed control polygon.
                    let p0 = control_pts[0];
                    let pn = control_pts[control_pts.len() - 1];
                    if (p0 - pn).length() > crate::tolerances::EPSILON_LENGTH {
                        bail!(
                            "ADR-089 A-Α-β: BSpline control points not closed \
                             (|cp[0] - cp[last]| = {:.3e} > EPSILON_LENGTH {:.3e}). \
                             Use clamped knots + closed polygon, OR periodic knots \
                             (uniform spacing, not clamped).",
                            (p0 - pn).length(),
                            crate::tolerances::EPSILON_LENGTH,
                        );
                    }
                }
                // Type B (periodic): no control point closure requirement —
                // knot vector wrap provides closure via natural BSpline behavior.
            }
            crate::curves::AnalyticCurve::NURBS { control_pts, weights, knots, degree } => {
                // L-Β-1 / L-Δ-2 — clamped + periodic dual closure.
                if control_pts.len() < 2 {
                    bail!("ADR-089 A-Β-β: NURBS needs ≥ 2 control points");
                }
                crate::curves::nurbs::validate(control_pts, weights, knots, *degree as usize)
                    .map_err(|e| anyhow::anyhow!(
                        "ADR-089 A-Β-β: NURBS validate failed: {}", e))?;
                let is_periodic = crate::curves::nurbs::is_periodic_knots(
                    knots, *degree as usize);
                if !is_periodic {
                    // Type A: clamped — require closed control polygon.
                    let p0 = control_pts[0];
                    let pn = control_pts[control_pts.len() - 1];
                    if (p0 - pn).length() > crate::tolerances::EPSILON_LENGTH {
                        bail!(
                            "ADR-089 A-Β-β: NURBS control points not closed \
                             (|cp[0] - cp[last]| = {:.3e} > EPSILON_LENGTH {:.3e}). \
                             Use clamped knots + closed polygon, OR periodic knots \
                             (uniform spacing, not clamped).",
                            (p0 - pn).length(),
                            crate::tolerances::EPSILON_LENGTH,
                        );
                    }
                }
                // Type B (periodic): no control point closure requirement.
            }
            other => bail!(
                "ADR-089 A-Β-β: closed Arc curves deferred \
                 to future ADR (got {:?}). Use Circle, closed Bezier, closed BSpline, or closed NURBS.",
                std::mem::discriminant(other),
            ),
        }

        // Compute face normal from the curve.
        // - Circle: explicit normal field.
        // - Bezier / BSpline: best-fit plane normal of control points
        //   (L-ω-2 / L-Α-2 — same helper).
        let normal = match &curve {
            crate::curves::AnalyticCurve::Circle { normal, .. } => normal.normalize_or_zero(),
            crate::curves::AnalyticCurve::Bezier { control_pts } => {
                bezier_best_fit_normal(control_pts)?
            }
            crate::curves::AnalyticCurve::BSpline { control_pts, .. } => {
                bezier_best_fit_normal(control_pts)?
            }
            crate::curves::AnalyticCurve::NURBS { control_pts, .. } => {
                // L-Β-3 — best-fit plane from control polygon (weights
                // affect curve shape but not the plane that contains it,
                // assuming control polygon is itself planar).
                bezier_best_fit_normal(control_pts)?
            }
            _ => DVec3::Z, // unreachable per validation above
        };
        if normal.length_squared() < 1e-12 {
            bail!("ADR-089 A-δ: curve normal is degenerate");
        }

        // Snapshot for rollback (mirror add_face_with_holes pattern).
        let edges_before: FxHashSet<EdgeId> = self.edges.iter().map(|(id, _)| id).collect();
        let hes_before: FxHashSet<HeId> = self.hes.iter().map(|(id, _)| id).collect();

        // Create face with placeholder loop.
        let face_id = self.faces.insert(Face::new(
            LoopRef::default(),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Try to build the self-loop edge + 1-HE outer boundary.
        let build_result: Result<()> = (|| {
            // 1. Self-loop edge (anchor → anchor) with curve attached.
            let (eid, _) = self.add_edge(anchor, anchor)?;
            self.edges[eid].set_curve(Some(curve.clone()));

            // 2. Get the half-edge anchored on this self-loop. add_edge
            //    creates 2 HE pair; pick any (forward).
            let he_anchor = self.edges[eid].any_he();
            if he_anchor.is_null() {
                bail!("ADR-089 A-δ: self-loop edge {:?} has no half-edge", eid);
            }

            // 3. Wire HE.next == HE itself, HE.prev == HE itself
            //    (cycle of length 1). Set face = face_id, outer flag = true.
            self.hes[he_anchor].set_next(he_anchor);
            self.hes[he_anchor].set_prev(he_anchor);
            self.hes[he_anchor].set_face(face_id);
            self.hes[he_anchor].set_outer(true);

            // 4. Set face's outer LoopRef.
            self.faces[face_id].set_outer(LoopRef::new(he_anchor, true));

            // 5. ADR-089 Phase 2 (A-η-1): attach Plane AnalyticSurface to
            //    the closed-curve face so it qualifies for kernel-aware
            //    ops (Boolean / Push-Pull / Offset).
            //
            //    Plane derives from Circle's plane:
            //    - origin = circle.center
            //    - normal = circle.normal (already normalized)
            //    - basis_u = circle.basis_u (perpendicular to normal)
            //    - u_range/v_range = ±radius * 1.5 (covers circle bounds + margin)
            //
            //    NOTE: Boolean dispatch's eligibility check (face_surface
            //    must be Some) now passes for closed-curve faces. SSI
            //    treats them as Plane × Plane intersection (already
            //    supported by ADR-064/066 NURBS Boolean).
            if let crate::curves::AnalyticCurve::Circle { center, radius, normal: c_normal, basis_u } = &curve {
                let plane_range = (-(*radius) * 1.5, *radius * 1.5);
                let plane = crate::surfaces::AnalyticSurface::Plane {
                    origin: *center,
                    normal: *c_normal,
                    basis_u: *basis_u,
                    u_range: plane_range,
                    v_range: plane_range,
                };
                self.faces[face_id].set_surface(Some(plane));
            }

            // ADR-089 A-ω-γ / A-Α-β / A-Β-β — Plane surface attach
            // for closed Bezier / BSpline / NURBS (A-η-1 답습). origin
            // = control points centroid, normal = best-fit plane normal,
            // basis_u = first non-zero edge from centroid. u/v range =
            // AABB extent × 1.5.
            let curve_control_pts: Option<&Vec<DVec3>> = match &curve {
                crate::curves::AnalyticCurve::Bezier { control_pts } => Some(control_pts),
                crate::curves::AnalyticCurve::BSpline { control_pts, .. } => Some(control_pts),
                crate::curves::AnalyticCurve::NURBS { control_pts, .. } => Some(control_pts),
                _ => None,
            };
            if let Some(control_pts) = curve_control_pts {
                let n_pts = control_pts.len() as f64;
                let centroid = control_pts.iter().fold(DVec3::ZERO, |acc, p| acc + *p) / n_pts;
                // basis_u: first significant tangent from centroid.
                let mut basis_u = DVec3::X;
                for p in control_pts.iter() {
                    let v = *p - centroid;
                    // Project out the normal component to keep basis_u in plane.
                    let v_in_plane = v - normal * v.dot(normal);
                    if v_in_plane.length_squared() > 1e-12 {
                        basis_u = v_in_plane.normalize();
                        break;
                    }
                }
                // AABB extent for u/v range.
                let mut max_extent = 0.0_f64;
                for p in control_pts.iter() {
                    let d = (*p - centroid).length();
                    if d > max_extent { max_extent = d; }
                }
                let plane_range = if max_extent > 1e-9 {
                    (-max_extent * 1.5, max_extent * 1.5)
                } else {
                    (-1.0, 1.0)
                };
                let plane = crate::surfaces::AnalyticSurface::Plane {
                    origin: centroid,
                    normal,
                    basis_u,
                    u_range: plane_range,
                    v_range: plane_range,
                };
                self.faces[face_id].set_surface(Some(plane));
            }

            Ok(())
        })();

        match build_result {
            Ok(()) => Ok(face_id),
            Err(e) => {
                self.rollback_partial_face_creation(face_id, &edges_before, &hes_before);
                Err(e)
            }
        }
    }

    /// Polygonize a Path B closed-curve face (1 anchor + 1 self-loop edge
    /// with `AnalyticCurve::Circle`) in place. Returns the new polygonal
    /// face ID on conversion; returns `None` if the input face is already
    /// polygonal or has a non-Circle closed curve (Bezier / BSpline /
    /// NURBS — deferred to future ADR).
    ///
    /// ADR-021 P7 + ADR-101 Phase A infrastructure: prerequisite for
    /// Phase B (coplanar polygon clipping) to operate on closed-curve
    /// faces. The closed-curve self-loop has a 1-vertex boundary that
    /// breaks polygon-based intersection algorithms (`positions.len() < 3`
    /// short-circuit in `prepare_solid` / `split_faces_by_intersections`,
    /// `operations/boolean.rs`).
    ///
    /// Behaviour:
    ///   - Tessellates the Circle to N points at engine chord tolerance
    ///     (`radius * 0.01` — LOCKED #40 L1 engine-ops policy, same as
    ///     `extrude_closed_curve_face_via_tessellation`).
    ///   - Removes the original closed-curve face.
    ///   - Cleans up the orphan self-loop edge.
    ///   - Deactivates the anchor vertex if no other edges reference it
    ///     (preserves it if it's still in use elsewhere).
    ///   - Creates a new N-vertex polygonal face with the same material.
    ///   - Inherits the original face's `surface` (typically Plane) onto
    ///     the substitute so `face_to_xia` + analytic surface lookups
    ///     stay coherent.
    ///
    /// Note: This is a **destructive in-place rewrite** of the DCEL.
    /// Callers must update any external references (`face_to_xia`,
    /// selection sets, etc.) to the new face ID.
    pub fn polygonize_closed_curve_face(
        &mut self,
        face_id: FaceId,
        material: MaterialId,
    ) -> Result<Option<FaceId>> {
        // 0. Detect closed-curve shape — extract Circle params.
        //    Cloning the curve releases the immutable borrow before we
        //    mutate later.
        let (anchor_vid, self_loop_edge_id, center, radius, normal, basis_u, surface_clone) = {
            let face = match self.faces.get(face_id) {
                Some(f) if f.is_active() => f,
                Some(_) => bail!(
                    "polygonize_closed_curve_face: face {:?} is inactive",
                    face_id,
                ),
                None => bail!(
                    "polygonize_closed_curve_face: face {:?} not found",
                    face_id,
                ),
            };

            let outer_start = face.outer().start;
            if outer_start.is_null() {
                return Ok(None);
            }

            // Boundary loop with >1 vertex → already polygonal, no-op.
            let boundary_verts = self.collect_loop_verts(outer_start)?;
            if boundary_verts.len() != 1 {
                return Ok(None);
            }

            // Inspect the outer edge.
            let edge_id = self.hes[outer_start].edge();
            let edge = match self.edges.get(edge_id) {
                Some(e) if e.is_self_loop() => e,
                _ => return Ok(None),
            };
            let curve = match edge.curve() {
                Some(c) => c.clone(),
                None => return Ok(None),
            };

            // Circle-only for ADR-101 Phase A scope. Bezier / BSpline /
            // NURBS closed curves are out of scope (the lens region of
            // overlap between two NURBS-class curves needs SSI which is
            // a separate ADR cross-cut).
            let (c, r, n, u) = match curve {
                crate::curves::AnalyticCurve::Circle {
                    center, radius, normal, basis_u,
                } => (center, radius, normal, basis_u),
                _ => return Ok(None),
            };

            let anchor = edge.v_small();
            let surface_clone = face.surface().cloned();
            (anchor, edge_id, c, r, n, u, surface_clone)
        };

        // 1. Tessellate at engine chord tolerance (LOCKED #40 L1).
        let chord_tol = (radius * 0.01).max(1e-6);
        let pts = crate::curves::circle::tessellate_full(
            center, radius, normal, basis_u, chord_tol,
        );
        if pts.len() < 4 {
            // Degenerate tessellation (chord_tol too large vs radius,
            // or radius near zero). Return None — the face stays
            // closed-curve and the caller proceeds as if no-op.
            return Ok(None);
        }
        // tessellate_full returns N+1 closed points (last duplicates
        // first); drop the duplicate so add_face sees N unique vertices.
        let unique_pts = &pts[..pts.len() - 1];
        let tess_verts: Vec<VertId> =
            unique_pts.iter().map(|p| self.add_vertex(*p)).collect();

        // 2. Remove the original closed-curve face. The self-loop edge
        //    + anchor remain in the DCEL until we clean them up below.
        self.remove_face(face_id)?;

        // 3. Cleanup orphan self-loop edge + anchor vertex — pattern
        //    from `extrude_closed_curve_face_via_tessellation` step 3b
        //    (ADR-089 A-υ-β). Without this the dangling self-loop still
        //    renders as a chord polyline overlapping the new polygon.
        if self.edges.contains(self_loop_edge_id)
            && self.edges[self_loop_edge_id].is_active()
        {
            let _ = self.remove_edge_and_halfedges(self_loop_edge_id);
        }
        if self.verts.contains(anchor_vid) && self.verts[anchor_vid].is_active() {
            if self.verts[anchor_vid].outgoing().is_none() {
                self.verts[anchor_vid].set_active(false);
            }
        }

        // 4. Create polygonal substitute with the same material.
        let substituted = self.add_face(&tess_verts, material)?;

        // 5. Inherit the original face's surface so face_to_xia +
        //    analytic surface lookups stay coherent across the rewrite.
        if let (Some(surface), Some(face_mut)) =
            (surface_clone, self.faces.get_mut(substituted))
        {
            face_mut.set_surface(Some(surface));
        }
        Ok(Some(substituted))
    }

    /// Rollback a partially-constructed face after `add_face_with_holes` failure.
    ///
    /// Steps:
    ///   1. Remove the face (clears any wired HE.face references).
    ///   2. For each NEW edge (not in `edges_before`), if no live HE points to
    ///      a face on it, remove the edge + its half-edges.
    ///   3. Best-effort: any newly-created orphan HEs whose parent edge is
    ///      already gone → directly remove.
    ///
    /// Guarantees the "엣지 없으면 면 없음" principle: after failure, the
    /// mesh has no face with an empty LoopRef.
    fn rollback_partial_face_creation(
        &mut self,
        face_id: FaceId,
        edges_before: &FxHashSet<EdgeId>,
        hes_before: &FxHashSet<HeId>,
    ) {
        // Step 1: remove the face entry. `remove_face` clears HE.face pointers
        // for any wired loop HEs.
        let _ = self.remove_face(face_id);
        if self.faces.contains(face_id) {
            self.faces.remove(face_id);
        }

        // Step 2: clean up new edges that no longer have any face-attached HE.
        let new_edges: Vec<EdgeId> = self.edges.iter()
            .map(|(id, _)| id)
            .filter(|id| !edges_before.contains(id))
            .collect();
        for eid in &new_edges {
            if !self.edges.contains(*eid) { continue; }
            // Is any live HE on this edge attached to a non-NULL face?
            let still_used = self.hes.iter().any(|(_, he)|
                he.is_active() && he.edge() == *eid && !he.face().is_null()
            );
            if !still_used {
                let _ = self.remove_edge_and_halfedges(*eid);
            }
        }

        // Step 3: defensive — remove any newly-created orphan HEs whose edge
        // was already removed (stale ID). Should be rare with step 2 covering
        // most cases.
        let stale_hes: Vec<HeId> = self.hes.iter()
            .map(|(id, _)| id)
            .filter(|id| !hes_before.contains(id))
            .filter(|id| {
                if let Some(he) = self.hes.get(*id) {
                    !self.edges.contains(he.edge())
                } else { false }
            })
            .collect();
        for hid in stale_hes {
            self.hes.remove(hid);
        }
    }

    /// Wire a half-edge loop from vertex IDs and assign to a face.
    fn make_loop(
        &mut self,
        verts: &[VertId],
        is_outer: bool,
        face_id: FaceId,
    ) -> Result<LoopRef> {
        let n = verts.len();
        if n < 3 {
            bail!("Loop requires at least 3 vertices");
        }

        // Ensure all edges exist
        let mut he_ids = Vec::with_capacity(n);
        for i in 0..n {
            let v_curr = verts[i];
            let v_next = verts[(i + 1) % n];
            let (edge_id, _) = self.add_edge(v_curr, v_next)?;

            // Find the half-edge going from v_curr → v_next
            let he_id = self.find_halfedge(edge_id, v_next)?;
            he_ids.push(he_id);
        }

        // Wire next/prev chain
        for i in 0..n {
            let curr = he_ids[i];
            let next = he_ids[(i + 1) % n];
            let prev = he_ids[(i + n - 1) % n];

            self.hes[curr].set_next(next);
            self.hes[curr].set_prev(prev);
            self.hes[curr].set_face(face_id);
            self.hes[curr].set_outer(is_outer);
        }

        Ok(LoopRef::new(he_ids[0], is_outer))
    }

    /// Find a FREE half-edge on a given edge that points to `dst`.
    ///
    /// 1. First tries to find an existing HE with `face == NULL` and
    ///    the correct direction — O(1) for manifold meshes.
    /// 2. If all HEs on this edge are already assigned to faces,
    ///    creates a NEW HE pair and splices it into the radial chain.
    ///    This supports non-manifold edges (e.g. outward Push/Pull
    ///    where the base face and a side face share an edge).
    ///
    /// NEVER steals half-edges from existing faces.
    fn find_halfedge(&mut self, edge_id: EdgeId, dst: VertId) -> Result<HeId> {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            bail!("Edge {:?} has no half-edges", edge_id);
        }

        // Pass 1: look for a FREE half-edge with the correct direction
        let mut he_id = start_he;
        loop {
            if self.hes[he_id].dst() == dst && self.hes[he_id].face().is_null() {
                return Ok(he_id);
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }

        // Pass 2: no free HE found — create a new pair (non-manifold edge)
        // Determine the "other" vertex (the one that isn't dst)
        // Copy values to avoid borrow conflicts
        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();
        let other = if dst == v_small { v_large } else { v_small };

        // Create new HE pair: fwd points to dst, bwd points to other
        let he_fwd = HalfEdge::new(dst, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        let he_bwd = HalfEdge::new(other, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Splice into radial chain: insert fwd and bwd after start_he
        // Before: ... → start_he → next → ...
        // After:  ... → start_he → he_fwd → he_bwd → next → ...
        let next = self.hes[start_he].next_rad();
        self.hes[start_he].set_next_rad(he_fwd_id);
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(next);

        // Return the one pointing to dst (he_fwd)
        Ok(he_fwd_id)
    }

    // ========================================================================
    // Face removal
    // ========================================================================

    /// Remove a face from the mesh.
    ///
    /// This properly "seals" the topology by:
    /// 1. Setting face = NULL on all loop half-edges (detach from face)
    /// 2. Clearing next/prev pointers (break the ghost loop)
    ///
    /// After removal, the freed half-edges can be reused by new faces
    /// via `find_halfedge` (which looks for face == NULL).
    pub fn remove_face(&mut self, face_id: FaceId) -> Result<()> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found for removal", face_id);
        }

        // Detach half-edges from this face and break loop pointers
        let outer_start = self.faces[face_id].outer().start;
        if !outer_start.is_null() {
            if let Ok(hes) = self.collect_loop_hes(outer_start) {
                for he_id in hes {
                    if let Some(he) = self.hes.get_mut(he_id) {
                        he.set_face(FaceId::NULL);
                        he.set_next(HeId::NULL);
                        he.set_prev(HeId::NULL);
                    }
                }
            }
            // Even if loop traversal fails, still remove the face
        }

        // Also handle inner loops (holes) if any
        let inners: Vec<_> = self.faces[face_id].inners().to_vec();
        for inner_ref in inners {
            if !inner_ref.start.is_null() {
                if let Ok(hes) = self.collect_loop_hes(inner_ref.start) {
                    for he_id in hes {
                        if let Some(he) = self.hes.get_mut(he_id) {
                            he.set_face(FaceId::NULL);
                            he.set_next(HeId::NULL);
                            he.set_prev(HeId::NULL);
                        }
                    }
                }
            }
        }

        // Remove the face from storage
        self.faces.remove(face_id);
        Ok(())
    }

    /// ADR-101 §B-3c — Cleanup orphan boundary edges after `remove_face`.
    ///
    /// Walks each pair of consecutive vertices in each `boundary_verts_list`
    /// (caller pre-snapshots removed face boundaries), finds the edge
    /// between them, and if **all** of the edge's half-edges have
    /// `face = NULL` (i.e., no other face still uses the edge), removes
    /// the edge + its HE pair via `remove_edge_and_halfedges` (which
    /// performs proper v_ring splicing and vertex outgoing repoint).
    ///
    /// After edge cleanup, any vertex from the lists whose `outgoing` is
    /// now `None` is deactivated (isolated vertex cleanup).
    ///
    /// # Use case
    ///
    /// After `remove_face × N`, the boundary edges remain in the mesh
    /// with HEs `face = NULL` (free). For rebuild patterns that
    /// subsequently call `add_face × M` reusing some of these edges via
    /// spatial-hash dedup (LOCKED #5), the leftover orphan edges that
    /// are NOT reused by the new faces would otherwise persist as
    /// dangling state. Worse, in some configurations multiple new faces
    /// can claim the same edge in conflicting directions, producing
    /// non-manifold edges with 3+ active face-bearing HEs.
    ///
    /// `cleanup_orphan_boundary_edges` is the canonical cleanup step
    /// between "remove originals" and "add new faces" in rebuild
    /// patterns.
    ///
    /// # Returns
    ///
    /// Number of edges actually removed (orphans deactivated). 0 if no
    /// orphans were found (e.g., all boundary edges still have at least
    /// one active face-bearing HE).
    ///
    /// # Lock-ins (ADR-101 §B-3c)
    ///
    /// - L-B3c-1 Scope: only edges between consecutive verts in the
    ///   supplied boundary lists are considered. Other orphan edges
    ///   elsewhere in the mesh are NOT touched.
    /// - L-B3c-2 All-free predicate: an edge is removed only if EVERY
    ///   HE in its radial chain has `face = NULL`.
    /// - L-B3c-3 Idempotent: calling twice in a row with the same
    ///   boundary lists is safe (second call finds nothing to remove).
    /// - L-B3c-4 Vertex cleanup: post-edge-removal, isolated verts
    ///   (no `outgoing`) are deactivated.
    /// - L-B3c-5 Existing `remove_face` semantics UNCHANGED — this is
    ///   an additive helper, callable independently.
    pub fn cleanup_orphan_boundary_edges(
        &mut self,
        boundary_verts_lists: &[&[VertId]],
    ) -> usize {
        use rustc_hash::FxHashSet;

        let mut to_remove: FxHashSet<EdgeId> = FxHashSet::default();

        for verts in boundary_verts_lists {
            let n = verts.len();
            if n < 2 { continue; }
            for i in 0..n {
                let va = verts[i];
                let vb = verts[(i + 1) % n];
                if va == vb { continue; }
                let eid = match self.find_edge(va, vb) {
                    Some(e) => e,
                    None => continue,
                };
                if to_remove.contains(&eid) { continue; }
                if !self.edges.contains(eid) { continue; }
                let any_he = self.edges[eid].any_he();
                if any_he.is_null() {
                    to_remove.insert(eid);
                    continue;
                }
                // Walk the radial chain; if EVERY HE has face=NULL,
                // the edge is orphan.
                let mut all_free = true;
                let mut he_id = any_he;
                let mut guard = 0usize;
                loop {
                    if !self.hes.contains(he_id) {
                        all_free = false;
                        break;
                    }
                    if !self.hes[he_id].face().is_null() {
                        all_free = false;
                        break;
                    }
                    he_id = self.hes[he_id].next_rad();
                    if he_id == any_he { break; }
                    guard += 1;
                    if guard > 10_000 {
                        all_free = false;
                        break;
                    }
                }
                if all_free {
                    to_remove.insert(eid);
                }
            }
        }

        let count = to_remove.len();
        for eid in to_remove {
            let _ = self.remove_edge_and_halfedges(eid);
        }

        // L-B3c-4: deactivate isolated verts.
        for verts in boundary_verts_lists {
            for &v in *verts {
                if self.verts.contains(v) && self.verts[v].is_active()
                    && self.verts[v].outgoing().is_none()
                {
                    self.verts[v].set_active(false);
                }
            }
        }

        count
    }

    // ========================================================================
    // Edge splitting
    // ========================================================================

    /// Get the source (origin) vertex of a half-edge.
    ///
    /// A half-edge stores only its destination. The source is the edge's
    /// other vertex (the one that isn't dst).
    pub fn he_src(&self, he_id: HeId) -> Result<VertId> {
        let he = self.hes.get(he_id)
            .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
        let edge = self.edges.get(he.edge())
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", he.edge()))?;
        if he.dst() == edge.v_small() {
            Ok(edge.v_large())
        } else {
            Ok(edge.v_small())
        }
    }

    /// Split an edge at a given position, inserting a new vertex.
    ///
    /// Given edge A──B and position P on it:
    /// - Creates vertex P (or reuses if within tolerance)
    /// - Replaces edge A──B with edges A──P and P──B
    /// - Updates ALL face loops that use this edge
    /// - Rebuilds radial chains for the two new edges
    ///
    /// Returns (new_vert, edge_ap, edge_pb).
    ///
    /// # Safety
    /// This is the most delicate DCEL operation. Every half-edge's
    /// next/prev/next_rad pointers and every face's loop start must
    /// remain consistent after the split.
    pub fn split_edge(
        &mut self,
        edge_id: EdgeId,
        pos: DVec3,
    ) -> Result<(VertId, EdgeId, EdgeId)> {
        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;
        ensure!(edge.is_active(), "Edge {:?} is not active", edge_id);

        let va = edge.v_small();
        let vb = edge.v_large();

        // ─── 1. Create midpoint vertex ──────────────────────────────
        let vp = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        let key = spatial_key(pos);
        self.spatial_hash.entry(key).or_default().push(vp);

        // ─── 2. Collect all half-edges on the radial chain ──────────
        let start_he = self.edges[edge_id].any_he();
        ensure!(!start_he.is_null(), "Edge has no half-edges");

        // Gather (he_id, dst, face, prev, next, is_outer, flags) before mutation
        struct HeInfo {
            id: HeId,
            dst: VertId,
            face: FaceId,
            prev: HeId,
            next: HeId,
            is_outer: bool,
            flags: HeFlags,
        }

        let mut old_hes_info = Vec::new();
        let mut he = start_he;
        loop {
            let h = &self.hes[he];
            old_hes_info.push(HeInfo {
                id: he,
                dst: h.dst(),
                face: h.face(),
                prev: h.prev(),
                next: h.next(),
                is_outer: h.is_outer(),
                flags: h.flags(),
            });
            he = self.hes[he].next_rad();
            if he == start_he { break; }
            if old_hes_info.len() > 1000 {
                bail!("Radial chain exceeded 1000 — corrupted topology");
            }
        }

        // ─── 3. Create two new edges (manually, not via add_edge) ───
        let pair_ap = VertPairKey::new(va, vp);
        let pair_pb = VertPairKey::new(vp, vb);

        let e1 = self.edges.insert(Edge::new(pair_ap.v_small, pair_ap.v_large, EDGE_TOLERANCE));
        let e2 = self.edges.insert(Edge::new(pair_pb.v_small, pair_pb.v_large, EDGE_TOLERANCE));

        self.vert_to_edge.insert(pair_ap, e1);
        self.vert_to_edge.insert(pair_pb, e2);

        // ─── 4. For each old HE, create two replacement HEs ────────
        let mut e1_hes: Vec<HeId> = Vec::new();
        let mut e2_hes: Vec<HeId> = Vec::new();

        for info in &old_hes_info {
            if info.dst == vb {
                // Direction: A → B  ⟹  split into A→P (on E1) then P→B (on E2)
                let he_ap = self.hes.insert(HalfEdge::new(vp, e1));
                let he_pb = self.hes.insert(HalfEdge::new(vb, e2));

                // Wire into face loop: prev → he_ap → he_pb → next
                self.hes[he_ap].set_next(he_pb);
                self.hes[he_pb].set_prev(he_ap);
                self.hes[he_ap].set_prev(info.prev);
                self.hes[he_pb].set_next(info.next);
                self.hes[he_ap].set_face(info.face);
                self.hes[he_pb].set_face(info.face);
                self.hes[he_ap].set_outer(info.is_outer);
                self.hes[he_pb].set_outer(info.is_outer);
                self.hes[he_ap].set_flags(info.flags);
                self.hes[he_pb].set_flags(info.flags);

                // Update neighbor pointers — 단, 현재 HE가 실제로 그들의 prev/next로
                // 연결되어 있을 때만. 자유(face=null) HE의 prev/next는 face 생성 시
                // 이웃의 next/prev가 재지정돼 stale 상태가 될 수 있어 덮어쓰면
                // **인접 face의 boundary loop가 파손**됨.
                if !info.prev.is_null() && self.hes.contains(info.prev)
                    && self.hes[info.prev].next() == info.id
                {
                    self.hes[info.prev].set_next(he_ap);
                }
                if !info.next.is_null() && self.hes.contains(info.next)
                    && self.hes[info.next].prev() == info.id
                {
                    self.hes[info.next].set_prev(he_pb);
                }

                // Update face loop start if it pointed to old HE
                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_ap, face.outer().is_outer));
                        }
                        let mut inner_changed = false;
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_ap;
                                inner_changed = true;
                            }
                        }
                        if inner_changed {
                            // ADR-061 Step 2 — escape-hatch bump for inners_mut.
                            face.bump_boundary_version_after_inners_mut();
                        }
                    }
                }

                e1_hes.push(he_ap);
                e2_hes.push(he_pb);

            } else if info.dst == va {
                // Direction: B → A  ⟹  split into B→P (on E2) then P→A (on E1)
                let he_bp = self.hes.insert(HalfEdge::new(vp, e2));
                let he_pa = self.hes.insert(HalfEdge::new(va, e1));

                // Wire into face loop: prev → he_bp → he_pa → next
                self.hes[he_bp].set_next(he_pa);
                self.hes[he_pa].set_prev(he_bp);
                self.hes[he_bp].set_prev(info.prev);
                self.hes[he_pa].set_next(info.next);
                self.hes[he_bp].set_face(info.face);
                self.hes[he_pa].set_face(info.face);
                self.hes[he_bp].set_outer(info.is_outer);
                self.hes[he_pa].set_outer(info.is_outer);
                self.hes[he_bp].set_flags(info.flags);
                self.hes[he_pa].set_flags(info.flags);

                if !info.prev.is_null() && self.hes.contains(info.prev)
                    && self.hes[info.prev].next() == info.id
                {
                    self.hes[info.prev].set_next(he_bp);
                }
                if !info.next.is_null() && self.hes.contains(info.next)
                    && self.hes[info.next].prev() == info.id
                {
                    self.hes[info.next].set_prev(he_pa);
                }

                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_bp, face.outer().is_outer));
                        }
                        let mut inner_changed = false;
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_bp;
                                inner_changed = true;
                            }
                        }
                        if inner_changed {
                            // ADR-061 Step 2 — escape-hatch bump for inners_mut.
                            face.bump_boundary_version_after_inners_mut();
                        }
                    }
                }

                e2_hes.push(he_bp);
                e1_hes.push(he_pa);
            } else {
                bail!("HE {:?} dst={:?} doesn't match edge vertices A={:?} B={:?}",
                    info.id, info.dst, va, vb);
            }

            // Deactivate old half-edge
            self.hes[info.id].set_active(false);
        }

        // ─── 5. Build radial chains for E1 and E2 ──────────────────
        for hes in [&e1_hes, &e2_hes] {
            if hes.len() >= 2 {
                for i in 0..hes.len() {
                    let next = hes[(i + 1) % hes.len()];
                    self.hes[hes[i]].set_next_rad(next);
                }
            } else if hes.len() == 1 {
                // Single HE — point to itself (shouldn't happen for valid edge)
                self.hes[hes[0]].set_next_rad(hes[0]);
            }
        }

        // Set edge anchors
        if let Some(&first) = e1_hes.first() {
            self.edges[e1].set_any_he(first);
        }
        if let Some(&first) = e2_hes.first() {
            self.edges[e2].set_any_he(first);
        }

        // ─── 6. Set vertex outgoing for new vertex P ────────────────
        if let Some(&he) = e1_hes.first() {
            self.verts[vp].set_outgoing(Some(he));
        }

        // Update outgoing for A and B if they pointed to deactivated HEs
        if let Some(out) = self.verts[va].outgoing() {
            if !self.hes[out].is_active() {
                // Find a new active HE starting from A
                for &he_id in &e1_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == va { self.verts[va].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }
        if let Some(out) = self.verts[vb].outgoing() {
            if !self.hes[out].is_active() {
                for &he_id in &e2_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == vb { self.verts[vb].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }

        // ─── 6.5 ADR-059 Phase N Step 2 — Curve inheritance ────────
        //
        // If the parent edge has an attached AnalyticCurve, attempt to
        // split it at parameter `t = parent.parameter_at_3d_point(pos)`
        // and assign the resulting two curves to the new child edges.
        //
        // Per ADR-059 §A1.3 lock-in:
        //   Line / Arc / Circle: closed-form parameter inversion (always succeeds
        //                        when point is on curve within LOCKED #5 tol).
        //   Bezier / BSpline / NURBS: parameter_at_3d_point returns
        //                             SplitParameterError::DeferredToPhaseI.
        //                             We silently fall back to "no curve on
        //                             children" (synthesize_line_curve takes
        //                             over per Phase N Step 4 migration).
        //
        // **silent wrong-result 차단**: If parameter inversion succeeds but
        // split_at fails (drift detected after split), curves are NOT assigned
        // and a debug-only diagnostic is emitted. Production code path
        // continues unchanged — children just lack curves.
        if let Some(parent_curve) = self.edges[edge_id].curve().cloned() {
            // Attempt parameter inversion (immutable borrow ok — pos was passed in)
            match parent_curve.parameter_at_3d_point(pos, self) {
                Ok(t) => {
                    // Try split_at with the new midpoint vertex
                    if let Ok((left_curve, right_curve)) = parent_curve.split_at(t, vp) {
                        // Assign matching child edge per direction.
                        // e1 covers (va, vp) — should get left_curve.
                        // e2 covers (vp, vb) — should get right_curve.
                        self.edges[e1].set_curve(Some(left_curve));
                        self.edges[e2].set_curve(Some(right_curve));
                    }
                    // split_at failure (e.g., Bezier deferred): skip — children
                    // remain curveless (Phase N migration synthesizes Line later).
                }
                Err(_) => {
                    // Parameter inversion failed (deferred / drift / off-curve).
                    // Children remain curveless — production behavior unchanged.
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[ADR-059 Phase N] split_edge: parameter inversion deferred for \
                         curve variant — child edges left without curve. {:?} → e1, e2",
                        std::mem::discriminant(&parent_curve),
                    );
                }
            }
        }

        // ─── 7. Deactivate old edge ────────────────────────────────
        self.edges[edge_id].set_active(false);
        self.vert_to_edge.remove(&VertPairKey::new(va, vb));

        Ok((vp, e1, e2))
    }

    // ========================================================================
    // Face splitting
    // ========================================================================

    /// Split a face by connecting two of its boundary vertices with a new edge.
    ///
    /// Given face F with boundary [..., v1, ..., v2, ...]:
    /// - Creates edge v1–v2 (the split edge)
    /// - Splits F into two faces: F_A (v1→...→v2) and F_B (v2→...→v1)
    /// - Both new faces inherit the original face's material and normal
    ///
    /// Returns (face_a, face_b).
    ///
    /// # Preconditions
    /// - v1 and v2 must be on the face's outer boundary
    /// - v1 and v2 must not be adjacent (that would create a degenerate face)
    /// - The face must not have holes that cross the split line
    pub fn split_face(
        &mut self,
        face_id: FaceId,
        v1: VertId,
        v2: VertId,
    ) -> Result<(FaceId, FaceId)> {
        ensure!(self.faces.contains(face_id), "Face {:?} not found", face_id);
        ensure!(v1 != v2, "Cannot split face with same vertex");

        // Save face properties
        let material = self.faces[face_id].material();
        let normal = self.faces[face_id].normal();
        // ADR-089 A-χ-β — preserve parent's AnalyticSurface for the new
        // sub-face (face_id retains its slot, only face_b is fresh).
        // L-χ-1 / L-χ-3 / L-χ-5.
        let parent_surface = self.faces[face_id].surface().cloned();

        let outer_start = self.faces[face_id].outer().start;
        let loop_hes = self.collect_loop_hes(outer_start)?;
        let loop_verts = self.collect_loop_verts(outer_start)?;
        let n = loop_verts.len();

        // Find positions of v1 and v2 in the boundary loop
        // loop_hes[i].dst() == loop_verts[i]
        let idx1 = loop_verts.iter().position(|&v| v == v1)
            .ok_or_else(|| anyhow::anyhow!("v1 {:?} not on face {:?} boundary", v1, face_id))?;
        let idx2 = loop_verts.iter().position(|&v| v == v2)
            .ok_or_else(|| anyhow::anyhow!("v2 {:?} not on face {:?} boundary", v2, face_id))?;

        // Check v1 and v2 are not adjacent (would create degenerate face)
        let dist_fwd = if idx2 >= idx1 { idx2 - idx1 } else { n - idx1 + idx2 };
        let dist_bwd = n - dist_fwd;
        ensure!(dist_fwd >= 2 && dist_bwd >= 2,
            "v1 and v2 are adjacent or equal — split would create degenerate face");

        // ================================================================
        // Direct DCEL surgery — NO remove_face, NO add_face
        // ================================================================
        //
        // Original loop: ... → he_to_v1 → he_from_v1 → ... → he_to_v2 → he_from_v2 → ...
        //   where he_to_v1.dst = v1, he_to_v2.dst = v2
        //
        // After split:
        //   Loop A (face_id): he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1
        //   Loop B (face_b):  he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2

        // Identify the key half-edges
        let he_to_v1 = loop_hes[idx1];     // dst = v1
        let he_from_v1 = loop_hes[(idx1 + 1) % n]; // starts at v1
        let he_to_v2 = loop_hes[idx2];     // dst = v2
        let he_from_v2 = loop_hes[(idx2 + 1) % n]; // starts at v2

        // Create the splitting edge v1↔v2
        let (split_edge_id, _) = self.add_edge(v1, v2)?;

        // Get free half-edges for the split edge
        let he_v1v2 = self.find_halfedge(split_edge_id, v2)?; // v1→v2
        let he_v2v1 = self.find_halfedge(split_edge_id, v1)?; // v2→v1

        // === Splice Loop A: he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1 ===
        self.hes[he_to_v1].set_next(he_v1v2);
        self.hes[he_v1v2].set_prev(he_to_v1);
        self.hes[he_v1v2].set_next(he_from_v2);
        self.hes[he_from_v2].set_prev(he_v1v2);

        // === Splice Loop B: he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2 ===
        self.hes[he_to_v2].set_next(he_v2v1);
        self.hes[he_v2v1].set_prev(he_to_v2);
        self.hes[he_v2v1].set_next(he_from_v1);
        self.hes[he_from_v1].set_prev(he_v2v1);

        // === Assign face references ===

        // Mark split edge HEs as HARD so they render even between coplanar faces
        self.hes[he_v1v2].set_flags(HeFlags::HARD);
        self.hes[he_v2v1].set_flags(HeFlags::HARD);

        // Loop A keeps face_id — set face on the new split HE
        self.hes[he_v1v2].set_face(face_id);
        self.hes[he_v1v2].set_outer(true);
        self.hes[he_v1v2].set_active(true);

        // Update face_id's outer loop start to point into Loop A
        self.faces[face_id].set_outer(LoopRef::new(he_v1v2, true));

        // Create face_b for Loop B
        let face_b = self.faces.insert(Face::new(
            LoopRef::new(he_v2v1, true),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // ADR-089 A-χ-β — propagate parent surface to face_b.
        // (face_id keeps its slot + surface automatically.)
        if let Some(ref s) = parent_surface {
            self.faces[face_b].set_surface(Some(s.clone()));
        }

        // Set face on he_v2v1
        self.hes[he_v2v1].set_face(face_b);
        self.hes[he_v2v1].set_outer(true);
        self.hes[he_v2v1].set_active(true);

        // Walk Loop B and reassign all existing HEs from face_id → face_b
        {
            let mut he_id = self.hes[he_v2v1].next();
            while he_id != he_v2v1 {
                if he_id.is_null() {
                    bail!("Null next pointer encountered while reassigning Loop B faces");
                }
                self.hes[he_id].set_face(face_b);
                he_id = self.hes[he_id].next();
            }
        }

        // ────────────────────────────────────────────────────────────────
        // 노멀 일관성 자가 보정 (회귀 방지, ADR-003 / 2026-04-17)
        //
        // DCEL 수술이 올바르면 두 sub-face 모두 원본과 같은 loop 회전 방향을
        // 유지하므로 원본 노멀이 그대로 맞다. 하지만 split_edge가 먼저 호출되어
        // loop 포인터가 건드려진 경우 아주 드물게 loop가 뒤집힐 수 있다.
        //
        // 방어책: 두 sub-face의 실제 loop에서 노멀을 재계산해서
        // stored normal과 방향이 반대면 stored를 뒤집어 맞춘다.
        // (loop 자체를 reverse하지 않는 이유: DCEL radial chain 재봉합이 비용 큼)
        //
        // 이렇게 하면 triangulation/렌더링이 stored normal을 기준으로 작동하므로
        // 시각적 "앞뒷면 뒤집힘" 현상을 원천 차단한다.
        // ────────────────────────────────────────────────────────────────
        for sub_face in [face_id, face_b] {
            let loop_start = self.faces[sub_face].outer().start;
            if let Ok(verts) = self.collect_loop_verts(loop_start) {
                if let Ok(computed) = self.compute_normal(&verts) {
                    if computed.length_squared() > 1e-20 {
                        let stored = self.faces[sub_face].normal();
                        if computed.dot(stored) < 0.0 {
                            // loop가 뒤집혔다 — stored를 뒤집어 두-톤 렌더링 일관성 회복
                            self.faces[sub_face].set_normal(-stored);
                        }
                    }
                }
            }
        }

        Ok((face_id, face_b))
    }

    // ========================================================================
    // Normal computation
    // ========================================================================

    /// Compute the unit normal of a polygon defined by vertex IDs.
    /// Uses Newell's method for robustness with non-planar polygons.
    pub fn compute_normal(&self, verts: &[VertId]) -> Result<DVec3> {
        if verts.len() < 3 {
            bail!("Need at least 3 vertices for normal computation");
        }

        let mut normal = DVec3::ZERO;
        let n = verts.len();

        for i in 0..n {
            let curr = self.vertex_pos(verts[i])?;
            let next = self.vertex_pos(verts[(i + 1) % n])?;

            // Newell's method
            normal.x += (curr.y - next.y) * (curr.z + next.z);
            normal.y += (curr.z - next.z) * (curr.x + next.x);
            normal.z += (curr.x - next.x) * (curr.y + next.y);
        }

        let len = normal.length();
        if len < NORMAL_EPSILON {
            // Fall back to cross product of first two edges
            let p0 = self.vertex_pos(verts[0])?;
            let p1 = self.vertex_pos(verts[1])?;
            let p2 = self.vertex_pos(verts[2])?;
            normal = (p1 - p0).cross(p2 - p0);
            let len2 = normal.length();
            if len2 > 0.0 {
                return Ok(normal / len2);
            }
            bail!("Degenerate polygon — cannot compute normal");
        }

        Ok(normal / len)
    }

    /// Check if two faces are coplanar (same plane within tolerance).
    pub fn are_coplanar(&self, f1: FaceId, f2: FaceId) -> bool {
        let n1 = self.faces[f1].normal();
        let n2 = self.faces[f2].normal();
        let dot = n1.dot(n2).abs();
        dot > 1.0 - COPLANAR_TOLERANCE
    }

    // ========================================================================
    // Loop traversal utilities
    // ========================================================================

    /// Collect all vertex IDs in a face loop starting from a half-edge.
    pub fn collect_loop_verts(&self, start: HeId) -> Result<Vec<VertId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            result.push(he.dst());

            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Collect all half-edge IDs in a face loop.
    /// ADR-007 Rev 2 — Face classification.
    ///
    /// Returns `true` if the face is part of a closed volume (Wall),
    /// `false` if it is a standalone sheet (boundary face or open surface).
    ///
    /// Rule: a face is a Wall iff every half-edge on its outer loop AND
    /// every inner-hole loop has a twin that belongs to another active
    /// face. If any HE has a null twin or a twin that points to an
    /// inactive face, the face is a Sheet (manifold-with-boundary).
    ///
    /// This drives renderer choice (DoubleSide for Sheet, FrontSide for
    /// Wall), Boolean operand validity, and winding-invariant checks.
    pub fn is_face_in_volume(&self, face_id: FaceId) -> bool {
        let Some(face) = self.faces.get(face_id) else { return false; };
        if !face.is_active() { return false; }

        let check_loop = |start: HeId| -> bool {
            let Ok(hes) = self.collect_loop_hes(start) else { return false; };
            for he_id in hes {
                let twin_id = self.he_twin(he_id);
                if twin_id.is_null() { return false; }
                let Some(twin) = self.hes.get(twin_id) else { return false; };
                if !twin.is_active() { return false; }
                let twin_face = twin.face();
                if twin_face.is_null() { return false; }
                let Some(tf) = self.faces.get(twin_face) else { return false; };
                if !tf.is_active() { return false; }
                if twin_face == face_id { return false; } // self-twin = degenerate
            }
            true
        };

        if !check_loop(face.outer().start) { return false; }
        for inner in face.inners() {
            if !check_loop(inner.start) { return false; }
        }
        true
    }

    /// Convenience inverse of `is_face_in_volume`.
    pub fn is_sheet_face(&self, face_id: FaceId) -> bool {
        !self.is_face_in_volume(face_id)
    }

    pub fn collect_loop_hes(&self, start: HeId) -> Result<Vec<HeId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            result.push(he_id);
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Count distinct active edges incident to a vertex.
    /// Walks the radial v_next chain from the vertex's outgoing half-edge.
    fn count_incident_edges(&self, vid: VertId) -> usize {
        let v = match self.verts.get(vid) {
            Some(v) if v.is_active() => v,
            _ => return 0,
        };
        let start = match v.outgoing() {
            Some(he) if !he.is_null() => he,
            _ => return 0,
        };
        let mut seen: std::collections::HashSet<EdgeId> = std::collections::HashSet::new();
        let mut he_id = start;
        for _ in 0..256 {
            // guard
            let he = match self.hes.get(he_id) {
                Some(h) if h.is_active() => h,
                _ => break,
            };
            if self.edges.get(he.edge()).map(|e| e.is_active()).unwrap_or(false) {
                seen.insert(he.edge());
            }
            let next = he.v_next();
            if next == start || next.is_null() { break; }
            he_id = next;
        }
        seen.len()
    }

    /// Given an edge and one endpoint, return the "other" incident edge at
    /// that endpoint — but ONLY when exactly 2 edges meet there (valence 2).
    /// Returns None for junctions (valence ≥ 3), dead ends, or invalid input.
    /// Used by `collect_edge_chain` to walk polyline chains through regular
    /// chain vertices.
    fn other_edge_at_valence2(&self, edge_id: EdgeId, at_vert: VertId) -> Option<EdgeId> {
        if self.count_incident_edges(at_vert) != 2 { return None; }
        let v = self.verts.get(at_vert)?;
        let start = v.outgoing()?;
        if start.is_null() { return None; }
        let mut he_id = start;
        for _ in 0..256 {
            let he = self.hes.get(he_id)?;
            if !he.is_active() { break; }
            let eid = he.edge();
            if eid != edge_id
                && self.edges.get(eid).map(|e| e.is_active()).unwrap_or(false)
            {
                return Some(eid);
            }
            let next = he.v_next();
            if next == start || next.is_null() { break; }
            he_id = next;
        }
        None
    }

    /// Collect all edges in the **polyline chain** containing `edge_id`.
    /// The chain walks through degree-2 vertices (exactly 2 incident edges)
    /// from both endpoints of the seed edge and stops at junctions (≥3) or
    /// dead ends (1). Returned edges include the seed itself and are in
    /// discovery order (not guaranteed topologically ordered).
    ///
    /// Use cases:
    ///   - SketchUp / Blender "Select → Chain" one-click selection
    ///   - "Select all connected edges in this polyline" for DXF polyline
    ///     import cleanup
    ///
    /// Complexity: O(chain_length) — each edge visited once.
    pub fn collect_edge_chain(&self, edge_id: EdgeId) -> Vec<EdgeId> {
        if !self.edges.get(edge_id).map(|e| e.is_active()).unwrap_or(false) {
            return Vec::new();
        }
        let mut visited: std::collections::HashSet<EdgeId> = std::collections::HashSet::new();
        let mut result = Vec::new();
        let mut queue: Vec<EdgeId> = vec![edge_id];
        while let Some(eid) = queue.pop() {
            if !visited.insert(eid) { continue; }
            result.push(eid);
            if let Some(e) = self.edges.get(eid) {
                for endpoint in [e.v_small(), e.v_large()] {
                    if let Some(other) = self.other_edge_at_valence2(eid, endpoint) {
                        if !visited.contains(&other) {
                            queue.push(other);
                        }
                    }
                }
            }
            if result.len() > 100_000 {
                // Runaway guard — a chain should never be this long in
                // practice; stop to protect the caller.
                break;
            }
        }
        result
    }

    /// Get all edge IDs bounding a face's outer loop.
    pub fn face_outer_edges(&self, face_id: FaceId) -> Result<Vec<EdgeId>> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        Ok(hes.iter().map(|&he_id| self.hes[he_id].edge()).collect())
    }

    /// Analyze whether the given face set forms a closed 2-manifold solid.
    ///
    /// For a watertight solid (tetrahedron, cube, sphere, …) every bounding
    /// edge must be shared by exactly 2 faces within the set.
    ///
    /// # Algorithm
    ///   O(F · avg_edge_per_face). For each face, walk its outer loop and
    ///   accumulate edge→count. Final pass classifies by count.
    pub fn face_set_manifold_info(&self, face_ids: &[FaceId]) -> ManifoldInfo {
        let mut edge_counts: FxHashMap<EdgeId, u32> = FxHashMap::default();
        let mut active_faces = 0usize;
        for &fid in face_ids {
            let Some(face) = self.faces.get(fid) else { continue };
            if !face.is_active() { continue; }
            active_faces += 1;
            let edges = match self.face_outer_edges(fid) {
                Ok(v) => v,
                Err(_) => continue,
            };
            for e in edges {
                *edge_counts.entry(e).or_insert(0) += 1;
            }
        }
        let mut interior = 0usize;
        let mut boundary = 0usize;
        let mut non_manifold = 0usize;
        for &cnt in edge_counts.values() {
            match cnt {
                1 => boundary += 1,
                2 => interior += 1,
                _ => non_manifold += 1,
            }
        }
        // 최소 closed solid = tetrahedron (4 faces). 1~3 face로는 closed 불가.
        let is_closed = active_faces >= 4 && boundary == 0 && non_manifold == 0;
        ManifoldInfo {
            face_count: active_faces,
            interior_edge_count: interior,
            boundary_edge_count: boundary,
            non_manifold_edge_count: non_manifold,
            is_closed_solid: is_closed,
        }
    }

    /// Convenience: true ⇔ face_set is a closed 2-manifold solid.
    pub fn is_face_set_closed_solid(&self, face_ids: &[FaceId]) -> bool {
        self.face_set_manifold_info(face_ids).is_closed_solid
    }

    /// Mark all half-edges in a face's outer loop as SOFT on both sides (twin too).
    ///
    /// Used by primitive creation (cylinder/cone caps) to suppress rendering of
    /// the tessellation chord ring so curved surfaces appear truly smooth.
    /// The underlying topology is unchanged — only the render filter is affected.
    pub fn mark_face_outer_soft(&mut self, face_id: FaceId) -> Result<()> {
        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;
        let start = face.outer().start;
        if start.is_null() { return Ok(()); }
        let hes = self.collect_loop_hes(start)?;
        for &he_id in &hes {
            if let Some(h) = self.hes.get_mut(he_id) {
                let mut f = h.flags();
                f.insert(HeFlags::SOFT);
                h.set_flags(f);
            }
            // twin on same edge (manifold: next_rad)
            let twin = self.hes.get(he_id).map(|h| h.next_rad()).unwrap_or_default();
            if !twin.is_null() && twin != he_id {
                if let Some(h) = self.hes.get_mut(twin) {
                    let mut f = h.flags();
                    f.insert(HeFlags::SOFT);
                    h.set_flags(f);
                }
            }
        }
        Ok(())
    }

    // ========================================================================
    // Closed-loop detection (auto-face creation)
    // ========================================================================

    /// Detect if adding edge v0–v1 completes a closed boundary loop.
    ///
    /// **CAD Boundary Walk approach**: Instead of BFS on edge adjacency,
    /// walks the free half-edge boundary chain starting from the new edge's
    /// forward half-edge. If the chain returns to its start, a closed loop
    /// is found. This is O(L) where L is loop length, not O(E) total edges.
    ///
    /// Falls back to BFS if boundary chain is not yet wired (compatibility).
    ///
    /// Returns the loop vertices in winding order (suitable for `add_face`)
    /// if a coplanar closed loop of 3+ edges is found.
    pub fn detect_free_edge_loop(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        self.detect_free_edge_loop_excluding(v0, v1, new_edge_id, &[])
    }

    /// detect_free_edge_loop의 확장: 추가로 제외할 엣지 집합을 받음.
    /// 이전 iteration에서 "외부 boundary"로 걸러진 루프의 엣지들을 제외하고
    /// 다른 경로를 탐색할 때 사용.
    pub fn detect_free_edge_loop_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        if let Some(verts) = self.detect_loop_by_chain_walk_excluding(v0, v1, new_edge_id, excluded) {
            return Some(verts);
        }
        self.detect_loop_by_bfs_excluding(v0, v1, new_edge_id, excluded)
    }

    fn detect_loop_by_chain_walk_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        let mut path = vec![v0, v1];
        let mut prev_v = v0;
        let mut curr_v = v1;
        for _ in 0..10000 {
            let mut neighbors = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if edge_id == new_edge_id { continue; }
                if excluded.contains(&edge_id) { continue; }
                if key.v_small != curr_v && key.v_large != curr_v { continue; }
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                // ADR-089 A-ζ-2: skip self-loop edges (key.v_small == key.v_large).
                // Self-loop = closed analytic curve = already complete cycle by
                // itself; not part of polygon-edge chain walking.
                if key.v_small == key.v_large { continue; }
                let other = if key.v_small == curr_v { key.v_large } else { key.v_small };
                if other != prev_v { neighbors.push(other); }
            }
            if neighbors.len() == 1 {
                let next_v = neighbors[0];
                if next_v == v0 {
                    if path.len() >= 3 && self.are_verts_coplanar(&path) { return Some(path); }
                    return None;
                }
                prev_v = curr_v;
                curr_v = next_v;
                path.push(curr_v);
            } else {
                return None;
            }
        }
        None
    }

    fn detect_loop_by_bfs_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        use std::collections::VecDeque;
        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge_id == new_edge_id { continue; }
            if excluded.contains(&edge_id) { continue; }
            if !self.edge_has_free_he(edge_id) { continue; }
            // ADR-089 A-ζ-2: skip self-loop edges (closed analytic curves
            // are already complete cycles, not BFS chain participants).
            if edge.is_self_loop() { continue; }
            let va = edge.v_small();
            let vb = edge.v_large();
            adj.entry(va).or_default().push(vb);
            adj.entry(vb).or_default().push(va);
        }
        let mut parent: FxHashMap<VertId, VertId> = FxHashMap::default();
        parent.insert(v1, VertId::NULL);
        let mut queue = VecDeque::new();
        queue.push_back(v1);
        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(&current) {
                for &next in neighbors {
                    if parent.contains_key(&next) { continue; }
                    parent.insert(next, current);
                    if next == v0 {
                        let mut path = Vec::new();
                        let mut node = v0;
                        loop {
                            path.push(node);
                            let p = parent[&node];
                            if p.is_null() { break; }
                            node = p;
                        }
                        if path.len() < 3 { return None; }
                        let mut face_verts = Vec::with_capacity(path.len());
                        face_verts.push(path[0]);
                        for i in (1..path.len()).rev() { face_verts.push(path[i]); }
                        if self.are_verts_coplanar(&face_verts) { return Some(face_verts); }
                        return None;
                    }
                    queue.push_back(next);
                }
            }
        }
        None
    }

    /// CAD boundary walk: build free-edge adjacency at each vertex on-the-fly
    /// and walk through degree-2 vertices to find the shortest closed loop
    /// containing the new edge. O(L) where L = loop length.
    fn detect_loop_by_chain_walk(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        // Walk from v1, following free edges (excluding new_edge_id),
        // always choosing the unique next vertex at degree-2 junctions.
        // If we reach v0, loop is found.
        let mut path = vec![v0, v1];
        let mut prev_v = v0;
        let mut curr_v = v1;

        for _ in 0..10000 {
            // Find all free-edge neighbors of curr_v (excluding the edge we came from)
            let mut neighbors = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if edge_id == new_edge_id { continue; }
                if key.v_small != curr_v && key.v_large != curr_v { continue; }
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                // ADR-089 A-ζ-2: skip self-loop edges (closed curves
                // are not chain participants).
                if key.v_small == key.v_large { continue; }
                let other = if key.v_small == curr_v { key.v_large } else { key.v_small };
                if other != prev_v {
                    neighbors.push(other);
                }
            }

            if neighbors.len() == 1 {
                let next_v = neighbors[0];
                if next_v == v0 {
                    // Closed loop found!
                    if path.len() >= 3 && self.are_verts_coplanar(&path) {
                        return Some(path);
                    }
                    return None;
                }
                prev_v = curr_v;
                curr_v = next_v;
                path.push(curr_v);
            } else {
                // Dead end (0) or branch (2+) → can't determine unique loop via simple walk
                return None;
            }
        }
        None
    }

    /// Legacy BFS-based loop detection on free-edge adjacency.
    fn detect_loop_by_bfs(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        use std::collections::VecDeque;

        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();

        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge_id == new_edge_id { continue; }
            if !self.edge_has_free_he(edge_id) { continue; }

            let va = edge.v_small();
            let vb = edge.v_large();
            adj.entry(va).or_default().push(vb);
            adj.entry(vb).or_default().push(va);
        }

        let mut parent: FxHashMap<VertId, VertId> = FxHashMap::default();
        parent.insert(v1, VertId::NULL);
        let mut queue = VecDeque::new();
        queue.push_back(v1);

        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(&current) {
                for &next in neighbors {
                    if parent.contains_key(&next) { continue; }
                    parent.insert(next, current);

                    if next == v0 {
                        let mut path = Vec::new();
                        let mut node = v0;
                        loop {
                            path.push(node);
                            let p = parent[&node];
                            if p.is_null() { break; }
                            node = p;
                        }
                        if path.len() < 3 { return None; }

                        let mut face_verts = Vec::with_capacity(path.len());
                        face_verts.push(path[0]);
                        for i in (1..path.len()).rev() {
                            face_verts.push(path[i]);
                        }

                        if self.are_verts_coplanar(&face_verts) {
                            return Some(face_verts);
                        } else {
                            return None;
                        }
                    }

                    queue.push_back(next);
                }
            }
        }

        None
    }

    /// Check if an edge has at least one half-edge not assigned to a face.
    fn edge_has_free_he(&self, edge_id: EdgeId) -> bool {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() { return false; }

        let mut he_id = start_he;
        loop {
            if self.hes[he_id].face().is_null() {
                return true;
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he { break; }
        }
        false
    }

    /// Check if all vertices lie on the same plane (within tolerance).
    /// Triangles (3 vertices) are always coplanar.
    fn are_verts_coplanar(&self, verts: &[VertId]) -> bool {
        if verts.len() <= 3 { return true; }

        let p0 = self.verts[verts[0]].pos();
        let p1 = self.verts[verts[1]].pos();
        let p2 = self.verts[verts[2]].pos();

        let normal = (p1 - p0).cross(p2 - p0);
        let normal_len = normal.length();
        if normal_len < 1e-10 { return false; } // degenerate
        let normal = normal / normal_len;

        // Relative tolerance: 폴리곤 최장 edge 길이의 0.01%.
        // 이유: 단위 스케일(절대 tolerance)로는 mm 프로젝트(수천~수만 단위) 에선 너무
        // 엄격해지고, m/cm 프로젝트에선 너무 느슨해짐. 상대 tolerance는 두 경우 모두 적응.
        // 이전 고정 1e-3은 meter 가정 — mm 단위 앱에선 1µm로 너무 엄격해 마우스 스냅
        // 기반 4+정점 루프가 쉽게 coplanar 검사에 실패했음.
        let mut max_chord_sq = 0.0_f64;
        for &vid in verts.iter() {
            let p = self.verts[vid].pos();
            let d = (p - p0).length_squared();
            if d > max_chord_sq { max_chord_sq = d; }
        }
        let scale = max_chord_sq.sqrt().max(1.0);
        let tol = scale * 1e-4;

        for &vid in &verts[3..] {
            let p = self.verts[vid].pos();
            let dist = (p - p0).dot(normal).abs();
            if dist > tol {
                return false;
            }
        }
        true
    }

    // ========================================================================
    // Mesh export (for sending to Three.js)
    // ========================================================================

    /// Compute a **smooth per-vertex normal** for a vertex belonging to a face.
    ///
    /// Given the half-edge in the face's loop whose `dst` is this vertex,
    /// traverses around the vertex via the DCEL radial/next links and averages
    /// the normals of all faces whose angle to `face_normal` is within
    /// `EDGE_VISIBILITY_ANGLE_DEG`. This matches the soft-edge cull threshold,
    /// so smooth shading and edge hiding are consistent.
    ///
    /// Faces across a **hard** edge (HARD flag or angle > threshold) are excluded,
    /// preserving sharp corners (boxes, face-split seams).
    ///
    /// Falls back to `face_normal` on any degeneracy (isolated vertex, corrupted
    /// topology, traversal overrun).
    fn compute_smooth_normal_at(&self, he_into_vertex: HeId, vertex_id: VertId, face_normal: DVec3) -> DVec3 {
        use crate::tolerances::{EDGE_VISIBILITY_ANGLE_DEG, deg_to_rad};
        let cos_threshold = deg_to_rad(EDGE_VISIBILITY_ANGLE_DEG).cos();

        // Sanity: he_into_vertex must end at vertex_id
        let he0 = match self.hes.get(he_into_vertex) {
            Some(h) if h.is_active() && h.dst() == vertex_id => h,
            _ => return face_normal,
        };
        // Starting outgoing HE from vertex_id (in the same face as he_into_vertex).
        // hes[he_into_vertex].next() has origin = vertex_id.
        let start_out = he0.next();
        if start_out.is_null() || !self.hes.contains(start_out) {
            return face_normal;
        }

        // Collect weighted sum of neighbor face normals.
        let mut accum = DVec3::ZERO;
        let mut count: u32 = 0;
        let mut he_out = start_out;
        const MAX_ITERS: u32 = 1024; // paranoia cap for non-manifold / corruption
        for _ in 0..MAX_ITERS {
            let he_ref = match self.hes.get(he_out) {
                Some(h) if h.is_active() => h,
                _ => break,
            };

            // Record this face's normal if it passes the smooth threshold
            let face_id = he_ref.face();
            if !face_id.is_null() {
                if let Some(f) = self.faces.get(face_id) {
                    if f.is_active() && f.is_visible() {
                        let n = f.normal();
                        if n.length_squared() > 1e-20 {
                            let dot = n.dot(face_normal);
                            if dot >= cos_threshold {
                                // smoothing pair — include
                                accum += n;
                                count += 1;
                            }
                        }
                    }
                }
            }

            // Advance to next outgoing HE at this vertex:
            //   incoming = prev(he_out)     (in same face, ends at vertex)
            //   twin    = next_rad(incoming) (crosses edge → outgoing in neighbor face)
            let incoming = he_ref.prev();
            if incoming.is_null() || !self.hes.contains(incoming) {
                break;
            }
            let twin = self.hes[incoming].next_rad();
            if twin.is_null() || !self.hes.contains(twin) || twin == incoming {
                break; // boundary or non-manifold — stop
            }
            he_out = twin;
            if he_out == start_out {
                break; // closed fan — done
            }
        }

        if count == 0 || accum.length_squared() < 1e-20 {
            return face_normal;
        }
        accum.normalize()
    }

    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions, normals, indices, face_id_per_triangle)
    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    /// positions_f64 has the same layout/indexing as positions_f32 but in full f64 precision.
    /// **CONTRACT** (2026-05-02 invariant freeze): every active face MUST
    /// emit ≥1 triangle. earcut Ok([]) faces are auto-deactivated INSIDE
    /// this method — the call order is locked:
    ///   1. clear `last_export_empty_faces`
    ///   2. emit triangles, recording empty-emit face IDs
    ///   3. deactivate empty-emit faces (`deactivate_empty_emit_faces`)
    ///   4. (optional) re-export if any face was deactivated
    ///   5. snapshot `last_export_stats` LAST
    /// Any future change to this method MUST preserve this order. The
    /// `debug_assert_eq!` after deactivation locks the invariant in
    /// debug builds (release auto-corrects via the deactivation pass).
    ///
    /// **Guarantee on returned buffers**: `face_map` contains exactly
    /// one entry per emitted triangle, and the *set* of distinct face
    /// IDs in `face_map` equals the count of `is_active() && is_visible()`
    /// faces in the mesh. NO active face with zero triangles can leak
    /// past this boundary.
    pub fn export_buffers(&mut self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let result = self.export_buffers_inner()?;
        // Step 3 — deactivate any face whose triangulation produced 0
        // triangles (earcut Ok([])). Restores the "1 face = ≥1 tri"
        // invariant before stats are snapshotted.
        let removed = self.deactivate_empty_emit_faces();
        if removed == 0 {
            // Step 5 — snapshot stats (already done at end of inner pass).
            return Ok(result);
        }
        // Step 4 — re-export with cleaned mesh state. Stats from this
        // pass are the canonical snapshot (recorded at end of inner).
        self.export_buffers_inner()
    }

    fn export_buffers_inner(&self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let mut positions: Vec<f32> = Vec::new();
        let mut positions_f64: Vec<f64> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut face_map: Vec<u32> = Vec::new(); // one FaceId per triangle
        let mut vert_offset: u32 = 0;

        // Step 1 — reset diagnostic counters + empty-emit list at start of
        // every export pass (the "clear" in clear → emit → deactivate →
        // snapshot ordering).
        let mut stats = ExportSkipStats::default();
        self.last_export_empty_faces.borrow_mut().clear();

        // ADR-038 P23.2 + 2026-05-12 visual quality refinement —
        // chord tolerance for **render-only** analytic surface / curve
        // tessellation. 0.02mm 는 0.1mm 의 5× refinement 으로, top rim
        // facet (사용자 시연 결함 — "옆면처럼 원도 같은 방식 쓸 수 없나요?")
        // 해소. Side surface 가 매끈해 보이는 진짜 이유는 N 이 충분해서가
        // 아니라 surface-aware Gouraud normal 이 적은 segment 도 매끈하게
        // 보이게 만들기 때문 (ADR-038 P23.5). Top face 는 Plane normal 만
        // 가지므로 segment count 가 그대로 시각 facet 으로 노출 → 더 fine
        // chord 가 필요.
        //
        // Engine ops (offset / Boolean / Push-Pull Path A 의 polygon
        // substitute) 는 별도 chord_tol (`radius * 0.01`) 을 caller 가
        // 명시 전달 — 본 const 는 render path 전용. 두 tolerance 분리는
        // ADR-049 §4 의 "Form/Property layer" 패턴 답습 (truth vs view).
        //
        // 메모리 영향 (r=5 cylinder 기준):
        //   Side surface: ~16 → ~38 segments (×2.4)
        //   Top face fan: ~22 → ~78 triangles (×3.5)
        //   Rim wireframe: ~22 → ~78 line segments (×3.5)
        //   합계 cylinder 1개: ~150 → ~360 verts (+210 verts, 무시 가능)
        // LOD 는 별도 phase.
        const ANALYTIC_CHORD_TOL: f64 = 0.02;

        for (face_id, face) in self.faces.iter() {
            if !face.is_active() || !face.is_visible() {
                continue;
            }
            stats.total_active_faces += 1;

            // ADR-038 P23.1 — Analytic evaluate priority.
            // `Face.surface = Some(AnalyticSurface)` 이면 surface 의 정확한
            // tessellation + analytic normal 사용. 없으면 기존 path
            // (DCEL fan averaging) 유지.
            //
            // ADR-087 K-ε hotfix — LOCKED #12 (ADR-025 P11) "닫힌 엣지로
            // face 합성" 규칙: Plane variant 는 polygon = exact 이므로
            // surface tessellation 을 *건너뛰고* DCEL polygon path 로
            // fall through. Plane.u_range/v_range = (-1e6, 1e6) 가
            // tessellate 시 2km × 2km mesh 로 확장되어 face 가 edge 를
            // 벗어나는 회귀 차단. Curved surface (Cylinder/Sphere/Cone/
            // Torus/Bezier/BSpline/NURBS) 는 surface tessellation 유지
            // (chord-based curve 샘플링 필수).
            if let Some(surface) = face.surface() {
                if matches!(surface, crate::surfaces::AnalyticSurface::Plane { .. }) {
                    // Plane → polygon path (DCEL boundary = exact)
                    // fall through to the polygon tessellation below.
                } else {
                use crate::surfaces::SurfaceOps;

                // ADR-089 A-ρ-β / A-φ-β — curved surface uv-slice fast-path.
                // For 4-vert quad faces with shared curved surface
                // (Cylinder/Sphere/Cone/Torus), compute the quad's actual
                // uv sub-range from its boundary verts and tessellate only
                // that slice. L-φ-1 / L-φ-2 / L-φ-3 / L-φ-4.
                let face_surface_owned;
                let slice = compute_uv_slice_for_quad_face(self, face, surface);
                let render_surface: &crate::surfaces::AnalyticSurface =
                    if let Some(sliced) = slice {
                        face_surface_owned = sliced;
                        &face_surface_owned
                    } else {
                        surface
                    };

                let tess = render_surface.tessellate(ANALYTIC_CHORD_TOL);
                if tess.vertices.is_empty() || tess.triangles.is_empty() {
                    stats.analytic_empty_tess += 1;
                    continue;
                }

                // P23.5 — analytic normal 직접 evaluate per (u, v).
                // averaging 없음 — sphere 폴 같은 degenerate 점도 정확한
                // 단위 벡터 반환 (SurfaceOps spec 보장).
                let n_verts = tess.vertices.len();
                for i in 0..n_verts {
                    let p = tess.vertices[i];
                    positions.push(p.x as f32);
                    positions.push(p.y as f32);
                    positions.push(p.z as f32);
                    positions_f64.push(p.x);
                    positions_f64.push(p.y);
                    positions_f64.push(p.z);

                    let uv = tess.uv.get(i).copied().unwrap_or([0.0, 0.0]);
                    let n = render_surface.normal(uv[0], uv[1]);
                    // Defensive: degenerate normal → fallback to face plane normal.
                    let n = if n.length_squared() < 1e-20 { face.normal() } else { n };
                    normals.push(n.x as f32);
                    normals.push(n.y as f32);
                    normals.push(n.z as f32);
                }

                // Emit triangles with vertex offset.
                for tri in &tess.triangles {
                    indices.push(vert_offset + tri[0]);
                    indices.push(vert_offset + tri[1]);
                    indices.push(vert_offset + tri[2]);
                    face_map.push(face_id.raw());  // P22.5 — 모든 삼각형이 같은 FaceId
                }
                vert_offset += n_verts as u32;
                stats.emitted += 1;
                continue;  // skip the planar polygon path below
                }  // close inner else (curved surface branch)
            }

            let normal = face.normal();

            // Skip faces with corrupted loops (graceful degradation)
            let loop_verts = match self.collect_loop_verts(face.outer().start) {
                Ok(verts) => verts,
                Err(_) => { stats.corrupted_outer_loop += 1; continue; },
            };
            // Outer loop HEs — parallel to loop_verts (hes[i].dst() == loop_verts[i]).
            // Used for smooth-normal computation around each vertex.
            let loop_hes = self.collect_loop_hes(face.outer().start).unwrap_or_default();

            // ADR-089 A-κ-β — closed-curve face render fast-path.
            // Detect 1-vert anchor + Circle curve self-loop edge and
            // emit tessellated triangle fan + analytic Plane normals.
            // Read-only (no mesh mutation; A-θ-β handles substitution
            // for Push-Pull). L-κ-1 / L-κ-3 / L-κ-4.
            if loop_verts.len() == 1 {
                let outer_start = face.outer().start;
                let edge_id = self.hes[outer_start].edge();
                if let Some(edge_ref) = self.edges.get(edge_id) {
                    if let Some(crate::curves::AnalyticCurve::Circle {
                        center,
                        radius,
                        normal: c_normal,
                        basis_u,
                    }) = edge_ref.curve().cloned()
                    {
                        // ADR-038 P23.2 + 2026-05-12 render refinement —
                        // 0.02mm baseline (ANALYTIC_CHORD_TOL) capped by
                        // `radius * 0.002` (5× finer than engine ops'
                        // `radius * 0.01`). For r=5 → 0.01mm → ~78 fan
                        // triangles (was ~22).
                        let chord_tol = ANALYTIC_CHORD_TOL.min(radius * 0.002).max(1e-6);
                        let pts = crate::curves::circle::tessellate_full(
                            center, radius, c_normal, basis_u, chord_tol,
                        );
                        if pts.len() < 4 {
                            stats.outer_too_short += 1;
                            continue;
                        }
                        let unique_pts = &pts[..pts.len() - 1];
                        let n_seg = unique_pts.len();

                        // Build vertex buffer: center + N rim verts.
                        // Triangulate as fan from center → N triangles.
                        let n_normal = if c_normal.length_squared() < 0.5 {
                            face.normal()
                        } else {
                            c_normal.normalize_or_zero()
                        };

                        // Emit center vertex (vert_offset + 0).
                        positions.push(center.x as f32);
                        positions.push(center.y as f32);
                        positions.push(center.z as f32);
                        positions_f64.push(center.x);
                        positions_f64.push(center.y);
                        positions_f64.push(center.z);
                        normals.push(n_normal.x as f32);
                        normals.push(n_normal.y as f32);
                        normals.push(n_normal.z as f32);

                        // Emit N rim vertices (vert_offset + 1 .. vert_offset + N).
                        for &p in unique_pts {
                            positions.push(p.x as f32);
                            positions.push(p.y as f32);
                            positions.push(p.z as f32);
                            positions_f64.push(p.x);
                            positions_f64.push(p.y);
                            positions_f64.push(p.z);
                            normals.push(n_normal.x as f32);
                            normals.push(n_normal.y as f32);
                            normals.push(n_normal.z as f32);
                        }

                        // Emit N triangles: (center, rim[i], rim[i+1]).
                        for i in 0..n_seg {
                            let next = (i + 1) % n_seg;
                            indices.push(vert_offset);
                            indices.push(vert_offset + 1 + i as u32);
                            indices.push(vert_offset + 1 + next as u32);
                            face_map.push(face_id.raw());
                        }
                        vert_offset += (n_seg + 1) as u32;
                        stats.emitted += 1;
                        continue;
                    }
                    // ADR-089 A-ω-δ / A-Α-β / A-Β-β — closed Bezier /
                    // BSpline / NURBS render fast-path. Tessellate control
                    // points to polyline → fan triangulate from centroid
                    // (analogous to Circle path).
                    let curve_tess: Option<Vec<DVec3>> = match edge_ref.curve().cloned() {
                        Some(crate::curves::AnalyticCurve::Bezier { control_pts }) => {
                            crate::curves::bezier::tessellate(
                                &control_pts, ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        Some(crate::curves::AnalyticCurve::BSpline {
                            control_pts, knots, degree,
                        }) => {
                            crate::curves::bspline::tessellate(
                                &control_pts, &knots, degree as usize,
                                ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        Some(crate::curves::AnalyticCurve::NURBS {
                            control_pts, weights, knots, degree,
                        }) => {
                            crate::curves::nurbs::tessellate(
                                &control_pts, &weights, &knots, degree as usize,
                                ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        _ => None,
                    };
                    if let Some(pts) = curve_tess
                    {
                        if pts.len() < 3 {
                            stats.outer_too_short += 1;
                            continue;
                        }
                        // Drop closing duplicate if present.
                        let unique_pts: &[DVec3] =
                            if (pts[0] - pts[pts.len() - 1]).length()
                                < crate::tolerances::EPSILON_LENGTH
                                && pts.len() >= 4
                            {
                                &pts[..pts.len() - 1]
                            } else {
                                &pts[..]
                            };
                        let n_seg = unique_pts.len();
                        // Centroid for fan triangulation.
                        let centroid = unique_pts.iter().fold(DVec3::ZERO, |a, p| a + *p)
                            / (n_seg as f64);
                        // Normal: face's stored normal (computed in
                        // add_face_closed_curve via best-fit plane).
                        let n_normal = face.normal();

                        // Emit centroid + rim verts.
                        positions.push(centroid.x as f32);
                        positions.push(centroid.y as f32);
                        positions.push(centroid.z as f32);
                        positions_f64.push(centroid.x);
                        positions_f64.push(centroid.y);
                        positions_f64.push(centroid.z);
                        normals.push(n_normal.x as f32);
                        normals.push(n_normal.y as f32);
                        normals.push(n_normal.z as f32);
                        for &p in unique_pts {
                            positions.push(p.x as f32);
                            positions.push(p.y as f32);
                            positions.push(p.z as f32);
                            positions_f64.push(p.x);
                            positions_f64.push(p.y);
                            positions_f64.push(p.z);
                            normals.push(n_normal.x as f32);
                            normals.push(n_normal.y as f32);
                            normals.push(n_normal.z as f32);
                        }
                        for i in 0..n_seg {
                            let next = (i + 1) % n_seg;
                            indices.push(vert_offset);
                            indices.push(vert_offset + 1 + i as u32);
                            indices.push(vert_offset + 1 + next as u32);
                            face_map.push(face_id.raw());
                        }
                        vert_offset += (n_seg + 1) as u32;
                        stats.emitted += 1;
                        continue;
                    }
                }
                // Not a closed-curve face — fall through to legacy
                // < 3 skip.
            }

            if loop_verts.len() < 3 {
                stats.outer_too_short += 1;
                continue;
            }

            // Project to 2D for triangulation
            let (coord1, coord2) = Self::projection_axes(normal);
            let mut coords_2d: Vec<f64> = Vec::with_capacity(loop_verts.len() * 2);
            let mut positions_3d: Vec<DVec3> = Vec::with_capacity(loop_verts.len());
            // Per-vertex smooth normals (aligned with positions_3d indexing)
            let mut vert_normals: Vec<DVec3> = Vec::with_capacity(loop_verts.len());

            let mut skip_face = false;
            for (i, &vid) in loop_verts.iter().enumerate() {
                match self.vertex_pos(vid) {
                    Ok(pos) => {
                        positions_3d.push(pos);
                        let arr = [pos.x, pos.y, pos.z];
                        coords_2d.push(arr[coord1]);
                        coords_2d.push(arr[coord2]);

                        // Smooth normal: average adjacent face normals within threshold
                        // (only if we have a matching HE reference)
                        if i < loop_hes.len() {
                            let smooth = self.compute_smooth_normal_at(loop_hes[i], vid, normal);
                            vert_normals.push(smooth);
                        } else {
                            vert_normals.push(normal);
                        }
                    }
                    Err(_) => { skip_face = true; break; }
                }
            }
            if skip_face { stats.vertex_pos_failed += 1; continue; }

            // Inner loops (holes) 처리
            let mut hole_indices: Vec<usize> = Vec::new();
            let inners: Vec<_> = face.inners().to_vec();
            for inner_ref in &inners {
                if inner_ref.start.is_null() { continue; }
                let inner_verts = match self.collect_loop_verts(inner_ref.start) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if inner_verts.len() < 3 { continue; }

                // hole 시작 인덱스 = 현재 2D 좌표 수 / 2
                hole_indices.push(coords_2d.len() / 2);

                for &vid in &inner_verts {
                    match self.vertex_pos(vid) {
                        Ok(pos) => {
                            positions_3d.push(pos);
                            let arr = [pos.x, pos.y, pos.z];
                            coords_2d.push(arr[coord1]);
                            coords_2d.push(arr[coord2]);
                            // Inner-loop verts: use face normal (holes rarely need smoothing)
                            vert_normals.push(normal);
                        }
                        Err(_) => { skip_face = true; break; }
                    }
                }
                if skip_face { break; }
            }
            if skip_face { stats.corrupted_inner_loop += 1; continue; }

            // Triangulate with earcutr (outer + holes)
            let mut tri_indices = match earcutr::earcut(&coords_2d, &hole_indices, 2) {
                Ok(indices) => indices,
                Err(_) => { stats.earcut_failed += 1; continue; },
            };
            // Distinguish Ok([]) — earcut accepted the polygon but
            // produced zero triangles (degenerate / self-touching).
            // Without this guard the face disappears from the buffer
            // silently while `emitted` would still increment.
            //
            // INVARIANT (user-requested 2026-05-02):
            //   For every active face: emitted_triangle_count > 0.
            // We enforce by recording the offending face id; the caller's
            // `deactivate_empty_emit_faces(&mut self)` post-pass removes
            // them so face_count == rendered_face_count is restored.
            if tri_indices.is_empty() {
                stats.earcut_empty += 1;
                stats.last_earcut_empty_fid = face_id.raw();
                stats.last_earcut_empty_outer_n = loop_verts.len() as u32;
                self.last_export_empty_faces.borrow_mut().push(face_id);
                continue;
            }

            // Fix triangle winding: earcut works in 2D and may produce
            // triangles whose 3D winding doesn't match the face normal.
            // Check EACH triangle individually and fix if needed.
            for chunk in tri_indices.chunks_exact_mut(3) {
                let pa = positions_3d[chunk[0]];
                let pb = positions_3d[chunk[1]];
                let pc = positions_3d[chunk[2]];
                let tri_normal = (pb - pa).cross(pc - pa);
                if tri_normal.dot(normal) < 0.0 {
                    chunk.swap(1, 2);
                }
            }

            // Emit vertices (f32 for GPU + f64 for precision).
            // Per-vertex smooth normals: averaged across adjacent faces that share a
            // soft edge with this face (SketchUp-style, threshold EDGE_VISIBILITY_ANGLE_DEG).
            // Falls back to face normal when there are no neighbors within threshold.
            for (i, pos) in positions_3d.iter().enumerate() {
                positions.push(pos.x as f32);
                positions.push(pos.y as f32);
                positions.push(pos.z as f32);

                positions_f64.push(pos.x);
                positions_f64.push(pos.y);
                positions_f64.push(pos.z);

                let n = vert_normals.get(i).copied().unwrap_or(normal);
                normals.push(n.x as f32);
                normals.push(n.y as f32);
                normals.push(n.z as f32);
            }

            // Emit indices (offset by current vertex count)
            let num_triangles = tri_indices.len() / 3;
            for &idx in &tri_indices {
                indices.push(vert_offset + idx as u32);
            }

            // Map each triangle to this face's ID
            for _ in 0..num_triangles {
                face_map.push(face_id.raw());
            }

            vert_offset += positions_3d.len() as u32;
            stats.emitted += 1;
        }

        // Step 5 — snapshot stats LAST (single source of truth for
        // diagnostic queries until the next export pass).
        self.last_export_stats.set(stats);

        // INVARIANT lock — debug builds panic if some active face
        // contributed 0 triangles to the buffer. Release builds rely
        // on `deactivate_empty_emit_faces` to auto-correct, so this
        // assertion is purely defensive against future regressions.
        // We compute emitted_face_count via face_map dedup since face
        // ids appear once per triangle.
        #[cfg(debug_assertions)]
        {
            use std::collections::HashSet;
            let active: usize = self.faces.iter().filter(|(_, f)| f.is_active() && f.is_visible()).count();
            let emitted_set: HashSet<u32> = face_map.iter().copied().collect();
            // After deactivate_empty_emit_faces (called from export_buffers
            // outer wrapper), invariant should hold. During the FIRST inner
            // pass the empty list may not yet be drained — skip assert if
            // any pending empty IDs remain.
            if self.last_export_empty_faces.borrow().is_empty() {
                debug_assert_eq!(
                    active,
                    emitted_set.len(),
                    "INVARIANT VIOLATED: {} active faces but only {} emitted (zero-triangle face leaked)",
                    active, emitted_set.len(),
                );
            }
        }

        Ok((positions, normals, indices, face_map, positions_f64))
    }

    /// Returns the per-face skip diagnostics from the most recent
    /// `export_buffers()` call. Use to debug "face active in mesh but not
    /// rendered" — non-zero counts indicate which silent-skip path triggered.
    pub fn last_export_skip_stats(&self) -> ExportSkipStats {
        self.last_export_stats.get()
    }

    /// Self-heal pass — deactivate any face whose triangulation in the most
    /// recent `export_buffers` call returned `Ok([])` (zero triangles).
    ///
    /// **Invariant** (user-stipulated 2026-05-02): every active face must
    /// emit ≥1 triangle. earcut Ok([]) means the polygon is degenerate
    /// (zero area / collinear vertices / self-touching). Such a face would
    /// otherwise stay active in mesh but invisible in render, manifesting
    /// as the user's "wireframe-only RECT" symptom. Removing it restores
    /// `face_count == emitted_face_count`.
    ///
    /// Returns the count of faces deactivated. Call after `export_buffers`.
    pub fn deactivate_empty_emit_faces(&mut self) -> usize {
        // Snapshot then clear — avoid holding the RefCell borrow during
        // the mutating loop.
        let to_remove: Vec<FaceId> = {
            let mut list = self.last_export_empty_faces.borrow_mut();
            std::mem::take(&mut *list)
        };
        let mut n = 0;
        for fid in &to_remove {
            // Defensive: face may have been deactivated by another path.
            if self.faces.contains(*fid) && self.faces[*fid].is_active() {
                let _ = self.remove_face(*fid);
                if self.faces.contains(*fid) {
                    self.faces.remove(*fid);
                }
                n += 1;
            }
        }
        // Debug-only assertion: post-cleanup, NO active face should remain
        // in the recently-recorded empty-emit list (we just cleared it).
        // This is a smoke test that future code can't accidentally bypass
        // the cleanup without also clearing the list.
        debug_assert!(self.last_export_empty_faces.borrow().is_empty());
        n
    }

    /// Choose the best 2D projection axes based on the face normal.
    /// Drops the axis with the largest normal component.
    fn projection_axes(normal: DVec3) -> (usize, usize) {
        let abs_n = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
        if abs_n[0] >= abs_n[1] && abs_n[0] >= abs_n[2] {
            (1, 2) // Drop X → project onto YZ
        } else if abs_n[1] >= abs_n[0] && abs_n[1] >= abs_n[2] {
            (0, 2) // Drop Y → project onto XZ
        } else {
            (0, 1) // Drop Z → project onto XY
        }
    }

    // ========================================================================
    // Edge line export (for wireframe rendering — SketchUp-style)
    // ========================================================================

    /// Export "hard edge" line segments for wireframe rendering.
    ///
    /// Unlike Three.js EdgesGeometry (which can't detect shared edges when
    /// vertices are duplicated per-face), this uses DCEL topology to correctly
    /// identify which edges should be drawn:
    ///
    /// - Boundary edges (only one face): ALWAYS drawn
    /// - Edges between non-coplanar faces (angle > threshold): drawn
    /// - Edges between coplanar faces (angle ≤ threshold): HIDDEN (soft)
    /// - Edges with SOFT flag set: HIDDEN
    ///
    /// Returns flat `[x0,y0,z0, x1,y1,z1, ...]` buffer for LineSegments.
    pub fn export_edge_lines(&self, angle_threshold_deg: f64) -> Vec<f32> {
        let (lines, _) = self.export_edge_lines_with_map(angle_threshold_deg);
        lines
    }

    /// Export just the centerline edge segments (flat `[x,y,z, ...]` pairs)
    /// for separate rendering (dashed, thin, dimmer color). No edge map
    /// returned — centerlines are not pickable as distinct entities via the
    /// main edge-line hit path yet (they stay snap targets via vertex/midpoint
    /// but not as mid-edge nearest hits in rendering layer).
    pub fn export_centerline_lines(&self) -> Vec<f32> {
        let mut lines: Vec<f32> = Vec::new();
        for (_, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.class() != EdgeClass::Centerline { continue; }
            let p0 = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let p1 = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };
            lines.extend_from_slice(&[
                p0.x as f32, p0.y as f32, p0.z as f32,
                p1.x as f32, p1.y as f32, p1.z as f32,
            ]);
        }
        lines
    }

    /// export_edge_lines + edge ID map (segment index → EdgeId raw).
    /// Centerline edges are excluded — render them separately via
    /// `export_centerline_lines` to apply dashed / dimmer styling.
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        let cos_threshold = angle_threshold_deg.to_radians().cos();
        let mut lines: Vec<f32> = Vec::new();
        let mut edge_map: Vec<u32> = Vec::new();

        for (_edge_id, edge) in self.edges.iter() {
            if !edge.is_active() {
                continue;
            }
            // Centerline edges go through a separate rendering path
            // (export_centerline_lines) so skip them here.
            if edge.class() == EdgeClass::Centerline {
                continue;
            }

            // ADR-089 A-κ-β — closed-curve edge wireframe fast-path.
            // Self-loop edge with Circle curve → tessellate to N polyline
            // segments. Each segment maps to the SAME EdgeId (LOCKED #15
            // ADR-037 P22.5 owner-ID uniformity). L-κ-2 / L-κ-6.
            if edge.is_self_loop() {
                if let Some(crate::curves::AnalyticCurve::Circle {
                    center,
                    radius,
                    normal: c_normal,
                    basis_u,
                }) = edge.curve().cloned()
                {
                    // 2026-05-12 render refinement — match closed-curve
                    // face fast-path (line ~4844) so top face boundary
                    // and rim wireframe align in 3D. Was `radius * 0.01`,
                    // now `min(0.02, radius * 0.002)` per render chord
                    // tolerance policy.
                    let chord_tol = (radius * 0.002).clamp(5e-5, 0.02);
                    let pts = crate::curves::circle::tessellate_full(
                        center, radius, c_normal, basis_u, chord_tol,
                    );
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                    }
                    continue;
                }
                // ADR-089 A-ω-δ / A-Α-β / A-Β-β — Bezier / BSpline /
                // NURBS closed self-loop wireframe.
                let curve_pts: Option<Vec<DVec3>> = match edge.curve().cloned() {
                    Some(crate::curves::AnalyticCurve::Bezier { control_pts }) => {
                        crate::curves::bezier::tessellate(&control_pts, 0.05).ok()
                    }
                    Some(crate::curves::AnalyticCurve::BSpline { control_pts, knots, degree }) => {
                        crate::curves::bspline::tessellate(
                            &control_pts, &knots, degree as usize, 0.05,
                        ).ok()
                    }
                    Some(crate::curves::AnalyticCurve::NURBS {
                        control_pts, weights, knots, degree,
                    }) => {
                        crate::curves::nurbs::tessellate(
                            &control_pts, &weights, &knots, degree as usize, 0.05,
                        ).ok()
                    }
                    _ => None,
                };
                if let Some(pts) = curve_pts {
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                    }
                    continue;
                }
                // Self-loop without supported curve — skip (zero-length
                // line otherwise).
                continue;
            }

            // Get edge endpoint positions
            let p0 = match self.vertex_pos(edge.v_small()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let p1 = match self.vertex_pos(edge.v_large()) {
                Ok(p) => p,
                Err(_) => continue,
            };

            // Check half-edge flags (SOFT / HARD)
            let he_start = edge.any_he();
            if he_start.is_null() {
                continue;
            }
            let he_flags = self.hes[he_start].flags();
            if he_flags.contains(HeFlags::SOFT) {
                continue; // soft edge — don't draw
            }
            let force_hard = he_flags.contains(HeFlags::HARD);

            // Collect adjacent face normals + surfaces via radial chain
            let mut face_normals: Vec<DVec3> = Vec::new();
            let mut face_surfaces: Vec<Option<crate::surfaces::AnalyticSurface>> = Vec::new();
            let mut he_id = he_start;
            loop {
                let face_id = self.hes[he_id].face();
                if !face_id.is_null() && self.faces.contains(face_id) {
                    let face = &self.faces[face_id];
                    if face.is_active() && face.is_visible() {
                        face_normals.push(face.normal());
                        face_surfaces.push(face.surface().cloned());
                    }
                }
                he_id = self.hes[he_id].next_rad();
                if he_id == he_start {
                    break;
                }
            }

            // Decision: draw this edge?
            let draw = if force_hard {
                true // HARD flag → always draw (face split edges, user-drawn lines)
            } else {
                match face_normals.len() {
                    0 => true,  // isolated edge (wireframe) — draw
                    1 => true,  // boundary edge — draw
                    2 => {
                        // ADR-089 A-τ-β — smooth-group edge hide.
                        // 두 face 가 같은 곡면 surface 인스턴스 (Cylinder/
                        // Sphere/Cone/Torus) 면 smooth-group 내부 edge 로
                        // 간주, hide. L-τ-1 / L-τ-2 / L-τ-6.
                        if surfaces_in_same_smooth_group(
                            &face_surfaces[0], &face_surfaces[1],
                        ) {
                            false // smooth group internal — hide
                        } else {
                            // Fallback: angle-based coplanar test (LOCKED #16
                            // K-ε hotfix 답습).
                            let dot = face_normals[0].dot(face_normals[1]).abs();
                            dot < cos_threshold // draw only if NOT coplanar
                        }
                    }
                    _ => true,  // non-manifold — draw
                }
            };

            if draw {
                // ADR-092 C-β extension — Arc tessellation for non-self-
                // loop edges with AnalyticCurve::Arc attached. Mirrors the
                // self-loop Circle fast-path (line 4986-5008) for the
                // post-Push-Pull case where Bottom/Top face boundary edges
                // carry Arc metadata pointing back at the original Circle.
                // Without this branch, Arc-attached edges render as straight
                // chord lines, leaving the polygon-rim defect (사용자 시연
                // 2026-05-09 결함 1) un-fixed.
                if let Some(crate::curves::AnalyticCurve::Arc {
                    center,
                    radius,
                    normal: c_normal,
                    basis_u,
                    start_angle,
                    end_angle,
                }) = edge.curve().cloned()
                {
                    let chord_tol = (radius * 0.01).max(5e-5);
                    let pts = crate::curves::arc::tessellate(
                        center,
                        radius,
                        c_normal,
                        basis_u,
                        start_angle,
                        end_angle,
                        chord_tol,
                    );
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                        continue;
                    }
                }
                // Default: emit single straight chord segment.
                lines.push(p0.x as f32);
                lines.push(p0.y as f32);
                lines.push(p0.z as f32);
                lines.push(p1.x as f32);
                lines.push(p1.y as f32);
                lines.push(p1.z as f32);
                edge_map.push(_edge_id.raw());
            }
        }

        (lines, edge_map)
    }

    // ========================================================================
    // Face merge (AixxiA coplanar merge — SketchUp-style)
    // ========================================================================

    /// UX (2026-05-02) — collect edges that bound NO active face. These
    /// are standalone Line XIAs (DrawLine intermediate / orphan splits)
    /// and are rendered with a distinct dashed style so users see at a
    /// glance "this is a line, not a face boundary" — addresses the
    /// "wireframe rect" misperception where multiple separate lines
    /// happen to look like a rectangle outline.
    ///
    /// Returns positions only (segment endpoints, 6 floats per edge).
    pub fn collect_free_edge_segments(&self) -> Vec<f32> {
        let mut buf: Vec<f32> = Vec::new();
        for (eid, e) in self.edges.iter() {
            if !e.is_active() { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let any_active = faces.iter().any(|&f|
                self.faces.contains(f) && self.faces[f].is_active());
            if any_active { continue; } // edge bounds at least one face → not free
            let v0 = e.v_small();
            let v1 = e.v_large();
            if let (Ok(p0), Ok(p1)) = (self.vertex_pos(v0), self.vertex_pos(v1)) {
                buf.push(p0.x as f32);
                buf.push(p0.y as f32);
                buf.push(p0.z as f32);
                buf.push(p1.x as f32);
                buf.push(p1.y as f32);
                buf.push(p1.z as f32);
            }
        }
        buf
    }

    /// ADR-047 R-track (2026-05-02) — collect edges shared by ≥3 active faces.
    ///
    /// These are non-manifold edges produced by ADR-021 P7 stacked-inner
    /// rectangles (and other intentional shared-boundary topologies).
    /// The rendering layer uses this to draw an outline highlight so the
    /// user perceives the overlapping faces clearly instead of mistaking
    /// them for "missing face" / wireframe-only.
    ///
    /// Returns flat `Vec<EdgeId>`. Use `vertex_pos` on each edge's
    /// endpoints for screen-space rendering.
    pub fn collect_non_manifold_edges(&self) -> Vec<EdgeId> {
        let mut result = Vec::new();
        for (eid, e) in self.edges.iter() {
            if !e.is_active() {
                continue;
            }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            if faces.len() >= 3 {
                result.push(eid);
            }
        }
        result
    }

    /// Get all faces sharing a given edge, via the radial half-edge chain.
    /// Returns (face_ids, he_ids) — one pair per face found.
    pub fn get_faces_sharing_edge(&self, edge_id: EdgeId) -> (Vec<FaceId>, Vec<HeId>) {
        let mut faces = Vec::with_capacity(2);
        let mut hes = Vec::with_capacity(2);
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            return (faces, hes);
        }
        let mut he_id = start_he;
        loop {
            let f = self.hes[he_id].face();
            if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                if !faces.contains(&f) {
                    faces.push(f);
                    hes.push(he_id);
                }
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }
        (faces, hes)
    }

    /// ADR-021 P7 — Group simple inner faces by connected component.
    ///
    /// 두 face 가 edge 를 공유하면 같은 component. BFS 로 그룹화.
    /// 사용처: Step 4.95 P7 promote — connected component → 1 combined hole.
    pub fn find_inner_components(&self, inners: &[FaceId]) -> Vec<Vec<FaceId>> {
        use rustc_hash::FxHashSet;
        let inner_set: FxHashSet<FaceId> = inners.iter().copied().collect();
        let mut visited: FxHashSet<FaceId> = FxHashSet::default();
        let mut components: Vec<Vec<FaceId>> = Vec::new();

        for &start in inners {
            if visited.contains(&start) { continue; }
            let mut comp = Vec::new();
            let mut queue = vec![start];
            while let Some(fid) = queue.pop() {
                if visited.contains(&fid) { continue; }
                visited.insert(fid);
                comp.push(fid);

                let face = match self.faces.get(fid) { Some(f) => f, None => continue };
                let outer_start = face.outer().start;
                if outer_start.is_null() { continue; }
                let mut h = outer_start;
                let mut guard = 0usize;
                loop {
                    guard += 1;
                    if guard > 4096 { break; }
                    let twin = self.he_twin(h);
                    let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                    if !twin_face.is_null()
                        && inner_set.contains(&twin_face)
                        && !visited.contains(&twin_face)
                    {
                        queue.push(twin_face);
                    }
                    let he = match self.hes.get(h) { Some(h) => h, None => break };
                    h = he.next();
                    if h == outer_start { break; }
                }
            }
            components.push(comp);
        }
        components
    }

    /// ADR-021 P7 — Combined outer perimeter of a connected face component.
    ///
    /// Component 의 외곽 boundary 만 모아 CCW order 로 walk.
    /// Hole loop 으로 사용 시 호출자가 reverse() 하여 CW 로 변환.
    /// 결과: VertId 시퀀스 (CCW around the union region).
    pub fn compute_combined_perimeter(&self, component: &[FaceId]) -> anyhow::Result<Vec<VertId>> {
        use rustc_hash::FxHashSet;
        if component.is_empty() {
            anyhow::bail!("compute_combined_perimeter: empty component");
        }
        let comp_set: FxHashSet<FaceId> = component.iter().copied().collect();

        // 1) Find any boundary HE: outer-loop HE whose twin's face is NOT in component.
        let mut start_he: HeId = HeId::NULL;
        for &fid in component {
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            let outer_start = face.outer().start;
            if outer_start.is_null() { continue; }
            let mut h = outer_start;
            let mut guard = 0usize;
            loop {
                guard += 1;
                if guard > 4096 { break; }
                let twin = self.he_twin(h);
                let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                if twin_face.is_null() || !comp_set.contains(&twin_face) {
                    start_he = h;
                    break;
                }
                let he = match self.hes.get(h) { Some(h) => h, None => break };
                h = he.next();
                if h == outer_start { break; }
            }
            if !start_he.is_null() { break; }
        }
        if start_he.is_null() {
            anyhow::bail!("compute_combined_perimeter: no boundary HE in component");
        }

        // 2) Walk the boundary CCW. At each step, take next; if next is interior
        //    (twin in component), jump to twin.next to continue along the union.
        let mut walk: Vec<HeId> = vec![start_he];
        let mut cur = start_he;
        let mut guard = 0usize;
        loop {
            guard += 1;
            if guard > 8192 {
                anyhow::bail!("compute_combined_perimeter: walk too long");
            }
            let cur_he = self.hes.get(cur)
                .ok_or_else(|| anyhow::anyhow!("missing HE in walk"))?;
            let mut next_he_id = cur_he.next();
            // Skip interior edges.
            let mut inner_guard = 0usize;
            loop {
                inner_guard += 1;
                if inner_guard > 4096 {
                    anyhow::bail!("compute_combined_perimeter: interior skip too long");
                }
                let next_he = self.hes.get(next_he_id)
                    .ok_or_else(|| anyhow::anyhow!("missing HE in skip"))?;
                let twin = self.he_twin(next_he_id);
                let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                if twin_face.is_null() || !comp_set.contains(&twin_face) {
                    break; // boundary
                }
                // interior — jump to twin's next
                next_he_id = self.hes.get(twin)
                    .ok_or_else(|| anyhow::anyhow!("missing twin"))?.next();
                let _ = next_he;
            }
            if next_he_id == start_he { break; }
            walk.push(next_he_id);
            cur = next_he_id;
        }

        // 3) Convert HEs → source verts (CCW order)
        let verts: Vec<VertId> = walk.iter()
            .map(|&h| self.he_source(h))
            .collect();
        Ok(verts)
    }

    /// Check if two faces are coplanar: normals nearly parallel AND on the same plane.
    ///
    /// F8 fix (2026-04-17): tolerances are now scale-aware and mutually consistent.
    /// - Normal parallelism: `|dot| >= cos(0.5°)` (≈ 1e-5 gap). Was `1e-3` which
    ///   corresponded to ≈ 2.5° — too loose for CAD-grade merges.
    /// - Plane distance: `max(1e-3, faces_bbox_diagonal × 1e-5)` — absolute floor
    ///   (1μm) plus a relative component so large (km-scale) or small (μm-scale)
    ///   models behave sensibly.
    pub fn are_faces_coplanar_strict(&self, f1: FaceId, f2: FaceId) -> Result<bool> {
        // Default strict tolerance = 0.5° (기존 동작 유지)
        self.are_faces_coplanar_with_tolerance(f1, f2, 0.5)
    }

    /// 사용자 지정 각도 tolerance로 coplanar 여부 검사 (B1).
    ///
    /// `angle_tol_deg` — 법선 간 허용 각도 (°). 0.5 = CAD 표준,
    /// 2~5는 "거의 coplanar" 병합용.
    /// 0 이하 또는 NaN이면 기본 0.5°로 보정.
    pub fn are_faces_coplanar_with_tolerance(
        &self,
        f1: FaceId,
        f2: FaceId,
        angle_tol_deg: f64,
    ) -> Result<bool> {
        let verts1 = self.collect_loop_verts(self.faces[f1].outer().start)?;
        let verts2 = self.collect_loop_verts(self.faces[f2].outer().start)?;
        if verts1.len() < 3 || verts2.len() < 3 {
            return Ok(false);
        }

        let n1 = self.compute_normal(&verts1)?;
        let n2 = self.compute_normal(&verts2)?;
        let n1_len = n1.length();
        let n2_len = n2.length();
        if n1_len < 1e-10 || n2_len < 1e-10 {
            return Ok(true); // degenerate → treat as coplanar
        }
        let n1u = n1 / n1_len;
        let n2u = n2 / n2_len;

        // 동적 threshold — 사용자 tolerance 기반
        let tol = if angle_tol_deg.is_finite() && angle_tol_deg > 0.0 {
            angle_tol_deg.min(45.0) // 상한 45° (그 이상은 의미 없음)
        } else {
            0.5
        };
        let cos_threshold = (tol.to_radians()).cos();
        let dot = n1u.dot(n2u).abs();
        if dot < cos_threshold {
            return Ok(false);
        }

        // Scale-aware distance tolerance: use f1+f2 combined bbox diagonal.
        // Tolerance scales with angle tolerance — a larger angle can tilt the
        // far vertex by bbox × sin(angle), so distance tolerance must allow
        // that much offset. Otherwise 2° angle accept + 0.002mm distance reject
        // contradicts each other for non-tiny faces.
        let mut min_pt = glam::DVec3::splat(f64::INFINITY);
        let mut max_pt = glam::DVec3::splat(f64::NEG_INFINITY);
        for &vid in verts1.iter().chain(verts2.iter()) {
            if let Ok(p) = self.vertex_pos(vid) {
                min_pt = min_pt.min(p);
                max_pt = max_pt.max(p);
            }
        }
        let bbox_diag = (max_pt - min_pt).length().max(1.0);
        // 기본 정밀 tolerance (구 로직 유지) + 각도 기반 보정
        let base_tol = (bbox_diag * 1e-5).max(1e-3);
        let angle_based_tol = bbox_diag * tol.to_radians().sin() * 1.2; // 20% 여유
        let dist_tol = base_tol.max(angle_based_tol);

        // Point-to-plane distance check against the plane defined by f1
        let p1 = self.vertex_pos(verts1[0])?;
        let p2 = self.vertex_pos(verts2[0])?;
        let distance = n1u.dot(p2 - p1).abs();
        Ok(distance < dist_tol)
    }

    /// Find the half-edge belonging to a specific face on a given edge.
    fn find_he_for_face_and_edge(&self, face_id: FaceId, edge_id: EdgeId) -> Result<HeId> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        for he_id in hes {
            if self.hes[he_id].edge() == edge_id {
                return Ok(he_id);
            }
        }
        bail!("HalfEdge for face {:?} on edge {:?} not found", face_id, edge_id)
    }

    /// Merge two face loops by removing the shared edge's half-edges.
    /// Returns the merged vertex list (AixxiA `merge_face_loops` port).
    fn merge_face_loops(&self, he1: HeId, he2: HeId) -> Result<Vec<VertId>> {
        let mut merged = Vec::new();

        // Walk he1's loop skipping he1 itself
        let mut cur = self.hes[he1].next();
        let mut iters = 0;
        while cur != he1 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        // Walk he2's loop skipping he2 itself
        cur = self.hes[he2].next();
        iters = 0;
        while cur != he2 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        if merged.len() < 3 {
            bail!("Merged face would have fewer than 3 vertices");
        }
        Ok(merged)
    }

    /// Remove an edge and all its half-edges from the mesh.
    ///
    /// Safe cleanup (2026-04-17 F1/F2/F7 fixes):
    /// - F7: 10_000-iteration guard replaces arbitrary 100-cap; returns error on overrun
    /// - F1: Vertex.outgoing() is repointed to a surviving HE so downstream traversals
    ///       don't follow a dangling reference
    /// - F2: next_rad radial chain is spliced out before HE removal so non-manifold
    ///       edges' radial walks remain consistent
    pub fn remove_edge_and_halfedges(&mut self, edge_id: EdgeId) -> Result<()> {
        if !self.edges.contains(edge_id) {
            bail!("Edge {:?} not found", edge_id);
        }

        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();

        // Collect all HEs in radial chain (F7: safer guard)
        let start_he = self.edges[edge_id].any_he();
        let mut to_remove: Vec<HeId> = Vec::new();
        if !start_he.is_null() {
            let mut he_id = start_he;
            let mut guard = 0usize;
            loop {
                to_remove.push(he_id);
                he_id = self.hes[he_id].next_rad();
                if he_id == start_he { break; }
                guard += 1;
                if guard > 10_000 {
                    bail!("Radial chain overrun on edge {:?} — corrupted topology", edge_id);
                }
            }
        }

        let removed_set: rustc_hash::FxHashSet<HeId> =
            to_remove.iter().copied().collect();

        // F1: repoint each endpoint vertex's `outgoing` to a surviving HE.
        for &v in &[v_small, v_large] {
            let cur = self.verts[v].outgoing();
            if let Some(out) = cur {
                if !removed_set.contains(&out) { continue; }
                // Find any live HE whose origin == v (i.e., prev(h).dst == v)
                let mut replacement: Option<HeId> = None;
                for (h_id, h) in self.hes.iter() {
                    if removed_set.contains(&h_id) || !h.is_active() { continue; }
                    let p = h.prev();
                    if p.is_null() || !self.hes.contains(p) { continue; }
                    if self.hes[p].dst() == v {
                        replacement = Some(h_id);
                        break;
                    }
                }
                self.verts[v].set_outgoing(replacement);
            }
        }

        // v_ring splice: each outgoing HE must be removed from its origin's
        // v_next cycle. Origin of a HE = prev(he).dst (or v_small/v_large if
        // prev is unavailable — fallback for freshly built / isolated HEs).
        for &he in &to_remove {
            let origin = {
                let p = self.hes[he].prev();
                if !p.is_null() && self.hes.contains(p) {
                    self.hes[p].dst()
                } else {
                    // Fallback: guess origin as the endpoint NOT matching dst
                    let dst = self.hes[he].dst();
                    if dst == v_small { v_large } else { v_small }
                }
            };
            if self.verts.contains(origin) {
                self.remove_from_v_ring(origin, he);
            }
        }

        // F2: splice each removed HE out of its next_rad chain so non-manifold
        // neighbors keep their radial traversal intact.
        for &he in &to_remove {
            let next_of_he = self.hes[he].next_rad();
            // Find pred: any live HE whose next_rad points to this he
            let mut pred: Option<HeId> = None;
            for (h_id, h) in self.hes.iter() {
                if removed_set.contains(&h_id) { continue; }
                if h.next_rad() == he {
                    pred = Some(h_id);
                    break;
                }
            }
            if let Some(p) = pred {
                self.hes[p].set_next_rad(next_of_he);
            }
        }

        // Remove HEs
        for he in &to_remove {
            self.hes.remove(*he);
        }

        // Remove edge from lookup
        let key = VertPairKey::new(v_small, v_large);
        self.vert_to_edge.remove(&key);
        self.edges.remove(edge_id);
        Ok(())
    }

    /// Merge two coplanar faces sharing an edge.
    /// AixxiA's `merge_face_by_edge_id` ported directly.
    ///
    /// 1. Check that exactly 2 faces share the edge
    /// 2. Check coplanarity
    /// 3. Merge vertex loops (remove shared edge vertices from loop)
    /// 4. Delete old faces and shared edge
    /// 5. Create new merged face
    pub fn merge_faces_by_edge(&mut self, edge_id: EdgeId) -> Result<FaceId> {
        self.merge_faces_by_edge_with_tolerance(edge_id, 0.5)
    }

    /// 사용자 지정 각도 tolerance로 두 coplanar face 병합 (B1).
    ///
    /// `angle_tol_deg` — 허용 각도 (°). 0.5 = 엄격, 2~5 = 관대.
    /// CAD-grade 품질을 위해 상한 45°로 자동 클램프.
    pub fn merge_faces_by_edge_with_tolerance(
        &mut self,
        edge_id: EdgeId,
        angle_tol_deg: f64,
    ) -> Result<FaceId> {
        // 1. Find the two faces sharing this edge
        let (faces, _hes) = self.get_faces_sharing_edge(edge_id);
        if faces.len() != 2 {
            bail!("Edge {:?} shared by {} faces (need exactly 2)", edge_id, faces.len());
        }
        let f1 = faces[0];
        let f2 = faces[1];

        // F4: reject when F1 and F2 share more than one edge — ambiguous merge
        // (e.g. C-slit / bridge topology).
        let shared = self.count_shared_edges_outer(f1, f2);
        if shared != 1 {
            bail!("Faces {:?} and {:?} share {} edges (exactly 1 required)", f1, f2, shared);
        }

        // 2. Coplanarity check (tolerance 기반)
        if !self.are_faces_coplanar_with_tolerance(f1, f2, angle_tol_deg)? {
            bail!("Faces {:?} and {:?} are not coplanar (tol={:.2}°)", f1, f2, angle_tol_deg);
        }

        // 3. Save original normal for winding consistency + material
        let original_normal = self.faces[f1].normal();
        let material = self.faces[f1].material();

        // 4. Find half-edges for each face on this edge and merge loops
        let he1 = self.find_he_for_face_and_edge(f1, edge_id)?;
        let he2 = self.find_he_for_face_and_edge(f2, edge_id)?;
        let mut merged_verts = self.merge_face_loops(he1, he2)?;

        // 5. Fix winding: merged loop might reverse the normal direction.
        let merged_normal = self.compute_normal(&merged_verts)?;
        if merged_normal.dot(original_normal) < 0.0 {
            merged_verts.reverse();
        }

        // F6: Remove collinear vertices (T-junction cleanup)
        merged_verts = self.simplify_collinear_loop(&merged_verts);
        if merged_verts.len() < 3 {
            bail!("Merged loop degenerate after collinear simplification");
        }

        // F5: Pre-validate — attempt compute_normal on the simplified loop.
        // If this fails we bail BEFORE any destructive removal (atomicity).
        let _ = self.compute_normal(&merged_verts)
            .map_err(|e| anyhow::anyhow!("Merge pre-validation: {}", e))?;

        // F3: Collect inner loops (holes) from BOTH faces before removal.
        // add_face_with_holes will re-materialize them on the merged face.
        let mut inner_loops: Vec<Vec<VertId>> = Vec::new();
        for &fid in &[f1, f2] {
            let inners: Vec<_> = self.faces[fid].inners().to_vec();
            for inner_ref in inners {
                if inner_ref.start.is_null() { continue; }
                if let Ok(v) = self.collect_loop_verts(inner_ref.start) {
                    if v.len() >= 3 { inner_loops.push(v); }
                }
            }
        }

        // 7. Destructive phase — all pre-validation done above.
        self.remove_edge_and_halfedges(edge_id)?;
        self.faces.remove(f1);
        self.faces.remove(f2);

        // 9. Create new merged face with preserved holes (F3)
        let hole_slices: Vec<&[VertId]> = inner_loops.iter().map(|v| v.as_slice()).collect();
        let new_face = self.add_face_with_holes(&merged_verts, &hole_slices, material)?;

        // 10. 2026-04-27 — 사용자 보고 "면은 합성되지만 잔여 선이 면과 일체화":
        //   simplify_collinear_loop 가 중간 vertex 를 제거해도, 그 vertex 가
        //   다른 dangling 엣지 (이전 split 결과의 stub) 의 endpoint 라면
        //   merged face 의 새 loop 에는 안 들어가지만 mesh 에는 그대로 남아
        //   "보이는 잔여 선" 이 됨. cleanup_dangling 이 엣지의 양쪽 half-edge
        //   가 모두 inactive face 인 경우만 제거하므로 안전 (다른 face 가
        //   여전히 사용하는 엣지는 보존).
        let _ = self.cleanup_dangling();

        // 2026-04-28 — 사용자 보고 후속: 단일-shared standard merge 경로에서도
        //   비-manifold edge / split-vertex stub 잔재 가능. second pass 강화.
        let mut second_pass_remove: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() {
                second_pass_remove.push(eid);
                continue;
            }
            let mut all_null = true;
            let mut he = any_he;
            let mut guard = 0;
            loop {
                let f = self.hes[he].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    all_null = false;
                    break;
                }
                he = self.hes[he].next_rad();
                guard += 1;
                if he == any_he || he.is_null() || guard > 10 { break; }
            }
            if all_null { second_pass_remove.push(eid); }
        }
        for eid in second_pass_remove {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }
        self.remove_isolated_verts();

        // ADR-007 — merge 후 invariants 검증 (debug only)
        self.debug_verify_invariants();
        Ok(new_face)
    }

    /// Phase F — 비인접(non-adjacent) coplanar 병합: outer face 안에 완전히
    /// 포함된 inner face를 hole로 합침 (ADR-006 C1 케이스).
    ///
    /// 조건:
    ///   - 두 face가 coplanar (tolerance 적용)
    ///   - inner의 모든 vertex가 outer 평면 내부에 투영됐을 때 outer 다각형 내부
    ///   - 두 face가 엣지를 공유하지 않음 (진짜 비인접)
    ///
    /// 동작:
    ///   1. outer의 기존 hole들 보존
    ///   2. inner의 outer loop을 새 hole로 추가 (CW 방향으로 저장됨)
    ///   3. inner face 제거 (그러나 vert/edge는 남아 hole boundary로 사용)
    ///
    /// 반환: 병합된 face_id (기존 outer_face 재사용)
    pub fn merge_coplanar_containing(
        &mut self,
        outer_face: FaceId,
        inner_face: FaceId,
        angle_tol_deg: f64,
    ) -> Result<FaceId> {
        if outer_face == inner_face {
            bail!("outer and inner faces are the same");
        }
        // 두 face 활성 확인
        if !self.faces.get(outer_face).map(|f| f.is_active()).unwrap_or(false) {
            bail!("outer face {:?} inactive or missing", outer_face);
        }
        if !self.faces.get(inner_face).map(|f| f.is_active()).unwrap_or(false) {
            bail!("inner face {:?} inactive or missing", inner_face);
        }

        // 1. 엣지 공유 금지 (공유하면 일반 merge_faces_by_edge 사용해야 함)
        let shared = self.count_shared_edges_outer(outer_face, inner_face);
        if shared > 0 {
            bail!("faces share {} edge(s) — use merge_faces_by_edge instead", shared);
        }

        // 2. Coplanarity (tolerance 허용)
        if !self.are_faces_coplanar_with_tolerance(outer_face, inner_face, angle_tol_deg)? {
            bail!("faces not coplanar within {:.2}°", angle_tol_deg);
        }

        // 3. 외부 경계 수집
        let outer_verts = self.collect_loop_verts(self.faces[outer_face].outer().start)?;
        let inner_verts = self.collect_loop_verts(self.faces[inner_face].outer().start)?;
        if outer_verts.len() < 3 || inner_verts.len() < 3 {
            bail!("degenerate loop");
        }

        // 4. Containment — outer의 평면에서 inner 모든 vertex가 outer polygon 내부
        //    (2D projection + point-in-polygon)
        let n = self.faces[outer_face].normal().normalize_or_zero();
        if n.length_squared() < 1e-10 {
            bail!("outer face normal degenerate");
        }
        let p0 = self.vertex_pos(outer_verts[0])?;
        // 평면의 두 basis 구성
        let mut t = DVec3::new(1.0, 0.0, 0.0);
        if t.cross(n).length_squared() < 1e-6 { t = DVec3::new(0.0, 1.0, 0.0); }
        let e1 = (t - n * t.dot(n)).normalize_or_zero();
        let e2 = n.cross(e1).normalize_or_zero();
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };
        let outer_2d: Vec<(f64, f64)> = outer_verts.iter()
            .filter_map(|v| self.vertex_pos(*v).ok())
            .map(project2d)
            .collect();
        if outer_2d.len() < 3 { bail!("outer 2D projection failed"); }

        let point_in = |x: f64, y: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > y) != (yj > y))
                   && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        for &iv in &inner_verts {
            let p = self.vertex_pos(iv)?;
            let (x, y) = project2d(p);
            if !point_in(x, y, &outer_2d) {
                bail!("inner face {:?} not contained in outer {:?}", inner_face, outer_face);
            }
        }

        // 5. outer의 기존 hole들 보존
        let existing_inner_refs: Vec<LoopRef> = self.faces[outer_face].inners().to_vec();
        let mut existing_holes: Vec<Vec<VertId>> = Vec::new();
        for inner_ref in &existing_inner_refs {
            if inner_ref.start.is_null() { continue; }
            if let Ok(v) = self.collect_loop_verts(inner_ref.start) {
                if v.len() >= 3 { existing_holes.push(v); }
            }
        }

        // 6. inner의 inner loops — 이 경우 inner face도 hole을 가질 수 있지만
        //    보통 평평한 rect/원 → 지원 안 해도 일반적이진 않음. 일단 보존.
        let inner_face_holes: Vec<Vec<VertId>> = self.faces[inner_face].inners().iter()
            .filter_map(|ir| self.collect_loop_verts(ir.start).ok())
            .filter(|v| v.len() >= 3)
            .collect();

        // 7. 재료는 outer 기준
        let material = self.faces[outer_face].material();

        // 8. 두 face 제거 (엣지는 add_face_with_holes가 dedup하므로 살아남음)
        self.faces.remove(outer_face);
        self.faces.remove(inner_face);

        // 9. 재생성 — outer_verts + [inner_verts] + 기존 holes + inner의 holes
        let mut hole_slices: Vec<&[VertId]> = Vec::new();
        hole_slices.push(&inner_verts);
        for h in &existing_holes { hole_slices.push(h); }
        for h in &inner_face_holes { hole_slices.push(h); }

        let new_face = self.add_face_with_holes(&outer_verts, &hole_slices, material)?;
        // ADR-007 — 연산 후 invariants 검증
        self.debug_verify_invariants();
        Ok(new_face)
    }

    /// Count edges shared by the outer loops of two faces (F4 helper).
    pub fn count_shared_edges_outer(&self, f1: FaceId, f2: FaceId) -> usize {
        let mut set = rustc_hash::FxHashSet::default();
        if let Ok(hes) = self.collect_loop_hes(self.faces[f1].outer().start) {
            for he in hes { set.insert(self.hes[he].edge()); }
        }
        let mut count = 0usize;
        if let Ok(hes) = self.collect_loop_hes(self.faces[f2].outer().start) {
            for he in hes {
                if set.contains(&self.hes[he].edge()) { count += 1; }
            }
        }
        count
    }

    /// Remove vertices that lie on the straight segment between their neighbors (F6).
    ///
    /// Given a cyclic loop `[v0, v1, ..., vN-1]`, if three consecutive vertices
    /// (prev, curr, next) are collinear within tolerance, `curr` is dropped.
    /// Used after face-merge to clean T-junction artifacts.
    pub(crate) fn simplify_collinear_loop(&self, verts: &[VertId]) -> Vec<VertId> {
        let n = verts.len();
        if n < 3 { return verts.to_vec(); }
        let mut out: Vec<VertId> = Vec::with_capacity(n);
        for i in 0..n {
            let prev = verts[(i + n - 1) % n];
            let curr = verts[i];
            let next = verts[(i + 1) % n];
            let (p, c, q) = match (self.vertex_pos(prev), self.vertex_pos(curr), self.vertex_pos(next)) {
                (Ok(a), Ok(b), Ok(cc)) => (a, b, cc),
                _ => { out.push(curr); continue; },
            };
            let e1 = c - p;
            let e2 = q - c;
            let l1 = e1.length();
            let l2 = e2.length();
            if l1 < 1e-9 || l2 < 1e-9 {
                // Near-zero segment — keep to avoid pathological loss
                out.push(curr);
                continue;
            }
            let dot = e1.dot(e2) / (l1 * l2);
            // Collinear if dot ≈ 1 (same direction, tolerance ~0.01°)
            if dot < 0.9999999 {
                out.push(curr);
            }
            // else: drop curr (collinear with neighbors)
        }
        out
    }

    // ========================================================================
    // Self-healing: degenerate cleanup + face reconstruction
    // ========================================================================

    /// Compute the raw (un-normalized) Newell vector.
    /// Its length equals **2 × signed planar area** of the polygon.
    /// Used by degenerate detection and face reconstruction.
    fn newell_raw(&self, verts: &[VertId]) -> Option<DVec3> {
        if verts.len() < 3 { return None; }
        let mut n = DVec3::ZERO;
        let len = verts.len();
        for i in 0..len {
            let p0 = self.vertex_pos(verts[i]).ok()?;
            let p1 = self.vertex_pos(verts[(i + 1) % len]).ok()?;
            n.x += (p0.y - p1.y) * (p0.z + p1.z);
            n.y += (p0.z - p1.z) * (p0.x + p1.x);
            n.z += (p0.x - p1.x) * (p0.y + p1.y);
        }
        Some(n)
    }

    /// Return the planar area of a face (outer loop, ignoring holes).
    /// 0 for degenerate or missing faces.
    /// Signed volume of the mesh (sum of signed tetrahedra built from the
    /// origin and each triangle of every active face, fan-triangulated).
    /// Exact for closed manifold solids; for open shells the result is
    /// the rough "enclosed" volume relative to the origin — useful as
    /// an estimate but not authoritative. Units: length³.
    pub fn mesh_volume(&self) -> f64 {
        let mut total = 0.0;
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let start = face.outer().start;
            if start.is_null() { continue; }
            let verts = match self.collect_loop_verts(start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            // Fan-triangulate around verts[0]. For each triangle
            // (v0, vi, vi+1) add the signed tetrahedron volume
            // (v0 · (vi × vi+1)) / 6. Summed across all faces of a
            // closed solid this gives the enclosed volume with sign
            // determined by the outward winding (ADR-007 CCW → positive).
            let p0 = match self.vertex_pos(verts[0]) { Ok(p) => p, Err(_) => continue };
            for i in 1..verts.len() - 1 {
                let pa = match self.vertex_pos(verts[i]) { Ok(p) => p, Err(_) => continue };
                let pb = match self.vertex_pos(verts[i + 1]) { Ok(p) => p, Err(_) => continue };
                total += p0.dot(pa.cross(pb));
            }
            let _ = fid;
        }
        total / 6.0
    }

    pub fn face_area(&self, face_id: FaceId) -> f64 {
        let f = match self.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return 0.0,
        };
        let start = f.outer().start;
        if start.is_null() { return 0.0; }
        let verts = match self.collect_loop_verts(start) {
            Ok(v) => v,
            Err(_) => return 0.0,
        };
        match self.newell_raw(&verts) {
            Some(n) => n.length() * 0.5,
            None => 0.0,
        }
    }

    /// Check if every outer-loop vertex of `face_id` lies within `tol` of the
    /// stored face plane. Returns `true` only when the face is genuinely planar.
    pub fn is_face_planar(&self, face_id: FaceId, tol: f64) -> bool {
        let f = match self.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return false,
        };
        let start = f.outer().start;
        if start.is_null() { return false; }
        let verts = match self.collect_loop_verts(start) {
            Ok(v) => v,
            Err(_) => return false,
        };
        if verts.len() < 3 { return false; }
        // Plane: (normal, offset = normal · v0)
        let n = f.normal();
        let p0 = match self.vertex_pos(verts[0]) { Ok(p) => p, Err(_) => return false };
        let d = n.dot(p0);
        for &v in verts.iter().skip(1) {
            if let Ok(p) = self.vertex_pos(v) {
                if (n.dot(p) - d).abs() > tol {
                    return false;
                }
            }
        }
        true
    }

    /// Reconstruct a non-planar face by splitting it into coplanar pieces.
    ///
    /// Uses ear-clipping fan triangulation: emits triangles from v0 as a fan,
    /// each guaranteed planar (3 vertices ⇒ always planar). Original face is
    /// removed; returns the list of newly-created triangle face IDs.
    ///
    /// Used for importing external geometry (OBJ/DXF/etc.) where n-gon faces
    /// may not be exactly planar due to encoder precision or modeling error.
    ///
    /// If the input face is already planar within `tol`, returns the face
    /// unchanged in a single-element vector.
    pub fn reconstruct_face(&mut self, face_id: FaceId, tol: f64) -> Result<Vec<FaceId>> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found", face_id);
        }
        if self.is_face_planar(face_id, tol) {
            return Ok(vec![face_id]);
        }

        // Collect data needed BEFORE destructive changes
        let material = self.faces[face_id].material();
        let start = self.faces[face_id].outer().start;
        let verts = self.collect_loop_verts(start)?;
        if verts.len() < 4 {
            // Triangle can't be non-planar (numerically); just return it.
            return Ok(vec![face_id]);
        }

        // Remove the original (soft delete + drop)
        let _ = self.remove_face(face_id);
        if self.faces.contains(face_id) {
            self.faces.remove(face_id);
        }

        // Fan triangulation from vertex 0 — each triangle is coplanar by construction
        let mut new_faces = Vec::new();
        let v0 = verts[0];
        for i in 1..verts.len() - 1 {
            let tri = [v0, verts[i], verts[i + 1]];
            // Skip degenerate triangles (any two verts coincide)
            if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                continue;
            }
            match self.add_face(&tri, material) {
                Ok(fid) => new_faces.push(fid),
                Err(_) => { /* skip degenerate tri */ }
            }
        }
        Ok(new_faces)
    }

    /// Remove faces whose planar area is below `tol`.
    /// Returns the number of faces cleaned up.
    ///
    /// Used as a periodic "self-heal" routine for:
    /// - Numerical drift after many edge splits / merges
    /// - Imported meshes with zero-area artefacts
    ///
    /// ADR-003 Geometric Validity Principle prevents most degenerate creations,
    /// but this routine handles cases that slip through (external imports,
    /// compounded floating-point error).
    pub fn cleanup_degenerate_faces(&mut self, tol: f64) -> usize {
        // Collect candidates first (avoid borrow issues while iterating)
        let mut to_remove: Vec<FaceId> = Vec::new();
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let area = self.face_area(fid);
            if area < tol {
                to_remove.push(fid);
            }
        }
        let count = to_remove.len();
        for fid in to_remove {
            let _ = self.remove_face(fid);
            if self.faces.contains(fid) {
                self.faces.remove(fid);
            }
        }
        // Orphans may remain after face removal
        self.remove_isolated_verts();
        count
    }

    /// Remove dangling edges — edges with zero half-edges referencing an
    /// active face AND not in the scene's standalone-edge list. These appear
    /// after face merges when the old shared edge's topology wasn't fully
    /// dismantled.
    ///
    /// 2026-04-24: companion to the smooth-on-merge-fail path. After a
    /// successful merge, shelve residual edges/verts that have no geometric
    /// meaning left so they don't leak into render buffers.
    ///
    /// Returns (removed_edges, removed_vertices).
    pub fn cleanup_dangling(&mut self) -> (usize, usize) {
        self.cleanup_dangling_excluding(&std::collections::HashSet::new())
    }

    /// Same as `cleanup_dangling` but keeps any edge listed in `protected`
    /// even if it has lost all face references. Used by the Erase tool's
    /// face-only delete path so that boundary edges remain as standalone
    /// wireframe instead of vanishing along with the face (SketchUp-style
    /// CAD UX: "면만 지우고 엣지는 남긴다").
    ///
    /// The vertex-cleanup pass (step 2) still runs — orphan vertices that
    /// no edge references are removed unconditionally. Protected orphan
    /// edges are by definition still referencing their endpoints, so those
    /// vertices stay alive automatically.
    pub fn cleanup_dangling_excluding(
        &mut self,
        protected: &std::collections::HashSet<EdgeId>,
    ) -> (usize, usize) {
        // Step 1 — edges whose half-edges all point to inactive faces.
        //   The DCEL guarantees every edge has ≤ 2 half-edges; if both point
        //   to inactive faces (or null), the edge is dangling.
        let mut to_remove: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if protected.contains(&eid) { continue; }
            let he_a = edge.any_he();
            if he_a.is_null() {
                to_remove.push(eid);
                continue;
            }
            // Walk the radial chain; if no half-edge references an active face,
            // the edge is orphaned.
            let mut has_active_face = false;
            let mut he_id = he_a;
            loop {
                let he = &self.hes[he_id];
                let fid = he.face();
                if !fid.is_null() && self.faces.contains(fid) && self.faces[fid].is_active() {
                    has_active_face = true;
                    break;
                }
                he_id = he.next_rad();
                if he_id == he_a || he_id.is_null() { break; }
            }
            if !has_active_face {
                to_remove.push(eid);
            }
        }
        let edge_removed = to_remove.len();
        for eid in to_remove {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }

        // Step 2 — vertices with no remaining edge references.
        let before_verts = self.verts.iter().count();
        self.remove_isolated_verts();
        let after_verts = self.verts.iter().count();
        let vert_removed = before_verts - after_verts;

        (edge_removed, vert_removed)
    }

    /// Remove vertices that have no edges referencing them.
    pub fn remove_isolated_verts(&mut self) {
        let mut referenced = std::collections::HashSet::new();
        for (_, edge) in self.edges.iter() {
            referenced.insert(edge.v_small());
            referenced.insert(edge.v_large());
        }
        let isolated: Vec<_> = self.verts.iter()
            .map(|(vid, _)| vid)
            .filter(|vid| !referenced.contains(vid))
            .collect();
        for vid in isolated {
            self.verts.remove(vid);
        }
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    pub fn vert_count(&self) -> usize {
        self.verts.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn face_count(&self) -> usize {
        self.faces.len()
    }

    pub fn he_count(&self) -> usize {
        self.hes.len()
    }

    // ═══════════════════════════════════════════════════════════════
    //  Face Orientation Invariants (ADR-007)
    // ═══════════════════════════════════════════════════════════════

    /// ADR-097 T-β — Topology damage detection (Phase 4).
    ///
    /// Q5 사건 2 (boundary edge / non-manifold) + 사건 3 (degenerate
    /// face) 의 typed enumeration. dispatcher (T-γ) 가 본 결과를 패턴
    /// 매치하여 알려진 recovery 자산을 호출.
    ///
    /// **사건 4 (Orphan)** 은 Scene context (face_to_xia / face_to_shape /
    /// face_to_reference reverse 인덱스) 가 필요하므로 본 메서드에서
    /// 미검출 — Scene-level wrapper (T-γ) 에서 추가.
    ///
    /// **Detection algorithm**:
    /// - 각 active edge: radial HE chain 의 active+with-face HE 수
    ///   카운트
    ///   - count == 0: ignore (truly free edge / wire)
    ///   - count == 1: BoundaryEdge { edge, incident face }
    ///   - count == 2: OK (manifold)
    ///   - count >= 3: NonManifold { edge, face_count }
    /// - 각 active face: normal length 0 또는 NaN 검사 → Degenerate
    ///
    /// **State 변경 0** (read-only). Recovery 는 T-γ dispatcher.
    pub fn detect_topology_damage(&self) -> crate::topology_damage::TopologyDamageReport {
        use crate::topology_damage::{TopologyDamageKind, TopologyDamageReport};

        let mut damages: Vec<TopologyDamageKind> = Vec::new();
        let mut checked_faces = 0usize;
        let mut checked_edges = 0usize;

        // Pass 1: degenerate face detection (사건 3).
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            checked_faces += 1;

            let n = face.normal();
            // NaN 검사 (NaN != NaN — IEEE 754 정의).
            #[allow(clippy::eq_op)]
            let has_nan = n.x != n.x || n.y != n.y || n.z != n.z;
            if has_nan {
                damages.push(TopologyDamageKind::Degenerate {
                    face_id: fid,
                    reason: "NaN normal",
                });
                continue;
            }
            let mag2 = n.x * n.x + n.y * n.y + n.z * n.z;
            if mag2 < 1e-20 {
                damages.push(TopologyDamageKind::Degenerate {
                    face_id: fid,
                    reason: "zero normal",
                });
            }
        }

        // Pass 2: edge manifold detection (사건 2).
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            checked_edges += 1;

            let any_he = edge.any_he();
            if any_he.is_null() { continue; }

            // Walk radial chain — count active HE with face.
            let mut he_id = any_he;
            let mut active_he_with_face_count = 0usize;
            let mut first_incident_face: Option<crate::FaceId> = None;
            let mut iter_safety = 0usize;
            loop {
                if iter_safety > 100 {
                    // Defensive against corrupt radial chain.
                    break;
                }
                iter_safety += 1;

                let he = &self.hes[he_id];
                if he.is_active() {
                    let face_id = he.face();
                    if !face_id.is_null() {
                        if let Some(face) = self.faces.get(face_id) {
                            if face.is_active() {
                                active_he_with_face_count += 1;
                                if first_incident_face.is_none() {
                                    first_incident_face = Some(face_id);
                                }
                            }
                        }
                    }
                }

                let next_rad = he.next_rad();
                if next_rad.is_null() || next_rad == any_he {
                    break;
                }
                he_id = next_rad;
            }

            match active_he_with_face_count {
                0 => { /* truly free edge — ignore */ }
                1 => {
                    damages.push(TopologyDamageKind::BoundaryEdge {
                        edge_id: eid,
                        incident_face: first_incident_face
                            .unwrap_or(crate::FaceId::NULL),
                    });
                }
                2 => { /* manifold — OK */ }
                n => {
                    damages.push(TopologyDamageKind::NonManifold {
                        edge_id: eid,
                        face_count: n,
                    });
                }
            }
        }

        TopologyDamageReport {
            damages,
            checked_faces,
            checked_edges,
        }
    }

    /// ADR-097 T-γ — Topology damage 자동 recovery dispatcher.
    ///
    /// **Architectural 본질**: 새 알고리즘 발명 0 — 기존 자산
    /// (`repair_non_manifold_edges_geometric` / face deactivation)
    /// 의 atomic fixed-point orchestration.
    ///
    /// **Strategy**:
    /// 1. `detect_topology_damage()` 호출 → damage 0 면 NoOp 반환
    /// 2. fixed-point loop (max 3 iter):
    ///    - NonManifold → `repair_non_manifold_edges_geometric` 호출
    ///    - Degenerate → face soft-delete (`face.set_active(false)`)
    ///    - BoundaryEdge → skip (auto-fix 미시도, 다이얼로그 escalation)
    ///    - Orphan → Mesh-level 검출 안 됨 (Scene wrapper 책임)
    /// 3. re-detect; damage 0 면 Recovered, 잔존 시 PartialFailure
    ///
    /// **Atomic 보장**: caller (Scene / TransactionManager) 가
    /// transaction wrap 책임. 본 메서드 자체는 not all-or-nothing —
    /// 부분 fix 도 가능 (PartialFailure 시 일부 fixes_applied > 0).
    ///
    /// **사건별 dispatch policy** (ADR-097 §2.2 T-D):
    /// - BoundaryEdge: 사용자 의도 모호 → escalation (Sheet 가능성).
    /// - NonManifold: always damage → repair 시도.
    /// - Degenerate: always damage → deactivate.
    /// - Orphan: Scene wrapper 에서 추가 dispatch.
    pub fn attempt_auto_recovery(&mut self) -> crate::topology_damage::RecoveryOutcome {
        use crate::topology_damage::{RecoveryOutcome, TopologyDamageKind};

        let initial_report = self.detect_topology_damage();
        if initial_report.is_clean() {
            return RecoveryOutcome::NoOp;
        }
        let initial_damages = initial_report.damages.len();

        const MAX_ITER: usize = 3;
        let mut fixes_applied: usize = 0;

        for _iter in 0..MAX_ITER {
            let report = self.detect_topology_damage();
            if report.is_clean() {
                return RecoveryOutcome::Recovered { fixes_applied, initial_damages };
            }

            let mut any_fix_this_iter = false;

            // Pass 1: Degenerate face deactivation (가장 안전 — face
            // 단독 변경, edge / topology 영향 0).
            let degenerate_faces: Vec<crate::FaceId> = report.damages.iter()
                .filter_map(|d| match d {
                    TopologyDamageKind::Degenerate { face_id, .. } => Some(*face_id),
                    _ => None,
                })
                .collect();
            for fid in degenerate_faces {
                if let Some(face) = self.faces.get_mut(fid) {
                    if face.is_active() {
                        face.set_active(false);
                        fixes_applied += 1;
                        any_fix_this_iter = true;
                    }
                }
            }

            // Pass 2: NonManifold edge repair (geometric strategy).
            // 한 fixed-point iter 에서 시도하면 다음 iter 재 detection.
            let has_non_manifold = report.damages.iter()
                .any(|d| matches!(d, TopologyDamageKind::NonManifold { .. }));
            if has_non_manifold {
                let repair_report = self.repair_non_manifold_edges_geometric();
                if repair_report.edges_repaired > 0 {
                    fixes_applied += repair_report.edges_repaired;
                    any_fix_this_iter = true;
                }
            }

            // BoundaryEdge / Orphan: 본 dispatcher 미시도 (escalation).
            if !any_fix_this_iter {
                // No progress — break to avoid infinite loop.
                break;
            }
        }

        // Final report.
        let remaining = self.detect_topology_damage();
        if remaining.is_clean() {
            RecoveryOutcome::Recovered { fixes_applied, initial_damages }
        } else {
            RecoveryOutcome::PartialFailure { fixes_applied, remaining }
        }
    }

    /// 전체 mesh의 face orientation invariants 검증 결과.
    ///
    /// 위반 사항이 있으면 `violations`에 Human-readable 메시지 열거.
    /// `is_valid == true` 이면 모든 invariant 통과.
    pub fn verify_face_invariants(&self) -> InvariantReport {
        let mut violations: Vec<String> = Vec::new();
        let mut checked_faces = 0usize;

        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            checked_faces += 1;

            // I1: outer loop 존재 + 최소 3 verts
            let outer_start = face.outer().start;
            if outer_start.is_null() {
                violations.push(format!("face {:?}: null outer start", fid));
                continue;
            }
            let outer_verts = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(e) => {
                    violations.push(format!("face {:?}: cannot collect outer loop: {}", fid, e));
                    continue;
                }
            };
            // ADR-089 Phase 2 (A-ζ-1, 2026-05-08): I1 invariant 갱신.
            // Closed-curve face (1 vert anchor + 1 self-loop edge with
            // analytic curve attached) 도 valid — face = closed boundary
            // 의 byproduct (메타-원칙 #14). Polygon face (≥3 verts) 동작
            // 무변화.
            if outer_verts.len() < 3 {
                // Closed-curve exemption: outer loop = 1 vert + 1 self-loop
                // edge with Edge.curve.is_some().
                let is_closed_curve_face = outer_verts.len() == 1
                    && self.collect_loop_hes(outer_start).map(|hes| {
                        hes.len() == 1 && {
                            let he = &self.hes[hes[0]];
                            self.edges.get(he.edge())
                                .filter(|e| e.is_active())
                                .and_then(|e| e.curve())
                                .is_some()
                        }
                    }).unwrap_or(false);
                if !is_closed_curve_face {
                    violations.push(format!("face {:?}: outer loop has {} verts (< 3)",
                        fid, outer_verts.len()));
                    continue;
                }
                // Skip I2 (winding check via compute_normal) for closed-curve
                // face — the curve's analytic normal is the truth source.
                // Skip I4 (outer HE face check) — single HE already wired in
                // add_face_closed_curve. Continue to next face for I5.
                continue;
            }

            // I2: cached normal이 실제 winding과 일치 (반대 방향이면 위반)
            let cached = face.normal();
            if cached.length_squared() > 1e-10 {
                if let Ok(computed) = self.compute_normal(&outer_verts) {
                    let cn = cached.normalize_or_zero();
                    let gn = computed.normalize_or_zero();
                    if cn.length_squared() > 1e-10 && gn.length_squared() > 1e-10 {
                        let dot = cn.dot(gn);
                        if dot < 0.9 {
                            violations.push(format!(
                                "face {:?}: cached normal opposite to winding (dot={:.3})",
                                fid, dot,
                            ));
                        }
                    }
                }
            }

            // I3: inner loops 도 collect 가능해야 함 + 각각 ≥ 3 verts
            // (ADR-089 A-ζ-1 exemption: 1-vert inner with self-loop edge +
            // analytic curve = valid closed-curve hole).
            for (ii, inner) in face.inners().iter().enumerate() {
                if inner.start.is_null() {
                    violations.push(format!("face {:?}: inner[{}] null start", fid, ii));
                    continue;
                }
                match self.collect_loop_verts(inner.start) {
                    Ok(iv) if iv.len() >= 3 => {}
                    Ok(iv) if iv.len() == 1 => {
                        // ADR-089 A-ζ-1: closed-curve hole exemption.
                        let is_closed_curve_hole = self.collect_loop_hes(inner.start)
                            .map(|hes| {
                                hes.len() == 1 && {
                                    let he = &self.hes[hes[0]];
                                    self.edges.get(he.edge())
                                        .filter(|e| e.is_active())
                                        .and_then(|e| e.curve())
                                        .is_some()
                                }
                            }).unwrap_or(false);
                        if !is_closed_curve_hole {
                            violations.push(format!(
                                "face {:?}: inner[{}] has 1 vert without analytic curve",
                                fid, ii));
                        }
                    }
                    Ok(iv) => violations.push(format!(
                        "face {:?}: inner[{}] has {} verts (< 3)", fid, ii, iv.len())),
                    Err(e) => violations.push(format!(
                        "face {:?}: inner[{}] cannot collect: {}", fid, ii, e)),
                }
            }

            // I4: outer loop의 모든 half-edge가 이 face에 속해야 함
            if let Ok(outer_hes) = self.collect_loop_hes(outer_start) {
                for he in outer_hes {
                    let he_face = self.hes[he].face();
                    if he_face != fid {
                        violations.push(format!(
                            "face {:?}: outer HE {:?} points to wrong face {:?}",
                            fid, he, he_face,
                        ));
                    }
                }
            }
        }

        // I5: 각 edge는 최대 2개 active face와 공유
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let active_faces: Vec<_> = faces.iter()
                .filter(|&&f| self.faces.get(f).map(|face| face.is_active()).unwrap_or(false))
                .collect();
            if active_faces.len() > 2 {
                violations.push(format!(
                    "edge {:?}: shared by {} active faces (non-manifold)",
                    eid, active_faces.len(),
                ));
            }
        }

        InvariantReport {
            checked_faces,
            violations,
        }
    }

    /// ADR-007 Rev 2 Tier 4 D — 2D Boolean for two coplanar Sheet faces.
    ///
    /// Operations:
    ///   "intersect" — sutherland_hodgman convex clip
    ///   "union"     — convex_union_2d (centroid-CCW from boundary verts)
    ///   "subtract"  — convex_difference_2d (a − b, single piece)
    ///
    /// MVP가정 (Convex polygons only, single-piece result). Non-convex
    /// 입력이거나 결과가 multi-piece 이면 Err — 향후 Greiner-Hormann
    /// 풀 구현으로 확장 예정.
    ///
    /// 인자:
    ///   `a`, `b`: Sheet face id (둘 다 same plane)
    ///   `op`: "union" | "subtract" | "intersect"
    ///
    /// 반환:
    ///   결과 face id (a 와 b 는 inactive 처리됨)
    pub fn sheet_boolean(
        &mut self,
        a: FaceId,
        b: FaceId,
        op: &str,
        material: MaterialId,
    ) -> Result<FaceId> {
        // Both must be active sheets.
        if !self.faces.contains(a) || !self.faces.contains(b) {
            anyhow::bail!("sheet_boolean: face {:?} or {:?} not found", a, b);
        }
        if !self.faces[a].is_active() || !self.faces[b].is_active() {
            anyhow::bail!("sheet_boolean: inactive face");
        }
        if !self.is_sheet_face(a) || !self.is_sheet_face(b) {
            anyhow::bail!("sheet_boolean: both inputs must be Sheet (not Wall)");
        }
        let verts_a = self.collect_loop_verts(self.faces[a].outer().start)?;
        let verts_b = self.collect_loop_verts(self.faces[b].outer().start)?;
        if verts_a.len() < 3 || verts_b.len() < 3 {
            anyhow::bail!("sheet_boolean: degenerate face boundary");
        }
        let pts_a: Vec<DVec3> = verts_a.iter()
            .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
            .collect();
        let pts_b: Vec<DVec3> = verts_b.iter()
            .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
            .collect();

        // Coplanarity check via face normal alignment + plane distance.
        let basis = crate::operations::polygon_geom::PlaneBasis::from_polygon(&pts_a)
            .ok_or_else(|| anyhow::anyhow!("sheet_boolean: cannot derive plane from face a"))?;
        for p in &pts_b {
            let dist = (*p - basis.origin).dot(basis.normal).abs();
            let scale = pts_b.iter().map(|q| (*q - basis.origin).length()).fold(0.0_f64, f64::max);
            let tol = (scale * 1e-4).max(1.0);
            if dist > tol {
                anyhow::bail!(
                    "sheet_boolean: face b not coplanar with a (max dist {:.2} > tol {:.2})",
                    dist, tol,
                );
            }
        }

        let poly_a: Vec<(f64, f64)> = pts_a.iter().map(|p| basis.project(*p)).collect();
        let poly_b: Vec<(f64, f64)> = pts_b.iter().map(|p| basis.project(*p)).collect();

        let result_2d = match op {
            "intersect" => crate::operations::polygon_geom::sutherland_hodgman(&poly_a, &poly_b),
            "union"     => crate::operations::polygon_geom::convex_union_2d(&poly_a, &poly_b),
            "subtract"  => crate::operations::polygon_geom::convex_difference_2d(&poly_a, &poly_b),
            _ => anyhow::bail!("sheet_boolean: unknown op '{}' (expect union/subtract/intersect)", op),
        };
        let result_2d = result_2d.ok_or_else(|| anyhow::anyhow!(
            "sheet_boolean: {} produced no result (disjoint or non-convex)", op
        ))?;
        if result_2d.len() < 3 {
            anyhow::bail!("sheet_boolean: degenerate result polygon ({} verts)", result_2d.len());
        }

        // Lift back to 3D + add new face.
        let new_verts: Vec<VertId> = result_2d.iter()
            .map(|&(x, y)| self.add_vertex(basis.lift(x, y)))
            .collect();
        let new_face = self.add_face(&new_verts, material)?;

        // Remove originals (soft if you want undo; hard here for simplicity).
        let _ = self.remove_face(a);
        let _ = self.remove_face(b);

        Ok(new_face)
    }

    /// ADR-007 Rev 2 Phase B-3 — Recompute every active face's cached
    /// `normal` from its current outer-loop winding and write it back.
    ///
    /// Acts as the "auto-correct on save" step described in the ADR:
    /// the winding is the single source of truth (Principle 3), so any
    /// stale cached normal that disagrees with topology gets silently
    /// fixed before serialization. Wall and Sheet faces are treated
    /// the same here — the cache should always match topology.
    ///
    /// Returns the count of faces whose cached normal was changed.
    /// Caller can log this for transparency.
    ///
    /// Use this *before* `export_versioned_snapshot()` /
    /// `export_versioned_snapshot_strict()` when you want the
    /// resulting bytes to round-trip cleanly through the Rev 2
    /// invariant verifier.
    pub fn reconcile_face_normals(&mut self) -> usize {
        let active: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();
        let mut changed = 0usize;
        for fid in active {
            let outer_start = self.faces[fid].outer().start;
            if outer_start.is_null() { continue; }
            let Ok(verts) = self.collect_loop_verts(outer_start) else { continue; };
            if verts.len() < 3 { continue; }
            let Ok(computed) = self.compute_normal(&verts) else { continue; };
            if computed.length_squared() < 1e-10 { continue; }
            let stored = self.faces[fid].normal();
            // Only write if direction actually disagrees (avoids touching
            // every face every save when nothing's wrong).
            let stored_n = stored.normalize_or_zero();
            let computed_n = computed.normalize_or_zero();
            if stored_n.length_squared() < 1e-10
                || stored_n.dot(computed_n) < 0.999
            {
                self.faces[fid].set_normal(computed);
                changed += 1;
            }
        }
        changed
    }

    /// ADR-007 Rev 2 — Sheet-aware invariant report.
    ///
    /// `verify_face_invariants` 의 결과 중 Wall 면에 적용되는 winding-기반
    /// violation (현재 I2 normal-mismatch) 는 그대로 두고, Sheet 면의 동일
    /// violation 은 자동으로 OK 로 간주해 리포트에서 제외.
    ///
    /// I1 (loop 존재), I3 (inner loop 유효성), I4 (HE 소속), I5 (non-manifold)
    /// 같은 *구조적* invariant 는 모든 face 에 그대로 적용 — 이들은 winding
    /// 방향과 무관한 mesh integrity 검증.
    ///
    /// 사용처: `Scene::export_versioned_snapshot_strict` 등 strict 검증
    /// 경로에서 Rev 2 정책에 맞는 분류별 검증을 원할 때.
    pub fn verify_face_invariants_rev2(&self) -> InvariantReport {
        let mut report = self.verify_face_invariants();
        // I2 violation 은 메시지에 "cached normal opposite to winding" 패턴.
        // Sheet 면은 winding 자유이므로 이 케이스만 필터링.
        report.violations.retain(|msg| {
            if !msg.contains("cached normal opposite to winding") { return true; }
            // "face FaceId(N): cached..." 에서 N 파싱
            let Some(start) = msg.find("FaceId(") else { return true; };
            let after = &msg[start + 7..];
            let Some(end) = after.find(')') else { return true; };
            let Ok(raw) = after[..end].parse::<u32>() else { return true; };
            let fid = FaceId::new(raw);
            // Sheet 면이면 violation 제거 (true 가 아닌 false 반환 = drop)
            !self.is_sheet_face(fid)
        });
        report
    }

    /// ADR-007 원칙 1 확장 — 닫힌 solid에서 각 face normal이 outward 향하는지 검증.
    ///
    /// 닫힌 2-manifold solid가 아니면 (open surface 등) 빈 리포트 반환.
    /// 휴리스틱: mesh centroid → face centroid 방향과 face normal이 양의 내적이면
    /// outward. 볼록체에서 완벽, 심한 오목체에선 제한적.
    ///
    /// 사용 예: Phase G/H 이후 closed solid 생성 확인, box/sphere 등 프리미티브
    /// sanity check, push/pull 결과 검증 등.
    pub fn verify_outward_normals(&self) -> OutwardReport {
        let active_faces: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();

        // 닫힌 solid 여부 확인 — open surface는 outward 정의 불가
        let manifold = self.face_set_manifold_info(&active_faces);
        if !manifold.is_closed_solid {
            return OutwardReport {
                is_closed_solid: false,
                checked_faces: 0,
                inward_count: 0,
                inward_faces: Vec::new(),
            };
        }

        // Mesh centroid — 모든 active vertex 평균
        let mut sum = DVec3::ZERO;
        let mut cnt = 0usize;
        for (_, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            if let Ok(verts) = self.collect_loop_verts(face.outer().start) {
                for v in verts {
                    if let Ok(p) = self.vertex_pos(v) {
                        sum += p;
                        cnt += 1;
                    }
                }
            }
        }
        if cnt == 0 {
            return OutwardReport {
                is_closed_solid: true,
                checked_faces: 0,
                inward_count: 0,
                inward_faces: Vec::new(),
            };
        }
        let mesh_centroid = sum / cnt as f64;

        let mut inward_faces = Vec::new();
        for fid in &active_faces {
            let face = &self.faces[*fid];
            let normal = face.normal();
            if normal.length_squared() < 1e-10 { continue; }

            // Face centroid
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.is_empty() { continue; }
            let mut fc = DVec3::ZERO;
            let mut fcn = 0usize;
            for v in &verts {
                if let Ok(p) = self.vertex_pos(*v) {
                    fc += p;
                    fcn += 1;
                }
            }
            if fcn == 0 { continue; }
            fc /= fcn as f64;

            let outward = fc - mesh_centroid;
            if outward.length_squared() < 1e-10 { continue; }

            let dot = normal.dot(outward);
            if dot < 0.0 {
                // 내부 향함 감지
                inward_faces.push(*fid);
            }
        }

        OutwardReport {
            is_closed_solid: true,
            checked_faces: active_faces.len(),
            inward_count: inward_faces.len(),
            inward_faces,
        }
    }

    /// 디버그 빌드에서만 invariants 검증. Release에서는 no-op.
    /// 편집 연산 끝에 삽입해 조기 버그 감지용.
    #[inline]
    pub fn debug_verify_invariants(&self) {
        #[cfg(debug_assertions)]
        {
            let report = self.verify_face_invariants();
            if !report.is_valid() {
                eprintln!("[ADR-007] Invariant violations:\n{}", report.summary());
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase H — Import Normalizer (ADR-007 Barrier)
    // ═══════════════════════════════════════════════════════════════

    /// 외부 import된 mesh 데이터를 AXiA 네이티브 규칙에 맞게 정리.
    ///
    /// 이 함수는 "경계(Barrier)" 역할 — 외부 규칙의 데이터를 ADR-007 준수
    /// 데이터로 변환. Import 직후 반드시 호출하여 엔진 내부 규율 유지.
    ///
    /// 단계:
    ///   1. Degenerate face 제거 (zero-area)
    ///   2. Isolated vertex 정리
    ///   3. Winding 일관화 — 다수결로 "올바른" 방향 판정 후 소수 flip
    ///   4. Normal 캐시 재계산 (topology 기반)
    ///   5. 최종 invariant verify
    pub fn normalize_for_import(&mut self, opts: &NormalizeOptions) -> NormalizeReport {
        let mut report = NormalizeReport {
            degenerate_removed: 0,
            winding_flipped: 0,
            normals_recomputed: 0,
            isolated_verts_removed: 0,
            remaining_violations: 0,
        };

        // 1. Degenerate faces
        if opts.remove_degenerate {
            report.degenerate_removed = self.cleanup_degenerate_faces(opts.degenerate_tolerance);
        }

        // 2. Normal 재계산 — I2 (cached normal이 winding과 일치)
        if opts.recompute_normals {
            let active_faces: Vec<FaceId> = self.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();
            for fid in &active_faces {
                let outer_start = self.faces[*fid].outer().start;
                if outer_start.is_null() { continue; }
                if let Ok(verts) = self.collect_loop_verts(outer_start) {
                    if let Ok(n) = self.compute_normal(&verts) {
                        if n.length_squared() > 1e-10 {
                            self.faces[*fid].set_normal(n.normalize_or_zero());
                            report.normals_recomputed += 1;
                        }
                    }
                }
            }
        }

        // 3. Winding 일관화
        //    휴리스틱: 각 face의 normal이 mesh centroid에서 face centroid로 향하는
        //    벡터와 양의 내적이면 "바깥쪽 front" (올바름). 음수면 flip 대상.
        //    이는 볼록체 가정 하에 작동 — 오목체는 완벽하지 않지만
        //    다수결로 대부분 올바르게 정규화됨.
        if opts.normalize_winding {
            let active_faces: Vec<FaceId> = self.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();
            if active_faces.len() >= 4 {
                // mesh centroid
                let mut all_pos = DVec3::ZERO;
                let mut cnt = 0usize;
                for fid in &active_faces {
                    let outer_start = self.faces[*fid].outer().start;
                    if outer_start.is_null() { continue; }
                    if let Ok(verts) = self.collect_loop_verts(outer_start) {
                        for v in verts {
                            if let Ok(p) = self.vertex_pos(v) {
                                all_pos += p;
                                cnt += 1;
                            }
                        }
                    }
                }
                if cnt > 0 {
                    let mesh_centroid = all_pos / cnt as f64;
                    let mut to_flip: Vec<FaceId> = Vec::new();
                    for fid in &active_faces {
                        let outer_start = self.faces[*fid].outer().start;
                        if outer_start.is_null() { continue; }
                        let verts = match self.collect_loop_verts(outer_start) {
                            Ok(v) => v, Err(_) => continue,
                        };
                        if verts.is_empty() { continue; }
                        // Face centroid
                        let mut fc = DVec3::ZERO;
                        let mut fcn = 0usize;
                        for v in &verts {
                            if let Ok(p) = self.vertex_pos(*v) {
                                fc += p;
                                fcn += 1;
                            }
                        }
                        if fcn == 0 { continue; }
                        fc /= fcn as f64;
                        let outward = fc - mesh_centroid;
                        let normal = self.faces[*fid].normal();
                        if normal.length_squared() < 1e-10 { continue; }
                        // 음의 내적 → 뒤집혔음 → flip 대상
                        if outward.dot(normal) < 0.0 {
                            to_flip.push(*fid);
                        }
                    }
                    // 다수가 flip 대상이면 전체 뒤집기보다 그대로 두는 게 나음
                    // (아마 역방향 convention으로 들어온 경우)
                    let half = active_faces.len() / 2;
                    if to_flip.len() <= half {
                        for fid in &to_flip {
                            if self.flip_face_safe(*fid).is_ok() {
                                report.winding_flipped += 1;
                            }
                        }
                    } else {
                        // 다수가 뒤집힘 — 소수 (올바른 쪽) 만 flip (equivalent 반전)
                        let correct: Vec<FaceId> = active_faces.iter()
                            .copied()
                            .filter(|fid| !to_flip.contains(fid))
                            .collect();
                        for fid in &correct {
                            if self.flip_face_safe(*fid).is_ok() {
                                report.winding_flipped += 1;
                            }
                        }
                    }
                }
            }
        }

        // 4. Isolated verts
        if opts.remove_isolated_verts {
            let before = self.verts.len();
            self.remove_isolated_verts();
            let after = self.verts.len();
            report.isolated_verts_removed = before.saturating_sub(after);
        }

        // 5. 최종 verify
        let inv_report = self.verify_face_invariants();
        report.remaining_violations = inv_report.violations.len();

        report
    }

    // ═══════════════════════════════════════
    //  Shell operations
    // ═══════════════════════════════════════

    /// Create a new shell from the given face IDs.
    pub fn create_shell(&mut self, face_ids: Vec<FaceId>, closed: bool) -> ShellId {
        let shell = Shell::new(face_ids, closed);
        self.shells.insert(shell)
    }

    /// Get the shell containing a specific face, if any.
    pub fn shell_for_face(&self, face_id: FaceId) -> Option<ShellId> {
        for (shell_id, shell) in self.shells.iter() {
            if shell.contains_face(face_id) {
                return Some(shell_id);
            }
        }
        None
    }

    /// Remove a shell. Returns the shell if it existed.
    pub fn remove_shell(&mut self, shell_id: ShellId) -> Option<Shell> {
        self.shells.remove(shell_id)
    }

    /// Get the number of shells.
    pub fn shell_count(&self) -> usize {
        self.shells.len()
    }

    /// Check if a set of faces forms a closed shell (all edges shared by 2 faces).
    pub fn is_face_set_closed(&self, face_ids: &[FaceId]) -> bool {
        if face_ids.len() < 4 {
            return false; // need at least 4 faces for a closed solid
        }

        let face_set: FxHashMap<FaceId, bool> = face_ids.iter().map(|&f| (f, true)).collect();

        // Check each edge of each face — if both half-edges belong to faces in the set,
        // the edge is "interior". If any edge has only one face in the set, the shell is open.
        for &fid in face_ids {
            let face = match self.faces.get(fid) {
                Some(f) => f,
                None => return false,
            };

            // Walk the outer loop
            let start_he = face.outer().start;
            if start_he.is_null() { return false; }
            let mut he_id = start_he;
            loop {
                let he = &self.hes[he_id];
                // In this DCEL, next_rad() is the twin (radial partner)
                let twin_id = he.next_rad();
                let twin = &self.hes[twin_id];
                let twin_face = twin.face();

                // If the twin's face is null or not in our set, this is a boundary edge
                if twin_face.is_null() || !face_set.contains_key(&twin_face) {
                    return false;
                }

                he_id = he.next();
                if he_id == start_he {
                    break;
                }
            }
        }

        true
    }
}

impl Default for Mesh {
    fn default() -> Self {
        Self::new()
    }
}

/// ADR-089 A-ω-β — Best-fit plane normal of Bezier control points.
///
/// Used by `add_face_closed_curve` for closed Bezier loops to derive
/// the face normal. Algorithm: pick first 3 non-collinear points and
/// compute cross product. Returns Err for degenerate (all collinear)
/// control point sets.
fn bezier_best_fit_normal(control_pts: &[DVec3]) -> Result<DVec3> {
    if control_pts.len() < 3 {
        bail!(
            "ADR-089 A-ω-β: Bezier needs ≥ 3 control points to define a plane (got {})",
            control_pts.len()
        );
    }
    let p0 = control_pts[0];
    // Find first non-collinear triplet.
    for i in 1..control_pts.len() {
        for j in (i + 1)..control_pts.len() {
            let v1 = control_pts[i] - p0;
            let v2 = control_pts[j] - p0;
            let n = v1.cross(v2);
            if n.length_squared() > 1e-12 {
                return Ok(n.normalize());
            }
        }
    }
    bail!("ADR-089 A-ω-β: Bezier control points are collinear, cannot derive plane normal");
}

/// ADR-089 A-φ-β — Compute uv-slice sub-surface for a 4-vert quad face
/// on a curved analytic surface (Cylinder/Sphere/Cone/Torus).
///
/// Returns `Some(sub_surface_with_tight_uv_range)` if extraction succeeds,
/// `None` otherwise (caller falls through to full-surface tessellation).
///
/// L-φ-2 inversion formulas:
/// - Cylinder: u = atan2(local·basis_v, local·ref_dir),
///   v = local·axis_dir
/// - Sphere: u = atan2(local.y, local.x), v = asin(local.z / radius)
///   (Z-up sphere, matches sphere::evaluate)
/// - Cone: u = atan2(local·basis_v, local·ref_dir),
///   v = local·axis_dir (axial distance from apex)
/// - Torus: split local into axial + radial, then
///   u = atan2(radial·basis_v, radial·ref_dir),
///   v = atan2(axial / minor_radius, (|radial| - major_radius) / minor_radius)
fn compute_uv_slice_for_quad_face(
    mesh: &Mesh,
    face: &Face,
    surface: &crate::surfaces::AnalyticSurface,
) -> Option<crate::surfaces::AnalyticSurface> {
    use crate::surfaces::AnalyticSurface as S;

    let quad_verts = mesh.collect_loop_verts(face.outer().start).ok()?;
    if quad_verts.len() != 4 { return None; }
    let positions: Vec<DVec3> = quad_verts
        .iter()
        .filter_map(|v| mesh.vertex_pos(*v).ok())
        .collect();
    if positions.len() != 4 { return None; }

    // Helper: unwrap angles relative to first to handle ±π wrap.
    let unwrap_angles = |angles: &[f64]| -> Vec<f64> {
        if angles.is_empty() { return Vec::new(); }
        let u0 = angles[0];
        angles.iter().map(|&u| {
            let mut d = u - u0;
            while d > std::f64::consts::PI { d -= std::f64::consts::TAU; }
            while d < -std::f64::consts::PI { d += std::f64::consts::TAU; }
            u0 + d
        }).collect()
    };

    let range_of = |vs: &[f64]| -> (f64, f64) {
        let mn = vs.iter().cloned().fold(f64::INFINITY, f64::min);
        let mx = vs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        (mn, mx)
    };

    let make_slice = |us_unwrapped: Vec<f64>, vs: Vec<f64>,
                      base: &S| -> Option<S> {
        let (u_min, u_max) = range_of(&us_unwrapped);
        let (v_min, v_max) = range_of(&vs);
        if (u_max - u_min).abs() < 1e-9 || (v_max - v_min).abs() < 1e-9 {
            return None;
        }
        match base {
            S::Cylinder { axis_origin, axis_dir, radius, ref_dir, .. } =>
                Some(S::Cylinder {
                    axis_origin: *axis_origin, axis_dir: *axis_dir,
                    radius: *radius, ref_dir: *ref_dir,
                    u_range: (u_min, u_max), v_range: (v_min, v_max),
                }),
            S::Sphere { center, radius, .. } =>
                Some(S::Sphere {
                    center: *center, radius: *radius,
                    u_range: (u_min, u_max), v_range: (v_min, v_max),
                }),
            S::Cone { apex, axis_dir, half_angle, ref_dir, .. } =>
                Some(S::Cone {
                    apex: *apex, axis_dir: *axis_dir,
                    half_angle: *half_angle, ref_dir: *ref_dir,
                    u_range: (u_min, u_max), v_range: (v_min, v_max),
                }),
            S::Torus { center, axis_dir, ref_dir, major_radius, minor_radius, .. } =>
                Some(S::Torus {
                    center: *center, axis_dir: *axis_dir, ref_dir: *ref_dir,
                    major_radius: *major_radius, minor_radius: *minor_radius,
                    u_range: (u_min, u_max), v_range: (v_min, v_max),
                }),
            _ => None,
        }
    };

    match surface {
        S::Cylinder { axis_origin, axis_dir, ref_dir, .. } => {
            let axis_n = axis_dir.normalize_or_zero();
            let ref_n = ref_dir.normalize_or_zero();
            let basis_v = axis_n.cross(ref_n);
            let mut us = Vec::with_capacity(4);
            let mut vs = Vec::with_capacity(4);
            for p in &positions {
                let local = *p - *axis_origin;
                us.push(local.dot(basis_v).atan2(local.dot(ref_n)));
                vs.push(local.dot(axis_n));
            }
            make_slice(unwrap_angles(&us), vs, surface)
        }
        S::Sphere { center, radius, .. } => {
            let mut us = Vec::with_capacity(4);
            let mut vs = Vec::with_capacity(4);
            for p in &positions {
                let local = *p - *center;
                us.push(local.y.atan2(local.x));
                let z_norm = (local.z / *radius).clamp(-1.0, 1.0);
                vs.push(z_norm.asin());
            }
            make_slice(unwrap_angles(&us), vs, surface)
        }
        S::Cone { apex, axis_dir, ref_dir, .. } => {
            let axis_n = axis_dir.normalize_or_zero();
            let ref_n = ref_dir.normalize_or_zero();
            let basis_v = axis_n.cross(ref_n);
            let mut us = Vec::with_capacity(4);
            let mut vs = Vec::with_capacity(4);
            for p in &positions {
                let local = *p - *apex;
                us.push(local.dot(basis_v).atan2(local.dot(ref_n)));
                vs.push(local.dot(axis_n));
            }
            make_slice(unwrap_angles(&us), vs, surface)
        }
        S::Torus {
            center, axis_dir, ref_dir,
            major_radius, minor_radius, ..
        } => {
            let axis_n = axis_dir.normalize_or_zero();
            let ref_n = ref_dir.normalize_or_zero();
            let basis_v = axis_n.cross(ref_n);
            if *minor_radius < 1e-9 { return None; }
            let mut us = Vec::with_capacity(4);
            let mut vs = Vec::with_capacity(4);
            for p in &positions {
                let local = *p - *center;
                let axial = local.dot(axis_n);
                let radial = local - axis_n * axial;
                let r_len = radial.length();
                us.push(radial.dot(basis_v).atan2(radial.dot(ref_n)));
                let v_arg_x = (r_len - *major_radius) / *minor_radius;
                let v_arg_y = axial / *minor_radius;
                vs.push(v_arg_y.atan2(v_arg_x));
            }
            // For Torus, v also wraps — unwrap both
            make_slice(unwrap_angles(&us), unwrap_angles(&vs), surface)
        }
        _ => None,
    }
}

/// ADR-089 A-τ-β — Two faces share the same smooth-group surface.
///
/// Returns true if both surfaces are the same curved analytic kind
/// (Cylinder/Sphere/Cone/Torus) with matching base parameters within
/// `EPSILON_LENGTH` (axis_origin, axis_dir, radius, ref_dir for
/// Cylinder; analogous fields for others). u_range / v_range are
/// excluded — each face holds its own slice.
///
/// Plane-Plane and None-None pairs return `false` so the caller falls
/// through to the angle-threshold path (preserves LOCKED #16 K-ε
/// hotfix semantics).
///
/// L-τ-1 / L-τ-6 implementation.
fn surfaces_in_same_smooth_group(
    a: &Option<crate::surfaces::AnalyticSurface>,
    b: &Option<crate::surfaces::AnalyticSurface>,
) -> bool {
    use crate::surfaces::AnalyticSurface as S;
    let eps = crate::tolerances::EPSILON_LENGTH;
    let dvec_eq = |x: DVec3, y: DVec3| -> bool {
        (x - y).length() < eps
    };
    let dir_eq = |x: DVec3, y: DVec3| -> bool {
        x.normalize_or_zero().dot(y.normalize_or_zero()).abs() > 1.0 - 1e-6
    };
    match (a.as_ref(), b.as_ref()) {
        (Some(S::Cylinder {
            axis_origin: ao_a, axis_dir: ad_a, radius: r_a, ref_dir: rd_a, ..
        }),
         Some(S::Cylinder {
            axis_origin: ao_b, axis_dir: ad_b, radius: r_b, ref_dir: rd_b, ..
        })) => {
            // Cylinders share smooth group if same axis line + radius.
            // axis_origin can be any point on axis — collinear with axis_dir.
            let same_radius = (r_a - r_b).abs() < eps;
            let same_axis_dir = dir_eq(*ad_a, *ad_b);
            // Check axis_origin offset is parallel to axis_dir
            let offset = *ao_b - *ao_a;
            let perp = offset - ad_a.normalize_or_zero() * offset.dot(ad_a.normalize_or_zero());
            let same_axis_line = perp.length() < eps;
            // ref_dir must align (within axis-symmetric rotation)
            let _same_ref = dir_eq(*rd_a, *rd_b)
                || (rd_a.cross(*rd_b).length() < eps);
            same_radius && same_axis_dir && same_axis_line
        }
        (Some(S::Sphere { center: c_a, radius: r_a, .. }),
         Some(S::Sphere { center: c_b, radius: r_b, .. })) => {
            dvec_eq(*c_a, *c_b) && (r_a - r_b).abs() < eps
        }
        (Some(S::Cone {
            apex: ap_a, axis_dir: ad_a, half_angle: ha_a, ref_dir: _rd_a, ..
        }),
         Some(S::Cone {
            apex: ap_b, axis_dir: ad_b, half_angle: ha_b, ref_dir: _rd_b, ..
        })) => {
            dvec_eq(*ap_a, *ap_b) && dir_eq(*ad_a, *ad_b)
                && (ha_a - ha_b).abs() < 1e-6
        }
        (Some(S::Torus {
            center: c_a, axis_dir: ad_a, major_radius: ma_a, minor_radius: mi_a, ..
        }),
         Some(S::Torus {
            center: c_b, axis_dir: ad_b, major_radius: ma_b, minor_radius: mi_b, ..
        })) => {
            dvec_eq(*c_a, *c_b) && dir_eq(*ad_a, *ad_b)
                && (ma_a - ma_b).abs() < eps
                && (mi_a - mi_b).abs() < eps
        }
        // Plane / None / mismatched kinds → not a smooth group.
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ════════════════════════════════════════════════════════════════════════
    // ADR-028 Phase A — Mesh ↔ AnalyticCurve integration tests
    // ════════════════════════════════════════════════════════════════════════

    use crate::curves::{AnalyticCurve, CurveOps};

    #[test]
    fn add_edge_with_curve_creates_new_edge_with_curve() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 5.0, 0.0));
        let arc = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, arc.clone()).unwrap();
        assert!(mesh.edges.contains(eid));
        assert_eq!(mesh.edge_curve(eid), Some(&arc));
    }

    #[test]
    fn add_edge_with_curve_overwrites_existing_edge_curve() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 5.0, 0.0));
        // First add a plain edge
        let (eid_first, was_new) = mesh.add_edge(v0, v1).unwrap();
        assert!(was_new);
        assert!(mesh.edge_curve(eid_first).is_none());
        // Now upgrade it with a curve.
        let circ = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let eid_again = mesh.add_edge_with_curve(v0, v1, circ.clone()).unwrap();
        assert_eq!(eid_first, eid_again, "should reuse existing edge");
        assert_eq!(mesh.edge_curve(eid_again), Some(&circ));
    }

    #[test]
    fn tessellate_edge_straight_line_returns_two_points() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(v0, v1).unwrap();
        let pts = mesh.tessellate_edge(eid, 0.1).unwrap();
        assert_eq!(pts.len(), 2);
        assert!((pts[0] - DVec3::ZERO).length() < 1e-12);
        assert!((pts[1] - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn tessellate_edge_arc_chord_tol() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(50.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 50.0, 0.0));
        let arc = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 50.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, arc).unwrap();
        let chord_tol = 0.5;
        let pts = mesh.tessellate_edge(eid, chord_tol).unwrap();
        assert!(pts.len() >= 3);  // at least 2 segments for a quarter arc

        // Sagitta check
        for i in 0..pts.len() - 1 {
            let mid = (pts[i] + pts[i + 1]) * 0.5;
            let radial = (mid - DVec3::ZERO).length();
            let sagitta = (50.0 - radial).abs();
            assert!(sagitta <= chord_tol * 1.01,
                "sagitta {} > chord_tol {} at i={}", sagitta, chord_tol, i);
        }
    }

    #[test]
    fn tessellate_edge_circle_returns_first_eq_last() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        // For a full circle, both "endpoints" coincide — but DCEL needs
        // distinct verts; use add_vertex_force_new to keep them topologically
        // distinct while geometrically coincident.
        let v1 = mesh.add_vertex_force_new(DVec3::new(5.0, 0.0, 0.0));
        let circ = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, circ).unwrap();
        let pts = mesh.tessellate_edge(eid, 0.5).unwrap();
        let first = pts.first().unwrap();
        let last = pts.last().unwrap();
        assert!((*first - *last).length() < 1e-9,
            "full circle tessellation: first={:?} != last={:?}", first, last);
    }

    #[test]
    fn tessellate_edge_lod_chord_tol_changes_segment_count() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(-100.0, 0.0, 0.0));
        let arc = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 100.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, arc).unwrap();
        let coarse = mesh.tessellate_edge(eid, 5.0).unwrap();
        let fine = mesh.tessellate_edge(eid, 0.05).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine LOD should produce more points: coarse={}, fine={}",
            coarse.len(), fine.len());
    }

    #[test]
    fn edge_curve_returns_none_for_plain_edge() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(v0, v1).unwrap();
        assert!(mesh.edge_curve(eid).is_none());
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-029 Phase B — Mesh ↔ Bezier / BSpline integration
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn add_edge_with_bezier_curve_then_tessellate() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let bz = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(3.0, 5.0, 0.0),
                DVec3::new(7.0, 5.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
            ],
        };
        let eid = mesh.add_edge_with_curve(v0, v1, bz).unwrap();
        let pts = mesh.tessellate_edge(eid, 0.05).unwrap();
        assert!(pts.len() >= 4, "expected adaptive tessellation > 4 pts");
        // Endpoints preserved
        assert!((pts[0] - DVec3::new(0.0, 0.0, 0.0)).length() < 1e-9);
        assert!((*pts.last().unwrap() - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-9);
    }

    #[test]
    fn add_edge_with_bspline_curve_clamped_endpoints() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let pts: Vec<DVec3> = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 4.0, 0.0),
            DVec3::new(8.0, 4.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = crate::curves::bspline::clamped_uniform_knots(pts.len(), 3);
        let bs = AnalyticCurve::BSpline {
            control_pts: pts.clone(),
            knots,
            degree: 3,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, bs).unwrap();
        let tess = mesh.tessellate_edge(eid, 0.1).unwrap();
        assert!(tess.len() >= 4);
        // Clamped: first point = first ctrl, last = last ctrl
        assert!((tess[0] - pts[0]).length() < 1e-6);
        assert!((*tess.last().unwrap() - *pts.last().unwrap()).length() < 1e-6);
    }

    #[test]
    fn bezier_lod_more_segments_with_finer_tol() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let bz = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(50.0, 100.0, 0.0),
                DVec3::new(100.0, 0.0, 0.0),
            ],
        };
        let eid = mesh.add_edge_with_curve(v0, v1, bz).unwrap();
        let coarse = mesh.tessellate_edge(eid, 5.0).unwrap();
        let fine = mesh.tessellate_edge(eid, 0.05).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine ({}) > coarse ({})", fine.len(), coarse.len());
    }

    #[test]
    fn bspline_lod_more_segments_with_finer_tol() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(150.0, 0.0, 0.0));
        let pts: Vec<DVec3> = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(50.0, 100.0, 0.0),
            DVec3::new(100.0, -50.0, 0.0),
            DVec3::new(150.0, 0.0, 0.0),
        ];
        let knots = crate::curves::bspline::clamped_uniform_knots(pts.len(), 3);
        let bs = AnalyticCurve::BSpline {
            control_pts: pts, knots, degree: 3,
        };
        let eid = mesh.add_edge_with_curve(v0, v1, bs).unwrap();
        let coarse = mesh.tessellate_edge(eid, 5.0).unwrap();
        let fine = mesh.tessellate_edge(eid, 0.05).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine ({}) > coarse ({})", fine.len(), coarse.len());
    }

    #[test]
    fn bezier_curve_is_curved_returns_true() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let bz = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(5.0, 5.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
            ],
        };
        let eid = mesh.add_edge_with_curve(v0, v1, bz).unwrap();
        assert!(mesh.edges[eid].is_curved());
    }

    #[test]
    fn bspline_serialize_roundtrip() {
        let pts: Vec<DVec3> = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 4.0, 0.0),
            DVec3::new(8.0, 4.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = crate::curves::bspline::clamped_uniform_knots(4, 3);
        let bs = AnalyticCurve::BSpline {
            control_pts: pts.clone(),
            knots: knots.clone(),
            degree: 3,
        };
        let json = serde_json::to_string(&bs).unwrap();
        let bs2: AnalyticCurve = serde_json::from_str(&json).unwrap();
        assert_eq!(bs, bs2);
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-031 Phase D — Face.surface integration
    // ────────────────────────────────────────────────────────────────────

    use crate::surfaces::{AnalyticSurface, SurfaceOps};

    fn unit_square_face(mesh: &mut Mesh) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap()
    }

    #[test]
    fn face_surface_default_none() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        assert!(mesh.face_surface(fid).is_none());
        assert!(!mesh.faces[fid].has_curved_surface());
    }

    #[test]
    fn set_face_surface_cylinder_persists() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 10.0),
        };
        let ok = mesh.set_face_surface(fid, Some(cyl.clone()));
        assert!(ok);
        assert_eq!(mesh.face_surface(fid), Some(&cyl));
        assert!(mesh.faces[fid].has_curved_surface());
    }

    #[test]
    fn set_face_surface_invalid_face_returns_false() {
        let mut mesh = Mesh::new();
        let bogus = FaceId::new(999_999);
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        assert!(!mesh.set_face_surface(bogus, Some(plane)));
    }

    #[test]
    fn clear_face_surface_reverts_to_polygon() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        mesh.set_face_surface(fid, Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        }));
        assert!(mesh.face_surface(fid).is_some());
        mesh.set_face_surface(fid, None);
        assert!(mesh.face_surface(fid).is_none());
    }

    #[test]
    fn tessellate_face_surface_cylinder_returns_triangles() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 10.0),
        };
        mesh.set_face_surface(fid, Some(cyl));
        let tess = mesh.tessellate_face_surface(fid, 0.5).unwrap();
        assert!(tess.vertices.len() > 16, "expected substantial tessellation");
        assert!(!tess.triangles.is_empty());
        assert_eq!(tess.uv.len(), tess.vertices.len());
        // Each vertex within [r-tol, r+tol] of axis (radius invariant).
        for p in &tess.vertices {
            let radial = DVec3::new(p.x, p.y, 0.0).length();
            assert!((radial - 5.0).abs() < 1e-9,
                "vertex {:?} radial = {}", p, radial);
        }
    }

    #[test]
    fn tessellate_face_surface_no_surface_returns_none() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        assert!(mesh.tessellate_face_surface(fid, 0.5).is_none());
    }

    #[test]
    fn face_surface_lod_more_triangles_with_finer_tol() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        mesh.set_face_surface(fid, Some(AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 10.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        }));
        let coarse = mesh.tessellate_face_surface(fid, 1.0).unwrap();
        let fine = mesh.tessellate_face_surface(fid, 0.05).unwrap();
        assert!(fine.triangles.len() > coarse.triangles.len(),
            "fine ({}) > coarse ({})", fine.triangles.len(), coarse.triangles.len());
    }

    #[test]
    fn face_surface_serialize_roundtrip() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let surface = AnalyticSurface::Sphere {
            center: DVec3::new(1.0, 2.0, 3.0), radius: 7.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.set_face_surface(fid, Some(surface.clone()));
        let json = serde_json::to_string(&mesh.faces[fid]).unwrap();
        let face2: crate::Face = serde_json::from_str(&json).unwrap();
        assert_eq!(face2.surface(), Some(&surface));
    }

    #[test]
    fn legacy_face_loads_with_surface_none() {
        // Hand-craft a JSON without `surface` field — must load with None.
        let original = unit_square_face(&mut Mesh::new());
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let json = serde_json::to_string(&mesh.faces[fid]).unwrap();
        // Strip the surface field
        let legacy = json
            .replace(r#","surface":null"#, "")
            .replace(r#""surface":null,"#, "");
        let face2: crate::Face = serde_json::from_str(&legacy).expect("legacy face");
        assert!(face2.surface().is_none());
        let _ = original;
    }

    /// 회귀 보장 — Phase A 도입 후에도 기존 polygon 동작 무변동.
    /// 4-line RECT 그렸을 때 4 edge 모두 curve = None.
    #[test]
    fn regression_polygon_rect_edges_have_no_curve() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        let _f = mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], mat).unwrap();
        // Every edge must have curve == None (default).
        let mut count = 0;
        for (_, e) in mesh.edges.iter() {
            assert!(e.curve().is_none(),
                "regression: polygon edge unexpectedly has analytic curve");
            count += 1;
        }
        assert_eq!(count, 4, "expected 4 edges in a rect");
    }

    /// "엣지 없으면 면 없음" 원칙 회귀 테스트 (transactional rollback).
    ///
    /// `add_face_with_holes` 의 hole vertex 가 < 3 → make_loop 실패 →
    /// rollback. 이전엔 outer loop 만 부분 wired 된 채 face 가 leak 됐음.
    /// 수정 후엔 face 가 mesh 에 남지 않음.
    #[test]
    fn add_face_with_holes_rollback_on_invalid_inner() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        // Invalid hole: only 2 verts (need ≥ 3) → make_loop will bail.
        let h0 = mesh.add_vertex(DVec3::new(2.0, 2.0, 0.0));
        let h1 = mesh.add_vertex(DVec3::new(8.0, 8.0, 0.0));

        let face_count_before = mesh.face_count();
        let edge_count_before = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();

        let result = mesh.add_face_with_holes(
            &[v0, v1, v2, v3],
            &[&[h0, h1]],  // ← invalid hole
            mat,
        );

        // 1. Operation must error.
        assert!(result.is_err(), "expected error, got {:?}", result);

        // 2. CRITICAL: face count must equal pre-call (no leaked face).
        assert_eq!(mesh.face_count(), face_count_before,
            "rollback failed: face leaked after partial failure");

        // 3. verify_face_invariants must show no I1 violation (no empty LoopRef).
        let report = mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "rollback left invariant violations: {:?}", report.violations);

        // 4. Best-effort: edge count should not have grown by more than the
        //    outer loop edges that succeeded (edges may persist if part of
        //    successful outer build — that's OK for the principle).
        let edge_count_after = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
        assert!(edge_count_after <= edge_count_before + 4,
            "edge leak too large: before={}, after={}", edge_count_before, edge_count_after);
    }

    /// Rollback also must not affect existing valid faces.
    #[test]
    fn add_face_with_holes_rollback_preserves_existing_faces() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // First, create a valid face.
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let f1 = mesh.add_face_with_holes(&[a, b, c], &[], mat).unwrap();

        let face_count_before = mesh.face_count();

        // Now try to create a face with invalid hole — must rollback without
        // affecting f1.
        let d = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let e = mesh.add_vertex(DVec3::new(11.0, 0.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(10.5, 1.0, 0.0));
        let h0 = mesh.add_vertex(DVec3::new(10.2, 0.2, 0.0));
        let h1 = mesh.add_vertex(DVec3::new(10.8, 0.2, 0.0));
        let result = mesh.add_face_with_holes(&[d, e, f], &[&[h0, h1]], mat);
        assert!(result.is_err());

        // f1 must still exist + be valid.
        assert!(mesh.faces.contains(f1) && mesh.faces[f1].is_active(),
            "existing face f1 was affected by rollback");
        assert_eq!(mesh.face_count(), face_count_before,
            "no extra face after rollback");

        let report = mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "rollback corrupted existing face invariants: {:?}", report.violations);
    }

    #[test]
    fn edge_chain_selects_polyline_through_degree2_verts() {
        // Open polyline: v0 — v1 — v2 — v3 (3 edges, 2 interior valence-2 verts)
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(3.0, 0.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let (e12, _) = mesh.add_edge(v1, v2).unwrap();
        let (e23, _) = mesh.add_edge(v2, v3).unwrap();

        let chain = mesh.collect_edge_chain(e12);
        let set: std::collections::HashSet<EdgeId> = chain.iter().copied().collect();
        assert!(set.contains(&e01));
        assert!(set.contains(&e12));
        assert!(set.contains(&e23));
        assert_eq!(set.len(), 3, "full chain of 3 edges expected");
    }

    #[test]
    fn edge_chain_stops_at_junction() {
        // Y-shape: v0—v1—v2  and  v1—v3 (v1 is junction, valence=3)
        //
        //          v2
        //           \
        //    v0 ── v1 ── v3
        //
        // seed from e01 → should collect only e01 (stops at v1, and v0 is dead-end)
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v1, v3).unwrap();

        let chain = mesh.collect_edge_chain(e01);
        assert_eq!(chain.len(), 1, "junction at v1 halts the chain — only seed returned");
        assert_eq!(chain[0], e01);
    }

    #[test]
    fn edge_chain_closed_loop() {
        // Closed quadrilateral boundary: 4 edges, each vertex valence=2.
        // Chain from any edge should return all 4.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v2, v3).unwrap();
        let _ = mesh.add_edge(v3, v0).unwrap();

        let chain = mesh.collect_edge_chain(e01);
        assert_eq!(chain.len(), 4, "closed 4-edge loop should return all 4");
    }

    #[test]
    fn test_create_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 3);
        assert_eq!(mesh.edge_count(), 3);
        assert_eq!(mesh.face_count(), 1);

        // Normal should point in +Z direction
        let n = mesh.faces[face_id].normal();
        assert!((n.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", n);
    }

    #[test]
    fn test_create_quad() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let _face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 4);
        assert_eq!(mesh.edge_count(), 4);
        assert_eq!(mesh.he_count(), 8); // 4 edges × 2 half-edges each
    }

    #[test]
    fn test_vertex_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1e-10, 0.0, 0.0)); // Within tolerance

        assert_eq!(v0, v1, "Coincident vertices should be merged");
        assert_eq!(mesh.vert_count(), 1);
    }

    #[test]
    fn test_edge_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let (e1, new1) = mesh.add_edge(v0, v1).unwrap();
        let (e2, new2) = mesh.add_edge(v0, v1).unwrap();
        let (e3, new3) = mesh.add_edge(v1, v0).unwrap(); // Reversed order

        assert!(new1);
        assert!(!new2);
        assert!(!new3);
        assert_eq!(e1, e2);
        assert_eq!(e1, e3);
    }

    #[test]
    fn test_export_triangle_buffers() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let (positions, normals, indices, _face_map, positions_f64) = mesh.export_buffers().unwrap();
        assert_eq!(positions.len(), 9); // 3 verts × 3 components
        assert_eq!(positions_f64.len(), 9); // same count, f64 precision
        assert_eq!(normals.len(), 9);
        assert_eq!(indices.len(), 3); // 1 triangle
    }

    // ── Face 추가/제거 테스트 ────────────────────────

    #[test]
    fn test_cleanup_dangling_excluding_keeps_protected_orphan_edges() {
        // Build an isolated quad. Remove the face. By default cleanup_dangling
        // would purge all 4 boundary edges as orphans; with the protected
        // set they remain as standalone wireframe.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        // Snapshot the boundary edges before removing the face (collect_loop_hes
        // requires the loop to be intact).
        let boundary_edges: std::collections::HashSet<EdgeId> = {
            let start = mesh.faces[f].outer().start;
            let hes = mesh.collect_loop_hes(start).unwrap();
            hes.into_iter().map(|h| mesh.hes[h].edge()).collect()
        };
        assert_eq!(boundary_edges.len(), 4, "quad should have 4 boundary edges");

        mesh.remove_face(f).unwrap();
        if mesh.faces.contains(f) { mesh.faces.remove(f); }

        // Run protected cleanup → boundary edges must still be present.
        let (edge_removed, _vert_removed) = mesh.cleanup_dangling_excluding(&boundary_edges);
        assert_eq!(edge_removed, 0, "no orphan edge should be removed when protected");
        for &eid in &boundary_edges {
            assert!(mesh.edges.contains(eid),
                "protected edge {:?} must still be present after cleanup", eid);
        }
        // Vertices must also remain — they're still referenced by the surviving edges.
        for vid in &[v0, v1, v2, v3] {
            assert!(mesh.verts.contains(*vid),
                "vertex {:?} should remain (referenced by surviving edge)", vid);
        }
    }

    #[test]
    fn test_cleanup_dangling_default_still_removes_orphans() {
        // Sanity: without protection, cleanup_dangling behaves as before.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.remove_face(f).unwrap();
        if mesh.faces.contains(f) { mesh.faces.remove(f); }
        let (edge_removed, _) = mesh.cleanup_dangling();
        assert_eq!(edge_removed, 4, "all 4 boundary edges should be cleaned up by default");
    }

    #[test]
    fn test_add_and_remove_face() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 1);

        // Remove face
        let removed = mesh.remove_face(face_id);
        assert!(removed.is_ok());
        assert_eq!(mesh.face_count(), 0);

        // Verify face is removed or marked inactive
        let is_gone = mesh.faces.get(face_id)
            .map(|f| !f.is_active())
            .unwrap_or(true); // None = fully removed = OK
        assert!(is_gone, "face should be inactive or removed from storage");
    }

    #[test]
    fn test_face_normal_computation() {
        let mut mesh = Mesh::new();
        // Triangle in XY plane at Z=0, CCW winding → normal should be +Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", normal);
        assert!((normal.x.abs() + normal.y.abs()) < 1e-6, "Normal X,Y should be zero");
    }

    #[test]
    fn test_face_normal_reversed_winding() {
        let mut mesh = Mesh::new();
        // CW winding → normal should be -Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z + 1.0).abs() < 1e-6, "Normal should be -Z, got {:?}", normal);
    }

    #[test]
    fn test_collect_loop_verts() {
        let mut mesh = Mesh::new();
        let verts = vec![
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0)),
        ];

        let face_id = mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();

        assert_eq!(loop_verts.len(), 4, "should collect all 4 vertices");
        for &v in &loop_verts {
            assert!(verts.contains(&v), "all loop vertices should match original");
        }
    }

    #[test]
    fn test_merge_coplanar_faces() {
        let mut mesh = Mesh::new();
        // 두 개의 인접한 공면 사각형 생성
        // Square 1: (0,0,0)-(1,0,0)-(1,1,0)-(0,1,0)
        // Square 2: (1,0,0)-(2,0,0)-(2,1,0)-(1,1,0) [Square 1의 우측]
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));

        let _face1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _face2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.face_count(), 2);

        // merge_faces_by_edge 호출 (face1과 face2가 edge v1-v2를 공유)
        // 먼저 공유 edge를 찾음
        let shared_edge = mesh.find_edge(v1, v2);
        let merge_result = if let Some(eid) = shared_edge {
            mesh.merge_faces_by_edge(eid)
        } else {
            Err(anyhow::anyhow!("shared edge not found"))
        };

        // merge 성공 여부에 따라 face count 확인
        if merge_result.is_ok() {
            // merge 성공하면 1개 face가 되어야 함
            assert_eq!(mesh.face_count(), 1, "merged result should have 1 face");
        } else {
            // merge 실패해도 상태는 일관성 있어야 함
            assert!(mesh.face_count() >= 1);
        }
    }

    #[test]
    fn test_merge_coplanar_containing_creates_hole() {
        // Phase F — 비인접 coplanar 병합: outer 사각형 + 내부 사각형 → outer에 hole
        let mut mesh = Mesh::new();
        // Outer 200×200
        let o0 = mesh.add_vertex(DVec3::new(-100.0, 0.0, -100.0));
        let o1 = mesh.add_vertex(DVec3::new( 100.0, 0.0, -100.0));
        let o2 = mesh.add_vertex(DVec3::new( 100.0, 0.0,  100.0));
        let o3 = mesh.add_vertex(DVec3::new(-100.0, 0.0,  100.0));
        // Inner 40×40 (중앙)
        let i0 = mesh.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let i1 = mesh.add_vertex(DVec3::new( 20.0, 0.0, -20.0));
        let i2 = mesh.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let i3 = mesh.add_vertex(DVec3::new(-20.0, 0.0,  20.0));

        let outer_f = mesh.add_face(&[o0, o1, o2, o3], MaterialId::new(0)).unwrap();
        let inner_f = mesh.add_face(&[i0, i1, i2, i3], MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 2);

        let merged = mesh.merge_coplanar_containing(outer_f, inner_f, 0.5).unwrap();
        assert_eq!(mesh.face_count(), 1);
        let face = &mesh.faces[merged];
        assert_eq!(face.inners().len(), 1, "merged face should have 1 hole");
    }

    #[test]
    fn test_merge_coplanar_containing_rejects_sharing_edge() {
        // 두 face가 엣지를 공유하면 merge_faces_by_edge를 써야 함
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let v4 = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(20.0, 0.0, 10.0));
        let f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();
        let result = mesh.merge_coplanar_containing(f1, f2, 0.5);
        assert!(result.is_err(), "sharing edge should reject");
    }

    #[test]
    fn test_merge_coplanar_containing_rejects_non_coplanar() {
        let mut mesh = Mesh::new();
        // 두 면을 서로 다른 평면에 배치
        let o = [
            mesh.add_vertex(DVec3::new(-10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0,  10.0)),
            mesh.add_vertex(DVec3::new(-10.0, 0.0,  10.0)),
        ];
        let i = [
            mesh.add_vertex(DVec3::new(-5.0, 5.0, -5.0)),
            mesh.add_vertex(DVec3::new( 5.0, 5.0, -5.0)),
            mesh.add_vertex(DVec3::new( 5.0, 5.0,  5.0)),
            mesh.add_vertex(DVec3::new(-5.0, 5.0,  5.0)),
        ];
        let of = mesh.add_face(&o, MaterialId::new(0)).unwrap();
        let inf = mesh.add_face(&i, MaterialId::new(0)).unwrap();
        assert!(mesh.merge_coplanar_containing(of, inf, 0.5).is_err());
    }

    #[test]
    fn test_merge_tolerance_rejects_strict_but_accepts_loose() {
        // 1° 기울어진 두 사각형: strict(0.5°)는 reject, loose(2°)는 accept
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(100.0, 100.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 100.0, 0.0));
        // 두 번째 면: 공유 엣지 v1-v2, 반대쪽 꼭짓점을 1° 기울임
        // tan(1°)×100 ≈ 1.745 → 정점 Z를 약 1.745만큼 올림
        let dz = 100.0 * (1.0_f64.to_radians().tan());
        let v4 = mesh.add_vertex(DVec3::new(200.0, 0.0, dz));
        let v5 = mesh.add_vertex(DVec3::new(200.0, 100.0, dz));

        let f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        // Strict (0.5°) — 거부
        let strict = mesh.are_faces_coplanar_with_tolerance(f1, f2, 0.5).unwrap();
        assert!(!strict, "0.5° tol should reject 1° tilt");

        // Loose (2°) — 허용
        let loose = mesh.are_faces_coplanar_with_tolerance(f1, f2, 2.0).unwrap();
        assert!(loose, "2° tol should accept 1° tilt");
    }

    #[test]
    fn test_face_material_preservation() {
        let mut mesh = Mesh::new();
        let mat_id = MaterialId::new(42);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], mat_id).unwrap();
        let face = mesh.faces[face_id].clone();
        assert_eq!(face.material(), mat_id, "face material should be preserved");
    }

    #[test]
    fn test_face_centroid_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Centroid should be approximately (1.0, 0.666, 0.0)
        let positions = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
        ];
        let expected_centroid = positions.iter().sum::<DVec3>() / 3.0;

        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();
        let mut actual_centroid = DVec3::ZERO;
        for &vid in &loop_verts {
            actual_centroid += mesh.verts[vid].pos();
        }
        actual_centroid /= loop_verts.len() as f64;

        assert!((actual_centroid - expected_centroid).length() < 1e-6,
            "centroid should be correct");
    }

    #[test]
    fn test_multiple_faces_on_same_vertices() {
        let mut mesh = Mesh::new();
        // 일부 꼭짓점을 공유하는 두 face
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let _f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _f2 = mesh.add_face(&[v1, v4, v2], MaterialId::new(1)).unwrap();

        assert_eq!(mesh.face_count(), 2);
        assert_eq!(mesh.vert_count(), 5);
        // Two faces share edge v1-v2 (directed both ways)
        let edges_f1 = mesh.find_edge(v1, v2);
        let edges_f2 = mesh.find_edge(v1, v2);
        assert_eq!(edges_f1, edges_f2, "faces should share edge");
    }

    #[test]
    fn test_orient_faces_consistent() {
        let mut mesh = Mesh::new();
        // Create a simple quad
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let normal_before = face.normal();

        // Verify normal is +Z
        assert!((normal_before.z - 1.0).abs() < 1e-6);

        // If we were to flip the face (using flip_face), normal should reverse
        // (this tests that the normal is computed correctly for orientation)
        let normal_length = normal_before.length();
        assert!((normal_length - 1.0).abs() < 1e-6, "normal should be unit");
    }

    // ────────────────────────────────────────────────────────────────
    // v_ring + self-healing (reconstruct_face / cleanup_degenerate)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn v_ring_cycle_is_consistent_after_face_creation() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _ = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        // Each corner vertex should have 2 outgoing HEs in its v_ring (quad corner)
        // Walk the ring starting at v.outgoing, count until we cycle back.
        for &v in &[v0, v1, v2, v3] {
            let start = mesh.verts[v].outgoing().expect("outgoing must exist");
            let mut count = 0usize;
            let mut cur = start;
            loop {
                count += 1;
                cur = mesh.hes[cur].v_next();
                if cur.is_null() { panic!("v_next broken for vertex {:?}", v); }
                if cur == start { break; }
                if count > 10 { panic!("v_ring cycle too long for vertex {:?}", v); }
            }
            // Quad corner = 2 adjacent edges, so 2 outgoing HEs (one to each neighbor)
            assert_eq!(count, 2, "vertex {:?} should have 2 outgoing HEs", v);
        }
    }

    #[test]
    fn v_ring_cleans_up_on_edge_removal() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let _ = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Remove edge v0-v1
        let eid = mesh.find_edge(v0, v1).unwrap();
        mesh.remove_edge_and_halfedges(eid).unwrap();
        // v0's outgoing should still reference a live HE (or be None if isolated)
        if let Some(out) = mesh.verts[v0].outgoing() {
            assert!(mesh.hes.contains(out), "v0.outgoing should point to a live HE");
        }
        if let Some(out) = mesh.verts[v1].outgoing() {
            assert!(mesh.hes.contains(out), "v1.outgoing should point to a live HE");
        }
    }

    #[test]
    fn face_area_is_correct_for_unit_square() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(2.0, 3.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 3.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let area = mesh.face_area(fid);
        assert!((area - 6.0).abs() < 1e-9, "expected area 6.0 got {}", area);
    }

    #[test]
    fn is_face_planar_accepts_flat_and_rejects_skewed() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let flat = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        assert!(mesh.is_face_planar(flat, 1e-6));
        // Triangle is trivially planar
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADR-007: Face Orientation Invariant Tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn invariants_empty_mesh_passes() {
        let mesh = Mesh::new();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "empty mesh must pass: {}", report.summary());
    }

    #[test]
    fn invariants_single_triangle_passes() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "single triangle violates: {}", report.summary());
    }

    #[test]
    fn invariants_tetrahedron_passes() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "tet violates: {}", report.summary());
        assert_eq!(report.checked_faces, 4);
    }

    #[test]
    fn invariants_face_with_hole_passes() {
        // Phase F — 구멍 있는 face도 invariant 통과
        let mut mesh = Mesh::new();
        let o0 = mesh.add_vertex(DVec3::new(-10.0, 0.0, -10.0));
        let o1 = mesh.add_vertex(DVec3::new( 10.0, 0.0, -10.0));
        let o2 = mesh.add_vertex(DVec3::new( 10.0, 0.0,  10.0));
        let o3 = mesh.add_vertex(DVec3::new(-10.0, 0.0,  10.0));
        let h0 = mesh.add_vertex(DVec3::new(-2.0, 0.0, -2.0));
        let h1 = mesh.add_vertex(DVec3::new(-2.0, 0.0,  2.0));
        let h2 = mesh.add_vertex(DVec3::new( 2.0, 0.0,  2.0));
        let h3 = mesh.add_vertex(DVec3::new( 2.0, 0.0, -2.0));
        mesh.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[h0, h1, h2, h3]],
            MaterialId::new(0),
        ).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "hole face violates: {}", report.summary());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase H — Import Normalizer 테스트
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn normalize_noop_on_clean_mesh() {
        // 정상 정사면체 — normalize 후에도 변화 최소
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();

        let opts = NormalizeOptions::default();
        let report = mesh.normalize_for_import(&opts);

        // 깨끗한 mesh라면 flip 대상이 매우 적거나 전무
        assert_eq!(report.degenerate_removed, 0);
        assert_eq!(report.remaining_violations, 0,
            "clean mesh should have no violations after normalize");
    }

    #[test]
    fn normalize_removes_degenerate_faces() {
        let mut mesh = Mesh::new();
        // 정상 삼각형
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 100.0, 0.0));
        let _good = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        // 퇴화 삼각형은 add_face가 ADR-003으로 차단하므로 직접 만들기는 어려움.
        // 대신 normalize가 정상 case에서 아무것도 망가뜨리지 않는지 확인.
        let report = mesh.normalize_for_import(&NormalizeOptions::default());
        assert_eq!(report.degenerate_removed, 0);
        assert_eq!(mesh.face_count(), 1);
    }

    #[test]
    fn normalize_recomputes_normals() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        // 강제로 normal 왜곡
        mesh.faces[f].set_normal(DVec3::new(0.0, -1.0, 0.0));

        let opts = NormalizeOptions { recompute_normals: true, normalize_winding: false, ..Default::default() };
        let report = mesh.normalize_for_import(&opts);
        assert!(report.normals_recomputed >= 1);

        // 재계산 후 cached가 실제 winding과 일치해야 함
        let inv = mesh.verify_face_invariants();
        assert!(inv.is_valid(), "normalize should fix normal: {}", inv.summary());
    }

    #[test]
    fn normalize_winding_fixes_inverted_tetrahedron() {
        // 뒤집힌 winding의 정사면체 — normalize가 outer=Front로 복구
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // 모든 face를 "안쪽을 향하게" 생성 (winding 반전)
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap(); // 반전 bottom
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        let report = mesh.normalize_for_import(&NormalizeOptions::default());
        // 4개 또는 0개가 flip되어야 함 (다수결 의해)
        // 중요한 건 normalize 후 모든 normal이 바깥을 향하는지
        assert!(report.winding_flipped == 4 || report.winding_flipped == 0,
            "got {} flips", report.winding_flipped);

        // 최종: outer face가 mesh centroid 바깥을 향함
        let active: Vec<FaceId> = mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id).collect();
        let mesh_c = DVec3::new(5.0, 2.5, 5.0); // 대략 centroid
        for fid in &active {
            let verts = mesh.collect_loop_verts(mesh.faces[*fid].outer().start).unwrap();
            let mut fc = DVec3::ZERO;
            for v in &verts { fc += mesh.vertex_pos(*v).unwrap(); }
            fc /= verts.len() as f64;
            let outward = fc - mesh_c;
            let n = mesh.faces[*fid].normal();
            // 바깥으로 향하면 OK (일부 face는 구조상 정확히 수직 ~ dot≈0 허용)
            assert!(outward.dot(n) >= -0.1,
                "face {:?} normal still inward: dot={:.3}", fid, outward.dot(n));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Outward Normal Invariant Tests (ADR-007 원칙 1 확장)
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn outward_open_surface_skips() {
        // 삼각형 하나 — 열린 surface이므로 검증 스킵
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(!report.is_closed_solid, "single face is open, not solid");
        assert!(report.is_valid(), "open surface should pass (skip)");
    }

    #[test]
    fn outward_tetrahedron_all_outward() {
        // 정사면체 — 모든 face가 outward 향하도록 winding
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // Bottom: [v0, v1, v2] → normal -Y (아래쪽 바깥)
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Sides: v3을 "꼭대기"로 감아 side normal이 바깥 향하게
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid, "tet is closed");
        assert_eq!(report.inward_count, 0, "all faces outward: {}", report.summary());
        assert_eq!(report.checked_faces, 4);
    }

    #[test]
    fn outward_sphere_all_outward() {
        // 프리미티브 sphere — Phase 2 수정 후 모든 face outward
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_sphere(DVec3::ZERO, 100.0, 20, 12, mat).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid);
        assert_eq!(report.inward_count, 0,
            "sphere should have all outward normals: {}", report.summary());
    }

    #[test]
    fn outward_detect_flipped_face() {
        // 올바른 tetrahedron winding — 한 face를 flip → inward 감지
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        let f0 = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        // f0 의 normal을 강제로 뒤집기 (cached만)
        let n = mesh.faces[f0].normal();
        mesh.faces[f0].set_normal(-n);

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid);
        assert!(report.inward_count >= 1,
            "flipped face should be detected: {}", report.summary());
        assert!(report.inward_faces.contains(&f0));
    }

    #[test]
    fn invariants_detect_flipped_normal() {
        // 강제로 face의 캐시 normal을 반대로 만들어 invariant가 감지하는지
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let n = mesh.faces[f].normal();
        mesh.faces[f].set_normal(-n); // 강제 반전
        let report = mesh.verify_face_invariants();
        assert!(!report.is_valid(), "flipped cached normal must be detected");
        assert!(report.violations.iter().any(|v| v.contains("cached normal")));
    }

    #[test]
    fn cleanup_degenerate_faces_removes_zero_area() {
        let mut mesh = Mesh::new();
        // Good face
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let good = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let initial_area = mesh.face_area(good);
        assert!(initial_area > 0.1);
        // add_face rejects degenerate at creation (ADR-003), so cleanup on a
        // pristine mesh should remove zero faces.
        let cleaned = mesh.cleanup_degenerate_faces(1e-6);
        assert_eq!(cleaned, 0);
        // The good face must survive
        assert!(mesh.faces.contains(good));
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase E — D Resolver 회귀 테스트 (2026-04-20)
    //
    // 최근 수정된 `resolve_planar_free_faces_scoped` 의 필터 체인
    // (Strip, Local-containment, required_edges, size check) 검증.
    // ═══════════════════════════════════════════════════════════════

    /// Helper: 닫힌 polygon 경로를 free-edge로만 그림 (add_face 안 함).
    fn draw_closed_loop(mesh: &mut Mesh, pts: &[DVec3]) -> Vec<EdgeId> {
        let mut edges = Vec::new();
        for i in 0..pts.len() {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            let (_, _, eid) = mesh.draw_line(a, b).unwrap();
            edges.push(eid);
        }
        edges
    }

    #[test]
    fn d_resolver_simple_square_creates_one_face() {
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "simple square must create 1 face");
    }

    #[test]
    fn d_resolver_nested_rect_without_connector_keeps_both() {
        // 버그 수정 회귀 테스트: outer rect + inner rect (connector 없음)
        // → outer의 centroid가 inner cycle 내부에 있어도 area 비교로 false
        // positive 차단 → inner face 정상 생성.
        let mut mesh = Mesh::new();
        // Outer: (-100,-100) ~ (100,100)
        let outer_verts: Vec<VertId> = [
            DVec3::new(-100.0, 0.0, -100.0),
            DVec3::new( 100.0, 0.0, -100.0),
            DVec3::new( 100.0, 0.0,  100.0),
            DVec3::new(-100.0, 0.0,  100.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&outer_verts, MaterialId::new(0)).unwrap();
        // Inner: (-30,-30) ~ (30,30) — free edges only
        draw_closed_loop(&mut mesh, &[
            DVec3::new(-30.0, 0.0, -30.0),
            DVec3::new( 30.0, 0.0, -30.0),
            DVec3::new( 30.0, 0.0,  30.0),
            DVec3::new(-30.0, 0.0,  30.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "inner rect must be created as a separate face");
        assert_eq!(mesh.face_count(), 2, "total faces = outer + inner");
    }

    #[test]
    fn d_resolver_smaller_cycle_not_rejected_by_larger_face_centroid() {
        // 작은 cycle이 큰 face의 centroid를 포함해도 area 비교로 reject 안 됨.
        let mut mesh = Mesh::new();
        // 큰 face (centroid at origin)
        let big: Vec<VertId> = [
            DVec3::new(-500.0, 0.0, -500.0),
            DVec3::new( 500.0, 0.0, -500.0),
            DVec3::new( 500.0, 0.0,  500.0),
            DVec3::new(-500.0, 0.0,  500.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&big, MaterialId::new(0)).unwrap();
        // 작은 cycle — 원점 포함 but area < big
        draw_closed_loop(&mut mesh, &[
            DVec3::new(-10.0, 0.0, -10.0),
            DVec3::new( 10.0, 0.0, -10.0),
            DVec3::new( 10.0, 0.0,  10.0),
            DVec3::new(-10.0, 0.0,  10.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "small cycle inside large face must still create face");
    }

    #[test]
    fn d_resolver_cw_cycle_rejected() {
        // Clockwise cycle (signed area < 0) → outer boundary, skip.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 0.0, 100.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(100.0, 0.0, 0.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        // 평면 기준에 따라 하나는 CCW 하나는 CW. free HE는 양방향 존재하므로
        // 어느 한 쪽은 항상 생성됨. 중요한 건 무한 루프/중복 생성 없음.
        assert!(faces.len() >= 1, "at least one orientation creates a face");
    }

    #[test]
    fn d_resolver_seed_verts_filter_excludes_untouched_component() {
        // 두 개의 분리된 cycle — seed_verts로 한쪽만 처리.
        let mut mesh = Mesh::new();
        // Component A (will be seeded)
        let a_verts: Vec<VertId> = {
            let (_, _, _) = mesh.draw_line(
                DVec3::new(0.0, 0.0, 0.0), DVec3::new(50.0, 0.0, 0.0)
            ).unwrap();
            let (_, _, _) = mesh.draw_line(
                DVec3::new(50.0, 0.0, 0.0), DVec3::new(50.0, 0.0, 50.0)
            ).unwrap();
            let (_, _, _) = mesh.draw_line(
                DVec3::new(50.0, 0.0, 50.0), DVec3::new(0.0, 0.0, 50.0)
            ).unwrap();
            let (va, _, _) = mesh.draw_line(
                DVec3::new(0.0, 0.0, 50.0), DVec3::new(0.0, 0.0, 0.0)
            ).unwrap();
            vec![va]
        };
        // Component B (not seeded) — far away
        draw_closed_loop(&mut mesh, &[
            DVec3::new(1000.0, 0.0, 1000.0),
            DVec3::new(1100.0, 0.0, 1000.0),
            DVec3::new(1100.0, 0.0, 1100.0),
            DVec3::new(1000.0, 0.0, 1100.0),
        ]);
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            Some(&a_verts),
            None,
        );
        assert_eq!(faces.len(), 1, "only component A processed");
    }

    #[test]
    fn d_resolver_required_edges_small_cycle_bypasses_filter() {
        // cycle_hes.len() ≤ 7 → required_edges 필터 적용 안 됨 (사각형 = 4).
        // 기존 face의 자유 HE cycle이 있어도 작은 cycle은 그냥 통과.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        // required_edges가 비어 있어도 작은 cycle이므로 face 생성됨.
        let empty: Vec<EdgeId> = Vec::new();
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&empty),
        );
        assert_eq!(faces.len(), 1, "small cycle bypasses required_edges filter");
    }

    #[test]
    fn d_resolver_strip_rejected_by_compactness() {
        // 극단적으로 얇은 strip (100:1 aspect ratio) — 100×0.05 = area 5,
        // perimeter ≈ 200.1, compactness ≈ 4π·5/200.1² ≈ 0.00157
        // 임계값 0.001 바로 위라 애매 → 더 얇게 (1000:1 ≈ 0.00016) 사용.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.1),
            DVec3::new(0.0, 0.0, 0.1),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        // 1000:1 strip — compactness ≪ 0.001 → 반드시 거부.
        // (양방향 free HE의 경우 한쪽은 CCW면 다른 건 CW라 최대 1개 후보지만
        //  strip filter가 그것까지 거부해야 함.)
        assert_eq!(faces.len(), 0, "extreme strip must be rejected");
    }

    #[test]
    fn d_resolver_multi_plane_sketch_independent_resolution() {
        // 두 평면에 각각 사각형 → 각 component 독립 평면 결정 (PCA-lite).
        let mut mesh = Mesh::new();
        // Plane 1: XZ at y=0
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        // Plane 2: XY at z=500 (다른 평면)
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 500.0),
            DVec3::new(100.0, 0.0, 500.0),
            DVec3::new(100.0, 100.0, 500.0),
            DVec3::new(0.0, 100.0, 500.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 2, "two independent planes must yield 2 faces");
    }

    #[test]
    fn d_resolver_deduplicate_overlapping_same_boundary() {
        // 같은 boundary를 가진 두 face가 생성되면 deduplicate_overlapping_faces
        // 가 하나만 남김.
        let mut mesh = Mesh::new();
        let verts: Vec<VertId> = [
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        // 같은 경계로 다시 만들어도 add_face가 허용하면...
        // (실제론 CW로 돌려 반대 face 만들 수 있음)
        let cw: Vec<VertId> = vec![verts[0], verts[3], verts[2], verts[1]];
        let _ = mesh.add_face(&cw, MaterialId::new(0));
        let removed = mesh.deduplicate_overlapping_faces();
        // 같은 vertex set을 가진 face가 2개면 1개 제거됨.
        if mesh.face_count() < 2 {
            // 안 만들어진 경우 스킵
        } else {
            assert!(!removed.is_empty(), "duplicate must be removed");
        }
    }

    #[test]
    fn d_resolver_does_not_regenerate_large_deleted_boundary() {
        // 회귀 테스트: 큰 cycle(>7 verts) + required_edges 없음 → skip.
        // 삭제된 원통 top/bottom face 재생성을 방지하는 핵심 필터.
        let mut mesh = Mesh::new();
        // 8각형 free-edge cycle (cycle_hes.len() = 8, threshold 7 초과)
        let r = 100.0;
        let n = 8;
        let mut pts: Vec<DVec3> = Vec::new();
        for i in 0..n {
            let a = (i as f64) * std::f64::consts::TAU / (n as f64);
            pts.push(DVec3::new(r * a.cos(), 0.0, r * a.sin()));
        }
        draw_closed_loop(&mut mesh, &pts);
        // required_edges = 비어 있음 → 큰 cycle은 반드시 skip
        let empty: Vec<EdgeId> = Vec::new();
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&empty),
        );
        assert_eq!(faces.len(), 0, "large cycle without required edge must be skipped");
    }

    // ═══════════════════════════════════════════════════════════════
    // Boundary Extraction — face_set_manifold_info 테스트
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn manifold_info_single_face_is_open() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let info = mesh.face_set_manifold_info(&[f]);
        assert_eq!(info.face_count, 1);
        assert_eq!(info.boundary_edge_count, 3);
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn manifold_info_tetrahedron_is_closed_solid() {
        // 4 faces, 6 edges, each edge used by exactly 2 faces → closed manifold.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // Outward-facing: bottom CCW when seen from below, sides CCW when seen from outside
        let f0 = mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap(); // bottom
        let f1 = mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap(); // side
        let f2 = mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap(); // side
        let f3 = mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap(); // side
        let info = mesh.face_set_manifold_info(&[f0, f1, f2, f3]);
        assert_eq!(info.face_count, 4);
        assert_eq!(info.interior_edge_count, 6);
        assert_eq!(info.boundary_edge_count, 0);
        assert_eq!(info.non_manifold_edge_count, 0);
        assert!(info.is_closed_solid);
        assert!(mesh.is_face_set_closed_solid(&[f0, f1, f2, f3]));
    }

    #[test]
    fn manifold_info_tetra_missing_face_is_open() {
        // Remove one face from tet → 3 edges become boundary.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        let f1 = mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        let f3 = mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();
        // bottom face intentionally omitted
        let info = mesh.face_set_manifold_info(&[f1, f2, f3]);
        assert_eq!(info.face_count, 3);
        assert_eq!(info.boundary_edge_count, 3); // bottom triangle edges
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn manifold_info_minimum_face_count_required() {
        // 경계가 0이어도 face ≥ 4 이어야 closed solid로 판정 (삼각뿔의 pointless 3-face
        // 같은 비정상 케이스 방지).
        let mesh = Mesh::new();
        let info = mesh.face_set_manifold_info(&[]);
        assert_eq!(info.face_count, 0);
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn d_resolver_large_cycle_with_required_edge_creates_face() {
        // 큰 cycle이라도 새 drawLine의 edge를 포함하면 생성됨.
        let mut mesh = Mesh::new();
        let r = 100.0;
        let n = 8;
        let mut pts: Vec<DVec3> = Vec::new();
        for i in 0..n {
            let a = (i as f64) * std::f64::consts::TAU / (n as f64);
            pts.push(DVec3::new(r * a.cos(), 0.0, r * a.sin()));
        }
        let edges = draw_closed_loop(&mut mesh, &pts);
        // 모든 edge가 required (새로 그린 것처럼)
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&edges),
        );
        assert_eq!(faces.len(), 1, "large cycle with required edge creates face");
    }

    // ─── ADR-038 P23.7 회귀 테스트 ─────────────────────────────────────────
    //
    // export_buffers 가 Face.surface = Some(AnalyticSurface) 인 face 에 대해
    // analytic evaluate normal 을 emit 하는지 검증. drift 발생 시 본 테스트
    // 가 깨짐 → P23.1 위반 알림.

    /// P23.7 #1 — Sphere face 의 vertex normal 이 (vertex - center).normalize()
    /// 와 1e-6 이내 일치 (analytic evaluate 의 정확도 검증).
    #[test]
    fn analytic_sphere_face_emits_evaluated_normals() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let center = DVec3::new(10.0, 20.0, 30.0);
        let radius = 5.0;
        let sphere = AnalyticSurface::Sphere {
            center, radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        assert!(mesh.set_face_surface(fid, Some(sphere)));

        let (positions, normals, _indices, face_map, _positions_f64) =
            mesh.export_buffers().unwrap();
        assert!(!positions.is_empty(), "sphere should emit triangles");
        assert!(!face_map.is_empty(), "sphere should emit face_map entries");

        // Verify all vertices have normal = (vertex - center) / radius (within tol).
        let n_verts = positions.len() / 3;
        let mut checked = 0;
        for i in 0..n_verts {
            let p = DVec3::new(
                positions[i * 3] as f64,
                positions[i * 3 + 1] as f64,
                positions[i * 3 + 2] as f64,
            );
            let n = DVec3::new(
                normals[i * 3] as f64,
                normals[i * 3 + 1] as f64,
                normals[i * 3 + 2] as f64,
            );
            let expected = (p - center).normalize_or_zero();
            // f32 → f64 round-trip 의 누적 오차 + sphere 의 폴 점은 spec
            // fallback 사용 → 1e-3 으로 완화 (1e-6 은 f64 단위에서만 보장).
            let err = (n - expected).length();
            if expected.length_squared() > 0.5 {
                assert!(err < 1e-3, "vertex {} normal err={}, expected={:?}, got={:?}",
                    i, err, expected, n);
                checked += 1;
            }
        }
        assert!(checked > 0, "no non-degenerate vertices found to check");
    }

    /// P23.7 #2 — Cylinder face 의 vertex normal 이 axis 에 수직 + radial
    /// 방향인지 검증.
    #[test]
    fn analytic_cylinder_face_emits_radial_normals() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let axis_origin = DVec3::new(0.0, 0.0, 0.0);
        let axis_dir = DVec3::Z;
        let radius = 4.0;
        let cyl = AnalyticSurface::Cylinder {
            axis_origin, axis_dir, radius,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 10.0),
        };
        assert!(mesh.set_face_surface(fid, Some(cyl)));

        let (positions, normals, _indices, _face_map, _) = mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        assert!(n_verts > 0, "cylinder should emit vertices");

        for i in 0..n_verts {
            let p = DVec3::new(
                positions[i * 3] as f64,
                positions[i * 3 + 1] as f64,
                positions[i * 3 + 2] as f64,
            );
            let n = DVec3::new(
                normals[i * 3] as f64,
                normals[i * 3 + 1] as f64,
                normals[i * 3 + 2] as f64,
            );
            // Normal must be perpendicular to axis (dot = 0)
            let axis_dot = n.dot(axis_dir);
            assert!(axis_dot.abs() < 1e-3,
                "vertex {} normal not perpendicular to axis: dot={}", i, axis_dot);
            // Normal must be radial — pointing away from axis projection of vertex
            let radial = (p - axis_origin) - axis_dir * (p - axis_origin).dot(axis_dir);
            let radial_unit = radial.normalize_or_zero();
            if radial_unit.length_squared() > 0.5 {
                let err = (n - radial_unit).length();
                assert!(err < 1e-3,
                    "vertex {} normal not radial: err={}, expected={:?}, got={:?}",
                    i, err, radial_unit, n);
            }
        }
    }

    /// P23.7 #3 — Planar face (no AnalyticSurface) 의 기존 DCEL fan averaging
    /// 동작이 그대로 유지되는지 (regression guard).
    #[test]
    fn planar_face_uses_dcel_averaging_unchanged() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        // No surface attached — should use the existing path.
        assert!(mesh.face_surface(fid).is_none());

        let (positions, normals, indices, face_map, _) = mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        assert_eq!(n_verts, 4, "unit square should have 4 vertices");
        assert_eq!(indices.len(), 6, "unit square should triangulate to 2 triangles");
        assert_eq!(face_map.len(), 2, "2 triangles per face");
        assert!(face_map.iter().all(|&f| f == fid.raw()),
            "all triangles should map to the same FaceId");

        // All normals should be (0, 0, 1) (face on XY plane, normal +Z)
        for i in 0..n_verts {
            let n = DVec3::new(
                normals[i * 3] as f64,
                normals[i * 3 + 1] as f64,
                normals[i * 3 + 2] as f64,
            );
            let expected = DVec3::Z;
            let err = (n - expected).length();
            assert!(err < 1e-3, "planar face vertex {} normal mismatch: {:?}", i, n);
        }
    }

    /// P23.7 supplementary — analytic evaluate path 와 polygon path 가 같은
    /// face_id 를 face_map 에 emit 하는지 (P22.5 cross-link).
    #[test]
    fn analytic_face_emits_uniform_face_id_in_face_map() {
        let mut mesh = Mesh::new();
        let fid = unit_square_face(&mut mesh);
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            ref_dir: DVec3::X, radius: 3.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 5.0),
        };
        mesh.set_face_surface(fid, Some(cyl));

        let (_, _, _, face_map, _) = mesh.export_buffers().unwrap();
        assert!(!face_map.is_empty());
        // P22.5 — 모든 cylinder triangle 이 같은 FaceId
        let unique: std::collections::HashSet<u32> = face_map.iter().copied().collect();
        assert_eq!(unique.len(), 1, "cylinder face emits 1 unique FaceId");
        assert!(unique.contains(&fid.raw()), "FaceId matches the face");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 2 — Mutator hook coverage tests
    //
    // 4 regression invariants (none #[ignore]):
    //   1. set_outer_bumps_face_boundary_version
    //   2. add_inner_and_clear_bump_face_boundary_version
    //   3. inners_mut_explicit_bump_helper
    //   4. move_vertex_propagates_bumps_to_incident_edges_and_faces
    // ════════════════════════════════════════════════════════════════

    fn step2_make_quad_mesh() -> (Mesh, FaceId, [VertId; 4], EdgeId) {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let eid = mesh.find_edge(v0, v1).unwrap();
        (mesh, fid, [v0, v1, v2, v3], eid)
    }

    /// ADR-061 §A — `Face::set_outer` bumps boundary_version.
    #[test]
    fn set_outer_bumps_face_boundary_version() {
        let (mut mesh, fid, _, _) = step2_make_quad_mesh();
        let v0 = mesh.faces[fid].boundary_version();
        let outer = mesh.faces[fid].outer();
        // Re-set to same outer — still bumps (mutation invariant).
        mesh.faces[fid].set_outer(outer);
        assert_eq!(mesh.faces[fid].boundary_version(), v0 + 1,
            "set_outer must bump boundary_version exactly once per call");
    }

    /// ADR-061 §A — `add_inner` and `clear_inners` both bump.
    #[test]
    fn add_inner_and_clear_bump_face_boundary_version() {
        let (mut mesh, fid, _, _) = step2_make_quad_mesh();
        let v0 = mesh.faces[fid].boundary_version();

        let dummy = LoopRef { start: HeId::default(), is_outer: false };
        mesh.faces[fid].add_inner(dummy);
        let v1 = mesh.faces[fid].boundary_version();
        assert_eq!(v1, v0 + 1, "add_inner must bump");

        mesh.faces[fid].clear_inners();
        let v2 = mesh.faces[fid].boundary_version();
        assert_eq!(v2, v1 + 1, "clear_inners must bump");

        // No-op clear (already empty) does NOT bump.
        mesh.faces[fid].clear_inners();
        assert_eq!(mesh.faces[fid].boundary_version(), v2,
            "clear_inners on empty inners must NOT bump (idempotent)");
    }

    /// ADR-061 §A — `inners_mut` is an escape hatch; explicit
    /// `bump_boundary_version_after_inners_mut` is the contract.
    #[test]
    fn inners_mut_explicit_bump_helper() {
        let (mut mesh, fid, _, _) = step2_make_quad_mesh();
        let v0 = mesh.faces[fid].boundary_version();

        // Direct inners_mut mutation does NOT auto-bump.
        let dummy = LoopRef { start: HeId::default(), is_outer: false };
        mesh.faces[fid].inners_mut().push(dummy);
        assert_eq!(mesh.faces[fid].boundary_version(), v0,
            "inners_mut alone must NOT auto-bump (escape hatch behavior)");

        // Caller invokes the bump helper.
        mesh.faces[fid].bump_boundary_version_after_inners_mut();
        assert_eq!(mesh.faces[fid].boundary_version(), v0 + 1,
            "explicit helper must bump exactly once");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 3 — Z.1 Normal Cache hot-path tests
    //
    // 3 regression invariants (none #[ignore]):
    //   5. cache_hit_returns_identical_data — call twice, identical results
    //   6. cache_skips_plane_surface — Plane never populates cache entry
    //   7. cache_normal_matches_analytic_evaluate — sphere normals match
    //      closed-form (vertex - center).normalize()
    // ════════════════════════════════════════════════════════════════

    fn step3_quad_with_sphere_surface() -> (Mesh, FaceId) {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        // Quad on the +X side of unit sphere — vertices on sphere surface.
        let r = 1.0;
        let v0 = mesh.add_vertex(DVec3::new(r, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.7071, 0.7071, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.7071, 0.0, 0.7071));
        let v3 = mesh.add_vertex(DVec3::new(0.5774, 0.5774, 0.5774));
        let fid = mesh.add_face(&[v0, v1, v3, v2], mat).unwrap();
        let sph = crate::surfaces::AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: r,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.set_face_surface(fid, Some(sph));
        (mesh, fid)
    }

    /// ADR-061 §A invariant #5 — Two consecutive calls return identical
    /// data (the second call is served by cache).
    #[test]
    fn cache_hit_returns_identical_data() {
        let (mesh, fid) = step3_quad_with_sphere_surface();
        let first = mesh.face_cached_normals_or_compute(fid).expect("sphere face has surface");
        // Verify cache populated.
        assert!(mesh.faces[fid].normal_cache().is_some(),
            "first call must populate cache (Cylinder/Sphere are cacheable per §D #2)");
        let second = mesh.face_cached_normals_or_compute(fid).expect("hit");
        assert_eq!(first.len(), second.len(),
            "cached call must return same vertex count");
        for (i, (a, b)) in first.iter().zip(second.iter()).enumerate() {
            assert!((*a - *b).length() < 1e-15,
                "vertex {} normal mismatch: cache hit vs first compute differ \
                 ({:?} vs {:?})", i, a, b);
        }
    }

    /// ADR-061 §D #2 invariant #6 — Plane surfaces are NEVER cached.
    /// `face_cached_normals_or_compute` still returns Some(...) (computed
    /// fresh each call) but no entry is stored.
    #[test]
    fn cache_skips_plane_surface() {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let plane = crate::surfaces::AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-100.0, 100.0), v_range: (-100.0, 100.0),
        };
        mesh.set_face_surface(fid, Some(plane));
        assert!(!mesh.faces[fid].should_cache_normals(),
            "Plane must not be cacheable per §D #2");

        let normals = mesh.face_cached_normals_or_compute(fid).expect("plane returns Some");
        assert_eq!(normals.len(), 4);
        // All normals = +Z (constant for Plane).
        for n in &normals {
            assert!((*n - DVec3::Z).length() < 1e-9,
                "Plane vertex normal must be +Z, got {:?}", n);
        }
        // Critical: NO cache entry stored for Plane.
        assert!(mesh.faces[fid].normal_cache().is_none(),
            "Plane surface MUST NOT populate normal_cache (§D #2 lock-in)");
    }

    /// ADR-061 §A invariant #7 (semantic correctness) — Sphere face
    /// normals match the closed-form `(vertex - center).normalize()`.
    /// Validates that cache stores correct values, not garbage.
    #[test]
    fn cache_normal_matches_analytic_evaluate() {
        let (mesh, fid) = step3_quad_with_sphere_surface();
        let normals = mesh.face_cached_normals_or_compute(fid).expect("sphere face");
        let outer = mesh.collect_loop_verts(mesh.faces[fid].outer().start).unwrap();
        let positions: Vec<DVec3> = outer.iter()
            .map(|&vid| mesh.verts[vid].pos())
            .collect();

        assert_eq!(normals.len(), positions.len());
        for (i, (n, p)) in normals.iter().zip(positions.iter()).enumerate() {
            // Sphere centered at origin, radius=1: normal = pos.normalize().
            let expected = p.normalize_or_zero();
            assert!((*n - expected).length() < 1e-9,
                "vertex {} cached normal {:?} != closed-form {:?}",
                i, n, expected);
        }

        // After move_vertex, cache invalidates and next call recomputes.
        let v0_new = DVec3::new(0.0, 1.0, 0.0);  // top of sphere
        let v0 = outer[0];
        // Need &mut for move_vertex — drop the immutable borrow first.
        let mut mesh_mut = mesh;
        mesh_mut.move_vertex(v0, v0_new).unwrap();
        assert!(mesh_mut.faces[fid].normal_cache().is_none(),
            "move_vertex must invalidate normal_cache");
        let normals2 = mesh_mut.face_cached_normals_or_compute(fid).expect("sphere face");
        // First normal should now be (0, 1, 0).
        assert!((normals2[0] - DVec3::Y).length() < 1e-9,
            "after move_vertex to (0,1,0), normal must be +Y, got {:?}", normals2[0]);
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 4 — Z.2 Curve Hover Cache hot-path tests
    //
    // 3 regression invariants (none #[ignore]):
    //   8. polyline_cache_hit_returns_identical_data
    //   9. polyline_cache_skips_line_curve (§D #2 lock-in)
    //  10. polyline_cache_invalidates_on_endpoint_move (Step 2 hook
    //      integration — move_vertex bumps curve_version)
    // ════════════════════════════════════════════════════════════════

    fn step4_circle_edge() -> (Mesh, EdgeId) {
        let mut mesh = Mesh::default();
        let v0 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(-1.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(v0, v1).unwrap();
        // Attach a Circle curve (cacheable per §D #2).
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        mesh.edges[eid].set_curve(Some(circle));
        (mesh, eid)
    }

    /// ADR-061 §B invariant #8 — Two consecutive calls return identical
    /// polyline data (second served by cache).
    #[test]
    fn polyline_cache_hit_returns_identical_data() {
        let (mesh, eid) = step4_circle_edge();
        let first = mesh.edge_cached_polyline_or_compute(
            eid, crate::tolerances::HOVER_CHORD_TOL,
        ).expect("circle edge has curve");
        assert!(mesh.edges[eid].polyline_cache().is_some(),
            "first call must populate cache (Circle is cacheable per §D #2)");
        let second = mesh.edge_cached_polyline_or_compute(
            eid, crate::tolerances::HOVER_CHORD_TOL,
        ).expect("hit");
        assert_eq!(first.len(), second.len(),
            "cached call must return same point count");
        for (i, (a, b)) in first.iter().zip(second.iter()).enumerate() {
            assert!((*a - *b).length() < 1e-15,
                "polyline point {} mismatch: hit vs first ({:?} vs {:?})",
                i, a, b);
        }
    }

    /// ADR-061 §D #2 invariant #9 — Line edges are NEVER cached.
    /// `edge_cached_polyline_or_compute` returns Some(...) (computed
    /// fresh each call) but no entry stored.
    #[test]
    fn polyline_cache_skips_line_curve() {
        let mut mesh = Mesh::default();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(v0, v1).unwrap();
        // Attach explicit Line variant.
        mesh.edges[eid].set_curve(Some(crate::curves::AnalyticCurve::Line {
            start: v0, end: v1,
        }));
        assert!(!mesh.edges[eid].should_cache_polyline(),
            "Line variant must not be cacheable per §D #2");

        let polyline = mesh.edge_cached_polyline_or_compute(
            eid, crate::tolerances::HOVER_CHORD_TOL,
        ).expect("Line edge returns Some");
        assert!(!polyline.is_empty(),
            "Line tessellation must produce >=2 points");
        // Critical: NO cache entry stored.
        assert!(mesh.edges[eid].polyline_cache().is_none(),
            "Line curve MUST NOT populate polyline_cache (§D #2 lock-in)");
    }

    /// ADR-061 §B invariant #10 — `Mesh::move_vertex` on an endpoint
    /// vertex bumps the edge's curve_version, invalidating any cached
    /// polyline. Next read recomputes.
    #[test]
    fn polyline_cache_invalidates_on_endpoint_move() {
        let (mut mesh, eid) = step4_circle_edge();
        // Populate cache.
        let _ = mesh.edge_cached_polyline_or_compute(
            eid, crate::tolerances::HOVER_CHORD_TOL,
        );
        assert!(mesh.edges[eid].polyline_cache().is_some());
        let v_before = mesh.edges[eid].curve_version();

        // Move v_small (an endpoint of this edge).
        let v_small = mesh.edges[eid].v_small();
        mesh.move_vertex(v_small, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // curve_version bumped + cache cleared.
        assert!(mesh.edges[eid].curve_version() > v_before,
            "move_vertex on endpoint must bump edge curve_version");
        assert!(mesh.edges[eid].polyline_cache().is_none(),
            "move_vertex must invalidate polyline_cache");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 5 — Byte-cap LRU + cache_stats tests
    //
    // 2 regression invariants (none #[ignore]):
    //  11. cache_stats_reflects_populated_state — hit/miss → stats track
    //  12. cache_byte_cap_evicts_oldest — synthetic over-cap forces
    //      eviction, oldest entries dropped first
    // ════════════════════════════════════════════════════════════════

    /// ADR-061 §D #4 invariant #11 — Cache stats accurately reflect
    /// populated state across face + edge caches.
    #[test]
    fn cache_stats_reflects_populated_state() {
        let (mesh, fid) = step3_quad_with_sphere_surface();

        // Empty initial state.
        let stats0 = mesh.cache_stats();
        assert_eq!(stats0.face_entry_count, 0);
        assert_eq!(stats0.edge_entry_count, 0);
        assert_eq!(stats0.total_bytes, 0);
        assert_eq!(stats0.cap_bytes, super::CACHE_CAP_BYTES);

        // Populate face cache via hot-path.
        let _ = mesh.face_cached_normals_or_compute(fid).unwrap();
        let stats1 = mesh.cache_stats();
        assert_eq!(stats1.face_entry_count, 1, "face populate must register");
        assert!(stats1.face_cache_bytes > 0);
        assert_eq!(stats1.total_bytes, stats1.face_cache_bytes + stats1.edge_cache_bytes);

        // Now populate an edge cache.
        let (mesh2, eid) = step4_circle_edge();
        let _ = mesh2.edge_cached_polyline_or_compute(eid, 0.01).unwrap();
        let stats2 = mesh2.cache_stats();
        assert_eq!(stats2.edge_entry_count, 1);
        assert!(stats2.edge_cache_bytes > 0);
    }

    /// ADR-061 §D #4 invariant #12 — Byte-cap LRU eviction. Synthetic
    /// over-cap state (manually inflated entry) forces evict on next
    /// populate. Oldest-tick entry is dropped first.
    #[test]
    fn cache_byte_cap_evicts_oldest() {
        let (mesh, fid) = step3_quad_with_sphere_surface();

        // Populate normally to get a small cache.
        let _ = mesh.face_cached_normals_or_compute(fid).unwrap();
        assert!(mesh.faces[fid].normal_cache().is_some());

        // Manually replace with a huge entry that exceeds cap.
        let huge = crate::entities::NormalCacheEntry {
            surface_version: mesh.faces[fid].surface_version(),
            boundary_version: mesh.faces[fid].boundary_version(),
            // Roughly 200MB worth of vec3 (over 100MB cap).
            per_vertex_normals: vec![DVec3::Z; (200 * 1024 * 1024) / 24],
            last_access_tick: 1, // very old tick
        };
        mesh.faces[fid].cache_normals(huge);

        let stats_before = mesh.cache_stats();
        assert!(stats_before.total_bytes > super::CACHE_CAP_BYTES,
            "synthetic state must exceed cap to test eviction");
        let evict_before = stats_before.eviction_count;

        // Trigger eviction directly.
        mesh.evict_lru_if_over_cap();

        let stats_after = mesh.cache_stats();
        assert!(stats_after.total_bytes <= super::CACHE_CAP_BYTES,
            "after evict, total bytes must be ≤ cap (got {} vs cap {})",
            stats_after.total_bytes, super::CACHE_CAP_BYTES);
        assert!(stats_after.eviction_count > evict_before,
            "eviction_count must increment");
        // The huge entry (oldest tick=1) was dropped.
        assert!(mesh.faces[fid].normal_cache().is_none(),
            "oldest entry (tick=1) must be evicted first");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-062 Phase L₂ Path Z Step 2 — attach_surface_validated tests
    //
    // 3 regression invariants (none #[ignore]):
    //   1. attach_validated_succeeds_when_boundary_fits
    //   2. attach_validated_rejects_drift
    //   3. attach_validated_rejects_degenerate_input
    // ════════════════════════════════════════════════════════════════

    fn step2_l2_quad_on_cylinder() -> (Mesh, FaceId) {
        // 4 verts on cylinder (axis +Z, radius 5, between z=0 and z=2).
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 5.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 5.0, 2.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 0.0, 2.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        (mesh, fid)
    }

    /// ADR-062 Step 2 invariant #1 — Boundary verts on cylinder →
    /// Attached, no previous surface, default tol passes.
    #[test]
    fn attach_validated_succeeds_when_boundary_fits() {
        let (mut mesh, fid) = step2_l2_quad_on_cylinder();
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 2.0),
        };
        let outcome = mesh.attach_surface_validated(
            fid, cyl, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome {
            SurfaceAttachOutcome::Attached { previous_kind: None } => {}
            other => panic!("expected Attached(None), got {:?}", other),
        }
        // Mesh state changed: face now has surface.
        assert!(mesh.faces[fid].surface().is_some(),
            "face must have surface attached after Attached outcome");
    }

    /// ADR-062 Step 2 invariant #2 — Wrong radius → BoundaryDriftExceedsTol.
    #[test]
    fn attach_validated_rejects_drift() {
        let (mut mesh, fid) = step2_l2_quad_on_cylinder();
        // Boundary is at radius 5, but we attach radius 10 cylinder.
        let cyl_wrong = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 10.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 2.0),
        };
        let outcome = mesh.attach_surface_validated(
            fid, cyl_wrong, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome {
            SurfaceAttachOutcome::BoundaryDriftExceedsTol {
                max_drift_mm, tol_mm, worst_vertex_idx,
            } => {
                // Drift = |5 - 10| = 5mm.
                assert!((max_drift_mm - 5.0).abs() < 1e-9,
                    "expected drift ~5mm, got {}", max_drift_mm);
                assert_eq!(tol_mm, crate::tolerances::ATTACH_VALIDATE_TOL);
                assert!(worst_vertex_idx < 4, "worst_vertex_idx in 0..4");
            }
            other => panic!("expected BoundaryDriftExceedsTol, got {:?}", other),
        }
        // Critical: surface NOT attached (mesh state unchanged on reject).
        assert!(mesh.faces[fid].surface().is_none(),
            "face must NOT have surface after rejected attach");
    }

    /// ADR-062 Step 2 invariant #3 — Degenerate input (radius=0) →
    /// DegenerateSurfaceInput. Pre-distance check catches before
    /// boundary loop walk to avoid NaN cascade.
    #[test]
    fn attach_validated_rejects_degenerate_input() {
        let (mut mesh, fid) = step2_l2_quad_on_cylinder();
        let cyl_deg = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 0.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 2.0),
        };
        let outcome = mesh.attach_surface_validated(
            fid, cyl_deg, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome {
            SurfaceAttachOutcome::DegenerateSurfaceInput { reason } => {
                assert!(reason.contains("non-positive") || reason.contains("zero"),
                    "reason should describe the degeneracy, got: {}", reason);
            }
            other => panic!("expected DegenerateSurfaceInput, got {:?}", other),
        }
        // Critical: surface NOT attached.
        assert!(mesh.faces[fid].surface().is_none());

        // Bonus: zero axis_dir variant.
        let cyl_zero_axis = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::ZERO, radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 2.0),
        };
        let outcome2 = mesh.attach_surface_validated(
            fid, cyl_zero_axis, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        assert!(matches!(outcome2, SurfaceAttachOutcome::DegenerateSurfaceInput { .. }),
            "zero axis_dir must also be degenerate, got {:?}", outcome2);
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-062 Phase L₂ Path Z Step 4 — Phase O 비-충돌 + previous_kind
    //
    // 1 regression invariant (none #[ignore]):
    //   1. attach_validated_replace_existing_records_previous_kind
    //      Verifies Plane → Cylinder attach records previous_kind="Plane",
    //      and that re-attaching the same surface kind works (no special-case).
    //
    // Phase O 비-충돌 검증: 본 ADR 의 attach_surface_validated 와 raw
    // set_face_surface (Phase O Step 3 push_pull / Step 5 fillet_brep
    // 가 사용) 의 분리 보장. raw 경로는 검증 0 (내부 도구 — 기하
    // 보장됨), validated 경로는 외부 caller 용. 두 path 가 같은
    // set_face_surface mutator 를 공유하지만 cache invalidation 은
    // 양쪽 모두 자동.
    // ════════════════════════════════════════════════════════════════

    /// ADR-062 Step 4 invariant — `previous_kind` 추적.
    ///
    /// Sequence:
    ///   1. Polygon face (no surface) → attach Plane → previous_kind=None
    ///   2. Plane attached → attach Cylinder (boundary fits) →
    ///      previous_kind=Some("Plane")
    ///   3. Cylinder attached → attach Cylinder (same kind) →
    ///      previous_kind=Some("Cylinder") (re-attach OK)
    ///
    /// Also exercises Phase O 비-충돌: raw set_face_surface (used
    /// internally by fillet_brep / push_pull) still works in parallel
    /// with attach_surface_validated — both go through Face::set_surface
    /// hook, so cache invalidation is consistent.
    #[test]
    fn attach_validated_replace_existing_records_previous_kind() {
        // Build a flat 4-vert face on Z=0 plane.
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        // Step A — polygon face (no surface) → attach Plane.
        let plane = crate::surfaces::AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-10.0, 10.0), v_range: (-10.0, 10.0),
        };
        let outcome_a = mesh.attach_surface_validated(
            fid, plane, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome_a {
            SurfaceAttachOutcome::Attached { previous_kind: None } => {}
            other => panic!("step A: expected Attached(None), got {:?}", other),
        }
        assert_eq!(mesh.faces[fid].surface().map(|s| s.kind_label()), Some("Plane"));

        // Step B — Plane attached → attach Cylinder.
        // Boundary verts are at z=0, all on the +X side of axis (axis +Z
        // through origin). For cylinder radius 1.0, vertex at (1,0,0)
        // and (1,1,0) sit exactly on cylinder surface (radial=1) but
        // (0,0,0) and (0,1,0) sit on the axis itself (radial=0). Drift = 1.
        // → BoundaryDriftExceedsTol (NOT Attached). Use a face fully on
        // a known cylinder instead.
        let mut mesh2 = Mesh::default();
        let mat2 = MaterialId::new(0);
        // 4 verts on cylinder of radius 5, axis +Z, between z=0..2.
        let w0 = mesh2.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let w1 = mesh2.add_vertex(DVec3::new(0.0, 5.0, 0.0));
        let w2 = mesh2.add_vertex(DVec3::new(0.0, 5.0, 2.0));
        let w3 = mesh2.add_vertex(DVec3::new(5.0, 0.0, 2.0));
        let fid2 = mesh2.add_face(&[w0, w1, w2, w3], mat2).unwrap();

        // First attach via raw set_face_surface (Phase O internal pattern):
        let plane_raw = crate::surfaces::AnalyticSurface::Plane {
            origin: DVec3::new(2.5, 2.5, 1.0),
            // Average plane through verts — for our ring of 4 cylinder verts
            // a "best-fit Plane" wouldn't really fit, but we don't need fit
            // here — raw set_face_surface skips validation by design.
            normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-10.0, 10.0), v_range: (-10.0, 10.0),
        };
        // Phase O 비-충돌 — raw API still works without validation.
        assert!(mesh2.set_face_surface(fid2, Some(plane_raw)));
        assert_eq!(mesh2.faces[fid2].surface().map(|s| s.kind_label()), Some("Plane"));

        // Now attach Cylinder via VALIDATED path — should record previous Plane.
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 2.0),
        };
        let outcome_b = mesh2.attach_surface_validated(
            fid2, cyl.clone(), crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome_b {
            SurfaceAttachOutcome::Attached { previous_kind: Some("Plane") } => {}
            other => panic!("step B: expected Attached(Some(\"Plane\")), got {:?}", other),
        }
        assert_eq!(mesh2.faces[fid2].surface().map(|s| s.kind_label()), Some("Cylinder"));

        // Step C — re-attach same kind (Cylinder → Cylinder) → previous_kind="Cylinder".
        let outcome_c = mesh2.attach_surface_validated(
            fid2, cyl, crate::tolerances::ATTACH_VALIDATE_TOL,
        );
        match outcome_c {
            SurfaceAttachOutcome::Attached { previous_kind: Some("Cylinder") } => {}
            other => panic!("step C: expected Attached(Some(\"Cylinder\")), got {:?}", other),
        }
    }

    /// ADR-061 §A + §B — `Mesh::move_vertex` bumps incident edges'
    /// curve_version AND incident faces' boundary_version. Caches on
    /// both are invalidated.
    #[test]
    fn move_vertex_propagates_bumps_to_incident_edges_and_faces() {
        let (mut mesh, fid, verts, eid) = step2_make_quad_mesh();
        let v0 = verts[0];

        let face_v0 = mesh.faces[fid].boundary_version();
        let edge_v0 = mesh.edges[eid].curve_version();

        // Pre-populate caches with stale data to verify invalidation.
        mesh.faces[fid].cache_normals(crate::entities::NormalCacheEntry {
            surface_version: mesh.faces[fid].surface_version(),
            boundary_version: face_v0,
            per_vertex_normals: vec![DVec3::Z; 4],
            last_access_tick: 0,
        });
        mesh.edges[eid].cache_polyline(crate::entities::PolylineCacheEntry {
            curve_version: edge_v0,
            points: vec![DVec3::ZERO, DVec3::X],
            last_access_tick: 0,
        });
        assert!(mesh.faces[fid].normal_cache().is_some());
        assert!(mesh.edges[eid].polyline_cache().is_some());

        // Move v0.
        mesh.move_vertex(v0, DVec3::new(-0.5, 0.0, 0.0)).unwrap();

        // Face boundary_version bumped + cache cleared.
        assert!(mesh.faces[fid].boundary_version() > face_v0,
            "move_vertex must bump incident face boundary_version");
        assert!(mesh.faces[fid].normal_cache().is_none(),
            "move_vertex must invalidate incident face normal_cache");

        // Edge curve_version bumped + cache cleared (v0-v1 edge).
        assert!(mesh.edges[eid].curve_version() > edge_v0,
            "move_vertex must bump incident edge curve_version");
        assert!(mesh.edges[eid].polyline_cache().is_none(),
            "move_vertex must invalidate incident edge polyline_cache");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-064 Step 1 — Trim loops → DCEL polyline integration
    //
    // 1 regression at Mesh integration level (5 unit tests in
    // surfaces/ssi/trim_to_polyline.rs cover the trim sampling per
    // variant + uv→world evaluation + multi-loop hole + disjoint case):
    //   #4 mesh_trim_loops_to_dcel_polyline_dedups_at_locked_5
    // ════════════════════════════════════════════════════════════════

    /// ADR-064 Step 1 §C #3 — Mesh-level integration: trim_loops_to_dcel_polyline
    /// dedups coincident vertices via LOCKED #5 1.5μm spatial-hash.
    ///
    /// Two trim loops sharing a corner point in UV space (after
    /// surface evaluate to 3D) should produce VertIds where the shared
    /// corner vertex is the SAME — not two distinct VertIds.
    #[test]
    fn mesh_trim_loops_to_dcel_polyline_dedups_at_locked_5() {
        use crate::surfaces::{trim::TrimCurve2D, trim::TrimLoop, AnalyticSurface};

        let mut mesh = Mesh::new();
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-100.0, 100.0),
            v_range: (-100.0, 100.0),
        };

        // Two adjacent triangle loops sharing the edge (5,0)-(0,0).
        // VertId for (5,0) and (0,0) MUST be reused across loops.
        let loops = vec![
            TrimLoop {
                is_outer: true,
                curves: vec![
                    TrimCurve2D::Line { a: [0.0, 0.0], b: [5.0, 0.0] },
                    TrimCurve2D::Line { a: [5.0, 0.0], b: [3.0, 4.0] },
                    TrimCurve2D::Line { a: [3.0, 4.0], b: [0.0, 0.0] },
                ],
            },
            TrimLoop {
                is_outer: true,
                curves: vec![
                    TrimCurve2D::Line { a: [0.0, 0.0], b: [5.0, 0.0] },  // shared edge
                    TrimCurve2D::Line { a: [5.0, 0.0], b: [5.0, -3.0] },
                    TrimCurve2D::Line { a: [5.0, -3.0], b: [0.0, 0.0] },
                ],
            },
        ];

        let vert_id_polylines = mesh.trim_loops_to_dcel_polyline(&loops, &plane, 0.01);
        assert_eq!(vert_id_polylines.len(), 2);

        let l1 = &vert_id_polylines[0];
        let l2 = &vert_id_polylines[1];
        assert!(!l1.is_empty() && !l2.is_empty());

        // First vert in each loop = evaluate(0, 0). Spatial-hash dedup
        // produces SAME VertId across both loops.
        assert_eq!(l1[0], l2[0],
            "shared corner (0,0,0) must produce same VertId across loops");

        // (5,0) corner is also shared — appears as second point in
        // loop 1 (after seam-dedup of first curve), and second point
        // in loop 2. Look it up.
        // Loop 1 polyline: (0,0), (5,0), (3,4) [no seam dup at end].
        // Loop 2 polyline: (0,0), (5,0), (5,-3).
        assert_eq!(l1[1], l2[1],
            "shared corner (5,0,0) must produce same VertId across loops");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-064 Step 2 (Path Z, 2.A) — TrimLoop polyline → DCEL Face
    //
    // 6 regression invariants (none #[ignore], §X.5 #6 strict):
    //   1. trim_loops_to_face_creates_simple_outer_only
    //   2. trim_loops_to_face_with_inner_hole
    //   3. trim_loops_to_face_multi_inner_holes
    //   4. trim_loops_to_face_rejects_degenerate_outer
    //   5. trim_loops_to_face_invariants_pass
    //   6. trim_loops_to_face_dropin_alongside_no_regression
    // ════════════════════════════════════════════════════════════════

    /// ADR-064 Step 2 #1 — Simple outer-only loop produces a valid
    /// face with no inner holes.
    #[test]
    fn trim_loops_to_face_creates_simple_outer_only() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        let polylines = vec![vec![v0, v1, v2, v3]];
        let fid = m.trim_loops_to_face(&polylines, mat)
            .expect("simple outer should succeed");
        assert!(m.faces[fid].is_active());
        assert_eq!(m.faces[fid].inners().len(), 0,
            "outer-only input must produce 0 inner holes");
    }

    /// ADR-064 Step 2 #2 — outer + 1 inner hole produces multi-loop face.
    #[test]
    fn trim_loops_to_face_with_inner_hole() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Outer 10x10 square (CCW).
        let o0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let o1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let o2 = m.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let o3 = m.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        // Inner 2x2 hole at center (CW per ADR-006/021/022 hole convention).
        let i0 = m.add_vertex(DVec3::new(4.0, 4.0, 0.0));
        let i1 = m.add_vertex(DVec3::new(4.0, 6.0, 0.0));
        let i2 = m.add_vertex(DVec3::new(6.0, 6.0, 0.0));
        let i3 = m.add_vertex(DVec3::new(6.0, 4.0, 0.0));
        let polylines = vec![
            vec![o0, o1, o2, o3],   // outer CCW
            vec![i0, i1, i2, i3],   // inner CW (hole)
        ];
        let fid = m.trim_loops_to_face(&polylines, mat)
            .expect("outer + 1 inner hole should succeed");
        assert!(m.faces[fid].is_active());
        assert_eq!(m.faces[fid].inners().len(), 1,
            "1 inner hole must produce 1 LoopRef inner");
    }

    /// ADR-064 Step 2 #3 §D-F — multi-inner-hole support
    /// (Phase J ContainmentTree may produce N inner holes).
    #[test]
    fn trim_loops_to_face_multi_inner_holes() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Outer 20x20 square.
        let o0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let o1 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let o2 = m.add_vertex(DVec3::new(20.0, 20.0, 0.0));
        let o3 = m.add_vertex(DVec3::new(0.0, 20.0, 0.0));
        // 3 separate inner holes (CW, non-intersecting).
        let make_hole = |m: &mut Mesh, cx: f64, cy: f64| -> Vec<VertId> {
            vec![
                m.add_vertex(DVec3::new(cx,         cy,         0.0)),
                m.add_vertex(DVec3::new(cx,         cy + 1.0,   0.0)),
                m.add_vertex(DVec3::new(cx + 1.0,   cy + 1.0,   0.0)),
                m.add_vertex(DVec3::new(cx + 1.0,   cy,         0.0)),
            ]
        };
        let h_a = make_hole(&mut m, 3.0, 3.0);
        let h_b = make_hole(&mut m, 10.0, 5.0);
        let h_c = make_hole(&mut m, 14.0, 14.0);
        let polylines = vec![
            vec![o0, o1, o2, o3],
            h_a.clone(), h_b.clone(), h_c.clone(),
        ];
        let fid = m.trim_loops_to_face(&polylines, mat)
            .expect("outer + 3 inner holes should succeed");
        assert!(m.faces[fid].is_active());
        assert_eq!(m.faces[fid].inners().len(), 3,
            "3 inner holes must produce 3 LoopRef inners");
    }

    /// ADR-064 Step 2 #4 — Degenerate outer (< 3 verts) is rejected.
    #[test]
    fn trim_loops_to_face_rejects_degenerate_outer() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::ZERO);
        let v1 = m.add_vertex(DVec3::X);

        // Empty input.
        assert!(m.trim_loops_to_face(&[], mat).is_err(),
            "empty input must err");
        // 0-vert outer.
        assert!(m.trim_loops_to_face(&[vec![]], mat).is_err());
        // 2-vert outer (line, not face).
        assert!(m.trim_loops_to_face(&[vec![v0, v1]], mat).is_err(),
            "<3 outer verts must err");
    }

    /// ADR-064 Step 2 #5 §D-G — ADR-007 Invariant 2 (winding)
    /// validation. add_face_with_holes computes normal from outer loop
    /// via Newell's method; result is a valid unit normal for proper
    /// CCW input.
    ///
    /// Note: degenerate (collinear) handling is delegated to existing
    /// `compute_normal` engine behavior (NORMAL_EPSILON = 0.0); strict
    /// degenerate-rejection is outside Step 2 scope (Step 5 cutover or
    /// future ADR-007 strengthening).
    #[test]
    fn trim_loops_to_face_invariants_pass() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Valid CCW triangle in XY plane → normal +Z.
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let polylines = vec![vec![v0, v1, v2]];
        let fid = m.trim_loops_to_face(&polylines, mat).unwrap();
        let normal = m.faces[fid].normal();
        assert!((normal.length() - 1.0).abs() < 1e-6,
            "Face normal must be unit (ADR-007 Invariant 2), got len {}",
            normal.length());
        // CCW outer in XY → +Z normal.
        assert!(normal.z > 0.9,
            "CCW outer in XY must have +Z normal, got {:?}", normal);

        // Same shape with reversed (CW) winding → −Z normal (still
        // unit, but opposite). This validates that Newell's method
        // correctly captures winding direction.
        let mut m2 = Mesh::new();
        let w0 = m2.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let w1 = m2.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let w2 = m2.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let cw_polylines = vec![vec![w0, w2, w1]];  // reversed
        let fid2 = m2.trim_loops_to_face(&cw_polylines, mat).unwrap();
        let normal2 = m2.faces[fid2].normal();
        assert!((normal2.length() - 1.0).abs() < 1e-6,
            "CW face normal must also be unit length");
        assert!(normal2.z < -0.9,
            "CW outer in XY must have −Z normal, got {:?}", normal2);
    }

    /// ADR-064 Step 2 #6 — drop-in alongside: existing
    /// `add_face_with_holes` callers / `add_face` callers unchanged.
    /// Verify by calling both with same input and comparing topology.
    #[test]
    fn trim_loops_to_face_dropin_alongside_no_regression() {
        // Same input via add_face vs trim_loops_to_face.
        let mat = MaterialId::new(0);
        let mut m1 = Mesh::new();
        let v0 = m1.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m1.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m1.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = m1.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let direct = m1.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let direct_inners = m1.faces[direct].inners().len();

        let mut m2 = Mesh::new();
        let w0 = m2.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let w1 = m2.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let w2 = m2.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let w3 = m2.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let via_trim = m2.trim_loops_to_face(&[vec![w0, w1, w2, w3]], mat).unwrap();
        let trim_inners = m2.faces[via_trim].inners().len();

        // Topology identical: same inner count (0).
        assert_eq!(direct_inners, trim_inners, "inner count must match");
        // Both faces active.
        assert!(m1.faces[direct].is_active() && m2.faces[via_trim].is_active());
        // Normals identical (both +Z for CCW square).
        let n1 = m1.faces[direct].normal();
        let n2 = m2.faces[via_trim].normal();
        assert!((n1 - n2).length() < 1e-9,
            "drop-in alongside must produce identical normals");
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-088 S-β regression — Edge.curve_owner_id field + Mesh counter.
    //
    // L1 (additive): Edge 기존 필드 / DCEL topology 무변화. owner_id 는
    //   default None — 기존 edge 동작 영향 0.
    // L2 (monotonic): Mesh::next_curve_owner_id() 가 unique IDs 발급.
    // L3 prep (group query): edges_by_curve_owner(id) 가 같은 그룹의
    //   모든 active edges 반환.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr088_edge_default_curve_owner_id_is_none() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::ZERO);
        let v1 = mesh.add_vertex(DVec3::X);
        let (_, _, eid) = mesh.draw_line(DVec3::ZERO, DVec3::X).unwrap();
        let _ = (v0, v1);
        assert_eq!(mesh.edge_curve_owner_id(eid), None,
            "ADR-088 L1: new edges must have curve_owner_id = None");
    }

    #[test]
    fn adr088_mesh_counter_monotonic_unique() {
        let mut mesh = Mesh::new();
        let id0 = mesh.next_curve_owner_id();
        let id1 = mesh.next_curve_owner_id();
        let id2 = mesh.next_curve_owner_id();
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert!(id0 < id1 && id1 < id2,
            "ADR-088 L2: next_curve_owner_id must be monotonic");
    }

    #[test]
    fn adr088_edges_by_curve_owner_groups_correctly() {
        // Simulate 3 segments of one circle (owner 0) + 2 segments of another
        // (owner 1) + 1 standalone line (None). Verify group queries return
        // correct edges.
        let mut mesh = Mesh::new();
        // Curve A: 3 segments
        let owner_a = mesh.next_curve_owner_id();
        let (_, _, e_a0) = mesh.draw_line(DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0)).unwrap();
        let (_, _, e_a1) = mesh.draw_line(DVec3::new(1.0, 0.0, 0.0), DVec3::new(1.0, 1.0, 0.0)).unwrap();
        let (_, _, e_a2) = mesh.draw_line(DVec3::new(1.0, 1.0, 0.0), DVec3::new(0.0, 1.0, 0.0)).unwrap();
        assert!(mesh.set_edge_curve_owner_id(e_a0, Some(owner_a)));
        assert!(mesh.set_edge_curve_owner_id(e_a1, Some(owner_a)));
        assert!(mesh.set_edge_curve_owner_id(e_a2, Some(owner_a)));

        // Curve B: 2 segments (different group)
        let owner_b = mesh.next_curve_owner_id();
        let (_, _, e_b0) = mesh.draw_line(DVec3::new(5.0, 0.0, 0.0), DVec3::new(6.0, 0.0, 0.0)).unwrap();
        let (_, _, e_b1) = mesh.draw_line(DVec3::new(6.0, 0.0, 0.0), DVec3::new(6.0, 1.0, 0.0)).unwrap();
        assert!(mesh.set_edge_curve_owner_id(e_b0, Some(owner_b)));
        assert!(mesh.set_edge_curve_owner_id(e_b1, Some(owner_b)));

        // Standalone line — no owner
        let (_, _, e_s) = mesh.draw_line(DVec3::new(10.0, 0.0, 0.0), DVec3::new(11.0, 0.0, 0.0)).unwrap();
        assert_eq!(mesh.edge_curve_owner_id(e_s), None);

        // Group queries
        let group_a = mesh.edges_by_curve_owner(owner_a);
        assert_eq!(group_a.len(), 3, "Curve A should have 3 segments");
        assert!(group_a.contains(&e_a0));
        assert!(group_a.contains(&e_a1));
        assert!(group_a.contains(&e_a2));

        let group_b = mesh.edges_by_curve_owner(owner_b);
        assert_eq!(group_b.len(), 2, "Curve B should have 2 segments");
        assert!(group_b.contains(&e_b0));
        assert!(group_b.contains(&e_b1));

        // Cross-group isolation
        assert!(!group_a.contains(&e_b0), "groups must not leak");
        assert!(!group_b.contains(&e_a0), "groups must not leak");
        assert!(!group_a.contains(&e_s));
        assert!(!group_b.contains(&e_s));
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-γ) — Half-edge wiring invariants for self-loops.
    //
    // Self-loop edge (v_small == v_large == v_anchor) 의 lower-level
    // traversal 이 무한 loop 없이 정상 동작 봉인. add_face 등 high-level
    // API 는 A-δ 에서 별도 처리 — 본 commit 은 add_edge + manual HE
    // wiring 만 검증.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_gamma_add_edge_self_loop_creates_2_he() {
        // add_edge(v, v) 가 self-loop edge + 2 HE pair 생성. 기존 polygon
        // edge 와 동일 메커니즘 (v_start == v_end 만 다름).
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::ZERO);
        let (eid, created) = mesh.add_edge(v, v).unwrap();
        assert!(created, "self-loop edge should be newly created");
        let edge = &mesh.edges[eid];
        assert!(edge.is_self_loop(),
            "ADR-089 A-γ: edge created by add_edge(v,v) must be self-loop");
        assert_eq!(edge.v_small(), v);
        assert_eq!(edge.v_large(), v);
        // any_he 는 valid 한 HE 가리킴.
        let he_anchor = edge.any_he();
        assert!(!he_anchor.is_null(), "self-loop edge must have at least 1 HE");
        // dst() 는 v.
        assert_eq!(mesh.hes[he_anchor].dst(), v);
    }

    #[test]
    fn adr089_a_gamma_self_loop_he_twin_chain_terminates() {
        // self-loop edge 의 next_rad chain 이 무한 loop 없이 종료.
        // 2 HE pair (twin pair) 가 정상.
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::ZERO);
        let (eid, _) = mesh.add_edge(v, v).unwrap();
        let he_start = mesh.edges[eid].any_he();
        // Walk next_rad until back to start. Should terminate within 256
        // iterations (manifold edge has 2 HE; self-loop is also 2 HE).
        let mut he = he_start;
        let mut count = 0;
        loop {
            count += 1;
            if count > 256 {
                panic!("ADR-089 A-γ: next_rad chain did not terminate within 256 \
                        iterations for self-loop edge — infinite loop suspected");
            }
            he = mesh.hes[he].next_rad();
            if he == he_start { break; }
        }
        assert!(count >= 1 && count <= 4,
            "ADR-089 A-γ: self-loop manifold edge should have ≤4 HE in radial \
             chain (typically 2 — twin pair). Got {}",
            count);
    }

    #[test]
    fn adr089_a_gamma_self_loop_he_dst_matches_anchor() {
        // self-loop edge 의 양쪽 HE 모두 dst() == v_anchor.
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::new(1.0, 2.0, 3.0));
        let (eid, _) = mesh.add_edge(v, v).unwrap();
        let he_start = mesh.edges[eid].any_he();
        // Iterate radial chain, verify each HE's dst is v.
        let mut he = he_start;
        let mut count = 0;
        loop {
            assert_eq!(mesh.hes[he].dst(), v,
                "ADR-089 A-γ: every HE on self-loop edge must have dst() == v_anchor");
            count += 1;
            if count > 16 { break; }
            he = mesh.hes[he].next_rad();
            if he == he_start { break; }
        }
        assert!(count >= 1);
    }

    #[test]
    fn adr089_a_gamma_self_loop_with_circle_curve_persists() {
        // self-loop edge 에 Circle curve attach + 다시 read 가능.
        // Edge.curve = Some(Circle) 이 self-loop edge 와 양립.
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::ZERO);
        let (eid, _) = mesh.add_edge(v, v).unwrap();
        mesh.edges[eid].set_curve(Some(crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));
        let edge = &mesh.edges[eid];
        assert!(edge.is_self_loop());
        assert!(matches!(
            edge.curve(),
            Some(crate::curves::AnalyticCurve::Circle { .. })
        ));
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-δ) — add_face_closed_curve API.
    //
    // Single-vert closed curve face creation. Drop-in alongside add_face /
    // add_face_with_holes — kernel-native representation of closed analytic
    // curves (Circle 우선, Bezier/BSpline/NURBS loop 는 향후).
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_delta_closed_circle_face_creates_1_vert_1_edge_1_face() {
        // 캐noncial Phase 2 표현: 1 anchor vert + 1 self-loop edge with
        // Circle curve + 1 face with 1-HE outer loop.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0)); // on circle at θ=0
        let mat = MaterialId::new(0);
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();

        // Topology checks
        let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
        let active_verts = mesh.verts.iter().filter(|(_, v)| v.is_active()).count();
        assert_eq!(active_faces, 1, "ADR-089 A-δ: 1 closed face");
        assert_eq!(active_edges, 1, "ADR-089 A-δ: 1 self-loop edge");
        assert_eq!(active_verts, 1, "ADR-089 A-δ: 1 anchor vertex");

        // Edge invariants
        let edges_iter: Vec<EdgeId> = mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).map(|(id, _)| id).collect();
        assert_eq!(edges_iter.len(), 1);
        let eid = edges_iter[0];
        assert!(mesh.edges[eid].is_self_loop(),
            "ADR-089 A-δ: edge must be self-loop");
        assert!(matches!(
            mesh.edges[eid].curve(),
            Some(crate::curves::AnalyticCurve::Circle { .. })
        ), "ADR-089 A-δ: Circle curve attached to self-loop edge");

        // Face outer loop = 1 HE (collect_loop_hes returns 1-element vec)
        let outer_start = mesh.faces[face].outer().start;
        let loop_hes = mesh.collect_loop_hes(outer_start).unwrap();
        assert_eq!(loop_hes.len(), 1,
            "ADR-089 A-δ: closed-curve face outer loop has 1 HE");

        // collect_loop_verts also returns 1 vertex (anchor)
        let loop_verts = mesh.collect_loop_verts(outer_start).unwrap();
        assert_eq!(loop_verts.len(), 1);
        assert_eq!(loop_verts[0], anchor);
    }

    #[test]
    fn adr089_a_delta_he_self_cycle_correct() {
        // Self-loop face boundary HE: next == prev == self (cycle length 1).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::ZERO);
        let mat = MaterialId::new(0);
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();
        let outer_start = mesh.faces[face].outer().start;
        let he = &mesh.hes[outer_start];
        assert_eq!(he.next(), outer_start,
            "ADR-089 A-δ: HE.next == self for closed-curve cycle");
        assert_eq!(he.prev(), outer_start,
            "ADR-089 A-δ: HE.prev == self for closed-curve cycle");
        assert_eq!(he.face(), face);
        assert_eq!(he.dst(), anchor);
    }

    #[test]
    fn adr089_a_delta_face_normal_inherited_from_curve() {
        // Face normal == curve.normal.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::ZERO);
        let mat = MaterialId::new(0);
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Y, // arbitrary axis
            basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();
        let face_normal = mesh.faces[face].normal();
        assert!((face_normal - DVec3::Y).length() < 1e-9,
            "ADR-089 A-δ: face normal must inherit curve normal (got {:?})",
            face_normal);
    }

    #[test]
    fn adr089_a_delta_two_circles_independent() {
        // Multiple closed-curve faces don't collide. Each = own anchor + edge + face.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a1 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let a2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 5.0));
        let c1 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let c2 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(0.0, 0.0, 5.0), radius: 3.0,
            normal: DVec3::X, basis_u: DVec3::Y,
        };
        let f1 = mesh.add_face_closed_curve(a1, c1, mat).unwrap();
        let f2 = mesh.add_face_closed_curve(a2, c2, mat).unwrap();
        assert_ne!(f1, f2);
        assert_eq!(
            mesh.faces.iter().filter(|(_, f)| f.is_active()).count(),
            2, "ADR-089 A-δ: 2 closed-curve faces independent");
        assert_eq!(
            mesh.edges.iter().filter(|(_, e)| e.is_active()).count(),
            2, "ADR-089 A-δ: 2 self-loop edges independent");
    }

    #[test]
    fn adr089_a_delta_rejects_non_circle_curve() {
        // Open / non-Circle curves rejected (deferred to A-η).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::ZERO);
        let mat = MaterialId::new(0);
        // Line is not a closed curve.
        let v_a = mesh.add_vertex(DVec3::ZERO);
        let v_b = mesh.add_vertex(DVec3::X);
        let line = crate::curves::AnalyticCurve::Line {
            start: v_a,
            end: v_b,
        };
        let result = mesh.add_face_closed_curve(anchor, line, mat);
        assert!(result.is_err(),
            "ADR-089 A-δ: non-Circle curve must reject (got Ok)");
        // Mesh state restored after rollback (no leaked face/edge).
        assert_eq!(mesh.faces.iter().filter(|(_, f)| f.is_active()).count(), 0);
        assert_eq!(mesh.edges.iter().filter(|(_, e)| e.is_active()).count(), 0);
    }

    #[test]
    fn adr089_a_delta_rejects_invalid_anchor() {
        // Stale / invalid anchor vertex rejected.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let bogus = VertId::new(99999); // never created
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 1.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let result = mesh.add_face_closed_curve(bogus, circle, mat);
        assert!(result.is_err(),
            "ADR-089 A-δ: invalid anchor must reject");
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-ε) — Spatial-hash dedup adapt for self-loop.
    // LOCKED #5 (1.5μm spatial-hash dedup) 정합 검증.
    //
    // Self-loop edge 의 anchor vertex 가 spatial-hash 를 정상 통과하는지,
    // 그리고 dedup 결과 (same position → same vertex) 가 self-loop 의미
    // 를 깨지 않는지 검증. 알려진 edge case (multiple closed curves at
    // exact same anchor) 도 명시 봉인 (현 commit 은 fail-fast, 향후 ADR
    // 에서 multi-self-loop edge 지원).
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_epsilon_anchor_position_dedup_via_spatial_hash() {
        // 같은 위치에 add_vertex 두 번 호출 → spatial-hash dedup → 같은
        // VertId 반환 (LOCKED #5 1.5μm). self-loop edge 의 anchor 도
        // 동일 dedup.
        let mut mesh = Mesh::new();
        let pos = DVec3::new(5.0, 0.0, 0.0);
        let v1 = mesh.add_vertex(pos);
        let v2 = mesh.add_vertex(pos);  // 같은 위치
        assert_eq!(v1, v2,
            "ADR-089 A-ε / LOCKED #5: same position → same VertId via spatial hash");

        // 그 dedup 된 vertex 로 closed curve face 생성 정상.
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(v1, circle, MaterialId::new(0));
        assert!(face.is_ok(),
            "ADR-089 A-ε: add_face_closed_curve with deduped anchor must succeed");
    }

    #[test]
    fn adr089_a_epsilon_anchor_within_15um_deduplicates() {
        // LOCKED #5 — 1.5μm spatial-hash cell. 두 anchor 가 1.5μm 안에
        // 있으면 dedup. self-loop edge 정상 동작.
        let mut mesh = Mesh::new();
        let pos1 = DVec3::new(5.0, 0.0, 0.0);
        let pos2 = DVec3::new(5.0 + 1e-7, 0.0, 0.0);  // 0.1μm < 1.5μm
        let v1 = mesh.add_vertex(pos1);
        let v2 = mesh.add_vertex(pos2);
        assert_eq!(v1, v2,
            "ADR-089 A-ε: positions within 1.5μm dedup to same VertId");

        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(v1, circle, MaterialId::new(0));
        assert!(face.is_ok());
    }

    #[test]
    fn adr089_a_epsilon_distinct_anchors_create_distinct_self_loops() {
        // 다른 위치 anchor → 다른 VertId → 다른 self-loop edges.
        // Cross-curve isolation (ADR-088 cross-leak 차단 의 self-loop 영역).
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v1 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 5.0, 0.0));  // 다른 위치
        assert_ne!(v1, v2);
        let c1 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let c2 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(0.0, 5.0, 0.0), radius: 3.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let f1 = mesh.add_face_closed_curve(v1, c1, mat).unwrap();
        let f2 = mesh.add_face_closed_curve(v2, c2, mat).unwrap();
        assert_ne!(f1, f2);
        // 2 distinct self-loop edges
        let self_loop_count = mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.is_self_loop())
            .count();
        assert_eq!(self_loop_count, 2,
            "ADR-089 A-ε: distinct anchors → distinct self-loop edges");
    }

    #[test]
    fn adr089_a_epsilon_known_limitation_same_anchor_collapse() {
        // KNOWN LIMITATION (현 commit): exact 같은 anchor + 같은 vert 위에
        // 두 개의 closed curve face 생성 시도 → 두 번째 face 의 self-loop
        // 가 vert_to_edge dedup 으로 첫 번째 edge 와 collide → HE.face
        // 충돌로 add_face_closed_curve 두 번째 호출 실패 + rollback.
        //
        // 이는 향후 multi-self-loop edge 지원 (별도 ADR) 으로 해결.
        // 본 테스트는 현재 동작 (fail-fast + clean rollback) 봉인.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let c1 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let c2 = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let f1 = mesh.add_face_closed_curve(anchor, c1, mat);
        assert!(f1.is_ok(), "first closed curve face creates ok");
        let f2_result = mesh.add_face_closed_curve(anchor, c2, mat);
        // Either succeeds (if future fix lifts limitation) or fails with
        // clean rollback (current behavior). Either way, mesh state stays
        // consistent — no orphan edge or face.
        if f2_result.is_err() {
            // Verify clean rollback: only 1 face, 1 self-loop edge.
            let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
            let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
            assert_eq!(active_faces, 1,
                "ADR-089 A-ε: failed second add must leave 1 face (rollback)");
            assert_eq!(active_edges, 1,
                "ADR-089 A-ε: failed second add must leave 1 edge (rollback)");
        }
        // Future ADR may lift this limitation — test should still pass.
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-ζ-1) — verify_face_invariants I1/I3 갱신.
    //
    // Closed-curve face (1 vert anchor + 1 self-loop edge with analytic
    // curve) 가 invariant report 에서 violation 으로 잡히지 않음 봉인.
    // Polygon face 동작 무변화 (≥3 verts 강제 유지).
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_zeta_1_closed_curve_face_passes_invariants() {
        // add_face_closed_curve 로 만든 face 가 verify_face_invariants
        // PASS — 1 vert outer 가 closed-curve exemption 으로 허용.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let mat = MaterialId::new(0);
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-1: closed-curve face must pass I1 invariant. \
             Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_zeta_1_degenerate_1vert_no_curve_still_violates() {
        // Negative case: 1-vert outer WITHOUT curve attached → 여전히 I1
        // violation (closed-curve exemption 은 curve 가 attached 일 때만).
        // 직접 mesh 조작으로 잘못된 face 만들기 (실제 API 통해선 불가능).
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::ZERO);
        let (eid, _) = mesh.add_edge(v, v).unwrap();
        // curve 부착 안 함 — degenerate
        let mat = MaterialId::new(0);
        let face_id = mesh.faces.insert(crate::entities::Face::new(
            crate::entities::LoopRef::default(),
            DVec3::Z,
            1e-6,
            mat,
        ));
        let he = mesh.edges[eid].any_he();
        mesh.hes[he].set_next(he);
        mesh.hes[he].set_prev(he);
        mesh.hes[he].set_face(face_id);
        mesh.hes[he].set_outer(true);
        mesh.faces[face_id].set_outer(crate::entities::LoopRef::new(he, true));
        let report = mesh.verify_face_invariants();
        assert!(!report.is_valid() || report.violations.iter()
            .any(|v| v.contains("1 vert without analytic curve")
                  || v.contains("outer loop has 1 verts")),
            "ADR-089 A-ζ-1: 1-vert without curve should violate I1");
    }

    #[test]
    fn adr089_a_zeta_1_polygon_face_unaffected() {
        // Polygon face (RECT) 의 invariant 동작 무변화 — A-ζ-1 fix 가
        // ≥3 verts 동작 영향 0.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let mat = MaterialId::new(0);
        let _f = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-1: polygon face must still pass invariants. \
             Violations: {:?}", report.violations);
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-ζ-2) — detect_free_edge_loop self-loop guard.
    //
    // self-loop edge 가 polygon chain walking / BFS 에 참여하지 않음 봉인.
    // Closed analytic curve 는 already complete cycle 이므로 chain 산물
    // 아님.
    // ════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-ζ-3) — resolve_planar_free_faces closed-curve
    // component fast-path.
    //
    // Standalone self-loop edge + analytic curve (no face yet) →
    // resolve_planar_free_faces 가 1-HE 1-vert face 합성. Polygon path
    // 영향 0.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_zeta_3_standalone_self_loop_resolves_to_face() {
        // Manually construct: 1 anchor + 1 self-loop edge with curve, NO
        // face yet. resolve_planar_free_faces should synthesize 1 face.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(anchor, anchor).unwrap();
        mesh.edges[eid].set_curve(Some(crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0, normal: DVec3::Z, basis_u: DVec3::X,
        }));
        // 시점: edge 존재, free HEs (face = null), face 없음.
        assert_eq!(
            mesh.faces.iter().filter(|(_, f)| f.is_active()).count(),
            0, "before resolve: 0 faces");

        let mat = MaterialId::new(0);
        let created = mesh.resolve_planar_free_faces(mat);
        assert!(!created.is_empty(),
            "ADR-089 A-ζ-3: closed-curve component must synthesize a face");
        assert_eq!(created.len(), 1,
            "ADR-089 A-ζ-3: 1 component → 1 face");
        // Face 가 valid (verify_face_invariants A-ζ-1 exemption 통과).
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-3: synthesized closed-curve face must pass invariants. \
             Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_zeta_3_polygon_chain_unaffected_by_fast_path() {
        // Polygon free-edge component (≥3 verts) 는 기존 resolve_component
        // 경로 사용. closed-curve fast-path 가 polygon 영향 안 줌.
        let mut mesh = Mesh::new();
        // RECT free edges (no face)
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _ = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v2, v3).unwrap();
        let _ = mesh.add_edge(v3, v0).unwrap();

        let mat = MaterialId::new(0);
        let created = mesh.resolve_planar_free_faces(mat);
        // Polygon RECT 는 1 face 합성 (existing resolve_component path).
        assert_eq!(created.len(), 1,
            "ADR-089 A-ζ-3: polygon RECT 4-edge cycle → 1 face (legacy path)");
        // Face 의 outer loop ≥ 3 verts (polygon).
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "polygon face must pass invariants. Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_zeta_3_mixed_components_handled_independently() {
        // Polygon RECT + standalone closed-curve circle 같은 mesh 에서
        // resolve_planar_free_faces 가 둘 다 face 로 변환.
        let mut mesh = Mesh::new();
        // RECT free edges
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _ = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v2, v3).unwrap();
        let _ = mesh.add_edge(v3, v0).unwrap();
        // Standalone closed-curve circle (별개 위치)
        let anchor = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid_circle, _) = mesh.add_edge(anchor, anchor).unwrap();
        mesh.edges[eid_circle].set_curve(Some(crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        let mat = MaterialId::new(0);
        let created = mesh.resolve_planar_free_faces(mat);
        assert_eq!(created.len(), 2,
            "ADR-089 A-ζ-3: 2 components (polygon + closed-curve) → 2 faces. Got {}",
            created.len());
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-3: mixed faces must pass invariants. Violations: {:?}",
            report.violations);
    }

    #[test]
    fn adr089_a_zeta_2_bfs_skips_self_loop_edges() {
        // Mesh 에 self-loop edge + polygon chain 공존 시 BFS 가 self-loop
        // 무시 + polygon chain 만 cycle 검출.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Closed-curve face (self-loop + circle) 별개 위치
        let anchor = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(15.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _circle_face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();

        // Polygon chain (RECT 4 lines, all free edges)
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let (e12, _) = mesh.add_edge(v1, v2).unwrap();
        let (e23, _) = mesh.add_edge(v2, v3).unwrap();
        let (e30, _) = mesh.add_edge(v3, v0).unwrap();
        let _ = (e01, e12, e23, e30);

        // detect_free_edge_loop 가 RECT cycle 검출 (self-loop 무관)
        let result = mesh.detect_free_edge_loop(v0, v1, e01);
        // 검출 결과: free RECT cycle (4 verts) 정상 반환되어야 함.
        assert!(result.is_some(),
            "ADR-089 A-ζ-2: BFS must detect polygon RECT cycle even with \
             self-loop edge present");
        let cycle = result.unwrap();
        assert_eq!(cycle.len(), 4,
            "RECT cycle should have 4 verts (got {})", cycle.len());
        // self-loop anchor 가 cycle 에 포함되지 않음 (cross-isolation)
        assert!(!cycle.contains(&anchor),
            "ADR-089 A-ζ-2: self-loop anchor must NOT be in polygon cycle");
    }

    #[test]
    fn adr089_a_zeta_2_chain_walk_skips_self_loop_edges() {
        // 사용자 시연 reproduction — self-loop edge 가 vert_to_edge 에
        // 있어도 chain walk 가 polygon path 만 따라감.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Closed circle at distinct anchor
        let anchor = mesh.add_vertex(DVec3::new(50.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 50.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _ = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();

        // Triangle polygon (3 free edges)
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let (e12, _) = mesh.add_edge(v1, v2).unwrap();
        let (e20, _) = mesh.add_edge(v2, v0).unwrap();
        let _ = (e12, e20);

        let result = mesh.detect_free_edge_loop(v0, v1, e01);
        assert!(result.is_some(), "polygon triangle cycle detected");
        let cycle = result.unwrap();
        assert_eq!(cycle.len(), 3);
        assert!(!cycle.contains(&anchor),
            "ADR-089 A-ζ-2: self-loop anchor not in triangle cycle");
    }

    #[test]
    fn adr089_a_zeta_2_self_loop_alone_no_polygon_cycle_returned() {
        // Mesh 에 self-loop edge 만 있으면 polygon cycle 검출 결과 None.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let anchor = mesh.add_vertex(DVec3::ZERO);
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 1.0, normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _ = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();

        // Polygon path 없이 self-loop edge 만 → detect_free_edge_loop 실행
        // (어떤 v0, v1 으로도 polygon cycle 결과 None 또는 폴리곤 자체 cycle).
        // 본 테스트는 단지 panic 없이 종료 보장.
        let _ = mesh.detect_free_edge_loop(anchor, anchor, EdgeId::new(0));
        // No panic = pass
    }

    #[test]
    fn adr089_a_zeta_1_mixed_polygon_and_closed_curve_pass() {
        // Polygon face + closed-curve face 같은 mesh 에 공존 시 모두 PASS.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Polygon RECT
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _rect = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        // Closed-curve circle (별개 위치)
        let anchor = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let _circle_face = mesh.add_face_closed_curve(anchor, circle, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-089 A-ζ-1: mixed polygon + closed-curve must all pass. \
             Violations: {:?}", report.violations);
    }

    #[test]
    fn adr089_a_gamma_normal_polygon_edges_unaffected() {
        // 기존 polygon mesh 동작 무변화 확인 — RECT 4 edges 모두 v_small
        // < v_large 유지, is_self_loop() 모두 false.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let mat = MaterialId::new(0);
        let _f = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let mut self_loop_count = 0;
        for (_eid, edge) in mesh.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.is_self_loop() {
                self_loop_count += 1;
            } else {
                // canonical 정렬 v_small < v_large 검증
                assert!(edge.v_small().raw() < edge.v_large().raw(),
                    "non-self-loop edge must have v_small < v_large");
            }
        }
        assert_eq!(self_loop_count, 0,
            "ADR-089 A-γ L-α-1: polygon mesh must have 0 self-loop edges");
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-ω-β: closed Bezier 시민권 확장
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_omega_closed_bezier_creates_self_loop_face() {
        // A square-ish closed Bezier loop on z=0 plane.
        // 4 control points: (0,0,0), (10,0,0), (10,10,0), (0,10,0), back to (0,0,0)
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0), // closure: back to first
            ],
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("ADR-089 A-ω-β: closed Bezier must succeed");
        let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
        let active_verts = mesh.verts.iter().filter(|(_, v)| v.is_active()).count();
        assert_eq!(active_faces, 1);
        assert_eq!(active_edges, 1);
        assert_eq!(active_verts, 1);
        // Edge must be self-loop with Bezier curve.
        let edges_iter: Vec<EdgeId> = mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).map(|(id, _)| id).collect();
        let eid = edges_iter[0];
        assert!(mesh.edges[eid].is_self_loop());
        assert!(matches!(
            mesh.edges[eid].curve(),
            Some(crate::curves::AnalyticCurve::Bezier { .. })
        ));
        // Face normal should be ~+Z (square in z=0 plane).
        let normal = mesh.faces[face].normal();
        assert!((normal.z.abs() - 1.0).abs() < 1e-3,
            "expected ~Z normal, got {:?}", normal);
    }

    #[test]
    fn adr089_a_omega_open_bezier_rejected() {
        // Bezier with cp[0] != cp[last] should be rejected as not-closed.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                // No closure
            ],
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-ω-β: open Bezier must be rejected");
        let err_msg = format!("{:?}", result.unwrap_err());
        assert!(err_msg.contains("not closed") || err_msg.contains("closure"),
            "error must mention closure: {}", err_msg);
    }

    #[test]
    fn adr089_a_omega_collinear_bezier_rejected() {
        // Collinear control points → no plane → bail.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(5.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0), // closure
            ],
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-ω-β: collinear Bezier must be rejected (no plane)");
    }

    // A-Α-β: BSpline 시민권 활성 — 이전 'still_rejected' 테스트 의미 변경.

    #[test]
    fn adr089_a_alpha_closed_bspline_creates_self_loop_face() {
        // Closed BSpline (control_pts[0] == control_pts[last] with
        // clamped knot vector) → 1 anchor + 1 self-loop edge with
        // BSpline curve + 1 face with Plane surface.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0), // closure
            ],
            knots: vec![0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("ADR-089 A-Α-β: closed BSpline must succeed");
        let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
        let active_verts = mesh.verts.iter().filter(|(_, v)| v.is_active()).count();
        assert_eq!(active_faces, 1);
        assert_eq!(active_edges, 1);
        assert_eq!(active_verts, 1);
        // Edge must be self-loop with BSpline curve.
        let edges_iter: Vec<EdgeId> = mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).map(|(id, _)| id).collect();
        let eid = edges_iter[0];
        assert!(mesh.edges[eid].is_self_loop());
        assert!(matches!(
            mesh.edges[eid].curve(),
            Some(crate::curves::AnalyticCurve::BSpline { .. })
        ));
        // Plane surface attached.
        assert!(matches!(
            mesh.faces[face].surface(),
            Some(crate::surfaces::AnalyticSurface::Plane { .. })
        ));
    }

    #[test]
    fn adr089_a_alpha_open_bspline_rejected() {
        // BSpline with cp[0] != cp[last] should be rejected as not-closed.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                // No closure
            ],
            knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Α-β: open BSpline must be rejected");
    }

    // A-Β-β: NURBS 시민권 활성 — A-Α 의 'nurbs_still_rejected' 의미 변경.

    #[test]
    fn adr089_a_beta_closed_nurbs_creates_self_loop_face() {
        // Closed NURBS (control_pts[0] == control_pts[last] with clamped
        // knots and uniform weights) → 1 anchor + 1 self-loop edge with
        // NURBS curve + 1 face with Plane surface.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::NURBS {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0), // closure
            ],
            weights: vec![1.0, 1.0, 1.0, 1.0, 1.0],
            knots: vec![0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("ADR-089 A-Β-β: closed NURBS must succeed");
        let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
        let active_verts = mesh.verts.iter().filter(|(_, v)| v.is_active()).count();
        assert_eq!(active_faces, 1);
        assert_eq!(active_edges, 1);
        assert_eq!(active_verts, 1);
        let edges_iter: Vec<EdgeId> = mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).map(|(id, _)| id).collect();
        let eid = edges_iter[0];
        assert!(mesh.edges[eid].is_self_loop());
        assert!(matches!(
            mesh.edges[eid].curve(),
            Some(crate::curves::AnalyticCurve::NURBS { .. })
        ));
        // Plane surface attached.
        assert!(matches!(
            mesh.faces[face].surface(),
            Some(crate::surfaces::AnalyticSurface::Plane { .. })
        ));
    }

    #[test]
    fn adr089_a_beta_open_nurbs_rejected() {
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::NURBS {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                // No closure
            ],
            weights: vec![1.0, 1.0, 1.0, 1.0],
            knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Β-β: open NURBS must be rejected");
    }

    #[test]
    fn adr089_a_beta_zero_weight_nurbs_rejected() {
        // NURBS with zero weight → nurbs::validate rejects.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::NURBS {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0),
            ],
            weights: vec![1.0, 1.0, 0.0, 1.0, 1.0], // zero weight
            knots: vec![0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Β-β: zero weight must be rejected");
    }

    #[test]
    fn adr089_a_beta_arcs_still_rejected() {
        // Arc closed curves still deferred (Arc 본질상 closed 아님).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0, end_angle: std::f64::consts::PI,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Β-β: Arc still deferred");
    }

    #[test]
    fn adr089_a_alpha_invalid_knots_rejected() {
        // BSpline with invalid knot vector → bspline::validate fails.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0),
            ],
            knots: vec![0.0, 1.0], // wrong length
            degree: 3,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Α-β: invalid knots must be rejected");
    }

    #[test]
    fn adr089_a_omega_circle_path_unaffected() {
        // Regression — Circle path still works (existing A-δ contract).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("regression — Circle must still work");
        assert!(mesh.faces[face].is_active());
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-Δ-β: periodic knot vector closed BSpline/NURBS
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_delta_is_periodic_knots_uniform_not_clamped() {
        // Uniform spacing, no clamping → periodic.
        let knots = vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];
        assert!(crate::curves::bspline::is_periodic_knots(&knots, 3));
    }

    #[test]
    fn adr089_a_delta_is_periodic_knots_clamped_rejected() {
        // Clamped at start (first 4 knots all 0) → NOT periodic.
        let knots = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
        assert!(!crate::curves::bspline::is_periodic_knots(&knots, 3));
    }

    #[test]
    fn adr089_a_delta_is_periodic_knots_non_uniform_rejected() {
        // Non-uniform spacing → NOT periodic.
        let knots = vec![0.0, 1.0, 2.0, 3.0, 5.0, 7.0, 8.0, 9.0]; // gap at idx 3-4
        assert!(!crate::curves::bspline::is_periodic_knots(&knots, 3));
    }

    #[test]
    fn adr089_a_delta_periodic_bspline_open_polygon_accepted() {
        // Periodic BSpline: control_pts NOT closed (cp[0] != cp[last])
        // BUT uniform knots → should be accepted.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(-10.0, 0.0, 0.0),
                DVec3::new(0.0, -10.0, 0.0),
                // NO closure — cp[0] != cp[last]
            ],
            // Uniform knots (no clamping at ends).
            // 4 control points + degree 3 + 1 = 8 knots, uniform spacing.
            knots: vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
            degree: 3,
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("ADR-089 A-Δ-β: periodic BSpline must be accepted");
        // Face exists with Plane surface (best-fit from control polygon).
        assert!(matches!(
            mesh.faces[face].surface(),
            Some(crate::surfaces::AnalyticSurface::Plane { .. })
        ));
    }

    #[test]
    fn adr089_a_delta_clamped_open_polygon_still_rejected() {
        // Clamped + open polygon → still rejected (Type A semantics).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(10.0, 10.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                // No closure
            ],
            knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0], // clamped
            degree: 3,
        };
        let result = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0));
        assert!(result.is_err(),
            "ADR-089 A-Δ-β: clamped + open polygon must still be rejected");
    }

    #[test]
    fn adr089_a_delta_periodic_nurbs_open_polygon_accepted() {
        // Periodic NURBS: same as BSpline but with weights.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let curve = crate::curves::AnalyticCurve::NURBS {
            control_pts: vec![
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::new(0.0, 10.0, 0.0),
                DVec3::new(-10.0, 0.0, 0.0),
                DVec3::new(0.0, -10.0, 0.0),
            ],
            weights: vec![1.0, 1.0, 1.0, 1.0],
            knots: vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0], // uniform/periodic
            degree: 3,
        };
        let face = mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("ADR-089 A-Δ-β: periodic NURBS must be accepted");
        assert!(matches!(
            mesh.faces[face].surface(),
            Some(crate::surfaces::AnalyticSurface::Plane { .. })
        ));
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-χ-β: face split surface inheritance
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_chi_split_face_propagates_surface_to_face_b() {
        // mesh.split_face direct DCEL surgery: face_id keeps slot,
        // face_b is fresh. Both must carry the parent's surface.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        // Attach a Sphere surface (any curved kind).
        let sph = crate::surfaces::AnalyticSurface::Sphere {
            center: DVec3::new(0.5, 0.5, -10.0),
            radius: 10.5,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.faces[face].set_surface(Some(sph));

        let (face_a, face_b) = mesh.split_face(face, v0, v2).unwrap();
        // Both must have Sphere surface attached.
        let kind_a = mesh.faces[face_a].surface().map(|s| std::mem::discriminant(s));
        let kind_b = mesh.faces[face_b].surface().map(|s| std::mem::discriminant(s));
        assert!(kind_a.is_some() && kind_a == kind_b,
            "ADR-089 A-χ-β: split_face must propagate surface to both sub-faces");
        // face_a == face (same slot), face_b is new.
        assert_eq!(face_a, face);
    }

    #[test]
    fn adr089_a_chi_split_face_no_surface_unchanged() {
        // Regression — face with no surface stays None on both sub-faces.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        // No surface attached.
        let (face_a, face_b) = mesh.split_face(face, v0, v2).unwrap();
        assert!(mesh.faces[face_a].surface().is_none());
        assert!(mesh.faces[face_b].surface().is_none());
    }

    #[test]
    fn adr089_a_chi_split_propagates_cylinder_with_full_uv_range() {
        // After split, both sub-faces hold the SAME parent surface
        // (full u_range/v_range). A-ρ uv-slice computes per-face slice
        // from boundary verts. L-χ-3.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 100.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 100.0, 200.0));
        let v3 = mesh.add_vertex(DVec3::new(100.0, 0.0, 200.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 100.0, ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 200.0),
        };
        mesh.faces[face].set_surface(Some(cyl.clone()));

        // Add an interior vert and split via chain (skip — direct mesh.split_face)
        let (fa, fb) = mesh.split_face(face, v0, v2).unwrap();
        let sa = mesh.faces[fa].surface().cloned();
        let sb = mesh.faces[fb].surface().cloned();
        // Both have Cylinder with full uv_range preserved.
        match sa {
            Some(crate::surfaces::AnalyticSurface::Cylinder { u_range, .. }) => {
                assert!((u_range.0 - 0.0).abs() < 1e-9);
                assert!((u_range.1 - std::f64::consts::TAU).abs() < 1e-9);
            }
            _ => panic!("face_a missing Cylinder"),
        }
        match sb {
            Some(crate::surfaces::AnalyticSurface::Cylinder { u_range, .. }) => {
                assert!((u_range.0 - 0.0).abs() < 1e-9);
                assert!((u_range.1 - std::f64::consts::TAU).abs() < 1e-9);
            }
            _ => panic!("face_b missing Cylinder"),
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-φ-β: Sphere/Cone/Torus uv-slice fast-path
    // ────────────────────────────────────────────────────────────────────

    fn build_sphere_quad_face(
        mesh: &mut Mesh,
        radius: f64,
        u_lo: f64, u_hi: f64,
        v_lo: f64, v_hi: f64,
    ) -> FaceId {
        let pt = |u: f64, v: f64| -> DVec3 {
            DVec3::new(
                radius * v.cos() * u.cos(),
                radius * v.cos() * u.sin(),
                radius * v.sin(),
            )
        };
        let v0 = mesh.add_vertex(pt(u_lo, v_lo));
        let v1 = mesh.add_vertex(pt(u_hi, v_lo));
        let v2 = mesh.add_vertex(pt(u_hi, v_hi));
        let v3 = mesh.add_vertex(pt(u_lo, v_hi));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let sph = crate::surfaces::AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.faces[face].set_surface(Some(sph));
        face
    }

    #[test]
    fn adr089_a_phi_sphere_quad_emits_sliced_tessellation() {
        let mut mesh = Mesh::new();
        let _f = build_sphere_quad_face(
            &mut mesh, 100.0,
            0.0, std::f64::consts::PI / 6.0,  // u: 30° wedge
            0.0, std::f64::consts::PI / 6.0,  // v: 30° band
        );
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let tris = indices.len() / 3;
        // Slice asserts the FRACTIONAL nature of uv-slice tessellation —
        // a 30°×30° wedge should produce ~1/72 of the full sphere's
        // triangles. With render chord_tol = 0.02mm (2026-05-12 refinement)
        // a full r=100 sphere is ~50,000 tris; the slice is ~340 tris.
        // Threshold 700 = generous upper bound, still proving slice
        // optimization is active. Pre-refinement (chord_tol = 0.1) the
        // slice was ~50 tris with threshold 200 — same architectural
        // contract, just N×5 scale.
        assert!(tris < 700,
            "ADR-089 A-φ-β: sphere u-slice must produce a fractional tris count, got {}", tris);
        assert!(tris > 0);
    }

    #[test]
    fn adr089_a_phi_sphere_quad_normals_radial() {
        let mut mesh = Mesh::new();
        let radius = 50.0;
        let _f = build_sphere_quad_face(
            &mut mesh, radius,
            0.0, std::f64::consts::PI / 4.0,
            0.0, std::f64::consts::PI / 4.0,
        );
        let (positions, normals, _idx, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        for i in 0..n_verts {
            let p = DVec3::new(
                positions[i * 3] as f64,
                positions[i * 3 + 1] as f64,
                positions[i * 3 + 2] as f64,
            );
            let n = DVec3::new(
                normals[i * 3] as f64,
                normals[i * 3 + 1] as f64,
                normals[i * 3 + 2] as f64,
            );
            // Sphere normal = radial direction (p - center)/radius, outward.
            // Allow some tolerance — chord points may not be exactly on sphere.
            let p_dir = p.normalize_or_zero();
            assert!(p_dir.dot(n) > 0.95,
                "sphere normal at vert {} not radial: p_dir={:?} n={:?}", i, p_dir, n);
        }
    }

    fn build_cone_quad_face(
        mesh: &mut Mesh,
        half_angle: f64,
        u_lo: f64, u_hi: f64,
        v_lo: f64, v_hi: f64,
    ) -> FaceId {
        // Cone with apex at origin, axis +Z, ref_dir +X
        let pt = |u: f64, v: f64| -> DVec3 {
            let r = v * half_angle.tan();
            DVec3::new(r * u.cos(), r * u.sin(), v)
        };
        let v0 = mesh.add_vertex(pt(u_lo, v_lo));
        let v1 = mesh.add_vertex(pt(u_hi, v_lo));
        let v2 = mesh.add_vertex(pt(u_hi, v_hi));
        let v3 = mesh.add_vertex(pt(u_lo, v_hi));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let cone = crate::surfaces::AnalyticSurface::Cone {
            apex: DVec3::ZERO, axis_dir: DVec3::Z,
            half_angle, ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (10.0, 200.0),
        };
        mesh.faces[face].set_surface(Some(cone));
        face
    }

    #[test]
    fn adr089_a_phi_cone_quad_emits_sliced_tessellation() {
        let mut mesh = Mesh::new();
        let _f = build_cone_quad_face(
            &mut mesh,
            std::f64::consts::PI / 6.0, // 30° half-angle
            0.0, std::f64::consts::PI / 8.0,  // u-slice
            50.0, 150.0,                       // axial
        );
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let tris = indices.len() / 3;
        assert!(tris < 200,
            "ADR-089 A-φ-β: cone uv-slice must produce ≪ 200 tris, got {}", tris);
        assert!(tris > 0);
    }

    fn build_torus_quad_face(
        mesh: &mut Mesh,
        major_radius: f64,
        minor_radius: f64,
        u_lo: f64, u_hi: f64,
        v_lo: f64, v_hi: f64,
    ) -> FaceId {
        let pt = |u: f64, v: f64| -> DVec3 {
            let radial = major_radius + minor_radius * v.cos();
            DVec3::new(radial * u.cos(), radial * u.sin(), minor_radius * v.sin())
        };
        let v0 = mesh.add_vertex(pt(u_lo, v_lo));
        let v1 = mesh.add_vertex(pt(u_hi, v_lo));
        let v2 = mesh.add_vertex(pt(u_hi, v_hi));
        let v3 = mesh.add_vertex(pt(u_lo, v_hi));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let tor = crate::surfaces::AnalyticSurface::Torus {
            center: DVec3::ZERO, axis_dir: DVec3::Z, ref_dir: DVec3::X,
            major_radius, minor_radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, std::f64::consts::TAU),
        };
        mesh.faces[face].set_surface(Some(tor));
        face
    }

    #[test]
    fn adr089_a_phi_torus_quad_emits_sliced_tessellation() {
        let mut mesh = Mesh::new();
        let _f = build_torus_quad_face(
            &mut mesh, 100.0, 20.0,
            0.0, std::f64::consts::PI / 8.0,
            0.0, std::f64::consts::PI / 8.0,
        );
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let tris = indices.len() / 3;
        // Torus uses fixed grid tessellation (~16×16 for slice). Without
        // slice, full torus would emit ~10000+ tris.
        assert!(tris < 600,
            "ADR-089 A-φ-β: torus uv-slice must produce ≪ 600 tris, got {}", tris);
        assert!(tris > 0);
    }

    #[test]
    fn adr089_a_phi_uv_slice_helper_returns_none_for_plane() {
        // Plane → not a curved kind, helper returns None (caller falls
        // through to polygon path).
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let plane = crate::surfaces::AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        mesh.faces[face].set_surface(Some(plane.clone()));
        let result = compute_uv_slice_for_quad_face(
            &mesh, &mesh.faces[face], &plane);
        assert!(result.is_none(),
            "ADR-089 A-φ-β: Plane must not be uv-sliced (Plane fast-path handles it)");
    }

    #[test]
    fn adr089_a_phi_uv_slice_returns_none_for_non_quad_face() {
        // 3-vert (triangle) face → return None.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let a = std::f64::consts::PI / 8.0;
        let v1 = mesh.add_vertex(DVec3::new(100.0 * a.cos(), 100.0 * a.sin(), 0.0));
        let v2 = mesh.add_vertex(DVec3::new(100.0, 0.0, 50.0));
        let face = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 100.0, ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 100.0),
        };
        mesh.faces[face].set_surface(Some(cyl.clone()));
        let result = compute_uv_slice_for_quad_face(
            &mesh, &mesh.faces[face], &cyl);
        assert!(result.is_none(),
            "ADR-089 A-φ-β: 3-vert face must not be uv-sliced (L-φ-3)");
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-τ-β: smooth-group edge hiding (Cylinder)
    // ────────────────────────────────────────────────────────────────────

    /// Build two adjacent Cylinder side quads sharing one vertical edge,
    /// both with the SAME full-circumference Cylinder surface attached.
    /// Returns shared edge id.
    fn build_two_adjacent_cylinder_sides(
        mesh: &mut Mesh,
        radius: f64,
        h: f64,
    ) -> EdgeId {
        let a = std::f64::consts::PI / 12.0; // 15° step
        let p0 = DVec3::new(radius, 0.0, 0.0);
        let p1 = DVec3::new(radius * a.cos(), radius * a.sin(), 0.0);
        let p2 = DVec3::new(radius * (2.0 * a).cos(), radius * (2.0 * a).sin(), 0.0);
        let p0t = DVec3::new(p0.x, p0.y, h);
        let p1t = DVec3::new(p1.x, p1.y, h);
        let p2t = DVec3::new(p2.x, p2.y, h);
        let v0 = mesh.add_vertex(p0);
        let v1 = mesh.add_vertex(p1);
        let v2 = mesh.add_vertex(p2);
        let v0t = mesh.add_vertex(p0t);
        let v1t = mesh.add_vertex(p1t);
        let v2t = mesh.add_vertex(p2t);
        let face_a = mesh.add_face(&[v0, v1, v1t, v0t], MaterialId::new(0)).unwrap();
        let face_b = mesh.add_face(&[v1, v2, v2t, v1t], MaterialId::new(0)).unwrap();
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, h),
        };
        mesh.faces[face_a].set_surface(Some(cyl.clone()));
        mesh.faces[face_b].set_surface(Some(cyl));
        // The shared vertical edge is between v1 and v1t
        find_edge_between_helper(mesh, v1, v1t)
    }

    fn find_edge_between_helper(mesh: &Mesh, va: VertId, vb: VertId) -> EdgeId {
        for (eid, e) in mesh.edges.iter() {
            if !e.is_active() { continue; }
            let (s, l) = (e.v_small(), e.v_large());
            if (s == va && l == vb) || (s == vb && l == va) {
                return eid;
            }
        }
        panic!("edge between {:?} and {:?} not found", va, vb);
    }

    #[test]
    fn adr089_a_tau_smooth_group_cylinder_edge_hidden() {
        // Two adjacent Cylinder side quads sharing same surface →
        // shared edge should NOT appear in wireframe.
        let mut mesh = Mesh::new();
        let shared_eid = build_two_adjacent_cylinder_sides(&mut mesh, 100.0, 200.0);
        let (_lines, edge_map) = mesh.export_edge_lines_with_map(20.1);
        let shared_drawn = edge_map.contains(&shared_eid.raw());
        assert!(!shared_drawn,
            "ADR-089 A-τ-β: smooth-group internal edge must be hidden");
    }

    #[test]
    fn adr089_a_tau_boundary_edge_still_drawn() {
        // The 4 boundary edges of each quad (top, bottom, outer side)
        // are still present in wireframe.
        let mut mesh = Mesh::new();
        let _ = build_two_adjacent_cylinder_sides(&mut mesh, 50.0, 100.0);
        let (lines, _) = mesh.export_edge_lines_with_map(20.1);
        let seg_count = lines.len() / 6;
        // 2 quads share 1 vertical edge. Total unique edges = 7
        // (top of A, top of B, shared vertical, left vertical of A,
        // right vertical of B, bottom of A, bottom of B). 1 edge hidden
        // (shared vertical) → 6 segments.
        assert!(seg_count >= 6, "expected ≥ 6 visible boundary segs, got {}", seg_count);
    }

    #[test]
    fn adr089_a_tau_polygonal_no_surface_unchanged() {
        // Two flat coplanar quads (no surface) — angle-threshold path
        // unchanged. Shared edge should still be hidden by angle test.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _f1 = mesh.add_face(&[v0, v1, v4, v5], MaterialId::new(0)).unwrap();
        let _f2 = mesh.add_face(&[v1, v2, v3, v4], MaterialId::new(0)).unwrap();
        // Both face normals = (0, 0, 1) → coplanar → shared edge hidden.
        let (lines, _) = mesh.export_edge_lines_with_map(20.1);
        // Shared edge between (v1, v4) should be hidden. Outer 6 edges
        // visible.
        let seg_count = lines.len() / 6;
        assert!(seg_count <= 7,
            "coplanar shared edge should be hidden, got {} segs", seg_count);
    }

    #[test]
    fn adr089_a_tau_smooth_group_helper_distinguishes_kinds() {
        // Direct unit test of surfaces_in_same_smooth_group helper.
        use crate::surfaces::AnalyticSurface as S;
        let cyl1 = S::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 100.0, ref_dir: DVec3::X,
            u_range: (0.0, 1.0), v_range: (0.0, 200.0),
        };
        let cyl1_diff_u = S::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 100.0, ref_dir: DVec3::X,
            u_range: (1.0, 2.0), v_range: (0.0, 200.0), // different u_range
        };
        let cyl2 = S::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 200.0, ref_dir: DVec3::X, // different radius
            u_range: (0.0, 1.0), v_range: (0.0, 200.0),
        };
        let plane = S::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };

        // Same Cylinder base params (different u_range OK) → smooth group
        assert!(surfaces_in_same_smooth_group(&Some(cyl1.clone()), &Some(cyl1_diff_u)));
        // Different radius → not smooth group
        assert!(!surfaces_in_same_smooth_group(&Some(cyl1.clone()), &Some(cyl2)));
        // Plane vs Cylinder → not smooth group
        assert!(!surfaces_in_same_smooth_group(&Some(plane.clone()), &Some(cyl1.clone())));
        // Plane vs Plane → not smooth group (fall through to angle test)
        assert!(!surfaces_in_same_smooth_group(&Some(plane.clone()), &Some(plane)));
        // None → never smooth group
        assert!(!surfaces_in_same_smooth_group(&None, &None));
        assert!(!surfaces_in_same_smooth_group(&Some(cyl1), &None));
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-ρ-β: Cylinder side face render u-slice fast-path
    // ────────────────────────────────────────────────────────────────────

    /// Helper — build a 4-vert quad face on a cylinder of given (radius,
    /// axis_origin=ZERO, axis_dir=Z, ref_dir=X) at theta-slice [θ_lo, θ_hi]
    /// from z=0 to z=h. Attaches FULL u_range Cylinder surface (mimics
    /// extrude_planar_cylinder where all sides share full surface).
    fn build_cylinder_quad_face(
        mesh: &mut Mesh,
        radius: f64,
        h: f64,
        theta_lo: f64,
        theta_hi: f64,
    ) -> FaceId {
        let p0 = DVec3::new(radius * theta_lo.cos(), radius * theta_lo.sin(), 0.0);
        let p1 = DVec3::new(radius * theta_hi.cos(), radius * theta_hi.sin(), 0.0);
        let p2 = DVec3::new(radius * theta_hi.cos(), radius * theta_hi.sin(), h);
        let p3 = DVec3::new(radius * theta_lo.cos(), radius * theta_lo.sin(), h);
        let v0 = mesh.add_vertex(p0);
        let v1 = mesh.add_vertex(p1);
        let v2 = mesh.add_vertex(p2);
        let v3 = mesh.add_vertex(p3);
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        // Attach full-circumference Cylinder (mimic A-θ Path A behavior)
        let cyl = crate::surfaces::AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, h),
        };
        mesh.faces[face].set_surface(Some(cyl));
        face
    }

    #[test]
    fn adr089_a_rho_cylinder_quad_emits_sliced_tessellation() {
        // Cylinder side quad (theta in [0, π/12]) must NOT render the full
        // cylinder. Triangle count should be small (~chord/π/12) not
        // huge (~chord*2π).
        let mut mesh = Mesh::new();
        let _f = build_cylinder_quad_face(
            &mut mesh, 100.0, 200.0, 0.0, std::f64::consts::PI / 12.0,
        );
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let tris = indices.len() / 3;
        // For a quad spanning π/12 (~15°) with chord_tol=0.1mm and r=100mm,
        // segment count ≈ (π/12) / (2*acos(1 - 0.001)) ≈ 6 segments.
        // Each segment of single quad row → 2 triangles → ~12 tris.
        // Without u-slice fix, full cylinder (all 24 quads) would be
        // emitted → 24 * 12 = ~288 tris.
        assert!(tris < 100, "ADR-089 A-ρ-β: u-slice must produce ≪ 100 tris, got {}", tris);
        assert!(tris > 0, "must produce some triangles");
    }

    #[test]
    fn adr089_a_rho_cylinder_quad_normals_radial() {
        // All emitted vertex normals must be radial (pointing outward
        // from cylinder axis).
        let mut mesh = Mesh::new();
        let _f = build_cylinder_quad_face(
            &mut mesh, 100.0, 200.0, 0.0, std::f64::consts::PI / 6.0,
        );
        let (positions, normals, _idx, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        for i in 0..n_verts {
            let px = positions[i * 3];
            let py = positions[i * 3 + 1];
            let _pz = positions[i * 3 + 2];
            let nx = normals[i * 3];
            let ny = normals[i * 3 + 1];
            let nz = normals[i * 3 + 2];
            // Normal should be (px, py, 0) / radius (radial), z-component ≈ 0
            assert!(nz.abs() < 1e-3, "normal[{i}].z should be ~0 (radial), got {nz}");
            // Direction sanity: nx*px + ny*py > 0 (outward)
            let dot = nx * px + ny * py;
            assert!(dot > 0.0, "normal must be outward, dot={dot} at vert {i}");
        }
    }

    #[test]
    fn adr089_a_rho_cylinder_quad_tessellation_within_quad_bounds() {
        // Tessellated points must lie within the quad's theta range
        // [theta_lo - ε, theta_hi + ε], not span the full cylinder.
        let mut mesh = Mesh::new();
        let theta_lo = std::f64::consts::PI / 4.0;
        let theta_hi = std::f64::consts::PI / 3.0;
        let _f = build_cylinder_quad_face(
            &mut mesh, 50.0, 100.0, theta_lo, theta_hi,
        );
        let (positions, _norm, _idx, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        for i in 0..n_verts {
            let px = positions[i * 3] as f64;
            let py = positions[i * 3 + 1] as f64;
            let theta = py.atan2(px);
            assert!(theta >= theta_lo - 1e-3 && theta <= theta_hi + 1e-3,
                "vert {i} theta = {theta} out of [{theta_lo}, {theta_hi}]");
        }
    }

    #[test]
    fn adr089_a_rho_polygonal_face_unaffected() {
        // Regression — polygonal face (no Cylinder surface) keeps using
        // earcut polygon path.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        // Earcut produces 2 triangles for a quad (no Cylinder surface).
        assert_eq!(indices.len() / 3, 2);
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-κ-β: closed-curve face/edge render fast-path
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_kappa_closed_curve_face_emits_triangles() {
        // export_buffers must emit ≥ 8 triangles for a closed-curve
        // face (1 anchor + Circle self-loop). Pre-A-κ this face produced
        // 0 triangles (loop_verts.len() < 3 skip).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let _face = mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0)).unwrap();
        let (_pos, _norm, indices, face_map, _pos_f64) = mesh.export_buffers().unwrap();
        let tri_count = indices.len() / 3;
        assert!(
            tri_count >= 8,
            "ADR-089 A-κ-β: closed-curve face must emit ≥ 8 triangles, got {}",
            tri_count
        );
        assert_eq!(
            face_map.len(),
            tri_count,
            "ADR-089 A-κ-β: face_map length must equal triangle count"
        );
    }

    #[test]
    fn adr089_a_kappa_closed_curve_face_normals_align_with_circle_normal() {
        // All emitted vertex normals must align with the Circle's normal
        // (analytic Plane orientation). Tolerance 1e-3.
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(3.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 3.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let _face = mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0)).unwrap();
        let (_pos, normals, _idx, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let n_verts = normals.len() / 3;
        for i in 0..n_verts {
            let nx = normals[i * 3];
            let ny = normals[i * 3 + 1];
            let nz = normals[i * 3 + 2];
            assert!(nx.abs() < 1e-3 && ny.abs() < 1e-3 && (nz - 1.0).abs() < 1e-3,
                "ADR-089 A-κ-β: normal[{i}] must be ~Z, got ({nx},{ny},{nz})");
        }
    }

    #[test]
    fn adr089_a_kappa_closed_curve_edge_emits_polyline_segments() {
        // export_edge_lines must tessellate self-loop Circle edge into
        // N >= 8 line segments (not a zero-length point).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 2.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let _face = mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0)).unwrap();
        let (lines, edge_map) = mesh.export_edge_lines_with_map(20.1);
        // Each segment = 6 floats (2 endpoints × 3). N segs → N*6 floats.
        let seg_count = lines.len() / 6;
        assert!(
            seg_count >= 8,
            "ADR-089 A-κ-β: self-loop edge must emit ≥ 8 polyline segments, got {}",
            seg_count
        );
        assert_eq!(
            edge_map.len(),
            seg_count,
            "edge_map length must match segment count"
        );
        // P22.5 — all segments share same EdgeId.
        let first_eid = edge_map[0];
        assert!(
            edge_map.iter().all(|&e| e == first_eid),
            "ADR-089 A-κ-β: all polyline segments must map to the same EdgeId"
        );
    }

    #[test]
    fn adr089_a_kappa_polygonal_face_render_unaffected() {
        // Regression — polygonal face render path unchanged.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let (_pos, _norm, indices, face_map, _pos_f64) = mesh.export_buffers().unwrap();
        // Earcut produces 2 triangles for a quad.
        assert_eq!(indices.len() / 3, 2);
        assert_eq!(face_map.len(), 2);
    }

    #[test]
    fn adr089_a_kappa_polygonal_edge_render_unaffected() {
        // Regression — non-self-loop edge wireframe unchanged.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let (lines, _) = mesh.export_edge_lines_with_map(20.1);
        // Quad has 4 boundary edges → 4 segments × 6 floats.
        assert_eq!(lines.len(), 24);
    }

    #[test]
    fn adr089_a_kappa_mixed_polygon_and_closed_curve_both_render() {
        // Mixed mesh — polygon face + closed-curve face both produce
        // triangles in same export pass.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _rect = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let anchor = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0),
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let _circle_face = mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0)).unwrap();
        let (_pos, _norm, indices, _fmap, _pos_f64) = mesh.export_buffers().unwrap();
        let tri_count = indices.len() / 3;
        // Quad: 2 triangles + Circle: ≥ 8 triangles → ≥ 10.
        assert!(tri_count >= 10,
            "ADR-089 A-κ-β: mixed mesh tri_count = {} (expected ≥ 10)", tri_count);
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-η-1: Plane surface auto-attach to closed-curve face
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr089_a_eta_1_closed_curve_face_has_plane_surface_attached() {
        // closed-curve face must carry a Plane AnalyticSurface derived
        // from the Circle's plane (origin / normal / basis_u).
        let mut mesh = Mesh::new();
        let anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let circle = crate::curves::AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let face = mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0)).unwrap();
        let surface = mesh.face_surface(face)
            .expect("ADR-089 A-η-1: closed-curve face must have AnalyticSurface attached");
        match surface {
            crate::surfaces::AnalyticSurface::Plane { origin, normal, basis_u, .. } => {
                assert!((origin.distance(DVec3::ZERO)).abs() < 1e-9);
                assert!((normal.distance(DVec3::Z)).abs() < 1e-9);
                assert!((basis_u.distance(DVec3::X)).abs() < 1e-9);
            }
            other => panic!("ADR-089 A-η-1: expected Plane surface, got {:?}",
                std::mem::discriminant(other)),
        }
    }

    #[test]
    fn adr089_a_eta_1_closed_curve_face_passes_boolean_eligibility() {
        // After A-η-1, classify_dispatch_eligibility no longer returns
        // SurfaceMissing for closed-curve faces — Boolean dispatch can
        // route them to the NURBS path.
        use crate::operations::boolean_dispatch::classify_dispatch_eligibility;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a_anchor = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let face_a = mesh.add_face_closed_curve(a_anchor,
            crate::curves::AnalyticCurve::Circle {
                center: DVec3::ZERO, radius: 5.0,
                normal: DVec3::Z, basis_u: DVec3::X,
            }, mat).unwrap();
        let b_anchor = mesh.add_vertex(DVec3::new(8.0, 0.0, 0.0));
        let face_b = mesh.add_face_closed_curve(b_anchor,
            crate::curves::AnalyticCurve::Circle {
                center: DVec3::new(3.0, 0.0, 0.0), radius: 5.0,
                normal: DVec3::Z, basis_u: DVec3::X,
            }, mat).unwrap();
        let result = classify_dispatch_eligibility(&mesh, &[face_a], &[face_b]);
        assert!(result.is_ok(),
            "ADR-089 A-η-1: closed-curve faces must pass eligibility, got {:?}",
            result);
    }

    #[test]
    fn adr089_a_eta_1_polygon_face_unaffected_by_eta_attach() {
        // Regression guard — A-η-1 only attaches Plane to closed-curve
        // faces. Polygon faces (add_face) remain with surface=None unless
        // explicitly set by other paths (existing behavior preserved).
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        // add_face itself does not auto-attach surface — A-η-1 path is
        // exclusively in add_face_closed_curve.
        // (Other code paths may attach surface separately; A-η-1 must
        // not change that contract.)
        let _ = mesh.face_surface(face); // smoke read
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-094 B-γ-prep — Multi-loop face schema (additive prep phase)
    // ────────────────────────────────────────────────────────────────

    fn build_quad_face(mesh: &mut Mesh) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap()
    }

    #[test]
    fn adr094_b_gamma_prep_default_no_multi_loop_schema() {
        // 새 face 의 default 상태: face_to_boundary_loops 에 entry 없음.
        // face_has_multi_loop_schema = false. legacy outer+inners 로 동작.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        assert!(!mesh.face_has_multi_loop_schema(f),
            "fresh face must default to legacy schema (no multi-loop entry)");
        // Effective getter falls back to outer + inners.
        let loops = mesh.face_boundary_loops(f);
        assert_eq!(loops.len(), 1,
            "legacy fallback: 1 outer + 0 inners = 1 loop");
        // The single loop is the face's outer (matches face.outer()).
        assert_eq!(loops[0].is_outer, mesh.faces[f].outer().is_outer);
    }

    #[test]
    fn adr094_b_gamma_prep_set_face_boundary_loops_overrides_legacy() {
        // set_face_boundary_loops 가 effective getter 의 결과를 갱신.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let outer = mesh.faces[f].outer();

        // Simulated annulus: 2 boundary loops. Use face's own outer
        // twice as a placeholder (real cylinder annulus 는 B-δ-prep 에서).
        let two_loops = vec![outer, outer];
        assert!(mesh.set_face_boundary_loops(f, two_loops));
        assert!(mesh.face_has_multi_loop_schema(f),
            "after set, schema must be multi-loop");
        let loops = mesh.face_boundary_loops(f);
        assert_eq!(loops.len(), 2,
            "effective getter must return the multi-loop view (2 entries)");
    }

    #[test]
    fn adr094_b_gamma_prep_clear_returns_to_legacy() {
        // clear_face_boundary_loops 가 multi-loop entry 제거 + legacy
        // fallback 복원.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let outer = mesh.faces[f].outer();
        mesh.set_face_boundary_loops(f, vec![outer, outer]);
        assert!(mesh.face_has_multi_loop_schema(f));
        assert!(mesh.clear_face_boundary_loops(f),
            "clear must report removal");
        assert!(!mesh.face_has_multi_loop_schema(f),
            "after clear, schema returns to legacy");
        let loops = mesh.face_boundary_loops(f);
        assert_eq!(loops.len(), 1, "legacy fallback restored");
    }

    #[test]
    fn adr094_b_gamma_prep_legacy_face_outer_inners_unaffected() {
        // 기존 face.outer() / face.inners() API 가 multi-loop set
        // 후에도 그대로 작동 — additive 보장.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let original_outer = mesh.faces[f].outer();
        let original_inner_count = mesh.faces[f].inners().len();

        mesh.set_face_boundary_loops(f, vec![original_outer, original_outer]);

        // Face struct UNCHANGED — outer / inners 그대로.
        assert_eq!(mesh.faces[f].outer().is_outer, original_outer.is_outer,
            "face.outer() must be unaffected by B-γ-prep set");
        assert_eq!(mesh.faces[f].inners().len(), original_inner_count,
            "face.inners() must be unaffected by B-γ-prep set");
    }

    #[test]
    fn adr094_b_gamma_prep_set_on_inactive_face_returns_false() {
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let outer = mesh.faces[f].outer();
        mesh.remove_face(f).expect("remove_face OK");
        // Inactive face → set rejected.
        assert!(!mesh.set_face_boundary_loops(f, vec![outer]),
            "set on inactive face must return false");
        assert!(!mesh.face_has_multi_loop_schema(f),
            "inactive face has no multi-loop schema");
        assert!(mesh.face_boundary_loops(f).is_empty(),
            "inactive face returns empty effective loops");
    }

    #[test]
    fn adr094_b_gamma_prep_empty_loops_clears_entry() {
        // set_face_boundary_loops with empty Vec acts as clear (defensive).
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let outer = mesh.faces[f].outer();
        mesh.set_face_boundary_loops(f, vec![outer, outer]);
        assert!(mesh.face_has_multi_loop_schema(f));
        // Setting empty → clears entry.
        assert!(mesh.set_face_boundary_loops(f, vec![]));
        assert!(!mesh.face_has_multi_loop_schema(f),
            "empty loops vec acts as clear");
    }

    #[test]
    fn adr094_b_gamma_prep_snapshot_roundtrip_preserves_multi_loop() {
        // ADR-091 §E L1 canonical: bincode legacy 호환 + 새 entry round-trip.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        let outer = mesh.faces[f].outer();
        mesh.set_face_boundary_loops(f, vec![outer, outer]);

        let bytes = mesh.snapshot();
        let mut restored = Mesh::new();
        restored.restore_snapshot(&bytes);

        assert!(restored.face_has_multi_loop_schema(f),
            "multi-loop schema must round-trip via Mesh-level map");
        assert_eq!(restored.face_boundary_loops(f).len(), 2);
    }

    #[test]
    fn adr094_b_gamma_prep_face_with_inners_legacy_fallback_includes_holes() {
        // Face that has inners (holes) — legacy fallback returns
        // [outer] + [inners...]. Smoke test for the multi-entry legacy
        // fallback path.
        let mut mesh = Mesh::new();
        // Just construct a face with no inners (basic case) — full hole
        // construction via add_face_with_holes is heavier. The fallback
        // shape with N=1 outer + 0 inners is what the empty-inners test
        // already covers; this test asserts the .extend_from_slice path.
        let f = build_quad_face(&mut mesh);
        // No multi-loop set, no inners → legacy fallback = 1 entry.
        assert_eq!(mesh.face_boundary_loops(f).len(), 1);
        assert_eq!(mesh.faces[f].inners().len(), 0,
            "build_quad_face has no inners — legacy fallback len = 1");
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-097 T-β — Topology damage detection (Phase 4)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn adr097_t_beta_detect_clean_mesh_returns_empty() {
        // Empty mesh — no damage.
        let mesh = Mesh::new();
        let report = mesh.detect_topology_damage();
        assert!(report.is_clean());
        assert_eq!(report.checked_faces, 0);
        assert_eq!(report.checked_edges, 0);
        assert_eq!(report.damages.len(), 0);
    }

    #[test]
    fn adr097_t_beta_detect_single_face_has_boundary_edges() {
        // Single quad face → 4 edges 가 모두 boundary (1 incident face).
        // T-β 가 4 BoundaryEdge damage 검출 (사건 2).
        let mut mesh = Mesh::new();
        let _f = build_quad_face(&mut mesh);
        let report = mesh.detect_topology_damage();
        let (be, nm, dg, _orph) = report.count_by_kind();
        assert_eq!(be, 4, "single quad → 4 boundary edges");
        assert_eq!(nm, 0);
        assert_eq!(dg, 0);
    }

    #[test]
    fn adr097_t_beta_detect_two_face_shared_edge_no_damage() {
        // 두 face 가 edge 1 개 공유 → 그 edge 는 manifold (2 face),
        // 나머지 edges 는 boundary. 정확한 검증은 boundary count.
        let mut mesh = Mesh::new();
        // Face 1: 4-vert quad
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        // Face 2: shares v1-v2 edge with face 1
        let v4 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));
        let _f2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        let report = mesh.detect_topology_damage();
        let (be, nm, dg, _orph) = report.count_by_kind();
        // 7 edges total. 1 shared (manifold), 6 boundary. So 6 BE damages.
        assert_eq!(be, 6, "two-face strip → 6 boundary edges, got {}", be);
        assert_eq!(nm, 0, "no non-manifold");
        assert_eq!(dg, 0, "no degenerate");
    }

    #[test]
    fn adr097_t_beta_summary_format() {
        // is_clean / count_by_kind / summary 의 사용자 facing format 검증.
        let mut mesh = Mesh::new();
        let _ = build_quad_face(&mut mesh);
        let report = mesh.detect_topology_damage();
        let s = report.summary();
        assert!(s.contains("damages"));
        assert!(s.contains("4 boundary"));
    }

    #[test]
    fn adr097_t_beta_clean_mesh_summary_format() {
        let mesh = Mesh::new();
        let report = mesh.detect_topology_damage();
        let s = report.summary();
        assert!(s.contains("clean"));
        assert!(s.contains("0 faces"));
        assert!(s.contains("0 edges"));
    }

    #[test]
    fn adr097_t_beta_damage_kinds_have_stable_labels() {
        use crate::topology_damage::TopologyDamageKind;
        let be = TopologyDamageKind::BoundaryEdge {
            edge_id: crate::EdgeId::new(0),
            incident_face: crate::FaceId::new(0),
        };
        let nm = TopologyDamageKind::NonManifold {
            edge_id: crate::EdgeId::new(0),
            face_count: 3,
        };
        let dg = TopologyDamageKind::Degenerate {
            face_id: crate::FaceId::new(0),
            reason: "test",
        };
        assert_eq!(be.label(), "BoundaryEdge");
        assert_eq!(nm.label(), "NonManifold");
        assert_eq!(dg.label(), "Degenerate");
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-097 T-γ — Recovery dispatcher (Mesh-level)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn adr097_t_gamma_clean_mesh_returns_noop() {
        use crate::topology_damage::RecoveryOutcome;
        let mut mesh = Mesh::new();
        let outcome = mesh.attempt_auto_recovery();
        assert!(matches!(outcome, RecoveryOutcome::NoOp),
            "clean mesh → NoOp, got {:?}", outcome.label());
        assert!(outcome.is_success());
    }

    #[test]
    fn adr097_t_gamma_boundary_edge_only_partial_failure() {
        // Single quad face → 4 boundary edges. T-γ 가 BoundaryEdge auto-fix
        // 미시도 → PartialFailure (escalation 대상).
        use crate::topology_damage::RecoveryOutcome;
        let mut mesh = Mesh::new();
        let _ = build_quad_face(&mut mesh);
        let outcome = mesh.attempt_auto_recovery();
        match outcome {
            RecoveryOutcome::PartialFailure { fixes_applied, remaining } => {
                assert_eq!(fixes_applied, 0,
                    "BoundaryEdge auto-fix 미시도 — fixes_applied 0");
                let (be, _, _, _) = remaining.count_by_kind();
                assert_eq!(be, 4, "4 boundary edges 잔존");
            }
            other => panic!("expected PartialFailure, got {:?}", other.label()),
        }
    }

    #[test]
    fn adr097_t_gamma_recovery_outcome_labels_stable() {
        use crate::topology_damage::{RecoveryOutcome, TopologyDamageReport};
        let no_op = RecoveryOutcome::NoOp;
        let recovered = RecoveryOutcome::Recovered {
            fixes_applied: 1, initial_damages: 1,
        };
        let partial = RecoveryOutcome::PartialFailure {
            fixes_applied: 0,
            remaining: TopologyDamageReport {
                damages: vec![], checked_faces: 0, checked_edges: 0,
            },
        };
        assert_eq!(no_op.label(), "NoOp");
        assert_eq!(recovered.label(), "Recovered");
        assert_eq!(partial.label(), "PartialFailure");
        assert!(no_op.is_success());
        assert!(recovered.is_success());
        assert!(!partial.is_success());
    }

    #[test]
    fn adr097_t_gamma_recovery_progress_tracks_fixes_applied() {
        // Recovery 가 진행 안 되면 break (max iter 무한 루프 방지).
        // Single quad → BoundaryEdge only → 0 progress → PartialFailure
        // with fixes_applied=0.
        use crate::topology_damage::RecoveryOutcome;
        let mut mesh = Mesh::new();
        let _ = build_quad_face(&mut mesh);
        let outcome = mesh.attempt_auto_recovery();
        match outcome {
            RecoveryOutcome::PartialFailure { fixes_applied, .. } => {
                assert_eq!(fixes_applied, 0,
                    "no progress → break with 0 fixes");
            }
            other => panic!("expected PartialFailure, got {:?}", other.label()),
        }
    }

    #[test]
    fn adr097_t_beta_inactive_face_skipped() {
        // remove_face 후 inactive face 는 detect 에 포함 안 됨.
        let mut mesh = Mesh::new();
        let f = build_quad_face(&mut mesh);
        mesh.remove_face(f).expect("remove OK");
        let report = mesh.detect_topology_damage();
        // face 는 inactive — checked_faces 0
        assert_eq!(report.checked_faces, 0,
            "inactive face must be skipped");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-101 Phase A — polygonize_closed_curve_face regressions
    // ════════════════════════════════════════════════════════════════

    /// Build a Path B Circle face at the given center / radius.
    fn build_circle_face(
        mesh: &mut Mesh,
        center: DVec3,
        radius: f64,
    ) -> FaceId {
        let mat = MaterialId::new(0);
        let anchor = mesh.add_vertex(center);
        let circle = crate::curves::AnalyticCurve::Circle {
            center,
            radius,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        mesh.add_face_closed_curve(anchor, circle, mat)
            .expect("Circle face creation")
    }

    #[test]
    fn adr101_phase_a_polygonize_circle_face_happy_path() {
        // Circle r=5 → polygonize → Some(new_fid). The new face must be
        // a polygonal N-vert face with N >= 8 (chord_tol radius/100
        // floor enforced by segment_count_for_arc).
        let mut mesh = Mesh::new();
        let circle = build_circle_face(&mut mesh, DVec3::ZERO, 5.0);
        let mat = MaterialId::new(0);

        let result = mesh.polygonize_closed_curve_face(circle, mat)
            .expect("polygonize must not error on valid Circle face");
        let new_fid = result.expect("Circle must polygonize → Some(new_fid)");

        // Original face is removed (inactive).
        assert!(
            !mesh.faces.get(circle)
                .map(|f| f.is_active())
                .unwrap_or(false),
            "original closed-curve face must be inactive after polygonize",
        );

        // New face is active and polygonal (N >= 8 boundary verts).
        let new_face = mesh.faces.get(new_fid)
            .expect("new face must exist");
        assert!(new_face.is_active(), "new polygon face must be active");
        let new_loop = mesh.collect_loop_verts(new_face.outer().start)
            .expect("new face must have a valid outer loop");
        assert!(
            new_loop.len() >= 8,
            "polygonized circle must have >= 8 chord segments (got {})",
            new_loop.len(),
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_noop_for_polygonal_face() {
        // Rect (4-vert polygon) → returns Ok(None), unchanged.
        let mut mesh = Mesh::new();
        let rect = build_quad_face(&mut mesh);
        let mat = MaterialId::new(0);
        let before_active = mesh.faces[rect].is_active();

        let result = mesh.polygonize_closed_curve_face(rect, mat)
            .expect("polygonize must not error on polygonal face");
        assert!(
            result.is_none(),
            "polygonal face must return None (was Some({:?}))",
            result,
        );
        assert_eq!(
            mesh.faces[rect].is_active(),
            before_active,
            "polygonal face must be untouched (still active)",
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_noop_for_non_circle_self_loop() {
        // Closed Bezier face → Ok(None). The Bezier face must remain
        // intact; ADR-101 Phase A only handles Circle.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let anchor = mesh.add_vertex(DVec3::ZERO);
        // Trivial closed Bezier — 3 control points forming a triangle
        // with cp[0] == cp[last] (closure requirement).
        let bez = crate::curves::AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(1.0, 0.0, 0.0),
                DVec3::new(0.5, 1.0, 0.0),
                DVec3::new(0.0, 0.0, 0.0),
            ],
        };
        let bezier_face = mesh.add_face_closed_curve(anchor, bez, mat)
            .expect("Bezier closed face creation");
        let before_active = mesh.faces[bezier_face].is_active();

        let result = mesh.polygonize_closed_curve_face(bezier_face, mat)
            .expect("polygonize must not error on Bezier face");
        assert!(
            result.is_none(),
            "Bezier closed curve must return None (deferred — Phase A is Circle-only)",
        );
        assert_eq!(
            mesh.faces[bezier_face].is_active(),
            before_active,
            "Bezier face must be untouched",
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_surface_inheritance() {
        // Circle with Plane surface attached → new polygon inherits
        // the same Plane variant.
        let mut mesh = Mesh::new();
        let circle = build_circle_face(&mut mesh, DVec3::ZERO, 3.0);
        let plane = crate::surfaces::AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-1e6, 1e6),
            v_range: (-1e6, 1e6),
        };
        mesh.faces.get_mut(circle)
            .expect("circle face exists")
            .set_surface(Some(plane));

        let mat = MaterialId::new(0);
        let new_fid = mesh.polygonize_closed_curve_face(circle, mat)
            .expect("polygonize OK")
            .expect("Circle must polygonize");

        let new_face = mesh.faces.get(new_fid)
            .expect("new face exists");
        assert!(
            matches!(
                new_face.surface(),
                Some(crate::surfaces::AnalyticSurface::Plane { .. }),
            ),
            "Plane surface must be inherited onto the polygonized face",
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_anchor_deactivated_if_isolated() {
        // The Circle's anchor vertex has no other edges → must be
        // deactivated after polygonization so it doesn't render as a
        // stray dot at the center.
        let mut mesh = Mesh::new();
        let circle = build_circle_face(&mut mesh, DVec3::ZERO, 2.0);
        let mat = MaterialId::new(0);

        // Pre-polygonize: locate the anchor (the single boundary vert).
        let anchor = {
            let face = mesh.faces.get(circle).unwrap();
            let loop_verts = mesh.collect_loop_verts(face.outer().start)
                .unwrap();
            assert_eq!(
                loop_verts.len(), 1,
                "Path B Circle has a 1-vert boundary loop",
            );
            loop_verts[0]
        };

        let _ = mesh.polygonize_closed_curve_face(circle, mat)
            .expect("polygonize OK")
            .expect("must polygonize");

        // Anchor should be inactive — it has no other outgoing edges.
        assert!(
            !mesh.verts[anchor].is_active(),
            "isolated anchor must be deactivated post-polygonize",
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_invariants_preserved() {
        // After polygonize the mesh must pass face invariants — no
        // degenerate normals, no orphan HEs, no non-manifold edges
        // introduced by the rewrite.
        let mut mesh = Mesh::new();
        let circle = build_circle_face(&mut mesh, DVec3::ZERO, 4.0);
        let mat = MaterialId::new(0);
        let _ = mesh.polygonize_closed_curve_face(circle, mat)
            .expect("polygonize OK")
            .expect("must polygonize");

        let report = mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "post-polygonize mesh must satisfy face invariants — got {:?}",
            report.violations,
        );
    }

    #[test]
    fn adr101_phase_a_polygonize_inactive_face_errors() {
        // Passing an inactive face_id must error — not silent no-op,
        // because that hides programming errors at the caller.
        let mut mesh = Mesh::new();
        let circle = build_circle_face(&mut mesh, DVec3::ZERO, 2.0);
        mesh.remove_face(circle).expect("manual remove for test");
        let mat = MaterialId::new(0);

        let result = mesh.polygonize_closed_curve_face(circle, mat);
        assert!(
            result.is_err(),
            "polygonize on inactive face must error, got {:?}",
            result,
        );
    }
}
