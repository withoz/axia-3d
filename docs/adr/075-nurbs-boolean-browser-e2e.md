# ADR-075 — NURBS Boolean Browser E2E (Playwright)

**Status**: E4-1 진입 (Path Z 패턴 답습, 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-064 §E.4 + ADR-066 §E.4 (Real browser-runtime E2E
미해결, 인프라 공유)
**Parent**: ADR-064 Path Z 전 stack 완료 (`03fb6e8`) + ADR-066 Path Y
전 stack 완료 (`eb71e7e`)
**Prerequisites**: ADR-064 + ADR-066 의 mock-level 회귀 +62 (contract
검증 완료).

---

## 0. Summary (4 lines)

> ADR-064 + ADR-066 의 mock + source-inspection 회귀 (+62) 가 contract
> 검증. Playwright 인프라로 실제 WASM 로딩 후 round-trip 검증 추가.
> E.4 트랙 신설 — 향후 모든 ADR 가 활용 가능한 공용 자산. E4-1 = 인프라
> + smoke (atomic). E4-2~E4-7 별도 sub-step.

---

## 1. Context

### 1.1 Mock-level 회귀의 한계

ADR-064 + ADR-066 의 회귀 +62 가 모두 **contract 검증**:
- `WasmBridge.test.ts`: 엔진 mock + JSON envelope 파싱 검증
- `boolean_dispatch.rs` lib tests: Rust mesh state 직접 검증
- `step6_additive_only.rs` integration: source-text inspection (cargo
  test 가 wasm-bindgen 마샬링 panic 으로 runtime 호출 불가)
- `BooleanHandler.test.ts`: bridge mock + Toast/syncMesh 호출 검증

**미검증**: 실제 브라우저에서 WASM 로딩 → 사용자 클릭 → Boolean →
mesh state 변경 → undo → 복구 의 round-trip.

### 1.2 ADR-064 §E.4 / ADR-066 §E.4 인프라 공유

> 본 세션의 회귀 X 개는 mock + source-inspection 기반 contract 검증.
> 실제 WASM 로딩 후 사용자 클릭 → boolean → undo 의 round-trip 은
> 별도 인프라 (Playwright/Cypress) 필요. 별도 PR.

두 ADR 이 동일한 미해결 항목을 명시 — ADR-075 가 두 트랙을 한 번에 닫음.

### 1.3 사용자 가치

- **회귀 강화**: mock 이 놓칠 수 있는 WASM 마샬링 / 메모리 / async
  타이밍 / DOM 인터랙션 버그를 잡음.
- **공용 자산**: 향후 모든 ADR (Press-Pull / STEP-IGES / Tensor uv / etc.)
  의 round-trip 검증에 동일 인프라 활용.
- **CI 보호**: PR 마다 실제 round-trip 검증 → silent regression 차단.

---

## 2. Decision — E.4 scope + 10개 E4 + 4 Lock-in

### 2.1 §A — E4-1 scope

**채택 (E4-1 atomic)**:
- `@playwright/test` devDependency 설치
- `web/playwright.config.ts` — Chromium / Vite preview / 1 worker
- `web/e2e/smoke.spec.ts` — WASM bridge initialization smoke (1-2 tests)
- `web/package.json` 의 `e2e` / `e2e:install` script 추가
- `web/.gitignore` 에 playwright artifacts 추가

**제외 (E4-2~E4-7 별도 sub-step)**:
- E4-2: ADR-064 single-face DCEL E2E
- E4-3: ADR-066 multi-face DCEL E2E
- E4-4: Undo round-trip multi-step E2E
- E4-5: Disjoint / no-loops / error 분기 E2E
- E4-6: CI workflow 통합
- E4-7: 회고 / docs

### 2.2 §B — 10개 E4 결정

| E4 | 결정 | 비고 |
|----|------|------|
| **E4-A** | ADR-075: NURBS Boolean Browser E2E | 자연 번호 |
| **E4-B** | (a) Playwright | 업계 표준 + WASM 지원 + headless |
| **E4-C** | (a) Vite preview | 프로덕션-닮은 빌드 |
| **E4-D** | (a) 빌드 산출물 사용 | `web/src/wasm/*` 가 sourcecontrol |
| **E4-E** | (c) smoke 우선 | atomic Path Z 답습 |
| **E4-F** | (c) atomic E4-1 | 인프라 → smoke → 점진 확장 |
| **E4-G** | (a) Chromium only | atomic 시작점, 다중 브라우저 별도 |
| **E4-H** | `e2e_*` / `*.spec.ts` | playwright 표준 |
| **E4-I** | (b) CI 별도 sub-step (E4-6) | atomic 일관 |
| **E4-J** | `web/e2e/` | playwright 관습 |

### 2.3 §C — 4 Lock-in

```
1. E4-1 = 인프라 + smoke only. ADR-064/066 실제 round-trip (E4-2~E4-5)
   별도 sub-step.

2. Drop-in alongside — 기존 vitest 회귀 +62 UNCHANGED. playwright 는
   별도 디렉토리 (`web/e2e/`) + 별도 npm script (`e2e`). vitest 회귀와
   분리.

3. Browser binaries 미설치 환경 정합 — `npm install` 단독으로는 browser
   다운로드 안 함. 사용자가 `npm run e2e:install` 명시 호출.
   CI 에서는 `npx playwright install --with-deps chromium`.

4. Vite preview port 충돌 회피 — playwright config 에서 `port: 0`
   (random) + `webServer.url` 사용으로 port 자동 협상.
```

---

## 3. Acceptance — E4-1

### 3.1 E4-1 산출물

- **Files added**:
  - `web/playwright.config.ts`
  - `web/e2e/smoke.spec.ts`
  - `web/e2e/helpers/bridge-init.ts` (선택 — bridge 초기화 헬퍼)
- **Files modified**:
  - `web/package.json` (devDep + scripts)
  - `web/.gitignore` (playwright artifacts)

### 3.2 E4-1 회귀 (1-2, 절대 #[ignore] 금지)

1. `wasm bridge initializes successfully in browser` — `bridge.init()`
   resolves + `isReady() === true` (smoke, browser runtime 검증)
2. `empty mesh has zero faces and zero verts` — defensive smoke (mesh
   state contract via getStats())

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 (예상) |
|----------|------|------------|
| E4-1 | Playwright 인프라 + smoke | 1-2 |
| E4-2 | ADR-064 single-face DCEL E2E | 3 |
| E4-3 | ADR-066 multi-face DCEL E2E | 3 |
| E4-4 | Undo round-trip multi-step E2E | 2 |
| E4-5 | Disjoint / no-loops / error 분기 E2E | 3 |
| E4-6 | CI workflow 통합 | 0 |
| E4-7 | 회고 / docs | 0 |
| **합계 (예상)** | — | **~12** |

---

## 5. References

- ADR-064 §E.4 (Real browser-runtime E2E 미해결)
- ADR-066 §E.4 (동일 인프라 공유)
- `WasmBridge.test.ts` (mock-level contract 검증, vitest)
- Playwright docs: https://playwright.dev/

---

*Author*: AXiA team (E.4 트랙 사용자 결정 2026-05-04)
*Status*: E4-1 implementation 진행 중
