#!/usr/bin/env node
// ADR-044 P29.2 — Schema pin consistency verification.
//
// Cross-checks three sources at publish time:
//   1. @axia/wasm-node     SCHEMA_VERSION (from Rust → exported JS)
//   2. @axia/mcp-server    MCP_SERVER_SCHEMA_VERSION (handshake.ts)
//   3. create-axia-mcp     MCP_SERVER_VERSION_RANGE (scaffold.ts)
//
// Rule: server MCP_SERVER_SCHEMA_VERSION must satisfy ^WASM_SCHEMA, AND
// scaffold MCP_SERVER_VERSION_RANGE must satisfy publish-target server
// version.
//
// Exit 0 on consistent, 1 on mismatch (with diagnostic).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import semver from 'semver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function fail(msg) {
  process.stderr.write(red(`[verify-schema-pin] FAIL: ${msg}\n`));
  process.exit(1);
}

// ─── 1. Read @axia/mcp-server's MCP_SERVER_SCHEMA_VERSION ───
const handshakeSrc = resolve(repoRoot, 'packages/axia-mcp-server/src/handshake.ts');
if (!existsSync(handshakeSrc)) {
  fail(`handshake.ts missing at ${handshakeSrc}`);
}
const handshakeText = readFileSync(handshakeSrc, 'utf8');
const serverSchemaMatch = handshakeText.match(
  /MCP_SERVER_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/,
);
if (!serverSchemaMatch) {
  fail('MCP_SERVER_SCHEMA_VERSION not found in handshake.ts');
}
const serverSchema = serverSchemaMatch[1];
if (!semver.valid(serverSchema)) {
  fail(`MCP_SERVER_SCHEMA_VERSION="${serverSchema}" is not valid semver`);
}

// ─── 2. Read engine SCHEMA_VERSION from Rust ───
const wasmRust = resolve(repoRoot, 'crates/axia-wasm/src/lib.rs');
if (!existsSync(wasmRust)) {
  fail(`axia-wasm lib.rs missing at ${wasmRust}`);
}
const wasmText = readFileSync(wasmRust, 'utf8');
const wasmSchemaMatch = wasmText.match(
  /const\s+SCHEMA_VERSION:\s*&str\s*=\s*"([^"]+)"/,
);
if (!wasmSchemaMatch) {
  fail('SCHEMA_VERSION not found in crates/axia-wasm/src/lib.rs');
}
const wasmSchema = wasmSchemaMatch[1];
if (!semver.valid(wasmSchema)) {
  fail(`engine SCHEMA_VERSION="${wasmSchema}" is not valid semver`);
}

// ─── 3. Read create-axia-mcp's MCP_SERVER_VERSION_RANGE ───
const scaffoldSrc = resolve(repoRoot, 'packages/create-axia-mcp/src/scaffold.ts');
if (!existsSync(scaffoldSrc)) {
  fail(`scaffold.ts missing at ${scaffoldSrc}`);
}
const scaffoldText = readFileSync(scaffoldSrc, 'utf8');
const scaffoldRangeMatch = scaffoldText.match(
  /MCP_SERVER_VERSION_RANGE\s*=\s*['"]([^'"]+)['"]/,
);
if (!scaffoldRangeMatch) {
  fail('MCP_SERVER_VERSION_RANGE not found in scaffold.ts');
}
const scaffoldRange = scaffoldRangeMatch[1];
if (!semver.validRange(scaffoldRange)) {
  fail(`scaffold MCP_SERVER_VERSION_RANGE="${scaffoldRange}" is not valid semver range`);
}

// ─── 4. Cross-check ───
// (a) server.MCP_SERVER_SCHEMA_VERSION must satisfy ^engine.SCHEMA_VERSION
if (!semver.satisfies(serverSchema, `^${wasmSchema}`)) {
  fail(
    `Server schema ${serverSchema} does not satisfy ^${wasmSchema} (engine).\n` +
      `  Either bump SCHEMA_VERSION in crates/axia-wasm/src/lib.rs or\n` +
      `  bump MCP_SERVER_SCHEMA_VERSION in packages/axia-mcp-server/src/handshake.ts.`,
  );
}

// (b) Read server's package.json version — what scaffold range must satisfy.
const serverPkg = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'packages/axia-mcp-server/package.json'),
    'utf8',
  ),
);
const serverPkgVersion = serverPkg.version;
if (!semver.valid(serverPkgVersion)) {
  fail(`@axia/mcp-server package.json version "${serverPkgVersion}" invalid`);
}
if (!semver.satisfies(serverPkgVersion, scaffoldRange)) {
  fail(
    `Scaffold MCP_SERVER_VERSION_RANGE="${scaffoldRange}" does not satisfy\n` +
      `  current @axia/mcp-server@${serverPkgVersion}.\n` +
      `  Bump MCP_SERVER_VERSION_RANGE in packages/create-axia-mcp/src/scaffold.ts.`,
  );
}

// (c) ADR-044 P29.1 lockstep: package.json versions must match
const scaffoldPkg = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'packages/create-axia-mcp/package.json'),
    'utf8',
  ),
);
if (scaffoldPkg.version !== serverPkgVersion) {
  fail(
    `Lockstep violation (P29.1):\n` +
      `  @axia/mcp-server: ${serverPkgVersion}\n` +
      `  create-axia-mcp:  ${scaffoldPkg.version}\n` +
      `  Bump both to the same version in a single commit.`,
  );
}

process.stderr.write(
  green('[verify-schema-pin] OK — ') +
    `engine ${wasmSchema}, server schema ${serverSchema}, ` +
    `pkg ${serverPkgVersion}, scaffold range ${scaffoldRange}\n`,
);
process.exit(0);
