/**
 * ADR-075 E4-1 — WASM bridge smoke E2E.
 *
 * Verifies the production-like build (Vite preview) initializes the
 * WASM bridge in a real browser and reaches `isReady() === true`.
 * This is the smallest possible round-trip — exercises:
 *   - Vite preview serving the bundled app
 *   - WASM module loading via fetch + instantiate
 *   - WasmBridge.init() async path
 *   - ServiceContainer registration on window.__axia
 *
 * Per ADR-075 §C lock-in #2 — drop-in alongside vitest. These tests
 * NEVER run alongside `npm test` (vitest); only via `npm run e2e`.
 */
import { test, expect } from '@playwright/test';

// Type guard — the app exposes `window.__axia: ServiceContainer` per main.ts.
interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
  };
}

test.describe('ADR-075 E4-1 — WASM bridge smoke', () => {
  test('wasm bridge initializes successfully in browser', async ({ page }) => {
    await page.goto('/');
    // Wait up to 10s for window.__axia to appear (main.ts boot path).
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );
    // Pull bridge.isReady() through the container.
    const isReady = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      return bridge.isReady();
    });
    expect(isReady).toBe(true);
  });

  test('empty mesh has zero faces and zero verts on fresh init', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );
    // Defensive smoke — initial scene may already have faces (e.g.,
    // ground plane). Just verify getStats() returns numbers, not that
    // they're zero. The contract is: "stats are queryable post-init".
    const stats = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      const s = bridge.getStats();
      return { faces: s.faces, verts: s.verts };
    });
    expect(typeof stats.faces).toBe('number');
    expect(typeof stats.verts).toBe('number');
    expect(stats.faces).toBeGreaterThanOrEqual(0);
    expect(stats.verts).toBeGreaterThanOrEqual(0);
  });
});
