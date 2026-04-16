//! Group / Component System
//!
//! SketchUp 스타일의 Group과 Component를 구현합니다.
//!
//! - **Group**: face들의 논리적 묶음. 격리된 편집 컨텍스트를 제공합니다.
//!   그룹 내부의 geometry는 외부와 독립적으로 관리됩니다.
//!
//! - **Component**: 재사용 가능한 Group. 하나의 ComponentDef(정의)를
//!   여러 ComponentInstance가 참조하며, 정의를 수정하면 모든 인스턴스에 반영됩니다.
//!
//! ## 계층 구조
//! ```text
//! Scene
//!  ├─ Group "벽체"
//!  │   ├─ Face 3, 4, 5
//!  │   └─ Group "창문" (중첩)
//!  │       └─ Face 10, 11
//!  ├─ ComponentInstance "문 #1" → ComponentDef "문"
//!  └─ ComponentInstance "문 #2" → ComponentDef "문"
//! ```

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use glam::DVec3;
use axia_geo::FaceId;

// ════════════════════════════════════════════════════════════════
// ID 타입
// ════════════════════════════════════════════════════════════════

/// 그룹 고유 식별자
pub type GroupId = u32;

/// 컴포넌트 정의 고유 식별자
pub type ComponentDefId = u32;

/// 컴포넌트 인스턴스 고유 식별자
pub type ComponentInstanceId = u32;

// ════════════════════════════════════════════════════════════════
// Transform3D
// ════════════════════════════════════════════════════════════════

/// 3D 변환 (위치 + 회전 + 스케일)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transform3D {
    pub position: DVec3,
    /// 오일러 각도 (라디안, XYZ 순서)
    pub rotation: DVec3,
    pub scale: DVec3,
}

impl Default for Transform3D {
    fn default() -> Self {
        Self {
            position: DVec3::ZERO,
            rotation: DVec3::ZERO,
            scale: DVec3::ONE,
        }
    }
}

impl Transform3D {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_position(mut self, pos: DVec3) -> Self {
        self.position = pos;
        self
    }

    /// 변환이 항등 변환인지 확인
    pub fn is_identity(&self) -> bool {
        self.position.length_squared() < 1e-10
            && self.rotation.length_squared() < 1e-10
            && (self.scale - DVec3::ONE).length_squared() < 1e-10
    }
}

// ════════════════════════════════════════════════════════════════
// Group
// ════════════════════════════════════════════════════════════════

/// 면들의 논리적 그룹.
/// 스케치업의 "Group" 개념과 동일 — 격리된 편집 컨텍스트.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: GroupId,
    pub name: String,
    /// 이 그룹에 속하는 face ID 목록
    pub face_ids: Vec<FaceId>,
    /// 그룹의 로컬 변환
    pub transform: Transform3D,
    /// 상위 그룹 (None이면 Scene 루트)
    pub parent: Option<GroupId>,
    /// 자식 그룹 ID 목록 (중첩 그룹)
    pub children: Vec<GroupId>,
    /// 이 그룹이 ComponentDef를 참조하면 Some
    pub component_def_id: Option<ComponentDefId>,
    /// 가시성
    pub visible: bool,
    /// 잠금 상태 (잠금 시 편집 불가)
    pub locked: bool,
}

impl Group {
    pub fn new(id: GroupId, name: String, face_ids: Vec<FaceId>) -> Self {
        Self {
            id,
            name,
            face_ids,
            transform: Transform3D::default(),
            parent: None,
            children: Vec::new(),
            component_def_id: None,
            visible: true,
            locked: false,
        }
    }

    /// face가 이 그룹에 속하는지 확인
    pub fn contains_face(&self, face_id: FaceId) -> bool {
        self.face_ids.contains(&face_id)
    }

    /// 총 face 수 (자식 그룹 제외)
    pub fn face_count(&self) -> usize {
        self.face_ids.len()
    }
}

// ════════════════════════════════════════════════════════════════
// ComponentDef (컴포넌트 정의)
// ════════════════════════════════════════════════════════════════

/// 재사용 가능한 컴포넌트 정의.
/// 하나의 "원형"을 여러 인스턴스가 공유합니다.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ComponentDef {
    pub id: ComponentDefId,
    pub name: String,
    /// 원형 face IDs (이 face들이 geometry의 "원본")
    pub face_ids: Vec<FaceId>,
    /// 삽입 기준점 (인스턴스 배치 시 기준)
    pub origin: DVec3,
    /// 설명
    pub description: String,
    /// 이 정의를 참조하는 인스턴스 수
    pub instance_count: u32,
}

impl ComponentDef {
    pub fn new(id: ComponentDefId, name: String, face_ids: Vec<FaceId>) -> Self {
        Self {
            id,
            name,
            face_ids,
            origin: DVec3::ZERO,
            description: String::new(),
            instance_count: 0,
        }
    }
}

// ════════════════════════════════════════════════════════════════
// ComponentInstance (컴포넌트 인스턴스)
// ════════════════════════════════════════════════════════════════

/// 컴포넌트 정의의 배치된 인스턴스.
/// 변환만 다르고 geometry는 ComponentDef를 참조합니다.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ComponentInstance {
    pub id: ComponentInstanceId,
    pub def_id: ComponentDefId,
    pub name: String,
    /// 이 인스턴스의 실제 face IDs (원형에서 복제됨)
    pub face_ids: Vec<FaceId>,
    /// 인스턴스 변환 (월드 공간)
    pub transform: Transform3D,
    pub visible: bool,
    pub locked: bool,
}

impl ComponentInstance {
    pub fn new(
        id: ComponentInstanceId,
        def_id: ComponentDefId,
        name: String,
        face_ids: Vec<FaceId>,
    ) -> Self {
        Self {
            id,
            def_id,
            name,
            face_ids,
            transform: Transform3D::default(),
            visible: true,
            locked: false,
        }
    }
}

// ════════════════════════════════════════════════════════════════
// GroupManager — Scene에 내장될 그룹/컴포넌트 관리자
// ════════════════════════════════════════════════════════════════

/// 그룹과 컴포넌트를 관리하는 중앙 매니저.
/// Scene에 포함되어 사용됩니다.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GroupManager {
    pub groups: HashMap<GroupId, Group>,
    pub component_defs: HashMap<ComponentDefId, ComponentDef>,
    pub component_instances: HashMap<ComponentInstanceId, ComponentInstance>,

    next_group_id: u32,
    next_def_id: u32,
    next_instance_id: u32,

    /// face → group 역인덱스 (빠른 조회)
    #[serde(skip)]
    face_to_group: HashMap<u32, GroupId>,
}

impl GroupManager {
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
            component_defs: HashMap::new(),
            component_instances: HashMap::new(),
            next_group_id: 1,
            next_def_id: 1,
            next_instance_id: 1,
            face_to_group: HashMap::new(),
        }
    }

    // ────── 역인덱스 재구축 ──────

    /// serde 역직렬화 후 역인덱스 재구축
    pub fn rebuild_index(&mut self) {
        self.face_to_group.clear();
        for (gid, group) in &self.groups {
            for &fid in &group.face_ids {
                self.face_to_group.insert(fid.raw(), *gid);
            }
        }
    }

    // ────── Group CRUD ──────

    /// 새 그룹 생성. face_ids를 그룹에 할당.
    pub fn create_group(&mut self, name: String, face_ids: Vec<FaceId>) -> GroupId {
        let id = self.next_group_id;
        self.next_group_id = self.next_group_id.saturating_add(1);

        // 기존 그룹에서 이 face들 제거
        for &fid in &face_ids {
            if let Some(old_gid) = self.face_to_group.remove(&fid.raw()) {
                if let Some(old_group) = self.groups.get_mut(&old_gid) {
                    old_group.face_ids.retain(|&f| f != fid);
                }
            }
        }

        let group = Group::new(id, name, face_ids.clone());

        // 역인덱스 갱신
        for &fid in &face_ids {
            self.face_to_group.insert(fid.raw(), id);
        }

        self.groups.insert(id, group);
        id
    }

    /// 그룹 삭제 (자식 그룹은 부모의 부모로 승격)
    pub fn delete_group(&mut self, group_id: GroupId) -> bool {
        let group = match self.groups.remove(&group_id) {
            Some(g) => g,
            None => return false,
        };

        // 역인덱스에서 제거
        for &fid in &group.face_ids {
            self.face_to_group.remove(&fid.raw());
        }

        // 자식 그룹의 parent를 삭제된 그룹의 parent로 변경
        for &child_id in &group.children {
            if let Some(child) = self.groups.get_mut(&child_id) {
                child.parent = group.parent;
            }
        }

        // 부모 그룹의 children에서 이 그룹 제거, 자식들 추가
        if let Some(parent_id) = group.parent {
            if let Some(parent) = self.groups.get_mut(&parent_id) {
                parent.children.retain(|&c| c != group_id);
                parent.children.extend(group.children.iter());
            }
        }

        true
    }

    /// 그룹에 face 추가
    pub fn add_faces_to_group(&mut self, group_id: GroupId, face_ids: &[FaceId]) -> bool {
        if !self.groups.contains_key(&group_id) {
            return false;
        }

        for &fid in face_ids {
            // 다른 그룹에서 제거
            if let Some(old_gid) = self.face_to_group.remove(&fid.raw()) {
                if old_gid != group_id {
                    if let Some(old_group) = self.groups.get_mut(&old_gid) {
                        old_group.face_ids.retain(|&f| f != fid);
                    }
                }
            }
            // 현재 그룹에 추가 (중복 방지)
            if let Some(group) = self.groups.get_mut(&group_id) {
                if !group.face_ids.contains(&fid) {
                    group.face_ids.push(fid);
                }
            }
            self.face_to_group.insert(fid.raw(), group_id);
        }

        true
    }

    /// 그룹에서 face 제거
    pub fn remove_faces_from_group(&mut self, group_id: GroupId, face_ids: &[FaceId]) -> bool {
        let group = match self.groups.get_mut(&group_id) {
            Some(g) => g,
            None => return false,
        };

        for &fid in face_ids {
            group.face_ids.retain(|&f| f != fid);
            if self.face_to_group.get(&fid.raw()) == Some(&group_id) {
                self.face_to_group.remove(&fid.raw());
            }
        }

        true
    }

    /// face가 속한 그룹 ID 조회
    pub fn get_group_for_face(&self, face_id: FaceId) -> Option<GroupId> {
        self.face_to_group.get(&face_id.raw()).copied()
    }

    /// 그룹의 모든 face ID 반환 (자식 그룹 포함 재귀)
    pub fn get_all_faces_recursive(&self, group_id: GroupId) -> Vec<FaceId> {
        let mut result = Vec::new();
        self.collect_faces_recursive(group_id, &mut result);
        result
    }

    fn collect_faces_recursive(&self, group_id: GroupId, out: &mut Vec<FaceId>) {
        if let Some(group) = self.groups.get(&group_id) {
            out.extend(group.face_ids.iter());
            for &child_id in &group.children {
                self.collect_faces_recursive(child_id, out);
            }
        }
    }

    /// 중첩 그룹 설정 (child를 parent의 자식으로)
    pub fn set_parent(&mut self, child_id: GroupId, parent_id: Option<GroupId>) -> bool {
        // 순환 참조 검사
        if let Some(pid) = parent_id {
            if pid == child_id { return false; }
            // parent_id의 조상 중 child_id가 있으면 순환
            let mut current = Some(pid);
            while let Some(cid) = current {
                if cid == child_id { return false; }
                current = self.groups.get(&cid).and_then(|g| g.parent);
            }
        }

        // 기존 부모에서 제거
        let old_parent = self.groups.get(&child_id).and_then(|g| g.parent);
        if let Some(old_pid) = old_parent {
            if let Some(old_p) = self.groups.get_mut(&old_pid) {
                old_p.children.retain(|&c| c != child_id);
            }
        }

        // 새 부모에 추가
        if let Some(new_pid) = parent_id {
            if let Some(new_p) = self.groups.get_mut(&new_pid) {
                if !new_p.children.contains(&child_id) {
                    new_p.children.push(child_id);
                }
            }
        }

        // 자식의 parent 갱신
        if let Some(child) = self.groups.get_mut(&child_id) {
            child.parent = parent_id;
        }

        true
    }

    // ────── Component CRUD ──────

    /// 그룹을 컴포넌트로 변환
    pub fn make_component(&mut self, group_id: GroupId, name: String) -> Option<ComponentDefId> {
        let group = self.groups.get_mut(&group_id)?;

        let def_id = self.next_def_id;
        self.next_def_id = self.next_def_id.saturating_add(1);

        let def = ComponentDef::new(def_id, name, group.face_ids.clone());
        self.component_defs.insert(def_id, def);

        // 그룹을 컴포넌트 참조로 전환
        group.component_def_id = Some(def_id);

        Some(def_id)
    }

    /// 컴포넌트 인스턴스 생성
    pub fn create_instance(
        &mut self,
        def_id: ComponentDefId,
        name: String,
        face_ids: Vec<FaceId>,
        transform: Transform3D,
    ) -> Option<ComponentInstanceId> {
        let def = self.component_defs.get_mut(&def_id)?;
        def.instance_count += 1;

        let inst_id = self.next_instance_id;
        self.next_instance_id = self.next_instance_id.saturating_add(1);

        let mut inst = ComponentInstance::new(inst_id, def_id, name, face_ids);
        inst.transform = transform;
        self.component_instances.insert(inst_id, inst);

        Some(inst_id)
    }

    /// 컴포넌트 인스턴스 삭제
    pub fn delete_instance(&mut self, instance_id: ComponentInstanceId) -> bool {
        let inst = match self.component_instances.remove(&instance_id) {
            Some(i) => i,
            None => return false,
        };

        if let Some(def) = self.component_defs.get_mut(&inst.def_id) {
            def.instance_count = def.instance_count.saturating_sub(1);
        }

        true
    }

    // ────── 쿼리 ──────

    /// 모든 루트 레벨 그룹 ID (parent가 None인 것들)
    pub fn root_groups(&self) -> Vec<GroupId> {
        self.groups.values()
            .filter(|g| g.parent.is_none())
            .map(|g| g.id)
            .collect()
    }

    /// 그룹 수
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }

    /// 컴포넌트 정의 수
    pub fn component_def_count(&self) -> usize {
        self.component_defs.len()
    }

    /// 컴포넌트 인스턴스 수
    pub fn component_instance_count(&self) -> usize {
        self.component_instances.len()
    }

    /// 그룹 정보를 JSON 문자열로 내보내기
    pub fn export_group_info(&self, group_id: GroupId) -> Option<String> {
        let group = self.groups.get(&group_id)?;
        let face_ids: Vec<u32> = group.face_ids.iter().map(|f| f.raw()).collect();
        let children: Vec<u32> = group.children.clone();

        Some(format!(
            r#"{{"id":{},"name":"{}","faceIds":{:?},"children":{:?},"visible":{},"locked":{},"parent":{},"isComponent":{}}}"#,
            group.id,
            group.name.replace('"', "'"),
            face_ids,
            children,
            group.visible,
            group.locked,
            group.parent.map(|p| p.to_string()).unwrap_or("null".to_string()),
            group.component_def_id.is_some(),
        ))
    }

    /// 전체 그룹 트리를 JSON으로 내보내기
    pub fn export_all_groups_json(&self) -> String {
        let mut items = Vec::new();
        for (_, group) in &self.groups {
            let face_ids: Vec<u32> = group.face_ids.iter().map(|f| f.raw()).collect();
            items.push(format!(
                r#"{{"id":{},"name":"{}","faceCount":{},"faceIds":{:?},"parent":{},"children":{:?},"visible":{},"locked":{},"isComponent":{}}}"#,
                group.id,
                group.name.replace('"', "'"),
                group.face_ids.len(),
                face_ids,
                group.parent.map(|p| p.to_string()).unwrap_or("null".to_string()),
                group.children,
                group.visible,
                group.locked,
                group.component_def_id.is_some(),
            ));
        }
        format!("[{}]", items.join(","))
    }
}

impl Default for GroupManager {
    fn default() -> Self {
        Self::new()
    }
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn fid(n: u32) -> FaceId { FaceId::new(n) }

    #[test]
    fn test_create_group() {
        let mut mgr = GroupManager::new();
        let gid = mgr.create_group("Box".into(), vec![fid(1), fid(2), fid(3)]);
        assert_eq!(mgr.group_count(), 1);
        assert_eq!(mgr.groups[&gid].face_ids.len(), 3);
        assert_eq!(mgr.get_group_for_face(fid(1)), Some(gid));
        assert_eq!(mgr.get_group_for_face(fid(99)), None);
    }

    #[test]
    fn test_delete_group() {
        let mut mgr = GroupManager::new();
        let gid = mgr.create_group("Box".into(), vec![fid(1), fid(2)]);
        assert!(mgr.delete_group(gid));
        assert_eq!(mgr.group_count(), 0);
        assert_eq!(mgr.get_group_for_face(fid(1)), None);
    }

    #[test]
    fn test_nested_groups() {
        let mut mgr = GroupManager::new();
        let parent = mgr.create_group("Parent".into(), vec![fid(1)]);
        let child = mgr.create_group("Child".into(), vec![fid(2)]);
        assert!(mgr.set_parent(child, Some(parent)));

        assert_eq!(mgr.groups[&parent].children, vec![child]);
        assert_eq!(mgr.groups[&child].parent, Some(parent));

        // 재귀적으로 face 수집
        let all = mgr.get_all_faces_recursive(parent);
        assert!(all.contains(&fid(1)));
        assert!(all.contains(&fid(2)));
    }

    #[test]
    fn test_cycle_prevention() {
        let mut mgr = GroupManager::new();
        let a = mgr.create_group("A".into(), vec![fid(1)]);
        let b = mgr.create_group("B".into(), vec![fid(2)]);
        mgr.set_parent(b, Some(a));
        // B는 A의 자식. A를 B의 자식으로 만들면 순환 → 거부
        assert!(!mgr.set_parent(a, Some(b)));
    }

    #[test]
    fn test_face_move_between_groups() {
        let mut mgr = GroupManager::new();
        let g1 = mgr.create_group("G1".into(), vec![fid(1), fid(2)]);
        let g2 = mgr.create_group("G2".into(), vec![fid(3)]);

        // face 1을 g2로 이동
        mgr.add_faces_to_group(g2, &[fid(1)]);
        assert_eq!(mgr.get_group_for_face(fid(1)), Some(g2));
        assert!(!mgr.groups[&g1].face_ids.contains(&fid(1)));
        assert!(mgr.groups[&g2].face_ids.contains(&fid(1)));
    }

    #[test]
    fn test_make_component() {
        let mut mgr = GroupManager::new();
        let gid = mgr.create_group("Door".into(), vec![fid(1), fid(2)]);
        let def_id = mgr.make_component(gid, "Door".into()).unwrap();
        assert_eq!(mgr.component_def_count(), 1);
        assert_eq!(mgr.groups[&gid].component_def_id, Some(def_id));
    }

    #[test]
    fn test_create_instance() {
        let mut mgr = GroupManager::new();
        let gid = mgr.create_group("Door".into(), vec![fid(1)]);
        let def_id = mgr.make_component(gid, "Door".into()).unwrap();

        let inst_id = mgr.create_instance(
            def_id, "Door #2".into(), vec![fid(10), fid(11)],
            Transform3D::new().with_position(DVec3::new(100.0, 0.0, 0.0)),
        ).unwrap();

        assert_eq!(mgr.component_instance_count(), 1);
        assert_eq!(mgr.component_defs[&def_id].instance_count, 1);
        assert_eq!(mgr.component_instances[&inst_id].def_id, def_id);
    }

    #[test]
    fn test_json_export() {
        let mut mgr = GroupManager::new();
        mgr.create_group("TestGroup".into(), vec![fid(1), fid(2)]);
        let json = mgr.export_all_groups_json();
        assert!(json.contains("TestGroup"));
        assert!(json.contains("faceCount"));
    }
}
