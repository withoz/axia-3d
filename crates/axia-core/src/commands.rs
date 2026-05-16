//! Command Pattern — Preview → Commit pipeline.
//!
//! Every user action is represented as a Command that can:
//! 1. Preview: show a ghost/preview of the result
//! 2. Commit: apply the actual topological change
//! 3. Undo: revert via transaction manager

use glam::DVec3;
use serde::{Deserialize, Serialize};
use axia_geo::{FaceId, MaterialId};
use crate::xia::XiaId;
use crate::group::{GroupId, ComponentDefId};
use crate::material::{PhysicalProperties, VisualProperties, MaterialCategory};

/// Result of executing a command.
#[derive(Clone, Debug)]
pub enum CommandResult {
    /// No visible change
    None,
    /// Mesh buffers need to be re-sent to viewport
    MeshUpdated,
    /// Push/Pull completed with diagnostic info
    PushPullDone {
        sides_created: usize,
        adj_splits: usize,
        base_removed: bool,
        split_debug: Vec<String>,
    },
    /// A new XIA entity was created
    EntityCreated(XiaId),
    /// ADR-050 P-5a — A new form-layer Shape was created (no material).
    /// Two-Layer Citizenship: Shape is the form citizen; promotion to
    /// property-layer Xia happens later via `Scene::promote_shape_to_xia`
    /// when material is explicitly assigned (4-condition validation).
    /// Carries `ShapeId.raw()` as `u32` for bridge-friendly transport.
    ShapeCreated(u32),
    /// ADR-079 W-1 — `create_solid` produced a NURBS-native solid from
    /// a profile face + mode. Carries the result `SolidKind` (Box /
    /// Cylinder / etc.) and the total face count of the solid (for
    /// telemetry / undo summary).
    SolidCreated {
        kind: axia_geo::SolidKind,
        face_count: usize,
    },
    /// A group was created/modified
    GroupUpdated(GroupId),
    /// Material assigned to faces
    MaterialAssigned { face_count: usize },
    /// Material removed from faces
    MaterialRemoved { face_count: usize },
    /// Material created
    MaterialCreated(MaterialId),
    /// An error occurred
    Error(String),
}

/// All possible modeling commands.
///
/// ADR-087 K-ζ (2026-05-08) — Legacy Command variants (`DrawLine` /
/// `DrawRect` / `DrawCircle` / `PushPull`) 는 **internal-only Rust API**
/// 로 강등. User-facing surface (WASM exports + TS bridge wrappers + Tool
/// dispatch) 는 삭제 — AsShape variants + CreateSolid 가 단일 user-facing
/// entry. enum variants 보존 이유: 회귀 자산 (245 test sites) 의 Xia-layer
/// contract (EntityCreated, scene.xias 등) 검증 유지. Test-only code 가
/// 사용 가능, but production code paths (web/src/) 는 사용 금지.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Command {
    /// **Internal-only (ADR-087 K-ζ)** — Draw a line between two points.
    /// AsShape variant 가 user-facing entry. Test 회귀 자산 보존용.
    DrawLine {
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    },

    /// Draw a centerline (reference axis). Q3 deferred per ADR-049
    /// Phase 3 (Reference layer 별도 시민권). 향후 ADR-053 에서 처리.
    DrawCenterline {
        start: DVec3,
        end: DVec3,
    },

    /// Change the semantic class of an existing edge (e.g., convert a
    /// Geometry line into a Centerline or vice versa). Pure attribute flip,
    /// does not modify topology.
    SetEdgeClass {
        edge_id: axia_geo::EdgeId,
        class_raw: u32,  // 0 = Geometry, 1 = Centerline
    },

    /// **Internal-only (ADR-087 K-ζ)** — Draw a rectangle (Xia layer).
    /// `DrawRectAsShape` 가 user-facing entry.
    DrawRect {
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
    },

    /// **Internal-only (ADR-087 K-ζ)** — Draw a circle (Xia layer).
    /// `DrawCircleAsShape` 가 user-facing entry.
    DrawCircle {
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    },

    /// **Internal-only (ADR-087 K-ζ)** — Push/Pull (mesh-level Xia layer).
    /// `CreateSolid { mode: Extrude }` 가 user-facing entry.
    /// dist > 0 = extrude outward, dist < 0 = recess inward.
    PushPull {
        face_id: FaceId,
        dist: f64,
    },

    /// ADR-050 P-5a — Draw a rectangle and produce a form-layer Shape
    /// (NOT a property-layer Xia). Two-Layer Citizenship:
    /// - Geometry is the same as `DrawRect` (4 lines + face synthesis +
    ///   auto-intersect + post-process).
    /// - The result is registered as a `Shape` (no material, no member
    ///   identity). Promotion to Xia is user-driven via
    ///   `Scene::promote_shape_to_xia` when material is assigned.
    /// - `face_to_xia` is NOT updated (Shape is form reference only).
    ///
    /// Drop-in alongside `DrawRect` — existing tools / tests using
    /// `DrawRect` are unaffected. P-5a is the foundation for the
    /// progressive default flip (P-5e).
    DrawRectAsShape {
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
    },

    /// ADR-050 P-5b — Draw a line and produce a form-layer Shape (no Xia).
    ///
    /// Geometry is identical to `DrawLine` (intersect-split + face
    /// synthesis pipeline). The result is registered as a Shape with
    /// either:
    /// - `face_ids` populated (closing-loop case, face synthesized)
    /// - OR `standalone_edge_id` set (free-edge case, no face)
    ///
    /// Same lock-ins as `DrawRectAsShape` — face_to_xia not updated,
    /// existing `DrawLine` path UNCHANGED.
    DrawLineAsShape {
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    },

    /// ADR-050 P-5b — Draw a circle and produce a form-layer Shape (no Xia).
    ///
    /// Geometry is identical to `DrawCircle` (N segments approximation
    /// + face synthesis + Arc curve attachment per ADR-028).
    /// The resulting Shape owns the single circle face.
    ///
    /// Same lock-ins as `DrawRectAsShape` — face_to_xia not updated,
    /// existing `DrawCircle` path UNCHANGED.
    DrawCircleAsShape {
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    },

    /// ADR-089 Phase 2 (A-ζ-4) — Draw a circle as a TRUE kernel-native
    /// closed-curve face. **메타-원칙 #14 의 deepest realization**:
    /// 1 anchor vertex + 1 self-loop edge + 1 closed-curve face.
    /// Polygon decomposition (DrawCircle / DrawCircleAsShape 의 24 segments)
    /// 와 architectural 으로 다름 — wireframe 매끈, 메모리 가벼움.
    ///
    /// Contract:
    /// - `center`, `normal`: closed circle 의 plane
    /// - `radius`: 원 반지름
    /// - segments parameter 없음 (analytic curve = formula 1개)
    /// - Returns `CommandResult::ShapeCreated(ShapeId.raw())`
    ///
    /// 기존 DrawCircle / DrawCircleAsShape UNCHANGED — drop-in 옵션.
    /// 사용자 facing entry: WASM `drawCircleAsCurve` (A-ζ-4 commit) +
    /// 향후 UI dispatch (DrawCircleTool kernel-native flag, A-λ).
    DrawCircleAsCurve {
        center: DVec3,
        normal: DVec3,
        radius: f64,
    },

    /// ADR-089 A-ω-γ — Atomic closed Bezier creation with curve promotion.
    ///
    /// Creates a kernel-native closed-curve face from a Bezier control
    /// point loop (control_pts[0] ≈ control_pts[last]):
    /// - 1 anchor vertex (control_pts[0])
    /// - 1 self-loop edge with `AnalyticCurve::Bezier` curve
    /// - 1 face with Plane surface attached (best-fit plane normal)
    ///
    /// Returns `CommandResult::ShapeCreated(ShapeId.raw())` on success.
    /// Rejects open Bezier (cp[0] != cp[last]) or collinear control
    /// points with `CommandResult::Error`.
    DrawClosedBezierAsCurve {
        control_pts: Vec<DVec3>,
    },

    /// ADR-089 A-Α-γ — Atomic closed BSpline creation with curve attach.
    /// Same pattern as DrawClosedBezierAsCurve. Caller responsible for
    /// passing valid clamped-knots vector with control_pts[0] ≈
    /// control_pts[last]. Returns ShapeCreated on success.
    DrawClosedBSplineAsCurve {
        control_pts: Vec<DVec3>,
        knots: Vec<f64>,
        degree: u32,
    },

    /// ADR-089 A-Β-γ — Atomic closed NURBS creation with curve attach.
    /// Rational extension of DrawClosedBSplineAsCurve — adds `weights`.
    /// All weights must be > 0. Caller responsible for clamped-knots
    /// closure (control_pts[0] ≈ control_pts[last]). Returns ShapeCreated.
    DrawClosedNURBSAsCurve {
        control_pts: Vec<DVec3>,
        weights: Vec<f64>,
        knots: Vec<f64>,
        degree: u32,
    },

    /// ADR-079 W-1 — Surface-native solid creation from a profile face.
    /// `create_solid` 의 architectural successor to mesh-era push_pull.
    /// Smart routing within `Extrude` mode based on profile surface kind
    /// + boundary curves; other modes (Revolve / Sweep / Loft) delegate
    /// to existing `Mesh::revolve` / `sweep` / `loft` (W-3/W-4).
    CreateSolid {
        face_id: FaceId,
        mode: axia_geo::CreateSolidMode,
    },

    /// Move entities by a delta
    Move {
        xia_ids: Vec<XiaId>,
        delta: DVec3,
    },

    /// Undo the last operation
    Undo,

    /// Redo the last undone operation
    Redo,

    /// Select an entity
    Select {
        xia_id: XiaId,
        additive: bool,
    },

    /// Deselect all
    DeselectAll,

    // ════════════════════════════════════════════════
    // Group / Component commands
    // ════════════════════════════════════════════════

    /// 선택된 face들을 그룹으로 묶기
    CreateGroup {
        name: String,
        face_ids: Vec<FaceId>,
    },

    /// 그룹 해제 (face들은 유지, 그룹 구조만 제거)
    DeleteGroup {
        group_id: GroupId,
    },

    /// 그룹 이름 변경
    RenameGroup {
        group_id: GroupId,
        new_name: String,
    },

    /// 그룹 가시성 토글
    ToggleGroupVisibility {
        group_id: GroupId,
    },

    /// 그룹 잠금 토글
    ToggleGroupLock {
        group_id: GroupId,
    },

    /// 그룹을 컴포넌트로 변환
    MakeComponent {
        group_id: GroupId,
        name: String,
    },

    /// 컴포넌트 인스턴스 배치
    PlaceComponent {
        def_id: ComponentDefId,
        position: DVec3,
    },

    // ════════════════════════════════════════════════
    // Material commands
    // ════════════════════════════════════════════════

    /// Assign a material to a set of faces
    AssignMaterial {
        face_ids: Vec<FaceId>,
        material_id: MaterialId,
    },

    /// Remove material assignment from faces (revert to default)
    RemoveMaterial {
        face_ids: Vec<FaceId>,
    },

    /// Create a new custom material
    CreateMaterial {
        name: String,
        name_en: String,
        category: MaterialCategory,
        physical: PhysicalProperties,
        visual: VisualProperties,
    },
}
