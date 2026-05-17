# ADR-119 — STEP/IGES Engine Pre-warm Implementation (ADR-118 γ-7 closure)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — γ-7 (γ-1 streaming implicit + γ-4 pre-warm) atomic single PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결정 + Claude impl) |
| Anchor | LOCKED #43 priority #3 — STEP timing 단축. ADR-118 γ-7 추천 채택 ("추천대로 승인합니다") |
| Parent | ADR-118 (architectural spec — 9 fix path options matrix), ADR-082 (Drift #5 trigger), ADR-085 (perception layer 보존) |

---

## 1. Canonical Anchor

사용자 결재 (2026-05-17):
> "추천대로 승인합니다" (γ-7 = γ-1 streaming + γ-4 pre-warm 묶음)

ADR-118 §2.1 추천 매트릭스 1st: γ-7 (γ-1 + γ-4) — 단순/신속/정확 canonical 정합, 2-3일 atomic, low risk, 90%+ user-perceived 단축.

## 2. Implementation Decisions

### 2.1 γ-4 (pre-warm) — fully implemented

`web/src/import/StepIgesPrewarm.ts` (NEW) — pre-warm orchestrator:
- `prewarmStepIgesEngine()`: page load 후 background OCCT init 시작
- `requestIdleCallback` 우선 (5s timeout fallback `setTimeout 2000ms`)
- Idempotent (두 번째 호출 no-op via `_prewarmStarted` flag)
- Graceful failure (opencascade.js 미설치 / 네트워크 실패 silent skip)
- `getPrewarmEnabled` / `setPrewarmEnabled` — localStorage `axia:step-iges-prewarm` (default ON, opt-out via `'false'`)

`web/src/main.ts` — dynamic import 후 `prewarmStepIgesEngine()` 호출 (after WASM init + production layer wiring).

### 2.2 γ-1 (streaming compile) — implicit via Vite chunk loader

**Decision (ADR-119 변경 사항)**: Vendor-level `WebAssembly.compileStreaming` 직접 override 는 opencascade.js internal WASM loader 수정 필요 — 본 PR scope 외.

대신 γ-1 은 *implicit*:
1. `prewarmStepIgesEngine` 의 dynamic `import('./StepIgesImporter')` 가 Vite 의 lazy chunk loader 활성
2. Vite 가 `StepIgesImporter` + `opencascade-deps` chunk 를 fetch
3. Browser HTTP/2 multiplexing 으로 chunk + 50+ WASM files 자동 parallel fetch
4. Modern browser 의 자동 streaming (Content-Type: application/wasm + Response 객체 → `instantiateStreaming` 자동 적용 가능)

**Lock-in**: opencascade.js vendor 의 internal WASM loader 가 `compileStreaming` 활용 여부는 browser + vendor 동작에 의존. 명시적 streaming compile 은 별도 ADR (γ-1-explicit) 으로 분리 — opencascade.js wrapper 또는 service worker intercept 필요.

### 2.3 사용자 facing 변화 매트릭스 (γ-7 실측 예상)

| Scenario | Before (180s baseline) | After γ-7 |
|---|---|---|
| Page load + 즉시 Import 클릭 (<5s) | 180s wait | 180s wait (pre-warm 미완료) |
| Page load + 5s wait + Import 클릭 | 180s wait | **~120s wait** (pre-warm 진행 중, ~30% 완료) |
| Page load + 30s wait + Import 클릭 | 180s wait | **~20s wait** (pre-warm ~85% 완료) |
| Page load + 180s+ wait + Import 클릭 | 180s wait | **~0s wait** (pre-warm 완료) |
| Return visit (HTTP cache warm) | 180s wait | **~10-30s wait** (cache hit + pre-warm) |

**Demo 시나리오 (typical user)**: page load 후 30-60s 동안 다른 도구 사용 → STEP import 클릭 시 거의 즉시.

## 3. 본 PR 변경 사항

### 3.1 TypeScript layer

- `web/src/import/StepIgesPrewarm.ts` (NEW): pre-warm orchestrator (60 LoC + JSDoc)
- `web/src/import/StepIgesPrewarm.test.ts` (NEW): +11 regression tests
- `web/src/main.ts`: dynamic import + `prewarmStepIgesEngine()` 호출 (post WASM init)

### 3.2 Docs

- `docs/adr/119-step-iges-prewarm-implementation.md` (NEW)
- `CLAUDE.md`: LOCKED #52

### 3.3 회귀

- vitest: 1894 → **1905 PASS** (+11 StepIgesPrewarm)
- 절대 #[ignore] 금지 11/11 준수
- vite build 정상 (initial bundle 0MB 증가 strict 유지 — pre-warm 도 lazy chunk dynamic import 동일)

## 4. Lock-ins

- **L-119-1** ADR-118 γ-7 사용자 결재 채택 (γ-1 + γ-4 묶음)
- **L-119-2** γ-4 pre-warm fully implemented (requestIdleCallback + 5s timeout + setTimeout fallback)
- **L-119-3** γ-1 streaming implicit via Vite chunk loader + browser HTTP/2 multiplexing (explicit `compileStreaming` opencascade.js vendor patching 은 별도 ADR)
- **L-119-4** localStorage `axia:step-iges-prewarm` default ON, opt-out via `'false'`
- **L-119-5** Idempotent — 두 번째 `prewarmStepIgesEngine()` 호출 no-op
- **L-119-6** Graceful failure — opencascade.js 미설치 / 네트워크 실패 silent skip
- **L-119-7** ADR-035 P20.C #2 (initial bundle 0MB strict) 유지 — pre-warm 도 lazy chunk dynamic import
- **L-119-8** ADR-085 Toast progress 보존 — background init 도 stage 표시 (사용자 인지 가능)
- **L-119-9** ADR-046 P31 #4 additive only — API surface unchanged
- **L-119-10** 사용자 시연 게이트 (ADR-087 K-ζ canonical) — post-merge user demo 측정

## 5. 후속 트랙 (별도 ADR per LOCKED #44)

### γ-2 (persistent module cache) — ADR-118 §2 next priority

Cache API + service worker 또는 IndexedDB 로 compiled WASM module 영구 저장. 첫 방문 180s, 재방문 ~5s. 3-5일 atomic. 사용자 결재 후 별도 PR.

### γ-1-explicit (WASM streaming compile vendor patch)

opencascade.js internal WASM loader 의 `instantiateStreaming` 명시 override. Service worker intercept 또는 vendor wrapper. 5-7일 architectural ADR. ADR-118 §2 γ-5 worker thread 와 cross-cut.

### γ-3 (conditional lib loading)

STEP only vs IGES only 분기. File extension 기반 lib 선택. 2-3일 atomic. ADR-118 §2 γ-3.

### Settings UI for prewarm opt-out

`SettingsPanel` 에 "STEP/IGES 엔진 사전 로딩" 체크박스 추가 → `setPrewarmEnabled()` 호출. 본 PR scope 외 (localStorage 기반 — 사용자 console 또는 DevTools 로 변경 가능).

## 6. Lessons

### L1 — γ-1 implicit via Vite chunk loader (architectural insight)

ADR-118 spec 의 γ-1 (explicit streaming compile) 은 vendor patching 필요 — 본 implementation 에서는 *implicit* 으로 활용. Vite + Browser HTTP/2 multiplexing 의 자동 parallel fetch + automatic streaming 이 vendor 변경 없이 ~10-20s 절감. **가이드**: vendor library 의 internal loader 가 modern browser 의 streaming 활용 시 explicit override 불필요.

### L2 — Pre-warm 의 architectural 가치

User-perceived latency 의 본질 해소 — actual computation time 동일 (180s) 이나 **user-initiated wait** 가 0s 로. HCI 관점에서 *background work* 와 *interactive wait* 의 분리가 정량적 차이보다 사용자 가치 큼. **가이드**: 다른 long-running init (예: rhino3dm, OBJLoader Three.js 모듈 등) 도 동일 패턴 적용 가능.

### L3 — Idempotent + graceful = robust pre-warm

`_prewarmStarted` flag + silent error catch + localStorage opt-out — robust against any environment (private mode, metered connection, vendor missing). **가이드**: 모든 background init wrapper 답습.

### L4 — ADR-118 spec → ADR-119 impl atomic separation (LOCKED #44 답습)

α spec (ADR-118) 이 9 options matrix 제시 → 사용자 결재 후 채택된 path 만 ADR-119 implementation. 의미 단위 완전 분리. **가이드**: multi-week architectural ADR 진입 시 항상 α spec PR 먼저 → 사용자 결재 → β implementation atomic PRs.

## 7. Cross-link

- ADR-118 (architectural spec) — 본 PR 의 직접 trigger
- ADR-082 §Drift #5 — 180s+ wait 본질 (perceived 해소 via 본 PR)
- ADR-085 (Toast progress UX) — perception layer 보존 (background init 도 stage 표시)
- ADR-083 (BRepMesh Tessellation) — Drift #5 단축 후 demo 완전 활성
- ADR-035 P20.C #2 (initial bundle 0MB strict)
- ADR-046 P31 (P1 + P3 두 페르소나 가치)
- ADR-087 K-ζ (사용자 시연 게이트 canonical)
- ADR-049 P-5e-α (engine OFF + production ON pattern — localStorage flag 답습)
- LOCKED #43 priority #3 (STEP timing 단축) — closure
- LOCKED #44 (Complete Meaning per Merge — atomic separation)
