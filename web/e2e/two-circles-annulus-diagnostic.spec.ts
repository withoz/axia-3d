/**
 * Diagnostic — 두 원 사이 face (annulus) 만들기 reproduce.
 *
 * 사용자 결재 (2026-05-19):
 * > "우리 엔진으로 두원사이에 페이스 만드는 방법은?"
 *
 * 현재 AxiA 엔진의 가능 path 자동 reproduce:
 *   - Path 1: DrawCircleAsShape × 2 (containment) → P7 자동 ring + hole
 *   - Path 1 variant: Cross-tool (Rect outer + Circle inner)
 *   - Path B: drawCircleAsCurve × 2 (kernel-native)
 *   - Path B mixed: outer asShape + inner asCurve
 *   - 사용자 화면 정확 reproduce (큰 원 + 작은 원 contained)
 *
 * 각 scenario:
 *   - bridge.drawCircleAsShape / drawCircleAsCurve 직접 호출
 *   - face count 측정 (engine 측)
 *   - faceMap distinct face_ids 분석
 *   - inner_loops 보존 여부 (multi-loop face evidence)
 *
 * Anchor:
 *   - LOCKED #1 ADR-021 P7 (containment auto-split)
 *   - LOCKED #12 ADR-025 P11 (닫힌 엣지 = 면)
 *   - ADR-089 (closed-curve Path B)
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

test.describe('Two circles annulus — 두 원 사이 face 만들기 reproduce', () => {
  test.beforeEach(async ({ page }) => {
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

  test('C1: DrawCircleAsShape × 2 (containment) → P7 ring + hole + inner simple', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Outer circle r=5000mm at origin
      const outerShape = bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 5000, 32);
      const afterOuter = bridge.getStats().faces;
      // Inner circle r=1500mm at origin (contained)
      const innerShape = bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1500, 32);
      const afterInner = bridge.getStats().faces;
      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];
      return {
        ok: true,
        outerShape,
        innerShape,
        afterOuter,
        afterInner,
        deltaOuter: afterOuter,
        deltaInner: afterInner - afterOuter,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C1 Path 1 — DrawCircleAsShape × 2]', JSON.stringify(r));
    expect(r.afterOuter).toBe(1);
    // P7 containment: outer ring + inner = 2 faces minimum
    expect(r.afterInner).toBeGreaterThanOrEqual(2);
  });

  test('C2: Cross-tool Rect outer + Circle inner (containment) → ring + hole', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Outer Rect 10×10
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const afterOuter = bridge.getStats().faces;
      // Inner Circle r=1500mm contained
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1500, 32);
      const afterInner = bridge.getStats().faces;
      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];
      return {
        ok: true,
        afterOuter,
        afterInner,
        deltaInner: afterInner - afterOuter,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C2 Cross-tool Rect outer + Circle inner]', JSON.stringify(r));
    expect(r.afterOuter).toBe(1);
    expect(r.afterInner).toBeGreaterThanOrEqual(2);
  });

  test('C3: drawCircleAsCurve × 2 (Path B both) → kernel-native containment', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Path B outer
      const outerShape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5000);
      const afterOuter = bridge.getStats().faces;
      // Path B inner contained
      const innerShape = bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 1500);
      const afterInner = bridge.getStats().faces;
      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];
      return {
        ok: true,
        outerShape,
        innerShape,
        afterOuter,
        afterInner,
        deltaInner: afterInner - afterOuter,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C3 Path B × 2 — drawCircleAsCurve × 2]', JSON.stringify(r));
    expect(r.outerShape).toBeGreaterThanOrEqual(0);
    expect(r.innerShape).toBeGreaterThanOrEqual(0);
    expect(r.afterInner).toBeGreaterThanOrEqual(2);
  });

  test('C4: 사용자 화면 reproduce — 두 원 (outer 5000mm + inner 1500mm)', async ({ page }) => {
    // 사용자 시연 시나리오 정확 reproduce (큰 원 + 작은 원 contained)
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // DrawCircleAsShape 두 번 (가장 일반적 path)
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 5000, 32);
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1500, 32);
      const stats = bridge.getStats();
      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];
      return {
        ok: true,
        faces: stats.faces,
        edges: stats.edges,
        verts: stats.verts,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C4 사용자 시연 reproduce]', JSON.stringify(r));
    expect(r.faces).toBeGreaterThanOrEqual(2);
  });

  test('C5: Mixed Path B + AsShape (kernel-native outer + polygon inner)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Path B outer
      bridge.drawCircleAsCurve(0, 0, 0, 0, 0, 1, 5000);
      const afterOuter = bridge.getStats().faces;
      // Polygon inner contained
      bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1500, 32);
      const afterInner = bridge.getStats().faces;
      return {
        ok: true,
        afterOuter,
        afterInner,
        deltaInner: afterInner - afterOuter,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C5 Mixed Path B outer + polygon inner]', JSON.stringify(r));
    expect(r.afterOuter).toBeGreaterThanOrEqual(1);
  });

  test('C6: Disjoint two circles (control — no containment)', async ({ page }) => {
    // Control — 두 원이 *분리* 시 자연 작동 확인
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawCircleAsShape(-5000, 0, 0, 0, 0, 1, 2000, 32);
      bridge.drawCircleAsShape(5000, 0, 0, 0, 0, 1, 2000, 32);
      const stats = bridge.getStats();
      return {
        ok: true,
        faces: stats.faces,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[C6 Disjoint two circles]', JSON.stringify(r));
    expect(r.faces).toBe(2);  // 2 independent simple faces
  });
});
