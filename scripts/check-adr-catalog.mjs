#!/usr/bin/env node
// scripts/check-adr-catalog.mjs
//
// ADR Catalog Sync Check — Phase 4 of LOCKED #66 (ADR-164 Sunset Policy).
//
// Purpose:
//   docs/adr/*.md  ↔  docs/adr/README.md catalog  drift detection.
//   Every ADR file (NNN-*.md) must be referenced in README.md via
//   a markdown link `[NNN](./NNN-*.md)`. Missing entries fail CI.
//
// Anchor: reports/ADR_141_옵션4_6_TaskBrief.html §1 (c) + 메타-원칙 #6
// (Preventive over Curative — drift 재발 방지) + LOCKED #44 (Complete
// Meaning per Merge — catalog drift 는 atomic 의미 단위).
//
// Exit codes:
//   0 — catalog정합 (모든 ADR file 이 README 에 listed)
//   1 — drift 발견 (missing ADRs)
//   2 — script error (file read 실패 등)
//
// Usage:
//   node scripts/check-adr-catalog.mjs
//   npm run check:adr (if wired into package.json)
//
// Cross-link:
//   ADR-164 (Sunset Policy + 표준 3-Status)
//   LOCKED #66 (ADR-164 LOCKED 안내)
//   .github/workflows/adr-catalog-check.yml (CI integration)

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADR_DIR = resolve(__dirname, '..', 'docs', 'adr');
const README_PATH = join(ADR_DIR, 'README.md');

/**
 * Extract ADR file numbers from `docs/adr/NNN-*.md` filenames.
 * @returns {Promise<Set<string>>} 3-digit zero-padded ADR numbers
 */
async function extractAdrFileNumbers() {
  const entries = await readdir(ADR_DIR, { withFileTypes: true });
  const numbers = new Set();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = /^(\d{3})-.+\.md$/.exec(entry.name);
    if (m) numbers.add(m[1]);
  }
  return numbers;
}

/**
 * Extract ADR numbers referenced in README catalog.
 * Pattern: markdown link `[NNN](./NNN-*.md)` — strict 3-digit form.
 * @returns {Promise<Set<string>>}
 */
async function extractReadmeAdrNumbers() {
  const text = await readFile(README_PATH, 'utf-8');
  const numbers = new Set();
  // Match markdown link with 3-digit ADR number in label position
  const linkPattern = /\[(\d{3})\]\(\.\/\d{3}-[\w-]+\.md\)/g;
  let m;
  while ((m = linkPattern.exec(text)) !== null) {
    numbers.add(m[1]);
  }
  return numbers;
}

/**
 * Diff: ADR files - README listed = missing entries.
 * @param {Set<string>} files
 * @param {Set<string>} listed
 * @returns {string[]} sorted list of missing ADR numbers
 */
function diffMissing(files, listed) {
  const missing = [];
  for (const num of files) {
    if (!listed.has(num)) missing.push(num);
  }
  return missing.sort();
}

/**
 * Diff: README listed - ADR files = broken references.
 * @param {Set<string>} files
 * @param {Set<string>} listed
 * @returns {string[]} sorted list of broken ref ADR numbers
 */
function diffBroken(files, listed) {
  const broken = [];
  for (const num of listed) {
    if (!files.has(num)) broken.push(num);
  }
  return broken.sort();
}

async function main() {
  let files, listed;
  try {
    files = await extractAdrFileNumbers();
    listed = await extractReadmeAdrNumbers();
  } catch (err) {
    console.error('[check-adr-catalog] FATAL — file read failed:', err.message);
    process.exit(2);
  }

  const missing = diffMissing(files, listed);
  const broken = diffBroken(files, listed);

  console.log(`[check-adr-catalog] Scanning: ${ADR_DIR}`);
  console.log(`[check-adr-catalog] ADR files found:        ${files.size}`);
  console.log(`[check-adr-catalog] README catalog entries: ${listed.size}`);

  let exitCode = 0;

  if (missing.length > 0) {
    console.error('');
    console.error(`[check-adr-catalog] ✗ DRIFT DETECTED — ${missing.length} ADR file(s) NOT in README catalog:`);
    for (const num of missing) {
      console.error(`  - ADR-${num} (file present, README entry missing)`);
    }
    console.error('');
    console.error('  Fix: add `| [NNN](./NNN-*.md) | Title | Status |` row to docs/adr/README.md');
    console.error('  Policy: LOCKED #66 (ADR-164 Sunset Policy) — catalog drift 0 강제');
    exitCode = 1;
  }

  if (broken.length > 0) {
    console.error('');
    console.error(`[check-adr-catalog] ✗ BROKEN REFS — ${broken.length} README entry references missing file(s):`);
    for (const num of broken) {
      console.error(`  - ADR-${num} (README references, file missing)`);
    }
    console.error('');
    console.error('  Fix: remove stale entry from README, or restore the missing ADR file.');
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log('[check-adr-catalog] ✓ Catalog정합 — all ADR files listed, no broken refs.');
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[check-adr-catalog] FATAL unhandled:', err);
  process.exit(2);
});
