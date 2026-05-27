/**
 * E2E regression — z=0 plane drawing coplanarity verification.
 *
 * 사용자 결재 (2026-05-18, post-ADR-135 closure):
 * > "기본으로 그릴때는 z=0 에 반드시 그려집니다. 다른 그리기 도구에서도
 * >  마찬가지입니다. 정확히 z=0에 그려져서 같은 면이 되어야 합니다."
 *
 * 검증 매트릭스 (real Chromium, post-ADR-103 Z-up + post-ADR-026 P12
 * cardinal snap SSOT):
 *   1. drawRectAsShape   → 4 vert z=0 정확
 *   2. drawLineAsShape   → 2 vert z=0 정확
 *   3. drawCircleAsShape → N vert z=0 정확 (polygonal)
 *   4. drawCircleAsCurve → 1 vert z=0 정확 (Path B kernel-native)
 *   5. drawPolylineAsShape → N vert z=0 정확
 *   6. Cross-tool coplanarity → 모든 vert exactly z=0 → coplanar
 *
 * Anchor: LOCKED #7 ADR-026 P12 (cardinal snap SSOT) + LOCKED #43 ADR-103
 * (Z-up — XY ground = Z=0 plane).
 *
 * 정확성 기준: positionsF64 (CAD-grade precision) 의 z 좌표가 *정확히*
 * 0.0 (== 0, not approximate). Cardinal snap (`|z| < 1e-4 → z = 0`,
 * ADR-147 Scenario B1) 이 모든 draw API 에 적용되어야.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
  };
}

interface BridgeShim {
  isReady?: () => boolean;
  getStats: () => { faces: number; verts: number; edges: number };
  drawRectAsShape: (
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    w: number, h: number,
  ) => number;
  drawLineAsShape: (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    nx?: number, ny?: number, nz?: number,
  ) => number;
  drawCircleAsShape: (
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ) => number;
  drawCircleAsCurve: (
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number,
  ) => number;
  drawPolylineAsShape: (
    points: Float64Array,
    normal?: { x: number; y: number; z: number },
  ) => number;
  getMeshBuffers: () => {
    positions: Float32Array;
    positionsF64?: Float64Array;
  } | null;
  newProject?: () => void;
  resetEngine?: () => void;
}

async function setupBridge(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as AxiaWindow).__axia,
    undefined,
    { timeout: 10_000 },
  );
}

async function getBridge(page: import('@playwright/test').Page): Promise<{
  ready: boolean;
  reason?: string;
}> {
  return page.evaluate(() => {
    const w = window as unknown as AxiaWindow;
    const c = w.__axia;
    if (!c) return { ready: false, reason: 'no __axia' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = c.get<any>('bridge');
    if (!bridge) return { ready: false, reason: 'no bridge' };
    if (!bridge.isReady?.()) return { ready: false, reason: 'WASM not ready' };
    return { ready: true };
  });
}

test.describe('z=0 plane drawing coplanarity (LOCKED #7 + #43)', () => {
  test.beforeEach(async ({ page }) => {
    await setupBridge(page);
    const r = await getBridge(page);
    expect(r.ready, r.reason).toBe(true);
  });

  test('drawRectAsShape at z=0 → all 4 vert z exactly 0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      const shapeRaw = bridge.drawRectAsShape(
        0, 0, 0,        // center on z=0 plane
        0, 0, 1,        // normal +Z
        1, 0, 0,        // basis_u +X
        1000, 1000,     // 1m × 1m
      );
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh buffers', shapeRaw };
      const f64 = buf.positionsF64;
      const f32 = buf.positions;
      // Collect all z values
      const zSrc = f64 ?? f32;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const allZeroExact = zValues.every(z => z === 0);
      const maxAbsZ = zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
      return {
        ok: true,
        shapeRaw,
        faceDelta: after.faces - before.faces,
        vertCount: zValues.length,
        allZeroExact,
        maxAbsZ,
        precisionMode: f64 ? 'f64' : 'f32',
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.shapeRaw).toBeGreaterThanOrEqual(0);
    expect(result.faceDelta).toBeGreaterThanOrEqual(1);
    expect(result.vertCount).toBeGreaterThanOrEqual(4);
    // CRITICAL: exact zero (LOCKED #7 cardinal snap SSOT)
    expect(result.allZeroExact, `maxAbsZ=${result.maxAbsZ}, mode=${result.precisionMode}`).toBe(true);
    expect(result.maxAbsZ).toBe(0);
  });

  test('drawLineAsShape at z=0 → 2 vert z exactly 0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      // Free-edge: nx=ny=nz=0
      const shapeRaw = bridge.drawLineAsShape(
        0, 0, 0,        // p0
        1000, 0, 0,     // p1 (1m along +X)
      );
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      if (!buf) {
        // Free-edge may produce 0 mesh face → fallback to vert delta
        return {
          ok: true,
          shapeRaw,
          vertDelta: after.verts - before.verts,
          fallbackNoMesh: true,
        };
      }
      const zSrc = buf.positionsF64 ?? buf.positions;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const allZeroExact = zValues.every(z => z === 0);
      const maxAbsZ = zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
      return {
        ok: true,
        shapeRaw,
        vertDelta: after.verts - before.verts,
        vertCount: zValues.length,
        allZeroExact,
        maxAbsZ,
        fallbackNoMesh: false,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.shapeRaw).toBeGreaterThanOrEqual(0);
    if (!result.fallbackNoMesh) {
      expect(result.allZeroExact, `maxAbsZ=${result.maxAbsZ}`).toBe(true);
      expect(result.maxAbsZ).toBe(0);
    } else {
      // At least verify vert delta is reasonable
      expect(result.vertDelta).toBeGreaterThanOrEqual(2);
    }
  });

  test('drawCircleAsShape at z=0 → all N vert z exactly 0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      const shapeRaw = bridge.drawCircleAsShape(
        0, 0, 0,        // center on z=0
        0, 0, 1,        // normal +Z
        500, 24,        // r=500mm, 24 segments
      );
      const after = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh buffers', shapeRaw };
      const zSrc = buf.positionsF64 ?? buf.positions;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const allZeroExact = zValues.every(z => z === 0);
      const maxAbsZ = zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
      return {
        ok: true,
        shapeRaw,
        faceDelta: after.faces - before.faces,
        vertCount: zValues.length,
        allZeroExact,
        maxAbsZ,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.shapeRaw).toBeGreaterThanOrEqual(0);
    expect(result.faceDelta).toBeGreaterThanOrEqual(1);
    expect(result.vertCount).toBeGreaterThanOrEqual(24);
    expect(result.allZeroExact, `maxAbsZ=${result.maxAbsZ}`).toBe(true);
    expect(result.maxAbsZ).toBe(0);
  });

  test('drawCircleAsCurve (Path B) at z=0 → 1 anchor vert z exactly 0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats();
      const shapeRaw = bridge.drawCircleAsCurve(
        0, 0, 0,        // center on z=0
        0, 0, 1,        // normal +Z
        500,            // r=500mm
      );
      const after = bridge.getStats();
      const vertDelta = after.verts - before.verts;
      const buf = bridge.getMeshBuffers();
      const zSrc = buf ? (buf.positionsF64 ?? buf.positions) : null;
      const zValues: number[] = [];
      if (zSrc) {
        for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      }
      // Path B render path uses chord-tolerant tessellation; visual verts
      // may be many but the DCEL anchor vert is just 1.
      const maxAbsZ = zValues.length > 0
        ? zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0)
        : 0;
      const allZeroExact = zValues.every(z => z === 0);
      return {
        ok: true,
        shapeRaw,
        vertDelta,
        allZeroExact,
        maxAbsZ,
        vertCount: zValues.length,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.shapeRaw).toBeGreaterThanOrEqual(0);
    // Path B = 1 anchor vert + render tessellation (visual only)
    expect(result.vertDelta).toBeGreaterThanOrEqual(1);
    if (result.vertCount > 0) {
      expect(result.allZeroExact, `maxAbsZ=${result.maxAbsZ}`).toBe(true);
      expect(result.maxAbsZ).toBe(0);
    }
  });

  test('Cross-tool coplanarity: Rect + Circle on z=0 → all vert exactly z=0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      // Draw Rect on z=0
      const rectShape = bridge.drawRectAsShape(
        2000, 0, 0,     // center
        0, 0, 1,        // normal +Z
        1, 0, 0,        // basis_u +X
        1000, 1000,
      );
      // Draw Circle on z=0 (different location)
      const circShape = bridge.drawCircleAsShape(
        -2000, 0, 0,    // center
        0, 0, 1,        // normal +Z
        500, 24,
      );
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh buffers' };
      const zSrc = buf.positionsF64 ?? buf.positions;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const allZeroExact = zValues.every(z => z === 0);
      const maxAbsZ = zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
      const uniqueZ = Array.from(new Set(zValues));
      return {
        ok: true,
        rectShape,
        circShape,
        vertCount: zValues.length,
        allZeroExact,
        maxAbsZ,
        uniqueZ: uniqueZ.slice(0, 10),  // truncate for log
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.rectShape).toBeGreaterThanOrEqual(0);
    expect(result.circShape).toBeGreaterThanOrEqual(0);
    expect(result.vertCount).toBeGreaterThanOrEqual(28);  // 4 + 24
    // CRITICAL: cross-tool coplanarity invariant
    expect(result.allZeroExact, `maxAbsZ=${result.maxAbsZ}, uniqueZ=${result.uniqueZ.join(',')}`).toBe(true);
    expect(result.maxAbsZ).toBe(0);
    expect(result.uniqueZ).toEqual([0]);
  });

  test('Sub-tol input (z=0.00005mm) gets snapped to exact 0', async ({ page }) => {
    test.setTimeout(30_000);
    // Verify cardinal snap actually works — input slightly off (within
    // 1e-4 mm tol, ADR-147 Scenario B1) → output exactly 0. This is the
    // SSOT contract. Pre-ADR-147 fixture used z=0.0005 (0.5μm) within old
    // 1μm tol; updated to z=0.00005 (0.05μm) within new 0.1μm tol.
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const shapeRaw = bridge.drawRectAsShape(
        0, 0, 0.00005,  // z = 0.05μm (sub-tol, ADR-147 Scenario B1)
        0, 0, 1,        // normal +Z
        1, 0, 0,
        1000, 1000,
      );
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false, reason: 'no mesh buffers', shapeRaw };
      const zSrc = buf.positionsF64 ?? buf.positions;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const allZeroExact = zValues.every(z => z === 0);
      const maxAbsZ = zValues.reduce((m, z) => Math.max(m, Math.abs(z)), 0);
      return {
        ok: true,
        shapeRaw,
        vertCount: zValues.length,
        allZeroExact,
        maxAbsZ,
      };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.shapeRaw).toBeGreaterThanOrEqual(0);
    // Sub-tol z=0.00005 (0.05μm) should snap to exactly 0 — within new
    // 0.1μm CARDINAL_SNAP_TOL (ADR-147 Scenario B1).
    expect(result.allZeroExact, `cardinal snap failed: maxAbsZ=${result.maxAbsZ}`).toBe(true);
    expect(result.maxAbsZ).toBe(0);
  });
});
