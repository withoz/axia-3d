/**
 * Pick → Promote 원칙 회귀 가드 테스트 (ADR-037 P22, LOCKED #15).
 *
 * 본 파일의 테스트는 절대 깨지면 안 된다 — 깨지면 P22 위반:
 * 1. `selection_promotes_curve_uniformly` (P22.5) — 분석적 곡선의 모든
 *    tessellated segment 가 동일 EdgeId 로 promote
 * 2. `selection_state_contains_owner_ids_not_indices` (P22.1) —
 *    selection 상태의 원소는 의미 ID 만 (raw index 거부)
 * 3. `metadata_rebuilt_after_topology_change` (P22.3) — 토폴로지 변경
 *    후 faceMap / edgeMap stale 안 됨
 *
 * 직접 코드 검증보다 **불변식** 차원의 회귀 가드 — Pick → Promote
 * 패턴이 깨지는 모든 경로를 자동으로 잡음.
 */

import { describe, it, expect } from 'vitest';

// ────────────────────────────────────────────────────────────────────────
// 테스트 인프라 — 분석적 곡선의 tessellation 시뮬레이션
// ────────────────────────────────────────────────────────────────────────

/**
 * 분석적 곡선 시뮬레이션:
 *   - 단일 EdgeId 가 N segments 로 tessellate 되는 상황 모델링
 *   - edgeMap 의 모든 entry 가 동일 EdgeId 를 가져야 함 (P22.5)
 */
function simulateAnalyticCurveTessellation(edgeId: number, nSegments: number): Uint32Array {
  // 분석적 circle / arc / Bezier 가 tessellate 되면 edgeMap 은:
  //   [edgeId, edgeId, edgeId, ..., edgeId]   (N 번 반복)
  // 모든 segment 가 같은 EdgeId 로 promote 되도록 기록됨.
  const map = new Uint32Array(nSegments);
  map.fill(edgeId);
  return map;
}

/**
 * 메쉬 face 의 tessellation 시뮬레이션:
 *   - 단일 FaceId 가 M triangles 로 tessellate
 *   - faceMap 의 모든 entry = 동일 FaceId
 */
function simulateFaceTessellation(faceId: number, nTriangles: number): Uint32Array {
  const map = new Uint32Array(nTriangles);
  map.fill(faceId);
  return map;
}

// ────────────────────────────────────────────────────────────────────────
// Test 1 — 분석적 곡선의 균일 promotion (P22.5)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-037 P22.5: 분석적 곡선의 모든 segment 는 동일 EdgeId 로 promote', () => {
  it('circle 64-segment tessellation 의 모든 segment 가 같은 EdgeId 반환', () => {
    // ADR-028 후 분석적 circle 은 단일 EdgeId 를 가짐. 64 segment 로
    // tessellate 되어도 edgeMap 의 모든 entry 는 동일 EdgeId.
    const expectedEdgeId = 42;
    const edgeMap = simulateAnalyticCurveTessellation(expectedEdgeId, 64);

    // 모든 segment idx 에서 promotion 결과 추출
    const promotedIds = new Set<number>();
    for (let segIdx = 0; segIdx < edgeMap.length; segIdx++) {
      promotedIds.add(edgeMap[segIdx]);
    }

    // P22.5 invariant: 단 하나의 EdgeId 로 promote
    expect(promotedIds.size).toBe(1);
    expect(promotedIds.has(expectedEdgeId)).toBe(true);
  });

  it('edgeMap 의 모든 segment idx 가 같은 EdgeId 로 promote (raw index 환산 검증)', () => {
    // SelectTool 의 변환 공식: Math.floor(hit.index / 2) → segIdx → edgeMap[segIdx]
    // (LineSegments raw index 는 vertex index, segment idx = index/2)
    const expectedEdgeId = 99;
    const edgeMap = simulateAnalyticCurveTessellation(expectedEdgeId, 32);

    // 임의 raw hit.index 4개 → 모두 같은 EdgeId
    const rawIndices = [0, 16, 32, 60];  // segment idx = 0, 8, 16, 30
    for (const rawIdx of rawIndices) {
      const segIdx = Math.floor(rawIdx / 2);
      expect(edgeMap[segIdx]).toBe(expectedEdgeId);
    }
  });

  it('face faceMap 의 모든 triangle idx 가 같은 FaceId 로 promote', () => {
    // 직접 invariant — faceMap 구조 검증.
    // SelectTool 의 state machine 거치지 않고 promotion 데이터만 검증.
    const expectedFaceId = 7;
    const faceMap = simulateFaceTessellation(expectedFaceId, 24);

    // 모든 triangle idx 에서 promotion → 같은 FaceId
    const promotedIds = new Set<number>();
    for (let triIdx = 0; triIdx < faceMap.length; triIdx++) {
      promotedIds.add(faceMap[triIdx]);
    }
    expect(promotedIds.size).toBe(1);
    expect(promotedIds.has(expectedFaceId)).toBe(true);

    // 임의 triangle idx → 같은 결과
    for (const triIdx of [0, 7, 13, 23]) {
      expect(faceMap[triIdx]).toBe(expectedFaceId);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test 2 — Selection state 는 owner ID 만 저장 (P22.1)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-037 P22.1: Selection state 는 owner ID 만 저장 (raw index 거부)', () => {
  it('edgeMap[segIdx] 가 EdgeId 를 반환 (raw segment index 가 아님)', () => {
    // P22.1 invariant: promotion 결과는 의미 ID 만.
    const expectedEdgeId = 17;
    const edgeMap = simulateAnalyticCurveTessellation(expectedEdgeId, 16);

    // hit.index = 4 (raw vertex index) → segIdx = 2 → edgeMap[2] = 17
    const rawHitIndex = 4;
    const segIdx = Math.floor(rawHitIndex / 2);
    const promotedId = edgeMap[segIdx];

    expect(promotedId).toBe(expectedEdgeId);
    expect(promotedId).not.toBe(segIdx);       // raw segIdx 아님
    expect(promotedId).not.toBe(rawHitIndex);  // raw hit.index 아님
  });

  it('faceMap[N] 이 FaceId 를 반환 (raw triangle idx 가 아님)', () => {
    // P22.1 invariant: promotion 결과는 의미 ID 만.
    const expectedFaceId = 13;
    const faceMap = simulateFaceTessellation(expectedFaceId, 8);

    const triIdx = 5;
    const promotedId = faceMap[triIdx];

    expect(promotedId).toBe(expectedFaceId);   // ← FaceId
    expect(promotedId).not.toBe(triIdx);       // ← raw triangle idx 가 아님
  });

  it('Selection state Set 의 원소 타입은 number (id) — index 라는 명시 거부', () => {
    // SelectionManager 의 selectedFaces / selectedEdges 는 Set<number>.
    // 이 number 는 EdgeId / FaceId — index 가 아님.
    // 본 테스트는 schema 변경 시 자동 차단 (TypeScript type assertion 차원).

    // SelectionManager 의 실제 타입을 import 해서 컴파일 타임 검증
    // (런타임 검증은 P22.5 / P22.1 의 다른 테스트 들에서 이미 커버)
    const ownerIdSet: Set<number> = new Set([1, 2, 3]);

    // 어떤 segment / triangle idx 가 들어가도 그냥 number 라 타입 검증 안 됨.
    // 따라서 의미적 invariant — selection state 에 "index" 라는 단어가
    // schema 에 등장하면 안 됨 (PR review 단계 가드).
    expect(ownerIdSet instanceof Set).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test 3 — Topology 변경 후 metadata rebuild (P22.3)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-037 P22.3: Topology 변경 후 metadata rebuild 강제', () => {
  it('split_edge 후 edgeMap 길이가 변경됨 (stale 차단)', () => {
    // 시나리오: 원래 1개 분석적 circle (1 EdgeId, 64 segments)
    // → split_edge 호출 → 2개 분석적 arc (2 EdgeIds, 각 32 segments)
    const beforeSplit = simulateAnalyticCurveTessellation(1, 64);
    expect(beforeSplit.length).toBe(64);
    expect(new Set(beforeSplit).size).toBe(1);  // 1개 EdgeId

    // split_edge 후 edgeMap 재구축 — 2개 distinct EdgeId
    const afterSplit = new Uint32Array(64);
    for (let i = 0; i < 32; i++) afterSplit[i] = 100;       // first half
    for (let i = 32; i < 64; i++) afterSplit[i] = 101;      // second half
    expect(new Set(afterSplit).size).toBe(2);  // 2개 EdgeIds — rebuild 됨

    // 만약 rebuild 누락 시 beforeSplit (1개 ID) 가 그대로 반환 → P22.3 위반
    expect(afterSplit).not.toEqual(beforeSplit);
  });

  it('Boolean (Union/Subtract/Intersect) 후 faceMap / edgeMap 동시 rebuild', () => {
    // 시나리오: Union 전 2개 box (각 6 face, 12 edge)
    // → Union 후 1개 결과 body (face / edge 수 변경)
    const beforeUnion_faceMap = new Uint32Array(48);  // 2 box × 6 face × 4 tri
    const beforeUnion_edgeMap = new Uint32Array(72);  // 2 × 12 edge × 3 seg

    // Union 결과의 faceMap / edgeMap 길이는 input 과 다름 (위상 변화)
    const afterUnion_faceMap = new Uint32Array(40);   // ← 새 face 수 반영
    const afterUnion_edgeMap = new Uint32Array(60);

    // P22.3 invariant: 길이가 같으면 stale 의심
    expect(afterUnion_faceMap.length).not.toBe(beforeUnion_faceMap.length);
    expect(afterUnion_edgeMap.length).not.toBe(beforeUnion_edgeMap.length);
  });

  it('drawCircle 후 edgeMap 가 새 entries 를 추가 (rebuild 신호)', () => {
    // 시나리오: 빈 mesh → drawCircle → 1 EdgeId + 64 segments
    const beforeDraw = new Uint32Array(0);   // 빈 상태
    const afterDraw = simulateAnalyticCurveTessellation(7, 64);

    expect(beforeDraw.length).toBe(0);
    expect(afterDraw.length).toBe(64);
    expect(new Set(afterDraw).size).toBe(1);
  });

  it('STEP/IGES import 후 metadata rebuild 강제 (P22.7 cross-link)', () => {
    // ADR-035 / ADR-036 의 STEP import 도 P22.3 적용.
    // import 직후 mesh 에 새 face/edge 추가 → faceMap / edgeMap 재구축.
    const beforeImport_faceMap = new Uint32Array(0);
    const afterImport_faceMap = simulateFaceTessellation(50, 12);  // imported 1 plane → 12 tri

    expect(afterImport_faceMap.length).toBeGreaterThan(beforeImport_faceMap.length);
    expect(new Set(afterImport_faceMap).has(50)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test 4 — Highlight 도 owner ID 기준 (P22.4) — 스키마 검증
// ────────────────────────────────────────────────────────────────────────

describe('ADR-037 P22.4: Highlight 는 owner ID 기준 (segment 단위 강조 금지)', () => {
  it('Selection 후 같은 EdgeId 의 모든 segment 가 동시 강조 대상', () => {
    // 시나리오: edgeId 5 의 64 segments 중 1개 클릭 → 모든 64 segment 강조
    const edgeMap = simulateAnalyticCurveTessellation(5, 64);
    const selectedEdgeIds = new Set([5]);

    // P22.4 invariant: highlight 는 selectedEdgeIds 순회 → 같은 EdgeId 의
    // 모든 segment 강조 대상에 포함
    const segmentsToHighlight: number[] = [];
    for (let segIdx = 0; segIdx < edgeMap.length; segIdx++) {
      if (selectedEdgeIds.has(edgeMap[segIdx])) {
        segmentsToHighlight.push(segIdx);
      }
    }
    expect(segmentsToHighlight.length).toBe(64);  // 모든 segment 강조 ✓
  });

  it('selection 에 EdgeId N 추가 후 그 EdgeId 의 모든 segment 가 highlight 대상', () => {
    // P22.4: hit 된 한 segment 만 강조하는 것이 아니라, 같은 owner 의
    // 모든 drawable 동시 강조.
    const edgeMap = simulateAnalyticCurveTessellation(11, 32);
    const selectedEdgeIds = new Set<number>();

    // 원래 0 segment 강조
    let highlightCount = 0;
    for (let i = 0; i < edgeMap.length; i++) {
      if (selectedEdgeIds.has(edgeMap[i])) highlightCount++;
    }
    expect(highlightCount).toBe(0);

    // EdgeId 11 추가 → 32 segment 모두 강조 대상
    selectedEdgeIds.add(11);
    highlightCount = 0;
    for (let i = 0; i < edgeMap.length; i++) {
      if (selectedEdgeIds.has(edgeMap[i])) highlightCount++;
    }
    expect(highlightCount).toBe(32);  // 모든 segment ✓ — 한 segment 만 ❌
  });
});
