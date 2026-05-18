/**
 * Debug spec — 사용자 mouse drawing fail 원인 진단.
 * Top view Circle fail + 3d view Rect fail.
 */
import { test } from '@playwright/test';

test('Debug: top view circle click positions + lastError', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    return w && w.get('bridge')?.isReady?.();
  }, { timeout: 10_000 });

  // Set top view
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__axia.get('viewport');
    v.setViewMode('top');
  });
  await page.waitForTimeout(150);

  // Activate circle tool + log get3DPoint at center for diagnostic
  const diag = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const tm = w.get('toolManager');
    const v = w.get('viewport');
    const bridge = w.get('bridge');
    tm.setTool('circle');
    const canvas = v.renderer.domElement as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return {
      canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
      viewMode: v.viewMode,
      cameraType: v.activeCamera?.constructor?.name,
      cameraPos: v.activeCamera ? {
        x: v.activeCamera.position.x,
        y: v.activeCamera.position.y,
        z: v.activeCamera.position.z,
      } : null,
      faces: bridge.getStats().faces,
    };
  });
  // eslint-disable-next-line no-console
  console.log('[DIAG canvas/view]', JSON.stringify(diag));

  // Click center
  const cx = diag.canvas.x + diag.canvas.w / 2;
  const cy = diag.canvas.y + diag.canvas.h / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);

  // Inspect tool state after 1st click via accessing internal
  const afterFirst = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const tm = w.get('toolManager');
    const bridge = w.get('bridge');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = (tm as any).tools?.get?.('circle');
    return {
      currentTool: tm._currentTool ?? null,
      circleCenter: tool?.circleCenter ? {
        x: tool.circleCenter.x,
        y: tool.circleCenter.y,
        z: tool.circleCenter.z,
      } : null,
      isBusy: tool?.isBusy?.(),
      faces: bridge.getStats().faces,
    };
  });
  // eslint-disable-next-line no-console
  console.log('[DIAG after 1st click]', JSON.stringify(afterFirst));

  // Click radius
  await page.mouse.click(cx + 200, cy);
  await page.waitForTimeout(200);

  const afterSecond = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const bridge = w.get('bridge');
    const buf = bridge.getMeshBuffers();
    const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
    return {
      faces: bridge.getStats().faces,
      verts: bridge.getStats().verts,
      lastError: bridge.lastError?.(),
      bufLen: zSrc?.length ?? 0,
    };
  });
  // eslint-disable-next-line no-console
  console.log('[DIAG after 2nd click]', JSON.stringify(afterSecond));
});

test('Debug: 3d view rect — pick result + ground intersect', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    return w && w.get('bridge')?.isReady?.();
  }, { timeout: 10_000 });

  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__axia.get('viewport');
    v.setViewMode('3d');
  });
  await page.waitForTimeout(150);

  const diag = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const v = w.get('viewport');
    const canvas = v.renderer.domElement as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return {
      canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
      cameraType: v.activeCamera?.constructor?.name,
      cameraPos: { x: v.activeCamera.position.x, y: v.activeCamera.position.y, z: v.activeCamera.position.z },
      orbitTarget: v.orbitTarget ? { x: v.orbitTarget.x, y: v.orbitTarget.y, z: v.orbitTarget.z } : null,
    };
  });
  // eslint-disable-next-line no-console
  console.log('[DIAG 3d/canvas]', JSON.stringify(diag));

  const cx = diag.canvas.x + diag.canvas.w / 2;
  const cy = diag.canvas.y + diag.canvas.h / 2;

  // Get a MouseEvent-like to inspect get3DPoint
  const pointInfo = await page.evaluate(({ x, y }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const tm = w.get('toolManager');
    const v = w.get('viewport');
    const canvas = v.renderer.domElement as HTMLCanvasElement;
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get3D = (tm as any).get3DPoint?.bind(tm);
    if (!get3D) return { available: false };
    const fakeEvt = new MouseEvent('mousedown', { clientX: x, clientY: y });
    const p = get3D(fakeEvt);
    return {
      available: true,
      point: p ? { x: p.x, y: p.y, z: p.z } : null,
    };
  }, { x: cx, y: cy });
  // eslint-disable-next-line no-console
  console.log('[DIAG 3d point at center]', JSON.stringify(pointInfo));

  const point2 = await page.evaluate(({ x, y }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    const tm = w.get('toolManager');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get3D = (tm as any).get3DPoint?.bind(tm);
    if (!get3D) return null;
    const fakeEvt = new MouseEvent('mousedown', { clientX: x + 200, clientY: y + 100 });
    const p = get3D(fakeEvt);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }, { x: cx, y: cy });
  // eslint-disable-next-line no-console
  console.log('[DIAG 3d point at +200,+100]', JSON.stringify(point2));

  // Now real mouse click test
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (window as any).__axia;
    w.get('toolManager').setTool('rect');
  });
  await page.mouse.click(cx - 200, cy - 100);
  await page.waitForTimeout(80);
  await page.mouse.click(cx + 200, cy + 100);
  await page.waitForTimeout(200);

  const finalState = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).__axia.get('bridge');
    return {
      faces: bridge.getStats().faces,
      verts: bridge.getStats().verts,
      lastError: bridge.lastError?.(),
    };
  });
  // eslint-disable-next-line no-console
  console.log('[DIAG 3d final]', JSON.stringify(finalState));
});
