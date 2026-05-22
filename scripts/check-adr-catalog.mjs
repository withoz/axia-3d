#!/usr/bin/env node
// ADR catalog drift detector (Sprint 0 cleanup follow-up, 2026-05-22).
//
// 메타-원칙 #6 (Preventive over Curative) — README catalog ↔ docs/adr/
// drift 재발 방지. PR 마다 CI 가 자동 검증.
//
// 검증 항목 (모두 통과해야 exit 0):
//   1. docs/adr/*.md (README + STATUS-POLICY 제외) 모든 ADR 가 README catalog 에 등재
//   2. README catalog 의 모든 link 가 실제 file 을 가리킴 (broken link 0)
//   3. 모든 ADR 의 Status 첫 token 이 canonical 5-state 중 하나
//      (Proposed / Draft / Accepted / Deferred / Superseded)
//      — STATUS-POLICY.md §2 정합
//
// Usage:
//   node scripts/check-adr-catalog.mjs
//
// Exit codes:
//   0 — 모든 검증 통과
//   1 — drift 감지 (missing / broken / non-canonical Status)
//
// Cross-link:
//   - docs/adr/STATUS-POLICY.md (canonical Status notation SSOT)
//   - docs/adr/README.md (catalog)
//   - LOCKED #44 (Complete Meaning per Merge — 본 PR scope 한정)
//   - LOCKED #66 (가칭 — STATUS-POLICY enforcement)
//   - 메타-원칙 #6 (Preventive over Curative)

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
const README_PATH = join(ADR_DIR, 'README.md');

const SKIP_FILES = new Set(['README.md', 'STATUS-POLICY.md']);
const CANONICAL_STATES = new Set([
  'Proposed',
  'Draft',
  'Accepted',
  'Deferred',
  'Superseded',
]);

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// --- Step 1: Read ADR file list ---
const allEntries = await readdir(ADR_DIR, { withFileTypes: true });
const adrFiles = allEntries
  .filter((e) => e.isFile() && e.name.endsWith('.md') && !SKIP_FILES.has(e.name))
  .map((e) => e.name);

// Extract unique ADR numbers (e.g. 139-* files share number 139)
const adrNumbers = new Set();
const filesByNumber = new Map(); // number → [filenames]
for (const f of adrFiles) {
  const m = f.match(/^(\d+)-/);
  if (!m) {
    warn(`Filename does not start with NNN-: ${f}`);
    continue;
  }
  const num = m[1];
  adrNumbers.add(num);
  if (!filesByNumber.has(num)) filesByNumber.set(num, []);
  filesByNumber.get(num).push(f);
}

// --- Step 2: Read README catalog ---
const readme = await readFile(README_PATH, 'utf-8');

// Parse catalog links: [NNN](./NNN-slug.md)
const linkRe = /\[(\d+)\]\(\.\/(\d+-[^)]+\.md)\)/g;
const catalogLinks = new Map(); // ADR number → linked filename
let match;
while ((match = linkRe.exec(readme)) !== null) {
  const num = match[1];
  const filename = match[2];
  if (!catalogLinks.has(num)) catalogLinks.set(num, []);
  catalogLinks.get(num).push(filename);
}

// --- Step 3: Verify all ADR files have catalog entry ---
for (const num of adrNumbers) {
  if (!catalogLinks.has(num)) {
    err(`MISSING catalog entry: ADR-${num} (files: ${filesByNumber.get(num).join(', ')})`);
  }
}

// --- Step 4: Verify catalog links point to actual files ---
const adrFileSet = new Set(adrFiles);
for (const [num, links] of catalogLinks.entries()) {
  for (const linkedFile of links) {
    if (!adrFileSet.has(linkedFile)) {
      err(`BROKEN catalog link: [${num}](./${linkedFile}) — file does not exist`);
    }
  }
}

// --- Step 5: Verify Status canonical first-token (per STATUS-POLICY §2.3) ---
//
// 3 supported formats:
//   - Heading:  **Status**: <token> (...)
//   - List:     - **Status**: <token> (...)
//   - Table:    | Status | **<token> (...)** |
//
// Only the *first* Status occurrence per file is checked (the ADR-level Status).
// Sub-section Status (e.g. Amendment 10) are not enforced here.

const statusFormats = [
  // Heading or list: leading optional "- ", then **Status**:
  /^(?:- )?\*\*[Ss]tatus\*\*\s*:\s*(.*)$/m,
  // Table row: | Status | <content> |
  /^\|\s*[Ss]tatus\s*\|\s*(.*?)\s*\|/m,
];

for (const filename of adrFiles) {
  const content = await readFile(join(ADR_DIR, filename), 'utf-8');
  let statusContent = null;
  for (const re of statusFormats) {
    const m = content.match(re);
    if (m) {
      statusContent = m[1].trim();
      break;
    }
  }
  if (statusContent === null) {
    warn(`No Status field found: ${filename}`);
    continue;
  }
  // Strip all bold markers (** ... **), then take first whitespace-delimited token
  const stripped = statusContent.replace(/\*\*/g, '').trim();
  const firstToken = stripped.split(/[\s,;.(]/)[0];
  if (!CANONICAL_STATES.has(firstToken)) {
    err(`NON-CANONICAL Status first-token: ${filename}\n  Status: ${statusContent.slice(0, 100)}\n  First token: [${firstToken}] (expected one of: ${[...CANONICAL_STATES].join(', ')})`);
  }
}

// --- Report ---
const totalFiles = adrFiles.length;
const totalNumbers = adrNumbers.size;
const totalCatalogRefs = catalogLinks.size;

console.log('ADR Catalog Drift Check (scripts/check-adr-catalog.mjs)');
console.log('========================================================');
console.log(`ADR files (excluding README + STATUS-POLICY): ${totalFiles}`);
console.log(`Unique ADR numbers: ${totalNumbers}`);
console.log(`Catalog references: ${totalCatalogRefs}`);
console.log('');

if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log('');
}

if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log('');
  console.log('Fix guidance:');
  console.log('  - MISSING catalog entry: add the ADR to docs/adr/README.md');
  console.log('  - BROKEN catalog link: update README link to point to actual file');
  console.log('  - NON-CANONICAL Status: update ADR Status to start with one of:');
  console.log(`    ${[...CANONICAL_STATES].join(' / ')}`);
  console.log('  - See docs/adr/STATUS-POLICY.md for canonical notation rules.');
  process.exit(1);
}

console.log('✓ All checks passed.');
process.exit(0);
