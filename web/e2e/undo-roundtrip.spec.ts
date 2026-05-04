/**
 * ADR-075 E4-4 — Boolean → Undo round-trip E2E.
 *
 * Real browser-runtime verification of the transaction wrapping +
 * undo contract for both ADR-064 single-face and ADR-066 multi-face
 * Boolean dispatchers. Closes the last unresolved item in
 * ADR-064 §E.4 / ADR-066 §E.4 (browser-runtime undo round-trip).
 *
 * Per E4-4 lock-ins:
 * - E4-4-a (c) single + multi (both ADRs closed)
 * - E4-4-b (b) face IDs set + count via captureMeshSnapshot helper
 * - E4-4-c (a) 2 atomic scenarios
 * - E4-4-d disjoint fixtures only (intersecting cases → E4-5)
 * - E4-4-e new captureMeshSnapshot + invokeUndo helpers
 * - E4-4-f undo-roundtrip.spec.ts naming
 * - E4-4-g (a) fresh page per test
 *
 * **Disjoint scope explanation**: Plane × Plane intersecting cases
 * produce open chains (no closed trim loops) per Phase J — D-H
 * safe-only kicks in and preserves inputs. So the disjoint contract
 * is the same as the no-mesh-mutation contract for these fixtures.
 * Real intersecting round-trip (Cylinder ∩ Plane etc.) requires
 * different surface kinds — E4-5 territory.
 *
 * What this DOES verify:
 * - Transaction wrapping (Y-2 source-inspection) actually fires
 *   commit/cancel in real WASM runtime
 * - bridge.undo() returns true after a Boolean dispatch (transaction
 *   was committed, undo stack populated)
 * - Mesh state stays consistent (no spurious face count drift)
 * - Cross-method sequencing: dispatch → undo doesn't break bridge
 *   state
 */
import { test, expect } from '@playwright/test';
import {
  setupNPlaneFaces,
  waitForBridgeReady,
  invokeBooleanDispatchDcelMulti,
  captureMeshSnapshot,
  invokeUndo,
} from './helpers/boolean-fixtures';

test.describe('ADR-075 E4-4 — Boolean → Undo round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  // ADR-076 Step 2 — Removed: single-face dispatch undo round-trip
  // (was: 'single-face dispatch → undo restores mesh state (Path Z)').
  // Both bridge.booleanDispatchDcel and the WASM
  // booleanDispatchDcelJson export were removed in ADR-076 Step 2.
  // The multi-face round-trip test below covers the same case via
  // Y-1 1×1 degenerate (Rust Mesh::boolean_dispatch_dcel preserved
  // and exercised internally by multi).

  test('multi-face dispatch → undo restores mesh state (Path Y)', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });
    const facesA = [faces[0], faces[1]];
    const facesB = [faces[2], faces[3]];

    const before = await captureMeshSnapshot(page);
    expect(before.canUndo).toBe(true);

    const result = await invokeBooleanDispatchDcelMulti(page, {
      facesA, facesB, op: 'subtract',
    }) as {
      kind: string; pathUsed?: string;
      perPair?: Array<{ outcome: { kind: string; dcel?: { disjoint: boolean } } }>;
      allRemovedFaces?: number[];
      allNewFaces?: number[];
    };

    expect(result.kind).toBe('ok');
    expect(result.pathUsed).toBe('Nurbs');
    expect(result.perPair).toHaveLength(4);  // 2×2 cartesian
    // All 4 pairs disjoint — Y-I per-pair safe-only preserves all.
    expect(result.allRemovedFaces).toEqual([]);
    expect(result.allNewFaces).toEqual([]);

    const after_op = await captureMeshSnapshot(page);
    expect(after_op.faceCount).toBe(before.faceCount);
    expect(after_op.vertCount).toBe(before.vertCount);
    expect(after_op.canUndo).toBe(true);

    const undoOk = await invokeUndo(page);
    expect(undoOk).toBe(true);

    const after_undo = await captureMeshSnapshot(page);
    // Y-2 multi transaction wrapping — single undo reverses entire
    // batch (all 4 pairs). For all-disjoint case, batch was empty
    // so undo just pops the no-op commit.
    expect(after_undo.faceCount).toBe(before.faceCount);
    expect(after_undo.vertCount).toBe(before.vertCount);
  });
});
