//! Command Pattern — Preview → Commit pipeline.
//!
//! Every user action is represented as a Command that can:
//! 1. Preview: show a ghost/preview of the result
//! 2. Commit: apply the actual topological change
//! 3. Undo: revert via transaction manager

use glam::DVec3;
use serde::{Deserialize, Serialize};
use axia_geo::{FaceId, MaterialId};
use axia_geo::AnalyticCurve;
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
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Command {
    /// Draw a line between two points
    DrawLine {
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    },

    /// Draw a centerline (reference axis). Unlike DrawLine, this skips
    /// intersection-splitting, face synthesis, and free-edge loop detection —
    /// creates a standalone edge tagged with `EdgeClass::Centerline`.
    /// Used for floor-plan axes, column grids, wall centers.
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

    /// Draw a rectangle
    DrawRect {
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
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

    /// Draw a circle (regular polygon approximation)
    DrawCircle {
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    },

    /// Push/Pull a face along its normal.
    /// dist > 0 = extrude outward (face kept)
    /// dist < 0 = recess inward  (face removed)
    PushPull {
        face_id: FaceId,
        dist: f64,
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
