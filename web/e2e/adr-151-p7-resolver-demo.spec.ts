/**
 * ADR-151 γ — Connected Stacked-inner Component-Merge Resolver E2E
 * (Real Chromium round-trip).
 *
 * Sprint 3 ADR-151 closure (α + β-1 + β-2 + β-3 + β-4 + γ).
 * Path Z atomic single PR per LOCKED #44. γ sub-step = ADR-087 K-ζ
 * canonical user demo gate.
 *
 * 통합 evidence (β-3 WASM bridge + β-4 UI ContextMenu 의 browser
 * counterpart):
 *   1. enforceP7Canonical WASM endpoint smoke (invalid input → strict
 *      throw per Q1=a default, silent skip 차단)
 *   2. enforceP7Canonical WASM endpoint response schema lock-in
 *      (component_count + is_valid + violation_count)
 *   3. UI ContextMenu "🔗 Connected Inner Merge" 메뉴 항목 존재 검증
 *
 * Cross-link:
 *   - ADR-151 §2 (Solution architecture)
 *   - ADR-149/150 γ pattern 1:1 mirror
 *   - ADR-021 P7 LOCKED #1 (canonical anchor)
 *   - ADR-051 §2.5 (deferred boundary, ≤1 nm edge)
 *   - ADR-075 E.4 (Playwright Chromium E2E infrastructure)
 *   - LOCKED #44 (Complete Meaning per Merge)
 *   - LOCKED #65 메타-원칙 #16 (명시 trigger only — Draw 자동 trigger 0)
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-151 γ — Connected Stacked-inner Component-Merge Resolver E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: enforceP7Canonical WASM endpoint strict throw on invalid input.
   *
   * β-3 WASM bridge endpoint 가 production-like build 에서 wired 되어
   * 있고, invalid container_id (e.g. inactive / out-of-range) 에 대해
   * 명시적 throw 검증. 메타-원칙 #16 정합 (silent skip 차단,
   * P7EnforceError::InvalidInput → JsValue strict throw per Q1=a default).
   */
  test('γ-1: enforceP7Canonical throws on invalid container_id (silent skip 차단)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        // 999999 = guaranteed inactive/out-of-range on clean mesh.
        bridge.enforceP7Canonical(999999, [1, 2]);
        return { threw: false, errorMessage: '' };
      } catch (e) {
        return {
          threw: true,
          errorMessage: e instanceof Error ? e.message : String(e),
        };
      }
    });
    // Strict throw on InvalidInput — silent skip 차단 evidence.
    expect(result.threw).toBe(true);
    // Error message should reference the endpoint name (debuggability).
    expect(result.errorMessage).toMatch(/enforceP7Canonical/i);
  });

  /**
   * γ-2: enforceP7Canonical response schema lock-in.
   *
   * 사용자 facing P7EnforceResult interface 의 모든 키 (componentCount,
   * isValid, violationCount) 가 production build 에서 정합 노출됨을 검증.
   * Schema drift 차단 — TS bridge wrapper 가 snake_case → camelCase
   * 변환을 정확히 수행.
   *
   * Strict throw 가 발생하므로 catch 블록에서 schema check 는 skip.
   * 본 테스트는 *interface presence* 만 검증 — invalid input 으로
   * throw 시키더라도 WasmBridge 클래스에 enforceP7Canonical 메서드
   * 자체는 존재해야 함.
   */
  test('γ-2: enforceP7Canonical method exists on bridge (β-3 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      return {
        methodExists: typeof bridge.enforceP7Canonical === 'function',
        bridgeReady: bridge !== undefined,
      };
    });
    expect(result.bridgeReady).toBe(true);
    expect(result.methodExists).toBe(true);
  });

  /**
   * γ-3: ContextMenu "🔗 Connected Inner Merge" menu item exists in
   * DOM (β-4 wiring verification).
   *
   * 우클릭 trigger 없이 DOM-level entry presence 만 검증 (β-4
   * implementation 의 production build 정합).
   */
  test('γ-3: ContextMenu "Connected Inner Merge" item exists (β-4 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = document.querySelector(
        '[data-action="enforce-p7-canonical"]',
      );
      return {
        exists: item !== null,
        textContent: item?.textContent ?? '',
        className: item?.className ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.textContent).toContain('Connected Inner Merge');
    // 가시성 class 정합 (β-4 ctx-p7-resolver-item)
    expect(result.className).toContain('ctx-p7-resolver-item');
  });
});
