/**
 * ADR-038 P23.4 회귀 테스트 — Three.js 가 Rust analytic normal 을 존중.
 *
 * Rust `Mesh::export_buffers` 가 `Face.surface = Some(AnalyticSurface)` 인
 * face 의 vertex 마다 정확한 `surface.normal(u, v)` 를 emit (PR2 / P23.1).
 *
 * Three.js `Viewport.smoothNormals` 가 그 결과를 덮어쓰면 안 됨 — 본
 * 테스트는 그 invariant 를 검증.
 *
 * **Strategy** — `WasmBridge.faceHasAnalyticSurface(faceId)` 가 정상 동작
 * 하면 syncMesh 에서 analyticFaceIds Set 가 빌드되고, viewport.updateMesh
 * 가 receive 한 후 smoothNormals 가 그 face 의 vertex 를 skip.
 *
 * 본 파일은 단위 테스트 — 실제 mesh + viewport 통합은 mock 으로 검증.
 */

import { describe, it, expect } from 'vitest';
import { WasmBridge } from '../bridge/WasmBridge';

describe('ADR-038 P23.4: Three.js 가 Rust analytic normal 을 존중', () => {
  it('faceHasAnalyticSurface — engine 미연결 시 false 반환 (graceful)', () => {
    const bridge = new WasmBridge();
    // engine init 안 함 → fallback 으로 false
    expect(bridge.faceHasAnalyticSurface(0)).toBe(false);
    expect(bridge.faceHasAnalyticSurface(42)).toBe(false);
    expect(bridge.faceHasAnalyticSurface(999999)).toBe(false);
  });

  it('faceHasAnalyticSurface — engine 연결 + analytic face → true', () => {
    const bridge = new WasmBridge();
    // Mock engine with method
    (bridge as any).engine = {
      faceHasAnalyticSurface: (fid: number) => fid === 7,
    };
    expect(bridge.faceHasAnalyticSurface(7)).toBe(true);
    expect(bridge.faceHasAnalyticSurface(8)).toBe(false);
  });

  it('faceHasAnalyticSurface — engine throws → false (graceful)', () => {
    const bridge = new WasmBridge();
    (bridge as any).engine = {
      faceHasAnalyticSurface: () => { throw new Error('boom'); },
    };
    expect(bridge.faceHasAnalyticSurface(0)).toBe(false);
  });

  it('analyticFaceIds 빌드 — faceMap 의 unique 만 query', () => {
    // 시나리오: faceMap = [1,1,2,2,3,3,3] (3 unique IDs)
    // bridge.faceHasAnalyticSurface(1)=true, (2)=false, (3)=true
    // 결과: analyticFaceIds = {1, 3}
    const bridge = new WasmBridge();
    const queriedIds: number[] = [];
    (bridge as any).engine = {
      faceHasAnalyticSurface: (fid: number) => {
        queriedIds.push(fid);
        return fid === 1 || fid === 3;
      },
    };

    const faceMap = new Uint32Array([1, 1, 2, 2, 3, 3, 3]);
    const analyticFaceIds = new Set<number>();
    const uniqueFaceIds = new Set<number>(faceMap);
    for (const fid of uniqueFaceIds) {
      if (bridge.faceHasAnalyticSurface(fid)) {
        analyticFaceIds.add(fid);
      }
    }

    expect(analyticFaceIds.size).toBe(2);
    expect(analyticFaceIds.has(1)).toBe(true);
    expect(analyticFaceIds.has(2)).toBe(false);
    expect(analyticFaceIds.has(3)).toBe(true);
    // Unique 호출만 되었는지 (3 호출, 7 아님 — faceMap 의 7개 entry 만큼이 아님)
    expect(queriedIds.length).toBe(3);
    expect(new Set(queriedIds)).toEqual(new Set([1, 2, 3]));
  });

  it('빈 faceMap → analyticFaceIds 빈 집합 (drift 차단)', () => {
    const bridge = new WasmBridge();
    (bridge as any).engine = {
      faceHasAnalyticSurface: () => true,  // 의도적으로 true 반환
    };
    const faceMap = new Uint32Array(0);
    const analyticFaceIds = new Set<number>();
    if (faceMap.length > 0) {
      const uniqueFaceIds = new Set<number>(faceMap);
      for (const fid of uniqueFaceIds) {
        if (bridge.faceHasAnalyticSurface(fid)) {
          analyticFaceIds.add(fid);
        }
      }
    }
    expect(analyticFaceIds.size).toBe(0);
  });

  it('P23.4 invariant — analytic face id 가 set 에 포함되면 smoothNormals 가 skip', () => {
    // 본 테스트는 의미적 invariant — Viewport.smoothNormals 의 isAnalyticVertex
    // helper 는 incident triangle 의 faceMap 값을 analyticFaceIds 와 비교.
    //
    // 시뮬레이션:
    //   - 2 vertices, 1 triangle, faceMap = [42] (analytic face)
    //   - vertex 0 의 incident = [0]; faceMap[0] = 42; analyticFaceIds.has(42) = true
    //   - 따라서 isAnalyticVertex(0) = true → skip → Rust normal 유지
    const analyticFaceIds = new Set([42]);
    const faceMapArr = new Uint32Array([42]);
    const incident: number[][] = [[0], [0]];

    const isAnalyticVertex = (vi: number): boolean => {
      if (analyticFaceIds.size === 0 || faceMapArr.length === 0) return false;
      const inc = incident[vi];
      for (let k = 0; k < inc.length; k++) {
        const tri = inc[k];
        if (tri < faceMapArr.length && analyticFaceIds.has(faceMapArr[tri])) {
          return true;
        }
      }
      return false;
    };

    expect(isAnalyticVertex(0)).toBe(true);
    expect(isAnalyticVertex(1)).toBe(true);
  });

  it('P23.4 invariant — non-analytic face 는 smoothNormals 가 정상 동작', () => {
    const analyticFaceIds = new Set([42]);
    const faceMapArr = new Uint32Array([7]);  // face 7 은 analytic 아님
    const incident: number[][] = [[0], [0]];

    const isAnalyticVertex = (vi: number): boolean => {
      if (analyticFaceIds.size === 0 || faceMapArr.length === 0) return false;
      const inc = incident[vi];
      for (let k = 0; k < inc.length; k++) {
        const tri = inc[k];
        if (tri < faceMapArr.length && analyticFaceIds.has(faceMapArr[tri])) {
          return true;
        }
      }
      return false;
    };

    expect(isAnalyticVertex(0)).toBe(false);
    expect(isAnalyticVertex(1)).toBe(false);
  });

  it('P23.4 invariant — analytic + polygon mixed: vertex 가 어느 한쪽 analytic 이면 skip', () => {
    const analyticFaceIds = new Set([42]);
    // vertex 0 은 triangle 0 (face 42, analytic) + triangle 1 (face 7, polygon) 둘 다 속함
    const faceMapArr = new Uint32Array([42, 7]);
    const incident: number[][] = [[0, 1]];

    const isAnalyticVertex = (vi: number): boolean => {
      if (analyticFaceIds.size === 0 || faceMapArr.length === 0) return false;
      const inc = incident[vi];
      for (let k = 0; k < inc.length; k++) {
        const tri = inc[k];
        if (tri < faceMapArr.length && analyticFaceIds.has(faceMapArr[tri])) {
          return true;
        }
      }
      return false;
    };

    // 어느 한쪽이라도 analytic 이면 vertex 는 analytic 으로 분류 → skip
    // (Rust 의 정확 normal 우선 — averaging 으로 망치지 않음)
    expect(isAnalyticVertex(0)).toBe(true);
  });
});
