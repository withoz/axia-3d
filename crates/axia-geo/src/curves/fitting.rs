//! ADR-056 Phase K Step 1 — Curve Fitting (Piegl & Tiller §9).
//!
//! Implements:
//!   - A9.1 Global curve interpolation (exact through points)
//!   - A9.6 Least-squares curve approximation
//!   - Tolerance-driven incremental fitting
//!   - 3 parameterization methods (Uniform / ChordLength / Centripetal)
//!
//! All fitting produces non-rational B-spline curves (uniform weights).
//! Rational NURBS fitting is a Phase L extension.

use anyhow::{bail, Result};
use glam::DVec3;

use super::bspline::find_knot_span;

// ────────────────────────────────────────────────────────────────────
// Parameterization (Piegl §9.2)
// ────────────────────────────────────────────────────────────────────

/// Parameter assignment for a sequence of fit points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Parameterization {
    /// `t_k = k / N` — simple but poor for non-uniform spacing.
    Uniform,
    /// `t_k` proportional to chord length `|Q_k - Q_{k-1}|` (recommended
    /// default per Piegl §9.2.1).
    ChordLength,
    /// `t_k` proportional to `sqrt(chord)` — better for sharp turns,
    /// suppresses overshoot (Piegl §9.2.2).
    Centripetal,
}

/// Compute parameter values `t_0=0, t_1, ..., t_n=1` per `method`.
pub fn compute_parameters(points: &[DVec3], method: Parameterization) -> Vec<f64> {
    let n = points.len();
    if n < 2 { return vec![0.0; n]; }

    let mut params = vec![0.0_f64; n];
    match method {
        Parameterization::Uniform => {
            for i in 0..n {
                params[i] = i as f64 / (n - 1) as f64;
            }
        }
        Parameterization::ChordLength => {
            let chords: Vec<f64> = (1..n)
                .map(|i| (points[i] - points[i - 1]).length())
                .collect();
            let total: f64 = chords.iter().sum();
            if total < 1e-30 {
                // Degenerate — fall back to uniform
                return compute_parameters(points, Parameterization::Uniform);
            }
            let mut acc = 0.0;
            for i in 1..n {
                acc += chords[i - 1];
                params[i] = acc / total;
            }
            params[n - 1] = 1.0; // pin endpoint
        }
        Parameterization::Centripetal => {
            let chords_sqrt: Vec<f64> = (1..n)
                .map(|i| (points[i] - points[i - 1]).length().sqrt())
                .collect();
            let total: f64 = chords_sqrt.iter().sum();
            if total < 1e-30 {
                return compute_parameters(points, Parameterization::Uniform);
            }
            let mut acc = 0.0;
            for i in 1..n {
                acc += chords_sqrt[i - 1];
                params[i] = acc / total;
            }
            params[n - 1] = 1.0;
        }
    }
    params
}

// ────────────────────────────────────────────────────────────────────
// Knot vector for interpolation (Piegl Eq. 9.8 — averaging)
// ────────────────────────────────────────────────────────────────────

/// Compute knot vector for global interpolation through `n` points of
/// degree `p`. Length = `n + p + 1`.
pub(crate) fn knots_for_interpolation(params: &[f64], degree: usize) -> Vec<f64> {
    let p = degree;
    let n = params.len() - 1;  // last point index
    let m = n + p + 1;          // last knot index
    let mut knots = vec![0.0_f64; m + 1];
    for j in (m - p)..=m { knots[j] = 1.0; }
    // Interior knots — averaging (Piegl Eq. 9.8)
    for j in 1..=(n - p) {
        let mut sum = 0.0;
        for i in j..(j + p) { sum += params[i]; }
        knots[j + p] = sum / (p as f64);
    }
    knots
}

/// Compute knot vector for least-squares fit with `n_ctrl` control
/// points (n_ctrl > p+1). Length = `n_ctrl + p + 1`.
fn knots_for_lsq(params: &[f64], degree: usize, n_ctrl: usize) -> Vec<f64> {
    let p = degree;
    let n = n_ctrl - 1;
    let m_p1 = params.len();    // = num data points
    let total_knots = n_ctrl + p + 1;
    let mut knots = vec![0.0_f64; total_knots];
    for j in (n_ctrl)..total_knots { knots[j] = 1.0; }
    // Interior knots: distribute parameter values
    // Piegl Eq. 9.69 with d = (m+1) / (n_ctrl - p)
    let d = m_p1 as f64 / (n_ctrl - p) as f64;
    for j in 1..=(n - p) {
        let i = (j as f64 * d).floor() as usize;
        let alpha = (j as f64) * d - (i as f64);
        knots[p + j] = (1.0 - alpha) * params[i.saturating_sub(1).min(m_p1 - 1)]
            + alpha * params[i.min(m_p1 - 1)];
    }
    knots
}

// ────────────────────────────────────────────────────────────────────
// B-spline basis function evaluation (Piegl A2.2)
// ────────────────────────────────────────────────────────────────────

/// Evaluate non-zero basis functions N_{i-p..i}^p(t) at parameter t,
/// where `i = find_knot_span(...)`. Returns p+1 values.
pub(crate) fn basis_funs(span: usize, t: f64, degree: usize, knots: &[f64]) -> Vec<f64> {
    let p = degree;
    let mut n = vec![0.0_f64; p + 1];
    let mut left = vec![0.0_f64; p + 1];
    let mut right = vec![0.0_f64; p + 1];
    n[0] = 1.0;
    for j in 1..=p {
        left[j]  = t - knots[span + 1 - j];
        right[j] = knots[span + j] - t;
        let mut saved = 0.0_f64;
        for r in 0..j {
            let denom = right[r + 1] + left[j - r];
            let temp = if denom.abs() < 1e-30 { 0.0 } else { n[r] / denom };
            n[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        n[j] = saved;
    }
    n
}

// ────────────────────────────────────────────────────────────────────
// Linear system solver (Gauss-Jordan with partial pivoting)
// ────────────────────────────────────────────────────────────────────

/// Solve `A · X = B` where A is `n × n` (row-major) and B is `n × 3`
/// (each column = a DVec3 component). In-place destruction of A and B.
/// Returns Err if singular within tolerance.
pub(crate) fn solve_linear_system(a: &mut [Vec<f64>], b: &mut [DVec3]) -> Result<()> {
    let n = a.len();
    if n == 0 { return Ok(()); }
    if a.iter().any(|row| row.len() != n) {
        bail!("solve_linear_system: A must be square");
    }
    if b.len() != n { bail!("B must have n rows"); }

    for k in 0..n {
        // Pivot
        let mut max_row = k;
        let mut max_val = a[k][k].abs();
        for i in (k + 1)..n {
            if a[i][k].abs() > max_val {
                max_val = a[i][k].abs();
                max_row = i;
            }
        }
        if max_val < 1e-12 { bail!("singular matrix"); }
        if max_row != k {
            a.swap(k, max_row);
            b.swap(k, max_row);
        }
        // Eliminate
        for i in 0..n {
            if i == k { continue; }
            let factor = a[i][k] / a[k][k];
            if factor.abs() < 1e-30 { continue; }
            for j in k..n { a[i][j] -= factor * a[k][j]; }
            b[i] -= b[k] * factor;
        }
    }
    // Normalize
    for i in 0..n {
        if a[i][i].abs() < 1e-30 { bail!("singular post-elimination"); }
        b[i] /= a[i][i];
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// A9.1 — Global curve interpolation
// ────────────────────────────────────────────────────────────────────

/// Construct a B-spline curve of degree `p` passing EXACTLY through
/// `points`. Returns (control_points, knot_vector).
///
/// `n_ctrl == points.len()`. Uses ChordLength parameterization by
/// default (use `interpolate_nurbs_curve_with_method` for other choices).
pub fn interpolate_nurbs_curve(
    points: &[DVec3],
    degree: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    interpolate_nurbs_curve_with_method(points, degree, Parameterization::ChordLength)
}

pub fn interpolate_nurbs_curve_with_method(
    points: &[DVec3],
    degree: usize,
    method: Parameterization,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    let n_pts = points.len();
    if degree < 1 { bail!("degree must be >= 1"); }
    if n_pts < degree + 1 {
        bail!("interpolate: need >= degree+1 = {} points, got {}", degree + 1, n_pts);
    }

    let params = compute_parameters(points, method);
    let knots = knots_for_interpolation(&params, degree);

    // Build the (n_pts × n_pts) basis matrix A:
    //   A[k][i] = N_i^p(t_k)
    let mut a: Vec<Vec<f64>> = vec![vec![0.0; n_pts]; n_pts];
    for k in 0..n_pts {
        let span = find_knot_span(&knots, degree, n_pts, params[k]);
        let basis = basis_funs(span, params[k], degree, &knots);
        for j in 0..=degree {
            let i = span + j - degree;
            if i < n_pts { a[k][i] = basis[j]; }
        }
    }

    // Solve A · P = Q
    let mut p_pts: Vec<DVec3> = points.to_vec();
    solve_linear_system(&mut a, &mut p_pts)?;

    Ok((p_pts, knots))
}

/// Interpolate `points` of degree `p` using CALLER-supplied parameters
/// AND knot vector. Used by Loft (Phase K Step 2) where v_params and
/// V are computed once and shared across all u-control rows — calling
/// `interpolate_nurbs_curve_with_method` per row would re-derive
/// different knots from each row's points (wrong for tensor-product
/// surface construction).
///
/// Returns control points only (knots are caller-owned).
pub(crate) fn interpolate_with_params_and_knots(
    points: &[DVec3],
    degree: usize,
    params: &[f64],
    knots: &[f64],
) -> Result<Vec<DVec3>> {
    let n_pts = points.len();
    if n_pts != params.len() {
        bail!("interpolate_with_params_and_knots: points/params length mismatch");
    }
    if n_pts < degree + 1 {
        bail!("need >= degree+1 = {} points, got {}", degree + 1, n_pts);
    }
    if knots.len() != n_pts + degree + 1 {
        bail!("knots.len() {} ≠ n_pts + degree + 1 = {}",
            knots.len(), n_pts + degree + 1);
    }
    let mut a: Vec<Vec<f64>> = vec![vec![0.0; n_pts]; n_pts];
    for k in 0..n_pts {
        let span = find_knot_span(knots, degree, n_pts, params[k]);
        let basis = basis_funs(span, params[k], degree, knots);
        for j in 0..=degree {
            let i = span + j - degree;
            if i < n_pts { a[k][i] = basis[j]; }
        }
    }
    let mut ctrl: Vec<DVec3> = points.to_vec();
    solve_linear_system(&mut a, &mut ctrl)?;
    Ok(ctrl)
}

// ────────────────────────────────────────────────────────────────────
// A9.6 — Least-squares curve approximation
// ────────────────────────────────────────────────────────────────────

/// Fit a B-spline of degree `p` with `n_ctrl` control points to
/// `points` minimizing the sum of squared errors. The resulting curve
/// passes through the FIRST and LAST input points exactly (endpoint
/// constraint per Piegl A9.6).
pub fn fit_nurbs_curve_lsq(
    points: &[DVec3],
    degree: usize,
    n_ctrl: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    fit_nurbs_curve_lsq_with_method(points, degree, n_ctrl, Parameterization::ChordLength)
}

pub fn fit_nurbs_curve_lsq_with_method(
    points: &[DVec3],
    degree: usize,
    n_ctrl: usize,
    method: Parameterization,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    let m_p1 = points.len();
    let p = degree;
    let n = n_ctrl - 1;
    if p < 1 { bail!("degree must be >= 1"); }
    if n_ctrl < p + 1 { bail!("n_ctrl ({}) must be >= degree+1 ({})", n_ctrl, p + 1); }
    if m_p1 < n_ctrl { bail!("need at least n_ctrl ({}) points, got {}", n_ctrl, m_p1); }
    if m_p1 == n_ctrl {
        // Degenerate to interpolation (faster + exact)
        return interpolate_nurbs_curve_with_method(points, p, method);
    }

    let params = compute_parameters(points, method);
    let knots = knots_for_lsq(&params, p, n_ctrl);

    // Endpoint constraints: P_0 = Q_0, P_n = Q_{m}
    let q0 = points[0];
    let qm = *points.last().unwrap();

    // Build R[k] = Q_k - N_0^p(t_k) Q_0 - N_n^p(t_k) Q_m  for k = 1..m
    // and matrix N_full[k][i] = N_i^p(t_k) for k=1..m-1, i=1..n-1
    // Then N x = R becomes (N^T N) x = N^T R
    let m = m_p1 - 1; // last point index
    let inner_pts = n - 1; // number of unknown control points P_1..P_{n-1}
    if inner_pts == 0 {
        // Only endpoints — return them
        return Ok((vec![q0, qm], knots));
    }

    // Compute N matrix (size (m-1) × (n-1))
    let mut n_matrix: Vec<Vec<f64>> = vec![vec![0.0; inner_pts]; m - 1];
    let mut r_vec: Vec<DVec3> = vec![DVec3::ZERO; m - 1];
    for k in 1..m {
        let span = find_knot_span(&knots, p, n_ctrl, params[k]);
        let basis = basis_funs(span, params[k], p, &knots);
        // Determine N_0^p(t_k) and N_n^p(t_k)
        let mut n0 = 0.0;
        let mut nn = 0.0;
        for j in 0..=p {
            let i = span + j - p;
            if i == 0 { n0 = basis[j]; }
            if i == n { nn = basis[j]; }
            if i >= 1 && i <= n - 1 {
                n_matrix[k - 1][i - 1] = basis[j];
            }
        }
        r_vec[k - 1] = points[k] - q0 * n0 - qm * nn;
    }

    // Compute N^T N (inner_pts × inner_pts) and N^T R (inner_pts)
    let mut nt_n: Vec<Vec<f64>> = vec![vec![0.0; inner_pts]; inner_pts];
    let mut nt_r: Vec<DVec3> = vec![DVec3::ZERO; inner_pts];
    for k in 0..(m - 1) {
        for i in 0..inner_pts {
            let n_ki = n_matrix[k][i];
            if n_ki.abs() < 1e-30 { continue; }
            nt_r[i] += r_vec[k] * n_ki;
            for j in 0..inner_pts {
                nt_n[i][j] += n_ki * n_matrix[k][j];
            }
        }
    }

    // Solve (N^T N) X = N^T R
    let mut x = nt_r.clone();
    solve_linear_system(&mut nt_n, &mut x)?;

    // Assemble full control polygon
    let mut p_pts = vec![q0];
    p_pts.extend_from_slice(&x);
    p_pts.push(qm);

    Ok((p_pts, knots))
}

// ────────────────────────────────────────────────────────────────────
// Tolerance-driven incremental fit
// ────────────────────────────────────────────────────────────────────

/// Repeatedly fit with increasing `n_ctrl` until max distance from
/// each input point to the fitted curve is below `tol`. Starts at
/// `degree + 2` and increments until either tol satisfied or n_ctrl
/// reaches points.len() (interpolation, exact).
pub fn fit_nurbs_curve_to_tolerance(
    points: &[DVec3],
    degree: usize,
    tol: f64,
) -> Result<(Vec<DVec3>, Vec<f64>)> {
    if tol <= 0.0 { bail!("tol must be > 0"); }
    let p = degree;
    let n_pts = points.len();
    if n_pts < p + 2 {
        // Just interpolate
        return interpolate_nurbs_curve(points, degree);
    }
    let params = compute_parameters(points, Parameterization::ChordLength);

    for n_ctrl in (p + 2)..=n_pts {
        let (ctrl, knots) = fit_nurbs_curve_lsq(points, p, n_ctrl)?;
        // Compute max error: evaluate at each parameter and compare
        let mut max_err = 0.0_f64;
        for k in 0..n_pts {
            let span = find_knot_span(&knots, p, n_ctrl, params[k]);
            let basis = basis_funs(span, params[k], p, &knots);
            let mut p_eval = DVec3::ZERO;
            for j in 0..=p {
                let i = span + j - p;
                p_eval += ctrl[i] * basis[j];
            }
            let err = (p_eval - points[k]).length();
            if err > max_err { max_err = err; }
        }
        if max_err <= tol {
            return Ok((ctrl, knots));
        }
    }
    // Fall through to interpolation (exact)
    interpolate_nurbs_curve(points, degree)
}

// ────────────────────────────────────────────────────────────────────
// Tests (5 — ADR-056 §2.7 step 1)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::bspline as bs;

    /// ADR-056 §2.7 #1 — Interpolate passes through input points exactly.
    #[test]
    fn interpolate_curve_passes_through_points() {
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(3.0, 1.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let degree = 3;
        let (ctrl, knots) = interpolate_nurbs_curve(&pts, degree).unwrap();
        let params = compute_parameters(&pts, Parameterization::ChordLength);
        for (k, q) in pts.iter().enumerate() {
            let p_eval = bs::evaluate(&ctrl, &knots, degree, params[k]).unwrap();
            assert!((p_eval - *q).length() < 1e-9,
                "interpolation must pass through input k={}: expected {:?}, got {:?}",
                k, q, p_eval);
        }
    }

    /// ADR-056 §2.7 #2 — LSQ fit reduces error compared to uniform
    /// random control points. We verify that fitting N+1 points with
    /// fewer-than-N+1 control points still produces SMALL error
    /// (well under 1.0 for the test data scale).
    #[test]
    fn fit_curve_lsq_reduces_error() {
        // Generate 11 points on y = sin(x) for x in [0, 2π]
        let n_pts = 11;
        let pts: Vec<DVec3> = (0..n_pts).map(|i| {
            let x = (i as f64) * std::f64::consts::TAU / (n_pts - 1) as f64;
            DVec3::new(x, x.sin(), 0.0)
        }).collect();
        let degree = 3;
        let n_ctrl = 6;  // fewer than n_pts
        let (ctrl, knots) = fit_nurbs_curve_lsq(&pts, degree, n_ctrl).unwrap();
        assert_eq!(ctrl.len(), n_ctrl);
        // First and last endpoints exact (Piegl A9.6 constraint)
        assert!((ctrl[0] - pts[0]).length() < 1e-9);
        assert!((ctrl[n_ctrl - 1] - *pts.last().unwrap()).length() < 1e-9);
        // Max error should be reasonably small for this smooth signal
        let params = compute_parameters(&pts, Parameterization::ChordLength);
        let mut max_err = 0.0_f64;
        for k in 0..n_pts {
            let p_eval = bs::evaluate(&ctrl, &knots, degree, params[k]).unwrap();
            let e = (p_eval - pts[k]).length();
            if e > max_err { max_err = e; }
        }
        assert!(max_err < 0.5, "smooth sine fit max_err = {}, expected < 0.5", max_err);
    }

    /// ADR-056 §2.7 #3 — fit_to_tolerance terminates with max_err < tol.
    #[test]
    fn fit_curve_to_tolerance_terminates() {
        let n_pts = 15;
        let pts: Vec<DVec3> = (0..n_pts).map(|i| {
            let x = (i as f64) * 0.5;
            DVec3::new(x, (x * 0.7).sin() * 2.0, 0.0)
        }).collect();
        let degree = 3;
        let tol = 0.05;
        let (ctrl, knots) = fit_nurbs_curve_to_tolerance(&pts, degree, tol).unwrap();
        let params = compute_parameters(&pts, Parameterization::ChordLength);
        let mut max_err = 0.0_f64;
        for k in 0..n_pts {
            let p_eval = bs::evaluate(&ctrl, &knots, degree, params[k]).unwrap();
            let e = (p_eval - pts[k]).length();
            if e > max_err { max_err = e; }
        }
        assert!(max_err <= tol,
            "tolerance termination failed: max_err = {}, tol = {}, n_ctrl = {}",
            max_err, tol, ctrl.len());
    }

    /// ADR-056 §2.7 #4 — Chord-length parameterization (default).
    /// Verify endpoints t_0 = 0 and t_{n-1} = 1, monotonic increasing.
    #[test]
    fn parameterization_chord_length() {
        let pts = vec![
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),    // chord 1
            DVec3::new(5.0, 0.0, 0.0),    // chord 4
            DVec3::new(6.0, 0.0, 0.0),    // chord 1
        ];
        let params = compute_parameters(&pts, Parameterization::ChordLength);
        assert_eq!(params.len(), 4);
        assert_eq!(params[0], 0.0);
        assert!((params[3] - 1.0).abs() < 1e-12);
        // Total chord = 1 + 4 + 1 = 6.  params[1] = 1/6, params[2] = 5/6.
        assert!((params[1] - 1.0 / 6.0).abs() < 1e-12);
        assert!((params[2] - 5.0 / 6.0).abs() < 1e-12);
        // Monotonic
        for i in 1..params.len() {
            assert!(params[i] > params[i - 1]);
        }
    }

    /// ADR-056 §2.7 #5 — Centripetal smoother for sharp turn — verify
    /// it produces DIFFERENT (smoother) parameter spacing than chord
    /// length when one chord dominates.
    #[test]
    fn parameterization_centripetal_smoother_for_sharp_turn() {
        // 5 points where the middle one is a sharp peak (long chord on
        // one side, short on others)
        let pts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(2.0, 10.0, 0.0),  // sharp peak — long chord
            DVec3::new(3.0, 0.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let chord = compute_parameters(&pts, Parameterization::ChordLength);
        let cent  = compute_parameters(&pts, Parameterization::Centripetal);

        // Both must start at 0 and end at 1, be monotonic, length 5
        assert_eq!(chord.len(), 5);
        assert_eq!(cent.len(),  5);
        assert_eq!(chord[0], 0.0); assert!((chord[4] - 1.0).abs() < 1e-12);
        assert_eq!(cent[0],  0.0); assert!((cent[4]  - 1.0).abs() < 1e-12);

        // Centripetal should give MORE EVEN spacing than chord length
        // (chord length over-weights the sharp peak's long chord).
        // Verify: variance of step sizes is smaller for centripetal.
        let var = |p: &[f64]| -> f64 {
            let steps: Vec<f64> = p.windows(2).map(|w| w[1] - w[0]).collect();
            let mean = steps.iter().sum::<f64>() / steps.len() as f64;
            steps.iter().map(|s| (s - mean).powi(2)).sum::<f64>() / steps.len() as f64
        };
        let var_chord = var(&chord);
        let var_cent  = var(&cent);
        assert!(var_cent < var_chord,
            "centripetal variance {} should be less than chord {}", var_cent, var_chord);
    }
}
