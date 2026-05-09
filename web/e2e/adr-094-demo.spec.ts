/**
 * ADR-094 B-θ 직접 시연 — Path B kernel-native cylinder 활성화 + 시각
 * 검증. 산업 CAD parity (3 face / 2 edge / 2 vert annulus topology)
 * 의 production 시연.
 *
 * Output: web/demo-output/adr-094-*.png + console summary.
 */
import { test } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test('ADR-094 B-θ — Path B cylinder 3/2/2 architectural anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await waitForBridgeReady(page);

  // Capture Path A baseline first.
  const pathAStats = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');
    // Default OFF (engine).
    bridge.setCylinderPathBDefault(false);
    const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
    bridge.createSolidExtrude(faceIds[0], 8);
    const stats = bridge.getStats();
    return {
      faces: stats.faces,
      edges: stats.edges,
      verts: stats.verts,
      pathBOn: bridge.getCylinderPathBDefault(),
    };
  });

  // Reset scene by reloading.
  await page.reload();
  await waitForBridgeReady(page);

  // Path B activation + cylinder creation.
  const pathBResult = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    // Activate Path B (production layer flip).
    bridge.setCylinderPathBDefault(true);
    const flagOn = bridge.getCylinderPathBDefault();

    // Create cylinder via standard production flow.
    const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
    const ok = bridge.createSolidExtrude(faceIds[0], 8);

    const stats = bridge.getStats();
    return {
      flagOn,
      createOk: ok,
      faces: stats.faces,
      edges: stats.edges,
      verts: stats.verts,
    };
  });

  // Sync mesh + camera.
  await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tm = w.__axia!.get<any>('toolManager');
    if (tm && typeof tm.syncMesh === 'function') tm.syncMesh();
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewport = w.__axia!.get<any>('viewport');
    if (viewport && viewport.camera) {
      viewport.camera.position.set(50, -50, 40);
      viewport.camera.lookAt(0, 0, 4);
      viewport.camera.updateProjectionMatrix?.();
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'demo-output/adr-094-cylinder-path-b.png',
    fullPage: false,
  });

  // Memory comparison.
  const memSavings = {
    pathA: { faces: pathAStats.faces, edges: pathAStats.edges, verts: pathAStats.verts },
    pathB: { faces: pathBResult.faces, edges: pathBResult.edges, verts: pathBResult.verts },
    faceReduction:
      ((pathAStats.faces - pathBResult.faces) / pathAStats.faces * 100).toFixed(1) + '%',
    edgeReduction:
      ((pathAStats.edges - pathBResult.edges) / pathAStats.edges * 100).toFixed(1) + '%',
    vertReduction:
      ((pathAStats.verts - pathBResult.verts) / pathAStats.verts * 100).toFixed(1) + '%',
  };

  console.log('═══════════════════════════════════════════════');
  console.log('ADR-094 B-θ 직접 시연 결과');
  console.log('═══════════════════════════════════════════════');
  console.log('Path A baseline:', pathAStats);
  console.log('Path B result:', pathBResult);
  console.log('Memory savings:', memSavings);
  console.log('═══════════════════════════════════════════════');
});
