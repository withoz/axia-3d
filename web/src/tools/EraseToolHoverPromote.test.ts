/**
 * ADR-039 P24 / ADR-037 P22.5 회귀 테스트 — EraseTool hover owner-ID 통일.
 *
 * 이전: showEdgeHover(segIndex) → 1 segment 만 빨간 강조 → 곡선 64-segment
 * 의 1/64 만 보임 → "조각조각" 인지.
 *
 * 이후: showEdgeHover(edgeId) → 그 EdgeId 의 모든 segment 강조 → 곡선
 * 한 덩어리로 보임.
 *
 * + Stickiness (P24.2): 같은 hover key 면 overlay rebuild skip.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EraseTool } from './EraseTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), show: vi.fn() },
}));

/** Mock edgeLines: 64 segments — 모두 같은 EdgeId 42 라고 가정. */
function makeCircleEdgeLines(nSegments: number = 64): Float32Array {
  const lines = new Float32Array(nSegments * 6);
  // 단순 순차 좌표 (실제 circle 모양 안 만들어도 됨, segment 분리만 검증)
  for (let s = 0; s < nSegments; s++) {
    const base = s * 6;
    lines[base]     = s;        lines[base + 1] = 0; lines[base + 2] = 0;
    lines[base + 3] = s + 1;    lines[base + 4] = 0; lines[base + 5] = 0;
  }
  return lines;
}

function makeContext(edgeMap: number[], edgeLines: Float32Array) {
  const sceneAdd = vi.fn();
  const sceneRemove = vi.fn();
  return {
    bridge: {
      deleteFace: vi.fn().mockReturnValue(true),
      deleteEdge: vi.fn().mockReturnValue(true),
      deleteEdgeCascade: vi.fn().mockReturnValue(2),
      batchDelete: vi.fn().mockReturnValue(true),
      mergeFacesByEdge: vi.fn().mockReturnValue(-1),
      batchEraseEdgesWithMerge: vi.fn().mockReturnValue({
        merged: 0, cascadedFaces: 0, cascadedEdges: 0,
      }),
      previewEdgeEraseMerge: vi.fn().mockReturnValue(null),
      lastMergeFailureReason: vi.fn().mockReturnValue(''),
      getEdgeLines: vi.fn().mockReturnValue(edgeLines),
      getMeshBuffers: vi.fn().mockReturnValue({
        positions: new Float32Array(0),
        indices: new Uint32Array(0),
        faceMap: new Uint32Array(0),
      }),
    },
    viewport: {
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      pickEdgeOrFace: vi.fn().mockReturnValue(null),
      scene: { add: sceneAdd, remove: sceneRemove },
      renderer: { domElement: { style: { cursor: '' } } },
    },
    selection: {
      handleClick: vi.fn(),
      clearSelection: vi.fn(),
    },
    getFaceId: vi.fn().mockReturnValue(5),
    syncMesh: vi.fn(),
    edgeMap,
    _sceneAdd: sceneAdd,
    _sceneRemove: sceneRemove,
  } as any;
}

function mockEdgeHit(ctx: any, rawIdx: number): void {
  ctx.viewport.pickEdgeOrFace.mockReturnValue({
    type: 'edge',
    hit: { index: rawIdx },
  });
}

describe('ADR-039 P24 — EraseTool hover owner-ID 통일', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // Test 1 — 곡선 hover 시 모든 segment 가 한 overlay 로 강조
  // ────────────────────────────────────────────────────────────────

  it('Test 1: 64-seg circle hover → 모든 segment 가 단일 overlay 로 강조', () => {
    const N = 64;
    const CIRCLE_EDGE_ID = 42;
    const edgeMap: number[] = new Array(N).fill(CIRCLE_EDGE_ID);
    const edgeLines = makeCircleEdgeLines(N);
    const ctx = makeContext(edgeMap, edgeLines);
    const tool = new EraseTool(ctx);
    tool.onActivate();

    // Hover at segment 0 (raw index 0)
    mockEdgeHit(ctx, 0);
    tool.onMouseMove(
      { clientX: 100, clientY: 200, shiftKey: false } as MouseEvent,
      null,
    );

    // Scene.add 호출됨 (overlay 추가)
    expect(ctx._sceneAdd).toHaveBeenCalled();
    // 추가된 객체는 LineSegments 또는 Line — 그 geometry 의 vertex 수가
    // N*2 = 128 (segment N개 = 2 vertex 씩)
    const addedObj = ctx._sceneAdd.mock.calls[0][0] as THREE.Line | THREE.LineSegments;
    // Mock geometry stores attributes 직접 접근. BufferAttribute count 는
    // array.length / itemSize 로 계산 (mock 은 count 필드 미구현).
    const geo = addedObj.geometry as THREE.BufferGeometry;
    const posAttr = (geo as any).attributes?.position;
    expect(posAttr).toBeDefined();
    const vertCount = posAttr.array.length / posAttr.itemSize;
    expect(vertCount).toBe(N * 2);  // 64 segments × 2 vertices = 128
  });

  // ────────────────────────────────────────────────────────────────
  // Test 2 — 곡선 위 sweep 시 stickiness (rebuild skip)
  // ────────────────────────────────────────────────────────────────

  it('Test 2: 같은 EdgeId 의 다른 segment hover → overlay rebuild skip (P24.2 stickiness)', () => {
    const N = 64;
    const edgeMap: number[] = new Array(N).fill(42);
    const ctx = makeContext(edgeMap, makeCircleEdgeLines(N));
    const tool = new EraseTool(ctx);
    tool.onActivate();
    ctx._sceneAdd.mockClear();

    // 5개 다른 segment 에서 hover (모두 같은 EdgeId 42)
    for (const segIdx of [0, 13, 27, 45, 63]) {
      mockEdgeHit(ctx, segIdx * 2);
      tool.onMouseMove(
        { clientX: 100 + segIdx, clientY: 200, shiftKey: false } as MouseEvent,
        null,
      );
    }

    // P24.2 invariant: scene.add 1번만 호출 (첫 hover 만 overlay 생성,
    // 이후 4번은 stickiness 로 skip)
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────────────
  // Test 3 — 다른 EdgeId 로 이동 시 rebuild
  // ────────────────────────────────────────────────────────────────

  it('Test 3: 다른 EdgeId 로 이동 → overlay rebuild', () => {
    // 두 곡선: segments 0..31 = EdgeId 100, 32..63 = EdgeId 200
    const edgeMap: number[] = [
      ...new Array(32).fill(100),
      ...new Array(32).fill(200),
    ];
    const ctx = makeContext(edgeMap, makeCircleEdgeLines(64));
    const tool = new EraseTool(ctx);
    tool.onActivate();
    ctx._sceneAdd.mockClear();

    // Curve A 의 segment 5
    mockEdgeHit(ctx, 5 * 2);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);

    // Curve B 의 segment 50
    mockEdgeHit(ctx, 50 * 2);
    tool.onMouseMove({ clientX: 200, clientY: 200, shiftKey: false } as MouseEvent, null);

    // 다시 Curve A
    mockEdgeHit(ctx, 10 * 2);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);

    // 3번 rebuild (curve 가 바뀔 때마다)
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(3);
  });

  // ────────────────────────────────────────────────────────────────
  // Test 4 — Shift modifier 변경 시 rebuild (다른 색상)
  // ────────────────────────────────────────────────────────────────

  it('Test 4: 같은 edge + shift 변경 → rebuild (다른 preview 색상)', () => {
    const edgeMap: number[] = new Array(16).fill(42);
    const ctx = makeContext(edgeMap, makeCircleEdgeLines(16));
    const tool = new EraseTool(ctx);
    tool.onActivate();
    ctx._sceneAdd.mockClear();

    mockEdgeHit(ctx, 0);
    // Shift OFF → amber preview
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);
    // Shift ON → red cascade preview (다른 색)
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: true } as MouseEvent, null);

    // Shift 가 바뀌면 hover key 변경 → rebuild
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────────────
  // Test 5 — Cleanup 시 stickiness state clear
  // ────────────────────────────────────────────────────────────────

  it('Test 5: cleanup() → stickiness state clear (다음 hover 가 정상 rebuild)', () => {
    const edgeMap: number[] = new Array(16).fill(42);
    const ctx = makeContext(edgeMap, makeCircleEdgeLines(16));
    const tool = new EraseTool(ctx);
    tool.onActivate();
    ctx._sceneAdd.mockClear();

    // 1차 hover — rebuild
    mockEdgeHit(ctx, 0);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(1);

    // Cleanup (tool 변경 시뮬레이션)
    tool.cleanup();

    // 다시 hover — stickiness state 가 reset 되어 rebuild 됨
    mockEdgeHit(ctx, 0);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────────────
  // Test 6 — Empty hit (raycast miss) → hover clear
  // ────────────────────────────────────────────────────────────────

  it('Test 6: empty space → hover clear + stickiness reset (다음 hover 정상)', () => {
    const edgeMap: number[] = new Array(16).fill(42);
    const ctx = makeContext(edgeMap, makeCircleEdgeLines(16));
    const tool = new EraseTool(ctx);
    tool.onActivate();
    ctx._sceneAdd.mockClear();

    // 1차 hover
    mockEdgeHit(ctx, 0);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);
    expect(ctx._sceneAdd).toHaveBeenCalledTimes(1);

    // Empty space (raycast miss)
    ctx.viewport.pickEdgeOrFace.mockReturnValue(null);
    tool.onMouseMove({ clientX: 999, clientY: 999, shiftKey: false } as MouseEvent, null);

    // 다시 같은 edge — stickiness reset 으로 rebuild
    mockEdgeHit(ctx, 0);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);

    expect(ctx._sceneAdd).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────────────
  // Test 7 — Single-line edge (1 segment) 도 정상 작동
  // ────────────────────────────────────────────────────────────────

  it('Test 7: single segment edge (line) → 1 segment 강조', () => {
    const edgeMap: number[] = [42];  // 1 segment
    const edgeLines = new Float32Array([0, 0, 0, 10, 0, 0]);  // 1 segment
    const ctx = makeContext(edgeMap, edgeLines);
    const tool = new EraseTool(ctx);
    tool.onActivate();

    mockEdgeHit(ctx, 0);
    tool.onMouseMove({ clientX: 100, clientY: 200, shiftKey: false } as MouseEvent, null);

    expect(ctx._sceneAdd).toHaveBeenCalledTimes(1);
    const addedObj = ctx._sceneAdd.mock.calls[0][0] as THREE.Line;
    const geo = addedObj.geometry as THREE.BufferGeometry;
    const posAttr = (geo as any).attributes?.position;
    expect(posAttr).toBeDefined();
    const vertCount = posAttr.array.length / posAttr.itemSize;
    expect(vertCount).toBe(2);  // 1 segment × 2 vertices
  });
});
