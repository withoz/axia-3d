# AXiA 3D — 프로젝트 지침 (Claude 세션용)

## 🔒 불변 정책 — 절대 변경 금지 (LOCKED 2026-04-28)

다음 정책들은 사용자가 **명시적으로 거부 또는 변경 요청** 하기 전까지
**모든 후속 세션에서 그대로 유지**되어야 한다. ADR-014 메타-원칙 #10
("ADR 불변 — 변경 시 새 ADR + Superseded") 적용.

### 1. ADR-021 — Closed Edge Loop Divides Face (P7, 2026-04-29)
- **새 원칙 P7**: "닫힌 라인(엣지)는 면을 나눈다."
- Connected inner components 는 1 combined hole 로 합쳐진다.
- Disjoint inner components 는 multi-hole ring (별개 hole 들).
- **그리기 순서 무관**: Case A (inner 먼저) = Case B (outer 먼저) = 동일 결과.
- ADR-015 LOCKED #1 의 single-promote heuristic 폐기 — combined-perimeter
  방식으로 manifold 안전 자연 보장.
- ADR-016 conditional B1 의 single-inner case 는 P7 의 특수 case (1 component → 1 hole) 로 흡수.
- Step 4.95 second-pass: container 별 inner 그룹 → connected component 분석
  → 각 component 의 combined perimeter 를 hole loop 로 사용 → ring + N holes.
- Multi-loop face 도구 정책 (ADR-016 Q2 그대로): Push/Pull / Boolean /
  Offset / hole boundary fillet → 거부 + Toast.
- 명시적 promote (`merge-as-hole`) 는 보조 op 로 유지.
- ADR-015 는 `Superseded by ADR-016`. ADR-016 single-promote 부분은
  `Superseded by ADR-021` (component-based promote).

### 2. ADR-007 Invariant 2 — Winding 일괄 강제
- 모든 face 의 `normal.dot(surface_normal_hint) >= 0` 보장.
- `align_face_with_neighbors` 결과와 **무관하게** 항상 hint 기준 검사.
- post-pipeline scan: degenerate (NaN/zero normal) 제거 + winding flip
  (touched_verts 위 boundary 가진 face 만).
- **시각 노출 정책 변경 (ADR-018)**: 사용자 동의로 "winding 시각 노출"
  원칙 폐기. Open mesh 의 sheet 는 양면 동일 white, closed solid 의 wall
  만 두 톤. Dev toggle "면 방향 표시" 로 legacy 모드 복원 가능.

### 3. M1 / Step 4.5 sub-face XIA Inheritance
- `run_mixed_cycle_splits` 의 sub-face 는 **원본 XIA** 에 inherit.
- `dissolve_and_fan_split` sub-face 도 동일 inheritance.
- 새 RECT 의 XIA 로 옮기지 말 것 (face_to_xia ↔ xia.face_ids 일관성).

### 4. dissolve_containing_faces Connector 정의
- True connector: 한 vert 는 outer-only, 다른 vert 는 inner-only.
- shared corner (양쪽 boundary 모두에 속함) 는 connector 가 아님.

### 5. 엔진 허용오차 정책 (사용자 정책 2026-04-27)
- Mesh 층은 **exact input** 만 처리. mm 단위 fuzzy snap 금지.
- 1.5μm spatial-hash dedup 만 허용 (f32 drift 흡수용).
- UI Snap (osnap) 이 정렬 책임 — 입력 단계에서 해소.
- `add_vertex_with_snap` 같은 mesh-level 허용오차 함수 추가 금지.

### 6. ADR-018 — Uniform Surface Render Policy (2026-04-29)
- **Open mesh 의 sheet face**: 양면 동일 white (#e8e8e8). BackSide 도
  frontMat 클론 사용 → lavender 절대 안 보임.
- **Closed solid 의 wall face**: 두 톤 유지 (외 #e8e8e8, 내 #9898b4).
  Cavity / 단면 가시화용.
- 판정: `volumeFlags[fid]` per-face. fallback (미가용) 은 모두 sheet
  (이전 모두 wall 회귀 수정).
- Dev toggle: `Viewport.setShowFaceOrientation(bool)`, StylePanel "면 방향
  표시 (디버그)" 체크박스. 기본 OFF.
- ADR-007 winding 정책 자체는 변경 없음 — 시각 노출만 정책 변경.

### 7. 바닥면 좌표 정확성 (사용자 요청 2026-04-28, 격상 2026-04-29)
- **ADR-026 P12** — Bridge 계층 SSOT (Single Source of Truth):
  - `WasmBridge.drawRect / drawLine / drawCircle / drawPolyline` 가 cardinal
    plane snap 의 단일 진실 원천
  - Normal 이 cardinal axis (`|n.{x|y|z}|>0.999`) + 좌표가 sub-tol (`<1e-3`)
    이면 정확히 0 으로 강제
  - 모든 도구 / 테스트 / 스크립트 호출 경로에 자동 적용
- **Defense in Depth**: LOCKED #7 의 도구별 snap (DrawRectTool /
  DrawCircleTool / DrawLineTool 의 첫 클릭 + projection 결과) 는 UI 단계
  방어선으로 유지. Bridge SSOT 는 마지막 방어선.
- 회귀 테스트: `WasmBridge.test.ts` 의 `describe('ADR-026 P12 cardinal plane
  SSOT')` 8 tests (절대 #[ignore] 금지).
- f32 ray-plane intersection ε 정밀도 손실 → 엔진 단계 누적 오차 차단.

### 12. ADR-025 — Closed Edge Cycle MUST Synthesize Face (P11, 2026-04-29)
- **새 원칙 P11 (사용자 강조)**: "닫힌 엣지에는 반드시 면이 생성되어야 한다."
- ADR-019 ("Line is Truth, Face is Byproduct") + ADR-021 P7 의 가장 강한 형태.
- 모든 draw 연산 종료 시점에 free edge (face=null) 로 형성되는 simple closed
  cycle 은 정확히 하나의 face 로 합성. 예외 없음.
- **Step 4.99 Final Sweep**: `run_face_synthesis_postprocess` 의 마지막에
  `resolve_planar_free_faces` 를 fixed-point loop 로 호출.
  - Step 4.5/4.6/4.9/4.95 가 놓친 sliver region mop-up.
  - 27-RECT 스트레스에서 31 orphans → 10 (68% 감소). 이전 단계만으로
    합성되지 않던 sliver region 대부분 처리.
- **잔존 한계 (별도 phase)**: 매우 복잡한 multi-ring 토폴로지 (얇은 crossing
  + 다중 nested ring + reverse winding RECT) 에서 일부 split edge 가 비-cycle
  토폴로지 (tree 형태) 로 남는 케이스. 현 resolver 의 leftmost-turn walker
  한계 — 별도 Phase 5 (M1 multi-ring resolver 강화) 필요.
- 회귀 방지: orphan_count 가 절대 증가하지 않도록 회귀 테스트 추가.
- **Phase 5 보강 (2026-04-29)**: DFS cycle finder 추가 (`mop_up_orphan_cycles_via_dfs`).
  resolve_planar_free_faces 의 leftmost-turn walker 가 dangling 가지 후 dead-end
  하는 케이스를 brute-force DFS 로 처리. 27-RECT 스트레스: 10 → 6 (60% 감소).
- **Phase 6 (2026-04-29)**: Strand absorption via `split_face_by_chain`.
  양 endpoint 가 같은 face 의 outer loop 위에 있는 strand 를 face 분할로 흡수.
- **Phase 7 (2026-04-29) STRICT**: closed-shape 명령 (DrawRect / DrawCircle) 의
  finalizer 에서만 dangling topological edge cleanup. DrawLine intermediate wire
  는 영향 안 받음. **27-RECT 스트레스: 6 → 0 orphans**. P11 원칙
  ("닫힌 엣지 = 반드시 면") **strict 보장 완료**.

### 11. ADR-024 — 3-Way Corner Chamfer (P10 MVP, 2026-04-29)
- **새 원칙 P10 (MVP)**: valence==3 vertex 의 corner 자체를 둥글게 처리.
  MVP 는 flat triangular chamfer (3 trim point + 1 triangle face).
- ADR-021 v1.1 known limitation "Fillet 3-way corner singularity" 해결.
- API: `Mesh::chamfer_vertex_3way(v, radius)` → `ChamferResult { trim_face,
  modified_faces }`
- 알고리즘:
  - 3 incident face 각각에서 v 의 두 인접 edge 방향 bisector 계산
  - P_i = v + radius * bisector_in_face_i (3 trim point)
  - 각 face 의 outer loop 에서 v → P_i 로 splice
  - 새 triangle face [P_1, P_2, P_3] 추가 (outward winding 자동 결정)
  - v isolated → 자동 제거
- Manifold invariant 보존 (`verify_face_invariants` 0 violations).
- **Future**: segments ≥ 2 시 spherical octant tessellation (별도 ADR).

### 10. ADR-023 — Bridge Topology, Endpoint-On-Hole-Boundary (P8, 2026-04-29)
- **새 원칙 P8**: 절단선 endpoint 가 hole boundary (vertex 또는 edge) 위에
  정확히 닿으면 그 점을 bridge target H 로 사용. Edge 위면 split_edge,
  vertex 위면 H = 그 vertex.
- ADR-021 v1.1 known limitation "Phase G case (c) endpoint-on-hole-boundary" 해결.
- Case D 는 case (c) BEFORE 에 dispatch — `point_inside_loop_3d` 가 boundary
  점에서 undefined 이라 case (c) 로 잘못 라우팅되는 회귀 차단.
- `try_find_hole_boundary_point` strict variant (closest-fallback 없음)
  로 정확한 분류 보장.
- 결과: 단일 면 (split 아닌 fuse), 다른 holes 는 inner 로 보존.

### 9. ADR-022 — Vertex-Shared Pinch Auto-Promote (P9, 2026-04-29)
- **새 원칙 P9**: 새 inner 의 outer-loop 가 container 의 기존 hole loop /
  sub-face 와 **1 vertex 만 공유** (pinch case) 시 자동 promote 허용.
- 2+ vertex 공유 → edge 공유 가능성 → 거부 (combined-perimeter 경로로 분리).
- ε-vertex doubling 은 **미구현** — 단일 vertex pinch 는 manifold 자연 보존.
  (DCEL 의 vertex valence 는 n-valent 허용, manifold 는 edge 단위로 정의됨.)
- Step 4.95 second-pass 의 simple-only container 제약 폐기 — ring 도 container.
- 기존 hole loops 는 rebuild 시 보존 (existing_hole_loops + new hole_loops).
- `b1_promote_safe` (interior fast-path) 도 동일 정책: shared_count ≤ 1 → allow.
- ADR-021 v1.1 known limitation "Connected Case B" 해결.

### 8. ADR-019 v2.1 — Line is Truth, Face is Byproduct (2026-04-29)
- **Line (Edge) 1급 정책** — 사용자 정의 P1-P6 + Claude 보강 A1-A5 + 운영 B1-B6.
- **Decision Summary**: Line is Truth. Face is Byproduct. Erase는 깨고
  다시 만든다. 모든 CCW 닫힌 경계는 면화한다. Ring/Hole 은 의도적 동작
  (그릴 때) 에만 형성한다.
- **자동 분할 (P4 / A3)**: 양 endpoint 가 같은 face boundary loop "위" +
  coplanar 1.5μm tolerance.
  - "boundary loop 위" 정의: vertex 일치 OR edge interior 위 + ε 이내
    (ε=1.5μm = LOCKED #5 spatial-hash dedup tolerance, B7).
- **Erase (P5/P6 통일 정책)**:
  - line 1개만 제거 → 다른 line 모두 상태 유지
  - 영향 region local re-resolve (B1) → 닫힌 CCW cycle 자동 면화 (A4)
  - CCW 판정 = surface_normal 기준 signed area 부호
  - 새 face 의 surface_normal 우선순위: 영향 face 평균 → epoch hint
    → 3-vertex 자동 추론 (6.2)
  - 재평가 시 ring topology 자동 형성 안 함 — draw 시점 conditional B1
    promote (ADR-016) 만 (B6)
  - Sibling 끊어짐 → ADR-016 §2 Path B (ring 수렴, inner 제거, wire 보존)
  - orphan wire 보존 (cleanup_dangling = false 항상)
- **Cascade (Shift+erase)**: 명시적 cascade 모드 유지 — Q2=b (B5).
  Undo-first UX 와 공존.
- **Centerline class (A1)**:
  - Move/Offset/Erase 도구 동작 가능
  - 절단/분할/면화/re-resolve 에는 불참
  - re-resolve 의 free-edge collection 에 미포함
  - storage / render 분리 ("별도 레이어") 는 ADR-020 별도 진행
- **Vertex**: edge endpoint 로만 존재, 1급 아님 (A2)
- **Wire ↔ face boundary**: 같은 Edge, face 인접 여부만 차이 (A5)
- **A6 (DrawLine closed loop)**: face interior 에 4 line 으로 닫힌 사각형
  그리면 sub-face 자동 합성 (DrawRect interior fast-path 와 동일 결과).
  endpoint dedup 시 postprocess 발동, resolver 가 cycle 합성.
- **EdgeId stability (B2-addendum, R5)**: vertex 변형 / 다른 erase 후
  잔존 edge → ID 유지. `split_edge` → 원본 비활성, sub-edge 모두 새 ID
  (현 구현 정합). ADR-017 격상 시 재검토.
- **Hover preview**: amber (default re-resolve) / red (Shift cascade) 2단.
  기존 cyan ("merge 가능") 의미 폐기. 새 cyan tint 의미 = "새 face 예측
  영역" 으로 재정의 (선택적 사용).
- **Render 정합 (6.5)**: 새 face 는 ADR-018 의 wall/sheet 분류 자동 적용.
- ADR-016 §2 erase table 일부 supersede (interior split fast-path →
  Path B 통일).
- ADR-008 Axiom 1 의 운영 명시화.

### 변경 시 필수 절차
이 정책들 중 하나라도 변경하려면:
1. 사용자에게 **명시적 확인** 요청 ("이 불변 정책을 변경하시겠습니까?")
2. 사용자가 동의한 경우에만 진행
3. 변경 시 새 ADR 작성 (기존 ADR 은 `Superseded by ADR-XXX` 표시)
4. CLAUDE.md 의 본 섹션 업데이트
5. 변경 사유 + 영향 범위를 commit message 에 명시

### 회귀 방지 테스트 (절대 #[ignore] 금지)

이 테스트들이 깨지면 위 불변 정책 중 하나가 위반된 것이다:
- `test_adr021_p7_case_a_inner_first_then_outer` (P7, 순서 무관성 — 신규)
- `test_adr021_p7_case_b_outer_first_then_inner` (P7, 순서 무관성 — 신규)
- `test_two_stacked_inner_rects_both_faced` (의미 변경: stacked 도 sub-face — ADR-021 통합)
- `test_column_of_inner_rects_all_faced`
- `test_all_rects_have_consistent_winding`
- `test_complex_overlap_no_missing_faces`
- `test_outer_with_overlapping_extending_rects`
- `test_outer_rect_drawn_after_inners_keeps_face`
- `test_draw_order_independence`
- `test_user_pattern_no_missing_faces`

ADR-019 구현 후 추가될 회귀 테스트 (절대 #[ignore] 금지):
- `test_p4_edge_added_on_face_auto_splits`
- `test_p5_erase_face_edge_keeps_other_lines`
- `test_p5_erase_creates_new_face_when_cycle_closes`
- `test_p6_adjacent_face_erase_creates_merged_face`
- `test_p6_drawing_order_independent`
- `test_a4_multiple_cycles_all_become_faces`
- `test_b5_shift_erase_cascades_unchanged`
- `test_b6_no_auto_ring_on_resynthesize`
- `test_xia_inheritance_preserved`

---

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

### 원-스텝 (권장, 2026-04-24~)
```bash
cd web
npm run build        # WASM build + verify + vite build
npm run build:wasm   # WASM만 (verify 포함)
npm run verify:wasm  # 산출물 무결성 검사만
```

### 수동 (디버깅 / CI 분리 시)
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
  wasm/axia_wasm.js                     — WASM 바인딩 JS (wasm-pack 자동 생성)
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
- **2026-04-24 업데이트**: 이전 경고 ("axia_wasm.js 수동 수정", "JSDoc `*/` 수동 추가") 는 현재 wasm-pack 0.14+ 기준 **더 이상 필요 없음**. `npm run build:wasm`이 자동 처리.
- `npm run build` 를 쓰면 WASM 빌드 + verify + vite build가 한 번에 됨. 중간에 실패하면 `npm run verify:wasm`으로 산출물 검사.
- 빌드 시 `--emptyOutDir false` 필수 (권한 오류 방지) — npm script가 자동 적용.
- Rust 툴체인이 없는 환경에서는 WASM 재빌드 불가 → JS/TS만 수정 가능.

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

## ADR-007: Face Orientation Policy (2026-04-20 제정)

**"Normal을 관리하지 말고, Winding만 지키면 모든 게 자동으로 따라온다"**

### 7가지 불변식 (Invariants)
1. **단일 진실** — 솔리드의 외부 = Front, 내부 face는 미생성
2. **전역 Winding** — CCW = Front (전 도구/로더/프리미티브 준수)
3. **Normal = 결과** — Topology에서 계산, 저장은 캐시일 뿐
4. **편집 중 Invariants 불변** — 모든 연산은 유효 상태 → 유효 상태
5. **Merge/Boolean 3단계** — 검증 → 자동 보정 → 명확한 실패 사유
6. **Front-only 렌더** — Single-sided 기본 (CAD 모드)
7. **Save/Load 정합성** — 직렬화 전후 invariant 검증

### 구현 요소
- `Mesh::verify_face_invariants() → InvariantReport`
  - I1~I5 위반 감지 (null loop / normal 불일치 / inner 유효성 / HE 소속 / non-manifold)
- `Mesh::debug_verify_invariants()` — `#[cfg(debug_assertions)]`에서 자동 실행
- 모든 편집 연산에 가드 삽입 (draw/push-pull/transform/offset/merge/flip/boolean)
- `Scene::export_versioned_snapshot_strict()` — 위반 시 Err 반환 (엄격 모드)
- WASM `exportSnapshotStrict` / `verifyInvariants` 노출
- Viewport `setSingleSidedRender(bool)` — CAD 모드 토글
- CommandInput `cadmode` / `mergetol` / `mergemat` 커맨드

### 감사 결과로 발견된 실제 버그
- **Sphere 폴 non-manifold**: u_segments개 vertex가 spatial hash로 dedup돼 한 엣지에 N개 face 공유 → 올바른 삼각형 fan 토폴로지로 수정 (16 face 공유 → 2 face 공유)

### 관련 ADR
- ADR-003: Geometric Validity Guards (선제 조건)
- ADR-005: Coplanar Merge는 순수 기하
- ADR-006: Multi-loop Face (Phase F 완료 — hole 지원)
- ADR-007: Face Orientation Policy (본 문서)

## Session 2026-04-20~21 완료 내역 (9 commits on claude/zealous-boyd)

이 세션에서 transform 도구 에지 지원·드로잉 평면 호버·면 병합 UX·면 분할 hole
지원이 쌓였다. 요약:

### Transform 도구 에지 지원
- **Rotate X/Y/Z 축 키** (`RotateTool.ts`) — CAD 3-click phase 어느 시점이든
  X/Y/Z를 눌러 축 전환. pick-target 중 전환 시 이전 축의 preview를 역방향으로
  되감고 새 축으로 재적용. modifier 키(Ctrl/Alt/Shift/Meta) 있으면 무시.
- **에지 이동/회전/스케일** (`MoveTool`/`RotateTool`/`ScaleTool`) — 면이 없고
  에지만 선택된 경우 각 에지 엔드포인트를 정점 집합으로 모아서 (중복 제거)
  `translateVerts` / `rotateVerts` / `scaleVerts`로 위임. 면과 에지가 같이
  선택되면 면이 우선.
- **Rust `scale_verts`** (`axia-geo/operations/transform.rs`) — 기존
  `rotate_verts`와 동일 패턴: 정점 이동 → 인접 면 법선 재계산 → ADR-003
  degenerate 체크 → ADR-007 invariant 검증. WASM `scaleVerts` 바인딩 + 단일
  undo transaction + iterative constraint resolve. ScaleTool의 per-vertex
  `translateVerts` 루프가 단일 `scaleVerts` 호출로 단순화됨.

### 드로잉 평면 호버 인디케이터
- **`DrawPlaneIndicator.ts`** (viewport 전용) — Line/Rect/Circle/Arc/Freehand/
  Bezier 도구가 활성화되고 드로잉 중이 아닐 때, 커서 위치에 RGB 축 gizmo +
  반투명 평면 패치를 표시. 면 위 = 파랑, 지면/기본 = 회색.
- **ToolManager 통합** — mousemove에서 RAF-throttle (프레임당 1회 `viewport.pick`
  + `getDrawPlane`). 도구 전환·mouseleave·드로잉 시작 시 자동 숨김.
- three.js mock에 `PlaneGeometry`, `Quaternion`, `Color.setHex`, `Object3D
  .quaternion/renderOrder` 추가해 헤드리스 테스트 지원.

### Face auto-merge 대규모 개선 (Erase tool)
이전엔 여러 엣지 드래그 삭제 시 엣지마다 개별 `mergeFacesByEdge` 호출 →
undo가 엣지 수만큼 필요. 현재:
- **`batch_erase_edges_with_merge(faces, edges, tol, cascadeOnly)`** (Rust WASM)
  — 단일 트랜잭션으로 edge별 merge-or-cascade 처리. `[merged, cascadedFaces,
  cascadedEdges]` 반환. Ctrl+Z 한 번에 전체 원복. 첫 merge 실패 사유는
  `lastMergeFailureReason`로 조회 가능 (debug용).
- **Shift modifier** — Shift를 누르고 삭제하면 `cascadeOnly=true` 전달,
  coplanar 면 병합 없이 cascade-delete.
- **Tolerance UI slider** (`SettingsPanel.ts`) — 0~10° 각도 허용치 + 재질
  경계 존중 체크박스. `MergeSettings.ts`의 `setMergeTolerance`/`setRespect
  Material`과 localStorage 연동.
- **Hover 병합 미리보기** — `previewEdgeEraseMerge(edgeId, tol)` WASM dry-run
  → 병합될 엣지는 청록색(`MERGE_PREVIEW_COLOR`) + 두 면 청록 tint;
  cascade-delete될 엣지는 빨간색 유지. Shift hover는 cascade 예보.

### Phase G — split_face_by_line hole 지원
Phase F는 hole이 있는 면의 line split을 명시적으로 거부했다. Phase G로 대부분의
실용 케이스 해결:

- **Case (a)**: 절단선이 outer 내부에 있고 어떤 hole도 건드리지 않음 — 가장
  흔한 경우. hole들은 기하학적 포함 관계로 두 결과 면에 자동 재분배.
  `point_in_face`로 분류 → face_b로 이동하는 hole은 HE의 face 포인터까지 재할당.
- **Case (b)**: 절단선이 hole 경계를 관통 — hole이 "먹힘". Phase G2로 일반화:
  - N개 hole 동시 관통 지원
  - 각 hole의 2 교차점을 `split_edge`로 실현
  - cut 방향으로 (h_a, h_b) 쌍 정렬 및 hole들 간 정렬
  - `arc_natural` 순회로 face_1/face_2 정점 리스트 구성
    (natural CW hole + natural CCW outer 조합이 CCW winding 보장)
  - `remove_face` + `add_face_with_holes` 2회 → 새 cut 엣지 자동 생성
  - 미접촉 hole은 2D point-in-polygon으로 재배치
- **Case (c) endpoint-inside-hole**: 여전히 거부 (bridge topology 미구현)

구현 파일: `axia-geo/operations/face_split.rs`. 새 헬퍼:
`classify_holes`, `find_loop_crossings_3d`, `split_face_case_b`, `arc_natural`,
`loop_basis`, `project_to_basis`, `segments_cross_2d`, `point_in_polygon_axis_2d`,
`reassign_loop_face`, `find_hole_edge_containing`.

테스트 8개 신규: `phase_g_split_above/below_hole`, `phase_g_preserves_hole_
vertex_count`, `phase_g_rejects_endpoint_inside_hole`, `phase_g2_hole_split_
consumes_hole`, `phase_g2_hole_split_both_pieces_closed`, `phase_g2_cut_one_
hole_preserves_other`, `phase_g2_cuts_through_two_holes`.

### 발견된 버그 / 고친 것
- `split_edge`가 loop의 start HE를 회전시킬 때 저장해둔 `loop_ref.start`가
  stale이 됨 → 각 split 사이에 `mesh.faces[face_id].inners()[i].start`로
  재조회.
- ScaleTool 에지 경로가 초기엔 per-vertex `translateVerts` 루프였으나 Rust
  `scale_verts` 추가 후 단일 호출로 교체 → undo 엔트리 수가 정점 수에서 1로.
- EraseTool 테스트 mock에서 `e.shiftKey === undefined` 이슈 → `=== true` 비교로
  boolean 강제.

### 통계
- Rust 테스트: 186 → 194 (hole-aware split 8개 추가)
- TypeScript 테스트: 945 → 950 (Erase Shift/hover-preview 등 +5)
- 전체 Vite build 정상
- 원격 백업: `origin/claude/zealous-boyd` ← `240c5e5`까지 푸시 완료

## Session 2026-04-21 완료 내역 (12 commits, Tier 1~3 순차 진행)

이 세션은 "선/면/볼륨 파이프라인 강화 + UX 도약"이 테마. Ontology v1.2
문서를 기준으로, XIA 승급은 미루고 Geometry Layer 성숙도에 집중.

### Tier 1 (즉시 임팩트)
- **1A Boolean 재검증** — Phase G hole-aware split 이후 Boolean의 명시적
  hole 거부가 회귀 없이 작동함을 증명하는 regression test 2개 추가
  (`boolean_rejects_face_with_hole`, `..._either_operand`).
  TS BooleanHandler의 `alert()` → Toast 전환, 한국어 우회 안내
  ("구멍 없는 면 선택", "구멍 합치기 역해제").
- **1B Shell/Thicken** — push_pull CreateFace 모드 재활용, `thicken-faces`
  액션 신설 (다중 면 순차). 우클릭/메뉴 항목.
- **1C Loop Select** — Rust `Mesh::collect_edge_chain` (valence-2 vertex
  따라 폴리라인 BFS, 교차점/dead-end에서 정지). 보조 메서드
  `count_incident_edges`, `other_edge_at_valence2` (v_next 방사형 순회).
  WASM `collectEdgeChain` + `SelectTool` Alt+edge 클릭 → 자동 체인 선택.

### Tier 2 (파이프라인 성숙)
- **2D Solidify 🧩** — Rust `meshManifoldInfo()` WASM 바인딩 (전역 활성
  면 manifold 분석 JSON). `solidify` 액션: 이미 닫힘 / non-manifold /
  boundary>0 3단계 자동 판정 + synthesize 실행 후 재검사.
- **2E Edge Bevel** — `fillet-edge`가 선택된 모든 엣지에 순차 적용.
  3-way corner는 구조적 한계 → 실패 수 집계 + 첫 에러 메시지.
- **2F Mesh Repair 🩹** — ADR-007 Phase H `normalize_for_import`을 사용자
  액션으로 노출. Before/After manifold 비교 + 4항목 한국어 요약.

### SSAO MSAA 엣지 선명도 복원 (긴급 수정)
- **증상**: 강아지/고양이 씬 그리고 나서 엣지가 흐릿.
- **원인**: `EffectComposer`의 기본 `WebGLRenderTarget`이 `samples=0`이라
  renderer.antialias:true가 무시됨. SSAO 기본 ON이라 모든 씬이
  composer 경로 통과 → 복잡한 씬일수록 aliasing 드러남.
- **수정**: `new EffectComposer(renderer, rt)` + `WebGLRenderTarget`
  `{ type: HalfFloatType, samples: 4 }`. HDR 톤매핑 정확도 유지.

### Tier 3 (장기 효용 MVP)
- **3A Sketch Mode ✏️** — 건축 평면도 → Push/Pull 워크플로우:
  - `ToolManager._sketch`: { label, origin, normal, up } 세션 상태
  - `enterSketch` / `exitSketch` / `isSketching` / `getSketchInfo` API
  - `getWorkPlane` / `get3DPoint` / `getDrawPlane` 오버라이드 → 활성
    시 모든 드로잉이 고정 평면에 투영
  - `Viewport.setSketchPlaneVisual`: 10m × 10m 반투명 amber 패치 +
    대시 경계선 (renderOrder 1002, depthTest:false)
  - 액션: `sketch-start-xz/xy/yz/face`, `sketch-exit`
  - **자동 Finish → Synthesize → Extrude**: `sketch-exit` 시 free edge
    감지 → 닫힌 프로필 자동 면화 → 높이 prompt → 즉시 pushPull
  - **Constraint Panel 자동 열기**: enterSketch에서 J 패널 show()
  - **상태바 배지 #sb-sketch-badge**: 오렌지→초록 색상으로 free edge
    카운트 표시 ("✏️ XZ 바닥 · 4 free" → "✏️ XZ 바닥 · ready")
- **3B Parametric History 🕒 (Phase 1 MVP)**:
  - `web/src/core/OperationLog.ts` — ring buffer (cap 50), singleton.
  - 기록 대상: fillet / chamfer / thicken / array-linear / array-radial /
    subdivide. 리스너 기반 UI 갱신.
  - `web/src/ui/HistoryPanel.ts` — Shift+H 단축키. "재실행…" 버튼이
    마지막 값으로 prompt pre-fill → 현재 선택에 적용.
  - `ToolManager.rerunLoggedOperation(kind, params)` — switch-per-kind
    직접 실행 (full feature tree는 Phase 2).
- **3C STEP/IGES Phase B**: 명시적 "지원 예정" 안내 + FreeCAD/Fusion/
  Rhino 변환 대안 메시지 (OCCT.js 통합은 별도 Phase A 세션).

### 도구 메뉴 확장
- 수정 메뉴: Thicken / Array Radial / Quick Color
- 뷰 메뉴: Measure Tool (U) / 작업 기록 패널 (Shift+H)
- Sketch submenu (XZ/XY/YZ/선택 면/종료)

### Line2 기반 엣지 선명도 개선
- Mesh edge 렌더링을 `LineBasicMaterial + LineSegments`에서
  `LineMaterial + LineSegments2`로 교체. Line2의 linewidth는 WebGL
  1px 한계 없이 실제 CSS pixel 굵기 지원, DPR 무관 일관된 선명도.
- `_meshEdgeMaterials: LineMaterial[]` 캐시로 resize + 굵기 변경 O(N) 빠른 업데이트.
- StylePanel의 기존 "edge width" 슬라이더를 `viewport.setEdgeStyle({ width })`
  와 연결 (이전엔 label 텍스트만 갱신).

### 통계
- Rust 테스트: 194 → 243 (+49)
  - Boolean hole-rejection 2개
  - Array Radial 2개
  - Edge chain 3개 (polyline / junction-stops / closed-loop)
  - 기타 fillet/deform 회귀 일체 유지
- TS 테스트: 950 → 993 (+43)
  - BooleanHandler Toast 재작성 (11개)
  - SelectTool Alt+edge 체인 2개
  - MeasureTool / thicken / array-radial / solidify 간접 커버
  - OperationLog 5개
  - Sketch Mode state machine 7개 (entry/exit, XY/XZ/YZ normal, visual,
    finish→extrude 분기)
  - FileImporter STEP/IGES 5개
- Production build 정상 (252KB 초기 번들 유지)
- 원격 백업: `origin/claude/zealous-boyd` ← `d5686f7` 이상까지 푸시 완료

### Known limitations (이 세션에서 의도적으로 남긴 것)
- Parametric History는 downstream 자동 재계산 없음 — Phase 2 CommandGraph에서
- Sketch Mode의 edge tagging은 전역 free-edge 기반 (스케치 세션별 태깅은
  Rust SketchSession 필요)
- Fillet 3-way corner (같은 vertex 공유 다중 엣지) 미해결 — 별도 작업
- STEP/IGES OCCT.js 통합 미구현 — 10MB+ 번들 검토 필요

## 메타-원칙 (#1~#13, ADR-014 까지 통과)

설계 결정 시 참조하는 13개 메타-원칙. 자세한 출처는
`docs/adr/README.md` 참조.

| # | 원칙 | 축 |
|---|------|-----|
| 1 | 기존 명령은 모두 그대로 | 호환 |
| 2 | 외부 참조는 형태/모양만 | 호환 |
| 3 | 상태바는 보호 | UX |
| 4 | 단일 진실 원천 (SSOT) | 일관성 |
| 5 | 사용자 편의 최우선 (명확하면 자동, 모호하면 명시 동의) | UX |
| 6 | Preventive over Curative | 안정성 |
| 7 | Topology > Cache | 일관성 |
| 8 | 즉각 반응 > 완전성 | UX/성능 |
| 9 | 회귀 없음 (테스트 통과 후 커밋) | 품질 |
| 10 | ADR 불변 (변경 시 새 ADR + Superseded) | 거버넌스 |
| 11 | **Latency Budget First** (Hover 16/Click 33/Commit 100/Heavy 500 ms) | 성능 |
| 12 | **Memory Budget Per Entity** (모든 자료구조 cap 강제) | 메모리 |
| 13 | **One Source, Two Views** (Rust=truth, JS=view, cache 휘발성) | 메모리/일관성 |

## Session 2026-04-28 완료 내역 (11 commits — RECT 면 합성 정책 정비)

이 세션의 테마: 사용자 보고로 시작된 RECT 면 합성 회귀 (winding flip,
missing face, shadow rendering, stacked-inner) 를 ADR-015 신설 + 코드
경로 audit 으로 근본 해결.

### ADR-015: Stacked Inner RECT — Manifold-First B1 Policy

**ADR-008 Axiom 7 ↔ Phase E B1 hole-promote 충돌 해소.**

- B1 auto hole-promote **비활성** (interior fast-path + Step 4.8 + 4.95).
- inner face 가 outer face 안에 그려져도 자동 ring 변환 안 함.
- 두 face 가 별개 simple face 로 공존 (geometric overlap 허용).
- 명시적 promote 는 우클릭 메뉴 `merge-as-hole` 로만.
- 결과: 인접 inner RECT (stacked) 자연스럽게 작동, manifold 보장.

자세한 결정/근거: `docs/adr/015-stacked-inner-rect-topology.md`

### 발견한 root cause (11개)

| # | 영역 | 수정 |
|---|------|------|
| 1 | M1 mixed-cycle | `split_face_by_chain` winding flip — projection plane 기준 signed area pre-check + reverse |
| 2 | Step 4.55 | `dissolve_containing_faces` shared corner 오판 — true connector 정의 강화 (한쪽은 outer-only, 한쪽은 inner-only) |
| 3 | **ADR-015** | B1 auto hole-promote 비활성 |
| 4 | exec_draw_line | `align_face_with_neighbors` 결과 무관 항상 `surface_normal` hint 검사 |
| 5 | post-pipeline | NaN/zero normal degenerate face 제거 + winding 일괄 강제 |
| 6 | M1 split | sub-face 가 ORIGINAL XIA inherit (이전엔 새 RECT XIA 로 잘못 이전) |
| 7 | Step 4.5 | `dissolve_and_fan_split` 도 동일 inheritance 패턴 |
| 8 | post-pipeline | 검사 범위 broadening — touched_verts 위 모든 active face + degenerate 는 전역 scan |
| 9 | RECT tool (TS) | 바닥면 (cardinal plane) 좌표 정확히 0 으로 snap — mouse pick 의 ε 정밀도 한계 흡수 |

### 새 회귀 테스트 (axia-core, +30 가까이 추가)

`scene::tests` 에 추가된 stress test:
- `test_overlapping_rects_*` — partial / corner overlap
- `test_three_overlapping_rects_no_missing_cell` — 3-RECT 중첩
- `test_nested_plus_side_rect_no_flipped_normal` — winding regression
- `test_lshape_with_inner_rects_all_faced` — L-shape + inner
- `test_2x2_grid_all_faces_synthesize` — 2×2 grid
- `test_multi_rect_stress_no_missing_cells` — 5 구성 stress
- `test_two_stacked_inner_rects_both_faced` — ADR-015 핵심 케이스
- `test_column_of_inner_rects_all_faced` — 5-RECT vertical stack
- `test_collinear_adjacent_rect_synthesizes`
- `test_adjacent_rect_face_synthesizes`
- `test_rect_sharing_two_existing_edges_synthesizes`
- `test_rect_with_all_existing_edges_creates_face`
- `test_complex_overlap_no_missing_faces` — 9-RECT 복잡 overlap
- `test_outer_rect_preserved_after_many_inners`
- `test_outer_rect_drawn_after_inners_keeps_face`
- `test_outer_with_overlapping_extending_rects`
- `test_all_rects_have_consistent_winding`
- `test_user_pattern_no_missing_faces` — 사용자 화면 reproduction
- `test_deeply_nested_rects_all_have_faces`
- `test_partial_overlap_no_degenerate_faces` — 6 가지 overlap 구성
- `test_outer_with_two_partial_overlap_inners`
- `test_draw_order_independence` — 그리기 순서 무관성
- `test_enclosing_outer_after_overlapping_inners`
- `test_outer_edge_coincides_with_inner_edge`
- `test_very_large_outer_after_small_inners`
- `test_outer_edge_collinear_overlap_with_inner`

### ADR 정합성 회복

- **ADR-007 Invariant 2 (Winding)**: 모든 face CCW 강제 — neighbor 의존
  alignment 가 잘못된 방향으로 propagate 되는 케이스 차단.
- **ADR-008 Axiom 1 (Face = byproduct)**: 토폴로지가 그리기 순서에 무관
  하게 deterministic — `test_draw_order_independence` 로 검증.
- **ADR-008 Axiom 2 (RECT = 4 LINEs)**: per-line + epoch 처리 일관.
- **ADR-008 Axiom 7 (Adjacent shared edge)**: ADR-015 로 정합 (B1 비활성).

### 통계

- Rust 테스트: 288 (axia-geo) + 67 (axia-core, +30) + 2 (transaction) = **357 passed**
- TypeScript 테스트: **1156 passed** (69 files)
- 회귀: 없음
- 신규 ADR: ADR-015
- WASM 재빌드: ✓

### 사용자 측 영향

- 인접 inner RECT 가 자연스럽게 작동 — gap 두기/4-LINE 우회 불필요.
- 모든 face 일관된 winding (gray front-side 렌더).
- 바닥면 RECT 가 정확히 z=0 에 위치 — 후속 z-search/sort 안정.
- Trade-off: outer 의 hole 영역 자동 인식 안 됨 (push/pull 시 명시 처리).

## 향후 과제
- Phase G case (c): endpoint-on-hole-boundary "bridge" topology
- Material / Texture (텍스처 이미지 매핑 미구현)
- STEP/IGES 지원
- Electron/Tauri 데스크톱 앱
- Boundary Extraction (Solid → Face)
- Worker thread / GPU picking (ADR-012 강등 정책 트리거 시)
- ADR-010~013 시리즈 구현 (Sprint 2~6)
