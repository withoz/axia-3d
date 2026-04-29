//! NURBS surface — rational tensor-product B-spline (Phase E, ADR-033).
//!
//! Given control grid `P[i][j]`, weight grid `w[i][j] > 0`, knot vectors
//! `U, V`, degrees `p, q`:
//!
//! ```text
//! S(u, v) = (Σ_{ij}  N_i^p(u) · N_j^q(v) · w_{ij} · P_{ij})
//!         / (Σ_{ij}  N_i^p(u) · N_j^q(v) · w_{ij})
//! ```
//!
//! Algorithm — homogeneous lift: lift each `(P_{ij}, w_{ij})` to 4D
//! `(w·P, w)`. Evaluate as B-spline tensor surface in 4D. Project back
//! by dividing by `W(u, v)`.

use anyhow::{bail, Result};
use glam::DVec3;

use super::bspline_surface;

const MIN_WEIGHT: f64 = 1e-9;

/// Evaluate the NURBS surface at parameters (u, v).
pub fn evaluate(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v)?;
    let (h, w) = evaluate_homogeneous(
        ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, u, v,
    )?;
    if w.abs() < MIN_WEIGHT {
        bail!("nurbs_surface: w(u,v) = {} too close to zero", w);
    }
    Ok(h / w)
}

/// Evaluate homogeneous components — `(H(u,v), w(u,v))` where `H = w·S`.
pub fn evaluate_homogeneous(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<(DVec3, f64)> {
    validate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v)?;
    // Lift to 4D.
    let lifted_xyz: Vec<Vec<DVec3>> = ctrl_grid.iter().zip(weights.iter())
        .map(|(p_row, w_row)| {
            p_row.iter().zip(w_row.iter())
                .map(|(p, &w)| *p * w).collect()
        })
        .collect();
    let lifted_w: Vec<Vec<DVec3>> = weights.iter()
        .map(|w_row| w_row.iter().map(|&w| DVec3::new(w, 0.0, 0.0)).collect())
        .collect();
    // Evaluate as B-spline surfaces.
    let h = bspline_surface::evaluate(&lifted_xyz, knots_u, knots_v, deg_u, deg_v, u, v)?;
    let w_pt = bspline_surface::evaluate(&lifted_w, knots_u, knots_v, deg_u, deg_v, u, v)?;
    Ok((h, w_pt.x))
}

/// Strict variant — Err if (u, v) outside parameter range.
pub fn evaluate_strict(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v)?;
    let n_u = ctrl_grid.len();
    let n_v = ctrl_grid[0].len();
    let (u_min, u_max) = (knots_u[deg_u], knots_u[n_u]);
    let (v_min, v_max) = (knots_v[deg_v], knots_v[n_v]);
    const EPS: f64 = 1e-9;
    if !(u_min - EPS..=u_max + EPS).contains(&u) {
        bail!("nurbs_surface::evaluate_strict: u={} outside [{}, {}]", u, u_min, u_max);
    }
    if !(v_min - EPS..=v_max + EPS).contains(&v) {
        bail!("nurbs_surface::evaluate_strict: v={} outside [{}, {}]", v, v_min, v_max);
    }
    evaluate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v,
        u.clamp(u_min, u_max), v.clamp(v_min, v_max))
}

/// Partial derivative ∂S/∂u via quotient rule.
pub fn derivative_u(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v)?;
    let (h, w) = evaluate_homogeneous(
        ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, u, v,
    )?;
    if w.abs() < MIN_WEIGHT {
        bail!("nurbs_surface: w(u,v) too close to zero");
    }
    let s = h / w;
    let lifted_xyz: Vec<Vec<DVec3>> = ctrl_grid.iter().zip(weights.iter())
        .map(|(p_row, w_row)| p_row.iter().zip(w_row.iter())
            .map(|(p, &w)| *p * w).collect()).collect();
    let lifted_w: Vec<Vec<DVec3>> = weights.iter()
        .map(|w_row| w_row.iter().map(|&w| DVec3::new(w, 0.0, 0.0)).collect()).collect();
    let h_u = bspline_surface::derivative_u(&lifted_xyz, knots_u, knots_v, deg_u, deg_v, u, v)?;
    let w_u = bspline_surface::derivative_u(&lifted_w, knots_u, knots_v, deg_u, deg_v, u, v)?.x;
    Ok((h_u - s * w_u) / w)
}

/// Partial derivative ∂S/∂v.
pub fn derivative_v(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    u: f64,
    v: f64,
) -> Result<DVec3> {
    validate(ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v)?;
    let (h, w) = evaluate_homogeneous(
        ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, u, v,
    )?;
    if w.abs() < MIN_WEIGHT {
        bail!("nurbs_surface: w(u,v) too close to zero");
    }
    let s = h / w;
    let lifted_xyz: Vec<Vec<DVec3>> = ctrl_grid.iter().zip(weights.iter())
        .map(|(p_row, w_row)| p_row.iter().zip(w_row.iter())
            .map(|(p, &w)| *p * w).collect()).collect();
    let lifted_w: Vec<Vec<DVec3>> = weights.iter()
        .map(|w_row| w_row.iter().map(|&w| DVec3::new(w, 0.0, 0.0)).collect()).collect();
    let h_v = bspline_surface::derivative_v(&lifted_xyz, knots_u, knots_v, deg_u, deg_v, u, v)?;
    let w_v = bspline_surface::derivative_v(&lifted_w, knots_u, knots_v, deg_u, deg_v, u, v)?.x;
    Ok((h_v - s * w_v) / w)
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

fn validate(
    ctrl_grid: &[Vec<DVec3>],
    weights: &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
) -> Result<()> {
    if ctrl_grid.len() != weights.len() {
        bail!("nurbs_surface: ctrl rows {} ≠ weights rows {}",
            ctrl_grid.len(), weights.len());
    }
    if ctrl_grid.is_empty() || ctrl_grid[0].is_empty() {
        bail!("nurbs_surface: empty grid");
    }
    let n_v = ctrl_grid[0].len();
    for (i, (p_row, w_row)) in ctrl_grid.iter().zip(weights.iter()).enumerate() {
        if p_row.len() != n_v {
            bail!("nurbs_surface: ctrl row {} len {} ≠ {}", i, p_row.len(), n_v);
        }
        if w_row.len() != n_v {
            bail!("nurbs_surface: weight row {} len {} ≠ {}", i, w_row.len(), n_v);
        }
        for &w in w_row {
            if w <= MIN_WEIGHT {
                bail!("nurbs_surface: all weights must be > {}, got {}", MIN_WEIGHT, w);
            }
        }
    }
    // Reuse B-spline surface validation (degrees, knot lengths, ordering).
    // Ctrl grid only — weights already validated above.
    let n_u = ctrl_grid.len();
    if deg_u == 0 || deg_v == 0 {
        bail!("nurbs_surface: degrees must be ≥ 1");
    }
    if n_u < deg_u + 1 || n_v < deg_v + 1 {
        bail!("nurbs_surface: ctrl {}×{} too small for deg ({}, {})",
            n_u, n_v, deg_u, deg_v);
    }
    if knots_u.len() != n_u + deg_u + 1 || knots_v.len() != n_v + deg_v + 1 {
        bail!("nurbs_surface: knot count mismatch");
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

    fn unit_weighted_grid() -> (Vec<Vec<DVec3>>, Vec<Vec<f64>>, Vec<f64>, Vec<f64>) {
        let mut grid: Vec<Vec<DVec3>> = Vec::new();
        let mut weights: Vec<Vec<f64>> = Vec::new();
        for i in 0..4 {
            let mut p_row = Vec::new();
            let mut w_row = Vec::new();
            for j in 0..4 {
                p_row.push(DVec3::new(i as f64, j as f64, 0.0));
                w_row.push(1.0);
            }
            grid.push(p_row);
            weights.push(w_row);
        }
        (grid, weights, clamped_uniform_knots(4, 3), clamped_uniform_knots(4, 3))
    }

    #[test]
    fn validate_rejects_weight_dimension_mismatch() {
        let (grid, mut weights, ku, kv) = unit_weighted_grid();
        weights.pop();  // mismatch row count
        assert!(validate(&grid, &weights, &ku, &kv, 3, 3).is_err());
    }

    #[test]
    fn validate_rejects_zero_weight() {
        let (grid, mut weights, ku, kv) = unit_weighted_grid();
        weights[1][2] = 0.0;
        assert!(validate(&grid, &weights, &ku, &kv, 3, 3).is_err());
    }

    #[test]
    fn validate_rejects_negative_weight() {
        let (grid, mut weights, ku, kv) = unit_weighted_grid();
        weights[1][2] = -0.5;
        assert!(validate(&grid, &weights, &ku, &kv, 3, 3).is_err());
    }

    #[test]
    fn evaluate_unit_weights_matches_bspline() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        for i in 0..=4 {
            for j in 0..=4 {
                let u = i as f64 / 4.0;
                let v = j as f64 / 4.0;
                let nurbs_pt = evaluate(&grid, &weights, &ku, &kv, 3, 3, u, v).unwrap();
                let bspline_pt = bspline_surface::evaluate(&grid, &ku, &kv, 3, 3, u, v).unwrap();
                assert!(approx_eq(nurbs_pt, bspline_pt, 1e-9),
                    "u={}, v={}: nurbs {:?} ≠ bspline {:?}", u, v, nurbs_pt, bspline_pt);
            }
        }
    }

    #[test]
    fn evaluate_clamped_endpoints_match_corner_ctrl_pts() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        let p00 = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.0, 0.0).unwrap();
        let p11 = evaluate(&grid, &weights, &ku, &kv, 3, 3, 1.0, 1.0).unwrap();
        assert!(approx_eq(p00, grid[0][0], 1e-9));
        assert!(approx_eq(p11, grid[3][3], 1e-9));
    }

    #[test]
    fn evaluate_higher_weight_pulls_surface_toward_ctrl() {
        let (grid, mut weights, ku, kv) = unit_weighted_grid();
        // First measure normal-weighted center
        let p_normal = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        // Now boost middle ctrl weight; raise its z component too for visible effect.
        let mut grid_z = grid.clone();
        grid_z[1][1].z = 5.0;
        weights[1][1] = 100.0;
        let p_pulled = evaluate(&grid_z, &weights, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        // With high weight on raised ctrl, center should be pulled toward (1,1,5).
        let target = DVec3::new(1.0, 1.0, 5.0);
        let dist_normal = (p_normal - target).length();
        let dist_pulled = (p_pulled - target).length();
        assert!(dist_pulled < dist_normal,
            "high weight should pull closer: normal={}, pulled={}", dist_normal, dist_pulled);
    }

    #[test]
    fn derivative_u_finite_diff_consistency() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        let h = 1e-6;
        let p_plus = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.5 + h, 0.5).unwrap();
        let p_minus = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.5 - h, 0.5).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_u(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3);
    }

    #[test]
    fn derivative_v_finite_diff_consistency() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        let h = 1e-6;
        let p_plus = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5 + h).unwrap();
        let p_minus = evaluate(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5 - h).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_v(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3);
    }

    /// ADR-033 v1.1 P18.8 — evaluate_strict rejects out-of-range.
    #[test]
    fn evaluate_strict_rejects_outside_range() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        assert!(evaluate_strict(&grid, &weights, &ku, &kv, 3, 3, 1.5, 0.5).is_err());
        assert!(evaluate_strict(&grid, &weights, &ku, &kv, 3, 3, 0.5, -0.5).is_err());
    }

    #[test]
    fn evaluate_strict_accepts_in_range() {
        let (grid, weights, ku, kv) = unit_weighted_grid();
        assert!(evaluate_strict(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5).is_ok());
        assert!(evaluate_strict(&grid, &weights, &ku, &kv, 3, 3, 0.0, 0.0).is_ok());
        assert!(evaluate_strict(&grid, &weights, &ku, &kv, 3, 3, 1.0, 1.0).is_ok());
    }

    #[test]
    fn evaluate_homogeneous_returns_correct_w() {
        let (grid, mut weights, ku, kv) = unit_weighted_grid();
        // Set non-unit weights
        for row in &mut weights {
            for w in row {
                *w = 2.0;
            }
        }
        let (_h, w_pt) = evaluate_homogeneous(&grid, &weights, &ku, &kv, 3, 3, 0.5, 0.5).unwrap();
        assert!((w_pt - 2.0).abs() < 1e-9, "expected w=2.0, got {}", w_pt);
    }
}
