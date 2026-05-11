// ADR-041 P26.2 — MCP Schema Versioning (3-layer defense)
//
// Layer 1: WASM exports schema_version() / engine_version()
// Layer 2: MCP server checks ^MAJOR.MINOR compatibility on handshake (this file)
// Layer 3: Per-call schema_version field (optional, future-proof, not yet enforced)

import semver from 'semver';

/**
 * The schema version this MCP server was built against.
 *
 * Semver semantics (must match crates/axia-wasm/src/lib.rs SCHEMA_VERSION):
 *   MAJOR — capability removed OR ID semantics changed (breaks AI agents)
 *   MINOR — capability added (backward compatible)
 *   PATCH — bugfix, no API surface change
 *
 * BUMP RULES:
 * - Engine adds new capability → bump MINOR in axia-wasm SCHEMA_VERSION,
 *   server can still talk to old engines if it does not require the new cap
 * - Engine changes existing capability behavior → bump MAJOR in BOTH
 * - Server adds requirement (uses new cap) → bump MCP_SERVER_SCHEMA_VERSION
 *   floor here to require that MINOR
 */
export const MCP_SERVER_SCHEMA_VERSION = '1.0.0';

export interface EngineHandle {
  schema_version(): string;
  engine_version(): string;
}

export interface HandshakeResult {
  engine_schema: string;
  engine_version: string;
  server_schema: string;
  compatible: true;
}

export class SchemaIncompatibleError extends Error {
  public readonly engine_schema: string;
  public readonly server_schema: string;
  public readonly action: string;

  constructor(opts: { engine: string; server: string; action: string }) {
    super(
      `MCP schema mismatch: engine=${opts.engine}, server requires ^${opts.server}. ` +
        opts.action,
    );
    this.name = 'SchemaIncompatibleError';
    this.engine_schema = opts.engine;
    this.server_schema = opts.server;
    this.action = opts.action;
  }
}

/**
 * Verify engine ↔ server schema compatibility (ADR-041 P26.2).
 *
 * Compatibility rule: engine schema must satisfy `^server_schema`.
 *
 * | Engine reports | Server requires (^server) | Result |
 * |---|---|---|
 * | 1.0.0          | ^1.0.0                    | OK              |
 * | 1.5.0          | ^1.0.0                    | OK (forward)    |
 * | 0.9.0          | ^1.0.0                    | REJECT (engine too old) |
 * | 2.0.0          | ^1.0.0                    | REJECT (major break)    |
 *
 * Throws `SchemaIncompatibleError` on mismatch BEFORE any tool call.
 */
export function performHandshake(engine: EngineHandle): HandshakeResult {
  const engine_schema = engine.schema_version();
  const engine_ver = engine.engine_version();

  if (!semver.valid(engine_schema)) {
    throw new SchemaIncompatibleError({
      engine: engine_schema,
      server: MCP_SERVER_SCHEMA_VERSION,
      action: `Engine returned invalid semver: "${engine_schema}". Rebuild axia-wasm.`,
    });
  }

  if (!semver.satisfies(engine_schema, `^${MCP_SERVER_SCHEMA_VERSION}`)) {
    const cmp = semver.compare(engine_schema, MCP_SERVER_SCHEMA_VERSION);
    const hint =
      cmp < 0
        ? 'Rebuild axia-wasm to a newer version, or use an older MCP server.'
        : 'Upgrade @axia/mcp-server, or downgrade axia-wasm.';
    throw new SchemaIncompatibleError({
      engine: engine_schema,
      server: MCP_SERVER_SCHEMA_VERSION,
      action: hint,
    });
  }

  return {
    engine_schema,
    engine_version: engine_ver,
    server_schema: MCP_SERVER_SCHEMA_VERSION,
    compatible: true,
  };
}
