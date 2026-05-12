/**
 * ADR-075 E4-3 — ADR-066 multi-face DCEL Boolean E2E.
 *
 * Real browser-runtime verification of the Path Y stack:
 *   BooleanHandler.startBooleanOp ← (mock-skipped, direct bridge call)
 *     → WasmBridge.booleanDispatchDcelMulti (TS typed wrapper Y-3)
 *       → booleanDispatchDcelMultiJson (WASM export Y-2)
 *         → Mesh::boolean_dispatch_dcel_multi (Rust Y-1)
 *           ↳ cartesian (N×M pairs)
 *           ↳ delegates 1×1 degenerate to boolean_dispatch_dcel
 *
 * Closes ADR-066 §E.4 for the multi-face path.
 *
 * Per E4-3 lock-ins (Path Y atomic 답습):
 * - E4-3-a (d) 4 scenarios — degenerate / cartesian / ineligible / 3 ops
 * - E4-3-b (a) Helper extended (setupNPlaneFaces + invokeMulti)
 * - E4-3-c (a) 2×2 cartesian (4 pairs)
 * - E4-3-d (b) 1×1 degenerate verifies per_pair[0] only (Y-1 lock-in #4)
 * - E4-3-h (a) fresh page per test
 */
import { test, expect } from '@playwright/test';
import {
  setupTwoPlaneFaces,
  setupNPlaneFaces,
  waitForBridgeReady,
  invokeBooleanDispatchDcelMulti,
} from './helpers/boolean-fixtures';

test.describe('ADR-075 E4-3 — multi-face DCEL Boolean E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('1×1 degenerate delegates to Path Z (Y-1 lock-in #4)', async ({ page }) => {
    const { faceA, faceB } = await setupTwoPlaneFaces(page, {
      withSurfaces: true,
      zA: 0.0,
      zB: 5.0,
    });

    const result = await invokeBooleanDispatchDcelMulti(page, {
      facesA: [faceA], facesB: [faceB], op: 'subtract',
    }) as {
      kind: string; pathUsed?: string;
      perPair?: Array<{
        faceA: number; faceB: number;
        outcome: { kind: string; dcel?: { disjoint: boolean } };
      }>;
      allNewFaces?: number[];
      allRemovedFaces?: number[];
    };

    expect(result.kind).toBe('ok');
    expect(result.pathUsed).toBe('Nurbs');
    // Y-1 lock-in #4 — 1×1 degenerate produces exactly 1 per_pair entry.
    expect(result.perPair).toHaveLength(1);
    const p0 = result.perPair![0];
    expect(p0.faceA).toBe(faceA);
    expect(p0.faceB).toBe(faceB);
    expect(p0.outcome.kind).toBe('ok');
    // 5mm-apart planes are disjoint per Path Z D-F=(c).
    expect(p0.outcome.dcel!.disjoint).toBe(true);
    // No mesh change → empty aggregates.
    expect(result.allNewFaces).toEqual([]);
    expect(result.allRemovedFaces).toEqual([]);
  });

  test('2×2 cartesian produces 4 per_pair outcomes (Y-G=(a))', async ({ page }) => {
    // 4 disjoint planes at z = 0, 5, 10, 15.
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });
    expect(faces).toHaveLength(4);
    const facesA = [faces[0], faces[1]];
    const facesB = [faces[2], faces[3]];

    const result = await invokeBooleanDispatchDcelMulti(page, {
      facesA, facesB, op: 'subtract',
    }) as {
      kind: string; pathUsed?: string;
      perPair?: Array<{
        faceA: number; faceB: number;
        outcome: { kind: string; dcel?: { disjoint: boolean } };
      }>;
      allNewFaces?: number[];
      allRemovedFaces?: number[];
    };

    expect(result.kind).toBe('ok');
    expect(result.pathUsed).toBe('Nurbs');
    // 2×2 cartesian — exactly 4 per_pair outcomes.
    expect(result.perPair).toHaveLength(4);
    // All 4 pairs disjoint (≥5mm apart) per Y-I per-pair safe-only.
    for (const p of result.perPair!) {
      expect(p.outcome.kind).toBe('ok');
      expect(p.outcome.dcel!.disjoint).toBe(true);
    }
    // Y-I per-pair safe-only — no removal when all disjoint.
    expect(result.allNewFaces).toEqual([]);
    expect(result.allRemovedFaces).toEqual([]);
  });

  // 2026-05-12 RE-ENABLED — ADR-087 K-δ surface auto-attach
  // post-attach mitigation: setupNPlaneFaces(withSurfaces:false) now
  // explicitly calls `bridge.clearFaceSurface(faceId)` after the
  // auto-attached Plane, restoring the original Y-E contract.
  // See boolean-fixtures.ts comment for full rationale.
  test('Y-E ineligibility (no surfaces) routes to Mesh path', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: false,  // Y-E strict — must reject upfront
      zStep: 5.0,
    });
    const facesA = [faces[0], faces[1]];
    const facesB = [faces[2], faces[3]];

    const result = await invokeBooleanDispatchDcelMulti(page, {
      facesA, facesB, op: 'union',
    }) as {
      kind: string; pathUsed?: string;
      perPair?: unknown[];
      allNewFaces?: number[];
      allRemovedFaces?: number[];
      fallbackReason?: { kind: string };
    };

    expect(result.kind).toBe('ok');
    expect(result.pathUsed).toBe('Mesh');
    // Y-E rejected upfront — empty per_pair / aggregates.
    expect(result.perPair).toEqual([]);
    expect(result.allNewFaces).toEqual([]);
    expect(result.allRemovedFaces).toEqual([]);
    expect(result.fallbackReason).not.toBeNull();
    expect(result.fallbackReason!.kind).toBe('SurfaceMissing');
  });

  test('3 ops (Subtract / Union / Intersect) all accepted on multi (Y-2 D-B parity)', async ({ page }) => {
    const ops: Array<'subtract' | 'union' | 'intersect'> = [
      'subtract', 'union', 'intersect',
    ];
    for (const op of ops) {
      // Atomic isolation — fresh page per op.
      await page.goto('/');
      await waitForBridgeReady(page);

      const { faceA, faceB } = await setupTwoPlaneFaces(page, {
        withSurfaces: true,
        zA: 0.0,
        zB: 5.0,
      });

      const result = await invokeBooleanDispatchDcelMulti(page, {
        facesA: [faceA], facesB: [faceB], op,
      }) as {
        kind: string; pathUsed?: string;
        perPair?: unknown[];
      };

      expect(result.kind, `op=${op} must produce kind:'ok'`).toBe('ok');
      expect(result.pathUsed, `op=${op} must take Nurbs path`).toBe('Nurbs');
      expect(result.perPair, `op=${op} must populate per_pair`)
        .toHaveLength(1);
    }
  });
});
