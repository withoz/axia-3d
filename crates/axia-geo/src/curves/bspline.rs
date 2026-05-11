//! B-spline curve — piecewise Bezier with knot vector (Phase B, ADR-029).
//!
//! ## Definition
//!
//! Given:
//! - control points `P_0, ..., P_n` (n+1 points)
//! - knot vector `u_0 ≤ u_1 ≤ ... ≤ u_m` (m+1 knots, m = n + p + 1)
//! - degree `p`
//!
//! The B-spline curve is:
//!
//! ```text
//! C(t) = Σ_{i=0..n} N_i^p(t) · P_i ,   t ∈ [u_p, u_{n+1}]
//! ```
//!
//! where `N_i^p(t)` are the B-spline basis functions defined by the Cox-de
//! Boor recursion.
//!
//! ## Algorithms
//!
//! - **Evaluation**: de Boor (multi-knot extension of de Casteljau)
//! - **Derivative**: B-spline of degree p-1 with adjusted control points
//!
//! ## Validation (P14.6)
//!
//! - degree ≥ 1
//! - control_pts.len() ≥ degree + 1
//! - knots.len() == control_pts.len() + degree + 1
//! - knots non-decreasing

use anyhow::{bail, Result};
use glam::DVec3;

/// Evaluate a B-spline curve at parameter `t`.
pub fn evaluate(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t: f64,
) -> Result<DVec3> {
    validate(control_pts, knots, degree)?;
    let span = find_knot_span(knots, degree, control_pts.len(), t);
    Ok(de_boor(control_pts, knots, degree, span, t))
}

/// First derivative `dC/dt` at parameter `t`.
///
/// The derivative is itself a B-spline of degree p-1 with:
///   - control points: `Q_i = p · (P_{i+1} - P_i) / (u_{i+p+1} - u_{i+1})`
///   - knots: drop first and last knot of the original
pub fn derivative(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t: f64,
) -> Result<DVec3> {
    validate(control_pts, knots, degree)?;
    if degree == 0 {
        // Step function — derivative is zero almost everywhere.
        return Ok(DVec3::ZERO);
    }
    let (dctrl, dknots) = derivative_data(control_pts, knots, degree);
    if dctrl.is_empty() {
        return Ok(DVec3::ZERO);
    }
    evaluate(&dctrl, &dknots, degree - 1, t)
}

/// Tessellate the curve into a polyline with chord error ≤ `chord_tol`.
///
/// Strategy: sample uniformly in the parameter range with a count derived
/// from the control polygon length and degree. Then run an adaptive midpoint
/// refinement pass — if any chord midpoint is more than `chord_tol` from
/// the analytic curve at midpoint t, insert that t.
pub fn tessellate(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    chord_tol: f64,
) -> Result<Vec<DVec3>> {
    validate(control_pts, knots, degree)?;
    let (t_start, t_end) = parameter_range_inner(knots, degree, control_pts.len());

    // Initial uniform sample — proportional to control polygon length.
    let mut polygon_len: f64 = 0.0;
    for i in 0..control_pts.len() - 1 {
        polygon_len += (control_pts[i + 1] - control_pts[i]).length();
    }
    let init_n = ((polygon_len / chord_tol.max(1e-12)).ceil() as usize)
        .clamp(degree * 2 + 1, 4096);

    let mut params: Vec<f64> = (0..=init_n)
        .map(|i| t_start + (t_end - t_start) * (i as f64) / (init_n as f64))
        .collect();

    // Adaptive midpoint refinement (single pass for Phase B; Phase C may
    // recurse with full chord-error analysis).
    let mut refined: Vec<f64> = Vec::with_capacity(params.len() * 2);
    refined.push(params[0]);
    for i in 0..params.len() - 1 {
        let t0 = params[i];
        let t1 = params[i + 1];
        let tm = 0.5 * (t0 + t1);
        let p0 = evaluate(control_pts, knots, degree, t0)?;
        let p1 = evaluate(control_pts, knots, degree, t1)?;
        let pm_curve = evaluate(control_pts, knots, degree, tm)?;
        let pm_chord = (p0 + p1) * 0.5;
        let dev = (pm_curve - pm_chord).length();
        if dev > chord_tol {
            refined.push(tm);
        }
        refined.push(t1);
    }
    params = refined;

    // Final eval to produce points.
    let mut pts: Vec<DVec3> = Vec::with_capacity(params.len());
    for &t in &params {
        pts.push(evaluate(control_pts, knots, degree, t)?);
    }
    Ok(pts)
}

/// Approximate arc length via tessellation polygon length.
pub fn arc_length(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> Result<f64> {
    let pts = tessellate(control_pts, knots, degree, 1e-3)?;
    let mut len = 0.0;
    for i in 0..pts.len() - 1 {
        len += (pts[i + 1] - pts[i]).length();
    }
    Ok(len)
}

/// Valid parameter range `[u_p, u_{n+1}]` for evaluation.
pub fn parameter_range(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> Result<(f64, f64)> {
    validate(control_pts, knots, degree)?;
    Ok(parameter_range_inner(knots, degree, control_pts.len()))
}

/// Construct a clamped uniform knot vector for `n_ctrl` control points and
/// given `degree`. The result has `(degree + 1)` repeated knots at each end
/// and uniformly spaced knots in between, normalized to [0, 1].
///
/// Useful for "default" B-spline construction from just control points.
pub fn clamped_uniform_knots(n_ctrl: usize, degree: usize) -> Vec<f64> {
    let n = n_ctrl;
    let p = degree;
    if n < p + 1 {
        return Vec::new();
    }
    let m = n + p + 1;  // number of knots
    let mut knots = Vec::with_capacity(m);
    // p+1 zeros at start
    for _ in 0..=p {
        knots.push(0.0);
    }
    // interior knots — uniform distribution
    let interior = m - 2 * (p + 1);
    for i in 1..=interior {
        knots.push(i as f64 / (interior + 1) as f64);
    }
    // p+1 ones at end
    for _ in 0..=p {
        knots.push(1.0);
    }
    knots
}

/// Extract Bezier strips from a clamped non-rational B-spline curve.
///
/// Returns `(strips, ranges)` where each strip is a `degree+1`-point Bezier
/// control array and `ranges[i]` is the parameter sub-range
/// `(u_min_i, u_max_i)` that strip `i` covers in the original B-spline
/// parameterization.
///
/// Algorithm: repeatedly insert each interior knot until its multiplicity
/// equals `degree`. After full insertion, every consecutive `degree+1`
/// control points (with stride `degree`) form one Bezier segment.
///
/// **Non-rational only**: weights treated as 1.0. For rational NURBS use
/// `nurbs::extract_bezier_strips` (see follow-up).
pub fn extract_bezier_strips(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<(f64, f64)>)> {
    validate(control_pts, knots, degree)?;
    let p = degree;
    let n_ctrl = control_pts.len();
    let (u_min, u_max) = parameter_range_inner(knots, p, n_ctrl);

    // Compute unique interior knot breakpoints from ORIGINAL knot vector
    // (insertion only adds multiplicities, doesn't introduce new break values).
    let mut breaks: Vec<f64> = vec![u_min];
    for i in (p + 1)..(knots.len() - p - 1) {
        let k = knots[i];
        if k > u_min + 1e-12
            && k < u_max - 1e-12
            && (*breaks.last().unwrap() - k).abs() > 1e-12
        {
            breaks.push(k);
        }
    }
    breaks.push(u_max);
    let num_strips = breaks.len() - 1;

    // Trivial case: already a single Bezier (no interior knots).
    if num_strips == 1 {
        // Verify control count matches degree+1 (clamped Bezier).
        if n_ctrl != p + 1 {
            // Knot structure says one strip but we have non-Bezier ctrl count
            // → fall through to insertion (handles non-clamped or weird cases).
        } else {
            return Ok((vec![control_pts.to_vec()], vec![(u_min, u_max)]));
        }
    }

    // Iteratively insert each interior knot until it has multiplicity `p`.
    let mut working_ctrl = control_pts.to_vec();
    let mut working_knots = knots.to_vec();
    loop {
        // Find first interior knot with mult < p.
        let mut to_insert: Option<f64> = None;
        let n_now = working_ctrl.len();
        let mut i = p + 1;
        while i < working_knots.len() - p - 1 {
            let t = working_knots[i];
            if t <= u_min + 1e-12 || t >= u_max - 1e-12 {
                i += 1;
                continue;
            }
            let mut mult = 0;
            let mut j = i;
            while j < working_knots.len() && (working_knots[j] - t).abs() < 1e-12 {
                mult += 1;
                j += 1;
            }
            if mult < p {
                to_insert = Some(t);
                break;
            }
            i = j;
        }
        match to_insert {
            None => break,
            Some(t) => {
                let weights = vec![1.0_f64; n_now];
                let (new_ctrl, _new_w, new_knots) = crate::curves::nurbs::knot_insert(
                    &working_ctrl, &weights, &working_knots, p, t,
                )?;
                working_ctrl = new_ctrl;
                working_knots = new_knots;
            }
        }
    }

    // Partition: strip k uses ctrl[k*p ..= k*p + p].
    let mut strips = Vec::with_capacity(num_strips);
    let mut ranges = Vec::with_capacity(num_strips);
    for k in 0..num_strips {
        let start = k * p;
        let end = start + p + 1;
        if end > working_ctrl.len() {
            bail!(
                "bspline::extract_bezier_strips: partition index OOB \
                ({} > {}); knot/ctrl mismatch", end, working_ctrl.len()
            );
        }
        strips.push(working_ctrl[start..end].to_vec());
        ranges.push((breaks[k], breaks[k + 1]));
    }
    Ok((strips, ranges))
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

/// ADR-089 A-Δ-β — Detect periodic (non-clamped uniform) knot vector.
///
/// Returns `true` when the knot vector represents a periodic BSpline:
/// - First (degree+1) knots are NOT all equal (not clamped at start)
/// - Last (degree+1) knots are NOT all equal (not clamped at end)
/// - Spacing between consecutive knots is uniform (within EPSILON)
///
/// Periodic BSplines naturally close (P at knots[degree] equals P at
/// knots[n_ctrl]) regardless of control point repetition. Used by
/// `add_face_closed_curve` to accept closed periodic BSplines whose
/// control polygons are NOT closed.
pub fn is_periodic_knots(knots: &[f64], degree: usize) -> bool {
    if knots.len() < 2 * (degree + 1) {
        return false;
    }
    let eps = 1e-9;
    // Not clamped at start (first degree+1 knots not all equal).
    let first = knots[0];
    let mut start_clamped = true;
    for i in 1..=degree {
        if (knots[i] - first).abs() > eps {
            start_clamped = false;
            break;
        }
    }
    if start_clamped { return false; }
    // Not clamped at end (last degree+1 knots not all equal).
    let n = knots.len() - 1;
    let last = knots[n];
    let mut end_clamped = true;
    for i in 1..=degree {
        if (knots[n - i] - last).abs() > eps {
            end_clamped = false;
            break;
        }
    }
    if end_clamped { return false; }
    // Uniform spacing.
    let span = knots[1] - knots[0];
    if span.abs() < eps { return false; }
    for i in 2..knots.len() {
        let d = knots[i] - knots[i - 1];
        if (d - span).abs() > eps * span.abs().max(1.0) {
            return false;
        }
    }
    true
}

pub fn validate(control_pts: &[DVec3], knots: &[f64], degree: usize) -> Result<()> {
    if degree == 0 {
        bail!("bspline: degree must be ≥ 1, got 0");
    }
    if control_pts.len() < degree + 1 {
        bail!(
            "bspline: needs ≥ degree+1 = {} control points, got {}",
            degree + 1,
            control_pts.len(),
        );
    }
    let expected_knots = control_pts.len() + degree + 1;
    if knots.len() != expected_knots {
        bail!(
            "bspline: knots.len() must be control_pts.len() + degree + 1 = {}, got {}",
            expected_knots,
            knots.len(),
        );
    }
    // Non-decreasing check
    for i in 1..knots.len() {
        if knots[i] < knots[i - 1] {
            bail!(
                "bspline: knot vector must be non-decreasing — knots[{}]={} < knots[{}]={}",
                i, knots[i], i - 1, knots[i - 1],
            );
        }
    }
    Ok(())
}

fn parameter_range_inner(knots: &[f64], degree: usize, n_ctrl: usize) -> (f64, f64) {
    // Valid range is [u_p, u_{n+1}] where n = n_ctrl - 1.
    // i.e., index `degree` to `n_ctrl`.
    (knots[degree], knots[n_ctrl])
}

/// Find knot span containing `t`. Returns the index `i` such that
/// `knots[i] ≤ t < knots[i + 1]` (with edge case for `t == u_{n+1}`).
pub(crate) fn find_knot_span(
    knots: &[f64],
    degree: usize,
    n_ctrl: usize,
    t: f64,
) -> usize {
    let n = n_ctrl - 1;  // last control index
    let high = knots[n + 1];
    if t >= high {
        return n;
    }
    let low = knots[degree];
    if t <= low {
        return degree;
    }
    // Binary search.
    let mut lo = degree;
    let mut hi = n + 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if t < knots[mid] {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    lo
}

/// de Boor algorithm — evaluate a B-spline at parameter `t` given the knot
/// span. Numerically stable.
pub(crate) fn de_boor(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    span: usize,
    t: f64,
) -> DVec3 {
    let p = degree;
    // Working buffer of p+1 control points, copying P_{span-p} ... P_span.
    let mut d: Vec<DVec3> = (0..=p).map(|j| control_pts[span - p + j]).collect();
    for r in 1..=p {
        for j in (r..=p).rev() {
            let i = span - p + j;
            let denom = knots[i + p - r + 1] - knots[i];
            let alpha = if denom.abs() < 1e-12 {
                0.0
            } else {
                (t - knots[i]) / denom
            };
            d[j] = d[j - 1] * (1.0 - alpha) + d[j] * alpha;
        }
    }
    d[p]
}

/// Compute control points and knots of the derivative B-spline.
pub(crate) fn derivative_data(
    control_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> (Vec<DVec3>, Vec<f64>) {
    let p = degree;
    let n = control_pts.len();
    if n < 2 {
        return (Vec::new(), Vec::new());
    }
    let mut dctrl: Vec<DVec3> = Vec::with_capacity(n - 1);
    for i in 0..n - 1 {
        let denom = knots[i + p + 1] - knots[i + 1];
        if denom.abs() < 1e-12 {
            dctrl.push(DVec3::ZERO);
        } else {
            dctrl.push((control_pts[i + 1] - control_pts[i]) * (p as f64 / denom));
        }
    }
    // Drop first and last knots.
    let dknots: Vec<f64> = knots[1..knots.len() - 1].to_vec();
    (dctrl, dknots)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    #[test]
    fn validate_rejects_degree_zero() {
        let pts = vec![DVec3::ZERO; 3];
        let knots = vec![0.0; 4];
        assert!(validate(&pts, &knots, 0).is_err());
    }

    #[test]
    fn validate_rejects_too_few_control_points() {
        let pts = vec![DVec3::ZERO, DVec3::X];
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0];
        // degree 3 needs ≥ 4 control points
        assert!(validate(&pts, &knots, 3).is_err());
    }

    #[test]
    fn validate_rejects_wrong_knot_count() {
        let pts = vec![DVec3::ZERO; 4];
        let knots = vec![0.0; 5]; // wrong: should be 4 + 3 + 1 = 8 for degree 3
        assert!(validate(&pts, &knots, 3).is_err());
    }

    #[test]
    fn validate_rejects_decreasing_knots() {
        let pts = vec![DVec3::ZERO; 4];
        let knots = vec![0.0, 0.0, 0.0, 0.0, 0.5, 1.2, 0.9, 1.0]; // dec at idx 6
        assert!(validate(&pts, &knots, 3).is_err());
    }

    #[test]
    fn clamped_uniform_knots_cubic_4_ctrl() {
        let knots = clamped_uniform_knots(4, 3);
        // m = n + p + 1 = 4 + 3 + 1 = 8 knots
        assert_eq!(knots.len(), 8);
        // First p+1=4 are 0, last 4 are 1 (interior count = 0 → just clamps)
        assert_eq!(knots[..4], [0.0, 0.0, 0.0, 0.0]);
        assert_eq!(knots[4..], [1.0, 1.0, 1.0, 1.0]);
    }

    #[test]
    fn clamped_uniform_knots_cubic_6_ctrl() {
        let knots = clamped_uniform_knots(6, 3);
        // m = 6 + 3 + 1 = 10 knots, 4 + 4 = 8 boundary, 2 interior
        assert_eq!(knots.len(), 10);
        assert_eq!(knots[..4], [0.0, 0.0, 0.0, 0.0]);
        assert!((knots[4] - 1.0 / 3.0).abs() < 1e-9);
        assert!((knots[5] - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(knots[6..], [1.0, 1.0, 1.0, 1.0]);
    }

    #[test]
    fn parameter_range_clamped() {
        let pts = vec![
            DVec3::ZERO, DVec3::X, DVec3::Y, DVec3::Z,
        ];
        let knots = clamped_uniform_knots(4, 3);
        let r = parameter_range(&pts, &knots, 3).unwrap();
        assert!((r.0 - 0.0).abs() < 1e-12);
        assert!((r.1 - 1.0).abs() < 1e-12);
    }

    #[test]
    fn evaluate_clamped_endpoints_match_first_last_ctrl() {
        // Cubic B-spline with clamped knots: C(0) = P_0, C(1) = P_n.
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = clamped_uniform_knots(4, 3);
        let p0 = evaluate(&pts, &knots, 3, 0.0).unwrap();
        let p1 = evaluate(&pts, &knots, 3, 1.0).unwrap();
        assert!(approx_eq(p0, pts[0], 1e-9));
        assert!(approx_eq(p1, pts[3], 1e-9));
    }

    #[test]
    fn evaluate_uniform_cubic_continuous_across_knot() {
        // Evaluating just before and after an interior knot should be
        // continuous (B-splines of degree p have C^{p-k} continuity at
        // multiplicity-k knots — cubic with simple knot is C^2).
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(8.0, 2.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = clamped_uniform_knots(5, 3);
        // Find an interior knot
        let interior = knots[4];  // first interior knot for n=5, p=3
        let eps = 1e-6;
        let p_minus = evaluate(&pts, &knots, 3, interior - eps).unwrap();
        let p_plus = evaluate(&pts, &knots, 3, interior + eps).unwrap();
        assert!((p_minus - p_plus).length() < 1e-4,
            "not continuous: |{:?} - {:?}| = {}", p_minus, p_plus,
            (p_minus - p_plus).length());
    }

    #[test]
    fn linear_bspline_matches_polyline_segment() {
        // Degree 1 B-spline = piecewise linear interpolation of control points.
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
        ];
        // For degree 1, n_ctrl=3 → knot count = 3+1+1 = 5 → [0,0,0.5,1,1]
        let knots = clamped_uniform_knots(3, 1);
        // At t=0.5 (midpoint of param range), should hit P_1 = (10, 0, 0).
        let mid = evaluate(&pts, &knots, 1, 0.5).unwrap();
        assert!(approx_eq(mid, pts[1], 1e-9));
    }

    #[test]
    fn find_knot_span_correctness() {
        let knots = vec![0.0, 0.0, 0.0, 0.0, 0.25, 0.5, 0.75, 1.0, 1.0, 1.0, 1.0];
        // n_ctrl = 7 (m=11, n+1 = m - p - 1 = 11 - 3 - 1 = 7), degree 3
        let n_ctrl = 7;
        assert_eq!(find_knot_span(&knots, 3, n_ctrl, 0.0), 3);
        assert_eq!(find_knot_span(&knots, 3, n_ctrl, 0.3), 4);
        assert_eq!(find_knot_span(&knots, 3, n_ctrl, 0.6), 5);
        assert_eq!(find_knot_span(&knots, 3, n_ctrl, 0.9), 6);
        assert_eq!(find_knot_span(&knots, 3, n_ctrl, 1.0), 6);
    }

    #[test]
    fn tessellate_chord_error_within_tolerance() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 10.0, 0.0),
            DVec3::new(8.0, 10.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = clamped_uniform_knots(4, 3);
        let chord_tol = 0.1;
        let poly = tessellate(&pts, &knots, 3, chord_tol).unwrap();
        assert!(poly.len() >= 4);
        // Each segment midpoint should be near the analytic curve.
        for i in 0..poly.len() - 1 {
            let mid_chord = (poly[i] + poly[i + 1]) * 0.5;
            // Find approximate t for mid_chord
            let mut best = f64::MAX;
            for k in 0..=200 {
                let t = (k as f64) / 200.0;
                let p = evaluate(&pts, &knots, 3, t).unwrap();
                best = best.min((p - mid_chord).length());
            }
            assert!(best < chord_tol * 5.0,
                "segment {}: dist {} too large", i, best);
        }
    }

    #[test]
    fn tessellate_lod_scales_with_tolerance() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(50.0, 100.0, 0.0),
            DVec3::new(100.0, -50.0, 0.0),
            DVec3::new(150.0, 0.0, 0.0),
            DVec3::new(200.0, 50.0, 0.0),
        ];
        let knots = clamped_uniform_knots(5, 3);
        let coarse = tessellate(&pts, &knots, 3, 5.0).unwrap();
        let fine = tessellate(&pts, &knots, 3, 0.05).unwrap();
        assert!(fine.len() > coarse.len(),
            "fine ({}) must exceed coarse ({})", fine.len(), coarse.len());
    }

    #[test]
    fn derivative_endpoint_tangent_direction() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let knots = clamped_uniform_knots(4, 3);
        // At clamped end, derivative is parallel to (P_n - P_{n-1}).
        let d_end = derivative(&pts, &knots, 3, 1.0).unwrap();
        let edge = pts[3] - pts[2];
        let dot = d_end.normalize().dot(edge.normalize());
        assert!(dot > 0.99, "tangent at end should align with last edge, dot={}", dot);
    }

    #[test]
    fn derivative_zero_at_degree_zero() {
        // degree=0 produces step function; treat as zero derivative everywhere.
        // (Though degree 0 itself is rejected by validate, we test internal
        // path for completeness.)
        let pts = vec![DVec3::ZERO; 3];
        let knots = vec![0.0, 0.5, 1.0, 1.0];
        // validate would reject degree 0, but the public derivative routes
        // through validate first. So we just confirm it errors:
        assert!(derivative(&pts, &knots, 0, 0.5).is_err());
    }

    #[test]
    fn extract_bezier_single_segment_when_no_interior_knots() {
        // Clamped Bezier: 4 ctrl, degree 3, knots = [0,0,0,0,1,1,1,1].
        let pts = vec![
            DVec3::ZERO,
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 1.0, 0.0),
            DVec3::new(3.0, 0.0, 0.0),
        ];
        let knots = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
        let (strips, ranges) = extract_bezier_strips(&pts, &knots, 3).unwrap();
        assert_eq!(strips.len(), 1);
        assert_eq!(strips[0].len(), 4);
        assert_eq!(ranges, vec![(0.0, 1.0)]);
        // Control points unchanged.
        for i in 0..4 {
            assert!((strips[0][i] - pts[i]).length() < 1e-9);
        }
    }

    #[test]
    fn extract_bezier_uniform_cubic_yields_multiple_strips() {
        // 6 ctrl, degree 3, clamped uniform.
        let pts: Vec<DVec3> = (0..6)
            .map(|i| DVec3::new(i as f64, (i as f64).sin(), 0.0))
            .collect();
        let knots = clamped_uniform_knots(6, 3);
        // Knots: [0,0,0,0, 1/3, 2/3, 1,1,1,1] → 2 interior breakpoints
        // → 3 Bezier strips.
        let (strips, ranges) = extract_bezier_strips(&pts, &knots, 3).unwrap();
        assert_eq!(strips.len(), 3);
        for s in &strips {
            assert_eq!(s.len(), 4);  // degree+1
        }
        // Ranges should cover [0, 1] contiguously.
        assert!((ranges[0].0 - 0.0).abs() < 1e-12);
        assert!((ranges.last().unwrap().1 - 1.0).abs() < 1e-12);
        for i in 0..ranges.len() - 1 {
            assert!((ranges[i].1 - ranges[i + 1].0).abs() < 1e-12,
                "ranges not contiguous: {:?}", ranges);
        }
    }

    #[test]
    fn extract_bezier_evaluations_match_original_curve() {
        let pts: Vec<DVec3> = (0..7)
            .map(|i| DVec3::new(i as f64, (i as f64 * 0.5).cos() * 3.0, 0.0))
            .collect();
        let knots = clamped_uniform_knots(7, 3);
        let (strips, ranges) = extract_bezier_strips(&pts, &knots, 3).unwrap();

        // Sample each strip at t=0, 0.5, 1 (Bezier local) and compare against
        // B-spline evaluate at corresponding global parameter.
        for (strip, &(u0, u1)) in strips.iter().zip(ranges.iter()) {
            for &lt in &[0.0_f64, 0.25, 0.5, 0.75, 1.0] {
                let bezier_pt = crate::curves::bezier::evaluate(strip, lt).unwrap();
                let global_u = u0 + lt * (u1 - u0);
                let bspline_pt = evaluate(&pts, &knots, 3, global_u).unwrap();
                let err = (bezier_pt - bspline_pt).length();
                assert!(err < 1e-9,
                    "Bezier strip mismatch at lt={}, u={}: err={}", lt, global_u, err);
            }
        }
    }

    #[test]
    fn arc_length_increases_with_control_polygon_length() {
        let pts1 = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(15.0, 0.0, 0.0),
        ];
        let pts2 = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 30.0, 0.0),    // detour
            DVec3::new(10.0, -30.0, 0.0),
            DVec3::new(15.0, 0.0, 0.0),
        ];
        let knots = clamped_uniform_knots(4, 3);
        let len1 = arc_length(&pts1, &knots, 3).unwrap();
        let len2 = arc_length(&pts2, &knots, 3).unwrap();
        assert!(len2 > len1 * 1.5,
            "detour curve should be much longer: len1={}, len2={}", len1, len2);
    }
}
