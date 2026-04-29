//! B-spline surface — tensor product B-spline (Phase E, ADR-033 v1.1).
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
//!
//! ## Contracts (ADR-033 v1.1)
//!
//! - **P18.7 Validation**: `deg_u ≥ 1 AND deg_v ≥ 1` (already enforced).
//! - **P18.8 Parameter range**: `evaluate(u, v)` raw; `evaluate_strict(u, v)`
//!   rejects (u, v) outside `[knots_u[deg_u], knots_u[n_u]] × [...similar v]`.
//! - **P18.9 Normal contract**: `normal = (du × dv).normalize()` right-handed.
//! - **P18.10 Surface ≠ Face**: pure geometric surface only.

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

/// Strict variant — returns Err if (u, v) outside valid parameter range.
/// Use in trim eval / SSI marching where extrapolation is meaningless.
pub fn evaluate_strict(
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
    let (u_min, u_max) = (knots_u[deg_u], knots_u[n_u]);
    let (v_min, v_max) = (knots_v[deg_v], knots_v[n_v]);
    const EPS: f64 = 1e-9;
    if !(u_min - EPS..=u_max + EPS).contains(&u) {
        bail!("bspline_surface::evaluate_strict: u={} outside [{}, {}]", u, u_min, u_max);
    }
    if !(v_min - EPS..=v_max + EPS).contains(&v) {
        bail!("bspline_surface::evaluate_strict: v={} outside [{}, {}]", v, v_min, v_max);
    }
    evaluate(ctrl_grid, knots_u, knots_v, deg_u, deg_v,
        u.clamp(u_min, u_max), v.clamp(v_min, v_max))
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

/// Extract Bezier patches from a non-rational tensor B-spline surface.
///
/// Returns `Vec<(patch_ctrl, u_range, v_range)>` — one tensor-product Bezier
/// patch per (u-strip, v-strip) pair. Each patch's control grid is
/// `(deg_u + 1) × (deg_v + 1)`.
///
/// **Non-rational only.** Rational NURBS surface needs a 4D-lift variant.
pub fn extract_bezier_patches(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
) -> Result<Vec<(Vec<Vec<DVec3>>, (f64, f64), (f64, f64))>> {
    validate(ctrl_grid, knots_u, knots_v, deg_u, deg_v)?;
    let n_u = ctrl_grid.len();
    let n_v = ctrl_grid[0].len();

    // Step 1 — u-direction extraction per v-column.
    let mut strips_per_col: Vec<Vec<Vec<DVec3>>> = Vec::with_capacity(n_v);
    let mut shared_u_ranges: Option<Vec<(f64, f64)>> = None;
    for j in 0..n_v {
        let column: Vec<DVec3> = (0..n_u).map(|i| ctrl_grid[i][j]).collect();
        let (strips, ranges) = crate::curves::bspline::extract_bezier_strips(
            &column, knots_u, deg_u,
        )?;
        if let Some(ref existing) = shared_u_ranges {
            if existing.len() != ranges.len() {
                bail!(
                    "bspline_surface::extract_bezier_patches: u-extraction \
                    inconsistency across v-columns ({} vs {})",
                    existing.len(), ranges.len()
                );
            }
        } else {
            shared_u_ranges = Some(ranges);
        }
        strips_per_col.push(strips);
    }
    let u_ranges = shared_u_ranges.unwrap();
    let num_u_strips = u_ranges.len();

    // Step 2 — per u-strip, v-direction extraction.
    let mut patches: Vec<(Vec<Vec<DVec3>>, (f64, f64), (f64, f64))> = Vec::new();
    for s_u in 0..num_u_strips {
        let sub_grid_u: Vec<Vec<DVec3>> = (0..=deg_u).map(|k| {
            (0..n_v).map(|j| strips_per_col[j][s_u][k]).collect()
        }).collect();

        let mut row_v_strips: Vec<Vec<Vec<DVec3>>> = Vec::with_capacity(deg_u + 1);
        let mut shared_v_ranges: Option<Vec<(f64, f64)>> = None;
        for k in 0..=deg_u {
            let (strips_v, ranges_v) = crate::curves::bspline::extract_bezier_strips(
                &sub_grid_u[k], knots_v, deg_v,
            )?;
            if let Some(ref existing) = shared_v_ranges {
                if existing.len() != ranges_v.len() {
                    bail!(
                        "bspline_surface::extract_bezier_patches: v-extraction \
                        inconsistency across u-rows"
                    );
                }
            } else {
                shared_v_ranges = Some(ranges_v);
            }
            row_v_strips.push(strips_v);
        }
        let v_ranges = shared_v_ranges.unwrap();
        let num_v_strips = v_ranges.len();

        for s_v in 0..num_v_strips {
            let patch: Vec<Vec<DVec3>> = (0..=deg_u).map(|k| {
                row_v_strips[k][s_v].clone()
            }).collect();
            patches.push((patch, u_ranges[s_u], v_ranges[s_v]));
        }
    }
    Ok(patches)
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

    /// ADR-033 v1.1 P18.8 — evaluate_strict rejects out-of-range.
    #[test]
    fn evaluate_strict_rejects_u_outside_range() {
        let (g, ku, kv) = cubic_grid();
        // For clamped uniform [0, 1] knots, u must be in [0, 1].
        assert!(evaluate_strict(&g, &ku, &kv, 3, 3, 1.5, 0.5).is_err());
        assert!(evaluate_strict(&g, &ku, &kv, 3, 3, -0.5, 0.5).is_err());
    }

    #[test]
    fn evaluate_strict_rejects_v_outside_range() {
        let (g, ku, kv) = cubic_grid();
        assert!(evaluate_strict(&g, &ku, &kv, 3, 3, 0.5, 1.5).is_err());
    }

    #[test]
    fn evaluate_strict_accepts_in_range() {
        let (g, ku, kv) = cubic_grid();
        for (u, v) in [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0)] {
            assert!(evaluate_strict(&g, &ku, &kv, 3, 3, u, v).is_ok());
        }
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
