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

#### 1-amendment (2026-05-05) — ADR-051 Strict Reaffirmation
- **ADR-021 P7 v1.0 의 canonical statement 보존**. 본 amendment 는
  policy 변경이 아닌 **측정 도구 추가 + 회귀 봉인** 명시.
- **ADR-051 P-1** (commit `e1f54f1`) — `verify_p7_manifold(mesh, container,
  inners) -> P7ManifoldReport` 함수 추가 (axia-geo). P7-M1 / P7-M2 /
  P7-M3 named invariants 명시 검증:
  * P7-M1: shared edge 의 active face-bearing HE 수 = 2 (3+ → violation)
  * P7-M2: hole loop edge 가 container 를 incident face 로 포함
  * P7-M3: non-shared boundary edge HE 분포 canonical
- **Phase 5/6/7 호출 순서 정정** (prior commits 누적, 2026-05-04 자연
  완료) — `run_face_synthesis_postprocess` 의 ring rebuild → mop-up →
  absorb 순서 정합. burge.xia drift evidence (2026-05-02) 자연 정정.
- **ADR-051 P-2** (commit 본 commit) — 기존 P7 canonical 회귀
  (`test_p7_canonical_stacked_inner_manifold` /
  `test_p7_canonical_disjoint_inner_multi_hole`) 에 verify_p7_manifold
  명시 검증 추가 + 신규 sweep test (`test_p7_canonical_sweep_locked_
  scenarios`) 로 LOCKED #1 시나리오 3건 (disjoint / single inner /
  outer-after-inners 그리기 순서 무관성) 일괄 봉인.
- **Deferred boundary**: connected stacked-inner 의 1 non-manifold
  edge (shared y=0 boundary) 는 ADR-051 §2.5 의 component-merge
  resolver 작업으로 별도 ADR 진행 — 본 LOCKED 영역 외 future work.
- **회귀 방지 테스트 강화** (절대 #[ignore] 금지):
  * `test_p7_canonical_stacked_inner_manifold` — verify_p7_manifold
    violations ≤ 1 (deferred boundary)
  * `test_p7_canonical_disjoint_inner_multi_hole` — strict 0
  * `test_p7_canonical_sweep_locked_scenarios` — 3 시나리오 모두
    is_valid()
  * `test_p7_canonical_burge_centered_scenario_no_violations` — fixture
    + 3 centered cases 0 nm
  * 기존 LOCKED #1 회귀 11건 모두 PASS 유지

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

### 13. ADR-035 — STEP/IGES Hybrid Strategy (P20, 2026-04-30)
- **Stage 4-A (즉시)**: OCCT.js 동적 로딩 옵션 플러그인. 메인 번들 영향 0
  (initial bundle 0MB 증가 강제 — P20.C #2).
- **Stage 4-B (병행)**: `axia-foreign` 자체 crate STEP AP203 / IGES 5.3 파서
  spike (zero-deps).
- **12개월 default 결정**: 5-트리거 정량 매트릭스 (커버리지 ≥80% / 정확도
  ≤1e-3 mm / LOC<8000+bug≤3분기 / 번들 절감 ≥8MB / NPS ≥7).
- **Format priority** (P20.A): AP242 primary, AP203/AP214 secondary, IGES
  legacy. AP238 / IFC 별도 ADR.
- **Non-goals** (P20.B): Export, Assembly hierarchy, PMI/GD&T, Material
  metadata, Drawing views — Stage 4 제외.
- **검증 코퍼스** (P20.D): 공개 (NIST 2 + OCCT) + 벤더별 1개씩
  (SolidWorks/Fusion/CATIA) + 사용자 제공 (선택).
- **결재 포인트**: P20.5 라이선스 호환성 (LGPL/FOSS exception ↔ AXiA),
  P20.7 Stage 4-A 구현 착수 (✅ 승인 완료 2026-04-30, scaffolding 적용).

### 14. ADR-036 — STEP/IGES Curve & Surface Promotion (P21, 2026-04-30)
- **P21 Precision-First Promotion**: BRep parametric definition 은 항상
  AnalyticCurve / AnalyticSurface variant 로 직접 매핑 후 attach.
  Tessellation 은 fallback 일 뿐 truth 가 아님 (메타-원칙 #13 적용).
- **P21.1 Curve 매핑 11항목**: Direct 6 (Line/Circle/Arc/Bezier/BSpline/
  NURBS) + Conic 변환 3 (Ellipse/Parabola/Hyperbola, Piegl A7.1/4/5) +
  Fitting 1 (OffsetCurve) + TrimmedCurve.
- **P21.2 Surface 매핑 12항목**: Direct 8 (Plane/Cylinder/Sphere/Cone/
  Torus/BezierSurface/BSplineSurface/NURBSSurface) + Sweep 2 (Revolution/
  Extrusion, Piegl A8.1/2) + Fitting 1 (OffsetSurface) + Trim 1
  (RectangularTrimmedSurface).
- **P21.5 Parameter range 정합**: OCCT trim range ↔ AnalyticCurve range
  매핑 규약. CurvePromotion 모든 variant 에 `parameterRange?` optional.
- **P21.6 라운드트립**: 5 코퍼스 양방향 < 1e-3 mm 검증.
- **P21.7 실패 처리**: 6 case (DownCast 실패 / 변환 정확도 미달 / fitting
  tolerance 초과 / rational NURBS surface SSI / PCurve missing /
  self-intersection) → ImportResult.warnings 누적.
- **P21.8 Stage 4-A / 4-B 일관성 강제**: 두 경로 동일 매핑 enum 재사용
  → cross-validation type-safe.
- **uvBounds (P21.2)**: SurfacePromotion 모든 variant 에 optional
  `uvBounds?: [umin, umax, vmin, vmax]` — RectangularTrimmedSurface +
  Phase G2 trim_loops 동기화.
- **occt.js Handle 래핑 함정**: `occt.Handle_Geom_*::DownCast(handle)?.get()`
  + `IsNull?.()` chain 일관 적용. NCollection_Array2 base footgun 우회는
  `Pole(i, j)` / `Weight(i, j)` 직접 accessor 패턴 사용.
- 회귀 방지 테스트:
  - `SUPPORTED_CURVE_KINDS` ↔ ADR-036 P21.1 11항목 정합
  - `SUPPORTED_SURFACE_KINDS` ↔ ADR-036 P21.2 12항목 정합
  - 매핑 표 갱신 시 본 테스트가 깨짐 → ADR ↔ 코드 drift 차단

### 15. ADR-037 — Pick → Promote 원칙 (P22, 2026-05-01)
- **새 원칙 P22**: 모든 raycast 결과는 즉시 owner ID (EdgeId / FaceId /
  VertexId) 로 promote 후 저장. segment / triangle index 를 selection
  state 에 저장 금지. highlight / hover / preview 모두 owner ID 기준.
- **P22.1 Selection state schema**: `selectedFaces / selectedEdges /
  selectedVertices` 의 원소는 항상 의미 ID. raw index 거부.
- **P22.2 Tessellation 메타데이터**: `Viewport.faceMap: Uint32Array`
  (triangle → FaceId), `ctx.edgeMap: Uint32Array` (segment → EdgeId).
  길이 = geometry tri/seg 수와 정확 일치.
- **P22.3 Topology rebuild 강제**: split_edge / merge_faces_by_edge /
  Boolean / Push-Pull / Erase / Draw / STEP-IGES import 후 faceMap /
  edgeMap 재구축 필수. stale 차단.
- **P22.4 Highlight by owner ID**: 같은 EdgeId / FaceId 의 모든
  drawable 동시 강조. "hit 된 한 triangle 만 강조" 절대 금지.
- **P22.5 분석적 곡선 균일 promotion**: `Edge.curve = Some(...)` 인 edge
  의 N segments 모두 동일 EdgeId 로 promote. 회귀 테스트로 강제.
- **P22.6 디버그 모드 분리**: 사용자 UI 의 기본 동작은 owner 단위 only.
  facet/segment 별 선택은 `__AXIA_DEBUG_FACET_SELECT = true` 토글 전용.
- **P22.7 STEP/IGES import 통합**: Stage 4-A/4-B 의 promote_curve /
  promote_surface 결과도 P22 적용. import 직후 metadata rebuild.
- 회귀 방지 테스트:
  - `selection_promotes_curve_uniformly` — circle 의 모든 segment 가
    같은 EdgeId 로 promote
  - `selection_state_contains_owner_ids_not_indices` — selection state
    의 원소는 valid EdgeId/FaceId 만
  - `metadata_rebuilt_after_topology_change` — split/Boolean/draw 후
    stale 차단

### 16. ADR-038 — Surface-Aware Normals (P23, 2026-05-01)
- **새 원칙 P23**: tessellation vertex 의 normal 우선순위 — (1) Analytic
  surface evaluate, (2) DCEL fan averaging, (3) per-triangle flat 절대
  금지.
- **Step A 진단** (commit 전 측정, ADR-038 정량 근거):
  - Rust `Mesh::export_buffers` (mesh.rs:3272-3413) — 현재 face
    평면 normal + DCEL fan averaging (within `EDGE_VISIBILITY_ANGLE_DEG
    = 20.1°`). `tessellate_face_surface()` 가 mesh.rs:446 에 존재하지만
    export 에 통합 안 됨.
  - WASM `getMeshBuffers` — per-vertex layout, face 별 vertex 분리
    (라인 3410 `vert_offset += positions_3d.len()`).
  - Three.js `Viewport.smoothNormals` (Viewport.ts:1426-1485) — 위치
    기준 vertex 용접 (P=0.01mm) + angle threshold 기반 hard edge cull.
    Rust normal 을 덮어씀.
  - **Threshold 불일치 발견**: Rust 20.1° vs Three.js 30° (Viewport.ts:984).
- **P23.1 Analytic evaluate 통합**: `Face.surface = Some(...)` 면
  `AnalyticSurface::tessellate(chord_tol)` 의 결과 (positions + 정확
  normal) 사용. `tessellate_face_surface()` API 가 이미 존재 — 통합만
  남음.
- **P23.2 Tessellation chord tolerance**: default 0.1mm. LOD 는 별도
  phase.
- **P23.3 Edge visibility angle SSOT**: WASM 이 `getEdgeVisibilityAngleDeg()`
  export. Three.js 가 hardcode `30` 대신 bridge 호출. 단일 truth
  (Rust tolerances.rs:106).
- **P23.4 Three.js 가 Rust 결과 존중**: analytic evaluate 한 vertex 는
  smoothNormals 가 덮어쓰지 않음. flag 기반 선택적 skip.
- **P23.5 Analytic vertex 의 정확한 normal**: `∂S/∂u × ∂S/∂v` evaluate.
  averaging 없음 — 산업 CAD 보다 정밀.
- **P23.6 Selection highlight 일관성** (ADR-037 P22.4 cross-link): owner
  ID 기준 highlight + analytic normal 결합 → 매끈한 곡면 highlight.
- **P23.7 회귀 테스트** (절대 #[ignore] 금지):
  - `analytic_sphere_face_emits_evaluated_normals` — vertex normal =
    (vertex - center).normalize() 1e-6 일치
  - `analytic_cylinder_face_emits_radial_normals` — axis 수직 + radial
  - `planar_face_uses_dcel_averaging_unchanged` — regression guard
  - `edge_visibility_angle_threshold_matches_rust_and_ts` — WASM /
    Rust SSOT 일치

### 17. ADR-039 — Hover & Preselect Owner-ID Unification (P24, 2026-05-01)
- **새 원칙 P24**: hover / preselect 도 Pick → Promote 적용. mousemove
  결과의 raw hit 는 즉시 owner ID (EdgeId/FaceId) 로 promote 후 저장.
  ADR-037 P22 의 자연 연장.
- **P24.1 HoverTarget tagged union 강제**: `{ kind: 'edge', id } |
  { kind: 'face', id } | null` — `EdgeId | FaceId` 둘 다 number 라
  컴파일 타임 구분 안 됨, kind discriminator 필수.
- **P24.2 Stickiness invariant**: 동일 owner 면 hover state 변경 0.
  BVH 1px jitter 자연 흡수. "파르르 떨림" 차단.
- **P24.3 Hover lifecycle 6 케이스**: mouseleave / empty space / tool
  변경 / drag 시작 freeze / modal open / ESC → 모두 clear.
- **P24.4 Edge / Face 우선순위**: 기존 `pickEdgeOrFace` 의
  `preferEdgeWithinPx` 유지 — 결과만 owner ID 로 promote.
- **P24.5 시각 규칙 분리**: hover 두께 70%, hover 색 연함, z-order
  selection 보다 아래. transition 시 시각 점프 없음.
- **P24.6 selected ⊃ hover 일관성**: hover 0 또는 1개, selection 0..n.
  중복 시 selection 색만 표시 (hover 가려짐).
- **P24.7 AnalyticCurve 정밀도**: 별도 ADR-040 으로 분리. 본 ADR 은
  segment-tessellation hover promote 까지.
- **P24.8 회귀 테스트** (절대 #[ignore] 금지):
  - `hover_circle_sweep_no_breaking` — 원 sweep 시 hovered 변화 0
  - `hover_jitter_1px_stable_owner_id` — 1px 흔들림 → 변화 0
  - `hover_clears_on_tool_change`
  - `hover_clears_on_mouseleave`
  - `hover_owner_id_matches_click_result` — 같은 위치 hover ↔ click 일치
  - `multi_curve_hover_switches_owner_correctly`

### 18. ADR-040 — AnalyticCurve Distance Hover (P25, 2026-05-01)
- **새 원칙 P25**: `Edge.curve = Some(AnalyticCurve)` 인 edge 의 hover
  거리는 polyline tessellation 이 아닌 곡선 자체에 대해 측정. 정확한
  closed-form / Newton 기반 distance.
- **P25.1 우선순위**: Analytic curve evaluate → polyline BVH fallback →
  null hover
- **P25.2 Curve 별 distance**: Line (cross product 3D), Circle (projection
  + radial), Arc (+ angle clamp), Bezier/BSpline/NURBS (Newton on
  `|R(s) - C(t)|²` minimization)
- **P25.3 Screen-space threshold**: 12px (산업 표준), cursor depth 기준
  world distance 변환
- **P25.4 Fallback**: Newton 발산 / NaN → polyline BVH (warning 누적)
- **P25.5 Performance**: 2-stage — BVH 후보 edges + analytic 거리 refine
  (~100x 감소)
- **P25.7 4 회귀 테스트**:
  - `analytic_circle_hover_perfect_radius_distance` — polyline gap 흡수
  - `analytic_arc_hover_outside_arc_range_misses` — angle clamp
  - `polyline_fallback_when_analytic_diverges`
  - `screen_threshold_independent_of_camera_distance`
- **Migration 4-stage**: Rust API (`ray_to_curve_distance`) → TS bridge
  (`pickEdgeAnalytic`) → Tool integration → 회귀 테스트. 본 ADR 은
  결정 고정만 — 실제 코드는 별도 PR.

### 19. ADR-041 — AxiA MCP Surface (Capability-Sandboxed) (P26, 2026-05-02)
- **새 원칙 P26**: MCP 가 노출하는 엔진 API 는 명시적 whitelist
  (CapabilitySurface) 로만 한정. 새 capability 추가 = 새 ADR. schema_version
  검사로 engine/server mismatch 즉시 거부.
- **P26.1 4-tier Capability Surface** (32 capabilities total):
  - Tier 0 (read, always-on, 7) — get_scene_summary / list_xias /
    get_face_info / ...
  - Tier 1 (constructive, default-on, 10) — draw_rect / draw_circle /
    create_xia / export_axia / export_obj / ...
  - Tier 2 (modificative, opt-in, 10) — push_pull / boolean_* /
    fillet_edge / move_xia / ...
  - Tier 3 (destructive, explicit consent, 5) — erase_face / delete_xia /
    import_step / ...
  - 기본값 `enabled_tiers: [0, 1]`. `AXIA_MCP_TIERS` env 또는
    `axia.config.json` 으로 override.
- **P26.2 3-layer Schema Versioning**:
  - WASM exports `schema_version()` / `engine_version()`
  - MCP server semver `^MAJOR.MINOR` satisfies 검사 (handshake)
  - per-call schema_version field (optional, future-proof)
  - MCP_SERVER_SCHEMA_VERSION 과 axia-wasm SCHEMA_VERSION 은 **lockstep**
- **P26.3 Owner ID only**: ADR-037 P22 (Pick→Promote) 의 cross-boundary
  확장. raw triangle/segment index 절대 노출 금지. Zod `OwnerId` schema
  + `OWNER_ID_SENTINEL` ("Owner ID") 로 surface drift 차단.
- **P26.4 Headless WasmBridge**: `crates/axia-wasm` 의 `--target nodejs`
  빌드. viewport / Toast / Three.js / SnapManager 의존성 0. 산출물:
  `packages/axia-wasm-node/dist/`.
- **P26.5 Latency Budget** (메타-원칙 #11 적용):
  - Tier 0: <16ms / Tier 1: <33ms / Tier 2,3: <100ms / Heavy: <500ms
  - **실측**: e2e draw_rect (Tier 1) median **8ms** (budget 의 24%)
- **P26.6 Session Isolation**: AI agent 와 사용자 viewport 별개 mesh
  state. 두 AxiaEngine instance 가 독립적으로 동작 — 회귀 테스트
  `mcp_session_isolation_user_unaffected` 로 강제.
- **P26.7 Audit Trail (boosted)**: 일별 rotation
  `~/.axia/mcp-audit-YYYY-MM-DD.log` (UTC). `AXIA_MCP_AUDIT_DIR` env 로
  디렉토리 override. 매 entry 에 `request_id` (UUID v4) + `engine_version`
  + `schema_version` stamp — drift correlation. **Denied 는 모든 tier
  에서 무조건 기록** (intrusion signal). Tier 2/3 success/error +
  any-tier denied = audit, Tier 0/1 success = no audit (flooding 방지).
  result 필드: `'ok' | 'error' | 'denied'` 분리.
- **P26.8 7 회귀 테스트** (절대 #[ignore] 금지):
  - mcp_handshake_rejects_schema_mismatch
  - mcp_tier3_blocked_when_not_enabled
  - mcp_owner_ids_only_no_raw_indices
  - mcp_session_isolation_user_unaffected
  - mcp_audit_log_records_tier2_calls
  - mcp_latency_budget_tier1_under_33ms
  - mcp_capability_surface_matches_adr_041_p26_1
- **구현**: `packages/axia-mcp-server` (Node + TS, ESM, strict).
  `@modelcontextprotocol/sdk` ^1.0.4, zod ^3.23.8, semver ^7.6.3,
  zod-to-json-schema ^3.25.2. Stage 1~4 모두 commit 완료
  (28be6ff / d9deb6d / 8bf0a44 / 본 commit).
- **통합 가이드**: `docs/integrations/mcp-claude-desktop.md`,
  `docs/integrations/mcp-cursor.md`.
- **CI**: `.github/workflows/mcp.yml` (post-acceptance follow-up). 3-job
  pipeline — wasm-node-build → mcp-server-test (Node 20/22 matrix) →
  surface-drift-guard (P26.8 7 회귀 isolated). PR 마다 schema mismatch
  / tier drift / owner ID leak 즉시 감지.
- **Onboarding guard**: `npm install` 시 `scripts/check-wasm.mjs` 가
  WASM artifact 검증. 누락 시 친절한 경고 + exit 0 (fail-soft).

### 20. ADR-042 — MCP Capability Policy (P27 ALLOW/DENY, 2026-05-02)
- **새 원칙 P27**: ADR-041 P26.1 의 4-tier whitelist 위에 capability
  단위 ALLOW/DENY 정책 layer. **Additive semantics** + fail-closed.
- **P27.1 Composition rule**:
  ```
  enabled(cap) = (cap ∉ DENY) AND (tier ∈ TIERS  OR  cap ∈ ALLOW)
  ```
  - ALLOW 는 *additive* (tier 가 막아도 통과 가능)
  - DENY 는 *subtractive* (tier 가 통과시켜도 차단)
  - DENY 항상 우선 (fail-closed)
  - Exhaustive whitelist 필요 시 `TIERS=""` (empty) + `ALLOW=cap1,...`
- **P27.2 Env vars**: `AXIA_MCP_ALLOW_CAPS=draw_rect,push_pull` +
  `AXIA_MCP_DENY_CAPS=boolean_subtract`. 기존 `AXIA_MCP_TIERS` 유지.
- **P27.3 Unknown = fatal**: env / config 의 typo 는 startup 에서 즉시
  process 종료 (exit 2) + Levenshtein distance ≤ 2 의 "Did you mean"
  힌트. `UnknownCapabilityInPolicyError` 클래스.
- **P27.4 tools/list invariant**: `isVisibleInToolsList(cap, policy) =
  evaluatePolicy(cap, policy).allowed`. ALLOW promote 한 cap 도 list 에
  표시. defense-in-depth — dispatch 시 재검사.
- **P27.5 Audit reason layered** (P26.7 확장): 3 distinguishable kinds:
  * `unknown` — capability 자체가 surface 외
  * `denied_by_DENY` — DENY 명시
  * `tier_disabled_no_allow` — tier 비활성 AND ALLOW 미포함
- **P27.6 8 회귀 테스트** (절대 #[ignore] 금지):
  * policy_default_tier_only_unchanged (ADR-041 회귀 0)
  * policy_deny_overrides_tier
  * policy_allow_promotes_capability_above_tier
  * policy_exhaustive_whitelist_via_empty_tiers (revised)
  * policy_deny_wins_over_allow
  * policy_unknown_capability_fatal_with_hint
  * policy_audit_reason_distinguishes_layer
  * policy_tools_list_reflects_actual_enablement
- **구현**: `packages/axia-mcp-server/src/policy.ts`. ADR-041 의 자연
  확장. DEFAULT_POLICY = ADR-041 default → 회귀 0. 103 / 103 tests
  passing.
- **변경 이력 주의**: 초안은 AWS-style implicit-deny semantics 였으나
  UX 발견 후 additive 로 revise (use case 2 가 모든 Tier 1 enumerate
  필요해서). 변경 commit 단계에서 ADR + 구현 + 테스트 동시 변경.

### 21. ADR-043 — `npm create axia-mcp` Init Template (P28, 2026-05-02)
- **새 원칙 P28**: scaffold 는 `@axia/mcp-server` 의 npm package 를
  dependency 로 받는 **thin wrapper 4 파일** 만 생성. capability /
  handler / Zod 코드 절대 복제하지 않음. ADR-041 surface 변경 시
  사용자는 `npm update` 만 하면 됨.
- **P28.1 Scaffold 4 파일**: package.json (semver caret pin) +
  axia-mcp.config.json (P27 tiers/allow/deny) +
  claude_desktop_config.snippet.json + README.md (5-step quickstart).
  Capability/handler 코드 미복제 — drift 영구 차단.
- **P28.2 Schema version pinning**: `@axia/mcp-server: ^MAJOR.MINOR.PATCH`
  caret-range. ADR-041 P26.2 schema 와 정합 — MINOR 자동 수용, MAJOR 는
  명시적 upgrade.
- **P28.3 WASM dependency**: 모드 A (bundled npm `@axia/wasm-node`,
  default — Rust 미설치 OK) / 모드 B (`--from-source` flag, contributor
  용). 본 ADR 은 모드 A 만 결정 — 실제 npm publish 는 ADR-044 (release
  process) 별도.
- **P28.4 Postinstall guard 재사용**: 기존
  `@axia/mcp-server/scripts/check-wasm.mjs` 가 SSOT. scaffold 추가
  guard 없음.
- **P28.5 5 회귀 테스트** (절대 #[ignore] 금지):
  * scaffold_creates_minimal_files (4 파일 정확)
  * scaffold_pins_caret_range (^semver 검증)
  * scaffold_config_passes_schema_validation
  * scaffold_does_not_duplicate_handlers (regex deny 로 capability
    name leak 차단)
  * scaffold_init_smoke_runs (실제 disk write + JSON parse)
- **CLI**: `npm create axia-mcp <name> [--tiers] [--allow-caps] [--deny-caps]
  [--client] [--force]`. `kleur` 로 컬러 출력. 4 파일 생성 후 next-step
  안내.
- **구현**: `packages/create-axia-mcp` (kleur 한 종속성). 17 tests passing.
  실제 scaffold smoke: my-axia-app + tier 0,1,2 + DENY=boolean_subtract
  실행 확인 (Stage 1).
- **알려진 한계**: `@axia/mcp-server` 와 `@axia/wasm-node` npm 미공개 →
  현재 scaffold 가 만든 package.json 의 dep resolve 안됨. 별도 ADR-044
  (npm publish flow) 필요. 본 PR 은 scaffold 코드 + 회귀 + ADR 까지.

### 22. ADR-044 — AxiA npm Release Process (P29, 2026-05-02)
- **새 원칙 P29 — Synchronized Schema Release**: 세 publishable
  (`@axia/wasm-node` + `@axia/mcp-server` + `create-axia-mcp`) 가
  lockstep semver, `prepublishOnly` hook 으로 build + test +
  schema-pin 검증, CI-only publish + npm provenance attestation.
- **P29.1 Lockstep semver**: 세 package version 동일 (string
  equality 회귀로 강제). 다른 reason 도 셋 다 동시 bump.
- **P29.2 prepublishOnly**: build + test + verify-schema-pin.mjs.
  실패 시 publish 거부.
- **P29.3 npm scope**: `@axia/wasm-node` + `@axia/mcp-server` (scoped,
  `--access public`), `create-axia-mcp` (unscoped, npm create
  컨벤션).
- **P29.4 Required metadata**: license MIT / repository / author /
  homepage / bugs / keywords 모든 package 강제. 회귀 테스트로 drift
  방지.
- **P29.5 files 화이트리스트**: 정확한 publish 포함 경로. 테스트 /
  src TypeScript / package-lock.json 제외.
- **P29.6 Publish 환경 강제**: `guard-publish.mjs` 가 `process.env.CI`
  검사 — 로컬 publish 거부 (exit 1). escape hatch:
  `AXIA_PUBLISH_BYPASS=1` (provenance 잃음, emergency only).
  GitHub Actions release.yml 만 정식 publish 경로 (`id-token: write`
  for provenance).
- **P29.7 6 회귀 테스트** (절대 #[ignore] 금지):
  * release_metadata_complete (license/repository/...)
  * release_files_whitelist_present (files[] 검증, src/.ts 차단)
  * release_lockstep_versions (3 package version 동일)
  * release_prepublish_hook_present (guard + build + test)
  * release_schema_pin_consistent (engine ↔ server ↔ scaffold semver)
  * release_no_private_flag_on_publishables
- **구현**: scripts/guard-publish.mjs + scripts/verify-schema-pin.mjs
  + .github/workflows/release.yml + test/release_meta.test.ts (12 tests).
  131 / 131 MCP server tests passing.
- **알려진 미완**:
  * 실제 npm publish 미실행 — admin 권한 + NPM_TOKEN secret 필요.
  * `@axia` org 등록 미완 시 ADR-044.1 amendment (재명명).

### 23. ADR-045 — UI Surface Consolidation + ActionCatalog SSOT (P30, 2026-05-02)
- **출처**: `docs/audits/2026-05-02-ui-surface.md` (Phase 1 read-only
  audit, 4 parallel surveys). 6 finding 노출 (action ID kebab/snake
  drift, ToolManager-as-implicit-SSOT, MaterialPropertiesPanel dead
  code, Tier 0 UI 미노출, 등).
- **5 D 결정** (각 독립 PR 가능):
  - **D1 ActionCatalog SSOT**: `packages/axia-action-catalog/`
    workspace package. ActionDef = { id (kebab canonical), aliases.mcp
    (snake), aliases.legacy[], tier, label, description, surfaces[],
    handler }. UI ↔ MCP 양방향 lookup. 회귀 4개
    (alias_bidirectional / no_collision / drift_with_mcp_tiers /
    handler_invocable_from_both).
  - **D2 Panel taxonomy 4 categories**: Inspect (XiaInspector,
    Component, Constraint, History, Scenes) / Tools (Osnap, Style, Sun,
    Settings, ShortcutHelp) / **Explorer (NEW)** / **Debug (NEW)** /
    Special (StatusBar, DimensionLabel, TextureUploadDialog,
    ReferenceImage, DraggablePanelManager). Panel 추가 시 category 명시
    필수. **MaterialPropertiesPanel 삭제** ("Dead panel removed,
    re-introduction requires a new ADR.").
  - **D3 Capability Explorer = discoverability SSOT**: Hybrid 노출
    정책 — Tier 0 (schema-driven form) / Tier 1 (launcher only) /
    Tier 2 (launcher + audit preview) / Tier 3 (기본 비노출, Debug
    Danger Zone 토글). 회귀 3개.
  - **D4 Schema-driven form scope = Tier 0 only**: Tier 1/2 ergonomic
    유지 (DrawRectTool 등 unchanged). Tier 3 form + confirm() 필수.
    회귀 3개.
  - **D5 Debug Panel** = audit log viewer + invariant verifier +
    analytic hover overlay + Tier 3 Danger Zone. 기본 hidden, dev
    /power-user 용. 회귀 4개 (audit_pagination /
    invariants_lists_violations / danger_zone_default_off /
    analytic_overlay_toggleable).
- **5 핵심 문장** (ADR 톤 정의):
  1. "ActionCatalog is the single source of truth for action identity
     across UI and MCP."
  2. "MaterialPropertiesPanel is removed as dead code; re-introduction
     requires a new ADR."
  3. "Capability Explorer is the discoverability SSOT; execution
     ergonomics remain tool-based."
  4. "Tier 3 capabilities are Debug-only and require explicit Danger
     Zone enablement."
  5. "Legacy aliases are soft-deprecated and centrally tracked in the
     catalog."
- **Phase 2 4-PR 로드맵**:
  - PR-1 (이 세션): MaterialPropertiesPanel 삭제 + regression guard
  - PR-2 (별도 세션): packages/axia-action-catalog scaffold + 53
    action 등록
  - PR-3: Capability Explorer panel (Tier 0 form + Tier 1/2 launcher)
  - PR-4: Debug Panel
- **회귀 14 invariant 총합** (5 D 분산). 모두 절대 #[ignore] 금지.
- **본 PR scope**: ADR draft + PR-1 (PR-2~4 별도 세션).
- **PR-2 진행 (2026-05-02 추가 commit)**: `packages/axia-action-catalog/`
  workspace package + 82 actions seeded + 4 D1 invariants (23 tests).
  `delegated` status 추가 (handler module 경유). 마이그레이션은 별도 PR-2.5.

### 24. ADR-046 — UI/UX Long-term Strategy + Product Identity Lock (P31, 2026-05-02)
- **Product Identity 고정**: "AxiA는 P1 (건축/디자인) primary + P3
  (AI 협업자) strong secondary 를 위한 엔진." 이전 23 LOCKED 정책은
  모두 "정확함 / 정합성 / 정밀도" enforce — 본 ADR 이 처음으로
  **사용자 경험 방향성** 명시 lock.
- **7 Open Questions 합의** (모두 lock):
  - Q1 페르소나: P1 + P3 (P2 deprioritized)
  - Q2 Sketch vs Direct-3D: 둘 다 first-class, mode 분리
  - Q3 AI 통합: optional sidebar, default off
  - Q4 Mode switching: 사용자 토글, default off (additive)
  - Q5 메뉴 재구성: A → B 점진 (muscle memory 보존)
  - Q6 모바일: 데스크톱 only
  - Q7 다국어: 한국어 + 영어 (Phase 2)
- **3 Vector** (engine 목표 정량화):
  - Easier than Blender: click ≤ 3 (현재 평균 4)
  - More precise than SketchUp: 수치/snap 기본값 (✅)
  - Lighter than CAD: 초기 ≤ 500KB (현재 252KB ✅)
- **5 Pillar UI/UX**:
  1. Discoverability — Capability Explorer + Cmd-K
  2. Precision Visibility — VCB + OSNAP + cardinal feedback
  3. Mode Coherence — Sketch / Model / Inspect / Debug 4-mode
  4. AI Seam — ActionCatalog SSOT 가 사람/AI 동일 surface
  5. Progressive Disclosure — Beginner / Intermediate / Power 3 levels
- **5 핵심 문장** (의사결정 anchor):
  1. "AxiA 는 P1 primary + P3 strong secondary 위한 엔진"
  2. "Discoverability 는 정합성/정밀도와 동급 first-class"
  3. "AI 호출과 사람 클릭은 ActionCatalog SSOT 동일 surface — AxiA
     는 AI-collaborative CAD first-mover"
  4. "메뉴 변경은 additive only — muscle memory 파괴 변경은 새 ADR"
  5. "Mode 는 기존 메뉴를 대체하지 않고 보조 — 사용자 선택 lens"
- **5-Phase Roadmap**:
  - Phase 1 (1개월): Polish — ADR-019/023 회귀, ActionCatalog 활성,
    Capability Explorer, Debug Panel (6 PRs)
  - Phase 2 (1-3개월): Discoverability — auto-gen ShortcutHelp,
    onboarding, i18n
  - Phase 3 (3-6개월): Mode workspace
  - Phase 4 (6-12개월): AI sidebar (first-mover)
  - Phase 5 (12개월+): Custom toolbars / macros / plugin / cloud
- **6 회귀 invariants** (4 자동 + 2 process review):
  - persona_p2_no_dedicated_features_after_2026_05 (manual review)
  - mode_switcher_default_off
  - ai_sidebar_default_hidden
  - menu_changes_additive_only (ADR amendment 강제, manual review)
  - actioncatalog_ssot_for_ai_and_human (ADR-045 D1 회귀로 covered)
  - discoverability_no_orphan_actions
- **향후 모든 ADR (#47+) 의 anchor**: P31 의 5 핵심 문장에 정합해야.
  의사결정 시 단 한 질문 — "이 변경이 P1 + P3 가치를 증가시키는가?"
  답이 No 면 거부.
- **본 PR scope**: ADR draft + LOCKED #24 + CLAUDE.md 갱신. Phase
  1 6 PRs 는 후속 작업.

### 25. ADR-047 — Snap Chain Self-Touch Prevention (P32, 2026-05-02)
- **새 원칙 P32**: 활성 도구의 pending chain vertex 는 endpoint snap
  candidate 에서 제외. SnapManager 가 cursor 를 chain 자기 자신 위로 끌어
  당겨서 face synthesis 가 duplicate-vertex `bail!` 로 실패하는 경로 차단.
- **enforcement layer 추가** — ADR-019 P4 / ADR-021 P7 정책 자체는
  unchanged. 엔진 방어 (`face_split.rs:662 has_dup_a/has_dup_b → bail!`)
  는 last-resort safety net 으로 유지.
- **Position-based exclusion** (VertId-free): SnapManager 의 vertex cache
  가 `Vector3[]` 인 점 + LOCKED #5 (1.5μm spatial-hash dedup) 정합.
  ε = 1.5μm.
- **chainStart 는 절대 제외 안 함** — loop-close 제스처 (highest priority
  loopClose snap) 가 동작해야 함. 제외 대상은 `chainPoints[1..]` 만.
- **API**: `ITool.getExcludedSnapPoints?(): Vector3[]` (optional).
  DrawLineTool 은 `chainPoints.slice(1).map(p => p.clone())` 반환.
  ToolManager 가 매 `getSnappedPoint` 호출 직전
  `snap.setExcludePositions(...)` 로 위임.
- **No findSnap signature change** — 33+ caller 영향 0. setter API 로
  out-of-band 설정.
- **10 회귀 테스트** (절대 #[ignore] 금지):
  * SnapManager.exclude.test.ts (6):
    chain_vertex_excluded_from_snap_during_polyline /
    chain_start_remains_snappable_for_close /
    external_vertex_not_excluded_by_active_chain /
    clearing_exclude_list_restores_snap /
    findNearestEndpoint_also_respects_exclude /
    snap_excluded_falls_back_to_grid_or_ground (silent-null 회귀 차단)
  * DrawLineTool.test.ts > getExcludedSnapPoints (ADR-047 P32) (4):
    returns empty when no chain / returns empty for fresh chainStart only /
    excludes mid-waypoints but NOT chainStart / returns clones
- **별도 PR 예정**: `face_split.rs` duplicate-vertex `bail!` 를
  `MeshOpError::DuplicateVertexInBoundary` 로 typed 화. 현재 input-layer
  가드로 unreachable 이지만 MCP / 스크립트 / import 경로의 last-resort
  safety net 유지 + TS Toast 친절화 (별도 commit).
- **ADR-046 P31 Pillar 2 (Precision Visibility) 보강**: snap 의 예측
  가능성이 first-class. "왜 면이 안 만들어지지?" → precision-visibility
  failure 였음.
- **Future**: DrawPolygonTool / DrawFreehandTool / DrawBezierTool /
  SketchSession multi-line tool 들도 `getExcludedSnapPoints` 채택 가능.
  SnapManager 는 policy-agnostic.

### 26. ADR-048 + ADR-049 — Two-Layer Citizenship Model (2026-05-03)
- **AixxiA Design Specification v3.2** (2026-05-03, Author: WYKO) 를
  엔진의 **개념적 anchor 문서** 로 인정. 향후 모든 ADR (#50+) 는 v3.2 의
  명제 + 본 LOCKED 의 두 계층 모델과 정합해야 함.
- **canonical 운영 anchor: ADR-049 — Two-Layer Citizenship Model**.
  ADR-048 (격차 진단) 은 작성 직후 사용자 통찰로 supersede 됨, 결정 이력
  보존용으로 유지. 새 작업은 **ADR-049 부터 읽을 것**.
- **두 계층 정의 (canonical)**:
  - **형태 XIA (Form XIA)** — 현재 엔진의 모든 "XIA". 기하학적 추상.
    Face 두께 0, Line 두께·너비 0, Point 모두 0 — **0 차원이 자연스럽다**.
    ADR-019 "Line is Truth, Face is Byproduct" 가 운영 정책.
  - **특성 XIA (Property XIA)** — v3.2 spec 의 정식 XIA. 부재 정체성.
    부피·단면 > 0 + 재질 + 닫힘 + manifold 4조건 동시 충족.
  - 두 계층은 **coexist**. 진짜 정합 대상은 **두 계층 간 승격/강등
    transition**. 형태 계층에 차원 가드를 강요하면 Face/Line 의 본질을
    부정하는 카테고리 오류.
- **사용자 통찰 (canonical breakthrough)**:
  > "FACE 는 두께가 0. LINE 도 두께·너비 0. POINT/VERTEX 도 0. 형태에서는
  > 0이 허용되어야 한다. 현재 엔진의 XIA 는 형태 XIA 이고, 부피·재질이
  > 있는 (문서의 정식) XIA 는 특성 XIA 다. 부피가 있는 것과 한 부분이 0이
  > 되는 것은 (다른 계층의) 별개 사건이다."
- **어제 fix 들의 재해석** — 어제 (2026-05-02) 의 다수 self-healing 작업
  (`1cb1827` earcut empty auto-deactivate, `fc3abe6` degenerate scan,
  `ee066e3` Phase 7 cleanup 등) 은 v3.2 명제 7 의 사후 구현이 아니라
  **형태 계층 자체의 위상 invariant 강화**. 0 차원은 허용하되 위상이
  깨지는 결과 (NaN normal / HE chain stale) 는 차단.
- **단계적 로드맵** (ADR-049 §4 의 Q1~Q5 모두 확정 후 — 2026-05-03 사용자 세션):
  - **Phase 0** (완료): 본 LOCKED + ADR-048 amendment + ADR-049 + Q1~Q5 final
  - **Phase 1** ✅ **완료 (2026-05-06)** — ADR-050 + ADR-051 Path Z atomic
    11+ sub-step closure (P-1 ~ P-7):
    * **ADR-050** — Shape/Xia type split + 형태 → 특성 승격 API + face-level
      material 정책 (Q1 + Q3 + Q4 통합 구현). **§D Acceptance Log 참조**.
    * **ADR-051** — ADR-021 P7 strict reaffirmation + verify_p7_manifold
      named invariant. LOCKED #1 amendment landed.
    * **회귀 누적**: axia-core +49, axia-geo +5, axia-wasm +12, axia-
      transaction +2, vitest +77 (총 **+145**, 절대 #[ignore] 금지 145/145
      준수)
    * **사용자 facing 변화**: default Shape mode (P-5e-α) + Undo 1회
      collapse (P-5e-γ) + Inspector "형태 (Shape)" / "XIA (특성)" 라벨 (P-6)
    * **다음 ADR 가이드**: ADR-050 §E Lessons (Path Z 효율성 / FORM_MATERIAL
      sentinel / replace_last_after_snapshot UX / 명명 정합 / 점진 마이그
      레이션 / 3-layer 봉인) 참조
  - **Phase 2** (ADR-052 예정): 재질 제거 → Shape 가역 강등 + 5초 알림 +
    재질 임시 보존 (Q5 사건 1)
  - **Phase 3** (ADR-053 예정): Reference 시민권 분리 (Construction Line /
    Imported Mesh / Point Cloud)
  - **Phase 4** (ADR-054 예정): 위상 손상 자동 복구 + 실패 시 사용자 다이얼로그
    (Q5 사건 2-4, v3.2 §12.3 §12.5)
  - **Phase 5** (ADR-055+): 자산 라이브러리 3계층 + Layered material (§13)
- **Q1~Q5 final 결정 요약** (자세히는 ADR-049 §4 참조):
  - **Q1**: 승격 = 재질 + 부피/단면 > 0 (strict, ε 없음) + watertight + manifold
  - **Q2**: P7 재설계 — 큰 RECT + 작은 RECT = ring-with-hole + 별개 inner
  - **Q3**: 명명 분리 — `Shape` (형태) / `Xia` (특성). 사용자 facing 에서
    재질 없는 단계엔 "XIA" 안 노출. Phase 1 와 함께 마이그레이션
  - **Q4**: default_material 폐지. Shape = material 없음 / Xia = primary +
    face-level override
  - **Q5**: v3.2 §12 strict — 재질 제거 = 5초 알림, 위상 손상 = 자동 복구
    시도 → 실패 시 사용자 다이얼로그 ([Undo] [강등] [수동수정])
- **LOCKED 변경 예정** (ADR-051 commit 시):
  - LOCKED #1 (ADR-021 P7 stacked-inner) → ADR-051 supersede, ring-with-hole
    + 별개 inner 로 재정의
  - LOCKED #3 (Sub-face XIA inheritance) — Phase 3 시민권 분리 후 재정의
  - LOCKED #12 (ADR-025 P11 strict) — Phase 4 자동 강등과 정합 재확인
- **변하지 않는 것 — 형태 계층의 자체 invariant** (어제 fix 들이 만든 자리):
  - 0-area face / NaN normal / 자기 교차 → 형태 계층에서도 무효, 자동 차단
  - Manifold 위반 → 형태에서도 HE chain 불안정, 시각 hint (R1) + 자동 정리
  - Snap chain self-touch → ADR-047 P32, 형태 계층에서 작동
- **제약**: 본 LOCKED + ADR-048 + ADR-049 은 코드 변경 0. Phase 1~5 는
  각각 사용자 명시 동의 + 별도 ADR + 별도 PR. **본 LOCKED 의 두 계층
  모델을 모든 후속 결정의 pre-condition** 으로 강제.
- **Cross-link**: ADR-019 (형태 계층 anchor) / ADR-021 P7 / ADR-007
  invariant / 어제 세션 12 commits / v3.2 spec.

### 27. ADR-080 — Offset Dimension-Aware Semantics (2026-05-06)
- **사용자 정책 (canonical)**:
  > "Offset 은 선택 대상의 차원에 따라 의미가 결정된다. 선을 선택하면
  > 기준 평면/면에서의 곡선 offset 이 적용되고, 면을 선택하면 해당 면의
  > 법선 방향으로 surface offset 이 적용된다. 이는 단일 명령이지만
  > 서로 다른 기하 의미를 가진다."
- **단일 진입점, dimension-driven dispatch** — UI / 메뉴 / 단축키 모두
  단일 "Offset" 명령. 의미 결정은 active selection 의 geometric
  dimension.
- **Edge dimension** (1D) → host face 의 surface 위에서 in-plane curve
  offset (analytic 정확). Free wire 는 reference plane 추론 (sketch /
  wire 평면 / ground).
- **Face dimension** (2D) → surface normal 방향 constant offset
  (ADR-079 W-2-γ 의미론 답습). Plane / Cylinder / Sphere / Cone /
  Torus 모두 활성. Push/Pull 과 의미 동일 — 두 entry 모두 SSOT.
- **Mixed selection** (edge + face) → reject + Toast (사용자 명시
  분리 강제).
- **Vertex / Volume dimension** — 별도 ADR (현재 미정).
- **OffsetTool "Principle 1" (2026-04-24, face-only) 폐기**: edge-offset
  복원, 의미 모호성은 dimension dispatch 로 명확 해소. 기존
  face-boundary expand/contract 동작은 "전체 edge selection 후 offset"
  의 emergent behavior 로 자연 보존 — 사용자 muscle memory 파괴 없음
  (ADR-046 P31 #4 menu changes additive only 정합).
- **Push/Pull / Offset / Surface Offset 의 SSOT 통합**: face dimension
  의 의미가 같으므로 내부 구현은 단일 (`Mesh::create_solid` /
  `offset_smooth_group_*`). UI 진입점은 둘 다 유지 (관습 + 직관 모두
  만족).
- **Lock-ins (L1~L9)**: 단일 entry / dispatch SSOT / edge in-plane /
  face out-of-plane / mixed reject / push-pull coexistence / backward
  compat / multi-loop guard / free wire reference.
- **Multi-loop guard (ADR-016 Q2 정합)**: hole 면의 boundary edges
  동시 offset 도 reject 유지.
- **본 LOCKED 의 코드 변경 0** — spec only commit. 후속 V-α ~ V-ζ
  sub-step 에서 점진 구현 (각각 별도 atomic + 별도 ADR 결재 필요).
- **V-α / V-β 트랙 closure 진행 상황 (2026-05-06)**:
  - V-α (TS dispatch placeholder): ✅ Closed — `b276b3f`
  - V-β-α (Rust core, Line + Plane): ✅ — `f126219`
  - V-β-α-bridge (WASM + TS + OffsetTool): ✅ — `380dd06`
  - V-β-β (Plane Arc/Circle): ✅ — `dd31694`
  - V-β-γ-1~4 (Cylinder / Sphere / Cone / Torus host): ✅ —
    `9cf2f97` / `42a7a4a` / `7f553a4` / `bc88129`
  - 누적 회귀: axia-geo +43, axia-wasm +3, vitest +11 (절대
    #[ignore] 금지 57/57 준수)
  - 5 analytic primitive surface × 자연 curve type 모두 활성:
    Plane (Line+Arc+Circle) / Cylinder (axial Line+latitude
    Arc/Circle) / Sphere (Arc/Circle 만) / Cone (slant Line+latitude
    Arc/Circle) / Torus (major-direction+meridian Arc/Circle)
  - **Forward-defer**: NURBS-class hosts (BezierPatch /
    BSplineSurface / NURBSSurface) + NURBS-class curves (Bezier /
    BSpline / NURBS) → W-3 트랙
- **V-δ 트랙 closure (2026-05-06)** — Free wire reference plane:
  - V-δ-α (Rust wire planarity, 8a68eab): connected component BFS +
    3-point best-fit plane + RMS check. WireNotPlanar / NoReferencePlane
    typed errors. finish_plane_offset shared helper 추출.
  - V-δ-β (caller-supplied plane API, 4dc64dc): `Mesh::offset_edge_
    with_reference_plane` + WASM JSON export + TS bridge wrapper.
    Single-edge wire / collinear / non-planar 의 escape hatch.
  - V-δ-γ (TS sketch cascade, 60c52fd): ITool ToolContext 에
    getSketchInfo 추가. OffsetTool applyEdgeOffset 가 3-Layer cascade —
    Layer 1 (V-δ-α) → Layer 2 (sketch via V-δ-β) → Layer 3 (deferred
    ground). free-wire-specific failures 만 cascade.
  - V-δ 누적 회귀: axia-geo +10, axia-wasm +2, vitest +12 (절대
    #[ignore] 금지 12/12 준수)
- **V-β-δ 트랙 closure (2026-05-06)** — NURBS-class curves + hosts
  (ADR-079 W-3 cross-cut):
  - W-3-γ (NURBS curves on Plane, a5aed1f): Bezier / BSpline / NURBS
    curve early reject 제거 → chord-based Line perpendicular offset
    (V-β-α 답습). 새 edge.curve = None (curve metadata lost).
  - W-3-δ (NURBS-class hosts, f9bd24d): BezierPatch / BSplineSurface /
    NURBSSurface host 활성. Tessellation-based representative normal
    (`AnalyticSurface::normal_at_world_pos` 재사용). 양쪽 ADR
    (offset + create_solid Extrude → SolidKind::GeneralSweep) cross-cut.
  - V-β-δ 누적 회귀: axia-geo +12 (offset +4 + extrude +8), axia-core
    +1 (fallback test rewrite), 절대 #[ignore] 금지 12/12 준수
- **ADR-080 host kinds 8개 모두 활성** (Plane / Cylinder / Sphere /
  Cone / Torus / BezierPatch / BSplineSurface / NURBSSurface).
  curve types 6개 모두 활성 on Plane (Line / Arc / Circle / Bezier /
  BSpline / NURBS).
- **V-γ closure (2026-05-06)** — face semantic 결재:
  - **채택: option (a)** — 기존 OffsetTool boundary expand/contract
    유지. Surface-normal offset 은 PushPullTool 단독 entry.
  - 결정 근거: ADR-046 P31 #4 (muscle memory 보호) + ADR-079 W-2-γ
    SmoothGroupOffset 가 PushPullTool 의 surface-normal SSOT
    + 두 진입점 (OffsetTool / PushPullTool) 분리로 두 의미 명확
  - 회귀 0 (코드 변경 없이 결재만으로 closure)
  - 의미: ADR-080 §2.3 의 "face → surface normal" 은 PushPullTool 의
    semantic 을 가리키는 dimension dispatch. OffsetTool face dim 은
    in-plane boundary expand (legacy 보존).
- **남은 V-ε / V-ζ**: Vertex / Volume dimension — future ADR (현재
  정의 미정)
- **Cross-link**: ADR-079 (Create Solid — face dim 의 운영 의미
  source), ADR-049 (Two-Layer Citizenship — 직교, geometric dim 을
  dispatch key 로 사용), ADR-016 (multi-loop face Q2), ADR-027 (NURBS
  Kernel — curve offset 정확성), ADR-038 P23 (surface-aware normals).

### 28. ADR-081 — STEP/IGES NURBS-class Import Activation (W-α ~ W-η, 2026-05-07)
- **사용자 결재 (canonical)**:
  > "ADR-079 W-3-δ 가 NURBS-class hosts 활성, ADR-080 V-β-δ 가 NURBS-
  > class curves 활성. 외부 CAD 파일 (STEP / IGES) 의 NURBS-class 표면
  > 이 이제 axia-engine 의 모든 op 의 입력으로 가능. STEP/IGES import
  > 의 BRep traversal + AnalyticCurve / AnalyticSurface promotion 본체
  > 를 활성화하여 사용자 facing CAD interop 의 첫 메이저 milestone
  > 마무리."
- **Path Z atomic 7-단계 closure** (W-α ~ W-η, 2026-05-06 ~ 2026-05-07):
  - W-α (spec only commit): ✅ — `c297093`
  - W-β (occtCurvePromote 11 본체 활성, mock-based unit tests): ✅ —
    `dc54c06` (vitest +12) — Direct 6 (Line/Circle/Arc/Bezier/BSpline/
    NURBS) + Conic 3 (Ellipse/Parabola/Hyperbola, Piegl A7.1/4/5) +
    Fitting 1 (OffsetCurve) + TrimmedCurve
  - W-γ (occtSurfacePromote 12 본체 활성, mock-based unit tests): ✅ —
    `47b40c0` (vitest +13) — Direct 5 (Plane/Cylinder/Sphere/Cone/Torus)
    + BezierPatch + BSplineSurface + NURBSSurface + Sweep 2 deferred
    (Piegl A8.1/2) + Offset deferred + RectangularTrimmedSurface
  - W-δ (BRep traversal + face/edge index promotion): ✅ — `8bed5e7`
    (vitest +7) — TopExp_Explorer + stable 0-based traversal index +
    P22.7 owner-ID prep
  - W-ε (Trim loop handling, PCurve, ADR-036 P21.3): ✅ — `a23cae1`
    (vitest +12) — TrimCurve2D Rust enum 1:1 mirror (Line/Arc/Bezier/
    BSpline) + outer wire stable 정렬 + RectangularTrimmedSurface
    fast-path
  - W-ζ (Corpus round-trip 검증, 5 fixtures, 1e-3 mm): ✅ — `4a0f838`
    (vitest +5) — NIST plane + NIST cylinder + SolidWorks NURBS 3×3 +
    Fusion B-spline + CATIA RectangularTrimmedSurface, closed-form
    geometric property + ADR-036 P21.6 답습
  - W-η (UI integration, Toast progress + traversal passthrough): ✅
    — `144835f` (vitest +4) — `onLoadingStart → Toast.info` + warnings
    → `Toast.warning` + clean import → `Toast.success` + `traversal?:
    BRepTraversalResult` ImportResult 통과 (P22.7 owner-ID 매핑 prep)
- **Lock-ins L1~L7**:
  - L1 — Format priority (ADR-035 P20.A 답습): STEP AP242 primary,
    AP203/AP214 secondary, IGES 5.3 legacy
  - L2 — OCCT.js Stage 4-A activation: dynamic loader scaffold 위
    BRep traversal + promote 본체 활성. Initial bundle 0MB 증가 강제
    유지 (P20.C #2 strict)
  - L3 — ADR-036 P21 mapping reuse: SUPPORTED_CURVE_KINDS (11) /
    SUPPORTED_SURFACE_KINDS (12) drift guard 회귀 유지
  - L4 — Tolerance default 1e-3 mm
  - L5 — Failure mode ImportResult.warnings (P21.7) — fatal 아닌 누적,
    `face[N]:` / `edge[N]:` / `wire[N].edge[M]:` prefix 로 owner-ID
    역추적 가능
  - L6 — Owner ID promotion (ADR-037 P22 정합): import 후 face/edge
    에 axia owner ID 즉시 부여 (W-η traversal 통과로 prep 완료)
  - L7 — ADR-079 W-3-δ + ADR-080 V-β-δ 활성 의존: import 된 NURBS-
    class face 가 즉시 offset / extrude / push-pull 가능
- **누적 회귀**: vitest **+53** (1512 → 1569, 절대 #[ignore] 금지
  53/53 준수). axia-geo / axia-core / axia-wasm 0 (TS-only 변경).
  vite build 정상 (2.08~2.15s), Initial bundle **724.76 kB 7-commit
  일관 보존** (P20.C #2 0MB 증가 강제), `axia_wasm_bg.wasm` 0 변경.
  StepIgesImporter chunk: 30.22 kB lazy load.
- **Wrapper version-tolerant 패턴 일관 적용** (ADR-035 P20.7 답습):
  `_2 ?? _1 ?? bare` chain + `Handle_Geom_*::DownCast` + `.get?.()`
  pattern + `IsNull?.()` chain. NCollection_Array2 footgun (LOCKED #14)
  은 `Pole(i, j)` / `Weight(i, j)` 직접 accessor 로 우회 일관 적용.
- **Stable index policy** (ADR-037 P22.7): traversal order 0-based 단조
  증가, Tessellate fallback 도 동일 index 부여. owner-ID 매핑 정합
  강제.
- **사용자 가치 anchor** (ADR-046 P31 두 페르소나):
  - P1 (건축/디자인): 기존 CAD 파일 (SolidWorks/Fusion/CATIA STEP) →
    AxiA 직접 편집, workflow 통합
  - P3 (AI 협업자): AI agent 가 STEP file 입력 → axia-engine 모든 op
    적용 (ADR-041 MCP capability tier 1 자연 확장)
- **알려진 한계** (모두 별도 ADR 또는 future track):
  - WasmBridge owner-ID 매핑 (`bridge.setFaceSurface*` + metadata
    rebuild) 미구현 — `traversal` 필드는 통과되지만 axia FaceId/EdgeId
    실제 attach 는 별도 PR
  - `_convertToThreeGroup` BRepMesh tessellation 미구현 — 빈 group 반환
  - 실제 STEP/IGES 파일 코퍼스 검증 (NIST/SolidWorks/Fusion/CATIA actual
    files): OCCT.js 설치 + Playwright E2E (ADR-075 인프라 활용) 필요.
    본 트랙 53 회귀는 mock fixture 만 — *demo 시 실파일 risk*
  - W-3-ε deferred: Sweep/Offset surface 본체 (Piegl A8.1/2) +
    Geom2d_Ellipse/Hyperbola/Parabola/rational PCurve — 별도 트랙
  - Toast 한국어 wording i18n (ADR-046 Phase 2) — 현재 하드코딩
- **Cross-link**: ADR-035 (Stage 4-A/4-B 12개월 default decision matrix
  — 본 트랙은 4-A 본체 활성), ADR-036 (P21 11+12 mapping table —
  stub→본체), ADR-079 (7 SolidKind import face 가 모든 mode 의 profile
  가능), ADR-080 (8 host × 6 curve dispatch — import face/edge 자연
  통과), ADR-027 (NURBS Kernel storage), ADR-037 (P22 owner-ID), ADR-038
  (P23 surface-aware normals — `tessellate_face_surface`), ADR-041
  (MCP capability tier 1 자연 확장), ADR-046 (P31 두 페르소나 가치
  anchor).

### 29. ADR-082 — OCCT.js 실설치 + Real Runtime Activation (C-α ~ C-ε, 2026-05-07~08)
- **사용자 결재 anchor (canonical)**:
  > "ADR-081 53 mock 회귀의 실파일 round-trip 검증 0건 — demo 시 risk.
  > OCCT.js 실설치 + NIST 1 corpus 실검증이 가장 큰 demo unlock 이자
  > mock-only confidence 의 첫 truth 검증."
- **Path Z atomic 5-단계 closure** (C-α ~ C-ε, 2026-05-07 ~ 2026-05-08):
  - C-α (spec only): ✅ — `fb11a8d`
  - C-β (devDep + bundle 0MB + reachability tests): ✅ — `0d68460`
    (vitest +5)
  - C-γ (Drift #1 fix `mod.default` → `initOpenCascade` + Drift #2 봉인
    Node ESM 한계): ✅ — `e022f03` (vitest +3)
  - C-δ (Drift #3 architectural discovery — `@vite-ignore` ↔ Vite
    bundling impedance): ✅ — `b08990c` (Playwright +2)
  - **C-ε amendment** (Drift #3 architectural fix + Drift #4 libs
    fix): ✅ — `5cbf137`
    * `@vite-ignore` 제거 + literal `'opencascade.js'` import
    * L1 amendment: `optionalDep + devDep` → `dependencies` 승격
    * `opencascadeWasmAsUrl` Vite plugin (Emscripten WASM `env` 우회)
    * `loadOcct` container entry (Vite static analysis 활용)
    * `initOpenCascade({libs: [ocCore, ocModelingAlgorithms,
      ocDataExchangeBase, ocDataExchangeExtra]})` 명시 (Drift #4)
- **Wrapper drift 누적 (5건)**:
  - Drift #1 (해결): entry `mod.default` → `initOpenCascade`
  - Drift #2 (봉인): Node ESM `import('opencascade.js')` 의 WASM `env`
    import 해결 불가 → Node 측 OCCT 사용 불가 확정
  - Drift #3 (해결): `@vite-ignore` ↔ Vite bundling architectural 한계
    → `opencascade-deps` lazy chunk 미생성 → browser dynamic import
    실패. C-ε amendment 로 본체 fix
  - Drift #4 (해결): STEP/IGES API 가 dynamic library (libs) 로딩
    필요 — empty `libs: []` 시 base API 만 제공. mock 회귀가 통과한
    이유 — mock OCCT 가 모든 API 노출
  - Drift #5 (봉인): Browser env OCCT init 180s+ 소요 — CI smoke
    부적합. Real init 검증은 별도 slow channel deferred
- **Lock-ins L1~L7** (C-ε amendment 후):
  - L1 amendment: `dependencies` 등록 (이전 optionalDep+devDep 폐기)
  - L2 ~ L7: 변경 없음 (NIST corpus / 1e-3 mm tolerance / warnings 누적
    / Playwright truth / BRepMesh deferred / mock 보존)
- **누적 회귀**: vitest **+8** (1569 → 1577, 절대 #[ignore] 금지 8/8
  준수). Playwright **+2** (15 → 17, drift #3 architectural lock).
  axia-geo / axia-core / axia-wasm 0 (TS-only).
- **Bundle 영향** (P20.C #2):
  - **Initial bundle**: 724.76 → **724.84 kB** (+80 bytes — `loadOcct`
    function declaration). MB scale 미달 (0.011%). P20.C #2 **spirit
    유지**, +80 bytes 의 명시적 trade-off (architectural fix 의 minimum
    cost)
  - **NEW lazy chunk**: `opencascade-deps-{hash}.js` **5.37 MB** (gzip
    463.62 kB) — STEP/IGES 첫 import 시 fetch
  - **NEW static assets**: 50+ OCCT WASM 파일 (`module.TK*.wasm` +
    `opencascade.{core,dataExchangeBase,etc}.wasm`)
- **사용자 검증 가능 범위**:
  - ✅ Architecture: chunk fetch / module exports / loadOcct entry
    (Playwright 검증 완료)
  - ⏸️ Visual verification: `_convertToThreeGroup` placeholder — viewport
    빈 group → **demo readiness 0%** 유지
  - ⏸️ Real init smoke: timing 한계 (Drift #5) — slow channel deferred
  - ⏸️ Corpus round-trip: 별도 §3.5.1 또는 다음 ADR
- **다음 ADR cross-trigger**:
  - **ADR-083 (가칭) — BRepMesh Tessellation MVP** — `_convertToThreeGroup`
    본체 활성. STEP import 결과 viewport 표시. 사용자 검증의 *visual*
    가치 unlock.
  - 별도 ADR — WasmBridge owner-ID 매핑 (`bridge.setFaceSurface*`),
    Toast progress UX 개선, NIST corpus fixture
- **Cross-link**: ADR-035 (Stage 4-A 활성), ADR-036 (P21 mapping
  truth), ADR-075 (Playwright 인프라), ADR-081 §알려진 한계 #3
  (완전 closure — *진짜 원인은 architectural bundler-runtime 한계
  였음*), ADR-046 P31 (P1 + P3 페르소나 가치).

### 30. ADR-083 — BRepMesh Tessellation MVP / Visual Verification Unlock (T-α ~ T-δ, 2026-05-08)
- **사용자 결재 anchor (canonical)**:
  > "ADR-082 C-ε amendment closure 후 demo readiness 0% — viewport 가
  > 비어 있어 사용자가 import 결과를 *볼 수 없음*. BRepMesh tessellation
  > MVP 가 visual verification 의 첫 unlock. 사용자 검증의 진짜 의미는
  > '표현된 결과를 보는 것'."
- **Path Z atomic 5-단계 closure** (T-α ~ T-δ + T-ε docs only,
  2026-05-08):
  - T-α (spec only): ✅ — `83680a9`
  - T-β (BRepMesh + Triangulation 추출 module): ✅ — `ffa1c7e` (vitest +8)
  - T-γ (Three.js BufferGeometry + Mesh wiring, **visual unlock**): ✅
    — `26e51ae` (vitest +4) — `_convertToThreeGroup` placeholder 제거
    + `_faceToMesh` private 신규 + ADR-046 two-tone 재질
  - T-δ (real Chromium round-trip slow channel): ✅ — `b238e8f`
    (Playwright +1 skipped, env opt-in)
    * Hand-crafted minimal AP203 corpus (`test_part_1.step`, license-
      clean public domain, ~50 entities)
    * `loadStepIgesImporter` container entry (loadOcct 패턴 답습)
    * 5 min timeout (Drift #5 흡수), `AXIA_E2E_SLOW=1` opt-in
  - T-ε (closure + LOCKED 갱신, docs only): ✅ — 본 commit
- **Lock-ins L1~L7** (T-α §2.1 spec):
  - L1: `BRepMesh_IncrementalMesh_2`, lineDeflection 0.1mm + angleDeflection
    0.5 rad (산업 표준 visual quality)
  - L2: `_convertToThreeGroup` 본체 활성, `_readShape` + `traverseBrep`
    결과 활용
  - L3: Per-face Three.js Mesh + BufferGeometry (position/normal/index),
    ADR-046 default two-tone 재질
  - L4: Tessellation tolerance fixed default (LOD 별도 ADR)
  - L5: Failure mode warnings 누적 (P21.7 답습), empty Mesh 도 valid
  - L6: Initial bundle 0MB strict (P20.C #2). StepIgesImporter chunk
    영역만 수정
  - L7: Visual verification — 사용자 STEP 열면 viewport 표시
    (demo 0%→80%+)
- **누적 회귀**: vitest **+12** (1577 → 1589, 절대 #[ignore] 금지
  12/12 준수). Playwright **+1 skipped** (T-δ slow channel, opt-in 활성
  시 +1 active). axia-geo / axia-core / axia-wasm 0 (TS-only).
- **Bundle 영향** (P20.C #2):
  - **Initial bundle**: 724.84 → **724.99 kB** (+150 bytes —
    `loadStepIgesImporter` registration). 누적 ADR-082+083 deviation:
    +230 bytes (0.032% of original 724.76 kB baseline). MB scale 미달.
  - StepIgesImporter chunk: 30.55 → 34.60 kB (+4.05 kB, T-γ 본체 활성
    + occtTessellate 통합)
  - opencascade-deps lazy chunk: 5.37 MB unchanged
- **사용자 검증 도달** (T-δ closure):
  - ✅ Visual: STEP 파일 import → viewport 에 face 별 Three.js Mesh
    표시 (front/back two-tone) → **demo readiness 0% → 80%+**
  - ⏸️ User manual demo: 사용자 자체 시연은 별도 follow-up (T-ε-split
    결재 — LOCKED #30 즉시 등재 + 시연은 후속 회고)
  - ⏸️ Production sign-off: T-δ slow channel 의 1회 실행 결과 회고는
    별도
- **Mesh 구조 (T-γ wiring)**:
  - `face-{N}` THREE.Group (W-δ stable index 답습)
    - `userData.faceIndex: number` (W-δ 답습)
    - `userData.surface?: SurfacePromotion` (W-γ surface 결과)
    - `face-{N}-front`: MeshStandardMaterial #e8e8e8 FrontSide
    - `face-{N}-back`: MeshStandardMaterial #9898b4 BackSide
- **다음 ADR cross-trigger** (사용자 검증 후 결재 가능):
  - WasmBridge owner-ID 매핑 (`bridge.setFaceSurface*`) — T-γ 의
    `userData.surface` 를 axia FaceId 로 attach
  - Edge wireframe rendering (T-γ 의 face Mesh 외 BRep edge 별도 표시)
  - Toast progress UX 개선 (Drift #5 5min wait 사용자 안내)
  - Material / texture mapping (STEP 의 색상 / material 정보 활용)
  - LOD / quality slider (chord/angle tolerance UI)
  - Real init slow channel CI 통합 (timing budget + nightly run)
- **Cross-link**: ADR-082 (drift #1~#5 fix 위 진행 — drift #5 timing 은
  T-δ slow channel 으로 흡수), ADR-081 W-δ (`traverseBrep` stable
  index 활용), ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31
  (P1+P3 visual 가치 anchor), ADR-018 (two-tone render policy).

### 31. ADR-084 — BRep Edge Wireframe Rendering MVP (E-α ~ E-γ, 2026-05-08)
- **사용자 결재 anchor (canonical)**:
  > "ADR-083 visual unlock 후 demo quality 추가 향상 — face mesh 만으로
  > 는 BRep topology (edge) 가 명시적으로 안 보임. CAD 사용자에게
  > *edge* 는 critical visual cue (chamfer/fillet/sharp boundary 식별).
  > 최단 demo 가치 path 의 첫 보강."
- **Path Z atomic 4-단계 closure** (E-α ~ E-δ, 2026-05-08):
  - E-α (spec only): ✅ — `dd8c7e0`
  - E-β (`tessellateEdges` API + Polygon3D 추출): ✅ — `6639c8d`
    (vitest +6) — `BRep_Tool.Polygon3D` 활용 + LineSegments pair
    indices + W-δ stable edge index 답습
  - E-γ (edges sub-group wiring, **BRep edge visual unlock**): ✅ —
    `5ac8cff` (vitest +3) — `_convertToThreeGroup` 갱신 + `_edgeToLine`
    private 신규 + ADR-018 LineMaterial #333366
  - E-δ (closure + LOCKED 갱신, docs only): ✅ — 본 commit
- **Lock-ins L1~L7** (E-α §2.1 spec):
  - L1: `BRep_Tool.Polygon3D(edge, location)` entry — BRepMesh 부산물
    활용. PolygonOnTriangulation 은 future
  - L2: Per-edge LineSegments + BufferGeometry (position + index pair
    attributes). W-δ stable index 답습 (`edge-{N}` 명명)
  - L3: `LineBasicMaterial #333366` (ADR-018 + FileImporter 일관)
  - L4: `edges` sub-group 구조 — face-N siblings 외부 별도 group
  - L5: Failure mode warnings 누적 (P21.7 답습), empty polyline skip
  - L6: Initial bundle 0MB strict (P20.C #2). occtTessellate.ts 확장만
  - L7: `userData.edgeIndex` (W-δ stable index 답습) — caller 가 향후
    axia EdgeId 매핑 시 활용
- **누적 회귀**: vitest **+9** (1589 → 1598, 절대 #[ignore] 금지 9/9
  준수). axia-geo / axia-core / axia-wasm 0 (TS-only).
- **Bundle 영향** (P20.C #2):
  - **Initial bundle 724.99 kB unchanged** — ADR-082+083 deviation 그대로
    유지 (+230 bytes from original 724.76 kB baseline). 본 ADR 추가
    deviation 0.
  - StepIgesImporter chunk: 34.60 → 36.94 kB (+2.34 kB — E-γ wiring +
    E-β tessellateEdges. lazy chunk 영역으로 P20.C #2 무영향)
  - opencascade-deps lazy chunk: 5.37 MB unchanged
- **Group 구조 (E-γ wiring)**:
  ```
  THREE.Group { name: 'STEP: foo.step' }
  ├─ face-0 (T-γ)
  │   ├─ face-0-front (MeshStandardMaterial #e8e8e8 FrontSide)
  │   └─ face-0-back  (MeshStandardMaterial #9898b4 BackSide)
  ├─ face-1 ...
  └─ edges (E-γ NEW)
      ├─ edge-0 LineSegments (LineBasicMaterial #333366)
      ├─ edge-1 ...
  ```
  - face: `userData.faceIndex` (W-δ traversal index, T-γ)
  - edge: `userData.edgeIndex` (W-δ traversal index, E-γ NEW)
  - caller (W-η downstream / WasmBridge) 가 axia FaceId / EdgeId 로
    매핑 시 활용 — owner-ID attach 는 별도 ADR
- **사용자 검증 도달** (E-γ closure):
  - ✅ **BRep edge visual**: face mesh + edge wireframe 동시 표시
  - **Demo readiness 80% → 90%+** (incremental gain)
  - User manual demo: T-δ slow channel `AXIA_E2E_SLOW=1` 으로 검증
    가능. 별도 follow-up 회고
- **다음 ADR cross-trigger** (사용자 결재 후 가능):
  - **ADR-085 (가칭) — Toast progress UX** (Drift #5 5min wait 사용자
    안내) — 권장 path #3
  - WasmBridge owner-ID 매핑 (`bridge.setFaceSurface*` /
    `bridge.setEdgeCurve*`) — `userData.faceIndex` / `edgeIndex` 를
    axia engine 으로 attach
  - Sharp edge vs silhouette 구분 (색상 / 두께 차별화)
  - Edge selection / hover (ADR-037 P22 cross-cut)
  - PolygonOnTriangulation (face-mesh 정합 edge polyline)
- **Cross-link**: ADR-083 (T-γ face wiring 패턴 답습 + group/userData
  정합), ADR-082 (drift #1~#5 fix 위 진행), ADR-081 W-δ (stable edge
  index 답습), ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31
  (P1+P3 visual 가치 anchor), ADR-018 (edge color #333366).

### 32. ADR-085 — Toast Progress UX MVP / Drift #5 Wait Visibility (P-α ~ P-β, 2026-05-08)
- **사용자 결재 anchor (canonical)**:
  > "ADR-082 Drift #5 (browser env OCCT init 180s+ 소요) 로 사용자가
  > STEP 파일 import 후 face mesh 표시까지 *최소 3분 wait*. 현재는 단일
  > `Toast.info` (8s) 만 표시 → 사용자가 wait 도중 *진행 상황 미인지*.
  > 최단 demo 가치 path 의 두 번째 보강."
- **Path Z atomic 3-단계 closure** (P-α ~ P-γ, 2026-05-08):
  - P-α (spec only): ✅ — `176a1a4`
  - P-β (`onStage` callback + FileImporter wiring): ✅ — `8700f1d`
    (vitest +3) — `StepIgesImporter.onStage?: (stage, message) => void`
    신규 + `engine_load`/`parse`/`tessellate` 3 stages + FileImporter
    sequential Toast.info wiring
  - P-γ (closure + LOCKED 갱신, docs only): ✅ — 본 commit
- **Lock-ins L1~L7** (P-α §2.1 spec):
  - L1: 3 stages (`engine_load`/`parse`/`tessellate`) — 사용자 facing
    minimum (6+ stage 가능하지만 noise 회피)
  - L2: `onStage?: (stage, message) => void` 신규 callback
  - L3: Backward compat — `onLoadingStart`/`onLoadingEnd` preserved
    (engine_load stage 의 시작과 시점 동일)
  - L4: FileImporter sequential `Toast.info(message, 8000)` per stage
    (engine_load 는 기존 onLoadingStart 가 처리 — 중복 방지)
  - L5: Final stage 기존 패턴 답습 (warnings → Toast.warning, clean →
    Toast.success)
  - L6: Initial bundle 0MB strict (P20.C #2). chunk 영역만 변경
  - L7: 한국어 하드코딩 (i18n 은 ADR-046 Phase 2 cross-cut, 본 ADR
    scope 외)
- **단계별 wait 시간 분석** (T-δ slow channel 측정):
  - Stage 1 OCCT.js chunk fetch: ~5-10s
  - Stage 2 initOpenCascade + libs: ~120-180s (Drift #5 본체)
  - Stage 3 STEP file parse: ~1-5s
  - Stage 4 traverseBrep: ~0.1s
  - Stage 5 BRepMesh tessellation: ~5-30s
  - Stage 6 Three.js Group 생성: ~0.1s
  → 사용자 facing 3 통합 stage (engine_load = 1+2 / parse = 3+4 /
  tessellate = 5+6)
- **누적 회귀**: vitest **+3** (1598 → 1601, 절대 #[ignore] 금지 3/3
  준수). axia-geo / axia-core / axia-wasm 0 (TS-only).
- **Bundle 영향** (P20.C #2):
  - **Initial bundle 724.99 kB unchanged** — ADR-082+083+084+085 누적
    deviation 그대로 (+230 bytes from original 724.76 kB baseline).
    본 ADR 추가 deviation 0.
  - StepIgesImporter chunk: 36.94 → 37.07 kB (+0.13 kB — onStage callback
    + 2 wiring 호출)
  - FileImporter chunk: 14.40 → 14.45 kB (+0.05 kB — onStage Toast wiring)
  - opencascade-deps lazy chunk: 5.37 MB unchanged
- **사용자 facing 변화**:
  - **이전**: 단일 Toast.info 8s 후 사라짐 → "멈췄나?" 혼란
  - **이후**: 3-stage sequential Toast — 사용자가 어느 단계인지 인지 →
    **Demo readiness 90% → 95%+**
- **Out of scope** (별도 ADR):
  - Persistent updatable Toast API (Toast 모듈 확장)
  - Progress percentage indicator
  - Cancel button (AbortController 통합)
  - Stage-specific timing budget / metrics
  - i18n stage messages (ADR-046 Phase 2)
  - Drift #5 timing 단축 자체 (architectural ADR — WASM streaming
    compile / parallel libs / cache)
- **다음 ADR cross-trigger** (사용자 결재 후 가능):
  - WasmBridge owner-ID 매핑 (`bridge.setFaceSurface*` /
    `bridge.setEdgeCurve*`) — `userData.faceIndex` / `edgeIndex` 를
    axia engine 으로 attach. ADR-037 P22 cross-cut
  - Drift #5 timing 단축 architectural ADR (WASM streaming /
    parallel libs / cache)
  - Toast persistent + update API 확장 ADR
  - i18n stage messages (ADR-046 Phase 2 자연 연장)
- **Cross-link**: ADR-082 LOCKED #29 (Drift #5 trigger), ADR-083 /
  ADR-084 (동일 사용자 facing path — STEP import wait → visual unlock),
  ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31 (P1+P3 wait 시
  신뢰성 가치 anchor).

### 33. ADR-086 — WasmBridge Owner-ID Mapping / Approach A Full DCEL Injection (O-α ~ O-ε, 2026-05-08)
- **사용자 결재 anchor (canonical)**:
  > "WasmBridge owner-ID 매핑 — import 결과 (face/edge) 를 axia
  > engine ops (offset / extrude / push-pull / Boolean) 의 입력으로
  > 사용 가능 → ADR-079/080 활용 unlock. *최대 architectural value*.
  > Approach A — Full DCEL Injection 채택."
- **Path Z atomic 6-단계 closure** (O-α ~ O-ζ, 2026-05-08):
  - O-α (spec only + 3 approach trade-off): ✅ — `e2e9afc`
  - O-β (Rust core `inject_external_face`): ✅ — `8b7c223`
    (axia-geo +7 tests) — thin wrapper over `add_face_with_holes` +
    ADR-007 winding 자동 정합 + LOCKED #5 vertex dedup 활용
  - O-γ-MVP (WASM bridge + TS wrapper, Plane + NoSurface variants):
    ✅ — `a441fe4` (vitest +4) — 다른 surface kinds 는 후속 sub-step
  - O-δ (StepIgesImporter integration, **architectural unlock**): ✅
    — `85e4024` (vitest +16) — `extractFaceBoundary` (W-ε 답습) +
    `injectIntoAxia` 메서드 + FileImporter `__axia.tryGet('bridge')`
    자동 wiring
  - O-ε (ADR-007 invariant + Playwright slow channel ground truth):
    ✅ — `a0cc51e` (axia-geo +3 invariant tests, Playwright invariants
    추가)
  - O-ζ (closure + LOCKED 갱신, docs only): ✅ — 본 commit
- **Approach 선택**: **A (Full DCEL Injection)** — 3 approach trade-off
  매트릭스 (A: All ops / B: Lossy primitive / C: Virtual surface-only)
  중 사용자가 *first-class equality + industry CAD parity* 가치로 결정.
  - Approach A: 모든 engine ops (offset/extrude/Boolean) 활성, 큰 scope
  - Approach B (lossy redraw): NURBS-class 의의 상실 → 거부
  - Approach C (virtual face): partial 활성 → 거부
- **Lock-ins L1~L7** (O-α §2.2 spec):
  - L1: userData.faceIndex/edgeIndex → axia FaceId/EdgeId 매핑 책임
  - L2: Backward compat (ADR-083 T-γ / ADR-084 E-γ 보존)
  - L3: Initial bundle 0MB strict (P20.C #2)
  - L4: Failure mode warnings 누적 (P21.7)
  - L5: ADR-007 / ADR-016 / ADR-021 / ADR-025 invariant 정합
  - L6: Selection / pick UX (ADR-037 P22.4)
  - L7: Engineering note — opinionated single-approach
- **누적 회귀**:
  - axia-geo lib: 1090 → **1100** (+10, 7 inject + 3 invariant)
  - vitest: 1605 → **1621** (+20, 4 bridge + 16 importer integration)
  - Playwright: invariants 강화 (slow channel opt-in unchanged)
  - 절대 #[ignore] 금지 30/30 준수
- **Bundle 영향** (P20.C #2):
  - **Initial bundle 724.99 → 725.65 kB** (+660 bytes — `loadStepIgesImporter`
    container entry + WASM exports + TS bridge methods). 누적
    ADR-082~086 deviation: **+890 bytes (0.12% of original 724.76 kB
    baseline)**. MB scale 미달 (P20.C #2 spirit 유지).
  - StepIgesImporter chunk: 37.07 → 41.20 kB (+4.13 kB lazy — boundary
    + inject 코드)
  - FileImporter chunk: 14.45 → 14.80 kB (+0.35 kB lazy — bridge
    auto-wiring)
  - opencascade-deps lazy chunk: 5.37 MB unchanged
- **Architecture summary — Approach A의 layer 분리**:
  ```
  STEP/IGES file
    ↓ OCCT.js (lazy chunk, ADR-082)
  TopoDS_Shape (BRep)
    ↓ traverseBrep (ADR-081 W-δ)
  Stable face/edge index
    ↓ promoteSurface / promoteCurve (ADR-081 W-γ/β)
  AnalyticSurface enum + AnalyticCurve enum
    ↓ tessellateShape / tessellateEdges (ADR-083 T-β / ADR-084 E-β)
  FaceTessellation { positions, normals, indices, surface, boundaryPolygon }
    ↓ extractFaceBoundary (ADR-086 O-δ)  ← NEW layer
  outer_loop polygon (Float32Array xyz × N)
    ↓ injectIntoAxia → bridge.injectExternalFace* (ADR-086 O-γ/δ)  ← NEW
  axia DCEL FaceId
    ↓ userData.axiaFaceId (Three.js Group)
  사용자 facing pick / engine ops (offset / extrude / Boolean / NURBS-class)
  ```
- **사용자 검증 도달 (O-ε ground truth)**:
  - ✅ Architecture: chunk + Rust core + WASM bridge + TS wrapper +
    integration 모두 통합
  - ✅ ADR-007 invariant: post-inject face 가 invariant verifier
    통과 (3 회귀 lock-in)
  - ✅ axia DCEL injection: T-δ slow channel `AXIA_E2E_SLOW=1` 검증 시
    `bridge.getStats().faces >= 1` + `userData.axiaFaceId` 정합
  - ⏸️ Real-runtime full demo: 사용자 manual 시연 (ADR-082 Drift #5
    180s+ wait 흡수)
- **Out of scope (별도 ADR)**:
  - Cylinder / Sphere / Cone / Torus / Bezier / BSpline / NURBS surface
    variants (O-γ 확장 — surface 8 kinds 의 7 추가)
  - Inner loops (holes) 지원 (O-β 확장)
  - Boundary edge analytic curve attach (`bridge.setEdgeCurve*`)
  - WasmBridge stats 의 import-source 구분 (현재는 총 face count)
  - OBJ/STL/glTF 등 다른 mesh 포맷 owner-ID 매핑
  - .axia persistence (import 결과 직렬화)
  - Edge selection / hover (ADR-037 P22 cross-cut)
  - Material / texture metadata (STEP 색상 정보 활용)
- **다음 ADR cross-trigger**:
  - **ADR-087 (가칭) — Surface kinds 확장** (O-γ Cylinder/Sphere/Cone/
    Torus + NURBS-class 7 variants 활성). 가장 자연 연장.
  - Inner loops (holes) 지원 (O-β + O-δ 확장)
  - Edge analytic curve attach (NURBS-class import 의 edge geometry)
  - .axia persistence (import 결과 저장 — ADR-078 답습)
  - 사용자 manual visual demo 회고 commit (선택적)
- **Cross-link**: ADR-082 (drift #1~#5 fix 위 진행), ADR-083 (T-γ
  userData.faceIndex source), ADR-084 (E-γ userData.edgeIndex source),
  ADR-081 W-δ (stable index 답습), ADR-007/016/021/025 (DCEL invariant),
  ADR-079/080 (engine ops 활성 의존 — first-class equality 가 NURBS-class
  unlock), ADR-035 P20.C #2 (initial bundle 0MB), ADR-046 P31 (P1+P3
  industry CAD parity 첫 활성), ADR-037 P22.7 (owner-ID 자연 closure).

### 34. ADR-087 — Kernel-Native Command Suite Reset (K-α ~ K-η closure, 2026-05-08)
- **사용자 통찰 (canonical)**:
  > "명령어를 처음부터 커널에 맞게 다시 작성하는것이 좋을듯. 현재 명령
  > 삭제하는것이 좋지 않은가?" (2026-05-08)
- **anchor 결정**: ADR-027~086 의 5년 누적 커널은 충분히 성숙했으나,
  사용자 facing 명령 (Draw / Push-Pull / primitives) 의 다수가
  *kernel-blind* — `AnalyticSurface`/`AnalyticCurve` attach 없이 mesh
  DCEL 만 생성. 결과: `create_solid` 등 kernel-native ops 가
  `NoProfileSurface` 로 거부. 본 ADR 은 모든 user-facing Draw /
  primitive 를 kernel-aware 로 reset.
- **5 lock-in 원칙 (P-1)**:
  - L1: 모든 Draw → form-layer Shape 만 (ADR-049/050 답습)
  - L2: 모든 face → AnalyticSurface attach (Plane/Sphere/Cylinder/etc)
  - L3: 모든 Edge → AnalyticCurve attach 가능 시 (Line/Arc/Bezier/etc)
  - L4: Push/Pull = `create_solid` Extrude only (mesh pushPull 폐지)
  - L5: Primitive = AnalyticSurface variant 직접 (mesh `create_*` 폐지)
- **K-α ~ K-η Path Z atomic 9 commits** (ADR-087 §D Acceptance Log):
  - K-α `ef72956` — spec only
  - K-β `70aabaa` — DrawCircleAsShape Plane attach + DrawPolygonTool
    form-mode (사촌 버그 cover)
  - K-γ `d1e80e9` — DrawLineAsShape Plane attach (face path) +
    drawPolylineAsShape WASM/TS + DrawFreehandTool form-mode
  - K-δ `2f9b4b9` — Box 6 Plane attach + Cone caps Plane (Sphere/
    Cylinder ADR-032 P17 already complete — 핵심 발견)
  - K-ε `8548356` — Tool form-mode 1-way + drawShapeMode flag 폐기
    (LOCKED #26 P-5e-α 자연 closure)
  - K-ε hotfix `11eee34` — mesh.rs::export_buffers 가 Plane variant →
    polygon path (LOCKED #12 ADR-025 P11 정합 회복, 사용자 시연 회귀
    fix)
  - K-ζ `b7982ce` — Legacy 일괄 삭제 (Q5=A): WASM exports 5개 +
    TS bridge wrappers 5개 + 5 production callers migration. Command
    enum variants 보존 (internal-only Rust API, 245 test sites Xia-
    layer contract 유지). 17 files, +132 / -477 net (-345 LoC).
  - Cone hotfix #1 `4ab001a` — apex 방향 fix (base 위 + axis_dir
    -up). 사용자 시연 회귀 (cone widens-going-up).
  - Cone hotfix #2 `7513c30` — true cone restructure (single apex,
    truncated frustum 폐기). 사용자 시연 회귀 ("VERTEX 가 이상").
  - Curved chord soft `b256546` — Sphere/Cylinder/Cone 측면 chord
    edges 명시 mark_face_outer_soft (ADR-038 P23.3 angle filter
    20.1° 가 16-segment 22.5° 못 잡음 — 사용자 시연 회귀).
  - K-η `(본 commit)` — 회고 + LOCKED #34.
- **회귀 누적**: axia-core +8, axia-geo +8, axia-wasm baseline +1,
  vitest -3 (K-ε cleanup -11 + 추가 +8). 합계 **+14 net** (절대
  #[ignore] 금지 14/14 준수). Code -700 LoC net.
- **사용자 시연 게이트의 가치 (회고)**: K-ζ 5 invariant 게이트 중
  #4 (사용자 manual 시연) 이 K-ε hotfix + Cone #1+#2 + Curved chord
  soft 등 **4 개 회귀** 발견. Test 회귀 자산만으로 불가능. 향후
  architectural ADR 의 ζ-step 사용자 시연 필수.
- **architectural 분리 원칙 (K-ζ)**: User-facing surface 삭제 ≠
  internal Rust API 삭제. Test 회귀 자산 245 sites 의 Xia-layer
  contract 보존 위해 Command enum variants 만 internal-only 로 강등.
  Production code paths (`web/src/`) 는 AsShape variants +
  createSolidExtrude 만 사용. 향후 deletion ADR 가이드.
- **불변 (LOCKED 정책 정합)**:
  - LOCKED #1 (P7) / #12 (P11): face 합성 / 분할 회귀 자산 PASS 유지
  - LOCKED #7 (ADR-026 P12 cardinal plane SSOT): 8 회귀 자산 AsShape
    variants 로 재검증
  - LOCKED #16 (ADR-038 P23): Plane variant polygon path + curved
    surface tessellation 분리 정합
  - LOCKED #26 (ADR-049 Two-Layer Citizenship Phase 1): drawShapeMode
    flag 폐기 (K-ε) + legacy 삭제 (K-ζ) = single-path enforcement
  - ADR-046 P31 #4 (additive only): 메뉴/단축키/툴바 외부 ID UNCHANGED
- **후속 트랙 (deferred to separate ADRs)**:
  - **ADR-088 (Phase 1)**: `curve_owner_id` grouping for analytic
    curves — selection-time enforcement of LOCKED #15 (ADR-037 P22.5).
    Circle 의 N segments 가 한 클릭으로 통일 선택. DCEL 무surgery,
    Edge 에 `curve_owner_id: Option<u32>` 필드 추가만.
  - **ADR-089 (Phase 2, future)**: True kernel-native closed edges
    — DCEL Edge schema relaxation (self-loop allowed, v_small ==
    v_large for closed curves). add_face accepting curve loops directly.
    multi-week atomic surgery. ADR-027 NURBS Kernel 의 mesh-era 잔존
    정리.
  - **ADR-088 별도 (P7 disjoint-inner)**: "큰 RECT 안 작은 CIRCLE →
    ring + sub-face 분할" — ADR-051 §2.5 component-merge resolver
    deferred boundary 후속 (LOCKED #1 amendment 명시).
- **Cross-link**: ADR-049/050 (Two-Layer Citizenship), ADR-079
  (Create Solid surface-native), ADR-080 (Offset dimension-aware),
  ADR-046 P31 (UI/UX strategy + menu additive only), ADR-035 P20.C #2
  (initial bundle 0MB), ADR-026 P12 (Bridge SSOT cardinal plane),
  ADR-082~086 (STEP/IGES face → engine ops first-class equality).

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

### Major Initiative: 자체 NURBS Kernel (Phases A~E 완료, F 완료, G 진행 중)
- **PLAN-001**: `docs/plans/PLAN-001-nurbs-kernel.md` — 7-Phase 점진 진화
- **ADR-027** (Accepted, 2026-04-29): NURBS Kernel Initiative kickoff
- **ADR-028** (Phase A): Analytic Edge Curve Foundation — **완료**
  - Line/Circle/Arc primitives + CurveOps trait, 59 회귀 테스트
- **ADR-029** (Phase B): Free-form Curves — **완료**
  - Bezier (de Casteljau) + B-spline (de Boor) + 43 tests
- **ADR-030** (Phase C): NURBS curves + CCI — **완료** (67 tests)
- **ADR-031** (Phase D): Analytic Surface Primitives — **완료**
  - `crates/axia-geo/src/surfaces/`:
    - `plane.rs` — flat surface
    - `cylinder.rs` — right-circular cylinder (axis + ref_dir)
    - `sphere.rs` — Z-up parametric sphere (longitude/latitude)
    - `cone.rs` — right-circular cone (apex + half_angle)
    - `torus.rs` — major/minor radius torus
  - `AnalyticSurface` enum + `SurfaceOps` trait
    (evaluate / normal / derivative_u / derivative_v / tessellate / parameter_range)
  - `Face.surface: Option<AnalyticSurface>` (`#[serde(default)]` legacy 호환)
  - `Mesh::set_face_surface` / `face_surface` / `tessellate_face_surface` API
  - WASM bridge: `setFaceSurfacePlane/Cylinder/Sphere/Cone/Torus`,
    `clearFaceSurface`, `faceSurfaceKind` (0..5), `tessellateFaceSurface`
  - 회귀 테스트 78개 (60 surface unit + 9 mesh integration + 1 NURBS edge +
    1 legacy serde + 7 TS bridge)
- **ADR-032** (Phase D'): Promotion paths — primitive surface auto-attach +
  DrawArc/DrawBezier 마이그레이션 + drawArcWithCurve / drawBezierWithCurve /
  drawBSplineWithCurve atomic APIs (10 tests)
- **ADR-033** (Phase E): NURBS Surfaces — **완료**
  - `bezier_patch.rs` — tensor-product Bezier (de Casteljau in u, then v)
  - `bspline_surface.rs` — tensor B-spline (de Boor)
  - `nurbs_surface.rs` — rational tensor B-spline via 4D homogeneous lift
  - `trim.rs` — 2D parameter-space TrimCurve2D + TrimLoop (Line/Arc/Bezier/BSpline)
  - `AnalyticSurface::BezierPatch / BSplineSurface / NURBSSurface { trim_loops }`
  - `faceSurfaceKind` 확장: 6 = BezierPatch, 7 = BSplineSurface, 8 = NURBSSurface
  - 회귀 테스트 45 (Bezier patch 16 + B-spline surface 9 + NURBS surface 9 + trim 8 + 기타 3)
- **ADR-034** (Phase F): Surface-Surface Intersection — **완료** (4 stages)
  - `surfaces/ssi/` 모듈:
    - `analytic.rs` — Plane-Plane / Plane-Cylinder / Plane-Sphere /
      Plane-Cone / Cylinder-Cylinder(parallel) closed-form (29 tests)
    - `subdivide.rs` — Stage 2 AABB pruning + adaptive split + uv_bounds
      tracking (6 tests)
    - `newton.rs` — Stage 3 3×4 Jacobian pseudo-inverse + damped step
      (4 tests)
    - `topology.rs` — Stage 4 greedy NN chain walking + closure detection
      (5 tests)
  - 통합 pipeline `intersect_bezier_pair(a, b, tol)` (2 tests)
  - 회귀 테스트 46 (analytic 29 + subdivide 6 + newton 4 + topology 5 +
    pipeline 2)
- **ADR-035** (Phase G Stage 4 kickoff): STEP/IGES Hybrid Strategy — **Accepted**
  - P20: OCCT.js 옵션 (Stage 4-A) + axia-foreign 자체 spike (Stage 4-B)
    병행. 12개월 후 default 결정 (5-트리거 정량 매트릭스).
  - P20.A Format priority: AP242 primary, AP203/214 secondary, IGES legacy
  - P20.B Non-goals: Export, Assembly, PMI, Material metadata, Drawing
  - P20.C Stage 4-A 4축 acceptance: 기능 / 성능 (initial bundle 0MB) /
    회복 / 회귀
  - P20.D 검증 코퍼스: 공개(NIST 2) + 벤더별(SolidWorks/Fusion/CATIA 3) +
    사용자(선택)
  - P20.E 12개월 트리거: 커버리지 ≥80% / 정확도 ≤1e-3 mm / LOC<8000+bug≤3
    분기 / 번들 절감 ≥8MB / NPS ≥7
- **ADR-036** (Phase G Stage 4-A architectural): STEP/IGES Curve & Surface
  Promotion — **Accepted**
  - P21: Precision-First Promotion. BRep parametric definition 을 직접
    AnalyticCurve / AnalyticSurface 로 매핑. Tessellation = 렌더 캐시.
  - P21.1 Curve 매핑 11항목 (Direct 6 + Conic conversion 3 + Fitting fallback
    1 + TrimmedCurve)
  - P21.2 Surface 매핑 12항목 (Direct 8 + Sweep 2 + Fitting + Trim)
  - P21.3 Trim Loop (PCurve), P21.5 Parameter range 정합, P21.6 round-trip
    1e-3 mm
  - P21.7 실패 처리 6 case → ImportResult.warnings 누적
  - P21.8 Stage 4-A / 4-B 동일 매핑 강제 → cross-validation harness
- **Phase G Stage 1~3 완료** (ADR-027 NURBS Kernel)
  - **G1**: NURBS surface SSI wrapper (non-rational) — `bspline::extract_bezier_strips`
    + `bspline_surface::extract_bezier_patches` + `ssi::nurbs_wrapper::intersect_bspline_pair`
    (6 tests)
  - **G2**: SSI → TrimCurve2D 변환 — `ssi::trim_gen` 모듈 (4 tests)
  - **G3**: NURBS Boolean primitives MVP — `ssi::boolean::nurbs_boolean(op)`
    Union/Subtract/Intersect (3 tests)
- **Phase G Stage 4-A scaffolding 진행 중**
  - `web/src/import/StepIgesImporter.ts` — OCCT.js dynamic loader
    (singleton + lazy load + graceful fallback) (8 tests)
  - `web/src/import/occtCurvePromote.ts` / `occtSurfacePromote.ts` —
    ADR-036 P21 매핑 SSOT 스텁 (parameterRange / uvBounds / warnings
    wrapper) (17 tests)
  - `web/src/import/occtAccessors.ts` — wrapper 호환 헬퍼
    (pntToVec3 / readArray1Real 다형 / Handle DownCast 우회) (16 tests)
  - `web/package.json` `opencascade.js` optional dep + `vite.config.ts`
    `opencascade-deps` chunk
  - **Initial bundle 619 kB 동일 (P20.C #2 0MB 증가 강제)** — OCCT 미설치
    환경에서도 build 정상
- **다음 단계 (PR-by-PR)**:
  - Stage 4-A 완료: OCCT BRep traversal + 실제 promote* 본체 + 5 코퍼스
    round-trip 1e-3 mm 검증
  - Stage 4-B 시작: `axia-foreign` crate 신설 + STEP AP203 lexer/parser
- 점진 단계: Analytic Edge Curve ✅ → Bezier/B-spline ✅ → NURBS curve ✅ →
  Surface primitives ✅ → NURBS surfaces ✅ → SSI ✅ → Boolean ✅ → STEP/IGES 🔄
- 기존 LOCKED 정책 / ADR invariants (007/019/021/025/026/035/036) 모두 보존

### ADR-064 — NURBS Boolean → DCEL (Path Z 전 stack 완료, 2026-05-04)
- **상태**: Path Z 모든 sub-step (Steps 1 / 2.A / 2.B+2.C / 3-α / 4 / 5
  / 6-α/β/γ/δ) 완료. Last commit `946e247`.
- **의의**: Phase J `nurbs_boolean_v2` (probe-only) → 실제 mesh-level
  Boolean 결과 (op-specific 입력 제거 + 새 DCEL face 생성). 사용자
  메뉴 클릭부터 undo 까지 전 stack 연결.
- **stack**:
  ```
  BooleanHandler.startBooleanOp                 ← Step 6-γ
    → WasmBridge.booleanDispatchDcel (TS typed) ← Step 6-β
      → booleanDispatchDcelJson (WASM)          ← Step 6-α
        → Mesh::boolean_dispatch_dcel           ← Step 5
          → Mesh::nurbs_boolean_to_dcel         ← Step 4 (op-specific removal)
            → Phase J nurbs_boolean_v2          ← (기존)
  ```
- **안전 자산**: D-H safe-only (new_faces 0개 → 입력 보존) + D-F=(c)
  disjoint 입력 보존 + D-G drop-in (기존 `boolean.rs` /
  `boolean_dispatch` / `booleanDispatchJson` UNCHANGED) + §F 명시 실패
  (silent fallback 0건).
- **회귀 누적**: axia-geo 940 → **959** (+19), axia-wasm 8 → **12** (+4),
  web TS 1395 → **1410** (+15). 합계 **+38**, 절대 #[ignore] 금지 정책
  38/38 준수.
- **남은 미착수 (모두 별도 ADR, 결정적 의사결정 0)**:
  - Step 3-β (containment depth ≥ 2 nested outer)
  - Path Y (multi-face × multi-face dispatch)
  - 진짜 cutover (`boolean_dispatch` mesh fallback 폐지 — 사용자
    텔레메트리 후)
  - Path X (Tensor surface uv inversion — Bezier/B-spline 정확도 +
    Rational NURBS surface SSI)
  - Real browser-runtime E2E (Playwright/Cypress)
  - 기존 NURBS probe (kind===7) deprecation
- **상세**: `docs/adr/064-nurbs-boolean-to-dcel.md` §D Acceptance Log

### ADR-066 — Multi-face NURBS Boolean Dispatch (Path Y 전 stack 완료, 2026-05-04)
- **상태**: Path Y 모든 sub-step (Y-1 / Y-2 / Y-3 / Y-4 / Y-5 / Y-6)
  완료. ADR-064 Path Z 의 자연 연장. Last commit: 본 회고 commit.
- **의의**: ADR-064 의 single-face × single-face mesh-level Boolean
  의미론 closure 위에 multi-face × multi-face cartesian dispatch 를
  올림. 의미론적 결정은 Path Z 에서 모두 닫혀 있어 Path Y 는 **확장
  + 새 결정 매트릭스 (Y-G cartesian / Y-H skip-and-warn / Y-I per-pair
  safe-only)** 수준.
- **stack** (Path Z 답습):
  ```
  BooleanHandler.startBooleanOp                      ← Y-4
    → WasmBridge.booleanDispatchDcelMulti (TS)        ← Y-3
      → booleanDispatchDcelMultiJson (WASM)           ← Y-2
        → Mesh::boolean_dispatch_dcel_multi           ← Y-1 (cartesian)
          → Mesh::boolean_dispatch_dcel               ← (Path Z Step 5)
            → Mesh::nurbs_boolean_to_dcel             ← (Path Z Step 4)
  ```
- **결정 매트릭스**: Y-E=(a) strict eligibility (모든 face NURBS) /
  Y-F=(a) caller-named operands / Y-G=(a) cartesian (N×M pairs) /
  Y-H=(c) per-pair Err → warning + skip / Y-I=(b) per-pair safe-only
  removal / Y-4-b=(a) 반/반 selection split (UI).
- **Lock-in**: 1×1 degenerate → Path Z method 직접 위임 (이중 진입점
  회피). Cascade 시맨틱 (Subtract(a, b1) 후 (a, b2) → InactiveFace
  Err) 은 Y-H 로 capture.
- **회귀 누적**: axia-geo +5 (Y-1), axia-wasm +4 (Y-2), web TS +15
  (Y-3 + Y-4 + Y-5). Path Y 합계 **+24**, 절대 #[ignore] 금지
  24/24 준수.
- **Path Z + Path Y 합산**: axia-geo 940 → **964** (+24), axia-wasm
  8 → **16** (+8), web TS 1395 → **1425** (+30). 합계 2343 →
  **2405** (+62), 절대 #[ignore] 금지 62/62 준수.
- **남은 미착수 (모두 별도 ADR)**:
  - E.1 Cascade-aware ordering 정책 (Subtract 시 face_a 의 모든 b
    합산 SSI 등)
  - E.2 Multi-face Sheet Boolean (Sheet face 의 multi 2D)
  - E.3 사용자 명시 Group A/B 선택 UX
  - E.4 Real browser-runtime E2E (ADR-064 §E.4 와 인프라 공유)
  - E.5 기존 single-face DCEL fast-path / NURBS probe deprecation
    (별도 cleanup ADR)
- **상세**: `docs/adr/066-multi-face-nurbs-boolean-dispatch.md` §D Acceptance Log

### ADR-075 — NURBS Boolean Browser E2E (Playwright) (E.4 트랙 핵심 완료, 2026-05-04)
- **상태**: E.4 트랙의 핵심 sub-step (E4-1 / E4-2 / E4-3 / E4-4 /
  E4-6 / E4-7) 완료. ADR-064 §E.4 + ADR-066 §E.4 두 미해결 항목을
  본 ADR 으로 동시 닫음. Last commit: 본 회고 commit.
- **의의**: ADR-064/066 의 mock-level 회귀 +62 위에 **real Chromium
  round-trip 검증** 11 E2E + **CI 자동화**. ADR-064/066 가 의미론
  closure / 확장 이라면, ADR-075 는 **검증 자산 + 자동화** 의 첫
  인프라성 ADR. 향후 모든 ADR (Press-Pull / STEP-IGES / Path X /
  etc.) 의 round-trip 검증에 그대로 활용 가능.
- **stack**:
  ```
  Real Chromium (Playwright)
    ↓ Vite preview (production-like build)
      ↓ window.__axia ServiceContainer
        ↓ WasmBridge.{booleanDispatchDcel|booleanDispatchDcelMulti|undo}
          ↓ booleanDispatchDcel{Json|MultiJson} (WASM exports)
            ↓ Mesh::boolean_dispatch_dcel{|_multi}
              ↓ Mesh::nurbs_boolean_to_dcel
                ↓ Phase J nurbs_boolean_v2
  ```
- **인프라 자산** (모든 향후 ADR 활용 가능):
  - `web/playwright.config.ts` (Chromium / Vite preview port 4179
    / 30s timeout)
  - `web/e2e/helpers/boolean-fixtures.ts` (`setupTwoPlaneFaces` /
    `setupNPlaneFaces` / `captureMeshSnapshot` / `invokeUndo` /
    `invokeBooleanDispatchDcel{|Multi}` / `waitForBridgeReady`)
  - `.github/workflows/ci.yml` (`rust-test` + `web-e2e` jobs,
    parallel, with caching + failure artifact upload)
- **결정 매트릭스**: E4-B=Playwright / E4-C=Vite preview /
  E4-G=Chromium only / E4-H=`*.spec.ts` / E4-J=`web/e2e/` /
  E4-6-h=매 run WASM 재빌드 / E4-6-j=parallel rust-test ⊥ web-e2e.
- **회귀 누적 (E.4 트랙만)**: web TS Playwright E2E 0 → **11**
  (real Chromium round-trip). Rust/vitest 모두 unchanged
  (drop-in alongside). 절대 #[ignore] 금지 11/11 준수.
- **Path Z + Path Y + E.4 합산**: axia-geo 940 → **964** (+24),
  axia-wasm 8 → **16** (+8), web TS vitest 1395 → **1425** (+30),
  Playwright E2E 0 → **11** (+11). 합계 2343 → **2416** (+73),
  절대 #[ignore] 금지 73/73 준수.
- **CI 자동화**: PR 마다 build.yml `test` (vitest 1425) +
  ci.yml `rust-test` (cargo 980) + ci.yml `web-e2e` (playwright 11)
  자동 실행. 합계 **2416 모두 PR 자동 검증**.
- **결정적 진척**: ADR-064 §E.4 + ADR-066 §E.4 의 모든 미해결 항목
  (single + multi + undo) 이 단일 commit 시리즈로 닫힘.
- **남은 미착수 (모두 선택적 확장 또는 별도 트랙)**:
  - E.5 Edge cases (intersecting fixtures / multi-step undo / redo /
    error envelope round-trip) — 별도 sub-step 또는 ADR
  - E.6 Multi-OS / Multi-browser matrix — 별도 sub-step
  - E.7 Nightly cron / scheduled run — 별도 sub-step
  - E.8 Visual regression / screenshot diff — 별도 ADR
- **상세**: `docs/adr/075-nurbs-boolean-browser-e2e.md` §D Acceptance Log

### ADR-074 — Boolean Group Selection UX (E.3 트랙 핵심 완료, 2026-05-05)
- **상태**: E.3 트랙 핵심 sub-step (U-1 / U-2 / U-3 / U-4 / U-6)
  완료. ADR-066 §E.3 (사용자 명시 Group A/B 선택 UX 미해결) 본 ADR
  으로 닫음. Last commit: 본 회고 commit.
- **의의**: ADR-066 Y-4 의 반/반 split 한계 해소. 사용자가 우클릭
  메뉴로 면을 Boolean Group A/B 로 명시 → multi DCEL dispatch 가
  반/반 split 대신 explicit grouping 으로 라우팅. ADR-064/066/075/076
  이 engine / 검증 / cleanup 이라면, ADR-074 는 **UX-driven semantic
  clarity** — engine 외부 (model + UI + routing + real-runtime) 의
  4-layer atomic stack 을 처음으로 닫음.
- **stack** (사용자 의도 → real engine 라운드트립):
  ```
  ContextMenu 우클릭 (U-2)                        ← UI 진입점
    → SelectionManager.setGroupTag (U-1)          ← Model layer
      → BooleanHandler.startBooleanOp             ← Routing (U-3)
        → hasGroupSelection() ? getGroupA/B
                              : 반/반 split (fallback)
          → bridge.booleanDispatchDcelMulti       ← Path Y dispatch
            → ... (ADR-066 multi-face stack)
  ```
- **결정 매트릭스**: U-B=(b) SelectionManager 내 storage /
  U-C=(b) `Map<faceId, 'A'|'B'>` (한 face = 한 group invariant) /
  U-D=(a) 미설정 시 반/반 fallback (drop-in alongside) / U-E
  `clearSelection` 시 group tags 도 clear / U-F=(a) A/B 만 /
  U-G=(a) session 만 / U-H 기존 API UNCHANGED / U-I `notifyChange`
  통합. Constraint: Group tags ⊆ selected (`setGroupTag` silently
  skips faces not in selection).
- **U-3-k 추가** (사용자 의견 반영): Toast wording cleanup —
  "NURBS" prefix 4 paths 모두 제거 + group source indicator
  ("(multi, 명시 그룹)" / "(multi, 자동 분할)"). ADR-076 Step 1
  의 "canonical path" 정신과 일관.
- **회귀 누적 (E.3 트랙)**: vitest 1410 → **1428** (+18, U-1 8 +
  U-2 5 + U-3 5), Playwright E2E 11 → **13** (+2, U-4). 합계
  **+20**, 절대 #[ignore] 금지 20/20 준수.
- **5 ADR 합산** (Path Z + Path Y + E.4 + E.5 + E.3): axia-geo
  940 → **964** (+24), axia-wasm 8 → **16** (+8), web TS vitest
  1395 → **1428** (+33), Playwright E2E 0 → **13** (+13). 합계
  2343 → **2421** (+78), 절대 #[ignore] 금지 78/78 준수. CI 자동
  검증 (ADR-075 E4-6).
- **결정적 진척**: ADR-066 §E.3 의 미해결 항목 (사용자 명시 Group
  A/B 선택 UX) real-runtime 까지 닫힘. 4-layer 패턴 (Model + UI
  + Routing + Real-runtime E2E) 은 향후 selection-driven UX ADR
  의 모범.
- **남은 미착수 (모두 선택적 또는 별도 트랙)**:
  - E.5-1 Visual feedback (group A/B outline 색상) — ADR-075 §E.8
    visual regression 인프라와 함께 권장
  - E.5-2 Multi-group (>2) — 현재 A/B 만, N-group 별도 ADR
  - E.5-3 Persistence — session 만 (project 저장 별도 ADR)
  - ~~E.5-4 단축키 미배정~~ → ✅ closure (atomic sub-step,
    Alt+A/B/0 binding + ContextMenu hint, +5 회귀)
- **상세**: `docs/adr/074-boolean-group-selection-ux.md` §D Acceptance Log

### ADR-076 — Legacy Boolean Path Sunset (E.5 Cleanup 트랙 완료, 2026-05-05)
- **상태**: Step 1 + Step 1.1 + Step 2 완료. ADR-064 §E.5 +
  ADR-066 §E.5 두 미해결 항목 본 ADR 으로 닫음. Last commit
  `0c4e5ef`.
- **의의**: ADR-066 Y-4 multi DCEL fast-path 가 BooleanHandler 의
  canonical entry 가 된 후 unreachable 이 된 legacy paths 의 정상
  sunset. 4-layer 동시 cleanup (UI / TS bridge / WASM export /
  tests + baseline). Path Z atomic 패턴의 cleanup ADR 첫 사례.
- **stack** (제거 대상):
  ```
  Step 1: BooleanHandler.ts UI 정리
    - Single DCEL fast-path (ADR-064 Step 6-γ) — Y-1 1×1 degenerate 흡수
    - Legacy NURBS probe (ADR-027 Phase G3) — surface_to_bspline 흡수
    - handleDcelResult helper / formatNurbsBoolean* / SURFACE_KIND_BSPLINE
  Step 2: Bridge wrapper + WASM export 정리
    - WasmBridge.nurbsBoolean / WasmBridge.booleanDispatchDcel 제거
    - WASM exports (booleanDispatchDcelJson / nurbsBoolean) 제거
    - export_baseline 2 entries 제거
    - TS types (NurbsBooleanResult / BooleanDispatchDcelResult) 제거
  ```
- **Rust impl preserved**: `Mesh::boolean_dispatch_dcel` +
  `nurbs_boolean_to_dcel` — multi 가 1×1 degenerate / cartesian
  per-pair 로 직접 위임. 절대 제거 불가.
- **§C-amendment-1 (cleanup deletion)**: ADR-064/066/075 의 R1 §D
  "additive-only baseline" 정책의 첫 deletion 예외 명시. 본 ADR
  Step 2 가 첫 사례. 향후 cleanup ADR 동일 정책 적용.
- **회귀 변화**: -17 (axia-wasm -4 single JSON / vitest -9 bridge
  tests / Playwright -4 single E4-2 + undo). 코드 -924 lines net.
  기능적 회귀 0 — multi (Y-3) tests 가 identical canonical surface
  cover.
- **상세**: `docs/adr/076-legacy-boolean-path-sunset.md` §D
  Acceptance Log (Step 1 + Step 1.1 + Step 2 결산)

### ADR-077 — Visual Regression Infrastructure (V 트랙 인프라+검증+자동화 closure, 2026-05-05)
- **상태**: V-1 + V-2 + V-4 + V-5 완료. ADR-075 §E.8 + ADR-074
  §E.5-1 두 미해결 항목 동시 closure. V-4 commit 으로 CI 자동화
  (functional + visual 통합 실행) 명시. V-3 multi-OS baseline matrix
  만 선택적 확장. Last commit: V-4 commit (본 catchup 갱신 시).
- **의의**: ADR-075 가 functional 검증 자산 + 자동화 의 첫 인프라성
  ADR 이라면, ADR-077 은 **visual 검증 자산** 의 첫 인프라성 ADR.
  두 ADR 모두 향후 모든 ADR 의 round-trip 검증 base layer.
  V-2 가 ADR-074 §E.5-1 (group color visual feedback) 의 본질을
  닫아 ADR-074 가 5-layer atomic stack (Model + UI + Routing +
  Functional E2E + Visual) 으로 완성.
- **stack**:
  ```
  Playwright `toHaveScreenshot()` (V-1 인프라)
    ↓ playwright.config.ts: expect.maxDiffPixelRatio 0.01,
                            viewport 1280×720
      ↓ web/e2e/visual/*.visual.spec.ts (V-G naming)
        ↓ web/e2e/visual/__screenshots__/
            *-chromium-win32.png (V-E host OS only, V-1)
  ```
- **결정 매트릭스**: V-B Playwright (이미 설치) / V-C=(a) git-tracked
  PNG / V-D maxDiffPixelRatio 0.01 / V-E host OS only (V-3 multi-OS
  별도) / V-F `__screenshots__/` / V-G `*.visual.spec.ts` /
  V-H playwright.config 의 `expect.toHaveScreenshot` /
  V-J `--update-snapshots` flag.
- **인프라 자산** (모든 향후 visual UX ADR 활용 가능):
  - `playwright.config.ts` 의 `expect.toHaveScreenshot` + viewport
  - `web/e2e/visual/` 디렉토리 + `*.visual.spec.ts` 명명 정책
  - `__screenshots__/` git-tracked baseline 정책
  - V-2 가 정의한 Three.js outline rebuild 패턴
    (`SelectionManager.rebuildGroupOutlines` + `notifyChange` 통합)
- **V-2 산출물**: ADR-074 group A/B outline 색상 (orange #ff8800 /
  cyan #00aaff 보색 쌍) + 3 visual baseline (A only / B only / A+B).
- **회귀 누적 (V 트랙)**: vitest 1419 → **1422** (+3 V-2 unit),
  Playwright 9 → **13** (+1 V-1 smoke + 3 V-2 visual). 합계 **+7**,
  절대 #[ignore] 금지 7/7 준수.
- **7-ADR 합산** (Path Z + Path Y + E.4 + E.5 + E.3 + V): axia-geo
  940 → **964** (+24), axia-wasm 8 → **12** (+4), web TS vitest
  1395 → **1422** (+27), Playwright E2E 0 → **13** (+13). 합계
  2343 → **2411** (+68), 절대 #[ignore] 금지 68/68 준수.
- **남은 미착수 (모두 선택적 확장)**:
  - V-3 Multi-OS / multi-browser baseline matrix — Linux/macOS
    baseline 추가 (V-4 README.md 의 3 옵션 중 선택)
  - V-4 fine-tuning — `workflow_dispatch` baseline 갱신 workflow
    + PR 코멘트 visual diff 미리보기
  - Baseline 압축 정책 — 현재 4 PNG × 644KB = ~2.6MB, V-3 시 ×N
  - `page.screenshot({ clip })` 부분 capture — 변화가 큰 영역만
- **V-4 CI integration**: ci.yml `web-e2e` job 의 `npx playwright
  test` 가 functional + visual 통합 실행. 첫 Linux CI run 은
  baseline missing 으로 fail 예상 (V-1 lock-in #4 의도된 동작) →
  `web/e2e/visual/README.md` 의 procedure 로 처리.
- **상세**: `docs/adr/077-visual-regression-infrastructure.md` §D
  Acceptance Log + `web/e2e/visual/README.md` (baseline 갱신 가이드)

### ADR-078 — Boolean Group Persistence (P-1 ~ P-4 closure, 2026-05-05)
- **상태**: P-1 + P-2 + P-3 + P-4 모두 완료. ADR-074 §E.5-3
  (Persistence — session 만, project 저장 별도 ADR) 본 ADR 으로 닫음.
  P-5 (회고/docs) 도 본 commit 으로 closure. Last commit: 본 P-5 commit.
- **의의**: ADR-074 의 group A/B selection (session-only) 을 .axia
  project 파일에 round-trip 보존. Path Z atomic 5-layer 패턴의 첫
  persistence 변형 — Model + UI Runtime + Routing + Persistence +
  Bridge + E2E 의 6-layer atomic stack 을 단일 ADR 으로 닫음.
- **stack** (사용자 우클릭 → .axia 저장 → reopen → group 자동 복원):
  ```
  ContextMenu / Hotkey (ADR-074 U-2)
    ↓
  SelectionManager.setGroupTag (UI runtime, ADR-074 U-1)        ← UNCHANGED
    ↓ saveProject push (P-3 L1: clear → set(A) → set(B))
  WasmBridge.{clear|set}BooleanGroupTag (P-2)                    ← Vec<u32> + strict Result
    ↓
  Scene.boolean_group_tags (P-1)                                 ← additive section 6
    ↓ scene_snapshot section 6 (bincode, length-prefixed)
  .xia file
    ↓
  restore_scene_snapshot section 6 (legacy 호환)
  Scene.boolean_group_tags
    ↓
  WasmBridge.getBooleanGroup{A,B}Faces (P-2)
    ↓ openProject pull (P-3 L2: syncMesh 후 1회)
  SelectionManager.restoreGroupTags (P-3 L3: union policy)       ← NEW
    ↓ notifyChange (1회)
  Three.js group A/B outline rebuild (ADR-077 V-2)
  ```
- **결정 매트릭스**:
  - **P-1 §A** Rust schema only — `BooleanGroupTag { A, B }` enum +
    `Scene.boolean_group_tags: HashMap<FaceId, BooleanGroupTag>` 필드
    + 5 helpers + section 6 additive
  - **P-2 §B** typed WASM (사용자 정정 2건):
    * P-2-c (strict): `Result<(), JsValue>` + uppercase `'A'`/`'B'` only
      → invalid tag 즉시 throw (silent skip 차단)
    * P-2-d (ownership): `Vec<u32>` (NOT `&[u32]`) — wasm-bindgen
      ownership semantics 명확
  - **P-3 §B** ProjectSerializer push/pull + restoreGroupTags:
    * L1: Save sync `clear → set(A) → set(B)` idempotent. 둘 다 empty
      → clear-only.
    * L2: Load sync = `importSnapshot → syncMesh → pull → restoreGroupTags`,
      notifyChange 정확히 1회.
    * L3: `restoreGroupTags` 정책 — groupTags 전부 재구성 + selection
      `기존 ∪ (A∪B)` + notifyChange 1회. UI runtime 의 selection-bound
      제약 (groupTags ⊆ selected) 우회 — persistence layer 의 truth
      source = SelectionManager.
  - **P-4 §B** real Chromium 2 spec:
    * `page.reload()` 사이 진짜 fresh state 검증 (process boundary)
    * basic round-trip + empty round-trip — corner cases 는 vitest L3
      6 tests 가 cover
    * DOM file dialog 회피 (future ADR territory) — bridge call sequence
      가 ProjectSerializer.{push,pull} 의 logical equivalent
- **회귀 누적 (P-1~P-4)**: axia-core 132 → 138 (+6, P-1), axia-wasm
  12 → 16 (+4, P-2), vitest 1427 → 1443 (+16, P-2 7 + P-3 9), Playwright
  13 → 15 (+2, P-4). 합계 **+21**, 절대 #[ignore] 금지 21/21 준수.
- **8-ADR 합산** (Path Z + Path Y + E.4 + E.5 + E.3 + V + ADR-078):
  axia-core 132 → 138 (+6), axia-geo 940 → 964 (+24), axia-wasm 8 →
  16 (+8), vitest 1395 → 1443 (+48), Playwright 0 → 15 (+15). 합계
  2275 → 2476 (+201) — 단일 트랙으로 200 회귀 돌파.
- **사용자 정정 가치**: P-2 사전 검토에서 `&[u32]` + bool 제안 → 사용자
  정정으로 `Vec<u32>` + `Result<(), JsValue>` strict. 결과: WASM 경계
  ownership 명확 + invalid input → 즉시 CI 검출. **향후 ADR 가이드**:
  WASM 경계 input validation 은 strict-throw default.
- **ProjectSerializer 의 selection-bound 우회 결정**: ADR-074 U-1 의
  `setGroupTag` 는 selection-bound. Save/Load 경계에서는 명시적 우회
  (`bridge.setBooleanGroupTag` 직접 호출 + `restoreGroupTags` 신규 API).
  **향후 ADR 가이드**: UI runtime invariant 와 persistence invariant 는
  분리 가능 — layer 별 별도 API + 명시적 우회 (silent override 회피).
- **Page reload 의 fresh state 보장**: P-4 의 `page.reload()` 가
  ServiceContainer + WasmBridge 완전 재초기화 + WASM module 재로드 →
  진짜 "save → close app → reopen app" 시뮬레이션. **향후 ADR
  가이드**: persistence E2E 의 fresh-state 표준 = page reload (process
  boundary 회귀 보장).
- **Path Z 5-layer 패턴 일반화**: Model + UI Runtime + Routing +
  Persistence + Bridge + E2E 의 6-layer atomic stack. 향후 persistence
  -layer 가 추가되는 모든 ADR 은 이 패턴 답습 권장.
- **남은 미착수 (모두 선택적 확장 또는 별도 트랙)**:
  - DOM file dialog round-trip (download/upload 실제 이벤트) — future
    ADR
  - Multi-step undo/redo of group tag mutations — 별도 ADR (현재
    transaction wrapping 은 P-2 에서 set/clear 양쪽 적용 완료, undo 회귀
    1건은 미작성)
  - Visual baseline of restored group outlines — V-2 baseline path 와
    동일 코드 경로이므로 자동 호환 (별도 baseline 불필요)
- **상세**: `docs/adr/078-boolean-group-persistence.md` §D Acceptance
  Log (P-1 ~ P-4 commit hash + 산출물 + lock-ins) + §6 Lessons
  (5-layer 패턴 일반화 + 사용자 정정 가치 + UI/persistence layer 분리
  + page reload 표준)

### ADR-050 + ADR-051 — Two-Layer Citizenship Phase 1 (P-1 ~ P-7 closure, 2026-05-06)
- **상태**: Phase 1 모든 sub-step (P-1 / P-2 / ADR-051 P-1 / ADR-051
  P-2 / P-3 / P-4 / P-5a / P-5b / P-5c / P-5d / P-5e-α / P-5e-γ /
  P-5e-β / P-6 / P-7) closure. ADR-049 §4 Q1+Q2+Q3+Q4 모든 lock-in
  코드 정합. LOCKED #26 의 Phase 1 완료 표시 추가. Last commit: 본
  P-7 commit.
- **의의**: AxiA 의 핵심 시민권 모델 (Form citizen `Shape` / Property
  citizen `Xia`) 이 model + WASM + TS bridge + Tools + UI + Snapshot
  6 layer 모두 작동. 사용자가 새 도구로 그리면 default 로 form-layer
  Shape 생성, 재질 부여 시 4-condition 통과 후 Xia 로 promote. ADR-074
  / ADR-078 의 Path Z 11+ atomic 패턴 일반화 — Phase 1 은 동일 패턴의
  최대 적용 사례 (15 commits, +145 회귀).
- **stack** (사용자 클릭 → 재질 부여 → Xia 승격):
  ```
  사용자 클릭 (Default ON, P-5e-α)
    ↓
  DrawRect/Line/CircleTool (P-5d opt-in flag)
    ↓ bridge.draw*AsShape
  WasmBridge typed wrapper (P-5c)
    ↓ draw_*_as_shape WASM exports (P-5c)
  Command::DrawRect/Line/CircleAsShape (P-5a/b)
    ↓ Scene::exec_draw_*_as_shape
  Phase 1: 기존 exec_draw_* 위임 (mesh + face synthesis)
  Phase 2: Xia → Shape 변환 + replace_last_after_snapshot (P-5e-γ)
    ↓
  Scene.shapes (P-1 storage) + Snapshot section 7 (P-3 persistence)
    ↓
  Inspector "형태 (Shape)" badge (P-6)
    ↓ promote_shape_to_xia (P-2 4-condition validation)
  Scene.xias + shape_to_xia linkage (P-2)
    ↓
  Inspector "XIA (특성)" badge (P-6)
  ```
- **결정 매트릭스 핵심** (각 sub-step §B lock-ins 참조):
  - **P-1**: ShapeId newtype + Shape struct + scene.shapes storage
    (additive only, 기존 Xia UNCHANGED)
  - **P-2**: validate_promotion shared helper + ShapeNotFound additive
    variant + shape_to_xia 별개 map (Xia struct UNCHANGED — bincode
    호환)
  - **ADR-051 P-1**: free function verify_p7_manifold + P7Violation
    enum 3 variants (M1/M2/M3) — promote API 미통합 (별도 sub-step)
  - **ADR-051 P-2**: Phase 5/6/7 정정은 prior commits 자연 완료 +
    측정 도구 회귀 봉인 + LOCKED #1 amendment
  - **P-3**: Section 7 additive (shapes + next_shape_id +
    shape_to_xia) — legacy snapshot 호환
  - **P-4**: 6 typed WASM methods (Vec<u32> + strict throw) + 6 TS
    wrappers (number[] + graceful no-op + strict for promote)
  - **P-5a/b**: 신규 Command variants + ShapeCreated CommandResult +
    Conversion 패턴 (350 LoC 중복 회피)
  - **P-5c**: As-Shape Draw bridge + TS wrappers (snake_case in JS,
    f64 return, ADR-026 P12 snap 정합)
  - **P-5d**: TS module-level flag (AutoIntersectSettings 패턴) +
    SettingsPanel toggle ("그리기 모드: 형태 (실험)")
  - **P-5e-α**: Default flip (false → true) + localStorage 'false'
    명시 OFF preference 보존
  - **P-5e-γ**: TransactionManager::replace_last_after_snapshot
    additive API + 3 As-Shape methods refactor (Undo 1회 = 산업 표준)
  - **P-5e-β**: FORM_MATERIAL named sentinel (MaterialId::new(0))
    + Scene.default_material field 제거 (43 sites 일괄, sed + cargo
    catch) + MaterialId::new const fn
  - **P-6**: Inspector badge label rename ("Appearance" → "형태 (Shape)" /
    "XIA (물체)" → "XIA (특성)") + drift guard 회귀
  - **P-7**: 회고 + LOCKED #26 update + Phase 1 closure
- **회귀 누적 (P-1 ~ P-7)**: axia-core 124 → 173 (+49), axia-geo 964
  → 969 (+5), axia-wasm 12 → 24 (+12), axia-transaction 2 → 4 (+2),
  vitest 1395 → 1472 (+77). 합계 **+145**, 절대 #[ignore] 금지
  145/145 준수. CI 자동 검증 (ADR-075 E4-6 + ci.yml).
- **사용자 facing 변화 요약**:
  - 새 도구로 그리면 default 로 form-layer Shape 생성 (이전: legacy Xia)
  - Undo 1회로 정확 pre-state 복원 (이전: As-Shape 시 2회 필요)
  - SettingsPanel "그리기 모드: 형태 (실험)" 체크박스 default ON
    (기존 OFF 사용자 preference 보존)
  - Inspector badge: "형태 (Shape)" (재질 없음) / "XIA (특성)"
    (재질 있음)
  - 재질 부여 시 4-condition 통과 후 promote → 자동 Xia 승격
- **5-Layer Path Z atomic 패턴 일반화** (ADR-074/078 답습 + 확장):
  ADR-074 = 5-layer (Model + UI + Routing + Functional E2E + Visual).
  ADR-078 = 5-layer persistence 변형. ADR-050+051 = **9-layer** Form
  Citizenship 변형 (Schema + Promote + Manifold Verify + Persistence
  + WASM Bridge + TS Wrapper + Tools Dispatch + Settings Flag + UI
  Labels). 각 layer 가 독립 atomic. **향후 ADR 가이드**: 시민권 모델
  변경은 9-layer 패턴 답습.
- **사용자 결재 가치**: 모든 sub-step 사전 검토 → 사용자 명시 결재 →
  구현 → 검증 → commit. P-5e 의 4 sub-task 통합 anchor 가 사전 검토
  중 발견되어 (β/γ 분리 + δ 무효화) 위험 감소. **향후 ADR 가이드**:
  복합 atomic 은 사전 검토 단계에서 분할 검토 필수.
- **남은 미착수 (선택적 또는 future Phase)**:
  - ID format 갱신 ("XIA-0001" → "Shape-0001" form layer 시) — Bridge
    integration 필요, 별도 ADR
  - 다른 Draw tools (DrawPolygonTool / DrawArcTool / DrawBezierTool /
    DrawFreehandTool / DrawCenterlineTool) 마이그레이션 — P-5d 패턴
    답습 가능
  - Phase 2 (ADR-052) — 재질 제거 → Shape 가역 강등 (Q5 사건 1)
  - Phase 3 (ADR-053) — Reference 시민권 분리
  - Phase 4 (ADR-054) — 위상 손상 자동 복구
- **상세**: `docs/adr/050-shape-xia-type-split.md` §D Acceptance Log
  (15 sub-step commit hash + 회귀 + lock-ins) + §E Lessons (6 회고
  항목 — Path Z 효율성 / FORM_MATERIAL sentinel / replace_last_after_
  snapshot UX / 명명 정합 / 점진 마이그레이션 / 3-layer 봉인) +
  `docs/adr/051-p7-canonical-restatement.md` §D (P-1/P-2 결산 +
  Phase 5/6/7 자연 완료 + Deferred boundary)

### 기타
- Material / Texture (텍스처 이미지 매핑 미구현)
- Electron/Tauri 데스크톱 앱
- Boundary Extraction (Solid → Face)
- Worker thread / GPU picking (ADR-012 강등 정책 트리거 시)
- ADR-010~013 시리즈 구현 (Sprint 2~6)
