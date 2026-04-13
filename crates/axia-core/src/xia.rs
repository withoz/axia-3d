//! XIA Object Model
//!
//! A XIA (pronounce "shi-a") is the fundamental modeling entity.
//! It progresses through dimensional states: Point → Line → Face → Volume → Xia.
//!
//! The hierarchy represents:
//! - Point: 0D location
//! - Line: 1D (Edge topology) → Visual geometry
//! - Face: 2D planar polygon
//! - Volume: 3D closed solid (geometry only)
//! - Xia: Physical object (Volume + Material assignment)

use serde::{Deserialize, Serialize};
use glam::DVec3;
use axia_geo::{FaceId, MaterialId};

/// Dimensional state of a XIA entity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum XiaState {
    /// 0D: A dissolved/deleted entity
    Dissolved,
    /// 0D: A point in space
    Point,
    /// 1D: A line segment
    Line,
    /// 2D: A face (planar polygon)
    Face,
    /// 3D: A volume (closed solid, geometry only)
    Volume,
    /// 3D+M: A physical object (Volume with Material assignment)
    Xia,
}

impl XiaState {
    pub fn dimension(self) -> i32 {
        match self {
            Self::Dissolved => -1,
            Self::Point => 0,
            Self::Line => 1,
            Self::Face => 2,
            Self::Volume | Self::Xia => 3,
        }
    }

    /// Check if this state has a material assigned (physical object).
    pub fn has_material(self) -> bool {
        self == Self::Xia
    }
}

/// Unique XIA entity identifier.
pub type XiaId = u64;

/// A XIA modeling entity.
///
/// Each XIA tracks its dimensional state and owns references into the
/// geometry kernel (Mesh). The state transitions are:
///
/// ```text
/// Dissolved ↔ Point ↔ Line ↔ Face ↔ Volume ↔ Xia
///    (-1)      (0D)    (1D)   (2D)    (3D)   (3D+M)
/// ```
///
/// Volume and Xia both represent 3D closed solids:
/// - Volume: pure geometry
/// - Xia: Volume + Material assignment (physical object)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Xia {
    /// Unique identifier
    pub id: XiaId,
    /// Current dimensional state
    pub state: XiaState,
    /// Display name
    pub name: String,
    /// Position in world space
    pub position: DVec3,
    /// Surface normal (for faces/solids drawn on surfaces)
    pub surface_normal: Option<DVec3>,
    /// Material ID
    pub material: MaterialId,
    /// Face IDs owned by this XIA (in the geometry mesh)
    #[serde(skip)]
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
            state: XiaState::Dissolved,
            name,
            position: DVec3::ZERO,
            surface_normal: None,
            material: MaterialId::new(0),
            face_ids: Vec::new(),
            visible: true,
            selected: false,
        }
    }

    /// Check if this XIA can transition to a new state.
    pub fn can_transition_to(&self, target: XiaState) -> bool {
        let curr = self.state.dimension();
        let tgt = target.dimension();

        // Special case: Volume → Xia is allowed (material assignment)
        if self.state == XiaState::Volume && target == XiaState::Xia {
            return true;
        }

        // Can go up or down by 1 step, or dissolve from any state
        (tgt - curr).abs() <= 1 || target == XiaState::Dissolved
    }

    /// Transition to a new state.
    pub fn transition(&mut self, target: XiaState) -> Result<(), String> {
        if !self.can_transition_to(target) {
            return Err(format!(
                "Cannot transition from {:?} to {:?}",
                self.state, target
            ));
        }
        self.state = target;
        Ok(())
    }
}
