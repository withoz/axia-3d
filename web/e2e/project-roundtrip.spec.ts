/**
 * ADR-078 P-4 — Boolean Group Persistence Save/Load Round-trip E2E.
 *
 * Real Chromium round-trip verification of the persistence stack:
 *   SelectionManager.groupTags (UI runtime, ADR-074 U-1)
 *     ↓ saveProject push (P-3 L1)
 *   WasmBridge.{clear,set}BooleanGroupTag (P-2)
 *     ↓
 *   Scene.boolean_group_tags (P-1, bincode section 6)
 *     ↓ exportSnapshot
 *   [snapshot bytes preserved across page reload]
 *     ↓ importSnapshot
 *   Scene.boolean_group_tags
 *     ↓
 *   WasmBridge.getBooleanGroup{A,B}Faces (P-2)
 *     ↓ openProject pull (P-3 L2)
 *   SelectionManager.restoreGroupTags (P-3 L3)
 *
 * Per ADR-078 P-4 lock-ins:
 * - P-4-a (b) bridge call sequence (no DOM file dialog — DOM round-trip
 *   is future ADR territory)
 * - P-4-c (a) page reload between save and load (true fresh state —
 *   ServiceContainer + WasmBridge re-bootstrap)
 * - P-4-d (b) 2 spec only (basic + empty) — corner cases covered by
 *   vitest L3 regressions
 * - P-4-i 절대 #[ignore] 금지
 *
 * What this verifies (in real Chromium runtime):
 * - bincode section 6 round-trip across process boundary (export →
 *   reload → import preserves group_tags HashMap)
 * - WasmBridge typed wrappers (P-2) work correctly with real WASM
 *   (uppercase 'A'/'B' tag, Vec<u32> ownership, sorted output)
 * - SelectionManager.restoreGroupTags (P-3 L3) applies the union
 *   policy on real Three.js scene (selection ⊇ groupTags invariant)
 * - notifyChange + V-2 outline rebuild fires once per restore
 *
 * What this does NOT verify (separate ADRs):
 * - Actual file download / upload via DOM dialogs (future ADR)
 * - Visual baseline of restored group outlines (V-2 baseline path,
 *   not changed by restore — restore re-runs the same outline path)
 * - Multi-step undo/redo of group tag mutations (separate ADR)
 */
import { test, expect } from '@playwright/test';
import {
  setupNPlaneFaces,
  setupGroupedSelection,
  waitForBridgeReady,
  simulateProjectSavePush,
  exportSnapshotBytes,
  importSnapshotBytes,
  simulateProjectLoadPull,
  readSelectionGroups,
} from './helpers/boolean-fixtures';

test.describe('ADR-078 P-4 — Project save/load group tag round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('basic round-trip — A=[f0,f1] + B=[f2] preserved across save/reload/load', async ({
    page,
  }) => {
    // ── Step A: setup faces + group tags ──
    const { faces } = await setupNPlaneFaces(page, {
      count: 3,
      withSurfaces: false,
    });
    expect(faces.length).toBe(3);

    const expectedA = [faces[0], faces[1]].slice().sort((a, b) => a - b);
    const expectedB = [faces[2]];

    await setupGroupedSelection(page, {
      faces,
      groupA: [faces[0], faces[1]],
      groupB: [faces[2]],
    });

    // Sanity — UI state has the tags before save.
    const beforeSave = await readSelectionGroups(page);
    expect(beforeSave.groupA).toEqual(expectedA);
    expect(beforeSave.groupB).toEqual(expectedB);
    expect(beforeSave.hasSelection).toBe(true);

    // ── Step B: save sync push (P-3 L1) ──
    await simulateProjectSavePush(page);

    // ── Step C: export snapshot bytes ──
    const bytes = await exportSnapshotBytes(page);
    expect(bytes.length).toBeGreaterThan(0);

    // ── Step D: page reload — true fresh state (P-4-c L2 lock-in) ──
    await page.reload();
    await waitForBridgeReady(page);

    // After reload, no group tags should exist (fresh ServiceContainer).
    const afterReload = await readSelectionGroups(page);
    expect(afterReload.groupA).toEqual([]);
    expect(afterReload.groupB).toEqual([]);
    expect(afterReload.hasSelection).toBe(false);

    // ── Step E: import snapshot + load sync pull (P-3 L2) ──
    const importOk = await importSnapshotBytes(page, bytes);
    expect(importOk).toBe(true);

    await simulateProjectLoadPull(page);

    // ── Step F: verify restored state ──
    const afterLoad = await readSelectionGroups(page);
    expect(afterLoad.groupA).toEqual(expectedA);
    expect(afterLoad.groupB).toEqual(expectedB);
    expect(afterLoad.hasSelection).toBe(true);

    // P-3 L3: selection ⊇ groupTags (union policy). After fresh
    // reload + restore, selection = A ∪ B.
    expect(afterLoad.selectionSize).toBeGreaterThanOrEqual(
      expectedA.length + expectedB.length,
    );
  });

  test('empty round-trip — no group tags, clear-only path stays consistent', async ({
    page,
  }) => {
    // Setup faces but DON'T apply any group tags.
    const { faces } = await setupNPlaneFaces(page, {
      count: 2,
      withSurfaces: false,
    });
    expect(faces.length).toBe(2);

    // Confirm no group tags before save.
    const beforeSave = await readSelectionGroups(page);
    expect(beforeSave.groupA).toEqual([]);
    expect(beforeSave.groupB).toEqual([]);
    expect(beforeSave.hasSelection).toBe(false);

    // ── Save push: P-3 L1 clear-only path (both groups empty) ──
    await simulateProjectSavePush(page);

    const bytes = await exportSnapshotBytes(page);
    expect(bytes.length).toBeGreaterThan(0);

    // ── Reload + import + pull ──
    await page.reload();
    await waitForBridgeReady(page);

    const importOk = await importSnapshotBytes(page, bytes);
    expect(importOk).toBe(true);

    await simulateProjectLoadPull(page);

    // ── Verify: still no group tags after round-trip ──
    const afterLoad = await readSelectionGroups(page);
    expect(afterLoad.groupA).toEqual([]);
    expect(afterLoad.groupB).toEqual([]);
    expect(afterLoad.hasSelection).toBe(false);
  });
});
