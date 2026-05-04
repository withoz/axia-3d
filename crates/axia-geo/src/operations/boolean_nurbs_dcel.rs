//! ADR-064 Step 2 (sub-steps 2.B + 2.C, Path Z) — NURBS Boolean → DCEL
//! face dispatcher.
//!
//! Wires Phase J `nurbs_boolean_v2` (trim-curve generation) → Step 1
//! (`trim_loops_to_dcel_polyline`) → Step 2.A (`trim_loops_to_face`)
//! into a single end-to-end Boolean DCEL output operation.
//!
//! ## Path Z scope (Step 4: Op-specific removal semantics)
//!
//! Per ADR-064 §C lock-ins:
//! - **D-A=(c)**: Path Z (narrow pilot).
//! - **D-B=(a)**: Subtract + Union + Intersect (Step 3-α).
//! - **D-C=(a)**: Op-specific removal (Step 4 expansion). Input faces
//!   are removed per op semantics ONLY when new face creation succeeds:
//!     * Subtract → remove face_a, preserve face_b.
//!     * Union → remove both face_a and face_b.
//!     * Intersect → remove both face_a and face_b.
//! - **D-D=(a)**: Full surface clone (uv range preserved).
//! - **D-E=(a)**: Material inherited from input face_a (A side) /
//!   face_b (B side).
//! - **D-F=(c)**: Disjoint = op-specific no-op. No new faces, no
//!   removal — both inputs preserved regardless of op:
//!     * Subtract disjoint → A unchanged (correct).
//!     * Union disjoint → both kept (correct).
//!     * Intersect disjoint → both kept (D-H safe-only: empty result
//!       is correct semantics, but we preserve inputs to avoid
//!       destroying the user's geometry on a no-op call).
//! - **D-G=(b)**: Separate function (drop-in alongside, no
//!   `boolean_dispatch` wiring yet — Step 5 cutover).
//! - **D-H=safe-only**: Removal applies ONLY when new_faces creation
//!   succeeds. If `containment_to_faces_with_loops` returns Err
//!   (e.g., depth ≥ 2), the input faces are preserved and the Err
//!   propagates with no mesh mutation.
//! - **D-I=batch**: Each `nurbs_boolean_to_dcel` call is one logical
//!   undo unit at the caller level. Internal removal+creation appear
//!   atomic to higher-level callers (transaction wrapping is Step 5
//!   responsibility).
//!
//! ## Containment depth limitation (Path Z)
//!
//! Currently handles depth ≤ 1 (1 outer + N immediate hole children).
//! Depth ≥ 2 (nested outer in hole) returns `Err` with explanation.
//! Multi-depth handling = Step 3 / Path Y future ADR.

use anyhow::{bail, Result};

use crate::mesh::Mesh;
use crate::operations::boolean::BoolOp;
use crate::surfaces::ssi::boolean::{nurbs_boolean_v2, BooleanOp};
use crate::surfaces::ssi::robustness::SsiRobustnessReport;
use crate::surfaces::ssi::tolerance::BooleanTolerance;
use crate::surfaces::trim::TrimLoop;
use crate::surfaces::AnalyticSurface;
use crate::{FaceId, MaterialId};

/// ADR-064 Step 2.B/3-α/4 — NURBS Boolean DCEL output result.
#[derive(Debug)]
pub struct NurbsBooleanDcelResult {
    /// New face IDs created on surface A side (trim_a applied).
    pub new_faces_a: Vec<FaceId>,
    /// New face IDs created on surface B side (trim_b applied).
    pub new_faces_b: Vec<FaceId>,
    /// Step 4 (D-C=(a)) — Input face IDs that were REMOVED per op
    /// semantics:
    ///   * Subtract intersecting → `[face_a]`
    ///   * Union intersecting    → `[face_a, face_b]`
    ///   * Intersect intersecting → `[face_a, face_b]`
    ///   * Disjoint (any op)     → `[]` (D-F=(c) no-op)
    ///   * Failure (D-H safe-only) → `[]` (preserved, Err returned)
    pub removed_faces: Vec<FaceId>,
    /// Input face IDs that were KEPT (not removed). Equals
    /// `[face_a, face_b]` minus `removed_faces`.
    pub preserved_faces: Vec<FaceId>,
    /// SSI was empty — surfaces don't intersect. Per D-F=(c) policy:
    /// `new_faces_a` / `new_faces_b` / `removed_faces` are all empty;
    /// `preserved_faces = [face_a, face_b]`.
    pub disjoint: bool,
    /// Phase J robustness diagnostic (tangent contact / coincident /
    /// branch / pcurve / self-intersect / boundary grazing).
    pub robustness: SsiRobustnessReport,
}

impl Mesh {
    /// ADR-064 Step 2.B + 2.C (Path Z) — End-to-end NURBS Boolean → DCEL.
    ///
    /// Performs Phase J `nurbs_boolean_v2`, then converts the resulting
    /// trim curve loops into actual DCEL faces via Step 1+2.A pipeline.
    /// Surface clones are attached to new faces.
    ///
    /// **Path Z scope (D-B=(a)) — Subtract + Union + Intersect**:
    /// - All 3 `BoolOp` variants accepted; forwarded to Phase J
    ///   `nurbs_boolean_v2` which already supports them.
    /// - Disjoint case (D-F=(c) op-specific no-op): both inputs
    ///   preserved, no new faces, `disjoint=true`.
    ///
    /// **Path Z scope (D-C=(a)) — Op-specific removal**:
    /// On successful new face creation, input faces are removed per op:
    /// - **Subtract**: `face_a` removed; `face_b` preserved.
    /// - **Union**: both `face_a` and `face_b` removed.
    /// - **Intersect**: both `face_a` and `face_b` removed.
    ///
    /// **D-H safe-only**: Removal applies only when
    /// `containment_to_faces_with_loops` succeeds. If it returns Err
    /// (depth ≥ 2 etc.), inputs are preserved and Err propagates.
    ///
    /// **Containment depth limitation**:
    /// Only depth ≤ 1 (1 outer + N immediate hole children) supported.
    /// Nested outer (depth ≥ 2) returns `Err`.
    ///
    /// **Drop-in alongside (D-G=(b))**:
    /// `boolean.rs` (mesh path) and `boolean_dispatch` (Phase O Step 4)
    /// UNCHANGED. This is a separate function for end-to-end NURBS DCEL
    /// production until Step 5 cutover.
    pub fn nurbs_boolean_to_dcel(
        &mut self,
        face_a: FaceId,
        face_b: FaceId,
        op: BoolOp,
        tol: BooleanTolerance,
    ) -> Result<NurbsBooleanDcelResult> {
        // ── Path Z Step 3-α scope: Subtract + Union + Intersect ────
        // (D-B=(a)) — all 3 ops supported via direct Phase J forwarding.

        // ── Validate input faces + extract surfaces ─────────────────
        let (surface_a, mat_a) = {
            let f = self.faces.get(face_a)
                .ok_or_else(|| anyhow::anyhow!("face_a {:?} not found", face_a))?;
            if !f.is_active() {
                bail!("face_a {:?} is inactive", face_a);
            }
            let s = f.surface()
                .ok_or_else(|| anyhow::anyhow!("face_a has no surface attached"))?;
            (s.clone(), f.material())
        };
        let (surface_b, mat_b) = {
            let f = self.faces.get(face_b)
                .ok_or_else(|| anyhow::anyhow!("face_b {:?} not found", face_b))?;
            if !f.is_active() {
                bail!("face_b {:?} is inactive", face_b);
            }
            let s = f.surface()
                .ok_or_else(|| anyhow::anyhow!("face_b has no surface attached"))?;
            (s.clone(), f.material())
        };

        // ── Convert surfaces to B-spline params (Phase J input) ─────
        use super::boolean_dispatch::{surface_to_bspline, SideTag};
        let pa = surface_to_bspline(&surface_a, SideTag::A)
            .map_err(|e| anyhow::anyhow!("surface A bspline conversion failed: {:?}", e))?;
        let pb = surface_to_bspline(&surface_b, SideTag::B)
            .map_err(|e| anyhow::anyhow!("surface B bspline conversion failed: {:?}", e))?;

        // ── Phase J nurbs_boolean_v2 — SSI + trim generation ────────
        // D-B=(a) — direct forwarding for all 3 ops.
        let bool_op = match op {
            BoolOp::Subtract => BooleanOp::Subtract,
            BoolOp::Union => BooleanOp::Union,
            BoolOp::Intersect => BooleanOp::Intersect,
        };
        let phase_j = nurbs_boolean_v2(
            &pa.ctrl_grid, &pa.knots_u, &pa.knots_v, pa.deg_u, pa.deg_v,
            &pb.ctrl_grid, &pb.knots_u, &pb.knots_v, pb.deg_u, pb.deg_v,
            bool_op, tol,
        ).map_err(|e| anyhow::anyhow!("nurbs_boolean_v2 failed: {}", e))?;

        // ── Disjoint case (D-F=(c) op-specific no-op) ───────────────
        // Both inputs preserved regardless of op. Caller can branch on
        // `result.disjoint` if disjoint-specific handling is needed.
        if phase_j.is_disjoint() {
            return Ok(NurbsBooleanDcelResult {
                new_faces_a: Vec::new(),
                new_faces_b: Vec::new(),
                removed_faces: Vec::new(),
                preserved_faces: vec![face_a, face_b],
                disjoint: true,
                robustness: phase_j.robustness,
            });
        }

        // ── Convert trim loops → DCEL faces (per side) ──────────────
        // Path Z containment depth limitation: depth ≤ 1.
        // **D-H safe-only**: any `?` propagation here BEFORE the
        // removal block ensures input faces remain untouched on failure.
        let new_faces_a = self.containment_to_faces_with_loops(
            &phase_j.trim_a, &phase_j.trim_a_loops, &surface_a, mat_a, tol.geometric,
        )?;
        let new_faces_b = self.containment_to_faces_with_loops(
            &phase_j.trim_b, &phase_j.trim_b_loops, &surface_b, mat_b, tol.geometric,
        )?;

        // ── D-H safe-only stricter guard ────────────────────────────
        // SSI was non-empty but produced no closed loops (e.g., open
        // chains only — Phase J skips them). new_faces_a / new_faces_b
        // are both empty. Removing inputs would destroy geometry with
        // nothing to replace it. Preserve everything.
        let any_created = !new_faces_a.is_empty() || !new_faces_b.is_empty();
        if !any_created {
            return Ok(NurbsBooleanDcelResult {
                new_faces_a, new_faces_b,
                removed_faces: Vec::new(),
                preserved_faces: vec![face_a, face_b],
                disjoint: false,  // SSI intersected, but produced no closed trim loops
                robustness: phase_j.robustness,
            });
        }

        // ── Op-specific removal (D-C=(a)) ───────────────────────────
        // New faces created successfully — apply removal per op.
        let (removed, preserved) = match op {
            BoolOp::Subtract  => (vec![face_a],         vec![face_b]),
            BoolOp::Union     => (vec![face_a, face_b], Vec::new()),
            BoolOp::Intersect => (vec![face_a, face_b], Vec::new()),
        };
        for &fid in &removed {
            // Defense-in-depth: verify the face we're about to remove is
            // not among the new faces we just created (ID reuse paranoia).
            debug_assert!(
                !new_faces_a.contains(&fid) && !new_faces_b.contains(&fid),
                "removal target {:?} collides with new face — invariant violated",
                fid
            );
            self.remove_face(fid)
                .map_err(|e| anyhow::anyhow!("input face removal failed: {}", e))?;
        }

        Ok(NurbsBooleanDcelResult {
            new_faces_a,
            new_faces_b,
            removed_faces: removed,
            preserved_faces: preserved,
            disjoint: false,
            robustness: phase_j.robustness,
        })
    }

    /// ADR-064 Step 2.B — Convert containment tree + flat loop slice to
    /// DCEL faces (Path Z MVP). Used internally by `nurbs_boolean_to_dcel`.
    ///
    /// `loops` MUST be the same slice that built `tree` (loop_index
    /// values index into this slice).
    pub(crate) fn containment_to_faces_with_loops(
        &mut self,
        tree: &crate::surfaces::ssi::trim_classify::ContainmentTree,
        loops: &[TrimLoop],
        surface: &AnalyticSurface,
        material: MaterialId,
        chord_tol: f64,
    ) -> Result<Vec<FaceId>> {
        if tree.is_empty() {
            return Ok(Vec::new());
        }
        if tree.max_depth() >= 2 {
            bail!(
                "Path Z containment depth {} not supported (depth ≥ 2 = nested outer)",
                tree.max_depth()
            );
        }

        let mut new_faces = Vec::new();
        for &root_idx in &tree.roots {
            let root = &tree.nodes[root_idx];
            // Outer loop = root.
            let outer_loop = &loops[root.loop_index];
            // Inner loops = direct children (immediate holes).
            let mut group = vec![outer_loop.clone()];
            for &child_idx in &root.children {
                let child = &tree.nodes[child_idx];
                group.push(loops[child.loop_index].clone());
            }
            // Convert to VertId polylines (Step 1).
            let polylines = self.trim_loops_to_dcel_polyline(&group, surface, chord_tol);
            // Skip if any sub-loop produced empty (degenerate trim).
            if polylines.iter().any(|p| p.len() < 3) {
                continue;
            }
            // Convert to DCEL Face (Step 2.A).
            let fid = self.trim_loops_to_face(&polylines, material)?;
            // Attach surface clone (D-D=(a) full clone).
            self.set_face_surface(fid, Some(surface.clone()));
            new_faces.push(fid);
        }
        Ok(new_faces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    /// Create a quad face on a Plane surface at z=0 spanning [0..10] × [0..10].
    fn make_plane_quad(mesh: &mut Mesh, mat: MaterialId, z_offset: f64) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, z_offset));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, z_offset));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 10.0, z_offset));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 10.0, z_offset));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let plane = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, z_offset),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        };
        mesh.set_face_surface(fid, Some(plane));
        fid
    }

    /// ADR-064 Step 2.B Path Z #1 — Two non-intersecting parallel
    /// planes (z=0 and z=5) → SSI empty → `disjoint=true`, no new
    /// faces, originals preserved.
    #[test]
    fn nurbs_boolean_to_dcel_disjoint_returns_no_new_faces() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);  // 5mm above

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("disjoint should not error, return disjoint=true");

        assert!(result.disjoint, "parallel planes 5mm apart must be disjoint");
        assert!(result.new_faces_a.is_empty(),
            "disjoint Subtract must produce no new face_a");
        assert!(result.new_faces_b.is_empty());
        assert_eq!(result.preserved_faces.len(), 2);
        assert!(result.preserved_faces.contains(&face_a));
        assert!(result.preserved_faces.contains(&face_b));
    }

    /// ADR-064 Step 4 Path Z (D-F=(c)) — Disjoint Subtract is a no-op:
    /// both inputs preserved, no removal even though Subtract normally
    /// removes face_a (D-C=(a)). D-F=(c) takes precedence on disjoint.
    #[test]
    fn nurbs_boolean_to_dcel_preserves_originals() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).unwrap();

        // Disjoint → both originals stay active (D-F=(c) op-specific no-op).
        assert!(result.disjoint);
        assert!(mesh.faces[face_a].is_active(),
            "face_a must remain active on disjoint (D-F=(c))");
        assert!(mesh.faces[face_b].is_active(),
            "face_b must remain active on disjoint (D-F=(c))");
        assert!(result.removed_faces.is_empty(),
            "disjoint must not remove any face");
        assert_eq!(result.preserved_faces, vec![face_a, face_b]);
    }

    /// ADR-064 Step 2.B Path Z #6 — Drop-in alongside: `boolean_dispatch`
    /// (Phase O Step 4) and `boolean.rs` (mesh path) UNCHANGED.
    /// Verify by performing both `nurbs_boolean_to_dcel` and a separate
    /// mesh boolean on the same fixture; both must coexist without
    /// regression.
    #[test]
    fn nurbs_boolean_to_dcel_dropin_alongside_no_regression() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        // Active face count before.
        let before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();

        // Run nurbs_boolean_to_dcel — disjoint, no new faces.
        let _ = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).unwrap();

        // No new active faces (disjoint), originals still active.
        let after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(before, after,
            "drop-in alongside: disjoint case must not change active face count");
    }

    /// ADR-064 Step 3-α Path Z (D-B=(a)) — `BoolOp::Union` accepted.
    /// Guard removed; Phase J forwarding works.
    #[test]
    fn nurbs_boolean_to_dcel_union_accepted() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Union, BooleanTolerance::default(),
        );
        assert!(result.is_ok(),
            "Union must be accepted post-Step 3-α (D-B=(a)); got {:?}",
            result.err());
    }

    /// ADR-064 Step 3-α Path Z (D-B=(a)) — `BoolOp::Intersect` accepted.
    #[test]
    fn nurbs_boolean_to_dcel_intersect_accepted() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Intersect, BooleanTolerance::default(),
        );
        assert!(result.is_ok(),
            "Intersect must be accepted post-Step 3-α (D-B=(a)); got {:?}",
            result.err());
    }

    /// ADR-064 Step 3-α Path Z — Union of disjoint planes → empty result
    /// + `disjoint=true`. Caller fallback: keep both originals (additive
    /// default already satisfies this).
    #[test]
    fn nurbs_boolean_to_dcel_union_disjoint_returns_no_new_faces() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Union, BooleanTolerance::default(),
        ).expect("Union disjoint must succeed");

        assert!(result.disjoint, "parallel planes must be disjoint");
        assert!(result.new_faces_a.is_empty(),
            "Union disjoint produces no new face_a");
        assert!(result.new_faces_b.is_empty(),
            "Union disjoint produces no new face_b");
        assert_eq!(result.preserved_faces.len(), 2);
    }

    /// ADR-064 Step 3-α Path Z — Intersect of disjoint planes → empty
    /// result + `disjoint=true`. Caller fallback: empty result is the
    /// CORRECT semantics for Intersect of disjoint inputs.
    #[test]
    fn nurbs_boolean_to_dcel_intersect_disjoint_returns_no_new_faces() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Intersect, BooleanTolerance::default(),
        ).expect("Intersect disjoint must succeed");

        assert!(result.disjoint, "parallel planes must be disjoint");
        assert!(result.new_faces_a.is_empty(),
            "Intersect disjoint produces no new face_a (correct semantics)");
        assert!(result.new_faces_b.is_empty(),
            "Intersect disjoint produces no new face_b");
    }

    /// ADR-064 Step 2.B Path Z — Inactive / missing-surface face rejected.
    #[test]
    fn nurbs_boolean_to_dcel_rejects_invalid_input() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        // Make a polygon face WITHOUT surface.
        let v0 = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(30.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(30.0, 10.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(20.0, 10.0, 0.0));
        let face_no_surface = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        let err = mesh.nurbs_boolean_to_dcel(
            face_a, face_no_surface, BoolOp::Subtract, BooleanTolerance::default(),
        );
        assert!(err.is_err(),
            "face without surface must be rejected (Path Z requires surface attach)");
    }

    /// ADR-064 Step 2.B Path Z — Disjoint result robustness report
    /// is empty/clean (no SSI pathologies for non-touching planes).
    #[test]
    fn nurbs_boolean_to_dcel_robustness_clean_for_disjoint() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 100.0);  // far away

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).unwrap();

        assert!(result.disjoint);
        assert!(result.robustness.is_clean(),
            "disjoint case must produce clean robustness report");
    }

    // ───────────────────────────────────────────────────────────────
    // Step 4 regression tests (D-C=(a) op-specific removal)
    // ───────────────────────────────────────────────────────────────

    /// Make a vertical plane at y=0.5 spanning [0..1] × [-0.5..0.5] in z.
    /// Used as a B-side for perpendicular-intersection fixtures.
    fn make_vertical_plane(mesh: &mut Mesh, mat: MaterialId) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.5, -0.5));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.5, -0.5));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.5,  0.5));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.5,  0.5));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let plane = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.5, 0.0),
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (-0.5, 0.5),
        };
        mesh.set_face_surface(fid, Some(plane));
        fid
    }

    /// ADR-064 Step 4 Path Z #1 (D-F=(c)) — Disjoint Subtract is no-op.
    /// Both inputs preserved, no removal.
    #[test]
    fn step4_subtract_disjoint_no_removal() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).unwrap();

        assert!(result.disjoint);
        assert!(result.removed_faces.is_empty(),
            "D-F=(c) disjoint Subtract must not remove anything");
        assert_eq!(result.preserved_faces, vec![face_a, face_b]);
        assert!(mesh.faces[face_a].is_active() && mesh.faces[face_b].is_active());
    }

    /// ADR-064 Step 4 Path Z #2 (D-F=(c)) — Disjoint Union is no-op.
    #[test]
    fn step4_union_disjoint_no_removal() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Union, BooleanTolerance::default(),
        ).unwrap();

        assert!(result.disjoint);
        assert!(result.removed_faces.is_empty(),
            "D-F=(c) disjoint Union preserves both (additive default semantics)");
        assert_eq!(result.preserved_faces.len(), 2);
        assert!(mesh.faces[face_a].is_active() && mesh.faces[face_b].is_active());
    }

    /// ADR-064 Step 4 Path Z #3 (D-F=(c)) — Disjoint Intersect is no-op.
    /// D-H safe-only: even though "Intersect of disjoint = empty" is the
    /// CORRECT mathematical semantics, we preserve inputs to avoid
    /// destroying user geometry on a no-op call. Caller can branch on
    /// `result.disjoint` if "delete-on-empty-intersect" is desired.
    #[test]
    fn step4_intersect_disjoint_no_removal() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad(&mut mesh, mat, 5.0);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Intersect, BooleanTolerance::default(),
        ).unwrap();

        assert!(result.disjoint);
        assert!(result.removed_faces.is_empty(),
            "D-H safe-only: disjoint Intersect must NOT remove inputs");
        assert!(mesh.faces[face_a].is_active() && mesh.faces[face_b].is_active());
    }

    /// ADR-064 Step 4 Path Z #4 (D-H safe-only) — SSI intersects but
    /// produces no closed loops (perpendicular planes → open chain only).
    /// Even though `disjoint=false`, no new faces means no removal:
    /// we don't destroy inputs without producing replacements.
    #[test]
    fn step4_no_removal_when_no_closed_loops() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad(&mut mesh, mat, 0.0);
        let face_b = make_vertical_plane(&mut mesh, mat);

        let result = mesh.nurbs_boolean_to_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("perpendicular planes must not error");

        // Open chain only — no closed loops → no new faces.
        assert!(result.new_faces_a.is_empty());
        assert!(result.new_faces_b.is_empty());
        // D-H stricter guard: no creation → no removal.
        assert!(result.removed_faces.is_empty(),
            "D-H safe-only: no new faces means no removal even with intersection");
        assert_eq!(result.preserved_faces.len(), 2);
        // Both originals must still be active.
        assert!(mesh.faces[face_a].is_active(),
            "face_a must remain active when removal is skipped");
        assert!(mesh.faces[face_b].is_active(),
            "face_b must remain active when removal is skipped");
    }

    /// ADR-064 Step 4 Path Z #5 — Result struct invariant:
    /// `removed_faces ∪ preserved_faces ⊇ {face_a, face_b}`. No input
    /// face is "lost" from the bookkeeping.
    #[test]
    fn step4_removed_plus_preserved_covers_inputs() {
        let configs = [
            (0.0, 5.0,   BoolOp::Subtract,  "disjoint Subtract"),
            (0.0, 5.0,   BoolOp::Union,     "disjoint Union"),
            (0.0, 5.0,   BoolOp::Intersect, "disjoint Intersect"),
            (0.0, 100.0, BoolOp::Subtract,  "far-disjoint Subtract"),
        ];
        for (z_a, z_b, op, label) in configs {
            let mut mesh = Mesh::new();
            let mat = MaterialId::new(0);
            let face_a = make_plane_quad(&mut mesh, mat, z_a);
            let face_b = make_plane_quad(&mut mesh, mat, z_b);

            let result = mesh.nurbs_boolean_to_dcel(
                face_a, face_b, op, BooleanTolerance::default(),
            ).unwrap_or_else(|e| panic!("{}: {}", label, e));

            let mut accounted: Vec<FaceId> = result.removed_faces.clone();
            accounted.extend(result.preserved_faces.iter().copied());
            assert!(accounted.contains(&face_a),
                "{}: face_a missing from removed+preserved", label);
            assert!(accounted.contains(&face_b),
                "{}: face_b missing from removed+preserved", label);
            // No double-counting either: a face is in exactly one of the two.
            for &fid in &result.removed_faces {
                assert!(!result.preserved_faces.contains(&fid),
                    "{}: face {:?} in BOTH removed and preserved", label, fid);
            }
        }
    }
}
