/**
 * Visual regression baseline for torus primitive rendering.
 *
 * Companion to cylinder/sphere/cone visual specs — completes the
 * LOCKED #40 4-primitive matrix (Cylinder / Sphere / Cone / **Torus**).
 *
 * The torus exercises:
 *
 *   - Analytic `AnalyticSurface::Torus` tessellation (no pole
 *     singularity, both u and v periodic — genus-1 closed manifold).
 *   - Per-vertex analytic normal (ADR-038 P23.5) — both major-ring
 *     and tube-ring curvature must shade smoothly under Gouraud.
 *   - Smooth-group edge hiding (LOCKED #40 L7 A-τ pattern) —
 *     adjacent Torus surface quads should NOT show wireframe
 *     edges between them, only the silhouette is visible.
 *
 * Three scenarios:
 *
 *   1. **"default 3D iso view"** — overall donut shape + smooth
 *      shading + analytic silhouette. Catches general Gouraud /
 *      chord_tol drift on either ring.
 *
 *   2. **"top view"** — `setViewportMode('top')` looks straight
 *      down the symmetry axis, the donut appears as a flat annulus
 *      (major-ring + tube-ring projected onto XZ plane).
 *
 *   3. **"front view"** — `setViewportMode('front')` shows the
 *      tube cross-section silhouette (two circles tangent — outer
 *      at R+r, inner at R-r) — maximum tube-ring chord sensitivity.
 *
 * LOCKED #40 lock-ins re-applied (see sphere.visual.spec.ts header):
 *   L1 stopViewportRenderLoop before snapshot (ADR-077 V-3)
 *   L2 deterministic camera via setViewportMode
 *   L3 1% maxDiffPixelRatio inherited from playwright.config
 *   L4 Linux baseline only — V-3 multi-OS deferred
 *   L6 initial `test.describe.skip` until baselines are committed
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setupTorus,
  setViewportMode,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-15 SKIP — baselines not yet generated. Re-enable after the
// `Update Visual Baselines (Linux)` workflow_dispatch run produces
// `torus-*-chromium-linux.png` artifacts.
test.describe('LOCKED #40 — Torus primitive visual contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Torus — default 3D iso view', async ({ page }) => {
    await setupTorus(page, { majorRadius: 1000, minorRadius: 250, uSegments: 32, vSegments: 16 });
    await setViewportMode(page, '3d');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('torus-default-3d.png');
  });

  test('Torus — top view (annulus)', async ({ page }) => {
    await setupTorus(page, { majorRadius: 1000, minorRadius: 250, uSegments: 32, vSegments: 16 });
    await setViewportMode(page, 'top');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('torus-top-annulus.png');
  });

  test('Torus — front view (cross-section silhouette)', async ({ page }) => {
    await setupTorus(page, { majorRadius: 1000, minorRadius: 250, uSegments: 32, vSegments: 16 });
    await setViewportMode(page, 'front');
    await page.waitForTimeout(500);
    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('torus-front-cross-section.png');
  });
});
