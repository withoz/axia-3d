//! B-spline surface — tensor product B-spline (Phase E, ADR-033).
//!
//! Given control grid `P[i][j]` of size `(n+1) × (m+1)`, knot vectors
//! `U` (length `n + p + 2`) and `V` (length `m + q + 2`), degrees `p, q`:
//!
//! ```text
//! S(u, v) = Σ_i Σ_j  N_i^p(u) · N_j^q(v) · P_{ij}
//! ```
//!
//! Evaluation: tensor de Boor — for each row `i`, run de Boor in `v` →
//! intermediate `R_i(v)`. Then run de Boor in `u` over R values → final.

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::bspline;

/// Evaluate the B-spline surface at parameters (u, v).
pub fn evaluate(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, knots_u, knots_v, deg_u, deg_v)?;
    let n_u = ctrl_grid.len();
    let n_v = ctrl_grid[0].len();

    // Step 1: collapse v in each row using de Boor.
    let span_v = bspline::find_knot_span(knots_v, deg_v, n_v, v);
    let mut row_pts: Vec<DVec3> = Vec::with_capacity(n_u);
    for row in ctrl_grid {
        row_pts.push(bspline::de_boor(row, knots_v, deg_v, span_v, v));
    }

    // Step 2: collapse u-direction.
    let span_u = bspline::find_knot_span(knots_u, deg_u, n_u, u);
    Ok(bspline::de_boor(&row_pts, knots_u, deg_u, span_u, u))
}

/// Partial derivative ∂S/∂u.
pub fn derivative_u(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, knots_u, knots_v, deg_u, deg_v)?;
    if deg_u == 0 {
        return Ok(DVec3::ZERO);
    }
    let n_v = ctrl_grid[0].len();
    let span_v = bspline::find_knot_span(knots_v, deg_v, n_v, v);
    // Step 1: collapse v in each row.
    let mut row_pts: Vec<DVec3> = Vec::with_capacity(ctrl_grid.len());
    for row in ctrl_grid {
        row_pts.push(bspline::de_boor(row, knots_v, deg_v, span_v, v));
    }
    // Step 2: derivative in u-direction over row_pts.
    bspline::derivative(&row_pts, knots_u, deg_u, u)
}

/// Partial derivative ∂S/∂v.
pub fn derivative_v(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, knots_u, knots_v, deg_u, deg_v)?;
    if deg_v == 0 {
        return Ok(DVec3::ZERO);
    }
    // Step 1: derivative in v-direction in each row.
    let mut dv_row_pts: Vec<DVec3> = Vec::with_capacity(ctrl_grid.len());
    for row in ctrl_grid {
        dv_row_pts.push(bspline::derivative(row, knots_v, deg_v, v).unwrap_or(DVec3::ZERO));
    }
    // Step 2: collapse u-direction.
    let n_u = dv_row_pts.len();
    let span_u = bspline::find_knot_span(knots_u, deg_u, n_u, u);
    Ok(bspline::de_boor(&dv_row_pts, knots_u, deg_u, span_u, u))
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

fn validate(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
) -> Result<()> {
    if deg_u == 0 || deg_v == 0 {
        bail!("bspline_surface: degrees must be ≥ 1");
    }
    if ctrl_grid.is_empty() || ctrl_grid[0].is_empty() {
        bail!("bspline_surface: empty control grid");
    }
    let n_u = ctrl_grid.len();
    let n_v = ctrl_grid[0].len();
    for (i, row) in ctrl_grid.iter().enumerate() {
        if row.len() != n_v {
            bail!("bspline_surface: row {} has len {}, expected {}", i, row.len(), n_v);
        }
    }
    if n_u < deg_u + 1 || n_v < deg_v + 1 {
        bail!("bspline_surface: ctrl grid {}×{} too small for deg ({}, {})",
            n_u, n_v, deg_u, deg_v);
    }
    if knots_u.len() != n_u + deg_u + 1 {
        bail!("bspline_surface: knots_u len {} ≠ n_u + deg_u + 1 = {}",
            knots_u.len(), n_u + deg_u + 1);
    }
    if knots_v.len() != n_v + deg_v + 1 {
        bail!("bspline_surface: knots_v len {} ≠ n_v + deg_v + 1 = {}",
            knots_v.len(), n_v + deg_v + 1);
    }
    for w in [knots_u, knots_v] {
        for i in 1..w.len() {
            if w[i] < w[i - 1] {
                bail!("bspline_surface: knots must be non-decreasing");
            }
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

    /// 4×4 cubic-cubic grid with corners at (0,0,0)–(3,3,0), bump in middle.
    fn cubic_grid() -> (Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>) {
        let mut grid: Vec<Vec<DVec3>> = Vec::new();
        for i in 0..4 {
            let mut row: Vec<DVec3> = Vec::new();
            for j in 0..4 {
                let x = i as f64;
                let y = j as f64;
                let z = if (i == 1 || i == 2) && (j == 1 || j == 2) { 5.0 } else { 0.0 };
                row.push(DVec3::new(x, y, z));
            }
            grid.push(row);
        }
        let knots_u = clamped_uniform_knots(4, 3);
        let knots_v = clamped_uniform_knots(4, 3);
        (grid, knots_u, knots_v)
    }

    #[test]
    fn validate_rejects_empty_grid() {
        let g: Vec<Vec<DVec3>> = vec![];
        assert!(validate(&g, &[], &[], 1, 1).is_err());
    }

    #[test]
    fn validate_rejects_jagged_rows() {
        let g = vec![vec![DVec3::ZERO; 3], vec![DVec3::ZERO; 2]];
        let knots = clamped_uniform_knots(3, 1);
        assert!(validate(&g, &knots, &knots, 1, 1).is_err());
    }

    #[test]
    fn validate_rejects_zero_degree() {
        let g = vec![vec![DVec3::ZERO; 2]; 2];
        let knots = vec![0.0, 0.0, 1.0, 1.0];
        assert!(validate(&g, &knots, &knots, 0, 1).is_err());
    }

    #[test]
    fn validate_rejects_wrong_knot_count() {
        let g = vec![vec![DVec3::ZERO; 4]; 4];
        let knots_ok = clamped_uniform_knots(4, 3);
        let knots_bad = vec![0.0; 5];  // wrong length
        assert!(validate(&g, &knots_bad, &knots_ok, 3, 3).is_err());
    }

    #[test]
    fn evaluate_clamped_corner_00_is_first_ctrl() {
        let (g, ku, kv) = cubic_grid();
        let p = evaluate(&g, &ku, &kv, 3, 3, 0.0, 0.0).unwrap();
        assert!(approx_eq(p, g[0][0], 1e-9));
    }

    #[test]
    fn evaluate_clamped_corner_11_is_last_ctrl() {
        let (g, ku, kv) = cubic_grid();
        let p = evaluate(&g, &ku, &kv, 3, 3, 1.0, 1.0).unwrap();
        assert!(approx_eq(p, g[3][3], 1e-9));
    }

    #[test]
    fn evaluate_clamped_other_corners() {
        let (g, ku, kv) = cubic_grid();
        let p01 = evaluate(&g, &ku, &kv, 3, 3, 0.0, 1.0).unwrap();
        assert!(approx_eq(p01, g[0][3], 1e-9));
        let p10 = evaluate(&g, &ku, &kv, 3, 3, 1.0, 0.0).unwrap();
        assert!(approx_eq(p10, g[3][0], 1e-9));
    }

    #[test]
    fn evaluate_midpoint_pulls_z_up_due_to_bump() {
        let (g, ku, kv) = cubic_grid();
        let p = evaluate(&g, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!(p.z > 0.5, "expected center bump, got z={}", p.z);
    }

    #[test]
    fn derivative_u_finite_diff_consistency() {
        let (g, ku, kv) = cubic_grid();
        let h = 1e-6;
        let p_plus = evaluate(&g, &ku, &kv, 3, 3, 0.5 + h, 0.5).unwrap();
        let p_minus = evaluate(&g, &ku, &kv, 3, 3, 0.5 - h, 0.5).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_u(&g, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3,
            "FD {:?} vs analytic {:?}", fd, analytic);
    }

    #[test]
    fn derivative_v_finite_diff_consistency() {
        let (g, ku, kv) = cubic_grid();
        let h = 1e-6;
        let p_plus = evaluate(&g, &ku, &kv, 3, 3, 0.5, 0.5 + h).unwrap();
        let p_minus = evaluate(&g, &ku, &kv, 3, 3, 0.5, 0.5 - h).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_v(&g, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3);
    }

    #[test]
    fn evaluate_continuous_across_knots() {
        // 5×5 cubic, more knots — check continuity.
        let n = 5;
        let mut grid: Vec<Vec<DVec3>> = Vec::new();
        for i in 0..n {
            let mut row = Vec::new();
            for j in 0..n {
                row.push(DVec3::new(i as f64, j as f64, 0.0));
            }
            grid.push(row);
        }
        let ku = clamped_uniform_knots(n, 3);
        let kv = clamped_uniform_knots(n, 3);
        let interior_u = ku[4];
        let eps = 1e-6;
        let p_minus = evaluate(&grid, &ku, &kv, 3, 3, interior_u - eps, 0.5).unwrap();
        let p_plus = evaluate(&grid, &ku, &kv, 3, 3, interior_u + eps, 0.5).unwrap();
        assert!((p_minus - p_plus).length() < 1e-4);
    }
}
