/**
 * ADR-101 §B-6 — User demo verification (Claude direct test).
 *
 * Simulates the user-facing trigger from ADR-101 §2:
 *   "사용자가 두 원 (또는 두 사각형) 을 partial overlap 으로 그렸을 때
 *    자동으로 3 sub-face 로 분할되어야 한다."
 *
 * Three scenarios:
 *   1. RECT × RECT partial overlap → 3 sub-faces (canonical user trigger)
 *   2. drawCircleAsShape × 2 partial overlap → 3 sub-faces
 *   3. drawCircleAsCurve × 2 (Path B) → auto-split 3 sub-faces
 *      (B-4b non-destructive pre-check activates Path B at first-class)
 *
 * NOTE: Playwright uses `npm run preview` (production build) per
 * `playwright.config.ts`. Re-build prod bundle (`npm run build`) AFTER
 * WASM rebuild for tests to pick up the latest engine.
 */
import { test, expect } from '@playwright/test';

const RECT_A = { cx: 5, cy: 5, cz: 0, nx: 0, ny: 0, nz: 1, ux: 1, uy: 0, uz: 0, width: 10, height: 10 };
const RECT_B = { cx: 10, cy: 10, cz: 0, nx: 0, ny: 0, nz: 1, ux: 1, uy: 0, uz: 0, width: 10, height: 10 };

const CIRCLE_A = { cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 1, radius: 5, segments: 32 };
const CIRCLE_B = { cx: 6, cy: 0, cz: 0, nx: 0, ny: 0, nz: 1, radius: 5, segments: 32 };

test.describe('ADR-101 B-6 — User demo verification', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-1 + B-β-3 (2026-05-18~21): auto-intersect + auto-face-
    // synthesis default OFF. ADR-101 + LOCKED #1 P7 verification —
    // explicit opt-in via localStorage.
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-intersect-on-draw', 'true');
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
    });
    await page.goto('/');
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (window as any).__axia;
      return w && typeof w.get === 'function' && w.get('bridge');
    }, { timeout: 30000 });
  });

  test('Scenario 1: RECT × RECT partial overlap → 3 sub-faces', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawRectAsShape(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.ux, args.A.uy, args.A.uz,
        args.A.width, args.A.height,
      );
      const afterA = bridge.getStats().faces;
      bridge.drawRectAsShape(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.ux, args.B.uy, args.B.uz,
        args.B.width, args.B.height,
      );
      const afterB = bridge.getStats().faces;
      return { before, deltaA: afterA - before, deltaB: afterB - before };
    }, { A: RECT_A, B: RECT_B });
    expect(result.deltaA).toBe(1);
    expect(result.deltaB).toBe(3);

    // Trigger viewport sync so the screenshot shows the geometry.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = (window as any).__axia.get('toolManager');
      tm?.syncMesh?.();
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/scenario1-rect-x-rect.png',
      fullPage: false,
    });
  });

  test('Scenario 2: drawCircleAsShape × 2 partial overlap → 3 sub-faces', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawCircleAsShape(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.radius, args.A.segments,
      );
      const afterA = bridge.getStats().faces;
      bridge.drawCircleAsShape(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.radius, args.B.segments,
      );
      const afterB = bridge.getStats().faces;
      return { before, deltaA: afterA - before, deltaB: afterB - before };
    }, { A: CIRCLE_A, B: CIRCLE_B });
    expect(result.deltaA).toBe(1);
    expect(result.deltaB).toBe(3);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = (window as any).__axia.get('toolManager');
      tm?.syncMesh?.();
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'e2e/adr-101-b6-screenshots/scenario2-circle-x-circle.png',
      fullPage: false,
    });
  });

  test('Scenario 3: drawCircleAsCurve × 2 (Path B) → 3 sub-faces (B-4b)', async ({ page }) => {
    const result = await page.evaluate((args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      const shapeA = bridge.drawCircleAsCurve(
        args.A.cx, args.A.cy, args.A.cz,
        args.A.nx, args.A.ny, args.A.nz,
        args.A.radius,
      );
      if (shapeA < 0) {
        return { unavailable: true, before, shapeA };
      }
      bridge.drawCircleAsCurve(
        args.B.cx, args.B.cy, args.B.cz,
        args.B.nx, args.B.ny, args.B.nz,
        args.B.radius,
      );
      const afterB = bridge.getStats().faces;
      return { unavailable: false, before, deltaB: afterB - before };
    }, { A: CIRCLE_A, B: CIRCLE_B });

    if (result.unavailable) {
      test.skip(true, 'drawCircleAsCurve unavailable in this build');
      return;
    }
    // ADR-101 §B-4b — non-destructive pre-check activates Path B circles
    // as first-class inputs. Partial overlap → auto 3 sub-faces.
    expect(result.deltaB).toBe(3);
  });
});
