//! Topology repair — detect and fix non-manifold edges and orphan
//! topology produced by upstream operations that did not carefully
//! deduplicate / detach vertices.
//!
//! ADR-007 invariant I5 mandates "edge ≤ 2 active faces". When a tool
//! merges two solids (Boolean), auto-intersects geometry on draw, or
//! restores a snapshot from a buggy older build, we can end up with
//! 3-or-4 face edges. This module provides:
//!
//! * `find_non_manifold_edges` — scan & report
//! * `detach_face_groups` — duplicate verts shared between two face
//!   groups so they end up topologically independent (the same
//!   primitive Slice uses internally to separate the below half)
//! * `Mesh::repair_non_manifold_edges_geometric` — best-effort repair
//!   driven solely by edge-count + face-id ordering. Caller code with
//!   XIA awareness (Scene) should prefer XIA-grouped repair.

use anyhow::Result;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{FaceId, EdgeId, VertId};
use crate::mesh::Mesh;

/// Per-edge non-manifold report entry.
#[derive(Debug, Clone)]
pub struct NonManifoldEdge {
    pub edge: EdgeId,
    pub faces: Vec<FaceId>,
}

#[derive(Debug, Default, Clone)]
pub struct RepairReport {
    pub edges_examined: usize,
    pub edges_repaired: usize,
    /// Edges that could not be auto-repaired with the chosen strategy.
    pub edges_skipped: Vec<(EdgeId, String)>,
    pub faces_detached: usize,
    pub vertices_created: usize,
}

impl RepairReport {
    pub fn is_clean(&self) -> bool {
        self.edges_skipped.is_empty()
    }
    pub fn summary(&self) -> String {
        format!(
            "examined {} edges, repaired {}, skipped {}, faces detached {}, verts created {}",
            self.edges_examined, self.edges_repaired,
            self.edges_skipped.len(), self.faces_detached, self.vertices_created,
        )
    }
}

impl Mesh {
    /// Find every active edge with > 2 active incident faces.
    pub fn find_non_manifold_edges(&self) -> Vec<NonManifoldEdge> {
        let mut out = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            if faces.len() > 2 {
                out.push(NonManifoldEdge { edge: eid, faces });
            }
        }
        out
    }

    /// Topologically separate `group_b` from `group_a` by duplicating
    /// every vertex shared between the two groups. Each face in
    /// `group_b` is removed and re-added with the duplicated verts
    /// substituted in its outer loop.
    ///
    /// Returns the mapping of old → new face IDs for `group_b` and the
    /// number of vertices created.
    pub fn detach_face_groups(
        &mut self,
        group_a: &[FaceId],
        group_b: &[FaceId],
    ) -> Result<(Vec<(FaceId, FaceId)>, usize)> {
        // Collect verts in each group.
        let mut verts_a: FxHashSet<VertId> = FxHashSet::default();
        for &f in group_a {
            if !self.faces.contains(f) || !self.faces[f].is_active() { continue; }
            let outer = self.faces[f].outer().start;
            for v in self.collect_loop_verts(outer)? {
                verts_a.insert(v);
            }
        }

        // Walk group_b's loops, finding which verts are shared with A.
        let mut verts_b_seen: FxHashSet<VertId> = FxHashSet::default();
        for &f in group_b {
            if !self.faces.contains(f) || !self.faces[f].is_active() { continue; }
            let outer = self.faces[f].outer().start;
            for v in self.collect_loop_verts(outer)? {
                verts_b_seen.insert(v);
            }
        }

        // Shared verts = intersection.
        let shared: Vec<VertId> = verts_a.intersection(&verts_b_seen).copied().collect();

        // Duplicate.
        let mut dup: FxHashMap<VertId, VertId> = FxHashMap::default();
        for v in shared {
            let p = self.verts.get(v).map(|x| x.pos())
                .ok_or_else(|| anyhow::anyhow!("detach: vert {:?} disappeared", v))?;
            let v2 = self.add_vertex_force_new(p);
            dup.insert(v, v2);
        }
        let verts_created = dup.len();

        // Rebuild each face in B with substitution.
        let mut mapping: Vec<(FaceId, FaceId)> = Vec::new();
        for &fid in group_b {
            if !self.faces.contains(fid) || !self.faces[fid].is_active() { continue; }
            let outer = self.faces[fid].outer().start;
            let loop_verts = self.collect_loop_verts(outer)?;
            let mat = self.faces[fid].material();
            let substituted: Vec<VertId> = loop_verts.iter()
                .map(|&v| dup.get(&v).copied().unwrap_or(v))
                .collect();
            // Skip if substitution is no-op (no shared verts on this loop).
            let touched = loop_verts.iter().any(|v| dup.contains_key(v));
            if !touched {
                mapping.push((fid, fid));
                continue;
            }
            self.remove_face(fid)?;
            let new_fid = self.add_face(&substituted, mat)?;
            mapping.push((fid, new_fid));
        }

        Ok((mapping, verts_created))
    }

    /// Best-effort geometric repair of non-manifold edges.
    ///
    /// Strategy: For each non-manifold edge with N>2 active faces, sort
    /// faces by id, keep `faces[0..2]` on the original edge, and detach
    /// each of `faces[2..]` from `faces[0..2]` using `detach_face_groups`
    /// (one face at a time so the kept-set grows as repair proceeds).
    ///
    /// This is purely topological — it doesn't try to identify which
    /// faces "belong together" semantically. Scene-level repair with XIA
    /// awareness should be preferred when callers have that context.
    pub fn repair_non_manifold_edges_geometric(&mut self) -> RepairReport {
        let mut report = RepairReport::default();
        let bad = self.find_non_manifold_edges();
        report.edges_examined = bad.len();

        for nm in bad {
            // Re-fetch — earlier repairs may have changed this edge's
            // incident face count.
            if !self.edges.contains(nm.edge) || !self.edges[nm.edge].is_active() {
                continue;
            }
            let (cur_faces, _) = self.get_faces_sharing_edge(nm.edge);
            if cur_faces.len() <= 2 {
                // Already cleaned up by an earlier detach.
                continue;
            }
            let mut faces_sorted = cur_faces.clone();
            faces_sorted.sort_by_key(|f| f.raw());
            let keep: Vec<FaceId> = faces_sorted[0..2].to_vec();
            let extras: Vec<FaceId> = faces_sorted[2..].to_vec();

            // Detach extras from keep — one at a time so we don't accidentally
            // detach extras from each other when they happen to share verts.
            let mut all_ok = true;
            for &extra in &extras {
                match self.detach_face_groups(&keep, &[extra]) {
                    Ok((mapping, n_verts)) => {
                        report.faces_detached += 1;
                        report.vertices_created += n_verts;
                        // detach may have re-id'd `extra`; update keep set
                        // membership too (extras list is by old ids — that's
                        // fine because we walk it linearly and don't re-use
                        // these ids after detach).
                        let _ = mapping;
                    }
                    Err(e) => {
                        report.edges_skipped.push((nm.edge,
                            format!("detach failed: {}", e)));
                        all_ok = false;
                        break;
                    }
                }
            }
            if all_ok {
                report.edges_repaired += 1;
            }
        }

        // Refresh cached normals from new windings.
        let _ = self.reconcile_face_normals();
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;
    use glam::DVec3;

    /// Construct two cubes that share a face exactly — produces 4-face
    /// edges along the shared rectangle's boundary.
    fn two_cubes_touching(mesh: &mut Mesh, m: MaterialId) -> Vec<FaceId> {
        // Cube A: x ∈ [0, 1], y ∈ [0, 1], z ∈ [0, 1]
        let a000 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let a100 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let a110 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let a010 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let a001 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let a101 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));
        let a111 = mesh.add_vertex(DVec3::new(1.0, 1.0, 1.0));
        let a011 = mesh.add_vertex(DVec3::new(0.0, 1.0, 1.0));
        let af0 = mesh.add_face(&[a000, a010, a110, a100], m).unwrap();
        let af1 = mesh.add_face(&[a001, a101, a111, a011], m).unwrap();
        let af2 = mesh.add_face(&[a000, a100, a101, a001], m).unwrap();
        let af3 = mesh.add_face(&[a010, a011, a111, a110], m).unwrap();
        let af4 = mesh.add_face(&[a000, a001, a011, a010], m).unwrap();
        let af5 = mesh.add_face(&[a100, a110, a111, a101], m).unwrap(); // x=1 face

        // Cube B: x ∈ [1, 2] — shares the x=1 face with A's af5.
        // We REUSE A's x=1 verts (a100, a110, a111, a101) so the shared
        // face's edges get 4-face incidence.
        let b200 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let b210 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));
        let b201 = mesh.add_vertex(DVec3::new(2.0, 0.0, 1.0));
        let b211 = mesh.add_vertex(DVec3::new(2.0, 1.0, 1.0));
        let bf0 = mesh.add_face(&[a100, a110, b210, b200], m).unwrap();   // bottom
        let bf1 = mesh.add_face(&[a101, b201, b211, a111], m).unwrap();   // top
        let bf2 = mesh.add_face(&[a100, b200, b201, a101], m).unwrap();   // front
        let bf3 = mesh.add_face(&[a110, a111, b211, b210], m).unwrap();   // back
        let bf4 = mesh.add_face(&[b200, b210, b211, b201], m).unwrap();   // x=2 face
        let bf5 = mesh.add_face(&[a100, a101, a111, a110], m).unwrap();   // x=1 from B (reverse winding)

        vec![af0, af1, af2, af3, af4, af5, bf0, bf1, bf2, bf3, bf4, bf5]
    }

    #[test]
    fn detect_non_manifold_edges_in_touching_cubes() {
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let _ = two_cubes_touching(&mut mesh, m);
        let bad = mesh.find_non_manifold_edges();
        // 4 boundary edges of the shared face, each shared by 4 faces.
        assert_eq!(bad.len(), 4, "expected 4 non-manifold edges, got {}", bad.len());
        for nm in &bad {
            assert_eq!(nm.faces.len(), 4);
        }
    }

    #[test]
    fn repair_non_manifold_edges_clears_violations() {
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let _ = two_cubes_touching(&mut mesh, m);
        assert_eq!(mesh.find_non_manifold_edges().len(), 4);

        let report = mesh.repair_non_manifold_edges_geometric();
        assert!(report.is_clean(), "{}", report.summary());
        assert_eq!(report.edges_repaired, 4);

        let after = mesh.find_non_manifold_edges();
        assert!(after.is_empty(), "still {} non-manifold edges after repair", after.len());

        // ADR-007 I5 invariant should now pass.
        let inv = mesh.verify_face_invariants();
        assert!(inv.is_valid(), "ADR-007 violations after repair:\n{}", inv.summary());
    }

    #[test]
    fn detach_face_groups_basic() {
        // Two adjacent rectangles sharing one edge — detach should give
        // them their own copy of the shared verts.
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));
        let fa = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();
        let fb = mesh.add_face(&[v1, v4, v5, v2], m).unwrap();
        // Edge v1-v2 currently shared by fa and fb (manifold, count = 2).
        let v_count_before = mesh.vert_count();
        let (mapping, n_dup) = mesh.detach_face_groups(&[fa], &[fb]).unwrap();
        // 2 shared verts (v1, v2) duplicated.
        assert_eq!(n_dup, 2);
        assert_eq!(mesh.vert_count(), v_count_before + 2);
        assert_eq!(mapping.len(), 1);
    }
}
