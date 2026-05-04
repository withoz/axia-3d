//! Face entity — a planar polygon bounded by half-edge loops.

use glam::DVec3;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use super::id::*;
use super::flags::SharedFlags;
use crate::surfaces::AnalyticSurface;

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
    /// ADR-031 Phase D — optional analytic surface definition.
    /// `None` = polygon face (default, backward-compat).
    /// `Some` = parametric surface, view-time tessellation.
    #[serde(default)]
    surface: Option<AnalyticSurface>,
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
            surface: None,
        }
    }

    /// ADR-031 Phase D — read the optional analytic surface.
    #[inline]
    pub fn surface(&self) -> Option<&AnalyticSurface> {
        self.surface.as_ref()
    }

    /// ADR-031 Phase D — set or clear the analytic surface.
    /// `None` reverts to a planar polygon face.
    #[inline]
    pub fn set_surface(&mut self, surface: Option<AnalyticSurface>) {
        self.surface = surface;
    }

    /// ADR-059 Phase N Step 3 — Mandatory surface accessor (drop-in alongside).
    ///
    /// Per ADR-059 §A1.6 lock-in (Phase M pattern): existing `surface()`
    /// returning `Option` is preserved unchanged. `surface_mandatory()` is
    /// the NEW Path D API that always returns an `AnalyticSurface` —
    /// synthesizing a best-fit `Plane` from the supplied outer-loop
    /// vertex positions if no explicit surface is attached.
    ///
    /// Caller passes `outer_verts` (resolved DVec3 positions of the
    /// face's outer loop) since `Face` itself is decoupled from `Mesh`.
    /// Phase O integration will provide `Mesh::face_surface_mandatory(fid)`
    /// that handles the lookup.
    #[inline]
    pub fn surface_mandatory(&self, outer_verts: &[DVec3]) -> AnalyticSurface {
        self.surface.clone().unwrap_or_else(||
            crate::curves::synthesize::synthesize_plane_surface(outer_verts)
        )
    }

    /// ADR-031 Phase D — true if a non-Plane analytic surface is attached.
    #[inline]
    pub fn has_curved_surface(&self) -> bool {
        matches!(
            self.surface,
            Some(
                AnalyticSurface::Cylinder { .. }
                | AnalyticSurface::Sphere { .. }
                | AnalyticSurface::Cone { .. }
                | AnalyticSurface::Torus { .. }
            )
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::id::{HeId, VertId};
    use crate::entities::{LoopRef, MaterialId};

    fn make_test_face() -> Face {
        Face::new(
            LoopRef { start: HeId::default(), is_outer: true },
            DVec3::Z,
            1e-7,
            MaterialId::new(0),
        )
    }

    /// ADR-059 Phase N Step 3 — surface_mandatory() synthesizes Plane
    /// from outer-loop vertex positions when no explicit surface attached.
    #[test]
    fn adr_059_face_surface_mandatory_synthesizes_plane_when_none() {
        let f = make_test_face();
        assert!(f.surface().is_none(), "no explicit surface attached");
        // CCW XY square (outer loop verts)
        let outer = vec![
            DVec3::new(0.0, 0.0, 5.0),
            DVec3::new(1.0, 0.0, 5.0),
            DVec3::new(1.0, 1.0, 5.0),
            DVec3::new(0.0, 1.0, 5.0),
        ];
        let mandatory = f.surface_mandatory(&outer);
        match mandatory {
            AnalyticSurface::Plane { origin, normal, .. } => {
                // Centroid = (0.5, 0.5, 5.0), Newell normal = +Z
                assert!((origin - DVec3::new(0.5, 0.5, 5.0)).length() < 1e-9);
                assert!((normal - DVec3::Z).length() < 1e-9);
            }
            other => panic!("expected synthesized Plane, got {:?}", other),
        }
    }

    /// ADR-059 Phase N Step 3 — surface_mandatory() returns attached
    /// surface when one is set (no synthesis override).
    #[test]
    fn adr_059_face_surface_mandatory_returns_attached_surface() {
        let mut f = make_test_face();
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 3.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 5.0),
        };
        f.set_surface(Some(cyl.clone()));
        let mandatory = f.surface_mandatory(&[]);
        assert_eq!(mandatory, cyl, "attached surface must NOT be synthesized over");
    }
}
