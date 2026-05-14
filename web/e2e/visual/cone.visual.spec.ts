/**
 * Visual regression baseline for cone primitive rendering.
 *
 * Companion to cylinder.visual.spec.ts (PR #22) and
 * sphere.visual.spec.ts (this PR). The cone exercises:
 *
 *   - Analytic `AnalyticSurface::Cone` tessellation (slant surface).
 *   - One rim circle at the base (top of cone is the apex vertex,
 *     not a rim) — chord_tol behaviour identical to Cylinder's
 *     bottom rim, so the close-up scenario gives the same maximum-
 *     sensitivity check the cylinder-top-rim baseline provides.
 *
 * Two scenarios:
 *
 *   1. **"default 3D iso view"** — overall cone shape + slant
 *      surface shading. Catches general Gouraud / chord_tol drift.
 *
 *   2. **"bottom rim top view"** — `setViewportMode('top')` looks
 *      straight down, the cone is rendered as the bottom disc with
 *      the apex projected as a single point. The rim chord polygon
 *      fills most of the frame → maximum chord_tol sensitivity
 *      (PR #22 cylinder-top-rim pattern).
 *
 * LOCKED #40 lock-ins re-applied (see sphere.visual.spec.ts header).
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setupCone,
  setViewportMode,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-14 SKIP — baselines not yet generated. Re-enable after the
// `Update Visual Baselines (Linux)` workflow_dispatch run produces
// the `cone-*-chromium-linux.png` artifacts.
test.describe('LOCKED #40 — Cone primitive visual contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Cone — default 3D iso view', async ({ page }) => {
    await setupCone(page, { radius: 1000, height: 2000, segments: 32 });
    await setViewportMode(page, '3d');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('cone-default-3d.png');
  });

  test('Cone — bottom rim top view', async ({ page }) => {
    await setupCone(page, { radius: 1000, height: 2000, segments: 32 });
    await setViewportMode(page, 'top');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('cone-bottom-rim.png');
  });
});
