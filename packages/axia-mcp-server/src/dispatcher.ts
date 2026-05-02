// Capability dispatcher — single ingress point for tool calls.
//
// Order:
//   1. Look up handler (throws UnknownCapabilityError if missing)
//   2. authorizeCapability (throws CapabilityBlockedError if tier disabled)
//   3. Validate input via Zod schema
//   4. Time the handler call
//   5. Append audit entry if Tier ≥ 2
//   6. Return parsed output (or rethrow on error)

import type { z } from 'zod';
import {
  authorizeCapability,
  UnknownCapabilityError,
  type TierConfig,
  DEFAULT_TIER_CONFIG,
} from './tiers.js';
import {
  type AuditSink,
  NullAuditSink,
  shouldAudit,
  makeAuditEntry,
} from './audit.js';
import {
  getCapabilityHandler,
  type CapabilityHandler,
  type EngineInstance,
} from './capabilities/index.js';

export interface DispatcherOptions {
  engine: EngineInstance;
  config?: TierConfig;
  auditSink?: AuditSink;
  client?: string;
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
}

export async function dispatch(
  capability: string,
  rawInput: unknown,
  opts: DispatcherOptions,
): Promise<DispatchResult> {
  const config = opts.config ?? DEFAULT_TIER_CONFIG;
  const auditSink = opts.auditSink ?? new NullAuditSink();
  const client = opts.client ?? 'unknown';

  const handler: CapabilityHandler<unknown, unknown> | undefined =
    getCapabilityHandler(capability);
  if (!handler) {
    // Unknown — but defer to authorize() for the canonical error,
    // since `tiers.ts` is the surface SSOT.
    authorizeCapability(capability, config); // will throw UnknownCapabilityError
    throw new UnknownCapabilityError(capability); // unreachable safety net
  }

  authorizeCapability(capability, config);

  const parsed = handler.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CapabilityInputError(capability, parsed.error.issues);
  }

  const start = performance.now();
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
    if (shouldAudit(handler.tier)) {
      // Best-effort audit — never fail dispatch on log error.
      void auditSink
        .append(
          makeAuditEntry({
            client,
            tier: handler.tier,
            capability,
            args: parsed.data,
            duration_ms,
            result,
            error_message,
          }),
        )
        .catch(() => {
          /* swallow */
        });
    }
  }

  const duration_ms = performance.now() - start;
  return { capability, output, duration_ms };
}
