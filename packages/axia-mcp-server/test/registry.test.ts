// ADR-041 P26.8 — handler registry vs tier SSOT regression.
import { describe, it, expect } from 'vitest';
import {
  ALL_CAPABILITY_HANDLERS,
  listRegisteredCapabilities,
} from '../src/capabilities/index.js';
import { tierOf, isKnownCapability } from '../src/tiers.js';

describe('capability handler registry', () => {
  it('every registered handler has a name listed in tiers.ts', () => {
    for (const cap of ALL_CAPABILITY_HANDLERS) {
      expect(isKnownCapability(cap.name)).toBe(true);
    }
  });

  it('handler.tier matches the tier declared in tiers.ts', () => {
    for (const cap of ALL_CAPABILITY_HANDLERS) {
      expect(cap.tier).toBe(tierOf(cap.name));
    }
  });

  it('current registry surface (Stage 3 + #2 follow-up)', () => {
    // Adding/removing handlers requires updating this list AND the
    // tier declarations in tiers.ts. Drift between the two = bug.
    expect(listRegisteredCapabilities().sort()).toEqual([
      'draw_circle',
      'draw_line',
      'draw_rect',
      'export_axia',
      'get_scene_summary',
      'list_xias',
      'push_pull',
    ]);
  });

  it('every handler has non-empty description (MCP tool listing requirement)', () => {
    for (const cap of ALL_CAPABILITY_HANDLERS) {
      expect(cap.description.length).toBeGreaterThan(20);
    }
  });
});
