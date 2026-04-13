#!/usr/bin/env node
/**
 * WASM build verification script.
 *
 * Checks that wasm-pack output files are complete and valid.
 * Run after `wasm-pack build` to catch truncation or corruption.
 *
 * Usage: node scripts/verify-wasm.mjs
 */

import { readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = join(__dirname, '..', 'src', 'wasm');

let errors = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✕ ${label}: ${detail}`);
    errors++;
  }
}

console.log('\n🔍 AXiA WASM Build Verification\n');

// ── 1. Check axia_wasm.js ──────────────────────────────────

console.log('📄 axia_wasm.js');
try {
  const jsPath = join(WASM_DIR, 'axia_wasm.js');
  const js = readFileSync(jsPath, 'utf-8');
  const jsSize = statSync(jsPath).size;

  check('File exists and readable', true, '');
  check('File size > 10KB', jsSize > 10000, `Only ${jsSize} bytes`);
  check('Contains "export class AxiaEngine"', js.includes('export class AxiaEngine'), 'Missing AxiaEngine class');
  check('Contains init export', js.includes('export default __wbg_init') || js.includes('__wbg_init as default'), 'Missing default export (init function)');
  check('Contains initSync', js.includes('initSync'), 'Missing initSync');
  check('Contains wasm variable', js.includes('let wasm;') || js.includes('let wasm =') || js.includes(', wasm;') || js.includes(', wasm\n'), 'Missing wasm variable');
  check('Contains "function passArray32ToWasm0"', js.includes('passArray32ToWasm0'), 'Missing array passing helper');
  check('Contains "function passStringToWasm0"', js.includes('passStringToWasm0'), 'Missing string passing helper');
  check('Contains "function getObject"', js.includes('function getObject'), 'Missing heap getObject');
  check('Contains "WASM_VECTOR_LEN"', js.includes('WASM_VECTOR_LEN'), 'Missing WASM_VECTOR_LEN');
  check('Contains "function handleError"', js.includes('function handleError'), 'Missing error handler');
  check('Contains "TextDecoder"', js.includes('TextDecoder'), 'Missing text decoder');

  // Check file doesn't end abruptly
  const lastLine = js.trimEnd().split('\n').pop();
  check('File ends cleanly (not truncated)',
    lastLine.includes('export') || lastLine.includes('}') || lastLine.includes(';'),
    `Last line: "${lastLine?.slice(0, 60)}..."`);

  // Check balanced braces
  const openBraces = (js.match(/\{/g) || []).length;
  const closeBraces = (js.match(/\}/g) || []).length;
  check('Balanced braces', Math.abs(openBraces - closeBraces) < 3,
    `Open: ${openBraces}, Close: ${closeBraces}, Diff: ${openBraces - closeBraces}`);

} catch (e) {
  console.error(`  ✕ Cannot read axia_wasm.js: ${e.message}`);
  errors++;
}

// ── 2. Check axia_wasm.d.ts ────────────────────────────────

console.log('\n📄 axia_wasm.d.ts');
try {
  const dtsPath = join(WASM_DIR, 'axia_wasm.d.ts');
  const dts = readFileSync(dtsPath, 'utf-8');

  check('File exists', true, '');
  check('Contains "export class AxiaEngine"', dts.includes('export class AxiaEngine'), 'Missing class');
  check('Contains "export type InitInput"', dts.includes('InitInput'), 'Missing InitInput type');
  check('Contains "export interface InitOutput"', dts.includes('InitOutput'), 'Missing InitOutput interface');
  check('Contains default export', dts.includes('export default function') || dts.includes('export default') || dts.includes('__wbg_init'), 'Missing default export type');
  check('Contains initSync type', dts.includes('initSync'), 'Missing initSync type');

  // Check key methods exist
  const methods = ['push_pull', 'draw_line', 'draw_rect', 'undo', 'redo', 'get_positions', 'get_indices'];
  for (const m of methods) {
    check(`Has method "${m}"`, dts.includes(m), `Missing ${m} declaration`);
  }

} catch (e) {
  console.error(`  ✕ Cannot read axia_wasm.d.ts: ${e.message}`);
  errors++;
}

// ── 3. Check axia_wasm_bg.wasm ─────────────────────────────

console.log('\n📄 axia_wasm_bg.wasm');
try {
  const wasmPath = join(WASM_DIR, 'axia_wasm_bg.wasm');
  const wasmStat = statSync(wasmPath);
  const wasmHead = readFileSync(wasmPath).subarray(0, 4);

  check('File exists', true, '');
  check('File size > 100KB', wasmStat.size > 100000, `Only ${wasmStat.size} bytes`);
  check('WASM magic bytes (\\0asm)', wasmHead[0] === 0 && wasmHead[1] === 0x61 && wasmHead[2] === 0x73 && wasmHead[3] === 0x6d,
    `Got: [${[...wasmHead].map(b => '0x' + b.toString(16)).join(', ')}]`);

} catch (e) {
  console.error(`  ✕ Cannot read axia_wasm_bg.wasm: ${e.message}`);
  errors++;
}

// ── Summary ────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
if (errors === 0) {
  console.log('✅ All WASM verification checks passed!\n');
  process.exit(0);
} else {
  console.error(`❌ ${errors} check(s) failed! WASM files may be corrupted or truncated.\n`);
  process.exit(1);
}
