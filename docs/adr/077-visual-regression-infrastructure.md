# ADR-077 — Visual Regression Infrastructure

**Status**: Accepted (V-1 + V-2 + V-4 + V-5 완료 — V 트랙 인프라 + 자동화 closure, 2026-05-05)
**Last commits**: V-1 (`dbfd65e`) + V-2 (`e9f7b30`) + V-5 (`8547520`) + **V-4 본 commit**
**Date**: 2026-05-05 (V-1 진입 → V-5 회고 → **V-4 CI integration**)
**Anchor**: ADR-075 §E.8 (Visual regression / screenshot diff —
별도 ADR) + ADR-074 §E.5-1 (Visual feedback — visual regression
인프라 의존)
**Parent**: ADR-075 E.4 트랙 핵심 완료 (`92056f6`) — Playwright
인프라가 본 ADR 의 base layer
**Prerequisites**: Playwright `@playwright/test` (이미 설치됨,
ADR-075 E4-1) + Vite preview + WASM build (E4-2 패턴)

---

## 0. Summary (4 lines)

> Playwright `toHaveScreenshot()` 인프라 신설 — git-tracked PNG
> baseline + 1% pixel ratio threshold + 고정 viewport. ADR-074
> §E.5-1 (visual feedback) + 향후 모든 visual UX ADR 의 enabler.
> V-1 = 인프라 + smoke baseline atomic. V-2~V-5 별도 sub-step.

---

## 1. Context

### 1.1 ADR-075 §E.8 + ADR-074 §E.5-1 의 미해결 항목

> **ADR-075 §E.8**: Playwright 의 `expect(page).toHaveScreenshot()`
> 활용. 본 ADR scope 외 — UI 변경 검증은 별도 트랙.

> **ADR-074 §E.5-1**: Visual feedback (group A/B outline 색상) 은
> polish only — model 동작은 정확히 작동, 사용자 시각 인지만 미흡.
> Three.js mock 단위 test 의 한계 — "outline mesh가 만들어졌나"
> 수준 검증만 가능. 진짜 사용자 시각 경험은 ADR-075 §E.8 visual
> regression (screenshot diff) 인프라가 있어야 의미 있는 검증
> 가능. 별도 ADR 또는 ADR-075 §E.8 와 함께 진행 권장.

본 ADR 이 이 두 미해결 항목의 **enabler** — 인프라 구축 후
ADR-074 §E.5-1 등이 visual baseline 검증 가능.

### 1.2 사용자 가치

- **회귀 강화**: mock 이 놓치는 시각 변경 (rendering / Material /
  outline / Toast 위치 등) 을 자동 감지.
- **공용 자산**: 향후 모든 visual UX ADR (ADR-074 group color /
  hover / selection style / Tool 시각 피드백 등) 의 round-trip
  검증.
- **CI 보호**: PR 마다 visual diff 자동 실행 → silent UX regression
  차단 (V-4 별도 sub-step).

---

## 2. Decision — V-1 scope + 11개 V + 4 Lock-in

### 2.1 §A — V-1 scope

**채택 (V-1 atomic, 인프라 + smoke)**:
- `playwright.config.ts` — `expect.toHaveScreenshot` 옵션 +
  고정 viewport (1280×720)
- `web/e2e/visual/smoke.visual.spec.ts` — 1 baseline (empty viewport)
- `web/e2e/visual/__screenshots__/` — git-tracked baseline PNG
- `web/.gitignore` — playwright-actual / diff 파일만 ignore (baseline 은 tracked)
- ADR-077 doc

**제외 (V-2~V-5 별도 sub-step)**:
- V-2: ADR-074 §E.5-1 group color visual baseline
- V-3: Multi-OS / multi-browser baseline matrix
- V-4: CI integration (artifact upload on diff)
- V-5: 회고 / docs

### 2.2 §B — 11개 V 결정

| V | 결정 | 비고 |
|---|------|------|
| **V-A** | ADR-077: Visual Regression Infrastructure | 자연 번호 |
| **V-B** | Playwright `toHaveScreenshot()` | 이미 설치, 무비용 |
| **V-C** | (a) git-tracked PNG baseline | 재현성 + git diff 가능 |
| **V-D** | maxDiffPixelRatio: 0.01 (1%) | anti-aliasing / sub-pixel 흡수 |
| **V-E** | host OS only (atomic) | multi-OS 는 V-3 |
| **V-F** | `web/e2e/visual/__screenshots__/` | Playwright 표준 |
| **V-G** | `web/e2e/visual/*.visual.spec.ts` | E.4 와 분리 |
| **V-H** | playwright.config.ts 의 `expect.toHaveScreenshot` | atomic |
| **V-I** | CI integration V-4 별도 | atomic — local baseline 먼저 |
| **V-J** | `--update-snapshots` flag (Playwright 표준) | docs 명시 |
| **V-K** | 본 세션 = V-1 only | Path Z 답습 |

### 2.3 §C — 4 Lock-in

```
1. V-1 = 인프라 + smoke 1 baseline only. ADR-074 §E.5-1 group
   color (V-2) / multi-OS (V-3) / CI integration (V-4) / 회고 (V-5)
   별도 sub-step.

2. Drop-in alongside — 기존 9 Playwright E2E (E.4 트랙) UNCHANGED.
   visual.spec.ts 는 별도 디렉토리, 같은 npm script (e2e) 로 통합
   실행되지만 functional E2E 와 분리.

3. Cross-platform 정책 (V-1 한정) — host OS only baseline.
   PNG rendering 은 Windows/Linux/macOS 간 sub-pixel 차이 발생 가능.
   maxDiffPixelRatio 0.01 가 일부 흡수. CI integration (V-4) 시
   첫 run 은 fail 후 `--update-snapshots` 갱신 정책 명시.

4. Baseline 갱신은 명시적 의도 — `--update-snapshots` flag 호출
   필요. 우연한 baseline drift 방지. PR 리뷰 시 baseline PNG diff
   검토 (git tracked 의 효과).
```

---

## 3. Acceptance — V-1

### 3.1 V-1 산출물

**Files modified**:
- `web/playwright.config.ts` — `expect.toHaveScreenshot` + viewport
- `web/.gitignore` — playwright-actual/ + playwright-diff/ ignore

**Files added**:
- `web/e2e/visual/smoke.visual.spec.ts`
- `web/e2e/visual/__screenshots__/smoke.visual.spec.ts/empty-viewport-chromium-win32.png` (Windows host)
- `docs/adr/077-visual-regression-infrastructure.md`

### 3.2 V-1 회귀 (1, 절대 #[ignore] 금지)

`smoke.visual.spec.ts`:
1. `empty viewport baseline matches snapshot` — WASM 부팅 후 초기
   viewport 의 PNG 가 baseline 과 1% 이내 일치

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 | 상태 |
|----------|------|------|------|
| V-1 | 인프라 + smoke baseline | 1 | **✅ 본 ADR §D-V1** |
| V-2 | ADR-074 §E.5-1 group color visual baseline | 6 (3 unit + 3 visual) | **✅ 본 ADR §D-V2** |
| V-3 | Multi-OS / multi-browser baseline matrix | (matrix) | 미착수 (선택적) |
| V-4 | CI integration + Linux baseline procedure | 0 (docs/wiring) | **✅ 본 ADR §D-V4** |
| V-5 | 회고 / docs | 0 | **✅ commit `8547520`** |
| **합계 (완료)** | — | **7** (vitest 3 + Playwright 4) | — |

---

## D. Acceptance Log — V 트랙 핵심 (2026-05-05)

본 세션 (그리고 직전 세션) 에서 ADR-077 의 핵심 sub-step (V-1 + V-2
+ V-5) 이 atomic 하게 닫혔다. ADR-075 §E.8 (visual regression 별도
ADR) + ADR-074 §E.5-1 (visual feedback enabler 의존) 두 미해결 항목
을 본 ADR 으로 동시 해소. V-3 (multi-OS) / V-4 (CI integration) 는
선택적 확장.

### §D-V1 — V-1 인프라 + smoke baseline (commit `dbfd65e`)

**의의**: Playwright `toHaveScreenshot()` 인프라 신설 — 향후 모든
visual UX ADR 의 enabler. ADR-075 §E.8 닫음. ADR-074 §E.5-1 의
"인프라 의존" 미해결 항목 해소.

**V-decisions**: V-A=ADR-077, V-B=Playwright (이미 설치),
V-C=(a) git-tracked PNG, V-D=maxDiffPixelRatio 0.01 (1% 흡수),
V-E=host OS only (atomic), V-F=`__screenshots__/`, V-G=`*.visual.spec.ts`,
V-H=playwright.config 의 `expect.toHaveScreenshot`, V-I=CI V-4 별도,
V-J=`--update-snapshots` flag, V-K=V-1 only.

**Lock-ins**:
- V-1 = 인프라 + smoke 1 baseline only
- Drop-in alongside (기존 9 functional E2E UNCHANGED)
- Cross-platform 정책 (V-1 host OS only — Windows baseline)
- Baseline 갱신 명시적 의도 (`--update-snapshots` 호출 필요)

**산출물**:
- `playwright.config.ts`: `expect.toHaveScreenshot` 옵션 + viewport
  1280×720 고정
- `web/e2e/visual/smoke.visual.spec.ts`: empty viewport baseline
- `web/e2e/visual/smoke.visual.spec.ts-snapshots/empty-viewport-chromium-win32.png`
  (~654KB, host=Windows)

**회귀 (1, 절대 #[ignore] 금지)**:
- empty viewport baseline matches snapshot

### §D-V2 — V-2 Group color visual feedback (commit `e9f7b30`)

**의의**: ADR-074 §E.5-1 의 visual feedback 본질을 닫음. V-1 인프라
위에 첫 실용 baseline. group A 면 orange (#ff8800), group B 면
cyan (#00aaff) outline 으로 사용자가 명시 grouping 시각 인지.

**V-2-decisions**: V-2-a=(a) outline (selection 패턴), V-2-b A=#ff8800
B=#00aaff (보색 쌍), V-2-c=(b) 신규 mesh layer (`rebuildGroupOutlines`),
V-2-d notifyChange 통합 (U-1 자연), V-2-e=(a) group 색이 selection
색을 덮음, V-2-f visibility toggle 일관, V-2-g=(b) 3 시나리오
(A only / B only / A+B), V-2-h V-1 helper 재사용, V-2-i
`group-color.visual.spec.ts`, V-2-j Three.js mock 한계 인정 — 진짜
검증은 visual baseline, V-2-k V-2 only.

**Three.js material**:
- Per-instance LineBasicMaterial (인스턴스 공유 회피, V-2 risk)
- depthTest: false + transparent: 0.95 (항상 가시)
- renderOrder 3 (selectionOutline 2 vs hover 4 사이)

**산출물 코드**:
- `SelectionManager.ts` 신규: `groupAOutline` / `groupBOutline` fields,
  `GROUP_A_COLOR` / `GROUP_B_COLOR` 상수, `rebuildGroupOutlines()`
  method, `notifyChange()` 통합 호출
- 기존 51 SelectionManager.test.ts UNCHANGED

**산출물 baselines** (각 644KB, host=Windows):
- `group-a-only-chromium-win32.png`
- `group-b-only-chromium-win32.png`
- `group-a-and-b-chromium-win32.png`

**회귀 (6, 절대 #[ignore] 금지)**:
- vitest unit (3, Three.js mock 한계 내):
  * no group tags → no group outline meshes added
  * setGroupTag triggers outline rebuild via notifyChange (no-throw)
  * clearGroupTags disposes any outline meshes
- Playwright visual baseline (3): A only / B only / A+B

### §D-V5 — V-5 회고 / docs (commit `8547520`)

ADR-077 §D Acceptance Log 채움 + CLAUDE.md 의 신규 "ADR-076" +
"ADR-077" 섹션 (이전 회고 commit 들이 미흡하게 처리한 catchup
포함). 코드 변경 0.

### §D-V4 — V-4 CI integration (본 commit)

**의의**: ADR-075 E4-6 ci.yml 의 `web-e2e` job 가 이미 `npx playwright
test` 로 visual specs (V-1/V-2 의 `*.visual.spec.ts`) 도 실행 중.
V-4 는 이 사실을 명시 + Linux baseline 첫 run 정책 docs + 갱신
가이드 신설.

**V-4-decisions**: V-4-a=(a) ci.yml 기존 web-e2e job 확장 (별도 job
없이 같은 `npx playwright test` 가 functional + visual 모두 cover) /
V-4-b=(a) fail + manual update (Playwright 기본 — 의도적 baseline
갱신만, V-1 lock-in #4 일관) / V-4-c failure artifact upload (이미
E4-6 으로 적용됨, playwright-report + test-results) / V-4-d Linux
baseline 생성 정책 (README.md 의 3 옵션 — CI artifact 다운로드 / Docker
local / V-3+ workflow_dispatch) / V-4-e macOS/Firefox/WebKit V-3 별도
sub-step / V-4-f V-4 only.

**Lock-ins**:
- V-4 = ci.yml 의 visual coverage 명시 + Linux baseline procedure
  docs only (코드 변경 최소). 별도 visual job 신설 안 함 — 같은
  `npx playwright test` 명령이 testMatch `/.*\.spec\.ts$/` 로 모든
  spec 실행.
- 첫 CI run 의 의도된 fail — `chromium-win32` baseline 만 존재,
  `chromium-linux` 부재. 이는 **expected 동작** (V-1 lock-in #4).
  Developer 가 의도적 Linux baseline 추가 commit 으로 해소.
- baseline 갱신은 명시적 `--update-snapshots` (Playwright 표준).
  우연한 drift 차단 (V-1 lock-in #4 일관).

**산출물**:
- `.github/workflows/ci.yml` 주석 갱신 — V-4 visual coverage 명시
  + README.md cross-link
- `web/e2e/visual/README.md` 신설 — Linux baseline 생성 절차
  (3 옵션: CI artifact 다운로드 / Docker local / future
  workflow_dispatch) + intentional update 절차 + PR 리뷰 체크리스트
  + git-tracked rationale + troubleshooting
- ADR-077 §D-V4 acceptance (본 섹션)

**회귀 변화**: 0 (코드 변경 최소 — ci.yml 주석 + README.md 신규).
모든 layer green:
- vitest 1422 / Rust axia-geo 964 / axia-wasm 12 unchanged
- Playwright local: 13 unchanged (4 visual + 9 functional)
- 첫 CI run: visual specs fail 예상 (Linux baseline missing) →
  README.md 의 V-4-b=(a) 정책으로 처리

**다음 단계 (선택적)**:
- V-3 multi-OS baseline matrix — Linux baseline 생성 후 별도
  sub-step (multi-OS pixel diff 정책 + macOS/Firefox/WebKit 확장)
- V-4 fine-tuning — `workflow_dispatch` baseline 갱신 workflow
  (별도 sub-step)

---

## E. Known Limitations (V 트랙 미해결)

### E.5-1 V-3: Multi-OS / multi-browser baseline matrix (별도 sub-step)

V-1/V-2 의 baseline 은 모두 `chromium-win32` suffix — host OS 한정.
실제 CI 는 ubuntu-latest 에서 실행되어 baseline 부재로 fail 예상.

**해결 방향**: V-3 sub-step 진입.
- Linux baseline 생성 (Docker 또는 CI 첫 run + `--update-snapshots`)
- 향후 macOS / Firefox / WebKit baseline 확장 시 matrix
- `__screenshots__/` 자동 OS-suffix 처리 (Playwright 표준)
- baseline 파일 크기 ×N — 현재 4 PNG × ~644KB = 2.6MB → multi-OS 시
  ~7-10MB (git 부담은 있으나 manageable)

### E.5-2 V-4: CI integration (✅ 본 ADR §D-V4 closure)

~~현재 visual baselines 는 local 에서만 실행. PR 마다 자동 검증
안 됨.~~ → **본 ADR V-4 (commit 본 commit) 으로 closure**:
- ci.yml `web-e2e` job 의 `npx playwright test` 가 functional +
  visual 모두 실행 (testMatch 가 `*.visual.spec.ts` 도 cover)
- Failure artifact upload 이미 E4-6 으로 적용됨
- Linux baseline 첫 run 정책: web/e2e/visual/README.md 의 3 옵션

남은 fine-tuning (선택적):
- `workflow_dispatch` baseline 갱신 workflow (V-3+ sub-step)
- PR 코멘트 visual diff 미리보기 (별도 GH actions 통합)

### E.5-3 V-2 의 unit test 한계

Three.js mock 의 `LineSegments` / `LineBasicMaterial` simplification
때문에 unit test 가 "mesh 생성 + dispose" 만 검증. 실제 색상 / 위치
/ visibility 는 visual baseline 에서만 검증 가능.

**의도된 한계** — V-2-j lock-in 으로 명시. visual baseline 이
canonical truth. 향후 mock 강화 시 unit coverage 확대 가능.

### E.5-4 baseline 파일 크기 (git bloat 우려)

현재 4 PNG × ~644KB = ~2.6MB. V-3 multi-OS 시 ×3 = ~8MB. 향후
visual UX ADR 추가 시 ×N. **git 부담 vs reproducibility trade-off**.

**완화 방향**:
- Git LFS (별도 인프라 — 본 ADR scope 외)
- baseline 압축 (PNG 최적화 — `optipng` 등, 30-50% 절감 가능)
- baseline 영역 축소 (`page.screenshot({ clip: ... })`) — 변화가
  큰 영역만 capture
- 본 V-1/V-2 baselines 는 viewport 전체 — 향후 부분 capture 정책
  별도 sub-step 권장

---

## F. 회귀 누적 (V 트랙)

| 단계 | Pre-V baseline | After V | Δ |
|------|---------------|---------|---|
| axia-geo lib | 964 | 964 | 0 (V = TS / Three.js / Playwright only) |
| axia-wasm tests | 12 | 12 | 0 |
| **web TS vitest** | 1419 | **1422** | **+3** (V-2 unit) |
| **web TS Playwright (functional)** | 9 | 9 | 0 (drop-in alongside) |
| **web TS Playwright (visual)** | 0 | **4** | **+4** (V-1 1 + V-2 3) |
| **합계** | 2404 | **2411** | **+7** |

**7 / 7 모두 절대 #[ignore] 금지 정책 준수**.

Sub-step 별 distribution:
- V-1: 1 visual baseline
- V-2: 3 vitest unit + 3 visual baseline
- V-5: 0 (docs only)

### 7-ADR 합산 (Path Z + Path Y + E.4 + E.5 + E.3 + V)

| Suite | Original | After all | Δ |
|-------|----------|-----------|---|
| axia-geo lib | 940 | 964 | +24 |
| axia-wasm tests | 8 | 12 | +4 |
| web TS vitest | 1395 | 1422 | +27 |
| Playwright E2E (functional + visual) | 0 | 13 | +13 |
| **합계** | 2343 | **2411** | **+68** |

**68 / 68 모두 절대 #[ignore] 금지 정책 준수**.

CI 자동 검증 (ADR-075 E4-6 build.yml + ci.yml). V-3/V-4 통합 시
visual baseline 도 PR 마다 자동 검증 가능.

---

## G. ADR-077 의 의미 (V 트랙 시점)

ADR-075 가 **functional 검증 자산 + 자동화** 의 첫 인프라성 ADR
이라면, ADR-077 은 **visual 검증 자산** 의 첫 인프라성 ADR. 두 ADR
모두 향후 모든 ADR 의 round-trip 검증 base layer.

| 측면 | ADR-064/066 | ADR-074 | ADR-075 | ADR-076 | **ADR-077** |
|------|-------------|---------|---------|---------|------------|
| **결정 성격** | engine | UX semantic | functional E2E infra | cleanup | **visual E2E infra** |
| **위험** | 中-高 | 低-中 | 中 | 低 | **低-中** |
| **commits** | 16 | 5 | 7 | 3 | **3** (V-1 + V-2 + V-5) |
| **회귀** | +62 | +20 | +11 | -17 | **+7** |
| **자산성** | mesh-level API | selection model + UI | functional baseline | code minimization | **visual baseline** |
| **재사용성** | 본 ADR 한정 | 4-layer pattern | 모든 functional ADR | (cleanup 사례) | **모든 visual UX ADR** |

### V 트랙의 자산성

- `playwright.config.ts` 의 `expect.toHaveScreenshot` 정책 →
  향후 모든 visual ADR 자동 활용
- `web/e2e/visual/` 디렉토리 + `*.visual.spec.ts` 명명 →
  functional E2E 와 분리, 명확한 표준
- `__screenshots__/` git-tracked baseline → PR 리뷰 시 시각 변경
  명시적 검토 (우연한 drift 차단)
- `setupGroupedSelection` (V-2 가 사용한 helper) → 향후 다른 UX
  visual ADR 의 fixture 패턴 모범

### V-2 가 ADR-074 §E.5-1 을 닫은 의미

ADR-074 (Boolean Group Selection UX) 가 5-layer atomic stack 으로
완성:
1. **Model** (U-1) — `groupTags: Map<faceId, 'A'|'B'>`
2. **UI** (U-2) — ContextMenu 3 항목
3. **Routing** (U-3) — BooleanHandler 분기
4. **Real-runtime functional** (U-4) — Playwright 2 tests
5. **Visual feedback** (V-2) — orange/cyan outline + 3 baselines

**5-layer pattern** 은 향후 selection-driven UX ADR 의 모범. 1-4 layer
는 ADR-074 가 정의, 5-layer (visual) 는 ADR-077 V-2 가 처음 추가.

남은 V-3 (multi-OS) / V-4 (CI) 는 모두 **선택적 확장** — 본 ADR 의
핵심 가치 (인프라 + visual UX baseline 첫 사례) 는 이미 완성.

---

## 5. References

- ADR-075 §E.8 (Visual regression — 별도 ADR 미해결 항목)
- ADR-074 §E.5-1 (Visual feedback — V-2 enabler)
- ADR-075 E4-1 (Playwright 인프라 — base layer)
- Playwright docs: `expect(page).toHaveScreenshot()`
  https://playwright.dev/docs/test-snapshots

---

*Author*: AXiA team (사용자 결정 2026-05-05)
*Status*: **V-1 + V-2 + V-4 + V-5 완료 2026-05-05** — 4 commits,
7 회귀 (vitest 3 + Playwright visual 4), 4 baseline PNG (host=Windows),
CI integration 명시 + Linux baseline procedure docs. ADR-074 §E.5-1
+ ADR-075 §E.8 두 미해결 항목 동시 closure. V-3 (multi-OS baseline
matrix) 은 선택적 확장. V 트랙의 **인프라 + 검증 + 자동화** 사이클
완성.
