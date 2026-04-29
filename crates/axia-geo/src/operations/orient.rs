//! Orient Faces — ensure consistent normal direction across the mesh.
//!
//! Uses BFS flood-fill: start from a seed face, traverse adjacent faces
//! via shared edges. If two faces sharing an edge have half-edges pointing
//! in the SAME direction (instead of opposite), one face is flipped.
//!
//! This is equivalent to SketchUp's "Orient Faces" feature.

use std::collections::{HashSet, VecDeque};
use anyhow::{Result, ensure};

use crate::entities::id::*;
use crate::mesh::Mesh;

/// Result of orient_faces operation.
pub struct OrientResult {
    /// Number of faces that were flipped
    pub flipped: usize,
    /// Total faces visited
    pub visited: usize,
}

impl Mesh {
    /// Orient all faces so normals are consistent.
    ///
    /// Algorithm:
    /// 1. Pick a seed face (the one with the most "outward" normal)
    /// 2. BFS across shared edges
    /// 3. For each neighbor: if shared edge half-edges go in the same
    ///    direction (both v0→v1), the neighbor's winding is inconsistent
    ///    → flip it (reverse boundary + negate normal)
    pub fn orient_faces(&mut self) -> Result<OrientResult> {
        let all_faces: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();

        if all_faces.is_empty() {
            return Ok(OrientResult { flipped: 0, visited: 0 });
        }

        let mut visited: HashSet<FaceId> = HashSet::new();
        let mut flipped: usize = 0;
        let mut total_visited: usize = 0;

        // Process all connected components
        for &seed in &all_faces {
            if visited.contains(&seed) {
                continue;
            }

            // BFS from seed
            let mut queue: VecDeque<FaceId> = VecDeque::new();
            queue.push_back(seed);
            visited.insert(seed);

            while let Some(face_id) = queue.pop_front() {
                total_visited += 1;

                // Get boundary edges
                let _edges = match self.face_outer_edges(face_id) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                // Get boundary vertices to know edge directions
                let boundary = match self.collect_loop_verts(
                    self.faces[face_id].outer().start
                ) {
                    Ok(b) => b,
                    Err(_) => continue,
                };

                // For each edge, find adjacent face
                let n = boundary.len();
                for i in 0..n {
                    let v0 = boundary[i];
                    let v1 = boundary[(i + 1) % n];

                    let edge_id = match self.find_edge(v0, v1) {
                        Some(eid) => eid,
                        None => continue,
                    };

                    // Traverse radial chain to find neighbor face
                    let start_he = self.edges[edge_id].any_he();
                    if start_he.is_null() {
                        continue;
                    }

                    let mut he_id = start_he;
                    loop {
                        let nb_face = self.hes[he_id].face();
                        if !nb_face.is_null()
                            && nb_face != face_id
                            && self.faces.contains(nb_face)
                            && self.faces[nb_face].is_active()
                            && !visited.contains(&nb_face)
                        {
                            // Found unvisited neighbor
                            visited.insert(nb_face);

                            // Check consistency: in the neighbor face,
                            // the shared edge should go v1→v0 (opposite direction).
                            // If it goes v0→v1 (same direction), the neighbor is flipped.
                            let nb_boundary = match self.collect_loop_verts(
                                self.faces[nb_face].outer().start
                            ) {
                                Ok(b) => b,
                                Err(_) => { queue.push_back(nb_face); break; },
                            };

                            let needs_flip = self.check_needs_flip(
                                v0, v1, &nb_boundary
                            );

                            if needs_flip {
                                self.flip_face(nb_face)?;
                                flipped += 1;
                            }

                            queue.push_back(nb_face);
                        }
                        he_id = self.hes[he_id].next_rad();
                        if he_id == start_he {
                            break;
                        }
                    }
                }
            }
        }

        Ok(OrientResult {
            flipped,
            visited: total_visited,
        })
    }

    /// Check if a neighbor face needs to be flipped.
    /// In consistent orientation, if face A has edge v0→v1,
    /// neighbor B should have edge v1→v0 (opposite direction).
    /// If B also has v0→v1, it needs flipping.
    fn check_needs_flip(&self, v0: VertId, v1: VertId, nb_boundary: &[VertId]) -> bool {
        let n = nb_boundary.len();
        for i in 0..n {
            if nb_boundary[i] == v0 && nb_boundary[(i + 1) % n] == v1 {
                // Same direction as the reference face → needs flip
                return true;
            }
            if nb_boundary[i] == v1 && nb_boundary[(i + 1) % n] == v0 {
                // Opposite direction → consistent, no flip needed
                return false;
            }
        }
        false // edge not found in neighbor (shouldn't happen)
    }

    /// Flip a face: reverse boundary winding and negate the stored normal.
    ///
    /// Internal use (Boolean ops / neighbor orientation propagation).
    /// Does NOT validate degeneracy — caller must ensure face is valid.
    /// Reverses both the outer loop and all inner loops (holes) so that
    /// winding remains consistent for faces with holes.
    /// Use `flip_face_safe` for user-triggered commands (adds validation).
    pub(crate) fn flip_face(&mut self, face_id: FaceId) -> Result<()> {
        // Negate stored normal
        let normal = self.faces[face_id].normal();
        self.faces[face_id].set_normal(-normal);

        // Reverse the outer loop
        let outer_start = self.faces[face_id].outer().start;
        self.reverse_loop(outer_start)?;

        // ── B-1 fix: Reverse every inner loop (holes) to keep winding consistent ──
        // Previously only the outer loop was reversed, leaving hole windings inverted
        // relative to the new normal. Boolean Subtract on faces with holes produced
        // corrupt geometry.
        let inner_starts: Vec<HeId> = self.faces[face_id]
            .inners()
            .iter()
            .map(|l| l.start)
            .collect();
        for start in inner_starts {
            if !start.is_null() {
                self.reverse_loop(start)?;
            }
        }

        Ok(())
    }

    /// Reverse a half-edge loop in place.
    /// Swaps next/prev pointers and shifts dst vertices one slot backwards.
    ///
    /// **Manifold-safety (2026-04-29 fix)**: When a loop HE's dst is shifted,
    /// its TWIN HE (on the same edge, opposite direction) must also be updated
    /// to point in the new opposite direction. Otherwise both HEs on the edge
    /// end up with the same dst → 2-manifold invariant violated. This was
    /// the root cause of HE radial corruption observed after Step 4.95
    /// promote in postprocess flow (ADR-021 Limitations §7).
    fn reverse_loop(&mut self, start: HeId) -> Result<()> {
        let hes = self.collect_loop_hes(start)?;
        let n = hes.len();
        if n < 3 {
            // Degenerate loop — nothing useful to reverse
            return Ok(());
        }

        // Swap next/prev for each half-edge
        for &he_id in &hes {
            let old_next = self.hes[he_id].next();
            let old_prev = self.hes[he_id].prev();
            self.hes[he_id].set_next(old_prev);
            self.hes[he_id].set_prev(old_next);
        }

        // Update dst vertices: after reversal, he[i].dst = old dst of he[i-1]
        // AND update the twin's dst to point in the now-opposite direction.
        let dsts: Vec<VertId> = hes.iter().map(|&h| self.hes[h].dst()).collect();
        for i in 0..n {
            let prev_idx = if i == 0 { n - 1 } else { i - 1 };
            let new_dst = dsts[prev_idx];
            // Old loop HE dst before swap (the dst we're moving away from):
            let old_dst = dsts[i];
            // Apply new dst to loop HE
            self.hes[hes[i]].set_dst(new_dst);
            // Twin must now point to the OLD loop HE's dst (= source after
            // reversal). Walk radial chain to find the twin.
            // CRITICAL: only update twin if it's free (face=null). If twin is
            // claimed by another face, we cannot flip its dst without
            // corrupting that face's loop. In multi-shared edge cases this
            // means flip is incomplete on shared edges (caller's responsibility).
            let edge_id = self.hes[hes[i]].edge();
            let any_he = self.edges[edge_id].any_he();
            let mut tw = any_he;
            let mut guard = 0usize;
            loop {
                guard += 1;
                if guard > 16 { break; }
                if tw != hes[i] && self.hes.contains(tw) {
                    // Only update twin if it's free (face=null)
                    if self.hes[tw].face().is_null() {
                        self.hes[tw].set_dst(old_dst);
                    }
                    break;
                }
                tw = self.hes[tw].next_rad();
                if tw == any_he { break; }
            }
        }
        Ok(())
    }

    /// **Public API**: Safely flip a face's orientation.
    ///
    /// Differences from the internal `flip_face`:
    ///  - Validates face existence and non-degeneracy (≥ 3 vertices)
    ///  - Reverses **all** inner loops (holes) in addition to the outer loop
    ///  - Suitable for user-triggered "Reverse Face" commands
    pub fn flip_face_safe(&mut self, face_id: FaceId) -> Result<()> {
        ensure!(self.faces.contains(face_id), "Face {:?} not found", face_id);

        // Degenerate check via outer loop vertex count
        let outer_start = self.faces[face_id].outer().start;
        let verts = self.collect_loop_verts(outer_start)?;
        ensure!(
            verts.len() >= 3,
            "Cannot flip degenerate face {:?} ({} verts)",
            face_id,
            verts.len()
        );

        // Negate stored normal
        let normal = self.faces[face_id].normal();
        self.faces[face_id].set_normal(-normal);

        // Reverse outer loop
        self.reverse_loop(outer_start)?;

        // Reverse every inner loop (holes)
        let inner_starts: Vec<HeId> = self.faces[face_id]
            .inners()
            .iter()
            .map(|l| l.start)
            .collect();
        for start in inner_starts {
            if !start.is_null() {
                self.reverse_loop(start)?;
            }
        }

        // ADR-007 — flip 후 invariants 검증
        self.debug_verify_invariants();

        Ok(())
    }

    /// **Public API**: Flip multiple faces in one go.
    ///
    /// Each face is processed independently; failures on one do not abort the
    /// batch. Returns the count of successfully flipped faces.
    ///
    /// Caller is responsible for wrapping the call in a single undo
    /// transaction if they want a unified rollback point.
    pub fn flip_faces(&mut self, face_ids: &[FaceId]) -> usize {
        let mut flipped = 0usize;
        for &fid in face_ids {
            if self.flip_face_safe(fid).is_ok() {
                flipped += 1;
            }
        }
        flipped
    }
}

#[cfg(test)]
mod flip_tests {
    use super::*;
    use crate::MaterialId;
    use glam::DVec3;

    fn make_square(mesh: &mut Mesh) -> FaceId {
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        mesh.add_face(&[v0, v1, v2, v3], mat).unwrap()
    }

    #[test]
    fn flip_face_safe_inverts_normal() {
        let mut m = Mesh::new();
        let fid = make_square(&mut m);
        let original = m.faces[fid].normal();

        m.flip_face_safe(fid).unwrap();
        let flipped = m.faces[fid].normal();

        // Stored normal should now point the opposite direction
        assert!(flipped.dot(original) < 0.0, "normal should be reversed");
    }

    #[test]
    fn flip_face_safe_reverses_loop_winding() {
        let mut m = Mesh::new();
        let fid = make_square(&mut m);
        let original_verts = m
            .collect_loop_verts(m.faces[fid].outer().start)
            .unwrap();

        m.flip_face_safe(fid).unwrap();

        let reversed_verts = m
            .collect_loop_verts(m.faces[fid].outer().start)
            .unwrap();
        // Reversed loop should contain same vertices in reverse-ish order
        assert_eq!(original_verts.len(), reversed_verts.len());
        // Stored normal must match the new (reversed) loop orientation
        let computed = m.compute_normal(&reversed_verts).unwrap();
        let stored = m.faces[fid].normal();
        assert!(
            computed.dot(stored) > 0.0,
            "stored normal should match computed normal of reversed loop"
        );
    }

    #[test]
    fn flip_twice_restores_original() {
        let mut m = Mesh::new();
        let fid = make_square(&mut m);
        let original_normal = m.faces[fid].normal();

        m.flip_face_safe(fid).unwrap();
        m.flip_face_safe(fid).unwrap();

        let final_normal = m.faces[fid].normal();
        assert!(
            final_normal.dot(original_normal) > 0.9999,
            "two flips should restore normal"
        );
    }

    #[test]
    fn flip_face_safe_rejects_nonexistent_face() {
        let mut m = Mesh::new();
        let r = m.flip_face_safe(FaceId::new(999));
        assert!(r.is_err());
    }

    #[test]
    fn flip_faces_batch_counts_successes() {
        let mut m = Mesh::new();
        let f1 = make_square(&mut m);
        // Second face (offset)
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(14.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(14.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(10.0, 0.0, 4.0));
        let f2 = m.add_face(&[v0, v1, v2, v3], mat).unwrap();

        // Include a bad id — should be silently skipped, others still counted
        let flipped = m.flip_faces(&[f1, FaceId::new(9999), f2]);
        assert_eq!(flipped, 2);
    }

    #[test]
    fn flip_face_on_box_top_reverses_only_that_face() {
        // 박스 생성 후 윗면만 flip → 다른 면은 영향 없어야 함
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let base = m.add_face(&[v0, v3, v2, v1], mat).unwrap();
        let pp = m.push_pull(base, 3.0, mat).unwrap();
        let top = pp.top_face;

        // 원본 노멀 저장
        let orig_top = m.faces[top].normal();
        let orig_others: Vec<(FaceId, glam::DVec3)> = m.faces
            .iter()
            .filter(|(id, f)| *id != top && f.is_active())
            .map(|(id, f)| (id, f.normal()))
            .collect();

        m.flip_face_safe(top).unwrap();

        // 윗면만 뒤집혔는지 확인
        assert!(m.faces[top].normal().dot(orig_top) < 0.0);
        for (id, n_orig) in orig_others {
            let n_now = m.faces[id].normal();
            assert!(
                n_now.dot(n_orig) > 0.9999,
                "face {:?} should not be affected by top flip",
                id
            );
        }
    }
}
