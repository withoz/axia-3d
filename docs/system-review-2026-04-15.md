# AXiA 3D - 시스템 개념 및 로직 검토 보고서

**작성일**: 2026-04-15  
**버전**: dce2a52 (S1+S2 XIA 승격 완료)  
**테스트**: 51 suites, 842 tests (전체 통과)

---

## 1. 시스템 개요

AXiA 3D는 "블렌더보다 쉽고, 스케치업보다 정확한" 웹 기반 3D 모델링 플랫폼이다. Rust WASM 기하 엔진 + Three.js 뷰포트 + TypeScript UI로 구성된다.

### 1.1 기술 스택

| 계층 | 기술 | 역할 |
|------|------|------|
| 기하 커널 | Rust (axia-geo) | DCEL Half-Edge 메시, Push/Pull, Boolean |
| 씬 관리 | Rust (axia-core) | XIA 엔티티, Group, Material, Undo/Redo |
| WASM 바인딩 | Rust (axia-wasm) + wasm-pack | 타입 안전 브리지 |
| 프론트엔드 | TypeScript + Three.js 0.170 + Vite | 뷰포트, UI, 도구 |

### 1.2 빌드 구조

```
crates/
  axia-geo/          기하 커널 (Mesh, DCEL, Vertex/Edge/Face)
  axia-core/         씬 엔진 (Scene, XIA, Group, Command, Material)
  axia-transaction/  Undo/Redo 트랜잭션 매니저
  axia-wasm/         WASM 바인딩 (AxiaEngine)

web/src/
  bridge/            WasmBridge (JS↔WASM 통신)
  tools/             도구 시스템 (15개 도구)
  viewport/          Three.js 렌더링
  ui/                UI 컴포넌트
  primitives/        프리미티브 도구 (Sphere, Cone, Cylinder)
  snap/              스냅 시스템
  materials/         재질 라이브러리
  export/            내보내기 (DXF, OBJ, GLTF, STL)
  import/            가져오기 (DXF, DWG, SKP, OBJ 등)
  file/              파일 관리 (.axia 저장/로드)
```

---

## 2. 데이터 모델 — 4계층 아키텍처

### 2.1 계층 구조도

```
┌─────────────────────────────────────────────────────────┐
│                      Scene (씬)                          │
│                                                          │
│  ┌────────────────────┐                                  │
│  │ Mesh (DCEL)        │  단일 메시 — 모든 기하의 저장소  │
│  │ ──────────────     │                                  │
│  │ vertices: SlotStorage<VertexId, Vertex>               │
│  │ edges:    SlotStorage<EdgeId, Edge>                   │
│  │ halfedges:SlotStorage<HalfEdgeId, HalfEdge>           │
│  │ faces:    SlotStorage<FaceId, Face>                   │
│  │ shells:   SlotStorage<ShellId, Shell>                 │
│  │ spatial_hash: SpatialHash (O(1) 정점 병합)            │
│  └─────────┬──────────┘                                  │
│            │ FaceId 참조                                  │
│     ┌──────┴──────┬───────────────┐                      │
│     ▼             ▼               ▼                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐           │
│  │ XIAs     │  │ Groups   │  │ face_to_xia  │           │
│  │ ────     │  │ ──────   │  │ ──────────── │           │
│  │ HashMap  │  │ HashMap  │  │ HashMap      │           │
│  │ <XiaId,  │  │ <GroupId,│  │ <FaceId,     │           │
│  │  Xia>    │  │  Group>  │  │  XiaId>      │           │
│  └──────────┘  └──────────┘  └──────────────┘           │
│                                                          │
│  next_xia_id: u64          (XIA ID 카운터)               │
│  transactions: TransactionManager (Undo/Redo)            │
│  material_library: MaterialLibrary (재질 DB)             │
│  default_material: MaterialId                            │
└─────────────────────────────────────────────────────────┘
```

### 2.2 각 계층의 역할

#### Mesh (기하 커널)

| 항목 | 설명 |
|------|------|
| 정의 | `crates/axia-geo/src/mesh.rs` |
| 구조 | DCEL (Doubly-Connected Edge List) Half-Edge |
| 저장 | SlotStorage<K,V> — FxHashMap 기반, 자동 ID 할당 |
| Face 속성 | material_id, visible, active, normal, flags |
| 연산 | draw_line, draw_rectangle, draw_circle, push_pull, add_face, remove_face |
| 특징 | Spatial Hash로 O(1) 정점 병합, 1e-6 허용 오차 |

#### XIA (모델링 엔티티)

| 항목 | 설명 |
|------|------|
| 정의 | `crates/axia-core/src/xia.rs` (131줄) |
| ID | `XiaId = u64`, Scene 내 유일 |
| 핵심 필드 | id, state, name, position, surface_normal, material, face_ids, visible |
| 면 참조 | `face_ids: Vec<FaceId>` — 메시 면을 참조 (소유가 아닌 참조) |
| 역인덱스 | `face_to_xia: HashMap<FaceId, XiaId>` — O(1) 역방향 조회 |
| 직렬화 | face_ids 포함 (S1에서 #[serde(skip)] 제거됨) |

#### Group (논리 그룹)

| 항목 | 설명 |
|------|------|
| 정의 | `crates/axia-core/src/group.rs` |
| 구조 | face_ids, parent/children 트리, visible, locked |
| 기능 | 가시성 재귀 전파, 잠금, 컴포넌트 변환 |
| 역인덱스 | `face_to_group` — `#[serde(skip)]` (복원 시 재구축 필요) |

#### Component (재사용 컴포넌트)

| 항목 | 설명 |
|------|------|
| 정의 | `crates/axia-core/src/group.rs` 내 ComponentDef + ComponentInstance |
| 상태 | 메타데이터만 구현, 실제 geometry 복제 미구현 (TODO) |

### 2.3 계층 간 참조 관계

```
Face ──(face_to_xia)──→ XIA    : O(1) 역인덱스
XIA  ──(face_ids)──────→ Face   : Vec 참조

Face ──(face_to_group)─→ Group  : O(1) 역인덱스 (serde skip)
Group──(face_ids)──────→ Face   : Vec 참조

XIA와 Group은 직접 연결 없음 — 둘 다 독립적으로 Face를 참조
```

---

## 3. XIA 기하 상태 — 계산형 모델 (2026-04-15 리팩토링 완료)

### 3.1 상태 정의

상태는 **저장하지 않고 `geometry_state()`로 계산**한다.

```
Geometry Layer:  Point(0D) → Edge(1D) → Face(2D) → Volume(3D)
Semantic Layer:  Object(=XIA), Material(속성), Group(UI 참조)
```

| 상태 | 차원 | 설명 | 계산 기준 |
|------|------|------|----------|
| Dissolved | -1 | 기하 없음 | face_ids=0, standalone_edge=없음 |
| Point | 0 | 공간의 한 점 | (예약, 현재 미사용) |
| Edge | 1 | 독립 선분 | face_ids=0, standalone_edge=있음 |
| Face | 2 | 평면 다각형 | face_ids=1~2 |
| Volume | 3 | 닫힌 솔리드 | face_ids=3+ |

**Material**은 Object(XIA)의 **속성**이며, 상태 전이를 유발하지 않는다.

### 3.2 상태 계산 규칙

- 상태는 `Xia::geometry_state()` 메서드로 계산 (저장 필드 없음)
- face_ids.len() + standalone_edge_id 기반 자동 판별
- Face 삭제 시 face_ids가 비면 자동 Dissolved
- Face 기반 edge는 `edges_for_xia()`로 계산 (저장 안 함, B안)

### 3.3 기하 생성 경로

| 연산 | 결과 상태 | 코드 위치 |
|------|----------|----------|
| DrawLine | Edge | scene.rs `exec_draw_line()` → standalone_edge_id 설정 |
| DrawRect, DrawCircle | Face | scene.rs → face_ids에 1개 추가 |
| PushPull | Volume | scene.rs `exec_push_pull()` → face_ids에 N개 추가 |
| Primitive 생성 | Volume | lib.rs `create_cylinder/cone/sphere()` → `create_xia_with_faces()` |
| DXF Import | Face/Volume | import_dxf.rs → 면 수 기반 자동 계산 |
| Face 삭제 | Dissolved | `unregister_face_from_xia()` → face_ids 비면 dissolve |
| Material 할당 | (변화 없음) | 속성만 변경, 상태 전이 없음 |

### 3.4 라이프사이클 관리 모듈

```
crates/axia-core/src/lifecycle.rs (19줄)
├── edges_form_loop()       — 닫힌 루프 판별 (Edge→Face 전제조건)
└── dissolve()              — 기하 참조 해제 (face_ids + standalone_edge_id 클리어)
```

promote/demote 함수는 제거됨 — 상태가 계산형이므로 불필요.

---

## 4. 렌더링 파이프라인

### 4.1 데이터 흐름

```
1. Rust Mesh
     │
     ▼ export_buffers()
2. WASM boundary (positions, normals, indices, faceMap)
     │
     ▼ WasmBridge.getMeshBuffers()
3. TypeScript 캐시 (Float32Array / Uint32Array)
     │
     ▼ Viewport.updateMesh()
4. Three.js BufferGeometry
     │
     ▼ WebGL Renderer
5. 화면 출력
```

### 4.2 메시 재질 (Two-Tone)

| 면 | Material | 색상 | 설정 |
|----|----------|------|------|
| 전면 | MeshStandardMaterial | #e8e8e8 | FrontSide, roughness 0.6, metalness 0.1 |
| 후면 | MeshBasicMaterial | #9898b4 | BackSide |
| 엣지 | LineBasicMaterial | #333366 | polygonOffset 적용 |

### 4.3 Delta Buffer (최적화 경로)

| 연산 유형 | 경로 | 비용 |
|----------|------|------|
| 토폴로지 변경 (draw/push_pull/delete/boolean) | Full Rebuild | geometry 재생성 |
| 위치 변경 (translate/rotate/scale) | Delta Patch | in-place 좌표 패치 |

```
Delta 경로:
  getDeltaBuffers() → topologyChanged=false → face별 offset/count
  → applyDelta() → subarray 기반 positions/normals 패치
  → boundingSphere 재계산만 (geometry rebuild 회피)
```

### 4.4 가시성 필터링

```
Group.visible 토글
  → set_group_visibility_recursive()
    → face.set_visible(bool)          ← Mesh Face에 직접 반영
      → export_buffers()에서 !visible face 제외
        → WASM → mark_topology_changed()
          → Viewport full rebuild
```

---

## 5. 선택 시스템

### 5.1 SelectionManager 구조

```
web/src/tools/SelectionManager.ts

상태:
  selected: Set<number>           면 선택 집합
  selectedEdges: Set<number>      엣지 선택 집합
  hovered: number                 호버 중인 면
  editingGroupId: number | null   그룹 편집 모드
  isXiaSelected: boolean          XIA 전체 선택 모드

하이라이트:
  hoverMesh / hoverOutline        호버 시각화
  selectionMesh / selectionOutline 선택 시각화
  xiaDotPoints / xiaBBoxLines     XIA 모드 시각화
```

### 5.2 선택 동작

| 입력 | 동작 |
|------|------|
| 단일 클릭 | 곡면 그룹 선택 (법선 30° 이내 연결 면) |
| Shift+클릭 | 추가 선택 |
| Ctrl+클릭 | 토글 선택 |
| 더블 클릭 | 그룹 편집 모드 진입 |
| 트리플 클릭 | XIA 전체 선택 (도트 + 바운딩 박스) |
| 빈 공간 클릭 | 전체 해제 |

### 5.3 잠금 강제 (Lock Enforcement)

```
handleClick(faceId)
  → bridge.isFaceLocked?(faceId)     ← 역인덱스 O(1) 조회
    → Scene.is_face_locked(faceId)
      → GroupManager.get_group_for_face()
        → group.locked 확인
          → true이면 선택 차단
```

---

## 6. 그룹 시스템

### 6.1 Group 구조

```rust
pub struct Group {
    pub id: GroupId,
    pub name: String,
    pub face_ids: Vec<FaceId>,
    pub parent: Option<GroupId>,
    pub children: Vec<GroupId>,
    pub visible: bool,
    pub locked: bool,
    pub is_component: bool,
    pub component_def: Option<ComponentDefId>,
    pub transform: Transform3D,
}
```

### 6.2 기능 매트릭스

| 기능 | 상태 | 위치 |
|------|------|------|
| 그룹 생성/삭제 | ✅ | scene.rs CreateGroup/DeleteGroup |
| 중첩 그룹 (트리) | ✅ | group.rs parent/children |
| 가시성 재귀 전파 | ✅ | scene.rs set_group_visibility_recursive() |
| 잠금 (선택 차단) | ✅ | SelectionManager.handleClick() |
| 컴포넌트 변환 | ⚠️ 메타데이터만 | scene.rs MakeComponent (TODO: geometry 복제) |
| 컴포넌트 인스턴스 | ⚠️ 메타데이터만 | scene.rs PlaceComponent (TODO) |

### 6.3 UI 패널 (ComponentPanel)

```
web/src/ui/ComponentPanel.ts

기능:
  - 그룹 트리 표시 (중첩 시각화, depth 기반 indent)
  - 아이콘: ▣ = Group, ◆ = Component
  - 토글: [V] = 가시성, [L] = 잠금
  - ✕ 버튼 → 그룹 해제
  - + 버튼 → 선택된 면으로 그룹 생성
  - ⟳ 버튼 → 트리 새로고침
  - 클릭 → 그룹 선택, 더블클릭 → 편집 모드
```

---

## 7. 도구 시스템

### 7.1 아키텍처

```
ITool 인터페이스 (tools/ITool.ts)
  ├── name: string
  ├── onActivate() / onDeactivate()
  ├── onMouseDown() / onMouseMove() / onMouseUp()
  ├── onKeyDown() / onKeyUp()
  ├── applyVCBValue()
  └── isBusy(): boolean

ToolManagerRefactored (tools/ToolManagerRefactored.ts)
  ├── setTool(name) — 도구 전환 + 활성화/비활성화 호출
  ├── executeAction(name) — undo/redo/delete/select-all/group 등
  ├── syncMesh() — WASM 버퍼 동기화 + 뷰포트 갱신
  └── registerPrimitive() — 프리미티브 도구 등록
```

### 7.2 도구 목록 (15개)

| # | 도구 | 파일 | 역할 |
|---|------|------|------|
| 1 | SelectTool | SelectTool.ts | 면/엣지 선택, 드래그 선택 |
| 2 | DrawLineTool | DrawLineTool.ts | 선 그리기 (Idle→Armed→Drawing 상태 머신) |
| 3 | DrawRectTool | DrawRectTool.ts | 사각형 그리기 |
| 4 | DrawCircleTool | DrawCircleTool.ts | 원 그리기 |
| 5 | PushPullTool | PushPullTool.ts | Push/Pull (면 클릭→이동→커밋) |
| 6 | OffsetTool | OffsetTool.ts | 오프셋 (면 축소/확대) |
| 7 | MoveTool | MoveTool.ts | 이동 (축 잠금 지원) |
| 8 | RotateTool | RotateTool.ts | 회전 |
| 9 | ScaleTool | ScaleTool.ts | 스케일 (균일/비균일) |
| 10 | EraseTool | EraseTool.ts | 면/엣지 삭제 |
| 11 | GroupTool | GroupTool.ts | 그룹 생성/편집/해제 |
| 12 | SphereTool | SphereTool.ts | 구 프리미티브 |
| 13 | CylinderTool | CylinderTool.ts | 원기둥 프리미티브 |
| 14 | ConeTool | ConeTool.ts | 원뿔 프리미티브 |
| 15 | (BasePrimitiveTool) | BasePrimitiveTool.ts | 프리미티브 공통 기반 클래스 |

### 7.3 도구 커밋 흐름

```
사용자 액션
  → Tool.onMouseDown/onMouseUp()
    → bridge.draw_line() / bridge.push_pull() / bridge.create_sphere() 등
      → WASM → Rust Scene.execute(Command)
        → Mesh 변경 + XIA 생성/갱신 + 트랜잭션 기록
          → syncMesh()
            → getMeshBuffers() / getDeltaBuffers()
              → Viewport.updateMesh() / applyDelta()
```

---

## 8. Undo/Redo 시스템

### 8.1 스냅샷 기반 구조

```
scene_snapshot() 포맷:
  ┌──────────────────────────────────────────────────┐
  │ [mesh_len:u64] [mesh_data: bincode]              │
  │ [xia_len:u64]  [xia_data: bincode(HashMap)]      │
  │ [group_len:u64] [group_data: bincode(GroupManager)]│
  │ [next_xia_id:u64]                                │
  └──────────────────────────────────────────────────┘
```

### 8.2 동작 흐름

```
커맨드 실행 전:
  1. transactions.begin()
  2. transactions.set_before_snapshot(scene_snapshot())

커맨드 실행 후:
  3. transactions.set_after_snapshot(scene_snapshot())
  4. transactions.commit()

Undo:
  → restore_scene_snapshot(before_snapshot)
  → mesh 복원 + xias 복원 + groups 복원 + next_xia_id 복원
  → rebuild_face_to_xia_index()  ← 역인덱스 재구축

Redo:
  → restore_scene_snapshot(after_snapshot)
  → 동일 복원 과정
```

### 8.3 레거시 호환

```
restore_scene_snapshot()는 3가지 포맷 지원:
  1. Mesh-only (레거시) — mesh만 복원, XIA/Group 유지
  2. Mesh + XIA (v1) — mesh + xias 복원
  3. Mesh + XIA + Group + next_xia_id (현재) — 전체 복원
```

---

## 9. 파일 입출력

### 9.1 저장/로드 포맷 (.axia)

```
.axia 파일 구조:
  [A][X][I][A]          매직 바이트
  [version:u32]         스냅샷 버전 (현재 v1)
  [mesh_len:u32]        메시 데이터 길이
  [mesh_data]           bincode 직렬화된 메시
  (v2: 재질 라이브러리 등 추가 섹션)
```

### 9.2 가져오기 (Import) 지원

| 포맷 | 방식 | XIA 생성 | 상태 |
|------|------|----------|------|
| OBJ | Three.js OBJLoader → 참조 geometry | ❌ | ✅ |
| STL | Three.js STLLoader → 참조 geometry | ❌ | ✅ |
| glTF/GLB | Three.js GLTFLoader | ❌ | ✅ |
| DAE | Three.js ColladaLoader | ❌ | ✅ |
| PLY | Three.js PLYLoader | ❌ | ✅ |
| 3DS | Three.js TDSLoader | ❌ | ✅ |
| DXF | Rust 파싱 → DCEL 메시 | ✅ (S2 적용) | ✅ |
| DWG | dwgdxf → DXF → 파싱 | ✅ (DXF 경유) | ✅ |
| SKP | JSZip + XML parser | ❌ | ⚠️ placeholder |

### 9.3 내보내기 (Export) 지원

| 포맷 | 방식 | 상태 |
|------|------|------|
| DXF | DxfWriter.ts (자체 구현) | ✅ |
| OBJ | Three.js OBJExporter (lazy import) | ✅ |
| GLTF/GLB | Three.js GLTFExporter (lazy import) | ✅ |
| STL | Three.js STLExporter (lazy import) | ✅ |

---

## 10. 스냅 시스템

### 10.1 SnapManager

```
web/src/snap/SnapManager.ts

모드:
  - Vertex (정점)
  - Edge (엣지)
  - Midpoint (중점)
  - Center (중심)
  - On Edge (엣지 위)

기능:
  - toggle() / setMode() / isActive()
  - setOverride() / consumeOverride() — 일회성 스냅 오버라이드
  - 참조점 기반 추론 (SketchUp 스타일 축 추론)
```

---

## 11. 재질 시스템

### 11.1 MaterialLibrary

```
web/src/materials/MaterialLibrary.ts (512줄)

내장 재질: 12개 (콘크리트, 강철, 유리, 목재, 대리석, 등)
속성:
  - Physical: 밀도, 열전도율, 화재등급, 탄성계수
  - Visual: 색상, 투명도, 금속성, 거칠기
  - 물리 계산: 부피 → 질량 → 무게 자동 산출
```

### 11.2 XIA 상태 연동

```
재질 할당 → Volume → Xia (자동 승격)
  scene.rs: face_to_xia 역인덱스 → O(1)로 관련 XIA 조회
    → lifecycle::promote_to_xia()

재질 해제 → Xia → Volume (자동 강등, 모든 face가 default material일 때)
  → lifecycle::demote_to_volume()
```

---

## 12. 성능 최적화

### 12.1 적용된 최적화

| 최적화 | 설명 | 효과 |
|--------|------|------|
| Delta Buffer | translate/rotate/scale 시 geometry rebuild 회피 | GPU 전송 최소화 |
| face_to_xia 역인덱스 | PushPull/Material O(N)→O(1) XIA 조회 | XIA 수 증가 시 선형→상수 |
| GeometryPool | Three.js geometry/material 오브젝트 풀링 | GC 부하 감소 |
| WasmBridge 버퍼 캐싱 | 동일 프레임 내 중복 WASM 호출 방지 | WASM boundary 비용 감소 |
| Lazy Import | DXF/OBJ/GLTF/STL 내보내기 지연 로드 | 초기 번들 77% 감소 (1,116KB→252KB) |
| Spatial Hash | O(1) 정점 병합 (1e-6 허용오차) | 정점 검색 해시 테이블 |

---

## 13. 테스트 현황

### 13.1 테스트 통계

```
51 suites, 842 tests — 전체 통과
프레임워크: Vitest 3.2.4 + jsdom
Three.js Mock: web/src/__mocks__/three.ts
WASM Stub: web/src/wasm/axia_wasm.ts
```

### 13.2 주요 테스트 영역

| 영역 | 파일 수 | 테스트 수 |
|------|---------|----------|
| Tools (도구) | 15 | ~220 |
| Bridge / Core | 4 | ~64 |
| UI | 14 | ~170 |
| Snap | 2 | ~40 |
| Materials | 2 | ~49 |
| Primitives | 4 | ~51 |
| Export | 3 | ~29 |
| Viewport | 1 | ~10 |
| Utils | 2 | ~20 |

---

## 14. 발견된 문제점 및 개선 과제

### 14.1 문제점 (심각도순)

| # | 문제 | 심각도 | 설명 |
|---|------|--------|------|
| 1 | **XIA 상태 ↔ 실제 기하 불일치 가능** | 🔴 높음 | Face 삭제(EraseTool) 후 XIA의 state가 갱신되지 않음. face_ids가 빈 XIA가 Face/Volume 상태로 남을 수 있음 |
| 2 | **face_to_xia 삭제 경로 미갱신** | 🔴 높음 | EraseTool/delete_face 시 face_to_xia에서 해당 FaceId를 제거하는 코드가 없음. 삭제된 face가 역인덱스에 잔류하여 dangling reference 발생 가능 |
| 3 | **Group.face_to_group 스냅샷 복원 누락** | 🟡 중간 | GroupManager의 face_to_group이 `#[serde(skip)]`이므로 restore_scene_snapshot() 후 비어있음. rebuild 호출이 없어 그룹 조회 실패 가능 |
| 4 | **XIA·Group 이중 소유** | 🟡 중간 | 같은 Face가 XIA.face_ids와 Group.face_ids 양쪽에 등록 가능. 소유권 충돌 규칙이 없어 가시성/잠금 동기화 불확실 |
| 5 | **Lock이 선택만 차단** | 🟡 중간 | 잠긴 그룹 면의 선택은 SelectionManager에서 차단하지만, PushPull/Offset/Erase 등 직접 기하 조작 커맨드는 lock 검사 없이 실행 가능 |
| 6 | **Three.js Import → DCEL 미주입** | 🟢 낮음 | OBJ/STL/GLTF 등 Three.js 로더로 가져온 geometry는 참조 전용이며 DCEL 메시에 주입되지 않음. 편집 불가 |
| 7 | **Component 인스턴싱 미구현** | 🟢 낮음 | MakeComponent/PlaceComponent가 메타데이터만 생성. 실제 geometry 복제/인스턴스 렌더링 미구현 |

### 14.2 잘 작동하는 부분

| 항목 | 상태 | 비고 |
|------|------|------|
| 단일 Mesh DCEL 기하 커널 | ✅ 안정 | 일관된 토폴로지 관리 |
| XIA 차원 상태 머신 (생성 경로) | ✅ 안정 | Draw/PushPull/Primitive/DXF 모두 XIA 생성 |
| face_to_xia 역인덱스 (생성 경로) | ✅ 안정 | O(1) 조회, PushPull/Material 최적화 |
| Material ↔ XIA 자동 승격/강등 | ✅ 안정 | 역인덱스 활용 |
| Undo/Redo 통합 스냅샷 | ✅ 안정 | Mesh+XIA+Group+next_xia_id |
| Delta Buffer 최적화 | ✅ 안정 | translate/rotate/scale 빠른 경로 |
| 스냅 시스템 | ✅ 안정 | 정점/엣지/중점/중심 |
| 테스트 커버리지 | ✅ 충분 | 51 suites, 842 tests |
| 번들 최적화 | ✅ 안정 | 초기 252KB, lazy import |

---

## 15. 최근 적용 이력

| 날짜 | 작업 | 커밋 |
|------|------|------|
| 04-13 | Phase C: 메모리 누수 + console 정리 | PR #1 |
| 04-14 | Phase D: 테스트 842개 + Export 완성 | PR #2 |
| 04-15 | Line→Point 오인식 수정 | 94e2e19 |
| 04-15 | A1~A3 기능 안정화 (자동 그룹/선택, Undo 스냅샷) | d1535d5 |
| 04-15 | B2 Group 가시성/선택/잠금 강화 | 99c0c9d |
| 04-15 | S1+S2 XIA 객체 승격 (직렬화+역인덱스+Primitive/DXF) | dce2a52 |

---

*이 보고서는 커밋 dce2a52 기준으로 작성되었습니다.*
