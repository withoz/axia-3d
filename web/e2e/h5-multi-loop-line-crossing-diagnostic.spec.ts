/**
 * Diagnostic — H5: Multi-loop face (containment) + line crossing → face loss.
 *
 * 사용자 결재 (2026-05-19):
 * > H2 자체는 OK 확인 후 H5 hypothesis: "Multi-loop face + line crossing
 *    → split 결함" 진행
 *
 * 사용자 시연 화면 정확 reproduce:
 * - 큰 RECT + inner RECTs (containment → multi-loop)
 * - 가로 line crossing → multi-loop face 의 split 결함
 *
 * LOCKED #1 P7 amendment "Multi-loop face 도구 정책 (Push/Pull / Boolean /
 * Offset / hole boundary fillet → 거부)" + ADR-101 의 multi-loop scope
 * 정합.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

test.describe('H5: Multi-loop face + line crossing → face loss reproduce', () => {
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

  test('H5.1: Outer + inner contained (multi-loop ring + hole) + line crossing outer', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // Outer 10×10 (no inner yet — simple face)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const a = bridge.getStats().faces;
      // Inner 3×3 contained — creates ring + hole (multi-loop)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 3000, 3000);
      const b = bridge.getStats().faces;
      // Line crossing outer (through-line)
      bridge.drawLineAsShape(-10000, 3000, 0, 10000, 3000, 0);
      const c = bridge.getStats().faces;
      return {
        ok: true,
        afterOuter: a,
        afterInner: b,
        afterLine: c,
        deltaInner: b - a,
        deltaLine: c - b,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H5.1 ring + hole + line crossing outer]', JSON.stringify(r));
    expect(r.afterOuter).toBe(1);
  });

  test('H5.2: Outer + inner + line crossing both (through ring AND hole)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 3000, 3000);
      const before = bridge.getStats().faces;
      // Line through both outer and inner (passes through center)
      bridge.drawLineAsShape(-10000, 0, 0, 10000, 0, 0);
      const after = bridge.getStats().faces;
      return {
        ok: true,
        before,
        after,
        delta: after - before,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H5.2 line through ring AND hole]', JSON.stringify(r));
    expect(r.before).toBeGreaterThanOrEqual(2);  // ring + hole
  });

  test('H5.3: Outer + 2 inner adjacent (connected stacked) + line crossing', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 20000, 10000);
      // 2 adjacent inners (LOCKED #1 P7 amendment deferred case)
      bridge.drawRectAsShape(-3000, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      bridge.drawRectAsShape(3000, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      const before = bridge.getStats().faces;
      // Line crossing through
      bridge.drawLineAsShape(-15000, 1500, 0, 15000, 1500, 0);
      const after = bridge.getStats().faces;
      return {
        ok: true,
        before,
        after,
        delta: after - before,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H5.3 multi-loop adjacent inners + line]', JSON.stringify(r));
  });

  test('H5.4: 사용자 시연 정확 reproduce — large vertical RECT + 2 inners + horizontal line', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // 사용자 화면 우측 시나리오:
      // - 큰 세로 RECT (대략 5000 wide × 15000 tall)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 5000, 15000);
      const a = bridge.getStats().faces;
      // - 작은 inner RECT 위쪽 (~1000×800)
      bridge.drawRectAsShape(0, 4000, 0, 0, 0, 1, 1, 0, 0, 1000, 800);
      const b = bridge.getStats().faces;
      // - 작은 inner RECT 가운데 (~1000×2000)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1000, 2000);
      const c = bridge.getStats().faces;
      // - 작은 inner RECT 아래 (~1000×300)
      bridge.drawRectAsShape(0, -4000, 0, 0, 0, 1, 1, 0, 0, 1000, 300);
      const d = bridge.getStats().faces;
      // - 가로 line crossing the vertical RECT (사용자 화면의 가로 line)
      bridge.drawLineAsShape(-10000, -2000, 0, 10000, -2000, 0);
      const e = bridge.getStats().faces;
      return {
        ok: true,
        afterOuter: a,
        afterInner1: b,
        afterInner2: c,
        afterInner3: d,
        afterLine: e,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H5.4 사용자 시연 reproduce]', JSON.stringify(r));
  });

  test('H5.5 — Edge case: line endpoint coincides with inner RECT corner', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      const before = bridge.getStats().faces;
      // Line endpoint exactly at inner RECT corner (2000, 2000)
      bridge.drawLineAsShape(2000, 2000, 0, 10000, 2000, 0);
      const after = bridge.getStats().faces;
      return {
        ok: true,
        before,
        after,
        delta: after - before,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H5.5 line endpoint at inner corner]', JSON.stringify(r));
  });
});
