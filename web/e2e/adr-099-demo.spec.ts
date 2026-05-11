/**
 * ADR-099 L-η — Real Chromium Layered Material 시연.
 *
 * **마지막 sub-step — closure 시 LOCKED #26 5-Phase 로드맵 완전 closure**.
 *
 * 검증 contract (production bundle, real Chromium):
 *  1. Bridge surface — 5 L-γ endpoints production bundle 노출
 *  2. Set/Get round-trip — albedo 채널 set → get → 검증
 *  3. Clear normalization — 마지막 채널 clear → hasLayered=false
 *  4. Multi-channel — 4 채널 set → has=true → get all 4
 *  5. Migrate helper — idempotent count, normalize empty payload
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-099 L-η — Layered Material contract 검증', () => {
  test('Scenario 1: Bridge surface — 5 endpoints exposed', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      return {
        hasGet: typeof bridge.getLayeredChannels === 'function',
        hasSet: typeof bridge.setLayeredChannel === 'function',
        hasClear: typeof bridge.clearLayeredChannel === 'function',
        hasMigrate: typeof bridge.migrateLegacyTextureToLayered === 'function',
        hasCheck: typeof bridge.hasLayeredMaterial === 'function',
      };
    });

    expect(result.hasGet).toBe(true);
    expect(result.hasSet).toBe(true);
    expect(result.hasClear).toBe(true);
    expect(result.hasMigrate).toBe(true);
    expect(result.hasCheck).toBe(true);
  });

  test('Scenario 2: Set + Get round-trip (albedo only)', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Create a Project material.
      const matId = bridge.addProjectMaterial('TestLayered', 'TestLayered', 0xc0c0c0);

      // Initial state: no layered.
      const before = bridge.hasLayeredMaterial(matId);

      // Set albedo channel.
      const setOk = bridge.setLayeredChannel(matId, 'albedo', {
        dataUrl: 'data:image/png;base64,ALBEDO',
        projection: 'planar',
        scale: 0.001,
        rotation: 0,
        label: 'test_albedo.png',
      });

      const after = bridge.hasLayeredMaterial(matId);
      const channels = bridge.getLayeredChannels(matId);

      return {
        matId,
        before, setOk, after,
        albedoUrl: channels?.albedo?.dataUrl,
        albedoLabel: channels?.albedo?.label,
        normalUndef: channels?.normal === undefined,
      };
    });

    expect(result.before).toBe(false);
    expect(result.setOk).toBe(true);
    expect(result.after).toBe(true);
    expect(result.albedoUrl).toBe('data:image/png;base64,ALBEDO');
    expect(result.albedoLabel).toBe('test_albedo.png');
    expect(result.normalUndef).toBe(true);
  });

  test('Scenario 3: Clear normalization — last channel → hasLayered=false', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      const matId = bridge.addProjectMaterial('ClearTest', 'ClearTest', 0x808080);
      bridge.setLayeredChannel(matId, 'normal', {
        dataUrl: 'd:n', projection: 'planar', scale: 0.001,
      });
      const hasAfterSet = bridge.hasLayeredMaterial(matId);
      const clearOk = bridge.clearLayeredChannel(matId, 'normal');
      const hasAfterClear = bridge.hasLayeredMaterial(matId);
      const layeredAfterClear = bridge.getLayeredChannels(matId);

      return { hasAfterSet, clearOk, hasAfterClear, layeredAfterClear };
    });

    expect(result.hasAfterSet).toBe(true);
    expect(result.clearOk).toBe(true);
    expect(result.hasAfterClear).toBe(false);
    expect(result.layeredAfterClear).toBeNull();
  });

  test('Scenario 4: Multi-channel — all 4 set + get', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      const matId = bridge.addProjectMaterial('FullPBR', 'FullPBR', 0xffffff);
      const channels = ['albedo', 'normal', 'roughness', 'metallic'];
      const projections = ['planar', 'box', 'cylindrical', 'planar'];
      for (let i = 0; i < channels.length; i++) {
        bridge.setLayeredChannel(matId, channels[i], {
          dataUrl: `data:_,${channels[i].toUpperCase()}`,
          projection: projections[i],
          scale: 0.001 * (i + 1),
        });
      }

      const has = bridge.hasLayeredMaterial(matId);
      const all = bridge.getLayeredChannels(matId);
      return {
        has,
        urls: [
          all?.albedo?.dataUrl,
          all?.normal?.dataUrl,
          all?.roughness?.dataUrl,
          all?.metallic?.dataUrl,
        ],
        projections: [
          all?.albedo?.projection,
          all?.normal?.projection,
          all?.roughness?.projection,
          all?.metallic?.projection,
        ],
      };
    });

    expect(result.has).toBe(true);
    expect(result.urls).toEqual([
      'data:_,ALBEDO', 'data:_,NORMAL', 'data:_,ROUGHNESS', 'data:_,METALLIC',
    ]);
    expect(result.projections).toEqual([
      'planar', 'box', 'cylindrical', 'planar',
    ]);
  });

  test('Scenario 5: Migrate helper is idempotent', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Fresh scene — nothing to migrate.
      const first = bridge.migrateLegacyTextureToLayered();
      const second = bridge.migrateLegacyTextureToLayered();
      return { first, second };
    });

    expect(result.first).toBe(0);
    expect(result.second).toBe(0); // idempotent
  });
});
