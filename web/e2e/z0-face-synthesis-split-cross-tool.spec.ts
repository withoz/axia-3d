/**
 * E2E — 면생성 + 면분할 cross-tool 종합 검증.
 *
 * 사용자 결재 (2026-05-18):
 * > "먼저 면생성및 면분할 검증"
 *
 * z0-closed-loop-face-synthesis (Line) + z0-face-split-all-tools (Rect)
 * + z0-rect-stress-split 위에 *모든 closed-curve 도구* 와 *cross-tool
 * 면분할* 종합 검증.
 *
 * 검증 매트릭스:
 *
 *   A. Single closed → face (각 도구의 face 생성 기본):
 *      A1: drawRectAsShape           → 1 face
 *      A2: drawCircleAsShape         → 1 face (polygon)
 *      A3: drawCircleAsCurve         → 1 face (Path B closed-curve)
 *      A4: drawPolylineAsShape       → 1 face (polygon, 6-gon)
 *      A5: drawClosedBezierAsCurve   → 1 face (closed Bezier)
 *      A6: drawClosedBSplineAsCurve  → 1 face (closed BSpline)
 *
 *   B. Cross-tool partial overlap (ADR-101 auto-split):
 *      B1: Rect × Circle (polygon) → 3 sub-faces
 *      B2: Rect × Polyline (hexagon) → 3 sub-faces
 *      B3: Circle × Circle (polygon both) → 3 sub-faces
 *      B4: Polyline × Polyline (hexagon both) → 3 sub-faces
 *
 *   C. Cross-tool containment (LOCKED #1 P7):
 *      C1: Rect outer + Circle inner   → 2 faces (ring + hole)
 *      C2: Circle outer + Rect inner   → 2 faces
 *      C3: Polyline outer + Circle inner → 2 faces
 *
 * Anchor:
 *   - LOCKED #1 ADR-021 P7 (containment split)
 *   - LOCKED #12 ADR-025 P11 (닫힌 엣지 = 반드시 면)
 *   - LOCKED #41 ADR-101 (partial overlap auto-intersect)
 *   - LOCKED #15 메타-원칙 #15 (동일 분할 = 동일 contract)
 *   - 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

test.describe('Face synthesis + split — all tools cross-cut', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-1 + B-β-3 (2026-05-18~21): auto-intersect + auto-face-
    // synthesis default OFF. Legacy ADR-101 + LOCKED #1 P7 + LOCKED #12
    // P11 동작 검증 — explicit opt-in.
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-intersect-on-draw', 'true');
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
    });
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bridge = (window as any).__axia?.get?.('bridge');
        return !!bridge?.isReady?.();
      },
      undefined,
      { timeout: 10_000 },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // (A) Single closed → face (각 도구 face 생성)
  // ════════════════════════════════════════════════════════════════════

  test('A1: drawRectAsShape → 1 face on z=0', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 5000, 5000);
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, 'Rect → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  test('A2: drawCircleAsShape → 1 face (polygon)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 2000, 32);
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, 'Circle polygon → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  test('A3: drawCircleAsCurve (Path B) → 1 face (closed-curve)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      const shapeRaw = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 2000);
      return { delta: bridge.getStats().faces - before, shapeRaw };
    });
    expect(r.shapeRaw, 'Path B Circle should be supported').toBeGreaterThanOrEqual(0);
    expect(r.delta, 'Path B Circle → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  test('A4: drawPolylineAsShape (hexagon) → 1 face', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      const pts: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(Math.cos(a) * 2000, Math.sin(a) * 2000, 0);
      }
      bridge.drawPolylineAsShape(new Float64Array(pts), { x: 0, y: 0, z: 1 });
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, 'Polyline hexagon → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  test('A5: drawClosedBezierAsCurve → 1 face', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as any;
      if (typeof bridge.drawClosedBezierAsCurve !== 'function') {
        return { unavailable: true };
      }
      const before = bridge.getStats().faces;
      // 5 control points (last == first for closure): roughly circular
      const cps = new Float64Array([
        2000, 0, 0,
        1000, 1732, 0,
        -1000, 1732, 0,
        -2000, 0, 0,
        2000, 0, 0,  // close
      ]);
      const shapeRaw = bridge.drawClosedBezierAsCurve(cps);
      return { delta: bridge.getStats().faces - before, shapeRaw, unavailable: false };
    });
    if (r.unavailable) {
      test.skip(true, 'drawClosedBezierAsCurve unavailable');
      return;
    }
    expect(r.shapeRaw, 'Closed Bezier should succeed').toBeGreaterThanOrEqual(0);
    expect(r.delta, 'Closed Bezier → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  test('A6: drawClosedBSplineAsCurve → 1 face', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as any;
      if (typeof bridge.drawClosedBSplineAsCurve !== 'function') {
        return { unavailable: true };
      }
      const before = bridge.getStats().faces;
      // 5 control points + clamped knots, degree 3
      const cps = new Float64Array([
        2000, 0, 0,
        1000, 1732, 0,
        -1000, 1732, 0,
        -2000, 0, 0,
        2000, 0, 0,
      ]);
      const knots = new Float64Array([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
      const shapeRaw = bridge.drawClosedBSplineAsCurve(cps, knots, 3);
      return { delta: bridge.getStats().faces - before, shapeRaw, unavailable: false };
    });
    if (r.unavailable) {
      test.skip(true, 'drawClosedBSplineAsCurve unavailable');
      return;
    }
    expect(r.shapeRaw, 'Closed BSpline should succeed').toBeGreaterThanOrEqual(0);
    expect(r.delta, 'Closed BSpline → expected +1 face').toBeGreaterThanOrEqual(1);
  });

  // ════════════════════════════════════════════════════════════════════
  // (B) Cross-tool partial overlap → 3 sub-faces (LOCKED #41 ADR-101)
  // ════════════════════════════════════════════════════════════════════

  test('B1: Rect × Circle (polygon) partial overlap → ≥ 3 sub-faces', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      // Rect at (0,0) 4×4m
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      // Circle at (3000, 0) r=2m → partial overlap
      bridge.drawCircleAsShape(3000, 0, 0, 0, 0, 1, 2000, 32);
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Rect × Circle partial overlap → expected ≥ 3 faces, got ${r.delta}`).toBeGreaterThanOrEqual(3);
  });

  test('B2: Rect × Polyline (hexagon) partial overlap → ≥ 3 sub-faces', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      // Rect at (0,0) 4×4m
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      // Hexagon at (3000, 0) r=2m
      const pts: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(3000 + Math.cos(a) * 2000, Math.sin(a) * 2000, 0);
      }
      bridge.drawPolylineAsShape(new Float64Array(pts), { x: 0, y: 0, z: 1 });
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Rect × Polyline partial overlap → expected ≥ 3 faces, got ${r.delta}`).toBeGreaterThanOrEqual(3);
  });

  test('B3: Circle × Circle (polygon both) partial overlap → ≥ 3 sub-faces', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawCircleAsShape(-1500, 0, 0, 0, 0, 1, 2000, 32);
      bridge.drawCircleAsShape(1500, 0, 0, 0, 0, 1, 2000, 32);
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Circle × Circle partial overlap → expected ≥ 3 faces, got ${r.delta}`).toBeGreaterThanOrEqual(3);
  });

  test('B4: Polyline × Polyline (hexagon both) partial overlap → ≥ 3 sub-faces', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      const hexA: number[] = []; const hexB: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        hexA.push(-1500 + Math.cos(a) * 2000, Math.sin(a) * 2000, 0);
        hexB.push(1500 + Math.cos(a) * 2000, Math.sin(a) * 2000, 0);
      }
      bridge.drawPolylineAsShape(new Float64Array(hexA), { x: 0, y: 0, z: 1 });
      bridge.drawPolylineAsShape(new Float64Array(hexB), { x: 0, y: 0, z: 1 });
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Polyline × Polyline overlap → expected ≥ 3 faces, got ${r.delta}`).toBeGreaterThanOrEqual(3);
  });

  // ════════════════════════════════════════════════════════════════════
  // (C) Cross-tool containment → 2 faces (LOCKED #1 P7)
  // ════════════════════════════════════════════════════════════════════

  test('C1: Rect outer + Circle inner (contained) → 2 faces (ring + hole)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1000, 32);  // inner
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Rect + Circle inner → expected ≥ 2 faces, got ${r.delta}`).toBeGreaterThanOrEqual(2);
  });

  test('C2: Circle outer + Rect inner (contained) → 2 faces (ring + hole)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 5000, 32);
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1500, 1500);  // inner
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Circle + Rect inner → expected ≥ 2 faces, got ${r.delta}`).toBeGreaterThanOrEqual(2);
  });

  test('C3: Polyline outer + Circle inner (contained) → 2 faces (ring + hole)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      const before = bridge.getStats().faces;
      const pts: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(Math.cos(a) * 5000, Math.sin(a) * 5000, 0);
      }
      bridge.drawPolylineAsShape(new Float64Array(pts), { x: 0, y: 0, z: 1 });
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1000, 24);  // inner
      return { delta: bridge.getStats().faces - before };
    });
    expect(r.delta, `Polyline + Circle inner → expected ≥ 2 faces, got ${r.delta}`).toBeGreaterThanOrEqual(2);
  });

  // ════════════════════════════════════════════════════════════════════
  // (D) z=0 invariant preservation across all face synthesis + split
  // ════════════════════════════════════════════════════════════════════

  test('D1: All cross-tool ops preserve z=0 invariant', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Stress sequence — multiple tool types creating + splitting
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 6000, 6000);
      bridge.drawCircleAsShape(3000, 0, 0, 0, 0, 1, 1500, 32);
      const hex: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        hex.push(-3000 + Math.cos(a) * 1500, Math.sin(a) * 1500, 0);
      }
      bridge.drawPolylineAsShape(new Float64Array(hex), { x: 0, y: 0, z: 1 });
      bridge.drawCircleAsCurve(0, -4000, 0, 0, 0, 1, 1000);  // Path B
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const zSrc = buf.positionsF64 ?? buf.positions;
      const z = []; for (let i = 2; i < zSrc.length; i += 3) z.push(zSrc[i]);
      const uniqueZ = [...new Set(z.map(v => Number(v.toFixed(6))))];
      return {
        ok: true,
        faces: bridge.getStats().faces,
        vertCount: z.length,
        allZero: z.every(v => v === 0),
        uniqueZ,
        maxAbsZ: z.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
      };
    });
    expect(r.ok).toBe(true);
    expect(r.faces).toBeGreaterThanOrEqual(4);  // at least 4 distinct shapes
    expect(r.allZero, `cross-tool z!=0: maxAbsZ=${r.maxAbsZ}, uniqueZ=${r.uniqueZ?.join(',')}`).toBe(true);
    expect(r.uniqueZ).toEqual([0]);
  });
});
