//! Bezier patch — tensor product Bezier surface (Phase E, ADR-033).
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
//! Parameter range: `(u, v) ∈ [0, 1]²`. Endpoint interpolation:
//! `S(0,0) = P[0][0]`, `S(1,1) = P[deg_u][deg_v]`, etc.

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::bezier;

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

    #[test]
    fn derivative_u_zero_when_n_u_is_one() {
        // 1×N grid → degree 0 in u → derivative is zero.
        let g = vec![vec![DVec3::ZERO, DVec3::X, DVec3::Y]];
        let d = derivative_u(&g, 0.5, 0.5).unwrap();
        assert!(d.length() < 1e-12);
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
}
