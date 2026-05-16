//! ADR-054 Phase I — Surface knot insertion / refinement (u + v).
//!
//! Surface knot operations are implemented by applying the curve
//! algorithm row-by-row (for u) or column-by-column (for v) to the
//! tensor-product control grid. This composition strategy preserves
//! geometry exactly (same shape-preservation invariant K-1 as curve).

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::knot::{insert_knot_bspline,
                           insert_knot_nurbs};

// ────────────────────────────────────────────────────────────────────
// B-spline surface knot insert (u direction)
// ────────────────────────────────────────────────────────────────────

/// Insert knot value `t` into the u-direction `r` times.
///
/// Per AXiA convention `ctrl_grid[u_idx][v_idx]`, so u-direction
/// processing builds slices across the OUTER index (one slice per v).
pub fn insert_knot_surface_u_bspline(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>)> {
    if ctrl_grid.is_empty() { bail!("empty grid"); }
    let n_u = ctrl_grid.len();
    let n_v = ctrl_grid[0].len();
    for row in ctrl_grid { if row.len() != n_v { bail!("jagged grid"); } }

    // For each fixed v-index, build u-direction slice and insert.
    let mut new_columns: Vec<Vec<DVec3>> = Vec::with_capacity(n_v);
    let mut new_knots_u: Option<Vec<f64>> = None;
    for vi in 0..n_v {
        let slice: Vec<DVec3> = (0..n_u).map(|ui| ctrl_grid[ui][vi]).collect();
        let (np, nk) = insert_knot_bspline(&slice, knots_u, deg_u, t, r)?;
        if new_knots_u.is_none() { new_knots_u = Some(nk); }
        new_columns.push(np);
    }
    // Reassemble: new_n_u rows, each with n_v points.
    let new_n_u = new_columns[0].len();
    let mut new_grid: Vec<Vec<DVec3>> = vec![Vec::with_capacity(n_v); new_n_u];
    for ui in 0..new_n_u {
        for vi in 0..n_v {
            new_grid[ui].push(new_columns[vi][ui]);
        }
    }
    let _ = (knots_v, deg_v);
    Ok((new_grid, new_knots_u.unwrap()))
}

/// Insert knot value `t` into the v-direction `r` times.
///
/// Per `ctrl_grid[u_idx][v_idx]` convention, v-direction processing
/// works on each row directly (the inner Vec is the v-slice).
pub fn insert_knot_surface_v_bspline(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>)> {
    if ctrl_grid.is_empty() { bail!("empty grid"); }
    let n_u = ctrl_grid.len();

    let mut new_grid: Vec<Vec<DVec3>> = Vec::with_capacity(n_u);
    let mut new_knots_v: Option<Vec<f64>> = None;
    for row in ctrl_grid {
        let (np, nk) = insert_knot_bspline(row, knots_v, deg_v, t, r)?;
        if new_knots_v.is_none() { new_knots_v = Some(nk); }
        new_grid.push(np);
    }
    let _ = (knots_u, deg_u);
    Ok((new_grid, new_knots_v.unwrap()))
}

pub fn refine_knots_surface_u_bspline(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    x: &[f64],
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>)> {
    let mut grid = ctrl_grid.to_vec();
    let mut ku = knots_u.to_vec();
    for &t in x {
        let (g, k) = insert_knot_surface_u_bspline(&grid, &ku, knots_v, deg_u, deg_v, t, 1)?;
        grid = g; ku = k;
    }
    Ok((grid, ku))
}

pub fn refine_knots_surface_v_bspline(
    ctrl_grid: &[Vec<DVec3>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    x: &[f64],
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>)> {
    let mut grid = ctrl_grid.to_vec();
    let mut kv = knots_v.to_vec();
    for &t in x {
        let (g, k) = insert_knot_surface_v_bspline(&grid, knots_u, &kv, deg_u, deg_v, t, 1)?;
        grid = g; kv = k;
    }
    Ok((grid, kv))
}

// ────────────────────────────────────────────────────────────────────
// NURBS surface knot insert (u + v)
// ────────────────────────────────────────────────────────────────────

pub fn insert_knot_surface_u_nurbs(
    ctrl_grid: &[Vec<DVec3>],
    weights:   &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<Vec<f64>>, Vec<f64>)> {
    if ctrl_grid.len() != weights.len() {
        bail!("nurbs surface: ctrl_grid / weights row count mismatch");
    }
    let n_u = ctrl_grid.len();
    if n_u == 0 { bail!("empty grid"); }
    let n_v = ctrl_grid[0].len();

    // For each fixed v, take u-slice and insert.
    let mut new_columns_pts: Vec<Vec<DVec3>> = Vec::with_capacity(n_v);
    let mut new_columns_w:   Vec<Vec<f64>>  = Vec::with_capacity(n_v);
    let mut new_knots_u: Option<Vec<f64>> = None;
    for vi in 0..n_v {
        let col_pts: Vec<DVec3> = (0..n_u).map(|ui| ctrl_grid[ui][vi]).collect();
        let col_w:   Vec<f64>   = (0..n_u).map(|ui| weights[ui][vi]).collect();
        let (np, nw, nk) = insert_knot_nurbs(&col_pts, &col_w, knots_u, deg_u, t, r)?;
        if new_knots_u.is_none() { new_knots_u = Some(nk); }
        new_columns_pts.push(np);
        new_columns_w.push(nw);
    }
    let new_n_u = new_columns_pts[0].len();
    let mut new_grid: Vec<Vec<DVec3>> = vec![Vec::with_capacity(n_v); new_n_u];
    let mut new_w:    Vec<Vec<f64>>  = vec![Vec::with_capacity(n_v); new_n_u];
    for ui in 0..new_n_u {
        for vi in 0..n_v {
            new_grid[ui].push(new_columns_pts[vi][ui]);
            new_w[ui].push(new_columns_w[vi][ui]);
        }
    }
    let _ = (knots_v, deg_v);
    Ok((new_grid, new_w, new_knots_u.unwrap()))
}

pub fn insert_knot_surface_v_nurbs(
    ctrl_grid: &[Vec<DVec3>],
    weights:   &[Vec<f64>],
    knots_u: &[f64],
    knots_v: &[f64],
    deg_u: usize,
    deg_v: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<Vec<f64>>, Vec<f64>)> {
    if ctrl_grid.len() != weights.len() {
        bail!("nurbs surface: ctrl_grid / weights row count mismatch");
    }
    let n_u = ctrl_grid.len();
    if n_u == 0 { bail!("empty grid"); }

    let mut new_grid: Vec<Vec<DVec3>> = Vec::with_capacity(n_u);
    let mut new_w:    Vec<Vec<f64>>  = Vec::with_capacity(n_u);
    let mut new_knots_v: Option<Vec<f64>> = None;
    for ui in 0..n_u {
        let (np, nw, nk) = insert_knot_nurbs(
            &ctrl_grid[ui], &weights[ui], knots_v, deg_v, t, r,
        )?;
        if new_knots_v.is_none() { new_knots_v = Some(nk); }
        new_grid.push(np);
        new_w.push(nw);
    }
    let _ = (knots_u, deg_u);
    Ok((new_grid, new_w, new_knots_v.unwrap()))
}

// ────────────────────────────────────────────────────────────────────
// AnalyticSurface facade
// ────────────────────────────────────────────────────────────────────

use super::AnalyticSurface;

impl AnalyticSurface {
    pub fn insert_knot_u(&self, t: f64, r: usize) -> Result<AnalyticSurface> {
        match self {
            AnalyticSurface::BSplineSurface {
                ctrl_grid, knots_u, knots_v, deg_u, deg_v,
            } => {
                let (g, ku) = insert_knot_surface_u_bspline(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, t, r,
                )?;
                Ok(AnalyticSurface::BSplineSurface {
                    ctrl_grid: g,
                    knots_u: ku,
                    knots_v: knots_v.clone(),
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                })
            }
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, trim_loops,
            } => {
                let (g, w, ku) = insert_knot_surface_u_nurbs(
                    ctrl_grid, weights, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, t, r,
                )?;
                Ok(AnalyticSurface::NURBSSurface {
                    ctrl_grid: g,
                    weights: w,
                    knots_u: ku,
                    knots_v: knots_v.clone(),
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                    trim_loops: trim_loops.clone(),
                })
            }
            _ => bail!("insert_knot_u: only BSplineSurface / NURBSSurface supported"),
        }
    }

    pub fn insert_knot_v(&self, t: f64, r: usize) -> Result<AnalyticSurface> {
        match self {
            AnalyticSurface::BSplineSurface {
                ctrl_grid, knots_u, knots_v, deg_u, deg_v,
            } => {
                let (g, kv) = insert_knot_surface_v_bspline(
                    ctrl_grid, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, t, r,
                )?;
                Ok(AnalyticSurface::BSplineSurface {
                    ctrl_grid: g,
                    knots_u: knots_u.clone(),
                    knots_v: kv,
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                })
            }
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, trim_loops,
            } => {
                let (g, w, kv) = insert_knot_surface_v_nurbs(
                    ctrl_grid, weights, knots_u, knots_v,
                    *deg_u as usize, *deg_v as usize, t, r,
                )?;
                Ok(AnalyticSurface::NURBSSurface {
                    ctrl_grid: g,
                    weights: w,
                    knots_u: knots_u.clone(),
                    knots_v: kv,
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                    trim_loops: trim_loops.clone(),
                })
            }
            _ => bail!("insert_knot_v: only BSplineSurface / NURBSSurface supported"),
        }
    }

    pub fn refine_knots_u(&self, x: &[f64]) -> Result<AnalyticSurface> {
        let mut cur = self.clone();
        for &t in x {
            cur = cur.insert_knot_u(t, 1)?;
        }
        Ok(cur)
    }

    pub fn refine_knots_v(&self, x: &[f64]) -> Result<AnalyticSurface> {
        let mut cur = self.clone();
        for &t in x {
            cur = cur.insert_knot_v(t, 1)?;
        }
        Ok(cur)
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests (6 surface)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surfaces::{bspline_surface as bs, SurfaceOps};

    fn cubic_clamped_knots(n: usize) -> Vec<f64> {
        // [0,0,0,0, 1,2,...,n-3, n-2,n-2,n-2,n-2] for degree 3
        let p = 3;
        let mut k: Vec<f64> = Vec::new();
        for _ in 0..=p { k.push(0.0); }
        let interior = if n > p + 1 { (n - p - 1) as i32 } else { 0 };
        for i in 1..=interior { k.push(i as f64); }
        let high = (interior + 1) as f64;
        for _ in 0..=p { k.push(high); }
        // Knot vector length should be n + p + 1
        debug_assert_eq!(k.len(), n + p + 1);
        k
    }

    fn make_test_surface() -> (Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>) {
        // 4x4 control grid, cubic in both directions
        let grid: Vec<Vec<DVec3>> = (0..4).map(|j| {
            (0..4).map(|i| DVec3::new(i as f64, j as f64, ((i + j) as f64).sin())).collect()
        }).collect();
        let knots_u = cubic_clamped_knots(4);
        let knots_v = cubic_clamped_knots(4);
        (grid, knots_u, knots_v)
    }

    fn sample_grid_bs(grid: &[Vec<DVec3>], ku: &[f64], kv: &[f64], du: usize, dv: usize) -> Vec<DVec3> {
        let mut out = Vec::with_capacity(25);
        for i in 0..5 {
            for j in 0..5 {
                let u = i as f64 / 4.0;
                let v = j as f64 / 4.0;
                out.push(bs::evaluate(grid, ku, kv, du, dv, u, v).unwrap());
            }
        }
        out
    }

    /// ADR-054 §2.7 #9 — BSpline surface insert_knot_u preserves evaluate.
    #[test]
    fn bspline_surface_insert_knot_u_preserves_evaluate() {
        let (grid, ku, kv) = make_test_surface();
        let pts_before = sample_grid_bs(&grid, &ku, &kv, 3, 3);
        let (g2, ku2) = insert_knot_surface_u_bspline(&grid, &ku, &kv, 3, 3, 0.5, 1).unwrap();
        let pts_after = sample_grid_bs(&g2, &ku2, &kv, 3, 3);
        for (b, a) in pts_before.iter().zip(pts_after.iter()) {
            assert!((b - a).length() < 1e-9, "shape preserve fail u: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #10 — BSpline surface insert_knot_v preserves evaluate.
    #[test]
    fn bspline_surface_insert_knot_v_preserves_evaluate() {
        let (grid, ku, kv) = make_test_surface();
        let pts_before = sample_grid_bs(&grid, &ku, &kv, 3, 3);
        let (g2, kv2) = insert_knot_surface_v_bspline(&grid, &ku, &kv, 3, 3, 0.5, 1).unwrap();
        let pts_after = sample_grid_bs(&g2, &ku, &kv2, 3, 3);
        for (b, a) in pts_before.iter().zip(pts_after.iter()) {
            assert!((b - a).length() < 1e-9, "shape preserve fail v: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #11 — NURBS surface insert_knot_u preserves evaluate.
    #[test]
    fn nurbs_surface_insert_knot_u_preserves_evaluate() {
        // Bilinear NURBS surface with all weights 1
        let grid: Vec<Vec<DVec3>> = vec![
            vec![DVec3::ZERO,             DVec3::new(1.0, 0.0, 0.0)],
            vec![DVec3::new(0.0, 1.0, 0.0), DVec3::new(1.0, 1.0, 0.0)],
        ];
        let weights = vec![vec![1.0, 1.0], vec![1.0, 1.0]];
        let ku = vec![0.0, 0.0, 1.0, 1.0];
        let kv = vec![0.0, 0.0, 1.0, 1.0];

        use crate::surfaces::nurbs_surface as ns;
        let mut pts_before = Vec::with_capacity(25);
        for i in 0..5 {
            for j in 0..5 {
                let u = i as f64 / 4.0;
                let v = j as f64 / 4.0;
                pts_before.push(ns::evaluate(&grid, &weights, &ku, &kv, 1, 1, u, v).unwrap());
            }
        }
        let (g2, w2, ku2) = insert_knot_surface_u_nurbs(&grid, &weights, &ku, &kv, 1, 1, 0.5, 1).unwrap();
        let mut pts_after = Vec::with_capacity(25);
        for i in 0..5 {
            for j in 0..5 {
                let u = i as f64 / 4.0;
                let v = j as f64 / 4.0;
                pts_after.push(ns::evaluate(&g2, &w2, &ku2, &kv, 1, 1, u, v).unwrap());
            }
        }
        for (b, a) in pts_before.iter().zip(pts_after.iter()) {
            assert!((b - a).length() < 1e-9, "NURBS surface preserve: {:?} vs {:?}", b, a);
        }
    }

    /// ADR-054 §2.7 #12 — Refine u grows the outer (u) dimension.
    /// Per AXiA convention `ctrl_grid[u_idx][v_idx]`:
    ///   ctrl_grid.len() = n_u (outer)  /  ctrl_grid[i].len() = n_v (inner)
    #[test]
    fn surface_refine_u_grid_grows_correctly() {
        let (grid, ku, kv) = make_test_surface();
        let xs = vec![0.25, 0.5, 0.75];
        let (g2, _ku2) = refine_knots_surface_u_bspline(&grid, &ku, &kv, 3, 3, &xs).unwrap();
        // Original: n_u=4, n_v=4. After 3 inserts in u: n_u=7, n_v=4.
        assert_eq!(g2.len(), 7, "u dimension grew by 3");
        for row in &g2 {
            assert_eq!(row.len(), 4, "v dimension unchanged");
        }
    }

    /// ADR-054 §2.7 #13 — Refine v doesn't affect u count.
    #[test]
    fn surface_refine_v_does_not_affect_u_count() {
        let (grid, ku, kv) = make_test_surface();
        let xs = vec![0.5];
        let (g2, _kv2) = refine_knots_surface_v_bspline(&grid, &ku, &kv, 3, 3, &xs).unwrap();
        // After 1 insert in v: n_u=4 (unchanged), n_v=5
        assert_eq!(g2.len(), 4, "u dimension unchanged");
        for row in &g2 {
            assert_eq!(row.len(), 5, "v dimension grew by 1");
        }
    }

    /// ADR-054 §2.7 — AnalyticSurface facade smoke test.
    #[test]
    fn analytic_surface_insert_knot_u_facade() {
        let (grid, ku, kv) = make_test_surface();
        let s = AnalyticSurface::BSplineSurface {
            ctrl_grid: grid, knots_u: ku, knots_v: kv,
            deg_u: 3, deg_v: 3,
        };
        let out = s.insert_knot_u(0.25, 1).expect("facade insert ok");
        match out {
            AnalyticSurface::BSplineSurface { ctrl_grid, .. } => {
                // After u insert: n_u grows from 4 to 5, n_v stays 4
                assert_eq!(ctrl_grid.len(), 5);
                assert_eq!(ctrl_grid[0].len(), 4);
            }
            other => panic!("expected BSplineSurface, got {:?}", other),
        }
    }
}
