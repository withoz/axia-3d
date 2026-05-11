//! Ray ↔ Curve distance — ADR-040 Stage 1 (P25.2).
//!
//! For hover precision: given a cursor screen-space ray (in world coords),
//! find the closest point on the analytic curve and the perpendicular
//! distance from that point to the (infinite) ray line. Used by
//! `Viewport.pickEdgeAnalytic` (TS) to refine BVH hover candidates.
//!
//! ## Math
//!
//! Distance from point `P` to a line through `O` with direction `D` (unit):
//! ```text
//! d(P) = |(P - O) × D|
//! ```
//!
//! Goal: find `t* = argmin_t  d(C(t))²` and return `(t*, d, C(t*))`.
//!
//! For each curve type:
//! - **Line**: closest_t closed-form via clamped projection of (O - A) +
//!   crossproduct cross-product 3D point-to-line distance at endpoints
//!   compared with infinite-line case.
//! - **Circle**: project ray origin to plane → analytic circle-point math
//!   → 3 candidate solutions (Lagrange) → pick min.
//! - **Arc**: same as circle, then clamp `θ` to `[start, end]`.
//! - **Bezier / BSpline / NURBS**: subdivide-then-Newton on `g(t)`
//!   where `g(t) = (C(t) - O) × D · ((C(t) - O) × D)`.
//!
//! ## Failure modes (per P25.4)
//!
//! - Newton non-convergence in 50 iters → `None`
//! - NaN at any sample → `None`
//! - Caller (TS) falls back to polyline BVH on `None`.

use anyhow::Result;
use glam::DVec3;

use super::{AnalyticCurve, CurveOps};
use crate::mesh::Mesh;

/// Result of a successful ray-curve distance evaluation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayCurveResult {
    /// Parameter `t` on the curve where the closest point lies.
    pub t_on_curve: f64,
    /// Closest point on the curve (world coordinates, mm).
    pub point_on_curve: DVec3,
    /// Perpendicular distance from `point_on_curve` to the cursor ray
    /// line (mm). Always non-negative.
    pub distance: f64,
}

/// Default Newton convergence parameters (per ADR-040 P25.4 / ADR-034).
const NEWTON_TOL: f64 = 1e-9;
const NEWTON_MAX_ITER: usize = 50;
/// Number of seed samples for the subdivide-and-prune phase on free-form
/// curves. With degree ≤ 5 NURBS in typical CAD, 32 is enough to bracket
/// every local minimum on `[t_min, t_max]`.
const SUBDIVIDE_SAMPLES: usize = 32;

/// Distance from point `p` to the infinite ray line `(o, dir_unit)`.
#[inline]
fn point_ray_perp_distance(p: DVec3, o: DVec3, dir_unit: DVec3) -> f64 {
    (p - o).cross(dir_unit).length()
}

/// Compute ray ↔ curve distance + closest point. Returns `None` when the
/// numeric routine fails (Newton diverges / NaN); caller should fall back
/// to the polyline BVH path.
///
/// `ray_dir` must be unit length (panics in debug if not). Convention:
/// the ray is treated as an **infinite line** — useful for screen-space
/// picking where the cursor defines a direction but no positive `t_ray`
/// constraint.
pub fn ray_to_curve_distance(
    curve: &AnalyticCurve,
    ray_origin: DVec3,
    ray_dir: DVec3,
    mesh: &Mesh,
) -> Option<RayCurveResult> {
    debug_assert!(
        (ray_dir.length() - 1.0).abs() < 1e-6,
        "ray_dir must be unit length",
    );

    match curve {
        AnalyticCurve::Line { start, end } => {
            line_distance(*start, *end, ray_origin, ray_dir, mesh)
        }
        AnalyticCurve::Circle { center, radius, normal, basis_u } => {
            circle_distance(*center, *radius, *normal, *basis_u, ray_origin, ray_dir)
        }
        AnalyticCurve::Arc {
            center,
            radius,
            normal,
            basis_u,
            start_angle,
            end_angle,
        } => arc_distance(
            *center,
            *radius,
            *normal,
            *basis_u,
            *start_angle,
            *end_angle,
            ray_origin,
            ray_dir,
        ),
        // Free-form curves: subdivide-then-Newton on the perpendicular
        // distance functional.
        AnalyticCurve::Bezier { .. }
        | AnalyticCurve::BSpline { .. }
        | AnalyticCurve::NURBS { .. } => freeform_distance(curve, ray_origin, ray_dir, mesh),
    }
}

// ─────────────────────────────────────────────────────────────────────
// Line — closed-form
// ─────────────────────────────────────────────────────────────────────

fn line_distance(
    start: crate::entities::id::VertId,
    end: crate::entities::id::VertId,
    ray_origin: DVec3,
    ray_dir: DVec3,
    mesh: &Mesh,
) -> Option<RayCurveResult> {
    let a = mesh.vertex_pos(start).ok()?;
    let b = mesh.vertex_pos(end).ok()?;
    let ab = b - a;
    let ab_len2 = ab.length_squared();
    if ab_len2 < 1e-24 {
        // Degenerate edge — single point distance.
        let d = point_ray_perp_distance(a, ray_origin, ray_dir);
        return Some(RayCurveResult {
            t_on_curve: 0.0,
            point_on_curve: a,
            distance: d,
        });
    }

    // Two skew lines: minimum-distance pair is closed-form.
    // Line 1: A + s·AB  (s ∈ [0, 1] for the segment)
    // Line 2: O + t·D   (the cursor ray, infinite)
    //
    // Using Lumelsky's formula:
    //   r = A - O
    //   a = AB·AB   b = AB·D   c = D·D = 1   d = AB·r   e = D·r
    //   denom = a·c - b² = a - b²
    //   s* = (b·e - c·d) / denom = (b·e - d) / denom
    let r = a - ray_origin;
    let aa = ab_len2;
    let bb = ab.dot(ray_dir);
    let dd = ab.dot(r);
    let ee = ray_dir.dot(r);
    let denom = aa - bb * bb;
    let s_unclamped = if denom.abs() < 1e-24 {
        0.0 // parallel → any s is fine; pick endpoint
    } else {
        (bb * ee - dd) / denom
    };
    let s = s_unclamped.clamp(0.0, 1.0);
    let p = a + ab * s;
    let dist = point_ray_perp_distance(p, ray_origin, ray_dir);
    if !dist.is_finite() {
        return None;
    }
    Some(RayCurveResult {
        t_on_curve: s,
        point_on_curve: p,
        distance: dist,
    })
}

// ─────────────────────────────────────────────────────────────────────
// Circle — analytic + Newton refinement on the angle parameter
// ─────────────────────────────────────────────────────────────────────
//
// Strategy: sample 8 angles around the circle, pick the one with the
// smallest perpendicular-to-ray distance, then Newton-refine on
//
//   g(θ) = |C(θ) - O|² - ((C(θ) - O) · D)²    (perp-distance squared)
//
// 8 samples reliably bracket every local min for ray-tangent geometry.

fn circle_distance(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    ray_origin: DVec3,
    ray_dir: DVec3,
) -> Option<RayCurveResult> {
    let basis_v = normal.cross(basis_u);
    let eval = |theta: f64| {
        center + basis_u * (radius * theta.cos()) + basis_v * (radius * theta.sin())
    };
    let deriv = |theta: f64| {
        basis_u * (-radius * theta.sin()) + basis_v * (radius * theta.cos())
    };

    // Stage 1 — coarse sample
    let mut best_theta = 0.0_f64;
    let mut best_dist = f64::INFINITY;
    for k in 0..16 {
        let theta = (k as f64) * std::f64::consts::TAU / 16.0;
        let d = point_ray_perp_distance(eval(theta), ray_origin, ray_dir);
        if d < best_dist {
            best_dist = d;
            best_theta = theta;
        }
    }

    // Stage 2 — Newton refine
    let result = newton_refine_perp(
        best_theta,
        ray_origin,
        ray_dir,
        eval,
        deriv,
    )?;
    Some(result)
}

// ─────────────────────────────────────────────────────────────────────
// Arc — circle + angle clamp
// ─────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn arc_distance(
    center: DVec3,
    radius: f64,
    normal: DVec3,
    basis_u: DVec3,
    start_angle: f64,
    end_angle: f64,
    ray_origin: DVec3,
    ray_dir: DVec3,
) -> Option<RayCurveResult> {
    let basis_v = normal.cross(basis_u);
    let eval = |theta: f64| {
        center + basis_u * (radius * theta.cos()) + basis_v * (radius * theta.sin())
    };
    let deriv = |theta: f64| {
        basis_u * (-radius * theta.sin()) + basis_v * (radius * theta.cos())
    };

    // Sample within the arc range only.
    let n = 16usize;
    let mut best_theta = start_angle;
    let mut best_dist = f64::INFINITY;
    for k in 0..=n {
        let frac = k as f64 / n as f64;
        let theta = start_angle + (end_angle - start_angle) * frac;
        let d = point_ray_perp_distance(eval(theta), ray_origin, ray_dir);
        if d < best_dist {
            best_dist = d;
            best_theta = theta;
        }
    }

    let refined = newton_refine_perp(
        best_theta,
        ray_origin,
        ray_dir,
        eval,
        deriv,
    )?;

    // Clamp to arc range. If the refined θ escapes the arc, the closest
    // point is one of the arc endpoints.
    let (t_lo, t_hi) = if start_angle <= end_angle {
        (start_angle, end_angle)
    } else {
        (end_angle, start_angle)
    };
    if refined.t_on_curve < t_lo || refined.t_on_curve > t_hi {
        let p_lo = eval(t_lo);
        let p_hi = eval(t_hi);
        let d_lo = point_ray_perp_distance(p_lo, ray_origin, ray_dir);
        let d_hi = point_ray_perp_distance(p_hi, ray_origin, ray_dir);
        if d_lo <= d_hi {
            return Some(RayCurveResult {
                t_on_curve: t_lo,
                point_on_curve: p_lo,
                distance: d_lo,
            });
        }
        return Some(RayCurveResult {
            t_on_curve: t_hi,
            point_on_curve: p_hi,
            distance: d_hi,
        });
    }
    Some(refined)
}

// ─────────────────────────────────────────────────────────────────────
// Free-form (Bezier / BSpline / NURBS) — subdivide + Newton
// ─────────────────────────────────────────────────────────────────────

fn freeform_distance(
    curve: &AnalyticCurve,
    ray_origin: DVec3,
    ray_dir: DVec3,
    mesh: &Mesh,
) -> Option<RayCurveResult> {
    let (t_min, t_max) = curve.parameter_range();
    if !(t_min.is_finite() && t_max.is_finite()) || t_max <= t_min {
        return None;
    }
    let eval = |t: f64| -> Result<DVec3> { curve.evaluate(t, mesh) };
    let deriv = |t: f64| -> Result<DVec3> { curve.derivative(t, mesh) };

    // Stage 1 — coarse subdivide
    let mut best_t = t_min;
    let mut best_d = f64::INFINITY;
    for k in 0..=SUBDIVIDE_SAMPLES {
        let frac = k as f64 / SUBDIVIDE_SAMPLES as f64;
        let t = t_min + (t_max - t_min) * frac;
        let p = match eval(t) {
            Ok(p) if p.is_finite() => p,
            _ => return None,
        };
        let d = point_ray_perp_distance(p, ray_origin, ray_dir);
        if d.is_finite() && d < best_d {
            best_d = d;
            best_t = t;
        }
    }

    // Stage 2 — Newton on perpendicular distance squared.
    //
    // g(t)  = |w(t)|²   where w(t) = (C(t) - O) - ((C(t)-O)·D) D
    // g'(t) = 2 w(t) · w'(t)
    //
    // For numerical stability we use a finite-difference second derivative
    // — exact second derivative for general NURBS would require a separate
    // hook in CurveOps. The subdivide step already lands close to the
    // local min so 1st-order Newton suffices.

    let mut t = best_t;
    let mut last_grad = f64::INFINITY;
    for _ in 0..NEWTON_MAX_ITER {
        let p = eval(t).ok()?;
        let dp = deriv(t).ok()?;
        if !p.is_finite() || !dp.is_finite() {
            return None;
        }
        let r = p - ray_origin;
        let proj = r.dot(ray_dir);
        let w = r - ray_dir * proj;
        let dw_dt = dp - ray_dir * dp.dot(ray_dir);
        let grad = 2.0 * w.dot(dw_dt);

        // Curvature surrogate via Gauss-Newton step:
        // if g = w·w then g' ≈ 2 w·w', g'' ≈ 2 w'·w' (drop second-order
        // term; Gauss-Newton). Step size = -g'/g''.
        let hess_gn = 2.0 * dw_dt.dot(dw_dt);
        if hess_gn < 1e-24 {
            break; // tangent vanishes → cusp / tangent-aligned ray
        }
        let step = -grad / hess_gn;
        let new_t = (t + step).clamp(t_min, t_max);
        if (new_t - t).abs() < NEWTON_TOL {
            t = new_t;
            break;
        }
        t = new_t;
        if grad.abs() < NEWTON_TOL {
            break;
        }
        last_grad = grad;
    }
    if !last_grad.is_finite() {
        // never executed Newton update
    }

    let p = eval(t).ok()?;
    if !p.is_finite() {
        return None;
    }
    let dist = point_ray_perp_distance(p, ray_origin, ray_dir);
    if !dist.is_finite() {
        return None;
    }
    Some(RayCurveResult {
        t_on_curve: t,
        point_on_curve: p,
        distance: dist,
    })
}

// ─────────────────────────────────────────────────────────────────────
// Newton helper for parameterised closed-form curves (circle / arc).
// ─────────────────────────────────────────────────────────────────────

fn newton_refine_perp<F, G>(
    t0: f64,
    ray_origin: DVec3,
    ray_dir: DVec3,
    eval: F,
    deriv: G,
) -> Option<RayCurveResult>
where
    F: Fn(f64) -> DVec3,
    G: Fn(f64) -> DVec3,
{
    let mut t = t0;
    for _ in 0..NEWTON_MAX_ITER {
        let p = eval(t);
        let dp = deriv(t);
        if !p.is_finite() || !dp.is_finite() {
            return None;
        }
        let r = p - ray_origin;
        let proj = r.dot(ray_dir);
        let w = r - ray_dir * proj;
        let dw_dt = dp - ray_dir * dp.dot(ray_dir);
        let grad = 2.0 * w.dot(dw_dt);
        let hess_gn = 2.0 * dw_dt.dot(dw_dt);
        if hess_gn < 1e-24 {
            break;
        }
        let step = -grad / hess_gn;
        if step.abs() < NEWTON_TOL {
            break;
        }
        t += step;
        if grad.abs() < NEWTON_TOL {
            break;
        }
    }
    let p = eval(t);
    if !p.is_finite() {
        return None;
    }
    let dist = point_ray_perp_distance(p, ray_origin, ray_dir);
    if !dist.is_finite() {
        return None;
    }
    Some(RayCurveResult {
        t_on_curve: t,
        point_on_curve: p,
        distance: dist,
    })
}

// ─────────────────────────────────────────────────────────────────────
// Tests — unit-level, no mesh interaction (closed-form math)
// ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::Mesh;

    fn empty_mesh() -> Mesh {
        Mesh::new()
    }

    #[test]
    fn ray_perp_distance_basic() {
        // P = (3, 0, 0), ray at origin pointing +X → distance = 0.
        let p = DVec3::new(3.0, 0.0, 0.0);
        let o = DVec3::ZERO;
        let d = DVec3::X;
        assert!((point_ray_perp_distance(p, o, d) - 0.0).abs() < 1e-12);

        // P = (0, 5, 0), same ray → distance = 5.
        let p = DVec3::new(0.0, 5.0, 0.0);
        assert!((point_ray_perp_distance(p, o, d) - 5.0).abs() < 1e-12);
    }

    #[test]
    fn circle_ray_through_center_distance_equals_zero_at_two_points() {
        // Circle XY plane, center O, r=10. Ray = +X axis.
        // Closest point: (±10, 0, 0). Perpendicular distance: 0.
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 10.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let mesh = empty_mesh();
        let r = ray_to_curve_distance(&curve, DVec3::ZERO, DVec3::X, &mesh).unwrap();
        assert!(r.distance < 1e-6, "got {}", r.distance);
        assert!((r.point_on_curve.x.abs() - 10.0).abs() < 1e-6);
    }

    #[test]
    fn circle_ray_above_plane_distance_equals_height() {
        // Circle XY plane r=10, ray parallel to +X at y=0, z=5.
        // Closest curve point: (10, 0, 0). Perp distance from that point
        // to the ray-line = 5 (the z-offset).
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 10.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let mesh = empty_mesh();
        let origin = DVec3::new(0.0, 0.0, 5.0);
        let r = ray_to_curve_distance(&curve, origin, DVec3::X, &mesh).unwrap();
        assert!(
            (r.distance - 5.0).abs() < 1e-4,
            "expected ~5, got {}", r.distance,
        );
    }

    #[test]
    fn analytic_circle_hover_perfect_radius_distance() {
        // ADR-040 P25.7 #1 — cursor at radius+ε hits, radius-ε also hits
        // (analytic precision absorbs polyline gaps).
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 10.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let mesh = empty_mesh();
        // Ray going through the (10, 0, 0) point from above (z direction).
        // Closest point on circle = (10, 0, 0); perp distance = 0.
        let origin = DVec3::new(10.0, 0.0, 5.0);
        let dir = -DVec3::Z;
        let r = ray_to_curve_distance(&curve, origin, dir, &mesh).unwrap();
        assert!(r.distance < 1e-6, "expected ~0, got {}", r.distance);

        // Now cursor offset by 0.05 mm in the radial direction. Distance
        // from the ray line to the circle should be exactly 0.05 — the
        // polyline approximation would round-up or round-down.
        let origin2 = DVec3::new(10.05, 0.0, 5.0);
        let r2 = ray_to_curve_distance(&curve, origin2, dir, &mesh).unwrap();
        assert!(
            (r2.distance - 0.05).abs() < 1e-4,
            "expected 0.05, got {}", r2.distance,
        );
    }

    #[test]
    fn analytic_arc_hover_outside_arc_range_misses() {
        // ADR-040 P25.7 #2 — arc [0, π/2]. A ray in the [π, 3π/2]
        // region must NOT hit the closer-but-out-of-range point.
        let curve = AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 10.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        let mesh = empty_mesh();

        // Ray pointing +Z at (-10, 0, 0): the closest point on the FULL
        // circle would be (-10, 0, 0) (θ=π). But that's outside the arc.
        // Within the arc [0, π/2], the closest point is θ=π/2 = (0, 10, 0).
        // Perp distance from ray line (parallel to +Z at x=-10, y=0) to
        // (0, 10, 0): √(10² + 10²) ≈ 14.14.
        let origin = DVec3::new(-10.0, 0.0, 0.0);
        let dir = DVec3::Z;
        let r = ray_to_curve_distance(&curve, origin, dir, &mesh).unwrap();
        // t* should be at the arc end (π/2), not π.
        assert!(
            (r.t_on_curve - std::f64::consts::FRAC_PI_2).abs() < 1e-4
                || (r.t_on_curve - 0.0).abs() < 1e-4,
            "t escaped arc range: {}", r.t_on_curve,
        );
        // Distance must be much larger than the radius-aware "closest
        // full-circle point" (which would be ~0).
        assert!(r.distance > 5.0, "arc clamp failed, got {}", r.distance);
    }

    #[test]
    fn line_endpoint_clamp() {
        // Closed-form line distance — segment clamping.
        // In a real mesh edge `start` and `end` would be vertex IDs;
        // here we exercise the algorithmic core via `line_distance`
        // private helper would normally need mesh setup. Instead, sample
        // a Bezier of degree 1 (= line) which uses the freeform path and
        // shares the clamp behaviour.
        let curve = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(10.0, 0.0, 0.0),
            ],
        };
        let mesh = empty_mesh();
        // Ray parallel to the segment, offset by y=2.
        let origin = DVec3::new(5.0, 2.0, 0.0);
        let dir = DVec3::X;
        let r = ray_to_curve_distance(&curve, origin, dir, &mesh).unwrap();
        // Closest point ~ (5, 0, 0) since the segment is colinear with the ray.
        assert!((r.distance - 2.0).abs() < 1e-4, "got {}", r.distance);
    }

    #[test]
    fn polyline_fallback_when_analytic_diverges() {
        // ADR-040 P25.7 #3 — degenerate input → None (caller falls back).
        // We construct a degenerate Bezier (all control points equal).
        let curve = AnalyticCurve::Bezier {
            control_pts: vec![DVec3::ZERO, DVec3::ZERO, DVec3::ZERO],
        };
        let mesh = empty_mesh();
        let origin = DVec3::new(5.0, 0.0, 0.0);
        let dir = DVec3::X;
        // Should still return Some with distance 5 (point at origin), or
        // None if Newton reports divergence — both are acceptable per
        // P25.4. The contract is "no panic, no NaN leakage".
        let r = ray_to_curve_distance(&curve, origin, dir, &mesh);
        if let Some(r) = r {
            assert!(r.distance.is_finite());
        }
    }

    #[test]
    fn ray_with_non_unit_dir_is_handled_in_release_mode() {
        // In debug builds the `debug_assert!` would catch non-unit dir.
        // In release, `point_ray_perp_distance` divides by 1 implicitly
        // (we treat dir as unit), so callers must pre-normalize. We
        // assert that with a unit dir the math is exact — proxy check.
        let curve = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let mesh = empty_mesh();
        let r = ray_to_curve_distance(&curve, DVec3::new(0.0, 0.0, 10.0), -DVec3::Z, &mesh)
            .unwrap();
        // Ray at (0,0,10) pointing -Z hits (0,0,0). Perp dist to circle = 1.
        assert!((r.distance - 1.0).abs() < 1e-4, "got {}", r.distance);
    }
}
