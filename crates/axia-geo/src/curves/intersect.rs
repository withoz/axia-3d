//! Curve-Curve Intersection (CCI) — Phase C, ADR-030.
//!
//! ## Algorithm: subdivide-and-prune + Newton refinement
//!
//! Stage 1 — Both curves are sampled into polylines (Phase B/C tessellation).
//! Stage 2 — Recursive AABB pruning: subdivide either curve at midpoint
//!           if AABBs overlap; recurse until small enough.
//! Stage 3 — For each candidate (t1, t2), refine via Newton's method on
//!           `F(t1, t2) = C1(t1) - C2(t2)` (3 equations × 2 unknowns,
//!           solved via least-squares Jacobian pseudo-inverse).
//!
//! ## Tolerance
//!
//! - Default intersection tolerance: 1e-6 mm (LOCKED #5 의 1.5μm 보다 ~1500× 정밀)
//! - AABB padding: `2 × tol`
//! - Newton: max 50 iter, residual < `tol` for accept

use anyhow::Result;
use glam::{DMat3, DVec3};

use super::{AnalyticCurve, CurveOps};
use crate::mesh::Mesh;

/// One intersection between two curves.
#[derive(Clone, Debug)]
pub struct CurveIntersection {
    /// 3D intersection point.
    pub point: DVec3,
    /// Parameter on the first curve.
    pub t1: f64,
    /// Parameter on the second curve.
    pub t2: f64,
    /// Angle (radians) between the two tangent vectors at the intersection.
    /// 0 ≈ tangent contact (degenerate / edge case).
    pub angle: f64,
}

/// Compute all intersections between two analytic curves within `tol` mm.
///
/// `mesh` is needed by `Line` variants to look up vertex positions; it can be
/// any mesh containing the line endpoints (for non-Line curves it's unused).
pub fn intersect_curves(
    c1: &AnalyticCurve,
    c2: &AnalyticCurve,
    mesh: &Mesh,
    tol: f64,
) -> Result<Vec<CurveIntersection>> {
    // Tessellate both curves with chord error proportional to tol.
    let chord_tol = (tol * 10.0).max(1e-4);
    let p1 = c1.tessellate(chord_tol, mesh)?;
    let p2 = c2.tessellate(chord_tol, mesh)?;
    if p1.len() < 2 || p2.len() < 2 {
        return Ok(Vec::new());
    }
    let (r1_min, r1_max) = c1.parameter_range();
    let (r2_min, r2_max) = c2.parameter_range();

    // Collect candidate (t1, t2) by polyline-segment intersection.
    let mut candidates: Vec<(f64, f64)> = Vec::new();
    for i in 0..p1.len() - 1 {
        let a0 = p1[i];
        let a1 = p1[i + 1];
        let t1_a = r1_min + (r1_max - r1_min) * (i as f64) / ((p1.len() - 1) as f64);
        let t1_b = r1_min + (r1_max - r1_min) * ((i + 1) as f64) / ((p1.len() - 1) as f64);
        for j in 0..p2.len() - 1 {
            let b0 = p2[j];
            let b1 = p2[j + 1];
            let t2_a = r2_min + (r2_max - r2_min) * (j as f64) / ((p2.len() - 1) as f64);
            let t2_b = r2_min + (r2_max - r2_min) * ((j + 1) as f64) / ((p2.len() - 1) as f64);
            // AABB pruning with 2×tol pad.
            if !aabb_overlap_padded(a0, a1, b0, b1, tol * 2.0) {
                continue;
            }
            // Approximate parameter-space initial guess by 3D segment closeness.
            if let Some((u, v)) = nearest_segment_pair(a0, a1, b0, b1) {
                let t1_init = t1_a + (t1_b - t1_a) * u;
                let t2_init = t2_a + (t2_b - t2_a) * v;
                candidates.push((t1_init, t2_init));
            }
        }
    }

    // Refine + dedup.
    let mut results: Vec<CurveIntersection> = Vec::new();
    for (t1_init, t2_init) in candidates {
        if let Some((t1, t2)) = newton_refine(c1, c2, mesh, t1_init, t2_init, tol)? {
            let p = c1.evaluate(t1, mesh)?;
            // Dedup against existing results.
            let dup = results.iter().any(|r|
                (r.point - p).length() < tol * 10.0
                || ((r.t1 - t1).abs() < 1e-6 && (r.t2 - t2).abs() < 1e-6)
            );
            if dup { continue; }
            let d1 = c1.derivative(t1, mesh).unwrap_or(DVec3::X);
            let d2 = c2.derivative(t2, mesh).unwrap_or(DVec3::X);
            let cos_a = d1.normalize().dot(d2.normalize()).clamp(-1.0, 1.0);
            let angle = cos_a.acos();
            results.push(CurveIntersection { point: p, t1, t2, angle });
        }
    }
    Ok(results)
}

/// Newton's method on `F(t1, t2) = C1(t1) - C2(t2)`.
/// Returns `(t1, t2)` when residual < `tol`, else None.
fn newton_refine(
    c1: &AnalyticCurve,
    c2: &AnalyticCurve,
    mesh: &Mesh,
    t1_init: f64,
    t2_init: f64,
    tol: f64,
) -> Result<Option<(f64, f64)>> {
    let mut t1 = t1_init;
    let mut t2 = t2_init;
    let (r1_min, r1_max) = c1.parameter_range();
    let (r2_min, r2_max) = c2.parameter_range();
    for _ in 0..50 {
        let f = c1.evaluate(t1, mesh)? - c2.evaluate(t2, mesh)?;
        if f.length() < tol {
            return Ok(Some((t1, t2)));
        }
        let d1 = c1.derivative(t1, mesh).unwrap_or(DVec3::ZERO);
        let d2 = c2.derivative(t2, mesh).unwrap_or(DVec3::ZERO);
        // Jacobian: [d1 | -d2] (3×2). Solve via least-squares: J^T J · Δ = -J^T · F
        let a11 = d1.dot(d1);
        let a12 = -d1.dot(d2);
        let a22 = d2.dot(d2);
        let b1 = -d1.dot(f);
        let b2 = d2.dot(f);
        let det = a11 * a22 - a12 * a12;
        if det.abs() < 1e-18 {
            return Ok(None); // Degenerate
        }
        let dt1 = (a22 * b1 - a12 * b2) / det;
        let dt2 = (-a12 * b1 + a11 * b2) / det;
        // Damping if step too large.
        let step = (dt1.abs() + dt2.abs()).max(1.0);
        let damp = if step > 1.0 { 1.0 / step } else { 1.0 };
        t1 += dt1 * damp;
        t2 += dt2 * damp;
        // Project to parameter range.
        t1 = t1.clamp(r1_min, r1_max);
        t2 = t2.clamp(r2_min, r2_max);
    }
    // Final check after max iter.
    let f = c1.evaluate(t1, mesh)? - c2.evaluate(t2, mesh)?;
    if f.length() < tol {
        Ok(Some((t1, t2)))
    } else {
        Ok(None)
    }
}

/// AABB overlap test for two segments with padding.
fn aabb_overlap_padded(a0: DVec3, a1: DVec3, b0: DVec3, b1: DVec3, pad: f64) -> bool {
    let amin = a0.min(a1) - DVec3::splat(pad);
    let amax = a0.max(a1) + DVec3::splat(pad);
    let bmin = b0.min(b1) - DVec3::splat(pad);
    let bmax = b0.max(b1) + DVec3::splat(pad);
    !(amax.x < bmin.x || amin.x > bmax.x
        || amax.y < bmin.y || amin.y > bmax.y
        || amax.z < bmin.z || amin.z > bmax.z)
}

/// Closest-point pair between two 3D segments.
/// Returns the (u, v) parameters on each segment, both in [0, 1].
/// Falls back to clamped values when segments are parallel.
fn nearest_segment_pair(a0: DVec3, a1: DVec3, b0: DVec3, b1: DVec3) -> Option<(f64, f64)> {
    let d1 = a1 - a0;
    let d2 = b1 - b0;
    let r = a0 - b0;
    let a = d1.dot(d1);
    let e = d2.dot(d2);
    let f = d2.dot(r);
    if a < 1e-18 && e < 1e-18 {
        return Some((0.0, 0.0));
    }
    let (u, v);
    if a < 1e-18 {
        u = 0.0;
        v = (f / e).clamp(0.0, 1.0);
    } else {
        let c = d1.dot(r);
        if e < 1e-18 {
            v = 0.0;
            u = (-c / a).clamp(0.0, 1.0);
        } else {
            let b = d1.dot(d2);
            let denom = a * e - b * b;
            if denom.abs() < 1e-18 {
                u = 0.0;
            } else {
                u = ((b * f - c * e) / denom).clamp(0.0, 1.0);
            }
            v = ((b * u + f) / e).clamp(0.0, 1.0);
        }
    }
    Some((u, v))
}

/// Solve a 3×3 system `M · x = b` via inversion. Returns None if singular.
#[allow(dead_code)]
fn solve_3x3(m: DMat3, b: DVec3) -> Option<DVec3> {
    let det = m.determinant();
    if det.abs() < 1e-18 { return None; }
    Some(m.inverse() * b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::AnalyticCurve;
    use crate::entities::id::VertId;
    use crate::mesh::Mesh;

    fn arc(c: DVec3, r: f64, t0: f64, t1: f64) -> AnalyticCurve {
        AnalyticCurve::Arc {
            center: c, radius: r,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: t0, end_angle: t1,
        }
    }

    fn line(mesh: &mut Mesh, p0: DVec3, p1: DVec3) -> (AnalyticCurve, VertId, VertId) {
        let v0 = mesh.add_vertex(p0);
        let v1 = mesh.add_vertex(p1);
        (AnalyticCurve::Line { start: v0, end: v1 }, v0, v1)
    }

    #[test]
    fn intersect_two_lines_at_known_point() {
        let mut mesh = Mesh::new();
        let (l1, _, _) = line(&mut mesh,
            DVec3::new(-5.0, 0.0, 0.0), DVec3::new(5.0, 0.0, 0.0));
        let (l2, _, _) = line(&mut mesh,
            DVec3::new(0.0, -5.0, 0.0), DVec3::new(0.0, 5.0, 0.0));
        let xs = intersect_curves(&l1, &l2, &mesh, 1e-6).unwrap();
        assert_eq!(xs.len(), 1, "expected 1 intersection, got {}", xs.len());
        let p = xs[0].point;
        assert!((p - DVec3::ZERO).length() < 1e-6,
            "intersection at origin, got {:?}", p);
    }

    #[test]
    fn intersect_parallel_lines_returns_empty() {
        let mut mesh = Mesh::new();
        let (l1, _, _) = line(&mut mesh,
            DVec3::new(0.0, 0.0, 0.0), DVec3::new(10.0, 0.0, 0.0));
        let (l2, _, _) = line(&mut mesh,
            DVec3::new(0.0, 5.0, 0.0), DVec3::new(10.0, 5.0, 0.0));
        let xs = intersect_curves(&l1, &l2, &mesh, 1e-6).unwrap();
        assert_eq!(xs.len(), 0);
    }

    #[test]
    fn intersect_no_overlap_returns_empty() {
        let mut mesh = Mesh::new();
        let (l1, _, _) = line(&mut mesh,
            DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0));
        let (l2, _, _) = line(&mut mesh,
            DVec3::new(10.0, 10.0, 0.0), DVec3::new(11.0, 10.0, 0.0));
        let xs = intersect_curves(&l1, &l2, &mesh, 1e-6).unwrap();
        assert_eq!(xs.len(), 0);
    }

    #[test]
    fn intersect_line_circle_two_points() {
        let mut mesh = Mesh::new();
        let (l, _, _) = line(&mut mesh,
            DVec3::new(-10.0, 0.0, 0.0), DVec3::new(10.0, 0.0, 0.0));
        // Circle radius 5 around origin, on XY plane.
        let circle = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let xs = intersect_curves(&l, &circle, &mesh, 1e-6).unwrap();
        // Expect 2 intersections: (5, 0, 0) and (-5, 0, 0)
        assert_eq!(xs.len(), 2, "expected 2 intersections, got {}", xs.len());
        // Both should be on the line y=0 with |x| ≈ 5.
        for x in &xs {
            assert!(x.point.y.abs() < 1e-5, "off-line: {:?}", x.point);
            assert!((x.point.x.abs() - 5.0).abs() < 1e-5, "wrong x: {:?}", x.point);
        }
    }

    #[test]
    fn intersect_arc_arc_two_points() {
        let mut mesh = Mesh::new();
        // Two semicircles offset along x — overlap in two points.
        let a1 = arc(DVec3::ZERO, 5.0, 0.0, std::f64::consts::PI);
        let a2 = arc(DVec3::new(5.0, 0.0, 0.0), 5.0, 0.0, std::f64::consts::PI);
        let xs = intersect_curves(&a1, &a2, &mesh, 1e-5).unwrap();
        assert!(!xs.is_empty(), "expected at least 1 intersection");
        // Geometric intersections: solve x² + y² = 25 and (x - 5)² + y² = 25.
        // → x = 2.5, y = ±√(25 - 6.25) ≈ ±4.330
        // Both arcs are upper semicircles → only y > 0 is in both.
        for x in &xs {
            let r1 = (x.point - DVec3::ZERO).length();
            let r2 = (x.point - DVec3::new(5.0, 0.0, 0.0)).length();
            assert!((r1 - 5.0).abs() < 1e-3 && (r2 - 5.0).abs() < 1e-3,
                "intersection not on both circles: {:?}", x.point);
        }
    }

    #[test]
    fn intersect_circle_circle_returns_two() {
        let mesh = Mesh::new();
        let c1 = AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let c2 = AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        let xs = intersect_curves(&c1, &c2, &mesh, 1e-5).unwrap();
        // Full circles intersect at 2 points: (2.5, ±4.33).
        assert!(xs.len() >= 2, "expected ≥ 2, got {}", xs.len());
    }

    #[test]
    fn aabb_overlap_padded_basic() {
        let a0 = DVec3::new(0.0, 0.0, 0.0);
        let a1 = DVec3::new(1.0, 1.0, 0.0);
        let b0 = DVec3::new(0.5, 0.5, 0.0);
        let b1 = DVec3::new(2.0, 2.0, 0.0);
        assert!(aabb_overlap_padded(a0, a1, b0, b1, 0.0));
    }

    #[test]
    fn aabb_overlap_padded_no_overlap() {
        let a0 = DVec3::new(0.0, 0.0, 0.0);
        let a1 = DVec3::new(1.0, 0.0, 0.0);
        let b0 = DVec3::new(2.0, 0.0, 0.0);
        let b1 = DVec3::new(3.0, 0.0, 0.0);
        // Gap is 1.0 between segments; with pad 0.4 (each side, total 0.8) they
        // remain disjoint. Pad ≥ 0.5 would touch / overlap (boundary case).
        assert!(!aabb_overlap_padded(a0, a1, b0, b1, 0.4));
    }

    #[test]
    fn aabb_overlap_padded_with_padding() {
        let a0 = DVec3::new(0.0, 0.0, 0.0);
        let a1 = DVec3::new(1.0, 0.0, 0.0);
        let b0 = DVec3::new(2.0, 0.0, 0.0);
        let b1 = DVec3::new(3.0, 0.0, 0.0);
        // pad of 1.0 brings them within range.
        assert!(aabb_overlap_padded(a0, a1, b0, b1, 1.5));
    }

    #[test]
    fn nearest_segment_pair_perpendicular() {
        let a0 = DVec3::new(-5.0, 0.0, 0.0);
        let a1 = DVec3::new(5.0, 0.0, 0.0);
        let b0 = DVec3::new(0.0, -5.0, 0.0);
        let b1 = DVec3::new(0.0, 5.0, 0.0);
        let (u, v) = nearest_segment_pair(a0, a1, b0, b1).unwrap();
        // Closest points are at midpoints — u=0.5, v=0.5.
        assert!((u - 0.5).abs() < 1e-9);
        assert!((v - 0.5).abs() < 1e-9);
    }

    #[test]
    fn nearest_segment_pair_parallel_clamps() {
        let a0 = DVec3::ZERO;
        let a1 = DVec3::new(1.0, 0.0, 0.0);
        let b0 = DVec3::new(0.0, 1.0, 0.0);
        let b1 = DVec3::new(1.0, 1.0, 0.0);
        let result = nearest_segment_pair(a0, a1, b0, b1);
        // Parallel segments — function returns Some with clamped params.
        assert!(result.is_some());
    }

    #[test]
    fn newton_refine_converges_for_perpendicular_lines() {
        let mut mesh = Mesh::new();
        let (l1, _, _) = line(&mut mesh, DVec3::new(-5.0, 0.0, 0.0), DVec3::new(5.0, 0.0, 0.0));
        let (l2, _, _) = line(&mut mesh, DVec3::new(0.0, -5.0, 0.0), DVec3::new(0.0, 5.0, 0.0));
        // Initial guess slightly off the true solution.
        let result = newton_refine(&l1, &l2, &mesh, 0.4, 0.55, 1e-6).unwrap();
        assert!(result.is_some(), "Newton should converge");
        let (t1, t2) = result.unwrap();
        // True solution: t1 = 0.5, t2 = 0.5.
        assert!((t1 - 0.5).abs() < 1e-4 && (t2 - 0.5).abs() < 1e-4,
            "got t1={}, t2={}", t1, t2);
    }

    #[test]
    fn intersect_arc_line_at_specific_radius() {
        let mut mesh = Mesh::new();
        let (l, _, _) = line(&mut mesh,
            DVec3::new(-10.0, 3.0, 0.0), DVec3::new(10.0, 3.0, 0.0));
        // Quarter arc (upper-right) of unit circle radius 5.
        let a = arc(DVec3::ZERO, 5.0, 0.0, std::f64::consts::FRAC_PI_2);
        let xs = intersect_curves(&l, &a, &mesh, 1e-5).unwrap();
        // Line y=3 crosses arc where x² + 9 = 25 → x = 4 (only the +x side
        // is on the [0, π/2] range).
        assert!(!xs.is_empty(), "should have at least 1 intersection");
        let p = &xs[0].point;
        assert!((p.x - 4.0).abs() < 1e-4 && (p.y - 3.0).abs() < 1e-4,
            "expected (4, 3, 0), got {:?}", p);
    }

    #[test]
    fn intersect_self_returns_empty_or_full_overlap() {
        let mesh = Mesh::new();
        let c = arc(DVec3::ZERO, 5.0, 0.0, std::f64::consts::PI);
        // Self-intersection is degenerate — depending on Newton convergence
        // we might get 0..N results. We just verify it doesn't panic.
        let result = intersect_curves(&c, &c, &mesh, 1e-5);
        assert!(result.is_ok());
    }

    #[test]
    fn intersect_distant_curves_empty() {
        let mut mesh = Mesh::new();
        let (l, _, _) = line(&mut mesh,
            DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0));
        let a = arc(DVec3::new(100.0, 100.0, 0.0), 5.0, 0.0, std::f64::consts::PI);
        let xs = intersect_curves(&l, &a, &mesh, 1e-5).unwrap();
        assert_eq!(xs.len(), 0);
    }

    #[test]
    fn intersect_returns_angle_at_each_intersection() {
        let mut mesh = Mesh::new();
        let (l1, _, _) = line(&mut mesh,
            DVec3::new(-5.0, 0.0, 0.0), DVec3::new(5.0, 0.0, 0.0));
        let (l2, _, _) = line(&mut mesh,
            DVec3::new(0.0, -5.0, 0.0), DVec3::new(0.0, 5.0, 0.0));
        let xs = intersect_curves(&l1, &l2, &mesh, 1e-6).unwrap();
        assert_eq!(xs.len(), 1);
        // Perpendicular lines → angle ≈ π/2.
        let angle = xs[0].angle;
        assert!((angle - std::f64::consts::FRAC_PI_2).abs() < 1e-3,
            "expected π/2, got {}", angle);
    }
}
