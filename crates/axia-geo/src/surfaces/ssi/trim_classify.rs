//! ADR-055 Phase J Step 3 — Multi-loop Containment Tree.
//!
//! Given N trim loops on the same surface, compute a containment tree:
//!   root      = "infinite outside" of the surface's parameter domain
//!   level 0   = outer loops (CCW conventional, no enclosing loop)
//!   level 1   = holes inside outer loops (CW)
//!   level 2   = nested outers inside holes (CCW again)
//!   ...
//!
//! `is_outer` for any loop is determined by depth parity: `depth % 2 == 0`.
//! This subsumes the manual `TrimLoop::is_outer` flag from Phase E (which
//! Phase J Step 5's `nurbs_boolean_v2` will overwrite based on the tree).

use super::super::trim::TrimLoop;
use super::trim_geom::{point_in_trim_loop, trim_loop_signed_area, DEFAULT_CHORD_TOL};

/// One node in the containment tree.
#[derive(Clone, Debug)]
pub struct ContainmentNode {
    /// Index into the input `loops` slice.
    pub loop_index: usize,
    /// Depth in the tree: 0 = outermost loop, 1 = hole, 2 = nested outer, ...
    pub depth: usize,
    /// Computed orientation: depth even → outer (CCW), depth odd → hole (CW).
    /// Equivalent to `depth % 2 == 0`.
    pub is_outer: bool,
    /// Index into `nodes` (None for top-level outer loops).
    pub parent: Option<usize>,
    /// Indices into `nodes` (immediate children only, not transitive).
    pub children: Vec<usize>,
}

/// Containment tree for a set of coplanar trim loops.
#[derive(Clone, Debug)]
pub struct ContainmentTree {
    pub nodes: Vec<ContainmentNode>,
    /// Indices of top-level (depth 0) outer loops.
    pub roots: Vec<usize>,
}

impl ContainmentTree {
    /// Empty tree (no loops).
    pub fn empty() -> Self {
        Self { nodes: Vec::new(), roots: Vec::new() }
    }

    /// Total node count.
    pub fn len(&self) -> usize { self.nodes.len() }
    pub fn is_empty(&self) -> bool { self.nodes.is_empty() }

    /// Walk all descendants of `node_idx` (not including node itself).
    pub fn descendants(&self, node_idx: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack: Vec<usize> = self.nodes[node_idx].children.clone();
        while let Some(idx) = stack.pop() {
            out.push(idx);
            for &c in &self.nodes[idx].children { stack.push(c); }
        }
        out
    }

    /// Maximum depth in the tree (0 if empty).
    pub fn max_depth(&self) -> usize {
        self.nodes.iter().map(|n| n.depth).max().unwrap_or(0)
    }
}

// ────────────────────────────────────────────────────────────────────
// Build algorithm
// ────────────────────────────────────────────────────────────────────

/// A representative boundary point per loop — used as a probe for
/// point-in-loop tests against OTHER loops. We choose the start point
/// of the first curve so that:
///   1. Probe ∈ self (boundary, treated as inside by tol)
///   2. Probe is generally NOT on or inside loops that this loop encloses
///      (since enclosed loops are spatially separated from `self`'s vertex)
/// This avoids the centroid-collision cycle when concentric loops share
/// their bbox center.
fn loop_probe_point(loop_: &TrimLoop) -> [f64; 2] {
    use super::super::trim::TrimCurve2D;
    if let Some(first) = loop_.curves.first() {
        match first {
            TrimCurve2D::Line { a, .. } => *a,
            TrimCurve2D::Arc { center, radius, start_angle, .. } => [
                center[0] + radius * start_angle.cos(),
                center[1] + radius * start_angle.sin(),
            ],
            TrimCurve2D::Bezier { control_pts } => {
                control_pts.first().copied().unwrap_or([0.0, 0.0])
            }
            TrimCurve2D::BSpline { control_pts, .. } => {
                control_pts.first().copied().unwrap_or([0.0, 0.0])
            }
        }
    } else {
        [0.0, 0.0]
    }
}

/// Build a containment tree from a slice of trim loops.
///
/// Algorithm:
///   1. For each pair (i, j), determine whether loop i contains loop j by
///      testing j's probe point against i's geometry.
///   2. Each loop's parent = the immediately-enclosing loop (smallest
///      enclosing by signed area magnitude).
///   3. Depth = walk to root + 1.
///   4. is_outer = (depth % 2 == 0).
///
/// Complexity O(N²) — acceptable for typical trim loop counts (< 100).
pub fn build_containment_tree(loops: &[TrimLoop], tol: f64) -> ContainmentTree {
    let n = loops.len();
    if n == 0 { return ContainmentTree::empty(); }

    // 1. Pre-compute probe points + areas
    let probes: Vec<[f64; 2]> = loops.iter().map(loop_probe_point).collect();
    let areas: Vec<f64> = loops.iter()
        .map(|l| trim_loop_signed_area(l, DEFAULT_CHORD_TOL).abs())
        .collect();

    // 2. For each loop j, find candidate enclosers (loops i where probe j ∈ i)
    //    and pick the smallest (by area) as parent.
    let mut parents: Vec<Option<usize>> = vec![None; n];
    for j in 0..n {
        let mut best: Option<usize> = None;
        let mut best_area = f64::INFINITY;
        for i in 0..n {
            if i == j { continue; }
            if point_in_trim_loop(probes[j], &loops[i], tol) {
                if areas[i] < best_area {
                    best = Some(i);
                    best_area = areas[i];
                }
            }
        }
        parents[j] = best;
    }

    // 3. Compute depth via iterative walk-to-root (with cycle guard, just in case)
    let mut depths: Vec<usize> = vec![0; n];
    for j in 0..n {
        let mut depth = 0usize;
        let mut cur = parents[j];
        let mut guard = 0usize;
        while let Some(p) = cur {
            depth += 1;
            cur = parents[p];
            guard += 1;
            if guard > n + 4 { break; }  // cycle safety
        }
        depths[j] = depth;
    }

    // 4. Build nodes
    let mut nodes: Vec<ContainmentNode> = (0..n).map(|i| ContainmentNode {
        loop_index: i,
        depth: depths[i],
        is_outer: depths[i] % 2 == 0,
        parent: parents[i],
        children: Vec::new(),
    }).collect();

    // 5. Populate children
    for (j, p_opt) in parents.iter().enumerate() {
        if let Some(p) = p_opt {
            nodes[*p].children.push(j);
        }
    }

    // 6. Roots = nodes with no parent
    let roots: Vec<usize> = (0..n).filter(|&i| parents[i].is_none()).collect();

    ContainmentTree { nodes, roots }
}

// ────────────────────────────────────────────────────────────────────
// Tests (6 — ADR-055 §2.7 #19-#24)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::trim::{TrimCurve2D, TrimLoop};

    fn axis_aligned_square(x: f64, y: f64, side: f64, ccw: bool) -> TrimLoop {
        let pts = if ccw {
            // CCW order in (u, v): (x,y) → (x+s, y) → (x+s, y+s) → (x, y+s)
            [[x, y], [x + side, y], [x + side, y + side], [x, y + side]]
        } else {
            [[x, y], [x, y + side], [x + side, y + side], [x + side, y]]
        };
        let curves = (0..4).map(|i| TrimCurve2D::Line {
            a: pts[i],
            b: pts[(i + 1) % 4],
        }).collect();
        TrimLoop { curves, is_outer: ccw }
    }

    /// ADR-055 §2.7 #19 — Single outer loop forms a single-node tree.
    #[test]
    fn single_outer_loop_tree() {
        let loops = vec![axis_aligned_square(0.0, 0.0, 10.0, true)];
        let tree = build_containment_tree(&loops, 1e-6);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree.roots, vec![0]);
        assert_eq!(tree.nodes[0].depth, 0);
        assert!(tree.nodes[0].is_outer);
        assert!(tree.nodes[0].parent.is_none());
    }

    /// ADR-055 §2.7 #20 — Outer with one hole inside.
    #[test]
    fn outer_with_one_hole() {
        let loops = vec![
            axis_aligned_square(0.0, 0.0, 10.0, true),  // outer
            axis_aligned_square(3.0, 3.0, 4.0, false),  // hole
        ];
        let tree = build_containment_tree(&loops, 1e-6);
        assert_eq!(tree.len(), 2);
        assert_eq!(tree.roots, vec![0]);
        assert_eq!(tree.nodes[0].depth, 0);
        assert!(tree.nodes[0].is_outer);
        assert_eq!(tree.nodes[0].children, vec![1]);
        assert_eq!(tree.nodes[1].depth, 1);
        assert!(!tree.nodes[1].is_outer, "hole should be marked is_outer=false");
        assert_eq!(tree.nodes[1].parent, Some(0));
    }

    /// ADR-055 §2.7 #21 — Outer → hole → nested outer (3-level depth).
    #[test]
    fn outer_with_nested_outer_inside_hole() {
        let loops = vec![
            axis_aligned_square(0.0, 0.0, 20.0, true),  // outermost
            axis_aligned_square(4.0, 4.0, 12.0, false), // hole
            axis_aligned_square(8.0, 8.0, 4.0, true),   // nested outer
        ];
        let tree = build_containment_tree(&loops, 1e-6);
        assert_eq!(tree.len(), 3);
        assert_eq!(tree.roots, vec![0]);
        assert_eq!(tree.nodes[0].depth, 0); // outer
        assert_eq!(tree.nodes[1].depth, 1); // hole
        assert_eq!(tree.nodes[2].depth, 2); // nested outer
        assert!(tree.nodes[0].is_outer);
        assert!(!tree.nodes[1].is_outer);
        assert!(tree.nodes[2].is_outer);
        assert_eq!(tree.max_depth(), 2);
    }

    /// ADR-055 §2.7 #22 — Two disjoint outers form two roots.
    #[test]
    fn disjoint_two_outers() {
        let loops = vec![
            axis_aligned_square(0.0, 0.0, 5.0, true),
            axis_aligned_square(20.0, 20.0, 5.0, true),
        ];
        let tree = build_containment_tree(&loops, 1e-6);
        assert_eq!(tree.len(), 2);
        assert_eq!(tree.roots.len(), 2);
        assert_eq!(tree.nodes[0].depth, 0);
        assert_eq!(tree.nodes[1].depth, 0);
    }

    /// ADR-055 §2.7 #23 — One outer with two disjoint holes.
    #[test]
    fn multiple_holes_in_one_outer() {
        let loops = vec![
            axis_aligned_square(0.0, 0.0, 20.0, true),  // outer
            axis_aligned_square(2.0, 2.0, 4.0, false),  // hole 1
            axis_aligned_square(12.0, 12.0, 4.0, false),// hole 2
        ];
        let tree = build_containment_tree(&loops, 1e-6);
        assert_eq!(tree.len(), 3);
        assert_eq!(tree.roots, vec![0]);
        assert_eq!(tree.nodes[0].children.len(), 2);
        assert_eq!(tree.nodes[1].depth, 1);
        assert_eq!(tree.nodes[2].depth, 1);
        assert!(!tree.nodes[1].is_outer);
        assert!(!tree.nodes[2].is_outer);
    }

    /// ADR-055 §2.7 #24 — Containment with curved (Arc) loops.
    #[test]
    fn containment_with_curved_loops() {
        // Outer: square 20x20, Hole: full circle radius 3 at center
        let outer = axis_aligned_square(0.0, 0.0, 20.0, true);
        let circle = TrimLoop {
            curves: vec![TrimCurve2D::Arc {
                center: [10.0, 10.0], radius: 3.0,
                start_angle: 0.0,
                end_angle: std::f64::consts::TAU,
            }],
            is_outer: false,
        };
        let loops = vec![outer, circle];
        let tree = build_containment_tree(&loops, 1e-3);
        assert_eq!(tree.len(), 2);
        assert_eq!(tree.roots, vec![0]);
        assert_eq!(tree.nodes[1].depth, 1);
        assert!(!tree.nodes[1].is_outer);
    }
}
