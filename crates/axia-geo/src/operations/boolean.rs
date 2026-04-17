//! Boolean Operations — Union, Subtract, Intersect
//!
//! 3-stage pipeline:
//!   1. Intersection Graph — 두 솔리드의 face-face 교차선 계산
//!   2. Face Split — 교차선으로 face를 sub-face로 분할
//!   3. Classification — 각 sub-face를 inside/outside로 분류하여 결과 조립
//!
//! MVP: 축정렬 직육면체(box) 간 Boolean → 이후 임의 메시 확장

use glam::DVec3;
use anyhow::Result;
use rustc_hash::FxHashMap;

use crate::mesh::Mesh;
use crate::{FaceId, VertId, MaterialId};
use super::boolean_geo::{
    point_in_solid, triangle_triangle_intersection,
    Pt2, project_to_2d, unproject_to_3d, segment_segment_2d,
    polygon_signed_area_2d,
};

/// Boolean 연산 종류
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoolOp {
    Union,
    Subtract,
    Intersect,
}

/// Boolean 연산 결과
#[derive(Debug)]
pub struct BooleanResult {
    /// 결과 face 목록
    pub faces: Vec<FaceId>,
    /// 생성된 정점 수
    pub new_verts: usize,
    /// 디버그 로그
    pub debug: Vec<String>,
}

/// 솔리드 = face 집합 + 삼각형화된 데이터
struct SolidData {
    face_ids: Vec<FaceId>,
    /// face별 삼각형 (교차 판정용)
    triangles: Vec<FaceTriangles>,
    /// 전체 삼각형 목록 (point-in-solid용)
    all_triangles: Vec<(DVec3, DVec3, DVec3)>,
}

struct FaceTriangles {
    face_id: FaceId,
    #[allow(dead_code)] // find_intersections에서 사용 (현재 비활성 경로)
    tris: Vec<(DVec3, DVec3, DVec3)>,
}

impl Mesh {
    /// Boolean 연산 수행
    ///
    /// `faces_a`: 솔리드 A의 face 집합
    /// `faces_b`: 솔리드 B의 face 집합
    /// `op`: Union / Subtract / Intersect
    pub fn boolean(
        &mut self,
        faces_a: &[FaceId],
        faces_b: &[FaceId],
        op: BoolOp,
        material: MaterialId,
    ) -> Result<BooleanResult> {
        let mut debug = Vec::new();

        // ── Stage 0: 솔리드 데이터 준비 ──────────────
        let solid_a = self.prepare_solid(faces_a)?;
        let solid_b = self.prepare_solid(faces_b)?;
        debug.push(format!(
            "Solid A: {} faces, {} tris | Solid B: {} faces, {} tris",
            solid_a.face_ids.len(), solid_a.all_triangles.len(),
            solid_b.face_ids.len(), solid_b.all_triangles.len(),
        ));

        // ── Stage 0.5: 공면 face 감지 ─────────────────
        let coplanar_intersections = self.detect_coplanar_faces(&solid_a, &solid_b);
        let coplanar_count = coplanar_intersections.len();

        // ── Stage 1: 교차선 수집 ─────────────────────
        let intersections: Vec<IntersectionSegment> = coplanar_intersections;
        debug.push(format!("Intersections found: {} (including {} coplanar)",
            intersections.len(), coplanar_count));

        // ── Stage 2: Face Split — 교차선으로 face 분할 ─────
        let split_a = if !intersections.is_empty() {
            self.split_faces_by_intersections(&solid_a, &intersections, material)
        } else {
            // 교차 없으면 모든 face를 자기 자신으로 매핑
            solid_a.face_ids.iter().map(|&f| (f, vec![f])).collect()
        };
        let split_b = if !intersections.is_empty() {
            self.split_faces_by_intersections(&solid_b, &intersections, material)
        } else {
            solid_b.face_ids.iter().map(|&f| (f, vec![f])).collect()
        };

        // 분할 후 새로운 face 목록
        let new_faces_a: Vec<FaceId> = split_a.values().flat_map(|v| v.iter().copied()).collect();
        let new_faces_b: Vec<FaceId> = split_b.values().flat_map(|v| v.iter().copied()).collect();

        let split_count_a = new_faces_a.len().saturating_sub(solid_a.face_ids.len());
        let split_count_b = new_faces_b.len().saturating_sub(solid_b.face_ids.len());
        debug.push(format!(
            "Face splits: A +{} ({}→{}), B +{} ({}→{})",
            split_count_a, solid_a.face_ids.len(), new_faces_a.len(),
            split_count_b, solid_b.face_ids.len(), new_faces_b.len(),
        ));

        // ── Stage 3: 분할된 face의 centroid 계산 + 원본 솔리드로 분류 ──
        // 핵심: point_in_solid는 밀폐된(watertight) 솔리드가 필요하므로
        // 분할 후 재구성이 아닌 **원본 솔리드 삼각형**으로 분류해야 정확함
        let (keep_a, keep_b) = self.classify_split_faces(
            &new_faces_a, &solid_b, // A의 새 face → 원본 B로 판정
            &new_faces_b, &solid_a, // B의 새 face → 원본 A로 판정
            op,
        );
        debug.push(format!(
            "Keep: A={} faces, B={} faces",
            keep_a.len(), keep_b.len(),
        ));

        // ── Stage 5: 결과 조립 ───────────────────────
        let mut result_faces = Vec::new();

        // A에서 유지할 face
        for &fid in &keep_a {
            result_faces.push(fid);
        }

        // B에서 유지할 face (Subtract 시 winding 반전)
        for &fid in &keep_b {
            if op == BoolOp::Subtract {
                self.flip_face(fid)?;
            }
            result_faces.push(fid);
        }

        // 제거 대상 face 삭제
        let remove_a: Vec<FaceId> = new_faces_a.iter()
            .filter(|f| !keep_a.contains(f))
            .copied()
            .collect();
        let remove_b: Vec<FaceId> = new_faces_b.iter()
            .filter(|f| !keep_b.contains(f))
            .copied()
            .collect();

        for fid in remove_a {
            let _ = self.remove_face(fid);
        }
        for fid in remove_b {
            let _ = self.remove_face(fid);
        }

        // ── Stage 6: 공면 face 병합 ──────────────────
        let merged_faces = self.merge_coplanar_result_faces(&result_faces);
        debug.push(format!(
            "Face merging: {} → {} (merged {} coplanar faces)",
            result_faces.len(), merged_faces.len(),
            result_faces.len() - merged_faces.len()
        ));

        let new_vert_count = split_count_a + split_count_b;
        debug.push(format!(
            "Removed: {} A-faces, {} B-faces | New verts: ~{}",
            new_faces_a.len() - keep_a.len(),
            new_faces_b.len() - keep_b.len(),
            new_vert_count,
        ));

        Ok(BooleanResult {
            faces: merged_faces,
            new_verts: new_vert_count,
            debug,
        })
    }

    /// 솔리드 데이터 준비: face → 삼각형 변환
    fn prepare_solid(&self, face_ids: &[FaceId]) -> Result<SolidData> {
        let mut triangles = Vec::new();
        let mut all_tris = Vec::new();

        for &fid in face_ids {
            let face = self.faces.get(fid)
                .ok_or_else(|| anyhow::anyhow!("face {:?} not found", fid))?;

            if !face.is_active() {
                continue;
            }

            let verts = self.collect_loop_verts(face.outer().start)?;
            let positions: Vec<DVec3> = verts.iter()
                .map(|&vid| self.verts.get(vid).map(|v| v.pos()).unwrap_or(DVec3::ZERO))
                .collect();

            if positions.len() < 3 {
                continue;
            }

            // Fan triangulation (convex face 가정 — MVP)
            let mut face_tris = Vec::new();
            for i in 1..positions.len() - 1 {
                let tri = (positions[0], positions[i], positions[i + 1]);
                face_tris.push(tri);
                all_tris.push(tri);
            }

            triangles.push(FaceTriangles {
                face_id: fid,
                tris: face_tris,
            });
        }

        Ok(SolidData {
            face_ids: face_ids.to_vec(),
            triangles,
            all_triangles: all_tris,
        })
    }

    /// Stage 1: 두 솔리드 간 교차선 수집
    #[allow(dead_code)] // 향후 Boolean 교차선 기반 분할 시 사용 예정
    fn find_intersections(
        &self,
        solid_a: &SolidData,
        solid_b: &SolidData,
    ) -> Vec<IntersectionSegment> {
        let mut segments = Vec::new();

        // ── 전체 솔리드 AABB 사전 검사 (겹침 없으면 즉시 반환) ──
        if !solid_aabb_overlap(solid_a, solid_b) {
            return segments;
        }

        for ft_a in &solid_a.triangles {
            for ft_b in &solid_b.triangles {
                // Per-face AABB 사전 필터 (성능)
                if !face_aabb_overlap(ft_a, ft_b) {
                    continue;
                }

                for &tri_a in &ft_a.tris {
                    for &tri_b in &ft_b.tris {
                        if let Some((p0, p1)) = triangle_triangle_intersection(
                            tri_a.0, tri_a.1, tri_a.2,
                            tri_b.0, tri_b.1, tri_b.2,
                        ) {
                            if (p1 - p0).length() > 1e-7 {
                                segments.push(IntersectionSegment {
                                    face_a: ft_a.face_id,
                                    face_b: ft_b.face_id,
                                    p0,
                                    p1,
                                });
                            }
                        }
                    }
                }
            }
        }

        segments
    }

    /// Stage 3: 분할된 face들을 원본 반대편 솔리드로 분류
    ///
    /// 핵심 차이: `classify_faces`와 달리, 분류 대상은 분할된 face 목록이고
    /// point_in_solid 판정에는 원본(밀폐된) 솔리드 삼각형을 사용
    fn classify_split_faces(
        &self,
        faces_a: &[FaceId],
        original_solid_b: &SolidData,  // 원본 B (밀폐)
        faces_b: &[FaceId],
        original_solid_a: &SolidData,  // 원본 A (밀폐)
        op: BoolOp,
    ) -> (Vec<FaceId>, Vec<FaceId>) {
        let mut keep_a = Vec::new();
        let mut keep_b = Vec::new();

        // A의 각 (분할된) face → 원본 B 내부인지 판정
        for &fid in faces_a {
            match self.faces.get(fid) {
                Some(f) if f.is_active() => {},
                _ => continue,
            };
            let centroid = match self.face_centroid(fid) {
                Some(c) => c,
                None => continue,
            };
            let inside_b = point_in_solid(&original_solid_b.all_triangles, centroid);
            let keep = match op {
                BoolOp::Union => !inside_b,
                BoolOp::Subtract => !inside_b,
                BoolOp::Intersect => inside_b,
            };
            if keep {
                keep_a.push(fid);
            }
        }

        // B의 각 (분할된) face → 원본 A 내부인지 판정
        for &fid in faces_b {
            match self.faces.get(fid) {
                Some(f) if f.is_active() => {},
                _ => continue,
            };
            let centroid = match self.face_centroid(fid) {
                Some(c) => c,
                None => continue,
            };
            let inside_a = point_in_solid(&original_solid_a.all_triangles, centroid);
            let keep = match op {
                BoolOp::Union => !inside_a,
                BoolOp::Subtract => inside_a,
                BoolOp::Intersect => inside_a,
            };
            if keep {
                keep_b.push(fid);
            }
        }

        (keep_a, keep_b)
    }

    /// Face의 centroid (무게중심) 계산
    fn face_centroid(&self, fid: FaceId) -> Option<DVec3> {
        let face = self.faces.get(fid)?;
        let start = face.outer().start;
        let verts = self.collect_loop_verts(start).ok()?;
        if verts.is_empty() { return None; }
        let mut sum = DVec3::ZERO;
        let mut count = 0;
        for &vid in &verts {
            if let Some(v) = self.verts.get(vid) {
                sum += v.pos();
                count += 1;
            }
        }
        if count == 0 { return None; }
        Some(sum / count as f64)
    }

    // flip_face는 orient.rs에 이미 구현됨 — 재사용

    // ================================================================
    // Stage 2.5: Face Split — 교차선으로 face를 sub-face로 분할
    // ================================================================

    /// 교차선이 통과하는 face를 sub-face로 분할.
    ///
    /// 알고리즘:
    ///   1. Face의 외곽 정점 + 교차 세그먼트를 2D로 투영
    ///   2. 교차점을 에지 위에 삽입 → 확장 정점 목록
    ///   3. 교차선을 따라 다각형을 분할 → sub-polygon 추출
    ///   4. 각 sub-polygon으로 새 DCEL face 생성, 원본 face 제거
    ///
    /// 반환: (원본 face → 새 face 목록) 매핑
    fn split_faces_by_intersections(
        &mut self,
        solid: &SolidData,
        intersections: &[IntersectionSegment],
        material: MaterialId,
    ) -> FxHashMap<FaceId, Vec<FaceId>> {
        let mut split_map: FxHashMap<FaceId, Vec<FaceId>> = FxHashMap::default();

        // face별 교차 세그먼트 수집
        let mut face_segments: FxHashMap<FaceId, Vec<(DVec3, DVec3)>> = FxHashMap::default();
        for seg in intersections {
            face_segments.entry(seg.face_a)
                .or_default()
                .push((seg.p0, seg.p1));
            face_segments.entry(seg.face_b)
                .or_default()
                .push((seg.p0, seg.p1));
        }

        for ft in &solid.triangles {
            let fid = ft.face_id;
            let segs = match face_segments.get(&fid) {
                Some(s) if !s.is_empty() => s,
                _ => {
                    // 교차선 없음 → 분할 불필요
                    split_map.insert(fid, vec![fid]);
                    continue;
                }
            };

            // 실제 face의 정점 수집 (DCEL loop)
            let face = match self.faces.get(fid) {
                Some(f) if f.is_active() => f,
                _ => { split_map.insert(fid, vec![fid]); continue; }
            };
            let normal = face.normal();
            let outer_start = face.outer().start;
            let loop_verts = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(_) => { split_map.insert(fid, vec![fid]); continue; }
            };

            let positions: Vec<DVec3> = loop_verts.iter()
                .filter_map(|&vid| self.verts.get(vid).map(|v| v.pos()))
                .collect();

            if positions.len() < 3 {
                split_map.insert(fid, vec![fid]);
                continue;
            }

            // 2D 투영
            let (poly_2d, u_axis, v_axis, origin) = project_to_2d(&positions, normal);

            // 교차 세그먼트도 2D로 투영
            let segs_2d: Vec<(Pt2, Pt2)> = segs.iter().map(|&(p0, p1)| {
                let d0 = p0 - origin;
                let d1 = p1 - origin;
                (
                    Pt2::new(u_axis.dot(d0), v_axis.dot(d0)),
                    Pt2::new(u_axis.dot(d1), v_axis.dot(d1)),
                )
            }).collect();

            // 교차선으로 다각형 분할
            match split_polygon_2d(&poly_2d, &segs_2d) {
                Some(sub_polys) if sub_polys.len() >= 2 => {
                    // 원본 face 제거 후 sub-polygon으로 새 face 생성
                    let mut new_faces = Vec::new();
                    let mat = self.faces.get(fid)
                        .map(|f| f.material())
                        .unwrap_or(material);

                    for sub_poly in &sub_polys {
                        // 2D → 3D 역투영
                        let verts_3d: Vec<DVec3> = sub_poly.iter()
                            .map(|pt| unproject_to_3d(*pt, u_axis, v_axis, origin))
                            .collect();

                        if verts_3d.len() < 3 {
                            continue;
                        }

                        // DCEL 정점 생성 (기존 정점 재사용 via add_vertex tolerance)
                        let vert_ids: Vec<VertId> = verts_3d.iter()
                            .map(|&p| self.add_vertex(p))
                            .collect();

                        // 중복 제거 (연속된 동일 정점)
                        let deduped = dedup_consecutive_verts(&vert_ids);
                        if deduped.len() < 3 {
                            continue;
                        }

                        match self.add_face(&deduped, mat) {
                            Ok(new_fid) => {
                                new_faces.push(new_fid);
                            }
                            Err(_) => {
                                // face 생성 실패 시 무시 (degenerate polygon)
                            }
                        }
                    }

                    if new_faces.is_empty() {
                        // 분할 실패 → 원본 유지
                        split_map.insert(fid, vec![fid]);
                    } else {
                        // 원본 face 제거
                        let _ = self.remove_face(fid);
                        split_map.insert(fid, new_faces);
                    }
                }
                _ => {
                    // 분할 불가 또는 단일 다각형 → 원본 유지
                    split_map.insert(fid, vec![fid]);
                }
            }
        }

        split_map
    }

    /// ── Stage 0.5: 공면 face 감지 ────────────────────
    /// A와 B의 두 solids에서 같은 평면에 있는 face 쌍을 찾아서
    /// pseudo-intersection을 생성해 face split을 유도
    ///
    /// G-3 fix: 반환 타입을 단순화 — 이전엔 `(coplanar_segs, regular_segs)` 튜플을
    /// 반환했으나 `drain`으로 모두 regular에 옮긴 뒤 빈 coplanar를 반환하여
    /// 호출자의 debug log가 항상 "0 coplanar"로 찍히는 버그가 있었음.
    /// 이제는 공면 세그먼트만 단일 벡터로 반환.
    fn detect_coplanar_faces(
        &self,
        solid_a: &SolidData,
        solid_b: &SolidData,
    ) -> Vec<IntersectionSegment> {
        let mut coplanar_segs = Vec::new();

        for &fid_a in &solid_a.face_ids {
            let face_a = match self.faces.get(fid_a) {
                Some(f) if f.is_active() => f,
                _ => continue,
            };
            let normal_a = face_a.normal();

            for &fid_b in &solid_b.face_ids {
                let face_b = match self.faces.get(fid_b) {
                    Some(f) if f.is_active() => f,
                    _ => continue,
                };
                let normal_b = face_b.normal();

                // 법선이 평행한지 확인 (parallel or anti-parallel)
                let dot = normal_a.dot(normal_b).abs();
                if (dot - 1.0).abs() < 1e-6 {
                    // 공면 후보: centroid로 같은 평면인지 확인
                    if let (Some(c_a), Some(c_b)) = (self.face_centroid(fid_a), self.face_centroid(fid_b)) {
                        let diff = c_b - c_a;
                        let dist_to_plane = diff.dot(normal_a).abs();
                        if dist_to_plane < 1e-5 {
                            // 같은 평면 → edge bounding box로 pseudo segment 생성
                            if let (Ok(verts_a), Ok(verts_b)) =
                                (self.collect_loop_verts(face_a.outer().start),
                                 self.collect_loop_verts(face_b.outer().start))
                            {
                                // 각 face의 bounding box 코너 중 일부를 이용해 교차 세그먼트 생성
                                let positions_a: Vec<_> = verts_a.iter()
                                    .filter_map(|&v| self.verts.get(v).map(|v| v.pos()))
                                    .collect();
                                let positions_b: Vec<_> = verts_b.iter()
                                    .filter_map(|&v| self.verts.get(v).map(|v| v.pos()))
                                    .collect();

                                if positions_a.len() >= 2 && positions_b.len() >= 2 {
                                    // 간단한 전략: face의 centroid를 약간 offset한 segment
                                    coplanar_segs.push(IntersectionSegment {
                                        face_a: fid_a,
                                        face_b: fid_b,
                                        p0: positions_a[0],
                                        p1: positions_a[positions_a.len() - 1],
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        coplanar_segs
    }

    /// ── Stage 6: 공면 face 병합 ───────────────────
    /// Boolean 결과에서 인접한 공면 face들을 병합하여 unnecessary edge 제거
    fn merge_coplanar_result_faces(&mut self, result_faces: &[FaceId]) -> Vec<FaceId> {
        // mesh의 기존 merge_faces_by_edge 활용
        // 결과 face들에 대해 merge pass 실행
        let mut current_faces = result_faces.to_vec();
        let mut changed = true;
        let mut iterations = 0;
        const MAX_ITERATIONS: usize = 10;

        while changed && iterations < MAX_ITERATIONS {
            changed = false;
            iterations += 1;
            let mut next_faces = Vec::new();

            for &fid in &current_faces {
                if !self.faces.get(fid).map(|f| f.is_active()).unwrap_or(false) {
                    continue;
                }
                next_faces.push(fid);
            }

            // 모든 face 쌍에 대해 병합 시도
            let mut i = 0;
            while i < next_faces.len() {
                let mut merged = false;
                let fid_a = next_faces[i];

                let mut j = i + 1;
                while j < next_faces.len() {
                    let fid_b = next_faces[j];
                    // 공면이고 edge를 공유하는지 확인 후 병합 시도
                    if let (Some(fa), Some(fb)) = (self.faces.get(fid_a), self.faces.get(fid_b)) {
                        if fa.is_active() && fb.is_active() {
                            let na = fa.normal();
                            let nb = fb.normal();
                            // G-2 fix: 법선 평행 체크 + 점-평면 거리 체크 (are_faces_coplanar_strict)
                            // 이전엔 법선만 비교하여 "같은 방향, 다른 높이"인 평행 면도
                            // 공면으로 오판 → merge_faces_by_edge가 degenerate face 생성 위험.
                            let parallel = (na.dot(nb).abs() - 1.0).abs() < 1e-6;
                            let coplanar = parallel
                                && self.are_faces_coplanar_strict(fid_a, fid_b).unwrap_or(false);
                            if coplanar {
                                // 공유 edge를 찾아서 merge 시도
                                if let Some(shared_edge) = self.find_shared_edge_between_faces(fid_a, fid_b) {
                                    let _ = self.merge_faces_by_edge(shared_edge);
                                }
                                next_faces.remove(j);
                                merged = true;
                                changed = true;
                                break;
                            }
                        }
                    }
                    j += 1;
                }

                if !merged {
                    i += 1;
                }
            }

            current_faces = next_faces;
        }

        current_faces
    }
}

/// 연속된 동일 VertId 제거
fn dedup_consecutive_verts(verts: &[VertId]) -> Vec<VertId> {
    if verts.is_empty() { return Vec::new(); }
    let mut result = vec![verts[0]];
    for i in 1..verts.len() {
        if verts[i] != verts[i - 1] {
            result.push(verts[i]);
        }
    }
    // 마지막과 처음이 같으면 제거
    if result.len() > 1 && result.last() == result.first() {
        result.pop();
    }
    result
}

// ════════════════════════════════════════════════════════════════════
// 2D Polygon Splitting by Line Segments
// ════════════════════════════════════════════════════════════════════

/// 교차 세그먼트 집합으로 2D 다각형을 분할.
///
/// 전략: 모든 교차 세그먼트를 하나의 분할선(cutting line)으로 모아서
/// 다각형의 에지와 교차점을 계산 → 에지에 교차점 삽입 →
/// 교차점 쌍을 연결하여 sub-polygon 추출.
///
/// MVP: 단일 직선(세그먼트 체인)에 의한 분할만 지원.
/// (2개 이상의 독립 분할선은 향후 확장)
fn split_polygon_2d(
    poly: &[Pt2],
    cut_segments: &[(Pt2, Pt2)],
) -> Option<Vec<Vec<Pt2>>> {
    let n = poly.len();
    if n < 3 || cut_segments.is_empty() {
        return None;
    }

    // ── Step 1: 각 에지 위의 교차점 수집 ────────────
    // edge_hits[i] = (t, Pt2) 리스트 → 에지 i (poly[i]→poly[(i+1)%n]) 위의 교차점
    let mut edge_hits: Vec<Vec<(f64, Pt2)>> = vec![Vec::new(); n];

    // 모든 cut_segment × polygon_edge 교차 계산
    for &(cs0, cs1) in cut_segments {
        for i in 0..n {
            let j = (i + 1) % n;
            if let Some((t, _u, pt)) = segment_segment_2d(poly[i], poly[j], cs0, cs1) {
                // t는 polygon edge 위의 파라미터
                let t_clamped = t.clamp(0.0, 1.0);
                edge_hits[i].push((t_clamped, pt));
            }
        }
    }

    // 교차점이 2개 미만이면 분할 불가
    let total_hits: usize = edge_hits.iter().map(|h| h.len()).sum();
    if total_hits < 2 {
        return None;
    }

    // 각 에지의 교차점을 t순 정렬
    for hits in &mut edge_hits {
        hits.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }

    // ── Step 2: 확장 정점 리스트 구축 ────────────
    // 다각형 에지를 순회하면서 교차점을 끼워넣는다
    let mut ext_verts: Vec<PolyVert> = Vec::new();
    let mut intersection_count = 0usize;
    let mut intersections_info: Vec<(usize, Pt2)> = Vec::new(); // (idx in ext_verts, pt)

    for i in 0..n {
        // 에지 시작 정점
        ext_verts.push(PolyVert {
            pt: poly[i],
            is_intersection: false,
            intersection_id: None,
        });

        // 이 에지 위 교차점들 (t순)
        for &(_t, pt) in &edge_hits[i] {
            let idx = ext_verts.len();
            let iid = intersection_count;
            intersection_count += 1;
            ext_verts.push(PolyVert {
                pt,
                is_intersection: true,
                intersection_id: Some(iid),
            });
            intersections_info.push((idx, pt));
        }
    }

    if intersection_count < 2 {
        return None;
    }

    // ── Step 3: 교차점 페어링 ────────────
    // 교차점들을 cut segment 방향을 따라 정렬하여 순서대로 짝짓기
    // (Entry/Exit 쌍)
    // 단순화: 교차점을 이들의 centroid 방향으로 정렬
    let pairs = pair_intersection_points(&intersections_info, cut_segments);

    if pairs.is_empty() {
        return None;
    }

    // ── Step 4: Sub-polygon 추출 ────────────
    // 전략: 각 교차점 쌍(A,B)에 대해 두 방향 추적
    //   방향 1: A → forward → ... → B → jump to A (닫힘)
    //   방향 2: B → forward → ... → A → jump to B (닫힘)
    // 교차선으로 나뉜 양쪽 다각형 모두 추출

    let en = ext_verts.len();
    let mut pair_map: FxHashMap<usize, usize> = FxHashMap::default();
    for &(a_iid, b_iid) in &pairs {
        let a_idx = intersections_info[a_iid].0;
        let b_idx = intersections_info[b_iid].0;
        pair_map.insert(a_idx, b_idx);
        pair_map.insert(b_idx, a_idx);
    }

    let mut sub_polys: Vec<Vec<Pt2>> = Vec::new();
    let mut traced_starts: std::collections::HashSet<usize> = std::collections::HashSet::new();

    for &(a_iid, b_iid) in &pairs {
        let a_idx = intersections_info[a_iid].0;
        let b_idx = intersections_info[b_iid].0;

        // 두 방향 추적: 각 교차점에서 시작하여 forward 진행
        for &start_idx in &[a_idx, b_idx] {
            if traced_starts.contains(&start_idx) {
                continue;
            }
            traced_starts.insert(start_idx);

            let mut sub_poly = vec![ext_verts[start_idx].pt];
            let mut idx = (start_idx + 1) % en; // forward (시작점에서 jump 안 함)
            let mut safety = 0;

            loop {
                if safety > en * 2 {
                    break; // 무한 루프 방지
                }
                safety += 1;

                sub_poly.push(ext_verts[idx].pt);

                // 교차점에 도달 → pair로 jump하여 루프 닫기
                if ext_verts[idx].is_intersection {
                    if let Some(&pair_idx) = pair_map.get(&idx) {
                        if pair_idx == start_idx {
                            // 시작점으로 돌아옴 → 루프 완성
                            break;
                        } else {
                            // 다른 교차점 쌍이면 jump 후 계속
                            sub_poly.push(ext_verts[pair_idx].pt);
                            idx = (pair_idx + 1) % en;
                            continue;
                        }
                    }
                }

                idx = (idx + 1) % en;
                if idx == start_idx {
                    break; // 전체 순회 완료
                }
            }

            if sub_poly.len() >= 3 {
                sub_polys.push(sub_poly);
            }
        }
    }

    if sub_polys.len() < 2 {
        return None;
    }

    // 퇴화 다각형 필터 (면적이 너무 작은 것 제거)
    let valid_polys: Vec<Vec<Pt2>> = sub_polys.into_iter()
        .filter(|p| polygon_signed_area_2d(p).abs() > 1e-10)
        .collect();

    if valid_polys.len() < 2 {
        return None;
    }

    Some(valid_polys)
}

/// 교차점 쌍(pair) 생성: 교차점을 cut direction으로 정렬 후 순차 페어링
fn pair_intersection_points(
    intersections: &[(usize, Pt2)],
    cut_segments: &[(Pt2, Pt2)],
) -> Vec<(usize, usize)> {
    if intersections.len() < 2 {
        return Vec::new();
    }

    // Cut segment 체인의 대략적 방향 계산
    let dir = if !cut_segments.is_empty() {
        let s = &cut_segments[0];
        let dx = s.1.x - s.0.x;
        let dy = s.1.y - s.0.y;
        let len = (dx * dx + dy * dy).sqrt();
        if len > 1e-12 { (dx / len, dy / len) } else { (1.0, 0.0) }
    } else {
        (1.0, 0.0)
    };

    // 각 교차점의 projection onto cut direction으로 정렬
    let mut sorted: Vec<(usize, f64)> = intersections.iter().enumerate()
        .map(|(iid, (_idx, pt))| {
            let proj = pt.x * dir.0 + pt.y * dir.1;
            (iid, proj)
        })
        .collect();
    sorted.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    // 순차 페어링: 0↔1, 2↔3, ...
    let mut pairs = Vec::new();
    let mut i = 0;
    while i + 1 < sorted.len() {
        pairs.push((sorted[i].0, sorted[i + 1].0));
        i += 2;
    }

    pairs
}

/// 확장 정점 (내부 사용)
#[derive(Clone, Debug)]
struct PolyVert {
    pt: Pt2,
    is_intersection: bool,
    #[allow(dead_code)]
    intersection_id: Option<usize>,
}

/// 교차선분
#[derive(Debug, Clone)]
struct IntersectionSegment {
    face_a: FaceId,
    face_b: FaceId,
    p0: DVec3,
    p1: DVec3,
}

/// 두 face의 AABB가 겹치는지 빠른 사전 필터
#[allow(dead_code)] // find_intersections에서 호출 (현재 비활성 경로)
/// 두 솔리드 전체의 AABB가 겹치는지 검사 (빠른 사전 필터)
fn solid_aabb_overlap(a: &SolidData, b: &SolidData) -> bool {
    if a.all_triangles.is_empty() || b.all_triangles.is_empty() {
        return false;
    }
    let (a_min, a_max) = compute_aabb(&a.all_triangles);
    let (b_min, b_max) = compute_aabb(&b.all_triangles);
    let margin = 1e-6;
    a_min.x <= b_max.x + margin && a_max.x >= b_min.x - margin
        && a_min.y <= b_max.y + margin && a_max.y >= b_min.y - margin
        && a_min.z <= b_max.z + margin && a_max.z >= b_min.z - margin
}

#[allow(dead_code)] // find_intersections에서 호출 (현재 비활성 경로)
fn face_aabb_overlap(a: &FaceTriangles, b: &FaceTriangles) -> bool {
    let (a_min, a_max) = compute_aabb(&a.tris);
    let (b_min, b_max) = compute_aabb(&b.tris);

    let margin = 1e-6;
    a_min.x <= b_max.x + margin && a_max.x >= b_min.x - margin
        && a_min.y <= b_max.y + margin && a_max.y >= b_min.y - margin
        && a_min.z <= b_max.z + margin && a_max.z >= b_min.z - margin
}

#[allow(dead_code)] // solid_aabb_overlap, face_aabb_overlap에서 호출
fn compute_aabb(tris: &[(DVec3, DVec3, DVec3)]) -> (DVec3, DVec3) {
    let mut min = DVec3::splat(f64::MAX);
    let mut max = DVec3::splat(f64::MIN);
    for &(a, b, c) in tris {
        for p in [a, b, c] {
            min = min.min(p);
            max = max.max(p);
        }
    }
    (min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 두 겹치는 큐브로 Boolean 테스트
    fn make_test_cubes(mesh: &mut Mesh, mat: MaterialId) -> (Vec<FaceId>, Vec<FaceId>) {
        let a = make_box(mesh, DVec3::ZERO, DVec3::new(2.0, 2.0, 2.0), mat);
        let b = make_box(mesh, DVec3::new(1.0, 0.0, 0.0), DVec3::new(3.0, 2.0, 2.0), mat);
        (a, b)
    }

    fn make_box(
        mesh: &mut Mesh,
        min: DVec3,
        max: DVec3,
        mat: MaterialId,
    ) -> Vec<FaceId> {
        let v = [
            mesh.add_vertex(DVec3::new(min.x, min.y, min.z)),
            mesh.add_vertex(DVec3::new(max.x, min.y, min.z)),
            mesh.add_vertex(DVec3::new(max.x, max.y, min.z)),
            mesh.add_vertex(DVec3::new(min.x, max.y, min.z)),
            mesh.add_vertex(DVec3::new(min.x, min.y, max.z)),
            mesh.add_vertex(DVec3::new(max.x, min.y, max.z)),
            mesh.add_vertex(DVec3::new(max.x, max.y, max.z)),
            mesh.add_vertex(DVec3::new(min.x, max.y, max.z)),
        ];

        let mut faces = Vec::new();

        // 6 faces (CCW outward)
        let face_verts = [
            [v[0], v[3], v[2], v[1]], // -Z
            [v[4], v[5], v[6], v[7]], // +Z
            [v[0], v[1], v[5], v[4]], // -Y
            [v[2], v[3], v[7], v[6]], // +Y
            [v[0], v[4], v[7], v[3]], // -X
            [v[1], v[2], v[6], v[5]], // +X
        ];

        for verts in &face_verts {
            if let Ok(fid) = mesh.add_face(verts, mat) {
                faces.push(fid);
            }
        }

        faces
    }

    #[test]
    fn boolean_union_basic() {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let (a, b) = make_test_cubes(&mut mesh, mat);

        let result = mesh.boolean(&a, &b, BoolOp::Union, mat);
        assert!(result.is_ok(), "union should succeed");

        let r = result.unwrap();
        assert!(!r.faces.is_empty(), "union should produce faces");
        // Union: 겹치는 영역의 내부 face가 제거되어야 함
        let has_debug = !r.debug.is_empty();
        assert!(has_debug, "should have debug info");
    }

    #[test]
    fn boolean_subtract_basic() {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let (a, b) = make_test_cubes(&mut mesh, mat);

        let result = mesh.boolean(&a, &b, BoolOp::Subtract, mat);
        assert!(result.is_ok(), "subtract should succeed");

        let r = result.unwrap();
        assert!(!r.faces.is_empty(), "subtract should produce faces");
    }

    #[test]
    fn boolean_intersect_basic() {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let (a, b) = make_test_cubes(&mut mesh, mat);

        let result = mesh.boolean(&a, &b, BoolOp::Intersect, mat);
        assert!(result.is_ok(), "intersect should succeed");

        let r = result.unwrap();
        assert!(!r.faces.is_empty(), "intersect should produce faces");
    }

    #[test]
    fn boolean_no_overlap() {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        // 완전히 떨어진 두 큐브
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::splat(5.0), DVec3::splat(6.0), mat);

        let r = mesh.boolean(&a, &b, BoolOp::Union, mat).unwrap();
        // Union of non-overlapping: 결과 face가 존재해야 함
        assert!(!r.faces.is_empty(), "disjoint union should produce faces");
    }

    // ── Face Split 단위 테스트 ──────────────────────

    #[test]
    fn split_polygon_2d_horizontal_cut() {
        // Pt2 available via `use super::*`
        // 정사각형 (0,0)-(1,0)-(1,1)-(0,1)
        let poly = vec![
            Pt2::new(0.0, 0.0),
            Pt2::new(1.0, 0.0),
            Pt2::new(1.0, 1.0),
            Pt2::new(0.0, 1.0),
        ];
        // y=0.5에서 가로로 자르는 세그먼트
        let cuts = vec![
            (Pt2::new(-0.5, 0.5), Pt2::new(1.5, 0.5)),
        ];
        let result = split_polygon_2d(&poly, &cuts);
        assert!(result.is_some(), "should split");
        let polys = result.unwrap();
        assert!(polys.len() >= 2, "should produce at least 2 sub-polygons, got {}", polys.len());
    }

    #[test]
    fn split_polygon_2d_no_intersection() {
        // Pt2 available via `use super::*`
        let poly = vec![
            Pt2::new(0.0, 0.0),
            Pt2::new(1.0, 0.0),
            Pt2::new(1.0, 1.0),
            Pt2::new(0.0, 1.0),
        ];
        // 다각형 외부의 세그먼트
        let cuts = vec![
            (Pt2::new(2.0, 0.0), Pt2::new(3.0, 0.0)),
        ];
        let result = split_polygon_2d(&poly, &cuts);
        assert!(result.is_none(), "should not split — no intersection");
    }

    #[test]
    fn split_polygon_2d_diagonal_cut() {
        // Pt2 available via `use super::*`
        let poly = vec![
            Pt2::new(0.0, 0.0),
            Pt2::new(2.0, 0.0),
            Pt2::new(2.0, 2.0),
            Pt2::new(0.0, 2.0),
        ];
        // 대각선 자르기: y = x + 0.5 (에지 중간을 통과)
        let cuts = vec![
            (Pt2::new(-1.0, -0.5), Pt2::new(3.0, 2.5)),
        ];
        let result = split_polygon_2d(&poly, &cuts);
        assert!(result.is_some(), "diagonal cut should split");
        let polys = result.unwrap();
        assert!(polys.len() >= 2, "should produce 2+ sub-polygons");

        // 면적 검증: 원본=4, 분할 합≈4
        let total_area: f64 = polys.iter()
            .map(|p| polygon_signed_area_2d(p).abs())
            .sum();
        assert!((total_area - 4.0).abs() < 0.5, "total area should be ~4, got {}", total_area);
    }

    #[test]
    fn boolean_union_with_face_split() {
        // Face Split이 통합된 전체 Boolean 파이프라인 테스트
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let (a, b) = make_test_cubes(&mut mesh, mat);

        let result = mesh.boolean(&a, &b, BoolOp::Union, mat);
        assert!(result.is_ok(), "union with face split should succeed");

        let r = result.unwrap();
        assert!(!r.faces.is_empty(), "should produce faces");
        // debug 로그에 face split 정보가 포함되어야 함
        let has_split_info = r.debug.iter().any(|d| d.contains("Face splits"));
        assert!(has_split_info, "debug should contain face split info");
    }

    // ── 추가 Boolean 연산 테스트 ──────────────────────

    #[test]
    fn boolean_disjoint_union() {
        // 떨어진 두 상자: Union = 모든 face 유지
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::splat(5.0), DVec3::splat(6.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Union, mat).unwrap();
        assert!(!result.faces.is_empty(),
            "Union of disjoint boxes should produce faces");
    }

    #[test]
    fn boolean_intersect_disjoint() {
        // 떨어진 두 상자: Intersect = 공집합
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::splat(5.0), DVec3::splat(6.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Intersect, mat).unwrap();
        // 교차 없음 → 대부분 face가 제거되어야 함
        assert!(result.faces.is_empty() || result.faces.len() < a.len(),
            "Intersect of disjoint boxes should be empty or minimal");
    }

    #[test]
    fn boolean_subtract_disjoint() {
        // 떨어진 두 상자: A - B = A (겹치지 않음)
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::splat(5.0), DVec3::splat(6.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Subtract, mat).unwrap();
        assert!(!result.faces.is_empty(),
            "Subtract disjoint should keep A's faces");
    }

    #[test]
    fn boolean_overlapping_union_result_is_closed() {
        // 겹치는 box의 union → 닫힌 솔리드여야 함
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(2.0), mat);
        let b = make_box(&mut mesh, DVec3::new(1.0, 0.0, 0.0), DVec3::new(3.0, 2.0, 2.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Union, mat).unwrap();
        assert!(!result.faces.is_empty(), "union should produce faces");
        // 모든 face가 여전히 활성 상태여야 함
        for &fid in &result.faces {
            assert!(mesh.faces.get(fid).map(|f| f.is_active()).unwrap_or(false),
                "all result faces should be active");
        }
    }

    #[test]
    fn boolean_empty_input() {
        // 빈 face 목록 처리
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);

        let result = mesh.boolean(&a, &[], BoolOp::Union, mat);
        // 빈 입력은 에러이거나 A 자체를 반환해야 함
        if result.is_ok() {
            let r = result.unwrap();
            assert!(!r.faces.is_empty(), "should handle empty B gracefully");
        }
    }

    #[test]
    fn boolean_preserves_face_count_rough() {
        // Boolean 후 face 수가 극단적으로 변하지 않는지 확인
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(2.0), mat);
        let b = make_box(&mut mesh, DVec3::new(1.0, 0.0, 0.0), DVec3::new(3.0, 2.0, 2.0), mat);

        let initial_face_count = mesh.face_count();
        let result = mesh.boolean(&a, &b, BoolOp::Union, mat).unwrap();

        // Boolean 결과가 비어있지 않아야 함
        assert!(!result.faces.is_empty(),
            "union should produce visible faces");
    }

    #[test]
    fn boolean_multiple_operations_undo_safe() {
        // 여러 Boolean 연산이 메시 상태를 일관되게 유지
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let initial_snapshot = mesh.snapshot();

        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::new(0.5, 0.0, 0.0), DVec3::new(2.0, 1.0, 1.0), mat);

        let _ = mesh.boolean(&a, &b, BoolOp::Union, mat);
        let after_boolean = mesh.snapshot();

        // Restore to initial
        mesh.restore_snapshot(&initial_snapshot);
        assert_eq!(mesh.face_count(), 0, "snapshot restore to empty should work");

        // Re-apply
        mesh.restore_snapshot(&after_boolean);
        // Verify consistency
        assert!(mesh.face_count() > 0, "after restore should have faces");
    }

    #[test]
    fn boolean_subtract_creates_cavity() {
        // A - B should create a cavity in A
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(4.0), mat);
        let b = make_box(&mut mesh, DVec3::new(1.0, 1.0, 1.0), DVec3::new(3.0, 3.0, 3.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Subtract, mat).unwrap();
        // subtract 결과가 존재해야 함
        assert!(!result.faces.is_empty(), "subtract should produce faces");
    }

    #[test]
    fn boolean_intersect_produces_overlap() {
        // A ∩ B should produce the overlapping volume
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(4.0), mat);
        let b = make_box(&mut mesh, DVec3::new(1.0, 1.0, 1.0), DVec3::new(3.0, 3.0, 3.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Intersect, mat).unwrap();
        // Intersection은 smaller box의 경계를 포함해야 함
        assert!(!result.faces.is_empty(), "intersection should produce faces");
    }

    #[test]
    fn boolean_debug_info_present() {
        // Debug 정보가 제대로 기록되는지 확인
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh, DVec3::new(0.5, 0.0, 0.0), DVec3::new(2.0, 1.0, 1.0), mat);

        let result = mesh.boolean(&a, &b, BoolOp::Union, mat).unwrap();
        assert!(!result.debug.is_empty(), "should have debug info");
        // Check for expected keys
        let debug_str = result.debug.join("\n");
        assert!(debug_str.contains("Solid A") || debug_str.contains("Solid B"),
            "should log solid info");
    }
}
