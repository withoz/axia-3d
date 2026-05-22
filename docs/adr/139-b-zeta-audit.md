# ADR-139 B-ζ — 회귀 자산 update audit (β implementation 사전 검토)

**Status**: Accepted (docs only — β implementation 사전 검토, audit-first canonical 8번째 적용)
**Date**: 2026-05-18
**Author**: WYKO + Claude
**관련 ADR**: ADR-139 §14 B-ζ atomic sub-step
**Path Z position**: B-α (spec) → B-β audit → **B-ζ 회귀 audit (본 doc)** → B-β implementation

## 1. 목적

ADR-139 §14 의 β implementation atomic sub-step plan 에서 가장 큰 비용
sub-step (B-ζ — 회귀 자산 update, ~1-2주) 의 *사전 검토*. B-β engine
implementation 진입 *전* 영향받을 회귀 자산을 inventory + update type
별로 분류하여 *위험 격리*. ADR-138 §B-β audit 결과 (14 tests identified)
의 더 큰 sweep 적용.

**Canonical pattern (audit-first 8번째)**:
- ADR-125 (α-1 selection rendering audit)
- ADR-126 (α-2 STEP/IGES merged BufferGeometry audit)
- ADR-127 (α-4 helper lines audit)
- ADR-131 (CommandPalette already exists audit)
- ADR-128 (priority #4 vertex-on-edge audit)
- ADR-132 (dual catalog unification audit)
- ADR-134 (rendering perf audit)
- **ADR-139 B-ζ audit (본 doc, 8번째)** — β implementation 진입 전 위험 격리

## 2. 영향 범위 inventory (5 layer)

### 2.1 Engine layer — `crates/axia-geo` (영향: 폐기 대상 trigger source)

**자동 trigger 본체 (폐기 대상)**:

| 함수 | 위치 | 영향 |
|---|---|---|
| `Mesh::resolve_planar_free_faces` | `crates/axia-geo/src/mesh.rs:1612` | 자동 cycle finder — 명시 호출만 허용 (Boundary tool 본체) |
| `Mesh::resolve_planar_free_faces_scoped` | `crates/axia-geo/src/mesh.rs:1620` | 위 scoped 변형 — 동일 |
| `Mesh::auto_intersect_coplanar` | `crates/axia-geo/src/operations/coplanar.rs` | 자동 partial overlap intersect — Boundary tool 호출 시만 |
| `mop_up_orphan_cycles_via_dfs` | `crates/axia-geo/src/operations/erase_resynth.rs` | DFS cycle finder Phase 5 — 명시 호출 only |

**Step pipeline 의 자동 호출 site (제거 대상)**:

| Pipeline | 위치 | 변경 |
|---|---|---|
| Step 4.95 second-pass component-merge resolver | face_synthesis.rs | **disable** (LOCKED #1 P7 자동 supersede) |
| Step 4.99 Final Sweep (`resolve_planar_free_faces` fixed-point) | face_synthesis.rs | **disable** (LOCKED #12 P11 자동 supersede) |
| Phase 5 (DFS cycle finder) | erase_resynth.rs | **disable** (자동 trigger 폐기) |
| Phase 6 (strand absorption via `split_face_by_chain`) | erase_resynth.rs | **disable** (자동 폐기) — 명시 trigger 가능 |
| Phase 7 STRICT (closed-shape finalizer) | face_synthesis.rs | **보존** (single-op explicit, Q2-a) |
| `intersect_faces_inner` coplanar scan branch | mesh.rs / coplanar.rs | **disable** (LOCKED #41 자동 trigger 폐기) — 명시 호출만 |

### 2.2 axia-geo 내부 회귀 자산

**`crates/axia-geo/src/mesh.rs::tests` — `resolve_planar_free_faces` 의존 tests**:

| Line | Test | Update type |
|---|---|---|
| 8838-8863 | `test_*` (filter chain) | **count 영향 가능** (자동 호출 시점 변경) |
| 8863-8888 | `test_*` (resolve 호출) | **신규 명시 호출 expect 필요** |
| 8888-8912 | `test_*` (free face resolve) | 동일 |
| 8912-8926 | `test_*` (free face resolve 2) | 동일 |
| 8926-8959 | `test_*` (resolve 호출) | 동일 |
| 8959-8980 | `test_*` (resolve_scoped) | 동일 |
| 8980-9000 | `test_*` (resolve_scoped 2) | 동일 |
| 9000-9025 | `test_*` (resolve) | 동일 |
| 9025-9070 | `test_*` (resolve) | 동일 |
| 9070-9158 | `test_*` (resolve_scoped) | 동일 |
| 10726-10811 | ADR-089 Phase 2 closed-curve resolve | **명시 호출 보존** (Path B 의 명시적 호출 — Boundary tool 답습) |

**예상**: ~12-15 tests, 모두 *명시 호출 expect* update (자동 trigger 제거 후 명시 호출로 자연 정합).

**`crates/axia-geo/src/operations/coplanar.rs::tests` — ADR-101 auto-intersect 회귀**:

| Lines | Test category | Count | Update type |
|---|---|---|---|
| 1252-1487 | adr101 Phase B2 (Sutherland-Hodgman primitive) | 9 | **불변** (low-level primitive, Boundary tool 호출 자산 보존) |
| 1487-1627 | adr101 Phase B3a (polygon_difference_walking pure utility) | 7 | **불변** (pure 2D utility) |
| 1627-1787 | adr101 Phase B3b (auto_intersect_coplanar DCEL surgery) | 6 | **불변** (Boundary tool 본체 자산) |
| 1787-1942 | adr101 Phase B3c (cleanup helpers) | 4 | **불변** |
| 1942-2154 | adr101 Phase B4b (non-destructive pre-check) | 6 | **불변** (Boundary tool helper) |
| 2154-2440 | adr101 Amendment 9 (HARD flag contract) | 5 | **불변** (LOCKED #15 메타-원칙 #15 정합 보존) |

**Summary**: ADR-101 coplanar 37 tests 모두 **불변 보존** — `auto_intersect_coplanar` API 자체가 Boundary tool 의 본체 자산. **자동 trigger** (Scene wiring `intersect_faces_inner`) 만 폐기 → **engine API 보존**. 회귀 자산 영향 0.

### 2.3 axia-core scene::tests — 자동 trigger 의존 핵심 회귀

**LOCKED #1 ADR-021 P7 회귀 (Superseded by ADR-139)**:

| Test | Line | 의미 변경 |
|---|---|---|
| `test_adr021_p7_case_a_inner_first_then_outer` | 9276 | 자동 → Boundary 명시 호출 → ring/hole expect |
| `test_adr021_p7_case_b_outer_first_then_inner` | 9313 | 동일 (그리기 순서 무관성 보존 — P7 핵심 invariant) |

**예상 update type**:
- 그리기 순서 무관성 (P7 핵심 invariant) **보존**
- 자동 trigger → 명시 `boundary_from_point(p)` 호출 simulate
- ring face count 동일 (의미 변경, 자동 → 명시)

**LOCKED #1 P7 stacked-inner / containment 회귀** (28 tests):

| Test | Line | Update type |
|---|---|---|
| `test_overlapping_rects_preserve_overlap_region` | 7404 | **신규 명시 Boundary 호출** (자동 polygon overlap 폐기) |
| `test_overlapping_rects_corner_overlap` | 7469 | 동일 |
| `test_three_overlapping_rects_no_missing_cell` | 7558 | 동일 |
| `test_nested_plus_side_rect_no_flipped_normal` | 7648 | winding regression — **보존** (winding 정책 독립) |
| `test_adjacent_rect_face_synthesizes` | 7707 | **명시 Boundary 호출** |
| `test_rect_with_all_existing_edges_creates_face` | 7780 | 동일 |
| `test_rect_sharing_two_existing_edges_synthesizes` | 7839 | 동일 |
| `test_collinear_adjacent_rect_synthesizes` | 7881 | 동일 |
| `test_lshape_with_inner_rects_all_faced` | 7911 | **count 영향 가능** (의미 변경) |
| `test_outer_edge_collinear_overlap_with_inner` | 7975 | 동일 |
| `test_very_large_outer_after_small_inners` | 8022 | 동일 |
| `test_outer_edge_coincides_with_inner_edge` | 8060 | 동일 |
| `test_enclosing_outer_after_overlapping_inners` | 8106 | 동일 |
| `test_draw_order_independence` | 8166 | **보존** (P7 핵심 invariant — Boundary 호출 후도 순서 무관) |
| `test_user_pattern_no_missing_faces` | 8255 | **명시 Boundary 호출** count 검증 |
| `test_deeply_nested_rects_all_have_faces` | 8314 | 동일 |
| `test_partial_overlap_no_degenerate_faces` | 8355 | 동일 |
| `test_outer_with_two_partial_overlap_inners` | 8422 | 동일 |
| `test_outer_rect_drawn_after_inners_keeps_face` | 8485 | 동일 |
| `test_outer_with_overlapping_extending_rects` | 8517 | 동일 |
| `test_complex_overlap_no_missing_faces` | 8570 | 동일 |
| `test_outer_rect_preserved_after_many_inners` | 8614 | 동일 |
| `test_all_rects_have_consistent_winding` | 8673 | **보존** (winding 정책 독립) |
| `test_two_stacked_inner_rects_both_faced` | 8704 | **명시 Boundary 호출** |
| `test_column_of_inner_rects_all_faced` | 8756 | 동일 |
| `test_2x2_grid_all_faces_synthesize` | 8822 | 동일 |
| `test_multi_rect_stress_no_missing_cells` | 8850 | 동일 |
| `test_partial_overlap_all_adjacent_faces_mergeable` | 10236 | 동일 |

**LOCKED #1 ADR-051 P7 manifold canonical**:

| Test | Line | Update type |
|---|---|---|
| `test_p7_canonical_stacked_inner_manifold` | 10524 | **보존** (manifold verifier 자체 — Boundary 호출 후도 유효) |
| `test_p7_canonical_disjoint_inner_multi_hole` | 10586 | 동일 |
| `test_p7_canonical_sweep_locked_scenarios` | 10640 | 동일 |
| `test_p7_canonical_burge_centered_scenario_no_violations` | 10840 | 동일 |

**LOCKED #41 ADR-101 auto-intersect 회귀 (8 tests, line 14584-14834)**:

| Test | Line | Update type |
|---|---|---|
| `adr101_b4_two_rects_partial_overlap_auto_splits` | 14584 | **재작성** (자동 → 명시 Boundary 호출, ADR-139 Q4-a) |
| `adr101_b4_disjoint_rects_no_split` | 14642 | **보존** (의미 — disjoint 시 split 없음, 정합 유지) |
| `adr101_b4_non_coplanar_rects_no_split` | 14666 | **보존** (의미 동일) |
| `adr101_b4_disabled_flag_skips_split` | 14702 | **재작성** (`auto_intersect_on_draw` flag 폐기 후 — settings flag 자체 제거 가능) |
| `adr101_b4_two_circles_as_shape_partial_overlap_auto_splits` | 14732 | **재작성** (Boundary 명시 호출) |
| `adr101_b4b_two_path_b_circles_partial_overlap_auto_splits` | 14761 | 동일 |
| `adr101_b4b_disjoint_path_b_circles_preserve_kernel_native` | 14802 | **보존** (Path B kernel-native disjoint 의미 동일) |
| `adr101_b4_two_circles_partial_overlap_auto_splits` | 14834 | **재작성** |

### 2.4 axia-core integration tests — 7 files, ~36 tests

| File | Tests | Update type |
|---|---|---|
| `tests/burge_face_loss_repro.rs` | 6 | `stress_20_overlapping_rects_*` 의 자동 trigger 의존 — **재작성** (Boundary 명시 호출) |
| `tests/two_rects_merge_user_flow.rs` | 11 | 자동 merge 시점 변경 — **재작성** 또는 **명시 호출 expect** |
| `tests/primitive_auto_intersect.rs` | 3 | `primitive_*` auto intersect — **재작성** (자동 → 명시) |
| `tests/slice_volume_scene.rs` | 3 | volume slice — **보존** (Boolean Slice 명시 op) |
| `tests/intersect_with_model.rs` | 6 | `auto_intersect_on_draw_*` + Boolean intersect — **재작성** (auto_intersect_on_draw flag 자체 제거 후 명시 호출) |
| `tests/six_rect_chain.rs` | 4 | 6-RECT chain stress — **재작성** |
| `tests/repair_non_manifold.rs` | 3 | non-manifold repair — **보존** (ADR-097 trigger 독립) |

### 2.5 vitest TS layer — 7 Draw tools tests, ~96 it()

| File | it() count | Update type |
|---|---|---|
| `web/src/tools/DrawRectTool.test.ts` | 17 | 자동 face 합성 expectation — **재작성** (DrawRect 의 single-op 자동 face 보존, Q2-a) → 대부분 **보존** |
| `web/src/tools/DrawLineTool.test.ts` | 36 | DrawLine 자동 closed loop → face 합성 → **재작성** (DrawLine = 그리기 only, face 자동 0) |
| `web/src/tools/DrawCircleTool.test.ts` | 21 | DrawCircle single-op auto-face **보존** (Q2-a) → 대부분 **보존** |
| `web/src/tools/DrawPolygonTool.test.ts` | 8 | DrawPolygon single-op auto-face **보존** (Q2-a) → 대부분 **보존** |
| `web/src/tools/DrawBezierTool.test.ts` | 4 | DrawBezier 그리기 only → **보존** (현재 자동 face 없음) |
| `web/src/tools/DrawFreehandTool.test.ts` | 3 | DrawFreehand 그리기 only → **보존** |
| `web/src/tools/DrawCurveSettings.test.ts` | 7 | curve mode 설정 — **보존** (Boundary 무관) |

### 2.6 Playwright E2E — z0-* 9 specs, 56 tests

| Spec | Tests | Update type |
|---|---|---|
| `z0-drawing-coplanarity.spec.ts` | 6 | z=0 invariant — **보존** (Boundary 무관) |
| `z0-closed-loop-face-synthesis.spec.ts` | 6 | **재작성** (LOCKED #12 P11 자동 cycle synthesis → Boundary 명시 호출) |
| `z0-face-split-all-tools.spec.ts` | 8 | **재작성** (LOCKED #1 P7 + #41 자동 cross-tool split → Boundary 명시 호출) |
| `z0-rect-stress-split.spec.ts` | 5 | **재작성** (S4 finding + auto-intersect → Boundary 명시 호출) |
| `z0-user-mouse-drawing.spec.ts` | 5 | mouse simulation — **보존** (입력 layer 무관) |
| `z0-all-tools-cardinal.spec.ts` | 5 | cardinal force — **보존** (LOCKED #63 무관) |
| `z0-face-synthesis-split-cross-tool.spec.ts` | 14 | **재작성** (cross-tool split 자동 → Boundary 명시) |
| `z0-split-face-selection.spec.ts` | 5 | engine + selection logic — **재작성** (split trigger 자동 → 명시) |
| `z0-mouse-debug.spec.ts` | 2 | debug logging — **보존** |

## 3. Update type 매트릭스 (총 누적)

### 3.1 Update type 분류 정의

- **불변 (보존)** — Boundary tool 호출 후도 의미 동일, 코드 변경 0
- **명시 호출 추가** — 기존 자동 trigger expect → `bridge.boundaryFromClick(...)` 명시 호출 추가
- **재작성** — 자동 trigger 폐기 + 명시 호출 + 새 expectation
- **count 영향 가능** — 의미 변경 (자동 ring/hole pattern → Boundary 호출 후 결과)

### 3.2 누적 매트릭스

| Layer | Source | Total tests | 불변 | 명시 호출 추가 | 재작성 | count 영향 |
|---|---|---|---|---|---|---|
| axia-geo mesh.rs | resolve_planar_free_faces tests | ~12-15 | 1 (ADR-089 Phase 2) | ~11-14 | 0 | 0 |
| axia-geo coplanar.rs | ADR-101 phase tests | 37 | **37** | 0 | 0 | 0 |
| axia-core scene::tests | LOCKED #1 + ADR-051 + ADR-101 | ~38 | 6 (winding + manifold + draw order + disjoint) | ~24 | 8 (ADR-101 b4) | ~12 |
| axia-core integration | tests/*.rs | ~36 | 6 (slice + repair) | ~10 | ~20 | ~5 |
| vitest TS | Draw tools | ~96 | ~60 (Rect/Circle/Polygon/Bezier/Freehand/Curve) | 0 | ~36 (DrawLine) | 0 |
| Playwright E2E | z0-* specs | 56 | ~13 (coplanarity + mouse + cardinal + debug) | 0 | ~43 (closed-loop + split-all-tools + stress + cross-tool + selection) | ~10 |
| **합계** | — | **~275-280** | **~123** | **~45-48** | **~107** | **~27** |

### 3.3 핵심 finding

- **~123 tests (45%)** = **불변 보존** — Boundary tool 진입 후도 의미 동일, 코드 변경 0
- **~45-48 tests (17%)** = **명시 호출 추가** — 기존 expectation 보존 + Boundary 호출 trigger 명시화
- **~107 tests (39%)** = **재작성** — 자동 trigger 폐기 후 새 expectation (가장 큰 비용 — DrawLine 36 + cross-tool split 43)
- **~27 tests (10%)** = **count 영향 가능** — 의미 변경 시 검증

**위험 격리 evidence**: 약 **45% 회귀 자산이 불변 보존** — ADR-139 의 *결과 invariant* 보존 정합. 가장 위험한 layer 는 **vitest DrawLine (36 tests)** + **Playwright cross-tool split 자동 trigger (43 tests)**.

## 4. B-β implementation 진입 우선순위 (B-ζ audit 가이드)

### 4.1 추천 sub-step 분할

ADR-139 §14 의 B-β (~3-5일) 를 sub-step 으로 추가 분할 (audit-first canonical 정합):

| Sub-step | Scope | 비용 | 영향 회귀 |
|---|---|---|---|
| **B-β-1** | Engine — `auto_intersect_on_draw` flag default false + Scene wiring disable | ~1일 | axia-core 8+5 = 13 tests (ADR-101 b4 + integration auto_intersect_on_draw) |
| **B-β-2** | Engine — Step 4.99 (`resolve_planar_free_faces` fixed-point) auto disable | ~1일 | mesh.rs 12-15 + scene 자동 trigger 의존 |
| **B-β-3** | Engine — Step 4.95 second-pass + Phase 5/6 auto disable | ~1-2일 | LOCKED #1 P7 28 tests |
| **B-β-4** | TS — DrawLine 의 closed loop 자동 face 합성 폐기 | ~30분 | vitest DrawLine 36 tests |

**위험 격리**: B-β-1 부터 시작 (가장 적은 영향, Settings flag default false 로 사전 검토 가능).

### 4.2 B-β implementation entry "변경 예정 회귀 자산 매트릭스"

| 변경 site | 영향 회귀 | sub-step |
|---|---|---|
| `Scene::exec_draw_*` 자동 `intersect_faces_inner` 호출 | axia-core scene::tests adr101_b4 8 + intersect_with_model 6 | B-β-1 |
| `face_synthesis.rs` Step 4.99 `resolve_planar_free_faces` 자동 호출 | mesh.rs 12-15 tests + 일부 scene::tests | B-β-2 |
| `face_synthesis.rs` Step 4.95 second-pass + Phase 5/6 자동 호출 | LOCKED #1 P7 28 tests + integration 30+ tests | B-β-3 |
| `DrawLineTool` 의 closed loop 자동 face 합성 (TS) | vitest DrawLineTool 36 tests | B-β-4 |
| Playwright E2E z0-* face count expectation | E2E 43 tests | 모든 sub-step (cross-cutting) |

### 4.3 B-γ (Boundary tool engine API) 진입 시점

B-β 완료 후 즉시 진입:
- `Mesh::boundary_from_point(p, plane)` 신규 API
- 기존 `resolve_planar_free_faces` 본체 재활용 (cycle finder + Cardinal projection + BVH)
- 새 알고리즘 0 (ADR-139 §10 L-139-5)

## 5. 위험 분석 + 완화

### 5.1 위험 #1 — 자동 trigger 폐기 시 cross-cutting 영향

**위험**: B-β-1 이 `auto_intersect_on_draw` flag default false 만 변경해도 E2E z0-* 43 tests 동시 영향.

**완화**:
- B-β-1 의 PR 에 Playwright E2E **회귀 자산 update simultaneously** 강제
- B-β-1 의 회귀 자산 update plan 사전 단계에서 명시 (본 audit)
- `auto_intersect_on_draw` flag 자체 deprecation (default false → 폐기) 명시 staging

### 5.2 위험 #2 — DrawLine 의 closed loop 자동 face 합성 폐기 시 36 tests 동시 변경

**위험**: vitest DrawLineTool 36 tests 의 대부분이 *자동 closed loop face 합성* expectation 포함 가능.

**완화**:
- audit 단계에서 DrawLineTool 36 tests 의 *expectation 종류* 분석 (추가 audit 권장 — B-ζ-2)
- B-β-4 의 PR 에 DrawLine 36 tests 재작성 동시 포함 (atomic)

### 5.3 위험 #3 — burge.xia stress test (load_burge_inspect_state, stress_20_overlapping_rects_*) 영향

**위험**: `crates/axia-core/tests/burge_face_loss_repro.rs` 의 stress tests 가 자동 trigger 가정 강함. burge.xia fixture 자체가 자동 trigger 결과를 가정.

**완화**:
- burge.xia fixture 재생성 시 Boundary tool simulate 호출 시퀀스 추가
- `stress_20_overlapping_rects_auto_intersect_off` 의 기존 의미 (off mode) 가 새 Boundary 정책 default 와 일치 — 자연 정합 가능
- 별도 audit (B-ζ-3 — burge fixture audit) 권장

### 5.4 위험 #4 — `auto_intersect_on_draw` flag 의 사용자 facing 영향

**위험**: 현재 사용자가 SettingsPanel 에서 toggle 가능 (default true). 폐기 시 사용자 facing UX 변경.

**완화**:
- SettingsPanel 의 "자동 합성" 항목 *제거* (Boundary tool 안내로 대체)
- ADR-139 §10 L-139-A-6 의 회귀 자산 update plan 에 명시 포함
- 사용자 manual 시연 후 결재 (ADR-087 K-ζ canonical)

## 6. B-ζ atomic plan (사전 audit, 본 doc 후 자연 sub-step)

추가 audit sub-step (B-ζ 본체 의 사전 분할):

| Audit sub-step | Scope | 비용 | 산출물 |
|---|---|---|---|
| **B-ζ-1** | 본 doc (5 layer inventory + update type 매트릭스) | ~30분 | 본 audit doc |
| **B-ζ-2** | vitest DrawLineTool 36 tests 의 expectation 분류 audit | ~30분 | 별도 sub-doc 또는 본 doc amendment |
| **B-ζ-3** | burge.xia fixture 재생성 plan audit | ~30분 | 별도 sub-doc |
| **B-ζ-4** | SettingsPanel UX 영향 audit (auto_intersect_on_draw flag 제거) | ~30분 | 별도 sub-doc |

추가 audit 은 별도 PR 가능 (LOCKED #44 정합).

## 7. Lock-ins (audit 정책)

- **L-Bζ-1** audit-first canonical 8번째 적용 — β implementation 진입 전 위험 격리
- **L-Bζ-2** 총 ~275-280 회귀 자산 inventory 명시
- **L-Bζ-3** ~123 tests (45%) **불변 보존** — 결과 invariant 보존 정합
- **L-Bζ-4** ~107 tests (39%) **재작성** 필요 — 가장 큰 비용 (DrawLine 36 + E2E cross-tool split 43)
- **L-Bζ-5** B-β sub-step 분할 (B-β-1 ~ B-β-4) — 위험 격리 정합
- **L-Bζ-6** ADR-101 coplanar 37 tests **불변 보존** — `auto_intersect_coplanar` API 자체가 Boundary tool 본체 자산
- **L-Bζ-7** P7 핵심 invariant (그리기 순서 무관성 + winding 정책) **보존** — Boundary 호출 후도 유효
- **L-Bζ-8** burge.xia fixture 재생성 plan 별도 audit (B-ζ-3)
- **L-Bζ-9** SettingsPanel "자동 합성" 항목 제거 (B-ζ-4 후 명시)
- **L-Bζ-10** 절대 #[ignore] 금지 (모든 회귀 자산 update 후 PASS 강제)

## 8. Cross-link

- ADR-139 α spec (`docs/adr/139-boundary-tool-auto-cycle-deprecation.md`)
- ADR-139 B-β audit (`docs/adr/139-b-beta-audit-and-workaround.md`)
- LOCKED #1/#12/#41 (Superseded by ADR-139)
- LOCKED #44 (Complete Meaning per Merge — audit 자체가 complete meaning)
- 메타-원칙 #14 (WHAT layer 불변 보존)
- 메타-원칙 #16 (WHEN layer 신설 anchor)
- ADR-125/126/127/131/128/132/134 (audit-first canonical 1~7번째 적용 source)
- ADR-138 §B-β audit (14 tests identified, update type 분류 precedent)

## 9. Acceptance Log

- **2026-05-18 audit** (본 commit) — B-ζ audit 본 doc 완성. 5 layer inventory + update type 매트릭스 + 위험 분석.
- **(다음 단계)** — B-ζ-2/-3/-4 추가 audit (선택) 또는 B-β implementation 진입 (사용자 결재).

---

**다음 trigger**: B-ζ-2 (DrawLine 36 tests audit) 또는 B-β implementation 진입 — 사용자 결재 후.
