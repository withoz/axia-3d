// Tier 0 read capabilities — list_groups, get_face_info, get_edge_info.

import { describe, it, expect } from 'vitest';
import { dispatch, CapabilityInputError } from '../src/dispatcher.js';
import type { EngineInstance } from '../src/capabilities/types.js';

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

function mockEngine(overrides: Partial<EngineInstance> = {}): EngineInstance {
  return {
    draw_rect_as_shape: () => 1,
    draw_circle_as_shape: () => 2,
    draw_line_as_shape: () => 3,
    create_solid_extrude: () => true,
    exportSnapshotStrict: () => new Uint8Array(),
    allXiaIds: () => new Uint32Array(),
    sceneSummary: () => '{}',
    getXiaStats: () => '{}',
    getXiaFaceIds: () => new Uint32Array(),
    boolean_op: () => '{}',
    filletEdge: () => 0,
    translateVerts: () => true,
    getFaceVertices: () => new Uint32Array([10, 11, 12, 13]),
    faceArea: () => 100,
    isFaceInVolume: () => true,
    faceInnerLoopCount: () => 0,
    edgeCurveKind: () => 0,
    faceSurfaceKind: () => 1,
    tessellateEdge: () =>
      new Float64Array([0, 0, 0, 5, 0, 0, 10, 0, 0]), // start (0,0,0) → end (10,0,0)
    get_all_groups: () =>
      JSON.stringify([
        { id: 1, name: 'top', faceIds: [10, 11], parent: null, visible: true, locked: false, isComponent: false },
        { id: 2, name: 'cage', faceIds: [12], parent: 1, visible: true, locked: true, isComponent: true },
      ]),
    ...overrides,
  };
}

describe('list_groups (Tier 0, default)', () => {
  it('returns array of group summaries', async () => {
    const result = await dispatch(
      'list_groups',
      {},
      { engine: mockEngine(), versions: VERSIONS },
    );
    const out = result.output as { count: number; groups: { group_id: number; name?: string }[] };
    expect(out.count).toBe(2);
    expect(out.groups[0]!.group_id).toBe(1);
    expect(out.groups[0]!.name).toBe('top');
    expect(out.groups[1]!.is_component).toBe(true);
  });

  it('handles { groups: [...] } envelope shape', async () => {
    const engine = mockEngine({
      get_all_groups: () =>
        JSON.stringify({ groups: [{ id: 7, faceIds: [1, 2, 3] }] }),
    });
    const result = await dispatch('list_groups', {}, { engine, versions: VERSIONS });
    const out = result.output as { count: number; groups: { face_count: number }[] };
    expect(out.count).toBe(1);
    expect(out.groups[0]!.face_count).toBe(3);
  });

  it('malformed JSON → empty list (graceful)', async () => {
    const engine = mockEngine({ get_all_groups: () => 'not json' });
    const result = await dispatch('list_groups', {}, { engine, versions: VERSIONS });
    expect(result.output).toEqual({ count: 0, groups: [] });
  });

  it('empty scene → count 0', async () => {
    const engine = mockEngine({ get_all_groups: () => '[]' });
    const result = await dispatch('list_groups', {}, { engine, versions: VERSIONS });
    expect(result.output).toEqual({ count: 0, groups: [] });
  });

  it('skips groups without numeric id (defensive)', async () => {
    const engine = mockEngine({
      get_all_groups: () =>
        JSON.stringify([{ id: 1 }, { error: 'broken' }, { id: 3 }]),
    });
    const result = await dispatch('list_groups', {}, { engine, versions: VERSIONS });
    expect((result.output as { count: number }).count).toBe(2);
  });
});

describe('get_face_info (Tier 0, default)', () => {
  it('returns area + flags + vertices + surface_kind', async () => {
    const engine = mockEngine({
      faceArea: () => 250.5,
      isFaceInVolume: () => false,
      faceInnerLoopCount: () => 1,
      faceSurfaceKind: () => 7,
      getFaceVertices: () => new Uint32Array([20, 21, 22, 23]),
    });
    const result = await dispatch(
      'get_face_info',
      { face_id: 5 },
      { engine, versions: VERSIONS },
    );
    expect(result.output).toEqual({
      face_id: 5,
      area: 250.5,
      in_volume: false,
      inner_loop_count: 1,
      vertices: [20, 21, 22, 23],
      surface_kind: 7,
    });
  });

  it('rejects negative face_id (raw index leak)', async () => {
    await expect(
      dispatch(
        'get_face_info',
        { face_id: -1 },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });

  it('rejects float face_id', async () => {
    await expect(
      dispatch(
        'get_face_info',
        { face_id: 1.5 },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });
});

describe('get_edge_info (Tier 0, default)', () => {
  it('returns curve_kind + start/end + has_analytic_curve flag', async () => {
    const engine = mockEngine({
      edgeCurveKind: () => 2, // Circle
      tessellateEdge: () =>
        new Float64Array([0, 0, 0, 5, 5, 0, 10, 10, 0, 5, 15, 0, 0, 0, 0]),
    });
    const result = await dispatch(
      'get_edge_info',
      { edge_id: 3 },
      { engine, versions: VERSIONS },
    );
    const out = result.output as {
      edge_id: number;
      curve_kind: number;
      start: [number, number, number];
      end: [number, number, number];
      has_analytic_curve: boolean;
    };
    expect(out.edge_id).toBe(3);
    expect(out.curve_kind).toBe(2);
    expect(out.start).toEqual([0, 0, 0]);
    expect(out.end).toEqual([0, 0, 0]); // last triple of the polyline
    expect(out.has_analytic_curve).toBe(true);
  });

  it('plain LINE edge → curve_kind 0, has_analytic_curve false', async () => {
    const result = await dispatch(
      'get_edge_info',
      { edge_id: 1 },
      { engine: mockEngine(), versions: VERSIONS },
    );
    const out = result.output as { has_analytic_curve: boolean; curve_kind: number };
    expect(out.curve_kind).toBe(0);
    expect(out.has_analytic_curve).toBe(false);
  });

  it('empty tessellation → zero endpoints (defensive)', async () => {
    const engine = mockEngine({
      tessellateEdge: () => new Float64Array(0),
      edgeCurveKind: () => 3, // Arc, but tess empty
    });
    const result = await dispatch(
      'get_edge_info',
      { edge_id: 1 },
      { engine, versions: VERSIONS },
    );
    const out = result.output as {
      start: [number, number, number];
      end: [number, number, number];
      has_analytic_curve: boolean;
    };
    expect(out.start).toEqual([0, 0, 0]);
    expect(out.end).toEqual([0, 0, 0]);
    expect(out.has_analytic_curve).toBe(true); // kind 3 still set
  });

  it('rejects negative edge_id', async () => {
    await expect(
      dispatch(
        'get_edge_info',
        { edge_id: -2 },
        { engine: mockEngine(), versions: VERSIONS },
      ),
    ).rejects.toThrow(CapabilityInputError);
  });
});
