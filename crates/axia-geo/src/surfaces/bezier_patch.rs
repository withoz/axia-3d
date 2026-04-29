//! Bezier patch — tensor product Bezier surface (Phase E, ADR-033 v1.1).
//!
//! Given a `(deg_u + 1) × (deg_v + 1)` control point grid `P[i][j]`:
//!
//! ```text
//! S(u, v) = Σ_i Σ_j  B_i^{deg_u}(u) · B_j^{deg_v}(v) · P_{ij},
//! ```
//!
//! evaluated by **tensor de Casteljau**: for each row `i`, run de Casteljau
//! in `v` over `P[i][·]` → intermediate point `R_i(v)`. Then run de Casteljau
//! in `u` over `R_·(v)` → final point `S(u, v)`.
//!
//! Parameter range: canonical `(u, v) ∈ [0, 1]²`. Endpoint interpolation:
//! `S(0,0) = P[0][0]`, `S(1,1) = P[deg_u][deg_v]`, etc.
//!
//! ## Contracts (ADR-033 v1.1)
//!
//! ### P18.7 Validation
//! - `deg_u ≥ 1 AND deg_v ≥ 1` strictly enforced — `1×N` or `N×1` grids
//!   are degenerate and rejected.
//!
//! ### P18.8 Parameter range policy
//! - `evaluate(u, v)` — **raw**: extrapolation allowed (Newton overshoot OK).
//! - `evaluate_strict(u, v)` — returns `Err` if `(u, v)` is outside [0, 1]².
//!
//! ### P18.9 Normal direction contract
//! - `normal(u, v) = (∂P/∂u × ∂P/∂v).normalize()` — **right-handed**.
//! - Direction follows parameterization. Reverse v-axis to flip normal.
//! - ADR-007 winding alignment is the caller's responsibility.
//!
//! ### P18.10 Surface ≠ Face
//! - This module provides **pure geometric surface** semantics. Face
//!   topology, trim loops, and boundary handling live elsewhere.
//!
//! ### P18.12 SSOT helpers (no redundant `deg_u/deg_v` fields)
//! - `deg_u() = ctrl_grid.len() - 1`
//! - `deg_v() = ctrl_grid[0].len() - 1`

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::bezier;

/// SSOT helper — `deg_u = ctrl_grid.len() - 1`. Returns 0 for empty grid.
#[inline]
pub fn deg_u(ctrl_grid: &[Vec<DVec3>]) -> usize {
    ctrl_grid.len().saturating_sub(1)
}

/// SSOT helper — `deg_v = ctrl_grid[0].len() - 1`. Returns 0 for empty grid.
#[inline]
pub fn deg_v(ctrl_grid: &[Vec<DVec3>]) -> usize {
    ctrl_grid.first().map(|r| r.len().saturating_sub(1)).unwrap_or(0)
}

/// Strict variant of `evaluate` — returns `Err` if `(u, v)` is outside [0, 1]².
/// Use this when caller cannot tolerate extrapolation (trim eval, SSI boundary).
pub fn evaluate_strict(ctrl_grid: &[Vec<DVec3>], u: f64, v: f64) -> Result<DVec3> {
    const EPS: f64 = 1e-9;
    if !(-EPS..=1.0 + EPS).contains(&u) {
        bail!("bezier_patch::evaluate_strict: u={} outside [0, 1]", u);
    }
    if !(-EPS..=1.0 + EPS).contains(&v) {
        bail!("bezier_patch::evaluate_strict: v={} outside [0, 1]", v);
    }
    evaluate(ctrl_grid, u.clamp(0.0, 1.0), v.clamp(0.0, 1.0))
}

/// Evaluate a Bezier patch at parameters (u, v).
pub fn evaluate(ctrl_grid: &[Vec<DVec3>], u: f64, v: f64) -> Result<DVec3> {
    validate(ctrl_grid)?;
    let n_u = ctrl_grid.len();
    // Step 1: collapse v-direction for each row.
    let mut row_pts: Vec<DVec3> = Vec::with_capacity(n_u);
    for row in ctrl_grid {
        row_pts.push(bezier::de_casteljau(row, v));
    }
    // Step 2: collapse u-direction.
    Ok(bezier::de_casteljau(&row_pts, u))
}

/// Partial derivative ∂S/∂u at (u, v).
pub fn derivative_u(ctrl_grid: &[Vec<DVec3>], u: f64, v: f64) -> Result<DVec3> {
    validate(ctrl_grid)?;
    let n_u = ctrl_grid.len();
    if n_u < 2 {
        return Ok(DVec3::ZERO);
    }
    // Step 1: collapse v in each row → row_pts (n_u points).
    let mut row_pts: Vec<DVec3> = Vec::with_capacity(n_u);
    for row in ctrl_grid {
        row_pts.push(bezier::de_casteljau(row, v));
    }
    // Step 2: derivative of degree-(n_u - 1) Bezier at u.
    bezier::derivative(&row_pts, u)
}

/// Partial derivative ∂S/∂v at (u, v).
pub fn derivative_v(ctrl_grid: &[Vec<DVec3>], u: f64, v: f64) -> Result<DVec3> {
    validate(ctrl_grid)?;
    // Step 1: derivative in v direction in each row → dv_row_pts.
    let mut dv_row_pts: Vec<DVec3> = Vec::with_capacity(ctrl_grid.len());
    for row in ctrl_grid {
        dv_row_pts.push(bezier::derivative(row, v).unwrap_or(DVec3::ZERO));
    }
    // Step 2: collapse u-direction.
    Ok(bezier::de_casteljau(&dv_row_pts, u))
}

/// Outward unit normal at (u, v) (right-handed: dS/du × dS/dv).
pub fn normal(ctrl_grid: &[Vec<DVec3>], u: f64, v: f64) -> Result<DVec3> {
    let du = derivative_u(ctrl_grid, u, v)?;
    let dv = derivative_v(ctrl_grid, u, v)?;
    Ok(du.cross(dv).normalize_or_zero())
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

fn validate(ctrl_grid: &[Vec<DVec3>]) -> Result<()> {
    if ctrl_grid.is_empty() {
        bail!("bezier_patch: empty control grid");
    }
    if ctrl_grid[0].is_empty() {
        bail!("bezier_patch: empty row");
    }
    let n_v = ctrl_grid[0].len();
    for (i, row) in ctrl_grid.iter().enumerate() {
        if row.len() != n_v {
            bail!("bezier_patch: row {} has len {}, expected {}", i, row.len(), n_v);
        }
    }
    // P18.7 — deg_u ≥ 1 AND deg_v ≥ 1 strictly enforced.
    // A 1×N or N×1 grid is degenerate (curve, not surface).
    if ctrl_grid.len() < 2 {
        bail!(
            "bezier_patch: deg_u = 0 (grid has {} rows) — degenerate, surface requires ≥ 2 rows",
            ctrl_grid.len()
        );
    }
    if n_v < 2 {
        bail!(
            "bezier_patch: deg_v = 0 (grid rows have {} cols) — degenerate, surface requires ≥ 2 cols",
            n_v
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    fn bilinear_grid() -> Vec<Vec<DVec3>> {
        // 2×2 patch: bilinear quad
        vec![
            vec![DVec3::new(0.0, 0.0, 0.0), DVec3::new(0.0, 10.0, 0.0)],
            vec![DVec3::new(10.0, 0.0, 0.0), DVec3::new(10.0, 10.0, 0.0)],
        ]
    }

    fn bicubic_grid() -> Vec<Vec<DVec3>> {
        // 4×4 patch with corners at (0,0,0), (3,0,0), (0,3,0), (3,3,0)
        // Interior points raise center bump.
        vec![
            vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(0.0, 1.0, 0.0),
                DVec3::new(0.0, 2.0, 0.0),
                DVec3::new(0.0, 3.0, 0.0),
            ],
            vec![
                DVec3::new(1.0, 0.0, 0.0),
                DVec3::new(1.0, 1.0, 5.0),  // bump
                DVec3::new(1.0, 2.0, 5.0),  // bump
                DVec3::new(1.0, 3.0, 0.0),
            ],
            vec![
                DVec3::new(2.0, 0.0, 0.0),
                DVec3::new(2.0, 1.0, 5.0),
                DVec3::new(2.0, 2.0, 5.0),
                DVec3::new(2.0, 3.0, 0.0),
            ],
            vec![
                DVec3::new(3.0, 0.0, 0.0),
                DVec3::new(3.0, 1.0, 0.0),
                DVec3::new(3.0, 2.0, 0.0),
                DVec3::new(3.0, 3.0, 0.0),
            ],
        ]
    }

    #[test]
    fn validate_rejects_empty_grid() {
        let g: Vec<Vec<DVec3>> = Vec::new();
        assert!(validate(&g).is_err());
    }

    #[test]
    fn validate_rejects_jagged_rows() {
        let g = vec![
            vec![DVec3::ZERO, DVec3::X],
            vec![DVec3::Y],  // shorter
        ];
        assert!(validate(&g).is_err());
    }

    #[test]
    fn evaluate_corner_00_is_first_point() {
        let g = bilinear_grid();
        let p = evaluate(&g, 0.0, 0.0).unwrap();
        assert!(approx_eq(p, g[0][0], 1e-12));
    }

    #[test]
    fn evaluate_corner_11_is_last_point() {
        let g = bilinear_grid();
        let p = evaluate(&g, 1.0, 1.0).unwrap();
        assert!(approx_eq(p, g[1][1], 1e-12));
    }

    #[test]
    fn evaluate_corner_01_and_10() {
        let g = bilinear_grid();
        // (u=0, v=1) = P[0][1]
        let p01 = evaluate(&g, 0.0, 1.0).unwrap();
        assert!(approx_eq(p01, g[0][1], 1e-12));
        // (u=1, v=0) = P[1][0]
        let p10 = evaluate(&g, 1.0, 0.0).unwrap();
        assert!(approx_eq(p10, g[1][0], 1e-12));
    }

    #[test]
    fn evaluate_bilinear_midpoint_is_centroid() {
        let g = bilinear_grid();
        let p = evaluate(&g, 0.5, 0.5).unwrap();
        let centroid = (g[0][0] + g[0][1] + g[1][0] + g[1][1]) / 4.0;
        assert!(approx_eq(p, centroid, 1e-12));
    }

    #[test]
    fn evaluate_bicubic_corner_endpoints() {
        let g = bicubic_grid();
        assert!(approx_eq(evaluate(&g, 0.0, 0.0).unwrap(), g[0][0], 1e-12));
        assert!(approx_eq(evaluate(&g, 0.0, 1.0).unwrap(), g[0][3], 1e-12));
        assert!(approx_eq(evaluate(&g, 1.0, 0.0).unwrap(), g[3][0], 1e-12));
        assert!(approx_eq(evaluate(&g, 1.0, 1.0).unwrap(), g[3][3], 1e-12));
    }

    #[test]
    fn evaluate_bicubic_midpoint_has_z_bump() {
        let g = bicubic_grid();
        let p = evaluate(&g, 0.5, 0.5).unwrap();
        // Center should have z > 0 (interior bumps pull surface up).
        assert!(p.z > 0.5, "expected center bump, got z={}", p.z);
    }

    /// ADR-033 v1.1 P18.7 — 1×N (degenerate) grid is rejected as a surface.
    /// (Was: derivative_u_zero_when_n_u_is_one — replaced post-amendment.)
    #[test]
    fn validate_rejects_degenerate_1xN_grid() {
        let g = vec![vec![DVec3::ZERO, DVec3::X, DVec3::Y]];
        let err = validate(&g);
        assert!(err.is_err(), "1×N grid must be rejected as degenerate");
        // derivative_u via public API should also error.
        assert!(derivative_u(&g, 0.5, 0.5).is_err());
    }

    /// ADR-033 v1.1 P18.7 — N×1 grid (single column) is also degenerate.
    #[test]
    fn validate_rejects_degenerate_Nx1_grid() {
        let g = vec![vec![DVec3::ZERO], vec![DVec3::X], vec![DVec3::Y]];
        assert!(validate(&g).is_err());
    }

    #[test]
    fn derivative_u_bilinear_corner_aligned_with_first_diff() {
        let g = bilinear_grid();
        // For bilinear, ∂S/∂u at (0, 0) = (P[1][0] - P[0][0]).
        let d = derivative_u(&g, 0.0, 0.0).unwrap();
        let expected = g[1][0] - g[0][0];
        assert!(approx_eq(d, expected, 1e-12));
    }

    #[test]
    fn derivative_v_bilinear_corner_aligned_with_first_diff() {
        let g = bilinear_grid();
        let d = derivative_v(&g, 0.0, 0.0).unwrap();
        let expected = g[0][1] - g[0][0];
        assert!(approx_eq(d, expected, 1e-12));
    }

    #[test]
    fn normal_bilinear_xy_plane_is_z() {
        // Bilinear patch on XY plane → normal should be ±Z.
        let g = bilinear_grid();
        let n = normal(&g, 0.5, 0.5).unwrap();
        assert!(n.z.abs() > 0.99, "expected ±Z normal, got {:?}", n);
        assert!(n.x.abs() < 1e-9 && n.y.abs() < 1e-9);
    }

    #[test]
    fn normal_unit_length() {
        let g = bicubic_grid();
        for i in 0..=3 {
            for j in 0..=3 {
                let u = i as f64 / 3.0;
                let v = j as f64 / 3.0;
                let n = normal(&g, u, v).unwrap();
                if n.length() > 0.5 {
                    assert!((n.length() - 1.0).abs() < 1e-9,
                        "u={}, v={}: |n|={}", u, v, n.length());
                }
            }
        }
    }

    #[test]
    fn derivative_u_consistent_with_finite_diff() {
        let g = bicubic_grid();
        let h = 1e-6;
        let p_plus = evaluate(&g, 0.5 + h, 0.5).unwrap();
        let p_minus = evaluate(&g, 0.5 - h, 0.5).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_u(&g, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3,
            "FD {:?} vs analytic {:?}", fd, analytic);
    }

    #[test]
    fn derivative_v_consistent_with_finite_diff() {
        let g = bicubic_grid();
        let h = 1e-6;
        let p_plus = evaluate(&g, 0.5, 0.5 + h).unwrap();
        let p_minus = evaluate(&g, 0.5, 0.5 - h).unwrap();
        let fd = (p_plus - p_minus) / (2.0 * h);
        let analytic = derivative_v(&g, 0.5, 0.5).unwrap();
        assert!((fd - analytic).length() < 1e-3,
            "FD {:?} vs analytic {:?}", fd, analytic);
    }

    #[test]
    fn evaluate_offset_grid() {
        let mut g = bilinear_grid();
        let offset = DVec3::new(100.0, 200.0, 300.0);
        for row in &mut g {
            for p in row {
                *p += offset;
            }
        }
        let p = evaluate(&g, 0.5, 0.5).unwrap();
        let centroid = (g[0][0] + g[0][1] + g[1][0] + g[1][1]) / 4.0;
        assert!(approx_eq(p, centroid, 1e-12));
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-033 v1.1 amendment tests
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn deg_helpers_match_grid_size_minus_one() {
        let g = bicubic_grid();  // 4×4
        assert_eq!(deg_u(&g), 3);
        assert_eq!(deg_v(&g), 3);

        let g2 = bilinear_grid();  // 2×2
        assert_eq!(deg_u(&g2), 1);
        assert_eq!(deg_v(&g2), 1);
    }

    #[test]
    fn deg_helpers_handle_empty_grid() {
        let g: Vec<Vec<DVec3>> = vec![];
        assert_eq!(deg_u(&g), 0);
        assert_eq!(deg_v(&g), 0);
    }

    #[test]
    fn evaluate_strict_accepts_in_range() {
        let g = bilinear_grid();
        let result = evaluate_strict(&g, 0.5, 0.5);
        assert!(result.is_ok());
    }

    #[test]
    fn evaluate_strict_accepts_corners() {
        let g = bilinear_grid();
        for (u, v) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
            assert!(evaluate_strict(&g, u, v).is_ok(),
                "corner ({}, {}) should be accepted", u, v);
        }
    }

    #[test]
    fn evaluate_strict_rejects_u_above_one() {
        let g = bilinear_grid();
        assert!(evaluate_strict(&g, 1.5, 0.5).is_err());
    }

    #[test]
    fn evaluate_strict_rejects_u_below_zero() {
        let g = bilinear_grid();
        assert!(evaluate_strict(&g, -0.1, 0.5).is_err());
    }

    #[test]
    fn evaluate_strict_rejects_v_outside_range() {
        let g = bilinear_grid();
        assert!(evaluate_strict(&g, 0.5, -0.1).is_err());
        assert!(evaluate_strict(&g, 0.5, 1.5).is_err());
    }

    #[test]
    fn evaluate_strict_tolerates_epsilon_boundary() {
        // ε boundary tolerance — slightly outside [0, 1] within 1e-9 is OK.
        let g = bilinear_grid();
        assert!(evaluate_strict(&g, -1e-12, 0.5).is_ok());
        assert!(evaluate_strict(&g, 1.0 + 1e-12, 0.5).is_ok());
    }

    #[test]
    fn evaluate_raw_allows_extrapolation() {
        // ADR-033 v1.1 P18.8 — raw evaluate() permits extrapolation.
        let g = bilinear_grid();
        let result = evaluate(&g, 1.5, 1.5);
        assert!(result.is_ok(), "raw evaluate must allow extrapolation");
    }

    #[test]
    fn normal_contract_right_handed() {
        // ADR-033 v1.1 P18.9 — normal = du × dv (right-handed).
        // Bilinear XY-plane patch with u-axis along +X, v-axis along +Y →
        // du × dv should be +Z.
        let g = bilinear_grid();
        let n = normal(&g, 0.5, 0.5).unwrap();
        assert!((n - DVec3::Z).length() < 1e-9,
            "expected +Z (du × dv right-handed), got {:?}", n);
    }
}
