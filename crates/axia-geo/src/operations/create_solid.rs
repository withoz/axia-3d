//! ADR-079 W-1-α — `create_solid` Surface-native solid generation.
//!
//! Profile-driven solid creation from a profile face + mode. Smart
//! routing within `CreateSolidMode::Extrude` based on profile surface
//! kind and boundary curve kinds. Other modes (Revolve / Sweep / Loft)
//! delegate to existing `Mesh::revolve` / `sweep` / `loft` (W-3/W-4).
//!
//! ## W-1-α scope (active branches)
//!
//! - `CreateSolidMode::Extrude` + `Plane` surface + `AllLinear` boundary
//!   → `extrude_planar_box` (Box solid, 6 Plane surfaces)
//!
//! All other branches return `SolidError::NotYetSupported` — Scene-level
//! caller (`Scene::exec_create_solid`) handles fallback to legacy
//! `Mesh::push_pull` per ADR-079 Q3 lock-in (W-4 deprecate).
//!
//! ## Architectural lock-ins (ADR-079 §5)
//!
//! - **L1**: Surface = truth, Mesh = view. Surface attach at construction
//!   time (not as afterthought).
//! - **L2**: Smart routing scope = Extrude mode 내부만.
//! - **L3**: 모든 결과 face = AnalyticSurface attached.
//! - **L8**: profile-driven only — primitive direct path 와 분리.
//!
//! Cross-references:
//! - ADR-079 §2.1 (primary entry), §2.3 (variants × matrix), §3 Q1~Q7
//! - ADR-067 Step 1 (auto-merge after push_pull, 보존)
//! - ADR-053 Phase H (surface transform — translation under Rigid)
//! - ADR-059 Phase N (Curve & Surface Mandatory)

use anyhow::{bail, Result};
use glam::{DMat4, DVec3};
use serde::{Deserialize, Serialize};

use crate::curves::AnalyticCurve;
use crate::curves::synthesize::synthesize_plane_surface;
use crate::entities::{FaceId, MaterialId};
use crate::mesh::Mesh;
use crate::surfaces::AnalyticSurface;

/// ADR-079 §2.1 — Solid creation mode (profile + mode → solid).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CreateSolidMode {
    /// Linear extrusion. SketchUp Push/Pull 의 NURBS-native 등가물.
    /// Smart routing (§2.3) 가 surface kind + boundary 별 분기.
    Extrude { distance: f64 },

    /// Rotation around an axis. W-4 — 기존 `Mesh::revolve` 위임.
    Revolve {
        axis_origin: DVec3,
        axis_dir: DVec3,
        angle_rad: f64,
    },

    /// Sweep along a path curve. W-3 — 기존 `Mesh::sweep` 위임.
    Sweep { path: AnalyticCurve },

    /// Loft to another profile face. W-3 — 기존 `Mesh::loft` 위임.
    Loft { other_profile: FaceId },
}

/// ADR-079 §2.2 — Result classification.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SolidKind {
    /// Plane all-Line boundary → Box (6 Planes).
    Box,
    /// Plane circular/arc boundary → Cylinder (1 Cylinder + 2 Plane caps).
    /// W-2 scope.
    Cylinder,
    /// Curved profile (Cylinder/Sphere/Cone/Torus panel) → smooth group
    /// 전체 일관 변형. W-2 scope.
    SmoothGroupOffset,
    /// Mixed/NURBS profile → general sweep (NURBSSurface walls). W-3 scope.
    GeneralSweep,
    /// Revolve mode 결과. W-4 scope.
    RevolutionSolid,
    /// Sweep mode 결과. W-3 scope.
    SweptSolid,
    /// Loft mode 결과. W-3 scope.
    LoftSolid,
}

/// ADR-079 §2.3 — Boundary classification for Extrude smart routing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryKind {
    /// 모든 edge 가 Line (또는 curve None — Phase N synthesize 시 Line).
    AllLinear,
    /// 모든 edge 가 Circle/Arc.
    AllCircular,
    /// Linear + Curved 혼합 또는 Bezier/BSpline/NURBS 포함.
    Mixed,
}

/// ADR-079 §2.2 — Result of `create_solid`.
#[derive(Clone, Debug)]
pub struct CreateSolidResult {
    pub profile_face: FaceId,
    pub solid_kind: SolidKind,
    pub top_face: FaceId,
    pub side_faces: Vec<FaceId>,
    pub all_solid_faces: Vec<FaceId>,
    pub adjacent_splits: usize,
    pub split_debug: Vec<String>,
}

/// Errors specific to `create_solid` operation.
#[derive(Debug, thiserror::Error)]
pub enum SolidError {
    #[error("create_solid: profile face has no AnalyticSurface attached")]
    NoProfileSurface,
    #[error("create_solid: profile boundary collection failed: {0}")]
    BoundaryCollection(String),
    #[error("create_solid: distance {dist} below EPSILON_LENGTH")]
    DegenerateDistance { dist: f64 },
    #[error("create_solid: profile face not found")]
    FaceNotFound,
    #[error("create_solid: not yet supported — {reason} (Q3 fallback to legacy push_pull)")]
    NotYetSupported { reason: String },
}

impl Mesh {
    /// ADR-079 §2.1 — Surface-native solid creation from a profile face.
    ///
    /// W-1-α: only `(Extrude, Plane, AllLinear)` is active. Other branches
    /// return `SolidError::NotYetSupported` — caller (`Scene::exec_create_solid`)
    /// handles fallback to legacy `Mesh::push_pull`.
    ///
    /// **Profile-driven only** (L8 lock-in) — direct primitive paths
    /// (`Mesh::create_box` etc.) are separate.
    pub fn create_solid(
        &mut self,
        profile_face: FaceId,
        mode: CreateSolidMode,
        material: MaterialId,
    ) -> Result<CreateSolidResult> {
        if !self.faces.contains(profile_face) {
            return Err(SolidError::FaceNotFound.into());
        }

        match mode {
            CreateSolidMode::Extrude { distance } => {
                if distance.abs() < crate::tolerances::EPSILON_LENGTH {
                    return Err(SolidError::DegenerateDistance { dist: distance }.into());
                }

                let surface = self
                    .faces
                    .get(profile_face)
                    .and_then(|f| f.surface().cloned())
                    .ok_or(SolidError::NoProfileSurface)?;

                let boundary = classify_boundary(self, profile_face)
                    .map_err(|e| SolidError::BoundaryCollection(e.to_string()))?;

                match (&surface, boundary) {
                    (AnalyticSurface::Plane { .. }, BoundaryKind::AllLinear) => {
                        self.extrude_planar_box(profile_face, distance, material, &surface)
                    }
                    (AnalyticSurface::Plane { .. }, BoundaryKind::AllCircular) => {
                        Err(SolidError::NotYetSupported {
                            reason: "Plane circular boundary → Cylinder (W-2 scope)".to_string(),
                        }
                        .into())
                    }
                    (AnalyticSurface::Plane { .. }, BoundaryKind::Mixed) => {
                        Err(SolidError::NotYetSupported {
                            reason: "Plane mixed boundary → GeneralSweep (W-3 scope)".to_string(),
                        }
                        .into())
                    }
                    (
                        AnalyticSurface::Cylinder { .. }
                        | AnalyticSurface::Sphere { .. }
                        | AnalyticSurface::Cone { .. }
                        | AnalyticSurface::Torus { .. },
                        _,
                    ) => Err(SolidError::NotYetSupported {
                        reason: "Curved profile → SmoothGroupOffset (W-2 scope)".to_string(),
                    }
                    .into()),
                    (
                        AnalyticSurface::BezierPatch { .. }
                        | AnalyticSurface::BSplineSurface { .. }
                        | AnalyticSurface::NURBSSurface { .. },
                        _,
                    ) => Err(SolidError::NotYetSupported {
                        reason: "NURBS profile → GeneralSweep (W-3 scope)".to_string(),
                    }
                    .into()),
                }
            }
            CreateSolidMode::Revolve { .. } => Err(SolidError::NotYetSupported {
                reason: "Revolve mode (W-4 scope)".to_string(),
            }
            .into()),
            CreateSolidMode::Sweep { .. } => Err(SolidError::NotYetSupported {
                reason: "Sweep mode (W-3 scope)".to_string(),
            }
            .into()),
            CreateSolidMode::Loft { .. } => Err(SolidError::NotYetSupported {
                reason: "Loft mode (W-3 scope)".to_string(),
            }
            .into()),
        }
    }

    /// ADR-079 §2.3 — `Plane all-Line → Box` extrusion.
    ///
    /// 1. Translate boundary verts by `profile_normal * dist`.
    /// 2. Create top face (translated profile).
    /// 3. Create N side faces (one quad per profile edge).
    /// 4. Attach Plane surface to all new faces (top: translated profile,
    ///    sides: synthesized).
    ///
    /// Profile face is preserved (not removed) — caller (Scene wrapper)
    /// updates Shape/Xia ownership including the new top + sides.
    fn extrude_planar_box(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        material: MaterialId,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let outer_start = self.faces[profile_face].outer().start;
        if outer_start.is_null() {
            bail!("extrude_planar_box: profile face has null outer loop start");
        }
        let boundary_verts = self.collect_loop_verts(outer_start)?;
        if boundary_verts.len() < 3 {
            bail!(
                "extrude_planar_box: profile boundary has only {} verts (need ≥ 3)",
                boundary_verts.len()
            );
        }

        // Profile normal — from analytic surface (truth) rather than mesh
        // averaged normal (view).
        let profile_normal = match profile_surface {
            AnalyticSurface::Plane { normal, .. } => normal.normalize_or_zero(),
            _ => bail!("extrude_planar_box: profile surface is not Plane"),
        };
        if profile_normal.length_squared() < 0.5 {
            bail!("extrude_planar_box: profile normal is near-zero");
        }
        let translation = profile_normal * dist;

        // Translate boundary verts to create top loop.
        let mut top_verts = Vec::with_capacity(boundary_verts.len());
        for &v in &boundary_verts {
            let pos = self.vertex_pos(v)?;
            top_verts.push(self.add_vertex(pos + translation));
        }

        // Top face — translated profile.
        // Winding: profile is CCW (outward normal = profile_normal). Top
        // should have outward normal = +profile_normal (away from box top),
        // which is the same winding as profile when viewed from above.
        // BUT: if dist > 0 (extruding "up"), top is above profile, and its
        // outward normal should point UP (= +profile_normal). Profile's
        // normal is also +profile_normal. So both are CCW from "above".
        // For dist < 0 (recess), top is below, normal points DOWN. The
        // winding is the same — analytic transform preserves it.
        let top_face = self.add_face(&top_verts, material)?;

        // Side faces — one quad per profile edge.
        // Quad winding: outward normal = side_normal (perpendicular to
        // profile_normal, pointing away from box interior).
        // For a CCW profile loop and dist > 0, the natural quad is:
        //   [v_i, v_(i+1), top_(i+1), top_i] — outward normal correct.
        let n = boundary_verts.len();
        let mut side_faces = Vec::with_capacity(n);
        for i in 0..n {
            let next = (i + 1) % n;
            let quad = if dist > 0.0 {
                [
                    boundary_verts[i],
                    boundary_verts[next],
                    top_verts[next],
                    top_verts[i],
                ]
            } else {
                // dist < 0 — reverse winding so outward normal is correct.
                [
                    boundary_verts[next],
                    boundary_verts[i],
                    top_verts[i],
                    top_verts[next],
                ]
            };
            let side = self.add_face(&quad, material)?;
            side_faces.push(side);
        }

        // Surface attach — L3 lock-in (construction-time, not afterthought).
        // Top: translated profile surface (Phase H Rigid translation).
        let top_surface = profile_surface
            .transform(&DMat4::from_translation(translation))
            .unwrap_or_else(|_| {
                // Phase H transform failed (rare for pure translation); fall
                // back to synthesized Plane from top vertex positions.
                let top_positions: Vec<DVec3> = top_verts
                    .iter()
                    .filter_map(|v| self.vertex_pos(*v).ok())
                    .collect();
                synthesize_plane_surface(&top_positions)
            });
        if let Some(top_face_mut) = self.faces.get_mut(top_face) {
            top_face_mut.set_surface(Some(top_surface));
        }

        // Sides: synthesized Plane from each quad's vertex positions.
        for &side_fid in &side_faces {
            let face_ref = self.faces.get(side_fid);
            if face_ref.is_none() || !face_ref.unwrap().is_active() {
                continue;
            }
            let start = self.faces[side_fid].outer().start;
            if start.is_null() {
                continue;
            }
            let side_verts = self.collect_loop_verts(start)?;
            let positions: Vec<DVec3> = side_verts
                .iter()
                .filter_map(|v| self.vertex_pos(*v).ok())
                .collect();
            if positions.len() >= 3 {
                let side_surface = synthesize_plane_surface(&positions);
                self.faces[side_fid].set_surface(Some(side_surface));
            }
        }

        // ADR-067 Step 1 auto-merge — preserve.
        // The legacy push_pull's `adr_067_step1_auto_merge_result` works
        // on a `PushPullResult`. We don't need to invoke it here because
        // create_solid is invoked from a clean profile face — there are
        // no adjacent coplanar faces to auto-merge with at this step.
        // (Future W-2/W-3 variants may need to invoke auto-merge for
        // smooth-group cases.)
        let adjacent_splits = 0;

        // Aggregate all solid faces (profile + top + sides) for Shape
        // ownership.
        let mut all_solid_faces = Vec::with_capacity(2 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.push(top_face);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::Box,
            top_face,
            side_faces,
            all_solid_faces,
            adjacent_splits,
            split_debug: Vec::new(),
        })
    }
}

/// ADR-079 §2.3 — Classify the boundary curves of a profile face.
///
/// Walks the outer loop edges and inspects each `Edge::curve()`:
/// - All `Line` (or `None` per Phase N synthesize) → `AllLinear`
/// - All `Circle` / `Arc` → `AllCircular`
/// - 그 외 (Bezier / BSpline / NURBS / 혼합) → `Mixed`
pub fn classify_boundary(mesh: &Mesh, face: FaceId) -> Result<BoundaryKind> {
    let edges = mesh.face_outer_edges(face)?;
    if edges.is_empty() {
        bail!("classify_boundary: face {face:?} has no outer edges");
    }

    let mut all_linear = true;
    let mut all_circular = true;

    for &eid in &edges {
        let edge = mesh
            .edges
            .get(eid)
            .ok_or_else(|| anyhow::anyhow!("classify_boundary: edge {eid:?} not found"))?;
        match edge.curve() {
            None => {
                // Phase N: synthesized Line. Treat as Line.
                all_circular = false;
            }
            Some(AnalyticCurve::Line { .. }) => {
                all_circular = false;
            }
            Some(AnalyticCurve::Circle { .. } | AnalyticCurve::Arc { .. }) => {
                all_linear = false;
            }
            Some(_) => {
                // Bezier / BSpline / NURBS — Mixed
                all_linear = false;
                all_circular = false;
                break;
            }
        }
    }

    Ok(if all_linear {
        BoundaryKind::AllLinear
    } else if all_circular {
        BoundaryKind::AllCircular
    } else {
        BoundaryKind::Mixed
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::{FaceId, MaterialId};
    use crate::mesh::Mesh;
    use crate::surfaces::AnalyticSurface;

    /// Helper — build a unit square Plane-surfaced face on z=0, normal +Z.
    fn build_unit_square_plane_face(mesh: &mut Mesh) -> FaceId {
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).expect("add_face");
        // Attach Plane surface (truth source).
        let surface = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        };
        mesh.faces[face].set_surface(Some(surface));
        face
    }

    #[test]
    fn create_solid_extrude_plane_rect_returns_box() {
        let mut mesh = Mesh::new();
        let profile = build_unit_square_plane_face(&mut mesh);
        let face_count_before = mesh.face_count();

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        assert_eq!(result.solid_kind, SolidKind::Box);
        assert_eq!(result.profile_face, profile);
        assert_eq!(result.side_faces.len(), 4);
        // Profile + top + 4 sides = 6 faces in solid.
        assert_eq!(result.all_solid_faces.len(), 6);
        // mesh.face_count() should grow by 5 (1 top + 4 sides; profile preserved).
        assert_eq!(mesh.face_count(), face_count_before + 5);
    }

    #[test]
    fn create_solid_attaches_planes_to_new_faces() {
        let mut mesh = Mesh::new();
        let profile = build_unit_square_plane_face(&mut mesh);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 2.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        // Top face: AnalyticSurface::Plane attached.
        let top_surface = mesh.faces[result.top_face].surface();
        assert!(
            matches!(top_surface, Some(AnalyticSurface::Plane { .. })),
            "top face must have Plane surface attached"
        );

        // Each side face: AnalyticSurface::Plane attached.
        for &side_fid in &result.side_faces {
            let side_surface = mesh.faces[side_fid].surface();
            assert!(
                matches!(side_surface, Some(AnalyticSurface::Plane { .. })),
                "side face {side_fid:?} must have Plane surface attached"
            );
        }
    }

    #[test]
    fn create_solid_extrude_no_surface_returns_no_profile_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::ZERO);
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        // Note: no surface attached.
        let profile = mesh.add_face(&[v00, v10, v11, v01], mat).expect("add_face");

        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Extrude { distance: 1.0 },
            mat,
        );
        assert!(result.is_err(), "should fail without profile surface");
        let err_msg = format!("{:?}", result.err().unwrap());
        assert!(
            err_msg.contains("NoProfileSurface") || err_msg.contains("AnalyticSurface"),
            "error must mention missing surface, got: {err_msg}"
        );
    }

    #[test]
    fn create_solid_extrude_revolve_mode_returns_not_yet_supported() {
        // Even with a valid profile, non-Extrude modes return NotYetSupported.
        let mut mesh = Mesh::new();
        let profile = build_unit_square_plane_face(&mut mesh);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::PI,
            },
            MaterialId::new(0),
        );
        let err_msg = format!("{}", result.err().unwrap());
        assert!(
            err_msg.contains("not yet supported") && err_msg.contains("Revolve"),
            "error must indicate Revolve not yet supported, got: {err_msg}"
        );
    }

    #[test]
    fn create_solid_zero_distance_returns_degenerate() {
        let mut mesh = Mesh::new();
        let profile = build_unit_square_plane_face(&mut mesh);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Extrude { distance: 0.0 },
            MaterialId::new(0),
        );
        let err_msg = format!("{:?}", result.err().unwrap());
        assert!(
            err_msg.contains("DegenerateDistance") || err_msg.contains("EPSILON"),
            "error must indicate degenerate distance, got: {err_msg}"
        );
    }

    #[test]
    fn classify_boundary_all_linear_for_unit_square() {
        let mut mesh = Mesh::new();
        let face = build_unit_square_plane_face(&mut mesh);
        let kind = classify_boundary(&mesh, face).expect("classify OK");
        assert_eq!(kind, BoundaryKind::AllLinear);
    }
}
