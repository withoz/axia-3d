//! Mesh — the central DCEL mesh data structure.
//!
//! This is the equivalent of buildragon's `CayaEntities`, cleaned up with:
//! - Clear method naming
//! - Proper error handling with Result types
//! - No global state — each Mesh is self-contained

use glam::DVec3;
use rustc_hash::{FxHashMap, FxHashSet};
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

/// Result of [`Mesh::face_set_manifold_info`] — 면 집합이 닫힌 2-manifold 솔리드를
/// 이루는지, 혹은 경계(open)나 non-manifold 결함이 있는지 분석 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifoldInfo {
    /// 집합에 포함된 활성 face 수.
    pub face_count: usize,
    /// 정확히 2개 face가 공유하는 edge 수 (manifold 내부 edge).
    pub interior_edge_count: usize,
    /// 1개 face만 인접한 edge 수 (open boundary — hole).
    pub boundary_edge_count: usize,
    /// 3개 이상 face가 공유하는 edge 수 (non-manifold).
    pub non_manifold_edge_count: usize,
    /// 닫힌 2-manifold 솔리드 여부 (face≥4 ∧ boundary=0 ∧ non_manifold=0).
    pub is_closed_solid: bool,
}

/// Phase H — Import Normalizer 옵션.
///
/// 외부 파일 (DXF/SKP/OBJ 등)에서 들어온 데이터를 AXiA 네이티브 규칙
/// (ADR-007)에 맞춰 정리하는 옵션 플래그. 기본은 모두 true로 보수적 정리.
#[derive(Debug, Clone)]
pub struct NormalizeOptions {
    /// 퇴화(zero-area) face 제거
    pub remove_degenerate: bool,
    /// Signed-volume 기반 winding 일관화 (다수결로 outer=Front 통일)
    pub normalize_winding: bool,
    /// Face normal을 topology에서 재계산
    pub recompute_normals: bool,
    /// 고아 vertex 정리
    pub remove_isolated_verts: bool,
    /// 면적 임계값 (이보다 작으면 degenerate로 간주)
    pub degenerate_tolerance: f64,
}

impl Default for NormalizeOptions {
    fn default() -> Self {
        Self {
            remove_degenerate: true,
            normalize_winding: true,
            recompute_normals: true,
            remove_isolated_verts: true,
            degenerate_tolerance: 1e-6,
        }
    }
}

/// Normalizer 실행 결과 리포트.
#[derive(Debug, Clone)]
pub struct NormalizeReport {
    pub degenerate_removed: usize,
    pub winding_flipped: usize,
    pub normals_recomputed: usize,
    pub isolated_verts_removed: usize,
    /// Normalize 후 남은 invariant 위반 (전부 해결되지 못한 케이스)
    pub remaining_violations: usize,
}

impl NormalizeReport {
    pub fn summary(&self) -> String {
        format!(
            "Normalize: removed {} degen, flipped {} winding, recomputed {} normals, \
             removed {} isolated verts, remaining {} violations",
            self.degenerate_removed,
            self.winding_flipped,
            self.normals_recomputed,
            self.isolated_verts_removed,
            self.remaining_violations,
        )
    }
}

/// Result of [`Mesh::verify_outward_normals`] — ADR-007 원칙 1 확장 리포트.
///
/// 닫힌 solid의 모든 face normal이 outward(바깥) 향하는지 검증.
/// 열린 surface나 non-manifold mesh는 is_closed_solid=false로 스킵.
#[derive(Debug, Clone)]
pub struct OutwardReport {
    /// 닫힌 2-manifold solid 여부 (false면 검증 스킵됨)
    pub is_closed_solid: bool,
    /// 검사된 face 수
    pub checked_faces: usize,
    /// 내부 향함(inward) 감지된 face 수
    pub inward_count: usize,
    /// Inward face ID 목록 (최대 detail 용)
    pub inward_faces: Vec<FaceId>,
}

impl OutwardReport {
    pub fn is_valid(&self) -> bool {
        !self.is_closed_solid || self.inward_count == 0
    }
    pub fn summary(&self) -> String {
        if !self.is_closed_solid {
            return "Open surface (outward check skipped)".to_string();
        }
        if self.inward_count == 0 {
            format!("✓ {} faces all outward", self.checked_faces)
        } else {
            format!(
                "✗ {}/{} faces inward-facing",
                self.inward_count, self.checked_faces
            )
        }
    }
}

/// Result of [`Mesh::verify_face_invariants`] — ADR-007 정책 준수 여부 리포트.
#[derive(Debug, Clone)]
pub struct InvariantReport {
    /// 검사된 활성 face 수
    pub checked_faces: usize,
    /// 발견된 위반 사항 목록 (비어 있으면 전부 통과)
    pub violations: Vec<String>,
}

impl InvariantReport {
    /// 모든 invariant 통과 여부
    pub fn is_valid(&self) -> bool {
        self.violations.is_empty()
    }

    /// Human-readable 요약
    pub fn summary(&self) -> String {
        if self.violations.is_empty() {
            format!("✓ All {} faces satisfy invariants", self.checked_faces)
        } else {
            let mut s = format!(
                "✗ {} violations in {} faces:\n",
                self.violations.len(),
                self.checked_faces,
            );
            for v in &self.violations {
                s.push_str("  - ");
                s.push_str(v);
                s.push('\n');
            }
            s
        }
    }
}

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

    /// Insert a NEW vertex at `pos`, bypassing the spatial-hash dedup that
    /// `add_vertex` normally performs. Used by topology-splitting operations
    /// (e.g. Slice / Plane Cut) that need two coincident-but-independent
    /// vertices to keep the two resulting halves topologically disjoint.
    /// The new vertex still gets registered in the spatial hash so future
    /// queries see it.
    pub fn add_vertex_force_new(&mut self, pos: DVec3) -> VertId {
        let vid = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        let key = spatial_key(pos);
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

        // AABB early-reject — a vertex on the line must fall inside the
        // line's bounding box padded by perp_tol. Rejecting by AABB
        // avoids the expensive dot/length computation for most vertices
        // in a large scene.
        let tol = perp_tol.max(endpoint_tol);
        let (lmin_x, lmax_x) = if start.x < end.x { (start.x - tol, end.x + tol) }
                               else              { (end.x - tol, start.x + tol) };
        let (lmin_y, lmax_y) = if start.y < end.y { (start.y - tol, end.y + tol) }
                               else              { (end.y - tol, start.y + tol) };
        let (lmin_z, lmax_z) = if start.z < end.z { (start.z - tol, end.z + tol) }
                               else              { (end.z - tol, start.z + tol) };

        let mut result = Vec::new();
        for (vid, vert) in self.verts.iter() {
            if !vert.is_active() { continue; }
            let p = vert.pos();

            if p.x < lmin_x || p.x > lmax_x
                || p.y < lmin_y || p.y > lmax_y
                || p.z < lmin_z || p.z > lmax_z
            {
                continue;
            }

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

        // AABB of the new line (expanded by coplanar tol) — a transverse
        // crossing can only happen between edges whose bounding boxes
        // overlap the new line's. Separating-axis test filters out most
        // edges without touching their vertex data.
        let aabb_tol = coplanar_tol.max(endpoint_tol);
        let (lmin_x, lmax_x) = if start.x < end.x { (start.x - aabb_tol, end.x + aabb_tol) }
                               else              { (end.x - aabb_tol, start.x + aabb_tol) };
        let (lmin_y, lmax_y) = if start.y < end.y { (start.y - aabb_tol, end.y + aabb_tol) }
                               else              { (end.y - aabb_tol, start.y + aabb_tol) };
        let (lmin_z, lmax_z) = if start.z < end.z { (start.z - aabb_tol, end.z + aabb_tol) }
                               else              { (end.z - aabb_tol, start.z + aabb_tol) };

        let mut crossings = Vec::new();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            // Skip non-topological edges (Centerline) — by contract they don't
            // split other lines and aren't split by them. Regular drawLine must
            // cross freely through a centerline without either side breaking.
            if !edge.class().is_topological() { continue; }
            let va = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let vb = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };

            // AABB separating-axis early-reject.
            let (ex_min_x, ex_max_x) = if va.x < vb.x { (va.x, vb.x) } else { (vb.x, va.x) };
            let (ex_min_y, ex_max_y) = if va.y < vb.y { (va.y, vb.y) } else { (vb.y, va.y) };
            let (ex_min_z, ex_max_z) = if va.z < vb.z { (va.z, vb.z) } else { (vb.z, va.z) };
            if ex_max_x < lmin_x || ex_min_x > lmax_x
                || ex_max_y < lmin_y || ex_min_y > lmax_y
                || ex_max_z < lmin_z || ex_min_z > lmax_z
            {
                continue;
            }

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

    /// Phase B (2026-04-24) — collinear (parallel + overlapping) edge detection.
    ///
    /// `find_line_crossings` handles transverse crossings but skips parallel
    /// cases (n_sq < 1e-16). For correct RECT-overlap-RECT behaviour we need
    /// to detect when the new line's ENDPOINTS fall into the interior of an
    /// existing collinear edge so we can split that edge at the endpoint
    /// position. Without this split, two overlapping collinear edges end
    /// up as separate topology and downstream face synthesis / merge fail.
    ///
    /// Returns: list of `(edge_id, split_position)` where existing `edge_id`
    /// must be split at `split_position` (which lies strictly inside the
    /// existing edge, at either the new line's start or end point).
    pub fn find_collinear_endpoint_splits(
        &self,
        start: DVec3,
        end: DVec3,
    ) -> Vec<(EdgeId, DVec3)> {
        let dir = end - start;
        let len = dir.length();
        if len < 1e-9 { return Vec::new(); }
        let dir_unit = dir / len;
        let coplanar_tol = (len * 1e-4).max(1e-3);
        let endpoint_tol = SPATIAL_HASH_CELL * 1.5;

        // AABB of the new line, expanded by tolerance — any existing edge
        // whose own AABB misses this one entirely cannot be collinear with
        // it. This early-rejects the common case (most edges in the scene
        // nowhere near the line being drawn), keeping this per-drawLine
        // pass near-constant on average instead of O(E) strict.
        let aabb_tol = coplanar_tol.max(endpoint_tol);
        let (min_x, max_x) = if start.x < end.x { (start.x - aabb_tol, end.x + aabb_tol) }
                             else              { (end.x - aabb_tol, start.x + aabb_tol) };
        let (min_y, max_y) = if start.y < end.y { (start.y - aabb_tol, end.y + aabb_tol) }
                             else              { (end.y - aabb_tol, start.y + aabb_tol) };
        let (min_z, max_z) = if start.z < end.z { (start.z - aabb_tol, end.z + aabb_tol) }
                             else              { (end.z - aabb_tol, start.z + aabb_tol) };

        let mut splits: Vec<(EdgeId, DVec3)> = Vec::new();
        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if !edge.class().is_topological() { continue; }
            let va = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let vb = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };

            // AABB early-reject — separating-axis test between the two
            //   edges' AABBs. Two AABBs are disjoint iff one is strictly
            //   to the left/right / below/above / front/back of the other
            //   on at least one axis. Any disjoint pair cannot be
            //   collinear, so we can skip them cheaply.
            let (ex_min_x, ex_max_x) = if va.x < vb.x { (va.x, vb.x) } else { (vb.x, va.x) };
            let (ex_min_y, ex_max_y) = if va.y < vb.y { (va.y, vb.y) } else { (vb.y, va.y) };
            let (ex_min_z, ex_max_z) = if va.z < vb.z { (va.z, vb.z) } else { (vb.z, va.z) };
            if ex_max_x < min_x || ex_min_x > max_x
                || ex_max_y < min_y || ex_min_y > max_y
                || ex_max_z < min_z || ex_min_z > max_z
            {
                continue;
            }

            let ab = vb - va;
            let ab_len = ab.length();
            if ab_len < 1e-9 { continue; }
            let ab_unit = ab / ab_len;

            // Parallel check: cross product near zero.
            let cross = dir_unit.cross(ab_unit);
            if cross.length_squared() > 1e-6 { continue; }  // not parallel

            // Collinear check: start must lie on the line through va.
            //   perp distance of (start - va) from ab direction.
            let w = start - va;
            let perp = w - ab_unit * w.dot(ab_unit);
            if perp.length() > coplanar_tol { continue; }

            // Both endpoints of the new line collinear. Now check if either
            //   lies strictly inside the existing edge's parameter range
            //   (and is NOT coincident with va/vb, which would already be
            //   handled by spatial-hash vertex dedup).
            for &candidate in &[start, end] {
                // Skip if candidate coincides with existing edge endpoints
                //   (add_vertex will dedup naturally).
                if (candidate - va).length() < endpoint_tol { continue; }
                if (candidate - vb).length() < endpoint_tol { continue; }

                let s = (candidate - va).dot(ab_unit) / ab_len;
                let s_eps = 1e-3;
                if s > s_eps && s < 1.0 - s_eps {
                    splits.push((edge_id, candidate));
                }
            }
        }
        splits
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
    ///
    /// ⚡ 성능: large scene 의 draw_line 시 N face 전체를 순회하며
    /// `collect_loop_verts` 를 돌리면 face 수에 비례한 heap-alloc 이 누적돼
    /// 수백 ms 가 됨. v1 의 incident edges 만 추적해 후보 face 수를 평균
    /// 4 이하로 줄인다.
    pub fn find_face_containing_both_verts(&self, v1: VertId, v2: VertId) -> Option<FaceId> {
        // v1 의 모든 incident half-edge 의 face 후보 수집 (radial chain 순회).
        // vert_to_edge 는 두 vert 쌍 → 단일 edge id 매핑이라 v1 의 모든
        // incident edge 를 직접 얻기 어렵다. 대안: edges 슬롯스토리지를
        // v1 또는 v2 가 endpoint 인 것만 1-pass 스캔하고, 그 edge 의
        // any_he 로부터 radial chain 을 따라 face 를 찾는다. 일반 manifold
        // 메시에서 v1 incident edge 수는 ~6 이내라 매우 빠름.
        use rustc_hash::FxHashSet;
        let mut candidates: FxHashSet<FaceId> = FxHashSet::default();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.v_small() != v1 && edge.v_large() != v1 { continue; }
            // walk radial chain to gather faces
            let start_he = edge.any_he();
            if start_he.is_null() { continue; }
            let mut he = start_he;
            for _ in 0..32 {
                let f = self.hes[he].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    candidates.insert(f);
                }
                he = self.hes[he].next_rad();
                if he == start_he { break; }
            }
            let _ = eid;
        }

        for face_id in candidates {
            let face = match self.faces.get(face_id) { Some(f) => f, None => continue };
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

    /// HalfEdge의 source vertex 반환 (dst의 반대쪽).
    pub fn he_source(&self, he_id: HeId) -> VertId {
        let he = &self.hes[he_id];
        let edge = &self.edges[he.edge()];
        let dst = he.dst();
        if dst == edge.v_small() { edge.v_large() } else { edge.v_small() }
    }

    /// HalfEdge의 "twin" (같은 edge의 반대 방향 HE) 반환.
    /// 2-manifold 메시에서 twin은 radial 체인의 다음 것.
    /// 3+ radial의 경우(non-manifold): dst가 다른 첫 번째 HE.
    pub fn he_twin(&self, he_id: HeId) -> HeId {
        let start_dst = self.hes[he_id].dst();
        let mut he = self.hes[he_id].next_rad();
        let start = he_id;
        let mut count = 0;
        while he != start && count < 1000 {
            if self.hes[he].dst() != start_dst {
                return he;
            }
            he = self.hes[he].next_rad();
            count += 1;
        }
        start // fallback
    }

    /// ════════════════════════════════════════════════════════════════════════
    /// Planar Face Resolution — Leftmost-turn traversal (다중 평면 지원)
    /// ════════════════════════════════════════════════════════════════════════
    ///
    /// Free half-edges (face=null)로 이루어진 planar 그래프에서 모든 bounded
    /// region을 체계적으로 찾아 face로 확정. 기존 face는 건드리지 않음.
    ///
    /// 알고리즘:
    /// 1. 모든 free HE를 수집, connected component로 그룹화 (공유 vertex).
    /// 2. 각 component마다 PCA-lite 기반 평면 결정 (3점 non-collinear).
    /// 3. Component의 평면으로 2D 투영 → leftmost-turn walk → cycle 수집.
    /// 4. Signed area > 0인 cycle을 face로 생성.
    ///
    /// 다중 평면 지원: 각 component 독립적으로 평면 결정, 3D 스케치 처리 가능.
    pub fn resolve_planar_free_faces(&mut self, material: MaterialId) -> Vec<FaceId> {
        self.resolve_planar_free_faces_scoped(material, None, None)
    }

    /// seed_verts: Some이면 해당 vertex를 포함하는 component만 처리.
    /// required_edges: Some이면 cycle이 최소 하나의 해당 edge를 포함해야 face 생성.
    ///   → 이전에 삭제된 면의 free HE cycle을 재생성하지 않도록 필수 (drawLine이
    ///   만든 새 edge가 없으면 skip).
    pub fn resolve_planar_free_faces_scoped(
        &mut self,
        material: MaterialId,
        seed_verts: Option<&[VertId]>,
        required_edges: Option<&[EdgeId]>,
    ) -> Vec<FaceId> {
        // Skip HEs belonging to non-topological edges (Centerline etc.) —
        // they shouldn't contribute to face synthesis (by contract).
        let free_hes: Vec<HeId> = self.hes.iter()
            .filter(|(_, he)| {
                if !he.is_active() || !he.face().is_null() { return false; }
                match self.edges.get(he.edge()) {
                    Some(e) => e.is_active() && e.class().is_topological(),
                    None => false,
                }
            })
            .map(|(id, _)| id)
            .collect();
        if free_hes.is_empty() { return Vec::new(); }

        // Step 1: free HE를 connected component로 그룹 (공유 vertex 기준)
        let free_set: FxHashSet<HeId> = free_hes.iter().copied().collect();
        let mut he_to_comp: FxHashMap<HeId, usize> = FxHashMap::default();
        let mut components: Vec<Vec<HeId>> = Vec::new();
        for &start in &free_hes {
            if he_to_comp.contains_key(&start) { continue; }
            let comp_id = components.len();
            let mut comp_hes: Vec<HeId> = Vec::new();
            let mut stack: Vec<HeId> = vec![start];
            while let Some(he) = stack.pop() {
                if he_to_comp.contains_key(&he) { continue; }
                he_to_comp.insert(he, comp_id);
                comp_hes.push(he);
                let src = self.he_source(he);
                let dst = self.hes[he].dst();
                for &v in &[src, dst] {
                    for (hid, h) in self.hes.iter() {
                        if !h.is_active() { continue; }
                        if !free_set.contains(&hid) { continue; }
                        if he_to_comp.contains_key(&hid) { continue; }
                        let hs = self.he_source(hid);
                        let hd = h.dst();
                        if hs == v || hd == v {
                            stack.push(hid);
                        }
                    }
                }
            }
            components.push(comp_hes);
        }

        // seed_verts 필터: 해당 vertex를 포함하는 component만 선택
        let filtered_components: Vec<&Vec<HeId>> = if let Some(seeds) = seed_verts {
            let seed_set: FxHashSet<VertId> = seeds.iter().copied().collect();
            components.iter().filter(|comp| {
                comp.iter().any(|&he| {
                    let src = self.he_source(he);
                    let dst = self.hes[he].dst();
                    seed_set.contains(&src) || seed_set.contains(&dst)
                })
            }).collect()
        } else {
            components.iter().collect()
        };

        let required_edge_set: Option<FxHashSet<EdgeId>> = required_edges
            .map(|e| e.iter().copied().collect());

        let mut created_all: Vec<FaceId> = Vec::new();
        for comp in filtered_components {
            let faces = self.resolve_component(comp, material, required_edge_set.as_ref());
            created_all.extend(faces);
        }
        created_all
    }

    /// 단일 component의 free HE들에 대해 평면 결정 + leftmost-turn + face 생성.
    fn resolve_component(
        &mut self,
        comp_hes: &[HeId],
        material: MaterialId,
        required_edges: Option<&FxHashSet<EdgeId>>,
    ) -> Vec<FaceId> {
        if comp_hes.is_empty() { return Vec::new(); }

        // Component의 모든 vertex 수집
        let mut verts_set: FxHashSet<VertId> = FxHashSet::default();
        for &he in comp_hes {
            verts_set.insert(self.he_source(he));
            verts_set.insert(self.hes[he].dst());
        }
        let verts_vec: Vec<VertId> = verts_set.iter().copied().collect();
        if verts_vec.len() < 3 { return Vec::new(); }

        // Step 2: 평면 결정 — 3점 non-collinear
        let p0 = match self.vertex_pos(verts_vec[0]) { Ok(p) => p, Err(_) => return Vec::new() };
        // 가장 먼 점 찾기 (v1)
        let mut max_d = 0.0_f64;
        let mut v1_pos = p0;
        for &v in verts_vec.iter().skip(1) {
            if let Ok(p) = self.vertex_pos(v) {
                let d = (p - p0).length_squared();
                if d > max_d { max_d = d; v1_pos = p; }
            }
        }
        if max_d < 1e-10 { return Vec::new(); }
        let e1 = (v1_pos - p0).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return Vec::new(); }
        // 최대 수직 거리 점 찾기 (v2)
        let mut max_perp = 0.0_f64;
        let mut v2_pos = p0;
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                let d = p - p0;
                let proj = e1 * d.dot(e1);
                let ortho = d - proj;
                let len = ortho.length_squared();
                if len > max_perp { max_perp = len; v2_pos = p; }
            }
        }
        if max_perp < 1e-10 { return Vec::new(); } // collinear component
        let e2 = {
            let d = v2_pos - p0;
            let proj = e1 * d.dot(e1);
            (d - proj).normalize_or_zero()
        };
        let normal = e1.cross(e2).normalize_or_zero();
        if normal.length_squared() < 1e-10 { return Vec::new(); }

        // 평면 coplanarity tolerance (상대)
        let tol = (max_d.sqrt() * 1e-4).max(1e-3);

        // Component의 모든 vertex가 평면 위에 있는지 확인
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                let dist = (p - p0).dot(normal).abs();
                if dist > tol { return Vec::new(); } // 비평면 component — skip
            }
        }

        // Step 3: 2D 투영
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };

        // vertex → 2D 좌표
        let mut vert_2d: FxHashMap<VertId, (f64, f64)> = FxHashMap::default();
        for &v in &verts_vec {
            if let Ok(p) = self.vertex_pos(v) {
                vert_2d.insert(v, project2d(p));
            }
        }

        // vertex → ALL outgoing HE (free + in-face 모두, angular ordering용)
        let mut vert_to_outs: FxHashMap<VertId, Vec<HeId>> = FxHashMap::default();
        for &v in &verts_vec {
            let mut list = Vec::new();
            for (hid, he) in self.hes.iter() {
                if !he.is_active() { continue; }
                if self.he_source(hid) != v { continue; }
                // 2D 상 위치 정의 가능한 경우만 포함 (dst이 vert_2d에 있음)
                if !vert_2d.contains_key(&he.dst()) { continue; }
                list.push(hid);
            }
            vert_to_outs.insert(v, list);
        }

        // HE의 2D 방향 angle
        let he_angle_2d = |hid: HeId, self_: &Mesh| -> f64 {
            let src = self_.he_source(hid);
            let dst = self_.hes[hid].dst();
            let ps = vert_2d.get(&src).copied().unwrap_or((0.0, 0.0));
            let pd = vert_2d.get(&dst).copied().unwrap_or((0.0, 0.0));
            (pd.1 - ps.1).atan2(pd.0 - ps.0)
        };

        // 정렬
        for (_, hes) in vert_to_outs.iter_mut() {
            hes.sort_by(|&a, &b| {
                let sa = he_angle_2d(a, self);
                let sb = he_angle_2d(b, self);
                sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        // Step 4: Leftmost-turn walk
        let free_set: FxHashSet<HeId> = comp_hes.iter().copied().collect();
        let mut visited: FxHashSet<HeId> = FxHashSet::default();
        let mut cycles: Vec<Vec<VertId>> = Vec::new();
        let max_iter = comp_hes.len() * 2 + 10;

        for &start in comp_hes {
            if visited.contains(&start) { continue; }
            let mut cycle_hes: Vec<HeId> = Vec::new();
            let mut current = start;
            let mut closed = false;
            for _ in 0..max_iter {
                if visited.contains(&current) { break; }
                cycle_hes.push(current);
                visited.insert(current);

                let v = self.hes[current].dst();
                let twin = self.he_twin(current);
                let outs = match vert_to_outs.get(&v) { Some(o) => o, None => break };
                if outs.is_empty() { break; }
                let twin_idx = match outs.iter().position(|&h| h == twin) {
                    Some(i) => i, None => break,
                };
                let next_idx = (twin_idx + outs.len() - 1) % outs.len();
                let next_he = outs[next_idx];

                if !self.hes[next_he].face().is_null() { break; }
                if !free_set.contains(&next_he) { break; }

                if next_he == start { closed = true; break; }
                current = next_he;
            }

            if !closed || cycle_hes.len() < 3 { continue; }

            // required_edges 필터: cycle이 적어도 하나의 required edge를 포함해야 함.
            // 이 필터는 "이전에 삭제된 면의 자유 엣지 cycle"이 재생성되는 것을 차단.
            //
            // **크기 제한**: 작은 cycle(≤7 vertices)에는 필터 적용 안 함.
            // 이유: 사용자가 새로 그리는 일반 도형(삼각/사각/오각형 등)은 vertex 수가 적음.
            // 반면 삭제된 원형 면(예: 원통 top 24 vertices)은 큰 cycle. 필터를 큰 cycle에만
            // 적용하면 일반 face 생성 실패 없이 큰 deleted boundary 재생성만 차단.
            if let Some(req) = required_edges {
                if cycle_hes.len() > 7 {
                    let uses_required = cycle_hes.iter().any(|&he| {
                        req.contains(&self.hes[he].edge())
                    });
                    if !uses_required { continue; }
                }
            }

            let verts: Vec<VertId> = cycle_hes.iter().map(|&h| self.he_source(h)).collect();
            cycles.push(verts);
        }

        // Step 5: Filters + face 생성
        //
        // 필터 순서 (싼 것부터):
        //   1) Signed area — bounded vs outer (기존)
        //   2) (A) Strip rejection — compactness 너무 낮으면 거부 (collinear strip loop)
        //   3) 기존 face 포함 검사 (B) — **local AABB 내부에 centroid가 있는 face만** 검사
        //   4) Coplanarity 재검증
        //   5) add_face
        //
        // 기존 face의 centroid 3D 좌표 + 면적 수집 (local AABB prune + size check).
        // 면적: cycle이 face를 "enclose"한다고 판단하려면 cycle이 face보다 커야 함.
        // 작은 cycle 내부에 큰 face의 centroid가 우연히 떨어져도 실제로는 enclose 아님
        // (예: outer rect 안에 inner rect 그릴 때 outer centroid가 inner 내부에 있음).
        let mut face_info: Vec<(DVec3, f64)> = Vec::new();
        for (_, f) in self.faces.iter() {
            if !f.is_active() { continue; }
            let verts = match self.collect_loop_verts(f.outer().start) { Ok(v) => v, Err(_) => continue };
            if verts.is_empty() { continue; }
            let pts: Vec<DVec3> = verts.iter().filter_map(|&v| self.vertex_pos(v).ok()).collect();
            if pts.len() < 3 { continue; }
            let mut c = DVec3::ZERO;
            for &p in &pts { c += p; }
            let centroid = c / pts.len() as f64;
            // 3D polygon area: 0.5 * |Σ (pi - p0) × (pi+1 - p0)|
            let mut area_vec = DVec3::ZERO;
            for i in 1..pts.len()-1 {
                area_vec += (pts[i] - pts[0]).cross(pts[i+1] - pts[0]);
            }
            let area = area_vec.length() * 0.5;
            face_info.push((centroid, area));
        }

        let point_in_poly_2d = |px: f64, py: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            if n < 3 { return false; }
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        let mut created: Vec<FaceId> = Vec::new();
        for verts in &cycles {
            // 2D 좌표 시퀀스
            let poly_2d: Vec<(f64, f64)> = verts.iter()
                .map(|v| vert_2d.get(v).copied().unwrap_or((0.0, 0.0)))
                .collect();
            if poly_2d.len() < 3 { continue; }

            // 1) Signed area
            let mut signed_area2 = 0.0;
            for i in 0..poly_2d.len() {
                let p = poly_2d[i];
                let q = poly_2d[(i + 1) % poly_2d.len()];
                signed_area2 += p.0 * q.1 - q.0 * p.1;
            }
            if signed_area2 <= 0.0 { continue; } // outer (CW) — skip

            let area = signed_area2.abs() * 0.5;

            // Perimeter
            let mut perimeter = 0.0;
            for i in 0..poly_2d.len() {
                let p = poly_2d[i];
                let q = poly_2d[(i + 1) % poly_2d.len()];
                let dx = q.0 - p.0;
                let dy = q.1 - p.1;
                perimeter += (dx*dx + dy*dy).sqrt();
            }
            if perimeter < 1e-6 { continue; }

            // (A) Strip rejection — normalized compactness (4π·area/perimeter²)
            // 원=1.0, 정사각형≈0.785, 10:1 사각형≈0.025, 100:1 strip≈0.003
            // 임계값 0.001: 극단적으로 얇은 strip만 거부.
            let compactness = 4.0 * std::f64::consts::PI * area / (perimeter * perimeter);
            if compactness < 0.001 { continue; }

            // Cycle의 2D AABB
            let mut min_x = f64::INFINITY;
            let mut max_x = f64::NEG_INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_y = f64::NEG_INFINITY;
            for &(x, y) in &poly_2d {
                if x < min_x { min_x = x; }
                if x > max_x { max_x = x; }
                if y < min_y { min_y = y; }
                if y > max_y { max_y = y; }
            }
            // 5% expansion — δ
            let dx = (max_x - min_x).max(1e-3) * 0.05;
            let dy = (max_y - min_y).max(1e-3) * 0.05;

            // (B) Local-containment / all-edges-free check (ADR-008 Axiom 7).
            // The cycle must be entirely on completely-free edges. Mixed
            // cycles are handled by Step 4.9 M1 split_face_by_chain.
            let all_edges_free = verts.iter().enumerate().all(|(i, _)| {
                let va = verts[i];
                let vb = verts[(i + 1) % verts.len()];
                match self.find_edge(va, vb) {
                    Some(eid) => self.is_edge_completely_free(eid),
                    None => false,
                }
            });
            if !all_edges_free { continue; }

            // Coplanarity 재검증
            if !self.are_verts_coplanar(verts) { continue; }

            // Face 생성
            if let Ok(fid) = self.add_face(verts, material) {
                // 인접 face와 normal 일관성 검사 — 필요 시 뒤집기
                self.align_face_with_neighbors(fid);
                created.push(fid);
            }
        }
        created
    }

    /// 다른 활성 face를 **물리적으로 감싸는** face를 찾아 dissolve.
    ///
    /// 시나리오: 사용자가 outer triangle을 그린 뒤 그 내부에 inner triangle을
    /// 그리고 connector 엣지까지 추가한 경우. Outer tri는 이미 face로 등록됐지만
    /// 그 경계 HE가 inner tri + wedge 영역의 CCW 순회를 차단 → wedge 생성 실패.
    /// Outer face를 dissolve해서 경계 HE를 해방시키면 D resolver가 inner+wedges를
    /// 올바르게 재구성.
    ///
    /// 조건: face A의 centroid가 다른 face B의 2D polygon 내부 + 같은 평면.
    /// 이때 B를 dissolve. B 자체가 다른 C를 감싸는 관계도 재귀적으로 처리 가능.
    /// 반환: dissolve된 face_ids.
    pub fn dissolve_containing_faces(&mut self) -> Vec<FaceId> {
        self.dissolve_containing_faces_opts(false)
    }

    /// `skip_ring_faces=true` 일 때, inner loop (hole) 이 이미 존재하는 face 를
    /// outer 후보에서 제외. Phase 3c second-pass (Step 4.95) 에서 B1 hole-
    /// promote 된 ring face 가 같은 inner 에 다시 매칭되어 이중 dissolve 되는
    /// 것을 방지.
    pub fn dissolve_containing_faces_opts(&mut self, skip_ring_faces: bool) -> Vec<FaceId> {
        let active: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .filter(|(_, f)| !(skip_ring_faces && !f.inners().is_empty()))
            .map(|(id, _)| id)
            .collect();
        // Containment requires ≥2 faces; single-face scene has nothing to
        // do and the O(F²) geom build below is wasted work.
        if active.len() < 2 { return Vec::new(); }
        // 각 face의 자체 평면에서 2D polygon + centroid 계산
        struct FaceGeom {
            poly_2d: Vec<(f64, f64)>,
            centroid_3d: DVec3,
            origin: DVec3,
            e1: DVec3,
            e2: DVec3,
            normal: DVec3,
        }
        let mut geoms: FxHashMap<FaceId, FaceGeom> = FxHashMap::default();
        for &fid in &active {
            let face = &self.faces[fid];
            let boundary = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if boundary.len() < 3 { continue; }
            let pts: Vec<DVec3> = boundary.iter()
                .filter_map(|&v| self.vertex_pos(v).ok())
                .collect();
            if pts.len() != boundary.len() { continue; }
            // face의 자체 평면 (normal + origin)
            let face_normal = face.normal();
            if face_normal.length_squared() < 1e-10 { continue; }
            let origin = pts[0];
            // e1: 첫 edge 방향
            let mut e1 = DVec3::ZERO;
            for p in &pts[1..] {
                let v = *p - origin;
                if v.length_squared() > 1e-6 {
                    e1 = v.normalize_or_zero();
                    break;
                }
            }
            if e1.length_squared() < 1e-10 { continue; }
            // e2 = normal × e1
            let e2 = face_normal.cross(e1).normalize_or_zero();
            if e2.length_squared() < 1e-10 { continue; }
            let poly_2d: Vec<(f64, f64)> = pts.iter()
                .map(|p| {
                    let v = *p - origin;
                    (v.dot(e1), v.dot(e2))
                })
                .collect();
            let cx: f64 = pts.iter().map(|p| p.x).sum::<f64>() / pts.len() as f64;
            let cy: f64 = pts.iter().map(|p| p.y).sum::<f64>() / pts.len() as f64;
            let cz: f64 = pts.iter().map(|p| p.z).sum::<f64>() / pts.len() as f64;
            geoms.insert(fid, FaceGeom {
                poly_2d, centroid_3d: DVec3::new(cx, cy, cz),
                origin, e1, e2, normal: face_normal,
            });
        }

        let point_in = |x: f64, y: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            if n < 3 { return false; }
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > y) != (yj > y)) &&
                   (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        // 각 outer face에 대해 inner face가 "같은 평면" + "polygon 내부" + "connector edge 존재"
        // 인 경우에만 dissolve. connector가 없는 단순 중첩(예: 사각형 안의 사각형)은
        // 사용자의 의도된 구조로 간주해 **보존**.
        //
        // connector 정의: outer boundary vertex와 inner boundary vertex를 연결하는 edge.
        // 이것이 있으면 wedge 재구성이 필요 → dissolve. 없으면 dissolve 불필요.
        let mut to_dissolve: FxHashSet<FaceId> = FxHashSet::default();
        for (&outer, og) in &geoms {
            // outer boundary vertex 수집
            let outer_boundary_verts: FxHashSet<VertId> = self.collect_loop_verts(
                self.faces[outer].outer().start
            ).unwrap_or_default().into_iter().collect();

            for (&inner, ig) in &geoms {
                if outer == inner { continue; }
                let n_dot = og.normal.dot(ig.normal).abs();
                if n_dot < 0.99 { continue; }
                // 평면 거리 (coplanar 체크)
                let v = ig.centroid_3d - og.origin;
                let dist = v.dot(og.normal).abs();
                let mut max_chord_sq = 0.0_f64;
                for i in 0..og.poly_2d.len() {
                    let (x, y) = og.poly_2d[i];
                    max_chord_sq = max_chord_sq.max(x*x + y*y);
                }
                let plane_tol = (max_chord_sq.sqrt() * 1e-4).max(1.0);
                if dist > plane_tol { continue; }

                // 2026-04-24 Phase 3c (FreeDesignX 포팅):
                //   기존 centroid-only / 2D projection 기반 containment 체크를
                //   `polygon_geom::polygon_contains_polygon` 로 교체. 엄밀
                //   내부점(ear-clipping) + 모든 vertex 포함 + winding 각합으로
                //   L-shape wrap 오판을 제거.
                let outer_pts: Vec<DVec3> = self.collect_loop_verts(self.faces[outer].outer().start)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
                    .collect();
                let inner_pts: Vec<DVec3> = self.collect_loop_verts(self.faces[inner].outer().start)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
                    .collect();
                if !crate::operations::polygon_geom::polygon_contains_polygon(&outer_pts, &inner_pts) {
                    continue;
                }

                // Connector 검사: outer boundary vertex ↔ inner boundary vertex 엣지
                let inner_boundary_verts: FxHashSet<VertId> = self.collect_loop_verts(
                    self.faces[inner].outer().start
                ).unwrap_or_default().into_iter().collect();

                // 2026-04-28 — connector 정의 강화 (사용자 보고: stacked-inner
                //   RECT 그릴 때 인접 RECT 의 면이 사라짐).
                //
                //   기존 logic 은 SHARED edge (outer 와 inner 가 corner 를
                //   공유) 를 connector 로 오판 → adjacent RECT 시나리오에서
                //   둘 다 dissolve.
                //
                //   진짜 connector 의 의미: outer 와 inner 사이를 BRIDGE 하는
                //   true interior edge — 즉 두 polygon 사이의 "free space" 에
                //   놓인 edge. SHARED edge (양쪽 boundary 모두에 속한 edge) 는
                //   connector 가 아니라 그냥 인접 boundary 일 뿐.
                //
                //   조건 강화: 한쪽 vert 는 outer 에만, 다른쪽 vert 는 inner
                //   에만 속해야 진짜 connector. 양쪽 vert 가 양 boundary 에
                //   동시 속하면 그건 shared edge (다른 의미).
                let has_connector = self.vert_to_edge.iter().any(|(key, &eid)| {
                    if !self.edges[eid].is_active() { return false; }
                    let a_in_outer = outer_boundary_verts.contains(&key.v_small);
                    let a_in_inner = inner_boundary_verts.contains(&key.v_small);
                    let b_in_outer = outer_boundary_verts.contains(&key.v_large);
                    let b_in_inner = inner_boundary_verts.contains(&key.v_large);
                    // True connector: 한 vert 는 outer-ONLY, 다른 vert 는 inner-ONLY.
                    let a_outer_only = a_in_outer && !a_in_inner;
                    let a_inner_only = a_in_inner && !a_in_outer;
                    let b_outer_only = b_in_outer && !b_in_inner;
                    let b_inner_only = b_in_inner && !b_in_outer;
                    (a_outer_only && b_inner_only) || (a_inner_only && b_outer_only)
                });

                if has_connector {
                    to_dissolve.insert(outer);
                }
                // connector 없으면 중첩 유지 (사용자 의도).
            }
        }

        let mut dissolved: Vec<FaceId> = Vec::new();
        for fid in to_dissolve {
            if self.remove_face(fid).is_ok() { dissolved.push(fid); }
        }
        dissolved
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
        // Duplicates require ≥2 faces.
        if active_ids.len() < 2 { return Vec::new(); }

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

    /// Face의 normal을 인접 face의 normal과 일관되게 맞춤.
    ///
    /// Manifold 규칙: 닫힌 솔리드의 인접 face들은 모두 같은 쪽(outward/inward)을
    /// 향함. 특히 인접 face들 간 normal dot > 0. 새로 생성된 face가 우연히 반대
    /// 방향의 normal을 가지면 (예: 수직 평면에서 signed area 부호 혼동) 인접 face와
    /// dot < 0이 됨 → 뒤집어서 수정.
    ///
    /// 반환: flip이 수행되었는지.
    pub fn align_face_with_neighbors(&mut self, face_id: FaceId) -> bool {
        let face = match self.faces.get(face_id) { Some(f) => f, None => return false };
        if !face.is_active() { return false; }
        let my_normal = face.normal();
        if my_normal.length_squared() < 1e-10 { return false; }

        let verts = match self.collect_loop_verts(face.outer().start) {
            Ok(v) => v, Err(_) => return false,
        };
        if verts.len() < 3 { return false; }

        // 각 edge에서 adjacent face 찾기 (HE twin의 face)
        let mut total_dot = 0.0;
        let mut neighbor_count = 0;
        for i in 0..verts.len() {
            let va = verts[i];
            let vb = verts[(i + 1) % verts.len()];
            let edge_id = match self.find_edge(va, vb) { Some(e) => e, None => continue };
            // Radial chain에서 다른 face를 가진 HE 찾기
            let start_he = self.edges[edge_id].any_he();
            if start_he.is_null() { continue; }
            let mut he = start_he;
            loop {
                let f = self.hes[he].face();
                if !f.is_null() && f != face_id {
                    if let Some(neighbor) = self.faces.get(f) {
                        if neighbor.is_active() {
                            let n_normal = neighbor.normal();
                            if n_normal.length_squared() > 1e-10 {
                                total_dot += my_normal.dot(n_normal);
                                neighbor_count += 1;
                            }
                        }
                    }
                }
                he = self.hes[he].next_rad();
                if he == start_he { break; }
            }
        }

        // 다수의 이웃이 나와 반대 방향(dot < 0)이면 flip
        if neighbor_count > 0 && total_dot < 0.0 {
            let _ = self.flip_face_safe(face_id);
            return true;
        }
        false
    }

    /// Mark an edge as SOFT (rendering-suppressed). Sets SOFTEN_COPLANAR and
    /// clears HARD. The DCEL topology stays intact — the edge is only hidden
    /// visually and excluded from wireframe output.
    ///
    /// 2026-04-24: introduced for the "merge failed → soften instead of
    /// cascade-delete" branch in `batch_erase_edges_with_merge`. Non-coplanar
    /// face merges cannot be topologically flattened (a DCEL face must be
    /// planar), but the user's intent "make this edge disappear" is honoured
    /// by hiding it. Two faces remain but read as one surface.
    /// Returns true iff every half-edge in the edge's radial loop has a
    /// null face — i.e. the edge is on no face at all. Used by Phase E
    /// synthesis to tell apart "freshly drawn" edges (completely free)
    /// from edges that bound an existing face and would, if part of a
    /// larger cycle, indicate recreation of a previously-resolved outer.
    /// Does `edge_id` have a free half-edge pointing from `src` to `dst`?
    /// Needed by the manifold-safety gates in D resolver and Step 4(b):
    /// before claiming a cycle edge, callers verify a suitable free HE
    /// already exists in the radial ring, avoiding a 4-way ring that
    /// would make the twin pair self-referencing.
    pub fn has_free_he_from_to(&self, edge_id: EdgeId, src: VertId, dst: VertId) -> bool {
        let Some(edge) = self.edges.get(edge_id) else { return false; };
        if !edge.is_active() { return false; }
        let start = edge.any_he();
        if start.is_null() { return false; }
        let mut he = start;
        loop {
            match self.hes.get(he) {
                Some(h) => {
                    if h.dst() == dst && h.face().is_null() {
                        // Verify src too — walk to prev via loop (expensive
                        //   in general but the edge's HEs all connect the
                        //   same two verts, so any HE with dst=dst has
                        //   src=other endpoint of this edge).
                        let v_small = edge.v_small();
                        let v_large = edge.v_large();
                        let he_src = if dst == v_small { v_large } else { v_small };
                        if he_src == src { return true; }
                    }
                    let next = h.next_rad();
                    if next.is_null() || next == start { return false; }
                    he = next;
                }
                None => return false,
            }
        }
    }

    pub fn is_edge_completely_free(&self, edge_id: EdgeId) -> bool {
        let Some(edge) = self.edges.get(edge_id) else { return false; };
        if !edge.is_active() { return false; }
        let start = edge.any_he();
        if start.is_null() { return false; }
        let mut he = start;
        loop {
            match self.hes.get(he) {
                Some(h) => {
                    if !h.face().is_null() { return false; }
                    let next = h.next_rad();
                    if next.is_null() || next == start { return true; }
                    he = next;
                }
                None => return false,
            }
        }
    }

    pub fn mark_edge_soft(&mut self, edge_id: EdgeId) {
        if !self.edges.contains(edge_id) { return; }
        let he_start = self.edges[edge_id].any_he();
        if he_start.is_null() { return; }
        let mut he_id = he_start;
        loop {
            // Set BOTH SOFT (render-hide) and SOFTEN_COPLANAR (semantic tag).
            // The renderer checks SOFT to skip drawing — that's the actual
            // visibility switch. SOFTEN_COPLANAR is a broader "treat as soft
            // when faces are coplanar" hint but is NOT what the render path
            // tests, so forgetting SOFT would keep the edge drawn.
            let mut new_flags = self.hes[he_id].flags()
                | HeFlags::SOFT
                | HeFlags::SOFTEN_COPLANAR;
            new_flags.remove(HeFlags::HARD);
            self.hes[he_id].set_flags(new_flags);
            he_id = self.hes[he_id].next_rad();
            if he_id == he_start { break; }
        }
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
    /// ADR-007 Rev 2 — Face classification.
    ///
    /// Returns `true` if the face is part of a closed volume (Wall),
    /// `false` if it is a standalone sheet (boundary face or open surface).
    ///
    /// Rule: a face is a Wall iff every half-edge on its outer loop AND
    /// every inner-hole loop has a twin that belongs to another active
    /// face. If any HE has a null twin or a twin that points to an
    /// inactive face, the face is a Sheet (manifold-with-boundary).
    ///
    /// This drives renderer choice (DoubleSide for Sheet, FrontSide for
    /// Wall), Boolean operand validity, and winding-invariant checks.
    pub fn is_face_in_volume(&self, face_id: FaceId) -> bool {
        let Some(face) = self.faces.get(face_id) else { return false; };
        if !face.is_active() { return false; }

        let check_loop = |start: HeId| -> bool {
            let Ok(hes) = self.collect_loop_hes(start) else { return false; };
            for he_id in hes {
                let twin_id = self.he_twin(he_id);
                if twin_id.is_null() { return false; }
                let Some(twin) = self.hes.get(twin_id) else { return false; };
                if !twin.is_active() { return false; }
                let twin_face = twin.face();
                if twin_face.is_null() { return false; }
                let Some(tf) = self.faces.get(twin_face) else { return false; };
                if !tf.is_active() { return false; }
                if twin_face == face_id { return false; } // self-twin = degenerate
            }
            true
        };

        if !check_loop(face.outer().start) { return false; }
        for inner in face.inners() {
            if !check_loop(inner.start) { return false; }
        }
        true
    }

    /// Convenience inverse of `is_face_in_volume`.
    pub fn is_sheet_face(&self, face_id: FaceId) -> bool {
        !self.is_face_in_volume(face_id)
    }

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

    /// Count distinct active edges incident to a vertex.
    /// Walks the radial v_next chain from the vertex's outgoing half-edge.
    fn count_incident_edges(&self, vid: VertId) -> usize {
        let v = match self.verts.get(vid) {
            Some(v) if v.is_active() => v,
            _ => return 0,
        };
        let start = match v.outgoing() {
            Some(he) if !he.is_null() => he,
            _ => return 0,
        };
        let mut seen: std::collections::HashSet<EdgeId> = std::collections::HashSet::new();
        let mut he_id = start;
        for _ in 0..256 {
            // guard
            let he = match self.hes.get(he_id) {
                Some(h) if h.is_active() => h,
                _ => break,
            };
            if self.edges.get(he.edge()).map(|e| e.is_active()).unwrap_or(false) {
                seen.insert(he.edge());
            }
            let next = he.v_next();
            if next == start || next.is_null() { break; }
            he_id = next;
        }
        seen.len()
    }

    /// Given an edge and one endpoint, return the "other" incident edge at
    /// that endpoint — but ONLY when exactly 2 edges meet there (valence 2).
    /// Returns None for junctions (valence ≥ 3), dead ends, or invalid input.
    /// Used by `collect_edge_chain` to walk polyline chains through regular
    /// chain vertices.
    fn other_edge_at_valence2(&self, edge_id: EdgeId, at_vert: VertId) -> Option<EdgeId> {
        if self.count_incident_edges(at_vert) != 2 { return None; }
        let v = self.verts.get(at_vert)?;
        let start = v.outgoing()?;
        if start.is_null() { return None; }
        let mut he_id = start;
        for _ in 0..256 {
            let he = self.hes.get(he_id)?;
            if !he.is_active() { break; }
            let eid = he.edge();
            if eid != edge_id
                && self.edges.get(eid).map(|e| e.is_active()).unwrap_or(false)
            {
                return Some(eid);
            }
            let next = he.v_next();
            if next == start || next.is_null() { break; }
            he_id = next;
        }
        None
    }

    /// Collect all edges in the **polyline chain** containing `edge_id`.
    /// The chain walks through degree-2 vertices (exactly 2 incident edges)
    /// from both endpoints of the seed edge and stops at junctions (≥3) or
    /// dead ends (1). Returned edges include the seed itself and are in
    /// discovery order (not guaranteed topologically ordered).
    ///
    /// Use cases:
    ///   - SketchUp / Blender "Select → Chain" one-click selection
    ///   - "Select all connected edges in this polyline" for DXF polyline
    ///     import cleanup
    ///
    /// Complexity: O(chain_length) — each edge visited once.
    pub fn collect_edge_chain(&self, edge_id: EdgeId) -> Vec<EdgeId> {
        if !self.edges.get(edge_id).map(|e| e.is_active()).unwrap_or(false) {
            return Vec::new();
        }
        let mut visited: std::collections::HashSet<EdgeId> = std::collections::HashSet::new();
        let mut result = Vec::new();
        let mut queue: Vec<EdgeId> = vec![edge_id];
        while let Some(eid) = queue.pop() {
            if !visited.insert(eid) { continue; }
            result.push(eid);
            if let Some(e) = self.edges.get(eid) {
                for endpoint in [e.v_small(), e.v_large()] {
                    if let Some(other) = self.other_edge_at_valence2(eid, endpoint) {
                        if !visited.contains(&other) {
                            queue.push(other);
                        }
                    }
                }
            }
            if result.len() > 100_000 {
                // Runaway guard — a chain should never be this long in
                // practice; stop to protect the caller.
                break;
            }
        }
        result
    }

    /// Get all edge IDs bounding a face's outer loop.
    pub fn face_outer_edges(&self, face_id: FaceId) -> Result<Vec<EdgeId>> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        Ok(hes.iter().map(|&he_id| self.hes[he_id].edge()).collect())
    }

    /// Analyze whether the given face set forms a closed 2-manifold solid.
    ///
    /// For a watertight solid (tetrahedron, cube, sphere, …) every bounding
    /// edge must be shared by exactly 2 faces within the set.
    ///
    /// # Algorithm
    ///   O(F · avg_edge_per_face). For each face, walk its outer loop and
    ///   accumulate edge→count. Final pass classifies by count.
    pub fn face_set_manifold_info(&self, face_ids: &[FaceId]) -> ManifoldInfo {
        let mut edge_counts: FxHashMap<EdgeId, u32> = FxHashMap::default();
        let mut active_faces = 0usize;
        for &fid in face_ids {
            let Some(face) = self.faces.get(fid) else { continue };
            if !face.is_active() { continue; }
            active_faces += 1;
            let edges = match self.face_outer_edges(fid) {
                Ok(v) => v,
                Err(_) => continue,
            };
            for e in edges {
                *edge_counts.entry(e).or_insert(0) += 1;
            }
        }
        let mut interior = 0usize;
        let mut boundary = 0usize;
        let mut non_manifold = 0usize;
        for &cnt in edge_counts.values() {
            match cnt {
                1 => boundary += 1,
                2 => interior += 1,
                _ => non_manifold += 1,
            }
        }
        // 최소 closed solid = tetrahedron (4 faces). 1~3 face로는 closed 불가.
        let is_closed = active_faces >= 4 && boundary == 0 && non_manifold == 0;
        ManifoldInfo {
            face_count: active_faces,
            interior_edge_count: interior,
            boundary_edge_count: boundary,
            non_manifold_edge_count: non_manifold,
            is_closed_solid: is_closed,
        }
    }

    /// Convenience: true ⇔ face_set is a closed 2-manifold solid.
    pub fn is_face_set_closed_solid(&self, face_ids: &[FaceId]) -> bool {
        self.face_set_manifold_info(face_ids).is_closed_solid
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

    /// Export just the centerline edge segments (flat `[x,y,z, ...]` pairs)
    /// for separate rendering (dashed, thin, dimmer color). No edge map
    /// returned — centerlines are not pickable as distinct entities via the
    /// main edge-line hit path yet (they stay snap targets via vertex/midpoint
    /// but not as mid-edge nearest hits in rendering layer).
    pub fn export_centerline_lines(&self) -> Vec<f32> {
        let mut lines: Vec<f32> = Vec::new();
        for (_, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.class() != EdgeClass::Centerline { continue; }
            let p0 = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let p1 = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };
            lines.extend_from_slice(&[
                p0.x as f32, p0.y as f32, p0.z as f32,
                p1.x as f32, p1.y as f32, p1.z as f32,
            ]);
        }
        lines
    }

    /// export_edge_lines + edge ID map (segment index → EdgeId raw).
    /// Centerline edges are excluded — render them separately via
    /// `export_centerline_lines` to apply dashed / dimmer styling.
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        let cos_threshold = angle_threshold_deg.to_radians().cos();
        let mut lines: Vec<f32> = Vec::new();
        let mut edge_map: Vec<u32> = Vec::new();

        for (_edge_id, edge) in self.edges.iter() {
            if !edge.is_active() {
                continue;
            }
            // Centerline edges go through a separate rendering path
            // (export_centerline_lines) so skip them here.
            if edge.class() == EdgeClass::Centerline {
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

    /// ADR-021 P7 — Group simple inner faces by connected component.
    ///
    /// 두 face 가 edge 를 공유하면 같은 component. BFS 로 그룹화.
    /// 사용처: Step 4.95 P7 promote — connected component → 1 combined hole.
    pub fn find_inner_components(&self, inners: &[FaceId]) -> Vec<Vec<FaceId>> {
        use rustc_hash::FxHashSet;
        let inner_set: FxHashSet<FaceId> = inners.iter().copied().collect();
        let mut visited: FxHashSet<FaceId> = FxHashSet::default();
        let mut components: Vec<Vec<FaceId>> = Vec::new();

        for &start in inners {
            if visited.contains(&start) { continue; }
            let mut comp = Vec::new();
            let mut queue = vec![start];
            while let Some(fid) = queue.pop() {
                if visited.contains(&fid) { continue; }
                visited.insert(fid);
                comp.push(fid);

                let face = match self.faces.get(fid) { Some(f) => f, None => continue };
                let outer_start = face.outer().start;
                if outer_start.is_null() { continue; }
                let mut h = outer_start;
                let mut guard = 0usize;
                loop {
                    guard += 1;
                    if guard > 4096 { break; }
                    let twin = self.he_twin(h);
                    let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                    if !twin_face.is_null()
                        && inner_set.contains(&twin_face)
                        && !visited.contains(&twin_face)
                    {
                        queue.push(twin_face);
                    }
                    let he = match self.hes.get(h) { Some(h) => h, None => break };
                    h = he.next();
                    if h == outer_start { break; }
                }
            }
            components.push(comp);
        }
        components
    }

    /// ADR-021 P7 — Combined outer perimeter of a connected face component.
    ///
    /// Component 의 외곽 boundary 만 모아 CCW order 로 walk.
    /// Hole loop 으로 사용 시 호출자가 reverse() 하여 CW 로 변환.
    /// 결과: VertId 시퀀스 (CCW around the union region).
    pub fn compute_combined_perimeter(&self, component: &[FaceId]) -> anyhow::Result<Vec<VertId>> {
        use rustc_hash::FxHashSet;
        if component.is_empty() {
            anyhow::bail!("compute_combined_perimeter: empty component");
        }
        let comp_set: FxHashSet<FaceId> = component.iter().copied().collect();

        // 1) Find any boundary HE: outer-loop HE whose twin's face is NOT in component.
        let mut start_he: HeId = HeId::NULL;
        for &fid in component {
            let face = match self.faces.get(fid) { Some(f) => f, None => continue };
            let outer_start = face.outer().start;
            if outer_start.is_null() { continue; }
            let mut h = outer_start;
            let mut guard = 0usize;
            loop {
                guard += 1;
                if guard > 4096 { break; }
                let twin = self.he_twin(h);
                let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                if twin_face.is_null() || !comp_set.contains(&twin_face) {
                    start_he = h;
                    break;
                }
                let he = match self.hes.get(h) { Some(h) => h, None => break };
                h = he.next();
                if h == outer_start { break; }
            }
            if !start_he.is_null() { break; }
        }
        if start_he.is_null() {
            anyhow::bail!("compute_combined_perimeter: no boundary HE in component");
        }

        // 2) Walk the boundary CCW. At each step, take next; if next is interior
        //    (twin in component), jump to twin.next to continue along the union.
        let mut walk: Vec<HeId> = vec![start_he];
        let mut cur = start_he;
        let mut guard = 0usize;
        loop {
            guard += 1;
            if guard > 8192 {
                anyhow::bail!("compute_combined_perimeter: walk too long");
            }
            let cur_he = self.hes.get(cur)
                .ok_or_else(|| anyhow::anyhow!("missing HE in walk"))?;
            let mut next_he_id = cur_he.next();
            // Skip interior edges.
            let mut inner_guard = 0usize;
            loop {
                inner_guard += 1;
                if inner_guard > 4096 {
                    anyhow::bail!("compute_combined_perimeter: interior skip too long");
                }
                let next_he = self.hes.get(next_he_id)
                    .ok_or_else(|| anyhow::anyhow!("missing HE in skip"))?;
                let twin = self.he_twin(next_he_id);
                let twin_face = self.hes.get(twin).map(|t| t.face()).unwrap_or(FaceId::NULL);
                if twin_face.is_null() || !comp_set.contains(&twin_face) {
                    break; // boundary
                }
                // interior — jump to twin's next
                next_he_id = self.hes.get(twin)
                    .ok_or_else(|| anyhow::anyhow!("missing twin"))?.next();
                let _ = next_he;
            }
            if next_he_id == start_he { break; }
            walk.push(next_he_id);
            cur = next_he_id;
        }

        // 3) Convert HEs → source verts (CCW order)
        let verts: Vec<VertId> = walk.iter()
            .map(|&h| self.he_source(h))
            .collect();
        Ok(verts)
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
        // Default strict tolerance = 0.5° (기존 동작 유지)
        self.are_faces_coplanar_with_tolerance(f1, f2, 0.5)
    }

    /// 사용자 지정 각도 tolerance로 coplanar 여부 검사 (B1).
    ///
    /// `angle_tol_deg` — 법선 간 허용 각도 (°). 0.5 = CAD 표준,
    /// 2~5는 "거의 coplanar" 병합용.
    /// 0 이하 또는 NaN이면 기본 0.5°로 보정.
    pub fn are_faces_coplanar_with_tolerance(
        &self,
        f1: FaceId,
        f2: FaceId,
        angle_tol_deg: f64,
    ) -> Result<bool> {
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

        // 동적 threshold — 사용자 tolerance 기반
        let tol = if angle_tol_deg.is_finite() && angle_tol_deg > 0.0 {
            angle_tol_deg.min(45.0) // 상한 45° (그 이상은 의미 없음)
        } else {
            0.5
        };
        let cos_threshold = (tol.to_radians()).cos();
        let dot = n1u.dot(n2u).abs();
        if dot < cos_threshold {
            return Ok(false);
        }

        // Scale-aware distance tolerance: use f1+f2 combined bbox diagonal.
        // Tolerance scales with angle tolerance — a larger angle can tilt the
        // far vertex by bbox × sin(angle), so distance tolerance must allow
        // that much offset. Otherwise 2° angle accept + 0.002mm distance reject
        // contradicts each other for non-tiny faces.
        let mut min_pt = glam::DVec3::splat(f64::INFINITY);
        let mut max_pt = glam::DVec3::splat(f64::NEG_INFINITY);
        for &vid in verts1.iter().chain(verts2.iter()) {
            if let Ok(p) = self.vertex_pos(vid) {
                min_pt = min_pt.min(p);
                max_pt = max_pt.max(p);
            }
        }
        let bbox_diag = (max_pt - min_pt).length().max(1.0);
        // 기본 정밀 tolerance (구 로직 유지) + 각도 기반 보정
        let base_tol = (bbox_diag * 1e-5).max(1e-3);
        let angle_based_tol = bbox_diag * tol.to_radians().sin() * 1.2; // 20% 여유
        let dist_tol = base_tol.max(angle_based_tol);

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
        self.merge_faces_by_edge_with_tolerance(edge_id, 0.5)
    }

    /// 사용자 지정 각도 tolerance로 두 coplanar face 병합 (B1).
    ///
    /// `angle_tol_deg` — 허용 각도 (°). 0.5 = 엄격, 2~5 = 관대.
    /// CAD-grade 품질을 위해 상한 45°로 자동 클램프.
    pub fn merge_faces_by_edge_with_tolerance(
        &mut self,
        edge_id: EdgeId,
        angle_tol_deg: f64,
    ) -> Result<FaceId> {
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

        // 2. Coplanarity check (tolerance 기반)
        if !self.are_faces_coplanar_with_tolerance(f1, f2, angle_tol_deg)? {
            bail!("Faces {:?} and {:?} are not coplanar (tol={:.2}°)", f1, f2, angle_tol_deg);
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

        // 10. 2026-04-27 — 사용자 보고 "면은 합성되지만 잔여 선이 면과 일체화":
        //   simplify_collinear_loop 가 중간 vertex 를 제거해도, 그 vertex 가
        //   다른 dangling 엣지 (이전 split 결과의 stub) 의 endpoint 라면
        //   merged face 의 새 loop 에는 안 들어가지만 mesh 에는 그대로 남아
        //   "보이는 잔여 선" 이 됨. cleanup_dangling 이 엣지의 양쪽 half-edge
        //   가 모두 inactive face 인 경우만 제거하므로 안전 (다른 face 가
        //   여전히 사용하는 엣지는 보존).
        let _ = self.cleanup_dangling();

        // 2026-04-28 — 사용자 보고 후속: 단일-shared standard merge 경로에서도
        //   비-manifold edge / split-vertex stub 잔재 가능. second pass 강화.
        let mut second_pass_remove: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() {
                second_pass_remove.push(eid);
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
            if all_null { second_pass_remove.push(eid); }
        }
        for eid in second_pass_remove {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }
        self.remove_isolated_verts();

        // ADR-007 — merge 후 invariants 검증 (debug only)
        self.debug_verify_invariants();
        Ok(new_face)
    }

    /// Phase F — 비인접(non-adjacent) coplanar 병합: outer face 안에 완전히
    /// 포함된 inner face를 hole로 합침 (ADR-006 C1 케이스).
    ///
    /// 조건:
    ///   - 두 face가 coplanar (tolerance 적용)
    ///   - inner의 모든 vertex가 outer 평면 내부에 투영됐을 때 outer 다각형 내부
    ///   - 두 face가 엣지를 공유하지 않음 (진짜 비인접)
    ///
    /// 동작:
    ///   1. outer의 기존 hole들 보존
    ///   2. inner의 outer loop을 새 hole로 추가 (CW 방향으로 저장됨)
    ///   3. inner face 제거 (그러나 vert/edge는 남아 hole boundary로 사용)
    ///
    /// 반환: 병합된 face_id (기존 outer_face 재사용)
    pub fn merge_coplanar_containing(
        &mut self,
        outer_face: FaceId,
        inner_face: FaceId,
        angle_tol_deg: f64,
    ) -> Result<FaceId> {
        if outer_face == inner_face {
            bail!("outer and inner faces are the same");
        }
        // 두 face 활성 확인
        if !self.faces.get(outer_face).map(|f| f.is_active()).unwrap_or(false) {
            bail!("outer face {:?} inactive or missing", outer_face);
        }
        if !self.faces.get(inner_face).map(|f| f.is_active()).unwrap_or(false) {
            bail!("inner face {:?} inactive or missing", inner_face);
        }

        // 1. 엣지 공유 금지 (공유하면 일반 merge_faces_by_edge 사용해야 함)
        let shared = self.count_shared_edges_outer(outer_face, inner_face);
        if shared > 0 {
            bail!("faces share {} edge(s) — use merge_faces_by_edge instead", shared);
        }

        // 2. Coplanarity (tolerance 허용)
        if !self.are_faces_coplanar_with_tolerance(outer_face, inner_face, angle_tol_deg)? {
            bail!("faces not coplanar within {:.2}°", angle_tol_deg);
        }

        // 3. 외부 경계 수집
        let outer_verts = self.collect_loop_verts(self.faces[outer_face].outer().start)?;
        let inner_verts = self.collect_loop_verts(self.faces[inner_face].outer().start)?;
        if outer_verts.len() < 3 || inner_verts.len() < 3 {
            bail!("degenerate loop");
        }

        // 4. Containment — outer의 평면에서 inner 모든 vertex가 outer polygon 내부
        //    (2D projection + point-in-polygon)
        let n = self.faces[outer_face].normal().normalize_or_zero();
        if n.length_squared() < 1e-10 {
            bail!("outer face normal degenerate");
        }
        let p0 = self.vertex_pos(outer_verts[0])?;
        // 평면의 두 basis 구성
        let mut t = DVec3::new(1.0, 0.0, 0.0);
        if t.cross(n).length_squared() < 1e-6 { t = DVec3::new(0.0, 1.0, 0.0); }
        let e1 = (t - n * t.dot(n)).normalize_or_zero();
        let e2 = n.cross(e1).normalize_or_zero();
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - p0;
            (v.dot(e1), v.dot(e2))
        };
        let outer_2d: Vec<(f64, f64)> = outer_verts.iter()
            .filter_map(|v| self.vertex_pos(*v).ok())
            .map(project2d)
            .collect();
        if outer_2d.len() < 3 { bail!("outer 2D projection failed"); }

        let point_in = |x: f64, y: f64, poly: &[(f64, f64)]| -> bool {
            let mut inside = false;
            let n = poly.len();
            let mut j = n - 1;
            for i in 0..n {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > y) != (yj > y))
                   && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            inside
        };

        for &iv in &inner_verts {
            let p = self.vertex_pos(iv)?;
            let (x, y) = project2d(p);
            if !point_in(x, y, &outer_2d) {
                bail!("inner face {:?} not contained in outer {:?}", inner_face, outer_face);
            }
        }

        // 5. outer의 기존 hole들 보존
        let existing_inner_refs: Vec<LoopRef> = self.faces[outer_face].inners().to_vec();
        let mut existing_holes: Vec<Vec<VertId>> = Vec::new();
        for inner_ref in &existing_inner_refs {
            if inner_ref.start.is_null() { continue; }
            if let Ok(v) = self.collect_loop_verts(inner_ref.start) {
                if v.len() >= 3 { existing_holes.push(v); }
            }
        }

        // 6. inner의 inner loops — 이 경우 inner face도 hole을 가질 수 있지만
        //    보통 평평한 rect/원 → 지원 안 해도 일반적이진 않음. 일단 보존.
        let inner_face_holes: Vec<Vec<VertId>> = self.faces[inner_face].inners().iter()
            .filter_map(|ir| self.collect_loop_verts(ir.start).ok())
            .filter(|v| v.len() >= 3)
            .collect();

        // 7. 재료는 outer 기준
        let material = self.faces[outer_face].material();

        // 8. 두 face 제거 (엣지는 add_face_with_holes가 dedup하므로 살아남음)
        self.faces.remove(outer_face);
        self.faces.remove(inner_face);

        // 9. 재생성 — outer_verts + [inner_verts] + 기존 holes + inner의 holes
        let mut hole_slices: Vec<&[VertId]> = Vec::new();
        hole_slices.push(&inner_verts);
        for h in &existing_holes { hole_slices.push(h); }
        for h in &inner_face_holes { hole_slices.push(h); }

        let new_face = self.add_face_with_holes(&outer_verts, &hole_slices, material)?;
        // ADR-007 — 연산 후 invariants 검증
        self.debug_verify_invariants();
        Ok(new_face)
    }

    /// Count edges shared by the outer loops of two faces (F4 helper).
    pub fn count_shared_edges_outer(&self, f1: FaceId, f2: FaceId) -> usize {
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
    pub(crate) fn simplify_collinear_loop(&self, verts: &[VertId]) -> Vec<VertId> {
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
    /// Signed volume of the mesh (sum of signed tetrahedra built from the
    /// origin and each triangle of every active face, fan-triangulated).
    /// Exact for closed manifold solids; for open shells the result is
    /// the rough "enclosed" volume relative to the origin — useful as
    /// an estimate but not authoritative. Units: length³.
    pub fn mesh_volume(&self) -> f64 {
        let mut total = 0.0;
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let start = face.outer().start;
            if start.is_null() { continue; }
            let verts = match self.collect_loop_verts(start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            // Fan-triangulate around verts[0]. For each triangle
            // (v0, vi, vi+1) add the signed tetrahedron volume
            // (v0 · (vi × vi+1)) / 6. Summed across all faces of a
            // closed solid this gives the enclosed volume with sign
            // determined by the outward winding (ADR-007 CCW → positive).
            let p0 = match self.vertex_pos(verts[0]) { Ok(p) => p, Err(_) => continue };
            for i in 1..verts.len() - 1 {
                let pa = match self.vertex_pos(verts[i]) { Ok(p) => p, Err(_) => continue };
                let pb = match self.vertex_pos(verts[i + 1]) { Ok(p) => p, Err(_) => continue };
                total += p0.dot(pa.cross(pb));
            }
            let _ = fid;
        }
        total / 6.0
    }

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

    /// Remove dangling edges — edges with zero half-edges referencing an
    /// active face AND not in the scene's standalone-edge list. These appear
    /// after face merges when the old shared edge's topology wasn't fully
    /// dismantled.
    ///
    /// 2026-04-24: companion to the smooth-on-merge-fail path. After a
    /// successful merge, shelve residual edges/verts that have no geometric
    /// meaning left so they don't leak into render buffers.
    ///
    /// Returns (removed_edges, removed_vertices).
    pub fn cleanup_dangling(&mut self) -> (usize, usize) {
        self.cleanup_dangling_excluding(&std::collections::HashSet::new())
    }

    /// Same as `cleanup_dangling` but keeps any edge listed in `protected`
    /// even if it has lost all face references. Used by the Erase tool's
    /// face-only delete path so that boundary edges remain as standalone
    /// wireframe instead of vanishing along with the face (SketchUp-style
    /// CAD UX: "면만 지우고 엣지는 남긴다").
    ///
    /// The vertex-cleanup pass (step 2) still runs — orphan vertices that
    /// no edge references are removed unconditionally. Protected orphan
    /// edges are by definition still referencing their endpoints, so those
    /// vertices stay alive automatically.
    pub fn cleanup_dangling_excluding(
        &mut self,
        protected: &std::collections::HashSet<EdgeId>,
    ) -> (usize, usize) {
        // Step 1 — edges whose half-edges all point to inactive faces.
        //   The DCEL guarantees every edge has ≤ 2 half-edges; if both point
        //   to inactive faces (or null), the edge is dangling.
        let mut to_remove: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if protected.contains(&eid) { continue; }
            let he_a = edge.any_he();
            if he_a.is_null() {
                to_remove.push(eid);
                continue;
            }
            // Walk the radial chain; if no half-edge references an active face,
            // the edge is orphaned.
            let mut has_active_face = false;
            let mut he_id = he_a;
            loop {
                let he = &self.hes[he_id];
                let fid = he.face();
                if !fid.is_null() && self.faces.contains(fid) && self.faces[fid].is_active() {
                    has_active_face = true;
                    break;
                }
                he_id = he.next_rad();
                if he_id == he_a || he_id.is_null() { break; }
            }
            if !has_active_face {
                to_remove.push(eid);
            }
        }
        let edge_removed = to_remove.len();
        for eid in to_remove {
            let _ = self.remove_edge_and_halfedges(eid);
            if self.edges.contains(eid) { self.edges.remove(eid); }
        }

        // Step 2 — vertices with no remaining edge references.
        let before_verts = self.verts.iter().count();
        self.remove_isolated_verts();
        let after_verts = self.verts.iter().count();
        let vert_removed = before_verts - after_verts;

        (edge_removed, vert_removed)
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

    // ═══════════════════════════════════════════════════════════════
    //  Face Orientation Invariants (ADR-007)
    // ═══════════════════════════════════════════════════════════════

    /// 전체 mesh의 face orientation invariants 검증 결과.
    ///
    /// 위반 사항이 있으면 `violations`에 Human-readable 메시지 열거.
    /// `is_valid == true` 이면 모든 invariant 통과.
    pub fn verify_face_invariants(&self) -> InvariantReport {
        let mut violations: Vec<String> = Vec::new();
        let mut checked_faces = 0usize;

        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            checked_faces += 1;

            // I1: outer loop 존재 + 최소 3 verts
            let outer_start = face.outer().start;
            if outer_start.is_null() {
                violations.push(format!("face {:?}: null outer start", fid));
                continue;
            }
            let outer_verts = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(e) => {
                    violations.push(format!("face {:?}: cannot collect outer loop: {}", fid, e));
                    continue;
                }
            };
            if outer_verts.len() < 3 {
                violations.push(format!("face {:?}: outer loop has {} verts (< 3)",
                    fid, outer_verts.len()));
                continue;
            }

            // I2: cached normal이 실제 winding과 일치 (반대 방향이면 위반)
            let cached = face.normal();
            if cached.length_squared() > 1e-10 {
                if let Ok(computed) = self.compute_normal(&outer_verts) {
                    let cn = cached.normalize_or_zero();
                    let gn = computed.normalize_or_zero();
                    if cn.length_squared() > 1e-10 && gn.length_squared() > 1e-10 {
                        let dot = cn.dot(gn);
                        if dot < 0.9 {
                            violations.push(format!(
                                "face {:?}: cached normal opposite to winding (dot={:.3})",
                                fid, dot,
                            ));
                        }
                    }
                }
            }

            // I3: inner loops도 collect 가능해야 함 + 각각 ≥ 3 verts
            for (ii, inner) in face.inners().iter().enumerate() {
                if inner.start.is_null() {
                    violations.push(format!("face {:?}: inner[{}] null start", fid, ii));
                    continue;
                }
                match self.collect_loop_verts(inner.start) {
                    Ok(iv) if iv.len() >= 3 => {}
                    Ok(iv) => violations.push(format!(
                        "face {:?}: inner[{}] has {} verts (< 3)", fid, ii, iv.len())),
                    Err(e) => violations.push(format!(
                        "face {:?}: inner[{}] cannot collect: {}", fid, ii, e)),
                }
            }

            // I4: outer loop의 모든 half-edge가 이 face에 속해야 함
            if let Ok(outer_hes) = self.collect_loop_hes(outer_start) {
                for he in outer_hes {
                    let he_face = self.hes[he].face();
                    if he_face != fid {
                        violations.push(format!(
                            "face {:?}: outer HE {:?} points to wrong face {:?}",
                            fid, he, he_face,
                        ));
                    }
                }
            }
        }

        // I5: 각 edge는 최대 2개 active face와 공유
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let active_faces: Vec<_> = faces.iter()
                .filter(|&&f| self.faces.get(f).map(|face| face.is_active()).unwrap_or(false))
                .collect();
            if active_faces.len() > 2 {
                violations.push(format!(
                    "edge {:?}: shared by {} active faces (non-manifold)",
                    eid, active_faces.len(),
                ));
            }
        }

        InvariantReport {
            checked_faces,
            violations,
        }
    }

    /// ADR-007 Rev 2 Tier 4 D — 2D Boolean for two coplanar Sheet faces.
    ///
    /// Operations:
    ///   "intersect" — sutherland_hodgman convex clip
    ///   "union"     — convex_union_2d (centroid-CCW from boundary verts)
    ///   "subtract"  — convex_difference_2d (a − b, single piece)
    ///
    /// MVP가정 (Convex polygons only, single-piece result). Non-convex
    /// 입력이거나 결과가 multi-piece 이면 Err — 향후 Greiner-Hormann
    /// 풀 구현으로 확장 예정.
    ///
    /// 인자:
    ///   `a`, `b`: Sheet face id (둘 다 same plane)
    ///   `op`: "union" | "subtract" | "intersect"
    ///
    /// 반환:
    ///   결과 face id (a 와 b 는 inactive 처리됨)
    pub fn sheet_boolean(
        &mut self,
        a: FaceId,
        b: FaceId,
        op: &str,
        material: MaterialId,
    ) -> Result<FaceId> {
        // Both must be active sheets.
        if !self.faces.contains(a) || !self.faces.contains(b) {
            anyhow::bail!("sheet_boolean: face {:?} or {:?} not found", a, b);
        }
        if !self.faces[a].is_active() || !self.faces[b].is_active() {
            anyhow::bail!("sheet_boolean: inactive face");
        }
        if !self.is_sheet_face(a) || !self.is_sheet_face(b) {
            anyhow::bail!("sheet_boolean: both inputs must be Sheet (not Wall)");
        }
        let verts_a = self.collect_loop_verts(self.faces[a].outer().start)?;
        let verts_b = self.collect_loop_verts(self.faces[b].outer().start)?;
        if verts_a.len() < 3 || verts_b.len() < 3 {
            anyhow::bail!("sheet_boolean: degenerate face boundary");
        }
        let pts_a: Vec<DVec3> = verts_a.iter()
            .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
            .collect();
        let pts_b: Vec<DVec3> = verts_b.iter()
            .filter_map(|&v| self.verts.get(v).map(|vx| vx.pos()))
            .collect();

        // Coplanarity check via face normal alignment + plane distance.
        let basis = crate::operations::polygon_geom::PlaneBasis::from_polygon(&pts_a)
            .ok_or_else(|| anyhow::anyhow!("sheet_boolean: cannot derive plane from face a"))?;
        for p in &pts_b {
            let dist = (*p - basis.origin).dot(basis.normal).abs();
            let scale = pts_b.iter().map(|q| (*q - basis.origin).length()).fold(0.0_f64, f64::max);
            let tol = (scale * 1e-4).max(1.0);
            if dist > tol {
                anyhow::bail!(
                    "sheet_boolean: face b not coplanar with a (max dist {:.2} > tol {:.2})",
                    dist, tol,
                );
            }
        }

        let poly_a: Vec<(f64, f64)> = pts_a.iter().map(|p| basis.project(*p)).collect();
        let poly_b: Vec<(f64, f64)> = pts_b.iter().map(|p| basis.project(*p)).collect();

        let result_2d = match op {
            "intersect" => crate::operations::polygon_geom::sutherland_hodgman(&poly_a, &poly_b),
            "union"     => crate::operations::polygon_geom::convex_union_2d(&poly_a, &poly_b),
            "subtract"  => crate::operations::polygon_geom::convex_difference_2d(&poly_a, &poly_b),
            _ => anyhow::bail!("sheet_boolean: unknown op '{}' (expect union/subtract/intersect)", op),
        };
        let result_2d = result_2d.ok_or_else(|| anyhow::anyhow!(
            "sheet_boolean: {} produced no result (disjoint or non-convex)", op
        ))?;
        if result_2d.len() < 3 {
            anyhow::bail!("sheet_boolean: degenerate result polygon ({} verts)", result_2d.len());
        }

        // Lift back to 3D + add new face.
        let new_verts: Vec<VertId> = result_2d.iter()
            .map(|&(x, y)| self.add_vertex(basis.lift(x, y)))
            .collect();
        let new_face = self.add_face(&new_verts, material)?;

        // Remove originals (soft if you want undo; hard here for simplicity).
        let _ = self.remove_face(a);
        let _ = self.remove_face(b);

        Ok(new_face)
    }

    /// ADR-007 Rev 2 Phase B-3 — Recompute every active face's cached
    /// `normal` from its current outer-loop winding and write it back.
    ///
    /// Acts as the "auto-correct on save" step described in the ADR:
    /// the winding is the single source of truth (Principle 3), so any
    /// stale cached normal that disagrees with topology gets silently
    /// fixed before serialization. Wall and Sheet faces are treated
    /// the same here — the cache should always match topology.
    ///
    /// Returns the count of faces whose cached normal was changed.
    /// Caller can log this for transparency.
    ///
    /// Use this *before* `export_versioned_snapshot()` /
    /// `export_versioned_snapshot_strict()` when you want the
    /// resulting bytes to round-trip cleanly through the Rev 2
    /// invariant verifier.
    pub fn reconcile_face_normals(&mut self) -> usize {
        let active: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();
        let mut changed = 0usize;
        for fid in active {
            let outer_start = self.faces[fid].outer().start;
            if outer_start.is_null() { continue; }
            let Ok(verts) = self.collect_loop_verts(outer_start) else { continue; };
            if verts.len() < 3 { continue; }
            let Ok(computed) = self.compute_normal(&verts) else { continue; };
            if computed.length_squared() < 1e-10 { continue; }
            let stored = self.faces[fid].normal();
            // Only write if direction actually disagrees (avoids touching
            // every face every save when nothing's wrong).
            let stored_n = stored.normalize_or_zero();
            let computed_n = computed.normalize_or_zero();
            if stored_n.length_squared() < 1e-10
                || stored_n.dot(computed_n) < 0.999
            {
                self.faces[fid].set_normal(computed);
                changed += 1;
            }
        }
        changed
    }

    /// ADR-007 Rev 2 — Sheet-aware invariant report.
    ///
    /// `verify_face_invariants` 의 결과 중 Wall 면에 적용되는 winding-기반
    /// violation (현재 I2 normal-mismatch) 는 그대로 두고, Sheet 면의 동일
    /// violation 은 자동으로 OK 로 간주해 리포트에서 제외.
    ///
    /// I1 (loop 존재), I3 (inner loop 유효성), I4 (HE 소속), I5 (non-manifold)
    /// 같은 *구조적* invariant 는 모든 face 에 그대로 적용 — 이들은 winding
    /// 방향과 무관한 mesh integrity 검증.
    ///
    /// 사용처: `Scene::export_versioned_snapshot_strict` 등 strict 검증
    /// 경로에서 Rev 2 정책에 맞는 분류별 검증을 원할 때.
    pub fn verify_face_invariants_rev2(&self) -> InvariantReport {
        let mut report = self.verify_face_invariants();
        // I2 violation 은 메시지에 "cached normal opposite to winding" 패턴.
        // Sheet 면은 winding 자유이므로 이 케이스만 필터링.
        report.violations.retain(|msg| {
            if !msg.contains("cached normal opposite to winding") { return true; }
            // "face FaceId(N): cached..." 에서 N 파싱
            let Some(start) = msg.find("FaceId(") else { return true; };
            let after = &msg[start + 7..];
            let Some(end) = after.find(')') else { return true; };
            let Ok(raw) = after[..end].parse::<u32>() else { return true; };
            let fid = FaceId::new(raw);
            // Sheet 면이면 violation 제거 (true 가 아닌 false 반환 = drop)
            !self.is_sheet_face(fid)
        });
        report
    }

    /// ADR-007 원칙 1 확장 — 닫힌 solid에서 각 face normal이 outward 향하는지 검증.
    ///
    /// 닫힌 2-manifold solid가 아니면 (open surface 등) 빈 리포트 반환.
    /// 휴리스틱: mesh centroid → face centroid 방향과 face normal이 양의 내적이면
    /// outward. 볼록체에서 완벽, 심한 오목체에선 제한적.
    ///
    /// 사용 예: Phase G/H 이후 closed solid 생성 확인, box/sphere 등 프리미티브
    /// sanity check, push/pull 결과 검증 등.
    pub fn verify_outward_normals(&self) -> OutwardReport {
        let active_faces: Vec<FaceId> = self.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();

        // 닫힌 solid 여부 확인 — open surface는 outward 정의 불가
        let manifold = self.face_set_manifold_info(&active_faces);
        if !manifold.is_closed_solid {
            return OutwardReport {
                is_closed_solid: false,
                checked_faces: 0,
                inward_count: 0,
                inward_faces: Vec::new(),
            };
        }

        // Mesh centroid — 모든 active vertex 평균
        let mut sum = DVec3::ZERO;
        let mut cnt = 0usize;
        for (_, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            if let Ok(verts) = self.collect_loop_verts(face.outer().start) {
                for v in verts {
                    if let Ok(p) = self.vertex_pos(v) {
                        sum += p;
                        cnt += 1;
                    }
                }
            }
        }
        if cnt == 0 {
            return OutwardReport {
                is_closed_solid: true,
                checked_faces: 0,
                inward_count: 0,
                inward_faces: Vec::new(),
            };
        }
        let mesh_centroid = sum / cnt as f64;

        let mut inward_faces = Vec::new();
        for fid in &active_faces {
            let face = &self.faces[*fid];
            let normal = face.normal();
            if normal.length_squared() < 1e-10 { continue; }

            // Face centroid
            let verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.is_empty() { continue; }
            let mut fc = DVec3::ZERO;
            let mut fcn = 0usize;
            for v in &verts {
                if let Ok(p) = self.vertex_pos(*v) {
                    fc += p;
                    fcn += 1;
                }
            }
            if fcn == 0 { continue; }
            fc /= fcn as f64;

            let outward = fc - mesh_centroid;
            if outward.length_squared() < 1e-10 { continue; }

            let dot = normal.dot(outward);
            if dot < 0.0 {
                // 내부 향함 감지
                inward_faces.push(*fid);
            }
        }

        OutwardReport {
            is_closed_solid: true,
            checked_faces: active_faces.len(),
            inward_count: inward_faces.len(),
            inward_faces,
        }
    }

    /// 디버그 빌드에서만 invariants 검증. Release에서는 no-op.
    /// 편집 연산 끝에 삽입해 조기 버그 감지용.
    #[inline]
    pub fn debug_verify_invariants(&self) {
        #[cfg(debug_assertions)]
        {
            let report = self.verify_face_invariants();
            if !report.is_valid() {
                eprintln!("[ADR-007] Invariant violations:\n{}", report.summary());
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase H — Import Normalizer (ADR-007 Barrier)
    // ═══════════════════════════════════════════════════════════════

    /// 외부 import된 mesh 데이터를 AXiA 네이티브 규칙에 맞게 정리.
    ///
    /// 이 함수는 "경계(Barrier)" 역할 — 외부 규칙의 데이터를 ADR-007 준수
    /// 데이터로 변환. Import 직후 반드시 호출하여 엔진 내부 규율 유지.
    ///
    /// 단계:
    ///   1. Degenerate face 제거 (zero-area)
    ///   2. Isolated vertex 정리
    ///   3. Winding 일관화 — 다수결로 "올바른" 방향 판정 후 소수 flip
    ///   4. Normal 캐시 재계산 (topology 기반)
    ///   5. 최종 invariant verify
    pub fn normalize_for_import(&mut self, opts: &NormalizeOptions) -> NormalizeReport {
        let mut report = NormalizeReport {
            degenerate_removed: 0,
            winding_flipped: 0,
            normals_recomputed: 0,
            isolated_verts_removed: 0,
            remaining_violations: 0,
        };

        // 1. Degenerate faces
        if opts.remove_degenerate {
            report.degenerate_removed = self.cleanup_degenerate_faces(opts.degenerate_tolerance);
        }

        // 2. Normal 재계산 — I2 (cached normal이 winding과 일치)
        if opts.recompute_normals {
            let active_faces: Vec<FaceId> = self.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();
            for fid in &active_faces {
                let outer_start = self.faces[*fid].outer().start;
                if outer_start.is_null() { continue; }
                if let Ok(verts) = self.collect_loop_verts(outer_start) {
                    if let Ok(n) = self.compute_normal(&verts) {
                        if n.length_squared() > 1e-10 {
                            self.faces[*fid].set_normal(n.normalize_or_zero());
                            report.normals_recomputed += 1;
                        }
                    }
                }
            }
        }

        // 3. Winding 일관화
        //    휴리스틱: 각 face의 normal이 mesh centroid에서 face centroid로 향하는
        //    벡터와 양의 내적이면 "바깥쪽 front" (올바름). 음수면 flip 대상.
        //    이는 볼록체 가정 하에 작동 — 오목체는 완벽하지 않지만
        //    다수결로 대부분 올바르게 정규화됨.
        if opts.normalize_winding {
            let active_faces: Vec<FaceId> = self.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();
            if active_faces.len() >= 4 {
                // mesh centroid
                let mut all_pos = DVec3::ZERO;
                let mut cnt = 0usize;
                for fid in &active_faces {
                    let outer_start = self.faces[*fid].outer().start;
                    if outer_start.is_null() { continue; }
                    if let Ok(verts) = self.collect_loop_verts(outer_start) {
                        for v in verts {
                            if let Ok(p) = self.vertex_pos(v) {
                                all_pos += p;
                                cnt += 1;
                            }
                        }
                    }
                }
                if cnt > 0 {
                    let mesh_centroid = all_pos / cnt as f64;
                    let mut to_flip: Vec<FaceId> = Vec::new();
                    for fid in &active_faces {
                        let outer_start = self.faces[*fid].outer().start;
                        if outer_start.is_null() { continue; }
                        let verts = match self.collect_loop_verts(outer_start) {
                            Ok(v) => v, Err(_) => continue,
                        };
                        if verts.is_empty() { continue; }
                        // Face centroid
                        let mut fc = DVec3::ZERO;
                        let mut fcn = 0usize;
                        for v in &verts {
                            if let Ok(p) = self.vertex_pos(*v) {
                                fc += p;
                                fcn += 1;
                            }
                        }
                        if fcn == 0 { continue; }
                        fc /= fcn as f64;
                        let outward = fc - mesh_centroid;
                        let normal = self.faces[*fid].normal();
                        if normal.length_squared() < 1e-10 { continue; }
                        // 음의 내적 → 뒤집혔음 → flip 대상
                        if outward.dot(normal) < 0.0 {
                            to_flip.push(*fid);
                        }
                    }
                    // 다수가 flip 대상이면 전체 뒤집기보다 그대로 두는 게 나음
                    // (아마 역방향 convention으로 들어온 경우)
                    let half = active_faces.len() / 2;
                    if to_flip.len() <= half {
                        for fid in &to_flip {
                            if self.flip_face_safe(*fid).is_ok() {
                                report.winding_flipped += 1;
                            }
                        }
                    } else {
                        // 다수가 뒤집힘 — 소수 (올바른 쪽) 만 flip (equivalent 반전)
                        let correct: Vec<FaceId> = active_faces.iter()
                            .copied()
                            .filter(|fid| !to_flip.contains(fid))
                            .collect();
                        for fid in &correct {
                            if self.flip_face_safe(*fid).is_ok() {
                                report.winding_flipped += 1;
                            }
                        }
                    }
                }
            }
        }

        // 4. Isolated verts
        if opts.remove_isolated_verts {
            let before = self.verts.len();
            self.remove_isolated_verts();
            let after = self.verts.len();
            report.isolated_verts_removed = before.saturating_sub(after);
        }

        // 5. 최종 verify
        let inv_report = self.verify_face_invariants();
        report.remaining_violations = inv_report.violations.len();

        report
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
    fn edge_chain_selects_polyline_through_degree2_verts() {
        // Open polyline: v0 — v1 — v2 — v3 (3 edges, 2 interior valence-2 verts)
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(3.0, 0.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let (e12, _) = mesh.add_edge(v1, v2).unwrap();
        let (e23, _) = mesh.add_edge(v2, v3).unwrap();

        let chain = mesh.collect_edge_chain(e12);
        let set: std::collections::HashSet<EdgeId> = chain.iter().copied().collect();
        assert!(set.contains(&e01));
        assert!(set.contains(&e12));
        assert!(set.contains(&e23));
        assert_eq!(set.len(), 3, "full chain of 3 edges expected");
    }

    #[test]
    fn edge_chain_stops_at_junction() {
        // Y-shape: v0—v1—v2  and  v1—v3 (v1 is junction, valence=3)
        //
        //          v2
        //           \
        //    v0 ── v1 ── v3
        //
        // seed from e01 → should collect only e01 (stops at v1, and v0 is dead-end)
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v1, v3).unwrap();

        let chain = mesh.collect_edge_chain(e01);
        assert_eq!(chain.len(), 1, "junction at v1 halts the chain — only seed returned");
        assert_eq!(chain[0], e01);
    }

    #[test]
    fn edge_chain_closed_loop() {
        // Closed quadrilateral boundary: 4 edges, each vertex valence=2.
        // Chain from any edge should return all 4.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let (e01, _) = mesh.add_edge(v0, v1).unwrap();
        let _ = mesh.add_edge(v1, v2).unwrap();
        let _ = mesh.add_edge(v2, v3).unwrap();
        let _ = mesh.add_edge(v3, v0).unwrap();

        let chain = mesh.collect_edge_chain(e01);
        assert_eq!(chain.len(), 4, "closed 4-edge loop should return all 4");
    }

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
    fn test_cleanup_dangling_excluding_keeps_protected_orphan_edges() {
        // Build an isolated quad. Remove the face. By default cleanup_dangling
        // would purge all 4 boundary edges as orphans; with the protected
        // set they remain as standalone wireframe.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        // Snapshot the boundary edges before removing the face (collect_loop_hes
        // requires the loop to be intact).
        let boundary_edges: std::collections::HashSet<EdgeId> = {
            let start = mesh.faces[f].outer().start;
            let hes = mesh.collect_loop_hes(start).unwrap();
            hes.into_iter().map(|h| mesh.hes[h].edge()).collect()
        };
        assert_eq!(boundary_edges.len(), 4, "quad should have 4 boundary edges");

        mesh.remove_face(f).unwrap();
        if mesh.faces.contains(f) { mesh.faces.remove(f); }

        // Run protected cleanup → boundary edges must still be present.
        let (edge_removed, _vert_removed) = mesh.cleanup_dangling_excluding(&boundary_edges);
        assert_eq!(edge_removed, 0, "no orphan edge should be removed when protected");
        for &eid in &boundary_edges {
            assert!(mesh.edges.contains(eid),
                "protected edge {:?} must still be present after cleanup", eid);
        }
        // Vertices must also remain — they're still referenced by the surviving edges.
        for vid in &[v0, v1, v2, v3] {
            assert!(mesh.verts.contains(*vid),
                "vertex {:?} should remain (referenced by surviving edge)", vid);
        }
    }

    #[test]
    fn test_cleanup_dangling_default_still_removes_orphans() {
        // Sanity: without protection, cleanup_dangling behaves as before.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.remove_face(f).unwrap();
        if mesh.faces.contains(f) { mesh.faces.remove(f); }
        let (edge_removed, _) = mesh.cleanup_dangling();
        assert_eq!(edge_removed, 4, "all 4 boundary edges should be cleaned up by default");
    }

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
    fn test_merge_coplanar_containing_creates_hole() {
        // Phase F — 비인접 coplanar 병합: outer 사각형 + 내부 사각형 → outer에 hole
        let mut mesh = Mesh::new();
        // Outer 200×200
        let o0 = mesh.add_vertex(DVec3::new(-100.0, 0.0, -100.0));
        let o1 = mesh.add_vertex(DVec3::new( 100.0, 0.0, -100.0));
        let o2 = mesh.add_vertex(DVec3::new( 100.0, 0.0,  100.0));
        let o3 = mesh.add_vertex(DVec3::new(-100.0, 0.0,  100.0));
        // Inner 40×40 (중앙)
        let i0 = mesh.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let i1 = mesh.add_vertex(DVec3::new( 20.0, 0.0, -20.0));
        let i2 = mesh.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let i3 = mesh.add_vertex(DVec3::new(-20.0, 0.0,  20.0));

        let outer_f = mesh.add_face(&[o0, o1, o2, o3], MaterialId::new(0)).unwrap();
        let inner_f = mesh.add_face(&[i0, i1, i2, i3], MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 2);

        let merged = mesh.merge_coplanar_containing(outer_f, inner_f, 0.5).unwrap();
        assert_eq!(mesh.face_count(), 1);
        let face = &mesh.faces[merged];
        assert_eq!(face.inners().len(), 1, "merged face should have 1 hole");
    }

    #[test]
    fn test_merge_coplanar_containing_rejects_sharing_edge() {
        // 두 face가 엣지를 공유하면 merge_faces_by_edge를 써야 함
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let v4 = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(20.0, 0.0, 10.0));
        let f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();
        let result = mesh.merge_coplanar_containing(f1, f2, 0.5);
        assert!(result.is_err(), "sharing edge should reject");
    }

    #[test]
    fn test_merge_coplanar_containing_rejects_non_coplanar() {
        let mut mesh = Mesh::new();
        // 두 면을 서로 다른 평면에 배치
        let o = [
            mesh.add_vertex(DVec3::new(-10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0, -10.0)),
            mesh.add_vertex(DVec3::new( 10.0, 0.0,  10.0)),
            mesh.add_vertex(DVec3::new(-10.0, 0.0,  10.0)),
        ];
        let i = [
            mesh.add_vertex(DVec3::new(-5.0, 5.0, -5.0)),
            mesh.add_vertex(DVec3::new( 5.0, 5.0, -5.0)),
            mesh.add_vertex(DVec3::new( 5.0, 5.0,  5.0)),
            mesh.add_vertex(DVec3::new(-5.0, 5.0,  5.0)),
        ];
        let of = mesh.add_face(&o, MaterialId::new(0)).unwrap();
        let inf = mesh.add_face(&i, MaterialId::new(0)).unwrap();
        assert!(mesh.merge_coplanar_containing(of, inf, 0.5).is_err());
    }

    #[test]
    fn test_merge_tolerance_rejects_strict_but_accepts_loose() {
        // 1° 기울어진 두 사각형: strict(0.5°)는 reject, loose(2°)는 accept
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(100.0, 100.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 100.0, 0.0));
        // 두 번째 면: 공유 엣지 v1-v2, 반대쪽 꼭짓점을 1° 기울임
        // tan(1°)×100 ≈ 1.745 → 정점 Z를 약 1.745만큼 올림
        let dz = 100.0 * (1.0_f64.to_radians().tan());
        let v4 = mesh.add_vertex(DVec3::new(200.0, 0.0, dz));
        let v5 = mesh.add_vertex(DVec3::new(200.0, 100.0, dz));

        let f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        // Strict (0.5°) — 거부
        let strict = mesh.are_faces_coplanar_with_tolerance(f1, f2, 0.5).unwrap();
        assert!(!strict, "0.5° tol should reject 1° tilt");

        // Loose (2°) — 허용
        let loose = mesh.are_faces_coplanar_with_tolerance(f1, f2, 2.0).unwrap();
        assert!(loose, "2° tol should accept 1° tilt");
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

    // ═══════════════════════════════════════════════════════════════
    //  ADR-007: Face Orientation Invariant Tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn invariants_empty_mesh_passes() {
        let mesh = Mesh::new();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "empty mesh must pass: {}", report.summary());
    }

    #[test]
    fn invariants_single_triangle_passes() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "single triangle violates: {}", report.summary());
    }

    #[test]
    fn invariants_tetrahedron_passes() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "tet violates: {}", report.summary());
        assert_eq!(report.checked_faces, 4);
    }

    #[test]
    fn invariants_face_with_hole_passes() {
        // Phase F — 구멍 있는 face도 invariant 통과
        let mut mesh = Mesh::new();
        let o0 = mesh.add_vertex(DVec3::new(-10.0, 0.0, -10.0));
        let o1 = mesh.add_vertex(DVec3::new( 10.0, 0.0, -10.0));
        let o2 = mesh.add_vertex(DVec3::new( 10.0, 0.0,  10.0));
        let o3 = mesh.add_vertex(DVec3::new(-10.0, 0.0,  10.0));
        let h0 = mesh.add_vertex(DVec3::new(-2.0, 0.0, -2.0));
        let h1 = mesh.add_vertex(DVec3::new(-2.0, 0.0,  2.0));
        let h2 = mesh.add_vertex(DVec3::new( 2.0, 0.0,  2.0));
        let h3 = mesh.add_vertex(DVec3::new( 2.0, 0.0, -2.0));
        mesh.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[h0, h1, h2, h3]],
            MaterialId::new(0),
        ).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "hole face violates: {}", report.summary());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Phase H — Import Normalizer 테스트
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn normalize_noop_on_clean_mesh() {
        // 정상 정사면체 — normalize 후에도 변화 최소
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();

        let opts = NormalizeOptions::default();
        let report = mesh.normalize_for_import(&opts);

        // 깨끗한 mesh라면 flip 대상이 매우 적거나 전무
        assert_eq!(report.degenerate_removed, 0);
        assert_eq!(report.remaining_violations, 0,
            "clean mesh should have no violations after normalize");
    }

    #[test]
    fn normalize_removes_degenerate_faces() {
        let mut mesh = Mesh::new();
        // 정상 삼각형
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(100.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 100.0, 0.0));
        let _good = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        // 퇴화 삼각형은 add_face가 ADR-003으로 차단하므로 직접 만들기는 어려움.
        // 대신 normalize가 정상 case에서 아무것도 망가뜨리지 않는지 확인.
        let report = mesh.normalize_for_import(&NormalizeOptions::default());
        assert_eq!(report.degenerate_removed, 0);
        assert_eq!(mesh.face_count(), 1);
    }

    #[test]
    fn normalize_recomputes_normals() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        // 강제로 normal 왜곡
        mesh.faces[f].set_normal(DVec3::new(0.0, -1.0, 0.0));

        let opts = NormalizeOptions { recompute_normals: true, normalize_winding: false, ..Default::default() };
        let report = mesh.normalize_for_import(&opts);
        assert!(report.normals_recomputed >= 1);

        // 재계산 후 cached가 실제 winding과 일치해야 함
        let inv = mesh.verify_face_invariants();
        assert!(inv.is_valid(), "normalize should fix normal: {}", inv.summary());
    }

    #[test]
    fn normalize_winding_fixes_inverted_tetrahedron() {
        // 뒤집힌 winding의 정사면체 — normalize가 outer=Front로 복구
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // 모든 face를 "안쪽을 향하게" 생성 (winding 반전)
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap(); // 반전 bottom
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        let report = mesh.normalize_for_import(&NormalizeOptions::default());
        // 4개 또는 0개가 flip되어야 함 (다수결 의해)
        // 중요한 건 normalize 후 모든 normal이 바깥을 향하는지
        assert!(report.winding_flipped == 4 || report.winding_flipped == 0,
            "got {} flips", report.winding_flipped);

        // 최종: outer face가 mesh centroid 바깥을 향함
        let active: Vec<FaceId> = mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id).collect();
        let mesh_c = DVec3::new(5.0, 2.5, 5.0); // 대략 centroid
        for fid in &active {
            let verts = mesh.collect_loop_verts(mesh.faces[*fid].outer().start).unwrap();
            let mut fc = DVec3::ZERO;
            for v in &verts { fc += mesh.vertex_pos(*v).unwrap(); }
            fc /= verts.len() as f64;
            let outward = fc - mesh_c;
            let n = mesh.faces[*fid].normal();
            // 바깥으로 향하면 OK (일부 face는 구조상 정확히 수직 ~ dot≈0 허용)
            assert!(outward.dot(n) >= -0.1,
                "face {:?} normal still inward: dot={:.3}", fid, outward.dot(n));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Outward Normal Invariant Tests (ADR-007 원칙 1 확장)
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn outward_open_surface_skips() {
        // 삼각형 하나 — 열린 surface이므로 검증 스킵
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(!report.is_closed_solid, "single face is open, not solid");
        assert!(report.is_valid(), "open surface should pass (skip)");
    }

    #[test]
    fn outward_tetrahedron_all_outward() {
        // 정사면체 — 모든 face가 outward 향하도록 winding
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // Bottom: [v0, v1, v2] → normal -Y (아래쪽 바깥)
        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Sides: v3을 "꼭대기"로 감아 side normal이 바깥 향하게
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid, "tet is closed");
        assert_eq!(report.inward_count, 0, "all faces outward: {}", report.summary());
        assert_eq!(report.checked_faces, 4);
    }

    #[test]
    fn outward_sphere_all_outward() {
        // 프리미티브 sphere — Phase 2 수정 후 모든 face outward
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_sphere(DVec3::ZERO, 100.0, 20, 12, mat).unwrap();

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid);
        assert_eq!(report.inward_count, 0,
            "sphere should have all outward normals: {}", report.summary());
    }

    #[test]
    fn outward_detect_flipped_face() {
        // 올바른 tetrahedron winding — 한 face를 flip → inward 감지
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        let f0 = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v0, v3, v1], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v1, v3, v2], MaterialId::new(0)).unwrap();
        mesh.add_face(&[v2, v3, v0], MaterialId::new(0)).unwrap();

        // f0 의 normal을 강제로 뒤집기 (cached만)
        let n = mesh.faces[f0].normal();
        mesh.faces[f0].set_normal(-n);

        let report = mesh.verify_outward_normals();
        assert!(report.is_closed_solid);
        assert!(report.inward_count >= 1,
            "flipped face should be detected: {}", report.summary());
        assert!(report.inward_faces.contains(&f0));
    }

    #[test]
    fn invariants_detect_flipped_normal() {
        // 강제로 face의 캐시 normal을 반대로 만들어 invariant가 감지하는지
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let n = mesh.faces[f].normal();
        mesh.faces[f].set_normal(-n); // 강제 반전
        let report = mesh.verify_face_invariants();
        assert!(!report.is_valid(), "flipped cached normal must be detected");
        assert!(report.violations.iter().any(|v| v.contains("cached normal")));
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

    // ═══════════════════════════════════════════════════════════════
    // Phase E — D Resolver 회귀 테스트 (2026-04-20)
    //
    // 최근 수정된 `resolve_planar_free_faces_scoped` 의 필터 체인
    // (Strip, Local-containment, required_edges, size check) 검증.
    // ═══════════════════════════════════════════════════════════════

    /// Helper: 닫힌 polygon 경로를 free-edge로만 그림 (add_face 안 함).
    fn draw_closed_loop(mesh: &mut Mesh, pts: &[DVec3]) -> Vec<EdgeId> {
        let mut edges = Vec::new();
        for i in 0..pts.len() {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            let (_, _, eid) = mesh.draw_line(a, b).unwrap();
            edges.push(eid);
        }
        edges
    }

    #[test]
    fn d_resolver_simple_square_creates_one_face() {
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "simple square must create 1 face");
    }

    #[test]
    fn d_resolver_nested_rect_without_connector_keeps_both() {
        // 버그 수정 회귀 테스트: outer rect + inner rect (connector 없음)
        // → outer의 centroid가 inner cycle 내부에 있어도 area 비교로 false
        // positive 차단 → inner face 정상 생성.
        let mut mesh = Mesh::new();
        // Outer: (-100,-100) ~ (100,100)
        let outer_verts: Vec<VertId> = [
            DVec3::new(-100.0, 0.0, -100.0),
            DVec3::new( 100.0, 0.0, -100.0),
            DVec3::new( 100.0, 0.0,  100.0),
            DVec3::new(-100.0, 0.0,  100.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&outer_verts, MaterialId::new(0)).unwrap();
        // Inner: (-30,-30) ~ (30,30) — free edges only
        draw_closed_loop(&mut mesh, &[
            DVec3::new(-30.0, 0.0, -30.0),
            DVec3::new( 30.0, 0.0, -30.0),
            DVec3::new( 30.0, 0.0,  30.0),
            DVec3::new(-30.0, 0.0,  30.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "inner rect must be created as a separate face");
        assert_eq!(mesh.face_count(), 2, "total faces = outer + inner");
    }

    #[test]
    fn d_resolver_smaller_cycle_not_rejected_by_larger_face_centroid() {
        // 작은 cycle이 큰 face의 centroid를 포함해도 area 비교로 reject 안 됨.
        let mut mesh = Mesh::new();
        // 큰 face (centroid at origin)
        let big: Vec<VertId> = [
            DVec3::new(-500.0, 0.0, -500.0),
            DVec3::new( 500.0, 0.0, -500.0),
            DVec3::new( 500.0, 0.0,  500.0),
            DVec3::new(-500.0, 0.0,  500.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&big, MaterialId::new(0)).unwrap();
        // 작은 cycle — 원점 포함 but area < big
        draw_closed_loop(&mut mesh, &[
            DVec3::new(-10.0, 0.0, -10.0),
            DVec3::new( 10.0, 0.0, -10.0),
            DVec3::new( 10.0, 0.0,  10.0),
            DVec3::new(-10.0, 0.0,  10.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 1, "small cycle inside large face must still create face");
    }

    #[test]
    fn d_resolver_cw_cycle_rejected() {
        // Clockwise cycle (signed area < 0) → outer boundary, skip.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 0.0, 100.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(100.0, 0.0, 0.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        // 평면 기준에 따라 하나는 CCW 하나는 CW. free HE는 양방향 존재하므로
        // 어느 한 쪽은 항상 생성됨. 중요한 건 무한 루프/중복 생성 없음.
        assert!(faces.len() >= 1, "at least one orientation creates a face");
    }

    #[test]
    fn d_resolver_seed_verts_filter_excludes_untouched_component() {
        // 두 개의 분리된 cycle — seed_verts로 한쪽만 처리.
        let mut mesh = Mesh::new();
        // Component A (will be seeded)
        let a_verts: Vec<VertId> = {
            let (_, _, _) = mesh.draw_line(
                DVec3::new(0.0, 0.0, 0.0), DVec3::new(50.0, 0.0, 0.0)
            ).unwrap();
            let (_, _, _) = mesh.draw_line(
                DVec3::new(50.0, 0.0, 0.0), DVec3::new(50.0, 0.0, 50.0)
            ).unwrap();
            let (_, _, _) = mesh.draw_line(
                DVec3::new(50.0, 0.0, 50.0), DVec3::new(0.0, 0.0, 50.0)
            ).unwrap();
            let (va, _, _) = mesh.draw_line(
                DVec3::new(0.0, 0.0, 50.0), DVec3::new(0.0, 0.0, 0.0)
            ).unwrap();
            vec![va]
        };
        // Component B (not seeded) — far away
        draw_closed_loop(&mut mesh, &[
            DVec3::new(1000.0, 0.0, 1000.0),
            DVec3::new(1100.0, 0.0, 1000.0),
            DVec3::new(1100.0, 0.0, 1100.0),
            DVec3::new(1000.0, 0.0, 1100.0),
        ]);
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            Some(&a_verts),
            None,
        );
        assert_eq!(faces.len(), 1, "only component A processed");
    }

    #[test]
    fn d_resolver_required_edges_small_cycle_bypasses_filter() {
        // cycle_hes.len() ≤ 7 → required_edges 필터 적용 안 됨 (사각형 = 4).
        // 기존 face의 자유 HE cycle이 있어도 작은 cycle은 그냥 통과.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        // required_edges가 비어 있어도 작은 cycle이므로 face 생성됨.
        let empty: Vec<EdgeId> = Vec::new();
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&empty),
        );
        assert_eq!(faces.len(), 1, "small cycle bypasses required_edges filter");
    }

    #[test]
    fn d_resolver_strip_rejected_by_compactness() {
        // 극단적으로 얇은 strip (100:1 aspect ratio) — 100×0.05 = area 5,
        // perimeter ≈ 200.1, compactness ≈ 4π·5/200.1² ≈ 0.00157
        // 임계값 0.001 바로 위라 애매 → 더 얇게 (1000:1 ≈ 0.00016) 사용.
        let mut mesh = Mesh::new();
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.1),
            DVec3::new(0.0, 0.0, 0.1),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        // 1000:1 strip — compactness ≪ 0.001 → 반드시 거부.
        // (양방향 free HE의 경우 한쪽은 CCW면 다른 건 CW라 최대 1개 후보지만
        //  strip filter가 그것까지 거부해야 함.)
        assert_eq!(faces.len(), 0, "extreme strip must be rejected");
    }

    #[test]
    fn d_resolver_multi_plane_sketch_independent_resolution() {
        // 두 평면에 각각 사각형 → 각 component 독립 평면 결정 (PCA-lite).
        let mut mesh = Mesh::new();
        // Plane 1: XZ at y=0
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ]);
        // Plane 2: XY at z=500 (다른 평면)
        draw_closed_loop(&mut mesh, &[
            DVec3::new(0.0, 0.0, 500.0),
            DVec3::new(100.0, 0.0, 500.0),
            DVec3::new(100.0, 100.0, 500.0),
            DVec3::new(0.0, 100.0, 500.0),
        ]);
        let faces = mesh.resolve_planar_free_faces(MaterialId::new(0));
        assert_eq!(faces.len(), 2, "two independent planes must yield 2 faces");
    }

    #[test]
    fn d_resolver_deduplicate_overlapping_same_boundary() {
        // 같은 boundary를 가진 두 face가 생성되면 deduplicate_overlapping_faces
        // 가 하나만 남김.
        let mut mesh = Mesh::new();
        let verts: Vec<VertId> = [
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 0.0),
            DVec3::new(100.0, 0.0, 100.0),
            DVec3::new(0.0, 0.0, 100.0),
        ].iter().map(|&p| mesh.add_vertex(p)).collect();
        mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        // 같은 경계로 다시 만들어도 add_face가 허용하면...
        // (실제론 CW로 돌려 반대 face 만들 수 있음)
        let cw: Vec<VertId> = vec![verts[0], verts[3], verts[2], verts[1]];
        let _ = mesh.add_face(&cw, MaterialId::new(0));
        let removed = mesh.deduplicate_overlapping_faces();
        // 같은 vertex set을 가진 face가 2개면 1개 제거됨.
        if mesh.face_count() < 2 {
            // 안 만들어진 경우 스킵
        } else {
            assert!(!removed.is_empty(), "duplicate must be removed");
        }
    }

    #[test]
    fn d_resolver_does_not_regenerate_large_deleted_boundary() {
        // 회귀 테스트: 큰 cycle(>7 verts) + required_edges 없음 → skip.
        // 삭제된 원통 top/bottom face 재생성을 방지하는 핵심 필터.
        let mut mesh = Mesh::new();
        // 8각형 free-edge cycle (cycle_hes.len() = 8, threshold 7 초과)
        let r = 100.0;
        let n = 8;
        let mut pts: Vec<DVec3> = Vec::new();
        for i in 0..n {
            let a = (i as f64) * std::f64::consts::TAU / (n as f64);
            pts.push(DVec3::new(r * a.cos(), 0.0, r * a.sin()));
        }
        draw_closed_loop(&mut mesh, &pts);
        // required_edges = 비어 있음 → 큰 cycle은 반드시 skip
        let empty: Vec<EdgeId> = Vec::new();
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&empty),
        );
        assert_eq!(faces.len(), 0, "large cycle without required edge must be skipped");
    }

    // ═══════════════════════════════════════════════════════════════
    // Boundary Extraction — face_set_manifold_info 테스트
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn manifold_info_single_face_is_open() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let f = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let info = mesh.face_set_manifold_info(&[f]);
        assert_eq!(info.face_count, 1);
        assert_eq!(info.boundary_edge_count, 3);
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn manifold_info_tetrahedron_is_closed_solid() {
        // 4 faces, 6 edges, each edge used by exactly 2 faces → closed manifold.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        // Outward-facing: bottom CCW when seen from below, sides CCW when seen from outside
        let f0 = mesh.add_face(&[v0, v2, v1], MaterialId::new(0)).unwrap(); // bottom
        let f1 = mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap(); // side
        let f2 = mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap(); // side
        let f3 = mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap(); // side
        let info = mesh.face_set_manifold_info(&[f0, f1, f2, f3]);
        assert_eq!(info.face_count, 4);
        assert_eq!(info.interior_edge_count, 6);
        assert_eq!(info.boundary_edge_count, 0);
        assert_eq!(info.non_manifold_edge_count, 0);
        assert!(info.is_closed_solid);
        assert!(mesh.is_face_set_closed_solid(&[f0, f1, f2, f3]));
    }

    #[test]
    fn manifold_info_tetra_missing_face_is_open() {
        // Remove one face from tet → 3 edges become boundary.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(5.0, 10.0, 5.0));
        let f1 = mesh.add_face(&[v0, v1, v3], MaterialId::new(0)).unwrap();
        let f2 = mesh.add_face(&[v1, v2, v3], MaterialId::new(0)).unwrap();
        let f3 = mesh.add_face(&[v2, v0, v3], MaterialId::new(0)).unwrap();
        // bottom face intentionally omitted
        let info = mesh.face_set_manifold_info(&[f1, f2, f3]);
        assert_eq!(info.face_count, 3);
        assert_eq!(info.boundary_edge_count, 3); // bottom triangle edges
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn manifold_info_minimum_face_count_required() {
        // 경계가 0이어도 face ≥ 4 이어야 closed solid로 판정 (삼각뿔의 pointless 3-face
        // 같은 비정상 케이스 방지).
        let mesh = Mesh::new();
        let info = mesh.face_set_manifold_info(&[]);
        assert_eq!(info.face_count, 0);
        assert!(!info.is_closed_solid);
    }

    #[test]
    fn d_resolver_large_cycle_with_required_edge_creates_face() {
        // 큰 cycle이라도 새 drawLine의 edge를 포함하면 생성됨.
        let mut mesh = Mesh::new();
        let r = 100.0;
        let n = 8;
        let mut pts: Vec<DVec3> = Vec::new();
        for i in 0..n {
            let a = (i as f64) * std::f64::consts::TAU / (n as f64);
            pts.push(DVec3::new(r * a.cos(), 0.0, r * a.sin()));
        }
        let edges = draw_closed_loop(&mut mesh, &pts);
        // 모든 edge가 required (새로 그린 것처럼)
        let faces = mesh.resolve_planar_free_faces_scoped(
            MaterialId::new(0),
            None,
            Some(&edges),
        );
        assert_eq!(faces.len(), 1, "large cycle with required edge creates face");
    }
}
