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

  // ════════════════════════════════════════════════════════════════════════
  // ADR-064 Step 6-γ (Path Z) — DCEL Boolean dispatch UI integration
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-064 Step 6-γ DCEL fast-path', () => {
    function setup2FaceSelection(): void {
      (deps.toolManager.selection.getSelectedFaces as any)
        .mockReturnValue([10, 20]);
    }

    it('Nurbs path with new faces calls syncMesh and shows success toast', () => {
      setup2FaceSelection();
      (deps.bridge as any).booleanDispatchDcel = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        dcel: {
          newFacesA: [100, 101],
          newFacesB: [102],
          removedFaces: [10, 20],
          preservedFaces: [],
          disjoint: false,
          robustnessClean: true,
        },
        nurbsAttempted: true,
        nurbsClean: true,
        intersectionChainCount: 1,
      });

      startBooleanOp(deps, 'subtract');

      expect((deps.bridge as any).booleanDispatchDcel)
        .toHaveBeenCalledWith(10, 20, 'subtract');
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
      expect(toastInfo).toHaveBeenCalled();
      const msg = toastInfo.mock.calls[0][0] as string;
      expect(msg).toContain('차집합');
      expect(msg).toContain('새 면 3');
      expect(msg).toContain('제거 면 2');
      // Legacy mesh path must NOT be invoked (DCEL handled it).
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Nurbs path with disjoint shows disjoint toast and skips syncMesh', () => {
      setup2FaceSelection();
      (deps.bridge as any).booleanDispatchDcel = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        dcel: {
          newFacesA: [], newFacesB: [],
          removedFaces: [], preservedFaces: [10, 20],
          disjoint: true, robustnessClean: true,
        },
        nurbsAttempted: true, nurbsClean: true,
        intersectionChainCount: 0,
      });

      startBooleanOp(deps, 'union');

      expect(toastInfo).toHaveBeenCalled();
      const msg = toastInfo.mock.calls[0][0] as string;
      expect(msg).toContain('교차하지 않습니다');
      expect(msg).toContain('합집합');
      // Disjoint = no mesh change → no syncMesh, no legacy fallback.
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Nurbs path with no closed loops shows D-H safe-only warning toast', () => {
      setup2FaceSelection();
      (deps.bridge as any).booleanDispatchDcel = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Nurbs',
        fallbackReason: null,
        dcel: {
          newFacesA: [], newFacesB: [],
          removedFaces: [], preservedFaces: [10, 20],
          disjoint: false,  // SSI ran but produced no closed loops
          robustnessClean: true,
        },
        nurbsAttempted: true, nurbsClean: true,
        intersectionChainCount: 1,
      });

      startBooleanOp(deps, 'intersect');

      expect(toastWarn).toHaveBeenCalled();
      const msg = toastWarn.mock.calls[0][0] as string;
      expect(msg).toContain('교차선만 검출');
      expect(msg).toContain('면 분할 미생성');
      // No syncMesh (no new faces), no legacy fallback (handled).
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('Mesh path (ineligible) falls through to legacy mesh boolean', () => {
      setup2FaceSelection();
      (deps.bridge as any).booleanDispatchDcel = vi.fn().mockReturnValue({
        kind: 'ok',
        pathUsed: 'Mesh',
        fallbackReason: { kind: 'SurfaceMissing', label: 'surface_missing' },
        dcel: null,
        nurbsAttempted: false, nurbsClean: false,
        intersectionChainCount: 0,
      });

      startBooleanOp(deps, 'union');

      // DCEL was called but declined; legacy mesh boolean must run.
      expect((deps.bridge as any).booleanDispatchDcel).toHaveBeenCalled();
      expect(deps.bridge.booleanOp).toHaveBeenCalled();
      // Legacy success → syncMesh + info toast (from existing path).
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('null bridge.booleanDispatchDcel falls through to legacy logic (graceful)', () => {
      setup2FaceSelection();
      // booleanDispatchDcel undefined → handler must fall through.
      expect((deps.bridge as any).booleanDispatchDcel).toBeUndefined();

      startBooleanOp(deps, 'subtract');

      // No DCEL toast / call. Legacy path executed.
      expect(deps.bridge.booleanOp).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).toHaveBeenCalled();
    });

    it('engine error envelope shows error toast and stops (no fallback)', () => {
      setup2FaceSelection();
      (deps.bridge as any).booleanDispatchDcel = vi.fn().mockReturnValue({
        kind: 'error',
        reason: 'engineErr',
        detail: 'face_a 999 not found',
      });

      startBooleanOp(deps, 'subtract');

      expect(toastError).toHaveBeenCalled();
      const msg = toastError.mock.calls[0][0] as string;
      expect(msg).toContain('engineErr');
      expect(msg).toContain('not found');
      // Error case → no syncMesh, no legacy fallback (explicit failure).
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });
  });
});
