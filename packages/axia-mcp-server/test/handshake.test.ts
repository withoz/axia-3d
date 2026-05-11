// ADR-041 P26.8 — handshake regression tests
import { describe, it, expect } from 'vitest';
import {
  performHandshake,
  SchemaIncompatibleError,
  MCP_SERVER_SCHEMA_VERSION,
  type EngineHandle,
} from '../src/handshake.js';

function mockEngine(schema: string, engine = '0.1.0'): EngineHandle {
  return {
    schema_version: () => schema,
    engine_version: () => engine,
  };
}

describe('ADR-041 P26.2 — schema versioning handshake', () => {
  it('accepts exact match (1.0.0 ↔ ^1.0.0)', () => {
    const result = performHandshake(mockEngine(MCP_SERVER_SCHEMA_VERSION));
    expect(result.compatible).toBe(true);
    expect(result.engine_schema).toBe(MCP_SERVER_SCHEMA_VERSION);
  });

  it('accepts forward-compatible engine (1.5.0 satisfies ^1.0.0)', () => {
    const result = performHandshake(mockEngine('1.5.0'));
    expect(result.compatible).toBe(true);
  });

  it('mcp_handshake_rejects_schema_mismatch — major break (engine=2.0.0)', () => {
    expect(() => performHandshake(mockEngine('2.0.0'))).toThrow(SchemaIncompatibleError);
  });

  it('rejects engine too old (0.9.0 against ^1.0.0)', () => {
    expect(() => performHandshake(mockEngine('0.9.0'))).toThrow(SchemaIncompatibleError);
  });

  it('rejects invalid semver from engine', () => {
    expect(() => performHandshake(mockEngine('not-a-version'))).toThrow(
      SchemaIncompatibleError,
    );
  });

  it('error carries engine + server fields for debugging', () => {
    try {
      performHandshake(mockEngine('2.0.0'));
      throw new Error('unreachable');
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaIncompatibleError);
      const err = e as SchemaIncompatibleError;
      expect(err.engine_schema).toBe('2.0.0');
      expect(err.server_schema).toBe(MCP_SERVER_SCHEMA_VERSION);
      expect(err.action).toMatch(/MCP server|axia-wasm/);
    }
  });

  it('exposes engine_version separately from schema (audit correlation)', () => {
    const result = performHandshake(mockEngine('1.0.0', '0.42.0+abc1234'));
    expect(result.engine_version).toBe('0.42.0+abc1234');
    expect(result.engine_schema).toBe('1.0.0');
  });
});
