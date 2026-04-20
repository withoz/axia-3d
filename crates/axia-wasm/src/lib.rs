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
        // Edge lines are computed from DCEL topology (not from triangle geometry)
        // EDGE_VISIBILITY_ANGLE_DEG (30°): 원통 옆면은 soft edge, 직각은 hard edge
        let (edge_lines, edge_map) = self.scene
            .export_edge_lines_with_map(axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG);
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
                if let Some(&base_face) = faces.first() {
                    debug_log!("[RUST] create_cylinder: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
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
                // XIA 생성 — state는 face_ids.len()에서 자동 계산
                let xia_id = self.scene.create_xia_with_faces(
                    "Cone".to_string(),
                    position,
                    faces.clone(),
                );
                if let Some(&base_face) = faces.first() {
                    debug_log!("[RUST] create_cone: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                console_error!("[RUST] create_cone error: {}", e);
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
                // XIA 생성 — state는 face_ids.len()에서 자동 계산
                let xia_id = self.scene.create_xia_with_faces(
                    "Sphere".to_string(),
                    position,
                    faces.clone(),
                );
                if let Some(&first_face) = faces.first() {
                    debug_log!("[RUST] create_sphere: faces={} first_id={} xia={}", faces.len(), first_face.raw(), xia_id);
                    first_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
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
    pub fn get_edge_lines(&mut self) -> Vec<f32> {
        self.rebuild_cache();
        self.cached_edge_lines.clone()
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
    #[wasm_bindgen(js_name = "batchEraseEdgesWithMerge")]
    pub fn batch_erase_edges_with_merge(
        &mut self,
        face_ids: &[u32],
        edge_ids: &[u32],
        angle_tol_deg: f64,
        cascade_only: bool,
    ) -> Vec<i32> {
        if face_ids.is_empty() && edge_ids.is_empty() {
            return vec![0, 0, 0];
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        let mut merged: i32 = 0;
        let mut cascaded_faces: i32 = 0;
        let mut cascaded_edges: i32 = 0;
        let mut all_removed_faces: Vec<FaceId> = Vec::new();

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
                        /* fall through to cascade */
                    }
                }
            }

            // Cascade-delete: remove sharing faces + the edge itself.
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
        self.scene.mesh.remove_isolated_verts();

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

        vec![merged, cascaded_faces, cascaded_edges]
    }

    /// Diagnostic — first merge failure reason from the most recent
    /// `batchEraseEdgesWithMerge` call. Empty string if no failure or no
    /// call yet. Intended for the debug-mode Toast in the Erase tool.
    #[wasm_bindgen(js_name = "lastMergeFailureReason")]
    pub fn last_merge_failure_reason(&self) -> String {
        self.last_merge_failure.clone()
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

    /// Phase H5 — 자유 엣지 개수만 카운트 (dry-run, mesh 불변).
    /// UI에서 "N개 자유 엣지 발견 — Face Synthesis 실행?" 안내에 사용.
    #[wasm_bindgen(js_name = "countFreeEdges")]
    pub fn count_free_edges(&self) -> u32 {
        let mut count = 0u32;
        for (_, he) in self.scene.mesh.hes.iter() {
            if he.is_active() && he.face().is_null() {
                count += 1;
            }
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
