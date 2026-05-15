//! ADR-102 Phase β — Push/Pull Detach-on-Arrangement: cleave helpers.
//!
//! This module provides the two architectural primitives that ADR-102
//! γ wires into `create_solid_extrude`'s pre-step to reconcile mesh-era
//! manifold rules (LOCKED #1 ADR-021 P7) with NURBS-era hybrid
//! infrastructure created by ADR-101 §B-3b auto-intersect:
//!
//!   1. [`Mesh::collect_coplanar_siblings`] — find all coplanar adjacent
//!      faces (sharing a boundary edge in the radial chain) that need
//!      to be cleaved from the source before extrude.
//!
//!   2. [`Mesh::cleave_face_from_siblings`] — duplicate the source face's
//!      outer-boundary verts so the source face and its coplanar siblings
//!      no longer share edges. Siblings remain manifold-intact.
//!
//! Both functions are **additive** — no existing callers behave
//! differently until ADR-102 γ wires them in. They are designed to be
//! invoked back-to-back (`collect` then `cleave`) by `create_solid_extrude`.
//!
//! # Lock-ins (ADR-102 §6)
//!
//! - **L-102-1** Source-side cleave only — sibling face's outer/inner
//!   loops are NOT mutated. Only the source face's outer-loop verts
//!   are duplicated.
//! - **L-102-2** Coplanarity tolerance — `COPLANARITY_NORMAL_DOT_MIN`
//!   (0.9999) AND `COPLANARITY_OFFSET_TOL` (1.5μm, LOCKED #5).
//! - **L-102-3** Edge cleave manifold safe — after cleave, every boundary
//!   edge of the new source face is incident to exactly 1 face (the new
//!   source). The old shared edges remain in the mesh but now belong
//!   solely to the siblings.
//! - **L-102-5** Curve metadata inherit — new boundary edges receive a
//!   clone of the old edge's `curve` (Arc/Bezier/...). A single new
//!   `curve_owner_id` is allocated; only the new edges that had an
//!   `Some(owner_id)` on the old side receive it (group separation
//!   from the sibling-side group).
//!
//! # Hole / inner loop handling
//!
//! Per L-102-8, hole boundary face Push/Pull is already rejected
//! (ADR-016 Q2). `cleave_face_from_siblings` currently preserves inner
//! loops (holes) on the source face *unchanged* — only the outer loop
//! is cleaved. If the source face has inner loops AND siblings, the
//! helper still works (outer boundary separation only).

use glam::DVec3;
use anyhow::{Result, bail};
use rustc_hash::FxHashSet;

use crate::mesh::Mesh;
use crate::entities::{FaceId, VertId, EdgeId};

use super::coplanar::{COPLANARITY_NORMAL_DOT_MIN, COPLANARITY_OFFSET_TOL};

/// Result of a cleave operation.
///
/// `new_face_id` is the FaceId of the newly created cleaved source face.
/// The caller (e.g., `create_solid_extrude` γ pre-step) must use this id
/// in place of the original `face_id` for all subsequent operations,
/// since the original face was removed.
#[derive(Debug, Clone, Copy)]
pub struct CleaveResult {
    /// The cleaved source face's new id (siblings unchanged).
    pub new_face_id: FaceId,
    /// Number of new outer-boundary verts created (= source outer vert count).
    pub new_vert_count: usize,
    /// Number of new boundary edges created.
    pub new_edge_count: usize,
}

impl Mesh {
    /// ADR-102 α-2 — Find all coplanar adjacent siblings of a face.
    ///
    /// Walks every outer-boundary edge of `face_id`. For each edge,
    /// inspects the radial half-edge chain and collects every *other*
    /// active face that shares the edge. Each candidate is then tested
    /// for coplanarity against `face_id` (`normal dot ≥ 0.9999` AND
    /// `offset ≤ 1.5μm` — L-102-2). Coplanar candidates are returned
    /// uniquely.
    ///
    /// Returns an empty `Vec` if the face is isolated (no shared edges)
    /// or if all neighbors are non-coplanar (e.g., 3D solid wall
    /// adjacency where each face has a different plane).
    ///
    /// # Errors
    ///
    /// - `face {:?} not found / inactive`
    /// - `face {:?} boundary corrupted (collect_loop_verts failed)`
    pub fn collect_coplanar_siblings(&self, face_id: FaceId) -> Result<Vec<FaceId>> {
        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!(
                "ADR-102 α-2: face {:?} not found", face_id))?;
        if !face.is_active() {
            bail!("ADR-102 α-2: face {:?} is inactive", face_id);
        }

        // Source plane: derive normal + offset from face's outer loop verts.
        let outer_verts = self.collect_loop_verts(face.outer().start)
            .map_err(|e| anyhow::anyhow!(
                "ADR-102 α-2: face {:?} boundary corrupted: {}", face_id, e))?;
        // ADR-089 Phase 2 kernel-native closed-curve face (1 anchor +
        // 1 self-loop edge) has < 3 outer verts. By construction, a
        // self-loop edge cannot be shared with a polygon-sibling face
        // → no cleave required. Return empty siblings (hot path).
        if outer_verts.len() < 3 {
            return Ok(Vec::new());
        }
        let src_normal = face.normal();
        if src_normal.length_squared() < 1e-12 {
            bail!("ADR-102 α-2: face {:?} has degenerate (near-zero) normal",
                face_id);
        }
        let src_normal = src_normal.normalize();
        let src_origin = self.vertex_pos(outer_verts[0])?;

        // Collect candidate sibling face ids via radial chains on each edge.
        let outer_edges = self.face_outer_edges(face_id)?;
        let mut candidates: FxHashSet<FaceId> = FxHashSet::default();
        for eid in &outer_edges {
            let (faces, _) = self.get_faces_sharing_edge(*eid);
            for f in faces {
                if f != face_id && f != FaceId::NULL {
                    candidates.insert(f);
                }
            }
        }

        // Filter to coplanar only.
        let mut result: Vec<FaceId> = Vec::with_capacity(candidates.len());
        for cand in candidates {
            if !is_coplanar_with(self, cand, src_normal, src_origin) {
                continue;
            }
            result.push(cand);
        }
        // Deterministic ordering (raw id ascending) — eases testability.
        result.sort_by_key(|f| f.raw());
        Ok(result)
    }

    /// ADR-102 β-1 — Cleave the source face's outer boundary from its
    /// coplanar siblings.
    ///
    /// Re-creates the source face with newly-allocated duplicate vertices
    /// at the same coordinates, leaving the sibling faces' boundary
    /// vertices untouched. The original `face_id` is removed; the
    /// returned `CleaveResult.new_face_id` is the new id callers must use.
    ///
    /// Inner loops (holes) on the source face are NOT cleaved — they
    /// remain referencing the original verts. See module docs.
    ///
    /// # Behavior on isolated face (no siblings)
    ///
    /// If `siblings` is empty, returns a no-op `Ok(CleaveResult)` with
    /// `new_face_id == face_id` and `new_vert_count == new_edge_count == 0`.
    /// This is the expected hot path — most Push/Pull invocations have
    /// no coplanar siblings (typical 3D solid face Push/Pull).
    ///
    /// # Errors
    ///
    /// - `face {:?} not found / inactive`
    /// - `face {:?} outer loop corrupted`
    /// - propagates `add_vertex_force_new` / `add_face` errors
    ///
    /// # Lock-ins
    ///
    /// - L-102-1 Source-side only — siblings UNCHANGED
    /// - L-102-3 New boundary edges are manifold-clean (no shared HE
    ///   with sibling boundaries)
    /// - L-102-5 Curve metadata inherit — new edges clone old edge
    ///   `curve`; a single new `curve_owner_id` is allocated and applied
    ///   to those new edges whose old counterpart had an owner_id
    pub fn cleave_face_from_siblings(
        &mut self,
        face_id: FaceId,
        siblings: &[FaceId],
    ) -> Result<CleaveResult> {
        // No-op fast path for isolated faces.
        if siblings.is_empty() {
            return Ok(CleaveResult {
                new_face_id: face_id,
                new_vert_count: 0,
                new_edge_count: 0,
            });
        }

        // Validate source face.
        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!(
                "ADR-102 β-1: face {:?} not found", face_id))?;
        if !face.is_active() {
            bail!("ADR-102 β-1: face {:?} is inactive", face_id);
        }

        // ─── Phase 1: Snapshot source face state ─────────────────────
        let material = face.material();
        let surface = face.surface().cloned();
        let normal_cached = face.normal();
        let face_flags = face.flags();
        let double_sided = face.is_double_sided();
        let outer_start = face.outer().start;

        let old_outer_verts = self.collect_loop_verts(outer_start)?;
        let n = old_outer_verts.len();
        if n < 3 {
            bail!("ADR-102 β-1: face {:?} outer loop has <3 verts (n={})",
                face_id, n);
        }

        // Snapshot positions + per-edge curve metadata (in outer loop order).
        let mut positions: Vec<DVec3> = Vec::with_capacity(n);
        for &vid in &old_outer_verts {
            positions.push(self.vertex_pos(vid)?);
        }
        // Old outer edges in the same order as outer_verts (edge i connects
        // outer_verts[i] → outer_verts[(i+1) % n]).
        let old_outer_edges: Vec<EdgeId> = self.face_outer_edges(face_id)?;
        if old_outer_edges.len() != n {
            bail!(
                "ADR-102 β-1: face {:?} outer edge count {} != vert count {}",
                face_id, old_outer_edges.len(), n);
        }
        // Snapshot curve + owner-id per old edge.
        let mut old_curves: Vec<Option<crate::curves::AnalyticCurve>> = Vec::with_capacity(n);
        let mut old_owner_ids: Vec<Option<u32>> = Vec::with_capacity(n);
        for eid in &old_outer_edges {
            old_curves.push(self.edge_curve(*eid).cloned());
            old_owner_ids.push(self.edge_curve_owner_id(*eid));
        }

        // Snapshot inner loops (vertex lists) — these are preserved on
        // the new face as-is (verts unchanged, but topology must be
        // rebuilt because remove_face will detach them).
        let inner_verts_lists: Vec<Vec<VertId>> = {
            let mut out: Vec<Vec<VertId>> = Vec::new();
            // re-borrow face since the loop below needs &self
            let face = self.faces.get(face_id).unwrap();
            for inner_ref in face.inners().to_vec() {
                if inner_ref.start.is_null() { continue; }
                match self.collect_loop_verts(inner_ref.start) {
                    Ok(v) => out.push(v),
                    Err(_) => continue,
                }
            }
            out
        };

        // ─── Phase 2: Remove the source face ─────────────────────────
        // This detaches the source side of every shared edge. The sibling
        // side's HE remains active (sibling face unchanged), so each old
        // shared edge stays in the mesh but is now a *boundary edge* of
        // the sibling.
        self.remove_face(face_id)?;

        // ─── Phase 3: Allocate duplicate verts (force_new) ───────────
        // `add_vertex_force_new` bypasses the 1.5μm spatial dedup that
        // would otherwise return the original sibling-shared vert id.
        let new_verts: Vec<VertId> = positions.iter()
            .map(|&p| self.add_vertex_force_new(p))
            .collect();

        // ─── Phase 4: Build the new face ─────────────────────────────
        // Holes are preserved by passing the original inner vert lists.
        let inner_refs: Vec<&[VertId]> = inner_verts_lists.iter()
            .map(|v| v.as_slice())
            .collect();
        let new_face_id = self.add_face_with_holes(&new_verts, &inner_refs, material)?;

        // ─── Phase 5: Inherit surface + flags + cached normal ────────
        if let Some(s) = surface {
            self.set_face_surface(new_face_id, Some(s));
        }
        if let Some(f) = self.faces.get_mut(new_face_id) {
            // Inherit flags (selection, soft, etc.) and double-sided.
            *f.flags_mut() = face_flags;
            f.set_double_sided(double_sided);
            // Preserve the cached normal direction (winding sanity —
            // add_face_with_holes recomputes from verts, but if the
            // original normal was set explicitly to flip winding the
            // caller likely wants the same orientation. The new verts
            // are in the same order so recomputed normal should already
            // match; we set explicitly only as a safety net.)
            f.set_normal(normal_cached.normalize_or_zero());
        }

        // ─── Phase 6: Inherit edge curves + allocate new owner-id ────
        // For each new outer edge (in the same vertex order), find it
        // and clone curve from the old counterpart. Owner-id is a fresh
        // monotonic allocation shared among all new edges that had a
        // grouped old edge.
        let new_owner_id_opt: Option<u32> =
            if old_owner_ids.iter().any(|o| o.is_some()) {
                Some(self.next_curve_owner_id())
            } else {
                None
            };

        let mut new_edge_count = 0usize;
        for i in 0..n {
            let va = new_verts[i];
            let vb = new_verts[(i + 1) % n];
            let Some(new_eid) = self.find_edge(va, vb) else {
                bail!(
                    "ADR-102 β-1: new outer edge between v{:?} and v{:?} not found \
                     (add_face_with_holes did not create expected edge)",
                    va, vb,
                );
            };
            new_edge_count += 1;
            // Inherit curve metadata
            if let Some(curve) = &old_curves[i] {
                if let Some(edge) = self.edges.get_mut(new_eid) {
                    edge.set_curve(Some(curve.clone()));
                }
            }
            // Inherit owner_id (group separation — new id, not the old one)
            if old_owner_ids[i].is_some() {
                if let Some(owner) = new_owner_id_opt {
                    self.set_edge_curve_owner_id(new_eid, Some(owner));
                }
            }
        }

        Ok(CleaveResult {
            new_face_id,
            new_vert_count: n,
            new_edge_count,
        })
    }
}

/// Helper: returns true iff `cand_face` is coplanar with the source
/// face described by `(src_normal, src_origin)`. Tolerances per
/// L-102-2.
fn is_coplanar_with(
    mesh: &Mesh,
    cand_face: FaceId,
    src_normal: DVec3,
    src_origin: DVec3,
) -> bool {
    let Some(cand) = mesh.faces.get(cand_face) else { return false; };
    if !cand.is_active() { return false; }

    let cand_normal = cand.normal();
    if cand_normal.length_squared() < 1e-12 { return false; }
    let cand_normal = cand_normal.normalize();
    let dot = src_normal.dot(cand_normal).abs();
    if dot < COPLANARITY_NORMAL_DOT_MIN {
        return false;
    }

    // Plane offset: project at least one candidate boundary vert.
    let Ok(cand_verts) = mesh.collect_loop_verts(cand.outer().start) else {
        return false;
    };
    for vid in &cand_verts {
        let Ok(p) = mesh.vertex_pos(*vid) else { return false; };
        let offset = (p - src_origin).dot(src_normal).abs();
        if offset > COPLANARITY_OFFSET_TOL {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;
    use crate::entities::MaterialId;

    fn unit_square_at(mesh: &mut Mesh, z: f64, x0: f64, y0: f64, x1: f64, y1: f64) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(x0, y0, z));
        let v1 = mesh.add_vertex(DVec3::new(x1, y0, z));
        let v2 = mesh.add_vertex(DVec3::new(x1, y1, z));
        let v3 = mesh.add_vertex(DVec3::new(x0, y1, z));
        mesh.add_face(&[v0, v1, v2, v3], MaterialId::default()).unwrap()
    }

    #[test]
    fn cleave_isolated_face_is_noop() {
        // Single face, no siblings → cleave returns same face id with 0 counts.
        let mut mesh = Mesh::default();
        let f = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let siblings = mesh.collect_coplanar_siblings(f).unwrap();
        assert!(siblings.is_empty(),
            "isolated face must report 0 siblings, got {}", siblings.len());

        let result = mesh.cleave_face_from_siblings(f, &siblings).unwrap();
        assert_eq!(result.new_face_id, f,
            "no-op cleave must return the same face id");
        assert_eq!(result.new_vert_count, 0);
        assert_eq!(result.new_edge_count, 0);
    }

    #[test]
    fn collect_siblings_finds_coplanar_adjacent_face() {
        // Two squares sharing one edge in the XY plane (z=0).
        // square A: (0,0)-(1,1)
        // square B: (1,0)-(2,1)   shares edge x=1
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);

        let siblings = mesh.collect_coplanar_siblings(a).unwrap();
        assert!(siblings.contains(&b),
            "coplanar adjacent face b={:?} must appear in siblings; got {:?}",
            b, siblings);
    }

    #[test]
    fn collect_siblings_rejects_non_coplanar_neighbor() {
        // square A on z=0 plane, square B on x=1 plane (90° rotation,
        // shares edge along (1,0,0)-(1,1,0)).
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        // B: vertices (1,0,0), (1,1,0), (1,1,1), (1,0,1) — on plane x=1.
        let v0 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 1.0));
        let v3 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));
        let _b = mesh.add_face(&[v0, v1, v2, v3], MaterialId::default()).unwrap();

        let siblings = mesh.collect_coplanar_siblings(a).unwrap();
        assert!(siblings.is_empty(),
            "perpendicular neighbor must NOT appear as coplanar sibling; got {:?}",
            siblings);
    }

    #[test]
    fn cleave_face_with_single_sibling_separates_verts() {
        // square A + square B sharing edge x=1 → after cleave on A,
        // A's boundary verts should be disjoint from B's.
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);
        let siblings = mesh.collect_coplanar_siblings(a).unwrap();
        assert_eq!(siblings.len(), 1);

        let b_verts_before: Vec<VertId> = mesh.collect_loop_verts(
            mesh.faces[b].outer().start).unwrap();

        let result = mesh.cleave_face_from_siblings(a, &siblings).unwrap();
        assert_ne!(result.new_face_id, a, "cleave creates a new face id");
        assert_eq!(result.new_vert_count, 4);
        assert_eq!(result.new_edge_count, 4);

        // Sibling B's verts must be UNCHANGED (L-102-1 source-side only).
        let b_verts_after: Vec<VertId> = mesh.collect_loop_verts(
            mesh.faces[b].outer().start).unwrap();
        assert_eq!(b_verts_before, b_verts_after,
            "sibling B's boundary verts must be unchanged after cleave");

        // New source face verts must NOT overlap with sibling B's verts.
        let new_verts: Vec<VertId> = mesh.collect_loop_verts(
            mesh.faces[result.new_face_id].outer().start).unwrap();
        let b_set: FxHashSet<VertId> = b_verts_after.iter().copied().collect();
        for nv in &new_verts {
            assert!(!b_set.contains(nv),
                "new source vert {:?} must NOT be in sibling B's verts {:?}",
                nv, b_set);
        }

        // After cleave, the new source face's edges share no HE with B.
        // Therefore the manifold info on the {new_source, B} set should
        // show only boundary edges (count=1), no non-manifold.
        let info = mesh.face_set_manifold_info(&[result.new_face_id, b]);
        assert_eq!(info.non_manifold_edge_count, 0,
            "cleaved face pair must have zero non-manifold edges");
    }

    // ── ADR-102 Phase δ — Regression sweep (full matrix) ─────────────
    //
    // δ-3 ~ δ-8: complete the spec §4 Phase δ regression matrix.
    // δ-1 + δ-2 + δ-5 (partial) covered by the tests above (β).
    // δ-8 (single-Undo) is a Scene-layer concern (TransactionManager
    // wraps the entire `Scene::exec_create_solid` call — ADR-049
    // P-5e-γ pattern); not duplicated here.

    /// δ-3 — ADR-101 B-4 lens scenario.
    ///
    /// Build via `auto_intersect_coplanar` (the actual trigger) — two
    /// partially overlapping squares → 3 sub-faces (face_a_only,
    /// face_b_only, lens). Then cleave the lens from its two siblings.
    #[test]
    fn cleave_b4_lens_sub_face_separates_from_two_siblings() {
        use crate::operations::coplanar::auto_intersect_coplanar;

        let mut mesh = Mesh::default();
        // Two squares partially overlapping in z=0 plane:
        //   A: (0,0)-(2,2)   B: (1,1)-(3,3) → lens at (1,1)-(2,2)
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 2.0, 2.0);
        let b = unit_square_at(&mut mesh, 0.0, 1.0, 1.0, 3.0, 3.0);

        let result = auto_intersect_coplanar(&mut mesh, a, b, MaterialId::default())
            .expect("auto_intersect_coplanar OK")
            .expect("partial overlap must produce 3 sub-faces");

        // lens has 2 coplanar siblings: face_a_only AND face_b_only.
        let siblings = mesh.collect_coplanar_siblings(result.lens).unwrap();
        assert_eq!(siblings.len(), 2,
            "ADR-101 B-4 lens must have exactly 2 coplanar siblings; got {:?}",
            siblings);
        assert!(siblings.contains(&result.face_a_only),
            "siblings must include face_a_only");
        assert!(siblings.contains(&result.face_b_only),
            "siblings must include face_b_only");

        // Snapshot sibling vert sets before cleave.
        let a_only_verts_before: FxHashSet<VertId> = mesh.collect_loop_verts(
            mesh.faces[result.face_a_only].outer().start).unwrap()
            .into_iter().collect();
        let b_only_verts_before: FxHashSet<VertId> = mesh.collect_loop_verts(
            mesh.faces[result.face_b_only].outer().start).unwrap()
            .into_iter().collect();

        let cleave = mesh.cleave_face_from_siblings(result.lens, &siblings).unwrap();

        // Both siblings must remain active + have UNCHANGED boundary verts.
        assert!(mesh.faces[result.face_a_only].is_active(),
            "face_a_only must remain active after cleave");
        assert!(mesh.faces[result.face_b_only].is_active(),
            "face_b_only must remain active after cleave");
        let a_only_verts_after: FxHashSet<VertId> = mesh.collect_loop_verts(
            mesh.faces[result.face_a_only].outer().start).unwrap()
            .into_iter().collect();
        let b_only_verts_after: FxHashSet<VertId> = mesh.collect_loop_verts(
            mesh.faces[result.face_b_only].outer().start).unwrap()
            .into_iter().collect();
        assert_eq!(a_only_verts_before, a_only_verts_after,
            "L-102-1: face_a_only sibling verts UNCHANGED");
        assert_eq!(b_only_verts_before, b_only_verts_after,
            "L-102-1: face_b_only sibling verts UNCHANGED");

        // New lens verts must be disjoint from both siblings.
        let new_lens_verts: FxHashSet<VertId> = mesh.collect_loop_verts(
            mesh.faces[cleave.new_face_id].outer().start).unwrap()
            .into_iter().collect();
        for v in &new_lens_verts {
            assert!(!a_only_verts_after.contains(v),
                "new lens vert {:?} must NOT overlap face_a_only", v);
            assert!(!b_only_verts_after.contains(v),
                "new lens vert {:?} must NOT overlap face_b_only", v);
        }
    }

    /// δ-4 — ADR-101 B-4 lens Push/Pull manifold safety after cleave.
    ///
    /// This is the **canonical regression** that motivated ADR-102:
    /// `create_solid_extrude` on a B-4 lens sub-face previously produced
    /// 4 non-manifold edges (lens boundary shared by 3 face-bearing HEs:
    /// lens + side wall + sibling). With γ wiring, the cleave pre-step
    /// resolves this finding.
    #[test]
    fn adr101_b4_lens_push_pull_manifold_safe_after_cleave() {
        use crate::operations::coplanar::auto_intersect_coplanar;
        use crate::operations::create_solid::{CreateSolidMode};
        use crate::surfaces::AnalyticSurface;

        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 2.0, 2.0);
        let b = unit_square_at(&mut mesh, 0.0, 1.0, 1.0, 3.0, 3.0);

        // Attach Plane surface to both (required for create_solid routing).
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 3.0),
            v_range: (0.0, 3.0),
        };
        mesh.faces[a].set_surface(Some(plane.clone()));
        mesh.faces[b].set_surface(Some(plane.clone()));

        let result = auto_intersect_coplanar(&mut mesh, a, b, MaterialId::default())
            .unwrap().expect("B-4 lens produced");

        // B-3b L-B3b-3: lens inherits Plane surface from parent (face_a).
        assert!(matches!(mesh.faces[result.lens].surface(),
            Some(AnalyticSurface::Plane { .. })),
            "lens must inherit Plane surface from parent (ADR-101 L-B3b-3)");

        // Push/Pull on lens (height = 1.0). γ wiring auto-cleaves first.
        let _solid = mesh.create_solid(
            result.lens,
            CreateSolidMode::Extrude { distance: 1.0 },
            MaterialId::default(),
        ).expect("ADR-102 γ: cleave + extrude on B-4 lens succeeds");

        // CANONICAL: post-extrude mesh must have 0 non-manifold edges.
        // Before ADR-102: 4 edges shared by 3 face-bearing HEs (lens +
        // sibling + side wall). After γ cleave: lens is decoupled from
        // sibs → 0 non-manifold.
        let all_active: Vec<FaceId> = mesh.faces.iter()
            .filter_map(|(fid, f)| if f.is_active() { Some(fid) } else { None })
            .collect();
        let info = mesh.face_set_manifold_info(&all_active);
        assert_eq!(info.non_manifold_edge_count, 0,
            "ADR-102 L-102-3 canonical: B-4 lens Push/Pull post-cleave \
             must have 0 non-manifold edges; got {} (info = {:?})",
            info.non_manifold_edge_count, info);
    }

    /// δ-5 — Sibling boundary preservation (stronger version of β).
    ///
    /// Verifies that *every* sibling face's boundary edge list is
    /// byte-identical before and after cleave (not just vert set).
    #[test]
    fn cleave_preserves_sibling_boundary_edges() {
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);
        let siblings = mesh.collect_coplanar_siblings(a).unwrap();

        let b_edges_before = mesh.face_outer_edges(b).unwrap();

        let _ = mesh.cleave_face_from_siblings(a, &siblings).unwrap();

        let b_edges_after = mesh.face_outer_edges(b).unwrap();
        assert_eq!(b_edges_before, b_edges_after,
            "L-102-1 strict: sibling B's outer edge list must be \
             byte-identical pre- and post-cleave");
    }

    /// δ-6 — Curve metadata inheritance.
    ///
    /// Attach an analytic Line curve to one boundary edge of the
    /// source face before cleave. After cleave, the corresponding new
    /// edge must carry the same `AnalyticCurve` and a fresh
    /// `curve_owner_id` (group separation per L-102-5).
    #[test]
    fn cleave_preserves_curve_metadata() {
        use crate::curves::AnalyticCurve;

        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let _b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);

        // Decorate a's first outer edge with a Line curve + owner_id.
        let a_edges = mesh.face_outer_edges(a).unwrap();
        let owner_pre = mesh.next_curve_owner_id();
        let edge0 = &mesh.edges[a_edges[0]];
        let line_curve = AnalyticCurve::Line {
            start: edge0.v_small(),
            end:   edge0.v_large(),
        };
        mesh.edges[a_edges[0]].set_curve(Some(line_curve.clone()));
        mesh.set_edge_curve_owner_id(a_edges[0], Some(owner_pre));

        let siblings = mesh.collect_coplanar_siblings(a).unwrap();
        let result = mesh.cleave_face_from_siblings(a, &siblings).unwrap();

        // New face's first edge must carry the same curve variant
        // (Line) and a *new* owner_id (group separation).
        let new_edges = mesh.face_outer_edges(result.new_face_id).unwrap();
        assert_eq!(new_edges.len(), 4);

        // Find which new edge corresponds to the old [v0 → v1] edge —
        // it's the one between new_verts[0] and new_verts[1].
        // (collect_loop_verts returns verts in next() walk order, so
        // edge i is between v[i] and v[(i+1) % n] — but starting offset
        // is not guaranteed. Instead, scan all new edges for a Line
        // curve.)
        let line_carriers: Vec<_> = new_edges.iter()
            .filter(|&&e| matches!(
                mesh.edge_curve(e), Some(AnalyticCurve::Line { .. })))
            .collect();
        assert_eq!(line_carriers.len(), 1,
            "exactly one new edge must inherit the Line curve");

        let new_owner = mesh.edge_curve_owner_id(*line_carriers[0])
            .expect("inherited edge must have owner_id");
        assert_ne!(new_owner, owner_pre,
            "L-102-5 group separation: new owner_id ({}) must differ \
             from pre-cleave owner_id ({})", new_owner, owner_pre);
    }

    /// δ-7 — Face invariants preserved post-cleave.
    ///
    /// Verifies `verify_face_invariants()` reports 0 violations after a
    /// cleave operation. Covers I1-I5 (null loop / normal / inner /
    /// HE membership / non-manifold).
    #[test]
    fn cleave_invariants_preserved() {
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let _b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);
        let siblings = mesh.collect_coplanar_siblings(a).unwrap();
        let _result = mesh.cleave_face_from_siblings(a, &siblings).unwrap();

        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-102 L-102-3 + ADR-007 invariants: cleave must \
             preserve all face invariants; got violations: {:?}", report);
    }

    /// δ-8 — Multiple-cleave idempotence guard.
    ///
    /// After a cleave separates source from siblings, a second call to
    /// `collect_coplanar_siblings` on the new source face must return
    /// an empty list (no remaining adjacency). Validates that cleave
    /// is a *fixed point* — Push/Pull → cleave → no further work.
    #[test]
    fn cleave_is_fixed_point_no_residual_siblings() {
        let mut mesh = Mesh::default();
        let a = unit_square_at(&mut mesh, 0.0, 0.0, 0.0, 1.0, 1.0);
        let _b = unit_square_at(&mut mesh, 0.0, 1.0, 0.0, 2.0, 1.0);
        let siblings1 = mesh.collect_coplanar_siblings(a).unwrap();
        assert_eq!(siblings1.len(), 1);

        let result = mesh.cleave_face_from_siblings(a, &siblings1).unwrap();

        // Critical: post-cleave the new source face has ZERO coplanar
        // siblings (cleave is a fixed point — repeated call no-op).
        let siblings2 = mesh.collect_coplanar_siblings(result.new_face_id).unwrap();
        assert!(siblings2.is_empty(),
            "L-102-3: cleave is fixed-point — new source must have 0 \
             coplanar siblings; got {:?}", siblings2);
    }
}
