// ADR-041 — integration test: real axia-wasm-node + MCP server build
//
// Skipped automatically if Node target build is not present (CI without
// Rust toolchain). Local dev should always run this.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildAxiaMcpServer } from '../src/index.js';
import { MemoryAuditSink } from '../src/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm.js');
const wasmBuilt = existsSync(wasmPath);

describe.skipIf(!wasmBuilt)('ADR-041 — real WASM integration', () => {
  it('handshake passes against actual axia-wasm Node build', async () => {
    const mod = (await import(wasmPath)) as {
      schema_version(): string;
      engine_version(): string;
      AxiaEngine: new () => {
        draw_rect(...args: number[]): number;
        push_pull(face_id: number, dist: number): boolean;
        exportSnapshotStrict(): Uint8Array;
      };
    };
    const { handshake, policy } = buildAxiaMcpServer({
      engineModule: mod,
      engineInstance: new mod.AxiaEngine(),
      auditSink: new MemoryAuditSink(),
      client: 'integration-test',
    });
    expect(handshake.compatible).toBe(true);
    expect(handshake.engine_schema).toMatch(/^\d+\.\d+\.\d+$/);
    expect(handshake.engine_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(policy.enabled_tiers).toEqual([0, 1]);
  });
});
