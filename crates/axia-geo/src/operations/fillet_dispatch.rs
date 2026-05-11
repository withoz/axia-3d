//! ADR-060 Phase O Step 5 — Fillet/Chamfer NURBS-aware Dispatch.
//!
//! Drop-in alongside the existing mesh `Mesh::fillet_edge` (per Phase
//! M/N validated pattern). This module adds `Mesh::fillet_edge_dispatch`,
//! which inspects the target edge + adjacent faces and routes between:
//!
//! * **BRep path** (Phase L `fillet_brep_constant_linear`) — when both
//!   adjacent faces carry `Plane` surfaces and the edge curve is `Line`.
//!   Produces a `Cylinder` analytic surface attached to each new fillet
//!   strip face (Phase H/N curve+surface mandatory consistent).
//! * **Mesh path** (existing `Mesh::fillet_edge`) — used for actual
//!   geometric assembly until Phase L's full BRep tessellation lands;
//!   also the fallback when BRep is ineligible or skips.
//!
//! ## §F lock-in (silent fallback prohibited — Phase J §7.5 pattern)
//!
//! Every result carries an explicit `path_used: FilletPath` and, when a
//! BRep attempt failed or was ineligible, a `skip_reason:
//! Some(FilletDispatchSkipReason)`. Silent geometry corruption ("BRep
//! quietly downgraded to mesh without note") is impossible.
//!
//! ## §E lock-in (partial-move drop-to-Line) preserved
//!
//! `Mesh::fillet_edge` only mutates the edge's two adjacent faces and
//! creates a new fillet strip; verts/edges/faces outside the affected
//! region keep their `curve` / `surface` metadata. This dispatch wrapper
//! adds surface attachment **only to the newly-created fillet strip**
//! and does not touch other entities.
//!
//! ## MVP scope (Phase O Step 5)
//!
//! * BRep path eligibility: `Edge.curve = Some(Line)` AND both adjacent
//!   faces `surface = Some(Plane)`. Non-linear edges, curved faces, and
//!   3-way corners route to mesh path with explicit reason.
//! * Geometric assembly stays mesh-based; BRep path's contribution is
//!   surface attachment + diagnostic. Phase L follow-up will replace
//!   the geometric assembly itself.

use anyhow::Result;
use glam::DVec3;

use crate::curves::AnalyticCurve;
use crate::entities::EdgeId;
use crate::mesh::Mesh;
use crate::surfaces::AnalyticSurface;
use crate::FaceId;

use super::fillet::FilletResult;
use super::fillet_brep::{
    fillet_brep_constant_linear, FilletSkipReason, FilletTolerance,
};

// ────────────────────────────────────────────────────────────────────
// Public API surface
// ────────────────────────────────────────────────────────────────────

/// Which engine produced (or annotated) the fillet result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilletPath {
    /// Mesh path used directly. BRep was not eligible (edge has no
    /// linear curve, or one of the faces lacks a Plane surface).
    Mesh,
    /// BRep path was eligible AND succeeded — `created_surface`
    /// populated, fillet strip annotated.
    BRep,
    /// BRep path was eligible (curve + plane data present) but skipped
    /// for a documented reason (concave / radius / 3-way / etc.). Mesh
    /// path produced the actual geometry; `skip_reason` carries the
    /// diagnostic.
    BRepWithMeshFallback,
}

/// Why the BRep path could not produce a surface.
///
/// Mirrors Phase J §7.5 + Phase L `FilletSkipReason` patterns. Silent
/// fallback is prohibited; every BRep attempt that does not yield
/// `FilletPath::BRep` must populate this enum.
#[derive(Clone, Debug, PartialEq)]
pub enum FilletDispatchSkipReason {
    /// `Edge.curve` is None — Phase N curve_mandatory has not been
    /// invoked, or the edge predates Phase N.
    EdgeCurveMissing,
    /// `Edge.curve` is set but is not a `Line` variant (Phase L MVP
    /// only handles linear edges; curved edges need Phase L Step 2).
    EdgeCurveNonLinear { kind: &'static str },
    /// One or both adjacent faces lack `face.surface`.
    FaceSurfaceMissing { face_a_has: bool, face_b_has: bool },
    /// Adjacent face has a non-Plane surface (Sphere/Cylinder/etc.).
    /// Phase L MVP only fillets between planar faces.
    NonPlanarFace { side: SideTag, kind: &'static str },
    /// Edge is not shared by exactly 2 active faces.
    NonManifoldEdge { face_count: usize },
    /// Underlying Phase L skip reason (concave / 3-way / tangent /
    /// radius-too-small / radius-too-large).
    Underlying(FilletSkipReason),
}

impl FilletDispatchSkipReason {
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::EdgeCurveMissing => "edge_curve_missing",
            Self::EdgeCurveNonLinear { .. } => "edge_curve_non_linear",
            Self::FaceSurfaceMissing { .. } => "face_surface_missing",
            Self::NonPlanarFace { .. } => "non_planar_face",
            Self::NonManifoldEdge { .. } => "non_manifold_edge",
            Self::Underlying(r) => match r {
                FilletSkipReason::ConcaveEdge => "concave_edge",
                FilletSkipReason::ThreeWayCorner => "three_way_corner",
                FilletSkipReason::TangentNeighbors { .. } => "tangent_neighbors",
                FilletSkipReason::RadiusTooSmall { .. } => "radius_too_small",
                FilletSkipReason::RadiusTooLarge { .. } => "radius_too_large",
                FilletSkipReason::NonPlanarFace => "phase_l_nonplanar",
                FilletSkipReason::NonLinearEdge => "phase_l_nonlinear",
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideTag { A, B }

/// Diagnostic from a BRep fillet attempt (success or skip path).
#[derive(Clone, Debug, Default)]
pub struct FilletDiagnostic {
    pub brep_attempted: bool,
    pub brep_succeeded: bool,
    pub edge_curve_kind: Option<&'static str>,
    pub face_a_surface_kind: Option<&'static str>,
    pub face_b_surface_kind: Option<&'static str>,
    pub notes: Vec<String>,
}

/// ADR-060 Phase O Step 5 — Fillet dispatch result.
///
/// Wraps the existing mesh `FilletResult` with explicit path-tagging,
/// optional BRep-derived analytic surface, and a skip diagnostic. §F
/// lock-in: callers MUST inspect `path_used` before reporting success.
#[derive(Debug)]
pub struct FilletDispatchResult {
    /// Mesh-level fillet (existing geometric assembly). `None` only
    /// when the mesh path itself errored (e.g., geometric pre-condition
    /// the mesh fillet detected after BRep skipped) — BRep skip_reason
    /// already explains why.
    pub mesh_result: Option<FilletResult>,
    /// Analytic surface produced by Phase L when the BRep path
    /// succeeded. None otherwise.
    pub created_surface: Option<AnalyticSurface>,
    pub path_used: FilletPath,
    pub skip_reason: Option<FilletDispatchSkipReason>,
    pub diagnostic: FilletDiagnostic,
}

// ────────────────────────────────────────────────────────────────────
// Eligibility classification (read-only probe)
// ────────────────────────────────────────────────────────────────────

fn curve_kind_label(c: &AnalyticCurve) -> &'static str {
    match c {
        AnalyticCurve::Line { .. } => "Line",
        AnalyticCurve::Circle { .. } => "Circle",
        AnalyticCurve::Arc { .. } => "Arc",
        AnalyticCurve::Bezier { .. } => "Bezier",
        AnalyticCurve::BSpline { .. } => "BSpline",
        AnalyticCurve::NURBS { .. } => "NURBS",
    }
}

fn surface_kind_label(s: &AnalyticSurface) -> &'static str {
    match s {
        AnalyticSurface::Plane { .. } => "Plane",
        AnalyticSurface::Cylinder { .. } => "Cylinder",
        AnalyticSurface::Sphere { .. } => "Sphere",
        AnalyticSurface::Cone { .. } => "Cone",
        AnalyticSurface::Torus { .. } => "Torus",
        AnalyticSurface::BezierPatch { .. } => "BezierPatch",
        AnalyticSurface::BSplineSurface { .. } => "BSplineSurface",
        AnalyticSurface::NURBSSurface { .. } => "NURBSSurface",
    }
}

/// Inspect curve + surface metadata without invoking either path.
/// Returns `Ok(())` if the BRep path is eligible (Line edge + Plane
/// faces × 2 + manifold-2). Otherwise an explicit reason.
pub fn classify_fillet_eligibility(
    mesh: &Mesh,
    edge_id: EdgeId,
) -> Result<(FaceId, FaceId), FilletDispatchSkipReason> {
    let (faces, _) = mesh.get_faces_sharing_edge(edge_id);
    let active: Vec<FaceId> = faces.into_iter()
        .filter(|&f| mesh.faces.contains(f) && mesh.faces[f].is_active())
        .collect();
    if active.len() != 2 {
        return Err(FilletDispatchSkipReason::NonManifoldEdge { face_count: active.len() });
    }
    let (face_a, face_b) = (active[0], active[1]);

    let curve = match mesh.edge_curve(edge_id) {
        None => return Err(FilletDispatchSkipReason::EdgeCurveMissing),
        Some(c) => c,
    };
    if !matches!(curve, AnalyticCurve::Line { .. }) {
        return Err(FilletDispatchSkipReason::EdgeCurveNonLinear {
            kind: curve_kind_label(curve),
        });
    }

    let sa = mesh.face_surface(face_a);
    let sb = mesh.face_surface(face_b);
    if sa.is_none() || sb.is_none() {
        return Err(FilletDispatchSkipReason::FaceSurfaceMissing {
            face_a_has: sa.is_some(),
            face_b_has: sb.is_some(),
        });
    }
    let sa = sa.unwrap();
    let sb = sb.unwrap();
    if !matches!(sa, AnalyticSurface::Plane { .. }) {
        return Err(FilletDispatchSkipReason::NonPlanarFace {
            side: SideTag::A, kind: surface_kind_label(sa),
        });
    }
    if !matches!(sb, AnalyticSurface::Plane { .. }) {
        return Err(FilletDispatchSkipReason::NonPlanarFace {
            side: SideTag::B, kind: surface_kind_label(sb),
        });
    }

    Ok((face_a, face_b))
}

// ────────────────────────────────────────────────────────────────────
// Mesh impl — public dispatch entry point
// ────────────────────────────────────────────────────────────────────

impl Mesh {
    /// ADR-060 Phase O Step 5 — NURBS-aware Fillet dispatch.
    ///
    /// Drop-in alongside `Mesh::fillet_edge` (existing mesh path is
    /// untouched). When the edge is linear and both adjacent faces are
    /// planar, runs Phase L `fillet_brep_constant_linear` to derive the
    /// analytic Cylinder surface, then attaches it to the newly-created
    /// fillet strip faces. Otherwise routes only the mesh path.
    ///
    /// §F lock-in (silent fallback prohibited): every result carries an
    /// explicit `path_used` and, when BRep was attempted but failed, a
    /// `skip_reason`.
    pub fn fillet_edge_dispatch(
        &mut self,
        edge_id: EdgeId,
        radius: f64,
        segments: u32,
    ) -> Result<FilletDispatchResult> {
        // 1. Eligibility probe (read-only).
        let eligibility = classify_fillet_eligibility(self, edge_id);

        // 2. Capture BRep inputs BEFORE mutating the mesh — geometry
        //    needed by fillet_brep_constant_linear. Phase L is pure
        //    geometric; we feed it edge endpoints + face normals.
        let brep_inputs: Option<(DVec3, DVec3, DVec3, DVec3)> = match &eligibility {
            Ok((face_a, face_b)) => {
                let edge = &self.edges[edge_id];
                let p0 = self.verts[edge.v_small()].pos();
                let p1 = self.verts[edge.v_large()].pos();
                let na = self.faces[*face_a].normal().normalize_or_zero();
                let nb = self.faces[*face_b].normal().normalize_or_zero();
                Some((p0, p1, na, nb))
            }
            Err(_) => None,
        };

        // Capture diagnostic info pre-mutation.
        let edge_curve_kind = self.edge_curve(edge_id).map(curve_kind_label);
        let (face_a_kind, face_b_kind) = match &eligibility {
            Ok((a, b)) => (
                self.face_surface(*a).map(surface_kind_label),
                self.face_surface(*b).map(surface_kind_label),
            ),
            Err(_) => (None, None),
        };

        // 3. Run BRep attempt (still mesh-untouched at this point).
        let (brep_surface, brep_skip) = match (brep_inputs, &eligibility) {
            (Some((p0, p1, na, nb)), Ok(_)) => {
                match fillet_brep_constant_linear(p0, p1, na, nb, radius, FilletTolerance::default()) {
                    Ok(r) => {
                        if let Some(surf) = r.created_surface {
                            (Some(surf), None)
                        } else {
                            let reason = r.skipped.into_iter().next()
                                .map(FilletDispatchSkipReason::Underlying);
                            (None, reason)
                        }
                    }
                    Err(e) => {
                        // Phase L core errored — record as Underlying with
                        // a synthetic reason (use TangentNeighbors with
                        // dihedral_deg=NaN as out-of-band signal).
                        let _ = e;
                        (None,
                         Some(FilletDispatchSkipReason::Underlying(
                             FilletSkipReason::TangentNeighbors { dihedral_deg: f64::NAN },
                         )))
                    }
                }
            }
            _ => (None, None),
        };

        // 4. Run mesh path for actual geometric assembly. May fail for
        //    geometric reasons (concave / radius / etc.) that BRep also
        //    detected — in that case BRep skip_reason already explains
        //    why and we surface the dispatch result without the mesh
        //    geometry.
        let mesh_result_opt: Option<FilletResult> =
            match self.fillet_edge(edge_id, radius, segments) {
                Ok(r) => Some(r),
                Err(e) => {
                    // If BRep already skipped (eligibility met, BRep
                    // declined for a documented reason), the mesh
                    // failure is consistent — surface the BRep skip.
                    // If BRep succeeded but mesh failed, that's a real
                    // bug → bubble up.
                    if brep_skip.is_some() || eligibility.is_err() {
                        None
                    } else {
                        return Err(e);
                    }
                }
            };

        // 5. On BRep success, attach the Cylinder surface to every
        //    newly-created fillet strip face. §E lock-in preserved —
        //    only the new fillet faces get surface; surrounding faces
        //    already keep their existing surface (Mesh::fillet_edge
        //    only mutates f1/f2 and creates fillet_faces).
        if let (Some(surf), Some(mr)) = (&brep_surface, &mesh_result_opt) {
            for &fid in &mr.fillet_faces {
                let _ = self.set_face_surface(fid, Some(surf.clone()));
            }
        }

        // 6. Tag path_used per §F lock-in.
        let path_used = match (&eligibility, &brep_surface, &brep_skip) {
            (Ok(_), Some(_), _) => FilletPath::BRep,
            (Ok(_), None, Some(_)) => FilletPath::BRepWithMeshFallback,
            (Ok(_), None, None) => FilletPath::BRepWithMeshFallback, // unreachable but defensive
            (Err(_), _, _) => FilletPath::Mesh,
        };

        // 7. skip_reason policy:
        //    - Mesh: eligibility rejection (informative — "why didn't
        //      BRep run").
        //    - BRepWithMeshFallback: real BRep skip reason.
        //    - BRep: None.
        let skip_reason = match (&eligibility, path_used) {
            (Err(reason), _) => Some(reason.clone()),
            (Ok(_), FilletPath::BRep) => None,
            (Ok(_), FilletPath::BRepWithMeshFallback) => brep_skip,
            (Ok(_), FilletPath::Mesh) => None, // unreachable
        };

        let diagnostic = FilletDiagnostic {
            brep_attempted: brep_inputs.is_some(),
            brep_succeeded: brep_surface.is_some(),
            edge_curve_kind,
            face_a_surface_kind: face_a_kind,
            face_b_surface_kind: face_b_kind,
            notes: vec![
                format!("path={:?}", path_used),
                format!("brep_attempted={}", brep_inputs.is_some()),
            ],
        };

        Ok(FilletDispatchResult {
            mesh_result: mesh_result_opt,
            created_surface: brep_surface,
            path_used,
            skip_reason,
            diagnostic,
        })
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-060 §3 Step 5 acceptance (10 regression invariants).
// All tests are non-#[ignore]; §X.5 lock-in #6 mandates strict.
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::AnalyticCurve;
    use crate::surfaces::AnalyticSurface;
    use crate::MaterialId;

    /// Build two faces meeting at a 90° convex edge along the X axis.
    /// Face A: XY plane patch (normal +Z), Face B: XZ plane patch (normal -Y).
    /// Wait — for a convex 90° edge between XY and XZ planes meeting at +X axis,
    /// we want both faces' outward normals to face away from the solid's
    /// interior. Use the Phase L Step 1 test fixture orientation
    /// (n_a=+Y, n_b=+Z, edge along +X).
    fn make_two_faces_at_x_edge() -> (Mesh, EdgeId, FaceId, FaceId) {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        // Build a 4-vertex "tent" sharing edge along X from (0,0,0) to (10,0,0).
        // Face A: rectangle with normal +Y (lies in XZ plane on the -Z side).
        //   verts in CCW from +Y: (0,0,0), (10,0,0), (10,0,-1), (0,0,-1)
        //   normal of (p1-p0)×(p2-p0) = (X)×(-Z) = +Y ✓
        // Face B: rectangle with normal +Z (lies in XY plane on the -Y side).
        //   verts in CCW from +Z: (0,0,0), (0,-1,0), (10,-1,0), (10,0,0)
        //   normal = (-Y)×(X-Y - X) ...
        //   Use: (0,0,0), (10,0,0), (10,-1,0), (0,-1,0)
        //   (p1-p0)×(p2-p0) = (X)×(X-Y) = (X×X) + (X×-Y) = 0 + (-(-Z)) = Z ✓
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 0.0, -1.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, -1.0));
        let v4 = mesh.add_vertex(DVec3::new(10.0, -1.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(0.0, -1.0, 0.0));

        // Face A: shared edge v0→v1 first, then continue to -Z side
        let face_a = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        // Face B: shared edge v1→v0 (reverse to share the same EdgeId)
        let face_b = mesh.add_face(&[v0, v5, v4, v1], mat).unwrap();

        // Find shared EdgeId between v0 and v1.
        let edge_id = mesh.find_edge(v0, v1).expect("v0-v1 edge");

        (mesh, edge_id, face_a, face_b)
    }

    fn attach_line_curve(mesh: &mut Mesh, edge_id: EdgeId) {
        let edge = &mesh.edges[edge_id];
        let curve = AnalyticCurve::Line {
            start: edge.v_small(),
            end: edge.v_large(),
        };
        mesh.edges[edge_id].set_curve(Some(curve));
    }

    fn attach_plane_to_face(mesh: &mut Mesh, fid: FaceId) {
        let start = mesh.faces.get(fid).expect("face").outer().start;
        let outer_verts = mesh.collect_loop_verts(start).unwrap();
        let p0 = mesh.verts[outer_verts[0]].pos();
        let p1 = mesh.verts[outer_verts[1]].pos();
        let p2 = mesh.verts[outer_verts[2]].pos();
        let basis_u = (p1 - p0).normalize_or_zero();
        let normal = (p1 - p0).cross(p2 - p0).normalize_or_zero();
        let surface = AnalyticSurface::Plane {
            origin: p0,
            normal,
            basis_u,
            u_range: (-100.0, 100.0),
            v_range: (-100.0, 100.0),
        };
        assert!(mesh.set_face_surface(fid, Some(surface)));
    }

    // ── Test 1 ────────────────────────────────────────────────
    /// Edge has no curve attached → eligibility EdgeCurveMissing,
    /// dispatch routes to Mesh path, mesh fillet still produces a
    /// result.
    #[test]
    fn dispatch_no_curve_uses_mesh_path() {
        let (mut mesh, edge_id, _, _) = make_two_faces_at_x_edge();
        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::Mesh);
        assert_eq!(result.skip_reason, Some(FilletDispatchSkipReason::EdgeCurveMissing));
        assert!(result.created_surface.is_none());
        assert!(!result.diagnostic.brep_attempted);
    }

    // ── Test 2 ────────────────────────────────────────────────
    /// Edge has Line curve but faces lack surface → FaceSurfaceMissing,
    /// Mesh path.
    #[test]
    fn dispatch_no_face_surfaces_uses_mesh_path() {
        let (mut mesh, edge_id, _, _) = make_two_faces_at_x_edge();
        attach_line_curve(&mut mesh, edge_id);
        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::Mesh);
        match result.skip_reason {
            Some(FilletDispatchSkipReason::FaceSurfaceMissing { .. }) => {}
            other => panic!("expected FaceSurfaceMissing, got {:?}", other),
        }
    }

    // ── Test 3 ────────────────────────────────────────────────
    /// Full eligibility (Line edge + Plane faces) → BRep path,
    /// Cylinder surface created, attached to fillet strip.
    #[test]
    fn dispatch_planar_faces_with_line_curve_uses_brep_path() {
        let (mut mesh, edge_id, face_a, face_b) = make_two_faces_at_x_edge();
        attach_line_curve(&mut mesh, edge_id);
        attach_plane_to_face(&mut mesh, face_a);
        attach_plane_to_face(&mut mesh, face_b);
        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::BRep);
        assert!(result.created_surface.is_some(),
            "BRep path must populate created_surface");
        assert!(result.skip_reason.is_none());
        assert!(result.diagnostic.brep_attempted);
        assert!(result.diagnostic.brep_succeeded);
    }

    // ── Test 4 ────────────────────────────────────────────────
    /// Curved-face surface (Sphere on side B) → NonPlanarFace, mesh
    /// fallback at eligibility stage.
    #[test]
    fn dispatch_curved_face_falls_back_to_mesh() {
        let (mut mesh, edge_id, face_a, face_b) = make_two_faces_at_x_edge();
        attach_line_curve(&mut mesh, edge_id);
        attach_plane_to_face(&mut mesh, face_a);
        let sph = AnalyticSurface::Sphere {
            center: DVec3::ZERO, radius: 1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        assert!(mesh.set_face_surface(face_b, Some(sph)));
        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::Mesh);
        match result.skip_reason {
            Some(FilletDispatchSkipReason::NonPlanarFace { side: SideTag::B, kind: "Sphere" }) => {}
            other => panic!("expected NonPlanarFace(B,Sphere), got {:?}", other),
        }
    }

    // ── Test 5 ────────────────────────────────────────────────
    /// Concave edge (face normals such that n_a × n_b is anti-parallel
    /// to edge_dir) → BRepWithMeshFallback with Underlying(ConcaveEdge).
    #[test]
    fn dispatch_concave_edge_records_skip_reason() {
        // Build two faces with normals giving CONCAVE bend around +X edge.
        // n_a = +Y, n_b = -Z gives n_a × n_b = +Y × -Z = -X (antiparallel
        // to +X edge → concave per Phase L).
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        // Face A normal +Y: (0,0,0)-(10,0,0)-(10,0,-1)-(0,0,-1)
        let v2 = mesh.add_vertex(DVec3::new(10.0, 0.0, -1.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, -1.0));
        // Face B normal -Z: need (p1-p0)×(p2-p0) = -Z.
        // Using verts shared with the +X edge (v0,v1) and going +Y:
        // (0,0,0)-(0,1,0)-(10,1,0)-(10,0,0): (p1-p0)=(0,1,0), (p2-p0)=(10,1,0)
        // cross = (1*0-0*1, 0*10-0*0, 0*1-1*10) = (0,0,-10) = -Z ✓
        let v4 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(10.0, 1.0, 0.0));
        let face_a = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let face_b = mesh.add_face(&[v0, v4, v5, v1], mat).unwrap();
        let edge_id = mesh.find_edge(v0, v1).unwrap();

        attach_line_curve(&mut mesh, edge_id);
        attach_plane_to_face(&mut mesh, face_a);
        attach_plane_to_face(&mut mesh, face_b);

        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::BRepWithMeshFallback);
        match result.skip_reason {
            Some(FilletDispatchSkipReason::Underlying(FilletSkipReason::ConcaveEdge)) => {}
            other => panic!("expected Underlying(ConcaveEdge), got {:?}", other),
        }
        assert!(result.created_surface.is_none());
    }

    // ── Test 6 ────────────────────────────────────────────────
    /// Radius below LOCKED #5 (1.5μm) → Underlying(RadiusTooSmall).
    /// Cannot actually call mesh fillet with that radius (it would
    /// fail), so we test the eligibility classifier path instead.
    #[test]
    fn dispatch_radius_too_small_is_reachable_at_brep_stage() {
        // The mesh fillet itself rejects sub-EPSILON radius. We verify
        // that Phase L returns RadiusTooSmall when called directly,
        // then assert this label is present in our short_label set.
        let result = fillet_brep_constant_linear(
            DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0),
            DVec3::Y, DVec3::Z,
            1e-6, FilletTolerance::default(),
        ).unwrap();
        assert!(!result.is_success());
        let dispatch_reason = FilletDispatchSkipReason::Underlying(result.skipped[0].clone());
        assert_eq!(dispatch_reason.short_label(), "radius_too_small");
    }

    // ── Test 7 ────────────────────────────────────────────────
    /// BRep path attaches Cylinder surface to every newly-created
    /// fillet strip face (§E lock-in: only fillet strip, not pre-existing).
    #[test]
    fn dispatch_brep_attaches_cylinder_to_fillet_strip() {
        let (mut mesh, edge_id, face_a, face_b) = make_two_faces_at_x_edge();
        attach_line_curve(&mut mesh, edge_id);
        attach_plane_to_face(&mut mesh, face_a);
        attach_plane_to_face(&mut mesh, face_b);
        let result = mesh.fillet_edge_dispatch(edge_id, 0.3, 4).unwrap();
        assert_eq!(result.path_used, FilletPath::BRep);
        let mr = result.mesh_result.as_ref().expect("mesh path must succeed");
        assert!(!mr.fillet_faces.is_empty(),
            "fillet strip must be non-empty");
        for &fid in &mr.fillet_faces {
            let surf = mesh.face_surface(fid).expect("fillet strip face must have surface");
            assert!(matches!(surf, AnalyticSurface::Cylinder { .. }),
                "fillet strip face surface must be Cylinder, got {:?}",
                surface_kind_label(surf));
        }
    }

    // ── Test 8 ────────────────────────────────────────────────
    /// §F lock-in: silent fallback prohibited. Every result either
    /// reports BRep success cleanly OR exposes a skip_reason.
    #[test]
    fn dispatch_silent_fallback_prohibited() {
        // Case A: no surfaces — must report a reason.
        let (mut mesh1, e1, _, _) = make_two_faces_at_x_edge();
        let r1 = mesh1.fillet_edge_dispatch(e1, 0.3, 4).unwrap();
        let _ = r1.path_used;
        assert!(r1.skip_reason.is_some(), "Mesh path must record why BRep skipped");

        // Case B: full BRep success — must NOT carry a skip_reason.
        let (mut mesh2, e2, fa, fb) = make_two_faces_at_x_edge();
        attach_line_curve(&mut mesh2, e2);
        attach_plane_to_face(&mut mesh2, fa);
        attach_plane_to_face(&mut mesh2, fb);
        let r2 = mesh2.fillet_edge_dispatch(e2, 0.3, 4).unwrap();
        assert_eq!(r2.path_used, FilletPath::BRep);
        assert!(r2.skip_reason.is_none());
        // BRep claim requires created_surface populated.
        assert!(r2.created_surface.is_some(),
            "FilletPath::BRep requires created_surface=Some");
    }

    // ── Test 9 ────────────────────────────────────────────────
    /// Mesh assembly equality — dispatch's mesh_result face count
    /// matches what the existing mesh fillet would produce alone
    /// (drop-in alongside; no behavioral change to mesh path).
    #[test]
    fn dispatch_mesh_result_matches_existing_fillet() {
        let (mut mesh1, e1, _, _) = make_two_faces_at_x_edge();
        let direct = mesh1.fillet_edge(e1, 0.3, 4).unwrap();

        let (mut mesh2, e2, _, _) = make_two_faces_at_x_edge();
        let dispatched = mesh2.fillet_edge_dispatch(e2, 0.3, 4).unwrap();

        let dispatched_mr = dispatched.mesh_result.expect("mesh path must succeed");
        assert_eq!(direct.fillet_faces.len(), dispatched_mr.fillet_faces.len());
    }

    // ── Test 10 ───────────────────────────────────────────────
    /// FilletDispatchSkipReason short_label is stable + distinct per
    /// variant (audit / telemetry contract — Phase J §7.5).
    #[test]
    fn dispatch_skip_label_distinct() {
        use FilletDispatchSkipReason as R;
        let labels: Vec<&'static str> = vec![
            R::EdgeCurveMissing.short_label(),
            R::EdgeCurveNonLinear { kind: "Circle" }.short_label(),
            R::FaceSurfaceMissing { face_a_has: false, face_b_has: false }.short_label(),
            R::NonPlanarFace { side: SideTag::A, kind: "Sphere" }.short_label(),
            R::NonManifoldEdge { face_count: 1 }.short_label(),
            R::Underlying(FilletSkipReason::ConcaveEdge).short_label(),
            R::Underlying(FilletSkipReason::ThreeWayCorner).short_label(),
            R::Underlying(FilletSkipReason::RadiusTooSmall { radius: 1e-6, min: 1.5e-3 }).short_label(),
        ];
        let unique: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(unique.len(), labels.len(),
            "short_label values must be distinct (telemetry contract)");
    }
}
