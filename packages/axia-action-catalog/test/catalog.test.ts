// ADR-045 D1 — 4 invariant regression tests + extras.
//
// Per ADR-045 D1:
//   1. action_catalog_alias_bidirectional
//   2. action_catalog_no_id_collision
//   3. action_catalog_drift_with_mcp_tiers
//   4. action_catalog_handler_invocable_from_both_surfaces (deferred —
//      requires actual handler wiring; covered by web + mcp-server tests)

import { describe, it, expect } from 'vitest';
import {
  ALL_ACTIONS,
  CATALOG_SIZE,
  getActionById,
  getActionByBridgeAlias,
  getActionByWasmAlias,
  getActionByMcpAlias,
  lookup,
  listActionIds,
  actionsByTier,
  type ActionDef,
} from '../src/index.js';

describe('ADR-045 D1 #1 — action_catalog_alias_bidirectional', () => {
  it('every MCP alias resolves back to the same ActionDef', () => {
    for (const def of ALL_ACTIONS) {
      if (def.aliases.mcp) {
        const found = getActionByMcpAlias(def.aliases.mcp);
        expect(found, `mcp alias "${def.aliases.mcp}" did not resolve`).toBe(def);
      }
    }
  });

  it('every Bridge alias resolves back', () => {
    for (const def of ALL_ACTIONS) {
      if (def.aliases.bridge) {
        const found = getActionByBridgeAlias(def.aliases.bridge);
        // Note: multiple actions may share a Bridge method (e.g.
        // bool-union/subtract/intersect all call booleanOp). The resolver
        // returns the FIRST registered — assert it's *some* def with
        // matching alias.
        expect(found?.aliases.bridge).toBe(def.aliases.bridge);
      }
    }
  });

  it('every WASM alias resolves back', () => {
    for (const def of ALL_ACTIONS) {
      if (def.aliases.wasm) {
        const found = getActionByWasmAlias(def.aliases.wasm);
        expect(found?.aliases.wasm).toBe(def.aliases.wasm);
      }
    }
  });

  it('every legacy alias resolves via lookup() with legacy tag', () => {
    for (const def of ALL_ACTIONS) {
      if (!def.aliases.legacy) continue;
      for (const old of def.aliases.legacy) {
        const result = lookup(old);
        expect(result.kind).toBe('found-legacy');
        if (result.kind === 'found-legacy') {
          expect(result.def).toBe(def);
          expect(result.legacy_alias).toBe(old);
        }
      }
    }
  });

  it('canonical lookup() returns kind=found via=canonical', () => {
    const result = lookup('tool-pushpull');
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.via).toBe('canonical');
      expect(result.def.id).toBe('tool-pushpull');
    }
  });

  it('lookup of unknown query returns kind=not-found', () => {
    const result = lookup('nonexistent-action-xyz');
    expect(result.kind).toBe('not-found');
    if (result.kind === 'not-found') {
      expect(result.query).toBe('nonexistent-action-xyz');
    }
  });
});

describe('ADR-045 D1 #2 — action_catalog_no_id_collision', () => {
  it('all canonical ids are unique', () => {
    const ids = ALL_ACTIONS.map((a) => a.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('CATALOG_SIZE matches ALL_ACTIONS.length', () => {
    expect(CATALOG_SIZE).toBe(ALL_ACTIONS.length);
  });

  it('listActionIds returns all ids sorted alphabetically', () => {
    const list = listActionIds();
    expect(list.length).toBe(CATALOG_SIZE);
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
  });

  it('no MCP alias collisions across actions', () => {
    const seen = new Set<string>();
    for (const def of ALL_ACTIONS) {
      if (def.aliases.mcp) {
        expect(seen.has(def.aliases.mcp), `MCP alias "${def.aliases.mcp}" duplicated`).toBe(false);
        seen.add(def.aliases.mcp);
      }
    }
  });

  it('no legacy alias collisions across actions', () => {
    const seen = new Set<string>();
    for (const def of ALL_ACTIONS) {
      for (const old of def.aliases.legacy ?? []) {
        expect(seen.has(old), `legacy alias "${old}" duplicated`).toBe(false);
        seen.add(old);
      }
    }
  });

  it('legacy aliases do not collide with canonical ids', () => {
    const canonicalIds = new Set(ALL_ACTIONS.map((a) => a.id));
    for (const def of ALL_ACTIONS) {
      for (const old of def.aliases.legacy ?? []) {
        expect(
          canonicalIds.has(old),
          `legacy alias "${old}" overlaps canonical id`,
        ).toBe(false);
      }
    }
  });
});

describe('ADR-045 D1 #3 — action_catalog_drift_with_mcp_tiers', () => {
  // Cross-check against MCP server tiers (the de-facto MCP capability
  // declaration). Not all MCP-declared capabilities have UI surfaces
  // yet — we only verify MCP-aliased catalog entries match a tier
  // declaration consistently.

  it('every action with MCP alias has a tier 0..3', () => {
    for (const def of ALL_ACTIONS) {
      if (def.aliases.mcp) {
        expect([0, 1, 2, 3]).toContain(def.tier);
      }
    }
  });

  it('Tier 0 actions are read-only (heuristic: status=ui-only or label suggests query)', () => {
    const tier0 = actionsByTier(0);
    expect(tier0.length).toBeGreaterThan(0);
    for (const def of tier0) {
      // Defensive — Tier 0 must NOT mutate. We can't fully enforce
      // here, but flag obvious violations.
      const looksDestructive =
        /delete|erase|remove|cut/i.test(def.id) &&
        def.status !== 'ui-only';
      expect(
        looksDestructive,
        `Tier 0 action "${def.id}" looks destructive`,
      ).toBe(false);
    }
  });

  it('Tier 3 actions exist and are flagged appropriately', () => {
    // Currently no Tier 3 in catalog (ADR-045 D5 — Debug-only). When
    // added, this test will need updating. For now: assert empty.
    expect(actionsByTier(3).length).toBe(0);
  });
});

describe('ADR-045 D1 #4 — handler_invocable_from_both_surfaces (deferred)', () => {
  // This invariant requires actual handler wiring in:
  //   - web/src/tools/ToolManagerRefactored.executeAction
  //   - packages/axia-mcp-server/src/capabilities/index.ts
  //
  // Full enforcement is in those packages' tests — this catalog test
  // only verifies the metadata is sufficient for downstream wiring
  // (i.e. no MCP-aliased action lacks a corresponding bridge/wasm
  // function name).

  it('every MCP-aliased action also has a bridge or wasm name', () => {
    for (const def of ALL_ACTIONS) {
      if (def.aliases.mcp) {
        const hasImpl =
          def.aliases.bridge !== undefined ||
          def.aliases.wasm !== undefined ||
          def.status === 'ui-only';
        expect(
          hasImpl,
          `Action "${def.id}" has MCP alias but no bridge/wasm impl`,
        ).toBe(true);
      }
    }
  });

  it('non-stub actions have at least one alias OR explicit status flag', () => {
    const exemptStatuses = new Set([
      'ui-only',
      'delegated',
      'redirect',
      'scaffold',
    ]);
    for (const def of ALL_ACTIONS) {
      if (def.status === 'stub' || def.status === 'placeholder') continue;
      const hasAnyAlias =
        def.aliases.bridge !== undefined ||
        def.aliases.wasm !== undefined ||
        def.aliases.mcp !== undefined;
      const isExemptByStatus = def.status !== undefined && exemptStatuses.has(def.status);
      expect(
        hasAnyAlias || isExemptByStatus,
        `Action "${def.id}" has no aliases and no exempt status flag`,
      ).toBe(true);
    }
  });
});

describe('Catalog metadata sanity', () => {
  it('every action has non-empty label and description', () => {
    for (const def of ALL_ACTIONS) {
      expect(def.label.length, `${def.id} label empty`).toBeGreaterThan(0);
      expect(def.description.length, `${def.id} description empty`).toBeGreaterThan(10);
    }
  });

  it('every action has at least one surface', () => {
    for (const def of ALL_ACTIONS) {
      expect(def.surfaces.length, `${def.id} has no surfaces`).toBeGreaterThan(0);
    }
  });

  it('canonical id is kebab-case (lowercase + dashes)', () => {
    for (const def of ALL_ACTIONS) {
      expect(def.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('Tier 1 + 2 are the dominant tiers (~Phase 1 audit shape)', () => {
    const t0 = actionsByTier(0).length;
    const t1 = actionsByTier(1).length;
    const t2 = actionsByTier(2).length;
    expect(t1 + t2).toBeGreaterThanOrEqual(t0);
  });
});

describe('Audit Finding 3 follow-through — stub status visible in catalog', () => {
  it('tool-point / tool-text3d / tool-trim / tool-extend all flagged stub', () => {
    const stubs = ['tool-point', 'tool-text3d', 'tool-trim', 'tool-extend'];
    for (const id of stubs) {
      const def = getActionById(id);
      expect(def, `${id} missing`).toBeDefined();
      expect(def!.status, `${id} should be stub`).toBe('stub');
    }
  });

  it('description of stub actions mentions "stub" or "not yet"', () => {
    const stubDefs: ActionDef[] = ALL_ACTIONS.filter((a) => a.status === 'stub');
    expect(stubDefs.length).toBeGreaterThan(0);
    for (const def of stubDefs) {
      expect(def.description).toMatch(/stub|not yet implemented/i);
    }
  });
});

describe('ADR-063 Step 1 — Phase O+P+L₂ endpoints synchronized', () => {
  it('catalog_includes_phase_o_p_l2_endpoints', () => {
    // 13 endpoints registered per ADR-063 Step 1 §5 matrix.
    // Phase O Step 6 (5) + Phase P-narrow (3) + Phase L₂ Path Z (5) = 13.
    const required: ReadonlyArray<{ id: string; tier: 0 | 1 | 2 | 3; wasm: string }> = [
      // Phase O Step 6
      { id: 'edge-curve-info',                  tier: 0, wasm: 'getEdgeCurveJson' },
      { id: 'face-surface-info',                tier: 0, wasm: 'getFaceSurfaceJson' },
      { id: 'migrate-curve-surface',            tier: 2, wasm: 'migrateCurveSurfaceMandatory' },
      { id: 'bool-dispatch',                    tier: 2, wasm: 'booleanDispatchJson' },
      { id: 'fillet-dispatch',                  tier: 2, wasm: 'filletEdgeDispatchJson' },
      // Phase P-narrow
      { id: 'face-normals-cached',              tier: 0, wasm: 'getFaceNormalsCached' },
      { id: 'edge-polyline-cached',             tier: 0, wasm: 'getEdgePolylineCached' },
      { id: 'cache-stats',                      tier: 0, wasm: 'getCacheStats' },
      // Phase L₂ Path Z (W2 per-kind)
      { id: 'attach-surface-plane-validated',   tier: 1, wasm: 'attachFaceSurfacePlaneValidated' },
      { id: 'attach-surface-cylinder-validated', tier: 1, wasm: 'attachFaceSurfaceCylinderValidated' },
      { id: 'attach-surface-sphere-validated',  tier: 1, wasm: 'attachFaceSurfaceSphereValidated' },
      { id: 'attach-surface-cone-validated',    tier: 1, wasm: 'attachFaceSurfaceConeValidated' },
      { id: 'attach-surface-torus-validated',   tier: 1, wasm: 'attachFaceSurfaceTorusValidated' },
    ];
    for (const r of required) {
      const def = getActionById(r.id);
      expect(def, `${r.id} missing from catalog`).toBeDefined();
      expect(def!.tier, `${r.id} tier mismatch`).toBe(r.tier);
      expect(def!.aliases.wasm, `${r.id} wasm alias mismatch`).toBe(r.wasm);
      // §D-B: surfaces should include 'mcp' AND 'palette' (Capability Explorer).
      expect(def!.surfaces).toContain('mcp');
      expect(def!.surfaces).toContain('palette');
      // §D-E: status='ok' (wasm endpoint operational).
      expect(def!.status, `${r.id} status should be 'ok'`).toBe('ok');
      // §D-F: bridge alias intentionally absent (direct wasm call).
      expect(def!.aliases.bridge, `${r.id} should NOT have bridge alias`).toBeUndefined();
      // §D-G: mcp alias is snake_case auto-derived from id.
      expect(def!.aliases.mcp, `${r.id} mcp alias missing`).toBeDefined();
      expect(def!.aliases.mcp).toMatch(/^[a-z][a-z_]*$/);
    }
    // CATALOG_SIZE invariant: 82 (pre-Step-1) + 13 (Step 1) = 95.
    expect(CATALOG_SIZE).toBe(95);
  });
});
