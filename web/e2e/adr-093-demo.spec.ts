/**
 * ADR-093 D-δ 직접 시연 — Cylinder 측면 single-click → 22 faces
 * 일괄 선택. surface_owner_id 그룹 promote 동작 확인.
 *
 * Output: web/demo-output/adr-093-*.png
 */
import { test } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test('ADR-093 직접 시연 — Cylinder 측면 click → group select', async ({ page }, _testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await waitForBridgeReady(page);

  // 1) Cylinder 생성 + bridge 통계
  const setup = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
    if (shapeId == null || shapeId < 0) {
      return { ok: false, stage: 'drawCircleAsCurve' };
    }
    const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
    if (!faceIds || faceIds.length === 0) {
      return { ok: false, stage: 'getShapeFaceIds' };
    }
    const profileFaceId = faceIds[0];
    const ok = bridge.createSolidExtrude(profileFaceId, 8);
    if (!ok) return { ok: false, stage: 'createSolidExtrude' };

    return {
      ok: true,
      profileFaceId,
      stats: bridge.getStats?.() ?? {},
    };
  });

  // 2) Sync mesh + 카메라
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

  // 3) Cylinder 측면 face 1개 ID 추출 + walkFaceOwnerSiblings 검증
  const walkResult = await page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');

    // 모든 active face id 수집
    const stats = bridge.getStats?.() ?? {};
    const faceCount = stats.faces ?? 0;

    // Find a side face: surface_owner_id is set and walk returns > 1 sibling
    let sideFaceId = -1;
    let groupSize = 0;
    let allOwnerIds: { fid: number; owner: number; siblings: number }[] = [];
    // brute force: sample from 0 to faceCount * 2 (handles holes)
    for (let fid = 0; fid < (faceCount ?? 0) * 2 + 5; fid++) {
      const oid = bridge.getFaceSurfaceOwnerId?.(fid);
      if (oid >= 0) {
        const sibs: number[] = bridge.walkFaceOwnerSiblings?.(fid) ?? [fid];
        allOwnerIds.push({ fid, owner: oid, siblings: sibs.length });
        if (sibs.length > groupSize) {
          sideFaceId = fid;
          groupSize = sibs.length;
        }
      }
    }

    // Walk from the side face
    let siblings: number[] = [];
    if (sideFaceId >= 0) {
      siblings = bridge.walkFaceOwnerSiblings?.(sideFaceId) ?? [];
    }

    return {
      faceCount,
      ownerInventory: allOwnerIds,
      sideFaceId,
      groupSize,
      siblings,
    };
  });

  // 4) SelectTool integration 시뮬레이션 — 측면 face click
  const selectResult = await page.evaluate(({ sideFaceId }) => {
    const w = window as unknown as AxiaWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tm = w.__axia!.get<any>('toolManager');
    if (!tm || !tm.selection) return { ok: false, reason: 'no toolManager.selection' };

    // Clear + select via group walk (simulates SelectTool single-click)
    tm.selection.clearSelection?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = w.__axia!.get<any>('bridge');
    const siblings: number[] = bridge.walkFaceOwnerSiblings?.(sideFaceId) ?? [];
    if (siblings.length === 0) return { ok: false, reason: 'walk returned empty' };

    // Mirror SelectTool logic: first with default modifiers, rest additive
    tm.selection.handleClick?.(siblings[0], false, false, false);
    for (let i = 1; i < siblings.length; i++) {
      tm.selection.handleClick?.(siblings[i], true, false, false);
    }

    const selectedFaces: number[] = tm.selection.getSelectedFaces?.() ?? [];
    return {
      ok: true,
      siblingCount: siblings.length,
      selectedCount: selectedFaces.length,
      siblings,
      selectedFaces,
    };
  }, { sideFaceId: walkResult.sideFaceId });

  // 5) Screenshot
  await page.waitForTimeout(300); // selection visual settle
  await page.screenshot({
    path: 'demo-output/adr-093-cylinder-group-select.png',
    fullPage: false,
  });

  // 6) Console summary
  console.log('═══════════════════════════════════════════════');
  console.log('ADR-093 D-δ 직접 시연 결과');
  console.log('═══════════════════════════════════════════════');
  console.log('Setup:', JSON.stringify(setup, null, 2));
  console.log('Walk result:', JSON.stringify(walkResult, null, 2));
  console.log('Select result:', JSON.stringify(selectResult, null, 2));
  console.log('═══════════════════════════════════════════════');
});
