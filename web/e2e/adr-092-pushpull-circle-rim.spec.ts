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

  // 2026-05-12 RE-ENABLED via parallel Path A / Path B coverage —
  // see commit fix/adr-092-test-path-b-aware. The original SKIP
  // assumed legacy Path A topology (N polygon rim edges with Arc),
  // but ADR-094 B-η (2026-05-09) flipped production default to
  // Path B (kernel-native annulus — top + bottom are single
  // self-loop closed-curve edges). Both paths produce visually
  // smooth rims (A-κ render fast-path tessellates Circle/Arc to
  // chord-tolerant segments); they just count differently in
  // `getEdgeMap()`. The two tests below cover both contracts.

  /**
   * Path A (legacy tessellate-then-extrude, `cylinder_path_b_default = false`):
   *
   * After `extrude_closed_curve_face_via_tessellation` runs, the
   * solid has:
   *   - Bottom polygonal face — N rim edges, each with `AnalyticCurve::Arc`
   *     (attached at step 6 of the function)
   *   - Top polygonal face — N rim edges, each with `AnalyticCurve::Arc`
   *     (attached at step 8 — ADR-092 C-β fix)
   *   - N side quad faces sharing rim edges
   *
   * Render path (A-κ) tessellates each Arc-attached edge to multiple
   * segments → 2N multi-segment EdgeIds. For radius 5 with
   * chord_tol = 0.05 mm, N ≥ 8, so assert `multiSegmentEdges ≥ 16`.
   *
   * This is the explicit-OFF path users hit via
   * `localStorage 'axia:cylinder-path-b-mode' = 'false'`.
   */
  test('Path A (legacy tessellate) — top + bottom rims attach Arc to N polygon edges (≥ 2N total)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Force Path A for this test (production default is Path B).
      // setCylinderPathBDefault is the same hook main.ts uses, so
      // the engine routes createSolidExtrude → Path A consistently.
      bridge.setCylinderPathBDefault(false);

      const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      if (shapeId == null || shapeId < 0) {
        return { ok: false, reason: 'drawCircleAsCurve failed' };
      }
      const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
      if (!faceIds || faceIds.length === 0) {
        return { ok: false, reason: 'no faces from Shape' };
      }
      const profileFaceId = faceIds[0];

      const pushPullOk = bridge.createSolidExtrude(profileFaceId, 10.0);
      if (!pushPullOk) {
        return { ok: false, reason: 'createSolidExtrude returned false' };
      }

      const edgeMap: Uint32Array = bridge.getEdgeMap();
      if (!edgeMap || edgeMap.length === 0) {
        return { ok: false, reason: 'edgeMap empty post Push-Pull' };
      }
      const segCountByEdgeId = new Map<number, number>();
      for (let i = 0; i < edgeMap.length; i++) {
        const eid = edgeMap[i];
        segCountByEdgeId.set(eid, (segCountByEdgeId.get(eid) ?? 0) + 1);
      }
      let multiSegmentEdges = 0;
      for (const c of segCountByEdgeId.values()) {
        if (c >= 2) multiSegmentEdges++;
      }
      return {
        ok: true,
        totalSegmentsPost: edgeMap.length,
        totalEdges: segCountByEdgeId.size,
        multiSegmentEdges,
      };
    });

    if (!result.ok) {
      throw new Error(`Test setup failed: ${(result as { reason?: string }).reason}`);
    }
    expect(result.ok).toBe(true);
    // Both rims smooth = ≥ 2N multi-segment EdgeIds. N ≥ 8 for r=5.
    expect(result.multiSegmentEdges).toBeGreaterThanOrEqual(16);
  });

  /**
   * Path B (kernel-native annulus, current production default):
   *
   * After `extrude_cylinder_kernel_native` runs, the solid has just
   * 3 faces + 2 edges + 2 verts (산업 CAD parity, ADR-094 §1):
   *   - Top face — 1 self-loop edge with `AnalyticCurve::Circle`
   *   - Bottom face — 1 self-loop edge with `AnalyticCurve::Circle`
   *   - 1 annulus side face
   *
   * Render path (A-κ) tessellates each closed-curve self-loop edge
   * to N chord-tolerant segments → exactly 2 multi-segment EdgeIds
   * (1 top + 1 bottom), and the *segments* per rim count toward the
   * N-segment chord budget. So we assert:
   *   - `multiSegmentEdges === 2` (1 top + 1 bottom)
   *   - `totalSegmentsPost >= 2 * 8` (each rim ≥ 8 segments for r=5)
   */
  test('Path B (kernel-native, production default) — top + bottom self-loop edges render as 2 smooth rings', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Path B is the production default; assert it explicitly so the
      // test is robust if main.ts init order changes.
      bridge.setCylinderPathBDefault(true);

      const shapeId = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5);
      if (shapeId == null || shapeId < 0) {
        return { ok: false, reason: 'drawCircleAsCurve failed' };
      }
      const faceIds: number[] = bridge.getShapeFaceIds(shapeId);
      if (!faceIds || faceIds.length === 0) {
        return { ok: false, reason: 'no faces from Shape' };
      }
      const profileFaceId = faceIds[0];

      const pushPullOk = bridge.createSolidExtrude(profileFaceId, 10.0);
      if (!pushPullOk) {
        return { ok: false, reason: 'createSolidExtrude returned false' };
      }

      const edgeMap: Uint32Array = bridge.getEdgeMap();
      if (!edgeMap || edgeMap.length === 0) {
        return { ok: false, reason: 'edgeMap empty post Push-Pull' };
      }
      const segCountByEdgeId = new Map<number, number>();
      for (let i = 0; i < edgeMap.length; i++) {
        const eid = edgeMap[i];
        segCountByEdgeId.set(eid, (segCountByEdgeId.get(eid) ?? 0) + 1);
      }
      const multiSegmentSegCounts = [...segCountByEdgeId.values()].filter(c => c >= 2);
      const rimSegmentSum = multiSegmentSegCounts.reduce((a, b) => a + b, 0);
      return {
        ok: true,
        totalSegmentsPost: edgeMap.length,
        totalEdges: segCountByEdgeId.size,
        multiSegmentEdges: multiSegmentSegCounts.length,
        rimSegmentSum,
      };
    });

    if (!result.ok) {
      throw new Error(`Test setup failed: ${(result as { reason?: string }).reason}`);
    }
    expect(result.ok).toBe(true);
    // 2 = 1 top self-loop + 1 bottom self-loop (each contributes 1 EdgeId).
    expect(result.multiSegmentEdges).toBe(2);
    // Each rim tessellates to ≥ 8 segments for r=5 (chord_tol = r/100 = 0.05 mm
    // → segment_count_for_arc enforces min 8). Two rims = ≥ 16 segments.
    expect(result.rimSegmentSum).toBeGreaterThanOrEqual(16);
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
