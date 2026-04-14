import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EraseTool } from './EraseTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      deleteFace: vi.fn(),
      deleteEdge: vi.fn(),
      getEdgeLines: vi.fn().mockReturnValue(new Float32Array([
        0, 0, 0, 10, 0, 0,  // segment 0
        10, 0, 0, 10, 10, 0, // segment 1
      ])),
    },
    viewport: {
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      scene: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    },
    selection: {
      handleClick: vi.fn(),
      clearSelection: vi.fn(),
    },
    getFaceId: vi.fn().mockReturnValue(5),
    syncMesh: vi.fn(),
    edgeMap: [10, 20, 30] as number[],
  } as any;
}

describe('EraseTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: EraseTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new EraseTool(ctx);
  });

  describe('name', () => {
    it('is "erase"', () => {
      expect(tool.name).toBe('erase');
    });
  });

  describe('isBusy', () => {
    it('always returns false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown - face deletion', () => {
    it('deletes face when face is hit', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      tool.onMouseDown({ clientX: 100, clientY: 200 } as MouseEvent, null);

      expect(ctx.getFaceId).toHaveBeenCalledWith(3);
      expect(ctx.bridge.deleteFace).toHaveBeenCalledWith(5);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does not delete if faceId is negative', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      ctx.getFaceId.mockReturnValue(-1);
      tool.onMouseDown({ clientX: 100, clientY: 200 } as MouseEvent, null);

      expect(ctx.bridge.deleteFace).not.toHaveBeenCalled();
    });
  });

  describe('onMouseDown - edge deletion', () => {
    it('deletes edge when edge is hit (no face)', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.viewport.pickEdge.mockReturnValue({ index: 2 }); // segment 1 (2/2=1), edgeMap[1]=20

      tool.onMouseDown({ clientX: 100, clientY: 200 } as MouseEvent, null);

      expect(ctx.bridge.deleteEdge).toHaveBeenCalledWith(20);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when nothing is hit', () => {
      tool.onMouseDown({ clientX: 100, clientY: 200 } as MouseEvent, null);
      expect(ctx.bridge.deleteFace).not.toHaveBeenCalled();
      expect(ctx.bridge.deleteEdge).not.toHaveBeenCalled();
    });
  });

  describe('onMouseMove - hover', () => {
    it('highlights face on hover', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(3);

      tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);

      expect(ctx.selection.handleClick).toHaveBeenCalledWith(3, false, false);
    });

    it('clears selection when nothing hit', () => {
      tool.onMouseMove({ clientX: 100, clientY: 200 } as MouseEvent, null);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('Escape cleans up', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('clears selection', () => {
      tool.cleanup();
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('onActivate / onDeactivate', () => {
    it('onActivate does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('onDeactivate cleans up', () => {
      tool.onDeactivate();
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });
});
