/**
 * ADR-166 γ — Active Sketch Plane Session Lock E2E
 * (Real Chromium round-trip).
 *
 * ADR-166 closure (α + β-1 + β-2 + β-3 + γ). Path Z atomic single PR
 * per LOCKED #44. γ sub-step = ADR-087 K-ζ canonical user demo gate.
 *
 * 통합 evidence (β-1 API + β-2 Draw hooks + β-3 priority/UI 의 browser
 * counterpart):
 *   γ-1 ToolManager plane lock API smoke (β-1 wiring)
 *   γ-2 ContextMenu "🔓 평면 잠금 해제" 메뉴 항목 존재 검증 (β-3 wiring)
 *   γ-3 Ctrl+Shift+P 단축키 wiring 검증 (β-3 wiring, browser dispatch)
 *
 * Cross-link:
 *   - ADR-166 §3 (β implementation phases) + ADR-164 γ pattern 1:1 mirror
 *   - ADR-140 (Surface-Aware getDrawPlane — 우선순위 #2)
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

test.describe('ADR-166 γ — Active Sketch Plane Session Lock E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: ToolManager plane lock API smoke (β-1 wiring verification).
   *
   * Production-like build 에서 `lockPlane / unlockPlane / isPlaneLocked /
   * getPlaneLock` 모두 wired 검증. **Cross-tool 보존 evidence** —
   * `setTool('rect')` → `setTool('circle')` 가 lock state UNCHANGED.
   */
  test('γ-1: ToolManager plane lock API smoke + cross-tool 유지 (β-1 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = w.__axia!.get<any>('toolManager');
      if (!tm) return { hasToolManager: false };

      // 1. All 4 methods exist (β-1 API surface)
      const apiPresent = {
        lock: typeof tm.lockPlane === 'function',
        unlock: typeof tm.unlockPlane === 'function',
        isLocked: typeof tm.isPlaneLocked === 'function',
        getLock: typeof tm.getPlaneLock === 'function',
      };
      // 2. Initial state: unlocked (L-166-1)
      const initialUnlocked = tm.isPlaneLocked() === false;

      // 3. Vector3 sample via viewport camera (proper THREE.Vector3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewport = w.__axia!.get<any>('viewport');
      const sample = viewport?.activeCamera?.position;
      if (!sample || typeof sample.clone !== 'function') {
        return {
          hasToolManager: true,
          apiPresent,
          initialUnlocked,
          afterLock: false,
          afterToolChange: false,
          afterUnlock: false,
          missingVector3: true,
        };
      }
      const makeVec = (x: number, y: number, z: number) => {
        const v = sample.clone();
        v.set(x, y, z);
        return v;
      };

      // 4. lockPlane → isPlaneLocked true
      tm.lockPlane({
        origin: makeVec(1, 2, 3),
        normal: makeVec(0, 0, 1),
        up: makeVec(0, 1, 0),
        source: 'first_click',
      });
      const afterLock = tm.isPlaneLocked() === true;

      // 5. Cross-tool 유지 evidence — setTool 보존 (L-166-2 핵심)
      tm.setTool('rect');
      tm.setTool('circle');
      tm.setTool('line');
      const afterToolChange = tm.isPlaneLocked() === true;

      // 6. unlockPlane → isPlaneLocked false
      tm.unlockPlane();
      const afterUnlock = tm.isPlaneLocked() === false;

      return {
        hasToolManager: true,
        apiPresent,
        initialUnlocked,
        afterLock,
        afterToolChange,
        afterUnlock,
        missingVector3: false,
      };
    });

    expect(result.hasToolManager).toBe(true);
    expect(result.apiPresent?.lock).toBe(true);
    expect(result.apiPresent?.unlock).toBe(true);
    expect(result.apiPresent?.isLocked).toBe(true);
    expect(result.apiPresent?.getLock).toBe(true);
    expect(result.initialUnlocked).toBe(true);
    expect(result.afterLock).toBe(true);
    expect(result.afterToolChange).toBe(true);  // **cross-tool evidence**
    expect(result.afterUnlock).toBe(true);
  });

  /**
   * γ-2: ContextMenu "🔓 평면 잠금 해제" menu item exists in DOM
   * (β-3 wiring verification).
   *
   * 우클릭 trigger 없이 DOM-level entry presence + visibility class
   * 검증. Initial visibility hidden (lock 미활성 시).
   */
  test('γ-2: ContextMenu "평면 잠금 해제" item exists (β-3 wiring)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const item = document.querySelector(
        '[data-action="unlock-plane-lock"]',
      );
      return {
        exists: item !== null,
        textContent: item?.textContent ?? '',
        className: item?.className ?? '',
      };
    });
    expect(result.exists).toBe(true);
    expect(result.textContent).toContain('평면 잠금 해제');
    expect(result.textContent).toContain('Ctrl+Shift+P');
    // 가시성 class 정합 (β-3 ctx-plane-lock-unlock-item)
    expect(result.className).toContain('ctx-plane-lock-unlock-item');
  });

  /**
   * γ-3: Ctrl+Shift+P keyboard shortcut wiring (β-3 wiring verification).
   *
   * Lock activate → Ctrl+Shift+P → unlock. Real browser keyboard
   * dispatch via Playwright `page.keyboard.press`.
   */
  test('γ-3: Ctrl+Shift+P shortcut unlocks plane lock (β-3 wiring)', async ({ page }) => {
    // Setup: lock plane via API
    const setupOk = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = w.__axia!.get<any>('toolManager');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewport = w.__axia!.get<any>('viewport');
      const sample = viewport?.activeCamera?.position;
      if (!tm || !sample || typeof sample.clone !== 'function') return false;
      const makeVec = (x: number, y: number, z: number) => {
        const v = sample.clone();
        v.set(x, y, z);
        return v;
      };
      tm.lockPlane({
        origin: makeVec(0, 0, 0),
        normal: makeVec(0, 0, 1),
        up: makeVec(0, 1, 0),
        source: 'first_click',
      });
      return tm.isPlaneLocked() === true;
    });
    expect(setupOk).toBe(true);

    // Press Ctrl+Shift+P (real browser keyboard dispatch)
    await page.keyboard.press('Control+Shift+P');

    // Verify: lock released
    const afterUnlock = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tm = w.__axia!.get<any>('toolManager');
      return tm?.isPlaneLocked();
    });
    expect(afterUnlock).toBe(false);
  });
});
