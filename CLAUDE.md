# AXiA 3D — 프로젝트 지침 (Claude 세션용)

## 프로젝트 목표
블렌더보다 쉽고, 스케치업보다 정확한 3D 모델링 플랫폼.
CAD를 대치하는 가벼운 동작의 모델링 프로그램.

## 기술 스택
- **Rust WASM 엔진**: Half-Edge DCEL 기반 기하 커널 (axia-geo)
- **Three.js 0.170**: 뷰포트 렌더링 (two-tone: FrontSide #e8e8e8 + BackSide #9898b4)
- **TypeScript + Vite**: 프론트엔드 빌드
- **wasm-pack + vite-plugin-wasm**: WASM 로딩

## Architecture Decision (2026-04-15 확정)

### 개념 모델 — Geometry Layer / Semantic Layer 분리

```
Geometry Layer (순수 기하):  Point(0D) → Edge(1D) → Face(2D) → Volume(3D 닫힌 솔리드)
Semantic Layer (의미):       Object(=XIA), Material, Group
```

1. **Geometry Layer**는 Point / Edge / Face / Volume만 포함한다.
2. **Volume**은 "닫힌 기하 상태"이며 Object가 아니다.
3. **Object**는 Semantic Layer에 속하며 XIA와 동일 개념이다.
4. Object/XIA는 기하를 "소유"하고, 기하 상태는 소유한 기하에서 "계산"된다.
5. XIA.state는 저장하지 않으며, `geometry_state()`로 계산한다.
6. **Material**은 Object의 속성(property)이며 상태 전이를 유발하지 않는다.
7. **Group**은 UI 전용 선택 집합이며 face를 참조할 뿐 소유하지 않는다.

### 참조 관계
- Object → face_ids (소유), standalone_edge_id (draw_line 전용)
- Object → Material (속성, Option — 상태 전이 유발 안 함)
- Group → face_ids (참조, Object 경계 무관)
- face_to_xia: HashMap<FaceId, XiaId> (O(1) 역인덱스)
- geometry_state(): face_ids.len() + standalone_edge_id로 계산 (Dissolved|Point|Edge|Face|Volume)
- edges_for_xia(): face_ids → face_outer_edges() 계산 (저장 안 함, B안)

## 빌드 방법
```bash
# WASM 빌드 (Rust 툴체인 필요)
cd crates/axia-wasm
wasm-pack build --target web --out-dir ../../web/src/wasm

# 프론트엔드 빌드
cd web
npx vite build --emptyOutDir false
```

## 핵심 파일 구조
```
crates/
  axia-geo/src/operations/push_pull.rs  — Push/Pull Rust 엔진 (MoveOnly + CreateFace)
  axia-geo/src/operations/boolean.rs    — Boolean Operations (Union/Subtract/Intersect)
  axia-geo/src/mesh.rs                  — DCEL 메시 (merge_faces_by_edge, remove_face 등)
  axia-wasm/src/lib.rs                  — WASM 바인딩 (push_pull, undo, get_mesh_buffers)
  axia-core/src/scene.rs                — XIA/Scene, Command 실행, 버전 관리 직렬화
  axia-core/src/group.rs                — Group/Component 시스템 (중첩, 가시성, 잠금)

web/src/
  tools/ITool.ts                        — Tool 인터페이스 + ToolContext 정의
  tools/ToolManagerRefactored.ts        — 리팩토링된 도구 관리자 (~350줄, 디스패처 패턴)
  tools/ToolManager.ts                  — 레거시 도구 관리자 (호환성 유지)
  tools/DrawLineTool.ts                 — 선 그리기 도구
  tools/DrawRectTool.ts                 — 사각형 그리기 도구
  tools/DrawCircleTool.ts               — 원 그리기 도구
  tools/PushPullTool.ts                 — Push/Pull 도구
  tools/MoveTool.ts                     — 이동 도구
  tools/RotateTool.ts                   — 회전 도구
  tools/ScaleTool.ts                    — 스케일 도구
  tools/OffsetTool.ts                   — 오프셋 도구
  tools/EraseTool.ts                    — 삭제 도구
  tools/SelectTool.ts                   — 선택 도구
  tools/GroupTool.ts                    — 그룹 생성/편집 도구 (SketchUp 스타일)
  viewport/Viewport.ts                  — Three.js 렌더링, 메시 동기화
  viewport/GeometryPool.ts              — Three.js 지오메트리/머티리얼 오브젝트 풀
  bridge/WasmBridge.ts                  — WASM 통신 브리지 (타입 안전, 버퍼 캐싱, Group/Component)
  ui/Toast.ts                           — Toast 알림 시스템 (사용자 피드백)
  ui/ComponentPanel.ts                  — 그룹/컴포넌트 트리 패널 (Outliner)
  wasm/axia_wasm.js                     — WASM 바인딩 JS (수동 수정된 부분 있음)
```

## Push/Pull 구현 현황 (2026-04-09 확정)

### Rust 엔진
- AixxiA 원본 로직 그대로 포팅
- **MoveOnly**: 연결 edge가 노멀과 평행 → 정점만 이동
- **CreateFace**: 상부면 + 측면벽 생성 + coplanar 병합 (merge_faces_by_edge 큐 기반)
- 솔리드 방식: 원본 face 유지 (바닥면 닫힘)

### Three.js 고스트 프리뷰 (최종 확정)
- **투명 프리뷰 방식** (MeshBasicMaterial)
- 면: #5b9bd5, FrontSide, opacity 0.3, depthWrite: false
- 벽: #5b9bd5, FrontSide, opacity 0.2, depthWrite: false
- 엣지: #2a6cb8, LineBasicMaterial, depthTest: false, renderOrder: 1000
- Push/Pull 동일 처리 (방향 구분 없음)
- 동작: 면 클릭 → 마우스 이동(프리뷰) → 두 번째 클릭(커밋)

### 메인 메시 렌더링
- 전면: MeshStandardMaterial, #e8e8e8, FrontSide, roughness 0.6, metalness 0.1
- 후면: MeshBasicMaterial, #9898b4, BackSide
- 엣지: LineBasicMaterial, #333366
- polygonOffset 적용

## Group / Component 구현 현황 (2026-04-12 추가)

### Rust 엔진 (axia-core/src/group.rs)
- **그룹 구조**: 중첩 가능한 트리 구조 (parent-child 관계)
- **생성/삭제**: `create_group(name, faceIds)` → groupId 반환
- **면 관리**: `add_faces_to_group()`, `remove_faces_from_group()`
- **계층**: `set_group_parent(childId, parentId)` → 중첩 그룹 지원
- **상태 관리**: 가시성(visible), 잠금(locked) 토글 가능
- **컴포넌트**: `make_component()` → 그룹을 재사용 가능한 컴포넌트로 변환

### TypeScript 클라이언트
- **GroupTool.ts**: SketchUp 스타일 그룹 인터랙션
  - G키 또는 메뉴 → 선택된 면들로 그룹 생성
  - 그룹 선택 → 그룹 전체 선택
  - 더블클릭 → 그룹 편집 모드 진입 (내부 면 선택 가능)
  - ESC → 그룹 편집 모드 종료
  - Delete → 그룹 해제

- **ComponentPanel.ts**: Outliner 패널 (우측 사이드바)
  - 그룹 트리 표시 (중첩 구조 시각화)
  - 아이콘: ▣ = Group, ◆ = Component
  - 토글: 가시성(👁), 잠금(🔒)
  - 삭제 버튼(✕) → 그룹 해제
  - 새로고침 버튼 → 트리 동기화

- **SelectionManager**: 로컬 그룹 캐시
  - WASM 미지원 시 기본값으로 작동
  - groupId ↔ Set<faceId> 매핑
  - 그룹 편집 모드 상태 관리

### WasmBridge 확장 (bridge/WasmBridge.ts)
```typescript
// AxiaEngineExtended 인터페이스에 추가된 메서드들:
create_group?(name: string, faceIds: Uint32Array): number
delete_group?(groupId: number): boolean
rename_group?(groupId: number, newName: string): boolean
toggle_group_visibility?(groupId: number): boolean
toggle_group_lock?(groupId: number): boolean
get_group_for_face?(faceIdRaw: number): number
get_group_faces?(groupId: number): Uint32Array
add_faces_to_group?(groupId: number, faceIds: Uint32Array): boolean
remove_faces_from_group?(groupId: number, faceIds: Uint32Array): boolean
set_group_parent?(childId: number, parentId: number): boolean
make_component?(groupId: number, name: string): number
get_group_info?(groupId: number): string  // JSON
get_all_groups?(): string  // JSON
group_count?(): number
```

### GroupInfo 인터페이스
```typescript
interface GroupInfo {
  id: number;
  name: string;
  faceCount: number;
  faceIds: number[];
  parent: number | null;
  children: number[];
  visible: boolean;
  locked: boolean;
  isComponent: boolean;
  error?: string;
}
```

### 주요 상호작용 플로우
1. **그룹 생성**: 면 선택 → G키 → `createGroup()` → WASM 생성 → 로컬 동기화
2. **그룹 편집**: 그룹 더블클릭 → `enterGroupEdit()` → 내부 면 선택 가능
3. **그룹 해제**: Delete 또는 패널의 ✕ 버튼 → `deleteGroup()` → 면 자유 상태로 복귀
4. **가시성/잠금**: 패널의 아이콘 토글 → `toggleGroupVisibility/Lock()` → 렌더링 업데이트
5. **Fallback**: WASM 미지원 시 SelectionManager의 로컬 캐시 자동 사용

## 시행착오 기록 (중요)
1. 불투명 고스트 → Push시 메인 메시 내부에 가려짐 → 폐기
2. depthTest: false → 반대편 벽이 외부 객체 가림 → 폐기
3. 파란 반투명 (DoubleSide, MeshStandard) → 조명 반사로 면이 지저분 → 개선
4. 메인 메시 동일 색상 → Pull 완벽, Push 내부 가려짐 → 부분 성공
5. **MeshBasicMaterial + FrontSide + 투명** → 매끈하고 깨끗 → 최종 채택

## 주의사항
- `axia_wasm.js`는 wasm-pack 생성 후 수동 수정됨 (initSync, __wbg_init 재구성)
- `axia_wasm.d.ts`에 JSDoc 닫기(`*/`) 수동 추가
- 빌드 시 `--emptyOutDir false` 필수 (권한 오류 방지)
- Rust 툴체인이 없는 환경에서는 WASM 재빌드 불가 → JS/TS만 수정 가능

## 완료된 기능
- Draw 도구 (Line, Rect, Circle)
- Push/Pull (고스트 프리뷰 + Rust 엔진)
- Move/Rotate/Scale
- Offset
- Erase
- Snap System (vertex, edge, midpoint, center)
- 3D 축 추론 (SketchUp 스타일)
- Dimension Input (DimensionLabel)
- Undo/Redo
- Selection (면/엣지 선택, 드래그 선택)
- Boolean Operations (Union, Subtract, Intersect) — coplanar 감지 + 결과 병합 포함
- Group / Component (생성, 편집, 중첩, 가시성/잠금 제어, Outliner 패널)
- Toast 알림 시스템 (성공/오류/경고/정보)
- 버전 관리 직렬화 (AXIA 매직 바이트 + 하위 호환)

## 2026-04-09 대규모 리팩토링 내역
- **ToolManager 리팩토링**: 2,444줄 단일 파일 → ITool 인터페이스 + 10개 개별 Tool 클래스
- **TypeScript 타입 안전성**: any 캐스팅 20개 전부 제거, AxiaEngineExtended 인터페이스 도입
- **Rust 컴파일 경고 전부 수정**: unused imports/variables 정리
- **Boolean Operations 완성**: coplanar face 감지, 결과 face 병합, orphan 정리
- **성능 최적화**: WasmBridge 버퍼 캐싱, GeometryPool 오브젝트 풀링
- **테스트 48개 추가**: Boolean(11) + Mesh(10) + PushPull(11) + Scene(16)
- **직렬화 버전 관리**: AXIA 매직 바이트 + 버전 헤더 + 레거시 호환

## File I/O 구현 현황 (2026-04-13 완료)

### DXF Import/Export (✅ 완성)
- **DXF Import**: parseString (dxf, MIT) → LINE, CIRCLE, ARC, LWPOLYLINE, FACE
- **DXF Export**: DxfWriter.ts (자체 구현, MIT) → 모든 entity type 지원
- **상태**: 프로덕션 준비 완료, GPL-free

### DWG Import (✅ GPL-free 완성)
- **아키텍처**: DWG → dwgdxf (MIT) → DXF → 파싱
- **메타데이터**: DXF HEADER 섹션에서 추출 (내장 regex, GPL-free)
- **제거됨**: LibreDwg (GPL v3) - 완전히 제거됨
- **빌드**: ✅ Success (2.27s, 0 errors)

### SKP Import (✅ 활성화)
- **프로세서**: jszip을 이용한 OPC 압축 해제
- **형식**: model.xml 파싱 → placeholder geometry
- **상태**: 기본 구조 준비 완료

### 지원 포맷
| 포맷 | 상태 | 구현 |
|------|------|------|
| OBJ | ✅ | Three.js OBJLoader |
| STL | ✅ | Three.js STLLoader |
| glTF/GLB | ✅ | Three.js GLTFLoader |
| DAE | ✅ | Three.js ColladaLoader |
| PLY | ✅ | Three.js PLYLoader |
| 3DS | ✅ | Three.js TDSLoader |
| DXF | ✅ | parseString + DxfWriter |
| DWG | ✅ | dwgdxf + DXF 파이프라인 |
| SKP | ✅ | JSZip + XML parser |
| 3DM | ✅ | Three.js Rhino3dmLoader + rhino3dm.wasm |

## Delta Buffer 시스템 (Phase 1 — 2026-04-13 완성)

### 아키텍처
- **토폴로지 변경 연산** (draw/push_pull/delete/boolean/offset): `mark_topology_changed()` → delta 불가, JS가 full rebuild
- **위치 변경 연산** (translate/rotate/scale): `mark_faces_dirty()` → delta 가능, JS가 in-place 패치

### Rust (lib.rs)
- `FaceRange { vert_start, vert_count }`: face→buffer 범위 매핑 (rebuild_cache에서 구축)
- `DeltaBuffers`: `topology_changed` 플래그 + `face_vert_offsets`/`face_vert_counts` + positions/normals
- `get_dirty_face_buffers()`: topology_changed면 빈 delta 반환, 아니면 face_range_map 기반 delta 추출

### TypeScript
- `WasmBridge.getDeltaBuffers()`: WASM delta 조회
- `WasmBridge.applyDeltaToGeometry()`: `faceVertOffsets` 기반 in-place 패치 (subarray 사용)
- `Viewport.applyDelta()`: Three.js geometry 패치 + boundingSphere 재계산
- `Viewport.updateEdgeLines()`: delta 경로에서 edge wireframe만 교체
- `ToolManager.syncMesh()`: delta 우선 분기 → 실패 시 full rebuild fallback

### 성능 효과
- translate/rotate/scale: Three.js geometry destroy+recreate 회피 (smoothNormals, EdgesGeometry 재생성 비용 절감)
- 토폴로지 변경: 기존과 동일 (full rebuild)

## 리팩토링 완료 내역 (2026-04-13)

### Phase 1-3: 모듈 추출 (main.ts 2,306줄 → 318줄, 84.5% 감소)
- ITool 인터페이스 + 10개 개별 Tool 클래스
- BooleanHandler, ProjectSerializer, VCB, KeyboardShortcuts, ContextMenu
- MenuBar, InitialScene, XiaInspector

### Phase A: 코드 품질 (커밋 45b2bce, 9fa54f1)
- `window.__axia_*` 전역 6개 제거 → 의존성 주입 패턴
- SnapManager.setOverride/getOverride/consumeOverride 추가
- OsnapPanel API 객체 반환 패턴
- FileManager.onFileChange() 콜백 (몽키패치 제거)

### Phase B: 번들 최적화 (커밋 eb1dcdd)
- FileImporter/DxfExporter → dynamic import (지연 로딩)
- vite.config.ts manualChunks (three-loaders, file-io-libs)
- 초기 JS 번들: 1,116KB → 252KB (77% 감소)

## Phase C 완료 내역 (2026-04-13, PR #1)

### ✅ CRITICAL — 메모리 누수 (완료)
1. **파일 다이얼로그 DOM/리스너 누수** — FileManager.ts, FileImporter.ts
   - cleanup() 헬퍼로 DOM 제거 + 리스너 해제 보장 (change/cancel/error 모든 경로)
2. **setInterval 참조 없음** — main.ts
   - statsIntervalId에 ID 저장 + beforeunload에서 clearInterval

### ✅ HIGH — 프로덕션 품질 (완료)
3. **console.log 220개 → debugLog 전환** — 27개 파일
   - utils/debug.ts의 debugLog/debugWarn 래퍼 사용 (window.__AXIA_DEBUG=true로 활성화)
   - console.error + 유효한 console.warn 유지
5. **window 이벤트 리스너 정리** — Viewport.ts
   - track() 헬퍼로 5개 리스너 모두 _boundHandlers에 등록, dispose()에서 정리

### ✅ MEDIUM — 안정성 (완료)
6. **렌더 루프 정지** — Viewport.ts
   - _frameId + stop() + cancelAnimationFrame 추가, dispose()에서 stop() 호출
7. **Three.js geometry 누수** — PrimitivePreviewManager.ts
   - updateRadiusCircle/updateHeightAxis에서 이전 geometry .dispose() 추가

### ⏭ 보류
4. **`as any` 27개** — WasmBridge 8개는 Rust 빌드 필요, 나머지 의도적 캐스팅 (위험도 낮음)
8. **dist/ 오래된 빌드 파일** — worktree에는 빌드 없음, 메인 repo에서 배포 전 수동 정리

## Phase D 완료 내역 (2026-04-14, PR #2)

### ✅ 테스트 확충 (51개 suite, 837개 테스트)

**Core / Bridge / File:**
- WasmBridge.test.ts (39) — WASM 통신, 메시 버퍼, draw/push_pull/undo/redo, 그룹, boolean, DXF
- ServiceContainer.test.ts (12) — DI 컨테이너 register/get/freeze
- FileManager.test.ts (14) — AXIA 포맷 파싱, 저장/로드, 콜백, 재질 라이브러리
- FileImporter.test.ts (9) — 포맷 감지, 구조 검증

**Tools:**
- ToolManagerRefactored.test.ts (39) — 도구 전환, 액션 디스패치, syncMesh, 프리미티브 등록
- SelectionManager.test.ts (39) — 면/엣지 선택, 그룹 CRUD, 그룹 편집 모드, onChange
- DrawLineTool.test.ts (14) — 상태 머신 (Idle→Armed→Drawing), VCB 입력
- DrawRectTool.test.ts (8) — 첫 클릭 시작점, isBusy, activate/deactivate
- DrawCircleTool.test.ts (8) — 첫 클릭 중심점, isBusy, activate/deactivate
- PushPullTool.test.ts (15) — 면 선택, VCB 입력, smooth group
- OffsetTool.test.ts (13) — 면 선택, VCB 입력, 커서 변경
- OffsetSessionManager.test.ts (15) — start, isActive, distance, session, dispose
- MoveTool.test.ts (14) — 이동 도구 활성화/비활성화, 면 선택
- RotateTool.test.ts (14) — 회전 도구, 축 설정
- ScaleTool.test.ts (14) — 스케일 도구, 균일/비균일
- EraseTool.test.ts (15) — 삭제 도구, 면/엣지 삭제
- SelectTool.test.ts (13) — 선택 도구, 드래그 선택
- GroupTool.test.ts (18) — 그룹 생성/편집/해제

**Primitives:**
- SphereTool.test.ts (7) — 이름, isBusy, 생성 플로우
- ConeTool.test.ts (9) — 3클릭 플로우 (앵커→반지름→높이)
- CylinderTool.test.ts (8) — 3클릭 플로우
- PrimitivePreviewManager.test.ts (10) — 반지름 원, 높이 축, dispose
- PrimitiveSession.test.ts (17) — 상태 머신 idle→sizing1→sizing2→done

**Snap:**
- SnapManager.test.ts (28) — 모드/토글/오버라이드, 참조점, 트랙포인트
- SnapVisual.test.ts (12) — 스냅 시각화 마커/라인

**UI:**
- Toast.test.ts (7) — 싱글톤, show, static 메서드
- DimensionLabel.test.ts (7) — 오버레이/캔버스 생성, update/clear
- MenuBar.test.ts (18) — 메뉴 열기/닫기, export 항목
- CommandInput.test.ts (17) — 명령 파싱/실행, 히스토리
- CommandRegistry.test.ts (9) — 명령 등록/실행/별칭
- KeyboardShortcuts.test.ts (22) — 키 바인딩, 도구 전환, undo/redo
- ContextMenu.test.ts (14) — 우클릭 메뉴, 항목 실행
- ProjectSerializer.test.ts (18) — 프로젝트 직렬화/역직렬화
- VCB.test.ts (9) — 값 입력 박스 업데이트/콜백
- StylePanel.test.ts (14) — 스타일 패널 렌더링/토글
- OsnapPanel.test.ts (8) — OSNAP 패널 체크박스 동기화
- BooleanHandler.test.ts (9) — 불리언 연산 핸들러
- ComponentPanel.test.ts (18) — 그룹 트리 패널 표시/토글
- DxfImportHandler.test.ts (9) — DXF 임포트 핸들러
- InitialScene.test.ts (9) — 초기 씬 생성
- MaterialPropertiesPanel.test.ts (8) — 재질 속성 패널
- DraggablePanelManager.test.ts (12) — 드래그 패널 관리자
- PickBox.test.ts (6) — 선택 박스 표시/숨기기

**Materials / Units / Export / Utils:**
- MaterialLibrary.test.ts (37) — 12개 내장 재질, 할당/해제, 물리 계산, 직렬화
- UnitSystem.test.ts (12) — 단위 변환, 포맷팅
- SettingsPanel.test.ts (9) — 설정 패널 렌더링
- DxfExporter.test.ts (8) — DXF 출력 포맷 검증
- DxfWriter.test.ts (13) — DXF 문자열 생성
- ExportUtils.test.ts (8) — downloadText/downloadBlob/timestampedName
- GeometryPool.test.ts (10) — 오브젝트 풀 acquire/release
- debug.test.ts (8) — debugLog/debugWarn 래퍼

**테스트 인프라:**
- vitest.config.ts Three.js alias (subpath import 지원)
- `__mocks__/three.ts` — Three.js 종합 모킹 (Vector2/3, BufferGeometry, Raycaster 등)
- `wasm/axia_wasm.ts` — WASM 스텁 (Rust 빌드 없이 테스트 가능)

### ✅ OBJ/GLTF/STL Export 완성
- OBJExporter → text OBJ 다운로드
- GLTFExporter → binary GLB 다운로드
- STLExporter → binary STL 다운로드
- 모두 lazy import (번들 최적화)
- ExportUtils.ts 공유 유틸 (downloadText, downloadBlob, timestampedName)
- MenuBar.ts 스텁 → 실제 export 동작으로 교체

### ✅ Material UI 확인
- XiaInspector에서 재질 드롭다운 선택 → assignToFaces() → Viewport 색상 동기화 이미 완성
- MaterialPropertiesPanel.ts (248줄) — 재질 속성 편집 UI 완성
- 물리 속성 (밀도/질량/무게) 계산 + 표시 완성

## SketchUp-style Inference Engine (Phase A/B/C — 2026-04-19 완성)

AXiA Snap 시스템은 SketchUp 수준의 계층적 추론(Inference) 엔진을 갖춤.

### 계층적 후보 생성 (SnapManager.findSnap)
1. **점 추론**: endpoint / midpoint / intersection / apparent / center / geometric / quadrant / node
2. **선 추론**: nearest (on edge) / onFace / perpendicular / parallel / tangent / extension
3. **축 추론**: axisX (빨강) / axisY (파랑) / axisZ (초록) — SketchUp 컬러 규칙
4. **파생 추론** (B2): `_recentHoveredEdges` 큐(cap 3)에 저장된 엣지 방향으로 parallel·extension
5. **그리드 스냅**: gridSpacing 기반 격자점 (가장 낮은 우선순위)

### Scoring
- priority × 1000 - pixel distance (낮은 priority가 우선)
- **Recency bonus (A4)**: 400ms 이내 같은 타입 재등장 시 -0.5 보정

### Inference Lock (B1) — `K` 키
- 현재 스냅을 `setLockedInference`로 잠그면 cursor가 lock constraint에 강제 투영
- 축 lock: 세계 축에 cursor ray 투영
- parallel/perpendicular lock: edge 방향 라인 투영
- 점 lock: 해당 위치 고정

### Tentative Snap (B3) — `Tab` 키
- 마지막 ranked candidates 보존 → Tab으로 순환 → SnapVisual 업데이트
- 매 mousemove 시 index 리셋 (예측 가능한 UX)

### 키보드 Filter Toggle (A5) — `Alt + X`
- `Alt+E/M/I/C/P/L/F/G/X/N` — 10개 스냅 모드 개별 on/off
- OSNAP 패널 체크박스도 자동 동기화

### 시각 피드백
- **컬러**: SketchUp 관습 (endpoint 녹색/midpoint 청록/intersection 빨강/onFace 파랑/perp·parallel 분홍/axis X·Y·Z = 빨·파·녹)
- **가이드 점선 (A6)**: axis/parallel/perpendicular에서 `guideFrom`→snap 점선 렌더

### 성능 (Phase C)
- **BVH picking (C1)**: three-mesh-bvh 0.9.9 monkey-patch — `raycaster.intersectObjects` 자동 O(log N)
- **Vertex spatial hash (B4)**: CELL_SIZE=5000mm, `queryVertexCells`로 3×3×3=27셀 필터
- **Dirty flag (C2)**: `updateFromMesh`가 시그니처 동일 시 rebuild skip

### Defer 항목
- **C3 Worker thread**: 씬 규모 ~수백 face에서 ROI 낮음
- **C4 GPU picking**: BVH로 CPU pick 충분히 빠름, edge picking 시 재고

## Constraint Solver (Level 1/2/3 — 2026-04-19 완성)

파라메트릭 CAD 스타일 구속 시스템.

### Level 1 — One-shot apply (`ConstraintCommands.ts`)
`makeParallel/makePerpendicular/makeCollinear` — 선택된 2 엣지에 즉시 기하 조정.
지속 관계 저장 안 함.

### Level 2 — Persistent graph (`axia-core/constraint.rs` + `Scene.constraints`)
- `ConstraintGraph`: VertId pair 기반 reference (edge split에 견고)
- `addEdgeConstraint(kind)` / `addDistanceConstraint(vA, vB, distance)`
- `removeConstraint` / `setConstraintActive` / `listConstraints`
- snapshot에 포함 → undo/redo + AXIA 파일 저장 시 유지 (roundtrip 검증 완료)
- 모든 transform 후 자동 resolve

### Level 3 — Iterative XPBD solver
- `resolveConstraintsIterative(max_iter, tolerance)` — 순차 투영 반복
- Residual 정의: Parallel/Perpendicular/Collinear/Distance
- Stagnation heuristic → `overConstrained` 조기 종료
- 체인 전파 (A‖B‖C) 자동 수렴

### UI — ConstraintPanel (`J` 키)
우측 사이드바 패널:
- 제약 목록 (id, kind icon, refs, active, 삭제)
- 상태바: 개수 + residual + 수렴 아이콘 (✓/⚠)
- ⟳ 모두 해결 / ✕ ALL 모두 삭제
- 컬러: ∥ 평행, ⊥ 수직, — 동일 선상, ↔ 거리

### 사용법
**평행/수직/동일 선상**: 엣지 2개 선택 → 우클릭 → "엣지 평행/수직/동일 선상 정렬"
**엣지 길이 고정**: 엣지 1개 선택 → 우클릭 → "엣지 길이 설정…" → 값 입력
**엣지 중점 분할**: 엣지 1개 선택 → 우클릭 → "엣지 중점 분할"

## 향후 과제
- Material / Texture (텍스처 이미지 매핑 미구현)
- Constraint Solver (수직, 평행, 거리 고정 — 파라메트릭)
- STEP/IGES 지원
- Electron/Tauri 데스크톱 앱
- Boundary Extraction (Solid → Face)
- Worker thread / GPU picking (대형 씬 필요 시)
