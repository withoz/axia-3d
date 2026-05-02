// Capability dispatcher — single ingress point for tool calls.
//
// Order:
//   1. Look up handler (records denied audit + throws UnknownCapabilityError)
//   2. authorizeCapability (records denied audit + throws CapabilityBlockedError)
//   3. Validate input via Zod schema (records denied audit + throws CapabilityInputError)
//   4. Time the handler call
//   5. Append audit entry per shouldAudit() policy
//   6. Return parsed output (or rethrow on error)

import type { z } from 'zod';
import {
  authorizeCapability,
  UnknownCapabilityError,
  CapabilityBlockedError,
  type TierConfig,
  DEFAULT_TIER_CONFIG,
  tierOf,
} from './tiers.js';
import {
  type AuditSink,
  NullAuditSink,
  shouldAudit,
  makeAuditEntry,
  newRequestId,
} from './audit.js';
import {
  getCapabilityHandler,
  type CapabilityHandler,
  type EngineInstance,
} from './capabilities/index.js';

export interface VersionInfo {
  schema_version: string;
  engine_version: string;
}

export interface DispatcherOptions {
  engine: EngineInstance;
  config?: TierConfig;
  auditSink?: AuditSink;
  client?: string;
  /** From handshake. Stamped onto every audit entry for drift correlation. */
  versions: VersionInfo;
  /** Override request id for client correlation; auto-generated otherwise. */
  request_id?: string;
}

export class CapabilityInputError extends Error {
  public readonly capability: string;
  public readonly issues: z.ZodIssue[];

  constructor(capability: string, issues: z.ZodIssue[]) {
    const detail = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    super(`Invalid input for "${capability}": ${detail}`);
    this.name = 'CapabilityInputError';
    this.capability = capability;
    this.issues = issues;
  }
}

export interface DispatchResult {
  capability: string;
  output: unknown;
  duration_ms: number;
  request_id: string;
}

/**
 * Fire-and-forget audit append — never fails dispatch on log error.
 */
function recordAudit(sink: AuditSink, draft: Parameters<typeof makeAuditEntry>[0]): void {
  if (!shouldAudit({ tier: draft.tier, result: draft.result })) return;
  void sink.append(makeAuditEntry(draft)).catch(() => {
    /* swallow log errors */
  });
}

export async function dispatch(
  capability: string,
  rawInput: unknown,
  opts: DispatcherOptions,
): Promise<DispatchResult> {
  const config = opts.config ?? DEFAULT_TIER_CONFIG;
  const auditSink = opts.auditSink ?? new NullAuditSink();
  const client = opts.client ?? 'unknown';
  const request_id = opts.request_id ?? newRequestId();
  const versions = opts.versions;
  const start = performance.now();

  // 1. Look up handler — unknown is a denial.
  const handler: CapabilityHandler<unknown, unknown> | undefined =
    getCapabilityHandler(capability);
  if (!handler) {
    const reason = `Unknown capability "${capability}" — not in ADR-041 P26.1 surface`;
    recordAudit(auditSink, {
      request_id,
      client,
      tier: null,
      capability,
      args: rawInput,
      duration_ms: performance.now() - start,
      result: 'denied',
      reason,
      engine_version: versions.engine_version,
      schema_version: versions.schema_version,
    });
    throw new UnknownCapabilityError(capability);
  }

  // 2. Tier authorization.
  try {
    authorizeCapability(capability, config);
  } catch (e) {
    if (e instanceof CapabilityBlockedError) {
      recordAudit(auditSink, {
        request_id,
        client,
        tier: e.tier,
        capability,
        args: rawInput,
        duration_ms: performance.now() - start,
        result: 'denied',
        reason: `Tier ${e.tier} not enabled (config: [${e.enabled_tiers.join(', ')}])`,
        engine_version: versions.engine_version,
        schema_version: versions.schema_version,
      });
    }
    throw e;
  }

  // 3. Input validation.
  const parsed = handler.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issueDetail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    recordAudit(auditSink, {
      request_id,
      client,
      tier: handler.tier,
      capability,
      args: rawInput,
      duration_ms: performance.now() - start,
      result: 'denied',
      reason: `Input validation failed: ${issueDetail}`,
      engine_version: versions.engine_version,
      schema_version: versions.schema_version,
    });
    throw new CapabilityInputError(capability, parsed.error.issues);
  }

  // 4-5. Run + record outcome.
  let output: unknown;
  let result: 'ok' | 'error' = 'ok';
  let error_message: string | undefined;
  try {
    output = await handler.handler(
      { engine: opts.engine, client },
      parsed.data,
    );
  } catch (e) {
    result = 'error';
    error_message = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const duration_ms = performance.now() - start;
    recordAudit(auditSink, {
      request_id,
      client,
      tier: handler.tier,
      capability,
      args: parsed.success ? parsed.data : rawInput,
      duration_ms,
      result,
      error_message,
      engine_version: versions.engine_version,
      schema_version: versions.schema_version,
    });
  }

  const duration_ms = performance.now() - start;
  return { capability, output, duration_ms, request_id };
}

// Re-export for convenience.
export { tierOf };
