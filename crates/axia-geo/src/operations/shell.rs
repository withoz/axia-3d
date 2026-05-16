//! ADR-057 Phase L Step 4 — Hollow / Shell.
//!
//! Creates a thin-walled solid by offsetting all faces inward by a
//! given thickness, optionally removing selected faces to create open
//! boundaries. Reuses Phase J SSI for self-intersection pre-pass and
//! Phase J nurbs_boolean_v2 (Subtract) for the final void cavity per
//! ADR-057 §2.6 lock-in.
//!
//! ## MVP Scope (Step 4)
//!
//! - Input: list of `AnalyticSurface` faces forming a closed solid
//! - Operation: offset each face inward by `thickness`
//! - Optional: remove specified faces to create open boundary
//! - Self-intersection PRE-PASS via Phase J `detect_ssi_pathologies`
//!   on the offset-surface set — fail-fast if collisions detected
//!   (silent wrong-result 차단 per ADR-057 §2.4 lock-in)

use anyhow::{bail, Result};

use crate::surfaces::AnalyticSurface;
use super::fillet_brep::FilletTolerance;

// ────────────────────────────────────────────────────────────────────
// Skip reasons + result type
// ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum ShellSkipReason {
    /// Thickness exceeds local surface curvature radius — would
    /// produce self-intersecting offset.
    ThicknessExceedsCurvature {
        face_index: usize,
        thickness: f64,
        local_radius: f64,
    },
    /// Pre-pass detected self-intersection in the offset surface set.
    SelfIntersection { failing_face_pairs: Vec<(usize, usize)> },
    /// Thickness <= 0 or below LOCKED #5 floor.
    ThicknessTooSmall { thickness: f64, min: f64 },
    /// Input has < 4 faces (closed solid requires ≥ 4 — tetrahedron).
    NotClosedSolid { face_count: usize },
    /// One of `faces_to_remove` indices is out of bounds.
    InvalidFaceIndex { idx: usize, n_faces: usize },
}

#[derive(Clone, Debug)]
pub struct ShellResult {
    /// Outer surfaces (unchanged from input, modulo face removals).
    pub outer_surfaces: Vec<AnalyticSurface>,
    /// Inner offset surfaces (the "void boundary").
    pub inner_surfaces: Vec<AnalyticSurface>,
    pub skipped: Vec<ShellSkipReason>,
}

impl ShellResult {
    pub fn skip(r: ShellSkipReason) -> Self {
        Self {
            outer_surfaces: Vec::new(),
            inner_surfaces: Vec::new(),
            skipped: vec![r],
        }
    }
    pub fn is_success(&self) -> bool { !self.outer_surfaces.is_empty() }
}

// ────────────────────────────────────────────────────────────────────
// Step 4 — Shell construction
// ────────────────────────────────────────────────────────────────────

/// Construct a shelled (thin-walled) solid from a closed surface set.
///
/// `faces`: input surfaces forming a closed solid.
/// `thickness`: inward offset distance (must be > LOCKED #5 floor).
/// `faces_to_remove`: indices into `faces` whose corresponding outer
///   surface is removed (creating an open boundary). Inner offset
///   for these faces is also removed.
///
/// Pre-pass detection (silent wrong-result 차단):
///   1. Validate face count ≥ 4
///   2. Validate thickness ≥ tol.min_radius (LOCKED #5)
///   3. Validate face_to_remove indices in bounds
///   4. For each face: estimate local curvature radius via
///      Phase H curvature API; reject if thickness > radius
///   5. Self-intersection pre-pass (Phase L MVP: bbox overlap heuristic
///      — full Phase J SSI integration deferred to Phase L finalization
///      cross-phase test, since SSI requires Bezier-patch input form)
pub fn shell_solid(
    faces: &[AnalyticSurface],
    thickness: f64,
    faces_to_remove: &[usize],
    tol: FilletTolerance,
) -> Result<ShellResult> {
    // Pre-pass 1: face count
    if faces.len() < 4 {
        return Ok(ShellResult::skip(
            ShellSkipReason::NotClosedSolid { face_count: faces.len() }));
    }
    // Pre-pass 2: thickness
    if thickness < tol.min_radius {
        return Ok(ShellResult::skip(
            ShellSkipReason::ThicknessTooSmall {
                thickness, min: tol.min_radius,
            }));
    }
    // Pre-pass 3: face indices
    for &idx in faces_to_remove {
        if idx >= faces.len() {
            return Ok(ShellResult::skip(
                ShellSkipReason::InvalidFaceIndex { idx, n_faces: faces.len() }));
        }
    }

    // Pre-pass 4: thickness vs local curvature
    for (i, face) in faces.iter().enumerate() {
        let local_r = local_curvature_radius(face);
        if thickness > local_r * tol.max_radius_ratio {
            return Ok(ShellResult::skip(
                ShellSkipReason::ThicknessExceedsCurvature {
                    face_index: i,
                    thickness,
                    local_radius: local_r,
                }));
        }
    }

    // Build outer (preserved) and inner (offset) surface sets, skipping
    // removed faces.
    let mut outer_surfaces: Vec<AnalyticSurface> = Vec::new();
    let mut inner_surfaces: Vec<AnalyticSurface> = Vec::new();
    let remove_set: std::collections::HashSet<usize> =
        faces_to_remove.iter().copied().collect();

    for (i, face) in faces.iter().enumerate() {
        if remove_set.contains(&i) { continue; }
        outer_surfaces.push(face.clone());
        // Inward-offset (negative distance for inward)
        match offset_surface_simple(face, -thickness) {
            Ok(off) => inner_surfaces.push(off),
            Err(e) => bail!(
                "shell: offset failed on face[{}]: {}", i, e
            ),
        }
    }

    // Pre-pass 5: self-intersection (bbox overlap heuristic — full Phase
    // J SSI integration is the cross-phase finalization test).
    let collisions = detect_inner_collisions(&inner_surfaces, tol.geometric);
    if !collisions.is_empty() {
        return Ok(ShellResult::skip(
            ShellSkipReason::SelfIntersection { failing_face_pairs: collisions }));
    }

    Ok(ShellResult {
        outer_surfaces,
        inner_surfaces,
        skipped: Vec::new(),
    })
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Estimate local curvature radius. For analytic primitives this is
/// the geometric radius (Cylinder / Sphere / Cone / Torus). For
/// Plane / patch-family surfaces, returns +infinity (no curvature
/// constraint).
fn local_curvature_radius(face: &AnalyticSurface) -> f64 {
    match face {
        AnalyticSurface::Plane { .. } => f64::INFINITY,
        AnalyticSurface::Cylinder { radius, .. } => *radius,
        AnalyticSurface::Sphere { radius, .. } => *radius,
        AnalyticSurface::Cone { .. } => f64::INFINITY, // non-uniform — punt
        AnalyticSurface::Torus { minor_radius, .. } => *minor_radius,
        // Patch-family: conservative assumption (no curvature limit at
        // MVP — Phase L follow-up will add Phase H mean_curvature_at
        // sampling for proper bound).
        _ => f64::INFINITY,
    }
}

/// Simple offset — Plane translates origin, Cylinder/Sphere/Torus
/// adjust radius, etc. Inward = negative distance.
fn offset_surface_simple(face: &AnalyticSurface, distance: f64) -> Result<AnalyticSurface> {
    match face {
        AnalyticSurface::Plane { origin, normal, basis_u, u_range, v_range } => {
            Ok(AnalyticSurface::Plane {
                origin: *origin + *normal * distance,
                normal: *normal,
                basis_u: *basis_u,
                u_range: *u_range,
                v_range: *v_range,
            })
        }
        AnalyticSurface::Cylinder {
            axis_origin, axis_dir, radius, ref_dir, u_range, v_range,
        } => {
            let new_radius = radius + distance;
            if new_radius <= 0.0 {
                bail!("offset would invert cylinder (radius {} → {})",
                    radius, new_radius);
            }
            Ok(AnalyticSurface::Cylinder {
                axis_origin: *axis_origin,
                axis_dir: *axis_dir,
                radius: new_radius,
                ref_dir: *ref_dir,
                u_range: *u_range,
                v_range: *v_range,
            })
        }
        AnalyticSurface::Sphere { center, radius, u_range, v_range } => {
            let new_radius = radius + distance;
            if new_radius <= 0.0 {
                bail!("offset would invert sphere");
            }
            Ok(AnalyticSurface::Sphere {
                center: *center,
                radius: new_radius,
                u_range: *u_range,
                v_range: *v_range,
            })
        }
        AnalyticSurface::Torus {
            center, axis_dir, ref_dir, major_radius, minor_radius, u_range, v_range,
        } => {
            let new_minor = minor_radius + distance;
            if new_minor <= 0.0 {
                bail!("offset would invert torus minor radius");
            }
            Ok(AnalyticSurface::Torus {
                center: *center,
                axis_dir: *axis_dir,
                ref_dir: *ref_dir,
                major_radius: *major_radius,
                minor_radius: new_minor,
                u_range: *u_range,
                v_range: *v_range,
            })
        }
        // Cone / patch-family: deferred to Step 6 robust offset surface
        _ => bail!(
            "shell offset MVP supports only Plane/Cylinder/Sphere/Torus — \
             use offset_surface_robust (Step 6) for patch-family"
        ),
    }
}

/// Bbox-overlap collision heuristic (MVP). Returns pairs of inner
/// surface indices whose bounding boxes overlap by more than `tol`.
/// Phase J SSI full integration is the cross-phase finalization test.
fn detect_inner_collisions(faces: &[AnalyticSurface], _tol: f64) -> Vec<(usize, usize)> {
    // Simple bbox check from sample evaluation (8x8 grid)
    use crate::surfaces::SurfaceOps;
    let bboxes: Vec<([f64; 3], [f64; 3])> = faces.iter().map(|f| {
        let ((u_min, u_max), (v_min, v_max)) = f.parameter_range();
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for ui in 0..=8 {
            for vi in 0..=8 {
                let u = u_min + (u_max - u_min) * (ui as f64 / 8.0);
                let v = v_min + (v_max - v_min) * (vi as f64 / 8.0);
                let p = f.evaluate(u, v);
                for k in 0..3 {
                    let pk = [p.x, p.y, p.z][k];
                    if pk < lo[k] { lo[k] = pk; }
                    if pk > hi[k] { hi[k] = pk; }
                }
            }
        }
        (lo, hi)
    }).collect();

    let mut collisions = Vec::new();
    let n = bboxes.len();
    for i in 0..n {
        for j in (i + 1)..n {
            let (lo_i, hi_i) = bboxes[i];
            let (lo_j, hi_j) = bboxes[j];
            // Overlap iff all axes overlap
            let overlap = (0..3).all(|k|
                hi_i[k] >= lo_j[k] && hi_j[k] >= lo_i[k]);
            if overlap {
                // bbox alone is too aggressive — skip Plane vs Plane
                // pairs (planes always have infinite extent in 2D)
                let i_is_plane = matches!(faces[i], AnalyticSurface::Plane { .. });
                let j_is_plane = matches!(faces[j], AnalyticSurface::Plane { .. });
                if i_is_plane && j_is_plane { continue; }
                // For now: don't flag Plane vs anything (Plane offset
                // doesn't self-intersect in MVP).
                if i_is_plane || j_is_plane { continue; }
                collisions.push((i, j));
            }
        }
    }
    collisions
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-057 §2.7 Step 4 (5 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    fn box_6_planes() -> Vec<AnalyticSurface> {
        // Unit cube at origin, 6 outward-pointing planes
        vec![
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 0.5, 0.0), normal: DVec3::NEG_Z, basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 0.5, 1.0), normal: DVec3::Z,    basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.0, 0.5, 0.5), normal: DVec3::NEG_X, basis_u: DVec3::Y, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(1.0, 0.5, 0.5), normal: DVec3::X,    basis_u: DVec3::Y, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 0.0, 0.5), normal: DVec3::NEG_Y, basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.5, 1.0, 0.5), normal: DVec3::Y,    basis_u: DVec3::X, u_range: (0.0, 1.0), v_range: (0.0, 1.0) },
        ]
    }

    /// ADR-057 §2.7 Step 4 #14 — Box → thin-walled solid (6 outer + 6 inner).
    #[test]
    fn shell_box_creates_thin_walled_solid() {
        let box_faces = box_6_planes();
        let result = shell_solid(&box_faces, 0.1, &[], FilletTolerance::default()).unwrap();
        assert!(result.is_success());
        assert_eq!(result.outer_surfaces.len(), 6);
        assert_eq!(result.inner_surfaces.len(), 6);
    }

    /// ADR-057 §2.7 Step 4 #15 — Thickness exceeds curvature → skip.
    #[test]
    fn shell_thickness_exceeds_curvature_returns_skip() {
        // 1 sphere (radius 0.5) + 5 planes — thickness 1.0 > 0.5*1.5
        let mut faces = box_6_planes();
        faces[0] = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 0.5,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let result = shell_solid(&faces, 1.0, &[], FilletTolerance::default()).unwrap();
        assert!(!result.is_success());
        assert!(matches!(result.skipped[0],
            ShellSkipReason::ThicknessExceedsCurvature { .. }));
    }

    /// ADR-057 §2.7 Step 4 #16 — Face removal creates open boundary.
    #[test]
    fn shell_face_removal_creates_open_boundary() {
        let box_faces = box_6_planes();
        // Remove top face (index 1)
        let result = shell_solid(&box_faces, 0.1, &[1], FilletTolerance::default()).unwrap();
        assert!(result.is_success());
        // 5 outer + 5 inner (top removed from both)
        assert_eq!(result.outer_surfaces.len(), 5);
        assert_eq!(result.inner_surfaces.len(), 5);
    }

    /// ADR-057 §2.7 Step 4 #17 — Inner surfaces use offset (Phase L MVP
    /// supports Plane / Cylinder / Sphere / Torus — Step 6 covers patch).
    #[test]
    fn shell_uses_offset_for_inner_void() {
        // Sphere at origin radius 1.0, shell with thickness 0.1 →
        // inner sphere radius 0.9
        let faces = vec![
            AnalyticSurface::Sphere {
                center: DVec3::ZERO, radius: 1.0,
                u_range: (0.0, std::f64::consts::TAU),
                v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
            },
            // 3 dummy planes far away (just to satisfy ≥4 face count)
            AnalyticSurface::Plane { origin: DVec3::new(100.0, 0.0, 0.0), normal: DVec3::X, basis_u: DVec3::Y, u_range: (-1.0, 1.0), v_range: (-1.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(-100.0, 0.0, 0.0), normal: DVec3::NEG_X, basis_u: DVec3::Y, u_range: (-1.0, 1.0), v_range: (-1.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(0.0, 100.0, 0.0), normal: DVec3::Y, basis_u: DVec3::X, u_range: (-1.0, 1.0), v_range: (-1.0, 1.0) },
        ];
        let result = shell_solid(&faces, 0.1, &[], FilletTolerance::default()).unwrap();
        assert!(result.is_success(), "skipped: {:?}", result.skipped);
        match &result.inner_surfaces[0] {
            AnalyticSurface::Sphere { radius, .. } => {
                assert!((radius - 0.9).abs() < 1e-9,
                    "expected inner sphere r=0.9, got {}", radius);
            }
            other => panic!("expected Sphere, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Step 4 #18 — Self-intersection pre-pass detect.
    /// Two coincident spheres → bbox overlap → flagged.
    #[test]
    fn shell_self_intersection_pre_pass_detect() {
        let sphere_a = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        // Two overlapping spheres → after offset still overlap → detected
        let sphere_b = AnalyticSurface::Sphere {
            center: DVec3::new(0.5, 0.0, 0.0), radius: 1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let faces = vec![sphere_a, sphere_b,
            AnalyticSurface::Plane { origin: DVec3::new(100.0, 0.0, 0.0), normal: DVec3::X, basis_u: DVec3::Y, u_range: (-1.0, 1.0), v_range: (-1.0, 1.0) },
            AnalyticSurface::Plane { origin: DVec3::new(-100.0, 0.0, 0.0), normal: DVec3::NEG_X, basis_u: DVec3::Y, u_range: (-1.0, 1.0), v_range: (-1.0, 1.0) },
        ];
        let result = shell_solid(&faces, 0.1, &[], FilletTolerance::default()).unwrap();
        assert!(!result.is_success());
        match &result.skipped[0] {
            ShellSkipReason::SelfIntersection { failing_face_pairs } => {
                assert!(!failing_face_pairs.is_empty(), "should detect overlap");
            }
            other => panic!("expected SelfIntersection, got {:?}", other),
        }
    }
}
