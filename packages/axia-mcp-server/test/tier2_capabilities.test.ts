// Tier 2 capabilities — boolean_subtract / fillet_edge / move_xia
// (mock + light e2e mix).

import { describe, it, expect } from 'vitest';
import { dispatch, CapabilityInputError } from '../src/dispatcher.js';
import { CapabilityBlockedError } from '../src/tiers.js';
import { MemoryAuditSink } from '../src/audit.js';
import type { EngineInstance } from '../src/capabilities/types.js';

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };
const TIER2_POLICY = {
  enabled_tiers: [0 as const, 1 as const, 2 as const],
  allow_caps: new Set<string>(),
  deny_caps: new Set<string>(),
};

function mockEngine(overrides: Partial<EngineInstance> = {}): EngineInstance {
  return {
    draw_rect_as_shape: () => 1,
    draw_circle_as_shape: () => 2,
    draw_line_as_shape: () => 3,
    create_solid_extrude: () => true,
    exportSnapshotStrict: () => new Uint8Array(),
    allXiaIds: () => new Uint32Array([1, 2]),
    sceneSummary: () => '{}',
    getXiaStats: () => '{}',
    getXiaFaceIds: () => new Uint32Array([10, 11]),
    boolean_op: () =>
      JSON.stringify({
        ok: true,
        resultFaces: [99],
        totalVerts: 8,
        totalFaces: 6,
      }),
    filletEdge: () => 4,
    translateVerts: () => true,
    getFaceVertices: () => new Uint32Array([100, 101, 102]),
    ...overrides,
  };
}

describe('boolean_subtract (Tier 2)', () => {
  it('blocked at default tier policy', async () => {
    await expect(
      dispatch(
        'boolean_subtract',
        { faces_a: [1, 2], faces_b: [3, 4] },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityBlockedError);
  });

  it('passes face arrays to engine, parses JSON envelope', async () => {
    let captured: { a: Uint32Array; b: Uint32Array; op: string } | null = null;
    const engine = mockEngine({
      boolean_op: (a, b, op) => {
        captured = { a, b, op };
        return JSON.stringify({ ok: true, resultFaces: [99], totalVerts: 8, totalFaces: 6 });
      },
    });
    const result = await dispatch(
      'boolean_subtract',
      { faces_a: [1, 2, 3], faces_b: [4, 5] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(captured).not.toBeNull();
    expect(Array.from(captured!.a)).toEqual([1, 2, 3]);
    expect(Array.from(captured!.b)).toEqual([4, 5]);
    expect(captured!.op).toBe('subtract');
    expect(result.output).toEqual({
      ok: true,
      result_faces: [99],
      total_verts: 8,
      total_faces: 6,
    });
  });

  it('rejects empty face arrays via Zod', async () => {
    await expect(
      dispatch(
        'boolean_subtract',
        { faces_a: [], faces_b: [4, 5] },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });

  it('rejects negative face IDs (raw index leak)', async () => {
    await expect(
      dispatch(
        'boolean_subtract',
        { faces_a: [-1], faces_b: [4] },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });

  it('engine error → ok:false with error string', async () => {
    const engine = mockEngine({
      boolean_op: () =>
        JSON.stringify({ ok: false, error: 'face has hole — Phase G unsupported' }),
    });
    const result = await dispatch(
      'boolean_subtract',
      { faces_a: [1], faces_b: [2] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(result.output).toMatchObject({
      ok: false,
      error: expect.stringMatching(/hole/),
    });
  });

  it('non-JSON engine response → graceful error', async () => {
    const engine = mockEngine({ boolean_op: () => 'not json' });
    const result = await dispatch(
      'boolean_subtract',
      { faces_a: [1], faces_b: [2] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(result.output).toEqual({ ok: false, error: 'engine returned non-JSON' });
  });

  it('audit log records the call (Tier 2 = audited)', async () => {
    const sink = new MemoryAuditSink();
    await dispatch(
      'boolean_subtract',
      { faces_a: [1], faces_b: [2] },
      { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS, auditSink: sink },
    );
    await Promise.resolve();
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]!.capability).toBe('boolean_subtract');
    expect(sink.entries[0]!.tier).toBe(2);
  });
});

describe('fillet_edge (Tier 2)', () => {
  it('blocked at default tier', async () => {
    await expect(
      dispatch(
        'fillet_edge',
        { edge_id: 5, radius: 2 },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityBlockedError);
  });

  it('passes edge/radius/segments to engine', async () => {
    let captured: { id: number; r: number; s: number } | null = null;
    const engine = mockEngine({
      filletEdge: (id, r, s) => {
        captured = { id, r, s };
        return 7;
      },
    });
    const result = await dispatch(
      'fillet_edge',
      { edge_id: 12, radius: 1.5, segments: 16 },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(captured).toEqual({ id: 12, r: 1.5, s: 16 });
    expect(result.output).toEqual({ result_face_count: 7, ok: true });
  });

  it('default segments = 8', async () => {
    let captured = -1;
    const engine = mockEngine({
      filletEdge: (_id, _r, s) => {
        captured = s;
        return 1;
      },
    });
    await dispatch(
      'fillet_edge',
      { edge_id: 1, radius: 1 },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(captured).toBe(8);
  });

  it('rejects radius <= 0', async () => {
    await expect(
      dispatch(
        'fillet_edge',
        { edge_id: 1, radius: 0 },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
    await expect(
      dispatch(
        'fillet_edge',
        { edge_id: 1, radius: -1 },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });

  it('rejects segments out of [1, 64]', async () => {
    await expect(
      dispatch(
        'fillet_edge',
        { edge_id: 1, radius: 1, segments: 0 },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
    await expect(
      dispatch(
        'fillet_edge',
        { edge_id: 1, radius: 1, segments: 65 },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });

  it('engine returns 0 → ok=false', async () => {
    const engine = mockEngine({ filletEdge: () => 0 });
    const result = await dispatch(
      'fillet_edge',
      { edge_id: 1, radius: 1 },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(result.output).toEqual({ result_face_count: 0, ok: false });
  });
});

describe('move_xia (Tier 2)', () => {
  it('blocked at default tier', async () => {
    await expect(
      dispatch(
        'move_xia',
        { xia_id: 1, delta: [10, 0, 0] },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityBlockedError);
  });

  it('collects unique vertices, calls translateVerts once', async () => {
    let captured: { verts: Uint32Array; dx: number; dy: number; dz: number } | null = null;
    const engine = mockEngine({
      getXiaFaceIds: () => new Uint32Array([10, 11]),
      // overlap on vertex 102
      getFaceVertices: (faceId) =>
        faceId === 10
          ? new Uint32Array([100, 101, 102])
          : new Uint32Array([102, 103, 104]),
      translateVerts: (verts, dx, dy, dz) => {
        captured = { verts, dx, dy, dz };
        return true;
      },
    });
    const result = await dispatch(
      'move_xia',
      { xia_id: 1, delta: [5, -3, 2] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(captured).not.toBeNull();
    expect(Array.from(captured!.verts).sort((a, b) => a - b)).toEqual([
      100, 101, 102, 103, 104,
    ]);
    expect(captured!.dx).toBe(5);
    expect(captured!.dy).toBe(-3);
    expect(captured!.dz).toBe(2);
    expect(result.output).toEqual({
      ok: true,
      vertex_count: 5,
      is_no_op: false,
    });
  });

  it('XIA with no faces → no-op', async () => {
    const engine = mockEngine({
      getXiaFaceIds: () => new Uint32Array(),
    });
    const result = await dispatch(
      'move_xia',
      { xia_id: 1, delta: [1, 0, 0] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(result.output).toEqual({ ok: true, vertex_count: 0, is_no_op: true });
  });

  it('XIA with faces but no verts → no-op (defensive)', async () => {
    const engine = mockEngine({
      getXiaFaceIds: () => new Uint32Array([10]),
      getFaceVertices: () => new Uint32Array(),
    });
    const result = await dispatch(
      'move_xia',
      { xia_id: 1, delta: [1, 0, 0] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(result.output).toMatchObject({ is_no_op: true });
  });

  it('zero delta is allowed (no validation against trivial moves)', async () => {
    let called = false;
    const engine = mockEngine({
      translateVerts: () => {
        called = true;
        return true;
      },
    });
    const result = await dispatch(
      'move_xia',
      { xia_id: 1, delta: [0, 0, 0] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect(called).toBe(true);
    expect((result.output as { ok: boolean }).ok).toBe(true);
  });

  it('engine translateVerts failure → ok=false', async () => {
    const engine = mockEngine({ translateVerts: () => false });
    const result = await dispatch(
      'move_xia',
      { xia_id: 1, delta: [1, 0, 0] },
      { engine, policy: TIER2_POLICY, versions: VERSIONS },
    );
    expect((result.output as { ok: boolean }).ok).toBe(false);
  });

  it('rejects float xia_id', async () => {
    await expect(
      dispatch(
        'move_xia',
        { xia_id: 1.5, delta: [0, 0, 0] },
        { engine: mockEngine(), policy: TIER2_POLICY, versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });
});
