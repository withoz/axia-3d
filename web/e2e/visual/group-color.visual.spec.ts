/**
 * ADR-077 V-2 — Group A/B color outline visual baselines.
 *
 * Real-runtime visual verification of ADR-074 §E.5-1 group color
 * feedback. Establishes 3 baselines covering the user-facing
 * grouping states:
 *   1. Group A only (orange outline)
 *   2. Group B only (cyan outline)
 *   3. Group A + B (both outlines)
 *
 * Per ADR-077 V-2 lock-ins:
 * - V-2-b colors: A=#ff8800 (orange), B=#00aaff (cyan)
 * - V-2-c implementation: separate outline mesh layer (renderOrder 3)
 * - V-2-g 3 scenarios for branch coverage
 * - V-2-i naming: group-color.visual.spec.ts
 *
 * Visual diff is the canonical V-2 verification (Three.js mock unit
 * tests cover only API contract, not rendered pixels).
 */
import { test, expect } from '@playwright/test';
import {
  setupNPlaneFaces,
  setupGroupedSelection,
  waitForBridgeReady,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-12 RE-ENABLED — Linux baselines for all 3 scenarios
// (`group-a-only`, `group-b-only`, `group-a-and-b` × `-chromium-linux.png`)
// committed via `Update Visual Baselines (Linux)` workflow run #2 (artifact
// `visual-baselines-linux`). Generation requires `viewport.stop()` before
// `toHaveScreenshot` to halt Three.js rAF (see fix/visual-baseline-render-stop,
// merged PR #11). V-3 multi-OS matrix (macOS/Windows baselines) remains a
// follow-up; trigger `Update Visual Baselines (Linux)` workflow on demand
// to regenerate when ADR-074 group color visuals change.
test.describe('ADR-077 V-2 — Group A/B color outline visuals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Group A only — orange outline visible', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });
    await setupGroupedSelection(page, {
      faces,
      groupA: [faces[0], faces[1]],
      groupB: [],
    });
    await page.waitForTimeout(500);  // rendering 안정화 (V-1 패턴)
    // ADR-077 V-3 — see smoke.visual.spec.ts for rationale.
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('group-a-only.png');
  });

  test('Group B only — cyan outline visible', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });
    await setupGroupedSelection(page, {
      faces,
      groupA: [],
      groupB: [faces[2], faces[3]],
    });
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('group-b-only.png');
  });

  test('Group A + B — both outlines visible', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });
    await setupGroupedSelection(page, {
      faces,
      groupA: [faces[0], faces[1]],
      groupB: [faces[2], faces[3]],
    });
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('group-a-and-b.png');
  });
});
