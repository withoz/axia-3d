import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startBooleanOp, BooleanHandlerDeps } from './BooleanHandler';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

// Toast는 전역으로 Mock — alert 대체 후 이 mock들이 실패 경로를 검증
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

function mockDeps(): BooleanHandlerDeps {
  return {
    bridge: {
      booleanOp: vi.fn().mockReturnValue({
        ok: true,
        resultFaces: [1, 2, 3],
        totalVerts: 12,
        totalFaces: 4,
      }),
    } as any,
    toolManager: {
      syncMesh: vi.fn(),
      selection: {
        getSelectedFaces: vi.fn().mockReturnValue([1, 2, 3, 4]),
      },
    } as any,
  };
}

describe('BooleanHandler', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    deps = mockDeps();
    toastWarn.mockClear();
    toastError.mockClear();
    toastInfo.mockClear();
  });

  describe('startBooleanOp', () => {
    it('splits selection into A and B groups', () => {
      startBooleanOp(deps, 'union');
      // 4 faces → A=[1,2], B=[3,4]
      expect(deps.bridge.booleanOp).toHaveBeenCalledWith([1, 2], [3, 4], 'union');
    });

    it('calls syncMesh on success', () => {
      startBooleanOp(deps, 'union');
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('warns when fewer than 2 faces selected', () => {
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([1]);
      startBooleanOp(deps, 'subtract');
      expect(toastWarn).toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('warns when no faces selected', () => {
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([]);
      startBooleanOp(deps, 'intersect');
      expect(toastWarn).toHaveBeenCalled();
    });

    it('errors when bridge returns null', () => {
      (deps.bridge.booleanOp as any).mockReturnValue(null);
      startBooleanOp(deps, 'union');
      expect(toastError).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('errors when result.ok is false', () => {
      (deps.bridge.booleanOp as any).mockReturnValue({
        ok: false,
        error: 'Coplanar faces detected',
      });
      startBooleanOp(deps, 'subtract');
      expect(toastError).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('translates hole-rejection error into friendly Korean message', () => {
      (deps.bridge.booleanOp as any).mockReturnValue({
        ok: false,
        error: 'boolean: face FaceId(42) has 1 hole(s) — multi-loop boolean not yet supported',
      });
      startBooleanOp(deps, 'union');
      expect(toastError).toHaveBeenCalled();
      const msg = toastError.mock.calls[0][0] as string;
      expect(msg).toContain('구멍');
      expect(msg).toContain('Boolean');
    });

    it('shows success toast on ok result', () => {
      startBooleanOp(deps, 'union');
      expect(toastInfo).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('works with subtract operation', () => {
      startBooleanOp(deps, 'subtract');
      expect(deps.bridge.booleanOp).toHaveBeenCalledWith([1, 2], [3, 4], 'subtract');
    });

    it('works with intersect operation', () => {
      startBooleanOp(deps, 'intersect');
      expect(deps.bridge.booleanOp).toHaveBeenCalledWith([1, 2], [3, 4], 'intersect');
    });

    it('handles odd number of faces (ceil split)', () => {
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([1, 2, 3]);
      startBooleanOp(deps, 'union');
      // 3 faces → A=[1,2], B=[3]
      expect(deps.bridge.booleanOp).toHaveBeenCalledWith([1, 2], [3], 'union');
    });
  });

  // ADR-076 Step 1 — Removed: ADR-064 Step 6-γ DCEL fast-path test
  // group. The single-face fast-path was superseded by ADR-066 Y-4
  // multi DCEL fast-path (Y-1 1×1 degenerate handles 2-face case via
  // Path Z internally). Tests targeting the now-unreachable single
  // path were tied to mock setups that the multi path no longer
  // honors (different bridge method).

  // ════════════════════════════════════════════════════════════════════════
  // ADR-066 Y-4 (Path Y) — Multi DCEL Boolean dispatch UI integration
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-066 Y-4 multi DCEL fast-path', () => {
    function setupMultiSelection(faces: number[] = [10, 20, 30, 40]): void {
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue(faces);
    }

    it('Nurbs path with new faces calls syncMesh and shows success toast', () => {
      setupMultiSelection([10, 20, 30, 40]);  // half/half: A=[10,20], B=[30,40]
      (deps.bridge as any).booleanDispatchDcelMulti = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 10, faceB: 30, outcome: { kind: 'ok', dcel: {
            newFacesA: [100], newFacesB: [],
            removedFaces: [10], preservedFaces: [],
            disjoint: false, robustnessClean: true,
          } } },
          { faceA: 10, faceB: 40, outcome: { kind: 'ok', dcel: {
            newFacesA: [], newFacesB: [],
            removedFaces: [], preservedFaces: [10, 40],
            disjoint: true, robustnessClean: true,
          } } },
          { faceA: 20, faceB: 30, outcome: { kind: 'ok', dcel: {
            newFacesA: [101], newFacesB: [],
            removedFaces: [20], preservedFaces: [],
            disjoint: false, robustnessClean: true,
          } } },
          { faceA: 20, faceB: 40, outcome: { kind: 'ok', dcel: {
            newFacesA: [], newFacesB: [],
            removedFaces: [], preservedFaces: [20, 40],
            disjoint: true, robustnessClean: true,
          } } },
        ],
        allNewFaces: [100, 101],
        allRemovedFaces: [10, 20],
        warnings: [],
      });

      startBooleanOp(deps, 'subtract');

      expect((deps.bridge as any).booleanDispatchDcelMulti)
        .toHaveBeenCalledWith([10, 20], [30, 40], 'subtract');
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(toastInfo).toHaveBeenCalled();
      const msg = toastInfo.mock.calls[0][0] as string;
      expect(msg).toContain('차집합');
      expect(msg).toContain('multi');
      expect(msg).toContain('새 면 2');
      expect(msg).toContain('제거 면 2');
      expect(msg).toContain('4/4');  // all 4 pairs succeeded
      // Legacy mesh path must NOT be invoked.
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Nurbs path with all-disjoint pairs shows info toast and skips syncMesh', () => {
      setupMultiSelection([10, 20, 30, 40]);
      (deps.bridge as any).booleanDispatchDcelMulti = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 10, faceB: 30, outcome: { kind: 'ok', dcel: {
            newFacesA: [], newFacesB: [],
            removedFaces: [], preservedFaces: [10, 30],
            disjoint: true, robustnessClean: true,
          } } },
          { faceA: 10, faceB: 40, outcome: { kind: 'ok', dcel: {
            newFacesA: [], newFacesB: [],
            removedFaces: [], preservedFaces: [10, 40],
            disjoint: true, robustnessClean: true,
          } } },
        ],
        allNewFaces: [],
        allRemovedFaces: [],
        warnings: [],
      });

      startBooleanOp(deps, 'union');

      expect(toastInfo).toHaveBeenCalled();
      const msg = toastInfo.mock.calls[0][0] as string;
      expect(msg).toContain('교차하지 않거나');
      expect(msg).toContain('multi');
      expect(msg).toContain('합집합');
      // No syncMesh (no actual mesh change), no legacy fallback.
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Nurbs path with partial failures shows warning toast and syncs mesh', () => {
      setupMultiSelection([10, 20, 30, 40]);
      (deps.bridge as any).booleanDispatchDcelMulti = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 10, faceB: 30, outcome: { kind: 'ok', dcel: {
            newFacesA: [100], newFacesB: [],
            removedFaces: [10], preservedFaces: [],
            disjoint: false, robustnessClean: true,
          } } },
          { faceA: 10, faceB: 40, outcome: {
            kind: 'err',
            detail: 'InactiveFace: face_a FaceId(10) is inactive',
          } },
        ],
        allNewFaces: [100],
        allRemovedFaces: [10],
        warnings: ['pair (FaceId(10), FaceId(40)): InactiveFace cascade'],
      });

      startBooleanOp(deps, 'subtract');

      // Partial success → warning + syncMesh (per Y-4-d=(a)).
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(toastWarn).toHaveBeenCalled();
      const msg = toastWarn.mock.calls[0][0] as string;
      expect(msg).toContain('부분 성공');
      expect(msg).toContain('1/2');  // 1 success of 2 pairs
      expect(msg).toContain('InactiveFace');
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Mesh path (Y-E ineligible) falls through to legacy mesh boolean', () => {
      setupMultiSelection([10, 20, 30, 40]);
      (deps.bridge as any).booleanDispatchDcelMulti = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Mesh',
        fallbackReason: { kind: 'SurfaceMissing', label: 'surface_missing' },
        perPair: [],
        allNewFaces: [],
        allRemovedFaces: [],
        warnings: ['Y-E strict: face missing surface'],
      });

      startBooleanOp(deps, 'union');

      // Multi declined; legacy mesh boolean must run.
      expect((deps.bridge as any).booleanDispatchDcelMulti).toHaveBeenCalled();
      expect(deps.bridge.booleanOp).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('null bridge.booleanDispatchDcelMulti falls through (graceful)', () => {
      setupMultiSelection([10, 20, 30, 40]);
      // booleanDispatchDcelMulti undefined.
      expect((deps.bridge as any).booleanDispatchDcelMulti).toBeUndefined();

      startBooleanOp(deps, 'subtract');

      // No DCEL toast/call. Legacy path executed.
      expect(deps.bridge.booleanOp).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('engine error envelope shows error toast and stops (no fallback)', () => {
      setupMultiSelection([10, 20, 30, 40]);
      (deps.bridge as any).booleanDispatchDcelMulti = vi.fn().mockReturnValue({
        kind: 'error',
        reason: 'engineErr',
        detail: 'face_a 999 not found',
      });

      startBooleanOp(deps, 'subtract');

      expect(toastError).toHaveBeenCalled();
      const msg = toastError.mock.calls[0][0] as string;
      expect(msg).toContain('multi');
      expect(msg).toContain('engineErr');
      expect(msg).toContain('not found');
      // Error → no syncMesh, no legacy fallback.
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });
  });
});
