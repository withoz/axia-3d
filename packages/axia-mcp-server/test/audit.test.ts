// ADR-041 P26.7/P26.8 — audit trail regression tests
import { describe, it, expect } from 'vitest';
import {
  MemoryAuditSink,
  NullAuditSink,
  shouldAudit,
  makeAuditEntry,
} from '../src/audit.js';

describe('ADR-041 P26.7 — audit trail policy', () => {
  it('Tier 0 (read) is NOT audited (would flood log)', () => {
    expect(shouldAudit(0)).toBe(false);
  });

  it('Tier 1 (constructive) is NOT audited', () => {
    expect(shouldAudit(1)).toBe(false);
  });

  it('mcp_audit_log_records_tier2_calls — Tier 2 IS audited', () => {
    expect(shouldAudit(2)).toBe(true);
  });

  it('Tier 3 (destructive) IS audited', () => {
    expect(shouldAudit(3)).toBe(true);
  });

  it('makeAuditEntry stamps ISO-8601 timestamp', () => {
    const entry = makeAuditEntry({
      client: 'test',
      tier: 2,
      capability: 'push_pull',
      args: { face_id: 42, distance: 50 },
      duration_ms: 23,
      result: 'ok',
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(entry.client).toBe('test');
    expect(entry.tier).toBe(2);
    expect(entry.capability).toBe('push_pull');
    expect(entry.duration_ms).toBe(23);
    expect(entry.result).toBe('ok');
  });

  it('MemoryAuditSink records entries in order', async () => {
    const sink = new MemoryAuditSink();
    await sink.append(
      makeAuditEntry({
        client: 'claude-desktop',
        tier: 2,
        capability: 'push_pull',
        args: { face_id: 1 },
        duration_ms: 10,
        result: 'ok',
      }),
    );
    await sink.append(
      makeAuditEntry({
        client: 'claude-desktop',
        tier: 3,
        capability: 'delete_xia',
        args: { xia_id: 7 },
        duration_ms: 5,
        result: 'error',
        error_message: 'XiaId 7 not found',
      }),
    );
    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0]!.capability).toBe('push_pull');
    expect(sink.entries[1]!.error_message).toBe('XiaId 7 not found');
  });

  it('NullAuditSink swallows entries silently (Tier 0/1 path)', async () => {
    const sink = new NullAuditSink();
    await expect(
      sink.append(
        makeAuditEntry({
          client: 't',
          tier: 0,
          capability: 'get_scene_summary',
          args: {},
          duration_ms: 1,
          result: 'ok',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
