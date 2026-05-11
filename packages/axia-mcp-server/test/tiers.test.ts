// ADR-041 P26.8 — tier authorization + surface-drift regression tests
import { describe, it, expect } from 'vitest';
import {
  authorizeCapability,
  CapabilityBlockedError,
  UnknownCapabilityError,
  tierOf,
  isKnownCapability,
  ALL_CAPABILITIES,
  TIER_0_READ,
  TIER_1_CONSTRUCTIVE,
  TIER_2_MODIFY,
  TIER_3_DESTROY,
  DEFAULT_TIER_CONFIG,
  tierConfigFromEnv,
} from '../src/tiers.js';

describe('ADR-041 P26.1 — capability tier authorization', () => {
  it('default config allows Tier 0 + Tier 1 only', () => {
    expect(DEFAULT_TIER_CONFIG.enabled_tiers).toEqual([0, 1]);
  });

  it('Tier 0 read-only capability passes default', () => {
    expect(() => authorizeCapability('get_scene_summary')).not.toThrow();
  });

  it('Tier 1 constructive passes default', () => {
    expect(() => authorizeCapability('draw_rect')).not.toThrow();
    expect(() => authorizeCapability('export_axia')).not.toThrow();
  });

  it('mcp_tier3_blocked_when_not_enabled — erase blocked at default', () => {
    expect(() => authorizeCapability('erase_face')).toThrow(CapabilityBlockedError);
    expect(() => authorizeCapability('delete_xia')).toThrow(CapabilityBlockedError);
  });

  it('Tier 2 modificative blocked at default', () => {
    expect(() => authorizeCapability('push_pull')).toThrow(CapabilityBlockedError);
    expect(() => authorizeCapability('boolean_subtract')).toThrow(CapabilityBlockedError);
  });

  it('Tier 2 unblocked when explicitly enabled', () => {
    expect(() =>
      authorizeCapability('push_pull', { enabled_tiers: [0, 1, 2] }),
    ).not.toThrow();
  });

  it('Unknown capability rejected with explicit error', () => {
    expect(() => authorizeCapability('rm_rf_slash')).toThrow(UnknownCapabilityError);
  });

  it('CapabilityBlockedError carries diagnostic fields', () => {
    try {
      authorizeCapability('erase_face');
      throw new Error('unreachable');
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityBlockedError);
      const err = e as CapabilityBlockedError;
      expect(err.capability).toBe('erase_face');
      expect(err.tier).toBe(3);
      expect(err.enabled_tiers).toEqual([0, 1]);
    }
  });
});

describe('ADR-041 P26.8 — mcp_capability_surface_matches_adr_041_p26_1', () => {
  // This test is the surface-drift guard. If a capability is added/removed,
  // BOTH this test AND ADR-041 must update together.

  it('Tier 0 contains exactly the read capabilities from ADR-041 P26.1', () => {
    expect([...TIER_0_READ].sort()).toEqual(
      [
        'get_edge_info',
        'get_face_info',
        'get_scene_summary',
        'get_schema_version',
        'get_xia_geometry_state',
        'list_groups',
        'list_xias',
      ].sort(),
    );
  });

  it('Tier 1 contains exactly the constructive capabilities', () => {
    expect([...TIER_1_CONSTRUCTIVE].sort()).toEqual(
      [
        'create_group',
        'create_xia',
        'draw_circle',
        'draw_line',
        'draw_polyline',
        'draw_rect',
        'export_axia',
        'export_obj',
        'export_step',
        'export_stl',
      ].sort(),
    );
  });

  it('Tier 2 contains exactly the modificative capabilities', () => {
    expect([...TIER_2_MODIFY].sort()).toEqual(
      [
        'boolean_intersect',
        'boolean_subtract',
        'boolean_union',
        'chamfer_edge',
        'fillet_edge',
        'move_xia',
        'offset_face',
        'push_pull',
        'rotate_xia',
        'scale_xia',
      ].sort(),
    );
  });

  it('Tier 3 contains exactly the destructive capabilities', () => {
    expect([...TIER_3_DESTROY].sort()).toEqual(
      ['delete_group', 'delete_xia', 'erase_edge', 'erase_face', 'import_step'].sort(),
    );
  });

  it('every capability is in exactly one tier', () => {
    for (const cap of ALL_CAPABILITIES) {
      const tier = tierOf(cap);
      expect(tier).toBeDefined();
      expect([0, 1, 2, 3]).toContain(tier);
    }
    // Reverse: no duplicates across tiers
    const unique = new Set(ALL_CAPABILITIES);
    expect(unique.size).toBe(ALL_CAPABILITIES.length);
  });

  it('isKnownCapability rejects unknown names (no fuzzy match)', () => {
    expect(isKnownCapability('draw_rect')).toBe(true);
    expect(isKnownCapability('drawrect')).toBe(false);
    expect(isKnownCapability('DrawRect')).toBe(false);
    expect(isKnownCapability('')).toBe(false);
  });
});

describe('AXIA_MCP_TIERS env var parsing', () => {
  it('parses comma-separated tiers', () => {
    expect(tierConfigFromEnv({ AXIA_MCP_TIERS: '0,1,2' }).enabled_tiers).toEqual([0, 1, 2]);
  });

  it('falls back to default on missing var', () => {
    expect(tierConfigFromEnv({}).enabled_tiers).toEqual([0, 1]);
  });

  it('falls back to default on garbage input', () => {
    expect(tierConfigFromEnv({ AXIA_MCP_TIERS: 'banana,42' }).enabled_tiers).toEqual([
      0, 1,
    ]);
  });

  it('clamps values outside 0..3', () => {
    expect(tierConfigFromEnv({ AXIA_MCP_TIERS: '0,5,1,99' }).enabled_tiers).toEqual([
      0, 1,
    ]);
  });
});
