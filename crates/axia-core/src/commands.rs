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

    /// Draw a rectangle
    DrawRect {
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
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
