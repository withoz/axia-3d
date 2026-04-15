//! AXiA WASM Bridge
//!
//! Exposes the Rust core engine to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;
use glam::DVec3;
use std::collections::{HashMap, HashSet};

use axia_core::scene::Scene;
use axia_core::commands::Command;
use axia_core::commands::CommandResult;
use axia_geo::{FaceId, EdgeId};
use axia_geo::operations::boolean::BoolOp;

// Console logging from Rust WASM
macro_rules! console_log {
    ($($arg:tt)*) => {
        web_sys::console::log_1(&format!($($arg)*).into())
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
}

#[wasm_bindgen]
impl AxiaEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            scene: Scene::new(),
            cached_positions: Vec::new(),
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
        }
    }

    fn rebuild_cache(&mut self) {
        if !self.cache_dirty {
            return;
        }
        match self.scene.export_mesh_buffers() {
            Ok((p, n, i, fm)) => {
                self.cached_positions = p;
                self.cached_normals = n;
                self.cached_indices = i;
                self.cached_face_map = fm;
            }
            Err(_) => {
                self.cached_positions.clear();
                self.cached_normals.clear();
                self.cached_indices.clear();
                self.cached_face_map.clear();
            }
        }
        // Edge lines are computed from DCEL topology (not from triangle geometry)
        // 30° threshold: 원통 옆면(인접 면 15°)은 soft edge, 직각(90°)은 hard edge
        let (edge_lines, edge_map) = self.scene.export_edge_lines_with_map(30.0);
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
        let surface_normal = if nx == 0.0 && ny == 0.0 && nz == 0.0 {
            None
        } else {
            Some(DVec3::new(nx, ny, nz))
        };
        let cmd = Command::DrawLine {
            start: DVec3::new(x0, y0, z0),
            end: DVec3::new(x1, y1, z1),
            surface_normal,
        };
        let result = self.scene.execute(cmd);

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
                console_log!("[RUST] draw_rect: xia={} faces={} input_normal=({},{},{})",
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
                    console_log!("[RUST] create_cylinder: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                console_log!("[RUST] create_cylinder error: {}", e);
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
                    console_log!("[RUST] create_cone: faces={} base_id={} xia={}", faces.len(), base_face.raw(), xia_id);
                    base_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                console_log!("[RUST] create_cone error: {}", e);
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
                    console_log!("[RUST] create_sphere: faces={} first_id={} xia={}", faces.len(), first_face.raw(), xia_id);
                    first_face.raw() as f64
                } else {
                    -1.0
                }
            }
            Err(e) => {
                console_log!("[RUST] create_sphere error: {}", e);
                -1.0
            }
        }
    }

    // ========================================================================
    // XIA → Face ID lookup
    // ========================================================================

    /// Returns the first face ID owned by the given XIA ID.
    /// draw_rect/draw_circle return XIA IDs; push_pull expects face IDs.
    /// Returns u32::MAX on failure.
    pub fn get_xia_face(&self, xia_id: u64) -> u32 {
        if let Some(xia) = self.scene.xias.get(&xia_id) {
            if let Some(&fid) = xia.face_ids.first() {
                return fid.raw();
            }
        }
        u32::MAX
    }

    /// face가 속한 XIA의 ID 반환 (O(1) 역인덱스)
    /// 없으면 u64::MAX 반환
    pub fn get_xia_for_face(&self, face_id_raw: u32) -> u64 {
        let fid = FaceId::new(face_id_raw);
        self.scene.get_xia_for_face(fid).unwrap_or(u64::MAX)
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
        console_log!("[RUST] push_pull faceId={} dist={:.3} normal={} faces_before={}",
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
                console_log!(
                    "[RUST] after: faces={} (delta={:+}) sides={} adj_splits={} base_removed={}",
                    faces_after, faces_after as i64 - faces_before as i64,
                    sides_created, adj_splits, base_removed
                );
                for msg in split_debug {
                    console_log!("[SPLIT] {}", msg);
                }
                true
            }
            axia_core::commands::CommandResult::Error(e) => {
                console_log!("[RUST] push_pull ERROR: {}", e);
                false
            }
            _ => {
                console_log!("[RUST] after: faces={} (delta={:+})",
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
    /// Expects a JavaScript array of face IDs converted to a Uint32Array
    ///
    /// # Parameters
    /// - face_ids_ptr: pointer to face ID array
    /// - face_ids_len: number of face IDs
    /// - dist: distance to offset (positive = outward)
    ///
    /// # Returns
    /// true if successful
    #[wasm_bindgen]
    pub fn push_pull_smooth_group_seamless(
        &mut self,
        face_ids_ptr: *const u32,
        face_ids_len: usize,
        dist: f64,
    ) -> bool {
        if dist == 0.0 || face_ids_len == 0 {
            return true;
        }

        // Convert pointer to slice
        let face_ids = unsafe {
            std::slice::from_raw_parts(face_ids_ptr, face_ids_len)
        };

        let smooth_group: Vec<FaceId> = face_ids
            .iter()
            .map(|&id| FaceId::new(id))
            .collect();

        console_log!(
            "[RUST] push_pull_smooth_group_seamless: {} faces, dist={:.3}",
            smooth_group.len(),
            dist
        );

        let faces_before = self.scene.mesh.face_count();

        // Execute seamless offset
        let result = match self.scene.mesh.push_pull_smooth_group_seamless(
            smooth_group.clone(),
            dist,
            axia_geo::MaterialId::new(0),
        ) {
            Ok(pp_result) => {
                let faces_after = self.scene.mesh.face_count();
                console_log!(
                    "[RUST] seamless offset done: {} → {} faces (delta={}), {} wall faces",
                    faces_before,
                    faces_after,
                    faces_after as i64 - faces_before as i64,
                    pp_result.side_faces.len()
                );
                for msg in &pp_result.split_debug {
                    console_log!("[SEAMLESS] {}", msg);
                }
                true
            }
            Err(e) => {
                console_log!("[RUST] push_pull_smooth_group_seamless ERROR: {}", e);
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

    /// Get the stored normal for a face (from Rust engine, not Three.js).
    /// Returns [nx, ny, nz] or [0,0,0] if not found.
    /// Force-delete a face from the mesh. Called from JS after inward push/pull.
    pub fn delete_face(&mut self, face_id_raw: u32) -> bool {
        let fid = FaceId::new(face_id_raw);
        if self.scene.mesh.faces.contains(fid) {
            // Clean up face_to_xia reverse index + XIA face_ids
            self.scene.unregister_face_from_xia(fid);
            // Try proper removal first
            let _ = self.scene.mesh.remove_face(fid);
            // Force-remove from storage even if remove_face had issues
            if self.scene.mesh.faces.contains(fid) {
                self.scene.mesh.faces.remove(fid);
            }
            self.mark_topology_changed();
            self.invalidate_cache();
            !self.scene.mesh.faces.contains(fid) // return true if actually gone
        } else {
            true // already gone
        }
    }

    /// Delete an edge (and its half-edges) from the mesh.
    /// Also removes any faces that reference this edge.
    /// Used by the Erase tool.
    pub fn delete_edge(&mut self, edge_id_raw: u32) -> bool {
        let eid = EdgeId::new(edge_id_raw);
        if !self.scene.mesh.edges.contains(eid) {
            return true; // already gone
        }

        self.scene.transactions.begin();
        self.scene.transactions.set_before_snapshot(self.scene.scene_snapshot());

        // First, find and remove any faces sharing this edge
        let (faces, _) = self.scene.mesh.get_faces_sharing_edge(eid);
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

        !self.scene.mesh.edges.contains(eid)
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

    pub fn get_face_normal(&self, face_id_raw: u32) -> Vec<f64> {
        let fid = FaceId::new(face_id_raw);
        if let Some(face) = self.scene.mesh.faces.get(fid) {
            let n = face.normal();
            vec![n.x, n.y, n.z]
        } else {
            vec![0.0, 0.0, 0.0]
        }
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

    /// 선택된 face ID 배열에 대해 XIA 속성을 JSON으로 반환.
    /// 반환: { isSolid, bbox{minX,minY,minZ,maxX,maxY,maxZ}, length, width, height,
    ///         surfaceArea, volume, faceCount, vertCount, edgeCount, snapPoints,
    ///         shapeType }
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

        // ── 4. Watertight (Solid) 체크 ──
        // 모든 edge가 정확히 2개의 선택된 face를 공유하면 닫힌 solid
        let face_set: HashSet<axia_geo::FaceId> = face_ids.iter().copied().collect();
        let mut is_solid = face_ids.len() >= 4; // 최소 4면 필요
        if is_solid {
            for &eid in &all_edges {
                let (neighbor_faces, _) = mesh.get_faces_sharing_edge(eid);
                let shared_count = neighbor_faces.iter()
                    .filter(|f| face_set.contains(f))
                    .count();
                if shared_count != 2 {
                    is_solid = false;
                    break;
                }
            }
        }

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
            r#"{{"empty":false,"isSolid":{},"shapeType":"{}","faceCount":{},"vertCount":{},"edgeCount":{},"snapPoints":{},"minX":{:.4},"minY":{:.4},"minZ":{:.4},"maxX":{:.4},"maxY":{:.4},"maxZ":{:.4},"length":{:.4},"width":{:.4},"height":{:.4},"surfaceArea":{:.6},"volume":{:.6},"materialId":{},"hasMaterial":{}}}"#,
            is_solid,
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
                console_log!("[RUST] export_snapshot: {} bytes", data.len());
                data
            }
            Err(e) => {
                console_log!("[RUST] export_snapshot ERROR: {}", e);
                Vec::new()
            }
        }
    }

    /// 바이너리 스냅샷으로부터 프로젝트 복원 (supports versioned and legacy formats)
    pub fn import_snapshot(&mut self, data: &[u8]) -> bool {
        match self.scene.import_versioned_snapshot(data) {
            Ok(()) => {
                self.mark_topology_changed();
                self.invalidate_cache();
                console_log!("[RUST] import_snapshot: verts={} faces={}",
                    self.scene.mesh.vert_count(), self.scene.mesh.face_count());
                true
            }
            Err(e) => {
                console_log!("[RUST] import_snapshot ERROR: {}", e);
                false
            }
        }
    }

    /// Orient all faces for consistent normals.
    /// Returns number of faces flipped.
    pub fn orient_faces(&mut self) -> usize {
        let (flipped, visited) = self.scene.orient_faces();
        console_log!("[RUST] orient_faces: flipped={} visited={}", flipped, visited);
        self.mark_topology_changed();
        self.invalidate_cache();
        flipped
    }

    // ========================================================================
    // DXF Import
    // ========================================================================

    /// DXF 파일 바이트를 파싱하여 DCEL 메시로 가져오기
    /// 반환: JSON 문자열 (통계 정보)
    pub fn import_dxf(&mut self, data: &[u8]) -> String {
        console_log!("[RUST] import_dxf: {} bytes", data.len());

        match self.scene.import_dxf(data) {
            Ok(stats) => {
                let verts = self.scene.mesh.vert_count();
                let faces = self.scene.mesh.face_count();
                console_log!("[RUST] DXF import done: {}", stats);
                console_log!("[RUST] Mesh now: verts={} faces={}", verts, faces);
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
                console_log!("[RUST] DXF import ERROR: {}", e);
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

        console_log!(
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
                    console_log!("[BOOL] {}", msg);
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
                console_log!("[RUST] boolean ERROR: {}", e);
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
                console_log!("[RUST] translate: moved {} verts, {} faces", res.verts_moved, res.faces_affected);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                // Use topology_changed for full rebuild: shared vertices between
                // selected and adjacent faces make partial delta unreliable.
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_log!("[RUST] translate ERROR: {}", e);
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
                console_log!("[RUST] rotate: {} verts, {:.1}°", res.verts_moved, angle_deg);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                // Use topology_changed for full rebuild: shared vertices between
                // selected and adjacent faces make partial delta unreliable.
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_log!("[RUST] rotate ERROR: {}", e);
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
                console_log!("[RUST] scale: {} verts, ({:.2},{:.2},{:.2})", res.verts_moved, sx, sy, sz);
                self.scene.transactions.set_after_snapshot(self.scene.scene_snapshot());
                self.scene.transactions.commit();
                // Use topology_changed for full rebuild: shared vertices between
                // selected and adjacent faces make partial delta unreliable.
                self.mark_topology_changed();
                self.invalidate_cache();
                true
            }
            Err(e) => {
                console_log!("[RUST] scale ERROR: {}", e);
                false
            }
        }
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
                console_log!("[RUST] offset ERROR: {}", e);
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
                console_log!("[RUST] offset_edge ERROR: {}", e);
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
                console_log!("[RUST] create_group: id={} name={}", gid, name);
                gid as f64
            }
            _ => 0.0,
        }
    }

    /// 그룹 해제
    pub fn delete_group(&mut self, group_id: u64) -> bool {
        let cmd = Command::DeleteGroup { group_id };
        let result = self.scene.execute(cmd);
        matches!(result, CommandResult::GroupUpdated(_))
    }

    /// 그룹 이름 변경
    pub fn rename_group(&mut self, group_id: u64, new_name: &str) -> bool {
        let cmd = Command::RenameGroup {
            group_id,
            new_name: new_name.to_string(),
        };
        let result = self.scene.execute(cmd);
        matches!(result, CommandResult::GroupUpdated(_))
    }

    /// 그룹 가시성 토글
    pub fn toggle_group_visibility(&mut self, group_id: u64) -> bool {
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
    pub fn toggle_group_lock(&mut self, group_id: u64) -> bool {
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
    pub fn get_group_faces(&self, group_id: u64) -> Vec<u32> {
        self.scene.groups.get_all_faces_recursive(group_id)
            .iter()
            .map(|f| f.raw())
            .collect()
    }

    /// 그룹에 face 추가
    pub fn add_faces_to_group(&mut self, group_id: u64, face_ids: &[u32]) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        self.scene.groups.add_faces_to_group(group_id, &fids)
    }

    /// 그룹에서 face 제거
    pub fn remove_faces_from_group(&mut self, group_id: u64, face_ids: &[u32]) -> bool {
        let fids: Vec<FaceId> = face_ids.iter().map(|&id| FaceId::new(id)).collect();
        self.scene.groups.remove_faces_from_group(group_id, &fids)
    }

    /// 중첩 그룹 설정
    pub fn set_group_parent(&mut self, child_id: u64, parent_id: f64) -> bool {
        let parent = if parent_id <= 0.0 { None } else { Some(parent_id as u64) };
        self.scene.groups.set_parent(child_id, parent)
    }

    /// 그룹을 컴포넌트로 변환
    pub fn make_component(&mut self, group_id: u64, name: &str) -> f64 {
        match self.scene.groups.make_component(group_id, name.to_string()) {
            Some(def_id) => {
                console_log!("[RUST] make_component: group={} def={}", group_id, def_id);
                def_id as f64
            }
            None => 0.0,
        }
    }

    /// 그룹 정보 JSON 반환
    pub fn get_group_info(&self, group_id: u64) -> String {
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
