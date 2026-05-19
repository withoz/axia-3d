// ADR-101 H-β — MCP `merge_coplanar_containing` Tier 2 capability tests.
//
// Validates:
//   1. Capability dispatchable when Tier 2 enabled (returns new_face_id +
//      inner_loop_count, both validating against output schema).
//   2. Engine method invocation forwards inputs verbatim and surfaces the
//      `-1` engine sentinel as a thrown error.
//   3. Real WASM round-trip — UI tool path ↔ headless dispatch produce
//      semantically equivalent hole topology (메타-원칙 #15).
//
// 절대 #[ignore] 금지 (LOCKED 정책).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { dispatch } from '../src/dispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm.js');
const wasmBuilt = existsSync(wasmPath);

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

// Minimal mock surface — only the methods the merge_coplanar_containing
// capability handler touches.
interface MockEngine {
  mergeCoplanarContaining: (
    outer: number,
    inner: number,
    tol: number,
  ) => number;
  faceInnerLoopCount: (face: number) => number;
}

function mockEngine(overrides: Partial<MockEngine> = {}): MockEngine {
  return {
    mergeCoplanarContaining: () => 42,
    faceInnerLoopCount: () => 1,
    ...overrides,
  };
}

describe('ADR-101 H-β — merge_coplanar_containing capability', () => {
  it('dispatchable when Tier 2 enabled, returns new_face_id + inner_loop_count', async () => {
    const engine = mockEngine({
      mergeCoplanarContaining: () => 7,
      faceInnerLoopCount: (f) => (f === 7 ? 1 : 0),
    });
    const result = await dispatch(
      'merge_coplanar_containing',
      { outer_face_id: 0, inner_face_id: 1, angle_tol_deg: 1.0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { engine: engine as any, config: { enabled_tiers: [0, 1, 2] }, versions: VERSIONS },
    );
    expect(result.capability).toBe('merge_coplanar_containing');
    expect(result.output).toEqual({ new_face_id: 7, inner_loop_count: 1 });
  });

  it('blocked when Tier 2 disabled (default [0, 1] config)', async () => {
    const engine = mockEngine();
    await expect(
      dispatch(
        'merge_coplanar_containing',
        { outer_face_id: 0, inner_face_id: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { engine: engine as any, versions: VERSIONS },
      ),
    ).rejects.toThrow(/blocked|tier|denied/i);
  });

  it('forwards inputs verbatim to engine.mergeCoplanarContaining', async () => {
    const calls: Array<[number, number, number]> = [];
    const engine = mockEngine({
      mergeCoplanarContaining: (o, i, t) => {
        calls.push([o, i, t]);
        return 99;
      },
    });
    await dispatch(
      'merge_coplanar_containing',
      { outer_face_id: 12, inner_face_id: 34, angle_tol_deg: 2.5 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { engine: engine as any, config: { enabled_tiers: [0, 1, 2] }, versions: VERSIONS },
    );
    expect(calls).toEqual([[12, 34, 2.5]]);
  });

  it('engine `-1` sentinel surfaces as a thrown Error', async () => {
    const engine = mockEngine({ mergeCoplanarContaining: () => -1 });
    await expect(
      dispatch(
        'merge_coplanar_containing',
        { outer_face_id: 0, inner_face_id: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { engine: engine as any, config: { enabled_tiers: [0, 1, 2] }, versions: VERSIONS },
      ),
    ).rejects.toThrow(/mergeCoplanarContaining failed/);
  });

  it('default angle_tol_deg = 1.0 when omitted', async () => {
    const calls: number[] = [];
    const engine = mockEngine({
      mergeCoplanarContaining: (_o, _i, t) => {
        calls.push(t);
        return 1;
      },
    });
    await dispatch(
      'merge_coplanar_containing',
      { outer_face_id: 0, inner_face_id: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { engine: engine as any, config: { enabled_tiers: [0, 1, 2] }, versions: VERSIONS },
    );
    expect(calls).toEqual([1.0]);
  });
});

// ─── Real WASM round-trip (skipIf no Node target build) ─────────────────
interface HeadlessEngine {
  draw_rect_as_shape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    width: number, height: number,
  ): number;
  draw_circle_as_shape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ): number;
  mergeCoplanarContaining(outer: number, inner: number, tol: number): number;
  faceArea(face_id: number): number;
  faceInnerLoopCount(face_id: number): number;
  verifyInvariants(): string;
  get_face_map(): Uint32Array;
}

describe.skipIf(!wasmBuilt)(
  'ADR-101 H-β — merge_coplanar_containing real WASM e2e',
  () => {
    it('rect + inner circle → dispatch merge → 1 face with 1 hole loop, invariants 0', async () => {
      const mod = (await import(wasmPath)) as {
        AxiaEngine: new () => HeadlessEngine;
      };
      const engine = new mod.AxiaEngine();
      engine.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
      engine.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

      const faceIds = [...new Set(engine.get_face_map())];
      const faces = faceIds
        .map((fid) => ({ fid, area: engine.faceArea(fid) }))
        .sort((a, b) => b.area - a.area);
      const [outer, inner] = faces;

      const result = await dispatch(
        'merge_coplanar_containing',
        {
          outer_face_id: outer.fid,
          inner_face_id: inner.fid,
          angle_tol_deg: 1.0,
        },
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          engine: engine as any,
          config: { enabled_tiers: [0, 1, 2] },
          versions: VERSIONS,
        },
      );

      const out = result.output as {
        new_face_id: number;
        inner_loop_count: number;
      };
      expect(out.new_face_id).toBeGreaterThanOrEqual(0);
      expect(out.inner_loop_count).toBe(1);

      // mesh has exactly 1 active face now
      const activeAfter = [...new Set(engine.get_face_map())];
      expect(activeAfter.length).toBe(1);

      // ADR-007 invariants 0 violations
      const report = JSON.parse(engine.verifyInvariants());
      expect(report.valid).toBe(true);
      expect(report.violationCount).toBe(0);
    });

    it('swap (small outer + big inner) — engine returns -1, capability throws', async () => {
      const mod = (await import(wasmPath)) as {
        AxiaEngine: new () => HeadlessEngine;
      };
      const engine = new mod.AxiaEngine();
      engine.draw_rect_as_shape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2000, 4000);
      engine.draw_circle_as_shape(0, 0, 0, 0, 0, 1, 500, 64);

      const faceIds = [...new Set(engine.get_face_map())];
      const faces = faceIds
        .map((fid) => ({ fid, area: engine.faceArea(fid) }))
        .sort((a, b) => b.area - a.area);
      const [outer, inner] = faces;

      await expect(
        dispatch(
          'merge_coplanar_containing',
          // swap — small face as outer, big as inner: containment fail
          { outer_face_id: inner.fid, inner_face_id: outer.fid },
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            engine: engine as any,
            config: { enabled_tiers: [0, 1, 2] },
            versions: VERSIONS,
          },
        ),
      ).rejects.toThrow(/mergeCoplanarContaining failed/);
    });
  },
);
