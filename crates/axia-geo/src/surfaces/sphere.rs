//! Sphere primitive (Phase D, ADR-031).
//!
//! Standard latitude / longitude parameterization:
//!
//! ```text
//! P(u, v) = center + R · (cos(v)·cos(u), cos(v)·sin(u), sin(v))
//! ```
//!
//! - `u`: longitude in radians, [0, 2π]
//! - `v`: latitude in radians, [-π/2, π/2]
//!
//! Outward normal: `(P - center) / R`. Convention: world axes (X, Y, Z) for
//! evaluating; if the user wants a different "north pole", they can rotate
//! the sphere via center-only translation + sample at offset (u, v).
//!
//! The current Phase D variant uses world Z as the polar axis. A future
//! generalization (axis_dir + ref_dir) can be added when needed.

use glam::DVec3;

#[inline]
pub fn evaluate(center: DVec3, radius: f64, u: f64, v: f64) -> DVec3 {
    let cv = v.cos();
    let sv = v.sin();
    let cu = u.cos();
    let su = u.sin();
    center + DVec3::new(
        radius * cv * cu,
        radius * cv * su,
        radius * sv,
    )
}

#[inline]
pub fn normal(center: DVec3, radius: f64, u: f64, v: f64) -> DVec3 {
    if radius.abs() < 1e-12 {
        return DVec3::Z;  // degenerate
    }
    (evaluate(center, radius, u, v) - center) / radius
}

/// ∂P/∂u — tangent in longitude direction.
#[inline]
pub fn derivative_u(radius: f64, u: f64, v: f64) -> DVec3 {
    let cv = v.cos();
    DVec3::new(
        -radius * cv * u.sin(),
        radius * cv * u.cos(),
        0.0,
    )
}

/// ∂P/∂v — tangent in latitude direction.
#[inline]
pub fn derivative_v(radius: f64, u: f64, v: f64) -> DVec3 {
    let sv = v.sin();
    let cu = u.cos();
    let su = u.sin();
    DVec3::new(
        -radius * sv * cu,
        -radius * sv * su,
        radius * v.cos(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{FRAC_PI_2, PI};

    #[test]
    fn evaluate_north_pole() {
        // u=0, v=π/2 → top of sphere
        let p = evaluate(DVec3::ZERO, 5.0, 0.0, FRAC_PI_2);
        assert!((p - DVec3::new(0.0, 0.0, 5.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_south_pole() {
        let p = evaluate(DVec3::ZERO, 5.0, 0.0, -FRAC_PI_2);
        assert!((p - DVec3::new(0.0, 0.0, -5.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_equator_u_zero_is_x_axis() {
        let p = evaluate(DVec3::ZERO, 5.0, 0.0, 0.0);
        assert!((p - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_equator_quarter_u_is_y_axis() {
        let p = evaluate(DVec3::ZERO, 5.0, FRAC_PI_2, 0.0);
        assert!((p - DVec3::new(0.0, 5.0, 0.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_radius_invariant_everywhere() {
        let center = DVec3::ZERO;
        let r = 7.0;
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            for v_step in -4..=4 {
                let v = (v_step as f64) * std::f64::consts::FRAC_PI_8;
                let p = evaluate(center, r, u, v);
                let dist = (p - center).length();
                assert!((dist - r).abs() < 1e-9,
                    "u={}, v={}: |p-c|={} ≠ r={}", u, v, dist, r);
            }
        }
    }

    #[test]
    fn evaluate_offset_center() {
        let c = DVec3::new(1.0, 2.0, 3.0);
        let p = evaluate(c, 5.0, 0.0, 0.0);
        assert!((p - DVec3::new(6.0, 2.0, 3.0)).length() < 1e-9);
    }

    #[test]
    fn evaluate_full_longitude_period() {
        let p0 = evaluate(DVec3::ZERO, 5.0, 0.0, 0.0);
        let p1 = evaluate(DVec3::ZERO, 5.0, 2.0 * PI, 0.0);
        assert!((p0 - p1).length() < 1e-9);
    }

    #[test]
    fn normal_unit_length_everywhere() {
        for u_step in 0..8 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_4;
            for v_step in -3..=3 {
                let v = (v_step as f64) * 0.4;  // avoid exact poles
                let n = normal(DVec3::ZERO, 5.0, u, v);
                assert!((n.length() - 1.0).abs() < 1e-9,
                    "u={}, v={}: normal length={}", u, v, n.length());
            }
        }
    }

    #[test]
    fn normal_radial_outward_from_center() {
        let center = DVec3::new(10.0, 20.0, 30.0);
        let p = evaluate(center, 5.0, 0.5, 0.3);
        let n = normal(center, 5.0, 0.5, 0.3);
        let radial = (p - center).normalize();
        assert!((n - radial).length() < 1e-9);
    }

    #[test]
    fn derivative_u_perpendicular_to_normal() {
        for u_step in 0..6 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_3;
            for v_step in -2..=2 {
                let v = (v_step as f64) * 0.4;
                let n = normal(DVec3::ZERO, 5.0, u, v);
                let d = derivative_u(5.0, u, v);
                if d.length() > 1e-9 {
                    let dot = n.dot(d.normalize()).abs();
                    assert!(dot < 1e-9, "u={}, v={}: dot={}", u, v, dot);
                }
            }
        }
    }

    #[test]
    fn derivative_v_perpendicular_to_normal() {
        for u_step in 0..6 {
            let u = (u_step as f64) * std::f64::consts::FRAC_PI_3;
            for v_step in -2..=2 {
                let v = (v_step as f64) * 0.4;
                let n = normal(DVec3::ZERO, 5.0, u, v);
                let d = derivative_v(5.0, u, v);
                if d.length() > 1e-9 {
                    let dot = n.dot(d.normalize()).abs();
                    assert!(dot < 1e-9, "u={}, v={}: dot={}", u, v, dot);
                }
            }
        }
    }
}
