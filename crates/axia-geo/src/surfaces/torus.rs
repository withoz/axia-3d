//! Torus primitive (Phase D, ADR-031).
//!
//! Standard torus parametric form:
//!
//! ```text
//! P(u, v) = center + (R + r·cos(v)) · (cos(u)·ref + sin(u)·perp) + r·sin(v) · axis
//! ```
//!
//! where:
//! - `R` = `major_radius`: distance from torus center to tube center
//! - `r` = `minor_radius`: tube radius
//! - `u`: angle around major axis (longitude)
//! - `v`: angle around tube circle (latitude on tube)
//! - `axis = axis_dir.normalize()`: torus symmetry axis (perpendicular to torus plane)
//! - `ref / perp`: orthonormal basis perpendicular to axis
//!
//! Outward normal: `cos(v)·radial + sin(v)·axis`,
//! where `radial = cos(u)·ref + sin(u)·perp`.

use glam::DVec3;

use super::orthonormal_ref;

#[inline]
fn basis(axis_dir: DVec3, ref_dir: DVec3) -> (DVec3, DVec3, DVec3) {
    let axis = axis_dir.normalize_or_zero();
    let r = orthonormal_ref(axis, ref_dir);
    let p = axis.cross(r).normalize_or_zero();
    (axis, r, p)
}

#[allow(clippy::too_many_arguments)]
pub fn evaluate(
    center: DVec3,
    axis_dir: DVec3,
    ref_dir: DVec3,
    major_radius: f64,
    minor_radius: f64,
    u: f64,
    v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    center
        + radial * (major_radius + minor_radius * v.cos())
        + axis * (minor_radius * v.sin())
}

#[allow(clippy::too_many_arguments)]
pub fn normal(
    _center: DVec3,
    axis_dir: DVec3,
    ref_dir: DVec3,
    _major_radius: f64,
    _minor_radius: f64,
    u: f64,
    v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    radial * v.cos() + axis * v.sin()
}

pub fn derivative_u(
    axis_dir: DVec3,
    ref_dir: DVec3,
    major_radius: f64,
    minor_radius: f64,
    u: f64,
    v: f64,
) -> DVec3 {
    let (_axis, r, p) = basis(axis_dir, ref_dir);
    let scale = major_radius + minor_radius * v.cos();
    r * (-scale * u.sin()) + p * (scale * u.cos())
}

pub fn derivative_v(
    axis_dir: DVec3,
    ref_dir: DVec3,
    minor_radius: f64,
    u: f64,
    v: f64,
) -> DVec3 {
    let (axis, r, p) = basis(axis_dir, ref_dir);
    let radial = r * u.cos() + p * u.sin();
    radial * (-minor_radius * v.sin()) + axis * (minor_radius * v.cos())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_2, PI, TAU};

    #[test]
    fn evaluate_outermost_equator_u_zero_v_zero() {
        // At v=0 (outer equator), distance from center = R+r.
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, 0.0);
        assert!((p - DVec3::new(6.0, 0.0, 0.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_innermost_equator_u_zero_v_pi() {
        // At v=π (inner equator), distance from center = R-r.
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, PI);
        assert!((p - DVec3::new(4.0, 0.0, 0.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_top_of_tube_u_zero_v_pi_half() {
        // At v=π/2, tube top: z = r above the equatorial plane.
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, FRAC_PI_2);
        assert!((p - DVec3::new(5.0, 0.0, 1.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_radial_distance_outer_equator() {
        // For all u at v=0, distance from torus center should equal R+r.
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, u, 0.0);
            let dist = p.length();
            assert!((dist - 6.0).abs() < 1e-9, "u={}: |p|={}, expected 6", u, dist);
        }
    }

    #[test]
    fn evaluate_offset_center() {
        let c = DVec3::new(10.0, 20.0, 30.0);
        let p = evaluate(c, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, 0.0);
        assert!((p - DVec3::new(16.0, 20.0, 30.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_full_u_period_returns_to_start() {
        let p0 = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, 0.0);
        let p1 = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, TAU, 0.0);
        assert!((p0 - p1).length() < 1e-9);
    }

    #[test]
    fn evaluate_full_v_period_returns_to_start() {
        let p0 = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.5, 0.0);
        let p1 = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.5, TAU);
        assert!((p0 - p1).length() < 1e-9);
    }

    #[test]
    fn normal_unit_length() {
        for u_step in 0..6 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_3;
            for v_step in 0..6 {
                let v = (v_step as f64) * std::f64::consts::FRAC_PI_3;
                let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, u, v);
                assert!((n.length() - 1.0).abs() < 1e-9,
                    "u={}, v={}: n.length={}", u, v, n.length());
            }
        }
    }

    #[test]
    fn normal_outer_equator_outward_radial() {
        // At outer equator (v=0), normal should point outward radially.
        let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, 0.0);
        assert!((n - DVec3::X).length() < 1e-9);
    }

    #[test]
    fn normal_inner_equator_inward_radial() {
        // At inner equator (v=π), normal should point INWARD (toward axis).
        let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, PI);
        assert!((n - (-DVec3::X)).length() < 1e-9);
    }

    #[test]
    fn normal_top_points_up_axis() {
        let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, 0.0, FRAC_PI_2);
        assert!((n - DVec3::Z).length() < 1e-9);
    }

    #[test]
    fn derivative_u_perpendicular_to_normal() {
        for u in [0.5, 1.0, 2.0] {
            for v in [0.5, 1.0, 2.5] {
                let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, u, v);
                let d = derivative_u(DVec3::Z, DVec3::X, 5.0, 1.0, u, v);
                if d.length() > 1e-9 {
                    let dot = n.dot(d.normalize()).abs();
                    assert!(dot < 1e-9, "u={}, v={}: dot={}", u, v, dot);
                }
            }
        }
    }

    #[test]
    fn derivative_v_perpendicular_to_normal() {
        for u in [0.5, 1.0, 2.0] {
            for v in [0.5, 1.0, 2.5] {
                let n = normal(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 1.0, u, v);
                let d = derivative_v(DVec3::Z, DVec3::X, 1.0, u, v);
                if d.length() > 1e-9 {
                    let dot = n.dot(d.normalize()).abs();
                    assert!(dot < 1e-9, "u={}, v={}: dot={}", u, v, dot);
                }
            }
        }
    }
}
