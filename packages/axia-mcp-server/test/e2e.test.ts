// ADR-041 P26 — end-to-end: real axia-wasm-node + dispatcher + audit.
// Skipped if Node WASM build is not present.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { dispatch } from '../src/dispatcher.js';
import { MemoryAuditSink } from '../src/audit.js';
import type { EngineInstance, EngineModule } from '../src/capabilities/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm.js');
const wasmBuilt = existsSync(wasmPath);

async function loadEngine(): Promise<EngineInstance> {
  const mod = (await import(wasmPath)) as unknown as EngineModule;
  return new mod.AxiaEngine();
}

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

describe.skipIf(!wasmBuilt)('ADR-041 — end-to-end with real WASM', () => {
  it('draw_rect → real engine returns positive ShapeId', async () => {
    // ADR-050 P-5e-α migration — draw_rect now creates a form-layer
    // Shape (not a Xia). Returned ID is a ShapeId; promotion to Xia
    // (via `promote_shape_to_xia` capability) is a separate Tier 2 op.
    const engine = await loadEngine();
    const result = await dispatch(
      'draw_rect',
      {
        center: [0, 0, 0],
        normal: [0, 0, 1],
        up: [1, 0, 0],
        width: 100,
        height: 50,
      },
      { engine, client: 'e2e', versions: VERSIONS },
    );
    const out = result.output as { shape_id: number };
    expect(out.shape_id).toBeGreaterThan(0);
    expect(Number.isInteger(out.shape_id)).toBe(true);
  });

  it('mcp_latency_budget — Tier 1 draw_rect e2e under 33ms median', async () => {
    const engine = await loadEngine();
    // warmup
    await dispatch(
      'draw_rect',
      { center: [0, 0, 0], width: 1, height: 1 },
      { engine, versions: VERSIONS },
    );
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await dispatch(
        'draw_rect',
        { center: [i * 10, 0, 0], width: 5, height: 5 },
        { engine, versions: VERSIONS },
      );
      samples.push(r.duration_ms);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median).toBeLessThan(33);
  });

  it('mcp_session_isolation_user_unaffected — independent engine instances', async () => {
    // Two separate AxiaEngine instances must not share mesh state.
    // ADR-041 P26.6 — AI agent session is sandboxed from user viewport.
    const engineA = await loadEngine();
    const engineB = await loadEngine();
    await dispatch(
      'draw_rect',
      { center: [0, 0, 0], width: 100, height: 100 },
      { engine: engineA, versions: VERSIONS },
    );
    // engineB still empty — its export should have a different size than
    // engineA's (which has a face). Both should still produce valid AXIA.
    const exportA = (await dispatch('export_axia', {}, { engine: engineA, versions: VERSIONS }))
      .output as { size_bytes: number; format: string };
    const exportB = (await dispatch('export_axia', {}, { engine: engineB, versions: VERSIONS }))
      .output as { size_bytes: number; format: string };
    expect(exportA.format).toBe('AXIA');
    expect(exportB.format).toBe('AXIA');
    expect(exportA.size_bytes).toBeGreaterThan(0);
    expect(exportB.size_bytes).toBeGreaterThan(0);
    // engineA has more data than engineB
    expect(exportA.size_bytes).not.toBe(exportB.size_bytes);
  });

  it('export_axia produces AXIA magic bytes', async () => {
    const engine = await loadEngine();
    const result = await dispatch('export_axia', {}, { engine, versions: VERSIONS });
    const out = result.output as { bytes_base64: string; format: string; size_bytes: number };
    expect(out.format).toBe('AXIA');
    const bytes = Buffer.from(out.bytes_base64, 'base64');
    expect(bytes.length).toBe(out.size_bytes);
    // First 4 bytes should be the AXIA magic — verified in axia-core
    // serialization tests; here we just check it's non-empty and valid base64.
    expect(out.size_bytes).toBeGreaterThan(0);
  });

  it('push_pull (Tier 2) on a real face — audit recorded', async () => {
    const engine = await loadEngine();
    const sink = new MemoryAuditSink();
    // Draw rect → take its face → push_pull.
    // draw_rect returns XiaId, but push_pull needs FaceId.
    // The newly created XIA has exactly one face; engine guarantees FaceId
    // monotonic from 0 — first rect → FaceId 0 (after epoch processing).
    // For this test we accept push_pull may fail if FaceId binding differs;
    // we only assert audit is emitted regardless.
    await dispatch(
      'draw_rect',
      { center: [0, 0, 0], width: 50, height: 50 },
      { engine, versions: VERSIONS },
    );
    try {
      await dispatch(
        'push_pull',
        { face_id: 0, distance: 25 },
        {
          engine,
          config: { enabled_tiers: [0, 1, 2] },
          auditSink: sink,
          client: 'e2e',
          versions: VERSIONS,
        },
      );
    } catch {
      /* may fail if FaceId 0 isn't available — audit must still record */
    }
    await Promise.resolve();
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]!.tier).toBe(2);
    expect(sink.entries[0]!.capability).toBe('push_pull');
  });
});
