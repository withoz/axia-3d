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

        // Fast path — if the two faces already share a DCEL edge, defer to
        // the existing coplanar-merge pipeline. This handles the "same-size
        // adjacent rects drawn on top of each other with add_vertex dedup"
        // case where a true shared edge exists.
        if let Some(shared_eid) = self.find_shared_edge_between_faces(f1, f2) {
            if let Ok(new_face) = self.merge_faces_by_edge_with_tolerance(shared_eid, tol_deg) {
                return Ok(new_face);
            }
            // If direct merge fails (e.g., multi-loop issue), fall through to
            // multi-shared / polygon rebuild which re-derives the polygon.
        }

        // 2026-04-27 — Multi-shared edge fix (사용자 보고 "잔여 선이 면과 일체화"):
        //   두 face 가 N>1 개의 outer edge 를 공유 (예: L자 잘린 큰 면 + 작은 사각형
        //   이 e8, e9 두 엣지 공유) 케이스. Single-overlap stitch 가 한 쪽만
        //   처리해 잔여 corner 발생 → 사용자가 잔여 edge erase 시 face cascade.
        //   Graph-based boundary tracing 으로 모든 shared edge 를 한 번에 제거.
        if self.count_shared_edges_outer(f1, f2) >= 2 {
            if let Ok(new_face) = self.merge_via_multi_shared_edges(f1, f2, tol_deg) {
                return Ok(new_face);
            }
            // 실패 시 polygon rebuild fallback.
        }

        let face1 = self.faces.get(f1)
            .ok_or_else(|| anyhow::anyhow!("face {:?} not found", f1))?;
        let face2 = self.faces.get(f2)
            .ok_or_else(|| anyhow::anyhow!("face {:?} not found", f2))?;
        if !face1.is_active() || !face2.is_active() {
            bail!("face is inactive");
        }

        let n1 = face1.normal().normalize_or_zero();
        let n2 = face2.normal().normalize_or_zero();

        // Coplanarity — accept SAME OR OPPOSITE direction.
        //   opposite normals just mean the two faces were wound differently
        //   (one CCW-from-above, one CCW-from-below). Same plane, still
        //   mergeable — we'll flip f2's loop before merging if needed.
        let tol_rad = tol_deg.to_radians();
        let cos_tol = tol_rad.cos();
        let nd = n1.dot(n2);
        let opposite_normal = nd < 0.0;
        if nd.abs() < cos_tol {
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
        let mut v2_pos: Vec<DVec3> = v2_ids.iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();
        // If f2 is wound opposite to f1, reverse its loop so both are
        // effectively CCW from the same viewpoint. This makes the bridge
        // walk in build_merged_boundary produce a consistent CCW outline.
        if opposite_normal {
            v2_pos.reverse();
        }

        // Plane-distance check: every vertex of f2 must lie on f1's plane.
        // 2026-04-24: 1mm → 5mm tolerance. Float drift from snap/rotation
        //   easily pushes nominally-coplanar faces to ~mm-scale discrepancy;
        //   5mm is still sub-user-perceptible at architectural scale.
        let plane_pt = v1_pos[0];
        let plane_d_max = v2_pos.iter()
            .map(|p| (*p - plane_pt).dot(n1).abs())
            .fold(0.0_f64, f64::max);
        if plane_d_max > 5.0 {
            bail!(
                "faces not coplanar (plane distance {:.3}mm > 5mm)",
                plane_d_max,
            );
        }

        // Seg collinearity + overlap tolerance (mm).
        // 2026-04-24: 0.5 → 5.0mm — same rationale as plane_d_max, covers
        //   drawing snap drift. Architectural-scale face sizes (100+ mm
        //   typical) still produce clear overlap signal.
        const SEG_TOL: f64 = 5.0;
        let overlap = find_overlap(&v1_pos, &v2_pos, SEG_TOL)
            .ok_or_else(|| anyhow::anyhow!(
                "no collinear edge with geometric overlap between f1 and f2 (tol 5mm)"
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

    /// Multi-shared edge merge — graph-based union polygon construction.
    ///
    /// 두 face 가 `>= 2` 개 outer edge 를 공유할 때 단일-overlap stitch 가
    /// 잔여 corner 를 만드는 문제 (사용자 보고 2026-04-27) 를 해결.
    ///
    /// 알고리즘:
    /// 1. f1 / f2 의 outer loop edge 들을 `(VertId, VertId)` pair 로 수집.
    /// 2. 두 face 가 같은 vertex pair (방향 무관) 의 edge 를 가지면 "shared"
    ///    표시. shared edge 들은 union polygon 의 internal — boundary 에서 제외.
    /// 3. 남은 (non-shared) edge 들로 무방향 graph 구성.
    /// 4. cycle walk 로 외곽 boundary 추출 → simplify_collinear_loop 적용.
    /// 5. 기존 두 face 제거 + add_face_with_holes 로 새 merged face 생성.
    ///
    /// 제약: shared edges 가 두 face 에서 contiguous (한 덩어리) 일 때만
    /// 잘 동작. 분리된 다중 shared 영역은 비단순 polygon 가 되어 fallback
    /// 으로 빠짐.
    pub fn merge_via_multi_shared_edges(
        &mut self,
        f1: FaceId,
        f2: FaceId,
        tol_deg: f64,
    ) -> Result<FaceId> {
        if f1 == f2 { bail!("cannot merge a face with itself"); }
        let face1 = self.faces.get(f1).ok_or_else(|| anyhow::anyhow!("f1 missing"))?;
        let face2 = self.faces.get(f2).ok_or_else(|| anyhow::anyhow!("f2 missing"))?;
        if !face1.is_active() || !face2.is_active() {
            bail!("face inactive");
        }
        // Coplanarity check (재확인 — caller 가 먼저 검사하지만 안전망).
        if !self.are_faces_coplanar_with_tolerance(f1, f2, tol_deg.max(0.5))? {
            bail!("faces not coplanar");
        }
        let original_normal = face1.normal();
        let material = face1.material();

        // 1. outer loop verts.
        let v1 = self.collect_loop_verts(face1.outer().start)?;
        let v2 = self.collect_loop_verts(face2.outer().start)?;
        if v1.len() < 3 || v2.len() < 3 { bail!("loop too short"); }

        // 2. edges (vertex pairs) — same direction in CCW.
        let mut f1_edges: Vec<(VertId, VertId)> = (0..v1.len())
            .map(|i| (v1[i], v1[(i + 1) % v1.len()]))
            .collect();
        let mut f2_edges: Vec<(VertId, VertId)> = (0..v2.len())
            .map(|i| (v2[i], v2[(i + 1) % v2.len()]))
            .collect();

        // 3. shared mark — direction-agnostic.
        let mut shared_f1 = vec![false; f1_edges.len()];
        let mut shared_f2 = vec![false; f2_edges.len()];
        for (i, e1) in f1_edges.iter().enumerate() {
            for (j, e2) in f2_edges.iter().enumerate() {
                if shared_f2[j] { continue; }
                if (e1.0 == e2.0 && e1.1 == e2.1) || (e1.0 == e2.1 && e1.1 == e2.0) {
                    shared_f1[i] = true;
                    shared_f2[j] = true;
                    break;
                }
            }
        }
        let shared_count = shared_f1.iter().filter(|&&b| b).count();
        if shared_count == 0 {
            bail!("no shared edges (use containing-merge instead)");
        }

        // 4. graph adjacency from non-shared edges.
        use rustc_hash::FxHashMap;
        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();
        for (i, e) in f1_edges.iter().enumerate() {
            if !shared_f1[i] {
                adj.entry(e.0).or_default().push(e.1);
                adj.entry(e.1).or_default().push(e.0);
            }
        }
        for (j, e) in f2_edges.iter().enumerate() {
            if !shared_f2[j] {
                adj.entry(e.0).or_default().push(e.1);
                adj.entry(e.1).or_default().push(e.0);
            }
        }

        // 5. cycle walk. degree-2 graph (simple cycle) 가정.
        // 시작 vertex 는 임의. CCW 순서 보장은 walking 후 normal 비교로.
        let start = *adj.keys().next()
            .ok_or_else(|| anyhow::anyhow!("empty graph after shared removal"))?;
        // 각 vertex 는 valence 2 여야 함 (simple polygon). 아니면 비단순 → bail.
        for (v, ns) in &adj {
            if ns.len() != 2 {
                bail!("non-simple boundary (vertex {:?} has {} neighbors)", v, ns.len());
            }
        }
        let mut walked: Vec<VertId> = Vec::with_capacity(v1.len() + v2.len());
        walked.push(start);
        let mut prev = start;
        let mut cur = adj[&start][0];
        let max_iter = v1.len() + v2.len() + 4;
        let mut iter = 0;
        while cur != start && iter < max_iter {
            walked.push(cur);
            let nbrs = &adj[&cur];
            let next = if nbrs[0] == prev { nbrs[1] } else { nbrs[0] };
            prev = cur;
            cur = next;
            iter += 1;
        }
        if iter >= max_iter {
            bail!("cycle walk overflow");
        }

        // 6. simplify collinear.
        let simplified = self.simplify_collinear_loop(&walked);
        if simplified.len() < 3 {
            bail!("merged loop degenerate after simplify");
        }

        // 7. winding 검증 — normal 이 원래 방향과 같으면 OK, 아니면 reverse.
        let merged_normal = self.compute_normal(&simplified)?;
        let final_loop = if merged_normal.dot(original_normal) < 0.0 {
            simplified.iter().rev().copied().collect::<Vec<_>>()
        } else {
            simplified
        };

        // 8. inner loops (holes) 보존.
        let mut inner_loops: Vec<Vec<VertId>> = Vec::new();
        for &fid in &[f1, f2] {
            let inners: Vec<_> = self.faces[fid].inners().to_vec();
            for inner_ref in inners {
                if inner_ref.start.is_null() { continue; }
                if let Ok(loop_v) = self.collect_loop_verts(inner_ref.start) {
                    if loop_v.len() >= 3 { inner_loops.push(loop_v); }
                }
            }
        }

        // 9. destructive — 모든 shared edge 제거 + 두 face 제거.
        let mut shared_eids: Vec<EdgeId> = Vec::new();
        for (i, &shared) in shared_f1.iter().enumerate() {
            if !shared { continue; }
            let (a, b) = f1_edges[i];
            if let Some(eid) = self.find_edge(a, b) {
                shared_eids.push(eid);
            }
        }
        f1_edges.clear(); f2_edges.clear();
        for eid in &shared_eids {
            let _ = self.remove_edge_and_halfedges(*eid);
        }
        let _ = self.remove_face(f1);
        let _ = self.remove_face(f2);
        if self.faces.contains(f1) { self.faces.remove(f1); }
        if self.faces.contains(f2) { self.faces.remove(f2); }

        // 10. 새 merged face.
        let hole_slices: Vec<&[VertId]> = inner_loops.iter().map(|v| v.as_slice()).collect();
        let new_face = self.add_face_with_holes(&final_loop, &hole_slices, material)?;

        // 11. dangling cleanup — 시뮬레이션 중 남은 split-vertex 의 stub edges.
        let _ = self.cleanup_dangling();

        #[cfg(debug_assertions)]
        self.debug_verify_invariants();

        Ok(new_face)
    }

    /// Read-only dry-run for `merge_coplanar_faces_geometric` — does NOT
    /// mutate the mesh. Returns true iff all gating checks pass:
    ///   1. Both faces active.
    ///   2. Normals coplanar within `tol_deg` (same OR opposite — the actual
    ///      merge handles flip).
    ///   3. Every f2 vertex lies on f1's plane within 5 mm.
    ///   4. `find_overlap` finds at least one collinear-with-overlap edge pair
    ///      (SEG_TOL = 5 mm).
    ///
    /// `build_merged_boundary` is NOT exercised — it has additional shape
    /// constraints that are hard to predict cheaply, but in practice it
    /// succeeds whenever steps 1–4 do. False positives from this dry-run are
    /// therefore rare.
    ///
    /// Used by the Erase-tool hover preview (ADR-012 hover-budget 16 ms) to
    /// distinguish "this edge will geometrically merge" (cyan) from "merge
    /// will fall back to SOFT/cascade" (no cyan / red).
    pub fn would_geometric_merge_succeed(
        &self,
        f1: FaceId,
        f2: FaceId,
        tol_deg: f64,
    ) -> bool {
        if f1 == f2 { return false; }
        let face1 = match self.faces.get(f1) { Some(f) => f, None => return false };
        let face2 = match self.faces.get(f2) { Some(f) => f, None => return false };
        if !face1.is_active() || !face2.is_active() { return false; }

        let n1 = face1.normal().normalize_or_zero();
        let n2 = face2.normal().normalize_or_zero();
        if n1.length_squared() < 1e-20 || n2.length_squared() < 1e-20 {
            return false;
        }

        // Step 2 — coplanarity (same or opposite normal direction).
        let tol_rad = tol_deg.to_radians();
        let cos_tol = tol_rad.cos();
        let nd = n1.dot(n2);
        let opposite_normal = nd < 0.0;
        if nd.abs() < cos_tol { return false; }

        // Step 3 — plane distance: every f2 vert ≤ 5 mm from f1 plane.
        let v1_ids = match self.collect_loop_verts(face1.outer().start) {
            Ok(v) => v, Err(_) => return false,
        };
        let v2_ids = match self.collect_loop_verts(face2.outer().start) {
            Ok(v) => v, Err(_) => return false,
        };
        if v1_ids.len() < 3 || v2_ids.len() < 3 { return false; }

        let v1_pos: Vec<DVec3> = v1_ids.iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();
        let mut v2_pos: Vec<DVec3> = v2_ids.iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();
        if opposite_normal { v2_pos.reverse(); }

        let plane_pt = v1_pos[0];
        let plane_d_max = v2_pos.iter()
            .map(|p| (*p - plane_pt).dot(n1).abs())
            .fold(0.0_f64, f64::max);
        if plane_d_max > 5.0 { return false; }

        // 2026-04-28 — Multi-shared 케이스 인식 (사용자 보고: 인접 면 hover
        //   preview 가 빨간색).
        //
        //   merge_coplanar_faces_geometric 의 fast-path 가 실패 (count!=1)
        //   하면 multi-shared graph merge 로 fallback. 사용자가 두 face 가
        //   2개 이상 edge 공유 (예: 이전 merge 후 boundary 가 split 된 상태)
        //   인 경우 preview 도 cyan 으로 표시되어야.
        //
        //   조건: shared edge 가 1 개 이상 (multi 포함) + 같은 vertex pair
        //   이면 multi-shared graph merge 가 동작. preview 에서도 동일 조건
        //   확인.
        let shared_count = self.count_shared_edges_outer(f1, f2);
        if shared_count >= 2 {
            // Multi-shared 케이스 — graph merge 로 합성 가능
            // (실제 graph cycle walk 까진 dry-run 비용 때문에 생략, 위
            // coplanarity + plane-distance 이미 통과했으므로 success 추정).
            return true;
        }

        // Step 4 — collinear-with-overlap edge pair must exist (single shared
        //   or non-shared geometric overlap case).
        const SEG_TOL: f64 = 5.0;
        find_overlap(&v1_pos, &v2_pos, SEG_TOL).is_some()
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
    fn debug_draw_rectangle_output() {
        // IMPORTANT — draw_rectangle's param convention:
        //   width  → v = n.cross(up) direction
        //   height → u = up direction
        // With up=(1,0,0), v=(0,0,-1). So "height" controls x-range,
        //   "width" controls z-range. Counter-intuitive but this is what
        //   the Rect tool call site generates. Users can draw same shape
        //   by swapping the perpendicular axes.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Rect A: x=[0,1000], z=[0,1000].
        let (f1, _) = mesh.draw_rectangle(
            DVec3::new(500.0, 0.0, 500.0),
            DVec3::new(0.0, 1.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            1000.0, 1000.0, mat,
        ).unwrap();
        // Rect B: x=[1000, 2000] (height=1000), z=[200, 800] (width=600).
        let (f2, _) = mesh.draw_rectangle(
            DVec3::new(1500.0, 0.0, 500.0),
            DVec3::new(0.0, 1.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            600.0, 1000.0, mat,    // width=600 (z), height=1000 (x)
        ).unwrap();

        let face1 = mesh.faces.get(f1).unwrap();
        let face2 = mesh.faces.get(f2).unwrap();
        let n1 = face1.normal().normalize_or_zero();
        let n2 = face2.normal().normalize_or_zero();
        eprintln!("n1={:?} n2={:?} nd={}", n1, n2, n1.dot(n2));

        let v1_ids = mesh.collect_loop_verts(face1.outer().start).unwrap();
        let v2_ids = mesh.collect_loop_verts(face2.outer().start).unwrap();
        let v1_pos: Vec<DVec3> = v1_ids.iter().map(|&v| mesh.vertex_pos(v).unwrap()).collect();
        let v2_pos: Vec<DVec3> = v2_ids.iter().map(|&v| mesh.vertex_pos(v).unwrap()).collect();
        eprintln!("v1_pos={:#?}", v1_pos);
        eprintln!("v2_pos={:#?}", v2_pos);

        let overlap = find_overlap(&v1_pos, &v2_pos, 5.0);
        eprintln!("overlap found: {}", overlap.is_some());
        assert!(overlap.is_some(), "overlap should be found with correct vertex lists");
    }

    #[test]
    fn debug_find_overlap_direct() {
        // Minimal repro — two vertex lists that should overlap at x=1000.
        let v1 = vec![
            DVec3::new(0.0, 0.0, 1000.0),
            DVec3::new(1000.0, 0.0, 1000.0),
            DVec3::new(1000.0, 0.0, 0.0),
            DVec3::new(0.0, 0.0, 0.0),
        ];
        let v2 = vec![
            DVec3::new(1000.0, 0.0, 800.0),
            DVec3::new(2000.0, 0.0, 800.0),
            DVec3::new(2000.0, 0.0, 200.0),
            DVec3::new(1000.0, 0.0, 200.0),
        ];
        let overlap = find_overlap(&v1, &v2, 5.0);
        assert!(overlap.is_some(), "should find overlap between v1 edge 1 and v2 edge 3");
    }

    #[test]
    fn two_rects_via_draw_rectangle_merge() {
        // End-to-end — simulates the actual user flow: draw_rectangle twice
        // at adjacent positions, expect geometric_merge to succeed.
        // This mirrors what the Rect tool + spatial-hash vertex dedup should
        // produce. If this test passes but the UI still fails, the bug is in
        // the TS path (toast/render), not the Rust algorithm.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);

        // draw_rectangle param convention: width → v(perp), height → u(up)
        // Rect A: x=[0,1000] (height=1000), z=[0,1000] (width=1000).
        let (f1, _) = mesh.draw_rectangle(
            glam::DVec3::new(500.0, 0.0, 500.0),
            glam::DVec3::new(0.0, 1.0, 0.0),
            glam::DVec3::new(1.0, 0.0, 0.0),
            1000.0, 1000.0, mat,
        ).unwrap();

        // Rect B: x=[1000, 2000] (height=1000), z=[200, 800] (width=600).
        //   Shares x=1000 line with A for z ∈ [200, 800] (partial overlap).
        let (f2, _) = mesh.draw_rectangle(
            glam::DVec3::new(1500.0, 0.0, 500.0),
            glam::DVec3::new(0.0, 1.0, 0.0),
            glam::DVec3::new(1.0, 0.0, 0.0),
            600.0, 1000.0, mat,    // width=600 (z span), height=1000 (x span)
        ).unwrap();

        assert!(mesh.faces.get(f1).is_some(), "f1 should exist");
        assert!(mesh.faces.get(f2).is_some(), "f2 should exist");

        let result = mesh.merge_coplanar_faces_geometric(f1, f2, 2.0);
        assert!(
            result.is_ok(),
            "merge should succeed — realistic Rect-tool draw, got error: {:?}",
            result.err(),
        );
        let merged = result.unwrap();
        let outer = mesh.collect_loop_verts(
            mesh.faces.get(merged).unwrap().outer().start,
        ).unwrap();
        // Merged L-polygon has 6-8 vertices depending on collinear cleanup.
        assert!(outer.len() >= 6 && outer.len() <= 8,
                "merged outer loop should have 6-8 vertices, got {}", outer.len());

        // Verify the original 2 faces no longer exist.
        assert!(!mesh.faces.contains(f1) || !mesh.faces[f1].is_active(),
                "f1 should be removed/inactive");
        assert!(!mesh.faces.contains(f2) || !mesh.faces[f2].is_active(),
                "f2 should be removed/inactive");
    }

    #[test]
    fn two_coplanar_rects_full_shared_edge_uses_fast_path() {
        // When two rects share a COMPLETE edge (same size, fully aligned),
        // the fast path (find_shared_edge_between_faces + merge_faces_by_edge)
        // should kick in. This is the traditional merge path.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let (f1, _) = mesh.draw_rectangle(
            glam::DVec3::new(500.0, 0.0, 500.0),
            glam::DVec3::new(0.0, 1.0, 0.0),
            glam::DVec3::new(1.0, 0.0, 0.0),
            1000.0, 1000.0, mat,
        ).unwrap();
        let (f2, _) = mesh.draw_rectangle(
            glam::DVec3::new(1500.0, 0.0, 500.0),
            glam::DVec3::new(0.0, 1.0, 0.0),
            glam::DVec3::new(1.0, 0.0, 0.0),
            1000.0, 1000.0, mat,    // same size → shares FULL edge
        ).unwrap();

        // Both rects same size at x=[0..1000] and x=[1000..2000] with
        // z=[0..1000]. Shared edge is the full edge at x=1000, z=[0..1000].
        let result = mesh.merge_coplanar_faces_geometric(f1, f2, 2.0);
        assert!(result.is_ok(), "same-size shared-edge merge must succeed");
        let merged = result.unwrap();
        let outer = mesh.collect_loop_verts(
            mesh.faces.get(merged).unwrap().outer().start,
        ).unwrap();
        assert_eq!(outer.len(), 4, "merged should be a 4-vertex (2000×1000) rect");
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

    // ──────────────────────────────────────────────────────────────────
    //  would_geometric_merge_succeed — read-only dry-run regression
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn dryrun_accepts_adjacent_coplanar_rects() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();
        let e = mesh.add_vertex(DVec3::new(2000.0, 0.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(2000.0, 0.0, 1000.0));
        let f2 = mesh.add_face_with_holes(&[b, c, f, e], &[], MaterialId::new(0)).unwrap();
        assert!(mesh.would_geometric_merge_succeed(f1, f2, 1.0));
    }

    #[test]
    fn dryrun_rejects_non_coplanar() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();
        let e = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let f2 = mesh.add_face_with_holes(&[b, c, f, e], &[], MaterialId::new(0)).unwrap();
        assert!(!mesh.would_geometric_merge_succeed(f1, f2, 5.0));
    }

    #[test]
    fn dryrun_rejects_disjoint_coplanar_no_overlap() {
        // Two coplanar faces with a gap — coplanarity passes but find_overlap
        // returns None → must reject.
        let mut mesh = Mesh::new();
        let a0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let a1 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let a2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let a3 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let f1 = mesh.add_face_with_holes(&[a0, a1, a2, a3], &[], MaterialId::new(0)).unwrap();
        let b0 = mesh.add_vertex(DVec3::new(3000.0, 0.0, 0.0));
        let b1 = mesh.add_vertex(DVec3::new(3000.0, 0.0, 1000.0));
        let b2 = mesh.add_vertex(DVec3::new(4000.0, 0.0, 1000.0));
        let b3 = mesh.add_vertex(DVec3::new(4000.0, 0.0, 0.0));
        let f2 = mesh.add_face_with_holes(&[b0, b1, b2, b3], &[], MaterialId::new(0)).unwrap();
        assert!(!mesh.would_geometric_merge_succeed(f1, f2, 1.0));
    }

    #[test]
    fn dryrun_does_not_mutate_mesh() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();
        let e = mesh.add_vertex(DVec3::new(2000.0, 0.0, 0.0));
        let f = mesh.add_vertex(DVec3::new(2000.0, 0.0, 1000.0));
        let f2 = mesh.add_face_with_holes(&[b, c, f, e], &[], MaterialId::new(0)).unwrap();

        let face_count_before = mesh.faces.iter().count();
        let vert_count_before = mesh.verts.iter().count();
        let _ = mesh.would_geometric_merge_succeed(f1, f2, 1.0);
        let _ = mesh.would_geometric_merge_succeed(f1, f2, 5.0);
        assert_eq!(mesh.faces.iter().count(), face_count_before, "dry-run mutated faces");
        assert_eq!(mesh.verts.iter().count(), vert_count_before, "dry-run mutated verts");
    }

    #[test]
    fn dryrun_rejects_inactive_face() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let f1 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();
        let bogus = FaceId::new(9999);
        assert!(!mesh.would_geometric_merge_succeed(f1, bogus, 1.0));
        assert!(!mesh.would_geometric_merge_succeed(f1, f1, 1.0));
    }
}
