import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EraseTool } from './EraseTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), show: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      deleteFace: vi.fn().mockReturnValue(true),
      deleteEdge: vi.fn().mockReturnValue(true),
      deleteEdgeCascade: vi.fn().mockReturnValue(2),
      batchDelete: vi.fn().mockReturnValue(true),
      mergeFacesByEdge: vi.fn().mockReturnValue(-1),  // legacy fallback path
      // Primary path: returns { merged, cascadedFaces, cascadedEdges }.
      // Tests that want to force the fallback override this with null.
      // 2026-04-27: Erase 도구는 batchEraseEdgesWithMerge (cascade-on-fail)
      //   를 default 로 호출. SOFT fallback 경로는 폐기.
      batchEraseEdgesWithMerge: vi.fn().mockReturnValue({
        merged: 0, cascadedFaces: 0, cascadedEdges: 0,
        softened: 0, synthesized: 0, desolidified: 0,
      }),
      previewEdgeEraseMerge: vi.fn().mockReturnValue(null),
      lastMergeFailureReason: vi.fn().mockReturnValue(''),
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
      pickEdgeOrFace: vi.fn().mockReturnValue(null),
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

/** Helper: pickEdgeOrFace가 face hit 반환하도록 설정 */
function mockFaceHit(ctx: ReturnType<typeof mockToolContext>, faceIndex: number) {
  ctx.viewport.pickEdgeOrFace.mockReturnValue({
    type: 'face',
    hit: { faceIndex },
  });
}

/** Helper: pickEdgeOrFace가 edge hit 반환하도록 설정 */
function mockEdgeHit(ctx: ReturnType<typeof mockToolContext>, segLineIndex: number) {
  ctx.viewport.pickEdgeOrFace.mockReturnValue({
    type: 'edge',
    hit: { index: segLineIndex },
  });
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
      mockFaceHit(ctx, 3);
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('single click — face deletion', () => {
    it('accumulates face on mousedown and deletes via batchDelete on mouseup', () => {
      mockFaceHit(ctx, 3);
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      expect(ctx.bridge.batchEraseEdgesWithMerge).not.toHaveBeenCalled();

      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.getFaceId).toHaveBeenCalledWith(3);
      expect(ctx.bridge.batchEraseEdgesWithMerge).toHaveBeenCalledWith([5], [], expect.any(Number), false);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does not delete if faceId is negative', () => {
      mockFaceHit(ctx, 3);
      ctx.getFaceId.mockReturnValue(-1);
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.bridge.batchEraseEdgesWithMerge).not.toHaveBeenCalled();
    });
  });

  describe('single click — edge deletion', () => {
    it('accumulates edge and deletes via batchDelete on mouseup', () => {
      mockEdgeHit(ctx, 2); // segment 1 → edgeMap[1]=20

      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      expect(ctx.bridge.batchEraseEdgesWithMerge).toHaveBeenCalledWith([], [20], expect.any(Number), false);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when nothing is hit', () => {
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      expect(ctx.bridge.batchEraseEdgesWithMerge).not.toHaveBeenCalled();
    });
  });

  describe('drag accumulation', () => {
    it('accumulates multiple faces during drag and deletes all on mouseup', () => {
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);

      mockFaceHit(ctx, 1);
      ctx.getFaceId.mockReturnValueOnce(100);
      tool.onMouseMove({ clientX: 10, clientY: 10 } as MouseEvent, null);

      mockFaceHit(ctx, 2);
      ctx.getFaceId.mockReturnValueOnce(101);
      tool.onMouseMove({ clientX: 20, clientY: 20 } as MouseEvent, null);

      mockFaceHit(ctx, 3);
      ctx.getFaceId.mockReturnValueOnce(102);
      tool.onMouseMove({ clientX: 30, clientY: 30 } as MouseEvent, null);

      tool.onMouseUp({ clientX: 30, clientY: 30 } as MouseEvent);

      expect(ctx.bridge.batchEraseEdgesWithMerge).toHaveBeenCalledTimes(1);
      const callArgs = ctx.bridge.batchEraseEdgesWithMerge.mock.calls[0];
      expect([...callArgs[0]].sort()).toEqual([100, 101, 102]);
      expect(callArgs[1]).toEqual([]);
      expect(callArgs[3]).toBe(false); // cascadeOnly
    });

    it('dedupes when hovering same face twice', () => {
      mockFaceHit(ctx, 1);
      ctx.getFaceId.mockReturnValue(100);
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);
      tool.onMouseMove({ clientX: 5, clientY: 5 } as MouseEvent, null);
      tool.onMouseMove({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);

      const callArgs = ctx.bridge.batchEraseEdgesWithMerge.mock.calls[0];
      expect(callArgs[0]).toEqual([100]);
    });

    it('Shift at mousedown forces cascade-only (no merge)', () => {
      mockEdgeHit(ctx, 1);
      tool.onMouseDown({ clientX: 10, clientY: 10, shiftKey: true } as any, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      const callArgs = ctx.bridge.batchEraseEdgesWithMerge.mock.calls[0];
      expect(callArgs[3]).toBe(true); // cascadeOnly flag
    });

    it('cascadeOnly state resets between gestures', () => {
      mockEdgeHit(ctx, 1);
      tool.onMouseDown({ clientX: 10, clientY: 10, shiftKey: true } as any, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      mockEdgeHit(ctx, 0);
      tool.onMouseDown({ clientX: 10, clientY: 10, shiftKey: false } as any, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      const calls = ctx.bridge.batchEraseEdgesWithMerge.mock.calls;
      expect(calls[0][3]).toBe(true);
      expect(calls[1][3]).toBe(false);
    });

    it('hover over edge that would merge calls previewEdgeEraseMerge and tints in merge color', () => {
      // No drag — just hover
      ctx.bridge.previewEdgeEraseMerge.mockReturnValue([100, 200]);
      mockEdgeHit(ctx, 0); // segment 0 → edgeMap[0]=10
      tool.onMouseMove({ clientX: 50, clientY: 50 } as MouseEvent, null);
      expect(ctx.bridge.previewEdgeEraseMerge).toHaveBeenCalledWith(10, expect.any(Number));
    });

    it('hover with Shift skips previewEdgeEraseMerge (cascade preview)', () => {
      ctx.bridge.previewEdgeEraseMerge.mockReturnValue([100, 200]);
      mockEdgeHit(ctx, 0);
      tool.onMouseMove({ clientX: 50, clientY: 50, shiftKey: true } as any, null);
      expect(ctx.bridge.previewEdgeEraseMerge).not.toHaveBeenCalled();
    });

    it('falls back to batchDelete when WASM lacks batchEraseEdgesWithMerge', () => {
      ctx.bridge.batchEraseEdgesWithMerge.mockReturnValue(null); // simulate missing
      mockEdgeHit(ctx, 0); // edge 10
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      expect(ctx.bridge.batchDelete).toHaveBeenCalled();
    });

    it('does NOT call batchEraseEdgesSoftFallback (SOFT fallback policy retired 2026-04-27)', () => {
      // Regression guard — 사용자 보고 "엣지는 사라지는데 면이 안없어진다"
      // 의 원인이었던 SOFT fallback 경로가 다시 default 로 잠입하지 않게 막음.
      // batchEraseEdgesSoftFallback 자체는 WasmBridge 에 남아 있지만 (다른
      // 명시적 명령을 위해) Erase 도구가 호출해서는 안 된다.
      ctx.bridge.batchEraseEdgesSoftFallback = vi.fn();
      mockEdgeHit(ctx, 0);
      tool.onMouseDown({ clientX: 10, clientY: 10 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 10, clientY: 10 } as MouseEvent);
      expect(ctx.bridge.batchEraseEdgesSoftFallback).not.toHaveBeenCalled();
      expect(ctx.bridge.batchEraseEdgesWithMerge).toHaveBeenCalled();
    });

    it('Escape during drag cancels accumulation without deleting', () => {
      mockFaceHit(ctx, 1);
      tool.onMouseDown({ clientX: 0, clientY: 0 } as MouseEvent, null);
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(tool.isBusy()).toBe(false);
      tool.onMouseUp({ clientX: 0, clientY: 0 } as MouseEvent);
      expect(ctx.bridge.batchEraseEdgesWithMerge).not.toHaveBeenCalled();
    });
  });

  describe('hover (not dragging)', () => {
    it('adds face hover overlay when hovering a face', () => {
      mockFaceHit(ctx, 0);
      ctx.getFaceId.mockReturnValue(5);
      tool.onMouseMove({ clientX: 50, clientY: 50 } as MouseEvent, null);
      expect(ctx.viewport.scene.add).toHaveBeenCalled();
    });

    it('adds edge hover overlay when hovering an edge (no face)', () => {
      mockEdgeHit(ctx, 0);
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
      expect(cursor).toContain('crosshair');
    });

    it('restores default cursor on deactivate', () => {
      tool.onActivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).not.toBe('');
      tool.onDeactivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('');
    });
  });
});
