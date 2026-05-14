/**
 * Visual regression baseline for sphere surface rendering.
 *
 * Companion to cylinder.visual.spec.ts (PR #22). The sphere primitive
 * exercises the analytic `AnalyticSurface::Sphere` tessellation path
 * — uv-slice + per-vertex analytic normal (ADR-038 P23.5) — that
 * delivers smooth Gouraud-shaded curved surfaces. Any regression of:
 *
 *   - `ANALYTIC_CHORD_TOL` (LOCKED #40 — currently 0.02)
 *   - `SurfaceOps::tessellate` for Sphere
 *   - Surface-aware normal evaluation
 *   - The default camera state
 *
 * would shift pixels on the curved silhouette and fail this baseline.
 *
 * One scenario for this PR — sphere has no rim edges, so the
 * cylinder-rim-hover analogue doesn't apply. A close-up zoom is
 * deferred to a future PR (would require a viewport zoom hook the
 * test layer does not currently expose).
 *
 * LOCKED #40 lock-ins re-applied:
 *   L1 stopViewportRenderLoop before snapshot (ADR-077 V-3)
 *   L2 deterministic camera via setViewportMode
 *   L3 1% maxDiffPixelRatio inherited from playwright.config
 *   L4 Linux baseline only — V-3 multi-OS deferred
 *   L6 initial `test.describe.skip` until baselines are committed
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setupSphere,
  setViewportMode,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-14 SKIP — baselines not yet generated. Re-enable after the
// `Update Visual Baselines (Linux)` workflow_dispatch run produces
// `sphere-default-3d-chromium-linux.png` and it is committed in the
// follow-up step of this same PR.
test.describe('LOCKED #40 — Sphere surface tessellation visual contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Sphere — default 3D iso view', async ({ page }) => {
    await setupSphere(page, { radius: 1000, uSegments: 32, vSegments: 16 });
    await setViewportMode(page, '3d');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('sphere-default-3d.png');
  });
});
