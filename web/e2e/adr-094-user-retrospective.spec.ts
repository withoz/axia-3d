/**
 * ADR-094 B-θ 사용자 시연 회고 — Path B 활성 후 추가 회귀 / UX 검토.
 *
 * 사용자 facing 가치 검증의 multi-scenario 회고:
 *  1. Path B activation via localStorage / bridge
 *  2. Cylinder 생성 및 face count 검증 (3/2/2)
 *  3. Selection: 단일 click → 전체 cylinder side (ADR-093 + Path B
 *     두 layer 모두 작동)
 *  4. Render 검증 (annulus tessellation 정합)
 *  5. Undo/redo 정합성
 *  6. Snapshot round-trip 정합성
 *  7. Path A ↔ Path B 토글 정합성
 *
 * Output: web/demo-output/adr-094-retrospective-*.png
 */
import { test } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-094 B-θ 사용자 시연 회고', () => {
  test('Scenario 1: Path B 활성 + Cylinder 생성 + 3/2/2 anchor', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const fids: number[] = bridge.getShapeFaceIds(shape);
      bridge.createSolidExtrude(fids[0], 8);
      const stats = bridge.getStats();
      return { faces: stats.faces, edges: stats.edges, verts: stats.verts };
    });

    if (result.faces !== 3 || result.edges !== 2 || result.verts !== 2) {
      throw new Error(
        `Scenario 1 failed: expected 3/2/2, got ${result.faces}/${result.edges}/${result.verts}`,
      );
    }
  });

  test('Scenario 2: Selection on Path B annulus → single face (no group walk needed)', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const selectResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const fids: number[] = bridge.getShapeFaceIds(shape);
      bridge.createSolidExtrude(fids[0], 8);

      // Find annulus face — surface kind 2 = Cylinder. Brute-force scan
      // (faces are tiny — only 3).
      let annulusId = -1;
      for (let fid = 0; fid < 100; fid++) {
        const kind = bridge.faceSurfaceKind?.(fid);
        if (kind === 2) {
          annulusId = fid;
          break;
        }
      }

      // Walk owner siblings — Path B annulus 는 owner_id 미부여 (group
      // of 1) 이므로 walk = [annulusId] 자기 자신.
      const siblings: number[] = annulusId >= 0
        ? bridge.walkFaceOwnerSiblings(annulusId)
        : [];

      return {
        annulusId,
        siblingCount: siblings.length,
        siblings,
      };
    });

    if (selectResult.annulusId < 0) {
      throw new Error('Scenario 2 failed: annulus face not found');
    }
    // Path B 의 annulus 는 single face → walk 결과는 자기 자신만 (group
    // walk 미필요). 사용자 facing 결과: 측면 click 시 annulus 단일 선택.
    if (selectResult.siblingCount !== 1) {
      throw new Error(
        `Scenario 2 failed: Path B annulus siblings expected 1, got ${selectResult.siblingCount}`,
      );
    }
  });

  test('Scenario 3: Undo restores pre-cylinder state', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const undoResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      const before = bridge.getStats();
      const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const fids: number[] = bridge.getShapeFaceIds(shape);
      bridge.createSolidExtrude(fids[0], 8);
      const after = bridge.getStats();

      // Multi-undo to peel back: createSolidExtrude + drawCircleAsCurve.
      bridge.undo();
      const afterUndo1 = bridge.getStats();
      bridge.undo();
      const afterUndo2 = bridge.getStats();

      return { before, after, afterUndo1, afterUndo2 };
    });

    // Cylinder created.
    if (undoResult.after.faces !== 3) {
      throw new Error(`Scenario 3: Path B should produce 3 faces, got ${undoResult.after.faces}`);
    }
    // First undo unwinds extrude. Second unwinds circle creation.
    // Final state = baseline.
    if (undoResult.afterUndo2.faces !== undoResult.before.faces) {
      throw new Error(
        `Scenario 3: undo×2 should return to baseline ${undoResult.before.faces}, ` +
        `got ${undoResult.afterUndo2.faces}`,
      );
    }
  });

  test('Scenario 4: Snapshot round-trip preserves Path B annulus topology', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const roundtripResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const fids: number[] = bridge.getShapeFaceIds(shape);
      bridge.createSolidExtrude(fids[0], 8);
      const before = bridge.getStats();

      const bytes = bridge.exportSnapshot();
      // Force a fresh state by reimporting.
      const ok = bridge.importSnapshot(bytes);
      const after = bridge.getStats();

      return {
        ok,
        before: { faces: before.faces, edges: before.edges, verts: before.verts },
        after: { faces: after.faces, edges: after.edges, verts: after.verts },
      };
    });

    if (!roundtripResult.ok) {
      throw new Error('Scenario 4: importSnapshot returned false');
    }
    // Path B topology preserved.
    if (
      roundtripResult.after.faces !== roundtripResult.before.faces ||
      roundtripResult.after.edges !== roundtripResult.before.edges ||
      roundtripResult.after.verts !== roundtripResult.before.verts
    ) {
      throw new Error(
        `Scenario 4: roundtrip drift. before=${JSON.stringify(roundtripResult.before)}, ` +
        `after=${JSON.stringify(roundtripResult.after)}`,
      );
    }
  });

  test('Scenario 5: Path A ↔ Path B toggle without scene corruption', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const toggleResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Path A first.
      bridge.setCylinderPathBDefault(false);
      const s1 = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const f1: number[] = bridge.getShapeFaceIds(s1);
      bridge.createSolidExtrude(f1[0], 8);
      const pathACounts = bridge.getStats();

      // Toggle to Path B; create another cylinder beside.
      bridge.setCylinderPathBDefault(true);
      const s2 = bridge.drawCircleAsCurve(20, 0, 0, 0, 0, 1, 5);
      const f2: number[] = bridge.getShapeFaceIds(s2);
      bridge.createSolidExtrude(f2[0], 8);
      const combinedCounts = bridge.getStats();

      return { pathACounts, combinedCounts };
    });

    // Path A creates 25 faces, then Path B adds 3 = 28 total.
    // Verify combined is exactly Path A count + Path B (3).
    const expectedFacesAfterPathB = toggleResult.pathACounts.faces + 3;
    if (Math.abs(toggleResult.combinedCounts.faces - expectedFacesAfterPathB) > 0) {
      throw new Error(
        `Scenario 5: toggle mismatch. Path A faces ${toggleResult.pathACounts.faces} + ` +
        `expected Path B 3 = ${expectedFacesAfterPathB}, ` +
        `got combined ${toggleResult.combinedCounts.faces}`,
      );
    }
  });

  test('Scenario 6: Visual capture — Path B cylinder rendering', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await waitForBridgeReady(page);

    await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      const shape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      const fids: number[] = bridge.getShapeFaceIds(shape);
      bridge.createSolidExtrude(fids[0], 8);
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
      path: 'demo-output/adr-094-retrospective-overall.png',
      fullPage: false,
    });

    // Zoom in to top rim.
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
      path: 'demo-output/adr-094-retrospective-rim-zoom.png',
      fullPage: false,
    });
  });

  test('Scenario 7: Multiple Path B cylinders + scene integrity', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const multiResult = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      bridge.setCylinderPathBDefault(true);

      // Create 5 Path B cylinders at different positions.
      for (let i = 0; i < 5; i++) {
        const shape = bridge.drawCircleAsCurve(i * 15, 0, 0, 0, 0, 1, 4);
        const fids: number[] = bridge.getShapeFaceIds(shape);
        bridge.createSolidExtrude(fids[0], 6);
      }
      const stats = bridge.getStats();
      return { faces: stats.faces, edges: stats.edges, verts: stats.verts };
    });

    // 5 cylinders × 3 face / 2 edge / 2 vert = 15 / 10 / 10
    if (multiResult.faces !== 15) {
      throw new Error(`Scenario 7: 5 Path B cylinders expected 15 faces, got ${multiResult.faces}`);
    }
    if (multiResult.edges !== 10) {
      throw new Error(`Scenario 7: expected 10 edges, got ${multiResult.edges}`);
    }
    if (multiResult.verts !== 10) {
      throw new Error(`Scenario 7: expected 10 verts, got ${multiResult.verts}`);
    }
  });
});
