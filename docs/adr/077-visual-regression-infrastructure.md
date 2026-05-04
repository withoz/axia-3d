# ADR-077 — Visual Regression Infrastructure

**Status**: V-1 진입 (Path Z atomic, 사용자 결정 2026-05-05)
**Date**: 2026-05-05
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

| Sub-step | 영역 | 회귀 (예상) |
|----------|------|------------|
| V-1 | 인프라 + smoke baseline | 1 |
| V-2 | ADR-074 §E.5-1 group color visual baseline | 2-3 |
| V-3 | Multi-OS / multi-browser baseline matrix | 0 (matrix) |
| V-4 | CI integration (artifact upload on diff) | 0 |
| V-5 | 회고 / docs | 0 |
| **합계 (예상)** | — | **~3-4** |

---

## 5. References

- ADR-075 §E.8 (Visual regression — 별도 ADR 미해결 항목)
- ADR-074 §E.5-1 (Visual feedback — V-2 enabler)
- ADR-075 E4-1 (Playwright 인프라 — base layer)
- Playwright docs: `expect(page).toHaveScreenshot()`
  https://playwright.dev/docs/test-snapshots

---

*Author*: AXiA team (사용자 결정 2026-05-05)
*Status*: V-1 implementation 진행 중
