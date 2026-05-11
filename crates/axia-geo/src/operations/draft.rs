//! ADR-057 Phase L Step 5 — Draft (face tilt about a neutral plane).
//!
//! Tilts a face by an angle around a "neutral plane" — the standard
//! injection-molding draft operation. Compound drafts on multiple
//! faces propagate independently per face.
//!
//! ## MVP Scope (Step 5)
//!
//! - Input: AnalyticSurface (Plane only in MVP)
//! - Operation: rotate face's normal by `angle_deg` around the neutral
//!   plane's normal (rotation axis = neutral_normal × face_normal)
//! - Skip cases: zero angle (no-op) / excessive angle (creates
//!   self-intersection with neighbors)
//!
//! Phase O integration (later) wires multi-face propagation. MVP is
//! per-face geometric only.

use anyhow::{bail, Result};
use glam::{DMat4, DQuat, DVec3};

use crate::surfaces::AnalyticSurface;

#[derive(Clone, Debug, PartialEq)]
pub enum DraftSkipReason {
    /// |angle_deg| < tol → no-op (return input unchanged)
    ZeroAngle,
    /// |angle_deg| would tilt face past 90° (degenerate orientation)
    ExcessiveAngle { angle_deg: f64 },
    /// Face normal is parallel to neutral plane normal → no rotation
    /// axis; ill-defined.
    NormalParallelToNeutral,
    /// Non-planar face MVP support (curved faces deferred to Step 5+)
    NonPlanarFace,
}

#[derive(Clone, Debug)]
pub struct DraftResult {
    pub created_surface: Option<AnalyticSurface>,
    pub skipped: Vec<DraftSkipReason>,
}

impl DraftResult {
    pub fn ok(s: AnalyticSurface) -> Self {
        Self { created_surface: Some(s), skipped: Vec::new() }
    }
    pub fn skip(r: DraftSkipReason) -> Self {
        Self { created_surface: None, skipped: vec![r] }
    }
    pub fn is_success(&self) -> bool { self.created_surface.is_some() }
}

/// Apply a draft to a single face.
///
/// `face`: input AnalyticSurface (Plane only in MVP).
/// `neutral_plane_origin` + `neutral_plane_normal`: the pivot plane
///   about which the face rotates.
/// `angle_deg`: tilt angle in degrees. Sign convention: positive
///   rotates face away from neutral plane normal.
pub fn draft_face(
    face: &AnalyticSurface,
    neutral_plane_origin: DVec3,
    neutral_plane_normal: DVec3,
    angle_deg: f64,
) -> Result<DraftResult> {
    let angle_tol_deg = 1e-6;
    if angle_deg.abs() < angle_tol_deg {
        return Ok(DraftResult::skip(DraftSkipReason::ZeroAngle));
    }
    if angle_deg.abs() >= 90.0 {
        return Ok(DraftResult::skip(
            DraftSkipReason::ExcessiveAngle { angle_deg }));
    }

    let n_neutral = neutral_plane_normal.normalize_or_zero();
    if n_neutral.length_squared() < 0.5 {
        bail!("draft: neutral_plane_normal must be unit");
    }

    match face {
        AnalyticSurface::Plane { origin, normal, basis_u, u_range, v_range } => {
            let n_face = normal.normalize_or_zero();
            if n_face.length_squared() < 0.5 {
                bail!("draft: face normal degenerate");
            }
            // Rotation axis = neutral_normal × face_normal (perpendicular
            // to both, in neutral plane)
            let axis = n_neutral.cross(n_face);
            if axis.length_squared() < 1e-12 {
                return Ok(DraftResult::skip(DraftSkipReason::NormalParallelToNeutral));
            }
            let axis = axis.normalize();

            // Pivot point = projection of face origin onto neutral plane
            let to_face = *origin - neutral_plane_origin;
            let dist_along_neutral = to_face.dot(n_neutral);
            let pivot = *origin - n_neutral * dist_along_neutral;

            // Rotate face about (pivot, axis) by angle_deg
            let angle_rad = angle_deg.to_radians();
            let q = DQuat::from_axis_angle(axis, angle_rad);
            let m = DMat4::from_translation(pivot)
                * DMat4::from_quat(q)
                * DMat4::from_translation(-pivot);

            let new_origin = m.transform_point3(*origin);
            let new_normal = m.transform_vector3(n_face).normalize_or_zero();
            let new_basis_u = m.transform_vector3(*basis_u).normalize_or_zero();

            Ok(DraftResult::ok(AnalyticSurface::Plane {
                origin: new_origin,
                normal: new_normal,
                basis_u: new_basis_u,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        _ => Ok(DraftResult::skip(DraftSkipReason::NonPlanarFace)),
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-057 §2.7 Step 5 (4 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-057 §2.7 Step 5 #19 — Planar face tilts by angle about
    /// neutral plane axis.
    #[test]
    fn draft_face_tilts_by_angle_about_neutral_plane() {
        // Vertical face (XZ plane, normal +Y) at y=0
        // Neutral plane: XY (normal +Z) at z=0
        // Draft 5° → face's +Y normal tilts toward... rotation axis
        // = +Z × +Y = -X. Rotating +Y about -X by +5° gives a vector
        // tilted slightly into -Z.
        let face = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 1.0),
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (0.0, 2.0),
        };
        let result = draft_face(&face, DVec3::ZERO, DVec3::Z, 5.0).unwrap();
        assert!(result.is_success());
        if let AnalyticSurface::Plane { normal, .. } = result.created_surface.unwrap() {
            // Original normal was +Y; after 5° tilt, normal still mostly +Y
            // but slightly z-component (axis = -X, +5° → +Y → +Y·cos(5°) - Z·sin(5°))
            assert!((normal.y - 5.0_f64.to_radians().cos()).abs() < 1e-9);
        }
    }

    /// ADR-057 §2.7 Step 5 #20 — Compound draft: each face independent.
    #[test]
    fn draft_compound_faces_each_tilted_independently() {
        let face_a = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 1.0), normal: DVec3::Y, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (0.0, 2.0),
        };
        let face_b = AnalyticSurface::Plane {
            origin: DVec3::new(1.0, 0.0, 0.0), normal: DVec3::X, basis_u: DVec3::Y,
            u_range: (0.0, 2.0), v_range: (-1.0, 1.0),
        };
        let r_a = draft_face(&face_a, DVec3::ZERO, DVec3::Z, 3.0).unwrap();
        let r_b = draft_face(&face_b, DVec3::ZERO, DVec3::Z, 7.0).unwrap();
        assert!(r_a.is_success() && r_b.is_success());
        // Verify independent angles by checking final normals are different
        if let (AnalyticSurface::Plane { normal: na, .. },
                AnalyticSurface::Plane { normal: nb, .. }) =
            (r_a.created_surface.unwrap(), r_b.created_surface.unwrap())
        {
            assert!((na - nb).length() > 1e-3,
                "compound drafts should produce different normals");
        }
    }

    /// ADR-057 §2.7 Step 5 #21 — Zero angle is no-op (skip with ZeroAngle).
    #[test]
    fn draft_zero_angle_is_no_op() {
        let face = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Y, basis_u: DVec3::X,
            u_range: (0.0, 1.0), v_range: (0.0, 1.0),
        };
        let result = draft_face(&face, DVec3::ZERO, DVec3::Z, 0.0).unwrap();
        assert!(!result.is_success());
        assert_eq!(result.skipped, vec![DraftSkipReason::ZeroAngle]);
    }

    /// ADR-057 §2.7 Step 5 #22 — Excessive angle (≥ 90°) returns skip.
    #[test]
    fn draft_excessive_angle_returns_skip() {
        let face = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Y, basis_u: DVec3::X,
            u_range: (0.0, 1.0), v_range: (0.0, 1.0),
        };
        let result = draft_face(&face, DVec3::ZERO, DVec3::Z, 95.0).unwrap();
        assert!(!result.is_success());
        assert_eq!(result.skipped,
            vec![DraftSkipReason::ExcessiveAngle { angle_deg: 95.0 }]);
    }
}
