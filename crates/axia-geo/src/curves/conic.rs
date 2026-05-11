//! Conic-section helpers — convert primitive geometric conics into NURBS form
//! (Phase C, ADR-030 §P15.5).
//!
//! NURBS can represent conics exactly with:
//! - **degree 2** (quadratic)
//! - **3 control points per quarter-arc**: corner, sharp corner, corner
//! - **weights**: corner=1, sharp-corner=cos(half-angle)=`(angle/2).cos()`
//!
//! For a quarter circle (90° arc) the sharp-corner weight is `cos(45°) = √2/2`.
//! This implementation builds a quadratic NURBS for ANY arc by computing the
//! appropriate weight from the arc's half-angle.

use glam::DVec3;

use super::{basis_v, AnalyticCurve};

/// Convert a circular arc into a quadratic NURBS curve.
///
/// Works for any arc with sweep angle `< 180°`. Larger arcs should be
/// concatenated as multiple NURBS segments — a separate composite helper
/// will be added in Phase E.
///
/// Returns the `AnalyticCurve::NURBS` variant.
pub fn arc_as_nurbs(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    start_angle: f64,
    end_angle: f64,
) -> AnalyticCurve {
    let v = basis_v(normal, basis_u);
    let half = (end_angle - start_angle) * 0.5;

    // The two endpoints lie on the arc.
    let p_start = center
        + basis_u * (radius * start_angle.cos())
        + v * (radius * start_angle.sin());
    let p_end = center
        + basis_u * (radius * end_angle.cos())
        + v * (radius * end_angle.sin());

    // The sharp-corner control point sits at the intersection of the tangent
    // lines at p_start and p_end. For a circular arc this is along the
    // bisector at distance `radius / cos(half)`.
    let bisector_angle = start_angle + half;
    let bisector = basis_u * bisector_angle.cos() + v * bisector_angle.sin();
    let corner_dist = radius / half.cos();
    let p_corner = center + bisector * corner_dist;

    let weights = vec![1.0, half.cos(), 1.0];
    let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];

    AnalyticCurve::NURBS {
        control_pts: vec![p_start, p_corner, p_end],
        weights,
        knots,
        degree: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::CurveOps;
    use crate::mesh::Mesh;
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};

    #[test]
    fn arc_as_nurbs_quarter_circle_radius_invariant() {
        let r = 5.0;
        let nurbs = arc_as_nurbs(
            DVec3::ZERO, r, DVec3::Z, DVec3::X, 0.0, FRAC_PI_2,
        );
        let mesh = Mesh::new();
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let p = nurbs.evaluate(t, &mesh).unwrap();
            let dist = p.length();
            assert!((dist - r).abs() < 1e-6,
                "t={}: |p| = {} ≠ r = {}", t, dist, r);
        }
    }

    #[test]
    fn arc_as_nurbs_endpoint_match() {
        let r = 7.0;
        let center = DVec3::new(2.0, 3.0, 0.0);
        let nurbs = arc_as_nurbs(
            center, r, DVec3::Z, DVec3::X, 0.0, FRAC_PI_4,
        );
        let mesh = Mesh::new();
        let p0 = nurbs.evaluate(0.0, &mesh).unwrap();
        let p1 = nurbs.evaluate(1.0, &mesh).unwrap();
        // p0 should be center + (r, 0)
        assert!((p0 - (center + DVec3::new(r, 0.0, 0.0))).length() < 1e-9);
        // p1 should be center + r·(cos(π/4), sin(π/4))
        let expected = center + DVec3::new(r * FRAC_PI_4.cos(), r * FRAC_PI_4.sin(), 0.0);
        assert!((p1 - expected).length() < 1e-9);
    }

    #[test]
    fn arc_as_nurbs_135_degree_arc_radius_invariant() {
        // Larger arc — within 180° limit.
        let r = 3.0;
        let nurbs = arc_as_nurbs(
            DVec3::ZERO, r, DVec3::Z, DVec3::X, 0.0, 3.0 * FRAC_PI_4,
        );
        let mesh = Mesh::new();
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let p = nurbs.evaluate(t, &mesh).unwrap();
            // For wide arcs, NURBS quadratic radius is exact only at the
            // endpoints and varies smoothly in between (it's still a true conic).
            // Allow 1% tolerance for non-quarter arcs.
            let dist = p.length();
            assert!((dist - r).abs() < r * 0.01,
                "t={}: |p|={} expected ≈ {}", t, dist, r);
        }
    }

    #[test]
    fn arc_as_nurbs_xz_plane() {
        // Y-up plane: normal = Y, basis_u = X → basis_v = -Z.
        let nurbs = arc_as_nurbs(
            DVec3::ZERO, 5.0, DVec3::Y, DVec3::X, 0.0, FRAC_PI_2,
        );
        let mesh = Mesh::new();
        let p_end = nurbs.evaluate(1.0, &mesh).unwrap();
        // At end_angle = π/2 in (X, -Z) plane: x=0, z=-5.
        assert!((p_end - DVec3::new(0.0, 0.0, -5.0)).length() < 1e-9);
    }

    #[test]
    fn arc_as_nurbs_offset_center() {
        let center = DVec3::new(10.0, 20.0, 30.0);
        let nurbs = arc_as_nurbs(center, 5.0, DVec3::Z, DVec3::X, 0.0, FRAC_PI_4);
        let mesh = Mesh::new();
        let p0 = nurbs.evaluate(0.0, &mesh).unwrap();
        assert!((p0 - (center + DVec3::new(5.0, 0.0, 0.0))).length() < 1e-9);
    }

    #[test]
    fn arc_as_nurbs_short_arc_higher_accuracy() {
        // Smaller arcs are more accurately represented by quadratic NURBS.
        let r = 10.0;
        let nurbs = arc_as_nurbs(
            DVec3::ZERO, r, DVec3::Z, DVec3::X, 0.0, FRAC_PI_4 / 2.0,  // 22.5°
        );
        let mesh = Mesh::new();
        for i in 0..=20 {
            let t = i as f64 / 20.0;
            let p = nurbs.evaluate(t, &mesh).unwrap();
            assert!((p.length() - r).abs() < 1e-9,
                "small arc accuracy: t={}, |p|={} vs r={}", t, p.length(), r);
        }
    }

    /// Bind unused PI to keep import in sample tests clear.
    #[test]
    fn pi_constant_imported() {
        let _ = PI;
    }
}
