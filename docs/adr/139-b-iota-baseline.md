# ADR-139 B-ι — 사용자 시연 baseline (β implementation anchor)

**Status**: Accepted (docs only — anchor establish, ADR-087 K-ζ canonical 답습)
**Date**: 2026-05-21
**Author**: WYKO + Claude
**관련 ADR**: ADR-139 §14 B-ι atomic sub-step (E2E + 사용자 시연 — 구멍 0 검증)
**Path Z position**: B-β-2 / B-β-4 audit pivot / B-β-3 audit closure → **B-ι baseline (본 doc)** → B-β-3 implementation → B-ι 시연

## 1. 목적

ADR-139 §14 B-ι ("E2E + 사용자 시연 — 구멍 0 검증") 의 *baseline*
establish. β implementation (B-β-3) 진입 *전* 현재 상태를 명시 기록하여
*β implementation 후 비교 anchor* 로 활용.

**Canonical pattern (ADR-087 K-ζ 답습)**: 사용자 시연 게이트의 architectural
가치 — test 자산만으로 회귀 보장 불가, β implementation 전후 사용자 facing
변화의 *명시 기록* 필요.

## 2. 현재 상태 매트릭스 (B-β-1 + B-β-2 closure 후, B-β-3 진입 전)

### 2.1 ADR-139 β implementation 진행 상황

| Sub-step | Status | PR | Effect |
|---|---|---|---|
| B-α (α spec) | ✅ | #103 | Q1~Q5 결재 |
| B-β audit (multi-hole) | ✅ | #104 | workaround 가이드 |
| B-η/θ/κ/λ docs | ✅ | #127 | supersede + 메타-원칙 #16 + LOCKED #64 |
| B-ζ audit | ✅ | #128 | 회귀 자산 inventory (~275 tests) |
| **B-β-1** | ✅ | #129 | `auto_intersect_on_draw` default OFF |
| **B-β-2** | ✅ | #130 | Step 4.99 + `auto_face_synthesis_on_draw` |
| **B-β-4** | ✅ | #131 | audit pivot (TS 변경 0) |
| **B-β-3 audit** | ✅ | #132 | Step 4.95 + Phase 5/6 사전 검토 |
| B-ι baseline | ✅ | (본 PR) | 시연 baseline establish |
| ⏸ B-β-3 implementation | ⏸ | (다음) | Step 4.95 + Phase 5/6 disable |
| ⏸ B-γ ~ B-ε | ⏸ | (multi-month) | Boundary tool 신설 |

### 2.2 현재 사용자 facing 동작 (default OFF flags 후)

**모든 새 사용자 default**:
- `auto_intersect_on_draw = false` (B-β-1)
- `auto_face_synthesis_on_draw = false` (B-β-2, Step 4.99 만 영향)

#### 동작 1 — RECT × RECT partial overlap (B-β-1 영향)

```
DrawRect (5,5,0) 10×10 → 1 face (rect A)
DrawRect (10,10,0) 10×10 → 1 face (rect B, overlap with A)
```

**현재 상태 (B-β-1 default OFF)**:
- 2 faces (A + B, overlap 영역 그대로 — 자동 split 안 됨)
- 사용자 시연 시: "구멍이 난 부분 회피" 부분 달성 (lens region 미분할
  but face count 2 — 일종의 overlap)

**Legacy 동작 (localStorage 'true')**:
- 3 sub-faces (face_a_only + lens + face_b_only)

#### 동작 2 — DrawLine × 4 closed square (B-β-2 영향 미미)

```
DrawLine (0,0,0) → (10,0,0)
DrawLine (10,0,0) → (10,10,0)
DrawLine (10,10,0) → (0,10,0)
DrawLine (0,10,0) → (0,0,0)
```

**현재 상태 (B-β-1 + B-β-2 default OFF)**:
- 1 face (closed square 자동 face 합성 — Step 4.5/4.6/4.9/4.95 + Phase
  5/6 가 처리, Step 4.99 disable 영향 미미)
- Step 4.99 가 mop-up 단계 → 본격 영향은 B-β-3 후

**Legacy 동작 (localStorage 'true')**: 동일 1 face (Step 4.99 가 추가
sliver mop-up 만 영향).

#### 동작 3 — RECT containment (Step 4.95 영향, B-β-3 후 변화 예상)

```
DrawRect (0,0,0) 20×20 → 1 face (outer)
DrawRect (5,5,0) 5×5 → ??? (inner)
```

**현재 상태 (B-β-1 + B-β-2 default OFF, Step 4.95 활성)**:
- 2 faces (outer ring + hole inner) — Step 4.95 P7 ring rebuild 자동
  trigger

**B-β-3 후 예상**:
- 2 faces (outer simple + inner simple, no ring/hole — 자동 containment
  split 폐기)
- legacy `localStorage 'true'` 시 ring + hole 보존

#### 동작 4 — DrawRect / DrawCircle single-op (Q2-a 보존)

```
DrawRect (0,0,0) 10×10 → 1 face ✅ (Q2-a: single-op auto-face 보존)
DrawCircle (0,0,0) r=5 → 1 face ✅ (동일)
```

**보존**: Phase 7 STRICT (closed-shape finalizer) — B-β-3 후도 보존.

### 2.3 P5.UX.39-45 cascading fixes 패턴 회피 진행 상황

| Sprint | 자동화 | B-β-1 후 | B-β-2 후 | B-β-3 후 (예상) |
|---|---|---|---|---|
| P5.UX.39 | Line cycle 자동 face | 미영향 | 미영향 | **회피** ✅ |
| P5.UX.40 | Line 교차 자동 split | 부분 회피 (auto-intersect off) | 부분 회피 | **본격 회피** |
| P5.UX.41 | Stale face inner_loops 제거 | 미영향 | 미영향 | 미영향 (별개) |
| P5.UX.42 | 중앙 pentagon 자동 | 미영향 | 미영향 | **회피** |
| P5.UX.43 | Vertex 공유 push 왜곡 | 미영향 | 미영향 | 미영향 (별개) |
| P5.UX.44/45 | 자동 punching | **회피** ✅ | **회피** ✅ | **회피** ✅ |

**현재 (B-β-2 closure)**: P5.UX.40 + 44/45 부분~완전 회피.
**B-β-3 후 예상**: P5.UX.39 + 40 (본격) + 42 모두 회피.

### 2.4 사용자 RECT 시연 시 "구멍이 난 부분" 발생 가능성

**Trigger (PR #101 closure 후 시연)**:
> 사용자가 RECT 다수 그린 후 화면 결과: "구멍이 난 부분이 많았다"

**Root cause (ADR-139 α §1.2)**: 자동 cycle / containment / overlap
trigger 의 모호한 케이스 → 잘못된 결정 → cascading.

**현재 상태 (B-β-1 + B-β-2)**:
- 자동 partial overlap intersect 회피 (B-β-1) → overlap 영역의 잘못된
  split 회피
- 자동 cycle mop-up sliver region 회피 (B-β-2) → sliver 미합성 자연
- **구멍 발생 위험 일부 감소** but 아직 Step 4.95 (containment auto-split)
  활성 → 일부 케이스 잔존

**B-β-3 후 예상**:
- 자동 containment split 회피 → ring + hole 자동 변환 없음
- 모든 closed boundary = simple face (Q2-a single-op or Boundary tool 명시)
- **구멍 발생 위험 완전 제거** (자동 trigger 모두 폐기)

### 2.5 회귀 자산 누적 (베이스라인 측정)

**B-β-1 + B-β-2 closure 후 상태**:
- axia-core lib: 302 PASS
- axia-core integration: 36 PASS (6 + 11 + 3 + 3 + 4 + 3 + 11 + 0)
- axia-geo: 1407 + 24 PASS
- axia-wasm: 54 PASS (export_baseline +2: setAutoFaceSynthesisOnDraw / getAutoFaceSynthesisOnDraw)
- vitest TS: 1931 PASS (1 skipped)
- TS compile: ✅ Clean
- Total: **2754 tests PASS**

**B-β-3 후 예상 (audit estimate)**:
- ~78 tests 명시 호출 추가 (1-line update)
- 0 tests 재작성
- 총 회귀 자산 수 동일 (2754 tests PASS 유지 — 의미 변경 없음)

## 3. β implementation 후 비교 anchor (B-ι 시연 매트릭스)

### 3.1 시연 시나리오 1 — RECT × RECT partial overlap

```
Setup: 새 dev session (localStorage empty)
Action 1: DrawRect (0,0,0) 10×10
Action 2: DrawRect (5,5,0) 10×10 (overlap)
Expected (B-β-1 후): 2 faces (overlap 미분할)
Expected (B-β-3 후): 동일 2 faces (변화 없음 — auto_intersect 가 핵심)
```

### 3.2 시연 시나리오 2 — DrawLine × 4 square cycle

```
Setup: 새 dev session
Action: DrawLine × 4 → closed square
Expected (B-β-2 후): 1 face (earlier phase 자동 합성)
Expected (B-β-3 후): 0 face (모든 자동 trigger 폐기) — **본격 변화**
Boundary tool 후 (B-ε): user click → boundary detection → 1 face
```

### 3.3 시연 시나리오 3 — RECT containment

```
Setup: 새 dev session
Action 1: DrawRect (0,0,0) 20×20
Action 2: DrawRect (5,5,0) 5×5
Expected (B-β-2 후): 2 faces (outer ring + hole inner) — Step 4.95 활성
Expected (B-β-3 후): 2 faces (outer simple + inner simple) — **본격 변화**
```

### 3.4 시연 시나리오 4 — DrawRect single-op (Q2-a 보존)

```
Setup: 새 dev session
Action: DrawRect (0,0,0) 10×10
Expected (모든 B-β-* 후): 1 face (Q2-a 보존, Phase 7 STRICT)
```

### 3.5 시연 시나리오 5 — Legacy localStorage opt-in

```
Setup: localStorage 'axia:auto-intersect-on-draw' = 'true' +
       localStorage 'axia:auto-face-synthesis-on-draw' = 'true'
Action: Multi-RECT partial overlap + DrawLine cycle + containment
Expected (모든 B-β-* 후): legacy 동작 모두 보존 (ADR-049 P-5e-α canonical)
```

## 4. Lock-ins (baseline)

- **L-Bι-1** B-β-1 + B-β-2 closure 후 상태 명시 기록 (PR #129/#130)
- **L-Bι-2** B-β-3 implementation 후 비교 anchor 5 시나리오 정의
- **L-Bι-3** P5.UX.39-45 cascading fixes 패턴 회피 진행 상황 추적
  매트릭스
- **L-Bι-4** 회귀 자산 누적 측정 (2754 tests PASS) — B-β-3 후 동일 유지
  예상
- **L-Bι-5** ADR-087 K-ζ canonical 답습 — 사용자 시연 게이트 architectural
  가치 lock-in
- **L-Bι-6** Boundary tool 도입 (B-γ ~ B-ε) 후 본격 시연 baseline 추가
  필요 (별도 ADR)
- **L-Bι-7** 절대 #[ignore] 금지

## 5. Lessons

- **L1** 사용자 시연 게이트 baseline establish 의 architectural 가치
  (ADR-087 K-ζ canonical) — implementation 진입 전 상태 명시 기록
- **L2** β implementation step-by-step 의 사용자 facing 변화 명시
  매트릭스화 (5 시나리오)
- **L3** P5.UX.39-45 cascading fixes 패턴 회피 진행 추적 (sprint 별
  영향 매트릭스)
- **L4** Legacy opt-in (localStorage 'true') 보존 검증 (ADR-049 P-5e-α
  canonical 정합)
- **L5** 회귀 자산 누적 baseline (~78 tests 영향 예상 + 0 재작성)

## 6. Cross-link

- ADR-139 α / B-β / B-ζ / B-η/θ/κ/λ / B-β-1 / B-β-2 / B-β-4 pivot / B-β-3 audit
- ADR-087 K-ζ canonical (사용자 시연 게이트 architectural 가치)
- ADR-049 P-5e-α (localStorage explicit opt-in canonical)
- LOCKED #44 (Complete Meaning per Merge — baseline docs only PR)
- 메타-원칙 #14 (WHAT 불변) + #16 (WHEN 자동화 antipattern)

## 7. Acceptance Log

- **2026-05-21 baseline** (본 commit) — B-β-3 implementation 진입 전
  사용자 facing 상태 매트릭스 + 5 시나리오 비교 anchor establish.
- **(다음 단계)** — B-β-3 implementation 진입 (single atomic 또는
  sub-step 분할, 사용자 결재).
- **(B-β-3 후)** — 본 baseline 의 5 시나리오 실측 결과 비교 (별도 PR
  또는 B-β-3 PR 자체에 결합).

---

**다음 trigger**: B-β-3 implementation 진입 결재 — 사용자 결재 후.
