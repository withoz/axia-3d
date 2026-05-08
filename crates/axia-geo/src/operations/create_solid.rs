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

use crate::curves::{AnalyticCurve, CurveOps};
use crate::curves::synthesize::synthesize_plane_surface;
use crate::entities::{FaceId, MaterialId, VertId};
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
                        // W-2-α: Plane + AllCircular → Cylinder.
                        self.extrude_planar_cylinder(profile_face, distance, material, &surface)
                    }
                    (AnalyticSurface::Plane { .. }, BoundaryKind::Mixed) => {
                        Err(SolidError::NotYetSupported {
                            reason: "Plane mixed boundary → GeneralSweep (W-3 scope)".to_string(),
                        }
                        .into())
                    }
                    (AnalyticSurface::Cylinder { .. }, _) => {
                        // W-2-γ-i: Cylinder smooth-group radius offset.
                        self.offset_smooth_group_cylinder(profile_face, distance, &surface)
                    }
                    (AnalyticSurface::Sphere { .. }, _) => {
                        // W-2-γ-ii: Sphere smooth-group radius offset.
                        self.offset_smooth_group_sphere(profile_face, distance, &surface)
                    }
                    (AnalyticSurface::Cone { .. }, _) => {
                        // W-2-γ-iii: Cone constant-offset (true surface offset).
                        self.offset_smooth_group_cone(profile_face, distance, &surface)
                    }
                    (AnalyticSurface::Torus { .. }, _) => {
                        // W-2-γ-iv: Torus constant-offset (= minor_radius offset).
                        self.offset_smooth_group_torus(profile_face, distance, &surface)
                    }
                    (
                        AnalyticSurface::BezierPatch { .. }
                        | AnalyticSurface::BSplineSurface { .. }
                        | AnalyticSurface::NURBSSurface { .. },
                        _,
                    ) => self.extrude_nurbs_class_profile(
                        profile_face,
                        distance,
                        material,
                        &surface,
                    ),
                }
            }
            CreateSolidMode::Revolve {
                axis_origin,
                axis_dir,
                angle_rad,
            } => self.revolve_profile_face(
                profile_face,
                axis_origin,
                axis_dir,
                angle_rad,
                material,
            ),
            CreateSolidMode::Sweep { path } => {
                self.sweep_profile_along_path(profile_face, &path, material)
            }
            CreateSolidMode::Loft { other_profile } => {
                self.loft_between_profiles(profile_face, other_profile, material)
            }
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

    /// ADR-079 W-2-α — `Plane circular boundary → Cylinder` extrusion.
    ///
    /// Profile face has `AnalyticSurface::Plane` and outer loop edges all
    /// carry `AnalyticCurve::Arc` sharing identical (center, radius, normal).
    /// Builds:
    /// 1. Top cap = translated profile (Plane surface).
    /// 2. N side faces (one quad per profile edge), all sharing the SAME
    ///    `AnalyticSurface::Cylinder` instance — automatic smooth group.
    ///
    /// On boundary arc-parameter mismatch (different center/radius/normal
    /// among the loop's arcs) returns `NotYetSupported` so Scene falls back
    /// to legacy push_pull (Q3 lock-in).
    fn extrude_planar_cylinder(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        material: MaterialId,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let outer_start = self.faces[profile_face].outer().start;
        if outer_start.is_null() {
            bail!("extrude_planar_cylinder: profile face has null outer loop start");
        }
        let boundary_verts = self.collect_loop_verts(outer_start)?;

        // ADR-089 A-θ-β — closed-curve face fast-path (Path A
        // tessellate-then-extrude). Detect 1-vert anchor + Circle
        // self-loop edge and substitute a tessellated polygonal
        // profile before continuing. L-θ-2 / L-θ-3 / L-θ-4 / L-θ-5.
        if boundary_verts.len() == 1 {
            return self.extrude_closed_curve_face_via_tessellation(
                profile_face,
                dist,
                material,
                profile_surface,
            );
        }

        if boundary_verts.len() < 3 {
            bail!(
                "extrude_planar_cylinder: profile boundary has only {} verts (need ≥ 3)",
                boundary_verts.len()
            );
        }

        // Profile normal — Plane truth source.
        let profile_normal = match profile_surface {
            AnalyticSurface::Plane { normal, .. } => normal.normalize_or_zero(),
            _ => bail!("extrude_planar_cylinder: profile surface is not Plane"),
        };
        if profile_normal.length_squared() < 0.5 {
            bail!("extrude_planar_cylinder: profile normal is near-zero");
        }
        let translation = profile_normal * dist;

        // Extract circle params from boundary arcs and verify consistency.
        // §W2-B-(a) lock-in — all arcs must share (center, radius, normal).
        let (circle_center, circle_radius, _circle_normal, circle_basis_u) =
            extract_shared_circle_params(self, profile_face).map_err(|e| {
                SolidError::NotYetSupported {
                    reason: format!(
                        "Plane circular boundary arc parameters mismatch — {} (Q3 fallback)",
                        e
                    ),
                }
            })?;

        // Translate boundary verts to create top loop.
        let mut top_verts = Vec::with_capacity(boundary_verts.len());
        for &v in &boundary_verts {
            let pos = self.vertex_pos(v)?;
            top_verts.push(self.add_vertex(pos + translation));
        }

        // Top cap face (translated profile).
        let top_face = self.add_face(&top_verts, material)?;

        // Side faces — one quad per profile edge.
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

        // Surface attach — L3 lock-in.
        // Top cap: translated profile Plane surface.
        let top_surface = profile_surface
            .transform(&DMat4::from_translation(translation))
            .unwrap_or_else(|_| {
                let top_positions: Vec<DVec3> = top_verts
                    .iter()
                    .filter_map(|v| self.vertex_pos(*v).ok())
                    .collect();
                synthesize_plane_surface(&top_positions)
            });
        if let Some(top_face_mut) = self.faces.get_mut(top_face) {
            top_face_mut.set_surface(Some(top_surface));
        }

        // Side wall: SAME `AnalyticSurface::Cylinder` instance shared by all
        // N quad faces. Smooth group emerges naturally from shared surface
        // kind + parameters (ADR-038 P23 surface-aware normals).
        // Cylinder axis_origin = circle_center on profile plane (preserved).
        // The cylinder spans from profile plane to translated plane:
        //   v ∈ [0, dist] along axis_dir = profile_normal (signed).
        // u ∈ [0, 2π] full circumference.
        let (axis_dir, v_lo, v_hi) = if dist > 0.0 {
            (profile_normal, 0.0, dist)
        } else {
            // For dist < 0, axis still points along profile_normal so the
            // cylinder's local v parameter increases away from profile —
            // but extrusion goes in -profile_normal direction. We choose
            // axis_dir = profile_normal and v_range = [dist, 0] so that
            // (axis_origin + axis_dir * v) for v ∈ [dist, 0] sweeps the
            // wall from translated plane back to profile.
            (profile_normal, dist, 0.0)
        };
        let cylinder_surface = AnalyticSurface::Cylinder {
            axis_origin: circle_center,
            axis_dir,
            radius: circle_radius,
            ref_dir: circle_basis_u,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (v_lo, v_hi),
        };
        for &side_fid in &side_faces {
            let face_ref = self.faces.get(side_fid);
            if face_ref.is_none() || !face_ref.unwrap().is_active() {
                continue;
            }
            self.faces[side_fid].set_surface(Some(cylinder_surface.clone()));
        }

        let adjacent_splits = 0;

        // Aggregate — profile + top + N sides.
        let mut all_solid_faces = Vec::with_capacity(2 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.push(top_face);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::Cylinder,
            top_face,
            side_faces,
            all_solid_faces,
            adjacent_splits,
            split_debug: Vec::new(),
        })
    }

    /// ADR-089 A-θ-β — closed-curve face Push-Pull via tessellation
    /// (Path A jamjeong; Path B 진정한 kernel-native cylinder 는 별도
    /// future ADR).
    ///
    /// Detect: profile has exactly 1 boundary vertex (anchor) + 1
    /// self-loop edge with `AnalyticCurve::Circle` curve.
    ///
    /// Process (L-θ-3 / L-θ-4 / L-θ-5):
    /// 1. Extract Circle (center, radius, normal, basis_u) from edge curve.
    /// 2. Tessellate to N points (default chord_tol = radius/100, → ~32
    ///    segments for 1m radius; min 8 enforced by `segment_count_for_arc`).
    /// 3. Soft-delete original closed-curve face (`remove_face`).
    /// 4. Add a fresh polygonal face with N tessellated vertices.
    /// 5. Inherit Plane surface from original closed-curve face.
    /// 6. Recurse `extrude_planar_cylinder` with substituted profile —
    ///    the recursion's `boundary_verts.len() == N >= 8` skips the
    ///    fast-path and proceeds with normal extrusion.
    ///
    /// **Result**: top + N side faces are Plane / Cylinder (ADR-087 K-δ
    /// Cylinder primitive 와 동일 토폴로지). closed-curve canonical
    /// 표현 은 result solid 에 보존되지 않음 — 메타-원칙 #14 측면 회귀
    /// 가 Path B (별도 ADR) 까지 deferred.
    fn extrude_closed_curve_face_via_tessellation(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        material: MaterialId,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        // 1. Locate self-loop edge + Circle curve.
        let outer_start = self.faces[profile_face].outer().start;
        let self_loop_edge_id = self.hes[outer_start].edge();
        let anchor_vid = self.edges[self_loop_edge_id].v_small();
        let edge_id = self_loop_edge_id;
        let curve = self
            .edges
            .get(edge_id)
            .and_then(|e| e.curve().cloned())
            .ok_or(SolidError::NotYetSupported {
                reason:
                    "extrude closed-curve fast-path: self-loop edge has no AnalyticCurve attached"
                        .to_string(),
            })?;
        let (center, radius, normal, basis_u) = match curve {
            AnalyticCurve::Circle {
                center,
                radius,
                normal,
                basis_u,
            } => (center, radius, normal, basis_u),
            _ => {
                return Err(SolidError::NotYetSupported {
                    reason: format!(
                        "extrude closed-curve fast-path: only Circle curves supported \
                         in Path A (got {:?})",
                        std::mem::discriminant(&curve),
                    ),
                }
                .into());
            }
        };

        // 2. Tessellate (chord_tol = radius / 100 → ~32 seg, min 8).
        let chord_tol = (radius * 0.01).max(1e-6);
        let pts = crate::curves::circle::tessellate_full(
            center, radius, normal, basis_u, chord_tol,
        );
        // tessellate_full returns N+1 closed (last == first) — drop tail.
        if pts.len() < 4 {
            bail!(
                "extrude_closed_curve_face_via_tessellation: tessellation produced {} points \
                 (need ≥ 4 incl. closing duplicate)",
                pts.len()
            );
        }
        let unique_pts = &pts[..pts.len() - 1];
        let tess_verts: Vec<VertId> =
            unique_pts.iter().map(|p| self.add_vertex(*p)).collect();

        // 3. Soft-delete original closed-curve face.
        self.remove_face(profile_face)?;

        // 3b. ADR-089 A-υ-β — cleanup orphan self-loop edge + anchor.
        // After remove_face the closed-curve self-loop edge has no
        // active face referencing it. Without this cleanup the edge
        // still renders as 23 polyline segments (A-κ-β closed-curve
        // edge wireframe path) overlapping the new polygonal bottom.
        // L-υ-1 / L-υ-2.
        if self.edges.contains(self_loop_edge_id)
            && self.edges[self_loop_edge_id].is_active()
        {
            let _ = self.remove_edge_and_halfedges(self_loop_edge_id);
        }
        // Anchor vertex: deactivate if no other edges reference it.
        // (L-υ-2 — preserve if used by other standalone wires.)
        if self.verts.contains(anchor_vid) && self.verts[anchor_vid].is_active() {
            if self.verts[anchor_vid].outgoing().is_none() {
                self.verts[anchor_vid].set_active(false);
            }
        }

        // 4. Create polygonal substitute face.
        let substituted = self.add_face(&tess_verts, material)?;

        // 5. Inherit Plane surface (L-θ-5).
        if let Some(face_mut) = self.faces.get_mut(substituted) {
            face_mut.set_surface(Some(profile_surface.clone()));
        }

        // 6. Attach Arc curves to each substitute edge — required for
        //    `extract_shared_circle_params` (called by recursion) to
        //    classify the boundary as `AllCircular` and recover
        //    (center, radius, normal, basis_u). Without curve attach,
        //    the recursion fails with "edge is not Circle/Arc".
        let n_seg = tess_verts.len();
        let edges = self.face_outer_edges(substituted)?;
        let two_pi = std::f64::consts::TAU;
        for (i, &eid) in edges.iter().enumerate() {
            let theta_start = (i as f64) * two_pi / (n_seg as f64);
            let theta_end = ((i + 1) as f64) * two_pi / (n_seg as f64);
            let arc = AnalyticCurve::Arc {
                center,
                radius,
                normal,
                basis_u,
                start_angle: theta_start,
                end_angle: theta_end,
            };
            if let Some(edge_mut) = self.edges.get_mut(eid) {
                edge_mut.set_curve(Some(arc));
            }
        }

        // 7. Recurse — substitute now has N >= 8 verts + Arc curves;
        //    fast-path skipped, AllCircular branch matches.
        self.extrude_planar_cylinder(substituted, dist, material, profile_surface)
    }

    /// ADR-079 W-3-δ — Extrude on NURBS-class profile (tessellation-based).
    ///
    /// Profile face's surface is BezierPatch / BSplineSurface / NURBSSurface.
    /// Tessellation-based approximation per §W3-B-(a):
    /// - Profile boundary verts already on surface (no projection needed)
    /// - Compute representative normal at face's parametric-center via
    ///   `AnalyticSurface::normal_at_world_pos(centroid)`
    /// - Translate boundary verts by `representative_normal · dist` to
    ///   form top boundary
    /// - Build top face (preserve profile as bottom) + N side quads
    /// - Top + side surfaces synthesized as Plane (approximate; original
    ///   NURBS surface metadata not propagated to new faces)
    ///
    /// SolidKind: `GeneralSweep` (per ADR-079 §2.2 W-3 scope).
    ///
    /// **Known limitation**: representative normal is uniform (face center).
    /// True per-vertex offset (each vertex moved along its own surface normal)
    /// would produce a non-Plane top — future enhancement (W-3-ε).
    fn extrude_nurbs_class_profile(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        material: MaterialId,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let outer_start = self.faces[profile_face].outer().start;
        if outer_start.is_null() {
            bail!(
                "extrude_nurbs_class_profile: profile face {profile_face:?} \
                 has null outer loop start"
            );
        }
        let boundary_verts = self.collect_loop_verts(outer_start)?;
        if boundary_verts.len() < 3 {
            bail!(
                "extrude_nurbs_class_profile: profile boundary has only {} verts",
                boundary_verts.len()
            );
        }

        // Compute centroid of boundary verts → representative normal.
        let mut centroid = DVec3::ZERO;
        let positions: Vec<DVec3> = boundary_verts
            .iter()
            .map(|&v| self.vertex_pos(v))
            .collect::<Result<Vec<_>>>()?;
        for p in &positions {
            centroid += *p;
        }
        centroid /= positions.len() as f64;
        let representative_normal = profile_surface.normal_at_world_pos(centroid);
        if representative_normal.length_squared() < 0.5 {
            bail!(
                "extrude_nurbs_class_profile: NURBS surface representative \
                 normal at centroid is degenerate"
            );
        }
        let translation = representative_normal * dist;

        // Translate boundary to form top loop.
        let mut top_verts = Vec::with_capacity(boundary_verts.len());
        for p in &positions {
            top_verts.push(self.add_vertex(*p + translation));
        }

        // Top cap face.
        let top_face = self.add_face(&top_verts, material)?;

        // Side quads — same winding as extrude_planar_box.
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

        // Top cap surface — synthesized as Plane from top vertex positions.
        // (Approximation: NURBS profile surface NOT carried to top — future
        // enhancement W-3-ε would translate the NURBS surface.)
        let top_positions: Vec<DVec3> = top_verts
            .iter()
            .filter_map(|v| self.vertex_pos(*v).ok())
            .collect();
        if top_positions.len() >= 3 {
            let top_surface = synthesize_plane_surface(&top_positions);
            if let Some(top_face_mut) = self.faces.get_mut(top_face) {
                top_face_mut.set_surface(Some(top_surface));
            }
        }

        // Side surfaces — synthesized Plane from each quad.
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

        let mut all_solid_faces = Vec::with_capacity(2 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.push(top_face);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::GeneralSweep,
            top_face,
            side_faces,
            all_solid_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-4-α — Revolve mode dispatch (full 360° only).
    ///
    /// Extracts profile face's outer-loop polyline, validates axis +
    /// face plane perpendicularity, then delegates to `Mesh::revolve`
    /// (existing operation). Profile face is preserved (Shape ownership
    /// pattern); generated side faces are CreateSolidResult.side_faces.
    ///
    /// W-4-α scope:
    /// - Full 360° only — `(angle_rad - TAU).abs() > 1e-3` → NotYetSupported
    /// - Multi-loop face → reject (ADR-016 Q2 / ADR-080 L8 정합)
    /// - Profile plane must contain axis (face_normal ⊥ axis_dir)
    /// - Fixed default segments = 32 (chord-tolerance based future)
    fn revolve_profile_face(
        &mut self,
        profile_face: FaceId,
        axis_origin: DVec3,
        axis_dir: DVec3,
        angle_rad: f64,
        material: MaterialId,
    ) -> Result<CreateSolidResult> {
        // §W4-A — Full 360° only in W-4-α.
        let two_pi = std::f64::consts::TAU;
        if (angle_rad - two_pi).abs() > 1e-3 {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "Revolve partial angle {:.4} rad (full 360° only in W-4-α)",
                    angle_rad
                ),
            }
            .into());
        }

        // §W4-C — Axis validation.
        let axis_unit = axis_dir.normalize_or_zero();
        if axis_unit.length_squared() < 0.5 {
            return Err(SolidError::NotYetSupported {
                reason: "Revolve axis_dir is near-zero".to_string(),
            }
            .into());
        }

        // §W4-B — Multi-loop guard.
        let face = self
            .faces
            .get(profile_face)
            .ok_or(SolidError::FaceNotFound)?;
        if !face.inners().is_empty() {
            return Err(SolidError::NotYetSupported {
                reason: "Revolve multi-loop face rejected (ADR-016 Q2)".to_string(),
            }
            .into());
        }

        // Extract polyline from outer loop.
        let outer_start = face.outer().start;
        if outer_start.is_null() {
            bail!("revolve_profile_face: profile face has null outer loop start");
        }
        let boundary_verts = self.collect_loop_verts(outer_start)?;
        if boundary_verts.len() < 2 {
            bail!(
                "revolve_profile_face: profile boundary has only {} verts",
                boundary_verts.len()
            );
        }
        let profile_points: Vec<DVec3> = boundary_verts
            .iter()
            .map(|&v| self.vertex_pos(v))
            .collect::<Result<Vec<_>>>()?;

        // §W4-C — Profile face plane must contain axis (normal ⊥ axis).
        let face_surface = self
            .faces
            .get(profile_face)
            .and_then(|f| f.surface().cloned());
        if let Some(AnalyticSurface::Plane { normal, .. }) = face_surface {
            let face_normal = normal.normalize_or_zero();
            let dot = face_normal.dot(axis_unit).abs();
            if dot > 0.001 {
                return Err(SolidError::NotYetSupported {
                    reason: format!(
                        "Revolve: profile face plane does not contain axis \
                         (face_normal · axis_dir = {:.4}, expected ~0)",
                        dot
                    ),
                }
                .into());
            }
        }

        // §W4-D — Fixed default segments.
        const DEFAULT_REVOLVE_SEGMENTS: u32 = 32;

        // Delegate to existing Mesh::revolve.
        let side_faces = self
            .revolve(
                &profile_points,
                axis_origin,
                axis_unit,
                DEFAULT_REVOLVE_SEGMENTS,
                material,
            )
            .map_err(|e| anyhow::anyhow!("Revolve operation failed: {}", e))?;

        let mut all_solid_faces = Vec::with_capacity(1 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::RevolutionSolid,
            top_face: profile_face, // sentinel — no separate "top" in revolve
            side_faces,
            all_solid_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-3-β — Loft mode dispatch (two profiles).
    ///
    /// Connects the boundary of `profile_face` to the boundary of
    /// `other_profile` via ruled side faces. Delegates to `Mesh::loft`
    /// with closed_sections=true (each profile is a closed loop).
    ///
    /// W-3-β scope (MVP, two-profile only):
    /// - Both faces exist + active
    /// - Both faces multi-loop guard (ADR-016 Q2 / L8)
    /// - Outer-loop vertex counts match (no auto-resampling — future)
    /// - Profiles must NOT be the same FaceId
    fn loft_between_profiles(
        &mut self,
        profile_face: FaceId,
        other_profile: FaceId,
        material: MaterialId,
    ) -> Result<CreateSolidResult> {
        // §W3β-A — Both faces must be distinct.
        if profile_face == other_profile {
            return Err(SolidError::NotYetSupported {
                reason: "Loft: both profiles are the same FaceId".to_string(),
            }
            .into());
        }

        // §W3β-A — Both faces must exist + active.
        let f1 = self
            .faces
            .get(profile_face)
            .ok_or(SolidError::FaceNotFound)?;
        if !f1.is_active() {
            return Err(SolidError::FaceNotFound.into());
        }
        if !f1.inners().is_empty() {
            return Err(SolidError::NotYetSupported {
                reason: "Loft profile (first) multi-loop face rejected (ADR-016 Q2)".to_string(),
            }
            .into());
        }
        let f1_outer_start = f1.outer().start;
        if f1_outer_start.is_null() {
            bail!("loft_between_profiles: profile_face has null outer loop start");
        }

        let f2 = self
            .faces
            .get(other_profile)
            .ok_or(SolidError::FaceNotFound)?;
        if !f2.is_active() {
            return Err(SolidError::FaceNotFound.into());
        }
        if !f2.inners().is_empty() {
            return Err(SolidError::NotYetSupported {
                reason: "Loft profile (second) multi-loop face rejected (ADR-016 Q2)"
                    .to_string(),
            }
            .into());
        }
        let f2_outer_start = f2.outer().start;
        if f2_outer_start.is_null() {
            bail!("loft_between_profiles: other_profile has null outer loop start");
        }

        // Extract two profiles' outer-loop vertex world positions.
        let v1 = self.collect_loop_verts(f1_outer_start)?;
        let v2 = self.collect_loop_verts(f2_outer_start)?;

        // §W3β-B — Vertex counts must match (no auto-resampling in MVP).
        if v1.len() != v2.len() {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "Loft: profile vertex count mismatch ({} vs {}, no auto-resampling in W-3-β MVP)",
                    v1.len(),
                    v2.len()
                ),
            }
            .into());
        }
        if v1.len() < 3 {
            bail!(
                "loft_between_profiles: profile boundary has only {} verts (need ≥ 3)",
                v1.len()
            );
        }

        let section1: Vec<DVec3> = v1
            .iter()
            .map(|&v| self.vertex_pos(v))
            .collect::<Result<Vec<_>>>()?;
        let section2: Vec<DVec3> = v2
            .iter()
            .map(|&v| self.vertex_pos(v))
            .collect::<Result<Vec<_>>>()?;

        // §W3β-C — Delegate to Mesh::loft.
        let sections = vec![section1, section2];
        let side_faces = self
            .loft(&sections, /* closed_sections */ true, material)
            .map_err(|e| anyhow::anyhow!("Loft operation failed: {}", e))?;

        let mut all_solid_faces = Vec::with_capacity(2 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.push(other_profile);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::LoftSolid,
            top_face: other_profile, // second profile = "top" cap
            side_faces,
            all_solid_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-3-α — Sweep mode dispatch.
    ///
    /// Tessellates the path AnalyticCurve to a polyline, validates that the
    /// profile face's plane normal is aligned with the path's start tangent,
    /// projects profile vertices into the local (basis_u, basis_v) frame
    /// (the path's start cross-section), and delegates to `Mesh::sweep`.
    ///
    /// W-3-α scope:
    /// - Path tessellation via `AnalyticCurve::tessellate(chord_tol)`
    ///   (chord_tol = `EPSILON_LENGTH × 1e3` ≈ 1.5 mm)
    /// - Profile face plane normal must be ‖ path start tangent
    /// - Multi-loop face → reject (ADR-016 Q2 / L8)
    /// - Path tessellation < 2 points → reject (`SweepPathDegenerate`)
    fn sweep_profile_along_path(
        &mut self,
        profile_face: FaceId,
        path: &AnalyticCurve,
        material: MaterialId,
    ) -> Result<CreateSolidResult> {
        let tol = crate::tolerances::EPSILON_LENGTH;
        let chord_tol = tol * 1000.0; // §W3-I-L2: 1.5 mm chord tolerance

        // §W3-D-C — Multi-loop guard.
        let face = self
            .faces
            .get(profile_face)
            .ok_or(SolidError::FaceNotFound)?;
        if !face.inners().is_empty() {
            return Err(SolidError::NotYetSupported {
                reason: "Sweep multi-loop face rejected (ADR-016 Q2)".to_string(),
            }
            .into());
        }

        // Profile face surface — must be Plane (W-3-α MVP).
        let face_surface = face.surface().cloned();
        let (face_origin, face_normal, face_basis_u) = match face_surface {
            Some(AnalyticSurface::Plane { origin, normal, basis_u, .. }) => (
                origin,
                normal.normalize_or_zero(),
                basis_u.normalize_or_zero(),
            ),
            _ => {
                return Err(SolidError::NotYetSupported {
                    reason: "Sweep MVP: profile face surface must be Plane (W-3-δ scope)"
                        .to_string(),
                }
                .into());
            }
        };
        if face_normal.length_squared() < 0.5 || face_basis_u.length_squared() < 0.5 {
            bail!("sweep_profile_along_path: profile face plane vectors degenerate");
        }
        let face_basis_v = face_normal.cross(face_basis_u);

        // §W3α-A — Tessellate path.
        let path_polyline = path
            .tessellate(chord_tol, self)
            .map_err(|e| anyhow::anyhow!("Sweep path tessellation failed: {}", e))?;
        if path_polyline.len() < 2 {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "Sweep path degenerate (tessellation produced {} points)",
                    path_polyline.len()
                ),
            }
            .into());
        }

        // §W3α-B — Profile plane normal ‖ path start tangent.
        let path_tangent = (path_polyline[1] - path_polyline[0]).normalize_or_zero();
        if path_tangent.length_squared() < 0.5 {
            bail!("sweep_profile_along_path: path start tangent degenerate");
        }
        if face_normal.dot(path_tangent).abs() < 0.999 {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "Sweep: profile face normal not aligned with path start tangent \
                     (|dot| = {:.4}, expected ≥ 0.999)",
                    face_normal.dot(path_tangent).abs()
                ),
            }
            .into());
        }

        // Extract profile polyline → project to local (u, v, 0) coords.
        let outer_start = self.faces[profile_face].outer().start;
        if outer_start.is_null() {
            bail!("sweep_profile_along_path: profile face has null outer loop start");
        }
        let boundary_verts = self.collect_loop_verts(outer_start)?;
        if boundary_verts.len() < 3 {
            bail!(
                "sweep_profile_along_path: profile boundary has only {} verts",
                boundary_verts.len()
            );
        }
        let mut profile_local: Vec<DVec3> = Vec::with_capacity(boundary_verts.len());
        for &v in &boundary_verts {
            let pos = self.vertex_pos(v)?;
            let from_origin = pos - face_origin;
            let x = from_origin.dot(face_basis_u);
            let y = from_origin.dot(face_basis_v);
            // z = 0 (profile is in plane); z is along path tangent direction.
            profile_local.push(DVec3::new(x, y, 0.0));
        }

        // Mesh::sweep expects profile in local XY (z=0), path in 3D world.
        // Translate path so path[0] aligns with face_origin (Mesh::sweep
        // places sections AT each path point, so the first section is at
        // path[0], not at face_origin). We adjust by translating path
        // points to start from face_origin.
        let path_offset = face_origin - path_polyline[0];
        let path_world: Vec<DVec3> = path_polyline.iter().map(|p| *p + path_offset).collect();

        // §W3α-D — Delegate to Mesh::sweep.
        let side_faces = self
            .sweep(&profile_local, &path_world, /* closed_profile */ true, material)
            .map_err(|e| anyhow::anyhow!("Sweep operation failed: {}", e))?;

        let mut all_solid_faces = Vec::with_capacity(1 + side_faces.len());
        all_solid_faces.push(profile_face);
        all_solid_faces.extend(side_faces.iter().copied());

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::SweptSolid,
            top_face: profile_face, // sentinel — no separate "top"
            side_faces,
            all_solid_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-2-γ-i — Cylinder smooth-group radius offset.
    ///
    /// Profile face has `AnalyticSurface::Cylinder`. Detects the smooth
    /// group (all active faces sharing the same Cylinder instance within
    /// `EPSILON_LENGTH`), then radially offsets all group vertices by
    /// `dist`:
    ///   - Each vertex `v`: split into axial + radial components relative
    ///     to the cylinder axis. Scale radial by `(r + dist) / r`. Axial
    ///     preserved.
    ///   - All group face surfaces updated with `radius = current + dist`.
    ///   - Boundary `Arc` curves on cap edges (whose normal ≈ axis_dir
    ///     and center on axis) get their radius updated too.
    ///
    /// **Auto-expand semantics** (§W2γ1-B-(a)): the caller passes a single
    /// `profile_face`; this method expands to the full smooth group.
    /// Partial-panel rejection is not needed because the operation is
    /// idempotent across the group.
    ///
    /// Returns `NotYetSupported` if the new radius would collapse below
    /// `EPSILON_LENGTH` (geometry inversion guard).
    fn offset_smooth_group_cylinder(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let (axis_origin, axis_dir, current_radius, ref_dir, u_range, v_range) =
            match profile_surface {
                AnalyticSurface::Cylinder {
                    axis_origin,
                    axis_dir,
                    radius,
                    ref_dir,
                    u_range,
                    v_range,
                } => (
                    *axis_origin,
                    axis_dir.normalize_or_zero(),
                    *radius,
                    *ref_dir,
                    *u_range,
                    *v_range,
                ),
                _ => bail!("offset_smooth_group_cylinder: profile is not Cylinder"),
            };
        if axis_dir.length_squared() < 0.5 {
            bail!("offset_smooth_group_cylinder: axis_dir is near-zero");
        }
        if current_radius <= crate::tolerances::EPSILON_LENGTH {
            bail!(
                "offset_smooth_group_cylinder: current radius {:.3e} below epsilon",
                current_radius
            );
        }

        let new_radius = current_radius + dist;
        if new_radius <= crate::tolerances::EPSILON_LENGTH {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "offset would collapse cylinder radius to {:.3e} (current {:.3e}, dist {:.3e})",
                    new_radius, current_radius, dist
                ),
            }
            .into());
        }
        let scale = new_radius / current_radius;
        let tol = crate::tolerances::EPSILON_LENGTH;

        // Detect smooth group: active faces whose surface is a Cylinder
        // matching axis_origin, axis_dir, current_radius, ref_dir within tol.
        let group_faces: Vec<FaceId> = self
            .faces
            .iter()
            .filter_map(|(fid, face)| {
                if !face.is_active() {
                    return None;
                }
                match face.surface() {
                    Some(AnalyticSurface::Cylinder {
                        axis_origin: o,
                        axis_dir: a,
                        radius: r,
                        ref_dir: rd,
                        ..
                    }) => {
                        let a_n = a.normalize_or_zero();
                        let rd_n = rd.normalize_or_zero();
                        let ref_n = ref_dir.normalize_or_zero();
                        let same_axis = (*o - axis_origin).length() < tol
                            && a_n.dot(axis_dir).abs() > 0.999
                            && rd_n.dot(ref_n).abs() > 0.999
                            && (*r - current_radius).abs() < tol;
                        if same_axis {
                            Some(fid)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            })
            .collect();

        if !group_faces.contains(&profile_face) {
            bail!(
                "offset_smooth_group_cylinder: profile face {profile_face:?} \
                 not in detected smooth group (size {})",
                group_faces.len()
            );
        }

        // Collect unique vertices across the group.
        let mut group_verts: std::collections::HashSet<crate::entities::VertId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let start = self.faces[fid].outer().start;
            if start.is_null() {
                continue;
            }
            for v in self.collect_loop_verts(start)? {
                group_verts.insert(v);
            }
        }

        // Radial scale each vertex relative to the cylinder axis.
        for v in group_verts.iter().copied().collect::<Vec<_>>() {
            let pos = self.vertex_pos(v)?;
            let from_axis = pos - axis_origin;
            let axial = from_axis.dot(axis_dir) * axis_dir;
            let radial = from_axis - axial;
            let new_pos = axis_origin + axial + radial * scale;
            self.move_vertex(v, new_pos)?;
        }

        // Update each group face's Cylinder surface with new radius.
        let new_surface = AnalyticSurface::Cylinder {
            axis_origin,
            axis_dir,
            radius: new_radius,
            ref_dir,
            u_range,
            v_range,
        };
        for &fid in &group_faces {
            if let Some(face) = self.faces.get_mut(fid) {
                if face.is_active() {
                    face.set_surface(Some(new_surface.clone()));
                }
            }
        }

        // Update Arc curves on edges incident to group faces (cap rings).
        // Filter: arc center on axis (cross product with axis_dir near zero)
        // AND arc normal parallel to axis_dir.
        let mut updated_arcs: std::collections::HashSet<crate::entities::EdgeId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let edges = self.face_outer_edges(fid)?;
            for eid in edges {
                if updated_arcs.contains(&eid) {
                    continue;
                }
                let new_curve = if let Some(edge) = self.edges.get(eid) {
                    match edge.curve() {
                        Some(AnalyticCurve::Arc {
                            center,
                            radius: ar,
                            normal,
                            basis_u,
                            start_angle,
                            end_angle,
                        }) => {
                            let center_off_axis =
                                ((*center - axis_origin).cross(axis_dir)).length();
                            let normal_dot = normal.normalize_or_zero().dot(axis_dir).abs();
                            // Match to current cylinder radius (avoids touching
                            // unrelated arcs that happen to share axis).
                            let radius_match = (*ar - current_radius).abs() < tol;
                            if center_off_axis < tol && normal_dot > 0.999 && radius_match {
                                Some(AnalyticCurve::Arc {
                                    center: *center,
                                    radius: new_radius,
                                    normal: *normal,
                                    basis_u: *basis_u,
                                    start_angle: *start_angle,
                                    end_angle: *end_angle,
                                })
                            } else {
                                None
                            }
                        }
                        Some(AnalyticCurve::Circle {
                            center,
                            radius: cr,
                            normal,
                            basis_u,
                        }) => {
                            let center_off_axis =
                                ((*center - axis_origin).cross(axis_dir)).length();
                            let normal_dot = normal.normalize_or_zero().dot(axis_dir).abs();
                            let radius_match = (*cr - current_radius).abs() < tol;
                            if center_off_axis < tol && normal_dot > 0.999 && radius_match {
                                Some(AnalyticCurve::Circle {
                                    center: *center,
                                    radius: new_radius,
                                    normal: *normal,
                                    basis_u: *basis_u,
                                })
                            } else {
                                None
                            }
                        }
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(c) = new_curve {
                    if let Some(edge) = self.edges.get_mut(eid) {
                        edge.set_curve(Some(c));
                    }
                    updated_arcs.insert(eid);
                }
            }
        }

        // Result — top_face = profile_face (no new face created in offset),
        // side_faces = group members excluding profile.
        let side_faces: Vec<FaceId> = group_faces
            .iter()
            .copied()
            .filter(|&f| f != profile_face)
            .collect();

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::SmoothGroupOffset,
            top_face: profile_face,
            side_faces,
            all_solid_faces: group_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-2-γ-ii — Sphere smooth-group radius offset.
    ///
    /// Profile face has `AnalyticSurface::Sphere`. Detects the smooth
    /// group (active faces sharing the same Sphere instance within
    /// `EPSILON_LENGTH`), then radially offsets all group vertices by
    /// `dist`:
    ///   - Each vertex `v`: scale `(v - center)` by `(r + dist) / r`
    ///     about the sphere center. Equivalent to uniform radial scale
    ///     in 3D about `center`.
    ///   - All group face surfaces updated with `radius = current + dist`.
    ///   - Boundary `Arc` / `Circle` curves are also uniformly scaled
    ///     about the sphere center: new center = scale(C - sphere_center),
    ///     new radius = old_radius * scale. normal/basis_u preserved
    ///     under uniform scaling.
    ///
    /// **Auto-expand semantics** (§W2γ2-B-(a)): single profile_face →
    /// full smooth group, idempotent across the group.
    ///
    /// Returns `NotYetSupported` if the new radius would collapse below
    /// `EPSILON_LENGTH` (geometry inversion guard).
    fn offset_smooth_group_sphere(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let (center, current_radius, u_range, v_range) = match profile_surface {
            AnalyticSurface::Sphere {
                center,
                radius,
                u_range,
                v_range,
            } => (*center, *radius, *u_range, *v_range),
            _ => bail!("offset_smooth_group_sphere: profile is not Sphere"),
        };
        if current_radius <= crate::tolerances::EPSILON_LENGTH {
            bail!(
                "offset_smooth_group_sphere: current radius {:.3e} below epsilon",
                current_radius
            );
        }

        let new_radius = current_radius + dist;
        if new_radius <= crate::tolerances::EPSILON_LENGTH {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "offset would collapse sphere radius to {:.3e} (current {:.3e}, dist {:.3e})",
                    new_radius, current_radius, dist
                ),
            }
            .into());
        }
        let scale = new_radius / current_radius;
        let tol = crate::tolerances::EPSILON_LENGTH;

        // Detect smooth group: active faces whose surface is a Sphere
        // matching center + current_radius within tol.
        let group_faces: Vec<FaceId> = self
            .faces
            .iter()
            .filter_map(|(fid, face)| {
                if !face.is_active() {
                    return None;
                }
                match face.surface() {
                    Some(AnalyticSurface::Sphere {
                        center: c,
                        radius: r,
                        ..
                    }) => {
                        let same = (*c - center).length() < tol
                            && (*r - current_radius).abs() < tol;
                        if same {
                            Some(fid)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            })
            .collect();

        if !group_faces.contains(&profile_face) {
            bail!(
                "offset_smooth_group_sphere: profile face {profile_face:?} \
                 not in detected smooth group (size {})",
                group_faces.len()
            );
        }

        // Collect unique vertices across the group.
        let mut group_verts: std::collections::HashSet<crate::entities::VertId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let start = self.faces[fid].outer().start;
            if start.is_null() {
                continue;
            }
            for v in self.collect_loop_verts(start)? {
                group_verts.insert(v);
            }
        }

        // Uniform radial scale each vertex about the sphere center.
        // Vertices at center are degenerate (shouldn't occur on a sphere
        // surface) — skip to avoid NaN.
        for v in group_verts.iter().copied().collect::<Vec<_>>() {
            let pos = self.vertex_pos(v)?;
            let from_c = pos - center;
            if from_c.length_squared() < tol * tol {
                continue;
            }
            let new_pos = center + from_c * scale;
            self.move_vertex(v, new_pos)?;
        }

        // Update each group face's Sphere surface with new radius.
        let new_surface = AnalyticSurface::Sphere {
            center,
            radius: new_radius,
            u_range,
            v_range,
        };
        for &fid in &group_faces {
            if let Some(face) = self.faces.get_mut(fid) {
                if face.is_active() {
                    face.set_surface(Some(new_surface.clone()));
                }
            }
        }

        // Update Arc / Circle curves on edges incident to group faces.
        // Under uniform 3D scale about sphere center, an arc transforms:
        //   - new center = sphere_center + (old_center - sphere_center) * scale
        //   - new radius = old_radius * scale
        //   - normal / basis_u preserved (uniform scale preserves orientation)
        let mut updated_arcs: std::collections::HashSet<crate::entities::EdgeId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let edges = self.face_outer_edges(fid)?;
            for eid in edges {
                if updated_arcs.contains(&eid) {
                    continue;
                }
                let new_curve = if let Some(edge) = self.edges.get(eid) {
                    match edge.curve() {
                        Some(AnalyticCurve::Arc {
                            center: ac,
                            radius: ar,
                            normal,
                            basis_u,
                            start_angle,
                            end_angle,
                        }) => Some(AnalyticCurve::Arc {
                            center: center + (*ac - center) * scale,
                            radius: ar * scale,
                            normal: *normal,
                            basis_u: *basis_u,
                            start_angle: *start_angle,
                            end_angle: *end_angle,
                        }),
                        Some(AnalyticCurve::Circle {
                            center: cc,
                            radius: cr,
                            normal,
                            basis_u,
                        }) => Some(AnalyticCurve::Circle {
                            center: center + (*cc - center) * scale,
                            radius: cr * scale,
                            normal: *normal,
                            basis_u: *basis_u,
                        }),
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(c) = new_curve {
                    if let Some(edge) = self.edges.get_mut(eid) {
                        edge.set_curve(Some(c));
                    }
                    updated_arcs.insert(eid);
                }
            }
        }

        let side_faces: Vec<FaceId> = group_faces
            .iter()
            .copied()
            .filter(|&f| f != profile_face)
            .collect();

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::SmoothGroupOffset,
            top_face: profile_face,
            side_faces,
            all_solid_faces: group_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-2-γ-iii — Cone constant-offset (§W2γ3-D Option 3).
    ///
    /// True surface-offset semantics: each vertex moves by `dist` along
    /// its outward surface normal at P. The cone's `half_angle` and
    /// `ref_dir` are preserved (cone identity invariant); the apex shifts
    /// along `-axis_dir` by `dist / sin(half_angle)` and v_range shifts by
    /// `dist * cos²(half_angle) / sin(half_angle)`.
    ///
    /// **Math derivation (apex at origin, axis = +Z, axial coord = z)**:
    /// - At point P with axial z and angular u: P = (z·tan(α)·cos(u),
    ///   z·tan(α)·sin(u), z)
    /// - Outward normal: n(u) = (cos(α)·cos(u), cos(α)·sin(u), -sin(α))
    /// - After offset: P' = P + dist·n
    ///   - new radius at z: z·tan(α) + dist·cos(α)
    ///   - new axial: z - dist·sin(α)
    /// - To represent P' on a cone with same α and same axis: new apex
    ///   at z' = -dist/sin(α) (relative to old apex)
    /// - In vector form: `apex_new = apex_old - (dist/sin(α)) · axis_dir`
    ///
    /// **Per-vertex normal** (P relative to apex):
    /// - radial_vec = (P - apex) - ((P - apex)·axis_dir)·axis_dir
    /// - radial_dir = radial_vec.normalize()
    /// - normal = cos(α)·radial_dir - sin(α)·axis_dir
    ///
    /// **Boundary latitude rings** (Arc/Circle with center on axis,
    /// normal ‖ axis_dir):
    /// - new_center = old_center - dist·sin(α)·axis_dir
    /// - new_radius = old_radius + dist·cos(α)
    /// - normal / basis_u / angles preserved
    ///
    /// Returns `NotYetSupported` if:
    /// - half_angle outside (1e-6, π/2 - 1e-6) — singular cone
    /// - new v_range minimum collapses below `EPSILON_LENGTH`
    fn offset_smooth_group_cone(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let (apex, axis_dir, half_angle, ref_dir, u_range, v_range) = match profile_surface {
            AnalyticSurface::Cone {
                apex,
                axis_dir,
                half_angle,
                ref_dir,
                u_range,
                v_range,
            } => (
                *apex,
                axis_dir.normalize_or_zero(),
                *half_angle,
                *ref_dir,
                *u_range,
                *v_range,
            ),
            _ => bail!("offset_smooth_group_cone: profile is not Cone"),
        };
        if axis_dir.length_squared() < 0.5 {
            bail!("offset_smooth_group_cone: axis_dir near zero");
        }

        let alpha_eps = 1e-6;
        if half_angle < alpha_eps
            || half_angle > std::f64::consts::FRAC_PI_2 - alpha_eps
        {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "cone half_angle {:.4e} outside (epsilon, π/2 - epsilon) — singular",
                    half_angle
                ),
            }
            .into());
        }

        let sin_a = half_angle.sin();
        let cos_a = half_angle.cos();
        let tan_a = half_angle.tan();
        let tol = crate::tolerances::EPSILON_LENGTH;

        // Apex shifts along -axis_dir by dist/sin(α). New v_range shifts by
        // dist*cos²(α)/sin(α) (constant, preserves v_range width).
        let apex_shift = -dist / sin_a;
        let new_apex = apex + apex_shift * axis_dir;
        let v_shift = dist * cos_a * cos_a / sin_a;
        let new_v_range = (v_range.0 + v_shift, v_range.1 + v_shift);

        // Collapse guard — new v_range must remain positive.
        if new_v_range.0 < tol {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "offset would collapse cone: new v_min = {:.3e} ≤ epsilon \
                     (old v_min {:.3e}, dist {:.3e}, half_angle {:.4})",
                    new_v_range.0, v_range.0, dist, half_angle
                ),
            }
            .into());
        }

        // Detect smooth group: faces with matching Cone instance.
        let group_faces: Vec<FaceId> = self
            .faces
            .iter()
            .filter_map(|(fid, face)| {
                if !face.is_active() {
                    return None;
                }
                match face.surface() {
                    Some(AnalyticSurface::Cone {
                        apex: a,
                        axis_dir: ad,
                        half_angle: ha,
                        ref_dir: rd,
                        ..
                    }) => {
                        let same = (*a - apex).length() < tol
                            && ad.normalize_or_zero().dot(axis_dir).abs() > 0.999
                            && (*ha - half_angle).abs() < 1e-9
                            && rd.normalize_or_zero()
                                .dot(ref_dir.normalize_or_zero())
                                .abs()
                                > 0.999;
                        if same {
                            Some(fid)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            })
            .collect();

        if !group_faces.contains(&profile_face) {
            bail!(
                "offset_smooth_group_cone: profile face {profile_face:?} \
                 not in detected smooth group (size {})",
                group_faces.len()
            );
        }

        // Collect unique vertices across the group.
        let mut group_verts: std::collections::HashSet<crate::entities::VertId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let start = self.faces[fid].outer().start;
            if start.is_null() {
                continue;
            }
            for v in self.collect_loop_verts(start)? {
                group_verts.insert(v);
            }
        }

        // Move each vertex along its surface normal at P.
        for v in group_verts.iter().copied().collect::<Vec<_>>() {
            let pos = self.vertex_pos(v)?;
            let from_apex = pos - apex;
            let axial = from_apex.dot(axis_dir);
            let radial_vec = from_apex - axial * axis_dir;
            if radial_vec.length_squared() < tol * tol {
                // Vertex at apex — singular, skip.
                continue;
            }
            let radial_dir = radial_vec.normalize();
            let normal = cos_a * radial_dir - sin_a * axis_dir;
            let new_pos = pos + dist * normal;
            self.move_vertex(v, new_pos)?;
        }

        // Update each group face's Cone surface with new apex + v_range.
        let new_surface = AnalyticSurface::Cone {
            apex: new_apex,
            axis_dir,
            half_angle,
            ref_dir,
            u_range,
            v_range: new_v_range,
        };
        for &fid in &group_faces {
            if let Some(face) = self.faces.get_mut(fid) {
                if face.is_active() {
                    face.set_surface(Some(new_surface.clone()));
                }
            }
        }

        // Update boundary Arc / Circle latitude rings:
        //   filter: center on axis (cross-product with axis_dir < tol)
        //         + normal ‖ axis_dir
        //         + radius ≈ axial_pos · tan(half_angle) (sanity)
        // Update: new_center = center - dist·sin(α)·axis_dir
        //         new_radius = radius + dist·cos(α)
        let mut updated_arcs: std::collections::HashSet<crate::entities::EdgeId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let edges = self.face_outer_edges(fid)?;
            for eid in edges {
                if updated_arcs.contains(&eid) {
                    continue;
                }
                let new_curve = if let Some(edge) = self.edges.get(eid) {
                    match edge.curve() {
                        Some(AnalyticCurve::Arc {
                            center,
                            radius: ar,
                            normal,
                            basis_u,
                            start_angle,
                            end_angle,
                        }) => {
                            let center_off_axis =
                                ((*center - apex).cross(axis_dir)).length();
                            let normal_dot = normal.normalize_or_zero().dot(axis_dir).abs();
                            let v_axial = (*center - apex).dot(axis_dir);
                            let expected_r = v_axial * tan_a;
                            // Use looser tol on radius (numeric drift after move_vertex on
                            // earlier iterations) — but pre-move check happens BEFORE
                            // any vertex move on this iteration's edge sweep, so it's tight.
                            let radius_match = (*ar - expected_r).abs() < tol;
                            if center_off_axis < tol
                                && normal_dot > 0.999
                                && radius_match
                            {
                                let new_r = *ar + dist * cos_a;
                                if new_r > tol {
                                    Some(AnalyticCurve::Arc {
                                        center: *center - dist * sin_a * axis_dir,
                                        radius: new_r,
                                        normal: *normal,
                                        basis_u: *basis_u,
                                        start_angle: *start_angle,
                                        end_angle: *end_angle,
                                    })
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        }
                        Some(AnalyticCurve::Circle {
                            center,
                            radius: cr,
                            normal,
                            basis_u,
                        }) => {
                            let center_off_axis =
                                ((*center - apex).cross(axis_dir)).length();
                            let normal_dot = normal.normalize_or_zero().dot(axis_dir).abs();
                            let v_axial = (*center - apex).dot(axis_dir);
                            let expected_r = v_axial * tan_a;
                            let radius_match = (*cr - expected_r).abs() < tol;
                            if center_off_axis < tol
                                && normal_dot > 0.999
                                && radius_match
                            {
                                let new_r = *cr + dist * cos_a;
                                if new_r > tol {
                                    Some(AnalyticCurve::Circle {
                                        center: *center - dist * sin_a * axis_dir,
                                        radius: new_r,
                                        normal: *normal,
                                        basis_u: *basis_u,
                                    })
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        }
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(c) = new_curve {
                    if let Some(edge) = self.edges.get_mut(eid) {
                        edge.set_curve(Some(c));
                    }
                    updated_arcs.insert(eid);
                }
            }
        }

        let side_faces: Vec<FaceId> = group_faces
            .iter()
            .copied()
            .filter(|&f| f != profile_face)
            .collect();

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::SmoothGroupOffset,
            top_face: profile_face,
            side_faces,
            all_solid_faces: group_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// ADR-079 W-2-γ-iv — Torus constant-offset (§W2γ4-D Option 2).
    ///
    /// Equivalent to `minor_radius += dist` because the torus surface
    /// normal at any point is exactly the radial direction from the
    /// minor circle's center (which sits on the major circle).
    /// Center / axis_dir / ref_dir / major_radius UNCHANGED.
    ///
    /// **Math** (P on torus with center C, axis Z, ref X, R = major,
    /// r = minor):
    /// - radial_vec = (P - C) - ((P - C)·Z)·Z  (in major-plane component)
    /// - radial_dir = radial_vec.normalize()
    /// - major_circle_pt = C + R·radial_dir
    /// - normal at P = (P - major_circle_pt).normalize()
    ///   (this is exactly the unit vector from minor circle center to P,
    ///    which equals cos(v)·radial_dir + sin(v)·axis_dir for some v)
    /// - P' = P + dist·normal
    /// - new minor circle has same center (major_circle_pt) but radius
    ///   r + dist → P' lies on torus with same C/Z/X/R but minor = r + dist
    ///
    /// **Latitude circle update** (Arc/Circle with center on axis +
    /// normal ‖ axis_dir) — center at C + r·sin(v)·Z, radius = R +
    /// r·cos(v) for some v ∈ [0, 2π]:
    /// - extract sin(v) = axial_offset / r, cos(v) = (radius - R) / r
    /// - sanity: sin² + cos² ≈ 1
    /// - new_center = C + (r+d)·sin(v)·Z = old_center + d·sin(v)·Z
    /// - new_radius = R + (r+d)·cos(v) = old_radius + d·cos(v)
    ///
    /// Returns `NotYetSupported` if:
    /// - new minor_radius ≤ EPSILON_LENGTH (collapse / inversion)
    fn offset_smooth_group_torus(
        &mut self,
        profile_face: FaceId,
        dist: f64,
        profile_surface: &AnalyticSurface,
    ) -> Result<CreateSolidResult> {
        let (center, axis_dir, ref_dir, major_radius, minor_radius, u_range, v_range) =
            match profile_surface {
                AnalyticSurface::Torus {
                    center,
                    axis_dir,
                    ref_dir,
                    major_radius,
                    minor_radius,
                    u_range,
                    v_range,
                } => (
                    *center,
                    axis_dir.normalize_or_zero(),
                    *ref_dir,
                    *major_radius,
                    *minor_radius,
                    *u_range,
                    *v_range,
                ),
                _ => bail!("offset_smooth_group_torus: profile is not Torus"),
            };
        if axis_dir.length_squared() < 0.5 {
            bail!("offset_smooth_group_torus: axis_dir near zero");
        }
        let tol = crate::tolerances::EPSILON_LENGTH;
        if major_radius <= tol || minor_radius <= tol {
            bail!(
                "offset_smooth_group_torus: degenerate radii \
                 (major {:.3e}, minor {:.3e})",
                major_radius,
                minor_radius
            );
        }

        let new_minor = minor_radius + dist;
        if new_minor <= tol {
            return Err(SolidError::NotYetSupported {
                reason: format!(
                    "offset would collapse torus minor_radius to {:.3e} \
                     (current {:.3e}, dist {:.3e})",
                    new_minor, minor_radius, dist
                ),
            }
            .into());
        }

        // Detect smooth group: faces with matching Torus instance.
        let group_faces: Vec<FaceId> = self
            .faces
            .iter()
            .filter_map(|(fid, face)| {
                if !face.is_active() {
                    return None;
                }
                match face.surface() {
                    Some(AnalyticSurface::Torus {
                        center: c,
                        axis_dir: ad,
                        ref_dir: rd,
                        major_radius: mr,
                        minor_radius: nr,
                        ..
                    }) => {
                        let same = (*c - center).length() < tol
                            && ad.normalize_or_zero().dot(axis_dir).abs() > 0.999
                            && rd.normalize_or_zero()
                                .dot(ref_dir.normalize_or_zero())
                                .abs()
                                > 0.999
                            && (*mr - major_radius).abs() < tol
                            && (*nr - minor_radius).abs() < tol;
                        if same {
                            Some(fid)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            })
            .collect();

        if !group_faces.contains(&profile_face) {
            bail!(
                "offset_smooth_group_torus: profile face {profile_face:?} \
                 not in detected smooth group (size {})",
                group_faces.len()
            );
        }

        // Collect group vertices.
        let mut group_verts: std::collections::HashSet<crate::entities::VertId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let start = self.faces[fid].outer().start;
            if start.is_null() {
                continue;
            }
            for v in self.collect_loop_verts(start)? {
                group_verts.insert(v);
            }
        }

        // Move each vertex along surface normal at P.
        // Surface normal = unit vector from major-circle point to P.
        for v in group_verts.iter().copied().collect::<Vec<_>>() {
            let pos = self.vertex_pos(v)?;
            let from_c = pos - center;
            let axial = from_c.dot(axis_dir);
            let radial_vec = from_c - axial * axis_dir;
            if radial_vec.length_squared() < tol * tol {
                // Vertex on torus axis — degenerate (shouldn't happen on a
                // valid torus surface). Skip.
                continue;
            }
            let radial_dir = radial_vec.normalize();
            let major_pt = center + major_radius * radial_dir;
            let to_surface = pos - major_pt;
            if to_surface.length_squared() < tol * tol {
                // Vertex at major circle center — also degenerate.
                continue;
            }
            let normal = to_surface.normalize();
            let new_pos = pos + dist * normal;
            self.move_vertex(v, new_pos)?;
        }

        // Update each group face's Torus surface with new minor_radius.
        let new_surface = AnalyticSurface::Torus {
            center,
            axis_dir,
            ref_dir,
            major_radius,
            minor_radius: new_minor,
            u_range,
            v_range,
        };
        for &fid in &group_faces {
            if let Some(face) = self.faces.get_mut(fid) {
                if face.is_active() {
                    face.set_surface(Some(new_surface.clone()));
                }
            }
        }

        // Update latitude circles on group face boundaries:
        //   filter: center on axis + normal ‖ axis_dir
        //   sanity: extract sin(v) = axial_offset/minor, cos(v) = (r-R)/minor;
        //           verify sin² + cos² ≈ 1
        //   update: new_center = center + d·sin(v)·axis_dir,
        //           new_radius = r + d·cos(v)
        let mut updated_arcs: std::collections::HashSet<crate::entities::EdgeId> =
            std::collections::HashSet::new();
        for &fid in &group_faces {
            let edges = self.face_outer_edges(fid)?;
            for eid in edges {
                if updated_arcs.contains(&eid) {
                    continue;
                }
                let new_curve = if let Some(edge) = self.edges.get(eid) {
                    match edge.curve() {
                        Some(AnalyticCurve::Arc {
                            center: ac,
                            radius: ar,
                            normal,
                            basis_u,
                            start_angle,
                            end_angle,
                        }) => Self::torus_latitude_arc_update(
                            *ac,
                            *ar,
                            *normal,
                            *basis_u,
                            Some((*start_angle, *end_angle)),
                            center,
                            axis_dir,
                            major_radius,
                            minor_radius,
                            dist,
                            tol,
                        ),
                        Some(AnalyticCurve::Circle {
                            center: cc,
                            radius: cr,
                            normal,
                            basis_u,
                        }) => Self::torus_latitude_arc_update(
                            *cc,
                            *cr,
                            *normal,
                            *basis_u,
                            None,
                            center,
                            axis_dir,
                            major_radius,
                            minor_radius,
                            dist,
                            tol,
                        ),
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(c) = new_curve {
                    if let Some(edge) = self.edges.get_mut(eid) {
                        edge.set_curve(Some(c));
                    }
                    updated_arcs.insert(eid);
                }
            }
        }

        let side_faces: Vec<FaceId> = group_faces
            .iter()
            .copied()
            .filter(|&f| f != profile_face)
            .collect();

        Ok(CreateSolidResult {
            profile_face,
            solid_kind: SolidKind::SmoothGroupOffset,
            top_face: profile_face,
            side_faces,
            all_solid_faces: group_faces,
            adjacent_splits: 0,
            split_debug: Vec::new(),
        })
    }

    /// Helper for `offset_smooth_group_torus` — update a latitude
    /// Arc/Circle on a torus under minor_radius offset by `dist`.
    /// Returns `Some(new_curve)` if the arc passes the latitude filter
    /// (center on axis + normal ‖ axis_dir + sin²+cos²≈1 sanity), else `None`.
    /// `angles = Some((start, end))` for Arc, `None` for Circle.
    #[allow(clippy::too_many_arguments)]
    fn torus_latitude_arc_update(
        arc_center: DVec3,
        arc_radius: f64,
        arc_normal: DVec3,
        arc_basis_u: DVec3,
        angles: Option<(f64, f64)>,
        torus_center: DVec3,
        axis_dir: DVec3,
        major_radius: f64,
        minor_radius: f64,
        dist: f64,
        tol: f64,
    ) -> Option<AnalyticCurve> {
        // Filter: center on axis + normal parallel to axis.
        let center_off_axis = ((arc_center - torus_center).cross(axis_dir)).length();
        let normal_dot = arc_normal.normalize_or_zero().dot(axis_dir).abs();
        if center_off_axis >= tol || normal_dot < 0.999 {
            return None;
        }

        // Extract latitude angle v from arc params.
        let axial_offset = (arc_center - torus_center).dot(axis_dir);
        let sin_v = axial_offset / minor_radius;
        let cos_v = (arc_radius - major_radius) / minor_radius;
        // Sanity: must lie on unit circle (within reasonable numeric tol).
        let unit_check = (sin_v * sin_v + cos_v * cos_v - 1.0).abs();
        if unit_check > 1e-6 {
            return None;
        }

        let new_axial = axial_offset + dist * sin_v;
        let new_center = torus_center + new_axial * axis_dir
            + (arc_center - torus_center - axial_offset * axis_dir);
        let new_radius = arc_radius + dist * cos_v;
        if new_radius <= tol {
            return None;
        }

        match angles {
            Some((s, e)) => Some(AnalyticCurve::Arc {
                center: new_center,
                radius: new_radius,
                normal: arc_normal,
                basis_u: arc_basis_u,
                start_angle: s,
                end_angle: e,
            }),
            None => Some(AnalyticCurve::Circle {
                center: new_center,
                radius: new_radius,
                normal: arc_normal,
                basis_u: arc_basis_u,
            }),
        }
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

/// ADR-079 §W2-B-(a) — Extract shared circle parameters from a profile
/// face whose outer boundary is `AllCircular`.
///
/// Returns `(center, radius, normal, basis_u)` of the underlying circle.
/// All Arc/Circle edges in the loop must share these parameters within
/// `EPSILON_LENGTH`. Edges with `Some(Line)` or `None` curve fail loudly
/// — caller should have classified the boundary as `AllCircular` first.
///
/// On mismatch returns `Err`, allowing the caller to convert to
/// `SolidError::NotYetSupported` and trigger Q3 fallback.
fn extract_shared_circle_params(
    mesh: &Mesh,
    face: FaceId,
) -> Result<(DVec3, f64, DVec3, DVec3)> {
    let edges = mesh.face_outer_edges(face)?;
    if edges.is_empty() {
        bail!("extract_shared_circle_params: face {face:?} has no outer edges");
    }

    let mut shared: Option<(DVec3, f64, DVec3, DVec3)> = None;
    let tol = crate::tolerances::EPSILON_LENGTH;

    for &eid in &edges {
        let edge = mesh.edges.get(eid).ok_or_else(|| {
            anyhow::anyhow!("extract_shared_circle_params: edge {eid:?} not found")
        })?;
        let (c, r, n, bu) = match edge.curve() {
            Some(AnalyticCurve::Circle { center, radius, normal, basis_u }) => {
                (*center, *radius, *normal, *basis_u)
            }
            Some(AnalyticCurve::Arc { center, radius, normal, basis_u, .. }) => {
                (*center, *radius, *normal, *basis_u)
            }
            _ => bail!(
                "extract_shared_circle_params: edge {eid:?} is not Circle/Arc \
                 (caller should classify as AllCircular first)"
            ),
        };
        match shared {
            None => shared = Some((c, r, n, bu)),
            Some((cs, rs, ns, _)) => {
                if (c - cs).length() > tol {
                    bail!(
                        "center mismatch (Δ = {:.2e} mm > tol {:.2e})",
                        (c - cs).length(),
                        tol
                    );
                }
                if (r - rs).abs() > tol {
                    bail!(
                        "radius mismatch (Δ = {:.2e} mm > tol {:.2e})",
                        (r - rs).abs(),
                        tol
                    );
                }
                // Normal may be flipped between sub-arcs of the same circle —
                // accept either orientation as long as parallel.
                let dot = n.normalize_or_zero().dot(ns.normalize_or_zero());
                if dot.abs() < 0.999 {
                    bail!(
                        "normal mismatch (dot = {:.4}, expected |dot| ≥ 0.999)",
                        dot
                    );
                }
            }
        }
    }

    shared.ok_or_else(|| anyhow::anyhow!("extract_shared_circle_params: empty boundary"))
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
    fn revolve_partial_angle_returns_not_yet_supported() {
        // W-4-α scope: full 360° only. Partial angle (angle_rad ≠ TAU) → NotYetSupported.
        let mut mesh = Mesh::new();
        let profile = build_unit_square_plane_face(&mut mesh);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::PI, // 180° — partial
            },
            MaterialId::new(0),
        );
        let err_msg = format!("{}", result.err().unwrap());
        assert!(
            err_msg.contains("not yet supported")
                && (err_msg.contains("partial angle") || err_msg.contains("Revolve")),
            "error must indicate partial-angle Revolve not yet supported, got: {err_msg}"
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

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-α — Plane + AllCircular → Cylinder regression
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build an N-segment circle face on z=0 with normal +Z.
    /// Each segment edge gets `AnalyticCurve::Arc` attached, sharing
    /// (center, radius, normal, basis_u). Face gets `AnalyticSurface::Plane`.
    fn build_circle_face(mesh: &mut Mesh, radius: f64, segments: u32) -> FaceId {
        use crate::curves::AnalyticCurve;
        let mat = MaterialId::new(0);
        let n = segments as usize;
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let basis_u = DVec3::X;

        let mut verts = Vec::with_capacity(n);
        for i in 0..n {
            let theta = (i as f64) * std::f64::consts::TAU / (n as f64);
            verts.push(mesh.add_vertex(DVec3::new(
                radius * theta.cos(),
                radius * theta.sin(),
                0.0,
            )));
        }
        let face = mesh.add_face(&verts, mat).expect("add_face");

        // Attach Plane surface.
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: center,
            normal,
            basis_u,
            u_range: (-radius, radius),
            v_range: (-radius, radius),
        }));

        // Attach Arc curve to each edge.
        let edges = mesh.face_outer_edges(face).expect("face_outer_edges");
        let two_pi = std::f64::consts::TAU;
        for (i, &eid) in edges.iter().enumerate() {
            let theta_start = (i as f64) * two_pi / (n as f64);
            let theta_end = ((i + 1) as f64) * two_pi / (n as f64);
            let curve = AnalyticCurve::Arc {
                center,
                radius,
                normal,
                basis_u,
                start_angle: theta_start,
                end_angle: theta_end,
            };
            mesh.edges[eid].set_curve(Some(curve));
        }

        face
    }

    #[test]
    fn create_solid_extrude_plane_circle_returns_cylinder() {
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 5.0, 16);
        let face_count_before = mesh.face_count();

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 10.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        assert_eq!(result.profile_face, profile);
        assert_eq!(result.side_faces.len(), 16);
        // Profile + top + 16 sides = 18 faces.
        assert_eq!(result.all_solid_faces.len(), 18);
        assert_eq!(mesh.face_count(), face_count_before + 17);
    }

    #[test]
    fn create_solid_cylinder_attaches_cylinder_surface_to_sides() {
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 3.0, 12);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 4.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        // Top face: Plane.
        let top_surface = mesh.faces[result.top_face].surface();
        assert!(
            matches!(top_surface, Some(AnalyticSurface::Plane { .. })),
            "top face must have Plane surface attached"
        );

        // ALL side faces: Cylinder, sharing (center, radius).
        for &side_fid in &result.side_faces {
            let side_surface = mesh.faces[side_fid].surface();
            match side_surface {
                Some(AnalyticSurface::Cylinder { radius, axis_origin, .. }) => {
                    assert!((radius - 3.0).abs() < 1e-9, "radius != 3.0: got {radius}");
                    assert!(
                        (axis_origin - DVec3::ZERO).length() < 1e-9,
                        "axis_origin != ZERO"
                    );
                }
                other => panic!(
                    "side face {side_fid:?} must have Cylinder surface, got {:?}",
                    other.map(|s| s.kind_label())
                ),
            }
        }
    }

    #[test]
    fn create_solid_cylinder_negative_distance_winding_correct() {
        // Recess (dist < 0) — top is below profile, side winding reversed.
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 2.0, 8);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: -3.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        assert_eq!(result.side_faces.len(), 8);
        // All side faces must still have Cylinder surface attached.
        for &side_fid in &result.side_faces {
            assert!(
                matches!(
                    mesh.faces[side_fid].surface(),
                    Some(AnalyticSurface::Cylinder { .. })
                ),
                "side face {side_fid:?} must have Cylinder (dist < 0)"
            );
        }
    }

    #[test]
    fn create_solid_cylinder_arcs_share_circle_params_check() {
        // Sanity: extract_shared_circle_params returns the exact center/radius.
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 7.5, 24);
        let (center, radius, _normal, _basis) =
            extract_shared_circle_params(&mesh, profile).expect("extract OK");
        assert!((center - DVec3::ZERO).length() < 1e-9);
        assert!((radius - 7.5).abs() < 1e-9);
    }

    #[test]
    fn create_solid_cylinder_arc_param_mismatch_falls_back() {
        // Tamper one edge's Arc curve to have different center → mismatch.
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 5.0, 8);
        let edges = mesh.face_outer_edges(profile).expect("edges");
        // Replace first edge's curve with a different center.
        let bad = AnalyticCurve::Arc {
            center: DVec3::new(100.0, 0.0, 0.0), // wrong center
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_4,
        };
        mesh.edges[edges[0]].set_curve(Some(bad));

        // Confirm classify still returns AllCircular (kind-only check).
        assert_eq!(
            classify_boundary(&mesh, profile).expect("classify"),
            BoundaryKind::AllCircular
        );

        // create_solid should now return NotYetSupported (Q3 fallback).
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Extrude { distance: 2.0 },
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail with mismatched arc params");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("mismatch"),
            "expected NotYetSupported with mismatch reason, got: {msg}"
        );
    }

    #[test]
    fn classify_boundary_all_circular_for_circle_face() {
        let mut mesh = Mesh::new();
        let face = build_circle_face(&mut mesh, 1.0, 12);
        let kind = classify_boundary(&mesh, face).expect("classify OK");
        assert_eq!(kind, BoundaryKind::AllCircular);
    }

    #[test]
    fn create_solid_cylinder_top_translated_by_profile_normal() {
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 4.0, 8);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 6.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        // Top face's outer loop should have z = 6.0 (translated by +Z * 6).
        let top_start = mesh.faces[result.top_face].outer().start;
        let top_verts = mesh.collect_loop_verts(top_start).expect("top verts");
        for v in &top_verts {
            let pos = mesh.vertex_pos(*v).expect("vertex_pos");
            assert!(
                (pos.z - 6.0).abs() < 1e-9,
                "top vertex z must be 6.0, got {}",
                pos.z
            );
            // Radial check: x² + y² = 16 (radius 4).
            let r2 = pos.x * pos.x + pos.y * pos.y;
            assert!((r2 - 16.0).abs() < 1e-6, "radius² != 16: got {r2}");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-γ-i — Cylinder smooth-group radius offset
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build an existing cylinder solid via W-2-α and return
    /// (mesh, profile, top_face, side_faces). The side faces share a
    /// single Cylinder surface instance — the smooth group W-2-γ-i targets.
    fn build_cylinder_solid(radius: f64, dist: f64, segments: u32) -> (Mesh, CreateSolidResult) {
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, radius, segments);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: dist },
                MaterialId::new(0),
            )
            .expect("create_solid OK");
        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        (mesh, result)
    }

    #[test]
    fn cylinder_smooth_group_offset_outward_increases_radius() {
        let (mut mesh, cyl) = build_cylinder_solid(2.0, 5.0, 16);
        // Pick any side face as profile for the offset operation.
        let side_profile = cyl.side_faces[0];

        // Offset outward by +1.0 → new radius = 3.0.
        let result = mesh
            .create_solid(
                side_profile,
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("smooth-group offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        // Group should contain all 16 side faces.
        assert_eq!(
            result.all_solid_faces.len(),
            16,
            "smooth group must include all 16 side faces"
        );

        // All side face surfaces must now have radius = 3.0.
        for &fid in &cyl.side_faces {
            match mesh.faces[fid].surface() {
                Some(AnalyticSurface::Cylinder { radius, .. }) => {
                    assert!(
                        (radius - 3.0).abs() < 1e-9,
                        "face {fid:?} radius != 3.0, got {radius}"
                    );
                }
                other => panic!(
                    "face {fid:?} must be Cylinder, got {:?}",
                    other.map(|s| s.kind_label())
                ),
            }
        }
    }

    #[test]
    fn cylinder_smooth_group_offset_scales_vertices_radially() {
        let (mut mesh, _cyl) = build_cylinder_solid(2.0, 5.0, 8);
        // Find one side face and use as profile.
        let side_profile = mesh
            .faces
            .iter()
            .find_map(|(fid, face)| {
                matches!(face.surface(), Some(AnalyticSurface::Cylinder { .. }))
                    .then_some(fid)
            })
            .expect("must find a side face");

        let result = mesh
            .create_solid(
                side_profile,
                CreateSolidMode::Extrude { distance: 3.0 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // After offset (2 → 5), every group vertex should have radius 5
        // (in the xy plane, since axis = +Z).
        let mut group_verts = std::collections::HashSet::new();
        for &fid in &result.all_solid_faces {
            let start = mesh.faces[fid].outer().start;
            for v in mesh.collect_loop_verts(start).unwrap() {
                group_verts.insert(v);
            }
        }
        for v in &group_verts {
            let pos = mesh.vertex_pos(*v).unwrap();
            let r = (pos.x * pos.x + pos.y * pos.y).sqrt();
            assert!((r - 5.0).abs() < 1e-6, "vertex r != 5.0: got {r}");
        }
    }

    #[test]
    fn cylinder_smooth_group_offset_inward_decreases_radius() {
        let (mut mesh, cyl) = build_cylinder_solid(5.0, 3.0, 12);
        // Inward offset: -2.0 → new radius = 3.0.
        let result = mesh
            .create_solid(
                cyl.side_faces[0],
                CreateSolidMode::Extrude { distance: -2.0 },
                MaterialId::new(0),
            )
            .expect("inward offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        for &fid in &cyl.side_faces {
            if let Some(AnalyticSurface::Cylinder { radius, .. }) = mesh.faces[fid].surface() {
                assert!((radius - 3.0).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn cylinder_smooth_group_offset_collapse_falls_back() {
        // Inward offset that would collapse radius below epsilon → Q3 fallback.
        let (mut mesh, cyl) = build_cylinder_solid(2.0, 4.0, 8);
        let result = mesh.create_solid(
            cyl.side_faces[0],
            CreateSolidMode::Extrude { distance: -2.0 }, // exactly to zero
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail (collapse)");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("collapse"),
            "expected NotYetSupported with 'collapse' reason, got: {msg}"
        );
    }

    #[test]
    fn cylinder_smooth_group_offset_updates_cap_arc_radius() {
        let (mut mesh, cyl) = build_cylinder_solid(3.0, 4.0, 8);
        // Verify cap edges initially have Arc curves with radius=3.
        // (build_circle_face attached Arc to profile edges; W-2-α didn't
        // attach Arc to top cap edges — the top cap edges are NEW edges
        // that connect newly-translated vertices, no curve set.)
        // Profile (= original circle face) edges have Arc r=3.
        let profile_edges = mesh.face_outer_edges(cyl.profile_face).unwrap();
        let initial_arc_count = profile_edges
            .iter()
            .filter(|&&eid| {
                matches!(
                    mesh.edges.get(eid).and_then(|e| e.curve()),
                    Some(AnalyticCurve::Arc { .. })
                )
            })
            .count();
        assert!(initial_arc_count > 0, "profile edges must have Arc curves");

        let _ = mesh
            .create_solid(
                cyl.side_faces[0],
                CreateSolidMode::Extrude { distance: 2.0 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // After offset, Arc curves on profile edges should now have radius=5.
        for &eid in &profile_edges {
            if let Some(AnalyticCurve::Arc { radius, .. }) =
                mesh.edges.get(eid).and_then(|e| e.curve())
            {
                assert!(
                    (radius - 5.0).abs() < 1e-9,
                    "cap arc edge {eid:?} radius != 5.0: got {radius}"
                );
            }
        }
    }

    #[test]
    fn cylinder_smooth_group_offset_returns_smooth_group_offset_kind() {
        let (mut mesh, cyl) = build_cylinder_solid(1.5, 2.0, 6);
        let result = mesh
            .create_solid(
                cyl.side_faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");
        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        // top_face = profile_face (no new face created).
        assert_eq!(result.top_face, result.profile_face);
        // side_faces = group members minus profile.
        assert_eq!(result.side_faces.len(), 5);
        // all_solid_faces = full group.
        assert_eq!(result.all_solid_faces.len(), 6);
    }

    #[test]
    fn cylinder_smooth_group_offset_preserves_axial_height() {
        // Axial position (z, since axis = +Z) must be preserved by offset.
        let (mut mesh, cyl) = build_cylinder_solid(2.0, 7.0, 8);
        let _ = mesh
            .create_solid(
                cyl.side_faces[0],
                CreateSolidMode::Extrude { distance: 1.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // Profile (z=0) and top cap (z=7) z-coordinates must be unchanged.
        let profile_start = mesh.faces[cyl.profile_face].outer().start;
        for v in mesh.collect_loop_verts(profile_start).unwrap() {
            let pos = mesh.vertex_pos(v).unwrap();
            assert!(
                pos.z.abs() < 1e-9,
                "profile z must remain 0, got {}",
                pos.z
            );
        }
        let top_start = mesh.faces[cyl.top_face].outer().start;
        for v in mesh.collect_loop_verts(top_start).unwrap() {
            let pos = mesh.vertex_pos(v).unwrap();
            assert!(
                (pos.z - 7.0).abs() < 1e-9,
                "top z must remain 7, got {}",
                pos.z
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-γ-ii — Sphere smooth-group radius offset
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build 2 triangle faces on a sphere centered at origin.
    /// Both faces share the same `AnalyticSurface::Sphere` instance, so
    /// they form a smooth group.
    ///
    /// Triangles share an edge (north_pole — equator_y) so the test
    /// exercises shared-vertex semantics.
    fn build_sphere_two_faces(radius: f64) -> (Mesh, Vec<FaceId>) {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let center = DVec3::ZERO;

        // 4 verts on the sphere surface:
        //   v_x  = (R, 0, 0)        equator at θ=0
        //   v_y  = (0, R, 0)        equator at θ=90°
        //   v_nx = (-R, 0, 0)       equator at θ=180°
        //   v_n  = (0, 0, R)        north pole
        let v_x = mesh.add_vertex(DVec3::new(radius, 0.0, 0.0));
        let v_y = mesh.add_vertex(DVec3::new(0.0, radius, 0.0));
        let v_nx = mesh.add_vertex(DVec3::new(-radius, 0.0, 0.0));
        let v_n = mesh.add_vertex(DVec3::new(0.0, 0.0, radius));

        // f1: v_x → v_y → v_n (CCW from outside the sphere octant)
        // f2: v_y → v_nx → v_n (adjacent triangle sharing edge v_y → v_n)
        let f1 = mesh.add_face(&[v_x, v_y, v_n], mat).expect("f1");
        let f2 = mesh.add_face(&[v_y, v_nx, v_n], mat).expect("f2");

        let surface = AnalyticSurface::Sphere {
            center,
            radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.faces[f1].set_surface(Some(surface.clone()));
        mesh.faces[f2].set_surface(Some(surface));

        (mesh, vec![f1, f2])
    }

    #[test]
    fn sphere_smooth_group_offset_outward_increases_radius() {
        let (mut mesh, faces) = build_sphere_two_faces(2.0);

        // Offset outward by +1.0 → new radius = 3.0.
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("sphere offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        assert_eq!(result.all_solid_faces.len(), 2);

        for &fid in &faces {
            match mesh.faces[fid].surface() {
                Some(AnalyticSurface::Sphere { radius, center, .. }) => {
                    assert!(
                        (radius - 3.0).abs() < 1e-9,
                        "face {fid:?} radius != 3.0, got {radius}"
                    );
                    assert!(
                        (center - DVec3::ZERO).length() < 1e-9,
                        "center must remain at ZERO"
                    );
                }
                other => panic!(
                    "face {fid:?} must be Sphere, got {:?}",
                    other.map(|s| s.kind_label())
                ),
            }
        }
    }

    #[test]
    fn sphere_smooth_group_offset_scales_vertices_radially_about_center() {
        let (mut mesh, faces) = build_sphere_two_faces(2.0);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 3.0 }, // 2 → 5
                MaterialId::new(0),
            )
            .expect("offset OK");

        // After offset, every group vertex should be at distance 5 from origin.
        let mut group_verts = std::collections::HashSet::new();
        for &fid in &result.all_solid_faces {
            let start = mesh.faces[fid].outer().start;
            for v in mesh.collect_loop_verts(start).unwrap() {
                group_verts.insert(v);
            }
        }
        for v in &group_verts {
            let pos = mesh.vertex_pos(*v).unwrap();
            let r = pos.length();
            assert!(
                (r - 5.0).abs() < 1e-9,
                "vertex distance from center != 5.0: got {r}"
            );
        }
    }

    #[test]
    fn sphere_smooth_group_offset_inward_decreases_radius() {
        let (mut mesh, faces) = build_sphere_two_faces(5.0);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: -2.0 }, // 5 → 3
                MaterialId::new(0),
            )
            .expect("inward offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        for &fid in &faces {
            if let Some(AnalyticSurface::Sphere { radius, .. }) = mesh.faces[fid].surface() {
                assert!((radius - 3.0).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn sphere_smooth_group_offset_collapse_falls_back() {
        let (mut mesh, faces) = build_sphere_two_faces(2.0);
        // -2.0 → new_radius = 0 → collapse.
        let result = mesh.create_solid(
            faces[0],
            CreateSolidMode::Extrude { distance: -2.0 },
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail (collapse)");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("collapse"),
            "expected NotYetSupported with 'collapse' reason, got: {msg}"
        );
    }

    #[test]
    fn sphere_smooth_group_offset_returns_smooth_group_offset_kind() {
        let (mut mesh, faces) = build_sphere_two_faces(1.5);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        assert_eq!(result.top_face, result.profile_face);
        assert_eq!(result.side_faces.len(), 1); // 2 group faces - 1 profile
        assert_eq!(result.all_solid_faces.len(), 2);
    }

    #[test]
    fn sphere_smooth_group_offset_preserves_center() {
        // Sphere centered at non-origin must keep its center after offset.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let center = DVec3::new(10.0, 20.0, 30.0);
        let radius = 4.0;

        let v_a = mesh.add_vertex(center + DVec3::new(radius, 0.0, 0.0));
        let v_b = mesh.add_vertex(center + DVec3::new(0.0, radius, 0.0));
        let v_c = mesh.add_vertex(center + DVec3::new(0.0, 0.0, radius));
        let f1 = mesh.add_face(&[v_a, v_b, v_c], mat).expect("f1");

        // Need a 2nd face for a non-trivial group.
        let v_d = mesh.add_vertex(center + DVec3::new(-radius, 0.0, 0.0));
        let f2 = mesh.add_face(&[v_b, v_d, v_c], mat).expect("f2");

        let surface = AnalyticSurface::Sphere {
            center,
            radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        mesh.faces[f1].set_surface(Some(surface.clone()));
        mesh.faces[f2].set_surface(Some(surface));

        let _ = mesh
            .create_solid(
                f1,
                CreateSolidMode::Extrude { distance: 2.0 },
                mat,
            )
            .expect("offset OK");

        // Center must remain (10, 20, 30); radius now 6.
        if let Some(AnalyticSurface::Sphere { center: c, radius: r, .. }) =
            mesh.faces[f1].surface()
        {
            assert!((*c - center).length() < 1e-9, "center must be preserved");
            assert!((r - 6.0).abs() < 1e-9, "radius must be 6 (4 + 2)");
        } else {
            panic!("face surface must be Sphere");
        }

        // Verify each vertex distance from center = 6.
        let start = mesh.faces[f1].outer().start;
        for v in mesh.collect_loop_verts(start).unwrap() {
            let pos = mesh.vertex_pos(v).unwrap();
            let dist = (pos - center).length();
            assert!(
                (dist - 6.0).abs() < 1e-9,
                "vertex distance from center != 6: got {dist}"
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-γ-iii — Cone constant-offset (Option 3)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build 2 triangle faces on a cone with apex at origin,
    /// axis = +Z, opening toward +Z. half_angle controls the slope.
    /// Both triangles share an edge and the same Cone surface instance.
    fn build_cone_two_faces(
        half_angle: f64,
        v_min: f64,
        v_max: f64,
    ) -> (Mesh, Vec<FaceId>) {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let apex = DVec3::ZERO;
        let axis_dir = DVec3::Z;
        let ref_dir = DVec3::X;

        let tan_a = half_angle.tan();
        // 4 verts at u = 0, 90°, 180° on two latitude rings (v_min, v_max).
        // Triangles:
        //   f1: (u=0, v=v_min) → (u=90°, v=v_min) → (u=0, v=v_max)
        //   f2: (u=90°, v=v_min) → (u=180°, v=v_min) → (u=90°, v=v_max)
        // Each triangle shares verts with its neighbor.
        let p = |u: f64, v: f64| -> DVec3 {
            DVec3::new(v * tan_a * u.cos(), v * tan_a * u.sin(), v)
        };
        let v_a = mesh.add_vertex(p(0.0, v_min));
        let v_b = mesh.add_vertex(p(std::f64::consts::FRAC_PI_2, v_min));
        let v_c = mesh.add_vertex(p(std::f64::consts::PI, v_min));
        let v_top_0 = mesh.add_vertex(p(0.0, v_max));
        let v_top_90 = mesh.add_vertex(p(std::f64::consts::FRAC_PI_2, v_max));

        let f1 = mesh.add_face(&[v_a, v_b, v_top_90, v_top_0], mat).expect("f1");
        let f2 = mesh.add_face(&[v_b, v_c, v_top_90], mat).expect("f2");

        let surface = AnalyticSurface::Cone {
            apex,
            axis_dir,
            half_angle,
            ref_dir,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (v_min, v_max),
        };
        mesh.faces[f1].set_surface(Some(surface.clone()));
        mesh.faces[f2].set_surface(Some(surface));

        (mesh, vec![f1, f2])
    }

    #[test]
    fn cone_smooth_group_offset_preserves_half_angle_and_axis() {
        let half_angle = std::f64::consts::FRAC_PI_4; // 45°
        let (mut mesh, faces) = build_cone_two_faces(half_angle, 1.0, 5.0);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("cone offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);

        for &fid in &faces {
            match mesh.faces[fid].surface() {
                Some(AnalyticSurface::Cone {
                    half_angle: ha,
                    axis_dir: ad,
                    ref_dir: rd,
                    apex: a,
                    ..
                }) => {
                    // half_angle preserved.
                    assert!(
                        (ha - half_angle).abs() < 1e-9,
                        "half_angle must be preserved: got {ha}"
                    );
                    // axis_dir preserved.
                    assert!(
                        ad.normalize().dot(DVec3::Z).abs() > 0.9999,
                        "axis_dir must remain ‖ +Z"
                    );
                    // ref_dir preserved.
                    assert!(
                        rd.normalize().dot(DVec3::X).abs() > 0.9999,
                        "ref_dir must remain ‖ +X"
                    );
                    // apex shift = -dist/sin(α) * axis_dir = -0.5/sin(45°) * Z.
                    let expected_shift = -0.5 / half_angle.sin();
                    assert!(
                        ((a.z) - expected_shift).abs() < 1e-9,
                        "apex.z must = {expected_shift:.6}, got {}",
                        a.z
                    );
                }
                other => panic!(
                    "face {fid:?} must remain Cone, got {:?}",
                    other.map(|s| s.kind_label())
                ),
            }
        }
    }

    #[test]
    fn cone_smooth_group_offset_apex_translates_along_minus_axis() {
        // half_angle = 30° → sin = 0.5 → apex shifts by -2.0 * dist along +Z.
        let half_angle = std::f64::consts::FRAC_PI_6;
        let (mut mesh, faces) = build_cone_two_faces(half_angle, 1.0, 4.0);
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // dist = 1, sin(30°) = 0.5 → apex_shift = -2.0 along +Z.
        if let Some(AnalyticSurface::Cone { apex, .. }) = mesh.faces[faces[0]].surface() {
            assert!(
                (apex.z - (-2.0)).abs() < 1e-9,
                "apex.z must = -2.0, got {}",
                apex.z
            );
            assert!(
                apex.x.abs() < 1e-9 && apex.y.abs() < 1e-9,
                "apex x/y must remain 0"
            );
        } else {
            panic!("face surface must be Cone");
        }
    }

    #[test]
    fn cone_smooth_group_offset_vertex_moves_along_normal_by_dist() {
        // Vertex at (v*tan(α), 0, v) on cone with α=45°, v=2 → (2, 0, 2).
        // After dist=√2 outward offset, expected new pos: (2,0,2) + √2 * normal.
        // normal at u=0, v=2 (α=45°): (cos(45°)*1, 0, -sin(45°)) = (√2/2, 0, -√2/2).
        // P_new = (2 + √2 * √2/2, 0, 2 - √2 * √2/2) = (2 + 1, 0, 2 - 1) = (3, 0, 1).
        let half_angle = std::f64::consts::FRAC_PI_4;
        let (mut mesh, faces) = build_cone_two_faces(half_angle, 2.0, 4.0);
        let dist = 2.0_f64.sqrt();
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: dist },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // Find the vertex that was originally at (2, 0, 2): u=0, v=2.
        // After offset, expected position: (3, 0, 1).
        let expected_new = DVec3::new(3.0, 0.0, 1.0);
        let mut found = false;
        for &fid in &faces {
            let start = mesh.faces[fid].outer().start;
            for v in mesh.collect_loop_verts(start).unwrap() {
                let pos = mesh.vertex_pos(v).unwrap();
                if (pos - expected_new).length() < 1e-6 {
                    found = true;
                    break;
                }
            }
        }
        assert!(
            found,
            "must find vertex at expected post-offset position (3, 0, 1)"
        );
    }

    #[test]
    fn cone_smooth_group_offset_inward_decreases_radius_at_each_v() {
        let half_angle = std::f64::consts::FRAC_PI_4;
        let (mut mesh, faces) = build_cone_two_faces(half_angle, 2.0, 5.0);
        // Inward offset: dist = -1.
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: -1.0 },
                MaterialId::new(0),
            )
            .expect("inward offset OK");

        // Expected: half_angle preserved, apex_z = +1/sin(45°) = +√2,
        // v_range_new = (2 + (-1)*cos²/sin, 5 + same) = (2 - √2/2 ... )
        // Easier: just check Cone surface attached and half_angle preserved.
        if let Some(AnalyticSurface::Cone { half_angle: ha, .. }) =
            mesh.faces[faces[0]].surface()
        {
            assert!((ha - half_angle).abs() < 1e-9);
        } else {
            panic!("face surface must remain Cone");
        }
    }

    #[test]
    fn cone_smooth_group_offset_collapse_falls_back() {
        let half_angle = std::f64::consts::FRAC_PI_4;
        let (mut mesh, faces) = build_cone_two_faces(half_angle, 1.0, 3.0);
        // dist = -2 → v_min becomes 1 + (-2)*cos²(45°)/sin(45°) = 1 - √2 < 0.
        let result = mesh.create_solid(
            faces[0],
            CreateSolidMode::Extrude { distance: -2.0 },
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail (collapse)");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("collapse"),
            "expected NotYetSupported with 'collapse' reason, got: {msg}"
        );
    }

    #[test]
    fn cone_smooth_group_offset_singular_half_angle_rejected() {
        // half_angle ≈ 0 → singular cone → NotYetSupported.
        let (mut mesh, faces) = build_cone_two_faces(1e-8, 1.0, 2.0);
        let result = mesh.create_solid(
            faces[0],
            CreateSolidMode::Extrude { distance: 0.5 },
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("singular"),
            "expected singular rejection, got: {msg}"
        );
    }

    #[test]
    fn cone_smooth_group_offset_returns_smooth_group_offset_kind() {
        let (mut mesh, faces) = build_cone_two_faces(std::f64::consts::FRAC_PI_4, 1.0, 3.0);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");
        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        assert_eq!(result.top_face, result.profile_face);
        assert_eq!(result.side_faces.len(), 1);
        assert_eq!(result.all_solid_faces.len(), 2);
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-2-γ-iv — Torus constant-offset (= minor_radius offset)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build 2 triangle faces on a torus with center origin,
    /// axis = +Z, ref = +X. Both share the same Torus surface instance.
    /// Vertices placed at known (u, v) parameter positions.
    fn build_torus_two_faces(
        major: f64,
        minor: f64,
    ) -> (Mesh, Vec<FaceId>) {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let center = DVec3::ZERO;
        let axis_dir = DVec3::Z;
        let ref_dir = DVec3::X;
        let bi = axis_dir.cross(ref_dir); // Y

        // Parametric position on torus.
        let p = |u: f64, v: f64| -> DVec3 {
            let radial = u.cos() * ref_dir + u.sin() * bi;
            center + major * radial + minor * (v.cos() * radial + v.sin() * axis_dir)
        };

        // 5 verts at (u, v) ∈ {(0, 0), (90°, 0), (180°, 0), (0, 90°), (90°, 90°)}.
        let v_a = mesh.add_vertex(p(0.0, 0.0));
        let v_b = mesh.add_vertex(p(std::f64::consts::FRAC_PI_2, 0.0));
        let v_c = mesh.add_vertex(p(std::f64::consts::PI, 0.0));
        let v_top_a = mesh.add_vertex(p(0.0, std::f64::consts::FRAC_PI_2));
        let v_top_b = mesh.add_vertex(p(std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2));

        // Two faces sharing edge v_b → v_top_b:
        //   f1: v_a → v_b → v_top_b → v_top_a
        //   f2: v_b → v_c → v_top_b
        let f1 = mesh
            .add_face(&[v_a, v_b, v_top_b, v_top_a], mat)
            .expect("f1");
        let f2 = mesh.add_face(&[v_b, v_c, v_top_b], mat).expect("f2");

        let surface = AnalyticSurface::Torus {
            center,
            axis_dir,
            ref_dir,
            major_radius: major,
            minor_radius: minor,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, std::f64::consts::TAU),
        };
        mesh.faces[f1].set_surface(Some(surface.clone()));
        mesh.faces[f2].set_surface(Some(surface));

        (mesh, vec![f1, f2])
    }

    #[test]
    fn torus_smooth_group_offset_increases_minor_radius() {
        let (mut mesh, faces) = build_torus_two_faces(5.0, 1.0);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("torus offset OK");

        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        for &fid in &faces {
            match mesh.faces[fid].surface() {
                Some(AnalyticSurface::Torus {
                    minor_radius,
                    major_radius,
                    center: c,
                    ..
                }) => {
                    assert!(
                        (minor_radius - 1.5).abs() < 1e-9,
                        "minor radius != 1.5: got {minor_radius}"
                    );
                    // major / center UNCHANGED.
                    assert!((major_radius - 5.0).abs() < 1e-9);
                    assert!((c - DVec3::ZERO).length() < 1e-9);
                }
                other => panic!(
                    "face {fid:?} must remain Torus, got {:?}",
                    other.map(|s| s.kind_label())
                ),
            }
        }
    }

    #[test]
    fn torus_smooth_group_offset_vertex_distance_to_major_circle_changes() {
        // After offset, every vertex's distance to its major-circle point
        // should equal new_minor (5 → 5 + dist).
        let major = 4.0;
        let minor_old = 1.0;
        let dist = 0.5;
        let (mut mesh, faces) = build_torus_two_faces(major, minor_old);
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: dist },
                MaterialId::new(0),
            )
            .expect("offset OK");

        let mut group_verts = std::collections::HashSet::new();
        for &fid in &faces {
            let start = mesh.faces[fid].outer().start;
            for v in mesh.collect_loop_verts(start).unwrap() {
                group_verts.insert(v);
            }
        }
        let expected_minor = minor_old + dist;
        for v in &group_verts {
            let pos = mesh.vertex_pos(*v).unwrap();
            // Compute major-circle point: project pos onto Z=0 plane,
            // normalize, scale by major.
            let pos_xy = DVec3::new(pos.x, pos.y, 0.0);
            if pos_xy.length() < 1e-9 {
                continue; // skip on-axis (shouldn't happen here)
            }
            let major_pt = pos_xy.normalize() * major;
            let dist_to_major = (pos - major_pt).length();
            assert!(
                (dist_to_major - expected_minor).abs() < 1e-6,
                "vertex distance to major circle != {expected_minor}: got {dist_to_major}"
            );
        }
    }

    #[test]
    fn torus_smooth_group_offset_preserves_major_radius_and_axis() {
        let (mut mesh, faces) = build_torus_two_faces(7.0, 2.0);
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: -0.5 },
                MaterialId::new(0),
            )
            .expect("inward OK");

        if let Some(AnalyticSurface::Torus {
            major_radius,
            minor_radius,
            axis_dir,
            ref_dir,
            center: c,
            ..
        }) = mesh.faces[faces[0]].surface()
        {
            assert!((major_radius - 7.0).abs() < 1e-9, "major must be preserved");
            assert!((minor_radius - 1.5).abs() < 1e-9, "minor = 2 - 0.5 = 1.5");
            assert!(axis_dir.normalize().dot(DVec3::Z).abs() > 0.9999);
            assert!(ref_dir.normalize().dot(DVec3::X).abs() > 0.9999);
            assert!((c - DVec3::ZERO).length() < 1e-9);
        } else {
            panic!("face surface must remain Torus");
        }
    }

    #[test]
    fn torus_smooth_group_offset_collapse_falls_back() {
        let (mut mesh, faces) = build_torus_two_faces(5.0, 1.0);
        // -1.0 → minor_new = 0 → collapse.
        let result = mesh.create_solid(
            faces[0],
            CreateSolidMode::Extrude { distance: -1.0 },
            MaterialId::new(0),
        );
        let err = result.err().expect("must fail (collapse)");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("collapse"),
            "expected NotYetSupported with 'collapse' reason, got: {msg}"
        );
    }

    #[test]
    fn torus_smooth_group_offset_returns_smooth_group_offset_kind() {
        let (mut mesh, faces) = build_torus_two_faces(3.0, 0.5);
        let result = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.2 },
                MaterialId::new(0),
            )
            .expect("offset OK");
        assert_eq!(result.solid_kind, SolidKind::SmoothGroupOffset);
        assert_eq!(result.top_face, result.profile_face);
        assert_eq!(result.side_faces.len(), 1);
        assert_eq!(result.all_solid_faces.len(), 2);
    }

    #[test]
    fn torus_smooth_group_offset_updates_outer_latitude_circle() {
        // Attach an outer-latitude full circle (v=0): center = torus_center,
        // radius = major + minor, normal = axis_dir.
        // After offset by d=0.5: new_radius = (major + minor) + 0.5*cos(0)
        // = (major + minor) + 0.5. center unchanged (sin(0) = 0).
        use crate::curves::AnalyticCurve;
        let major = 5.0;
        let minor = 1.0;
        let (mut mesh, faces) = build_torus_two_faces(major, minor);
        let edges = mesh.face_outer_edges(faces[0]).expect("edges");
        let circ_eid = edges[0];

        // Construct outer latitude circle (v=0).
        let circ = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: major + minor, // = 6
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        mesh.edges[circ_eid].set_curve(Some(circ));

        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        if let Some(AnalyticCurve::Circle {
            radius: nr,
            center: nc,
            ..
        }) = mesh.edges.get(circ_eid).and_then(|e| e.curve())
        {
            // sin(v=0) = 0 → center axial unchanged
            // cos(v=0) = 1 → new_radius = 6 + 0.5*1 = 6.5
            assert!(
                (nr - 6.5).abs() < 1e-9,
                "outer latitude new radius != 6.5: got {nr}"
            );
            assert!(
                (nc - DVec3::ZERO).length() < 1e-9,
                "outer latitude center must remain at origin (sin(0) = 0)"
            );
        } else {
            panic!("edge curve must remain Circle after offset");
        }
    }

    #[test]
    fn torus_smooth_group_offset_updates_top_latitude_circle() {
        // Top latitude (v=π/2): center = torus_center + minor·axis,
        // radius = major (since cos(π/2) = 0).
        // After offset by d=0.5: new sin(v)=1, cos(v)=0
        //   new_axial = old_axial + d*sin(v) = minor + 0.5
        //   new_radius = old_radius + d*cos(v) = major (unchanged)
        use crate::curves::AnalyticCurve;
        let major = 4.0;
        let minor = 1.0;
        let (mut mesh, faces) = build_torus_two_faces(major, minor);
        let edges = mesh.face_outer_edges(faces[0]).expect("edges");
        let circ_eid = edges[0];

        let circ = AnalyticCurve::Circle {
            center: DVec3::new(0.0, 0.0, minor), // = (0, 0, 1)
            radius: major,                       // = 4
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        mesh.edges[circ_eid].set_curve(Some(circ));

        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 0.5 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        if let Some(AnalyticCurve::Circle {
            radius: nr,
            center: nc,
            ..
        }) = mesh.edges.get(circ_eid).and_then(|e| e.curve())
        {
            assert!(
                (nr - 4.0).abs() < 1e-9,
                "top latitude radius must remain 4.0 (cos(π/2)=0): got {nr}"
            );
            assert!(
                (nc.z - 1.5).abs() < 1e-9,
                "top latitude axial must be 1 + 0.5*1 = 1.5: got {}",
                nc.z
            );
        } else {
            panic!("edge curve must remain Circle");
        }
    }

    #[test]
    fn sphere_smooth_group_offset_scales_boundary_arcs_about_center() {
        // Attach an Arc curve to one boundary edge and verify it's scaled
        // uniformly about the sphere center (not just radius scaled in
        // place — center also moves under uniform scale).
        use crate::curves::AnalyticCurve;
        let (mut mesh, faces) = build_sphere_two_faces(2.0);
        let edges = mesh.face_outer_edges(faces[0]).expect("edges");
        let arc_eid = edges[0];

        // Attach a small Arc with its own (off-center) parameters.
        let arc_center = DVec3::new(1.0, 0.0, 0.0);
        let arc_radius = 0.5;
        let initial_arc = AnalyticCurve::Arc {
            center: arc_center,
            radius: arc_radius,
            normal: DVec3::Y,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        mesh.edges[arc_eid].set_curve(Some(initial_arc));

        // Offset by +1 → scale = 3/2 = 1.5.
        let _ = mesh
            .create_solid(
                faces[0],
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("offset OK");

        // Expected:
        //   new_center = ZERO + (arc_center - ZERO) * 1.5 = (1.5, 0, 0)
        //   new_radius = 0.5 * 1.5 = 0.75
        if let Some(AnalyticCurve::Arc {
            center: nc,
            radius: nr,
            ..
        }) = mesh.edges.get(arc_eid).and_then(|e| e.curve())
        {
            assert!((nc - DVec3::new(1.5, 0.0, 0.0)).length() < 1e-9,
                "arc center expected (1.5, 0, 0), got {nc:?}");
            assert!((nr - 0.75).abs() < 1e-9,
                "arc radius expected 0.75, got {nr}");
        } else {
            panic!("arc curve must remain on edge after offset");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-4-α — Revolve mode dispatch (full 360° only)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build a triangular profile face in the xy plane (so its
    /// face normal is +Z), with vertices that lie on the +X half-plane
    /// (one vertex on +Y axis, one off). Suitable for revolve around the
    /// y-axis to create a vase/cone-like solid.
    fn build_revolve_profile_face(mesh: &mut Mesh) -> FaceId {
        let mat = MaterialId::new(0);
        // Triangle in xy plane: (1, 0, 0), (2, 0, 0), (1, 1, 0).
        // Revolved around +Y axis would produce an annular cone.
        let v0 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2], mat).expect("add_face");
        // Plane surface: xy plane (normal +Z).
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 2.0),
            v_range: (0.0, 1.0),
        }));
        face
    }

    #[test]
    fn revolve_mode_full_360_returns_revolution_solid() {
        let mut mesh = Mesh::new();
        let profile = build_revolve_profile_face(&mut mesh);
        let face_count_before = mesh.face_count();

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Revolve {
                    axis_origin: DVec3::ZERO,
                    axis_dir: DVec3::Y, // y-axis (lies in xy plane)
                    angle_rad: std::f64::consts::TAU,
                },
                MaterialId::new(0),
            )
            .expect("revolve full 360 OK");

        assert_eq!(result.solid_kind, SolidKind::RevolutionSolid);
        assert_eq!(result.profile_face, profile);
        // top_face = profile_face sentinel.
        assert_eq!(result.top_face, profile);
        // Mesh::revolve generates 32 segments × (n_profile - 1) side faces
        // for a triangle with no poles (3 verts, 2 edges → 2 strips).
        // Profile (1,0,0), (2,0,0), (1,1,0): no point on +Y axis, so all
        // edges produce ring-of-quads (32 quads each).
        // Specifically: 3 edges × 32 segments = 96 side faces (closed loop).
        assert!(
            result.side_faces.len() > 0,
            "revolve must produce side faces"
        );
        // mesh.face_count() should grow by at least the side face count.
        assert!(mesh.face_count() > face_count_before);
    }

    #[test]
    fn revolve_mode_axis_zero_rejected() {
        let mut mesh = Mesh::new();
        let profile = build_revolve_profile_face(&mut mesh);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::ZERO, // zero axis
                angle_rad: std::f64::consts::TAU,
            },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject zero axis");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("near-zero"),
            "expected near-zero axis rejection, got: {msg}"
        );
    }

    #[test]
    fn revolve_mode_profile_face_not_in_plane_with_axis_rejected() {
        // Profile face on z=0 (normal +Z), axis on +Z (parallel to normal).
        // face_normal · axis_dir = +Z · +Z = 1 (not perpendicular).
        let mut mesh = Mesh::new();
        let profile = build_revolve_profile_face(&mut mesh);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Z, // parallel to face normal — invalid
                angle_rad: std::f64::consts::TAU,
            },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject non-perpendicular axis");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("not contain axis"),
            "expected plane-axis perpendicularity rejection, got: {msg}"
        );
    }

    #[test]
    fn revolve_mode_multi_loop_face_rejected() {
        // Frame face with hole — multi-loop should reject.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let outer = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0)),
        ];
        let inner = [
            mesh.add_vertex(DVec3::new(3.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 7.0, 0.0)),
            mesh.add_vertex(DVec3::new(3.0, 7.0, 0.0)),
        ];
        let face = mesh
            .add_face_with_holes(&outer, &[&inner], mat)
            .expect("frame face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));

        let result = mesh.create_solid(
            face,
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::TAU,
            },
            mat,
        );
        let err = result.err().expect("must reject multi-loop");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("multi-loop"),
            "expected multi-loop rejection, got: {msg}"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-3-α — Sweep mode dispatch
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build a unit-square profile face on z=0 with normal +Z,
    /// suitable for sweep along a path along +Z.
    fn build_z_normal_profile_face(mesh: &mut Mesh) -> FaceId {
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], mat).expect("add_face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        face
    }

    #[test]
    fn sweep_mode_along_straight_z_path_returns_swept_solid() {
        // Profile on z=0 (normal +Z), path Line from (0,0,0) → (0,0,5)
        // (along +Z, tangent matches profile normal).
        let mut mesh = Mesh::new();
        let profile = build_z_normal_profile_face(&mut mesh);
        // Add path Line vertices.
        let pa = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let pb = mesh.add_vertex(DVec3::new(0.0, 0.0, 5.0));
        let path_curve = AnalyticCurve::Line { start: pa, end: pb };

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Sweep { path: path_curve },
                MaterialId::new(0),
            )
            .expect("sweep along Z OK");

        assert_eq!(result.solid_kind, SolidKind::SweptSolid);
        assert_eq!(result.profile_face, profile);
        assert!(
            result.side_faces.len() >= 4,
            "swept tube must have ≥ 4 side faces (one per profile edge)"
        );
    }

    #[test]
    fn sweep_mode_path_tangent_misaligned_with_profile_normal_rejected() {
        // Profile normal = +Z, path tangent = +X (perpendicular). Reject.
        let mut mesh = Mesh::new();
        let profile = build_z_normal_profile_face(&mut mesh);
        let pa = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let pb = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let path_curve = AnalyticCurve::Line { start: pa, end: pb };

        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Sweep { path: path_curve },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject misaligned path");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("tangent"),
            "expected tangent misalignment rejection, got: {msg}"
        );
    }

    #[test]
    fn sweep_mode_multi_loop_face_rejected() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let outer = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0)),
        ];
        let inner = [
            mesh.add_vertex(DVec3::new(3.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 7.0, 0.0)),
            mesh.add_vertex(DVec3::new(3.0, 7.0, 0.0)),
        ];
        let face = mesh
            .add_face_with_holes(&outer, &[&inner], mat)
            .expect("frame face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));
        let pa = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let pb = mesh.add_vertex(DVec3::new(0.0, 0.0, 5.0));
        let path_curve = AnalyticCurve::Line { start: pa, end: pb };

        let result = mesh.create_solid(
            face,
            CreateSolidMode::Sweep { path: path_curve },
            mat,
        );
        let err = result.err().expect("must reject multi-loop");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("multi-loop"),
            "expected multi-loop rejection, got: {msg}"
        );
    }

    #[test]
    fn sweep_mode_circular_path_arc_succeeds() {
        // Arc path on xy plane: small quarter-circle.
        // Profile must align with path's start tangent.
        let mut mesh = Mesh::new();
        // Path arc center at origin, radius 5, in xy plane.
        // At θ=0, point = (5, 0, 0), tangent = (0, 5, 0) normalized = +Y.
        // Profile must have normal = +Y.
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let profile = mesh.add_face(&[v0, v1, v2, v3], mat).expect("profile");
        mesh.faces[profile].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::new(5.0, 0.0, 0.0), // path start point
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));

        let path_curve = AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Sweep { path: path_curve },
                mat,
            )
            .expect("arc path sweep OK");
        assert_eq!(result.solid_kind, SolidKind::SweptSolid);
        assert!(
            result.side_faces.len() >= 4,
            "arc sweep must produce side faces"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-3-δ — Extrude on NURBS-class profile (tessellation-based)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build a quad face whose surface is a synthetic flat
    /// BezierPatch (linear 2×2 control grid) — equivalent to a plane in
    /// shape, but classified as NURBS-class for dispatch purposes.
    fn build_bezier_patch_quad_face(mesh: &mut Mesh) -> FaceId {
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).expect("add_face");
        // Flat BezierPatch (2×2 = bilinear). Normal at (0.5, 0.5) = +Z.
        mesh.faces[face].set_surface(Some(AnalyticSurface::BezierPatch {
            ctrl_grid: vec![
                vec![DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0)],
                vec![DVec3::new(0.0, 1.0, 0.0), DVec3::new(1.0, 1.0, 0.0)],
            ],
        }));
        face
    }

    #[test]
    fn extrude_on_bezier_patch_returns_general_sweep() {
        let mut mesh = Mesh::new();
        let profile = build_bezier_patch_quad_face(&mut mesh);
        let face_count_before = mesh.face_count();

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 1.0 },
                MaterialId::new(0),
            )
            .expect("BezierPatch profile extrude OK (W-3-δ)");

        assert_eq!(result.solid_kind, SolidKind::GeneralSweep);
        assert_eq!(result.profile_face, profile);
        assert_eq!(result.side_faces.len(), 4);
        // profile + top + 4 sides = 6.
        assert_eq!(result.all_solid_faces.len(), 6);
        assert_eq!(mesh.face_count(), face_count_before + 5);
    }

    /// Helper — 3×3 degree-2 BSpline/NURBS control grid (linear-equivalent
    /// surface in xy plane). Required because deg-1 bspline_surface gives
    /// degenerate derivative at parametric center.
    fn make_3x3_xy_grid() -> Vec<Vec<DVec3>> {
        vec![
            vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(0.5, 0.0, 0.0),
                DVec3::new(1.0, 0.0, 0.0),
            ],
            vec![
                DVec3::new(0.0, 0.5, 0.0),
                DVec3::new(0.5, 0.5, 0.0),
                DVec3::new(1.0, 0.5, 0.0),
            ],
            vec![
                DVec3::new(0.0, 1.0, 0.0),
                DVec3::new(0.5, 1.0, 0.0),
                DVec3::new(1.0, 1.0, 0.0),
            ],
        ]
    }

    #[test]
    fn extrude_on_bspline_surface_returns_general_sweep() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).expect("face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::BSplineSurface {
            ctrl_grid: make_3x3_xy_grid(),
            knots_u: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            deg_u: 2,
            deg_v: 2,
        }));

        let result = mesh
            .create_solid(
                face,
                CreateSolidMode::Extrude { distance: 1.0 },
                mat,
            )
            .expect("BSplineSurface profile extrude OK");
        assert_eq!(result.solid_kind, SolidKind::GeneralSweep);
        assert_eq!(result.side_faces.len(), 4);
    }

    #[test]
    fn extrude_on_nurbs_surface_returns_general_sweep() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).expect("face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::NURBSSurface {
            ctrl_grid: make_3x3_xy_grid(),
            weights: vec![
                vec![1.0, 1.0, 1.0],
                vec![1.0, 1.0, 1.0],
                vec![1.0, 1.0, 1.0],
            ],
            knots_u: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            deg_u: 2,
            deg_v: 2,
            trim_loops: vec![],
        }));

        let result = mesh
            .create_solid(
                face,
                CreateSolidMode::Extrude { distance: 1.0 },
                mat,
            )
            .expect("NURBSSurface profile extrude OK");
        assert_eq!(result.solid_kind, SolidKind::GeneralSweep);
        assert_eq!(result.side_faces.len(), 4);
    }

    #[test]
    fn extrude_on_nurbs_class_top_face_synthesized_as_plane() {
        // W-3-δ approximation: top face surface is Plane (synthesized
        // from translated vertex positions), not the original NURBS surface.
        let mut mesh = Mesh::new();
        let profile = build_bezier_patch_quad_face(&mut mesh);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 2.0 },
                MaterialId::new(0),
            )
            .expect("OK");
        let top_surface = mesh.faces[result.top_face].surface();
        assert!(
            matches!(top_surface, Some(AnalyticSurface::Plane { .. })),
            "W-3-δ approximation: top face synthesized as Plane, not NURBS"
        );
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-079 W-3-β — Loft mode dispatch (two profiles)
    // ════════════════════════════════════════════════════════════════════

    /// Helper — build two square profile faces stacked in z (z=0 and z=2),
    /// suitable for loft.
    fn build_two_square_profiles(mesh: &mut Mesh) -> (FaceId, FaceId) {
        let mat = MaterialId::new(0);
        // Bottom square at z=0 (4 verts CCW from above).
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let bottom = mesh.add_face(&[v00, v10, v11, v01], mat).expect("bottom");
        mesh.faces[bottom].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        // Top square at z=2 (slightly larger).
        let w00 = mesh.add_vertex(DVec3::new(-0.5, -0.5, 2.0));
        let w10 = mesh.add_vertex(DVec3::new(1.5, -0.5, 2.0));
        let w11 = mesh.add_vertex(DVec3::new(1.5, 1.5, 2.0));
        let w01 = mesh.add_vertex(DVec3::new(-0.5, 1.5, 2.0));
        let top = mesh.add_face(&[w00, w10, w11, w01], mat).expect("top");
        mesh.faces[top].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 2.0),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-0.5, 1.5),
            v_range: (-0.5, 1.5),
        }));
        (bottom, top)
    }

    #[test]
    fn loft_mode_two_squares_returns_loft_solid() {
        let mut mesh = Mesh::new();
        let (bottom, top) = build_two_square_profiles(&mut mesh);

        let result = mesh
            .create_solid(
                bottom,
                CreateSolidMode::Loft { other_profile: top },
                MaterialId::new(0),
            )
            .expect("loft 2 squares OK");

        assert_eq!(result.solid_kind, SolidKind::LoftSolid);
        assert_eq!(result.profile_face, bottom);
        assert_eq!(result.top_face, top);
        // Loft of two 4-vertex squares: 4 ruled bands.
        assert_eq!(
            result.side_faces.len(),
            4,
            "loft 4-square to 4-square must produce 4 ruled side faces"
        );
        // all_solid_faces = bottom + top + 4 sides = 6.
        assert_eq!(result.all_solid_faces.len(), 6);
    }

    #[test]
    fn loft_mode_same_profile_id_rejected() {
        let mut mesh = Mesh::new();
        let (bottom, _top) = build_two_square_profiles(&mut mesh);

        let result = mesh.create_solid(
            bottom,
            CreateSolidMode::Loft {
                other_profile: bottom, // same as profile_face
            },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject same profile");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("same FaceId"),
            "expected same-FaceId rejection, got: {msg}"
        );
    }

    #[test]
    fn loft_mode_vertex_count_mismatch_rejected() {
        // Bottom: 4-vertex square. Top: 3-vertex triangle. Mismatch.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let bottom = mesh.add_face(&[v00, v10, v11, v01], mat).expect("bottom");
        mesh.faces[bottom].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        let w0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 2.0));
        let w1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 2.0));
        let w2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 2.0));
        let top = mesh.add_face(&[w0, w1, w2], mat).expect("top");
        mesh.faces[top].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 2.0),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));

        let result = mesh.create_solid(
            bottom,
            CreateSolidMode::Loft { other_profile: top },
            mat,
        );
        let err = result.err().expect("must reject vertex count mismatch");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("vertex count mismatch"),
            "expected vertex-count-mismatch rejection, got: {msg}"
        );
    }

    #[test]
    fn loft_mode_first_profile_multi_loop_rejected() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Frame face (multi-loop) as first profile.
        let outer = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0)),
        ];
        let inner = [
            mesh.add_vertex(DVec3::new(3.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 3.0, 0.0)),
            mesh.add_vertex(DVec3::new(7.0, 7.0, 0.0)),
            mesh.add_vertex(DVec3::new(3.0, 7.0, 0.0)),
        ];
        let frame = mesh
            .add_face_with_holes(&outer, &[&inner], mat)
            .expect("frame face");
        mesh.faces[frame].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));
        // Plain top square (4 verts).
        let w00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 5.0));
        let w10 = mesh.add_vertex(DVec3::new(10.0, 0.0, 5.0));
        let w11 = mesh.add_vertex(DVec3::new(10.0, 10.0, 5.0));
        let w01 = mesh.add_vertex(DVec3::new(0.0, 10.0, 5.0));
        let top = mesh.add_face(&[w00, w10, w11, w01], mat).expect("top");
        mesh.faces[top].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 5.0),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));

        let result = mesh.create_solid(
            frame,
            CreateSolidMode::Loft { other_profile: top },
            mat,
        );
        let err = result.err().expect("must reject multi-loop");
        let msg = format!("{}", err);
        assert!(
            msg.contains("not yet supported") && msg.contains("multi-loop"),
            "expected multi-loop rejection, got: {msg}"
        );
    }

    #[test]
    fn loft_mode_invalid_face_id_rejected() {
        let mut mesh = Mesh::new();
        let (bottom, _top) = build_two_square_profiles(&mut mesh);

        let result = mesh.create_solid(
            bottom,
            CreateSolidMode::Loft {
                other_profile: FaceId::new(999),
            },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject missing face");
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("FaceNotFound") || msg.contains("face not found"),
            "expected FaceNotFound, got: {msg}"
        );
    }

    #[test]
    fn sweep_mode_invalid_face_id_rejected() {
        let mut mesh = Mesh::new();
        let pa = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let pb = mesh.add_vertex(DVec3::new(0.0, 0.0, 5.0));
        let path_curve = AnalyticCurve::Line { start: pa, end: pb };

        let result = mesh.create_solid(
            FaceId::new(999),
            CreateSolidMode::Sweep { path: path_curve },
            MaterialId::new(0),
        );
        let err = result.err().expect("must reject missing face");
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("FaceNotFound") || msg.contains("face not found"),
            "expected FaceNotFound, got: {msg}"
        );
    }

    #[test]
    fn revolve_mode_invalid_face_id_rejected() {
        let mut mesh = Mesh::new();
        // No face exists; arbitrary FaceId.
        let result = mesh.create_solid(
            FaceId::new(999),
            CreateSolidMode::Revolve {
                axis_origin: DVec3::ZERO,
                axis_dir: DVec3::Y,
                angle_rad: std::f64::consts::TAU,
            },
            MaterialId::new(0),
        );
        // create_solid 의 사전 검사 (faces.contains) 에서 FaceNotFound 발생.
        let err = result.err().expect("must reject missing face");
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("FaceNotFound") || msg.contains("face not found"),
            "expected FaceNotFound, got: {msg}"
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-θ-β: closed-curve face Push-Pull (Path A tessellate)
    // ────────────────────────────────────────────────────────────────────

    /// Build a canonical closed-curve face: 1 anchor + 1 self-loop edge
    /// with Circle curve attached + Plane surface attach (A-η-1).
    fn build_closed_curve_circle_face(
        mesh: &mut Mesh,
        center: DVec3,
        radius: f64,
    ) -> FaceId {
        let anchor_pos = center + DVec3::X * radius; // θ=0
        let anchor = mesh.add_vertex(anchor_pos);
        let circle = AnalyticCurve::Circle {
            center,
            radius,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        mesh.add_face_closed_curve(anchor, circle, MaterialId::new(0))
            .expect("add_face_closed_curve")
    }

    #[test]
    fn adr089_a_theta_closed_curve_face_extrudes_to_cylinder() {
        // Closed-curve face (1 anchor + 1 self-loop edge) must extrude
        // via Path A tessellate fast-path → Cylinder solid result.
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 5.0);
        let face_count_before = mesh.face_count();

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 10.0 },
                MaterialId::new(0),
            )
            .expect("ADR-089 A-θ-β: closed-curve Push-Pull must succeed");

        assert_eq!(
            result.solid_kind,
            SolidKind::Cylinder,
            "ADR-089 A-θ-β: result must be Cylinder"
        );
        // Tessellation produces N >= 8 segments. side_faces.len() >= 8.
        assert!(
            result.side_faces.len() >= 8,
            "tessellation must produce ≥ 8 side faces, got {}",
            result.side_faces.len()
        );
        // Original closed-curve face was removed; substituted polygonal
        // face + top + N sides added. face_count_before was 1 (closed
        // curve face); after: 1 substituted + 1 top + N sides.
        assert!(mesh.face_count() > face_count_before);

        // Invariants pass.
        let report = mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "ADR-089 A-θ-β: invariants must pass, violations: {:?}",
            report.violations
        );
    }

    #[test]
    fn adr089_a_theta_closed_curve_negative_distance_recess() {
        // dist < 0 (recess) must also work via Path A.
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 2.0);

        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: -3.0 },
                MaterialId::new(0),
            )
            .expect("recess must succeed");

        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        assert!(result.side_faces.len() >= 8);
    }

    #[test]
    fn adr089_a_theta_closed_curve_attaches_cylinder_surface_to_sides() {
        // Side walls of resulting cylinder must carry AnalyticSurface::
        // Cylinder (so subsequent ops — Boolean / Offset — see kernel).
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 4.0);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 6.0 },
                MaterialId::new(0),
            )
            .expect("create_solid OK");

        for &side in &result.side_faces {
            let surface = mesh.faces[side].surface();
            assert!(
                matches!(surface, Some(AnalyticSurface::Cylinder { .. })),
                "ADR-089 A-θ-β: side wall must have Cylinder surface, got {:?}",
                surface.map(|s| s.kind_label())
            );
        }
    }

    #[test]
    fn adr089_a_theta_polygonal_circle_unaffected_by_fast_path() {
        // Regression guard — polygonal circle (≥ 3 verts, Arc curves) must
        // continue using the existing extrude_planar_cylinder path, not
        // the new closed-curve fast-path.
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 5.0, 16);
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 7.0 },
                MaterialId::new(0),
            )
            .expect("polygonal circle path unchanged");
        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        // Polygonal path: profile_face IS the original (not removed).
        assert_eq!(result.profile_face, profile);
        assert_eq!(result.side_faces.len(), 16);
    }

    #[test]
    fn adr089_a_upsilon_self_loop_edge_cleanup_after_extrude() {
        // After A-θ-β extrude_closed_curve_face_via_tessellation, the
        // original closed-curve self-loop edge must be deactivated so
        // the wireframe export does not emit overlapping polylines on
        // the new bottom polygon.
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 5.0);
        // Capture original self-loop edge id BEFORE extrude.
        let outer_start = mesh.faces[profile].outer().start;
        let original_edge = mesh.hes[outer_start].edge();
        assert!(mesh.edges[original_edge].is_self_loop(),
            "pre-condition: original edge must be self-loop");
        // Extrude
        let _ = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 10.0 },
                MaterialId::new(0),
            )
            .expect("extrude OK");
        // Original self-loop edge must be inactive (or removed from edges
        // SlotStorage). L-υ-1.
        let still_active = mesh
            .edges
            .get(original_edge)
            .map(|e| e.is_active())
            .unwrap_or(false);
        assert!(!still_active,
            "ADR-089 A-υ-β: leftover self-loop edge must be cleaned up");
    }

    #[test]
    fn adr089_a_upsilon_anchor_vertex_deactivated_if_isolated() {
        // Anchor vertex of the closed-curve face must be deactivated
        // after extrude (it has no other edge references). L-υ-2.
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 3.0);
        let outer_start = mesh.faces[profile].outer().start;
        let original_edge = mesh.hes[outer_start].edge();
        let anchor = mesh.edges[original_edge].v_small();
        let _ = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 5.0 },
                MaterialId::new(0),
            )
            .expect("extrude OK");
        let anchor_active = mesh.verts.get(anchor).map(|v| v.is_active()).unwrap_or(false);
        assert!(!anchor_active,
            "ADR-089 A-υ-β: isolated anchor vertex must be deactivated");
    }

    #[test]
    fn adr089_a_upsilon_extrude_polygon_unaffected() {
        // Regression — polygonal Circle face (no self-loop) keeps using
        // existing extrude path. No anchor vertex / self-loop concept.
        let mut mesh = Mesh::new();
        let profile = build_circle_face(&mut mesh, 5.0, 16);
        let face_count_before = mesh.face_count();
        let result = mesh
            .create_solid(
                profile,
                CreateSolidMode::Extrude { distance: 7.0 },
                MaterialId::new(0),
            )
            .expect("polygon Circle extrude OK");
        assert_eq!(result.solid_kind, SolidKind::Cylinder);
        assert_eq!(result.profile_face, profile);
        assert!(mesh.faces[profile].is_active(),
            "regression guard — polygonal profile preserved");
        assert!(mesh.face_count() > face_count_before);
    }

    #[test]
    fn adr089_a_theta_zero_distance_rejected_before_tessellation() {
        // Degenerate distance (< EPSILON_LENGTH) must reject upfront —
        // Path A fast-path must not run if distance is invalid.
        let mut mesh = Mesh::new();
        let profile = build_closed_curve_circle_face(&mut mesh, DVec3::ZERO, 1.0);
        let result = mesh.create_solid(
            profile,
            CreateSolidMode::Extrude { distance: 0.0 },
            MaterialId::new(0),
        );
        assert!(result.is_err(), "zero-distance must error");
        // Profile face should still be intact (no premature mutation).
        assert!(mesh.faces.contains(profile));
    }
}
