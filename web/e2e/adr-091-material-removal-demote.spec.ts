/**
 * ADR-091 D-ζ — Material Removal → Shape 가역 강등 browser E2E.
 *
 * Real Chromium round-trip verification of the demote stack
 * (D-α ~ D-ε) end-to-end. Closes the last D-* sub-step before the
 * D-η LOCKED #26 Phase 2 closure.
 *
 * Per D-ζ lock-ins:
 * - Strict throw on unknown XiaId (smoke — fast, no setup)
 * - Snapshot section 7d round-trip preserves the
 *   `xia_to_original_shape` map across export → import → demote
 * - Both tests reuse the ADR-075 fixture pattern (waitForBridgeReady)
 *   and the existing helpers — no new infrastructure required.
 *
 * What this DOES verify:
 * - bridge.demoteXiaToShape exists in production-like build
 * - Strict-throw contract on missing Xia (XiaNotFound)
 * - Snapshot section 7d additive bytes don't break export/import
 *
 * What this does NOT verify (별도 후속):
 * - Full UI flow (Inspector dropdown → Toast → Undo) — vitest jsdom
 *   covers this in MaterialRemovalDemote.test.ts + Toast.test.ts
 * - Watertight-solid promote+demote round-trip — requires closed
 *   solid setup (Box/Cylinder primitive); deferred or covered by
 *   axia-core integration tests.
 */
import { test, expect } from '@playwright/test';
import { waitForBridgeReady } from './helpers/boolean-fixtures';

interface AxiaWindow {
  __axia?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T = any>(key: string): T;
  };
}

test.describe('ADR-091 D-ζ — Material Removal → Shape demote E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBridgeReady(page);
  });

  test('demoteXiaToShape rejects unknown XiaId in production-like browser build', async ({ page }) => {
    // Direct-call smoke — verifies the WASM endpoint is wired through
    // the production-like Vite preview build. The strict-throw
    // contract (D-γ Lock-in: silent skip 차단) is the single most
    // important invariant of the demote API surface.
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');
      try {
        bridge.demoteXiaToShape(99999);
        return { threw: false, message: '' };
      } catch (e) {
        return {
          threw: true,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    });
    expect(result.threw).toBe(true);
    // Engine produces "demoteXiaToShape: XIA not found" (D-γ wrapper
    // prepends method name) — verify both fragments survive marshalling.
    expect(result.message).toContain('demoteXiaToShape');
    expect(result.message).toContain('XIA not found');
  });

  test('snapshot section 7d additive bytes survive export → import round-trip', async ({ page }) => {
    // Verifies that ADR-091 D-ε's section 7d (xia_to_original_shape)
    // doesn't break legacy export/import in a real browser. The map
    // may be empty in this case (no promote happened) — the contract
    // is that bytes serialize and deserialize without corrupting other
    // sections (Shape state / Xias / Mesh).
    //
    // Also exercises the legacy-load path: import a snapshot into a
    // fresh-state scene and verify the bridge's xia_to_original_shape
    // section round-trips cleanly even when empty.
    const result = await page.evaluate(() => {
      const w = window as unknown as AxiaWindow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridge = w.__axia!.get<any>('bridge');

      // Capture initial state (whatever the boot scene looks like).
      const before = bridge.getStats();

      // Export → re-import same bytes (round-trip identity).
      const bytes = bridge.exportSnapshot();
      if (!bytes) {
        return {
          ok: false,
          reason: 'exportSnapshot returned null',
          before,
          after: null,
        };
      }
      const importOk = bridge.importSnapshot(bytes);
      if (!importOk) {
        return {
          ok: false,
          reason: 'importSnapshot returned false (section 7d may have broken bincode)',
          before,
          after: null,
        };
      }
      const after = bridge.getStats();
      return { ok: true, reason: '', before, after };
    });

    expect(result.ok).toBe(true);
    // Counts should be identical (round-trip identity).
    expect(result.after.faces).toBe(result.before.faces);
    expect(result.after.verts).toBe(result.before.verts);
    expect(result.after.edges).toBe(result.before.edges);
  });
});
