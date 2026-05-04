/**
 * ADR-075 E4-2 — ADR-064 single-face DCEL Boolean E2E.
 *
 * Real browser-runtime verification of the Path Z stack:
 *   BooleanHandler.startBooleanOp ← (mock-skipped, direct bridge call)
 *     → WasmBridge.booleanDispatchDcel (TS typed wrapper)
 *       → booleanDispatchDcelJson (WASM export)
 *         → Mesh::boolean_dispatch_dcel (Rust)
 *           → Mesh::nurbs_boolean_to_dcel (op-specific removal)
 *             → Phase J nurbs_boolean_v2
 *
 * Closes ADR-064 §E.4 for the single-face path. Multi-face (ADR-066)
 * is E4-3.
 *
 * Per E4-2 lock-ins:
 * - E4-2-a (b) 3 atomic scenarios — disjoint subtract / ineligible /
 *   3 ops accepted
 * - E4-2-b (a) bridge methods (drawRect + setFaceSurfacePlane), no
 *   fixture file
 * - E4-2-d (a) result struct shape verification (key fields), not
 *   deep mesh inspection
 * - E4-2-h (a) fresh page per test (isolation)
 */
import { test, expect } from '@playwright/test';
import {
  setupTwoPlaneFaces,
  waitForBridgeReady,
  invokeBooleanDispatchDcel,
} from './helpers/boolean-fixtures';

test.describe('ADR-075 E4-2 — single-face DCEL Boolean E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('disjoint Subtract preserves both inputs (D-F=(c) round-trip)', async ({ page }) => {
    const { faceA, faceB } = await setupTwoPlaneFaces(page, {
      withSurfaces: true,
      zA: 0.0,
      zB: 5.0,
    });
    expect(faceA).toBeGreaterThanOrEqual(0);
    expect(faceB).toBeGreaterThanOrEqual(0);
    expect(faceA).not.toBe(faceB);

    const result = await invokeBooleanDispatchDcel(page, {
      faceA, faceB, op: 'subtract',
    }) as {
      kind: string; pathUsed?: string;
      dcel?: { disjoint: boolean; removedFaces: number[];
               newFacesA: number[]; newFacesB: number[];
               preservedFaces: number[] };
      fallbackReason?: { kind: string };
    };

    expect(result).not.toBeNull();
    expect(result.kind).toBe('ok');
    expect(result.pathUsed).toBe('Nurbs');
    expect(result.fallbackReason).toBeNull();
    // D-F=(c) — disjoint preserves both inputs.
    expect(result.dcel).not.toBeNull();
    expect(result.dcel!.disjoint).toBe(true);
    expect(result.dcel!.removedFaces).toEqual([]);
    expect(result.dcel!.newFacesA).toEqual([]);
    expect(result.dcel!.newFacesB).toEqual([]);
    expect(result.dcel!.preservedFaces).toHaveLength(2);
  });

  test('ineligible (no analytic surface) routes to Mesh path (Y-E)', async ({ page }) => {
    const { faceA, faceB } = await setupTwoPlaneFaces(page, {
      withSurfaces: false,  // intentionally skip surface attach
      zA: 0.0,
      zB: 5.0,
    });

    const result = await invokeBooleanDispatchDcel(page, {
      faceA, faceB, op: 'subtract',
    }) as {
      kind: string; pathUsed?: string;
      dcel?: unknown;
      fallbackReason?: { kind: string; label: string };
    };

    expect(result.kind).toBe('ok');
    // Per Step 5 — eligibility rejected upfront when surface missing.
    expect(result.pathUsed).toBe('Mesh');
    expect(result.dcel).toBeNull();
    expect(result.fallbackReason).not.toBeNull();
    expect(result.fallbackReason!.kind).toBe('SurfaceMissing');
  });

  test('3 ops (Subtract / Union / Intersect) all accepted on eligible pair (D-B=(a))', async ({ page }) => {
    // Each op needs a fresh face setup since Subtract may remove inputs.
    // Wrap the entire 3-op sweep in one test (per E4-2-a (b) scenario 3).
    const ops: Array<'subtract' | 'union' | 'intersect'> = [
      'subtract', 'union', 'intersect',
    ];
    for (const op of ops) {
      // Reload the page to reset mesh state per iteration (atomic isolation
      // even within the same test, since face IDs may overlap).
      await page.goto('/');
      await waitForBridgeReady(page);

      const { faceA, faceB } = await setupTwoPlaneFaces(page, {
        withSurfaces: true,
        zA: 0.0,
        zB: 5.0,
      });

      const result = await invokeBooleanDispatchDcel(page, {
        faceA, faceB, op,
      }) as {
        kind: string; pathUsed?: string;
        dcel?: { disjoint: boolean };
      };

      expect(result.kind, `op=${op} must produce kind:'ok'`).toBe('ok');
      expect(result.pathUsed, `op=${op} must take Nurbs path`).toBe('Nurbs');
      expect(result.dcel, `op=${op} must populate dcel`).not.toBeNull();
      // Both planes are coplanar-parallel (5mm apart) — disjoint for all ops.
      expect(result.dcel!.disjoint, `op=${op} must be disjoint`).toBe(true);
    }
  });
});
