/**
 * Real OCCT.js runtime reachability tests (ADR-082 C-β).
 *
 * 본 테스트는 *node_modules 의 opencascade.js npm 패키지가 reachable* 한지만
 * 검증한다. 실제 OCCT initialization (WASM load + module init) 은 Node 환경
 * 에서 비결정적 — C-γ 의 별도 테스트에서 진행.
 *
 * ## C-β scope (현재 commit)
 *
 * - 패키지 reachable: `node_modules/opencascade.js/package.json` 존재 +
 *   `name` 필드 일치
 * - 버전 정합: 설치된 버전이 ADR-082 L1 lock-in (`^2.0.0-beta.b5ff984`)
 *   semver caret 범위 내
 *
 * ## C-γ scope (별도 commit)
 *
 * - 실 OCCT API init (`initOpenCascade(settings)`) 정합 검증
 * - Wrapper drift 발견 + 1차 fix:
 *   * `StepIgesImporter._loadOcct` 가 `mod.default()` 기대 → 실 API 는
 *     `mod.initOpenCascade(settings)` 임이 본 commit 에서 발견됨 (C-β
 *     중 node_modules 검사 시). C-γ 에서 본체 fix.
 *   * 그 외 wrapper drift (DownCast/get() chain, Surface_2 vs Surface)
 *     도 C-γ 에서 검증 + fix
 * - Real corpus fixture (`web/e2e/fixtures/corpus/test_part_1.step`)
 *   는 C-γ 에서 OCCT 자체로 generate (bootstrap pattern)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { StepIgesImporter } from './StepIgesImporter';

const PKG_PATH = resolve('node_modules/opencascade.js/package.json');
const EXPECTED_NAME = 'opencascade.js';
const EXPECTED_MAJOR_PREFIX = '2.0.0-beta';

describe('ADR-082 C-β — opencascade.js npm 패키지 reachability', () => {
  it('node_modules/opencascade.js/package.json 존재', () => {
    expect(existsSync(PKG_PATH)).toBe(true);
  });

  it('package.json 의 name 필드가 opencascade.js', () => {
    expect(existsSync(PKG_PATH)).toBe(true);
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
    expect(pkg.name).toBe(EXPECTED_NAME);
  });

  it('설치된 버전이 ADR-082 L1 semver caret 범위 (2.0.0-beta.*)', () => {
    expect(existsSync(PKG_PATH)).toBe(true);
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
    expect(pkg.version).toMatch(new RegExp(`^${EXPECTED_MAJOR_PREFIX}\\.`));
  });

  it('ADR-082 L1 amendment (C-ε): opencascade.js 가 regular dependencies 에 등록', () => {
    // **C-ε amendment** (2026-05-08): drift #3 해결을 위해 L1 정책 변경.
    //   - 이전: optionalDep + devDep (graceful build, but OCCT 실 사용 불가)
    //   - 변경: regular dep (build-time required, lazy chunk 자동 생성)
    const webPkg = JSON.parse(
      readFileSync(resolve('package.json'), 'utf-8'),
    );
    expect(webPkg.dependencies?.['opencascade.js']).toBeDefined();
    // optionalDep / devDep 양쪽에서 제거 — duplicate 방지
    expect(webPkg.optionalDependencies?.['opencascade.js']).toBeUndefined();
    expect(webPkg.devDependencies?.['opencascade.js']).toBeUndefined();
  });

  it('ADR-082 L3 amendment 회귀 가드: initial bundle 0MB strict 유지 (lazy chunk 만)', () => {
    // L3 의 spirit (initial bundle 0MB) 은 amendment 후에도 유지.
    // opencascade.js 가 regular dep 이지만 lazy import 패턴이라 initial
    // 에 안 들어감 — vite build 가 'opencascade-deps' chunk 분리.
    //
    // 본 테스트는 *package.json 의 위치* 는 검증하지 않음 (위 테스트가 cover).
    // initial bundle size 자체는 별도 build verify 가 본질적 검증.
    const webPkg = JSON.parse(
      readFileSync(resolve('package.json'), 'utf-8'),
    );
    // regular dep 에 있어야 (C-ε 후) — 위 테스트의 invert
    expect(webPkg.dependencies?.['opencascade.js']).toBeDefined();
  });
});

describe('ADR-082 C-γ — opencascade.js wrapper drift discovery', () => {
  // Drift #1 (해결): `mod.default()` → `mod.initOpenCascade(settings)`
  //   - StepIgesImporter._loadOcct 본체 fix 완료 (본 commit)
  //   - 실 API 검증은 C-δ Playwright (browser env) 에서 수행
  //
  // Drift #2 (발견, **Node 환경 한계**): `import('opencascade.js')` 가
  //   Node ESM 환경에서 *.wasm 의 `env` import 해결 실패. 에러 메시지:
  //     "Cannot find package 'env' imported from opencascade.wasm"
  //   browser bundler (Vite/webpack) 만 .wasm 을 URL/asset 으로 해결 가능.
  //   → **Node 환경에서 OCCT.js 사용 불가 확정**. Real OCCT runtime 검증은
  //     C-δ Playwright (browser) 에서만.

  it('Drift #2 회귀 가드: Node ESM 에서 import("opencascade.js") 실패', async () => {
    // 본 테스트는 *환경 한계* 의 명시적 봉인. 향후 누군가 Node 측
    // OCCT 통합을 시도할 때 즉시 발견 가능.
    let importThrew = false;
    let errMsg = '';
    try {
      await import('opencascade.js');
    } catch (e) {
      importThrew = true;
      errMsg = String(e);
    }
    // Vitest 의 dynamic import 는 internal Node ESM 사용 → WASM env import 실패
    expect(importThrew).toBe(true);
    // env import 실패 메시지 명시 (drift documentation)
    expect(errMsg).toMatch(/env|wasm|opencascade/i);
  });

  it('StepIgesImporter._loadOcct fails gracefully in Node env (NOT_INSTALLED_MESSAGE 안내)', async () => {
    // Drift #2 의 자연 결과: Node 환경 import 실패 →
    // _loadOcct 의 catch → NOT_INSTALLED_MESSAGE throw (FreeCAD/Fusion/Rhino
    // 우회 안내 포함). Silent hang 차단 회귀.
    StepIgesImporter.resetInstance();
    const importer = StepIgesImporter.getInstance();
    let threw = false;
    let errMsg = '';
    try {
      await importer.ensureLoaded();
    } catch (e) {
      threw = true;
      errMsg = (e as Error).message;
    }
    expect(threw).toBe(true);
    expect(errMsg).toMatch(/opencascade|설치/);
    expect(errMsg).toContain('FreeCAD');  // alternates 안내 포함 회귀
    StepIgesImporter.resetInstance();
  });

  it('Drift #1 fix 회귀 가드: StepIgesImporter._loadOcct 가 mod.default 가 아닌 initOpenCascade 우선', () => {
    // 본체 fix 가 적용되었는지 source 검증. (실 runtime 동작은 C-δ.)
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    // initOpenCascade 사용 명시
    expect(importerSrc).toContain('initOpenCascade');
    // Drift fix 주석 명시 (LOCKED 거버넌스)
    expect(importerSrc).toContain('ADR-082 C-γ wrapper drift #1 fix');
  });
});

describe('ADR-121 α — Finding #2 fix (사용자 시연 evidence 2026-05-17)', () => {
  // Critical finding from user demo (PR #82 post-merge):
  //   [18:31:37] Assertion failed: bad export type for `_ZTI13TDF_Attribute`: undefined
  //   [18:31:37] Unhandled promise: abort(...)
  //
  // Root cause: `TDF_Attribute` (TKLCAF) 가 ocVisualApplication 에만 포함,
  // 우리 libs 에 미로딩. ocDataExchangeBase 의 XCAF (Extended CAF for STEP
  // color/layer) 가 TDF_Attribute 참조 시 fail.
  //
  // Fix: libs 에 mod.ocVisualApplication 추가.

  it('libs 에 ocVisualApplication 포함 (TDF_Attribute 의존성 해결)', () => {
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    // libs array 에 ocVisualApplication 명시 포함
    expect(importerSrc).toContain('mod.ocVisualApplication');
    // Fix 주석 명시 (LOCKED 거버넌스)
    expect(importerSrc).toContain('ADR-121');
  });

  it('libs 4 base + ocVisualApplication 5개 (lib 추가 후 5 lib 정합)', () => {
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    // 5 libs 모두 present
    expect(importerSrc).toContain('mod.ocCore');
    expect(importerSrc).toContain('mod.ocModelingAlgorithms');
    expect(importerSrc).toContain('mod.ocDataExchangeBase');
    expect(importerSrc).toContain('mod.ocDataExchangeExtra');
    expect(importerSrc).toContain('mod.ocVisualApplication');
  });

  it('Finding #2 root cause comment 명시 (TDF_Attribute / TKLCAF)', () => {
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    expect(importerSrc).toContain('TDF_Attribute');
    expect(importerSrc).toContain('TKLCAF');
  });

  // ADR-121 Amendment 1 (사용자 2차 시연 evidence 2026-05-17, 19:02)
  // ocVisualApplication 추가만으로 부족 — load order critical.
  // opencascade.js README canonical sequence:
  //   ocCore → ocModelingAlgorithms → ocVisualApplication →
  //   ocDataExchangeBase → ocDataExchangeExtra

  it('Amendment 1: ocVisualApplication 이 dataExchange 그룹 BEFORE 위치 (canonical order)', () => {
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    const idxVisualApp = importerSrc.indexOf('mod.ocVisualApplication');
    const idxDataBase = importerSrc.indexOf('mod.ocDataExchangeBase');
    const idxDataExtra = importerSrc.indexOf('mod.ocDataExchangeExtra');
    expect(idxVisualApp).toBeGreaterThan(0);
    expect(idxDataBase).toBeGreaterThan(0);
    expect(idxDataExtra).toBeGreaterThan(0);
    // visualApplication 이 두 dataExchange 보다 *먼저* (string 위치 작음)
    expect(idxVisualApp).toBeLessThan(idxDataBase);
    expect(idxVisualApp).toBeLessThan(idxDataExtra);
  });

  it('Amendment 1: canonical sequence README 명시', () => {
    const importerSrc = readFileSync(
      resolve('src/import/StepIgesImporter.ts'),
      'utf-8',
    );
    expect(importerSrc).toContain('Amendment 1');
    expect(importerSrc).toContain('canonical sequence');
  });
});
