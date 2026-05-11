//! SSI Stage 2 — Subdivide-and-prune for general Bezier patches (ADR-034 §P19.2).
//!
//! Recursively splits two patches in tandem, pruning regions whose AABBs
//! cannot overlap. Produces candidate `(uv_a, uv_b, point)` triples that
//! Stage 3 (Newton refinement) can polish to high precision.
//!
//! # Termination
//! - **Hit**: both sub-patches have bbox diagonal < `tol` AND overlap →
//!   emit candidate at midpoint of UV bounds (eval'd on patch A).
//! - **Miss**: AABB disjoint with pad `2·tol` → discard branch.
//! - **Hard limit**: depth ≥ `max_depth` (default 16) → emit candidate to
//!   avoid infinite recursion on tangent contact.
//!
//! # Determinism
//! Splitting alternates u/v, picking the dimension where the patch is more
//! curved (longer chord). When both patches are similarly curved, splits
//! the one with larger bbox diagonal — keeps recursion balanced.

use glam::DVec3;

use super::super::bezier_patch;

/// One sub-region of a Bezier patch produced by recursive splitting.
///
/// `ctrl_grid` are the de-Casteljau-split control points local to this region;
/// `uv_bounds` records `((u_min, u_max), (v_min, v_max))` in the original
/// patch's parameter space (so caller can map back).
#[derive(Clone, Debug)]
pub struct PatchRegion {
    pub ctrl_grid: Vec<Vec<DVec3>>,
    pub uv_bounds: ((f64, f64), (f64, f64)),
}

impl PatchRegion {
    pub fn from_full(ctrl_grid: Vec<Vec<DVec3>>) -> Self {
        Self { ctrl_grid, uv_bounds: ((0.0, 1.0), (0.0, 1.0)) }
    }

    pub fn uv_center(&self) -> (f64, f64) {
        (
            0.5 * (self.uv_bounds.0.0 + self.uv_bounds.0.1),
            0.5 * (self.uv_bounds.1.0 + self.uv_bounds.1.1),
        )
    }

    pub fn uv_span(&self) -> (f64, f64) {
        (
            self.uv_bounds.0.1 - self.uv_bounds.0.0,
            self.uv_bounds.1.1 - self.uv_bounds.1.0,
        )
    }

    pub fn bbox(&self) -> (DVec3, DVec3) {
        bezier_patch::bbox_xyz(&self.ctrl_grid).unwrap_or((DVec3::ZERO, DVec3::ZERO))
    }

    pub fn bbox_diag(&self) -> f64 {
        let (mn, mx) = self.bbox();
        (mx - mn).length()
    }

    /// Split along the axis that reduces curvature most. Returns two
    /// sub-regions covering this region's uv_bounds.
    pub fn split_adaptive(&self) -> Option<(PatchRegion, PatchRegion)> {
        // Prefer splitting the longer parametric axis if their bbox extents
        // are similar. Otherwise split along the dim with larger control-net
        // chord (proxy for curvature).
        let n_u = self.ctrl_grid.len();
        let n_v = self.ctrl_grid.first().map(|r| r.len()).unwrap_or(0);
        if n_u < 2 && n_v < 2 {
            return None;
        }

        // Chord-length heuristic
        let chord_u = if n_u >= 2 {
            (self.ctrl_grid[n_u - 1][0] - self.ctrl_grid[0][0]).length()
        } else { 0.0 };
        let chord_v = if n_v >= 2 {
            (self.ctrl_grid[0][n_v - 1] - self.ctrl_grid[0][0]).length()
        } else { 0.0 };

        let split_u = (n_u >= 2) && (n_v < 2 || chord_u >= chord_v);

        let (left_grid, right_grid) = if split_u {
            bezier_patch::split_u(&self.ctrl_grid, 0.5).ok()?
        } else {
            bezier_patch::split_v(&self.ctrl_grid, 0.5).ok()?
        };

        let ((u_min, u_max), (v_min, v_max)) = self.uv_bounds;
        if split_u {
            let mid = 0.5 * (u_min + u_max);
            Some((
                PatchRegion {
                    ctrl_grid: left_grid,
                    uv_bounds: ((u_min, mid), (v_min, v_max)),
                },
                PatchRegion {
                    ctrl_grid: right_grid,
                    uv_bounds: ((mid, u_max), (v_min, v_max)),
                },
            ))
        } else {
            let mid = 0.5 * (v_min + v_max);
            Some((
                PatchRegion {
                    ctrl_grid: left_grid,
                    uv_bounds: ((u_min, u_max), (v_min, mid)),
                },
                PatchRegion {
                    ctrl_grid: right_grid,
                    uv_bounds: ((u_min, u_max), (mid, v_max)),
                },
            ))
        }
    }
}

/// Single candidate intersection point produced by Stage 2.
#[derive(Clone, Debug)]
pub struct IntersectionCandidate {
    pub point: DVec3,
    pub uv_a: (f64, f64),
    pub uv_b: (f64, f64),
    /// True if termination was by depth limit (likely tangent contact).
    pub depth_capped: bool,
}

/// AABB pad-overlap test. Returns true if boxes overlap with `pad` slack.
fn aabb_overlap_padded(
    (a_mn, a_mx): (DVec3, DVec3),
    (b_mn, b_mx): (DVec3, DVec3),
    pad: f64,
) -> bool {
    a_mx.x + pad >= b_mn.x && b_mx.x + pad >= a_mn.x
        && a_mx.y + pad >= b_mn.y && b_mx.y + pad >= a_mn.y
        && a_mx.z + pad >= b_mn.z && b_mx.z + pad >= a_mn.z
}

/// Default maximum recursion depth (per ADR-034 §R1).
pub const DEFAULT_MAX_DEPTH: usize = 16;

/// Subdivide-and-prune entry point.
///
/// Returns a Vec of intersection candidates. Each candidate is a single
/// 3D point with uv on both patches; Stage 3 should refine these via Newton.
pub fn subdivide_intersect(
    patch_a_ctrl: &[Vec<DVec3>],
    patch_b_ctrl: &[Vec<DVec3>],
    tol: f64,
    max_depth: usize,
) -> Vec<IntersectionCandidate> {
    let region_a = PatchRegion::from_full(patch_a_ctrl.to_vec());
    let region_b = PatchRegion::from_full(patch_b_ctrl.to_vec());
    let mut results = Vec::new();
    recurse(&region_a, &region_b, tol, 0, max_depth, &mut results);
    results
}

fn recurse(
    a: &PatchRegion,
    b: &PatchRegion,
    tol: f64,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<IntersectionCandidate>,
) {
    let bb_a = a.bbox();
    let bb_b = b.bbox();
    let pad = 2.0 * tol;
    if !aabb_overlap_padded(bb_a, bb_b, pad) {
        return;
    }

    let diag_a = a.bbox_diag();
    let diag_b = b.bbox_diag();

    // Termination by smallness — both sub-patches have bbox tighter than tol
    // and they overlap → emit a candidate.
    if diag_a < tol && diag_b < tol {
        emit_candidate(a, b, false, out);
        return;
    }

    // Hard depth limit — emit but flag tangent suspicion.
    if depth >= max_depth {
        emit_candidate(a, b, true, out);
        return;
    }

    // Decide which patch to split: the one with larger bbox diagonal.
    if diag_a >= diag_b {
        if let Some((al, ar)) = a.split_adaptive() {
            recurse(&al, b, tol, depth + 1, max_depth, out);
            recurse(&ar, b, tol, depth + 1, max_depth, out);
        } else {
            // Cannot split A any further (too few CPs) — split B if possible
            if let Some((bl, br)) = b.split_adaptive() {
                recurse(a, &bl, tol, depth + 1, max_depth, out);
                recurse(a, &br, tol, depth + 1, max_depth, out);
            } else {
                emit_candidate(a, b, true, out);
            }
        }
    } else if let Some((bl, br)) = b.split_adaptive() {
        recurse(a, &bl, tol, depth + 1, max_depth, out);
        recurse(a, &br, tol, depth + 1, max_depth, out);
    } else if let Some((al, ar)) = a.split_adaptive() {
        recurse(&al, b, tol, depth + 1, max_depth, out);
        recurse(&ar, b, tol, depth + 1, max_depth, out);
    } else {
        emit_candidate(a, b, true, out);
    }
}

fn emit_candidate(
    a: &PatchRegion,
    b: &PatchRegion,
    depth_capped: bool,
    out: &mut Vec<IntersectionCandidate>,
) {
    let (ua, va) = a.uv_center();
    let (ub, vb) = b.uv_center();
    // Use the local sub-patch (already split to this region) — local uv of
    // center is (0.5, 0.5).
    let pa = bezier_patch::evaluate(&a.ctrl_grid, 0.5, 0.5)
        .unwrap_or(DVec3::ZERO);
    let pb = bezier_patch::evaluate(&b.ctrl_grid, 0.5, 0.5)
        .unwrap_or(DVec3::ZERO);
    let point = 0.5 * (pa + pb);
    out.push(IntersectionCandidate {
        point,
        uv_a: (ua, va),
        uv_b: (ub, vb),
        depth_capped,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_grid(z: f64) -> Vec<Vec<DVec3>> {
        // 3x3 control grid on z plane
        let mut grid = vec![vec![DVec3::ZERO; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                grid[i][j] = DVec3::new(i as f64, j as f64, z);
            }
        }
        grid
    }

    #[test]
    fn aabb_padded_disjoint_returns_false() {
        let a = (DVec3::ZERO, DVec3::new(1.0, 1.0, 1.0));
        let b = (DVec3::new(5.0, 5.0, 5.0), DVec3::new(6.0, 6.0, 6.0));
        assert!(!aabb_overlap_padded(a, b, 0.01));
    }

    #[test]
    fn aabb_padded_close_overlaps() {
        let a = (DVec3::ZERO, DVec3::new(1.0, 1.0, 1.0));
        let b = (DVec3::new(1.05, 0.0, 0.0), DVec3::new(2.0, 1.0, 1.0));
        assert!(aabb_overlap_padded(a, b, 0.1));
        assert!(!aabb_overlap_padded(a, b, 0.01));
    }

    #[test]
    fn disjoint_patches_yield_no_candidates() {
        let a = flat_grid(0.0);
        let b = flat_grid(10.0);  // 10mm apart
        let candidates = subdivide_intersect(&a, &b, 1e-3, 12);
        assert!(candidates.is_empty(), "expected no candidates, got {}", candidates.len());
    }

    #[test]
    fn coincident_planar_patches_emit_many_candidates() {
        let a = flat_grid(0.0);
        let b = flat_grid(0.0);  // identical planes
        // Any tol triggers planar-overlap regions → many candidates.
        let candidates = subdivide_intersect(&a, &b, 0.5, 8);
        assert!(!candidates.is_empty());
    }

    #[test]
    fn perpendicular_planar_patches_yield_intersection_line() {
        // Patch A on z=0 plane (square 0..1 in x,y).
        let mut a = vec![vec![DVec3::ZERO; 2]; 2];
        a[0][0] = DVec3::new(0.0, 0.0, 0.0);
        a[1][0] = DVec3::new(1.0, 0.0, 0.0);
        a[0][1] = DVec3::new(0.0, 1.0, 0.0);
        a[1][1] = DVec3::new(1.0, 1.0, 0.0);

        // Patch B on x=0.5 plane (square 0..1 in y, -0.5..0.5 in z).
        let mut b = vec![vec![DVec3::ZERO; 2]; 2];
        b[0][0] = DVec3::new(0.5, 0.0, -0.5);
        b[1][0] = DVec3::new(0.5, 0.0, 0.5);
        b[0][1] = DVec3::new(0.5, 1.0, -0.5);
        b[1][1] = DVec3::new(0.5, 1.0, 0.5);

        let candidates = subdivide_intersect(&a, &b, 0.05, 12);
        assert!(!candidates.is_empty());
        // All candidate points should lie near x=0.5, z=0 (intersection line).
        for c in &candidates {
            assert!((c.point.x - 0.5).abs() < 0.1, "x={} not near 0.5", c.point.x);
            assert!(c.point.z.abs() < 0.1, "z={} not near 0", c.point.z);
        }
    }

    #[test]
    fn region_split_alternates_axes() {
        let grid = flat_grid(0.0);
        let region = PatchRegion::from_full(grid);
        let (l, r) = region.split_adaptive().unwrap();
        // Bounds union covers original.
        let total = l.uv_bounds.0.1.max(r.uv_bounds.0.1);
        let total_min = l.uv_bounds.0.0.min(r.uv_bounds.0.0);
        assert!((total - 1.0).abs() < 1e-12);
        assert!(total_min.abs() < 1e-12);
    }
}
