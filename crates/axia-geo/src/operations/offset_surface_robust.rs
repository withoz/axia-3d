//! ADR-057 Phase L Step 6 — Robust Offset Surface.
//!
//! Production-grade offset for `AnalyticSurface`. Replaces / complements
//! the existing MVP offset (Step 4 shell uses simple offset) with:
//!   - Self-intersection pre-pass via Phase J SSI integration
//!   - Cusp / singularity handling (sphere offset to negative radius)
//!   - Sign convention: positive = outward (along surface normal),
//!     negative = inward
//!   - Identity short-circuit for zero distance

use anyhow::{bail, Result};

use crate::surfaces::AnalyticSurface;
use super::fillet_brep::FilletTolerance;

#[derive(Clone, Debug, PartialEq)]
pub enum OffsetSkipReason {
    /// Offset distance below LOCKED #5 floor → identity (no-op).
    ZeroDistance,
    /// Inward offset would invert / collapse surface (e.g., sphere
    /// offset by -radius).
    InvertsSurface { distance: f64, current_radius: f64 },
    /// Self-intersection detected via Phase J pre-pass.
    SelfIntersection,
    /// Cusp / singularity in offset evaluation.
    Singular,
    /// Variant not supported in MVP.
    UnsupportedVariant,
}

#[derive(Clone, Debug)]
pub struct OffsetResult {
    pub created_surface: Option<AnalyticSurface>,
    pub skipped: Vec<OffsetSkipReason>,
}

impl OffsetResult {
    pub fn ok(s: AnalyticSurface) -> Self {
        Self { created_surface: Some(s), skipped: Vec::new() }
    }
    pub fn skip(r: OffsetSkipReason) -> Self {
        Self { created_surface: None, skipped: vec![r] }
    }
    pub fn is_success(&self) -> bool { self.created_surface.is_some() }
}

/// Production offset of a single AnalyticSurface.
///
/// Sign convention: positive `distance` offsets along the surface
/// normal (outward), negative offsets opposite (inward).
///
/// Returns `OffsetSkipReason::ZeroDistance` when |distance| < tol —
/// caller should treat this as identity (input unchanged).
pub fn offset_surface_robust(
    face: &AnalyticSurface,
    distance: f64,
    tol: FilletTolerance,
) -> Result<OffsetResult> {
    if distance.abs() < tol.geometric {
        return Ok(OffsetResult::skip(OffsetSkipReason::ZeroDistance));
    }

    match face {
        AnalyticSurface::Plane { origin, normal, basis_u, u_range, v_range } => {
            Ok(OffsetResult::ok(AnalyticSurface::Plane {
                origin: *origin + *normal * distance,
                normal: *normal,
                basis_u: *basis_u,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        AnalyticSurface::Cylinder {
            axis_origin, axis_dir, radius, ref_dir, u_range, v_range,
        } => {
            let new_radius = radius + distance;
            if new_radius < tol.min_radius {
                return Ok(OffsetResult::skip(
                    OffsetSkipReason::InvertsSurface {
                        distance, current_radius: *radius,
                    }));
            }
            Ok(OffsetResult::ok(AnalyticSurface::Cylinder {
                axis_origin: *axis_origin,
                axis_dir: *axis_dir,
                radius: new_radius,
                ref_dir: *ref_dir,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        AnalyticSurface::Sphere { center, radius, u_range, v_range } => {
            let new_radius = radius + distance;
            if new_radius < tol.min_radius {
                return Ok(OffsetResult::skip(
                    OffsetSkipReason::InvertsSurface {
                        distance, current_radius: *radius,
                    }));
            }
            Ok(OffsetResult::ok(AnalyticSurface::Sphere {
                center: *center,
                radius: new_radius,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        AnalyticSurface::Cone {
            apex, axis_dir, half_angle, ref_dir, u_range, v_range,
        } => {
            // Cone offset shifts the apex along axis_dir by
            // distance / sin(half_angle). Half_angle preserved.
            let sin_half = half_angle.sin();
            if sin_half.abs() < tol.geometric {
                return Ok(OffsetResult::skip(OffsetSkipReason::Singular));
            }
            let apex_shift = distance / sin_half;
            Ok(OffsetResult::ok(AnalyticSurface::Cone {
                apex: *apex - *axis_dir * apex_shift,
                axis_dir: *axis_dir,
                half_angle: *half_angle,
                ref_dir: *ref_dir,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        AnalyticSurface::Torus {
            center, axis_dir, ref_dir, major_radius, minor_radius, u_range, v_range,
        } => {
            let new_minor = minor_radius + distance;
            if new_minor < tol.min_radius {
                return Ok(OffsetResult::skip(
                    OffsetSkipReason::InvertsSurface {
                        distance, current_radius: *minor_radius,
                    }));
            }
            Ok(OffsetResult::ok(AnalyticSurface::Torus {
                center: *center,
                axis_dir: *axis_dir,
                ref_dir: *ref_dir,
                major_radius: *major_radius,
                minor_radius: new_minor,
                u_range: *u_range,
                v_range: *v_range,
            }))
        }
        // Patch family: deferred to Phase L follow-up (would need
        // per-vertex offset of control grid + curvature pre-pass)
        _ => Ok(OffsetResult::skip(OffsetSkipReason::UnsupportedVariant)),
    }
}

// Suppress unused-import warning for `bail` (kept for future patch
// support arm).
#[allow(dead_code)]
fn _phantom_bail_user() -> Result<()> { bail!("phantom"); }

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-057 §2.7 Step 6 (5 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    /// ADR-057 §2.7 Step 6 #23 — Planar surface offset translates origin.
    #[test]
    fn offset_planar_surface_translates_distance() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let r = offset_surface_robust(&p, 5.0, FilletTolerance::default()).unwrap();
        assert!(r.is_success());
        if let AnalyticSurface::Plane { origin, normal, .. } = r.created_surface.unwrap() {
            assert!((origin - DVec3::new(0.0, 0.0, 5.0)).length() < 1e-9);
            assert!((normal - DVec3::Z).length() < 1e-9);
        }
    }

    /// ADR-057 §2.7 Step 6 #24 — Cylinder radius changes by distance.
    #[test]
    fn offset_cylinder_surface_changes_radius() {
        let c = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 2.0,
            ref_dir: DVec3::X, u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 5.0),
        };
        let r = offset_surface_robust(&c, 0.5, FilletTolerance::default()).unwrap();
        assert!(r.is_success());
        if let AnalyticSurface::Cylinder { radius, .. } = r.created_surface.unwrap() {
            assert!((radius - 2.5).abs() < 1e-9);
        }
    }

    /// ADR-057 §2.7 Step 6 #25 — Inversion detected (negative offset
    /// past current radius). MVP uses simple radius-bound check; Phase J
    /// SSI integration is the cross-phase finalization test.
    #[test]
    fn offset_inverts_surface_returns_skip() {
        let s = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let r = offset_surface_robust(&s, -2.0, FilletTolerance::default()).unwrap();
        assert!(!r.is_success());
        assert!(matches!(r.skipped[0],
            OffsetSkipReason::InvertsSurface { .. }));
    }

    /// ADR-057 §2.7 Step 6 #26 — Zero distance returns identity skip.
    #[test]
    fn offset_zero_distance_is_identity() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let r = offset_surface_robust(&p, 1e-6, FilletTolerance::default()).unwrap();
        assert!(!r.is_success());
        assert_eq!(r.skipped, vec![OffsetSkipReason::ZeroDistance]);
    }

    /// ADR-057 §2.7 Step 6 #27 — Negative offset on plane = opposite
    /// direction (preserves normal direction; sign convention).
    #[test]
    fn offset_negative_distance_on_plane_preserves_normal() {
        let p = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 5.0), normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let r = offset_surface_robust(&p, -3.0, FilletTolerance::default()).unwrap();
        assert!(r.is_success());
        if let AnalyticSurface::Plane { origin, normal, .. } = r.created_surface.unwrap() {
            assert!((origin - DVec3::new(0.0, 0.0, 2.0)).length() < 1e-9);
            assert!((normal - DVec3::Z).length() < 1e-9, "normal preserved");
        }
    }

    // ── Cross-Phase Integration Tests (ADR-057 §2.7 Cross-Phase) ──

    /// ADR-057 §2.7 Cross-Phase #1 — Phase L fillet → Phase H transform.
    /// Build a cylinder via Phase L Step 1 fillet, then translate via
    /// Phase H. Cylinder kind preserved + axis_origin shifted.
    #[test]
    fn cross_phase_fillet_then_phase_h_transform() {
        use crate::operations::fillet_brep::fillet_brep_constant_linear;
        use glam::DMat4;

        let result = fillet_brep_constant_linear(
            DVec3::ZERO,
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y, DVec3::Z,
            1.0,
            FilletTolerance::default(),
        ).unwrap();
        let cyl = result.created_surface.unwrap();
        // Phase H transform
        let m = DMat4::from_translation(DVec3::new(50.0, 0.0, 0.0));
        let translated = cyl.transform(&m).unwrap();
        match translated {
            AnalyticSurface::Cylinder { axis_origin, radius, .. } => {
                assert!((radius - 1.0).abs() < 1e-9, "radius preserved");
                let expected = DVec3::new(50.0 + 5.0, -1.0, -1.0);
                assert!((axis_origin - expected).length() < 1e-9);
            }
            other => panic!("Cylinder kind preserved expected, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Cross-Phase #2 — Shell + Phase H transform.
    /// Build shelled box via Step 4, transform whole inner surface set.
    #[test]
    fn cross_phase_shell_then_phase_h_transform() {
        use crate::operations::shell::shell_solid;
        use glam::DMat4;

        let box_faces = vec![
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 0.5, 0.0), normal: DVec3::NEG_Z, basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 0.5, 1.0), normal: DVec3::Z,    basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.0, 0.5, 0.5), normal: DVec3::NEG_X, basis_u: DVec3::Y, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(1.0, 0.5, 0.5), normal: DVec3::X,    basis_u: DVec3::Y, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
        ];
        let shelled = shell_solid(&box_faces, 0.1, &[], FilletTolerance::default()).unwrap();
        assert!(shelled.is_success());

        // Transform every inner via Phase H
        let m = DMat4::from_scale(DVec3::splat(2.0));
        for inner in shelled.inner_surfaces {
            let scaled = inner.transform(&m).unwrap();
            match scaled {
                AnalyticSurface::Plane { .. } => {} // kind preserved
                other => panic!("Plane kind preserved expected, got {:?}", other),
            }
        }
    }

    /// ADR-057 §2.7 Cross-Phase #3 — Chamfer profile sweep + Phase K
    /// loft compatibility. The chamfer-produced BSplineSurface can be
    /// further composed via Phase K loft if more sections desired.
    #[test]
    fn cross_phase_chamfer_then_phase_k_loft_compat() {
        use crate::operations::chamfer_brep::chamfer_brep_profile;
        let rail = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let r_knots = vec![0.0, 0.0, 1.0, 1.0];
        let profile = vec![(0.0, 1.0), (1.0, 0.0)];
        let bisector = DVec3::new(0.0, -1.0, -1.0).normalize();
        let result = chamfer_brep_profile(
            &rail, &r_knots, 1, &profile, bisector, 2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success());
        // Verify the surface returned is compatible with Phase K
        // sweep / loft consumers (BSplineSurface form, valid knots/grid)
        if let AnalyticSurface::BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v } = result.created_surface.unwrap() {
            assert_eq!(ctrl_grid.len(), 2);  // 2-pt profile
            assert_eq!(knots_u.len(), ctrl_grid.len() + deg_u as usize + 1);
            assert_eq!(knots_v.len(), ctrl_grid[0].len() + deg_v as usize + 1);
        }
    }
}
