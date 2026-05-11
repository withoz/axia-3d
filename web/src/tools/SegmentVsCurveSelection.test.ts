/**
 * 실증 검증 — "세그먼트로 선택되는가, 한 선으로 선택되는가?"
 *
 * 본 파일은 ADR-037 P22 의 empirical verification — SelectTool 의
 * 실제 dispatch 경로를 통과하여 선택 결과가 owner ID 단위인지 검증.
 *
 * **각 click 마다 fresh SelectTool 생성** — 다중 click 의 double/triple
 * state machine 영향 우회. 순수히 "1개 click → 1개 ID promotion" 만 측정.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SelectTool } from './SelectTool';

vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

function makeFreshContext(faceMap: number[], edgeMap: number[], getFaceIdReturn: number) {
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
      collectEdgeChain: vi.fn().mockReturnValue([]),  // Empty chain — single edge fallback
      // ADR-088 Phase 1 (S-δ) — default: no curve owner group (legacy single-segment)
      getEdgeCurveOwnerId: vi.fn().mockReturnValue(-1),
      getEdgesByCurveOwner: vi.fn().mockReturnValue([]),
    },
    getFaceId: vi.fn().mockReturnValue(getFaceIdReturn),
    faceMap,
    edgeMap,
  } as any;
}

/**
 * Single click 시뮬레이션 — fresh SelectTool 생성 후 1회 click.
 * Returns dispatched ID via selection.handleEdgeClick / handleClick.
 */
function simulateSingleEdgeClick(
  edgeMap: number[],
  rawHitIndex: number,
): { dispatchedId: number | undefined; method: string } {
  const ctx = makeFreshContext([], edgeMap, 0);
  const tool = new SelectTool(ctx);

  ctx.viewport.pickEdgeOrFace.mockReturnValue({
    type: 'edge',
    hit: { index: rawHitIndex },
  });
  tool.onMouseDown(
    { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
    null,
  );

  // Check all selection methods (single-click → handleEdgeClick;
  // double-click → selectEdgeWithFaces; triple-click → selectAdjacentEdges)
  const ec = ctx.selection.handleEdgeClick.mock.calls;
  const ewf = ctx.selection.selectEdgeWithFaces.mock.calls;
  const sae = ctx.selection.selectAdjacentEdges.mock.calls;
  if (ec.length > 0) return { dispatchedId: ec[0][0], method: 'handleEdgeClick' };
  if (ewf.length > 0) return { dispatchedId: ewf[0][0], method: 'selectEdgeWithFaces' };
  if (sae.length > 0) return { dispatchedId: sae[0][0], method: 'selectAdjacentEdges' };
  return { dispatchedId: undefined, method: 'none' };
}

function simulateSingleFaceClick(
  faceMap: number[],
  triIndex: number,
  faceIdAt: number,
): { dispatchedId: number | undefined; method: string } {
  const ctx = makeFreshContext(faceMap, [], faceIdAt);
  const tool = new SelectTool(ctx);

  ctx.viewport.pickEdgeOrFace.mockReturnValue({
    type: 'face',
    hit: { faceIndex: triIndex },
  });
  tool.onMouseDown(
    { clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false } as MouseEvent,
    null,
  );

  const hc = ctx.selection.handleClick.mock.calls;
  const fwe = ctx.selection.selectFaceWithEdges.mock.calls;
  const sa = ctx.selection.selectAll.mock.calls;
  if (hc.length > 0) return { dispatchedId: hc[0][0], method: 'handleClick' };
  if (fwe.length > 0) return { dispatchedId: fwe[0][0], method: 'selectFaceWithEdges' };
  if (sa.length > 0) return { dispatchedId: sa[0][0], method: 'selectAll' };
  return { dispatchedId: undefined, method: 'none' };
}

describe('실증: 곡선/곡면 선택이 세그먼트/삼각형 단위인가, 의미 단위인가?', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('CIRCLE 64-segment 의 5개 click → 모두 같은 EdgeId (한 선 선택)', () => {
    const CIRCLE_EDGE_ID = 42;
    const N_SEGMENTS = 64;
    const edgeMap: number[] = new Array(N_SEGMENTS).fill(CIRCLE_EDGE_ID);

    const segmentsToClick = [0, 13, 27, 45, 63];
    const results = segmentsToClick.map(segIdx => ({
      segIdx,
      result: simulateSingleEdgeClick(edgeMap, segIdx * 2),
    }));

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CIRCLE 선택 검증:');
    console.log(`  Setup: 1 EdgeId (${CIRCLE_EDGE_ID}) × ${N_SEGMENTS} segments`);
    console.log(`  click → dispatch:`);
    for (const r of results) {
      console.log(
        `    segIdx ${String(r.segIdx).padStart(2)} → id=${r.result.dispatchedId}, via ${r.result.method}`
      );
    }
    const ids = results.map(r => r.result.dispatchedId).filter(x => x !== undefined);
    const uniqueCount = new Set(ids).size;
    console.log(`  Unique IDs dispatched: ${uniqueCount}`);
    if (uniqueCount === 1 && ids[0] === CIRCLE_EDGE_ID) {
      console.log('  ✅ 한 선 선택 (curve-level Pick→Promote 작동)');
    } else {
      console.log('  ❌ 세그먼트별 선택 (BUG)');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    expect(ids.length).toBe(5);                      // 5 click 모두 dispatch
    expect(uniqueCount).toBe(1);                     // 모두 같은 ID
    expect(ids[0]).toBe(CIRCLE_EDGE_ID);             // 정확히 EdgeId 42
  });

  it('SPHERE 256-triangle face 의 5개 click → 모두 같은 FaceId (한 면 선택)', () => {
    const SPHERE_FACE_ID = 7;
    const N_TRIANGLES = 256;
    const faceMap: number[] = new Array(N_TRIANGLES).fill(SPHERE_FACE_ID);

    const trianglesToClick = [0, 47, 128, 199, 255];
    const results = trianglesToClick.map(triIdx => ({
      triIdx,
      result: simulateSingleFaceClick(faceMap, triIdx, SPHERE_FACE_ID),
    }));

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SPHERE 선택 검증:');
    console.log(`  Setup: 1 FaceId (${SPHERE_FACE_ID}) × ${N_TRIANGLES} triangles`);
    console.log(`  click → dispatch:`);
    for (const r of results) {
      console.log(
        `    triIdx ${String(r.triIdx).padStart(3)} → id=${r.result.dispatchedId}, via ${r.result.method}`
      );
    }
    const ids = results.map(r => r.result.dispatchedId).filter(x => x !== undefined);
    const uniqueCount = new Set(ids).size;
    console.log(`  Unique IDs dispatched: ${uniqueCount}`);
    if (uniqueCount === 1 && ids[0] === SPHERE_FACE_ID) {
      console.log('  ✅ 한 면 선택 (face-level Pick→Promote 작동)');
    } else {
      console.log('  ❌ 삼각형별 선택 (BUG)');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    expect(ids.length).toBe(5);
    expect(uniqueCount).toBe(1);
    expect(ids[0]).toBe(SPHERE_FACE_ID);
  });

  it('Multi-curve mesh: click 위치에 따라 정확한 다른 EdgeId promote', () => {
    // 두 분리된 곡선:
    //   - segments 0..31 → EdgeId 100 (curve A)
    //   - segments 32..63 → EdgeId 200 (curve B)
    const edgeMap: number[] = [
      ...new Array(32).fill(100),
      ...new Array(32).fill(200),
    ];

    const clicks = [
      { segIdx: 5, expectedId: 100 },
      { segIdx: 15, expectedId: 100 },
      { segIdx: 31, expectedId: 100 },
      { segIdx: 32, expectedId: 200 },
      { segIdx: 50, expectedId: 200 },
      { segIdx: 63, expectedId: 200 },
    ];
    const results = clicks.map(({ segIdx, expectedId }) => ({
      segIdx,
      expected: expectedId,
      result: simulateSingleEdgeClick(edgeMap, segIdx * 2),
    }));

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Multi-curve mesh 검증:');
    console.log(`  Setup: edgeMap = [100×32, 200×32]`);
    for (const r of results) {
      const ok = r.result.dispatchedId === r.expected ? '✅' : '❌';
      console.log(
        `    segIdx ${String(r.segIdx).padStart(2)} → expected ${r.expected}, actual ${r.result.dispatchedId} ${ok}`
      );
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const r of results) {
      expect(r.result.dispatchedId).toBe(r.expected);
    }

    // Curve A clicks all dispatch to 100, Curve B clicks all to 200
    const curveAIds = results.slice(0, 3).map(r => r.result.dispatchedId);
    expect(new Set(curveAIds)).toEqual(new Set([100]));
    const curveBIds = results.slice(3).map(r => r.result.dispatchedId);
    expect(new Set(curveBIds)).toEqual(new Set([200]));
  });
});
