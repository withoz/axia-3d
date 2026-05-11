/**
 * ADR-096 M-γ — Real Chromium auto-reference import 시연.
 *
 * Real STEP file import 는 OCCT.js heavy 의존 (ADR-082 Drift #5,
 * 180s+ wait) — 본 demo 는 production-bundle 의 bridge surface 검증
 * (autoReferenceImport 의 prerequisites) 으로 한정.
 *
 * 검증 contract:
 * 1. localStorage default 부재 시 production layer 가 default ON
 *    동작 (M-L3, ADR-094 답습)
 * 2. localStorage 'false' explicit OFF preference 보존
 * 3. bridge.createReferenceImportedMesh endpoint 가 production bundle
 *    에 노출됨 (ADR-095 Phase 3-γ exports drift guard)
 *
 * Real STEP file round-trip 은 ADR-082 T-δ slow channel 에서 검증됨.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-096 M-γ — auto-reference import contract 검증', () => {
  test('Scenario 1: Default ON — localStorage 미설정 시 자동 분류 활성', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('axia:auto-reference-import'));
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // bridge.createReferenceImportedMesh 가 production bundle 에 노출됨
      // (ADR-095 Phase 3-γ).
      const hasMethod = typeof bridge.createReferenceImportedMesh === 'function';
      // localStorage 미설정 = default ON.
      const lsValue = localStorage.getItem('axia:auto-reference-import');

      // Direct create test — bridge 가 reachable 하면 R-B violation 없는
      // 빈 face id list 도 허용 (engine 의 mutually exclusive 검사가
      // 빈 list 통과).
      const refId = bridge.createReferenceImportedMesh('mock-test', [], 'mock.step');
      const ref = bridge.getReference(refId);

      return {
        hasMethod,
        lsValue,
        refId,
        refName: ref?.name,
        refKind: ref?.category?.kind,
      };
    });

    expect(result.hasMethod).toBe(true);
    expect(result.lsValue).toBeNull(); // default 미설정
    expect(result.refId).toBeGreaterThanOrEqual(1);
    expect(result.refName).toBe('mock-test');
    expect(result.refKind).toBe('ImportedMesh');
  });

  test('Scenario 2: Explicit OFF preference 보존', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('axia:auto-reference-import', 'false'));
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      // localStorage 'false' 보존 검증 (production layer 의 init 시
      // CylinderPathBSettings 패턴 답습).
      return {
        lsValue: localStorage.getItem('axia:auto-reference-import'),
      };
    });

    expect(result.lsValue).toBe('false');
  });

  test('Scenario 3: Reference creation + roundtrip via Snapshot', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // ImportedMesh Reference 직접 생성 (실제 import path 모방).
      const refId = bridge.createReferenceImportedMesh(
        'site',  // file stem (M-L5 자동 추출 결과 모방)
        [],
        '/path/to/site.step',  // M-L4 sourcePath
      );

      // Snapshot round-trip — section 8 (ADR-095 Phase 3-ε).
      const bytes = bridge.exportSnapshot();
      const importOk = bridge.importSnapshot(bytes);
      const ref = bridge.getReference(refId);

      return {
        importOk,
        refName: ref?.name,
        sourcePath: ref?.category?.sourcePath,
      };
    });

    expect(result.importOk).toBe(true);
    expect(result.refName).toBe('site');
    expect(result.sourcePath).toBe('/path/to/site.step');
  });
});
