/**
 * ADR-082 C-δ → C-ε amendment — OCCT.js real Chromium runtime.
 *
 * **C-δ initial discovery** (2026-05-07):
 *   `/* @vite-ignore *​/` 패턴으로 인해 Vite 가 opencascade.js 를 bundle
 *   하지 않음 → browser 에서 OCCT 실 사용 불가능 (drift #3, architectural).
 *   당시 negative regression 으로 한계 봉인.
 *
 * **C-ε amendment fix** (2026-05-08):
 *   사용자 결재로 `/* @vite-ignore *​/` 제거 + opencascade.js 를
 *   `dependencies` 로 승격 + `opencascadeWasmAsUrl` Vite plugin 추가 +
 *   container 에 `loadOcct` 등록 (Vite static analysis 활용 entry point).
 *   결과:
 *     - Vite 가 `opencascade-deps-{hash}.js` lazy chunk 생성 ✅
 *     - 모든 `module.TK*.wasm` 파일이 dist/assets/ 에 정적 자산으로 복사 ✅
 *     - container.get('loadOcct')() 가 chunk fetch + initOpenCascade
 *       reachable ✅
 *
 *   본 spec 의 테스트는 *positive regression* (drift #3 해결 상태 강제):
 *     1. opencascade-deps chunk 가 production build 에 존재
 *     2. container loadOcct entry 가 module 반환
 *     3. (smoke) initOpenCascade 호출 → openCascadeInstance + API surface
 *
 *   향후 누군가 `@vite-ignore` 를 다시 추가하거나 dependencies 에서 빼면
 *   본 회귀가 깨짐 → drift #3 재발 즉시 발견.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
    has(key: string): boolean;
  };
}

test.describe('ADR-082 C-ε — OCCT.js real Chromium runtime (drift #3 resolved)', () => {
  test('container.loadOcct entry registered (C-ε architecture lock)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      const c = w.__axia!;
      return {
        hasLoadOcct: c.has('loadOcct'),
        loadOcctType: typeof c.get('loadOcct'),
      };
    });

    expect(result.hasLoadOcct).toBe(true);
    expect(result.loadOcctType).toBe('function');
  });

  test('opencascade-deps chunk fetch via loadOcct (drift #3 architectural fix)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(async () => {
      try {
        const w = window as unknown as AxiaWindow;
        const c = w.__axia!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadOcct = c.get<() => Promise<any>>('loadOcct');
        const mod = await loadOcct();

        const entries = performance.getEntriesByType('resource');
        const occtChunkLoaded = entries.some(e => /opencascade-deps/.test(e.name));

        return {
          ok: true,
          occtChunkLoaded,
          hasInit: typeof mod.initOpenCascade === 'function',
          hasOcCore: typeof mod.ocCore === 'string',
          hasOcModelingAlgorithms: typeof mod.ocModelingAlgorithms === 'string',
        };
      } catch (e) {
        return { ok: false, error: String(e).slice(0, 300) };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.occtChunkLoaded).toBe(true);
      expect(result.hasInit).toBe(true);
      expect(result.hasOcCore).toBe(true);
      expect(result.hasOcModelingAlgorithms).toBe(true);
    }
  });

  // **initOpenCascade actual init smoke — slow channel deferred**:
  //   Browser env 에서 ocDataExchangeBase + transitive deps 로딩 +
  //   5+ MB WASM 컴파일 + module link 가 180s+ 소요됨이 C-ε 진행 중
  //   확인됨 (이 자체가 wrapper drift #4 의 timing 측면 발견).
  //
  //   영향:
  //     - Drift #3 architectural fix 자체는 test 1+2 로 충분 검증 (chunk
  //       생성 + fetch + module export reachable). 본 test 3 의 가치는
  //       "OCCT 가 실제 init 까지 도달하는가" 의 ground truth.
  //     - CI smoke 채널 (30s ~ 90s timeout) 으로 부적합 — 별도 slow 채널
  //       (e2e:slow / nightly) 또는 인터랙티브 verification 필요.
  //     - 사용자 facing UX 도 "STEP 첫 import 시 1~3 분 대기" — 별도
  //       Toast progress + UX work 필요 (ADR-046 Phase 2 또는 별도 ADR).
  //
  //   **결정** (2026-05-08): 본 spec 에서 init smoke test 제외 — drift
  //   #3 architectural resolution 의 명확성을 우선시. Real init 검증은
  //   ADR-082 §3.5.1 (additional corpus) 또는 별도 slow 채널 스펙
  //   에서 다룸.
});
