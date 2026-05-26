/**
 * ADR-145 γ — Circle annulus 명시 promote E2E (Real Chromium round-trip).
 *
 * Sprint 1 ADR-145 closure (α + β-1 + β-1+ + β-2 + β-3 + β-4 + γ).
 * Path Z atomic single PR per LOCKED #44. γ sub-step = ADR-087 K-ζ
 * canonical user demo gate + Engine 4-validation real-browser
 * verification.
 *
 * 통합 evidence (β-1 + β-1+ Rust integration tests 의 browser counterpart):
 *   1. promoteCirclesToAnnulus WASM endpoint smoke (strict throw on
 *      InactiveFace).
 *   2. Concentric Circle promote round-trip (happy path) —
 *      drawCircleAsCurve × 2 + promote → outer face annulus, inner
 *      face deactivated. 본 사용자 워크플로우 evidence.
 *
 * NOTE: Playwright uses `npm run preview` (production build) per
 * `playwright.config.ts`. Re-build prod bundle (`npm run build`) AFTER
 * WASM rebuild for tests to pick up the latest engine.
 *
 * Cross-link:
 *   - ADR-145 §2.1 (사용자 워크플로우 5-step)
 *   - ADR-145 §2.2 (Engine API 4-validation: active / Circle face /
 *     coplanar / contained)
 *   - ADR-087 K-ζ canonical (user demo gate)
 *   - ADR-089 Phase 2 (Path B closed-curve face — drawCircleAsCurve)
 *   - ADR-075 E.4 (Playwright Chromium E2E infrastructure)
 *   - LOCKED #44 (Complete Meaning per Merge)
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

// Concentric Circles on Z=0 plane (LOCKED #43 Z-up canonical).
// Outer radius 5, inner radius 2 → inner ⊂ outer (4-validation #4 pass).
const CIRCLE_OUTER = { cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 1, radius: 5 };
const CIRCLE_INNER = { cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 1, radius: 2 };

test.describe('ADR-145 γ — Circle annulus 명시 promote E2E', () => {
  test.beforeEach(async ({ page }) => {
    // ADR-139 B-β-1: auto-intersect default OFF — ADR-145 의 명시
    // promote 는 사용자 우클릭 명시 trigger, 자동 trigger 와 분리
    // (메타-원칙 #16). 본 E2E 에서 auto-intersect 활성 시 두 Circle
    // 그리기 단계에서 분할 발생 가능 — 분리 보존 위해 OFF 유지.
    await page.addInitScript(() => {
      localStorage.setItem('axia:auto-intersect-on-draw', 'false');
      localStorage.setItem('axia:auto-face-synthesis-on-draw', 'false');
    });
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  /**
   * γ-1: promoteCirclesToAnnulus WASM endpoint smoke.
   *
   * β-2 WASM bridge endpoint 가 production-like build 에서 wired 되어
   * 있고, β-1 의 strict 4-validation 중 InactiveFace 가 명시 throw
   * 하는지 검증. ADR-091 D-ζ smoke 패턴 1:1 mirror.
   */
  test('γ-1: promoteCirclesToAnnulus rejects inactive face (strict throw)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        // Both face IDs are inactive (no draw performed yet → mesh empty).
        bridge.promoteCirclesToAnnulus(99999, 99998);
        return { threw: false, message: '' };
      } catch (e) {
        return {
          threw: true,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    });
    expect(result.threw).toBe(true);
    // Engine error format: "promoteCirclesToAnnulus: <AnnulusError>"
    expect(result.message).toContain('promoteCirclesToAnnulus');
    // β-1 validation #1: InactiveFace (face_id not in active face set).
    expect(result.message).toMatch(/InactiveFace|inactive/i);
  });

  /**
   * γ-2: Concentric Circles happy-path round-trip.
   *
   * β-1+ Rust integration test (`adr145_beta1plus_promote_concentric_
   * circles_succeeds`) 의 browser counterpart. 사용자 워크플로우 (ADR-145
   * §2.1) evidence:
   *   1. drawCircleAsCurve × 2 (outer radius 5, inner radius 2,
   *      concentric on Z=0)
   *   2. bridge.promoteCirclesToAnnulus(outer, inner)
   *   3. Verify: outer face still active, inner face inactive
   *      (β-1+ L-145-8 — hole inheritance, LOCKED #1 P7 manifold)
   */
  test('γ-2: concentric Circles → promote → outer annulus, inner deactivated', async ({ page }) => {
    const result = await page.evaluate(
      (args) => {
        const w = window as unknown as AxiaWindow;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bridge = w.__axia!.get<any>('bridge');

        const facesBefore = bridge.getStats().faces;

        // Step 1: Draw outer Circle (radius 5).
        const outerFaceId = bridge.drawCircleAsCurve(
          args.outer.cx, args.outer.cy, args.outer.cz,
          args.outer.nx, args.outer.ny, args.outer.nz,
          args.outer.radius,
        );

        // Step 2: Draw inner Circle (radius 2, same center, same plane).
        const innerFaceId = bridge.drawCircleAsCurve(
          args.inner.cx, args.inner.cy, args.inner.cz,
          args.inner.nx, args.inner.ny, args.inner.nz,
          args.inner.radius,
        );

        const facesAfterDraw = bridge.getStats().faces;
        const bothDrawn =
          outerFaceId !== null && outerFaceId !== undefined &&
          innerFaceId !== null && innerFaceId !== undefined;

        if (!bothDrawn) {
          return {
            step: 'draw',
            facesBefore,
            facesAfterDraw,
            outerFaceId,
            innerFaceId,
            bothDrawn,
            promoteSucceeded: false,
            facesAfterPromote: -1,
            promoteError: '',
          };
        }

        // Step 3: bridge.promoteCirclesToAnnulus(outer, inner).
        let promoteSucceeded = false;
        let promoteError = '';
        try {
          bridge.promoteCirclesToAnnulus(outerFaceId, innerFaceId);
          promoteSucceeded = true;
        } catch (e) {
          promoteError = e instanceof Error ? e.message : String(e);
        }

        const facesAfterPromote = bridge.getStats().faces;

        return {
          step: 'promote',
          facesBefore,
          facesAfterDraw,
          outerFaceId,
          innerFaceId,
          bothDrawn,
          promoteSucceeded,
          facesAfterPromote,
          promoteError,
        };
      },
      { outer: CIRCLE_OUTER, inner: CIRCLE_INNER },
    );

    // Evidence — 2 Path B Circle faces drawn.
    expect(result.bothDrawn, 'γ-2: 2 Circle faces drawn').toBe(true);
    expect(result.facesAfterDraw, 'γ-2: face count progressed by 2').toBeGreaterThanOrEqual(
      result.facesBefore + 2,
    );

    // Evidence — promote succeeded (no error).
    expect(result.promoteSucceeded, `γ-2: promote OK (error: ${result.promoteError})`).toBe(true);

    // Evidence — β-1+ L-145-8: inner face deactivated, outer still active.
    // getStats().faces returns active face count → should DECREASE by 1
    // (inner deactivated). Outer face still active with new inner hole loop.
    expect(result.facesAfterPromote, 'γ-2: inner face deactivated').toBe(
      result.facesAfterDraw - 1,
    );
  });
});
