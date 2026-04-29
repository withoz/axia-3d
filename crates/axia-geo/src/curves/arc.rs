//! Arc — sub-range of a Circle (Phase A).
//!
//! Defined by `(center, radius, normal, basis_u, start_angle, end_angle)`.
//! Parameterization shared with Circle: same `evaluate` / `derivative` formulas;
//! only the parameter range differs (Arc is `[start_angle, end_angle]`).

use glam::DVec3;

use super::basis_v;
use super::circle::segment_count_for_arc;

/// Tessellate an arc with chord-error ≤ `chord_tol`.
/// Returns points from start to end inclusive (n+1 points for n segments).
pub fn tessellate(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    start_angle: f64,
    end_angle: f64,
    chord_tol: f64,
) -> Vec<DVec3> {
    let total_angle = end_angle - start_angle;
    let n = segment_count_for_arc(radius, total_angle, chord_tol);
    let v = basis_v(normal, basis_u);
    let mut pts = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let theta = start_angle + (i as f64) * total_angle / (n as f64);
        let p = center + basis_u * (radius * theta.cos()) + v * (radius * theta.sin());
        pts.push(p);
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_2, PI};

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    #[test]
    fn arc_tessellate_endpoints_match_evaluate() {
        // Quarter arc: 0 → π/2
        let pts = tessellate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, 0.0, FRAC_PI_2, 0.1);
        let first = pts.first().unwrap();
        let last = pts.last().unwrap();
        assert!(approx_eq(*first, DVec3::new(5.0, 0.0, 0.0), 1e-12));
        assert!(approx_eq(*last, DVec3::new(0.0, 5.0, 0.0), 1e-9));
    }

    #[test]
    fn arc_tessellate_chord_error_within_tol() {
        let center = DVec3::ZERO;
        let r = 50.0;
        let chord_tol = 0.2;
        let pts = tessellate(center, r, DVec3::Z, DVec3::X, 0.0, PI, chord_tol);
        for i in 0..pts.len() - 1 {
            let mid = (pts[i] + pts[i + 1]) * 0.5;
            let dist_to_center = (mid - center).length();
            let sagitta = (r - dist_to_center).abs();
            assert!(sagitta <= chord_tol * 1.01,
                "sagitta {} > chord_tol {} at i={}", sagitta, chord_tol, i);
        }
    }

    #[test]
    fn arc_tessellate_half_circle_count_roughly_half_of_full() {
        let r = 100.0;
        let chord_tol = 0.5;
        let half = tessellate(DVec3::ZERO, r, DVec3::Z, DVec3::X, 0.0, PI, chord_tol);
        let full = super::super::circle::tessellate_full(DVec3::ZERO, r, DVec3::Z, DVec3::X, chord_tol);
        // half should be roughly full/2 + 1 (counting points)
        let ratio = (half.len() as f64) / (full.len() as f64);
        assert!(ratio > 0.4 && ratio < 0.7,
            "half/full ratio {} out of expected range", ratio);
    }

    #[test]
    fn arc_tessellate_quarter_segment_count_at_least_2() {
        // Even very loose tolerance — minimum segments enforced.
        let pts = tessellate(DVec3::ZERO, 1.0, DVec3::Z, DVec3::X, 0.0, FRAC_PI_2, 1000.0);
        assert!(pts.len() >= 3, "expected at least 3 points (2 seg) for any arc");
    }

    #[test]
    fn arc_tessellate_reverse_direction_supported() {
        // start > end: negative arc (CW). tessellate handles via abs().
        let pts = tessellate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, FRAC_PI_2, 0.0, 0.1);
        let first = pts.first().unwrap();
        let last = pts.last().unwrap();
        assert!(approx_eq(*first, DVec3::new(0.0, 5.0, 0.0), 1e-9));
        assert!(approx_eq(*last, DVec3::new(5.0, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn arc_tessellate_offset_center() {
        let c = DVec3::new(100.0, 50.0, 0.0);
        let pts = tessellate(c, 10.0, DVec3::Z, DVec3::X, 0.0, FRAC_PI_2, 0.1);
        let first = pts.first().unwrap();
        assert!(approx_eq(*first, c + DVec3::new(10.0, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn arc_tessellate_xz_plane() {
        // normal = +Y, basis_u = +X → basis_v = -Z. Quarter arc 0 → π/2.
        let pts = tessellate(DVec3::ZERO, 5.0, DVec3::Y, DVec3::X, 0.0, FRAC_PI_2, 0.1);
        let last = pts.last().unwrap();
        assert!(approx_eq(*last, DVec3::new(0.0, 0.0, -5.0), 1e-9),
            "expected -5Z, got {:?}", last);
    }
}
