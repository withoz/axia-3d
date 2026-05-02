// ADR-041 P26.7 — Audit Trail
//
// All Tier 2/3 calls append a single JSONL line to ~/.axia/mcp-audit.log.
// Tier 0/1 calls are NOT logged (read-only and constructive-only — no
// audit value, would flood log on busy AI sessions).
//
// Format: ISO-8601 timestamp + structured JSON for grep/jq friendliness.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tier } from './tiers.js';

export interface AuditEntry {
  timestamp: string; // ISO-8601 UTC
  client: string; // e.g. "claude-desktop", "cursor", "test"
  tier: Tier;
  capability: string;
  args: unknown;
  duration_ms: number;
  result: 'ok' | 'error';
  error_message?: string;
}

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
}

export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string) {}

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.path, line, 'utf8');
  }

  static defaultPath(): string {
    return join(homedir(), '.axia', 'mcp-audit.log');
  }
}

/** No-op sink for tests / Tier 0,1 calls. */
export class NullAuditSink implements AuditSink {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async append(_entry: AuditEntry): Promise<void> {
    /* no-op */
  }
}

/** In-memory sink — used in tests to assert log contents. */
export class MemoryAuditSink implements AuditSink {
  public readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * Should this tier be audited? P26.7 — only Tier 2/3.
 */
export function shouldAudit(tier: Tier): boolean {
  return tier >= 2;
}

export function makeAuditEntry(opts: {
  client: string;
  tier: Tier;
  capability: string;
  args: unknown;
  duration_ms: number;
  result: 'ok' | 'error';
  error_message?: string;
}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    ...opts,
  };
}
