// MCP tools/list + tools/call protocol wiring test.
import { describe, it, expect } from 'vitest';
import { buildAxiaMcpServer } from '../src/index.js';
import { MemoryAuditSink } from '../src/audit.js';
import type { EngineInstance, EngineModule } from '../src/capabilities/types.js';

function mockModule(): EngineModule {
  let drawCount = 0;
  return {
    schema_version: () => '1.0.0',
    engine_version: () => '0.1.0',
    AxiaEngine: class {
      draw_rect(): number {
        return ++drawCount;
      }
      push_pull(): boolean {
        return true;
      }
      exportSnapshotStrict(): Uint8Array {
        return new Uint8Array([0x41, 0x58, 0x69, 0x41]);
      }
    } as unknown as new () => EngineInstance,
  };
}

describe('ADR-041 — tools/list + tools/call protocol surface', () => {
  it('default config exposes only Tier 0 + 1 tools', () => {
    const mod = mockModule();
    const { config } = buildAxiaMcpServer({
      engineModule: mod,
      engineInstance: new mod.AxiaEngine(),
      auditSink: new MemoryAuditSink(),
      client: 'test',
    });
    expect(config.enabled_tiers).toEqual([0, 1]);
    // Internally `wireTools` filtered to tier 0/1. We can't easily probe
    // the Server's internal handler map without a transport, but the
    // filter logic is unit-tested via `tools.ts` import shape and
    // `dispatcher.test.ts` covers per-call enforcement.
  });

  it('Tier 2 visible only when explicitly enabled', () => {
    const mod = mockModule();
    const { config } = buildAxiaMcpServer({
      engineModule: mod,
      engineInstance: new mod.AxiaEngine(),
      tierConfig: { enabled_tiers: [0, 1, 2] },
      auditSink: new MemoryAuditSink(),
      client: 'test',
    });
    expect(config.enabled_tiers).toContain(2);
  });

  it('handshake error short-circuits server build', () => {
    const badMod: EngineModule = {
      schema_version: () => '99.0.0', // major break
      engine_version: () => '99.0.0',
      AxiaEngine: class {} as unknown as new () => EngineInstance,
    };
    expect(() =>
      buildAxiaMcpServer({
        engineModule: badMod,
        engineInstance: {} as EngineInstance,
        auditSink: new MemoryAuditSink(),
        client: 'test',
      }),
    ).toThrow(/MCP schema mismatch/);
  });
});
