//! Edge entity — connects two vertices, owns a pair of half-edges.

use serde::{Deserialize, Serialize};
use super::id::*;
use super::flags::SharedFlags;

/// An edge in the Half-Edge mesh.
///
/// Stores its two endpoint vertices in canonical order (v_small < v_large)
/// and a reference to one of its half-edges for radial traversal.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Edge {
    /// Smaller vertex ID (canonical ordering)
    v_small: VertId,
    /// Larger vertex ID (canonical ordering)
    v_large: VertId,
    /// Geometric tolerance
    tolerance: f64,
    /// One of the half-edges belonging to this edge (radial anchor)
    any_he: HeId,
    /// Active flag for soft-delete
    active: bool,
    /// Shared flags (selection, visibility, etc.)
    flags: SharedFlags,
}

impl Edge {
    pub fn new(v_small: VertId, v_large: VertId, tolerance: f64) -> Self {
        Self {
            v_small,
            v_large,
            tolerance,
            any_he: HeId::NULL,
            active: true,
            flags: SharedFlags::empty(),
        }
    }

    #[inline]
    pub fn v_small(&self) -> VertId {
        self.v_small
    }

    #[inline]
    pub fn v_large(&self) -> VertId {
        self.v_large
    }

    #[inline]
    pub fn tolerance(&self) -> f64 {
        self.tolerance
    }

    #[inline]
    pub fn any_he(&self) -> HeId {
        self.any_he
    }

    #[inline]
    pub fn set_any_he(&mut self, he: HeId) {
        self.any_he = he;
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.active
    }

    #[inline]
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
    }

    #[inline]
    pub fn flags(&self) -> SharedFlags {
        self.flags
    }

    #[inline]
    pub fn flags_mut(&mut self) -> &mut SharedFlags {
        &mut self.flags
    }

    /// Check if this edge connects the given two vertices
    pub fn connects(&self, a: VertId, b: VertId) -> bool {
        let key = VertPairKey::new(a, b);
        self.v_small == key.v_small && self.v_large == key.v_large
    }
}
