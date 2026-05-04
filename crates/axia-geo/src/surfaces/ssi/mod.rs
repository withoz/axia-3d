//! Surface-Surface Intersection (SSI) — Phase F (ADR-034).
//!
//! Stage 1 (current): Analytic shortcuts for common primitive pairs +
//! infrastructure for general subdivision.
//!
//! Stages 2-4 (subdivide-and-prune, Newton refinement, topology assembly)
//! are deferred to follow-up commits.

pub mod analytic;
pub mod subdivide;
pub mod newton;
pub mod topology;
pub mod nurbs_wrapper;
pub mod trim_gen;
pub mod boolean;
pub mod trim_geom;
pub mod trim_classify;
pub mod tolerance;
pub mod trim_boolean;
pub mod robustness;
pub mod trim_to_polyline;

use glam::DVec3;
use serde::{Deserialize, Serialize};

/// Result of a surface-surface intersection.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceIntersection {
    /// Sample points along the intersection curve(s), in 3D space.
    pub points: Vec<DVec3>,
    /// Parameter on first surface for each sample.
    pub uv_a: Vec<(f64, f64)>,
    /// Parameter on second surface for each sample.
    pub uv_b: Vec<(f64, f64)>,
    /// True if the intersection forms a closed loop.
    pub closed: bool,
    /// True if a tangent contact was detected (degenerate intersection).
    pub tangent_warning: bool,
}

impl Default for SurfaceIntersection {
    fn default() -> Self {
        Self {
            points: Vec::new(),
            uv_a: Vec::new(),
            uv_b: Vec::new(),
            closed: false,
            tangent_warning: false,
        }
    }
}

impl SurfaceIntersection {
    /// True if the intersection has no points.
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Number of sample points along the intersection.
    pub fn len(&self) -> usize {
        self.points.len()
    }
}

/// Full SSI pipeline for two Bezier patches: Stage 2 (subdivide-and-prune)
/// → Stage 3 (Newton refinement) → Stage 4 (topology assembly).
///
/// `tol` is the geometric tolerance (e.g. 1e-3 mm). Internally uses:
/// - Subdivision tol = `tol`
/// - Newton tol = `tol / 1000.0`
/// - Topology gap_tol = `tol * 100.0` (allow chain stitching across patch
///   boundaries).
pub fn intersect_bezier_pair(
    patch_a_ctrl: &[Vec<DVec3>],
    patch_b_ctrl: &[Vec<DVec3>],
    tol: f64,
) -> Vec<SurfaceIntersection> {
    let candidates = subdivide::subdivide_intersect(
        patch_a_ctrl, patch_b_ctrl, tol, subdivide::DEFAULT_MAX_DEPTH,
    );
    if candidates.is_empty() {
        return Vec::new();
    }
    let newton_tol = (tol * 1e-3).max(1e-9);
    let refined: Vec<_> = candidates.iter().map(|c| {
        newton::refine_bezier_pair(
            patch_a_ctrl, patch_b_ctrl,
            c.uv_a, c.uv_b,
            newton_tol, newton::DEFAULT_NEWTON_MAX_ITER,
        )
    }).collect();
    topology::assemble_chains(refined, tol * 100.0, tol)
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;

    fn flat_grid(z: f64) -> Vec<Vec<DVec3>> {
        let mut g = vec![vec![DVec3::ZERO; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                g[i][j] = DVec3::new(i as f64 / 2.0, j as f64 / 2.0, z);
            }
        }
        g
    }

    #[test]
    fn pipeline_disjoint_patches_yields_empty() {
        let a = flat_grid(0.0);
        let b = flat_grid(10.0);
        let result = intersect_bezier_pair(&a, &b, 1e-3);
        assert!(result.is_empty());
    }

    #[test]
    fn pipeline_perpendicular_planar_patches_produces_chain() {
        // Two perpendicular planar patches → expect ≥1 chain along intersection line.
        let a = flat_grid(0.0);
        // Vertical patch at y=0.5
        let mut b = vec![vec![DVec3::ZERO; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let u = i as f64 / 2.0;
                let v = j as f64 / 2.0;
                b[i][j] = DVec3::new(u, 0.5, v - 0.5);
            }
        }
        let result = intersect_bezier_pair(&a, &b, 0.05);
        assert!(!result.is_empty(), "expected at least one chain");
        // All chain points should lie near y=0.5, z=0.
        for chain in &result {
            for p in &chain.points {
                assert!((p.y - 0.5).abs() < 0.05, "y={} not near 0.5", p.y);
                assert!(p.z.abs() < 0.05, "z={} not near 0", p.z);
            }
        }
    }
}
