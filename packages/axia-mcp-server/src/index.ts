#!/usr/bin/env node
// AxiA 3D MCP Server — entry point
// ADR-041 (Capability-Sandboxed MCP Surface)
//
// Wiring order:
//   1. Load axia-wasm-node (headless engine, ADR-041 P26.4)
//   2. Handshake — verify schema compatibility (P26.2)
//   3. Build CapabilitySurface from tier config (P26.1)
//   4. Register MCP tools that pass tier authorization
//   5. Start stdio transport
//
// Capability handler implementations live in src/capabilities/* — added in
// Stage 3 (draw_rect / push_pull / export_axia first).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { performHandshake, type EngineHandle } from './handshake.js';
import { FileAuditSink, NullAuditSink, type AuditSink } from './audit.js';
import { wireTools } from './tools.js';
import {
  policyFromEnv,
  DEFAULT_POLICY,
  UnknownCapabilityInPolicyError,
  type CapabilityPolicy,
} from './policy.js';
import type { EngineInstance, EngineModule } from './capabilities/types.js';

export interface AxiaMcpServerOptions {
  /** Module exports — used for handshake (schema_version / engine_version). */
  engineModule: EngineHandle;
  /** Engine instance used by capability handlers. */
  engineInstance: EngineInstance;
  /**
   * ADR-042 P27 — full capability policy. Defaults to `policyFromEnv()`
   * which reads AXIA_MCP_TIERS / ALLOW_CAPS / DENY_CAPS.
   */
  policy?: CapabilityPolicy;
  auditSink?: AuditSink;
  client?: string;
}

/**
 * Build an MCP server instance — pure function, no I/O until `connect()`.
 * Easy to test by passing a mock engine module + instance.
 *
 * Throws `UnknownCapabilityInPolicyError` (P27.3) if env-derived policy
 * contains a typo'd capability name. Caller may catch + emit fatal.
 */
export function buildAxiaMcpServer(opts: AxiaMcpServerOptions): {
  server: Server;
  handshake: ReturnType<typeof performHandshake>;
  policy: CapabilityPolicy;
} {
  const handshake = performHandshake(opts.engineModule);
  const policy = opts.policy ?? policyFromEnv();
  const auditSink = opts.auditSink ?? new NullAuditSink();
  const client = opts.client ?? 'unknown';

  const server = new Server(
    {
      name: 'axia-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  wireTools(server, {
    engine: opts.engineInstance,
    policy,
    auditSink,
    client,
    versions: {
      schema_version: handshake.engine_schema,
      engine_version: handshake.engine_version,
    },
  });

  return { server, handshake, policy };
}

// Re-export DEFAULT_POLICY for tests that need it.
export { DEFAULT_POLICY };

async function main(): Promise<void> {
  // Dynamic import so test runners can stub axia-wasm-node without forcing
  // a real WASM load.
  const mod = (await import('../../axia-wasm-node/dist/axia_wasm.js')) as unknown as EngineModule;
  const engineInstance = new mod.AxiaEngine();

  const { server, handshake } = buildAxiaMcpServer({
    engineModule: mod,
    engineInstance,
    auditSink: new FileAuditSink(),
    client: process.env.AXIA_MCP_CLIENT ?? 'unknown',
  });

  // stderr is the canonical place for diagnostic logs in MCP servers
  // (stdout is the JSON-RPC channel).
  process.stderr.write(
    `[axia-mcp-server] Handshake OK — engine schema=${handshake.engine_schema}, ` +
      `engine version=${handshake.engine_version}, server schema=${handshake.server_schema}\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run main() only when invoked directly (not when imported by tests).
const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  // crude but effective for ESM bin scripts
  process.argv[1].endsWith('index.js');

if (isDirectInvocation) {
  main().catch((err: unknown) => {
    if (err instanceof UnknownCapabilityInPolicyError) {
      // P27.3 — clearer wording for env config errors.
      process.stderr.write(
        `[axia-mcp-server] FATAL: ${err.message}\n` +
          `\n` +
          `  Check your AXIA_MCP_ALLOW_CAPS / AXIA_MCP_DENY_CAPS env vars.\n` +
          `  Source: ${err.source}, bad name: "${err.bad_name}"\n` +
          (err.suggestion ? `  Did you mean: "${err.suggestion}"?\n` : ''),
      );
      process.exit(2);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[axia-mcp-server] FATAL: ${msg}\n`);
    process.exit(1);
  });
}
