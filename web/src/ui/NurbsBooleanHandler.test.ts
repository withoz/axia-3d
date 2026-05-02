// ADR-027 Phase G3 — NURBS Boolean dispatch tests.
//
// Verifies that the BooleanHandler correctly routes BSplineSurface
// (kind=7) face pairs to the NURBS path, and falls back to the regular
// mesh boolean otherwise.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startBooleanOp, BooleanHandlerDeps } from './BooleanHandler';
import type { NurbsBooleanResult } from '../bridge/WasmBridge';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

const toastWarn = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('./Toast', () => ({
  Toast: {
    warning: (...args: unknown[]) => toastWarn(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

type MockBridge = {
  faceSurfaceKind?: (faceId: number) => number;
  nurbsBoolean?: (a: number, b: number, op: string) => NurbsBooleanResult | null;
  isFaceInVolume?: (faceId: number) => boolean;
  booleanOp?: (...args: unknown[]) => unknown;
};

function depsFor(opts: {
  selection: number[];
  faceSurfaceKind?: (faceId: number) => number;
  nurbsBoolean?: (a: number, b: number, op: string) => NurbsBooleanResult | null;
}): BooleanHandlerDeps {
  const bridge: MockBridge = {
    faceSurfaceKind: opts.faceSurfaceKind ? vi.fn(opts.faceSurfaceKind) : undefined,
    nurbsBoolean: opts.nurbsBoolean ? vi.fn(opts.nurbsBoolean) : undefined,
    // Default: no Volume info → all wall (regular path).
    isFaceInVolume: vi.fn().mockReturnValue(true),
    // Regular boolean path success
    booleanOp: vi.fn().mockReturnValue({
      ok: true,
      resultFaces: [99],
      totalVerts: 4,
      totalFaces: 1,
    }),
  };
  return {
    bridge: bridge as unknown as BooleanHandlerDeps['bridge'],
    toolManager: {
      syncMesh: vi.fn(),
      selection: {
        getSelectedFaces: vi.fn().mockReturnValue(opts.selection),
      },
    } as unknown as BooleanHandlerDeps['toolManager'],
  };
}

describe('ADR-027 Phase G3 — NURBS Boolean dispatch', () => {
  beforeEach(() => {
    toastWarn.mockClear();
    toastError.mockClear();
    toastInfo.mockClear();
  });

  it('two BSplineSurface faces → NURBS path (info Toast, no syncMesh)', () => {
    const nurbsResult: NurbsBooleanResult = {
      kind: 'ok',
      op: 'union',
      intersection_chains: 2,
      trim_a_count: 1,
      trim_b_count: 1,
      warning_open_chains_skipped: false,
      tangent_contact: false,
      is_disjoint: false,
    };
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7, // BSplineSurface
      nurbsBoolean: () => nurbsResult,
    });
    startBooleanOp(deps, 'union');
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0]![0]).toMatch(/NURBS 합집합/);
    expect(toastInfo.mock.calls[0]![0]).toMatch(/교차 체인: 2/);
    // Regular path NOT called
    expect((deps.bridge as MockBridge).booleanOp).not.toHaveBeenCalled();
    // No syncMesh — MVP doesn't mutate mesh
    expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
  });

  it('disjoint surfaces → toast says no intersection', () => {
    const result: NurbsBooleanResult = {
      kind: 'ok',
      op: 'subtract',
      intersection_chains: 0,
      trim_a_count: 0,
      trim_b_count: 0,
      warning_open_chains_skipped: false,
      tangent_contact: false,
      is_disjoint: true,
    };
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      nurbsBoolean: () => result,
    });
    startBooleanOp(deps, 'subtract');
    expect(toastInfo.mock.calls[0]![0]).toMatch(/교차하지 않습니다/);
  });

  it('engine error → friendly Korean Toast', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      nurbsBoolean: () => ({
        kind: 'error',
        reason: 'engine',
        detail: 'test failure',
      }),
    });
    startBooleanOp(deps, 'union');
    expect(toastError).toHaveBeenCalled();
    expect(toastError.mock.calls[0]![0]).toMatch(/NURBS Boolean 엔진 오류/);
    expect(toastError.mock.calls[0]![0]).toMatch(/test failure/);
  });

  it('engine missing nurbsBoolean → error toast', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      // nurbsBoolean omitted from bridge
    });
    startBooleanOp(deps, 'union');
    expect(toastError).toHaveBeenCalled();
    expect(toastError.mock.calls[0]![0]).toMatch(/WASM 엔진이 준비되지 않았습니다/);
  });

  it('unsupported_surface error → suggests BSplineSurface required', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      nurbsBoolean: () => ({
        kind: 'error',
        reason: 'unsupported_surface',
        detail: 'face A is not a BSplineSurface',
      }),
    });
    startBooleanOp(deps, 'intersect');
    expect(toastError.mock.calls[0]![0]).toMatch(/BSplineSurface가 아닙니다/);
  });

  it('warning flags → appended to ok Toast', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      nurbsBoolean: () => ({
        kind: 'ok',
        op: 'intersect',
        intersection_chains: 3,
        trim_a_count: 1,
        trim_b_count: 1,
        warning_open_chains_skipped: true,
        tangent_contact: true,
        is_disjoint: false,
      }),
    });
    startBooleanOp(deps, 'intersect');
    const msg = toastInfo.mock.calls[0]![0] as string;
    expect(msg).toMatch(/열린 체인 일부 생략/);
    expect(msg).toMatch(/접선 접촉 감지/);
  });

  it('mixed BSpline + regular face → warning, falls through to regular path', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: (id) => (id === 1 ? 7 : 0), // mismatched
      // nurbsBoolean returns ok but should NOT be called in mixed case
      nurbsBoolean: () => ({
        kind: 'ok',
        op: 'union',
        intersection_chains: 0,
        trim_a_count: 0,
        trim_b_count: 0,
        warning_open_chains_skipped: false,
        tangent_contact: false,
        is_disjoint: true,
      }),
    });
    startBooleanOp(deps, 'union');
    expect(toastWarn).toHaveBeenCalled();
    expect(toastWarn.mock.calls[0]![0]).toMatch(/모두 BSplineSurface여야 합니다/);
    // Falls through → regular booleanOp path
    expect((deps.bridge as MockBridge).booleanOp).toHaveBeenCalled();
  });

  it('NURBS path NOT taken when more than 2 faces selected', () => {
    const deps = depsFor({
      selection: [1, 2, 3],
      faceSurfaceKind: () => 7,
      nurbsBoolean: vi.fn() as unknown as (
        a: number,
        b: number,
        op: string,
      ) => NurbsBooleanResult,
    });
    startBooleanOp(deps, 'union');
    // Should fall through to regular path
    expect((deps.bridge as MockBridge).nurbsBoolean).not.toHaveBeenCalled();
    expect((deps.bridge as MockBridge).booleanOp).toHaveBeenCalled();
  });

  it('parse-failure (non-JSON engine response) → friendly error', () => {
    const deps = depsFor({
      selection: [1, 2],
      faceSurfaceKind: () => 7,
      nurbsBoolean: () => ({
        kind: 'error',
        reason: 'parse',
        detail: 'engine returned non-JSON',
      }),
    });
    startBooleanOp(deps, 'union');
    expect(toastError.mock.calls[0]![0]).toMatch(/엔진 응답 파싱 실패/);
  });
});
