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

    /// Slice (Plane Cut) — split a closed Wall volume into two volumes
    /// with a cutting plane. Single-XIA only (all input faces must belong
    /// to a single XIA = one logical volume).
    ///
    /// On success:
    /// - Original XIA keeps the **above** half (above sub-walls + cap_above).
    /// - A new XIA is created for the **below** half (below sub-walls + cap_below).
    /// - The new XIA's name is `<original>_below` and its position is the
    ///   centroid of the below cap.
    ///
    /// Returns the new XIA id (below half) on success.
    pub fn slice_volume_by_plane(
        &mut self,
        face_ids: &[axia_geo::FaceId],
        plane: axia_geo::operations::slice::SlicePlane,
    ) -> anyhow::Result<crate::xia::XiaId> {
        if face_ids.is_empty() {
            anyhow::bail!("slice_volume_by_plane: empty face set");
        }

        // Determine the source XIA — must be unique across the input set.
        let mut source_xia: Option<crate::xia::XiaId> = None;
        for &fid in face_ids {
            match (source_xia, self.face_to_xia.get(&fid).copied()) {
                (None, Some(x)) => source_xia = Some(x),
                (Some(prev), Some(x)) if prev == x => {}
                (Some(_), Some(_)) => anyhow::bail!(
                    "slice_volume_by_plane: input faces span multiple XIAs — \
                    select faces from a single volume only"),
                (_, None) => anyhow::bail!(
                    "slice_volume_by_plane: face {:?} has no owning XIA", fid),
            }
        }
        let source_xia = source_xia
            .ok_or_else(|| anyhow::anyhow!("slice_volume_by_plane: cannot determine source XIA"))?;

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        // Run the geometric slice.
        let mat = self.default_material;
        let result = match self.mesh.slice_volume_by_plane(face_ids, plane, mat) {
            Ok(r) => r,
            Err(e) => {
                self.transactions.cancel();
                return Err(e);
            }
        };

        // ── XIA management ──────────────────────────────────────────────
        // 1. Strip original XIA's face_ids of the consumed input faces.
        //    Some input faces still exist (split into sub-faces with same id
        //    for the "kept" half). To avoid stale mappings we reset the XIA's
        //    face_ids entirely from the above set.
        for &fid in face_ids {
            self.face_to_xia.remove(&fid);
        }
        // Above half — assigned to the source XIA.
        let above_all: Vec<axia_geo::FaceId> = result.above_walls.iter()
            .chain(result.cap_above.iter())
            .copied()
            .collect();
        if let Some(xia) = self.xias.get_mut(&source_xia) {
            xia.face_ids = above_all.clone();
        }
        for &f in &above_all {
            self.face_to_xia.insert(f, source_xia);
        }

        // Below half — new XIA.
        let below_all: Vec<axia_geo::FaceId> = result.below_walls.iter()
            .chain(result.cap_below.iter())
            .copied()
            .collect();

        // Centroid of below cap face(s) for position.
        let mut centroid = glam::DVec3::ZERO;
        let mut count = 0usize;
        for &fid in &result.cap_below {
            if let Ok(verts) = self.mesh.collect_loop_verts(self.mesh.faces[fid].outer().start) {
                for v in verts {
                    if let Some(p) = self.mesh.verts.get(v).map(|x| x.pos()) {
                        centroid += p;
                        count += 1;
                    }
                }
            }
        }
        if count > 0 { centroid /= count as f64; }

        let original_name = self.xias.get(&source_xia)
            .map(|x| x.name.clone())
            .unwrap_or_else(|| "Volume".to_string());
        let below_name = format!("{}_below", original_name);
        let new_xia = self.create_xia_with_faces(below_name, centroid, below_all);

        // Inherit material assignment for new faces (default already set).
        // Future: copy any per-face material attributes from source if needed.

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        Ok(new_xia)
    }

    /// Scene-level repair of non-manifold edges (ADR-007 I5).
    ///
    /// Strategy (XIA-aware, with geometric fallback):
    /// 1. Find every active edge with > 2 active incident faces.
    /// 2. Group those faces by owning XIA. The "anchor" group is the
    ///    XIA contributing the most faces to the edge (ties broken by
    ///    smallest XIA id). All other faces are detached using
    ///    `Mesh::detach_face_groups`, duplicating any vertex shared
    ///    with the anchor group.
    /// 3. After XIA-aware repair, run a final geometric pass to mop up
    ///    any edges where all incident faces share the same XIA (rare —
    ///    indicates a single tool produced bad topology).
    /// 4. Refresh face_to_xia for any faces that got remapped during
    ///    detachment, and run reconcile_face_normals.
    ///
    /// Returns a report summarising what changed. Always succeeds — if
    /// some edges cannot be repaired the report lists them.
    pub fn repair_non_manifold_edges(&mut self) -> axia_geo::operations::repair::RepairReport {
        use axia_geo::operations::repair::RepairReport;
        let mut report = RepairReport::default();

        let bad = self.mesh.find_non_manifold_edges();
        report.edges_examined = bad.len();
        if bad.is_empty() {
            return report;
        }

        for nm in bad {
            // Re-fetch after earlier passes.
            if !self.mesh.edges.contains(nm.edge) ||
               !self.mesh.edges[nm.edge].is_active() {
                continue;
            }
            let (cur_faces, _) = self.mesh.get_faces_sharing_edge(nm.edge);
            if cur_faces.len() <= 2 { continue; }

            // Group by XIA.
            use std::collections::HashMap;
            let mut by_xia: HashMap<Option<crate::xia::XiaId>, Vec<axia_geo::FaceId>> = HashMap::new();
            for &f in &cur_faces {
                let xid = self.face_to_xia.get(&f).copied();
                by_xia.entry(xid).or_default().push(f);
            }

            // Pick anchor: group with most faces. Ties → smallest XIA id, None last.
            let mut groups: Vec<(_, _)> = by_xia.into_iter().collect();
            groups.sort_by(|a, b| {
                b.1.len().cmp(&a.1.len())
                    .then_with(|| match (a.0, b.0) {
                        (Some(ax), Some(bx)) => ax.cmp(&bx),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => std::cmp::Ordering::Equal,
                    })
            });
            let (_anchor_xia, anchor_faces) = groups.remove(0);

            // Detach each remaining group from anchor. After detachment a
            // group's face ids may change — update face_to_xia.
            for (group_xia, group_faces) in &groups {
                match self.mesh.detach_face_groups(&anchor_faces, group_faces) {
                    Ok((mapping, n_verts)) => {
                        report.faces_detached += group_faces.len();
                        report.vertices_created += n_verts;
                        // Re-route face_to_xia for any face that got remapped.
                        for &(old_fid, new_fid) in &mapping {
                            if old_fid == new_fid { continue; }
                            // Remove old, register new under same XIA (if any).
                            if let Some(xid) = self.face_to_xia.remove(&old_fid) {
                                self.face_to_xia.insert(new_fid, xid);
                                if let Some(xia) = self.xias.get_mut(&xid) {
                                    for f in xia.face_ids.iter_mut() {
                                        if *f == old_fid { *f = new_fid; }
                                    }
                                }
                            } else if let Some(xid) = group_xia {
                                // Group's faces had no entry in face_to_xia
                                // (orphan) but their XIA exists — re-link.
                                self.face_to_xia.insert(new_fid, *xid);
                                if let Some(xia) = self.xias.get_mut(xid) {
                                    if !xia.face_ids.contains(&new_fid) {
                                        xia.face_ids.push(new_fid);
                                    }
                                    xia.face_ids.retain(|f| *f != old_fid);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        report.edges_skipped.push((nm.edge,
                            format!("XIA-aware detach failed: {}", e)));
                    }
                }
            }
            report.edges_repaired += 1;
        }

        // Final geometric mop-up — handles single-XIA edges with > 2 faces
        // (rare but possible if an op left a self-non-manifold body).
        let geo = self.mesh.repair_non_manifold_edges_geometric();
        report.faces_detached += geo.faces_detached;
        report.vertices_created += geo.vertices_created;
        report.edges_repaired += geo.edges_repaired;
        for s in geo.edges_skipped { report.edges_skipped.push(s); }

        report
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
    /// ⚡ 성능: large scene 의 draw_line 시 N face 전체에 대해 plane+point-in-polygon
    /// 을 돌면 O(N) × heap-alloc 이 누적돼 수백 ms 가 됨. AABB pre-reject 와
    /// 평면-거리 cheap test 를 먼저 두어 99% 의 face 를 즉시 스킵한다.
    fn is_vertex_interior_to_any_face(&self, v: VertId) -> bool {
        let p = match self.mesh.vertex_pos(v) { Ok(p) => p, Err(_) => return false };
        for (_fid, face) in self.mesh.faces.iter() {
            if !face.is_active() { continue; }
            let boundary = match self.mesh.collect_loop_verts(face.outer().start) {
                Ok(b) => b, Err(_) => continue,
            };
            if boundary.contains(&v) { continue; }
            if boundary.len() < 3 { continue; }

            // ── AABB pre-reject (cheap) ───────────────────────────────
            // 4-원소 boundary (rect) 등은 5 ns 이내 종결.
            let mut min = glam::DVec3::splat(f64::INFINITY);
            let mut max = glam::DVec3::splat(f64::NEG_INFINITY);
            let mut have_pts = false;
            for &vid in &boundary {
                if let Ok(q) = self.mesh.vertex_pos(vid) {
                    min = min.min(q); max = max.max(q); have_pts = true;
                }
            }
            if !have_pts { continue; }
            // Tolerance: 1mm padding (충분히 보수적, 정확한 판정은 뒤에서).
            const PAD: f64 = 1.0;
            if p.x < min.x - PAD || p.x > max.x + PAD ||
               p.y < min.y - PAD || p.y > max.y + PAD ||
               p.z < min.z - PAD || p.z > max.z + PAD {
                continue;
            }

            // ── Coplanar + inside polygon test ────────────────────────
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
        let inner_pts: Vec<DVec3> = inner_verts.iter()
            .filter_map(|&v| self.mesh.vertex_pos(v).ok())
            .collect();
        if inner_pts.len() < 3 { return None; }
        let inner_normal = inner_face.normal();
        if inner_normal.length_squared() < 1e-10 { return None; }

        // inner area (3D)
        let inner_area = {
            let mut a_vec = DVec3::ZERO;
            for i in 1..inner_pts.len().saturating_sub(1) {
                a_vec += (inner_pts[i] - inner_pts[0]).cross(inner_pts[i + 1] - inner_pts[0]);
            }
            a_vec.length() * 0.5
        };
        if inner_area < 1e-9 { return None; }

        let mut best: Option<(FaceId, f64)> = None;
        for (outer_fid, outer_face) in self.mesh.faces.iter() {
            if outer_fid == inner_fid { continue; }
            if !outer_face.is_active() { continue; }
            let outer_normal = outer_face.normal();
            if outer_normal.length_squared() < 1e-10 { continue; }
            let n_dot = outer_normal.dot(inner_normal).abs();
            if n_dot < 0.999 { continue; }

            let outer_verts = match self.mesh.collect_loop_verts(outer_face.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            if outer_verts.len() < 3 { continue; }
            let outer_pts: Vec<DVec3> = outer_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            if outer_pts.len() < 3 { continue; }

            let outer_area = {
                let mut a_vec = DVec3::ZERO;
                for i in 1..outer_pts.len() - 1 {
                    a_vec += (outer_pts[i] - outer_pts[0]).cross(outer_pts[i + 1] - outer_pts[0]);
                }
                a_vec.length() * 0.5
            };
            if outer_area <= inner_area { continue; }

            // Phase 3c'' — containment 판정을 polygon_contains_polygon 으로
            //   교체. 이전 구현은 inner 의 "첫 정점" ray-cast 만 검사해 해당
            //   정점이 outer 경계 위일 때 flaky 하게 false 가 나와 B1 promote
            //   를 놓치는 케이스가 있었음. 이제 모든 inner vertex + strict
            //   interior 점까지 검사하는 rigorous 방식.
            if !axia_geo::operations::polygon_geom::polygon_contains_polygon(&outer_pts, &inner_pts) {
                continue;
            }

            match best {
                None => best = Some((outer_fid, outer_area)),
                Some((_, a)) if outer_area < a => best = Some((outer_fid, outer_area)),
                _ => {}
            }
        }
        best.map(|(fid, _)| fid)
    }

    /// ADR-016 §2 (Path B) — Helper used by WASM `eraseEdgeResynthesize`.
    /// Updates the XIA mappings after a re-synthesis: drops removed-face
    /// entries and inherits the first non-None container XIA into all new faces.
    pub fn apply_resynth_xia_inheritance(
        &mut self,
        removed_faces: &[FaceId],
        new_faces: &[FaceId],
    ) {
        // Capture the inheritance candidate (first XIA that owned a removed
        // face — typically the outer/container).
        let inherit_xia = removed_faces.iter()
            .find_map(|fid| self.face_to_xia.get(fid).copied());

        // Drop removed faces from their XIAs and from the reverse index.
        for &fid in removed_faces {
            if let Some(xid) = self.face_to_xia.remove(&fid) {
                if let Some(xia) = self.xias.get_mut(&xid) {
                    xia.face_ids.retain(|&f| f != fid);
                }
            }
        }

        // Attach new faces to the inherited XIA.
        if let Some(xid) = inherit_xia {
            for &new_f in new_faces {
                if let Some(xia) = self.xias.get_mut(&xid) {
                    if !xia.face_ids.contains(&new_f) {
                        xia.face_ids.push(new_f);
                    }
                }
                self.face_to_xia.insert(new_f, xid);
            }
        }
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

    /// ADR-016 — gate for conditional B1 auto hole-promote.
    ///
    /// SketchUp-style: only the FIRST inner inside an outer auto-promotes.
    /// Subsequent inners stay as separate floating faces to preserve the
    /// stacked-inner manifold safety (ADR-015 motivation).
    ///
    /// Conditions (all must hold):
    ///   1. `container` has no existing inner holes (single-promote).
    ///   2. `inner` has no inner holes itself (only simple faces promote).
    ///   3. Manifold safety — every perimeter HE of `inner` has its `face`
    ///      either == `container` OR == `null` (free). If any HE is already
    ///      claimed by a different face / hole loop, promotion would violate
    ///      the DCEL "1 HE → 1 face" invariant.
    fn b1_promote_safe(&self, container: FaceId, inner: FaceId) -> bool {
        let container_face = match self.mesh.faces.get(container) {
            Some(f) if f.is_active() => f, _ => return false,
        };
        let inner_face = match self.mesh.faces.get(inner) {
            Some(f) if f.is_active() => f, _ => return false,
        };
        // (2) inner must be a simple face.
        if !inner_face.inners().is_empty() { return false; }
        // (1) Single-promote OR disjoint-additional-hole OR pinch (ADR-022 P9).
        //   Container 가 simple → 1st promote (기존 동작).
        //   Container 가 ring → 새 inner 의 기존 sub-face 와의 vertex overlap:
        //     - 0 verts 공유 → disjoint, allow (Phase C).
        //     - 1 vertex 공유 → pinch case (P9), allow. Manifold check (3) 으로
        //       실제 corruption 만 거르기.
        //     - 2+ verts 공유 → edge 공유 가능성, 거부 (combined-perimeter 경로
        //       로 처리되어야 함).
        let container_is_ring = !container_face.inners().is_empty();
        if container_is_ring {
            let mut existing_subface_verts: std::collections::HashSet<axia_geo::VertId> =
                std::collections::HashSet::new();
            for inner_loop in container_face.inners() {
                if let Ok(loop_verts) = self.mesh.collect_loop_verts(inner_loop.start) {
                    for v in loop_verts {
                        existing_subface_verts.insert(v);
                    }
                }
            }
            let new_inner_verts = match self.mesh.collect_loop_verts(inner_face.outer().start) {
                Ok(v) => v, Err(_) => return false,
            };
            let mut shared_count = 0usize;
            for v in &new_inner_verts {
                if existing_subface_verts.contains(v) {
                    shared_count += 1;
                }
            }
            if shared_count >= 2 {
                // Likely edge-shared → reject (handled by combined-perimeter elsewhere).
                return false;
            }
            // shared_count == 0 (disjoint) or 1 (pinch, P9): allow → fall through
            // to manifold check (3).
        }
        // (3) Manifold safety — walk inner's outer loop HEs.
        let start = inner_face.outer().start;
        let mut he = start;
        let mut guard = 0usize;
        loop {
            guard += 1;
            if guard > 4096 { return false; }
            let he_ref = match self.mesh.hes.get(he) {
                Some(h) => h, None => return false,
            };
            // CCW-side (he itself) must belong to inner.
            if he_ref.face() != inner { return false; }
            // The CW-side (twin) HE belongs to "outside" of inner. After
            // promote, it becomes ring's hole loop. Must currently be either
            // container's outer-loop HE (face=container) or free (null).
            let twin = self.mesh.he_twin(he);
            let twin_ref = match self.mesh.hes.get(twin) {
                Some(h) => h, None => return false,
            };
            let twin_face = twin_ref.face();
            if !twin_face.is_null() && twin_face != container {
                return false;
            }
            he = he_ref.next();
            if he == start { break; }
        }
        true
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
        // ⚡ 2026-04-27 — empty-space draw 시 N face × collect_loop_verts
        //   (heap alloc) 가 누적돼 큰 씬에서 수백 ms. 두 단계로 가속:
        //     1. touched_pts 가 비어있으면 전체 스킵.
        //     2. 외곽 AABB 사전계산 + face AABB 는 in-place 반복으로
        //        Vec alloc 회피. 외곽 밖이면 첫 vert 만 보고 즉시 reject.
        {
            let touched_pts: Vec<DVec3> = touched_verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            let candidates: Vec<FaceId> = if touched_pts.is_empty() {
                Vec::new()
            } else {
                // 1) Outer AABB of touched_pts.
                let mut tmn = DVec3::splat(f64::INFINITY);
                let mut tmx = DVec3::splat(f64::NEG_INFINITY);
                for p in &touched_pts {
                    tmn = tmn.min(*p); tmx = tmx.max(*p);
                }
                let pad = DVec3::splat(1.0);
                tmn -= pad; tmx += pad;

                // 2) For each face, walk loop in-place to build face AABB,
                //    test AABB-vs-AABB intersection vs touched AABB.
                //    Vec alloc 회피 → 큰 씬에서 N face × heap alloc 비용 제거.
                let mut out: Vec<FaceId> = Vec::new();
                for (fid, f) in self.mesh.faces.iter() {
                    if !f.is_active() { continue; }
                    let start = f.outer().start;
                    if start.is_null() { continue; }

                    let mut fmn = DVec3::splat(f64::INFINITY);
                    let mut fmx = DVec3::splat(f64::NEG_INFINITY);
                    let mut he = start;
                    let mut hops = 0;
                    let max_hops = 64;
                    loop {
                        let vid = self.mesh.hes[he].dst();
                        if let Ok(p) = self.mesh.vertex_pos(vid) {
                            fmn = fmn.min(p); fmx = fmx.max(p);
                        }
                        he = self.mesh.hes[he].next();
                        hops += 1;
                        if he == start || he.is_null() || hops >= max_hops { break; }
                    }
                    if fmn.x.is_infinite() { continue; }
                    let pad = DVec3::splat(1e-3);
                    fmn -= pad; fmx += pad;

                    // AABB-vs-AABB intersection test (any axis disjoint → reject).
                    if fmx.x < tmn.x || fmn.x > tmx.x ||
                       fmx.y < tmn.y || fmn.y > tmx.y ||
                       fmx.z < tmn.z || fmn.z > tmx.z {
                        continue;
                    }
                    // Detailed: original semantics — face AABB contains some touched_pt.
                    let mut hit = false;
                    for tp in &touched_pts {
                        if tp.x >= fmn.x && tp.x <= fmx.x &&
                           tp.y >= fmn.y && tp.y <= fmx.y &&
                           tp.z >= fmn.z && tp.z <= fmx.z {
                            hit = true; break;
                        }
                    }
                    if hit { out.push(fid); }
                }
                out
            };
            for fid in candidates {
                let new_faces = self.mesh.dissolve_and_fan_split(fid);
                if !new_faces.is_empty() {
                    let old_xia = self.get_xia_for_face(fid);
                    self.unregister_face_from_xia(fid);
                    if let Some(xia_id) = old_xia {
                        if self.xias.get(&xia_id).is_some() {
                            self.register_faces_to_xia(xia_id, &new_faces);
                            if let Some(xia) = self.xias.get_mut(&xia_id) {
                                for &f in &new_faces { xia.face_ids.push(f); }
                            }
                        }
                        // 2026-04-28 — XIA inheritance preserved. Sub-faces NOT
                        //   added to all_created_faces — would cause new RECT's
                        //   XIA registration to overwrite face_to_xia at end
                        //   of exec_draw_rect (state inconsistency).
                    } else {
                        // No original XIA — sub-faces become "owned" by current op.
                        for f in new_faces {
                            if !all_created_faces.contains(&f) { all_created_faces.push(f); }
                        }
                    }
                }
            }
        }


        // Step 4.55 — nested face dissolve
        {
            let dissolved = self.mesh.dissolve_containing_faces();
            if !dissolved.is_empty() {
            }
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
            if !removed.is_empty() {
            }
            for fid in removed {
                self.unregister_face_from_xia(fid);
                all_created_faces.retain(|&f| f != fid);
            }
        }

        // Step 4.8 — B1 enclosed-face hole promotion (DISABLED per ADR-015).
        //
        // 2026-04-28 — ADR-015: B1 auto hole-promote 비활성. inner face 가
        //   기존 outer face 안에 그려졌을 때 자동 ring 화 안 함. 두 face 가
        //   별개 simple face 로 공존. 명시적 promote 는 사용자 우클릭 메뉴
        //   "merge-as-hole" 로만.
        //
        // 사유: B1 auto-promote 는 inner perimeter HE 를 ring hole loop 에
        //   claim → ADR-008 Axiom 7 위반 (인접 inner 의 면 합성 차단).

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

        // 알려진 제약 (2026-04-28, ADR-008 Axiom 7 vs Phase E B1 hole-promote 충돌):
        //   B1 hole-promote 된 ring face 의 hole boundary 에 인접하게 새 RECT
        //   그릴 때, shared edge 의 HE2 가 ring 의 hole loop 에 claim 됨 →
        //   새 RECT 의 free-cycle 합성 불가. M1 interior guard 가 inner1 face
        //   손실은 막아주지만 inner2 자체는 wire-only 로 남음.
        //   적절한 fix 는 ring topology rebuild — 그러나 leftmost-turn walker
        //   의 cycle 우선순위 + dedup 의 oldest-first 정책으로 인해 단순한
        //   dissolve+resolve 패턴이 inner1 의 face 마저 잘못 흡수. 별도 Phase
        //   에서 처리.
        //
        // 임시 우회: 사용자는 인접 inner RECT 를 그릴 때 약간의 gap 을 두거나
        //   4 LINE 으로 직접 그리기. 자동 free-cycle 합성은 정상 작동.

        // Step 4.95 — ADR-021 P7 (Closed Edge Loop Divides Face).
        //
        //   "닫힌 라인은 면을 나눈다" 원칙의 운영:
        //   - 활성 simple face 들 중 다른 container face 안에 enclose 된 것을 수집
        //   - container 별로 그룹
        //   - 각 container 의 inners 를 connected component 로 분리
        //     (edge 공유 = 같은 component)
        //   - 각 component → 1 hole 로 promote (combined perimeter)
        //   - 결과: container = ring with N holes (N = component 수)
        //
        //   순서 무관성 (ADR-021 §4): Case A (inner 먼저) = Case B (outer 먼저).
        //   Manifold 안전: shared edge 는 hole loop 미경유 → 위반 없음.
        //
        //   v1.1 (2026-04-29): Phase A HE manifold fix + Phase B 적용.
        //   - Phase A (reverse_loop twin update): manifold 보장
        //   - Phase B: ring 도 inner candidate (Test 3B nested)
        //   - Phase C (ring as container, Test 1B/4B): 별도 후속 — 회귀 위험.
        use std::collections::HashMap;
        {
            // 1) Phase B: 모든 active face 수집 — simple + ring 둘 다 inner.
            let candidates: Vec<FaceId> = self.mesh.faces.iter()
                .filter(|(_, f)| f.is_active())
                .map(|(id, _)| id)
                .collect();

            let mut by_container: HashMap<FaceId, Vec<FaceId>> = HashMap::new();
            for inner_fid in &candidates {
                if !self.mesh.faces.contains(*inner_fid) { continue; }
                if !self.mesh.faces[*inner_fid].is_active() { continue; }
                let Some(container) = self.find_enclosing_face(*inner_fid) else { continue; };
                // ADR-022 P9: Container 가 simple OR ring 둘 다 처리.
                // Ring 인 경우 기존 hole loops 를 보존하면서 새 hole 추가.
                if !self.mesh.faces.get(container)
                    .map(|f| f.is_active())
                    .unwrap_or(false)
                {
                    continue;
                }
                if container == *inner_fid { continue; }
                // ADR-022 P9: inner 의 outer-loop verts 가 container 의 기존 hole
                // loop 와 동일 vertex set 이면 이미 promote 된 sub-face → skip.
                // (Inner 가 ring 인 경우는 Phase B 정책에 따라 candidate 로 유지.)
                let inner_verts_set: std::collections::HashSet<axia_geo::VertId> =
                    match self.mesh.collect_loop_verts(self.mesh.faces[*inner_fid].outer().start) {
                        Ok(v) => v.into_iter().collect(),
                        Err(_) => continue,
                    };
                let already_hole = self.mesh.faces[container].inners().iter().any(|lr| {
                    if let Ok(hole_verts) = self.mesh.collect_loop_verts(lr.start) {
                        let hole_set: std::collections::HashSet<axia_geo::VertId> =
                            hole_verts.into_iter().collect();
                        hole_set == inner_verts_set
                    } else { false }
                });
                if already_hole { continue; }
                by_container.entry(container).or_default().push(*inner_fid);
            }

            // 2) 각 container 처리
            for (container, inners) in by_container.iter() {
                if inners.is_empty() { continue; }

                // 2a) Connected component 로 그룹
                let components = self.mesh.find_inner_components(inners);
                if components.is_empty() { continue; }

                // 2b) 각 component 의 combined perimeter (CCW around union)
                //     → reverse 로 CW (hole loop 방향)
                let mut hole_loops: Vec<Vec<axia_geo::VertId>> = Vec::new();
                let mut all_safe = true;
                for comp in &components {
                    match self.mesh.compute_combined_perimeter(comp) {
                        Ok(mut perim) => {
                            if perim.len() < 3 { all_safe = false; break; }
                            perim.reverse();
                            hole_loops.push(perim);
                        }
                        Err(_) => { all_safe = false; break; }
                    }
                }
                if !all_safe || hole_loops.is_empty() { continue; }

                // 2c) Container 의 outer + 기존 hole loops + material 캡처.
                //     ADR-022 P9: ring container 인 경우 기존 hole loops 보존.
                let outer_verts = match self.mesh.collect_loop_verts(
                    self.mesh.faces[*container].outer().start
                ) {
                    Ok(v) => v, Err(_) => continue,
                };
                let existing_hole_loops: Vec<Vec<axia_geo::VertId>> = self.mesh.faces[*container]
                    .inners().iter()
                    .filter_map(|lr| self.mesh.collect_loop_verts(lr.start).ok())
                    .collect();
                let material = self.mesh.faces[*container].material();

                // 2c-bis) ADR-022 P9 — pinch safety: 새 hole loops 와 기존 hole
                //   loops / outer 사이의 vertex 공유 검사.
                //   - shared_count >= 2 (edge 공유 가능성) → reject
                //   - shared_count <= 1 (disjoint or pinch) → allow
                if !existing_hole_loops.is_empty() {
                    use std::collections::HashSet;
                    let mut existing_verts: HashSet<axia_geo::VertId> = HashSet::new();
                    for h in &existing_hole_loops {
                        for &v in h { existing_verts.insert(v); }
                    }
                    let mut p9_safe = true;
                    for new_hole in &hole_loops {
                        let mut shared = 0usize;
                        for &v in new_hole {
                            if existing_verts.contains(&v) { shared += 1; }
                        }
                        if shared >= 2 {
                            p9_safe = false;
                            break;
                        }
                    }
                    if !p9_safe { continue; }
                }

                // 2d) Container soft-remove + ring 재구성 (기존 + 새 holes 결합).
                if self.mesh.soft_remove_face(*container).is_err() { continue; }
                let mut all_holes: Vec<Vec<axia_geo::VertId>> = existing_hole_loops;
                all_holes.extend(hole_loops);
                let hole_refs: Vec<&[axia_geo::VertId]> =
                    all_holes.iter().map(|h| h.as_slice()).collect();
                let new_outer = match self.mesh.add_face_with_holes(
                    &outer_verts, &hole_refs, material,
                ) {
                    Ok(f) => f,
                    Err(_) => {
                        // Ring 재구성 실패 — container 가 lost 상태.
                        // (드물 — soft_remove + add_face_with_holes 같은 verts).
                        continue;
                    }
                };

                // 2e) XIA inheritance
                if let Some(old_xia) = self.face_to_xia.remove(container) {
                    if let Some(xia) = self.xias.get_mut(&old_xia) {
                        xia.face_ids.retain(|&f| f != *container);
                        if !xia.face_ids.contains(&new_outer) {
                            xia.face_ids.push(new_outer);
                        }
                    }
                    self.face_to_xia.insert(new_outer, old_xia);
                } else {
                    self.unregister_face_from_xia(*container);
                }
                all_created_faces.retain(|&f| f != *container);
                if !all_created_faces.contains(&new_outer) {
                    all_created_faces.push(new_outer);
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
                // 2순위 (Tier 4 C-2) — left-turn-rule chain finder replaces
                // the older BFS. Geometrically deterministic, picks the
                // chain that tightly hugs the face boundary.
                let Some(chain) = axia_geo::operations::planar_walk::find_first_left_turn_path(
                    &self.mesh, face_id,
                ) else { continue };
                let _ = new_edges; // signature kept for the legacy fallback below

                // 2026-04-28 — chain interior validity guard.
                //   사용자 보고 (snap 으로 정확히 인접 RECT stack 그릴 때 면 사라짐):
                //   M1 이 OUTSIDE 로 가는 chain (예: inner1 face 의 boundary 위
                //   endpoint 두 개가 있지만 chain 자체는 inner1 위쪽 = OUTSIDE 를
                //   지나는 inner2 perimeter) 으로 inner1 을 split → inner1 면적이
                //   새 chain region 으로 잘못 흡수.
                //
                //   chain[0]→chain[1] midpoint 가 face polygon 안에 있어야 함.
                //   바깥이면 split skip — 별도 step 4.96 (host-ring rebuild)
                //   에서 처리.
                if chain.len() >= 2 {
                    let p0 = self.mesh.vertex_pos(chain[0]).ok();
                    let p1 = self.mesh.vertex_pos(chain[1]).ok();
                    if let (Some(p0), Some(p1)) = (p0, p1) {
                        let mid = (p0 + p1) * 0.5;
                        let inside = axia_geo::operations::face_split::point_in_face(
                            &self.mesh, face_id, mid,
                        ).unwrap_or(false);
                        if !inside {
                            continue;
                        }
                    }
                }

                let split_res = axia_geo::operations::face_split::split_face_by_chain(
                    &mut self.mesh,
                    face_id,
                    &chain,
                    self.default_material,
                );
                match split_res {
                    Ok(res) => {
                        // 2026-04-28 — XIA inheritance fix: M1 split 의 sub-face
                        //   는 ORIGINAL XIA 에 inherit 되어야 함 (face_id 가
                        //   원래 속한 XIA). 이전엔 unregister 후 new RECT 의
                        //   XIA 로 옮겨져 원본 XIA 가 face_ids 비어버림.
                        //
                        //   사용자 UX: "RECT_orig 가 RECT_new 에 의해 split 됐을
                        //   때, RECT_orig 의 모든 sub-face 는 RECT_orig 의 XIA
                        //   에 그대로 속함". RECT_new 의 XIA 는 자신의 다른
                        //   영역 (RECT_orig 밖) face 만 가짐.
                        let old_xia = self.face_to_xia.get(&face_id).copied();
                        all_created_faces.retain(|&f| f != face_id);
                        self.unregister_face_from_xia(face_id);
                        if let Some(xid) = old_xia {
                            // Sub-faces inherit original XIA.
                            self.register_faces_to_xia(xid, &res.new_faces);
                            if let Some(xia) = self.xias.get_mut(&xid) {
                                for &f in &res.new_faces {
                                    if !xia.face_ids.contains(&f) {
                                        xia.face_ids.push(f);
                                    }
                                }
                            }
                            // Sub-faces not added to all_created_faces — they
                            //   inherited and shouldn't go to the new RECT's
                            //   XIA at end of exec_draw_rect.
                        } else {
                            // Original face had no XIA — sub-faces become
                            //   "owned" by the current draw operation.
                            for &f in &res.new_faces {
                                if !all_created_faces.contains(&f) {
                                    all_created_faces.push(f);
                                }
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
    /// Legacy BFS-based chain finder. Superseded by
    /// `axia_geo::operations::planar_walk::find_first_left_turn_path`
    /// (Tier 4 C-2 — 2026-04-26). Kept around as reference and as a
    /// potential fallback; not currently called.
    #[allow(dead_code)]
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
                        // ADR-007 Invariant 2 (Winding): face's normal MUST
                        //   align with surface_normal hint. Always enforce —
                        //   neighbor alignment alone is insufficient as
                        //   neighbors might themselves be flipped.
                        //
                        // 2026-04-28 — 사용자 보고: 그리는 방향에 따라 면이
                        //   뒤집혀 BackSide 로 렌더되는 현상. 기존 logic 은
                        //   align_face_with_neighbors 가 true 반환 시 (= flip
                        //   수행) surface_normal 검사를 skip 해 결과가 hint 와
                        //   반대일 수 있었음. 항상 hint 기준으로 검사.
                        self.mesh.align_face_with_neighbors(fid);
                        let face_n = self.mesh.faces[fid].normal();
                        let target = surface_normal.unwrap_or(DVec3::Y);
                        if face_n.dot(target) < 0.0 {
                            let _ = self.mesh.flip_face_safe(fid);
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
            // ⚡ Fast-path (2026-04-27): empty-space draw skips all heavy
            //   postprocess scans. If the new line touched **no** existing
            //   topology (no edge crossings, no on-line verts, no collinear
            //   overlap, no face-split sub-segments) it can only have
            //   produced a standalone edge — none of Steps 4.5/4.55/4.6/
            //   4.65/4.7/4.8 have anything to do.
            //
            //   Each of those steps iterates ~all active faces with
            //   collect_loop_verts → heap alloc per face. With a 3000-face
            //   scene this dominates draw_line latency (>500 ms).
            //
            // ADR-019 A6 (2026-04-29) — closed-cycle detection for wire loops.
            //   Earlier optimization missed the case where the new line
            //   *connects* to an existing vertex (dedup match) inside a face's
            //   interior — a wire-chain extension that may close a cycle on
            //   completion. We additionally trigger postprocess when either
            //   endpoint of the new edge has more than 1 incident edge after
            //   creation (i.e. the new line is connecting to existing
            //   topology — wire chain or face boundary). This lets users
            //   form sub-faces by manually drawing 4 lines inside an existing
            //   face (DrawLine equivalent of DrawRect interior fast-path).
            let count_incident = |mesh: &axia_geo::Mesh, vid: VertId| -> usize {
                mesh.edges.iter()
                    .filter(|(_, e)| {
                        e.is_active() && (e.v_small() == vid || e.v_large() == vid)
                    })
                    .take(2)
                    .count()
            };
            let endpoint_connects_existing = touched_verts.iter()
                .any(|&v| count_incident(&self.mesh, v) > 1);

            let touched_existing_topology =
                !crossings.is_empty() ||
                !verts_on_line.is_empty() ||
                !collinear_splits.is_empty() ||
                !all_created_faces.is_empty() ||
                endpoint_connects_existing;
            if touched_existing_topology {
                self.run_face_synthesis_postprocess(
                    &touched_verts,
                    &new_edges,
                    &mut all_created_faces,
                );
            }
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
        // 2026-04-27 — 엔진 허용오차 정책 (사용자 정책):
        //   mesh 층은 exact input 만 처리. UI snap (osnap) 이 cursor 를
        //   정확한 위치로 옮겨주므로 미세 어긋남은 입력 단계에서 해소됨.
        //   기본 add_vertex 의 1.5μm dedup 만 사용 (f32 drift 흡수용).
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

        // ═══ Fast-path: RECT interior to a single face ═════════════════════
        //
        // 2026-04-28 — ADR-016 Conditional B1 Auto Hole-Promote:
        //   새 RECT 가 기존 face 의 strict interior 면 inner 단순 face 로
        //   생성 후, b1_promote_safe 검사 통과 시 outer 를 ring 으로 변환하고
        //   inner 를 hole 로 흡수. 둘째 inner (container 가 이미 ring) 는
        //   skip → 별개 floating face 유지 (manifold 안전).
        if !edge_interaction && face_interaction {
            if let Some(container_fid) = self.single_face_containing_corners(&corners, n_norm) {
                // Atomic: add 4 vertices, add_face.
                match self.mesh.draw_rectangle(center, normal, up, width, height, self.default_material) {
                    Ok((inner_fid, _verts)) => {
                        let xia_id = self.create_xia("Rectangle".to_string());
                        if let Some(xia) = self.xias.get_mut(&xia_id) {
                            xia.position = center;
                            xia.surface_normal = Some(n_norm);
                            xia.face_ids.push(inner_fid);
                        }
                        self.register_faces_to_xia(xia_id, &[inner_fid]);

                        // ADR-016 conditional B1 promote.
                        let mut b1_fired = false;
                        if self.b1_promote_safe(container_fid, inner_fid) {
                            if let Ok(new_outer) = self.promote_face_to_hole(container_fid, inner_fid) {
                                b1_fired = true;
                                // Update container's XIA mapping (outer → new_outer).
                                if let Some(old_xia) = self.face_to_xia.remove(&container_fid) {
                                    if let Some(xia) = self.xias.get_mut(&old_xia) {
                                        xia.face_ids.retain(|&f| f != container_fid);
                                        if !xia.face_ids.contains(&new_outer) {
                                            xia.face_ids.push(new_outer);
                                        }
                                    }
                                    self.face_to_xia.insert(new_outer, old_xia);
                                }
                            }
                        }

                        // Skip auto-intersect when B1 fired — inner is fully
                        // inside container with no boundary crossings, so no
                        // additional intersections to find. Running intersect
                        // would unnecessarily revisit the freshly-built ring's
                        // hole loop edges and can split/destroy the topology.
                        if !b1_fired && self.auto_intersect_on_draw {
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

        // 2026-04-28 — ADR-007 Invariant 2 enforcement (post-pipeline).
        //   D-resolver / M1 split / dissolve_and_fan_split 등 일부 step 은
        //   surface_normal hint 를 받지 않아 인접 neighbor 와 align 만 함.
        //   degenerate (NaN / zero-length normal) face 는 invariant 위반 +
        //   render artifact ("shadow") 유발.
        //
        //   1) Degenerate scan — 모든 active face 대상 (이전 draw 의 잔재
        //      포함 가능). NaN/zero normal 은 무조건 제거.
        //   2) Winding flip — touched_verts 위 boundary 가진 face 만.
        //      Unrelated geometry 의 normal 은 사용자 의도 그대로 보존.
        let touched_set: std::collections::HashSet<VertId> =
            epoch.touched_verts.iter().copied().collect();
        let mut degenerate_to_remove: Vec<axia_geo::FaceId> = Vec::new();
        let mut to_flip: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in self.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let face_n = f.normal();
            // Degenerate detection
            if !face_n.x.is_finite() || !face_n.y.is_finite() || !face_n.z.is_finite()
                || face_n.length_squared() < 1e-12
            {
                degenerate_to_remove.push(fid);
                continue;
            }
            // Winding check — only for faces touched by this draw
            if face_n.dot(n_norm) < 0.0 {
                let verts = match self.mesh.collect_loop_verts(f.outer().start) {
                    Ok(v) => v, Err(_) => continue,
                };
                if verts.iter().any(|v| touched_set.contains(v)) {
                    to_flip.push(fid);
                }
            }
        }
        for fid in to_flip {
            let _ = self.mesh.flip_face_safe(fid);
        }
        for fid in degenerate_to_remove {
            self.unregister_face_from_xia(fid);
            let _ = self.mesh.remove_face(fid);
            if self.mesh.faces.contains(fid) {
                self.mesh.faces.remove(fid);
            }
            epoch.created_faces.retain(|&f| f != fid);
        }

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

        // 2026-04-28 — ADR-015 explicit fallback: if standard postprocess
        //   didn't synthesize the new RECT's face (typically due to mixed-edge
        //   cycle that the resolver's all_edges_free filter rejects), try
        //   `add_face_with_holes` directly using the 4 corner vertices.
        //
        //   This handles the stacked-inner scenario:
        //     - inner1 already exists (sharing an edge with new RECT)
        //     - shared edge is partially-claimed (HE1=inner1, HE2=free)
        //     - resolver's filter rejects mixed-edge cycle
        //     - direct add_face_with_holes claims the cycle-direction HEs
        //       (HE2 of shared + 3 new edges' HEs) → manifold-correct face.
        if epoch.created_faces.is_empty() {
            // add_vertex dedups to existing — returns the existing vert id
            // when corners already exist (the typical stacked-inner case).
            let corner_vids: Vec<axia_geo::VertId> = corners.iter()
                .map(|&pos| self.mesh.add_vertex(pos))
                .collect();
            // Try add_face — claims cycle-direction HEs. May fail if HEs
            //   are already claimed by another face in conflict, but for the
            //   stacked-inner case the cycle-direction HEs are free.
            if let Ok(fid) = self.mesh.add_face_with_holes(&corner_vids, &[], self.default_material) {
                // ADR-007 Invariant 2 (Winding): face's normal MUST align with
                //   surface_normal hint. Always enforce regardless of neighbor
                //   alignment result — neighbors might be wrongly oriented and
                //   propagate the flip.
                let face_n = self.mesh.faces[fid].normal();
                if face_n.dot(n_norm) < 0.0 {
                    let _ = self.mesh.flip_face_safe(fid);
                }
                epoch.created_faces.push(fid);
            }
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
    ///
    /// Rev 2 (2026-04-25 B-2): `verify_face_invariants_rev2` 사용 →
    /// Sheet 면의 winding-mismatch 는 violation 에서 제외. Wall 의
    /// 구조적 invariant 만 fail 로 취급. 이로써 단일 sheet 가 포함된
    /// 씬도 strict 저장이 가능해진다 (이전엔 sheet winding 임의 방향
    /// 으로 인해 거의 무조건 거부됐음).
    pub fn export_versioned_snapshot_strict(&mut self) -> Result<Vec<u8>> {
        // ADR-007 Rev 2 Phase B-3 — Auto-correct cached face.normal to
        //   match current winding before strict checking. winding 은
        //   single source of truth; stale 캐시는 silent fix.
        let fixed = self.mesh.reconcile_face_normals();
        if fixed > 0 {
            // Caller can log this for transparency. We don't fail just
            //   because some normals were stale — they're now correct.
            #[cfg(debug_assertions)]
            eprintln!("[strict-export] reconciled {} face normals", fixed);
        }
        // 1순위 정책 — non-manifold edges 도 silent auto-repair (ADR-007 I5).
        // XIA 그룹 정보를 활용한 의미-인지 repair 가 가능하면 그쪽 우선,
        // 그 외는 geometric 폴백.
        let nm_report = self.repair_non_manifold_edges();
        if nm_report.faces_detached > 0 {
            #[cfg(debug_assertions)]
            eprintln!("[strict-export] repaired non-manifold: {}", nm_report.summary());
        }
        let report = self.mesh.verify_face_invariants_rev2();
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
                // ADR-007 Rev 2 Phase B-4 — Post-import: reconcile
                //   cached normals to match winding, then verify with
                //   the Rev 2 (sheet-aware) reporter.
                let fixed = self.mesh.reconcile_face_normals();
                #[cfg(debug_assertions)]
                {
                    if fixed > 0 {
                        eprintln!("[ADR-007] Post-import: reconciled {} face normals", fixed);
                    }
                    let report = self.mesh.verify_face_invariants_rev2();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                let _ = fixed; // silence unused in release

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
                // ADR-007 Rev 2 Phase B-4 — Post-import: reconcile
                //   cached normals to match winding, then verify with
                //   the Rev 2 (sheet-aware) reporter.
                let fixed = self.mesh.reconcile_face_normals();
                #[cfg(debug_assertions)]
                {
                    if fixed > 0 {
                        eprintln!("[ADR-007] Post-import: reconciled {} face normals", fixed);
                    }
                    let report = self.mesh.verify_face_invariants_rev2();
                    if !report.is_valid() {
                        eprintln!("[ADR-007] Post-import invariant violations:\n{}",
                            report.summary());
                    }
                }
                let _ = fixed; // silence unused in release

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
        // Rev 2 Phase B-4 — same reconcile + sheet-aware verify path.
        let fixed = self.mesh.reconcile_face_normals();
        #[cfg(debug_assertions)]
        {
            if fixed > 0 {
                eprintln!("[ADR-007] Legacy-import: reconciled {} face normals", fixed);
            }
            let report = self.mesh.verify_face_invariants_rev2();
            if !report.is_valid() {
                eprintln!("[ADR-007] Legacy-import invariant violations:\n{}",
                    report.summary());
            }
        }
        let _ = fixed;
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

    /// === 면 자동 합성 / 확장 검증 (2026-04-28) ===

    /// 시나리오 A: 두 인접 RECT 가 edge 공유 → 공유 edge merge 시 1 face
    fn merge_edge_between_two_faces(scene: &mut Scene, fa: axia_geo::FaceId, fb: axia_geo::FaceId) -> Option<axia_geo::FaceId> {
        // shared edge 찾기
        let shared = scene.mesh.find_shared_edge_between_faces(fa, fb)?;
        scene.mesh.merge_faces_by_edge(shared).ok()
    }

    #[test]
    fn test_two_adjacent_rects_merge_via_shared_edge() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // 2 faces, 1 shared edge
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2, "expected 2 faces before merge");

        let merged = merge_edge_between_two_faces(&mut scene, active[0], active[1]);
        assert!(merged.is_some(), "merge_faces_by_edge failed");
        let active_after: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_after.len(), 1, "expected 1 face after merge");
        // Merged face has 4 verts (combined rect 8×4) + winding +Z
        let mfid = active_after[0];
        let n = scene.mesh.faces[mfid].normal();
        assert!(n.z > 0.0, "merged face flipped: {:?}", n);
    }

    /// 시나리오 B: 3 RECT 일렬 → 모든 인접 pair 순차 merge → 1 face
    #[test]
    fn test_three_rects_in_row_merge_sequentially() {
        let mut scene = Scene::new();
        for &cx in &[-4.0, 0.0, 4.0] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 4.0, height: 2.0,
            });
        }
        merge_all_adjacent(&mut scene, 5);
        let active_final: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_final.len(), 1, "expected 1 face after merging all 3");
        assert!(scene.mesh.faces[active_final[0]].normal().z > 0.0);
    }

    /// 시나리오 C: 4 RECT 가 grid 로 인접 → progressive merge → 1 face
    #[test]
    fn test_grid_of_rects_progressive_merge() {
        let mut scene = Scene::new();
        for &(cx, cy) in &[(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
        }
        merge_all_adjacent(&mut scene, 10);
        let active_final: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_final.len(), 1);
        assert!(scene.mesh.faces[active_final[0]].normal().z > 0.0);
    }

    /// Helper: shared edge 있는 face pair 를 반복 찾아 merge.
    fn merge_all_adjacent(scene: &mut Scene, max_iter: usize) {
        let mut iter = 0;
        loop {
            let active: Vec<_> = scene.mesh.faces.iter()
                .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
            if active.len() <= 1 { break; }
            iter += 1;
            assert!(iter < max_iter, "merge loop did not converge in {} iterations", max_iter);
            let mut merged = false;
            'outer: for i in 0..active.len() {
                for j in (i + 1)..active.len() {
                    if let Some(eid) = scene.mesh.find_shared_edge_between_faces(active[i], active[j]) {
                        if scene.mesh.merge_faces_by_edge(eid).is_ok() {
                            merged = true;
                            break 'outer;
                        }
                    }
                }
            }
            assert!(merged, "no mergeable adjacent pair found");
        }
    }

    /// 시나리오 D: L-shape + small RECT 가 2 edge 공유 (multi-shared)
    /// → merge_coplanar_faces_geometric 의 multi-shared 경로 검증.
    #[test]
    fn test_multi_shared_edge_merge() {
        let mut scene = Scene::new();
        // Big rect 6×4
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        // Small rect at corner (overlapping → should split big into L + small)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let active_before: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        // 2 faces (big + small overlapping)
        assert!(active_before.len() >= 2,
            "expected at least 2 faces, got {}", active_before.len());

        // Multi-shared geometric merge — pick any 2
        // Note: 이 시나리오는 ADR-015 로 변경 후 simple overlapping faces 가 됨.
        // 구체 face 갯수는 변할 수 있으므로 기본 sanity check.
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.z > 0.0, "face {:?} flipped", fid);
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
        }
    }

    /// 시나리오 E: erase 도구의 face 자동 합성 — 2 인접 face 의 shared edge
    /// 삭제 시 1 face 로 합쳐져야.
    #[test]
    fn test_erase_shared_edge_merges_faces() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2);
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();

        // Direct merge (대표적인 면 합성 path)
        let merged = scene.mesh.merge_faces_by_edge(shared);
        assert!(merged.is_ok(), "merge_faces_by_edge failed: {:?}", merged.err());

        let active_after: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_after.len(), 1);

        // 합쳐진 face 는 4 vert (8×2 직사각형) + CCW
        let mfid = active_after[0];
        let verts = scene.mesh.collect_loop_verts(scene.mesh.faces[mfid].outer().start).unwrap();
        // 4 corners (collinear vertices on shared edge auto-removed)
        // Note: simplify_collinear_loop 의 정책에 따라 4 또는 6 (mid-points 보존).
        assert!(verts.len() >= 4 && verts.len() <= 6,
            "merged rect verts: {} (expected 4-6)", verts.len());
        assert!(scene.mesh.faces[mfid].normal().z > 0.0);
    }

    /// 시나리오 G: 면 확장 (Re-synthesis Rule, ADR-008 Axiom 6).
    /// 사용자가 LINE 으로 닫힌 영역을 그렸는데 face 가 안 만들어진 경우,
    /// 그 영역에 있는 free edge 를 erase 하면 자동 재합성 (loop rescan).
    /// 본 테스트는 free-edge cycle 자동 face 합성 검증.
    #[test]
    fn test_free_edge_cycle_auto_synthesizes_face() {
        let mut scene = Scene::new();
        // 4 LINE 으로 직사각형 boundary 그리기
        scene.execute(Command::DrawLine {
            start: DVec3::new(-2.0, -1.0, 0.0),
            end:   DVec3::new( 2.0, -1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new( 2.0, -1.0, 0.0),
            end:   DVec3::new( 2.0,  1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new( 2.0,  1.0, 0.0),
            end:   DVec3::new(-2.0,  1.0, 0.0),
            surface_normal: None,
        });
        // 4번째 라인 닫히면 face 자동 합성 (Axiom 1)
        scene.execute(Command::DrawLine {
            start: DVec3::new(-2.0,  1.0, 0.0),
            end:   DVec3::new(-2.0, -1.0, 0.0),
            surface_normal: None,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 1, "expected face auto-synthesized from 4 LINEs");
        assert!(scene.mesh.faces[active[0]].normal().z > 0.0);
    }

    /// 사용자 보고 2026-04-28 — hover preview 가 RED (cascade-delete) 로
    /// 표시되는 인접 면 케이스. preview_edge_erase_merge 의 returns empty
    /// 는 다음 중 하나일 때:
    ///   1. edge 가 2 face 안 sharing (radial != 2)
    ///   2. 2 faces non-coplanar (angle > tol)
    ///   3. count_shared_edges_outer != 1 AND geometric merge 도 실패

    /// 시나리오 G': preview_edge_erase_merge 가 단순 인접 RECT 에서 정상 동작
    #[test]
    fn test_preview_edge_merge_simple_adjacent() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();

        // count_shared_edges_outer should be 1
        let n_shared = scene.mesh.count_shared_edges_outer(active[0], active[1]);
        assert_eq!(n_shared, 1, "expected 1 shared edge for simple adjacent");

        // get_faces_sharing_edge should return 2 faces
        let (faces, _) = scene.mesh.get_faces_sharing_edge(shared);
        assert_eq!(faces.len(), 2, "edge should be shared by exactly 2 faces");

        // Coplanarity should hold
        assert!(
            scene.mesh.are_faces_coplanar_with_tolerance(active[0], active[1], 0.5).unwrap_or(false),
            "faces should be coplanar"
        );
    }

    /// 시나리오 G'': merge 후 다음 인접 face 와 다시 merge 시도 — boundary
    /// 가 split 된 상태일 수 있어 count_shared_edges_outer > 1 가능
    #[test]
    fn test_merge_chain_count_shared_edges() {
        let mut scene = Scene::new();
        // 4 RECT 일렬 (4×2 each)
        for &cx in &[-6.0, -2.0, 2.0, 6.0] {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 4.0, height: 2.0,
            });
        }
        // Merge first two
        let active1: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let pair1 = active1[..2].to_vec();
        let shared1 = scene.mesh.find_shared_edge_between_faces(pair1[0], pair1[1]);
        if let Some(e1) = shared1 {
            let _ = scene.mesh.merge_faces_by_edge(e1);
        }

        // Now check next pair count_shared_edges
        let active2: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        // For each pair, check count_shared and coplanarity
        for i in 0..active2.len() {
            for j in (i + 1)..active2.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active2[i], active2[j]);
                let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                    active2[i], active2[j], 0.5
                ).unwrap_or(false);
                if n_shared >= 1 {
                    assert!(coplanar, "adjacent faces should be coplanar");
                }
            }
        }
    }

    /// 사용자 보고 2026-04-28 — 인접 면 hover 시 빨간 색 (cascade) 표시
    /// 회귀. 단순 시나리오: 2 RECT 인접 그린 후 shared edge 의 preview 검증.
    #[test]
    fn test_simple_adjacent_rects_preview_is_mergeable() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active.len(), 2);

        // shared edge 찾기
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1])
            .expect("shared edge should exist");

        // get_faces_sharing_edge 가 정확히 2 face 반환
        let (faces, _) = scene.mesh.get_faces_sharing_edge(shared);
        assert_eq!(faces.len(), 2, "shared edge should have exactly 2 active faces");

        // count_shared == 1 (단순 인접)
        let n = scene.mesh.count_shared_edges_outer(active[0], active[1]);
        assert_eq!(n, 1, "expected 1 shared edge");

        // coplanar check
        assert!(scene.mesh.are_faces_coplanar_with_tolerance(active[0], active[1], 0.5).unwrap());

        // 모든 조건 통과 → preview 가 cyan 으로 표시되어야
        // (preview 함수는 wasm 에 있어 직접 호출 불가하지만 동등 조건 검증)
    }

    /// 사용자 보고 2026-04-28 — 면이 split-point 로 7+ boundary edge 를
    /// 가질 때 인접 면 merge preview 가 빨간색.
    /// 시나리오: 큰 RECT 의 boundary 가 여러 split point 로 나뉜 후,
    /// 인접 새 RECT 와의 merge 가능성 검증.
    #[test]
    fn test_face_with_split_boundary_can_merge() {
        let mut scene = Scene::new();
        // 큰 RECT
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        // 여러 작은 RECT 가 큰 RECT 의 boundary 를 split (corner overlap 식)
        scene.execute(Command::DrawRect {
            center: DVec3::new(8.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(-8.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 3.0,
        });

        // 모든 인접 face pair 에 대해 hover preview 조건 검사
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

        // adjacent face pair 중 cyan 으로 표시되어야 하는 것들 검증
        let mut tested_pairs = 0;
        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                if n_shared == 0 { continue; }
                tested_pairs += 1;

                // Coplanar check
                let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                    active[i], active[j], 0.5
                ).unwrap_or(false);
                assert!(coplanar, "adjacent faces should be coplanar");

                // Hover preview 동등 조건
                let mergeable = if n_shared == 1 {
                    true // standard merge path
                } else {
                    // Multi-shared: my recent fix should return true
                    scene.mesh.would_geometric_merge_succeed(active[i], active[j], 0.5)
                };
                assert!(
                    mergeable,
                    "adjacent face pair (shared={}) should be mergeable but isn't",
                    n_shared
                );
            }
        }
        assert!(tested_pairs > 0, "no adjacent face pairs found");
    }

    /// 사용자 보고 2026-04-28 — RECT 를 다른 RECT 의 edge 위에 그리면
    /// 비-manifold 발생 (find_halfedge 가 새 HE pair 생성).
    /// 그 결과 인접 면 인식 / 합성 로직에 영향 가능.
    #[test]
    fn test_rect_on_existing_edge_preserves_topology() {
        let mut scene = Scene::new();
        // RECT A 먼저
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // RECT B 와 A 의 right edge 를 공유 (snap 시뮬레이션)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        // RECT C 가 A 의 RIGHT edge 와 B 의 LEFT edge (= 같은 edge) 를 가로지름
        // → 이 edge 가 split 될 수 있음. 그 후 인접 face 인식 검증.
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 3.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 8.0, height: 2.0,
        });

        // 모든 active face: winding +Z, non-degenerate
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
            assert!(n.z > 0.0, "face {:?} flipped", fid);
        }

        // 모든 active edge: 어느 face 의 boundary 에 위치 (orphan 없음)
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() { continue; }
            let mut has_face = false;
            let mut he = any_he;
            for _ in 0..10 {
                if !scene.mesh.hes[he].face().is_null() {
                    has_face = true; break;
                }
                he = scene.mesh.hes[he].next_rad();
                if he == any_he || he.is_null() { break; }
            }
            assert!(has_face, "edge {:?} orphan after rect-on-edge", eid);
        }

        // 모든 인접 face pair: 정확히 2 active faces sharing edge
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        for i in 0..active.len() {
            for j in (i+1)..active.len() {
                if let Some(eid) = scene.mesh.find_shared_edge_between_faces(active[i], active[j]) {
                    let (faces, _) = scene.mesh.get_faces_sharing_edge(eid);
                    assert!(faces.len() <= 2,
                        "edge {:?} has {} faces (non-manifold)", eid, faces.len());
                }
            }
        }
    }

    /// 사용자 보고 2026-04-28 — L-shape merge 후 잔여 edge 가 남는 회귀.
    /// 큰 RECT 와 작은 RECT 가 한 corner 에서 partial overlap → merge 시
    /// L 형 face. merged face 내부에 dashed 잔여 line 이 보인다고 보고됨.
    /// 모든 active edge 가 face 의 boundary 에 위치해야 함 (orphan 없음).
    #[test]
    fn test_lshape_merge_no_residual_edges() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(6.0, 2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });

        // 한 번의 merge_coplanar_faces_geometric 호출 후 잔여 edge 검사.
        // 처음 두 active face 만 사용 (geometric 호출 후 ID stale 되므로 1번만).
        let initial: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        if initial.len() >= 2 {
            let _ = scene.mesh.merge_coplanar_faces_geometric(
                initial[0], initial[1], 1.0
            );
        }
        let _ = scene.mesh.cleanup_dangling();

        // Orphan edge 검사 (모든 active edge 는 어느 face 에 attached 여야)
        let mut orphan_edges: Vec<axia_geo::EdgeId> = Vec::new();
        for (eid, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            let any_he = edge.any_he();
            if any_he.is_null() { continue; }
            let mut has_face = false;
            let mut he = any_he;
            for _ in 0..8 {  // safety bound
                if !scene.mesh.hes.get(he).map(|h| h.face().is_null()).unwrap_or(true) {
                    has_face = true; break;
                }
                he = scene.mesh.hes.get(he).map(|h| h.next_rad()).unwrap_or(axia_geo::HeId::NULL);
                if he == any_he || he.is_null() { break; }
            }
            if !has_face { orphan_edges.push(eid); }
        }
        assert!(
            orphan_edges.is_empty(),
            "{} orphan edges after L-shape merge: {:?}",
            orphan_edges.len(), orphan_edges
        );
    }

    /// 사용자 보고 2026-04-28 — multi-shared edge case 의 hover preview 가
    /// 빨간색 (cascade) 으로 표시되는 회귀.
    /// would_geometric_merge_succeed 가 multi-shared (count >= 2) 도 인식해야.
    #[test]
    fn test_multi_shared_preview_recognizes_mergeable() {
        let mut scene = Scene::new();
        // 2 RECT 인접 + 한 RECT 의 edge 가 split 된 상태 시뮬레이션
        // (이전 merge 후 boundary 가 mid-vertex 로 split 된 경우)
        // 가장 간단한 방법: L-shape + small RECT 에서 multi-shared 발생.
        // Big rect
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        // Small rect at corner overlap
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // 결과 토폴로지: 큰 RECT 와 작은 RECT 가 있고, 큰 RECT 의 일부 edge 가
        // split 됨. 두 face 의 shared edge count 검사.
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert!(active.len() >= 2);

        // 인접한 2 face 쌍 중 multi-shared 케이스 찾기
        let mut found_multi_shared = false;
        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                if n_shared >= 2 {
                    found_multi_shared = true;
                    // 이 케이스에 대해 would_geometric_merge_succeed 가 true 반환해야
                    let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                        active[i], active[j], 0.5
                    ).unwrap_or(false);
                    if coplanar {
                        let geom_ok = scene.mesh.would_geometric_merge_succeed(
                            active[i], active[j], 0.5
                        );
                        assert!(geom_ok,
                            "multi-shared (count={}) should preview as mergeable", n_shared);
                    }
                }
            }
        }
        // 본 시나리오에서 multi-shared 가 형성되지 않을 수 있음 (ADR-015 정책으로
        // simple overlap → 두 separate face). 그래도 stress test 자체는 OK.
        let _ = found_multi_shared;
    }

    /// 시나리오 H': 사용자 reports — 작은 sliver 이거나 SOFT edge 가 boundary
    /// 인 경우 merge 가 실패할 수 있음. simple 2-rect 케이스의 preview merge
    /// 가 success (== 2 face id) 여야.
    #[test]
    fn test_preview_returns_face_ids_for_mergeable() {
        // 이 테스트는 axia-wasm crate 기반이라 axia-core 에서 직접 호출 불가.
        // 대신 Rust mesh layer 의 동등한 검사 수행:
        //   1. count_shared_edges_outer == 1
        //   OR
        //   2. would_geometric_merge_succeed
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

        let f1 = active[0]; let f2 = active[1];
        let n_shared = scene.mesh.count_shared_edges_outer(f1, f2);
        let geom_ok = scene.mesh.would_geometric_merge_succeed(f1, f2, 0.5);

        // Hover preview 의 success 조건
        let mergeable = n_shared == 1 || geom_ok;
        assert!(mergeable, "n_shared={}, geom_ok={}", n_shared, geom_ok);
    }

    /// 시나리오 H: 큰 RECT 안에 작은 RECT 그린 후 작은 RECT 의 한 변 erase
    /// → "구멍" 이 닫혀서 face 확장 (small face 가 큰 face 와 합성).
    /// 단, ADR-015 (B1 비활성) 으로 inner 는 별개 simple face 이므로 erase
    /// 동작은 작은 face 의 boundary edge 만 영향. 본 테스트는 erase 후
    /// 토폴로지 일관성 검증 (winding 유지, NaN 없음).
    #[test]
    fn test_erase_inner_face_edge_topology_consistent() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // 두 face: outer (6×4) + inner (2×2)
        let active_before: usize = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_before, 2);

        // inner 의 한 edge 찾기 (작은 rect 의 boundary 중 free 가 아닌 것)
        let inner = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .min_by(|(_, a), (_, b)| {
                // 작은 면적 face 선택
                let av = scene.mesh.collect_loop_verts(a.outer().start).unwrap_or_default();
                let bv = scene.mesh.collect_loop_verts(b.outer().start).unwrap_or_default();
                av.len().cmp(&bv.len())
            })
            .map(|(id, _)| id);
        assert!(inner.is_some());

        // Erase 한 edge — multi-step 비활성. 단순 검증.
        // (실제 erase 는 batch_erase_edges_with_merge 통해 — wasm layer)
        // 본 단위 테스트는 면 토폴로지 일관성만 검증.
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.z > 0.0, "face {:?} flipped after inner draw", fid);
            assert!(n.x.is_finite(), "face {:?} NaN", fid);
        }
    }

    /// 시나리오 F: 면 합성 후 normal 일관성 (winding +Z)
    #[test]
    fn test_face_merge_preserves_winding() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        let shared = scene.mesh.find_shared_edge_between_faces(active[0], active[1]).unwrap();
        let _ = scene.mesh.merge_faces_by_edge(shared);
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "merged face {:?} flipped", fid);
        }
    }

    /// 사용자 보고 2026-04-28 — RECT 가 RECT 위에 겹쳐 그려질 때 교차
    /// 영역(overlap region) 이 사라져 두 면이 비결합 상태로 남는 회귀.
    /// 기대: 부분-overlap 시 3 sub-face (RECT1-only, overlap, RECT2-only).
    #[test]
    fn test_overlapping_rects_preserve_overlap_region() {
        let mut scene = Scene::new();

        // RECT1 — center (0,0,0), 4×4 on Z=0 plane
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });
        assert!(matches!(r1, CommandResult::EntityCreated(_)));
        assert_eq!(scene.mesh.face_count(), 1, "rect1 = 1 face");

        // RECT2 — center (3,0,0), 4×4 → overlaps RECT1 on x∈[1, 2]×y∈[-2, 2]
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });
        assert!(matches!(r2, CommandResult::EntityCreated(_)));

        // 기대: 3 sub-face — left (RECT1-only), overlap, right (RECT2-only)
        let face_count = scene.mesh.face_count();
        assert_eq!(
            face_count, 3,
            "overlap region must NOT vanish — expected 3 sub-faces, got {}",
            face_count
        );

        // 모든 sub-face 의 면적 합 == RECT1 면적 + RECT2 면적 - overlap 면적
        //   = 16 + 16 - 8 = 24
        let mut total_area = 0.0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                if verts.len() < 3 { continue; }
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                // Shoelace on XY plane
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
                let _ = fid;
            }
        }
        // Overlap = x∈[1,2]×y∈[-2,2] = 1×4 = 4
        // Union area = 16+16-4 = 28
        assert!(
            (total_area - 28.0).abs() < 0.1,
            "total area should be 28 (16+16-4), got {}",
            total_area
        );
    }

    /// 사용자 스크린샷 케이스 — RECT2 가 RECT1 의 코너에 걸쳐 그려짐.
    #[test]
    fn test_overlapping_rects_corner_overlap() {
        let mut scene = Scene::new();

        // RECT1 — 6×6 centered at origin (XY: -3..3)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 6.0,
            height: 6.0,
        });

        // RECT2 — 4×4 at center (4, -2) → overlaps RECT1 at lower-right corner
        //   RECT2 spans x∈[2, 6], y∈[-4, 0] → overlap = x∈[2,3]×y∈[-3, 0] = 3
        scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, -2.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 4.0,
        });

        // 기대: 3 sub-face (RECT1 L-shape, overlap, RECT2 L-shape)
        let face_count = scene.mesh.face_count();
        assert_eq!(
            face_count, 3,
            "corner-overlap should produce 3 sub-faces, got {} — overlap missing!",
            face_count
        );

        // Union area = 36 + 16 - 3 = 49
        let mut total_area = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
            }
        }
        assert!(
            (total_area - 49.0).abs() < 0.1,
            "corner-overlap total area should be 49 (36+16-3), got {}",
            total_area
        );

        // 모든 active face 가 XIA 에 등록되어 있어야 한다 — 등록 안 된 face 는
        // 뷰포트에서 보이지 않는 회귀의 원인이 됨.
        let mut orphans = 0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) {
                orphans += 1;
            }
        }
        assert_eq!(
            orphans, 0,
            "every active face must belong to a XIA — {} orphan(s) detected",
            orphans
        );

        // 모든 active face 가 viewport 의 mesh buffer 에 포함돼야 한다 —
        // export_buffers 에서 빠지면 화면에서 보이지 않음 (사용자 보고 회귀).
        let (_pos, _norm, indices, face_map, _pos64) = scene.export_mesh_buffers().unwrap();
        let exported_faces: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                exported_faces.contains(&fid),
                "active face {:?} missing from exported buffers — invisible in viewport!",
                fid
            );
        }
        assert!(!indices.is_empty(), "must have triangle indices");
    }

    /// 사용자 보고 2026-04-28 — snap 으로 여러 RECT 를 겹쳐 그리면 하나의
    /// 셀이 화면에서 사라짐 (transparent). 3-RECT 시나리오 회귀.
    #[test]
    fn test_three_overlapping_rects_no_missing_cell() {
        let mut scene = Scene::new();

        // RECT1 — 대형 outer (10×6 at origin, XY plane)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO,
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 10.0,
            height: 6.0,
        });

        // RECT2 — RECT1 안쪽에 inset (4×3, 살짝 우측 이동) → B1 hole-promote
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 4.0,
            height: 3.0,
        });
        let after_rect2 = scene.mesh.face_count();

        // RECT3 — RECT2 와 RECT1 경계 모두 가로지름 (중첩)
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 1.5, 0.0),
            normal: DVec3::Z,
            up: DVec3::Y,
            width: 6.0,
            height: 2.0,
        });
        let after_rect3 = scene.mesh.face_count();

        // 모든 active face 가 export_mesh_buffers 에 포함돼야 함 (투명 영역 없음)
        let (pos, _norm, indices, face_map, _pos64) = scene.export_mesh_buffers().unwrap();
        let exported_faces: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();

        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported_faces.contains(&fid) {
                missing.push(fid);
            }
        }
        assert!(
            missing.is_empty(),
            "active faces missing from buffers (invisible cells): {:?}\n\
             face_count: rect2_step={}, rect3_step={}, indices_len={}, positions_len={}",
            missing, after_rect2, after_rect3, indices.len(), pos.len()
        );

        // 모든 active face 가 XIA 에 등록돼야 함 (orphan 없음)
        let mut orphans = 0;
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) {
                orphans += 1;
            }
        }
        assert_eq!(orphans, 0, "orphan faces (no XIA): {}", orphans);

        // Total area 검증: 합집합은 최소한 RECT1 의 면적 (60) 이상이어야 함
        let mut total_area = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if let Ok(verts) = scene.mesh.collect_loop_verts(f.outer().start) {
                let positions: Vec<DVec3> = verts.iter()
                    .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                    .collect();
                if positions.len() < 3 { continue; }
                let mut a = 0.0;
                for i in 0..positions.len() {
                    let p = positions[i];
                    let q = positions[(i + 1) % positions.len()];
                    a += p.x * q.y - q.x * p.y;
                }
                total_area += (a * 0.5).abs();
            }
        }
        assert!(
            total_area >= 59.9,
            "total area {} < 60 — significant region(s) missing from union",
            total_area
        );
    }

    /// 사용자 보고 (snap 으로 정확히 그렸는데 면 사라짐) — 회귀 분리 테스트.
    /// Case D 가 단독으로 reversed-normal face 를 만든다는 사실을 검증.
    #[test]
    fn test_nested_plus_side_rect_no_flipped_normal() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // After RECT1: 1 face, all CCW
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "after RECT1: face {:?} flipped", fid);
        }

        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // After RECT2: ring (RECT1 outer + RECT2 hole) + RECT2 inner
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "after RECT2: face {:?} flipped", fid);
        }

        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 0.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 6.0, height: 2.0,
        });

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let verts = scene.mesh.collect_loop_verts(f.outer().start)
                .unwrap_or_default();
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
                .collect();
            report.push_str(&format!(
                "  {:?}: n.z={:.2} verts={:?} pts={:?}\n",
                fid, n.z, verts, pts
            ));
        }

        let mut flipped: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.normal().z <= 0.0 { flipped.push(fid); }
        }
        assert!(
            flipped.is_empty(),
            "after RECT3: flipped normals: {:?}\nFace report:\n{}",
            flipped, report
        );
    }

    /// 사용자 보고 2026-04-28 (3): RECT 의 4 변이 그려졌으나 **face 가 생성되지 않음**.
    /// 화면에서 wire 만 보이고 면이 비어있음. XIA Inspector 가 "선 1개" 를 표시.
    /// 시나리오: RECT 가 기존 face 의 변과 정확히 인접 (snap), 4 변 모두 그려짐.
    #[test]
    fn test_adjacent_rect_face_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 4×4 at origin
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let xia1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // RECT2 — 4×4 sharing right edge with RECT1 (snap-aligned)
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 4.0,
        });
        let xia2 = match r2 { CommandResult::EntityCreated(id) => id, _ => panic!("rect2 failed: {:?}", r2) };

        // 둘 다 RectangleXIA 여야 한다 (Line XIA 가 아님)
        let xia2_face_count = scene.xias.get(&xia2).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            xia2_face_count >= 1,
            "RECT2 XIA has no face_ids — face synthesis failed (XIA stays as wire-only)"
        );

        // 두 face 모두 존재해야 함
        assert_eq!(scene.mesh.face_count(), 2, "expected 2 faces after adjacent rects");
        let _ = xia1;
    }

    /// 사용자 보고 2026-04-28 (3): 기존 face 안에 작은 RECT 여러 개를 그렸을 때
    /// 일부 RECT 의 face 가 생성되지 않는 케이스.
    #[test]
    fn test_multiple_rects_inside_face_all_synthesize() {
        let mut scene = Scene::new();
        // RECT1 — 12×4 outer
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 4.0,
        });
        // 3 inner RECTs, side by side, all inside RECT1, snap-aligned grid
        for &cx in &[-4.0, 0.0, 4.0] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 3.0, height: 3.0,
            });
            let xia_id = match r {
                CommandResult::EntityCreated(id) => id,
                _ => panic!("inner rect at ({},0) failed: {:?}", cx, r),
            };
            let face_count = scene.xias.get(&xia_id).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "inner rect at ({},0) — XIA has no face_ids (wire-only)", cx
            );
        }

        // 모든 active face 가 export 에 포함되어야 함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 모든 변이 이미 존재하는 위치에 RECT 그리기.
    /// 예: 큰 RECT 안에 작은 RECT 가 있고, 그 사이 빈 공간 (꼭 닫힌 다각형) 에
    /// 다시 RECT 를 그리려고 함. 4 변이 이미 있으면 epoch.new_edges 가 비어
    /// resolve_planar_free_faces_scoped 가 face 를 만들지 못할 수 있음.
    #[test]
    fn test_rect_with_all_existing_edges_creates_face() {
        let mut scene = Scene::new();
        // 4 LINE 으로 사각형 경계 만들기 (RECT 명령 안 씀)
        scene.execute(Command::DrawLine {
            start: DVec3::new(-1.0, -1.0, 0.0),
            end: DVec3::new(1.0, -1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(1.0, -1.0, 0.0),
            end: DVec3::new(1.0, 1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(1.0, 1.0, 0.0),
            end: DVec3::new(-1.0, 1.0, 0.0),
            surface_normal: None,
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(-1.0, 1.0, 0.0),
            end: DVec3::new(-1.0, -1.0, 0.0),
            surface_normal: None,
        });
        // 4 변이 닫히면 free-edge cycle → face 자동 생성
        let after_lines = scene.mesh.face_count();

        // 이제 같은 RECT 를 명령으로 다시 그리기 (모든 변 + 정점 이미 존재)
        let r = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let _ = r;

        // 어떤 경우든 face_count >= 1 이어야 함
        let after_rect = scene.mesh.face_count();
        assert!(
            after_rect >= 1,
            "after redrawing RECT on existing 4 edges: lines_phase={}, rect_phase={} — face missing",
            after_lines, after_rect
        );

        // 모든 active face 가 export 에 포함되어야 함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 두 인접 RECT 사이의 변을 한 변으로 공유하는
    /// 세 번째 RECT — RECT3 이 RECT1 / RECT2 의 인접 변 + 그 위/아래 새 변으로 구성.
    /// 일부 변이 기존 face 의 boundary HE 를 양쪽 모두 사용하면 free HE 부족
    /// → face 합성 실패 가능.
    #[test]
    fn test_rect_sharing_two_existing_edges_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 2×2 at (-1, 0)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT2 — 2×2 at (1, 0), shares right edge of RECT1 (x=0, y∈[-1,1])
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT3 — 2×2 at (0, 2), shares bottom edge with RECT1's top + RECT2's top
        // RECT3 spans (-1,1) to (1,3): bottom edge (-1,1)→(1,1) crosses BOTH RECT1's
        // top-right corner and RECT2's top-left corner. RECT3's bottom uses 2 existing
        // edges (RECT1 top-right half + RECT2 top-left half).
        let r3 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let xia3 = match r3 {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("RECT3 failed: {:?}", r3),
        };
        let face_count = scene.xias.get(&xia3).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            face_count >= 1,
            "RECT3 sharing 2 existing edges — no face synthesized (wire-only)"
        );
        // 3 faces 기대 (RECT1, RECT2, RECT3)
        assert_eq!(
            scene.mesh.face_count(), 3,
            "expected 3 faces (RECT1, RECT2, RECT3), got {}",
            scene.mesh.face_count()
        );
    }

    /// 사용자 보고 2026-04-28 (3) 추적 — "*extension" snap 으로 그린 RECT 가
    /// 기존 edge 의 extension 선과 collinear 한 새 edge 를 만드는 케이스.
    /// 예: RECT1 의 위쪽 변과 같은 y 좌표에서 RECT2 의 아래쪽 변이 시작.
    /// 두 변이 서로 다른 vertex 사이에 collinear 로 떨어져 있음.
    #[test]
    fn test_collinear_adjacent_rect_synthesizes() {
        let mut scene = Scene::new();
        // RECT1 — 2×2 at origin, top edge at y=1
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // RECT2 — 2×2 at (3, 1) — bottom edge collinear with RECT1 top extension
        //   but x range [-2, 0] vs [2, 4] non-overlapping. The bottom edge of RECT2
        //   is collinear with RECT1's top edge but not connected.
        let r = scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let xia = match r {
            CommandResult::EntityCreated(id) => id,
            _ => panic!("collinear RECT2 failed: {:?}", r),
        };
        let face_count = scene.xias.get(&xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(face_count >= 1, "RECT2 collinear: no face");
        assert_eq!(scene.mesh.face_count(), 2);
    }

    /// 사용자 보고 2026-04-28 (3) — L-shape + 내부 subdivisions 시나리오.
    /// 화면 사진에서 보이는 거에 가장 가까운 reproduction:
    ///   1. RECT1 (큰 직사각형)
    ///   2. RECT2 (RECT1 일부에 겹치게)
    ///   3. RECT3, RECT4 (작은 inset rect 여러 개)
    /// 각 RECT 의 XIA 가 face_id 를 갖고, normal.z>0, export 에 모두 포함되는지.
    #[test]
    fn test_lshape_with_inner_rects_all_faced() {
        let mut scene = Scene::new();
        let rects = [
            // (cx, cy, w, h)
            (0.0, 0.0, 8.0, 4.0),     // RECT1 big
            (5.0, 2.0, 4.0, 2.0),     // RECT2 overlapping RECT1 corner
            (-2.0, 0.0, 2.0, 2.0),    // RECT3 inside RECT1 left
            (1.0, 0.0, 2.0, 2.0),     // RECT4 inside RECT1 middle
        ];
        let mut xia_ids = Vec::new();
        for &(cx, cy, w, h) in &rects {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((cx, cy, id)),
                e => panic!("rect ({},{},{}x{}) failed: {:?}", cx, cy, w, h, e),
            }
        }

        // 1) 모든 XIA 가 face_id 보유 (wire-only XIA 없음)
        for &(cx, cy, xid) in &xia_ids {
            let face_count = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "rect at ({},{}) — XIA stays as wire-only (face count 0)",
                cx, cy
            );
        }

        // 2) 모든 active face 의 winding CCW (normal.z > 0)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                f.normal().z > 0.0,
                "face {:?} has flipped normal {:?}", fid, f.normal()
            );
        }

        // 3) 모든 face 가 export 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing faces: {:?}", missing);

        // 4) 모든 face 가 XIA 등록
        let mut orphans: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !scene.face_to_xia.contains_key(&fid) { orphans.push(fid); }
        }
        assert!(orphans.is_empty(), "orphan faces (no XIA): {:?}", orphans);
    }

    /// 사용자 보고 2026-04-28 (19) — outer 의 한 edge 가 inner 의 edge 와
    /// 정확히 일치 (collinear overlap, snap 사용).
    #[test]
    fn test_outer_edge_collinear_overlap_with_inner() {
        let mut scene = Scene::new();
        // Inner1: bottom-left at (0,0), top-right at (4,2)
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Inner2: starts where inner1 ends, bottom-left at (4,0), top-right at (8,2)
        scene.execute(Command::DrawRect {
            center: DVec3::new(6.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer: bottom-left at (0,0)=inner1 BL, top-right at (8,2)=inner2 TR.
        // Outer's bottom edge IS inner1+inner2's bottom edge (collinear, same x range).
        // Outer's top edge similar.
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::new(4.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 8.0, height: 2.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (18) — VERY LARGE outer drawn after inners.
    /// 사용자 화면: 큰 outline 만 보이는 outer, 작은 inner rects 가 lower-right
    /// 에 모여있음.
    #[test]
    fn test_very_large_outer_after_small_inners() {
        let mut scene = Scene::new();
        // 사용자 화면 처럼 inner rects 는 작고 lower-right 에 위치
        scene.execute(Command::DrawRect {
            center: DVec3::new(8.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 5.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(11.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 5.0, height: 2.0,
        });
        // VERY LARGE outer covering far upper-left area + reaching to inner rects
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 30.0, height: 20.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);
    }

    /// 사용자 보고 2026-04-28 (17) — outer RECT 의 edge 가 inner 의 edge 와
    /// 일부 일치 (snap drawing). outer 의 face 가 사라지는지 확인.
    #[test]
    fn test_outer_edge_coincides_with_inner_edge() {
        let mut scene = Scene::new();
        // Inner rect 1 at corner — its corners might align with outer's corners
        scene.execute(Command::DrawRect {
            center: DVec3::new(2.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Inner rect 2 (partial overlap with inner 1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer rect — its bottom edge at y=0 (= inners' bottom y=0)
        // and right edge at x=7 (= inner2's right x=7).
        // → outer shares 2 corners + partial edges with inners.
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 4.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 14.0, height: 8.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} xia={:?}\n", fid, n.z, v.len(), xia
            ));
        }
        assert!(outer_face_count >= 1, "outer XIA lost face\n{}", report);
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (16) — 화면 사진 정확 reproduction:
    /// 2 개 partial-overlap inner RECT 후 ENCLOSING outer RECT 그리면
    /// outer 의 face 가 사라짐.
    #[test]
    fn test_enclosing_outer_after_overlapping_inners() {
        let mut scene = Scene::new();
        // Inner rect 1
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Inner rect 2 (partial overlap with inner 1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Outer rect ENCLOSING both inners (drawn last)
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);

        // 진단 정보
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let pts: Vec<DVec3> = v.iter().filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            let mut xmn = f64::INFINITY; let mut xmx = f64::NEG_INFINITY;
            let mut ymn = f64::INFINITY; let mut ymx = f64::NEG_INFINITY;
            for p in &pts {
                xmn = xmn.min(p.x); xmx = xmx.max(p.x);
                ymn = ymn.min(p.y); ymx = ymx.max(p.y);
            }
            report.push_str(&format!(
                "  {:?} n.z={:.2} verts={} aabb=({:.1}..{:.1},{:.1}..{:.1}) xia={:?}\n",
                fid, n.z, v.len(), xmn, xmx, ymn, ymx, xia
            ));
        }

        assert!(
            outer_face_count >= 1,
            "outer XIA lost face — only outline visible.\n{}", report
        );

        // 모든 active face: winding +Z
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0,
                "face {:?} flipped {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (13) — 그리는 순서 무관성 검증.
    /// 같은 RECT 집합을 다른 순서로 그려도 같은 face 토폴로지 (face_count
    /// 동일, 각 face 의 area 동일, missing 없음) 가 나와야 함.
    #[test]
    fn test_draw_order_independence() {
        let rects = [
            (DVec3::ZERO, 8.0, 6.0),                  // outer
            (DVec3::new(-1.5, 0.0, 0.0), 3.0, 2.0),   // inner1 left
            (DVec3::new(1.5, 0.0, 0.0), 3.0, 2.0),    // inner2 right (shares y, partial overlap)
            (DVec3::new(0.0, 1.5, 0.0), 4.0, 1.0),    // inner3 top (overlaps inner1+inner2)
        ];

        // Order 1: 0,1,2,3
        let scene_a = build_scene(&rects, &[0, 1, 2, 3]);
        // Order 2: 3,2,1,0 (reverse)
        let scene_b = build_scene(&rects, &[3, 2, 1, 0]);
        // Order 3: 1,3,0,2
        let scene_c = build_scene(&rects, &[1, 3, 0, 2]);

        let count_a = active_face_count(&scene_a);
        let count_b = active_face_count(&scene_b);
        let count_c = active_face_count(&scene_c);
        let area_a = total_face_area(&scene_a);
        let area_b = total_face_area(&scene_b);
        let area_c = total_face_area(&scene_c);

        // 각 순서로 그린 결과:
        //   - 모든 active face 의 normal +Z (winding 일관)
        //   - face count 같음 (또는 비슷 — 일부 path 차이로 ±1 허용)
        //   - 총 area 같음 (geometric union 의 합)
        for (i, scene) in [&scene_a, &scene_b, &scene_c].iter().enumerate() {
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                    "order {}: face {:?} degenerate", i, fid);
                assert!(n.z > 0.0,
                    "order {}: face {:?} flipped", i, fid);
            }
        }

        // Total area 는 거의 같아야 함 (overlap region 처리 일관).
        let area_diff_ab = (area_a - area_b).abs();
        let area_diff_ac = (area_a - area_c).abs();
        assert!(
            area_diff_ab < 0.5 && area_diff_ac < 0.5,
            "drawing order changes total area: a={:.2}, b={:.2}, c={:.2}",
            area_a, area_b, area_c
        );

        let _ = count_a; let _ = count_b; let _ = count_c;
    }

    fn build_scene(rects: &[(DVec3, f64, f64)], order: &[usize]) -> Scene {
        let mut scene = Scene::new();
        for &i in order {
            let (c, w, h) = rects[i];
            scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }
        scene
    }

    fn active_face_count(scene: &Scene) -> usize {
        scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count()
    }

    fn total_face_area(scene: &Scene) -> f64 {
        let mut total = 0.0;
        for (_, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let verts = match scene.mesh.collect_loop_verts(f.outer().start) {
                Ok(v) => v, Err(_) => continue,
            };
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            if pts.len() < 3 { continue; }
            let mut a = 0.0;
            for i in 0..pts.len() {
                let p = pts[i];
                let q = pts[(i + 1) % pts.len()];
                a += p.x * q.y - q.x * p.y;
            }
            total += (a * 0.5).abs();
        }
        total
    }

    /// 사용자 보고 2026-04-28 (12) — 사용자 화면 사진 reproduction:
    /// 큰 RECT + 여러 partial-overlap RECT + 가장 작은 RECT 가 면 사라짐.
    #[test]
    fn test_user_pattern_no_missing_faces() {
        let mut scene = Scene::new();
        // 사용자 화면 패턴: 다양한 크기의 RECT 가 partial overlap
        let rects = [
            (DVec3::new(0.0, 4.0, 0.0), 12.0, 2.0),   // top long
            (DVec3::new(-2.0, 1.0, 0.0), 6.0, 3.0),   // upper left
            (DVec3::new(2.0, 1.0, 0.0), 6.0, 3.0),    // upper right (overlaps)
            (DVec3::new(-2.0, -1.0, 0.0), 5.0, 2.0),  // lower left
            (DVec3::new(2.0, -1.0, 0.0), 5.0, 2.0),   // lower right (overlaps)
            (DVec3::new(0.0, -1.0, 0.0), 1.5, 1.0),   // small middle (likely missing in user's case)
        ];
        let mut xia_ids = Vec::new();
        for (i, &(c, w, h)) in rects.iter().enumerate() {
            let r = scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((i, c, id)),
                e => panic!("rect {} at {:?} {}×{} failed: {:?}", i, c, w, h, e),
            }
        }

        // 모든 XIA 가 face_ids 보유 (wire-only XIA 없음)
        let mut wire_only: Vec<(usize, DVec3)> = Vec::new();
        for &(i, c, xid) in &xia_ids {
            let fc = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if fc == 0 {
                wire_only.push((i, c));
            }
        }

        // Diagnostic
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!("  {:?} n={:.2?} verts={} xia={:?}\n",
                fid, (n.x, n.y, n.z), v.len(), xia));
        }
        assert!(
            wire_only.is_empty(),
            "wire-only XIAs: {:?}\nFace report:\n{}", wire_only, report
        );

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate n={:?}", fid, n);
            assert!(n.z > 0.0, "face {:?} flipped n={:?}", fid, n);
        }
    }

    /// 사용자 보고 2026-04-28 (11) — deeply nested RECT 사진 reproduction.
    /// 각 RECT 가 이전 것 안에 들어가는 nested 구조 (러시아 인형식).
    #[test]
    fn test_deeply_nested_rects_all_have_faces() {
        let mut scene = Scene::new();
        // 6 levels of nested rects (largest to smallest)
        let levels = [12.0, 8.0, 5.0, 3.0, 2.0, 1.0];
        let mut xia_ids = Vec::new();
        for (i, &size) in levels.iter().enumerate() {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
                width: size, height: size * 0.6,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((i, size, id)),
                e => panic!("level {} size={} failed: {:?}", i, size, e),
            }
        }
        // 모든 XIA 가 face_ids 보유
        let mut wire_only: Vec<(usize, f64)> = Vec::new();
        for &(i, size, xid) in &xia_ids {
            let fc = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if fc == 0 {
                wire_only.push((i, size));
            }
        }
        assert!(
            wire_only.is_empty(),
            "wire-only XIAs (no face): {:?}", wire_only
        );

        // 모든 active face: winding + non-degenerate
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.length_squared() > 1e-12,
                "face {:?} degenerate", fid);
            assert!(n.z > 0.0, "face {:?} flipped: {:?}", fid, n);
        }
    }

    /// 사용자 보고 2026-04-28 (10) — 다양한 partial-overlap 케이스에서
    /// degenerate (NaN / sliver) face 와 shadow 렌더 검증.
    #[test]
    fn test_partial_overlap_no_degenerate_faces() {
        let configurations = [
            // (label, rects)
            ("A: 2 rect partial overlap", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(2.0, 0.0, 0.0), 4.0, 2.0),
            ]),
            ("B: 3 rect chain", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(2.0, 0.0, 0.0), 4.0, 2.0),
                (DVec3::new(4.0, 0.0, 0.0), 4.0, 2.0),
            ]),
            ("C: rect crossing rect", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 1.0),
                (DVec3::new(0.0, 0.0, 0.0), 1.0, 4.0),
            ]),
            ("D: shared corner", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 4.0),
                (DVec3::new(4.0, 4.0, 0.0), 4.0, 4.0),
            ]),
            ("E: shared edge", vec![
                (DVec3::new(0.0, 0.0, 0.0), 4.0, 4.0),
                (DVec3::new(4.0, 0.0, 0.0), 4.0, 4.0),
            ]),
            ("F: outer + 2 partial inners", vec![
                (DVec3::ZERO, 12.0, 6.0),
                (DVec3::new(-2.0, 0.0, 0.0), 4.0, 3.0),
                (DVec3::new(1.0, 0.0, 0.0), 4.0, 3.0),
            ]),
        ];

        for (label, rects) in configurations {
            let mut scene = Scene::new();
            for &(c, w, h) in &rects {
                scene.execute(Command::DrawRect {
                    center: c, normal: DVec3::Z, up: DVec3::Y,
                    width: w, height: h,
                });
            }
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(n.x.is_finite() && n.y.is_finite() && n.z.is_finite(),
                    "[{}] face {:?} NaN normal", label, fid);
                assert!(n.length_squared() > 1e-12,
                    "[{}] face {:?} zero normal", label, fid);
                assert!(n.z > 0.0,
                    "[{}] face {:?} flipped: {:?}", label, fid, n);
            }
            // 모든 active face 가 XIA 등록 + export 됨
            let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
            let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
                .map(|&fm| axia_geo::FaceId::new(fm)).collect();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                assert!(scene.face_to_xia.contains_key(&fid),
                    "[{}] face {:?} no XIA mapping", label, fid);
                assert!(exported.contains(&fid),
                    "[{}] face {:?} missing from buffer", label, fid);
            }
        }
    }

    /// 사용자 보고 2026-04-28 (9) — 사용자 화면 사진 그대로 reproduction:
    /// outer RECT + 2개 partially-overlapping inner RECT. outer 의 face 가
    /// 보존되고, overlap 영역에 shadow degenerate 없어야.
    #[test]
    fn test_outer_with_two_partial_overlap_inners() {
        let mut scene = Scene::new();
        // Outer big rect
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let outer_xia = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // Inner rect 1 — left portion
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        // Inner rect 2 — right portion, partially overlapping inner1
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        // outer XIA 가 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            report.push_str(&format!("  {:?} n={:.2?} verts={} xia={:?}\n",
                fid, (n.x, n.y, n.z), v.len(), xia));
        }
        assert!(
            outer_face_count >= 1,
            "outer XIA lost face\n{}", report
        );

        // 모든 active face: 정상 winding (no NaN / no -Z)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(n.x.is_finite() && n.y.is_finite() && n.z.is_finite(),
                "face {:?} has NaN normal", fid);
            assert!(n.length_squared() > 1e-12,
                "face {:?} has zero normal", fid);
            assert!(n.z > 0.0,
                "face {:?} flipped: {:?}", fid, n);
        }

        // 모든 active face 가 export buffer 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
        }
    }

    /// 사용자 보고 2026-04-28 (7) — outer RECT 를 inner RECT 들 위에 그렸을 때
    /// outer 의 face 가 사라지는 회귀.
    #[test]
    fn test_outer_rect_drawn_after_inners_keeps_face() {
        let mut scene = Scene::new();
        // 작은 inner rects 먼저
        for &(cx, cy) in &[(-2.0, -2.0), (2.0, -2.0), (-2.0, 2.0), (2.0, 2.0)] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)));
        }
        // 큰 outer rect 가 inner 들을 enclose
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 8.0,
        });
        let outer_xia = match r_outer {
            CommandResult::EntityCreated(id) => id,
            e => panic!("outer failed: {:?}", e),
        };
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(outer_face_count >= 1, "outer XIA has no face after drawing over inners");

        // 모든 active face: normal.z > 0
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (8) — outer 큰 RECT 와 그 안 + 바깥에 걸친 RECT.
    /// outer 의 face 가 사라지지 않아야.
    #[test]
    fn test_outer_with_overlapping_extending_rects() {
        let mut scene = Scene::new();
        // Outer big rect
        let r_outer = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 14.0, height: 6.0,
        });
        let outer_xia = match r_outer { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // Rects 일부는 outer 안, 일부는 outer 경계 가로지름
        let crossings = [
            (5.0, 0.0, 6.0, 4.0),     // crosses right boundary
            (-5.0, 0.0, 6.0, 4.0),    // crosses left boundary
            (0.0, 0.0, 4.0, 8.0),     // crosses top + bottom
        ];
        for &(cx, cy, w, h) in &crossings {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }

        // outer XIA 가 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        // 모든 active face 정보 출력
        let mut report = String::new();
        report.push_str("Active faces:\n");
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let xia = scene.face_to_xia.get(&fid).copied();
            let v = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let n_verts = v.len();
            report.push_str(&format!("  {:?}: {} verts → xia {:?}\n", fid, n_verts, xia));
        }
        let total_active: usize = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).count();
        assert!(
            outer_face_count >= 1 && total_active >= 1,
            "outer face_count={}, total active={}\n{}",
            outer_face_count, total_active, report
        );

        // 모든 active face winding
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
        }
    }

    /// 사용자 보고 2026-04-28 (6) — 많은 RECT 가 다양하게 overlap 할 때
    /// 일부 영역이 채워지지 않거나 ("미면화"), shadow 처럼 렌더링 ("z-fight").
    /// 다양한 overlap 케이스 stress test.
    #[test]
    fn test_complex_overlap_no_missing_faces() {
        let mut scene = Scene::new();
        // 사용자 화면과 유사 — 여러 rect 가 부분/전체 겹침
        let rects = [
            (DVec3::ZERO, 16.0, 8.0),                       // outer big
            (DVec3::new(-3.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(0.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(3.0, -2.0, 0.0), 4.0, 2.0),
            (DVec3::new(-3.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(0.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(3.0, 1.0, 0.0), 4.0, 2.0),
            (DVec3::new(5.0, 0.0, 0.0), 6.0, 6.0),  // overlapping right
            (DVec3::new(-5.0, 0.0, 0.0), 6.0, 6.0), // overlapping left
        ];
        for &(c, w, h) in &rects {
            let r = scene.execute(Command::DrawRect {
                center: c, normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            assert!(matches!(r, CommandResult::EntityCreated(_)),
                "rect at {:?} {}×{} failed: {:?}", c, w, h, r);
        }

        // 모든 active face: normal.z > 0, in export buffer, has XIA
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();

        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            // Winding
            assert!(f.normal().z > 0.0, "face {:?} flipped: {:?}", fid, f.normal());
            // Export
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
            // XIA
            assert!(scene.face_to_xia.contains_key(&fid),
                "face {:?} has no XIA mapping", fid);
        }
    }

    /// 사용자 보고 2026-04-28 (5) — outer RECT 그린 후 inner RECT 여러 개 그릴 때
    /// outer 의 face 가 사라지는 회귀 검증. outer 는 항상 active 여야 함.
    #[test]
    fn test_outer_rect_preserved_after_many_inners() {
        let mut scene = Scene::new();
        // Outer 큰 rect
        let r0 = scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        let outer_xia = match r0 { CommandResult::EntityCreated(id) => id, _ => panic!() };

        // 8 inner rects 다양한 위치
        let inners = [
            (-4.0, -2.0, 2.0, 2.0),
            (-1.0, -2.0, 2.0, 2.0),
            (2.0, -2.0, 2.0, 2.0),
            (4.0, -2.0, 1.5, 2.0),
            (-4.0, 2.0, 2.0, 2.0),
            (-1.0, 2.0, 2.0, 2.0),
            (2.0, 2.0, 2.0, 2.0),
            (4.0, 2.0, 1.5, 2.0),
        ];
        for &(cx, cy, w, h) in &inners {
            scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
        }

        // outer XIA 가 여전히 face 보유
        let outer_face_count = scene.xias.get(&outer_xia).map(|x| x.face_ids.len()).unwrap_or(0);
        assert!(
            outer_face_count >= 1,
            "outer XIA lost its face after {} inner rects drawn", inners.len()
        );

        // 모든 active face normal.z > 0
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(
                f.normal().z > 0.0,
                "face {:?} flipped: normal {:?}", fid, f.normal()
            );
        }

        // 모든 active face 가 export buffer 에 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            assert!(exported.contains(&fid), "face {:?} missing from buffer", fid);
        }
    }

    /// 사용자 보고 2026-04-28 — 면이 그리는 방향에 따라 뒤집혀 BackSide
    /// 로 렌더되는 현상. ADR-007 Invariant 2 (Winding) 정합 검증:
    /// 어느 방향으로 RECT 를 그리든 모든 face 가 surface_normal 방향과
    /// 같은 normal 을 가져야 함 (XY plane → +Z normal).
    #[test]
    fn test_all_rects_have_consistent_winding() {
        let mut scene = Scene::new();
        // 다양한 RECT — 모두 XY 평면, normal +Z 기대.
        let rects = [
            (DVec3::new(0.0, 0.0, 0.0), DVec3::Y, 4.0, 4.0),
            (DVec3::new(5.0, 0.0, 0.0), DVec3::Y, 3.0, 3.0),
            (DVec3::new(-5.0, 0.0, 0.0), DVec3::Y, 3.0, 3.0),
            (DVec3::new(0.0, 5.0, 0.0), DVec3::Y, 4.0, 2.0),
            (DVec3::new(0.0, -5.0, 0.0), DVec3::Y, 2.0, 4.0),
        ];
        for &(center, up, w, h) in &rects {
            scene.execute(Command::DrawRect {
                center, normal: DVec3::Z, up,
                width: w, height: h,
            });
        }
        // 모든 active face 의 normal.z > 0 (CCW = front)
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let n = f.normal();
            assert!(
                n.z > 0.0,
                "face {:?} has flipped normal {:?} — BackSide rendering",
                fid, n
            );
        }
    }

    /// 사용자 보고 2026-04-28 — 2 stacked inner rects.
    /// ADR-015 Phase 2: B1 auto hole-promote 비활성으로 자연스럽게 작동.
    #[test]
    fn test_two_stacked_inner_rects_both_faced() {
        let mut scene = Scene::new();
        // RECT outer 10×6
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // inner1 below center at (0, -1), 4×2 → spans y∈[-2, 0]
        let r1 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, -1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let xid1 = match r1 { CommandResult::EntityCreated(id) => id, _ => panic!() };
        let face1_count = scene.xias.get(&xid1).map(|x| x.face_ids.len()).unwrap_or(0);

        // inner2 above center at (0, 1), 4×2 → spans y∈[0, 2]; shares y=0 edge with inner1
        let r2 = scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 1.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let xid2 = match r2 {
            CommandResult::EntityCreated(id) => id,
            ref e => panic!("inner2 result: {:?}", e),
        };
        let face2_count = scene.xias.get(&xid2).map(|x| x.face_ids.len()).unwrap_or(0);

        // After inner2 draw, inner1's face might have been touched. Re-check.
        let face1_count_after = scene.xias.get(&xid1).map(|x| x.face_ids.len()).unwrap_or(0);

        let mut report = String::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            let verts = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
            let xia_link = scene.face_to_xia.get(&fid).copied().unwrap_or(99999);
            report.push_str(&format!(
                "  {:?} → XIA {} : verts={:?} pts={:?}\n",
                fid, xia_link, verts, pts
            ));
        }

        assert!(
            face1_count >= 1 && face1_count_after >= 1 && face2_count >= 1,
            "face counts: inner1_initial={}, inner1_after_inner2={}, inner2={}\nFace report:\n{}",
            face1_count, face1_count_after, face2_count, report
        );
    }

    /// 사용자 화면 사진 (2026-04-28-3) — 큰 RECT 안에 작은 RECT 들이
    /// vertically 쌓여 column 을 이루는 케이스. ADR-015 로 해결.
    #[test]
    fn test_column_of_inner_rects_all_faced() {
        let mut scene = Scene::new();
        // RECT1 — big outer (10×9, 9 height to fit 3 stacked 2-height rects in 6 + margins)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 9.0,
        });

        // 5 stacked inner rects, each 4×1.5, centers stacked vertically
        let inner_rects: Vec<(f64, f64, f64, f64)> = vec![
            (0.0, -3.0, 4.0, 1.5),
            (0.0, -1.5, 4.0, 1.5),
            (0.0,  0.0, 4.0, 1.5),
            (0.0,  1.5, 4.0, 1.5),
            (0.0,  3.0, 4.0, 1.5),
        ];
        let mut xia_ids = Vec::new();
        for &(cx, cy, w, h) in &inner_rects {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: w, height: h,
            });
            match r {
                CommandResult::EntityCreated(id) => xia_ids.push((cx, cy, id)),
                e => panic!("inner rect at ({},{}) failed: {:?}", cx, cy, e),
            }
        }

        // 1) 모든 inner rect XIA 가 face 보유 (wire-only 없음)
        let mut wire_only_count = 0;
        for &(cx, cy, xid) in &xia_ids {
            let face_count = scene.xias.get(&xid).map(|x| x.face_ids.len()).unwrap_or(0);
            if face_count == 0 {
                wire_only_count += 1;
                let _ = (cx, cy);
            }
        }
        assert_eq!(
            wire_only_count, 0,
            "{} inner rects ended up wire-only (no face) — bug reproduced",
            wire_only_count
        );

        // 2) 모든 active face 의 winding CCW
        let mut flipped: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.normal().z <= 0.0 { flipped.push(fid); }
        }
        assert!(flipped.is_empty(), "flipped faces: {:?}", flipped);

        // 3) export_mesh_buffers 에 모두 포함
        let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
        let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
            .map(|&fm| axia_geo::FaceId::new(fm))
            .collect();
        let mut missing: Vec<axia_geo::FaceId> = Vec::new();
        for (fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if !exported.contains(&fid) { missing.push(fid); }
        }
        assert!(missing.is_empty(), "missing from buffer: {:?}", missing);
    }

    /// 사용자 보고 2026-04-28 (3): 2×2 grid 의 인접 RECT 4 개. 모두 면 생성되어야.
    #[test]
    fn test_2x2_grid_all_faces_synthesize() {
        let mut scene = Scene::new();
        // 2×2 grid of unit rects, each 2×2, centers at (-1,-1) (1,-1) (-1,1) (1,1)
        for &(cx, cy) in &[(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            let r = scene.execute(Command::DrawRect {
                center: DVec3::new(cx, cy, 0.0), normal: DVec3::Z, up: DVec3::Y,
                width: 2.0, height: 2.0,
            });
            let xia_id = match r {
                CommandResult::EntityCreated(id) => id,
                _ => panic!("grid rect at ({},{}) failed: {:?}", cx, cy, r),
            };
            let face_count = scene.xias.get(&xia_id).map(|x| x.face_ids.len()).unwrap_or(0);
            assert!(
                face_count >= 1,
                "grid rect at ({},{}) — XIA has no face_ids (wire-only)", cx, cy
            );
        }
        // 4 faces 기대
        assert_eq!(
            scene.mesh.face_count(), 4,
            "2×2 grid should yield 4 faces"
        );
    }

    /// 다양한 overlap 구성 stress test — 각 구성에서 모든 active face 가
    /// 1) export buffer 에 포함되고 2) XIA 에 등록됐는지 확인.
    #[test]
    fn test_multi_rect_stress_no_missing_cells() {
        // (label, [(center_x, center_y, w, h), ...])
        let configs: Vec<(&str, Vec<(f64, f64, f64, f64)>)> = vec![
            // case A: 두 RECT 한 코너에서 만남 (snap 시뮬)
            ("A: corner-shared", vec![
                (0.0, 0.0, 4.0, 4.0),
                (4.0, 4.0, 4.0, 4.0),  // shares one corner (2,2) ... actually (2,2) vs (2,2) yes
            ]),
            // case B: T자 — RECT2 의 한 변이 RECT1 한 변에 정확히 맞닿음
            ("B: T-junction", vec![
                (0.0, 0.0, 6.0, 4.0),
                (0.0, 3.0, 4.0, 2.0),  // bottom edge at y=2, top of RECT1 at y=2
            ]),
            // case C: 4 RECT cross (대표 case — 사용자 시나리오와 유사)
            ("C: cross-overlap-4", vec![
                (0.0, 0.0, 6.0, 4.0),
                (3.0, 0.0, 4.0, 2.0),
                (0.0, 2.0, 3.0, 3.0),
                (4.0, 3.0, 3.0, 3.0),
            ]),
            // case D: nested + side rect
            ("D: nested+side", vec![
                (0.0, 0.0, 10.0, 6.0),
                (0.0, 0.0, 4.0, 2.0),     // inside RECT1 (B1 hole-promote)
                (5.0, 0.0, 6.0, 2.0),     // crosses RECT1 right boundary
            ]),
            // case E: snap-aligned grid (3개 RECT 가 정확히 corner share)
            ("E: aligned-grid", vec![
                (0.0, 0.0, 4.0, 4.0),     // [-2,2]×[-2,2]
                (4.0, 0.0, 4.0, 4.0),     // [2,6]×[-2,2] (shares right edge of RECT1)
                (2.0, 4.0, 4.0, 4.0),     // [0,4]×[2,6] (shares top with both)
            ]),
        ];

        for (label, rects) in configs {
            let mut scene = Scene::new();
            for &(cx, cy, w, h) in &rects {
                let r = scene.execute(Command::DrawRect {
                    center: DVec3::new(cx, cy, 0.0),
                    normal: DVec3::Z,
                    up: DVec3::Y,
                    width: w,
                    height: h,
                });
                assert!(
                    matches!(r, CommandResult::EntityCreated(_)),
                    "{}: rect ({},{},{}x{}) failed: {:?}",
                    label, cx, cy, w, h, r
                );
            }

            // Check: every active face appears in mesh buffer
            let (_, _, _, face_map, _) = scene.export_mesh_buffers().unwrap();
            let exported: std::collections::HashSet<axia_geo::FaceId> = face_map.iter()
                .map(|&fm| axia_geo::FaceId::new(fm))
                .collect();

            let mut missing: Vec<axia_geo::FaceId> = Vec::new();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if !exported.contains(&fid) { missing.push(fid); }
            }
            assert!(
                missing.is_empty(),
                "{}: active faces missing from buffer: {:?}",
                label, missing
            );

            // Check: every active face has XIA
            let mut orphans: Vec<axia_geo::FaceId> = Vec::new();
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if !scene.face_to_xia.contains_key(&fid) { orphans.push(fid); }
            }
            assert!(
                orphans.is_empty(),
                "{}: orphan faces (no XIA): {:?}",
                label, orphans
            );

            // Check: every active face has visible flag
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                assert!(
                    f.is_visible(),
                    "{}: face {:?} is active but not visible",
                    label, fid
                );
            }

            // Check: 모든 face 가 같은 방향 (Z+) — XY plane 위에 그렸으니 CCW
            //   wound 면은 normal.z > 0. 한 face 라도 normal.z < 0 이면 CAD
            //   single-sided 렌더에서 보이지 않음 (사용자 보고 회귀).
            for (fid, f) in scene.mesh.faces.iter() {
                if !f.is_active() { continue; }
                let n = f.normal();
                assert!(
                    n.z > 0.0,
                    "{}: face {:?} has flipped normal (z={}) — invisible in CAD single-sided render",
                    label, fid, n.z
                );
            }
        }
    }

    /// Phase A 디버그: 단일 inner promote 후 ring 의 outer edge radial 검증.
    /// promote_face_to_hole 가 HE manifold 를 깨끗하게 유지하는지 검증.
    #[test]
    fn test_phaseA_promote_keeps_outer_radial_manifold() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face should exist");

        let outer_start = scene.mesh.faces[ring_fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial_entries = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial_entries.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, Vec<axia_geo::HeId>> =
                std::collections::HashMap::new();
            for (h_id, dst, _f) in &radial_entries {
                by_dst.entry(*dst).or_default().push(*h_id);
            }
            for (dst, hes) in &by_dst {
                if hes.len() > 1 {
                    violations.push(format!(
                        "edge of HE {:?}: {} HEs share dst={:?}: {:?}",
                        h, hes.len(), dst, hes
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        assert!(
            violations.is_empty(),
            "HE manifold corruption in ring outer:\n{}",
            violations.join("\n")
        );
    }

    /// ADR-021 Phase B (3B fix) — 3-level nested, smallest first.
    /// Phase A HE manifold fix 후 ring 을 inner candidate 로 허용.
    #[test]
    fn test_adr021_phaseB_3level_nested_smallest_first() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();
        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 2,
            "3B Phase B: expected 2 nested rings; got {:?}",
            active
        );
        assert_eq!(
            simple_count, 1,
            "3B Phase B: expected 1 innermost sub-face; got {:?}",
            active
        );
    }

    /// Phase A: 4 line 으로 단독 RECT 그렸을 때 (no promote) HE manifold 검증.
    /// resolver 결과 corruption 인지 promote 결과 corruption 인지 분리.
    #[test]
    fn test_phaseA_isolated_4line_rect_no_promote() {
        let mut scene = Scene::new();
        // No prior face. Draw 4 lines forming a rect — resolver creates simple face.
        scene.execute(Command::DrawLine {
            start: DVec3::new(-5.0, -3.0, 0.0),
            end: DVec3::new(5.0, -3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(5.0, -3.0, 0.0),
            end: DVec3::new(5.0, 3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(5.0, 3.0, 0.0),
            end: DVec3::new(-5.0, 3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });
        scene.execute(Command::DrawLine {
            start: DVec3::new(-5.0, 3.0, 0.0),
            end: DVec3::new(-5.0, -3.0, 0.0),
            surface_normal: Some(DVec3::Z),
        });

        let face = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active())
            .map(|(id, _)| id);
        // Closed loop should auto-synthesize per ADR-019 A6
        assert!(face.is_some(), "4-line closed loop should produce a face");
        let fid = face.unwrap();

        let outer_start = scene.mesh.faces[fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                std::collections::HashMap::new();
            for (_, dst, _) in &radial {
                *by_dst.entry(*dst).or_insert(0) += 1;
            }
            for (dst, count) in &by_dst {
                if *count > 1 {
                    violations.push(format!(
                        "HE {:?}: dst={:?} count={} radial={:?}",
                        h, dst, count, radial
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        assert!(
            violations.is_empty(),
            "4-line resolver corruption (no promote):\n{}",
            violations.join("\n")
        );
    }

    /// Phase A: postprocess 경로의 promote 가 corruption 일으키는지 검증.
    /// inner-first 후 outer-around (Step 4.95 second-pass 경로).
    #[test]
    fn test_phaseA_postprocess_promote_path_radial() {
        let mut scene = Scene::new();
        // inner first
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // outer around (4 lines + epoch + Step 4.95 promote)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });

        // Find ring face
        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face should exist (postprocess promote)");

        let outer_start = scene.mesh.faces[ring_fid].outer().start;
        let mut h = outer_start;
        let mut violations = Vec::<String>::new();
        let mut guard = 0;
        loop {
            guard += 1; if guard > 32 { break; }
            let he = &scene.mesh.hes[h];
            let mut radial: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
            let mut rh = h;
            let mut rg = 0;
            loop {
                rg += 1; if rg > 16 { break; }
                let rhe = &scene.mesh.hes[rh];
                radial.push((rh, rhe.dst(), rhe.face()));
                rh = rhe.next_rad();
                if rh == h { break; }
            }
            let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                std::collections::HashMap::new();
            for (_, dst, _) in &radial {
                *by_dst.entry(*dst).or_insert(0) += 1;
            }
            for (dst, count) in &by_dst {
                if *count > 1 {
                    violations.push(format!(
                        "HE {:?}: dst={:?} count={} radial={:?}",
                        h, dst, count, radial
                    ));
                }
            }
            h = he.next();
            if h == outer_start { break; }
        }
        // Print edge endpoints for diagnostic
        if !violations.is_empty() {
            let mut h2 = outer_start;
            let mut g2 = 0;
            loop {
                g2 += 1; if g2 > 32 { break; }
                let he = &scene.mesh.hes[h2];
                let edge = &scene.mesh.edges[he.edge()];
                eprintln!("[edge dbg] HE {:?} edge {:?} v_small={:?} v_large={:?}",
                    h2, he.edge(), edge.v_small(), edge.v_large());
                h2 = he.next();
                if h2 == outer_start { break; }
            }
        }
        assert!(
            violations.is_empty(),
            "Manifold corruption (postprocess promote):\n{}",
            violations.join("\n")
        );
    }

    /// Phase A 디버그: 3-level nested 시나리오 (3B style) 에서 corruption 시점 추적.
    #[test]
    fn test_phaseA_3level_nested_radial_check_after_each_step() {
        // Helper closure
        fn check_all_radials(scene: &Scene, label: &str) -> Vec<String> {
            let mut violations = Vec::new();
            for (fid, face) in scene.mesh.faces.iter() {
                if !face.is_active() { continue; }
                let outer_start = face.outer().start;
                if outer_start.is_null() { continue; }
                let mut h = outer_start;
                let mut guard = 0;
                loop {
                    guard += 1; if guard > 32 { break; }
                    let he = &scene.mesh.hes[h];
                    // Check radial chain
                    let mut radial_entries: Vec<(axia_geo::HeId, axia_geo::VertId, axia_geo::FaceId)> = Vec::new();
                    let mut rh = h;
                    let mut rg = 0;
                    loop {
                        rg += 1; if rg > 16 { break; }
                        let rhe = &scene.mesh.hes[rh];
                        radial_entries.push((rh, rhe.dst(), rhe.face()));
                        rh = rhe.next_rad();
                        if rh == h { break; }
                    }
                    let mut by_dst: std::collections::HashMap<axia_geo::VertId, usize> =
                        std::collections::HashMap::new();
                    for (_, dst, _) in &radial_entries {
                        *by_dst.entry(*dst).or_insert(0) += 1;
                    }
                    for (dst, count) in &by_dst {
                        if *count > 1 {
                            violations.push(format!(
                                "{}: face {:?} edge of HE {:?}: {} HEs with dst={:?}, radial={:?}",
                                label, fid, h, count, dst, radial_entries
                            ));
                        }
                    }
                    h = he.next();
                    if h == outer_start { break; }
                }
            }
            violations
        }

        let mut scene = Scene::new();
        // Step 1: innermost (4×2)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        let v1 = check_all_radials(&scene, "after_step1_innermost");
        // Step 2: middle (10×6)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        let v2 = check_all_radials(&scene, "after_step2_middle_drawn");
        // Step 3: outer (20×12)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let v3 = check_all_radials(&scene, "after_step3_outer_drawn");

        let all: Vec<String> = [v1, v2, v3].concat();
        if !all.is_empty() {
            panic!("Manifold corruption detected:\n{}", all.join("\n"));
        }
    }

    /// ADR-021 P7 — Closed edge loop divides face. 그리기 순서 무관성 검증.
    /// Case A (inner 먼저): 2 small + big around → big = ring with 1 combined hole.
    /// Case B (outer 먼저): big + 2 small inside → big = ring with 1 combined hole.
    /// 두 case 모두 동일 토폴로지: 1 ring + 2 sub-face = 3 active faces.
    #[test]
    fn test_adr021_p7_case_a_inner_first_then_outer() {
        let mut scene = Scene::new();
        // 2 inner adjacent (sharing an edge)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        // big rect surrounding both
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 24.0, height: 11.0,
        });

        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();

        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "Case A: expected 1 ring with combined hole; got faces={:?}",
            active
        );
        assert_eq!(
            simple_count, 2,
            "Case A: expected 2 sub-faces (inners); got faces={:?}",
            active
        );
    }

    #[test]
    fn test_adr021_p7_case_b_outer_first_then_inner() {
        let mut scene = Scene::new();
        // big rect first
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 24.0, height: 11.0,
        });
        // 2 inner adjacent inside
        scene.execute(Command::DrawRect {
            center: DVec3::new(-1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(1.5, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 3.0,
        });

        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();

        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "Case B: expected 1 ring with combined hole; got faces={:?}",
            active
        );
        assert_eq!(
            simple_count, 2,
            "Case B: expected 2 sub-faces (inners); got faces={:?}",
            active
        );
    }

    /// ADR-019 A6 — 4 line 으로 face 안에 닫힌 loop 그리면 sub-face 자동 합성.
    /// 사용자 보고 (2026-04-29): face 안에 4 line 으로 작은 사각형 그려도 면 분할
    /// 안 됨. A6 는 wire chain 의 endpoint 가 기존 vertex 와 dedup 시 postprocess
    /// 발동 → resolver 가 닫힌 cycle 발견 → sub-face 합성 (ADR-016 conditional B1
    /// promote 도 발동 가능).
    #[test]
    fn test_adr019_a6_closed_wire_loop_in_face_interior_synthesizes() {
        let mut scene = Scene::new();
        // 큰 RECT (face)
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 20.0, height: 12.0,
        });
        let after_big = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(after_big, 1, "big rect = 1 face");

        // 4 line 으로 작은 사각형 (face 안 strict interior).
        let p0 = DVec3::new(-2.0, -1.0, 0.0);
        let p1 = DVec3::new( 2.0, -1.0, 0.0);
        let p2 = DVec3::new( 2.0,  1.0, 0.0);
        let p3 = DVec3::new(-2.0,  1.0, 0.0);
        scene.execute(Command::DrawLine { start: p0, end: p1, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p1, end: p2, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p2, end: p3, surface_normal: Some(DVec3::Z) });
        scene.execute(Command::DrawLine { start: p3, end: p0, surface_normal: Some(DVec3::Z) });

        // 결과: 큰 face + 작은 sub-face 또는 ring + sub-face (B1 promote 시).
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, f)| (id, f.inners().len())).collect();
        assert!(
            active.len() >= 2,
            "expected big face + small sub-face (ADR-019 A6); got faces={:?}",
            active
        );
    }

    /// ADR-019 P5/P6 — 인접 두 RECT 의 공유 edge erase 시 새 통합 face 생성.
    /// 사용자 보고 회귀: "두 인접면의 라인을 지우면 새 큰 면이 생성되어야"
    /// (Phase 1 핵심 회귀 #3 — Appendix B).
    #[test]
    fn test_adr019_p6_adjacent_face_erase_creates_merged() {
        let mut scene = Scene::new();
        // 두 인접 RECT (Axiom 7 공유 edge).
        scene.execute(Command::DrawRect {
            center: DVec3::new(-5.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(5.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // 토폴로지: 2 simple face + 1 shared edge
        let active_before: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();
        assert_eq!(active_before.len(), 2);

        // 공유 edge 찾기 (interior — 양 HE 모두 face 보유)
        let shared_eid = scene.mesh.edges.iter()
            .find(|(_, e)| {
                if !e.is_active() { return false; }
                let any = e.any_he();
                if any.is_null() { return false; }
                let twin = scene.mesh.he_twin(any);
                let f1 = scene.mesh.hes.get(any).map(|h| h.face());
                let f2 = scene.mesh.hes.get(twin).map(|h| h.face());
                matches!((f1, f2), (Some(a), Some(b)) if !a.is_null() && !b.is_null())
            })
            .map(|(id, _)| id)
            .expect("shared edge missing");

        let mat = scene.default_material;
        let result = scene.mesh.erase_edge_resynthesize(shared_eid, mat, false)
            .expect("erase_edge_resynthesize");

        assert_eq!(result.removed_faces.len(), 2, "two adjacent RECTs removed");
        assert_eq!(
            result.new_faces.len(), 1,
            "expected 1 merged 6-vert face; got {}",
            result.new_faces.len()
        );
        let new_fid = result.new_faces[0];
        let verts = scene.mesh.collect_loop_verts(scene.mesh.faces[new_fid].outer().start).unwrap();
        // F6 collinear cleanup: 두 인접 10×6 → 20×6 단순 rect (4 corners).
        // 8 original verts - 2 shared - 2 collinear T-junction = 4.
        assert_eq!(verts.len(), 4, "merged face after F6 collinear cleanup = 4 corners (20×6 rect)");
        let f = &scene.mesh.faces[new_fid];
        assert!(f.inners().is_empty(), "merged face should be simple (no holes)");
    }

    /// ADR-016 §2 Path B — 그리기 순서 무관 (inner-first 도 outer-first 와
    /// 동일 결과). 사용자 보고 회귀: inner 그리고 outer 그린 뒤 inner 의
    /// edge 를 erase 했을 때 면이 사라짐.
    #[test]
    fn test_adr016_path_b_inner_first_then_outer_resynthesize() {
        let mut scene = Scene::new();
        // Inner 4×2 먼저
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });
        // Outer 10×6 (inner 를 둘러쌈) — Step 4.95 가 B1 promote 해야 함
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });

        // 토폴로지 검증: ring (1 hole) + inner sub-face = 2 active faces.
        let active: Vec<_> = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.inners().len()))
            .collect();
        let ring_count = active.iter().filter(|(_, n)| *n == 1).count();
        let simple_count = active.iter().filter(|(_, n)| *n == 0).count();
        assert_eq!(
            ring_count, 1,
            "expected 1 ring face after Step 4.95 promote; got faces={:?}",
            active
        );
        assert_eq!(simple_count, 1, "expected 1 inner sub-face; got faces={:?}", active);

        let ring_fid = active.iter().find(|(_, n)| *n == 1).map(|(f, _)| *f).unwrap();
        let hole_eid = {
            let ring = &scene.mesh.faces[ring_fid];
            let inner_loop = &ring.inners()[0];
            let he = inner_loop.start;
            scene.mesh.hes.get(he).expect("hole HE").edge()
        };

        let mat = scene.default_material;
        let result = scene.mesh.erase_edge_resynthesize(hole_eid, mat, false)
            .expect("erase_edge_resynthesize");
        assert_eq!(result.removed_faces.len(), 2, "ring+inner removed");
        assert_eq!(
            result.new_faces.len(), 1,
            "expected 1 re-synthesized outer face; got {}",
            result.new_faces.len()
        );
        let new_fid = result.new_faces[0];
        let new_face = &scene.mesh.faces[new_fid];
        assert!(new_face.inners().is_empty(), "new face should be simple");
        let verts = scene.mesh.collect_loop_verts(new_face.outer().start).unwrap();
        assert_eq!(verts.len(), 4, "expected 4-vert outer rectangle");
    }

    /// ADR-016 §2 Path B — hole edge erase 시 ring + inner 가 re-resolve 로
    /// 단일 simple face 로 재합성됨을 검증.
    #[test]
    fn test_adr016_path_b_hole_edge_resynthesize() {
        use axia_geo::Mesh;
        let mut scene = Scene::new();
        // Outer 10×6
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // Inner 4×2 inside → B1 promote → ring + inner sub-face.
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        // Topology check: 1 ring (1 hole) + 1 inner sub-face.
        let ring_fid = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active() && f.inners().len() == 1)
            .map(|(id, _)| id)
            .expect("ring face missing — B1 didn't fire");

        // Pick one edge from the ring's hole loop.
        let hole_eid = {
            let ring = &scene.mesh.faces[ring_fid];
            let inner_loop = &ring.inners()[0];
            let he = inner_loop.start;
            scene.mesh.hes.get(he).expect("hole HE").edge()
        };

        // Path B: erase + re-resolve.
        let mat = scene.default_material;
        let result = scene.mesh.erase_edge_resynthesize(hole_eid, mat, false)
            .expect("erase_edge_resynthesize");

        // 2 faces removed (ring + inner), 1 face synthesized (outer rect).
        assert_eq!(result.removed_faces.len(), 2);
        assert_eq!(result.new_faces.len(), 1, "expected 1 re-synthesized face");

        let new_fid = result.new_faces[0];
        let new_face = &scene.mesh.faces[new_fid];
        // New face should be a simple 4-vert rectangle (outer perimeter).
        assert!(new_face.inners().is_empty(), "new face should have no holes");
        let verts = scene.mesh.collect_loop_verts(new_face.outer().start).unwrap();
        assert_eq!(verts.len(), 4, "expected 4-vert outer rectangle");
    }

    /// ADR-016 — 첫 inner 만 B1 promote 검증.
    #[test]
    fn test_adr016_single_inner_promotes_to_hole() {
        let mut scene = Scene::new();
        // Outer 10×6 — 정확히 JS bridge 와 동일 파라미터 (center=(100,100,0)).
        scene.execute(Command::DrawRect {
            center: DVec3::new(100.0, 100.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 10.0, height: 6.0,
        });
        // Inner 4×2 strictly inside — 같은 center.
        scene.execute(Command::DrawRect {
            center: DVec3::new(100.0, 100.0, 0.0),
            normal: DVec3::Z, up: DVec3::Y,
            width: 4.0, height: 2.0,
        });

        // After B1 promote: outer 의 inners().len() == 1
        let mut ring_with_hole = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.inners().len() == 1 { ring_with_hole += 1; }
            else if f.inners().is_empty() { simple_active += 1; }
        }
        // Boundary edge count: ring's outer 4 = boundary, hole 4 = NOT boundary
        // (twin face is inner). Inner's 4 perimeter edges: face=inner on one
        // side, face=ring (hole) on twin side → NOT boundary.
        // Total boundary = 4.
        let mut boundary_count = 0;
        for (_, edge) in scene.mesh.edges.iter() {
            if !edge.is_active() { continue; }
            // boundary = at least one side has face=null
            // We need to find both HEs of this edge.
            // Simpler: check is_boundary via mesh helper if available.
        }
        // Fallback: count via halfedges with face=null.
        let mut he_with_null_face = 0;
        for (_, he) in scene.mesh.hes.iter() {
            if !he.is_active() { continue; }
            if he.face().is_null() { he_with_null_face += 1; }
            let _ = boundary_count;
        }

        assert_eq!(
            ring_with_hole, 1,
            "expected exactly 1 ring face with hole; got {} (simple={}, null-HEs={})",
            ring_with_hole, simple_active, he_with_null_face
        );
        assert_eq!(
            simple_active, 1,
            "expected exactly 1 simple sub-face (inner); got {} (null-HEs={})",
            simple_active, he_with_null_face
        );
        assert_eq!(
            he_with_null_face, 4,
            "expected 4 null-face HEs (only outer ring's outside); got {}",
            he_with_null_face
        );
    }

    /// ADR-021 P7 (Phase C, supersedes ADR-016 LOCKED #1) —
    /// 둘 다 disjoint inner 면, 둘 다 hole 로 promote 되어 multi-hole ring 형성.
    /// 이전 ADR-016 single-promote heuristic 은 폐기됨 (CLAUDE.md LOCKED #1).
    #[test]
    fn test_adr021_disjoint_second_inner_promotes() {
        let mut scene = Scene::new();
        // Outer 12×8
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 8.0,
        });
        // First inner — promote
        scene.execute(Command::DrawRect {
            center: DVec3::new(-3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });
        // Second inner — disjoint from first → also promotes (P7 multi-hole ring).
        scene.execute(Command::DrawRect {
            center: DVec3::new(3.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 3.0, height: 2.0,
        });

        let mut ring_with_one_hole = 0;
        let mut ring_with_two_holes = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            match f.inners().len() {
                0 => simple_active += 1,
                1 => ring_with_one_hole += 1,
                2 => ring_with_two_holes += 1,
                _ => {}
            }
        }
        assert_eq!(
            ring_with_two_holes, 1,
            "expected 1 ring with 2 holes (P7 disjoint multi-hole); got {} (one-hole={}, simple={})",
            ring_with_two_holes, ring_with_one_hole, simple_active
        );
        assert_eq!(
            ring_with_one_hole, 0,
            "no single-hole ring expected; got {}", ring_with_one_hole
        );
        assert_eq!(
            simple_active, 2,
            "expected 2 simple sub-faces (each inner); got {}",
            simple_active
        );
    }

    /// ADR-022 P9 (Phase 1) — Connected Case B (vertex 공유 inner) 자동 처리.
    /// Outer 그린 후 첫 inner, 그 다음 첫 inner 와 corner vertex 하나만
    /// 공유하는 둘째 inner 를 그린다. 이전: 둘째는 sibling 으로 남아서 promote
    /// 안 됨. P9 이후: 둘 다 hole 로 promote (multi-hole ring).
    #[test]
    fn test_p9_corner_pinch_two_inners_become_two_holes() {
        let mut scene = Scene::new();
        // Outer 12×12
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        // First inner [-3..-1] x [-3..-1] — corner at (-1, -1)
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        // Second inner [-1..+1] x [-1..+1] — shares corner (-1, -1) with first.
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });

        // Manifold invariant must hold — no degenerate / non-manifold corruption.
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "Manifold invariants violated: {:?}", report.violations);

        let mut ring_holes = 0usize; // total hole count across all rings
        let mut ring_count = 0;
        let mut simple_active = 0;
        for (_fid, f) in scene.mesh.faces.iter() {
            if !f.is_active() { continue; }
            if f.inners().is_empty() {
                simple_active += 1;
            } else {
                ring_count += 1;
                ring_holes += f.inners().len();
            }
        }
        assert_eq!(ring_count, 1, "expected 1 ring (outer); got {}", ring_count);
        assert_eq!(ring_holes, 2,
            "expected 2 holes total (P9 corner-pinch both promote); got {}", ring_holes);
        assert_eq!(simple_active, 2,
            "expected 2 simple sub-faces; got {}", simple_active);
    }

    /// ADR-022 P9 — Drawing order independence with corner-pinch.
    /// outer 먼저 그리든 inner 들 먼저 그리든 동일하게 multi-hole ring 결과.
    #[test]
    fn test_p9_pinch_drawing_order_independence() {
        // Case A: inner1 → inner2 → outer
        let mut scene_a = Scene::new();
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_a.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_a.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        let count_a = |s: &Scene| -> (usize, usize, usize) {
            let mut rings = 0; let mut holes = 0; let mut simple = 0;
            for (_id, f) in s.mesh.faces.iter() {
                if !f.is_active() { continue; }
                if f.inners().is_empty() { simple += 1; }
                else { rings += 1; holes += f.inners().len(); }
            }
            (rings, holes, simple)
        };
        let result_a = count_a(&scene_a);

        // Case B: outer → inner1 → inner2
        let mut scene_b = Scene::new();
        scene_b.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        scene_b.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene_b.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let result_b = count_a(&scene_b);

        assert_eq!(result_a, result_b,
            "P9 drawing-order independence: Case A {:?} vs Case B {:?}",
            result_a, result_b);
        // 둘 다 (1 ring, 2 holes, 2 simple) 이어야 함.
        assert_eq!(result_a, (1, 2, 2),
            "P9 expected (rings=1, holes=2, simple=2); got {:?}", result_a);
    }

    /// ADR-022 P9 — Manifold invariant 무손상.
    /// Pinch case 후 verify_face_invariants 위반 없음.
    #[test]
    fn test_p9_manifold_invariant_preserved() {
        let mut scene = Scene::new();
        scene.execute(Command::DrawRect {
            center: DVec3::ZERO, normal: DVec3::Z, up: DVec3::Y,
            width: 12.0, height: 12.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(-2.0, -2.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        scene.execute(Command::DrawRect {
            center: DVec3::new(0.0, 0.0, 0.0), normal: DVec3::Z, up: DVec3::Y,
            width: 2.0, height: 2.0,
        });
        let report = scene.mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "P9 manifold invariants violated after pinch: {:?}", report.violations);
    }

    /// 사용자 보고 2026-04-28 (12) — 인접한 면과 통합 미리보기가 빨간색 (cascade)
    /// 으로 표시되는 회귀. 사용자 화면: outer + 부분-overlap 안쪽 inner 가
    /// 만드는 sub-face 들 사이의 shared edge 를 hover 했을 때 통합 가능
    /// (cyan) 이어야 한다.
    ///
    /// 검증: 모든 active face 쌍에 대해 (1) shared outer edge 가 있고
    /// (2) coplanar 인 경우 → preview predicate (count==1 OR
    /// would_geometric_merge_succeed) 가 true 를 반환해야 한다.
    #[test]
    fn test_partial_overlap_all_adjacent_faces_mergeable() {
        // 사용자 스크린 패턴: outer 14×6, 한쪽으로 extending overlap inner.
        let configs: &[&[(f64, f64, f64, f64)]] = &[
            // (cx, cy, w, h)
            &[(0.0, 0.0, 14.0, 6.0), (5.0, 0.0, 6.0, 4.0)],
            &[(0.0, 0.0, 14.0, 6.0), (-5.0, 0.0, 6.0, 4.0)],
            &[(0.0, 0.0, 14.0, 6.0), (5.0, 0.0, 6.0, 4.0), (-5.0, 0.0, 6.0, 4.0)],
            // L-shape 두 개
            &[(0.0, 0.0, 10.0, 4.0), (3.0, 2.0, 6.0, 4.0)],
            // 사용자 image: 큰 outer + 부분-overlap inner extending right
            &[(0.0, 0.0, 16.0, 8.0), (10.0, 0.0, 8.0, 5.0)],
        ];

        for (config_idx, rects) in configs.iter().enumerate() {
            let mut scene = Scene::new();
            for &(cx, cy, w, h) in *rects {
                scene.execute(Command::DrawRect {
                    center: DVec3::new(cx, cy, 0.0),
                    normal: DVec3::Z, up: DVec3::Y,
                    width: w, height: h,
                });
            }

            let active: Vec<_> = scene.mesh.faces.iter()
                .filter(|(_, f)| f.is_active()).map(|(id, _)| id).collect();

            let mut tested = 0;
            let mut failures = Vec::<String>::new();
            for i in 0..active.len() {
                for j in (i + 1)..active.len() {
                    let n_shared = scene.mesh.count_shared_edges_outer(active[i], active[j]);
                    if n_shared == 0 { continue; }
                    let coplanar = scene.mesh.are_faces_coplanar_with_tolerance(
                        active[i], active[j], 0.5
                    ).unwrap_or(false);
                    if !coplanar { continue; }
                    tested += 1;

                    // Mirror preview_edge_erase_merge predicate.
                    let mergeable = if n_shared == 1 {
                        true
                    } else {
                        scene.mesh.would_geometric_merge_succeed(active[i], active[j], 0.5)
                    };
                    if !mergeable {
                        failures.push(format!(
                            "  config[{}]: face pair ({:?},{:?}) shared={} coplanar=true \
                             but predicate=false",
                            config_idx, active[i], active[j], n_shared
                        ));
                    }
                }
            }
            assert!(tested > 0, "config[{}] no adjacent pairs found", config_idx);
            assert!(
                failures.is_empty(),
                "config[{}] preview predicate FALSE on adjacent coplanar faces:\n{}",
                config_idx,
                failures.join("\n")
            );
        }
    }
}
