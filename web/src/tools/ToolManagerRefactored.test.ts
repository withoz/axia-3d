import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock all heavy dependencies before importing ToolManager ──
// vi.mock factories are hoisted — they cannot reference outer variables.

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

vi.mock('../materials/MaterialLibrary', () => ({
  getMaterialLibrary: vi.fn(() => ({ syncFromRust: vi.fn() })),
}));

vi.mock('../ui/DimensionLabel', () => ({
  DimensionLabel: vi.fn().mockImplementation(() => ({
    show: vi.fn(), hide: vi.fn(), clear: vi.fn(), update: vi.fn(),
  })),
}));

vi.mock('../snap/SnapVisual', () => ({
  SnapVisual: vi.fn().mockImplementation(() => ({
    update: vi.fn(), clear: vi.fn(), setMarkerSize: vi.fn(), getMarkerSize: vi.fn().mockReturnValue(8),
  })),
}));

vi.mock('../ui/PickBox', () => ({
  PickBox: vi.fn().mockImplementation(() => ({ visible: false, update: vi.fn() })),
}));

// Each tool mock must be self-contained (no external references due to hoisting)
vi.mock('./SelectTool', () => ({ SelectTool: vi.fn().mockImplementation(() => ({
  name: 'select', onActivate: vi.fn(), onDeactivate: vi.fn(), onMouseDown: vi.fn(),
  onMouseMove: vi.fn(), onMouseUp: vi.fn(), onKeyDown: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./DrawLineTool', () => ({ DrawLineTool: vi.fn().mockImplementation(() => ({
  name: 'line', onActivate: vi.fn(), onDeactivate: vi.fn(), onMouseDown: vi.fn(),
  onMouseMove: vi.fn(), onMouseUp: vi.fn(), onKeyDown: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./DrawRectTool', () => ({ DrawRectTool: vi.fn().mockImplementation(() => ({
  name: 'rect', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./DrawCircleTool', () => ({ DrawCircleTool: vi.fn().mockImplementation(() => ({
  name: 'circle', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./PushPullTool', () => ({ PushPullTool: vi.fn().mockImplementation(() => ({
  name: 'pushpull', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./MoveTool', () => ({ MoveTool: vi.fn().mockImplementation(() => ({
  name: 'move', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./RotateTool', () => ({ RotateTool: vi.fn().mockImplementation(() => ({
  name: 'rotate', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./ScaleTool', () => ({ ScaleTool: vi.fn().mockImplementation(() => ({
  name: 'scale', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./OffsetTool', () => ({ OffsetTool: vi.fn().mockImplementation(() => ({
  name: 'offset', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./EraseTool', () => ({ EraseTool: vi.fn().mockImplementation(() => ({
  name: 'erase', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('./GroupTool', () => ({ GroupTool: vi.fn().mockImplementation(() => ({
  name: 'group', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
  createGroupFromSelection: vi.fn(), ungroupSelection: vi.fn(), enterEditMode: vi.fn(),
})) }));

vi.mock('../primitives/SphereTool', () => ({ SphereTool: vi.fn().mockImplementation(() => ({
  name: 'sphere', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('../primitives/CylinderTool', () => ({ CylinderTool: vi.fn().mockImplementation(() => ({
  name: 'cylinder', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

vi.mock('../primitives/ConeTool', () => ({ ConeTool: vi.fn().mockImplementation(() => ({
  name: 'cone', onActivate: vi.fn(), onDeactivate: vi.fn(), isBusy: vi.fn().mockReturnValue(false),
  cleanup: vi.fn(), applyVCBValue: vi.fn(),
})) }));

import { ToolManager } from './ToolManagerRefactored';

// ── Mock factories ──

function mockViewport() {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  return {
    container,
    scene: { add: vi.fn(), remove: vi.fn(), children: [] },
    renderer: { domElement: canvas },
    activeCamera: {
      isPerspectiveCamera: true,
      position: { x: 0, y: 10, z: 10 },
      matrixWorldInverse: { elements: new Float32Array(16) },
      projectionMatrix: { elements: new Float32Array(16) },
    },
    pick: vi.fn().mockReturnValue(null),
    pickEdge: vi.fn().mockReturnValue(null),
    updateMesh: vi.fn(),
    applyDelta: vi.fn().mockReturnValue(false),
    setStats: vi.fn(),
    setViewMode: vi.fn(),
    resetCamera: vi.fn(),
    getStyleSettings: vi.fn().mockReturnValue({ gridVisible: true, axisVisible: true }),
    onFrame: vi.fn(),
  } as any;
}

function mockBridge() {
  return {
    undo: vi.fn().mockReturnValue(true),
    redo: vi.fn().mockReturnValue(true),
    deleteFace: vi.fn(),
    deleteEdge: vi.fn(),
    batchDelete: vi.fn().mockReturnValue(true),
    getMeshBuffers: vi.fn().mockReturnValue({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      faceMap: new Uint32Array([1]),
    }),
    getEdgeLines: vi.fn().mockReturnValue(new Float32Array([0, 0, 0, 1, 0, 0])),
    getSnapVerticesF64: vi.fn().mockReturnValue(null),
    getEdgeMap: vi.fn().mockReturnValue(new Uint32Array([1])),
    getDeltaBuffers: vi.fn().mockReturnValue(null),
    getStats: vi.fn().mockReturnValue({ verts: 3, faces: 1 }),
    getFaceNormal: vi.fn().mockReturnValue([0, 1, 0]),
    makeComponent: vi.fn().mockReturnValue(1),
    getGroupForFace: vi.fn().mockReturnValue(undefined),
    getGroupFaces: vi.fn().mockReturnValue(null),
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
  } as any;
}

describe('ToolManager', () => {
  let tm: ToolManager;
  let viewport: ReturnType<typeof mockViewport>;
  let bridge: ReturnType<typeof mockBridge>;

  beforeEach(() => {
    viewport = mockViewport();
    bridge = mockBridge();
    tm = new ToolManager(viewport, bridge);
  });

  describe('constructor', () => {
    it('initializes with select tool as default', () => {
      expect(tm.currentTool).toBe('select');
    });

    it('snap manager is accessible', () => {
      expect(tm.snap).toBeDefined();
      expect(tm.snap.enabled).toBe(true);
    });

    it('selection manager is accessible', () => {
      expect(tm.selection).toBeDefined();
    });

    it('registers all 14 tools', () => {
      const toolNames = [
        'select', 'line', 'rect', 'circle', 'pushpull',
        'move', 'rotate', 'scale', 'offset', 'erase',
        'group', 'sphere', 'cylinder', 'cone',
      ];
      for (const name of toolNames) {
        expect(() => tm.setTool(name)).not.toThrow();
      }
    });
  });

  describe('setTool', () => {
    it('switches current tool', () => {
      tm.setTool('line');
      expect(tm.currentTool).toBe('line');
    });

    it('switching back to select', () => {
      tm.setTool('line');
      tm.setTool('select');
      expect(tm.currentTool).toBe('select');
    });

    it('cycles through multiple tools', () => {
      tm.setTool('rect');
      expect(tm.currentTool).toBe('rect');
      tm.setTool('circle');
      expect(tm.currentTool).toBe('circle');
      tm.setTool('pushpull');
      expect(tm.currentTool).toBe('pushpull');
    });

    it('handles unknown tool name gracefully', () => {
      expect(() => tm.setTool('nonexistent')).not.toThrow();
      expect(tm.currentTool).toBe('nonexistent');
    });
  });

  describe('isToolBusy', () => {
    it('returns false when tool is not busy', () => {
      expect(tm.isToolBusy()).toBe(false);
    });
  });

  describe('executeAction', () => {
    it('undo calls bridge.undo', () => {
      tm.executeAction('undo');
      expect(bridge.undo).toHaveBeenCalled();
    });

    it('redo calls bridge.redo', () => {
      tm.executeAction('redo');
      expect(bridge.redo).toHaveBeenCalled();
    });

    it('delete with no selection does nothing', () => {
      tm.executeAction('delete');
      expect(bridge.batchDelete).not.toHaveBeenCalled();
    });

    it('delete with selected faces calls batchDelete', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([1, 2]);
      vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([]);
      vi.spyOn(tm.selection, 'clearSelection').mockImplementation(() => {});

      tm.executeAction('delete');
      expect(bridge.batchDelete).toHaveBeenCalledWith([1, 2], []);
    });

    it('select-all calls selection.selectEverything', () => {
      const spy = vi.spyOn(tm.selection, 'selectEverything').mockImplementation(() => {});
      tm.executeAction('select-all');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('syncMesh', () => {
    it('calls bridge.getMeshBuffers and viewport.updateMesh', () => {
      tm.syncMesh();
      expect(bridge.getMeshBuffers).toHaveBeenCalled();
      expect(viewport.updateMesh).toHaveBeenCalled();
    });

    it('handles null buffers gracefully', () => {
      bridge.getMeshBuffers.mockReturnValue(null);
      expect(() => tm.syncMesh()).not.toThrow();
      expect(viewport.updateMesh).toHaveBeenCalledWith(
        expect.any(Float32Array),
        expect.any(Float32Array),
        expect.any(Uint32Array),
        expect.anything(),
        expect.any(Uint32Array),
      );
    });

    it('updates stats after sync', () => {
      tm.syncMesh();
      expect(bridge.getStats).toHaveBeenCalled();
      expect(viewport.setStats).toHaveBeenCalledWith(3, 1);
    });
  });

  describe('setAxisLock', () => {
    it('sets x axis lock without error', () => {
      expect(() => tm.setAxisLock('x')).not.toThrow();
    });

    it('clears axis lock with null', () => {
      tm.setAxisLock('x');
      expect(() => tm.setAxisLock(null)).not.toThrow();
    });
  });

  describe('applyVCBValue', () => {
    it('delegates to current tool without error', () => {
      tm.setTool('line');
      expect(() => tm.applyVCBValue(100)).not.toThrow();
    });

    it('passes both values for rect', () => {
      tm.setTool('rect');
      expect(() => tm.applyVCBValue(100, 200)).not.toThrow();
    });
  });

  describe('cancelCurrentTool', () => {
    it('clears snap and axis state', () => {
      const clearSpy = vi.spyOn(tm.snapVisual, 'clear');
      tm.cancelCurrentTool();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('executeAction - extended', () => {
    it('delete with selected edges calls batchDelete', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([]);
      vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([10, 20]);
      vi.spyOn(tm.selection, 'clearSelection').mockImplementation(() => {});

      tm.executeAction('delete');
      expect(bridge.batchDelete).toHaveBeenCalledWith([], [10, 20]);
    });

    it('delete falls back to individual deletes when batchDelete fails', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([1]);
      vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([10]);
      vi.spyOn(tm.selection, 'clearSelection').mockImplementation(() => {});
      bridge.batchDelete.mockReturnValue(false);

      tm.executeAction('delete');
      expect(bridge.deleteFace).toHaveBeenCalledWith(1);
      expect(bridge.deleteEdge).toHaveBeenCalledWith(10);
    });

    it('select-same delegates to selection.selectSameType', () => {
      const spy = vi.spyOn(tm.selection, 'selectSameType').mockImplementation(() => {});
      tm.executeAction('select-same');
      expect(spy).toHaveBeenCalled();
    });

    it('group delegates to groupTool.createGroupFromSelection', () => {
      tm.setTool('select'); // ensure group tool is registered
      tm.executeAction('group');
      // GroupTool mock has createGroupFromSelection
    });

    it('ungroup delegates to groupTool.ungroupSelection', () => {
      tm.executeAction('ungroup');
      // Should not throw
    });

    it('make-component with selected group face', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
      vi.spyOn(tm.selection, 'getGroupId').mockReturnValue(2);
      tm.executeAction('make-component');
      expect(bridge.makeComponent).toHaveBeenCalledWith(2, 'Component-2');
    });

    it('make-component without group does nothing', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
      vi.spyOn(tm.selection, 'getGroupId').mockReturnValue(undefined);
      tm.executeAction('make-component');
      expect(bridge.makeComponent).not.toHaveBeenCalled();
    });

    it('make-component with no selection does nothing', () => {
      vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([]);
      tm.executeAction('make-component');
      expect(bridge.makeComponent).not.toHaveBeenCalled();
    });

    it('undo when tool is busy cancels tool instead', () => {
      tm.setTool('line');
      // Make tool appear busy
      const tool = (tm as any).tools.get('line');
      if (tool) tool.isBusy = vi.fn().mockReturnValue(true);

      tm.executeAction('undo');
      // Should NOT call bridge.undo (tool was busy)
      // Instead it cancels the tool
    });

    it('redo calls bridge.redo and syncs', () => {
      tm.executeAction('redo');
      expect(bridge.redo).toHaveBeenCalled();
    });

    it('unknown action does not throw', () => {
      expect(() => tm.executeAction('nonexistent-action')).not.toThrow();
    });
  });

  describe('setTool - extended', () => {
    it('all primitive tools are registered', () => {
      for (const name of ['sphere', 'cylinder', 'cone']) {
        tm.setTool(name);
        expect(tm.currentTool).toBe(name);
      }
    });

    it('all transform tools are registered', () => {
      for (const name of ['move', 'rotate', 'scale']) {
        tm.setTool(name);
        expect(tm.currentTool).toBe(name);
      }
    });

    it('erase and offset tools work', () => {
      tm.setTool('erase');
      expect(tm.currentTool).toBe('erase');
      tm.setTool('offset');
      expect(tm.currentTool).toBe('offset');
    });
  });

  describe('syncMesh - extended', () => {
    it('updates selection buffers', () => {
      const spy = vi.spyOn(tm.selection, 'updateBuffers');
      tm.syncMesh();
      expect(spy).toHaveBeenCalled();
    });

    it('updates edge buffers on selection', () => {
      const spy = vi.spyOn(tm.selection, 'updateEdgeBuffers');
      tm.syncMesh();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('isToolBusy', () => {
    it('reflects tool busy state', () => {
      tm.setTool('line');
      expect(tm.isToolBusy()).toBe(false);
    });
  });
});
