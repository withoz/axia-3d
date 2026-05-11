/**
 * ADR-100 R-ζ — Real Chromium Material Removal Recovery 시연.
 *
 * 검증 contract (production bundle, real Chromium):
 *  1. Default OFF — `axia:auto-material-recovery` localStorage 미설정
 *     시 flag = false (R-E opt-in)
 *  2. Explicit ON preference 보존 across `page.reload()` (ADR-078 P-4
 *     pattern 답습)
 *  3. Bridge surface — `detectOrphanMaterialAssignments` /
 *     `attemptMaterialRemovalRecovery` / `removeProjectMaterial`
 *     production bundle 노출 (ADR-100 R-γ exports drift guard)
 *  4. Clean scene — orchestrator returns `{ skipped: true }` when OFF
 *  5. R-D safety — System tier removal (id 0) rejected via ok envelope
 *
 * 실제 orphan recovery cascade (add Project mat → assign Xia →
 * removeProject) 의 visual demo 는 R-β regression 자산에서 covered.
 * 본 E2E 는 production surface + flag + safety 까지.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-100 R-ζ — Material Removal Recovery contract 검증', () => {
  test('Scenario 1: Default OFF — orchestrator skipped', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.removeItem('axia:auto-material-recovery'),
    );
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(async () => {
      const w = window as unknown as AxiaWindow;
      const runRecovery = w.__axia!.get<() => Promise<unknown>>('materialRecovery');
      const lsValue = localStorage.getItem('axia:auto-material-recovery');
      const out = await runRecovery();
      return { lsValue, out };
    });

    expect(result.lsValue).toBeNull();
    expect(result.out).toEqual({ skipped: true });
  });

  test('Scenario 2: Explicit ON 보존 across page.reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('axia:auto-material-recovery', 'true'),
    );

    // ADR-078 P-4 page.reload pattern
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(async () => {
      const w = window as unknown as AxiaWindow;
      const runRecovery = w.__axia!.get<() => Promise<{ status: string }>>('materialRecovery');
      const out = await runRecovery();
      return {
        lsValue: localStorage.getItem('axia:auto-material-recovery'),
        status: out.status,
      };
    });

    expect(result.lsValue).toBe('true');
    // Clean scene → status='clean' (NoOp 또는 empty orphan report)
    expect(result.status).toBe('clean');
  });

  test('Scenario 3: Bridge surface — 3 endpoints exposed', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      const detect = bridge.detectOrphanMaterialAssignments();
      const recover = bridge.attemptMaterialRemovalRecovery();
      return {
        hasDetect: typeof bridge.detectOrphanMaterialAssignments === 'function',
        hasRecover: typeof bridge.attemptMaterialRemovalRecovery === 'function',
        hasRemove: typeof bridge.removeProjectMaterial === 'function',
        detectShape: detect && typeof detect === 'object'
          ? Object.keys(detect).sort()
          : null,
        recoverKind: recover?.kind ?? null,
      };
    });

    expect(result.hasDetect).toBe(true);
    expect(result.hasRecover).toBe(true);
    expect(result.hasRemove).toBe(true);
    // Clean scene → empty affectedXias, NoOp recovery
    expect(result.detectShape).toEqual(['affectedXias']);
    expect(result.recoverKind).toBe('NoOp');
  });

  test('Scenario 4: R-D safety — System tier removal rejected (id 0)', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Try removing System tier material id 0 (Concrete) — must reject.
      const removeOut = bridge.removeProjectMaterial(0);
      // System tier still has 12 built-ins.
      const systemCount = bridge.listMaterialsByTier('System').length;
      const concreteStillExists = bridge.getMaterialTier(0) === 'System';

      return { removeOut, systemCount, concreteStillExists };
    });

    expect(result.removeOut.ok).toBe(false);
    expect(result.removeOut.error).toContain('System');
    expect(result.systemCount).toBe(12);
    expect(result.concreteStillExists).toBe(true);
  });

  test('Scenario 5: Add Project mat + remove (no Xia) → NoOp recovery', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Add a Project material (no Xia assigned).
      const projId = bridge.addProjectMaterial('Disposable', 'Disposable', 0xff8800);
      // Remove via convenience entry — no orphan because no Xia uses it.
      const removeOut = bridge.removeProjectMaterial(projId);
      // Verify cleanup.
      const tierAfter = bridge.getMaterialTier(projId); // null
      const projectCount = bridge.listMaterialsByTier('Project').length;

      return {
        projId,
        removeOk: removeOut.ok,
        removedId: removeOut.removedId,
        recoveryKind: removeOut.recovery?.kind,
        tierAfter,
        projectCount,
      };
    });

    expect(result.removeOk).toBe(true);
    expect(result.removedId).toBe(result.projId);
    expect(result.recoveryKind).toBe('NoOp');
    expect(result.tierAfter).toBeNull();
    expect(result.projectCount).toBe(0);
  });
});
