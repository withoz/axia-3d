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
pub mod merge;

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

/// ADR-103-ε-2 — Rotate a DVec3 from Y-up to Z-up convention.
/// `(x, y, z) → (x, -z, y)`. +90° rotation around +X axis.
#[inline]
fn rotate_y_to_z(v: DVec3) -> DVec3 {
    DVec3::new(v.x, -v.z, v.y)
}

impl AnalyticSurface {
    /// ADR-103-ε-2 — Migrate all world-space DVec3 fields (positions +
    /// direction vectors) from Y-up to Z-up coordinate convention. Used
    /// by `Scene::import_versioned_snapshot` V2 → V3 path so attached
    /// surfaces remain visually consistent with the rotated mesh.
    ///
    /// **Scope**: position fields (origin/center/apex/axis_origin) and
    /// direction fields (normal/axis_dir/ref_dir/basis_u) of all primitive
    /// variants. Control grids of NURBS-class variants
    /// (BezierPatch/BSplineSurface/NURBSSurface) are rotated point-wise.
    /// 2D trim loops on NURBSSurface live in (u, v) parameter space and
    /// are *not* rotated.
    ///
    /// Sphere's u/v range is preserved as numeric values; semantically a
    /// V2 sphere's "north cap (v near π/2)" is +Y polar after rotation
    /// becomes "+Z polar" which is consistent with Z-up engine convention
    /// — no rotation needed for the parameterization itself.
    pub fn migrate_y_up_to_z_up(&mut self) {
        match self {
            AnalyticSurface::Plane { origin, normal, basis_u, .. } => {
                *origin = rotate_y_to_z(*origin);
                *normal = rotate_y_to_z(*normal);
                *basis_u = rotate_y_to_z(*basis_u);
            }
            AnalyticSurface::Cylinder { axis_origin, axis_dir, ref_dir, .. } => {
                *axis_origin = rotate_y_to_z(*axis_origin);
                *axis_dir = rotate_y_to_z(*axis_dir);
                *ref_dir = rotate_y_to_z(*ref_dir);
            }
            AnalyticSurface::Sphere { center, .. } => {
                *center = rotate_y_to_z(*center);
            }
            AnalyticSurface::Cone { apex, axis_dir, ref_dir, .. } => {
                *apex = rotate_y_to_z(*apex);
                *axis_dir = rotate_y_to_z(*axis_dir);
                *ref_dir = rotate_y_to_z(*ref_dir);
            }
            AnalyticSurface::Torus { center, axis_dir, ref_dir, .. } => {
                *center = rotate_y_to_z(*center);
                *axis_dir = rotate_y_to_z(*axis_dir);
                *ref_dir = rotate_y_to_z(*ref_dir);
            }
            AnalyticSurface::BezierPatch { ctrl_grid } => {
                for row in ctrl_grid {
                    for p in row { *p = rotate_y_to_z(*p); }
                }
            }
            AnalyticSurface::BSplineSurface { ctrl_grid, .. } => {
                for row in ctrl_grid {
                    for p in row { *p = rotate_y_to_z(*p); }
                }
            }
            AnalyticSurface::NURBSSurface { ctrl_grid, .. } => {
                for row in ctrl_grid {
                    for p in row { *p = rotate_y_to_z(*p); }
                }
                // 2D trim_loops are in parameter space — no world rotation.
            }
        }
    }
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
    /// ADR-061 Phase P-narrow Step 3 — Closed-form surface normal at a
    /// world-space point ON or NEAR the surface.
    ///
    /// For primitives (Plane/Cylinder/Sphere/Cone/Torus), this avoids
    /// `(u, v)` parameter inversion by exploiting geometric construction
    /// from the surface's defining axes/centers. For tensor variants
    /// (BezierPatch/BSplineSurface/NURBSSurface) Step 3 returns a
    /// placeholder `normal(0.5, 0.5)` — proper inversion is deferred.
    ///
    /// **Caller contract**: `pos` should be on or near the surface
    /// (e.g., a face's outer-loop vertex). For points far from the
    /// surface the result is unspecified.
    ///
    /// Used by `Mesh::face_cached_normals_or_compute` to populate the
    /// Z.1 NormalCacheEntry.
    pub fn normal_at_world_pos(&self, pos: DVec3) -> DVec3 {
        use AnalyticSurface as S;
        match self {
            S::Plane { normal, .. } => normal.normalize_or_zero(),
            S::Cylinder { axis_origin, axis_dir, .. } => {
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *axis_origin;
                let along = v.dot(axis);
                (v - axis * along).normalize_or_zero()
            }
            S::Sphere { center, .. } => (pos - *center).normalize_or_zero(),
            S::Cone { apex, axis_dir, half_angle, .. } => {
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *apex;
                let along = v.dot(axis);
                let radial = (v - axis * along).normalize_or_zero();
                // Normal rotated half_angle from radial toward -axis.
                (radial * half_angle.cos() - axis * half_angle.sin()).normalize_or_zero()
            }
            S::Torus { center, axis_dir, major_radius, .. } => {
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *center;
                let along = v.dot(axis);
                let in_plane = (v - axis * along).normalize_or_zero();
                let ring_center = *center + in_plane * *major_radius;
                (pos - ring_center).normalize_or_zero()
            }
            // Tensor variants — placeholder. Step 4+ will add uv inversion.
            S::BezierPatch { .. } | S::BSplineSurface { .. } | S::NURBSSurface { .. } => {
                use crate::surfaces::SurfaceOps;
                self.normal(0.5, 0.5)
            }
        }
    }

    /// ADR-062 Phase L₂ Path Z — Stable label per surface variant.
    /// Used by SurfaceAttachOutcome (UnsupportedSurfaceKind, previous_kind)
    /// and JSON telemetry. SSOT — change here propagates everywhere.
    pub fn kind_label(&self) -> &'static str {
        match self {
            Self::Plane { .. } => "Plane",
            Self::Cylinder { .. } => "Cylinder",
            Self::Sphere { .. } => "Sphere",
            Self::Cone { .. } => "Cone",
            Self::Torus { .. } => "Torus",
            Self::BezierPatch { .. } => "BezierPatch",
            Self::BSplineSurface { .. } => "BSplineSurface",
            Self::NURBSSurface { .. } => "NURBSSurface",
        }
    }

    /// ADR-062 Phase L₂ Path Z §C — Detect degenerate parameter inputs
    /// before boundary distance evaluation. Returns `None` if the
    /// surface is well-formed; otherwise a short reason string suitable
    /// for `SurfaceAttachOutcome::DegenerateSurfaceInput { reason }`.
    ///
    /// Tensor variants always return `None` here — they are screened
    /// by the `UnsupportedSurfaceKind` outcome path before this check.
    pub fn degeneracy_reason(&self) -> Option<&'static str> {
        const EPS_DIR: f64 = 1e-12;
        match self {
            Self::Plane { normal, basis_u, .. } => {
                if normal.length_squared() < EPS_DIR { Some("plane normal is zero") }
                else if basis_u.length_squared() < EPS_DIR { Some("plane basis_u is zero") }
                else { None }
            }
            Self::Cylinder { axis_dir, radius, .. } => {
                if axis_dir.length_squared() < EPS_DIR { Some("cylinder axis_dir is zero") }
                else if *radius <= 0.0 { Some("cylinder radius is non-positive") }
                else { None }
            }
            Self::Sphere { radius, .. } => {
                if *radius <= 0.0 { Some("sphere radius is non-positive") }
                else { None }
            }
            Self::Cone { axis_dir, half_angle, .. } => {
                if axis_dir.length_squared() < EPS_DIR { Some("cone axis_dir is zero") }
                else if *half_angle <= 0.0 || *half_angle >= std::f64::consts::FRAC_PI_2 {
                    Some("cone half_angle out of (0, pi/2)")
                } else { None }
            }
            Self::Torus { axis_dir, major_radius, minor_radius, .. } => {
                if axis_dir.length_squared() < EPS_DIR { Some("torus axis_dir is zero") }
                else if *major_radius <= 0.0 { Some("torus major_radius is non-positive") }
                else if *minor_radius <= 0.0 { Some("torus minor_radius is non-positive") }
                else { None }
            }
            // Tensor variants: degeneracy not checked here — caller
            // routes them to UnsupportedSurfaceKind separately.
            Self::BezierPatch { .. } | Self::BSplineSurface { .. } | Self::NURBSSurface { .. } => None,
        }
    }

    /// ADR-062 Phase L₂ Path Z §C — Closed-form unsigned distance from
    /// world-space point to the surface.
    ///
    /// Returns `None` for tensor variants (BezierPatch / BSplineSurface
    /// / NURBSSurface) — uv parameter inversion deferred to Path Y.
    /// Caller of `attach_surface_validated` translates `None` to
    /// `UnsupportedSurfaceKind` outcome.
    ///
    /// Returns `Some(f64::INFINITY)` for degenerate evaluation points
    /// (per-kind documented):
    /// - **Torus** (D-B lock-in): `pos` exactly on torus axis (in_plane
    ///   ≈ ZERO) — ring_center undefined → `+∞` forces validated attach
    ///   to reject as `BoundaryDriftExceedsTol`.
    ///
    /// **D-A lock-in (Cone)**: behind-apex points (along `-axis_dir`
    /// from apex) return `|pos - apex|` — apex distance treated as
    /// nearest-surface. Cone's single-direction nature naturally pushes
    /// such points to apex.
    ///
    /// **D-C lock-in**: u_range/v_range trim is IGNORED. Distance is to
    /// the underlying primitive (infinite plane / full cylinder / etc.).
    /// Trim semantics deferred to Path Y full.
    ///
    /// Surface kinds with degenerate parameter inputs (radius ≤ 0,
    /// half_angle out of (0, π/2), axis_dir ≈ ZERO) are NOT detected
    /// here — they should be screened by `attach_surface_validated`'s
    /// pre-check returning `DegenerateSurfaceInput { reason }`.
    pub fn unsigned_distance_to(&self, pos: DVec3) -> Option<f64> {
        use AnalyticSurface as S;
        match self {
            S::Plane { origin, normal, .. } => {
                let n = normal.normalize_or_zero();
                Some(((pos - *origin).dot(n)).abs())
            }
            S::Cylinder { axis_origin, axis_dir, radius, .. } => {
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *axis_origin;
                let along = v.dot(axis);
                let radial = (v - axis * along).length();
                Some((radial - *radius).abs())
            }
            S::Sphere { center, radius, .. } => {
                Some(((pos - *center).length() - *radius).abs())
            }
            S::Cone { apex, axis_dir, half_angle, .. } => {
                // Cone surface: ray from apex along +axis_dir, opening
                // at half_angle. Nearest-point distance for an arbitrary
                // pos.
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *apex;
                let along = v.dot(axis);
                if along < 0.0 {
                    // D-A lock-in — behind-apex: nearest is apex.
                    return Some(v.length());
                }
                // In-plane projection magnitude (radial from axis).
                let radial = (v - axis * along).length();
                // Distance to cone surface = perpendicular distance from
                // pos to the cone slant line in the (axis, radial) plane.
                // Slant line passes through apex with direction
                // (sin(α), cos(α)) in (radial, axial) coords.
                let s = half_angle.sin();
                let c = half_angle.cos();
                Some((radial * c - along * s).abs())
            }
            S::Torus { center, axis_dir, major_radius, minor_radius, .. } => {
                let axis = axis_dir.normalize_or_zero();
                let v = pos - *center;
                let along = v.dot(axis);
                let in_plane_vec = v - axis * along;
                let in_plane_len = in_plane_vec.length();
                if in_plane_len < 1e-12 {
                    // D-B lock-in — degenerate (pos on axis): force reject.
                    return Some(f64::INFINITY);
                }
                let in_plane_dir = in_plane_vec / in_plane_len;
                let ring_center = *center + in_plane_dir * *major_radius;
                Some(((pos - ring_center).length() - *minor_radius).abs())
            }
            // Tensor variants — uv inversion deferred (Path Y).
            S::BezierPatch { .. } | S::BSplineSurface { .. } | S::NURBSSurface { .. } => None,
        }
    }

    /// Surface-specific tessellation resolution heuristic.
    fn tessellation_resolution(&self, chord_tol: f64) -> (usize, usize) {
        let ((u0, u1), (v0, v1)) = self.parameter_range();
        let u_span = u1 - u0;
        let v_span = v1 - v0;
        let chord_tol = chord_tol.max(1e-6);
        match self {
            AnalyticSurface::Plane { .. } => (2, 2),  // 1 quad
            AnalyticSurface::Cylinder { radius, .. } => {
                // u (circumferential, curved): chord-tolerance based.
                // v (axial, STRAIGHT): 2 verts sufficient — curvature 0.
                // ADR-088 Phase 1 (S-ζ perf fix, 2026-05-08): 이전 코드는
                // n_v = (v_span/chord_tol).min(256) → 100mm height + 0.1mm
                // tol = 256 verts/face × 16 side faces = 4K+ verts (cylinder
                // 단독). 사용자 시연 (2026-05-08): 생성 속도 너무 느림.
                let n_u = sagitta_segments(*radius, u_span, chord_tol).max(8);
                let n_v = 2;
                (n_u, n_v)
            }
            AnalyticSurface::Sphere { radius, .. } => {
                // u (longitude) and v (latitude) both curved on sphere.
                let n_u = sagitta_segments(*radius, u_span, chord_tol).max(8);
                let n_v = sagitta_segments(*radius, v_span, chord_tol).max(4);
                (n_u, n_v)
            }
            AnalyticSurface::Cone { half_angle, v_range, .. } => {
                // u (circumferential, curved): chord-tolerance based.
                // v (axial along cone slope, STRAIGHT): 2 verts sufficient.
                // ADR-088 Phase 1 (S-ζ perf fix, 2026-05-08).
                let r_max = v_range.1 * half_angle.sin();
                let n_u = sagitta_segments(r_max.max(1e-9), u_span, chord_tol).max(8);
                let n_v = 2;
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

    // ════════════════════════════════════════════════════════════════
    // ADR-062 Phase L₂ Path Z Step 1 — unsigned_distance_to tests
    //
    // 2 regression invariants (none #[ignore]):
    //   1. unsigned_distance_to_known_points_correctness
    //      Per-kind sub-asserts: on-surface = ~0, off-surface = exact.
    //      Includes D-A (Cone behind-apex) + D-B (Torus axis) lock-ins.
    //   2. unsigned_distance_to_tensor_returns_none
    //      Bezier/BSpline/NURBS all return None per pilot scope.
    // ════════════════════════════════════════════════════════════════

    /// ADR-062 Step 1 invariant #1 — Closed-form distance correctness
    /// for all 5 primitive surface kinds, including D-A (Cone behind-apex)
    /// and D-B (Torus axis-on-pos) edge cases.
    #[test]
    fn unsigned_distance_to_known_points_correctness() {
        const EPS: f64 = 1e-9;

        // ── Plane ─────────────────────────────────────────────────
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-10.0, 10.0), v_range: (-10.0, 10.0),
        };
        // On surface (z=0): distance ~ 0
        assert!(plane.unsigned_distance_to(DVec3::new(3.0, 4.0, 0.0)).unwrap().abs() < EPS);
        // 5mm above surface: distance = 5
        assert!((plane.unsigned_distance_to(DVec3::new(1.0, 2.0, 5.0)).unwrap() - 5.0).abs() < EPS);
        // 2mm below: distance = 2 (unsigned)
        assert!((plane.unsigned_distance_to(DVec3::new(0.0, 0.0, -2.0)).unwrap() - 2.0).abs() < EPS);

        // ── Cylinder ──────────────────────────────────────────────
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 10.0),
        };
        // On surface (radius 5, any z, any angle): distance ~ 0
        assert!(cyl.unsigned_distance_to(DVec3::new(5.0, 0.0, 3.0)).unwrap().abs() < EPS);
        assert!(cyl.unsigned_distance_to(DVec3::new(0.0, 5.0, -2.0)).unwrap().abs() < EPS);
        // Inside (radius 3): distance = |3 - 5| = 2
        assert!((cyl.unsigned_distance_to(DVec3::new(3.0, 0.0, 0.0)).unwrap() - 2.0).abs() < EPS);
        // Outside (radius 8): distance = 3
        assert!((cyl.unsigned_distance_to(DVec3::new(8.0, 0.0, 0.0)).unwrap() - 3.0).abs() < EPS);

        // ── Sphere ────────────────────────────────────────────────
        let sph = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 2.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        // On surface (length=2): distance ~ 0
        assert!(sph.unsigned_distance_to(DVec3::new(2.0, 0.0, 0.0)).unwrap().abs() < EPS);
        assert!(sph.unsigned_distance_to(DVec3::new(0.0, 0.0, 2.0)).unwrap().abs() < EPS);
        // Inside (length=1): distance = 1
        assert!((sph.unsigned_distance_to(DVec3::new(1.0, 0.0, 0.0)).unwrap() - 1.0).abs() < EPS);
        // Outside (length=5): distance = 3
        assert!((sph.unsigned_distance_to(DVec3::new(5.0, 0.0, 0.0)).unwrap() - 3.0).abs() < EPS);

        // ── Cone ──────────────────────────────────────────────────
        // 45° half-angle cone, apex at origin, axis +Z.
        let cone = AnalyticSurface::Cone {
            apex: DVec3::ZERO,
            axis_dir: DVec3::Z,
            half_angle: std::f64::consts::FRAC_PI_4,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU), v_range: (0.0, 10.0),
        };
        // On cone surface at z=2 (45°): radial = 2. distance ~ 0
        assert!(cone.unsigned_distance_to(DVec3::new(2.0, 0.0, 2.0)).unwrap().abs() < EPS);
        // D-A lock-in: behind-apex (z=-3): nearest = apex, distance = 3
        let behind = cone.unsigned_distance_to(DVec3::new(0.0, 0.0, -3.0)).unwrap();
        assert!((behind - 3.0).abs() < EPS,
            "D-A: behind-apex must use apex distance, got {}", behind);
        // Inside cone at z=2 (radial=1, expected 2): perpendicular distance.
        // d = |1·cos(45°) - 2·sin(45°)| = |√2/2 - √2| = √2/2 ≈ 0.707
        let inside = cone.unsigned_distance_to(DVec3::new(1.0, 0.0, 2.0)).unwrap();
        assert!((inside - std::f64::consts::FRAC_1_SQRT_2).abs() < EPS);

        // ── Torus ─────────────────────────────────────────────────
        // Major=3, minor=1, axis +Z, center origin.
        let torus = AnalyticSurface::Torus {
            center: DVec3::ZERO, axis_dir: DVec3::Z, ref_dir: DVec3::X,
            major_radius: 3.0, minor_radius: 1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, std::f64::consts::TAU),
        };
        // On surface (major+minor)=4 along +X: distance ~ 0
        assert!(torus.unsigned_distance_to(DVec3::new(4.0, 0.0, 0.0)).unwrap().abs() < EPS);
        // On inner ring (major-minor)=2: distance ~ 0
        assert!(torus.unsigned_distance_to(DVec3::new(2.0, 0.0, 0.0)).unwrap().abs() < EPS);
        // On top of ring (3, 0, 1): distance ~ 0
        assert!(torus.unsigned_distance_to(DVec3::new(3.0, 0.0, 1.0)).unwrap().abs() < EPS);
        // D-B lock-in: pos on axis (origin) → +∞
        let on_axis = torus.unsigned_distance_to(DVec3::new(0.0, 0.0, 0.5)).unwrap();
        assert!(on_axis.is_infinite(),
            "D-B: pos on torus axis must return +∞, got {}", on_axis);
    }

    /// ADR-062 Step 1 invariant #2 — Tensor variants (Bezier/BSpline/
    /// NURBS) all return None per Path Z pilot scope. Caller of
    /// `attach_surface_validated` translates to UnsupportedSurfaceKind.
    #[test]
    fn unsigned_distance_to_tensor_returns_none() {
        let bez = AnalyticSurface::BezierPatch {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0)],
                vec![DVec3::new(1.0, 0.0, 0.0), DVec3::new(1.0, 1.0, 0.0)],
            ],
        };
        assert!(bez.unsigned_distance_to(DVec3::ZERO).is_none(),
            "BezierPatch must return None per Path Z pilot");

        let bsp = AnalyticSurface::BSplineSurface {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0)],
                vec![DVec3::new(1.0, 0.0, 0.0), DVec3::new(1.0, 1.0, 0.0)],
            ],
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 1, deg_v: 1,
        };
        assert!(bsp.unsigned_distance_to(DVec3::ZERO).is_none(),
            "BSplineSurface must return None per Path Z pilot");

        let nrb = AnalyticSurface::NURBSSurface {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0)],
                vec![DVec3::new(1.0, 0.0, 0.0), DVec3::new(1.0, 1.0, 0.0)],
            ],
            weights: vec![vec![1.0, 1.0], vec![1.0, 1.0]],
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 1, deg_v: 1,
            trim_loops: vec![],
        };
        assert!(nrb.unsigned_distance_to(DVec3::ZERO).is_none(),
            "NURBSSurface must return None per Path Z pilot");
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-103-ε-2 — AnalyticSurface Y-up → Z-up rotation
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr103_epsilon2_plane_migrates_origin_normal_basis_u() {
        let mut surf = AnalyticSurface::Plane {
            origin: DVec3::new(1.0, 2.0, 3.0),
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (-10.0, 10.0),
            v_range: (-10.0, 10.0),
        };
        surf.migrate_y_up_to_z_up();
        // (1, 2, 3) → (1, -3, 2). Y → Z (because (0,1,0) → (0,0,1)). X unchanged.
        if let AnalyticSurface::Plane { origin, normal, basis_u, .. } = &surf {
            assert!((*origin - DVec3::new(1.0, -3.0, 2.0)).length() < 1e-9);
            assert!((*normal - DVec3::Z).length() < 1e-9, "Y → Z");
            assert!((*basis_u - DVec3::X).length() < 1e-9, "X unchanged");
        } else { panic!("expected Plane"); }
    }

    #[test]
    fn adr103_epsilon2_cylinder_migrates_axis_dir() {
        let mut surf = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Y,   // Y-up canonical "vertical cylinder"
            radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, 6.283185),
            v_range: (0.0, 10.0),
        };
        surf.migrate_y_up_to_z_up();
        if let AnalyticSurface::Cylinder { axis_dir, ref_dir, .. } = &surf {
            assert!((*axis_dir - DVec3::Z).length() < 1e-9,
                "Y-up cylinder axis Y → Z-up axis Z");
            assert!((*ref_dir - DVec3::X).length() < 1e-9, "ref_dir X unchanged");
        } else { panic!("expected Cylinder"); }
    }

    #[test]
    fn adr103_epsilon2_sphere_migrates_center_only() {
        let mut surf = AnalyticSurface::Sphere {
            center: DVec3::new(0.0, 10.0, 0.0),  // Y-up "elevated" sphere
            radius: 5.0,
            u_range: (0.0, 6.283185),
            v_range: (-1.570796, 1.570796),
        };
        surf.migrate_y_up_to_z_up();
        if let AnalyticSurface::Sphere { center, .. } = &surf {
            // (0, 10, 0) → (0, 0, 10) — Y-up "elevated" → Z-up "elevated"
            assert!((*center - DVec3::new(0.0, 0.0, 10.0)).length() < 1e-9);
        } else { panic!("expected Sphere"); }
    }

    #[test]
    fn adr103_epsilon2_bezier_patch_migrates_all_control_points() {
        let mut surf = AnalyticSurface::BezierPatch {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::Y],
                vec![DVec3::X, DVec3::new(1.0, 1.0, 0.0)],
            ],
        };
        surf.migrate_y_up_to_z_up();
        if let AnalyticSurface::BezierPatch { ctrl_grid } = &surf {
            // (0,1,0) → (0,0,1)
            assert!((ctrl_grid[0][1] - DVec3::Z).length() < 1e-9);
            // (1,1,0) → (1,0,1)
            assert!((ctrl_grid[1][1] - DVec3::new(1.0, 0.0, 1.0)).length() < 1e-9);
        } else { panic!("expected BezierPatch"); }
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-140 β (2026-05-24) — Surface-aware normal_at_world_pos 회귀
    // 자산. 도구 입력 경로 (getDrawPlane surface-aware path) 의 anchor.
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn adr140_cylinder_normal_at_world_pos_is_radial() {
        // Z-axis cylinder radius 5 at origin.
        // Point on surface at angle 0 → normal = +X (radial outward).
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 5.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 10.0),
        };
        let pos = DVec3::new(5.0, 0.0, 4.0);  // on surface, mid-height
        let n = cyl.normal_at_world_pos(pos);
        assert!((n - DVec3::X).length() < 1e-9,
            "Cylinder normal at (5,0,4) must be +X (radial); got {:?}", n);
    }

    #[test]
    fn adr140_sphere_normal_at_world_pos_is_radial() {
        // Sphere radius 5 at origin.
        // Point on equator at (5,0,0) → normal = +X.
        let sph = AnalyticSurface::Sphere {
            center: DVec3::ZERO,
            radius: 5.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let pos = DVec3::new(5.0, 0.0, 0.0);
        let n = sph.normal_at_world_pos(pos);
        assert!((n - DVec3::X).length() < 1e-9,
            "Sphere normal at (5,0,0) must be +X (radial); got {:?}", n);
    }

    #[test]
    fn adr140_plane_normal_at_world_pos_is_normal() {
        // Plane Z=0 with +Z normal — any pos returns +Z.
        let pl = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-10.0, 10.0),
            v_range: (-10.0, 10.0),
        };
        let pos = DVec3::new(3.0, 4.0, 0.0);
        let n = pl.normal_at_world_pos(pos);
        assert!((n - DVec3::Z).length() < 1e-9,
            "Plane normal anywhere must be Z; got {:?}", n);
    }
}
