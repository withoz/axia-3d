//! Analytic Surface Primitives — Phase D + E (ADR-031, ADR-033 v1.1).
//!
//! Surface = 2D parametric `(u, v) → ℝ³`. Each primitive supports:
//! - `evaluate(u, v)` — point on surface (raw — extrapolation allowed)
//! - `normal(u, v)` — unit normal `(du × dv).normalize()` (right-handed)
//! - `derivative_u / derivative_v` — partial derivatives
//! - `tessellate(chord_tol)` — adaptive triangle mesh
//!
//! ## Right-handed UV convention (ADR-033 v1.1 P18.9)
//!
//! For all primitives: `(∂P/∂u) × (∂P/∂v)` defines the normal direction.
//! - **Direction follows parameterization** — reverse v-axis to flip normal.
//! - For ADR-007 outer-winding alignment, the **caller** is responsible for
//!   choosing parameterization that produces face-outward normals.
//! - SSI / Boolean / Trim contracts assume this right-handed convention
//!   strictly.
//!
//! ## Surface ≠ Face (ADR-033 v1.1 P18.10)
//!
//! `AnalyticSurface` is **pure geometric surface** — no topology, no trim,
//! no boundary loop. To form a usable face:
//!
//! ```text
//! [Geometric Surface]   AnalyticSurface (this module)
//!     ↓
//! [Trimmed Surface]    Surface + uv_bounds + trim_loops
//!     ↓
//! [Topological Face]   Face struct (DCEL boundary + trimmed surface attached)
//! ```
//!
//! `Face::set_surface(...)` attaches a surface; the face's DCEL boundary
//! defines the topological extent. Trim curves on `NURBSSurface` are MVP
//! data; full trim handling is Phase F.
//!
//! ## Parameter range policy (ADR-033 v1.1 P18.8)
//!
//! Two evaluation modes per surface:
//! - **`evaluate(u, v)`** — raw; extrapolation outside parameter range
//!   produces best-effort result (Newton overshoot tolerance).
//! - **`evaluate_strict(u, v)`** — Err if outside range. Use for trim
//!   curve eval, SSI boundary checks.

pub mod plane;
pub mod cylinder;
pub mod sphere;
pub mod cone;
pub mod torus;
pub mod bezier_patch;
pub mod bspline_surface;
pub mod nurbs_surface;
pub mod trim;
pub mod ssi;
pub mod transform;
pub mod curvature;
pub mod knot;
pub mod loft;
pub mod sweep;
pub mod fitting;

pub use trim::{TrimCurve2D, TrimLoop};
pub use ssi::SurfaceIntersection;

use glam::DVec3;
use serde::{Deserialize, Serialize};

/// Analytic surface attached to a Face.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum AnalyticSurface {
    /// Infinite plane defined by origin + normal + in-plane reference axis.
    /// `basis_v = normal × basis_u` (right-handed). Parameter range: any
    /// finite (u, v) box; defaults to [-1e6, 1e6]² for "infinite" appearance.
    Plane {
        origin: DVec3,
        normal: DVec3,
        basis_u: DVec3,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
    /// Right-circular cylinder.
    /// `u`: angle in `ref_dir` plane, `v`: distance along `axis_dir`.
    Cylinder {
        axis_origin: DVec3,
        axis_dir: DVec3,
        radius: f64,
        ref_dir: DVec3,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
    /// Sphere.
    /// `u`: longitude, `v`: latitude (-π/2 = south pole, +π/2 = north).
    Sphere {
        center: DVec3,
        radius: f64,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
    /// Right-circular cone.
    /// `u`: angle, `v`: distance from apex along axis.
    /// `half_angle` ∈ (0, π/2).
    Cone {
        apex: DVec3,
        axis_dir: DVec3,
        half_angle: f64,
        ref_dir: DVec3,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
    /// Torus.
    /// `u`: angle around major axis, `v`: angle around minor circle.
    Torus {
        center: DVec3,
        axis_dir: DVec3,
        ref_dir: DVec3,
        major_radius: f64,
        minor_radius: f64,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
    /// ADR-033 Phase E — Bezier patch (tensor product Bezier surface).
    /// `ctrl_grid` is `(deg_u + 1) × (deg_v + 1)` row-major. Range: `[0, 1]²`.
    BezierPatch {
        ctrl_grid: Vec<Vec<DVec3>>,
    },
    /// ADR-033 Phase E — Tensor product B-spline surface.
    BSplineSurface {
        ctrl_grid: Vec<Vec<DVec3>>,
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: u32,
        deg_v: u32,
    },
    /// ADR-033 Phase E — NURBS surface (rational tensor-product) +
    /// optional 2D parameter-space trim loops.
    NURBSSurface {
        ctrl_grid: Vec<Vec<DVec3>>,
        weights: Vec<Vec<f64>>,
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: u32,
        deg_v: u32,
        #[serde(default)]
        trim_loops: Vec<TrimLoop>,
    },
}

/// Result of surface tessellation — triangle mesh with UV coordinates.
#[derive(Clone, Debug)]
pub struct SurfaceTessellation {
    pub vertices: Vec<DVec3>,
    pub triangles: Vec<[u32; 3]>,
    pub uv: Vec<[f64; 2]>,
}

/// Common operations across all surface primitives.
pub trait SurfaceOps {
    /// Evaluate surface at parameters (u, v).
    fn evaluate(&self, u: f64, v: f64) -> DVec3;

    /// Outward unit normal at (u, v). For degenerate points (poles) returns
    /// a best-effort fallback unit vector.
    fn normal(&self, u: f64, v: f64) -> DVec3;

    /// Partial derivative ∂P/∂u (tangent in u direction).
    fn derivative_u(&self, u: f64, v: f64) -> DVec3;

    /// Partial derivative ∂P/∂v (tangent in v direction).
    fn derivative_v(&self, u: f64, v: f64) -> DVec3;

    /// Valid parameter ranges `((u_min, u_max), (v_min, v_max))`.
    fn parameter_range(&self) -> ((f64, f64), (f64, f64));

    /// Tessellate to a triangle mesh with chord error ≤ `chord_tol`.
    fn tessellate(&self, chord_tol: f64) -> SurfaceTessellation;
}

impl SurfaceOps for AnalyticSurface {
    fn evaluate(&self, u: f64, v: f64) -> DVec3 {
        match self {
            AnalyticSurface::Plane { origin, normal, basis_u, .. } =>
                plane::evaluate(*origin, *normal, *basis_u, u, v),
            AnalyticSurface::Cylinder { axis_origin, axis_dir, radius, ref_dir, .. } =>
                cylinder::evaluate(*axis_origin, *axis_dir, *radius, *ref_dir, u, v),
            AnalyticSurface::Sphere { center, radius, .. } =>
                sphere::evaluate(*center, *radius, u, v),
            AnalyticSurface::Cone { apex, axis_dir, half_angle, ref_dir, .. } =>
                cone::evaluate(*apex, *axis_dir, *half_angle, *ref_dir, u, v),
            AnalyticSurface::Torus { center, axis_dir, ref_dir, major_radius, minor_radius, .. } =>
                torus::evaluate(*center, *axis_dir, *ref_dir, *major_radius, *minor_radius, u, v),
            AnalyticSurface::BezierPatch { ctrl_grid } =>
                bezier_patch::evaluate(ctrl_grid, u, v).unwrap_or(DVec3::ZERO),
            AnalyticSurface::BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v } =>
                bspline_surface::evaluate(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO),
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, ..
            } => nurbs_surface::evaluate(
                ctrl_grid, weights, knots_u, knots_v,
                *deg_u as usize, *deg_v as usize, u, v,
            ).unwrap_or(DVec3::ZERO),
        }
    }

    fn normal(&self, u: f64, v: f64) -> DVec3 {
        match self {
            AnalyticSurface::Plane { normal, .. } => normal.normalize_or_zero(),
            AnalyticSurface::Cylinder { axis_origin, axis_dir, ref_dir, .. } =>
                cylinder::normal(*axis_origin, *axis_dir, *ref_dir, u, v),
            AnalyticSurface::Sphere { center, radius, .. } =>
                sphere::normal(*center, *radius, u, v),
            AnalyticSurface::Cone { apex, axis_dir, half_angle, ref_dir, .. } =>
                cone::normal(*apex, *axis_dir, *half_angle, *ref_dir, u, v),
            AnalyticSurface::Torus { center, axis_dir, ref_dir, major_radius, minor_radius, .. } =>
                torus::normal(*center, *axis_dir, *ref_dir, *major_radius, *minor_radius, u, v),
            AnalyticSurface::BezierPatch { ctrl_grid } =>
                bezier_patch::normal(ctrl_grid, u, v).unwrap_or(DVec3::Z),
            AnalyticSurface::BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v } => {
                let du = bspline_surface::derivative_u(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO);
                let dv = bspline_surface::derivative_v(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO);
                du.cross(dv).normalize_or_zero()
            }
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, ..
            } => {
                let du = nurbs_surface::derivative_u(
                    ctrl_grid, weights, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO);
                let dv = nurbs_surface::derivative_v(
                    ctrl_grid, weights, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO);
                du.cross(dv).normalize_or_zero()
            }
        }
    }

    fn derivative_u(&self, u: f64, v: f64) -> DVec3 {
        match self {
            AnalyticSurface::Plane { basis_u, .. } => *basis_u,
            AnalyticSurface::Cylinder { axis_dir, radius, ref_dir, .. } =>
                cylinder::derivative_u(*axis_dir, *radius, *ref_dir, u, v),
            AnalyticSurface::Sphere { radius, .. } =>
                sphere::derivative_u(*radius, u, v),
            AnalyticSurface::Cone { axis_dir, half_angle, ref_dir, .. } =>
                cone::derivative_u(*axis_dir, *half_angle, *ref_dir, u, v),
            AnalyticSurface::Torus { axis_dir, ref_dir, major_radius, minor_radius, .. } =>
                torus::derivative_u(*axis_dir, *ref_dir, *major_radius, *minor_radius, u, v),
            AnalyticSurface::BezierPatch { ctrl_grid } =>
                bezier_patch::derivative_u(ctrl_grid, u, v).unwrap_or(DVec3::ZERO),
            AnalyticSurface::BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v } =>
                bspline_surface::derivative_u(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO),
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, ..
            } => nurbs_surface::derivative_u(
                ctrl_grid, weights, knots_u, knots_v,
                *deg_u as usize, *deg_v as usize, u, v,
            ).unwrap_or(DVec3::ZERO),
        }
    }

    fn derivative_v(&self, u: f64, v: f64) -> DVec3 {
        match self {
            AnalyticSurface::Plane { normal, basis_u, .. } => normal.cross(*basis_u),
            AnalyticSurface::Cylinder { axis_dir, .. } => *axis_dir,
            AnalyticSurface::Sphere { radius, .. } =>
                sphere::derivative_v(*radius, u, v),
            AnalyticSurface::Cone { axis_dir, half_angle, ref_dir, .. } =>
                cone::derivative_v(*axis_dir, *half_angle, *ref_dir, u, v),
            AnalyticSurface::Torus { axis_dir, ref_dir, minor_radius, .. } =>
                torus::derivative_v(*axis_dir, *ref_dir, *minor_radius, u, v),
            AnalyticSurface::BezierPatch { ctrl_grid } =>
                bezier_patch::derivative_v(ctrl_grid, u, v).unwrap_or(DVec3::ZERO),
            AnalyticSurface::BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v } =>
                bspline_surface::derivative_v(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, u, v,
                ).unwrap_or(DVec3::ZERO),
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, ..
            } => nurbs_surface::derivative_v(
                ctrl_grid, weights, knots_u, knots_v,
                *deg_u as usize, *deg_v as usize, u, v,
            ).unwrap_or(DVec3::ZERO),
        }
    }

    fn parameter_range(&self) -> ((f64, f64), (f64, f64)) {
        match self {
            AnalyticSurface::Plane { u_range, v_range, .. }
            | AnalyticSurface::Cylinder { u_range, v_range, .. }
            | AnalyticSurface::Sphere { u_range, v_range, .. }
            | AnalyticSurface::Cone { u_range, v_range, .. }
            | AnalyticSurface::Torus { u_range, v_range, .. } => (*u_range, *v_range),
            AnalyticSurface::BezierPatch { .. } => ((0.0, 1.0), (0.0, 1.0)),
            AnalyticSurface::BSplineSurface { knots_u, knots_v, deg_u, deg_v, ctrl_grid } => {
                let u_range = if knots_u.len() >= *deg_u as usize + 1 + ctrl_grid.len() {
                    (knots_u[*deg_u as usize], knots_u[ctrl_grid.len()])
                } else { (0.0, 1.0) };
                let v_range = if !ctrl_grid.is_empty()
                    && knots_v.len() >= *deg_v as usize + 1 + ctrl_grid[0].len()
                {
                    (knots_v[*deg_v as usize], knots_v[ctrl_grid[0].len()])
                } else { (0.0, 1.0) };
                (u_range, v_range)
            }
            AnalyticSurface::NURBSSurface { knots_u, knots_v, deg_u, deg_v, ctrl_grid, .. } => {
                let u_range = if knots_u.len() >= *deg_u as usize + 1 + ctrl_grid.len() {
                    (knots_u[*deg_u as usize], knots_u[ctrl_grid.len()])
                } else { (0.0, 1.0) };
                let v_range = if !ctrl_grid.is_empty()
                    && knots_v.len() >= *deg_v as usize + 1 + ctrl_grid[0].len()
                {
                    (knots_v[*deg_v as usize], knots_v[ctrl_grid[0].len()])
                } else { (0.0, 1.0) };
                (u_range, v_range)
            }
        }
    }

    fn tessellate(&self, chord_tol: f64) -> SurfaceTessellation {
        let ((u0, u1), (v0, v1)) = self.parameter_range();
        // Determine grid resolution per axis based on surface-specific scale.
        let (n_u, n_v) = self.tessellation_resolution(chord_tol);
        build_grid_tessellation(self, u0, u1, v0, v1, n_u, n_v)
    }
}

impl AnalyticSurface {
    /// Surface-specific tessellation resolution heuristic.
    fn tessellation_resolution(&self, chord_tol: f64) -> (usize, usize) {
        let ((u0, u1), (v0, v1)) = self.parameter_range();
        let u_span = u1 - u0;
        let v_span = v1 - v0;
        let chord_tol = chord_tol.max(1e-6);
        match self {
            AnalyticSurface::Plane { .. } => (2, 2),  // 1 quad
            AnalyticSurface::Cylinder { radius, .. } => {
                let n_u = sagitta_segments(*radius, u_span, chord_tol).max(8);
                let n_v = ((v_span / chord_tol).ceil().max(2.0) as usize).min(256).max(2);
                (n_u, n_v)
            }
            AnalyticSurface::Sphere { radius, .. } => {
                let n_u = sagitta_segments(*radius, u_span, chord_tol).max(8);
                let n_v = sagitta_segments(*radius, v_span, chord_tol).max(4);
                (n_u, n_v)
            }
            AnalyticSurface::Cone { half_angle, v_range, .. } => {
                let r_max = v_range.1 * half_angle.sin();
                let n_u = sagitta_segments(r_max.max(1e-9), u_span, chord_tol).max(8);
                let n_v = ((v_span / chord_tol).ceil().max(2.0) as usize).min(256).max(2);
                (n_u, n_v)
            }
            AnalyticSurface::Torus { major_radius, minor_radius, .. } => {
                let n_u = sagitta_segments(*major_radius + *minor_radius, u_span, chord_tol).max(16);
                let n_v = sagitta_segments(*minor_radius, v_span, chord_tol).max(8);
                (n_u, n_v)
            }
            // Phase E free-form surfaces — heuristic based on control-grid size and span.
            AnalyticSurface::BezierPatch { ctrl_grid }
            | AnalyticSurface::BSplineSurface { ctrl_grid, .. }
            | AnalyticSurface::NURBSSurface { ctrl_grid, .. } => {
                let n_u_ctrl = ctrl_grid.len().max(2);
                let n_v_ctrl = ctrl_grid.first().map(|r| r.len()).unwrap_or(2).max(2);
                // Roughly 4 segments per control-segment, scaled by chord tol.
                let _ = chord_tol;
                let n_u = (n_u_ctrl * 4).clamp(8, 256);
                let n_v = (n_v_ctrl * 4).clamp(8, 256);
                (n_u, n_v)
            }
        }
    }
}

/// Sagitta-based segment count for a circular arc of radius `r` over angle
/// `total_angle` (radians) with chord tolerance `chord_tol`.
fn sagitta_segments(r: f64, total_angle: f64, chord_tol: f64) -> usize {
    if r <= 0.0 || total_angle.abs() < 1e-12 {
        return 1;
    }
    let ratio = (chord_tol / r).clamp(0.0, 1.999_999);
    if ratio <= 0.0 {
        return ((total_angle.abs() * 16.0) as usize).max(8);
    }
    let delta = 2.0 * (1.0 - ratio).acos();
    if delta <= 1e-9 {
        return ((total_angle.abs() * 16.0) as usize).max(8);
    }
    ((total_angle.abs() / delta).ceil() as usize).max(8)
}

/// Build a triangle mesh by sampling the surface on a (n_u + 1) × (n_v + 1) grid.
fn build_grid_tessellation(
    surface: &AnalyticSurface,
    u0: f64, u1: f64, v0: f64, v1: f64,
    n_u: usize, n_v: usize,
) -> SurfaceTessellation {
    let mut vertices = Vec::with_capacity((n_u + 1) * (n_v + 1));
    let mut uv = Vec::with_capacity((n_u + 1) * (n_v + 1));
    for j in 0..=n_v {
        let v = v0 + (v1 - v0) * (j as f64) / (n_v as f64);
        for i in 0..=n_u {
            let u = u0 + (u1 - u0) * (i as f64) / (n_u as f64);
            vertices.push(surface.evaluate(u, v));
            uv.push([u, v]);
        }
    }
    let mut triangles = Vec::with_capacity(n_u * n_v * 2);
    let stride = (n_u + 1) as u32;
    for j in 0..n_v as u32 {
        for i in 0..n_u as u32 {
            let i00 = j * stride + i;
            let i10 = i00 + 1;
            let i01 = i00 + stride;
            let i11 = i01 + 1;
            triangles.push([i00, i10, i11]);
            triangles.push([i00, i11, i01]);
        }
    }
    SurfaceTessellation { vertices, triangles, uv }
}

/// Helper: orthonormalize `ref_dir` against `axis_dir` (Gram-Schmidt + renorm).
/// Returns a unit vector perpendicular to `axis_dir` in the plane spanned by
/// (axis_dir, ref_dir). If they're parallel, returns an arbitrary perpendicular.
pub(crate) fn orthonormal_ref(axis_dir: DVec3, ref_dir: DVec3) -> DVec3 {
    let axis = axis_dir.normalize_or_zero();
    let proj = ref_dir - axis * axis.dot(ref_dir);
    if proj.length_squared() < 1e-18 {
        // ref parallel to axis — pick arbitrary perpendicular.
        let seed = if axis.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        seed.cross(axis).normalize_or_zero()
    } else {
        proj.normalize_or_zero()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_range_plane() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-5.0, 5.0), v_range: (-3.0, 3.0),
        };
        let ((u0, u1), (v0, v1)) = p.parameter_range();
        assert_eq!((u0, u1), (-5.0, 5.0));
        assert_eq!((v0, v1), (-3.0, 3.0));
    }

    #[test]
    fn orthonormal_ref_handles_parallel() {
        let axis = DVec3::Z;
        let parallel = DVec3::Z * 5.0;
        let result = orthonormal_ref(axis, parallel);
        // Should pick an arbitrary perpendicular.
        assert!(result.dot(axis).abs() < 1e-9);
        assert!((result.length() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn orthonormal_ref_orthogonalizes() {
        let axis = DVec3::Z;
        let raw = DVec3::new(1.0, 0.0, 5.0);  // X + 5Z
        let result = orthonormal_ref(axis, raw);
        // Should reduce to +X (after stripping Z component and normalizing).
        assert!((result - DVec3::X).length() < 1e-9);
    }

    #[test]
    fn sagitta_segments_zero_radius_returns_one() {
        assert_eq!(sagitta_segments(0.0, std::f64::consts::PI, 0.1), 1);
    }

    #[test]
    fn sagitta_segments_zero_angle_returns_one() {
        assert_eq!(sagitta_segments(5.0, 0.0, 0.1), 1);
    }

    #[test]
    fn sagitta_segments_quarter_circle_at_least_8() {
        let n = sagitta_segments(50.0, std::f64::consts::FRAC_PI_2, 0.5);
        assert!(n >= 8);
    }

    #[test]
    fn tessellate_plane_returns_quad() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (0.0, 10.0), v_range: (0.0, 10.0),
        };
        let mesh = p.tessellate(1.0);
        assert_eq!(mesh.vertices.len(), 9);  // (n_u+1)*(n_v+1) with n_u=n_v=2
        assert_eq!(mesh.triangles.len(), 8);  // n_u*n_v*2
    }
}
