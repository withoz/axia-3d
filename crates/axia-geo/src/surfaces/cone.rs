//! Cone primitive (Phase D, ADR-031).
//!
//! Right-circular cone with apex at `apex`, opening along `axis_dir` with
//! half-angle `α`. Parametric:
//!
//! ```text
//! P(u, v) = apex + v · axis + v · tan(α) · (cos(u)·ref + sin(u)·perp)
//! ```
//!
//! - `u`: angular position (radians)
//! - `v`: distance from apex along axis (mm). v=0 = apex.
//! - `α = half_angle`: half-cone-angle, in (0, π/2).
//!
//! Outward normal at (u, v):
//! `cos(α) · radial_dir - sin(α) · axis_dir`
//! where radial_dir = cos(u)·ref + sin(u)·perp.

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
    apex: DVec3,
    axis_dir: DVec3,
    half_angle: f64,
    ref_dir: DVec3,
    u: f64,
    v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    apex + axis * v + radial * (v * half_angle.tan())
}

pub fn normal(
    _apex: DVec3,
    axis_dir: DVec3,
    half_angle: f64,
    ref_dir: DVec3,
    u: f64,
    _v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    (radial * half_angle.cos() - axis * half_angle.sin()).normalize_or_zero()
}

pub fn derivative_u(
    axis_dir: DVec3,
    half_angle: f64,
    ref_dir: DVec3,
    u: f64,
    v: f64,
) -> DVec3 {
    let (_axis, r, p) = basis(axis_dir, ref_dir);
    let scale = v * half_angle.tan();
    r * (-scale * u.sin()) + p * (scale * u.cos())
}

pub fn derivative_v(
    axis_dir: DVec3,
    half_angle: f64,
    ref_dir: DVec3,
    u: f64,
    _v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    axis + radial * half_angle.tan()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_4, FRAC_PI_2};

    #[test]
    fn evaluate_apex_at_v_zero() {
        let p = evaluate(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 0.0);
        assert!((p - DVec3::ZERO).length() < 1e-12);
    }

    #[test]
    fn evaluate_axis_at_u_arbitrary_radius_zero() {
        // At v=0 (apex), all u positions collapse to apex (radius=0).
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            let p = evaluate(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, u, 0.0);
            assert!((p - DVec3::ZERO).length() < 1e-12);
        }
    }

    #[test]
    fn evaluate_at_unit_axial_distance() {
        // At v=10, half_angle=π/4, radius = 10·tan(π/4) = 10.
        let p = evaluate(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 10.0);
        // u=0 → ref direction → x = 10. axis Z contribution = 10.
        assert!((p - DVec3::new(10.0, 0.0, 10.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_axial_dist_radius_proportional() {
        // For half_angle=π/4 (tan=1), radius == v.
        for v in [1.0, 5.0, 10.0, 100.0] {
            let p = evaluate(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, v);
            let radial = DVec3::new(p.x, p.y, 0.0).length();
            assert!((radial - v).abs() < 1e-9,
                "v={}: radial={} ≠ v", v, radial);
        }
    }

    #[test]
    fn evaluate_offset_apex() {
        let apex = DVec3::new(10.0, 20.0, 30.0);
        let p = evaluate(apex, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 0.0);
        assert!((p - apex).length() < 1e-12);
    }

    #[test]
    fn normal_unit_length() {
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            let n = normal(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, u, 5.0);
            assert!((n.length() - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn normal_at_45deg_cone_has_axis_component_negative() {
        // For 45° cone with axis=+Z, normals should have -Z component
        // (pointing radially outward and slightly toward apex).
        let n = normal(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 5.0);
        assert!(n.z < 0.0, "expected negative axial normal component, got {:?}", n);
    }

    #[test]
    fn normal_radial_component_aligns_with_radial() {
        let n = normal(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 5.0);
        // Radial direction at u=0 is +X.
        assert!(n.x > 0.0);
        assert!(n.y.abs() < 1e-9);
    }

    #[test]
    fn derivative_u_zero_at_apex() {
        let d = derivative_u(DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 0.0);
        assert!(d.length() < 1e-9);
    }

    #[test]
    fn derivative_u_grows_with_v() {
        let d_close = derivative_u(DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 1.0);
        let d_far = derivative_u(DVec3::Z, FRAC_PI_4, DVec3::X, 0.0, 10.0);
        assert!(d_far.length() > d_close.length() * 5.0);
    }

    #[test]
    fn derivative_v_perpendicular_to_normal() {
        for u_step in 0..6 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_3;
            let n = normal(DVec3::ZERO, DVec3::Z, FRAC_PI_4, DVec3::X, u, 5.0);
            let d = derivative_v(DVec3::Z, FRAC_PI_4, DVec3::X, u, 5.0);
            let dot = n.dot(d.normalize_or_zero()).abs();
            assert!(dot < 1e-9, "u={}: dot={}", u, dot);
        }
    }

    #[test]
    fn cone_with_small_half_angle_nearly_cylindrical() {
        // Very small half_angle → close to cylinder (radius nearly constant in v).
        let small = 0.01;  // ~0.57 deg
        let p_low = evaluate(DVec3::ZERO, DVec3::Z, small, DVec3::X, 0.0, 1.0);
        let p_high = evaluate(DVec3::ZERO, DVec3::Z, small, DVec3::X, 0.0, 100.0);
        let r_low = DVec3::new(p_low.x, p_low.y, 0.0).length();
        let r_high = DVec3::new(p_high.x, p_high.y, 0.0).length();
        // Both small, but proportional to v.
        assert!((r_low / 1.0 - r_high / 100.0).abs() < 1e-9);
    }

    #[test]
    fn cone_at_exactly_90deg_half_angle_degenerate() {
        // At π/2, cone is a flat disk. Just verify no panic.
        let p = evaluate(DVec3::ZERO, DVec3::Z, FRAC_PI_2, DVec3::X, 0.0, 5.0);
        // tan(π/2) is infinity in IEEE; depending on impl this may NaN.
        // We accept any finite or non-finite — just check no panic.
        let _ = p.length();
    }
}
