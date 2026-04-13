# AXiA 3D — 프로젝트 지침 (Claude 세션용)

## 프로젝트 목표
블렌더보다 쉽고, 스케치업보다 정확한 3D 모델링 플랫폼.
CAD를 대치하는 가벼운 동작의 모델링 프로그램.

## 기술 스택
- **Rust WASM 엔진**: Half-Edge DCEL 기반 기하 커널 (axia-geo)
- **Three.js 0.170**: 뷰포트 렌더링 (two-tone: FrontSide #e8e8e8 + BackSide #9898b4)
- **TypeScript + Vite**: 프론트엔드 빌드
- **wasm-pack + vite-plugin-wasm**: WASM 로딩

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

## 향후 과제
- Material / Texture
- Constraint Solver (수직, 평행, 거리 고정)
- File I/O: OBJ/GLTF export, STEP/IGES 지원
- Electron/Tauri 데스크톱 앱
- Boundary Extraction (Solid → Face)
