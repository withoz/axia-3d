import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startBooleanOp, BooleanHandlerDeps } from './BooleanHandler';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

// Mock alert
const alertMock = vi.fn();
globalThis.alert = alertMock;

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
    alertMock.mockClear();
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

    it('alerts when fewer than 2 faces selected', () => {
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([1]);
      startBooleanOp(deps, 'subtract');
      expect(alertMock).toHaveBeenCalled();
      expect(deps.bridge.booleanOp).not.toHaveBeenCalled();
    });

    it('alerts when no faces selected', () => {
      (deps.toolManager.selection.getSelectedFaces as any).mockReturnValue([]);
      startBooleanOp(deps, 'intersect');
      expect(alertMock).toHaveBeenCalled();
    });

    it('alerts when bridge returns null', () => {
      (deps.bridge.booleanOp as any).mockReturnValue(null);
      startBooleanOp(deps, 'union');
      expect(alertMock).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
    });

    it('alerts when result.ok is false', () => {
      (deps.bridge.booleanOp as any).mockReturnValue({
        ok: false,
        error: 'Coplanar faces detected',
      });
      startBooleanOp(deps, 'subtract');
      expect(alertMock).toHaveBeenCalled();
      expect(deps.toolManager.syncMesh).not.toHaveBeenCalled();
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
