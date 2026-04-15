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
use axia_geo::{FaceId, MaterialId};

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
pub type XiaId = u64;

/// A XIA modeling entity — the fundamental Object in the Semantic Layer.
///
/// XIA gives meaning to geometry:
/// - **name**: display name
/// - **material**: physical material assignment
/// - **face_ids**: owned faces in the geometry mesh
/// - **visible / selected**: UI state
///
/// State is **computed** via `geometry_state()` from `face_ids.len()`:
/// ```text
/// 0 faces → Dissolved
/// 1-2 faces → Face
/// 3+ faces → Volume
/// ```
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
            visible: true,
            selected: false,
        }
    }

    /// Compute the geometry state from owned faces.
    /// This replaces the old stored `state` field.
    pub fn geometry_state(&self) -> XiaState {
        match self.face_ids.len() {
            0 => XiaState::Dissolved,
            1 | 2 => XiaState::Face,
            _ => XiaState::Volume, // 3+ faces
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
