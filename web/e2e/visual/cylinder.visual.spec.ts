/**
 * Visual regression baselines for cylinder rendering quality.
 *
 * These specs are the *direct* CI guard that would have caught the
 * PR #14 chord_tol regression (mesh.rs `ANALYTIC_CHORD_TOL` shipped at
 * 0.1 while the source had moved to 0.02 → cylinder rim showed visible
 * polygon facets at the rim edge). The existing visual baselines
 * (group-color, smoke) only exercise planar geometry; chord_tol
 * changes are invisible to them.
 *
 * Two scenarios cover the regression surface:
 *
 *   1. **Default 3D iso view** — the perspective camera state that
 *      ships with a fresh viewport. Captures overall cylinder rim
 *      smoothness, side surface shading, and Path B annulus topology.
 *
 *   2. **Top view rim close-up** — `viewport.setViewMode('top')` so
 *      the rim chord polygon fills the most screen space. Maximum
 *      sensitivity to per-segment chord_tol differences.
 *
 * Both use the ADR-089 Path B kernel-native cylinder flow
 * (`drawCircleAsCurve` → `createSolidExtrude`) which is the production
 * default per ADR-094 B-η.
 *
 * Per LOCKED #40 + ADR-077 V-3:
 *   - L1: `stopViewportRenderLoop` before `toHaveScreenshot` (rAF
 *         stability — ADR-077 V-3 pattern)
 *   - L2: deterministic camera via `setViewportMode` (no reliance on
 *         default orbital state)
 *   - L3: 1% pixel ratio threshold inherited from playwright.config.ts
 *   - L4: Linux baseline only — V-3 multi-OS deferred
 *   - L6: initial `test.describe.skip` until baselines are committed
 *         (V-3 pattern — workflow_dispatch generates baselines on demand)
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setupCylinder,
  setViewportMode,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-14 SKIP — Linux baselines not yet generated. Re-enable after
// the `Update Visual Baselines (Linux)` workflow_dispatch run produces
// the `*-chromium-linux.png` artifacts and they are committed in the
// follow-up step of this same PR. See web/e2e/visual/README.md for the
// canonical procedure.
test.describe('LOCKED #40 — Cylinder rim chord_tol visual contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Path B cylinder — default 3D iso view', async ({ page }) => {
    await setupCylinder(page, { radius: 1000, height: 2000 });
    // Default '3d' perspective view. Explicit setViewportMode call so
    // this remains reproducible if Viewport's initial state ever
    // changes — `'3d'` re-applies the orbital camera state.
    await setViewportMode(page, '3d');
    await page.waitForTimeout(500); // initial render stabilization
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('cylinder-default-3d.png');
  });

  test('Path B cylinder — top view rim close-up', async ({ page }) => {
    await setupCylinder(page, { radius: 1000, height: 2000 });
    // Top view = look straight down the Z axis → top rim fills the
    // frame. This is the maximum-sensitivity view for chord_tol
    // regressions because each rim chord is rendered as a screen-space
    // line ~3-5 pixels long; a chord_tol change (0.02 → 0.1) would
    // halve the segment count and visibly affect the rim polygon's
    // perimeter.
    await setViewportMode(page, 'top');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('cylinder-top-rim.png');
  });
});
