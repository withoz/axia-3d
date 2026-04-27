//! AXiA WASM Bridge
//!
//! Exposes the Rust core engine to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;
use glam::DVec3;
use std::collections::{HashMap, HashSet};

use axia_core::scene::Scene;
use axia_core::commands::Command;
use axia_core::commands::CommandResult;
use axia_geo::{FaceId, EdgeId, VertId};
use axia_geo::operations::boolean::BoolOp;
use axia_core::constraint::{Constraint, ConstraintKind, ConstraintRef, resolve_constraint, resolve_all, resolve_iterative, max_residual};
use axia_core::orphan_recovery::RecoveryPlan;

// Console logging from Rust WASM — debug only (stripped in release builds)
macro_rules! debug_log {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        web_sys::console::log_1(&format!($($arg)*).into())
    }
}

// Error logging — always active (even in release builds)
macro_rules! console_error {
    ($($arg:tt)*) => {
        web_sys::console::error_1(&format!($($arg)*).into())
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Delta Buffer Structure — For incremental updates to JavaScript
// ════════════════════════════════════════════════════════════════════════════

/// Delta buffers for incremental mesh updates (Phase 1 Optimization).
///
/// Two modes:
/// 1. **Position-only delta** (translate/rotate/scale): topology unchanged,
///    only vertex positions & normals updated. JS patches the existing buffer
///    at the given offsets — no geometry rebuild needed.
/// 2. **Topology changed** (draw/push_pull/delete/boolean/offset):
///    returns topology_changed=true, JS must do a full rebuild.
///
/// Design: Each dirty face's new positions/normals are packed contiguously.
/// `face_vert_offsets[i]` tells JS where face i's data starts in the
/// FULL cached buffer (so JS patches at the right position).
/// `face_vert_counts[i]` tells JS how many vertices (×3 floats) per face.
#[wasm_bindgen]
pub struct DeltaBuffers {
    modified_face_ids: Vec<u32>,
    /// New vertex positions for dirty faces (packed contiguously)
    positions: Vec<f32>,
    /// New vertex normals for dirty faces (packed contiguously)
    normals: Vec<f32>,
    /// Byte offsets into the FULL position buffer where each face starts
    /// (vertex index, not byte — multiply by 3 for float offset)
    face_vert_offsets: Vec<u32>,
    /// Number of vertices per dirty face
    face_vert_counts: Vec<u32>,
    /// Version counter for validation
    cache_version: u32,
    /// True if topology changed — JS must do full rebuild
    topology_changed: bool,
}

#[wasm_bindgen]
impl DeltaBuffers {
    #[wasm_bindgen(js_name = "getModifiedFaceIds")]
    pub fn get_modified_face_ids(&self) -> Vec<u32> {
        self.modified_face_ids.clone()
    }

    #[wasm_bindgen(js_name = "getPositions")]
    pub fn get_positions(&self) -> Vec<f32> {
        self.positions.clone()
    }

    #[wasm_bindgen(js_name = "getNormals")]
    pub fn get_normals(&self) -> Vec<f32> {
        self.normals.clone()
    }

    /// Vertex offsets into the FULL buffer for each dirty face.
    /// `face_vert_offsets[i]` is the vertex index (not byte) where
    /// face i starts in the full position buffer.
    #[wasm_bindgen(js_name = "getFaceVertOffsets")]
    pub fn get_face_vert_offsets(&self) -> Vec<u32> {
        self.face_vert_offsets.clone()
    }

    /// Number of vertices for each dirty face.
    #[wasm_bindgen(js_name = "getFaceVertCounts")]
    pub fn get_face_vert_counts(&self) -> Vec<u32> {
        self.face_vert_counts.clone()
    }

    #[wasm_bindgen(js_name = "getCacheVersion")]
    pub fn get_cache_version(&self) -> u32 {
        self.cache_version
    }

    /// If true, topology changed (faces added/removed) — JS must do full rebuild.
    /// If false, only positions/normals changed — JS can patch in-place.
    #[wasm_bindgen(js_name = "isTopologyChanged")]
    pub fn is_topology_changed(&self) -> bool {
        self.topology_changed
    }
}

/// Tracks where each face's vertex data lives in the full export buffer.
#[derive(Clone, Debug)]
struct FaceRange {
    vert_start: u32,  // first vertex index in full positions buffer
    vert_count: u32,  // number of vertices for this face
}

#[wasm_bindgen]
pub struct AxiaEngine {
    scene: Scene,
    cached_positions: Vec<f32>,
    cached_positions_f64: Vec<f64>,  // CAD-grade f64 positions (parallel to cached_positions)
    cached_normals: Vec<f32>,
    cached_indices: Vec<u32>,
    cached_face_map: Vec<u32>, // triangle index → FaceId
    cached_edge_lines: Vec<f32>, // hard edge line segments
    cached_edge_map: Vec<u32>,   // segment index → EdgeId raw
    cache_dirty: bool,

    // ════ Delta Tracking (Phase 1 Optimization) ════
    /// Tracks which faces changed since last delta export
    dirty_faces: HashSet<u32>,
    /// Monotonic counter for cache validation
    cache_version: u32,
    /// True if topology changed (faces added/removed) since last delta export.
    /// When true, delta is not useful — JS must do a full rebuild.
    topology_changed: bool,
    /// Maps face_id (raw u32) → FaceRange in the full cached buffer.
    /// Built during rebuild_cache() for fast face→buffer offset lookups.
    face_range_map: HashMap<u32, FaceRange>,

    /// 가장 최근 실패한 기하 연산의 에러 메시지.
    /// TypeScript에서 `last_error()`로 읽어서 Toast에 표시.
    /// 성공한 연산은 이 값을 비우지 않음 (persistent until next failure).
    last_error: String,

    /// 엣지 가시성 임계 각도 (도). 인접 면 사이 법선 각도가 이보다 작으면
    /// coplanar로 판정되어 엣지 숨김. 기본 `EDGE_VISIBILITY_ANGLE_DEG` (15°).
    /// StylePanel의 슬라이더로 런타임 변경 → 다음 syncMesh에서 반영.
    /// 작을수록 엣지가 많이 보임 (부드러운 곡면도 faceted), 클수록 매끈.
    edge_angle_threshold_deg: f64,

    /// 가장 최근 `batch_erase_edges_with_merge`에서 일부 edge의 merge가
    /// 실패했을 때 첫 번째 실패 사유. 디버그 Toast 용.
    last_merge_failure: String,
}

#[wasm_bindgen]
impl AxiaEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            scene: Scene::new(),
            cached_positions: Vec::new(),
            cached_positions_f64: Vec::new(),
            cached_normals: Vec::new(),
            cached_indices: Vec::new(),
            cached_face_map: Vec::new(),
            cached_edge_lines: Vec::new(),
            cached_edge_map: Vec::new(),
            cache_dirty: true,
            dirty_faces: HashSet::new(),
            cache_version: 0,
            topology_changed: true,  // first render always needs full build
            face_range_map: HashMap::new(),
            last_error: String::new(),
            edge_angle_threshold_deg: axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG,
            last_merge_failure: String::new(),
        }
    }

    /// 최근 실패한 연산의 에러 메시지를 반환. 실패 이력이 없으면 빈 문자열.
    /// TypeScript Bridge가 연산 반환값이 false일 때 이 값을 Toast로 표시.
    #[wasm_bindgen(js_name = "lastError")]
    pub fn last_error(&self) -> String {
        self.last_error.clone()
    }

    /// 에러 기록용 내부 헬퍼. 각 연산이 실패 시 호출.
    fn set_error(&mut self, msg: impl Into<String>) {
        self.last_error = msg.into();
    }

    /// 성공 시 에러 상태 clear (다음 실패까지 빈 문자열 유지)
    fn clear_error(&mut self) {
        self.last_error.clear();
    }

    fn rebuild_cache(&mut self) {
        if !self.cache_dirty {
            return;
        }
        match self.scene.export_mesh_buffers() {
            Ok((p, n, i, fm, p64)) => {
                self.cached_positions = p;
                self.cached_positions_f64 = p64;
                self.cached_normals = n;
                self.cached_indices = i;
                self.cached_face_map = fm;
            }
            Err(_) => {
                self.cached_positions.clear();
                self.cached_positions_f64.clear();
                self.cached_normals.clear();
                self.cached_indices.clear();
                self.cached_face_map.clear();
            }
        }
        // Edge lines are computed from DCEL topology (not from triangle geometry).
        // 임계 각도는 런타임 조절 가능 (StylePanel 슬라이더). 기본은 tolerances.rs의
        // EDGE_VISIBILITY_ANGLE_DEG (15°).
        let (edge_lines, edge_map) = self.scene
            .export_edge_lines_with_map(self.edge_angle_threshold_deg);
        self.cached_edge_lines = edge_lines;
        self.cached_edge_map = edge_map;
        self.cache_dirty = false;

        // Build face_range_map: face_id → (vert_start, vert_count)
        // Single pass through cached_face_map + cached_indices.
        // export_buffers() emits faces in order; each face's vertices are contiguous.
        self.face_range_map.clear();
        for (tri_idx, &face_id) in self.cached_face_map.iter().enumerate() {
            let base = tri_idx * 3;
            if base + 2 >= self.cached_indices.len() { break; }

            let i0 = self.cached_indices[base];
            let i1 = self.cached_indices[base + 1];
            let i2 = self.cached_indices[base + 2];

            let entry = self.face_range_map.entry(face_id).or_insert(FaceRange {
                vert_start: u32::MAX,
                vert_count: 0,
            });
            // Track min vertex index as vert_start
            entry.vert_start = entry.vert_start.min(i0).min(i1).min(i2);
            // Track max+1 to compute count later
            let max_idx = i0.max(i1).max(i2);
            let end = max_idx + 1;
            let needed_count = end - entry.vert_start;
            if needed_count > entry.vert_count {
                entry.vert_count = needed_count;
            }
        }
    }

    fn invalidate_cache(&mut self) {
        self.cache_dirty = true;
    }

    /// Mark specific face IDs as dirty for delta updates.
    /// Called after operations that modify specific faces (translate/rotate/scale).
    fn mark_faces_dirty(&mut self, face_ids: &[u32]) {
        for &fid in face_ids {
            self.dirty_faces.insert(fid);
        }
        self.cache_version = self.cache_version.wrapping_add(1);
    }

    /// Walk the radial loop of `eid` and return true if any HE has a face
    /// pointer. Used by Phase B step 2 (erase re-synthesis) to snapshot
    /// which edges were face-bearing before the erase pass.
    fn edge_has_any_face(&self, eid: EdgeId) -> bool {
        let Some(edge) = self.scene.mesh.edges.get(eid) else { return false; };
        let start = edge.any_he();
        if start.is_null() { return false; }
        let mut he = start;
        loop {
            match self.scene.mesh.hes.get(he) {
                Some(h) => {
                    if !h.face().is_null() { return true; }
                    let next = h.next_rad();
                    if next.is_null() || next == start { return false; }
                    he = next;
                }
                None => return false,
            }
        }
    }

    /// Mark that topology changed (faces added/removed/split).
    /// Delta updates are not possible — JS must do a full rebuild.
    fn mark_topology_changed(&mut self) {
        self.topology_changed = true;
        self.cache_version = self.cache_version.wrapping_add(1);
    }

    /// Check if all faces in the group share the same normal (coplanar).
    ///
    /// Returns true if every pair of faces has |dot(n_i, n_j)| ≥ cos(EXACT_COPLANAR_ANGLE_DEG).
    /// Used to detect when a "smooth group" is actually split sub-faces of
    /// a single plane, which must NOT be treated as a curved surface.
    fn all_faces_coplanar(&self, face_ids: &[FaceId]) -> bool {
        let exact_coplanar_cos = axia_geo::tolerances::deg_to_cos(
            axia_geo::tolerances::EXACT_COPLANAR_ANGLE_DEG,
        );
        if face_ids.len() < 2 { return true; }

        let reference = match self.scene.mesh.faces.get(face_ids[0]) {
            Some(f) => {
                let n = f.normal();
                let len = n.length();
                if len < 1e-10 { return false; }
                n / len
            }
            None => return false,
        };

        for &fid in &face_ids[1..] {
            if let Some(f) = self.scene.mesh.faces.get(fid) {
                let n = f.normal();
                let len = n.length();
                if len < 1e-10 { return false; }
                let n_unit = n / len;
                if reference.dot(n_unit).abs() < exact_coplanar_cos {
                    return false;
                }
            } else {
                return false;
            }
        }
        true
    }

    // ========================================================================
    // Cache Version & Delta Tracking
    // ========================================================================

    /// Get the current cache version (monotonic counter).
    /// Used by JavaScript to validate delta buffer freshness.
    #[wasm_bindgen(js_name = "getCacheVersion")]
    pub fn get_cache_version(&self) -> u32 {
        self.cache_version
    }

    /// Get dirty face count (for debugging)
    #[wasm_bindgen(js_name = "getDirtyFaceCount")]
    pub fn get_dirty_face_count(&self) -> usize {
        self.dirty_faces.len()
    }

    // ========================================================================
    // Draw commands
    // ========================================================================

    pub fn draw_line(
        &mut self,
        x0: f64, y0: f64, z0: f64,
        x1: f64, y1: f64, z1: f64,
        nx: f64, ny: f64, nz: f64,
    ) -> f64 {
        let start = DVec3::new(x0, y0, z0);
        let end = DVec3::new(x1, y1, z1);
        let surface_normal = if nx == 0.0 && ny == 0.0 && nz == 0.0 {
            None
        } else {
            Some(DVec3::new(nx, ny, nz))
        };

        let verts_before = self.scene.mesh.vert_count();
        let faces_before = self.scene.mesh.face_count();
        let edges_before = self.scene.mesh.edge_count();

        debug_log!("[RUST] draw_line: ({:.4},{:.4},{:.4})→({:.4},{:.4},{:.4}) verts={} edges={} faces={}",
            x0, y0, z0, x1, y1, z1, verts_before, edges_before, faces_before);

        let cmd = Command::DrawLine {
            start,
            end,
            surface_normal,
        };
        let result = self.scene.execute(cmd);

        let verts_after = self.scene.mesh.vert_count();
        let faces_after = self.scene.mesh.face_count();
        let edges_after = self.scene.mesh.edge_count();

        debug_log!("[RUST] draw_line result: verts={} edges={} faces={} (new_verts={} new_edges={} new_faces={})",
            verts_after, edges_after, faces_after,
            verts_after - verts_before, edges_after - edges_before, faces_after - faces_before);

        match result {
            axia_core::commands::CommandResult::EntityCreated(xia_id) => {
                self.mark_topology_changed();  // new faces created
                self.invalidate_cache();
                xia_id as f64
            }
            _ => {
                self.invalidate_cache();
                -1.0
            }
        }
    }

    /// ADR-012 §3 BatchCommand — N 개 연속 line 을 단일 WASM crossing 에 묶는다.
    /// `points`: 평탄화된 [x0,y0,z0,x1,y1,z1,…] 배열 (3 의 배수). N point ⇒
    /// (N-1) 개 line.
    /// 반환: 마지막으로 만들어진 segment 의 결과 — 0 (success) 또는 -1.
    /// 호출자: DrawArcTool / DrawFreehandTool / DrawBezierTool — 이전엔 N
    /// 회 crossing 했지만 이제 1 회. 단일 트랜잭션 (Ctrl+Z 1회로 전체 되돌림).
    #[wasm_bindgen(js_name = "drawPolyline")]
    pub fn draw_polyline(&mut self, points: &[f64]) -> f64 {
        if points.len() < 6 || points.len() % 3 != 0 {
            console_error!("[RUST] drawPolyline: invalid points length {}", points.len());
            return -1.0;
        }
        let n = points.len() / 3;
        if n < 2 {
            return -1.0;
        }

        debug_log!("[RUST] drawPolyline: {} points → {} segments", n, n - 1);

        // 단일 트랜잭션 — Ctrl+Z 한 번에 전체 polyline 되돌림.
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mut any_failed = false;
        for i in 0..n - 1 {
            let start = DVec3::new(
                points[i * 3], points[i * 3 + 1], points[i * 3 + 2],
            );
            let end = DVec3::new(
                points[(i + 1) * 3], points[(i + 1) * 3 + 1], points[(i + 1) * 3 + 2],
            );
            let cmd = Command::DrawLine { start, end, surface_normal: None };
            let result = self.scene.execute(cmd);
            if matches!(result, axia_core::commands::CommandResult::Error(_)) {
                any_failed = true;
            }
        }

        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();

        self.mark_topology_changed();
        self.invalidate_cache();

        if any_failed { -1.0 } else { 0.0 }
    }

    pub fn draw_rect(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        nx: f64, ny: f64, nz: f64,
        ux: f64, uy: f64, uz: f64,
        width: f64, height: f64,
    ) -> f64 {
        let cmd = Command::DrawRect {
            center: DVec3::new(cx, cy, cz),
            normal: DVec3::new(nx, ny, nz),
            up: DVec3::new(ux, uy, uz),
            width,
            height,
        };
        let result = self.scene.execute(cmd);

        match result {
            axia_core::commands::CommandResult::EntityCreated(xia_id) => {
                self.mark_topology_changed();  // new face created
                self.invalidate_cache();

                let face_count = self.scene.mesh.face_count();
                debug_log!("[RUST] draw_rect: xia={} faces={} input_normal=({},{},{})",
                    xia_id, face_count, nx, ny, nz);
                xia_id as f64
            },
            _ => {
                self.invalidate_cache();
                -1.0
            }
        }
    }

    pub fn draw_circle(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        nx: f64, ny: f64, nz: f64,
        radius: f64, segments: u32,
    ) -> f64 {
        let cmd = Command::DrawCircle {
            center: DVec3::new(cx, cy, cz),
            normal: DVec3::new(nx, ny, nz),
            radius,
            segments,
        };
        let result = self.scene.execute(cmd);

        match result {
            axia_core::commands::CommandResult::EntityCreated(xia_id) => {
                self.mark_topology_changed();  // new face created
                self.invalidate_cache();
                xia_id as f64
            }
            _ => {
                self.invalidate_cache();
                -1.0
            }
        }
    }

    // ========================================================================
    // Primitive shapes (Cylinder, Cone, Sphere)
    // ========================================================================

    /// Create a cylinder primitive.
    /// Returns the base face ID for Push/Pull operations.
    pub fn create_cylinder(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        radius: f64, height: f64,
        segments: u32,
    ) -> f64 {
        let position = DVec3::new(cx, cy, cz);
        // ADR-007 Rev 2 Tier 3 — transaction + auto-intersect for primitives.
        self.scene.transactions.begin();
        let before = self.scene.scene_snapshot();
        self.scene.transactions.set_before_snapshot(before);
        match self.scene.mesh.create_cylinder(
            position,
            radius,
            height,
            segments,
            self.scene.default_material,
        ) {
            Ok(faces) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                // XIA 생성 — state는 face_ids.len()에서 자동 계산
                let xia_id = self.scene.create_xia_with_faces(
                    "Cylinder".to_string(),
                    position,
                    faces.clone(),
                );
                if self.scene.auto_intersect_on_draw {
                    let _ = self.scene.intersect_faces_inner(&faces);
                }
                let after = self.scene.scene_snapshot();
                self.scene.transactions.set_after_snapshot(after);
                self.scene.transactions.commit();
                if let Some(&base_face) = faces.first() {
                    debug_log!("[RUST] create_cylinder: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] create_cylinder error: {}", e);
                -1.0
            }
        }
    }

    /// Create a cone primitive.
    /// Returns the base face ID for Push/Pull operations.
    pub fn create_cone(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        radius: f64, height: f64,
        segments: u32,
    ) -> f64 {
        let position = DVec3::new(cx, cy, cz);
        // Tier 3 — transaction + auto-intersect.
        self.scene.transactions.begin();
        let before = self.scene.scene_snapshot();
        self.scene.transactions.set_before_snapshot(before);
        match self.scene.mesh.create_cone(
            position,
            radius,
            height,
            segments,
            self.scene.default_material,
        ) {
            Ok(faces) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                let xia_id = self.scene.create_xia_with_faces(
                    "Cone".to_string(),
                    position,
                    faces.clone(),
                );
                if self.scene.auto_intersect_on_draw {
                    let _ = self.scene.intersect_faces_inner(&faces);
                }
                let after = self.scene.scene_snapshot();
                self.scene.transactions.set_after_snapshot(after);
                self.scene.transactions.commit();
                if let Some(&base_face) = faces.first() {
                    debug_log!("[RUST] create_cone: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] create_cone error: {}", e);
                -1.0
            }
        }
    }

    /// Create an axis-aligned box primitive (6-face closed solid).
    /// Returns the bottom face ID for Push/Pull operations.
    pub fn create_box(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        width: f64, height: f64, depth: f64,
    ) -> f64 {
        let position = DVec3::new(cx, cy, cz);
        self.scene.transactions.begin();
        let before = self.scene.scene_snapshot();
        self.scene.transactions.set_before_snapshot(before);
        match self.scene.mesh.create_box(
            position, width, height, depth, self.scene.default_material,
        ) {
            Ok(faces) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                let xia_id = self.scene.create_xia_with_faces(
                    "Box".to_string(), position, faces.clone(),
                );
                if self.scene.auto_intersect_on_draw {
                    let _ = self.scene.intersect_faces_inner(&faces);
                }
                let after = self.scene.scene_snapshot();
                self.scene.transactions.set_after_snapshot(after);
                self.scene.transactions.commit();
                if let Some(&base_face) = faces.first() {
                    debug_log!("[RUST] create_box: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else { -1.0 }
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] create_box error: {}", e);
                -1.0
            }
        }
    }

    /// Create a sphere primitive (UV sphere).
    /// Returns a face ID from the sphere for Push/Pull operations.
    pub fn create_sphere(
        &mut self,
        cx: f64, cy: f64, cz: f64,
        radius: f64,
        u_segments: u32,
        v_segments: u32,
    ) -> f64 {
        let position = DVec3::new(cx, cy, cz);
        // Tier 3 — transaction + auto-intersect.
        self.scene.transactions.begin();
        let before = self.scene.scene_snapshot();
        self.scene.transactions.set_before_snapshot(before);
        match self.scene.mesh.create_sphere(
            position,
            radius,
            u_segments,
            v_segments,
            self.scene.default_material,
        ) {
            Ok(faces) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                let xia_id = self.scene.create_xia_with_faces(
                    "Sphere".to_string(),
                    position,
                    faces.clone(),
                );
                if self.scene.auto_intersect_on_draw {
                    let _ = self.scene.intersect_faces_inner(&faces);
                }
                let after = self.scene.scene_snapshot();
                self.scene.transactions.set_after_snapshot(after);
                self.scene.transactions.commit();
                if let Some(&first_face) = faces.first() {
                    debug_log!("[RUST] create_sphere: faces={} first_id={} xia={}", faces.len(), first_face.raw(), xia_id);
                    first_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] create_sphere error: {}", e);
                -1.0
            }
        }
    }

    // ========================================================================
    // XIA → Face ID lookup
    // ========================================================================

    /// 주어진 XIA가 소유한 모든 face ID 반환 (B3 — 그룹 병합용).
    /// 빈 배열이면 해당 XIA가 없거나 비어 있음.
    #[wasm_bindgen(js_name = "getXiaFaceIds")]
    pub fn get_xia_face_ids(&self, xia_id: u32) -> Vec<u32> {
        match self.scene.xias.get(&xia_id) {
            Some(xia) => xia.face_ids.iter().map(|f| f.raw()).collect(),
            None => Vec::new(),
        }
    }

    /// Returns the first face ID owned by the given XIA ID.
    /// draw_rect/draw_circle return XIA IDs; push_pull expects face IDs.
    /// Returns u32::MAX on failure.
    pub fn get_xia_face(&self, xia_id: u32) -> u32 {
        if let Some(xia) = self.scene.xias.get(&xia_id) {
            if let Some(&fid) = xia.face_ids.first() {
                return fid.raw();
            }
        }
        u32::MAX
    }

    /// face가 속한 XIA의 ID 반환 (O(1) 역인덱스)
    /// 없으면 u32::MAX 반환
    pub fn get_xia_for_face(&self, face_id_raw: u32) -> u32 {
        let fid = FaceId::new(face_id_raw);
        self.scene.get_xia_for_face(fid).unwrap_or(u32::MAX)
    }

    /// 씬에 존재하는 모든 XIA ID를 반환. 디버깅/열거용.
    #[wasm_bindgen(js_name = "getXiaIds")]
    pub fn get_xia_ids(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.scene.xias.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// 씬의 XIA 개수.
    #[wasm_bindgen(js_name = "xiaCount")]
    pub fn xia_count(&self) -> u32 {
        self.scene.xias.len() as u32
    }

    /// 특정 XIA ID에 대한 요약 JSON.
    /// `get_xia_info`는 face ID를 받지만, 이 함수는 **XIA ID를 직접 받는다**.
    /// 내부적으로 해당 XIA의 모든 face_ids를 수집해 `get_xia_info`와 동일한 JSON을 반환.
    ///
    /// XIA가 없으면 `{"empty":true}` 반환.
    #[wasm_bindgen(js_name = "getXiaStats")]
    pub fn get_xia_stats(&self, xia_id: u32) -> String {
        let Some(xia) = self.scene.xias.get(&xia_id) else {
            return r#"{"empty":true}"#.to_string();
        };
        let face_ids_raw: Vec<u32> = xia.face_ids.iter().map(|f| f.raw()).collect();
        self.get_xia_info(&face_ids_raw)
    }

    // ========================================================================
    // Push/Pull
    // ========================================================================

    /// Push/Pull a face along its normal.
    /// dist > 0 = extrude outward (face kept)
    /// dist < 0 = recess inward  (face removed)
    pub fn push_pull(
        &mut self,
        face_id_raw: u32,
        dist: f64,
    ) -> bool {
        let fid = FaceId::new(face_id_raw);
        let faces_before = self.scene.mesh.face_count();

        // Log face normal for direction debugging
        let face_normal = if let Some(face) = self.scene.mesh.faces.get(fid) {
            let n = face.normal();
            format!("({:.3},{:.3},{:.3})", n.x, n.y, n.z)
        } else {
            "N/A".to_string()
        };
        debug_log!("[RUST] push_pull faceId={} dist={:.3} normal={} faces_before={}",
            face_id_raw, dist, face_normal, faces_before);

        let cmd = Command::PushPull {
            face_id: fid,
            dist,
        };
        let result = self.scene.execute(cmd);

        let faces_after = self.scene.mesh.face_count();

        let ok = match &result {
            axia_core::commands::CommandResult::PushPullDone {
                sides_created, adj_splits, base_removed, ref split_debug
            } => {
                debug_log!(
                    "[RUST] after: faces={} (delta={:+}) sides={} adj_splits={} base_removed={}",
                    faces_after, faces_after as i64 - faces_before as i64,
                    sides_created, adj_splits, base_removed
                );
                for msg in split_debug {
                    debug_log!("[SPLIT] {}", msg);
                }
                true
            }
            axia_core::commands::CommandResult::Error(e) => {
                console_error!("[RUST] push_pull ERROR: {}", e);
                self.set_error(e.to_string());
                false
            }
            _ => {
                debug_log!("[RUST] after: faces={} (delta={:+})",
                    faces_after, faces_after as i64 - faces_before as i64);
                false
            }
        };

        // Push/Pull changes topology (adds side faces, merges coplanar faces)
        if ok {
            self.mark_topology_changed();
        }

        self.invalidate_cache();
        ok
    }

    /// Push/Pull a smooth group seamlessly (no gaps, wall faces connect adjacent surfaces)
    ///
    /// # Parameters
    /// - face_ids: Uint32Array of face IDs (wasm-bindgen converts JS Uint32Array → Vec<u32>)
    /// - dist: distance to offset (positive = outward)
    ///
    /// # Returns
    /// true if successful
    ///
    /// # Behavior
    /// - NaN/0 distance → no-op, returns true.
    /// - Empty group → no-op, returns true.
    /// - All faces coplanar → falls back to per-face regular push_pull
    ///   (prevents degenerate walls when smooth group contains only split sub-faces).
    #[wasm_bindgen]
    pub fn push_pull_smooth_group_seamless(
        &mut self,
        face_ids: Vec<u32>,
        dist: f64,
    ) -> bool {
        // NaN / 0 guard — JS can pass NaN if args are misaligned
        if !dist.is_finite() || dist == 0.0 || face_ids.is_empty() {
            return true;
        }

        let smooth_group: Vec<FaceId> = face_ids
            .iter()
            .map(|&id| FaceId::new(id))
            .collect();

        debug_log!(
            "[RUST] push_pull_smooth_group_seamless: {} faces, dist={:.3}",
            smooth_group.len(),
            dist
        );

        // ────────────────────────────────────────────────────────────────
        // Coplanar fallback — if all faces share the same normal (within
        // a tight tolerance), seamless-offset would create degenerate walls
        // on shared edges. Delegate to regular per-face push_pull instead.
        //
        // This handles the case where findSmoothGroup returns split sub-faces
        // (same plane, same normal) that should be treated independently.
        // ────────────────────────────────────────────────────────────────
        if smooth_group.len() >= 2 && self.all_faces_coplanar(&smooth_group) {
            debug_log!(
                "[RUST] seamless: all {} faces coplanar — falling back to per-face push_pull",
                smooth_group.len()
            );
            // Only push/pull the FIRST face to avoid topology chaos from
            // operating on multiple coplanar split siblings simultaneously.
            // The user clicked one face; that's the one that should extrude.
            let first = smooth_group[0];
            let cmd = Command::PushPull { face_id: first, dist };
            let result = self.scene.execute(cmd);
            let ok = matches!(result, axia_core::commands::CommandResult::PushPullDone { .. });
            if ok { self.mark_topology_changed(); }
            self.invalidate_cache();
            return ok;
        }

        let faces_before = self.scene.mesh.face_count();

        // Execute seamless offset
        let result = match self.scene.mesh.push_pull_smooth_group_seamless(
            smooth_group.clone(),
            dist,
            axia_geo::MaterialId::new(0),
        ) {
            Ok(pp_result) => {
                let faces_after = self.scene.mesh.face_count();
                debug_log!(
                    "[RUST] seamless offset done: {} → {} faces (delta={}), {} wall faces",
                    faces_before,
                    faces_after,
                    faces_after as i64 - faces_before as i64,
                    pp_result.side_faces.len()
                );
                for msg in &pp_result.split_debug {
                    debug_log!("[SEAMLESS] {}", msg);
                }
                true
            }
            Err(e) => {
                console_error!("[RUST] push_pull_smooth_group_seamless ERROR: {}", e);
                false
            }
        };

        if result {
            self.mark_topology_changed();  // seamless push_pull changes topology
        }
        self.invalidate_cache();
        result
    }

    // ========================================================================
    // Face Split — draw line on face to subdivide it
    // ========================================================================

    /// Split a face by drawing a line segment across it.
    ///
    /// Both endpoints should be on the face's boundary (on an edge or at a vertex).
    /// Creates two new faces from the original face.
    ///
    /// # Parameters
    /// - face_id_raw: the face to split
    /// - x0, y0, z0: line start point
    /// - x1, y1, z1: line end point
    ///
    /// # Returns
    /// JSON string with split result info, or empty string on failure.
    #[wasm_bindgen(js_name = "splitFaceByLine")]
    pub fn split_face_by_line(
        &mut self,
        face_id_raw: u32,
        x0: f64, y0: f64, z0: f64,
        x1: f64, y1: f64, z1: f64,
    ) -> String {
        use axia_geo::operations::face_split;

        let fid = FaceId::new(face_id_raw);
        let line_start = DVec3::new(x0, y0, z0);
        let line_end = DVec3::new(x1, y1, z1);

        // Snapshot for undo
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let faces_before = self.scene.mesh.face_count();

        match face_split::split_face_by_line(&mut self.scene.mesh, fid, line_start, line_end) {
            Ok(result) => {
                let faces_after = self.scene.mesh.face_count();
                debug_log!("[RUST] split_face_by_line: face {} → {} new faces, {} new verts, faces {}->{} (delta {:+})",
                    face_id_raw, result.new_faces.len(), result.new_verts.len(),
                    faces_before, faces_after, faces_after as i64 - faces_before as i64);

                for msg in &result.debug {
                    debug_log!("[SPLIT] {}", msg);
                }

                // Commit undo frame
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();

                self.mark_topology_changed();
                self.invalidate_cache();

                // Return JSON with result info
                let face_ids: Vec<u32> = result.new_faces.iter().map(|f| f.raw()).collect();
                let vert_ids: Vec<u32> = result.new_verts.iter().map(|v| v.raw()).collect();
                format!("{{\"faces\":{:?},\"verts\":{:?},\"edges\":{}}}",
                    face_ids, vert_ids, result.new_edges.len())
            }
            Err(e) => {
                console_error!("[RUST] split_face_by_line ERROR: {}", e);
                // 트랜잭션 명시적 취소 — 열린 프레임이 남으면 후속 undo 스택 오염
                self.scene.transactions.cancel();
                self.set_error(format!("split_face_by_line: {}", e));
                format!("{{\"error\":\"{}\"}}", e.to_string().replace('"', "'"))
            }
        }
    }

    /// Test if a 3D point lies within a face's boundary.
    ///
    /// Returns true if the point is on the face's plane and inside its edges.
    /// Useful for determining if a draw operation should trigger face split.
    #[wasm_bindgen(js_name = "pointInFace")]
    pub fn point_in_face(&self, face_id_raw: u32, x: f64, y: f64, z: f64) -> bool {
        use axia_geo::operations::face_split;

        let fid = FaceId::new(face_id_raw);
        let point = DVec3::new(x, y, z);

        match face_split::point_in_face(&self.scene.mesh, fid, point) {
            Ok(result) => result,
            Err(_) => false,
        }
    }

    // ========================================================================
    // Undo/Redo
    // ========================================================================

    pub fn undo(&mut self) -> bool {
        let result = self.scene.execute(Command::Undo);
        self.mark_topology_changed();  // undo can restore/remove faces
        self.invalidate_cache();
        matches!(result, axia_core::commands::CommandResult::MeshUpdated)
    }

    pub fn redo(&mut self) -> bool {
        let result = self.scene.execute(Command::Redo);
        self.mark_topology_changed();  // redo can restore/remove faces
        self.invalidate_cache();
        matches!(result, axia_core::commands::CommandResult::MeshUpdated)
    }

    pub fn can_undo(&self) -> bool {
        self.scene.transactions.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.scene.transactions.can_redo()
    }

    // ========================================================================
    // Mesh export (cached)
    // ========================================================================

    pub fn get_positions(&mut self) -> Vec<f32> {
        self.rebuild_cache();
        self.cached_positions.clone()
    }

    /// ADR-013 §4 zero-copy view — returns raw pointer + length so JS can
    /// build a `Float32Array(memory.buffer, ptr, len)` without copying.
    /// Caller MUST refresh after any WASM allocation (memory may grow).
    /// 길이/포인터 둘 다 필요하므로 별도 함수 2개로 노출.
    #[wasm_bindgen(js_name = "getPositionsPtr")]
    pub fn get_positions_ptr(&mut self) -> *const f32 {
        self.rebuild_cache();
        self.cached_positions.as_ptr()
    }
    #[wasm_bindgen(js_name = "getPositionsLen")]
    pub fn get_positions_len(&mut self) -> usize {
        self.rebuild_cache();
        self.cached_positions.len()
    }
    #[wasm_bindgen(js_name = "getNormalsPtr")]
    pub fn get_normals_ptr(&mut self) -> *const f32 {
        self.rebuild_cache();
        self.cached_normals.as_ptr()
    }
    #[wasm_bindgen(js_name = "getNormalsLen")]
    pub fn get_normals_len(&mut self) -> usize {
        self.rebuild_cache();
        self.cached_normals.len()
    }
    #[wasm_bindgen(js_name = "getIndicesPtr")]
    pub fn get_indices_ptr(&mut self) -> *const u32 {
        self.rebuild_cache();
        self.cached_indices.as_ptr()
    }
    #[wasm_bindgen(js_name = "getIndicesLen")]
    pub fn get_indices_len(&mut self) -> usize {
        self.rebuild_cache();
        self.cached_indices.len()
    }
    #[wasm_bindgen(js_name = "getFaceMapPtr")]
    pub fn get_face_map_ptr(&mut self) -> *const u32 {
        self.rebuild_cache();
        self.cached_face_map.as_ptr()
    }
    #[wasm_bindgen(js_name = "getFaceMapLen")]
    pub fn get_face_map_len(&mut self) -> usize {
        self.rebuild_cache();
        self.cached_face_map.len()
    }

    /// Get vertex positions in f64 precision (CAD-grade).
    /// Same layout as get_positions() but Float64Array — no f32 truncation.
    /// Use for dimension display, snap matching, and precision-sensitive operations.
    #[wasm_bindgen(js_name = "getPositionsF64")]
    pub fn get_positions_f64(&mut self) -> Vec<f64> {
        self.rebuild_cache();
        self.cached_positions_f64.clone()
    }

    pub fn get_normals(&mut self) -> Vec<f32> {
        self.rebuild_cache();
        self.cached_normals.clone()
    }

    pub fn get_indices(&mut self) -> Vec<u32> {
        self.rebuild_cache();
        self.cached_indices.clone()
    }

    /// Get the FaceId for each triangle (one u32 per triangle).
    /// Use: face_map[triangleIndex] → FaceId for push_pull.
    pub fn get_face_map(&mut self) -> Vec<u32> {
        self.rebuild_cache();
        self.cached_face_map.clone()
    }

    /// Get hard edge line segments for wireframe rendering.
    /// Returns flat [x0,y0,z0, x1,y1,z1, ...] — use with THREE.LineSegments.
    /// Coplanar edges (angle ≤ 15°) are automatically hidden.
    /// Centerline edges are excluded — call getCenterlineLines() separately.
    pub fn get_edge_lines(&mut self) -> Vec<f32> {
        self.rebuild_cache();
        self.cached_edge_lines.clone()
    }

    /// Get centerline edge segments for separate rendering (dashed/thin/dimmer).
    /// Flat [x0,y0,z0, x1,y1,z1, ...] — pair per segment.
    /// Not cached — centerlines are typically fewer and changes infrequently,
    /// but if perf becomes an issue we can cache like getEdgeLines.
    #[wasm_bindgen(js_name = "getCenterlineLines")]
    pub fn get_centerline_lines(&self) -> Vec<f32> {
        self.scene.mesh.export_centerline_lines()
    }

    /// Edge line segment index → EdgeId raw value mapping.
    /// segment[i]의 EdgeId = edge_map[i]
    pub fn get_edge_map(&mut self) -> Vec<u32> {
        self.rebuild_cache();
        self.cached_edge_map.clone()
    }

    /// Get unique vertex positions in f64 precision for snap system.
    /// Returns flat [x0,y0,z0, x1,y1,z1, ...] as Float64Array.
    /// Snap system should use these instead of the f32 render buffers.
    #[wasm_bindgen(js_name = "getSnapVerticesF64")]
    pub fn get_snap_vertices_f64(&self) -> Vec<f64> {
        use std::collections::HashSet;
        let mut seen = HashSet::new();
        let mut result = Vec::new();

        for (_fid, face) in self.scene.mesh.faces.iter() {
            if !face.is_active() || !face.is_visible() { continue; }
            let start = face.outer().start;
            if start.is_null() { continue; }
            if let Ok(verts) = self.scene.mesh.collect_loop_verts(start) {
                for vid in verts {
                    if seen.insert(vid) {
                        if let Ok(pos) = self.scene.mesh.vertex_pos(vid) {
                            result.push(pos.x);
                            result.push(pos.y);
                            result.push(pos.z);
                        }
                    }
                }
            }
        }

        // Also include standalone edge vertices
        for (_eid, edge) in self.scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            for &vid in &[edge.v_small(), edge.v_large()] {
                if seen.insert(vid) {
                    if let Ok(pos) = self.scene.mesh.vertex_pos(vid) {
                        result.push(pos.x);
                        result.push(pos.y);
                        result.push(pos.z);
                    }
                }
            }
        }

        result
    }

    // ════════════════════════════════════════════════════════════════════════
    // Delta Buffer Export (Phase 1 Optimization)
    // ════════════════════════════════════════════════════════════════════════

    /// Export incremental geometry updates for dirty faces.
    ///
    /// Two modes:
    /// - **topology_changed = true**: Topology was modified (draw/push_pull/delete/boolean).
    ///   Returns a DeltaBuffers with topology_changed=true and empty data.
    ///   JS must do a full rebuild via getMeshBuffers().
    ///
    /// - **topology_changed = false**: Only vertex positions changed (translate/rotate/scale).
    ///   Returns the new positions/normals for dirty faces with their offsets
    ///   into the full buffer, so JS can patch in-place.
    ///
    /// Returns None if nothing changed since last export.
    /// Clears dirty_faces and topology_changed after export.
    #[wasm_bindgen(js_name = "getDirtyFaceBuffers")]
    pub fn get_dirty_face_buffers(&mut self) -> Option<DeltaBuffers> {
        // Nothing changed at all
        if !self.topology_changed && self.dirty_faces.is_empty() {
            return None;
        }

        // Case 1: Topology changed → tell JS to do full rebuild
        if self.topology_changed {
            self.dirty_faces.clear();
            self.topology_changed = false;
            return Some(DeltaBuffers {
                modified_face_ids: Vec::new(),
                positions: Vec::new(),
                normals: Vec::new(),
                face_vert_offsets: Vec::new(),
                face_vert_counts: Vec::new(),
                cache_version: self.cache_version,
                topology_changed: true,
            });
        }

        // Case 2: Position-only change (translate/rotate/scale)
        // We need the face_range_map from the PREVIOUS full rebuild.
        // If face_range_map is empty, we can't do delta — force full rebuild.
        if self.face_range_map.is_empty() {
            self.dirty_faces.clear();
            self.topology_changed = false;
            return Some(DeltaBuffers {
                modified_face_ids: Vec::new(),
                positions: Vec::new(),
                normals: Vec::new(),
                face_vert_offsets: Vec::new(),
                face_vert_counts: Vec::new(),
                cache_version: self.cache_version,
                topology_changed: true,  // force full rebuild since no range map
            });
        }

        // Rebuild cache to get fresh vertex positions after transform
        self.rebuild_cache();

        let mut modified_face_ids = Vec::new();
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut face_vert_offsets = Vec::new();
        let mut face_vert_counts = Vec::new();

        // For each dirty face, look up its range in the full buffer and copy
        for &face_id in &self.dirty_faces {
            if let Some(range) = self.face_range_map.get(&face_id) {
                let start = range.vert_start as usize;
                let count = range.vert_count as usize;
                let float_start = start * 3;
                let float_end = float_start + count * 3;

                // Bounds check
                if float_end > self.cached_positions.len() || float_end > self.cached_normals.len() {
                    continue;
                }

                modified_face_ids.push(face_id);
                face_vert_offsets.push(range.vert_start);
                face_vert_counts.push(range.vert_count);

                // Copy this face's positions and normals from the full cache
                positions.extend_from_slice(&self.cached_positions[float_start..float_end]);
                normals.extend_from_slice(&self.cached_normals[float_start..float_end]);
            }
            // Skip faces not in range map (shouldn't happen for position-only changes)
        }

        // Sort by face_id for consistent output
        // (need to sort all arrays together)
        if modified_face_ids.len() > 1 {
            let mut order: Vec<usize> = (0..modified_face_ids.len()).collect();
            order.sort_unstable_by_key(|&i| modified_face_ids[i]);

            let sorted_ids: Vec<u32> = order.iter().map(|&i| modified_face_ids[i]).collect();
            let sorted_offsets: Vec<u32> = order.iter().map(|&i| face_vert_offsets[i]).collect();
            let sorted_counts: Vec<u32> = order.iter().map(|&i| face_vert_counts[i]).collect();

            // Rebuild positions/normals in sorted order
            let mut sorted_positions = Vec::with_capacity(positions.len());
            let mut sorted_normals = Vec::with_capacity(normals.len());
            // Build a prefix-sum of original vertex counts for source offsets
            let mut src_offsets: Vec<usize> = Vec::with_capacity(order.len());
            let mut acc = 0usize;
            for &count in &face_vert_counts {
                src_offsets.push(acc);
                acc += count as usize * 3;
            }
            for &i in &order {
                let count = face_vert_counts[i] as usize * 3;
                let start = src_offsets[i];
                sorted_positions.extend_from_slice(&positions[start..start + count]);
                sorted_normals.extend_from_slice(&normals[start..start + count]);
            }

            modified_face_ids = sorted_ids;
            face_vert_offsets = sorted_offsets;
            face_vert_counts = sorted_counts;
            positions = sorted_positions;
            normals = sorted_normals;
        }

        self.dirty_faces.clear();
        self.topology_changed = false;

        Some(DeltaBuffers {
            modified_face_ids,
            positions,
            normals,
            face_vert_offsets,
            face_vert_counts,
            cache_version: self.cache_version,
            topology_changed: false,
        })
    }

    // ========================================================================
    // Scene info
    // ========================================================================

    /// Force-delete a face from the mesh.
    ///
    /// Wrapped in an undo transaction (Bug #1 fix, 2026-04-17) — previously
    /// this op mutated the mesh without recording a snapshot, causing Ctrl+Z
    /// to skip past the deletion to an earlier command.
    pub fn delete_face(&mut self, face_id_raw: u32) -> bool {
        let fid = FaceId::new(face_id_raw);
        if !self.scene.mesh.faces.contains(fid) {
            return true; // already gone — no-op, no transaction needed
        }

        // Begin undo transaction
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        // Clean up face_to_xia reverse index + XIA face_ids
        self.scene.unregister_face_from_xia(fid);
        // Try proper removal first
        let _ = self.scene.mesh.remove_face(fid);
        // Force-remove from storage even if remove_face had issues
        if self.scene.mesh.faces.contains(fid) {
            self.scene.mesh.faces.remove(fid);
        }

        // Commit transaction so Ctrl+Z can restore this deletion
        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();

        self.mark_topology_changed();
        self.invalidate_cache();
        !self.scene.mesh.faces.contains(fid) // return true if actually gone
    }

    /// Delete an edge (and its half-edges) from the mesh.
    /// Also removes any faces that reference this edge (SketchUp-style cascade).
    ///
    /// Legacy signature returning just bool — calls the cascaded_count version.
    /// New code should prefer `delete_edge_cascade` which reports how many faces
    /// were removed so the UI can show a toast.
    pub fn delete_edge(&mut self, edge_id_raw: u32) -> bool {
        self.delete_edge_cascade(edge_id_raw) >= 0
    }

    /// Delete an edge plus all faces sharing it. Returns the cascaded face count
    /// (>= 0 on success, -1 on failure). TS wraps this to inform the user how
    /// many faces were removed as a side effect.
    #[wasm_bindgen(js_name = "deleteEdgeCascade")]
    pub fn delete_edge_cascade(&mut self, edge_id_raw: u32) -> i32 {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            return 0; // already gone, 0 cascaded
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        // First, find and remove any faces sharing this edge
        let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
        let cascade_count = faces.len() as i32;
        // Clean up face_to_xia for all affected faces
        let face_ids: Vec<FaceId> = faces.iter().copied().collect();
        self.scene.unregister_faces_from_xia(&face_ids);
        for fid in faces {
            let _ = self.scene.mesh.remove_face(fid);
            if self.scene.mesh.faces.contains(fid) {
                self.scene.mesh.faces.remove(fid);
            }
        }

        // Then remove the edge itself
        let _ = self.scene.mesh.remove_edge_and_halfedges(eid);
        // Force-remove if still present
        if self.scene.mesh.edges.contains(eid) {
            self.scene.mesh.edges.remove(eid);
        }

        // Clean up isolated vertices
        self.scene.mesh.remove_isolated_verts();

        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();

        if self.scene.mesh.edges.contains(eid) {
            -1 // failure
        } else {
            cascade_count
        }
    }

    /// Batch delete faces and edges in a single undo transaction.
    /// Called from JS delete action — undo restores everything at once.
    pub fn batch_delete(&mut self, face_ids: &[u32], edge_ids: &[u32]) -> bool {
        if face_ids.is_empty() && edge_ids.is_empty() {
            return false;
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        // Collect all face IDs to unregister (direct + edge-sharing)
        let mut all_removed_faces: Vec<FaceId> = Vec::new();

        // Delete faces first
        for &fid_raw in face_ids {
            let fid = FaceId::new(fid_raw);
            if self.scene.mesh.faces.contains(fid) {
                all_removed_faces.push(fid);
                let _ = self.scene.mesh.remove_face(fid);
                if self.scene.mesh.faces.contains(fid) {
                    self.scene.mesh.faces.remove(fid);
                }
            }
        }

        // Delete edges (also removes faces sharing the edge)
        for &eid_raw in edge_ids {
            let eid = EdgeId::new(eid_raw);
            if !self.scene.mesh.edges.contains(eid) {
                continue;
            }
            let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
            for fid in &faces {
                all_removed_faces.push(*fid);
            }
            for fid in faces {
                let _ = self.scene.mesh.remove_face(fid);
                if self.scene.mesh.faces.contains(fid) {
                    self.scene.mesh.faces.remove(fid);
                }
            }
            let _ = self.scene.mesh.remove_edge_and_halfedges(eid);
            if self.scene.mesh.edges.contains(eid) {
                self.scene.mesh.edges.remove(eid);
            }
        }

        // Batch clean up face_to_xia for all removed faces
        self.scene.unregister_faces_from_xia(&all_removed_faces);

        // Clean up isolated vertices
        self.scene.mesh.remove_isolated_verts();

        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();

        true
    }

    /// Dry-run: "if I erase this edge right now, would it merge two coplanar
    /// faces (good outcome) or cascade-delete (destructive)?"
    ///
    /// Returns:
    ///   • `[f1, f2]` — the two adjacent faces that would merge into one
    ///   • `[]`      — merge would fail (non-coplanar, C-slit, or edge not
    ///                 shared by exactly 2 faces); erase would cascade
    ///
    /// Pure inspection — no state mutation, safe to call on every mousemove.
    #[wasm_bindgen(js_name = "previewEdgeEraseMerge")]
    pub fn preview_edge_erase_merge(&self, edge_id_raw: u32, angle_tol_deg: f64) -> Vec<u32> {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            return vec![];
        }
        let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
        if faces.len() != 2 {
            return vec![];
        }
        match self.scene.mesh.are_faces_coplanar_with_tolerance(
            faces[0], faces[1], angle_tol_deg,
        ) {
            Ok(true) => vec![faces[0].raw(), faces[1].raw()],
            _ => vec![],
        }
    }

    /// Measure helpers — pure queries, no state mutation.
    ///
    /// faceArea returns the planar area of a single face (fan-triangulated
    /// cross-product magnitude / 2). Returns 0 on error / missing face.
    #[wasm_bindgen(js_name = "faceArea")]
    pub fn face_area(&self, face_id_raw: u32) -> f64 {
        self.scene.mesh.face_area(FaceId::new(face_id_raw))
    }

    /// edgeLength returns the straight-line distance between an edge's
    /// two endpoints. Zero on missing / degenerate edge.
    #[wasm_bindgen(js_name = "edgeLength")]
    pub fn edge_length(&self, edge_id_raw: u32) -> f64 {
        let eid = EdgeId::new(edge_id_raw);
        let edge = match self.scene.mesh.edges.get(eid) { Some(e) => e, None => return 0.0 };
        let va = edge.v_small();
        let vb = edge.v_large();
        let pa = match self.scene.mesh.vertex_pos(va) { Ok(p) => p, Err(_) => return 0.0 };
        let pb = match self.scene.mesh.vertex_pos(vb) { Ok(p) => p, Err(_) => return 0.0 };
        (pb - pa).length()
    }

    /// meshVolume returns the signed enclosed volume of the whole mesh.
    /// Exact for closed solids; indicative only for open shells.
    #[wasm_bindgen(js_name = "meshVolume")]
    pub fn mesh_volume(&self) -> f64 {
        self.scene.mesh.mesh_volume()
    }

    /// Linear array — create `count` translated copies of the given
    /// faces, each shifted by `offset · k` for k = 1..=count. Returns
    /// the new FaceIds in copy-major, source-order.
    #[wasm_bindgen(js_name = "arrayLinearFaces")]
    pub fn array_linear_faces(
        &mut self,
        face_ids: &[u32],
        count: u32,
        dx: f64, dy: f64, dz: f64,
    ) -> Vec<u32> {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let offset = DVec3::new(dx, dy, dz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.array_linear_faces(&fids, count, offset) {
            Ok(new_faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] array_linear_faces ERROR: {}", e);
                self.set_error(format!("array_linear: {}", e));
                Vec::new()
            }
        }
    }

    /// Radial array — rotate `count` copies of the given faces around
    /// an axis. Copy `k` is rotated by `total_angle_rad · k / count`
    /// about (axis_origin, axis_dir). Returns new FaceIds copy-major.
    #[wasm_bindgen(js_name = "arrayRadialFaces")]
    pub fn array_radial_faces(
        &mut self,
        face_ids: &[u32],
        count: u32,
        ox: f64, oy: f64, oz: f64,
        ax: f64, ay: f64, az: f64,
        total_angle_rad: f64,
    ) -> Vec<u32> {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let origin = DVec3::new(ox, oy, oz);
        let axis = DVec3::new(ax, ay, az);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.array_radial_faces(&fids, count, origin, axis, total_angle_rad) {
            Ok(new_faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] array_radial_faces ERROR: {}", e);
                self.set_error(format!("array_radial: {}", e));
                Vec::new()
            }
        }
    }

    /// Return the outer-loop vertex IDs of a face in walk order.
    /// Empty vec on error (face missing, degenerate, etc.).
    #[wasm_bindgen(js_name = "getFaceVertices")]
    pub fn get_face_vertices(&self, face_id_raw: u32) -> Vec<u32> {
        let fid = FaceId::new(face_id_raw);
        if !self.scene.mesh.faces.contains(fid) { return vec![]; }
        let start = self.scene.mesh.faces[fid].outer().start;
        match self.scene.mesh.collect_loop_verts(start) {
            Ok(verts) => verts.into_iter().map(|v| v.raw()).collect(),
            Err(_) => vec![],
        }
    }

    /// Bend a vertex set around `bend_axis` with angle ramping from 0
    /// (at `t=0` along `bend_dir`) to `angle_deg` (at `t=length_limit`).
    /// Verts with negative `t` (behind `origin`) are left untouched.
    #[wasm_bindgen(js_name = "bendVerts")]
    pub fn bend_verts(
        &mut self,
        vert_ids: &[u32],
        ax_x: f64, ax_y: f64, ax_z: f64,          // bend axis
        dir_x: f64, dir_y: f64, dir_z: f64,       // bend direction
        ox: f64, oy: f64, oz: f64,                // origin
        angle_deg: f64,
        length_limit: f64,
    ) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let bend_axis = DVec3::new(ax_x, ax_y, ax_z);
        let bend_dir = DVec3::new(dir_x, dir_y, dir_z);
        let origin = DVec3::new(ox, oy, oz);
        let angle_rad = angle_deg.to_radians();

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.bend_verts(&vids, bend_axis, bend_dir, origin, angle_rad, length_limit) {
            Ok(_) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(format!("bend: {}", e));
                false
            }
        }
    }

    /// Twist a vertex set around `(axis_origin, axis_dir)` with
    /// `degrees_per_unit` degrees of rotation per unit of axial distance.
    #[wasm_bindgen(js_name = "twistVerts")]
    pub fn twist_verts_deform(
        &mut self,
        vert_ids: &[u32],
        ox: f64, oy: f64, oz: f64,
        ax: f64, ay: f64, az: f64,
        degrees_per_unit: f64,
    ) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let axis_origin = DVec3::new(ox, oy, oz);
        let axis_dir = DVec3::new(ax, ay, az);
        let angle_per_unit = degrees_per_unit.to_radians();

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.twist_verts(&vids, axis_origin, axis_dir, angle_per_unit) {
            Ok(_) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(format!("twist: {}", e));
                false
            }
        }
    }

    /// Taper a vertex set along `(axis_origin, axis_dir)` from
    /// `start_scale` at t=0 to `end_scale` at t=length.
    #[wasm_bindgen(js_name = "taperVerts")]
    pub fn taper_verts(
        &mut self,
        vert_ids: &[u32],
        ox: f64, oy: f64, oz: f64,
        ax: f64, ay: f64, az: f64,
        start_scale: f64,
        end_scale: f64,
        length: f64,
    ) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let axis_origin = DVec3::new(ox, oy, oz);
        let axis_dir = DVec3::new(ax, ay, az);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.taper_verts(&vids, axis_origin, axis_dir, start_scale, end_scale, length) {
            Ok(_) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(format!("taper: {}", e));
                false
            }
        }
    }

    /// Round off a single edge into a cylindrical arc of the given
    /// radius, sampled with `segments` quads. Returns the count of new
    /// fillet strip quads on success (>= 2), or -1 on failure with
    /// `lastError()` populated.
    #[wasm_bindgen(js_name = "filletEdge")]
    pub fn fillet_edge(
        &mut self,
        edge_id_raw: u32,
        radius: f64,
        segments: u32,
    ) -> i32 {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            self.set_error(format!("fillet: edge {} not found", edge_id_raw));
            return -1;
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.fillet_edge(eid, radius, segments) {
            Ok(res) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                res.fillet_faces.len() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] fillet_edge ERROR: {}", e);
                self.set_error(format!("fillet: {}", e));
                -1
            }
        }
    }

    /// Apply one level of Catmull-Clark subdivision to the whole mesh.
    /// Returns the count of new quads on success, or -1 on failure.
    /// Wrapped in a single undo transaction so one Ctrl+Z restores the
    /// original topology.
    #[wasm_bindgen(js_name = "subdivideCatmullClark")]
    pub fn subdivide_catmull_clark(&mut self) -> i32 {
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.subdivide_catmull_clark() {
            Ok(count) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                count as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] subdivide_catmull_clark ERROR: {}", e);
                self.set_error(format!("subdivide: {}", e));
                -1
            }
        }
    }

    /// Sweep a 2D profile along a 3D path, producing one ring of vertices
    /// per path point and stitching them with `loft`. `profile_flat` is
    /// K points (xyz triples) in a local XY plane; `path_flat` is M points
    /// (xyz triples) in world space. `closed_profile` treats the profile
    /// as a closed ring. Returns new FaceIds; empty on failure.
    #[wasm_bindgen(js_name = "sweepProfileAlongPath")]
    pub fn sweep_profile_along_path(
        &mut self,
        profile_flat: &[f64],
        path_flat: &[f64],
        closed_profile: bool,
    ) -> Vec<u32> {
        if profile_flat.len() < 9 || profile_flat.len() % 3 != 0
            || path_flat.len() < 6 || path_flat.len() % 3 != 0
        {
            self.set_error(format!(
                "sweep: bad input — profile_flat.len()={}, path_flat.len()={}",
                profile_flat.len(), path_flat.len(),
            ));
            return Vec::new();
        }
        let profile: Vec<DVec3> = profile_flat.chunks_exact(3)
            .map(|c| DVec3::new(c[0], c[1], c[2])).collect();
        let path: Vec<DVec3> = path_flat.chunks_exact(3)
            .map(|c| DVec3::new(c[0], c[1], c[2])).collect();
        let material = self.scene.default_material;

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.sweep(&profile, &path, closed_profile, material) {
            Ok(faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] sweep ERROR: {}", e);
                self.set_error(format!("sweep: {}", e));
                Vec::new()
            }
        }
    }

    /// Loft N cross-sections into a continuous surface. `sections_flat` is
    /// a flat f64 array containing every point of every section as xyz
    /// triples; `section_size` says how many POINTS (not floats) are in
    /// each section. All sections must be the same size.
    ///
    /// `closed_sections` treats each section as a closed ring (the last
    /// point wraps to the first).
    ///
    /// Returns the new FaceIds in section-major, point-minor order.
    /// Single undo transaction.
    #[wasm_bindgen(js_name = "loftSections")]
    pub fn loft_sections(
        &mut self,
        sections_flat: &[f64],
        section_size: u32,
        closed_sections: bool,
    ) -> Vec<u32> {
        let ps = section_size as usize;
        if ps < 3 || sections_flat.len() % (3 * ps) != 0 || sections_flat.is_empty() {
            self.set_error(format!(
                "loft: bad input — sections_flat.len()={}, section_size={}",
                sections_flat.len(), section_size,
            ));
            return Vec::new();
        }
        let n_sections = sections_flat.len() / (3 * ps);
        if n_sections < 2 {
            self.set_error(format!("loft: need ≥ 2 sections, got {}", n_sections));
            return Vec::new();
        }
        let mut sections: Vec<Vec<DVec3>> = Vec::with_capacity(n_sections);
        for s in 0..n_sections {
            let base = s * ps * 3;
            let mut sec = Vec::with_capacity(ps);
            for j in 0..ps {
                let idx = base + j * 3;
                sec.push(DVec3::new(
                    sections_flat[idx],
                    sections_flat[idx + 1],
                    sections_flat[idx + 2],
                ));
            }
            sections.push(sec);
        }
        let material = self.scene.default_material;

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.loft(&sections, closed_sections, material) {
            Ok(faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] loft ERROR: {}", e);
                self.set_error(format!("loft: {}", e));
                Vec::new()
            }
        }
    }

    /// Revolve a 2D profile (flat array of [x,y,z, x,y,z, …]) around the
    /// axis `(origin, dir)` into a surface of revolution. Returns the new
    /// FaceIds in profile-major, ring-minor order, or an empty vec on
    /// failure (with `lastError` set).
    ///
    /// Profile vertex order matters — see `operations::revolve` docs.
    /// Single undo transaction wraps the whole spin.
    #[wasm_bindgen(js_name = "revolveProfile")]
    pub fn revolve_profile(
        &mut self,
        profile_flat: &[f64],
        ox: f64, oy: f64, oz: f64,
        dx: f64, dy: f64, dz: f64,
        segments: u32,
    ) -> Vec<u32> {
        if profile_flat.len() < 6 || profile_flat.len() % 3 != 0 {
            self.set_error(format!(
                "revolve: profile_flat must be a non-empty multiple of 3, got {}",
                profile_flat.len(),
            ));
            return Vec::new();
        }
        let profile: Vec<DVec3> = profile_flat.chunks_exact(3)
            .map(|c| DVec3::new(c[0], c[1], c[2]))
            .collect();
        let origin = DVec3::new(ox, oy, oz);
        let dir = DVec3::new(dx, dy, dz);
        let material = self.scene.default_material;

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.revolve(&profile, origin, dir, segments, material) {
            Ok(faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] revolve ERROR: {}", e);
                self.set_error(format!("revolve: {}", e));
                Vec::new()
            }
        }
    }

    /// Mirror the given faces across a plane. Returns the new FaceIds
    /// in the same order as the input (empty vec on failure, with
    /// `lastError()` set). Single undo transaction wraps the whole batch.
    #[wasm_bindgen(js_name = "mirrorFaces")]
    pub fn mirror_faces(
        &mut self,
        face_ids: &[u32],
        ox: f64, oy: f64, oz: f64,
        nx: f64, ny: f64, nz: f64,
    ) -> Vec<u32> {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let origin = DVec3::new(ox, oy, oz);
        let normal = DVec3::new(nx, ny, nz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.mirror_faces(&fids, origin, normal) {
            Ok(new_faces) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_faces.iter().map(|f| f.raw()).collect()
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] mirror_faces ERROR: {}", e);
                self.set_error(format!("mirror_faces: {}", e));
                Vec::new()
            }
        }
    }

    pub fn get_face_normal(&self, face_id_raw: u32) -> Vec<f64> {
        let fid = FaceId::new(face_id_raw);
        if let Some(face) = self.scene.mesh.faces.get(fid) {
            let n = face.normal();
            vec![n.x, n.y, n.z]
        } else {
            vec![0.0, 0.0, 0.0]
        }
    }

    /// Atomic "erase with auto-merge" — primary delete path for the Erase tool.
    ///
    /// For each edge in `edge_ids`:
    ///   1. First try `merge_faces_by_edge_with_tolerance`. If it succeeds the
    ///      edge and the two coplanar faces collapse to a single face.
    ///   2. If merge fails (non-coplanar, C-slit, etc.) cascade-delete the
    ///      edge plus every face touching it.
    ///
    /// After edge processing, any faces listed in `face_ids` that still exist
    /// are removed outright.
    ///
    /// **Everything runs inside a single undo transaction** so the user
    /// presses Ctrl+Z once to restore the original geometry, regardless of
    /// how many edges and faces were touched.
    ///
    /// When `cascade_only == true`, the merge step is skipped entirely —
    /// every edge goes straight to cascade-delete. This backs the Shift
    /// modifier in the Erase tool.
    ///
    /// Returns a packed `[merged, cascaded_faces, cascaded_edges]` triple
    /// (one i32 each) for the tool to surface in its Toast feedback. All
    /// values are >= 0 on success.
    /// Batch erase edges (and optional faces).
    ///
    /// For each edge:
    ///   1. cascade_only=true → force hard delete (faces destroyed).
    ///   2. else try `merge_faces_by_edge_with_tolerance`:
    ///      a) Success → two faces become one.
    ///      b) Failure (non-coplanar / non-manifold / material mismatch):
    ///         · soft_on_fail=true → mark the edge SOFT (rendering-hidden);
    ///           topology intact, two faces read as one surface.
    ///         · soft_on_fail=false → cascade-delete faces (legacy behaviour).
    ///
    /// Returns `[merged, cascaded_faces, cascaded_edges, softened]`.
    /// (Older callers that expect length 3 still work since Vec<i32> is
    /// returned — JS just reads indices it needs.)
    #[wasm_bindgen(js_name = "batchEraseEdgesWithMerge")]
    pub fn batch_erase_edges_with_merge(
        &mut self,
        face_ids: &[u32],
        edge_ids: &[u32],
        angle_tol_deg: f64,
        cascade_only: bool,
    ) -> Vec<i32> {
        // Legacy signature retained; soft_on_fail defaults to false to keep
        // current callers identical until they opt in. Use the _soft variant
        // below for the non-destructive path.
        self.batch_erase_edges_impl(face_ids, edge_ids, angle_tol_deg, cascade_only, false)
    }

    /// New variant: merge failure falls back to SOFT edge (hidden, topology
    /// preserved) instead of destroying the adjacent faces. Recommended
    /// default for interactive Erase tool.
    #[wasm_bindgen(js_name = "batchEraseEdgesSoftFallback")]
    pub fn batch_erase_edges_soft_fallback(
        &mut self,
        face_ids: &[u32],
        edge_ids: &[u32],
        angle_tol_deg: f64,
        cascade_only: bool,
    ) -> Vec<i32> {
        self.batch_erase_edges_impl(face_ids, edge_ids, angle_tol_deg, cascade_only, true)
    }

    fn batch_erase_edges_impl(
        &mut self,
        face_ids: &[u32],
        edge_ids: &[u32],
        angle_tol_deg: f64,
        cascade_only: bool,
        soft_on_fail: bool,
    ) -> Vec<i32> {
        if face_ids.is_empty() && edge_ids.is_empty() {
            return vec![0, 0, 0, 0, 0, 0];
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mut merged: i32 = 0;
        let mut cascaded_faces: i32 = 0;
        let mut cascaded_edges: i32 = 0;
        let mut softened: i32 = 0;
        let mut synthesized: i32 = 0;
        let mut desolidified: i32 = 0;
        let mut all_removed_faces: Vec<FaceId> = Vec::new();

        // ── Phase C (ADR-008 Axiom 5 — Surface↔Solid merge): snapshot which
        // connected face-components are currently closed 2-manifold solids.
        // After the erase pass we re-evaluate the same face sets and count
        // those that went from solid → open, so the JS layer can show a
        // "solid → surface" Toast.
        //
        // We snapshot by representative seed face + full component face list
        // (so after faces get removed/merged, we can rebuild the post list
        // by dropping gone faces and adding any merged survivors).
        let mut pre_solid_components: Vec<(FaceId, Vec<FaceId>)> = Vec::new();
        {
            use std::collections::HashSet as StdHashSet;
            let mut seen_seed: StdHashSet<FaceId> = StdHashSet::new();

            // Every face adjacent to any erase-target edge or direct face id.
            let mut candidate_seeds: Vec<FaceId> = Vec::new();
            for &eid_raw in edge_ids {
                let eid = EdgeId::new(eid_raw);
                if self.scene.mesh.edges.contains(eid) {
                    let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
                    candidate_seeds.extend(faces);
                }
            }
            for &fid_raw in face_ids {
                candidate_seeds.push(FaceId::new(fid_raw));
            }

            for seed in candidate_seeds {
                if !self.scene.mesh.faces.contains(seed) { continue; }
                if seen_seed.contains(&seed) { continue; }
                // BFS the connected component — use raw id path via helper.
                let component_raw = self.get_connected_faces(seed.raw());
                let component: Vec<FaceId> = component_raw.iter()
                    .map(|&r| FaceId::new(r)).collect();
                for f in &component { seen_seed.insert(*f); }
                let info = self.scene.mesh.face_set_manifold_info(&component);
                if info.is_closed_solid {
                    pre_solid_components.push((seed, component));
                }
            }
        }

        // Phase B step 2 (ADR-008 Axiom 6): pre-snapshot which edges, in the
        // neighbourhood of this erase, currently have a face on at least one
        // side. After the erase pass we will see which of those edges went
        // "face → free" (newly-freed) — those are the only edges a re-synth
        // cycle must include, which keeps the re-synthesis strictly scoped
        // to loops the erase actually opened.
        //
        // Neighbourhood = edges whose endpoint is an endpoint of any erase-
        // target edge OR an endpoint on any face-only target's boundary.
        let mut seed_verts: Vec<VertId> = Vec::new();
        for &eid_raw in edge_ids {
            let eid = EdgeId::new(eid_raw);
            if let Some(edge) = self.scene.mesh.edges.get(eid) {
                seed_verts.push(edge.v_small());
                seed_verts.push(edge.v_large());
            }
        }
        for &fid_raw in face_ids {
            let fid = FaceId::new(fid_raw);
            if let Some(face) = self.scene.mesh.faces.get(fid) {
                if let Ok(verts) = self.scene.mesh.collect_loop_verts(face.outer().start) {
                    seed_verts.extend(verts);
                }
            }
        }
        seed_verts.sort_by_key(|v| v.raw());
        seed_verts.dedup();

        // Collect neighbourhood edges (edges touching any seed vertex) that
        // are currently face-bearing. "face-bearing" = at least one of its
        // half-edges has a non-null face. These are the watch-list — later
        // we'll check which of them survive but no longer have ANY face-side.
        let mut watched_edges: Vec<EdgeId> = Vec::new();
        {
            let seed_set: HashSet<VertId> = seed_verts.iter().copied().collect();
            for (eid, edge) in self.scene.mesh.edges.iter() {
                if !edge.is_active() { continue; }
                if !edge.class().is_topological() { continue; }
                if !(seed_set.contains(&edge.v_small()) || seed_set.contains(&edge.v_large())) {
                    continue;
                }
                // At least one HE in the radial loop has a face?
                if self.edge_has_any_face(eid) {
                    watched_edges.push(eid);
                }
            }
        }

        // Capture the first merge failure for diagnostic purposes — surfaces
        // in the Erase tool's debug log so users can tell why an edge fell
        // through to cascade (e.g. "not coplanar (3.2° > 0.5° tolerance)").
        let mut first_failure_reason: Option<String> = None;

        // Edge pass — try merge first, cascade on failure.
        for &eid_raw in edge_ids {
            let eid = EdgeId::new(eid_raw);
            if !self.scene.mesh.edges.contains(eid) {
                // Already gone (earlier merge folded it in). Skip.
                continue;
            }

            if !cascade_only {
                match self.scene.mesh.merge_faces_by_edge_with_tolerance(eid, angle_tol_deg) {
                    Ok(_new_face) => {
                        merged += 1;
                        continue;
                    }
                    Err(e) => {
                        if first_failure_reason.is_none() {
                            first_failure_reason = Some(format!("edge {}: {}", eid_raw, e));
                        }
                        /* fall through to geometric fallback */
                    }
                }

                // Option X1 (2026-04-24) — geometric merge fallback.
                //
                // Standard merge_faces_by_edge rejects on:
                //   • ≠2 faces sharing the edge (snap-drift "parallel" edges)
                //   • multi-edge sharing (C-slit)
                //   • coplanarity tol miss (0.5° strict)
                // For most user-facing "두 RECT 붙여놓고 공유 엣지 삭제" cases
                // this is a false negative. Try the polygon-level merge with
                // a loosened tolerance before falling through to SOFT. If it
                // succeeds we treat the operation as merged.
                if self.scene.mesh.edges.contains(eid) {
                    let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
                    if faces.len() == 2 && faces[0] != faces[1] {
                        let geo_tol = (angle_tol_deg * 4.0).max(2.0);
                        if let Ok(_) = self.scene.mesh.merge_coplanar_faces_geometric(
                            faces[0], faces[1], geo_tol,
                        ) {
                            merged += 1;
                            // Clear the diagnostic — a successful geometric
                            //   merge is not a "failure" from the user's POV.
                            if first_failure_reason.as_ref()
                                .map(|s| s.starts_with(&format!("edge {}:", eid_raw)))
                                .unwrap_or(false)
                            {
                                first_failure_reason = None;
                            }
                            continue;
                        }
                    }
                }
            }

            // Merge failed → choose fallback based on soft_on_fail flag.
            if soft_on_fail && !cascade_only && self.scene.mesh.edges.contains(eid) {
                // Non-destructive: mark edge SOFT. Topology stays intact, two
                // faces remain but read as one surface (edge hidden in render).
                self.scene.mesh.mark_edge_soft(eid);
                softened += 1;
                continue;
            }

            // Destructive cascade-delete: remove both sharing faces + the edge.
            if self.scene.mesh.edges.contains(eid) {
                let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
                for fid in &faces { all_removed_faces.push(*fid); }
                cascaded_faces += faces.len() as i32;
                for fid in faces {
                    let _ = self.scene.mesh.remove_face(fid);
                    if self.scene.mesh.faces.contains(fid) {
                        self.scene.mesh.faces.remove(fid);
                    }
                }
                let _ = self.scene.mesh.remove_edge_and_halfedges(eid);
                if self.scene.mesh.edges.contains(eid) {
                    self.scene.mesh.edges.remove(eid);
                }
                cascaded_edges += 1;
            }
        }

        // Face-only deletions.
        for &fid_raw in face_ids {
            let fid = FaceId::new(fid_raw);
            if self.scene.mesh.faces.contains(fid) {
                all_removed_faces.push(fid);
                let _ = self.scene.mesh.remove_face(fid);
                if self.scene.mesh.faces.contains(fid) {
                    self.scene.mesh.faces.remove(fid);
                }
            }
        }

        self.scene.unregister_faces_from_xia(&all_removed_faces);
        // Phase: post-merge/erase cleanup — dangling edges (face-merged leftovers)
        //   + isolated vertices. Prevents "선의 잔재" 보고된 문제.
        let _ = self.scene.mesh.cleanup_dangling();

        // ── Phase B step 2 (ADR-008 Axiom 6): erase re-synthesis ──
        // Among the watched edges, find those that SURVIVED the erase but
        // are no longer face-bearing (they lost every face pointer). Those
        // are the "newly-freed" edges a re-synth cycle must pass through.
        // This scoping prevents:
        //   • recreating a face whose boundary edges we deliberately deleted
        //     (cascade of face+edges removes the edges entirely → not in
        //     newly_freed list)
        //   • recreating a face the user deliberately face-only-deleted
        //     (those edges are still face-bearing on the neighbour's side
        //     OR were never in the watched list if the face was isolated)
        let newly_freed: Vec<EdgeId> = watched_edges.iter()
            .copied()
            .filter(|&eid| self.scene.mesh.edges.contains(eid))
            .filter(|&eid| !self.edge_has_any_face(eid))
            .collect();
        let live_seeds: Vec<VertId> = seed_verts.iter()
            .filter(|&&v| self.scene.mesh.verts.contains(v))
            .copied()
            .collect();
        if !live_seeds.is_empty() && !newly_freed.is_empty() {
            let material = self.scene.default_material;
            let new_faces = self.scene.mesh.resolve_planar_free_faces_scoped(
                material,
                Some(&live_seeds),
                Some(&newly_freed),
            );
            if !new_faces.is_empty() {
                synthesized = new_faces.len() as i32;
                // Wrap new faces in a "Face" XIA (same pattern as
                // exec_draw_line's Step 5). Use the first face's centroid as
                // the XIA position so picking/outliner behave naturally.
                // Inline centroid of the first new face (use face start HE).
                let pos = {
                    let f0 = new_faces[0];
                    let face = self.scene.mesh.faces.get(f0);
                    let mut c = DVec3::ZERO;
                    let mut n = 0;
                    if let Some(face) = face {
                        if let Ok(verts) = self.scene.mesh.collect_loop_verts(face.outer().start) {
                            for v in &verts {
                                if let Ok(p) = self.scene.mesh.vertex_pos(*v) {
                                    c += p;
                                    n += 1;
                                }
                            }
                        }
                    }
                    if n > 0 { c / n as f64 } else { DVec3::ZERO }
                };
                self.scene.create_xia_with_faces(
                    "Face".to_string(),
                    pos,
                    new_faces,
                );
            }
        }

        // ── Phase C (ADR-008 Axiom 5): count de-solidified components ──
        // For each previously-solid component, rebuild its surviving face
        // list (exclude any face removed during this pass) and re-check. If
        // the surviving set is no longer a closed 2-manifold, that component
        // was de-solidified. The JS layer uses this count to emit a Toast
        // per ADR-008: "solid가 붕괴(de-solidify)되어 surface로 남음".
        {
            use std::collections::HashSet as StdHashSet;
            let removed_set: StdHashSet<FaceId> = all_removed_faces.iter().copied().collect();
            for (_seed, pre_faces) in &pre_solid_components {
                let survivors: Vec<FaceId> = pre_faces.iter()
                    .filter(|f| !removed_set.contains(f))
                    .filter(|f| self.scene.mesh.faces.contains(**f))
                    .copied()
                    .collect();
                if survivors.len() < 4 {
                    // Can't form a closed solid below tetrahedron.
                    desolidified += 1;
                    continue;
                }
                let info = self.scene.mesh.face_set_manifold_info(&survivors);
                if !info.is_closed_solid {
                    desolidified += 1;
                }
            }
        }

        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();

        // Save first failure so JS can fetch it via `lastMergeFailureReason()`.
        // (We don't overload the numeric return to keep the happy path small.)
        if let Some(reason) = first_failure_reason {
            self.last_merge_failure = reason;
        } else {
            self.last_merge_failure.clear();
        }

        vec![merged, cascaded_faces, cascaded_edges, softened, synthesized, desolidified]
    }

    /// Diagnostic — first merge failure reason from the most recent
    /// `batchEraseEdgesWithMerge` call. Empty string if no failure or no
    /// call yet. Intended for the debug-mode Toast in the Erase tool.
    #[wasm_bindgen(js_name = "lastMergeFailureReason")]
    pub fn last_merge_failure_reason(&self) -> String {
        self.last_merge_failure.clone()
    }

    // ========================================================================
    // ADR-009 — Orphan Face Recovery
    // ========================================================================

    /// Read-only classifier. Returns JSON-serialised `OrphanReport`.
    /// See ADR-009 for category definitions (C1 / C2 / C3).
    #[wasm_bindgen(js_name = "classifyOrphans")]
    pub fn classify_orphans(&self) -> String {
        let report = self.scene.classify_orphans();
        serde_json::to_string(&report).unwrap_or_else(|e| {
            format!("{{\"error\":\"{}\"}}", e)
        })
    }

    /// Apply or preview an orphan-recovery plan. Wrapped in a single undo
    /// frame on apply; preview rolls back to the exact prior snapshot.
    ///
    /// `plan_json` — `RecoveryPlan` serialised as JSON.
    /// `dry_run`   — true = preview (always rolls back); false = apply.
    ///
    /// Returns `RecoveryResult` serialised as JSON.
    #[wasm_bindgen(js_name = "applyOrphanRecovery")]
    pub fn apply_orphan_recovery(&mut self, plan_json: &str, dry_run: bool) -> String {
        let plan: RecoveryPlan = match serde_json::from_str(plan_json) {
            Ok(p) => p,
            Err(e) => return format!("{{\"error\":\"invalid plan JSON: {}\"}}", e),
        };

        if dry_run {
            let result = self.scene.preview_orphan_recovery(&plan);
            self.mark_topology_changed();
            self.invalidate_cache();
            return serde_json::to_string(&result).unwrap_or_default();
        }

        // Apply — single undo frame.
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let result = self.scene.apply_orphan_recovery(&plan);
        if result.error.is_some() {
            self.scene.transactions.cancel();
        } else {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
        }
        self.mark_topology_changed();
        self.invalidate_cache();
        serde_json::to_string(&result).unwrap_or_default()
    }

    /// Phase D (ADR-008 Axiom 9 row 3): forced polygon-mesh merge.
    ///
    /// For 2+ faces the user selected and explicitly asked to "merge" even
    /// though they are not coplanar, we don't actually fuse them into a
    /// single polygon (that would require non-planar face regions, which
    /// violates ADR-007's Invariant 3). Instead we identify every edge
    /// interior to the selection — edges whose radial loop contains two or
    /// more of the selected faces — and mark those edges SOFT. The faces
    /// stay distinct topologically, but the renderer hides the internal
    /// seams so the selection reads as one continuous smooth surface.
    ///
    /// Returns the number of edges softened. Wrapped in a single undo
    /// transaction. If fewer than two selected faces share any edge, the
    /// return value is 0 (caller can surface a Toast).
    #[wasm_bindgen(js_name = "softenInternalEdges")]
    pub fn soften_internal_edges(&mut self, face_ids: &[u32]) -> i32 {
        use std::collections::HashSet as StdHashSet;
        if face_ids.len() < 2 { return 0; }
        let selected: StdHashSet<FaceId> = face_ids.iter()
            .map(|&r| FaceId::new(r))
            .filter(|f| self.scene.mesh.faces.contains(*f))
            .collect();
        if selected.len() < 2 { return 0; }

        // Find every edge where ≥2 of the selected faces meet. Walk the
        // radial loop for every active topological edge once.
        let candidate_edges: Vec<EdgeId> = self.scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.class().is_topological())
            .map(|(id, _)| id)
            .collect();

        let mut to_soften: Vec<EdgeId> = Vec::new();
        for eid in candidate_edges {
            let Some(edge) = self.scene.mesh.edges.get(eid) else { continue; };
            let start = edge.any_he();
            if start.is_null() { continue; }
            let mut count = 0usize;
            let mut he = start;
            loop {
                match self.scene.mesh.hes.get(he) {
                    Some(h) => {
                        let f = h.face();
                        if !f.is_null() && selected.contains(&f) {
                            count += 1;
                            if count >= 2 { break; }
                        }
                        let next = h.next_rad();
                        if next.is_null() || next == start { break; }
                        he = next;
                    }
                    None => break,
                }
            }
            if count >= 2 {
                to_soften.push(eid);
            }
        }

        if to_soften.is_empty() { return 0; }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        for eid in &to_soften {
            self.scene.mesh.mark_edge_soft(*eid);
        }
        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();
        to_soften.len() as i32
    }

    /// DCEL 위상(topology) 기반으로 seedFace에 연결된 모든 face를 BFS 탐색.
    /// half-edge의 radial partner(next_rad)를 통해 edge를 공유하는 인접 face를 찾습니다.
    /// 좌표 비교 없이 순수 위상 구조만 사용 → 다른 Volume의 face가 섞이지 않음.
    pub fn get_connected_faces(&self, seed_face_raw: u32) -> Vec<u32> {
        use std::collections::{HashSet, VecDeque};

        let seed = FaceId::new(seed_face_raw);
        let mesh = &self.scene.mesh;

        if !mesh.faces.contains(seed) {
            return vec![];
        }

        let mut visited: HashSet<FaceId> = HashSet::new();
        let mut queue: VecDeque<FaceId> = VecDeque::new();
        visited.insert(seed);
        queue.push_back(seed);

        while let Some(current) = queue.pop_front() {
            let face = match mesh.faces.get(current) {
                Some(f) => f,
                None => continue,
            };

            // 외곽 루프의 half-edge를 순회
            let outer_start = face.outer().start;
            if outer_start.is_null() { continue; }

            let mut he_id = outer_start;
            loop {
                // radial 체인 전체를 순회하여 공유 edge의 모든 인접 face 탐색
                // (find_halfedge가 non-manifold edge에 HE 쌍을 삽입하므로
                //  체인이 2개 이상일 수 있음: bottom_he → side_fwd → side_bwd → bottom_he)
                let mut rad_id = mesh.hes[he_id].next_rad();
                while rad_id != he_id {
                    let rad_face = mesh.hes[rad_id].face();
                    if !rad_face.is_null() && !visited.contains(&rad_face) {
                        if mesh.faces.contains(rad_face) {
                            visited.insert(rad_face);
                            queue.push_back(rad_face);
                        }
                    }
                    rad_id = mesh.hes[rad_id].next_rad();
                }

                he_id = mesh.hes[he_id].next();
                if he_id == outer_start { break; }
            }

            // inner loops (holes)도 순회
            for inner_loop in face.inners() {
                let inner_start = inner_loop.start;
                if inner_start.is_null() { continue; }
                let mut ihe = inner_start;
                loop {
                    let mut rad_id = mesh.hes[ihe].next_rad();
                    while rad_id != ihe {
                        let rad_face = mesh.hes[rad_id].face();
                        if !rad_face.is_null() && !visited.contains(&rad_face) {
                            if mesh.faces.contains(rad_face) {
                                visited.insert(rad_face);
                                queue.push_back(rad_face);
                            }
                        }
                        rad_id = mesh.hes[rad_id].next_rad();
                    }
                    ihe = mesh.hes[ihe].next();
                    if ihe == inner_start { break; }
                }
            }
        }

        visited.into_iter().map(|f| f.raw()).collect()
    }

    pub fn get_stats(&self) -> String {
        let stats = self.scene.stats();
        format!(
            r#"{{"xias":{},"verts":{},"edges":{},"faces":{},"groups":{},"components":{},"canUndo":{},"canRedo":{}}}"#,
            stats.xia_count,
            stats.vert_count,
            stats.edge_count,
            stats.face_count,
            stats.group_count,
            stats.component_count,
            stats.can_undo,
            stats.can_redo,
        )
    }

    pub fn vert_count(&self) -> usize {
        self.scene.mesh.vert_count()
    }

    pub fn face_count(&self) -> usize {
        self.scene.mesh.face_count()
    }

    // ========================================================================
    // XIA Inspector — 선택된 face들의 기하학적/물리적 속성 계산
    // ========================================================================

    /// ⚠️ **파라미터는 FACE IDs** (XIA IDs 아님). XIA Inspector가 선택된 면들의
    /// 집계 속성을 계산하기 위한 함수. 이름의 "xia"는 "XIA 관점의 속성"이라는 뜻.
    ///
    /// - 입력: 선택된 face ID 배열
    /// - 출력 JSON: { isSolid, bbox{minX..maxZ}, length, width, height,
    ///   surfaceArea, volume, faceCount, vertCount, edgeCount, snapPoints, shapeType }
    ///
    /// 특정 XIA 하나의 정보가 필요하면 먼저 `get_xia_face(xia_id)`로 대표 face를 얻은
    /// 뒤 그 XIA의 모든 face_ids를 수집해 이 함수에 전달하거나, 새 `get_xia_stats` 사용.
    pub fn get_xia_info(&self, face_ids_raw: &[u32]) -> String {
        use std::collections::HashSet;

        let mesh = &self.scene.mesh;

        if face_ids_raw.is_empty() {
            return r#"{"empty":true}"#.to_string();
        }

        let face_ids: Vec<axia_geo::FaceId> = face_ids_raw.iter()
            .map(|&id| axia_geo::FaceId::new(id))
            .filter(|fid| mesh.faces.contains(*fid))
            .collect();

        if face_ids.is_empty() {
            return r#"{"empty":true}"#.to_string();
        }

        // ── 1. 모든 정점 수집 + Bounding Box ──
        let mut all_verts = HashSet::new();
        let mut all_edges = HashSet::new();
        let mut min_pt = DVec3::new(f64::MAX, f64::MAX, f64::MAX);
        let mut max_pt = DVec3::new(f64::MIN, f64::MIN, f64::MIN);

        for &fid in &face_ids {
            let outer_start = mesh.faces[fid].outer().start;
            if outer_start.is_null() { continue; }
            if let Ok(verts) = mesh.collect_loop_verts(outer_start) {
                for &vid in &verts {
                    all_verts.insert(vid);
                    if let Ok(p) = mesh.vertex_pos(vid) {
                        min_pt = DVec3::new(min_pt.x.min(p.x), min_pt.y.min(p.y), min_pt.z.min(p.z));
                        max_pt = DVec3::new(max_pt.x.max(p.x), max_pt.y.max(p.y), max_pt.z.max(p.z));
                    }
                }
            }
            if let Ok(hes) = mesh.collect_loop_hes(outer_start) {
                for &he_id in &hes {
                    all_edges.insert(mesh.hes[he_id].edge());
                }
            }
        }

        let dx = max_pt.x - min_pt.x;
        let dy = max_pt.y - min_pt.y;
        let dz = max_pt.z - min_pt.z;

        // 길이/너비/높이: 큰 순서대로 정렬
        let mut dims = [dx, dy, dz];
        dims.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
        let length = dims[0];
        let width  = dims[1];
        let height = dims[2];

        // ── 2. 표면적 계산 ──
        let mut surface_area = 0.0_f64;
        for &fid in &face_ids {
            let outer_start = mesh.faces[fid].outer().start;
            if outer_start.is_null() { continue; }
            if let Ok(verts) = mesh.collect_loop_verts(outer_start) {
                // Shoelace formula for polygon area (3D)
                if verts.len() >= 3 {
                    let mut area_vec = DVec3::ZERO;
                    let p0 = mesh.vertex_pos(verts[0]).unwrap_or(DVec3::ZERO);
                    for i in 1..verts.len() - 1 {
                        let p1 = mesh.vertex_pos(verts[i]).unwrap_or(DVec3::ZERO);
                        let p2 = mesh.vertex_pos(verts[i + 1]).unwrap_or(DVec3::ZERO);
                        area_vec += (p1 - p0).cross(p2 - p0);
                    }
                    surface_area += area_vec.length() * 0.5;
                }
            }
        }

        // ── 3. 부피 계산 (signed volume via divergence theorem) ──
        // 닫힌 메시의 경우만 정확, 열린 메시는 근사치
        let mut volume = 0.0_f64;
        for &fid in &face_ids {
            let outer_start = mesh.faces[fid].outer().start;
            if outer_start.is_null() { continue; }
            if let Ok(verts) = mesh.collect_loop_verts(outer_start) {
                if verts.len() >= 3 {
                    let p0 = mesh.vertex_pos(verts[0]).unwrap_or(DVec3::ZERO);
                    for i in 1..verts.len() - 1 {
                        let p1 = mesh.vertex_pos(verts[i]).unwrap_or(DVec3::ZERO);
                        let p2 = mesh.vertex_pos(verts[i + 1]).unwrap_or(DVec3::ZERO);
                        // Signed volume of tetrahedron with origin
                        volume += p0.dot(p1.cross(p2));
                    }
                }
            }
        }
        volume = (volume / 6.0).abs();

        // ── 4. Boundary Extraction — manifold 분석 (axia-geo 공통 유틸) ──
        // 모든 edge가 정확히 2개의 선택된 face를 공유하면 닫힌 2-manifold 솔리드.
        // boundary_edges > 0: open (hole), non_manifold > 0: T-junction 등 결함.
        let manifold = mesh.face_set_manifold_info(&face_ids);
        let is_solid = manifold.is_closed_solid;

        // ── 5. 형상 유형 판별 ──
        let shape_type = if !is_solid {
            if face_ids.len() == 1 { "면" } else { "면 그룹" }
        } else if face_ids.len() == 6 {
            // 6면 + 8정점 = 직사각형
            if all_verts.len() == 8 { "직사각형" } else { "다면체" }
        } else if face_ids.len() >= 20 {
            "원기둥/원뿔"
        } else {
            "다면체"
        };

        // ── 6. 스냅 포인트 수 = 정점 + edge 중점 ──
        let snap_points = all_verts.len() + all_edges.len();

        // ── 7. 재질 정보: 선택된 face들의 공통 재질 ──
        let mut common_mat: Option<u32> = None;
        let mut all_same = true;
        for fid in &face_ids {
            if let Some(face) = self.scene.mesh.faces.get(*fid) {
                let mid = face.material().raw();
                match common_mat {
                    None => common_mat = Some(mid),
                    Some(prev) => if prev != mid { all_same = false; break; }
                }
            }
        }
        let mat_id_val = if all_same { common_mat.unwrap_or(0) } else { 0 };
        let has_material = all_same && mat_id_val > 0;

        // mm 단위 기준
        format!(
            r#"{{"empty":false,"isSolid":{},"boundaryEdges":{},"nonManifoldEdges":{},"interiorEdges":{},"shapeType":"{}","faceCount":{},"vertCount":{},"edgeCount":{},"snapPoints":{},"minX":{:.4},"minY":{:.4},"minZ":{:.4},"maxX":{:.4},"maxY":{:.4},"maxZ":{:.4},"length":{:.4},"width":{:.4},"height":{:.4},"surfaceArea":{:.6},"volume":{:.6},"materialId":{},"hasMaterial":{}}}"#,
            is_solid,
            manifold.boundary_edge_count,
            manifold.non_manifold_edge_count,
            manifold.interior_edge_count,
            shape_type,
            face_ids.len(),
            all_verts.len(),
            all_edges.len(),
            snap_points,
            min_pt.x, min_pt.y, min_pt.z,
            max_pt.x, max_pt.y, max_pt.z,
            length, width, height,
            surface_area,
            volume,
            mat_id_val,
            has_material,
        )
    }

    // ========================================================================
    // Project Save/Load (.axia)
    // ========================================================================

    /// 프로젝트 데이터를 바이너리 스냅샷으로 내보내기 (versioned format with magic bytes)
    pub fn export_snapshot(&self) -> Vec<u8> {
        match self.scene.export_versioned_snapshot() {
            Ok(data) => {
                debug_log!("[RUST] export_snapshot: {} bytes", data.len());
                data
            }
            Err(e) => {
                console_error!("[RUST] export_snapshot ERROR: {}", e);
                Vec::new()
            }
        }
    }

    /// ADR-007 Phase 5 — 엄격 export: invariant 위반 시 빈 배열 반환 + lastError 설정.
    /// 파일 저장 대화창 등에서 데이터 무결성이 중요한 경우 사용.
    #[wasm_bindgen(js_name = "exportSnapshotStrict")]
    pub fn export_snapshot_strict(&mut self) -> Vec<u8> {
        match self.scene.export_versioned_snapshot_strict() {
            Ok(data) => data,
            Err(e) => {
                console_error!("[RUST] export_snapshot_strict ERROR: {}", e);
                self.set_error(e.to_string());
                Vec::new()
            }
        }
    }

    /// Phase H5 — 자유 엣지 → Face Synthesis (사용자 수동 트리거).
    ///
    /// 닫힌 polygon을 이루는 free edges를 감지해 face로 전환.
    /// 2D DXF 도면 import 후 "평면도 → 면 생성"에 유용.
    ///
    /// **사용자 명시 호출만** — import 직후 자동 실행 안 함 (의도 왜곡 방지).
    ///
    /// 반환: 생성된 face 개수 (감지 실패 / 이미 face로 처리됨 시 0)
    #[wasm_bindgen(js_name = "synthesizeFacesFromFreeEdges")]
    pub fn synthesize_faces_from_free_edges(&mut self) -> u32 {
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let material = self.scene.default_material;
        let created = self.scene.mesh.resolve_planar_free_faces(material);

        if !created.is_empty() {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            self.scene.transactions.cancel();
        }

        debug_log!("[RUST] synthesizeFacesFromFreeEdges: {} faces", created.len());
        created.len() as u32
    }

    /// Draw a centerline (reference axis). Unlike drawLine, bypasses
    /// intersection-split / face synthesis / loop detection. Creates one
    /// edge tagged Centerline; crossing other edges does not split them.
    /// Returns the new edge raw id, or -1 on failure.
    #[wasm_bindgen(js_name = "drawCenterline")]
    pub fn draw_centerline(
        &mut self,
        x0: f64, y0: f64, z0: f64,
        x1: f64, y1: f64, z1: f64,
    ) -> i32 {
        let cmd = axia_core::commands::Command::DrawCenterline {
            start: DVec3::new(x0, y0, z0),
            end:   DVec3::new(x1, y1, z1),
        };
        match self.scene.execute(cmd) {
            axia_core::commands::CommandResult::EntityCreated(eid) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                eid as i32
            }
            axia_core::commands::CommandResult::Error(msg) => {
                self.set_error(format!("draw_centerline: {}", msg));
                -1
            }
            _ => -1,
        }
    }

    /// Get an edge's semantic class as u32 (0=Geometry, 1=Centerline).
    /// Returns 0 for missing/inactive edges (safe default).
    #[wasm_bindgen(js_name = "edgeClass")]
    pub fn edge_class(&self, edge_id_raw: u32) -> u32 {
        let eid = axia_geo::EdgeId::new(edge_id_raw);
        self.scene.mesh.edges.get(eid)
            .map(|e| e.class().to_raw())
            .unwrap_or(0)
    }

    /// Change an edge's semantic class. Rejects Geometry→Centerline if the
    /// edge bounds an active face (would orphan the face).
    /// Returns true on success.
    #[wasm_bindgen(js_name = "setEdgeClass")]
    pub fn set_edge_class(&mut self, edge_id_raw: u32, class_raw: u32) -> bool {
        let cmd = axia_core::commands::Command::SetEdgeClass {
            edge_id: axia_geo::EdgeId::new(edge_id_raw),
            class_raw,
        };
        match self.scene.execute(cmd) {
            axia_core::commands::CommandResult::MeshUpdated => {
                self.invalidate_cache();
                true
            }
            axia_core::commands::CommandResult::Error(msg) => {
                self.set_error(format!("set_edge_class: {}", msg));
                false
            }
            _ => false,
        }
    }

    /// 엣지 가시성 임계 각도(도) 조회. StylePanel 슬라이더 초기화에 사용.
    #[wasm_bindgen(js_name = "edgeAngleThreshold")]
    pub fn edge_angle_threshold(&self) -> f64 {
        self.edge_angle_threshold_deg
    }

    /// 엣지 가시성 임계 각도(도) 설정. 범위 [1.0, 89.0]로 clamp.
    /// 변경 시 edge cache 무효화 → 다음 getEdgeLines 호출에 반영.
    /// 작은 값: 모든 panel 경계가 보임 (건축/기계 CAD 선호).
    /// 큰 값: 부드러운 곡면 유지 (캐릭터 모델 선호).
    #[wasm_bindgen(js_name = "setEdgeAngleThreshold")]
    pub fn set_edge_angle_threshold(&mut self, deg: f64) {
        let clamped = deg.max(1.0).min(89.0);
        if (clamped - self.edge_angle_threshold_deg).abs() > 1e-6 {
            self.edge_angle_threshold_deg = clamped;
            self.cache_dirty = true;
        }
    }

    /// 태양 방향으로 ground(y=0)에 투영된 shadow polygon triangle buffer 반환.
    /// TS Viewport는 이 buffer를 BufferGeometry에 직접 세팅해 dark translucent
    /// mesh로 렌더. 매 syncMesh마다 재계산 (mesh 변경 시 shadow도 즉시 반영).
    ///
    /// sun_dir 컴포넌트: x, y, z. 라이트 진행 방향이며 y는 음수여야 함
    /// (태양이 아래로 비춤). 정규화는 caller가 미리 해도 Rust가 해도 OK —
    /// 내부에서 사용 전 normalize 호출.
    ///
    /// 9 f32 = 1 triangle, 각 vertex는 (x, 0, z).
    #[wasm_bindgen(js_name = "computeGroundProjectedShadows")]
    pub fn compute_ground_projected_shadows(
        &self,
        sun_x: f64,
        sun_y: f64,
        sun_z: f64,
    ) -> Vec<f32> {
        let sun = DVec3::new(sun_x, sun_y, sun_z);
        if sun.length_squared() < 1e-6 { return Vec::new(); }
        let sun_norm = sun.normalize();
        self.scene.mesh.compute_ground_projected_shadows(sun_norm)
    }

    /// Analyse the whole active mesh for solid-closure status.
    /// Returns JSON: {face_count, interior_edge_count, boundary_edge_count,
    ///                non_manifold_edge_count, is_closed_solid}.
    /// Used by the Solidify action to report before/after state to the user.
    #[wasm_bindgen(js_name = "meshManifoldInfo")]
    pub fn mesh_manifold_info(&self) -> String {
        let all_faces: Vec<FaceId> = self.scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, _)| id)
            .collect();
        let info = self.scene.mesh.face_set_manifold_info(&all_faces);
        format!(
            "{{\"face_count\":{},\"interior_edge_count\":{},\"boundary_edge_count\":{},\"non_manifold_edge_count\":{},\"is_closed_solid\":{}}}",
            info.face_count,
            info.interior_edge_count,
            info.boundary_edge_count,
            info.non_manifold_edge_count,
            info.is_closed_solid,
        )
    }

    /// Phase H5 — 자유 엣지 개수만 카운트 (dry-run, mesh 불변).
    /// UI에서 "N개 자유 엣지 발견 — Face Synthesis 실행?" 안내에 사용.
    ///
    /// Centerline 엣지는 제외 — 얘네는 "free" 상태로 있는 게 정상이므로
    /// Finish→Extrude 트리거에 영향 주지 않아야 함.
    #[wasm_bindgen(js_name = "countFreeEdges")]
    pub fn count_free_edges(&self) -> u32 {
        let mut count = 0u32;
        for (_, he) in self.scene.mesh.hes.iter() {
            if !he.is_active() || !he.face().is_null() { continue; }
            let is_topo = self.scene.mesh.edges.get(he.edge())
                .map(|e| e.class().is_topological())
                .unwrap_or(false);
            if is_topo { count += 1; }
        }
        // HE 한 쌍 (twin)이 모두 face null이면 엣지 2번 카운트됨 → 반으로
        count / 2
    }

    /// Phase H — Import Normalizer 실행 (ADR-007 Barrier).
    ///
    /// 외부 파일에서 들어온 mesh 데이터를 AXiA 네이티브 규칙에 맞춰 정리.
    /// 반환: JSON 리포트 {degenerateRemoved, windingFlipped, normalsRecomputed,
    ///                    isolatedVertsRemoved, remainingViolations}
    ///
    /// `options_json`: {remove_degenerate, normalize_winding, recompute_normals,
    ///                  remove_isolated_verts, degenerate_tolerance}
    ///                 — 생략/빈문자면 기본값 사용.
    #[wasm_bindgen(js_name = "normalizeForImport")]
    pub fn normalize_for_import(&mut self, options_json: String) -> String {
        use axia_geo::NormalizeOptions;
        let opts: NormalizeOptions = if options_json.is_empty() || options_json == "{}" {
            NormalizeOptions::default()
        } else {
            // 간단 파싱 — 필요한 필드만 추출
            let mut o = NormalizeOptions::default();
            if options_json.contains("\"remove_degenerate\":false") { o.remove_degenerate = false; }
            if options_json.contains("\"normalize_winding\":false") { o.normalize_winding = false; }
            if options_json.contains("\"recompute_normals\":false") { o.recompute_normals = false; }
            if options_json.contains("\"remove_isolated_verts\":false") { o.remove_isolated_verts = false; }
            o
        };

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let report = self.scene.mesh.normalize_for_import(&opts);
        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();

        debug_log!("[RUST] normalizeForImport: {}", report.summary());

        format!(
            r#"{{"degenerateRemoved":{},"windingFlipped":{},"normalsRecomputed":{},"isolatedVertsRemoved":{},"remainingViolations":{}}}"#,
            report.degenerate_removed,
            report.winding_flipped,
            report.normals_recomputed,
            report.isolated_verts_removed,
            report.remaining_violations,
        )
    }

    /// ADR-007 원칙 1 확장 — 닫힌 solid의 outward normal 검증.
    /// 반환 JSON: {isClosedSolid, checkedFaces, inwardCount, inwardFaces[]}
    #[wasm_bindgen(js_name = "verifyOutwardNormals")]
    pub fn verify_outward_normals(&self) -> String {
        let report = self.scene.mesh.verify_outward_normals();
        let ids_json: Vec<String> = report.inward_faces.iter()
            .map(|f| f.raw().to_string())
            .collect();
        format!(
            r#"{{"isClosedSolid":{},"checkedFaces":{},"inwardCount":{},"inwardFaces":[{}]}}"#,
            report.is_closed_solid,
            report.checked_faces,
            report.inward_count,
            ids_json.join(","),
        )
    }

    /// 마지막 verify_face_invariants 결과를 요약 JSON으로 반환.
    /// UI에서 "정합성 검사" 버튼에 바인딩.
    /// ADR-007 Rev 2 — face 가 닫힌 볼륨의 일원(Wall)인지 stand-alone
    /// sheet 인지 판정. 렌더러가 sheet 는 양면, wall 은 single-sided
    /// 로 표시하는데 사용.
    #[wasm_bindgen(js_name = "isFaceInVolume")]
    pub fn is_face_in_volume(&self, face_id_raw: u32) -> bool {
        self.scene.mesh.is_face_in_volume(FaceId::new(face_id_raw))
    }

    /// ADR-007 Rev 2 — 모든 active face 의 분류를 비트 array (Uint8) 로
    /// 일괄 반환. 인덱스는 mesh buffer 의 face_map 슬롯과 1:1 매핑이
    /// 아니라 raw FaceId 와 1:1. 호출자(Viewport.syncMesh)는 face_map
    /// 으로 lookup 하면 됨.
    ///
    /// 반환: 활성 face 마다 1 = Wall, 0 = Sheet.
    /// 길이 = max active FaceId raw + 1 (편의상 sparse vec).
    #[wasm_bindgen(js_name = "getFaceVolumeFlags")]
    pub fn get_face_volume_flags(&self) -> Vec<u8> {
        let mut max_raw = 0u32;
        for (fid, _f) in self.scene.mesh.faces.iter() {
            if fid.raw() > max_raw { max_raw = fid.raw(); }
        }
        let mut out = vec![0u8; (max_raw as usize) + 1];
        for (fid, f) in self.scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if self.scene.mesh.is_face_in_volume(fid) {
                out[fid.raw() as usize] = 1;
            }
        }
        out
    }

    #[wasm_bindgen(js_name = "verifyInvariants")]
    pub fn verify_invariants(&self) -> String {
        let report = self.scene.mesh.verify_face_invariants();
        let violations_json: Vec<String> = report.violations.iter()
            .map(|v| format!("{:?}", v))
            .collect();
        format!(
            r#"{{"checkedFaces":{},"valid":{},"violationCount":{},"violations":[{}]}}"#,
            report.checked_faces,
            report.is_valid(),
            report.violations.len(),
            violations_json.join(","),
        )
    }

    /// 바이너리 스냅샷으로부터 프로젝트 복원 (supports versioned and legacy formats)
    pub fn import_snapshot(&mut self, data: &[u8]) -> bool {
        match self.scene.import_versioned_snapshot(data) {
            Ok(()) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                debug_log!("[RUST] import_snapshot: verts={} faces={}",
                    self.scene.mesh.vert_count(), self.scene.mesh.face_count());
                true
            }
            Err(e) => {
                console_error!("[RUST] import_snapshot ERROR: {}", e);
                false
            }
        }
    }

    /// Orient all faces for consistent normals.
    /// Returns number of faces flipped.
    pub fn orient_faces(&mut self) -> usize {
        let (flipped, visited) = self.scene.orient_faces();
        debug_log!("[RUST] orient_faces: flipped={} visited={}", flipped, visited);
        self.mark_topology_changed();
        self.invalidate_cache();
        flipped
    }

    /// **User-triggered Face Reverse** (SketchUp "Reverse Faces").
    ///
    /// Flips orientation of the given faces. Locked (inside grouped/component)
    /// faces are silently skipped. Wrapped in a single undo transaction so the
    /// whole batch restores with one Ctrl+Z.
    ///
    /// Returns the count of faces actually flipped.
    #[wasm_bindgen(js_name = "flipFaces")]
    pub fn flip_faces(&mut self, face_ids: Vec<u32>) -> u32 {
        if face_ids.is_empty() {
            return 0;
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        // 잠긴(locked) 면 스킵 — 그룹/컴포넌트 보호
        let fids: Vec<FaceId> = face_ids
            .iter()
            .map(|&id| FaceId::new(id))
            .filter(|fid| !self.scene.is_face_locked(*fid))
            .collect();

        let skipped = face_ids.len() - fids.len();
        let flipped = self.scene.mesh.flip_faces(&fids);

        debug_log!(
            "[RUST] flip_faces: requested={}, skipped_locked={}, flipped={}",
            face_ids.len(), skipped, flipped
        );

        if flipped > 0 {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            // 아무것도 뒤집히지 않음 — 트랜잭션 취소해 undo 스택 오염 방지
            self.scene.transactions.cancel();
            if skipped > 0 {
                self.set_error(format!("{}개 면이 잠겨있어 반전 불가", skipped));
            }
        }

        flipped as u32
    }

    // ========================================================================
    // Face Merge
    // ========================================================================

    /// Merge the two coplanar faces sharing the given edge into a single face.
    ///
    /// - Success: returns the new merged FaceId (>= 0).
    /// - Failure: returns -1 and sets lastError (e.g. "not coplanar",
    ///   "shares multiple edges", "edge not shared by exactly 2 faces").
    ///
    /// Wrapped in a single undo transaction.
    #[wasm_bindgen(js_name = "mergeFacesByEdge")]
    pub fn merge_faces_by_edge(&mut self, edge_id_raw: u32) -> i32 {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            self.set_error(format!("Edge {} not found", edge_id_raw));
            return -1;
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.merge_faces_by_edge(eid) {
            Ok(new_face) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                debug_log!("[RUST] merge_faces_by_edge: ok, new face = {:?}", new_face);
                new_face.raw() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                let msg = e.to_string();
                console_error!("[RUST] merge_faces_by_edge error: {}", msg);
                self.set_error(msg);
                -1
            }
        }
    }

    /// 2026-04-24 — Geometric merge of two coplanar adjacent faces even when
    /// they don't share an exact DCEL edge (different-sized boundaries).
    /// Used by the "두 면 기하 병합" menu action when user selects 2 faces.
    #[wasm_bindgen(js_name = "mergeCoplanarFacesGeometric")]
    pub fn merge_coplanar_faces_geometric(
        &mut self,
        f1_raw: u32,
        f2_raw: u32,
        angle_tol_deg: f64,
    ) -> i32 {
        let f1 = FaceId::new(f1_raw);
        let f2 = FaceId::new(f2_raw);
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        match self.scene.mesh.merge_coplanar_faces_geometric(f1, f2, angle_tol_deg) {
            Ok(new_face) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_face.raw() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                let msg = e.to_string();
                self.set_error(msg);
                -1
            }
        }
    }

    /// Phase F — 비인접 coplanar 포함 병합 (ADR-006 C1).
    /// outer_face 안에 inner_face가 완전히 들어 있으면 inner를 hole로 합침.
    /// Returns new face ID, or -1 on failure (lastError set).
    #[wasm_bindgen(js_name = "mergeCoplanarContaining")]
    pub fn merge_coplanar_containing(
        &mut self,
        outer_face_raw: u32,
        inner_face_raw: u32,
        angle_tol_deg: f64,
    ) -> i32 {
        let o = FaceId::new(outer_face_raw);
        let i = FaceId::new(inner_face_raw);
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        match self.scene.mesh.merge_coplanar_containing(o, i, angle_tol_deg) {
            Ok(new_face) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_face.raw() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(e.to_string());
                -1
            }
        }
    }

    /// Tolerance 지정 단일 엣지 병합 (B1).
    /// `angle_tol_deg` — 허용 각도 (°). 기본 0.5° (strict). 관대하게는 2~5°.
    #[wasm_bindgen(js_name = "mergeFacesByEdgeTol")]
    pub fn merge_faces_by_edge_tol(&mut self, edge_id_raw: u32, angle_tol_deg: f64) -> i32 {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            self.set_error(format!("Edge {} not found", edge_id_raw));
            return -1;
        }
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        match self.scene.mesh.merge_faces_by_edge_with_tolerance(eid, angle_tol_deg) {
            Ok(new_face) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                new_face.raw() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(e.to_string());
                -1
            }
        }
    }

    /// Tolerance 지정 인접 면 반복 병합 (B1).
    #[wasm_bindgen(js_name = "tryMergeAdjacentFacesTol")]
    pub fn try_merge_adjacent_faces_tol(&mut self, face_ids: Vec<u32>, angle_tol_deg: f64) -> u32 {
        if face_ids.len() < 2 {
            self.set_error("Need 2+ faces".to_string());
            return 0;
        }
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mut current: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let mut merges_done: u32 = 0;

        loop {
            let mut edge_to_faces: std::collections::HashMap<EdgeId, Vec<FaceId>> =
                std::collections::HashMap::new();
            for &fid in &current {
                let f = match self.scene.mesh.faces.get(fid) {
                    Some(f) if f.is_active() => f,
                    _ => continue,
                };
                let start = f.outer().start;
                if start.is_null() { continue; }
                if let Ok(hes) = self.scene.mesh.collect_loop_hes(start) {
                    for he in hes {
                        let e = self.scene.mesh.hes[he].edge();
                        edge_to_faces.entry(e).or_default().push(fid);
                    }
                }
            }
            let mut candidate: Option<(EdgeId, FaceId, FaceId)> = None;
            for (e, faces) in edge_to_faces.iter() {
                if faces.len() == 2 && faces[0] != faces[1] {
                    candidate = Some((*e, faces[0], faces[1]));
                    break;
                }
            }
            let (edge_id, f1, f2) = match candidate {
                Some(v) => v,
                None => break,
            };
            match self.scene.mesh.merge_faces_by_edge_with_tolerance(edge_id, angle_tol_deg) {
                Ok(new_face) => {
                    merges_done += 1;
                    current.retain(|&x| x != f1 && x != f2);
                    current.push(new_face);
                }
                Err(_) => {
                    current.retain(|&x| x != f2);
                }
            }
        }

        if merges_done > 0 {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            self.scene.transactions.cancel();
            self.set_error("No coplanar adjacent faces to merge".to_string());
        }
        merges_done
    }

    /// Dry-run analysis of merge candidates — does NOT mutate the mesh.
    ///
    /// For each pair of faces in the selection that shares an edge, checks:
    ///   - shared edge count (must be 1)
    ///   - coplanarity (strict tolerance)
    ///
    /// Returns JSON:
    ///   {
    ///     "total": N,                 // pairs sharing any edge
    ///     "mergeable": M,             // pairs passing both checks
    ///     "nonCoplanar": K,           // pairs sharing 1 edge but not coplanar
    ///     "ambiguous": L,             // pairs sharing >1 edge
    ///     "estMergesAfterCascade": E  // upper bound of final merge count
    ///   }
    ///
    /// `estMergesAfterCascade` approximates how many merges would happen if
    /// the user proceeded with `tryMergeAdjacentFaces` — each merge can enable
    /// new adjacencies so the exact count is not known without running it.
    /// The upper bound = min(mergeable, face_count - 1).
    #[wasm_bindgen(js_name = "analyzeMergeCandidates")]
    pub fn analyze_merge_candidates(&self, face_ids: Vec<u32>) -> String {
        self.analyze_merge_candidates_tol(face_ids, 0.5)
    }

    /// Tolerance 지정 merge analysis (B1).
    #[wasm_bindgen(js_name = "analyzeMergeCandidatesTol")]
    pub fn analyze_merge_candidates_tol(&self, face_ids: Vec<u32>, angle_tol_deg: f64) -> String {
        if face_ids.len() < 2 {
            return r#"{"total":0,"mergeable":0,"nonCoplanar":0,"ambiguous":0,"estMergesAfterCascade":0}"#.to_string();
        }

        use std::collections::HashMap;
        let face_set: std::collections::HashSet<FaceId> =
            face_ids.iter().map(|&id| FaceId::new(id)).collect();

        // Map: edge → list of selected faces using it
        let mut edge_to_faces: HashMap<EdgeId, Vec<FaceId>> = HashMap::new();
        for &fid in &face_set {
            let f = match self.scene.mesh.faces.get(fid) {
                Some(f) if f.is_active() => f,
                _ => continue,
            };
            let start = f.outer().start;
            if start.is_null() { continue; }
            if let Ok(hes) = self.scene.mesh.collect_loop_hes(start) {
                for he in hes {
                    let e = self.scene.mesh.hes[he].edge();
                    edge_to_faces.entry(e).or_default().push(fid);
                }
            }
        }

        // Collect unique face pairs + edges they share
        let mut pair_edges: HashMap<(FaceId, FaceId), u32> = HashMap::new();
        for (_, faces) in edge_to_faces.iter() {
            if faces.len() == 2 && faces[0] != faces[1] {
                let mut a = faces[0];
                let mut b = faces[1];
                if b.raw() < a.raw() { std::mem::swap(&mut a, &mut b); }
                *pair_edges.entry((a, b)).or_insert(0) += 1;
            }
        }

        let mut mergeable: u32 = 0;
        let mut non_coplanar: u32 = 0;
        let mut ambiguous: u32 = 0;

        for ((f1, f2), shared_count) in pair_edges.iter() {
            if *shared_count > 1 {
                ambiguous += 1;
                continue;
            }
            match self.scene.mesh.are_faces_coplanar_with_tolerance(*f1, *f2, angle_tol_deg) {
                Ok(true) => mergeable += 1,
                _ => non_coplanar += 1,
            }
        }

        let total = pair_edges.len() as u32;
        let face_count = face_ids.len() as u32;
        let est_max = if face_count > 0 { face_count - 1 } else { 0 };
        let est_merges = mergeable.min(est_max);

        format!(
            r#"{{"total":{},"mergeable":{},"nonCoplanar":{},"ambiguous":{},"estMergesAfterCascade":{}}}"#,
            total, mergeable, non_coplanar, ambiguous, est_merges,
        )
    }

    /// Try to merge adjacent coplanar faces in the given selection.
    ///
    /// Iteratively finds pairs of faces that share exactly one edge and are
    /// coplanar, merges them, and repeats until no more pairs qualify.
    /// Returns the number of merges actually performed.
    ///
    /// All merges are wrapped in a single undo transaction.
    #[wasm_bindgen(js_name = "tryMergeAdjacentFaces")]
    pub fn try_merge_adjacent_faces(&mut self, face_ids: Vec<u32>) -> u32 {
        if face_ids.len() < 2 {
            return 0;
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mut current: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let mut merges_done: u32 = 0;

        loop {
            // Build {edge -> faces sharing it (within selection)}
            let mut edge_to_faces: std::collections::HashMap<EdgeId, Vec<FaceId>> =
                std::collections::HashMap::new();

            for &fid in &current {
                let f = match self.scene.mesh.faces.get(fid) {
                    Some(f) if f.is_active() => f,
                    _ => continue,
                };
                let start = f.outer().start;
                if start.is_null() { continue; }
                if let Ok(hes) = self.scene.mesh.collect_loop_hes(start) {
                    for he in hes {
                        let e = self.scene.mesh.hes[he].edge();
                        edge_to_faces.entry(e).or_default().push(fid);
                    }
                }
            }

            // Find a candidate edge shared by exactly two selected faces
            let mut candidate: Option<(EdgeId, FaceId, FaceId)> = None;
            for (e, faces) in edge_to_faces.iter() {
                if faces.len() == 2 && faces[0] != faces[1] {
                    candidate = Some((*e, faces[0], faces[1]));
                    break;
                }
            }
            let (edge_id, f1, f2) = match candidate {
                Some(v) => v,
                None => break,
            };

            // Attempt merge; silently skip non-coplanar candidates
            match self.scene.mesh.merge_faces_by_edge(edge_id) {
                Ok(new_face) => {
                    merges_done += 1;
                    // Replace f1/f2 with new_face in the working set
                    current.retain(|&x| x != f1 && x != f2);
                    current.push(new_face);
                }
                Err(_) => {
                    // Remove this pair from consideration to make progress
                    // (we don't modify the mesh on error since merge_faces_by_edge
                    //  bails pre-mutation thanks to F5 hardening)
                    // Remove one face so this pair isn't re-examined
                    current.retain(|&x| x != f2);
                }
            }
        }

        if merges_done > 0 {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            self.scene.transactions.cancel();
            self.set_error("No coplanar adjacent faces to merge".to_string());
        }

        merges_done
    }

    // ========================================================================
    // DXF Import
    // ========================================================================

    /// DXF 파일 바이트를 파싱하여 DCEL 메시로 가져오기
    /// 반환: JSON 문자열 (통계 정보)
    pub fn import_dxf(&mut self, data: &[u8]) -> String {
        debug_log!("[RUST] import_dxf: {} bytes", data.len());

        match self.scene.import_dxf(data) {
            Ok(stats) => {
                let verts = self.scene.mesh.vert_count();
                let faces = self.scene.mesh.face_count();
                debug_log!("[RUST] DXF import done: {}", stats);
                debug_log!("[RUST] Mesh now: verts={} faces={}", verts, faces);
                self.mark_topology_changed();
                self.invalidate_cache();

                format!(
                    r#"{{"ok":true,"lines":{},"polylines":{},"circles":{},"arcs":{},"faces3d":{},"solids":{},"points":{},"ellipses":{},"splines":{},"skipped":{},"errors":{},"totalVerts":{},"totalFaces":{}}}"#,
                    stats.lines, stats.polylines, stats.circles, stats.arcs,
                    stats.faces_3d, stats.solids, stats.points, stats.ellipses,
                    stats.splines, stats.skipped, stats.errors.len(),
                    verts, faces,
                )
            }
            Err(e) => {
                console_error!("[RUST] DXF import ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    // ========================================================================
    // Boolean Operations
    // ========================================================================

    /// Boolean 연산 수행
    /// faces_a, faces_b: face ID 배열 (u32)
    /// op: "union" | "subtract" | "intersect"
    /// 반환: JSON 문자열 (결과 정보)
    pub fn boolean_op(
        &mut self,
        faces_a: &[u32],
        faces_b: &[u32],
        op: &str,
    ) -> String {
        let fids_a: Vec<FaceId> = faces_a.iter().map(|&id| FaceId::new(id)).collect();
        let fids_b: Vec<FaceId> = faces_b.iter().map(|&id| FaceId::new(id)).collect();

        let bool_op = match op {
            "union" => BoolOp::Union,
            "subtract" => BoolOp::Subtract,
            "intersect" => BoolOp::Intersect,
            _ => {
                return format!(r#"{{"ok":false,"error":"unknown op: {}"}}"#, op);
            }
        };

        debug_log!(
            "[RUST] boolean: op={} A={} faces, B={} faces",
            op, fids_a.len(), fids_b.len()
        );

        // 트랜잭션 래핑
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mat = self.scene.default_material;
        let result = self.scene.mesh.boolean(&fids_a, &fids_b, bool_op, mat);

        match result {
            Ok(res) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();

                for msg in &res.debug {
                    debug_log!("[BOOL] {}", msg);
                }

                let face_ids: Vec<u32> = res.faces.iter().map(|f| f.raw()).collect();
                format!(
                    r#"{{"ok":true,"op":"{}","resultFaces":{},"newVerts":{},"totalVerts":{},"totalFaces":{}}}"#,
                    op,
                    format!("{:?}", face_ids),
                    res.new_verts,
                    self.scene.mesh.vert_count(),
                    self.scene.mesh.face_count(),
                )
            }
            Err(e) => {
                console_error!("[RUST] boolean ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    /// Diagnose non-manifold edges (ADR-007 I5) without modifying the
    /// scene. Returns JSON: `{count, edges:[{edge, faceCount}, …]}`.
    /// Useful for the UI's "씬 무결성 검사" command.
    #[wasm_bindgen(js_name = "findNonManifoldEdges")]
    pub fn find_non_manifold_edges(&self) -> String {
        let bad = self.scene.mesh.find_non_manifold_edges();
        let mut out = String::from("{\"count\":");
        out.push_str(&bad.len().to_string());
        out.push_str(",\"edges\":[");
        for (i, nm) in bad.iter().enumerate() {
            if i > 0 { out.push(','); }
            out.push_str(&format!(
                r#"{{"edge":{},"faceCount":{}}}"#,
                nm.edge.raw(), nm.faces.len()
            ));
        }
        out.push_str("]}");
        out
    }

    /// Repair non-manifold edges (ADR-007 I5) — XIA-aware where possible,
    /// geometric fallback otherwise. Returns JSON report:
    /// `{ok, edgesExamined, edgesRepaired, edgesSkipped, facesDetached, vertsCreated}`.
    #[wasm_bindgen(js_name = "repairNonManifoldEdges")]
    pub fn repair_non_manifold_edges(&mut self) -> String {
        // Wrap in transaction so the user can undo a repair.
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let r = self.scene.repair_non_manifold_edges();

        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        if r.faces_detached > 0 {
            self.mark_topology_changed();
            self.invalidate_cache();
        }

        format!(
            r#"{{"ok":true,"edgesExamined":{},"edgesRepaired":{},"edgesSkipped":{},"facesDetached":{},"vertsCreated":{}}}"#,
            r.edges_examined, r.edges_repaired, r.edges_skipped.len(),
            r.faces_detached, r.vertices_created,
        )
    }

    /// Slice (Plane Cut) — split a closed Wall volume into two volumes.
    ///
    /// Inputs:
    ///   `face_ids`     — face IDs of a single closed volume (one XIA).
    ///   `origin_x/y/z` — point on the cutting plane (mm).
    ///   `normal_x/y/z` — plane normal (any non-zero length, will be normalized).
    ///
    /// Returns: JSON `{ok, newXia, aboveCount, belowCount}` or `{ok:false, error}`.
    /// On success the original XIA keeps the above half; the below half is
    /// returned as a new XIA id.
    #[wasm_bindgen(js_name = "sliceVolumeByPlane")]
    pub fn slice_volume_by_plane(
        &mut self,
        face_ids: &[u32],
        origin_x: f64, origin_y: f64, origin_z: f64,
        normal_x: f64, normal_y: f64, normal_z: f64,
    ) -> String {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let plane = match axia_geo::operations::slice::SlicePlane::new(
            DVec3::new(origin_x, origin_y, origin_z),
            DVec3::new(normal_x, normal_y, normal_z),
        ) {
            Ok(p) => p,
            Err(e) => return format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'")),
        };

        debug_log!("[RUST] sliceVolumeByPlane: {} faces, plane n=({},{},{})",
            fids.len(), normal_x, normal_y, normal_z);

        match self.scene.slice_volume_by_plane(&fids, plane) {
            Ok(new_xia) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                let total = self.scene.mesh.face_count();
                format!(
                    r#"{{"ok":true,"newXia":{},"totalFaces":{}}}"#,
                    new_xia, total
                )
            }
            Err(e) => {
                console_error!("[RUST] sliceVolumeByPlane ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    /// Sheet 2D Boolean (Tier 4 B-5).
    /// 두 coplanar Sheet face에 대해 union/subtract/intersect 수행.
    /// op: "union" | "subtract" | "intersect"
    /// 반환: JSON `{ok, resultFace}` 또는 `{ok:false, error}`
    #[wasm_bindgen(js_name = "sheetBoolean")]
    pub fn sheet_boolean(&mut self, a: u32, b: u32, op: &str) -> String {
        let fa = FaceId::new(a);
        let fb = FaceId::new(b);
        let mat = self.scene.default_material;

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.sheet_boolean(fa, fb, op, mat) {
            Ok(new_face) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                format!(r#"{{"ok":true,"op":"{}","resultFace":{}}}"#, op, new_face.raw())
            }
            Err(e) => {
                self.scene.transactions.cancel();
                console_error!("[RUST] sheetBoolean ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    /// Phase 2 — auto_intersect_on_draw 토글. 기본 true.
    #[wasm_bindgen(js_name = "setAutoIntersectOnDraw")]
    pub fn set_auto_intersect_on_draw(&mut self, enabled: bool) {
        self.scene.auto_intersect_on_draw = enabled;
    }

    #[wasm_bindgen(js_name = "getAutoIntersectOnDraw")]
    pub fn get_auto_intersect_on_draw(&self) -> bool {
        self.scene.auto_intersect_on_draw
    }

    /// "Intersect with Model" — SketchUp 스타일 수동 교차선 생성.
    /// 선택된 face 들과 나머지 active face 사이의 3D 교차선을 edge 로 변환.
    /// inside/outside 판정 없이 모든 sub-face 유지.
    ///
    /// 반환: 성공 시 {"ok":true,"faceCount":N,"totalFaces":M}
    ///       실패 시 {"ok":false,"error":"..."}
    #[wasm_bindgen(js_name = "intersectWithModel")]
    pub fn intersect_with_model(&mut self, face_ids: &[u32]) -> String {
        if face_ids.is_empty() {
            return r#"{"ok":false,"error":"no faces selected"}"#.to_string();
        }
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        debug_log!("[RUST] intersect_with_model: {} faces selected", fids.len());

        match self.scene.intersect_faces_with_scene(&fids) {
            Ok(n) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                format!(
                    r#"{{"ok":true,"resultFaces":{},"totalFaces":{}}}"#,
                    n, self.scene.mesh.face_count()
                )
            }
            Err(e) => {
                console_error!("[RUST] intersect_with_model ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    // ========================================================================
    // Transform Operations (Move / Rotate / Scale)
    // ========================================================================

    /// 선택된 face들의 정점을 이동
    pub fn translate_faces(&mut self, face_ids: &[u32], dx: f64, dy: f64, dz: f64) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let delta = DVec3::new(dx, dy, dz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.translate_faces(&fids, delta) {
            Ok(res) => {
                debug_log!("[RUST] translate: moved {} verts, {} faces", res.verts_moved, res.faces_affected);
                // Level 2 auto-resolve constraints after face transform
                // Level 3: iterative XPBD-style solve until convergence
                let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] translate ERROR: {}", e);
                self.set_error(format!("translate: {}", e));
                false
            }
        }
    }

    /// 선택된 face들의 정점을 회전
    /// cx,cy,cz: 회전 중심, ax,ay,az: 회전축, angle_deg: 각도 (도)
    pub fn rotate_faces(
        &mut self, face_ids: &[u32],
        cx: f64, cy: f64, cz: f64,
        ax: f64, ay: f64, az: f64,
        angle_deg: f64,
    ) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let center = DVec3::new(cx, cy, cz);
        let axis = DVec3::new(ax, ay, az);
        let angle_rad = angle_deg.to_radians();

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.rotate_faces(&fids, center, axis, angle_rad) {
            Ok(res) => {
                debug_log!("[RUST] rotate: {} verts, {:.1}°", res.verts_moved, angle_deg);
                // Level 3: iterative XPBD-style solve until convergence
                let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] rotate ERROR: {}", e);
                self.set_error(format!("rotate: {}", e));
                false
            }
        }
    }

    /// 선택된 face들의 정점을 스케일
    /// cx,cy,cz: 스케일 중심, sx,sy,sz: 축별 배율
    pub fn scale_faces(
        &mut self, face_ids: &[u32],
        cx: f64, cy: f64, cz: f64,
        sx: f64, sy: f64, sz: f64,
    ) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let center = DVec3::new(cx, cy, cz);
        let scale = DVec3::new(sx, sy, sz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.scale_faces(&fids, center, scale) {
            Ok(res) => {
                debug_log!("[RUST] scale: {} verts, ({:.2},{:.2},{:.2})", res.verts_moved, sx, sy, sz);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                // Use topology_changed for full rebuild: shared vertices between
                // selected and adjacent faces make partial delta unreliable.
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] scale ERROR: {}", e);
                self.set_error(format!("scale: {}", e));
                false
            }
        }
    }

    // ========================================================================
    // Constraint Solver Level 1 (vertex-level ops + edge queries)
    // ========================================================================

    /// 지정 정점 배열을 delta만큼 이동. Constraint Solver에서 makeParallel/
    /// Perpendicular/setDistance의 기초 연산으로 사용.
    #[wasm_bindgen(js_name = "translateVerts")]
    pub fn translate_verts(&mut self, vert_ids: &[u32], dx: f64, dy: f64, dz: f64) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let delta = DVec3::new(dx, dy, dz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.translate_verts(&vids, delta) {
            Ok(_) => {
                // Level 2: auto-resolve constraints touching any moved vertex
                // Level 3: iterative XPBD-style solve until convergence
                let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] translate_verts ERROR: {}", e);
                self.set_error(format!("translate_verts: {}", e));
                self.scene.transactions.cancel();
                false
            }
        }
    }

    /// 지정 정점을 center/axis 기준으로 회전.
    #[wasm_bindgen(js_name = "rotateVerts")]
    pub fn rotate_verts(
        &mut self, vert_ids: &[u32],
        cx: f64, cy: f64, cz: f64,
        ax: f64, ay: f64, az: f64,
        angle_deg: f64,
    ) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let center = DVec3::new(cx, cy, cz);
        let axis = DVec3::new(ax, ay, az);
        let angle_rad = angle_deg.to_radians();

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.rotate_verts(&vids, center, axis, angle_rad) {
            Ok(_) => {
                // Level 2: auto-resolve constraints
                // Level 3: iterative XPBD-style solve until convergence
                let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] rotate_verts ERROR: {}", e);
                self.set_error(format!("rotate_verts: {}", e));
                self.scene.transactions.cancel();
                false
            }
        }
    }

    /// 지정 정점을 center 기준으로 스케일. (sx,sy,sz)로 비균일 지원.
    #[wasm_bindgen(js_name = "scaleVerts")]
    pub fn scale_verts(
        &mut self, vert_ids: &[u32],
        cx: f64, cy: f64, cz: f64,
        sx: f64, sy: f64, sz: f64,
    ) -> bool {
        let vids: Vec<VertId> = vert_ids.iter().map(|&id| VertId::new(id)).collect();
        let center = DVec3::new(cx, cy, cz);
        let scale = DVec3::new(sx, sy, sz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.scale_verts(&vids, center, scale) {
            Ok(_) => {
                let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_error!("[RUST] scale_verts ERROR: {}", e);
                self.set_error(format!("scale_verts: {}", e));
                self.scene.transactions.cancel();
                false
            }
        }
    }

    /// Edge를 지정 위치에서 split하여 새 vertex를 생성하고 edge를 2개로 나눈다.
    /// 반환: 성공 시 새 vertex id (>=0), 실패 시 -1.
    /// position이 엣지 선분 밖이면 가까운 쪽으로 clamp.
    /// 내부적으로 mesh.split_edge를 호출하고 단일 undo 트랜잭션으로 감쌈.
    #[wasm_bindgen(js_name = "splitEdge")]
    pub fn split_edge(&mut self, edge_id_raw: u32, px: f64, py: f64, pz: f64) -> i32 {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            self.set_error(format!("Edge {} not found", edge_id_raw));
            return -1;
        }
        // Clamp position onto the edge segment for safety
        let pos = {
            let edge = &self.scene.mesh.edges[eid];
            let p0 = self.scene.mesh.vertex_pos(edge.v_small()).unwrap_or(DVec3::ZERO);
            let p1 = self.scene.mesh.vertex_pos(edge.v_large()).unwrap_or(DVec3::ZERO);
            let p  = DVec3::new(px, py, pz);
            let d  = p1 - p0;
            let len_sq = d.length_squared();
            if len_sq < 1e-12 {
                p0
            } else {
                let t = ((p - p0).dot(d) / len_sq).clamp(0.05, 0.95);
                p0 + d * t
            }
        };

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        match self.scene.mesh.split_edge(eid, pos) {
            Ok((vp, _e1, _e2)) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();
                vp.raw() as i32
            }
            Err(e) => {
                self.scene.transactions.cancel();
                self.set_error(format!("split_edge: {}", e));
                -1
            }
        }
    }

    /// Collect all edges in the polyline chain containing `edge_id`.
    /// Walks through degree-2 vertices and stops at junctions/dead-ends.
    /// Empty Vec on invalid / inactive edge.
    #[wasm_bindgen(js_name = "collectEdgeChain")]
    pub fn collect_edge_chain(&self, edge_id_raw: u32) -> Vec<u32> {
        let eid = EdgeId::new(edge_id_raw);
        self.scene.mesh.collect_edge_chain(eid).iter().map(|e| e.raw()).collect()
    }

    /// Edge의 두 끝점 VertId를 반환 ([v_small, v_large]).
    /// 실패 시 빈 벡터.
    #[wasm_bindgen(js_name = "getEdgeEndpoints")]
    pub fn get_edge_endpoints(&self, edge_id_raw: u32) -> Vec<u32> {
        let eid = EdgeId::new(edge_id_raw);
        let edge = match self.scene.mesh.edges.get(eid) {
            Some(e) if e.is_active() => e,
            _ => return Vec::new(),
        };
        vec![edge.v_small().raw(), edge.v_large().raw()]
    }

    /// Vertex 위치를 [x, y, z]로 반환. 실패 시 빈 벡터.
    #[wasm_bindgen(js_name = "getVertexPos")]
    pub fn get_vertex_pos(&self, vert_id_raw: u32) -> Vec<f64> {
        let vid = VertId::new(vert_id_raw);
        match self.scene.mesh.vertex_pos(vid) {
            Ok(p) => vec![p.x, p.y, p.z],
            Err(_) => Vec::new(),
        }
    }

    // ========================================================================
    // Constraint Solver Level 2 — persistent graph (Scene.constraints)
    // ========================================================================

    /// Add a parallel/perpendicular/collinear constraint between two edges.
    /// `edgeA_v_a/b` and `edgeB_v_a/b` are vertex IDs.
    /// `kind`: "parallel" | "perpendicular" | "collinear"
    /// Returns the new constraint ID (>=1) on success, 0 on failure.
    #[wasm_bindgen(js_name = "addEdgeConstraint")]
    pub fn add_edge_constraint(
        &mut self,
        kind: &str,
        edge_a_v_a: u32, edge_a_v_b: u32,
        edge_b_v_a: u32, edge_b_v_b: u32,
    ) -> u32 {
        let kind = match kind {
            "parallel"      => ConstraintKind::Parallel,
            "perpendicular" => ConstraintKind::Perpendicular,
            "collinear"     => ConstraintKind::Collinear,
            other => { self.set_error(format!("unknown constraint kind: {}", other)); return 0; }
        };
        let refs = vec![
            ConstraintRef::Edge { v_a: VertId::new(edge_a_v_a), v_b: VertId::new(edge_a_v_b) },
            ConstraintRef::Edge { v_a: VertId::new(edge_b_v_a), v_b: VertId::new(edge_b_v_b) },
        ];
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let id = self.scene.constraints.add(kind, refs, None);
        // Apply immediately — single constraint, iterative gives same result
        // but handles newly conflicting geometry gracefully.
        let _ = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, 50, 1e-5);
        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();
        id
    }

    /// Add a distance constraint between two vertices.
    #[wasm_bindgen(js_name = "addDistanceConstraint")]
    pub fn add_distance_constraint(&mut self, v_a: u32, v_b: u32, distance: f64) -> u32 {
        if !distance.is_finite() || distance <= 0.0 {
            self.set_error(format!("distance must be > 0, got {}", distance));
            return 0;
        }
        let refs = vec![
            ConstraintRef::Vertex(VertId::new(v_a)),
            ConstraintRef::Vertex(VertId::new(v_b)),
        ];
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let id = self.scene.constraints.add(ConstraintKind::Distance, refs, Some(distance));
        if let Some(c) = self.scene.constraints.get(id).cloned() {
            let _ = resolve_constraint(&mut self.scene.mesh, &c);
        }
        self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
        self.scene.transactions.commit();
        self.mark_topology_changed();
        self.invalidate_cache();
        id
    }

    /// Remove a constraint by ID. Returns true on success.
    #[wasm_bindgen(js_name = "removeConstraint")]
    pub fn remove_constraint(&mut self, id: u32) -> bool {
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let removed = self.scene.constraints.remove(id);
        if removed {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
        } else {
            self.scene.transactions.cancel();
        }
        removed
    }

    /// List all constraints as JSON.
    /// Format: [{id, kind, active, refs:[...], value}, ...]
    #[wasm_bindgen(js_name = "listConstraints")]
    pub fn list_constraints(&self) -> String {
        // Lightweight manual JSON (avoid pulling in serde_json just here)
        let mut out = String::from("[");
        for (i, c) in self.scene.constraints.iter().enumerate() {
            if i > 0 { out.push(','); }
            let kind = match c.kind {
                ConstraintKind::Parallel      => "parallel",
                ConstraintKind::Perpendicular => "perpendicular",
                ConstraintKind::Collinear     => "collinear",
                ConstraintKind::Distance      => "distance",
            };
            out.push_str(&format!(
                r#"{{"id":{},"kind":"{}","active":{}"#, c.id, kind, c.active
            ));
            if let Some(v) = c.value {
                out.push_str(&format!(r#","value":{}"#, v));
            }
            out.push_str(r#","refs":["#);
            for (j, r) in c.refs.iter().enumerate() {
                if j > 0 { out.push(','); }
                match r {
                    ConstraintRef::Edge { v_a, v_b } =>
                        out.push_str(&format!(r#"{{"edge":[{},{}]}}"#, v_a.raw(), v_b.raw())),
                    ConstraintRef::Vertex(v) =>
                        out.push_str(&format!(r#"{{"vertex":{}}}"#, v.raw())),
                }
            }
            out.push_str("]}");
        }
        out.push(']');
        out
    }

    /// Re-solve all active constraints. Returns number of constraints that
    /// actually moved geometry.
    #[wasm_bindgen(js_name = "resolveAllConstraints")]
    pub fn resolve_all_constraints(&mut self) -> u32 {
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let count = resolve_all(&mut self.scene.mesh, &self.scene.constraints);
        if count > 0 {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            self.scene.transactions.cancel();
        }
        count as u32
    }

    /// Toggle active flag of a constraint.
    #[wasm_bindgen(js_name = "setConstraintActive")]
    pub fn set_constraint_active(&mut self, id: u32, active: bool) -> bool {
        self.scene.constraints.set_active(id, active)
    }

    /// **Level 3**: iterative XPBD-style solver. Returns a JSON result
    /// `{converged, iterations, finalResidual, initialResidual, overConstrained}`.
    /// Wraps in a single undo transaction if anything moved.
    #[wasm_bindgen(js_name = "resolveConstraintsIterative")]
    pub fn resolve_constraints_iterative(&mut self, max_iter: u32, tolerance: f64) -> String {
        let max_iter = if max_iter == 0 { 50 } else { max_iter.min(2000) };
        let tolerance = if tolerance <= 0.0 { 1e-5 } else { tolerance };

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());
        let result = resolve_iterative(&mut self.scene.mesh, &self.scene.constraints, max_iter, tolerance);
        // Only commit a transaction if the solver actually changed something
        // (final residual differs from initial).
        if (result.initial_residual - result.final_residual).abs() > 1e-12 {
            self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
            self.scene.transactions.commit();
            self.mark_topology_changed();
            self.invalidate_cache();
        } else {
            self.scene.transactions.cancel();
        }
        format!(
            r#"{{"converged":{},"iterations":{},"finalResidual":{:.9},"initialResidual":{:.9},"overConstrained":{}}}"#,
            result.converged, result.iterations, result.final_residual,
            result.initial_residual, result.over_constrained,
        )
    }

    /// **Level 3**: max residual across all active constraints at current state.
    /// For monitoring / UI status without mutating the mesh.
    #[wasm_bindgen(js_name = "maxConstraintResidual")]
    pub fn max_constraint_residual(&self) -> f64 {
        max_residual(&self.scene.mesh, &self.scene.constraints)
    }

    /// Count of constraints (active + inactive).
    #[wasm_bindgen(js_name = "constraintCount")]
    pub fn constraint_count(&self) -> u32 {
        self.scene.constraints.len() as u32
    }

    /// Offset: face의 경계를 dist만큼 안쪽(+)/바깥쪽(-)으로 오프셋
    /// 반환: JSON 결과 { ok, innerFace, stripFaces, ... }
    pub fn offset_face(&mut self, face_id_raw: u32, dist: f64) -> String {
        let fid = FaceId::new(face_id_raw);

        // 트랜잭션 시작
        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.offset_face(fid, dist) {
            Ok(result) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();

                let strip_ids: Vec<u32> = result.strip_faces.iter()
                    .map(|f| f.raw())
                    .collect();

                format!(
                    r#"{{"ok":true,"innerFace":{},"stripFaces":{:?},"totalFaces":{},"totalVerts":{}}}"#,
                    result.inner_face.raw(),
                    strip_ids,
                    self.scene.mesh.face_count(),
                    self.scene.mesh.vert_count(),
                )
            }
            Err(e) => {
                console_error!("[RUST] offset ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    /// Edge(line)를 평행하게 offset하여 새 edge 생성 (선만 복사, 면은 만들지 않음)
    /// plane_normal: 참조 평면 법선 (Y-up = 0,1,0)
    pub fn offset_edge(
        &mut self,
        edge_id_raw: u32,
        dist: f64,
        pnx: f64, pny: f64, pnz: f64,
    ) -> String {
        let eid = EdgeId::new(edge_id_raw);
        let plane_normal = glam::DVec3::new(pnx, pny, pnz);

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        match self.scene.mesh.offset_edge(eid, dist, plane_normal) {
            Ok(result) => {
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                self.mark_topology_changed();
                self.invalidate_cache();

                format!(
                    r#"{{"ok":true,"newEdge":{},"newV0":{},"newV1":{}}}"#,
                    result.new_edge.raw(),
                    result.new_v0.raw(),
                    result.new_v1.raw(),
                )
            }
            Err(e) => {
                console_error!("[RUST] offset_edge ERROR: {}", e);
                format!(r#"{{"ok":false,"error":"{}"}}"#, e.to_string().replace('"', "'"))
            }
        }
    }

    /// face 집합의 중심점 반환 [x, y, z]
    pub fn faces_centroid(&self, face_ids: &[u32]) -> Vec<f64> {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        match self.scene.mesh.faces_centroid(&fids) {
            Ok(c) => vec![c.x, c.y, c.z],
            Err(_) => vec![0.0, 0.0, 0.0],
        }
    }

    // ========================================================================
    // Group / Component Operations
    // ========================================================================

    /// 선택된 face들을 그룹으로 생성
    /// 반환: group ID (성공) 또는 0 (실패)
    pub fn create_group(&mut self, name: &str, face_ids: &[u32]) -> f64 {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        let cmd = Command::CreateGroup {
            name: name.to_string(),
            face_ids: fids,
        };
        let result = self.scene.execute(cmd);
        match result {
            CommandResult::GroupUpdated(gid) => {
                debug_log!("[RUST] create_group: id={} name={}", gid, name);
                gid as f64
            }
            _ => 0.0,
        }
    }

    /// 그룹 해제
    pub fn delete_group(&mut self, group_id: u32) -> bool {
        let cmd = Command::DeleteGroup { group_id };
        let result = self.scene.execute(cmd);
        matches!(result, CommandResult::GroupUpdated(_))
    }

    /// 그룹 이름 변경
    pub fn rename_group(&mut self, group_id: u32, new_name: &str) -> bool {
        let cmd = Command::RenameGroup {
            group_id,
            new_name: new_name.to_string(),
        };
        let result = self.scene.execute(cmd);
        matches!(result, CommandResult::GroupUpdated(_))
    }

    /// 그룹 가시성 토글
    pub fn toggle_group_visibility(&mut self, group_id: u32) -> bool {
        let cmd = Command::ToggleGroupVisibility { group_id };
        let result = self.scene.execute(cmd);
        if matches!(result, CommandResult::GroupUpdated(_)) {
            self.mark_topology_changed();
            self.invalidate_cache();
            true
        } else {
            false
        }
    }

    /// face가 잠긴 그룹에 속하는지 확인
    pub fn is_face_locked(&self, face_id_raw: u32) -> bool {
        let fid = axia_geo::FaceId::new(face_id_raw);
        self.scene.is_face_locked(fid)
    }

    /// 그룹 잠금 토글
    pub fn toggle_group_lock(&mut self, group_id: u32) -> bool {
        let cmd = Command::ToggleGroupLock { group_id };
        let result = self.scene.execute(cmd);
        matches!(result, CommandResult::GroupUpdated(_))
    }

    /// face가 속한 그룹 ID 조회 (없으면 0 반환)
    pub fn get_group_for_face(&self, face_id_raw: u32) -> f64 {
        let fid = FaceId::new(face_id_raw);
        match self.scene.groups.get_group_for_face(fid) {
            Some(gid) => gid as f64,
            None => 0.0,
        }
    }

    /// 그룹의 모든 face ID 반환 (재귀적)
    pub fn get_group_faces(&self, group_id: u32) -> Vec<u32> {
        self.scene.groups.get_all_faces_recursive(group_id)
            .iter()
            .map(|f| f.raw())
            .collect()
    }

    /// 그룹에 face 추가
    pub fn add_faces_to_group(&mut self, group_id: u32, face_ids: &[u32]) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        self.scene.groups.add_faces_to_group(group_id, &fids)
    }

    /// 그룹에서 face 제거
    pub fn remove_faces_from_group(&mut self, group_id: u32, face_ids: &[u32]) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        self.scene.groups.remove_faces_from_group(group_id, &fids)
    }

    /// 중첩 그룹 설정
    pub fn set_group_parent(&mut self, child_id: u32, parent_id: f64) -> bool {
        let parent = if parent_id <= 0.0 { None } else { Some(parent_id as u32) };
        self.scene.groups.set_parent(child_id, parent)
    }

    /// 그룹을 컴포넌트로 변환
    pub fn make_component(&mut self, group_id: u32, name: &str) -> f64 {
        match self.scene.groups.make_component(group_id, name.to_string()) {
            Some(def_id) => {
                debug_log!("[RUST] make_component: group={} def={}", group_id, def_id);
                def_id as f64
            }
            None => 0.0,
        }
    }

    /// 그룹 정보 JSON 반환
    pub fn get_group_info(&self, group_id: u32) -> String {
        match self.scene.groups.export_group_info(group_id) {
            Some(json) => json,
            None => r#"{"error":"group not found"}"#.to_string(),
        }
    }

    /// 전체 그룹 트리 JSON 반환
    pub fn get_all_groups(&self) -> String {
        self.scene.groups.export_all_groups_json()
    }

    /// 그룹 수
    pub fn group_count(&self) -> usize {
        self.scene.groups.group_count()
    }

    // ═══════════════════════════════════════════════
    //  Material Operations
    // ═══════════════════════════════════════════════

    /// 면에 재질 부여 (material_id_raw = MaterialId의 raw u32 값)
    pub fn assign_material(&mut self, face_ids_raw: &[u32], material_id_raw: u32) -> bool {
        let face_ids: Vec<FaceId> = face_ids_raw.iter()
            .map(|&r| FaceId::new(r))
            .collect();
        let material_id = axia_geo::MaterialId::new(material_id_raw);
        let cmd = Command::AssignMaterial { face_ids, material_id };
        match self.scene.execute(cmd) {
            CommandResult::MaterialAssigned { .. } => {
                self.cache_dirty = true;
                true
            },
            _ => false,
        }
    }

    /// 면에서 재질 제거 → XIA가 Volume으로 복귀
    pub fn remove_material(&mut self, face_ids_raw: &[u32]) -> bool {
        let face_ids: Vec<FaceId> = face_ids_raw.iter()
            .map(|&r| FaceId::new(r))
            .collect();
        let cmd = Command::RemoveMaterial { face_ids };
        match self.scene.execute(cmd) {
            CommandResult::MaterialRemoved { .. } => {
                self.cache_dirty = true;
                true
            },
            _ => false,
        }
    }

    /// 면의 재질 ID 조회 (없으면 0 반환, 0 = 기본 재질)
    pub fn get_face_material(&self, face_id_raw: u32) -> u32 {
        let fid = FaceId::new(face_id_raw);
        if let Some(face) = self.scene.mesh.faces.get(fid) {
            return face.material().raw();
        }
        0
    }

    /// 전체 재질 목록 JSON 반환 (format! 기반, serde_json 불필요)
    pub fn get_all_materials(&self) -> String {
        let mats = self.scene.material_library.all();
        if mats.is_empty() {
            return "[]".to_string();
        }
        let entries: Vec<String> = mats.iter()
            .map(|m| {
                let hex = format!("{:06x}", m.visual.color);
                format!(
                    r##"{{"id":{},"name":"{}","nameEn":"{}","density":{},"color":"#{}"}}"##,
                    m.id.raw(), m.name, m.name_en, m.physical.density, hex
                )
            })
            .collect();
        format!("[{}]", entries.join(","))
    }
}
