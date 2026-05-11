/**
 * ADR-039 P24.8 회귀 테스트 — Hover & Preselect Owner-ID Unification.
 *
 * 6 invariant tests:
 * 1. hover_circle_sweep_no_breaking — 원 위 sweep 시 hovered 변화 0
 * 2. hover_jitter_1px_stable_owner_id — 1px 흔들림 → 변화 0
 * 3. hover_clears_on_tool_change — cleanup() → hover null
 * 4. hover_clears_on_mouseleave — clearHover() → hover null
 * 5. hover_owner_id_matches_click_result — 같은 위치 hover ↔ click 일치
 * 6. multi_curve_hover_switches_owner_correctly — 다른 curve 로 이동 시 owner 정확
 *
 * 본 파일이 깨지면 P24 위반 — drift 감지.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SelectTool, sameHoverOwner, type HoverTarget } from './SelectTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

function makeContext(faceMap: number[], edgeMap: number[], faceIdAt: number) {
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
          getBoundingClientRect: () => container.getBoundingClientRect(),
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
      collectEdgeChain: vi.fn().mockReturnValue([]),
      // ADR-088 Phase 1 (S-δ) — default: no curve owner group
      getEdgeCurveOwnerId: vi.fn().mockReturnValue(-1),
      getEdgesByCurveOwner: vi.fn().mockReturnValue([]),
    },
    getFaceId: vi.fn().mockReturnValue(faceIdAt),
    faceMap,
    edgeMap,
  } as any;
}

function moveMouse(tool: SelectTool, ctx: any, x: number, y: number, hit: any): void {
  ctx.viewport.pickEdgeOrFace.mockReturnValue(hit);
  tool.onMouseMove({ clientX: x, clientY: y } as MouseEvent, null);
}

describe('ADR-039 P24 — Hover & Preselect Owner-ID Unification', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  describe('sameHoverOwner helper (P24.2 stickiness 기반)', () => {
    it('null vs null → same', () => {
      expect(sameHoverOwner(null, null)).toBe(true);
    });

    it('null vs target → different', () => {
      expect(sameHoverOwner(null, { kind: 'edge', id: 1 })).toBe(false);
      expect(sameHoverOwner({ kind: 'face', id: 5 }, null)).toBe(false);
    });

    it('same kind + same id → same', () => {
      expect(sameHoverOwner({ kind: 'edge', id: 7 }, { kind: 'edge', id: 7 })).toBe(true);
    });

    it('same kind + different id → different', () => {
      expect(sameHoverOwner({ kind: 'edge', id: 7 }, { kind: 'edge', id: 8 })).toBe(false);
    });

    it('different kind + same id → different (P24.1 footgun 차단)', () => {
      // Edge 7 과 Face 7 은 서로 다른 namespace
      expect(sameHoverOwner({ kind: 'edge', id: 7 }, { kind: 'face', id: 7 })).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Test 1 — hover_circle_sweep_no_breaking
  // ────────────────────────────────────────────────────────────────

  it('Test 1: 원 64-segment sweep 시 hovered 변화 0 (P24.2 stickiness)', () => {
    const CIRCLE_EDGE_ID = 42;
    const N_SEGMENTS = 64;
    const edgeMap: number[] = new Array(N_SEGMENTS).fill(CIRCLE_EDGE_ID);
    const ctx = makeContext([], edgeMap, 0);
    const tool = new SelectTool(ctx);

    let listenerCallCount = 0;
    tool.onHoverChange(() => listenerCallCount++);

    // 원의 다양한 segment 를 sweep
    for (let segIdx = 0; segIdx < N_SEGMENTS; segIdx++) {
      moveMouse(tool, ctx, 100 + segIdx, 200, {
        type: 'edge',
        hit: { index: segIdx * 2 },
      });
    }

    // P24.2 invariant: 같은 EdgeId 라 stickiness 가 stub → listener 1번만 호출
    expect(listenerCallCount).toBe(1);
    expect(tool.getHoverTarget()).toEqual({ kind: 'edge', id: CIRCLE_EDGE_ID });
  });

  // ────────────────────────────────────────────────────────────────
  // Test 2 — hover_jitter_1px_stable_owner_id
  // ────────────────────────────────────────────────────────────────

  it('Test 2: 1px jitter → hovered 변화 0 (BVH noise 자연 흡수)', () => {
    const FACE_ID = 7;
    const faceMap: number[] = new Array(24).fill(FACE_ID);
    const ctx = makeContext(faceMap, [], FACE_ID);
    const tool = new SelectTool(ctx);

    let listenerCallCount = 0;
    tool.onHoverChange(() => listenerCallCount++);

    // 같은 face 의 다른 triangle 들 — 시각적으로 같은 owner
    moveMouse(tool, ctx, 100, 200, { type: 'face', hit: { faceIndex: 0 } });
    moveMouse(tool, ctx, 101, 200, { type: 'face', hit: { faceIndex: 5 } });
    moveMouse(tool, ctx, 100, 201, { type: 'face', hit: { faceIndex: 13 } });
    moveMouse(tool, ctx, 99, 199, { type: 'face', hit: { faceIndex: 23 } });

    // 모든 click 이 같은 FaceId promote → listener 1번만
    expect(listenerCallCount).toBe(1);
    expect(tool.getHoverTarget()).toEqual({ kind: 'face', id: FACE_ID });
  });

  // ────────────────────────────────────────────────────────────────
  // Test 3 — hover_clears_on_tool_change
  // ────────────────────────────────────────────────────────────────

  it('Test 3: cleanup() → hover null (tool 변경 시 lifecycle)', () => {
    const ctx = makeContext([], [99], 0);
    const tool = new SelectTool(ctx);

    let lastHover: HoverTarget = null;
    tool.onHoverChange(target => { lastHover = target; });

    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 0 } });
    expect(tool.getHoverTarget()).toEqual({ kind: 'edge', id: 99 });

    // Tool 변경 시뮬레이션 — cleanup() 호출
    tool.cleanup();

    expect(tool.getHoverTarget()).toBeNull();
    expect(lastHover).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Test 4 — hover_clears_on_mouseleave
  // ────────────────────────────────────────────────────────────────

  it('Test 4: clearHover() → hover null (mouseleave 시뮬레이션)', () => {
    const ctx = makeContext([], [42], 0);
    const tool = new SelectTool(ctx);

    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 0 } });
    expect(tool.getHoverTarget()).not.toBeNull();

    // Viewport 가 mouseleave 시 호출
    tool.clearHover();
    expect(tool.getHoverTarget()).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Test 5 — hover_owner_id_matches_click_result
  // ────────────────────────────────────────────────────────────────

  it('Test 5: 같은 raw hit → hover owner ID === click owner ID (일관성)', () => {
    const EDGE_ID = 17;
    const edgeMap: number[] = new Array(16).fill(EDGE_ID);
    const ctx = makeContext([], edgeMap, 0);
    const tool = new SelectTool(ctx);

    // Hover at segment 5 (raw index 10)
    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 10 } });
    const hoverState = tool.getHoverTarget();
    expect(hoverState).toEqual({ kind: 'edge', id: EDGE_ID });

    // Click at same location
    ctx.viewport.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: { index: 10 } });
    tool.onMouseDown(
      { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
      null,
    );
    expect(ctx.selection.handleEdgeClick).toHaveBeenCalledWith(EDGE_ID, false, false, false);

    // Hover ID === Click ID (P22 + P24 일관성)
    expect(hoverState?.kind).toBe('edge');
    if (hoverState?.kind === 'edge') {
      expect(hoverState.id).toBe(EDGE_ID);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Test 6 — multi_curve_hover_switches_owner_correctly
  // ────────────────────────────────────────────────────────────────

  it('Test 6: 다른 curve 로 이동 → owner ID 정확히 전환', () => {
    // 두 분리된 곡선:
    //   - segments 0..31 → EdgeId 100
    //   - segments 32..63 → EdgeId 200
    const edgeMap: number[] = [
      ...new Array(32).fill(100),
      ...new Array(32).fill(200),
    ];
    const ctx = makeContext([], edgeMap, 0);
    const tool = new SelectTool(ctx);

    const ownerHistory: number[] = [];
    tool.onHoverChange(target => {
      if (target?.kind === 'edge') ownerHistory.push(target.id);
      else ownerHistory.push(-1);
    });

    // Curve A 의 여러 segment hover
    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 0 } });
    moveMouse(tool, ctx, 101, 200, { type: 'edge', hit: { index: 20 } });
    moveMouse(tool, ctx, 102, 200, { type: 'edge', hit: { index: 60 } });

    // Curve B 로 이동
    moveMouse(tool, ctx, 200, 200, { type: 'edge', hit: { index: 64 } });
    moveMouse(tool, ctx, 201, 200, { type: 'edge', hit: { index: 100 } });

    // 다시 Curve A 로 복귀
    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 5 } });

    // 예상: 100 → 200 → 100 (3번 전환)
    expect(ownerHistory).toEqual([100, 200, 100]);
  });

  // ────────────────────────────────────────────────────────────────
  // Bonus — empty hit 시 hover clear
  // ────────────────────────────────────────────────────────────────

  it('Bonus: empty space (raycast miss) → hover null (P24.3)', () => {
    const ctx = makeContext([], [42], 0);
    const tool = new SelectTool(ctx);

    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 0 } });
    expect(tool.getHoverTarget()).not.toBeNull();

    // raycast miss (returns null)
    ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
    tool.onMouseMove({ clientX: 999, clientY: 999 } as MouseEvent, null);

    expect(tool.getHoverTarget()).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Bonus — drag 시작 시 hover freeze (P24.3)
  // ────────────────────────────────────────────────────────────────

  it('Bonus: drag 시작 → hover clear + freeze (P24.3)', () => {
    const ctx = makeContext([], [42], 0);
    const tool = new SelectTool(ctx);

    // Hover something
    moveMouse(tool, ctx, 100, 200, { type: 'edge', hit: { index: 0 } });
    expect(tool.getHoverTarget()).not.toBeNull();

    // mousedown 시작 (drag 트리거 준비)
    ctx.viewport.pickEdgeOrFace.mockReturnValue(null);  // empty → drag setup
    tool.onMouseDown(
      { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
      null,
    );

    // Drag 시작 (5px+ 이동)
    tool.onMouseMove({ clientX: 110, clientY: 210 } as MouseEvent, null);

    // hover 가 cleared (drag 시작 시 freeze)
    expect(tool.getHoverTarget()).toBeNull();
  });
});
