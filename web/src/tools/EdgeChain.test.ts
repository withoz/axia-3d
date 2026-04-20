import { describe, it, expect, vi } from 'vitest';
import { extractEdgeChain } from './EdgeChain';

function makeBridge(
  endpoints: Record<number, [number, number]>,
  positions: Record<number, [number, number, number]>,
) {
  return {
    getEdgeEndpoints: vi.fn((eid: number) => endpoints[eid] ?? []),
    getVertexPos: vi.fn((vid: number) => positions[vid] ?? null),
  } as any;
}

describe('extractEdgeChain', () => {
  it('walks a simple open chain in order', () => {
    // v1 — e10 — v2 — e11 — v3 — e12 — v4
    const bridge = makeBridge(
      { 10: [1, 2], 11: [2, 3], 12: [3, 4] },
      { 1: [0, 0, 0], 2: [1, 0, 0], 3: [2, 0, 0], 4: [3, 0, 0] },
    );
    const result = extractEdgeChain([10, 11, 12], bridge);
    expect(result).not.toBeNull();
    expect(result!.closed).toBe(false);
    expect(result!.vertIds).toEqual([1, 2, 3, 4]);
    expect(result!.positions.length).toBe(4);
  });

  it('walks a closed loop and returns closed=true without trailing duplicate', () => {
    // Triangle: v1 — e10 — v2 — e11 — v3 — e12 — v1
    const bridge = makeBridge(
      { 10: [1, 2], 11: [2, 3], 12: [3, 1] },
      { 1: [0, 0, 0], 2: [1, 0, 0], 3: [0, 1, 0] },
    );
    const result = extractEdgeChain([10, 11, 12], bridge);
    expect(result).not.toBeNull();
    expect(result!.closed).toBe(true);
    expect(result!.vertIds.length).toBe(3);
    // No duplicate of first at end
    expect(result!.vertIds[0]).not.toBe(result!.vertIds[result!.vertIds.length - 1]);
  });

  it('accepts edges in arbitrary selection order (walker orders them)', () => {
    const bridge = makeBridge(
      { 10: [1, 2], 11: [2, 3], 12: [3, 4] },
      { 1: [0, 0, 0], 2: [1, 0, 0], 3: [2, 0, 0], 4: [3, 0, 0] },
    );
    const r1 = extractEdgeChain([10, 11, 12], bridge);
    const r2 = extractEdgeChain([12, 10, 11], bridge);
    // Walk may start from either endpoint depending on Map iteration order,
    // so we accept either direction. Both must produce the SAME set of
    // vertices in a monotonic order (ascending or its reverse).
    const reversed = [...r1!.vertIds].reverse();
    const matches = r2!.vertIds.every((v, i) => v === r1!.vertIds[i])
                 || r2!.vertIds.every((v, i) => v === reversed[i]);
    expect(matches).toBe(true);
  });

  it('rejects branching (a vertex with degree 3)', () => {
    // Y-shape: v1-v2, v2-v3, v2-v4 — v2 has degree 3
    const bridge = makeBridge(
      { 10: [1, 2], 11: [2, 3], 12: [2, 4] },
      { 1: [0, 0, 0], 2: [1, 0, 0], 3: [2, 0, 0], 4: [1, 1, 0] },
    );
    expect(extractEdgeChain([10, 11, 12], bridge)).toBeNull();
  });

  it('rejects disconnected selection', () => {
    // Two separate segments
    const bridge = makeBridge(
      { 10: [1, 2], 11: [3, 4] },
      { 1: [0, 0, 0], 2: [1, 0, 0], 3: [5, 0, 0], 4: [6, 0, 0] },
    );
    expect(extractEdgeChain([10, 11], bridge)).toBeNull();
  });

  it('returns null when bridge lookup fails', () => {
    const bridge = {
      getEdgeEndpoints: vi.fn().mockReturnValue([]),
      getVertexPos: vi.fn().mockReturnValue(null),
    } as any;
    expect(extractEdgeChain([1, 2], bridge)).toBeNull();
  });
});
