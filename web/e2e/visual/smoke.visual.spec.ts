/**
 * ADR-077 V-1 — Visual regression smoke baseline.
 *
 * Establishes the Playwright `toHaveScreenshot()` infrastructure
 * with one baseline: the empty viewport after WASM boot.
 *
 * Per ADR-077 §B lock-ins:
 * - V-D maxDiffPixelRatio: 0.01 (1% — set in playwright.config.ts)
 * - V-E host OS only baseline (atomic; multi-OS = V-3)
 * - V-F `__screenshots__/` co-located (Playwright default)
 * - V-G `.visual.spec.ts` naming (E.4 functional E2E 와 분리)
 *
 * **Baseline 갱신 정책 (V-J)**:
 *   첫 run: `npx playwright test --update-snapshots` 로 baseline 생성.
 *   변경 시: 의도적 갱신만 — 우연한 drift 차단 (V-1 lock-in #4).
 *   PR 리뷰: baseline PNG 의 git diff 검토 필수.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from '../helpers/boolean-fixtures';

// 2026-05-11 SKIP — Linux baseline (chromium-linux.png) not committed.
// See group-color.visual.spec.ts comment for rationale. Re-enable
// after V-3 multi-OS baseline workflow (ADR-077 follow-up).
test.describe.skip('ADR-077 V-1 — Visual regression smoke', () => {
  test('empty viewport baseline matches snapshot', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
    // WASM 부팅 후 Three.js 첫 frame rendering 안정화 대기.
    // 500ms 는 경험적 — too short 시 partial render, too long 시 CI 시간 낭비.
    await page.waitForTimeout(500);

    // Per V-D: 1% pixel ratio threshold (config 에 설정됨).
    // 첫 run 시 baseline 자동 생성 (--update-snapshots).
    await expect(page).toHaveScreenshot('empty-viewport.png');
  });
});
