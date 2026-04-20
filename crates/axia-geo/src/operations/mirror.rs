//! Mirror operation — reflect selected faces across a plane.
//!
//! Creates an independent mirrored copy of each input face:
//!   - every source vertex reflected across the plane spawns a new vertex
//!   - each face is rebuilt with reversed outer/inner loop order so that
//!     its normal points outward in the mirrored space (ADR-007 winding)
//!   - material, holes, and face count are preserved 1:1
//!
//! No auto-welding on the mirror plane is performed; callers that need a
//! single seamless object can follow up with `merge_coplanar_faces` or
//! explicit vertex welding once we add one. This keeps the operation
//! composable and side-effect-free on the source geometry.

use std::collections::HashMap;

use anyhow::{Result, bail, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;
use crate::tolerances::EPSILON_LENGTH;

impl Mesh {
    /// Reflect `face_ids` across the plane defined by `plane_origin` and
    /// `plane_normal`, creating new mirrored faces (the originals are
    /// untouched). Returns the new FaceIds in the same order as input.
    pub fn mirror_faces(
        &mut self,
        face_ids: &[FaceId],
        plane_origin: DVec3,
        plane_normal: DVec3,
    ) -> Result<Vec<FaceId>> {
        // ─── Validity guards (ADR-003) ─────────────────────────────
        ensure!(
            plane_origin.x.is_finite() && plane_origin.y.is_finite() && plane_origin.z.is_finite(),
            "mirror: plane origin must be finite, got {:?}", plane_origin,
        );
        ensure!(
            plane_normal.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "mirror: plane normal must be a non-zero vector",
        );
        for &fid in face_ids {
            if !self.faces.contains(fid) {
                bail!("mirror: face {:?} not found", fid);
            }
            if !self.faces[fid].is_active() {
                bail!("mirror: face {:?} is inactive", fid);
            }
        }
        if face_ids.is_empty() {
            return Ok(Vec::new());
        }

        let n = plane_normal.normalize();
        let reflect = |p: DVec3| -> DVec3 {
            p - 2.0 * (p - plane_origin).dot(n) * n
        };

        // ─── Collect source vertices and allocate mirrored copies ──
        // Previously this was two passes (HashSet for dedup, then a
        // separate HashMap build). Merging them avoids a full extra
        // iteration over every source vertex and an intermediate
        // HashSet allocation.
        //
        // Multiple faces share vertices along common edges; we want
        // exactly one mirrored vertex per source vertex so shared
        // edges stay shared in the mirrored copy — hence the
        // `or_insert_with` on `vert_map` acts as both the
        // deduplication and the allocation step in one pass.
        let mut vert_map: HashMap<VertId, VertId> = HashMap::new();
        let mut scratch_loops: Vec<Vec<VertId>> = Vec::new();
        for &fid in face_ids {
            let outer = self.faces[fid].outer().start;
            scratch_loops.push(self.collect_loop_verts(outer)?);
            let inners: Vec<_> = self.faces[fid].inners().to_vec();
            for inner in inners {
                scratch_loops.push(self.collect_loop_verts(inner.start)?);
            }
        }
        for loop_verts in &scratch_loops {
            for &src in loop_verts {
                if !vert_map.contains_key(&src) {
                    let p = self.vertex_pos(src)?;
                    let new_v = self.add_vertex(reflect(p));
                    vert_map.insert(src, new_v);
                }
            }
        }

        // ─── Rebuild each face in the mirrored space ──────────────
        // Reflection inverts handedness, so the natural CCW walk of the
        // original outer loop becomes CW when viewed from the mirrored
        // side's "outside". We reverse the vertex list so the rebuilt
        // face is CCW from its own outside, preserving ADR-007 winding.
        let mut new_faces = Vec::with_capacity(face_ids.len());
        for &src_fid in face_ids {
            let material = self.faces[src_fid].material();
            let outer_start = self.faces[src_fid].outer().start;
            let inner_refs: Vec<_> = self.faces[src_fid].inners().to_vec();

            let src_outer = self.collect_loop_verts(outer_start)?;
            let mut mirrored_outer: Vec<VertId> = src_outer.iter()
                .map(|v| *vert_map.get(v)
                    .expect("mirror: source vertex missing from map"))
                .collect();
            mirrored_outer.reverse();

            let mut mirrored_inners: Vec<Vec<VertId>> = Vec::with_capacity(inner_refs.len());
            for inner in inner_refs {
                let src_inner = self.collect_loop_verts(inner.start)?;
                let mut rev: Vec<VertId> = src_inner.iter()
                    .map(|v| *vert_map.get(v).expect("mirror: inner vert missing"))
                    .collect();
                rev.reverse();
                mirrored_inners.push(rev);
            }
            let inner_slices: Vec<&[VertId]> = mirrored_inners.iter()
                .map(|v| v.as_slice())
                .collect();

            let new_fid = self.add_face_with_holes(&mirrored_outer, &inner_slices, material)?;
            new_faces.push(new_fid);
        }

        // ADR-007 — catch any orientation/topology issue immediately
        self.debug_verify_invariants();

        Ok(new_faces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Single triangle mirrored across YZ plane (x = 0).
    #[test]
    fn mirror_triangle_across_yz() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(100.0, 0.0,   0.0));
        let v1 = m.add_vertex(DVec3::new(200.0, 0.0,   0.0));
        let v2 = m.add_vertex(DVec3::new(150.0, 100.0, 0.0));
        let src = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();

        let new_faces = m.mirror_faces(
            &[src],
            DVec3::ZERO,
            DVec3::X,
        ).unwrap();
        assert_eq!(new_faces.len(), 1);
        assert!(m.faces[new_faces[0]].is_active());

        // Mirrored vertices have negated x
        let verts = m.collect_loop_verts(m.faces[new_faces[0]].outer().start).unwrap();
        let positions: Vec<DVec3> = verts.iter()
            .map(|&v| m.vertex_pos(v).unwrap())
            .collect();
        for p in &positions {
            assert!(p.x < 0.0, "mirrored vertex should have x < 0, got {:?}", p);
        }
    }

    /// After mirroring, the new face's computed normal is the reflection
    /// of the source's normal — i.e. the mirrored face points outward
    /// from its own side (ADR-007 invariant).
    #[test]
    fn mirror_preserves_outward_orientation() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // CCW on z=0 plane with +z normal
        let v0 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(15.0, 5.0, 0.0));
        let src = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        let src_normal = m.faces[src].normal();
        assert!(src_normal.z > 0.5, "baseline sanity: source normal should be +z, got {:?}", src_normal);

        // Mirror across YZ plane (x=0). The mirrored normal should still
        // be +z (mirror across YZ negates x component only).
        let new_f = m.mirror_faces(&[src], DVec3::ZERO, DVec3::X).unwrap();
        let n2 = m.faces[new_f[0]].normal();
        assert!(n2.z > 0.5,
            "mirrored face normal should still point +z, got {:?}", n2);

        // Mirror across XY plane (z=0). Now the mirrored normal should
        // be -z (z component negated).
        let new_f2 = m.mirror_faces(&[src], DVec3::ZERO, DVec3::Z).unwrap();
        let n3 = m.faces[new_f2[0]].normal();
        assert!(n3.z < -0.5,
            "mirror across XY should flip normal to -z, got {:?}", n3);
    }

    /// Mirroring multiple faces that share a vertex preserves the
    /// vertex sharing in the mirrored copy (shared edges stay shared).
    #[test]
    fn mirror_preserves_shared_edges() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Two triangles sharing edge v0-v1
        let v0 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(15.0, 5.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(15.0, -5.0, 0.0));
        let f1 = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        let f2 = m.add_face_with_holes(&[v1, v0, v3], &[], mat).unwrap();

        let new_faces = m.mirror_faces(&[f1, f2], DVec3::ZERO, DVec3::X).unwrap();
        assert_eq!(new_faces.len(), 2);

        // The two new faces should share an edge — find it via shared verts
        let verts_a: HashSet<VertId> = m.collect_loop_verts(
            m.faces[new_faces[0]].outer().start).unwrap().into_iter().collect();
        let verts_b: HashSet<VertId> = m.collect_loop_verts(
            m.faces[new_faces[1]].outer().start).unwrap().into_iter().collect();
        let shared = verts_a.intersection(&verts_b).count();
        assert_eq!(shared, 2, "mirrored faces should share 2 verts (one edge)");
    }

    #[test]
    fn mirror_rejects_zero_normal() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(15.0, 5.0, 0.0));
        let f = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        let err = m.mirror_faces(&[f], DVec3::ZERO, DVec3::ZERO);
        assert!(err.is_err());
    }

    #[test]
    fn mirror_face_with_hole_preserves_hole() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Outer 100x100 at z=0
        let o0 = m.add_vertex(DVec3::new( 10.0, 0.0, -50.0));
        let o1 = m.add_vertex(DVec3::new(110.0, 0.0, -50.0));
        let o2 = m.add_vertex(DVec3::new(110.0, 0.0,  50.0));
        let o3 = m.add_vertex(DVec3::new( 10.0, 0.0,  50.0));
        // Hole 20x20
        let h0 = m.add_vertex(DVec3::new(50.0, 0.0, -10.0));
        let h1 = m.add_vertex(DVec3::new(50.0, 0.0,  10.0));
        let h2 = m.add_vertex(DVec3::new(70.0, 0.0,  10.0));
        let h3 = m.add_vertex(DVec3::new(70.0, 0.0, -10.0));
        let f = m.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[h0, h1, h2, h3]],
            mat,
        ).unwrap();

        let new_f = m.mirror_faces(&[f], DVec3::ZERO, DVec3::X).unwrap();
        assert_eq!(m.faces[new_f[0]].inners().len(), 1,
            "hole should survive the mirror");
        let inner_start = m.faces[new_f[0]].inners()[0].start;
        let hole_verts = m.collect_loop_verts(inner_start).unwrap();
        assert_eq!(hole_verts.len(), 4, "hole should still have 4 verts");
    }
}
