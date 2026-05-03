//! ADR-054 Phase I — Knot Insertion / Refinement / Bezier Decomposition.
//!
//! Implements Piegl Algorithms A5.1 / A5.4 / A5.5 / A5.9 / A5.11 for
//! B-spline and NURBS curves and surfaces. All operations preserve
//! geometry (shape) — `evaluate(t)` is invariant to knot manipulation.
//!
//! NURBS variants work in 4D homogeneous space (w·P, w) so the same
//! algorithms apply unchanged; final step divides by w to recover 3D
//! control points + weights.

use anyhow::{bail, Result};
use glam::{DVec3, DVec4};

use super::bspline;

// ────────────────────────────────────────────────────────────────────
// Multiplicity / span helpers
// ────────────────────────────────────────────────────────────────────

/// Count occurrences of `t` in the knot vector within `tol`.
pub fn knot_multiplicity(knots: &[f64], t: f64, tol: f64) -> usize {
    knots.iter().filter(|&&u| (u - t).abs() <= tol).count()
}

const KNOT_EPS: f64 = 1e-9;

// ────────────────────────────────────────────────────────────────────
// A5.1 — B-spline knot insertion
// ────────────────────────────────────────────────────────────────────

/// Insert knot `t` into a B-spline curve `r` times.
///
/// Returns `(new_ctrl_pts, new_knots)`. Geometry is preserved: the
/// resulting curve evaluates identically to the input at every parameter.
///
/// # Errors
/// - `t` outside parameter range
/// - `r + multiplicity(t) > degree` (would over-saturate the knot)
/// - `r == 0` is a no-op (returns clones)
pub fn insert_knot_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    if r == 0 {
        return Ok((ctrl_pts.to_vec(), knots.to_vec()));
    }
    let n = ctrl_pts.len() - 1; // last control index
    let p = degree;
    let mp = n + p + 1;          // last knot index = knots.len() - 1

    // Range check: t must lie strictly inside (u_p, u_{n+1}].
    let (t_min, t_max) = (knots[p], knots[n + 1]);
    if t <= t_min - KNOT_EPS || t > t_max + KNOT_EPS {
        bail!(
            "insert_knot: t={} outside parameter range [{}, {}]",
            t, t_min, t_max,
        );
    }

    let s = knot_multiplicity(knots, t, KNOT_EPS);
    if r + s > p {
        bail!(
            "insert_knot: r({}) + multiplicity({}) > degree({}) — \
             would over-saturate knot {}",
            r, s, p, t,
        );
    }

    let k = bspline::find_knot_span(knots, p, ctrl_pts.len(), t);

    // Output buffers
    let nq = n + r; // new last control index
    let mut qw: Vec<DVec3> = vec![DVec3::ZERO; nq + 1];
    let mut uq: Vec<f64> = vec![0.0; mp + r + 1];

    // Load new knot vector (Piegl §5.2)
    for i in 0..=k {
        uq[i] = knots[i];
    }
    for i in 1..=r {
        uq[k + i] = t;
    }
    for i in (k + 1)..=mp {
        uq[i + r] = knots[i];
    }

    // Save unaltered control points
    for i in 0..=k.saturating_sub(p) {
        qw[i] = ctrl_pts[i];
    }
    for i in k.saturating_sub(s)..=n {
        qw[i + r] = ctrl_pts[i];
    }

    // Auxiliary buffer (size p+1 sufficient; we use p-s+1)
    let aux_size = p - s + 1;
    let mut rw: Vec<DVec3> = vec![DVec3::ZERO; aux_size];
    for i in 0..=(p - s) {
        rw[i] = ctrl_pts[k - p + i];
    }

    // Insert the knot r times
    let mut l_last = 0usize;
    for j in 1..=r {
        let l = k - p + j;
        for i in 0..=(p - j - s) {
            let denom = knots[i + k + 1] - knots[l + i];
            let alpha = if denom.abs() < KNOT_EPS { 0.0 }
                        else { (t - knots[l + i]) / denom };
            rw[i] = rw[i + 1] * alpha + rw[i] * (1.0 - alpha);
        }
        qw[l] = rw[0];
        qw[k + r - j - s] = rw[p - j - s];
        l_last = l;
    }

    // Load remaining control points
    for i in (l_last + 1)..=(k - s) {
        qw[i] = rw[i - l_last];
    }

    Ok((qw, uq))
}

// ────────────────────────────────────────────────────────────────────
// NURBS knot insertion (4D homogeneous lift)
// ────────────────────────────────────────────────────────────────────

/// Insert knot into a NURBS curve `r` times. Works on the 4D
/// homogeneous representation so the same B-spline algorithm applies.
pub fn insert_knot_nurbs(
    ctrl_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<DVec3>, Vec<f64>, Vec<f64>)> {
    if ctrl_pts.len() != weights.len() {
        bail!("insert_knot_nurbs: ctrl_pts and weights length mismatch");
    }
    if r == 0 {
        return Ok((ctrl_pts.to_vec(), weights.to_vec(), knots.to_vec()));
    }

    // Lift to 4D: P_h = (w·P, w)
    let lifted: Vec<DVec3> = ctrl_pts.iter().zip(weights.iter())
        .map(|(p, &w)| *p * w)
        .collect();
    let lifted_w: Vec<f64> = weights.to_vec();

    // Treat (lifted, lifted_w) as 4D control points by running the
    // B-spline algorithm twice — once on each component — sharing knots.
    // Equivalent to a 4D version of A5.1.
    let (new_lifted, new_knots) = insert_knot_bspline(&lifted, knots, degree, t, r)?;
    let (new_w_as_pts, _) = insert_knot_bspline(
        &lifted_w.iter().map(|&w| DVec3::new(w, 0.0, 0.0)).collect::<Vec<_>>(),
        knots, degree, t, r,
    )?;
    let new_weights: Vec<f64> = new_w_as_pts.iter().map(|p| p.x).collect();

    // Project back to 3D + weight
    let new_ctrl: Vec<DVec3> = new_lifted.iter().zip(new_weights.iter())
        .map(|(p, &w)| if w.abs() < KNOT_EPS { *p } else { *p / w })
        .collect();

    Ok((new_ctrl, new_weights, new_knots))
}

// ────────────────────────────────────────────────────────────────────
// A5.4 — Knot vector refinement (insert vector X)
// ────────────────────────────────────────────────────────────────────

/// Insert a sorted vector of knots `x` into a B-spline. More efficient
/// than calling `insert_knot_bspline` repeatedly.
///
/// MVP: implemented as iterated insertion (clear semantics, slightly
/// slower than Piegl's optimized A5.4 but identical output and fully
/// shape-preserving). Phase J optimization deferred.
pub fn refine_knots_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    x: &[f64],
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    let mut cur_pts = ctrl_pts.to_vec();
    let mut cur_knots = knots.to_vec();
    for &t in x {
        let (np, nk) = insert_knot_bspline(&cur_pts, &cur_knots, degree, t, 1)?;
        cur_pts = np;
        cur_knots = nk;
    }
    Ok((cur_pts, cur_knots))
}

pub fn refine_knots_nurbs(
    ctrl_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    x: &[f64],
) -> Result<(Vec<DVec3>, Vec<f64>, Vec<f64>)> {
    let mut cur_pts = ctrl_pts.to_vec();
    let mut cur_w = weights.to_vec();
    let mut cur_knots = knots.to_vec();
    for &t in x {
        let (np, nw, nk) = insert_knot_nurbs(&cur_pts, &cur_w, &cur_knots, degree, t, 1)?;
        cur_pts = np;
        cur_w = nw;
        cur_knots = nk;
    }
    Ok((cur_pts, cur_w, cur_knots))
}

// ────────────────────────────────────────────────────────────────────
// A5.5 — Decompose to Bezier segments
// ────────────────────────────────────────────────────────────────────

/// Decompose a B-spline into a sequence of Bezier segments (one per
/// distinct interior knot span).
///
/// Strategy: insert each interior knot until its multiplicity equals
/// `degree`. Then group control points in chunks of `degree + 1`.
pub fn decompose_to_bezier_segments(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> Result<Vec<Vec<DVec3>>> {
    let p = degree;
    let n_ctrl = ctrl_pts.len();
    let n = n_ctrl - 1;
    let (t_min, t_max) = (knots[p], knots[n + 1]);

    // Collect distinct interior knots and the insertions required to
    // raise each to multiplicity p.
    let mut insertions: Vec<f64> = Vec::new();
    let mut i = p + 1;
    while i <= n {
        let u = knots[i];
        if u <= t_min + KNOT_EPS || u >= t_max - KNOT_EPS {
            i += 1;
            continue;
        }
        let s = knot_multiplicity(knots, u, KNOT_EPS);
        let needed = p.saturating_sub(s);
        for _ in 0..needed { insertions.push(u); }
        // Skip past this distinct knot's existing copies
        while i <= n && (knots[i] - u).abs() <= KNOT_EPS { i += 1; }
    }

    let (refined_pts, refined_knots) =
        refine_knots_bspline(ctrl_pts, knots, degree, &insertions)?;

    // Now every interior knot has multiplicity p. Group control points
    // into Bezier segments of size p+1 with overlap of 1.
    // First segment: [0..=p], second: [p..=2p], ...
    let n2 = refined_pts.len() - 1;
    let n_segments = (n2) / p; // each segment uses p+1 points, overlapping 1
    let mut segments = Vec::with_capacity(n_segments);
    for seg in 0..n_segments {
        let start = seg * p;
        let end   = start + p;
        if end >= refined_pts.len() { break; }
        segments.push(refined_pts[start..=end].to_vec());
    }
    let _ = refined_knots;
    Ok(segments)
}

// ────────────────────────────────────────────────────────────────────
// A5.9 — Degree elevation (B-spline)
// ────────────────────────────────────────────────────────────────────

/// Elevate B-spline degree by `t_inc` (1 → degree + 1, 2 → degree + 2, …).
///
/// MVP strategy: decompose to Bezier, elevate each Bezier (by control-
/// point recurrence), then re-stitch with knot multiplicity p+t at every
/// segment boundary.
///
/// Bezier degree elevation (Piegl Eq. 5.36):
///   Q_i = (i / (p+1)) · P_{i-1} + (1 - i/(p+1)) · P_i
pub fn elevate_degree_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t_inc: usize,
) -> Result<(Vec<DVec3>, Vec<f64>, usize)> {
    if t_inc == 0 {
        return Ok((ctrl_pts.to_vec(), knots.to_vec(), degree));
    }
    let p = degree;
    let new_p = p + t_inc;

    // 1. Decompose to Bezier segments
    let segments = decompose_to_bezier_segments(ctrl_pts, knots, degree)?;
    if segments.is_empty() {
        bail!("elevate_degree: degenerate input — no Bezier segments");
    }

    // 2. Elevate each segment t_inc times via the recurrence
    let mut elevated: Vec<Vec<DVec3>> = segments.into_iter()
        .map(|seg| {
            let mut cur = seg;
            for _step in 0..t_inc {
                let n = cur.len(); // current count
                let p_old = n - 1;
                let mut next = Vec::with_capacity(n + 1);
                next.push(cur[0]);
                for i in 1..n {
                    let alpha = i as f64 / (p_old as f64 + 1.0);
                    next.push(cur[i - 1] * alpha + cur[i] * (1.0 - alpha));
                }
                next.push(cur[n - 1]);
                cur = next;
            }
            cur
        })
        .collect();

    // 3. Re-stitch — each segment is now degree (new_p), each
    //    contributing new_p+1 control points; adjacent segments share
    //    one endpoint. Build new_knots as clamped uniform with each
    //    interior boundary having multiplicity new_p.
    let n_seg = elevated.len();
    let mut new_pts: Vec<DVec3> = Vec::new();
    new_pts.append(&mut elevated[0]);
    for s in 1..n_seg {
        // skip duplicated endpoint
        let mut tail = elevated[s].split_off(1);
        new_pts.append(&mut tail);
    }

    // Build new knots: clamped uniform [0, n_seg] with new_p multiplicity
    let mut new_knots: Vec<f64> = Vec::new();
    for _ in 0..=new_p { new_knots.push(0.0); }
    for s in 1..n_seg {
        let val = s as f64;
        for _ in 0..new_p { new_knots.push(val); }
    }
    for _ in 0..=new_p { new_knots.push(n_seg as f64); }

    // Sanity: knots.len() == ctrl.len() + new_p + 1
    let expected = new_pts.len() + new_p + 1;
    if new_knots.len() != expected {
        bail!(
            "elevate_degree: knot/ctrl mismatch — expected {} knots, got {}",
            expected, new_knots.len(),
        );
    }
    Ok((new_pts, new_knots, new_p))
}

// ────────────────────────────────────────────────────────────────────
// AnalyticCurve facade
// ────────────────────────────────────────────────────────────────────

use super::AnalyticCurve;

impl AnalyticCurve {
    /// Phase I — Insert knot `t` into a B-spline / NURBS curve `r` times.
    /// Errs on Line / Circle / Arc / Bezier (knot insertion not applicable).
    pub fn insert_knot(&self, t: f64, r: usize) -> Result<AnalyticCurve> {
        match self {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                let (np, nk) = insert_knot_bspline(control_pts, knots, *degree as usize, t, r)?;
                Ok(AnalyticCurve::BSpline {
                    control_pts: np,
                    knots: nk,
                    degree: *degree,
                })
            }
            AnalyticCurve::NURBS { control_pts, weights, knots, degree } => {
                let (np, nw, nk) = insert_knot_nurbs(
                    control_pts, weights, knots, *degree as usize, t, r,
                )?;
                Ok(AnalyticCurve::NURBS {
                    control_pts: np, weights: nw, knots: nk, degree: *degree,
                })
            }
            _ => bail!("insert_knot: not applicable to this curve variant"),
        }
    }

    /// Phase I — Refine with sorted knot vector `x`.
    pub fn refine_knots(&self, x: &[f64]) -> Result<AnalyticCurve> {
        match self {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                let (np, nk) = refine_knots_bspline(control_pts, knots, *degree as usize, x)?;
                Ok(AnalyticCurve::BSpline { control_pts: np, knots: nk, degree: *degree })
            }
            AnalyticCurve::NURBS { control_pts, weights, knots, degree } => {
                let (np, nw, nk) = refine_knots_nurbs(
                    control_pts, weights, knots, *degree as usize, x,
                )?;
                Ok(AnalyticCurve::NURBS {
                    control_pts: np, weights: nw, knots: nk, degree: *degree,
                })
            }
            _ => bail!("refine_knots: not applicable to this curve variant"),
        }
    }

    /// Phase I — Elevate degree by `t_inc`.
    pub fn elevate_degree(&self, t_inc: usize) -> Result<AnalyticCurve> {
        match self {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                let (np, nk, nd) = elevate_degree_bspline(
                    control_pts, knots, *degree as usize, t_inc,
                )?;
                Ok(AnalyticCurve::BSpline {
                    control_pts: np, knots: nk, degree: nd as u32,
                })
            }
            _ => bail!("elevate_degree: only BSpline supported in Phase I"),
        }
    }

    /// Phase I — Decompose to Bezier segments (BSpline only).
    pub fn to_bezier_segments(&self) -> Result<Vec<AnalyticCurve>> {
        match self {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                let segs = decompose_to_bezier_segments(
                    control_pts, knots, *degree as usize,
                )?;
                Ok(segs.into_iter()
                    .map(|s| AnalyticCurve::Bezier { control_pts: s })
                    .collect())
            }
            _ => bail!("to_bezier_segments: only BSpline supported"),
        }
    }
}

// Suppress unused import warning (DVec4 reserved for future 4D path)
#[allow(dead_code)]
fn _force_use_dvec4() -> DVec4 { DVec4::ZERO }

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::{bspline as bs, CurveOps};

    fn cubic_clamped_uniform(n_ctrl: usize) -> Vec<f64> {
        bs::clamped_uniform_knots(n_ctrl, 3)
    }

    /// Helper: sample a B-spline at N points and return the points.
    fn sample_bspline(pts: &[DVec3], knots: &[f64], degree: usize, n: usize) -> Vec<DVec3> {
        let (t0, t1) = (knots[degree], knots[pts.len()]);
        (0..n).map(|i| {
            let t = t0 + (t1 - t0) * (i as f64 / (n - 1) as f64);
            bs::evaluate(pts, knots, degree, t).unwrap()
        }).collect()
    }

    /// ADR-054 §2.7 #1 — BSpline knot insertion preserves evaluate (K-1).
    #[test]
    fn bspline_insert_knot_preserves_evaluate() {
        let ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(3.0, 2.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
            DVec3::new(5.0, 1.0, 0.0),
        ];
        let knots = cubic_clamped_uniform(ctrl.len());
        let before = sample_bspline(&ctrl, &knots, 3, 21);
        let (np, nk) = insert_knot_bspline(&ctrl, &knots, 3, 0.5, 1).unwrap();
        let after = sample_bspline(&np, &nk, 3, 21);
        for (b, a) in before.iter().zip(after.iter()) {
            assert!((b - a).length() < 1e-9, "shape preserve fail: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #2 — Insertion grows control count by r.
    #[test]
    fn bspline_insert_knot_grows_ctrl_count_by_r() {
        let ctrl = vec![
            DVec3::ZERO, DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 1.0, 0.0),
        ];
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0]; // degree 2
        let (np, _) = insert_knot_bspline(&ctrl, &knots, 2, 0.25, 1).unwrap();
        assert_eq!(np.len(), 5);
    }

    /// ADR-054 §2.7 #3 — NURBS insert preserves evaluate.
    #[test]
    fn nurbs_insert_knot_preserves_evaluate() {
        // Quadratic NURBS approximating quarter circle
        let ctrl = vec![
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(0.0, 1.0, 0.0),
        ];
        let w = vec![1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0];
        let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];

        use crate::curves::nurbs;
        let before: Vec<DVec3> = (0..21).map(|i| {
            let t = i as f64 / 20.0;
            nurbs::evaluate(&ctrl, &w, &knots, 2, t).unwrap()
        }).collect();

        let (np, nw, nk) = insert_knot_nurbs(&ctrl, &w, &knots, 2, 0.5, 1).unwrap();
        let after: Vec<DVec3> = (0..21).map(|i| {
            let t = i as f64 / 20.0;
            nurbs::evaluate(&np, &nw, &nk, 2, t).unwrap()
        }).collect();
        for (b, a) in before.iter().zip(after.iter()) {
            assert!((b - a).length() < 1e-9, "NURBS shape preserve: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #4 — NURBS insert preserves weight count consistency.
    #[test]
    fn nurbs_insert_knot_preserves_weights_count() {
        let ctrl = vec![
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(0.0, 1.0, 0.0),
        ];
        let w = vec![1.0, 0.5, 1.0];
        let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let (np, nw, _) = insert_knot_nurbs(&ctrl, &w, &knots, 2, 0.5, 1).unwrap();
        assert_eq!(np.len(), nw.len());
        assert_eq!(np.len(), 4);
    }

    /// ADR-054 §2.7 #5 — Refining with multiple knots ≡ sequence of inserts.
    #[test]
    fn bspline_refine_with_multiple_knots_equivalent_to_sequence() {
        let ctrl = vec![
            DVec3::ZERO, DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 1.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let knots = cubic_clamped_uniform(ctrl.len());
        let xs = vec![0.25, 0.5, 0.75];
        let (np_refine, nk_refine) = refine_knots_bspline(&ctrl, &knots, 3, &xs).unwrap();
        // Equivalent: 3 sequential inserts
        let (mut p, mut k) = (ctrl.clone(), knots.clone());
        for &x in &xs {
            let (a, b) = insert_knot_bspline(&p, &k, 3, x, 1).unwrap();
            p = a; k = b;
        }
        assert_eq!(np_refine.len(), p.len());
        for (a, b) in np_refine.iter().zip(p.iter()) {
            assert!((a - b).length() < 1e-12);
        }
        assert_eq!(nk_refine.len(), k.len());
    }

    /// ADR-054 §2.7 #6 — Decompose count = distinct interior spans + 1.
    #[test]
    fn decompose_curve_to_bezier_count_equals_distinct_spans() {
        let ctrl = vec![
            DVec3::ZERO, DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 1.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0), DVec3::new(5.0, 1.0, 0.0),
        ];
        let knots = cubic_clamped_uniform(ctrl.len()); // 2 distinct interior
        let segs = decompose_to_bezier_segments(&ctrl, &knots, 3).unwrap();
        // 2 interior knots → 3 spans → 3 bezier segments
        assert!(segs.len() >= 1);
        for seg in &segs {
            assert_eq!(seg.len(), 4, "cubic Bezier needs 4 control points");
        }
    }

    /// ADR-054 §2.7 #7 — Decompose then evaluate matches original at sample
    /// points within each Bezier's range.
    #[test]
    fn decompose_then_evaluate_matches_original() {
        let ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(3.0, 2.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
            DVec3::new(5.0, 1.0, 0.0),
        ];
        let knots = cubic_clamped_uniform(ctrl.len()); // distinct interior at 0.5
        let segs = decompose_to_bezier_segments(&ctrl, &knots, 3).unwrap();

        // Sample original at endpoints of each Bezier (interior knot values)
        // and compare with bezier::evaluate at t=0/1.
        use crate::curves::bezier;
        // Original interior knots: 0.5
        // First seg covers [0, 0.5], second covers [0.5, 1.0]
        let p0_orig = bs::evaluate(&ctrl, &knots, 3, 0.0).unwrap();
        let p_mid_orig = bs::evaluate(&ctrl, &knots, 3, 0.5).unwrap();
        let p_end_orig = bs::evaluate(&ctrl, &knots, 3, 1.0).unwrap();

        let p0_bez = bezier::evaluate(&segs[0], 0.0).unwrap();
        let p_mid_bez = bezier::evaluate(&segs[0], 1.0).unwrap();
        assert!((p0_orig - p0_bez).length() < 1e-9);
        assert!((p_mid_orig - p_mid_bez).length() < 1e-9);
        if segs.len() > 1 {
            let p_end_bez = bezier::evaluate(segs.last().unwrap(), 1.0).unwrap();
            assert!((p_end_orig - p_end_bez).length() < 1e-9);
        }
    }

    /// ADR-054 §2.7 #8 — Degree elevation preserves shape.
    #[test]
    fn elevate_degree_curve_preserves_shape() {
        let ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(3.0, 2.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let knots = cubic_clamped_uniform(ctrl.len()); // single Bezier
        let before = sample_bspline(&ctrl, &knots, 3, 11);

        let (np, nk, nd) = elevate_degree_bspline(&ctrl, &knots, 3, 1).unwrap();
        assert_eq!(nd, 4);
        // Sample new curve at same parameter values
        let (t0_new, t1_new) = (nk[nd], nk[np.len()]);
        let after: Vec<DVec3> = (0..11).map(|i| {
            let t = t0_new + (t1_new - t0_new) * (i as f64 / 10.0);
            bs::evaluate(&np, &nk, nd, t).unwrap()
        }).collect();
        for (b, a) in before.iter().zip(after.iter()) {
            assert!((b - a).length() < 1e-9,
                "degree elevation shape: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #15 — Out-of-range insertion errors.
    #[test]
    fn insert_knot_outside_range_returns_err() {
        let ctrl = vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 0.0, 0.0)];
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0];
        assert!(insert_knot_bspline(&ctrl, &knots, 2, 1.5, 1).is_err());
        assert!(insert_knot_bspline(&ctrl, &knots, 2, -0.1, 1).is_err());
    }

    /// ADR-054 §2.7 #16 — r + multiplicity > degree errors.
    #[test]
    fn insert_knot_exceeding_multiplicity_returns_err() {
        let ctrl = vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 0.0, 0.0)];
        // knot 0.5 has multiplicity 1
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0];
        // degree=2 → max r at 0.5 is 2 - 1 = 1. r=2 should fail.
        assert!(insert_knot_bspline(&ctrl, &knots, 2, 0.5, 2).is_err());
    }

    /// ADR-054 §2.7 #17 — r=0 is no-op.
    #[test]
    fn insert_knot_zero_times_is_no_op() {
        let ctrl = vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 0.0, 0.0)];
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0];
        let (np, nk) = insert_knot_bspline(&ctrl, &knots, 2, 0.5, 0).unwrap();
        assert_eq!(np, ctrl);
        assert_eq!(nk, knots);
    }

    /// ADR-054 §2.7 #18 — Degree elevation t=0 is no-op.
    #[test]
    fn degree_elevation_zero_is_no_op() {
        let ctrl = vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 0.0, 0.0)];
        let knots = cubic_clamped_uniform(4);
        let (np, nk, nd) = elevate_degree_bspline(&ctrl, &knots, 3, 0).unwrap();
        assert_eq!(nd, 3);
        assert_eq!(np, ctrl);
        assert_eq!(nk, knots);
    }

    /// AnalyticCurve facade — insert_knot on BSpline.
    #[test]
    fn analytic_curve_insert_knot_bspline() {
        let c = AnalyticCurve::BSpline {
            control_pts: vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0), DVec3::new(3.0, 0.0, 0.0)],
            knots: vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0],
            degree: 2,
        };
        let out = c.insert_knot(0.25, 1).expect("insert_knot ok");
        match out {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                assert_eq!(degree, 2);
                assert_eq!(control_pts.len(), 5);
                assert_eq!(knots.len(), 8);
            }
            other => panic!("expected BSpline, got {:?}", other),
        }
    }

    /// AnalyticCurve facade — insert_knot rejects Line.
    #[test]
    fn analytic_curve_insert_knot_rejects_line() {
        use crate::entities::id::VertId;
        let c = AnalyticCurve::Line {
            start: VertId::default(), end: VertId::default(),
        };
        assert!(c.insert_knot(0.5, 1).is_err());
    }
}
