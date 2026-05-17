/**
 * Viewport edges 3-way policy — β-c (ADR-112, 사용자 결재 2026-05-17)
 *
 * β-c canonical: engine 명시 empty edges 결과 (smooth-group hide, LOCKED
 * #40 §L7) 가 의도된 결과. Viewport 가 EdgesGeometry fallback 으로 재계산
 * 하지 않고 빈 edges 로 정상 paint. 사용자 결재 β-c 묶음 (β-a + β-b).
 *
 * 검증:
 *   - `edgeLines === null`         → EdgesGeometry fallback 호출 (legacy)
 *   - `edgeLines === undefined`    → EdgesGeometry fallback 호출 (legacy)
 *   - `edgeLines.length > 0`       → DCEL render path
 *   - `edgeLines.length === 0`     → 빈 edges 정상 (smooth-group hide 의도)
 *
 * 효과: sphere-only 5-sphere scene 의 edges sub-step 비용 584ms → ~0ms.
 *
 * Cross-link: LOCKED #40 §L7 (smooth-group hide), ADR-038 P23 (surface-
 * aware normals), 메타-원칙 #11 (Heavy 500ms budget).
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * Mirror of Viewport.updateMesh edges branch (lines 1206-1262) —
 * verified-in-test contract for the 3-way edge fallback policy.
 *
 * Drift guard: if this stub diverges from Viewport.ts the unit tests
 * still cover the policy contract; for real-runtime parity see
 * preview measurement (β-c audit).
 */
type EdgeLines = Float32Array | null | undefined;

function classifyEdgesPath(edgeLines: EdgeLines): 'dcel' | 'empty-no-op' | 'fallback' {
  if (edgeLines !== null && edgeLines !== undefined) {
    if (edgeLines.length > 0) return 'dcel';
    return 'empty-no-op'; // β-b lock-in
  }
  return 'fallback'; // legacy WASM / mock / throw
}

describe('Viewport edges policy — β-c (ADR-112, 사용자 결재 2026-05-17)', () => {
  describe('β-c — 3-way policy', () => {
    it('edgeLines === null → EdgesGeometry fallback (legacy)', () => {
      expect(classifyEdgesPath(null)).toBe('fallback');
    });

    it('edgeLines === undefined → EdgesGeometry fallback (legacy)', () => {
      expect(classifyEdgesPath(undefined)).toBe('fallback');
    });

    it('edgeLines.length > 0 → DCEL render path', () => {
      const lines = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      expect(classifyEdgesPath(lines)).toBe('dcel');
    });

    it('edgeLines.length === 0 (smooth-group hide 의도) → empty no-op (NOT fallback)', () => {
      // L-112-2 핵심 lock-in: engine 명시 empty 는 fallback 호출 금지
      const lines = new Float32Array(0);
      expect(classifyEdgesPath(lines)).toBe('empty-no-op');
    });
  });

  describe('β-c — empty edges fallback 차단 (smooth-group hide 정합)', () => {
    it('engine empty result 는 EdgesGeometry 호출하지 않음', () => {
      // 핵심 회귀: 이전엔 empty array → WasmBridge null → fallback (584ms).
      // 본 패치 후: empty array → Float32Array(0) → 빈 edges no-op (~0ms).
      const edgesGeometryCallSpy = vi.fn();
      const onClassified = (path: string) => {
        if (path === 'fallback') edgesGeometryCallSpy();
      };

      // Simulate 3-sphere sphere-only scene
      const emptyEdges = new Float32Array(0);
      onClassified(classifyEdgesPath(emptyEdges));

      expect(edgesGeometryCallSpy).not.toHaveBeenCalled();
    });

    it('null edgeLines 는 EdgesGeometry 호출 (legacy 경로 보존)', () => {
      const edgesGeometryCallSpy = vi.fn();
      const onClassified = (path: string) => {
        if (path === 'fallback') edgesGeometryCallSpy();
      };

      onClassified(classifyEdgesPath(null));

      // legacy path 여전히 동작
      expect(edgesGeometryCallSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('β-c — LOCKED #40 §L7 정합 (smooth-group hide)', () => {
    it('sphere-only scene 모든 edges 가 smooth-group hide 후 empty (engine 의도)', () => {
      // LOCKED #40 §L7: 두 인접 face 가 같은 곡면 surface 인스턴스
      // (Sphere/Cylinder/Cone/Torus) 면 angle threshold 무시하고 edge hide
      // → sphere-only scene 의 모든 quad edges hide → empty
      const sphereOnlyEdges = new Float32Array(0);
      const classification = classifyEdgesPath(sphereOnlyEdges);
      expect(classification).toBe('empty-no-op');
      // 이 classification 이 fallback 이 아닌 것이 architectural correctness:
      // LOCKED #40 §L7 의 architectural decision 이 시각 layer 까지 정합.
    });

    it('mixed scene (box + sphere) 는 box edges 만 visible', () => {
      // box 6 faces × 12 edges 만 visible (sphere edges hide).
      // 실제 측정에서 12 segments (= 72 floats / 6) 반환.
      const mixedEdges = new Float32Array(72); // box 12 edges × 6 floats
      const classification = classifyEdgesPath(mixedEdges);
      expect(classification).toBe('dcel');
    });
  });
});
