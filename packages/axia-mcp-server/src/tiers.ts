// ADR-041 P26.1 — Capability Surface Tiers
//
// New capability addition = new ADR. This file is the SSOT for which
// capability lives in which tier — diff this file in any PR that touches
// MCP surface.

export type Tier = 0 | 1 | 2 | 3;

/**
 * Tier 0 — Read-only inspection. Always-on, never blocked.
 * Cannot mutate state, cannot leak destructive intent.
 */
export const TIER_0_READ = [
  'get_scene_summary',
  'list_xias',
  'list_groups',
  'get_face_info',
  'get_edge_info',
  'get_xia_geometry_state',
  'get_schema_version', // alias — exposes ADR-041 P26.2 to AI
] as const;

/**
 * Tier 1 — Constructive. Default-on. Adds geometry but never destroys.
 */
export const TIER_1_CONSTRUCTIVE = [
  'draw_rect',
  'draw_circle',
  'draw_line',
  'draw_polyline',
  'create_xia',
  'create_group',
  'export_axia',
  'export_obj',
  'export_stl',
  'export_step',
] as const;

/**
 * Tier 2 — Modificative. Opt-in via config.
 * Mutates existing geometry but does not delete entities.
 */
export const TIER_2_MODIFY = [
  'push_pull',
  'move_xia',
  'rotate_xia',
  'scale_xia',
  'offset_face',
  'boolean_union',
  'boolean_subtract',
  'boolean_intersect',
  'fillet_edge',
  'chamfer_edge',
] as const;

/**
 * Tier 3 — Destructive. Opt-in + per-call user consent + audit log.
 */
export const TIER_3_DESTROY = [
  'erase_face',
  'erase_edge',
  'delete_xia',
  'delete_group',
  'import_step',
] as const;

export type Tier0Capability = (typeof TIER_0_READ)[number];
export type Tier1Capability = (typeof TIER_1_CONSTRUCTIVE)[number];
export type Tier2Capability = (typeof TIER_2_MODIFY)[number];
export type Tier3Capability = (typeof TIER_3_DESTROY)[number];
export type Capability =
  | Tier0Capability
  | Tier1Capability
  | Tier2Capability
  | Tier3Capability;

const CAP_TO_TIER = new Map<string, Tier>();
for (const c of TIER_0_READ) CAP_TO_TIER.set(c, 0);
for (const c of TIER_1_CONSTRUCTIVE) CAP_TO_TIER.set(c, 1);
for (const c of TIER_2_MODIFY) CAP_TO_TIER.set(c, 2);
for (const c of TIER_3_DESTROY) CAP_TO_TIER.set(c, 3);

export function tierOf(capability: string): Tier | undefined {
  return CAP_TO_TIER.get(capability);
}

export function isKnownCapability(name: string): name is Capability {
  return CAP_TO_TIER.has(name);
}

/**
 * All capabilities in declared order — used for surface-drift regression
 * test (ADR-041 P26.8: mcp_capability_surface_matches_adr_041_p26_1).
 */
export const ALL_CAPABILITIES: readonly string[] = [
  ...TIER_0_READ,
  ...TIER_1_CONSTRUCTIVE,
  ...TIER_2_MODIFY,
  ...TIER_3_DESTROY,
];

export interface TierConfig {
  /** Tiers permitted to execute. Default: [0, 1]. */
  enabled_tiers: Tier[];
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  enabled_tiers: [0, 1],
};

export class CapabilityBlockedError extends Error {
  public readonly capability: string;
  public readonly tier: Tier;
  public readonly enabled_tiers: Tier[];

  constructor(opts: { capability: string; tier: Tier; enabled_tiers: Tier[] }) {
    super(
      `Capability "${opts.capability}" (Tier ${opts.tier}) is not enabled. ` +
        `Currently enabled: [${opts.enabled_tiers.join(', ')}]. ` +
        `Edit axia.config.json or set AXIA_MCP_TIERS env var to allow.`,
    );
    this.name = 'CapabilityBlockedError';
    this.capability = opts.capability;
    this.tier = opts.tier;
    this.enabled_tiers = opts.enabled_tiers;
  }
}

export class UnknownCapabilityError extends Error {
  public readonly capability: string;

  constructor(capability: string) {
    super(
      `Unknown capability "${capability}". This MCP server exposes only ` +
        `whitelisted capabilities (ADR-041 P26.1). Check tiers.ts for the ` +
        `current surface.`,
    );
    this.name = 'UnknownCapabilityError';
    this.capability = capability;
  }
}

/**
 * Authorize a capability call against the active tier config.
 * Throws on unknown / blocked capability — call BEFORE any handler dispatch.
 */
export function authorizeCapability(
  capability: string,
  config: TierConfig = DEFAULT_TIER_CONFIG,
): void {
  if (!isKnownCapability(capability)) {
    throw new UnknownCapabilityError(capability);
  }
  const tier = tierOf(capability)!;
  if (!config.enabled_tiers.includes(tier)) {
    throw new CapabilityBlockedError({
      capability,
      tier,
      enabled_tiers: config.enabled_tiers,
    });
  }
}

/**
 * Parse `AXIA_MCP_TIERS=0,1,2` env var into TierConfig.
 * Falls back to DEFAULT_TIER_CONFIG on missing / malformed input.
 */
export function tierConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TierConfig {
  const raw = env.AXIA_MCP_TIERS;
  if (!raw) return DEFAULT_TIER_CONFIG;
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 3) as Tier[];
  if (parsed.length === 0) return DEFAULT_TIER_CONFIG;
  return { enabled_tiers: parsed };
}
