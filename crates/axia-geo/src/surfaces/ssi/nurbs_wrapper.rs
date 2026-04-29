//! SSI wrapper for B-spline / NURBS surfaces (Phase G Stage 1).
//!
//! Lifts the Bezier-only `intersect_bezier_pair` pipeline to general
//! tensor B-spline surfaces by:
//! 1. Extracting Bezier patches from each surface (knot insertion until
//!    every interior knot has multiplicity = degree).
//! 2. Running pair-wise Bezier SSI on the cross product (with AABB pruning
//!    at the patch level — disjoint pairs skipped before subdivision).
//! 3. Remapping each patch's local uv to the parent surface's global uv.
//! 4. Stitching all chains across patch boundaries via topology assembly.
//!
//! **Non-rational only** for now. Rational NURBS surfaces need 4D-lifted
//! Bezier extraction (separate work item).

use glam::DVec3;

use super::SurfaceIntersection;
use super::{newton, subdivide, topology};
use super::super::bspline_surface;

/// Intersect two non-rational tensor B-spline surfaces.
pub fn intersect_bspline_pair(
    ctrl_grid_a: &[Vec<DVec3>],
    knots_u_a: &[f64], knots_v_a: &[f64],
    deg_u_a: usize, deg_v_a: usize,
    ctrl_grid_b: &[Vec<DVec3>],
    knots_u_b: &[f64], knots_v_b: &[f64],
    deg_u_b: usize, deg_v_b: usize,
    tol: f64,
) -> anyhow::Result<Vec<SurfaceIntersection>> {
    let patches_a = bspline_surface::extract_bezier_patches(
        ctrl_grid_a, knots_u_a, knots_v_a, deg_u_a, deg_v_a,
    )?;
    let patches_b = bspline_surface::extract_bezier_patches(
        ctrl_grid_b, knots_u_b, knots_v_b, deg_u_b, deg_v_b,
    )?;

    if patches_a.is_empty() || patches_b.is_empty() {
        return Ok(Vec::new());
    }

    // Phase 1 — patch-level AABB pruning, then Stage 2 subdivision per pair.
    let pad = 2.0 * tol;
    let newton_tol = (tol * 1e-3).max(1e-9);
    let mut all_refined: Vec<newton::RefinementResult> = Vec::new();

    for (patch_a, ua_range, va_range) in &patches_a {
        let bbox_a = bbox_of_grid(patch_a);
        for (patch_b, ub_range, vb_range) in &patches_b {
            let bbox_b = bbox_of_grid(patch_b);
            if !aabb_overlap_padded(bbox_a, bbox_b, pad) {
                continue;
            }
            let candidates = subdivide::subdivide_intersect(
                patch_a, patch_b, tol, subdivide::DEFAULT_MAX_DEPTH,
            );
            for cand in candidates {
                let refined = newton::refine_bezier_pair(
                    patch_a, patch_b,
                    cand.uv_a, cand.uv_b,
                    newton_tol, newton::DEFAULT_NEWTON_MAX_ITER,
                );
                // Remap local (0..1) uv to global parent uv.
                let global_uv_a = remap_local_to_global(refined.uv_a, *ua_range, *va_range);
                let global_uv_b = remap_local_to_global(refined.uv_b, *ub_range, *vb_range);
                all_refined.push(newton::RefinementResult {
                    uv_a: global_uv_a,
                    uv_b: global_uv_b,
                    point: refined.point,
                    residual: refined.residual,
                    iterations: refined.iterations,
                    converged: refined.converged,
                });
            }
        }
    }

    // Phase 2 — global topology assembly across all patches.
    let chains = topology::assemble_chains(all_refined, tol * 100.0, tol);
    Ok(chains)
}

fn bbox_of_grid(grid: &[Vec<DVec3>]) -> (DVec3, DVec3) {
    let mut mn = DVec3::splat(f64::INFINITY);
    let mut mx = DVec3::splat(f64::NEG_INFINITY);
    for row in grid {
        for p in row {
            mn = mn.min(*p);
            mx = mx.max(*p);
        }
    }
    (mn, mx)
}

fn aabb_overlap_padded(
    (a_mn, a_mx): (DVec3, DVec3),
    (b_mn, b_mx): (DVec3, DVec3),
    pad: f64,
) -> bool {
    a_mx.x + pad >= b_mn.x && b_mx.x + pad >= a_mn.x
        && a_mx.y + pad >= b_mn.y && b_mx.y + pad >= a_mn.y
        && a_mx.z + pad >= b_mn.z && b_mx.z + pad >= a_mn.z
}

fn remap_local_to_global(
    local: (f64, f64),
    u_range: (f64, f64),
    v_range: (f64, f64),
) -> (f64, f64) {
    (
        u_range.0 + local.0 * (u_range.1 - u_range.0),
        v_range.0 + local.1 * (v_range.1 - v_range.0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::bspline::clamped_uniform_knots;

    fn flat_bspline_grid(z: f64, n: usize) -> Vec<Vec<DVec3>> {
        let mut g = vec![vec![DVec3::ZERO; n]; n];
        for i in 0..n {
            for j in 0..n {
                let u = i as f64 / (n - 1) as f64;
                let v = j as f64 / (n - 1) as f64;
                g[i][j] = DVec3::new(u, v, z);
            }
        }
        g
    }

    #[test]
    fn nurbs_disjoint_yields_no_chains() {
        let a = flat_bspline_grid(0.0, 5);
        let b = flat_bspline_grid(10.0, 5);
        let ku = clamped_uniform_knots(5, 3);
        let kv = clamped_uniform_knots(5, 3);
        let chains = intersect_bspline_pair(
            &a, &ku, &kv, 3, 3,
            &b, &ku, &kv, 3, 3,
            1e-3,
        ).unwrap();
        assert!(chains.is_empty());
    }

    #[test]
    fn nurbs_perpendicular_planar_yields_chain() {
        // A on z=0, B on x=0.5 — both as 4×4 B-splines (cubic, single Bezier).
        let mut a = vec![vec![DVec3::ZERO; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                a[i][j] = DVec3::new(i as f64 / 3.0, j as f64 / 3.0, 0.0);
            }
        }
        let mut b = vec![vec![DVec3::ZERO; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                b[i][j] = DVec3::new(0.5, i as f64 / 3.0, j as f64 / 3.0 - 0.5);
            }
        }
        let ku = clamped_uniform_knots(4, 3);
        let kv = clamped_uniform_knots(4, 3);
        let chains = intersect_bspline_pair(
            &a, &ku, &kv, 3, 3,
            &b, &ku, &kv, 3, 3,
            0.05,
        ).unwrap();
        assert!(!chains.is_empty());
        for chain in &chains {
            for p in &chain.points {
                assert!((p.x - 0.5).abs() < 0.05);
                assert!(p.z.abs() < 0.05);
            }
        }
    }

    #[test]
    fn nurbs_multi_patch_intersection_assembled() {
        // 6×6 ctrl planar B-spline cubic on z=0 (decomposes to 3×3 Bezier patches)
        // intersected with a vertical Bezier on x=0.5.
        let n = 6;
        let mut a = vec![vec![DVec3::ZERO; n]; n];
        for i in 0..n {
            for j in 0..n {
                a[i][j] = DVec3::new(i as f64 / (n - 1) as f64, j as f64 / (n - 1) as f64, 0.0);
            }
        }
        let ku_a = clamped_uniform_knots(n, 3);
        let kv_a = clamped_uniform_knots(n, 3);

        // B as single Bezier patch (4×4, simple)
        let mut b = vec![vec![DVec3::ZERO; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                b[i][j] = DVec3::new(0.5, i as f64 / 3.0, j as f64 / 3.0 - 0.5);
            }
        }
        let ku_b = clamped_uniform_knots(4, 3);
        let kv_b = clamped_uniform_knots(4, 3);

        let chains = intersect_bspline_pair(
            &a, &ku_a, &kv_a, 3, 3,
            &b, &ku_b, &kv_b, 3, 3,
            0.05,
        ).unwrap();
        assert!(!chains.is_empty());
        // Chain should span y from 0 to 1.
        let mut y_min = f64::INFINITY;
        let mut y_max = f64::NEG_INFINITY;
        for chain in &chains {
            for p in &chain.points {
                y_min = y_min.min(p.y);
                y_max = y_max.max(p.y);
            }
        }
        assert!(y_min < 0.2 && y_max > 0.8,
            "chain y-range too narrow: [{}, {}]", y_min, y_max);
    }
}
