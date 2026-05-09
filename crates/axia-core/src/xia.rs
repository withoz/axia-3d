//! XIA Object Model
//!
//! A XIA (pronounce "shi-a") is the fundamental modeling entity in the Semantic Layer.
//! XIA = Object. It gives meaning (name, material, visibility) to geometry.
//!
//! Architecture Decision (2026-04-15):
//!   Geometry Layer: Point → Edge → Face → Volume (pure geometry)
//!   Semantic Layer: Object (= XIA), Material, Group
//!
//! XIA state is **computed** from owned geometry, not stored:
//! - Dissolved: no faces, no edges
//! - Point: 0D location (placeholder)
//! - Edge: 1D edge topology
//! - Face: owns 1-2 faces (2D planar polygon)
//! - Volume: owns 3+ faces (3D closed solid)

use serde::{Deserialize, Serialize};
use glam::DVec3;
use axia_geo::{EdgeId, FaceId, MaterialId};

/// Geometry state of a XIA entity — computed from owned geometry.
/// This replaces the old stored `XiaState` (which included `Xia` as a separate state).
/// Material is a property of XIA, not a state transition trigger.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum XiaState {
    /// No geometry — dissolved/deleted entity
    Dissolved,
    /// 0D: A point in space
    Point,
    /// 1D: An edge
    Edge,
    /// 2D: A face (planar polygon, 1-2 faces)
    Face,
    /// 3D: A volume (closed solid, 3+ faces)
    Volume,
}

impl XiaState {
    pub fn dimension(self) -> i32 {
        match self {
            Self::Dissolved => -1,
            Self::Point => 0,
            Self::Edge => 1,
            Self::Face => 2,
            Self::Volume => 3,
        }
    }
}

/// Unique XIA entity identifier.
pub type XiaId = u32;

/// A XIA modeling entity — the fundamental Object in the Semantic Layer.
///
/// XIA gives meaning to geometry:
/// - **name**: display name
/// - **material**: physical material assignment
/// - **face_ids**: owned faces in the geometry mesh
/// - **visible / selected**: UI state
///
/// State is **computed** via `geometry_state()`:
/// ```text
/// 0 faces, 0 edges → Dissolved
/// 0 faces, 1+ edges → Edge (standalone edges from draw_line)
/// 1-2 faces → Face
/// 3+ faces → Volume
/// ```
///
/// Edge tracking (B안 — 계산 기반):
/// - Face가 있는 XIA: edge는 face_outer_edges()로 계산 (저장 안 함)
/// - draw_line XIA: standalone_edge_id로 독립 edge 최소 추적
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Xia {
    /// Unique identifier
    pub id: XiaId,
    /// Display name
    pub name: String,
    /// Position in world space
    pub position: DVec3,
    /// Surface normal (for faces/solids drawn on surfaces)
    pub surface_normal: Option<DVec3>,
    /// Material ID (property of Object, not a state trigger)
    pub material: MaterialId,
    /// Face IDs owned by this XIA (in the geometry mesh)
    pub face_ids: Vec<FaceId>,
    /// Standalone edge ID (draw_line only — not shared, no face)
    /// Face-based edges are computed via face_outer_edges(), not stored.
    pub standalone_edge_id: Option<EdgeId>,
    /// Visibility
    pub visible: bool,
    /// Selection state
    pub selected: bool,
}

impl Xia {
    pub fn new(id: XiaId, name: String) -> Self {
        Self {
            id,
            name,
            position: DVec3::ZERO,
            surface_normal: None,
            material: MaterialId::new(0),
            face_ids: Vec::new(),
            standalone_edge_id: None,
            visible: true,
            selected: false,
        }
    }

    /// Compute the geometry state from owned geometry.
    /// Face-based edges are computed externally (not stored).
    pub fn geometry_state(&self) -> XiaState {
        match (self.face_ids.len(), self.standalone_edge_id.is_some()) {
            (0, false) => XiaState::Dissolved,
            (0, true)  => XiaState::Edge,     // draw_line only
            (1 | 2, _) => XiaState::Face,
            _          => XiaState::Volume,   // 3+ faces
        }
    }

    /// Check if this XIA has a non-default material assigned.
    pub fn has_material(&self) -> bool {
        self.material.raw() != 0
    }

    /// Check if this XIA is dissolved (no geometry).
    pub fn is_dissolved(&self) -> bool {
        self.face_ids.is_empty()
    }
}
