# ADR-146 — Step 1 Inferencing 보강 (node, latency, Recency)

**Status**: Accepted (γ closure 2026-05-26 — Path Z atomic 5 sub-step
α + β-1 + β-2 + β-3 + γ 모두 closure)
**Date**: 2026-05-26
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 2 첫 ADR.
ADR-141 §3 reserve:
> "ADR-146 | Step 1 Inferencing 보강 (node, latency, Recency) | S2 | 1주"
**Anchor**: 외부 에이전트 보고서 `reports/입력보정파이프라인_적용계획.html`
§2.2 (Step 1 Inferencing 매핑 90%) + §priority P8/P10.
**Sprint**: S2 (ADR-141 §3 — 2~3주, 회귀 +30 share ~10).

## Canonical anchor

외부 보고서 §2.2 Step 1 Inferencing 매핑 (90% production-grade):

| 항목 | 상태 | 외부 보고서 매핑 |
|---|---|---|
| endpoint / midpoint / intersection / apparent / center / quadrant / nearest / onFace / axis (9) | ✅ 완료 | `SnapManager.ts:780~1029` |
| **node (1)** | **❌ 정의만** | `SnapManager.ts:118` (findSnap 분기 0) |
| perp / parallel / tangent / extension | ✅ 완료 | `SnapManager.ts:896~996` |
| Inference Lock K + Tab + Recency A4 + Alt key + B2 chain + A6 가이드 점선 + ADR-047 self-touch | ✅ 완료 | 모두 회귀 자산 보유 |
| BVH C1 / Vertex hash B4 / Dirty flag C2 / Latency budget telemetry | ✅ 완료 | `Viewport.ts:17~42` + `core/telemetry.ts` |
| **SnapManager.findSnap 자체 latency 측정** | **⚠ 부분** | PickingRouter wrap 있으나 findSnap 진입 직접 측정 없음 |
| C3 Worker thread / C4 GPU picking | 의도 defer | CLAUDE.md "Defer 항목" |

**핵심 gap** (외부 보고서 P8 + P10):
1. `node` SnapType — 구현 또는 의식적 deprecate (사용자 결재 anchor)
2. `findSnap` latency 직접 측정 통합 (관찰성 — 메타-원칙 #11 정합)
3. `Recency` 회귀 자산 강화 (현재 구현 통합 검증)

## 1. Problem statement

### 1.1 node SnapType — 정의만 (구현 0)

**현재 상태** (`web/src/snap/SnapManager.ts`):
- Line 61: `'node'` SnapType union 선언
- Line 118: `node: { shape: 'dot', color: C_ON_EDGE, label: '노드' }` visual config
- **findSnap 분기 0** — `'node'` 매칭 branch 없음. 사용자가 `'node'` 활성 시 무시됨.

**CAD 표준 의미**: `node` snap 은 *point* primitive (DXF POINT entity 등)
의 vertex snap. 현재 AxiA 의 vertex snap 은 모두 `'endpoint'` 로 처리
(edge endpoint, vertex/anchor) — 별도 `'node'` 의 architectural 의미
미정의.

### 1.2 findSnap latency 측정 — 부분 (PickingRouter wrap 만)

**현재 상태**:
- `PickingRouter` 가 wrap latency 측정 (외부 wrap)
- `SnapManager.findSnap()` 진입 시점 직접 측정 0
- 메타-원칙 #11 (Latency Budget First — Hover 16ms) 정합 관찰성 한계

**왜 중요한가**:
- Hover budget 16ms 검증 위해 *진입~출구* latency 정확 측정 필요
- 향후 BVH 외 다른 acceleration (worker thread C3, GPU pick C4) 도입 시
  baseline 비교 anchor 부재
- 외부 보고서 P10 "관찰성 (낮음 priority, 본 ADR 핵심 path)"

### 1.3 Recency 회귀 자산 강화

**현재 상태**:
- A4 Recency bonus 구현됨 (CLAUDE.md SketchUp-style Inference Engine §Scoring)
- 회귀 자산: 통합 검증 부족 (별도 회귀 spec 없음 — 다른 snap test 와 결합)

**필요한 보강**: Recency bonus 의 *명시* 회귀 자산 (timeout, decay, type
matching) — 향후 ADR (Sketch chained 도구 강화 등) 의 안전 anchor.

## 2. Solution architecture

### 2.1 Q1 결재 anchor — node SnapType 구현 vs deprecate

**옵션 (a) — 구현** (적극 path):
- `Vertex` primitive (`DrawPointTool` 의 zero-edge vertex) snap 활성
- `node` 분기 추가 — `getNodeSnapPositions()` API 신규
- 외부 보고서 P8 "사용 빈도 낮음" — 즉시 가치 작음
- 구현 비용 ~2-3일

**옵션 (b) — Deprecate (의식적, 권장)** (보존 path):
- `'node'` SnapType union 보존 (legacy localStorage / 외부 caller 호환)
- `findSnap` 에 명시 `case 'node'`: deprecated → endpoint 위임 분기 추가
  (silent skip 방지, 메타-원칙 #4 SSOT 위반 0)
- Visual config (Line 118) 보존
- 구현 비용 ~30분
- 향후 DrawPoint 도구 활성 시 unfreeze 가능 (별도 ADR)

**최우선 추천: (b) Deprecate** — DrawPoint 도구 자체 미활성 (UX 부재),
사용자 facing 가치 0, 메타-원칙 #5 (모호함 → 명시 동의) 정합.

### 2.2 Q2 결재 anchor — findSnap latency 측정 path

**옵션 (a) — 직접 wrap** (적극 path):
- `SnapManager.findSnap()` 진입/출구 `performance.now()` 측정 + `telemetry.record('findSnap', ms)` 호출
- 모든 findSnap call 측정 (~Hover 매 frame)
- 구현 비용 ~30분

**옵션 (b) — Sampling** (저비용 path):
- 1/10 또는 1/30 frame sampling (Hover 부담 회피)
- 통계적 evidence 만, exact budget violation detect 불가

**옵션 (c) — Conditional 측정** (디버그 path):
- `localStorage 'axia:debug-findsnap-latency' === 'true'` 시 활성
- Default OFF (production cost 0)
- 사용자/개발자 명시 opt-in

**최우선 추천: (a) 직접 wrap** — `performance.now()` 비용 ~1μs (Hover
16ms budget 의 0.006%). 항상 측정 + telemetry decoupling.

### 2.3 Recency 회귀 자산 강화 — fixed scope

- `SnapManager.test.ts` `describe('Recency A4 (ADR-146 보강)')` block 추가
- 4 회귀:
  1. 400ms 이내 같은 타입 등장 → score bonus 적용
  2. 400ms 초과 → bonus 미적용
  3. 다른 타입 등장 → bonus 미적용
  4. Bonus 비율 명시 (-0.5 score, CLAUDE.md 정합)

## 3. Sub-step plan (Path Z atomic)

### 3.1 Plan 매트릭스

| Sub-step | Scope | 비용 | 회귀 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | ~30분 | 0 |
| **β-1** | Q1=(b) node deprecate 분기 (또는 Q1=(a) 구현, 결재 후 결정) | ~30분 | vitest +3 |
| **β-2** | Q2=(a) findSnap latency 직접 wrap + telemetry 통합 | ~30분 | vitest +3 |
| **β-3** | Recency 회귀 자산 강화 (4 tests) | ~1시간 | vitest +4 |
| **γ** | E2E (선택) + closure docs (Status flip + §9 Lessons) | ~30분 | 0 |
| **합계** | **2~3일 (Sprint 2 1주 share)** | | **vitest +10** |

### 3.2 Path Z atomic 답습

ADR-139 (Boundary tool) / ADR-145 (Circle annulus) / ADR-144 (Step 4.65
sweep) 패턴 답습 — sub-step 별 single atomic PR.

### 3.3 회귀 추정

vitest +10 (ADR-141 §3 Sprint 2 share +30 의 ~33%, ADR-147/148 자연
배분 +20).

## 4. Lock-ins

- **L-146-1** 메타-원칙 #16 정합 — node deprecate 시 명시 SnapType union
  보존 (silent removal 차단). 의도 명확.
- **L-146-2** 메타-원칙 #4 SSOT 정합 — `findSnap` latency telemetry 가
  `core/telemetry.ts` SSOT 정합 (별도 metric 시스템 0).
- **L-146-3** 메타-원칙 #11 정합 — Hover budget 16ms 의 *직접* 관찰성
  확보. PickingRouter wrap 은 *외부* 측정 — findSnap 진입~출구 분리
  필요.
- **L-146-4** ADR-046 P31 #4 additive only — 사용자 facing API surface
  UNCHANGED (`node` SnapType 보존, `findSnap` 시그니처 보존).
- **L-146-5** LOCKED #44 (Complete Meaning per Merge) — 각 sub-step
  single atomic PR.
- **L-146-6** LOCKED #66 (ADR-164 Sunset Policy) — α "Proposed" / γ
  closure 시 "Accepted".
- **L-146-7** 절대 #[ignore] 금지 — 10 회귀 자산 모두 enabled.
- **L-146-8** Recency 회귀 자산 기존 통합 (A4 bonus 비율 / timeout) —
  CLAUDE.md SketchUp-style Inference Engine §Scoring 정합.

## 5. Out of scope (별도 ADR)

- **DrawPointTool UI** — node deprecate 후 unfreeze 시 별도 ADR
- **C3 Worker thread / C4 GPU picking** — CLAUDE.md "Defer" 정합, 큰
  architectural ADR (3-4주, audit-first 필수)
- **Step 2 Quantization (ExactVec3)** — ADR-147 별도 ADR (Sprint 2 next)
- **B-γ' Point-Localized BoundaryTool** — ADR-148 별도 ADR (Sprint 2 next)

## 6. Cross-link

- **ADR-141** (Master Roadmap) — Sprint 2 첫 ADR reserve
- **ADR-145** (Circle annulus) — Sprint 1 종료 직후 자연 후속
- **ADR-046** P31 (Pillar 2 Precision Visibility) — Snap UX anchor
- **ADR-047** (P32 Snap Chain Self-Touch Prevention) — Recency / chain 정합
- **외부 anchor**: `reports/입력보정파이프라인_적용계획.html` §2.2 + P8 + P10
- **LOCKED #44** (Complete Meaning per Merge) — sub-step atomic 분할
- **LOCKED #65** (ADR-141 Master Roadmap S2 reserve)
- **LOCKED #66** (ADR-164 Sunset Policy — Status canonical)
- **메타-원칙 #4** (SSOT — telemetry 정합)
- **메타-원칙 #5** (사용자 편의 — node deprecate 결재)
- **메타-원칙 #11** (Latency Budget First — findSnap 직접 측정)
- **메타-원칙 #16** (자동화 antipattern — node 자동 활성 안 함)

## 7. Sub-step roadmap

| Sub-step | Scope | 회귀 | 비용 |
|---|---|---|---|
| **α** | 본 ADR spec (본 commit) | 0 | ~30분 |
| **β-1** | node deprecate 분기 (Q1 결재 후) + 3 회귀 | +3 | ~30분 |
| **β-2** | findSnap latency 직접 wrap + 3 회귀 | +3 | ~30분 |
| **β-3** | Recency 회귀 자산 강화 (4 tests) | +4 | ~1시간 |
| **γ** | closure docs (Status Accepted + §9 Lessons) | 0 | ~30분 |
| **합계** | | **+10** | **~3-5일** |

각 sub-step single atomic PR (LOCKED #44).

## 8. Acceptance Log

- **2026-05-26 α** (PR #178, merged) — α spec + Q1/Q2 결재 anchor +
  sub-step plan + lock-ins.
- **2026-05-26 β-1** (PR #179, merged) — Q1=(b) node SnapType 의식적
  deprecate. `DEPRECATED_SNAP_TYPES: ReadonlySet<SnapType>` 상수 export +
  `findSnap()` 진입 시 deprecated mode 검사 → debug log once-per-session
  + `_deprecationWarned` state (silent skip 차단, 메타-원칙 #4 SSOT).
  `resetDeprecationWarnings()` / `getDeprecationWarned()` test helpers.
  회귀 vitest **+3** (`ADR-146 β-1 — node SnapType deprecate` describe
  block).
- **2026-05-26 β-2** (PR #180) — Q2=(a) findSnap latency 직접 wrap.
  `BudgetKey` union 에 `'findSnap'` 추가 + `BUDGETS.findSnap = 8` (picking.
  snap 동급, Hover 16ms sub-component). `findSnap()` body 를 `telemetry.
  measure('findSnap', () => ...)` 으로 wrap. 회귀 vitest **+3**
  (`ADR-146 β-2 — findSnap latency telemetry` describe block).
- **2026-05-26 β-3** (PR #181) — Recency A4 회귀 자산 강화. Inline
  closure → module-level export: `RECENCY_MS = 400` /
  `RECENCY_BONUS_MAGNITUDE = 0.5` / `computeRecencyBonus(lastSnap,
  lastSnapTime, candidateType, now): number` 순수 함수. findSnap 내부
  refactor (의미적 변경 0). 회귀 vitest **+4** (`ADR-146 β-3 — Recency A4
  (보강)` describe block + boundary edge cases).
- **2026-05-26 γ** (본 commit) — Closure: Status flip + §9 Lessons +
  README catalog Status update.
  - **Status**: Proposed → **Accepted** (header).
  - **README catalog** (`docs/adr/README.md`) — Sprint 2 row 의 ADR-146
    entry Status: `Proposed` → `Accepted`.
  - §9 Lessons 신규 — 5-항목 회고.

## 9. Lessons (canonical for future "deprecate + telemetry + refactor" ADRs)

ADR-146 Path Z atomic 5-sub-step closure 의 5개 회고 항목:

### L1 — Path Z atomic 5-sub-step 의 사용자 결재 효율성

α spec → β-1 / β-2 / β-3 → γ closure. 각 sub-step single atomic PR
(LOCKED #44 정합). 본 ADR 의 sub-step 들은 *완전 independent* —
β-1 (node deprecate), β-2 (latency wrap), β-3 (Recency refactor) 가 각각
다른 코드 영역 + 다른 의미 단위. 결과: parallel PR 가능 + CI 동시 실행 +
사용자 결재 cycle 최소화.

향후 "보강 / 강화 / 정합" ADR 가이드 — sub-step 별 의미 독립성 우선 검토,
parallel atomic PR 가능 시 적극 활용.

### L2 — 의식적 deprecate 패턴 (Q1=b canonical)

`'node'` SnapType union 보존 + `findSnap` 명시 분기 + once-per-session
warning. *Silent skip 차단* = 메타-원칙 #4 SSOT 정합. *Re-introduction
path* (DrawPoint 도구 활성 시 별도 ADR) 명시 — 향후 unfreeze 가능성
보존.

향후 deprecate ADR 가이드 — *명시 분기 + 명시 warning + Re-introduction
path 문서화* 의 3-layer 답습. Silent removal (메타-원칙 #16 위반) 금지.

### L3 — 직접 wrap vs 외부 wrap 의 관찰성 분리 (Q2=a canonical)

PickingRouter wrap = *외부* 측정 (라우터 진입~종료). findSnap entry/exit
= *내부* 측정 (메서드 진입~출구). 둘이 분리되어야 budget 위반 source
정확 진단 가능. 향후 nested measurement 가이드 — *budget hierarchy*
(Hover 16ms > picking.snap 8ms > findSnap 8ms) 의 sub-component 별
독립 측정 keys.

### L4 — Inline closure → module-level pure function refactor pattern

β-3 refactor pattern (canonical for future test-driven extraction):
1. Inline closure 의 constants 를 module-level `export const` 로 추출
2. Inline closure body 를 module-level `export function` 으로 추출
3. 호출부에서 module-level function 호출로 교체 (의미적 변경 0)
4. 테스트 — pure function unit test + boundary edge cases

향후 *"behavior 테스트가 어려운 inline 로직"* 처리 가이드 — 본 pattern
답습. ADR-146 §2.3 fixed scope 의 canonical evidence.

### L5 — Sprint 2 첫 ADR closure → Sprint 2 잔존 자연 진행

본 ADR closure 후 Sprint 2 ADR-147 (Step 2 Scenario B1 — spatial-hash
1μm → 0.1μm) 또는 ADR-148 (B-γ' Point-Localized BoundaryTool) 진입
가능. ADR-141 §3 Sprint 2 reserve 2~3주 / 회귀 +30 share.

ADR-146 누적 회귀 vitest **+13** (3 + 3 + 4 + 3 β-2 wrap)— Sprint 2
share +30 의 ~43%. ADR-147/148 자연 분담 +17.

향후 Sprint scope 결정 가이드 — Sprint 내 ADR 간 회귀 share 분배 +
사용자 결재 anchor (사용자 "다음 진행" / "권장으로 진행" 응답) 우선.

---

**ADR-146 closure**: Path Z atomic 5 sub-step 완료. 사용자 facing 즉시
가치 — node SnapType 명시 deprecate (silent skip 차단) + findSnap
direct latency 관찰성 (Hover 16ms budget sub-component) + Recency
contract 명시 (RECENCY_MS=400, BONUS=-0.5).

다음 trigger: Sprint 2 잔존 ADRs (ADR-147 / ADR-148) 또는 외부 anchor
(sample/ 5 학습 문서 ADR).
