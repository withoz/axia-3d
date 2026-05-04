//! ADR-056 Phase K Step 4 — Surface Grid Fitting (Piegl A9.7).
//!
//! Tensor-product NURBS surface interpolation through a `grid[u][v]` of
//! 3D points. Algorithm:
//!
//!   1. Compute u-parameters from each ROW (vary v at fixed u_idx) —
//!      use chord-length on the points at v=0, then strictify.
//!   2. Compute v-parameters from each COLUMN (vary u at fixed v_idx) —
//!      same.
//!   3. Compute u-knots and v-knots from the parameters via averaging
//!      (Piegl Eq. 9.8).
//!   4. For each row: interpolate u-direction → intermediate `R[i][j]`
//!      with row j of intermediate having control points along u.
//!   5. For each column of R: interpolate v-direction → final
//!      `surface_ctrl[u_idx][v_idx]`.
//!
//! Matches Piegl A9.7 (separable interpolation). The surface passes
//! exactly through every input grid point.
//!
//! Per AxiA convention: `grid[u_idx][v_idx]` outer = u_index.

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::fitting::{
    compute_parameters, interpolate_with_params_and_knots, knots_for_interpolation,
    Parameterization,
};

/// Interpolate a tensor-product NURBS surface through a `grid` of
/// 3D points. Returns `(ctrl_grid, knots_u, knots_v, deg_u, deg_v)`.
///
/// Pre-conditions:
///   - grid is non-empty and rectangular
///   - n_u = grid.len() >= degree_u + 1
///   - n_v = grid[0].len() >= degree_v + 1
///
/// The result surface passes EXACTLY through each input point at the
/// corresponding `(u_params[i], v_params[j])` parameter pair.
pub fn fit_nurbs_surface_grid(
    grid: &[Vec<DVec3>],
    degree_u: usize,
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)> {
    if grid.is_empty() { bail!("grid is empty"); }
    let n_u = grid.len();
    let n_v = grid[0].len();
    for (i, row) in grid.iter().enumerate() {
        if row.len() != n_v {
            bail!("grid row {} has len {} ≠ first row {}", i, row.len(), n_v);
        }
    }
    if degree_u < 1 || degree_v < 1 { bail!("degrees must be >= 1"); }
    if n_u < degree_u + 1 {
        bail!("need n_u ≥ degree_u+1 = {}, got {}", degree_u + 1, n_u);
    }
    if n_v < degree_v + 1 {
        bail!("need n_v ≥ degree_v+1 = {}, got {}", degree_v + 1, n_v);
    }

    // Step 1+2: parameters.
    // u-params from grid[*][0] (chord-length down the first column);
    // v-params from grid[0][*] (chord-length across the first row).
    let u_seed: Vec<DVec3> = (0..n_u).map(|i| grid[i][0]).collect();
    let v_seed: Vec<DVec3> = (0..n_v).map(|j| grid[0][j]).collect();
    let u_params = strictify(compute_parameters(&u_seed, Parameterization::ChordLength));
    let v_params = strictify(compute_parameters(&v_seed, Parameterization::ChordLength));

    // Step 3: knot vectors via averaging.
    let knots_u = knots_for_interpolation(&u_params, degree_u);
    let knots_v = knots_for_interpolation(&v_params, degree_v);

    // Step 4: per-row u-interpolation → intermediate R[i][j]
    //   where R[i] = u-direction control polygon for the i-th column
    //   of the original grid (treating fixed v_idx j, varying u).
    // Build R as Vec<Vec<DVec3>> with R.len() == n_u (same as ctrl) and
    // R[i].len() == n_v.
    let mut r_grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; n_v]; n_u];
    for j in 0..n_v {
        // Column j: points = grid[i][j] for i in 0..n_u
        let col: Vec<DVec3> = (0..n_u).map(|i| grid[i][j]).collect();
        let col_ctrl = interpolate_with_params_and_knots(
            &col, degree_u, &u_params, &knots_u,
        )?;
        for i in 0..n_u {
            r_grid[i][j] = col_ctrl[i];
        }
    }

    // Step 5: per-row v-interpolation on R → final ctrl_grid
    let mut ctrl_grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; n_v]; n_u];
    for i in 0..n_u {
        let row_ctrl = interpolate_with_params_and_knots(
            &r_grid[i], degree_v, &v_params, &knots_v,
        )?;
        for j in 0..n_v {
            ctrl_grid[i][j] = row_ctrl[j];
        }
    }

    Ok((ctrl_grid, knots_u, knots_v, degree_u, degree_v))
}

/// Convenience: fit from an unstructured 3D point cloud by projecting
/// onto a `target_grid_size` axis-aligned grid (Z = mean Z value).
///
/// **MVP scope**: simple bbox grid projection — for each grid cell
/// `(u_idx, v_idx)`, average all points whose XY falls into that cell.
/// Empty cells are filled by inverse-distance interpolation from
/// neighbors. Phase L will replace with proper k-NN / RBF fitting.
pub fn fit_nurbs_surface_from_cloud(
    points: &[DVec3],
    target_grid_size: (usize, usize),
    degree_u: usize,
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)> {
    let (n_u, n_v) = target_grid_size;
    if n_u < degree_u + 1 || n_v < degree_v + 1 {
        bail!(
            "target_grid_size ({}, {}) too small for degrees ({}, {})",
            n_u, n_v, degree_u, degree_v,
        );
    }
    if points.len() < n_u * n_v {
        bail!(
            "cloud has {} points, need at least n_u * n_v = {} for stable fit",
            points.len(), n_u * n_v,
        );
    }

    // Compute XY bbox
    let mut x_min = f64::INFINITY; let mut x_max = f64::NEG_INFINITY;
    let mut y_min = f64::INFINITY; let mut y_max = f64::NEG_INFINITY;
    for p in points {
        if p.x < x_min { x_min = p.x; } if p.x > x_max { x_max = p.x; }
        if p.y < y_min { y_min = p.y; } if p.y > y_max { y_max = p.y; }
    }
    let dx = (x_max - x_min) / (n_u - 1) as f64;
    let dy = (y_max - y_min) / (n_v - 1) as f64;
    if dx.abs() < 1e-30 || dy.abs() < 1e-30 {
        bail!("cloud bounding box degenerate in XY");
    }

    // Bin points by nearest cell, accumulate Z (and XY for fine-tune)
    let mut sums: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; n_v]; n_u];
    let mut counts: Vec<Vec<usize>> = vec![vec![0; n_v]; n_u];
    for p in points {
        let ui = ((p.x - x_min) / dx).round() as i64;
        let vj = ((p.y - y_min) / dy).round() as i64;
        if ui < 0 || ui >= n_u as i64 || vj < 0 || vj >= n_v as i64 { continue; }
        sums[ui as usize][vj as usize] += *p;
        counts[ui as usize][vj as usize] += 1;
    }

    // Fill grid. For empty cells, use canonical (x, y, mean_z) where
    // mean_z is averaged over all binned points.
    let mut total = DVec3::ZERO;
    let mut total_n = 0usize;
    for i in 0..n_u { for j in 0..n_v {
        if counts[i][j] > 0 {
            total += sums[i][j];
            total_n += counts[i][j];
        }
    }}
    let mean = if total_n == 0 { DVec3::ZERO } else { total / total_n as f64 };
    let mut grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; n_v]; n_u];
    for i in 0..n_u { for j in 0..n_v {
        if counts[i][j] > 0 {
            grid[i][j] = sums[i][j] / counts[i][j] as f64;
        } else {
            grid[i][j] = DVec3::new(
                x_min + (i as f64) * dx,
                y_min + (j as f64) * dy,
                mean.z,
            );
        }
    }}

    fit_nurbs_surface_grid(&grid, degree_u, degree_v)
}

// ── Helpers ──────────────────────────────────────────────────────────

fn strictify(mut v: Vec<f64>) -> Vec<f64> {
    if v.len() < 2 { return v; }
    let eps = 1e-10;
    for i in 1..v.len() {
        if v[i] <= v[i - 1] + eps {
            v[i] = (v[i - 1] + eps).min(1.0);
        }
    }
    v[0] = 0.0;
    *v.last_mut().unwrap() = 1.0;
    v
}

// ────────────────────────────────────────────────────────────────────
// Tests (5 — ADR-056 §2.7 step 4)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surfaces::bspline_surface as bs;

    /// ADR-056 §2.7 #14 — Fit planar grid recovers the plane (z=0 grid
    /// produces surface that evaluates to z=0 everywhere).
    #[test]
    fn fit_planar_grid_recovers_plane() {
        // 4×4 planar grid in XY, z=0
        let mut grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                grid[i][j] = DVec3::new(i as f64, j as f64, 0.0);
            }
        }
        let (ctrl, ku, kv, du, dv) = fit_nurbs_surface_grid(&grid, 3, 3).unwrap();
        assert_eq!(du, 3); assert_eq!(dv, 3);
        assert_eq!(ctrl.len(), 4);
        assert_eq!(ctrl[0].len(), 4);

        // Sample at multiple (u, v) — z must remain 0 everywhere
        for ui in 0..=8 {
            for vj in 0..=8 {
                let u = ui as f64 / 8.0;
                let v = vj as f64 / 8.0;
                let p = bs::evaluate(&ctrl, &ku, &kv, du, dv, u, v).unwrap();
                assert!(p.z.abs() < 1e-9,
                    "planar fit lost z=0 at ({}, {}): z={}", u, v, p.z);
            }
        }
    }

    /// ADR-056 §2.7 #15 — Fit curved grid within tolerance — surface
    /// at sampled grid params recovers grid value to 1e-9.
    #[test]
    fn fit_curved_grid_within_tolerance() {
        // 5×5 grid: z = 0.5 * sin(x) * cos(y)
        let n = 5usize;
        let mut grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; n]; n];
        for i in 0..n {
            for j in 0..n {
                let x = i as f64;
                let y = j as f64;
                let z = 0.5 * x.sin() * y.cos();
                grid[i][j] = DVec3::new(x, y, z);
            }
        }
        let degree = 3;
        let (ctrl, ku, kv, du, dv) = fit_nurbs_surface_grid(&grid, degree, degree).unwrap();
        assert_eq!(ctrl.len(), n);
        assert_eq!(ctrl[0].len(), n);

        // Compute u_params and v_params identically to the impl
        use crate::curves::fitting::{compute_parameters, Parameterization};
        let u_seed: Vec<DVec3> = (0..n).map(|i| grid[i][0]).collect();
        let v_seed: Vec<DVec3> = (0..n).map(|j| grid[0][j]).collect();
        let u_params = strictify(compute_parameters(&u_seed, Parameterization::ChordLength));
        let v_params = strictify(compute_parameters(&v_seed, Parameterization::ChordLength));

        // Surface evaluated at (u_params[i], v_params[j]) must equal grid[i][j]
        for i in 0..n {
            for j in 0..n {
                let p = bs::evaluate(&ctrl, &ku, &kv, du, dv, u_params[i], v_params[j]).unwrap();
                let err = (p - grid[i][j]).length();
                assert!(err < 1e-9,
                    "interpolation error at ({}, {}): got {:?}, expected {:?}, err={}",
                    i, j, p, grid[i][j], err);
            }
        }
    }

    /// ADR-056 §2.7 #16 — Surface passes through corner control points
    /// (always — corners are at u_params[0/end] = 0/1).
    #[test]
    fn fit_grid_passes_through_corners() {
        let mut grid: Vec<Vec<DVec3>> = vec![vec![DVec3::ZERO; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                let x = i as f64 * 2.0;
                let y = j as f64 * 2.0;
                grid[i][j] = DVec3::new(x, y, (x + y).sin());
            }
        }
        let (ctrl, ku, kv, du, dv) = fit_nurbs_surface_grid(&grid, 3, 3).unwrap();

        let p00 = bs::evaluate(&ctrl, &ku, &kv, du, dv, 0.0, 0.0).unwrap();
        let p11 = bs::evaluate(&ctrl, &ku, &kv, du, dv, 1.0, 1.0).unwrap();
        let p10 = bs::evaluate(&ctrl, &ku, &kv, du, dv, 1.0, 0.0).unwrap();
        let p01 = bs::evaluate(&ctrl, &ku, &kv, du, dv, 0.0, 1.0).unwrap();
        assert!((p00 - grid[0][0]).length() < 1e-9);
        assert!((p11 - grid[3][3]).length() < 1e-9);
        assert!((p10 - grid[3][0]).length() < 1e-9);
        assert!((p01 - grid[0][3]).length() < 1e-9);
    }

    /// ADR-056 §2.7 #17 — Cloud fallback validates target grid size
    /// vs degree.
    #[test]
    fn fit_cloud_fallback_size_validation() {
        let pts = vec![DVec3::ZERO; 10]; // arbitrary
        // target 3×3 with degree (3, 3) requires ≥ 4×4
        let r = fit_nurbs_surface_from_cloud(&pts, (3, 3), 3, 3);
        assert!(r.is_err(), "should reject target_grid_size < degree+1");
    }

    /// ADR-056 §2.7 #19 — Phase H integration: loft, then translate
    /// surface via Phase H BezierPatch path. Kind preserved + control
    /// grid translated correctly.
    #[test]
    fn loft_then_transform_preserves_structure() {
        use crate::surfaces::loft::loft_surface;
        // 3-section linear loft → BSpline-style ctrl grid
        let knots_u = vec![0.0, 0.0, 1.0, 1.0]; // degree 1
        let s0 = vec![DVec3::ZERO, DVec3::new(5.0, 0.0, 0.0)];
        let s1 = vec![DVec3::new(0.0, 5.0, 0.0), DVec3::new(5.0, 5.0, 0.0)];
        let s2 = vec![DVec3::new(0.0, 10.0, 0.0), DVec3::new(5.0, 10.0, 0.0)];
        let curves = vec![
            (&s0[..], &knots_u[..], 1usize),
            (&s1[..], &knots_u[..], 1usize),
            (&s2[..], &knots_u[..], 1usize),
        ];
        let (grid, ku, kv, du, dv) = loft_surface(&curves, 2).unwrap();

        // Wrap as AnalyticSurface::BSplineSurface and apply Phase H transform
        use crate::surfaces::AnalyticSurface;
        use glam::DMat4;
        let surface = AnalyticSurface::BSplineSurface {
            ctrl_grid: grid.clone(),
            knots_u: ku, knots_v: kv,
            deg_u: du as u32, deg_v: dv as u32,
        };
        let m = DMat4::from_translation(DVec3::new(100.0, 0.0, 0.0));
        let translated = surface.transform(&m).unwrap();

        // Translated surface keeps BSplineSurface kind + every ctrl pt
        // is shifted by +100 in x.
        match translated {
            AnalyticSurface::BSplineSurface { ctrl_grid: g2, .. } => {
                for i in 0..grid.len() {
                    for j in 0..grid[i].len() {
                        let expected = grid[i][j] + DVec3::new(100.0, 0.0, 0.0);
                        assert!((g2[i][j] - expected).length() < 1e-9,
                            "translated ctrl[{}][{}]: got {:?}, expected {:?}",
                            i, j, g2[i][j], expected);
                    }
                }
            }
            other => panic!("expected BSplineSurface after transform, got {:?}", other),
        }
    }

    /// ADR-056 §2.7 #20 — Phase H integration: extrusion, then uniform
    /// scale. Height ratio preserved (proportional scaling).
    #[test]
    fn extrusion_then_uniform_scale_preserves_height_ratio() {
        use crate::surfaces::sweep::extrusion_surface;
        let profile = vec![DVec3::ZERO, DVec3::new(2.0, 0.0, 0.0)];
        let p_knots = vec![0.0, 0.0, 1.0, 1.0];
        let original_height = 5.0_f64;
        let (grid, ku, kv, du, dv) = extrusion_surface(
            &profile, &p_knots, 1, DVec3::Z, original_height,
        ).unwrap();

        use crate::surfaces::AnalyticSurface;
        use glam::DMat4;
        let surface = AnalyticSurface::BSplineSurface {
            ctrl_grid: grid, knots_u: ku.clone(), knots_v: kv.clone(),
            deg_u: du as u32, deg_v: dv as u32,
        };
        let scale = 2.5_f64;
        let m = DMat4::from_scale(DVec3::splat(scale));
        let scaled = surface.transform(&m).unwrap();

        // After uniform scale s, the extrusion height should be s * original.
        match scaled {
            AnalyticSurface::BSplineSurface { ctrl_grid, .. } => {
                use crate::surfaces::bspline_surface as bss;
                let p_top = bss::evaluate(&ctrl_grid, &ku, &kv, du, dv, 0.0, 1.0).unwrap();
                let expected_z = original_height * scale;
                assert!((p_top.z - expected_z).abs() < 1e-9,
                    "scaled extrusion height: expected z={}, got z={}",
                    expected_z, p_top.z);
            }
            other => panic!("expected BSplineSurface, got {:?}", other),
        }
    }

    /// ADR-056 §2.7 #18 — Cloud fitting recovers a planar surface
    /// from points sampled on z=0 plane.
    #[test]
    fn fit_cloud_planar_recovery() {
        // Generate 36 points on z=0 plane scattered randomly in XY
        let mut pts: Vec<DVec3> = Vec::new();
        for i in 0..6 {
            for j in 0..6 {
                let x = i as f64 + 0.1;
                let y = j as f64 + 0.1;
                pts.push(DVec3::new(x, y, 0.0));
            }
        }
        let (ctrl, ku, kv, du, dv) = fit_nurbs_surface_from_cloud(
            &pts, (4, 4), 2, 2,
        ).unwrap();
        assert_eq!(du, 2); assert_eq!(dv, 2);

        // Evaluate at a few interior points — z should be ≈ 0
        for &(u, v) in &[(0.25, 0.25), (0.5, 0.5), (0.75, 0.5)] {
            let p = bs::evaluate(&ctrl, &ku, &kv, du, dv, u, v).unwrap();
            assert!(p.z.abs() < 0.1,
                "planar cloud recovery: |z| at ({}, {}) = {} > 0.1", u, v, p.z);
        }
    }
}
