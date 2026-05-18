/**
 * Diagnostic — Line × RECT edge crossing → face 손실 (H2 reproduce).
 *
 * 사용자 결재 (2026-05-19):
 * > "라인 하나에 면을 잃어버립니다"
 * > H2 (Line × RECT edge crossing → split, 자동 split 시 sub-face
 *    재합성 fail) 가 가장 유력
 *
 * ADR-019 P4 (A3) 의 자동 split trigger 결함 evidence:
 * - Line endpoint 가 face boundary loop "위" (vertex 일치 OR edge interior
 *   위 + ε 이내, ε=1.5μm LOCKED #5)
 * - 자동 face split trigger → 양 sub-face 합성
 * - sub-face 합성 fail → orphan / face 손실
 *
 * 본 spec 은 5 scenario 로 line × RECT 교차 case 들을 reproduce + face
 * count 검증.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: { get<T>(key: string): T };
}

test.describe('Line × RECT edge crossing → face 손실 (H2 reproduce)', () => {
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

  test('H2.1: Line crossing 1 RECT edge → 2 sub-face? or face loss?', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // RECT 10×10 at origin (corners: -5000, -5000, 5000, 5000)
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const faceAfterRect = bridge.getStats().faces;

      // Line: 외부 → 내부 (crossing top edge at y=5000)
      // P0: (-3000, 10000, 0) outside RECT (above top edge)
      // P1: (3000, 0, 0) inside RECT
      bridge.drawLineAsShape(-3000, 10000, 0, 3000, 0, 0);
      const faceAfterLine = bridge.getStats().faces;

      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];

      return {
        ok: true,
        faceAfterRect,
        faceAfterLine,
        faceDelta: faceAfterLine - faceAfterRect,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H2.1 line crossing 1 edge]', JSON.stringify(r));
    // Diagnostic — expected: faceDelta 정확치 모름, face loss 가능
    expect(r.faceAfterRect).toBe(1);
  });

  test('H2.2: Line crossing 2 RECT edges (through-line) → 2 sub-face?', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const faceAfterRect = bridge.getStats().faces;

      // Line: through RECT — both endpoints outside, crossing 2 edges (left + right)
      bridge.drawLineAsShape(-10000, 0, 0, 10000, 0, 0);
      const faceAfterLine = bridge.getStats().faces;

      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];

      return {
        ok: true,
        faceAfterRect,
        faceAfterLine,
        faceDelta: faceAfterLine - faceAfterRect,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H2.2 line crossing 2 edges]', JSON.stringify(r));
    expect(r.faceAfterRect).toBe(1);
  });

  test('H2.3: Line endpoint on RECT edge interior (ADR-019 P4 trigger) → split?', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const faceAfterRect = bridge.getStats().faces;

      // Line: P0 ON top edge (interior), P1 ON bottom edge (interior)
      // ADR-019 P4 (A3) trigger — both endpoints on face boundary loop
      bridge.drawLineAsShape(0, 5000, 0, 0, -5000, 0);
      const faceAfterLine = bridge.getStats().faces;

      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];

      return {
        ok: true,
        faceAfterRect,
        faceAfterLine,
        faceDelta: faceAfterLine - faceAfterRect,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H2.3 endpoints on edges]', JSON.stringify(r));
    expect(r.faceAfterRect).toBe(1);
    // ADR-019 P4 (A3) 예상: 2 sub-face split. 실측 결과 보고.
  });

  test('H2.4: Line completely inside RECT (no edge crossing) → no split', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 10000, 10000);
      const faceAfterRect = bridge.getStats().faces;

      // Line: both endpoints strictly inside RECT
      bridge.drawLineAsShape(-2000, 0, 0, 2000, 0, 0);
      const faceAfterLine = bridge.getStats().faces;

      return {
        ok: true,
        faceAfterRect,
        faceAfterLine,
        faceDelta: faceAfterLine - faceAfterRect,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H2.4 line inside no crossing]', JSON.stringify(r));
    // Expected: face delta = 0 (no split, line is free wire)
    expect(r.faceAfterRect).toBe(1);
    expect(r.faceDelta).toBe(0);
  });

  test('H2.5: Line crossing 4 RECTs (사용자 시연 시나리오 유사)', async ({ page }) => {
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = (window as any).__axia.get('bridge');
      // 4 RECT in a row
      for (let i = 0; i < 4; i++) {
        bridge.drawRectAsShape(i * 5000 - 7500, 0, 0, 0, 0, 1, 1, 0, 0, 4000, 4000);
      }
      const faceAfter4Rects = bridge.getStats().faces;

      // Long line crossing all 4 RECTs
      bridge.drawLineAsShape(-15000, 0, 0, 15000, 0, 0);
      const faceAfterLine = bridge.getStats().faces;

      const buf = bridge.getMeshBuffers();
      const uniqueFaceIds = buf ? [...new Set(Array.from(buf.faceMap))] : [];

      return {
        ok: true,
        faceAfter4Rects,
        faceAfterLine,
        faceDelta: faceAfterLine - faceAfter4Rects,
        uniqueFaceIdsInMap: uniqueFaceIds.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[H2.5 line crossing 4 RECTs]', JSON.stringify(r));
    expect(r.faceAfter4Rects).toBeGreaterThanOrEqual(4);
    // 사용자 시연 = face 손실 evidence. faceAfterLine < faceAfter4Rects 이면 H2 confirm.
  });
});
