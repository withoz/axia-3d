/**
 * AuditLog — ADR-069 Phase 1 Path Y A pilot.
 *
 * Web-side action audit (localStorage) per ADR-041 P26.7 subset.
 * Captures:
 *   - Capability Explorer (ADR-063) onActionInvoke
 *   - ToolManager.executeAction (UI-driven dispatch)
 *
 * Per ADR-069 §D #2 lock-in (P26.7 정책 일관):
 *   - Tier 0/1 success → SKIP (flooding 방지)
 *   - Tier 2/3 success/error → RECORD
 *   - Any-tier denied/error → RECORD
 *
 * Per §D #1 lock-in: Web-side ONLY. MCP server-side audit
 * (`~/.axia/mcp-audit-*.log`) is a separate channel — future ADR for
 * cross-source aggregation.
 *
 * @see docs/adr/069-adr-046-phase-1-path-y-audit-log-viewer-pilot.md
 */

/** ADR-069 §B — Audit entry schema (P26.7 subset). */
export interface AuditEntry {
  /** Entry creation time (Date.now() unix ms). */
  timestamp: number;
  /** UUID v4 generated per invocation. */
  requestId: string;
  /** ActionDef.id (kebab-case). */
  actionId: string;
  /** Action tier (0/1/2/3). */
  tier: 0 | 1 | 2 | 3;
  /** Outcome — P26.7 vocabulary. */
  result: 'ok' | 'error' | 'denied';
  /** Human-readable error (when result='error'). */
  error?: string;
  /** Action args (privacy-masked by default per §D #3). */
  args?: Record<string, unknown>;
  /** Schema version — bump when shape changes. */
  schemaVersion: 1;
}

/** ADR-069 §D #4 — FIFO eviction threshold. */
export const AUDIT_LOG_CAP = 1000;

/** ADR-069 §D #1 — localStorage key (영구 고정). */
export const AUDIT_LOG_LS_KEY = 'axia.auditLog';

/** ADR-069 §D #3 — Mask sensitive arg values for Tier 1+. */
function maskArgs(args: Record<string, unknown> | undefined, tier: number): Record<string, unknown> | undefined {
  if (!args || tier === 0) return args;  // Tier 0 read는 mask 미적용 (anyway 미기록)
  // For Tier 1+, keep arg KEYS but mask VALUES.
  // Numbers/IDs are preserved (debugging value); strings/objects mask.
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'number') {
      masked[k] = v;  // ID-like values preserved
    } else if (typeof v === 'boolean') {
      masked[k] = v;
    } else if (v === null || v === undefined) {
      masked[k] = v;
    } else {
      masked[k] = '[masked]';
    }
  }
  return masked;
}

/** ADR-069 P26.7 §D #2 — Capture policy.
 *  Returns true if this combination should be recorded. */
function shouldCapture(tier: 0 | 1 | 2 | 3, result: 'ok' | 'error' | 'denied'): boolean {
  // Always record denied (intrusion signal per P26.7).
  if (result === 'denied') return true;
  // Record errors at any tier.
  if (result === 'error') return true;
  // Tier 0/1 success → skip (flooding).
  if (tier <= 1) return false;
  // Tier 2/3 success → record.
  return true;
}

/** UUID v4 (lightweight, no crypto.randomUUID dependency assumed). */
function uuidv4(): string {
  // Try native crypto.randomUUID (modern browsers).
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* fallthrough */ }
  // Fallback — Math.random based (less entropy but acceptable for audit).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * AuditLog singleton (web-side action audit).
 *
 * Persists to localStorage as JSON array. FIFO eviction at AUDIT_LOG_CAP.
 * Volatile — not part of Scene snapshot (§D #5 lock-in).
 */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  /** ADR-069 Step 1 — Record an invocation per P26.7 capture policy.
   *  Returns the recorded entry, or null if filtered (Tier 0/1 success). */
  record(input: {
    actionId: string;
    tier: 0 | 1 | 2 | 3;
    result: 'ok' | 'error' | 'denied';
    error?: string;
    args?: Record<string, unknown>;
  }): AuditEntry | null {
    if (!shouldCapture(input.tier, input.result)) return null;
    const entry: AuditEntry = {
      timestamp: Date.now(),
      requestId: uuidv4(),
      actionId: input.actionId,
      tier: input.tier,
      result: input.result,
      error: input.error,
      args: maskArgs(input.args, input.tier),
      schemaVersion: 1,
    };
    this.entries.push(entry);
    // FIFO eviction (§D #4).
    while (this.entries.length > AUDIT_LOG_CAP) {
      this.entries.shift();
    }
    this.persistToStorage();
    this.notifyChange();
    return entry;
  }

  /** All entries (most recent last). */
  getAll(): readonly AuditEntry[] {
    return this.entries;
  }

  /** Entry count. */
  getCount(): number {
    return this.entries.length;
  }

  /** Clear all entries (Step 5 toggle / user action). */
  clear(): void {
    this.entries = [];
    this.persistToStorage();
    this.notifyChange();
  }

  /** Subscribe to change events. Returns unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notifyChange(): void {
    for (const l of this.listeners) l();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(AUDIT_LOG_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as AuditEntry[];
      if (Array.isArray(parsed)) {
        // Filter out malformed entries (forward-compat).
        this.entries = parsed.filter((e) => e && typeof e.actionId === 'string');
      }
    } catch {
      // localStorage 접근 실패 (private mode 등) — empty.
      this.entries = [];
    }
  }

  private persistToStorage(): void {
    try {
      localStorage.setItem(AUDIT_LOG_LS_KEY, JSON.stringify(this.entries));
    } catch {
      // localStorage 쓰기 실패 (quota 초과 등) — silent. 다음 record 시 retry.
    }
  }
}

// ── Singleton accessor ────────────────────────────────────────────
let _instance: AuditLog | null = null;

/** Lazy singleton — first access creates the AuditLog instance. */
export function getAuditLog(): AuditLog {
  if (!_instance) _instance = new AuditLog();
  return _instance;
}

/** Test-only — reset singleton. Production code MUST NOT call. */
export function _resetAuditLogForTest(): void {
  _instance = null;
}
