/**
 * CapabilityExplorerPanel — ADR-063 Phase 1 Path Z Step 2 regression.
 *
 * 1 invariant per Step 2 §3.2:
 *   #2 capability_explorer_imports_only_capability_explorer_panel
 *      — `@axia/action-catalog` is imported by AT MOST ONE file in
 *        `web/src/`, and that file is `CapabilityExplorerPanel.ts`.
 *      — §D #1 lock-in: Capability Explorer is the SOLE consumer of
 *        the catalog package in the web/ tree.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityExplorerPanel } from './CapabilityExplorerPanel';

// Vite's import.meta.glob — source-level scan without node:fs deps.
// Captures all .ts files in web/src/ as raw strings for grep.
const allTsFiles = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('ADR-063 Step 2 — single import site lock-in', () => {
  it('capability_explorer_imports_only_capability_explorer_panel', () => {
    const importPattern = /from\s+['"]@axia\/action-catalog['"]/;
    const importers: string[] = [];
    for (const [path, content] of Object.entries(allTsFiles)) {
      // Skip test files (production-source-only contract).
      if (path.endsWith('.test.ts')) continue;
      // Skip generated WASM bindings + mocks (defensive).
      if (path.includes('/wasm/') || path.includes('/__mocks__/')) continue;
      if (importPattern.test(content)) {
        importers.push(path);
      }
    }
    expect(importers.length, `multiple files import @axia/action-catalog: ${JSON.stringify(importers)}`).toBe(1);
    expect(importers[0]).toBe('/src/ui/CapabilityExplorerPanel.ts');
  });

  it('capability_explorer_constructs_without_error', () => {
    const container = document.createElement('div');
    const panel = new CapabilityExplorerPanel(container, {});
    expect(panel.isVisible()).toBe(false);
    panel.show();
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    panel.dispose();
  });

  it('capability_explorer_exposes_catalog_size_above_zero', () => {
    // §D #1 lock-in: only Capability Explorer surfaces catalog size.
    const size = CapabilityExplorerPanel.getCatalogSize();
    expect(size, 'catalog should have actions registered').toBeGreaterThan(0);
    // Step 1 added 13 endpoints to 82 baseline → 95 total.
    expect(size).toBeGreaterThanOrEqual(95);
  });
});

describe('ADR-063 Step 3 — actions tree + Tier groups + search', () => {
  it('capability_explorer_panel_renders_all_actions', () => {
    // Per ADR-063 §3.2 invariant — panel renders all 95 actions when
    // shown with no filter. We probe the rendered DOM for action ids.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new CapabilityExplorerPanel(container, {});
    panel.show();

    const allActions = CapabilityExplorerPanel.getAllActions();
    const renderedIds = Array.from(
      container.querySelectorAll('.cep-action-row'),
    ).map((el) => (el as HTMLElement).dataset.actionId);

    expect(renderedIds.length).toBe(allActions.length);
    // Spot-check a few from each Phase O+P+L₂ batch (Step 1 entries).
    for (const id of [
      'edge-curve-info',
      'face-normals-cached',
      'attach-surface-cylinder-validated',
      'fillet-edge', // pre-Step-1 baseline action
    ]) {
      expect(renderedIds, `missing action id: ${id}`).toContain(id);
    }

    panel.dispose();
    container.remove();
  });

  it('capability_explorer_search_filter_works', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new CapabilityExplorerPanel(container, {});

    // Filter by 'cylinder' — should return ≥ 1 match (attach-surface-cylinder-validated etc.)
    const cylinderHits = panel.filterActions('cylinder');
    expect(cylinderHits.length).toBeGreaterThan(0);
    expect(cylinderHits.some((a) => a.id.includes('cylinder'))).toBe(true);

    // Filter by 'attach-surface' — must return all 5 W2 endpoints (Path Z).
    const attachHits = panel.filterActions('attach-surface');
    expect(attachHits.length).toBe(5);

    // Filter by impossible string — returns empty.
    const noHits = panel.filterActions('xyznonexistentabc12345');
    expect(noHits.length).toBe(0);

    // Empty query returns ALL.
    const allHits = panel.filterActions('');
    expect(allHits.length).toBe(CapabilityExplorerPanel.getCatalogSize());

    panel.dispose();
    container.remove();
  });

  it('capability_explorer_tier_groups_present', () => {
    // Each populated Tier should produce a .cep-tier-group node with
    // matching data-tier. Tiers 0/1/2 should always be populated; Tier
    // 3 may be small but should exist (Step 5 hides it by default).
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new CapabilityExplorerPanel(container, {});
    panel.show();

    const tiers = Array.from(
      container.querySelectorAll('.cep-tier-group'),
    ).map((el) => (el as HTMLElement).dataset.tier);

    expect(tiers, 'Tier 0 should appear').toContain('0');
    expect(tiers, 'Tier 1 should appear').toContain('1');
    expect(tiers, 'Tier 2 should appear').toContain('2');
    // Tier 3 may have at least one action (e.g. file-new) — best-effort check.
    // We only assert it's renderable when present (not hidden in Step 3).

    panel.dispose();
    container.remove();
  });
});
