# ADR-138 — Multi-loop Face Policy Re-architecting (α spec)

**Status**: Superseded by ADR-139 (2026-05-18, 사용자 결재 Q5=a)
  — Pure Boundary Tool 정책이 자동 trigger 폐기 → multi-loop face 자체
  안 생성 → ADR-138 Path B 자연 흡수. ADR-138 의 핵심 의도 (multi-loop
  회피) 는 ADR-139 의 자연 결과로 달성.
**Date**: 2026-05-18
**Author**: WYKO (사용자 결재) + Claude
**Supersedes candidates** (ADR-138 자체): LOCKED #1 ADR-021 P7 amendment + ADR-016 Q2
**Superseded by**: ADR-139 (Boundary Tool + Auto-cycle Deprecation, Q5=a 흡수)

## Canonical anchor (사용자 결재, 2026-05-18)

> "정책이 잘못되었네요" (LOCKED #1 P7 amendment multi-loop face 거부 정책)
> "쉽게 가려면? 큰원안에 작은원이있으면 큰원에서 작은원을 빼고 작은원만 다시 생성?"

PR #101 (LOCKED #63 z=0 invariant closure) 의 stress test (S4) 가 발견한
*면분할의 architectural finding* — 사용자 통찰로 *정책 자체의 근본 재정의*
필요성 명시. 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다") 의 가장
깊은 적용.

## 1. Problem statement

### 1.1 현재 정책 (잘못된 정책으로 인정됨)

**LOCKED #1 ADR-021 P7 amendment** (LOCKED #1 §1):
> "Multi-loop face 도구 정책 (ADR-016 Q2 그대로): Push/Pull / Boolean /
>  Offset / hole boundary fillet → 거부 + Toast."

**LOCKED #41 ADR-101 §B-3b 답습**:
- Ring face (containment 후 hole 있는 face) 와 partial overlap RECT →
  ADR-101 auto-intersect skip (multi-loop face 정책 정합)

### 1.2 S4 Finding (사용자 stress test evidence, PR #101)

```
S4 sequence (z0-rect-stress-split.spec.ts):
1. outer 10×10                       → face 1
2. inner contained 3×3 (P7 split)    → face 2 (ring + hole formed)
3. partial overlap NE with ring      → face 3 (❌ ring 분할 skip, +1 only)
4. partial overlap SW with ring      → face 4 (동일)
5. disjoint E                        → face 5
6. disjoint W                        → face 6

기대 (사용자 정합): 8+ faces (모든 partial overlap auto-split)
실측: 6 faces (ring 와 overlap 부분 skip)
```

### 1.3 메타-원칙 #14 와의 충돌

**메타-원칙 #14**: "면은 닫힌 경계로부터 유도된다"

- Ring face 도 *닫힌 경계 (outer + inner loops)* 의 자연 결과
- Ring 위 *또 다른 닫힌 경계* (partial overlap) → *또 분할되어야* (자연 정합)
- "거부" 는 메타-원칙 #14 의 *partial 적용* — architectural 일관성 위반

### 1.4 CAD 핵심 워크플로 영향

- Pocket 만들고 → 그 안에 추가 detail → **자연 분할 기대** (사용자 의도)
- Push/Pull 한 face 안에 detail 추가 → **자연 분할 기대**
- Ring face 위 partial overlap → **자연 3 sub-face 기대**

## 2. Two architectural paths (사용자 통찰 + 기존 접근)

### Path A — Multi-loop 유지 + Op 재활성 (기존 접근의 자연 진화)

**Concept**: ring face (multi-loop) 그대로 유지. 모든 op (Push/Pull /
Boolean / Offset / ADR-101 auto-split / fillet) 활성. ADR-051 의 강화된
`verify_p7_manifold` 로 post-op manifold 안전 보장.

**기존 자산 활용**:
- ADR-051 P-1: `verify_p7_manifold(mesh, container, inners)` (P7-M1/M2/M3)
- LOCKED #1 P7 v1.1 (component-merge resolver)
- 모든 LOCKED #1 회귀 자산 11+ tests

**변경 필요**:
- LOCKED #1 P7 amendment 의 "거부" 정책 폐기
- ADR-016 Q2 multi-loop face 도구 정책 폐기
- 각 op (Push/Pull / Boolean / Offset / fillet / ADR-101 auto-split) 에
  multi-loop face 입력 처리 추가
- post-op `verify_p7_manifold` 강제 호출

### Path B — Multi-loop 회피 (사용자 새 제안)

**Concept**: containment 시 ring + hole 패턴 *생성 안 함*. 두 simple
face (outer + inner) 만 생성. multi-loop face 자체 deprecation.

**Architectural simplification**:
- 모든 face = simple (single closed outer loop)
- multi-loop manifold safety 이슈 *영구 회피*
- ADR-016 Q2 / LOCKED #1 P7 amendment 거부 정책 *불필요*
- ADR-051 verify_p7_manifold *불필요*
- 모든 op 자연 작동 (single-loop face 만 다루면 됨)

**변경 필요**:
- LOCKED #1 ADR-021 P7 *근본 재정의* (containment 정책 변경)
- LOCKED #1 P7 회귀 자산 11+ tests 모두 update (ring → 두 simple)
- Render 시 z-fighting 해결 (두 simple face 동일 z=0)
- 사용자 "구멍" 의도 별도 explicit op (Boolean Difference, Pocket)
- STEP/IGES import 시 hole face → 두 simple face 변환
- STEP/IGES export 시 두 simple face → hole 표현 변환

## 3. Trade-off 정량 매트릭스

| 측면 | Path A (multi-loop 유지) | Path B (multi-loop 회피) |
|---|---|---|
| **Architectural complexity** | High (multi-loop safety 처리) | **Low** (single-loop only) |
| **메타-원칙 #14 정합** | 부분 (multi-loop 거부 정책 잔존) | **완전** (모든 닫힌 경계 = simple face) |
| **모든 op 자연 작동** | 추가 처리 필요 (per-op multi-loop handling) | **자연** (single-loop only) |
| **manifold safety 보장** | post-op `verify_p7_manifold` 강제 | **자동** (single-loop = 자연 manifold) |
| **LOCKED #1 회귀 자산 영향** | 보존 (P7 의미 유지) | **변경 필요** (P7 근본 재정의) |
| **Industry CAD parity** | hole = first-class (STEP/IGES 표준) | hole = Boolean 변환 (round-trip 시 변환 필요) |
| **Render z-fighting** | 없음 (별개 face) | **있음** (depth offset 해결책 필요) |
| **사용자 "구멍" 의도 UX** | 자연 (containment 자체가 hole) | **explicit op 필요** (Boolean Difference) |
| **Push/Pull / Boolean / Offset 활성** | 추가 구현 필요 | **자연 활성** |
| **ADR-101 auto-split 활성** | multi-loop face 처리 추가 | **자연 활성** (모든 case) |
| **β implementation 비용** | multi-week (per-op 확장) | **multi-week** (정책 재정의 + 자산 변경) |
| **사용자 시연 evidence (S4 finding)** | 사용자 facing fix 가능 | **자동 fix** |
| **사용자 가치 unlock 시점** | per-op 점진 | **즉시** (정책 변경만으로) |

## 4. Path B 의 세부 정책 (사용자 결재 시)

### 4.1 Containment 의 새 의미

**Before (Path A 동일, 현재 LOCKED #1 P7)**:
- 큰 원 + 안쪽 작은 원 → 큰 원이 hole 형성, 작은 원이 hole 채움
- 결과: 1 ring face (outer + inner loop) + 1 simple face (inner)

**After (Path B 사용자 제안)**:
- 큰 원 + 안쪽 작은 원 → **둘 다 simple face**
- 큰 원: simple (outer loop only) — 구멍 없음
- 작은 원: simple (outer loop only) — 큰 원 위에 overlap
- 두 face 동일 z=0 plane → render 시 작은 원 우선 (depth offset 또는 priority)

### 4.2 사용자 click selection

| 시나리오 | 동작 |
|---|---|
| 큰 원의 작은 원 *위치 외* click | 큰 원 simple face 선택 |
| **작은 원 위치 click (둘 다 overlap)** | **작은 원 우선** (depth order — sub-face 우선) |
| Ctrl+click 으로 cycle | 큰 원 / 작은 원 토글 |

### 4.3 "구멍" 의도 시 explicit op

사용자가 *진짜 구멍* 원할 때:
- Boolean Difference 도구 (큰 원 - 작은 원 → ring face)
- 또는 Pocket 도구 (Push/Pull 의 inverse — 작은 원을 빼면서 큰 원 split)
- 이 op 들은 multi-loop face 생성 가능 (별도 LOCKED 정책 — Path A 답습)

### 4.4 ADR-101 auto-intersect 와 정합

Path B 채택 시 ADR-101 의 multi-loop face skip 자체 무효 — 모든 face 는
single-loop. 자연 작동.

### 4.5 Render 시 z-fighting 해결

**Option 1 — Depth offset (권장)**:
- 작은 face (inner) 가 큰 face (outer) 위 1μm offset
- 시각 priority + raycaster 자연 작동

**Option 2 — Render order priority**:
- Three.js `renderOrder` 로 작은 face 우선
- z-fighting 없음

**Option 3 — Sub-face detection (sort by area)**:
- 작은 area face 우선 render (자연 priority)

### 4.6 STEP/IGES round-trip

**Import (외부 → AxiA)**:
- 외부 ring face 발견 → AxiA 의 큰 simple + 작은 simple 변환
- Boolean Difference op 자동 적용 (의미 보존)

**Export (AxiA → 외부)**:
- 두 simple face overlap 검출 → ring face 변환 (STEP 표준)
- 사용자 의도 "구멍 vs 겹침" 구분 시 metadata 활용

## 5. β implementation Path (둘 다 사용자 결재 후)

### Path A β implementation (multi-week atomic)

1. LOCKED #1 P7 amendment 폐기 docs
2. ADR-016 Q2 multi-loop 정책 폐기 docs
3. Per-op multi-loop face handling 추가 (Push/Pull / Boolean / Offset / fillet)
4. post-op `verify_p7_manifold` 강제 호출
5. ADR-101 auto-intersect multi-loop face 확장
6. 회귀 자산 (existing LOCKED #1 11+ 유지 + 새 multi-loop op test 추가)

### Path B β implementation (multi-week atomic)

1. LOCKED #1 ADR-021 P7 *근본 재정의* docs (containment → 두 simple)
2. ADR-016 / ADR-051 무효화 docs (multi-loop face deprecation)
3. Engine: `containment_detect` → multi-loop 생성 안 함, 두 simple face 유지
4. Render: z-fighting 해결 (depth offset 또는 renderOrder)
5. Selection: depth order priority (sub-face 우선)
6. STEP/IGES round-trip: import 시 ring → 두 simple 변환, export 시 역
7. Explicit "구멍" op 추가 (Boolean Difference / Pocket tool)
8. 회귀 자산 update — LOCKED #1 P7 11+ tests 모두 새 정책 정합

## 6. 추천 비교 + 사용자 결재 trigger

### 6.1 Architectural simplicity 우선 시 → Path B

- 메타-원칙 #14 의 가장 깊은 적용
- multi-loop face 영원 제거 → 모든 op 자연 단순
- 사용자 통찰 직접 정합

### 6.2 Backward compat 우선 시 → Path A

- 기존 LOCKED #1 회귀 자산 보존
- Industry CAD parity (STEP/IGES hole) 유지
- per-op 점진 활성 가능

### 6.3 사용자 결재 trigger (β implementation 진입 시)

- **(Q1)** Path A vs Path B 선택
- **(Q2)** 만약 Path B — z-fighting 해결책 (depth offset / renderOrder / area priority)
- **(Q3)** 만약 Path B — "구멍" 의도 explicit op (Boolean Difference / Pocket)
- **(Q4)** 만약 Path B — STEP/IGES round-trip 변환 정책
- **(Q5)** β implementation 우선순위 (즉시 / 다음 priority track)

## 7. Lock-ins (β implementation 진행 시, Path 결정 후)

### 공통 Lock-ins

- **L-138-1** S4 finding 의 architectural root cause 명시 documentation
- **L-138-2** 메타-원칙 #14 정합 강화 (Path 무관)
- **L-138-3** PR #101 LOCKED #63 z=0 invariant 와 독립 (별도 의미 단위)
- **L-138-4** ADR-101 auto-intersect scope 확장 (Path A: multi-loop 처리 / Path B: 자연 활성)
- **L-138-5** 회귀 자산 update — LOCKED #1 P7 11+ tests 영향 명시

### Path A 전용 Lock-ins

- **L-138-A-1** LOCKED #1 P7 amendment 폐기, ADR-016 Q2 폐기 docs
- **L-138-A-2** post-op `verify_p7_manifold` 강제 호출 (ADR-051 강화)
- **L-138-A-3** Per-op multi-loop face handling 추가 (Push/Pull / Boolean / Offset / fillet)

### Path B 전용 Lock-ins

- **L-138-B-1** LOCKED #1 ADR-021 P7 근본 재정의 (containment 정책 변경)
- **L-138-B-2** Multi-loop face deprecation (ADR-016 / ADR-051 무효화)
- **L-138-B-3** Render z-fighting 해결책 (Q2 결재 후)
- **L-138-B-4** Selection depth priority (sub-face 우선)
- **L-138-B-5** Explicit "구멍" op 추가 (Boolean Difference / Pocket tool)
- **L-138-B-6** STEP/IGES round-trip 변환 정책 (Q4 결재 후)

## 8. Out of scope (별도 ADRs)

- Snap re-introduction (ADR-137 α spec 별도 트랙)
- Face split downstream sync coherence (ADR-136 α spec 별도 트랙)
- Push/Pull semantics on multi-loop face (Path A 채택 시 separate sub-ADR)
- Boolean Difference 도구 (Path B 채택 시 separate sub-ADR)

## 9. Cross-link

- LOCKED #1 ADR-021 P7 (현재 정책 — supersede candidate)
- LOCKED #1 amendment (ADR-016 Q2 multi-loop 거부)
- LOCKED #1 ADR-051 (verify_p7_manifold — Path A 강화 candidate)
- LOCKED #41 ADR-101 (coplanar partial overlap — S4 finding trigger)
- LOCKED #44 (Complete Meaning per Merge — 본 ADR 별도 PR)
- LOCKED #63 (z=0 invariant closure — 본 ADR 의 trigger source PR #101)
- 메타-원칙 #14 (canonical anchor — "면은 닫힌 경계로부터 유도된다")
- 메타-원칙 #10 (ADR 불변 — Path 선택 시 새 ADR + Superseded)
- ADR-136 α spec (face split downstream sync — orthogonal)
- ADR-137 α spec (Guidance-only Snap — orthogonal)
- ADR-087 K-ζ canonical (사용자 시연 게이트 → 본 ADR trigger)

## 10. Acceptance Log (α spec + β plan)

- **2026-05-18 α**: α spec 작성 (PR #101 closure 후 사용자 통찰 evidence)
  - Trigger 1: S4 finding (ring face partial overlap split skip)
  - Trigger 2: 사용자 결재 "정책이 잘못되었네요"
  - Trigger 3: 사용자 통찰 "쉽게 가려면 큰원에서 작은원을 빼고 작은원만
    다시 생성"
  - Scope: α spec only — β implementation 별도 사용자 결재 (Path A vs B)
- **2026-05-18 amendment (사용자 결재 Q1~Q5)**:
  - **Q1 = Path B 채택** ✅ (사용자 통찰 "쉽게 가려면" + AxiA 컨셉 "단순/빠름/신속/정확" 정합)
  - **Q2 = (a) Depth offset 1μm** ✅ (LOCKED #5 1.5μm 미만, runtime 비용 0)
  - **Q3 = (a) Boolean Difference 도구 (이미 존재)** ✅ (industry standard, "구멍" explicit)
  - **Q4 = (a) STEP/IGES round-trip 자동 변환** ✅ (import ring → 두 simple, export 역)
  - **Q5 = (a) 즉시 진행** ✅ (별도 PR per LOCKED #44)
  - 사용자 추가 reasoning: "연산도 오래걸리고 우리 컨셉인 단순하고 빠르고
    신속하며 정확한 개념에 정합" (Path B 의 architectural 가치 강화)
- **(β implementation): atomic sub-step Path Z 답습** (multi-week)

## 11. β implementation atomic sub-step plan (B-α ~ B-ι)

**Path Z atomic 패턴** (ADR-094 / ADR-097 / ADR-099 답습):

| Sub-step | Scope | 비용 | 의존성 |
|---|---|---|---|
| **B-α** | Plan + amendment docs (본 commit) | ~10분 | (이전) α spec |
| **B-β** | Engine — `add_face_with_holes` 의미 변경 + P7 component-merge resolver path 변경 | ~3-5일 | B-α |
| **B-γ** | LOCKED #1 P7 회귀 자산 update (11+ tests, ring → 두 simple) | ~2-3일 | B-β |
| **B-δ** | Render — depth offset 1μm (Q2-a) — Three.js polygonOffset 또는 vertex shader | ~1일 | B-γ |
| **B-ε** | Selection — depth priority (작은 face 우선) — raycaster 자연 또는 area sort | ~1일 | B-δ |
| **B-ζ** | STEP/IGES round-trip 변환 (Q4-a) — import ring → 두 simple, export 역 | ~3-5일 | B-ε |
| **B-η** | Boolean Difference 정책 amendment docs (Q3-a) — 사용자 facing UX guide | ~30분 | B-ζ |
| **B-θ** | E2E 회귀 + 사용자 시연 (S4 finding 해소 검증, ADR-087 K-ζ canonical) | ~1일 | B-η |
| **B-ι** | LOCKED #1 amendment + ADR-138 closure | ~30분 | B-θ |

**예상 총 소요**: 2-3주 atomic.

### B-β 첫 atomic step audit

**Engine 변경 scope** (Rust axia-geo):
- `crates/axia-geo/src/operations/face_synthesis.rs` — Step 4.95 second-pass component-merge resolver 변경
- `crates/axia-geo/src/mesh.rs::add_face_with_holes` — containment 시 ring + hole 패턴 생성 폐기
- 새 동작: containment 검출 시 *두 simple face 유지* (inner face 그대로, outer face 의 hole loop 생성 안 함)

**LOCKED #1 P7 회귀 자산 update plan** (11+ tests, axia-core scene::tests):
- `test_adr021_p7_case_a_inner_first_then_outer` — face count 동일 (2), *의미 변경* (ring + simple → 두 simple)
- `test_adr021_p7_case_b_outer_first_then_inner` — 동일
- `test_two_stacked_inner_rects_both_faced` — face count 동일 (2), 의미 변경
- `test_column_of_inner_rects_all_faced` — face count 동일, 의미 변경
- `test_complex_overlap_no_missing_faces` — face count 변경 가능 (multi-loop 없음)
- `test_outer_with_overlapping_extending_rects` — 변경
- `test_all_rects_have_consistent_winding` — winding 정책 변경 없음
- `test_outer_rect_drawn_after_inners_keeps_face` — 의미 변경
- `test_draw_order_independence` — *유지* (P7 핵심 invariant)
- `test_user_pattern_no_missing_faces` — 의미 변경

핵심 invariant 보존:
- **그리기 순서 무관성** (P7 의 핵심) — Path B 도 보존
- **모든 닫힌 경계 = 면** (메타-원칙 #14) — Path B 강화
- **manifold safety** — Path B 자연 보장 (single-loop only)

### B-β audit 결과 (axia-core scene::tests, 14 tests identified)

| Test | 현재 expected | Path B expected | Update type |
|---|---|---|---|
| `test_adr021_p7_case_a_inner_first_then_outer` | 1 ring + 2 simple = 3 face | 3 simple = 3 face | **의미 변경** (ring → simple) |
| `test_adr021_p7_case_b_outer_first_then_inner` | 동일 (그리기 순서 무관) | 동일 | **의미 변경** |
| `test_two_stacked_inner_rects_both_faced` | 1 ring + 2 simple | 3 simple | 의미 변경 |
| `test_column_of_inner_rects_all_faced` | 1 ring + 5 simple | 6 simple | 의미 변경 |
| `test_complex_overlap_no_missing_faces` | (multi-loop 포함) | (모두 simple, count 변경 가능) | **count 영향 가능** |
| `test_outer_with_overlapping_extending_rects` | 동일 | 동일 | count 영향 가능 |
| `test_all_rects_have_consistent_winding` | winding 검증 | winding 변경 없음 | **불변** (winding 정책 독립) |
| `test_outer_rect_drawn_after_inners_keeps_face` | 1 ring + 2 simple | 3 simple | 의미 변경 |
| `test_draw_order_independence` | (P7 핵심 invariant) | **보존** (Path B 도 순서 무관) | **불변** (P7 핵심) |
| `test_user_pattern_no_missing_faces` | (count 검증) | count 검증 (의미 변경) | 의미 변경 |
| `test_partial_overlap_no_degenerate_faces` | (overlap count) | count 변경 가능 | count 영향 가능 |
| `test_outer_with_two_partial_overlap_inners` | 1 ring + 2 simple + overlap | 3 simple + overlap = 3+ | 의미 변경 |
| `test_lshape_with_inner_rects_all_faced` | 1 L-ring + N simple | (N+1) simple | 의미 변경 |
| `test_outer_edge_collinear_overlap_with_inner` | (edge collinear case) | 동일 (single-loop) | count 영향 가능 |

**Summary**:
- **의미 변경 필요**: 8 tests (ring → simple)
- **count 영향 가능**: 4 tests
- **불변** (보존): 2 tests (winding, draw order independence — P7 핵심)

### B-β code change scope

| File | 변경 | LoC 영향 |
|---|---|---|
| `crates/axia-geo/src/operations/face_synthesis.rs` | Step 4.95 second-pass 변경 — component-merge 호출 제거, 두 simple face 유지 | ~50-100 |
| `crates/axia-geo/src/mesh.rs::add_face_with_holes` | hole loop 처리 분기 — Path B 시 fallback to simple face | ~30-50 |
| `crates/axia-core/src/scene.rs` (tests) | 8 tests 의 expected 변경 + 새 회귀 자산 추가 | ~200-300 |

## SUPERSEDED NOTE (2026-05-18, ADR-139 Q5=a 결재)

본 ADR-138 은 ADR-139 (Boundary Tool + Auto-cycle Deprecation) 의
사용자 결재 후 **자연 흡수**됨:

- ADR-138 Path B = "containment auto-split 시 두 simple face (multi-loop
  회피)"
- ADR-139 Path A = "모든 자동 trigger 폐기 — Boundary tool 명시 only"
- ADR-139 적용 시: 자동 containment auto-split *자체* 폐기 → multi-loop
  face 생성 trigger 없음 → ADR-138 Path B 의 결과 자연 달성 → ADR-138
  별도 implementation 불필요.

**ADR-138 β implementation 불필요** — ADR-139 β implementation 이 같은
의도를 더 깊은 architectural level 에서 달성. ADR-138 §11 의 B-α ~ B-ι
plan 은 deprecation, ADR-139 §14 의 B-α ~ B-μ plan 으로 대체.

ADR-138 의 사용자 통찰 ("정책이 잘못되었네요" / "쉽게 가려면 큰원에서
작은원을 빼고 작은원만 다시 생성") 은 ADR-139 의 더 깊은 통찰 ("자동화
자체가 antipattern, CAD BOUNDARY 방식이 더 안정") 로 진화. 두 ADR 모두
역사적 record 로 보존.

### B-γ 후 새 회귀 자산 (Path B 정합 검증) — DEPRECATED (ADR-139 흡수)

- `test_path_b_containment_two_simple_faces` — outer + inner = 2 simple (not ring)
- `test_path_b_no_multi_loop_face_generated` — Mesh 전체에 multi-loop face = 0
- `test_path_b_op_natural_on_all_faces` — Push/Pull / Boolean / Offset 모두 자연 작동
- `test_path_b_render_z_fighting_resolved` — depth offset 1μm 적용 확인
- `test_path_b_selection_depth_priority` — 작은 face 우선
- `test_path_b_step_iges_roundtrip` — import ring → 두 simple → export ring (의미 보존)

## 12. Lock-ins (β implementation 시 강제, 사용자 결재 정합)

### Path B 확정 Lock-ins (Q1~Q5 결재 정합)

- **L-138-B-1** Containment 정책 변경 — ring + hole 생성 안 함, 두 simple face
- **L-138-B-2** Multi-loop face deprecation — Mesh 전체에 multi-loop = 0 (invariant)
- **L-138-B-3** Depth offset 1μm (Q2) — Three.js polygonOffset 또는 vertex shader
- **L-138-B-4** Boolean Difference = "구멍" explicit op (Q3) — 사용자 facing UX
- **L-138-B-5** STEP/IGES round-trip 자동 변환 (Q4) — I/O 경계만 변환
- **L-138-B-6** ADR-016 Q2 / LOCKED #1 P7 amendment / ADR-051 verify_p7_manifold 모두 *deprecated* (Path B 후)
- **L-138-B-7** LOCKED #1 P7 회귀 자산 11+ tests update (의미 변경, count 보존 가능)
- **L-138-B-8** 그리기 순서 무관성 (P7 핵심 invariant) 보존 — Path B 도 강제
- **L-138-B-9** ADR-101 auto-intersect scope 자연 확장 (모든 case 작동, S4 finding 해소)
- **L-138-B-10** ADR-046 P31 #4 additive only — 사용자 facing 시각 결과 보존 (단순 face 두 개로 보임, 사용자 의도 동일)
