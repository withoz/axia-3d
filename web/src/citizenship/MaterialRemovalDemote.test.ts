/**
 * ADR-091 D-δ — Material Removal → Shape 가역 강등 (UI orchestration)
 * regression coverage. Tests the helper that fans face_ids → unique
 * Xia ids → demote attempts, exercising both success and partial-
 * failure paths so the Inspector wiring stays stable across refactors.
 *
 * Out of scope here (covered elsewhere):
 *   - WASM endpoint signature → axia-wasm step6_additive_only.rs (D-γ)
 *   - JSON parse / strict throw → WasmBridge.test.ts (D-γ)
 *   - Toast action button DOM → Toast.test.ts (D-δ +1 test)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  attemptMaterialRemovalDemote,
  resolveOwningXiaIds,
} from './MaterialRemovalDemote';
import type { WasmBridge } from '../bridge/WasmBridge';

/**
 * Build a stub `WasmBridge` exposing only the surface this helper
 * uses. Cast-as-WasmBridge keeps the test light without ts-ignore.
 */
function makeBridgeStub(opts: {
  faceToXia?: Record<number, number>;
  demoteFn?: (xid: number) => { shapeId: number; originalIdRestored: boolean };
}): WasmBridge {
  const faceToXia = opts.faceToXia ?? {};
  return {
    getXiaForFace: vi.fn((fid: number) => {
      const x = faceToXia[fid];
      return x === undefined ? -1 : x;
    }),
    demoteXiaToShape: vi.fn((xid: number) => {
      if (opts.demoteFn) return opts.demoteFn(xid);
      return { shapeId: xid + 100, originalIdRestored: true };
    }),
  } as unknown as WasmBridge;
}

describe('ADR-091 D-δ resolveOwningXiaIds', () => {
  it('returns the unique XiaIds owning the supplied faces', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 10: 1, 11: 1, 20: 2 },
    });
    expect(resolveOwningXiaIds(bridge, [10, 11, 20])).toEqual([1, 2]);
  });

  it('skips faces with no owning Xia (form-layer Shapes / strays)', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 10: 1 }, // face 99 has no owning Xia
    });
    expect(resolveOwningXiaIds(bridge, [10, 99])).toEqual([1]);
  });

  it('preserves first-encounter order across duplicates', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 1: 5, 2: 7, 3: 5, 4: 9 },
    });
    expect(resolveOwningXiaIds(bridge, [1, 2, 3, 4])).toEqual([5, 7, 9]);
  });

  it('returns empty for empty face list', () => {
    const bridge = makeBridgeStub({});
    expect(resolveOwningXiaIds(bridge, [])).toEqual([]);
  });
});

describe('ADR-091 D-δ attemptMaterialRemovalDemote', () => {
  it('demotes each owning Xia exactly once and reports outcomes', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 10: 1, 11: 1, 20: 2 },
      demoteFn: (xid) => ({
        shapeId: xid * 10,
        originalIdRestored: xid === 1,
      }),
    });
    const r = attemptMaterialRemovalDemote(bridge, [10, 11, 20]);

    expect(r.visited).toEqual([1, 2]);
    expect(r.demoted).toEqual([
      { xiaId: 1, shapeId: 10, originalIdRestored: true },
      { xiaId: 2, shapeId: 20, originalIdRestored: false },
    ]);
    expect(r.errors).toEqual([]);
    expect(bridge.demoteXiaToShape).toHaveBeenCalledTimes(2);
  });

  it('partial failure: collects engine throw, still reports successful demotes', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 10: 1, 20: 2 },
      demoteFn: (xid) => {
        if (xid === 2) {
          throw new Error('demoteXiaToShape: Xia material is not the form-layer sentinel (FORM_MATERIAL)');
        }
        return { shapeId: xid + 100, originalIdRestored: true };
      },
    });
    const r = attemptMaterialRemovalDemote(bridge, [10, 20]);

    expect(r.demoted).toHaveLength(1);
    expect(r.demoted[0].xiaId).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('form-layer sentinel');
    expect(r.visited).toEqual([1, 2]);
  });

  it('skips faces with no owning Xia entirely (no demote call)', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 10: 1 },
      // face 99 unowned
    });
    const r = attemptMaterialRemovalDemote(bridge, [10, 99]);
    expect(r.demoted).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
    // Only one Xia visited → only one demote call.
    expect(bridge.demoteXiaToShape).toHaveBeenCalledTimes(1);
  });

  it('no-op for empty face list', () => {
    const bridge = makeBridgeStub({});
    const r = attemptMaterialRemovalDemote(bridge, []);
    expect(r.visited).toEqual([]);
    expect(r.demoted).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(bridge.demoteXiaToShape).not.toHaveBeenCalled();
  });

  it('does not call demote for a Xia twice when shared faces are passed', () => {
    const bridge = makeBridgeStub({
      faceToXia: { 1: 7, 2: 7, 3: 7, 4: 7 }, // all 4 faces same Xia
    });
    const r = attemptMaterialRemovalDemote(bridge, [1, 2, 3, 4]);
    expect(r.demoted).toHaveLength(1);
    expect(bridge.demoteXiaToShape).toHaveBeenCalledTimes(1);
  });
});
