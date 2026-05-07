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

  it('ADR-082 L1 lock-in: optionalDep 또는 devDep 으로 등록', () => {
    // 본 lock-in 검증 — web/package.json 의 dependency 등급 정합
    const webPkg = JSON.parse(
      readFileSync(resolve('package.json'), 'utf-8'),
    );
    const inOpt = webPkg.optionalDependencies?.['opencascade.js'];
    const inDev = webPkg.devDependencies?.['opencascade.js'];
    // L1: optionalDep 유지 + devDep 추가
    expect(inOpt).toBeDefined();
    expect(inDev).toBeDefined();
  });

  it('ADR-082 L3 lock-in 회귀 가드: regular dependencies 에는 미포함 (initial bundle 0MB)', () => {
    const webPkg = JSON.parse(
      readFileSync(resolve('package.json'), 'utf-8'),
    );
    // regular dep 에 들어가면 initial bundle 영향 우려 (P20.C #2 위반)
    expect(webPkg.dependencies?.['opencascade.js']).toBeUndefined();
  });
});
