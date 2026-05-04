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
