// ADR-042 P27 — Capability Policy (additive ALLOW, subtractive DENY).
//
// Composition rule:
//   enabled(cap) = (cap ∉ DENY) AND (tier_of(cap) ∈ TIERS OR cap ∈ ALLOW)
//
// - ALLOW is ADDITIVE: enables capabilities whose tier is not in TIERS
// - DENY is SUBTRACTIVE: removes capabilities even if their tier is in TIERS
// - DENY always wins (fail-closed)
//
// To get an exhaustive whitelist, set TIERS=∅ (empty) and put the desired
// capability set in ALLOW.
//
// Unknown capability names in ALLOW/DENY → fatal at startup (P27.3).

import {
  ALL_CAPABILITIES,
  DEFAULT_TIER_CONFIG,
  type Tier,
  type TierConfig,
  isKnownCapability,
  tierOf,
  tierConfigFromEnv,
} from './tiers.js';

export interface CapabilityPolicy {
  enabled_tiers: Tier[];
  /** Empty set = "no implicit deny" (tier-based gate only). */
  allow_caps: ReadonlySet<string>;
  deny_caps: ReadonlySet<string>;
}

export const DEFAULT_POLICY: CapabilityPolicy = {
  enabled_tiers: DEFAULT_TIER_CONFIG.enabled_tiers,
  allow_caps: new Set(),
  deny_caps: new Set(),
};

/**
 * Distinct denial reasons — kept separable for audit.log analysis (P27.5).
 *
 * - `unknown`: capability not in ADR-041 P26.1 surface
 * - `denied_by_DENY`: cap appears in DENY list (fail-closed)
 * - `tier_disabled_no_allow`: cap's tier is off AND cap is not in ALLOW.
 *   (Under additive semantics, "not in ALLOW" only matters when tier
 *   is also disabled — there is no implicit-deny when tier is active.)
 */
export type DenialReason =
  | { kind: 'unknown' }
  | { kind: 'denied_by_DENY' }
  | {
      kind: 'tier_disabled_no_allow';
      tier: Tier;
      enabled_tiers: Tier[];
      allow_caps: string[];
    };

export interface PolicyDecision {
  allowed: boolean;
  reason?: DenialReason;
}

export function evaluatePolicy(
  capability: string,
  policy: CapabilityPolicy = DEFAULT_POLICY,
): PolicyDecision {
  if (!isKnownCapability(capability)) {
    return { allowed: false, reason: { kind: 'unknown' } };
  }

  // DENY wins (fail-closed).
  if (policy.deny_caps.has(capability)) {
    return { allowed: false, reason: { kind: 'denied_by_DENY' } };
  }

  const t = tierOf(capability)!; // safe: isKnownCapability above
  const tierActive = policy.enabled_tiers.includes(t);
  const inAllow = policy.allow_caps.has(capability);

  // Additive composition: tier OR ALLOW grants access.
  if (tierActive || inAllow) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: {
      kind: 'tier_disabled_no_allow',
      tier: t,
      enabled_tiers: [...policy.enabled_tiers],
      allow_caps: [...policy.allow_caps].sort(),
    },
  };
}

/** Human-readable denial reason for audit log + error messages. */
export function formatDenialReason(reason: DenialReason): string {
  switch (reason.kind) {
    case 'unknown':
      return 'Unknown capability — not in ADR-041 P26.1 surface';
    case 'denied_by_DENY':
      return 'Capability denied by DENY policy';
    case 'tier_disabled_no_allow': {
      const allowText = reason.allow_caps.length > 0
        ? ` and not in ALLOW (currently [${reason.allow_caps.join(', ')}])`
        : ' and ALLOW is empty';
      return (
        `Tier ${reason.tier} not enabled (tiers: [${reason.enabled_tiers.join(', ')}])` +
        allowText
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Env / config loading + validation (P27.2 / P27.3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse a comma-separated capability list from an env var.
 * Empty / undefined → empty set.
 */
function parseCapList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export class UnknownCapabilityInPolicyError extends Error {
  public readonly source: 'AXIA_MCP_ALLOW_CAPS' | 'AXIA_MCP_DENY_CAPS';
  public readonly bad_name: string;
  public readonly suggestion: string | null;

  constructor(opts: {
    source: 'AXIA_MCP_ALLOW_CAPS' | 'AXIA_MCP_DENY_CAPS';
    bad_name: string;
    suggestion: string | null;
  }) {
    const hint = opts.suggestion
      ? ` Did you mean "${opts.suggestion}"?`
      : '';
    super(
      `Unknown capability "${opts.bad_name}" in ${opts.source}.${hint} ` +
        `Valid capabilities (${ALL_CAPABILITIES.length}): ${ALL_CAPABILITIES.slice(0, 8).join(', ')}, ...`,
    );
    this.name = 'UnknownCapabilityInPolicyError';
    this.source = opts.source;
    this.bad_name = opts.bad_name;
    this.suggestion = opts.suggestion;
  }
}

/**
 * P27.3 "Did you mean" — Levenshtein distance ≤ 2 best match.
 * Returns null if nothing close.
 */
export function suggestCapability(bad: string): string | null {
  let bestName: string | null = null;
  let bestDist = 3; // require ≤ 2
  for (const cand of ALL_CAPABILITIES) {
    const d = levenshtein(bad, cand);
    if (d < bestDist) {
      bestDist = d;
      bestName = cand;
    }
  }
  return bestName;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j - 1]!, dp[j]!);
      prev = cur;
    }
  }
  return dp[n]!;
}

/**
 * Validate a CapabilityPolicy — throw UnknownCapabilityInPolicyError if any
 * ALLOW/DENY name is not a known capability (P27.3).
 */
export function validatePolicy(policy: CapabilityPolicy): void {
  for (const name of policy.allow_caps) {
    if (!isKnownCapability(name)) {
      throw new UnknownCapabilityInPolicyError({
        source: 'AXIA_MCP_ALLOW_CAPS',
        bad_name: name,
        suggestion: suggestCapability(name),
      });
    }
  }
  for (const name of policy.deny_caps) {
    if (!isKnownCapability(name)) {
      throw new UnknownCapabilityInPolicyError({
        source: 'AXIA_MCP_DENY_CAPS',
        bad_name: name,
        suggestion: suggestCapability(name),
      });
    }
  }
}

/**
 * Build a CapabilityPolicy from env vars (P27.2). Validates immediately.
 * Caller may catch UnknownCapabilityInPolicyError to emit a fatal error
 * with the caller's preferred wording.
 */
export function policyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CapabilityPolicy {
  const tier = tierConfigFromEnv(env);
  const policy: CapabilityPolicy = {
    enabled_tiers: tier.enabled_tiers,
    allow_caps: parseCapList(env.AXIA_MCP_ALLOW_CAPS),
    deny_caps: parseCapList(env.AXIA_MCP_DENY_CAPS),
  };
  validatePolicy(policy);
  return policy;
}

/**
 * P27.4 — visibility filter for `tools/list`. A capability appears
 * iff `evaluatePolicy(...)` would allow it (regardless of tier alone).
 */
export function isVisibleInToolsList(
  capability: string,
  policy: CapabilityPolicy,
): boolean {
  return evaluatePolicy(capability, policy).allowed;
}

/**
 * Convenience: derive a TierConfig-shaped struct from a policy when only
 * tier knowledge is needed. (Used by code paths that haven't migrated to
 * full policy yet — kept for backward compat during ADR-042 rollout.)
 */
export function tierConfigOf(policy: CapabilityPolicy): TierConfig {
  return { enabled_tiers: policy.enabled_tiers };
}
