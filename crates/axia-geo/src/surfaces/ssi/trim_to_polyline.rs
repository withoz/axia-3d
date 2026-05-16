//! ADR-064 Step 1 — Trim curve → 3D polyline conversion infrastructure.
//!
//! Converts `TrimLoop` (surface UV space, output of Phase J
//! nurbs_boolean_v2) to a sequence of 3D world-space points suitable for
//! DCEL face boundary construction.
//!
//! Per ADR-064 §C #1 lock-in: this module produces ONLY 3D polylines;
//! actual DCEL face creation (Step 2) and mesh integration (Steps 3-5)
//! are separate ADRs.
//!
//! Per §C #2 drop-in alongside: existing boolean.rs (mesh path)
//! UNCHANGED. New API surface only.
//!
//! Per §C #3: vertex dedup via existing `add_vertex` spatial-hash
//! (LOCKED #5 1.5μm) — handled by `Mesh::trim_loops_to_dcel_polyline`
//! caller, not in this module.
//!
//! Per §C #4: chord_tol = `HOVER_CHORD_TOL` (0.01mm) by default —
//! single SSOT with ADR-061 §B Z.2 polyline cache.

use glam::DVec3;

use super::super::trim::{TrimCurve2D, TrimLoop};
use super::super::AnalyticSurface;
use super::super::SurfaceOps;

/// ADR-064 Step 1.5 — Disjoint sentinel: empty trim loops → empty polyline.
///
/// When `nurbs_boolean_v2` returns an empty intersection (surfaces
/// don't meet), the resulting trim loops are empty. Caller should
/// detect this and return early without DCEL generation.
pub const DISJOINT_POLYLINE_LEN: usize = 0;

/// ADR-064 Step 1.2 — Sample a 2D trim curve to a polyline at given
/// chord tolerance.
///
/// Variant-specific sampling:
///   - `Line`: exactly 2 points (a, b)
///   - `Arc`: adaptive — `n` segments such that sagitta ≤ chord_tol
///   - `Bezier` / `BSpline`: fixed n=32 (MVP — Step 4 may refine
///     adaptive control-polygon based)
pub fn sample_trim_curve_2d(curve: &TrimCurve2D, chord_tol: f64) -> Vec<[f64; 2]> {
    match curve {
        TrimCurve2D::Line { a, b } => vec![*a, *b],
        TrimCurve2D::Arc { center: _, radius, start_angle, end_angle } => {
            // Sagitta-based segment count: 2 * r * (1 - cos(theta/2)) ≤ chord_tol
            let span = (end_angle - start_angle).abs();
            let r = radius.max(1e-9);
            let max_step_angle = if r * 2.0 <= chord_tol {
                span  // 1 segment OK
            } else {
                2.0 * (1.0 - chord_tol / (2.0 * r)).clamp(-1.0, 1.0).acos()
            };
            let n = if max_step_angle > 1e-9 {
                ((span / max_step_angle).ceil() as usize).max(2)
            } else { 2 };
            let mut out = Vec::with_capacity(n + 1);
            for i in 0..=n {
                let t = i as f64 / n as f64;
                out.push(curve.evaluate(t));
            }
            out
        }
        TrimCurve2D::Bezier { control_pts } => {
            let n = (control_pts.len() * 8).max(16).min(64);
            let mut out = Vec::with_capacity(n + 1);
            for i in 0..=n {
                out.push(curve.evaluate(i as f64 / n as f64));
            }
            out
        }
        TrimCurve2D::BSpline { control_pts, knots, degree } => {
            // Sample uniformly across the parameter range.
            let p = *degree as usize;
            if knots.len() < p + 2 || control_pts.len() < p + 1 {
                return control_pts.clone();
            }
            let t_min = knots[p];
            let t_max = knots[knots.len() - p - 1];
            let n = (control_pts.len() * 8).max(16).min(64);
            let mut out = Vec::with_capacity(n + 1);
            for i in 0..=n {
                let t = t_min + (t_max - t_min) * (i as f64 / n as f64);
                out.push(curve.evaluate(t));
            }
            out
        }
    }
}

/// ADR-064 Step 1.3 — Convert a `TrimLoop` (UV space) to a 3D polyline
/// (world space) by evaluating the host surface at each sampled UV.
///
/// Concatenates all curves' samples, removing duplicate seam points
/// (last point of curve N == first point of curve N+1).
///
/// Returns a sequence of 3D points suitable for DCEL boundary
/// construction. Caller is responsible for closing the loop (the
/// returned polyline does NOT repeat the first point at the end).
pub fn trim_loop_to_world_polyline(
    loop_: &TrimLoop,
    surface: &AnalyticSurface,
    chord_tol: f64,
) -> Vec<DVec3> {
    if loop_.curves.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<DVec3> = Vec::new();
    for (idx, curve) in loop_.curves.iter().enumerate() {
        let uv_polyline = sample_trim_curve_2d(curve, chord_tol);
        let start_idx = if idx == 0 { 0 } else { 1 };  // skip seam dup
        for uv in uv_polyline.iter().skip(start_idx) {
            let p3d = surface.evaluate(uv[0], uv[1]);
            out.push(p3d);
        }
    }
    out
}

/// ADR-064 Step 1.3 — Convert ALL trim loops of a face to 3D polylines.
///
/// Returns one polyline per loop. Caller decides how to map them to
/// DCEL outer/inner LoopRefs (Step 2 will handle this).
pub fn trim_loops_to_world_polylines(
    loops: &[TrimLoop],
    surface: &AnalyticSurface,
    chord_tol: f64,
) -> Vec<Vec<DVec3>> {
    loops.iter()
        .map(|l| trim_loop_to_world_polyline(l, surface, chord_tol))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    /// ADR-064 Step 1 #1 — Line variant produces exactly 2 points.
    #[test]
    fn trim_to_polyline_line_curve_2_points() {
        let c = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 5.0] };
        let pts = sample_trim_curve_2d(&c, 0.01);
        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0], [0.0, 0.0]);
        assert_eq!(pts[1], [10.0, 5.0]);
    }

    /// ADR-064 Step 1 #2 — Arc sagitta ≤ chord_tol.
    #[test]
    fn trim_to_polyline_arc_chord_tolerance_satisfied() {
        // Half circle of radius 1 from 0 to π; chord_tol = 0.01.
        let c = TrimCurve2D::Arc {
            center: [0.0, 0.0],
            radius: 1.0,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        let pts = sample_trim_curve_2d(&c, 0.01);
        // Verify sagitta — for each consecutive pair, midpoint of chord
        // should be within chord_tol of the arc.
        for i in 0..pts.len() - 1 {
            let m = [(pts[i][0] + pts[i + 1][0]) / 2.0,
                     (pts[i][1] + pts[i + 1][1]) / 2.0];
            let m_radius = (m[0] * m[0] + m[1] * m[1]).sqrt();
            // Sagitta = r - distance(midpoint, center) = 1 - m_radius.
            let sagitta = 1.0 - m_radius;
            assert!(sagitta < 0.01 + 1e-9,
                "segment {}: sagitta {} > tol", i, sagitta);
        }
        // Also assert minimum 2 points.
        assert!(pts.len() >= 2);
    }

    /// ADR-064 Step 1 #3 — TrimLoop on Sphere → world polyline matches
    /// surface.evaluate(u, v) for each sample point.
    #[test]
    fn trim_loop_to_world_evaluates_via_surface() {
        // Square trim loop on sphere — 4 line segments at fixed v = 0.
        let sphere = AnalyticSurface::Sphere {
            center: DVec3::ZERO,
            radius: 5.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let loop_ = TrimLoop {
            curves: vec![
                TrimCurve2D::Line { a: [0.0, 0.0], b: [1.0, 0.0] },
                TrimCurve2D::Line { a: [1.0, 0.0], b: [1.0, 0.5] },
                TrimCurve2D::Line { a: [1.0, 0.5], b: [0.0, 0.5] },
                TrimCurve2D::Line { a: [0.0, 0.5], b: [0.0, 0.0] },
            ],
            is_outer: true,
        };
        let polyline = trim_loop_to_world_polyline(&loop_, &sphere, 0.01);
        // 4 corners should appear (no seam duplicates).
        assert!(polyline.len() >= 4);
        // Verify first point = sphere.evaluate(0, 0).
        let expected_first = sphere.evaluate(0.0, 0.0);
        assert!(approx_eq(polyline[0], expected_first, 1e-9),
            "first polyline point should match surface evaluate at uv (0,0)");
    }

    /// ADR-064 Step 1 #5 — Multiple inner hole loops preserved in 3D
    /// (one polyline per loop).
    #[test]
    fn multi_inner_hole_loops_preserved_in_dcel() {
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-100.0, 100.0),
            v_range: (-100.0, 100.0),
        };
        // 1 outer + 2 inner hole loops.
        let loops = vec![
            TrimLoop { is_outer: true, curves: vec![
                TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 0.0] },
                TrimCurve2D::Line { a: [10.0, 0.0], b: [10.0, 10.0] },
                TrimCurve2D::Line { a: [10.0, 10.0], b: [0.0, 10.0] },
                TrimCurve2D::Line { a: [0.0, 10.0], b: [0.0, 0.0] },
            ]},
            TrimLoop { is_outer: false, curves: vec![
                TrimCurve2D::Line { a: [2.0, 2.0], b: [4.0, 2.0] },
                TrimCurve2D::Line { a: [4.0, 2.0], b: [4.0, 4.0] },
                TrimCurve2D::Line { a: [4.0, 4.0], b: [2.0, 4.0] },
                TrimCurve2D::Line { a: [2.0, 4.0], b: [2.0, 2.0] },
            ]},
            TrimLoop { is_outer: false, curves: vec![
                TrimCurve2D::Line { a: [6.0, 6.0], b: [8.0, 6.0] },
                TrimCurve2D::Line { a: [8.0, 6.0], b: [8.0, 8.0] },
                TrimCurve2D::Line { a: [8.0, 8.0], b: [6.0, 8.0] },
                TrimCurve2D::Line { a: [6.0, 8.0], b: [6.0, 6.0] },
            ]},
        ];
        let polylines = trim_loops_to_world_polylines(&loops, &plane, 0.01);
        assert_eq!(polylines.len(), 3, "all 3 loops must produce polylines");
        for (i, pl) in polylines.iter().enumerate() {
            assert!(pl.len() >= 4, "loop {} must have ≥4 vertices", i);
        }
    }

    /// ADR-064 Step 1 #6 — Empty trim loops → empty polyline (disjoint
    /// case, e.g., surfaces don't intersect).
    #[test]
    fn trim_polyline_returns_disjoint_when_no_intersection() {
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-1.0, 1.0),
            v_range: (-1.0, 1.0),
        };
        let empty_loop = TrimLoop { curves: vec![], is_outer: true };
        let polyline = trim_loop_to_world_polyline(&empty_loop, &plane, 0.01);
        assert_eq!(polyline.len(), DISJOINT_POLYLINE_LEN);

        let empty_loops: Vec<TrimLoop> = vec![];
        let polylines = trim_loops_to_world_polylines(&empty_loops, &plane, 0.01);
        assert!(polylines.is_empty());
    }

    /// ADR-064 Step 1 — Bezier curve sampling produces ≥16 points
    /// (default n) and respects parameter range [0, 1].
    #[test]
    fn trim_to_polyline_bezier_sample_count() {
        let bez = TrimCurve2D::Bezier {
            control_pts: vec![[0.0, 0.0], [1.0, 2.0], [3.0, -1.0], [4.0, 0.0]],
        };
        let pts = sample_trim_curve_2d(&bez, 0.01);
        assert!(pts.len() >= 16, "Bezier should sample ≥16 points, got {}", pts.len());
        assert_eq!(pts[0], [0.0, 0.0]);
        assert_eq!(pts[pts.len() - 1], [4.0, 0.0]);
    }
}
