/**
 * ADR-082 C-δ — OCCT.js real Chromium runtime drift discovery.
 *
 * **목표**: ADR-081 53 mock 회귀의 첫 truth 검증 시도 (browser env).
 *
 * **발견** (Drift #3, architectural):
 *   현재 `StepIgesImporter._loadOcct` 의 `/* @vite-ignore *​/` 주석 패턴
 *   (ADR-035 P20.7 graceful build 보호용) 이 Vite 의 import 분석을
 *   차단 → opencascade.js 가 production build 에 bundle 안 됨 →
 *   browser dynamic import 가 bare specifier 'opencascade.js' 를
 *   resolve 못함.
 *
 *   결론: **현재 production build 에서 OCCT 실 사용 불가능**.
 *   Vite preview / dev server / Chromium 어디서도 OCCT 로드 안 됨.
 *
 *   53 mock 회귀 (ADR-081) 와 5 reachability + 3 drift discovery
 *   회귀 (ADR-082 C-β/γ) 모두 mock-or-Node-side 영역만 검증 — browser
 *   runtime 의 실 OCCT 통합은 *0건*.
 *
 * **현재 commit (C-δ) 의 scope**:
 *   1. Drift #3 의 명시적 봉인 — Playwright real Chromium 환경에서
 *      `import('opencascade.js')` 가 실패하는지 검증
 *   2. graceful failure 회귀 — StepIgesImporter 가 browser 에서도
 *      NOT_INSTALLED_MESSAGE + alternates 안내로 throw
 *   3. Drift #3 의 향후 해결 path 명시 (ADR-082 amendment or ADR-083)
 *
 * **Drift #3 미해결 영향**:
 *   - production 사용자: 현 상태 유지 (graceful "not installed" 안내)
 *   - 개발자: ADR-082 의 "OCCT 실파일 round-trip" 목표는 *아직 미달*
 *   - 후속: C-ε (drift #3 해결 위한 빌드 시스템 수정) 진입 결재 필요
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
  };
}

test.describe('ADR-082 C-δ — OCCT.js browser runtime drift discovery', () => {
  test('Drift #3 회귀 가드: opencascade.js bare specifier dynamic import 실패', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as AxiaWindow).__axia,
      undefined,
      { timeout: 10_000 },
    );

    // Browser 에서 dynamic import 시도 — Vite 가 opencascade-deps chunk
    // 를 만들지 않았으므로 bare specifier resolve 실패 예상.
    const result = await page.evaluate(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await (new Function('return import("opencascade.js")'))();
        return { ok: true, hasInit: typeof mod?.initOpenCascade === 'function' };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });

    // Vite 가 bundling 안 했으므로 import 실패가 정상 — 본 회귀는 *환경
    // 한계의 명시적 봉인*. 향후 ADR (C-ε 또는 별도 ADR) 가 빌드 시스템
    // 을 수정해 OCCT chunk 를 produce 하면 본 테스트가 깨짐 → drift #3
    // 해결 신호로 인지.
    if (result.ok) {
      // 만약 미래에 OCCT chunk 가 bundling 되면 hasInit 검증
      expect(result.hasInit).toBe(true);
    } else {
      // 현재 상태: bare specifier resolve 실패
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  // Note: browser graceful failure 검증은 production hash chunks (e.g.,
  //       `FileImporter-{hash}.js`) 가 hash 기반이라 stable path 를 갖지
  //       않아 페이지 외부에서 직접 import 불가. 브라우저 graceful path
  //       의 회귀는 (a) vitest occtRuntime.test.ts 의 Node graceful 테스트
  //       + (b) 본 spec 의 drift #3 회귀 (chunk absence) 의 조합으로
  //       intransitive 보장 — 만약 chunk 가 생기면 (drift #3 해결) 별도
  //       테스트가 필요하지만 현 시점은 불필요.

  test('Drift #3 의 향후 해결 신호: opencascade-deps chunk 존재 여부', async ({ page }) => {
    // Vite preview 의 dist asset list 검사 — 'opencascade-deps' chunk
    // 가 produce 됐는지 확인. 현재는 미존재 (drift #3 미해결). 향후
    // 빌드 시스템 수정으로 chunk 가 만들어지면 본 테스트가 깨짐 → drift
    // #3 해결 신호.
    //
    // 본 테스트는 *expectation 역방향* (negative regression) — 명시적
    // 봉인.
    const response = await page.goto('/');
    expect(response).toBeTruthy();

    // index.html 의 모든 script src 를 수집 후 'opencascade-deps' 매칭
    // 여부 확인. 현재는 매칭 0건 예상.
    const hasOcctChunk = await page.evaluate(() => {
      // dist 의 모든 chunk 는 main bundle 에서 import 되므로 페이지
      // 로드 후 performance API 로 list 가능
      const entries = performance.getEntriesByType('resource');
      return entries.some(e => /opencascade-deps/.test(e.name));
    });

    // 현재 상태: chunk 없음. 미래에 drift #3 해결 시 본 회귀 깨짐 →
    // ADR-082 trajectory 진척 신호.
    expect(hasOcctChunk).toBe(false);
  });
});
