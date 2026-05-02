// ADR-045 D2 regression — `MaterialPropertiesPanel is removed as dead
// code; re-introduction requires a new ADR.`
//
// This test serves as the resurrection-prevention guard. It scans the
// production source tree (via Vite's `import.meta.glob`, build-time)
// for any reference to the removed symbol / file paths. If a future
// PR re-adds the panel without amending ADR-045, this test breaks at
// CI time.

import { describe, it, expect } from 'vitest';

// Vite primitive — collects all source files at build time.
// Returns a map of path → file contents (string).
const allTs = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const allHtml = import.meta.glob('/src/**/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const allCss = import.meta.glob('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Filter: production source paths only. Skip the resurrection-guard
 *  test itself (it must mention the symbol — that is its job). */
function productionSources(map: Record<string, string>): Array<[string, string]> {
  return Object.entries(map).filter(
    ([path]) =>
      !path.endsWith('MaterialPropertiesPanel.removed.test.ts') &&
      !path.includes('/__mocks__/'),
  );
}

describe('ADR-045 D2 — material_properties_panel_not_imported', () => {
  it('MaterialPropertiesPanel.ts no longer in source tree', () => {
    const stillThere = Object.keys(allTs).filter((p) =>
      p.endsWith('/ui/MaterialPropertiesPanel.ts'),
    );
    expect(
      stillThere,
      'MaterialPropertiesPanel.ts reappeared. ADR-045 D2 says ' +
        '"Dead panel removed, re-introduction requires a new ADR."',
    ).toEqual([]);
  });

  it('MaterialPropertiesPanel.css no longer in source tree', () => {
    const stillThere = Object.keys(allCss).filter((p) =>
      p.endsWith('/ui/MaterialPropertiesPanel.css'),
    );
    expect(stillThere, 'MaterialPropertiesPanel.css reappeared').toEqual([]);
  });

  it('No production .ts source mentions MaterialPropertiesPanel', () => {
    const violations = productionSources(allTs)
      .filter(([_, content]) => content.includes('MaterialPropertiesPanel'))
      .map(([path]) => path);
    expect(
      violations,
      `MaterialPropertiesPanel referenced by .ts files: ${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('No .html template references the legacy mat-panel container', () => {
    const violations = productionSources(allHtml)
      .filter(([_, content]) => /\bmat-panel\b/.test(content))
      .map(([path]) => path);
    expect(violations, `mat-panel id reappeared in: ${violations.join(', ')}`).toEqual([]);
  });

  it('No .ts source references __axia_materialPanel global', () => {
    // The legacy MenuBar referenced this window global. Audit
    // confirmed it was never wired in production. Make sure it stays
    // unset.
    const violations = productionSources(allTs)
      .filter(([_, content]) => content.includes('__axia_materialPanel'))
      .map(([path]) => path);
    expect(
      violations,
      `__axia_materialPanel global referenced by: ${violations.join(', ')}`,
    ).toEqual([]);
  });
});
