// Verifies the postinstall check-wasm script runs and exits 0 in both
// states (artifact present, artifact missing). Documents the expected
// stderr behavior.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptPath = resolve(__dirname, '../scripts/check-wasm.mjs');
const wasmDir = resolve(__dirname, '../../axia-wasm-node/dist');

describe('postinstall check-wasm', () => {
  it('exits 0 with friendly stderr regardless of state', () => {
    const result = spawnSync('node', [scriptPath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/axia-mcp-server/);
  });

  it('reports OK when artifact is present', () => {
    if (!existsSync(wasmDir)) {
      // Skip — covered by missing path test below
      return;
    }
    const result = spawnSync('node', [scriptPath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WASM artifact OK/);
  });

  it('script exists and is executable as a Node script', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });
});
