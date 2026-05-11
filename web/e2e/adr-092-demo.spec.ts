/**
 * ADR-092 직접 시연 — DrawCircle → PushPull 결과를 real Chromium 에서
 * 실행하고 screenshot + bridge 통계 캡처. 사용자 시연 회귀를 자동화로
 * 재현.
 *
 * Run: npx playwright test adr-092-demo --headed (or non-headed)
 * Output: web/test-results/adr-092-demo-(...)/screenshots
 */
import { test } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test('ADR-092 직접 시연 — DrawCircle → PushPull → top rim screenshot', async ({ page }, testInfo) => {
  // 캔버스 사이즈 보장
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await waitForBridgeReady(page);

  // 1) DrawCircle (closed-curve mode 자동) + PushPull → cylinder
  const setup = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    // Cylinder: r=5, height=8, on z=0 plane
    const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    if (shapeId == null || shapeId < 0) {
      return { ok: false, stage: 'drawCircleAsCurve', shapeId };
    }
    const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
    if (!faceIds || faceIds.length === 0) {
      return { ok: false, stage: 'getShapeFaceIds', faceIds };
    }
    const profileFaceId = faceIds[0];
    const ok = bridge.createSolidExtrude(profileFaceId, 8);
    if (!ok) {
      return { ok: false, stage: 'createSolidExtrude' };
    }

    // 통계
    const stats = bridge.getStats?.() ?? {};
    const edgeMap: Uint32Array = bridge.getEdgeMap();
    const segByEdge = new Map<number, number>();
    for (let i = 0; i < edgeMap.length; i++) {
      const eid = edgeMap[i];
      segByEdge.set(eid, (segByEdge.get(eid) ?? 0) + 1);
    }
    const multi = [...segByEdge.values()].filter(c => c >= 2);
    const single = [...segByEdge.values()].filter(c => c === 1);

    return {
      ok: true,
      stage: 'success',
      faces: stats.faces ?? null,
      edges: stats.edges ?? null,
      verts: stats.verts ?? null,
      totalEdgesInMap: segByEdge.size,
      multiSegmentEdges: multi.length,
      singleSegmentEdges: single.length,
      avgSegPerArcEdge: multi.length > 0
        ? (multi.reduce((a, b) => a + b, 0) / multi.length)
        : 0,
      totalSegments: edgeMap.length,
    };
  });

  // 2) Sync mesh — force Three.js viewport to rebuild from new bridge state
  await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tm = w.__axia!.get<any>('toolManager');
    if (tm && typeof tm.syncMesh === 'function') {
      tm.syncMesh();
    }
  });
  await page.waitForTimeout(500);

  // 3) 카메라 회전 — isometric view 로 변경 (cylinder side + top 모두 보이게)
  await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewport = w.__axia!.get<any>('viewport');
    if (viewport && viewport.camera) {
      // mm units → cylinder is 5mm radius, 8mm height. Camera at ~50mm.
      viewport.camera.position.set(50, -50, 40);
      viewport.camera.lookAt(0, 0, 4);
      viewport.camera.updateProjectionMatrix?.();
    }
  });
  await page.waitForTimeout(500); // render settle

  // 3) Screenshot — deterministic path
  await page.screenshot({
    path: 'demo-output/adr-092-cylinder-overall.png',
    fullPage: false,
  });

  // Zoom into top rim
  await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewport = w.__axia!.get<any>('viewport');
    if (viewport && viewport.camera) {
      viewport.camera.position.set(8, -8, 12);
      viewport.camera.lookAt(0, 0, 8);
      viewport.camera.updateProjectionMatrix?.();
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'demo-output/adr-092-top-rim-zoom.png',
    fullPage: false,
  });

  // 통계 첨부
  await testInfo.attach('bridge-stats.json', {
    body: JSON.stringify(setup, null, 2),
    contentType: 'application/json',
  });

  // 콘솔에 요약
  console.log('═══════════════════════════════════════════════');
  console.log('ADR-092 직접 시연 결과');
  console.log('═══════════════════════════════════════════════');
  console.log(JSON.stringify(setup, null, 2));
  console.log('═══════════════════════════════════════════════');
});
