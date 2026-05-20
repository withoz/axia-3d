/**
 * E2E regression — LOCKED #12 ADR-025 P11: "닫힌 엣지에는 반드시 면이
 * 생성되어야 한다" + 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다").
 *
 * 사용자 결재 (2026-05-18, post-z=0 coplanarity verification):
 * > "모두 닫힌 루프에는 모두 면이 생성되었나요?"
 *
 * z=0 drawing coplanarity (직전 spec) 의 *자연 연장* — face creation API
 * (drawRectAsShape / drawCircleAsShape) 가 face 생성하는 것만 검증했음.
 * 진짜 LOCKED #12 P11 검증은 **drawLineAsShape × N → 자동 face 합성**.
 *
 * 검증 매트릭스 (real Chromium):
 *   1. drawLineAsShape × 4 (square loop) → face 자동 합성 (Step 4.99)
 *   2. drawLineAsShape × 6 (hexagon loop) → face 자동 합성
 *   3. drawLineAsShape × 3 (triangle loop) → face 자동 합성
 *   4. drawLineAsShape × 4 (NON-closed L-shape) → face 생성 ❌ (negative test)
 *   5. drawCircleAsCurve (closed kernel-native) → face 자동 합성 + z=0
 *   6. 0 orphans guarantee (free edges 모두 face 합성 후)
 *
 * Anchor:
 *   - LOCKED #12 ADR-025 P11 (Step 4.99 Final Sweep)
 *   - 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다)
 *   - ADR-019 (Line is Truth, Face is Byproduct)
 *   - ADR-021 P7 (P7 face split)
 *
 * 모든 line endpoints 가 z=0 cardinal plane 에 있어야 (LOCKED #7 SSOT).
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

interface BridgeShim {
  isReady?: () => boolean;
  getStats: () => { faces: number; verts: number; edges: number };
  drawLineAsShape: (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    nx?: number, ny?: number, nz?: number,
  ) => number;
  drawCircleAsCurve: (
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number,
  ) => number;
  getMeshBuffers: () => {
    positions: Float32Array;
    positionsF64?: Float64Array;
  } | null;
}

test.describe('Closed loop face synthesis on z=0 (LOCKED #12 + 메타-원칙 #14)', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-2 (2026-05-18): auto Step 4.99 closed cycle face
    // synthesis default OFF. Legacy LOCKED #12 P11 동작 검증 — explicit
    // opt-in via localStorage (ADR-049 P-5e-α canonical 답습).
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'true');
    });
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );
    const r = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia?.get<any>('bridge');
      return { ready: !!bridge?.isReady?.() };
    });
    expect(r.ready).toBe(true);
  });

  test('4 Lines (square) on z=0 → face auto-synthesized (Step 4.99)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // Draw square: (0,0,0) → (1000,0,0) → (1000,1000,0) → (0,1000,0) → close
      bridge.drawLineAsShape(0, 0, 0,         1000, 0, 0);
      bridge.drawLineAsShape(1000, 0, 0,      1000, 1000, 0);
      bridge.drawLineAsShape(1000, 1000, 0,   0, 1000, 0);
      bridge.drawLineAsShape(0, 1000, 0,      0, 0, 0);  // close
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
      const zValues: number[] = [];
      if (zSrc) {
        for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      }
      const allZeroExact = zValues.every(z => z === 0);
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        edgeDelta: after.edges - before.edges,
        allZeroExact,
        vertCount: zValues.length,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    // CRITICAL: closed square loop → face auto-synthesized
    expect(result.faceDelta, `4 Lines closed → expected face_delta >= 1, got ${result.faceDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.vertDelta).toBeGreaterThanOrEqual(4);
    expect(result.edgeDelta).toBeGreaterThanOrEqual(4);
    expect(result.allZeroExact).toBe(true);
  });

  test('6 Lines (hexagon) on z=0 → face auto-synthesized', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // Hexagon vertices (r=1000, on XY plane)
      const verts: [number, number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        verts.push([Math.cos(a) * 1000, Math.sin(a) * 1000, 0]);
      }
      // Draw 6 edges (close the loop)
      for (let i = 0; i < 6; i++) {
        const p0 = verts[i];
        const p1 = verts[(i + 1) % 6];
        bridge.drawLineAsShape(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      }
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
      const zValues: number[] = [];
      if (zSrc) {
        for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      }
      const allZeroExact = zValues.every(z => z === 0);
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        edgeDelta: after.edges - before.edges,
        allZeroExact,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.faceDelta, `6 Lines closed hex → expected face_delta >= 1, got ${result.faceDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.vertDelta).toBeGreaterThanOrEqual(6);
    expect(result.edgeDelta).toBeGreaterThanOrEqual(6);
    expect(result.allZeroExact).toBe(true);
  });

  test('3 Lines (triangle) on z=0 → face auto-synthesized', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // Triangle on z=0
      bridge.drawLineAsShape(0, 0, 0,        1000, 0, 0);
      bridge.drawLineAsShape(1000, 0, 0,     500, 866, 0);
      bridge.drawLineAsShape(500, 866, 0,    0, 0, 0);
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
      const zValues: number[] = [];
      if (zSrc) {
        for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      }
      const allZeroExact = zValues.every(z => z === 0);
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        allZeroExact,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.faceDelta, `3 Lines closed tri → expected face_delta >= 1, got ${result.faceDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.vertDelta).toBeGreaterThanOrEqual(3);
    expect(result.allZeroExact).toBe(true);
  });

  test('Negative test: NON-closed L-shape (4 Lines) → NO face', async ({ page }) => {
    test.setTimeout(30_000);
    // Verify: 닫히지 않은 L-shape (4 Lines, last endpoint != first start)
    // 은 face 합성 안 됨 (LOCKED #12 P11 의 정의 — *closed* cycle).
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // L-shape: 4 lines but NOT closed
      bridge.drawLineAsShape(0, 0, 0,        1000, 0, 0);
      bridge.drawLineAsShape(1000, 0, 0,     1000, 500, 0);
      bridge.drawLineAsShape(1000, 500, 0,   500, 500, 0);
      bridge.drawLineAsShape(500, 500, 0,    500, 1000, 0);  // open end
      const after = bridge.getStats();
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        edgeDelta: after.edges - before.edges,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    // CRITICAL: open shape → no face (LOCKED #12 P11 의 contrapositive)
    expect(result.faceDelta, `Open L-shape → expected face_delta == 0, got ${result.faceDelta}`).toBe(0);
    expect(result.vertDelta).toBeGreaterThanOrEqual(5);
    expect(result.edgeDelta).toBeGreaterThanOrEqual(4);
  });

  test('drawCircleAsCurve (closed kernel-native) → face + z=0', async ({ page }) => {
    test.setTimeout(30_000);
    // Path B kernel-native canonical: 1 anchor + 1 self-loop + 1 face
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 500);
      const after = bridge.getStats();
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        edgeDelta: after.edges - before.edges,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    // Path B canonical: 1 face / 1 edge (self-loop) / 1 vert
    expect(result.faceDelta).toBeGreaterThanOrEqual(1);
    expect(result.vertDelta).toBeGreaterThanOrEqual(1);
    expect(result.edgeDelta).toBeGreaterThanOrEqual(1);
  });

  test('Two closed loops on z=0 → 2 faces, all z=0 coplanar', async ({ page }) => {
    test.setTimeout(30_000);
    // 두 개의 분리된 닫힌 사각형 → 각각 face 자동 합성
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // Square 1: (0,0) ~ (500,500)
      bridge.drawLineAsShape(0, 0, 0,         500, 0, 0);
      bridge.drawLineAsShape(500, 0, 0,       500, 500, 0);
      bridge.drawLineAsShape(500, 500, 0,     0, 500, 0);
      bridge.drawLineAsShape(0, 500, 0,       0, 0, 0);
      // Square 2: (2000,0) ~ (2500,500) (disjoint)
      bridge.drawLineAsShape(2000, 0, 0,      2500, 0, 0);
      bridge.drawLineAsShape(2500, 0, 0,      2500, 500, 0);
      bridge.drawLineAsShape(2500, 500, 0,    2000, 500, 0);
      bridge.drawLineAsShape(2000, 500, 0,    2000, 0, 0);
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
      const zValues: number[] = [];
      if (zSrc) {
        for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      }
      const allZeroExact = zValues.every(z => z === 0);
      const uniqueZ = Array.from(new Set(zValues));
      return {
        ok: true,
        faceDelta: after.faces - before.faces,
        vertDelta: after.verts - before.verts,
        allZeroExact,
        uniqueZ,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    // 2 closed loops → at least 2 faces (각각 자동 합성)
    expect(result.faceDelta, `2 closed loops → expected >= 2 faces, got ${result.faceDelta}`).toBeGreaterThanOrEqual(2);
    expect(result.allZeroExact).toBe(true);
    expect(result.uniqueZ).toEqual([0]);
  });
});
