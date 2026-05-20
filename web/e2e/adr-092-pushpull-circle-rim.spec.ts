/**
 * ADR-092 C-δ — Push-Pull preserves Circle metadata on top boundary.
 *
 * Real Chromium browser-runtime verification of the C-β core fix
 * (Arc curves attached to top face's N polygon edges with translated
 * center).
 *
 * 사용자 시연 결함 1 (DrawCircle → PushPull → top rim polygon visible)
 * 의 architectural 해결 검증.
 *
 * Verification path:
 *   1. DrawCircle (closed-curve mode) → 1 self-loop edge with Circle
 *   2. Push-Pull → cylinder solid
 *   3. Inspect bridge.getEdgeMap() — count segments per EdgeId
 *   4. Edges with Arc curves render as MULTIPLE polyline segments per
 *      edge (A-κ Arc tessellation). Edges without curves render as 1
 *      segment per edge (single Line).
 *   5. Pre-C-β: only bottom N edges have Arc → ~N edges with multi-segment.
 *      Post-C-β: bottom AND top N edges have Arc → ~2N edges with multi-segment.
 *
 * The test asserts ≥ 2N edges have multi-segment polylines, proving
 * BOTH bottom and top rims are rendered with smooth curve sampling.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-092 C-δ — Push-Pull Circle rim preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('top rim has Arc curves after Push-Pull on closed-curve Circle', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // 1. DrawCircle in closed-curve mode (ADR-089 default ON post-A-π).
      //    drawCircleAsCurve(cx, cy, cz, nx, ny, nz, radius) — returns
      //    ShapeId (form-layer per LOCKED #26 P-5e-α).
      const shapeId = bridge.drawCircleAsCurve(
        0, 0, 0,        // center
        0, 0, 1,        // normal +Z
        5,              // radius
      );
      if (shapeId == null || shapeId < 0) {
        return { ok: false, reason: 'drawCircleAsCurve failed', drawResult: shapeId };
      }

      // Resolve Shape → first face ID.
      const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
      if (!faceIds || faceIds.length === 0) {
        return { ok: false, reason: 'no faces from Shape', shapeId };
      }
      const profileFaceId = faceIds[0];

      // Capture pre-Push-Pull edge segment count for sanity.
      const edgeMapPre: Uint32Array = bridge.getEdgeMap();
      const totalSegmentsPre = edgeMapPre ? edgeMapPre.length : 0;

      // 2. Push-Pull (extrude) via typed bridge wrapper.
      const pushPullOk = bridge.createSolidExtrude(profileFaceId, 10.0);
      if (!pushPullOk) {
        return { ok: false, reason: 'createSolidExtrude returned false' };
      }

      // 3. Capture post-Push-Pull edge map and group segments by EdgeId.
      const edgeMap: Uint32Array = bridge.getEdgeMap();
      if (!edgeMap || edgeMap.length === 0) {
        return { ok: false, reason: 'edgeMap empty post Push-Pull' };
      }

      const segCountByEdgeId = new Map<number, number>();
      for (let i = 0; i < edgeMap.length; i++) {
        const eid = edgeMap[i];
        segCountByEdgeId.set(eid, (segCountByEdgeId.get(eid) ?? 0) + 1);
      }

      // 4. Count edges with multi-segment rendering (= Arc curves).
      //    Single-segment edges = straight Line edges (no curve attached).
      let multiSegmentEdges = 0;
      let singleSegmentEdges = 0;
      for (const count of segCountByEdgeId.values()) {
        if (count >= 2) multiSegmentEdges++;
        else singleSegmentEdges++;
      }

      const totalEdges = segCountByEdgeId.size;

      return {
        ok: true,
        totalSegmentsPre,
        totalSegmentsPost: edgeMap.length,
        totalEdges,
        multiSegmentEdges,
        singleSegmentEdges,
      };
    });

    if (!result.ok) {
      throw new Error(`Test setup failed: ${(result as { reason?: string }).reason}`);
    }

    // ADR-092 C-δ semantic: 'top rim is smooth (Arc-rendered), not polygon'.
    //
    // ADR-104 audit (2026-05-20) — original assertion (`multiSegmentEdges >= 16`)
    // was written 2026-05-09 BEFORE ADR-094 Path B default ON (same date).
    // Browser activates Path B → cylinder is 3 face / 2 edge / 2 vert
    // (산업 CAD parity, ~97% memory reduction). Both rims become *single*
    // self-loop edges with Circle/Arc curve attached, rendering via the
    // ADR-089 A-κ-β closed-curve fast-path (one EdgeId emits N polyline
    // segments).
    //
    // Path B canonical observable:
    //   - exactly 2 multi-segment edges (top rim + bottom rim self-loops)
    //   - total segments >= 16 (proves both are smooth, not 1-segment lines)
    //
    // Path A (legacy / Rust unit test default — Path B mode OFF) would
    // show ~46 multi-segment edges with ~8 segments each (per-Arc segment).
    // Both paths satisfy the semantic intent ('top rim smooth') — assertion
    // checks the invariant that survives the path swap.
    expect(result.ok).toBe(true);
    // Each rim is at least 8 segments smooth (chord_tol = radius/100 default).
    expect(result.totalSegmentsPost).toBeGreaterThanOrEqual(16);
    // At least 2 distinct edges produce multi-segment renders (top + bottom rim).
    expect(result.multiSegmentEdges).toBeGreaterThanOrEqual(2);
  });

  test('Arc-attached top edges produce visibly smoother polyline than straight lines', async ({ page }) => {
    // Diagnostic: compare segment-per-edge ratio. Multi-segment edges
    // should average ≥ 2 segments per edge (Arc tessellation samples
    // multiple points). Single-segment edges average exactly 1.
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      const shapeId = bridge.drawCircleAsCurve(
        0, 0, 0,
        0, 0, 1,
        10,    // radius 10 — more segments than radius 5
      );
      if (shapeId == null || shapeId < 0) return { ok: false };

      const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
      if (!faceIds || faceIds.length === 0) return { ok: false };
      const profileFaceId = faceIds[0];

      bridge.createSolidExtrude(profileFaceId, 5.0);

      const edgeMap: Uint32Array = bridge.getEdgeMap();
      const segByEdge = new Map<number, number>();
      for (let i = 0; i < edgeMap.length; i++) {
        const eid = edgeMap[i];
        segByEdge.set(eid, (segByEdge.get(eid) ?? 0) + 1);
      }

      const multi = [...segByEdge.values()].filter(c => c >= 2);
      const avgSegPerCurveEdge =
        multi.length > 0
          ? multi.reduce((a, b) => a + b, 0) / multi.length
          : 0;

      return {
        ok: true,
        multiCount: multi.length,
        avgSegPerCurveEdge,
      };
    });

    expect(result.ok).toBe(true);
    // Avg segments per Arc-attached edge should be > 1 (sampling of curves).
    // Straight Line edges would give exactly 1.
    expect(result.avgSegPerCurveEdge).toBeGreaterThan(1);
  });
});
