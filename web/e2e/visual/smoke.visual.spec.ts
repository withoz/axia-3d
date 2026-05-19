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

test.describe('ADR-077 V-1 — Visual regression smoke', () => {
  // ADR-102 R-θ-skip — Linux baseline 생성이 Three.js render-loop
  // stability 문제로 차단 (PR-111/112 update-visual-baselines workflow
  // 결과 audit). 별도 트랙 (ADR-103 가칭 Three.js stability hook) 결재
  // 시까지 Linux 만 skip. Windows / macOS host 는 baseline 존재 시 정상.
  test.skip(
    process.platform === 'linux',
    'ADR-102 R-θ — Linux baseline pending (ADR-103 Three.js stability)',
  );

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
