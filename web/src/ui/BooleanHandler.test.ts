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
});
