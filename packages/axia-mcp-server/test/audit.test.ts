// ADR-041 P26.7/P26.8 — audit trail regression tests (boosted)
import { describe, it, expect } from 'vitest';
import {
  MemoryAuditSink,
  NullAuditSink,
  FileAuditSink,
  shouldAudit,
  makeAuditEntry,
  newRequestId,
} from '../src/audit.js';

const VERSIONS = { engine_version: '0.1.0', schema_version: '1.0.0' };

describe('ADR-041 P26.7 — audit trail policy (boosted)', () => {
  it('Tier 0 success is NOT audited (would flood log)', () => {
    expect(shouldAudit({ tier: 0, result: 'ok' })).toBe(false);
  });

  it('Tier 1 success is NOT audited', () => {
    expect(shouldAudit({ tier: 1, result: 'ok' })).toBe(false);
  });

  it('mcp_audit_log_records_tier2_calls — Tier 2 ok IS audited', () => {
    expect(shouldAudit({ tier: 2, result: 'ok' })).toBe(true);
  });

  it('Tier 3 success IS audited', () => {
    expect(shouldAudit({ tier: 3, result: 'ok' })).toBe(true);
  });

  it('Tier 2/3 errors ARE audited', () => {
    expect(shouldAudit({ tier: 2, result: 'error' })).toBe(true);
    expect(shouldAudit({ tier: 3, result: 'error' })).toBe(true);
  });

  it('ANY tier denied IS audited (intrusion signal)', () => {
    expect(shouldAudit({ tier: 0, result: 'denied' })).toBe(true);
    expect(shouldAudit({ tier: 1, result: 'denied' })).toBe(true);
    expect(shouldAudit({ tier: 2, result: 'denied' })).toBe(true);
    expect(shouldAudit({ tier: 3, result: 'denied' })).toBe(true);
  });

  it('Unknown capability (tier=null) IS audited', () => {
    expect(shouldAudit({ tier: null, result: 'denied' })).toBe(true);
  });

  it('makeAuditEntry stamps ISO-8601 timestamp + required fields', () => {
    const entry = makeAuditEntry({
      request_id: 'req-1',
      client: 'test',
      tier: 2,
      capability: 'push_pull',
      args: { face_id: 42, distance: 50 },
      duration_ms: 23,
      result: 'ok',
      ...VERSIONS,
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(entry.request_id).toBe('req-1');
    expect(entry.engine_version).toBe('0.1.0');
    expect(entry.schema_version).toBe('1.0.0');
  });

  it('newRequestId returns RFC-4122 v4 UUID', () => {
    const id = newRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Different each call
    expect(newRequestId()).not.toBe(id);
  });

  it('MemoryAuditSink records entries in order with version stamps', async () => {
    const sink = new MemoryAuditSink();
    await sink.append(
      makeAuditEntry({
        request_id: 'r1',
        client: 'claude-desktop',
        tier: 2,
        capability: 'push_pull',
        args: { face_id: 1 },
        duration_ms: 10,
        result: 'ok',
        ...VERSIONS,
      }),
    );
    await sink.append(
      makeAuditEntry({
        request_id: 'r2',
        client: 'claude-desktop',
        tier: 3,
        capability: 'delete_xia',
        args: { xia_id: 7 },
        duration_ms: 5,
        result: 'error',
        error_message: 'XiaId 7 not found',
        ...VERSIONS,
      }),
    );
    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0]!.request_id).toBe('r1');
    expect(sink.entries[0]!.engine_version).toBe('0.1.0');
    expect(sink.entries[1]!.error_message).toBe('XiaId 7 not found');
  });

  it('NullAuditSink swallows entries silently', async () => {
    const sink = new NullAuditSink();
    await expect(
      sink.append(
        makeAuditEntry({
          request_id: 'r',
          client: 't',
          tier: 0,
          capability: 'get_scene_summary',
          args: {},
          duration_ms: 1,
          result: 'ok',
          ...VERSIONS,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('FileAuditSink — daily rotation (P26.7 follow-up)', () => {
  it('todayFileName uses UTC YYYY-MM-DD', () => {
    const fixed = new Date(Date.UTC(2026, 4, 2, 23, 59, 59)); // May 2 UTC
    expect(FileAuditSink.todayFileName(fixed)).toBe('mcp-audit-2026-05-02.log');
  });

  it('todayFileName rolls at UTC midnight', () => {
    const before = new Date(Date.UTC(2026, 4, 2, 23, 59, 59));
    const after = new Date(Date.UTC(2026, 4, 3, 0, 0, 1));
    expect(FileAuditSink.todayFileName(before)).not.toBe(
      FileAuditSink.todayFileName(after),
    );
    expect(FileAuditSink.todayFileName(after)).toBe('mcp-audit-2026-05-03.log');
  });

  it('default path honours AXIA_MCP_AUDIT_DIR env', () => {
    const orig = process.env.AXIA_MCP_AUDIT_DIR;
    try {
      process.env.AXIA_MCP_AUDIT_DIR = '/tmp/axia-test-audit';
      expect(FileAuditSink.defaultDir()).toBe('/tmp/axia-test-audit');
    } finally {
      if (orig === undefined) delete process.env.AXIA_MCP_AUDIT_DIR;
      else process.env.AXIA_MCP_AUDIT_DIR = orig;
    }
  });

  it('defaultPathToday joins dir + today file', () => {
    const fixed = new Date(Date.UTC(2026, 4, 2));
    const p = FileAuditSink.defaultPathToday(fixed);
    expect(p).toMatch(/mcp-audit-2026-05-02\.log$/);
  });
});
