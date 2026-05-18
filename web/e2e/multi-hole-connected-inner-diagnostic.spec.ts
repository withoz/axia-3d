/**
 * Diagnostic — Multi-hole connected inner reproduce (사용자 시연 evidence).
 *
 * 사용자 결재 (2026-05-19):
 * > "현재 면생성과 분할은 매우 잘됩니다.
 * >  문제는 멀티홀 큰경계안에 몇개의 연속된 홀이 있을때 문제가 됩니다."
 *
 * LOCKED #1 ADR-021 P7 amendment "Deferred boundary" (ADR-051 §2.5):
 * > "connected stacked-inner 의 1 non-manifold edge (shared y=0 boundary)
 * >  는 ADR-051 §2.5 의 component-merge resolver 작업으로 별도 ADR 진행
 * >  — 본 LOCKED 영역 외 future work."
 *
 * 본 diagnostic 은 사용자 시연 시나리오를 *engine + faceMap level*
 * 으로 reproduce + 정확한 face count + 결함 evidence 확보.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

test.describe('Multi-hole connected inner — 사용자 시연 reproduce', () => {
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

  test('D1: Single inner contained (baseline) → 2 face (ring + hole)', async ({ page }) => {
    // Baseline — single inner 잘 됨 (PR #101 stress test S2 PASS)
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Outer ~55×21m
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 55000, 21000);
      // Inner ~30×9m at center
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 30000, 9000);
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: bridge.getStats().faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[D1 single inner]', JSON.stringify(r));
    expect(r.totalFaces).toBeGreaterThanOrEqual(2);
  });

  test('D2: 2 connected inners (adjacent, shared edge) → ?', async ({ page }) => {
    // 사용자 시연: 2 inner RECT 가 *접* (touching, shared edge)
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Outer 55×21m
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 55000, 21000);
      // Inner #1 (left half): -7500 center, 15×9m
      bridge.drawRectAsShape(-7500, 0, 0, 0, 0, 1, 1, 0, 0, 15000, 9000);
      // Inner #2 (right half, touching #1 at x=0): +7500 center, 15×9m
      // shared edge at x=0
      bridge.drawRectAsShape(7500, 0, 0, 0, 0, 1, 1, 0, 0, 15000, 9000);
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: bridge.getStats().faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
        edges: bridge.getStats().edges,
        verts: bridge.getStats().verts,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[D2 connected 2 inners]', JSON.stringify(r));
    // Expected (LOCKED #1 P7 amendment): connected → 1 combined hole
    // → outer ring (1 face with combined hole) + 2 inner simple = 3 face
    // 실측 결과 = 사용자 시연 fail evidence
    // 본 test 는 정확한 face count 측정 — 임시 PASS 로 결과 확인
    if (r.ok) {
      expect(r.totalFaces).toBeGreaterThanOrEqual(0);  // log diagnostic 만
    }
  });

  test('D3: 3 connected inners (adjacent chain) → ?', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 55000, 21000);
      // 3 inners adjacent at y=0
      bridge.drawRectAsShape(-15000, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 9000);
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 9000);
      bridge.drawRectAsShape(15000, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 9000);
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: bridge.getStats().faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[D3 connected 3 inners]', JSON.stringify(r));
    if (r.ok) {
      expect(r.totalFaces).toBeGreaterThanOrEqual(0);
    }
  });

  test('D4: 2 disjoint inners (gap, control) → 3 face (ring + 2 holes)', async ({ page }) => {
    // Control — disjoint inners (PR #101 S2 정합)
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 55000, 21000);
      // Inner #1 (left): -10000, gap to #2
      bridge.drawRectAsShape(-10000, 0, 0, 0, 0, 1, 1, 0, 0, 8000, 9000);
      // Inner #2 (right): +10000, gap from #1 = 4000mm
      bridge.drawRectAsShape(10000, 0, 0, 0, 0, 1, 1, 0, 0, 8000, 9000);
      const buf = bridge.getMeshBuffers();
      if (!buf) return { ok: false };
      const uniqueFaceIds = [...new Set(Array.from(buf.faceMap))];
      return {
        ok: true,
        totalFaces: bridge.getStats().faces,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[D4 disjoint 2 inners]', JSON.stringify(r));
    expect(r.totalFaces).toBeGreaterThanOrEqual(3);
  });
});
