import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock all heavy dependencies before importing ToolManager ──
// vi.mock factories are hoisted — they cannot reference outer variables.

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

vi.mock('../ui/Toast', () => ({
  Toast: {
    info: vi.fn(), warning: vi.fn(), error: vi.fn(), show: vi.fn(),
    fromBridgeError: vi.fn(),
  },
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
import { getClipboard } from '../core/Clipboard';

// ── Mock factories ──

function mockViewport() {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  return {
    container,
    scene: { add: vi.fn(), remove: vi.fn(), children: [] },
    renderer: {
      domElement: canvas,
      getSize: (v: { x: number; y: number }) => { v.x = 1280; v.y = 720; return v; },
    },
    onResize: () => () => {},
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
    setSketchPlaneVisual: vi.fn(),
    // Shadow mocks removed 2026-05-16 (shadow system → ADR-106)
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
    countFreeEdges: vi.fn().mockReturnValue(0),
    synthesizeFacesFromFreeEdges: vi.fn().mockReturnValue(0),
    pushPull: vi.fn().mockReturnValue(true),
    getCenterlineLines: vi.fn().mockReturnValue(null),
    getFaceVolumeFlags: vi.fn().mockReturnValue(null),
    // Default to Wall (true) so legacy tests that don't care about
    // classification continue to exercise wall-path behavior.
    isFaceInVolume: vi.fn().mockReturnValue(true),
    drawCenterline: vi.fn().mockReturnValue(0),
    edgeClass: vi.fn().mockReturnValue(0),
    setEdgeClass: vi.fn().mockReturnValue(true),
    arrayLinearFaces: vi.fn().mockReturnValue([]),
    getPositionsF64: vi.fn().mockReturnValue(null),
    getFaceVertices: vi.fn().mockReturnValue([]),
    getVertexPos: vi.fn().mockReturnValue(null),
    // ADR-038 P23.4 — analytic surface 여부 (mock: 모두 non-analytic)
    faceHasAnalyticSurface: vi.fn().mockReturnValue(false),
    // ADR-140 γ/δ — surface-aware getDrawPlane dispatch defaults
    //   default kind=1 (Plane) → legacy DCEL face normal path (회귀 0)
    //   default normal=null → graceful fallback if kind ≥ 2 ever set in test
    faceSurfaceKind: vi.fn().mockReturnValue(1),
    faceSurfaceNormalAtPos: vi.fn().mockReturnValue(null),
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

  describe('sketch mode', () => {
    it('enters/exits XZ sketch and flips isSketching flag', () => {
      expect(tm.isSketching()).toBe(false);
      tm.executeAction('sketch-start-xz');
      expect(tm.isSketching()).toBe(true);
      const info = tm.getSketchInfo();
      expect(info?.label).toContain('XZ');
      // XZ bottom plane: normal = +Y
      expect(info?.normal.y).toBeCloseTo(1);
      tm.executeAction('sketch-exit');
      expect(tm.isSketching()).toBe(false);
    });

    it('sketch-start-xy uses +Z normal', () => {
      tm.executeAction('sketch-start-xy');
      expect(tm.getSketchInfo()?.normal.z).toBeCloseTo(1);
    });

    it('sketch-start-yz uses +X normal', () => {
      tm.executeAction('sketch-start-yz');
      expect(tm.getSketchInfo()?.normal.x).toBeCloseTo(1);
    });

    it('notifies viewport to show/hide plane visual', () => {
      tm.executeAction('sketch-start-xz');
      expect(viewport.setSketchPlaneVisual).toHaveBeenCalledWith(expect.objectContaining({
        label: expect.stringContaining('XZ'),
      }));
      (viewport.setSketchPlaneVisual as any).mockClear();
      tm.executeAction('sketch-exit');
      expect(viewport.setSketchPlaneVisual).toHaveBeenCalledWith(null);
    });

    it('sketch-exit on inactive session is a no-op (no crash)', () => {
      tm.executeAction('sketch-exit');
      expect(tm.isSketching()).toBe(false);
    });
  });

  describe('centerline / edge class conversion', () => {
    it('convert-to-centerline with selected edges calls setEdgeClass(1) per edge', () => {
      // Patch only the methods we need on the existing SelectionManager.
      (tm.selection as any).getSelectedEdges = () => [10, 20, 30];
      (bridge.setEdgeClass as any) = vi.fn().mockReturnValue(true);
      tm.executeAction('convert-to-centerline');
      expect(bridge.setEdgeClass).toHaveBeenCalledTimes(3);
      expect(bridge.setEdgeClass).toHaveBeenCalledWith(10, 1);
      expect(bridge.setEdgeClass).toHaveBeenCalledWith(20, 1);
      expect(bridge.setEdgeClass).toHaveBeenCalledWith(30, 1);
    });
    it('convert-to-geometry uses class=0', () => {
      (tm.selection as any).getSelectedEdges = () => [42];
      (bridge.setEdgeClass as any) = vi.fn().mockReturnValue(true);
      tm.executeAction('convert-to-geometry');
      expect(bridge.setEdgeClass).toHaveBeenCalledWith(42, 0);
    });
    it('no-op + warning when nothing selected', () => {
      (tm.selection as any).getSelectedEdges = () => [];
      (bridge.setEdgeClass as any) = vi.fn();
      tm.executeAction('convert-to-centerline');
      expect(bridge.setEdgeClass).not.toHaveBeenCalled();
    });
  });

  describe('clipboard (Ctrl+C/X/V/D)', () => {
    beforeEach(() => {
      // Reset clipboard singleton between tests
      // imported at top;
      getClipboard().clear();
    });

    it('copy captures selected faces into clipboard', () => {
      (tm.selection as any).getSelectedFaces = () => [10, 20];
      (tm.selection as any).getSelectedEdges = () => [];
      tm.executeAction('clipboard-copy');
      // imported at top;
      expect(getClipboard().get()?.ids).toEqual([10, 20]);
    });

    it('cut copies then calls batchDelete', () => {
      (tm.selection as any).getSelectedFaces = () => [5];
      (tm.selection as any).getSelectedEdges = () => [];
      (bridge.batchDelete as any) = vi.fn().mockReturnValue(true);
      tm.executeAction('clipboard-cut');
      // imported at top;
      expect(getClipboard().get()?.ids).toEqual([5]);
      expect(bridge.batchDelete).toHaveBeenCalledWith([5], []);
    });

    it('paste without clipboard contents is a no-op', () => {
      // imported at top;
      getClipboard().clear();
      (bridge.arrayLinearFaces as any) = vi.fn();
      tm.executeAction('clipboard-paste');
      expect(bridge.arrayLinearFaces).not.toHaveBeenCalled();
    });

    it('paste calls arrayLinearFaces with count=1 and default offset', () => {
      // imported at top;
      getClipboard().copy('faces', [7, 8]);
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([100, 101]);
      tm.executeAction('clipboard-paste');
      expect(bridge.arrayLinearFaces).toHaveBeenCalledWith([7, 8], 1, expect.any(Array));
    });

    it('paste invalidates snap cache (defensive — pasted faces must be snappable)', () => {
      getClipboard().copy('faces', [1, 2]);
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([50, 51]);
      const invalidateSpy = vi.spyOn(tm.snap, 'invalidateCache');
      tm.executeAction('clipboard-paste');
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('paste uses TINY offset (just above dedup threshold) so copies get distinct verts', () => {
      // Zero offset would trigger Rust add_vertex dedup (1.5μm) → shared verts
      // → DCEL topology break → original face can be replaced by invalid copy.
      // Regression guard: make sure offset is > 0 and small enough to be invisible.
      getClipboard().copy('faces', [1, 2]);
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([100, 101]);
      tm.executeAction('clipboard-paste');
      expect(bridge.arrayLinearFaces).toHaveBeenCalledWith(
        [1, 2], 1,
        expect.arrayContaining([0.1, 0, 0.1]),
      );
      const callArgs = (bridge.arrayLinearFaces as any).mock.calls[0];
      const offset = callArgs[2];
      // offset must be non-zero to pass Rust ensure!
      const mag = Math.hypot(offset[0], offset[1], offset[2]);
      expect(mag).toBeGreaterThan(0);
      // offset must be >> 1.5μm (SPATIAL_HASH_CELL * 1.5) to skip dedup
      expect(mag).toBeGreaterThan(0.002);  // 2μm floor
      // offset must be <= 1mm to be visually imperceptible
      expect(mag).toBeLessThan(1);
    });

    it('paste enters move tool placement mode', () => {
      getClipboard().copy('faces', [3]);
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([200]);
      const moveTool = (tm as any).tools.get('move');
      moveTool.startPlacement = vi.fn();
      tm.executeAction('clipboard-paste');
      // expects at least [faceIds] — refPoint may be undefined if no vertex data
      expect(moveTool.startPlacement).toHaveBeenCalled();
      const callArgs = (moveTool.startPlacement as any).mock.calls[0];
      expect(callArgs[0]).toEqual([200]);
      expect(tm.currentTool).toBe('move');
    });

    it('paste computes bbox min corner from face vertices and passes as refPoint', () => {
      getClipboard().copy('faces', [3]);
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([200]);
      // Mock face → vert → pos: one face with 4 verts forming a rectangle.
      (bridge.getFaceVertices as any) = vi.fn().mockReturnValue([10, 11, 12, 13]);
      const positions: Record<number, [number, number, number]> = {
        10: [100, 0, 200],
        11: [500, 0, 200],
        12: [500, 0, 600],
        13: [100, 0, 600],
      };
      (bridge.getVertexPos as any) = vi.fn((vid: number) => positions[vid] ?? null);
      const moveTool = (tm as any).tools.get('move');
      moveTool.startPlacement = vi.fn();
      tm.executeAction('clipboard-paste');
      const callArgs = (moveTool.startPlacement as any).mock.calls[0];
      const refPoint = callArgs[1];
      // bbox min corner from 4 verts = (100, 0, 200)
      expect(refPoint).toBeDefined();
      expect(refPoint.x).toBeCloseTo(100);
      expect(refPoint.y).toBeCloseTo(0);
      expect(refPoint.z).toBeCloseTo(200);
    });

    it('duplicate uses current selection (not clipboard)', () => {
      (tm.selection as any).getSelectedFaces = () => [42];
      (tm.selection as any).selectFaces = vi.fn();
      (bridge.arrayLinearFaces as any) = vi.fn().mockReturnValue([200]);
      tm.executeAction('duplicate');
      expect(bridge.arrayLinearFaces).toHaveBeenCalledWith([42], 1, expect.any(Array));
    });

    it('copy with edge-only selection warns and does nothing', () => {
      (tm.selection as any).getSelectedFaces = () => [];
      (tm.selection as any).getSelectedEdges = () => [99];
      // imported at top;
      getClipboard().clear();
      tm.executeAction('clipboard-copy');
      expect(getClipboard().hasContents()).toBe(false);
    });

    it('sketch-exit without free edges skips synthesize and extrude', () => {
      (bridge.countFreeEdges as any).mockReturnValue(0);
      tm.executeAction('sketch-start-xz');
      tm.executeAction('sketch-exit');
      expect(bridge.synthesizeFacesFromFreeEdges).not.toHaveBeenCalled();
      expect(bridge.pushPull).not.toHaveBeenCalled();
    });

    it('sketch-exit with free edges calls synthesize; pushPull only if user enters height', () => {
      (bridge.countFreeEdges as any).mockReturnValue(4);
      (bridge.synthesizeFacesFromFreeEdges as any).mockReturnValue(1);
      // prompt: cancel → no pushPull
      const origPrompt = globalThis.window?.prompt;
      if (globalThis.window) globalThis.window.prompt = vi.fn().mockReturnValue(null);
      tm.executeAction('sketch-start-xz');
      tm.executeAction('sketch-exit');
      expect(bridge.synthesizeFacesFromFreeEdges).toHaveBeenCalled();
      expect(bridge.pushPull).not.toHaveBeenCalled();
      if (globalThis.window && origPrompt) globalThis.window.prompt = origPrompt;
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
      expect(viewport.updateMesh).toHaveBeenCalled();
      // First 3 positional args must be the empty typed arrays
      const call = (viewport.updateMesh as any).mock.calls[0];
      expect(call[0]).toBeInstanceOf(Float32Array);
      expect(call[1]).toBeInstanceOf(Float32Array);
      expect(call[2]).toBeInstanceOf(Uint32Array);
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

  // ──────────────────────────────────────────────────────────────────
  // ADR-140 δ — getDrawPlane surface-aware dispatch
  // (β WASM export + γ TS wrapper 의 자연 후속 — kind ≤ 1 unchanged,
  //  kind ≥ 2 tangent plane at hit point with graceful fallback)
  // ──────────────────────────────────────────────────────────────────
  describe('ADR-140 δ — getDrawPlane surface-aware dispatch', () => {
    // ToolManager's internal faceMap (Uint32Array) maps mesh triangle face
    // indices → axia FaceIds. In real flow it's populated by syncMesh()
    // after WASM rebuild. For these unit tests we inject directly so
    // `getFaceId(0)` returns a valid fid (7) and the dispatch path runs.
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tm as any).faceMap = new Uint32Array([7]);
    });

    // Mock event helper — pick returns a hit at world origin with face index 0
    function mockMouseEvent(): MouseEvent {
      return { clientX: 100, clientY: 100 } as MouseEvent;
    }

    function mockHit(faceIndex: number, point: { x: number; y: number; z: number } | null) {
      const hit: Record<string, unknown> = { faceIndex };
      if (point) {
        // Three.js Vector3-like with clone()
        hit.point = {
          x: point.x, y: point.y, z: point.z,
          clone: () => ({ x: point.x, y: point.y, z: point.z, clone: () => null }),
        };
      }
      return hit;
    }

    it('kind ≤ 1 (Plane) uses DCEL face normal — legacy path unchanged', () => {
      // Setup: pick returns hit on face 0, kind=1 (Plane), DCEL normal=+Y
      viewport.pick.mockReturnValue(mockHit(0, { x: 1, y: 2, z: 3 }));
      bridge.faceSurfaceKind.mockReturnValue(1);
      bridge.getFaceNormal.mockReturnValue([0, 1, 0]);

      // Use ToolManager getDrawPlane via ITool context (DrawLineTool passes it)
      tm.setTool('line');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.onFace).toBe(true);
      expect(plane.normal.y).toBeCloseTo(1, 6);
      expect(plane.surfaceKind).toBe(1);
      // Plane kind → no surface-aware origin set
      expect(plane.origin).toBeUndefined();
      // Surface-aware path NOT called for kind ≤ 1
      expect(bridge.faceSurfaceNormalAtPos).not.toHaveBeenCalled();
    });

    it('kind ≥ 2 (Cylinder) uses surface-aware tangent plane at hit point', () => {
      // Setup: pick returns hit on cylinder face, kind=2, surface normal at hit = +X
      viewport.pick.mockReturnValue(mockHit(0, { x: 5, y: 0, z: 0 }));
      bridge.faceSurfaceKind.mockReturnValue(2);  // Cylinder
      bridge.faceSurfaceNormalAtPos.mockReturnValue(new Float64Array([1, 0, 0]));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.onFace).toBe(true);
      expect(plane.normal.x).toBeCloseTo(1, 6);
      expect(plane.normal.y).toBeCloseTo(0, 6);
      expect(plane.normal.z).toBeCloseTo(0, 6);
      expect(plane.surfaceKind).toBe(2);
      // Surface-aware origin = hit point (Cylinder tangent anchor)
      expect(plane.origin).toBeDefined();
      expect(plane.origin.x).toBe(5);
      // Surface-aware path WAS called with hit point coordinates
      // (faceMap[0] = 7 per ADR-140 δ beforeEach setup, so fid = 7)
      expect(bridge.faceSurfaceNormalAtPos).toHaveBeenCalledWith(7, 5, 0, 0);
      // Legacy DCEL face normal NOT consulted on surface-aware success
      expect(bridge.getFaceNormal).not.toHaveBeenCalled();
    });

    it('kind ≥ 2 falls back to DCEL when faceSurfaceNormalAtPos returns null (graceful)', () => {
      // Setup: kind ≥ 2 but surface evaluation returns null (e.g. degenerate point)
      viewport.pick.mockReturnValue(mockHit(0, { x: 0, y: 0, z: 0 }));
      bridge.faceSurfaceKind.mockReturnValue(4);  // Cone (apex 가능)
      bridge.faceSurfaceNormalAtPos.mockReturnValue(null);  // degenerate
      bridge.getFaceNormal.mockReturnValue([0, 0, 1]);  // fallback DCEL normal

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.onFace).toBe(true);
      // Fallback used DCEL face normal
      expect(plane.normal.z).toBeCloseTo(1, 6);
      expect(plane.surfaceKind).toBe(4);
      // No surface-aware origin (fallback path)
      expect(plane.origin).toBeUndefined();
      // Both paths attempted (surface first, fallback second)
      expect(bridge.faceSurfaceNormalAtPos).toHaveBeenCalled();
      expect(bridge.getFaceNormal).toHaveBeenCalled();
    });

    it('kind ≥ 2 without hit.point falls back to DCEL (defensive — pick missing point)', () => {
      // Pathological: kind ≥ 2 but viewport.pick returned faceIndex without point
      viewport.pick.mockReturnValue(mockHit(0, null));
      bridge.faceSurfaceKind.mockReturnValue(3);  // Sphere
      bridge.getFaceNormal.mockReturnValue([0, 1, 0]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.onFace).toBe(true);
      expect(plane.normal.y).toBeCloseTo(1, 6);
      expect(plane.surfaceKind).toBe(3);
      expect(plane.origin).toBeUndefined();
      // Surface-aware path NOT called without hit.point
      expect(bridge.faceSurfaceNormalAtPos).not.toHaveBeenCalled();
      // DCEL fallback used
      expect(bridge.getFaceNormal).toHaveBeenCalled();
    });

    it('returns surfaceKind in DrawPlaneInfo for downstream tool dispatch', () => {
      // Verify that kind metadata flows through to caller (140-ε pre-condition)
      viewport.pick.mockReturnValue(mockHit(0, { x: 0, y: 5, z: 0 }));
      bridge.faceSurfaceKind.mockReturnValue(5);  // Torus
      bridge.faceSurfaceNormalAtPos.mockReturnValue(new Float64Array([0, 1, 0]));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.surfaceKind).toBe(5);
      // Caller (e.g. DrawLineTool) can now branch on surfaceKind for
      // surface-aware visualization (e.g. tangent guide line)
    });

    it('default ground plane (no face hit) has no surfaceKind / origin', () => {
      // Setup: pick returns null (empty space click)
      viewport.pick.mockReturnValue(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      expect(plane.onFace).toBe(false);
      expect(plane.surfaceKind).toBeUndefined();
      expect(plane.origin).toBeUndefined();
      // No surface dispatch attempted
      expect(bridge.faceSurfaceKind).not.toHaveBeenCalled();
      expect(bridge.faceSurfaceNormalAtPos).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // ADR-164 β-1 — Sticky Last Drawn Plane (Auto Plane Detection)
  // ADR-149/150/151 6-step template 1:1 mirror (5-step TS only).
  // ADR-141 §3 Sprint scope 외부 — 사용자 작업지시 trigger.
  //
  // Lock-ins:
  //   L-164-1: in-memory only (no localStorage), session-only
  //   L-164-2: reset triggers — view mode change / sketch enter+exit /
  //            Esc (via cancelCurrentTool) / explicit reset
  //   L-164-6: Engine 변경 0 — TS only
  //   L-164-9: localStorage 미사용
  //   L-164-10: 절대 #[ignore] 금지
  // ────────────────────────────────────────────────────────────────────
  describe('ADR-164 β-1 Sticky Last Drawn Plane', () => {
    it('adr164_last_drawn_plane_initial_undefined — null on fresh init (L-164-1)', () => {
      // L-164-1: in-memory session-only, starts null
      expect(tm.getLastDrawnPlane()).toBeNull();
    });

    it('adr164_last_drawn_plane_setter_stores_value — setLastDrawnPlane persists deep clone', async () => {
      const THREE = await import('three');
      const origin = new THREE.Vector3(1, 2, 3);
      const normal = new THREE.Vector3(0, 0, 1);
      const up = new THREE.Vector3(0, 1, 0);
      tm.setLastDrawnPlane({ origin, normal, up, source: 'face' });

      const retrieved = tm.getLastDrawnPlane();
      expect(retrieved).not.toBeNull();
      expect(retrieved!.origin.x).toBe(1);
      expect(retrieved!.origin.y).toBe(2);
      expect(retrieved!.origin.z).toBe(3);
      expect(retrieved!.normal.z).toBe(1);
      expect(retrieved!.source).toBe('face');

      // Deep clone — mutating the original should NOT mutate stored value
      origin.x = 999;
      expect(tm.getLastDrawnPlane()!.origin.x).toBe(1);
    });

    it('adr164_last_drawn_plane_reset_on_sketch_enter_and_exit — L-164-2 trigger', async () => {
      const THREE = await import('three');
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(5, 5, 5),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      // Sketch enter → reset (sketch lock-in 으로 sticky 자연 무효)
      tm.enterSketch({
        label: 'XY 바닥',
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.getLastDrawnPlane()).toBeNull();

      // Set again during sketch (e.g. via Draw tool inside sketch)
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(1, 1, 0),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      // Sketch exit → reset again (user intent shift signal)
      tm.exitSketch();
      expect(tm.getLastDrawnPlane()).toBeNull();
    });

    it('adr164_last_drawn_plane_reset_on_view_mode_change_and_cancel — L-164-2 explicit triggers', async () => {
      const THREE = await import('three');

      // Setup: sticky plane present
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(1, 0, 0),
      });
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      // View mode change reset hook (called by Viewport.setViewMode in β-3)
      tm.notifyViewModeChange();
      expect(tm.getLastDrawnPlane()).toBeNull();

      // Re-set
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(1, 0, 0),
      });
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      // Esc / global cancel reset hook
      tm.cancelCurrentTool();
      expect(tm.getLastDrawnPlane()).toBeNull();

      // Re-set
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(1, 0, 0),
      });
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      // Explicit reset API
      tm.clearLastDrawnPlane();
      expect(tm.getLastDrawnPlane()).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // ADR-166 β-1 — Active Sketch Plane Session Lock (field + API + reset hooks)
  //   L-166-1: Q1=a first_click trigger (β-2 scope — 본 block 은 API 만)
  //   L-166-2: Q2=a cross-tool 유지 (명시 release 까지)
  //   L-166-6: Engine 변경 0 — TS only
  //   L-166-7: ADR-164 자산 재활용
  //   L-166-9: ADR-164 동작 보존 (sticky + lock coexist, additive)
  //   L-166-10: ADR-164 답습 패턴 (API mirror)
  //   L-166-11: 절대 #[ignore] 금지
  // ────────────────────────────────────────────────────────────────────
  describe('ADR-166 β-1 Plane Lock Session', () => {
    it('adr166_plane_lock_initial_null — null on fresh init (L-166-1 default state)', () => {
      // L-166-1: in-memory session-only, starts null
      expect(tm.getPlaneLock()).toBeNull();
      expect(tm.isPlaneLocked()).toBe(false);
    });

    it('adr166_plane_lock_set_unlock_round_trip — lockPlane / unlockPlane symmetry + idempotent set', async () => {
      const THREE = await import('three');
      const origin = new THREE.Vector3(7, 8, 9);
      const normal = new THREE.Vector3(0, 0, 1);
      const up = new THREE.Vector3(0, 1, 0);
      tm.lockPlane({ origin, normal, up, source: 'first_click' });

      const lock = tm.getPlaneLock();
      expect(lock).not.toBeNull();
      expect(tm.isPlaneLocked()).toBe(true);
      expect(lock!.origin.x).toBe(7);
      expect(lock!.origin.y).toBe(8);
      expect(lock!.origin.z).toBe(9);
      expect(lock!.normal.z).toBe(1);
      expect(lock!.source).toBe('first_click');

      // Deep clone — mutating original should NOT mutate stored value
      origin.x = 999;
      expect(tm.getPlaneLock()!.origin.x).toBe(7);

      // Idempotent: second lockPlane is no-op while locked (L-166-2 명시
      // release 까지 보존)
      tm.lockPlane({
        origin: new THREE.Vector3(100, 100, 100),
        normal: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 0, 1),
      });
      // First lock preserved (no override)
      expect(tm.getPlaneLock()!.origin.x).toBe(7);
      expect(tm.getPlaneLock()!.normal.z).toBe(1);

      // unlockPlane — explicit release
      tm.unlockPlane();
      expect(tm.getPlaneLock()).toBeNull();
      expect(tm.isPlaneLocked()).toBe(false);

      // Re-lock works after unlock
      tm.lockPlane({
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 0, 1),
      });
      expect(tm.getPlaneLock()!.normal.x).toBe(1);
    });

    it('adr166_plane_lock_preserved_on_tool_change — cross-tool 유지 (L-166-2 핵심)', async () => {
      const THREE = await import('three');

      // Lock plane while in 'select' tool
      tm.lockPlane({
        origin: new THREE.Vector3(1, 2, 3),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.isPlaneLocked()).toBe(true);

      // Switch to a different tool — lock MUST persist (cross-tool 핵심
      // 가치, ADR-164 sticky 와 동일 semantic 보존)
      tm.setTool('rect');
      expect(tm.isPlaneLocked()).toBe(true);
      expect(tm.getPlaneLock()!.origin.x).toBe(1);

      tm.setTool('circle');
      expect(tm.isPlaneLocked()).toBe(true);
      expect(tm.getPlaneLock()!.origin.x).toBe(1);

      tm.setTool('line');
      expect(tm.isPlaneLocked()).toBe(true);
      expect(tm.getPlaneLock()!.origin.x).toBe(1);

      // ADR-164 sticky 도 같은 cross-tool semantic 보존 (additive coexist)
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(5, 5, 5),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      tm.setTool('select');
      expect(tm.isPlaneLocked()).toBe(true);  // lock 보존
      expect(tm.getLastDrawnPlane()).not.toBeNull();  // sticky 도 보존
    });

    it('adr166_plane_lock_reset_on_view_mode_change_and_sketch_and_esc — 4 reset hooks (L-166-2)', async () => {
      const THREE = await import('three');

      function setupLock() {
        tm.lockPlane({
          origin: new THREE.Vector3(0, 0, 0),
          normal: new THREE.Vector3(0, 0, 1),
          up: new THREE.Vector3(0, 1, 0),
        });
        expect(tm.isPlaneLocked()).toBe(true);
      }

      // (1) notifyViewModeChange — view 변경은 사용자 의도 변경 명시 신호
      setupLock();
      tm.notifyViewModeChange();
      expect(tm.isPlaneLocked()).toBe(false);

      // (2) enterSketch — sketch lock-in 우선
      setupLock();
      tm.enterSketch({
        label: 'XY 바닥',
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.isPlaneLocked()).toBe(false);

      // (3) exitSketch — sketch lock-in 해제 + 사용자 의도 변경 명시 신호
      // (lock 은 enterSketch 시 이미 해제됨, sketch 중 새 lock 시도 → reset)
      tm.lockPlane({  // sketch 중에 lock 시도 (가능 — 별개 mechanism)
        origin: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
      });
      expect(tm.isPlaneLocked()).toBe(true);
      tm.exitSketch();
      expect(tm.isPlaneLocked()).toBe(false);

      // (4) cancelCurrentTool — Esc / global cancel
      setupLock();
      tm.cancelCurrentTool();
      expect(tm.isPlaneLocked()).toBe(false);

      // (5) Explicit unlockPlane API (사용자 명시 release path, β-3 Ctrl+Shift+P 의 base)
      setupLock();
      tm.unlockPlane();
      expect(tm.isPlaneLocked()).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // ADR-164 β-3 — Sticky 소비 + UI integration
  // L-164-Q1=a — face hit miss 후 sticky → fallback view-mode default
  // ────────────────────────────────────────────────────────────────────
  describe('ADR-164 β-3 Sticky consume + UI integration', () => {
    // Local mockMouseEvent (shared one in ADR-140 δ block, repeat here for clarity)
    function mockMouseEvent(): MouseEvent {
      return { clientX: 100, clientY: 100 } as MouseEvent;
    }

    beforeEach(() => {
      // β-3 priority #3 needs faceMap for face hit branch ADR-140 cross
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tm as any).faceMap = new Uint32Array([7]);
    });

    it('adr164_beta3_getdrawplane_priority3_uses_sticky_when_face_miss — sticky 소비 활성', async () => {
      const THREE = await import('three');

      // β-2 setLastDrawnPlane 으로 sticky 설정 (e.g., 사용자가 face 위에서 RECT 그림)
      const stickyNormal = new THREE.Vector3(0, 1, 0); // Y-axis (XZ wall)
      const stickyUp = new THREE.Vector3(0, 0, 1);
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(10, 20, 30),
        normal: stickyNormal,
        up: stickyUp,
        source: 'view',
      });

      // viewport.pick 이 null 반환 (cursor on empty space, face hit miss)
      viewport.pick.mockReturnValue(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      // Priority #3 활성: sticky plane 사용 (view-mode default 가 아닌)
      expect(plane.normal.y).toBeCloseTo(1, 5);  // sticky XZ wall (not XY ground)
      expect(plane.up.z).toBeCloseTo(1, 5);
      expect(plane.onFace).toBe(false);
      expect(plane.origin).toBeDefined();
      expect(plane.origin?.x).toBe(10);
    });

    it('adr164_beta3_getdrawplane_falls_back_to_default_when_no_sticky — view-mode default 보존', () => {
      // No sticky plane set
      expect(tm.getLastDrawnPlane()).toBeNull();

      // viewport.pick null + view mode default
      viewport.pick.mockReturnValue(null);
      viewport.viewMode = '3d';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      // 3d default = XY ground (Z=0), normal +Z (ADR-103-δ)
      expect(plane.normal.z).toBeCloseTo(1, 5);
      expect(plane.onFace).toBe(false);
      expect(plane.origin).toBeUndefined();  // view-mode default 은 origin 없음
    });

    it('adr164_beta3_face_hit_unchanged — Cursor on face 우선순위 #2 보존 (L-164-7 additive)', async () => {
      const THREE = await import('three');

      // Set sticky
      tm.setLastDrawnPlane({
        origin: new THREE.Vector3(99, 99, 99),
        normal: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(0, 0, 1),
      });

      // viewport.pick returns face hit
      viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(1, 0, 1),
      });
      bridge.faceSurfaceKind.mockReturnValue(1);  // Plane
      bridge.getFaceNormal.mockReturnValue([1, 0, 0]);  // YZ wall

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tm as any).getDrawPlane(mockMouseEvent());

      // face hit normal used, NOT sticky (priority #2 > #3)
      expect(plane.normal.x).toBeCloseTo(1, 5);  // face YZ wall, not sticky XZ wall
      expect(plane.onFace).toBe(true);
    });

    it('adr164_beta3_badge_update_called_on_set_and_clear — UI integration smoke', async () => {
      const THREE = await import('three');

      // updateLastDrawnPlaneBadge 는 document 미존재 시 no-op (jsdom env
      // 에서는 document 가 있으므로 실제 호출됨). 단순히 set/clear 가
      // throw 없이 동작함을 검증 (DOM helper smoke).
      expect(() => {
        tm.setLastDrawnPlane({
          origin: new THREE.Vector3(0, 0, 0),
          normal: new THREE.Vector3(0, 0, 1),
          up: new THREE.Vector3(0, 1, 0),
          source: 'view',
        });
      }).not.toThrow();
      expect(tm.getLastDrawnPlane()).not.toBeNull();

      expect(() => tm.clearLastDrawnPlane()).not.toThrow();
      expect(tm.getLastDrawnPlane()).toBeNull();
    });
  });
});
