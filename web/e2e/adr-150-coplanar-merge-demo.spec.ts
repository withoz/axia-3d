/**
 * ADR-150 γ — 자동 Coplanar Face Merge Sweep E2E (Real Chromium round-trip).
 *
 * Sprint 3 ADR-150 closure (α + β-1 + β-2 + β-3 + β-4 + γ).
 * Path Z atomic single PR per LOCKED #44. γ sub-step = ADR-087 K-ζ
 * canonical user demo gate.
 *
 * 통합 evidence (β-3 WASM bridge + β-4 UI ContextMenu 의 browser
 * counterpart):
 *   1. sweepCoplanarPairs WASM endpoint smoke (clean mesh → empty array)
 *   2. mergeCoplanarPairBatch WASM endpoint smoke (empty array → no-op
 *      success)
 *   3. UI ContextMenu "🧹 Coplanar 면 일괄 자동 정리" 메뉴 항목 존재 검증
 *
 * Cross-link:
 *   - ADR-150 §2 (Solution architecture)
 *   - ADR-149 γ pattern 1:1 mirror
 *   - ADR-006 C1 Phase F (coplanar containing merge anchor)
 *   - ADR-075 E.4 (Playwright Chromium E2E infrastructure)
 *   - LOCKED #44 (Complete Meaning per Merge)
 *   - LOCKED #65 메타-원칙 #16 (명시 trigger only)
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-150 γ — 자동 Coplanar Face Merge Sweep E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: sweepCoplanarPairs WASM endpoint smoke (clean mesh).
   *
   * β-3 WASM bridge endpoint 가 production-like build 에서 wired 되어
   * 있고, empty mesh 에서 빈 array 반환 검증. ADR-149 γ-1 패턴 1:1
   * mirror (read-only API + graceful fallback).
   */
  test('γ-1: sweepCoplanarPairs returns empty array for clean mesh', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        const pairs = bridge.sweepCoplanarPairs();
        return {
          succeeded: true,
          pairCount: pairs.length,
          isArray: Array.isArray(pairs),
          error: '',
        };
      } catch (e) {
        return {
          succeeded: false,
          pairCount: -1,
          isArray: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
    // Read-only API + graceful fallback — should always succeed.
    expect(result.succeeded).toBe(true);
    expect(result.isArray).toBe(true);
    // Clean mesh (empty `/` route) — 0 coplanar pairs expected.
    expect(result.pairCount).toBe(0);
  });

  /**
   * γ-2: mergeCoplanarPairBatch WASM endpoint smoke (empty array → no-op).
   *
   * β-3 WASM bridge endpoint 의 batch behavior 검증. Empty input array
   * → BatchMergeReport with mergedCount=0, skippedCount=0. 메타-원칙 #16
   * 정합 (silent skip 차단 via report fields).
   */
  test('γ-2: mergeCoplanarPairBatch handles empty input (no-op success)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        const report = bridge.mergeCoplanarPairBatch([]);
        return {
          succeeded: true,
          mergedCount: report.mergedCount,
          skippedCount: report.skippedCount,
          newFaceIdsLength: report.newFaceIds.length,
          error: '',
        };
      } catch (e) {
        return {
          succeeded: false,
          mergedCount: -1,
          skippedCount: -1,
          newFaceIdsLength: -1,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
    expect(result.succeeded).toBe(true);
    expect(result.mergedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.newFaceIdsLength).toBe(0);
  });

  /**
   * γ-3: ContextMenu "🧹 Coplanar 면 일괄 자동 정리" menu item exists in
   * DOM (β-4 wiring verification).
   *
   * 우클릭 trigger 없이 DOM-level entry presence 만 검증 (β-4
   * implementation 의 production build 정합).
   */
  test('γ-3: ContextMenu "Coplanar 면 일괄 자동 정리" item exists (β-4 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = document.querySelector(
        '[data-action="heal-coplanar-pairs"]',
      );
      return {
        exists: item !== null,
        textContent: item?.textContent ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.textContent).toContain('Coplanar');
  });
});
