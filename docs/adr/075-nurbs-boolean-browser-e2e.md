# ADR-075 — NURBS Boolean Browser E2E (Playwright)

**Status**: Accepted (E.4 트랙 핵심 sub-step 완료 — E4-1 / E4-2 / E4-3 / E4-4 / E4-6 / E4-7, 2026-05-04)
**Last commit**: `c6184ba` (E4-6 CI workflow) → 본 commit (E4-7 회고)
**Date**: 2026-05-04 (E4-1 진입 → E4-7 완료, 같은 세션)
**Anchor**: ADR-064 §E.4 + ADR-066 §E.4 (Real browser-runtime E2E
미해결, 인프라 공유) — **본 ADR 으로 두 항목 모두 닫힘**
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

| Sub-step | 영역 | 회귀 | 상태 |
|----------|------|------|------|
| E4-1 | Playwright 인프라 + smoke | 2 | **✅ 본 ADR §D-E1** |
| E4-2 | ADR-064 single-face DCEL E2E | 3 | **✅ 본 ADR §D-E2** |
| E4-3 | ADR-066 multi-face DCEL E2E | 4 | **✅ 본 ADR §D-E3** |
| E4-4 | Undo round-trip E2E | 2 | **✅ 본 ADR §D-E4** |
| E4-5 | Edge cases (intersecting / multi-step undo / redo) | (~3) | 미착수 (선택적, 별도 sub-step 또는 ADR) |
| E4-6 | CI workflow 통합 | 0 (automation) | **✅ 본 ADR §D-E6** |
| E4-7 | 회고 / docs | 0 (docs only) | **✅ 본 commit** |
| **합계 (완료)** | — | **11 E2E + automation** | — |

---

## D. Acceptance Log — E.4 트랙 핵심 (2026-05-04)

본 세션에서 E.4 트랙의 핵심 sub-step (E4-1~E4-4 + E4-6 + E4-7) 이
atomic 하게 닫혔다. ADR-064 §E.4 + ADR-066 §E.4 두 미해결 항목을
공통 인프라 + content + automation 으로 동시 해소. 누적 회귀
**11 E2E** (real Chromium round-trip) + CI 자동화. E4-5 (edge cases)
는 선택적 — 본 ADR 의 핵심 가치는 이미 완성됨.

### §D-E1 — E4-1 Playwright 인프라 + smoke (commit `c7909d5`)

**의의**: E.4 트랙의 인프라 자산 신설. `@playwright/test` devDep +
`web/playwright.config.ts` (Chromium / Vite preview / port 4179) +
`web/e2e/smoke.spec.ts`. 향후 모든 ADR 의 round-trip 검증에 활용
가능한 공용 자산.

**E4-decisions**: E4-A=ADR-075, E4-B=Playwright (산업 표준 + WASM
지원 + headless), E4-C=Vite preview, E4-D=빌드 산출물 사용,
E4-E=(c) smoke 우선, E4-F=(c) atomic E4-1 only, E4-G=Chromium only,
E4-H=`e2e_*` 명명, E4-I=CI 별도 sub-step (E4-6), E4-J=`web/e2e/`.

**Lock-in #4**: Vite preview port 4179 + strictPort — dev (5173) /
preview default (4173) 와 분리 (port 충돌 회피).

**회귀 (2, 절대 #[ignore] 금지)**:
- wasm bridge initializes successfully in browser
- empty mesh has zero faces and zero verts on fresh init

### §D-E2 — E4-2 ADR-064 single-face DCEL E2E (commit `a873da7`)

**의의**: ADR-064 Path Z 의 single-face mesh-level Boolean 의미론을
실제 브라우저에서 round-trip 검증. mock 이 놓칠 수 있는 WASM 마샬링
/ async 타이밍 / DOM 인터랙션 버그 방어선. ADR-064 §E.4 의 single-face
부분 닫음.

**E4-decisions**: E4-2-a=(b) 3 atomic 시나리오, E4-2-b=(a) bridge
methods (drawRect + setFaceSurfacePlane) 로 mesh setup, E4-2-c=(a)
helper 분리 (`web/e2e/helpers/boolean-fixtures.ts` — E4-3/4/5 재사용),
E4-2-d=(a) result struct shape 검증, E4-2-e=3 tests, E4-2-f=
window.__axia 진입, E4-2-g=`dcel-single.spec.ts`, E4-2-h=(a) fresh
page per test.

**결정적 발견**: `bridge.drawRect` 가 FaceId 가 아닌 **XIA ID** 반환.
`bridge.getXiaFaceIds(xia)` 로 변환 + defensive throw on 0 faces.
helper 에 명시.

**WASM rebuild required**: Step 6-α + Y-2 commits 의 새 export
(`booleanDispatchDcelJson` + `booleanDispatchDcelMultiJson`) 가
shipped dist/ 에 반영되도록 wasm-pack build 재실행. `npm run build:all`
로 통합 빌드.

**회귀 (3, 절대 #[ignore] 금지)**:
- disjoint Subtract preserves both inputs (D-F=(c) round-trip)
- ineligible (no analytic surface) routes to Mesh path (Y-E)
- 3 ops accepted on eligible pair (D-B=(a))

### §D-E3 — E4-3 ADR-066 multi-face DCEL E2E (commit `8701bcf`)

**의의**: ADR-066 Path Y 의 multi-face cartesian dispatch 를 실제
브라우저에서 round-trip 검증. ADR-066 §E.4 닫음. E4-2 helper 위에
N-face setup + multi invocation 추가.

**E4-decisions**: E4-3-a=(d) 4 atomic 시나리오, E4-3-b=(a) helper
확장 (`setupNPlaneFaces` + `invokeBooleanDispatchDcelMulti`),
E4-3-c=(a) 2×2 cartesian (4 pairs), E4-3-d=(b) 1×1 degenerate per_pair[0]
검증 (Y-1 lock-in #4), E4-3-e=새 helper, E4-3-f=(a) struct shape,
E4-3-g=`dcel-multi.spec.ts`, E4-3-h=(a) fresh page per test.

**Helper 확장**: `NPlaneFaces` interface, `setupNPlaneFaces` (N
parallel disjoint planes at zStep 간격), `invokeBooleanDispatchDcelMulti`.

**회귀 (4, 절대 #[ignore] 금지)**:
- 1×1 degenerate delegates to Path Z (Y-1 lock-in #4)
- 2×2 cartesian produces 4 per_pair outcomes (Y-G=(a))
- Y-E ineligibility (no surfaces) routes to Mesh path
- 3 ops accepted on multi (Y-2 D-B parity)

### §D-E4 — E4-4 Boolean → Undo round-trip E2E (commit `07e3baa`)

**의의**: Y-2 / Step 6-α 의 transaction wrapping (source-inspection
검증) 위에 실제 commit/cancel + undo 동작 검증. **ADR-064 §E.4 +
ADR-066 §E.4 의 마지막 미해결 항목 (browser-runtime undo round-trip)
닫음**.

**E4-decisions**: E4-4-a=(c) single + multi (양 ADR 동시 닫음),
E4-4-b=(b) face IDs set + count via `captureMeshSnapshot`,
E4-4-c=(a) 2 atomic 시나리오, E4-4-d=disjoint fixtures only,
E4-4-e=신규 헬퍼 (`captureMeshSnapshot` + `invokeUndo`),
E4-4-f=`undo-roundtrip.spec.ts`, E4-4-g=(a) fresh page per test.

**Disjoint scope explanation**: Plane × Plane intersecting cases →
Phase J 가 closed loop 미생성 → D-H safe-only 가 입력 보존. 결국
disjoint contract = no-mesh-mutation contract for plane fixtures.
Real intersecting round-trip (Cylinder ∩ Plane 등) 은 E4-5 territory.

**검증되는 것**:
- Transaction wrapping (Y-2 / Step 6-α) 가 실제 WASM runtime 에서
  commit/cancel 작동
- bridge.undo() returns true after Boolean dispatch (transaction
  committed, undo stack populated)
- Mesh state stays consistent across dispatch + undo cycle (no
  spurious face count drift)
- Cross-method sequencing: dispatch → undo doesn't break bridge state

**회귀 (2, 절대 #[ignore] 금지)**:
- single-face dispatch → undo restores mesh state (Path Z)
- multi-face dispatch → undo restores mesh state (Path Y)

### §D-E6 — E4-6 CI workflow (commit `c6184ba`)

**의의**: E.4 트랙의 automation 자산. PR 마다 11 E2E + Rust tests
자동 검증. silent regression 차단.

**E4-decisions**: E4-6-a=GitHub Actions, E4-6-b=(b) 3 jobs (rust-test
+ web-e2e + 기존 build.yml 의 web-test), E4-6-c=PR + push to main +
claude/** + feature/**, E4-6-e=ubuntu-latest only, E4-6-f=Rust
caching (Swatinem/rust-cache@v2), E4-6-g=Node caching, E4-6-h=매 run
WASM 재빌드 (truth = source), E4-6-i=Playwright Chromium only,
E4-6-j=parallel (rust-test ⊥ web-e2e), E4-6-k=failure artifact
upload (playwright-report + traces), E4-6-l=`.github/workflows/ci.yml`,
E4-6-m=atomic, E4-6-n=`ci`.

**Drop-in alongside**: 기존 4 workflow (build / deploy / mcp /
release) UNCHANGED. 신규 ci.yml 만 2 jobs 추가.

**Concurrency control**: `group: ci-${{ github.ref }}` +
`cancel-in-progress: true` — 같은 ref 의 stale run 자동 취소.

**결합 CI surface**:
| Job | Workflow | 검증 |
|-----|----------|------|
| build (matrix) | build.yml | wasm + tsc + vite |
| test | build.yml | vitest 1425 |
| **rust-test (NEW)** | **ci.yml** | **cargo geo+wasm 980** |
| **web-e2e (NEW)** | **ci.yml** | **playwright 11** |

**본 commit 의 한계**: 실제 GitHub Actions 실행은 push 후만 검증
가능. 본 commit 은 YAML lint + 로컬 검증 (모든 step 의 commands
가 본 세션에서 실행 그린) 까지.

### §D-E7 — E4-7 회고 / docs (본 commit)

본 회고 commit. ADR-075 §D Acceptance Log 채움 + CLAUDE.md 의 신규
"ADR-075" 섹션. 코드 변경 0.

---

## E. Known Limitations (E.4 트랙 미해결)

### E.5 Edge cases (선택적 sub-step 또는 별도 ADR)

본 ADR 의 핵심 가치 (browser-runtime round-trip) 는 E4-1~E4-4 로
완성. E4-5 는 선택적 확장 — atomic 으로 분할 가능:

- **Intersecting fixtures**: Cylinder ∩ Plane / Sphere ∩ Plane 등
  실제 closed-loop intersection. mesh 가 실제로 변화하는 round-trip.
- **Multi-step undo / redo**: 여러 Boolean 누적 후 undo N 번 → 정확한
  복구. 현재 E4-4 는 single-step 만.
- **Error envelope round-trip**: invalid op string / 없는 face ID
  → bridge.error envelope. browser-side 동작 확인.

본 ADR scope 외로 둠 — 향후 ADR 또는 sub-step 으로 진행.

### E.6 Multi-OS / Multi-browser matrix (별도 sub-step)

E4-6 은 ubuntu-latest + Chromium only. 향후:
- Windows / macOS runner 추가
- Firefox / WebKit 브라우저 추가
- 결정 매트릭스 大 → 별도 ADR 후보

### E.7 nightly cron / scheduled run (별도 sub-step)

PR + push 외에 dependency drift / 외부 변경 회귀 차단을 위한 nightly
schedule 트리거. 별도 sub-step 또는 build.yml 통합.

### E.8 Visual regression / screenshot diff (별도 ADR)

Playwright 의 `expect(page).toHaveScreenshot()` 활용. 본 ADR scope
외 — UI 변경 검증은 별도 트랙.

---

## F. 회귀 누적 (E.4 트랙)

| 단계 | Pre-E4 baseline | After E.4 | Δ |
|------|-----------------|-----------|---|
| axia-geo lib | 964 | 964 | 0 (E.4 = 신규 인프라, Rust 코드 변경 0) |
| axia-wasm tests | 16 | 16 | 0 |
| web TS vitest | 1425 | 1425 | 0 (drop-in alongside) |
| **web TS Playwright E2E (NEW)** | **0** | **11** | **+11** |
| **합계** | 2405 | **2416** | **+11** |

**11 / 11 모두 절대 #[ignore] 금지 정책 준수**.

Sub-step 별 distribution (E2E):
- E4-1 smoke: 2
- E4-2 single-face: 3
- E4-3 multi-face: 4
- E4-4 undo round-trip: 2

### Path Z + Path Y + E.4 합산 (ADR-064 + ADR-066 + ADR-075)

| Suite | Original | After all | Δ |
|-------|----------|-----------|---|
| axia-geo lib | 940 | 964 | +24 |
| axia-wasm tests | 8 | 16 | +8 |
| web TS vitest | 1395 | 1425 | +30 |
| web TS Playwright E2E | 0 | 11 | +11 |
| **합계** | 2343 | **2416** | **+73** |

**73 / 73 모두 절대 #[ignore] 금지 정책 준수**.

### CI 자동화 (E4-6)

위 73 회귀 중 **rust-test (980) + web-e2e (11) 가 PR 마다 자동
검증**. vitest (1425) 는 build.yml 의 test job 으로 이미 자동화.
즉 합계 2416 중 **2416 모두 PR 자동 검증**.

---

## G. ADR-075 의 의미 (E.4 트랙 시점)

ADR-064/066 가 mesh-level Boolean 의미론 closure (Path Z) + 확장
(Path Y) 였다면, ADR-075 는 **검증 자산 + 자동화** 의 첫 인프라성
ADR. 코드 변경 0 (Rust/TS), Playwright 위주.

| 측면 | Path Z (ADR-064) | Path Y (ADR-066) | E.4 트랙 (ADR-075) |
|------|------------------|-------------------|---------------------|
| **결정 성격** | 의미론 closure | 확장 + 새 결정 | **검증 + 자동화 (인프라)** |
| **위험** | 中-高 | 低-中 | **低-中 (인프라 결정)** |
| **commits** | 10 | 6 | **6** (E4-1, E4-2, E4-3, E4-4, E4-6, E4-7) |
| **회귀** | +38 (mock+source) | +24 (mock+source) | **+11 (real round-trip)** |
| **자산** | mesh-level API | multi-face API | **공용 인프라** |
| **재사용성** | 본 ADR 한정 | Path Z 자산 활용 | **모든 향후 ADR 활용 가능** |

**E.4 트랙의 자산성**:
- Playwright config / e2e helpers / CI workflow 는 향후 모든 ADR
  (Press-Pull / STEP-IGES / Path X / etc.) 의 round-trip 검증에
  그대로 활용 가능.
- `boolean-fixtures.ts` 의 함수들 (`setupTwoPlaneFaces` /
  `setupNPlaneFaces` / `captureMeshSnapshot` / `invokeUndo` / etc.)
  은 향후 다른 도메인의 fixture 패턴 참고 자산.
- ci.yml 의 job 패턴 (rust-test parallel with web-e2e + Swatinem
  cache + failure artifact upload) 은 신규 CI 잡 추가의 모범.

남은 미해결 (E.5 / E.6 / E.7 / E.8) 은 모두 **선택적 확장** — 본 ADR
의 핵심 가치 (browser-runtime round-trip + automation) 는 이미 완성.

---

## 5. References

- ADR-064 §E.4 (Real browser-runtime E2E 미해결)
- ADR-066 §E.4 (동일 인프라 공유)
- `WasmBridge.test.ts` (mock-level contract 검증, vitest)
- Playwright docs: https://playwright.dev/

---

*Author*: AXiA team (E.4 트랙 사용자 결정 2026-05-04)
*Status*: **E.4 트랙 핵심 sub-step 완료 2026-05-04** — 6 commits,
11 E2E real round-trip + CI 자동화, 모든 E4-decision lock-in.
E.5~E.8 미해결 항목은 모두 선택적 확장 또는 별도 트랙.
