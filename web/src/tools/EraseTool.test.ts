import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EraseTool } from './EraseTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      deleteFace: vi.fn().mockReturnValue(true),
      deleteEdge: vi.fn().mockReturnValue(true),
      deleteEdgeCascade: vi.fn().mockReturnValue(2),
      batchDelete: vi.fn().mockReturnValue(true),
      getEdgeLines: vi.fn().mockReturnValue(new Float32Array([
        0, 0, 0, 10, 0, 0,  // segment 0 → edgeMap[0]=10
        10, 0, 0, 10, 10, 0, // segment 1 → edgeMap[1]=20
      ])),
      getMeshBuffers: vi.fn().mockReturnValue({
        positions: new Float32Array([
          0, 0, 0,  1, 0, 0,  1, 1, 0,  // face 5 tri 0
          0, 0, 0,  1, 1, 0,  0, 1, 0,  // face 5 tri 1
          2, 0, 0,  3, 0, 0,  3, 1, 0,  // face 7 tri 0
        ]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
        faceMap: new Uint32Array([5, 5, 7]),
      }),
    },
    viewport: {
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      scene: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      renderer: {
        domElement: {
          style: { cursor: '' },
        },
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
    it('returns false when idle', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('returns true during drag', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('single click — face deletion', () => {
    it('accumulates face on mousedown and deletes via batchDelete on mouseup', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      // mousedown만으로는 아직 삭제 안 됨 (드래그 가능성 대기)
      expect(ctx.bridge.batchDelete).not.toHaveBeenCalled();

      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.getFaceId).toHaveBeenCalledWith(3);
      // batchDelete가 face 1개 + edges 없음으로 호출됨
      expect(ctx.bridge.batchDelete).toHaveBeenCalledWith([5], []);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does not delete if faceId is negative', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      ctx.getFaceId.mockReturnValue(-1);
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.bridge.batchDelete).not.toHaveBeenCalled();
    });
  });

  describe('single click — edge deletion', () => {
    it('accumulates edge and deletes via batchDelete on mouseup', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.viewport.pickEdge.mockReturnValue({ index: 2 }); // segment 1 → edgeMap[1]=20

      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.bridge.batchDelete).toHaveBeenCalledWith([], [20]);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when nothing is hit', () => {
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      expect(ctx.bridge.batchDelete).not.toHaveBeenCalled();
    });
  });

  describe('drag accumulation', () => {
    it('accumulates multiple faces during drag and deletes all on mouseup', () => {
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);
      // 드래그 중 여러 face hover
      ctx.viewport.pick.mockReturnValue({ faceIndex: 1 });
      ctx.getFaceId.mockReturnValueOnce(100);
      tool.onMouseMove({ clientX: 10, clientY: 10 } as MouseEvent, null);

      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValueOnce(101);
      tool.onMouseMove({ clientX: 20, clientY: 20 } as MouseEvent, null);

      ctx.viewport.pick.mockReturnValue({ faceIndex: 3 });
      ctx.getFaceId.mockReturnValueOnce(102);
      tool.onMouseMove({ clientX: 30, clientY: 30 } as MouseEvent, null);

      tool.onMouseUp({ clientX: 30, clientY: 30 } as MouseEvent);

      // batchDelete가 누적된 모든 face로 한 번 호출됨 (단일 undo)
      expect(ctx.bridge.batchDelete).toHaveBeenCalledTimes(1);
      const callArgs = ctx.bridge.batchDelete.mock.calls[0];
      expect(callArgs[0].sort()).toEqual([100, 101, 102]);
      expect(callArgs[1]).toEqual([]);
    });

    it('dedupes when hovering same face twice', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 1 });
      ctx.getFaceId.mockReturnValue(100);
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);
      tool.onMouseMove({ clientX: 5, clientY: 5 } as MouseEvent, null);
      tool.onMouseMove({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      const callArgs = ctx.bridge.batchDelete.mock.calls[0];
      expect(callArgs[0]).toEqual([100]); // 1번만
    });

    it('Escape during drag cancels accumulation without deleting', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 1 });
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(tool.isBusy()).toBe(false);
      // mouseup 이후에도 삭제 안 됨
      tool.onMouseUp({ clientX: 0, clientY: 0 } as MouseEvent);
      expect(ctx.bridge.batchDelete).not.toHaveBeenCalled();
    });
  });

  describe('hover (not dragging)', () => {
    it('adds face hover overlay when hovering a face', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 0 });
      ctx.getFaceId.mockReturnValue(5);
      tool.onMouseMove({ clientX: 50, clientY: 50 } as MouseEvent, null);
      // 빨간 overlay가 scene에 추가됨
      expect(ctx.viewport.scene.add).toHaveBeenCalled();
    });

    it('adds edge hover overlay when hovering an edge (no face)', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.viewport.pickEdge.mockReturnValue({ index: 0 });
      tool.onMouseMove({ clientX: 50, clientY: 50 } as MouseEvent, null);
      expect(ctx.viewport.scene.add).toHaveBeenCalled();
    });
  });

  describe('cleanup / deactivate', () => {
    it('cleanup clears selection and drag state', () => {
      tool.cleanup();
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });

    it('onDeactivate cleans up', () => {
      tool.onDeactivate();
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });

    it('Escape when idle cleans up', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('onActivate / cursor', () => {
    it('does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('sets circular erase cursor on activate', () => {
      tool.onActivate();
      const cursor = ctx.viewport.renderer.domElement.style.cursor;
      expect(cursor).toContain('svg');
      expect(cursor).toContain('crosshair'); // fallback
    });

    it('restores default cursor on deactivate', () => {
      tool.onActivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).not.toBe('');
      tool.onDeactivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('');
    });
  });
});
