# AxiA 3D — External Integrations

Guides for plugging AxiA into AI clients and other tools.

| Guide | Audience | Status |
|---|---|---|
| [MCP — Claude Desktop](./mcp-claude-desktop.md) | End users | ✅ Stage 4 (ADR-041) |
| [MCP — Cursor](./mcp-cursor.md) | Developers | ✅ Stage 4 (ADR-041) |
| (planned) MCP — Anthropic Managed Agents | Agents | ⏳ |
| (planned) Headless CLI batch processor | CI / build pipelines | ⏳ |
| (planned) Web SDK | Browser apps | ⏳ |

## ADR-041 quick reference

The MCP server is **capability-sandboxed**: it exposes a whitelist of
named operations, not the entire engine API.

| Tier | Default | Examples |
|---|---|---|
| 0 — Read | ✅ on | `get_scene_summary`, `list_xias` |
| 1 — Constructive | ✅ on | `draw_rect`, `export_axia` |
| 2 — Modificative | opt-in | `push_pull`, `boolean_subtract` |
| 3 — Destructive | opt-in | `erase_face`, `delete_xia` |

Override via `AXIA_MCP_TIERS=0,1,2` env var. Tier 2 / 3 calls are
logged to `~/.axia/mcp-audit.log`.

## Why MCP?

- **Open standard** — works with Claude Desktop, Cursor, Continue,
  Anthropic Managed Agents, and growing list of other clients
- **Schema-versioned** — `^MAJOR.MINOR` semver check at handshake
  prevents AI agents from speaking to incompatible engine builds
- **Stdio transport** — no network ports, no auth tokens, runs as
  child process of the AI client

See `docs/adr/041-mcp-surface.md` for full design rationale.
