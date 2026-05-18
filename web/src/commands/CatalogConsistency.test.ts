/**
 * ADR-133 — Dual Catalog Unification Invariant Test (Path E adapter layer).
 *
 * ADR-132 §A1.2 dual catalog architectural finding 의 implementation guard.
 * ADR-045 D1 SSOT invariant 실측 회복 — ActionCatalog 가 *모든 user-facing IDs* 의
 * identity SSOT.
 *
 * **Invariant** (canonical, single direction):
 *
 *   For every command registered in CommandCatalog (via `registerAxiaCommands`),
 *   the canonical id MUST exist in ActionCatalog.
 *
 * **Direction note**: AC ⊇ CC (ActionCatalog superset). 13 AC-only entries
 * (`attach-surface-*-validated`, `bool-dispatch`, `cache-stats`, etc.) are
 * MCP/diagnostic-only — not registered in CommandCatalog. This is OK.
 *
 * **What this catches**:
 *   1. New CommandCatalog entry added without ActionCatalog counterpart →
 *      CI fails (caller must add AC entry first)
 *   2. ActionCatalog ID renamed/removed but CommandCatalog still uses old id →
 *      CI fails (drift signal)
 *
 * **What this does NOT catch**:
 *   - Label/description drift between AC and CC (separate field-level test
 *     would need to compare AC.label vs CC.label per shared id — deferred to
 *     ADR-134+ if needed)
 *   - Shortcut/tier metadata drift
 *
 * Cross-link:
 *   - ADR-133 (본 ADR — Path E adapter layer implementation)
 *   - ADR-132 §A1.2 (dual catalog finding)
 *   - ADR-045 D1 (ActionCatalog SSOT spec)
 *   - ADR-131 (CommandPalette already exists, dual catalog discovery)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getCommandCatalog, __resetCommandCatalog, type CommandDef } from './CommandCatalog';
import { registerAxiaCommands } from './AxiaCommands';
import { getActionById, type ActionDef } from '@axia/action-catalog';

describe('ADR-133 — Dual catalog unification invariant', () => {
  beforeEach(() => {
    __resetCommandCatalog();
  });

  it('every CommandCatalog id exists in ActionCatalog', () => {
    // Minimal ToolManager stub — registerAxiaCommands needs `.setTool()` +
    // `.executeAction()` on the deps.toolManager arg. We don't actually
    // invoke any commands; just register their metadata.
    const toolManager = {
      setTool: () => {},
      executeAction: () => {},
      _currentTool: '',
    } as unknown as Parameters<typeof registerAxiaCommands>[0]['toolManager'];

    registerAxiaCommands({ toolManager });

    const ccCommands: CommandDef[] = getCommandCatalog().list();
    const missing: string[] = [];

    for (const cmd of ccCommands) {
      const ac: ActionDef | undefined = getActionById(cmd.id);
      if (!ac) {
        missing.push(cmd.id);
      }
    }

    expect(
      missing,
      `${missing.length} CommandCatalog id(s) missing from ActionCatalog:\n` +
        missing.map((id) => `  - ${id}`).join('\n') +
        `\n\nFix: add ActionDef entries to packages/axia-action-catalog/src/catalog.ts\n` +
        `(see ADR-133 § L-133-2 for new entries pattern).\n`,
    ).toEqual([]);
  });

  it('CommandCatalog count matches expected total (148, per ADR-132 audit)', () => {
    const toolManager = {
      setTool: () => {},
      executeAction: () => {},
      _currentTool: '',
    } as unknown as Parameters<typeof registerAxiaCommands>[0]['toolManager'];

    registerAxiaCommands({ toolManager });

    const count = getCommandCatalog().size();
    // ADR-132 §2.3 audit measured 148 commands (verified via `grep -c "cmds.push"`).
    // If this number changes, ADR-132 §2 inventory should be updated +
    // ADR-133 L-133-3 161 unique count recalculated.
    expect(count).toBe(148);
  });

  it('ActionCatalog count is at least 161 (82 shared + 13 AC-only + 66 ADR-133 added)', () => {
    // Sanity check — ADR-133 added 66 entries to ActionCatalog → total 161.
    // Tighter equality is enforced by `catalog.test.ts` in the package.
    // Here we just guard against accidental regression (someone removes
    // ADR-133 entries without removing the matching CommandCatalog entries).
    const { CATALOG_SIZE } = require('@axia/action-catalog');
    expect(CATALOG_SIZE).toBeGreaterThanOrEqual(161);
  });
});
