# ADR-085 — Toast Progress UX MVP (Drift #5 Wait Time Visibility)

**Status**: **Accepted** (P-α spec only — code 변경은 후속 P-β ~ P-γ
별도 atomic commits)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 결정 + Claude spec)
**Anchor**: 사용자 권장 path 결정 (2026-05-08):
> "ADR-082 Drift #5 (browser env OCCT init 180s+ 소요) 로 사용자가
> STEP 파일 import 후 face mesh 표시까지 *최소 3분 wait*. 현재는 단일
> `Toast.info('STEP/IGES 엔진 로딩 중...')` (8초 후 사라짐) — 사용자가
> wait 도중 *진행 상황 미인지*. 최단 demo 가치 path 의 두 번째 보강."
**Parent**: ADR-082 (Drift #5 timing trade-off), ADR-083 / ADR-084
(visual unlock — wait time 단축은 별개 ADR), ADR-046 P31 (UI/UX 가치)
**Cross-cut**: ADR-035 P20.C #2 (initial bundle 0MB)

---

## 0. Summary (6 lines)

> ADR-082 C-ε 의 OCCT integration 활성 후 사용자 facing wait time 이
> 180s+ 발생 (Drift #5). 현재 단일 Toast.info (8s) 만으로는 wait 도중
> 사용자가 *어느 단계인지* 알 수 없음. 본 ADR 은 `StepIgesImporter` 의
> `onStage(stage, message)` callback 추가 + `FileImporter` 의 sequential
> Toast.info wiring 으로 stage 별 진행 상황 표시. Stage 3개:
> engine_load / parse / tessellate. 3 sub-atomic 분해 (P-α/β/γ).
> Initial bundle 0MB strict (P20.C #2).

---

## 1. Context

### 1.1 ADR-082 Drift #5 의 사용자 facing 영향

ADR-082 LOCKED #29 § Wrapper drift 누적:
> Drift #5 (봉인): Browser env OCCT init 180s+ 소요 — CI smoke 부적합.
> Real init 검증은 별도 slow channel deferred

**사용자 facing 측면**:
- STEP 파일 import → OCCT chunk fetch + libs init + parse + tessellate
  = **180s+ wait**
- 현재 UX: 단일 `Toast.info('STEP/IGES 엔진 로딩 중...', 8000)` 만 표시
- 8s 후 Toast 사라짐 → 사용자: "멈췄나? 실패했나?" 혼란

### 1.2 ADR-083/084 visual unlock 의 wait 시 효과

ADR-083 + ADR-084 closure 후 (LOCKED #30/#31):
- import 완료 시 viewport 에 face mesh + edge wireframe 표시 ✅
- BUT 완료까지 wait 의 *경험* 은 미해결 — wait 동안 viewport 는 빈 상태
- demo 시 사용자 인내심에 의존

### 1.3 단계별 wait 시간 분석 (T-δ slow channel 측정)

```
Stage 1: OCCT.js chunk fetch       ~5-10s  (5.37MB lazy chunk + 50+ WASM)
Stage 2: initOpenCascade + libs    ~120-180s  (Drift #5 의 본체 — 5+ MB
                                             WASM compile + module link)
Stage 3: STEP file parse           ~1-5s   (_readShape)
Stage 4: BRep traversal            ~0.1s   (traverseBrep)
Stage 5: BRepMesh tessellation     ~5-30s  (tessellateShape + Edges)
Stage 6: Three.js Group 생성       ~0.1s   (_convertToThreeGroup)
```

→ 사용자 facing 으로는 **3 stage** 통합 가시성이 충분:
- "엔진 로딩" (stage 1+2 — 가장 긴 단계, OCCT init)
- "파일 분석" (stage 3+4 — STEP parse + traverse)
- "Mesh 생성" (stage 5+6 — tessellate + render)

### 1.4 사용자 가치 anchor (ADR-046 P31)

- **P1 (건축/디자인)**: import 도중 어느 단계인지 인지 → "정상 진행
  중" 신뢰. 5분 wait 도 *이해 가능한 이벤트* 로 변환.
- **P3 (AI 협업자)**: AI agent 의 STEP import 호출 시 stage 별 ack
  log → debugging / 진행 추적

**Demo readiness 90% → 95%+** (wait 시 사용자 신뢰 측면).

---

## 2. Decision

### 2.1 Lock-ins L1 ~ L7

- **L1 — Stage 정의**: 3 stages (사용자 facing minimum):
  * `engine_load`: OCCT chunk fetch + initOpenCascade + libs (~180s 의
    대부분)
  * `parse`: `_readShape` + `traverseBrep` (~5s)
  * `tessellate`: `tessellateShape` + `tessellateEdges` + Three.js
    Group (~5-30s)
- **L2 — Callback signature**: `StepIgesImporter.onStage?: (stage:
  StageName, message: string) => void;` 신규 (`StageName` =
  `'engine_load' | 'parse' | 'tessellate'`).
- **L3 — Backward compat**: 기존 `onLoadingStart` / `onLoadingEnd`
  preserved — engine_load stage 의 시작 / 끝 에서 자동 fire (외부
  C-β/C-γ 회귀 무영향).
- **L4 — FileImporter wiring**: 각 stage 마다 `Toast.info(message,
  duration)` 호출. Sequential 표시 (max 3 가시 — 가장 최근 stage 가
  user 에 visible).
- **L5 — Final stage**: 기존 패턴 답습 — warnings 있으면 `Toast.warning`,
  clean import 시 `Toast.success` (face/edge count 표시). 본 ADR 은
  중간 stage Toast 만 추가.
- **L6 — Initial bundle 0MB strict** (P20.C #2 답습): `StepIgesImporter`
  / `FileImporter` chunk 영역만. Toast 모듈 변경 없음.
- **L7 — Korean wording**: 본 ADR 의 stage 메시지는 한국어 하드코딩
  (ADR-046 Phase 2 i18n cross-cut, 본 ADR scope 외).

### 2.2 Out of scope (별도 ADR)

- **Persistent updatable Toast** — 단일 Toast 가 stage 진행에 따라
  내용 update. Toast API 확장 필요 (별도 ADR-086 가능).
- **Progress percentage** — stage 별 % 표시. timing 측정 + UI bar 필요.
- **Cancel button** — wait 도중 사용자가 import 중단. AbortController
  통합 필요.
- **Stage-specific timing budget** — stage 별 timeout / metrics. 별도
  ADR.
- **i18n stage messages** — ADR-046 Phase 2 통합 시.
- **Drift #5 timing 단축 자체** — WASM streaming compile / parallel
  libs / cache 등. 별도 architectural ADR.

### 2.3 Decision matrix (사전 검토 §85-A ~ §85-D)

본 ADR 진입 직전 사용자 결재 (2026-05-08, 권장 path #3):
- **§85-A**: 3 stages (engine_load / parse / tessellate)
- **§85-B**: Sequential Toast.info (Toast API 확장 미수행 — minimum scope)
- **§85-C**: Backward compat 유지 (onLoadingStart/End preserved)
- **§85-D**: 3 sub-atomic (P-α/β/γ) — minimum scope

---

## 3. Implementation Plan (post-acceptance)

### 3.1 P-α — ADR-085 spec only — ✅ 본 commit

본 commit 이 P-α. spec docs 작성만, 코드 변경 0.

### 3.2 P-β — `StepIgesImporter.onStage` + `FileImporter` Toast wiring + tests

`StepIgesImporter`:
- `public onStage?: (stage: 'engine_load' | 'parse' | 'tessellate',
  message: string) => void;` 추가
- `_loadOcct` 직전 `onStage('engine_load', '엔진 로딩 중...')` (5+ min
  wait 시작)
- `_readShape` 직전 `onStage('parse', '파일 분석 중...')` (parse 시작
  — engine_load 완료 후)
- `_convertToThreeGroup` 직전 `onStage('tessellate', 'Mesh 생성
  중...')` (tessellation 시작)
- 기존 `onLoadingStart` / `onLoadingEnd` 유지 (backward compat —
  engine_load stage 와 시점 동일)

`FileImporter`:
- 기존: `importer.onLoadingStart = (msg) => Toast.info(msg, 8000);`
- 신규: 추가로 `importer.onStage = (stage, msg) => Toast.info(msg,
  8000);` — stage 별 sequential Toast

회귀: vitest +3~5:
- StepIgesImporter — onStage callback fires 3 times during importFile
- FileImporter — Toast.info called 3+ times sequentially
- Backward compat — existing onLoadingStart still fires

### 3.3 P-γ — LOCKED #32 + closure (docs only)

- LOCKED #32 (ADR-085 closure) 거버넌스 등재 — LOCKED #28~#31 패턴 답습
- 사용자 manual demo 회고 별도 follow-up
- 회고 commit (docs only)

회귀: 0.

### 3.4 누적 회귀 예상

- vitest **+3~5** (P-β)
- Playwright: T-δ slow channel 의 기존 회귀 자동 검증 (onStage 추가
  callback 은 기존 invariant 영향 없음)
- Initial bundle: 0MB strict 유지 (P20.C #2). 본 ADR 코드는
  `StepIgesImporter` / `FileImporter` chunk 영역만.

---

## 4. Acceptance Criteria

P-α 본 commit 으로 만족:

- [x] ADR-085 spec 작성 (§0 ~ §6)
- [x] ADR-082 Drift #5 / ADR-083 / ADR-084 / ADR-046 cross-link 명시
- [x] L1 ~ L7 lock-ins 명시
- [x] §85-A ~ §85-D 사전 검토 결과 정합
- [x] P-α ~ P-γ 3 sub-atomic 로드맵 명시
- [x] Out of scope (persistent Toast / percentage / cancel / timing
  budget / i18n / Drift #5 단축) 명시
- [x] 사용자 가치 anchor (P1 / P3 페르소나, demo 90%→95%) 명시
- [x] 단계별 wait 시간 분석 (Drift #5 분해)

본 ADR 의 commit 만으로 P-α 완료. 후속 P-β / P-γ 별도 atomic + 별도
결재.

---

## 5. Cross-references

- **ADR-082 LOCKED #29 §Wrapper drift Drift #5** — 본 ADR 의 직접 trigger.
  Drift #5 timing 단축은 별도 architectural ADR, 본 ADR 은 *wait 시
  사용자 인지* 만 개선.
- **ADR-083 LOCKED #30 (T-γ)** — viewport 표시 unlock. 본 ADR 이 그
  *wait 시점 까지의 UX* 보강.
- **ADR-084 LOCKED #31 (E-γ)** — edge wireframe layer. 본 ADR 과 동일
  사용자 facing path (STEP import).
- **ADR-035 P20.C #2** (initial bundle 0MB) — strict 유지. 본 ADR
  코드 변경은 chunk 영역만.
- **ADR-046 P31** P1+P3 페르소나 UI/UX 가치 anchor — wait 시 신뢰성.

---

## 6. Lessons (작성 시점)

- **Wait time 의 perception**: 같은 180s wait 도 *진행 상황 가시* 시
  훨씬 짧게 느껴짐 (HCI 표준 패턴). Drift #5 의 본질 단축 (별도 ADR)
  대비 *immediate-value* 변화로 minimum scope 효과 큼.
- **3 stages 의 적정성**: 6+ stage 가능하지만 사용자 facing 으로는
  *step granularity 가 너무 세밀하면 noise*. 3 stage 가 P1+P3 페르소나
  가치 sweet spot.
- **Backward compat 의 가치**: ADR-082 C-β 의 8 reachability/drift
  회귀 + ADR-082 C-ε 의 17 Playwright 회귀가 본 ADR 의 onStage 추가로
  깨지지 않아야 함. 기존 onLoadingStart/End preserved 가 strict
  requirement.
- **Sequential Toast 의 trade-off**: 본 ADR 은 Toast API 확장 (persistent
  + update) 미수행 — minimum scope 결정. user 가 max 3 stacked toast
  를 보는 UX 는 *허용 수준* (별도 ADR 에서 update API 추가 가능).

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: **Accepted**
(P-α spec only commit 2026-05-08). P-β / P-γ 별도 commit 으로 구현.
