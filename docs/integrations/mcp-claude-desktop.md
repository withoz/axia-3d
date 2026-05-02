# Claude Desktop ↔ AxiA MCP Server

This guide wires Claude Desktop to the AxiA 3D engine through the
**Model Context Protocol (MCP)**. Once configured, you can ask Claude
to draw, modify, and export AXiA scenes directly in conversation.

> **Implementation reference**: ADR-041 (Capability-Sandboxed MCP Surface).

## Prerequisites

- **Node.js 20+** (Claude Desktop spawns the server as a Node process)
- **Rust toolchain** with `wasm-pack` (only needed once, to build the
  engine WASM). Install: <https://rustwasm.github.io/wasm-pack/installer/>
- **Claude Desktop** — latest version. Download:
  <https://claude.ai/download>

## One-time setup

```bash
# 1. Clone (or pull) AxiA
git clone https://github.com/withoz/axia-3d
cd axia-3d

# 2. Build the headless engine (~6 sec on first run)
cd web
npm install            # if you have not already
npm run wasm:build:nodejs

# 3. Build the MCP server
cd ../packages/axia-mcp-server
npm install
npm run build

# 4. Verify it boots
npm start
# Expected stderr line:
#   [axia-mcp-server] Handshake OK — engine schema=1.0.0, ...
# Press Ctrl+C to stop.
```

## Wire it into Claude Desktop

Edit your Claude Desktop MCP config:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add an `axia` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "axia": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/axia-3d/packages/axia-mcp-server/dist/index.js"
      ],
      "env": {
        "AXIA_MCP_TIERS": "0,1",
        "AXIA_MCP_CLIENT": "claude-desktop"
      }
    }
  }
}
```

> Use an **absolute path**. Claude Desktop runs the server from its own
> working directory; relative paths will fail.

Restart Claude Desktop. A wrench icon should appear in the input box —
click it to confirm the AxiA tools are listed.

## What you get out of the box

Default tier config (`AXIA_MCP_TIERS=0,1`) exposes Tier 0 + Tier 1:

- 🟢 **Read** — `get_scene_summary`, `list_xias`, `get_face_info`, ...
- 🟢 **Constructive** — `draw_rect`, `draw_circle`, `draw_line`,
  `export_axia`, `export_obj`, `export_stl`

Modificative tools (`push_pull`, `boolean_subtract`, `fillet_edge`, ...)
require **opt-in** because they change existing geometry.

## Enabling more capability tiers

Edit the `AXIA_MCP_TIERS` env in your `claude_desktop_config.json`:

| `AXIA_MCP_TIERS` | What's enabled |
|---|---|
| `0` | Read-only (safest) |
| `0,1` | **Default** — read + draw + export |
| `0,1,2` | + `push_pull`, `boolean_*`, `move_xia`, `fillet_edge`, ... |
| `0,1,2,3` | + `erase_*`, `delete_*`, `import_step` (destructive) |

Tier 2 / 3 calls append a record to `~/.axia/mcp-audit.log` (JSONL) so
you can review what Claude actually did.

## Try it

After Claude Desktop restarts, try:

> "Draw a 100×50 mm rectangle at the origin and export it as AXIA."

Claude should:
1. Call `draw_rect` with `{ center: [0,0,0], width: 100, height: 50 }`
2. Call `export_axia` and decode the base64 blob
3. Hand you the bytes (or a save link, depending on your client)

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Failed to start server" | `dist/index.js` missing | `npm run build` in `packages/axia-mcp-server` |
| "MCP schema mismatch" | Engine WASM is older/newer than server | Rebuild: `cd web && npm run wasm:build:nodejs` |
| Tool not visible in Claude Desktop UI | Tier not enabled | Set `AXIA_MCP_TIERS` to include the right tier |
| Server starts but no tools listed | Handshake failed; check stderr | Run `npm start` manually to see the error |

## Security model (TL;DR)

- **Capability-sandboxed**: only whitelisted operations — adding a new
  capability requires an ADR.
- **Schema-versioned**: engine ↔ server semver `^MAJOR.MINOR` checked
  at startup. Mismatch → fail fast, no tool calls.
- **Owner-ID only**: no raw triangle/segment indices ever cross the
  boundary. Claude must use `face_id`, `xia_id`, etc.
- **Audit trail**: Tier 2 / 3 calls logged to `~/.axia/mcp-audit.log`.
- **Session-isolated**: AI agent gets its own engine instance; your
  open AxiA viewport is unaffected.

Full details: see ADR-041 in `docs/adr/041-mcp-surface.md`.
