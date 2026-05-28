/**
 * ADR-164 γ — Auto Plane Detection (Sticky Last Drawn Plane) E2E
 * (Real Chromium round-trip).
 *
 * ADR-164 closure (α + β-1 + β-2 + β-3 + γ). Path Z atomic single PR
 * per LOCKED #44. γ sub-step = ADR-087 K-ζ canonical user demo gate.
 *
 * 통합 evidence (β-1 API + β-2 Draw hooks + β-3 UI wiring 의 browser
 * counterpart):
 *   1. ToolManager API smoke (setLastDrawnPlane / getLastDrawnPlane /
 *      clearLastDrawnPlane / notifyViewModeChange — β-1 wiring)
 *   2. ContextMenu "📐 기본 평면으로" 메뉴 항목 존재 검증 (β-3 wiring)
 *   3. StatusBar #sb-plane-badge 요소 존재 검증 (β-3 wiring)
 *
 * Cross-link:
 *   - ADR-164 §3 (β implementation phases)
 *   - ADR-149/150/151 γ pattern 1:1 mirror
 *   - ADR-140 (Surface-Aware getDrawPlane — 우선순위 #2 보존)
 *   - ADR-075 E.4 (Playwright Chromium E2E infrastructure)
 *   - LOCKED #44 (Complete Meaning per Merge)
 *   - LOCKED #65 메타-원칙 #5/#16 (사용자 편의 + 명시 trigger)
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-164 γ — Auto Plane Detection (Sticky Last Drawn Plane) E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: ToolManager sticky API smoke (β-1 wiring verification).
   *
   * Production-like build 에서 `setLastDrawnPlane / getLastDrawnPlane /
   * clearLastDrawnPlane / notifyViewModeChange` 모두 wired 검증.
   * In-memory session-only state (L-164-1) — `setLastDrawnPlane(plane)`
   * → `getLastDrawnPlane()` returns plane → `clearLastDrawnPlane()` →
   * `getLastDrawnPlane()` returns null.
   */
  test('γ-1: ToolManager sticky API smoke (β-1 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = w.__axia!.get<any>('toolManager');
      if (!tm) return { hasToolManager: false };

      // 1. All 4 methods exist (β-1 API surface)
      const apiPresent = {
        set: typeof tm.setLastDrawnPlane === 'function',
        get: typeof tm.getLastDrawnPlane === 'function',
        clear: typeof tm.clearLastDrawnPlane === 'function',
        notify: typeof tm.notifyViewModeChange === 'function',
      };
      // 2. Initial state: null (L-164-1, in-memory)
      const initialNull = tm.getLastDrawnPlane() === null;

      // 3. setLastDrawnPlane → getLastDrawnPlane round-trip
      // Use viewport to obtain THREE.Vector3 (viewport.activeCamera.position
      // is a real Vector3 — clone() returns proper Vector3 instance).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewport = w.__axia!.get<any>('viewport');
      const sample = viewport?.activeCamera?.position;
      if (!sample || typeof sample.clone !== 'function') {
        return {
          hasToolManager: true,
          apiPresent,
          initialNull,
          afterSet: false,
          afterClear: false,
          missingVector3: true,
        };
      }
      // Construct three Vector3-like by cloning the camera position
      const makeVec = (x: number, y: number, z: number) => {
        const v = sample.clone();
        v.set(x, y, z);
        return v;
      };
      tm.setLastDrawnPlane({
        origin: makeVec(5, 5, 5),
        normal: makeVec(0, 0, 1),
        up: makeVec(0, 1, 0),
        source: 'view',
      });
      const afterSet = tm.getLastDrawnPlane() !== null;

      // 4. clearLastDrawnPlane → null
      tm.clearLastDrawnPlane();
      const afterClear = tm.getLastDrawnPlane() === null;

      return {
        hasToolManager: true,
        apiPresent,
        initialNull,
        afterSet,
        afterClear,
        missingVector3: false,
      };
    });

    expect(result.hasToolManager).toBe(true);
    expect(result.apiPresent?.set).toBe(true);
    expect(result.apiPresent?.get).toBe(true);
    expect(result.apiPresent?.clear).toBe(true);
    expect(result.apiPresent?.notify).toBe(true);
    expect(result.initialNull).toBe(true);
    expect(result.afterSet).toBe(true);
    expect(result.afterClear).toBe(true);
  });

  /**
   * γ-2: ContextMenu "📐 기본 평면으로" menu item exists in DOM
   * (β-3 wiring verification).
   *
   * 우클릭 trigger 없이 DOM-level entry presence + visibility class
   * 검증.
   */
  test('γ-2: ContextMenu "기본 평면으로" item exists (β-3 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = document.querySelector(
        '[data-action="reset-last-drawn-plane"]',
      );
      return {
        exists: item !== null,
        textContent: item?.textContent ?? '',
        className: item?.className ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.textContent).toContain('기본 평면으로');
    // 가시성 class 정합 (β-3 ctx-plane-reset-item)
    expect(result.className).toContain('ctx-plane-reset-item');
  });

  /**
   * γ-3: StatusBar `#sb-plane-badge` element exists in DOM
   * (β-3 wiring verification).
   *
   * Initial state: hidden (display:none). ToolManager 가 setLastDrawnPlane
   * 호출 시 display 토글 + label update (β-3 updateLastDrawnPlaneBadge).
   * ADR-164 메타-원칙 #5 (사용자 편의 — 명확하면 자동) 정합.
   */
  test('γ-3: StatusBar #sb-plane-badge element exists (β-3 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const badge = document.getElementById('sb-plane-badge') as HTMLElement | null;
      return {
        exists: badge !== null,
        initiallyHidden: badge?.style.display === 'none',
        adrAttr: badge?.getAttribute('data-adr') ?? '',
        textContent: badge?.textContent ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.initiallyHidden).toBe(true);
    expect(result.adrAttr).toBe('164');
    expect(result.textContent).toContain('평면');
  });
});
