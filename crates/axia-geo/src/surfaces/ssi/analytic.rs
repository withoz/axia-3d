//! Analytic SSI shortcuts — closed-form solutions for common primitive pairs
//! (Phase F Stage 1, ADR-034 §P19.6).
//!
//! These bypass the general subdivision algorithm when both surfaces are
//! analytic primitives with a well-known intersection form.

use glam::DVec3;

use super::SurfaceIntersection;

/// Plane-Plane intersection.
///
/// Returns:
/// - **Disjoint** (parallel, different offset): empty intersection
/// - **Coincident** (same plane): tangent_warning=true, empty points
/// - **Intersecting**: line of intersection (sampled as N points along the line)
///
/// `n_samples` controls how many points to sample along the intersection line.
/// `extent` is the half-length of the sampled segment around the closest point
/// to origin (mm).
pub fn plane_plane(
    origin_a: DVec3, normal_a: DVec3,
    origin_b: DVec3, normal_b: DVec3,
    n_samples: usize,
    extent: f64,
) -> SurfaceIntersection {
    let na = normal_a.normalize_or_zero();
    let nb = normal_b.normalize_or_zero();
    if na.length_squared() < 0.5 || nb.length_squared() < 0.5 {
        return SurfaceIntersection::default();
    }
    // Direction of intersection line = na × nb
    let dir = na.cross(nb);
    let dir_len = dir.length();

    if dir_len < 1e-9 {
        // Parallel planes
        let offset = (origin_b - origin_a).dot(na).abs();
        let mut result = SurfaceIntersection::default();
        if offset < 1e-9 {
            // Coincident — infinite intersection (tangent contact)
            result.tangent_warning = true;
        }
        // else: parallel disjoint, empty
        return result;
    }

    let dir_unit = dir / dir_len;

    // Solve for a point on both planes — Lagrange / pseudo-inverse style.
    // Plane A: na · X = na · origin_a
    // Plane B: nb · X = nb · origin_b
    // Pick X = α na + β nb (any 3rd direction would also work)
    let d_a = na.dot(origin_a);
    let d_b = nb.dot(origin_b);
    let denom = 1.0 - na.dot(nb).powi(2);
    if denom.abs() < 1e-12 {
        // Should be caught by parallel check, but defensive.
        return SurfaceIntersection::default();
    }
    let alpha = (d_a - d_b * na.dot(nb)) / denom;
    let beta = (d_b - d_a * na.dot(nb)) / denom;
    let p_on_line = na * alpha + nb * beta;

    // Sample N points along the line: p_on_line ± extent
    let n = n_samples.max(2);
    let mut points = Vec::with_capacity(n);
    let mut uv_a = Vec::with_capacity(n);
    let mut uv_b = Vec::with_capacity(n);
    for i in 0..n {
        let t = -extent + 2.0 * extent * (i as f64) / ((n - 1) as f64);
        let p = p_on_line + dir_unit * t;
        points.push(p);
        // For Plane parameterization: project p onto plane's basis_u/v.
        // Without basis info here, just use 0.5/0.5 placeholder; caller can
        // refine via plane.evaluate inverse.
        uv_a.push((0.5, 0.5));
        uv_b.push((0.5, 0.5));
    }
    SurfaceIntersection {
        points, uv_a, uv_b,
        closed: false,
        tangent_warning: false,
    }
}

/// Plane-Cylinder intersection.
///
/// Cylinder defined by `axis_origin + s · axis_dir` for `s ∈ ℝ` with radius `r`.
///
/// Result depends on plane-axis angle θ (between plane normal and axis):
/// - **θ = 0** (plane perpendicular to axis): circle of radius `r`
/// - **0 < θ < π/2**: ellipse (semi-major = r/sin(θ), semi-minor = r)
/// - **θ = π/2** (plane parallel to axis): two parallel lines (or none if
///   plane misses cylinder, or one tangent line)
///
/// MVP: returns sampled points along the intersection curve. `n_samples` for
/// circle/ellipse, fewer for tangent line.
#[allow(clippy::too_many_arguments)]
pub fn plane_cylinder(
    plane_origin: DVec3, plane_normal: DVec3,
    cyl_axis_origin: DVec3, cyl_axis_dir: DVec3, cyl_radius: f64,
    n_samples: usize,
) -> SurfaceIntersection {
    let n = plane_normal.normalize_or_zero();
    let a = cyl_axis_dir.normalize_or_zero();
    if n.length_squared() < 0.5 || a.length_squared() < 0.5 || cyl_radius <= 0.0 {
        return SurfaceIntersection::default();
    }

    let cos_theta = n.dot(a).abs();
    let sin_theta = (1.0 - cos_theta * cos_theta).max(0.0).sqrt();

    if cos_theta > 1.0 - 1e-9 {
        // Plane perpendicular to axis → circle.
        // Find center: project cyl_axis_origin onto plane.
        let d = (cyl_axis_origin - plane_origin).dot(n);
        let center = cyl_axis_origin - n * d;
        // Build basis in plane perpendicular to axis.
        let arb = if a.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        let u_basis = a.cross(arb).normalize_or_zero();
        let v_basis = a.cross(u_basis).normalize_or_zero();

        let n_pts = n_samples.max(8);
        let mut points = Vec::with_capacity(n_pts + 1);
        let mut uv_a = Vec::with_capacity(n_pts + 1);
        let mut uv_b = Vec::with_capacity(n_pts + 1);
        for i in 0..=n_pts {
            let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n_pts as f64);
            let p = center + u_basis * (cyl_radius * theta.cos())
                           + v_basis * (cyl_radius * theta.sin());
            points.push(p);
            uv_a.push((0.5, 0.5));
            uv_b.push((theta, 0.0));
        }
        return SurfaceIntersection {
            points, uv_a, uv_b,
            closed: true,
            tangent_warning: false,
        };
    }

    if sin_theta < 1e-9 {
        // Should already be caught by cos_theta check.
        return SurfaceIntersection::default();
    }

    if cos_theta < 1e-9 {
        // Plane parallel to axis — possibly two parallel lines / none / tangent.
        // Distance from axis to plane:
        let d = (cyl_axis_origin - plane_origin).dot(n).abs();
        if d > cyl_radius + 1e-9 {
            return SurfaceIntersection::default();  // disjoint
        }
        // Compute foot of axis on plane
        let foot = cyl_axis_origin - n * (cyl_axis_origin - plane_origin).dot(n);
        let half_chord = ((cyl_radius * cyl_radius - d * d).max(0.0)).sqrt();
        // Two lines parallel to axis, offset by ±half_chord along (n × a)
        let perp = n.cross(a).normalize_or_zero();
        let line_extent = cyl_radius * 4.0;  // arbitrary sample range
        let n_pts = n_samples.max(4);
        let mut points = Vec::new();
        let mut uv_a = Vec::new();
        let mut uv_b = Vec::new();
        for sign in [1.0_f64, -1.0_f64] {
            let line_origin = foot + perp * (half_chord * sign);
            for i in 0..n_pts {
                let t = -line_extent
                    + 2.0 * line_extent * (i as f64) / ((n_pts - 1) as f64);
                let p = line_origin + a * t;
                points.push(p);
                uv_a.push((0.5, 0.5));
                uv_b.push((0.0, t));
            }
        }
        return SurfaceIntersection {
            points, uv_a, uv_b,
            closed: false,
            tangent_warning: half_chord < 1e-6,
        };
    }

    // General case: plane angle 0 < θ < π/2 → ellipse.
    // Center: intersection of axis with plane.
    let denom_axis = a.dot(n);
    if denom_axis.abs() < 1e-12 {
        return SurfaceIntersection::default();
    }
    let s_center = (plane_origin - cyl_axis_origin).dot(n) / denom_axis;
    let center = cyl_axis_origin + a * s_center;

    // Ellipse axes:
    // - minor axis = perpendicular to (axis projected onto plane), length = r
    // - major axis = (axis projected onto plane).normalize() · r/sin(θ)
    let axis_in_plane = (a - n * a.dot(n)).normalize_or_zero();
    let minor_axis = n.cross(axis_in_plane).normalize_or_zero();
    let major_len = cyl_radius / sin_theta;

    let n_pts = n_samples.max(8);
    let mut points = Vec::with_capacity(n_pts + 1);
    let mut uv_a = Vec::with_capacity(n_pts + 1);
    let mut uv_b = Vec::with_capacity(n_pts + 1);
    for i in 0..=n_pts {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n_pts as f64);
        let p = center
            + axis_in_plane * (major_len * theta.cos())
            + minor_axis * (cyl_radius * theta.sin());
        points.push(p);
        uv_a.push((0.5, 0.5));
        uv_b.push((theta, 0.0));
    }
    SurfaceIntersection {
        points, uv_a, uv_b,
        closed: true,
        tangent_warning: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: DVec3, b: DVec3, eps: f64) -> bool {
        (a - b).length() < eps
    }

    // ─── Plane-Plane ─────────────────────────────────────────────────────

    #[test]
    fn plane_plane_perpendicular_yields_xy_axis_line() {
        // Z plane (z=0) ∩ X plane (x=0) → Y axis line.
        let result = plane_plane(
            DVec3::ZERO, DVec3::Z,
            DVec3::ZERO, DVec3::X,
            16, 10.0,
        );
        assert!(!result.is_empty());
        assert!(!result.closed);
        // All points should be on Y axis (x=0, z=0).
        for p in &result.points {
            assert!(p.x.abs() < 1e-9 && p.z.abs() < 1e-9,
                "point not on Y axis: {:?}", p);
        }
    }

    #[test]
    fn plane_plane_parallel_disjoint_empty() {
        let result = plane_plane(
            DVec3::ZERO, DVec3::Z,
            DVec3::new(0.0, 0.0, 5.0), DVec3::Z,
            16, 10.0,
        );
        assert!(result.is_empty());
        assert!(!result.tangent_warning);
    }

    #[test]
    fn plane_plane_coincident_warns() {
        let result = plane_plane(
            DVec3::ZERO, DVec3::Z,
            DVec3::ZERO, DVec3::Z,
            16, 10.0,
        );
        assert!(result.tangent_warning);
    }

    #[test]
    fn plane_plane_45deg_yields_diagonal_line() {
        // Z plane and a 45° tilted plane (normal = (1, 0, 1) / sqrt(2)).
        let n2 = DVec3::new(1.0, 0.0, 1.0).normalize();
        let result = plane_plane(
            DVec3::ZERO, DVec3::Z,
            DVec3::ZERO, n2,
            16, 10.0,
        );
        assert!(!result.is_empty());
        // Intersection direction = Z × (1,0,1)/√2 = (0, -√(1/2)... actually compute
        // properly: na = (0,0,1), nb = (1,0,1)/√2 → na × nb = (0·1 - 1·0, 1·1 - 0·1, 0·0 - 0·1)/√2
        //   = (0, 1, 0)/√2 → +Y axis.
        for p in &result.points {
            // All points lie on z=0 plane (Z plane): p.z = 0
            assert!(p.z.abs() < 1e-9);
            // And on tilted plane: x + z = 0 → x = 0
            assert!(p.x.abs() < 1e-9);
        }
    }

    // ─── Plane-Cylinder ────────────────────────────────────────────────────

    #[test]
    fn plane_cylinder_perpendicular_yields_circle() {
        // Cylinder axis = Y, radius 5. Plane = z=0, normal Z.
        // Wait: plane normal should be parallel to axis for "perpendicular" cut.
        // Cylinder along Y axis, plane normal = Y → plane is XZ horizontal.
        let result = plane_cylinder(
            DVec3::ZERO, DVec3::Y,                            // plane
            DVec3::ZERO, DVec3::Y, 5.0,                       // cylinder
            16,
        );
        assert!(!result.is_empty());
        assert!(result.closed, "perpendicular cut should be closed circle");
        // All points should be at distance 5 from axis (in XZ plane since axis=Y).
        for p in &result.points {
            let radial = DVec3::new(p.x, 0.0, p.z).length();
            assert!((radial - 5.0).abs() < 1e-6,
                "radial = {} ≠ 5", radial);
        }
    }

    #[test]
    fn plane_cylinder_perpendicular_offset_center() {
        // Cylinder axis = Y at (10, 0, 5), plane = y=3, normal Y.
        let result = plane_cylinder(
            DVec3::new(0.0, 3.0, 0.0), DVec3::Y,
            DVec3::new(10.0, 0.0, 5.0), DVec3::Y, 4.0,
            16,
        );
        assert!(!result.is_empty() && result.closed);
        // Circle center at (10, 3, 5), radius 4.
        for p in &result.points {
            let center = DVec3::new(10.0, 3.0, 5.0);
            let dist = (*p - center).length();
            assert!((dist - 4.0).abs() < 1e-6);
        }
    }

    #[test]
    fn plane_cylinder_45deg_yields_ellipse() {
        // Cylinder along Y axis, plane tilted 45° (normal = (0, 1, 1)/√2).
        // Should produce ellipse: minor = r, major = r/sin(45°) = r·√2.
        let normal = DVec3::new(0.0, 1.0, 1.0).normalize();
        let r = 5.0;
        let result = plane_cylinder(
            DVec3::ZERO, normal,
            DVec3::ZERO, DVec3::Y, r,
            32,
        );
        assert!(!result.is_empty() && result.closed);
        // For each point: project onto cylinder axis to get s, then
        // (point - axis·s) should have length = r (cylinder radial).
        for p in &result.points {
            let s = p.dot(DVec3::Y);
            let radial = *p - DVec3::Y * s;
            let radial_len = radial.length();
            assert!((radial_len - r).abs() < 1e-6,
                "radial = {} ≠ {} (cylinder radius)", radial_len, r);
        }
    }

    #[test]
    fn plane_cylinder_distant_no_intersection() {
        // Plane parallel to axis but far from cylinder.
        let result = plane_cylinder(
            DVec3::new(20.0, 0.0, 0.0), DVec3::X,            // plane x=20
            DVec3::ZERO, DVec3::Y, 5.0,                       // cylinder around Y axis, r=5
            16,
        );
        assert!(result.is_empty(), "distant plane should not intersect");
    }

    #[test]
    fn plane_cylinder_parallel_to_axis_yields_two_lines() {
        // Plane parallel to axis (normal perpendicular to axis), cuts cylinder.
        // Axis = Y, plane normal = X (perpendicular to Y), passes through origin.
        // Should yield two parallel lines (at x=0, z=±5).
        let result = plane_cylinder(
            DVec3::ZERO, DVec3::X,                            // plane x=0
            DVec3::ZERO, DVec3::Y, 5.0,                       // cylinder
            8,
        );
        assert!(!result.is_empty());
        assert!(!result.closed);
        // All points should be on x=0.
        for p in &result.points {
            assert!(p.x.abs() < 1e-9);
        }
    }

    #[test]
    fn plane_cylinder_zero_radius_returns_empty() {
        let result = plane_cylinder(
            DVec3::ZERO, DVec3::Y,
            DVec3::ZERO, DVec3::Y, 0.0,
            8,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn plane_cylinder_degenerate_axis_returns_empty() {
        let result = plane_cylinder(
            DVec3::ZERO, DVec3::Y,
            DVec3::ZERO, DVec3::ZERO, 5.0,                    // zero axis_dir
            8,
        );
        assert!(result.is_empty());
    }

    // ─── SurfaceIntersection helpers ─────────────────────────────────────

    #[test]
    fn intersection_default_is_empty() {
        let r = SurfaceIntersection::default();
        assert!(r.is_empty());
        assert_eq!(r.len(), 0);
    }
}
