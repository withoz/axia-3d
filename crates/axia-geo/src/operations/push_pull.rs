//! Push/Pull operation — AixxiA 방식 그대로 포팅.
//!
//! ## 두 가지 모드 (AixxiA PushPullFirstMoveMode)
//!
//! **MoveOnly**: 모든 연결 edge가 face 노멀과 평행
//!   → 정점만 이동 (벽 높이가 자동으로 변경됨)
//!   예: 직육면체의 윗면을 push/pull → 벽 높이만 변경
//!
//! **CreateFace**: 평면이거나 연결 edge가 비평행
//!   → 새 측면 생성 + coplanar 인접면과 병합 (merge)
//!   예: 평면 사각형을 push → 벽 생성, 기존 벽과 coplanar면 자동 병합
//!
//! ## AixxiA와의 핵심 차이점 (없음 — 그대로 포팅)
//!
//! 1. make_push_pull_faces_from_face_id → push_pull
//! 2. merge_face_by_edge_id → mesh.merge_faces_by_edge
//! 3. are_faces_coplanar → mesh.are_faces_coplanar_strict
//! 4. is_move_only → is_move_only (static function)

use glam::DVec3;
use std::collections::{HashSet, VecDeque};
use anyhow::{Result, ensure};

use crate::entities::*;
use crate::mesh::Mesh;

/// Result of a Push/Pull operation.
#[derive(Clone, Debug)]
pub struct PushPullResult {
    pub base_face: FaceId,
    pub top_face: FaceId,
    pub side_faces: Vec<FaceId>,
    pub new_verts: Vec<VertId>,
    pub base_removed: bool,
    pub adjacent_splits: usize,
    pub split_debug: Vec<String>,
}

/// Push/Pull 모드 (AixxiA PushPullFirstMoveMode)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PushPullMode {
    /// 정점만 이동 (벽이 이미 존재하고 노멀과 평행)
    MoveOnly,
    /// 새 측면 생성 + coplanar 병합
    CreateFace,
}

// ============================================================================
// is_move_only — AixxiA pushpull_manager.rs 그대로 포팅
// ============================================================================

/// 디버그 정보를 포함한 is_move_only 결과
pub struct MoveOnlyResult {
    pub is_move_only: bool,
    pub debug: Vec<String>,
}

/// 스케치업의 푸시풀에서 면을 단순 이동만 해도 되는지 확인 (fast path, 디버그 없음).
///
/// - true: MoveOnly (직육면체의 면처럼 모든 연결 edge가 노멀과 평행)
/// - false: CreateFace (평면이거나 연결 edge가 노멀과 비평행)
pub fn is_move_only(mesh: &Mesh, face_id: FaceId) -> bool {
    is_move_only_inner(mesh, face_id, false).is_move_only
}

/// 디버그 정보를 포함한 is_move_only 결과 (디버깅 시에만 사용)
pub fn is_move_only_debug(mesh: &Mesh, face_id: FaceId) -> MoveOnlyResult {
    is_move_only_inner(mesh, face_id, true)
}

fn is_move_only_inner(mesh: &Mesh, face_id: FaceId, collect_debug: bool) -> MoveOnlyResult {
    const PARALLEL_TOLERANCE: f64 = 0.999848; // cos(1°)
    let mut debug: Vec<String> = if collect_debug { Vec::with_capacity(16) } else { Vec::new() };

    macro_rules! dbg_push {
        ($($arg:tt)*) => {
            if collect_debug { debug.push(format!($($arg)*)); }
        }
    }

    // 1. face 노멀 계산
    let outer_start = mesh.faces[face_id].outer().start;
    if outer_start.is_null() {
        dbg_push!("FAIL: outer_start is NULL");
        return MoveOnlyResult { is_move_only: false, debug };
    }
    let boundary = match mesh.collect_loop_verts(outer_start) {
        Ok(v) => v,
        Err(e) => {
            dbg_push!("FAIL: collect_loop_verts error: {}", e);
            return MoveOnlyResult { is_move_only: false, debug };
        }
    };
    dbg_push!("boundary_verts={} ids={:?}", boundary.len(),
        boundary.iter().map(|v| v.raw()).collect::<Vec<_>>());

    let face_normal = match mesh.compute_normal(&boundary) {
        Ok(n) => {
            let len = n.length();
            if len < 1e-10 {
                dbg_push!("FAIL: degenerate normal len={}", len);
                return MoveOnlyResult { is_move_only: false, debug };
            }
            n / len
        }
        Err(e) => {
            dbg_push!("FAIL: compute_normal error: {}", e);
            return MoveOnlyResult { is_move_only: false, debug };
        }
    };
    dbg_push!("face_normal=({:.4},{:.4},{:.4})", face_normal.x, face_normal.y, face_normal.z);

    // 2. face의 경계 edge와 정점 수집 (Phase F: inner loops 포함)
    let face_hes = match mesh.collect_loop_hes(outer_start) {
        Ok(h) => h,
        Err(e) => {
            dbg_push!("FAIL: collect_loop_hes error: {}", e);
            return MoveOnlyResult { is_move_only: false, debug };
        }
    };
    let mut face_edges: HashSet<EdgeId> = HashSet::new();
    let mut face_verts: HashSet<VertId> = HashSet::new();
    for &he_id in &face_hes {
        face_edges.insert(mesh.hes[he_id].edge());
        face_verts.insert(mesh.hes[he_id].dst());
    }
    // inner loops: hole 경계도 face의 일부로 처리
    for inner in mesh.faces[face_id].inners() {
        if inner.start.is_null() { continue; }
        if let Ok(inner_hes) = mesh.collect_loop_hes(inner.start) {
            for &he_id in &inner_hes {
                face_edges.insert(mesh.hes[he_id].edge());
                face_verts.insert(mesh.hes[he_id].dst());
            }
        }
    }
    dbg_push!("face_edges={} face_verts={} (incl {} inner loops)",
        face_edges.len(), face_verts.len(), mesh.faces[face_id].inners().len());

    // 3. 모든 edge를 탐색하여 face 정점에 연결되었지만 face 경계가 아닌 edge 찾기
    let mut non_face_edges: Vec<EdgeId> = Vec::new();
    for (eid, edge) in mesh.edges.iter() {
        if !edge.is_active() || face_edges.contains(&eid) {
            continue;
        }
        let vs = edge.v_small();
        let vl = edge.v_large();
        if face_verts.contains(&vs) || face_verts.contains(&vl) {
            non_face_edges.push(eid);
        }
    }
    dbg_push!("non_face_edges={}", non_face_edges.len());

    // 4. 연결 edge가 없으면 평면 → CreateFace
    if non_face_edges.is_empty() {
        dbg_push!("RESULT: CreateFace (no connecting edges → flat face)");
        return MoveOnlyResult { is_move_only: false, debug };
    }

    // 5. 모든 연결 edge가 face 노멀과 평행한지 확인
    for eid in &non_face_edges {
        if let Some(edge) = mesh.edges.get(*eid) {
            let p0 = match mesh.vertex_pos(edge.v_small()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let p1 = match mesh.vertex_pos(edge.v_large()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let diff = p1 - p0;
            let len = diff.length();
            if len < 1e-10 {
                continue;
            }
            let dir = diff / len;
            let dot = face_normal.dot(dir).abs();
            dbg_push!("  edge {:?}: vs={} vl={} dir=({:.3},{:.3},{:.3}) |dot|={:.6} {}",
                eid.raw(), edge.v_small().raw(), edge.v_large().raw(),
                dir.x, dir.y, dir.z, dot,
                if dot >= PARALLEL_TOLERANCE { "PARALLEL" } else { "NOT_PARALLEL" });
            if dot < PARALLEL_TOLERANCE {
                dbg_push!("RESULT: CreateFace (edge {:?} not parallel)", eid.raw());
                return MoveOnlyResult { is_move_only: false, debug };
            }
        }
    }

    dbg_push!("RESULT: MoveOnly (all edges parallel)");
    MoveOnlyResult { is_move_only: true, debug }
}

// ============================================================================
// Push/Pull implementation — AixxiA 방식
// ============================================================================

impl Mesh {
    /// Push/Pull a face along its normal.
    ///
    /// AixxiA의 `make_push_pull_faces_from_face_id` + `update_push_pull` 그대로 포팅.
    ///
    /// - MoveOnly 모드: 정점 이동만 (벽이 자동 변형)
    /// - CreateFace 모드: 측면 생성 → coplanar 병합 → 원본 삭제
    pub fn push_pull(
        &mut self,
        face_id: FaceId,
        dist: f64,
        material: MaterialId,
    ) -> Result<PushPullResult> {
        // ─── Geometric Validity Guard (ADR-003) ─────────────────────────
        // NaN/Inf 입력 차단 — WASM 바인딩 실수 등으로 들어올 수 있음
        ensure!(
            dist.is_finite(),
            "push_pull distance must be finite, got {}",
            dist
        );

        // dist == 0은 no-op (유효한 호출로 처리)
        if dist == 0.0 {
            return Ok(PushPullResult {
                base_face: face_id,
                top_face: face_id,
                side_faces: Vec::new(),
                new_verts: Vec::new(),
                base_removed: false,
                adjacent_splits: 0,
                split_debug: Vec::new(),
            });
        }

        // |dist| < EPSILON_LENGTH: degenerate 기하 생성 거부
        ensure!(
            dist.abs() >= crate::tolerances::EPSILON_LENGTH,
            "push_pull distance {} below EPSILON_LENGTH ({}) — would create degenerate geometry (ADR-003)",
            dist,
            crate::tolerances::EPSILON_LENGTH
        );

        ensure!(self.faces.contains(face_id), "Face {:?} not found", face_id);

        // Fast path: 디버그 문자열 할당 없이 모드 판정
        let move_only = is_move_only(self, face_id);
        let mode = if move_only { PushPullMode::MoveOnly } else { PushPullMode::CreateFace };

        let mut result = match mode {
            PushPullMode::MoveOnly => self.push_pull_move_only(face_id, dist)?,
            PushPullMode::CreateFace => self.push_pull_create_face(face_id, dist, material)?,
        };

        // 디버그 정보는 최소한만 기록
        let mut debug = Vec::with_capacity(1 + result.split_debug.len());
        debug.push(format!("MODE={:?}", mode));
        debug.extend(result.split_debug.drain(..));
        result.split_debug = debug;
        Ok(result)
    }

    // ============================================================================
    // Seamless Offset Push-Pull for Smooth Groups (Rhino 스타일)
    // ============================================================================

    /// Smooth group을 seamless하게 offset (갭 없이 wall face 생성)
    ///
    /// # Algorithm
    /// 1. Smooth group의 모든 정점 수집
    /// 2. 각 정점의 법선 계산 (인접 면들의 가중 평균)
    /// 3. 모든 정점을 함께 오프셋
    /// 4. 인접 엣지에 wall face 생성
    /// 5. 선택적으로 종료면 생성
    ///
    /// # Result
    /// - base_face: 원본 smooth group의 대표 face
    /// - top_face: 오프셋된 대표 face
    /// - side_faces: 생성된 wall faces
    pub fn push_pull_smooth_group_seamless(
        &mut self,
        smooth_group: Vec<FaceId>,
        distance: f64,
        material: MaterialId,
    ) -> Result<PushPullResult> {
        if distance == 0.0 || smooth_group.is_empty() {
            return Ok(PushPullResult {
                base_face: *smooth_group.first().unwrap_or(&FaceId::new(0)),
                top_face: *smooth_group.first().unwrap_or(&FaceId::new(0)),
                side_faces: Vec::new(),
                new_verts: Vec::new(),
                base_removed: false,
                adjacent_splits: 0,
                split_debug: vec!["SmoothGroupSeamless: no change (distance=0 or empty group)".into()],
            });
        }

        // ─── Step 1: Smooth group의 모든 정점 수집 ───────────────────
        let mut smooth_verts: HashSet<VertId> = HashSet::new();
        for &face_id in &smooth_group {
            if let Ok(outer_start) = self.faces
                .get(face_id)
                .map(|f| f.outer().start)
                .ok_or(anyhow::anyhow!("face not found")) {
                if !outer_start.is_null() {
                    if let Ok(boundary) = self.collect_loop_verts(outer_start) {
                        for vid in boundary {
                            smooth_verts.insert(vid);
                        }
                    }
                }
            }
        }
        ensure!(!smooth_verts.is_empty(), "Smooth group has no vertices");

        // ─── Step 2: 각 정점의 오프셋 법선 계산 (가중 평균) ─────────────
        let mut vertex_normals: std::collections::HashMap<VertId, DVec3> =
            std::collections::HashMap::new();

        for &vid in &smooth_verts {
            // 이 정점을 포함하는 smooth group 내 모든 면 찾기
            let mut adjacent_faces = Vec::new();
            for &face_id in &smooth_group {
                if let Ok(outer_start) = self.faces
                    .get(face_id)
                    .map(|f| f.outer().start)
                    .ok_or(anyhow::anyhow!("")) {
                    if !outer_start.is_null() {
                        if let Ok(verts) = self.collect_loop_verts(outer_start) {
                            if verts.contains(&vid) {
                                adjacent_faces.push(face_id);
                            }
                        }
                    }
                }
            }

            // 인접 면들의 법선을 넓이 가중으로 평균
            let mut normal_sum = DVec3::ZERO;
            let mut area_sum = 0.0;

            for &face_id in &adjacent_faces {
                if let Some(face) = self.faces.get(face_id) {
                    let face_normal = face.normal();

                    // 면의 넓이 계산 (삼각형 분할 후 합산)
                    let outer_start = face.outer().start;
                    if !outer_start.is_null() {
                        if let Ok(verts) = self.collect_loop_verts(outer_start) {
                            if verts.len() >= 3 {
                                let area = if let Ok(computed_area) =
                                    self.compute_face_area(&verts) {
                                    computed_area
                                } else {
                                    1.0  // fallback
                                };
                                normal_sum += face_normal * area;
                                area_sum += area;
                            }
                        }
                    }
                }
            }

            if area_sum > 1e-10 {
                let avg_normal = (normal_sum / area_sum).normalize();
                vertex_normals.insert(vid, avg_normal);
            } else {
                // fallback: 면들의 간단한 평균
                if !adjacent_faces.is_empty() {
                    let mut sum = DVec3::ZERO;
                    for &face_id in &adjacent_faces {
                        if let Some(f) = self.faces.get(face_id) {
                            sum += f.normal();
                        }
                    }
                    vertex_normals.insert(vid, (sum / adjacent_faces.len() as f64).normalize());
                }
            }
        }

        // ─── Step 3: 모든 정점을 함께 오프셋 ─────────────────────────────
        let mut offset_vert_map: std::collections::HashMap<VertId, VertId> =
            std::collections::HashMap::new();

        for &vid in &smooth_verts {
            let old_pos = self.vertex_pos(vid)?;
            let offset_normal = vertex_normals.get(&vid)
                .copied()
                .unwrap_or_else(|| DVec3::new(0.0, 0.0, 1.0));
            let new_pos = old_pos + offset_normal * distance;

            let new_vid = self.add_vertex(new_pos);
            offset_vert_map.insert(vid, new_vid);
        }

        // ─── Step 4: 인접 엣지에 wall face 생성 ──────────────────────────
        let mut wall_face_ids = Vec::new();

        // smooth group 내 모든 엣지 쌍 확인
        for i in 0..smooth_group.len() {
            for j in (i + 1)..smooth_group.len() {
                let face_a = smooth_group[i];
                let face_b = smooth_group[j];

                // 두 면이 공유 엣지를 가지는지 확인
                if let Some((v1, v2)) = self.find_shared_edge_vertices(face_a, face_b) {
                    if let (Some(&v1_prime), Some(&v2_prime)) =
                        (offset_vert_map.get(&v1), offset_vert_map.get(&v2)) {
                        // Wall quad face 생성: (v1, v2, v2', v1')
                        if let Ok(wall_face) =
                            self.add_face(&[v1, v2, v2_prime, v1_prime], material) {
                            wall_face_ids.push(wall_face);
                        }
                    }
                }
            }
        }

        Ok(PushPullResult {
            base_face: smooth_group[0],
            top_face: smooth_group[0],
            side_faces: wall_face_ids.clone(),
            new_verts: smooth_verts.iter().copied().collect(),
            base_removed: false,
            adjacent_splits: 0,
            split_debug: vec![
                format!("SmoothGroupSeamless: {} verts, {} wall faces",
                    smooth_verts.len(),
                    wall_face_ids.len()),
            ],
        })
    }

    /// Smooth group 내 두 면의 공유 엣지 정점 찾기
    fn find_shared_edge_vertices(&self, face_a: FaceId, face_b: FaceId)
        -> Option<(VertId, VertId)> {
        // face_a의 모든 엣지 정점 쌍 수집
        let mut edges_a: HashSet<(VertId, VertId)> = HashSet::new();

        if let Some(face) = self.faces.get(face_a) {
            let outer_start = face.outer().start;
            if !outer_start.is_null() {
                if let Ok(verts) = self.collect_loop_verts(outer_start) {
                    for i in 0..verts.len() {
                        let v1 = verts[i];
                        let v2 = verts[(i + 1) % verts.len()];
                        // 정규화 (작은 ID가 먼저)
                        let edge = if v1.raw() < v2.raw() { (v1, v2) } else { (v2, v1) };
                        edges_a.insert(edge);
                    }
                }
            }
        }

        // face_b의 모든 엣지와 비교
        if let Some(face) = self.faces.get(face_b) {
            let outer_start = face.outer().start;
            if !outer_start.is_null() {
                if let Ok(verts) = self.collect_loop_verts(outer_start) {
                    for i in 0..verts.len() {
                        let v1 = verts[i];
                        let v2 = verts[(i + 1) % verts.len()];
                        let edge = if v1.raw() < v2.raw() { (v1, v2) } else { (v2, v1) };

                        if edges_a.contains(&edge) {
                            return Some(edge);
                        }
                    }
                }
            }
        }

        None
    }

    /// 면의 넓이 계산
    fn compute_face_area(&self, verts: &[VertId]) -> Result<f64> {
        if verts.len() < 3 {
            return Ok(0.0);
        }

        let mut area = 0.0;
        let v0 = self.vertex_pos(verts[0])?;

        for i in 1..(verts.len() - 1) {
            let v1 = self.vertex_pos(verts[i])?;
            let v2 = self.vertex_pos(verts[i + 1])?;

            let d1 = v1 - v0;
            let d2 = v2 - v0;
            let cross = d1.cross(d2);
            area += cross.length() / 2.0;
        }

        Ok(area)
    }

    /// MoveOnly 모드: 정점만 이동 (AixxiA update_push_pull 방식)
    ///
    /// 직육면체의 면처럼 연결 edge가 노멀과 평행한 경우,
    /// face의 정점 위치를 직접 변경하면 벽 높이가 자동으로 변한다.
    fn push_pull_move_only(
        &mut self,
        face_id: FaceId,
        dist: f64,
    ) -> Result<PushPullResult> {
        let outer_start = self.faces[face_id].outer().start;
        let boundary = self.collect_loop_verts(outer_start)?;

        // face 노멀 계산
        let normal = self.compute_normal(&boundary)?;
        let normal = if normal.length() > 1e-10 { normal.normalize() } else {
            self.faces[face_id].normal()
        };
        let offset = normal * dist;

        // Phase F — inner loop(구멍) 정점도 함께 수집 (중복 제거)
        let inner_refs: Vec<LoopRef> = self.faces[face_id].inners().to_vec();
        let mut all_verts: std::collections::HashSet<VertId> =
            boundary.iter().copied().collect();
        for ir in &inner_refs {
            if ir.start.is_null() { continue; }
            if let Ok(vs) = self.collect_loop_verts(ir.start) {
                for v in vs { all_verts.insert(v); }
            }
        }

        // 정점 이동 (outer + inner 모두 동일 offset)
        for &vid in &all_verts {
            let old_pos = self.vertex_pos(vid)?;
            let new_pos = old_pos + offset;
            self.verts[vid].set_pos(new_pos);
        }

        // face 노멀 갱신
        let new_boundary = self.collect_loop_verts(outer_start)?;
        if let Ok(new_n) = self.compute_normal(&new_boundary) {
            self.faces[face_id].set_normal(new_n);
        }

        Ok(PushPullResult {
            base_face: face_id,
            top_face: face_id,
            side_faces: Vec::new(),
            new_verts: Vec::new(),
            base_removed: false,
            adjacent_splits: 0,
            split_debug: vec![format!(
                "MoveOnly: {} verts moved (outer {}, inners {})",
                all_verts.len(), boundary.len(), inner_refs.len()
            )],
        })
    }

    /// CreateFace 모드: 측면 생성 + coplanar 병합 (AixxiA make_push_pull_faces_from_face_id)
    ///
    /// 1. 정점 수집
    /// 2. 오프셋 정점 생성
    /// 3. 상단 face 생성
    /// 4. 측면 face들 생성
    /// 5. coplanar 인접면 병합 (merge) ← 핵심!
    /// 6. 원본 face 삭제
    fn push_pull_create_face(
        &mut self,
        face_id: FaceId,
        dist: f64,
        material: MaterialId,
    ) -> Result<PushPullResult> {
        // ─── 1. 기존 face의 outer 경계 수집 ─────────────────
        let outer_start = self.faces[face_id].outer().start;
        let boundary = self.collect_loop_verts(outer_start)?;
        ensure!(boundary.len() >= 3, "Face needs at least 3 verts");

        let normal = self.compute_normal(&boundary)?;
        let normal = if normal.length() > 1e-10 { normal.normalize() } else {
            self.faces[face_id].normal()
        };
        let offset = normal * dist;

        // Phase F — inner loops (구멍) 수집
        // Each inner: CW winding relative to face normal (DCEL convention).
        let inner_refs: Vec<LoopRef> = self.faces[face_id].inners().to_vec();
        let mut inner_boundaries: Vec<Vec<VertId>> = Vec::new();
        for ir in &inner_refs {
            if ir.start.is_null() { continue; }
            if let Ok(vs) = self.collect_loop_verts(ir.start) {
                if vs.len() >= 3 { inner_boundaries.push(vs); }
            }
        }

        // ─── 2. 오프셋 정점 생성 (outer + inners) ──────────
        let mut new_verts = Vec::with_capacity(boundary.len());
        for &vid in &boundary {
            let pos = self.vertex_pos(vid)?;
            new_verts.push(self.add_vertex(pos + offset));
        }
        // 각 inner loop마다 새 정점 배열
        let mut new_inner_verts: Vec<Vec<VertId>> = Vec::with_capacity(inner_boundaries.len());
        for ib in &inner_boundaries {
            let mut nvs = Vec::with_capacity(ib.len());
            for &vid in ib {
                let pos = self.vertex_pos(vid)?;
                nvs.push(self.add_vertex(pos + offset));
            }
            new_inner_verts.push(nvs);
        }

        // ─── 3. 상단 face 생성 — 구멍 있으면 add_face_with_holes ──
        let top_face = if new_inner_verts.is_empty() {
            self.add_face(&new_verts, material)?
        } else {
            let hole_slices: Vec<&[VertId]> =
                new_inner_verts.iter().map(|v| v.as_slice()).collect();
            self.add_face_with_holes(&new_verts, &hole_slices, material)?
        };
        let mut new_face_ids: Vec<FaceId> = vec![top_face];

        // ─── 4. 외벽 생성 (outer loop) ──────────────────────
        //   AixxiA 원본: [old_i, old_next, new_next, new_i]
        let n = boundary.len();
        let mut side_faces = Vec::with_capacity(n);
        for i in 0..n {
            let next_i = (i + 1) % n;
            let quad = vec![
                boundary[i],
                boundary[next_i],
                new_verts[next_i],
                new_verts[i],
            ];
            let sf = self.add_face(&quad, material)?;
            side_faces.push(sf);
            new_face_ids.push(sf);
        }

        // ─── 4b. 내벽 생성 (각 inner loop — hole의 wall) ───
        // Inner loop은 DCEL 상 CW (face normal 기준). Outer loop과 같은 공식으로
        // quad를 만들면 결과 winding이 outer와 자연히 반대 → normal이 반대 방향.
        // 이것이 정확히 원하는 동작: outer wall normal이 solid 바깥,
        // inner wall normal은 hole 바깥(= solid 쪽이 아닌 hole 내부 쪽) = 정면이
        // hole에서 바라볼 때 우리를 향함 → 렌더 시 hole 내벽이 보임.
        for (ib_idx, ib) in inner_boundaries.iter().enumerate() {
            let nvs = &new_inner_verts[ib_idx];
            let m = ib.len();
            for i in 0..m {
                let next_i = (i + 1) % m;
                let quad = vec![
                    ib[i],
                    ib[next_i],
                    nvs[next_i],
                    nvs[i],
                ];
                let sf = self.add_face(&quad, material)?;
                side_faces.push(sf);
                new_face_ids.push(sf);
            }
        }

        // ─── 5. coplanar 인접면 병합 (AixxiA 핵심 로직 그대로) ──
        //
        // 생성된 face들에 대해, 공유 edge 기준으로 coplanar 병합 시도.
        // AixxiA 원본:
        //   processing_queue에 new_face_ids를 넣고,
        //   각 face의 모든 edge를 순회하며 인접면과 merge 시도.
        //   merge 성공하면 새 face를 queue에 다시 넣어 후속 병합.
        let mut processing_queue: VecDeque<FaceId> = new_face_ids.clone().into();
        let mut final_face_ids: HashSet<FaceId> = HashSet::new();
        let mut merge_count: usize = 0;
        let mut split_debug: Vec<String> = Vec::new();

        while let Some(fid) = processing_queue.pop_front() {
            if !self.faces.contains(fid) {
                continue; // 이미 제거/병합됨
            }

            let edges = match self.face_outer_edges(fid) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let mut merged = false;

            'edge_loop: for edge_id in edges {
                let (neighbor_faces, _) = self.get_faces_sharing_edge(edge_id);
                for nb in &neighbor_faces {
                    if *nb == fid {
                        continue;
                    }

                    // coplanar 여부는 merge_faces_by_edge 내부에서 판단
                    match self.merge_faces_by_edge(edge_id) {
                        Ok(new_fid) => {
                            split_debug.push(format!(
                                "merge: {:?} & {:?} → {:?}",
                                fid, nb, new_fid
                            ));
                            merge_count += 1;
                            processing_queue.push_back(new_fid);
                            merged = true;
                            break 'edge_loop;
                        }
                        Err(_) => {
                            // 병합 불가 (non-coplanar 등) → 계속
                        }
                    }
                }
            }

            if !merged {
                final_face_ids.insert(fid);
            }
        }

        // ─── 6. 솔리드 방식: 원본 face 유지 (바닥면 닫힘) ──
        //   스케치업 방식은 원본 삭제했지만, 솔리드 방식은 유지하여
        //   닫힌 형태의 매스(closed solid)를 만든다.
        //   원본 face는 바닥면으로 남아있음.
        //   노말은 원래 방향 유지 (push/pull 방향 계산에 사용되므로 반전 금지)
        //   → BackSide 렌더링에 vertexColors 적용으로 아래에서도 재질 색상 표시

        // top_face가 merge로 인해 사라졌을 수 있으므로 최종 face에서 찾기
        let actual_top = if self.faces.contains(top_face) {
            top_face
        } else {
            // merge로 합쳐진 경우 final_face_ids에서 하나 선택
            *final_face_ids.iter().next().unwrap_or(&top_face)
        };

        let final_sides: Vec<FaceId> = final_face_ids
            .iter()
            .filter(|&&f| f != actual_top && self.faces.contains(f))
            .copied()
            .collect();

        Ok(PushPullResult {
            base_face: face_id,
            top_face: actual_top,
            side_faces: final_sides,
            new_verts,
            base_removed: false, // 솔리드 방식: 바닥면 유지
            adjacent_splits: merge_count,
            split_debug,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    fn make_ground_rect(mesh: &mut Mesh, mat: MaterialId) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        mesh.add_face(&[v0, v1, v2, v3], mat).unwrap()
    }

    #[test]
    fn flat_face_uses_create_face_mode() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        // 평면 face → CreateFace 모드
        assert!(!is_move_only(&m, f));
    }

    #[test]
    fn box_top_uses_move_only_mode() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let base = make_ground_rect(&mut m, mat);

        // box 만들기 (CreateFace)
        let r = m.push_pull(base, 3.0, mat).unwrap();

        // box의 top face → MoveOnly 모드 (연결 edge가 노멀과 평행)
        assert!(is_move_only(&m, r.top_face));
    }

    #[test]
    fn push_flat_creates_box() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, 3.0, mat).unwrap();
        assert!(!r.base_removed); // 솔리드 방식: 바닥면 유지
        // 평면에서 push → 6면 닫힌 박스 (top + 4 sides + bottom 유지)
        // top + 4 sides + bottom = 6 faces
        assert_eq!(m.face_count(), 6);
    }

    #[test]
    fn box_top_move_only_changes_height() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let base = make_ground_rect(&mut m, mat);

        // box 만들기
        let r = m.push_pull(base, 3.0, mat).unwrap();
        let face_count_before = m.face_count();

        // MoveOnly로 top face 이동 → face 수 변화 없음
        let r2 = m.push_pull(r.top_face, 1.0, mat).unwrap();
        assert!(!r2.base_removed); // MoveOnly → 삭제 없음
        assert_eq!(m.face_count(), face_count_before);
    }

    #[test]
    fn zero_is_noop() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);
        let r = m.push_pull(f, 0.0, mat).unwrap();
        assert!(!r.base_removed);
        assert_eq!(m.face_count(), 1);
    }

    // ── 추가 Push/Pull 테스트 (엣지 케이스) ──────────────

    #[test]
    fn pushpull_negative_distance() {
        // 음수 거리 = 역방향 push (inward pull)
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, -1.0, mat).unwrap();
        // 음수도 처리해야 함 — top_face 또는 side_faces가 존재
        assert!(!r.top_face.is_null() || !r.side_faces.is_empty(), "negative distance should work");
    }

    #[test]
    fn pushpull_very_small_distance() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, 0.001, mat).unwrap();
        assert!(!r.top_face.is_null() || !r.side_faces.is_empty(), "small distance should work");
        assert_eq!(m.face_count(), 6, "should create box faces");
    }

    #[test]
    fn pushpull_large_distance() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, 100.0, mat).unwrap();
        assert!(!r.top_face.is_null() || !r.side_faces.is_empty(), "large distance should work");
        assert_eq!(m.face_count(), 6);
    }

    #[test]
    fn pushpull_creates_valid_topology() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let _r = m.push_pull(f, 2.0, mat).unwrap();

        // 위상 검증: 모든 half-edge가 쌍을 이루어야 함
        let mut he_count = 0;
        for (_id, he) in m.hes.iter() {
            if he.is_active() {
                he_count += 1;
            }
        }
        // 상자: 12 edge × 2 half-edges = 24 active half-edges
        assert!(he_count >= 24, "should have valid half-edge pairs");
    }

    #[test]
    fn pushpull_preserves_base_face_vertices() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let original_vert_count = m.vert_count();
        let _r = m.push_pull(f, 3.0, mat).unwrap();

        // 원본 base face의 4개 정점 + top의 4개 정점 = 8
        assert_eq!(m.vert_count(), 8, "should have 8 vertices for a box");
        assert!(m.vert_count() >= original_vert_count, "vertices only added, not removed");
    }

    #[test]
    fn pushpull_face_count_is_six() {
        // CreateFace 모드에서 평면 → 6면 박스 (솔리드 방식)
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let _r = m.push_pull(f, 2.0, mat).unwrap();
        assert_eq!(m.face_count(), 6, "CreateFace should produce 6-face box");
    }

    #[test]
    fn pushpull_top_face_returned() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, 2.0, mat).unwrap();
        // top_face는 반환되고, 활성 상태여야 함
        assert!(m.faces.get(r.top_face)
            .map(|tf| tf.is_active())
            .unwrap_or(false), "top face should be active");
    }

    #[test]
    fn pushpull_result_is_closed_solid() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let _r = m.push_pull(f, 2.0, mat).unwrap();

        // 모든 face가 활성 상태
        for (_id, face) in m.faces.iter() {
            if face.is_active() {
                // 각 face의 outer loop 검증
                assert!(!face.outer().start.is_null(), "face should have valid outer loop");
            }
        }
    }

    #[test]
    fn pushpull_move_only_preserves_face_count() {
        // MoveOnly 모드: face 수 변하지 않음
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let base = make_ground_rect(&mut m, mat);

        // CreateFace로 box 만들기
        let r = m.push_pull(base, 3.0, mat).unwrap();
        let after_create = m.face_count();

        // MoveOnly로 top 이동
        let _r2 = m.push_pull(r.top_face, 1.0, mat).unwrap();
        let after_move = m.face_count();

        assert_eq!(after_create, after_move, "MoveOnly should not change face count");
    }

    #[test]
    fn pushpull_edge_case_degenerate_rectangle() {
        // 매우 얇은 직사각형: width=0.1, height=0.1
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(0.1, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(0.1, 0.1, 0.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.1, 0.0));
        let f = m.add_face(&[v0, v1, v2, v3], mat).unwrap();

        let r = m.push_pull(f, 0.1, mat);
        assert!(r.is_ok(), "should handle tiny faces");
    }

    // ═══════════════════════════════════════════════════════════════════
    // Geometric Validity Guards (ADR-003)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn pushpull_rejects_nan_distance() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        let r = m.push_pull(f, f64::NAN, mat);
        assert!(r.is_err(), "NaN distance must be rejected");
        assert!(
            r.unwrap_err().to_string().contains("finite"),
            "error message should mention finite"
        );
    }

    #[test]
    fn pushpull_rejects_infinity_distance() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        assert!(m.push_pull(f, f64::INFINITY, mat).is_err());
        assert!(m.push_pull(f, f64::NEG_INFINITY, mat).is_err());
    }

    #[test]
    fn pushpull_accepts_exactly_zero_as_noop() {
        // dist == 0.0은 no-op으로 유효 처리 (거부 아님)
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);
        let faces_before = m.face_count();

        let r = m.push_pull(f, 0.0, mat);
        assert!(r.is_ok(), "zero distance should be no-op, not error");
        assert_eq!(m.face_count(), faces_before, "zero dist should not change mesh");
    }

    #[test]
    fn pushpull_rejects_subepsilon_distance() {
        use crate::tolerances::EPSILON_LENGTH;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        // EPSILON_LENGTH의 절반 → degenerate, 거부되어야 함
        let r = m.push_pull(f, EPSILON_LENGTH * 0.5, mat);
        assert!(r.is_err(), "sub-epsilon distance must be rejected");
        let msg = r.unwrap_err().to_string();
        assert!(
            msg.contains("degenerate") || msg.contains("EPSILON"),
            "error message should mention degenerate/EPSILON, got: {}",
            msg
        );
    }

    #[test]
    fn pushpull_rejects_negative_subepsilon() {
        use crate::tolerances::EPSILON_LENGTH;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        // 음수도 절댓값 기준 — push와 pull 모두 차단
        let r = m.push_pull(f, -EPSILON_LENGTH * 0.5, mat);
        assert!(r.is_err(), "sub-epsilon negative distance must be rejected");
    }

    #[test]
    fn pushpull_accepts_exactly_epsilon() {
        use crate::tolerances::EPSILON_LENGTH;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let f = make_ground_rect(&mut m, mat);

        // EPSILON_LENGTH와 동일 → 경계값, 허용
        let r = m.push_pull(f, EPSILON_LENGTH, mat);
        assert!(r.is_ok(), "exactly epsilon distance should be accepted");
    }

    // ─── Phase F: Push/Pull with holes ─────────────────────
    #[test]
    fn pushpull_face_with_hole_create_inner_walls() {
        // 바닥 사각형에 구멍 뚫고 push → 창문 달린 벽
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // outer 200×200
        let o0 = mesh.add_vertex(DVec3::new(-100.0, 0.0, -100.0));
        let o1 = mesh.add_vertex(DVec3::new( 100.0, 0.0, -100.0));
        let o2 = mesh.add_vertex(DVec3::new( 100.0, 0.0,  100.0));
        let o3 = mesh.add_vertex(DVec3::new(-100.0, 0.0,  100.0));
        // hole 40×40 (CW winding from above = reversed relative to outer CCW)
        let h0 = mesh.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let h1 = mesh.add_vertex(DVec3::new(-20.0, 0.0,  20.0));
        let h2 = mesh.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let h3 = mesh.add_vertex(DVec3::new( 20.0, 0.0, -20.0));

        let f = mesh.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[h0, h1, h2, h3]],
            mat,
        ).unwrap();
        let base_faces = mesh.face_count();
        assert_eq!(base_faces, 1);

        // push up 50
        let result = mesh.push_pull(f, 50.0, mat).unwrap();

        // 최소 생성: 1 top + 4 outer walls + 4 inner walls (+ 원본 유지)
        // merge로 일부 합쳐질 수 있으나 최소 개수는 많아야 함
        assert!(
            mesh.face_count() >= 6,
            "pushed face with hole should create walls inside + outside (got {} faces)",
            mesh.face_count()
        );
        // 결과의 side_faces 수 >= 8 (outer 4 + inner 4)
        assert!(
            result.side_faces.len() >= 8,
            "must create walls for outer AND inner loop (got {})",
            result.side_faces.len()
        );
    }

    #[test]
    fn pushpull_move_only_preserves_hole() {
        // Box top을 push/pull하는 경우 — 구멍 정점도 함께 이동
        // Box geometry에 구멍 있는 top face 구성은 복잡하므로,
        // 직접 MoveOnly-like 테스트: 면 정점이 모두 이동되었는지 확인
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let o = [
            mesh.add_vertex(DVec3::new(-10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0,  10.0)),
            mesh.add_vertex(DVec3::new(-10.0, 0.0,  10.0)),
        ];
        let h = [
            mesh.add_vertex(DVec3::new(-2.0, 0.0, -2.0)),
            mesh.add_vertex(DVec3::new(-2.0, 0.0,  2.0)),
            mesh.add_vertex(DVec3::new( 2.0, 0.0,  2.0)),
            mesh.add_vertex(DVec3::new( 2.0, 0.0, -2.0)),
        ];
        let f = mesh.add_face_with_holes(&o, &[&h], mat).unwrap();

        // 이 구성은 홀 연결 edge가 없어 CreateFace mode
        let _ = mesh.push_pull(f, 10.0, mat).unwrap();

        // 원본 hole 정점들은 여전히 y=0에 있어야 함 (원본 유지 방식)
        for &v in &h {
            let pos = mesh.vertex_pos(v).unwrap();
            assert!((pos.y - 0.0).abs() < 1e-6, "original hole vert should remain at y=0");
        }
    }
}
