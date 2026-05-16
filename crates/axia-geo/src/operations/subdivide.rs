//! Catmull-Clark subdivision — one smoothing step.
//!
//! Given a closed manifold mesh of arbitrary-gon faces, computes the
//! classical Catmull-Clark smoothing: for each face emit a face point
//! (centroid), for each edge emit an edge point (weighted average of
//! edge endpoints and adjacent face points), and reposition each
//! original vertex by the (F + 2R + (n-3)V) / n rule. The original
//! topology is torn down and replaced with quads — every resulting
//! face has exactly 4 vertices.
//!
//! ## Limitations (MVP)
//!
//! - Closed manifold input only: every edge must be shared by exactly
//!   two faces. Boundary edges (edge on the mesh border, used by only
//!   one face) are detected and rejected. A future version can adopt
//!   the standard boundary rules (edge_point = midpoint, vertex_point
//!   uses only adjacent edge midpoints).
//! - Runs on the whole mesh, not a face-selection subset. Partial
//!   subdivision (hole-aware) is a future upgrade.
//! - Holes (inner loops) on source faces are not handled — the
//!   primary organic-modeling use cases are already past the hole
//!   stage. Faces with holes are rejected.

use std::collections::HashMap;

use anyhow::{Result, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;

impl Mesh {
    /// Apply one level of Catmull-Clark subdivision to the whole mesh.
    /// Returns the total count of new faces (all quads).
    pub fn subdivide_catmull_clark(&mut self) -> Result<usize> {
        // Snapshot active face and edge sets so later mutation doesn't
        // affect our traversal bookkeeping.
        let active_faces: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();
        ensure!(!active_faces.is_empty(), "subdivide: mesh is empty");

        // ─── Pass 1: validate topology + collect face vertex lists ──
        let mut face_verts: HashMap<FaceId, Vec<VertId>> = HashMap::new();
        let mut face_material: HashMap<FaceId, MaterialId> = HashMap::new();
        for &fid in &active_faces {
            ensure!(
                self.faces[fid].inners().is_empty(),
                "subdivide: face {} has holes — not supported yet",
                fid.raw(),
            );
            let verts = self.collect_loop_verts(self.faces[fid].outer().start)?;
            ensure!(verts.len() >= 3,
                "subdivide: face {} has {} verts (< 3)", fid.raw(), verts.len());
            face_material.insert(fid, self.faces[fid].material());
            face_verts.insert(fid, verts);
        }

        // edge → (v_small, v_large, face_ids[])
        let active_edges: Vec<EdgeId> = self.edges.iter()
            .filter(|(_, e)| e.is_active())
            .map(|(id, _)| id)
            .collect();
        let mut edge_data: HashMap<EdgeId, (VertId, VertId, Vec<FaceId>)> = HashMap::new();
        for &eid in &active_edges {
            let edge = &self.edges[eid];
            let v0 = edge.v_small();
            let v1 = edge.v_large();
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let active_fs: Vec<FaceId> = faces.into_iter()
                .filter(|&f| self.faces.contains(f) && self.faces[f].is_active())
                .collect();
            // Catmull-Clark (MVP) requires manifold closed mesh → every edge
            // shared by exactly two faces.
            ensure!(
                active_fs.len() == 2,
                "subdivide: edge {} shared by {} faces (closed manifold required)",
                eid.raw(), active_fs.len(),
            );
            edge_data.insert(eid, (v0, v1, active_fs));
        }

        // ─── Pass 2: face points (centroids) ──────────────────────
        let face_points: HashMap<FaceId, DVec3> = face_verts.iter()
            .map(|(&fid, verts)| {
                let mut sum = DVec3::ZERO;
                for &v in verts {
                    sum += self.vertex_pos(v).unwrap_or(DVec3::ZERO);
                }
                (fid, sum / verts.len() as f64)
            })
            .collect();

        // ─── Pass 3: edge points ──────────────────────────────────
        // edge_point = (v0 + v1 + fp0 + fp1) / 4
        let edge_points: HashMap<EdgeId, DVec3> = edge_data.iter()
            .map(|(&eid, (v0, v1, faces))| {
                let p0 = self.vertex_pos(*v0).unwrap_or(DVec3::ZERO);
                let p1 = self.vertex_pos(*v1).unwrap_or(DVec3::ZERO);
                let fp0 = face_points[&faces[0]];
                let fp1 = face_points[&faces[1]];
                (eid, (p0 + p1 + fp0 + fp1) / 4.0)
            })
            .collect();

        // ─── Pass 4: new positions for original vertices ──────────
        // Build per-vertex incidence: which faces and edges touch v.
        let mut v_faces: HashMap<VertId, Vec<FaceId>> = HashMap::new();
        let mut v_edges: HashMap<VertId, Vec<EdgeId>> = HashMap::new();
        for (&fid, verts) in &face_verts {
            for &v in verts {
                v_faces.entry(v).or_default().push(fid);
            }
        }
        for (&eid, (v0, v1, _)) in &edge_data {
            v_edges.entry(*v0).or_default().push(eid);
            v_edges.entry(*v1).or_default().push(eid);
        }

        // new V = (F + 2R + (n-3)V) / n
        // where F = avg of face points of faces touching V
        //       R = avg of edge midpoints of edges touching V
        //       n = valence (# incident edges)
        let mut new_vert_pos: HashMap<VertId, DVec3> = HashMap::new();
        for (&v, eids) in &v_edges {
            let fids = v_faces.get(&v).cloned().unwrap_or_default();
            if fids.is_empty() { continue; }
            let n = eids.len() as f64;
            let f_avg: DVec3 = fids.iter().map(|f| face_points[f]).sum::<DVec3>()
                / fids.len() as f64;
            let r_avg: DVec3 = eids.iter().map(|e| {
                let (v0, v1, _) = &edge_data[e];
                let p0 = self.vertex_pos(*v0).unwrap_or(DVec3::ZERO);
                let p1 = self.vertex_pos(*v1).unwrap_or(DVec3::ZERO);
                (p0 + p1) / 2.0
            }).sum::<DVec3>() / n;
            let v_pos = self.vertex_pos(v).unwrap_or(DVec3::ZERO);
            let new_pos = (f_avg + 2.0 * r_avg + (n - 3.0) * v_pos) / n;
            new_vert_pos.insert(v, new_pos);
        }

        // ─── Pass 5: materialize new vertices ─────────────────────
        let mut face_point_vid: HashMap<FaceId, VertId> = HashMap::new();
        for (&fid, &pos) in &face_points {
            face_point_vid.insert(fid, self.add_vertex(pos));
        }
        let mut edge_point_vid: HashMap<EdgeId, VertId> = HashMap::new();
        for (&eid, &pos) in &edge_points {
            edge_point_vid.insert(eid, self.add_vertex(pos));
        }

        // Update original vertex positions in place.
        for (&v, &new_pos) in &new_vert_pos {
            if let Some(vert) = self.verts.get_mut(v) {
                vert.set_pos(new_pos);
            }
        }

        // ─── Pass 6: tear down old faces ─────────────────────────
        // remove_face disconnects HEs on this face (face→NULL, next/prev
        // →NULL) but leaves the underlying edges/HEs in storage. They'll
        // be re-wired by `add_face_with_holes` below when it encounters
        // the same edge again, or become orphan. We sweep orphan edges
        // at the very end.
        for &fid in &active_faces {
            let _ = self.remove_face(fid);
            if self.faces.contains(fid) {
                self.faces.remove(fid);
            }
        }

        // ─── Pass 6.5: build vert-pair → EdgeId index ──────────────
        // Pass 7 needs to look up "the edge between two specific vertices"
        // N times per face. A linear scan through edge_data was O(E) per
        // lookup → O(F·E) overall, which becomes O(F²) on typical manifold
        // meshes and dominates the whole subdivision pass. Keying on an
        // ORDER-INDEPENDENT pair (min, max) gives O(1) lookups.
        let mut edge_by_pair: HashMap<(VertId, VertId), EdgeId> =
            HashMap::with_capacity(edge_data.len());
        for (&eid, (v0, v1, _)) in &edge_data {
            let key = if v0.raw() <= v1.raw() { (*v0, *v1) } else { (*v1, *v0) };
            edge_by_pair.insert(key, eid);
        }
        let edge_between = |a: VertId, b: VertId| -> Option<EdgeId> {
            let key = if a.raw() <= b.raw() { (a, b) } else { (b, a) };
            edge_by_pair.get(&key).copied()
        };

        // ─── Pass 7: build new quads ─────────────────────────────
        // For each original face F with verts [v_0, v_1, ..., v_{N-1}]:
        //   For i in 0..N create a quad [v_i, ep(e_i), fp, ep(e_{i-1})]
        //   where e_i is the edge between v_i and v_{i+1},
        //         e_{i-1} is the edge between v_{i-1} and v_i.
        let mut new_face_count = 0usize;
        for &fid in &active_faces {
            let verts = &face_verts[&fid];
            let material = face_material[&fid];
            let fp = face_point_vid[&fid];
            let n = verts.len();
            for i in 0..n {
                let v_curr = verts[i];
                let v_prev = verts[(i + n - 1) % n];
                let v_next = verts[(i + 1) % n];
                let e_curr = edge_between(v_curr, v_next)
                    .ok_or_else(|| anyhow::anyhow!("subdivide: missing edge in face"))?;
                let e_prev = edge_between(v_prev, v_curr)
                    .ok_or_else(|| anyhow::anyhow!("subdivide: missing edge in face"))?;
                let ep_curr = edge_point_vid[&e_curr];
                let ep_prev = edge_point_vid[&e_prev];
                // Winding preserved: v_curr → ep_curr → fp → ep_prev
                let quad = [v_curr, ep_curr, fp, ep_prev];
                let new_fid = self.add_face_with_holes(&quad, &[], material)?;
                let _ = new_fid;
                new_face_count += 1;
            }
        }

        // ─── Pass 8: sweep orphan edges ────────────────────────────
        // Every original edge was logically replaced by two new edges
        // (v_i ↔ edge_point and edge_point ↔ v_{i+1}) that the new
        // quads wire up. The original edge itself is no longer part of
        // any active face; drop it along with isolated vertices.
        let all_edges: Vec<EdgeId> = self.edges.iter()
            .map(|(id, _)| id)
            .collect();
        for eid in all_edges {
            if !self.edges.contains(eid) { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let has_active_face = faces.iter().any(|&f|
                self.faces.contains(f) && self.faces[f].is_active());
            if !has_active_face {
                let _ = self.remove_edge_and_halfedges(eid);
                if self.edges.contains(eid) {
                    self.edges.remove(eid);
                }
            }
        }
        self.remove_isolated_verts();

        self.debug_verify_invariants();
        Ok(new_face_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tetrahedron (4 triangular faces) subdivided once:
    /// - 4 original faces × 3 verts = 12 new quads
    /// - New vertex count: 4 original + 4 face points + 6 edge points = 14
    #[test]
    fn subdivide_tetrahedron_produces_12_quads() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new( 0.0, 0.0,  1.0));
        let v1 = m.add_vertex(DVec3::new( 1.0, 0.0, -0.5));
        let v2 = m.add_vertex(DVec3::new(-1.0, 0.0, -0.5));
        let v3 = m.add_vertex(DVec3::new( 0.0, 1.5,  0.0));
        // 4 triangular faces (CCW viewed from outside)
        m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        m.add_face_with_holes(&[v0, v3, v1], &[], mat).unwrap();
        m.add_face_with_holes(&[v1, v3, v2], &[], mat).unwrap();
        m.add_face_with_holes(&[v2, v3, v0], &[], mat).unwrap();

        let new_count = m.subdivide_catmull_clark().unwrap();
        assert_eq!(new_count, 12, "tetrahedron → 12 quads after one subdiv");
        // Every active face is a quad
        for (_, face) in m.faces.iter() {
            if !face.is_active() { continue; }
            let verts = m.collect_loop_verts(face.outer().start).unwrap();
            assert_eq!(verts.len(), 4, "subdivided face should be a quad");
        }
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after tetrahedron subdiv:\n{}", report.summary());
    }

    /// A cube (6 quad faces) subdivided once gives 24 quads.
    #[test]
    fn subdivide_cube_produces_24_quads() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Cube vertices
        let v000 = m.add_vertex(DVec3::new( 0.0, 0.0, 0.0));
        let v100 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v110 = m.add_vertex(DVec3::new(10.0,10.0, 0.0));
        let v010 = m.add_vertex(DVec3::new( 0.0,10.0, 0.0));
        let v001 = m.add_vertex(DVec3::new( 0.0, 0.0,10.0));
        let v101 = m.add_vertex(DVec3::new(10.0, 0.0,10.0));
        let v111 = m.add_vertex(DVec3::new(10.0,10.0,10.0));
        let v011 = m.add_vertex(DVec3::new( 0.0,10.0,10.0));
        // 6 quad faces (CCW from outside)
        m.add_face_with_holes(&[v000, v010, v110, v100], &[], mat).unwrap(); // bottom (-Z)
        m.add_face_with_holes(&[v001, v101, v111, v011], &[], mat).unwrap(); // top (+Z)
        m.add_face_with_holes(&[v000, v100, v101, v001], &[], mat).unwrap(); // front (-Y)
        m.add_face_with_holes(&[v010, v011, v111, v110], &[], mat).unwrap(); // back (+Y)
        m.add_face_with_holes(&[v000, v001, v011, v010], &[], mat).unwrap(); // left (-X)
        m.add_face_with_holes(&[v100, v110, v111, v101], &[], mat).unwrap(); // right (+X)

        let new_count = m.subdivide_catmull_clark().unwrap();
        assert_eq!(new_count, 24, "cube → 24 quads after one subdiv");
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after cube subdiv:\n{}", report.summary());
    }

    #[test]
    fn subdivide_rejects_empty_mesh() {
        let mut m = Mesh::new();
        assert!(m.subdivide_catmull_clark().is_err());
    }

    /// Two consecutive subdivision passes on a cube: 6 → 24 → 96 quads.
    /// Exercises the lookup index under a larger face/edge set and
    /// guards the O(F) edge-lookup path against regressions (the old
    /// linear scan made a 96-quad pass noticeably slow even in tests).
    #[test]
    fn subdivide_cube_twice_scales() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v000 = m.add_vertex(DVec3::new( 0.0, 0.0, 0.0));
        let v100 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v110 = m.add_vertex(DVec3::new(10.0,10.0, 0.0));
        let v010 = m.add_vertex(DVec3::new( 0.0,10.0, 0.0));
        let v001 = m.add_vertex(DVec3::new( 0.0, 0.0,10.0));
        let v101 = m.add_vertex(DVec3::new(10.0, 0.0,10.0));
        let v111 = m.add_vertex(DVec3::new(10.0,10.0,10.0));
        let v011 = m.add_vertex(DVec3::new( 0.0,10.0,10.0));
        m.add_face_with_holes(&[v000, v010, v110, v100], &[], mat).unwrap();
        m.add_face_with_holes(&[v001, v101, v111, v011], &[], mat).unwrap();
        m.add_face_with_holes(&[v000, v100, v101, v001], &[], mat).unwrap();
        m.add_face_with_holes(&[v010, v011, v111, v110], &[], mat).unwrap();
        m.add_face_with_holes(&[v000, v001, v011, v010], &[], mat).unwrap();
        m.add_face_with_holes(&[v100, v110, v111, v101], &[], mat).unwrap();

        let c1 = m.subdivide_catmull_clark().unwrap();
        assert_eq!(c1, 24);
        let c2 = m.subdivide_catmull_clark().unwrap();
        assert_eq!(c2, 96, "second pass on 24-quad mesh should produce 24×4 = 96 quads");
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after 2× subdiv:\n{}", report.summary());
    }
}
