import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as THREE from 'three';
import { MoveTool } from './MoveTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      translateFaces: vi.fn(),
      translateVerts: vi.fn(),
      getEdgeEndpoints: vi.fn().mockReturnValue([] as number[]),
      findVertexIdAt: vi.fn().mockReturnValue(-1),
    },
    viewport: {
      activeCamera: new THREE.PerspectiveCamera(),
    },
    selection: {
      getSelectedFaces: vi.fn().mockReturnValue([1, 2]),
      getSelectedEdges: vi.fn().mockReturnValue([]),
    },
    getSelectedFaces: vi.fn().mockReturnValue([1, 2]),
    syncMesh: vi.fn(),
    dimLabel: {
      update: vi.fn(),
      clear: vi.fn(),
    },
    units: {
      format: vi.fn().mockReturnValue('100mm'),
    },
    axisLock: null as string | null,
    inferredAxis: null as string | null,
    get3DPoint: vi.fn(),
    getFaceId: vi.fn(),
    edgeMap: null,
  } as any;
}

describe('MoveTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: MoveTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new MoveTool(ctx);
  });

  describe('name', () => {
    it('is "move"', () => {
      expect(tool.name).toBe('move');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('becomes true during drag', () => {
      const point = new THREE.Vector3(10, 0, 0);
      tool.onMouseDown({ button: 0 } as any, point);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('onMouseDown', () => {
    it('starts transform when faces selected and point exists', () => {
      const point = new THREE.Vector3(10, 0, 0);
      tool.onMouseDown({} as MouseEvent, point);
      expect(tool.isBusy()).toBe(true);
    });

    it('does nothing when nothing selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when point is null', () => {
      tool.onMouseDown({} as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when already active', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      ctx.bridge.facesCentroid.mockClear();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      expect(ctx.bridge.facesCentroid).not.toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('translates faces during drag', () => {
      const startPt = new THREE.Vector3(0, 0, 0);
      tool.onMouseDown({} as MouseEvent, startPt);

      const movePt = new THREE.Vector3(100, 0, 0);
      tool.onMouseMove({} as MouseEvent, movePt);

      expect(ctx.bridge.translateFaces).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
      expect(ctx.dimLabel.update).toHaveBeenCalled();
    });

    it('does nothing when not active', () => {
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      expect(ctx.bridge.translateFaces).not.toHaveBeenCalled();
    });
  });

  describe('CAD-style 2-click commit', () => {
    it('mouseup does NOT end transform (CAD 2-click flow)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
      tool.onMouseUp({} as MouseEvent);
      // mouseup 은 끝나지 않음 — 2nd click 을 기다림.
      expect(tool.isBusy()).toBe(true);
    });

    it('second mousedown ends transform (commit)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
      // 2nd click → commit
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });

  describe('applyVCBValue', () => {
    it('translates along x axis by default', () => {
      tool.applyVCBValue(500);
      expect(ctx.bridge.translateFaces).toHaveBeenCalledWith([1, 2], 500, 0, 0);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('translates along locked axis', () => {
      ctx.axisLock = 'y';
      tool.applyVCBValue(300);
      expect(ctx.bridge.translateFaces).toHaveBeenCalledWith([1, 2], 0, 300, 0);
    });

    it('translates along z axis', () => {
      ctx.axisLock = 'z';
      tool.applyVCBValue(200);
      expect(ctx.bridge.translateFaces).toHaveBeenCalledWith([1, 2], 0, 0, 200);
    });

    it('uses inferred axis when no lock', () => {
      ctx.inferredAxis = 'y';
      tool.applyVCBValue(100);
      expect(ctx.bridge.translateFaces).toHaveBeenCalledWith([1, 2], 0, 100, 0);
    });

    it('does nothing when nothing selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      tool.applyVCBValue(500);
      expect(ctx.bridge.translateFaces).not.toHaveBeenCalled();
      expect(ctx.bridge.translateVerts).not.toHaveBeenCalled();
    });
  });

  describe('edge movement', () => {
    beforeEach(() => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10, 20]);
      // edge 10 → verts [1,2], edge 20 → verts [2,3] (shared vert 2)
      ctx.bridge.getEdgeEndpoints.mockImplementation((eid: number) => {
        if (eid === 10) return [1, 2];
        if (eid === 20) return [2, 3];
        return [];
      });
    });

    it('drags edges by translating their vertices (deduped)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      expect(ctx.bridge.translateVerts).toHaveBeenCalled();
      const call = (ctx.bridge.translateVerts as Mock).mock.calls[0];
      const vertIds = (call[0] as number[]).slice().sort();
      expect(vertIds).toEqual([1, 2, 3]); // dedup
      expect(ctx.bridge.translateFaces).not.toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('VCB applies to edges along axis lock', () => {
      ctx.axisLock = 'z';
      tool.applyVCBValue(50);
      expect(ctx.bridge.translateVerts).toHaveBeenCalled();
      const call = (ctx.bridge.translateVerts as Mock).mock.calls[0];
      expect(call[1]).toBe(0); expect(call[2]).toBe(0); expect(call[3]).toBe(50);
    });

    it('faces take priority over edges when both selected', () => {
      ctx.getSelectedFaces.mockReturnValue([7, 8]);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      expect(ctx.bridge.translateFaces).toHaveBeenCalled();
      expect(ctx.bridge.translateVerts).not.toHaveBeenCalled();
    });
  });

  describe('vertex pick (no selection, cursor on vertex)', () => {
    it('uses findVertexIdAt fallback to grab single vertex', () => {
      // No face/edge selected
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      ctx.bridge.findVertexIdAt.mockReturnValue(42);

      tool.onMouseDown(
        { clientX: 100, clientY: 100 } as MouseEvent,
        new THREE.Vector3(10, 0, 20),
      );
      expect(ctx.bridge.findVertexIdAt).toHaveBeenCalledWith(10, 0, 20, 1.0);
      expect(tool.isBusy()).toBe(true);

      // Drag → translateVerts called for the picked vertex
      tool.onMouseMove(
        { clientX: 200, clientY: 100 } as MouseEvent,
        new THREE.Vector3(20, 0, 20),
      );
      expect(ctx.bridge.translateVerts).toHaveBeenCalled();
      const call = ctx.bridge.translateVerts.mock.calls[0];
      expect(call[0]).toEqual([42]);
    });

    it('shows hint Toast when no selection AND no vertex at cursor', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      ctx.bridge.findVertexIdAt.mockReturnValue(-1);

      tool.onMouseDown(
        { clientX: 100, clientY: 100 } as MouseEvent,
        new THREE.Vector3(10, 0, 20),
      );
      expect(tool.isBusy()).toBe(false);
    });

    it('selection takes precedence over vertex pick', () => {
      // faces selected — should NOT call findVertexIdAt
      ctx.getSelectedFaces.mockReturnValue([5]);
      tool.onMouseDown(
        { clientX: 100, clientY: 100 } as MouseEvent,
        new THREE.Vector3(10, 0, 20),
      );
      expect(ctx.bridge.findVertexIdAt).not.toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('Escape cleans up', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('resets state and clears dim label', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });
});
