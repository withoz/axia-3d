# `@axia/mcp-server`

AxiA 3D MCP (Model Context Protocol) Surface — capability-sandboxed bridge
for AI agents (Claude Desktop / Cursor / Anthropic Managed Agents).

Implements **ADR-041** (Capability-Sandboxed MCP Surface).

## Quick start

```bash
# 1. Build engine WASM for Node
cd ../../web
npm run wasm:build:nodejs

# 2. Install + build MCP server
cd ../packages/axia-mcp-server
npm install
npm run build

# 3. Run (stdio transport — Claude Desktop reads stdout)
npm start
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `AXIA_MCP_TIERS` | `0,1` | Comma-separated enabled tiers (0=read, 1=construct, 2=modify, 3=destroy) |
| `AXIA_MCP_CLIENT` | `unknown` | Client identifier for audit log |

## Capability tiers (ADR-041 P26.1)

| Tier | Purpose | Default | Examples |
|---|---|---|---|
| 0 | Read-only inspection | ✅ on | `get_scene_summary`, `list_xias` |
| 1 | Constructive | ✅ on | `draw_rect`, `export_axia` |
| 2 | Modificative | ⚪ opt-in | `push_pull`, `boolean_subtract` |
| 3 | Destructive | ⚪ opt-in | `erase_face`, `delete_xia` |

Add `AXIA_MCP_TIERS=0,1,2` to enable Tier 2.

## Schema versioning (ADR-041 P26.2)

Three-layer defense:
1. WASM exports `schema_version()` (e.g. `1.0.0`)
2. MCP server checks `^MAJOR.MINOR` compatibility on handshake
3. (Future) Per-call `schema_version` field in tool args

Mismatch → `SchemaIncompatibleError` thrown BEFORE any tool dispatch.

## Audit (ADR-041 P26.7)

Tier 2 / 3 calls append a JSONL line to `~/.axia/mcp-audit.log`:

```json
{"timestamp":"2026-05-02T10:23:45.123Z","client":"claude-desktop",
 "tier":2,"capability":"push_pull",
 "args":{"face_id":42,"distance":50},
 "duration_ms":23,"result":"ok"}
```

## Test

```bash
npm test
```

Current: **42 tests** across handshake / tiers / audit / schema /
integration. Stage 3 will add e2e capability tests.

## Status

- ✅ Stage 2 — Scaffold + handshake + tier authorization + audit + schemas
- ⏳ Stage 3 — `draw_rect` / `push_pull` / `export_axia` end-to-end
- ⏳ Stage 4 — Claude Desktop / Cursor integration guide
