/**
 * E2E regression — DrawRect (form mode) → CreateSolidExtrude flow.
 *
 * 사용자 보고 (2026-05-08):
 *   DrawRect → Push/Pull 클릭 시 콘솔 에러:
 *   `[RUST] create_solid_extrude ERROR: profile face has no AnalyticSurface attached`
 *
 * 본 spec 은 fix (`exec_draw_rect_as_shape` 의 Plane attach) 가 real
 * Chromium runtime 에서도 정상 동작 검증. axia-core 의 Rust regression
 * (185 lib tests, 절대 #[ignore] 금지) 위에 ground-truth E2E.
 *
 * **fast** — Drift #5 (OCCT init 180s+) 와 무관. Pure axia engine path.
 */
import { test, expect } from '@playwright/test';

interface AxiaWindow {
  __axia?: {
    get<T>(key: string): T;
  };
}

test.describe('DrawRect → CreateSolidExtrude (kernel-aware path)', () => {
  test('drawRectAsShape attaches Plane surface; createSolidExtrude succeeds → 6 faces', async ({ page }) => {
    test.setTimeout(30_000);

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
        const bridge = c.get<any>('bridge');
        if (!bridge) return { ok: false, reason: 'bridge unavailable' };

        // Wait for WASM ready
        if (!bridge.isReady?.()) {
          return { ok: false, reason: 'WASM not ready' };
        }

        // Stats before draw
        const statsBefore = bridge.getStats();

        // Step 1 — drawRectAsShape (form mode kernel-aware path)
        // Plane: origin (0,0,0), normal +Z, basis_u +X. Width=10000, height=10000 (mm).
        const shapeRaw = bridge.drawRectAsShape(
          0, 0, 0,        // center
          0, 0, 1,        // normal +Z
          1, 0, 0,        // basis_u +X
          10000, 10000,   // width × height (10m × 10m)
        );
        if (typeof shapeRaw !== 'number' || shapeRaw < 0) {
          return { ok: false, reason: `drawRectAsShape returned ${shapeRaw}` };
        }

        const statsAfterDraw = bridge.getStats();
        const drawFaceDelta = statsAfterDraw.faces - statsBefore.faces;

        // Get the rect's face_id
        const faceIds = bridge.getShapeFaceIds?.(shapeRaw) as number[] | undefined;
        if (!faceIds || faceIds.length === 0) {
          return { ok: false, reason: 'getShapeFaceIds returned empty' };
        }
        const profileFaceId = faceIds[0];

        // Verify Plane surface attached (the fix's core invariant)
        const surfaceKind = bridge.faceSurfaceKind?.(profileFaceId);
        // 1 = Plane (per WasmBridge faceSurfaceKind doc)
        const hasPlaneSurface = surfaceKind === 1;

        // Step 2 — createSolidExtrude (kernel-aware Push/Pull)
        const extrudeOk = bridge.createSolidExtrude(profileFaceId, 5000);
        const lastError = bridge.lastError?.();

        const statsAfterExtrude = bridge.getStats();
        const extrudeFaceDelta = statsAfterExtrude.faces - statsAfterDraw.faces;

        return {
          ok: true,
          shapeRaw,
          profileFaceId,
          drawFaceDelta,
          hasPlaneSurface,
          surfaceKind,
          extrudeOk,
          extrudeFaceDelta,
          totalFacesAfter: statsAfterExtrude.faces,
          lastError: lastError ?? null,
        };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 500) };
      }
    });

    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.log('[E2E] DrawRect → Push/Pull failure:', result);
    }

    expect(result.ok).toBe(true);
    if (result.ok) {
      // DrawRectAsShape created 1 face
      expect(result.drawFaceDelta).toBeGreaterThanOrEqual(1);

      // Plane surface attached (the fix's core invariant)
      expect(result.hasPlaneSurface).toBe(true);
      expect(result.surfaceKind).toBe(1);  // 1 = Plane

      // CreateSolidExtrude succeeded (no NoProfileSurface error)
      expect(result.extrudeOk).toBe(true);
      expect(result.lastError).toBeFalsy();

      // Box has 6 faces total (profile + top + 4 sides). After extrude:
      // delta = 5 (top + 4 sides; profile already existed).
      expect(result.extrudeFaceDelta).toBeGreaterThanOrEqual(5);
      expect(result.totalFacesAfter).toBeGreaterThanOrEqual(6);
    }
  });
});
