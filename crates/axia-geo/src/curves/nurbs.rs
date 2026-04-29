//! NURBS curve — rational B-spline (Phase C, ADR-030).
//!
//! ## Definition
//!
//! Given control points `P_i`, weights `w_i > 0`, knot vector `u_j`,
//! degree `p`:
//!
//! ```text
//! C(t) = (Σ w_i N_i^p(t) P_i) / (Σ w_j N_j^p(t))
//! ```
//!
//! ## Algorithm — Homogeneous Lifting
//!
//! Lift each `(P_i, w_i)` to 4D `(w_i · P_i, w_i)`. The 4D B-spline
//! `H(t) = (X(t), Y(t), Z(t), W(t))` is evaluated by the Phase B de Boor
//! routine. Project back: `C(t) = (X/W, Y/W, Z/W)`.
//!
//! Key advantage: numerical stability + reuse of B-spline derivative.
//!
//! ## Validation (P15.7)
//!
//! - degree ≥ 1
//! - control_pts.len() = weights.len() ≥ degree + 1
//! - knots.len() = control_pts.len() + degree + 1, non-decreasing
//! - all weights > MIN_WEIGHT (1e-9) — strictly positive

use anyhow::{bail, Result};
use glam::DVec3;

use super::bspline;

const MIN_WEIGHT: f64 = 1e-9;

/// Evaluate the NURBS curve at parameter `t`.
pub fn evaluate(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t: f64,
) -> Result<DVec3> {
    validate(control_pts, weights, knots, degree)?;
    let (h, w) = evaluate_homogeneous(control_pts, weights, knots, degree, t)?;
    if w.abs() < MIN_WEIGHT {
        bail!("nurbs: w(t) = {} too close to zero — degenerate weights", w);
    }
    Ok(h / w)
}

/// Evaluate homogeneous components — returns `(H(t), w(t))` where
/// `H = w·C`. Useful for derivative computations.
pub fn evaluate_homogeneous(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t: f64,
) -> Result<(DVec3, f64)> {
    validate(control_pts, weights, knots, degree)?;
    // Lift to 4D: (w_i · P_i, w_i).
    let lifted_xyz: Vec<DVec3> = control_pts
        .iter()
        .zip(weights.iter())
        .map(|(p, &w)| *p * w)
        .collect();
    // Use B-spline de Boor to evaluate each spatial coord and the weight.
    let span = bspline::find_knot_span(knots, degree, control_pts.len(), t);
    let h = bspline::de_boor(&lifted_xyz, knots, degree, span, t);
    // For weight: lift weights as DVec3.x (only x component used) for reuse.
    let lifted_w: Vec<DVec3> = weights
        .iter()
        .map(|&w| DVec3::new(w, 0.0, 0.0))
        .collect();
    let w_pt = bspline::de_boor(&lifted_w, knots, degree, span, t);
    Ok((h, w_pt.x))
}

/// First derivative `dC/dt` at parameter `t`.
///
/// Quotient rule:
/// `C'(t) = (H'(t) - w'(t) · C(t)) / w(t)`
///
/// where `H'` and `w'` come from the derivative B-spline (degree p-1) of
/// the homogeneous-lifted control points / weights.
pub fn derivative(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t: f64,
) -> Result<DVec3> {
    validate(control_pts, weights, knots, degree)?;
    if degree == 0 {
        return Ok(DVec3::ZERO);
    }
    let (c, w) = {
        let (h, w) = evaluate_homogeneous(control_pts, weights, knots, degree, t)?;
        if w.abs() < MIN_WEIGHT {
            bail!("nurbs: w(t) too close to zero");
        }
        (h / w, w)
    };
    // Lift again to compute derivative B-splines.
    let lifted_xyz: Vec<DVec3> = control_pts
        .iter()
        .zip(weights.iter())
        .map(|(p, &w)| *p * w)
        .collect();
    let lifted_w: Vec<DVec3> = weights
        .iter()
        .map(|&w| DVec3::new(w, 0.0, 0.0))
        .collect();
    // Derivative spline: degree p-1, with adjusted control points + dropped end knots.
    let (dxyz, dknots) = bspline::derivative_data(&lifted_xyz, knots, degree);
    let (dwl, _) = bspline::derivative_data(&lifted_w, knots, degree);
    if dxyz.is_empty() || dwl.is_empty() {
        return Ok(DVec3::ZERO);
    }
    let span = bspline::find_knot_span(&dknots, degree - 1, dxyz.len(), t);
    let h_prime = bspline::de_boor(&dxyz, &dknots, degree - 1, span, t);
    let w_prime = bspline::de_boor(&dwl, &dknots, degree - 1, span, t).x;
    Ok((h_prime - c * w_prime) / w)
}

/// Tessellate to chord error tolerance.
pub fn tessellate(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    chord_tol: f64,
) -> Result<Vec<DVec3>> {
    validate(control_pts, weights, knots, degree)?;
    let (t_start, t_end) = (knots[degree], knots[control_pts.len()]);

    // Initial sample density proportional to control-polygon length.
    let mut polygon_len: f64 = 0.0;
    for i in 0..control_pts.len() - 1 {
        polygon_len += (control_pts[i + 1] - control_pts[i]).length();
    }
    let init_n = ((polygon_len / chord_tol.max(1e-12)).ceil() as usize)
        .clamp(degree * 2 + 1, 4096);
    let mut params: Vec<f64> = (0..=init_n)
        .map(|i| t_start + (t_end - t_start) * (i as f64) / (init_n as f64))
        .collect();

    // Adaptive midpoint refinement (one pass — Phase C MVP).
    let mut refined = Vec::with_capacity(params.len() * 2);
    refined.push(params[0]);
    for i in 0..params.len() - 1 {
        let t0 = params[i];
        let t1 = params[i + 1];
        let tm = 0.5 * (t0 + t1);
        let p0 = evaluate(control_pts, weights, knots, degree, t0)?;
        let p1 = evaluate(control_pts, weights, knots, degree, t1)?;
        let pm_curve = evaluate(control_pts, weights, knots, degree, tm)?;
        let pm_chord = (p0 + p1) * 0.5;
        if (pm_curve - pm_chord).length() > chord_tol {
            refined.push(tm);
        }
        refined.push(t1);
    }
    params = refined;

    let mut pts = Vec::with_capacity(params.len());
    for &t in &params {
        pts.push(evaluate(control_pts, weights, knots, degree, t)?);
    }
    Ok(pts)
}

/// Approximate arc length via tessellation polygon length.
pub fn arc_length(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
) -> Result<f64> {
    let pts = tessellate(control_pts, weights, knots, degree, 1e-3)?;
    let mut len = 0.0;
    for i in 0..pts.len() - 1 {
        len += (pts[i + 1] - pts[i]).length();
    }
    Ok(len)
}

/// Boehm's knot insertion — inserts `t_new` once into the knot vector,
/// adjusting control points + weights so the curve geometry is preserved.
///
/// Returns `(new_ctrl, new_weights, new_knots)`. Caller must ensure
/// `t_new` is within the parameter range.
pub fn knot_insert(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t_new: f64,
) -> Result<(Vec<DVec3>, Vec<f64>, Vec<f64>)> {
    validate(control_pts, weights, knots, degree)?;
    let p = degree;
    let n = control_pts.len();
    let span = bspline::find_knot_span(knots, p, n, t_new);

    // Lift to 4D for rational arithmetic.
    let lifted: Vec<(DVec3, f64)> = control_pts
        .iter()
        .zip(weights.iter())
        .map(|(p, &w)| (*p * w, w))
        .collect();

    // Boehm's algorithm (Piegl & Tiller A5.1) for single knot insertion (no
    // existing multiplicity at t_new):
    //   Q[i] = P[i]                         for i ∈ [0, span-p]
    //   Q[i] = (1-α_i) P[i-1] + α_i P[i]    for i ∈ [span-p+1, span]
    //   Q[i+1] = P[i]                       for i ∈ [span, n-1]
    // where α_i = (t_new - U[i]) / (U[i+p] - U[i]).
    //
    // Critical: the right-hand side of the middle case uses ORIGINAL P[i-1]
    // and P[i], NOT the recomputed Q values.
    let mut new_lifted: Vec<(DVec3, f64)> = Vec::with_capacity(n + 1);
    // Block 1: copy P[0 .. span-p]
    for i in 0..=(span - p) {
        new_lifted.push(lifted[i]);
    }
    // Block 2: p new points
    for i in (span - p + 1)..=span {
        let denom = knots[i + p] - knots[i];
        let alpha = if denom.abs() < 1e-12 { 0.0 } else { (t_new - knots[i]) / denom };
        let prev = lifted[i - 1];                  // original P[i-1]
        let cur = lifted[i];                       // original P[i]
        let mixed_xyz = prev.0 * (1.0 - alpha) + cur.0 * alpha;
        let mixed_w = prev.1 * (1.0 - alpha) + cur.1 * alpha;
        new_lifted.push((mixed_xyz, mixed_w));
    }
    // Block 3: copy P[span .. n-1]
    for i in span..n {
        new_lifted.push(lifted[i]);
    }

    // Reconstruct from 4D
    let new_ctrl: Vec<DVec3> = new_lifted.iter()
        .map(|(xyz, w)| if w.abs() < MIN_WEIGHT { DVec3::ZERO } else { *xyz / *w })
        .collect();
    let new_weights: Vec<f64> = new_lifted.iter().map(|(_, w)| *w).collect();

    // New knot vector: insert t_new between knots[span] and knots[span+1].
    let mut new_knots = Vec::with_capacity(knots.len() + 1);
    new_knots.extend_from_slice(&knots[..=span]);
    new_knots.push(t_new);
    new_knots.extend_from_slice(&knots[span + 1..]);

    Ok((new_ctrl, new_weights, new_knots))
}

/// Valid parameter range `[u_p, u_n]`.
pub fn parameter_range(knots: &[f64], degree: usize, n_ctrl: usize) -> (f64, f64) {
    (knots[degree], knots[n_ctrl])
}

// ────────────────────────────────────────────────────────────────────────
// Internal validation
// ────────────────────────────────────────────────────────────────────────

fn validate(
    control_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
) -> Result<()> {
    if degree == 0 {
        bail!("nurbs: degree must be ≥ 1");
    }
    if control_pts.len() != weights.len() {
        bail!(
            "nurbs: control_pts ({}) and weights ({}) length mismatch",
            control_pts.len(), weights.len(),
        );
    }
    if control_pts.len() < degree + 1 {
        bail!(
            "nurbs: needs ≥ degree+1 = {} control points, got {}",
            degree + 1, control_pts.len(),
        );
    }
    let expected_knots = control_pts.len() + degree + 1;
    if knots.len() != expected_knots {
        bail!(
            "nurbs: knots.len() must be control_pts + degree + 1 = {}, got {}",
            expected_knots, knots.len(),
        );
    }
    for i in 1..knots.len() {
        if knots[i] < knots[i - 1] {
            bail!("nurbs: non-decreasing knots required");
        }
    }
    for &w in weights {
        if w <= MIN_WEIGHT {
            bail!("nurbs: all weights must be > {}, got {}", MIN_WEIGHT, w);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::bspline::clamped_uniform_knots;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    #[test]
    fn validate_rejects_weight_count_mismatch() {
        let pts = vec![DVec3::ZERO; 4];
        let weights = vec![1.0; 3];  // mismatch
        let knots = clamped_uniform_knots(4, 3);
        assert!(validate(&pts, &weights, &knots, 3).is_err());
    }

    #[test]
    fn validate_rejects_zero_weight() {
        let pts = vec![DVec3::ZERO; 4];
        let mut weights = vec![1.0; 4];
        weights[2] = 0.0;
        let knots = clamped_uniform_knots(4, 3);
        assert!(validate(&pts, &weights, &knots, 3).is_err());
    }

    #[test]
    fn validate_rejects_negative_weight() {
        let pts = vec![DVec3::ZERO; 4];
        let weights = vec![1.0, 1.0, -0.5, 1.0];
        let knots = clamped_uniform_knots(4, 3);
        assert!(validate(&pts, &weights, &knots, 3).is_err());
    }

    #[test]
    fn evaluate_unit_weights_matches_bspline() {
        // When all weights = 1, NURBS = B-spline.
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 5.0, 0.0),
            DVec3::new(8.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0; 4];
        let knots = clamped_uniform_knots(4, 3);
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let nurbs_pt = evaluate(&pts, &weights, &knots, 3, t).unwrap();
            let bspline_pt = bspline::evaluate(&pts, &knots, 3, t).unwrap();
            assert!(approx_eq(nurbs_pt, bspline_pt, 1e-9),
                "at t={}: nurbs={:?}, bspline={:?}", t, nurbs_pt, bspline_pt);
        }
    }

    #[test]
    fn evaluate_clamped_endpoints_match_first_last_ctrl() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 2.0, 0.5, 1.0];
        let knots = clamped_uniform_knots(4, 3);
        let p0 = evaluate(&pts, &weights, &knots, 3, 0.0).unwrap();
        let p1 = evaluate(&pts, &weights, &knots, 3, 1.0).unwrap();
        // At clamped endpoints, NURBS interpolates first / last control points
        // (regardless of weight, since basis is concentrated on one ctrl).
        assert!(approx_eq(p0, pts[0], 1e-9));
        assert!(approx_eq(p1, pts[3], 1e-9));
    }

    #[test]
    fn evaluate_homogeneous_returns_correct_w() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 2.0, 1.0];
        let knots = clamped_uniform_knots(3, 2);
        let (_h, w) = evaluate_homogeneous(&pts, &weights, &knots, 2, 0.5).unwrap();
        // At t=0.5 (param midpoint), basis should contribute non-trivially.
        // With weight 2 on middle ctrl, w(t=0.5) > 1.
        assert!(w > 1.0, "expected w > 1, got {}", w);
    }

    #[test]
    fn weighted_circle_quarter_arc_radius_invariant() {
        // Quadratic NURBS quarter circle: 3 ctrl points, weights [1, √2/2, 1]
        // at corners (1,0), (1,1), (0,1) — should produce a unit circle arc.
        let r = 5.0;
        let pts = vec![
            DVec3::new(r, 0.0, 0.0),
            DVec3::new(r, r, 0.0),       // corner ctrl
            DVec3::new(0.0, r, 0.0),
        ];
        let w_corner = 0.5_f64.sqrt();
        let weights = vec![1.0, w_corner, 1.0];
        let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        // Sample several t values and verify radius is r.
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let p = evaluate(&pts, &weights, &knots, 2, t).unwrap();
            let radius = p.length();
            assert!((radius - r).abs() < 1e-6,
                "t={}: radius {} != {}", t, radius, r);
        }
    }

    #[test]
    fn knot_insert_preserves_geometry() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 5.0, 0.0),
            DVec3::new(8.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 1.5, 1.5, 1.0];
        let knots = clamped_uniform_knots(4, 3);
        let t_insert = 0.5;
        let (npts, nweights, nknots) =
            knot_insert(&pts, &weights, &knots, 3, t_insert).unwrap();
        // Sample several t values on both versions — must match.
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let p_old = evaluate(&pts, &weights, &knots, 3, t).unwrap();
            let p_new = evaluate(&npts, &nweights, &nknots, 3, t).unwrap();
            assert!(approx_eq(p_old, p_new, 1e-9),
                "knot insert changed geometry at t={}: old={:?}, new={:?}",
                t, p_old, p_new);
        }
        // Ctrl count + 1, knot count + 1.
        assert_eq!(npts.len(), pts.len() + 1);
        assert_eq!(nknots.len(), knots.len() + 1);
    }

    #[test]
    fn knot_insert_increases_count_by_one() {
        let pts = vec![DVec3::ZERO, DVec3::X, DVec3::Y, DVec3::Z];
        let weights = vec![1.0; 4];
        let knots = clamped_uniform_knots(4, 3);
        let (np, nw, nk) = knot_insert(&pts, &weights, &knots, 3, 0.3).unwrap();
        assert_eq!(np.len(), 5);
        assert_eq!(nw.len(), 5);
        assert_eq!(nk.len(), 9);
    }

    #[test]
    fn derivative_endpoint_tangent_direction() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 2.0, 2.0, 1.0];
        let knots = clamped_uniform_knots(4, 3);
        let d = derivative(&pts, &weights, &knots, 3, 1.0).unwrap();
        let edge = pts[3] - pts[2];
        let dot = d.normalize().dot(edge.normalize());
        assert!(dot > 0.99, "tangent at t=1 should align with last edge, dot={}", dot);
    }

    #[test]
    fn tessellate_lod_scales_with_tolerance() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(50.0, 100.0, 0.0),
            DVec3::new(100.0, -50.0, 0.0),
            DVec3::new(150.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 2.0, 0.5, 1.0];
        let knots = clamped_uniform_knots(4, 3);
        let coarse = tessellate(&pts, &weights, &knots, 3, 5.0).unwrap();
        let fine = tessellate(&pts, &weights, &knots, 3, 0.05).unwrap();
        assert!(fine.len() > coarse.len());
    }

    #[test]
    fn tessellate_endpoints_preserved() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 10.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0, 2.0, 1.0];
        let knots = clamped_uniform_knots(3, 2);
        let pts_tess = tessellate(&pts, &weights, &knots, 2, 0.05).unwrap();
        assert!(approx_eq(pts_tess[0], pts[0], 1e-9));
        assert!(approx_eq(*pts_tess.last().unwrap(), pts[2], 1e-9));
    }

    #[test]
    fn arc_length_unit_weights_matches_bspline() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 4.0, 0.0),
            DVec3::new(8.0, 4.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let weights = vec![1.0; 4];
        let knots = clamped_uniform_knots(4, 3);
        let nurbs_len = arc_length(&pts, &weights, &knots, 3).unwrap();
        let bspline_len = bspline::arc_length(&pts, &knots, 3).unwrap();
        assert!((nurbs_len - bspline_len).abs() < 1e-3);
    }

    #[test]
    fn parameter_range_clamped() {
        let knots = clamped_uniform_knots(4, 3);
        let r = parameter_range(&knots, 3, 4);
        assert!((r.0 - 0.0).abs() < 1e-12);
        assert!((r.1 - 1.0).abs() < 1e-12);
    }

    #[test]
    fn weight_increases_pull_curve_toward_ctrl_point() {
        // Quadratic NURBS, middle ctrl with high weight should pull curve.
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 10.0, 0.0),  // pull-toward target
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let p_low = evaluate(&pts, &[1.0, 0.5, 1.0], &knots, 2, 0.5).unwrap();
        let p_high = evaluate(&pts, &[1.0, 5.0, 1.0], &knots, 2, 0.5).unwrap();
        // Higher weight → curve mid-point closer to control point.
        let dist_low = (p_low - pts[1]).length();
        let dist_high = (p_high - pts[1]).length();
        assert!(dist_high < dist_low,
            "higher weight should pull closer: low={}, high={}", dist_low, dist_high);
    }
}
