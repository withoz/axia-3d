/**
 * ADR-124 — WASM SIMD activation regression guard (β implementation §B L-124-3).
 *
 * Source-level regression test that runs without WASM build artifacts.
 * Catches:
 *   - `.cargo/config.toml` deletion / corruption
 *   - `+simd128` flag removal in a PR
 *   - `[target.wasm32-unknown-unknown]` section header rename
 *
 * This guard is *complementary* to `web/scripts/verify-simd.mjs` which is
 * the post-build evidence check. This vitest test runs in *every* CI job
 * regardless of whether WASM was built (vitest runs without needing
 * wasm-pack output, per vitest.config.ts alias mock).
 *
 * Cross-link:
 *   - ADR-124 §B L-124-3 (SIMD activation regression guard)
 *   - ADR-123 §2 Option D (1st recommendation)
 *   - .cargo/config.toml (SSOT — failure here means it was modified)
 *   - web/scripts/verify-simd.mjs (post-build binary evidence)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const CARGO_CONFIG = resolve(__dirname, '../../../.cargo/config.toml');

describe('ADR-124 — WASM SIMD activation (.cargo/config.toml SSOT)', () => {
  it('.cargo/config.toml exists at repository root', () => {
    expect(existsSync(CARGO_CONFIG)).toBe(true);
  });

  it('contains [target.wasm32-unknown-unknown] section', () => {
    const cfg = readFileSync(CARGO_CONFIG, 'utf-8');
    expect(cfg).toContain('[target.wasm32-unknown-unknown]');
  });

  it('contains "+simd128" target-feature flag', () => {
    const cfg = readFileSync(CARGO_CONFIG, 'utf-8');
    // Accept both quoted and unquoted forms — both valid in TOML rustflags.
    expect(
      cfg.includes('target-feature=+simd128') ||
        cfg.includes('target-feature="+simd128"'),
    ).toBe(true);
  });

  it('contains rustflags = [...] form (array, not string)', () => {
    // Cargo requires array form for [target.<triple>] rustflags
    // (string form is unstable and not honored). Drift guard.
    const cfg = readFileSync(CARGO_CONFIG, 'utf-8');
    expect(cfg).toMatch(/rustflags\s*=\s*\[/);
  });

  it('contains ADR-124 reference comment (drift documentation)', () => {
    // The config file's purpose must be self-explanatory to future
    // maintainers. ADR-124 reference + cross-link to ADR-123.
    const cfg = readFileSync(CARGO_CONFIG, 'utf-8');
    expect(cfg).toContain('ADR-124');
    expect(cfg).toContain('ADR-123');
  });

  it('does NOT introduce other target overrides that could break native builds', () => {
    // Defense in depth: ADR-124 only intends wasm32-unknown-unknown
    // override. If other targets get added inadvertently (e.g.,
    // x86_64-unknown-linux-gnu), native cargo test would be affected.
    // This guard catches accidental scope creep.
    const cfg = readFileSync(CARGO_CONFIG, 'utf-8');
    const targetSections = cfg.match(/^\[target\.[^\]]+\]/gm) ?? [];
    expect(targetSections.length).toBe(1);
    expect(targetSections[0]).toBe('[target.wasm32-unknown-unknown]');
  });
});
