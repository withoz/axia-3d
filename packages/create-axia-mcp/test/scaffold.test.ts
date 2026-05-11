// ADR-043 P28.5 — 5 regression tests for `create-axia-mcp` scaffold.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScaffold,
  sanitizeProjectName,
  MCP_SERVER_VERSION_RANGE,
} from '../src/scaffold.js';
import { writeScaffoldToDisk } from '../src/index.js';

describe('ADR-043 P28.1 — scaffold creates minimal files only', () => {
  it('scaffold_creates_minimal_files — exactly 4 paths', () => {
    const files = buildScaffold({ projectName: 'my-axia-app' });
    expect([...files.keys()].sort()).toEqual([
      'README.md',
      'axia-mcp.config.json',
      'claude_desktop_config.snippet.json',
      'package.json',
    ]);
  });

  it('scaffold_does_not_duplicate_handlers — no capability code in output', () => {
    const files = buildScaffold({ projectName: 'app' });
    for (const [path, content] of files) {
      // Capability handler signatures (e.g. "function drawRectCapability"
      // or "draw_rect:" object literals) MUST NOT appear in scaffold.
      expect(content, `${path} must not embed handler code`).not.toMatch(
        /drawRectCapability|drawCircleCapability|pushPullCapability/,
      );
      // Zod schema definitions also forbidden in the scaffold.
      expect(content, `${path} must not embed Zod schemas`).not.toMatch(
        /z\.object\(\{|new ZodObject|\bz\.string\(\)/,
      );
    }
  });
});

describe('ADR-043 P28.2 — schema version pinning', () => {
  it('scaffold_pins_caret_range — package.json uses ^semver', () => {
    const files = buildScaffold({ projectName: 'pin-test' });
    const pkg = JSON.parse(files.get('package.json')!);
    expect(pkg.dependencies['@axia/mcp-server']).toBe(MCP_SERVER_VERSION_RANGE);
    // Sanity: caret-range matches the semver pattern
    expect(pkg.dependencies['@axia/mcp-server']).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it('localServerPath option overrides to file: link', () => {
    const files = buildScaffold({
      projectName: 'local',
      localServerPath: '../../../packages/axia-mcp-server',
    });
    const pkg = JSON.parse(files.get('package.json')!);
    expect(pkg.dependencies['@axia/mcp-server']).toMatch(/^file:/);
  });
});

describe('ADR-043 P28.5 #3 — config schema validation', () => {
  it('scaffold_config_passes_schema_validation — valid JSON, expected fields', () => {
    const files = buildScaffold({
      projectName: 'cfg-test',
      enabledTiers: [0, 1, 2],
      allowCaps: ['push_pull'],
      denyCaps: ['boolean_subtract'],
      client: 'claude-desktop',
    });
    const cfg = JSON.parse(files.get('axia-mcp.config.json')!);
    expect(cfg.enabled_tiers).toEqual([0, 1, 2]);
    expect(cfg.allow_caps).toEqual(['push_pull']);
    expect(cfg.deny_caps).toEqual(['boolean_subtract']);
    expect(cfg.client).toBe('claude-desktop');
  });

  it('default config matches ADR-041 default tier set', () => {
    const files = buildScaffold({ projectName: 'def' });
    const cfg = JSON.parse(files.get('axia-mcp.config.json')!);
    expect(cfg.enabled_tiers).toEqual([0, 1]);
    expect(cfg.allow_caps).toEqual([]);
    expect(cfg.deny_caps).toEqual([]);
  });

  it('Claude Desktop snippet uses npx + project name as MCP key', () => {
    const files = buildScaffold({ projectName: 'my-app-foo' });
    const snippet = JSON.parse(files.get('claude_desktop_config.snippet.json')!);
    expect(snippet.mcpServers['my-app-foo']).toBeDefined();
    expect(snippet.mcpServers['my-app-foo'].command).toBe('npx');
    expect(snippet.mcpServers['my-app-foo'].args).toEqual(['axia-mcp-server']);
  });
});

describe('project name sanitization', () => {
  it('accepts valid npm names', () => {
    expect(sanitizeProjectName('my-axia-app')).toBe('my-axia-app');
    expect(sanitizeProjectName('foo.bar_baz-9')).toBe('foo.bar_baz-9');
  });

  it('rejects empty / whitespace', () => {
    expect(() => sanitizeProjectName('')).toThrow(/empty/);
    expect(() => sanitizeProjectName('   ')).toThrow(/empty/);
  });

  it('rejects uppercase / spaces', () => {
    expect(() => sanitizeProjectName('My App')).toThrow(/Invalid/);
    expect(() => sanitizeProjectName('MyApp')).toThrow(/Invalid/);
  });

  it('rejects names starting with . or _', () => {
    expect(() => sanitizeProjectName('.hidden')).toThrow(/Invalid/);
    expect(() => sanitizeProjectName('_priv')).toThrow(/Invalid/);
  });

  it('rejects > 214 chars (npm rule)', () => {
    expect(() => sanitizeProjectName('a'.repeat(215))).toThrow(/214/);
  });
});

describe('ADR-043 P28.5 #5 — disk write smoke', () => {
  it('scaffold_init_smoke_runs — writes 4 files to fresh directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axia-mcp-scaffold-'));
    try {
      const target = join(tmp, 'my-test-app');
      const files = buildScaffold({ projectName: 'my-test-app' });
      const { written, skipped } = writeScaffoldToDisk(target, files, false);
      expect(written.sort()).toEqual([
        'README.md',
        'axia-mcp.config.json',
        'claude_desktop_config.snippet.json',
        'package.json',
      ]);
      expect(skipped).toEqual([]);
      // All files actually exist on disk
      for (const f of written) {
        expect(existsSync(join(target, f))).toBe(true);
      }
      // package.json is parseable JSON
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('my-test-app');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips existing files without --force', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axia-mcp-scaffold-'));
    try {
      const target = join(tmp, 'app');
      const files = buildScaffold({ projectName: 'app' });
      writeScaffoldToDisk(target, files, false);
      // Run again without force
      const second = writeScaffoldToDisk(target, files, false);
      expect(second.skipped.length).toBe(4);
      expect(second.written.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--force overwrites', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axia-mcp-scaffold-'));
    try {
      const target = join(tmp, 'app');
      const files = buildScaffold({ projectName: 'app' });
      writeScaffoldToDisk(target, files, false);
      const second = writeScaffoldToDisk(target, files, true);
      expect(second.skipped).toEqual([]);
      expect(second.written.length).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('README content', () => {
  it('mentions current tier set in the body', () => {
    const files = buildScaffold({
      projectName: 'r1',
      enabledTiers: [0, 1, 2],
    });
    const readme = files.get('README.md')!;
    expect(readme).toMatch(/0, 1, 2/);
    expect(readme).toMatch(/AXIA_MCP_TIERS/);
    expect(readme).toMatch(/ADR-041/);
    expect(readme).toMatch(/ADR-042/);
    expect(readme).toMatch(/ADR-043/);
  });

  it('lists 5 quickstart steps', () => {
    const files = buildScaffold({ projectName: 'r2' });
    const readme = files.get('README.md')!;
    // Steps 1..5 all present
    for (let i = 1; i <= 5; i++) {
      expect(readme).toMatch(new RegExp(`^\\s*${i}\\. \\*\\*`, 'm'));
    }
  });
});
