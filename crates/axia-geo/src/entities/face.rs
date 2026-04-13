//! Face entity — a planar polygon bounded by half-edge loops.

use glam::DVec3;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use super::id::*;
use super::flags::SharedFlags;

/// Reference to a half-edge loop (outer boundary or hole).
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct LoopRef {
    /// First half-edge in the loop
    pub start: HeId,
    /// True for outer boundary (CCW), false for holes (CW)
    pub is_outer: bool,
}

impl LoopRef {
    pub fn new(start: HeId, is_outer: bool) -> Self {
        Self { start, is_outer }
    }
}

impl Default for LoopRef {
    fn default() -> Self {
        Self {
            start: HeId::NULL,
            is_outer: true,
        }
    }
}

/// A face in the Half-Edge mesh.
///
/// A face is a planar polygon defined by:
/// - One outer boundary loop (CCW winding)
/// - Zero or more inner loops (holes, CW winding)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Face {
    /// Outer boundary loop
    outer: LoopRef,
    /// Inner loops (holes) — SmallVec optimized for 0-1 holes
    inners: SmallVec<[LoopRef; 1]>,
    /// Geometric tolerance
    tolerance: f64,
    /// Cached unit normal vector
    normal: DVec3,
    /// Parent face (for hierarchical grouping)
    parent: Option<FaceId>,
    /// Material reference
    material: MaterialId,
    /// Double-sided rendering
    double_sided: bool,
    /// Active flag for soft-delete
    active: bool,
    /// Visibility flag
    visible: bool,
    /// Shared flags (selection, etc.)
    flags: SharedFlags,
}

impl Face {
    pub fn new(outer: LoopRef, normal: DVec3, tolerance: f64, material: MaterialId) -> Self {
        Self {
            outer,
            inners: SmallVec::new(),
            tolerance,
            normal,
            parent: None,
            material,
            double_sided: false,
            active: true,
            visible: true,
            flags: SharedFlags::empty(),
        }
    }

    // --- Getters ---
    #[inline] pub fn outer(&self) -> LoopRef { self.outer }
    #[inline] pub fn inners(&self) -> &[LoopRef] { &self.inners }
    #[inline] pub fn normal(&self) -> DVec3 { self.normal }
    #[inline] pub fn tolerance(&self) -> f64 { self.tolerance }
    #[inline] pub fn parent(&self) -> Option<FaceId> { self.parent }
    #[inline] pub fn material(&self) -> MaterialId { self.material }
    #[inline] pub fn is_double_sided(&self) -> bool { self.double_sided }
    #[inline] pub fn is_active(&self) -> bool { self.active }
    #[inline] pub fn is_visible(&self) -> bool { self.visible }
    #[inline] pub fn flags(&self) -> SharedFlags { self.flags }

    // --- Setters ---
    #[inline] pub fn set_outer(&mut self, l: LoopRef) { self.outer = l; }
    #[inline] pub fn set_normal(&mut self, n: DVec3) { self.normal = n; }
    #[inline] pub fn set_parent(&mut self, p: Option<FaceId>) { self.parent = p; }
    #[inline] pub fn set_material(&mut self, m: MaterialId) { self.material = m; }
    #[inline] pub fn set_double_sided(&mut self, ds: bool) { self.double_sided = ds; }
    #[inline] pub fn set_active(&mut self, a: bool) { self.active = a; }
    #[inline] pub fn set_visible(&mut self, v: bool) { self.visible = v; }
    #[inline] pub fn flags_mut(&mut self) -> &mut SharedFlags { &mut self.flags }

    /// Add an inner loop (hole) to this face
    pub fn add_inner(&mut self, inner: LoopRef) {
        self.inners.push(inner);
    }

    /// Get mutable reference to inner loops
    pub fn inners_mut(&mut self) -> &mut SmallVec<[LoopRef; 1]> {
        &mut self.inners
    }
}
