//! ADR-053 Phase H Step 4 — Surface curvature analysis.
//!
//! Provides Gaussian K and mean H curvature for analytic primitives via
//! closed-form (where available) and via numerical 2nd-derivative for
//! general parametric variants.
//!
//! Analytic shortcuts (current Phase H scope):
//!   - Plane:    K = 0, H = 0
//!   - Sphere:   K = 1/r², H = 1/r (outward normal convention)
//!   - Cylinder: K = 0, H = 1/(2r)
//!
//! Other variants (Cone / Torus / patch family) — numerical via central
//! difference second derivatives + first/second fundamental form.

use glam::DVec3;
use super::{AnalyticSurface, SurfaceOps};

impl AnalyticSurface {
    /// Gaussian curvature K = (LN - M²)/(EG - F²).
    pub fn gaussian_curvature_at(&self, u: f64, v: f64) -> f64 {
        match self {
            // Plane is flat
            AnalyticSurface::Plane { .. } => 0.0,
            // Sphere: K = 1/r²
            AnalyticSurface::Sphere { radius, .. } => 1.0 / (radius * radius),
            // Cylinder: K = 0 (developable)
            AnalyticSurface::Cylinder { .. } => 0.0,
            // Cone: K = 0 except at apex (developable surface)
            AnalyticSurface::Cone { .. } => 0.0,
            // Torus: K = cos(v) / (r_min · (R + r_min · cos(v)))
            AnalyticSurface::Torus { major_radius, minor_radius, .. } => {
                let cos_v = v.cos();
                let denom = minor_radius * (major_radius + minor_radius * cos_v);
                if denom.abs() < 1e-12 { 0.0 } else { cos_v / denom }
            }
            // Patch family — numerical fallback
            _ => self.gaussian_curvature_numerical(u, v),
        }
    }

    /// Mean curvature H = (EN + GL - 2FM) / (2(EG - F²)).
    pub fn mean_curvature_at(&self, u: f64, v: f64) -> f64 {
        match self {
            AnalyticSurface::Plane { .. } => 0.0,
            // Sphere: H = 1/r (outward normal convention)
            AnalyticSurface::Sphere { radius, .. } => 1.0 / radius,
            // Cylinder: H = 1/(2r)
            AnalyticSurface::Cylinder { radius, .. } => 1.0 / (2.0 * radius),
            // Cone: H = cot(half_angle) / (2v) — varies along v
            AnalyticSurface::Cone { half_angle, .. } => {
                if v.abs() < 1e-9 { 0.0 } else {
                    half_angle.cos() / (2.0 * v * half_angle.sin())
                }
            }
            // Torus: H = (R + 2 r_min cos v) / (2 r_min (R + r_min cos v))
            AnalyticSurface::Torus { major_radius, minor_radius, .. } => {
                let cos_v = v.cos();
                let r_eff = major_radius + minor_radius * cos_v;
                let denom = 2.0 * minor_radius * r_eff;
                if denom.abs() < 1e-12 { 0.0 } else {
                    (major_radius + 2.0 * minor_radius * cos_v) / denom
                }
            }
            _ => self.mean_curvature_numerical(u, v),
        }
    }

    /// Principal curvatures (κ_max, κ_min) via H ± √(H² - K).
    pub fn principal_curvatures_at(&self, u: f64, v: f64) -> (f64, f64) {
        let h = self.mean_curvature_at(u, v);
        let k = self.gaussian_curvature_at(u, v);
        let disc = (h * h - k).max(0.0).sqrt();
        (h + disc, h - disc)
    }

    // ── Numerical helpers (control-point variants) ──

    fn second_derivative_uu_numerical(&self, u: f64, v: f64) -> DVec3 {
        let ((u0, u1), _) = self.parameter_range();
        let span = u1 - u0;
        let h = (span * 1e-4).max(1e-7);
        let um = if u - h < u0 { u0 + h } else { u - h };
        let up = if u + h > u1 { u1 - h } else { u + h };
        (self.derivative_u(up, v) - self.derivative_u(um, v)) / (2.0 * h)
    }
    fn second_derivative_vv_numerical(&self, u: f64, v: f64) -> DVec3 {
        let (_, (v0, v1)) = self.parameter_range();
        let span = v1 - v0;
        let h = (span * 1e-4).max(1e-7);
        let vm = if v - h < v0 { v0 + h } else { v - h };
        let vp = if v + h > v1 { v1 - h } else { v + h };
        (self.derivative_v(u, vp) - self.derivative_v(u, vm)) / (2.0 * h)
    }
    fn second_derivative_uv_numerical(&self, u: f64, v: f64) -> DVec3 {
        let (_, (v0, v1)) = self.parameter_range();
        let span = v1 - v0;
        let h = (span * 1e-4).max(1e-7);
        let vm = if v - h < v0 { v0 + h } else { v - h };
        let vp = if v + h > v1 { v1 - h } else { v + h };
        (self.derivative_u(u, vp) - self.derivative_u(u, vm)) / (2.0 * h)
    }

    fn fundamental_forms(&self, u: f64, v: f64) -> ((f64, f64, f64), (f64, f64, f64)) {
        let ru = self.derivative_u(u, v);
        let rv = self.derivative_v(u, v);
        let n = self.normal(u, v);
        let e = ru.dot(ru); let f = ru.dot(rv); let g = rv.dot(rv);
        let l = self.second_derivative_uu_numerical(u, v).dot(n);
        let m = self.second_derivative_uv_numerical(u, v).dot(n);
        let nn = self.second_derivative_vv_numerical(u, v).dot(n);
        ((e, f, g), (l, m, nn))
    }

    fn gaussian_curvature_numerical(&self, u: f64, v: f64) -> f64 {
        let ((e, f, g), (l, m, n)) = self.fundamental_forms(u, v);
        let det1 = e * g - f * f;
        if det1.abs() < 1e-12 { 0.0 } else { (l * n - m * m) / det1 }
    }
    fn mean_curvature_numerical(&self, u: f64, v: f64) -> f64 {
        let ((e, f, g), (l, m, n)) = self.fundamental_forms(u, v);
        let det1 = e * g - f * f;
        if det1.abs() < 1e-12 { 0.0 } else { (e * n + g * l - 2.0 * f * m) / (2.0 * det1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-053 §2.7 (curvature) — Plane has K=H=0 everywhere.
    #[test]
    fn plane_has_zero_curvature() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        assert_eq!(p.gaussian_curvature_at(0.0, 0.0), 0.0);
        assert_eq!(p.mean_curvature_at(0.0, 0.0), 0.0);
    }

    /// Sphere of radius r has K = 1/r², H = 1/r.
    #[test]
    fn sphere_gaussian_and_mean_curvature() {
        let s = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 2.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let k = s.gaussian_curvature_at(0.5, 0.3);
        let h = s.mean_curvature_at(0.5, 0.3);
        assert!((k - 0.25).abs() < 1e-12, "K should be 1/4, got {}", k);
        assert!((h - 0.5).abs() < 1e-12, "H should be 1/2, got {}", h);
    }

    /// Cylinder: K = 0 (developable), H = 1/(2r).
    #[test]
    fn cylinder_curvatures() {
        let c = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z,
            radius: 4.0, ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 10.0),
        };
        assert_eq!(c.gaussian_curvature_at(0.5, 5.0), 0.0);
        let h = c.mean_curvature_at(0.5, 5.0);
        assert!((h - 0.125).abs() < 1e-12, "H should be 1/8, got {}", h);
    }

    /// Principal curvatures: κ_max + κ_min = 2H, κ_max · κ_min = K.
    #[test]
    fn principal_curvatures_consistent_with_h_k() {
        let s = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 3.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let (k1, k2) = s.principal_curvatures_at(0.0, 0.0);
        let h = s.mean_curvature_at(0.0, 0.0);
        let k = s.gaussian_curvature_at(0.0, 0.0);
        assert!(((k1 + k2) - 2.0 * h).abs() < 1e-12);
        assert!((k1 * k2 - k).abs() < 1e-12);
        // For sphere both principal curvatures equal 1/r
        assert!((k1 - k2).abs() < 1e-12);
    }
}
