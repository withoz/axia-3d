#!/usr/bin/env node
// ADR-041 follow-up — postinstall WASM presence check.
//
// Runs after `npm install` to verify the headless engine WASM is built.
// MUST exit 0 even on failure — npm install should not fail just because
// the user has not yet run `npm run wasm:build:nodejs` (Rust toolchain
// may be unavailable, e.g. on a verifier-only machine).
//
// Prints a friendly hint to stderr so the user knows what to do.

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const wasmJs = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm.js');
const wasmBg = resolve(__dirname, '../../axia-wasm-node/dist/axia_wasm_bg.wasm');

function bytesToKb(n) {
  return (n / 1024).toFixed(1);
}

function checkArtifact() {
  if (!existsSync(wasmJs) || !existsSync(wasmBg)) {
    return { ok: false, reason: 'missing' };
  }
  const stat = statSync(wasmBg);
  if (stat.size < 100_000) {
    // wasm should be at least a few hundred KB; truncated artifact is suspicious
    return { ok: false, reason: 'truncated', size: stat.size };
  }
  return { ok: true, size: stat.size };
}

const result = checkArtifact();

if (result.ok) {
  process.stderr.write(
    `[axia-mcp-server] WASM artifact OK — ${bytesToKb(result.size)} KB at ${wasmBg}\n`,
  );
  process.exit(0);
}

const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

process.stderr.write(
  yellow('━'.repeat(72)) + '\n' +
  yellow('[axia-mcp-server] WARNING: headless engine WASM not built.') + '\n' +
  yellow('━'.repeat(72)) + '\n' +
  '\n' +
  '  Reason: ' + (result.reason === 'missing'
    ? 'artifact missing at ' + wasmBg
    : 'artifact truncated (' + bytesToKb(result.size ?? 0) + ' KB)') + '\n' +
  '\n' +
  '  The MCP server cannot start until the WASM is built. Build it now:\n' +
  '\n' +
  cyan('    cd ../../web && npm run wasm:build:nodejs') + '\n' +
  '\n' +
  '  Requires Rust + wasm-pack. Install:\n' +
  '    https://rustwasm.github.io/wasm-pack/installer/\n' +
  '\n' +
  '  This warning does NOT fail npm install — you may need it on machines\n' +
  '  without a Rust toolchain. Once the WASM is in place, the warning\n' +
  '  disappears.\n' +
  yellow('━'.repeat(72)) + '\n',
);

// Always exit 0 — npm install must succeed.
process.exit(0);
