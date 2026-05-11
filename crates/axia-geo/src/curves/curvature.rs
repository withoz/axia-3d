//! ADR-053 Phase H Step 4-5 — Curvature analysis + G0/G1/G2 continuity.
//!
//! ## Frenet Curvature
//!
//! For a parametric curve r(t), the curvature is
//!   κ(t) = |r'(t) × r''(t)| / |r'(t)|³
//!
//! Analytic shortcuts:
//!   - Line:   κ = 0 everywhere
//!   - Circle: κ = 1/r everywhere
//!   - Arc:    κ = 1/r everywhere
//!   - Other (Bezier/BSpline/NURBS): numerical 2nd derivative via central
//!     difference + Frenet formula
//!
//! ## Continuity
//!
//! G0: positional match (endpoints coincide within tol)
//! G1: G0 + tangent vectors parallel (cos angle ≥ 1 - tol)
//! G2: G1 + curvature scalars match (|κa - κb| ≤ tol)

use anyhow::{bail, Result};
use glam::DVec3;

use super::{AnalyticCurve, CurveOps};
use crate::mesh::Mesh;

impl AnalyticCurve {
    /// Unit tangent vector at parameter `t`.
    /// Returns Err at cusps (zero derivative).
    pub fn tangent_at(&self, t: f64, mesh: &Mesh) -> Result<DVec3> {
        let d = self.derivative(t, mesh)?;
        let n = d.length();
        if n < 1e-12 {
            bail!("tangent undefined: derivative is zero at t={}", t);
        }
        Ok(d / n)
    }

    /// Second derivative — analytic for Line/Circle/Arc, numerical (central
    /// difference) for control-point variants.
    pub fn second_derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3> {
        match self {
            // r'' = 0 for a line
            AnalyticCurve::Line { .. } => Ok(DVec3::ZERO),

            // r(θ) = c + r·(cos·u + sin·v) ⇒ r'' = -r·(cos·u + sin·v) = -(p - c)
            AnalyticCurve::Circle { center, .. }
            | AnalyticCurve::Arc { center, .. } => {
                let p = self.evaluate(t, mesh)?;
                Ok(-(p - *center))
            }

            // Numerical central difference: r''(t) ≈ (r'(t+h) - r'(t-h)) / 2h
            AnalyticCurve::Bezier { .. }
            | AnalyticCurve::BSpline { .. }
            | AnalyticCurve::NURBS { .. } => {
                let (t0, t1) = self.parameter_range();
                let span = t1 - t0;
                let h = (span * 1e-4).max(1e-7);
                // Clamp to safe range for central difference
                let tm = if t - h < t0 { t0 + h } else { t - h };
                let tp = if t + h > t1 { t1 - h } else { t + h };
                let dm = self.derivative(tm, mesh)?;
                let dp = self.derivative(tp, mesh)?;
                Ok((dp - dm) / (2.0 * h))
            }
        }
    }

    /// Frenet curvature κ(t) = |r' × r''| / |r'|³.
    /// Analytic shortcuts:
    ///   - Line:   0
    ///   - Circle: 1/r
    ///   - Arc:    1/r
    pub fn curvature_at(&self, t: f64, mesh: &Mesh) -> Result<f64> {
        match self {
            AnalyticCurve::Line { .. } => Ok(0.0),
            AnalyticCurve::Circle { radius, .. }
            | AnalyticCurve::Arc { radius, .. } => Ok(1.0 / radius),
            _ => {
                let d1 = self.derivative(t, mesh)?;
                let d2 = self.second_derivative(t, mesh)?;
                let n1 = d1.length();
                if n1 < 1e-12 { return Ok(0.0); }
                Ok(d1.cross(d2).length() / n1.powi(3))
            }
        }
    }

    /// Endpoint position at the start of `parameter_range`.
    pub fn start_point(&self, mesh: &Mesh) -> Result<DVec3> {
        let (t0, _) = self.parameter_range();
        self.evaluate(t0, mesh)
    }

    /// Endpoint position at the end of `parameter_range`.
    pub fn end_point(&self, mesh: &Mesh) -> Result<DVec3> {
        let (_, t1) = self.parameter_range();
        self.evaluate(t1, mesh)
    }

    /// G0 — positional continuity at junction.
    /// Tests whether `self.end_point()` ≈ `other.start_point()` within `tol`.
    pub fn is_g0_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool> {
        let a = self.end_point(mesh)?;
        let b = other.start_point(mesh)?;
        Ok((a - b).length() <= tol)
    }

    /// G1 — tangent continuity. Requires G0 + tangent direction match
    /// (cos θ ≥ 1 - tol_angle).
    pub fn is_g1_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool> {
        if !self.is_g0_to(other, mesh, tol)? { return Ok(false); }
        let (_, t1_a) = self.parameter_range();
        let (t0_b, _) = other.parameter_range();
        let ta = self.tangent_at(t1_a, mesh)?;
        let tb = other.tangent_at(t0_b, mesh)?;
        // Allow opposite-sign matching (some pipelines flip orientation
        // — for hard G1 use tol on dot directly without abs).
        Ok(ta.dot(tb) >= 1.0 - tol)
    }

    /// G2 — curvature continuity. Requires G1 + |κa - κb| ≤ tol_curv.
    pub fn is_g2_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool> {
        if !self.is_g1_to(other, mesh, tol)? { return Ok(false); }
        let (_, t1_a) = self.parameter_range();
        let (t0_b, _) = other.parameter_range();
        let ka = self.curvature_at(t1_a, mesh)?;
        let kb = other.curvature_at(t0_b, mesh)?;
        Ok((ka - kb).abs() <= tol)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::id::VertId;
    use crate::mesh::Mesh;

    /// ADR-053 §2.7 #12 — tangent_at returns unit length after transform.
    /// Here just basic smoke: tangent at θ=0 of unit circle is +Y.
    #[test]
    fn tangent_unit_length_circle() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 1.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let t = c.tangent_at(0.0, &mesh).unwrap();
        // r(θ) = (cos θ, sin θ, 0); r'(θ) = (-sin θ, cos θ, 0); at θ=0 → (0,1,0)
        assert!((t - DVec3::Y).length() < 1e-12, "expected +Y tangent, got {:?}", t);
        assert!((t.length() - 1.0).abs() < 1e-12);
    }

    /// Curvature of unit circle = 1.
    #[test]
    fn curvature_circle_is_one_over_radius() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 4.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let k = c.curvature_at(0.5, &mesh).unwrap();
        assert!((k - 0.25).abs() < 1e-12, "expected 1/4 = 0.25, got {}", k);
    }

    /// Curvature of line = 0 everywhere.
    #[test]
    fn curvature_line_is_zero() {
        let mesh = Mesh::new();
        let line = AnalyticCurve::Line {
            start: VertId::default(), end: VertId::default(),
        };
        // Line uses VertIds; with default mesh evaluate would fail, but
        // the analytic shortcut returns 0 without consulting mesh. Bypass.
        let k = line.curvature_at(0.5, &mesh).unwrap();
        assert_eq!(k, 0.0);
    }

    /// ADR-053 §2.7 #21 — G1 between two collinear arcs sharing tangent.
    #[test]
    fn g1_between_two_collinear_arcs() {
        let mesh = Mesh::new();
        // Half circle at top, then continuing half circle = full circle
        let a = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 1.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        let b = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 1.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: std::f64::consts::PI,
            end_angle: 2.0 * std::f64::consts::PI,
        };
        // Endpoint of `a` at θ=π is (-1, 0); start of `b` at θ=π is also (-1, 0).
        // Tangents at the seam are both (0, -1).
        assert!(a.is_g0_to(&b, &mesh, 1e-9).unwrap());
        assert!(a.is_g1_to(&b, &mesh, 1e-9).unwrap());
        // Same circle → same curvature 1.0
        assert!(a.is_g2_to(&b, &mesh, 1e-9).unwrap());
    }

    /// G2 violated when two arcs share G1 but have different radii.
    #[test]
    fn g2_violated_when_curvatures_differ() {
        let mesh = Mesh::new();
        // Arc1: radius 1, half circle
        let a = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 1.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        // Arc2: radius 2, half circle starting at (-1, 0) tangent direction (0,-1)
        // To match the G1 endpoint, position center at (-1, -2), basis_u at (0,1)
        // so that θ=0 evaluates to (-1, -2) + 2*(0,1) = (-1, 0).
        // Tangent at θ=0: r' = -2 sin·u + 2 cos·v_basis. With basis_u=(0,1),
        // basis_v = Z×(0,1) = (-1,0). At θ=0: r' = 2·(-1, 0) = (-2, 0).
        // Direction is -X but Arc1's tangent at endpoint is -Y. Not G1.
        // Use radius 2 arc that DOES share tangent (0,-1) at point (-1,0):
        //   center at (-1, -2), basis_u = (0, 1), basis_v = Z×(0,1) = (-1, 0)
        //   r(0) = (-1,-2) + 2*(0,1) = (-1, 0) ✓
        //   r'(0) = 2·(-sin*basis_u + cos*basis_v) = 2·(0, basis_v) = 2*(-1, 0)
        //   That gives tangent (-1,0), not (0,-1). So it's not G1 either.
        // The geometric truth is: at the seam (-1, 0) on Arc1 going CCW, the
        // tangent is exactly (0, -1) (pointing down). To match that with Arc2:
        //   Need basis_v = (0, -1) at θ=0, so basis_u = Z⁻¹ × (0,-1)
        //   Z×basis_u = basis_v=(0,-1) → basis_u = (-1, 0) wait no.
        //   Z × (1,0,0) = (0,1,0) [Y]; Z × (0,1,0) = (-1,0,0); Z × (-1,0,0) = (0,-1,0).
        //   So basis_u = (-1, 0, 0) gives basis_v = (0, -1, 0). Good.
        //   Then r(0) = center + r·(1,0,0)·(-1, 0, 0) = center + (-r, 0, 0)
        //   = center + (-2, 0, 0). To equal (-1, 0): center = (1, 0, 0).
        let b = AnalyticCurve::Arc {
            center: DVec3::new(1.0, 0.0, 0.0), radius: 2.0,
            normal: DVec3::Z, basis_u: DVec3::NEG_X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        // G1 should hold (geometric construction)
        assert!(a.is_g0_to(&b, &mesh, 1e-9).unwrap(),
            "G0 should hold by construction");
        assert!(a.is_g1_to(&b, &mesh, 1e-9).unwrap(),
            "G1 should hold by construction");
        // G2 should NOT hold: κa = 1, κb = 0.5
        assert!(!a.is_g2_to(&b, &mesh, 1e-9).unwrap(),
            "G2 should fail: curvatures differ (1.0 vs 0.5)");
    }
}
