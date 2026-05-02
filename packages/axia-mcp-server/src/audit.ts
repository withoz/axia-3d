// ADR-041 P26.7 — Audit Trail (boosted, follow-up to Stage 4)
//
// Tier 2/3 successful + error calls are audited. Denied calls (any tier)
// are ALSO audited — those are intrusion-detection signals.
//
// Each entry includes a request_id (UUID v4), engine + schema versions
// (for drift correlation), and the denial reason when applicable.
//
// Format: ISO-8601 timestamp + structured JSON for grep/jq friendliness.
// File path: `~/.axia/mcp-audit-YYYY-MM-DD.log` (UTC) — daily rotation,
// keeps individual files bounded and grep-friendly.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tier } from './tiers.js';

export interface AuditEntry {
  timestamp: string; // ISO-8601 UTC
  request_id: string; // UUID v4 — correlates with MCP request when present
  client: string;
  /** Tier of capability. `null` when capability was unknown. */
  tier: Tier | null;
  capability: string;
  args: unknown;
  duration_ms: number;
  result: 'ok' | 'error' | 'denied';
  /** Engine WASM build version at audit time (P26.2 drift correlation). */
  engine_version: string;
  /** MCP capability schema version. */
  schema_version: string;
  /** Reason text for `denied` (and sometimes `error`). */
  reason?: string;
  /** Underlying error text when `result==='error'`. */
  error_message?: string;
}

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
}

/**
 * Daily-rotating file sink: writes to `~/.axia/mcp-audit-YYYY-MM-DD.log`.
 * Path is recomputed on every append — handles long-running servers that
 * cross midnight.
 *
 * Override location via `AXIA_MCP_AUDIT_DIR` env var (Stage 4 follow-up:
 * #3 audit sink path override).
 */
export class FileAuditSink implements AuditSink {
  /** Override base path; if undefined, uses `defaultDir()` per call. */
  private readonly baseDir: string | undefined;

  constructor(baseDirOrFile?: string) {
    this.baseDir = baseDirOrFile;
  }

  private currentPath(): string {
    const dir = this.baseDir ?? FileAuditSink.defaultDir();
    return join(dir, FileAuditSink.todayFileName());
  }

  async append(entry: AuditEntry): Promise<void> {
    const path = this.currentPath();
    await mkdir(dirname(path), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await appendFile(path, line, 'utf8');
  }

  static defaultDir(): string {
    return process.env.AXIA_MCP_AUDIT_DIR ?? join(homedir(), '.axia');
  }

  /** `mcp-audit-YYYY-MM-DD.log` (UTC). */
  static todayFileName(now: Date = new Date()): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `mcp-audit-${y}-${m}-${d}.log`;
  }

  /** For tests / docs. */
  static defaultPathToday(now: Date = new Date()): string {
    return join(FileAuditSink.defaultDir(), FileAuditSink.todayFileName(now));
  }
}

/** No-op sink for tests / Tier 0,1 success paths. */
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
 * Audit policy (P26.7 boosted):
 *   - Tier 2 / 3 successful or errored → audit
 *   - ANY tier denied / unknown → audit (intrusion signal)
 *   - Tier 0 / 1 successful → not audited (would flood)
 */
export function shouldAudit(opts: {
  tier: Tier | null;
  result: 'ok' | 'error' | 'denied';
}): boolean {
  if (opts.result === 'denied') return true;
  if (opts.tier === null) return true; // unknown capability → log
  return opts.tier >= 2;
}

export function newRequestId(): string {
  return randomUUID();
}

export interface AuditEntryDraft {
  request_id: string;
  client: string;
  tier: Tier | null;
  capability: string;
  args: unknown;
  duration_ms: number;
  result: 'ok' | 'error' | 'denied';
  engine_version: string;
  schema_version: string;
  reason?: string;
  error_message?: string;
}

export function makeAuditEntry(draft: AuditEntryDraft): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    ...draft,
  };
}
