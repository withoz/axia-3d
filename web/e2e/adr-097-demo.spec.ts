/**
 * ADR-097 T-ζ — Real Chromium topology recovery 시연.
 *
 * 검증 contract (production bundle, real Chromium):
 *  1. Default OFF — `axia:auto-topology-recovery` localStorage 미설정
 *     시 flag = false, container.get('topologyRecovery')() → skipped
 *  2. Explicit ON preference 보존 (`localStorage 'true'`)
 *  3. Bridge surface — `detectTopologyDamage` + `attemptAutoRecovery`
 *     production bundle 노출 (ADR-097 T-δ exports drift guard)
 *  4. Clean scene — orchestrator ON + clean mesh → status='clean',
 *     dialog 미표시
 *
 * 손상 mesh 생성 시연 은 production engine 의 외부 노출 op 만으로는
 * 강제 불가 (defensive guards 가 사용자 facing path 차단). 실제
 * PartialFailure dialog 검증은 Rust unit test (T-γ regression) 가
 * 정합 — 본 demo 는 surface + flag + clean path 까지.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-097 T-ζ — topology recovery contract 검증', () => {
  test('Scenario 1: Default OFF — localStorage 미설정 시 orchestrator skipped', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.removeItem('axia:auto-topology-recovery'),
    );
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(async () => {
      const w = window as unknown as AxiaWindow;
      const runRecovery = w.__axia!.get<() => Promise<unknown>>('topologyRecovery');
      const lsValue = localStorage.getItem('axia:auto-topology-recovery');
      const out = await runRecovery();
      return { lsValue, out };
    });

    expect(result.lsValue).toBeNull(); // default 미설정
    expect(result.out).toEqual({ skipped: true });
  });

  test('Scenario 2: Explicit ON preference 보존 — orchestrator runs on clean scene', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('axia:auto-topology-recovery', 'true'),
    );
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(async () => {
      const w = window as unknown as AxiaWindow;
      const runRecovery = w.__axia!.get<() => Promise<{ status: string; initialDamages: number }>>('topologyRecovery');
      const out = await runRecovery();
      return {
        lsValue: localStorage.getItem('axia:auto-topology-recovery'),
        status: out.status,
        initialDamages: out.initialDamages,
      };
    });

    expect(result.lsValue).toBe('true');
    expect(result.status).toBe('clean');
    expect(result.initialDamages).toBe(0);
  });

  test('Scenario 3: Bridge surface — detectTopologyDamage + attemptAutoRecovery 노출', async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      const detect = bridge.detectTopologyDamage();
      const recover = bridge.attemptAutoRecovery();
      return {
        hasDetect: typeof bridge.detectTopologyDamage === 'function',
        hasRecover: typeof bridge.attemptAutoRecovery === 'function',
        detectShape: detect && typeof detect === 'object'
          ? Object.keys(detect).sort()
          : null,
        recoverKind: recover?.kind ?? null,
      };
    });

    expect(result.hasDetect).toBe(true);
    expect(result.hasRecover).toBe(true);
    // Clean scene → empty damages array, NoOp recovery
    expect(result.detectShape).toEqual(['checkedEdges', 'checkedFaces', 'damages']);
    expect(result.recoverKind).toBe('NoOp');
  });

  test('Scenario 4: Flag toggle persists across page.reload (process boundary)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('axia:auto-topology-recovery', 'true'),
    );

    // ADR-078 P-4 page.reload pattern — fresh process boundary
    // verification (진짜 explicit ON preference 보존).
    await page.reload();
    await waitForBridgeReady(page);

    const result = await page.evaluate(async () => {
      const w = window as unknown as AxiaWindow;
      const runRecovery = w.__axia!.get<() => Promise<{ status: string }>>('topologyRecovery');
      const out = await runRecovery();
      return {
        lsValue: localStorage.getItem('axia:auto-topology-recovery'),
        // OFF default 였다면 skipped:true 가 와야 하는데 ON 보존 →
        // status 'clean' (clean scene 의 NoOp 경로)
        ranThrough: 'status' in out,
        status: out.status,
      };
    });

    expect(result.lsValue).toBe('true');
    expect(result.ranThrough).toBe(true);
    expect(result.status).toBe('clean');
  });
});
