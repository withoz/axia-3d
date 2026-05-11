/**
 * ADR-094 default ON activation — production layer 가 자동 Path B
 * 활성화 검증.
 *
 * fresh page load (localStorage 미설정) → main.ts init → bridge.
 * setCylinderPathBDefault(true) 자동 호출 → cylinder 생성 시 자동
 * 3 face / 2 edge / 2 vert 산출.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test('ADR-094 default ON — fresh load auto-activates Path B', async ({ page }) => {
  // Make sure no localStorage preference exists (fresh user).
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('axia:cylinder-path-b-mode'));
  await page.reload();
  await waitForBridgeReady(page);

  const result = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    // Should be ON without any explicit setCylinderPathBDefault — main.ts
    // wired CylinderPathBSettings → bridge at init.
    const flagAtBoot = bridge.getCylinderPathBDefault();

    // Create cylinder via standard production flow.
    const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    const fids: number[] = bridge.getShapeFaceIds(shape);
    bridge.createSolidExtrude(fids[0], 8);
    const stats = bridge.getStats();

    return {
      flagAtBoot,
      faces: stats.faces,
      edges: stats.edges,
      verts: stats.verts,
    };
  });

  // Default ON — flag must be true at bridge init (no localStorage 설정).
  expect(result.flagAtBoot).toBe(true);
  // Cylinder must be Path B (3/2/2) without any explicit toggle.
  expect(result.faces).toBe(3);
  expect(result.edges).toBe(2);
  expect(result.verts).toBe(2);
});

test('ADR-094 explicit OFF preference 보존 — localStorage "false" → Path A', async ({ page }) => {
  // User opts out via SettingsPanel (또는 localStorage 직접 set).
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('axia:cylinder-path-b-mode', 'false'));
  await page.reload();
  await waitForBridgeReady(page);

  const result = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    const flagAtBoot = bridge.getCylinderPathBDefault();
    const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    const fids: number[] = bridge.getShapeFaceIds(shape);
    bridge.createSolidExtrude(fids[0], 8);
    const stats = bridge.getStats();

    return {
      flagAtBoot,
      faces: stats.faces,
    };
  });

  // explicit OFF preference → flag false at boot
  expect(result.flagAtBoot).toBe(false);
  // Path A (≥ 8 quads + top + bottom = 25 face)
  expect(result.faces).toBeGreaterThanOrEqual(10);
});
