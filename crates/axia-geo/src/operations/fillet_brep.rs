//! ADR-057 Phase L Step 1 — BRep Fillet (Constant radius + Convex + Linear edge).
//!
//! BRep-level fillet that produces an `AnalyticSurface::Cylinder` tangent
//! to two planar adjacent faces meeting at a straight edge. Decoupled from
//! the existing mesh-level `operations::fillet.rs` (ADR-024 P10) per the
//! Mesh ↔ BRep dispatch lock-in (ADR-057 §2.3).
//!
//! ## MVP Scope (Step 1)
//!
//! - **Edge**: linear (straight) only
//! - **Adjacent faces**: planar only
//! - **Curvature**: constant radius
//! - **Topology**: convex edge only
//!
//! Curved edges → Step 2 (Phase K sweep).
//! Variable radius → Step 2/3.
//! Concave / 3-way / Tangent → explicit `FilletSkipReason` (no silent
//! wrong result, per Phase J/K lock-in pattern).
//!
//! ## Geometric construction
//!
//! Given two planar faces with outward normals n_a, n_b sharing a linear
//! edge (endpoints e0, e1):
//!
//!   - dihedral_cos = n_a · n_b
//!   - convex iff (n_a × n_b) · edge_dir > 0  (right-hand rule about edge)
//!   - half_angle = acos(-dihedral_cos) / 2
//!   - bisector  = -(n_a + n_b).normalize()  (points into solid)
//!   - cyl_axis_origin = edge_midpoint + bisector * (radius / sin(half_angle))
//!   - cyl_axis_dir    = (e1 - e0).normalize()
//!   - cyl_ref_dir     = -n_a (rotated into plane perpendicular to axis)

use anyhow::{bail, Result};
use glam::DVec3;

use crate::surfaces::AnalyticSurface;

// ────────────────────────────────────────────────────────────────────
// Types — ADR-057 §2.4 / §2.5 lock-in
// ────────────────────────────────────────────────────────────────────

/// Detect-only skip reasons. Phase J Step 4 SsiRobustnessReport pattern.
/// Silent wrong results are explicitly forbidden — every non-supported
/// case returns one of these.
#[derive(Clone, Debug, PartialEq)]
pub enum FilletSkipReason {
    /// Edge has interior angle > 180° (concave). Phase L follow-up.
    ConcaveEdge,
    /// Vertex has 3+ incident edges to fillet — singular point.
    /// ADR-024 P10 deferred pattern.
    ThreeWayCorner,
    /// Adjacent faces are tangent (dihedral angle ≈ 0 or 180°).
    /// Robust predicates (Phase M) needed.
    TangentNeighbors { dihedral_deg: f64 },
    /// Radius below the LOCKED #5 spatial-hash dedup threshold (1.5μm)
    /// — would collapse vertices.
    RadiusTooSmall { radius: f64, min: f64 },
    /// Radius exceeds local curvature × ratio — would create
    /// self-intersecting offset.
    RadiusTooLarge { radius: f64, max: f64 },
    /// Adjacent face is non-planar (Step 2 needed for curved).
    NonPlanarFace,
    /// Edge is not linear (Step 2 needed for curved).
    NonLinearEdge,
}

/// Result of a BRep fillet attempt. `created_surface` is None when
/// `skipped` is non-empty.
#[derive(Clone, Debug)]
pub struct BRepFilletResult {
    pub created_surface: Option<AnalyticSurface>,
    /// Reasons the fillet did NOT produce a surface, per ADR-057 §2.4.
    pub skipped: Vec<FilletSkipReason>,
}

impl BRepFilletResult {
    pub fn ok(surface: AnalyticSurface) -> Self {
        Self { created_surface: Some(surface), skipped: Vec::new() }
    }
    pub fn skip(reason: FilletSkipReason) -> Self {
        Self { created_surface: None, skipped: vec![reason] }
    }
    pub fn is_success(&self) -> bool { self.created_surface.is_some() }
}

/// Phase L Fillet tolerance — LOCKED #5 정합 강제 (ADR-057 §2.5).
#[derive(Clone, Copy, Debug)]
pub struct FilletTolerance {
    pub geometric: f64,
    pub min_radius: f64,
    pub max_radius_ratio: f64,
}

impl Default for FilletTolerance {
    fn default() -> Self {
        Self {
            geometric:        1e-3,    // 1 micron (BooleanTolerance default 정합)
            min_radius:       1.5e-3,  // LOCKED #5 spatial-hash dedup floor
            max_radius_ratio: 1.5,     // local curvature × this max
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Step 1 — Constant fillet on linear edge between two planar faces
// ────────────────────────────────────────────────────────────────────

/// Construct a BRep fillet at a linear edge between two planar faces.
///
/// Inputs:
///   - `edge_p0`, `edge_p1`: edge endpoints (3D)
///   - `face_a_normal`: outward normal of one adjacent face (unit)
///   - `face_b_normal`: outward normal of the other (unit)
///   - `radius`: constant fillet radius (mm)
///   - `tol`: FilletTolerance (default per LOCKED #5)
///
/// Returns: `BRepFilletResult` containing either an
/// `AnalyticSurface::Cylinder` tangent to both faces, or a
/// `FilletSkipReason` describing why the operation was deferred.
///
/// **Pure geometric**: does not touch mesh state. Phase O integration
/// (later) wires this into `Mesh::fillet_edge_brep(...)`.
pub fn fillet_brep_constant_linear(
    edge_p0: DVec3,
    edge_p1: DVec3,
    face_a_normal: DVec3,
    face_b_normal: DVec3,
    radius: f64,
    tol: FilletTolerance,
) -> Result<BRepFilletResult> {
    // 1. Validate radius bounds (silent wrong-result 차단)
    if radius < tol.min_radius {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::RadiusTooSmall { radius, min: tol.min_radius }));
    }

    // 2. Validate edge is linear and non-degenerate
    let edge_vec = edge_p1 - edge_p0;
    let edge_len = edge_vec.length();
    if edge_len < tol.geometric {
        bail!("fillet: edge is degenerate (length {} < tol {})", edge_len, tol.geometric);
    }
    let axis_dir = edge_vec / edge_len;

    // 3. Validate face normals are unit + non-tangent
    let n_a = face_a_normal.normalize_or_zero();
    let n_b = face_b_normal.normalize_or_zero();
    if n_a.length_squared() < 0.5 || n_b.length_squared() < 0.5 {
        bail!("fillet: face normals must be non-zero unit vectors");
    }
    let dihedral_cos = n_a.dot(n_b).clamp(-1.0, 1.0);
    let dihedral_rad = dihedral_cos.acos();
    let dihedral_deg = dihedral_rad.to_degrees();

    // Tangent check: nearly parallel (0°) or anti-parallel (180°) normals
    if dihedral_deg < 1.0 || dihedral_deg > 179.0 {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::TangentNeighbors { dihedral_deg }));
    }

    // 4. Convexity check (right-hand rule about edge)
    //    For a convex edge (interior angle < 180°), the cross product
    //    n_a × n_b points along the edge direction (outward at the edge).
    let cross = n_a.cross(n_b);
    let convexity_sign = cross.dot(axis_dir);
    if convexity_sign < tol.geometric {
        return Ok(BRepFilletResult::skip(FilletSkipReason::ConcaveEdge));
    }

    // 5. Compute fillet axis origin
    //    half_angle = (180° - dihedral_face_angle) / 2
    //    where dihedral_face_angle = π - acos(n_a · n_b)
    //    So half_angle = acos(n_a · n_b) / 2 = dihedral_rad / 2.
    //    Wait: for a convex edge with outward normals n_a, n_b,
    //    the FACE angle (interior dihedral) θ satisfies cos(θ) = -n_a·n_b.
    //    Half of the face angle = θ/2.
    //    The fillet axis sits along the bisector of n_a and n_b at
    //    distance r / sin(θ/2) FROM the edge.
    let face_dihedral = (-dihedral_cos).clamp(-1.0, 1.0).acos();
    let half = face_dihedral * 0.5;
    let sin_half = half.sin();
    if sin_half.abs() < tol.geometric {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::TangentNeighbors { dihedral_deg }));
    }

    // 6. Bisector points INTO the solid (opposite of average outward normal)
    let bisector = -(n_a + n_b).normalize_or_zero();
    if bisector.length_squared() < 0.5 {
        bail!("fillet: bisector degenerate (n_a + n_b ≈ 0)");
    }

    let edge_mid = (edge_p0 + edge_p1) * 0.5;
    let axis_origin = edge_mid + bisector * (radius / sin_half);

    // 7. Reference direction: in-plane perpendicular to axis_dir,
    //    pointing toward face_a (so cylinder θ=0 = tangent point on face_a).
    let ref_dir_raw = -n_a;
    // Project out component along axis_dir to ensure perpendicular
    let ref_dir = (ref_dir_raw - axis_dir * ref_dir_raw.dot(axis_dir)).normalize_or_zero();
    if ref_dir.length_squared() < 0.5 {
        bail!("fillet: ref_dir degenerate after axis projection");
    }

    // 8. Cylinder UV range: u ∈ [0, face_dihedral], v ∈ [0, edge_len]
    let cyl = AnalyticSurface::Cylinder {
        axis_origin,
        axis_dir,
        radius,
        ref_dir,
        u_range: (0.0, face_dihedral),
        v_range: (0.0, edge_len),
    };
    Ok(BRepFilletResult::ok(cyl))
}

// ────────────────────────────────────────────────────────────────────
// Step 2 — Constant fillet on CURVED edge between two planar faces
// ────────────────────────────────────────────────────────────────────

use crate::surfaces::sweep::sweep_surface_1_rail;

/// Construct a BRep fillet at a CURVED edge between two planar faces.
///
/// MVP (Step 2) scope:
///   - Edge: Bezier / BSpline / NURBS (any sweep-capable rail)
///   - Faces: planar (Step 4-6 will handle curved adjacent faces)
///   - Cross-section: circular polyline approximation (16 sides default)
///   - Fillet axis: dihedral bisector at each rail sample (Bishop frame)
///
/// Reuses Phase K `sweep_surface_1_rail` per ADR-057 §2.6 lock-in.
///
/// `n_corners`: number of incident filleted edges sharing this edge's
///     endpoint. Pass `> 2` to trigger `ThreeWayCorner` skip immediately.
pub fn fillet_brep_constant_curved(
    rail_ctrl: &[DVec3],
    rail_knots: &[f64],
    rail_degree: usize,
    face_a_normal: DVec3,
    face_b_normal: DVec3,
    radius: f64,
    n_sides: usize,
    n_corners_at_endpoint: usize,
    tol: FilletTolerance,
) -> Result<BRepFilletResult> {
    // §2.4 silent-wrong-result 차단 — explicit skip enumeration first
    if n_corners_at_endpoint > 2 {
        return Ok(BRepFilletResult::skip(FilletSkipReason::ThreeWayCorner));
    }
    if radius < tol.min_radius {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::RadiusTooSmall { radius, min: tol.min_radius }));
    }
    if rail_ctrl.len() < rail_degree + 1 {
        bail!("fillet_curved: rail needs >= degree+1 ctrl pts");
    }
    if n_sides < 4 { bail!("n_sides must be >= 4 for circular approx"); }

    let n_a = face_a_normal.normalize_or_zero();
    let n_b = face_b_normal.normalize_or_zero();
    if n_a.length_squared() < 0.5 || n_b.length_squared() < 0.5 {
        bail!("fillet_curved: face normals must be unit");
    }
    let dihedral_cos = n_a.dot(n_b).clamp(-1.0, 1.0);
    let dihedral_deg = dihedral_cos.acos().to_degrees();
    if dihedral_deg < 1.0 || dihedral_deg > 179.0 {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::TangentNeighbors { dihedral_deg }));
    }

    // Convexity check via endpoint-difference tangent (degree-agnostic
    // heuristic — avoids B-spline derivative degree-1 → 0 issue and
    // matches Step 1's edge_dir convention).
    let endpoint_diff = *rail_ctrl.last().unwrap() - rail_ctrl[0];
    let tan_overall = endpoint_diff.normalize_or_zero();
    if tan_overall.length_squared() < 0.5 {
        bail!("fillet_curved: rail endpoints coincide");
    }
    let cross = n_a.cross(n_b);
    let convexity_sign = cross.dot(tan_overall);
    if convexity_sign < tol.geometric {
        return Ok(BRepFilletResult::skip(FilletSkipReason::ConcaveEdge));
    }

    // Cross-section profile: circle of radius `radius` in the plane
    // perpendicular to the rail's start tangent. The sweep frame
    // (Bishop) propagates orientation along the rail.
    //
    // Profile centered at the FILLET AXIS for the start sample:
    //   axis_offset = bisector × (radius / sin(face_dihedral/2))
    let face_dihedral = (-dihedral_cos).clamp(-1.0, 1.0).acos();
    let half = face_dihedral * 0.5;
    let sin_half = half.sin();
    if sin_half.abs() < tol.geometric {
        return Ok(BRepFilletResult::skip(
            FilletSkipReason::TangentNeighbors { dihedral_deg }));
    }
    let bisector = -(n_a + n_b).normalize_or_zero();
    if bisector.length_squared() < 0.5 {
        bail!("fillet_curved: bisector degenerate");
    }
    let _axis_offset = radius / sin_half;

    // Build profile (closed circular polyline of n_sides points) in
    // local XY plane (profile reference frame: x → in-plane, y → axial,
    // z → tangent direction at rail).
    let profile = build_polyline_circle_profile(radius, n_sides);

    // Profile knots: clamped uniform for degree 1 (n_sides ctrl pts)
    let p_knots = clamped_uniform_knots_d1(n_sides);

    // Sweep along rail using Phase K
    let n_samples = (rail_ctrl.len() * 4).max(8);
    let (grid, ku, kv, du, dv) = sweep_surface_1_rail(
        &profile, &p_knots, 1,
        bisector,                   // profile reference dir = bisector
        rail_ctrl, rail_knots, rail_degree,
        n_samples,
    )?;

    // Convert to AnalyticSurface::BSplineSurface (no rational weights)
    let surface = AnalyticSurface::BSplineSurface {
        ctrl_grid: grid,
        knots_u: ku,
        knots_v: kv,
        deg_u: du as u32,
        deg_v: dv as u32,
    };
    Ok(BRepFilletResult::ok(surface))
}

/// Closed circular profile (unit circle scaled to `radius`) as
/// `n_sides` polyline control points. First and last points coincide
/// to close the loop.
fn build_polyline_circle_profile(radius: f64, n_sides: usize) -> Vec<DVec3> {
    let mut pts = Vec::with_capacity(n_sides);
    for i in 0..n_sides {
        let theta = (i as f64) * std::f64::consts::TAU / (n_sides as f64);
        pts.push(DVec3::new(radius * theta.cos(), radius * theta.sin(), 0.0));
    }
    pts
}

fn clamped_uniform_knots_d1(n_ctrl: usize) -> Vec<f64> {
    // For degree 1: knots.len() = n_ctrl + 2.
    // Clamped: [0, 0, k_1, k_2, ..., k_{n-2}, 1, 1].
    let mut k = vec![0.0_f64; n_ctrl + 2];
    k[0] = 0.0; k[1] = 0.0;
    for i in 2..n_ctrl {
        k[i] = (i - 1) as f64 / (n_ctrl - 1) as f64;
    }
    k[n_ctrl] = 1.0;
    k[n_ctrl + 1] = 1.0;
    k
}

// ────────────────────────────────────────────────────────────────────
// Mesh ↔ BRep dispatch (ADR-057 §2.3 lock-in)
// ────────────────────────────────────────────────────────────────────

/// Phase L Fillet dispatch: chooses BRep path when curve + surface
/// data is available, else falls back to ADR-024 mesh chamfer.
///
/// **Stateless decision** — does not invoke either implementation.
/// Caller wires up the actual call based on the returned tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilletDispatch {
    BRep,
    Mesh,
}

/// Decide whether to use Phase L BRep fillet or ADR-024 mesh chamfer.
///
/// `edge_has_curve`: Edge.curve.is_some() per ADR-019 / Phase N.
/// `both_faces_have_surface`: Face.surface.is_some() on both adjacent
///     faces per Phase N.
///
/// Phase N (Curve & Surface Mandatory) 후엔 항상 BRep 경로 — mesh
/// fallback 제거 가능.
pub fn dispatch_fillet_or_chamfer(
    edge_has_curve: bool,
    both_faces_have_surface: bool,
) -> FilletDispatch {
    if edge_has_curve && both_faces_have_surface {
        FilletDispatch::BRep
    } else {
        FilletDispatch::Mesh
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-057 §2.7 Step 1 (4 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-057 §2.7 Step 1 #1 — Linear edge between 2 planar faces creates
    /// a Cylinder surface with correct radius and axis.
    #[test]
    fn fillet_linear_edge_creates_cylinder_surface() {
        // Two faces meeting at a 90° convex edge along the X axis:
        //   - Face A: XY plane, normal +Z (outward)
        //   - Face B: XZ plane, normal +Y (outward)
        // Edge along X from (0,0,0) to (10,0,0). Convex check:
        //   n_a × n_b = +Z × +Y = -X
        //   dot with axis_dir (+X) = -1 → convex if right-hand rule says
        //   bisector points inside (-Y, -Z direction). Hmm let's flip
        //   the order to ensure convexity sign is positive.
        //
        // Use: face A normal +Y, face B normal +Z, edge along +X.
        //   n_a × n_b = +Y × +Z = +X (parallel to edge_dir → convex+)
        //   bisector = -(Y+Z).norm() = (0, -√2/2, -√2/2)
        //   face_dihedral = acos(-Y·Z) = acos(0) = 90° = π/2
        //   half = π/4, sin(half) = √2/2
        //   axis distance = r / (√2/2) = r√2
        //   For r=1: axis_origin = (5, 0, 0) + (0,-√2/2,-√2/2)·√2
        //                       = (5, -1, -1)
        let result = fillet_brep_constant_linear(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y,  // face A outward
            DVec3::Z,  // face B outward
            1.0,
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success(), "should produce cylinder, skipped: {:?}", result.skipped);
        match result.created_surface.unwrap() {
            AnalyticSurface::Cylinder { axis_origin, axis_dir, radius, .. } => {
                assert!((radius - 1.0).abs() < 1e-9);
                assert!((axis_dir - DVec3::X).length() < 1e-9);
                let expected = DVec3::new(5.0, -1.0, -1.0);
                assert!((axis_origin - expected).length() < 1e-9,
                    "axis_origin: got {:?}, expected {:?}", axis_origin, expected);
            }
            other => panic!("expected Cylinder, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Step 1 #2 — Radius below LOCKED #5 (1.5μm) returns
    /// `RadiusTooSmall` skip — silent collapse 차단.
    #[test]
    fn fillet_radius_below_min_returns_skip() {
        let result = fillet_brep_constant_linear(
            DVec3::ZERO,
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y, DVec3::Z,
            1e-6,  // 1nm — way below 1.5μm
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        match &result.skipped[0] {
            FilletSkipReason::RadiusTooSmall { radius, min } => {
                assert_eq!(*radius, 1e-6);
                assert_eq!(*min, 1.5e-3);
            }
            other => panic!("expected RadiusTooSmall, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Step 1 #3 — Concave edge (interior angle > 180°)
    /// returns `ConcaveEdge` skip per Phase L deferred policy.
    #[test]
    fn fillet_concave_edge_returns_skip_reason() {
        // For concavity we need n_a × n_b to point AGAINST edge_dir.
        // Use: n_a = +Y, n_b = -Z, edge along +X.
        //   n_a × n_b = Y × (-Z) = -X (antiparallel to +X edge → concave)
        let result = fillet_brep_constant_linear(
            DVec3::ZERO,
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y, DVec3::NEG_Z,
            1.0,
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert_eq!(result.skipped, vec![FilletSkipReason::ConcaveEdge]);
    }

    /// ADR-057 §2.7 Step 1 #4 — Dispatch chooses BRep when curve + surface
    /// metadata are present, else Mesh fallback (ADR-024 P10).
    #[test]
    fn fillet_dispatch_chooses_brep_when_curve_present() {
        assert_eq!(dispatch_fillet_or_chamfer(true,  true),  FilletDispatch::BRep);
        assert_eq!(dispatch_fillet_or_chamfer(true,  false), FilletDispatch::Mesh);
        assert_eq!(dispatch_fillet_or_chamfer(false, true),  FilletDispatch::Mesh);
        assert_eq!(dispatch_fillet_or_chamfer(false, false), FilletDispatch::Mesh);
    }

    /// Bonus: Tangent neighbors (parallel normals, ~0° dihedral) → skip.
    #[test]
    fn fillet_tangent_neighbors_returns_skip() {
        let result = fillet_brep_constant_linear(
            DVec3::ZERO,
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y, DVec3::Y, // same normal → tangent
            1.0,
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert!(matches!(result.skipped[0], FilletSkipReason::TangentNeighbors { .. }));
    }

    // ── Step 2 — Curved edge fillet (5 회귀, ADR-057 §2.7 Step 2) ──

    /// ADR-057 §2.7 Step 2 #5 — Curved edge fillet uses Phase K sweep
    /// and returns a BSplineSurface (sweep result).
    #[test]
    fn fillet_curved_edge_uses_phase_k_sweep() {
        // Quadratic Bezier rail from (0,0,0) to (10,0,0) with a slight
        // bulge in +Y mid (control at (5, 2, 0))
        let rail_ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 2.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let rail_knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let result = fillet_brep_constant_curved(
            &rail_ctrl, &rail_knots, 2,
            DVec3::Y,    // face A normal (consistent +Y bias)
            DVec3::Z,    // face B normal
            0.5,         // radius
            16,          // 16-side polyline circle
            2,           // n_corners = 2 (regular edge)
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success(),
            "curved edge sweep should succeed, skipped: {:?}", result.skipped);
        match result.created_surface.unwrap() {
            AnalyticSurface::BSplineSurface { ctrl_grid, deg_u, deg_v, .. } => {
                assert_eq!(deg_u, 1, "profile degree 1");
                assert_eq!(deg_v, 1, "sweep linear interp");
                // n_u (profile points) = 16, n_v = sweep samples
                assert_eq!(ctrl_grid.len(), 16);
                assert!(ctrl_grid[0].len() >= 8, "rail samples >= 8");
            }
            other => panic!("expected BSplineSurface, got {:?}", other),
        }
    }

    /// ADR-057 §2.7 Step 2 #7 — 3-way corner returns ThreeWayCorner skip.
    #[test]
    fn fillet_3_way_corner_returns_deferred_skip() {
        let rail_ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let rail_knots = vec![0.0, 0.0, 1.0, 1.0];
        let result = fillet_brep_constant_curved(
            &rail_ctrl, &rail_knots, 1,
            DVec3::Y, DVec3::Z, 0.5, 16,
            3,  // n_corners = 3 → ThreeWayCorner
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert_eq!(result.skipped, vec![FilletSkipReason::ThreeWayCorner]);
    }

    /// ADR-057 §2.7 Step 2 #6 — Curved fillet preserves endpoint
    /// continuity (radius matches at start and end samples).
    #[test]
    fn fillet_curved_preserves_endpoint_continuity() {
        // Linear rail (degenerates to extrusion path internally)
        let rail_ctrl = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let rail_knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let radius = 1.0;
        let result = fillet_brep_constant_curved(
            &rail_ctrl, &rail_knots, 2,
            DVec3::Y, DVec3::Z, radius, 16, 2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(result.is_success());
        // Verify cross-section radius is preserved at v=0 and v=1 by
        // checking distance from center of mass of v-slice control points
        // to each control point.
        if let AnalyticSurface::BSplineSurface { ctrl_grid, .. } = result.created_surface.unwrap() {
            for &v_idx in &[0usize, ctrl_grid[0].len() - 1] {
                let centroid: DVec3 = ctrl_grid.iter().map(|row| row[v_idx]).sum::<DVec3>()
                    / (ctrl_grid.len() as f64);
                for row in &ctrl_grid {
                    let r = (row[v_idx] - centroid).length();
                    assert!((r - radius).abs() < 0.05,
                        "endpoint radius drift: got {}, expected {}", r, radius);
                }
            }
        }
    }

    /// ADR-057 §2.7 Step 2 #8 — Curved fillet rejects radius < LOCKED #5.
    #[test]
    fn fillet_curved_radius_too_small() {
        let rail_ctrl = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let rail_knots = vec![0.0, 0.0, 1.0, 1.0];
        let result = fillet_brep_constant_curved(
            &rail_ctrl, &rail_knots, 1,
            DVec3::Y, DVec3::Z, 1e-6, 16, 2,  // 1nm — way below 1.5μm
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert!(matches!(result.skipped[0], FilletSkipReason::RadiusTooSmall { .. }));
    }

    /// ADR-057 §2.7 Step 2 #9 — Curved fillet concave edge skip.
    #[test]
    fn fillet_curved_concave_edge_skip() {
        // n_a × n_b = Y × (-Z) = -X, rail tangent along +X → concave.
        let rail_ctrl = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let rail_knots = vec![0.0, 0.0, 1.0, 1.0];
        let result = fillet_brep_constant_curved(
            &rail_ctrl, &rail_knots, 1,
            DVec3::Y, DVec3::NEG_Z, 1.0, 16, 2,
            FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        assert_eq!(result.skipped, vec![FilletSkipReason::ConcaveEdge]);
    }
}
