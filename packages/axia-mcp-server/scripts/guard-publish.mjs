#!/usr/bin/env node
// ADR-044 P29.6 — Publish environment guard.
//
// Refuses local `npm publish` runs. Only allows publishing from CI
// (where provenance attestation is enforced by GitHub Actions).
//
// Bypass for emergency local publish: AXIA_PUBLISH_BYPASS=1
// (do NOT set this casually — bypassing skips supply-chain provenance).

const isCI =
  process.env.CI === 'true' ||
  process.env.CI === '1' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.AXIA_PUBLISH_BYPASS === '1';

if (!isCI) {
  process.stderr.write(
    '\n' +
      '\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n' +
      '\x1b[31m[axia-publish-guard] Refusing local npm publish (ADR-044 P29.6).\x1b[0m\n' +
      '\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n' +
      '\n' +
      '  Publishing must happen via GitHub Actions release.yml workflow,\n' +
      '  which records provenance attestations on the package metadata.\n' +
      '\n' +
      '  Trigger a release:\n' +
      '    1. Push a `release/v*` tag, OR\n' +
      '    2. Run the "Release" workflow manually from the Actions tab.\n' +
      '\n' +
      '  Emergency bypass (skips provenance — use only if you understand the trade-off):\n' +
      '    AXIA_PUBLISH_BYPASS=1 npm publish ...\n' +
      '\n',
  );
  process.exit(1);
}

process.stderr.write(
  '[axia-publish-guard] CI environment detected — proceeding.\n',
);
process.exit(0);
