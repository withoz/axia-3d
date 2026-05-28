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

/// ADR-150 β-1 — Default coplanar tolerance (degrees) for sweep + batch
/// merge dispatch. Matches existing `merge_coplanar_faces_geometric`
/// default (1.0°) — Sprint 3 audit-first canonical 10번째 적용 (기존
/// manual 자산 활용 — `geometric_merge.rs:49` impl).
///
/// Anchor: ADR-150 §2 Q3=(a) (default 답습), LOCKED #65 메타-원칙 #16
/// (휴리스틱 차단 — 사용자 명시 호출 only).
pub const COPLANAR_PAIR_TOL_DEG: f64 = 1.0;

/// ADR-150 β-1 — Single coplanar mergeable pair detection report.
///
/// One pair = (face_a, face_b) where both are active + coplanar (within
/// `tol_deg`) + `would_geometric_merge_succeed` dry-run pass. Returned
/// by `sweep_coplanar_pairs`; consumed by `merge_coplanar_pair_batch`
/// (β-2).
///
/// `face_a.raw() < face_b.raw()` invariant (deterministic ordering —
/// duplicate (f1, f2) ↔ (f2, f1) pair 차단).
#[derive(Debug, Clone, PartialEq)]
pub struct CoplanarPairReport {
    pub face_a: FaceId,
    pub face_b: FaceId,
    /// Plane normal (face_a.normal(), normalized). face_b 의 normal 은
    /// 같은 방향 OR 반대 방향 (`merge_coplanar_faces_geometric` 의
    /// `opposite_normal` flag 정합).
    pub plane_normal: DVec3,
}

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

        // 2026-04-28 — 사용자 보고: L-shape merge 후 잔여 선 (dashed lines
        //   inside merged face). 추가 정밀 검사: cleanup_dangling 이후에도
        //   active edge 가 모든 HE 에서 face=null (orphan) 이면 강제 제거.
        //   특히 비-manifold edge (HE 4개 이상) 의 일부 HE 만 face=null 인
        //   경우 has_active_face=true 로 판정되어 잔류할 수 있음.
        let mut second_pass_remove: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() {
                second_pass_remove.push(eid);
                continue;
            }
            // 모든 HE 가 face=null 또는 inactive face 인지 확인
            let mut all_null = true;
            let mut he = any_he;
            let mut guard = 0;
            loop {
                let f = self.hes[he].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    all_null = false;
                    break;
                }
                he = self.hes[he].next_rad();
                guard += 1;
                if he == any_he || he.is_null() || guard > 10 { break; }
            }
            if all_null { second_pass_remove.push(eid); }
        }
        for eid in second_pass_remove {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }
        self.remove_isolated_verts();

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

        // 2026-04-28 — second pass 강화 (사용자 보고: L-shape merge 후 잔여
        //   선). cleanup_dangling 이 비-manifold edge 일부 face=null 케이스를
        //   놓치는 회귀 차단.
        let mut second_pass: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() {
                second_pass.push(eid);
                continue;
            }
            let mut all_null = true;
            let mut he = any_he;
            let mut guard = 0;
            loop {
                let f = self.hes[he].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    all_null = false;
                    break;
                }
                he = self.hes[he].next_rad();
                guard += 1;
                if he == any_he || he.is_null() || guard > 10 { break; }
            }
            if all_null { second_pass.push(eid); }
        }
        for eid in second_pass {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }
        self.remove_isolated_verts();

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

// ============================================================================
// ADR-150 β-1 — Sweep coplanar mergeable pairs (read-only detection)
// ============================================================================

/// ADR-150 β-1 — Sweep all coplanar mergeable pairs in the mesh.
///
/// Read-only API — no mutation. Returns a Vec of `CoplanarPairReport`s
/// — one per (face_a, face_b) pair satisfying:
///   1. Both faces active
///   2. Normals coplanar within `tol_deg` (same or opposite direction)
///   3. `would_geometric_merge_succeed` dry-run pass (AABB overlap +
///      plane distance + collinear edge overlap)
///   4. `face_a.raw() < face_b.raw()` (deterministic ordering, no
///      duplicates)
///
/// Empty Vec = clean mesh (0 mergeable pairs).
///
/// # Algorithm (Q2=a Full mesh sweep + AABB overlap pre-filter)
///
/// β-1 MVP: O(N²) naive pair iteration with AABB overlap pre-filter.
/// AABB overlap check eliminates most non-mergeable pairs early —
/// `would_geometric_merge_succeed` only invoked for AABB-overlapping
/// pairs. Acceptable for typical mesh scales (< 200 active faces).
/// β-1-extension or perf ADR may add spatial-hash bucketing for
/// large-mesh perf.
///
/// # Parameters
///
/// - `tol_deg`: coplanar normal angle threshold. Recommended default =
///   `COPLANAR_PAIR_TOL_DEG` (1.0°, ADR-150 §2 Q3=a).
///
/// # Lock-ins (β-1)
///
/// - **L-β1-1**: `face_a.raw() < face_b.raw()` invariant (no duplicate
///   (f1, f2) ↔ (f2, f1) pair, deterministic ordering)
/// - **L-β1-2**: AABB overlap pre-filter — `would_geometric_merge_succeed`
///   호출 횟수 minimize (perf optimization, β-1 MVP)
/// - **L-β1-3**: 기존 `would_geometric_merge_succeed` 활용 (geometric_
///   merge.rs:461) — 새 검증 알고리즘 0
/// - **L-β1-4**: read-only (mutation 0) — β-2 batch merge 가 mutation
/// - **L-β1-5**: inactive face / face without AABB silent skip (β-2
///   batch 책임)
pub fn sweep_coplanar_pairs(mesh: &Mesh, tol_deg: f64) -> Vec<CoplanarPairReport> {
    use crate::operations::coplanar::face_world_aabb;

    let mut reports = Vec::new();

    // Snapshot active faces' AABBs + normals (single pass).
    struct FaceSnapshot {
        id: FaceId,
        aabb: crate::operations::coplanar::Aabb3,
        normal: DVec3,
    }
    let mut snapshots: Vec<FaceSnapshot> = Vec::new();
    for (fid, face) in mesh.faces.iter() {
        if !face.is_active() { continue; }
        let Some(aabb) = face_world_aabb(mesh, fid) else { continue; };
        let normal = face.normal().normalize_or_zero();
        if normal.length_squared() < 1e-20 { continue; }
        snapshots.push(FaceSnapshot { id: fid, aabb, normal });
    }

    let n = snapshots.len();
    if n < 2 { return reports; }

    // O(N²) pair iteration with AABB pre-filter + dry-run dispatch.
    // L-β1-1: face_a.raw() < face_b.raw() invariant via i < j loop.
    for i in 0..n {
        for j in (i + 1)..n {
            let a = &snapshots[i];
            let b = &snapshots[j];

            // L-β1-2: AABB overlap pre-filter (cheap)
            if !aabb_overlap(&a.aabb, &b.aabb) { continue; }

            // L-β1-3: would_geometric_merge_succeed dispatch (full check)
            if !mesh.would_geometric_merge_succeed(a.id, b.id, tol_deg) { continue; }

            // Emit deterministic pair (smaller id first, already i < j so
            // a.id < b.id is NOT guaranteed — face_id ordering is insertion
            // order, not numeric. Sort explicit.)
            let (face_a, face_b, plane_normal) = if a.id.raw() < b.id.raw() {
                (a.id, b.id, a.normal)
            } else {
                (b.id, a.id, b.normal)
            };
            reports.push(CoplanarPairReport { face_a, face_b, plane_normal });
        }
    }

    reports
}

/// Internal helper — AABB overlap check (touching = overlap).
fn aabb_overlap(
    a: &crate::operations::coplanar::Aabb3,
    b: &crate::operations::coplanar::Aabb3,
) -> bool {
    a.min.x <= b.max.x && a.max.x >= b.min.x
        && a.min.y <= b.max.y && a.max.y >= b.min.y
        && a.min.z <= b.max.z && a.max.z >= b.min.z
}

// ============================================================================
// ADR-150 β-2 — Batch merge coplanar pairs (mutation API)
// ============================================================================

/// ADR-150 β-2 — Batch merge success report.
///
/// Returned by `merge_coplanar_pair_batch`. Tracks merged count + skipped
/// count (silent skip 차단, 메타-원칙 #16 정합) + new face IDs produced
/// across all successful merges in the batch.
///
/// `new_face_ids` may contain *intermediate* face IDs that are themselves
/// later consumed by cascading merges (e.g., A-B merge produces face_ab,
/// then face_ab-C merge consumes face_ab and produces face_abc). Both
/// face_ab and face_abc appear in `new_face_ids`, but only face_abc is
/// active in the final mesh.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BatchMergeReport {
    /// Number of `merge_coplanar_faces_geometric` calls that succeeded.
    pub merged_count: u32,
    /// Number of pairs that were skipped (already merged / inactive /
    /// drifted post-detection / underlying merge failure).
    pub skipped_count: u32,
    /// All new face IDs produced by successful merges (intermediate +
    /// final). Caller may inspect `mesh.faces[fid].is_active()` to
    /// distinguish final vs intermediate.
    pub new_face_ids: Vec<FaceId>,
}

/// ADR-150 β-2 — Batch merge coplanar pairs with face_id remapping
/// (cascade A-B → AB-C handling).
///
/// Caller supplies `pairs` (typically from a prior `sweep_coplanar_pairs`
/// call). Strict per-pair validation — stale pairs (face already merged /
/// inactive / drift) are skipped, not silent. `BatchMergeReport.skipped_
/// count` exposes skip count (메타-원칙 #16 정합).
///
/// # Cascade handling
///
/// When pair (A, B) merges into face_ab, subsequent pairs referencing
/// either A or B are remapped to face_ab via `remap` table. Example:
///   - sweep returns: [(f1, f2), (f2, f3)]
///   - merge (f1, f2) → f12. remap: f1 → f12, f2 → f12.
///   - second pair (f2, f3): resolve f2 → f12, f3 → f3. merge (f12, f3)
///     → f123. remap: f12 → f123, f3 → f123 (transitive update).
///   - Result: merged_count=2, skipped_count=0, new_face_ids=[f12, f123].
///     Final mesh has 1 face (f123 active, f1/f2/f3/f12 inactive).
///
/// # Skip-on-error policy (L-β2-3)
///
/// `merge_coplanar_faces_geometric` may fail post-detection due to:
///   - Geometric drift between sweep ↔ batch (unlikely in single-thread
///     batch but possible if external mutation between calls)
///   - Edge cases not caught by `would_geometric_merge_succeed` dry-run
///     (rare but documented in geometric_merge.rs:449-456 "false positives
///     from this dry-run are therefore rare")
///   - Cascading merge of A-B-C where A-B succeeds but AB-C has non-convex
///     boundary that the merge cannot handle.
///
/// In all skip cases, the underlying error is silently absorbed into
/// `skipped_count`. Per-pair detailed error reporting deferred to β-2-
/// extension or separate diagnostic API.
///
/// # Lock-ins (β-2)
///
/// - **L-β2-1**: face_id remap table (cascade A-B → AB-C handling) —
///   path compression on update (O(1) resolve after first traversal)
/// - **L-β2-2**: Per-pair `would_geometric_merge_succeed` re-check
///   (drift between sweep ↔ batch defense)
/// - **L-β2-3**: Skip-on-error policy (silent skip 차단 — `skipped_count`
///   noted, 메타-원칙 #16 정합)
/// - **L-β2-4**: 기존 `merge_coplanar_faces_geometric` dispatch (새 merge
///   알고리즘 0)
/// - **L-β2-5**: Self-merge guard (resolved_a == resolved_b → skip,
///   "both pairs already merged into same face" case)
/// - **L-β2-6**: Deterministic ordering — pairs processed in input order
///   (caller's sweep ordering preserved)
pub fn merge_coplanar_pair_batch(
    mesh: &mut Mesh,
    pairs: &[CoplanarPairReport],
    tol_deg: f64,
) -> BatchMergeReport {
    use rustc_hash::FxHashMap;

    let mut report = BatchMergeReport::default();
    let mut remap: FxHashMap<FaceId, FaceId> = FxHashMap::default();

    for pair in pairs {
        // L-β2-1: Resolve face IDs via remap (cascade chain follow + path
        // compression).
        let resolved_a = resolve_face_remap(&mut remap, pair.face_a);
        let resolved_b = resolve_face_remap(&mut remap, pair.face_b);

        // L-β2-5: Self-merge guard
        if resolved_a == resolved_b {
            report.skipped_count += 1;
            continue;
        }

        // Verify both faces still active
        let a_active = mesh.faces.get(resolved_a).map(|f| f.is_active()).unwrap_or(false);
        let b_active = mesh.faces.get(resolved_b).map(|f| f.is_active()).unwrap_or(false);
        if !a_active || !b_active {
            report.skipped_count += 1;
            continue;
        }

        // L-β2-2: Re-verify mergeable (drift defense)
        if !mesh.would_geometric_merge_succeed(resolved_a, resolved_b, tol_deg) {
            report.skipped_count += 1;
            continue;
        }

        // L-β2-4: Dispatch existing merge
        match mesh.merge_coplanar_faces_geometric(resolved_a, resolved_b, tol_deg) {
            Ok(new_face) => {
                report.merged_count += 1;
                report.new_face_ids.push(new_face);
                // L-β2-1: Update remap (transitive — existing entries
                // pointing to resolved_a or resolved_b also redirect to new_face).
                update_remap_transitive(&mut remap, resolved_a, new_face);
                update_remap_transitive(&mut remap, resolved_b, new_face);
            }
            Err(_) => {
                // L-β2-3: Skip-on-error (silent skip count, error detail
                // absorbed — per-pair diagnostic is β-2-extension scope).
                report.skipped_count += 1;
            }
        }
    }

    report
}

/// Internal helper — Resolve face_id via remap table with path compression.
///
/// Walks the remap chain until reaching a fixed point (face_id not in
/// remap). Compresses the path so subsequent lookups are O(1).
fn resolve_face_remap(
    remap: &mut rustc_hash::FxHashMap<FaceId, FaceId>,
    id: FaceId,
) -> FaceId {
    let mut cur = id;
    let mut visited: Vec<FaceId> = Vec::new();
    loop {
        match remap.get(&cur) {
            Some(&next) if next != cur => {
                visited.push(cur);
                cur = next;
            }
            _ => break,
        }
        // Safety bound (corrupted cycle defense)
        if visited.len() > 1000 { break; }
    }
    // Path compression — all visited entries now point directly to root.
    for v in visited {
        remap.insert(v, cur);
    }
    cur
}

/// Internal helper — Update remap so `old` (and all entries pointing to
/// `old`) now redirect to `new`. Transitive update — caller relies on
/// `resolve_face_remap` to follow chains but this eagerly redirects.
fn update_remap_transitive(
    remap: &mut rustc_hash::FxHashMap<FaceId, FaceId>,
    old: FaceId,
    new: FaceId,
) {
    if old == new { return; }
    // Direct entry: old → new
    remap.insert(old, new);
    // Transitive: any existing key whose value == old should redirect to new
    let to_update: Vec<FaceId> = remap
        .iter()
        .filter_map(|(k, v)| if *v == old { Some(*k) } else { None })
        .collect();
    for k in to_update {
        remap.insert(k, new);
    }
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

    // ========================================================================
    // ADR-150 β-1 — sweep_coplanar_pairs (6 회귀)
    // ========================================================================

    /// Helper — build an axis-aligned quad face on Y=0 plane (xz extent).
    fn build_quad_y0(
        mesh: &mut Mesh,
        x_min: f64, x_max: f64, z_min: f64, z_max: f64,
    ) -> FaceId {
        let a = mesh.add_vertex(DVec3::new(x_min, 0.0, z_min));
        let b = mesh.add_vertex(DVec3::new(x_max, 0.0, z_min));
        let c = mesh.add_vertex(DVec3::new(x_max, 0.0, z_max));
        let d = mesh.add_vertex(DVec3::new(x_min, 0.0, z_max));
        mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap()
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 1: baseline clean mesh (no mergeable pairs)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_no_pairs_on_empty_mesh() {
        let mesh = Mesh::new();
        let reports = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);
        assert_eq!(reports.len(), 0, "empty mesh should have 0 pairs");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 2: canonical adjacent coplanar pair (same-size shared edge)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_finds_adjacent_coplanar_pair() {
        let mut mesh = Mesh::new();
        let f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);

        let reports = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);

        // Should find exactly 1 pair (f1, f2 — both Y=0, adjacent at x=1000)
        assert_eq!(reports.len(), 1, "expected 1 mergeable pair, got {}", reports.len());
        let r = &reports[0];
        // L-β1-1: face_a.raw() < face_b.raw() invariant
        assert!(r.face_a.raw() < r.face_b.raw());
        // Both faces should be in pair
        assert!(
            (r.face_a == f1 && r.face_b == f2) || (r.face_a == f2 && r.face_b == f1),
            "pair should contain f1 + f2, got ({:?}, {:?})", r.face_a, r.face_b
        );
        // Normal Y direction (Y=0 plane)
        assert!(r.plane_normal.y.abs() > 0.99, "normal should be Y-axis, got {:?}", r.plane_normal);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 3: non-coplanar pair excluded (regression guard)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_excludes_non_coplanar() {
        let mut mesh = Mesh::new();
        // Face on Y=0
        let _f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        // Face on Z=0 (perpendicular)
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let c = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        let d = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let _f2 = mesh.add_face_with_holes(&[a, b, c, d], &[], MaterialId::new(0)).unwrap();

        let reports = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);

        // Perpendicular faces — no coplanar pair
        assert_eq!(reports.len(), 0, "perpendicular faces should not be a pair, got {}", reports.len());
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 4: multiple coplanar mergeable pairs (3 adjacent rects)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_finds_multiple_pairs() {
        let mut mesh = Mesh::new();
        // 3 faces in a row: f1 [0..1000], f2 [1000..2000], f3 [2000..3000]
        let _f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let _f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);
        let _f3 = build_quad_y0(&mut mesh, 2000.0, 3000.0, 0.0, 1000.0);

        let reports = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);

        // Expected pairs: (f1, f2) shared edge x=1000, (f2, f3) shared edge x=2000.
        // (f1, f3) NOT adjacent (gap at x=1000..2000 of f2 — no collinear overlap).
        // So 2 pairs expected.
        assert_eq!(reports.len(), 2, "expected 2 mergeable pairs, got {}", reports.len());
        // L-β1-1: all reports respect ordering invariant
        for r in &reports {
            assert!(r.face_a.raw() < r.face_b.raw(),
                "ordering violation: ({:?}, {:?})", r.face_a, r.face_b);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 5: tolerance boundary case (1° same vs 5° different)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_respects_tolerance() {
        // NOTE: `would_geometric_merge_succeed` has TWO independent checks:
        //   1. Normal angle (`tol_deg`) — what we test here
        //   2. Plane distance (≤ 5mm, hard-coded) — must stay within for tilt test
        // Use small face (50mm) + small tilt (2°) so plane drift (50·tan(2°)
        // ≈ 1.75mm) stays well within 5mm, isolating the normal tol behavior.
        let mut mesh = Mesh::new();
        // Face on Y=0 (50mm × 50mm)
        let _f1 = build_quad_y0(&mut mesh, 0.0, 50.0, 0.0, 50.0);
        // Face tilted 2° around Z axis — adjacent at x=50 (face2: x=50..100)
        let tilt_rad: f64 = 2.0_f64.to_radians();
        let y_at_x100 = 50.0 * tilt_rad.tan();  // ≈ 1.75mm (within 5mm)
        let a = mesh.add_vertex(DVec3::new(50.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(100.0, y_at_x100, 0.0));
        let c = mesh.add_vertex(DVec3::new(100.0, y_at_x100, 50.0));
        let d = mesh.add_vertex(DVec3::new(50.0, 0.0, 50.0));
        let _f2 = mesh.add_face_with_holes(&[a, d, c, b], &[], MaterialId::new(0)).unwrap();

        // tol = 1° — should NOT find pair (2° angle > 1° tol)
        let reports_strict = sweep_coplanar_pairs(&mesh, 1.0);
        assert_eq!(reports_strict.len(), 0, "1° tol should reject 2° tilt, got {}", reports_strict.len());

        // tol = 5° — should find pair (2° angle < 5° tol, plane dist 1.75 < 5mm)
        let reports_loose = sweep_coplanar_pairs(&mesh, 5.0);
        assert_eq!(reports_loose.len(), 1, "5° tol should accept 2° tilt, got {}", reports_loose.len());
    }

    // ────────────────────────────────────────────────────────────────────────
    // ADR-150 β-2 — merge_coplanar_pair_batch (4 회귀)
    // ────────────────────────────────────────────────────────────────────────

    /// Test 7 (β-2): canonical single-pair batch merge success
    #[test]
    fn adr150_batch_merge_single_pair_success() {
        let mut mesh = Mesh::new();
        let f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);

        let pairs = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);
        assert_eq!(pairs.len(), 1, "sweep should find 1 pair");

        let report = merge_coplanar_pair_batch(&mut mesh, &pairs, COPLANAR_PAIR_TOL_DEG);

        assert_eq!(report.merged_count, 1, "expected 1 merge, got {}", report.merged_count);
        assert_eq!(report.skipped_count, 0, "expected 0 skip");
        assert_eq!(report.new_face_ids.len(), 1, "expected 1 new face_id");
        // Both original faces consumed (storage-removed OR inactive — both
        // valid post-merge states. Use .get() to handle storage removal.)
        let f1_state = mesh.faces.get(f1).map(|f| f.is_active()).unwrap_or(false);
        let f2_state = mesh.faces.get(f2).map(|f| f.is_active()).unwrap_or(false);
        assert!(!f1_state, "f1 should be consumed (merged)");
        assert!(!f2_state, "f2 should be consumed (merged)");
        // New face active
        let new_face = report.new_face_ids[0];
        assert!(mesh.faces.get(new_face).map(|f| f.is_active()).unwrap_or(false),
            "new face should be active");
    }

    /// Test 8 (β-2): cascading merge — A-B → AB-C handling
    #[test]
    fn adr150_batch_merge_cascade_three_rects() {
        let mut mesh = Mesh::new();
        let f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);
        let f3 = build_quad_y0(&mut mesh, 2000.0, 3000.0, 0.0, 1000.0);

        let pairs = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);
        assert_eq!(pairs.len(), 2, "sweep should find 2 pairs (f1-f2 + f2-f3)");

        let report = merge_coplanar_pair_batch(&mut mesh, &pairs, COPLANAR_PAIR_TOL_DEG);

        // Both pairs should merge (cascade via remap): (f1+f2) then (f12+f3)
        assert_eq!(report.merged_count, 2, "expected 2 merges (cascade), got {}", report.merged_count);
        assert_eq!(report.skipped_count, 0, "expected 0 skip in cascade");
        // 2 intermediate/final new faces
        assert_eq!(report.new_face_ids.len(), 2);
        // All 3 original faces consumed (storage-removed OR inactive)
        let active_or = |fid: FaceId| mesh.faces.get(fid).map(|f| f.is_active()).unwrap_or(false);
        assert!(!active_or(f1));
        assert!(!active_or(f2));
        assert!(!active_or(f3));
        // Only the *final* new_face_id should be active in mesh
        let final_face = report.new_face_ids[1];
        assert!(active_or(final_face), "final cascade face should be active");
        // Intermediate face (f12) should be consumed by second merge
        let intermediate_face = report.new_face_ids[0];
        assert!(!active_or(intermediate_face),
            "intermediate cascade face should be consumed");
    }

    /// Test 9 (β-2): skip-on-self-merge guard (L-β2-5) — pair where both
    /// already merged into same face via cascade
    #[test]
    fn adr150_batch_merge_skip_self_merge() {
        let mut mesh = Mesh::new();
        let f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);

        // Construct 2 duplicate pairs (same face_a/face_b) to force
        // self-merge guard. Real sweep wouldn't produce duplicates but
        // tests guard isolation.
        let pair = CoplanarPairReport {
            face_a: f1,
            face_b: f2,
            plane_normal: DVec3::new(0.0, 1.0, 0.0),
        };
        let pairs = vec![pair.clone(), pair.clone()];

        let report = merge_coplanar_pair_batch(&mut mesh, &pairs, COPLANAR_PAIR_TOL_DEG);

        // First pair merges (f1, f2) → new_face. Second pair (f1, f2) →
        // both resolve to same new_face (via remap) → L-β2-5 self-merge guard
        // skips.
        assert_eq!(report.merged_count, 1, "expected 1 merge, got {}", report.merged_count);
        assert_eq!(report.skipped_count, 1, "expected 1 skip (self-merge), got {}", report.skipped_count);
    }

    /// Test 10 (β-2): manifold post-batch invariant (LOCKED #1 P7)
    #[test]
    fn adr150_batch_merge_manifold_safe_post_batch() {
        let mut mesh = Mesh::new();
        // 4 adjacent rects in row → 3 pairs → cascade into 1 face
        let _f1 = build_quad_y0(&mut mesh, 0.0, 1000.0, 0.0, 1000.0);
        let _f2 = build_quad_y0(&mut mesh, 1000.0, 2000.0, 0.0, 1000.0);
        let _f3 = build_quad_y0(&mut mesh, 2000.0, 3000.0, 0.0, 1000.0);
        let _f4 = build_quad_y0(&mut mesh, 3000.0, 4000.0, 0.0, 1000.0);

        let pairs = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);
        assert_eq!(pairs.len(), 3, "sweep should find 3 pairs (adjacent 4-row)");

        let report = merge_coplanar_pair_batch(&mut mesh, &pairs, COPLANAR_PAIR_TOL_DEG);

        assert_eq!(report.merged_count, 3, "expected 3 cascade merges, got {}", report.merged_count);

        // LOCKED #1 P7 invariant: verify_face_invariants passes
        let invariants = mesh.verify_face_invariants();
        assert!(
            invariants.is_valid(),
            "manifold invariants violated post-batch: {} violations",
            invariants.violations.len()
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 6: AABB pre-filter performance (large mesh sanity)
    // ────────────────────────────────────────────────────────────────────────
    #[test]
    fn adr150_sweep_aabb_prefilter_performance() {
        let mut mesh = Mesh::new();
        // Build 8×8 grid of disjoint quads (64 faces, no adjacency)
        // Each quad isolated by 100mm gap (AABB pre-filter eliminates all
        // non-adjacent pairs cheaply).
        for ix in 0..8 {
            for iy in 0..8 {
                let x0 = (ix * 1100) as f64;
                let z0 = (iy * 1100) as f64;
                build_quad_y0(&mut mesh, x0, x0 + 1000.0, z0, z0 + 1000.0);
            }
        }

        let start = std::time::Instant::now();
        let reports = sweep_coplanar_pairs(&mesh, COPLANAR_PAIR_TOL_DEG);
        let elapsed = start.elapsed();

        // Disjoint grid — 0 mergeable pairs.
        assert_eq!(reports.len(), 0, "disjoint 8x8 grid should have 0 pairs, got {}", reports.len());
        // Performance — should complete well under 500ms (64 face × 63 / 2 =
        // 2016 AABB checks, all reject).
        assert!(
            elapsed.as_millis() < 500,
            "sweep took {}ms (expected < 500ms for 64-face grid)",
            elapsed.as_millis()
        );
    }
}
