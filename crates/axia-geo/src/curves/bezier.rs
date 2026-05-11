//! Bezier curve — n-degree polynomial parametric curve (Phase B, ADR-029).
//!
//! ## Definition
//!
//! Given n+1 control points `P_0, ..., P_n`, the Bezier curve of degree n is:
//!
//! ```text
//! C(t) = Σ_{i=0..n}  B_i^n(t) · P_i ,   t ∈ [0, 1]
//! ```
//!
//! where `B_i^n(t) = C(n, i) · t^i · (1-t)^{n-i}` are the Bernstein basis.
//!
//! ## Algorithms
//!
//! - **Evaluation**: de Casteljau — repeated linear interpolation, O(n²),
//!   numerically stable.
//! - **Derivative**: hodograph — Bezier of degree n-1 with control points
//!   `Q_i = n · (P_{i+1} - P_i)`.
//! - **Tessellation**: adaptive subdivision based on flatness test
//!   (control polygon length vs chord length).
//!
//! ## Endpoint properties (Phase B invariants)
//!
//! - `evaluate(0) = P_0`, `evaluate(1) = P_n` (interpolation at endpoints)
//! - `derivative(0) = n · (P_1 - P_0)` and `derivative(1) = n · (P_n - P_{n-1})`
//! - For degree 1: Bezier reduces to a straight line.

use anyhow::{bail, Result};
use glam::DVec3;

/// Evaluate a Bezier curve at parameter `t`.
///
/// `t` is typically in [0, 1]; values outside are extrapolated by the
/// de Casteljau algorithm (geometrically meaningful only inside [0, 1]).
pub fn evaluate(control_pts: &[DVec3], t: f64) -> Result<DVec3> {
    if control_pts.is_empty() {
        bail!("bezier: needs at least 1 control point");
    }
    if control_pts.len() == 1 {
        return Ok(control_pts[0]);
    }
    Ok(de_casteljau(control_pts, t))
}

/// First derivative `dC/dt` at parameter `t`.
/// Result has the same magnitude scaling as in NURBS conventions
/// (NOT unit length).
pub fn derivative(control_pts: &[DVec3], t: f64) -> Result<DVec3> {
    if control_pts.len() < 2 {
        // Single point or empty → derivative is zero.
        return Ok(DVec3::ZERO);
    }
    let dpts = derivative_control_pts(control_pts);
    Ok(de_casteljau(&dpts, t))
}

/// Tessellate the Bezier curve into a polyline with chord error ≤ `chord_tol`.
///
/// Uses adaptive subdivision: each sub-curve is checked for "flatness" — if
/// the control polygon length exceeds the chord length by more than
/// `2 × chord_tol`, we subdivide at `t = 0.5`. Otherwise we accept the chord.
pub fn tessellate(control_pts: &[DVec3], chord_tol: f64) -> Result<Vec<DVec3>> {
    if control_pts.is_empty() {
        bail!("bezier: needs at least 1 control point for tessellation");
    }
    if control_pts.len() == 1 {
        return Ok(vec![control_pts[0]]);
    }
    let mut out: Vec<DVec3> = Vec::new();
    out.push(control_pts[0]);
    tessellate_recurse(control_pts, chord_tol, &mut out, 0);
    Ok(out)
}

/// Approximate arc length via Romberg-like halving of the control-polygon
/// + chord average. Bounded above by control polygon length.
pub fn arc_length(control_pts: &[DVec3]) -> Result<f64> {
    if control_pts.len() < 2 {
        return Ok(0.0);
    }
    // Adaptive: subdivide until polygon-vs-chord disagreement < 1e-6 × span.
    Ok(arc_length_recurse(control_pts, 0))
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

/// Numerically stable evaluation by repeated linear interpolation.
pub(crate) fn de_casteljau(control_pts: &[DVec3], t: f64) -> DVec3 {
    let mut buf: Vec<DVec3> = control_pts.to_vec();
    let n = buf.len();
    for r in 1..n {
        for i in 0..n - r {
            buf[i] = buf[i] * (1.0 - t) + buf[i + 1] * t;
        }
    }
    buf[0]
}

/// Compute control points of the derivative curve (degree drops by 1).
/// `Q_i = n · (P_{i+1} - P_i)` for i = 0..n-1.
pub(crate) fn derivative_control_pts(control_pts: &[DVec3]) -> Vec<DVec3> {
    let n = control_pts.len() - 1;
    if n == 0 {
        return Vec::new();
    }
    let scale = n as f64;
    (0..n)
        .map(|i| (control_pts[i + 1] - control_pts[i]) * scale)
        .collect()
}

/// Subdivide a Bezier curve at parameter `t`.
/// Returns `(left_ctrl_pts, right_ctrl_pts)`, both of the same degree.
/// The left curve covers [0, t] re-parameterized to [0, 1], and similarly
/// for the right.
pub(crate) fn subdivide(control_pts: &[DVec3], t: f64) -> (Vec<DVec3>, Vec<DVec3>) {
    let n = control_pts.len();
    let mut buf: Vec<DVec3> = control_pts.to_vec();
    let mut left = Vec::with_capacity(n);
    let mut right_rev = Vec::with_capacity(n);
    left.push(buf[0]);
    right_rev.push(buf[n - 1]);
    for r in 1..n {
        for i in 0..n - r {
            buf[i] = buf[i] * (1.0 - t) + buf[i + 1] * t;
        }
        left.push(buf[0]);
        right_rev.push(buf[n - r - 1]);
    }
    let mut right: Vec<DVec3> = right_rev.into_iter().rev().collect();
    // The two halves share the midpoint — left[last] == right[0].
    debug_assert!((left.last().unwrap() - right.first().unwrap()).length() < 1e-9);
    // Drop duplicate join point from right to avoid double-counting.
    right.remove(0);
    right.insert(0, *left.last().unwrap());
    (left, right)
}

/// Recursive adaptive tessellation. Appends to `out` (excluding the first
/// point of the leftmost sub-curve, which the caller pushed).
fn tessellate_recurse(
    control_pts: &[DVec3],
    chord_tol: f64,
    out: &mut Vec<DVec3>,
    depth: usize,
) {
    const MAX_DEPTH: usize = 20;
    let n = control_pts.len();
    let chord = control_pts[n - 1] - control_pts[0];
    let chord_len = chord.length();

    // Flatness check: max distance from interior control points to chord line.
    // For degree 1 (line) this is automatically 0.
    let mut max_dev: f64 = 0.0;
    if chord_len > 1e-12 {
        let chord_dir = chord / chord_len;
        for i in 1..n - 1 {
            let v = control_pts[i] - control_pts[0];
            let along = v.dot(chord_dir);
            let perp = (v - chord_dir * along).length();
            max_dev = max_dev.max(perp);
        }
    } else {
        // Degenerate chord — measure max distance from start point instead.
        for i in 1..n {
            let d = (control_pts[i] - control_pts[0]).length();
            max_dev = max_dev.max(d);
        }
    }

    if max_dev <= chord_tol || depth >= MAX_DEPTH {
        // Accept this segment — push the endpoint.
        out.push(control_pts[n - 1]);
        return;
    }
    let (left, right) = subdivide(control_pts, 0.5);
    tessellate_recurse(&left, chord_tol, out, depth + 1);
    tessellate_recurse(&right, chord_tol, out, depth + 1);
}

fn arc_length_recurse(control_pts: &[DVec3], depth: usize) -> f64 {
    const MAX_DEPTH: usize = 16;
    const TOL: f64 = 1e-6;
    let n = control_pts.len();
    let chord_len = (control_pts[n - 1] - control_pts[0]).length();
    let mut poly_len = 0.0;
    for i in 0..n - 1 {
        poly_len += (control_pts[i + 1] - control_pts[i]).length();
    }
    if depth >= MAX_DEPTH || (poly_len - chord_len).abs() < TOL * (poly_len.max(1.0)) {
        return (poly_len + chord_len) * 0.5;
    }
    let (left, right) = subdivide(control_pts, 0.5);
    arc_length_recurse(&left, depth + 1) + arc_length_recurse(&right, depth + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::FRAC_PI_2;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    #[test]
    fn linear_bezier_matches_line() {
        let pts = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let p = evaluate(&pts, 0.5).unwrap();
        assert!(approx_eq(p, DVec3::new(5.0, 0.0, 0.0), 1e-12));
        let p0 = evaluate(&pts, 0.0).unwrap();
        let p1 = evaluate(&pts, 1.0).unwrap();
        assert!(approx_eq(p0, pts[0], 1e-12));
        assert!(approx_eq(p1, pts[1], 1e-12));
    }

    #[test]
    fn quadratic_evaluate_endpoints() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        assert!(approx_eq(evaluate(&pts, 0.0).unwrap(), pts[0], 1e-12));
        assert!(approx_eq(evaluate(&pts, 1.0).unwrap(), pts[2], 1e-12));
    }

    #[test]
    fn cubic_evaluate_endpoints() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 5.0, 0.0),
            DVec3::new(8.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        assert!(approx_eq(evaluate(&pts, 0.0).unwrap(), pts[0], 1e-12));
        assert!(approx_eq(evaluate(&pts, 1.0).unwrap(), pts[3], 1e-12));
    }

    #[test]
    fn quadratic_evaluate_midpoint_formula() {
        // Quadratic Bezier midpoint: P(0.5) = 0.25 P0 + 0.5 P1 + 0.25 P2
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(4.0, 6.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let mid = evaluate(&pts, 0.5).unwrap();
        let expected = pts[0] * 0.25 + pts[1] * 0.5 + pts[2] * 0.25;
        assert!(approx_eq(mid, expected, 1e-12));
    }

    #[test]
    fn de_casteljau_t_zero_returns_first_pt() {
        let pts = vec![DVec3::new(1.0, 2.0, 3.0), DVec3::new(4.0, 5.0, 6.0)];
        assert!(approx_eq(de_casteljau(&pts, 0.0), pts[0], 1e-12));
    }

    #[test]
    fn de_casteljau_t_one_returns_last_pt() {
        let pts = vec![DVec3::new(1.0, 2.0, 3.0), DVec3::new(4.0, 5.0, 6.0)];
        assert!(approx_eq(de_casteljau(&pts, 1.0), pts[1], 1e-12));
    }

    #[test]
    fn subdivide_t_half_left_endpoint_matches_evaluate() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let (left, right) = subdivide(&pts, 0.5);
        let mid = evaluate(&pts, 0.5).unwrap();
        // Both halves share the midpoint.
        assert!(approx_eq(*left.last().unwrap(), mid, 1e-12));
        assert!(approx_eq(*right.first().unwrap(), mid, 1e-12));
        // Left starts at original P0.
        assert!(approx_eq(left[0], pts[0], 1e-12));
        // Right ends at original P_n.
        assert!(approx_eq(*right.last().unwrap(), *pts.last().unwrap(), 1e-12));
    }

    #[test]
    fn subdivide_t_half_concatenation_evaluation_consistency() {
        // After subdividing, evaluating left at u=1 OR right at u=0 both yield
        // the same point as the original at t=0.5.
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 5.0, 0.0),
            DVec3::new(8.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let (left, right) = subdivide(&pts, 0.5);
        let original_mid = evaluate(&pts, 0.5).unwrap();
        let left_end = evaluate(&left, 1.0).unwrap();
        let right_start = evaluate(&right, 0.0).unwrap();
        assert!(approx_eq(left_end, original_mid, 1e-12));
        assert!(approx_eq(right_start, original_mid, 1e-12));
    }

    #[test]
    fn derivative_endpoint_matches_n_times_first_diff() {
        // For a cubic, derivative(0) = 3 · (P1 - P0).
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let d0 = derivative(&pts, 0.0).unwrap();
        let expected = (pts[1] - pts[0]) * 3.0;
        assert!(approx_eq(d0, expected, 1e-12));
        let d1 = derivative(&pts, 1.0).unwrap();
        let expected_end = (pts[3] - pts[2]) * 3.0;
        assert!(approx_eq(d1, expected_end, 1e-12));
    }

    #[test]
    fn derivative_zero_for_single_pt() {
        let pts = vec![DVec3::new(1.0, 2.0, 3.0)];
        let d = derivative(&pts, 0.5).unwrap();
        assert!(approx_eq(d, DVec3::ZERO, 1e-12));
    }

    #[test]
    fn tessellate_chord_error_within_tol_quadratic_quarter_arc() {
        // A quadratic Bezier approximating a quarter circle (rough). Sample
        // points should stay within chord_tol of the analytic Bezier curve.
        let pts = vec![
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        ];
        let chord_tol = 0.05;
        let poly = tessellate(&pts, chord_tol).unwrap();
        assert!(poly.len() >= 4, "expected ≥ 4 points for chord_tol={}", chord_tol);
        // Each segment's midpoint should be near the analytic curve.
        for i in 0..poly.len() - 1 {
            let mid_chord = (poly[i] + poly[i + 1]) * 0.5;
            // Find approximate t for mid_chord via parametric scan.
            let mut best_dist = f64::MAX;
            for k in 0..=200 {
                let t = (i as f64 + k as f64 / 200.0) / (poly.len() as f64 - 1.0);
                let t = t.clamp(0.0, 1.0);
                let analytic = evaluate(&pts, t).unwrap();
                best_dist = best_dist.min((analytic - mid_chord).length());
            }
            assert!(best_dist < chord_tol * 5.0,
                "mid-chord at i={}: dist={} > 5×tol={}", i, best_dist, chord_tol * 5.0);
        }
        let _ = FRAC_PI_2;  // keep import alive for future tests
    }

    #[test]
    fn tessellate_lod_scales_with_tolerance() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(50.0, 100.0, 0.0),
            DVec3::new(100.0, -50.0, 0.0),
            DVec3::new(150.0, 0.0, 0.0),
        ];
        let coarse = tessellate(&pts, 5.0).unwrap();
        let fine = tessellate(&pts, 0.05).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine ({}) must exceed coarse ({})", fine.len(), coarse.len());
    }

    #[test]
    fn tessellate_endpoints_preserved() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 10.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let poly = tessellate(&pts, 0.1).unwrap();
        assert!(approx_eq(poly[0], pts[0], 1e-12));
        assert!(approx_eq(*poly.last().unwrap(), pts[2], 1e-12));
    }

    #[test]
    fn arc_length_linear_matches_distance() {
        let pts = vec![DVec3::new(0.0, 0.0, 0.0), DVec3::new(10.0, 0.0, 0.0)];
        let len = arc_length(&pts).unwrap();
        assert!((len - 10.0).abs() < 1e-9);
    }

    #[test]
    fn arc_length_quadratic_between_chord_and_polygon() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let chord = (pts[2] - pts[0]).length();         // 10
        let polygon = (pts[1] - pts[0]).length() + (pts[2] - pts[1]).length();  // ~14.14
        let len = arc_length(&pts).unwrap();
        assert!(len > chord && len < polygon,
            "arc_length {} should be between chord {} and polygon {}", len, chord, polygon);
    }

    #[test]
    fn evaluate_returns_zero_pt_for_single_control() {
        let pts = vec![DVec3::new(7.0, 8.0, 9.0)];
        let p = evaluate(&pts, 0.42).unwrap();
        assert!(approx_eq(p, pts[0], 1e-12));
    }

    #[test]
    fn evaluate_empty_control_pts_errors() {
        let pts: Vec<DVec3> = Vec::new();
        assert!(evaluate(&pts, 0.5).is_err());
    }
}
