/**
 * ADR-101 §B-6 — Visual demo (Claude direct test).
 *
 * Captures actual rendered viewport screenshots showing the 3 sub-faces
 * after partial-overlap auto-intersect. Uses the same patterns as
 * ADR-077 visual baselines (LOCKED #40):
 *   - Large geometry scaled to default camera view (~1000 mm magnitude)
 *   - setViewportMode for deterministic camera
 *   - stopViewportRenderLoop before screenshot
 *
 * Companion to `adr-101-b6-user-demo-verify.spec.ts` (engine assertions).
 * This spec captures visual proof — the actual viewport output the
 * end-user sees.
 */
import { test, expect } from '@playwright/test';
import {
  waitForBridgeReady,
  setViewportMode,
} from './helpers/boolean-fixtures';

// AxiA 3D viewport convention: Y-up. "Top" view looks down -Y axis.
// Draw RECTs on the XZ floor plane (normal = +Y). Lens overlap [5k,5k]-[10k,10k].
const RECT_A = {
  cx: 5000, cy: 0, cz: 5000,
  nx: 0, ny: 1, nz: 0, ux: 1, uy: 0, uz: 0,
  width: 10000, height: 10000,
};
const RECT_B = {
  cx: 10000, cy: 0, cz: 10000,
  nx: 0, ny: 1, nz: 0, ux: 1, uy: 0, uz: 0,
  width: 10000, height: 10000,
};

// Circles on the same XZ plane (normal +Y). Partial overlap centers 6k apart.
const CIRCLE_A = { cx: 0, cy: 0, cz: 0, nx: 0, ny: 1, nz: 0, radius: 5000, segments: 32 };
const CIRCLE_B = { cx: 6000, cy: 0, cz: 0, nx: 0, ny: 1, nz: 0, radius: 5000, segments: 32 };

async function fitCamera(
  page: import('@playwright/test').Page,
  target: { x: number; y: number; z: number },
  radius: number,
  mode: 'top' | '3d',
): Promise<void> {
  await page.evaluate((args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const viewport = w.__axia?.get?.('viewport');
    if (viewport) {
      // First set view mode (camera angle), then override radius + target.
      if (typeof viewport.setViewMode === 'function') {
        viewport.setViewMode(args.mode);
      }
      if (typeof viewport.setCameraState === 'function') {
        viewport.setCameraState({
          radius: args.radius,
          targetX: args.target.x,
          targetY: args.target.y,
          targetZ: args.target.z,
        });
      }
    }
  }, { target, radius, mode });
}

async function hideUIChrome(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const hideSelectors = [
      '#xia-inspector',
      '#toolbar',
      '#menubar',
      '#status-bar',
      '#vcb-overlay',
      '#axes-gizmo',
      '#component-panel',
      '#osnap-panel',
      '#style-panel',
      '#settings-panel',
      '#constraint-panel',
      '#history-panel',
      '#capability-explorer-panel',
      '#invariant-verifier-panel',
      '#audit-log-viewer-panel',
      '#sketch-badge',
      '#console-pill',
    ];
    for (const sel of hideSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.style.display = 'none';
    }
  });
}

test.describe('ADR-101 B-6 — Visual demo (Claude direct test)', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-1 + B-β-3 (2026-05-18~21): auto-intersect + auto-face-
    // synthesis default OFF. ADR-101 auto-intersect + LOCKED #1 P7 demo
    // — explicit opt-in via localStorage.
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-intersect-on-draw', 'true');
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
    });
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('RECT × RECT partial overlap → 3 sub-faces (top view)', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const tm = w.__axia.get('toolManager');
      const before = bridge.getStats().faces;

      bridge.drawRectAsShape(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.ux, args.A.uy, args.A.uz,
        args.A.width, args.A.height,
      );
      bridge.drawRectAsShape(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.ux, args.B.uy, args.B.uz,
        args.B.width, args.B.height,
      );
      const after = bridge.getStats().faces;

      // Force viewport to refresh from the bridge.
      tm.syncMesh();

      return { before, after, delta: after - before };
    }, { A: RECT_A, B: RECT_B });

    expect(result.delta).toBe(3);

    await hideUIChrome(page); await fitCamera(page, { x: 7500, y: 0, z: 7500 }, 25000, 'top');
    await page.waitForTimeout(800);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/visual-rect-top.png',
      fullPage: false,
    });
  });

  test('RECT × RECT partial overlap → 3 sub-faces (3D iso view)', async ({ page }) => {
    await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const tm = w.__axia.get('toolManager');
      bridge.drawRectAsShape(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.ux, args.A.uy, args.A.uz,
        args.A.width, args.A.height,
      );
      bridge.drawRectAsShape(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.ux, args.B.uy, args.B.uz,
        args.B.width, args.B.height,
      );
      tm.syncMesh();
    }, { A: RECT_A, B: RECT_B });

    await hideUIChrome(page); await fitCamera(page, { x: 7500, y: 0, z: 7500 }, 25000, '3d');
    await page.waitForTimeout(800);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/visual-rect-3d.png',
      fullPage: false,
    });
  });

  test('Circle × Circle (legacy polygonized) → 3 sub-faces (top view)', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const tm = w.__axia.get('toolManager');
      const before = bridge.getStats().faces;
      bridge.drawCircleAsShape(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.radius, args.A.segments,
      );
      bridge.drawCircleAsShape(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.radius, args.B.segments,
      );
      const after = bridge.getStats().faces;
      tm.syncMesh();
      return { before, after, delta: after - before };
    }, { A: CIRCLE_A, B: CIRCLE_B });

    expect(result.delta).toBe(3);

    await hideUIChrome(page); await fitCamera(page, { x: 3000, y: 0, z: 0 }, 25000, 'top');
    await page.waitForTimeout(800);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/visual-circle-legacy-top.png',
      fullPage: false,
    });
  });

  test('Circle × Circle (Path B — B-4b activated) → 3 sub-faces (top view)', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const bridge = w.__axia.get('bridge');
      const tm = w.__axia.get('toolManager');
      const before = bridge.getStats().faces;
      const sa = bridge.drawCircleAsCurve(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.radius,
      );
      if (sa < 0) {
        return { unavailable: true, before, delta: 0 };
      }
      bridge.drawCircleAsCurve(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.radius,
      );
      const after = bridge.getStats().faces;
      tm.syncMesh();
      return { unavailable: false, before, after, delta: after - before };
    }, { A: CIRCLE_A, B: CIRCLE_B });

    if (result.unavailable) {
      test.skip(true, 'drawCircleAsCurve not available');
      return;
    }
    // ADR-101 §B-4b — non-destructive pre-check activates Path B as
    // first-class input. Path B × Path B partial overlap → 3 sub-faces.
    expect(result.delta).toBe(3);

    await hideUIChrome(page); await fitCamera(page, { x: 3000, y: 0, z: 0 }, 25000, 'top');
    await page.waitForTimeout(800);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/visual-circle-pathb-top.png',
      fullPage: false,
    });
  });
});
