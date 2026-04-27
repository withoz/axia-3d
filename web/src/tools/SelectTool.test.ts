import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SelectTool } from './SelectTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
  });

  return {
    viewport: {
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      pickEdgeOrFace: vi.fn().mockReturnValue(null),
      container,
      activeCamera: new THREE.PerspectiveCamera(),
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({
            left: 0, top: 0, right: 800, bottom: 600,
            width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
          }),
        },
      },
    },
    selection: {
      handleClick: vi.fn(),
      handleEdgeClick: vi.fn(),
      selectAll: vi.fn(),
      selectAdjacentEdges: vi.fn(),
      selectFaceWithEdges: vi.fn(),
      clearSelection: vi.fn(),
    },
    bridge: {
      getMeshBuffers: vi.fn().mockReturnValue(null),
      getEdgeLines: vi.fn().mockReturnValue(null),
    },
    getFaceId: vi.fn().mockReturnValue(5),
    faceMap: [0, 1, 2, 3],
    edgeMap: [10, 20, 30],
  } as any;
}

describe('SelectTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: SelectTool;

  beforeEach(() => {
    document.body.innerHTML = '';
    ctx = mockToolContext();
    tool = new SelectTool(ctx);
  });

  describe('name', () => {
    it('is "select"', () => {
      expect(tool.name).toBe('select');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('single click - face', () => {
    const faceHit = () => ({ type: 'face', hit: { faceIndex: 2 } });

    it('selects face on click', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(faceHit());
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false, false);
    });

    it('shift-click for multi-select', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(faceHit());
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, true, false, false);
    });

    it('ctrl-click for toggle select', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(faceHit());
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: true } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, true, false);
    });

    it('alt-click for subtract', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(faceHit());
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: true } as MouseEvent, null);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false, true);
    });
  });

  describe('single click - edge', () => {
    it('selects edge when pickEdgeOrFace returns edge', () => {
      // edge hit — pickEdgeOrFace가 edge 우선 판정한 결과
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 2 }, // segment 1 → edgeMap[1]=20
      });

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(20, false, false, false);
    });
  });

  describe('empty space click', () => {
    it('starts drag select preparation', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      // Should not clear selection yet (drag threshold)
    });

    it('clears selection on mouseup without drag', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseUp({ clientX: 100, clientY: 200 } as MouseEvent);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('drag select', () => {
    it('creates drag select box after 5px threshold', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 110, clientY: 200 } as MouseEvent, null);

      expect(tool.isBusy()).toBe(true);
      const box = ctx.viewport.container.querySelector('div');
      expect(box).not.toBeNull();
    });

    it('removes drag box on mouse up', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 110, clientY: 200 } as MouseEvent, null);
      tool.onMouseUp({ clientX: 200, clientY: 300 } as MouseEvent);

      expect(tool.isBusy()).toBe(false);
    });

    it('does not start drag with small movement', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);

      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 102, clientY: 201 } as MouseEvent, null);

      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cleans up', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      // Should not throw
    });
  });

  describe('onActivate / onDeactivate', () => {
    it('activate does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('deactivate cleans up', () => {
      expect(() => tool.onDeactivate()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Bug fix regression tests (2026-04-17)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Bug 2: double-click routes through selectFaceWithEdges', () => {
    it('double-click calls selectFaceWithEdges with modifiers', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });

      // 1st click
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      // 2nd click (double)
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);

      expect(ctx.selection.selectFaceWithEdges).toHaveBeenCalledWith(5, false, false, false);
    });

    it('shift+double-click forwards shiftKey', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.selectFaceWithEdges).toHaveBeenCalledWith(5, true, false, false);
    });
  });

  describe('Edge double-click selects chain (Alt is now subtract)', () => {
    it('double-click on same edge expands into polyline chain via bridge.collectEdgeChain', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.collectEdgeChain = vi.fn().mockReturnValue([10, 20, 30, 40]);
      // First click — single edge select
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );
      // Second click — same edge → double click → chain expansion.
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );
      expect(ctx.bridge.collectEdgeChain).toHaveBeenCalledWith(10);
      // Total handleEdgeClick: single-click first (1) + chain[0] (1) + chain[1..3] shift=true (3) = 5
      expect(ctx.selection.handleEdgeClick.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it('plain single edge click does NOT call collectEdgeChain', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.collectEdgeChain = vi.fn();
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );
      expect(ctx.bridge.collectEdgeChain).not.toHaveBeenCalled();
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(10, false, false, false);
    });

    it('Alt+edge click is now SUBTRACT — passes altKey=true, no chain', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.collectEdgeChain = vi.fn();
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: true } as MouseEvent,
        null,
      );
      expect(ctx.bridge.collectEdgeChain).not.toHaveBeenCalled();
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(10, false, false, true);
    });
  });

  describe('Bug 4: edge click resets multi-click state', () => {
    it('prevents false double-click after edge interleaved', () => {
      // 1. face click
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);

      // 2. edge click (should reset multi-click)
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);

      // 3. face click again — should NOT trigger double-click since edge reset the state
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);

      // If multi-click state was correctly reset, selectFaceWithEdges (double-click path) should NOT be called
      expect(ctx.selection.selectFaceWithEdges).not.toHaveBeenCalled();
    });
  });

  describe('Bug 5: triple-click forwards modifiers to selectAll', () => {
    it('shift+triple-click passes shiftKey=true', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      expect(ctx.selection.selectAll).toHaveBeenCalledWith(5, true, false, false);
    });
  });

  describe('Bug 6/7: drag-select respects shift modifier', () => {
    it('shift+empty click does NOT clear selection on mouseup', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      tool.onMouseUp({ clientX: 100, clientY: 200 } as MouseEvent);
      expect(ctx.selection.clearSelection).not.toHaveBeenCalled();
    });

    it('plain empty click clears selection on mouseup', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseUp({ clientX: 100, clientY: 200 } as MouseEvent);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });

    it('shift+drag does NOT call clearSelection when drag starts', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 120, clientY: 220 } as MouseEvent, null); // > 5px threshold
      expect(ctx.selection.clearSelection).not.toHaveBeenCalled();
    });

    it('plain drag clears selection when drag starts', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 120, clientY: 220 } as MouseEvent, null);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('Bug 8: cleanup resets multi-click state', () => {
    it('cleanup clears click count and timer', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'face', hit: { faceIndex: 2 } });
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);

      // cleanup (e.g., tool switch)
      tool.cleanup();

      // Next face click should be treated as fresh single click, not accumulated
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      // single click uses handleClick, not selectFaceWithEdges
      expect(ctx.selection.selectFaceWithEdges).not.toHaveBeenCalled();
    });
  });

  describe('ESC key behavior (SketchUp convention)', () => {
    it('ESC with no drag active → clears selection', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });

    it('ESC during drag-select → cancels drag but preserves selection', () => {
      // Start drag
      ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent, null);
      tool.onMouseMove({ clientX: 120, clientY: 220 } as MouseEvent, null);
      (ctx.selection.clearSelection as ReturnType<typeof vi.fn>).mockClear();

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);

      // No additional clearSelection during mid-drag ESC
      expect(ctx.selection.clearSelection).not.toHaveBeenCalled();
    });
  });
});
