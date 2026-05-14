/**
 * Visual regression baseline for hover interaction on multi-segment edges.
 *
 * Direct CI guard for the PR #14 hover-unification regression
 * (commit c62bbfd). Before the fix, hovering over a closed-curve
 * (Path B self-loop) cylinder rim highlighted only the single segment
 * under the cursor — breaking the "logical curve = 1 entity" contract
 * from LOCKED #15 (ADR-037 P22.5). After the fix, the entire rim
 * (all N rendered segments mapping to one EdgeId) is highlighted in
 * `HOVER_COLOR` (`SelectionManager.HOVER_COLOR`).
 *
 * This spec captures the hover state as a pixel baseline. If the
 * hover-unification logic regresses, the screenshot diff will show
 * the highlight changing from a full ring to a single short segment.
 *
 * Per LOCKED #40 + ADR-077 V-3:
 *   - L1: `stopViewportRenderLoop` before screenshot
 *   - L2: deterministic camera (`setViewportMode('top')`)
 *   - L3: 1% pixel ratio threshold (playwright.config)
 *   - L4: Linux baseline only — V-3 multi-OS deferred
 *   - L6: initial `test.describe.skip` until baselines are committed
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setupCylinder,
  setViewportMode,
  hoverOverEdge,
  stopViewportRenderLoop,
} from '../helpers/boolean-fixtures';

// 2026-05-14 SKIP — see cylinder.visual.spec.ts for the re-enable
// procedure (Update Visual Baselines Linux workflow_dispatch).
test.describe('LOCKED #40 — Multi-segment edge hover unification visual contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('Path B cylinder top rim hover — entire ring highlighted', async ({ page }) => {
    const cyl = await setupCylinder(page, { radius: 1000, height: 2000 });
    // Top view → rim fills the frame, hover ring is unambiguously
    // visible across the top circle.
    await setViewportMode(page, 'top');
    await page.waitForTimeout(500);

    // Hover over the top rim edge. The helper computes a representative
    // screen-space midpoint of the edge's first rendered segment and
    // moves the mouse there, then waits ~50ms for the hover state to
    // propagate (mousemove → pickEdgeOrFace → setEdgeHoverGroup →
    // rebuildEdgeHoverLine, per ToolManagerRefactored.ts).
    const hovered = await hoverOverEdge(page, cyl.topRimEdgeId);
    expect(hovered, 'Hover screen position should resolve').not.toBeNull();

    await stopViewportRenderLoop(page);
    await expect(page).toHaveScreenshot('cylinder-rim-hover.png');
  });
});
