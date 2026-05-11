//! ADR-055 Phase J Step 1 — Trim Loop Geometry Primitives.
//!
//! Foundational 2D operations on `TrimLoop` (parameter-space loops),
//! required by all subsequent Phase J steps:
//!   - Step 2 (Boolean): needs intersection + containment tests
//!   - Step 3 (Containment Tree): needs point_in_loop + signed_area
//!   - Step 4 (SSI Robustness): needs orientation classification
//!   - Step 5 (nurbs_boolean_v2): needs all of the above
//!
//! All operations are curve-aware (work on `TrimCurve2D` variants directly,
//! not just polyline approximations). Adaptive tessellation is used where
//! polyline math is the only practical option (e.g., point-in-loop via
//! winding number on tessellated polyline within `chord_tol`).

use super::super::trim::{TrimCurve2D, TrimLoop};

/// Default chord tolerance for tessellation-based primitives (in
/// parameter-space units). Loose enough to keep curve sample count low
/// for typical NURBS surface UV ranges (~[0,1]² normalized).
pub const DEFAULT_CHORD_TOL: f64 = 1e-3;

/// Loop geometric orientation derived from signed area.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopOrientation {
    /// CCW — positive signed area; conventional outer boundary
    Ccw,
    /// CW — negative signed area; conventional hole / inner cutout
    Cw,
    /// Zero (or near-zero within tol) signed area — degenerate
    Degenerate,
}

// ────────────────────────────────────────────────────────────────────
// Tessellation helper (curve-aware → polyline)
// ────────────────────────────────────────────────────────────────────

/// Tessellate every curve in the loop into a single polyline (start of
/// each curve = end of previous, no duplicates). Uses each curve's own
/// tessellate(N) method — sample count derives from `chord_tol` heuristic.
///
/// MVP: uses fixed sample count per curve (32). Phase J Step 5 may upgrade
/// to true adaptive based on `chord_tol`.
pub fn tessellate_loop(loop_: &TrimLoop, _chord_tol: f64) -> Vec<[f64; 2]> {
    const SAMPLES_PER_CURVE: usize = 32;
    let mut out: Vec<[f64; 2]> = Vec::new();
    for curve in &loop_.curves {
        let pts = curve.tessellate(SAMPLES_PER_CURVE);
        if out.is_empty() {
            out.extend_from_slice(&pts);
        } else {
            // Skip first point of subsequent curves (duplicates previous end)
            out.extend_from_slice(&pts[1..]);
        }
    }
    out
}

// ────────────────────────────────────────────────────────────────────
// Point-in-loop (winding number, curve-aware via tessellation)
// ────────────────────────────────────────────────────────────────────

/// Test whether the 2D point `p` lies inside the trim loop.
///
/// Uses the winding-number algorithm on the tessellated polyline.
/// Boundary points within `tol` are treated as "inside" (conservative
/// inclusion).
pub fn point_in_trim_loop(p: [f64; 2], loop_: &TrimLoop, tol: f64) -> bool {
    let poly = tessellate_loop(loop_, tol);
    if poly.len() < 3 { return false; }

    // Boundary check first (any segment within tol)
    for w in poly.windows(2) {
        if point_segment_distance(p, w[0], w[1]) < tol {
            return true;
        }
    }

    // Winding number via crossing count (ray to +X)
    let mut crossings = 0i32;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if (yi > p[1]) != (yj > p[1]) {
            let x_cross = (xj - xi) * (p[1] - yi) / (yj - yi + 1e-30) + xi;
            if p[0] < x_cross { crossings += 1; }
        }
        j = i;
    }
    (crossings & 1) == 1
}

/// Distance from point to line segment (2D).
fn point_segment_distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let abx = b[0] - a[0];
    let aby = b[1] - a[1];
    let apx = p[0] - a[0];
    let apy = p[1] - a[1];
    let len_sq = abx * abx + aby * aby;
    if len_sq < 1e-30 {
        return (apx * apx + apy * apy).sqrt();
    }
    let t = ((apx * abx + apy * aby) / len_sq).clamp(0.0, 1.0);
    let cx = a[0] + t * abx;
    let cy = a[1] + t * aby;
    let dx = p[0] - cx;
    let dy = p[1] - cy;
    (dx * dx + dy * dy).sqrt()
}

// ────────────────────────────────────────────────────────────────────
// Signed area (shoelace on tessellated polyline)
// ────────────────────────────────────────────────────────────────────

/// Compute signed area of the trim loop. Positive = CCW (outer),
/// negative = CW (hole), 0 = degenerate.
pub fn trim_loop_signed_area(loop_: &TrimLoop, chord_tol: f64) -> f64 {
    let poly = tessellate_loop(loop_, chord_tol);
    if poly.len() < 3 { return 0.0; }
    let n = poly.len();
    let mut sum = 0.0_f64;
    for i in 0..n {
        let j = (i + 1) % n;
        sum += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    sum * 0.5
}

// ────────────────────────────────────────────────────────────────────
// Bounding box
// ────────────────────────────────────────────────────────────────────

/// Axis-aligned bounding box of trim loop in (u, v) space.
/// Returns (min, max). For empty loops returns ([+inf, +inf], [-inf, -inf]).
pub fn trim_loop_bbox(loop_: &TrimLoop) -> ([f64; 2], [f64; 2]) {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for curve in &loop_.curves {
        // Use a few samples per curve to capture extents; analytic bbox per
        // variant is a Phase L optimization.
        let pts = curve.tessellate(16);
        for p in &pts {
            if p[0] < lo[0] { lo[0] = p[0]; }
            if p[1] < lo[1] { lo[1] = p[1]; }
            if p[0] > hi[0] { hi[0] = p[0]; }
            if p[1] > hi[1] { hi[1] = p[1]; }
        }
    }
    (lo, hi)
}

// ────────────────────────────────────────────────────────────────────
// Orientation
// ────────────────────────────────────────────────────────────────────

/// Classify the orientation from signed area. Loops below `area_tol`
/// (in parameter-space units²) are reported as `Degenerate`.
pub fn trim_loop_orientation(loop_: &TrimLoop, chord_tol: f64) -> LoopOrientation {
    let area_tol = chord_tol * chord_tol;
    let sa = trim_loop_signed_area(loop_, chord_tol);
    if sa.abs() < area_tol { LoopOrientation::Degenerate }
    else if sa > 0.0       { LoopOrientation::Ccw }
    else                   { LoopOrientation::Cw }
}

// ────────────────────────────────────────────────────────────────────
// Reverse loop (curve-by-curve + curves order reversed)
// ────────────────────────────────────────────────────────────────────

/// Return a new loop with reversed orientation. Each curve's parameter
/// direction is also flipped so the polyline traverses in the opposite
/// direction.
pub fn reverse_trim_loop(loop_: TrimLoop) -> TrimLoop {
    let curves: Vec<TrimCurve2D> = loop_.curves.into_iter()
        .rev()
        .map(reverse_trim_curve)
        .collect();
    TrimLoop {
        curves,
        is_outer: !loop_.is_outer,  // outer ↔ hole role flips
    }
}

fn reverse_trim_curve(c: TrimCurve2D) -> TrimCurve2D {
    match c {
        TrimCurve2D::Line { a, b } => TrimCurve2D::Line { a: b, b: a },
        TrimCurve2D::Arc {
            center, radius, start_angle, end_angle,
        } => TrimCurve2D::Arc {
            center, radius,
            start_angle: end_angle,
            end_angle:   start_angle,
        },
        TrimCurve2D::Bezier { mut control_pts } => {
            control_pts.reverse();
            TrimCurve2D::Bezier { control_pts }
        }
        TrimCurve2D::BSpline { mut control_pts, knots, degree } => {
            // Reverse control points + reverse knot vector arithmetic
            // (k_i' = (k_max + k_min) - k_{m-i}).
            control_pts.reverse();
            let k_min = *knots.first().unwrap_or(&0.0);
            let k_max = *knots.last().unwrap_or(&1.0);
            let new_knots: Vec<f64> = knots.iter().rev()
                .map(|&k| (k_max + k_min) - k)
                .collect();
            TrimCurve2D::BSpline { control_pts, knots: new_knots, degree }
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests (8 — ADR-055 §2.7 #1-#8)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_square_ccw(side: f64) -> TrimLoop {
        TrimLoop {
            curves: vec![
                TrimCurve2D::Line { a: [0.0, 0.0],  b: [side, 0.0]  },
                TrimCurve2D::Line { a: [side, 0.0], b: [side, side] },
                TrimCurve2D::Line { a: [side, side], b: [0.0, side] },
                TrimCurve2D::Line { a: [0.0, side], b: [0.0, 0.0]   },
            ],
            is_outer: true,
        }
    }

    fn make_square_cw(side: f64) -> TrimLoop {
        TrimLoop {
            curves: vec![
                TrimCurve2D::Line { a: [0.0, 0.0],  b: [0.0, side]  },
                TrimCurve2D::Line { a: [0.0, side], b: [side, side] },
                TrimCurve2D::Line { a: [side, side], b: [side, 0.0] },
                TrimCurve2D::Line { a: [side, 0.0], b: [0.0, 0.0]   },
            ],
            is_outer: false,
        }
    }

    /// ADR-055 §2.7 #1 — Point inside simple square.
    #[test]
    fn point_in_simple_square_loop() {
        let loop_ = make_square_ccw(10.0);
        assert!(point_in_trim_loop([5.0, 5.0], &loop_, 1e-6),
            "center should be inside");
        assert!(!point_in_trim_loop([15.0, 5.0], &loop_, 1e-6),
            "outside in +x");
        assert!(!point_in_trim_loop([-1.0, 5.0], &loop_, 1e-6),
            "outside in -x");
    }

    /// ADR-055 §2.7 #2 — Point inside loop with hole semantics
    /// (outer test only — actual hole subtraction is Step 2).
    #[test]
    fn point_in_loop_with_hole() {
        let outer = make_square_ccw(10.0);
        // For Step 1 we just verify outer test works; combined with
        // Step 3 containment we'll subtract holes.
        assert!(point_in_trim_loop([5.0, 5.0], &outer, 1e-6));
        // A point at the corner of the inner hole (3,3) should still test
        // INSIDE the outer loop at this stage.
        assert!(point_in_trim_loop([3.0, 3.0], &outer, 1e-6));
    }

    /// ADR-055 §2.7 #3 — CCW signed area is positive.
    #[test]
    fn signed_area_ccw_positive() {
        let loop_ = make_square_ccw(4.0);
        let area = trim_loop_signed_area(&loop_, 1e-3);
        assert!(area > 0.0, "CCW area should be > 0, got {}", area);
        // Square 4×4 = 16 ± tessellation noise (lines are exact)
        assert!((area - 16.0).abs() < 1e-9, "expected 16, got {}", area);
    }

    /// ADR-055 §2.7 #4 — CW signed area is negative.
    #[test]
    fn signed_area_cw_negative() {
        let loop_ = make_square_cw(4.0);
        let area = trim_loop_signed_area(&loop_, 1e-3);
        assert!(area < 0.0, "CW area should be < 0, got {}", area);
        assert!((area + 16.0).abs() < 1e-9, "expected -16, got {}", area);
    }

    /// ADR-055 §2.7 #5 — Bounding box of arc loop.
    #[test]
    fn bbox_arc_loop() {
        // Quarter-circle arc + closing line (radius 5 centered at origin)
        let loop_ = TrimLoop {
            curves: vec![
                TrimCurve2D::Arc {
                    center: [0.0, 0.0], radius: 5.0,
                    start_angle: 0.0,
                    end_angle: std::f64::consts::FRAC_PI_2,
                },
                TrimCurve2D::Line { a: [0.0, 5.0], b: [5.0, 0.0] },
            ],
            is_outer: true,
        };
        let (lo, hi) = trim_loop_bbox(&loop_);
        // Tessellated arc reaches very close to (5,0) and (0,5)
        assert!(lo[0] >= -0.01 && lo[0] < 0.5);
        assert!(lo[1] >= -0.01 && lo[1] < 0.5);
        assert!((hi[0] - 5.0).abs() < 0.05);
        assert!((hi[1] - 5.0).abs() < 0.05);
    }

    /// ADR-055 §2.7 #6 — Degenerate (zero area) reported as Degenerate.
    #[test]
    fn orientation_degenerate_zero_area() {
        // Collapsed loop: all points at one location
        let loop_ = TrimLoop {
            curves: vec![
                TrimCurve2D::Line { a: [3.0, 3.0], b: [3.0, 3.0] },
                TrimCurve2D::Line { a: [3.0, 3.0], b: [3.0, 3.0] },
            ],
            is_outer: true,
        };
        assert_eq!(trim_loop_orientation(&loop_, 1e-3), LoopOrientation::Degenerate);
    }

    /// ADR-055 §2.7 #7 — Reverse flips orientation.
    #[test]
    fn reverse_loop_flips_orientation() {
        let ccw = make_square_ccw(4.0);
        assert_eq!(trim_loop_orientation(&ccw, 1e-3), LoopOrientation::Ccw);
        let reversed = reverse_trim_loop(ccw);
        assert_eq!(trim_loop_orientation(&reversed, 1e-3), LoopOrientation::Cw);
        assert!(!reversed.is_outer, "reverse flips is_outer flag");
    }

    /// ADR-055 §2.7 #8 — Point on boundary (within tol) is reported inside.
    #[test]
    fn point_on_boundary_within_tol() {
        let loop_ = make_square_ccw(10.0);
        // Exactly on the bottom edge
        assert!(point_in_trim_loop([5.0, 0.0], &loop_, 1e-6),
            "point on bottom edge (within tol) should be inside");
        // Just inside via tol
        assert!(point_in_trim_loop([5.0, 0.0001], &loop_, 1e-6));
    }
}
