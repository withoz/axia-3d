#!/usr/bin/env node
// `npm create axia-mcp <project-name>` — entry point.
//
// Usage:
//   npm create axia-mcp my-mcp-app
//   npx create-axia-mcp my-mcp-app --tiers 0,1,2 --deny-caps boolean_subtract
//
// Writes 4 files (P28.1) into <project-name>/ and prints next-step
// instructions. Does NOT run `npm install` — caller's responsibility
// (so dry-run / inspection-first flows work).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import kleur from 'kleur';
import { buildScaffold, sanitizeProjectName, type ScaffoldOptions } from './scaffold.js';

interface CliArgs {
  projectName: string;
  tiers?: number[];
  allowCaps?: string[];
  denyCaps?: string[];
  client?: string;
  force?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--tiers' || a === '-t') {
      out.tiers = parseIntList(argv[++i]);
    } else if (a === '--allow-caps') {
      out.allowCaps = parseStrList(argv[++i]);
    } else if (a === '--deny-caps') {
      out.denyCaps = parseStrList(argv[++i]);
    } else if (a === '--client') {
      out.client = argv[++i];
    } else if (a === '--force' || a === '-f') {
      out.force = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith('-')) {
      positional.push(a);
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (positional.length === 0) {
    throw new Error('Project name required. Run with --help for usage.');
  }
  if (positional.length > 1) {
    throw new Error(`Too many positional args: ${positional.join(' ')}`);
  }
  return { projectName: positional[0]!, ...out };
}

function parseIntList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number.parseInt(s, 10);
      if (!Number.isInteger(n)) {
        throw new Error(`Bad tier value: "${s}"`);
      }
      return n;
    });
}

function parseStrList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function printHelp(): void {
  process.stdout.write(
    `${kleur.bold('create-axia-mcp')} — Scaffold an AxiA 3D MCP server (ADR-043)\n` +
      '\n' +
      'Usage:\n' +
      '  npm create axia-mcp <project-name> [options]\n' +
      '  npx create-axia-mcp <project-name> [options]\n' +
      '\n' +
      'Options:\n' +
      '  --tiers, -t <list>      Comma-separated enabled tiers (default: 0,1)\n' +
      '  --allow-caps <list>     Additive ALLOW capability list\n' +
      '  --deny-caps <list>      Subtractive DENY capability list\n' +
      '  --client <name>         Audit log client identifier\n' +
      '  --force, -f             Overwrite existing files\n' +
      '  --help, -h              Show this help\n' +
      '\n' +
      'Example:\n' +
      '  npm create axia-mcp my-axia-app -- --tiers 0,1,2 --deny-caps boolean_subtract\n',
  );
}

export function writeScaffoldToDisk(
  targetDir: string,
  files: Map<string, string>,
  force: boolean,
): { written: string[]; skipped: string[] } {
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of files) {
    const abs = join(targetDir, rel);
    if (existsSync(abs) && !force) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    written.push(rel);
  }
  return { written, skipped };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const projectName = sanitizeProjectName(args.projectName);
  const targetDir = resolve(process.cwd(), projectName);

  const opts: ScaffoldOptions = {
    projectName,
    enabledTiers: args.tiers,
    allowCaps: args.allowCaps,
    denyCaps: args.denyCaps,
    client: args.client,
  };
  const files = buildScaffold(opts);
  const { written, skipped } = writeScaffoldToDisk(
    targetDir,
    files,
    args.force ?? false,
  );

  process.stdout.write(
    kleur.green('✓') + ` Scaffolded ${kleur.cyan(projectName)} at ${targetDir}\n`,
  );
  for (const f of written) process.stdout.write(`  + ${f}\n`);
  for (const f of skipped)
    process.stdout.write(kleur.yellow(`  ! ${f} (skipped — use --force to overwrite)\n`));

  process.stdout.write(
    '\n' +
      kleur.bold('Next steps:') +
      '\n' +
      `  cd ${projectName}\n` +
      '  npm install\n' +
      '  npm run check:wasm\n' +
      '  # then copy claude_desktop_config.snippet.json into Claude Desktop config\n',
  );
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('index.js');

if (isDirectInvocation) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(kleur.red(`[create-axia-mcp] ${msg}\n`));
    process.exit(1);
  });
}
