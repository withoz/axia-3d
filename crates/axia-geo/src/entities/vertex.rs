//! Vertex entity — a point in 3D space with topology links.

use glam::DVec3;
use serde::{Deserialize, Serialize};
use super::id::*;

/// A vertex in the Half-Edge mesh.
///
/// Stores its 3D position and an optional outgoing half-edge reference
/// for traversing the topology radially around this vertex.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vertex {
    /// 3D position (double-precision for CAD accuracy)
    pos: DVec3,
    /// Geometric tolerance for vertex merging
    tolerance: f64,
    /// One outgoing half-edge (radial anchor for vertex ring traversal)
    outgoing: Option<HeId>,
    /// Active flag for soft-delete (undo/redo support)
    active: bool,
}

impl Vertex {
    pub fn new(pos: DVec3, tolerance: f64) -> Self {
        Self {
            pos,
            tolerance,
            outgoing: None,
            active: true,
        }
    }

    #[inline]
    pub fn pos(&self) -> DVec3 {
        self.pos
    }

    #[inline]
    pub fn set_pos(&mut self, pos: DVec3) {
        self.pos = pos;
    }

    #[inline]
    pub fn tolerance(&self) -> f64 {
        self.tolerance
    }

    #[inline]
    pub fn outgoing(&self) -> Option<HeId> {
        self.outgoing
    }

    #[inline]
    pub fn set_outgoing(&mut self, he: Option<HeId>) {
        self.outgoing = he;
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.active
    }

    #[inline]
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
    }

    /// Check if another position is within tolerance
    #[inline]
    pub fn coincident(&self, other: DVec3) -> bool {
        (self.pos - other).length() < self.tolerance
    }
}
