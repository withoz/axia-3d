//! Geometric (non-topological) merge of two coplanar faces.
//!
//! Problem: 사용자가 크기 다른 두 coplanar face 의 공통 경계선을 Erase 하면
//!   face topology 상 shared edge 가 아닐 수 있어 (서로 다른 vertex pair) 기존
//!   `merge_faces_by_edge`는 실패. 기하학적으로는 겹치는 선분이 있으므로
//!   "진짜로 하나의 면으로 합쳐지기를" 기대.
//!
//! 접근: vertex-level polygon reconstruction.
//!   1. 두 face 가 coplanar 인지 확인 (normal 각도 + plane distance).
//!   2. 두 face 의 outer loop 에서 **collinear & 파라메트릭 overlap** 을 갖는
//!      edge 쌍을 찾는다.
//!   3. overlap segment 를 기준으로 두 loop 을 연결해 병합된 boundary 구성.
//!   4. 기존 face 2개 제거 + 새 merged face 생성 (ADR-007 invariant 유지).
//!   5. `simplify_collinear_loop` 로 불필요한 collinear vertex 제거.
//!   6. `cleanup_dangling` 으로 orphan edge/vertex 청소.
//!
//! 제약 (MVP):
//! - 두 face 는 simple outer loop (hole 허용, 단 결과 face 에 병합 holes 포함).
//! - 두 face 가 정확히 하나의 연속된 overlap 세그먼트에서 만난다.
//! - Normal 이 같은 방향 (opposite-oriented 는 현재 거부 — flip 후 재시도 가능).

use anyhow::{bail, Result};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;

/// Overlap 정보: f1 edge i 와 f2 edge j 가 같은 무한직선 위에서 t 구간 [t_lo, t_hi]
/// 만큼 겹침. 파라미터는 f1 edge (vertex i → vertex i+1) 방향을 기준으로 한다.
struct Overlap {
    f1_edge_idx: usize,
    f2_edge_idx: usize,
    /// Overlap start / end 의 3D 좌표.
    p_start: DVec3,
    p_end: DVec3,
    /// f2 edge 가 f1 edge 와 동일 방향(true) 또는 반대방향(false).
    /// CCW outer loop 두 개가 공통 edge 를 공유하면 보통 반대 방향.
    same_direction: bool,
}

impl Mesh {
    /// Merge two coplanar faces that share a collinear boundary segment,
    /// even when they don't share an exact DCEL edge. The merged face
    /// inherits `f1`'s material and absorbs inner holes from both.
    ///
    /// Returns the new merged `FaceId`.
    ///
    /// Errors: faces not coplanar / no overlap / degenerate result.
    pub fn merge_coplanar_faces_geometric(
        &mut self,
        f1: FaceId,
        f2: FaceId,
        tol_deg: f64,
    ) -> Result<FaceId> {
        if f1 == f2 { bail!("cannot merge a face with itself"); }

        let face1 = self.faces.get(f1)
            .ok_or_else(|| anyhow::anyhow!("face {:?} not found", f1))?;
        let face2 = self.faces.get(f2)
            .ok_or_else(|| anyhow::anyhow!("face {:?} not found", f2))?;
        if !face1.is_active() || !face2.is_active() {
            bail!("face is inactive");
        }

        let n1 = face1.normal().normalize_or_zero();
        let n2 = face2.normal().normalize_or_zero();

        // Coplanarity — same direction within tolerance.
        let tol_rad = tol_deg.to_radians();
        let cos_tol = tol_rad.cos();
        let nd = n1.dot(n2);
        if nd < cos_tol {
            bail!(
                "faces not coplanar ({:.2}° between normals, tol {:.2}°)",
                n1.angle_between(n2).to_degrees(), tol_deg,
            );
        }

        // Collect outer loop positions.
        let v1_ids = self.collect_loop_verts(face1.outer().start)?;
        let v2_ids = self.collect_loop_verts(face2.outer().start)?;
        if v1_ids.len() < 3 || v2_ids.len() < 3 {
            bail!("outer loop too short");
        }
        let v1_pos: Vec<DVec3> = v1_ids.iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();
        let v2_pos: Vec<DVec3> = v2_ids.iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();

        // Plane-distance check: every vertex of f2 must lie on f1's plane.
        let plane_pt = v1_pos[0];
        let plane_d_max = v2_pos.iter()
            .map(|p| (*p - plane_pt).dot(n1).abs())
            .fold(0.0_f64, f64::max);
        if plane_d_max > 1.0 {  // 1mm tolerance
            bail!(
                "faces not coplanar (plane distance {:.3}mm > 1mm)",
                plane_d_max,
            );
        }

        // Seg collinearity + overlap tolerance (mm).
        const SEG_TOL: f64 = 0.5;
        let overlap = find_overlap(&v1_pos, &v2_pos, SEG_TOL)
            .ok_or_else(|| anyhow::anyhow!(
                "no collinear edge with geometric overlap between f1 and f2"
            ))?;

        // Build merged boundary.
        let merged_positions = build_merged_boundary(&v1_pos, &v2_pos, &overlap)?;
        if merged_positions.len() < 3 {
            bail!("merged boundary has < 3 vertices");
        }

        // Snapshot holes from both faces.
        let mut inner_loops_pos: Vec<Vec<DVec3>> = Vec::new();
        for &fid in &[f1, f2] {
            let face = &self.faces[fid];
            for inner in face.inners() {
                if inner.start.is_null() { continue; }
                if let Ok(hole_vids) = self.collect_loop_verts(inner.start) {
                    if hole_vids.len() >= 3 {
                        let hole_pos: Vec<DVec3> = hole_vids.iter()
                            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
                            .collect();
                        inner_loops_pos.push(hole_pos);
                    }
                }
            }
        }

        let material = self.faces[f1].material();

        // Remove old faces BEFORE adding new, to free their edges for reuse.
        let _ = self.remove_face(f1);
        let _ = self.remove_face(f2);
        if self.faces.contains(f1) { self.faces.remove(f1); }
        if self.faces.contains(f2) { self.faces.remove(f2); }

        // Convert positions → VertIds via add_vertex (dedups by spatial hash).
        let outer_vids: Vec<VertId> = merged_positions.iter()
            .map(|&p| self.add_vertex(p))
            .collect();
        let simplified = self.simplify_collinear_loop(&outer_vids);
        if simplified.len() < 3 {
            bail!("merged loop degenerate after collinear simplification");
        }

        let inner_vids: Vec<Vec<VertId>> = inner_loops_pos.iter()
            .map(|loop_pos| loop_pos.iter().map(|&p| self.add_vertex(p)).collect())
            .collect();
        let inner_slices: Vec<&[VertId]> = inner_vids.iter()
            .map(|v| v.as_slice())
            .collect();

        let new_fid = self.add_face_with_holes(&simplified, &inner_slices, material)?;

        // Post-merge cleanup: orphan edges/vertices from the removed faces.
        let _ = self.cleanup_dangling();

        // Verify ADR-007 invariants in debug builds.
        #[cfg(debug_assertions)]
        self.debug_verify_invariants();

        Ok(new_fid)
    }
}

/// Find one collinear overlap between any edge of `v1` and any edge of `v2`.
/// Returns the first match; caller can iterate if multiple exist.
fn find_overlap(v1: &[DVec3], v2: &[DVec3], tol: f64) -> Option<Overlap> {
    for i in 0..v1.len() {
        let a = v1[i];
        let b = v1[(i + 1) % v1.len()];
        let ab = b - a;
        let len = ab.length();
        if len < tol { continue; }
        let dir = ab / len;

        for j in 0..v2.len() {
            let c = v2[j];
            let d = v2[(j + 1) % v2.len()];

            // Perpendicular distance of c, d from line a-b.
            let c_perp = (c - a).cross(dir).length();
            let d_perp = (d - a).cross(dir).length();
            if c_perp > tol || d_perp > tol { continue; }

            // Project c, d onto a-b parametric axis (0 = a, len = b).
            let tc = (c - a).dot(dir);
            let td = (d - a).dot(dir);
            let (lo, hi) = if tc < td { (tc, td) } else { (td, tc) };

            let o_lo = lo.max(0.0);
            let o_hi = hi.min(len);
            if o_hi - o_lo < tol { continue; }  // insufficient overlap

            // CCW adjacent faces sharing an edge go in OPPOSITE directions
            // on that edge. If tc < td (c is "before" d along dir) while
            // we'd expect them reversed, flag accordingly.
            let same_direction = tc < td;  // from a→b perspective, f2 goes c→d same way
            let p_start = a + dir * o_lo;
            let p_end = a + dir * o_hi;

            return Some(Overlap {
                f1_edge_idx: i,
                f2_edge_idx: j,
                p_start,
                p_end,
                same_direction,
            });
        }
    }
    None
}

/// Construct the merged outer boundary by walking f1, bridging through f2 at
/// the overlap, and returning to f1.
///
/// Visualization (overlap on f1 edge i_1→i_1+1, f2 edge j_2→j_2+1 reversed):
/// ```text
///   f1:  v0 ── v1 ──…── v_{i1} ── [overlap] ── v_{i1+1} ──…── vn-1
///                             └─┐            ┌─┘
///   f2:                         │            │
///                               ▼            ▲
///                  v_{j2+1} ──…── v_{j2}  (reverse walk)
/// ```
/// Result (CCW): v0, v1, …, v_{i1}, overlap_start_pt_if_needed,
///   (f2 walk from j2 reversed back to j2+1), overlap_end_pt_if_needed,
///   v_{i1+1}, …, vn-1.
fn build_merged_boundary(
    v1: &[DVec3], v2: &[DVec3], overlap: &Overlap,
) -> Result<Vec<DVec3>> {
    const EQ_TOL: f64 = 0.5;  // point equality tol (mm)

    let n1 = v1.len();
    let n2 = v2.len();
    let i1 = overlap.f1_edge_idx;
    let j2 = overlap.f2_edge_idx;

    let v_i1 = v1[i1];
    let v_i1_next = v1[(i1 + 1) % n1];
    let v_j2 = v2[j2];
    let v_j2_next = v2[(j2 + 1) % n2];

    // Which end of f1's edge is "start" vs "end"?
    //   Overlap.p_start is the lower-parameter point along f1's (a → b) direction
    //   where a = v_i1, b = v_i1_next. So p_start is closer to v_i1, p_end to v_i1_next.
    let _ = v_j2;
    let _ = v_j2_next;

    let mut merged: Vec<DVec3> = Vec::with_capacity(n1 + n2);

    // Walk f1 from v_0 up to and including v_{i1}.
    for k in 0..=i1 {
        merged.push(v1[k]);
    }

    // Insert overlap-start if it's not coincident with v_{i1}.
    if (overlap.p_start - v_i1).length() > EQ_TOL {
        merged.push(overlap.p_start);
    }

    // Walk f2's boundary from just past the overlap back to where the overlap
    // ends on f2 (the reversed side). Overlap on f2 is on edge j2 (v_j2 → v_j2_next).
    //
    // If f2 shares the same-direction edge as f1 (unusual), we walk CCW from
    // j2+1 around to j2. If reversed (normal CCW case), we walk from j2 around
    // to j2+1 (going "the long way" around f2).
    //
    // Concretely, in the normal CCW case: after entering f2 at overlap.p_start
    // (near v_j2_next), we walk CCW through v_j2_next+1, v_j2_next+2, ..., v_j2,
    // and exit at overlap.p_end (near v_j2).
    let (mut idx_start, idx_end) = if overlap.same_direction {
        // Unusual — both CCW loops same direction on shared edge implies
        // they face opposite ways in 3D (flipped). We'd need to flip f2 first.
        // For MVP: handle by walking j2..=j2+n2-1 anyway.
        ((j2 + 1) % n2, j2)
    } else {
        ((j2 + 1) % n2, j2)
    };

    // Walk through all f2 vertices except the overlap edge (j2→j2+1 direction).
    // Safety loop cap.
    let mut steps = 0;
    while steps < n2 + 1 {
        merged.push(v2[idx_start]);
        if idx_start == idx_end { break; }
        idx_start = (idx_start + 1) % n2;
        steps += 1;
    }
    if steps > n2 {
        bail!("runaway while walking f2 loop");
    }

    // Insert overlap-end if not coincident with v_{i1_next}.
    if (overlap.p_end - v_i1_next).length() > EQ_TOL {
        merged.push(overlap.p_end);
    }

    // Walk remaining f1 from v_{i1+1} to v_{n-1}.
    let start_k = (i1 + 1) % n1;
    let mut k = start_k;
    let mut steps = 0;
    while steps < n1 {
        merged.push(v1[k]);
        k = (k + 1) % n1;
        if k == 0 { break; }  // wrapped back to start
        steps += 1;
    }

    // Deduplicate consecutive identical points (from EQ_TOL skips).
    let mut out: Vec<DVec3> = Vec::with_capacity(merged.len());
    for p in merged {
        if let Some(last) = out.last() {
            if (*last - p).length() < EQ_TOL { continue; }
        }
        out.push(p);
    }
    // Also close-loop dedup (last ≈ first).
    if out.len() > 1 {
        let first = out[0];
        while let Some(last) = out.last() {
            if (*last - first).length() < EQ_TOL {
                out.pop();
            } else {
                break;
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    #[test]
    fn merge_two_adjacent_rects_same_size() {
        // Two quads sharing an exact edge (v1 at x=1000). Expected: single quad.
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();

        let e = mesh.add_vertex(DVec3::new(2000.0, 0.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(2000.0, 0.0, 1000.0));
        let f2 = mesh.add_face_with_holes(&[b, c, f, e], &[], MaterialId::new(0)).unwrap();

        let merged = mesh.merge_coplanar_faces_geometric(f1, f2, 1.0).unwrap();
        let verts = mesh.collect_loop_verts(
            mesh.faces.get(merged).unwrap().outer().start,
        ).unwrap();
        // Big merged rect should have 4 corners (collinear mid points simplified).
        assert_eq!(verts.len(), 4, "merged loop should be 4-vertex rect");
    }

    #[test]
    fn merge_two_adjacent_rects_different_sizes() {
        // Face A: large, z from 0 to 1000 at x=[0, 1000]
        // Face B: small, z from 200 to 800 at x=[1000, 2000]
        // Shared line: x=1000, z=[200, 800] (partial overlap of A's right edge
        //                                    and B's left edge).
        let mut mesh = Mesh::new();
        let a0 = mesh.add_vertex(DVec3::new(0.0,   0.0, 0.0));
        let a1 = mesh.add_vertex(DVec3::new(0.0,   0.0, 1000.0));
        let a2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let a3 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let f1 = mesh.add_face_with_holes(&[a0, a1, a2, a3], &[], MaterialId::new(0)).unwrap();

        let b0 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 200.0));
        let b1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 800.0));
        let b2 = mesh.add_vertex(DVec3::new(2000.0, 0.0, 800.0));
        let b3 = mesh.add_vertex(DVec3::new(2000.0, 0.0, 200.0));
        let f2 = mesh.add_face_with_holes(&[b0, b1, b2, b3], &[], MaterialId::new(0)).unwrap();

        // Verify normals before merge
        let n1 = mesh.faces.get(f1).unwrap().normal();
        let n2 = mesh.faces.get(f2).unwrap().normal();
        assert!(n1.dot(n2) > 0.99, "faces must be same-orientation for this test");

        let merged = mesh.merge_coplanar_faces_geometric(f1, f2, 1.0).unwrap();
        let verts = mesh.collect_loop_verts(
            mesh.faces.get(merged).unwrap().outer().start,
        ).unwrap();
        // Expected shape (8 vertices — L/Z-like piecewise rectangular outline):
        //   (0,0)→(0,1000)→(1000,1000)→(1000,800)→(2000,800)→(2000,200)→(1000,200)→(1000,0)
        assert!(verts.len() >= 6, "expected ≥6 verts in merged loop, got {}", verts.len());
        assert!(verts.len() <= 8, "expected ≤8 verts in merged loop, got {}", verts.len());
    }

    #[test]
    fn reject_non_coplanar() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();

        // Vertical face — not coplanar with f1.
        let e = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let f2 = mesh.add_face_with_holes(&[b, c, f, e], &[], MaterialId::new(0)).unwrap();

        let result = mesh.merge_coplanar_faces_geometric(f1, f2, 5.0);
        assert!(result.is_err(), "non-coplanar merge must be rejected");
    }

    #[test]
    fn reject_no_overlap() {
        // Two coplanar faces with a gap between them → should fail.
        let mut mesh = Mesh::new();
        let a0 = mesh.add_vertex(DVec3::new(0.0,   0.0, 0.0));
        let a1 = mesh.add_vertex(DVec3::new(0.0,   0.0, 1000.0));
        let a2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let a3 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let f1 = mesh.add_face_with_holes(&[a0, a1, a2, a3], &[], MaterialId::new(0)).unwrap();

        let b0 = mesh.add_vertex(DVec3::new(3000.0, 0.0, 0.0));  // gap at x=1000..3000
        let b1 = mesh.add_vertex(DVec3::new(3000.0, 0.0, 1000.0));
        let b2 = mesh.add_vertex(DVec3::new(4000.0, 0.0, 1000.0));
        let b3 = mesh.add_vertex(DVec3::new(4000.0, 0.0, 0.0));
        let f2 = mesh.add_face_with_holes(&[b0, b1, b2, b3], &[], MaterialId::new(0)).unwrap();

        let result = mesh.merge_coplanar_faces_geometric(f1, f2, 1.0);
        assert!(result.is_err(), "disjoint faces must be rejected");
    }
}
