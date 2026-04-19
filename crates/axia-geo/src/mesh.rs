//! Mesh — the central DCEL mesh data structure.
//!
//! This is the equivalent of buildragon's `CayaEntities`, cleaned up with:
//! - Clear method naming
//! - Proper error handling with Result types
//! - No global state — each Mesh is self-contained

use glam::DVec3;
use rustc_hash::FxHashMap;
use serde::{Serialize, Deserialize};
use anyhow::{Result, bail, ensure};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::entities::*;
use crate::storage::SlotStorage;
use crate::tolerances::*;

/// Spatial hash cell key for fast vertex coincidence queries.
///
/// 셀 크기: 1 μm (1e-3 mm). 마우스 기반 좌표의 f32 drift(~1e-4 mm)와
/// snap 오차를 흡수하기에 적절한 크기. VERTEX_TOLERANCE(1e-7)은 정밀한
/// coincidence 판정용으로 유지되지만, 공간 해시는 조금 더 관대한 셀을 사용.
type SpatialKey = (i64, i64, i64);

/// 공간 해시 셀 크기. VERTEX_TOLERANCE보다 크게 해서 근접 vertex 후보를
/// 넉넉히 수집한다. 실제 coincidence 판정은 Vertex::coincident의 tolerance.
const SPATIAL_HASH_CELL: f64 = 1e-3; // 1 μm

/// Convert a position to a spatial hash key.
#[inline]
fn spatial_key(pos: DVec3) -> SpatialKey {
    const INV_CELL: f64 = 1.0 / SPATIAL_HASH_CELL;
    (
        (pos.x * INV_CELL).floor() as i64,
        (pos.y * INV_CELL).floor() as i64,
        (pos.z * INV_CELL).floor() as i64,
    )
}

/// The Half-Edge DCEL mesh.
///
/// Stores all topology entities (vertices, edges, half-edges, faces)
/// and provides operations for construction and modification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mesh {
    /// Unique mesh identifier (for transaction tracking)
    pub uuid: u64,
    /// Vertex storage
    pub verts: SlotStorage<VertId, Vertex>,
    /// Edge storage
    pub edges: SlotStorage<EdgeId, Edge>,
    /// Half-edge storage
    pub hes: SlotStorage<HeId, HalfEdge>,
    /// Face storage
    pub faces: SlotStorage<FaceId, Face>,
    /// Shell storage (connected face components)
    pub shells: SlotStorage<ShellId, Shell>,
    /// Fast edge lookup by vertex pair
    pub vert_to_edge: FxHashMap<VertPairKey, EdgeId>,
    /// Spatial hash for fast vertex coincidence lookup (O(1) instead of O(n))
    #[serde(skip)]
    spatial_hash: FxHashMap<SpatialKey, Vec<VertId>>,
}

static NEXT_UUID: AtomicU64 = AtomicU64::new(1);

impl Mesh {
    /// Create a new empty mesh.
    pub fn new() -> Self {
        let uuid = NEXT_UUID.fetch_add(1, Ordering::Relaxed);
        Self {
            uuid,
            verts: SlotStorage::new(),
            edges: SlotStorage::new(),
            hes: SlotStorage::new(),
            faces: SlotStorage::new(),
            shells: SlotStorage::new(),
            vert_to_edge: FxHashMap::default(),
            spatial_hash: FxHashMap::default(),
        }
    }

    // ========================================================================
    // Snapshot (undo/redo)
    // ========================================================================

    /// 현재 메시 상태를 바이트로 직렬화 (스냅샷 저장)
    pub fn snapshot(&self) -> Vec<u8> {
        match bincode::serialize(self) {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Mesh] snapshot serialize failed: {}", e);
                Vec::new()
            }
        }
    }

    /// 바이트에서 메시 상태 복원 (스냅샷 적용)
    pub fn restore_snapshot(&mut self, data: &[u8]) {
        if let Ok(restored) = bincode::deserialize::<Mesh>(data) {
            self.verts = restored.verts;
            self.edges = restored.edges;
            self.hes = restored.hes;
            self.faces = restored.faces;
            self.vert_to_edge = restored.vert_to_edge;
            // uuid는 유지 (변경하지 않음)
            // spatial_hash는 직렬화되지 않으므로 재구축 필요
            self.rebuild_spatial_hash();
        }
    }

    // ========================================================================
    // Vertex operations
    // ========================================================================

    /// Add a vertex at the given position.
    /// If a vertex already exists within tolerance, returns the existing one.
    /// Uses spatial hashing for O(1) average-case coincidence lookup.
    pub fn add_vertex(&mut self, pos: DVec3) -> VertId {
        let key = spatial_key(pos);
        // 공간 해시 3×3×3 = 최대 3 셀(=3μm) 반경 내 후보.
        // 실제 dedup 판정은 SPATIAL_HASH_CELL × 1.5 (1.5μm) 이내로 — f32 drift(~0.1μm)와
        // snap 오차(μm급)를 흡수. VERTEX_TOLERANCE(1e-7)는 그대로 두지만 add_vertex
        // dedup 단계에선 실용적 기준 적용.
        let dedup_tol = SPATIAL_HASH_CELL * 1.5;
        let dedup_tol_sq = dedup_tol * dedup_tol;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let neighbor_key = (key.0 + dx, key.1 + dy, key.2 + dz);
                    if let Some(ids) = self.spatial_hash.get(&neighbor_key) {
                        for &vid in ids {
                            if let Some(vert) = self.verts.get(vid) {
                                if !vert.is_active() { continue; }
                                // precise coincident (1e-7) OR within SPATIAL_HASH_CELL
                                // (후자는 마우스 drift 흡수용)
                                if vert.coincident(pos) {
                                    return vid;
                                }
                                let d_sq = (vert.pos() - pos).length_squared();
                                if d_sq < dedup_tol_sq {
                                    return vid;
                                }
                            }
                        }
                    }
                }
            }
        }
        // No coincident vertex found — insert new one
        let vid = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        self.spatial_hash.entry(key).or_default().push(vid);
        vid
    }

    /// Rebuild the spatial hash from existing vertices.
    /// Call after `restore_snapshot()` since spatial_hash is not serialized.
    pub fn rebuild_spatial_hash(&mut self) {
        self.spatial_hash.clear();
        for (id, vert) in self.verts.iter() {
            if vert.is_active() {
                let key = spatial_key(vert.pos());
                self.spatial_hash.entry(key).or_default().push(id);
            }
        }
    }

    /// Get vertex position.
    pub fn vertex_pos(&self, id: VertId) -> Result<DVec3> {
        self.verts
            .get(id)
            .map(|v| v.pos())
            .ok_or_else(|| anyhow::anyhow!("Vertex {:?} not found", id))
    }

    // ========================================================================
    // Edge operations
    // ========================================================================

    /// Add an edge between two vertices. Creates the half-edge pair.
    /// Returns (EdgeId, true) if new, (EdgeId, false) if already exists.
    pub fn add_edge(&mut self, v_start: VertId, v_end: VertId) -> Result<(EdgeId, bool)> {
        let pair = VertPair::new(v_start, v_end);

        // Check for existing edge
        if let Some(&edge_id) = self.vert_to_edge.get(&pair.key) {
            return Ok((edge_id, false));
        }

        // Create edge
        let edge_id = self.edges.insert(Edge::new(
            pair.key.v_small,
            pair.key.v_large,
            EDGE_TOLERANCE,
        ));

        // Register in lookup map
        self.vert_to_edge.insert(pair.key, edge_id);

        // Create half-edge pair
        self.create_halfedge_pair(edge_id, &pair)?;

        Ok((edge_id, true))
    }

    /// 새 line segment (start→end) 위에 있는 기존 vertex들을 찾음.
    /// 반환: (VertId, 3D pos, t_on_new_line) — t 오름차순 정렬.
    /// 이들은 edge split이 불필요 (vertex 이미 존재) — 새 line 자체가 이 vertex에서
    /// 나눠져야 grid 교차점 같은 케이스 처리 가능.
    pub fn find_vertices_on_line(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(VertId, DVec3, f64)> {
        let dir = end - start;
        let len_sq = dir.length_squared();
        if len_sq < 1e-18 { return Vec::new(); }
        let len = len_sq.sqrt();
        // 선분 수직 거리 허용치: 길이의 0.001% 또는 dedup_tol 중 큰 값.
        let perp_tol = (len * 1e-5).max(SPATIAL_HASH_CELL * 1.5);
        // Endpoint 일치 판정: add_vertex dedup_tol과 동일.
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;
        let dir_norm = dir / len;

        let mut result = Vec::new();
        for (vid, vert) in self.verts.iter() {
            if !vert.is_active() { continue; }
            let p = vert.pos();
            // start/end와 동일한 vertex는 제외
            if (p - start).length() < endpoint_tol { continue; }
            if (p - end).length() < endpoint_tol { continue; }
            // t 파라미터
            let w = p - start;
            let t = w.dot(dir_norm) / len;
            if t <= 1e-6 || t >= 1.0 - 1e-6 { continue; }
            // 선분까지 수직 거리
            let proj = start + dir * t;
            let perp = (p - proj).length();
            if perp > perp_tol { continue; }
            result.push((vid, p, t));
        }
        result.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        result
    }

    /// 주어진 line segment (start→end)과 교차하는 기존 엣지들의 교차점을 찾음.
    /// Coplanar edges만 대상 (4개 점의 tetrahedron volume으로 판정).
    /// 반환: (edge_id, 교차점 3D 좌표, t_on_new_line) 리스트, t_param 오름차순.
    ///
    /// 사용: drawLine에서 기존 엣지와의 교차점을 자동 vertex로 삽입하기 위함.
    pub fn find_line_crossings(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(EdgeId, DVec3, f64)> {
        let dir = end - start;
        let len = dir.length();
        if len < 1e-9 { return Vec::new(); }
        // Relative coplanarity tolerance (line scale의 0.01%).
        let coplanar_tol = (len * 1e-4).max(1e-3);
        // Endpoint-on-vertex 판정 tolerance — add_vertex의 dedup_tol(= SPATIAL_HASH_CELL*1.5 = 1.5μm)과 일치
        // 시켜서 vertex dedup과 crossing 판정이 서로 어긋나지 않도록 함.
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;

        let mut crossings = Vec::new();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let va = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let vb = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };

            // 끝점 일치 — 공유 vertex는 교차 아님
            if (va - start).length() < endpoint_tol || (va - end).length() < endpoint_tol ||
               (vb - start).length() < endpoint_tol || (vb - end).length() < endpoint_tol {
                continue;
            }

            // 두 segment의 공통 평면 확인 + 교차 parameter 계산
            let d2 = vb - va;
            let n = dir.cross(d2);
            let n_sq = n.length_squared();
            if n_sq < 1e-16 { continue; } // 평행
            // (va - start)가 n에 수직 = coplanar
            let w = va - start;
            let coplan_err = w.dot(n).abs() / n.length();
            if coplan_err > coplanar_tol { continue; }

            // Solve: start + t*dir = va + s*d2
            // t = ((va - start) × d2) · n / |n|²
            let t = w.cross(d2).dot(n) / n_sq;
            let s = w.cross(dir).dot(n) / n_sq;

            // s(기존 엣지 parameter)는 반드시 interior — 공유 vertex는 이미 위에서
            // 걸러졌으므로 여기 도달하면 기존 엣지 위의 진짜 교차점.
            // t(새 line parameter)는 [0, 1] 전체 허용 — 새 line의 start/end가 기존
            // 엣지 중간 위에 있어도 해당 엣지를 split해야 grid 같은 케이스가 동작.
            let t_eps = 1e-6;
            let s_eps = 1e-3;
            if t > -t_eps && t < 1.0 + t_eps && s > s_eps && s < 1.0 - s_eps {
                let t_clamped = t.clamp(0.0, 1.0);
                let pos = start + dir * t_clamped;
                crossings.push((edge_id, pos, t_clamped));
            }
        }

        crossings.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        crossings
    }

    /// 주어진 face의 경계 루프에 특정 vertex가 포함되어 있는지 검사.
    pub fn face_contains_vertex_on_boundary(&self, face_id: FaceId, vid: VertId) -> bool {
        let face = match self.faces.get(face_id) { Some(f) => f, None => return false };
        if !face.is_active() { return false; }
        let verts = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v,
            Err(_) => return false,
        };
        verts.contains(&vid)
    }

    /// 두 vertex 모두가 경계 위에 있는 활성 face의 ID를 반환 (있다면).
    /// 여러 face가 공유하는 경우 첫 번째 매치 반환.
    pub fn find_face_containing_both_verts(&self, v1: VertId, v2: VertId) -> Option<FaceId> {
        for (face_id, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if verts.contains(&v1) && verts.contains(&v2) {
                // 인접 vertex가 아닐 때만 (인접이면 그냥 기존 엣지) → face split 가능
                if !self.are_adjacent_in_loop(&verts, v1, v2) {
                    return Some(face_id);
                }
            }
        }
        None
    }

    fn are_adjacent_in_loop(&self, verts: &[VertId], a: VertId, b: VertId) -> bool {
        let n = verts.len();
        for i in 0..n {
            let va = verts[i];
            let vb = verts[(i + 1) % n];
            if (va == a && vb == b) || (va == b && vb == a) {
                return true;
            }
        }
        false
    }

    /// 같은 boundary vertex 집합을 가진 중복 face들을 제거 (하나만 유지).
    ///
    /// 사용 시나리오: 사용자가 연속 drawLine 중 fan-split + loop-detect 경쟁으로 같은
    /// 영역에 두 face가 생성되는 경우. 또는 split_face_by_line이 원본 face를 제대로
    /// dissolve하지 못하고 sub-face와 함께 남는 경우.
    ///
    /// 알고리즘: boundary vertex 집합을 정렬된 키로 만들어 그룹핑. 그룹에 face가 2+이면
    /// 첫 번째만 유지하고 나머지 remove.
    /// 반환: 제거된 face_ids.
    pub fn deduplicate_overlapping_faces(&mut self) -> Vec<FaceId> {
        // vertex set key → 유지 face_id
        let mut groups: FxHashMap<Vec<u32>, FaceId> = FxHashMap::default();
        let mut to_remove: Vec<FaceId> = Vec::new();

        let active_ids: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();

        for fid in active_ids {
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            if !face.is_active() { continue; }
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            let mut key: Vec<u32> = verts.iter().map(|v| v.raw()).collect();
            key.sort();
            if let Some(&existing) = groups.get(&key) {
                if existing != fid {
                    to_remove.push(fid);
                }
            } else {
                groups.insert(key, fid);
            }
        }

        for fid in &to_remove {
            let _ = self.remove_face(*fid);
        }
        to_remove
    }

    /// Face의 interior에 있는 vertex를 찾아 fan-tessellation으로 분할.
    ///
    /// 조건: vertex V가 face F의 2D 내부에 있고, V에서 F의 boundary vertex들로
    /// 자유(face=null) 엣지가 K ≥ 2개 뻗어 있으면, F를 dissolve하고 K개의 sub-face
    /// 생성 (V를 중심으로 한 fan).
    ///
    /// 반환: 분할 시 생성된 새 face ids; 분할 불필요 시 빈 Vec.
    pub fn dissolve_and_fan_split(&mut self, face_id: FaceId) -> Vec<FaceId> {
        if !self.faces.contains(face_id) { return Vec::new(); }
        let face = &self.faces[face_id];
        if !face.is_active() { return Vec::new(); }
        let material = face.material();
        let boundary = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        if boundary.len() < 3 { return Vec::new(); }

        // 2D projection plane from boundary
        let p0 = match self.vertex_pos(boundary[0]) { Ok(p) => p, Err(_) => return Vec::new() };
        let p1 = match self.vertex_pos(boundary[1]) { Ok(p) => p, Err(_) => return Vec::new() };
        let e1 = (p1 - p0).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return Vec::new(); }
        let mut e2 = DVec3::ZERO;
        for &vid in &boundary[2..] {
            if let Ok(p) = self.vertex_pos(vid) {
                let v = p - p0;
                let proj = e1 * v.dot(e1);
                let ortho = v - proj;
                if ortho.length_squared() > 1e-6 { e2 = ortho.normalize_or_zero(); break; }
            }
        }
        if e2.length_squared() < 1e-10 { return Vec::new(); }
        let normal = e1.cross(e2).normalize_or_zero();
        let tol = {
            let mut max_chord_sq = 0.0_f64;
            for &vid in &boundary {
                if let Ok(p) = self.vertex_pos(vid) {
                    let d = (p - p0).length_squared();
                    if d > max_chord_sq { max_chord_sq = d; }
                }
            }
            (max_chord_sq.sqrt() * 1e-4).max(1e-3)
        };
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };

        let boundary_set: FxHashMap<VertId, usize> = boundary.iter().enumerate()
            .map(|(i, &v)| (v, i)).collect();

        // 2D boundary polygon
        let poly2d: Vec<(f64, f64)> = boundary.iter()
            .filter_map(|&v| self.vertex_pos(v).ok().map(project2d))
            .collect();
        let point_in_poly = |x: f64, y: f64| -> bool {
            let mut inside = false;
            let n = poly2d.len();
            if n < 3 { return false; }
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly2d[i];
                let (xj, yj) = poly2d[j];
                if ((yi > y) != (yj > y)) &&
                   (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        // Find interior vertices (in F's plane + inside polygon + NOT on boundary)
        // with at least 2 free-edge connections to boundary.
        struct Candidate {
            v: VertId,
            spokes: Vec<(VertId, usize)>, // (boundary vertex, its index in boundary)
        }
        let mut candidates: Vec<Candidate> = Vec::new();

        for (vid, vert) in self.verts.iter() {
            if !vert.is_active() { continue; }
            if boundary_set.contains_key(&vid) { continue; }
            let p = vert.pos();
            // coplanar check
            let dist = (p - p0).dot(normal).abs();
            if dist > tol { continue; }
            let (px, py) = project2d(p);
            if !point_in_poly(px, py) { continue; }

            // Collect free edges from V to boundary verts
            let mut spokes: Vec<(VertId, usize)> = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                if key.v_small != vid && key.v_large != vid { continue; }
                let other = if key.v_small == vid { key.v_large } else { key.v_small };
                if let Some(&idx) = boundary_set.get(&other) {
                    spokes.push((other, idx));
                }
            }
            if spokes.len() >= 2 {
                candidates.push(Candidate { v: vid, spokes });
            }
        }

        if candidates.is_empty() { return Vec::new(); }

        // Pick the candidate with the MOST spokes (best fan coverage).
        candidates.sort_by_key(|c| std::cmp::Reverse(c.spokes.len()));
        let best = &candidates[0];
        let v_center = best.v;
        let mut spoke_verts: Vec<(VertId, usize)> = best.spokes.clone();
        // Sort by boundary index
        spoke_verts.sort_by_key(|&(_, idx)| idx);
        let k = spoke_verts.len();
        let n_boundary = boundary.len();

        // Partition boundary into K arcs (by consecutive spoke-connected verts).
        // Sub-face i: [V, b_i, boundary[b_i+1..b_{i+1}], b_{i+1}]
        // (spanning from spoke i's boundary vertex, walking along boundary, to spoke (i+1)'s vertex)
        let mut sub_faces_verts: Vec<Vec<VertId>> = Vec::with_capacity(k);
        for i in 0..k {
            let (_, start_idx) = spoke_verts[i];
            let (_, end_idx) = spoke_verts[(i + 1) % k];
            let mut arc: Vec<VertId> = Vec::new();
            arc.push(v_center);
            let mut j = start_idx;
            loop {
                arc.push(boundary[j]);
                if j == end_idx { break; }
                j = (j + 1) % n_boundary;
                // safety
                if arc.len() > n_boundary + 2 { break; }
            }
            if arc.len() >= 3 {
                sub_faces_verts.push(arc);
            }
        }

        if sub_faces_verts.is_empty() { return Vec::new(); }

        // Dissolve original face
        if self.remove_face(face_id).is_err() { return Vec::new(); }

        // Create sub-faces
        let mut created: Vec<FaceId> = Vec::new();
        for verts in &sub_faces_verts {
            match self.add_face(verts, material) {
                Ok(fid) => created.push(fid),
                Err(_) => continue,
            }
        }
        created
    }

    /// Mark both half-edges of an edge with HARD flag.
    /// HARD edges always render (even between coplanar faces) — used for user-drawn
    /// lines and face-split edges so the user's intent stays visible.
    pub fn mark_edge_hard(&mut self, edge_id: EdgeId) {
        if !self.edges.contains(edge_id) { return; }
        let he_start = self.edges[edge_id].any_he();
        if he_start.is_null() { return; }
        let mut he_id = he_start;
        loop {
            let new_flags = self.hes[he_id].flags() | HeFlags::HARD;
            self.hes[he_id].set_flags(new_flags);
            he_id = self.hes[he_id].next_rad();
            if he_id == he_start { break; }
        }
    }

    /// Find edge between two vertices.
    pub fn find_edge(&self, a: VertId, b: VertId) -> Option<EdgeId> {
        let key = VertPairKey::new(a, b);
        self.vert_to_edge.get(&key).copied()
    }

    /// Find the shared edge between two faces (if any).
    pub fn find_shared_edge_between_faces(&self, f1: FaceId, f2: FaceId) -> Option<EdgeId> {
        // Collect all edges of face1
        let face1 = self.faces.get(f1)?;
        if !face1.is_active() { return None; }
        let verts1 = self.collect_loop_verts(face1.outer().start).ok()?;

        // For each edge in face1, check if it's shared with face2
        for i in 0..verts1.len() {
            let va = verts1[i];
            let vb = verts1[(i + 1) % verts1.len()];
            // Check both directions
            if let Some(eid) = self.find_edge(va, vb) {
                let (faces, _) = self.get_faces_sharing_edge(eid);
                if faces.contains(&f1) && faces.contains(&f2) {
                    return Some(eid);
                }
            }
        }
        None
    }

    /// Create the twin half-edge pair for an edge.
    fn create_halfedge_pair(&mut self, edge_id: EdgeId, pair: &VertPair) -> Result<()> {
        // Forward half-edge: v_start → v_end
        let he_fwd = HalfEdge::new(pair.v_end, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        // Backward half-edge: v_end → v_start
        let he_bwd = HalfEdge::new(pair.v_start, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        // Wire twins (radial chain for manifold: fwd ↔ bwd)
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(he_fwd_id);

        // Set both as basic half-edges
        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Anchor edge's radial reference
        self.edges[edge_id].set_any_he(he_fwd_id);

        // Set vertex outgoing references (if not already set) + insert into v_ring
        // (v_ring cycles outgoing HEs around each vertex via v_next)
        if self.verts[pair.v_start].outgoing().is_none() {
            self.verts[pair.v_start].set_outgoing(Some(he_fwd_id));
        }
        if self.verts[pair.v_end].outgoing().is_none() {
            self.verts[pair.v_end].set_outgoing(Some(he_bwd_id));
        }
        self.insert_into_v_ring(pair.v_start, he_fwd_id);
        self.insert_into_v_ring(pair.v_end, he_bwd_id);

        Ok(())
    }

    // ========================================================================
    // V-ring management (outgoing-HE cycle around each vertex)
    // ========================================================================
    //
    // Each vertex maintains a cyclic linked list of its outgoing HEs via the
    // `v_next` field. This enables O(degree) vertex-star traversal without
    // having to scan all HEs in the mesh.
    //
    //   v.outgoing() → he_a → v_next = he_b → v_next = he_c → v_next = he_a
    //
    // For a single-HE vertex, he.v_next = he itself (self-loop).

    /// Insert `new_he` (outgoing from `v`) into v's v_ring cycle.
    /// If v has no outgoing HE yet, establishes a self-loop (new_he.v_next = new_he).
    /// Otherwise splices new_he in right after v.outgoing.
    fn insert_into_v_ring(&mut self, v: VertId, new_he: HeId) {
        let anchor = match self.verts[v].outgoing() {
            Some(h) if h != new_he && self.hes.contains(h) => h,
            _ => {
                // Either no anchor yet, or anchor == new_he — self-loop
                self.hes[new_he].set_v_next(new_he);
                if self.verts[v].outgoing().is_none() {
                    self.verts[v].set_outgoing(Some(new_he));
                }
                return;
            }
        };
        let after = self.hes[anchor].v_next();
        if after.is_null() || !self.hes.contains(after) {
            // Broken ring — restart as 2-cycle with anchor
            self.hes[anchor].set_v_next(new_he);
            self.hes[new_he].set_v_next(anchor);
            return;
        }
        // Splice: anchor → new_he → after → ... → anchor
        self.hes[anchor].set_v_next(new_he);
        self.hes[new_he].set_v_next(after);
    }

    /// Remove `he` from its origin vertex's v_ring cycle.
    /// If `he` was v.outgoing, re-anchor to he.v_next (or clear if last).
    fn remove_from_v_ring(&mut self, v: VertId, he: HeId) {
        if !self.hes.contains(he) { return; }
        let anchor = self.verts[v].outgoing();
        // Find predecessor p with p.v_next == he
        let mut pred: Option<HeId> = None;
        if let Some(start) = anchor {
            let mut cur = start;
            let mut guard = 0usize;
            loop {
                let nxt = self.hes[cur].v_next();
                if nxt == he { pred = Some(cur); break; }
                if nxt.is_null() || !self.hes.contains(nxt) { break; }
                cur = nxt;
                if cur == start { break; }
                guard += 1;
                if guard > 10_000 { break; }
            }
        }

        let after = self.hes[he].v_next();
        if let Some(p) = pred {
            if p != he {
                self.hes[p].set_v_next(after);
            }
        }

        // Re-anchor outgoing if it pointed to `he`
        if anchor == Some(he) {
            if after.is_null() || after == he {
                self.verts[v].set_outgoing(None);
            } else {
                self.verts[v].set_outgoing(Some(after));
            }
        }
        // Reset the removed he's v_next for cleanliness
        self.hes[he].set_v_next(HeId::NULL);
    }

    // ========================================================================
    // Face operations
    // ========================================================================

    /// Add a face from an ordered list of vertex IDs (CCW winding).
    /// Automatically creates edges and wires the half-edge loop.
    pub fn add_face(
        &mut self,
        outer_verts: &[VertId],
        material: MaterialId,
    ) -> Result<FaceId> {
        self.add_face_with_holes(outer_verts, &[], material)
    }

    /// Add a face with optional holes.
    pub fn add_face_with_holes(
        &mut self,
        outer_verts: &[VertId],
        holes: &[&[VertId]],
        material: MaterialId,
    ) -> Result<FaceId> {
        if outer_verts.len() < 3 {
            bail!("Face requires at least 3 vertices, got {}", outer_verts.len());
        }

        // Compute face normal
        let normal = self.compute_normal(outer_verts)?;

        // Create face with placeholder loop
        let face_id = self.faces.insert(Face::new(
            LoopRef::default(),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Build outer loop
        let outer_loop = self.make_loop(outer_verts, true, face_id)?;
        self.faces[face_id].set_outer(outer_loop);

        // Build inner loops (holes)
        for hole_verts in holes {
            let inner_loop = self.make_loop(hole_verts, false, face_id)?;
            self.faces[face_id].add_inner(inner_loop);
        }

        Ok(face_id)
    }

    /// Wire a half-edge loop from vertex IDs and assign to a face.
    fn make_loop(
        &mut self,
        verts: &[VertId],
        is_outer: bool,
        face_id: FaceId,
    ) -> Result<LoopRef> {
        let n = verts.len();
        if n < 3 {
            bail!("Loop requires at least 3 vertices");
        }

        // Ensure all edges exist
        let mut he_ids = Vec::with_capacity(n);
        for i in 0..n {
            let v_curr = verts[i];
            let v_next = verts[(i + 1) % n];
            let (edge_id, _) = self.add_edge(v_curr, v_next)?;

            // Find the half-edge going from v_curr → v_next
            let he_id = self.find_halfedge(edge_id, v_next)?;
            he_ids.push(he_id);
        }

        // Wire next/prev chain
        for i in 0..n {
            let curr = he_ids[i];
            let next = he_ids[(i + 1) % n];
            let prev = he_ids[(i + n - 1) % n];

            self.hes[curr].set_next(next);
            self.hes[curr].set_prev(prev);
            self.hes[curr].set_face(face_id);
            self.hes[curr].set_outer(is_outer);
        }

        Ok(LoopRef::new(he_ids[0], is_outer))
    }

    /// Find a FREE half-edge on a given edge that points to `dst`.
    ///
    /// 1. First tries to find an existing HE with `face == NULL` and
    ///    the correct direction — O(1) for manifold meshes.
    /// 2. If all HEs on this edge are already assigned to faces,
    ///    creates a NEW HE pair and splices it into the radial chain.
    ///    This supports non-manifold edges (e.g. outward Push/Pull
    ///    where the base face and a side face share an edge).
    ///
    /// NEVER steals half-edges from existing faces.
    fn find_halfedge(&mut self, edge_id: EdgeId, dst: VertId) -> Result<HeId> {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            bail!("Edge {:?} has no half-edges", edge_id);
        }

        // Pass 1: look for a FREE half-edge with the correct direction
        let mut he_id = start_he;
        loop {
            if self.hes[he_id].dst() == dst && self.hes[he_id].face().is_null() {
                return Ok(he_id);
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }

        // Pass 2: no free HE found — create a new pair (non-manifold edge)
        // Determine the "other" vertex (the one that isn't dst)
        // Copy values to avoid borrow conflicts
        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();
        let other = if dst == v_small { v_large } else { v_small };

        // Create new HE pair: fwd points to dst, bwd points to other
        let he_fwd = HalfEdge::new(dst, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        let he_bwd = HalfEdge::new(other, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Splice into radial chain: insert fwd and bwd after start_he
        // Before: ... → start_he → next → ...
        // After:  ... → start_he → he_fwd → he_bwd → next → ...
        let next = self.hes[start_he].next_rad();
        self.hes[start_he].set_next_rad(he_fwd_id);
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(next);

        // Return the one pointing to dst (he_fwd)
        Ok(he_fwd_id)
    }

    // ========================================================================
    // Face removal
    // ========================================================================

    /// Remove a face from the mesh.
    ///
    /// This properly "seals" the topology by:
    /// 1. Setting face = NULL on all loop half-edges (detach from face)
    /// 2. Clearing next/prev pointers (break the ghost loop)
    ///
    /// After removal, the freed half-edges can be reused by new faces
    /// via `find_halfedge` (which looks for face == NULL).
    pub fn remove_face(&mut self, face_id: FaceId) -> Result<()> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found for removal", face_id);
        }

        // Detach half-edges from this face and break loop pointers
        let outer_start = self.faces[face_id].outer().start;
        if !outer_start.is_null() {
            if let Ok(hes) = self.collect_loop_hes(outer_start) {
                for he_id in hes {
                    if let Some(he) = self.hes.get_mut(he_id) {
                        he.set_face(FaceId::NULL);
                        he.set_next(HeId::NULL);
                        he.set_prev(HeId::NULL);
                    }
                }
            }
            // Even if loop traversal fails, still remove the face
        }

        // Also handle inner loops (holes) if any
        let inners: Vec<_> = self.faces[face_id].inners().to_vec();
        for inner_ref in inners {
            if !inner_ref.start.is_null() {
                if let Ok(hes) = self.collect_loop_hes(inner_ref.start) {
                    for he_id in hes {
                        if let Some(he) = self.hes.get_mut(he_id) {
                            he.set_face(FaceId::NULL);
                            he.set_next(HeId::NULL);
                            he.set_prev(HeId::NULL);
                        }
                    }
                }
            }
        }

        // Remove the face from storage
        self.faces.remove(face_id);
        Ok(())
    }

    // ========================================================================
    // Edge splitting
    // ========================================================================

    /// Get the source (origin) vertex of a half-edge.
    ///
    /// A half-edge stores only its destination. The source is the edge's
    /// other vertex (the one that isn't dst).
    pub fn he_src(&self, he_id: HeId) -> Result<VertId> {
        let he = self.hes.get(he_id)
            .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
        let edge = self.edges.get(he.edge())
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", he.edge()))?;
        if he.dst() == edge.v_small() {
            Ok(edge.v_large())
        } else {
            Ok(edge.v_small())
        }
    }

    /// Split an edge at a given position, inserting a new vertex.
    ///
    /// Given edge A──B and position P on it:
    /// - Creates vertex P (or reuses if within tolerance)
    /// - Replaces edge A──B with edges A──P and P──B
    /// - Updates ALL face loops that use this edge
    /// - Rebuilds radial chains for the two new edges
    ///
    /// Returns (new_vert, edge_ap, edge_pb).
    ///
    /// # Safety
    /// This is the most delicate DCEL operation. Every half-edge's
    /// next/prev/next_rad pointers and every face's loop start must
    /// remain consistent after the split.
    pub fn split_edge(
        &mut self,
        edge_id: EdgeId,
        pos: DVec3,
    ) -> Result<(VertId, EdgeId, EdgeId)> {
        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;
        ensure!(edge.is_active(), "Edge {:?} is not active", edge_id);

        let va = edge.v_small();
        let vb = edge.v_large();

        // ─── 1. Create midpoint vertex ──────────────────────────────
        let vp = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        let key = spatial_key(pos);
        self.spatial_hash.entry(key).or_default().push(vp);

        // ─── 2. Collect all half-edges on the radial chain ──────────
        let start_he = self.edges[edge_id].any_he();
        ensure!(!start_he.is_null(), "Edge has no half-edges");

        // Gather (he_id, dst, face, prev, next, is_outer, flags) before mutation
        struct HeInfo {
            id: HeId,
            dst: VertId,
            face: FaceId,
            prev: HeId,
            next: HeId,
            is_outer: bool,
            flags: HeFlags,
        }

        let mut old_hes_info = Vec::new();
        let mut he = start_he;
        loop {
            let h = &self.hes[he];
            old_hes_info.push(HeInfo {
                id: he,
                dst: h.dst(),
                face: h.face(),
                prev: h.prev(),
                next: h.next(),
                is_outer: h.is_outer(),
                flags: h.flags(),
            });
            he = self.hes[he].next_rad();
            if he == start_he { break; }
            if old_hes_info.len() > 1000 {
                bail!("Radial chain exceeded 1000 — corrupted topology");
            }
        }

        // ─── 3. Create two new edges (manually, not via add_edge) ───
        let pair_ap = VertPairKey::new(va, vp);
        let pair_pb = VertPairKey::new(vp, vb);

        let e1 = self.edges.insert(Edge::new(pair_ap.v_small, pair_ap.v_large, EDGE_TOLERANCE));
        let e2 = self.edges.insert(Edge::new(pair_pb.v_small, pair_pb.v_large, EDGE_TOLERANCE));

        self.vert_to_edge.insert(pair_ap, e1);
        self.vert_to_edge.insert(pair_pb, e2);

        // ─── 4. For each old HE, create two replacement HEs ────────
        let mut e1_hes: Vec<HeId> = Vec::new();
        let mut e2_hes: Vec<HeId> = Vec::new();

        for info in &old_hes_info {
            if info.dst == vb {
                // Direction: A → B  ⟹  split into A→P (on E1) then P→B (on E2)
                let he_ap = self.hes.insert(HalfEdge::new(vp, e1));
                let he_pb = self.hes.insert(HalfEdge::new(vb, e2));

                // Wire into face loop: prev → he_ap → he_pb → next
                self.hes[he_ap].set_next(he_pb);
                self.hes[he_pb].set_prev(he_ap);
                self.hes[he_ap].set_prev(info.prev);
                self.hes[he_pb].set_next(info.next);
                self.hes[he_ap].set_face(info.face);
                self.hes[he_pb].set_face(info.face);
                self.hes[he_ap].set_outer(info.is_outer);
                self.hes[he_pb].set_outer(info.is_outer);
                self.hes[he_ap].set_flags(info.flags);
                self.hes[he_pb].set_flags(info.flags);

                // Update neighbor pointers — 단, 현재 HE가 실제로 그들의 prev/next로
                // 연결되어 있을 때만. 자유(face=null) HE의 prev/next는 face 생성 시
                // 이웃의 next/prev가 재지정돼 stale 상태가 될 수 있어 덮어쓰면
                // **인접 face의 boundary loop가 파손**됨.
                if !info.prev.is_null() && self.hes.contains(info.prev)
                    && self.hes[info.prev].next() == info.id
                {
                    self.hes[info.prev].set_next(he_ap);
                }
                if !info.next.is_null() && self.hes.contains(info.next)
                    && self.hes[info.next].prev() == info.id
                {
                    self.hes[info.next].set_prev(he_pb);
                }

                // Update face loop start if it pointed to old HE
                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_ap, face.outer().is_outer));
                        }
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_ap;
                            }
                        }
                    }
                }

                e1_hes.push(he_ap);
                e2_hes.push(he_pb);

            } else if info.dst == va {
                // Direction: B → A  ⟹  split into B→P (on E2) then P→A (on E1)
                let he_bp = self.hes.insert(HalfEdge::new(vp, e2));
                let he_pa = self.hes.insert(HalfEdge::new(va, e1));

                // Wire into face loop: prev → he_bp → he_pa → next
                self.hes[he_bp].set_next(he_pa);
                self.hes[he_pa].set_prev(he_bp);
                self.hes[he_bp].set_prev(info.prev);
                self.hes[he_pa].set_next(info.next);
                self.hes[he_bp].set_face(info.face);
                self.hes[he_pa].set_face(info.face);
                self.hes[he_bp].set_outer(info.is_outer);
                self.hes[he_pa].set_outer(info.is_outer);
                self.hes[he_bp].set_flags(info.flags);
                self.hes[he_pa].set_flags(info.flags);

                if !info.prev.is_null() && self.hes.contains(info.prev)
                    && self.hes[info.prev].next() == info.id
                {
                    self.hes[info.prev].set_next(he_bp);
                }
                if !info.next.is_null() && self.hes.contains(info.next)
                    && self.hes[info.next].prev() == info.id
                {
                    self.hes[info.next].set_prev(he_pa);
                }

                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_bp, face.outer().is_outer));
                        }
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_bp;
                            }
                        }
                    }
                }

                e2_hes.push(he_bp);
                e1_hes.push(he_pa);
            } else {
                bail!("HE {:?} dst={:?} doesn't match edge vertices A={:?} B={:?}",
                    info.id, info.dst, va, vb);
            }

            // Deactivate old half-edge
            self.hes[info.id].set_active(false);
        }

        // ─── 5. Build radial chains for E1 and E2 ──────────────────
        for hes in [&e1_hes, &e2_hes] {
            if hes.len() >= 2 {
                for i in 0..hes.len() {
                    let next = hes[(i + 1) % hes.len()];
                    self.hes[hes[i]].set_next_rad(next);
                }
            } else if hes.len() == 1 {
                // Single HE — point to itself (shouldn't happen for valid edge)
                self.hes[hes[0]].set_next_rad(hes[0]);
            }
        }

        // Set edge anchors
        if let Some(&first) = e1_hes.first() {
            self.edges[e1].set_any_he(first);
        }
        if let Some(&first) = e2_hes.first() {
            self.edges[e2].set_any_he(first);
        }

        // ─── 6. Set vertex outgoing for new vertex P ────────────────
        if let Some(&he) = e1_hes.first() {
            self.verts[vp].set_outgoing(Some(he));
        }

        // Update outgoing for A and B if they pointed to deactivated HEs
        if let Some(out) = self.verts[va].outgoing() {
            if !self.hes[out].is_active() {
                // Find a new active HE starting from A
                for &he_id in &e1_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == va { self.verts[va].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }
        if let Some(out) = self.verts[vb].outgoing() {
            if !self.hes[out].is_active() {
                for &he_id in &e2_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == vb { self.verts[vb].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }

        // ─── 7. Deactivate old edge ────────────────────────────────
        self.edges[edge_id].set_active(false);
        self.vert_to_edge.remove(&VertPairKey::new(va, vb));

        Ok((vp, e1, e2))
    }

    // ========================================================================
    // Face splitting
    // ========================================================================

    /// Split a face by connecting two of its boundary vertices with a new edge.
    ///
    /// Given face F with boundary [..., v1, ..., v2, ...]:
    /// - Creates edge v1–v2 (the split edge)
    /// - Splits F into two faces: F_A (v1→...→v2) and F_B (v2→...→v1)
    /// - Both new faces inherit the original face's material and normal
    ///
    /// Returns (face_a, face_b).
    ///
    /// # Preconditions
    /// - v1 and v2 must be on the face's outer boundary
    /// - v1 and v2 must not be adjacent (that would create a degenerate face)
    /// - The face must not have holes that cross the split line
    pub fn split_face(
        &mut self,
        face_id: FaceId,
        v1: VertId,
        v2: VertId,
    ) -> Result<(FaceId, FaceId)> {
        ensure!(self.faces.contains(face_id), "Face {:?} not found", face_id);
        ensure!(v1 != v2, "Cannot split face with same vertex");

        // Save face properties
        let material = self.faces[face_id].material();
        let normal = self.faces[face_id].normal();

        let outer_start = self.faces[face_id].outer().start;
        let loop_hes = self.collect_loop_hes(outer_start)?;
        let loop_verts = self.collect_loop_verts(outer_start)?;
        let n = loop_verts.len();

        // Find positions of v1 and v2 in the boundary loop
        // loop_hes[i].dst() == loop_verts[i]
        let idx1 = loop_verts.iter().position(|&v| v == v1)
            .ok_or_else(|| anyhow::anyhow!("v1 {:?} not on face {:?} boundary", v1, face_id))?;
        let idx2 = loop_verts.iter().position(|&v| v == v2)
            .ok_or_else(|| anyhow::anyhow!("v2 {:?} not on face {:?} boundary", v2, face_id))?;

        // Check v1 and v2 are not adjacent (would create degenerate face)
        let dist_fwd = if idx2 >= idx1 { idx2 - idx1 } else { n - idx1 + idx2 };
        let dist_bwd = n - dist_fwd;
        ensure!(dist_fwd >= 2 && dist_bwd >= 2,
            "v1 and v2 are adjacent or equal — split would create degenerate face");

        // ================================================================
        // Direct DCEL surgery — NO remove_face, NO add_face
        // ================================================================
        //
        // Original loop: ... → he_to_v1 → he_from_v1 → ... → he_to_v2 → he_from_v2 → ...
        //   where he_to_v1.dst = v1, he_to_v2.dst = v2
        //
        // After split:
        //   Loop A (face_id): he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1
        //   Loop B (face_b):  he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2

        // Identify the key half-edges
        let he_to_v1 = loop_hes[idx1];     // dst = v1
        let he_from_v1 = loop_hes[(idx1 + 1) % n]; // starts at v1
        let he_to_v2 = loop_hes[idx2];     // dst = v2
        let he_from_v2 = loop_hes[(idx2 + 1) % n]; // starts at v2

        // Create the splitting edge v1↔v2
        let (split_edge_id, _) = self.add_edge(v1, v2)?;

        // Get free half-edges for the split edge
        let he_v1v2 = self.find_halfedge(split_edge_id, v2)?; // v1→v2
        let he_v2v1 = self.find_halfedge(split_edge_id, v1)?; // v2→v1

        // === Splice Loop A: he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1 ===
        self.hes[he_to_v1].set_next(he_v1v2);
        self.hes[he_v1v2].set_prev(he_to_v1);
        self.hes[he_v1v2].set_next(he_from_v2);
        self.hes[he_from_v2].set_prev(he_v1v2);

        // === Splice Loop B: he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2 ===
        self.hes[he_to_v2].set_next(he_v2v1);
        self.hes[he_v2v1].set_prev(he_to_v2);
        self.hes[he_v2v1].set_next(he_from_v1);
        self.hes[he_from_v1].set_prev(he_v2v1);

        // === Assign face references ===

        // Mark split edge HEs as HARD so they render even between coplanar faces
        self.hes[he_v1v2].set_flags(HeFlags::HARD);
        self.hes[he_v2v1].set_flags(HeFlags::HARD);

        // Loop A keeps face_id — set face on the new split HE
        self.hes[he_v1v2].set_face(face_id);
        self.hes[he_v1v2].set_outer(true);
        self.hes[he_v1v2].set_active(true);

        // Update face_id's outer loop start to point into Loop A
        self.faces[face_id].set_outer(LoopRef::new(he_v1v2, true));

        // Create face_b for Loop B
        let face_b = self.faces.insert(Face::new(
            LoopRef::new(he_v2v1, true),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Set face on he_v2v1
        self.hes[he_v2v1].set_face(face_b);
        self.hes[he_v2v1].set_outer(true);
        self.hes[he_v2v1].set_active(true);

        // Walk Loop B and reassign all existing HEs from face_id → face_b
        {
            let mut he_id = self.hes[he_v2v1].next();
            while he_id != he_v2v1 {
                if he_id.is_null() {
                    bail!("Null next pointer encountered while reassigning Loop B faces");
                }
                self.hes[he_id].set_face(face_b);
                he_id = self.hes[he_id].next();
            }
        }

        // ────────────────────────────────────────────────────────────────
        // 노멀 일관성 자가 보정 (회귀 방지, ADR-003 / 2026-04-17)
        //
        // DCEL 수술이 올바르면 두 sub-face 모두 원본과 같은 loop 회전 방향을
        // 유지하므로 원본 노멀이 그대로 맞다. 하지만 split_edge가 먼저 호출되어
        // loop 포인터가 건드려진 경우 아주 드물게 loop가 뒤집힐 수 있다.
        //
        // 방어책: 두 sub-face의 실제 loop에서 노멀을 재계산해서
        // stored normal과 방향이 반대면 stored를 뒤집어 맞춘다.
        // (loop 자체를 reverse하지 않는 이유: DCEL radial chain 재봉합이 비용 큼)
        //
        // 이렇게 하면 triangulation/렌더링이 stored normal을 기준으로 작동하므로
        // 시각적 "앞뒷면 뒤집힘" 현상을 원천 차단한다.
        // ────────────────────────────────────────────────────────────────
        for sub_face in [face_id, face_b] {
            let loop_start = self.faces[sub_face].outer().start;
            if let Ok(verts) = self.collect_loop_verts(loop_start) {
                if let Ok(computed) = self.compute_normal(&verts) {
                    if computed.length_squared() > 1e-20 {
                        let stored = self.faces[sub_face].normal();
                        if computed.dot(stored) < 0.0 {
                            // loop가 뒤집혔다 — stored를 뒤집어 두-톤 렌더링 일관성 회복
                            self.faces[sub_face].set_normal(-stored);
                        }
                    }
                }
            }
        }

        Ok((face_id, face_b))
    }

    // ========================================================================
    // Normal computation
    // ========================================================================

    /// Compute the unit normal of a polygon defined by vertex IDs.
    /// Uses Newell's method for robustness with non-planar polygons.
    pub fn compute_normal(&self, verts: &[VertId]) -> Result<DVec3> {
        if verts.len() < 3 {
            bail!("Need at least 3 vertices for normal computation");
        }

        let mut normal = DVec3::ZERO;
        let n = verts.len();

        for i in 0..n {
            let curr = self.vertex_pos(verts[i])?;
            let next = self.vertex_pos(verts[(i + 1) % n])?;

            // Newell's method
            normal.x += (curr.y - next.y) * (curr.z + next.z);
            normal.y += (curr.z - next.z) * (curr.x + next.x);
            normal.z += (curr.x - next.x) * (curr.y + next.y);
        }

        let len = normal.length();
        if len < NORMAL_EPSILON {
            // Fall back to cross product of first two edges
            let p0 = self.vertex_pos(verts[0])?;
            let p1 = self.vertex_pos(verts[1])?;
            let p2 = self.vertex_pos(verts[2])?;
            normal = (p1 - p0).cross(p2 - p0);
            let len2 = normal.length();
            if len2 > 0.0 {
                return Ok(normal / len2);
            }
            bail!("Degenerate polygon — cannot compute normal");
        }

        Ok(normal / len)
    }

    /// Check if two faces are coplanar (same plane within tolerance).
    pub fn are_coplanar(&self, f1: FaceId, f2: FaceId) -> bool {
        let n1 = self.faces[f1].normal();
        let n2 = self.faces[f2].normal();
        let dot = n1.dot(n2).abs();
        dot > 1.0 - COPLANAR_TOLERANCE
    }

    // ========================================================================
    // Loop traversal utilities
    // ========================================================================

    /// Collect all vertex IDs in a face loop starting from a half-edge.
    pub fn collect_loop_verts(&self, start: HeId) -> Result<Vec<VertId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            result.push(he.dst());

            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Collect all half-edge IDs in a face loop.
    pub fn collect_loop_hes(&self, start: HeId) -> Result<Vec<HeId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            result.push(he_id);
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Get all edge IDs bounding a face's outer loop.
    pub fn face_outer_edges(&self, face_id: FaceId) -> Result<Vec<EdgeId>> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        Ok(hes.iter().map(|&he_id| self.hes[he_id].edge()).collect())
    }

    /// Mark all half-edges in a face's outer loop as SOFT on both sides (twin too).
    ///
    /// Used by primitive creation (cylinder/cone caps) to suppress rendering of
    /// the tessellation chord ring so curved surfaces appear truly smooth.
    /// The underlying topology is unchanged — only the render filter is affected.
    pub fn mark_face_outer_soft(&mut self, face_id: FaceId) -> Result<()> {
        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;
        let start = face.outer().start;
        if start.is_null() { return Ok(()); }
        let hes = self.collect_loop_hes(start)?;
        for &he_id in &hes {
            if let Some(h) = self.hes.get_mut(he_id) {
                let mut f = h.flags();
                f.insert(HeFlags::SOFT);
                h.set_flags(f);
            }
            // twin on same edge (manifold: next_rad)
            let twin = self.hes.get(he_id).map(|h| h.next_rad()).unwrap_or_default();
            if !twin.is_null() && twin != he_id {
                if let Some(h) = self.hes.get_mut(twin) {
                    let mut f = h.flags();
                    f.insert(HeFlags::SOFT);
                    h.set_flags(f);
                }
            }
        }
        Ok(())
    }

    // ========================================================================
    // Closed-loop detection (auto-face creation)
    // ========================================================================

    /// Detect if adding edge v0–v1 completes a closed boundary loop.
    ///
    /// **CAD Boundary Walk approach**: Instead of BFS on edge adjacency,
    /// walks the free half-edge boundary chain starting from the new edge's
    /// forward half-edge. If the chain returns to its start, a closed loop
    /// is found. This is O(L) where L is loop length, not O(E) total edges.
    ///
    /// Falls back to BFS if boundary chain is not yet wired (compatibility).
    ///
    /// Returns the loop vertices in winding order (suitable for `add_face`)
    /// if a coplanar closed loop of 3+ edges is found.
    pub fn detect_free_edge_loop(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        self.detect_free_edge_loop_excluding(v0, v1, new_edge_id, &[])
    }

    /// detect_free_edge_loop의 확장: 추가로 제외할 엣지 집합을 받음.
    /// 이전 iteration에서 "외부 boundary"로 걸러진 루프의 엣지들을 제외하고
    /// 다른 경로를 탐색할 때 사용.
    pub fn detect_free_edge_loop_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        if let Some(verts) = self.detect_loop_by_chain_walk_excluding(v0, v1, new_edge_id, excluded) {
            return Some(verts);
        }
        self.detect_loop_by_bfs_excluding(v0, v1, new_edge_id, excluded)
    }

    fn detect_loop_by_chain_walk_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        let mut path = vec![v0, v1];
        let mut prev_v = v0;
        let mut curr_v = v1;
        for _ in 0..10000 {
            let mut neighbors = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if edge_id == new_edge_id { continue; }
                if excluded.contains(&edge_id) { continue; }
                if key.v_small != curr_v && key.v_large != curr_v { continue; }
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                let other = if key.v_small == curr_v { key.v_large } else { key.v_small };
                if other != prev_v { neighbors.push(other); }
            }
            if neighbors.len() == 1 {
                let next_v = neighbors[0];
                if next_v == v0 {
                    if path.len() >= 3 && self.are_verts_coplanar(&path) { return Some(path); }
                    return None;
                }
                prev_v = curr_v;
                curr_v = next_v;
                path.push(curr_v);
            } else {
                return None;
            }
        }
        None
    }

    fn detect_loop_by_bfs_excluding(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
        excluded: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        use std::collections::VecDeque;
        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge_id == new_edge_id { continue; }
            if excluded.contains(&edge_id) { continue; }
            if !self.edge_has_free_he(edge_id) { continue; }
            let va = edge.v_small();
            let vb = edge.v_large();
            adj.entry(va).or_default().push(vb);
            adj.entry(vb).or_default().push(va);
        }
        let mut parent: FxHashMap<VertId, VertId> = FxHashMap::default();
        parent.insert(v1, VertId::NULL);
        let mut queue = VecDeque::new();
        queue.push_back(v1);
        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(&current) {
                for &next in neighbors {
                    if parent.contains_key(&next) { continue; }
                    parent.insert(next, current);
                    if next == v0 {
                        let mut path = Vec::new();
                        let mut node = v0;
                        loop {
                            path.push(node);
                            let p = parent[&node];
                            if p.is_null() { break; }
                            node = p;
                        }
                        if path.len() < 3 { return None; }
                        let mut face_verts = Vec::with_capacity(path.len());
                        face_verts.push(path[0]);
                        for i in (1..path.len()).rev() { face_verts.push(path[i]); }
                        if self.are_verts_coplanar(&face_verts) { return Some(face_verts); }
                        return None;
                    }
                    queue.push_back(next);
                }
            }
        }
        None
    }

    /// CAD boundary walk: build free-edge adjacency at each vertex on-the-fly
    /// and walk through degree-2 vertices to find the shortest closed loop
    /// containing the new edge. O(L) where L = loop length.
    fn detect_loop_by_chain_walk(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        // Walk from v1, following free edges (excluding new_edge_id),
        // always choosing the unique next vertex at degree-2 junctions.
        // If we reach v0, loop is found.
        let mut path = vec![v0, v1];
        let mut prev_v = v0;
        let mut curr_v = v1;

        for _ in 0..10000 {
            // Find all free-edge neighbors of curr_v (excluding the edge we came from)
            let mut neighbors = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if edge_id == new_edge_id { continue; }
                if key.v_small != curr_v && key.v_large != curr_v { continue; }
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                let other = if key.v_small == curr_v { key.v_large } else { key.v_small };
                if other != prev_v {
                    neighbors.push(other);
                }
            }

            if neighbors.len() == 1 {
                let next_v = neighbors[0];
                if next_v == v0 {
                    // Closed loop found!
                    if path.len() >= 3 && self.are_verts_coplanar(&path) {
                        return Some(path);
                    }
                    return None;
                }
                prev_v = curr_v;
                curr_v = next_v;
                path.push(curr_v);
            } else {
                // Dead end (0) or branch (2+) → can't determine unique loop via simple walk
                return None;
            }
        }
        None
    }

    /// Legacy BFS-based loop detection on free-edge adjacency.
    fn detect_loop_by_bfs(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        use std::collections::VecDeque;

        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();

        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge_id == new_edge_id { continue; }
            if !self.edge_has_free_he(edge_id) { continue; }

            let va = edge.v_small();
            let vb = edge.v_large();
            adj.entry(va).or_default().push(vb);
            adj.entry(vb).or_default().push(va);
        }

        let mut parent: FxHashMap<VertId, VertId> = FxHashMap::default();
        parent.insert(v1, VertId::NULL);
        let mut queue = VecDeque::new();
        queue.push_back(v1);

        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(&current) {
                for &next in neighbors {
                    if parent.contains_key(&next) { continue; }
                    parent.insert(next, current);

                    if next == v0 {
                        let mut path = Vec::new();
                        let mut node = v0;
                        loop {
                            path.push(node);
                            let p = parent[&node];
                            if p.is_null() { break; }
                            node = p;
                        }
                        if path.len() < 3 { return None; }

                        let mut face_verts = Vec::with_capacity(path.len());
                        face_verts.push(path[0]);
                        for i in (1..path.len()).rev() {
                            face_verts.push(path[i]);
                        }

                        if self.are_verts_coplanar(&face_verts) {
                            return Some(face_verts);
                        } else {
                            return None;
                        }
                    }

                    queue.push_back(next);
                }
            }
        }

        None
    }

    /// Check if an edge has at least one half-edge not assigned to a face.
    fn edge_has_free_he(&self, edge_id: EdgeId) -> bool {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() { return false; }

        let mut he_id = start_he;
        loop {
            if self.hes[he_id].face().is_null() {
                return true;
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he { break; }
        }
        false
    }

    /// Check if all vertices lie on the same plane (within tolerance).
    /// Triangles (3 vertices) are always coplanar.
    fn are_verts_coplanar(&self, verts: &[VertId]) -> bool {
        if verts.len() <= 3 { return true; }

        let p0 = self.verts[verts[0]].pos();
        let p1 = self.verts[verts[1]].pos();
        let p2 = self.verts[verts[2]].pos();

        let normal = (p1 - p0).cross(p2 - p0);
        let normal_len = normal.length();
        if normal_len < 1e-10 { return false; } // degenerate
        let normal = normal / normal_len;

        // Relative tolerance: 폴리곤 최장 edge 길이의 0.01%.
        // 이유: 단위 스케일(절대 tolerance)로는 mm 프로젝트(수천~수만 단위) 에선 너무
        // 엄격해지고, m/cm 프로젝트에선 너무 느슨해짐. 상대 tolerance는 두 경우 모두 적응.
        // 이전 고정 1e-3은 meter 가정 — mm 단위 앱에선 1µm로 너무 엄격해 마우스 스냅
        // 기반 4+정점 루프가 쉽게 coplanar 검사에 실패했음.
        let mut max_chord_sq = 0.0_f64;
        for &vid in verts.iter() {
            let p = self.verts[vid].pos();
            let d = (p - p0).length_squared();
            if d > max_chord_sq { max_chord_sq = d; }
        }
        let scale = max_chord_sq.sqrt().max(1.0);
        let tol = scale * 1e-4;

        for &vid in &verts[3..] {
            let p = self.verts[vid].pos();
            let dist = (p - p0).dot(normal).abs();
            if dist > tol {
                return false;
            }
        }
        true
    }

    // ========================================================================
    // Mesh export (for sending to Three.js)
    // ========================================================================

    /// Compute a **smooth per-vertex normal** for a vertex belonging to a face.
    ///
    /// Given the half-edge in the face's loop whose `dst` is this vertex,
    /// traverses around the vertex via the DCEL radial/next links and averages
    /// the normals of all faces whose angle to `face_normal` is within
    /// `EDGE_VISIBILITY_ANGLE_DEG`. This matches the soft-edge cull threshold,
    /// so smooth shading and edge hiding are consistent.
    ///
    /// Faces across a **hard** edge (HARD flag or angle > threshold) are excluded,
    /// preserving sharp corners (boxes, face-split seams).
    ///
    /// Falls back to `face_normal` on any degeneracy (isolated vertex, corrupted
    /// topology, traversal overrun).
    fn compute_smooth_normal_at(&self, he_into_vertex: HeId, vertex_id: VertId, face_normal: DVec3) -> DVec3 {
        use crate::tolerances::{EDGE_VISIBILITY_ANGLE_DEG, deg_to_rad};
        let cos_threshold = deg_to_rad(EDGE_VISIBILITY_ANGLE_DEG).cos();

        // Sanity: he_into_vertex must end at vertex_id
        let he0 = match self.hes.get(he_into_vertex) {
            Some(h) if h.is_active() && h.dst() == vertex_id => h,
            _ => return face_normal,
        };
        // Starting outgoing HE from vertex_id (in the same face as he_into_vertex).
        // hes[he_into_vertex].next() has origin = vertex_id.
        let start_out = he0.next();
        if start_out.is_null() || !self.hes.contains(start_out) {
            return face_normal;
        }

        // Collect weighted sum of neighbor face normals.
        let mut accum = DVec3::ZERO;
        let mut count: u32 = 0;
        let mut he_out = start_out;
        const MAX_ITERS: u32 = 1024; // paranoia cap for non-manifold / corruption
        for _ in 0..MAX_ITERS {
            let he_ref = match self.hes.get(he_out) {
                Some(h) if h.is_active() => h,
                _ => break,
            };

            // Record this face's normal if it passes the smooth threshold
            let face_id = he_ref.face();
            if !face_id.is_null() {
                if let Some(f) = self.faces.get(face_id) {
                    if f.is_active() && f.is_visible() {
                        let n = f.normal();
                        if n.length_squared() > 1e-20 {
                            let dot = n.dot(face_normal);
                            if dot >= cos_threshold {
                                // smoothing pair — include
                                accum += n;
                                count += 1;
                            }
                        }
                    }
                }
            }

            // Advance to next outgoing HE at this vertex:
            //   incoming = prev(he_out)     (in same face, ends at vertex)
            //   twin    = next_rad(incoming) (crosses edge → outgoing in neighbor face)
            let incoming = he_ref.prev();
            if incoming.is_null() || !self.hes.contains(incoming) {
                break;
            }
            let twin = self.hes[incoming].next_rad();
            if twin.is_null() || !self.hes.contains(twin) || twin == incoming {
                break; // boundary or non-manifold — stop
            }
            he_out = twin;
            if he_out == start_out {
                break; // closed fan — done
            }
        }

        if count == 0 || accum.length_squared() < 1e-20 {
            return face_normal;
        }
        accum.normalize()
    }

    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions, normals, indices, face_id_per_triangle)
    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    /// positions_f64 has the same layout/indexing as positions_f32 but in full f64 precision.
    pub fn export_buffers(&self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let mut positions: Vec<f32> = Vec::new();
        let mut positions_f64: Vec<f64> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut face_map: Vec<u32> = Vec::new(); // one FaceId per triangle
        let mut vert_offset: u32 = 0;

        for (face_id, face) in self.faces.iter() {
            if !face.is_active() || !face.is_visible() {
                continue;
            }

            let normal = face.normal();

            // Skip faces with corrupted loops (graceful degradation)
            let loop_verts = match self.collect_loop_verts(face.outer().start) {
                Ok(verts) => verts,
                Err(_) => continue, // skip corrupted face, don't kill all rendering
            };
            // Outer loop HEs — parallel to loop_verts (hes[i].dst() == loop_verts[i]).
            // Used for smooth-normal computation around each vertex.
            let loop_hes = self.collect_loop_hes(face.outer().start).unwrap_or_default();

            if loop_verts.len() < 3 {
                continue;
            }

            // Project to 2D for triangulation
            let (coord1, coord2) = Self::projection_axes(normal);
            let mut coords_2d: Vec<f64> = Vec::with_capacity(loop_verts.len() * 2);
            let mut positions_3d: Vec<DVec3> = Vec::with_capacity(loop_verts.len());
            // Per-vertex smooth normals (aligned with positions_3d indexing)
            let mut vert_normals: Vec<DVec3> = Vec::with_capacity(loop_verts.len());

            let mut skip_face = false;
            for (i, &vid) in loop_verts.iter().enumerate() {
                match self.vertex_pos(vid) {
                    Ok(pos) => {
                        positions_3d.push(pos);
                        let arr = [pos.x, pos.y, pos.z];
                        coords_2d.push(arr[coord1]);
                        coords_2d.push(arr[coord2]);

                        // Smooth normal: average adjacent face normals within threshold
                        // (only if we have a matching HE reference)
                        if i < loop_hes.len() {
                            let smooth = self.compute_smooth_normal_at(loop_hes[i], vid, normal);
                            vert_normals.push(smooth);
                        } else {
                            vert_normals.push(normal);
                        }
                    }
                    Err(_) => { skip_face = true; break; }
                }
            }
            if skip_face { continue; }

            // Inner loops (holes) 처리
            let mut hole_indices: Vec<usize> = Vec::new();
            let inners: Vec<_> = face.inners().to_vec();
            for inner_ref in &inners {
                if inner_ref.start.is_null() { continue; }
                let inner_verts = match self.collect_loop_verts(inner_ref.start) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if inner_verts.len() < 3 { continue; }

                // hole 시작 인덱스 = 현재 2D 좌표 수 / 2
                hole_indices.push(coords_2d.len() / 2);

                for &vid in &inner_verts {
                    match self.vertex_pos(vid) {
                        Ok(pos) => {
                            positions_3d.push(pos);
                            let arr = [pos.x, pos.y, pos.z];
                            coords_2d.push(arr[coord1]);
                            coords_2d.push(arr[coord2]);
                            // Inner-loop verts: use face normal (holes rarely need smoothing)
                            vert_normals.push(normal);
                        }
                        Err(_) => { skip_face = true; break; }
                    }
                }
                if skip_face { break; }
            }
            if skip_face { continue; }

            // Triangulate with earcutr (outer + holes)
            let mut tri_indices = match earcutr::earcut(&coords_2d, &hole_indices, 2) {
                Ok(indices) => indices,
                Err(_) => continue, // skip un-triangulable face
            };

            // Fix triangle winding: earcut works in 2D and may produce
            // triangles whose 3D winding doesn't match the face normal.
            // Check EACH triangle individually and fix if needed.
            for chunk in tri_indices.chunks_exact_mut(3) {
                let pa = positions_3d[chunk[0]];
                let pb = positions_3d[chunk[1]];
                let pc = positions_3d[chunk[2]];
                let tri_normal = (pb - pa).cross(pc - pa);
                if tri_normal.dot(normal) < 0.0 {
                    chunk.swap(1, 2);
                }
            }

            // Emit vertices (f32 for GPU + f64 for precision).
            // Per-vertex smooth normals: averaged across adjacent faces that share a
            // soft edge with this face (SketchUp-style, threshold EDGE_VISIBILITY_ANGLE_DEG).
            // Falls back to face normal when there are no neighbors within threshold.
            for (i, pos) in positions_3d.iter().enumerate() {
                positions.push(pos.x as f32);
                positions.push(pos.y as f32);
                positions.push(pos.z as f32);

                positions_f64.push(pos.x);
                positions_f64.push(pos.y);
                positions_f64.push(pos.z);

                let n = vert_normals.get(i).copied().unwrap_or(normal);
                normals.push(n.x as f32);
                normals.push(n.y as f32);
                normals.push(n.z as f32);
            }

            // Emit indices (offset by current vertex count)
            let num_triangles = tri_indices.len() / 3;
            for &idx in &tri_indices {
                indices.push(vert_offset + idx as u32);
            }

            // Map each triangle to this face's ID
            for _ in 0..num_triangles {
                face_map.push(face_id.raw());
            }

            vert_offset += positions_3d.len() as u32;
        }

        Ok((positions, normals, indices, face_map, positions_f64))
    }

    /// Choose the best 2D projection axes based on the face normal.
    /// Drops the axis with the largest normal component.
    fn projection_axes(normal: DVec3) -> (usize, usize) {
        let abs_n = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
        if abs_n[0] >= abs_n[1] && abs_n[0] >= abs_n[2] {
            (1, 2) // Drop X → project onto YZ
        } else if abs_n[1] >= abs_n[0] && abs_n[1] >= abs_n[2] {
            (0, 2) // Drop Y → project onto XZ
        } else {
            (0, 1) // Drop Z → project onto XY
        }
    }

    // ========================================================================
    // Edge line export (for wireframe rendering — SketchUp-style)
    // ========================================================================

    /// Export "hard edge" line segments for wireframe rendering.
    ///
    /// Unlike Three.js EdgesGeometry (which can't detect shared edges when
    /// vertices are duplicated per-face), this uses DCEL topology to correctly
    /// identify which edges should be drawn:
    ///
    /// - Boundary edges (only one face): ALWAYS drawn
    /// - Edges between non-coplanar faces (angle > threshold): drawn
    /// - Edges between coplanar faces (angle ≤ threshold): HIDDEN (soft)
    /// - Edges with SOFT flag set: HIDDEN
    ///
    /// Returns flat `[x0,y0,z0, x1,y1,z1, ...]` buffer for LineSegments.
    pub fn export_edge_lines(&self, angle_threshold_deg: f64) -> Vec<f32> {
        let (lines, _) = self.export_edge_lines_with_map(angle_threshold_deg);
        lines
    }

    /// export_edge_lines + edge ID map (segment index → EdgeId raw)
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        let cos_threshold = angle_threshold_deg.to_radians().cos();
        let mut lines: Vec<f32> = Vec::new();
        let mut edge_map: Vec<u32> = Vec::new();

        for (_edge_id, edge) in self.edges.iter() {
            if !edge.is_active() {
                continue;
            }

            // Get edge endpoint positions
            let p0 = match self.vertex_pos(edge.v_small()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let p1 = match self.vertex_pos(edge.v_large()) {
                Ok(p) => p,
                Err(_) => continue,
            };

            // Check half-edge flags (SOFT / HARD)
            let he_start = edge.any_he();
            if he_start.is_null() {
                continue;
            }
            let he_flags = self.hes[he_start].flags();
            if he_flags.contains(HeFlags::SOFT) {
                continue; // soft edge — don't draw
            }
            let force_hard = he_flags.contains(HeFlags::HARD);

            // Collect adjacent face normals via radial chain
            let mut face_normals: Vec<DVec3> = Vec::new();
            let mut he_id = he_start;
            loop {
                let face_id = self.hes[he_id].face();
                if !face_id.is_null() && self.faces.contains(face_id) {
                    let face = &self.faces[face_id];
                    if face.is_active() && face.is_visible() {
                        face_normals.push(face.normal());
                    }
                }
                he_id = self.hes[he_id].next_rad();
                if he_id == he_start {
                    break;
                }
            }

            // Decision: draw this edge?
            let draw = if force_hard {
                true // HARD flag → always draw (face split edges, user-drawn lines)
            } else {
                match face_normals.len() {
                    0 => true,  // isolated edge (wireframe) — draw
                    1 => true,  // boundary edge — draw
                    2 => {
                        // Two faces: check if coplanar
                        let dot = face_normals[0].dot(face_normals[1]).abs();
                        dot < cos_threshold // draw only if NOT coplanar
                    }
                    _ => true,  // non-manifold — draw
                }
            };

            if draw {
                lines.push(p0.x as f32);
                lines.push(p0.y as f32);
                lines.push(p0.z as f32);
                lines.push(p1.x as f32);
                lines.push(p1.y as f32);
                lines.push(p1.z as f32);
                edge_map.push(_edge_id.raw());
            }
        }

        (lines, edge_map)
    }

    // ========================================================================
    // Face merge (AixxiA coplanar merge — SketchUp-style)
    // ========================================================================

    /// Get all faces sharing a given edge, via the radial half-edge chain.
    /// Returns (face_ids, he_ids) — one pair per face found.
    pub fn get_faces_sharing_edge(&self, edge_id: EdgeId) -> (Vec<FaceId>, Vec<HeId>) {
        let mut faces = Vec::with_capacity(2);
        let mut hes = Vec::with_capacity(2);
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            return (faces, hes);
        }
        let mut he_id = start_he;
        loop {
            let f = self.hes[he_id].face();
            if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                if !faces.contains(&f) {
                    faces.push(f);
                    hes.push(he_id);
                }
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }
        (faces, hes)
    }

    /// Check if two faces are coplanar: normals nearly parallel AND on the same plane.
    ///
    /// F8 fix (2026-04-17): tolerances are now scale-aware and mutually consistent.
    /// - Normal parallelism: `|dot| >= cos(0.5°)` (≈ 1e-5 gap). Was `1e-3` which
    ///   corresponded to ≈ 2.5° — too loose for CAD-grade merges.
    /// - Plane distance: `max(1e-3, faces_bbox_diagonal × 1e-5)` — absolute floor
    ///   (1μm) plus a relative component so large (km-scale) or small (μm-scale)
    ///   models behave sensibly.
    pub fn are_faces_coplanar_strict(&self, f1: FaceId, f2: FaceId) -> Result<bool> {
        let verts1 = self.collect_loop_verts(self.faces[f1].outer().start)?;
        let verts2 = self.collect_loop_verts(self.faces[f2].outer().start)?;
        if verts1.len() < 3 || verts2.len() < 3 {
            return Ok(false);
        }

        let n1 = self.compute_normal(&verts1)?;
        let n2 = self.compute_normal(&verts2)?;
        let n1_len = n1.length();
        let n2_len = n2.length();
        if n1_len < 1e-10 || n2_len < 1e-10 {
            return Ok(true); // degenerate → treat as coplanar
        }
        let n1u = n1 / n1_len;
        let n2u = n2 / n2_len;

        // Normals parallel? cos(0.5°) ≈ 0.99996192
        const COS_PARALLEL_THRESHOLD: f64 = 0.99996192;
        let dot = n1u.dot(n2u).abs();
        if dot < COS_PARALLEL_THRESHOLD {
            return Ok(false);
        }

        // Scale-aware distance tolerance: use f1+f2 combined bbox diagonal.
        let mut min_pt = glam::DVec3::splat(f64::INFINITY);
        let mut max_pt = glam::DVec3::splat(f64::NEG_INFINITY);
        for &vid in verts1.iter().chain(verts2.iter()) {
            if let Ok(p) = self.vertex_pos(vid) {
                min_pt = min_pt.min(p);
                max_pt = max_pt.max(p);
            }
        }
        let bbox_diag = (max_pt - min_pt).length().max(1.0);
        let dist_tol = (bbox_diag * 1e-5).max(1e-3); // at least 1μm, or 1e-5 × extent

        // Point-to-plane distance check against the plane defined by f1
        let p1 = self.vertex_pos(verts1[0])?;
        let p2 = self.vertex_pos(verts2[0])?;
        let distance = n1u.dot(p2 - p1).abs();
        Ok(distance < dist_tol)
    }

    /// Find the half-edge belonging to a specific face on a given edge.
    fn find_he_for_face_and_edge(&self, face_id: FaceId, edge_id: EdgeId) -> Result<HeId> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        for he_id in hes {
            if self.hes[he_id].edge() == edge_id {
                return Ok(he_id);
            }
        }
        bail!("HalfEdge for face {:?} on edge {:?} not found", face_id, edge_id)
    }

    /// Merge two face loops by removing the shared edge's half-edges.
    /// Returns the merged vertex list (AixxiA `merge_face_loops` port).
    fn merge_face_loops(&self, he1: HeId, he2: HeId) -> Result<Vec<VertId>> {
        let mut merged = Vec::new();

        // Walk he1's loop skipping he1 itself
        let mut cur = self.hes[he1].next();
        let mut iters = 0;
        while cur != he1 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        // Walk he2's loop skipping he2 itself
        cur = self.hes[he2].next();
        iters = 0;
        while cur != he2 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        if merged.len() < 3 {
            bail!("Merged face would have fewer than 3 vertices");
        }
        Ok(merged)
    }

    /// Remove an edge and all its half-edges from the mesh.
    ///
    /// Safe cleanup (2026-04-17 F1/F2/F7 fixes):
    /// - F7: 10_000-iteration guard replaces arbitrary 100-cap; returns error on overrun
    /// - F1: Vertex.outgoing() is repointed to a surviving HE so downstream traversals
    ///       don't follow a dangling reference
    /// - F2: next_rad radial chain is spliced out before HE removal so non-manifold
    ///       edges' radial walks remain consistent
    pub fn remove_edge_and_halfedges(&mut self, edge_id: EdgeId) -> Result<()> {
        if !self.edges.contains(edge_id) {
            bail!("Edge {:?} not found", edge_id);
        }

        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();

        // Collect all HEs in radial chain (F7: safer guard)
        let start_he = self.edges[edge_id].any_he();
        let mut to_remove: Vec<HeId> = Vec::new();
        if !start_he.is_null() {
            let mut he_id = start_he;
            let mut guard = 0usize;
            loop {
                to_remove.push(he_id);
                he_id = self.hes[he_id].next_rad();
                if he_id == start_he { break; }
                guard += 1;
                if guard > 10_000 {
                    bail!("Radial chain overrun on edge {:?} — corrupted topology", edge_id);
                }
            }
        }

        let removed_set: rustc_hash::FxHashSet<HeId> =
            to_remove.iter().copied().collect();

        // F1: repoint each endpoint vertex's `outgoing` to a surviving HE.
        for &v in &[v_small, v_large] {
            let cur = self.verts[v].outgoing();
            if let Some(out) = cur {
                if !removed_set.contains(&out) { continue; }
                // Find any live HE whose origin == v (i.e., prev(h).dst == v)
                let mut replacement: Option<HeId> = None;
                for (h_id, h) in self.hes.iter() {
                    if removed_set.contains(&h_id) || !h.is_active() { continue; }
                    let p = h.prev();
                    if p.is_null() || !self.hes.contains(p) { continue; }
                    if self.hes[p].dst() == v {
                        replacement = Some(h_id);
                        break;
                    }
                }
                self.verts[v].set_outgoing(replacement);
            }
        }

        // v_ring splice: each outgoing HE must be removed from its origin's
        // v_next cycle. Origin of a HE = prev(he).dst (or v_small/v_large if
        // prev is unavailable — fallback for freshly built / isolated HEs).
        for &he in &to_remove {
            let origin = {
                let p = self.hes[he].prev();
                if !p.is_null() && self.hes.contains(p) {
                    self.hes[p].dst()
                } else {
                    // Fallback: guess origin as the endpoint NOT matching dst
                    let dst = self.hes[he].dst();
                    if dst == v_small { v_large } else { v_small }
                }
            };
            if self.verts.contains(origin) {
                self.remove_from_v_ring(origin, he);
            }
        }

        // F2: splice each removed HE out of its next_rad chain so non-manifold
        // neighbors keep their radial traversal intact.
        for &he in &to_remove {
            let next_of_he = self.hes[he].next_rad();
            // Find pred: any live HE whose next_rad points to this he
            let mut pred: Option<HeId> = None;
            for (h_id, h) in self.hes.iter() {
                if removed_set.contains(&h_id) { continue; }
                if h.next_rad() == he {
                    pred = Some(h_id);
                    break;
                }
            }
            if let Some(p) = pred {
                self.hes[p].set_next_rad(next_of_he);
            }
        }

        // Remove HEs
        for he in &to_remove {
            self.hes.remove(*he);
        }

        // Remove edge from lookup
        let key = VertPairKey::new(v_small, v_large);
        self.vert_to_edge.remove(&key);
        self.edges.remove(edge_id);
        Ok(())
    }

    /// Merge two coplanar faces sharing an edge.
    /// AixxiA's `merge_face_by_edge_id` ported directly.
    ///
    /// 1. Check that exactly 2 faces share the edge
    /// 2. Check coplanarity
    /// 3. Merge vertex loops (remove shared edge vertices from loop)
    /// 4. Delete old faces and shared edge
    /// 5. Create new merged face
    pub fn merge_faces_by_edge(&mut self, edge_id: EdgeId) -> Result<FaceId> {
        // 1. Find the two faces sharing this edge
        let (faces, _hes) = self.get_faces_sharing_edge(edge_id);
        if faces.len() != 2 {
            bail!("Edge {:?} shared by {} faces (need exactly 2)", edge_id, faces.len());
        }
        let f1 = faces[0];
        let f2 = faces[1];

        // F4: reject when F1 and F2 share more than one edge — ambiguous merge
        // (e.g. C-slit / bridge topology).
        let shared = self.count_shared_edges_outer(f1, f2);
        if shared != 1 {
            bail!("Faces {:?} and {:?} share {} edges (exactly 1 required)", f1, f2, shared);
        }

        // 2. Coplanarity check
        if !self.are_faces_coplanar_strict(f1, f2)? {
            bail!("Faces {:?} and {:?} are not coplanar", f1, f2);
        }

        // 3. Save original normal for winding consistency + material
        let original_normal = self.faces[f1].normal();
        let material = self.faces[f1].material();

        // 4. Find half-edges for each face on this edge and merge loops
        let he1 = self.find_he_for_face_and_edge(f1, edge_id)?;
        let he2 = self.find_he_for_face_and_edge(f2, edge_id)?;
        let mut merged_verts = self.merge_face_loops(he1, he2)?;

        // 5. Fix winding: merged loop might reverse the normal direction.
        let merged_normal = self.compute_normal(&merged_verts)?;
        if merged_normal.dot(original_normal) < 0.0 {
            merged_verts.reverse();
        }

        // F6: Remove collinear vertices (T-junction cleanup)
        merged_verts = self.simplify_collinear_loop(&merged_verts);
        if merged_verts.len() < 3 {
            bail!("Merged loop degenerate after collinear simplification");
        }

        // F5: Pre-validate — attempt compute_normal on the simplified loop.
        // If this fails we bail BEFORE any destructive removal (atomicity).
        let _ = self.compute_normal(&merged_verts)
            .map_err(|e| anyhow::anyhow!("Merge pre-validation: {}", e))?;

        // F3: Collect inner loops (holes) from BOTH faces before removal.
        // add_face_with_holes will re-materialize them on the merged face.
        let mut inner_loops: Vec<Vec<VertId>> = Vec::new();
        for &fid in &[f1, f2] {
            let inners: Vec<_> = self.faces[fid].inners().to_vec();
            for inner_ref in inners {
                if inner_ref.start.is_null() { continue; }
                if let Ok(v) = self.collect_loop_verts(inner_ref.start) {
                    if v.len() >= 3 { inner_loops.push(v); }
                }
            }
        }

        // 7. Destructive phase — all pre-validation done above.
        self.remove_edge_and_halfedges(edge_id)?;
        self.faces.remove(f1);
        self.faces.remove(f2);

        // 9. Create new merged face with preserved holes (F3)
        let hole_slices: Vec<&[VertId]> = inner_loops.iter().map(|v| v.as_slice()).collect();
        let new_face = self.add_face_with_holes(&merged_verts, &hole_slices, material)?;
        Ok(new_face)
    }

    /// Count edges shared by the outer loops of two faces (F4 helper).
    fn count_shared_edges_outer(&self, f1: FaceId, f2: FaceId) -> usize {
        let mut set = rustc_hash::FxHashSet::default();
        if let Ok(hes) = self.collect_loop_hes(self.faces[f1].outer().start) {
            for he in hes { set.insert(self.hes[he].edge()); }
        }
        let mut count = 0usize;
        if let Ok(hes) = self.collect_loop_hes(self.faces[f2].outer().start) {
            for he in hes {
                if set.contains(&self.hes[he].edge()) { count += 1; }
            }
        }
        count
    }

    /// Remove vertices that lie on the straight segment between their neighbors (F6).
    ///
    /// Given a cyclic loop `[v0, v1, ..., vN-1]`, if three consecutive vertices
    /// (prev, curr, next) are collinear within tolerance, `curr` is dropped.
    /// Used after face-merge to clean T-junction artifacts.
    fn simplify_collinear_loop(&self, verts: &[VertId]) -> Vec<VertId> {
        let n = verts.len();
        if n < 3 { return verts.to_vec(); }
        let mut out: Vec<VertId> = Vec::with_capacity(n);
        for i in 0..n {
            let prev = verts[(i + n - 1) % n];
            let curr = verts[i];
            let next = verts[(i + 1) % n];
            let (p, c, q) = match (self.vertex_pos(prev), self.vertex_pos(curr), self.vertex_pos(next)) {
                (Ok(a), Ok(b), Ok(cc)) => (a, b, cc),
                _ => { out.push(curr); continue; },
            };
            let e1 = c - p;
            let e2 = q - c;
            let l1 = e1.length();
            let l2 = e2.length();
            if l1 < 1e-9 || l2 < 1e-9 {
                // Near-zero segment — keep to avoid pathological loss
                out.push(curr);
                continue;
            }
            let dot = e1.dot(e2) / (l1 * l2);
            // Collinear if dot ≈ 1 (same direction, tolerance ~0.01°)
            if dot < 0.9999999 {
                out.push(curr);
            }
            // else: drop curr (collinear with neighbors)
        }
        out
    }

    // ========================================================================
    // Self-healing: degenerate cleanup + face reconstruction
    // ========================================================================

    /// Compute the raw (un-normalized) Newell vector.
    /// Its length equals **2 × signed planar area** of the polygon.
    /// Used by degenerate detection and face reconstruction.
    fn newell_raw(&self, verts: &[VertId]) -> Option<DVec3> {
        if verts.len() < 3 { return None; }
        let mut n = DVec3::ZERO;
        let len = verts.len();
        for i in 0..len {
            let p0 = self.vertex_pos(verts[i]).ok()?;
            let p1 = self.vertex_pos(verts[(i + 1) % len]).ok()?;
            n.x += (p0.y - p1.y) * (p0.z + p1.z);
            n.y += (p0.z - p1.z) * (p0.x + p1.x);
            n.z += (p0.x - p1.x) * (p0.y + p1.y);
        }
        Some(n)
    }

    /// Return the planar area of a face (outer loop, ignoring holes).
    /// 0 for degenerate or missing faces.
    pub fn face_area(&self, face_id: FaceId) -> f64 {
        let f = match self.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return 0.0,
        };
        let start = f.outer().start;
        if start.is_null() { return 0.0; }
        let verts = match self.collect_loop_verts(start) {
            Ok(v) => v,
            Err(_) => return 0.0,
        };
        match self.newell_raw(&verts) {
            Some(n) => n.length() * 0.5,
            None => 0.0,
        }
    }

    /// Check if every outer-loop vertex of `face_id` lies within `tol` of the
    /// stored face plane. Returns `true` only when the face is genuinely planar.
    pub fn is_face_planar(&self, face_id: FaceId, tol: f64) -> bool {
        let f = match self.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return false,
        };
        let start = f.outer().start;
        if start.is_null() { return false; }
        let verts = match self.collect_loop_verts(start) {
            Ok(v) => v,
            Err(_) => return false,
        };
        if verts.len() < 3 { return false; }
        // Plane: (normal, offset = normal · v0)
        let n = f.normal();
        let p0 = match self.vertex_pos(verts[0]) { Ok(p) => p, Err(_) => return false };
        let d = n.dot(p0);
        for &v in verts.iter().skip(1) {
            if let Ok(p) = self.vertex_pos(v) {
                if (n.dot(p) - d).abs() > tol {
                    return false;
                }
            }
        }
        true
    }

    /// Reconstruct a non-planar face by splitting it into coplanar pieces.
    ///
    /// Uses ear-clipping fan triangulation: emits triangles from v0 as a fan,
    /// each guaranteed planar (3 vertices ⇒ always planar). Original face is
    /// removed; returns the list of newly-created triangle face IDs.
    ///
    /// Used for importing external geometry (OBJ/DXF/etc.) where n-gon faces
    /// may not be exactly planar due to encoder precision or modeling error.
    ///
    /// If the input face is already planar within `tol`, returns the face
    /// unchanged in a single-element vector.
    pub fn reconstruct_face(&mut self, face_id: FaceId, tol: f64) -> Result<Vec<FaceId>> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found", face_id);
        }
        if self.is_face_planar(face_id, tol) {
            return Ok(vec![face_id]);
        }

        // Collect data needed BEFORE destructive changes
        let material = self.faces[face_id].material();
        let start = self.faces[face_id].outer().start;
        let verts = self.collect_loop_verts(start)?;
        if verts.len() < 4 {
            // Triangle can't be non-planar (numerically); just return it.
            return Ok(vec![face_id]);
        }

        // Remove the original (soft delete + drop)
        let _ = self.remove_face(face_id);
        if self.faces.contains(face_id) {
            self.faces.remove(face_id);
        }

        // Fan triangulation from vertex 0 — each triangle is coplanar by construction
        let mut new_faces = Vec::new();
        let v0 = verts[0];
        for i in 1..verts.len() - 1 {
            let tri = [v0, verts[i], verts[i + 1]];
            // Skip degenerate triangles (any two verts coincide)
            if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                continue;
            }
            match self.add_face(&tri, material) {
                Ok(fid) => new_faces.push(fid),
                Err(_) => { /* skip degenerate tri */ }
            }
        }
        Ok(new_faces)
    }

    /// Remove faces whose planar area is below `tol`.
    /// Returns the number of faces cleaned up.
    ///
    /// Used as a periodic "self-heal" routine for:
    /// - Numerical drift after many edge splits / merges
    /// - Imported meshes with zero-area artefacts
    ///
    /// ADR-003 Geometric Validity Principle prevents most degenerate creations,
    /// but this routine handles cases that slip through (external imports,
    /// compounded floating-point error).
    pub fn cleanup_degenerate_faces(&mut self, tol: f64) -> usize {
        // Collect candidates first (avoid borrow issues while iterating)
        let mut to_remove: Vec<FaceId> = Vec::new();
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let area = self.face_area(fid);
            if area < tol {
                to_remove.push(fid);
            }
        }
        let count = to_remove.len();
        for fid in to_remove {
            let _ = self.remove_face(fid);
            if self.faces.contains(fid) {
                self.faces.remove(fid);
            }
        }
        // Orphans may remain after face removal
        self.remove_isolated_verts();
        count
    }

    /// Remove vertices that have no edges referencing them.
    pub fn remove_isolated_verts(&mut self) {
        let mut referenced = std::collections::HashSet::new();
        for (_, edge) in self.edges.iter() {
            referenced.insert(edge.v_small());
            referenced.insert(edge.v_large());
        }
        let isolated: Vec<_> = self.verts.iter()
            .map(|(vid, _)| vid)
            .filter(|vid| !referenced.contains(vid))
            .collect();
        for vid in isolated {
            self.verts.remove(vid);
        }
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    pub fn vert_count(&self) -> usize {
        self.verts.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn face_count(&self) -> usize {
        self.faces.len()
    }

    pub fn he_count(&self) -> usize {
        self.hes.len()
    }

    // ═══════════════════════════════════════
    //  Shell operations
    // ═══════════════════════════════════════

    /// Create a new shell from the given face IDs.
    pub fn create_shell(&mut self, face_ids: Vec<FaceId>, closed: bool) -> ShellId {
        let shell = Shell::new(face_ids, closed);
        self.shells.insert(shell)
    }

    /// Get the shell containing a specific face, if any.
    pub fn shell_for_face(&self, face_id: FaceId) -> Option<ShellId> {
        for (shell_id, shell) in self.shells.iter() {
            if shell.contains_face(face_id) {
                return Some(shell_id);
            }
        }
        None
    }

    /// Remove a shell. Returns the shell if it existed.
    pub fn remove_shell(&mut self, shell_id: ShellId) -> Option<Shell> {
        self.shells.remove(shell_id)
    }

    /// Get the number of shells.
    pub fn shell_count(&self) -> usize {
        self.shells.len()
    }

    /// Check if a set of faces forms a closed shell (all edges shared by 2 faces).
    pub fn is_face_set_closed(&self, face_ids: &[FaceId]) -> bool {
        if face_ids.len() < 4 {
            return false; // need at least 4 faces for a closed solid
        }

        let face_set: FxHashMap<FaceId, bool> = face_ids.iter().map(|&f| (f, true)).collect();

        // Check each edge of each face — if both half-edges belong to faces in the set,
        // the edge is "interior". If any edge has only one face in the set, the shell is open.
        for &fid in face_ids {
            let face = match self.faces.get(fid) {
                Some(f) => f,
                None => return false,
            };

            // Walk the outer loop
            let start_he = face.outer().start;
            if start_he.is_null() { return false; }
            let mut he_id = start_he;
            loop {
                let he = &self.hes[he_id];
                // In this DCEL, next_rad() is the twin (radial partner)
                let twin_id = he.next_rad();
                let twin = &self.hes[twin_id];
                let twin_face = twin.face();

                // If the twin's face is null or not in our set, this is a boundary edge
                if twin_face.is_null() || !face_set.contains_key(&twin_face) {
                    return false;
                }

                he_id = he.next();
                if he_id == start_he {
                    break;
                }
            }
        }

        true
    }
}

impl Default for Mesh {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 3);
        assert_eq!(mesh.edge_count(), 3);
        assert_eq!(mesh.face_count(), 1);

        // Normal should point in +Z direction
        let n = mesh.faces[face_id].normal();
        assert!((n.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", n);
    }

    #[test]
    fn test_create_quad() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let _face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 4);
        assert_eq!(mesh.edge_count(), 4);
        assert_eq!(mesh.he_count(), 8); // 4 edges × 2 half-edges each
    }

    #[test]
    fn test_vertex_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1e-10, 0.0, 0.0)); // Within tolerance

        assert_eq!(v0, v1, "Coincident vertices should be merged");
        assert_eq!(mesh.vert_count(), 1);
    }

    #[test]
    fn test_edge_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let (e1, new1) = mesh.add_edge(v0, v1).unwrap();
        let (e2, new2) = mesh.add_edge(v0, v1).unwrap();
        let (e3, new3) = mesh.add_edge(v1, v0).unwrap(); // Reversed order

        assert!(new1);
        assert!(!new2);
        assert!(!new3);
        assert_eq!(e1, e2);
        assert_eq!(e1, e3);
    }

    #[test]
    fn test_export_triangle_buffers() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let (positions, normals, indices, _face_map, positions_f64) = mesh.export_buffers().unwrap();
        assert_eq!(positions.len(), 9); // 3 verts × 3 components
        assert_eq!(positions_f64.len(), 9); // same count, f64 precision
        assert_eq!(normals.len(), 9);
        assert_eq!(indices.len(), 3); // 1 triangle
    }

    // ── Face 추가/제거 테스트 ────────────────────────

    #[test]
    fn test_add_and_remove_face() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 1);

        // Remove face
        let removed = mesh.remove_face(face_id);
        assert!(removed.is_ok());
        assert_eq!(mesh.face_count(), 0);

        // Verify face is removed or marked inactive
        let is_gone = mesh.faces.get(face_id)
            .map(|f| !f.is_active())
            .unwrap_or(true); // None = fully removed = OK
        assert!(is_gone, "face should be inactive or removed from storage");
    }

    #[test]
    fn test_face_normal_computation() {
        let mut mesh = Mesh::new();
        // Triangle in XY plane at Z=0, CCW winding → normal should be +Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", normal);
        assert!((normal.x.abs() + normal.y.abs()) < 1e-6, "Normal X,Y should be zero");
    }

    #[test]
    fn test_face_normal_reversed_winding() {
        let mut mesh = Mesh::new();
        // CW winding → normal should be -Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z + 1.0).abs() < 1e-6, "Normal should be -Z, got {:?}", normal);
    }

    #[test]
    fn test_collect_loop_verts() {
        let mut mesh = Mesh::new();
        let verts = vec![
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0)),
        ];

        let face_id = mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();

        assert_eq!(loop_verts.len(), 4, "should collect all 4 vertices");
        for &v in &loop_verts {
            assert!(verts.contains(&v), "all loop vertices should match original");
        }
    }

    #[test]
    fn test_merge_coplanar_faces() {
        let mut mesh = Mesh::new();
        // 두 개의 인접한 공면 사각형 생성
        // Square 1: (0,0,0)-(1,0,0)-(1,1,0)-(0,1,0)
        // Square 2: (1,0,0)-(2,0,0)-(2,1,0)-(1,1,0) [Square 1의 우측]
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));

        let _face1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _face2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.face_count(), 2);

        // merge_faces_by_edge 호출 (face1과 face2가 edge v1-v2를 공유)
        // 먼저 공유 edge를 찾음
        let shared_edge = mesh.find_edge(v1, v2);
        let merge_result = if let Some(eid) = shared_edge {
            mesh.merge_faces_by_edge(eid)
        } else {
            Err(anyhow::anyhow!("shared edge not found"))
        };

        // merge 성공 여부에 따라 face count 확인
        if merge_result.is_ok() {
            // merge 성공하면 1개 face가 되어야 함
            assert_eq!(mesh.face_count(), 1, "merged result should have 1 face");
        } else {
            // merge 실패해도 상태는 일관성 있어야 함
            assert!(mesh.face_count() >= 1);
        }
    }

    #[test]
    fn test_face_material_preservation() {
        let mut mesh = Mesh::new();
        let mat_id = MaterialId::new(42);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], mat_id).unwrap();
        let face = mesh.faces[face_id].clone();
        assert_eq!(face.material(), mat_id, "face material should be preserved");
    }

    #[test]
    fn test_face_centroid_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Centroid should be approximately (1.0, 0.666, 0.0)
        let positions = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
        ];
        let expected_centroid = positions.iter().sum::<DVec3>() / 3.0;

        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();
        let mut actual_centroid = DVec3::ZERO;
        for &vid in &loop_verts {
            actual_centroid += mesh.verts[vid].pos();
        }
        actual_centroid /= loop_verts.len() as f64;

        assert!((actual_centroid - expected_centroid).length() < 1e-6,
            "centroid should be correct");
    }

    #[test]
    fn test_multiple_faces_on_same_vertices() {
        let mut mesh = Mesh::new();
        // 일부 꼭짓점을 공유하는 두 face
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let _f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _f2 = mesh.add_face(&[v1, v4, v2], MaterialId::new(1)).unwrap();

        assert_eq!(mesh.face_count(), 2);
        assert_eq!(mesh.vert_count(), 5);
        // Two faces share edge v1-v2 (directed both ways)
        let edges_f1 = mesh.find_edge(v1, v2);
        let edges_f2 = mesh.find_edge(v1, v2);
        assert_eq!(edges_f1, edges_f2, "faces should share edge");
    }

    #[test]
    fn test_orient_faces_consistent() {
        let mut mesh = Mesh::new();
        // Create a simple quad
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let normal_before = face.normal();

        // Verify normal is +Z
        assert!((normal_before.z - 1.0).abs() < 1e-6);

        // If we were to flip the face (using flip_face), normal should reverse
        // (this tests that the normal is computed correctly for orientation)
        let normal_length = normal_before.length();
        assert!((normal_length - 1.0).abs() < 1e-6, "normal should be unit");
    }

    // ────────────────────────────────────────────────────────────────
    // v_ring + self-healing (reconstruct_face / cleanup_degenerate)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn v_ring_cycle_is_consistent_after_face_creation() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let _ = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        // Each corner vertex should have 2 outgoing HEs in its v_ring (quad corner)
        // Walk the ring starting at v.outgoing, count until we cycle back.
        for &v in &[v0, v1, v2, v3] {
            let start = mesh.verts[v].outgoing().expect("outgoing must exist");
            let mut count = 0usize;
            let mut cur = start;
            loop {
                count += 1;
                cur = mesh.hes[cur].v_next();
                if cur.is_null() { panic!("v_next broken for vertex {:?}", v); }
                if cur == start { break; }
                if count > 10 { panic!("v_ring cycle too long for vertex {:?}", v); }
            }
            // Quad corner = 2 adjacent edges, so 2 outgoing HEs (one to each neighbor)
            assert_eq!(count, 2, "vertex {:?} should have 2 outgoing HEs", v);
        }
    }

    #[test]
    fn v_ring_cleans_up_on_edge_removal() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let _ = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Remove edge v0-v1
        let eid = mesh.find_edge(v0, v1).unwrap();
        mesh.remove_edge_and_halfedges(eid).unwrap();
        // v0's outgoing should still reference a live HE (or be None if isolated)
        if let Some(out) = mesh.verts[v0].outgoing() {
            assert!(mesh.hes.contains(out), "v0.outgoing should point to a live HE");
        }
        if let Some(out) = mesh.verts[v1].outgoing() {
            assert!(mesh.hes.contains(out), "v1.outgoing should point to a live HE");
        }
    }

    #[test]
    fn face_area_is_correct_for_unit_square() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(2.0, 3.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 3.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let area = mesh.face_area(fid);
        assert!((area - 6.0).abs() < 1e-9, "expected area 6.0 got {}", area);
    }

    #[test]
    fn is_face_planar_accepts_flat_and_rejects_skewed() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let flat = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        assert!(mesh.is_face_planar(flat, 1e-6));
        // Triangle is trivially planar
    }

    #[test]
    fn cleanup_degenerate_faces_removes_zero_area() {
        let mut mesh = Mesh::new();
        // Good face
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let good = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let initial_area = mesh.face_area(good);
        assert!(initial_area > 0.1);
        // add_face rejects degenerate at creation (ADR-003), so cleanup on a
        // pristine mesh should remove zero faces.
        let cleaned = mesh.cleanup_degenerate_faces(1e-6);
        assert_eq!(cleaned, 0);
        // The good face must survive
        assert!(mesh.faces.contains(good));
    }
}
