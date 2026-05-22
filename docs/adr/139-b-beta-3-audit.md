# ADR-139 B-β-3 — audit (Step 4.95 second-pass + Phase 5/6 disable 사전 검토)

**Status**: Accepted (docs only — audit-first canonical 10번째 적용)
**Date**: 2026-05-21
**Author**: WYKO + Claude
**관련 ADR**: ADR-139 §14 B-β-3 atomic sub-step
**Path Z position**: B-β-2 closure (PR #130) + B-β-4 audit pivot (PR #131)
  → **B-β-3 audit (본 doc)** → B-β-3 implementation

## 1. 목적

ADR-139 §14 의 **가장 큰 β implementation sub-step** (B-β-3 — Step 4.95
second-pass + Phase 5/6 disable, ~1-2일, 가장 큰 위험) 의 *사전 검토*.
B-β-3 implementation 진입 *전* 영향받을 회귀 자산 + 코드 site 를
inventory + 분류 → **위험 격리** + sub-step 추가 분할 권장.

**Canonical pattern (audit-first 10번째 적용)**:
ADR-125/126/127/131/132/134 + B-ζ audit (B-ζ-1) + ADR-128 priority +
B-β-4 audit pivot + 본 doc.

## 2. 영향 site inventory

### 2.1 Step 4.95 (P7 ring rebuild) — LOCKED #1 ADR-021 P7 본체

**위치**: `crates/axia-core/src/scene.rs:2967-3273` (약 **307 lines**)

**의미**: 닫힌 line 이 기존 face 안에 enclose 되면 자동으로 ring + N hole
패턴 생성. LOCKED #1 ADR-021 P7 의 본체 logic.

**Algorithm summary**:
1. Phase A — 모든 active face 수집 (simple + ring 둘 다 inner candidate)
2. Phase B — face 사이의 containment 검사 (point-in-polygon)
3. Phase C — container 별 inner 그룹 → connected component 분리
4. 각 component 의 combined perimeter 를 hole loop 로 사용
5. Container = ring with N holes 변환 (DCEL surgery)

**ADR-051 P-1 강화**: post-op `verify_p7_manifold` (P7-M1/M2/M3) 검증.

### 2.2 Phase 5 (DFS cycle finder)

**위치**:
- 함수 정의: `crates/axia-core/src/scene.rs:3544` (`mop_up_orphan_cycles_via_dfs`)
- 호출 site (자동): `crates/axia-core/src/scene.rs:3350` (run_face_synthesis_postprocess)
- 호출 site (명시): `crates/axia-core/src/scene.rs:3508` (`resynthesize_orphan_faces` — User-callable command)

**의미**: leftmost-turn 단일 패스가 놓친 케이스의 brute-force DFS mop-up.
27-RECT 스트레스에서 10 → 6 orphans (60% 감소) 효과.

**알고리즘**: 잔존 orphan edges 그래프에서 simple cycle 을 brute-force
DFS 로 찾아 face 합성. `MAX_ROUNDS = 8` bounded.

**보존 필요**: User-callable `resynthesize_orphan_faces` command 은 명시
opt-in 이므로 ADR-139 Boundary tool 정합 — *함수 자체는 보존*, 자동
호출 site (line 3350) 만 disable.

### 2.3 Phase 6 (strand absorption)

**위치**:
- 함수 정의: `crates/axia-core/src/scene.rs:3395` (`absorb_orphan_strands_into_faces`)
- 호출 site: `crates/axia-core/src/scene.rs:3358` (run_face_synthesis_postprocess)

**의미**: 잔존 orphan strand (cycle 없는 dangling edge) 를 enclosing
face 의 boundary 에 흡수. 양 endpoint 가 같은 face 의 outer loop 위에
있으면 `split_face_by_chain` 으로 face 를 둘로 분할 → strand 가 boundary
가 됨.

**자동 trigger 의미**: 사용자 의도 없이 strand 가 face 분할로 흡수됨 —
LOCKED #1 P7 자동 split 의 일종.

### 2.4 Phase 7 (closed-shape finalizer) — 보존 대상

**위치**: `crates/axia-core/src/scene.rs:3367+` (`cleanup_dangling_topological_edges`)

**의미**: DrawRect / DrawCircle 의 finalizer 에서만 호출되는 명시 cleanup.

**ADR-139 보존 결정 (Q2-a)**: DrawRect / DrawCircle single-op auto-face
는 보존 → Phase 7 STRICT 도 보존. **B-β-3 scope 외**.

### 2.5 dissolve_containing_faces 호출 (Step 4.55 답습)

**위치**: `crates/axia-core/src/scene.rs:2843`

**의미**: connector edge 흡수 (true connector: 한쪽 outer-only + 한쪽
inner-only). LOCKED #4 dissolve_containing_faces Connector 정의 정합.

**ADR-139 영향**: 의도 무관 자동 흡수 — B-β-3 scope 후보. 하지만 LOCKED
#4 의 본질 (connector 정의) 은 보존 필요. **별도 sub-step 권장** (B-β-3
scope 외 또는 B-β-3d).

## 3. 영향 회귀 자산 매트릭스

### 3.1 axia-core scene::tests — LOCKED #1 ADR-021 P7 28 tests

B-ζ audit §2.3 이 식별한 28 tests. 모두 자동 containment split (Step
4.95) 의존.

| Test category | Tests | Update type (B-β-3 후) |
|---|---|---|
| LOCKED #1 P7 case A/B (ADR-021) | 2 | **명시 호출 추가** (\`scene.auto_face_synthesis_on_draw = true\`) |
| stacked-inner / containment | 11 | **명시 호출 추가** |
| L-shape / 2×2 grid / multi-RECT stress | 5 | **명시 호출 추가** |
| draw_order_independence (P7 핵심 invariant) | 1 | **명시 호출 추가** (그리기 순서 무관성 보존 검증) |
| overlap / partial overlap | 7 | **명시 호출 추가** |
| winding consistency | 1 | **보존** (winding 정책 독립) |
| (기타) | 1 | (audit 추후 분류) |

**모두 동일 패턴 update**: 1-line `scene.auto_face_synthesis_on_draw = true;`
추가 (B-β-2 의 회귀 자산 update 정합).

### 3.2 axia-core scene::tests — ADR-051 P-1 verify_p7_manifold 4 tests

| Test | Update type |
|---|---|
| `test_p7_canonical_stacked_inner_manifold` | **명시 호출 추가** |
| `test_p7_canonical_disjoint_inner_multi_hole` | **명시 호출 추가** |
| `test_p7_canonical_sweep_locked_scenarios` | **명시 호출 추가** |
| `test_p7_canonical_burge_centered_scenario_no_violations` | **명시 호출 추가** |

### 3.3 axia-core scene::tests — DrawLine cycle 의존 tests

B-ζ audit §2.3 의 추가 tests (Line cycle 으로 face 합성 expectation):

| Test pattern | Tests | Update type |
|---|---|---|
| `Command::DrawLine × N` closed loop → face | ~10-15 | **명시 호출 추가** (auto_face_synthesis flag) |
| Triangle / Polygon line cycles | ~5-8 | **명시 호출 추가** |

**예상 합계**: scene::tests ~45-50 tests update.

### 3.4 axia-core integration tests (tests/*.rs)

| File | Tests | Update type |
|---|---|---|
| `tests/burge_face_loss_repro.rs` | 6 | **명시 호출 추가** (auto_face_synthesis flag) — burge.xia fixture 의존 |
| `tests/two_rects_merge_user_flow.rs` | 11 | **명시 호출 추가** |
| `tests/six_rect_chain.rs` | 4 | **명시 호출 추가** |
| `tests/intersect_with_model.rs` | 6 | **이미 B-β-1 처리** ✓ |
| `tests/primitive_auto_intersect.rs` | 3 | **이미 B-β-1 처리** ✓ |
| `tests/slice_volume_scene.rs` | 3 | **불변** (Boolean Slice 명시 op) |
| `tests/repair_non_manifold.rs` | 3 | **불변** (ADR-097 trigger 독립) |

**예상 합계**: integration ~21 tests update.

### 3.5 Playwright E2E specs

| Spec | Tests | Update type (B-β-3 후) |
|---|---|---|
| `z0-closed-loop-face-synthesis.spec.ts` | 6 | **이미 B-β-2 처리** ✓ (auto_face_synthesis 'true' opt-in) |
| `z0-face-split-all-tools.spec.ts` | 8 | **이미 B-β-2 처리** ✓ (auto_face_synthesis 추가) |
| `z0-face-synthesis-split-cross-tool.spec.ts` | 14 | **auto_face_synthesis 'true' opt-in 추가** |
| `z0-rect-stress-split.spec.ts` | 5 | **auto_face_synthesis 'true' opt-in 추가** |
| `z0-split-face-selection.spec.ts` | 5 | **auto_face_synthesis 'true' opt-in 추가** |
| `adr-101-b6-visual-demo.spec.ts` | 4 | **auto_face_synthesis 추가** |
| `adr-101-b6-user-demo-verify.spec.ts` | 4 | **auto_face_synthesis 추가** |

**예상 합계**: E2E ~40 tests update (4 specs 의 localStorage init script 1-line 추가).

### 3.6 vitest TS layer

| File | Tests | Update type |
|---|---|---|
| DrawLineTool.test.ts | 36 | **불변** (B-β-4 audit closure — TS layer 영향 0) |
| 기타 Draw tools | ~60 | **불변** (mock bridge, engine 무관) |

**예상 합계**: vitest 0 tests update.

## 4. 누적 매트릭스

| Layer | Tests | 불변 | 명시 호출 추가 | 재작성 | count 영향 |
|---|---|---|---|---|---|
| axia-core scene::tests (LOCKED #1 P7) | 28 | 1 | 27 | 0 | 0 |
| axia-core scene::tests (ADR-051) | 4 | 0 | 4 | 0 | 0 |
| axia-core scene::tests (DrawLine cycles) | ~15 | 0 | 15 | 0 | 0 |
| axia-core integration | 21 | 6 | 15 | 0 | 0 |
| Playwright E2E | ~40 | 23 (이미 처리) | ~17 (4 specs) | 0 | ~5 (face count 변화) |
| vitest TS | 96 | 96 | 0 | 0 | 0 |
| **합계 (B-β-3 new update)** | **204** | **126** | **78** | **0** | **5** |

**핵심 finding**:
- **78 tests 명시 호출 추가** (대부분 1-line 변경)
- **0 tests 재작성** — B-β-3 는 *flag wrap* 만, expectation 변경 없음
- **B-β-1 + B-β-2 + B-β-3 누적 영향**: 약 91 tests update (78 새로 + 13 이미 처리)

## 5. Sub-step 분할 권장 (위험 격리)

B-β-3 implementation 의 ~78 tests update 가 **single atomic PR** 으로 LOCKED #44
정합 가능하지만, 위험 격리를 위해 sub-step 분할 권장:

| Sub-step | Scope | 영향 tests | 비용 |
|---|---|---|---|
| **B-β-3a** | Step 4.95 (P7 ring rebuild, line 2967-3273) wrap with flag | 28 (LOCKED #1 P7) + 4 (ADR-051) = 32 | ~1일 |
| **B-β-3b** | Phase 5 + Phase 6 (자동 호출 site, lines 3350+3358) wrap with flag | DrawLine cycle ~15 + integration ~15 = ~30 | ~30분-1시간 |
| **B-β-3c** | Playwright E2E specs 4개 localStorage opt-in 추가 | ~40 E2E tests | ~30분 |

**Lock-ins**:
- **L-Bβ3-1** Step 4.95 + Phase 5 + Phase 6 모두 *같은 flag* (`auto_face_
  synthesis_on_draw`) 로 gate (B-β-2 의 flag 확장)
- **L-Bβ3-2** User-callable `resynthesize_orphan_faces` command (line 3501)
  은 *명시 호출* 이므로 보존 (Boundary tool 정합)
- **L-Bβ3-3** Phase 7 STRICT (closed-shape finalizer) **보존** (Q2-a)
- **L-Bβ3-4** dissolve_containing_faces (Step 4.55) 별도 sub-step (LOCKED
  #4 본질 보존)

**대안** — single atomic PR (B-β-3a+b+c 통합):
- LOCKED #44 정합 강함 (single complete meaning)
- ~78 tests update + 4 E2E specs 동시 변경
- ~1-2일 atomic
- 위험 中-高 (큰 scope, but pattern 단순 — 1-line update)

**추천**: **single atomic PR** (Step 4.95 + Phase 5 + Phase 6 같은 flag
+ 모든 영향 tests + E2E specs 한꺼번에). 패턴 단순 (1-line update 반복)
이고 LOCKED #44 정합.

## 6. Flag 설계

기존 `auto_face_synthesis_on_draw` flag (B-β-2 에서 신설) 의 *의미 확장*:

**현재 (B-β-2)**: Step 4.99 (`resolve_planar_free_faces` final sweep) 만 gate

**B-β-3 후**: Step 4.95 + Step 4.99 + Phase 5 + Phase 6 모두 gate
- 의미: "자동 face synthesis 활성" (closed cycle / containment / orphan
  strand 모두 자동 처리)

**의미 일관성**: 단일 toggle = 사용자 facing 단순. 별도 flag 분리 시 사용자
혼란 (ADR-046 P31 #1 "가볍게" 정합 차이).

## 7. 위험 분석 + 완화

### 7.1 위험 #1 — LOCKED #1 P7 28 tests 동시 변경

**위험**: B-β-3 PR 이 28 tests 동시 update 시 review burden + 회귀 위험.

**완화**:
- 패턴 단순 (1-line `scene.auto_face_synthesis_on_draw = true;` 추가)
- B-β-1 의 4 tests + B-β-2 의 0 tests update 패턴 답습
- Sub-step 분할 가능 (B-β-3a / B-β-3b / B-β-3c)

### 7.2 위험 #2 — burge.xia stress test 영향

**위험**: `tests/burge_face_loss_repro.rs` 의 stress tests 가 자동 trigger
가정. burge.xia fixture 자체가 자동 trigger 결과를 가정.

**완화**:
- 6 tests 모두 `scene.auto_face_synthesis_on_draw = true;` 명시 opt-in
- burge.xia fixture 자체 재생성 plan 별도 (B-ζ-3 audit, future)

### 7.3 위험 #3 — Playwright E2E specs face count 변경

**위험**: 일부 E2E specs 의 face count assertion 이 자동 trigger 의존.

**완화**:
- 4 specs (cross-tool, stress, selection, b6 visual) localStorage opt-in
  추가 (1-line per spec)
- Visual baseline 영향 0 (B-β-3 가 flag wrap 만, 의미 동일)

### 7.4 위험 #4 — Phase 5 user-callable command 보존

**위험**: `resynthesize_orphan_faces` (line 3501) 가 `mop_up_orphan_cycles_via_dfs`
의존. Phase 5 disable 시 명시 호출도 영향 받을 우려.

**완화**:
- `mop_up_orphan_cycles_via_dfs` 함수 자체는 **보존** (public, user-callable)
- 자동 호출 site (line 3350) 만 wrap with flag
- `resynthesize_orphan_faces` 의 명시 호출 (line 3508) 영향 0

## 8. 사용자 facing 변화 (B-β-3 후)

### 8.1 변화

- **새 사용자**:
  * DrawLine × 4 closed square 그려도 *자동 face 생성 안 됨* (Step 4.99
    + Phase 5 + Phase 6 모두 OFF)
  * RECT × inner RECT containment 그려도 *자동 ring + hole 변환 안 됨*
    (Step 4.95 OFF)
  * orphan strand 가 face 에 자동 흡수 안 됨 (Phase 6 OFF)
- **legacy 사용자**: localStorage `'axia:auto-face-synthesis-on-draw' =
  'true'` 명시 설정 시 기존 동작 모두 보존
- **DrawRect / DrawCircle**: single-op auto-face 보존 (Q2-a, Phase 7 STRICT)
- **사용자 시연**: P5.UX.39-45 cascading fixes 패턴 *본격* 회피 시작 —
  자동 trigger 의 모호성 제거

### 8.2 보존

- DrawRect / DrawCircle / DrawPolygon single-op auto-face (Q2-a)
- User-callable `resynthesize_orphan_faces` command (Boundary tool 정합)
- ADR-051 verify_p7_manifold (manifold safety 보장)
- LOCKED #4 dissolve_containing_faces 본질 (별도 sub-step)

## 9. Lock-ins (B-β-3 implementation 진행 시)

- **L-Bβ3-1** Flag 의미 확장 — `auto_face_synthesis_on_draw` 가 Step
  4.95 + Step 4.99 + Phase 5 + Phase 6 모두 gate
- **L-Bβ3-2** User-callable `resynthesize_orphan_faces` 보존 (명시 호출)
- **L-Bβ3-3** Phase 7 STRICT 보존 (Q2-a single-op auto-face)
- **L-Bβ3-4** LOCKED #4 dissolve_containing_faces 본질 보존 (별도 sub-step)
- **L-Bβ3-5** 모든 회귀 자산 update 패턴 단순화 — 1-line `scene.auto_
  face_synthesis_on_draw = true;` 추가
- **L-Bβ3-6** E2E specs localStorage opt-in 추가 (4 specs)
- **L-Bβ3-7** ADR-051 verify_p7_manifold post-op 검증 보존 (manifold safety)
- **L-Bβ3-8** 절대 #[ignore] 금지

## 10. Lessons (audit-first 10번째 적용)

- **L1** Audit-first canonical 10번째 적용 — ADR-125/126/127/131/132/134
  + B-ζ + ADR-128 + B-β-4 pivot + 본 doc
- **L2** Code site inventory + line numbers 명시 — implementation 시
  exact target locations
- **L3** Sub-step 분할 권장 + alternative (single atomic) — LOCKED #44
  정합 양쪽 모두 valid
- **L4** Flag 의미 확장 vs 새 flag 분리 — *사용자 facing 단순* 우선
  (ADR-046 P31 #1)
- **L5** User-callable command 보존 명시 (architectural separation —
  자동 trigger vs 명시 trigger)

## 11. Cross-link

- ADR-139 α / B-β audit / B-ζ audit / B-η/θ/κ/λ / B-β-1 / B-β-2 / B-β-4 pivot
- LOCKED #1 ADR-021 P7 (Superseded — Step 4.95 본 wrap)
- LOCKED #12 ADR-025 P11 (Superseded — Phase 5/6 본 wrap)
- LOCKED #4 dissolve_containing_faces (Connector 정의 — 별도 sub-step)
- ADR-051 P-1 verify_p7_manifold (manifold safety 보존)
- ADR-046 P31 #1 "가볍게" (단일 flag 의미 확장 선택 근거)
- LOCKED #44 (Complete Meaning per Merge)

## 12. Acceptance Log

- **2026-05-21 audit** (본 commit) — B-β-3 사전 검토. Step 4.95 + Phase 5
  + Phase 6 의 3 site inventory + ~78 tests 영향 매트릭스 + 위험 분석
  + sub-step 분할 plan + flag 의미 확장 결재 후보.
- **(다음 단계)** — B-β-3 implementation 진입 (single atomic 또는 sub-
  step 분할, 사용자 결재) 또는 사용자 시연 baseline.

---

**다음 trigger**: B-β-3 implementation (single atomic 또는 B-β-3a / B-β-3b
/ B-β-3c sub-step 분할) — 사용자 결재.
