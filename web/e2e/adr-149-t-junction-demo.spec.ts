/**
 * ADR-149 γ — T-junction Sweep 명시 도구 E2E (Real Chromium round-trip).
 *
 * Sprint 3 ADR-149 closure (α + β-1 + β-2 + β-3 + β-4 + γ).
 * Path Z atomic single PR per LOCKED #44. γ sub-step = ADR-087 K-ζ
 * canonical user demo gate.
 *
 * 통합 evidence (β-3 WASM bridge + β-4 UI ContextMenu 의 browser
 * counterpart):
 *   1. detectTJunctions WASM endpoint smoke (clean mesh → empty array)
 *   2. healTJunction WASM endpoint smoke (invalid report → strict throw)
 *   3. UI ContextMenu "T-junction 정리" 메뉴 항목 존재 검증 (β-4 wiring)
 *
 * Cross-link:
 *   - ADR-149 §2 (Solution architecture)
 *   - ADR-148 γ pattern 1:1 mirror
 *   - ADR-139 (LOCKED #64 Boundary tool — predecessor pattern)
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

test.describe('ADR-149 γ — T-junction Sweep 명시 도구 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: detectTJunctions WASM endpoint smoke (clean mesh).
   *
   * β-3 WASM bridge endpoint 가 production-like build 에서 wired 되어
   * 있고, empty mesh 에서 빈 array 반환 검증. ADR-148 γ-1 smoke 패턴
   * 1:1 mirror (read-only API).
   */
  test('γ-1: detectTJunctions returns empty array for clean mesh', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        const reports = bridge.detectTJunctions();
        return {
          succeeded: true,
          reportCount: reports.length,
          isArray: Array.isArray(reports),
          error: '',
        };
      } catch (e) {
        return {
          succeeded: false,
          reportCount: -1,
          isArray: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
    // Read-only API + graceful fallback — should always succeed.
    expect(result.succeeded).toBe(true);
    expect(result.isArray).toBe(true);
    // Clean mesh (empty `/` route) — 0 T-junctions expected.
    expect(result.reportCount).toBe(0);
  });

  /**
   * γ-2: healTJunction WASM endpoint smoke (strict throw on invalid).
   *
   * β-3 WASM bridge endpoint 의 strict-throw 정합 검증. Invalid report
   * (out-of-range face_id) → InvalidReport error. 메타-원칙 #16 정합
   * (silent skip 차단).
   */
  test('γ-2: healTJunction rejects invalid report (strict throw)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        bridge.healTJunction({
          faceId: 999_999,    // out-of-range
          edgeId: 0,
          vertexId: 0,
          tAlongEdge: 0.5,
        });
        return { threw: false, message: '' };
      } catch (e) {
        return {
          threw: true,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    });
    expect(result.threw).toBe(true);
    // Engine error format: "healTJunction: InvalidReport (...)"
    expect(result.message).toContain('healTJunction');
    // β-2 validation: InvalidReport (face_active=false because 999_999
    // is out-of-range).
    expect(result.message).toMatch(/InvalidReport|VertexNotOnEdge/);
  });

  /**
   * γ-3: ContextMenu "T-junction 정리" menu item exists in DOM (β-4
   * wiring verification).
   *
   * 우클릭 trigger 없이 DOM-level entry presence 만 검증 (β-4
   * implementation 의 production build 정합).
   */
  test('γ-3: ContextMenu "T-junction 정리" item exists (β-4 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = document.querySelector(
        '[data-action="heal-t-junctions"]',
      );
      return {
        exists: item !== null,
        textContent: item?.textContent ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.textContent).toContain('T-junction 정리');
  });
});
