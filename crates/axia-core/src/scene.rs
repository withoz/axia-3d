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
// File snapshot version.
//   1 = mesh only (legacy — XIAs/Groups/Constraints lost on round-trip)
//   2 = full scene_snapshot (mesh + xias + groups + next_xia_id + constraints)
//       Added 2026-04-24 to stop XIAs from vanishing on save/load and leaving
//       every face an orphan after reload.
const SNAPSHOT_VERSION: u32 = 2;

/// Magic bytes for .axia file identification
const AXIA_MAGIC: [u8; 4] = [b'A', b'X', b'I', b'A'];

/// The AXiA scene — owns the geometry mesh and all XIA entities.
/// Principle 3 (ADR-008) — Face Operation Epoch.
///
/// Accumulates the per-line topology work from a multi-line user command
/// (exec_draw_rect = 4×, exec_draw_circle = N×) so the heavy post-process
/// steps (fan-split, containment dissolve, planar free-face resolver,
/// dedup, B1 hole promotion) run once at the end of the command instead
/// of once per line. The intermediate lines still do their own crossings
/// + split_face_by_line + free-edge loop detection for correctness; only
/// the scene-wide cleanup/synthesis sweeps are deferred.
#[derive(Default, Debug)]
struct EpochContext {
    touched_verts: Vec<VertId>,
    new_edges: Vec<EdgeId>,
    created_faces: Vec<FaceId>,
    loop_edge_ids: Vec<EdgeId>,
    surface_normal: Option<DVec3>,
}

pub struct Scene {
    /// The geometry kernel mesh
    pub mesh: Mesh,
    /// All XIA entities in the scene
    pub xias: HashMap<XiaId, Xia>,
    /// Reverse index: FaceId → XiaId (O(1) lookup)
    pub(crate) face_to_xia: HashMap<FaceId, XiaId>,
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
    /// Active epoch for Principle 3 batching. Set by exec_draw_rect/circle,
    /// cleared in the epoch finalizer. When `Some`, inner exec_draw_line
    /// calls contribute to this buffer and skip their per-line post-process.
    epoch: Option<EpochContext>,
    /// Phase 2 — SketchUp-style "auto intersect on draw". When true, every
    /// draw_rect / draw_circle command automatically runs
    /// intersect_faces_inner on the newly-created faces against the rest of
    /// the scene (still inside the outer transaction, so Ctrl+Z undoes both
    /// the draw and the intersect in one step). User-toggleable.
    pub auto_intersect_on_draw: bool,
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
            epoch: None,
            auto_intersect_on_draw: true,
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

    /// "Intersect with Model" (Phase 1, ADR-008 Axiom 7 extension).
    ///
    /// 선택된 face 집합과 나머지 씬 face 사이의 3D 교차선을 edge 로 생성.
    /// 분할된 sub-face 의 XIA 소유권은 원본 face 의 XIA 를 승계한다.
    /// 단일 undo transaction 으로 묶인다.
    ///
    /// 반환: 분할 결과로 존재하게 된 face 의 수 (디버그용).
    pub fn intersect_faces_with_scene(&mut self, face_ids: &[FaceId]) -> anyhow::Result<usize> {
        if face_ids.is_empty() { return Ok(0); }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let result = self.intersect_faces_inner(face_ids);

        match result {
            Ok(n) => {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                Ok(n)
            }
            Err(e) => {
                self.transactions.cancel();
                Err(e)
            }
        }
    }

    /// `intersect_faces_with_scene` 의 내부 구현 — 트랜잭션 관리를 하지 않는다.
    /// 호출자가 외부 트랜잭션 안에서 호출할 때 사용 (Phase 2 draw-time auto-
    /// intersect 에서 draw 의 기존 transaction 안에 병합). 사용자는 일반적
    /// 으로 `intersect_faces_with_scene` 를 쓰면 된다.
    pub fn intersect_faces_inner(&mut self, face_ids: &[FaceId]) -> anyhow::Result<usize> {
        if face_ids.is_empty() { return Ok(0); }

        // 원본 face 의 XIA 매핑 보존 (분할 후 승계용)
        use std::collections::HashMap;
        let mut xia_backup: HashMap<axia_geo::FaceId, crate::xia::XiaId> = HashMap::new();
        for &fid in face_ids {
            if let Some(xid) = self.face_to_xia.get(&fid).copied() {
                xia_backup.insert(fid, xid);
            }
        }
        // "others" 쪽도 XIA 승계를 위해 현재 매핑 스냅샷 (split 에서 없어질
        // 수 있으므로)
        let others: Vec<axia_geo::FaceId> = self.mesh.faces.iter()
            .filter(|(f, face)| face.is_active() && !face_ids.contains(f))
            .map(|(f, _)| f)
            .collect();
        for &fid in &others {
            if let Some(xid) = self.face_to_xia.get(&fid).copied() {
                xia_backup.insert(fid, xid);
            }
        }

        let result_faces = self.mesh.intersect_faces_with_model(face_ids, self.default_material)?;

        // XIA 승계: split_faces_by_intersections 는 원본 face 를 제거하고
        // 새 face 를 만든다. 원본 face id 가 여전히 active 면 그대로 두고,
        // 사라졌으면 XIA 에서 제거. 새로 생긴 face 는 아직 어떤 XIA 에도
        // 속하지 않은 상태 — 같은 선택 그룹에 속했던 원본의 XIA 로 연결.
        //
        // Heuristic: result_faces 중 기존 face_to_xia 에 없는 것은 "splits
        // of some old face". old face → new face 매핑은 face_centroid 비교
        // 로는 정확하지 않으므로, 단순히 "원본 face 의 XIA 가 한 개로 일관
        // 되면 그 XIA 에 모두 붙인다" 방식. (일반적으로 한 번의 intersect
        // 호출에서 하나의 선택 그룹은 동일 XIA 를 공유.)
        let mut selected_xia: Option<crate::xia::XiaId> = None;
        for &fid in face_ids {
            if let Some(xid) = xia_backup.get(&fid) {
                match selected_xia {
                    None => selected_xia = Some(*xid),
                    Some(existing) if existing == *xid => {}
                    Some(_) => { selected_xia = None; break; }
                }
            }
        }

        // 1. 없어진 원본 face 의 XIA 링크 제거
        for &fid in face_ids.iter().chain(others.iter()) {
            if !self.mesh.faces.contains(fid) || !self.mesh.faces[fid].is_active() {
                self.unregister_face_from_xia(fid);
            }
        }

        // 2. 새 face 를 해당 XIA 에 등록
        //    - selected 계열의 새 face → selected_xia (결정된 경우)
        //    - others 계열의 새 face → 원본 other face 의 XIA 는 현재 구현
        //      으로 정확히 매핑하기 어렵다. 일단 등록하지 않고 "face-only"
        //      상태로 두어 사용자가 재선택 시 재할당 하도록. 향후 per-face
        //      mapping 지원 시 개선.
        if let Some(xid) = selected_xia {
            let new_sel: Vec<axia_geo::FaceId> = result_faces.iter()
                .filter(|&&f| !xia_backup.contains_key(&f) && self.mesh.faces.contains(f) && self.mesh.faces[f].is_active())
                .copied()
                .collect();
            self.register_faces_to_xia(xid, &new_sel);
            if let Some(xia) = self.xias.get_mut(&xid) {
                for &f in &new_sel {
                    if !xia.face_ids.contains(&f) { xia.face_ids.push(f); }
                }
            }
        }

        // 모든 활성 face 수 반환 (호출자 디버그용)
        Ok(result_faces.len())
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
            Command::DrawCenterline { start, end } => {
                self.exec_draw_centerline(start, end)
            }
            Command::SetEdgeClass { edge_id, class_raw } => {
                self.exec_set_edge_class(edge_id, class_raw)
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

    /// ADR-008 B1 — Find the smallest coplanar face that fully encloses
    /// the boundary of `inner_fid`. Returns Some(outer_fid) if such a face
    /// exists, or None if `inner_fid` is not contained in any face.
    fn find_enclosing_face(&self, inner_fid: FaceId) -> Option<FaceId> {
        let inner_face = self.mesh.faces.get(inner_fid)?;
        if !inner_face.is_active() { return None; }
        let inner_verts = self.mesh.collect_loop_verts(inner_face.outer().start).ok()?;
        if inner_verts.len() < 3 { return None; }
        // Sample any inner vertex (use first); all should be inside the
        //   enclosing face since inner is a contiguous polygon inside it.
        let inner_pos = self.mesh.vertex_pos(inner_verts[0]).ok()?;
        let inner_normal = inner_face.normal();
        if inner_normal.length_squared() < 1e-10 { return None; }

        // Compute inner area (rough, 3D) for "strictly smaller" comparison.
        let inner_area = {
            let pts: Vec<DVec3> = inner_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            let mut a_vec = DVec3::ZERO;
            for i in 1..pts.len().saturating_sub(1) {
                a_vec += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0]);
            }
            a_vec.length() * 0.5
        };
        if inner_area < 1e-9 { return None; }

        let mut best: Option<(FaceId, f64)> = None;
        for (outer_fid, outer_face) in self.mesh.faces.iter() {
            if outer_fid == inner_fid { continue; }
            if !outer_face.is_active() { continue; }

            // Coplanar check
            let outer_normal = outer_face.normal();
            if outer_normal.length_squared() < 1e-10 { continue; }
            let n_dot = outer_normal.dot(inner_normal).abs();
            if n_dot < 0.999 { continue; }

            let outer_verts = match self.mesh.collect_loop_verts(outer_face.outer().start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if outer_verts.len() < 3 { continue; }
            let outer_pts: Vec<DVec3> = outer_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if outer_pts.len() < 3 { continue; }

            // Outer area
            let outer_area = {
                let mut a_vec = DVec3::ZERO;
                for i in 1..outer_pts.len() - 1 {
                    a_vec += (outer_pts[i] - outer_pts[0]).cross(outer_pts[i + 1] - outer_pts[0]);
                }
                a_vec.length() * 0.5
            };
            if outer_area <= inner_area { continue; } // outer must be larger

            // Project inner_pos onto outer's plane basis, test point-in-polygon.
            let p0 = outer_pts[0];
            let e1 = (outer_pts[1] - p0).normalize_or_zero();
            if e1.length_squared() < 1e-10 { continue; }
            let mut e2 = DVec3::ZERO;
            for p in &outer_pts[2..] {
                let v = *p - p0;
                let proj = e1 * v.dot(e1);
                let ortho = v - proj;
                if ortho.length_squared() > 1e-6 {
                    e2 = ortho.normalize_or_zero();
                    break;
                }
            }
            if e2.length_squared() < 1e-10 { continue; }
            // Plane distance sanity
            let pn = e1.cross(e2).normalize_or_zero();
            let d = (inner_pos - p0).dot(pn).abs();
            let tol = (outer_area.sqrt() * 1e-4).max(1e-3);
            if d > tol { continue; }

            let poly_2d: Vec<(f64, f64)> = outer_pts.iter()
                .map(|p| ((*p - p0).dot(e1), (*p - p0).dot(e2)))
                .collect();
            let px = (inner_pos - p0).dot(e1);
            let py = (inner_pos - p0).dot(e2);
            let mut inside = false;
            let nv = poly_2d.len();
            let mut j = nv - 1;
            for i in 0..nv {
                let (xi, yi) = poly_2d[i];
                let (xj, yj) = poly_2d[j];
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi) {
                    inside = !inside;
                }
                j = i;
            }
            if !inside { continue; }

            // Keep the smallest valid outer (closest container).
            match best {
                None => best = Some((outer_fid, outer_area)),
                Some((_, a)) if outer_area < a => best = Some((outer_fid, outer_area)),
                _ => {}
            }
        }
        best.map(|(fid, _)| fid)
    }

    /// ADR-008 B1 — Rebuild `outer_fid` so that `inner_fid`'s boundary
    /// becomes one of its inner holes. Preserves edges/verts; `inner_fid`
    /// remains as a separate sub-face the user can edit independently.
    fn promote_face_to_hole(&mut self, outer_fid: FaceId, inner_fid: FaceId) -> anyhow::Result<FaceId> {
        let outer_verts = self.mesh.collect_loop_verts(
            self.mesh.faces.get(outer_fid)
                .ok_or_else(|| anyhow::anyhow!("outer not found"))?.outer().start
        )?;
        let inner_verts = self.mesh.collect_loop_verts(
            self.mesh.faces.get(inner_fid)
                .ok_or_else(|| anyhow::anyhow!("inner not found"))?.outer().start
        )?;
        // Hole winding is opposite to outer.
        let mut hole_verts = inner_verts.clone();
        hole_verts.reverse();
        // Preserve existing inner holes too (face may already have holes).
        let existing_inners: Vec<Vec<axia_geo::VertId>> = self.mesh.faces[outer_fid].inners()
            .iter()
            .filter_map(|lr| self.mesh.collect_loop_verts(lr.start).ok())
            .collect();
        let material = self.mesh.faces[outer_fid].material();

        // Soft-remove: preserve HE next/prev so add_face_with_holes can find
        //   the right free half-edges.
        self.mesh.soft_remove_face(outer_fid)?;

        // Rebuild with inner verts as a new hole.
        let mut all_holes: Vec<Vec<axia_geo::VertId>> = existing_inners;
        all_holes.push(hole_verts);
        let hole_refs: Vec<&[axia_geo::VertId]> = all_holes.iter().map(|h| h.as_slice()).collect();
        let new_outer = self.mesh.add_face_with_holes(&outer_verts, &hole_refs, material)?;
        Ok(new_outer)
    }

    /// Principle 6 classifier — if every one of `corners` lies strictly
    /// inside one and the same coplanar (normal within 1°) active face's
    /// polygon interior, return that face id. Otherwise None.
    ///
    /// "Strictly inside" means the corner is NOT on the face's boundary
    /// (or within endpoint tolerance of a boundary vertex) — that would
    /// require the unified pipeline's split_face_by_line path instead.
    fn single_face_containing_corners(
        &self,
        corners: &[DVec3],
        target_normal: DVec3,
    ) -> Option<FaceId> {
        if corners.is_empty() { return None; }
        let mut candidate: Option<FaceId> = None;
        for (fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            // Coplanar with the rect's normal?
            let n = face.normal();
            if n.length_squared() < 1e-10 { continue; }
            if n.dot(target_normal).abs() < 0.9998 { continue; }

            let verts = match self.mesh.collect_loop_verts(face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if verts.len() < 3 { continue; }
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if pts.len() < 3 { continue; }

            // 2D basis from first edge of face.
            let p0 = pts[0];
            let e1 = (pts[1] - p0).normalize_or_zero();
            if e1.length_squared() < 1e-10 { continue; }
            let mut e2 = DVec3::ZERO;
            for p in &pts[2..] {
                let v = *p - p0;
                let proj = e1 * v.dot(e1);
                let ortho = v - proj;
                if ortho.length_squared() > 1e-6 {
                    e2 = ortho.normalize_or_zero();
                    break;
                }
            }
            if e2.length_squared() < 1e-10 { continue; }
            let face_n = e1.cross(e2).normalize_or_zero();
            let poly: Vec<(f64, f64)> = pts.iter()
                .map(|p| ((*p - p0).dot(e1), (*p - p0).dot(e2)))
                .collect();
            let boundary_verts: Vec<DVec3> = pts.clone();

            // Each corner must be coplanar + inside + not on boundary.
            let mut all_inside = true;
            for c in corners {
                // Plane distance.
                let dist = (*c - p0).dot(face_n).abs();
                if dist > 1e-2 { all_inside = false; break; }
                // Boundary-vertex coincidence guard.
                let on_boundary_vertex = boundary_verts.iter().any(|bp| (c - bp).length() < 1e-3);
                if on_boundary_vertex { all_inside = false; break; }
                let cx = (*c - p0).dot(e1);
                let cy = (*c - p0).dot(e2);
                // Point-in-polygon (ray cast).
                let mut inside = false;
                let nv = poly.len();
                let mut j = nv - 1;
                for i in 0..nv {
                    let (xi, yi) = poly[i];
                    let (xj, yj) = poly[j];
                    if ((yi > cy) != (yj > cy)) &&
                       (cx < (xj - xi) * (cy - yi) / (yj - yi + 1e-12) + xi) {
                        inside = !inside;
                    }
                    j = i;
                }
                if !inside { all_inside = false; break; }
            }
            if all_inside {
                if candidate.is_some() {
                    // More than one candidate — ambiguous; defer to pipeline.
                    return None;
                }
                candidate = Some(fid);
            }
        }
        candidate
    }

    /// Principle 3 (Face Operation Epoch) — consolidate the post-line
    /// synthesis steps into one reusable routine. Called by exec_draw_line
    /// when no epoch is active (single-line command) AND by the epoch
    /// finalizer in exec_draw_rect / exec_draw_circle after all sides are
    /// drawn. Keeps the semantics identical to the former inlined block.
    fn run_face_synthesis_postprocess(
        &mut self,
        touched_verts: &[VertId],
        new_edges: &[EdgeId],
        all_created_faces: &mut Vec<FaceId>,
    ) {
        use std::collections::HashSet;
        // Step 4.5 — fan-tessellation, scoped to faces whose AABB contains
        //   at least one touched vertex (Perf cut from earlier session).
        {
            let touched_pts: Vec<DVec3> = touched_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .filter_map(|(fid, f)| {
                    let verts = self.mesh.collect_loop_verts(f.outer().start).ok()?;
                    let mut mn = DVec3::splat(f64::INFINITY);
                    let mut mx = DVec3::splat(f64::NEG_INFINITY);
                    for &v in &verts {
                        let p = self.mesh.vertex_pos(v).ok()?;
                        mn = mn.min(p);
                        mx = mx.max(p);
                    }
                    let pad = DVec3::splat(1e-3);
                    mn -= pad;
                    mx += pad;
                    let has_inside = touched_pts.iter().any(|p| {
                        p.x >= mn.x && p.x <= mx.x
                            && p.y >= mn.y && p.y <= mx.y
                            && p.z >= mn.z && p.z <= mx.z
                    });
                    if has_inside { Some(fid) } else { None }
                })
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

        // Step 4.55 — nested face dissolve
        {
            let dissolved = self.mesh.dissolve_containing_faces();
            for fid in dissolved {
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }

        // Step 4.6 — D resolver
        {
            let resolved = self.mesh.resolve_planar_free_faces_scoped(
                self.default_material,
                Some(touched_verts),
                Some(new_edges),
            );
            for f in resolved {
                if !all_created_faces.contains(&f) { all_created_faces.push(f); }
            }
        }

        // Step 4.65 — Dissolve faces fully surrounded by newly-created ones.
        //
        // When D resolver builds a cycle that traces through an existing
        // face's boundary edges (e.g. partial-overlap RECT: a chain of
        // new interior edges + a segment of big's boundary forms the
        // overlap sub-face), the ORIGINAL face's loop stays intact but
        // every one of its boundary half-edges now has a radial partner
        // claimed by a newly-created face. In that state the original
        // face is geometrically redundant — it overlaps the new ones.
        //
        // Criterion: a face is "fully surrounded" iff every HE in its
        // outer loop has a non-null `face()` on its radial partner AND
        // that partner belongs to a face created in this operation.
        {
            let created_set: HashSet<FaceId> = all_created_faces.iter().copied().collect();
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(fid, f)| f.is_active() && !created_set.contains(fid))
                .map(|(fid, _)| fid)
                .collect();
            for fid in candidates {
                if !self.mesh.faces.contains(fid) { continue; }
                let outer_start = self.mesh.faces[fid].outer().start;
                if outer_start.is_null() { continue; }
                let hes = match self.mesh.collect_loop_hes(outer_start) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if hes.is_empty() { continue; }
                let mut all_surrounded = true;
                for he_id in hes {
                    let twin = self.mesh.he_twin(he_id);
                    let twin_face = self.mesh.hes.get(twin).map(|h| h.face()).unwrap_or(axia_geo::FaceId::NULL);
                    if twin_face.is_null() || twin_face == fid || !created_set.contains(&twin_face) {
                        all_surrounded = false;
                        break;
                    }
                }
                if all_surrounded {
                    self.unregister_face_from_xia(fid);
                    let _ = self.mesh.remove_face(fid);
                    if self.mesh.faces.contains(fid) {
                        self.mesh.faces.remove(fid);
                    }
                }
            }
        }

        // Step 4.7 — dedup
        {
            let removed = self.mesh.deduplicate_overlapping_faces();
            for fid in removed {
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }

        // Step 4.8 — B1 enclosed-face hole promotion
        {
            let candidates: Vec<FaceId> = all_created_faces.clone();
            for inner_fid in candidates {
                if !self.mesh.faces.contains(inner_fid) { continue; }
                if let Some(outer_fid) = self.find_enclosing_face(inner_fid) {
                    if let Ok(new_outer) = self.promote_face_to_hole(outer_fid, inner_fid) {
                        // Fix 1 (2026-04-24): transfer old face's XIA
                        //   membership to the new ring face so the container
                        //   XIA stays connected to its geometry. Previously
                        //   unregister_face_from_xia dropped the old face
                        //   and left the new ring as an orphan → selection /
                        //   push-pull on the container returned empty.
                        if let Some(old_xia) = self.face_to_xia.remove(&outer_fid) {
                            if let Some(xia) = self.xias.get_mut(&old_xia) {
                                xia.face_ids.retain(|&f| f != outer_fid);
                                xia.face_ids.push(new_outer);
                            }
                            self.face_to_xia.insert(new_outer, old_xia);
                        } else {
                            // No XIA owned the old face — just forget it.
                            self.unregister_face_from_xia(outer_fid);
                        }
                    }
                }
            }
        }

        // Step 4.9 — M1 Mixed-Cycle Split (ADR-008 Axiom 7 partial-overlap).
        //
        // Detect chains of free edges whose two endpoints lie on the same
        // existing face's boundary. Such a chain indicates the user drew a
        // polyline into a face — the enclosed region should become a
        // sub-face with the NEW drawing's material (user decision).
        //
        // Scope: only faces that have at least one of `touched_verts` on
        // their boundary are candidates — an untouched face in another
        // corner of the scene can't have been partitioned by this op.
        {
            self.run_mixed_cycle_splits(touched_verts, new_edges, all_created_faces);
        }

        // Step 4.95 — second B1 hole-promote pass (Phase 3c''-B).
        //   M1 이 만든 새 sub-face 가 기존 face 안에 완전히 포함되는 경우,
        //   해당 inner 를 outer 의 hole 로 승격시켜 면적 이중계산 제거.
        //   Step 4.8 B1 이 이미 돌았지만 그때는 M1 sub-face 가 존재하지
        //   않았으므로 M1 이후 한 번 더 돌린다. Single-pass — 반복 돌리면
        //   먼저 생긴 ring 이 다음 라운드에서 degenerate 후보로 잘못
        //   선정되는 경우가 있어 1 pass 로 제한.
        {
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();
            for inner_fid in candidates {
                if !self.mesh.faces.contains(inner_fid) { continue; }
                if !self.mesh.faces[inner_fid].is_active() { continue; }
                if !self.mesh.faces[inner_fid].inners().is_empty() { continue; }
                let Some(outer_fid) = self.find_enclosing_face(inner_fid) else { continue; };
                if !self.mesh.faces[outer_fid].inners().is_empty() { continue; }
                if let Ok(new_outer) = self.promote_face_to_hole(outer_fid, inner_fid) {
                    if let Some(old_xia) = self.face_to_xia.remove(&outer_fid) {
                        if let Some(xia) = self.xias.get_mut(&old_xia) {
                            xia.face_ids.retain(|&f| f != outer_fid);
                            xia.face_ids.push(new_outer);
                        }
                        self.face_to_xia.insert(new_outer, old_xia);
                    } else {
                        self.unregister_face_from_xia(outer_fid);
                    }
                    all_created_faces.retain(|&f| f != outer_fid);
                    if !all_created_faces.contains(&new_outer) {
                        all_created_faces.push(new_outer);
                    }
                }
            }
        }
    }

    /// Step 4.9 worker — find and execute all mixed-cycle splits in the
    /// scope of this epoch's touched vertices. Extracted for clarity.
    fn run_mixed_cycle_splits(
        &mut self,
        touched_verts: &[VertId],
        new_edges: &[EdgeId],
        all_created_faces: &mut Vec<FaceId>,
    ) {
        use std::collections::HashSet;
        let touched_set: HashSet<VertId> = touched_verts.iter().copied().collect();
        if touched_set.is_empty() { return; }

        // Iterate until no more splits are possible (a single draw op can
        //   cause multiple independent splits on the same face if the user
        //   drew a shape that touches boundary at multiple non-adjacent
        //   points).
        let max_rounds = 8;
        for _round in 0..max_rounds {
            let candidate_faces: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .filter_map(|(fid, f)| {
                    let verts = self.mesh.collect_loop_verts(f.outer().start).ok()?;
                    if verts.iter().any(|v| touched_set.contains(v)) {
                        Some(fid)
                    } else { None }
                })
                .collect();
            let mut any_split = false;
            for face_id in candidate_faces {
                if !self.mesh.faces.contains(face_id) { continue; }
                let Some(chain) = self.find_mixed_cycle_chain(face_id, new_edges) else { continue };
                let split_res = axia_geo::operations::face_split::split_face_by_chain(
                    &mut self.mesh,
                    face_id,
                    &chain,
                    self.default_material,
                );
                match split_res {
                    Ok(res) => {
                        // Old face is gone; remove from all_created_faces
                        //   (in case it was just created by this op) and from
                        //   its XIA.
                        all_created_faces.retain(|&f| f != face_id);
                        self.unregister_face_from_xia(face_id);
                        for &f in &res.new_faces {
                            if !all_created_faces.contains(&f) {
                                all_created_faces.push(f);
                            }
                        }
                        any_split = true;
                    }
                    Err(_e) => {
                        // Failure is not fatal — leave face as-is; the
                        //   free edges inside remain (user can manually
                        //   resolve). No Toast here — the inner user-facing
                        //   resolve_planar step already announced face
                        //   creation results.
                    }
                }
            }
            if !any_split { break; }
        }
    }

    /// Try to find a free-edge chain that enters `face_id`'s boundary at
    /// one vertex, traverses interior (free-edge) vertices, and exits at
    /// another boundary vertex. Returns the chain vertex list if found.
    ///
    /// Strategy:
    ///   1. Enumerate boundary verts that have ≥1 free-edge spoke heading
    ///      to a NON-boundary vertex. Those are candidate entry points.
    ///   2. BFS along free edges starting from each entry, avoiding the
    ///      boundary itself, until we hit another boundary vert — that's
    ///      the exit.
    ///   3. Reject "chain" if the BFS fails or loops through only boundary
    ///      (would be a redundant cut).
    fn find_mixed_cycle_chain(
        &self,
        face_id: FaceId,
        _new_edges: &[EdgeId],
    ) -> Option<Vec<VertId>> {
        use std::collections::{HashMap, HashSet};
        let face = self.mesh.faces.get(face_id)?;
        let boundary = self.mesh.collect_loop_verts(face.outer().start).ok()?;
        if boundary.len() < 3 { return None; }
        let boundary_set: HashSet<VertId> = boundary.iter().copied().collect();

        // Only strictly-free edges qualify as chain edges. An edge that
        // already bounds any face (even on one side) is part of the
        // surrounding topology — including the adjacency seam between two
        // freshly drawn RECTs. Counting those as "free spokes" would make
        // Step 4.9 try to cut along an existing boundary and destroy the
        // neighbour face's ownership.
        let free_neighbours = |v: VertId| -> Vec<VertId> {
            let mut out = Vec::new();
            for (eid, edge) in self.mesh.edges.iter() {
                if !edge.is_active() { continue; }
                if !edge.class().is_topological() { continue; }
                if edge.v_small() != v && edge.v_large() != v { continue; }
                if !self.mesh.is_edge_completely_free(eid) { continue; }
                let other = if edge.v_small() == v { edge.v_large() } else { edge.v_small() };
                out.push(other);
            }
            out
        };

        // BFS from each boundary vert that has a free spoke going interior.
        for &entry in &boundary {
            let spokes = free_neighbours(entry);
            for nb in spokes {
                // Short chain case — other end is already on boundary.
                if boundary_set.contains(&nb) && nb != entry {
                    // Trivial chain of length 2. Only valid if the two boundary
                    //   verts are NOT adjacent on the boundary (would be
                    //   redundant) — a 2-vert chain on adjacent boundary would
                    //   mean the "free edge" parallels an existing face edge.
                    let i_a = boundary.iter().position(|v| *v == entry).unwrap();
                    let i_b = boundary.iter().position(|v| *v == nb).unwrap();
                    let diff = if i_a < i_b { i_b - i_a } else { i_a - i_b };
                    let wrap = boundary.len() - diff;
                    let adjacent = diff == 1 || wrap == 1;
                    if !adjacent {
                        return Some(vec![entry, nb]);
                    }
                    continue;
                }
                // Non-boundary neighbour — BFS further.
                let mut prev: HashMap<VertId, VertId> = HashMap::new();
                prev.insert(nb, entry);
                let mut stack: Vec<VertId> = vec![nb];
                let mut found_exit: Option<VertId> = None;
                while let Some(cur) = stack.pop() {
                    if boundary_set.contains(&cur) && cur != entry {
                        found_exit = Some(cur);
                        break;
                    }
                    for next in free_neighbours(cur) {
                        if next == entry { continue; }
                        if prev.contains_key(&next) { continue; }
                        prev.insert(next, cur);
                        stack.push(next);
                        if boundary_set.contains(&next) {
                            found_exit = Some(next);
                            break;
                        }
                    }
                    if found_exit.is_some() { break; }
                }
                if let Some(exit) = found_exit {
                    // Reconstruct chain path entry → exit
                    let mut chain = vec![exit];
                    let mut cur = exit;
                    while cur != entry {
                        match prev.get(&cur) {
                            Some(&p) => { chain.push(p); cur = p; }
                            None => return None,
                        }
                    }
                    chain.reverse();
                    // Sanity: chain has entry and exit on boundary, interior
                    //   verts not on boundary, and edges exist. Validate.
                    if chain.len() < 2 { continue; }
                    let mut ok = true;
                    for i in 1..chain.len()-1 {
                        if boundary_set.contains(&chain[i]) { ok = false; break; }
                    }
                    if !ok { continue; }
                    return Some(chain);
                }
            }
        }
        None
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
        // 2026-04-24 Re-entrancy: when called from within another exec_*
        //   (e.g., exec_draw_rect's 4-line expansion), the outer command already
        //   owns the transaction frame. Nested begin() would reset current_frame
        //   and lose the outer's accumulated changes, so we skip our own tx
        //   management and let the outer handle commit/cancel.
        let own_transaction = !self.transactions.is_recording();
        if own_transaction {
            self.transactions.begin();
            self.transactions.set_before_snapshot(self.scene_snapshot());
        }

        // ── Step 0: Phase B — Collinear endpoint split ──
        //   If the new line's START or END point lies inside the interior of
        //   an existing COLLINEAR edge (same direction, overlapping
        //   parametric range), split that existing edge at the endpoint
        //   position BEFORE crossing detection. This is what enables two
        //   overlapping RECTs to share DCEL edges properly: rect B's bottom
        //   edge splits rect A's bottom at x=500 (or wherever the overlap
        //   starts), creating a shared vertex rather than two parallel edges.
        let collinear_splits = self.mesh.find_collinear_endpoint_splits(start, end);
        for (edge_id, pos) in &collinear_splits {
            // split_edge may fail if the edge got dissolved by an earlier
            //   split (same pos in same line) — ignore and continue.
            let _ = self.mesh.split_edge(*edge_id, *pos);
        }

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
                    // 2026-04-24 (ADR-008 Axiom 7): 루프의 엣지 중 하나라도
                    // 완전 free(어떤 face에도 속하지 않음)이면 outer-
                    // encloses-inner 정당 의도로 허용 (Phase E). 모든 엣지
                    // 가 이미 face를 갖고 있으면 기존 outer 재생성 의심 →
                    // reject.
                    let mut has_completely_free_edge = false;
                    for i in 0..loop_verts.len() {
                        let va = loop_verts[i];
                        let vb = loop_verts[(i + 1) % loop_verts.len()];
                        if let Some(eid) = self.mesh.find_edge(va, vb) {
                            if self.mesh.is_edge_completely_free(eid) {
                                has_completely_free_edge = true;
                                break;
                            }
                        }
                    }

                    if !has_completely_free_edge {
                        // 모든 엣지가 이미 face를 갖고 있음 — 기존 outer 재생성
                        // 의심 → reject and retry.
                        for i in 0..loop_verts.len() {
                            let va = loop_verts[i];
                            let vb = loop_verts[(i + 1) % loop_verts.len()];
                            if let Some(eid) = self.mesh.find_edge(va, vb) {
                                if !excluded_edges.contains(&eid) {
                                    excluded_edges.push(eid);
                                }
                            }
                        }
                        if excluded_edges.len() > 20 { break; }
                        continue;
                    }
                    // has completely-free edge — fall through to face creation
                }

                // Step 4(b) permissive: `detect_free_edge_loop_excluding` is
                //   responsible for returning only topologically valid cycles
                //   (it walks real free HEs). Adjacent-RECT face creation
                //   depends on this path. Mixed-cycle safety gates live in
                //   the D resolver (Step 4.6) and in Step 4.9 M1 only.

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

        // ── Steps 4.5–4.8: Face synthesis post-process ──
        // Principle 3 (ADR-008): if an outer multi-line command (draw_rect,
        // draw_circle) has an epoch active, defer the whole post-process to
        // the epoch finalizer. Contribute our per-line findings to the
        // epoch buffer so the outer sees everything.
        if self.epoch.is_some() {
            if let Some(ep) = self.epoch.as_mut() {
                for v in &touched_verts {
                    if !ep.touched_verts.contains(v) { ep.touched_verts.push(*v); }
                }
                for e in &new_edges {
                    if !ep.new_edges.contains(e) { ep.new_edges.push(*e); }
                }
                for f in &all_created_faces {
                    if !ep.created_faces.contains(f) { ep.created_faces.push(*f); }
                }
                for e in &all_loop_edge_ids {
                    if !ep.loop_edge_ids.contains(e) { ep.loop_edge_ids.push(*e); }
                }
            }
        } else {
            self.run_face_synthesis_postprocess(
                &touched_verts,
                &new_edges,
                &mut all_created_faces,
            );
        }

        // ── Step 5: 결과 XIA 생성 ──
        // If an epoch is open, the outer command (draw_rect / draw_circle)
        // will create the XIA once all sides are drawn and the deferred
        // post-process has run. Return a sentinel so callers inside the
        // command know "no Line XIA to consolidate", and skip commit
        // (outer owns the transaction).
        if self.epoch.is_some() {
            return CommandResult::EntityCreated(0);
        }

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

            if own_transaction {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
            }
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
            if own_transaction {
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
            }
            CommandResult::EntityCreated(xia_id)
        } else {
            if own_transaction { self.transactions.cancel(); }
            CommandResult::Error("draw_line produced no edges".to_string())
        }
    }

    /// Centerline draw — deliberately skips the intersection/split/synthesize
    /// pipeline. Creates exactly one edge tagged as Centerline; crossing other
    /// edges does not split them. This is the key behavioral contract users
    /// rely on for axis/grid drawing.
    fn exec_draw_centerline(&mut self, start: DVec3, end: DVec3) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let (_, _, edge_id) = match self.mesh.draw_line(start, end) {
            Ok(r) => r,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(format!("draw_centerline: {}", e));
            }
        };
        // Tag the new edge as Centerline — bypasses all downstream topology
        // handlers (face synthesis filter, boolean skip, etc.)
        if let Some(edge) = self.mesh.edges.get_mut(edge_id) {
            edge.set_class(axia_geo::EdgeClass::Centerline);
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(edge_id.raw() as u32)
    }

    /// Flip an edge's semantic class. Only updates the attribute; does NOT
    /// retroactively merge or split. Callers warning: changing a Geometry
    /// edge that is already part of a face to Centerline may leave dangling
    /// face references — current guard rejects the change in that case.
    fn exec_set_edge_class(&mut self, edge_id: axia_geo::EdgeId, class_raw: u32) -> CommandResult {
        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        let class = axia_geo::EdgeClass::from_raw(class_raw);
        // Reject demoting a Geometry edge that bounds an active face —
        // centerlines must not participate in face topology, so demotion
        // would orphan the face. User should delete/reshape first.
        if class == axia_geo::EdgeClass::Centerline {
            let bounds_face = self.mesh.get_faces_sharing_edge(edge_id).0.iter().any(
                |&fid| self.mesh.faces.get(fid).is_some_and(|f| f.is_active())
            );
            if bounds_face {
                self.transactions.cancel();
                return CommandResult::Error(
                    "set_edge_class: edge bounds an active face — delete the face first to convert to Centerline".to_string()
                );
            }
        }
        match self.mesh.edges.get_mut(edge_id) {
            Some(edge) => {
                edge.set_class(class);
                self.transactions.set_after_snapshot(self.scene_snapshot());
                self.transactions.commit();
                CommandResult::MeshUpdated
            }
            None => {
                self.transactions.cancel();
                CommandResult::Error(format!("set_edge_class: edge {:?} not found", edge_id))
            }
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
        // 2026-04-24 — Principle 1 compliance: RECT is drawn as 4 LINE segments.
        //   Face is auto-synthesized when the 4th line closes the loop,
        //   identical to the LINE tool's face-synthesis path. This unifies
        //   vertex dedup + edge sharing behaviour so two adjacent RECTs
        //   share DCEL edges (same as two adjacent triangles from LINE).
        //
        //   Previously exec_draw_rect called mesh.draw_rectangle directly,
        //   which was an independent atomic path — two adjacent rects could
        //   end up with duplicated vertices if snap drift exceeded the 1.5μm
        //   spatial-hash dedup, and merge would fail. Now both rects go
        //   through draw_line → synthesize, so their shared corners are
        //   guaranteed to dedup through the same code path as LINE.

        use anyhow::Result;

        // Compute 4 corners. Mirrors the coordinate system used by the
        //   original draw_rectangle: u = up.normalize(), v = n × u.
        let n_norm = if normal.length_squared() > 1e-12 {
            normal.normalize()
        } else {
            return CommandResult::Error("normal must be non-zero".to_string());
        };
        let u = if up.length_squared() > 1e-12 {
            up.normalize()
        } else {
            return CommandResult::Error("up must be non-zero".to_string());
        };
        let v = n_norm.cross(u).normalize_or_zero();
        if v.length_squared() < 1e-12 {
            return CommandResult::Error("normal and up are parallel".to_string());
        }
        let hw = width / 2.0;
        let hh = height / 2.0;
        let corners = [
            center - u * hh - v * hw,
            center - u * hh + v * hw,
            center + u * hh + v * hw,
            center + u * hh - v * hw,
        ];

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // ═══ Fast-path: RECT in empty scene space ═══════════════════════
        //
        // ADR-008 Axiom 2 ("RECT = 4 LINEs") requires behaviour equivalence,
        // not code-path equivalence. When the rectangle's AABB does not
        // intersect any active edge or vertex, the 4-line pipeline would
        // produce the same result as a single atomic draw_rectangle — just
        // much slower (4× crossings / verts-on-line / fan-split / resolve
        // scans instead of one add_vertex × 4 + add_face call).
        //
        // We detect "no interaction" with a separating-axis AABB test over
        // active edges. If none overlaps the rect's AABB, take the atomic
        // path. Any edge overlap → full pipeline (Phase A behaviour).
        let rect_aabb_min = {
            let mut m = corners[0];
            for c in &corners[1..] { m = m.min(*c); }
            m
        };
        let rect_aabb_max = {
            let mut m = corners[0];
            for c in &corners[1..] { m = m.max(*c); }
            m
        };
        // Pad by a small tol so edges exactly touching the boundary aren't
        //   mis-classified as "no interaction".
        let pad = (width.max(height) * 1e-6).max(1e-3);
        let rect_min = rect_aabb_min - DVec3::splat(pad);
        let rect_max = rect_aabb_max + DVec3::splat(pad);

        let aabb_overlap = |emin: DVec3, emax: DVec3| -> bool {
            !(emax.x < rect_min.x || emin.x > rect_max.x
              || emax.y < rect_min.y || emin.y > rect_max.y
              || emax.z < rect_min.z || emin.z > rect_max.z)
        };
        let edge_interaction = self.mesh.edges.iter().any(|(_, edge)| {
            if !edge.is_active() { return false; }
            if !edge.class().is_topological() { return false; }
            let Ok(va) = self.mesh.vertex_pos(edge.v_small()) else { return false; };
            let Ok(vb) = self.mesh.vertex_pos(edge.v_large()) else { return false; };
            aabb_overlap(va.min(vb), va.max(vb))
        });
        // Also check face interiors — a RECT drawn INSIDE a bigger face
        // shares no edge AABB overlap but still needs the unified
        // pipeline (so B1 can split the container into sub-faces).
        let face_interaction = !edge_interaction && self.mesh.faces.iter().any(|(_, f)| {
            if !f.is_active() { return false; }
            let Ok(verts) = self.mesh.collect_loop_verts(f.outer().start) else { return false; };
            if verts.is_empty() { return false; }
            let mut mn = DVec3::splat(f64::INFINITY);
            let mut mx = DVec3::splat(f64::NEG_INFINITY);
            for &v in &verts {
                if let Ok(p) = self.mesh.vertex_pos(v) {
                    mn = mn.min(p);
                    mx = mx.max(p);
                }
            }
            aabb_overlap(mn, mx)
        });
        let has_interaction = edge_interaction || face_interaction;

        if !has_interaction {
            // Atomic path — identical result to unified path, no scans.
            match self.mesh.draw_rectangle(center, normal, up, width, height, self.default_material) {
                Ok((face_id, _verts)) => {
                    let xia_id = self.create_xia("Rectangle".to_string());
                    if let Some(xia) = self.xias.get_mut(&xia_id) {
                        xia.position = center;
                        xia.surface_normal = Some(n_norm);
                        xia.face_ids.push(face_id);
                    }
                    self.register_faces_to_xia(xia_id, &[face_id]);
                    // Phase 2: auto-intersect with rest of scene (still inside
                    //   this transaction so Ctrl+Z undoes both at once).
                    if self.auto_intersect_on_draw {
                        let _ = self.intersect_faces_inner(&[face_id]);
                    }
                    self.transactions.set_after_snapshot(self.scene_snapshot());
                    self.transactions.commit();
                    return CommandResult::EntityCreated(xia_id);
                }
                Err(e) => {
                    self.transactions.cancel();
                    return CommandResult::Error(format!("draw_rect atomic: {}", e));
                }
            }
        }

        // ═══ Fast-path: RECT interior to a single face (B1 scenario) ═════
        //
        // Principle 6 classification: when the rect touches no active edge
        // and its four corners all lie strictly inside ONE existing face's
        // polygon (same plane, inside point-in-polygon test), the unified
        // pipeline would run 4× drawLine → same outcome as atomic add_face
        // + B1 hole-promote. Skip straight to the atomic branch.
        if !edge_interaction && face_interaction {
            if let Some(container_fid) = self.single_face_containing_corners(&corners, n_norm) {
                // Atomic: add 4 vertices, add_face, then B1 promote.
                match self.mesh.draw_rectangle(center, normal, up, width, height, self.default_material) {
                    Ok((inner_fid, _verts)) => {
                        // Run B1 promotion directly against the known container.
                        // Fix 1 (2026-04-24): hand the container XIA over to
                        //   the ring that promote_face_to_hole built, same
                        //   as the Step 4.8 branch above. Keeps the
                        //   container face pickable / editable after the
                        //   interior RECT lands on top of it.
                        if let Ok(new_outer) = self.promote_face_to_hole(container_fid, inner_fid) {
                            if let Some(old_xia) = self.face_to_xia.remove(&container_fid) {
                                if let Some(xia) = self.xias.get_mut(&old_xia) {
                                    xia.face_ids.retain(|&f| f != container_fid);
                                    xia.face_ids.push(new_outer);
                                }
                                self.face_to_xia.insert(new_outer, old_xia);
                            } else {
                                self.unregister_face_from_xia(container_fid);
                            }
                        } else {
                            self.unregister_face_from_xia(container_fid);
                        }
                        let xia_id = self.create_xia("Rectangle".to_string());
                        if let Some(xia) = self.xias.get_mut(&xia_id) {
                            xia.position = center;
                            xia.surface_normal = Some(n_norm);
                            xia.face_ids.push(inner_fid);
                        }
                        self.register_faces_to_xia(xia_id, &[inner_fid]);
                        if self.auto_intersect_on_draw {
                            let _ = self.intersect_faces_inner(&[inner_fid]);
                        }
                        self.transactions.set_after_snapshot(self.scene_snapshot());
                        self.transactions.commit();
                        return CommandResult::EntityCreated(xia_id);
                    }
                    Err(e) => {
                        self.transactions.cancel();
                        return CommandResult::Error(format!("draw_rect interior: {}", e));
                    }
                }
            }
            // Corners not strictly inside a single face — fall through to
            //   the unified pipeline (handles mixed / boundary cases).
        }
        // ═══════════════════════════════════════════════════════════════

        // Principle 3 (Face Operation Epoch): open an epoch so the inner
        // exec_draw_line calls defer their Steps 4.5–4.8 post-process to
        // the single sweep at the end of this command. Collapses 4× of
        // those scans into 1×.
        self.epoch = Some(EpochContext {
            surface_normal: Some(n_norm),
            ..Default::default()
        });

        // Call exec_draw_line 4 times within our outer transaction. Each
        //   invocation runs the FULL LINE pipeline — crossings, edge split,
        //   face synthesis, cross-face split — but skips its own tx
        //   management (re-entrant, detecting our outer begin()) AND its
        //   post-process (epoch active — deferred to finalizer below).
        //
        //   Note: face synthesis may happen on call 2 OR call 3, not
        //   necessarily on the closing line. E.g., when the 4th segment
        //   reuses an EXISTING edge (adjacent to a previously drawn rect),
        //   the closed cycle forms as soon as the 3rd new segment is drawn.
        //   With the epoch active, inner exec_draw_line calls return a
        //   sentinel EntityCreated(0) and defer post-process + XIA creation.
        //   Any error from an inner call aborts the whole command.
        for i in 0..4 {
            let s_start = corners[i];
            let s_end = corners[(i + 1) % 4];
            if let CommandResult::Error(e) = self.exec_draw_line(s_start, s_end, Some(n_norm)) {
                self.epoch = None;
                self.transactions.cancel();
                return CommandResult::Error(format!("draw_rect side {}: {}", i, e));
            }
        }

        // Finalize epoch — 1× post-process sweep over all accumulated state.
        let mut epoch = self.epoch.take().unwrap_or_default();
        self.run_face_synthesis_postprocess(
            &epoch.touched_verts,
            &epoch.new_edges,
            &mut epoch.created_faces,
        );

        // Clean any stale Line XIAs whose standalone edge is now a face
        //   boundary (these may have been created by earlier commands).
        let xias_to_remove: Vec<XiaId> = self.xias.iter()
            .filter(|(_, x)| {
                if let Some(eid) = x.standalone_edge_id {
                    epoch.loop_edge_ids.contains(&eid)
                } else { false }
            })
            .map(|(&id, _)| id)
            .collect();
        for xid in &xias_to_remove {
            self.xias.remove(xid);
        }

        if epoch.created_faces.is_empty() {
            self.transactions.cancel();
            return CommandResult::Error(
                "draw_rect: 4 segments drawn but no face synthesized".to_string(),
            );
        }

        let xia_id = self.create_xia("Rectangle".to_string());
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = center;
            xia.surface_normal = Some(n_norm);
            for &fid in &epoch.created_faces {
                xia.face_ids.push(fid);
            }
        }
        self.register_faces_to_xia(xia_id, &epoch.created_faces);
        if self.auto_intersect_on_draw {
            let faces = epoch.created_faces.clone();
            let _ = self.intersect_faces_inner(&faces);
        }
        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(xia_id)
    }

    fn exec_draw_circle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
    ) -> CommandResult {
        // 2026-04-24 — Principle 1 compliance: CIRCLE is drawn as N LINE
        //   segments. Same rationale as exec_draw_rect — unifies vertex
        //   dedup / edge sharing behaviour with the LINE tool so adjacent
        //   CIRCLEs and N-gons fuse topologically when their corners align.

        if segments < 3 {
            return CommandResult::Error(
                format!("circle segments {} < 3 — degenerate", segments)
            );
        }
        if radius <= 1e-6 {
            return CommandResult::Error(
                format!("circle radius {:.2e} below epsilon", radius)
            );
        }
        let n_norm = if normal.length_squared() > 1e-12 {
            normal.normalize()
        } else {
            return CommandResult::Error("normal must be non-zero".to_string());
        };
        // Build plane basis (u, v) from normal.
        let seed = if n_norm.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        let u = seed.cross(n_norm).normalize_or_zero();
        let v = n_norm.cross(u).normalize_or_zero();
        if u.length_squared() < 1e-12 || v.length_squared() < 1e-12 {
            return CommandResult::Error("could not build plane basis".to_string());
        }

        // Compute N points on the circle.
        let n = segments as usize;
        let mut corners: Vec<DVec3> = Vec::with_capacity(n);
        for i in 0..n {
            let theta = (i as f64) * std::f64::consts::TAU / (n as f64);
            corners.push(center + u * (radius * theta.cos()) + v * (radius * theta.sin()));
        }

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // Draw N line segments via draw_line → add_vertex dedup for any
        //   corners that coincide with existing vertices (e.g., a touching
        //   circle at the same sampling positions).
        let mut corner_vids: Vec<VertId> = Vec::with_capacity(n);
        let mut edge_ids: Vec<EdgeId> = Vec::with_capacity(n);
        for i in 0..n {
            let (v_a, v_b, eid) =
                match self.mesh.draw_line(corners[i], corners[(i + 1) % n]) {
                    Ok(r) => r,
                    Err(e) => {
                        self.transactions.cancel();
                        return CommandResult::Error(
                            format!("draw_circle segment {}: {}", i, e)
                        );
                    }
                };
            if v_a == v_b {
                self.transactions.cancel();
                return CommandResult::Error(
                    format!("draw_circle segment {} collapsed (degenerate)", i)
                );
            }
            corner_vids.push(v_a);
            edge_ids.push(eid);
            self.mesh.mark_edge_hard(eid);
        }

        // Create face from explicit vertex list (avoids loop-detection
        //   ambiguity at shared boundaries).
        let face_id = match self.mesh.add_face(&corner_vids, self.default_material) {
            Ok(fid) => fid,
            Err(e) => {
                self.transactions.cancel();
                return CommandResult::Error(
                    format!("draw_circle face synthesis failed: {}", e),
                );
            }
        };
        let _ = edge_ids;

        let xia_id = self.create_xia("Circle".to_string());
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            xia.position = center;
            xia.surface_normal = Some(normal);
            xia.face_ids.push(face_id);
        }
        self.register_faces_to_xia(xia_id, &[face_id]);
        if self.auto_intersect_on_draw {
            let _ = self.intersect_faces_inner(&[face_id]);
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();
        CommandResult::EntityCreated(xia_id)
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
        // ADR-007 — 직렬화 전 invariant 검증 (non-strict: 경고만)
        // 엄격 검증 필요 시 export_versioned_snapshot_strict() 사용.
        let report = self.mesh.verify_face_invariants();
        if !report.is_valid() {
            eprintln!(
                "[ADR-007] Export proceeding with {} invariant violation(s).\n{}",
                report.violations.len(),
                report.summary(),
            );
        }

        let mut buf = Vec::new();
        buf.extend_from_slice(&AXIA_MAGIC);
        buf.extend_from_slice(&SNAPSHOT_VERSION.to_le_bytes());
        // V2 payload = scene_snapshot() — mesh + xias + groups + next_xia_id
        // + constraints. Length prefix is u64 (snapshot can easily exceed 4 GB
        // on a complex project even though current scenes are far smaller).
        let payload = self.scene_snapshot();
        buf.extend_from_slice(&(payload.len() as u64).to_le_bytes());
        buf.extend(payload);
        Ok(buf)
    }

    /// ADR-007 Phase 5 — 엄격 export: invariant 위반 시 저장 거부.
    ///
    /// 사용자가 "Save as" 등 중요한 저장 지점에서 쓸 수 있는 변형.
    /// 기본 `export_versioned_snapshot`은 경고만 출력하여 호환성 유지.
    pub fn export_versioned_snapshot_strict(&self) -> Result<Vec<u8>> {
        let report = self.mesh.verify_face_invariants();
        if !report.is_valid() {
            anyhow::bail!(
                "Refusing strict export — {} invariant violation(s). First: {}",
                report.violations.len(),
                report.violations.first().cloned().unwrap_or_else(|| "(no detail)".into()),
            );
        }
        self.export_versioned_snapshot()
    }

    /// Import scene state with version validation
    pub fn import_versioned_snapshot(&mut self, data: &[u8]) -> Result<()> {
        if data.len() < 8 {
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
                // V1 — mesh only, XIAs/Groups/Constraints not present.
                // Kept for backward-compat with files saved before 2026-04-24.
                if data.len() < 12 {
                    anyhow::bail!("V1 snapshot truncated (missing length prefix)");
                }
                let mesh_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
                if data.len() < 12 + mesh_len {
                    anyhow::bail!("V1 snapshot data is truncated");
                }
                let mesh_data = &data[12..12+mesh_len];
                self.mesh = bincode::deserialize(mesh_data)?;
                // Reset semantic layer — a V1 file has no XIAs; keep the
                //   mesh but make the empty state explicit so callers can
                //   detect and offer "reconstruct XIAs from components".
                self.xias.clear();
                self.groups = GroupManager::new();
                self.constraints = ConstraintGraph::new();
                self.face_to_xia.clear();
                eprintln!(
                    "[Loader] V1 snapshot loaded: {} faces restored without XIAs. \
                     Orphan recovery recommended.",
                    self.mesh.face_count(),
                );
                #[cfg(debug_assertions)]
                {
                    let report = self.mesh.verify_face_invariants();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                Ok(())
            }
            2 => {
                // V2 — full scene snapshot (mesh + xias + groups + next_xia_id
                // + constraints). `restore_scene_snapshot` rebuilds the
                // face_to_xia reverse index on its own.
                if data.len() < 16 {
                    anyhow::bail!("V2 snapshot truncated (missing length prefix)");
                }
                let payload_len = u64::from_le_bytes(
                    data[8..16].try_into().map_err(|_| anyhow::anyhow!("length parse"))?
                ) as usize;
                if data.len() < 16 + payload_len {
                    anyhow::bail!("V2 snapshot data is truncated");
                }
                let payload = &data[16..16+payload_len];
                self.restore_scene_snapshot(payload);
                #[cfg(debug_assertions)]
                {
                    let report = self.mesh.verify_face_invariants();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                Ok(())
            }
            v => anyhow::bail!(
                "Unsupported snapshot version: {} (this build supports 1, 2)", v,
            ),
        }
    }

    /// Import legacy snapshot format (no version header, direct bincode)
    fn import_legacy_snapshot(&mut self, data: &[u8]) -> Result<()> {
        self.mesh = bincode::deserialize(data)?;
        #[cfg(debug_assertions)]
        {
            let report = self.mesh.verify_face_invariants();
            if !report.is_valid() {
                eprintln!("[ADR-007] Legacy-import invariant violations:\n{}",
                    report.summary());
            }
        }
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

    // ══════════════════════════════════════════════════════════════
    //   File save/load version tests (v1/v2 round-trip)
    // ══════════════════════════════════════════════════════════════

    /// V2 save → load round-trip preserves XIAs and face ownership.
    /// This is the regression guard for the "all faces orphaned after
    /// reload" issue traced to v1 format writing mesh-only.
    #[test]
    fn v2_roundtrip_preserves_xias_and_face_ownership() {
        let mut scene_a = Scene::default();

        // Draw a few RECTs to populate XIAs.
        for (i, cx) in [-500.0_f64, 500.0, 0.0].iter().enumerate() {
            let r = scene_a.execute(Command::DrawRect {
                center: DVec3::new(*cx, 0.0, 0.0),
                normal: DVec3::new(0.0, 1.0, 0.0),
                up:     DVec3::new(0.0, 0.0, 1.0),
                width: 400.0,
                height: 400.0,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)),
                "rect #{} should create an XIA", i);
        }

        let orig_face_count = scene_a.mesh.face_count();
        let orig_xia_count = scene_a.xias.len();
        let orig_orphans = orig_face_count - scene_a.face_to_xia.len();
        assert!(orig_xia_count >= 3, "expected ≥3 XIAs, got {}", orig_xia_count);

        // Round-trip.
        let bytes = scene_a.export_versioned_snapshot().expect("export v2");
        assert_eq!(&bytes[0..4], &AXIA_MAGIC, "magic header");
        assert_eq!(
            u32::from_le_bytes([bytes[4],bytes[5],bytes[6],bytes[7]]),
            2, "written version must be 2",
        );

        let mut scene_b = Scene::default();
        scene_b.import_versioned_snapshot(&bytes).expect("import v2");

        // Topology preserved.
        assert_eq!(scene_b.mesh.face_count(), orig_face_count,
            "face count should match after v2 round-trip");
        // XIAs preserved.
        assert_eq!(scene_b.xias.len(), orig_xia_count,
            "XIA count should match after v2 round-trip");
        // Reverse index rebuilt — no new orphans.
        let new_orphans = scene_b.mesh.face_count() - scene_b.face_to_xia.len();
        assert_eq!(new_orphans, orig_orphans,
            "orphan count should not grow across v2 round-trip");
    }

    /// V1 load still works (backward compatibility) but surfaces orphans
    /// so the caller/UI can offer recovery.
    #[test]
    fn v1_load_drops_xias_but_preserves_mesh() {
        // Hand-craft a v1 payload: AXIA magic + version 1 + mesh-only.
        let mut scene_a = Scene::default();
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: 200.0, height: 200.0,
        });
        let face_count = scene_a.mesh.face_count();
        assert!(face_count >= 1);

        // Build a v1 byte buffer manually.
        let mesh_bytes = bincode::serialize(&scene_a.mesh).expect("serialize mesh");
        let mut v1 = Vec::new();
        v1.extend_from_slice(&AXIA_MAGIC);
        v1.extend_from_slice(&1u32.to_le_bytes());
        v1.extend_from_slice(&(mesh_bytes.len() as u32).to_le_bytes());
        v1.extend_from_slice(&mesh_bytes);

        // Load into fresh scene.
        let mut scene_b = Scene::default();
        scene_b.import_versioned_snapshot(&v1).expect("v1 load");

        // Mesh restored.
        assert_eq!(scene_b.mesh.face_count(), face_count);
        // XIAs deliberately cleared (legacy file has none).
        assert_eq!(scene_b.xias.len(), 0,
            "v1 load must reset the XIA map (flag for recovery)");
        // All faces are orphans in the reverse index.
        assert_eq!(scene_b.face_to_xia.len(), 0,
            "v1 load must reset the reverse index");
    }

    // ══════════════════════════════════════════════════════════════
    //   Centerline (EdgeClass) tests — Phase A contract verification
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn centerline_draw_creates_edge_tagged_centerline() {
        let mut scene = Scene::new();
        let result = scene.execute(Command::DrawCenterline {
            start: DVec3::new(0.0, 0.0, 0.0),
            end:   DVec3::new(100.0, 0.0, 0.0),
        });
        let edge_id = match result {
            CommandResult::EntityCreated(id) => axia_geo::EdgeId::new(id),
            other => panic!("expected EntityCreated, got {:?}", other),
        };
        let edge = scene.mesh.edges.get(edge_id).expect("edge exists");
        assert_eq!(edge.class(), axia_geo::EdgeClass::Centerline);
    }

    #[test]
    fn centerline_does_not_split_crossing_geometry_line() {
        // Draw geometry line A-B. Then draw centerline crossing it.
        // Geometry line must remain one edge (not split at the crossing).
        let mut scene = Scene::new();
        scene.execute(Command::DrawLine {
            start: DVec3::new(-100.0, 0.0, 0.0),
            end:   DVec3::new( 100.0, 0.0, 0.0),
            surface_normal: None,
        });
        let edges_before_cl = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();

        // Centerline crosses the geometry line at origin
        scene.execute(Command::DrawCenterline {
            start: DVec3::new(0.0, 0.0, -100.0),
            end:   DVec3::new(0.0, 0.0,  100.0),
        });

        let edges_after = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        // Exactly +1 active edge (the centerline). The geometry line is
        // untouched — no split at the crossing.
        assert_eq!(edges_after, edges_before_cl + 1,
            "centerline must not split existing geometry edges");
    }

    #[test]
    fn geometry_line_does_not_split_at_crossing_centerline() {
        // Symmetric: draw centerline first, then geometry line crossing it.
        // Neither should be split.
        let mut scene = Scene::new();
        scene.execute(Command::DrawCenterline {
            start: DVec3::new(-100.0, 0.0, 0.0),
            end:   DVec3::new( 100.0, 0.0, 0.0),
        });
        let edges_before = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active()).count();
        assert_eq!(edges_before, 1);

        scene.execute(Command::DrawLine {
            start: DVec3::new(0.0, 0.0, -100.0),
            end:   DVec3::new(0.0, 0.0,  100.0),
            surface_normal: None,
        });

        let centerlines: Vec<_> = scene.mesh.edges.iter()
            .filter(|(_, e)| e.is_active() && e.class() == axia_geo::EdgeClass::Centerline)
            .collect();
        assert_eq!(centerlines.len(), 1,
            "centerline must not be split by a geometry line crossing it");
    }

    #[test]
    fn centerline_excluded_from_face_synthesis() {
        // Draw 3 centerlines forming a closed triangle.
        // synthesize_faces_from_free_edges (resolve_planar_free_faces) must
        // NOT create a face from pure-centerline loops.
        let mut scene = Scene::new();
        let a = DVec3::new(0.0, 0.0, 0.0);
        let b = DVec3::new(100.0, 0.0, 0.0);
        let c = DVec3::new(50.0, 0.0, 100.0);
        scene.execute(Command::DrawCenterline { start: a, end: b });
        scene.execute(Command::DrawCenterline { start: b, end: c });
        scene.execute(Command::DrawCenterline { start: c, end: a });
        let created = scene.mesh.resolve_planar_free_faces(
            axia_geo::MaterialId::new(0),
        );
        assert_eq!(created.len(), 0,
            "pure-centerline closed loop must not spawn a face");
        assert_eq!(scene.mesh.face_count(), 0);
    }

    #[test]
    fn set_edge_class_flip_works_for_free_edge() {
        // Geometry free-edge → Centerline should succeed (no face bound).
        let mut scene = Scene::new();
        let r = scene.execute(Command::DrawLine {
            start: DVec3::new(0.0, 0.0, 0.0),
            end:   DVec3::new(100.0, 0.0, 0.0),
            surface_normal: None,
        });
        // Find the edge (DrawLine doesn't return edge id; take first active)
        let eid = scene.mesh.edges.iter()
            .find(|(_, e)| e.is_active())
            .map(|(id, _)| id)
            .expect("active edge exists");
        let _ = r;
        let flip = scene.execute(Command::SetEdgeClass {
            edge_id: eid,
            class_raw: 1,  // Centerline
        });
        match flip {
            CommandResult::MeshUpdated => {}
            other => panic!("expected MeshUpdated, got {:?}", other),
        }
        assert_eq!(scene.mesh.edges[eid].class(), axia_geo::EdgeClass::Centerline);
    }

    #[test]
    fn set_edge_class_rejects_demoting_face_bounding_edge() {
        // Create a triangle face via DrawLine (closes a loop → face).
        // Edges of that face cannot be converted to Centerline.
        let mut scene = Scene::new();
        let a = DVec3::new(0.0, 0.0, 0.0);
        let b = DVec3::new(100.0, 0.0, 0.0);
        let c = DVec3::new(50.0, 0.0, 100.0);
        scene.execute(Command::DrawLine { start: a, end: b, surface_normal: None });
        scene.execute(Command::DrawLine { start: b, end: c, surface_normal: None });
        scene.execute(Command::DrawLine { start: c, end: a, surface_normal: None });
        assert!(scene.mesh.face_count() >= 1, "triangle face should have been synthesized");

        // Pick an edge that bounds a face.
        let face_edge_id = scene.mesh.edges.iter()
            .find(|(id, e)| {
                e.is_active() && scene.mesh.get_faces_sharing_edge(*id).0.iter()
                    .any(|&fid| scene.mesh.faces.get(fid).is_some_and(|f| f.is_active()))
            })
            .map(|(id, _)| id)
            .expect("face-bounding edge");

        let r = scene.execute(Command::SetEdgeClass {
            edge_id: face_edge_id,
            class_raw: 1,  // Centerline
        });
        match r {
            CommandResult::Error(_) => {}
            other => panic!("expected Error rejection, got {:?}", other),
        }
        // Class unchanged
        assert_eq!(scene.mesh.edges[face_edge_id].class(),
            axia_geo::EdgeClass::Geometry);
    }

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
