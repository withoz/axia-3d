//! Scene — the top-level container for all XIA entities and the geometry mesh.

use std::collections::HashMap;
use glam::DVec3;
use anyhow::Result;

use axia_geo::{Mesh, MaterialId, FaceId, EdgeId, VertId};
use axia_transaction::TransactionManager;

use crate::xia::{Xia, XiaId};
use crate::commands::{Command, CommandResult};
use crate::lifecycle;
use crate::group::{GroupId, GroupManager, Transform3D};
use crate::material::MaterialLibrary;
use crate::constraint::ConstraintGraph;

/// Snapshot format version
const SNAPSHOT_VERSION: u32 = 1;

/// Magic bytes for .axia file identification
const AXIA_MAGIC: [u8; 4] = [b'A', b'X', b'I', b'A'];

/// The AXiA scene — owns the geometry mesh and all XIA entities.
pub struct Scene {
    /// The geometry kernel mesh
    pub mesh: Mesh,
    /// All XIA entities in the scene
    pub xias: HashMap<XiaId, Xia>,
    /// Reverse index: FaceId → XiaId (O(1) lookup)
    face_to_xia: HashMap<FaceId, XiaId>,
    /// Next XIA ID counter
    next_xia_id: u32,
    /// Transaction manager for undo/redo
    pub transactions: TransactionManager,
    /// Material library (all available materials)
    pub material_library: MaterialLibrary,
    /// Default material
    pub default_material: MaterialId,
    /// Group / Component manager
    pub groups: GroupManager,
    /// Constraint Solver Level 2 — persistent constraint graph
    pub constraints: ConstraintGraph,
}

impl Scene {
    pub fn new() -> Self {
        Self {
            mesh: Mesh::new(),
            xias: HashMap::new(),
            face_to_xia: HashMap::new(),
            next_xia_id: 1,
            transactions: TransactionManager::new(100),
            material_library: MaterialLibrary::new(),
            default_material: MaterialId::new(0),
            groups: GroupManager::new(),
            constraints: ConstraintGraph::new(),
        }
    }

    // ════════════════════════════════════════════════
    // 통합 스냅샷 (Mesh + XIA + Groups)
    // ════════════════════════════════════════════════

    /// 전체 씬 상태를 직렬화 (Undo/Redo 용)
    pub fn scene_snapshot(&self) -> Vec<u8> {
        let mesh_data = self.mesh.snapshot();
        let xia_data = bincode::serialize(&self.xias).unwrap_or_else(|e| {
            eprintln!("[Scene] XIA serialize failed: {}", e);
            Vec::new()
        });
        let group_data = bincode::serialize(&self.groups).unwrap_or_else(|e| {
            eprintln!("[Scene] Group serialize failed: {}", e);
            Vec::new()
        });
        // Constraint Solver Level 2 — appended at end for backward compatibility.
        let constraints_data = bincode::serialize(&self.constraints).unwrap_or_else(|e| {
            eprintln!("[Scene] Constraint serialize failed: {}", e);
            Vec::new()
        });
        let next_xia = self.next_xia_id;

        // [mesh_len:u64][mesh_data][xia_len:u64][xia_data][group_len:u64][group_data][next_xia_id:u64][constraints_len:u64][constraints_data]
        let mut buf = Vec::with_capacity(
            8 + mesh_data.len() + 8 + xia_data.len() + 8 + group_data.len() + 8
                + 8 + constraints_data.len(),
        );
        buf.extend_from_slice(&(mesh_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&mesh_data);
        buf.extend_from_slice(&(xia_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&xia_data);
        buf.extend_from_slice(&(group_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&group_data);
        buf.extend_from_slice(&(next_xia as u64).to_le_bytes()); // u64 for snapshot backward compat
        buf.extend_from_slice(&(constraints_data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&constraints_data);
        buf
    }

    /// 스냅샷으로부터 씬 상태 복원 (Undo/Redo 용)
    pub fn restore_scene_snapshot(&mut self, data: &[u8]) {
        let mut offset = 0usize;

        // Helper: read u64 length prefix
        let read_len = |data: &[u8], off: &mut usize| -> usize {
            if *off + 8 > data.len() { return 0; }
            let len = u64::from_le_bytes(data[*off..*off + 8].try_into().unwrap_or([0; 8])) as usize;
            *off += 8;
            len
        };

        // 1. Mesh
        let mesh_len = read_len(data, &mut offset);
        if mesh_len > 0 && offset + mesh_len <= data.len() {
            self.mesh.restore_snapshot(&data[offset..offset + mesh_len]);
            offset += mesh_len;
        } else {
            // 레거시 스냅샷 (mesh만 포함) — 하위 호환
            self.mesh.restore_snapshot(data);
            return;
        }

        // 2. XIAs
        let xia_len = read_len(data, &mut offset);
        if xia_len > 0 && offset + xia_len <= data.len() {
            if let Ok(restored) = bincode::deserialize::<HashMap<XiaId, Xia>>(&data[offset..offset + xia_len]) {
                self.xias = restored;
            }
            offset += xia_len;
        }

        // 3. Groups
        let group_len = read_len(data, &mut offset);
        if group_len > 0 && offset + group_len <= data.len() {
            if let Ok(restored) = bincode::deserialize::<GroupManager>(&data[offset..offset + group_len]) {
                self.groups = restored;
            }
            offset += group_len;
        }

        // 4. next_xia_id
        if offset + 8 <= data.len() {
            self.next_xia_id = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap_or([0; 8])) as u32; // u64→u32 for backward compat
            offset += 8;
        }

        // 5. Constraint graph (Level 2, backward-compat: old snapshots don't have this)
        if offset + 8 <= data.len() {
            let clen = read_len(data, &mut offset);
            if clen > 0 && offset + clen <= data.len() {
                if let Ok(restored) = bincode::deserialize::<ConstraintGraph>(&data[offset..offset + clen]) {
                    self.constraints = restored;
                }
                offset += clen;
            }
        } else {
            // Legacy snapshot — reset constraints
            self.constraints = ConstraintGraph::new();
        }

        // 6. 역인덱스 재구축 (face_ids가 이제 직렬화되므로)
        self.rebuild_face_to_xia_index();
    }

    /// Create a new XIA entity in the scene.
    fn create_xia(&mut self, name: String) -> XiaId {
        let id = self.next_xia_id;
        self.next_xia_id = self.next_xia_id.saturating_add(1);
        let xia = Xia::new(id, name);
        self.xias.insert(id, xia);
        id
    }

    /// Create a XIA and assign face IDs (public — for primitives/import).
    /// State is computed from face_ids.len() — no explicit state parameter needed.
    pub fn create_xia_with_faces(&mut self, name: String, position: DVec3, face_ids: Vec<FaceId>) -> XiaId {
        let xia_id = self.create_xia(name);
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = position;
            xia.face_ids = face_ids.clone();
        }
        // 역인덱스 갱신
        for &fid in &face_ids {
            self.face_to_xia.insert(fid, xia_id);
        }
        xia_id
    }

    /// Register face→XIA mapping in the reverse index
    fn register_faces_to_xia(&mut self, xia_id: XiaId, face_ids: &[FaceId]) {
        for &fid in face_ids {
            self.face_to_xia.insert(fid, xia_id);
        }
    }

    /// Remove face from reverse index and from owning XIA's face_ids.
    /// If the XIA's face_ids becomes empty, dissolve the XIA.
    pub fn unregister_face_from_xia(&mut self, face_id: FaceId) {
        if let Some(xia_id) = self.face_to_xia.remove(&face_id) {
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.face_ids.retain(|&f| f != face_id);
                // 2-3: face_ids가 비면 Dissolved 처리
                if xia.face_ids.is_empty() {
                    lifecycle::dissolve(xia);
                }
            }
        }
    }

    /// Batch unregister multiple faces from their owning XIAs.
    /// More efficient than calling unregister_face_from_xia() one by one.
    pub fn unregister_faces_from_xia(&mut self, face_ids: &[FaceId]) {
        // Collect affected XIAs
        let mut affected: HashMap<XiaId, Vec<FaceId>> = HashMap::new();
        for &fid in face_ids {
            if let Some(xia_id) = self.face_to_xia.remove(&fid) {
                affected.entry(xia_id).or_default().push(fid);
            }
        }
        // Remove faces from each XIA and dissolve if empty
        for (xia_id, removed_fids) in affected {
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                for fid in &removed_fids {
                    xia.face_ids.retain(|&f| f != *fid);
                }
                if xia.face_ids.is_empty() {
                    lifecycle::dissolve(xia);
                }
            }
        }
    }

    /// Find the XIA that owns a face (O(1) lookup)
    pub fn get_xia_for_face(&self, face_id: FaceId) -> Option<XiaId> {
        self.face_to_xia.get(&face_id).copied()
    }

    /// Rebuild reverse index from all XIAs (after snapshot restore)
    fn rebuild_face_to_xia_index(&mut self) {
        self.face_to_xia.clear();
        for (xia_id, xia) in &self.xias {
            for &fid in &xia.face_ids {
                self.face_to_xia.insert(fid, *xia_id);
            }
        }
    }

    /// Compute the set of boundary edges for a XIA (from its face_ids).
    /// Does NOT include standalone_edge_id — that's tracked separately.
    /// Returns empty set if faces have no valid edges.
    pub fn edges_for_xia(&self, xia_id: XiaId) -> Vec<axia_geo::EdgeId> {
        let Some(xia) = self.xias.get(&xia_id) else { return vec![] };
        let mut edges = std::collections::HashSet::new();
        for &fid in &xia.face_ids {
            if let Ok(face_edges) = self.mesh.face_outer_edges(fid) {
                for eid in face_edges {
                    edges.insert(eid);
                }
            }
        }
        edges.into_iter().collect()
    }

    /// Get the total edge count for a XIA (computed from faces + standalone).
    pub fn edge_count_for_xia(&self, xia_id: XiaId) -> usize {
        let standalone = self.xias.get(&xia_id)
            .and_then(|x| x.standalone_edge_id)
            .map(|_| 1usize)
            .unwrap_or(0);
        self.edges_for_xia(xia_id).len() + standalone
    }

    /// 그룹 가시성을 재귀적으로 적용 (자식 그룹 + face)
    fn set_group_visibility_recursive(&mut self, group_id: GroupId, visible: bool) {
        if let Some(g) = self.groups.groups.get_mut(&group_id) {
            g.visible = visible;
            let face_ids = g.face_ids.clone();
            let children = g.children.clone();

            for fid in &face_ids {
                if let Some(face) = self.mesh.faces.get_mut(*fid) {
                    face.set_visible(visible);
                }
            }

            for child_id in children {
                self.set_group_visibility_recursive(child_id, visible);
            }
        }
    }

    /// 그룹 잠금 시 face 선택 가능 여부 확인
    pub fn is_face_locked(&self, face_id: axia_geo::FaceId) -> bool {
        if let Some(gid) = self.groups.get_group_for_face(face_id) {
            if let Some(g) = self.groups.groups.get(&gid) {
                return g.locked;
            }
        }
        false
    }

    /// Execute a command and return the result.
    pub fn execute(&mut self, cmd: Command) -> CommandResult {
        match cmd {
            Command::DrawLine { start, end, surface_normal } => {
                self.exec_draw_line(start, end, surface_normal)
            }
            Command::DrawRect { center, normal, up, width, height } => {
                self.exec_draw_rect(center, normal, up, width, height)
            }
            Command::DrawCircle { center, normal, radius, segments } => {
                self.exec_draw_circle(center, normal, radius, segments)
            }
            Command::PushPull { face_id, dist } => {
                self.exec_push_pull(face_id, dist)
            }
            Command::Undo => {
                if let Some(frame) = self.transactions.undo() {
                    let snapshot = frame.before_snapshot.clone();
                    if !snapshot.is_empty() {
                        self.restore_scene_snapshot(&snapshot);
                    }
                    CommandResult::MeshUpdated
                } else {
                    CommandResult::None
                }
            }
            Command::Redo => {
                if let Some(frame) = self.transactions.redo() {
                    let snapshot = frame.after_snapshot.clone();
                    if !snapshot.is_empty() {
                        self.restore_scene_snapshot(&snapshot);
                    }
                    CommandResult::MeshUpdated
                } else {
                    CommandResult::None
                }
            }
            Command::Select { xia_id, additive } => {
                if !additive {
                    for xia in self.xias.values_mut() {
                        xia.selected = false;
                    }
                }
                if let Some(xia) = self.xias.get_mut(&xia_id) {
                    xia.selected = true;
                }
                CommandResult::None
            }
            Command::DeselectAll => {
                for xia in self.xias.values_mut() {
                    xia.selected = false;
                }
                CommandResult::None
            }
            Command::Move { xia_ids, delta } => {
                self.exec_move(xia_ids, delta)
            }

            // ── Group / Component ──
            Command::CreateGroup { name, face_ids } => {
                let gid = self.groups.create_group(name, face_ids);
                CommandResult::GroupUpdated(gid)
            }
            Command::DeleteGroup { group_id } => {
                if self.groups.delete_group(group_id) {
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::RenameGroup { group_id, new_name } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    g.name = new_name;
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::ToggleGroupVisibility { group_id } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    let new_visible = !g.visible;
                    g.visible = new_visible;

                    // 해당 그룹의 모든 face에 가시성 반영
                    let face_ids = g.face_ids.clone();
                    for fid in &face_ids {
                        if let Some(face) = self.mesh.faces.get_mut(*fid) {
                            face.set_visible(new_visible);
                        }
                    }

                    // 재귀: 자식 그룹에도 동일 적용
                    let children = g.children.clone();
                    for child_id in children {
                        self.set_group_visibility_recursive(child_id, new_visible);
                    }

                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::ToggleGroupLock { group_id } => {
                if let Some(g) = self.groups.groups.get_mut(&group_id) {
                    g.locked = !g.locked;
                    CommandResult::GroupUpdated(group_id)
                } else {
                    CommandResult::Error(format!("Group {} not found", group_id))
                }
            }
            Command::MakeComponent { group_id, name } => {
                match self.groups.make_component(group_id, name) {
                    Some(_def_id) => CommandResult::GroupUpdated(group_id),
                    None => CommandResult::Error(format!("Group {} not found", group_id)),
                }
            }
            Command::PlaceComponent { def_id, position } => {
                // TODO: 실제 geometry 복제 구현 필요
                // 현재는 인스턴스 메타데이터만 생성
                let transform = Transform3D::new().with_position(position);
                match self.groups.create_instance(def_id, "Instance".into(), vec![], transform) {
                    Some(inst_id) => CommandResult::GroupUpdated(inst_id),
                    None => CommandResult::Error(format!("ComponentDef {} not found", def_id)),
                }
            }

            // ── Material commands ──
            Command::AssignMaterial { face_ids, material_id } => {
                if self.material_library.get(material_id).is_none() {
                    return CommandResult::Error(format!("Material {} not found", material_id.raw()));
                }
                // Update face material in mesh
                for face_id in face_ids.iter() {
                    if let Some(face) = self.mesh.faces.get_mut(*face_id) {
                        face.set_material(material_id);
                    }
                }
                // Material is a property — no state transition needed.
                // XIA.has_material() checks material ID.
                CommandResult::MaterialAssigned {
                    face_count: face_ids.len(),
                }
            }

            Command::RemoveMaterial { face_ids } => {
                let default_mat = self.default_material;
                // Revert to default material
                for face_id in face_ids.iter() {
                    if let Some(face) = self.mesh.faces.get_mut(*face_id) {
                        face.set_material(default_mat);
                    }
                }
                // Material is a property — no state transition needed.
                // XIA.has_material() checks material ID.
                CommandResult::MaterialRemoved {
                    face_count: face_ids.len(),
                }
            }

            Command::CreateMaterial {
                name,
                name_en,
                category,
                physical,
                visual,
            } => {
                let material_id = self.material_library.create_material(
                    name,
                    name_en,
                    category,
                    physical,
                    visual,
                );
                CommandResult::MaterialCreated(material_id)
            }
        }
    }

    /// vertex가 임의의 활성 face의 interior(boundary 아님 + 2D 내부)에 있는지 검사.
    fn is_vertex_interior_to_any_face(&self, v: VertId) -> bool {
        let p = match self.mesh.vertex_pos(v) { Ok(p) => p, Err(_) => return false };
        for (_fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            let boundary = match self.mesh.collect_loop_verts(face.outer().start) {
                Ok(b) => b, Err(_) => continue,
            };
            if boundary.contains(&v) { continue; }
            if boundary.len() < 3 { continue; }
            // Coplanar + inside polygon test
            let Ok(p0) = self.mesh.vertex_pos(boundary[0]) else { continue };
            let Ok(p1) = self.mesh.vertex_pos(boundary[1]) else { continue };
            let e1 = (p1 - p0).normalize_or_zero();
            if e1.length_squared() < 1e-10 { continue; }
            let mut e2 = DVec3::ZERO;
            for &vid in &boundary[2..] {
                if let Ok(pp) = self.mesh.vertex_pos(vid) {
                    let vv = pp - p0;
                    let proj = e1 * vv.dot(e1);
                    let ortho = vv - proj;
                    if ortho.length_squared() > 1e-6 { e2 = ortho.normalize_or_zero(); break; }
                }
            }
            if e2.length_squared() < 1e-10 { continue; }
            let n = e1.cross(e2).normalize_or_zero();
            let max_chord_sq = boundary.iter().filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .map(|q| (q - p0).length_squared()).fold(0.0_f64, f64::max);
            let tol = (max_chord_sq.sqrt() * 1e-4).max(1e-3);
            let dist = (p - p0).dot(n).abs();
            if dist > tol { continue; }
            let project2d = |q: DVec3| -> (f64, f64) {
                let vv = q - p0; (vv.dot(e1), vv.dot(e2))
            };
            let poly: Vec<(f64, f64)> = boundary.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok().map(project2d))
                .collect();
            let (px, py) = project2d(p);
            let mut inside = false;
            let nn = poly.len();
            let mut j = nn - 1;
            for i in 0..nn {
                let (xi, yi) = poly[i];
                let (xj, yj) = poly[j];
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            if inside { return true; }
        }
        false
    }

    /// 주어진 vertex 루프가 기존 face 중 하나 이상의 centroid를 감싸고 있는지 검사.
    /// True이면 이 루프는 "외부 unbounded boundary"로 판정 → 면 생성 스킵.
    ///
    /// 구현: 루프 3점으로 근사 평면 정의 → 평면의 두 basis로 2D 투영 →
    /// 기존 face들의 centroid를 같은 평면에 투영 후 point-in-polygon 검사.
    fn loop_encloses_existing_face(&self, loop_verts: &[VertId]) -> bool {
        if loop_verts.len() < 3 { return false; }
        // 루프 vertex의 3D 좌표 수집
        let pts: Vec<DVec3> = loop_verts.iter()
            .filter_map(|v| self.mesh.vertex_pos(*v).ok())
            .collect();
        if pts.len() < 3 { return false; }
        // 평면 basis 구성
        let origin = pts[0];
        let e1 = (pts[1] - origin).normalize_or_zero();
        if e1.length_squared() < 1e-10 { return false; }
        let mut e2 = DVec3::ZERO;
        for p in &pts[2..] {
            let v = *p - origin;
            let proj = e1 * v.dot(e1);
            let ortho = v - proj;
            if ortho.length_squared() > 1e-6 {
                e2 = ortho.normalize_or_zero();
                break;
            }
        }
        if e2.length_squared() < 1e-10 { return false; }
        let project2d = |p: DVec3| -> (f64, f64) {
            let v = p - origin;
            (v.dot(e1), v.dot(e2))
        };
        let poly: Vec<(f64, f64)> = pts.iter().map(|&p| project2d(p)).collect();
        // point-in-polygon (ray cast)
        let point_in = |x: f64, y: f64| -> bool {
            let mut inside = false;
            let n = poly.len();
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
        // 기존 활성 face의 centroid 투영 후 검사
        for (face_id, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            // centroid 계산 (face vertices 평균)
            let Ok(verts) = self.mesh.collect_loop_verts(face.outer().start) else { continue };
            if verts.is_empty() { continue; }
            let mut cx = DVec3::ZERO;
            for &v in &verts {
                if let Ok(p) = self.mesh.vertex_pos(v) { cx += p; }
            }
            cx /= verts.len() as f64;
            // 평면 거리 검사 (루프 평면에서 너무 멀면 무관)
            let normal = e1.cross(e2).normalize_or_zero();
            let dist = (cx - origin).dot(normal).abs();
            if dist > 1.0 { continue; } // 다른 평면의 face — 무시
            let (px, py) = project2d(cx);
            if point_in(px, py) {
                let _ = face_id;
                return true;
            }
        }
        false
    }

    fn exec_draw_line(
        &mut self,
        start: DVec3,
        end: DVec3,
        surface_normal: Option<DVec3>,
    ) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // ── Step 1: 기존 엣지 교차점 + 기존 vertex on-line 탐지 ──
        // (a) 새 line이 기존 엣지 interior와 교차 → split_edge로 vertex 삽입
        // (b) 새 line interior에 기존 vertex가 이미 놓여 있음 → split_edge 불필요,
        //     새 line 자체를 이 vertex에서 sub-segment로 분할
        let crossings = self.mesh.find_line_crossings(start, end);
        let verts_on_line = self.mesh.find_vertices_on_line(start, end);

        // ── Step 2: 교차된 엣지 split + 모든 break point 수집 (t 오름차순) ──
        // BreakPoint: t on new line, 3D position.
        let mut break_points: Vec<(f64, DVec3)> = Vec::new();
        for (edge_id, pos, t) in &crossings {
            match self.mesh.split_edge(*edge_id, *pos) {
                Ok(_) => break_points.push((*t, *pos)),
                Err(_) => continue,
            }
        }
        for (_vid, pos, t) in &verts_on_line {
            break_points.push((*t, *pos));
        }
        break_points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        // Dedup nearby breakpoints (same position from both lists)
        let dedup_tol = (end - start).length() * 1e-5;
        break_points.dedup_by(|a, b| (a.1 - b.1).length() < dedup_tol);

        // ── Step 3: sub-segment 리스트 구성 ──
        let mut segments: Vec<(DVec3, DVec3)> = Vec::new();
        let mut prev = start;
        for (_t, pos) in &break_points {
            segments.push((prev, *pos));
            prev = *pos;
        }
        segments.push((prev, end));

        // ── Step 4: 각 sub-segment를 개별 처리 ──
        // - 양 끝점이 같은 face의 boundary에 있으면 split_face_by_line 시도 (Cross-face split)
        // - 아니면 draw_line + detect_free_edge_loop 반복 (기존 로직)
        let mut all_created_faces: Vec<FaceId> = Vec::new();
        let mut all_loop_edge_ids: Vec<EdgeId> = Vec::new();
        let mut first_edge_id: Option<EdgeId> = None;
        let mut touched_verts: Vec<VertId> = Vec::new();
        let mut new_edges: Vec<EdgeId> = Vec::new();

        for (seg_start, seg_end) in &segments {
            // 길이 0 세그먼트 + snap 오차로 인한 "사실상 동일" 세그먼트 거부.
            // EPSILON_LENGTH(1e-6)보다 훨씬 큰 threshold(0.1mm)를 둬서 spatial_hash
            // dedup과 일관되게 자기참조 엣지 생성을 원천 차단.
            if (*seg_end - *seg_start).length() < 0.1 { continue; }

            // 먼저 draw_line으로 엣지 생성 (양쪽 끝에 vertex가 이미 있든 없든 add_vertex가
            // 기존 vertex를 재사용 — spatial_hash 기반 dedup).
            let (v_a, v_b, new_edge_id) = match self.mesh.draw_line(*seg_start, *seg_end) {
                Ok(r) => r,
                Err(_) => continue,
            };
            // add_vertex dedup 이후 양 끝이 같은 vertex면 스킵 (drawLine 가드 통과했어도
            // f64 snap이 두 점을 같은 vertex로 해석한 경우)
            if v_a == v_b { continue; }
            if first_edge_id.is_none() { first_edge_id = Some(new_edge_id); }
            self.mesh.mark_edge_hard(new_edge_id);
            if !touched_verts.contains(&v_a) { touched_verts.push(v_a); }
            if !touched_verts.contains(&v_b) { touched_verts.push(v_b); }
            if !new_edges.contains(&new_edge_id) { new_edges.push(new_edge_id); }

            // ── (a) Cross-face split 시도: 두 vertex 모두 같은 face boundary 위인지 ──
            if let Some(face_id) = self.mesh.find_face_containing_both_verts(v_a, v_b) {
                match axia_geo::operations::face_split::split_face_by_line(
                    &mut self.mesh,
                    face_id,
                    *seg_start,
                    *seg_end,
                ) {
                    Ok(result) => {
                        for fid in result.new_faces {
                            if !all_created_faces.contains(&fid) {
                                all_created_faces.push(fid);
                            }
                        }
                        continue; // split 성공 — 다음 세그먼트로
                    }
                    Err(_) => {
                        // split 실패 시 loop detection으로 fallback
                    }
                }
            }

            // ── (b) Free-edge loop detection — 반복 탐색 ──
            // 단, 새 엣지의 한쪽 endpoint가 기존 face의 interior에 있는 경우 loop
            // detection을 스킵 — fan_split이 나중에 처리해서 중복 생성을 방지.
            if self.is_vertex_interior_to_any_face(v_a) || self.is_vertex_interior_to_any_face(v_b) {
                continue;
            }
            let mut seen_loops: Vec<Vec<VertId>> = Vec::new();
            let mut seg_faces: usize = 0;
            let mut excluded_edges: Vec<EdgeId> = Vec::new();
            loop {
                let loop_verts = match self.mesh.detect_free_edge_loop_excluding(
                    v_a, v_b, new_edge_id, &excluded_edges,
                ) {
                    Some(v) => v,
                    None => break,
                };
                let mut norm = loop_verts.clone();
                norm.sort_by_key(|v| v.raw());
                if seen_loops.iter().any(|s| s == &norm) { break; }
                seen_loops.push(norm.clone());
                if self.loop_encloses_existing_face(&loop_verts) {
                    // 이 루프의 엣지들을 excluded에 추가하고 재탐색
                    for i in 0..loop_verts.len() {
                        let va = loop_verts[i];
                        let vb = loop_verts[(i + 1) % loop_verts.len()];
                        if let Some(eid) = self.mesh.find_edge(va, vb) {
                            if !excluded_edges.contains(&eid) {
                                excluded_edges.push(eid);
                            }
                        }
                    }
                    // Safety cap
                    if excluded_edges.len() > 20 { break; }
                    continue;
                }

                for i in 0..loop_verts.len() {
                    let va = loop_verts[i];
                    let vb = loop_verts[(i + 1) % loop_verts.len()];
                    if let Some(eid) = self.mesh.find_edge(va, vb) {
                        if !all_loop_edge_ids.contains(&eid) {
                            all_loop_edge_ids.push(eid);
                        }
                    }
                }
                match self.mesh.add_face(&loop_verts, self.default_material) {
                    Ok(fid) => {
                        // Normal 방향 일관성:
                        // 1) 인접 face가 있으면 그들과 같은 방향으로 flip (solid manifold).
                        // 2) 인접 face 없거나 inconclusive면 surface_normal 힌트 / +Y 기본값.
                        let aligned = self.mesh.align_face_with_neighbors(fid);
                        if !aligned {
                            let face_n = self.mesh.faces[fid].normal();
                            let target = surface_normal.unwrap_or(DVec3::Y);
                            if face_n.dot(target) < 0.0 {
                                let _ = self.mesh.flip_face_safe(fid);
                            }
                        }
                        all_created_faces.push(fid);
                        seg_faces += 1;
                        if seg_faces >= 2 { break; }
                    }
                    Err(_) => break,
                }
            }
        }

        // ── Step 4.5: Fan-tessellation 검출 ──
        // 이 시점엔 새 엣지들이 모두 draw_line으로 생성된 상태. 기존 face의 interior에
        // ≥2 boundary spoke를 가진 vertex가 있으면 그 face를 dissolve+fan split.
        // loop detection은 Step 4(b)에서 "interior vertex" 케이스를 이미 skip했으므로
        // 여기서 처리해도 중복 face 생성 없음.
        {
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(fid, _)| fid)
                .collect();
            for fid in candidates {
                let new_faces = self.mesh.dissolve_and_fan_split(fid);
                if !new_faces.is_empty() {
                    if let Some(xia_id) = self.get_xia_for_face(fid) {
                        self.unregister_face_from_xia(fid);
                        if self.xias.get(&xia_id).is_some() {
                            self.register_faces_to_xia(xia_id, &new_faces);
                            if let Some(xia) = self.xias.get_mut(&xia_id) {
                                for &f in &new_faces { xia.face_ids.push(f); }
                            }
                        }
                    }
                    for f in new_faces {
                        if !all_created_faces.contains(&f) { all_created_faces.push(f); }
                    }
                }
            }
        }

        // ── Step 4.55: Nested face dissolve ──
        // 다른 face를 감싸는 face(outer tri 안에 inner tri를 그린 경우)를 dissolve해서
        // 경계 HE를 해방. D resolver가 이어서 wedge 영역들을 재구성.
        {
            let dissolved = self.mesh.dissolve_containing_faces();
            for fid in dissolved {
                // XIA 연결 정리
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }

        // ── Step 4.6: Planar free-face resolver (Phase D) — SCOPED + REQUIRED ──
        // **이중 필터**:
        //   (1) seed_verts: 현재 drawLine이 관여한 vertex의 component만 처리.
        //   (2) required_edges: cycle이 새로 그린 edge를 최소 하나 포함해야 face 생성.
        // 두 조건 모두 충족해야 face 생성 → 이전에 삭제된 면의 자유 엣지 cycle을
        // "우연히 통과한" 경우도 절대 재생성되지 않음.
        {
            let resolved = self.mesh.resolve_planar_free_faces_scoped(
                self.default_material,
                Some(&touched_verts),
                Some(&new_edges),
            );
            for f in resolved {
                if !all_created_faces.contains(&f) { all_created_faces.push(f); }
            }
        }

        // ── Step 4.7: Overlapping face dedup ──
        // fan_split + loop_detect 경쟁 또는 split_face 잔여물 등으로 같은 boundary를 가진
        // 중복 face가 남으면 하나만 남기고 제거. 중복 제거 시 XIA 연결도 정리.
        {
            let removed = self.mesh.deduplicate_overlapping_faces();
            for fid in removed {
                // XIA face_ids 목록에서 제거
                self.unregister_face_from_xia(fid);
                // all_created_faces에서도 제거
                all_created_faces.retain(|&f| f != fid);
            }
        }

        // ── Step 5: 결과 XIA 생성 ──
        if !all_created_faces.is_empty() {
            // 기존 standalone-edge XIA 정리
            let xias_to_remove: Vec<XiaId> = self.xias.iter()
                .filter(|(_, x)| {
                    if let Some(eid) = x.standalone_edge_id {
                        all_loop_edge_ids.contains(&eid)
                    } else {
                        false
                    }
                })
                .map(|(&id, _)| id)
                .collect();
            for xid in &xias_to_remove {
                self.xias.remove(xid);
            }

            let xia_id = self.create_xia("Face".to_string());
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.position = start;
                xia.surface_normal = surface_normal;
                for &fid in &all_created_faces {
                    xia.face_ids.push(fid);
                }
            }
            self.register_faces_to_xia(xia_id, &all_created_faces);

            self.transactions.set_after_snapshot(self.scene_snapshot());
            self.transactions.commit();
            return CommandResult::EntityCreated(xia_id);
        }

        // 면 생성 안 됐지만 최소 하나의 엣지는 생성됨 → Line XIA
        if let Some(edge_id) = first_edge_id {
            let xia_id = self.create_xia("Line".to_string());
            if let Some(xia) = self.xias.get_mut(&xia_id) {
                xia.position = start;
                xia.surface_normal = surface_normal;
                xia.standalone_edge_id = Some(edge_id);
            }
            self.transactions.set_after_snapshot(self.scene_snapshot());
            self.transactions.commit();
            CommandResult::EntityCreated(xia_id)
        } else {
            self.transactions.cancel();
            CommandResult::Error("draw_line produced no edges".to_string())
        }
    }

    fn exec_draw_rect(
        &mut self,
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
    ) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        match self.mesh.draw_rectangle(center, normal, up, width, height, self.default_material) {
            Ok((face_id, _verts)) => {
                let xia_id = self.create_xia("Rectangle".to_string());
                if let Some(xia) = self.xias.get_mut(&xia_id) {
                    xia.position = center;
                    xia.surface_normal = Some(normal);
                    xia.face_ids.push(face_id);
                    // geometry_state() = Face (1 face)
                }
                self.register_faces_to_xia(xia_id, &[face_id]);
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::EntityCreated(xia_id)
            }
            Err(e) => {
                self.transactions.cancel();
                CommandResult::Error(e.to_string())
            }
        }
    }

    fn exec_draw_circle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    ) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        match self.mesh.draw_circle(center, normal, radius, segments, self.default_material) {
            Ok((face_id, _verts)) => {
                let xia_id = self.create_xia("Circle".to_string());
                if let Some(xia) = self.xias.get_mut(&xia_id) {
                    xia.position = center;
                    xia.surface_normal = Some(normal);
                    xia.face_ids.push(face_id);
                    // geometry_state() = Face (1 face)
                }
                self.register_faces_to_xia(xia_id, &[face_id]);
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::EntityCreated(xia_id)
            }
            Err(e) => {
                self.transactions.cancel();
                CommandResult::Error(e.to_string())
            }
        }
    }

    fn exec_push_pull(
        &mut self,
        face_id: axia_geo::FaceId,
        dist: f64,
    ) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        match self.mesh.push_pull(face_id, dist, self.default_material) {
            Ok(result) => {
                // O(1) reverse index lookup instead of O(N) scan
                let owning_xia_id = self.face_to_xia.get(&face_id).copied();

                if let Some(xia_id) = owning_xia_id {
                    if let Some(xia) = self.xias.get_mut(&xia_id) {
                        // State is computed — adding faces automatically promotes Face→Volume
                        // If base was removed (inward push), drop it from XIA
                        if result.base_removed {
                            xia.face_ids.retain(|&f| f != face_id);
                            self.face_to_xia.remove(&face_id);
                        }
                        // Add new faces
                        xia.face_ids.push(result.top_face);
                        xia.face_ids.extend(result.side_faces.iter());
                    }
                    // 역인덱스 갱신: 새 face들 등록
                    self.face_to_xia.insert(result.top_face, xia_id);
                    for &side in &result.side_faces {
                        self.face_to_xia.insert(side, xia_id);
                    }
                }

                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::PushPullDone {
                    sides_created: result.side_faces.len(),
                    adj_splits: result.adjacent_splits,
                    base_removed: result.base_removed,
                    split_debug: result.split_debug,
                }
            }
            Err(e) => {
                self.transactions.cancel();
                CommandResult::Error(e.to_string())
            }
        }
    }

    fn exec_move(&mut self, _xia_ids: Vec<XiaId>, _delta: DVec3) -> CommandResult {
        // TODO: Implement move by updating vertex positions in the mesh
        CommandResult::None
    }

    /// Export the mesh buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    pub fn export_mesh_buffers(&self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        self.mesh.export_buffers()
    }

    /// Export hard edge line segments for wireframe rendering.
    /// Coplanar edges (angle ≤ threshold) are hidden — like SketchUp's soft/smooth edges.
    pub fn export_edge_lines(&self, angle_threshold_deg: f64) -> Vec<f32> {
        self.mesh.export_edge_lines(angle_threshold_deg)
    }

    /// Export edge lines + edge ID map (segment index → EdgeId raw)
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        self.mesh.export_edge_lines_with_map(angle_threshold_deg)
    }

    /// Orient all faces for consistent normals (SketchUp "Orient Faces").
    pub fn orient_faces(&mut self) -> (usize, usize) {
        match self.mesh.orient_faces() {
            Ok(r) => (r.flipped, r.visited),
            Err(_) => (0, 0),
        }
    }

    /// Get mesh statistics.
    pub fn stats(&self) -> SceneStats {
        SceneStats {
            xia_count: self.xias.len(),
            vert_count: self.mesh.vert_count(),
            edge_count: self.mesh.edge_count(),
            face_count: self.mesh.face_count(),
            group_count: self.groups.group_count(),
            component_count: self.groups.component_def_count(),
            can_undo: self.transactions.can_undo(),
            can_redo: self.transactions.can_redo(),
        }
    }

    /// Export scene state with version header
    pub fn export_versioned_snapshot(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&AXIA_MAGIC);
        buf.extend_from_slice(&SNAPSHOT_VERSION.to_le_bytes());
        let mesh_data = bincode::serialize(&self.mesh)?;
        buf.extend_from_slice(&(mesh_data.len() as u32).to_le_bytes());
        buf.extend(mesh_data);
        Ok(buf)
    }

    /// Import scene state with version validation
    pub fn import_versioned_snapshot(&mut self, data: &[u8]) -> Result<()> {
        if data.len() < 12 {
            // Try legacy format (no header)
            return self.import_legacy_snapshot(data);
        }
        if &data[0..4] != &AXIA_MAGIC {
            // Legacy format without header
            return self.import_legacy_snapshot(data);
        }
        let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        match version {
            1 => {
                let mesh_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
                if data.len() < 12 + mesh_len {
                    anyhow::bail!("Snapshot data is truncated");
                }
                let mesh_data = &data[12..12+mesh_len];
                self.mesh = bincode::deserialize(mesh_data)?;
                Ok(())
            }
            _ => anyhow::bail!("Unsupported snapshot version: {}", version),
        }
    }

    /// Import legacy snapshot format (no version header, direct bincode)
    fn import_legacy_snapshot(&mut self, data: &[u8]) -> Result<()> {
        self.mesh = bincode::deserialize(data)?;
        Ok(())
    }
}

impl Default for Scene {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct SceneStats {
    pub xia_count: usize,
    pub vert_count: usize,
    pub edge_count: usize,
    pub face_count: usize,
    pub group_count: usize,
    pub component_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scene_creation() {
        let scene = Scene::new();
        assert_eq!(scene.xias.len(), 0, "new scene should have no XIAs");
        assert_eq!(scene.mesh.vert_count(), 0, "new scene should have empty mesh");
        assert_eq!(scene.mesh.face_count(), 0);
        assert!(!scene.transactions.can_undo(), "new scene should not have undo");
    }

    #[test]
    fn test_scene_default() {
        let scene = Scene::default();
        assert_eq!(scene.xias.len(), 0);
        assert_eq!(scene.mesh.vert_count(), 0);
    }

    #[test]
    fn test_scene_stats_empty() {
        let scene = Scene::new();
        let stats = scene.stats();
        assert_eq!(stats.xia_count, 0);
        assert_eq!(stats.vert_count, 0);
        assert_eq!(stats.edge_count, 0);
        assert_eq!(stats.face_count, 0);
        assert!(!stats.can_undo);
        assert!(!stats.can_redo);
    }

    #[test]
    fn test_draw_rectangle_creates_xia() {
        let mut scene = Scene::new();
        let center = DVec3::new(0.0, 0.0, 0.0);
        let normal = DVec3::Z;
        let up = DVec3::Y;

        let result = scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id), "XIA should be created");
                assert_eq!(scene.mesh.face_count(), 1, "should have 1 face");
                let xia = &scene.xias[&xia_id];
                assert_eq!(xia.face_ids.len(), 1, "XIA should own the face");
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_line_creates_edge() {
        let mut scene = Scene::new();
        let start = DVec3::ZERO;
        let end = DVec3::X;

        let result = scene.execute(Command::DrawLine {
            start,
            end,
            surface_normal: None,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id), "XIA should be created");
                assert_eq!(scene.mesh.vert_count(), 2, "should create 2 vertices");
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_circle_creates_face() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let radius = 1.0;
        let segments = 8;

        let result = scene.execute(Command::DrawCircle {
            center,
            normal,
            radius,
            segments,
        });

        match result {
            CommandResult::EntityCreated(xia_id) => {
                assert!(scene.xias.contains_key(&xia_id));
                assert_eq!(scene.mesh.face_count(), 1);
                let xia = &scene.xias[&xia_id];
                assert!(!xia.face_ids.is_empty());
            }
            _ => panic!("expected EntityCreated result"),
        }
    }

    #[test]
    fn test_draw_lines_triangle_auto_face() {
        // Drawing 3 lines that form a closed triangle should auto-create a face
        let mut scene = Scene::new();
        let a = DVec3::ZERO;
        let b = DVec3::new(2.0, 0.0, 0.0);
        let c = DVec3::new(1.0, 2.0, 0.0);

        // Line 1: A→B (edge only)
        let r1 = scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        match &r1 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(xia.standalone_edge_id.is_some(), "First line should be edge");
                assert!(xia.face_ids.is_empty(), "First line should have no face");
            }
            _ => panic!("expected EntityCreated"),
        }

        // Line 2: B→C (edge only)
        let r2 = scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });
        match &r2 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(xia.standalone_edge_id.is_some(), "Second line should be edge");
            }
            _ => panic!("expected EntityCreated"),
        }
        assert_eq!(scene.mesh.face_count(), 0, "No face yet with 2 lines");

        // Line 3: C→A — closes the loop → auto-creates face!
        let r3 = scene.execute(Command::DrawLine { start: c, end: a, surface_normal: None });
        match &r3 {
            CommandResult::EntityCreated(xid) => {
                let xia = &scene.xias[xid];
                assert!(!xia.face_ids.is_empty(), "Third line should create face");
                assert!(xia.standalone_edge_id.is_none(), "Face XIA should not have standalone edge");
            }
            _ => panic!("expected EntityCreated"),
        }
        assert_eq!(scene.mesh.face_count(), 1, "Triangle face should be created");

        // The old edge-only XIAs should be cleaned up
        let edge_xias: Vec<_> = scene.xias.values()
            .filter(|x| x.standalone_edge_id.is_some())
            .collect();
        assert_eq!(edge_xias.len(), 0, "Old edge XIAs should be removed");
    }

    #[test]
    fn test_draw_lines_no_auto_face_open() {
        // Drawing 2 lines (open chain) should NOT create a face
        let mut scene = Scene::new();
        let a = DVec3::ZERO;
        let b = DVec3::X;
        let c = DVec3::new(2.0, 0.0, 0.0);

        scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });

        assert_eq!(scene.mesh.face_count(), 0, "Open chain should not create face");
        assert_eq!(scene.xias.len(), 2, "Should have 2 edge XIAs");
    }

    #[test]
    fn test_push_pull_creates_faces() {
        let mut scene = Scene::new();
        // First, create a rectangle
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;
        let result = scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        let xia_id = match result {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Get the face ID
        let face_id = scene.xias[&xia_id].face_ids[0];

        // Push/pull the face
        let pp_result = scene.execute(Command::PushPull {
            face_id,
            dist: 2.0,
        });

        match pp_result {
            CommandResult::PushPullDone { sides_created, .. } => {
                assert!(sides_created > 0, "should create side faces");
                // Original rectangle + top + sides = 6 faces (box)
                assert_eq!(scene.mesh.face_count(), 6, "box should have 6 faces");
            }
            _ => panic!("expected PushPullDone result"),
        }
    }

    #[test]
    fn test_undo_rectangle() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;

        scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });

        assert_eq!(scene.mesh.face_count(), 1);
        assert!(scene.transactions.can_undo(), "should have undo after draw");

        // Undo
        let result = scene.execute(Command::Undo);
        match result {
            CommandResult::MeshUpdated => {
                assert_eq!(scene.mesh.face_count(), 0, "undo should remove face");
            }
            _ => panic!("expected MeshUpdated result"),
        }
    }

    #[test]
    fn test_undo_redo_sequence() {
        let mut scene = Scene::new();
        let center = DVec3::ZERO;
        let normal = DVec3::Z;
        let up = DVec3::Y;

        // Draw rect
        scene.execute(Command::DrawRect {
            center,
            normal,
            up,
            width: 2.0,
            height: 2.0,
        });
        assert_eq!(scene.mesh.face_count(), 1);

        // Undo
        scene.execute(Command::Undo);
        assert_eq!(scene.mesh.face_count(), 0);

        // Redo
        let result = scene.execute(Command::Redo);
        match result {
            CommandResult::MeshUpdated => {
                assert_eq!(scene.mesh.face_count(), 1, "redo should restore face");
            }
            _ => panic!("expected MeshUpdated result"),
        }
    }

    #[test]
    fn test_push_pull_and_undo() {
        let mut scene = Scene::new();

        // Create rectangle
        let result = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id = match result {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let face_id = scene.xias[&xia_id].face_ids[0];
        assert_eq!(scene.mesh.face_count(), 1);

        // Push/pull
        scene.execute(Command::PushPull {
            face_id,
            dist: 2.0,
        });
        assert_eq!(scene.mesh.face_count(), 6);

        // Undo push/pull
        scene.execute(Command::Undo);
        assert_eq!(scene.mesh.face_count(), 1, "undo should restore to rectangle");
    }

    #[test]
    fn test_selection_single() {
        let mut scene = Scene::new();

        // Create two rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Select first
        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });
        assert!(scene.xias[&xia_id_1].selected);
        assert!(!scene.xias[&xia_id_2].selected);

        // Select second (non-additive)
        scene.execute(Command::Select {
            xia_id: xia_id_2,
            additive: false,
        });
        assert!(!scene.xias[&xia_id_1].selected);
        assert!(scene.xias[&xia_id_2].selected);
    }

    #[test]
    fn test_selection_additive() {
        let mut scene = Scene::new();

        // Create two rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Select first
        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });

        // Select second additive
        scene.execute(Command::Select {
            xia_id: xia_id_2,
            additive: true,
        });
        assert!(scene.xias[&xia_id_1].selected, "first should still be selected");
        assert!(scene.xias[&xia_id_2].selected, "second should be selected");
    }

    #[test]
    fn test_deselect_all() {
        let mut scene = Scene::new();

        // Create and select rectangles
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let xia_id_1 = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        scene.execute(Command::Select {
            xia_id: xia_id_1,
            additive: false,
        });
        assert!(scene.xias[&xia_id_1].selected);

        // Deselect all
        scene.execute(Command::DeselectAll);
        assert!(!scene.xias[&xia_id_1].selected);
    }

    #[test]
    fn test_multiple_operations_consistency() {
        let mut scene = Scene::new();

        // Draw rectangle
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 2.0,
            height: 2.0,
        });
        let _xia_id = match r1 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("expected EntityCreated"),
        };

        // Draw circle
        scene.execute(Command::DrawCircle {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z,
            radius: 1.0,
            segments: 16,
        });

        assert_eq!(scene.xias.len(), 2, "should have 2 XIAs");
        assert_eq!(scene.mesh.face_count(), 2, "should have 2 faces");

        // Undo both
        scene.execute(Command::Undo);
        scene.execute(Command::Undo);

        assert_eq!(scene.mesh.face_count(), 0, "undo should clear all");

        // Redo
        scene.execute(Command::Redo);
        scene.execute(Command::Redo);

        assert_eq!(scene.mesh.face_count(), 2, "redo should restore all");
    }
}
