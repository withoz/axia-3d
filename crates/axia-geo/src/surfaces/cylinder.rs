//! Cylinder primitive (Phase D, ADR-031).
//!
//! Right-circular cylinder. Parametric:
//!
//! ```text
//! P(u, v) = axis_origin + R · (cos(u)·ref + sin(u)·perp) + v · axis
//! ```
//!
//! where `ref = ortho(ref_dir, axis)` and `perp = axis × ref` (right-handed).
//!
//! - `u`: angle in radians (0 = ref direction, π/2 = perp direction)
//! - `v`: distance along axis (mm)
//!
//! Outward normal: `cos(u)·ref + sin(u)·perp` (radial unit vector).

use glam::DVec3;

use super::orthonormal_ref;

#[inline]
fn basis(axis_dir: DVec3, ref_dir: DVec3) -> (DVec3, DVec3, DVec3) {
    let axis = axis_dir.normalize_or_zero();
    let r = orthonormal_ref(axis, ref_dir);
    let p = axis.cross(r).normalize_or_zero();
    (axis, r, p)
}

pub fn evaluate(
    axis_origin: DVec3,
    axis_dir: DVec3,
    radius: f64,
    ref_dir: DVec3,
    u: f64,
    v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    axis_origin + r * (radius * u.cos()) + p * (radius * u.sin()) + axis * v
}

pub fn normal(
    _axis_origin: DVec3,
    axis_dir: DVec3,
    ref_dir: DVec3,
    u: f64,
    _v: f64,
) -> DVec3 {
    let (_axis, r, p) = basis(axis_dir, ref_dir);
    r * u.cos() + p * u.sin()
}

pub fn derivative_u(
    axis_dir: DVec3,
    radius: f64,
    ref_dir: DVec3,
    u: f64,
    _v: f64,
) -> DVec3 {
    let (_axis, r, p) = basis(axis_dir, ref_dir);
    r * (-radius * u.sin()) + p * (radius * u.cos())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::FRAC_PI_2;

    #[test]
    fn evaluate_at_u_zero_v_zero_is_axis_origin_plus_radius_ref() {
        let p = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::X, 0.0, 0.0);
        assert!((p - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_quarter_angle_is_perp_direction() {
        // axis = Z, ref = X → perp = Z × X = Y
        let p = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::X, FRAC_PI_2, 0.0);
        assert!((p - DVec3::new(0.0, 5.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_v_translates_along_axis() {
        let p = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::X, 0.0, 10.0);
        assert!((p - DVec3::new(5.0, 0.0, 10.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_offset_axis_origin() {
        let p = evaluate(DVec3::new(1.0, 2.0, 3.0), DVec3::Z, 5.0, DVec3::X, 0.0, 0.0);
        assert!((p - DVec3::new(6.0, 2.0, 3.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_radius_invariant_at_any_height() {
        // Distance from axis should equal radius regardless of v.
        for v in [0.0, 5.0, -3.0, 100.0] {
            for u_step in 0..8 {
                let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
                let p = evaluate(DVec3::ZERO, DVec3::Z, 7.0, DVec3::X, u, v);
                let radial = DVec3::new(p.x, p.y, 0.0).length();
                assert!((radial - 7.0).abs() < 1e-12,
                    "u={}, v={}: radial={} ≠ 7", u, v, radial);
            }
        }
    }

    #[test]
    fn normal_unit_length() {
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, u, 0.0);
            assert!((n.length() - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn normal_is_radial_outward() {
        let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 0.0, 0.0);
        assert!((n - DVec3::X).length() < 1e-12);
        let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, FRAC_PI_2, 0.0);
        assert!((n - DVec3::Y).length() < 1e-12);
    }

    #[test]
    fn derivative_u_perpendicular_to_radius() {
        // At any u, ∂P/∂u should be tangential (perpendicular to radial dir).
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, u, 0.0);
            let d = derivative_u(DVec3::Z, 5.0, DVec3::X, u, 0.0);
            assert!(d.normalize().dot(n).abs() < 1e-9,
                "u={}: derivative not perpendicular to normal", u);
        }
    }

    #[test]
    fn derivative_u_magnitude_equals_radius() {
        let d = derivative_u(DVec3::Z, 5.0, DVec3::X, 0.0, 0.0);
        assert!((d.length() - 5.0).abs() < 1e-12);
    }

    #[test]
    fn nonparallel_ref_dir_orthogonalized() {
        // ref_dir not perpendicular to axis — should still produce valid evaluation.
        // axis = Z, ref = X + 0.5Z (has component along axis)
        let p = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::new(1.0, 0.0, 0.5), 0.0, 0.0);
        // After orthogonalization, ref reduces to +X.
        assert!((p - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-9);
    }

    #[test]
    fn full_circle_period_returns_to_start() {
        let p0 = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::X, 0.0, 0.0);
        let p1 = evaluate(DVec3::ZERO, DVec3::Z, 5.0, DVec3::X, std::f64::consts::TAU, 0.0);
        assert!((p0 - p1).length() < 1e-9);
    }
}
