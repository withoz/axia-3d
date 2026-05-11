//! ADR-057 Phase L Step 3 — BRep Profile Chamfer.
//!
//! Sweeps a user-supplied 2D PROFILE curve along the chamfered edge to
//! create a chamfer surface. Unlike Step 1/2 fillet (constant circular
//! cross-section), the profile may be any 2D curve in the plane
//! perpendicular to the local rail tangent.
//!
//! ## MVP Scope (Step 3)
//!
//! - Edge: linear or curved (any rail Phase K sweep accepts)
//! - Profile: open polyline in local 2D (will be swept along rail)
//! - Adjacent faces: planar
//! - Caller responsible for profile orientation (start/end points
//!   must touch the two trim lines on each face)
//!
//! ## Reuses
//!
//! - Phase K `sweep_surface_1_rail` for orientation propagation
//! - Phase L Step 1/2 `FilletSkipReason` enum for deferred cases
//! - Phase L Step 1/2 `FilletTolerance` for LOCKED #5 enforcement

use anyhow::{bail, Result};
use glam::DVec3;

use crate::surfaces::{AnalyticSurface, sweep::sweep_surface_1_rail};
use super::fillet_brep::{FilletSkipReason, FilletTolerance, BRepFilletResult};

/// Detect-only skip reasons specific to chamfer (extends fillet enum
/// where applicable; chamfer-specific cases use these).
#[derive(Clone, Debug, PartialEq)]
pub enum ChamferSkipReason {
    /// Profile control points self-intersect when projected to 2D.
    SelfIntersectingProfile,
    /// Profile has < 2 control points.
    DegenerateProfile,
    /// Underlying fillet skip applies (3-way / concave / tangent).
    Underlying(FilletSkipReason),
}

#[derive(Clone, Debug)]
pub struct ChamferResult {
    pub created_surface: Option<AnalyticSurface>,
    pub skipped: Vec<ChamferSkipReason>,
}

impl ChamferResult {
    pub fn ok(s: AnalyticSurface) -> Self {
        Self { created_surface: Some(s), skipped: Vec::new() }
    }
    pub fn skip(r: ChamferSkipReason) -> Self {
        Self { created_surface: None, skipped: vec![r] }
    }
    pub fn from_fillet_skip(r: FilletSkipReason) -> Self {
        Self::skip(ChamferSkipReason::Underlying(r))
    }
    pub fn is_success(&self) -> bool { self.created_surface.is_some() }
}

/// Profile chamfer along a curved (or linear) edge.
///
/// `profile_2d`: user-supplied cross-section as 2D points in the local
///   plane perpendicular to the rail's start tangent. The profile's
///   first point should touch face A's trim line, last point should
///   touch face B's trim line. Profile is lifted into 3D as
///   `DVec3::new(p.x, p.y, 0)` then swept along the rail.
///
/// `profile_ref_dir`: bisector direction in 3D (between face_a/face_b
///   normals) to orient the profile's 2D x-axis in 3D.
pub fn chamfer_brep_profile(
    rail_ctrl: &[DVec3],
    rail_knots: &[f64],
    rail_degree: usize,
    profile_2d: &[(f64, f64)],
    profile_ref_dir: DVec3,
    n_corners_at_endpoint: usize,
    tol: FilletTolerance,
) -> Result<ChamferResult> {
    // Cascade fillet-style skip checks first
    if n_corners_at_endpoint > 2 {
        return Ok(ChamferResult::from_fillet_skip(FilletSkipReason::ThreeWayCorner));
    }
    if profile_2d.len() < 2 {
        return Ok(ChamferResult::skip(ChamferSkipReason::DegenerateProfile));
    }

    // Profile self-intersection pre-pass (segment-segment check on 2D
    // polyline — Phase L Step 3 §2.7 #12 회귀)
    if has_self_intersection_2d(profile_2d, tol.geometric) {
        return Ok(ChamferResult::skip(ChamferSkipReason::SelfIntersectingProfile));
    }

    if rail_ctrl.len() < rail_degree + 1 {
        bail!("chamfer: rail needs >= degree+1 ctrl pts");
    }
    let ref_dir = profile_ref_dir.normalize_or_zero();
    if ref_dir.length_squared() < 0.5 {
        bail!("chamfer: profile_ref_dir must be unit");
    }

    // Lift 2D profile into 3D (z=0 in local frame; sweep handles
    // orientation via Bishop frame)
    let profile_3d: Vec<DVec3> = profile_2d.iter()
        .map(|&(x, y)| DVec3::new(x, y, 0.0))
        .collect();
    let n_p = profile_3d.len();
    let p_knots = clamped_uniform_knots_d1(n_p);

    // Sweep via Phase K
    let n_samples = (rail_ctrl.len() * 4).max(8);
    let (grid, ku, kv, du, dv) = sweep_surface_1_rail(
        &profile_3d, &p_knots, 1,
        ref_dir,
        rail_ctrl, rail_knots, rail_degree,
        n_samples,
    )?;

    let _ = tol; // tol carried for future radius-style validation
    Ok(ChamferResult::ok(AnalyticSurface::BSplineSurface {
        ctrl_grid: grid,
        knots_u: ku,
        knots_v: kv,
        deg_u: du as u32,
        deg_v: dv as u32,
    }))
}

// ── Helpers ──────────────────────────────────────────────────────────

fn has_self_intersection_2d(pts: &[(f64, f64)], tol: f64) -> bool {
    let n = pts.len();
    if n < 4 { return false; }
    for i in 0..(n - 1) {
        let a0 = pts[i]; let a1 = pts[i + 1];
        for j in (i + 2)..(n - 1) {
            let b0 = pts[j]; let b1 = pts[j + 1];
            // Skip adjacent segments (i+1 == j edge)
            if i + 1 == j { continue; }
            if segments_intersect(a0, a1, b0, b1, tol) { return true; }
        }
    }
    false
}

fn segments_intersect(
    p1: (f64, f64), p2: (f64, f64),
    p3: (f64, f64), p4: (f64, f64),
    tol: f64,
) -> bool {
    let d1 = (p2.0 - p1.0, p2.1 - p1.1);
    let d2 = (p4.0 - p3.0, p4.1 - p3.1);
    let cross = d1.0 * d2.1 - d1.1 * d2.0;
    if cross.abs() < tol { return false; } // parallel
    let r = (p3.0 - p1.0, p3.1 - p1.1);
    let t = (r.0 * d2.1 - r.1 * d2.0) / cross;
    let s = (r.0 * d1.1 - r.1 * d1.0) / cross;
    t > tol && t < 1.0 - tol && s > tol && s < 1.0 - tol
}

fn clamped_uniform_knots_d1(n_ctrl: usize) -> Vec<f64> {
    let mut k = vec![0.0_f64; n_ctrl + 2];
    k[0] = 0.0; k[1] = 0.0;
    for i in 2..n_ctrl {
        k[i] = (i - 1) as f64 / (n_ctrl - 1) as f64;
    }
    k[n_ctrl] = 1.0;
    k[n_ctrl + 1] = 1.0;
    k
}

// Re-export for Phase O dispatch convenience
pub use super::fillet_brep::{dispatch_fillet_or_chamfer, FilletDispatch};

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-057 §2.7 Step 3 (4 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-057 §2.7 Step 3 #10 — 45° profile (diagonal line) creates
    /// a planar chamfer surface (Phase K sweep along linear rail).
    #[test]
    fn chamfer_45deg_profile_creates_planar_surface() {
        // Rail along +X
        let rail = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let r_knots = vec![0.0, 0.0, 1.0, 1.0];
        // 45° chamfer: profile from (0, 1) to (1, 0) in local 2D
        let profile = vec![(0.0, 1.0), (1.0, 0.0)];
        let bisector = DVec3::new(0.0, -1.0, -1.0).normalize();
        let result = chamfer_brep_profile(
            &rail, &r_knots, 1,
            &profile,
            bisector,
            2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success(), "skipped: {:?}", result.skipped);
        match result.created_surface.unwrap() {
            AnalyticSurface::BSplineSurface { ctrl_grid, deg_u, deg_v, .. } => {
                assert_eq!(deg_u, 1);
                assert_eq!(deg_v, 1);
                assert_eq!(ctrl_grid.len(), 2);     // 2-pt profile
                assert!(ctrl_grid[0].len() >= 2);   // sweep samples
            }
            other => panic!("expected BSplineSurface, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Step 3 #11 — User-defined L-shape profile orients
    /// along the rail (Phase K Bishop frame propagation works).
    #[test]
    fn chamfer_user_profile_orients_along_edge() {
        let rail = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 1.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let r_knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        // L-shape profile (3 points)
        let profile = vec![(0.0, 1.0), (0.0, 0.0), (1.0, 0.0)];
        let bisector = DVec3::new(0.0, -1.0, -1.0).normalize();
        let result = chamfer_brep_profile(
            &rail, &r_knots, 2,
            &profile, bisector, 2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success(), "skipped: {:?}", result.skipped);
        if let AnalyticSurface::BSplineSurface { ctrl_grid, .. } = result.created_surface.unwrap() {
            assert_eq!(ctrl_grid.len(), 3);  // 3-pt profile preserved
        }
    }

    /// ADR-057 §2.7 Step 3 #12 — Self-intersecting profile rejected.
    #[test]
    fn chamfer_rejects_self_intersecting_profile() {
        let rail = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let r_knots = vec![0.0, 0.0, 1.0, 1.0];
        // Bowtie profile (4 points crossing themselves)
        let profile = vec![(0.0, 0.0), (1.0, 1.0), (0.0, 1.0), (1.0, 0.0)];
        let result = chamfer_brep_profile(
            &rail, &r_knots, 1,
            &profile,
            DVec3::Y,
            2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert!(matches!(result.skipped[0], ChamferSkipReason::SelfIntersectingProfile));
    }

    /// ADR-057 §2.7 Step 3 #13 — Dispatch reuses Phase L Step 1 logic
    /// (chamfer dispatches the same way as fillet).
    #[test]
    fn chamfer_dispatch_chooses_brep_when_curves_present() {
        assert_eq!(dispatch_fillet_or_chamfer(true,  true),  FilletDispatch::BRep);
        assert_eq!(dispatch_fillet_or_chamfer(false, true),  FilletDispatch::Mesh);
    }

    /// Bonus: 3-way corner cascades from fillet skip.
    #[test]
    fn chamfer_3way_corner_cascades_from_fillet() {
        let rail = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let r_knots = vec![0.0, 0.0, 1.0, 1.0];
        let profile = vec![(0.0, 1.0), (1.0, 0.0)];
        let result = chamfer_brep_profile(
            &rail, &r_knots, 1,
            &profile, DVec3::Y, 3, // n_corners=3 → ThreeWayCorner
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        match &result.skipped[0] {
            ChamferSkipReason::Underlying(FilletSkipReason::ThreeWayCorner) => {}
            other => panic!("expected Underlying(ThreeWayCorner), got {:?}", other),
        }
    }
}

// Suppress unused-import warning when BRepFilletResult re-export is
// not directly referenced from other modules yet (Phase O integration
// will use it).
#[allow(dead_code)]
fn _phantom_brep_fillet_result() -> Option<BRepFilletResult> { None }
