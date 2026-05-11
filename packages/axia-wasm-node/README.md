# `@axia/wasm-node` — Headless Node WASM Build

ADR-041 P26.4 implementation. AxiA engine WASM bundle compiled with
`wasm-pack --target nodejs` for use by `@axia/mcp-server` and other
headless consumers.

## Build

```bash
cd web
npm run wasm:build:nodejs
```

Output: `dist/` (gitignored, regenerable).

## Verify

```bash
node --input-type=module -e "
import('./dist/axia_wasm.js').then(m => {
  console.log('schema:', m.schema_version());
  console.log('engine:', m.engine_version());
  const eng = new m.AxiaEngine();
  console.log('instance OK');
});
"
```

Expected:
```
schema: 1.0.0
engine: 0.1.0
instance OK
```

## Constraints (ADR-041 P26.4)

- ❌ No `Three.js` / `Toast` / `SnapManager` dependencies
- ❌ No DOM / `window` / `document` access
- ✅ Pure WASM logic — usable in Node, Bun, Deno, Workers

`web_sys::console::log_1` calls are wasm-bindgen polyfilled in Node
(no-op in headless contexts that do not provide `console`).

## Consumers

- `packages/axia-mcp-server` — MCP Surface for AI agents (ADR-041)
- (future) CI tools, headless export pipelines, AXIA file batch processors

## Schema Versioning

`schema_version()` returns the **MCP capability schema version** (semver).
MCP server uses this for handshake compatibility check:

| Engine reports | Server requires | Result |
|---|---|---|
| `1.0.0` | `^1.0.0` | OK |
| `1.5.0` | `^1.0.0` | OK (server tolerates new capabilities) |
| `2.0.0` | `^1.0.0` | **REJECT** — major change, breaking |
| `0.9.0` | `^1.0.0` | **REJECT** — engine too old |

`engine_version()` returns the cargo crate version — for audit log
correlation, NOT for compatibility check.
