//! Orient Faces — ensure consistent normal direction across the mesh.
//!
//! Uses BFS flood-fill: start from a seed face, traverse adjacent faces
//! via shared edges. If two faces sharing an edge have half-edges pointing
//! in the SAME direction (instead of opposite), one face is flipped.
//!
//! This is equivalent to SketchUp's "Orient Faces" feature.

use std::collections::{HashSet, VecDeque};
use anyhow::Result;

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
    pub(crate) fn flip_face(&mut self, face_id: FaceId) -> Result<()> {
        // Negate stored normal
        let normal = self.faces[face_id].normal();
        self.faces[face_id].set_normal(-normal);

        // Reverse the half-edge loop direction
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;

        // Swap next/prev for each half-edge, and swap dst vertices
        // For a loop A→B→C→D, we want D→C→B→A
        // Each HE's next becomes its prev, and prev becomes next
        for &he_id in &hes {
            let old_next = self.hes[he_id].next();
            let old_prev = self.hes[he_id].prev();
            self.hes[he_id].set_next(old_prev);
            self.hes[he_id].set_prev(old_next);
        }

        // Also need to update dst vertices:
        // In original loop: he[i].dst = boundary[i+1]
        // After reversal: he[i] should point to boundary[i-1]
        // Collect original destinations
        let dsts: Vec<VertId> = hes.iter().map(|&h| self.hes[h].dst()).collect();
        let n = hes.len();
        // After reversing next/prev, he[i]'s prev is old he[i+1]
        // The dst should shift: he[i].dst = old_dst of he[i-1]
        for i in 0..n {
            let prev_idx = if i == 0 { n - 1 } else { i - 1 };
            self.hes[hes[i]].set_dst(dsts[prev_idx]);
        }

        Ok(())
    }

}
