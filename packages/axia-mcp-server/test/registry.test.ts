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

  it('Stage 3 wires exactly draw_rect / push_pull / export_axia', () => {
    expect(listRegisteredCapabilities().sort()).toEqual(
      ['draw_rect', 'export_axia', 'push_pull'],
    );
  });

  it('every handler has non-empty description (MCP tool listing requirement)', () => {
    for (const cap of ALL_CAPABILITY_HANDLERS) {
      expect(cap.description.length).toBeGreaterThan(20);
    }
  });
});
