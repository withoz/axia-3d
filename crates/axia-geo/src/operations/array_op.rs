//! Array operations — replicate a face set with a transform.
//!
//! Linear Array copies the selected faces `count` times, each copy
//! translated by a multiple of `offset`. Unlike Mirror (which flips
//! handedness), translation preserves winding, so every copy keeps
//! its outward-facing normal without reversal.
//!
//! Shared-vertex semantics match Mirror: every source vertex produces
//! exactly one new vertex per copy, so shared edges in the source
//! stay shared in each replicated instance.

use std::collections::HashMap;

use anyhow::{Result, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;
use crate::tolerances::EPSILON_LENGTH;

impl Mesh {
    /// Copy `face_ids` `count` times. Copy `k` (k = 1..=count) is
    /// translated by `offset · k` from the source. Returns the new
    /// FaceIds in copy-major, source-order.
    pub fn array_linear_faces(
        &mut self,
        face_ids: &[FaceId],
        count: u32,
        offset: DVec3,
    ) -> Result<Vec<FaceId>> {
        ensure!(count >= 1, "array_linear: count must be ≥ 1, got {}", count);
        ensure!(
            offset.x.is_finite() && offset.y.is_finite() && offset.z.is_finite(),
            "array_linear: offset must be finite",
        );
        ensure!(
            offset.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "array_linear: offset must be non-zero (use copies=1 with zero offset for no-op)",
        );
        for &fid in face_ids {
            if !self.faces.contains(fid) {
                anyhow::bail!("array_linear: face {:?} not found", fid);
            }
            if !self.faces[fid].is_active() {
                anyhow::bail!("array_linear: face {:?} is inactive", fid);
            }
        }
        if face_ids.is_empty() {
            return Ok(Vec::new());
        }

        // ─── Snapshot source loops ────────────────────────────────
        let mut source_outer_loops: Vec<Vec<VertId>> = Vec::with_capacity(face_ids.len());
        let mut source_inner_loops: Vec<Vec<Vec<VertId>>> = Vec::with_capacity(face_ids.len());
        for &fid in face_ids {
            source_outer_loops.push(
                self.collect_loop_verts(self.faces[fid].outer().start)?,
            );
            let inner_refs: Vec<_> = self.faces[fid].inners().to_vec();
            let mut inners: Vec<Vec<VertId>> = Vec::with_capacity(inner_refs.len());
            for inner in inner_refs {
                inners.push(self.collect_loop_verts(inner.start)?);
            }
            source_inner_loops.push(inners);
        }

        // Gather source vertex positions once (independent of count).
        let mut source_vert_pos: HashMap<VertId, DVec3> = HashMap::new();
        for loops in source_outer_loops.iter().chain(source_inner_loops.iter().flatten()) {
            for &v in loops {
                if !source_vert_pos.contains_key(&v) {
                    source_vert_pos.insert(v, self.vertex_pos(v)?);
                }
            }
        }

        // ─── Emit copies ─────────────────────────────────────────
        let mut new_faces = Vec::with_capacity(face_ids.len() * count as usize);
        for k in 1..=count {
            let t = offset * (k as f64);
            // Per-copy vert map so shared source edges stay shared within
            // this copy — but each copy is independent (no vert sharing
            // across copies).
            let mut vmap: HashMap<VertId, VertId> = HashMap::with_capacity(source_vert_pos.len());
            for (&src, &pos) in &source_vert_pos {
                vmap.insert(src, self.add_vertex(pos + t));
            }
            for (i, &fid) in face_ids.iter().enumerate() {
                let material = self.faces[fid].material();
                let new_outer: Vec<VertId> = source_outer_loops[i].iter()
                    .map(|v| *vmap.get(v).expect("array_linear: source vert missing"))
                    .collect();
                let inner_groups: Vec<Vec<VertId>> = source_inner_loops[i].iter()
                    .map(|inner| inner.iter()
                        .map(|v| *vmap.get(v).expect("array_linear: inner vert missing"))
                        .collect())
                    .collect();
                let inner_slices: Vec<&[VertId]> = inner_groups.iter()
                    .map(|v| v.as_slice()).collect();
                let nf = self.add_face_with_holes(&new_outer, &inner_slices, material)?;
                new_faces.push(nf);
            }
        }

        self.debug_verify_invariants();
        Ok(new_faces)
    }

    /// Radial array — copy `face_ids` `count` times around an axis.
    /// Copy `k` (k = 1..=count) is rotated by `total_angle_rad * k / count`
    /// about `axis_origin`/`axis_dir`. Like linear array, rotation is
    /// orientation-preserving (proper rotation, det=+1) so winding stays
    /// outward and no normal flip is needed. `axis_dir` must be finite
    /// and non-degenerate; it is normalized internally.
    pub fn array_radial_faces(
        &mut self,
        face_ids: &[FaceId],
        count: u32,
        axis_origin: DVec3,
        axis_dir: DVec3,
        total_angle_rad: f64,
    ) -> Result<Vec<FaceId>> {
        ensure!(count >= 1, "array_radial: count must be ≥ 1, got {}", count);
        ensure!(
            axis_origin.x.is_finite() && axis_origin.y.is_finite() && axis_origin.z.is_finite(),
            "array_radial: axis_origin must be finite",
        );
        ensure!(
            axis_dir.x.is_finite() && axis_dir.y.is_finite() && axis_dir.z.is_finite(),
            "array_radial: axis_dir must be finite",
        );
        ensure!(
            axis_dir.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "array_radial: axis_dir must be non-zero",
        );
        ensure!(total_angle_rad.is_finite(), "array_radial: total_angle_rad must be finite");
        let axis = axis_dir.normalize();
        for &fid in face_ids {
            if !self.faces.contains(fid) {
                anyhow::bail!("array_radial: face {:?} not found", fid);
            }
            if !self.faces[fid].is_active() {
                anyhow::bail!("array_radial: face {:?} is inactive", fid);
            }
        }
        if face_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut source_outer_loops: Vec<Vec<VertId>> = Vec::with_capacity(face_ids.len());
        let mut source_inner_loops: Vec<Vec<Vec<VertId>>> = Vec::with_capacity(face_ids.len());
        for &fid in face_ids {
            source_outer_loops.push(self.collect_loop_verts(self.faces[fid].outer().start)?);
            let inner_refs: Vec<_> = self.faces[fid].inners().to_vec();
            let mut inners: Vec<Vec<VertId>> = Vec::with_capacity(inner_refs.len());
            for inner in inner_refs {
                inners.push(self.collect_loop_verts(inner.start)?);
            }
            source_inner_loops.push(inners);
        }

        let mut source_vert_pos: HashMap<VertId, DVec3> = HashMap::new();
        for loops in source_outer_loops.iter().chain(source_inner_loops.iter().flatten()) {
            for &v in loops {
                if !source_vert_pos.contains_key(&v) {
                    source_vert_pos.insert(v, self.vertex_pos(v)?);
                }
            }
        }

        // Rodrigues rotation of `p` about axis by `angle`.
        let rotate = |p: DVec3, angle: f64| -> DVec3 {
            let r = p - axis_origin;
            let (s, c) = angle.sin_cos();
            let rot = r * c + axis.cross(r) * s + axis * axis.dot(r) * (1.0 - c);
            axis_origin + rot
        };

        let step = total_angle_rad / (count as f64);
        let mut new_faces = Vec::with_capacity(face_ids.len() * count as usize);
        for k in 1..=count {
            let ang = step * (k as f64);
            let mut vmap: HashMap<VertId, VertId> =
                HashMap::with_capacity(source_vert_pos.len());
            for (&src, &pos) in &source_vert_pos {
                vmap.insert(src, self.add_vertex(rotate(pos, ang)));
            }
            for (i, &fid) in face_ids.iter().enumerate() {
                let material = self.faces[fid].material();
                let new_outer: Vec<VertId> = source_outer_loops[i].iter()
                    .map(|v| *vmap.get(v).expect("array_radial: outer vert missing"))
                    .collect();
                let inner_groups: Vec<Vec<VertId>> = source_inner_loops[i].iter()
                    .map(|inner| inner.iter()
                        .map(|v| *vmap.get(v).expect("array_radial: inner vert missing"))
                        .collect())
                    .collect();
                let inner_slices: Vec<&[VertId]> = inner_groups.iter()
                    .map(|v| v.as_slice()).collect();
                let nf = self.add_face_with_holes(&new_outer, &inner_slices, material)?;
                new_faces.push(nf);
            }
        }

        self.debug_verify_invariants();
        Ok(new_faces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn array_linear_creates_n_copies() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // A single square face
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let src = m.add_face_with_holes(&[v0, v1, v2, v3], &[], mat).unwrap();

        let faces = m.array_linear_faces(&[src], 3, DVec3::new(2.0, 0.0, 0.0)).unwrap();
        assert_eq!(faces.len(), 3, "3 copies expected");
        // Each copy's first vertex should be translated correctly.
        // Source v0 = (0,0,0); copy 1 should have a vert at (2,0,0),
        // copy 2 at (4,0,0), copy 3 at (6,0,0).
        // Loop start order depends on mesh.add_face internal HE wiring,
        // so we can't assume verts[0] = copy of v0. Instead, verify that
        // the bbox of each copy's verts matches the expected offset.
        for (k, &fid) in faces.iter().enumerate() {
            let verts = m.collect_loop_verts(m.faces[fid].outer().start).unwrap();
            let min_x = verts.iter()
                .map(|v| m.vertex_pos(*v).unwrap().x)
                .fold(f64::INFINITY, f64::min);
            let expected_min_x = 2.0 * (k + 1) as f64;   // source min = 0, shifted by (k+1)·2
            assert!((min_x - expected_min_x).abs() < 1e-9,
                "copy {} min_x = {} (expected {})", k, min_x, expected_min_x);
        }
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after array:\n{}", report.summary());
    }

    #[test]
    fn array_linear_preserves_winding() {
        // Translation preserves handedness → normals stay outward.
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let src = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        let src_n = m.faces[src].normal();

        let faces = m.array_linear_faces(&[src], 1, DVec3::new(5.0, 0.0, 0.0)).unwrap();
        let copy_n = m.faces[faces[0]].normal();
        assert!(src_n.dot(copy_n) > 0.99,
            "copy normal should match source (dot = {})", src_n.dot(copy_n));
    }

    #[test]
    fn array_linear_shares_edges_within_copy() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Two triangles sharing edge v0-v1
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(0.5, -1.0, 0.0));
        let f1 = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        let f2 = m.add_face_with_holes(&[v1, v0, v3], &[], mat).unwrap();

        let faces = m.array_linear_faces(&[f1, f2], 1, DVec3::new(3.0, 0.0, 0.0)).unwrap();
        // The two copies should share a vertex pair (the copied v0-v1 edge)
        let verts_a: std::collections::HashSet<VertId> =
            m.collect_loop_verts(m.faces[faces[0]].outer().start).unwrap().into_iter().collect();
        let verts_b: std::collections::HashSet<VertId> =
            m.collect_loop_verts(m.faces[faces[1]].outer().start).unwrap().into_iter().collect();
        let shared = verts_a.intersection(&verts_b).count();
        assert_eq!(shared, 2, "copies of edge-sharing faces should share 2 verts");
    }

    #[test]
    fn array_radial_creates_n_copies_around_axis() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        // Triangle in xz-plane, offset from origin on +x
        let v0 = m.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(3.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(2.5, 0.0, 1.0));
        let src = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();

        // Full 360° / 4 copies around +Y → 90° step; each copy should land
        // at 90°, 180°, 270°, 360°. Bounding boxes should differ from source.
        let faces = m.array_radial_faces(
            &[src], 4,
            DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0),
            std::f64::consts::TAU,
        ).unwrap();
        assert_eq!(faces.len(), 4);
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "radial array invariants:\n{}", report.summary());

        // Last copy (k=4, angle=2π) should roughly land back on source
        // (±ε). Pick any vert of faces[3] and compare against the closest
        // source vert.
        let last_verts = m.collect_loop_verts(m.faces[faces[3]].outer().start).unwrap();
        let last_pos: Vec<DVec3> = last_verts.iter().map(|v| m.vertex_pos(*v).unwrap()).collect();
        let src_pos = [
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(3.0, 0.0, 0.0),
            DVec3::new(2.5, 0.0, 1.0),
        ];
        for s in &src_pos {
            assert!(last_pos.iter().any(|p| (*p - *s).length() < 1e-6),
                "after full turn, source vertex {:?} should re-appear", s);
        }
    }

    #[test]
    fn array_radial_rejects_bad_input() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(1.5, 0.0, 1.0));
        let f = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();
        // Zero axis
        assert!(m.array_radial_faces(&[f], 3, DVec3::ZERO, DVec3::ZERO, 1.0).is_err());
        // Zero count
        assert!(m.array_radial_faces(&[f], 0, DVec3::ZERO, DVec3::Y, 1.0).is_err());
    }

    #[test]
    fn array_linear_rejects_bad_input() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let f = m.add_face_with_holes(&[v0, v1, v2], &[], mat).unwrap();

        // Zero offset
        assert!(m.array_linear_faces(&[f], 3, DVec3::ZERO).is_err());
        // Zero count
        assert!(m.array_linear_faces(&[f], 0, DVec3::new(1.0, 0.0, 0.0)).is_err());
    }
}
