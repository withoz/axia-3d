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

/// Plane-Sphere intersection.
///
/// Given a plane (origin + normal) and a sphere (center + radius), the
/// intersection is determined by the signed distance `d` from the sphere
/// center to the plane:
/// - `|d| > r`        → empty (disjoint)
/// - `|d| == r` (±ε) → tangent point (1 sample, `tangent_warning=true`)
/// - `|d| < r`        → circle of radius `√(r² - d²)` centered at the
///                      projection of the sphere center onto the plane,
///                      lying in the plane.
///
/// `n_samples` is the number of points sampled around the circle (caller
/// decides density). For the tangent case, exactly one point is returned.
pub fn plane_sphere(
    plane_origin: DVec3, plane_normal: DVec3,
    sphere_center: DVec3, sphere_radius: f64,
    n_samples: usize,
) -> SurfaceIntersection {
    let n = plane_normal.normalize_or_zero();
    if n.length_squared() < 0.5 || sphere_radius <= 0.0 {
        return SurfaceIntersection::default();
    }

    // Signed distance from sphere center to plane.
    let d = (sphere_center - plane_origin).dot(n);
    let abs_d = d.abs();

    // Disjoint
    if abs_d > sphere_radius + 1e-9 {
        return SurfaceIntersection::default();
    }

    // Tangent (single point)
    let foot = sphere_center - n * d;
    if (abs_d - sphere_radius).abs() < 1e-9 {
        return SurfaceIntersection {
            points: vec![foot],
            uv_a: vec![(0.5, 0.5)],
            uv_b: vec![(0.0, 0.0)],
            closed: false,
            tangent_warning: true,
        };
    }

    // Proper circle
    let r_circ = (sphere_radius * sphere_radius - d * d).max(0.0).sqrt();

    // Build orthonormal basis in plane.
    let arb = if n.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
    let u_basis = n.cross(arb).normalize_or_zero();
    let v_basis = n.cross(u_basis).normalize_or_zero();

    let n_pts = n_samples.max(8);
    let mut points = Vec::with_capacity(n_pts + 1);
    let mut uv_a = Vec::with_capacity(n_pts + 1);
    let mut uv_b = Vec::with_capacity(n_pts + 1);
    for i in 0..=n_pts {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n_pts as f64);
        let p = foot + u_basis * (r_circ * theta.cos())
                     + v_basis * (r_circ * theta.sin());
        points.push(p);
        uv_a.push((0.5, 0.5));
        // Sphere uv: (longitude θ, latitude derived from foot's z relative
        // to sphere center). Caller can refine via Sphere::project.
        uv_b.push((theta, 0.0));
    }
    SurfaceIntersection {
        points, uv_a, uv_b,
        closed: true,
        tangent_warning: false,
    }
}

/// Plane-Cone intersection.
///
/// Cone defined by `apex`, `axis_dir` (unit, pointing into the nappe), and
/// `half_angle` α (radians, 0 < α < π/2). Surface points: for s ≥ 0,
///   `P(s, θ) = apex + s·(axis·cosα + r_dir(θ)·sinα)`
///
/// For each sweep angle θ, we intersect the generator ray with the plane.
/// The resulting point set traces the conic section uniformly:
/// - Plane perpendicular to axis (|n·axis|=1) and not through apex → **circle**
/// - Plane through apex (n·(plane_origin-apex)=0) → degenerate (apex only,
///   `tangent_warning=true`)
/// - Plane oblique, all generator rays hit positive s → **ellipse** (closed)
/// - Plane parallel to one generator → **parabola** (open, missing one
///   sample where denominator ≈ 0)
/// - Plane tilted past slant angle → **hyperbola** branch (open)
///
/// `n_samples` controls angular sweep density.
pub fn plane_cone(
    plane_origin: DVec3, plane_normal: DVec3,
    apex: DVec3, axis_dir: DVec3, half_angle: f64,
    n_samples: usize,
) -> SurfaceIntersection {
    let n = plane_normal.normalize_or_zero();
    let a = axis_dir.normalize_or_zero();
    if n.length_squared() < 0.5 || a.length_squared() < 0.5 {
        return SurfaceIntersection::default();
    }
    if !(half_angle > 1e-9 && half_angle < std::f64::consts::FRAC_PI_2 - 1e-9) {
        return SurfaceIntersection::default();
    }

    let cos_a = half_angle.cos();
    let sin_a = half_angle.sin();

    // Plane-apex distance (signed)
    let d_apex = (apex - plane_origin).dot(n);

    // If plane passes through apex → degenerate (line(s) through apex). MVP
    // returns apex with tangent_warning.
    if d_apex.abs() < 1e-9 {
        return SurfaceIntersection {
            points: vec![apex],
            uv_a: vec![(0.5, 0.5)],
            uv_b: vec![(0.0, 0.0)],
            closed: false,
            tangent_warning: true,
        };
    }

    // Build orthonormal basis perpendicular to axis for r_dir(θ).
    let arb = if a.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
    let u_basis = a.cross(arb).normalize_or_zero();
    let v_basis = a.cross(u_basis).normalize_or_zero();

    let n_pts = n_samples.max(16);
    let mut points = Vec::with_capacity(n_pts + 1);
    let mut uv_a = Vec::with_capacity(n_pts + 1);
    let mut uv_b = Vec::with_capacity(n_pts + 1);
    let mut all_valid = true;
    let plane_d_const = (plane_origin - apex).dot(n);  // numerator constant

    for i in 0..=n_pts {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n_pts as f64);
        let r_dir = u_basis * theta.cos() + v_basis * theta.sin();
        let gen = a * cos_a + r_dir * sin_a;
        let denom = gen.dot(n);
        if denom.abs() < 1e-12 {
            // Generator parallel to plane — parabola asymptote miss.
            all_valid = false;
            continue;
        }
        let s = plane_d_const / denom;
        if s < 0.0 {
            // Hits opposite nappe (negative s) — skip.
            all_valid = false;
            continue;
        }
        let p = apex + gen * s;
        points.push(p);
        uv_a.push((0.5, 0.5));
        uv_b.push((theta, s));
    }

    if points.is_empty() {
        return SurfaceIntersection::default();
    }

    SurfaceIntersection {
        points, uv_a, uv_b,
        closed: all_valid,
        tangent_warning: false,
    }
}

/// Cylinder-Cylinder intersection (parallel-axis special case).
///
/// Two right-circular cylinders sharing parallel axes reduce to the 2D
/// circle-circle problem in the plane perpendicular to the axes:
/// - `d > r1 + r2`        → empty
/// - `d == r1 + r2` (±ε) → external tangent line
/// - `|r1-r2| < d < r1+r2` → two intersection lines parallel to axis
/// - `d == |r1-r2|`       → internal tangent line
/// - `d < |r1-r2|`        → one cylinder inside the other, empty
/// - `d ≈ 0 && r1 ≈ r2`  → coincident (`tangent_warning=true`)
///
/// **Non-parallel axes** → returns `tangent_warning=true` with empty points
/// to signal "use Stage 2 subdivision."
pub fn cylinder_cylinder(
    axis_origin_a: DVec3, axis_dir_a: DVec3, radius_a: f64,
    axis_origin_b: DVec3, axis_dir_b: DVec3, radius_b: f64,
    n_samples: usize,
    extent: f64,
) -> SurfaceIntersection {
    let aa = axis_dir_a.normalize_or_zero();
    let ab = axis_dir_b.normalize_or_zero();
    if aa.length_squared() < 0.5 || ab.length_squared() < 0.5
        || radius_a <= 0.0 || radius_b <= 0.0
    {
        return SurfaceIntersection::default();
    }

    // Check parallel: |aa · ab| ≈ 1
    let parallel = aa.dot(ab).abs() > 1.0 - 1e-9;
    if !parallel {
        // Defer to general subdivision.
        return SurfaceIntersection {
            points: Vec::new(),
            uv_a: Vec::new(),
            uv_b: Vec::new(),
            closed: false,
            tangent_warning: true,
        };
    }

    // Project axis_origin_b onto plane through axis_origin_a perpendicular to aa.
    let delta = axis_origin_b - axis_origin_a;
    let perp_offset = delta - aa * delta.dot(aa);
    let d = perp_offset.length();

    // Coincident
    if d < 1e-9 && (radius_a - radius_b).abs() < 1e-9 {
        return SurfaceIntersection {
            points: Vec::new(),
            uv_a: Vec::new(),
            uv_b: Vec::new(),
            closed: false,
            tangent_warning: true,
        };
    }

    // Disjoint (external)
    if d > radius_a + radius_b + 1e-9 {
        return SurfaceIntersection::default();
    }
    // Disjoint (internal nesting, no intersection)
    if d + 1e-9 < (radius_a - radius_b).abs() {
        return SurfaceIntersection::default();
    }

    // Tangent (external or internal)
    let is_ext_tangent = (d - (radius_a + radius_b)).abs() < 1e-9;
    let is_int_tangent = (d - (radius_a - radius_b).abs()).abs() < 1e-9;

    // 2D circle-circle: solve in (u, v) basis where u = perp_offset/d
    // Center A at origin, center B at (d, 0).
    // Circle A: x² + y² = r1² ; Circle B: (x-d)² + y² = r2²
    // Subtract: -2dx + d² = r2² - r1² → x = (d² + r1² - r2²) / (2d)
    let u_basis = if d > 1e-12 {
        perp_offset / d
    } else {
        // d ≈ 0 fallback (shouldn't reach here unless tangent edge case)
        let arb = if aa.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        aa.cross(arb).normalize_or_zero()
    };
    let v_basis = aa.cross(u_basis).normalize_or_zero();

    let x = if d > 1e-12 {
        (d * d + radius_a * radius_a - radius_b * radius_b) / (2.0 * d)
    } else {
        0.0
    };
    let y_sq = (radius_a * radius_a - x * x).max(0.0);
    let y = y_sq.sqrt();

    let n_pts = n_samples.max(4);
    let mut points = Vec::new();
    let mut uv_a = Vec::new();
    let mut uv_b = Vec::new();

    let signs: &[f64] = if is_ext_tangent || is_int_tangent {
        &[1.0]  // single tangent line
    } else {
        &[1.0, -1.0]  // two intersection lines
    };

    for &sign in signs {
        let line_origin_2d = u_basis * x + v_basis * (y * sign);
        let line_origin = axis_origin_a + line_origin_2d;
        for i in 0..n_pts {
            let t = -extent + 2.0 * extent * (i as f64) / ((n_pts - 1) as f64);
            let p = line_origin + aa * t;
            points.push(p);
            uv_a.push((0.0, t));
            uv_b.push((0.0, t));
        }
    }

    SurfaceIntersection {
        points, uv_a, uv_b,
        closed: false,
        tangent_warning: is_ext_tangent || is_int_tangent,
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

    // ─── Plane-Sphere ──────────────────────────────────────────────────────

    #[test]
    fn plane_sphere_through_center_yields_great_circle() {
        // Plane z=0, sphere at origin radius 5 → great circle r=5 in xy.
        let r = 5.0;
        let result = plane_sphere(
            DVec3::ZERO, DVec3::Z,
            DVec3::ZERO, r,
            32,
        );
        assert!(!result.is_empty() && result.closed);
        for p in &result.points {
            assert!(p.z.abs() < 1e-9, "point not on plane: {:?}", p);
            let radial = (p.x * p.x + p.y * p.y).sqrt();
            assert!((radial - r).abs() < 1e-6,
                "radial {} ≠ {}", radial, r);
        }
    }

    #[test]
    fn plane_sphere_offset_yields_smaller_circle() {
        // Plane z=3, sphere at origin radius 5 → circle radius √(25-9)=4 at z=3.
        let result = plane_sphere(
            DVec3::new(0.0, 0.0, 3.0), DVec3::Z,
            DVec3::ZERO, 5.0,
            32,
        );
        assert!(!result.is_empty() && result.closed);
        for p in &result.points {
            assert!((p.z - 3.0).abs() < 1e-9);
            let radial = (p.x * p.x + p.y * p.y).sqrt();
            assert!((radial - 4.0).abs() < 1e-6,
                "radial {} ≠ 4", radial);
        }
    }

    #[test]
    fn plane_sphere_tangent_yields_single_point() {
        // Plane z=5 tangent to sphere radius 5 at origin → single point (0,0,5).
        let result = plane_sphere(
            DVec3::new(0.0, 0.0, 5.0), DVec3::Z,
            DVec3::ZERO, 5.0,
            16,
        );
        assert_eq!(result.len(), 1);
        assert!(result.tangent_warning);
        assert!(approx_eq(result.points[0], DVec3::new(0.0, 0.0, 5.0), 1e-9));
    }

    #[test]
    fn plane_sphere_distant_no_intersection() {
        let result = plane_sphere(
            DVec3::new(0.0, 0.0, 10.0), DVec3::Z,
            DVec3::ZERO, 5.0,
            16,
        );
        assert!(result.is_empty());
        assert!(!result.tangent_warning);
    }

    #[test]
    fn plane_sphere_zero_radius_returns_empty() {
        let result = plane_sphere(
            DVec3::ZERO, DVec3::Z,
            DVec3::ZERO, 0.0,
            16,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn plane_sphere_oblique_plane_circle_in_plane() {
        // Tilted plane (normal = (1,1,1)/√3) through origin, sphere at origin r=4
        // → great circle r=4 lying in that tilted plane.
        let n = DVec3::new(1.0, 1.0, 1.0).normalize();
        let result = plane_sphere(
            DVec3::ZERO, n,
            DVec3::ZERO, 4.0,
            32,
        );
        assert!(!result.is_empty() && result.closed);
        for p in &result.points {
            // Distance from origin = 4
            assert!((p.length() - 4.0).abs() < 1e-6);
            // Lies on plane: p · n ≈ 0
            assert!(p.dot(n).abs() < 1e-9);
        }
    }

    // ─── Plane-Cone ────────────────────────────────────────────────────────

    #[test]
    fn plane_cone_perpendicular_yields_circle() {
        // Cone apex at origin, axis +Y, half-angle 30°.
        // Plane y=4 perpendicular to axis → circle at radius 4·tan(30°).
        let alpha = 30f64.to_radians();
        let result = plane_cone(
            DVec3::new(0.0, 4.0, 0.0), DVec3::Y,
            DVec3::ZERO, DVec3::Y, alpha,
            32,
        );
        assert!(!result.is_empty() && result.closed);
        let expected_r = 4.0 * alpha.tan();
        for p in &result.points {
            assert!((p.y - 4.0).abs() < 1e-6);
            let radial = (p.x * p.x + p.z * p.z).sqrt();
            assert!((radial - expected_r).abs() < 1e-6,
                "radial {} ≠ {}", radial, expected_r);
        }
    }

    #[test]
    fn plane_cone_through_apex_yields_apex_point() {
        let alpha = 30f64.to_radians();
        let result = plane_cone(
            DVec3::ZERO, DVec3::Z,        // plane through apex
            DVec3::ZERO, DVec3::Y, alpha,
            16,
        );
        assert_eq!(result.len(), 1);
        assert!(result.tangent_warning);
        assert!(approx_eq(result.points[0], DVec3::ZERO, 1e-9));
    }

    #[test]
    fn plane_cone_oblique_below_slant_yields_ellipse() {
        // Slight tilt — should produce ellipse (closed loop, all samples valid).
        let alpha = 20f64.to_radians();
        let normal = DVec3::new(0.0, 1.0, 0.2).normalize();  // 11° tilt
        let result = plane_cone(
            DVec3::new(0.0, 5.0, 0.0), normal,
            DVec3::ZERO, DVec3::Y, alpha,
            32,
        );
        assert!(!result.is_empty(), "should intersect");
        assert!(result.closed, "ellipse must be closed");
        // All points lie on plane: (p - plane_origin) · normal ≈ 0
        for p in &result.points {
            let pp = *p - DVec3::new(0.0, 5.0, 0.0);
            assert!(pp.dot(normal).abs() < 1e-6);
        }
    }

    #[test]
    fn plane_cone_steep_plane_yields_open_curve() {
        // Plane tilted past slant angle → hyperbola branch (open curve).
        let alpha = 20f64.to_radians();
        // Normal pointing mostly along +Z (perpendicular to axis +Y) → very steep.
        let normal = DVec3::new(0.0, 0.1, 1.0).normalize();
        let result = plane_cone(
            DVec3::new(0.0, 0.0, 3.0), normal,
            DVec3::ZERO, DVec3::Y, alpha,
            64,
        );
        // Some samples should be valid (hits cone), others skipped.
        assert!(!result.is_empty());
        assert!(!result.closed, "hyperbola is open");
    }

    #[test]
    fn plane_cone_invalid_half_angle_returns_empty() {
        // half-angle = 0 (degenerate to line)
        let result = plane_cone(
            DVec3::new(0.0, 4.0, 0.0), DVec3::Y,
            DVec3::ZERO, DVec3::Y, 0.0,
            16,
        );
        assert!(result.is_empty());
        // half-angle ≥ π/2 (degenerate to plane)
        let result = plane_cone(
            DVec3::new(0.0, 4.0, 0.0), DVec3::Y,
            DVec3::ZERO, DVec3::Y, std::f64::consts::FRAC_PI_2,
            16,
        );
        assert!(result.is_empty());
    }

    // ─── Cylinder-Cylinder ─────────────────────────────────────────────────

    #[test]
    fn cyl_cyl_parallel_offset_yields_two_lines() {
        // Both axes along Y, offset 4 in X, both radius 3 → two intersection
        // lines (since d=4, r1+r2=6, so 4 < 6).
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 3.0,
            DVec3::new(4.0, 0.0, 0.0), DVec3::Y, 3.0,
            8, 10.0,
        );
        assert!(!result.is_empty());
        // x = (16 + 9 - 9) / 8 = 2; y = √(9-4) = √5
        // So lines at (2, t, ±√5).
        let sqrt5 = 5f64.sqrt();
        let mut found_pos = false;
        let mut found_neg = false;
        for p in &result.points {
            assert!((p.x - 2.0).abs() < 1e-6);
            if (p.z - sqrt5).abs() < 1e-6 { found_pos = true; }
            if (p.z + sqrt5).abs() < 1e-6 { found_neg = true; }
        }
        assert!(found_pos && found_neg, "should have both ±√5 lines");
    }

    #[test]
    fn cyl_cyl_parallel_external_tangent() {
        // d = r1 + r2 exactly → single tangent line.
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 3.0,
            DVec3::new(7.0, 0.0, 0.0), DVec3::Y, 4.0,
            8, 10.0,
        );
        assert!(!result.is_empty());
        assert!(result.tangent_warning);
    }

    #[test]
    fn cyl_cyl_parallel_too_far_empty() {
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 3.0,
            DVec3::new(20.0, 0.0, 0.0), DVec3::Y, 4.0,
            8, 10.0,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn cyl_cyl_parallel_nested_empty() {
        // Smaller cylinder fully inside larger, no surface intersection.
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 10.0,
            DVec3::new(2.0, 0.0, 0.0), DVec3::Y, 3.0,  // d=2, |r1-r2|=7 → nested
            8, 10.0,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn cyl_cyl_parallel_coincident_warns() {
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 5.0,
            DVec3::ZERO, DVec3::Y, 5.0,
            8, 10.0,
        );
        assert!(result.is_empty());
        assert!(result.tangent_warning);
    }

    #[test]
    fn cyl_cyl_non_parallel_defers_to_subdivision() {
        // Crossing axes — analytic shortcut returns empty + warning to signal
        // "use Stage 2 subdivision."
        let result = cylinder_cylinder(
            DVec3::ZERO, DVec3::Y, 3.0,
            DVec3::ZERO, DVec3::X, 3.0,
            8, 10.0,
        );
        assert!(result.is_empty());
        assert!(result.tangent_warning);
    }

    // ─── SurfaceIntersection helpers ─────────────────────────────────────

    #[test]
    fn intersection_default_is_empty() {
        let r = SurfaceIntersection::default();
        assert!(r.is_empty());
        assert_eq!(r.len(), 0);
    }
}
