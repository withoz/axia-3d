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
      selectEdgeWithFaces: vi.fn(),
      computeAdjacentFaces: vi.fn().mockReturnValue([]),
      clearSelection: vi.fn(),
    },
    bridge: {
      getMeshBuffers: vi.fn().mockReturnValue(null),
      getEdgeLines: vi.fn().mockReturnValue(null),
      // ADR-088 Phase 1 (S-δ) — default: no curve owner group (legacy behavior)
      getEdgeCurveOwnerId: vi.fn().mockReturnValue(-1),
      getEdgesByCurveOwner: vi.fn().mockReturnValue([]),
      // ADR-093 D-δ — default: no surface owner group (legacy behavior)
      getFaceSurfaceOwnerId: vi.fn().mockReturnValue(-1),
      walkFaceOwnerSiblings: vi.fn().mockImplementation((fid: number) => [fid]),
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

  describe('Edge multi-click — 2026-04-27 3-단계 의미', () => {
    it('double-click on same edge → selectEdgeWithFaces (엣지 + 인접 면)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      // First click — single edge select
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );
      // Second click — same edge → double click → edge + adjacent faces.
      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );
      expect(ctx.selection.selectEdgeWithFaces).toHaveBeenCalledWith(10, false, false, false);
    });

    it('triple-click on standalone edge → chain expansion (구성 전체)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.collectEdgeChain = vi.fn().mockReturnValue([10, 20, 30, 40]);
      ctx.selection.computeAdjacentFaces = vi.fn().mockReturnValue([]);
      for (let i = 0; i < 3; i++) {
        tool.onMouseDown(
          { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
          null,
        );
      }
      expect(ctx.bridge.collectEdgeChain).toHaveBeenCalledWith(10);
    });

    it('triple-click on edge with adjacent face → selectAll on that face XIA', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.selection.computeAdjacentFaces = vi.fn().mockReturnValue([42]);
      for (let i = 0; i < 3; i++) {
        tool.onMouseDown(
          { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
          null,
        );
      }
      expect(ctx.selection.selectAll).toHaveBeenCalledWith(42, false, false, false);
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

  // ─────────────────────────────────────────────────────────────────
  // ADR-040 plumbing — analytic hover refine integration
  // ─────────────────────────────────────────────────────────────────
  describe('ADR-040 — analytic hover refine plumbing', () => {
    it('drops hover when refine reports within=false (BVH false-positive)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 4 }, // segment 2 → edgeMap[2]=30
      });
      ctx.viewport.refineEdgeHoverWithAnalytic = vi.fn().mockReturnValue({
        within: false,
        distance: 5.0,
        point: { x: 0, y: 0, z: 0 },
      });

      // mousemove path: should NOT promote hover for the edge.
      tool.onMouseMove(
        { clientX: 100, clientY: 200, buttons: 0 } as MouseEvent,
        null,
      );
      // refineEdgeHoverWithAnalytic 가 false 반환 → hover 미생성
      expect(ctx.viewport.refineEdgeHoverWithAnalytic).toHaveBeenCalledWith(
        ctx.bridge,
        30,
        100,
        200,
      );
    });

    it('keeps hover when refine reports within=true', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 4 },
      });
      ctx.viewport.refineEdgeHoverWithAnalytic = vi.fn().mockReturnValue({
        within: true,
        distance: 0.5,
        point: { x: 0, y: 0, z: 0 },
      });

      tool.onMouseMove(
        { clientX: 100, clientY: 200, buttons: 0 } as MouseEvent,
        null,
      );
      expect(ctx.viewport.refineEdgeHoverWithAnalytic).toHaveBeenCalled();
    });

    it('falls back silently when refine returns null (Newton diverged)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 4 },
      });
      ctx.viewport.refineEdgeHoverWithAnalytic = vi.fn().mockReturnValue(null);

      // Should NOT throw — null = "no analytic curve / Newton diverged"
      expect(() =>
        tool.onMouseMove(
          { clientX: 100, clientY: 200, buttons: 0 } as MouseEvent,
          null,
        ),
      ).not.toThrow();
      expect(ctx.viewport.refineEdgeHoverWithAnalytic).toHaveBeenCalled();
    });

    it('skips refine when viewport lacks the method (older runtime)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 4 },
      });
      // refineEdgeHoverWithAnalytic intentionally absent

      expect(() =>
        tool.onMouseMove(
          { clientX: 100, clientY: 200, buttons: 0 } as MouseEvent,
          null,
        ),
      ).not.toThrow();
    });

    it('refine throwing internally → silent fallback (no exception leaks)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'edge',
        hit: { index: 4 },
      });
      ctx.viewport.refineEdgeHoverWithAnalytic = vi.fn(() => {
        throw new Error('engine offline');
      });

      expect(() =>
        tool.onMouseMove(
          { clientX: 100, clientY: 200, buttons: 0 } as MouseEvent,
          null,
        ),
      ).not.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-088 Phase 1 (S-δ) — curve_owner_id grouping for analytic curve
  // edges. LOCKED #15 (ADR-037 P22.5) enforcement at click time.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-088 S-δ — curve_owner_id walk on single-click', () => {
    it('single-click on Circle segment promotes to ALL group segments', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      // edgeId = 10 (edgeMap[0]), owner_id = 42, group = 24 segments
      ctx.bridge.getEdgeCurveOwnerId.mockReturnValue(42);
      ctx.bridge.getEdgesByCurveOwner.mockReturnValue([100, 101, 102, 103]);

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // First call: caller's modifiers passed through (single, replace).
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(100, false, false, false);
      // Subsequent: additive (shift=true).
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(101, true, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(102, true, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(103, true, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledTimes(4);

      // Owner query was called with the picked edge's id (10).
      expect(ctx.bridge.getEdgeCurveOwnerId).toHaveBeenCalledWith(10);
      expect(ctx.bridge.getEdgesByCurveOwner).toHaveBeenCalledWith(42);
    });

    it('single-click on standalone edge (no group) → single edge select (legacy)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.getEdgeCurveOwnerId.mockReturnValue(-1); // no group

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(10, false, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.getEdgesByCurveOwner).not.toHaveBeenCalled();
    });

    it('single-click with shift modifier → first edge with shift, rest additive', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.getEdgeCurveOwnerId.mockReturnValue(7);
      ctx.bridge.getEdgesByCurveOwner.mockReturnValue([200, 201, 202]);

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // First call gets shift=true (caller's intent).
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(200, true, false, false);
      // Subsequent always additive (regardless of caller's modifiers).
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(201, true, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(202, true, false, false);
    });

    it('stale owner_id (group empty) → fall back to single edge', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 0 } });
      ctx.bridge.getEdgeCurveOwnerId.mockReturnValue(99);
      ctx.bridge.getEdgesByCurveOwner.mockReturnValue([]); // stale, all deactivated

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // Defensive fall back to single edge.
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(10, false, false, false);
      expect(ctx.selection.handleEdgeClick).toHaveBeenCalledTimes(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-093 D-δ — surface_owner_id grouping for cylinder side faces.
  // LOCKED #15 (ADR-037 P22.5) Face owner-id 자연 확장. ADR-088 의
  // edge owner walk 패턴 답습.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-093 D-δ — surface_owner_id walk on single-click face', () => {
    it('single-click on cylinder side face promotes to ALL group faces', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face', hit: { faceIndex: 0 },
      });
      // getFaceId returns 5 (default mock); owner_id = 17, group of 22 sides.
      ctx.bridge.getFaceSurfaceOwnerId.mockReturnValue(17);
      ctx.bridge.walkFaceOwnerSiblings.mockReturnValue([5, 6, 7, 8, 9]);

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // First call: caller's modifiers passed through (single, replace).
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false, false);
      // Subsequent: additive (shift=true) — mirror ADR-088 edge walk.
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(6, true, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(7, true, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(8, true, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(9, true, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledTimes(5);

      // Owner query was called with the picked face's id (5).
      expect(ctx.bridge.getFaceSurfaceOwnerId).toHaveBeenCalledWith(5);
      expect(ctx.bridge.walkFaceOwnerSiblings).toHaveBeenCalledWith(5);
    });

    it('single-click on standalone face (no group) → single face select (legacy)', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face', hit: { faceIndex: 0 },
      });
      ctx.bridge.getFaceSurfaceOwnerId.mockReturnValue(-1); // no group

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // Direct single-face selection (legacy behavior preserved).
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.walkFaceOwnerSiblings).not.toHaveBeenCalled();
    });

    it('single-click with shift modifier → first face with shift, rest additive', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face', hit: { faceIndex: 0 },
      });
      ctx.bridge.getFaceSurfaceOwnerId.mockReturnValue(7);
      ctx.bridge.walkFaceOwnerSiblings.mockReturnValue([100, 101, 102]);

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: true, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // First call gets shift=true (caller's intent).
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(100, true, false, false);
      // Subsequent always additive (regardless of caller's modifiers).
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(101, true, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(102, true, false, false);
    });

    it('stale owner_id (group has only 1 face) → fall back to single face', () => {
      ctx.viewport.pickEdgeOrFace.mockReturnValue({
        type: 'face', hit: { faceIndex: 0 },
      });
      ctx.bridge.getFaceSurfaceOwnerId.mockReturnValue(99);
      // walk returns [5] only (degenerate group / stale)
      ctx.bridge.walkFaceOwnerSiblings.mockReturnValue([5]);

      tool.onMouseDown(
        { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false } as MouseEvent,
        null,
      );

      // Defensive fall back to single face.
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false, false);
      expect(ctx.selection.handleClick).toHaveBeenCalledTimes(1);
    });
  });
});
