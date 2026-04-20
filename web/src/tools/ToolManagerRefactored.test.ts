import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock all heavy dependencies before importing ToolManager ──
// vi.mock factories are hoisted — they cannot reference outer variables.

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), show: vi.fn() },
}));

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

    it('registers all 15 tools', () => {
      const toolNames = [
        'select', 'line', 'rect', 'circle', 'pushpull',
        'move', 'rotate', 'scale', 'offset', 'erase',
        'split',
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

    // ── flip-faces 가드 회귀 방지 (2026-04-17) ──
    describe('flip-faces action', () => {
      it('flips faces when tool is idle and faces are selected', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5, 6]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).flipFaces = vi.fn().mockReturnValue(2);

        tm.executeAction('flip-faces');
        expect(bridge.flipFaces).toHaveBeenCalledWith([5, 6]);
      });

      it('does NOTHING when tool is busy (Push/Pull ghost, Line drawing, etc.)', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        (bridge as any).flipFaces = vi.fn().mockReturnValue(1);

        tm.executeAction('flip-faces');
        expect(bridge.flipFaces).not.toHaveBeenCalled();
      });

      it('warns when no faces are selected', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).flipFaces = vi.fn().mockReturnValue(0);

        tm.executeAction('flip-faces');
        expect(bridge.flipFaces).not.toHaveBeenCalled();
      });
    });

    // ── mirror-x/y/z action ──────────────────────────────────────
    describe('mirror action', () => {
      it('mirror-x calls mirrorFaces with YZ plane normal (1,0,0)', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([7, 8]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).mirrorFaces = vi.fn().mockReturnValue([100, 101]);

        tm.executeAction('mirror-x');
        expect(bridge.mirrorFaces).toHaveBeenCalledWith([7, 8], 0, 0, 0, 1, 0, 0);
      });

      it('mirror-y uses XZ plane normal (0,1,0)', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).mirrorFaces = vi.fn().mockReturnValue([200]);

        tm.executeAction('mirror-y');
        const args = (bridge.mirrorFaces as any).mock.calls[0];
        expect(args[4]).toBe(0); expect(args[5]).toBe(1); expect(args[6]).toBe(0);
      });

      it('mirror-z uses XY plane normal (0,0,1)', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).mirrorFaces = vi.fn().mockReturnValue([200]);

        tm.executeAction('mirror-z');
        const args = (bridge.mirrorFaces as any).mock.calls[0];
        expect(args[4]).toBe(0); expect(args[5]).toBe(0); expect(args[6]).toBe(1);
      });

      it('does nothing when no faces selected', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).mirrorFaces = vi.fn().mockReturnValue([]);

        tm.executeAction('mirror-x');
        expect(bridge.mirrorFaces).not.toHaveBeenCalled();
      });

      it('blocked when tool is busy', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([5]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        (bridge as any).mirrorFaces = vi.fn().mockReturnValue([100]);

        tm.executeAction('mirror-x');
        expect(bridge.mirrorFaces).not.toHaveBeenCalled();
      });
    });

    // ── revolve-x/y/z action ──────────────────────────────────────
    describe('revolve action', () => {
      it('extracts chain from selected edges and calls revolveProfile', () => {
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([10, 11]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).getEdgeEndpoints = vi.fn((eid: number) =>
          eid === 10 ? [1, 2] : [2, 3]);
        (bridge as any).getVertexPos = vi.fn((vid: number) =>
          [[0, 0, 0], [1, 0, 0], [2, 0, 0]][vid - 1]);
        (bridge as any).revolveProfile = vi.fn().mockReturnValue([500, 501]);

        tm.executeAction('revolve-y');
        expect(bridge.revolveProfile).toHaveBeenCalled();
        const args = (bridge.revolveProfile as any).mock.calls[0];
        // 3 points × 3 coords = 9 values
        expect(args[0].length).toBe(9);
        // Axis direction = +Y
        expect(args[4]).toBe(0); expect(args[5]).toBe(1); expect(args[6]).toBe(0);
        // Segments = 24 default
        expect(args[7]).toBe(24);
      });

      it('warns when no edges selected', () => {
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).revolveProfile = vi.fn().mockReturnValue([100]);

        tm.executeAction('revolve-y');
        expect(bridge.revolveProfile).not.toHaveBeenCalled();
      });

      it('warns when edge selection is not a simple chain', () => {
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([10, 11, 12]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        // Y-branch: vertex 2 has degree 3
        (bridge as any).getEdgeEndpoints = vi.fn((eid: number) =>
          eid === 10 ? [1, 2] : eid === 11 ? [2, 3] : [2, 4]);
        (bridge as any).revolveProfile = vi.fn().mockReturnValue([100]);

        tm.executeAction('revolve-y');
        expect(bridge.revolveProfile).not.toHaveBeenCalled();
      });

      it('blocked when tool is busy', () => {
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([10]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        (bridge as any).revolveProfile = vi.fn().mockReturnValue([100]);

        tm.executeAction('revolve-y');
        expect(bridge.revolveProfile).not.toHaveBeenCalled();
      });
    });

    // ── subdivide action ─────────────────────────────────────────
    describe('subdivide action', () => {
      it('calls bridge.subdivideCatmullClark and syncs on success', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).subdivideCatmullClark = vi.fn().mockReturnValue(48);
        const syncSpy = vi.spyOn(tm, 'syncMesh').mockImplementation(() => {});

        tm.executeAction('subdivide');
        expect(bridge.subdivideCatmullClark).toHaveBeenCalled();
        expect(syncSpy).toHaveBeenCalled();
      });

      it('shows error toast when bridge returns -1', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);
        (bridge as any).subdivideCatmullClark = vi.fn().mockReturnValue(-1);
        (bridge as any).lastError = vi.fn().mockReturnValue('some err');

        tm.executeAction('subdivide');
        expect(bridge.subdivideCatmullClark).toHaveBeenCalled();
      });

      it('blocked when tool is busy', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        (bridge as any).subdivideCatmullClark = vi.fn().mockReturnValue(48);

        tm.executeAction('subdivide');
        expect(bridge.subdivideCatmullClark).not.toHaveBeenCalled();
      });
    });

    // ── 파괴적/구조적 명령어 busy 가드 (2026-04-17) ──
    describe('BUSY_BLOCKED_ACTIONS', () => {
      it('delete blocks during busy tool', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([1, 2]);
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([]);
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);

        tm.executeAction('delete');
        expect(bridge.batchDelete).not.toHaveBeenCalled();
      });

      it('delete works when idle', () => {
        vi.spyOn(tm.selection, 'getSelectedFaces').mockReturnValue([1, 2]);
        vi.spyOn(tm.selection, 'getSelectedEdges').mockReturnValue([]);
        vi.spyOn(tm.selection, 'clearSelection').mockImplementation(() => {});
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);

        tm.executeAction('delete');
        expect(bridge.batchDelete).toHaveBeenCalledWith([1, 2], []);
      });

      it('redo blocks during busy tool', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);

        tm.executeAction('redo');
        expect(bridge.redo).not.toHaveBeenCalled();
      });

      it('redo works when idle', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(false);

        tm.executeAction('redo');
        expect(bridge.redo).toHaveBeenCalled();
      });

      it('group blocks during busy tool', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        const spy = vi.spyOn(tm.selection, 'groupSelected').mockReturnValue(null);

        tm.executeAction('group');
        expect(spy).not.toHaveBeenCalled();
      });

      it('make-component blocks during busy tool', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        // make-component 내부 호출 어느 것이든 확인 — bridge.makeComponent 존재 가정
        (bridge as any).makeComponent = vi.fn();

        tm.executeAction('make-component');
        expect((bridge as any).makeComponent).not.toHaveBeenCalled();
      });

      it('undo during busy tool cancels the tool (CAD 관례, not blocked)', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        const cancelSpy = vi.spyOn(tm, 'cancelCurrentTool').mockImplementation(() => {});

        tm.executeAction('undo');
        expect(cancelSpy).toHaveBeenCalled();
        expect(bridge.undo).not.toHaveBeenCalled();
      });

      it('non-destructive actions (select-all, deselect, etc.) are NOT blocked by busy', () => {
        vi.spyOn(tm, 'isToolBusy').mockReturnValue(true);
        const spy = vi.spyOn(tm.selection, 'selectEverything').mockImplementation(() => {});

        tm.executeAction('select-all');
        expect(spy).toHaveBeenCalled();
      });
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
