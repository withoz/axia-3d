// ADR-041 P26 — dispatcher integration: tier auth + input validation +
// audit + latency budget. Uses MOCK engine for fast deterministic runs.

import { describe, it, expect } from 'vitest';
import { dispatch, CapabilityInputError } from '../src/dispatcher.js';
import { CapabilityBlockedError, UnknownCapabilityError } from '../src/tiers.js';
import { MemoryAuditSink } from '../src/audit.js';
import type { EngineInstance } from '../src/capabilities/types.js';

function mockEngine(overrides: Partial<EngineInstance> = {}): EngineInstance {
  return {
    draw_rect_as_shape: () => 1,
    create_solid_extrude: () => true,
    exportSnapshotStrict: () => new Uint8Array([0x41, 0x58, 0x69, 0x41]), // "AXiA"
    ...overrides,
  };
}

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

describe('ADR-041 — capability dispatcher', () => {
  describe('Tier 1 — draw_rect (constructive, default-on)', () => {
    it('returns shape_id from engine', async () => {
      const engine = mockEngine({ draw_rect_as_shape: () => 42 });
      const sink = new MemoryAuditSink();
      const result = await dispatch(
        'draw_rect',
        {
          center: [0, 0, 0],
          width: 10,
          height: 5,
        },
        { engine, auditSink: sink, client: 'test', versions: VERSIONS },
      );
      expect(result.capability).toBe('draw_rect');
      expect(result.output).toEqual({ shape_id: 42 });
      // P26.7 — Tier 1 is NOT audited
      expect(sink.entries).toHaveLength(0);
    });

    it('applies default normal/up when omitted', async () => {
      let captured: number[] = [];
      const engine = mockEngine({
        draw_rect_as_shape: (...args: number[]) => {
          captured = args;
          return 1;
        },
      });
      await dispatch(
        'draw_rect',
        { center: [1, 2, 3], width: 4, height: 5 },
        { engine, versions: VERSIONS },
      );
      // [cx,cy,cz, nx,ny,nz, ux,uy,uz, w,h]
      expect(captured).toEqual([1, 2, 3, 0, 0, 1, 1, 0, 0, 4, 5]);
    });

    it('rejects negative width via Zod', async () => {
      await expect(
        dispatch(
          'draw_rect',
          { center: [0, 0, 0], width: -1, height: 5 },
          { engine: mockEngine(), versions: VERSIONS },
        ),
      ).rejects.toThrow(CapabilityInputError);
    });

    it('rejects float face_id (raw index leak attempt)', async () => {
      await expect(
        dispatch(
          'push_pull',
          { face_id: 1.5, distance: 10 },
          { engine: mockEngine(), config: { enabled_tiers: [0, 1, 2] }, versions: VERSIONS },
        ),
      ).rejects.toThrow(CapabilityInputError);
    });
  });

  describe('Tier 2 — push_pull (modificative, opt-in)', () => {
    it('blocked at default config', async () => {
      await expect(
        dispatch(
          'push_pull',
          { face_id: 1, distance: 10 },
          { engine: mockEngine(), versions: VERSIONS },
        ),
      ).rejects.toThrow(CapabilityBlockedError);
    });

    it('allowed with enabled_tiers=[0,1,2], records audit entry', async () => {
      const sink = new MemoryAuditSink();
      const engine = mockEngine({ create_solid_extrude: () => true });
      const result = await dispatch(
        'push_pull',
        { face_id: 7, distance: 25 },
        {
          engine,
          config: { enabled_tiers: [0, 1, 2] },
          auditSink: sink,
          client: 'claude-desktop',
          versions: VERSIONS,
        },
      );
      expect(result.output).toEqual({ success: true });
      // P26.7 — Tier 2 IS audited
      // Audit is fire-and-forget; await microtask to drain.
      await Promise.resolve();
      expect(sink.entries).toHaveLength(1);
      const entry = sink.entries[0]!;
      expect(entry.capability).toBe('push_pull');
      expect(entry.tier).toBe(2);
      expect(entry.client).toBe('claude-desktop');
      expect(entry.args).toEqual({ face_id: 7, distance: 25 });
      expect(entry.result).toBe('ok');
    });

    it('engine error still produces audit entry with result=error', async () => {
      const sink = new MemoryAuditSink();
      const engine = mockEngine({
        create_solid_extrude: () => {
          throw new Error('FaceId 99 not found');
        },
      });
      await expect(
        dispatch(
          'push_pull',
          { face_id: 99, distance: 10 },
          { engine, config: { enabled_tiers: [0, 1, 2] }, auditSink: sink, versions: VERSIONS },
        ),
      ).rejects.toThrow('FaceId 99 not found');
      await Promise.resolve();
      expect(sink.entries).toHaveLength(1);
      expect(sink.entries[0]!.result).toBe('error');
      expect(sink.entries[0]!.error_message).toBe('FaceId 99 not found');
    });
  });

  describe('Tier 1 — export_axia', () => {
    it('returns base64 + size of AXIA bytes', async () => {
      const sample = new Uint8Array([0x41, 0x58, 0x69, 0x41, 0x01, 0x02]);
      const engine = mockEngine({ exportSnapshotStrict: () => sample });
      const result = await dispatch('export_axia', {}, { engine, versions: VERSIONS });
      expect(result.output).toMatchObject({
        format: 'AXIA',
        size_bytes: 6,
      });
      const out = result.output as { bytes_base64: string };
      expect(Buffer.from(out.bytes_base64, 'base64').slice(0, 4).toString()).toBe(
        'AXiA',
      );
    });
  });

  describe('error paths', () => {
    it('UnknownCapabilityError for unregistered name', async () => {
      await expect(
        dispatch('rm_rf_slash', {}, { engine: mockEngine(), versions: VERSIONS }),
      ).rejects.toThrow(UnknownCapabilityError);
    });
  });

  describe('ADR-041 P26.5 / P26.8 — latency budget', () => {
    it('mcp_latency_budget_tier1_under_33ms — 100x draw_rect average', async () => {
      const engine = mockEngine();
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        const r = await dispatch(
          'draw_rect',
          { center: [0, 0, 0], width: 1, height: 1 },
          { engine, versions: VERSIONS },
        );
        samples.push(r.duration_ms);
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      // Mock engine has zero work, so this guards dispatcher overhead only.
      // Real WASM run is exercised in e2e.test.ts.
      expect(avg).toBeLessThan(33);
    });
  });
});
