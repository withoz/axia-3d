//! ADR-016 §2 (Path B) — Erase + Re-synthesize.
//!
//! 사용자 정책: "바운더리가 깨지면 새로운 바운더리를 찾아서 새로 면 생성".
//!
//! 기존 Erase 의 fast-path (`merge_faces_by_edge_with_tolerance`) 는
//! outer-loop 끼리만 비교 → hole boundary edge / 기타 비정형 케이스 처리 불가.
//!
//! Path B 는 hole boundary edge 처럼 fast-path 가 거부하는 케이스를
//! 위해 다음 단계의 통합 경로를 제공:
//!
//!   1. 인접 face soft-remove (HE next/prev 보존)
//!   2. 대상 edge 제거
//!   3. seed verts 기반 free-edge resolver 실행 → 새 face 합성
//!   4. 결과 반환 (제거된 face / 새로 생긴 face / 잔존 wire vert 수)
//!
//! 잔존 wire (free edge chain) 는 기본 보존 (SketchUp 식 — 사용자가 추가
//! 삭제 가능). `cleanup_dangling=true` 로 호출하면 자동 정리.
//!
//! ADR-008 Axiom 1 ("Face = byproduct of topology") 정합.

use crate::{EdgeId, FaceId, MaterialId, Mesh, VertId};
use anyhow::{anyhow, bail, Result};

/// Result of [`Mesh::erase_edge_resynthesize`].
#[derive(Debug, Clone, Default)]
pub struct EraseResynthResult {
    /// Faces removed in step 1 (the edge's adjacent faces).
    pub removed_faces: Vec<FaceId>,
    /// Faces synthesized by the leftmost-turn walker on remaining free edges.
    pub new_faces: Vec<FaceId>,
    /// Edges removed by optional cleanup_dangling pass.
    pub cleaned_edges: usize,
    /// Verts removed by optional cleanup_dangling pass.
    pub cleaned_verts: usize,
}

impl Mesh {
    /// Path B operation — erase one edge, re-resolve adjacent face region.
    ///
    /// Returns lists of removed and newly-synthesized faces so the caller
    /// (Scene) can update XIA mappings.
    ///
    /// `cleanup_dangling`: when true, removes orphan wires (free edges with
    /// at least one valence-1 endpoint) after synthesis. Default false to
    /// match SketchUp behaviour (wires stay until user deletes them).
    pub fn erase_edge_resynthesize(
        &mut self,
        edge_id: EdgeId,
        material: MaterialId,
        cleanup_dangling: bool,
    ) -> Result<EraseResynthResult> {
        if !self.edges.contains(edge_id) {
            bail!("edge {:?} not found", edge_id);
        }

        // 1) Identify adjacent faces (next_rad chain catches hole-loop sharing).
        let (adjacent_faces, _) = self.get_faces_sharing_edge(edge_id);

        // 2) HOLE-EDGE FAST PATH — if any adjacent face has this edge in one
        //    of its inner (hole) loops, the user intent is "remove that hole".
        //    Rebuild ring as a simple face (or with the remaining holes).
        //    Sibling sub-faces whose outer loop equals the hole's verts are
        //    removed as well (they no longer have a topological neighbor).
        if let Some((ring_fid, hole_idx)) = self.find_hole_loop_owner(&adjacent_faces, edge_id) {
            return self.rebuild_after_hole_edge_erase(
                ring_fid, hole_idx, edge_id, &adjacent_faces, material, cleanup_dangling,
            );
        }

        // 3) NON-HOLE PATH — capture seed verts BEFORE destruction so the
        //    resolver can scope its planar component search.
        let edge_ref = self.edges.get(edge_id)
            .ok_or_else(|| anyhow!("edge {:?} disappeared", edge_id))?;
        let mut seed_verts: Vec<VertId> = vec![edge_ref.v_small(), edge_ref.v_large()];
        for &fid in &adjacent_faces {
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            if let Ok(vs) = self.collect_loop_verts(face.outer().start) {
                seed_verts.extend(vs);
            }
            for inner in face.inners() {
                if let Ok(vs) = self.collect_loop_verts(inner.start) {
                    seed_verts.extend(vs);
                }
            }
        }
        seed_verts.sort_unstable_by_key(|v| v.raw());
        seed_verts.dedup();

        // 4) Soft-remove all adjacent faces.
        let mut removed_faces = Vec::with_capacity(adjacent_faces.len());
        for &fid in &adjacent_faces {
            if self.faces.contains(fid) {
                self.soft_remove_face(fid)?;
                removed_faces.push(fid);
            }
        }

        // 5) Remove the target edge entirely.
        self.remove_edge_and_halfedges(edge_id)?;

        // 6) Re-resolve free-edge cycles within the seeded region.
        let new_faces = self.resolve_planar_free_faces_scoped(
            material, Some(&seed_verts), None,
        );

        // 7) Optional cleanup of orphan wires.
        let (cleaned_edges, cleaned_verts) = if cleanup_dangling {
            self.cleanup_dangling()
        } else {
            (0, 0)
        };

        Ok(EraseResynthResult {
            removed_faces,
            new_faces,
            cleaned_edges,
            cleaned_verts,
        })
    }

    /// Walk each adjacent face's hole loops; return (face, hole_idx) if any
    /// hole loop contains the target edge.
    fn find_hole_loop_owner(
        &self,
        adjacent_faces: &[FaceId],
        edge_id: EdgeId,
    ) -> Option<(FaceId, usize)> {
        for &fid in adjacent_faces {
            let face = self.faces.get(fid)?;
            for (i, inner) in face.inners().iter().enumerate() {
                let mut h = inner.start;
                let mut guard = 0usize;
                loop {
                    guard += 1;
                    if guard > 4096 { break; }
                    let he = self.hes.get(h)?;
                    if he.edge() == edge_id { return Some((fid, i)); }
                    h = he.next();
                    if h == inner.start { break; }
                }
            }
        }
        None
    }

    /// Hole-edge erase: rebuild `ring_fid` without `hole_idx`, remove sibling
    /// sub-face whose outer loop equals that hole's verts (reversed).
    fn rebuild_after_hole_edge_erase(
        &mut self,
        ring_fid: FaceId,
        hole_idx: usize,
        edge_id: EdgeId,
        adjacent: &[FaceId],
        material: MaterialId,
        cleanup_dangling: bool,
    ) -> Result<EraseResynthResult> {
        // Capture ring's outer + ALL inner loops.
        let ring = self.faces.get(ring_fid)
            .ok_or_else(|| anyhow!("ring {:?} missing", ring_fid))?;
        let outer_start = ring.outer().start;
        let outer_verts = self.collect_loop_verts(outer_start)?;
        let inner_starts: Vec<_> = ring.inners().iter().map(|l| l.start).collect();
        let mut keep_holes: Vec<Vec<VertId>> = Vec::new();
        let mut removed_hole_verts: Vec<VertId> = Vec::new();
        for (i, start) in inner_starts.iter().enumerate() {
            let verts = self.collect_loop_verts(*start)?;
            if i == hole_idx {
                removed_hole_verts = verts;
            } else {
                keep_holes.push(verts);
            }
        }

        // Identify sibling sub-face: a simple active face whose outer loop
        // equals removed_hole_verts in REVERSE (CCW vs CW). The dedup step
        // lets us locate it by vertex set.
        let removed_hole_set: std::collections::HashSet<VertId> =
            removed_hole_verts.iter().copied().collect();
        let mut sibling: Option<FaceId> = None;
        for &fid in adjacent {
            if fid == ring_fid { continue; }
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            if !face.inners().is_empty() { continue; }
            let v = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if v.len() == removed_hole_verts.len()
                && v.iter().all(|x| removed_hole_set.contains(x))
            {
                sibling = Some(fid);
                break;
            }
        }

        let mut removed_faces = vec![ring_fid];
        if let Some(s) = sibling { removed_faces.push(s); }

        // Soft-remove ring + sibling so add_face_with_holes can claim HEs.
        self.soft_remove_face(ring_fid)?;
        if let Some(s) = sibling { self.soft_remove_face(s)?; }

        // Remove the target edge so it can't be reclaimed.
        self.remove_edge_and_halfedges(edge_id)?;

        // Rebuild as new simple/ring face with remaining holes.
        let hole_refs: Vec<&[VertId]> = keep_holes.iter().map(|h| h.as_slice()).collect();
        let new_fid = self.add_face_with_holes(&outer_verts, &hole_refs, material)?;

        // Optional cleanup of orphan wires (the hole's now-disconnected
        // remaining edges if any survived after target edge removal).
        let (cleaned_edges, cleaned_verts) = if cleanup_dangling {
            self.cleanup_dangling()
        } else {
            (0, 0)
        };

        Ok(EraseResynthResult {
            removed_faces,
            new_faces: vec![new_fid],
            cleaned_edges,
            cleaned_verts,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MaterialId, Mesh};
    use glam::DVec3;

    // Note: the realistic adjacent-rect / hole-edge scenarios live in
    // axia-core scene.rs tests where Command::DrawRect provides the proper
    // face-synthesis pipeline. Mesh-level tests here cover the contract
    // boundary cases only.

    /// Erase one floating edge (no adjacent face) — should be a no-op
    /// gracefully (or at most edge removal, no face changes).
    #[test]
    fn erase_isolated_edge_is_safe() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::ZERO);
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let (eid, _) = mesh.add_edge(v0, v1).unwrap();

        let result = mesh.erase_edge_resynthesize(eid, mat, false).unwrap();
        assert!(result.removed_faces.is_empty());
        assert!(result.new_faces.is_empty());
    }
}
