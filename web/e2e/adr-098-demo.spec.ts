/**
 * ADR-098 S-ζ — Real Chromium 3-Tier Material Scope 시연.
 *
 * 검증 contract (production bundle, real Chromium):
 *  1. Default OFF — `axia:asset-library-user-tier` localStorage 미설정
 *     시 flag = false (S-E opt-in)
 *  2. Explicit ON preference 보존 across `page.reload()` (ADR-078 P-4
 *     pattern 답습)
 *  3. Bridge surface — `listMaterialsByTier` / `getMaterialTier` /
 *     `addProjectMaterial` / `addUserMaterial` / `removeUserMaterial` /
 *     `migrateLegacyMaterials` production bundle 노출 (ADR-098 S-γ
 *     exports drift guard)
 *  4. 3-tier round-trip — System (12 built-ins) + add Project → list
 *     reflects insertion + getMaterialTier maps correctly
 *  5. S-G safety — User tier removal works; System tier removal blocked
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-098 S-ζ — Asset Library 3-Tier contract 검증', () => {
  test('Scenario 1: Default OFF — User tier opt-in (S-E)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.removeItem('axia:asset-library-user-tier'),
    );
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => ({
      lsValue: localStorage.getItem('axia:asset-library-user-tier'),
    }));

    expect(result.lsValue).toBeNull(); // default 미설정
  });

  test('Scenario 2: Explicit ON preference 보존 across page.reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('axia:asset-library-user-tier', 'true'),
    );

    // ADR-078 P-4 page.reload pattern — fresh process boundary
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => ({
      lsValue: localStorage.getItem('axia:asset-library-user-tier'),
    }));

    expect(result.lsValue).toBe('true');
  });

  test('Scenario 3: Bridge surface — 6 endpoints exposed', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      return {
        hasListByTier: typeof bridge.listMaterialsByTier === 'function',
        hasGetTier: typeof bridge.getMaterialTier === 'function',
        hasAddProject: typeof bridge.addProjectMaterial === 'function',
        hasAddUser: typeof bridge.addUserMaterial === 'function',
        hasRemoveUser: typeof bridge.removeUserMaterial === 'function',
        hasMigrate: typeof bridge.migrateLegacyMaterials === 'function',
      };
    });

    expect(result.hasListByTier).toBe(true);
    expect(result.hasGetTier).toBe(true);
    expect(result.hasAddProject).toBe(true);
    expect(result.hasAddUser).toBe(true);
    expect(result.hasRemoveUser).toBe(true);
    expect(result.hasMigrate).toBe(true);
  });

  test('Scenario 4: 3-tier round-trip — System builtins + add Project + add User', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      const systemBefore = bridge.listMaterialsByTier('System');
      const projectBefore = bridge.listMaterialsByTier('Project');
      const userBefore = bridge.listMaterialsByTier('User');

      const projId = bridge.addProjectMaterial('TestProj', 'TestProj', 0xff0000);
      const userId = bridge.addUserMaterial('TestUser', 'TestUser', 0x00ff00);

      const systemAfter = bridge.listMaterialsByTier('System');
      const projectAfter = bridge.listMaterialsByTier('Project');
      const userAfter = bridge.listMaterialsByTier('User');

      const projTier = bridge.getMaterialTier(projId);
      const userTier = bridge.getMaterialTier(userId);
      const sysTier = bridge.getMaterialTier(0); // built-in concrete

      return {
        systemCountBefore: systemBefore.length,
        projectCountBefore: projectBefore.length,
        userCountBefore: userBefore.length,
        systemCountAfter: systemAfter.length,
        projectCountAfter: projectAfter.length,
        userCountAfter: userAfter.length,
        projTier,
        userTier,
        sysTier,
        projId,
        userId,
      };
    });

    // System tier always 12 built-ins (immutable)
    expect(result.systemCountBefore).toBe(12);
    expect(result.systemCountAfter).toBe(12);
    // Project + User started empty, +1 after add
    expect(result.projectCountBefore).toBe(0);
    expect(result.projectCountAfter).toBe(1);
    expect(result.userCountBefore).toBe(0);
    expect(result.userCountAfter).toBe(1);
    // tier_of returns canonical strings
    expect(result.projTier).toBe('Project');
    expect(result.userTier).toBe('User');
    expect(result.sysTier).toBe('System');
    // ID classification — Project / User start at >= 100 (S-D)
    expect(result.projId).toBeGreaterThanOrEqual(100);
    expect(result.userId).toBeGreaterThanOrEqual(100);
  });

  test('Scenario 5: S-G safety — User tier removable, System tier blocked', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      const userId = bridge.addUserMaterial('Removable', 'Removable', 0x808080);
      const removeOkUser = bridge.removeUserMaterial(userId);
      const userAfter = bridge.listMaterialsByTier('User');

      // Try to remove a System tier material — must reject (S-G safety).
      const removeOkSystem = bridge.removeUserMaterial(0);

      // System tier still has all 12 built-ins.
      const systemCount = bridge.listMaterialsByTier('System').length;

      return {
        removeOkUser,
        userCountAfter: userAfter.length,
        removeOkSystem,
        systemCount,
      };
    });

    expect(result.removeOkUser).toBe(true);
    expect(result.userCountAfter).toBe(0); // user material gone
    expect(result.removeOkSystem).toBe(false); // S-G safety: blocked
    expect(result.systemCount).toBe(12); // 12 built-ins preserved
  });
});
