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
import { tierConfigFromEnv, ALL_CAPABILITIES, type TierConfig } from './tiers.js';
import { FileAuditSink, type AuditSink } from './audit.js';

export interface AxiaMcpServerOptions {
  engine: EngineHandle;
  tierConfig?: TierConfig;
  auditSink?: AuditSink;
  client?: string;
}

/**
 * Build an MCP server instance — pure function, no I/O.
 * Easy to test by passing a mock engine.
 */
export function buildAxiaMcpServer(opts: AxiaMcpServerOptions): {
  server: Server;
  handshake: ReturnType<typeof performHandshake>;
  config: TierConfig;
} {
  const handshake = performHandshake(opts.engine);
  const config = opts.tierConfig ?? tierConfigFromEnv();

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

  // Capability registration is added in Stage 3. For Stage 2, the server
  // boots, completes handshake, exposes ALL_CAPABILITIES list as a sanity
  // check, but does not yet wire individual handlers.
  void ALL_CAPABILITIES;
  void opts.auditSink;
  void opts.client;

  return { server, handshake, config };
}

async function main(): Promise<void> {
  // Dynamic import so test runners can stub axia-wasm-node without forcing
  // a real WASM load.
  const wasm = (await import('../../axia-wasm-node/dist/axia_wasm.js')) as unknown as EngineHandle & {
    AxiaEngine: new () => unknown;
  };

  const { server, handshake } = buildAxiaMcpServer({
    engine: wasm,
    auditSink: new FileAuditSink(FileAuditSink.defaultPath()),
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
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[axia-mcp-server] FATAL: ${msg}\n`);
    process.exit(1);
  });
}
