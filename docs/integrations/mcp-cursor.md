# Cursor IDE ↔ AxiA MCP Server

Same MCP server as Claude Desktop, different client config location.

## Prerequisites & build

Identical to [`mcp-claude-desktop.md`](./mcp-claude-desktop.md) up through
the `npm run build` step.

## Wire it into Cursor

Cursor's MCP config lives in your project or user settings:

| Scope | Path |
|---|---|
| Project | `.cursor/mcp.json` (committed to repo) |
| User | `~/.cursor/mcp.json` |

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
        "AXIA_MCP_CLIENT": "cursor"
      }
    }
  }
}
```

Reload Cursor (`Ctrl+Shift+P` → "Developer: Reload Window"). Open the
chat panel — `@axia` autocompletion should appear.

## Inline use

Cursor lets you `@-tag` an MCP server in chat:

> `@axia draw a 100x50 rect at the origin and tell me its xia_id`

The tool schemas appear in Cursor's tool picker.

## Differences vs Claude Desktop

- Cursor allows **per-project** MCP servers via `.cursor/mcp.json` —
  useful for repos that want a CAD tool available only when that project
  is open.
- Tier env var works the same way (`AXIA_MCP_TIERS=0,1,2` etc).
- Audit log path is identical: `~/.axia/mcp-audit.log`.

## Troubleshooting

See the table in [`mcp-claude-desktop.md`](./mcp-claude-desktop.md).
The errors and remedies are identical — both clients spawn the same
Node process and read the same stderr diagnostics.
