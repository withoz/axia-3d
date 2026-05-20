/**
 * E2E regression — 모든 그리기 도구에서 z=0 plane 면분할 정합.
 *
 * 사용자 결재 (2026-05-18, post-closed-loop face synthesis):
 * > "기본으로 그리면 z=0 같은 면에서 그려집니다. 기본으로 그리기를 할때
 * >  면생성 면분할이 정확히 되는지 확인 해주세요" - "모든 그리기도구에서"
 *
 * 두 가지 면분할 시나리오:
 *   (A) Containment (LOCKED #1 ADR-021 P7) — outer face 안에 inner closed loop
 *       → ring + hole 패턴 (combined-perimeter 자동)
 *   (B) Partial overlap (LOCKED #41 ADR-101) — 두 face 의 z=0 coplanar 부분 겹침
 *       → 자동 3 sub-face (face_a only / lens / face_b only)
 *
 * 검증 매트릭스 (real Chromium):
 *
 *   Containment (A) — outer × inner:
 *     A1: RECT × inner RECT → 2 faces (ring + hole)
 *     A2: RECT × inner Circle (polygon) → 2 faces
 *     A3: RECT × inner 4-Line loop → 2 faces (line tool inner)
 *     A4: 4-Line outer × inner RECT → 2 faces (line tool outer)
 *
 *   Partial overlap (B) — cross-tool:
 *     B4: 4-Line square × 4-Line square → 3 sub-faces (line cross-tool)
 *     B5: RECT × 4-Line square (cross-tool) → 3 sub-faces
 *
 *   (B1: RECT×RECT / B2: Circle×Circle / B3: PathB×PathB 은 ADR-101 §B-6
 *    에서 이미 cover — 본 spec 은 그것 위에 cross-tool 확장)
 *
 * Anchor:
 *   - LOCKED #1 ADR-021 P7 (Closed Edge Loop Divides Face)
 *   - LOCKED #41 ADR-101 (Coplanar Partial Overlap Auto-Intersect)
 *   - LOCKED #15 메타-원칙 #15 (동일 분할 = 동일 topological contract)
 *   - LOCKED #43 ADR-103 (Z-up, Z=0 ground plane)
 *
 * 모든 vertex z=0 cardinal plane 정합 강제 (LOCKED #7 SSOT).
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
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
}

// Helper — draw a closed square via 4 drawLineAsShape calls (z=0).
function drawSquareViaLines(
  bridge: BridgeShim,
  x: number, y: number, w: number, h: number,
): void {
  bridge.drawLineAsShape(x,     y,     0, x + w, y,     0);
  bridge.drawLineAsShape(x + w, y,     0, x + w, y + h, 0);
  bridge.drawLineAsShape(x + w, y + h, 0, x,     y + h, 0);
  bridge.drawLineAsShape(x,     y + h, 0, x,     y,     0);
}

test.describe('z=0 face split — all drawing tools (LOCKED #1 P7 + LOCKED #41)', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-1 + B-β-2 (2026-05-18): auto-intersect + auto-face-
    // synthesis default OFF. Legacy LOCKED #41 ADR-101 auto-split +
    // LOCKED #12 P11 Line cycle 자동 face 합성 동작 검증 — explicit opt-in.
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
    const r = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia?.get<any>('bridge');
      return { ready: !!bridge?.isReady?.() };
    });
    expect(r.ready).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════
  // (A) Containment — LOCKED #1 ADR-021 P7
  // ════════════════════════════════════════════════════════════════════

  test('A1: RECT outer + RECT inner (contained) → 2 faces (ring + hole)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      // Outer 10m × 10m, centered at (0,0,0)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const afterOuter = bridge.getStats().faces;
      // Inner 2m × 2m, centered at (0,0,0) — fully contained
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 2000);
      const afterInner = bridge.getStats().faces;
      return {
        outerDelta: afterOuter - before,
        innerDelta: afterInner - afterOuter,
        totalAfter: afterInner,
      };
    });
    expect(result.outerDelta).toBe(1);
    // P7 containment: inner draw splits outer face → 1 face added (sub-face)
    expect(result.innerDelta, `Inner RECT in outer → expected +1 sub-face, got ${result.innerDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.totalAfter).toBeGreaterThanOrEqual(2);
  });

  test('A2: RECT outer + Circle inner (contained) → 2 faces (ring + hole)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const afterOuter = bridge.getStats().faces;
      // Inner circle r=1m at origin
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1000, 32);
      const afterInner = bridge.getStats().faces;
      return {
        outerDelta: afterOuter - before,
        innerDelta: afterInner - afterOuter,
        totalAfter: afterInner,
      };
    });
    expect(result.outerDelta).toBe(1);
    expect(result.innerDelta, `Inner Circle in outer → expected +1, got ${result.innerDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.totalAfter).toBeGreaterThanOrEqual(2);
  });

  test('A3: RECT outer + 4-Line inner loop → 2 faces (line tool inner)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const afterOuter = bridge.getStats().faces;
      // 4-line inner square (centered, 2m × 2m → -1000..+1000)
      bridge.drawLineAsShape(-1000, -1000, 0,  1000, -1000, 0);
      bridge.drawLineAsShape( 1000, -1000, 0,  1000,  1000, 0);
      bridge.drawLineAsShape( 1000,  1000, 0, -1000,  1000, 0);
      bridge.drawLineAsShape(-1000,  1000, 0, -1000, -1000, 0);
      const afterInner = bridge.getStats().faces;
      return {
        outerDelta: afterOuter - before,
        innerDelta: afterInner - afterOuter,
        totalAfter: afterInner,
      };
    });
    expect(result.outerDelta).toBe(1);
    expect(result.innerDelta, `Inner 4-Line loop in outer → expected +1, got ${result.innerDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.totalAfter).toBeGreaterThanOrEqual(2);
  });

  test('A4: 4-Line outer + RECT inner → 2 faces (line tool outer container)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      // 4-line outer square (10m × 10m)
      bridge.drawLineAsShape(-5000, -5000, 0,  5000, -5000, 0);
      bridge.drawLineAsShape( 5000, -5000, 0,  5000,  5000, 0);
      bridge.drawLineAsShape( 5000,  5000, 0, -5000,  5000, 0);
      bridge.drawLineAsShape(-5000,  5000, 0, -5000, -5000, 0);
      const afterOuter = bridge.getStats().faces;
      // Inner RECT 2m × 2m at center
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 2000);
      const afterInner = bridge.getStats().faces;
      return {
        outerDelta: afterOuter - before,
        innerDelta: afterInner - afterOuter,
        totalAfter: afterInner,
      };
    });
    // Outer 4 lines should form 1 face (LOCKED #12 P11)
    expect(result.outerDelta, `4-Line outer → expected 1 face, got ${result.outerDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.innerDelta, `Inner RECT in 4-Line outer → expected +1, got ${result.innerDelta}`).toBeGreaterThanOrEqual(1);
    expect(result.totalAfter).toBeGreaterThanOrEqual(2);
  });

  // ════════════════════════════════════════════════════════════════════
  // (B) Partial overlap (cross-tool) — LOCKED #41 ADR-101
  // ════════════════════════════════════════════════════════════════════

  test('B4: 4-Line square × 4-Line square partial overlap → 3 sub-faces', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      // Square A: (0,0) to (10000, 10000)
      bridge.drawLineAsShape(0, 0, 0,         10000, 0, 0);
      bridge.drawLineAsShape(10000, 0, 0,     10000, 10000, 0);
      bridge.drawLineAsShape(10000, 10000, 0, 0, 10000, 0);
      bridge.drawLineAsShape(0, 10000, 0,     0, 0, 0);
      const afterA = bridge.getStats().faces;
      // Square B: (5000, 5000) to (15000, 15000) — partial overlap
      bridge.drawLineAsShape(5000, 5000, 0,    15000, 5000, 0);
      bridge.drawLineAsShape(15000, 5000, 0,   15000, 15000, 0);
      bridge.drawLineAsShape(15000, 15000, 0,  5000, 15000, 0);
      bridge.drawLineAsShape(5000, 15000, 0,   5000, 5000, 0);
      const afterB = bridge.getStats().faces;
      return {
        aDelta: afterA - before,
        bDelta: afterB - afterA,
        totalAfter: afterB,
      };
    });
    expect(result.aDelta).toBe(1);
    // ADR-101 partial overlap: 2nd closed loop creates lens + retains both face_a/face_b → 3 faces total
    expect(result.bDelta, `4-Line × 4-Line partial overlap → expected +2 (to get 3 total), got ${result.bDelta}`).toBeGreaterThanOrEqual(2);
    expect(result.totalAfter).toBeGreaterThanOrEqual(3);
  });

  test('B5: RECT × 4-Line square (cross-tool) partial overlap → 3 sub-faces', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      // RECT A: 10m × 10m centered at (5000, 5000)
      bridge.drawRectAsShape(5000, 5000, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const afterA = bridge.getStats().faces;
      // 4-Line square B: (5000, 5000) to (15000, 15000) — partial overlap
      bridge.drawLineAsShape(5000, 5000, 0,    15000, 5000, 0);
      bridge.drawLineAsShape(15000, 5000, 0,   15000, 15000, 0);
      bridge.drawLineAsShape(15000, 15000, 0,  5000, 15000, 0);
      bridge.drawLineAsShape(5000, 15000, 0,   5000, 5000, 0);
      const afterB = bridge.getStats().faces;
      return {
        aDelta: afterA - before,
        bDelta: afterB - afterA,
        totalAfter: afterB,
      };
    });
    expect(result.aDelta).toBe(1);
    expect(result.bDelta, `RECT × 4-Line cross-tool overlap → expected +2 (total 3), got ${result.bDelta}`).toBeGreaterThanOrEqual(2);
    expect(result.totalAfter).toBeGreaterThanOrEqual(3);
  });

  // ════════════════════════════════════════════════════════════════════
  // (C) Multi-inner (P7 stacked-inner sweep, LOCKED #1)
  // ════════════════════════════════════════════════════════════════════

  test('C1: RECT outer + 2 disjoint inner RECTs → 3 faces (ring + 2 holes)', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      const before = bridge.getStats().faces;
      // Outer 20m × 10m centered (0,0,0)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 20000, 10000);
      const afterOuter = bridge.getStats().faces;
      // Inner 1: 2m × 2m at (-5000, 0)
      bridge.drawRectAsShape(-5000, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 2000);
      // Inner 2: 2m × 2m at (5000, 0) — disjoint from inner 1
      bridge.drawRectAsShape(5000, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 2000);
      const afterInners = bridge.getStats().faces;
      return {
        outerDelta: afterOuter - before,
        innerDelta: afterInners - afterOuter,
        totalAfter: afterInners,
      };
    });
    expect(result.outerDelta).toBe(1);
    // P7 multi-inner: 2 disjoint inners → 2 sub-faces
    expect(result.innerDelta, `2 disjoint inners → expected +2, got ${result.innerDelta}`).toBeGreaterThanOrEqual(2);
    expect(result.totalAfter).toBeGreaterThanOrEqual(3);
  });

  // ════════════════════════════════════════════════════════════════════
  // (D) z=0 invariant preservation across split (LOCKED #7 + #43)
  // ════════════════════════════════════════════════════════════════════

  test('D1: After P7 split, all resulting verts remain z=0', async ({ page }) => {
    test.setTimeout(30_000);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge') as BridgeShim;
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      bridge.drawRectAsShape(2500, 2500, 0, 0, 0, 1, 1, 0, 0, 5000, 5000);  // partial overlap
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zSrc = (buf as any).positionsF64 ?? buf.positions;
      const zValues: number[] = [];
      for (let i = 2; i < zSrc.length; i += 3) zValues.push(zSrc[i]);
      const uniqueZ = Array.from(new Set(zValues));
      const allZero = zValues.every(z => z === 0);
      return { ok: true, vertCount: zValues.length, allZero, uniqueZ };
    });
    expect(result.ok).toBe(true);
    expect(result.allZero, `After split, expected all z=0, got uniqueZ=${result.uniqueZ?.join(',')}`).toBe(true);
    expect(result.uniqueZ).toEqual([0]);
  });
});
