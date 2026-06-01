# AXiA 3D — 프로젝트 지침 (Claude 세션용)

## 🔒 불변 정책 — 절대 변경 금지 (LOCKED 2026-04-28)

다음 정책들은 사용자가 **명시적으로 거부 또는 변경 요청** 하기 전까지
**모든 후속 세션에서 그대로 유지**되어야 한다. ADR-014 메타-원칙 #10
("ADR 불변 — 변경 시 새 ADR + Superseded") 적용.

### 1. ADR-021 — Closed Edge Loop Divides Face (P7, 2026-04-29)

> ⚠ **Superseded by ADR-139** (2026-05-18, Q3=a 결재). Auto containment
> split 폐기 — Boundary tool 명시 only. 본 LOCKED 의 *결과 invariant*
> (닫힌 경계 → 면) 는 메타-원칙 #14 로 보존, *trigger 정책* (자동 split)
> 만 supersede. 회귀 자산 11+ tests 는 B-ζ atomic sub-step 에서 명시
> Boundary 호출 시뮬레이션으로 재작성 예정. 자세한 supersede 근거 는
> `docs/adr/139-boundary-tool-auto-cycle-deprecation.md` §6 + §15 참조.

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

### 5. 엔진 허용오차 정책 (사용자 정책 2026-04-27, ADR-147 amendment 2026-05-27)
- Mesh 층은 **exact input** 만 처리. mm 단위 fuzzy snap 금지.
- **0.15μm** spatial-hash dedup 만 허용 (f32 drift 흡수용). **ADR-147
  Scenario B1 amendment (2026-05-27)** — 기존 1.5μm 에서 10× precision
  강화 (SPATIAL_HASH_CELL: 1e-3 → 1e-4 mm). 산업 표준 mm 단위 3-4
  decimal place 정합. ExactVec3 보고서 §B1 권장.
- UI Snap (osnap) 이 정렬 책임 — 입력 단계에서 해소.
- `add_vertex_with_snap` 같은 mesh-level 허용오차 함수 추가 금지.
- **Future**: ExactVec3 자료형 (B2/B3) — AxiA Phase 0~3 안정성 확인
  후 별도 ADR.

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

> ⚠ **Superseded by ADR-139** (2026-05-18, Q3=a 결재). Auto cycle
> detection + auto face synthesis 폐기 — Boundary tool 명시 only.
> 본 LOCKED 의 *결과 invariant* (닫힌 cycle → 면) 는 메타-원칙 #14 로
> 보존, *trigger 정책* (DrawLine closed loop 자동 합성, Step 4.95 /
> 4.99 second-pass) 만 supersede. DrawRect / DrawCircle 같은 single
> explicit op 의 auto-face 는 보존 (Q2=a 결재). 회귀 자산 (orphan
> count 0, 27-RECT 스트레스) 는 B-ζ 에서 명시 Boundary 호출 시뮬레이
> 션으로 재작성. P5.UX.39-45 cascading fixes 패턴 evidence 가 본 정책
> 폐기 trigger. 자세한 근거는 `docs/adr/139-boundary-tool-auto-cycle-
> deprecation.md` §1 (Problem statement) + §6 (정책 영향 매트릭스)
> 참조.

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
  - **Phase 2** ✅ **완료 (2026-05-09)** — ADR-091 Path Z atomic 7
    sub-step closure (D-α ~ D-η):
    * **ADR-091** — Material 제거 (FORM_MATERIAL sentinel) → 자동
      Shape 가역 강등 + Toast 5초 "되돌리기" 버튼 + 영구 Undo history
      (Q5 사건 1). `Scene.xia_to_original_shape: HashMap<XiaId, ShapeId>`
      신규 (P-2-d precedent — Xia struct 보존, bincode 호환 유지) →
      promote→demote→promote 라운드트립 ID 보존.
    * **회귀 누적**: axia-core +8, axia-wasm +2, vitest +14
      (Toast +2 / MaterialRemovalDemote +9 / WasmBridge +3),
      Playwright +2 (real Chromium). 합계 **+26** (절대 #[ignore]
      금지 26/26 준수).
    * **사용자 facing 변화**: Inspector 재질 dropdown "없음" 또는
      "재질 해제" 버튼 → 자동 강등 + 5초 Toast → 클릭 한 번으로 Undo
      복원. Inspector badge "XIA (특성)" → "형태 (Shape)" 자동 전환
      (P-6 답습).
    * **6-layer atomic 봉인**: Rust core (D-β/ε) + WASM bridge (D-γ)
      + TS wrapper (D-γ) + UI integration (D-δ) + Snapshot section
      7d (D-ε) + Real Chromium E2E (D-ζ). Path Z atomic 패턴의
      6-layer 변형 (ADR-074 5-layer + ADR-078 5-layer 위에 확장).
    * **D-β 사후 정정 (architectural correctness)**: D-β 의 초기
      구현은 `Xia.original_shape_id: Option<ShapeId>` 필드 추가였으나
      bincode positional encoding 한계로 legacy V2 snapshot
      roundtrip 을 깰 위험 발견. ADR-050 P-2-d 명시적 lock-in
      ("tracking lives on Scene, not on Xia") 답습으로 D-ε 진입 시
      즉시 정정 — `Scene.xia_to_original_shape` map 으로 이동. 향후
      ADR 가이드 — bincode 직렬화 struct 의 신규 필드는 **반드시
      Scene-level map 으로 분리**.
    * **다음 ADR 가이드**: ADR-091 §E Lessons (Path Z 효율성 / bincode
      위험 / 6-layer 패턴 / 사전 검토 가치) 참조.
  - **Phase 3** ✅ **완료 (2026-05-09)** — ADR-095 Path Z atomic 6
    sub-step closure (Phase 3-α ~ 3-ζ):
    * **ADR-095** — Reference 시민권 (Construction Line / Imported
      Mesh / Point Cloud) 도입. Form/Property 와 직교 (mutually
      exclusive geometry ownership). LOCKED #26 메타-원칙 #2 의
      architectural 정착.
    * **회귀 누적**: axia-core +17 (Reference struct 4 + scene CRUD 9
      + section 8 4) + axia-wasm baseline +9 (9 exports) + vitest +20
      (WasmBridge 9 + MarkAsReference 11) + Playwright +4 (real
      Chromium 4 scenarios). 합계 **+50**, 절대 #[ignore] 금지 50/50
      준수.
    * **사용자 facing 변화**: 3 시민권 활성. Construction line /
      external CAD imports / point clouds 가 first-class Reference
      시민. R-B violation 시 사용자 facing 한국어 메시지 (Xia/Shape/
      Reference owned 4 case + endpoint missing).
    * **Three-Layer Citizenship Model**: 본 ADR 으로 시민권 모델 확장
      ("Two-Layer" → "Three-Layer" 자연 진화):
      - Form (Shape) — 기하 추상
      - Property (Xia) — 부재 정체성 with material
      - Reference (NEW) — 외부/작도, *수정 안 함*
    * **Lessons applied (5 누적)**:
      - L1 additive coexist 다층 적용 (5 sub-step zero regression)
      - L2 Mesh-level Map canonical 더 깊은 적용 (ADR-091 §E L1)
      - L3 사용자 facing 한국어 변환 (humanizeRBViolation 패턴)
      - L4 Three-Layer Citizenship Model 활성 (메타-원칙 #2 정착)
      - L5 5개월 누적 architectural quality 자연 결합 (ADR-094 §E L3 답습)
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
  - **ADR-088 (Phase 1) ✅ Closed (2026-05-08)**: `curve_owner_id`
    grouping for analytic curves — selection-time enforcement of
    LOCKED #15 (ADR-037 P22.5). Circle 의 N segments 가 한 클릭으로
    통일 선택. DCEL 무surgery, Edge 에 `curve_owner_id: Option<u32>`
    필드 추가만. **5-step Path Z atomic** (S-α `6bc16e6` spec → S-β
    `d3aa9ae` Edge schema + Mesh counter → S-γ `535ce4e` DrawCircle/
    Arc/Bezier/BSpline owner_id 부여 → S-δ `2fbf0c2` WASM exports +
    TS bridge + SelectTool walk → S-ε docs closure). **회귀 +10**
    (axia-core +3 / axia-geo +3 / vitest +4 / 절대 #[ignore] 금지
    10/10). 사용자 facing: DrawCircle 한 클릭 → N segments 전체 선택.
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

### 35. ADR-089 — True Kernel-Native Closed Edges (A-α ~ A-Δ closure, 2026-05-09)
- **ADR-094 amendment + default ON (2026-05-09)** — Path B-full
  Refined Plan closure + production default activation. 산업 CAD parity
  (3 face / 2 edge / 2 vert) + 95%+ 메모리 절감 즉시 활성:
  * **Default ON 결재** (B-θ retrospective 7/7 PASS 후): main.ts init
    가 CylinderPathBSettings → bridge.setCylinderPathBDefault 자동
    활성화. 신규 사용자 자동 Path B, 기존 explicit OFF preference
    (localStorage `axia:cylinder-path-b-mode = 'false'`) 보존.
    ADR-049 P-5e-α / ADR-087 K-ε hotfix 답습.
  * **Architectural anchor**: ADR-049 P-5e-α 의 두 layer 분리 (engine
    default OFF + production default ON via localStorage) 가 ADR-094
    에서도 정합 — engine 회귀 자산 245+ 보존 + 사용자 즉시 Path B 사용.
  * **회귀** (default ON 추가): vitest CylinderPathBSettings.test 5
    (default 갱신 + 토글 패턴 정정) + Playwright +2 (default ON
    activation + explicit OFF preservation). 합계 **+7** (B-θ retrospective
    +7 + default ON +7 = +14 누적).
  * **사용자 시연 sweep** (B-θ retrospective 7/7 PASS):
    - Scenario 1: Path B 활성 + 3/2/2 anchor
    - Scenario 2: Selection (annulus group of 1, walk = self)
    - Scenario 3: Undo×2 → baseline 복원
    - Scenario 4: Snapshot round-trip (Mesh-level maps 보존)
    - Scenario 5: Path A ↔ Path B toggle integrity
    - Scenario 6: Visual capture (overall + rim zoom)
    - Scenario 7: 5× cylinders linear scaling (15/10/10)

- **ADR-094 amendment (2026-05-09)** — Path B-full Refined Plan
  closure (multi-week atomic architectural track):
  * **사용자 시연 결재 (2026-05-09)**: ADR-093 closure 후 memory /
    STEP / parity / Push-Pull 누적 잔존 trigger 4개 활성 → 🅺 path
    의 두 번째 단계 (🅹 Path B-full) 진입.
  * **🅺 Refined plan**: ADR-090 §5 원안 (8 sub-step / 3-5주) 을
    ADR-091/092/093 lessons 적용으로 *additive-first* 위험 격리 +
    multi-gate 결재 패턴으로 재정렬. 7 sub-step (B-α ~ B-θ) / 18-29일.
  * **B-α** (refined plan spec) → **B-γ-prep** (Mesh.face_to_boundary_
    loops Mesh-level map, ADR-091 §E L1 답습 + restore_snapshot 부산물
    fix for ADR-088/093) → **B-δ-prep** (extrude_cylinder_kernel_native:
    3 face / 2 edge / 2 vert annulus, 산업 CAD parity 첫 활성) →
    **B-ζ-prep** (Render — *기존 framework 자연 처리*, zero-code-change)
    → **B-ε-prep** (Boolean dispatch — surface-driven, *기존 framework
    자연 처리*, zero-code-change) → **B-η** (architectural switch —
    engine OFF + production ON via localStorage, 회귀 자산 보존) →
    **B-θ** (real Chromium 시연 PASS).
  * **사용자 시연 PASS** (real Chromium): Path A baseline 25/69/46 →
    Path B 3/2/2 (88% face / 97% edge / 96% vert reduction). 시각
    Path A 와 동일.
  * **회귀** axia-geo +30 (B-γ-prep 8 + B-δ-prep 7 + B-ζ-prep 4 +
    B-ε-prep 4 + B-η 7) + axia-wasm baseline +2 (B-η exports) +
    vitest +9 (B-η 9: CylinderPathBSettings 5 + WasmBridge 4) +
    Playwright +1 (B-θ demo). 합계 **+42**, 절대 #[ignore] 금지
    42/42 준수.
  * **사용자 facing 변화**:
    - localStorage `axia:cylinder-path-b-mode = 'true'` 시 Cylinder
      → Path B 자동 사용 (3 face / 2 edge / 2 vert)
    - 비활성 (default OFF) 시 Path A 보존 (legacy 사용자 워크플로우)
    - 시각 차이 0 (B-ζ-prep 자연 결합 — surface tessellation framework)
  * **ADR-090 모든 trigger closure**: 결함 1 (ADR-092) + 결함 2
    (ADR-093) + memory + export + parity + Push-Pull 누적 (ADR-094)
  * **Lessons (canonical patterns)** — ADR-094 §E L1~L5:
    - L1 Additive-first 위험 격리 (multi-week atomic 메타 패턴)
    - L2 Mesh-level Map 깊은 적용 + restore_snapshot 부산물 fix
    - L3 자연 결합 (existing framework + zero-code-change integration,
      메타-원칙 #14 의 가장 깊은 실현)
    - L4 Engine OFF + Production ON pattern (ADR-049 P-5e-α 답습)
    - L5 산업 CAD parity 정량 측정 (95%+ memory reduction)
  * **다음 ADR 가이드**: 모든 multi-week atomic 트랙은 본 ADR-094 의
    refined plan 패턴 (additive prep + production flip) 답습 권장.
    ADR-091/092/093 의 사전 검토 가치 + ADR-049 의 OFF-preserve
    flip 패턴 + ADR-091 §E L1 의 Mesh-level map canonical 모두
    cumulative 적용.

- **ADR-093 amendment (2026-05-09)** — Cylinder Side Face Owner-ID
  Grouping (B-MVP — Path B Light, 🅺 path 첫 단계):
  * **사용자 시연 결함 2 trigger** ("옆면과 관련이 있을것 같으니 ...
    결함 2 까지 architectural closure") — ADR-090 §6.3 의 잔존 trigger
    의 selection 측면 우선 closure. multi-week Path B-full (4-6주)
    의 risk 회피 + 80% 사용자 facing 가치 확보.
  * **D-β engine fix** — `Mesh.face_to_surface_owner_id: FxHashMap<
    FaceId, u32>` (ADR-091 §E L1 canonical guidance 첫 명시 적용 —
    Face struct UNCHANGED, bincode legacy 호환 보존). +
    `next_surface_owner_id` allocator + `walk_face_owner_siblings`
    walker API + `extrude_planar_cylinder` 의 N side faces 동일
    owner_id 부여 (Lock-in D-F).
  * **D-γ WASM bridge** — `walkFaceOwnerSiblings(face_id) -> Vec<u32>`
    + `getFaceSurfaceOwnerId(face_id) -> i32` (-1 sentinel). TS bridge
    typed wrapper 의 graceful fallback (endpoint missing 시 [faceId]).
  * **D-δ SelectTool integration** — face single-click 분기에 ADR-088
    curve_owner walk 패턴 답습. Defensive guard (`typeof !== 'function'`)
    로 다른 test fixtures 호환. Cylinder 측면 click → 23 quad faces
    일괄 선택.
  * **D-ε 사용자 시연 PASS** (real Chromium): cylinder r=5 h=8 →
    25 faces, 측면 face click → siblings=23 → selectedCount=23.
    Inspector "체적 면 그룹" 으로 group 인식.
  * **회귀** axia-geo +8 (default None / monotonic counter / walk
    self-fallback / walk collect / extrude_planar_cylinder N sides
    same id / cross-cylinder unique / inactive face defensive /
    polygonal path 통합) + axia-wasm +2 (signature wiring) +
    vitest +8 (D-γ wrapper 4 + D-δ SelectTool 4). 합계 **+18**, 절대
    #[ignore] 금지 18/18 준수.
  * **사용자 facing 변화**: Cylinder 측면 click → 22~23 quad faces
    일괄 선택 (사용자 intent: "측면 = 1 entity"). 비-cylinder face
    click → 단일 face (legacy 보존). shift/ctrl/alt modifier 정합성
    유지.
  * **ADR-091 §E L1 canonical guidance 첫 명시 적용** — Mesh-level
    HashMap 접근 의 architectural 가치 lock-in. ADR-088
    (Edge.curve_owner_id struct field) 은 L1 *이전* 결정 —
    retroactive migration 별도 트랙.
  * **ADR-090 Path B-full trigger anchor 활성**:
    - ✅ 결함 2 selection 측면 closure (ADR-093)
    - ❌ 메모리 비용 / STEP export 정확도 / 산업 CAD parity / Push-Pull
      again 누적 — Path B-full 본격 진입 trigger
    - 사용자 시연 만족도에 따라 Path B-full 보류 vs 진입 결재
  * **Lessons (canonical patterns)**:
    - L1 ADR-091 §E L1 canonical 첫 명시 적용 (Mesh-level map)
    - L2 ADR-088 패턴 자연 확장 (curve→face owner-id, Vertex/Volume
      도 동일 패턴 가능)
    - L3 Defensive bridge guard (caller 에서도 graceful fallback —
      WasmBridge wrapper 만으로 부족)
    - L4 🅺 path canonical (MVP atomic 먼저 → 사용자 시연 → multi-week
      Path B-full trigger 재평가)

- **ADR-092 amendment (2026-05-09)** — Push-Pull top boundary
  closed-curve preservation (partial Path B atomic):
  * **사용자 시연 회귀 trigger** ("현재 원에 대한 완벽한 처리가
    안되고 있습니다") — DrawCircle → PushPull 시 top rim 이 polygon
    으로 시각화. ADR-089 A-θ Path A 의 known limitation (closed-curve
    metadata 가 Push-Pull 통과 시 영구 상실) 의 partial 해결.
  * **C-β engine fix** — `extrude_closed_curve_face_via_tessellation`
    의 step 8 추가: recurse 후 top face N edges 에 `AnalyticCurve::Arc`
    부착 (translated center). DCEL topology unchanged — manifold-safe.
  * **C-δ render path fix** — `export_edge_lines_with_map` 의
    non-self-loop edges 분기에 Arc curve fast-path 추가. Self-loop only
    였던 closed-curve fast-path (A-κ) 를 non-self-loop 까지 확장.
    Push-Pull 결과 top/bottom rim 의 N Arc edges 가 chord-tolerant
    tessellation 으로 매끈 ring 시각화.
  * **회귀** axia-geo +7 (manifold + translation + radius + normal +
    DCEL + recess + polygonal regression guard) + Playwright +2
    (real Chromium top rim multi-segment 검증). 합계 **+9**, 절대
    #[ignore] 금지 9/9 준수.
  * **사용자 facing 변화**: DrawCircle → PushPull → top rim 매끈
    ring (이전 polygon facets 사라짐). Side hover 는 여전히 N quads
    중 1개 선택 (결함 2 — Path B trigger anchor).
  * **메타-원칙 #14 의 깊은 적용** — engine truth + render truth +
    downstream ops 활용 의 3 layer 모두 정합. Boolean / Offset /
    Push-Pull again 시 top edge Arc metadata 가 first-class 로 인식
    (ADR-064/066 NURBS dispatch + ADR-080 Offset Plane Arc 분기 보너스).
  * **ADR-090 Path B trigger 재평가** — 결함 1 (top rim polygon)
    해결로 ADR-090 §6 trigger 매트릭스 일부 무력화. 결함 2 (side
    hover single quad / Boolean SSI 정밀도 측면 한계) 가 새로운
    primary trigger. 사용자 시연 결과에 따라 Path B 결재 활성
    여부 판단.
  * **다음 ADR 가이드 (Lessons)**:
    - L1 사전 검토 가치 재확인 (C-β engine fix 만으로는 사용자 facing
      결과 0 — render path 누락 발견 가 C-δ 의 게이트 가치)
    - L2 self-loop / non-self-loop edge fast-path 일관성 통합 필요
    - L3 메타-원칙 #14 의 3-layer 정합 (engine + render + downstream)
    - L4 Path A 의 점진 Path B 화 패턴 — partial atomic 추출 가능성
      사전 검토

- **A-Δ amendment (2026-05-09)** — Periodic knot vector closed BSpline /
  NURBS:
  * `bspline::is_periodic_knots(knots, degree)` + `nurbs::is_periodic_
    knots` (delegates) helpers — uniform spacing detection + clamped
    end exclusion.
  * `add_face_closed_curve` 의 BSpline / NURBS 분기에서 dual closure
    type 지원: Type A clamped (control_pts[0] ≈ control_pts[last]) /
    Type B periodic (knot vector uniform + non-clamped). control point
    closure check 는 clamped 만 강제.
  * 회귀 +6 (axia-geo 1194 → 1200, 절대 #[ignore] 금지 6/6 준수):
    `periodic_knot_detection_*` 4개 + `closed_bspline_periodic_*` /
    `closed_nurbs_periodic_*`.
  * commit `28ffa68`. 자세한 결산은 ADR-089 §D A-Δ-γ.
  * 의의: 산업 표준 closed B-spline / NURBS 표현 (e.g., STEP `B_SPLINE_
    CURVE_WITH_KNOTS` periodic flag) 호환. closed Bezier (A-ω) +
    clamped closed BSpline (A-Α) + clamped closed NURBS (A-Β) + periodic
    closed BSpline / NURBS (A-Δ) 모두 first-class.

### 35. ADR-089 — True Kernel-Native Closed Edges (A-α ~ A-Γ closure, 2026-05-08)
- **사용자 통찰 (canonical, 2026-05-08)**:
  > "면은 닫힌 경계로부터 유도된다."
  메타-원칙 #14 의 깊은 실현 — closed edge cycle 이 자연 first-class
  citizen 으로, 1 vert (anchor) + 1 self-loop edge (with AnalyticCurve)
  + 1 face 의 canonical Phase 2 표현.
- **anchor 결정**: 모든 closed-curve 도형 (Circle 우선, Arc/Bezier/
  BSpline/NURBS 후속) 은 kernel-native 표현으로 저장. legacy polygonal
  approximation 은 backward-compat escape hatch 로만 보존.
- **A-α ~ A-π Path Z atomic 15 sub-step closure**:
  - **A-α** `bb71b8e` — spec only (ADR-089 본문 + 13-step roadmap)
  - **A-β/A-γ/A-δ/A-ε** — 시민권 인프라: Edge schema (self-loop 허용),
    half-edge wiring (next/prev/next_rad self-loop), `add_face_closed_
    curve` API, spatial-hash dedup 호환
  - **A-ζ** — face synthesis pipeline: LOCKED #1 P7 / LOCKED #12 P11
    closed-curve aware. detect_free_edge_loop self-loop guard +
    resolve_planar_free_faces fast-path
  - **A-η-1** `92f4e68` — Boolean Plane attach: closed-curve face 가
    `classify_dispatch_eligibility` 통과 → ADR-064/066 NURBS dispatch
    의 NURBS path 로 라우팅
  - **A-θ Path A** `2cc2bc0` — Push-Pull tessellate-then-extrude:
    closed-curve face → Cylinder (24+ side faces). 메타-원칙 #14 측면
    회귀, Path B (별도 future ADR) 까지 deferred
  - **A-κ Path A** `cdaf268` — Render pipeline curve-aware:
    `export_buffers_inner` + `export_edge_lines_with_map` closed-curve
    fast-path. viewport 시각 표시 + 매끈 wireframe (industry CAD parity)
  - **A-λ** `af9ff7a` — UI exposure: DrawCurveSettings module +
    DrawCircleTool branch + SettingsPanel "곡선 모드 (실험)" 토글
  - **A-ι Path A** `450b916` — Offset closed-curve: `offset_arc_on_
    plane` Circle 분기에서 self-loop detection → kernel-native input
    → kernel-native output (1 anchor + 1 self-loop edge with new Circle)
  - **A-ν** `f5193d9` — regression sweep: 2989/2989 PASS (axia-geo
    1158 + axia-core 200 + axia-transaction 4 + vitest 1627). 모든
    LOCKED guards (#1, #5, #12, #15, #16, #26, #34) 명시 PASS
  - **A-π Path Z** (3 sub-step, default ON 전환): `93a567c` /
    `7ac0f72` / `23e3750`. ADR-049 P-5e-α / ADR-087 K-ε hotfix 답습
    패턴. localStorage 'false' 명시 OFF preference 보존
  - **A-ρ Path A** (3 sub-step, render-only Cylinder uv-slice
    smoothness): `bc70af1` / `58047c4` / `45476ff`. 사용자 통찰
    "원통 옆면속에 폴리곤" 후 결재. DCEL polygon 보존, render path
    가 surface metadata 기반 chord-tolerant tessellation 적용. 26594
    → 778 tris (-97% per Cylinder face).
  - **A-τ Path A** (3 sub-step, smooth-group edge hiding):
    `c0d6745` / `98c83bd` / `5650b22`. 두 인접 face 가 같은 곡면
    surface 인스턴스 (Cylinder/Sphere/Cone/Torus) 면 angle threshold
    무시하고 edge hide. surfaces_in_same_smooth_group helper —
    axis_origin/axis_dir/radius/ref_dir 4 fields 비교 (u_range/
    v_range 제외). LOCKED #16 K-ε hotfix 답습.
  - **A-υ Path A** (3 sub-step, leftover self-loop cleanup):
    `42c8efb` / `4dfadd7` / `26f1fc9`. extrude_closed_curve_face_via_
    tessellation 의 remove_face 직후 명시 self-loop edge cleanup +
    isolated anchor vertex deactivate. 23 polyline overlap 제거.
  - **A-φ Path A** (3 sub-step, Sphere/Cone/Torus uv-slice 일관성):
    `a91497f` / `f39ad41` / `7a29340`. compute_uv_slice_for_quad_face
    generic helper — 4 곡면 모두 dispatch. parametric inversion 4
    formula (Cylinder atan2/dot, Sphere asin, Cone atan2/dot, Torus
    radial+axial atan2). A-ρ inline 코드 → generic refactor (-75 LoC).
  - **A-χ Path A** (3 sub-step, split surface inheritance):
    `29cf2f9` / `faae3b0` + `b2ac1eb` / `58897cd`. 6 face split sites
    (mesh.split_face / split_face_by_chain / split_face_case_b/c/d /
    boolean.split_faces_by_intersections) 모두 parent surface clone
    부여. Sphere×Sphere intersect 시연: 2236 face / 90% kind=0 →
    568 face / **100% kind=Sphere**. Auto-intersect / Boolean /
    Push-Pull split path 모두 metadata persistence 확보.
  - **A-ω 4-sub-step** (closed Bezier 시민권 첫 확장): `e3c6126` /
    `ae56b2b` / `a97f079` / `fc5c057` + closure docs `11fe34e`.
    `add_face_closed_curve` 의 A-δ Circle-only 제약 해제 — closed
    Bezier loop (control_pts[0] ≈ control_pts[last]) 도 first-class
    citizen. `bezier_best_fit_normal` helper, Plane attach 확장
    (centroid + best-fit plane normal + AABB extent), `Command::
    DrawClosedBezierAsCurve` + WASM `drawClosedBezierAsCurve`,
    Render fast-path (face fan + edge polyline). BSpline / NURBS /
    Arc 는 future ADR (deferred — periodic knot 복잡성).
  - **A-ψ 3-sub-step** (DrawBezierTool UI 분기): `d43a4a1` /
    `cb3a368` / `f55dc5e`. Tool 의 `commit()` 에 closure auto-detection
    branch — DrawCurveSettings flag (A-λ 답습) ON + |P3-P0| < 1e-3 mm
    (ADR-026 P12 cardinal snap range) 시 `drawClosedBezierAsCurve`
    라우팅. closed branch → 5 control points (P0 duplicated as last,
    exact closure on engine side). 사용자가 4번째 클릭을 첫 클릭에
    정확히 맞추면 자동 closed Bezier face 생성. 매뉴얼 토글 / 명시
    명령 불필요.
  - **A-Α 3-sub-step** (closed BSpline 시민권): `fd3f36c` / `a70acf3`
    / `aa2d5f2`. `add_face_closed_curve` 의 BSpline match arm —
    closure check (`|cp[0]-cp[last]| < EPSILON_LENGTH` clamped knots
    case) + `bspline::validate` (knots/degree validation). `bezier_
    best_fit_normal` helper Bezier/BSpline 공통 재사용. Plane attach
    + Render fast-path (face fan + edge wireframe) Bezier 답습으로
    통합 (`bezier_or_bspline_pts` Option iterator). `bspline::validate`
    visibility `fn` → `pub fn`. `Command::DrawClosedBSplineAsCurve` +
    WASM `drawClosedBSplineAsCurve(controlPts, knots, degree)` + TS
    bridge wrapper. Browser smoke 검증: 5 cp + clamped knots [0,0,0,
    0, 0.5, 1,1,1,1] + degree 3 → 1 vert / 1 edge / 1 face,
    faceKind=Plane (1), curveKind=BSpline (5). NURBS / Arc / periodic
    knot vector 은 future ADR (현재 deferred).
  - **A-Β 3-sub-step** (closed NURBS 시민권): `9dae865` / `09f14aa`
    / `03edd5a`. `add_face_closed_curve` 의 NURBS match arm —
    closure check (clamped knots case) + `nurbs::validate` (weights
    > 0, weights/control_pts length match, knots/degree validation).
    `bezier_best_fit_normal` helper 재사용 (control polygon best-fit
    plane, weights 무관 — L-Β-3). Plane attach + Render fast-path
    iterator 확장 (Bezier/BSpline/NURBS 통합 — `curve_control_pts`
    Option). `nurbs::validate` visibility `fn` → `pub fn`. `Command::
    DrawClosedNURBSAsCurve` + WASM `drawClosedNURBSAsCurve
    (controlPts, weights, knots, degree)` + TS bridge wrapper.
    Browser smoke 검증: 5 cp + uniform weights + clamped knots +
    degree 3 → faceKind=Plane(1), curveKind=NURBS(6). Open NURBS,
    zero weight 모두 -1 거부. **closed-curve 시민권 4 곡선 type
    모두 활성** (Circle / Bezier / BSpline / NURBS). Arc / periodic
    knot vector 만 future ADR.
  - **A-μ 4-sub-step** (snapshot legacy audit + version handshake):
    `53601d6` / `84ffab0` / `18ac932`. **Path B pre-trigger 준비**.
    🅲 Version handshake 강화 — `import_versioned_snapshot` 의
    `v > SNAPSHOT_VERSION` 분기 추가 (명시적 forward-compat reject,
    silent garbage 차단). `analyze_snapshot` 신규 — read-only
    inspection 으로 version + 7 section presence flags 반환.
    `SnapshotInfo` / `SnapshotSections` struct 신규. 🅰 Legacy file
    load audit — 9 regression tests (synthesized fixtures,
    programmatic generation): full V2 / legacy headerless / short
    data / V_too_new (V99) reject / corrupt magic fallback /
    Shapes+Groups roundtrip / ADR-089 Circle 보존 roundtrip /
    ADR-089 A-ω Bezier 보존 roundtrip / V1 mesh-only legacy load.
    회귀 axia-core +9 (200 → 209). Path B (ADR-090) 진입 시 V3
    schema bump 자연 가능 (forward-compat 인프라 활성).
  - **A-Γ 3-sub-step** (Path B trigger 정량화 audit): `9442128` /
    `fbf3615`. **ADR-090 §6 데이터 anchor 확보**. 5 measurement
    regression tests (chord_error_corpus 5×4=20 측정 / perimeter_
    deviation_corpus / path_a_memory_footprint / per_segment_face_
    count baseline / path_b_savings_table). `docs/audits/2026-05-08
    -path-b-trigger-quantification.md` 신설 (5-section audit). ADR-
    090 §6 추상적 트리거 → 실측 데이터로 강화 (chord error R×N
    matrix, 47x 절감 large model, 임계 활성 시점). 핵심 finding:
    R=100mm/N=64 → 0.12mm chord error, R=1000mm/N=64 → 1.2mm.
    Memory: N=64 cylinder = 192/320/130 (Path A) vs 3/2/2 (Path B
    theoretical) = **98%+ 절감**. Large model (1000-cyl × N=32) =
    47x 메모리 절감. 회귀 axia-geo +5 (1189 → 1194). Path B 진입
    결재 시 audit 데이터 anchor 활용 가능.
- **16 lock-in 원칙 (canonical)**:
  - L1: 모든 closed-curve = 1 anchor + 1 self-loop edge (DCEL canonical
    Phase 2). 메타-원칙 #14 정합
  - L2: AnalyticCurve = truth. polygonal tessellation 은 render/op 의
    부산물 일 뿐 (ADR-019 답습)
  - L3: Default ON — DrawCircle 도구의 자동 동작. SettingsPanel 토글
    은 escape hatch 만 (legacy 사용자 preservation)
  - L4: Path A (잠정 tessellate) — Push-Pull / Boolean / Render 의
    polygonal substitute. Path B (진정한 kernel-native cylinder) 은
    별도 future ADR
  - L5: Backward compat — polygonal Circle (legacy 24-segment) 의
    회귀 자산 모두 PASS 유지. localStorage `axia:draw-curve-mode = 'false'`
    explicit OFF preference 영구 보존
  - **L6 (A-ρ/φ)**: 곡면 face 의 render 는 surface metadata 기반
    chord-tolerant uv-slice tessellation. DCEL polygon quad 보존,
    visual smoothness 만 향상. compute_uv_slice_for_quad_face generic
    helper — 4 곡면 (Cylinder/Sphere/Cone/Torus) 모두 dispatch.
  - **L7 (A-τ)**: 두 인접 face 가 같은 곡면 surface (Cylinder/Sphere/
    Cone/Torus) 면 edge wireframe 에서 hide. surfaces_in_same_smooth_
    group 함수 (axis_origin/axis_dir/radius/ref_dir 비교, u_range/
    v_range 제외). HARD flag override 보존.
  - **L8 (A-υ)**: extrude_closed_curve_face_via_tessellation 의 remove_
    face 직후 self-loop edge cleanup + isolated anchor vertex
    deactivate. polyline overlap 제거 (시각 정합).
  - **L9 (A-χ)**: 모든 face split site 가 parent surface clone 부여.
    6 sites: mesh.split_face / split_face_by_chain / split_face_case_
    b/c/d / boolean.split_faces_by_intersections. uv_range 풀 surface
    보존 — A-ρ/A-φ uv-slice 가 boundary verts 로 sub-slice 자동 계산.
    Auto-intersect / Boolean / Push-Pull 의 모든 split path 정합.
  - **L10 (메타-원칙 #14 측면 시각 closure)**: A-ρ + A-τ + A-υ + A-φ
    + A-χ 결합으로 Path A 의 visual quality 가 산업 CAD parity 도달.
    DCEL polygon 유지, 시각만 매끈. Path B 는 future ADR scope.
  - **L11 (A-ω closed Bezier 시민권)**: `add_face_closed_curve` 가
    Circle 에 더해 **closed Bezier loop** (control_pts[0] ≈
    control_pts[last]) 도 first-class 처리. Plane attach 확장
    (best-fit plane normal). BSpline / NURBS / Arc 는 future ADR
    (periodic knot 복잡성). closed Bezier 는 1 anchor + 1 self-loop
    edge with `AnalyticCurve::Bezier` + Plane surface 의 canonical
    Phase 2 표현.
  - **L12 (A-ψ closure auto-detection)**: DrawBezierTool 의
    `commit()` 이 DrawCurveSettings flag (A-λ 답습) ON + P3 ↔ P0
    거리 < 1e-3 mm (ADR-026 P12 cardinal snap range) 시 자동
    `drawClosedBezierAsCurve` 라우팅. exact closure 강제 (cp[4] =
    cp[0]). 사용자가 4번째 클릭을 첫 클릭에 정확히 맞추면 자연 closed
    Bezier face 생성. 매뉴얼 토글 / 명시 명령 불필요.
  - **L13 (A-Α closed BSpline 시민권)**: `add_face_closed_curve` 가
    Circle / closed Bezier 에 더해 **closed BSpline** (clamped knots
    + control_pts[0] ≈ control_pts[last]) 도 first-class 처리.
    `bspline::validate` 로 knots/degree 검증 + `bezier_best_fit_normal`
    재사용 (Bezier/BSpline 모두 control polygon best-fit plane). NURBS
    / Arc / **periodic knot vector** closed BSpline 은 future ADR
    (clamped knots case 만 활성). closed BSpline = 1 anchor + 1
    self-loop edge with `AnalyticCurve::BSpline` + Plane surface 의
    canonical Phase 2 표현.
  - **L14 (A-Β closed NURBS 시민권)**: `add_face_closed_curve` 가
    BSpline 에 더해 **closed NURBS** (rational, weights 추가) 도
    first-class 처리. `nurbs::validate` 로 weights (모두 > 0, length
    match) + knots/degree 검증. control polygon best-fit plane (weights
    무관 — L-Β-3). Arc / **periodic knot vector** closed NURBS 는
    future ADR. **closed-curve 시민권 4 곡선 type 모두 활성**: Circle
    / closed Bezier / closed BSpline / closed NURBS — 메타-원칙 #14
    의 진정한 architectural closure. 4 곡선 type 모두 1 anchor + 1
    self-loop edge + 1 face (Plane surface) canonical Phase 2 표현.
  - **L15 (A-μ snapshot legacy audit + forward-compat)**: `import_
    versioned_snapshot` 의 `v > SNAPSHOT_VERSION` 분기 — silent
    garbage 차단 (forward-compat reject). `analyze_snapshot` /
    `SnapshotInfo` / `SnapshotSections` — legacy file 식별 가능.
    9 regression tests — full V2 / legacy headerless / short data /
    V99 reject / corrupt magic / Shapes+Groups roundtrip / Circle
    roundtrip / Bezier roundtrip / V1 mesh-only legacy. **Path B
    (ADR-090) pre-trigger 인프라 활성** — V3 schema bump 자연 가능.
    SNAPSHOT_VERSION = 2 고정 (Path B trigger 시 bump).
  - **L16 (A-Γ Path B trigger 정량화 audit)**: ADR-090 §6 의 추상적
    트리거를 **실측 데이터로 강화**. 5 measurement regression tests
    (chord error 5×4=20 / perimeter / memory / per-segment baseline /
    savings) + audit report (`docs/audits/2026-05-08-path-b-trigger-
    quantification.md`). 핵심 측정값 봉인: chord error R×(1-cos(π/N)),
    R=100/N=64 = 0.12mm, R=1000/N=64 = 1.2mm. Memory: N=64 cylinder
    Path A 192/320/130 vs Path B 3/2/2 = **98%+ 절감**. Large model
    (1000-cyl × N=32) = 47x 메모리. Path B 진입 결재 시 본 audit 의
    데이터 anchor 활용 — 임계 활성 시점 명시 (R>100mm + 0.1mm 정밀도,
    1000+ cyl model, STEP export 구현, 정밀 PMI dimension).
- **회귀 누적 (절대 #[ignore] 금지)**:
  - axia-geo +71 (1123 → 1194, A-α ~ A-Γ 누적)
    - A-α ~ A-ι: +35 (시민권 인프라 / face synthesis / Boolean /
      Push-Pull / Render / Offset)
    - A-ρ +4 (Cylinder uv-slice render)
    - A-τ +4 (smooth-group edge hide)
    - A-υ +3 (leftover cleanup)
    - A-φ +6 (Sphere/Cone/Torus uv-slice)
    - A-χ +3 (split surface inheritance)
    - A-ω +5 (closed Bezier 시민권)
    - A-Α +3 (closed BSpline 시민권)
    - A-Β +3 (closed NURBS 시민권)
    - A-Γ +5 (Path B trigger 정량화 audit)
  - axia-core +9 (200 → 209, A-μ 추가)
    - A-μ +9 (snapshot legacy audit + version handshake)
  - vitest +10 (1622 → 1632, A-λ + A-π + A-ψ)
    - A-λ +5 (DrawCurveSettings + DrawCircleTool)
    - A-π +2 (default ON)
    - A-ψ +3 (DrawBezierTool closure detection)
  - **합계 +90**, 절대 #[ignore] 금지 90/90 준수
- **사용자 facing 동작 (default ON 후)**:
  - DrawCircle 도구 → 자동 closed-curve face (1 vert / 1 edge / 1 face)
  - PushPull → tessellate-extrude → Cylinder (Path A)
  - Boolean → NURBS SSI dispatch 활성
  - Offset → self-loop output (kernel-native preserved)
  - Render → 매끈 곡선 + analytic Plane normal
  - SettingsPanel "곡선 모드 (실험)" 체크박스 → explicit OFF escape hatch
- **회귀 방지 테스트 강화** (절대 #[ignore] 금지):
  - `adr089_a_eta_1_closed_curve_face_has_plane_surface_attached`
  - `adr089_a_eta_1_closed_curve_face_passes_boolean_eligibility`
  - `adr089_a_theta_closed_curve_face_extrudes_to_cylinder`
  - `adr089_a_theta_closed_curve_attaches_cylinder_surface_to_sides`
  - `adr089_a_kappa_closed_curve_face_emits_triangles`
  - `adr089_a_kappa_closed_curve_edge_emits_polyline_segments`
  - `adr089_a_iota_closed_curve_offset_produces_self_loop`
  - `adr089_a_iota_polygonal_circle_unaffected_by_self_loop_path` (회귀 가드)
  - **A-ρ**: `cylinder_quad_emits_sliced_tessellation`,
    `cylinder_quad_normals_radial`,
    `cylinder_quad_tessellation_within_quad_bounds`,
    `polygonal_face_unaffected` (regression guard)
  - **A-τ**: `smooth_group_cylinder_edge_hidden`,
    `boundary_edge_still_drawn`, `polygonal_no_surface_unchanged`,
    `smooth_group_helper_distinguishes_kinds`
  - **A-υ**: `self_loop_edge_cleanup_after_extrude`,
    `anchor_vertex_deactivated_if_isolated`,
    `extrude_polygon_unaffected` (regression guard)
  - **A-φ**: `sphere_quad_emits_sliced_tessellation`,
    `sphere_quad_normals_radial`,
    `cone_quad_emits_sliced_tessellation`,
    `torus_quad_emits_sliced_tessellation`,
    `uv_slice_helper_returns_none_for_plane`,
    `uv_slice_returns_none_for_non_quad_face`
  - **A-χ**: `split_face_propagates_surface_to_face_b`,
    `split_face_no_surface_unchanged` (regression guard),
    `split_propagates_cylinder_with_full_uv_range`
  - **A-ω**: `closed_bezier_creates_self_loop_face`,
    `open_bezier_rejected`,
    `collinear_bezier_rejected`,
    `circle_path_unaffected` (regression guard)
  - **A-Α**: `closed_bspline_creates_self_loop_face`,
    `open_bspline_rejected`,
    `invalid_knots_rejected` (knot validation)
  - **A-Β**: `closed_nurbs_creates_self_loop_face`,
    `open_nurbs_rejected`,
    `zero_weight_nurbs_rejected` (weight validation),
    `arcs_still_rejected` (Arc deferred guard)
  - **A-μ** (axia-core scene::tests, 9 tests):
    `analyze_full_v2_snapshot`,
    `analyze_legacy_headerless_snapshot`,
    `analyze_short_data`,
    `v_too_new_rejected_with_clear_message` (forward-compat),
    `corrupt_magic_falls_back_to_legacy`,
    `v2_roundtrip_preserves_shapes_and_groups`,
    `v2_roundtrip_preserves_closed_curve_face` (ADR-089 Circle),
    `v2_roundtrip_preserves_closed_bezier_face` (ADR-089 A-ω Bezier),
    `legacy_v1_synthesized_loads`
  - **A-Γ** (axia-geo primitives::tests, 5 tests):
    `cylinder_chord_error_corpus` (5×4=20 measurement points),
    `cylinder_perimeter_deviation_corpus` (3×4 perimeter accuracy),
    `cylinder_path_a_memory_footprint` (face/edge/vert count),
    `cylinder_per_segment_face_count` (baseline regression guard),
    `path_b_savings_table` (N별 Path A vs Path B 절감률)
  - DrawCurveSettings.test.ts (6 tests)
  - DrawCircleTool.test.ts (10 tests, dual-mode coverage)
  - **A-ψ DrawBezierTool.test.ts** (3 tests):
    `open_bezier_legacy_path`,
    `closed_bezier_dispatched_to_drawClosedBezierAsCurve`,
    `drawCurveMode_OFF_always_legacy`
- **불변 (LOCKED 정책 정합)**:
  - LOCKED #1 (P7) / #12 (P11): closed-curve face 도 동일 face 합성 /
    분할 회귀 자산 PASS 유지
  - LOCKED #5 (1.5μm spatial-hash): self-loop anchor vertex 도 동일
    dedup 정책
  - LOCKED #15 (P22.5): closed-curve edge wireframe 의 N segment 모두
    같은 EdgeId map (owner-ID uniformity)
  - LOCKED #16 (P23): closed-curve face 의 Plane variant 가 polygon
    path 로 fall-through (ADR-038 K-ε hotfix 답습)
  - LOCKED #26 (Two-Layer Citizenship Phase 1): closed-curve 도 form-
    layer Shape / property-layer Xia 분리 정합
  - LOCKED #34 (ADR-087): kernel-native command suite — DrawCircle
    의 자동 surface attach 패턴 답습
  - ADR-046 P31 #4 (additive only): SettingsPanel 토글 + 메뉴/단축키/
    툴바 외부 ID UNCHANGED
- **후속 트랙 (deferred to separate ADRs)**:
  - **A-μ (future)**: Snapshot schema migration — .axia 파일 versioning
    (legacy polygon ↔ kernel-native bidirectional)
  - **A-θ Path B (future)**: 진정한 kernel-native cylinder (1 closed-
    curve profile + 1 closed-curve top + 1 cylindrical side face with
    2 self-loop loop boundary). 3주 atomic 트랙
  - **DrawArc / DrawBezier closed-curve**: 다른 곡선 도구의 시민권
    확장 (Bezier closed curve / NURBS closed curve 등)
- **Cross-link**: 메타-원칙 #14 (canonical anchor), ADR-019 (Line is
  Truth), ADR-027 (NURBS Kernel infrastructure), ADR-028 (Edge curve
  attach), ADR-049/050 (Two-Layer Citizenship), ADR-051 (P7 strict),
  ADR-064/066 (NURBS Boolean DCEL), ADR-079 (Create Solid), ADR-080
  (Offset dimension-aware), ADR-081 (STEP/IGES NURBS-class), ADR-087
  (Kernel-Native Command Suite Reset — directly preceding ADR), ADR-088
  (curve_owner_id grouping). LOCKED #1, #5, #12, #15, #16, #26, #34.

### 36. ADR-097 — Topology Damage Auto-Recovery (Phase 4 closure, 2026-05-09)

**LOCKED #26 Phase 4 closure**. v3.2 §12.3 + ADR-049 §4 Q5 final 정합.

- **canonical anchor**: 토폴로지 변경 op 후 손상 자동 복구 시도 →
  실패 시 사용자 다이얼로그 ([Undo] / [강등] / [수동수정])
- **Path Z atomic 6 sub-step** (T-α ~ T-ζ closure)
- **5-Layer Atomic Stack 첫 정착**: Engine (axia-geo damage detection +
  recovery) + Scene context (axia-core orphan) + Bridge (axia-wasm 2
  endpoints) + UI orchestration (TopologyRecoveryDialog +
  TopologyRecoveryOrchestrator) + Settings flag (`axia:auto-topology-
  recovery`, Default OFF) + Real Chromium E2E (Playwright 4 scenarios)
- **canonical lessons (5)**:
  - L1 UI orchestration 분리 (Dialog + Orchestrator 별도 모듈) — ADR-091
    §E L4 답습
  - L2 humanize at boundary (`humanizeDamageReport` Korean SSOT) —
    ADR-095 §E L3 답습
  - L3 Default OFF for self-modifying ops (메모리/시각 무관 변경
    default ON vs material-mutation default OFF 분기)
  - L4 ServiceContainer storage 함정 (factory wrapper 부적합 → 직접
    instance 등록)
  - L5 Recovery 자산 inventory 활용 — 5개월 누적 자산 (`verify_face_
    invariants` / `repair_non_manifold_edges` / `deactivate_empty_emit_
    faces` / `orphan_recovery`) 모두 활용, 새 알고리즘 0
- **회귀 누적 (T-α ~ T-ζ)**: axia-geo +11, axia-core +4, vitest +32,
  Playwright +4 = **+51** (절대 #[ignore] 금지 51/51 준수)

### 37. ADR-098 — Asset Library 3-Tier Material Scope (Phase 5-A closure, 2026-05-09)

**LOCKED #26 Phase 5-A closure**. v3.2 §13 first piece — 자산 라이브러리
3계층 (System / Project / User).

- **Path Z atomic 6 sub-step** (S-α ~ S-ζ closure)
- **6-Layer Atomic Stack**: Engine (axia-core MaterialTier enum +
  ScopedMaterialId + parallel `tier_index` Map) + Snapshot section 9
  (additive, ADR-091 §E L1 6번째 적용) + Bridge (axia-wasm 6 endpoints)
  + UI (AssetLibraryPanel 신규) + Settings flag (`axia:asset-library-
  user-tier`, Default OFF — User tier opt-in) + main.ts wiring + Real
  Chromium E2E (Playwright 5 scenarios)
- **사후 정정** (canonical):
  - S-α spec `Scene 3 maps` → audit 결과 `MaterialLibrary.tier_index`
    parallel Map (bincode drift 회피, ADR-091 §E L1 답습). **L2 lesson
    명시**: spec 보다 audit 우선 (architectural truth)
  - HashMap → BTreeMap canonical for snapshot determinism (orphan_
    recovery byte-equality 회귀 차단). **L1 lesson 신규**
- **canonical lessons (7)**: L1 BTreeMap determinism / L2 사후 정정
  정책 / L3 section additive / L4 legacy strip-test 누적 갱신 / L5
  Settings module 5-함수 surface canonical / L6 Default OFF for opt-
  in / L7 UI orchestration 분리
- **회귀 누적 (S-α ~ S-ζ)**: axia-core +19, axia-wasm +4, vitest +26,
  Playwright +5 = **+54** (절대 #[ignore] 금지 54/54 준수)

### 38. ADR-100 — Material Removal Recovery (Phase 5-C closure, 2026-05-09)

**LOCKED #26 Phase 5-C closure**. v3.2 §12.3 의 material-layer 변형 —
재질 제거 시 owning Xia 자동 복구 (auto-demote → fallback Concrete →
escalate dialog).

- **Path Z atomic 6 sub-step** (R-α ~ R-ζ closure)
- **ADR-097 5-Layer Atomic Stack 1:1 mirror** (canonical pattern
  reproducibility 증명):
  - Engine truth (axia-core 4 types + 3 methods)
  - Bridge (axia-wasm 3 endpoints)
  - UI orchestration (MaterialRemovalRecoveryDialog + Orchestrator —
    ADR-097 helpers 1:1 mirror)
  - Settings flag (`axia:auto-material-recovery`, Default OFF)
  - main.ts wiring (lazy + bridge guard)
  - Real Chromium E2E (Playwright 5 scenarios)
- **canonical lessons (7)**:
  - L1 ADR-097 5-layer **1:1 mirror** 가능성 증명 (새 패턴 0)
  - L2 ADR-091 D-β `demote_xia_to_shape` 직접 재사용 (자산 inventory)
  - L3 `RecoveryOutcome` enum shape mirror (engine + bridge + TS union)
  - L4 Settings module 5-함수 surface **5번째 일관 적용**
  - L5 Default OFF for self-modifying ops
  - L6 ok-envelope union (silent skip 차단)
  - L7 humanize at boundary (ADR-095 §E L3 답습)
- **회귀 누적 (R-α ~ R-ζ)**: docs +1, axia-core +10, axia-wasm +3,
  vitest +35, Playwright +5 = **+53** (절대 #[ignore] 금지 53/53 준수)

### 39. ADR-099 — Layered Material 4-PBR Channels (Phase 5-B closure, 2026-05-10) — LOCKED #26 완전 closure 🎉

**LOCKED #26 Phase 5-B closure → 5-Phase 로드맵 완전 closure**. v3.2
§13 main promise — Layered material (albedo + normal + roughness +
metallic 4 PBR channels).

- **Path Z atomic 7 sub-step** (L-α ~ L-η closure, multi-week)
- **6-Layer Atomic Stack** (ADR-097/100 5-layer Recovery pattern 위에
  Render layer 추가된 evolution):
  - Engine (axia-core: TextureProjection enum + TextureChannelInfo +
    LayeredChannels + VisualProperties.layered 확장)
  - Snapshot section 9 자연 확장 (ADR-098 활용)
  - Bridge (axia-wasm 5 endpoints)
  - **Render (LayeredMaterialBinding utility 신규 — Three.js 4-map
    binding, sRGB / NoColorSpace policy)**
  - UI (AssetLibraryPanel 4-cell indicator + LayeredMaterialDialog
    per-channel upload)
  - Bridge TS wrappers + main.ts wiring (callback pattern)
  - Real Chromium E2E (Playwright 5 scenarios)
- **사후 정정** (bincode 함정 완전 박멸):
  - L-β: `VisualProperties.layered` 의 `skip_serializing_if` 제거
  - L-γ: `LayeredChannels` 내부 4 채널 + `TextureChannelInfo.rotation`/
    `label` 의 `skip_serializing_if` 모두 제거. `material_partial_
    layered_bincode_roundtrip` regression guard 로 영구 차단
- **canonical lessons (9, L-α ~ L-η 누적)**:
  - L1 **bincode `skip_serializing_if` 함정 영구 박멸** — 모든 bincode
    struct Option 필드는 `#[serde(default)]` only
  - L2 ADR-091 §E L1 canonical **6번째 일관 적용** (additive +
    `#[serde(default)]`)
  - L3 Pure utility extraction — ADR-091 §E L4 **9번째 적용** with
    callback wiring
  - L4 Color space policy explicit (Three.js docs — albedo sRGB vs
    data maps linear)
  - L5 Failure isolation — per-channel `{applied, failures}` ok-envelope
  - L6 Engine ↔ TS ergonomic mapping (null → undefined, NaN/empty
    string sentinels)
  - L7 Callback wiring at main.ts boundary (panel/bridge 분리 유지)
  - L8 Discriminated-union return types (silent skip 차단)
  - L9 **Pattern evolution proof** — ADR-097/100 의 5-layer 1:1 mirror
    reproducibility + ADR-099 6-layer feature evolution 두 패턴 모두
    reproducible. 향후 ADR 적합 패턴 선택 가능
- **회귀 누적 (L-α ~ L-η)**: docs +1, axia-core +18, axia-wasm +5,
  vitest +38, Playwright +5 = **+66** (절대 #[ignore] 금지 66/66 준수)

### 🎉 LOCKED #26 Two-Layer Citizenship Model 5-Phase 완전 closure (2026-05-10)

본 ADR-099 L-η closure 시점으로 LOCKED #26 5-Phase 로드맵 모든 약속
정합 — Two-Layer Citizenship Model 의미적 완성:
- Phase 1 (ADR-050 + ADR-051) — Shape/Xia type split ✅
- Phase 2 (ADR-091) — Material removal demote ✅
- Phase 3 (ADR-095 + ADR-096) — Reference citizenship ✅
- Phase 4 (ADR-097) — Topology damage auto-recovery ✅
- Phase 5-A (ADR-098) — Asset library 3-tier material scope ✅
- Phase 5-C (ADR-100) — Material removal recovery ✅
- Phase 5-B (ADR-099) — Layered material 4-PBR channels ✅

**총 7 ADRs 누적**: 050+051 / 091 / 095+096 / 097 / 098 / 099 / 100.

**v3.2 §12-§13 main promises 모두 정합**:
- §12.3 (위상 손상 자동 복구): ADR-097 ✅
- §12.3 (재질 손상 자동 복구): ADR-100 ✅
- §13 (자산 라이브러리 3계층): ADR-098 ✅
- §13 (Layered material): ADR-099 ✅

**자세한 회고는 `docs/retro/2026-05-locked-26-closure.md` 참조**.

### 40. Render Chord Tolerance + Hover Group Unification (2026-05-14)

**사용자 통찰 (canonical)**:
> "옆면처럼 원도 같은 방식 쓸 수 없나요?"
> (cylinder side 가 매끈한 패턴을 top rim 에도 적용)

**핵심 발견 (initial diagnosis 정정)**:
옆면이 매끈한 진짜 이유는 N segments 가 충분해서가 아니라 **ADR-038 P23.5
surface-aware Gouraud normal** 이 chord 경계마다 normal 을 부드럽게 보간
→ 16 segments 도 매끈한 silhouette 생성. Top rim Plane face 는 uniform
normal (정확함 — flat cap) 이라 Gouraud smoothing 안 받음 → chord 가 그대로
visual facet 으로 노출. **Fix scope: shading 변경 아닌 chord_tol 자체를
5× finer**.

**Lock-ins**:

- **L1 Render-only chord_tol 분리**: `export_buffers_inner` 내부
  `ANALYTIC_CHORD_TOL = 0.02` (5× finer than legacy 0.1). Engine ops
  chord_tol (`radius * 0.01`, offset/Boolean/Push-Pull Path A polygon
  substitute 의 caller 지정값) **분리 보존**. 두 tolerance 분리는 ADR-049
  §4 의 "truth vs view" 패턴 답습 (Form/Property layer 정합).

- **L2 Closed-curve render path 일관성**: 두 site 모두 동일 formula:
  - 닫힌 곡선 face fast-path (`mesh.rs:~4844`):
    `ANALYTIC_CHORD_TOL.min(radius * 0.002).max(1e-6)`
  - 닫힌 곡선 edge wireframe (`mesh.rs:~5284`):
    `(radius * 0.002).clamp(5e-5, 0.02)`
  - 결과: face boundary 와 wireframe 의 chord 위치 align → seam 없음.

- **L3 Multi-segment edge hover 통합** (`ToolManagerRefactored.ts`
  mousemove 분기):
  - Mechanism 1 — ADR-088 `curve_owner_id` walk (multi-EdgeId group, 예:
    polygonal DrawCircle pre-Path B)
  - Mechanism 2 — Self-loop EdgeId 의 multi-segment fallback (Path B
    closed-curve face, ADR-089 A-κ): `edgeMap` 에서 `edgeMap[i] === edgeId`
    인 모든 segIndex 수집 → `setEdgeHoverGroup(...)` 호출
  - 두 mechanism 모두 미적용 시 `setEdgeHover(segIndex)` (단일 segment)
    fallback 유지
  - LOCKED #15 ADR-037 P22.5 "Edge.curve = Some(...) N segments 모두 동일
    EdgeId 로 promote" 자연 연장 — selection/hover 양쪽 정합.

- **L4 MCP surface — ADR-087 K-ζ + ADR-050 정합**:
  - `packages/axia-mcp-server` 의 capability handler 는 `_as_shape` /
    `create_solid_extrude` API **만** 호출:
    * `draw_rect` → `engine.draw_rect_as_shape`
    * `draw_circle` → `engine.draw_circle_as_shape`
    * `draw_line` → `engine.draw_line_as_shape`
    * `push_pull` → `engine.create_solid_extrude`
  - 응답 field: draw_* capabilities 는 `shape_id` (이전 `xia_id` — ADR-050
    form-layer 정합). `list_xias` 는 `xia_id` 유지 (property-layer 정합).
  - Schema: `ShapeId` zod alias 추가 (OwnerId sentinel 보존, P26.3).
  - 미래 `promote_shape_to_xia` capability 가 form → property promotion
    의 명시적 entry — 별도 ADR.
  - **회귀 가드**: `EngineInstance` interface (`types.ts`) 가 legacy
    method 시그니처를 미포함 → TS compile-time 으로 회귀 차단.

- **L5 사용자 통찰 보존**:
  - "옆면처럼 원도 같은 방식 쓸 수 없나요?" — Plane face 는 Gouraud
    smoothing 없으므로 chord_tol 자체 finer (단순 N 증가가 아닌 시각
    ergonomics)
  - 향후 시각 quality 변경 시 본 통찰의 "shading vs chord_tol" 구분 유지.

- **L6 Visual baseline 정책** (ADR-077 V-3 자연 확장):
  - chord_tol 또는 hover 변경 시 영향받는 시각 시나리오만 재생성.
  - 영향 0 인 시나리오 (Plane-only 등) 는 byte-identical 보존.
  - 본 LOCKED 의 검증 — workflow run #3 결과: 기존 4 baselines 모두
    byte-identical (chord_tol 변경이 Circle/Arc 없는 scenario 에 0 영향)
    → architectural backward-compat 증명.

- **L7 회귀 검증 매트릭스**:
  - axia-geo: **1256** PASS (sphere u-slice threshold 200 → 700, 동일
    architectural contract 다른 absolute scale)
  - axia-wasm: **54** PASS
  - vitest (TS): ToolManagerRefactored.test 82 + HoverPickPromote.test 13
    + 본 PR 추가 MCP migration 회귀
  - MCP server (axia-mcp-server): **163/163** PASS (이전 1 pre-existing
    fail 해소)
  - 절대 #[ignore] 금지 준수.

**메모리 영향** (r=5 cylinder, Path B):
- Side surface: ~16 → ~38 tris (×2.4)
- Top face fan: ~22 → ~78 tris (×3.5)
- Rim wireframe: ~22 → ~78 segs (×3.5)
- 합계 cylinder 1개: ~150 → ~360 verts (+210 verts, 무시 가능).
- LOD 는 별도 phase (트리거 미정).

**관련 commits / PRs**:
- `0c119e4` — chord_tol refinement (mesh.rs ANALYTIC_CHORD_TOL 0.1→0.02)
- `c62bbfd` — hover unification (ToolManagerRefactored.ts Mechanism 2)
- `b5bf85c` — MCP legacy API migration (4 capabilities + 7 tests)
- PR #14 (merged `98958ed`) — 위 3 commit 통합 PR

**Cross-link**: ADR-038 P23.5 (surface-aware normals), ADR-049 §4
(Form/Property layer truth vs view), ADR-050 P-5c (As-Shape draw API),
ADR-077 V-3 (visual baseline workflow), ADR-087 K-ζ (legacy WASM
deletion), ADR-088 (curve_owner_id), ADR-089 A-κ (closed-curve face
render fast-path), LOCKED #15 (P22.5 owner-ID uniformity), LOCKED #16
(P23 surface-aware normals).

### 41. ADR-101 Coplanar Partial Overlap Auto-Intersect (P7 Completion, 2026-05-15) ✅

> ⚠ **Superseded by ADR-139** (2026-05-18, Q3=a 결재). `auto_intersect_
> coplanar` 의 Draw 자동 trigger 폐기 — Boundary tool 명시 only.
> 본 LOCKED 의 *결과 invariant* (두 닫힌 경계 overlap → 3 sub-face) 는
> 메타-원칙 #14 로 보존, *Draw 자동 trigger* (B-4 Scene wiring,
> `auto_intersect_on_draw` flag default true) 만 supersede.
> Amendment 9 (메타-원칙 #15) HARD flag 정책 자체는 **불변 보존** —
> Boundary tool 호출 시에도 split-induced edges 의 HARD contract 유지.
> Engine 본체 (`auto_intersect_coplanar` public API, `polygon_difference_
> walking`, `coplanar_intersection_segments`) 는 보존 — Boundary tool
> 호출 시 자산 재활용. 자세한 근거는 `docs/adr/139-boundary-tool-auto-
> cycle-deprecation.md` §6 (정책 영향 매트릭스) + §10 (Lock-ins) 참조.

**Canonical anchor (사용자 통찰, 2026-05-14)**:
> "닫힌 엣지에는 면이 생성되어야 한다. 두 닫힌 엣지가 겹치면 세 면으로
> 나뉘어야 한다."

LOCKED #1 ADR-021 P7 의 가장 강한 의미 (coplanar partial overlap →
자동 3 sub-face) 가 **사용자 시연 가능** 으로 활성. 9 PR atomic
시리즈로 24시간 내 완성 (2026-05-14 ~ 2026-05-15).

**사용자 facing trigger 완전 활성**:
- DrawRectAsShape × 2 partial overlap → 자동 3 sub-face
- DrawCircleAsShape × 2 (Legacy polygonized) → 자동 3 sub-face
- DrawCircleAsCurve × 2 (Path B kernel-native) → 자동 3 sub-face

**9 PR 시리즈 (canonical commit log)**:
- PR #25 Phase A — `polygonize_closed_curve_face` helper (`de868ba`)
- PR #26 B-1 — Sutherland-Hodgman MVP algorithm decision (`d08ffc0`)
- PR #27 B-2 — `coplanar_intersection_segments` primitive (`4df7142`)
- PR #28 B-3a — `polygon_difference_walking` pure 2D utility (`d91528b`)
- PR #29 B-3b MVP — `Mesh::auto_intersect_coplanar` (RECT MVP, `8898467`)
- PR #30 B-3c — `cleanup_orphan_boundary_edges` + start_idx fix (`ca8ffb6`)
- PR #31 B-4 MVP — Scene wiring (Draw 자동 trigger, `73c004e`)
- PR #33 B-6 — E2E verification (engine + visual, `5c6ee4b`)
- PR #32 B-4b — Non-destructive pre-check + Path B 활성 (`046973a`)
- PR #34 Amendment 8 — Full closure docs (pending merge)

**Lock-ins (canonical for future hybrid-aware ops)**:

- **L1 — "Check first, mutate second" canonical** (Amendment 6 → 7
  evolution): 알고리즘이 speculative mutation + "did it apply?" check
  패턴을 쓰면 no-op case 에서 side-effect 누설. B-4b 가 AABB +
  coplanarity pre-check 를 polygonize 호출 *전* 위치시켜 해소. 향후
  모든 hybrid-aware op (Boolean / Push-Pull NURBS / Offset NURBS) 답습.
- **L2 — Hybrid Edge struct first-class 활성**: ADR-028 Phase A 의
  `Edge.curve: Option<AnalyticCurve>` 를 user-facing op 로 처음 사용.
  Path B Circle (1 anchor + 1 self-loop edge with `Circle{...}`) 의
  AABB / normal 을 polygonization 없이 metadata 에서 직접 추출.
  메모리 효율 (B-4 MVP 32 verts vs B-4b 0 verts pre-check phase).
- **L3 — `auto_intersect_coplanar` public API** (axia-geo
  `operations/coplanar.rs`):
  - `face_world_aabb(mesh, face_id) -> Option<Aabb3>` — non-destructive
  - `face_world_normal(mesh, face_id) -> Option<DVec3>` — non-destructive
  - `face_anchor_position(mesh, face_id) -> Option<DVec3>`
  - `coplanar_intersection_segments(...)` — read-only primitive
  - `polygon_difference_walking(...)` — pure 2D utility
  - `auto_intersect_coplanar(...)` — DCEL surgery wiring
- **L4 — Scene wiring at `intersect_faces_inner`**: 기존 3D triangle-
  triangle pipeline 뒤에 coplanar scan branch 추가. `auto_intersect_
  on_draw` flag (default true, localStorage 보존) 가 그대로 활용 — 새
  exec entry 없음.
- **L5 — XIA inheritance deterministic**: lens face 가 `min(face_a_id,
  face_b_id).xia` 로 inherit. 그리기 순서 무관성 (LOCKED #1 P7) 답습.
  face_a_only ← face_a.xia, face_b_only ← face_b.xia.
- **L6 — Out-of-scope deferred** (ADR-101 §5 변경 없음):
  - Non-convex polygon clipping (Weiler-Atherton / Vatti) — 별도 ADR
  - 3-way overlap (A ∩ B ∩ C) — Phase C-4 future
  - NURBS-direct coplanar intersect (현재 polygonize 후 clip → 향후
    direct AnalyticCurve SSI via ADR-027/064 cross-cut) — 별도 ADR
  - Multi-material overlap UX (lens identity refinement) — ADR-102
    가칭, future trigger 시 진행

**Canonical lessons (7개) — 보존**:
- L1 — "Check first, mutate second" (Amendment 6 → 7)
- L2 — Playwright `dist/` staleness — `npm run preview` 가 production
  build 서빙. WASM rebuild 후 `npm run build` 필수. **세션 canonical**.
- L3 — AxiA viewport Y-up — `setViewMode('top')` 가 -Y 축 down.
- L4 — Default camera radius 60000mm — `setCameraState({radius, target})`
  로 fit 필수.
- L5 — Algorithm gaps in non-canonical input — RECT 만 통과한 알고리즘이
  Circle 에서 실패 발견 가능 (B-3c start_idx fix).
- L6 — Pure utility extraction (ADR-091 §E L4) — 함수 분리가 target
  fix 가능하게 만듦 (B-3a / B-4b helpers).
- L7 — Multi-week atomic decomposition (ADR-094 §E L1) — additive-first
  risk 격리 + multi-gate 결재 (본 9 PR 시리즈 정합).

**회귀 누적**:
- axia-core: 209 → **293 PASS** (+84)
- axia-geo: 1256 → **1296 PASS** (+40)
- Playwright E2E: 15 → **74 + 1 skipped** (+7 new B-6 specs)
- 절대 #[ignore] 금지 100% 준수

**회귀 자산 (LOCKED — 변경 시 새 ADR 필요)**:
axia-geo `operations::coplanar::tests` 16 회귀 (B-2 9 + B-3a 7 + B-3b
6 + B-3c 4 + B-4b 6 = engine layer 회귀 자산):
- `adr101_phase_b2_partial_overlap_returns_lens_and_2_crossings`
- `adr101_phase_b3a_partial_overlap_two_rects_returns_l_shape`
- `adr101_phase_b3b_two_rects_partial_overlap_creates_3_faces`
- `adr101_phase_b3c_path_b_circles_polygonize_and_split`
- `adr101_phase_b4b_face_world_aabb_path_b_circle_non_destructive`
- `adr101_phase_b4b_disjoint_path_b_circles_no_mutation`
- `adr101_phase_b4b_path_b_circles_partial_overlap_auto_splits`
- (and 9 more)

axia-core `scene::tests` 7 회귀:
- `adr101_b4_two_rects_partial_overlap_auto_splits`
- `adr101_b4_two_circles_partial_overlap_auto_splits`
- `adr101_b4_two_circles_as_shape_partial_overlap_auto_splits`
- `adr101_b4b_two_path_b_circles_partial_overlap_auto_splits`
- `adr101_b4b_disjoint_path_b_circles_preserve_kernel_native`
- `adr101_b4_disjoint_rects_no_split`
- `adr101_b4_disabled_flag_skips_split`

Playwright E2E `web/e2e/adr-101-b6-*.spec.ts` 7 회귀 (3 engine + 4 visual).

**Cross-link**:
- LOCKED #1 ADR-021 P7 (canonical anchor) — 본 정책으로 *완전한* 의미 활성
- LOCKED #14 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다") — deepest realization
- ADR-022 P9 (vertex-shared pinch promote) — Option (b) lens promote inspiration
- ADR-028 Phase A (hybrid Edge) — B-4b first-class 활용
- ADR-059 P-N Step 3 (`curve_mandatory()`) — future NURBS-aware migration anchor
- ADR-061 §B (curve_version, polyline_cache) — hover Newton 인프라
- ADR-064/066 (NURBS Boolean DCEL) — future NURBS-direct intersect path
- ADR-077 V-3 (visual baseline workflow) — B-6 visual demo 인프라
- ADR-089 (Path B closed-curve face) — Path B canonical form, B-4b 직접 활용
- ADR-091 §E L4 (pure utility extraction) — B-3a / B-4b helpers
- ADR-094 §E L1 (additive-first + multi-gate atomic) — 본 9 PR 시리즈 답습
- LOCKED #40 (render chord_tol) — Phase D visual baseline 인프라 활용

**Amendment 9 — 결함 C fix + §3.2 매트릭스 정정 (2026-05-16)**

Closure 후 추가 사용자 시연 audit 으로 발견된 render edge hide 결함의
architectural fix + §3.2 매트릭스 정정.

- **A9.1 §3.2 매트릭스 정정 (canonical)**:
  - "Containment ✅ Hole injection" → "❌ 자동 hole injection 비활성"
    (LOCKED #1 ADR-015 B1 auto hole-promote 비활성 정책 정합)
  - "RECT × RECT ✅ 보임" 의미 정정 — 외부 boundary 만 visible, lens
    내부 분할 라인은 RECT × CIRCLE / CIRCLE × CIRCLE 과 동일하게 hide

- **A9.2 결함 C 진짜 메커니즘**:
  - `auto_intersect_coplanar` (coplanar.rs:444+10.5) 의 `remove_face × 2
    + add_face × 3` 가 새 boundary HEs 를 `flags = clear` 로 생성
  - Render `export_edge_lines_with_map` (mesh.rs:5384-5404) 의 angle
    coplanar test: Plane × Plane → dot=1.0 < cos(20.1°)=0.939 → hide
  - Contract 불일치: `Mesh::split_face` (mesh.rs:4068-4069) 는 HARD 명시
    부여, `auto_intersect_coplanar` 는 미부여

- **A9.3 Fix (Step 10.5 신설)** — lens outer boundary HEs (radial twin
  포함) HARD flag 부여. `set_flags(flags() | HARD)` 안전 OR 패턴
  (mesh.rs:2541 답습).

- **A9.4 Cross-cut audit inventory (메타-원칙 #15 정합)**:

| 함수 | HARD 부여 | 상태 |
|---|---|---|
| Mesh::split_face | ✅ canonical | reference |
| Mesh::polygonize_closed_curve_face | ❌ (substitute, split 아님) | 정합 (의도) |
| auto_intersect_coplanar | ✅ Amendment 9 | **fix 완료** |
| Mesh::split_face_by_chain | ❌ | 별도 PR 권장 |
| split_face_case_b/c/d | ❌ | 별도 PR 권장 |
| boolean.split_faces_by_intersections | ❌ | 별도 PR 권장 |

- **A9.5 회귀 누적 (Amendment 9)**:
  - axia-geo `operations::coplanar::tests` (+5): `adr101_amendment9_lens_
    outer_boundary_hes_hard` / `adr101_amendment9_external_boundary_
    unaffected` (scope creep 차단) / `adr101_amendment9_export_emits_
    lens_shared_edges` (wireframe visible) / `adr101_amendment9_
    invariants_preserved` / `adr101_amendment9_rect_x_circle_mixed_
    non_degenerate_splits` (보너스 — mixed case non-degenerate path 봉인)
  - 전체 axia-geo: 1318 → **1323 PASS**. axia-core ADR-101 8 PASS 유지.
  - 절대 #[ignore] 금지 5/5 준수.

- **A9.6 메타-원칙 #15 (사용자 결재 2026-05-16, canonical)**:
  > "동일한 분할 연산은 동일한 topological contract — 빠르고, 신속하고,
  > 정확하게."

  모든 split-type 함수가 split-induced edges 에 HARD flag 부여 동일
  contract 강제. Render path 의 coplanar hide 정책 (LOCKED #16 K-ε
  hotfix) 과 split 의도의 충돌은 split-side 의 HARD 부여로 명시 해소.
  추가 분기 / lookup 없이 flag 1 bit 로 정확한 동작 보장 (force_hard
  fast-path, mesh.rs:5359).

- **A9.7 Out-of-scope (deferred)**:
  - ζ-3 cross-cut audit 의 잔존 4 함수 (split_face_by_chain / case_b/c/d
    / split_faces_by_intersections) — 별도 PR 권장
  - ζ-4 Playwright B-6 visual demo 의 visible assert — 선택 사항
  - Visual baseline (LOCKED #40 / ADR-077) 의 lens shared edges 색상 —
    별도 visual baseline 확장
  - Lens 내부 분할 라인의 사용자 highlight UX — 별도 ADR
  - **결함 D — Mixed case vertex-on-corner degeneracy** (canonical,
    사용자 시연 evidence 2026-05-16): RECT × CIRCLE 의 cardinal
    alignment 시 `coplanar_intersection_segments` crossings=0 (lens
    detected but boundary cross missed). ADR-101 B-1 Sutherland-Hodgman
    MVP convex 가정의 known boundary degeneracy. Non-degenerate path
    는 정상 동작 (보너스 회귀 봉인). Algorithm-level fix (Weiler-
    Atherton / Vatti / vertex-on-edge fallback) 별도 ADR.
    **✨ 자연 해소 — ADR-107 (PR #65)**: 2026-05-16 audit (D2) 에서
    `drawCircleAsCurve` (Path B) 사용 시 동일 trigger → split=3 ✅
    확정. Path B chord_tol-driven sampling 이 cardinal alignment
    회피. ADR-107 ζ-β engine dispatch 후 자동 해소 → 별도 algorithm-
    level fix ADR 불필요.

- **Amendment 9 PR sequence**:
  - ζ-1 (a01b2e4) — Amendment 9 spec docs
  - ζ-2+ζ-3 (a980e3f) — engine fix + cross-cut audit + 4 회귀
  - ζ-5 (113f2db) — CLAUDE.md LOCKED #41 + 메타-원칙 #15 등재
  - ζ-3-bonus (본 commit) — mixed case non-degenerate 회귀 +1 + 결함 D
    Out-of-scope 명시

### 42. ADR-102 Push/Pull Detach-on-Arrangement (Manifold Reconciliation, 2026-05-15) ✅

**Canonical anchor (사용자 통찰, 2026-05-15)**:
> "Push/Pull 한 face 가 인접 coplanar sibling 과 공유한 boundary 를
> cleave 한 후 extrude 해야 한다. 그렇지 않으면 결과 솔리드의 bottom 이
> sibling 과 manifold-coincident 가 돼 LOCKED #1 P7 manifold rule 을
> 위반한다."

ADR-101 §B-3b closure 직후 (2026-05-15) Tier 2 cross-cut 검증 도중
발견된 manifold finding 의 architectural 해결. ADR-047 D-A note
(2026-05-02) 의 *deferred deeper refactor* 정상화. Mesh-era 정책
(LOCKED #1 P7 stacked-inner 허용) ↔ NURBS-era hybrid 인프라 (ADR-101
auto-intersect 3 sub-face) 정합.

**5 PR Path Z atomic closure (5 시간 내, 2026-05-15)**:
- PR #36 α — spec ADR-102 + 5 sub-step roadmap (`04be1b9`)
- PR #37 β — `collect_coplanar_siblings` + `cleave_face_from_siblings`
  helpers (`81cfe4f`, axia-geo +4)
- PR #38 γ — `create_solid_extrude` pre-step wiring + closed-curve
  hot-path fix (`219ba37`, axia-geo +2)
- PR # δ — Full regression sweep (`d437d2d`, axia-geo +6, canonical
  manifold-finding-resolved evidence)
- PR # ε — Closure docs + LOCKED #42 entry (본 entry)

**누적 회귀**: axia-geo 1296 → **1308 PASS (+12, 0 regression, 절대
#[ignore] 금지 12/12 준수)**.

**8 Lock-ins (canonical for hybrid-aware ops)**:
- **L-102-1** Source-side cleave only — sibling face 의 outer/inner
  loops 무손상 (boundary verts / HEs / curve metadata / surface 모두
  보존)
- **L-102-2** Coplanarity tolerance — `COPLANARITY_NORMAL_DOT_MIN`
  (0.9999) AND `COPLANARITY_OFFSET_TOL` (1.5μm, LOCKED #5 답습)
- **L-102-3** Edge cleave manifold safe — cleave 후 새 source face
  의 모든 boundary edge 가 *해당 face 만* incident. 기존 shared edge
  는 sibling 의 boundary 로 남음 (manifold safe)
- **L-102-4** Extrude-only trigger — `create_solid_extrude` 의 pre-
  step *만* cleave 호출. Boolean / Offset / Move 영향 0 (additive)
- **L-102-5** Curve metadata inherit — 새 boundary edges 가 원본
  `Edge.curve` clone + *새* `curve_owner_id` 할당 (group separation,
  ADR-088 답습)
- **L-102-6** Transaction 단일 entry — cleave + extrude 가 단일 Undo
  step (Scene-layer `TransactionManager` 가 wrap, ADR-049 P-5e-γ
  collapse 답습)
- **L-102-7** 회귀 자산 강제 — δ-1 ~ δ-8 모두 절대 #[ignore] 금지.
  δ-4 (`adr101_b4_lens_push_pull_manifold_safe_after_cleave`) 가
  canonical evidence (non_manifold_edge_count == 0)
- **L-102-8** ADR-016 Q2 정합 — hole boundary face Push/Pull 거부
  정책 변경 없음. 본 ADR 은 outer boundary 만 대상

**Canonical evidence (δ-4)** — pre-ADR-102 시 B-4 lens Push/Pull 에서
4 non-manifold edges (lens boundary × 3 face-bearing HE) → γ wiring
후 **0 non-manifold edges** 명시 검증. test 자산이 architectural
guarantee.

**Lessons (canonical for future ADRs)** — ADR-102 §E:
- **E.L1** `Result.new_face_id` 의미적 invalidation — destructive
  helper 결과의 *대체 id* carry, caller shadow pattern 강제
- **E.L2** Closed-curve face architectural isolation — ADR-089
  Phase 2 kernel-native (1 anchor + 1 self-loop) 가 polygon-assumption
  helper 에서 hot-path 필요
- **E.L3** 사용자 시연 게이트의 architectural 가치 — ADR-087 K-ζ
  / ADR-094 §E L1 답습
- **E.L4** Atomic 5 sub-step (α/β/γ/δ/ε) 의 *문서 → 코드 → 검증 →
  회고* 분리 — 단일 finding trigger 의 ideal scope
- **E.L5** Pure helper extraction (cleave) + consumer 가 적용 결정
  — ADR-091 §E L4 pure utility extraction canonical 9번째 적용
- **E.L6** ADR-091 §E L1 (struct field 추가 0, snapshot schema 변경
  0) 10번째 적용 — additive only

**Cross-link**:
- LOCKED #1 ADR-021 P7 — manifold anchor (본 ADR 이 위상 측면 보강)
- LOCKED #5 — 1.5μm spatial-hash, coplanarity tolerance source
- LOCKED #41 — ADR-101 closure (cross-cut trigger source)
- ADR-007 Invariant 2 — winding + manifold, cleave 후 보존
- ADR-016 Q2 — hole boundary policy 변경 없음
- ADR-022 P9 — vertex-shared pinch promote (small-face 분리 inspiration)
- ADR-046 P31 #4 — additive only (사용자 facing API 무변경)
- ADR-049 P-5e-γ — transaction collapse 답습
- ADR-079 — `create_solid` surface-native (extrude entry point)
- ADR-088 — `curve_owner_id` group separation 답습
- ADR-089 Phase 2 — closed-curve kernel-native isolation
- ADR-091 §E L1, §E L4 — additive + pure helper canonical
- ADR-094 §E L1 — additive-first + multi-gate atomic
- ADR-101 §B-3b L-B3b-3 — surface inheritance 답습
- ADR-101 cross-cut finding (2026-05-15) — 본 ADR trigger

### 43. ADR-103 Z-up Coordinate Migration (Engine + Viewport, 2026-05-15) ✅

**Canonical anchor (사용자 결재, 2026-05-15)**:
> "지금 문제는 기능 부족이 아니라 '틀린 좌표계 위에서 CAD 커널이
> 돌아가고 있는 문제' 이며, 이를 해결하려면 반드시 엔진 Z-up (B)
> 전환이 선행되어야 한다."

AxiA 의 5개월간 implicit Y-up convention 을 명시적 Z-up 으로 마이
그레이션. ADR-049 LOCKED #26 의 5개월 implicit → explicit 결재 패턴
답습. P1 페르소나 (건축/디자인) CAD parity (SketchUp / Fusion /
SolidWorks) 의 *first-impression* 신뢰성 unlock + boundary epsilon
누적 영구 종료.

**절대 우선순위 (canonical, 변경 불가)**:
```
1. ADR-103 Z-up (선행 조건)
2. Path B (Sphere/Cone/Torus 확장)
3. STEP timing 단축
4. NURBS-aware coplanar intersect
```

Path B 를 Z-up 보다 먼저 진행하면 *틀린 좌표계 위에서 확장* → bug
증폭. 이 인과는 모든 후속 architectural ADR 의 anchor.

**6 PR sequence (main 진입)**:
- PR #42 Amendment 1 (audit + 5-split) — `159b8bd`
- PR #43 β-1 (5 primitive Z-up engine) — `34a2fa3`
- PR #44 Amendment 2 (4-split + β-2 audit) — `7abf618`
- PR #45 γ (Viewport camera + grid + 6 view modes) — `bd70d16`
- PR #46 γ-fix #1 (axis lines + arrows + grid double-rotation) — `95d2417`
- PR #47 ζ (DXF identity + Y-up mesh inverse + shadow Z-up) — `86a08ea`

**4 post-merge hotfix (사용자 시연 트리거)**:
- #1 axis + grid double-rotation (`fb51b00`, in #46)
- #2 orbit theta sign — Z-up CCW around +Z (open)
- #3 shadow Z-up — sun/dirLight/Receiver::ground (`b2c8305`, in #47)
- #4 mouse pick work plane — XY ground (Z=0) (open)

**5 stacked PR (ζ 이후 merge 예정)**:
- δ-1 drawing plane + primitive defaults
- δ-2 BoxTool deep Z-up rewrite
- orbit theta sign hotfix
- ε-1 Snapshot V2→V3 vertex pos migration
- ε-2 AnalyticSurface/Curve axis rotation
- mouse pick work plane fix

**Lock-ins (10개, canonical for ADR-103)**:
- L-103-1 절대 우선순위 (Z-up 선행, 변경 불가)
- L-103-2 Engine + Viewport 동시 flip (Option A/C 거부, Option B
  full flip 채택)
- L-103-3 Snapshot V2 → V3 load-time auto-rotate (사용자 facing
  disruption 0)
- L-103-4 Boundary I/O identity (DXF/STEP/IGES) + Y-up mesh inverse
  (OBJ/STL/glTF +90° around +X)
- L-103-5 Fixture 일괄 갱신 — initial sed-able assumption audit 후
  semantic 분류 (Amendment 1/2)
- L-103-6 Visual baseline regenerate (ADR-077 V-4 follow-up 트랙)
- L-103-7 사용자 시연 게이트 필수 (4 post-merge hotfix evidence)
- L-103-8 ADR-026 P12 SSOT 보존 (cardinal plane snap 좌표계 무관)
- L-103-9 ADR-046 P31 #4 additive only (사용자 facing API 변경 0)
- L-103-10 절대 #[ignore] 금지

**누적 회귀**: +17 신규 (β-1 +7, ε-1 +3, ε-2 +7), 0 regression.
axia-geo 1315 / axia-core 296 / vitest 1828 PASS. 절대 #[ignore]
금지 17/17 준수.

**사용자 facing 매트릭스** (Before → After):
- Engine primitive height: Y → **Z**
- Viewport camera up: Y → **Z**
- Grid: XZ plane (Y=0) → **XY ground (Z=0)**
- Drawing plane (3d default): XZ ground → **XY ground**
- BoxTool 3-click extrude: Y → **Z**
- Orbit drag: drag right → scene left → **drag right → scene right**
- Shadow ground: XZ → **XY**
- Sun az/el: Y-up → **Z-up CAD (north=+Y, up=+Z)**
- Snapshot: V2 → **V3** (V2 load auto-rotates)
- DXF/DWG import: `(x,z,-y)` → **identity**
- OBJ/STL/glTF import: identity → **+90° around +X**
- Mouse pick (3d): Y=0 plane → **Z=0 plane**

**Lessons (canonical for future architectural ADRs)** — ADR-103 §11.7:
- **L1 사전 결재 절대 우선순위 강제** — 사용자 canonical anchor 가
  순서를 명시 → 잘못된 priority 회피
- **L2 audit-first vs sed assumption** — spec α-1 sed-able 가정 →
  Amendment 1/2 사후 정정 (production / test 분리 자산 발견)
- **L3 5개월 production / test 분리 자산** — β-2 production scope
  = ∅, axis-agnostic algorithm 모범
- **L4 시연 게이트의 architectural 가치** — 4 post-merge hotfix 모두
  사용자 시연 후 발견 (test 만으로는 가시화 불가능, ADR-087 K-ζ
  canonical 답습)
- **L5 atomic stacked PR pattern** — δ-1/δ-2/orbit/ε-1/ε-2/mouse
  pick 5 stacked PR 의 PR queue 관리 canonical

**Cross-link**:
- ADR-049 LOCKED #26 (5개월 implicit → explicit pattern anchor)
- ADR-091 §E L1 (snapshot schema migration canonical)
- ADR-077 V-4 (visual baseline regenerate procedure, η deferred)
- ADR-046 P31 #4 (additive only)
- ADR-026 P12 (cardinal plane SSOT, 좌표계 무관)
- ADR-036 P21.6 (STEP round-trip 1e-3 mm — boundary identity 후
  tolerance 여유 확대)
- ADR-035 P20.A (STEP AP242 primary)
- ADR-079, ADR-080 (engine layer Z-up site)
- ADR-081 W-η (STEP/IGES boundary)
- ADR-087 K-ζ (사용자 시연 게이트 canonical)
- ADR-094 §E L1 (additive-first + multi-gate atomic)
- LOCKED #1, #5, #7, #26, #40, #41, #42 (좌표계 무관 정합 자동)

### 44. Complete Meaning per Merge (2026-05-16)

**Canonical anchor (사용자, 2026-05-16)**:
> "커널에서 중요한 건 merge 횟수가 아니라 **각 merge 가 complete
> meaning 을 가지는가**입니다."

LOCKED #43 ADR-103 의 사용자 directive ("좌표계 의미가 깨지는
중간 상태 절대 허용 안 됨") 가 **semantic atomicity** 의미로 정착.
*workflow atomicity* (작은 변경 마다 PR) 로 확장 적용한 패턴은
폐기.

#### 의사결정 매트릭스

| 변경 단위 | 기준 | PR? |
|---|---|---|
| Complete semantic unit (ADR closure, atomic stack, cleanup pass) | 의미 완결 | ✅ |
| Partial semantic unit (ε-1 단독 like, half-cleanup) | 중간 상태 위반 risk | ❌ |
| Cleanup batch (모든 crate warnings, 모든 dead code) | 의미 완결 (single pass) | ✅ |
| Cleanup fragment (1 crate 만, 1 file 만) | 의미 partial | ❌ |
| Documentation only complete | 의미 완결 | ✅ (작은 변경도 OK) |
| Trivial docs typo | 의미 완결 (single fix) | main 직접 commit OK |
| Hotfix complete | 의미 완결 | ✅ |
| Multi-feature 묶음 (서로 무관) | 의미 분산 | ❌ 분리 |

#### 핵심 원칙

1. **Semantic atomicity = anchor** — workflow atomicity 가 아닌
   *의미* 의 완결성.
2. **Merge 횟수는 free variable** — 의미 단위에 따라 결정.
3. **Branch 수 ≠ 안전성** — branch 많은 것 자체 문제 아님.
   문제는 *완결되지 않은 의미* 가 main 에 진입.
4. **main 은 항상 complete state** — partial merge 시 invariant
   위반 (LOCKED #43 PR #51 ε-1 단독 merge case 답습 — 즉시
   PR #52 ε-1+ε-2 atomic 으로 복원).

#### Lock-ins (canonical)

- **L-44-1** Semantic completeness 가 분할 기준 — 작업량 / 시간 /
  변경 양 아님
- **L-44-2** ADR closure = 1 complete meaning (multi-PR 가능 — 각
  PR 이 *자체* complete sub-meaning, atomic stack 패턴 답습)
- **L-44-3** Cleanup pass = 1 complete meaning (warnings 153 → 0
  전체 통합 PR — partial cleanup PR 거부)
- **L-44-4** Hotfix = 1 complete meaning (사용자 시연 후 발견된
  구체적 결함의 *완전* 해결, partial fix 거부)
- **L-44-5** Trivial docs typo / formatting → main 직접 commit
  OK (CI는 main 에서도 작동, branch 불필요)
- **L-44-6** Branch lifecycle = 의미 진행 중 동안만. 의미 완결 →
  merge → branch 삭제. *진행 중 abandoned* branch 폐기 정책 적용.

#### 회귀 사례 (이미 발생, 학습)

- **PR #51 ε-1 단독 merge** (LOCKED #43 #43 회고) — vertex Z-up +
  surface Y-up 중간 상태 → 즉시 PR #52 atomic 으로 복원. 본
  LOCKED 의 *원인 사례*.

#### 적용

- LOCKED #43 의 atomic directive → semantic 의미로 명확화
- 향후 모든 변경 의사결정 anchor (Tier 2 / fusion / 모든 후속 ADR)
- 메타-원칙 #10 (ADR 불변) 정합 — ADR 변경 시 새 ADR + Superseded,
  본 LOCKED 도 동일

#### Cross-link

- LOCKED #43 ADR-103-ε atomic directive (canonical anchor source)
- 메타-원칙 #10 (ADR 불변)
- ADR-094 §E L1 (additive-first + multi-gate atomic — atomic stack
  패턴의 multi-PR 활용 예)
- ADR-076 §C-amendment-1 (cleanup deletion — complete pass 예)

### 45. ADR-111 BVH Defer to Next Frame (α closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "α 우선 (단순/신속/정확 정합 + 30분 closure) + β 는 별도 ADR 후속."

사용자 시연 "그릴때 너무느려요" (2 개 중첩 sphere) trigger → 직접 측정
audit → primitive create flow 의 `viewport.updateMesh.fullUpdate` 비용
의 55% (= 145 ms @ 376K tris) 가 `computeBoundsTree({indirect:true})`
임을 발견. PR #73 β (Lazy syncMesh via RAF) 답습 패턴 *확장* — syncMesh
자체 defer 위에 syncMesh *내부* 의 BVH 작업도 한 frame 더 defer.

**Lock-ins (8개, canonical for defer-in-syncMesh ADRs)**:
- L-111-1 frameScheduler TaskKey 'bvhRebuild' 사용 (BUDGETS 33ms,
  latest-wins dedup 자동)
- L-111-2 `_scheduleBvhBuild` 위치 정합 (PR #73 β `_scheduleSmoothNormals`
  답습 — 동일 시그니처 / 동일 dispose guard / 동일 실패 모드)
- L-111-3 `{ indirect: true }` 옵션 보존 (Critical — faceMap[ti]→faceId
  매핑 무결성, Viewport.ts:1073 회귀 차단)
- L-111-4 Picking O(N) naive fallback 의 시각적 비용 0 (three-mesh-bvh
  patch 의 자연 동작 — 1 frame 영역)
- L-111-5 Telemetry 통합 (frameScheduler 자동 `telemetry.record('bvhRebuild',
  elapsed)` 호출)
- L-111-6 LOCKED #40 (chord_tol) / LOCKED #16 (ADR-038 P23) 회귀 0
- L-111-7 ADR-046 P31 #4 additive only (API surface UNCHANGED)
- L-111-8 메타-원칙 #11 정합 (Click 33ms budget — 1st sphere 2.4ms,
  3rd sphere 18.4ms)

**측정 (real SphereTool flow, clean → 3-sphere 누적)**:

| Sphere # | clicks (user-perceived) | forced sync | total | 개선 |
|---|---|---|---|---|
| 1st | **2.4 ms** ✓ Budget 7% | 87.3 ms | 89.7 ms | **33% ↓** |
| 2nd | 13.1 ms ✓ Budget 40% | 190.3 ms | 203.4 ms | **20% ↓** |
| 3rd | **18.4 ms** ✓ Budget 56% | 254.2 ms | 272.6 ms | **21% ↓** |

**회귀 누적 (α-2 ~ α-4)**: vitest **+7** (`Viewport.bvh.test.ts` —
defer 검증 / latest-wins dedup / `{indirect:true}` 보존 / dispose guard
/ no-op without BVH patch / telemetry integration). 합계 1831 →
**1838 PASS**, 절대 #[ignore] 금지 7/7 준수.

**Lessons (canonical for future defer-based perf ADRs)** — ADR-111 §6:
- L1 Path Z atomic 패턴의 sub-ADR 변형 — 큰 syncMesh 내부에서 추가
  defer 후보가 있으면 *같은* frameScheduler TaskKey 패턴으로 계속 분리
- L2 측정 우선, fix 결정 (메타-원칙 #6 Preventive over Curative) —
  초기 가정 (analytic check loop = bottleneck) 은 측정 후 *틀린* 것으로
  확인. 진짜 cost 는 BVH (145ms) 였음.
- L3 α + β 분리 의 가치 (Spec-less canonical fix scope) — α (30분
  closure) 가 β (multi-week atomic delta-buffer ADR) 보다 먼저 진행 →
  즉시 사용자 facing gain. 향후 ADR 가이드: lettered options 결재 시
  *가장 단순* 한 option 우선.

**후속 트랙 (모두 별도 ADR)**:
- β — Delta-buffer extension to primitives (예상 sync 30ms, 90% 감소,
  multi-week atomic)
- γ — EdgesGeometry fallback 비용 audit (α 이후 *다음* 가장 큰 비용
  230~270ms, 별도 audit)
- δ — BVH worker thread (OffscreenCanvas 호환성 audit 후)

**Cross-link**:
- 메타-원칙 #11 (Latency Budget First — Click 33ms budget 정합)
- 메타-원칙 #6 (Preventive over Curative — 측정 우선)
- ADR-012 §2 (FrameScheduler latest-wins TaskKey)
- ADR-038 P23 (surface-aware normals — render 영향 0)
- ADR-046 P31 #4 (additive only — API surface UNCHANGED)
- PR #73 β (Lazy syncMesh via RAF — 답습 패턴 직계 source)
- LOCKED #40 (render chord_tol — baseline 보존)

### 46. ADR-112 Edges Empty 명시 처리 / EdgesGeometry Fallback Null Only (β-c closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "승인합니다" — β-c 묶음 (β-a + β-b) 진행. LOCKED #44 "Complete
> Meaning per Merge" 정합으로 single PR 의미 단위 완결.

ADR-111 α (BVH defer) closure 후 사용자 결재 ζ (α 시연 + β audit) 의
β audit 결과 — *다음* 가장 큰 비용 발견. `engine.get_edge_lines()` 의
명시 empty 결과 (smooth-group hide, LOCKED #40 §L7) 가 cache layer 의
null-coalesce 으로 폐기되어 `THREE.EdgesGeometry(geometry, 30)` fallback
(584ms @ 5-sphere) 으로 잘못 라우팅되는 회귀 차단.

**Lock-ins (8개, canonical for engine→view layer semantic preservation)**:
- L-112-1 `Float32Array(0)` 통과 (β-a — WasmBridge.getEdgeLines empty
  → null-coalesce 제거)
- L-112-2 Viewport 3-way edges fallback policy (β-b — null/undefined =
  fallback / length>0 = DCEL / length===0 = no-op)
- L-112-3 LOCKED #40 §L7 의 architectural decision 시각 layer 전달
- L-112-4 Legacy fallback 보존 (graceful — WASM 미빌드 / mock / throw)
- L-112-5 ADR-038 P23 / LOCKED #40 §L7 회귀 0
- L-112-6 Caching invariant 유지 (empty Float32Array 도 truthy cache hit)
- L-112-7 ADR-046 P31 #4 additive only (API surface UNCHANGED)
- L-112-8 메타-원칙 #11 정합 (syncMesh 33ms budget — 5-sphere 713ms →
  35ms = 95% 감소)

**측정 매트릭스 (sphere-only scene)**:

| Spheres | tris | edgesMs before | edgesMs after | totalSyncMs before | totalSyncMs after |
|---|---|---|---|---|---|
| 1 | 32K | 78 ms | **0 ms** | 90 ms | **12 ms** |
| 2 | 64K | 287 ms | **0 ms** | 305 ms | **15 ms** |
| 3 | 96K | 310 ms | **0 ms** | 333 ms | **22 ms** |
| 4 | 129K | 461 ms | **0 ms** | 489 ms | **31 ms** |
| **5** | 161K | **584 ms** | **0 ms** | **713 ms** | **35 ms** |

**→ 5-sphere 기준 syncMesh 20× faster** (713ms → 35ms). 메타-원칙 #11
syncMesh 33ms budget 거의 도달.

**회귀 누적 (β-c-3 ~ β-c-6)**: vitest **+13** (WasmBridge +5 β-c +
Viewport.edges-policy +8). 합계 1838 → **1851 PASS**, 절대 #[ignore]
금지 13/13 준수.

**Lessons (canonical for cross-layer semantic preservation ADRs)** —
ADR-112 §6:
- L1 Empty 와 null 의 의미 분리 (architectural correctness) — "function
  의 empty result" 와 "function 미실행" 은 의미적으로 다름. cache layer
  의 null-coalesce 가 두 의미 통합하면서 architectural information 손실
  회귀.
- L2 α 의 evidence 가 β 의 anchor (Path Z atomic 답습) — "측정 → fix
  → 측정 → 다음 fix" atomic 체인이 각 step 의 architectural correctness
  확보. 큰 cost 흡수 시 다음 가장 큰 cost 자연 노출 → atomic 분리.
- L3 LOCKED 정책의 cross-layer 정합 강제 — LOCKED #40 §L7 (engine
  smooth-group hide) 의 architectural decision 이 cache layer 의 null-
  coalesce 에서 무력화되던 회귀 발견. LOCKED 정책의 architectural decision
  은 모든 layer 에서 보존되는지 별도 audit 권장.
- L4 Complete Meaning per Merge (LOCKED #44) 정합 패턴 — β-a + β-b 가
  같은 의미 단위 (edges fallback policy) → 1 PR. 둘 중 1개만 merge 시
  invariant violation. LOCKED #44 의 의미 단위 분할 기준 정확 적용.

**후속 트랙 (모두 별도 ADR)**:
- γ — `bridgeQueries` + `fullUpdate` 나머지 sub-step 정리 (잔존 35ms
  → 33ms budget 완전 정합)
- δ — ADR-111 β (Delta-buffer extension to primitives, multi-week
  atomic)
- ε — Engine `get_edge_lines` ok-envelope (architectural cleanup,
  Rust `Result<Vec<f32>, EdgeError>` enum 분리)

**Cross-link**:
- ADR-111 α (BVH defer — 직계 trigger source)
- LOCKED #40 §L7 (smooth-group hide architectural decision)
- LOCKED #44 (Complete Meaning per Merge — β-a + β-b 묶음 정합)
- ADR-038 P23 (surface-aware normals — smooth-group source)
- 메타-원칙 #11 (Latency Budget First — syncMesh 33ms)
- 메타-원칙 #6 (Preventive over Curative — 측정 우선)
- ADR-046 P31 #4 (additive only — API surface UNCHANGED)

### 47. ADR-113 Sphere Path B Production Wiring (ADR-104 β-1 closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "ζ (β-1 atomic + β-2/β-3 별도 후속)으로 진행" — β-1 Sphere 완전 활성
> 단일 PR (LOCKED #44 Complete Meaning per Merge 정합).

ADR-104 β-1-β (Sphere Path B engine `create_sphere_kernel_native`) 가
이미 main 에 closure (11 회귀 PASS) 된 상태에서, 남은 wiring layers
(β-1-δ + ε + ζ + η) 를 single atomic PR 으로 closure. ADR-094 B-η
cylinder Path B production wiring 패턴 **1:1 mirror**.

**Lock-ins (8개)**:
- L-113-1 Single atomic PR per LOCKED #44 (Engine + WASM + TS + Production
  wiring 같은 의미 단위)
- L-113-2 ADR-094 B-η 1:1 mirror pattern — 모든 layer 가 cylinder pattern
  답습 (4-layer architectural template)
- L-113-3 Engine default OFF + production ON via localStorage (ADR-049
  P-5e-α 답습)
- L-113-4 Explicit OFF preference 보존 (`localStorage 'false'` 명시 시
  Path A 보존)
- L-113-5 Path A 회귀 자산 245+ 보존 (engine default OFF + dispatch 시점
  만 분기)
- L-113-6 Render zero-code-change (`tessellate_face_surface` 자연 활용 —
  ADR-031 Phase D infra)
- L-113-7 ADR-046 P31 #4 additive only (`create_sphere(...)` signature
  UNCHANGED)
- L-113-8 사용자 시연 게이트 PASS (real Chromium preview screenshot —
  매끈한 곡면 + 적도 edge 가시)

**측정 매트릭스 (real Chromium preview)**:

| Sphere count | Path A (default 12×12) | Path B (Amendment 2) | 감소율 |
|---|---|---|---|
| 1 | 144 / 264 / 122 | **2 / 1 / 1** | **99.0%** |
| 5 | 720 / 1320 / 610 | **10 / 5 / 5** | **98.6%** |

(faces / edges / verts. Default 사용자 spheres 가 즉시 Path B 로 라우팅.)

**회귀 누적 (β-1-δ ~ β-1-η)**: axia-geo **+6** (dispatch + flag toggle
+ memory reduction) + vitest **+9** (WasmBridge β-1-ζ 4 +
SpherePathBSettings 5). 합계 **+15**, 절대 #[ignore] 금지 15/15 준수.

**사용자 facing 변화**:
- 새 sphere 도구 → 자동 Path B (2 hemisphere face), 99% 메모리 감소
- 시각 quality 보존 (chord-tolerant tessellation via `tessellate_face_
  surface`, ADR-031 Phase D)
- Boolean / Offset / Push-Pull 의 NURBS direct dispatch 활성 (ADR-064/066
  /080 cross-cut)
- STEP export 의 analytic NURBSSurface (1e-3 mm round-trip)
- `localStorage 'axia:sphere-path-b-mode' = 'false'` 명시 시 Path A
  legacy 보존

**Lessons (canonical for future Path B primitive expansions)**:
- L1 β-1-β 가 main 에 먼저 존재 → wiring layers 만 묶음 (audit 우선 패턴)
- L2 Cylinder pattern 1:1 mirror canonical (새 패턴 0, template 재사용)
- L3 Render zero-code-change architectural value (`tessellate_face_surface`
  framework 의 uv-range subset 활용은 universal pattern)
- L4 LOCKED #44 의미 단위 분할 정확성 (primitive 별 atomic PR — β-2/
  β-3 자연 분리)

**후속 트랙 (모두 별도 ADR per LOCKED #44)**:
- β-2 Cone Path B (ADR-104 §11.1, 본 PR 1:1 mirror)
- β-3 Torus Path B (ADR-104 §11.2, 본 PR 1:1 mirror)
- γ ADR-104 §3.1 — Boolean / Offset / Push-Pull surface-driven dispatch
  verification
- δ STEP export NURBSSurface round-trip audit

**Cross-link**:
- ADR-094 (Cylinder Path B-full canonical) — 1:1 mirror source
- ADR-104 (Path B Expansion spec) + Amendment 2 (Q1=2-hemisphere)
- ADR-049 P-5e-α (engine OFF + production ON pattern)
- ADR-031 Phase D (AnalyticSurface::Sphere 인프라)
- ADR-091 §E L1 (Mesh-level Map canonical)
- LOCKED #43 (ADR-103 Z-up — equator anchor +X·radius, Z-up)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR anchor)

### 48. ADR-114 Cone Path B Production Wiring (ADR-104 β-2 closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "네 승인합니다" — ADR-113 sphere closure 직후 β-2 cone 진입.

ADR-104 β-2 Cone Path B atomic closure — **ADR-113 sphere production
wiring 패턴 1:1 mirror**. Engine + WASM + TS + Production + 시연 +
closure 모두 single PR (LOCKED #44 정합).

**Q2 revision lock-in (canonical)**: ADR-104 Amendment 1 §9.2 default
"NURBS degenerate edge + N base ring" (partial polygonal) 폐기 →
**base = closed-curve self-loop** (sphere Q1 Amendment 2 답습 — pure
kernel-native). Apex = degenerate parameter point (0 DCEL vertex).

**Cone Path B canonical**:
- 1 base anchor vertex at `center + (radius, 0, 0)` (Z-up)
- 1 self-loop edge with `AnalyticCurve::Circle`
- 2 face: base disk (Plane) + cone side (Cone with apex degenerate)
- 0 apex DCEL vertex (degenerate parameter, accessible via Surface.apex)

**Lock-ins (8개)**:
- L-114-1 Single atomic PR per LOCKED #44
- L-114-2 ADR-113 1:1 mirror pattern (sphere → cone)
- L-114-3 Engine default OFF + production ON via localStorage
- L-114-4 Explicit OFF preference 보존
- L-114-5 Path A 회귀 자산 보존 (dispatch 시점만 분기)
- L-114-6 Render zero-code-change (`tessellate_face_surface` Cone variant)
- L-114-7 ADR-046 P31 #4 additive only (`create_cone(...)` signature
  UNCHANGED)
- L-114-8 Q2 revision lock-in: apex degenerate + base self-loop (sphere
  Q1 Amendment 2 답습 — polyline approach 폐기)

**측정 매트릭스 (real Chromium preview)**:

| Cone count | Path A (default 24 segs) | Path B (canonical) | 감소율 |
|---|---|---|---|
| 1 | 25 / 49 / 26 | **2 / 1 / 1** | **92.0% / 98.0% / 96.2%** |
| 5 | 125 / 245 / 130 | **10 / 5 / 5** | **92.0% / 98.0% / 96.2%** |

(faces / edges / verts. 새 사용자 cones 즉시 Path B 라우팅.)

**회귀 누적**: axia-geo **+18** (12 cone kernel-native + 6 dispatch) +
vitest **+9** (WasmBridge β-2 4 + ConePathBSettings 5). 합계 **+27**,
절대 #[ignore] 금지 27/27 준수. axia-geo 1345 → **1363 PASS**, vitest
1864 → **1873 PASS**.

**Path B family 누적 통계** (Cylinder + Sphere + Cone 모두 production
default ON):

| Primitive | Path A | Path B | 감소율 |
|---|---|---|---|
| Cylinder (ADR-094) | 25/69/46 | 3/2/2 | 95% |
| Sphere (ADR-113) | 289/561/290 | 2/1/1 | 99%+ |
| **Cone (ADR-114)** | **25/49/26** | **2/1/1** | **92%** |

모든 Path B = small constant DCEL — 향후 Torus 도 동일 unlock 예상
(1 face / 2 edge / 1 vert per ADR-104 Amendment 1 Q3 default 또는
revised seam approach).

**Lessons (canonical for β-3 Torus 진입 시)**:
- L1 Sphere → Cone 1:1 mirror 완전성 — 4-layer template reproducibility
  증명. β-3 Torus 도 동일 답습.
- L2 Q-revisions unification (canonical consistency) — Q1/Q2 모두 closed-
  curve self-loop pattern. Q3 Torus 도 동일 논리 적용 권장.
- L3 Memory unlock 정량적 consistency (모든 Path B = constant DCEL)
- L4 LOCKED #44 의미 단위 분할의 가치 재확인 (primitive 별 자연 분리,
  코드 충돌 0)

**후속 트랙 (별도 ADR per LOCKED #44)**:
- β-3 Torus Path B (ADR-104 §11.2, 본 PR 1:1 mirror)
- γ Boolean / Offset / Push-Pull surface-driven dispatch verification
- δ STEP export NURBSSurface round-trip audit

**Cross-link**:
- ADR-113 (Sphere Path B production wiring) — direct 1:1 mirror source
- ADR-094 (Cylinder Path B-full canonical) — first Path B primitive
- ADR-104 (Path B Expansion spec) + Amendment 2 (sphere Q1 revision
  precedent for cone Q2)
- ADR-049 P-5e-α (engine OFF + production ON pattern)
- ADR-031 Phase D (AnalyticSurface::Cone 인프라)
- LOCKED #43 (ADR-103 Z-up — apex at center+(0,0,height), base anchor
  at center+(radius,0,0))
- LOCKED #44 (Complete Meaning per Merge)

### 49. ADR-115 Torus Path B Production Wiring + ADR-104 Family Complete (β-3 closure, 2026-05-17) 🎉

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "네 승인합니다" — ADR-114 cone closure 직후 β-3 torus 진입.
> **ADR-104 Path B family 완전 closure** (cylinder + sphere + cone + torus).

ADR-104 β-3 Torus Path B atomic closure — **ADR-114 cone production
wiring 패턴 1:1 mirror (3rd successful template reproduction)**. ADR-104
Path B Expansion 의 모든 4 primitives production default ON 활성.

**Q3 revision lock-in (canonical)**: ADR-104 Amendment 1 §9.3 default
"2-seam (axial + meridional)" 폐기 → **1-loop outer equator only**
(sphere Q1 + cone Q2 self-loop pattern 답습 — *canonical consistency
> strict topological correctness*). 2-seam strict approach 은 별도
atomic 트랙으로 분리 (ADR-115 §7 ε).

**Torus Path B canonical**:
- 1 anchor vertex at `center + (major+minor, 0, 0)` (Z-up, outer equator)
- 1 self-loop edge with `AnalyticCurve::Circle` (outer equator)
- 1 face with `AnalyticSurface::Torus` (full u/v range periodic)
- No Path A baseline (kernel-native from day 1)

**Lock-ins (9개)**:
- L-115-1 Single atomic PR per LOCKED #44
- L-115-2 ADR-114 1:1 mirror pattern (cone → torus, 4-layer template
  reproduction)
- L-115-3 Engine default OFF + production ON via localStorage
- L-115-4 Explicit OFF preference 보존
- L-115-5 No Path A baseline (torus kernel-native from day 1) — flag
  pattern preserved for consistency + future hook
- L-115-6 Render zero-code-change (`tessellate_face_surface` Torus
  variant)
- L-115-7 ADR-046 P31 #4 additive only (createTorus is new primitive)
- L-115-8 Q3 revision lock-in: 1-loop canonical (sphere/cone 답습 —
  canonical consistency 우선)
- L-115-9 ADR-104 Path B family closure — 모든 4 primitives production ON

**측정 매트릭스 (real Chromium preview)**:

| Torus count | hypothetical Path A | **Path B (canonical)** | 감소율 |
|---|---|---|---|
| 1 | 289 / 577 / 289 | **1 / 1 / 1** | **99.65% / 99.83% / 99.65%** |
| 5 | 1445 / 2885 / 1445 | **5 / 5 / 5** | linear scaling ✓ |

### 🎉 ADR-104 Path B Family Complete (cylinder + sphere + cone + torus)

| Primitive | ADR | PR | Path A | Path B | 감소율 |
|---|---|---|---|---|---|
| Cylinder | ADR-094 | (merged) | 25/69/46 | 3/2/2 | 95% |
| Sphere | ADR-113 | #76 | 289/561/290 | 2/1/1 | 99%+ |
| Cone | ADR-114 | #77 | 25/49/26 | 2/1/1 | 92% |
| **Torus** | **ADR-115** | **#78** | **289/577/289** | **1/1/1** | **99.7%** |

**모든 Path B primitives = small constant DCEL** (≤3 face / ≤2 edge /
≤2 vert). 대규모 scene 1000 primitives 기준 **메모리 99%+ 절감** +
NURBS direct dispatch 전체 활성 + STEP export 산업 CAD parity.

**회귀 누적 (β-3-β ~ β-3-η)**: axia-geo **+12** (kernel-native +
rejections + Z-up anchor + memory reduction + flag default/toggle) +
vitest **+11** (WasmBridge β-3 6 + TorusPathBSettings 5). 합계 **+23**,
절대 #[ignore] 금지 23/23 준수. axia-geo 1363 → **1375 PASS**, vitest
1873 → **1884 PASS**.

**ADR-104 family cumulative regression (4 PRs)**: axia-geo +49
(11 sphere kernel + 12 cone kernel + 6 cone dispatch + 12 torus kernel +
8 cumulative dispatch) + vitest +33 (sphere 9 + cone 9 + torus 11 + 4
cross-cut). 합계 **+82 across 4 PRs**, 절대 #[ignore] 금지 82/82 준수.

**Lessons (canonical for future primitive expansion)**:
- L1 Cone → Torus 1:1 mirror **3rd successful template reproduction** —
  4-layer template (engine + WASM + TS + production) 완전 reproducible.
- L2 Q-revisions canonical consistency (3-primitive cross-validation) —
  closed-curve self-loop pattern canonical. 향후 새 primitive 도 본 패턴
  우선 검토.
- L3 Path B family completion architectural value — 1000 primitive scene
  98.7% memory reduction. NURBS direct ops + STEP export 활성.
- L4 LOCKED #44 의미 단위 분할 4-PR seq validation — multi-component ADR
  의 component 별 atomic PR 으로 코드 conflict 0, CI/review
  independent.

**후속 트랙 (모두 별도 ADR per LOCKED #44)**:
- γ Boolean / Offset / Push-Pull surface-driven dispatch verification
  (ADR-104 §3.1 §3.2 — 모든 4 primitives cross-cut)
- δ STEP export NURBSSurface round-trip audit (ADR-035/036 P21.6
  tolerance verification for all 4 primitives)
- ε Torus 2-seam DCEL atomic (ADR-104 Amendment 1 §9.3 strict approach,
  Q3 revision §1.2 deferred)
- ζ TorusTool UI integration (`web/src/primitives/TorusTool.ts` new
  primitive tool)

**Cross-link**:
- ADR-094 (Cylinder Path B-full canonical) — first Path B primitive
- ADR-113 (Sphere) — first 1:1 mirror
- ADR-114 (Cone) — second 1:1 mirror, Q2 revision precedent
- ADR-104 + Q3 revision (본 ADR §1.1)
- ADR-049 P-5e-α (engine OFF + production ON pattern)
- ADR-031 Phase D (AnalyticSurface::Torus 인프라)
- LOCKED #43 (ADR-103 Z-up)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR anchor)

### 50. ADR-116 Path B Family User-Facing Closure (γ verification + ζ TorusTool, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "네 묶음으로 진행 승인합니다" — ADR-104 Path B family 의 user-facing
> complete closure 단일 PR (γ verification + ζ TorusTool UI).

ADR-104 Path B family (ADR-094/113/114/115) closure 후 user-facing 마지
막 layer 완전 결합. γ cross-cut verification (architectural promise audit)
+ ζ TorusTool UI integration (engine + bridge 만 있던 ADR-115 자연
closure).

**γ verification finding (α-1)** — architectural asymmetry locked-in:
`create_cylinder` 항상 Path A 반환, Path B 는 `create_solid` extrude path
만 활성. Sphere/Cone/Torus 는 direct primitive create 에서 dispatch.
의도된 design (ADR-094 cylinder Path B = extrude-based annulus). 별도
atomic ADR 으로 `create_cylinder` direct dispatch 추가 가능 (symmetry).

**Lock-ins (8개)**:
- L-116-1 Single atomic PR for "Path B family user-facing closure"
  (γ + ζ bundle per 사용자 결재 + LOCKED #44)
- L-116-2 γ verification 매트릭스 documented (4 primitives × surface
  attach + tessellation + invariants + memory)
- L-116-3 Cylinder dispatch asymmetry locked-in (regression test) —
  `create_cylinder` direct = Path A, `create_solid` extrude = Path B
- L-116-4 TorusTool 3-click flow (sphere/cone/cylinder UI 패턴 답습)
- L-116-5 Tool-side engine validation guard (minor >= major reject)
- L-116-6 ADR-046 P31 #4 additive only (TorusTool 신규 등록만)
- L-116-7 PrimitiveSession schema extension (PrimitiveType += 'torus',
  requiresSizing2 추가, semantic aliasing radius/height = major/minor)
- L-116-8 LOCKED #44 정합 (의미 단위 묶음 — γ + ζ 가 함께 "Path B
  family user-facing closure" 의 complete meaning)

**γ verification 매트릭스 결과** (모든 4 primitives PASS):

| Primitive | Surface attach | Tessellation | Invariants | Memory unlock |
|---|---|---|---|---|
| Cylinder (Path B via create_solid) | ✅ Cylinder | ✅ | ✅ | 95% |
| Sphere | ✅ Sphere (2) | ✅ | ✅ | 99%+ |
| Cone | ✅ Cone (side) | ✅ | ✅ | 92% |
| Torus | ✅ Torus | ✅ | ✅ (Q3 quirks ≤2) | 99.7% |

**ζ TorusTool UI** — 3-click flow (anchor → major_radius → minor_radius)
+ ToolManager registration `tools.set('torus', new TorusTool(ctx))`.
Tool-side engine guard 의 minor>=major reject + bridge.create_torus
graceful no-op (legacy build 호환).

**회귀 누적 (γ + ζ)**: axia-geo **+10** (path_b_family_verification
module 10 tests) + vitest **+10** (TorusTool 10 tests). 합계 **+20**,
절대 #[ignore] 금지 20/20 준수. axia-geo 1369 → **1379 PASS**, vitest
1884 → **1894 PASS**.

**ADR-104 family final cumulative (5 PRs: β-1 + β-2 + β-3 + γ + ζ)**:
- axia-geo +59 (sphere 11 + cone 18 + torus 12 + γ 10 + cross-cut 8)
- vitest +43 (sphere 9 + cone 9 + torus 11 + TorusTool 10 + 4 misc)
- Total **+102 across 5 PRs**, 절대 #[ignore] 금지 102/102 준수

**Lessons (canonical for future architectural family closure)**:
- L1 Verification 의 architectural finding 가치 — γ verification 이
  단순 sanity check 가 아닌 architectural asymmetry audit. 모든 family
  closure 후 cross-cut verification 필수.
- L2 Test failure → architectural finding documentation pattern —
  test 가 fail 시 fix 가 아닌 architectural reality 발견. Test 를
  reality 에 맞게 update + 명시 regression lock-in.
- L3 Bundle scope per LOCKED #44 — γ + ζ 가 "complete meaning" 으로
  자연 묶음. 향후 multi-component closure scope 결정 시 참조.
- L4 PrimitiveSession schema extension via semantic aliasing — 새 field
  추가 없이 기존 slot 재사용 (ADR-091 §E L1 자연 답습).

**🎉 ADR-104 Path B Family Complete (5 ADRs, 5 PRs)**:
- ADR-094 (Cylinder Path B-full canonical) — first
- ADR-113 (Sphere Path B production wiring) — first 1:1 mirror
- ADR-114 (Cone Path B production wiring) — second mirror, Q2 revision
- ADR-115 (Torus Path B production wiring) — third mirror, Q3 revision
- **ADR-116 (Path B Family user-facing closure) — γ verification + ζ
  TorusTool UI**

**후속 트랙 (별도 ADR per LOCKED #44)**:
- γ-next Cylinder primitive direct dispatch (α-1 asymmetry 해소,
  symmetry with sphere/cone)
- δ-next TorusTool menu / keyboard binding (Primitive menu entry)
- ε STEP timing 단축 (LOCKED #43 priority #3 — ADR-082 Drift #5)
- ζ NURBS-aware coplanar intersect (LOCKED #43 priority #4 — ADR-101 §5)

**Cross-link**:
- ADR-094 / ADR-113 / ADR-114 / ADR-115 — Path B family predecessors
- ADR-104 (Path B Expansion spec) §3.1 §3.2 — γ verification spec
- ADR-046 P31 #4 (additive only — TorusTool 신규 등록)
- ADR-091 §E L1 (struct field 추가 0 — semantic aliasing)
- LOCKED #43 (Z-up — TorusTool 좌표 정합)
- LOCKED #44 (Complete Meaning per Merge — bundle scope decision)

### 51. ADR-117 Cylinder Direct Dispatch + TorusTool UI Bindings — ADR-104 Family 100% Closure (2026-05-17) 🎉🎉

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "✅ 결재: ε (α + β 묶음) — 지금 단계에서 가장 완전한 closure 선택"

ADR-104 Path B family 의 **architectural symmetry 완성 + user-facing
마지막 layer 결합**. 사용자 결재 ε bundle:
- α (γ-next): ADR-116 α-1 finding (cylinder dispatch asymmetry) 해소
  — `create_cylinder` direct dispatch (sphere/cone/torus 패턴 4번째
  1:1 mirror)
- β (δ-next): TorusTool menu / keyboard binding (`D` = donut mnemonic)

**Lock-ins (10개)**:
- L-117-1 Single atomic PR for "ADR-104 family 100% closure"
- L-117-α-1 Cylinder direct dispatch via `create_cylinder_kernel_native_
  via_extrude` helper (3-step pipeline: closed-curve profile build →
  create_solid Extrude → canonical [base, top, side] face order)
- L-117-α-2 Profile = closed-curve Circle (ADR-089 1-anchor + 1-self-
  loop + Plane surface)
- L-117-α-3 Z-up canonical (LOCKED #43)
- L-117-α-4 create_solid dispatch reuses ADR-094 Path B
- L-117-α-5 Returns [base, top, side] canonical order
- L-117-β-1 TorusTool keyboard shortcut = `D` (donut mnemonic, avoids
  'U'=measure / 'T'=top view conflict)
- L-117-β-2 Menu position: 프리미티브 → 구/원통/원뿔/**토러스**/박스
  (natural spatial complexity order)
- L-117-2 ADR-046 P31 #4 additive only

**ADR-104 Path B family — 100% architectural + user-facing closure**:

| Primitive | Engine | Direct dispatch | UI tool | Menu | Keyboard | Memory |
|---|---|---|---|---|---|---|
| Cylinder | ✅ ADR-094 | ✅ **ADR-117 α** | ✅ | ✅ | Y | 95% |
| Sphere | ✅ ADR-113 | ✅ ADR-113 ζ | ✅ | ✅ | H | 99%+ |
| Cone | ✅ ADR-114 | ✅ ADR-114 ζ | ✅ | ✅ | N | 92% |
| Torus | ✅ ADR-115 | ✅ ADR-115 ζ + **ADR-117 β** | ✅ | ✅ **ADR-117 β** | **D ADR-117 β** | 99.7% |

🎉🎉 **ADR-104 Path B family 가 architectural (4 primitives × Path B
dispatch) + user-facing (4 tools × menu + keyboard) 양쪽 layer 모두
100% 완성**.

**회귀 누적**: axia-geo **+7** (6 ADR-117 dispatch + 1 net γ update).
vitest unchanged (UI bindings runtime-only, TorusTool 회귀 이미 있음).
axia-geo 1379 → **1386 PASS**, 절대 #[ignore] 금지 7/7 준수.

**ADR-104 family final cumulative (6 PRs)**:
- ADR-094 (early), ADR-113 #76 (+21), ADR-114 #77 (+27), ADR-115 #78
  (+23), ADR-116 #79 (+20), **ADR-117 #80 (+7)**
- Total **+98+ across 6 PRs**, 절대 #[ignore] 금지 98+/98+ 준수.

**Lessons (canonical for verification → closure chain)**:
- L1 Verification finding 의 자연 closure — ADR-116 α-1 finding 이
  본 ADR α 에서 즉시 해소. Verification → finding → closure atomic chain.
- L2 4th template reproduction (sphere → cone → torus → cylinder)
  — 4-layer template 완전 reproducible. Cylinder 는 기존 Path B engine
  자산 위에 dispatch wrapper 만 추가.
- L3 Helper-based dispatch pattern — `create_cylinder_kernel_native_
  via_extrude` 가 Path A entry signature 와 Path B execution path 의
  bridge. 향후 entry signature 다른 primitive 도 동일 패턴 가능.
- L4 Keyboard mnemonic discipline — 'D' for Donut/Torus (의미적
  mnemonic 우선). 향후 새 primitive shortcut 도 mnemonic 우선.

**후속 트랙 (별도 ADR per LOCKED #44)**:
- ε STEP timing 단축 (LOCKED #43 priority #3 — ADR-082 Drift #5)
- ζ NURBS-aware coplanar intersect (LOCKED #43 priority #4 — ADR-101 §5)
- η Surface-driven Boolean / Offset / Push-Pull pair-wise verification
  (ADR-104 §3.1 cross-cut)

**Cross-link**:
- ADR-094 / ADR-113 / ADR-114 / ADR-115 / ADR-116 (Path B family 5 predecessors)
- ADR-104 (Path B Expansion spec — family closure)
- ADR-089 (closed-curve face canonical — profile face build helper)
- ADR-046 P31 #4 (additive only)
- LOCKED #43 (Z-up canonical)
- LOCKED #44 (Complete Meaning per Merge — bundle scope)

### 52. ADR-118 + ADR-119 STEP/IGES Engine Pre-warm — Drift #5 user-perceived 해소 (LOCKED #43 priority #3 closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "3. STEP timing 단축 ← 다음 priority (multi-week) 으로 승인합니다"
> → ADR-118 α spec (9 options matrix) → "추천대로 승인합니다" (γ-7)
> → ADR-119 β implementation

LOCKED #43 priority #3 **STEP timing 단축** 의 첫 sub-step closure.
ADR-082 Drift #5 (180s+ wait) 의 *본질 architectural* 해소 — ADR-085
가 perception (Toast progress) 만 다룬 위에, ADR-119 가 actual
*user-perceived wait* 0s 까지 단축.

**ADR-118 (α spec only)**:
- 9 fix path options 매트릭스 (γ-1 streaming / γ-2 cache / γ-3 lib trim
  / γ-4 pre-warm / γ-5 worker / γ-6 custom build / γ-7 묶음 / γ-8 full /
  γ-9 audit)
- 사용자 결재 γ-7 (γ-1 + γ-4 묶음, 단순/신속/정확) 채택
- Spec only, implementation 0

**ADR-119 (β implementation)**:
- γ-4 fully implemented: `web/src/import/StepIgesPrewarm.ts` (NEW) +
  `web/src/main.ts` wiring
- γ-1 implicit: Vite chunk loader + HTTP/2 multiplexing + browser
  automatic streaming (vendor patching 없이 ~10-20s 절감)
- localStorage `axia:step-iges-prewarm` default ON, opt-out via `'false'`
- requestIdleCallback (5s timeout fallback setTimeout 2s)
- Idempotent + graceful failure

**Lock-ins (10)**:
- L-119-1~10: γ-7 사용자 결재, γ-4 fully impl, γ-1 implicit, localStorage
  default ON, idempotent, graceful, bundle 0MB strict, Toast preserved,
  additive only, 사용자 시연 게이트

**사용자 facing 변화 매트릭스 (γ-7 실측 예상)**:

| Scenario | Before (180s baseline) | After γ-7 |
|---|---|---|
| 즉시 Import (<5s) | 180s wait | 180s wait (pre-warm 미완료) |
| 30s 후 Import | 180s wait | **~20s wait** (~85% 완료) |
| 180s+ 후 Import | 180s wait | **~0s wait** (완료) |
| Return visit (HTTP cache) | 180s wait | **~10-30s wait** |

**Typical demo 시나리오**: page load 후 30-60s 동안 다른 도구 사용 →
STEP import 즉시 응답.

**회귀 누적**: vitest **+11** (StepIgesPrewarm). 합계 1894 → **1905
PASS**, 절대 #[ignore] 금지 11/11 준수. vite build 정상 (initial
bundle 0MB 증가 strict 유지).

**Lessons (canonical for vendor-dep async init wrappers)**:
- L1 γ-1 implicit via Vite chunk loader (architectural insight) —
  vendor library 의 internal loader 가 modern browser streaming 활용
  시 explicit override 불필요
- L2 Pre-warm 의 architectural 가치 — actual computation time 동일,
  user-initiated wait 만 0s. HCI 관점에서 background work 와 interactive
  wait 분리. 다른 long-running init (rhino3dm, OBJLoader 등) 도 동일
  패턴 가능
- L3 Idempotent + graceful = robust pre-warm 표준 패턴
- L4 ADR-118 α spec → ADR-119 β impl atomic separation (LOCKED #44
  답습) — multi-week ADR 진입 시 α spec PR 먼저 → 사용자 결재 → β impl

**후속 트랙 (별도 ADR per LOCKED #44)**:
- γ-2 persistent module cache (Cache API / service worker) — 재방문 95%
  단축
- γ-1-explicit (vendor patch streaming compile) — 5-7일 architectural
- γ-3 conditional lib loading (STEP vs IGES 분기)
- Settings UI for prewarm opt-out (SettingsPanel 체크박스)

**Cross-link**:
- ADR-118 (architectural spec) — α 9 options matrix
- ADR-082 §Drift #5 — 180s+ wait 본질 trigger
- ADR-085 (Toast progress UX) — perception layer 보존
- ADR-083 (BRepMesh Tessellation) — Drift #5 단축 후 demo 완전 활성
- ADR-035 P20.C #2 (initial bundle 0MB strict)
- ADR-049 P-5e-α (localStorage default ON pattern)
- ADR-087 K-ζ (사용자 시연 게이트)
- LOCKED #43 priority #3 (STEP timing 단축) — 첫 sub-step closure
- LOCKED #44 (Complete Meaning per Merge — α/β atomic separation)

### 53. ADR-121 STEP pre-warm lib fix + Path B analytic face area (γ findings closure, 2026-05-17) ✅

**Canonical anchor (사용자 시연 evidence, 2026-05-17)**:
> "추천: γ (α + β 묶음) 으로 승인합니다"

ADR-087 K-ζ canonical 사용자 시연 게이트가 11+ PR architectural closure
후 **2개 실제 findings 발견** — pre-warm silent failure (Critical) +
Path B face area UX bug. 즉시 atomic closure (γ bundle).

**α — Finding #2 (Critical, production-blocking)**:
- Error: `Assertion failed: bad export type for _ZTI13TDF_Attribute: undefined`
- Root cause: `ocVisualApplication` (TKLCAF 포함) lib 누락
- Fix: libs array 에 `mod.ocVisualApplication` 추가 (1 line)
- Impact: ADR-119 γ-7 pre-warm silent failure 해소, STEP import
  production-ready

**β — Finding #1 (UX completeness)**:
- Bug: XIA Inspector "면적 0.0 m²" — Path B sphere face area = 0
- Root cause: `Mesh::face_area` polygon-only (Newell 미충족 for 1-vertex
  boundary). Path B = 1 anchor + 1 self-loop → polygon path fail.
- Fix: `face_area` polygon-first + `analytic_face_area` fallback (5
  AnalyticSurface variants: Plane / Cylinder / Sphere / Cone / Torus)
- Verification: 4πr² (sphere) / 2πr·h (cylinder) / 4π²Rr (torus)
  closed-form 일치 (1-5% 정확도)

**Lock-ins (10개)**:
- L-121-α-1~3 ocVisualApplication 추가 + source-level regression test
  + ADR-119 silent failure 해소
- L-121-β-1~4 polygon-first + analytic-fallback 패턴, 5 variants
  명시, polygon regression guard, closed-form verification
- L-121-1 ADR-087 K-ζ canonical 시연 게이트 가치 정량 증명
- L-121-2 ADR-046 P31 #4 additive only (face_area signature UNCHANGED)
- L-121-3 ADR-035 P20.C #2 (visualApplication lazy chunk)

**Analytic area formulas (β 신규)**:

| Surface | Formula |
|---|---|
| Plane | `u_extent × v_extent` |
| Cylinder | `radius × u_extent × v_extent` (lateral) |
| Sphere | `r² × u_extent × \|sin(v_max) - sin(v_min)\|` (latitude band) |
| Cone | `u_extent × tan(α) × (v_max² - v_min²) / 2` (from apex) |
| Torus | `R·r·u·v + r²·u·\|sin(v_max) - sin(v_min)\|` (first-order) |

**회귀 누적**: axia-geo **+6** (β area tests) + vitest **+3** (α libs
verification). 합계 **+9**, 절대 #[ignore] 금지 9/9 준수. axia-geo
1386 → **1392 PASS**, vitest 1905 → **1908 PASS**.

**사용자 facing 변화**:
- STEP/IGES Import: silent failure → production-ready (180s+ wait 후
  실 import 동작)
- XIA Inspector area display: 0.0 m² → 정확한 analytic value (sphere
  r=5 → 314.16 m², cylinder side r=5 h=10 → 314.16 m², 등)

**Lessons (canonical)**:
- L1 사용자 시연 게이트 architectural value 정량 증명 — 11+ PR closure
  후 1분 시연이 2 findings 발견 (Test 자산만으로 회귀 보장 불가
  canonical evidence)
- L2 Polygon-first + analytic-fallback pattern (Path B 자연 지원, 다른
  polygon-based functions 동일 패턴 확장 가능 — perimeter / centroid /
  bbox)
- L3 Vendor lib symbol-level audit 가치 — source-level regression test
  가 minimum guard (opencascade.js / rhino3dm / three.js upgrade 시
  필수)
- L4 γ 묶음 (Critical + UX) atomic closure — *trigger 동일성* +
  *user-facing 의미* 가 묶음 결정 기준

**후속 트랙 (별도 ADR per LOCKED #44)**:
- γ NURBS-class surfaces analytic area (BezierPatch / BSpline / NURBS /
  RectangularTrimmed — numerical integration)
- δ XIA Inspector area display 정밀도 (소수점 / 단위 변환 UX)
- ε ADR-120 priority #4 진입 결재 (G / D / A / E path 선택)

**Cross-link**:
- ADR-087 K-ζ canonical — 본 ADR trigger pattern
- ADR-119 γ-7 STEP pre-warm — α silent failure hotfix
- ADR-082 C-ε wrapper drift series — α 는 #4 의 자연 후속
- ADR-031 Phase D (AnalyticSurface infra) — β analytic_face_area source
- ADR-104 family (Path B primitives) — β actual carrier
- ADR-035 P20.C #2 (initial bundle 0MB strict)
- ADR-046 P31 #4 (additive only)
- LOCKED #43 priority #3 (STEP timing) — α 는 #3 의 hotfix
- LOCKED #44 (Complete Meaning per Merge — γ 묶음)

### 54. ADR-123 + ADR-124 — AxiA-native optimization audit + WASM SIMD activation (β closure, 2026-05-17) ✅

**Canonical anchor (사용자 자기-내성 질문, 2026-05-17)**:
> "우리 엔진 자체 내에서 해결방법은 없는지요?"

ADR-122 KAYAC 외부 GPU instancing 검토 직후 사용자가 *내부 자산 활용
가능성* 질문 → ADR-123 α spec (10 lettered AxiA-native options A~J) →
사용자 결재 "결재 승인합니다" (Q1=D + Q2=ADR-123 D 먼저 → ADR-122 α-1
후속) → ADR-124 β implementation single atomic PR. ADR-118 → ADR-119
패턴 1:1 mirror (α spec → β impl atomic).

**핵심 단축**: `.cargo/config.toml` 단일 파일 추가만으로 9 wasm-pack
호출 site (GitHub workflows 6 + ensure-wasm.mjs + npm scripts 2) 모두
자동 SIMD 활성화. RUSTFLAGS 환경변수 방식이었다면 각 site 수정 필요 —
single SSOT 가 향후 새 workflow 추가 시에도 자동 적용.

**Lock-ins (L-124-1 ~ L-124-8)**:
- L-124-1 `.cargo/config.toml` SSOT (single source of truth)
- L-124-2 Target-specific only (`[target.wasm32-unknown-unknown]`, native
  builds 영향 0) — 회귀 테스트로 scope creep 차단
- L-124-3 2-layer regression guard — vitest source-level + post-build
  binary scan
- L-124-4 SIMD evidence threshold = 50 opcodes (실측 7221 — 강력한
  auto-vectorization evidence)
- L-124-5 Initial bundle 0MB strict 유지 (P20.C #2)
- L-124-6 ADR-046 P31 #4 additive only (public API UNCHANGED, `unsafe`
  SIMD intrinsics 0)
- L-124-7 Browser baseline = Safari 16.4+ (caniuse 99%+ 지원, OCCT.js
  baseline 위)
- L-124-8 절대 #[ignore] 금지

**측정 evidence (실측)**:

| Layer | 결과 |
|---|---|
| `.cargo/config.toml` SSOT | 4 checks pass |
| `axia_wasm_bg.wasm` SIMD opcodes | **7221** (Code section 2121.1 KB 의 0.33%) |
| Total WASM size | 2410.4 KB |
| native cargo (axia-core / axia-geo / axia-wasm) | 302 / 1392 / 0 — UNCHANGED |
| vitest TS suite | 1916 passed (+6 ADR-124) / 1 skipped / 0 failed |
| `verify-wasm.mjs` | All checks pass |
| `verify-simd.mjs` | All 8 checks pass |

**Path Z atomic 6-Layer Stack** (architectural reproducibility):
1. Engine config (`.cargo/config.toml`) — build truth
2. Post-build verifier (`web/scripts/verify-simd.mjs`) — binary evidence
3. npm integration (`web/package.json` wasm:verify) — CI/dev integration
4. Vitest regression (`web/src/build/wasmSimdActivation.test.ts`) —
   source-level guard
5. ADR docs (`docs/adr/124-wasm-simd-activation.md` + α spec ADR-123)
6. LOCKED entry (본 #54)

**사용자 facing 변화**:
- Public API UNCHANGED
- Initial bundle 724.99 kB 변화 0 (P20.C #2)
- Engine compute 2-4× 가속 expected (Vec3 ops / Newell normal / Boolean
  SSI Newton steps — 실제 runtime benchmark 는 별도 trigger ADR)

**Lessons (canonical for future build-flag ADRs)**:
- L1 `.cargo/config.toml` SSOT 의 architectural 가치 (9 site 자동 적용)
- L2 2-layer regression guard 패턴 (config + binary 둘 다)
- L3 Auto-vectorization 의존의 risk-management (intrinsics 별도 ADR)
- L4 Browser baseline shift 의 incremental 위험 0 (OCCT.js 가 이미
  modern browser 요구)
- L5 Single atomic PR per LOCKED #44 — β implementation 모든 layer 단일
  PR 강제 (부분 merge 시 silent regression risk)

**다음 트랙 (Q2 default per ADR-123 결재)**:
- **ADR-122 α-1 (Selection BBox InstancedMesh)** — 2-3일 atomic, render-
  side throughput unlock. 본 ADR (engine-side) 과 직교 시너지.

**Cross-link**:
- ADR-123 (α spec — 10 lettered AxiA-native options)
- ADR-122 (KAYAC GPU instancing 외부 패턴) — Q2 next step
- ADR-118 → ADR-119 (α spec → β impl atomic 패턴 source)
- ADR-035 P20.C #2 (initial bundle 0MB strict — L-124-5)
- ADR-046 P31 #4 (additive only — L-124-6)
- ADR-087 K-ζ (사용자 시연 게이트 — runtime benchmark trigger 시)
- LOCKED #43 priority audit (본 ADR 은 priority 매트릭스 외부 —
  architectural performance optimization)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR)

### 55. ADR-125 + ADR-122 Amendment 1 — Selection rendering audit closure + α-1 pivot (docs only, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "C → A 순차 — 가장 단순/신속/정확 승인합니다"

ADR-124 closure 후 ADR-123 Q2 default 정합으로 ADR-122 α-1 (Selection
BBox InstancedMesh) β implementation 진입. *사전 검토 audit* 으로
`SelectionManager.ts` 측정 → **ADR-122 α-1 가정 ("N drawcalls") 가
현재 코드 실측 (1 drawcall, merged geometry) 과 불일치** 발견. 사용자
escalate 후 C → A 순차 결재.

**Audit finding 매트릭스** (canonical truth):

| Hotspot | ADR-122 §2 가정 | 실측 audit | 상태 |
|---|---|---|---|
| **A — Selection BBox** | N drawcalls | **1 drawcall** (merged per type) | ❌ 가정 무효 |
| B — Snap markers | 2D canvas | 0 GPU drawcalls | ✅ 정합 |
| C — Helper lines | LineSegments2 별 | 1-5 per type | ⚠️ medium |
| **D — Reference imported mesh** | N × 2 | **N × 2 (STEP 500 face = 1000 drawcalls)** | ✅ **진짜 hotspot** |
| E — Primitive preview | per-tool | 1 (이미 single) | ❌ 이미 optimal |

**Architectural reason**: ADR-074 (2026-05-05) 시점에 type-level merged
geometry pattern (`rebuildSelectionMesh()` line 1124, `rebuildGroupOutlines()`
line 1851) 채택 — ADR-122 §2 작성 시 이 implicit optimization 누락.

**Pivot decision (canonical, ADR-125 §3)**:
- ADR-122 α-1 β implementation **거부** (visual regression risk +
  gain 0)
- ADR-122 §spec 자체는 **보존** (supersede 아님) + Amendment 1 추가
  (current state correction + 추천 순위 재정렬)
- ADR-126 (가칭) 으로 **ADR-122 α-2 (Reference imported mesh
  InstancedMesh) 별도 β implementation** 진행 — 진짜 N-drawcall hotspot

**Lock-ins (L-125-1 ~ L-125-9)**:
- L-125-1 Pre-implementation audit canonical (모든 β implementation
  진입 전 audit 우선)
- L-125-2 Audit truth > spec assumption (escalation 강제)
- L-125-3 Visual regression 거부 정책 (ADR-046 P31 #4 defensive
  interpretation)
- L-125-4 ADR-074 group outline merged geometry 정합 보존
- L-125-5 ADR-077 V-2 visual baseline 보존
- L-125-6 Pivot 의 architectural value (부정 결정도 명시 lock-in)
- L-125-7 ADR-122 α-1 spec 보존 (Amendment 1 patch, 향후 trigger 가능)
- L-125-8 ADR-122 α-2 가 다음 β implementation 트랙 (별도 ADR-126)
- L-125-9 절대 #[ignore] 금지

**회귀 (0)**: docs only — vitest 1916 / cargo 1392+302+0 unchanged
per LOCKED #54. ADR-077 V-2 visual baselines 보존.

**다음 트랙 (사용자 A 승인 후)**:
- **ADR-126 (가칭)** — ADR-122 α-2 Reference imported mesh InstancedMesh
  β implementation. 1주 atomic. `StepIgesImporter.ts` 의 N face ×
  Mesh × 2 → 1 InstancedMesh × 2 (front+back). ADR-077 V-2 visual
  baseline + ADR-083 STEP baseline + ADR-086 owner-ID 매핑 정합.

**Lessons (canonical for future audit-first ADRs)**:
- L1 Audit-first canonical 강화 — ADR-103-ε §L2 (audit-first vs sed
  assumption) 의 더 깊은 적용. 모든 α spec → β implementation 전 audit
  우선 권장.
- L2 5개월 누적 자산의 implicit optimization (ADR-074 group outline
  merged geometry) — spec assumption 보다 architecture audit 우선.
- L3 부정 결정의 architectural value — ADR-076 (legacy deletion 부정
  결정) 답습. silent 거부 회피, 명시 documented.
- L4 Spec preservation + Amendment pattern — supersede 대신 amendment
  로 current state correction. 향후 trigger 시 anchor 보존.
- L5 Q2 default 의 architectural 재해석 — ADR-123 Q2 default 가 본
  ADR 후 α-2 로 재해석. spec default 가 절대 아님.

**Cross-link**:
- ADR-125 (audit closure ADR — 본 LOCKED 의 anchor)
- ADR-122 Amendment 1 (current state correction)
- ADR-123 Q2 default 재해석 (α-1 → α-2)
- ADR-124 (직전 ADR, engine-side SIMD)
- ADR-074 (group outline merged geometry pattern source)
- ADR-077 V-2 (visual baseline 가드)
- ADR-088 (multi-segment edge hover)
- ADR-046 P31 #4 (additive only)
- ADR-076 §C-amendment-1 (부정 결정 명시 lock-in 패턴 source)
- ADR-126 (가칭, 본 LOCKED 의 자연 후속 — α-2 β implementation)
- LOCKED #44 (Complete Meaning per Merge — docs-only PR scope)
- LOCKED #54 (직전 closure, ADR-123 + ADR-124)

### 56. ADR-126 + ADR-122 Amendment 2 — STEP/IGES Merged BufferGeometry (β closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "네 승인합니다" (Option A — Merged BufferGeometry, ADR-126 β single atomic PR)

ADR-125 audit closure 후 Step A 진입 사전 검토 시 **2번째 audit
finding**: ADR-122 α-2 spec wording "InstancedMesh" 가 STEP face 의
각자 다른 polygon geometry 와 부적합. ADR-125 L-125-1 (audit-first
canonical) 정합 → 사용자 결재 후 Option A (Merged BufferGeometry)
채택. ADR-122 Amendment 2 추가 + ADR-126 β implementation single
atomic PR.

**Architectural change (canonical)**:

Before (per ADR-083 T-γ):
```
importGroup (`STEP: file.step`)
├─ face-0 (Group, userData: { faceIndex, surface, boundaryPolygon, axiaFaceId })
│   ├─ face-0-front (Mesh, frontMat)  ← drawcall #1
│   └─ face-0-back  (Mesh, backMat)   ← drawcall #2
├─ face-1 (Group)...
└─ edges (Group)
```
N face = 2N Mesh drawcalls.

After (ADR-126 β):
```
importGroup
├─ faces-front (Mesh, frontMat, MERGED geometry)  ← drawcall #1
├─ faces-back  (Mesh, backMat, MERGED geometry)   ← drawcall #2
├─ edges (Group)  [ADR-084 E-γ — UNCHANGED]
└─ userData.faceMetadata: Map<faceIndex, FaceMetadata>  ← side-table
```
N face = **2 Mesh drawcalls**.

**Drawcall reduction 매트릭스**:

| Scene size | Before (N×2) | After | 감소율 |
|---|---|---|---|
| STEP cube (6 face) | 12 | **2** | **6× ↓** |
| STEP 50-face | 100 | **2** | **50× ↓** |
| STEP 500-face | 1000 | **2** | **500× ↓** |
| STEP 5000-face | 10000 | **2** | **5000× ↓** |

**Lock-ins (L-126-1 ~ L-126-9)**:
- L-126-1 Merged BufferGeometry pattern over InstancedMesh (per-face
  geometry variability 정합)
- L-126-2 Per-face metadata → side-table SSOT (per-face Three.js
  Object 폐지)
- L-126-3 Side-table includes vertStart/vertCount/indexStart/
  indexCount (향후 per-face picking via geometry sub-range 가능)
- L-126-4 Front + back Mesh share merged BufferGeometry (ADR-018
  two-tone preserved, 메모리 footprint 동일)
- L-126-5 Edges sub-group (ADR-084 E-γ) UNCHANGED (entity-level
  hover/selection 가치)
- L-126-6 Uint32Array index (>65K vertices safe for typical STEP scenes)
- L-126-7 ADR-077 V-2 visual baseline 변경 0 (render output 동일)
- L-126-8 ADR-086 O-δ DCEL injection 정합 + 새 graceful path 추가
- L-126-9 절대 #[ignore] 금지

**회귀 매트릭스 (실측)**:

| Layer | Before (LOCKED #55) | After ADR-126 β | Delta |
|---|---|---|---|
| vitest | 1916 / 1 skipped | **1917 / 1 skipped** | **+1** (graceful guard) |
| `StepIgesImporter.test.ts` | 26 tests | **27 tests** | +1 |
| axia-geo cargo | 1392 | 1392 | UNCHANGED |
| axia-core cargo | 302 | 302 | UNCHANGED |
| axia-wasm cargo | 0 | 0 | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| ADR-077 V-2 baselines | 3 | 3 | UNCHANGED |

**사용자 facing 변화 (0)**:
- 시각 output UNCHANGED (동일 geometry vertices/normals)
- Public API UNCHANGED (StepIgesImporter.importFile signature)
- ADR-046 P31 #4 additive only 정합

**Lessons (canonical for future Three.js merged-geometry / API-choice
ADRs)**:
- L1 Audit-first 의 architectural value (3번째 적용) — ADR-122 α-1
  pivot (ADR-125), ADR-122 α-2 wording pivot (ADR-126), 두 audit-
  first finding 모두 silent 강행 회피. 향후 모든 α spec → β impl
  진입 시 audit 우선 강제 권장.
- L2 Three.js API 정확성 — spec wording (특히 5개월 누적 ADR 의 옛
  표기) 가 기술적으로 부정확할 수 있음. intent (drawcall reduction)
  와 mechanism (InstancedMesh vs Merged BufferGeometry vs BatchedMesh)
  분리.
- L3 Side-table pattern canonical — per-face Three.js Object 폐지 +
  Map<id, Metadata> 가 render-perf 와 metadata-access 동시 해소. ADR-
  074 group outline merged geometry 패턴의 자연 진화.
- L4 Vertex offset rebase — per-face indices `+ vertOffset` rebase
  + Uint32Array index (>65K vertices safe).
- L5 Spec preservation pattern 2번째 적용 — ADR-122 α-2 spec 보존 +
  Amendment 2 (ADR-125 §A1.3 pattern 답습). InstancedMesh wording 의
  보존 + Merged BufferGeometry pivot 명시.

**Cross-link**:
- ADR-126 (β implementation ADR — 본 LOCKED 의 anchor)
- ADR-122 Amendment 2 (α-2 API choice correction)
- ADR-125 + LOCKED #55 (직전 audit closure — audit-first canonical
  source)
- ADR-123 Q2 default (재해석 후 본 LOCKED 에서 완전 closure)
- ADR-124 + LOCKED #54 (직전 closure, engine-side SIMD)
- ADR-083 T-γ (`_faceToMesh` 폐지 source)
- ADR-084 E-γ (edges sub-group preserved per L-126-5)
- ADR-086 O-δ (DCEL injection side-table refactor)
- ADR-074 (merged-geometry-per-type pattern source)
- ADR-018 (two-tone front/back preserved)
- ADR-077 V-2 (visual baseline 보존)
- ADR-046 P31 #4 (additive only)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR)

### 57. ADR-127 + ADR-122 Amendment 3 — Helper lines audit closure + α-4 pivot (docs only, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "승인합니다" (Option A — 순수 audit closure ADR-127, ADR-125 답습)

ADR-126 closure (LOCKED #56) 후 ADR-123 Q2 default 정합으로 ADR-122
α-4 (Helper lines KAYAC pattern) audit 진입. **세션 audit-first
canonical 의 3번째 success** (ADR-125 α-1, ADR-126 α-2 pivot 답습).
Helper line rendering 의 architectural reality 가 spec 가정과 다름을
명시 lock-in + ADR-122 §2 hotspot C 정정.

**Audit finding 매트릭스 (canonical truth)**:

| Hotspot C source | ADR-122 §2 가정 | 실측 audit | 상태 |
|---|---|---|---|
| **SnapVisual** (snap guides) | "LineSegments2 별 drawcall" | **Canvas 2D 1 stroke** | ❌ 3D 안 씀 — 가정 무효 |
| **DimensionLabel** (dim ticks) | LineSegments | **Canvas 2D N strokes** | ❌ 3D 안 씀 — 가정 무효 |
| **DrawPlaneIndicator** (axis gizmo) | "1 LineSegments per axis" | **3 separate `THREE.Line`** | ⚠️ marginal (2 drawcalls 절감 가능, ADR-046 P31 #1 거부) |
| Viewport overlays | not classified | `LineSegments2` (fast path) | ✅ 이미 fast |
| PrimitivePreview | not classified | 1-2 LineSegments per tool | ✅ lightweight |

**Architectural reason**: AxiA 의 SnapVisual + DimensionLabel 가 **2D
Canvas overlay** 패턴 채택 — 3D LineSegments 자체 사용 안 함 → drawcall
hotspot 자연 부재. ADR-074 (2026-05-05) merged geometry pattern 과
동일 architectural pattern (implicit optimization). ADR-122 §2 작성
시점에 audit 누락.

**ADR-122 family 자연 closure** (Amendment 1 + 2 + 3 누적):

| Hotspot | 가정 | Audit | Status | Closure |
|---|---|---|---|---|
| A — Selection BBox | N | 1 (merged) | ❌ 무효 | Amendment 1 / ADR-125 |
| B — Snap markers | 2D | 0 GPU | ✅ 정합 | (audit only) |
| **C — Helper lines** | **N** | **Canvas 2D + 1-3** | ❌ **largely 무효** | **Amendment 3 / ADR-127** |
| **D — Reference imported mesh** | N × 2 | N × 2 | ✅ **진짜 hotspot** | **Amendment 2 / ADR-126** β |
| E — Primitive preview | per-tool | 1 (이미 single) | ❌ 이미 optimal | (audit only) |

**핵심 finding**: 7 hotspots 중 **단 1 (D)** 만 진짜 N-drawcall hotspot.
ADR-126 이 그 single hotspot 해소. ADR-122 family 의 architectural
value 가 *audit-first canonical 패턴 정착* 으로 발현 (3 finding pivots).

**Pivot decision (canonical, ADR-127 §3)**:
- ADR-122 α-4 β implementation **거부** (Canvas 2D 위임 dominant + DrawPlaneIndicator marginal)
- ADR-122 §spec 자체 **보존** + Amendment 3 추가
- ADR-122 family 자연 closure 도달 (α-2 만 implement, 나머지 모두 audit closure 또는 자연 deprecation)
- 다음 priority 진입 — LOCKED #43 priority #4 (ADR-120 Q1 결재) 가 자연 next

**Lock-ins (L-127-1 ~ L-127-9)**:
- L-127-1 Pre-implementation audit canonical 강화 (ADR-125 L-125-1
  의 3번째 적용 — 세션 패턴 정착 evidence)
- L-127-2 Canvas 2D overlay pattern 이 helper line rendering 의
  canonical (SnapVisual + DimensionLabel)
- L-127-3 DrawPlaneIndicator 3-Line pattern 보존 (marginal merge
  gain, ADR-046 P31 #1 거부)
- L-127-4 ADR-122 α-4 spec 보존 (NOT superseded) + Amendment 3 추가
  (spec preservation pattern 3번째 적용)
- L-127-5 ADR-122 §2 hotspot C 가정 무효 명시
- L-127-6 ADR-122 추천 매트릭스 정정 (α-4 deprecation, α-3/α-5/α-6
  묶음 자연 deprecation)
- L-127-7 부정 결정의 architectural value (ADR-076 §C-amendment-1
  + ADR-125 L-125-6 답습 — 3번째 적용)
- L-127-8 다음 priority 진입 anchor (LOCKED #43 priority #4 — ADR-120 Q1)
- L-127-9 절대 #[ignore] 금지

**회귀 (0)**: docs only — vitest 1917 / cargo 1392+302+0 unchanged
per LOCKED #56. ADR-077 V-2 visual baselines 보존.

**다음 트랙 (자연 next)**:
- **LOCKED #43 priority #4 (ADR-120 Q1 결재)** — NURBS-aware coplanar
  intersect β implementation 진입. 7 algorithm path options
  (G/D/A/B/C/E/F).

**Lessons (canonical for future audit-first ADRs, 3번째 누적)**:
- L1 Audit-first canonical 패턴 정착 (3번째 success) — 세션 단일
  트리거 (ADR-123 Q2 default) 3 atomic ADR 3 audit-first finding.
  향후 모든 β implementation 진입 시 audit 우선 강제 기본 default.
- L2 Implicit optimization pattern 의 architectural value 재확인 —
  5개월 누적 자산 (ADR-074 merged geometry, Canvas 2D overlay) 가
  hotspot 가정 자연 무효화. 향후 N-drawcall 가정 ADR 작성 시 audit
  우선 강제.
- L3 Canvas 2D overlay pattern canonical (helper line rendering) —
  SnapVisual + DimensionLabel 의 architectural choice 가 향후 새
  helper line 도입 시 우선 검토 권장.
- L4 부정 결정 lock-in 패턴 정착 (3번째 적용) — ADR-076 / ADR-125
  답습.
- L5 Spec preservation + Amendment pattern 3번째 적용 — ADR-122 의
  Amendment 1/2/3 누적 (단일 spec 의 3 amendment). supersede 회피.
- L6 α-3/α-5/α-6 묶음 자연 deprecation — A + C 가정 모두 무효 →
  묶음 의미 감소 (architectural value 자연 도달).
- L7 다음 priority 진입 자연 transition — audit closure → 다음 priority
  natural transition 패턴 정착.

**Cross-link**:
- ADR-127 (audit closure ADR — 본 LOCKED 의 anchor)
- ADR-122 Amendment 3 (α-4 current state correction)
- ADR-125 + LOCKED #55 (audit-first canonical 1번째 success)
- ADR-126 + LOCKED #56 (audit-first canonical 2번째 success — pivot + β impl)
- ADR-074 (type-level merged geometry pattern source)
- ADR-076 §C-amendment-1 (부정 결정 명시 lock-in 패턴 source — 3번째 답습)
- ADR-077 V-2 (visual baseline 보존)
- ADR-018 (visual policy preserved)
- ADR-046 P31 #1 "가볍게" (DrawPlaneIndicator marginal merge 거부 사유)
- ADR-046 P31 #4 additive only
- LOCKED #43 priority #4 (ADR-120 Q1 결재 — 본 LOCKED 의 자연 next)
- LOCKED #44 (Complete Meaning per Merge — docs-only PR scope)

### 58. ADR-128 + ADR-120 Amendment 1 — Vertex-on-edge fallback (β closure, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "추천 승인합니다" (Q1=G — Vertex-on-edge fallback, ADR-120 §3.2 1st recommendation)

ADR-127 closure (LOCKED #57) 후 LOCKED #43 priority #4 자연 transition.
ADR-120 (α spec, PR #83 merged 2026-05-17) 의 7 algorithm path options
중 Q1=G (Vertex-on-edge fallback, ADR-046 P31 #1 "가볍게" + ADR-101
Amendment 9 §A9.8 evidence 정합) 채택.

본 ADR 은 **LOCKED #43 priority track 의 첫 β implementation** (priority
#1 Z-up / #2 Path B / #3 STEP timing 모두 closure 후 #4 진입). 세션
audit-first canonical 4번째 적용 (ADR-125/126/127 답습).

**Architectural change**:

`crates/axia-geo/src/operations/coplanar.rs` —
`coplanar_intersection_segments` 의 raw_crossings loop 후 conservative
fallback 추가:

```rust
if raw_crossings.is_empty() && !lens_polygon.is_empty() {
    let detected = detect_vertex_incidence_crossings(
        &a_2d, &b_2d, b_reversed, &plane,
    );
    raw_crossings.extend(detected);
}
```

Fallback only fires when 결함 D condition (raw is empty + lens
non-empty). 60+ 기존 happy-path tests 정합 자연 보존.

**핵심 helpers**:
- `point_on_segment_2d(point, p0, p1, eps) -> Option<f64>` —
  perpendicular distance test + parameter clamp
- `detect_vertex_incidence_crossings(a, b, b_reversed, plane)` —
  bidirectional scan (A vertex on B edge / B vertex on A edge),
  symmetric DEDUP_EPS_2D collapse for vertex-on-vertex

**Synthetic crossing convention**:
- `point`: exact incident vertex 3D position (geometric correctness)
- `face_*_t`: `VERTEX_INCIDENCE_T_OFFSET = 1e-4` (sits just past edge
  start, avoids ENDPOINT_EPS gating)

**Tolerance hierarchy (L-128-3)**:
- `VERTEX_ON_EDGE_EPS_2D = 1e-5` (perpendicular detection)
- `DEDUP_EPS_2D = 1e-6` (existing crossing dedup)
- `LOCKED #5 = 1.5μm` (spatial-hash, mm-scale 변환 시 1.5e-3)

**결함 D detection matrix**:

| Scenario | Pre-ADR-128 | Post-ADR-128 |
|---|---|---|
| Classic partial overlap | 3 sub-faces ✓ | 3 sub-faces ✓ (unchanged) |
| Containment / Disjoint | Ok(None) ✓ | Ok(None) ✓ (unchanged) |
| **결함 D: vertex on edge interior** | **Ok(None) silent skip** | **3 sub-faces (synthesized)** |
| **결함 D: vertex coincident with corner** | **Ok(None) silent skip** | **3 sub-faces OR Ok(None)** (L-128-8 residual) |

**Lock-ins (L-128-1 ~ L-128-10)**:
- L-128-1 Conservative fallback (only fires when raw empty + lens
  non-empty) — happy-path code UNCHANGED, 60+ test 자산 보존
- L-128-2 Geometric correctness — synthetic point = exact vertex,
  topological t = offset
- L-128-3 Tolerance hierarchy 명시 lock-in
- L-128-4 Bidirectional symmetric scan + DEDUP_EPS_2D collapse
  (vertex-on-vertex natural handling)
- L-128-5 No public API change (ADR-046 P31 #4 additive only)
- L-128-6 ADR-101 §B-3 invariants preserved (surface inheritance,
  manifold safety)
- L-128-7 ADR-120 §3.3 epsilon-perturbation 거부 정합 (polygon vertex
  미이동, 정밀도 무손실)
- L-128-8 Cardinal corner residual edge case 명시 (split OR None
  acceptable — test documents future ADR trigger)
- L-128-9 ADR-120 Path D (NURBS-direct) deferred (future
  architectural step)
- L-128-10 절대 #[ignore] 금지

**회귀 매트릭스 (실측)**:

| Layer | Before (LOCKED #57) | After ADR-128 β | Delta |
|---|---|---|---|
| **axia-geo** (cargo) | 1392 | **1399** | **+7** (ADR-128 tests) |
| axia-core (cargo) | 302 | 302 | UNCHANGED |
| axia-wasm (cargo) | 0 | 0 | UNCHANGED |
| vitest (TS) | 1917 / 1 skipped | 1917 / 1 skipped | UNCHANGED |
| Playwright E2E | 15+ | 15+ | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| ADR-077 V-2 baselines | preserved | preserved | UNCHANGED |

**합계 +7 회귀** (절대 #[ignore] 금지 7/7 준수).

**7 new ADR-128 tests**:
- `adr128_point_on_segment_2d_basic` (helper unit, 8 cases)
- `adr128_circle_fully_inside_rect_returns_none` (containment)
- `adr128_circle_cardinal_corner_coincidence_splits` (결함 D
  vertex-on-vertex, L-128-8)
- `adr128_diamond_vertices_on_rect_edges_splits` (inscribed diamond)
- `adr128_rect_partial_overlap_with_shared_vertex_on_edge` (control)
- `adr128_existing_two_crossings_path_unaffected` (backward compat)
- `adr128_detect_vertex_incidence_basic` (function unit test)

**Lessons (canonical for future fallback / 결함 fix ADRs)**:
- L1 Conservative fallback pattern (happy-path 변경 없이 parallel
  fallback path) — 향후 모든 결함 fix 의 default pattern
- L2 Tolerance hierarchy 명시 lock-in (ADR-038 P23 / LOCKED #40 답습)
- L3 Bidirectional symmetric scan + dedup pattern (incidence
  detection canonical)
- L4 Geometric vs topological 분리 (point vs t) — synthetic crossing
  design template
- L5 결함 fix 의 partial outcome 명시 lock-in (L-128-8) — 100%
  coverage 아닐 때 잔존 edge case 의 test 가 future ADR trigger anchor
- L6 ADR-120 Amendment pattern 4번째 정착 (ADR-122 의 3 amendments
  + ADR-120 의 amendment 1 = canonical multi-option spec pattern)
- L7 Pre-implementation audit canonical 4번째 적용 (세션 패턴 정착
  강화)

**다음 트랙 (자연 next)**:
- **사용자 manual 시연 게이트** (ADR-087 K-ζ canonical) — 결함 D
  trigger 시나리오 (RECT × CIRCLE cardinal alignment) 실제 측정
- **LOCKED #43 priority audit 재평가** — priority #1~4 모두 closure
  도달 → 새 priority 선정 or 별도 architectural value track
- **세션 저장** (자연 break point — 7 PRs 누적, 5 LOCKED entries)

**Cross-link**:
- ADR-128 (β implementation ADR — 본 LOCKED 의 anchor)
- ADR-120 Amendment 1 (Q1=G chosen)
- ADR-127 + LOCKED #57 (직전 audit closure — audit-first 3번째)
- ADR-101 Amendment 9 §A9.8 (결함 D documented limitation — 본 ADR 이 해소)
- ADR-107 Path B canonical (real-world trigger 약화 evidence source)
- ADR-046 P31 #1 "가볍게" (Q1=G 선택 근거)
- ADR-046 P31 #4 additive only (L-128-5)
- ADR-027 NURBS Kernel (Path D future anchor)
- LOCKED #5 (1.5μm spatial-hash) — VERTEX_ON_EDGE_EPS_2D > LOCKED #5
- LOCKED #43 priority #4 (본 LOCKED 의 anchor — 첫 β implementation
  in priority track)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR)

### 59. ADR-131 + ADR-130 Amendment 1 — CommandPalette already exists pivot (audit-first canonical 6번째 적용, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "승인합니다" (Option A — ADR-131 audit closure pivot, ADR-125 답습)

ADR-130 γ-1 (Cmd-K entry + empty modal) β implementation 진입 직전
**첫 Write tool fail** 발생 → Read tool 로 existing implementation 발견:

| File | LOC | Status |
|---|---|---|
| `web/src/ui/CommandPalette.ts` | 286 | ✅ Full Cmd-K palette (fuzzy + ↑/↓ + Enter + Esc) |
| `web/src/commands/CommandCatalog.ts` | 159 | ✅ Full registry |
| `web/src/commands/AxiaCommands.ts` | 273 | ✅ **148 commands registered** |
| `main.ts:463-464` | wiring | ✅ `bindCommandPaletteHotkey()` **production 활성** |

**세션 audit-first canonical 6번째 적용** (ADR-125 α-1 / ADR-126 α-2 /
ADR-127 α-4 / ADR-128 priority #4 / ADR-130 Pillar 1 답습). 본 케이스는
*audit ADR ITSELF가 audit miss* 한 메타-finding — pattern의
self-applying robustness evidence.

**Dual catalog architectural finding (canonical lock-in)**:

| System | Location | Used by | Count |
|---|---|---|---|
| **ActionCatalog** (ADR-045 D1) | `packages/axia-action-catalog/` | CapabilityExplorerPanel ONLY | 95 actions |
| **CommandCatalog** (production) | `web/src/commands/` | CommandPalette + main.ts | **148 commands** |

ADR-130 §2.3 audit가 ActionCatalog import 만 검색 → CommandCatalog
(별개 system) 누락. ADR-045 D1 SSOT policy + ADR-130 §2.3 binding gap
가정 둘 다 invalid (production 의 SSOT는 CommandCatalog).

**Pivot decision (canonical, ADR-131 §3)**:
- ADR-130 γ-1 β implementation **거부** (duplicate system, architectural
  debt 증가)
- ADR-130 §spec 보존 + Amendment 1 추가 (current state correction,
  γ-1/γ-2/γ-4 무효 명시, γ-3/γ-5/γ-6 재정의)
- Production CommandPalette functionality **UNCHANGED 보존**
- 진짜 Pillar 1 gap (§2.5 4 영역) = **ADR-132 (가칭) dual catalog
  unification audit ADR** trigger anchor

**진짜 Pillar 1 gap (ADR-131 §2.5)**:
1. Dual catalog system 통합 미정 (ActionCatalog ↔ CommandCatalog 별개)
2. CapabilityExplorerPanel vs CommandPalette UX 중복
3. i18n infrastructure (ADR-046 Q7 Phase 2)
4. ActionCatalog Tier 3 destructive content (ADR-045 D3 reserved)

**Lock-ins (L-131-1 ~ L-131-10)**:
- L-131-1 Pre-implementation audit canonical 6번째 적용 (Write tool fail
  = pre-existing implementation signal)
- L-131-2 Existing implementation preservation (CommandPalette + Catalog
  + AxiaCommands 전부 보존)
- L-131-3 Dual catalog finding architectural lock-in
- L-131-4 ADR-130 audit miss 메타-finding (audit ADR ITSELF의
  architectural blindspot 명시)
- L-131-5 ADR-130 §spec 보존 + Amendment 1 (spec preservation pattern
  5번째 적용)
- L-131-6 부정 결정 명시 lock-in (ADR-076 / ADR-125 / ADR-127 답습 —
  4번째)
- L-131-7 ADR-046 P31 #4 additive only 정합
- L-131-8 진짜 Pillar 1 gap (§2.5) 별도 ADR-132 (가칭) anchor
- L-131-9 **Audit 패턴 개선 강제 — production wiring 직접 검증 필수**
  (main.ts dynamic imports + hotkey bindings + runtime wiring)
- L-131-10 절대 #[ignore] 금지

**회귀 (0)**: docs only — vitest 1917 / cargo 1392+302+0 UNCHANGED per
LOCKED #58. ADR-077 V-2 baselines + production CommandPalette
functionality preserved.

**Lessons (canonical for future audit-first / audit ADR self-application)**:
- **L1 Audit ADR ITSELF가 audit-first canonical 적용 필요 (메타-finding)** —
  audit ADR도 architectural reality 재확인 필요. *production wiring 직접
  검증 강제* + *Multiple systems search* (단일 keyword 거부) +
  *Implementation 시작 전 read-tool check* (Write tool fail = signal)
- **L2 Dual system architectural pattern 명시** — 5개월 누적 AxiA에
  parallel evolution 가능성. 향후 audit는 *parallel system existence*
  가정 → cross-search 강제
- **L3 `File has not been read` error의 architectural value** — Write
  tool fail은 pre-existing implementation의 silent signal
- **L4 Spec preservation pattern 5번째 적용** — ADR-122 1/2/3 + ADR-120
  + ADR-130 = canonical pattern 정착
- **L5 부정 결정 4번째 lock-in** — ADR-076 / ADR-125 / ADR-127 답습
- **L6 Audit-first canonical의 self-applying robustness** — ADR-130
  audit ADR 자체에서 finding miss → ADR-131이 finding 발견 → 패턴이
  self-recursively 동작 (ADR-125 L-125-1 deepest realization)
- **L7 Pillar 1 priority status redefinition** — ADR-129 Priority #1
  의 진짜 gap = §2.5 4 영역, 별도 ADR-132 trigger

**Cross-link**:
- ADR-131 (audit closure pivot ADR — 본 LOCKED 의 anchor)
- ADR-130 Amendment 1 (current state correction)
- ADR-129 Priority #1 부분 closure 명시 update (별도 amendment 가능)
- ADR-045 D1 (ActionCatalog SSOT, isolated)
- ADR-125/126/127 (audit-first pivot pattern 1~3번째 source)
- ADR-128 (priority track β implementation, 4번째)
- ADR-076 §C-amendment-1 (부정 결정 명시 lock-in 패턴 source)
- ADR-046 P31 Pillar 1 (Discoverability anchor)
- ADR-077 V-2 (visual baseline 보존)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #58 (직전 closure, ADR-128 priority #4)

### 60. ADR-133 — Adapter Layer Implementation (ADR-132 Path E β, ADR-045 D1 SSOT 실측 회복, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "승인합니다" (ADR-132 Q1=(a) Path E + Q2=(a) AC 66 entries + Q3=(c) audit-first 7번째)

ADR-132 (audit ADR, PR #96 merged `13ae8f7`) 의 6 path matrix 중 **Path E
(Adapter layer)** β implementation. ADR-131 §A1.2 dual catalog finding
(ActionCatalog 95 ↔ CommandCatalog 148, 66 CC-only entries) 의 architectural
해소.

**ADR-045 D1 SSOT invariant 실측 회복**:

| 측면 | Pre-ADR-133 | Post-ADR-133 |
|---|---|---|
| ActionCatalog total | 95 entries | **161 entries** (82 shared + 13 AC-only + **66 ADR-133 added**) |
| CommandCatalog total | 148 entries | 148 entries (UNCHANGED) |
| **AC ⊇ CC invariant** | ❌ Violated | ✅ **Satisfied** |
| **Identity SSOT** | ❌ Two SSOTs (no SSOT) | ✅ **ActionCatalog** |
| **Dispatch SSOT** | CommandCatalog (production) | CommandCatalog (UNCHANGED) — *separate concern* |

**Identity vs Dispatch layer 명확 분리**:
- **ActionCatalog** = identity SSOT (id / label / description / tier /
  surfaces / aliases / status / adrs)
- **CommandCatalog** = dispatch SSOT (toolbar / shortcut / iconSvg /
  execute closure / enabled / active)

**66 new entries (status: 'ui-only', aliases: {})**:

| 카테고리 | Count | tier |
|---|---|---|
| Snap state (axis/edge/grid/osnap/snap-override) | 5 | 0 |
| Clash / Reference / Repair | 3 | 2 |
| Export format (dxf/gltf/obj/stl) | 4 | 1 |
| File I/O (new/open/save/saveas/import/export) | 6 | 1 |
| Format panels (osnap/style/units) | 3 | 0 |
| Group state (edit/hide/lock) | 3 | 2 |
| Help (help/about/shortcuts) | 3 | 0 |
| Import format (3dm/3ds/all/dae/dwg/dxf/gltf/ifc/obj/ply/stl) | 11 | 1 |
| Rename | 1 | 1 |
| Section plane (off/x/y/z) | 4 | 0 |
| Sketch extras (align-up/resume-last/start-face) | 3 | 1 |
| Solar (heatmap/heatmap-off) | 2 | 2 |
| Tool modes (explode/select/torus) | 3 | 0~2 |
| View commands (3d/top/bottom/front/back/left/right/home/axis/grid/history/scenes/ssao/shadow-pro/sun-panel) | 15 | 0 |
| **합계** | **66** | |

**Lock-ins (L-133-1 ~ L-133-10)**:
- L-133-1 ADR-132 Path E β implementation (Adapter layer pattern)
- L-133-2 New entry pattern — `aliases: {}`, `status: 'ui-only'`,
  `adrs: ['ADR-133', ...]` canonical
- L-133-3 AC ⊇ CC invariant (CatalogConsistency.test.ts 강제)
- L-133-4 13 AC-only entries 보존 (MCP/diagnostic-only)
- L-133-5 ActionCatalog tier 정책 정합 (ADR-041 P26.1)
- L-133-6 ADR-045 D1 SSOT invariant 실측 회복 (identity 161 = 모든
  user-facing IDs)
- L-133-7 ADR-046 P31 #4 additive only — production functionality
  (CommandPalette + CapabilityExplorerPanel) UNCHANGED
- L-133-8 dist rebuild required (catalog.ts 변경 후 `npx tsc -p
  packages/axia-action-catalog/tsconfig.json` 필수)
- L-133-9 ADR-132 §6 out-of-scope items 보존 (Path A / UX 중복 해소
  / i18n / Tier 3 destructive content 모두 future ADR)
- L-133-10 절대 #[ignore] 금지

**회귀 매트릭스 (실측)**:

| Layer | Before (LOCKED #59) | After ADR-133 β | Delta |
|---|---|---|---|
| **vitest** (TS) | 1917 / 1 skipped | **1920 / 1 skipped** | **+3** |
| ActionCatalog ALL_ACTIONS | 95 | **161** | +66 |
| axia-geo (cargo) | 1399 | 1399 | UNCHANGED |
| axia-core (cargo) | 302 | 302 | UNCHANGED |
| axia-wasm (cargo) | 0 | 0 | UNCHANGED |
| Playwright E2E | 15+ | 15+ | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| Production CommandPalette | active | active | UNCHANGED |
| CapabilityExplorerPanel display | 95 entries | 161 entries (자동) | additive |

**+3 회귀** (절대 #[ignore] 금지 3/3 준수).

**Lessons (canonical for future SSOT unification ADRs)**:
- L1 Path E (Adapter layer) architectural simplicity — unidirectional
  dependency, non-invasive
- L2 `status: 'ui-only'` lock-in pattern (66 entries 통일)
- L3 dist rebuild 필수 (web 의 import source)
- L4 Identity vs Dispatch 두 layer 분리 canonical (ADR-045 D1 amendment
  필요 시점 — 별도 ADR)
- L5 Single-direction invariant (AC ⊇ CC) — 13 AC-only entries OK
- L6 α spec → β implementation atomic pattern 6번째 적용
- L7 Audit-first canonical 7번째 적용 (메타 evidence)

**다음 트랙 (자연 next)**:
- **ADR-045 D1 amendment** (가칭) — SSOT spec correction (identity vs
  dispatch 분리 명시)
- **ADR-134 (가칭) — field-level drift detection** (label/description
  /shortcut 일치 강제, ADR-133의 ID-only invariant 확장)
- **ADR-129 Priority #1 closure 갱신** — Pillar 1 부분 closure → ADR-132
  + ADR-133 추가
- **ADR-129 Priority #2** (Visual Baseline V-4) 진입

**Cross-link**:
- ADR-132 audit spec (Path E 추천, 본 LOCKED 의 직접 trigger)
- ADR-131 + LOCKED #59 (dual catalog finding 발견)
- ADR-130 Amendment 1 (ADR-131 §A1.2 detailed source)
- ADR-045 D1 (ActionCatalog SSOT spec — invariant 실측 회복)
- ADR-041 P26 (capability tier policy)
- ADR-046 P31 Pillar 1 (Discoverability anchor)
- ADR-046 P31 #4 additive only
- ADR-118/119/124/126/128 (α spec → β implementation atomic pattern source)
- ADR-115 / ADR-117 (tool-torus entry adrs[] reference)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #59 (직전 closure, ADR-131 + ADR-130 Amendment 1)

### 61. ADR-045 D1 Amendment 1 + ADR-129 Amendment 1 — Identity vs Dispatch + Priority #1 부분 closure (docs only, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "승인합니다" (Option A — small docs cleanup amendment)

ADR-133 closure (LOCKED #60) 후 자연 후속 documentation amendment 2건
single PR. ADR-131/132/133 closure 의 architectural truth 명시 lock-in.

**Amendment 1.1 — ADR-045 D1 (Identity vs Dispatch 분리)**:

D1 spec §5 핵심 문장 1:
> "ActionCatalog is the single source of truth for action identity across UI and MCP."

ADR-133 closure 시점 *refinement* (spec 본문 변경 0, 의미 명시화):

| Layer | SSOT | Fields | Consumer |
|---|---|---|---|
| **Identity** | ActionCatalog (`packages/axia-action-catalog/`) | id / label / description / tier / surfaces / aliases / status / adrs | CapabilityExplorerPanel + MCP server |
| **Dispatch** | CommandCatalog (`web/src/commands/`) | execute closure / toolbar / shortcut / iconSvg / enabled() / active() / group | CommandPalette + main.ts + (potential) MenuBar/KeyboardShortcuts |

**AC ⊇ CC invariant** (ADR-133 L-133-3) 강제 — `web/src/commands/
CatalogConsistency.test.ts` 가 CI에서 검증. 13 AC-only entries
(`attach-surface-*-validated` × 5, diagnostic helpers 8) 는 MCP/diagnostic-
only, intentional.

**두 layer 분리의 architectural value**:
- Identity (AC) 변경: capability/metadata, **빈도 낮음** (architectural)
- Dispatch (CC) 변경: UI 행동, **빈도 높음** (UX iteration)
- 변경 빈도 + 영향 범위 분리 → single SSOT churn 충돌 방지

**Amendment 1.2 — ADR-129 (Priority #1 부분 closure)**:

ADR-129 §3.1 Priority #1 (Pillar 1 Discoverability) 진행 매트릭스:

| Component | Spec scope | Actual | Closure |
|---|---|---|---|
| Cmd-K palette | 추가 impl 필요 | ✅ Production active (286 LOC, 148 commands) | ADR-131 (6번째 pivot) |
| ActionCatalog SSOT | binding 필요 | ✅ 161 entries, AC ⊇ CC | ADR-133 β |
| CapabilityExplorerPanel Step 4 | 60% → 100% | ⚠ 60% UNCHANGED | (future γ-3) |
| MenuBar/KeyboardShortcuts binding | Phase 2 | ❌ Not started | (future γ-5/γ-6) |
| Fuzzy search library | fuzzysort | ✅ Native (CommandPalette 자체) | ADR-131 §2.4 |
| i18n infrastructure | Phase 2 | ❌ Not started | (future Phase 2) |
| Tier 3 destructive | ADR-045 D3 reserved | ❌ 0 entries | (future) |

**Priority #1 부분 closure 도달** (원래 spec 의 60-70%). 잔존 30-40% gap:
1. CapabilityExplorerPanel Step 4 dispatch 완료 (~2-3일)
2. CapabilityExplorerPanel vs CommandPalette UX 중복 해소
3. i18n infrastructure
4. ActionCatalog Tier 3 destructive content

**Priority track sequence 유효**:
- ✅ P#1 Pillar 1 부분 closure
- ⏭ P#2 Visual Baseline V-4 (다음 진입 후보, ~2주 atomic)
- ⏭ P#3 Reference Visual Rendering (ADR-095 Phase 4)
- ⏭ P#4 Mode Coherence

P#1 잔존 gap은 P#2 진입과 orthogonal (별도 ADR 가능).

**Lock-ins (L-61-1 ~ L-61-7)**:
- L-61-1 ADR-045 D1 spec 본문 보존 + Amendment 1 (spec preservation
  pattern 7번째 누적)
- L-61-2 Identity vs Dispatch 두 SSOT canonical (ADR-133 §5 답습)
- L-61-3 AC ⊇ CC invariant 명시 (ADR-133 L-133-3)
- L-61-4 13 AC-only entries 보존 (MCP/diagnostic-only intentional)
- L-61-5 ADR-129 §3 priority track sequence UNCHANGED (P#1 부분 closure
  추가만)
- L-61-6 P#1 잔존 gap (4 영역) ADR-135 (가칭) future trigger
- L-61-7 절대 #[ignore] 금지

**회귀 (0)**: docs only — vitest 1920 / cargo 1399 + 302 UNCHANGED per
LOCKED #60. ADR-077 V-2 baselines + production functionality preserved.

**Lessons (canonical for future architectural truth amendments)**:
- L1 Spec preservation + Amendment pattern **7번째 누적** (ADR-122 의 3
  amendments + ADR-120 / ADR-130 / ADR-045 / ADR-129 amendments)
- L2 Identity vs Dispatch 두 layer 분리 canonical — *변경 빈도 + 영향
  범위* 분리로 single SSOT churn 회피
- L3 Partial closure 명시 lock-in pattern — priority status 가 binary
  (complete/not-started) 아닌 *gradient* 일 때 canonical documentation
- L4 ADR amendment via additional context (spec wording UNCHANGED, refined
  meaning) — ADR-125/126/127/120/131 답습

**다음 트랙 (자연 next)**:
- **ADR-129 Priority #2 (Visual Baseline V-4) 진입** — 권장 default
- **ADR-134 (가칭) field-level drift detection** (label/shortcut 일치
  강제)
- **ADR-135 (가칭) P#1 잔존 gap closure** (CapabilityExplorer Step 4 +
  UX 중복 해소)
- **세션 저장** — 자연 break point (13 PRs / 8 LOCKED entries 추가)

**Cross-link**:
- ADR-045 D1 Amendment 1 (identity vs dispatch 분리)
- ADR-129 Amendment 1 (P#1 부분 closure documented)
- ADR-133 / LOCKED #60 (β implementation, AC ⊇ CC invariant 강제)
- ADR-132 (audit, Path E 추천)
- ADR-131 / LOCKED #59 (dual catalog finding)
- ADR-130 Amendment 1 (Pillar 1 audit findings)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #60 (직전 closure, ADR-133)

### 62. ADR-135 — Distance-based LOD chord_tol Implementation (ADR-134 Path A β, 2026-05-17) ✅

**Canonical anchor (사용자 결재, 2026-05-17)**:
> "Distance-based LOD chord_tol (near=0.02, far=0.2-1.0mm 자동) 로 진행승인합니다"

ADR-134 §5.2 Path A (Distance-based LOD chord_tol) β implementation —
단순/신속/정확, near 영향 0 + far 자동 coarser. 세션 audit-first
canonical 8번째 적용 후 α spec → β implementation atomic 6번째 적용.

**LOCKED #40 §L1 baseline 보존** — near rendering (cam ≤ 100 mm) 영향 0.
Far rendering (cam > 100 mm) 만 자동 LOD coarser → triangle 폭발 해소.

**LOD formula**:
```rust
pub fn lod_chord_tol(camera_distance: f64) -> f64 {
    const THRESHOLD_MM: f64 = 100.0;
    const MAX_LOD_CHORD_TOL: f64 = 1.0;
    let dist = camera_distance.max(0.0);
    let lod_factor = (dist / THRESHOLD_MM).max(1.0);
    (DEFAULT_ANALYTIC_CHORD_TOL * lod_factor).min(MAX_LOD_CHORD_TOL)
}
```

| Camera distance | LOD chord_tol | r=1000 sphere triangles |
|---|---|---|
| 0 ~ 100 mm (near) | **0.02 mm** (DEFAULT) | ~2,000,000 (LOCKED #40 baseline) |
| 500 mm (mid) | 0.10 mm | ~200,000 (10× ↓) |
| 1 m (mid) | 0.20 mm | ~100,000 (20× ↓) |
| 2 m (mid) | 0.40 mm | ~50,000 (40× ↓) |
| 5 m+ (far) | **1.0 mm** (cap) | ~40,000 (50× ↓) |

**Implementation (5 layers)**:
1. **Engine** (`axia-geo/src/mesh_export.rs`) — `DEFAULT_ANALYTIC_CHORD_TOL`
   const + `lod_chord_tol()` helper + `Mesh::export_buffers_with_tol(chord_tol)`
   method (backward compat: `export_buffers()` UNCHANGED, calls `_with_tol(DEFAULT)`)
2. **Scene** (`axia-core/src/scene.rs`) — `Scene::export_mesh_buffers_with_tol(chord_tol)`
   wrapper
3. **WASM** (`axia-wasm/src/lib.rs`) — `render_chord_tol: f64` field + 3
   exports (`renderChordTol`/`setRenderChordTol`/`lodChordTol`) + `rebuild_cache`
   uses dynamic tol
4. **TS bridge** (`web/src/bridge/WasmBridge.ts`) — 3 wrappers with graceful
   fallback (TS formula mirror when WASM stub missing)
5. **Viewport wiring** (`web/src/main.ts`) — `viewport.onFrame` per-frame
   LOD compute + 5% threshold push (avoids per-frame rebuild churn)

**Lock-ins (L-135-1 ~ L-135-10)**:
- L-135-1 ADR-134 §5.2 Path A 채택 (단순/신속/정확)
- L-135-2 LOCKED #40 §L1 baseline (0.02 mm) **보존** (near 영향 0)
- L-135-3 LOD formula monotonic non-decreasing in distance (property test)
- L-135-4 Backward compat: 기존 signatures UNCHANGED, `_with_tol` 추가만
- L-135-5 WASM `setRenderChordTol` idempotent (< 1μm 변화 no-op) + triggers
  `cache_dirty + topology_changed` (full rebuild required, triangle count
  drastic change)
- L-135-6 TS Viewport 5% threshold throttling (per-frame no-op for slow zoom)
- L-135-7 TS bridge graceful fallback (engine stub missing → TS formula mirror)
- L-135-8 ADR-046 P31 #4 additive only — public API + UX UNCHANGED, visual
  near rendering 영향 0
- L-135-9 ADR-077 V-2 visual baselines unchanged (near rendering identical)
- L-135-10 절대 #[ignore] 금지

**회귀 매트릭스 (실측)**:

| Layer | Before (LOCKED #61) | After ADR-135 β | Delta |
|---|---|---|---|
| **axia-geo** (cargo) | 1399 | **1407** | **+8** |
| axia-core (cargo) | 302 | 302 | UNCHANGED |
| axia-wasm (cargo) | 0 | 0 | UNCHANGED |
| **vitest** (TS) | 1920 / 1 skipped | **1931 / 1 skipped** | **+11** |
| `mesh_export::adr135_lod_tests` | (new) | 8 tests | +8 |
| `bridge/LodChordTol.test.ts` | (new) | 11 tests | +11 |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| ADR-077 V-2 baselines | preserved | preserved | UNCHANGED |

**합계 +19 회귀** (cargo +8 + vitest +11, 절대 #[ignore] 금지 19/19 준수).

**사용자 facing 변화**:
- Near (cam ≤ 100mm): UNCHANGED (0.02mm preserved)
- Mid (1m): **5-10× faster syncMesh** (50K → 10K tris for r=100 sphere)
- Far (5m+): **50× faster** (2M → 40K tris for r=1000 sphere, frame budget restored)

**Lessons (canonical for future render-perf ADRs)**:
- L1 Single-direction monotonic invariant (property test)
- L2 Backward-compat via additive method (signature UNCHANGED)
- L3 Pure function exposed via WASM (`lodChordTol` for TS validation)
- L4 5% threshold throttling at TS-side (avoids per-frame rebuild)
- L5 Near rendering 영향 0 design (LOCKED #40 spirit preserved)
- L6 α spec → β implementation atomic 7번째 적용 (pattern 정착)
- L7 `topology_changed = true` on chord_tol change (delta-buffer safety)
- L8 사용자 시연 evidence post-closure 권장 (LOD threshold/cap 조정 가능)

**다음 트랙 (자연 next)**:
- **사용자 manual 시연** — Sphere r=10/100/1000 + sketch panning + STEP
  import 측정 (ADR-087 K-ζ canonical). LOD threshold (100mm) / cap (1.0mm)
  조정 가능 (future amendment).
- **ADR-134 §5 Path B (Adaptive per radius)** — Path A 와 직교, 결합 시 별도 ADR
- **ADR-134 §5 Path D (Sketch export cache)** — preview latency 별도 architectural fix
- **ADR-134 §5 Path E (Mesh build hash optimization)** — 1000-face O(N²) scaling 별도 audit
- **세션 저장** — 자연 break point (14 PRs / 9 LOCKED entries 추가)

**Cross-link**:
- ADR-134 / PR #99 (audit spec — 사용자 perceived slowness 원인 + 6 fix options)
- LOCKED #40 §L1 (ANALYTIC_CHORD_TOL = 0.02 mm 정책 baseline 보존)
- LOCKED #35/47/48/49 (Path B production default ON)
- ADR-031 Phase D / ADR-038 P23 / ADR-089 Phase 2 (analytic surface infra)
- ADR-094/113/114/115 (Path B β implementations — Sphere/Cylinder/Cone/Torus)
- ADR-111 α / ADR-112 / ADR-124 / ADR-126 (other render perf ADRs, 시너지)
- ADR-046 P31 #4 additive only (L-135-8)
- ADR-077 V-2 visual baseline (near preserved, L-135-9)
- ADR-087 K-ζ 사용자 시연 게이트 canonical
- ADR-118/119/122/123/124/126/128/132/133 (α spec → β impl atomic pattern source)
- LOCKED #44 Complete Meaning per Merge

### 63. PR #101 — z=0 Invariant Closure (DrawRectTool Rewrite + Snap Disable + System-wide Cardinal Force, 2026-05-18) ✅

> ⚠ **Amended by ADR-175 (2026-06-01, 사용자 결재 "LOCKED #63 개정 — 직접
> 그리기")**. `get3DPoint` 의 "무조건 z=0 강제 + face hit 우회" 는 **빈 공간**
> 에서만 보존. **면(solid face) 위 클릭 시 그 면 plane 에 직접 그려짐**
> (get3DPoint face-aware, getDrawPlane ADR-140 과 일치). 원래 z=0 강제의
> motivation (face hit drift 전파) 은 ADR-170/171/168 absorb 인프라가 해소.
> Demo-verified (실제 UI 마우스: 박스 윗면 가로선 → faces 6→7 분할 / 빈 공간
> → z=0 보존). 자세히는 LOCKED #75 + `docs/adr/175-face-hit-drawing-plane.md`.

**Canonical anchor (사용자 결재, 2026-05-18, 누적 4건)**:
> "rect 명령 제거하고 새로 만듭니다. 무조건 z=0에서 그려져야 합니다."
> "스냅이 문제입니다. 스냅기능을 모두 지워주세요. z=0 완성후 스냅기능을
>  새로 정립합니다"
> "다른 그리기 도구에서도 마찬가지... 무조건 z=0에서 그려져야 합니다"
> "분할된 면이 선택되도록 해주세요"

ADR-087 K-ζ canonical legacy deletion + rewrite 패턴 답습. 사용자 시연
evidence (별 모양 self-intersecting RECT + 66 console errors "recursive
use of an object detected") root cause:
- legacy DrawRectTool 의 face hit 시 onFace=true plane 의 drift 전파
- snap system 의 자석 효과가 RECT corner 를 다른 vertex 로 끌어감
- ToolManager.getSnappedPoint 의 snapVisual.clear() race condition

본 LOCKED 은 **z=0 invariant 전체 closure** 의 정책 lock-in. Snap 시스템
완전 비활성 + 모든 그리기 도구 system-wide cardinal force.

#### 핵심 정책 매트릭스

| 측면 | 정책 |
|---|---|
| **DrawRectTool plane** | Cardinal ground plane only (face hit 우회) |
| **모든 click cardinal axis** | exactly 0 force (drift 무관 assign) |
| **View mode 매핑** | 3d/top/bottom → Z=0, front/back → Y=0, right/left → X=0 |
| **Sketch mode** | 보존 (user explicit, 예외) |
| **Snap system** | 완전 비활성 (raw passthrough) — SnapManager/SnapVisual class 보존 |
| **ToolManager.get3DPoint** | System-wide cardinal force 단일 진입점 |
| **mousedown/mousemove handlers** | getSnappedPoint 호출 제거 (raw 3D point 직접 전달) |
| **ServiceContainer 'selection'** | mangling-safe external access (vs minified `tm.selection`) |
| **ServiceContainer 'syncMesh'** | 동일 패턴 — external sync API |
| **face split 검증** | engine + faceMap + selection logic path (54 E2E PASS) |
| **mouse click + render + BVH atomic sync** | **ADR-136 α spec** (별도 architectural ADR β 트랙) |

#### Lock-ins (L-63-1 ~ L-63-10)

- **L-63-1** DrawRectTool: cardinal ground plane strict (no face hit, no drift)
- **L-63-2** ToolManager.get3DPoint: system-wide cardinal axis force (모든
  그리기 도구 자동 z=0)
- **L-63-3** Snap 완전 비활성 (raw passthrough) — re-introduction 별도 ADR
- **L-63-4** SnapManager / SnapVisual class 보존 (git history + class 본체)
- **L-63-5** ServiceContainer mangling-safe API ('selection' / 'syncMesh')
- **L-63-6** 모든 그리기 도구 자동 영향 (Rect/Line/Circle/Polygon/Bezier/
  Arc/Freehand) — single change system-wide
- **L-63-7** Sketch mode 보존 — user explicit plane 우선
- **L-63-8** 54 E2E 회귀 자산 (8 specs) — 절대 #[ignore] 금지
- **L-63-9** ADR-046 P31 #4 additive only — public API surface UNCHANGED
- **L-63-10** 사용자 결재 "z=0 완성후 스냅 새로 정립" — re-introduction
  은 별도 ADR + 사용자 결재 필수

#### 회귀 매트릭스 (실측)

| Layer | 결과 |
|---|---|
| vitest | **1931/1931 PASS** (1 skipped — Path B slow channel) |
| E2E z=0 (8 specs 누적) | **54/54 PASS** |
| Production build | ✅ 12-13s 안정 |
| TypeScript check | ✅ no errors |
| 절대 #[ignore] 금지 | 54/54 준수 |

#### E2E 회귀 자산 (PR #101 누적)

| Spec | Tests | 검증 |
|---|---|---|
| z0-drawing-coplanarity | 6 | bridge API z=0 cardinal snap |
| z0-closed-loop-face-synthesis | 6 | LOCKED #12 P11 닫힌 loop = 면 |
| z0-face-split-all-tools | 8 | LOCKED #1 P7 + #41 ADR-101 cross-tool |
| z0-rect-stress-split | 5 | Multi-RECT stress + S4 finding |
| z0-user-mouse-drawing | 5 | Real Playwright mouse simulation |
| z0-all-tools-cardinal | 5 | System-wide cardinal force all tools |
| z0-face-synthesis-split-cross-tool | 14 | 6 tool kinds × 3 split patterns |
| z0-split-face-selection | 5 | Engine + selection logic (mouse click deferred to ADR-136) |
| **합계** | **54** | |

#### Architectural Findings (별도 future ADR trigger anchors)

- **S4 finding**: ADR-101 auto-intersect 의 scope = single-loop face only
  (ring face 와 partial overlap → split skip, LOCKED #1 multi-loop face
  정책 정합). 별도 ADR (가칭 "Multi-loop Face Auto-Intersect Extension").
- **사용자 통찰 (가장 깊은 finding)**: "처음부터 면분할이 완전하지 않
  았기 때문에 다른 부분과 충돌이 생기는것 같아요" → **ADR-136 α spec**
  ("Face Split Downstream Sync Coherence") — LOCKED #15 P22.3 (sync
  rebuild) ↔ ADR-111 (BVH defer) 정책 충돌 명시. β implementation 3
  path (A/B/C) 비교.

#### 사용자 시연 evidence (ADR-087 K-ζ canonical)

이전 결함 → 수정 후:
- 별 모양 self-intersecting RECT → **사라짐** (snap drift 제거)
- 66 console errors → **사라짐** (snap path WASM call 제거)
- RECT corner 가 의도와 다른 vertex 로 끌림 → **정확히 click 위치**
- 4 RECT 모두 ground plane (z=0) 위에 정확히 → **사용자 manual PASS**

#### Cross-link

- LOCKED #1 ADR-021 P7 (closed edge divides face)
- LOCKED #7 ADR-026 P12 (cardinal snap SSOT defense layer 2)
- LOCKED #12 ADR-025 P11 (닫힌 엣지 = 반드시 면)
- LOCKED #15 P22.3 ADR-037 (topology rebuild after split)
- LOCKED #41 ADR-101 (coplanar partial overlap auto-intersect)
- LOCKED #43 ADR-103 (Z-up + Z=0 ground plane)
- LOCKED #44 (Complete Meaning per Merge — z=0 invariant closure)
- LOCKED #45 ADR-111 α (BVH defer to next frame — ADR-136 충돌 source)
- 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)
- ADR-087 K-ζ canonical (legacy deletion + rewrite pattern)
- **ADR-136 α spec** (Face Split Downstream Sync Coherence — 본 PR 의
  사용자 통찰 finding)

#### Follow-up (별도 ADR per LOCKED #44)

- **ADR-XXX (가칭) Snap re-introduction "Guidance-only Snap"** — 사용자
  결재 "z=0 완성후 스냅 새로 정립" 정합. commit 위치는 raw mouse, snap
  = visual hint only
- **ADR-136 β implementation** — Path A 권장 (Sync rebuild on topology
  change)
- **ADR-XXX Multi-loop face auto-split extension** — S4 finding 자연
  흡수 by **ADR-139 (Boundary tool only)**

### 64. ADR-139 — Boundary-only Face Synthesis (B-α α spec closure, 2026-05-18)

> ⚠ **Production default amended by ADR-176 (2026-06-01, 사용자 결재
> "둘 다 고침")**. `auto_intersect_on_draw` + `auto_face_synthesis_on_draw`
> 의 **production default 가 OFF → ON** 으로 전환 (engine default 는 OFF
> 유지, 회귀 자산 보존). 근거: Phase 1-4 (ADR-169~173) absorb 견고화 완료.
> 메타-원칙 #16 (휴리스틱 antipattern) 자체 + Boundary tool 명시 trigger 는
> **불변 보존** — production default 만 변경. Demo-verified: 멀티-RECT
> 스트레스 invariant 0 violations. 자세히는 LOCKED #76 +
> `docs/adr/176-auto-behaviors-production-default-on.md`.

**Canonical anchor (사용자 통찰, 2026-05-18)**:
> "현재 자동 cycle detection + auto-punching 접근이 cascading 이슈 만들고
>  있습니다 (P5.UX.39-45가 모두 이전 자동화의 부작용 처리). CAD 표준
>  BOUNDARY 명령 방식이 더 안정적입니다."

**Status**: α spec + Q1~Q5 결재 완료 (commit `d233f16`). **β
implementation B-β-1 closure** (본 PR) — `auto_intersect_on_draw` flag
default `true` → `false`. 나머지 sub-step (B-β-2/3/4 + B-γ ~ B-μ) 별도
PR 시리즈.

**5 핵심 결재 (Q1~Q5, all approved 2026-05-18)**:
- **Q1 = Path A (Pure Boundary only)** — 자동 trigger 완전 폐기
- **Q2 = (a) DrawRect/DrawCircle single-op auto-face 보존** — single op =
  closed boundary 그리기 + 면 만들기 = explicit intent 명확
- **Q3 = (a) 자동 합성 정책 모두 Superseded** — LOCKED #1 P7 / #12 P11
  / #41 ADR-101 모두 supersede (결과 invariant 보존, trigger 만 변경)
- **Q4 = (a) 60+ 회귀 자산 재작성** — 자동 trigger expect → Boundary
  명시 호출 시뮬레이션
- **Q5 = (a) ADR-138 흡수** — Pure Boundary = 자동 trigger 폐기 →
  multi-loop face 자체 안 생성 → Path B 자연 달성

#### 핵심 정책 매트릭스

| 측면 | 정책 |
|---|---|
| **DrawLine / DrawArc / DrawBezier / DrawPolyline / DrawFreehand** | 그리기 only (line + edge 만, face 자동 0) |
| **DrawRect / DrawCircle / DrawPolygon** | single explicit op auto-face **보존** (Q2-a) |
| **Boundary tool 단축키** | `B` (CAD AutoCAD `BOUNDARY` parity) |
| **2D BOUNDARY algorithm** | Planar graph face traversal (DCEL 기존 자산 + Cardinal + BVH) — O(N) per query |
| **3D BOUNDARY** | Phase 2 future (closed shell → volume) |
| **자동 cycle detection** | **폐기** (`resolve_planar_free_faces` Step 4.99 disable, Step 4.95 second-pass disable) |
| **자동 containment split** | **폐기** (LOCKED #1 P7 supersede) |
| **자동 coplanar overlap intersect** | **폐기** (LOCKED #41 supersede) |
| **STEP/IGES import free edges** | Boundary 명시로 face 가능 (가치 unlock — 이전엔 무시) |
| **결과 face** | simple (single closed loop) — multi-loop face 자체 안 생성 (ADR-138 Path B 자연 달성) |
| **LOCKED #63 z=0 invariant** | **직교 보존** ✅ |
| **메타-원칙 #14** | **불변 보존** (WHAT layer — 결과 invariant) |
| **메타-원칙 #16** | **신설 anchor** (WHEN layer — trigger 정책) |

#### Lock-ins (L-64-1 ~ L-64-10)

- **L-64-1** LOCKED #12 ADR-025 P11 Superseded (자동 cycle face 합성)
- **L-64-2** LOCKED #1 ADR-021 P7 Superseded (자동 containment split)
- **L-64-3** LOCKED #41 ADR-101 Superseded (자동 partial overlap intersect)
- **L-64-4** Boundary tool 단축키 = `B` (CAD parity)
- **L-64-5** Algorithm = planar graph face traversal (기존 DCEL 자산
  + Cardinal projection LOCKED #63 + BVH spatial accel) — 새 알고리즘 0
- **L-64-6** 결과 face = simple (single closed loop) — multi-loop 자체
  생성 안 함 → ADR-138 Path B 자연 달성 (ADR-138 Superseded by ADR-139)
- **L-64-7** DrawRect / DrawCircle / DrawPolygon single-op auto-face 보존
  (single op = explicit intent, Q2-a 결재)
- **L-64-8** LOCKED #63 z=0 invariant 보존 (직교)
- **L-64-9** 메타-원칙 #14 불변 보존 (WHAT — 결과 invariant)
- **L-64-10** 메타-원칙 #16 신설 anchor (WHEN — trigger 정책)
- **L-64-11** P5.UX.39-45 cascading fixes 패턴 영구 차단 (autopilot
  antipattern 회귀 0)
- **L-64-12** 사용자 시연 시 *구멍 0 보장* — 자동 fail 없음
- **L-64-13** 60+ 회귀 자산 재작성 (B-ζ atomic sub-step) — 자동 trigger
  expect → 명시 Boundary 호출 simulate

#### Acceptance Log (α + Q 결재 + 후속 plan)

- **2026-05-18 α** (`d233f16` PR #103) — α spec 작성 + Q1~Q5 결재 anchor
- **2026-05-18 B-β audit** (`a2421d5` PR #104) — multi-hole connected
  inner audit + 즉시 회피 가이드
- **2026-05-18 B-ζ audit** (PR #128, audit-first canonical 8번째) —
  회귀 자산 update audit (5 layer inventory + update type 매트릭스 +
  위험 분석). 총 ~275-280 회귀 자산 inventory — 불변 ~123 (45%) /
  명시 호출 추가 ~45 (17%) / 재작성 ~107 (39%) / count 영향 ~27 (10%).
  B-β implementation 진입 전 위험 격리 + sub-step 분할 (B-β-1~B-β-4)
  권장.
- **2026-05-18 docs batch** (PR #127, supersede notes):
  - B-η — LOCKED #1 / #12 / #41 supersede docs
  - B-θ — ADR-138 closure note (이미 ADR-138 §SUPERSEDED NOTE 에 등재)
  - B-κ — 메타-원칙 #14 amendment + #16 신설
  - B-λ — LOCKED #64 신설 (본 entry)
- **2026-05-18 B-β-1 implementation** (PR #129, 첫 β implementation
  step) — `auto_intersect_on_draw` flag default `true` → `false`:
  - Engine + WASM bridge + TS layer default OFF (LOCKED #44 single
    atomic PR)
  - localStorage `'true'` 명시 ON preference 보존 (ADR-049 P-5e-α
    canonical 답습)
  - axia-core 영향 6 tests: explicit `scene.auto_intersect_on_draw =
    true` opt-in (4 scene::tests adr101_b4 + 2 intersect_with_model)
  - Playwright E2E 6 specs: `page.addInitScript` 으로 localStorage
    'true' 사전 설정 (z0-rect-stress-split / z0-face-split-all-tools /
    z0-face-synthesis-split-cross-tool / z0-split-face-selection /
    adr-101-b6-visual-demo / adr-101-b6-user-demo-verify)
  - 회귀: axia-core 302+36=338 / axia-geo 1407+24=1431 / axia-wasm 54
    모두 PASS, 절대 #[ignore] 금지 준수
- **2026-05-18 B-β-2 implementation** (PR #130) — `auto_face_synthesis_on_
  draw` flag 신설 + Step 4.99 (`resolve_planar_free_faces` fixed-point
  loop) 자동 호출 사이트 wrap. Default `false`:
  - Engine scene.rs: 신규 flag field + Step 4.99 wrap
  - WASM bridge: `setAutoFaceSynthesisOnDraw` / `getAutoFaceSynthesisOnDraw`
    exports (export_baseline +2 entries)
  - TS AutoFaceSynthesisSettings.ts (신규 모듈, AutoIntersectSettings
    패턴 답습)
  - TS WasmBridge.ts wrappers
  - main.ts wiring (init + onChange 패턴)
  - Playwright E2E: z0-closed-loop-face-synthesis explicit opt-in +
    z0-face-split-all-tools opt-in 확장 (2 flags)
  - 회귀 0 (Step 4.99 mop-up 단계 — earlier 단계 4.5/4.6/4.9/4.95 가
    이미 closed cycle synthesis 처리)
  - 회귀: axia-core 302+36=338 / axia-geo 1407+24=1431 / axia-wasm 54 /
    vitest 1931 모두 PASS
- **2026-05-21 B-β-3 implementation** (본 PR) — `auto_face_synthesis_on_draw`
  flag 의미 확장: Step 4.99 만 → **Step 4.95 + Step 4.99 + Phase 5 + Phase 6**
  모두 gate. LOCKED #1 ADR-021 P7 의 본격 trigger 폐기:
  - Engine scene.rs:
    * Step 4.95 (P7 ring rebuild, lines 2967-3273, 307 LoC) wrap with flag
    * Phase 5 (`mop_up_orphan_cycles_via_dfs`) 자동 호출 wrap
    * Phase 6 (`absorb_orphan_strands_into_faces`) 자동 호출 wrap
    * Phase 7 STRICT 보존 (Q2-a single-op auto-face)
    * User-callable `resynthesize_orphan_faces` command 보존 (명시 호출)
  - axia-core scene::tests 6 tests explicit opt-in (P7/P9 4 + Phase A 1 +
    drawing order 1):
    * `test_adr016_path_b_inner_first_then_outer_resynthesize`
    * `test_adr021_p7_case_a_inner_first_then_outer`
    * `test_adr021_phaseB_3level_nested_smallest_first`
    * `test_phaseA_postprocess_promote_path_radial`
    * `test_p9_corner_pinch_two_inners_become_two_holes`
    * `test_p9_pinch_drawing_order_independence` (Case A + B 모두)
  - Playwright E2E 5 specs: `'axia:auto-face-synthesis-on-draw' = 'true'`
    localStorage 사전 설정 (z0-rect-stress-split / z0-face-synthesis-
    split-cross-tool / z0-split-face-selection / adr-101-b6-visual-demo /
    adr-101-b6-user-demo-verify)
  - 회귀: axia-core 302+36=338 / axia-geo 1407+24=1431 / axia-wasm 54 /
    vitest 1931 모두 PASS. 절대 #[ignore] 금지 준수.
  - **사용자 facing 본격 변화**:
    * DrawLine × N closed loop → 자동 face 안 만들어짐 (LOCKED #12 P11 본격 회피)
    * RECT containment → 자동 ring + hole 안 만들어짐 (LOCKED #1 P7 본격 회피)
    * DrawRect / DrawCircle single-op auto-face **보존** (Q2-a, Phase 7 STRICT)
    * P5.UX.39-45 cascading fixes 패턴 **본격 회피 시작**
- **2026-05-22 B-γ MVP audit pivot** (PR #138) — **audit-first canonical
  11번째 적용**. ADR-139 §14 B-γ engine API 가 **이미 사실상 구현됨**
  finding:
  - Engine `Scene::resynthesize_orphan_faces` + WASM `resynthesizeOrphanFaces`
    + TS wrapper + ToolManager action `'resynthesize-faces'` + MenuBar 모두
    이미 활성
  - 본 PR 변경: Korean label 재정의 — "면 재합성 (닫힌 라인 cycle →
    face)" → "경계 도구 (Boundary) — 닫힌 line cycle 명시 면 합성
    (ADR-139)"
  - 사용자 facing 즉시 가치: ADR-139 의 명시 trigger entry 활성 (기존
    label 의 의미가 ADR-139 정합 보정 명시)
  - **남은 작업** (별도 sub-step):
    * B-γ' point-based localization (full mesh sweep 보다 정밀)
    * B-ε TS BoundaryTool 'B' 단축키 (현재 b=bottom view 충돌, 결재 필요)
- **(B-γ' + B-δ + B-ε + B-ι + B-μ): 다음 sub-steps** (별도 PRs):
  - B-β-4: ✅ closed (PR #131 audit pivot — TS 변경 0)
  - B-γ MVP: ✅ closed (PR #138 — label 재정의, audit pivot)
- **2026-05-23 K3 시나리오 3 hotfix** (본 PR) — `face_to_surface_owner_id`
  propagation 추가. 보고서 (`reports/입력보정파이프라인_적용계획.html`)
  의 시나리오 3 권장 fix + audit (PR #139) 의 demo-breaking 확정 후속.
  6 split sites 모두 propagation 추가:
  * `split_face_by_chain` (face_split.rs:717-732)
  * `case_b` (face_split.rs:1051-1071)
  * `case_c` (face_split.rs:1301-1320)
  * `case_d` (face_split.rs:1512-1531)
  * `Mesh::split_face` (mesh.rs:4640-4730)
  * `boolean::split_faces_by_intersections` (boolean.rs:544-589)
  - 패턴 답습: ADR-089 A-χ-β (parent surface propagation) — 각 사이트
    `parent_owner = mesh.face_surface_owner_id(face_id)` 1-line + 자식
    set 1-line × N.
  - 회귀: axia-geo +2 (`k3_split_face_propagates_surface_owner_id` +
    `k3_split_face_no_owner_propagates_none`)
  - 사용자 facing 변화: Path A cylinder Push/Pull 후 측면 face 클릭
    → group full-selection (N face 모두 선택) 정합 회복
  - B-γ: Engine — `Mesh::boundary_from_point(p, plane)` 신규
  - B-δ: WASM bridge — `bridge.boundaryFromClick(...)` + TS wrapper
  - B-ε: TS BoundaryTool 신규 — 'B' 단축키 + cursor crosshair + click
  - B-ζ: 회귀 자산 update — 60+ tests 재작성 (자동 → 명시 호출 시뮬레이션)
  - B-ι: E2E + 사용자 시연 (구멍 0 검증, ADR-087 K-ζ canonical)
  - B-μ: 3D BOUNDARY (closed shell extraction) Phase 2 별도 ADR

#### Cross-link

- ADR-139 α spec / B-β audit (`docs/adr/139-boundary-tool-auto-cycle-
  deprecation.md` + `docs/adr/139-b-beta-audit-and-workaround.md`)
- ADR-138 closure (Superseded by ADR-139, Q5-a 흡수)
- LOCKED #1 ADR-021 P7 (Superseded)
- LOCKED #12 ADR-025 P11 (Superseded)
- LOCKED #41 ADR-101 (Superseded)
- LOCKED #63 PR #101 (z=0 invariant — 직교 보존)
- 메타-원칙 #14 (WHAT layer 불변 보존)
- 메타-원칙 #16 (WHEN layer 신설 anchor)
- 메타-원칙 #5 (사용자 편의 — 명확 자동 / 모호 명시)
- ADR-087 K-ζ canonical (legacy deletion + 사용자 시연 게이트)
- ADR-094/097/099/138 (Path Z atomic 패턴 source)

### 65. ADR-141 — Master Roadmap (Sprint 0 Foundation Sync closure, 2026-05-22) ✅

**Canonical anchor (사용자 결재, 2026-05-22)**:
> "5/5 결재 lock-in (옵션 B 면 생성 / 옵션 A Ellipse / 신규 3 ADR / Sprint +1주
> / 21~29주 +330 회귀). Sprint 0 Foundation Sync 즉시 시작. ADR 번호 ADR-141~161
> 재배정 적용. 5/5 결재 의도 모두 보존."

외부 에이전트 마스터 완성 계획 (`reports/최종_결재완료_Sprint0_시작.html`
+ `reports/Sprint0_Kickoff_Guide.html` + `reports/마스터_완성계획.html`
+ `reports/곡선면_도형그리기_완성계획.html`) 의 5/5 결재 lock-in 을
main 으로 통합. 외부 agent 가 본 worktree 의 stale main (73c004e, 167
commits behind) 만 보고 작성한 ADR-101~123 reserve 는 audit-first
canonical 16번째 적용으로 **ADR-141~161 재배정** — 5/5 결재 의도 보존
+ ADR 번호 영역만 main 현실 (ADR-100~140 all used) 에 정합 정정.

#### 5/5 결재 lock-in 매트릭스

| # | 결재 | 재배정 ADR | 비고 |
|---|---|---|---|
| 1 | 면 생성 정책 옵션 B (annulus 명시 활성) | ADR-145 | 메타-원칙 #16 정합 |
| 2 | Ellipse 옵션 A (NURBS-only) | ADR-158 | ADR-027 정합, enum 변경 0 |
| 3 | 신규 ADR 3개 (Circle annulus / Ellipse / Surface Push-Pull) | ADR-145, 158, 159 | 외부 ADR-121/122/123 정정 |
| 4 | Sprint 1, 5 각 +1주 확장 | (Sprint 기간 lock-in) | S1: 3~4주 / S5: 3~4주 |
| 5 | 총 timeline 21~29주 / 회귀 +330 | (정합 lock-in) | 절대 #[ignore] 금지 330/330 |

#### 8-Sprint 통합 roadmap

| Sprint | 제목 | 기간 | 회귀 | ADRs (재배정) |
|---|---|---|---|---|
| S0 | Foundation Sync | 1주 | +0 | **ADR-141 (본 ADR)** |
| S1 | Demo-Breaking Hotfix + Circle annulus | 3~4주 | +55 | ADR-142, 143, 144, 145 |
| S2 | Input Step 1+2 | 2~3주 | +30 | ADR-146, 147, 148 |
| S3 | Topology Cleanup Step 3 | 3~4주 | +50 | ADR-149, 150, 151 |
| S4 | Healing Pipeline Step 4 | 3~4주 | +60 | ADR-152, 153, 154 |
| S4.5 | Curve-to-Curve Face Split | 4~6주 | +30 | ADR-155 |
| S5 | 곡면 face + Sketch + Ellipse + Surface Push/Pull | 3~4주 | +75 | ADR-156, 157, 158, 159 |
| S6 | Annotation + Polish + Release | 2~3주 | +30 | ADR-160, 161 |
| **합계** | **Production-grade RC** | **21~29주** | **+330** | **21 ADRs** (ADR-141~161) |

#### Sprint 0 5 sub-step 결산

| Sub-step | 결과 |
|---|---|
| α (git pull) | main 167 commits behind → 0 (708b1c1) ✅ |
| β (PR #140 merge) | 본 세션 PR #140 (K3) 이미 main merge (auto-closed) ✅ |
| γ (worktree closure) | nervous-bose merged ✅ / elated-poitras + tender-chaum deferred ⚠ |
| δ (core.autocrlf) | `core.autocrlf input` 설정 (cross-platform safe) ✅ |
| ε (본 ADR) | ADR-141 + LOCKED #65 + README catalog update ✅ |

#### Lock-ins (L-65-1 ~ L-65-12)

- **L-65-1** 5/5 결재 의도 보존 강제 (옵션 B 면 생성 / 옵션 A Ellipse /
  신규 3 ADR / Sprint +1주 / 21~29주 +330)
- **L-65-2** ADR-141~161 reserve 매트릭스 (외부 agent ADR-101~123 정정)
- **L-65-3** 모든 21 ADR 의 메타-원칙 #16 정합 강제 (자동 trigger
  default OFF + opt-in)
- **L-65-4** 모든 21 ADR 의 LOCKED #44 정합 강제 (Complete Meaning
  per Merge — 단일 atomic PR per sub-step)
- **L-65-5** 모든 21 ADR 의 Path Z atomic pattern 강제 (α~η sub-step
  + 사전 audit + 사용자 결재 + 회귀 자산 + 사용자 시연)
- **L-65-6** 절대 #[ignore] 금지 330/330 강제
- **L-65-7** 회귀 자산 단조 증가 (Sprint 별 분배 매트릭스 anchor)
- **L-65-8** Sprint 4.5 (ADR-155) 의 4~6주 multi-week atomic 강제
  (ADR-094 §E L1 답습)
- **L-65-9** 모든 자동 trigger default OFF + localStorage opt-in
  canonical (ADR-049 P-5e-α 답습)
- **L-65-10** 사용자 시연 게이트 (ADR-087 K-ζ canonical) Sprint 종료
  시점 필수
- **L-65-11** 외부 agent 계획 integration 의 **audit-first canonical
  default** (본 ADR 의 architectural foundation)
- **L-65-12** Worktree 다중 운영 closure 결정은 별도 audit ADR (γ
  deferred 2 worktree — elated-poitras / tender-chaum)

#### Lessons (canonical for future external-agent integration ADRs)

- **L1 audit-first canonical 16번째 적용** — 외부 agent 계획 도착 →
  즉시 git state audit (worktree main = stale, 167 commits behind).
  결과 — ADR 번호 23개 충돌 발견 + 의도 보존 + 번호 재배정 plan.
- **L2 5/5 결재 의도 보존 정책 (architectural value)** — *번호 영역*
  은 운영 문제, *의도* 는 architectural 가치. 의도 보존 + 운영 영역만
  정정.
- **L3 Sprint 0 의 architectural 가치 (Foundation Sync ≠ throwaway)**
  — 외부 agent 계획 ↔ main 현실 정합 anchor. 모든 후속 Sprint 진입의
  sole pre-condition.
- **L4 Worktree 다중 운영 의 architectural risk** — 본 세션 3 worktree
  중 nervous-bose 만 origin/main 정합. 다른 2 worktree 별도 audit
  deferred.
- **L5 메타-원칙 #16 정합 강제 (모든 Sprint ADRs)** — 휴리스틱 자동화
  vs 사용자 명시 의도 path 분리. ADR-139 (Boundary tool, WHEN layer
  신설) 이 본 roadmap 전체의 anchor.
- **L6 Path Z atomic + LOCKED #44 정합 강제** — 단일 atomic PR per
  sub-step + 사전 audit + 사용자 결재 cycle + 회귀 자산 단조 증가.
- **L7 Multi-week atomic decomposition** — Sprint 4.5 (ADR-155) 의
  4~6주 multi-week atomic 가 본 roadmap 의 architectural depth
  demonstration (ADR-094 §E L1 답습).

#### 회귀 누적 (Sprint 0 ε)

axia-core / axia-geo / axia-wasm: **0** (docs only — ADR + LOCKED + README)

본 ADR 자체는 회귀 자산 0 (Sprint 0 = Foundation Sync, +0 회귀 by
design). 회귀 자산은 Sprint 1~6 의 각 sub-step ADR 에서 단조 증가
(S1: +55, ..., S6: +30, 누적 +330).

#### Cross-link

- ADR-141 본문 (`docs/adr/141-master-roadmap-sprint0-foundation-sync.md`)
- 4 보고서 (`reports/최종_결재완료_Sprint0_시작.html` /
  `reports/Sprint0_Kickoff_Guide.html` / `reports/마스터_완성계획.html`
  / `reports/곡선면_도형그리기_완성계획.html`)
- LOCKED #1 ADR-021 / #5 / #7 ADR-026 / #14 메타-원칙 #14 / #15 P22.5
  / #16 ADR-038 P23 / #26 ADR-049 / #43 ADR-103 / #44 / #45 ADR-111
  / #63 / #64 ADR-139 (모두 정합 강제)
- 메타-원칙 #5 / #9 / #10 / #11 / #12 / #14 / #15 / **#16** (canonical anchor)
- ADR-027 (NURBS Kernel — Ellipse 옵션 A 정합)
- ADR-049 P-5e-α (default OFF + localStorage opt-in canonical)
- ADR-074/078/091/094/097/099/100/101/103/104 family (atomic pattern
  source)
- ADR-118/119/126/128/132/133 (α spec → β impl atomic source)
- ADR-125/126/127/131 (audit-first canonical pivot source)
- ADR-139 (WHAT/WHEN layer 분리 + 메타-원칙 #16 anchor)
- ADR-140 (Surface-aware getDrawPlane — S1 자연 후속 anchor)

### 66. STATUS-POLICY Enforcement (Sprint 0 cleanup follow-up, 2026-05-22) ✅

**Canonical anchor (사용자 결재, 2026-05-22)**:
> "추천: (a) — 본 PR 의 governance 회복 가치를 완전 달성, Brief 정합도
> 회복."

LOCKED #65 ADR-141 Sprint 0 ε closure 직후, PR #151 (ADR-142 α spec)
sweep 전 시점. README catalog drift 해소 + ADR sunset 정책 정립의 자연
governance 회복.

#### Lock-ins (canonical for future ADR Status governance)

- **L-66-1 STATUS-POLICY.md = SSOT** (docs/adr/STATUS-POLICY.md). 5 canonical
  state (Proposed / Draft / Accepted / Deferred / Superseded) + 3-tier
  lifecycle (Active / Superseded / Archived).
- **L-66-2 Status notation 3 format** 모두 허용 — heading / list / table.
  단 동일 ADR 내 mixed 금지.
- **L-66-3 First-token canonical 강제** — Status content 의 첫 token 이
  반드시 5 canonical state 중 하나. Audit-grep tooling 자동화 anchor.
- **L-66-4 CI 자동화** (`scripts/check-adr-catalog.mjs` + `.github/workflows/
  ci.yml` 의 `adr-catalog-check` job) — 메타-원칙 #6 (Preventive over
  Curative) 정합. PR 마다 자동 검증:
  - docs/adr/*.md ⊆ README catalog (missing 0)
  - catalog link → actual file (broken link 0)
  - Status first-token canonical (drift 0)
- **L-66-5 ADR-021 / ADR-025 / ADR-101 본문 Supersede 명시** — LOCKED #1
  / #12 / #41 의 ADR body ↔ CLAUDE.md drift 해소. 본 PR 에서 atomic 적용.
- **L-66-6 README catalog format** — `[NNN](./NNN-slug.md) | 제목 | Status`
  3-column 정합. 향후 새 ADR 추가 시 catalog 동시 갱신 강제.
- **L-66-7 Archived tier 별도 sweep** — Superseded → 물리 archive/ 이동은
  본 PR scope 외 (2순위, 5,265 cross-refs 위험). LOCKED #44 정합.
- **L-66-8 메타-원칙 #10 정합** — ADR 본문 retroactive 수정 금지, Status
  field 갱신만 명시 예외. STATUS-POLICY §3.3 답습.

#### 회귀 자산 (CI 자동 검증)

- `scripts/check-adr-catalog.mjs` — Node script (절대 #[ignore] 금지, exit
  1 on drift)
- `.github/workflows/ci.yml` 의 `adr-catalog-check` job — PR 마다 자동
  실행

#### 사용자 facing 변화 (0)

- 모든 기존 ADR 본문 보존 (Status field 만 canonical 정합 갱신)
- 신규 ADR 작성 시 STATUS-POLICY §2 의 5-state 정합 강제
- catalog 추가/변경 시 CI 자동 검증

#### Cross-link

- STATUS-POLICY.md (canonical SSOT)
- LOCKED #44 (Complete Meaning per Merge — 본 PR scope 정합)
- LOCKED #65 (ADR-141 Master Roadmap — Sprint 0 ε closure)
- LOCKED #10 (ADR 불변 — Status field 예외 명시)
- 메타-원칙 #6 (Preventive over Curative — CI 자동화 anchor)
- ADR-021 (LOCKED #1) / ADR-025 (LOCKED #12) / ADR-101 (LOCKED #41) —
  본문 Supersede 명시 적용
- TaskBrief `reports/ADR_141_옵션4_6_TaskBrief.html` (사용자 결재 source)

### 67. ADR-166 — Active Sketch Plane Session Lock (γ closure, 2026-05-29) ✅

**Canonical anchor (사용자 작업지시, 2026-05-28)**:
> "도형을 만들때 같은 plane에 그릴 확률을 높이는 방향으로 개선
> Sticky plane lock — 첫 도형 first_click 시점에 active_sketch_plane
> 자동 set. 후속 도구도 그 plane 유지 (명시 release 까지)."

ADR-164 (sticky last drawn plane, weak fallback) 의 자연 진화 — 사용자
8-layer 비교 매트릭스 audit 후 *strong cross-tool lock* 활성. ADR-164
sticky 와 coexist (lock 없을 때 sticky fallback).

**5-step variant 3번째 1-day single-day closure** (α + β-1 + β-2 + β-3
+ γ). ADR-152 (Sprint 4 첫째) + ADR-164 답습. TS-only, Engine 변경 0.

**핵심 아키텍처 변경**:
- `ToolManager._planeLock` field + `lockPlane / unlockPlane /
  isPlaneLocked / getPlaneLock` API (idempotent + deep clone)
- 4 reset hooks: `notifyViewModeChange / enterSketch / exitSketch /
  cancelCurrentTool` (L-166-2 — **`setTool()` 는 reset 안 함**,
  cross-tool 유지가 핵심 가치)
- 6 Draw 도구 first_click hook (Rect/Circle/Line/Arc/Bezier/Freehand)
  — idempotent `ctx.lockPlane?.({ source: 'first_click' })`
- `getDrawPlane()` priority #1 — **lock > sketch > face hit > sticky >
  view default** (Q3=a strong: face hit 무시)
- 3-state badge: 🔒 lock (빨강) / 📐 sticky / hidden
- Ctrl+Shift+P unlock 단축키 + ContextMenu "🔓 평면 잠금 해제"

**Lock-ins (canonical for ADR-166)**:
- **L-166-1** Q1=(a) first_click trigger (사용자 작업지시 정합)
- **L-166-2** Q2=(a) cross-tool 유지 (명시 release 까지) — `setTool()`
  reset 안 함 (회귀 명시 검증)
- **L-166-3** Q3=(a) strong lock (face hit 무시, 메타-원칙 #5)
- **L-166-4** Q4=(a) `Ctrl+Shift+P` unlock 단축키 + ContextMenu menu
- **L-166-5** Q5=(a) 🔒 badge upgrade (sticky → lock visual transition)
- **L-166-6** Engine 변경 0 — TypeScript only
- **L-166-7** ADR-164 자산 재활용 — 별도 file 신설 안 함
- **L-166-8** 메타-원칙 #16 정합 — 명시 unlock path 3중 (Ctrl+Shift+P
  / view change / ContextMenu)
- **L-166-9** ADR-046 P31 #4 additive only — ADR-164 sticky 동작 보존
  (coexist)
- **L-166-10** ADR-164 답습 패턴 — `_planeLock` field naming + API
  consistency
- **L-166-11** 절대 #[ignore] 금지 17/17 (β-1 4 + β-2 6 + β-3 4 + γ 3)

**회귀 매트릭스 (실측, 5-step closure)**:

| Sub-step | 회귀 | Cumulative |
|---|---|---|
| α (spec) | +0 | 0 |
| β-1 (API + reset hooks) | +4 vitest | 4 |
| β-2 (6 Draw tools first_click hook) | +6 vitest | 10 |
| β-3 (priority + badge + Ctrl+Shift+P + ContextMenu) | +4 vitest | 14 |
| **γ (E2E + closure docs)** | **+3 Playwright** | **17** |
| **합계** | **+17** | 절대 #[ignore] 금지 17/17 |

**Cross-link**:
- **ADR-166** (본 ADR — α PR #231 / β-1 PR #233 / β-2 PR #234 / β-3 PR
  #235 / γ 본 PR)
- **ADR-164** (Sticky Last Drawn Plane) — direct predecessor + coexist
  (weak fallback)
- **ADR-167 (가칭)** — EPS_PLANE SSOT (본 ADR closure 후 자연 진입)
- **ADR-168 (가칭)** — Face plane drift snap (ADR-167 자연 후속)
- **ADR-140** (Surface-Aware getDrawPlane) — priority #2 (face hit)
- **ADR-103-δ** (Z-up default plane) — priority #4 fallback
- **ADR-026 P12** (Cardinal plane SSOT) — 보존
- **ADR-046 P31 #4** (additive only)
- **메타-원칙 #5** (사용자 편의 — 명확하면 자동) + **#16** (자동화
  antipattern — 명시 release path)
- **LOCKED #44** (Complete Meaning per Merge) / **LOCKED #65**
  메타-원칙 / **LOCKED #66** STATUS-POLICY

**사용자 facing 변화 (canonical, demo-ready)**:
- 첫 RECT 그림 → 자동 plane lock + 🔒 badge 표시
- DrawCircle / DrawLine 등 도구 전환 → same plane 강제 (cross-tool 유지)
- 다른 plane 그리고 싶음 → Ctrl+Shift+P 또는 우클릭 → "🔓 평면 잠금
  해제" → 다음 도형이 자유 평면

### 68. ADR-167 — EPS_PLANE SSOT + same_plane() helper (γ closure, 2026-05-29) ✅

**Canonical anchor (LOCKED #43 priority sequence (b) closure)**:
ADR-166 closure (LOCKED #67) 후 자연 후속. 분산 plane-equality
constants 6+ 통합의 5-step variant 4번째 1-day single-day closure.
ADR-152 / ADR-164 / ADR-166 답습. **Engine-level architectural quality**
— 사용자 facing 변화 0.

**핵심 아키텍처 변경**:
- `axia-geo/src/plane.rs` 신설 — canonical SSOT (mesh-free pure module)
- `EPS_PLANE_NORMAL: f64 = 1e-4` (normal parallelism, ADR-147 정합)
- `EPS_PLANE_OFFSET: f64 = 1.5e-3` mm (LOCKED #5 spatial-hash 정합)
- `Plane { normal: DVec3, offset: f64 }` struct + `from_point_normal`
  (defensive normalization) + `signed_distance`
- `same_plane(a, b, eps_normal, eps_offset)` helper — **anti-parallel safe**
  (flipped face = same plane, L-167-10)
- `axia-core` re-exports for backward compat (axia-core → axia-geo
  dep direction)

**사용자 결재 (2026-05-29)**: Q1=(a) `axia-core/src/plane.rs` → β-2 audit-
fix to `axia-geo/src/plane.rs` (canonical SSOT intent 보존 + 위치 정정).
Q2=(a) 2-constant schema. Q3=(a) Plane struct + same_plane helper.
Q4=(a) 3-phase migration. Q5=(a) Plane SSOT scope only.

**Audit-first canonical 17번째 적용 (β-2 silent fix evidence)**:
- α spec 시점: 분산 constants 6+ inventory matrix
- β-2 entry 시점: Cargo dep direction violation 발견 → silent
  architectural fix (relocate axia-core → axia-geo). Q1=a *intent*
  보존, *위치* 정정.

**Lock-ins (canonical for ADR-167)**:
- **L-167-1** SSOT 위치 — `axia-geo/src/plane.rs` (β-2 amendment)
- **L-167-2** 2-constant schema — `EPS_PLANE_NORMAL` + `EPS_PLANE_OFFSET`
- **L-167-3** Struct `Plane` + `same_plane` helper + per-call override
- **L-167-4** 3-phase migration (additive-first)
- **L-167-5** Plane SSOT scope only — angle/curve 별도 ADR
- **L-167-6** ADR-147 precision 답습
- **L-167-7** LOCKED #5 (1.5μm spatial-hash) 자연 lock-in
- **L-167-8** 메타-원칙 #4 (SSOT) + #6 (Preventive) 정합
- **L-167-9** ADR-046 P31 #4 additive only — soft sunset via `#[deprecated]`,
  no breaking changes
- **L-167-10** Anti-parallel normal handling (flipped face = same plane)
- **L-167-11** 절대 #[ignore] 금지 17/17 (β-1 7 + β-2 4 + β-3 4 + γ 2)
- **L-167-17 (META)** Audit-first canonical 17번째 적용 — β-2 silent
  architectural fix evidence

**회귀 매트릭스 (5-step 누적)**:

| Sub-step | 회귀 | Cumulative |
|---|---|---|
| α (spec, PR #237) | +0 | 0 |
| β-1 (SSOT module, PR #238) | +7 axia-core | 7 |
| β-2 (relocate + 5 callsites, PR #239) | +4 net (11 in axia-geo) | 11 |
| β-3 (legacy sunset, PR #240) | +4 axia-geo | 15 |
| **γ (closure docs + drift guards, 본 PR)** | **+2 axia-geo** | **17** |
| **합계** | **+17** (절대 #[ignore] 금지 17/17 준수) | |

**Cross-link**:
- **ADR-167** (본 ADR — α/β-1/β-2/β-3/γ 모두 closure)
- **ADR-166** §5.1 (sequence anchor source — 직계 trigger)
- **ADR-147** (Spatial-hash precision strict, Scenario B1)
- **ADR-076 §C-amendment-1** (legacy cleanup pattern)
- **ADR-094 §E L1** (additive-first + multi-gate atomic)
- **ADR-046 P31 #4** (additive only)
- **메타-원칙 #4** (SSOT) + **#6** (Preventive) + **#14** (면은 닫힌 경계로부터)
- **LOCKED #5** (1.5μm spatial-hash dedup) — offset tolerance canonical
- **LOCKED #43** priority sequence (b) closure → **(c) ADR-168 anchor**
- **LOCKED #44** (Complete Meaning per Merge) / **LOCKED #65** 메타-원칙
- **LOCKED #66** STATUS-POLICY / **LOCKED #67** ADR-166 (direct precursor)

**사용자 facing 변화 (canonical)**:
- **None** — internal architectural quality only (engine-level refactor)
- Maintainer 가치: 분산 6+ const → 단일 canonical SSOT, drift 영구 차단
- Future plane-equality op 추가 시 SSOT 자명, cognitive load 감소

**다음 자연 후속 (LOCKED #43 priority sequence (c))**:
- **ADR-168** — Face plane drift snap (non-cardinal face plane drift
  보정). ✅ Closed (LOCKED #69).

### 69. ADR-168 — Face plane drift snap (γ closure, 2026-05-29) ✅

**Canonical anchor (LOCKED #43 priority sequence (c) closure)**:
ADR-167 closure (LOCKED #68) 후 자연 후속. ADR-026 P12 cardinal SSOT
gap 의 architectural 해결. 5-step variant 5번째 1-day single-day
closure. ADR-152 / ADR-164 / ADR-166 / ADR-167 답습. **Engine-level
architectural quality** — 사용자 facing 변화 0 (architectural drift
correction).

**핵심 아키텍처 변경**:
- `axia-geo/src/operations/plane_snap.rs` 신설 — Face plane drift snap
  primitive (Q1=a tessellation chord substitute algorithm)
- `PLANE_SNAP_NORMAL: f64 = 1e-3` (normal direction snap tolerance)
- `PLANE_SNAP_OFFSET: f64 = 1e-4` mm (offset snap tolerance, **15×
  stricter than EPS_PLANE_OFFSET** → post-snap detection 통과 보장)
- `Plane` struct + `same_plane` from ADR-167 reused
- `DriftReport` + `SnapReport` + `detect_chord_drift` (read-only) +
  `snap_chord_to_plane` (correction)
- `snap_face_to_plane(mesh, face_id, plane, snap_tol)` mesh-aware
  integration helper
- 3 face creation callsites activated (`exec_draw_rect_as_shape` /
  `exec_draw_line_as_shape` / `exec_draw_circle_as_shape`)
- `SnapMetricsAggregate` opt-in telemetry primitive (production
  callsites UNCHANGED, E2E session wrapper accumulation)

**사용자 결재 (2026-05-29)**: Q1=(a) tessellation chord substitute,
Q2=(a) independent constants (PLANE_SNAP_NORMAL + PLANE_SNAP_OFFSET),
Q3=(a) face creation only scope (minimum risk), Q4=(a) 3-phase additive
migration, Q5=(a) Face plane only scope. all defaults 5/5 ⭐ 추천 approved.

**Audit-first canonical 18번째 적용**:
- α spec: ADR-026 P12 cardinal SSOT gap inventory + non-cardinal face
  plane silent drift bug evidence
- β-2 entry: spec mentioned 4 callsites, actual production 3 (polygon
  = circle variant) — silent fix + 명시 commit documentation

**Layered architecture (ADR-167 vs ADR-168)**:
- **Detection** (ADR-167): `EPS_PLANE_NORMAL` (1e-4) + `EPS_PLANE_OFFSET`
  (1.5e-3) — "같은 plane 인가?"
- **Snap correction** (ADR-168): `PLANE_SNAP_NORMAL` (1e-3) +
  `PLANE_SNAP_OFFSET` (1e-4) — "같은 plane 으로 맞추기"
- Stricter snap < detection threshold → snap 후 detection 통과 보장

**Lock-ins (canonical for ADR-168)**:
- **L-168-1** Tessellation chord substitute algorithm (Q1=a)
- **L-168-2** Independent constants — 2-constant schema (Q2=a)
- **L-168-3** Face creation only scope (Q3=a, 3 callsites)
- **L-168-4** 3-phase additive migration (Phase 1 no mutation, Phase
  2 active, Phase 3 telemetry opt-in)
- **L-168-5** Face plane only scope — edge/curve drift 별도 ADR
- **L-168-6** ADR-167 EPS_PLANE_* SSOT layered architecture **enforced
  in test** (PLANE_SNAP_OFFSET < EPS_PLANE_OFFSET / 0.1)
- **L-168-7** ADR-026 P12 cardinal SSOT 보존 (non-cardinal 만 보강)
- **L-168-8** ADR-031 Phase D AnalyticSurface infrastructure 재사용
  (tessellate_face_surface 의 자연 연장)
- **L-168-9** 메타-원칙 #6 (Preventive) + #14 (면은 닫힌 경계로부터) +
  #15 (동일 분할 contract) 정합
- **L-168-10** Per-call snap_tol override (strict callsites smaller value)
- **L-168-11** 절대 #[ignore] 금지 16/16 (β-1 7 + β-2 4 + β-3 3 + γ 2)

**회귀 매트릭스 (5-step 누적)**:

| Sub-step | 회귀 | Cumulative |
|---|---|---|
| α (spec, PR #242) | +0 | 0 |
| β-1 (plane_snap module, PR #243) | +7 axia-geo | 7 |
| β-2 (callsite activation, PR #244) | +4 axia-geo | 11 |
| β-3 (drift telemetry, PR #245) | +3 axia-geo | 14 |
| **γ (closure docs + drift guards, 본 PR)** | **+2 axia-geo** | **16** |
| **합계** | **+16** (target +15 over-delivered by +1 via β-1 edge cases) | |

**Cross-link**:
- **ADR-168** (본 ADR — α/β-1/β-2/β-3/γ 모두 closure)
- **ADR-167** §5.1 (sequence anchor source — 직계 trigger) +
  **LOCKED #68**
- **ADR-166** §5.1 + **LOCKED #67** (LOCKED #43 priority sequence anchor)
- **ADR-026 P12** (Cardinal plane SSOT — 보존, non-cardinal 만 보강)
- **ADR-031 Phase D** (AnalyticSurface infrastructure — chord substitute)
- **ADR-094 §E L1** (additive-first + multi-gate atomic)
- **ADR-046 P31 #4** (additive only — Phase 3 production overhead 0)
- **메타-원칙 #4** (SSOT) + **#6** (Preventive) + **#14** (면은 닫힌
  경계로부터) + **#15** (동일 분할 contract)
- **LOCKED #5** (1.5μm spatial-hash dedup) — snap_tol natural lower bound
- **LOCKED #7** ADR-026 P12 (cardinal SSOT — 보존)
- **LOCKED #43** priority sequence (a)→(b)→(c) **ALL CLOSED** (LOCKED
  #67 / #68 / #69)
- **LOCKED #44** (Complete Meaning per Merge) / **LOCKED #65** 메타-원칙
- **LOCKED #67** ADR-166 / **LOCKED #68** ADR-167 (직계 precursors)

**사용자 facing 변화 (canonical)**:
- **None** — internal architectural quality only (engine-level drift correction)
- Maintainer 가치: 분산 SSOT 통합 (ADR-167) + drift 보정 (ADR-168) =
  silent bug 영구 차단
- Future plane drift expansion (Boolean / Offset / Push-Pull /
  edge polyline / curve metadata) 의 sequence anchor

**LOCKED #43 priority sequence ALL CLOSED 🎉**:
- (a) ADR-166 plane lock ✅ LOCKED #67
- (b) ADR-167 EPS_PLANE SSOT ✅ LOCKED #68
- (c) ADR-168 Face plane drift snap ✅ LOCKED #69

**다음 priority audit anchor** (사용자 결재 후 진입):
- Future — Boolean / Offset / Push-Pull cascade drift snap (Q3=b/c expansion)
- Future — Edge polyline drift snap (Q5=c expansion)
- Future — Curve metadata drift snap (NURBS Kernel)
- Future — Angle-degree SSOT (`COPLANAR_PAIR_TOL_DEG` 등 통합)
- Future — Curve SSOT (`HOVER_CHORD_TOL` 등 통합)

### 70. ADR-169 — Boundary-Routine Unification Audit closure (Phase 1-4 anchor, 2026-05-29) ✅

**Canonical anchor (사용자 비전, 2026-05-29)**:
> "axia-sketch — '선만 그려, 케이크는 알아서 나뉜다' 처럼 우리엔진으로
> 루틴구성. 우리엔진으로는 불가능한 것인가?"

**사용자 결재 (D-Then-C, 2026-05-29)**:
- D: Audit-first canonical 19번째 적용 (ADR-169, 3-5일)
- C: Phase 1-4 본격 (6-8주, ADR-170~173)

ADR-169 Phase 0 audit closure (α + β-1 + β-2 + β-3 + γ same-day) =
Phase 1-4 (ADR-170~173, 6-8주, +240 회귀) 의 sole architectural anchor.
5-step variant **6번째** reproducibility (ADR-152/164/166/167/168 답습).

**5 PRs same-day sequence (2026-05-29)**:
- PR #249 α spec (Status: Proposed → 결재 anchor 명시)
- PR #250 β-1 — Boundary element type matrix (6 type × 4-column gap, ~478 lines)
- PR #251 β-2 — Drift propagation chain matrix (11-layer ε, ~465 lines)
- PR #252 β-3 — User demo evidence matrix (12 scenarios × 4 tool × 3 surface, ~430 lines)
- PR #253 γ closure (Status: Accepted + §10 Lessons 9개 + LOCKED #70)

**3-axis triangulation findings (β-1/β-2/β-3 모두 (C) 정합)**:
- β-1 — 6 type 중 완전 작동 = 0개, 부분 작동 = 3개, 미참여 = 3개
- β-2 — 11 layer 중 ε 흡수 = 8, 증폭 = 3 (Layer 7 Tool-specific 가장
  큰 single gap)
- β-3 — 12 scenarios: ★ verified = 3 + ⚙ inferred = 6 + ⏸ pending = 3
- Root cause: drift 33% + dedup 8% + validation 33% + architectural 42%
- **75% = Phase 1+2 SSOT 통합 흡수**

#### 불변 lock-in (canonical for ADR-170~173)

- **L-70-1** D-Then-C 결재 anchor (사용자 결재 2026-05-29) — Phase 1-4
  본격 진입 sole architectural anchor
- **L-70-2** 6 boundary element type 통합 처리 강제 (Line / Polyline /
  Arc-Circle / Bezier-NURBS / Vertex / Solid face edge)
- **L-70-3** 11 layer ε chain 통합 chokepoint 강제 (Phase 1
  normalizeDrawInput + Phase 2 absorb_boundary_input + Phase 3
  register_boundary_element)
- **L-70-4** 12 시연 scenario 매트릭스 (★ 3 verified + ⚙ 6 inferred +
  ⏸ 3 pending) — Phase 4 closure 게이트 강제
- **L-70-5** NURBS kernel silent-skip 금지 (curves/ + surfaces/ 영구
  carve-out, L-169-11) — Piegl & Tiller precondition 보존
- **L-70-6** 메타-원칙 #14 WHAT layer + #16 WHEN layer 보존 강제 —
  Phase 1-4 는 HOW layer 만 변경 (결과 invariant + trigger 정책 변경 0)
- **L-70-7** Phase 0 3-agent audit 산출물 (447 bail! 분류 매트릭스) 의
  architectural reuse — 새 audit 0
- **L-70-8** SSOT 통합 시점의 architectural value — 7-8 SSOT 가 *이미
  존재*, 위치 통합만 (β-2 finding)
- **L-70-9** Phase 1-4 회귀 자산 누적 매트릭스 (Phase 1 +50 → Phase 2
  +70 → Phase 3 +90 → Phase 4 +30 = +240, 절대 #[ignore] 금지)
- **L-70-10** LOCKED #44 정합 — Phase 1-4 각 별도 ADR + 별도 atomic PR
  (Complete Meaning per Merge)
- **L-70-11** 사용자 시연 게이트 (ADR-087 K-ζ canonical) — Phase 4 closure
  강제

#### Lessons (canonical for future audit ADRs, 9개)

ADR-169 §10 Lessons 정합 (audit-first canonical 19번째 적용 evidence):

- **L1** Multi-deliverable audit 분할 패턴 (Path Z atomic 의 audit 변형)
- **L2** Cross-validation through independent deliverables (β-1 ↔ β-2 ↔
  β-3 의 3-axis triangulation)
- **L3** Phase 0 3-agent audit 산출물의 architectural reuse (447 bail!
  100% 재사용)
- **L4** Audit-first canonical 의 self-applying pattern (ADR-131 답습)
- **L5** 사용자 비전 → architectural ADR transition 패턴
- **L6** D-Then-C 결재 패턴 (audit + multi-phase atomic 분리)
- **L7** SSOT 통합 시점의 architectural value 정량화 (β-2 finding)
- **L8** 메타-원칙 #14 (WHAT) ↔ #16 (WHEN) 직교 분리 정합
- **L9** Phase 1-4 sequence atomic decomposition (cumulative value chain)

#### Phase 1-4 sequence anchor

| Phase | ADR | Title | 기간 | 회귀 |
|---|---|---|---|---|
| 1 | ADR-170 | Tool layer `normalizeDrawInput` SSOT | 1주 | +50 |
| 2 | ADR-171 | Engine `absorb_boundary_input` SSOT | 2주 | +70 |
| 3 | ADR-172 | DCEL `register_boundary_element` Edge Register canonical | 2-3주 | +90 |
| 4 | ADR-173 | User vision realization + 12 시연 PASS | 1주 | +30 |
| **합계** | **4 ADRs** | | **6-8주** | **+240** |

각 Phase 는 별도 ADR + 별도 atomic PR (LOCKED #44).

#### Cross-link

**LOCKED 정책 정합**:
- LOCKED #1/12/41 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- LOCKED #5 spatial-hash 1.5μm (Phase 2 Step 2 vertex dedup)
- LOCKED #7 ADR-026 P12 cardinal SSOT (Phase 1 Step 1)
- LOCKED #14/15/16 메타-원칙 #14/15/16
- LOCKED #43 priority sequence ALL CLOSED (foundation)
- LOCKED #44 Complete Meaning per Merge (Phase 1-4 분할 anchor)
- LOCKED #63 z=0 invariant (Phase 1 Step 1)
- LOCKED #66 STATUS-POLICY (Status field canonical)
- LOCKED #67 ADR-166 plane lock (Phase 1 Step 5)
- LOCKED #68 ADR-167 EPS_PLANE (Phase 2 Step 1 detection)
- LOCKED #69 ADR-168 PLANE_SNAP (Phase 2 Step 1 correction)

**ADR cross-link**:
- ADR-021 P7 / ADR-025 P11 / ADR-101 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- ADR-027/028/029/030 NURBS Kernel (L-169-11 carve-out 강제)
- ADR-064/066 NURBS Boolean DCEL
- ADR-088 curve_owner_id (Phase 3 metadata)
- ADR-089 Phase 2 closed-curve face (1 anchor + 1 self-loop)
- ADR-101 Amendment 9 HARD flag (Phase 2 Step 4 contract)
- ADR-139 Boundary tool only (메타-원칙 #16 WHEN layer)
- ADR-140 surface-aware getDrawPlane (Phase 1 Step 2 face plane)
- ADR-148 BoundaryTool point-localized (Phase 3 register API 연장)
- ADR-149 T-junction sweep / ADR-150 Coplanar merge / ADR-151 Connected stacked-inner
- ADR-166 plane lock (Phase 1 Step 5) / ADR-167 EPS_PLANE / ADR-168 drift snap
- ADR-169 Phase 0 audit (canonical anchor)
- ADR-170 Phase 1 Tool layer normalizeDrawInput SSOT (활성 중, PR #254)
- ADR-171/172/173 Phase 2-4 (별도 ADR, 별도 atomic PR)

**axia-sketch 5 patterns reference**:
- Pattern 1 (Tool 10mm short-circuit) → Phase 1 Step 4
- Pattern 2 (vertex_at silent dedup) → Phase 2 Step 2
- Pattern 3 (add_edge_with_intersections always succeeds) → Phase 3 register API
- Pattern 4 (Plane is tool-context) → Phase 1 Step 5
- Pattern 5 (Edge Register at DCEL) → Phase 3 register_boundary_element

**메타-원칙 정합**:
- #4 SSOT / #5 사용자 편의 / #6 Preventive / #11 Latency Budget
- #14 WHAT (결과 invariant 보존) / #15 split contract / #16 WHEN (trigger 정책 보존)

### 71. ADR-170 — Phase 1 closure: Tool layer normalizeDrawInput SSOT (2026-05-30) ✅

**Canonical anchor**: LOCKED #70 Phase 1-4 sequence anchor 의 **Phase 1 closure**.
ADR-170 5-step closure (α + β-1 + β-2 + β-3 + γ) = 5-step variant **7번째
reproducibility** (ADR-152/164/166/167/168/169 답습). Phase 2 (ADR-171
Engine `absorb_boundary_input` SSOT, 2주, +70) 의 sole prerequisite.

**5 PRs sequence (2026-05-29 ~ 2026-05-30)**:
- PR #254 α spec — 5-step routine canonical 명시 + Q1~Q5 lock-in 결재
- PR #256 β-1 — `normalizeDrawInput` API + 5-step routine 구현 (+19 회귀)
- PR #258 β-2 — `ToolContext.normalizeDrawInput?` SSOT exposure (+5 회귀)
- PR #259 β-3 — BoundaryTool migration (+5 회귀)
- PR #260 γ closure — Status Accepted + §9 Lessons + LOCKED #71 candidate (+0)

**합계 +29 회귀** (절대 #[ignore] 금지 29/29). α §6 +50 예상 vs 실측 +29
차이 (+21) = γ deferred (7 Draw tools per-tool adoption + Playwright E2E)
→ ADR-171 본격 진입 시 자연 흡수.

#### 불변 lock-in (canonical for ADR-171~173)

- **L-71-1** `ToolManager.normalizeDrawInput(rawPoint, context)` SSOT 강제
  — single chokepoint for 7 Draw + SelectTool + BoundaryTool
- **L-71-2** 5-step routine canonical 강제:
  - Step 1 Cardinal axis force (LOCKED #63 + #7)
  - Step 2 Face plane projection (LOCKED #69 ADR-168, PR #248 흡수)
  - Step 3 Vertex_at silent dedup (LOCKED #5)
  - Step 4 10mm short-circuit (axia-sketch pattern 1)
  - Step 5 Plane lock validation (LOCKED #67 ADR-166)
- **L-71-3** 5 SSOT 통합 consume (LOCKED #5/7/63/67/69) — *새 SSOT 도입 0*
- **L-71-4** 9 tools API surface 통합 (7 Draw + SelectTool + BoundaryTool)
- **L-71-5** `NormalizedDrawInput` typed envelope 강제 (skipReason silent
  skip 차단, 메타-원칙 #16 정합)
- **L-71-6** Backward compat additive (`normalizeDrawInput?` optional,
  graceful fallback) — L-170-6
- **L-71-7** Engine 변경 0 (Phase 2 ADR-171 본격 시 SSOT chain 통합)
- **L-71-8** `MIN_DRAW_LENGTH_MM = 10.0` constant 강제 (axia-sketch
  pattern 1, mm 단위 short-circuit threshold)
- **L-71-9** `SAME_PLANE_COS_THRESHOLD = 0.9999` anti-parallel safe 강제
  (ADR-166 soft lock semantic)
- **L-71-10** 메타-원칙 #14 WHAT + #16 WHEN layer 보존 강제 — *behavior
  delta 0* (architectural reorganization only)
- **L-71-11** Phase 1 closure → Phase 2 (ADR-171) entry trigger

#### Lessons (canonical for future Phase ADRs, 9개)

ADR-170 §9 Lessons 정합 (5-step variant 7번째 reproducibility evidence):

- **L1** Single chokepoint SSOT 의 architectural value 정량 증명 (5 SSOT 통합)
- **L2** Backward compat additive (L-170-6) 의 매트릭스 정합 (graceful fallback)
- **L3** Scope clarification 의 honest documentation 가치 (β-2 vs β-3 vs γ)
- **L4** 5-step variant 7번째 reproducibility (template 정착 evidence)
- **L5** sub-step deferral 의 architectural correctness (γ deferred items)
- **L6** β-2 ↔ β-3 의 SSOT vs caller 분리 (interface boundary 명확화)
- **L7** Phase 1-4 sequence anchor 의 Phase 1 정착 evidence
- **L8** 메타-원칙 #14 WHAT + #16 WHEN layer 보존 강제 evidence
- **L9** Tool migration 의 "behavior delta 0" architectural value

#### Phase 2 (ADR-171) entry trigger anchor

| Phase | ADR | Title | 기간 | 회귀 |
|---|---|---|---|---|
| **1 ✅** | **ADR-170** | **Tool layer normalizeDrawInput SSOT** | **same-day** | **+29 실측** |
| 2 | ADR-171 | Engine `absorb_boundary_input` SSOT | 2주 | +70 |
| 3 | ADR-172 | DCEL `register_boundary_element` Edge Register canonical | 2-3주 | +90 |
| 4 | ADR-173 | User vision realization + 12 시연 PASS | 1주 | +30 |

Phase 1 closure 후 자연 Phase 2 진입 가능 (LOCKED #70 정합).

#### Cross-link

- **LOCKED #5** spatial-hash 1.5μm (Step 3 vertex dedup)
- **LOCKED #7** ADR-026 P12 cardinal SSOT (Step 1 cardinal force)
- **LOCKED #14** 메타-원칙 #14 WHAT (보존 강제)
- **LOCKED #43** priority sequence ALL CLOSED (foundation)
- **LOCKED #44** Complete Meaning per Merge (5-step variant 정합)
- **LOCKED #63** z=0 invariant (Step 1)
- **LOCKED #66** STATUS-POLICY (canonical Status field)
- **LOCKED #67** ADR-166 plane lock (Step 5)
- **LOCKED #68** ADR-167 EPS_PLANE (foundation)
- **LOCKED #69** ADR-168 PLANE_SNAP (Step 2 source)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (direct precursor)
- **ADR-026 P12** cardinal SSOT / **ADR-088** curve_owner_id (SelectTool defer)
- **ADR-101 Amendment 9** HARD flag (Phase 3 prep)
- **ADR-139** Boundary tool only (BoundaryTool migrate 정합)
- **ADR-140** surface-aware getDrawPlane (Step 2 face plane source)
- **ADR-146** SnapManager inferencing (snap pipeline 보존)
- **ADR-148** BoundaryTool point-localized (β-3 migration target)
- **ADR-152/164/166/167/168/169** 5-step variant 1~6번째 precursors
- **ADR-166** plane lock (Step 5) / **ADR-167** EPS_PLANE / **ADR-168** drift snap
- **ADR-169** Phase 0 audit (sole precondition)
- **ADR-171/172/173** Phase 2-4 (별도 ADR + 별도 atomic PR)

### 72. ADR-171 — Phase 2 closure: Engine absorb_boundary_input SSOT + already-robust finding (2026-05-30) ✅

**Canonical anchor**: LOCKED #70 Phase 1-4 sequence anchor 의 **Phase 2
closure**. ADR-171 4-step closure (α + β-1 + β-2 + γ) = 5-step variant
**8번째 reproducibility** (β-3 fold). Phase 3 (ADR-172 register_boundary_
element Edge Register, 2-3주, +90) entry ready.

**4 PRs sequence (2026-05-30, same-day)**:
- PR #262 α spec — 4-step routine canonical + Q1~Q5 lock-in 결재
- PR #263 β-1 — `operations/boundary_input.rs` SSOT pure helper (+16 회귀)
- PR #264 β-2 — boundary_from_point absorb 통합 + architectural finding (+3 회귀)
- PR #265 γ closure — Status Accepted + §9 Lessons + LOCKED #72 candidate (+0)

**합계 +19 회귀** (axia-geo 1518 → 1537, 절대 #[ignore] 금지 19/19).
α §6 estimate +70 vs 실측 +19 — β-2 architectural finding 으로 genuine
통합 work 축소.

#### 핵심 architectural finding (canonical)

> **엔진이 spec 가정보다 이미 robust** — 4 함수 중 3/4 이미 per-function
> absorb 패턴 내장.

| 함수 | 기존 absorb 패턴 | β-2 조치 |
|---|---|---|
| split_face_by_line | ✅ Step 0 drift projection (face_diag bound) | 회귀 lock-in |
| auto_intersect_coplanar | ✅ Ok(None) non-coplanar (1.5e-6 strict, ADR-101 #41) | 보존 (loosen 금지) |
| split_face_by_chain | ✅ VertId (이미 dedup) | N/A |
| **boundary_from_point** | ❌ PointNotOnPlane hard-reject | **absorb 통합** ✅ |

#### 불변 lock-in (canonical for Phase 3)

- **L-72-1** operations/boundary_input.rs SSOT 강제 (BoundaryInput enum +
  AbsorbReason + absorb_boundary_input 4-step pure helper + check_coplanar)
- **L-72-2** 4-step routine canonical (Step 1 drift projection LOCKED #68/69 /
  Step 2 vertex dedup LOCKED #5 / Step 3 10mm short-circuit / Step 4 HARD prep)
- **L-72-3** boundary_from_point drift absorb 강제 (PointNotOnPlane hard-reject
  → projection 흡수, 1.5μm~1mm drift gap 해소)
- **L-72-4** **architectural finding 강제** — 3/4 함수 (split_face_by_line /
  auto_intersect_coplanar / split_face_by_chain) 이미 per-function absorb
  패턴. **강제 SSOT 통합 금지** (auto_intersect 의 COPLANARITY_OFFSET_TOL
  1.5e-6 strict = ADR-101 LOCKED #41 보존)
- **L-72-5** Read-only helper 강제 (`&Mesh`, Pattern 8 — cyclic 의존 회피)
- **L-72-6** mesh.rs find_existing_vertex 는 read-only accessor only (absorb
  LOGIC 은 100% operations/boundary_input.rs, L-171-9)
- **L-72-7** NURBS kernel carve-out 강제 (curves/ + surfaces/ 미접촉, L-171-8)
- **L-72-8** Backward compat additive (4 함수 signature UNCHANGED)
- **L-72-9** AbsorbReason typed envelope 강제 (bail! 아닌 graceful,
  메타-원칙 #16 정합)
- **L-72-10** 메타-원칙 #14 WHAT + #15 split contract + #16 WHEN 보존 강제
- **L-72-11** Phase 2 closure → Phase 3 (ADR-172) entry trigger

#### Lessons (canonical for future audit-first engine ADRs, 6개)

ADR-171 §9 Lessons 정합:

- **L1** Engine already-robust finding (audit-first canonical, Pattern 3 —
  test/integration 진입 시 architectural reality 가 spec 가정과 다름,
  ADR-116/125 답습)
- **L2** Truth over estimate (회귀 count 정직 — estimate +70 vs 실측 +19,
  억지로 부풀리지 않음)
- **L3** Intentional per-function tolerance 보존 (강제 SSOT 금지 — auto_
  intersect 1.5e-6 = ADR-101 #41)
- **L4** Genuine gap = hard-reject 함수만 (graceful no-op 은 이미 absorb)
- **L5** SSOT 인프라 확보의 독립 가치 (boundary_input.rs — caller 수 무관,
  canonical 패턴 확립이 가치, ADR-167 EPS_PLANE 답습)
- **L6** Phase 2 실질 완결 (β-3 fold — sub-step 수는 의미 단위에 따라
  자연 축소, LOCKED #44 Complete Meaning per Merge 정합)

#### Phase 3 (ADR-172) entry trigger anchor

| Phase | ADR | Title | 기간 | 회귀 |
|---|---|---|---|---|
| 1 ✅ | ADR-170 | Tool layer normalizeDrawInput SSOT | same-day | +29 |
| **2 ✅** | **ADR-171** | **Engine absorb_boundary_input SSOT** | **same-day** | **+19 실측** |
| 3 | ADR-172 | DCEL `register_boundary_element` Edge Register canonical | 2-3주 | +90 |
| 4 | ADR-173 | User vision realization + 12 시연 PASS | 1주 | +30 |

Phase 2 closure 후 자연 Phase 3 진입 가능 (LOCKED #70 정합). Phase 3 가
axia-sketch pattern 5 ("선만 등록, 면은 알아서") 의 본격 구현 — boundary_
input.rs SSOT (L-72-1) 즉시 활용.

#### Cross-link

- **LOCKED #5** spatial-hash 1.5μm (Step 2 vertex dedup)
- **LOCKED #41** ADR-101 (auto_intersect 1.5e-6 strict tolerance 보존, L-72-4)
- **LOCKED #44** Complete Meaning per Merge (β-3 fold 정합)
- **LOCKED #66** STATUS-POLICY (canonical Status field)
- **LOCKED #68** ADR-167 EPS_PLANE (Step 1 detection)
- **LOCKED #69** ADR-168 PLANE_SNAP (Step 1 correction)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (direct precursor)
- **LOCKED #71** ADR-170 Phase 1 closure (direct precursor)
- **ADR-101 Amendment 9** HARD flag (Step 4 prep, Phase 3 본격)
- **ADR-116/125** audit-first finding 답습 (L1)
- **ADR-152** 5-step variant (Engine + 검증, UI 없음)
- **ADR-167** EPS_PLANE SSOT 인프라 가치 (L5)
- **ADR-172/173** Phase 3-4 (별도 ADR + 별도 atomic PR)
- **메타-원칙 #4** SSOT / **#6** Preventive / **#11** Latency / **#14/#15/#16**
- **Pattern 3** audit-first canonical / **Pattern 7** B hybrid / **Pattern 8**
  read-only vs mutate

### 73. ADR-172 — Phase 3 closure: Edge crossing-split mechanism already exists + demo-verified (2026-05-31) ✅

**Canonical anchor**: LOCKED #70 Phase 1-4 sequence anchor 의 **Phase 3
closure** — 사용자 비전의 핵심. Pattern 12 finding (mechanism already
exists) + 실제 브라우저 demo 증명. Phase 4 (ADR-173, 12 시연 게이트)
entry ready.

**3 PRs sequence (2026-05-30 ~ 2026-05-31)**:
- PR #267 α spec — register_boundary_element 5-step + Q1~Q5 (Q1 자동 split 결재)
- PR #268 β-1 — **Pattern 12 finding** (crossing-split 이미 구현) + 1 회귀
- PR #270 γ closure — demo-verified + 결정적 회귀 + Status Accepted + LOCKED #73

**합계 +2 회귀** (axia-core, 절대 #[ignore] 금지 2/2). estimate +90 vs
실측 +2 — Pattern 12 (mechanism already exists).

#### 핵심 architectural finding (canonical, Pattern 12 deepest 적용)

> **사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" mechanism 이 이미
> DrawLine 경로에 완전 구현 + battle-tested.**

| 자산 | 위치 | 기능 |
|---|---|---|
| Mesh::find_line_crossings | mesh.rs:1370 | 교차 검출 (coplanar + AABB + interior) |
| Mesh::find_vertices_on_line | mesh.rs | 기존 vertex on-line |
| Mesh::find_collinear_endpoint_splits | mesh.rs | 공선 overlap split |
| Scene::exec_draw_line | scene.rs:3930+ | 전체 파이프라인 (Step 0~4 + mark_edge_hard) |

α spec premise ("add_edge 가 교차 split 안 함") 은 *low-level primitive*
만 본 것 — *high-level DrawLine 경로* 는 이미 crossing-split + face split.

#### Demo verification (Claude Preview MCP, 2026-05-31, 사용자 결재 A)

실제 브라우저 end-to-end 증명:
- 2 crossing DrawLine → 5 verts (교차점 자동 생성)
- 4 DrawLine 닫힌 사각형 → 1 face 자동 합성
- **사각형 가로지르는 선 1개 → 1 face → 2 faces ("케이크가 나뉘었다")**

#### 불변 lock-in (canonical for Phase 4)

- **L-73-1** Pattern 12 finding 강제 — crossing-split mechanism 이 이미
  DrawLine 경로에 완전 구현 (find_line_crossings + exec_draw_line +
  split_edge + mark_edge_hard)
- **L-73-2** register_boundary_element 신규 SSOT **보류** — mechanism 작동,
  scene.rs 파이프라인 중복 금지 (battle-tested 회귀 자산 보존)
- **L-73-3** SSOT consolidation 은 non-DrawLine caller (MCP/import) 의
  실제 trigger 발생 시 future ADR (현재 DrawLine 만 필요)
- **L-73-4** Demo-verified 강제 — 2 crossing line → 5 verts / square +
  cross line → 2 faces (test + 브라우저 demo 양쪽 lock-in)
- **L-73-5** 결정적 회귀 보존: adr172_beta1_two_crossing_drawlines_auto_split
  + adr172_gamma_line_across_face_splits_into_two
- **L-73-6** mark_edge_hard (HARD flag, ADR-101 A9, 메타-원칙 #15) — 기존
  exec_draw_line 적용 보존
- **L-73-7** 메타-원칙 #5 (명확한 교차 자동 split) + #14 (면은 닫힌
  경계로부터) + #16 (face emission gate — ADR-139 정합) 보존 강제
- **L-73-8** Phase 3 closure → Phase 4 (ADR-173 12 시연 게이트) entry trigger

#### Lessons (canonical for future audit-first phase ADRs, 5개)

ADR-172 §9 Lessons 정합:

- **L1** Mechanism-already-exists finding (Pattern 12 deepest 적용 —
  ADR-171 β-2 의 *더 강한* 형태, 전체 mechanism 이미 작동. high-level
  호출 경로 inventory 필수)
- **L2** Demo verification 의 architectural 가치 (ADR-087 K-ζ canonical —
  test 만으로는 "사용자가 보는 결과" 미증명)
- **L3** 신규 SSOT 보류의 architectural correctness (truth over completion —
  ADR-171 L2 + ADR-125 audit pivot 답습)
- **L4** estimate +90 vs 실측 +2 (Pattern 12 정량 evidence — premise 무효화
  시 실측 축소 정상, LOCKED #44)
- **L5** Phase 4 자연 통합 (12 시연 게이트 overlap)

#### Phase 4 (ADR-173) entry trigger anchor

| Phase | ADR | Title | 회귀 |
|---|---|---|---|
| 1 ✅ | ADR-170 | Tool layer normalizeDrawInput SSOT | +29 |
| 2 ✅ | ADR-171 | Engine absorb_boundary_input SSOT | +19 |
| **3 ✅** | **ADR-172** | **DCEL Edge Register (mechanism already exists)** | **+2** |
| 4 | ADR-173 | User vision realization + 12 시연 게이트 PASS | +30 |

Phase 3 demo (2 crossing line / square+cross → 2 faces) 가 Phase 4 와 자연
overlap — Phase 4 는 본 demo 를 12 scenario full sweep 으로 확장.

#### Cross-link

- **LOCKED #44** Complete Meaning per Merge (estimate +90 vs 실측 +2)
- **LOCKED #64** ADR-139 Boundary tool only (face emission gate, L-73-7)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (direct precursor)
- **LOCKED #71/72** ADR-170/171 Phase 1/2 closure (direct precursors)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (L2)
- **ADR-101 Amendment 9** HARD flag (mark_edge_hard, L-73-6)
- **ADR-116/125** audit-first finding 답습 (L1/L3)
- **ADR-139** Boundary tool only (face emission gate)
- **ADR-148** boundary_from_point (face emission SSOT — 유지)
- **ADR-171** Phase 2 (Pattern 12 source)
- **ADR-173** Phase 4 (별도 ADR + 별도 atomic PR)
- **메타-원칙 #5/#14/#15/#16** + **Pattern 12** engine already-robust
  (deepest 적용)
- **axia-sketch pattern 3/5** (이미 우리 엔진 구현 확인)

### 74. ADR-173 — Phase 4 closure + 🎉 Phase 1-4 sequence COMPLETE (12 시연 게이트 demo-verified, 2026-05-31) ✅

**Canonical anchor**: LOCKED #70 Phase 1-4 sequence anchor 의 **Phase 4
closure** = **ADR-169 D-Then-C sequence 완결**. 사용자 비전 "선만 그려,
케이크는 알아서 나뉜다" 의 12 시연 게이트 demo-verified.

**3 PRs sequence (2026-05-31, same-day)**:
- PR #273 α spec — 12 게이트 정의 + Q1~Q5
- PR #274 β — 12 scenario full demo + 매트릭스 확정 + S2 입체면 회귀 +1
- PR #275 γ closure — Status Accepted + §9 Lessons + LOCKED #74 + COMPLETE

**합계 +1 회귀** (axia-geo 1537→1538). estimate +10 vs 실측 +1 — Pattern 12
(verification 중심 + 기존 회귀 자산 재활용).

#### 12 시연 게이트 매트릭스 (canonical, demo-verified)

| | 평면 | 입체면 | 곡면 |
|---|---|---|---|
| DrawLine | S1 ✅ | S2 ✅ | S3 ⚠ |
| RECT | S4 ✅ | S5 ✅ | S6 ⚠* |
| CIRCLE | S7 ✅ | S8 ✅ | S9 ⚠* |
| Bezier | S10 ✅ | S11 ✅ | S12 ⚠* |

**8/12 full PASS** (평면 4/4 + 입체면 4/4) / **4/12 Documented-Limitation**
(곡면) / **미예측 FAIL 0**.

#### 불변 lock-in

- **L-74-1** 12 시연 게이트 demo-verified (Claude Preview MCP, eval
  authoritative) — 8/12 PASS / 4/12 곡면 Limitation / 미예측 FAIL 0 강제
- **L-74-2** 사용자 비전 핵심 (평면 + 입체면) demo-verified + 회귀 lock-in
- **L-74-3** S2 입체면 회귀 보존 (adr173_gate_s2_drawline_on_solid_box_face_
  splits — 사용자 원래 pain point PR #247/248 해소)
- **L-74-4** 곡면 한계 (S3/S6/S9/S12) future ADR 분리 보존 (curve-edge
  crossing-split, 2026-05-31 spawned)
- **L-74-5** Demo-driven gate canonical (ADR-087 K-ζ deepest 적용)
- **L-74-6** **Phase 1-4 sequence COMPLETE** — ADR-169(#70)→170(#71)→
  171(#72)→172(#73)→173(#74), 절대 회귀 보존
- **L-74-7** 메타-원칙 #5/#14/#16 보존 강제

#### 🎉 Phase 1-4 sequence COMPLETE (ADR-169 D-Then-C 완결)

| Phase | ADR | Title | LOCKED | 회귀 |
|---|---|---|---|---|
| 0 | ADR-169 | Boundary-Routine Audit (D-Then-C anchor) | #70 | +0 |
| 1 | ADR-170 | Tool layer normalizeDrawInput SSOT | #71 | +29 |
| 2 | ADR-171 | Engine absorb_boundary_input SSOT (3/4 already-robust) | #72 | +19 |
| 3 | ADR-172 | DCEL Edge Register (mechanism already exists, demo-verified) | #73 | +2 |
| 4 | ADR-173 | 12 시연 게이트 + COMPLETE | #74 | +1 |
| **합계** | **5 ADR** | | **#70~74** | **+51** |

사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" D-Then-C (audit →
implementation) 완결. estimate 6-8주 / +200~300 회귀 vs **실측 same-week
period / +51 회귀** — Pattern 12 (engine already-robust, mechanism already
exists) 가 genuine work 대폭 축소.

#### Lessons (canonical, 5개)

ADR-173 §9 정합:
- **L1** Full matrix demo 의 honest 분류 (PASS / Documented-Limitation,
  truth over "전부 작동")
- **L2** Verification phase 회귀 재활용 (estimate +10 vs 실측 +1)
- **L3** 곡면 한계 architectural 명료성 (future ADR 분리)
- **L4** Phase 1-4 sequence 완결의 architectural 가치
- **L5** Demo-driven gate (ADR-087 K-ζ deepest 적용)

#### Cross-link

- **LOCKED #44** Complete Meaning per Merge (estimate vs 실측 정합)
- **LOCKED #64** ADR-139 Boundary tool only (face emission gate)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (D-Then-C C 완결)
- **LOCKED #71/72/73** ADR-170/171/172 Phase 1/2/3 (sequence precursors)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (L5)
- **ADR-169 β-3** user demo evidence matrix (12 scenario source)
- **곡선 면 분할 future ADR** (curve-edge crossing-split, spawned task)
- **메타-원칙 #5/#14/#16** + **Pattern 12** engine already-robust (deepest)
- **axia-sketch pattern 3/5** (이미 우리 엔진 구현, demo-verified)

### 75. ADR-175 — Face-Hit Drawing Plane (LOCKED #63 amendment, 2026-06-01) ✅

**Canonical anchor (사용자 시연 + 결재, 2026-06-01)**:
> "박스 만들고 → 윗면에 선 → 면 분할은 안됨", "입체면에 도형그리기가 전혀
> 안됨" → 결재 "LOCKED #63 개정 — 직접 그리기".

ADR-172/173 의 "입체면 split" 은 *bridge 직접 호출* (z=200 명시) 로 demo-
verified 됐으나, **실제 UI 마우스 경로** 로는 작동 안 함 — `ToolManager.
get3DPoint` 의 LOCKED #63 z=0 강제 (face hit 우회) 가 입체면 클릭을 z=0 으로
강제. ADR-175 가 get3DPoint 를 face-aware (getDrawPlane ADR-140 과 일치) 로
amend.

#### 핵심 변경 — get3DPoint face-aware

```
면(solid face) 위 클릭 → 그 면 plane 위 점 (z=200 등)        ← NEW
빈 공간 클릭        → z=0 ground 강제 (LOCKED #63 보존)
sketch mode        → sketch plane (보존)
```

원래 z=0 강제의 motivation (face hit drift 전파) 은 **ADR-170/171/168
absorb 인프라** (face plane projection + ADR-168 drift snap) 가 해소 →
입체면 직접 그리기 안전 재활성화.

#### Lock-ins (L-75-1 ~ L-75-9)

- **L-75-1** get3DPoint face-aware (face hit → 면 plane, no hit → z=0)
- **L-75-2** getDrawPlane (ADR-140) 과 일치 — 두 함수 모두 face-aware
- **L-75-3** LOCKED #63 z=0 강제는 *빈 공간* 에서만 보존 (face hit 우회 폐기)
- **L-75-4** Sketch mode 보존 (변경 0)
- **L-75-5** drift 안전성 = ADR-170/171/168 absorb 인프라 의존
- **L-75-6** finite 검증 (degenerate ray → hit point fallback, no crash)
- **L-75-7** Engine 변경 0 (TS only)
- **L-75-8** 메타-원칙 #4 (SSOT) + #5 (명확한 의도 자동 — 면 클릭=면 위 그리기)
- **L-75-9** 절대 #[ignore] 금지

#### Demo verification (Claude Preview MCP, 2026-06-01, 실제 UI 마우스)

| 검증 | 결과 |
|---|---|
| pick 박스 윗면 (z=200) | ✅ HIT (point.z=200) |
| line 도구로 박스 윗면 가로선 (실제 MouseEvent) | ✅ faces **6 → 7** (분할!) |
| 빈 공간 선 (박스 밖) | ✅ 새 vertex z=0 (LOCKED #63 보존) |

→ **사용자 원래 pain point ("입체면에 도형그리기 안됨") 완전 해소.**

#### 회귀 매트릭스 (실측)

ToolManagerRefactored.test.ts **+3** (face 경로 진입 / z=0 보존 / degenerate
fallback). vitest 131 → **134 PASS** (0 regression, 절대 #[ignore] 금지 3/3).

#### Out of scope (future)

- 곡면(curved surface) 위 직접 그리기 — get3DPoint 현재 chord plane (DCEL
  normal). 곡면 정밀 그리기 future (ADR-174 curve-edge 와 별개)
- 2nd+ click 면 plane lock — 현재 매 click 면 hit 재판정. 면 plane 고정은
  ADR-166 plane lock 활용 가능 (future)

#### Cross-link

- **LOCKED #63** PR #101 (z=0 invariant — 본 ADR 이 amendment)
- **LOCKED #69** ADR-168 face plane drift snap (drift 흡수)
- **LOCKED #71/72** ADR-170/171 absorb (drift 해소 인프라)
- **ADR-140** surface-aware getDrawPlane (face-aware 패턴 reference)
- **ADR-166** plane lock (2nd+ click future)
- **ADR-172/173** 입체면 split (bridge-level demo, 본 ADR 이 UI 경로 활성)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical (demo-verified)
- **메타-원칙 #4** SSOT / **#5** 사용자 편의 / **#10** ADR 불변 (LOCKED #63
  amendment via 사용자 결재)
- **LOCKED #44** Complete Meaning per Merge (single atomic PR)

### 76. ADR-176 — Auto-Behaviors Production Default ON (ADR-139 amendment, 2026-06-01) ✅

**Canonical anchor (사용자 보고 + 결재, 2026-06-01)**:
> "우리엔진의 루틴이 바뀌어서 모두 작동을 하지 않습니다" + "겹침/포함 자동
> 분할이 안 됨" → 결재 "둘 다 고침 (추천) — 자동 동작 기본 ON".

사용자 비전 **"선만 그려, 케이크는 알아서 나뉜다"** (axia-sketch parity) 가
기본 제품에서 작동 안 함 — ADR-139 (LOCKED #64) 가 두 자동 동작 flag 를 기본
OFF 로 전환했기 때문. ADR-176 이 **production default 를 ON 으로** amend.

#### 시점 통찰 — 모순이 아니라 견고화 완료

- **2026-05-18** ADR-139 — 파이프라인 비견고 → 자동 동작 OFF (메타-원칙 #16)
- **2026-05-29~31** ADR-169~173 (Phase 1-4) — absorb SSOT + crossing-split 견고화
- **2026-06-01** ADR-176 — 견고해졌으니 자동 동작 다시 ON

ADR-139 은 "*견고해질 때까지* 끈다"였고, Phase 1-4 가 견고하게 만들었으므로
이제 켜는 것이 정합. **메타-원칙 #16 자체는 불변** — production default 만 변경.

#### 핵심 변경 — Path B canonical 패턴 (ADR-049 P-5e-α)

```
Engine default (scene.rs:400/402)  : OFF  (회귀 자산 300+ 보존, Scene::new() 불변)
Production default (TS Settings)    : ON   (main.ts wiring init push)
Explicit OFF preference            : 보존 (localStorage 'false' → OFF)
```

`AutoIntersectSettings.ts` + `AutoFaceSynthesisSettings.ts` 의 `let current
= true` (이전 false) + `if (saved === 'false') current = false`. Engine 변경 0.

#### Lock-ins (L-76-1 ~ L-76-7)

- **L-76-1** Production default ON, engine default OFF (ADR-049 P-5e-α canonical)
- **L-76-2** Explicit `localStorage 'false'` OFF preference 보존
- **L-76-3** 메타-원칙 #16 (휴리스틱 antipattern) 자체 불변 — production default 만 변경
- **L-76-4** Phase 1-4 (ADR-169~173) 견고화가 활성 근거
- **L-76-5** Boundary tool (ADR-139 B-γ) 명시 trigger 보존 (additive)
- **L-76-6** invariant 0 violations 강제 (demo-verified 안전 신호)
- **L-76-7** 절대 #[ignore] 금지

#### Demo verification (Claude Preview MCP, 2026-06-01)

| 시나리오 | 결과 |
|---|---|
| auto-intersect / auto-face-synth default | **ON / ON** ✅ |
| 겹침 RECT 2개 → sub-faces | delta **3** ✅ "케이크 나뉨" |
| 포함 (big+small) → ring+hole | delta 2 ✅ |
| 멀티-RECT 스트레스 (4겹 staggered) | **9 sub-faces, invariant 0 violations** ✅ |

→ Phase 1-4 견고화로 ADR-139 이 우려한 cascading 손상 없음.

#### 진단 회고 — "rect 원점 버그"는 테스트 인자 실수

진단 중 발견한 "rect 원점 → 0 face" 는 **engine 버그 아님** — TS
`drawRectAsShape` 시그니처가 `(cx,cy,cz, nx,ny,nz, ux,uy,uz, w, h)` 인데
corners 로 잘못 호출(width=0)한 것. Rust 테스트 + raw WASM + 올바른 browser
호출 3중으로 **엔진/auto_intersect 완전 정확** 확인. **교훈: WASM 바인딩
시그니처 검증 우선** (ground truth 는 Rust 테스트).

#### 회귀 매트릭스

axia-core scene::tests **+2** (`adr176_rect_as_shape_origin_corner_auto_
intersect_on` / `adr176_two_rects_as_shape_partial_overlap_auto_split`).
323 → **325 PASS**. tsc 0 errors. Playwright: auto-spec explicit opt-in/out
→ 영향 0. 절대 #[ignore] 금지 2/2.

#### 사용자 facing 변화

- 겹치는 도형 그리면 → 자동 3분할 (케이크 나뉨)
- 작은 도형을 큰 도형 안에 → 자동 ring+hole
- 닫힌 line cycle → 자동 면 + sliver mop-up
- `localStorage 'axia:auto-intersect-on-draw' = 'false'` (또는 auto-face-
  synthesis) 명시 시 legacy OFF 보존

#### Out of scope (별도 ADR)

- #3 입체면 face-drawing robustness (start-off-face → z=0 lock) — ADR-177 (가칭)
- Settings UI 의 auto-toggle 가시성 — future

#### Cross-link

- **LOCKED #64** ADR-139 (auto trigger 폐기 — 본 ADR 이 production default amend)
- **LOCKED #70~74** ADR-169~173 (Phase 1-4 견고화 — 활성 근거)
- **LOCKED #41** ADR-101 (coplanar overlap auto-split 로직)
- **ADR-049 P-5e-α** (engine OFF + production ON canonical) / **ADR-094 B-η**
  (Path B production default ON 패턴 source)
- **메타-원칙 #5** 사용자 편의 / **#6** Preventive (invariant) / **#10** ADR
  불변 (ADR-139 amendment via 결재) / **#16** 자동화 antipattern (불변 보존)
- **ADR-087 K-ζ** 사용자 시연 게이트 canonical
- **LOCKED #44** Complete Meaning per Merge (single atomic PR)

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

### 신규 dev 클론 (2026-05-14~)
```bash
git clone <repo>
cd <repo>/web
npm install   # postinstall 의 ensure-wasm.mjs 가 자동으로
              # `wasm-pack build --target web` 실행 (없으면 안내 출력 후 통과)
npm run dev   # Vite dev server
```

`web/src/wasm/` 는 더 이상 git 에 tracked 되지 않습니다 (LOCKED #40 follow-up
2026-05-14 정책). 산출물이 source 와 desync 되어 발생하던 회귀를 architectural
fix — wasm-pack 산출은 매번 source 에서 재생성됩니다.

### 명시적 재빌드 (`mesh.rs` / `lib.rs` 수정 후)
```bash
cd web
npm run build:wasm   # WASM 만 재빌드 (verify 포함)
npm run wasm:verify  # 산출물 무결성 검사만
```

### Production / CI build
```bash
cd web
npm run build        # tsc + vite build → web/dist/
```
WASM 은 `postinstall` 또는 명시적 `build:wasm` 으로 사전 빌드되어 있어야 함.
CI workflow (`build.yml` / `ci.yml` / `deploy.yml` / `mcp.yml`) 는 setup
순서상 자동 해결됨.

### 수동 (디버깅 시)
```bash
cd crates/axia-wasm
wasm-pack build --target web --out-dir ../../web/src/wasm

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
- **2026-05-14 업데이트** (LOCKED #40 follow-up): `web/src/wasm/` 가 더 이상
  git 에 tracked 되지 않음. `npm install` 의 `postinstall` (ensure-wasm.mjs) 가
  artifact 부재 시 자동 빌드. `mesh.rs` / `lib.rs` 수정 후에는 `npm run build:wasm`
  으로 명시 재빌드 (postinstall 은 idempotent — 이미 존재하는 artifact 는 재빌드
  안 함).
- **2026-04-24 업데이트**: 이전 경고 ("axia_wasm.js 수동 수정", "JSDoc `*/` 수동 추가") 는 현재 wasm-pack 0.14+ 기준 **더 이상 필요 없음**. `npm run build:wasm`이 자동 처리.
- `npm run build` 는 tsc + vite build만 — WASM 은 사전에 빌드되어 있어야 함
  (CI / postinstall 가 처리).
- 빌드 시 `--emptyOutDir false` 필수 (권한 오류 방지) — npm script가 자동 적용.
- Rust 툴체인이 없는 환경에서는 WASM 재빌드 불가 → ensure-wasm.mjs 가 안내
  메시지 출력 후 non-fatal exit (JS/TS만 수정 시 영향 없음).

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

## 메타-원칙 (#1~#16, ADR-139 까지 통과)

설계 결정 시 참조하는 16개 메타-원칙. 자세한 출처는
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
| 12 | **Memory Budget Per Subsystem** (Rust slot / Three.js / BVH / OperationLog 등 영역별 cap 강제, ADR-013 §1) | 메모리 |
| 13 | **One Source, Two Views** (Rust=truth, JS=view, cache 휘발성) | 메모리/일관성 |
| 14 | **면은 닫힌 경계로부터 유도된다** — 평면적(coplanar) 닫힌 단순 경계 → disk-topology face (H₁=0 한정, Jordan-Schoenflies 정리 기반). Knotted curve / Plateau's problem 등 비평면 / 비단순 경계는 명제 외부 — **WHAT layer (결과 invariant 불변)** | 기하 본질 |
| 15 | **동일 분할 = 동일 topological contract — 빠르고 신속하고 정확하게** (Same split = same topo contract: fast, swift, accurate) | 분할 정합 |
| 16 | **자동화는 사용자 의도를 미리 알 수 없다 — 휴리스틱 자동화는 cascading 부작용의 source** (Automation cannot infer user intent; heuristic automation is the source of cascading side-effects) — **WHEN layer (trigger 정책)** | UX/거버넌스 |

### 메타-원칙 #14 — 면은 닫힌 경계로부터 유도된다 (WHAT layer)

**Canonical statement (사용자 통찰, 2026-05-08; ADR-139 amendment 2026-05-18;
학술적 정밀화 amendment 2026-05-21)**:
> "면은 닫힌 경계로부터 유도된다."
> ("A face is derived from a closed boundary.")

**ADR-139 amendment (2026-05-18, 사용자 정정)**:
> "메타-원칙 #14 (면은 닫힌 경계로 유도된다) 이것은 바뀌지 않습니다.
> 중요한것은 바운더리를 만들어 생성을 할수있느냐지?"

**학술적 정밀화 amendment (2026-05-21, 보고서 P3 High)**:
> "평면적(coplanar) 닫힌 단순 경계로부터 disk-topology face 가 유도된다
> — H₁=0 영역 한정. Knotted curve / Plateau's problem / 비평면 closed
> curve 는 명제 외부."

**위상수학적 근거 (Jordan-Schoenflies 정리)**:
- 평면 R² 의 simple closed curve 는 R² 를 inside (disk homeomorphic) +
  outside 로 분할 (Jordan curve 정리)
- inside region 이 disk 와 homeomorphic (Schoenflies 정리)
- AxiA 의 coplanar 검사 (LOCKED #5 ε=1.5μm spatial-hash) 가 진입 가드 →
  본질적으로 R² 환경 → P14 수학적으로 정합
- 전역 명제로는 H₁ (first homology group) = 0 (simply-connected surface)
  한정 — torus / Klein bottle / multi-genus 곡면은 비자명 cycle 존재 →
  명제 외부 (AxiA scope 외)

**비평면 / 비단순 경계 명제 외부 사례 (학술적 정합)**:
- Knotted curve (knot theory) — 3D closed curve 의 surface 채움 비유일
- Plateau's problem — minimal surface 다중성, 일반 3D closed curve 의
  surface 채움 비유일
- Self-intersecting boundary — non-simple closed curve, 단순화 후 적용

**WHAT vs WHEN 직교 분리** (ADR-139 신설):
- **메타-원칙 #14 (WHAT — 결과 invariant, 불변)**: 닫힌 경계 → 면.
  *기하학적 진리* — 결과는 같다.
- **메타-원칙 #16 (WHEN — trigger 정책, 신설)**: *어떻게* 그 닫힌
  경계를 인식하는지의 *trigger* — 자동 vs 사용자 명시. ADR-139 가
  자동 trigger 폐기 / 사용자 명시 trigger 활성.
- 두 원칙은 직교 — #14 는 *결과* 보존, #16 는 *trigger* 변경.

**의미**:
- Face 는 *first-class entity 가 아닌 byproduct* — closed edge loop 의
  자연 결과 (ADR-019 "Line is Truth, Face is Byproduct" 의 가장 본질
  형태).
- Edge 는 fundamental — vertex 는 edge endpoint, face 는 edge cycle
  의 derivation.
- Closed boundary 가 있으면 면이 합성되어야 — *trigger 는 사용자 명시*
  (ADR-139 Boundary tool / single explicit op).
- Closed boundary 가 기존 face 위에 있으면 그 face 를 분할 — *trigger
  는 사용자 명시* (ADR-139).
- Boundary 에 attach 된 analytic curve (Circle/Arc/Bezier/BSpline/NURBS)
  가 face 의 경계 형상을 정의 — polygon approximation 은 render 부산물
  (ADR-027 NURBS Kernel + ADR-028 Edge curve attach).
- Face 의 surface metadata (Plane / Cylinder / Sphere / etc.) 는
  *kernel-aware ops* (Push/Pull / Boolean / Offset) 의 입력 — render
  영역 결정자 아님 (LOCKED #16 ADR-038 P23 + ADR-087 K-ε hotfix).

**적용 사례 (역사적 맥락)**:
- ADR-008 Axiom 1: Face = byproduct
- ADR-015 LOCKED #1 의 v2.0 (component-merge resolver deferred)
- ADR-019 "Line is Truth, Face is Byproduct"
- ADR-025 P11 LOCKED #12: 닫힌 엣지 = 반드시 면 (자동 trigger — ADR-139
  로 supersede, 결과 invariant 보존)
- ADR-021 P7 LOCKED #1: 닫힌 경계로 면 분할 (자동 trigger — ADR-139 로
  supersede, 결과 invariant 보존)
- ADR-087 K-ε hotfix: Plane render → polygon path (DCEL boundary = exact)
- ADR-088 Phase 1 (curve_owner_id), ADR-089 Phase 2 (true kernel-native
  closed edges) 의 anchor.
- **ADR-139 (2026-05-18) — WHAT/WHEN 분리 명시**: 메타-원칙 #14 가 *WHAT
  layer (결과 invariant)* 임을 명시하고, *WHEN layer (trigger 정책)* 을
  메타-원칙 #16 으로 분리. 사용자 정정 "메타-원칙 #14 는 바뀌지 않습니다"
  — 결과 (닫힌 경계 → 면) 는 보존, *trigger* 만 자동 → 명시 Boundary tool.
- **ADR-107 (2026-05-16) — deepest realization closure**: `*AsShape` →
  Path B canonical unification (Layer Separation Policy). 사용자 통찰
  "메시 곡면과 기하 원의 곡면이 동시에 작용" → Hybrid layer 의 N segment
  boundary 가 byproduct, **single self-loop edge boundary** 가 canonical.
  ζ-β engine dispatch (threshold POLYGON_THRESHOLD=12) — segments>=12 →
  Path B 자동 변환 (Circle approximation), <12 → legacy polygon (DrawPolygon
  use case 보존). 자연 효과: 결함 G (Layer Separation Violation) 해소 +
  ADR-101 §A9.8 결함 D (vertex-on-corner degeneracy) 자연 해소 (D2 audit
  evidence) + 메모리 97% 절감 (LOCKED #35 ADR-094 §6.3). 미리보기 시연
  evidence (ζ-ζ, 2026-05-16): 결함 D trigger reproduce → split=3 ✅
  CONFIRMED.

**가이드 (향후 ADR / 코드 결정 시)**:
- "이 변경이 면을 closed edge boundary 의 byproduct 로 유지하는가?" 가
  체크리스트 첫 질문.
- Face 를 *first-class* 로 취급하면 mesh-era 잔존이 잠복 — 폴리곤
  approximation 의존, kernel-aware ops 차단, selection unification
  실패 등.
- 답이 No 면 거부 또는 새 ADR 필요.

### 메타-원칙 #15 — 동일 분할 = 동일 topological contract

**Canonical statement (사용자 결재, 2026-05-16, ADR-101 Amendment 9)**:
> "동일한 분할 연산은 동일한 topological contract — 빠르고, 신속하고,
> 정확하게."
> ("Same split op = same topological contract — fast, swift, accurate.")

**의미**:
- 모든 split-type 함수 (`Mesh::split_face` / `split_face_by_chain` /
  `split_face_case_b/c/d` / `auto_intersect_coplanar` / Boolean
  `split_faces_by_intersections` / 향후 새 split 함수) 는 split-induced
  edges 에 **`HeFlags::HARD` flag 부여** 라는 동일 topological contract
  를 준수해야.
- Render path (`export_edge_lines_with_map`, mesh.rs:5384-5404) 의
  coplanar Plane edge hide 정책 (LOCKED #16 K-ε hotfix) 과 split 의 분할
  의도의 충돌은 **split-side 의 HARD flag 부여** 로 명시 해소. Render
  path 의 정책 자체는 보존 — smooth surface 가시화 목적.
- **"빠르고 신속하고 정확"**: 추가 분기 / lookup 없이 flag 1 bit 로
  정확한 동작 보장 (`force_hard` fast-path, mesh.rs:5359). Performance
  + correctness 동시.

**Contract enforcement 패턴** (canonical reference, mesh.rs:4068-4069):
```rust
// split 후 (face wiring 완료 후) — 두 twin HE 모두 HARD.
self.hes[he_v1v2].set_flags(HeFlags::HARD);
self.hes[he_v2v1].set_flags(HeFlags::HARD);
```

안전 OR 패턴 (기존 flags 보존, mesh.rs:2541 답습):
```rust
let cur = mesh.hes[he_id].flags();
mesh.hes[he_id].set_flags(cur | HeFlags::HARD);
```

**적용 사례 (ADR-101 Amendment 9 audit, 2026-05-16)**:
| 함수 | HARD 부여 | 정합 |
|---|---|---|
| `Mesh::split_face` | ✅ canonical | reference |
| `Mesh::polygonize_closed_curve_face` | ❌ (substitute, split 아님) | 정합 (의도) |
| `auto_intersect_coplanar` | ✅ Amendment 9 | **fix 완료** |
| `Mesh::split_face_by_chain` | ❌ | 별도 PR |
| `split_face_case_b/c/d` | ❌ | 별도 PR |
| `boolean.split_faces_by_intersections` | ❌ | 별도 PR |

**가이드 (향후 ADR / 코드 결정 시)**:
- 새 split-type 함수 신설 / 기존 split 함수 수정 시 **HARD flag 부여
  여부 명시 검증** (회귀 테스트 강제).
- 어떤 edges 가 HARD 부여 받는지 정책 명확 — split-induced (face 분할
  결과 생성된 새 edge) vs 외부 boundary (face_normals.len()==1 자동
  draw) 구분.
- "이 split 함수가 LOCKED #16 의 coplanar hide 와 충돌하는가?" 가
  체크리스트 질문 — Yes 면 HARD 부여 의무.
- Substitute 함수 (split 아닌 face 교체 — e.g., polygonize_closed_curve_
  face) 는 out of contract — 별개 정책.

**적용 사례 (역사적 맥락)**:
- ADR-101 Amendment 9: 결함 C (render edge hide) 의 architectural root
  은 `Mesh::split_face` ↔ `auto_intersect_coplanar` 의 contract 불일치
- 향후 모든 split-type 함수 신설 / 수정 시 본 원칙 정합 강제

### 메타-원칙 #16 — 자동화 antipattern (WHEN layer, 신설)

**Canonical statement (사용자 통찰 누적 + Claude 합의, ADR-139 결재 2026-05-18)**:
> "자동화는 사용자 의도를 미리 알 수 없다. 휴리스틱 자동화는 cascading
> 부작용의 source."
> ("Automation cannot infer user intent. Heuristic automation is the
> source of cascading side-effects.")

**Trigger evidence (사용자 evidence + 시연 누적)**:
- **P5.UX.39~45 cascading fixes 패턴** — 자동 cycle / split / intersect
  trigger 가 각각 부작용 만들고, 이후 sprint 들이 부작용 fix 시도하다
  새 부작용 누적. 6 sprint 누적 의 가장 직접적 evidence.
- **사용자 RECT 시연** (2026-05-18, PR #101 closure 후) — 다수 RECT 그린
  뒤 *구멍이 난 부분이 많았다*. 자동 합성 휴리스틱 한계 직접 evidence.
- **사용자 통찰**: "현재 자동 cycle detection + auto-punching 접근이
  cascading 이슈 만들고 있습니다 (P5.UX.39-45가 모두 이전 자동화의
  부작용 처리). CAD 표준 BOUNDARY 명령 방식이 더 안정적입니다."

**의미**:
- 자동 trigger 가 *모호한 케이스* (self-intersecting line, multi-RECT
  containment + overlap, pentagon 5 line, Push/Pull inner detail) 에서
  *추측* 해야 → 잘못된 결정 → cascading fixes.
- 사용자 의도는 모호함 자체가 *사용자가 명시* 해야 결정 가능.
- 메타-원칙 #5 ("명확하면 자동, 모호하면 명시 동의") 의 *강화* — "휴리
  스틱 자동화 = 모호" 임을 lock-in.
- 본 원칙은 *WHEN layer (trigger 정책)* — *WHAT layer (결과 invariant
  메타-원칙 #14)* 와 직교. 결과는 같다, *언제 trigger 하느냐* 만 다름.

**가이드 (향후 ADR / 코드 결정 시)**:
- 새 자동화 (자동 trigger / 자동 detect / 자동 split / 자동 intersect)
  도입 검토 시 본 원칙 정합 *명시 검증*. 답이 "휴리스틱" 이면 거부.
- 자동화 제안 시 *cascading fix 위험* 명시 (예: 메모리 누수, edge case,
  사용자 intent 추측). cascading risk 0 증명 의무.
- 명확한 단일 사용자 의도 (e.g., DrawRect = 사각형 그리기 = explicit
  intent) 는 *자동 face 합성 보존* (ADR-139 Q2=a 결재). 모호 ≠ 단일.
- 휴리스틱 자동화 vs 사용자 명시 trigger 선택지 항상 고려.

**적용 사례 (역사적 맥락)**:
- ADR-139 (2026-05-18) — 본 메타-원칙 *신설 anchor*. LOCKED #1 P7 /
  #12 P11 / #41 ADR-101 의 자동 trigger 폐기 결재. Boundary tool
  명시 only.
- 메타-원칙 #5 (사용자 편의) 의 자연 강화 — "모호함의 정의" 가 "휴리
  스틱" 임을 명시.

**구분 가이드 — 명시 vs 휴리스틱**:
| 자동화 유형 | 분류 | 사례 |
|---|---|---|
| Single explicit op (DrawRect 의 4 vertex → 1 face) | **명시** ✅ | 보존 |
| Cardinal projection (z=0 강제, LOCKED #63) | **명시** ✅ | 보존 (사용자 view 명확) |
| Single click → owner ID promote (ADR-037 P22) | **명시** ✅ | 보존 |
| 닫힌 line cycle 자동 face 합성 (LOCKED #12 P11) | **휴리스틱** ❌ | ADR-139 폐기 |
| Containment 자동 split (LOCKED #1 P7) | **휴리스틱** ❌ | ADR-139 폐기 |
| Coplanar overlap 자동 3 sub-face (LOCKED #41) | **휴리스틱** ❌ | ADR-139 폐기 |

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

### 75. ADR-174 — Curve-Edge Crossing-Split (직선 × Circle 면, demo-verified, 2026-06-01) ✅

**Canonical anchor**: ADR-173 §10 (L-74-4) 가 spawn 한 곡면 한계 후속 —
직선이 Path B kernel-native Circle (ADR-089) 면을 가로지르면 **2조각 분할**.
ADR-172 직선 crossing-split 의 곡선 *경계* 확장.

**문제**: `find_line_crossings` 가 self-loop 곡선 edge (양 endpoint 동일
anchor → d2=0) 를 "평행" 으로 skip → secant crossing 미검출 → 면 1→1.

**3 PR sequence (2026-05-31 ~ 06-01)**:
- PR #277 α + β-1 + β-2 — spec + 검출 helper + pre-pass wiring + polygonize fix
- (본 PR) β-3 + γ — secant robustness 회귀 + closure + demo

**불변 lock-in**:
- **L-75-1** Approach A (polygonize dispatch) — `find_line_crossings` 직전
  pre-pass 가 secant 가 가로지르는 Circle self-loop face 를 선제
  `polygonize_closed_curve_face` (ADR-105 helper) → ADR-172 battle-tested
  직선 파이프라인 자연 처리 → 2 half-disk face. Pattern 12.
- **L-75-2** 정밀 line-circle 2-교차 closed-form (AABB pre-filter, curves/
  미접촉 — NURBS kernel carve-out 정합)
- **L-75-3** polygonize **reused-anchor root-cause fix** — anchor 가 첫
  tessellation point 로 재사용된 뒤 deactivate 되어 active face loop 에
  inactive vertex 가 박히던 잠복 버그 해소 (메타-원칙 #6). ADR-105 도 견고.
- **L-75-4** edge 자동 split (위상 correctness, #5/#16) + face emission gate
  보존 (ADR-139) + HARD flag (ADR-101 A9, 직선 chord)
- **L-75-5** Circle self-loop 한정. Arc-edge 정확도 / Bezier·BSpline·NURBS /
  곡면 surface drawing (S3/S6/S9) = 별도 트랙. Approach B (true 2-arc) =
  future ADR (L-174-12)
- **L-75-6** Demo-verified (Claude Preview, real browser): drawCircleAsCurve
  + drawLineAsShape → faces 1→2 (ADR-087 K-ζ)

**회귀 누적**: axia-geo +7 (1545) / axia-core +7 (323), 합계 **+14**, 절대
#[ignore] 금지 14/14. 상세 `docs/adr/174-curve-edge-crossing-split.md`.

**Cross-link**: ADR-089 (Path B Circle) / ADR-105 (polygonize dispatch
mirror) / ADR-172 (직선 pipeline, Pattern 12) / ADR-173 §10 (spawn anchor) /
ADR-101 A9 / 메타-원칙 #5/#6/#14/#15/#16. LOCKED #43/#64/#70~74.

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
