//! Plane primitive — flat infinite surface (Phase D, ADR-031).
//!
//! Parametric form: `P(u, v) = origin + u · basis_u + v · basis_v`,
//! where `basis_v = normal × basis_u` (right-handed).

use glam::DVec3;

#[inline]
pub fn evaluate(origin: DVec3, normal: DVec3, basis_u: DVec3, u: f64, v: f64) -> DVec3 {
    let basis_v = normal.cross(basis_u).normalize_or_zero();
    origin + basis_u * u + basis_v * v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluate_origin_at_zero() {
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 0.0, 0.0);
        assert!((p - DVec3::ZERO).length() < 1e-12);
    }

    #[test]
    fn evaluate_u_axis_direction() {
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 5.0, 0.0);
        assert!((p - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_v_axis_direction() {
        // basis_v = Z × X = Y
        let p = evaluate(DVec3::ZERO, DVec3::Z, DVec3::X, 0.0, 3.0);
        assert!((p - DVec3::new(0.0, 3.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_offset_origin() {
        let p = evaluate(DVec3::new(10.0, 20.0, 30.0), DVec3::Z, DVec3::X, 1.0, 1.0);
        assert!((p - DVec3::new(11.0, 21.0, 30.0)).length() < 1e-12);
    }

    #[test]
    fn evaluate_xz_plane() {
        // normal = Y, basis_u = X → basis_v = -Z
        let p = evaluate(DVec3::ZERO, DVec3::Y, DVec3::X, 0.0, 5.0);
        assert!((p - DVec3::new(0.0, 0.0, -5.0)).length() < 1e-12);
    }
}
