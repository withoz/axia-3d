# `@axia/action-catalog`

Single source of truth for action identity across UI / Bridge / WASM /
MCP layers. Implements **ADR-045 D1**.

## Why

The 2026-05-02 integrity audit (`docs/audits/2026-05-02-integrity-matrix.csv`)
identified naming drift across 4 vocabularies for the same operations:

| Layer | Convention | Example |
|---|---|---|
| UI action_id | kebab-case | `tool-pushpull` |
| Bridge method | camelCase | `pushPull` |
| WASM export | snake_case | `push_pull` |
| MCP capability | snake_case + suffix | `push_pull` |

Without a SSOT, adding/removing actions requires touching ~5 files
across 3 packages with 0 type-safety on the linkage. This catalog
fixes that.

## Usage

### Find an action

```typescript
import { lookup, getActionById, getActionByMcpAlias } from '@axia/action-catalog';

// Direct id lookup
const def = getActionById('tool-pushpull');
console.log(def?.label);  // → "밀기/당기기"

// MCP capability lookup (for axia-mcp-server)
const def2 = getActionByMcpAlias('push_pull');
console.log(def2?.id);  // → "tool-pushpull"

// Generic lookup (tries all alias channels + legacy)
const result = lookup('tool-mirror');
if (result.kind === 'found-legacy') {
  console.warn(`"${result.legacy_alias}" is deprecated, use "${result.def.id}"`);
}
```

### Iterate

```typescript
import { ALL_ACTIONS, actionsByTier } from '@axia/action-catalog';

// All actions
for (const def of ALL_ACTIONS) {
  console.log(def.id, def.tier, def.label);
}

// Just Tier 0 (read)
const readOnly = actionsByTier(0);
```

## Status field

Each `ActionDef` may carry a `status` field (defaults to `"ok"`):

| Status | Meaning |
|---|---|
| `ok` | Fully wired with direct bridge/wasm aliases |
| `stub` | Menu shows but tool unregistered (Toast warning) |
| `placeholder` | Intentionally disabled (e.g. `export-step` Stage 5) |
| `scaffold` | Stage 4-A scaffolding only |
| `redirect` | Menu redirects to a different panel |
| `ui-only` | UI state, no engine call |
| `delegated` | Wired via TS handler module (e.g. ConstraintCommands) |

## Adding an action

1. Append to `ALL_ACTIONS` in `src/catalog.ts`.
2. Choose canonical id (kebab-case).
3. Fill in aliases (`bridge`, `wasm`, `mcp`, `legacy[]`).
4. Run `npm test` — D1 invariants verify drift.
5. Wire in consumers (`ToolManagerRefactored.executeAction`,
   `axia-mcp-server` capability handler).

## Removing / renaming

- Move old id to `aliases.legacy[]`.
- Bump release SCHEMA_VERSION (ADR-041 P26.2). MAJOR if MCP consumers
  may rely on old name.

## ADR references

- **ADR-045 D1**: ActionCatalog SSOT
- **ADR-041 P26.2**: Schema versioning (alias drift impact)
- **ADR-042 P27**: ALLOW/DENY policy (catalog feeds policy decisions)
- **ADR-044 P29**: Release process (lockstep semver applies here too)

## Testing

```bash
npm test     # 23 tests, runs the 4 D1 invariants + sanity
npm run build
```

## Status

- ✅ Catalog seeded with 82 actions (Phase 1+2 audit)
- ✅ 4 D1 invariants enforced
- ⏳ web/ ToolManager migration (PR-2 follow-up)
- ⏳ axia-mcp-server capability map alignment (PR-2 follow-up)
- ⏳ Capability Explorer panel (PR-3, ADR-045 D3)
