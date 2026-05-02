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
  it('default policy exposes Tier 0 + 1 tools', () => {
    const mod = mockModule();
    const { policy } = buildAxiaMcpServer({
      engineModule: mod,
      engineInstance: new mod.AxiaEngine(),
      auditSink: new MemoryAuditSink(),
      client: 'test',
    });
    expect(policy.enabled_tiers).toEqual([0, 1]);
    expect(policy.allow_caps.size).toBe(0);
    expect(policy.deny_caps.size).toBe(0);
  });

  it('Tier 2 enabled when explicit policy passed', () => {
    const mod = mockModule();
    const { policy } = buildAxiaMcpServer({
      engineModule: mod,
      engineInstance: new mod.AxiaEngine(),
      policy: {
        enabled_tiers: [0, 1, 2],
        allow_caps: new Set(),
        deny_caps: new Set(),
      },
      auditSink: new MemoryAuditSink(),
      client: 'test',
    });
    expect(policy.enabled_tiers).toContain(2);
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
