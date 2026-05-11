/**
 * ADR-074 U-4 (E.3 트랙) — Boolean Group A/B routing E2E.
 *
 * Real browser-runtime verification of ADR-074 stack:
 *   ContextMenu (U-2) sets Group A/B tags on selection
 *     → SelectionManager (U-1) stores groupTags Map + getGroupA/B
 *       → BooleanHandler (U-3) reads hasGroupSelection() and routes
 *         → bridge.booleanDispatchDcelMulti gets EXPLICIT facesA/B
 *           (not half/half split)
 *
 * Closes ADR-074 §C lock-in #4 — verifies that user-explicit
 * grouping survives the full bridge round-trip in real Chromium.
 *
 * Per U-4 lock-ins:
 * - U-4-a (b) Helper extension (setupGroupedSelection +
 *   installMultiDispatchSpy + readCapturedMultiDispatch +
 *   clickToolbarAction) added to boolean-fixtures.ts
 * - U-4-b (b) 2 atomic scenarios: explicit + fallback
 * - U-4-c (c) Both result struct (capture) AND user flow (toolbar
 *   click via main.ts dispatcher → BooleanHandler.startBooleanOp)
 * - U-4-d dcel-group-routing.spec.ts naming
 * - U-4-e (a) fresh page per test
 */
import { test, expect } from '@playwright/test';
import {
  setupNPlaneFaces,
  setupGroupedSelection,
  installMultiDispatchSpy,
  readCapturedMultiDispatch,
  clickToolbarAction,
  waitForBridgeReady,
} from './helpers/boolean-fixtures';

test.describe('ADR-074 U-4 — Boolean Group A/B routing E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('explicit Group A/B routes faces directly to multi (not half/half)', async ({ page }) => {
    // Fixture — 4 disjoint planes (with surfaces).
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });

    // Tag the FIRST face as Group A and the OTHER THREE as Group B.
    // This deliberately differs from half/half (which would yield
    // A=[0,1], B=[2,3]) so the test catches a fall-through bug.
    await setupGroupedSelection(page, {
      faces,
      groupA: [faces[0]],
      groupB: [faces[1], faces[2], faces[3]],
    });

    // Spy on bridge.booleanDispatchDcelMulti BEFORE clicking.
    await installMultiDispatchSpy(page);

    // Trigger the real user flow — click bool-subtract toolbar item
    // (main.ts dispatchToolbarAction → BooleanHandler.startBooleanOp).
    await clickToolbarAction(page, 'bool-subtract');

    // BooleanHandler dynamically imports — wait for the dispatch.
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return w.__multiCallCount > 0;
      },
      undefined,
      { timeout: 5_000 },
    );

    const captured = await readCapturedMultiDispatch(page);
    expect(captured.callCount).toBe(1);
    expect(captured.args).not.toBeNull();
    // The U-3 routing invariant: explicit groups dispatched verbatim,
    // NOT split half/half.
    expect(captured.args!.facesA).toEqual([faces[0]]);
    expect(captured.args!.facesB.sort((a, b) => a - b))
      .toEqual([faces[1], faces[2], faces[3]].sort((a, b) => a - b));
    expect(captured.args!.op).toBe('subtract');
  });

  test('no group → falls back to half/half split (drop-in alongside)', async ({ page }) => {
    const { faces } = await setupNPlaneFaces(page, {
      count: 4,
      withSurfaces: true,
      zStep: 5.0,
    });

    // Select all 4 faces but DO NOT tag any as Group A/B.
    // hasGroupSelection() will be false → BooleanHandler must use
    // the legacy half/half split (Y-4-b=(a) preserved per U-3-d).
    await setupGroupedSelection(page, {
      faces,
      groupA: [],
      groupB: [],
    });

    await installMultiDispatchSpy(page);
    await clickToolbarAction(page, 'bool-subtract');

    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return w.__multiCallCount > 0;
      },
      undefined,
      { timeout: 5_000 },
    );

    const captured = await readCapturedMultiDispatch(page);
    expect(captured.callCount).toBe(1);
    expect(captured.args).not.toBeNull();
    // Half/half split: 4 faces → mid=2 → A=[0,1], B=[2,3].
    expect(captured.args!.facesA).toEqual([faces[0], faces[1]]);
    expect(captured.args!.facesB).toEqual([faces[2], faces[3]]);
    expect(captured.args!.op).toBe('subtract');
  });
});
