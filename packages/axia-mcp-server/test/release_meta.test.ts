// ADR-044 P29.7 — release metadata regression (6 회귀).
//
// Lives in axia-mcp-server because it has the test infrastructure already.
// Reads sibling packages from the repo root via fs.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = .../packages/axia-mcp-server/test
const repoRoot = resolve(__dirname, '../../..');

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  author?: string;
  homepage?: string;
  repository?: { type: string; url: string; directory?: string } | string;
  bugs?: { url: string } | string;
  keywords?: string[];
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  publishConfig?: { access?: string; provenance?: boolean };
}

interface PublishablePackage {
  /** Folder under packages/ */
  dir: string;
  /** Expected name in package.json */
  expectedName: string;
}

const PUBLISHABLES: PublishablePackage[] = [
  { dir: 'axia-mcp-server', expectedName: '@axia/mcp-server' },
  { dir: 'create-axia-mcp', expectedName: 'create-axia-mcp' },
  // axia-wasm-node is wasm-pack auto-generated and lives at
  // packages/axia-wasm-node/dist/package.json after build. Excluded
  // from this test — covered by a separate post-build patch script.
];

function loadPkg(pkgDir: string): PackageJson {
  const p = resolve(repoRoot, 'packages', pkgDir, 'package.json');
  if (!existsSync(p)) throw new Error(`package.json missing: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('ADR-044 P29.7 — release metadata regression', () => {
  // ────────────────────────────────────────────────────────────
  // P29.7 #1
  // ────────────────────────────────────────────────────────────
  describe('release_metadata_complete', () => {
    for (const { dir, expectedName } of PUBLISHABLES) {
      it(`${dir} has license / repository / author / bugs / homepage / keywords`, () => {
        const pkg = loadPkg(dir);
        expect(pkg.name).toBe(expectedName);
        expect(pkg.license).toBe('MIT');
        expect(pkg.author).toBeDefined();
        expect(pkg.homepage).toMatch(/github\.com/);
        expect(pkg.bugs).toBeDefined();
        expect(pkg.keywords).toBeInstanceOf(Array);
        expect(pkg.keywords!.length).toBeGreaterThan(0);
        if (typeof pkg.repository === 'object') {
          expect(pkg.repository.type).toBe('git');
          expect(pkg.repository.url).toMatch(/github\.com/);
          expect(pkg.repository.directory).toBe(`packages/${dir}`);
        } else {
          throw new Error(`${dir} repository must be object form`);
        }
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // P29.7 #2
  // ────────────────────────────────────────────────────────────
  describe('release_files_whitelist_present', () => {
    for (const { dir } of PUBLISHABLES) {
      it(`${dir} declares non-empty files[] whitelist`, () => {
        const pkg = loadPkg(dir);
        expect(pkg.files).toBeInstanceOf(Array);
        expect(pkg.files!.length).toBeGreaterThan(0);
        // Every publishable must include README.md
        expect(pkg.files).toContain('README.md');
        // None should ship plain src/ (TypeScript source) or test/.
        // create-axia-mcp DOES ship src/template/ — those are runtime
        // assets (intentional, not source).
        for (const f of pkg.files!) {
          expect(f, `${f} smells like TypeScript source`).not.toBe('src');
          expect(f, `${f} smells like TypeScript source`).not.toBe('src/');
          expect(f).not.toBe('test');
          expect(f).not.toBe('test/');
          expect(f, `${f} ships .ts files`).not.toMatch(/\.ts$/);
        }
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // P29.7 #3
  // ────────────────────────────────────────────────────────────
  it('release_lockstep_versions — all publishables share the same version', () => {
    const versions = PUBLISHABLES.map(({ dir }) => loadPkg(dir).version);
    const unique = new Set(versions);
    expect(
      unique.size,
      `Versions diverged: ${versions.join(', ')}. ADR-044 P29.1 demands lockstep.`,
    ).toBe(1);
    // Each must be valid semver
    for (const v of versions) {
      expect(semver.valid(v), `version ${v} invalid`).toBeTruthy();
    }
  });

  // ────────────────────────────────────────────────────────────
  // P29.7 #4
  // ────────────────────────────────────────────────────────────
  describe('release_prepublish_hook_present', () => {
    for (const { dir } of PUBLISHABLES) {
      it(`${dir} has scripts.prepublishOnly`, () => {
        const pkg = loadPkg(dir);
        expect(pkg.scripts?.prepublishOnly).toBeTruthy();
        // Must invoke guard-publish.mjs (even from sibling package)
        expect(pkg.scripts!.prepublishOnly).toMatch(/guard-publish\.mjs/);
        // Must run tests before publishing
        expect(pkg.scripts!.prepublishOnly).toMatch(/npm (run )?test/);
        // Must build before publishing
        expect(pkg.scripts!.prepublishOnly).toMatch(/npm (run )?build/);
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // P29.7 #5
  // ────────────────────────────────────────────────────────────
  it('release_schema_pin_consistent — server schema satisfies ^engine schema', () => {
    // Read engine SCHEMA_VERSION from Rust source.
    const wasmRust = resolve(repoRoot, 'crates/axia-wasm/src/lib.rs');
    const wasmText = readFileSync(wasmRust, 'utf8');
    const wasmMatch = wasmText.match(
      /const\s+SCHEMA_VERSION:\s*&str\s*=\s*"([^"]+)"/,
    );
    expect(wasmMatch, 'engine SCHEMA_VERSION not found').toBeTruthy();
    const wasmSchema = wasmMatch![1]!;

    // Read server MCP_SERVER_SCHEMA_VERSION
    const handshake = resolve(
      repoRoot,
      'packages/axia-mcp-server/src/handshake.ts',
    );
    const serverText = readFileSync(handshake, 'utf8');
    const serverMatch = serverText.match(
      /MCP_SERVER_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/,
    );
    expect(serverMatch, 'MCP_SERVER_SCHEMA_VERSION not found').toBeTruthy();
    const serverSchema = serverMatch![1]!;

    expect(
      semver.satisfies(serverSchema, `^${wasmSchema}`),
      `Server ${serverSchema} must satisfy ^${wasmSchema}`,
    ).toBe(true);

    // Read scaffold MCP_SERVER_VERSION_RANGE
    const scaffold = resolve(
      repoRoot,
      'packages/create-axia-mcp/src/scaffold.ts',
    );
    const scaffoldText = readFileSync(scaffold, 'utf8');
    const scaffoldMatch = scaffoldText.match(
      /MCP_SERVER_VERSION_RANGE\s*=\s*['"]([^'"]+)['"]/,
    );
    expect(scaffoldMatch, 'MCP_SERVER_VERSION_RANGE not found').toBeTruthy();
    const scaffoldRange = scaffoldMatch![1]!;

    // Scaffold range must satisfy current server package version.
    const serverPkg = loadPkg('axia-mcp-server');
    expect(
      semver.satisfies(serverPkg.version, scaffoldRange),
      `Scaffold range "${scaffoldRange}" must satisfy server ${serverPkg.version}`,
    ).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // P29.7 #6
  // ────────────────────────────────────────────────────────────
  describe('release_no_private_flag_on_publishables', () => {
    for (const { dir } of PUBLISHABLES) {
      it(`${dir} has private:false or no private flag`, () => {
        const pkg = loadPkg(dir);
        expect(pkg.private ?? false).toBe(false);
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // Bonus: P29.6 publishConfig provenance + access
  // ────────────────────────────────────────────────────────────
  describe('publishConfig — provenance + public access', () => {
    for (const { dir } of PUBLISHABLES) {
      it(`${dir} declares public access + provenance`, () => {
        const pkg = loadPkg(dir);
        expect(pkg.publishConfig?.access).toBe('public');
        expect(pkg.publishConfig?.provenance).toBe(true);
      });
    }
  });
});
