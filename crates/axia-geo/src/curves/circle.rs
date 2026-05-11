//! Circle — full circle in a 3D plane (Phase A).
//!
//! Parametric form (with right-handed basis `(u, v, normal)` where
//! `v = normal × u`):
//!
//! ```text
//! P(θ) = center + r·cos(θ)·u + r·sin(θ)·v
//! ```
//!
//! Parameter range: `θ ∈ [0, 2π)`.

use glam::DVec3;

use super::basis_v;

/// Evaluate a circle at angle `theta` (radians).
pub fn evaluate(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    theta: f64,
) -> DVec3 {
    let v = basis_v(normal, basis_u);
    center + basis_u * (radius * theta.cos()) + v * (radius * theta.sin())
}

/// Tangent (derivative w.r.t. θ) — `dP/dθ = -r·sin(θ)·u + r·cos(θ)·v`.
/// Magnitude = r (constant).
pub fn derivative(
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    theta: f64,
) -> DVec3 {
    let v = basis_v(normal, basis_u);
    basis_u * (-radius * theta.sin()) + v * (radius * theta.cos())
}

/// Tessellate a full circle into a polyline with chord-error ≤ `chord_tol`.
///
/// Sagitta-based segment count derivation:
/// For a circular arc subtended by angle `Δθ`, the sagitta (mid-chord-to-arc
/// distance) is `s = r · (1 - cos(Δθ/2))`. We solve for `Δθ` given target
/// `chord_tol`:
///
/// ```text
/// chord_tol = r · (1 - cos(Δθ/2))
/// Δθ = 2 · acos(1 - chord_tol/r)
/// n_segments = ceil(2π / Δθ)
/// ```
///
/// Minimum 8 segments enforced (avoids degenerate case for small r or large tol).
pub fn tessellate_full(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    chord_tol: f64,
) -> Vec<DVec3> {
    let n = segment_count_for_arc(radius, 2.0 * std::f64::consts::PI, chord_tol);
    let v = basis_v(normal, basis_u);
    let two_pi = 2.0 * std::f64::consts::PI;
    let mut pts = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let theta = (i as f64) * two_pi / (n as f64);
        let p = center + basis_u * (radius * theta.cos()) + v * (radius * theta.sin());
        pts.push(p);
    }
    pts
}

/// Compute segment count to hit `chord_tol` on an arc of given total angle.
/// Used by both Circle and Arc tessellation.
pub fn segment_count_for_arc(radius: f64, total_angle: f64, chord_tol: f64) -> usize {
    if radius <= 0.0 || total_angle.abs() < 1e-12 {
        return 1;
    }
    // Clamp tolerance vs radius to avoid acos domain error.
    let ratio = (chord_tol / radius).clamp(0.0, 1.999_999);
    if ratio <= 0.0 {
        return 8.max((total_angle.abs() * 16.0) as usize);
    }
    let delta = 2.0 * (1.0 - ratio).acos();
    if delta <= 1e-9 {
        return 8.max((total_angle.abs() * 16.0) as usize);
    }
    let n = (total_angle.abs() / delta).ceil() as usize;
    n.max(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    #[test]
    fn circle_evaluate_zero_angle_is_basis_u_endpoint() {
        let c = DVec3::ZERO;
        let p = evaluate(c, 5.0, DVec3::Z, DVec3::X, 0.0);
        assert!(approx_eq(p, DVec3::new(5.0, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn circle_evaluate_quarter_angle_is_basis_v_endpoint() {
        let p = evaluate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, std::f64::consts::FRAC_PI_2);
        assert!(approx_eq(p, DVec3::new(0.0, 5.0, 0.0), 1e-12));
    }

    #[test]
    fn circle_evaluate_pi_is_negative_basis_u() {
        let p = evaluate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, std::f64::consts::PI);
        assert!(approx_eq(p, DVec3::new(-5.0, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn circle_evaluate_full_2pi_returns_to_start() {
        let p0 = evaluate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, 0.0);
        let p1 = evaluate(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, 2.0 * std::f64::consts::PI);
        assert!(approx_eq(p0, p1, 1e-12));
    }

    #[test]
    fn circle_evaluate_offset_center() {
        let c = DVec3::new(10.0, 20.0, 30.0);
        let p = evaluate(c, 3.0, DVec3::Z, DVec3::X, 0.0);
        assert!(approx_eq(p, c + DVec3::new(3.0, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn circle_evaluate_xz_plane() {
        // normal = +Y, basis_u = +X → basis_v = +Z (right-handed: Y × X = -Z, hmm)
        // basis_v = normal × basis_u = Y × X = -Z. So at θ=π/2, P = -Z·r.
        let p = evaluate(DVec3::ZERO, 5.0, DVec3::Y, DVec3::X, std::f64::consts::FRAC_PI_2);
        assert!(approx_eq(p, DVec3::new(0.0, 0.0, -5.0), 1e-12),
            "expected -5Z (Y × X = -Z), got {:?}", p);
    }

    #[test]
    fn circle_derivative_at_zero_is_basis_v_times_r() {
        // dP/dθ at θ=0 = r·v
        let d = derivative(5.0, DVec3::Z, DVec3::X, 0.0);
        assert!(approx_eq(d, DVec3::new(0.0, 5.0, 0.0), 1e-12));
    }

    #[test]
    fn circle_derivative_perpendicular_to_radius() {
        // At θ=0: P-C = r·u, dP/dθ = r·v → orthogonal.
        let center = DVec3::ZERO;
        let p = evaluate(center, 5.0, DVec3::Z, DVec3::X, 1.234);
        let d = derivative(5.0, DVec3::Z, DVec3::X, 1.234);
        let radial = (p - center).normalize();
        let tangent = d.normalize();
        let dot = radial.dot(tangent);
        assert!(dot.abs() < 1e-12, "dot should be 0, got {}", dot);
    }

    #[test]
    fn circle_derivative_magnitude_is_radius() {
        let d = derivative(5.0, DVec3::Z, DVec3::X, 1.234);
        assert!((d.length() - 5.0).abs() < 1e-12);
    }

    #[test]
    fn circle_tessellate_chord_error_within_tol() {
        let center = DVec3::ZERO;
        let r = 100.0;
        let chord_tol = 0.5;
        let pts = tessellate_full(center, r, DVec3::Z, DVec3::X, chord_tol);
        assert!(pts.len() > 8);
        // For each chord, the midpoint of the chord should be within
        // chord_tol of the circle (sagitta check).
        for i in 0..pts.len() - 1 {
            let mid = (pts[i] + pts[i + 1]) * 0.5;
            let dist_to_center = (mid - center).length();
            let sagitta = (r - dist_to_center).abs();
            assert!(sagitta <= chord_tol * 1.01,
                "sagitta {} > chord_tol {} at segment {}", sagitta, chord_tol, i);
        }
    }

    #[test]
    fn circle_tessellate_count_scales_with_tolerance() {
        let r = 100.0;
        let p_loose = tessellate_full(DVec3::ZERO, r, DVec3::Z, DVec3::X, 5.0);
        let p_tight = tessellate_full(DVec3::ZERO, r, DVec3::Z, DVec3::X, 0.1);
        // Tighter tolerance → more segments
        assert!(p_tight.len() > p_loose.len());
    }

    #[test]
    fn circle_tessellate_minimum_segments() {
        // Very large tolerance — but minimum 8 enforced.
        let pts = tessellate_full(DVec3::ZERO, 1.0, DVec3::Z, DVec3::X, 1000.0);
        assert!(pts.len() >= 8 + 1);  // n+1 points for n segments
    }

    #[test]
    fn circle_tessellate_first_and_last_point_coincide() {
        // Full circle → first and last tessellated points should coincide.
        let pts = tessellate_full(DVec3::ZERO, 5.0, DVec3::Z, DVec3::X, 0.5);
        let first = pts.first().unwrap();
        let last = pts.last().unwrap();
        assert!((*first - *last).length() < 1e-9);
    }

    #[test]
    fn segment_count_zero_radius_returns_one() {
        assert_eq!(segment_count_for_arc(0.0, 1.0, 0.1), 1);
    }

    #[test]
    fn segment_count_zero_angle_returns_one() {
        assert_eq!(segment_count_for_arc(5.0, 0.0, 0.1), 1);
    }
}
