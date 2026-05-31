# ADR-173 — Phase 4 User Vision Realization + 12 시연 게이트

**Status**: Accepted (γ closure 2026-05-31 — 12 게이트 8/12 PASS demo-verified, Phase 1-4 sequence COMPLETE)
**Date**: 2026-05-31
**Author**: WYKO + Claude
**Trigger**: ADR-172 γ closure (LOCKED #73) + 사용자 결재 "ADR-173 12 시연
게이트" (2026-05-31). Phase 1-4 sequence **최종** (넷째).
**Audit precondition**: ADR-169 β-3 user demo evidence matrix (12 scenario)
+ ADR-172 demo evidence (7 시나리오 부분 sweep, 2026-05-31).
**Direct precursors**:
- **ADR-172** (Phase 3 closure, LOCKED #73) — crossing-split mechanism
  demo-verified, 직접 precursor
- ADR-170/171 (Phase 1/2, LOCKED #71/72) — absorb chain (입체면 face plane)
- ADR-169 (Phase 0 audit, LOCKED #70) — 12 scenario matrix source
- ADR-087 K-ζ — 사용자 시연 게이트 canonical

**Sprint scope**: Phase 4 of 4 (LOCKED #44 Complete Meaning per Merge) —
**Phase 1-4 sequence final closure**.

---

## Canonical anchor

ADR-169 §2.2 Q5=(a) lock-in 의 실제 구현 — "12 시연 scenario PASS = Phase 4
closure 게이트". 사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" 의 *full
matrix realization* + demo 증명.

ADR-172 가 mechanism 작동을 *발견* (Pattern 12) + 7 시나리오 부분 검증
했다면, ADR-173 은 **12 scenario full matrix** 를 게이트로 봉인 +
Phase 1-4 sequence 를 완결.

---

## 1. Problem statement

### 1.1 12 시연 게이트 (ADR-169 β-3 매트릭스)

ADR-169 β-3 user demo evidence matrix 의 12 scenario = **4 도구 × 3 surface**:

| | 평면 (XY ground) | 입체면 (solid face) | 곡면 (cylinder side) |
|---|---|---|---|
| **DrawLine** | S1 | S2 | S3 |
| **RECT** | S4 | S5 | S6 |
| **CIRCLE** | S7 | S8 | S9 |
| **Bezier** | S10 | S11 | S12 |

### 1.2 ADR-172 demo (7 시나리오 부분 sweep) — Phase 4 확장 대상

ADR-172 demo evidence (2026-05-31) 가 검증한 부분:
- ✅ S1 (DrawLine 평면), S2 (DrawLine 입체면), S4 (RECT 평면), S7 (CIRCLE 평면)
- ⚠ 곡선 한계 (원 면 분할) — S6/S9 관련

Phase 4 = 12 scenario *전체* 를 systematic 하게 게이트.

### 1.3 메타-원칙 정합

- **메타-원칙 #5 (사용자 편의)** — 12 scenario 가 사용자 의도 full coverage
- **메타-원칙 #14 (면은 닫힌 경계로부터)** — 모든 게이트의 결과 invariant
- **ADR-087 K-ζ canonical** — 사용자 시연 게이트가 test 보다 강한 증명

---

## 2. Solution architecture — 12 시연 게이트

### 2.1 게이트 acceptance criteria (Q1~Q5 결재 default 5/5)

#### Q1=(a) — 게이트 통과 기준: PASS / Documented-Limitation 2분류

**Lock-in**: 각 scenario 는 **PASS** (작동) 또는 **Documented-Limitation**
(audit 예측 한계). 미예측 FAIL 은 0 강제 (regression).

- PASS: 사용자 의도대로 작동 (면 분할 / 면 합성 / 교차점 생성)
- Documented-Limitation: audit (β-1 Type 3/4 / β-3 S6/S9/S12) 예측 한계
  (곡선 면 분할 / curved surface 위 2D primitive / Bezier face split)

#### Q2=(a) — Demo method: Claude Preview MCP (real browser)

**Lock-in**: ADR-172 demo 패턴 답습 — bridge eval 직접 호출 (screenshot
timeout 시 eval 우선, authoritative). WASM 빌드 사전 필수.

#### Q3=(a) — Regression lock-in: 게이트 scenario 회귀 자산

**Lock-in**: PASS scenario 는 axia-core 회귀로 lock-in (ADR-172
adr172_beta1_* / adr172_gamma_* 답습). Documented-Limitation 은 demo
evidence doc + future ADR 후보.

#### Q4=(a) — 곡선 한계 future ADR 분리 보존

**Lock-in**: S6/S9/S12 (곡선 면 분할 / curved 2D primitive) 는 ADR-172
demo 의 spawned task (curve-edge crossing-split) 로 분리 유지. Phase 4 는
*게이트 봉인* 만, 곡선 구현은 future.

#### Q5=(a) — Phase 1-4 sequence 완결 선언

**Lock-in**: Phase 4 closure = LOCKED #74 + "Phase 1-4 sequence COMPLETE"
선언. ADR-169 D-Then-C 의 C (Phase 1-4) 완결.

### 2.2 예상 게이트 매트릭스 (β demo 후 확정)

| Scenario | 도구 × surface | 예상 |
|---|---|---|
| S1 | DrawLine 평면 | ✅ PASS (ADR-172 검증) |
| S2 | DrawLine 입체면 | ✅ PASS (ADR-172 box face split) |
| S3 | DrawLine 곡면 | ⚠ Limitation (곡면 위 line) |
| S4 | RECT 평면 | ✅ PASS (ADR-172 square) |
| S5 | RECT 입체면 | ✅ PASS (예상) |
| S6 | RECT 곡면 | ⚠ Limitation (β-3 S6 ⏸) |
| S7 | CIRCLE 평면 | ✅ PASS (ADR-172 circle face) |
| S8 | CIRCLE 입체면 | ✅ PASS (예상) |
| S9 | CIRCLE 곡면 | ⚠ Limitation (β-3 S9 ⏸) |
| S10 | Bezier 평면 | ✅ PASS (예상, ADR-089 A-ω closed Bezier) |
| S11 | Bezier 입체면 | ⚠ Limitation (β-1 Type 4 ❌) |
| S12 | Bezier 곡면 | ⚠ Limitation |

(β demo 에서 실측 확정 — 예상은 audit 기반)

---

## 3. Sub-step roadmap (3-step lean — verification 중심)

본 ADR-173 의 atomic 3-step (Phase 4 = verification + closure, Pattern 12
정합 — mechanism 작동하므로 게이트 봉인 중심):

- **α** (본 PR): spec only — 12 게이트 정의 + Q1~Q5 결재 anchor
- **β**: 12 scenario full demo (Claude Preview MCP) + 게이트 매트릭스 확정
  + PASS scenario 회귀 lock-in
- **γ**: closure — Status Accepted + §9 Lessons + LOCKED #74 + README +
  **Phase 1-4 sequence COMPLETE 선언**

**기간**: 1주 (3-step lean, verification 중심).

---

## 4. Lock-ins (canonical for ADR-173)

- **L-173-1** 12 시연 게이트 (4 도구 × 3 surface) full matrix
- **L-173-2** PASS / Documented-Limitation 2분류 (미예측 FAIL 0 강제)
- **L-173-3** Demo via Claude Preview MCP (ADR-172 패턴, eval authoritative)
- **L-173-4** PASS scenario 회귀 lock-in (axia-core)
- **L-173-5** 곡선 한계 (S3/S6/S9/S11/S12) future ADR 분리 보존
- **L-173-6** Phase 1-4 sequence COMPLETE 선언 (LOCKED #74)
- **L-173-7** ADR-087 K-ζ 사용자 시연 게이트 canonical 정합
- **L-173-8** 메타-원칙 #5/#14/#16 보존 강제
- **L-173-9** 절대 #[ignore] 금지

---

## 5. Phase 1-4 sequence 완결 (LOCKED #74)

| Phase | ADR | Title | LOCKED | 회귀 |
|---|---|---|---|---|
| 0 | ADR-169 | Boundary-Routine Audit | #70 | +0 (audit) |
| 1 | ADR-170 | Tool layer normalizeDrawInput SSOT | #71 | +29 |
| 2 | ADR-171 | Engine absorb_boundary_input SSOT | #72 | +19 |
| 3 | ADR-172 | DCEL Edge Register (demo-verified) | #73 | +2 |
| **4** | **ADR-173** | **12 시연 게이트 + sequence COMPLETE** | **#74** | **TBD** |

사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" 의 D-Then-C (audit →
implementation) 완결.

---

## 6. Out of scope (future ADR)

- 곡선 면 분할 (S3/S6/S9 curve-edge crossing-split) — 2026-05-31 spawned task
- Bezier 입체면 face split (S11) — β-1 Type 4 ❌, future
- Curved surface 위 2D primitive (S6/S9/S12) — β-3 ⏸, future
- DrawLineTool → register migration (사용자 facing 전환) — future
- NURBS kernel `bail!` 변경 — carve-out 보존

---

## 7. Cross-link

### LOCKED 정책
- **LOCKED #44** Complete Meaning per Merge (3-step lean)
- **LOCKED #64** ADR-139 Boundary tool only (face emission gate)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (D-Then-C C 완결)
- **LOCKED #71/72/73** ADR-170/171/172 Phase 1/2/3 (direct precursors)

### ADR cross-link
- ADR-087 K-ζ 사용자 시연 게이트 canonical (L-173-7)
- ADR-089 closed-curve face (S7/S10 Circle/Bezier)
- ADR-169 β-3 user demo evidence matrix (12 scenario source)
- ADR-172 demo evidence (7 시나리오 부분, 확장 대상)
- 곡선 면 분할 future ADR (S3/S6/S9 spawned task)

### Sprint atomic patterns
- Pattern 12 engine already-robust (Phase 4 = 게이트 봉인 중심)
- WASM 빌드 + preview_eval demo canonical (ADR-172 답습)
- 3-step lean variant (verification 중심)

### 메타-원칙
- #5 사용자 편의 / #14 WHAT / #16 WHEN (face gate)

---

## 8. Acceptance Log

### 8.1 α (PR #273, merged 2026-05-31)
- spec only — 12 게이트 정의 + Q1~Q5 + 3-step roadmap

### 8.2 β (PR #274, merged 2026-05-31)
- 12 scenario full demo (Claude Preview MCP) — 게이트 매트릭스 확정:
  **8/12 full PASS** (평면 4/4 + 입체면 4/4) / **4/12 Documented-Limitation**
  (곡면 4/4) / **미예측 FAIL 0**
- S2 입체면 회귀 자산 **+1** (adr173_gate_s2_drawline_on_solid_box_face_
  splits — box top face split 6→7, axia-geo 1537 → 1538)
- demo evidence doc (`docs/audits/2026-05-31-adr-173-12-gate-matrix.md`)

### 8.3 γ (본 PR)
- Status Accepted + §9 Lessons + LOCKED #74 + README
- **Phase 1-4 sequence COMPLETE 선언**

**회귀 누적 (Phase 4)**: β +1 (axia-geo 1537 → 1538). estimate +10 vs
실측 +1 — Pattern 12 (mechanism 작동, verification 중심 + 기존 회귀 자산
재활용).

---

## 9. Lessons (canonical for verification-phase ADRs)

### L1 — Full matrix demo 의 honest 분류 (PASS / Documented-Limitation)

12 게이트 full sweep 가 8/12 PASS + 4/12 곡면 Documented-Limitation 으로
*투명하게* 분류. 미예측 FAIL 0 (모든 한계 audit 예측). **게이트 = "전부
작동" 강요가 아닌 "작동 + 예측된 한계 명시"** — ADR-171 truth over
estimate 답습.

### L2 — Verification phase 의 회귀 재활용 (estimate +10 vs 실측 +1)

Phase 4 estimate +10 vs 실측 +1. 대부분 scenario 가 *기존 회귀 자산*
(ADR-172 adr172_*, DrawRect/Circle/Bezier 다수) 로 이미 cover. 신규 lock-in
은 S2 입체면 1개만 genuine new. **verification phase 는 기존 자산 inventory
우선** (Pattern 12 정합).

### L3 — 곡면 한계의 architectural 명료성

곡면 (cylinder side) split 미지원 이 4 scenario 일관 (S3/S6/S9/S12). 닫힌
도형은 *자체 평면 면* 생성하나 곡면 host 와 무관 (floating planar). Root
cause 명확 (find_line_crossings 직선 전용 + curve-surface conforming 미구현).
Future ADR (curve-edge crossing-split) 로 깔끔히 분리.

### L4 — Phase 1-4 sequence 완결의 architectural 가치

D-Then-C (ADR-169 audit → ADR-170~173 implementation) 의 완결. 사용자 비전
("선만 그려, 케이크는 알아서 나뉜다") 가 평면 + 입체면 8/8 PASS 로 demo
증명 + 회귀 lock-in. 5 ADR (169~173) / 5 LOCKED (#70~74) / 6-8주 estimate
→ 실측 same-week (Pattern 12 mechanism already exists 가 genuine work 축소).

### L5 — Demo-driven gate 의 ADR-087 K-ζ canonical 정합

12 게이트가 test 가 아닌 *실제 브라우저 demo* 로 봉인. ADR-087 K-ζ (사용자
시연 게이트) 의 deepest 적용 — "사용자가 보는 결과" 를 직접 증명. 향후
user-vision realization ADR 는 demo-driven gate 답습 권장.

---

## 10. LOCKED #74 candidate (사용자 결재 별도)

**Proposed LOCKED entry** (사용자 결재 후 CLAUDE.md 등재):

> **LOCKED #74 — ADR-173 Phase 4 closure + Phase 1-4 sequence COMPLETE
> (12 시연 게이트 demo-verified)**
>
> Phase 4 (α + β + γ) closure → **ADR-169 D-Then-C sequence 완결**.
>
> **불변 lock-in**:
> - 12 시연 게이트 (4 도구 × 3 surface) — 8/12 full PASS (평면 4/4 +
>   입체면 4/4) / 4/12 Documented-Limitation (곡면 4/4) / 미예측 FAIL 0
> - 사용자 비전 "선만 그려, 케이크는 알아서 나뉜다" 핵심 (평면 + 입체면)
>   demo-verified + 회귀 lock-in
> - S2 입체면 회귀: adr173_gate_s2_drawline_on_solid_box_face_splits (사용자
>   원래 pain point PR #247/248 해소)
> - 곡면 한계 (S3/S6/S9/S12) = future ADR (curve-edge crossing-split,
>   2026-05-31 spawned)
> - **Phase 1-4 sequence COMPLETE**: ADR-169(#70) audit → ADR-170(#71)
>   Tool SSOT → ADR-171(#72) Engine absorb → ADR-172(#73) Edge Register →
>   ADR-173(#74) 12 게이트
> - 메타-원칙 #5/#14/#16 + ADR-087 K-ζ demo gate canonical
>
> **회귀 누적 (Phase 1-4)**: +29 (P1) + 19 (P2) + 2 (P3) + 1 (P4) =
> **+51** (절대 #[ignore] 금지). estimate 6-8주/+200~300 vs 실측 same-week
> /+51 (Pattern 12 — mechanism already exists).

본 LOCKED entry 는 γ closure PR (본 PR) 의 별도 사용자 결재 후 CLAUDE.md
등재.
