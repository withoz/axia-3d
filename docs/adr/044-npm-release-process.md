# ADR-044: AxiA npm Release Process

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #22
**Initiative**: AxiA MCP adoption activation
**Builds on**: ADR-041 P26.2 (Schema Versioning), ADR-043 P28 (Scaffold)

## Context

ADR-043 의 `npm create axia-mcp` scaffold 가 동작하려면 **세 npm
package 가 publish** 되어야 함:

1. `@axia/wasm-node` — headless WASM bundle (Rust → wasm-pack 산출물)
2. `@axia/mcp-server` — MCP server (TypeScript)
3. `create-axia-mcp` — scaffold CLI (현재 worktree)

현재 모든 package 가 `private: true` 또는 metadata 부재로 publish
불가. naive 한 publish 시도 시 다음 위험:

### 위험

- 🔴 **Schema drift**: `@axia/wasm-node@1.2.3` 와 `@axia/mcp-server@1.0.0`
  의 `schema_version` 호환성이 publish 시점에 검증 안 됨
- 🔴 **Stale WASM**: `@axia/wasm-node` publish 시 stale `dist/` 산출물
  포함 → engine_version mismatch
- 🔴 **Versioning chaos**: 3 package 가 독립 semver → 사용자가 호환
  matrix 학습해야 함
- 🔴 **License / repository 누락**: npm 정책 위반 + adoption 신뢰 ↓
- 🔴 **dist/ 미포함 / 과포함**: `files: []` 잘못 설정 시 publish 안 됨
- 🔴 **Provenance / supply-chain**: npm provenance 미설정 → 설치자가
  artifact 검증 불가
- 🔴 **2FA / token 노출**: README 에 publish 명령 noting 없음

### 산업 표준

- monorepo 일제 release: `changesets` (Vite, Astro), `lerna publish`,
  `release-please` (Google)
- provenance: GitHub Actions 의 `id-token: write` + `npm publish
  --provenance`
- prepublishOnly hook: build + test 강제

## Decision

### P29 — 새 원칙: Synchronized Schema Release

> **세 package 의 publish 는 항상 동시에 (`changesets` orchestration),
> 동일 commit 에서, schema_version 호환성을 사전 검증한 후 진행한다.
> 모든 publish 는 `prepublishOnly` hook 으로 build + test + handshake
> 검증을 강제. CI 환경 (`id-token: write`) 외에서 publish 시도 시 fail.**

### P29 세부 규칙 (7 항목)

**P29.1 — 단일 release matrix**

세 package 의 semver 는 **lockstep**:

```
@axia/wasm-node       0.1.0
@axia/mcp-server      0.1.0
create-axia-mcp       0.1.0
```

새 release 마다 셋 다 동일 버전으로 bump. 다른 reason (예: scaffold 만
fix) 도 셋 다 PATCH 올림. 사용자 mental model 단순화 + drift 차단.

**P29.2 — `prepublishOnly` 강제 검증**

각 package.json 의 scripts 에:

```jsonc
{
  "scripts": {
    "prepublishOnly": "npm run build && npm test && npm run check:schema-pin",
    "check:schema-pin": "node scripts/verify-schema-pin.mjs"
  }
}
```

`verify-schema-pin.mjs` 는 다음 검증:
- `@axia/mcp-server` 의 `MCP_SERVER_SCHEMA_VERSION` ↔ `@axia/wasm-node`
  의 exported `SCHEMA_VERSION` 이 `^MAJOR.MINOR` 호환 (P26.2)
- `create-axia-mcp` 의 `MCP_SERVER_VERSION_RANGE` 가 publish 대상
  `@axia/mcp-server` 버전을 satisfy

mismatch 시 publish 거부 (exit 1).

**P29.3 — npm scope 와 access**

- `@axia/wasm-node` — public, scoped. `--access public` 필수.
- `@axia/mcp-server` — public, scoped. `--access public` 필수.
- `create-axia-mcp` — public, unscoped (npm create 컨벤션).

`npm/@axia` org 등록은 별도 administrative step. 현재 배포 차단 시
`@axia-3d/*` 또는 `axia-3d-*` prefix 로 fallback (ADR-044.1 amendment).

**P29.4 — Required metadata**

모든 package.json 에 다음 필드 강제:

```jsonc
{
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/withoz/axia-3d.git",
    "directory": "packages/<name>"
  },
  "author": "WYKO <withoz1111@gmail.com>",
  "homepage": "https://github.com/withoz/axia-3d#readme",
  "bugs": {
    "url": "https://github.com/withoz/axia-3d/issues"
  },
  "keywords": ["axia-3d", "cad", "mcp", "model-context-protocol"]
}
```

`@axia/wasm-node` 는 wasm-pack 의 `[package.metadata.wasm-pack]` 으로
관리 (별도 Cargo.toml).

**P29.5 — `files` 화이트리스트**

`files: []` 명시 — npm publish 가 포함할 정확한 경로:

| Package | files |
|---|---|
| `@axia/wasm-node` | `axia_wasm_bg.wasm`, `axia_wasm.js`, `axia_wasm.d.ts`, `README.md` |
| `@axia/mcp-server` | `dist/`, `scripts/check-wasm.mjs`, `README.md` |
| `create-axia-mcp` | `dist/`, `src/template/`, `README.md` |

테스트 코드 / src TypeScript / package-lock.json 등 제외.

**P29.6 — Publish 환경 강제**

- 로컬 `npm publish` 거부 — `prepublishOnly` 가 `process.env.CI` 검사
- GitHub Actions workflow `release.yml` 만 publish 가능
- workflow 는 `permissions: id-token: write` 로 npm provenance attestation
- token: `NPM_TOKEN` repository secret (org-wide token, 2FA 우회 안 함 —
  publish-only restricted scope)

**P29.7 — 회귀 테스트** (절대 #[ignore] 금지)

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `release_metadata_complete` | 모든 package 가 license / repository / author 필드 존재 |
| 2 | `release_files_whitelist_present` | files 배열 비어있지 않음 |
| 3 | `release_lockstep_versions` | 세 package 의 version 동일 (string equality) |
| 4 | `release_prepublish_hook_present` | scripts.prepublishOnly 정의됨 |
| 5 | `release_schema_pin_consistent` | MCP_SERVER_SCHEMA_VERSION ↔ MCP_SERVER_VERSION_RANGE ↔ WASM SCHEMA_VERSION 일치 |
| 6 | `release_no_private_flag_on_publishables` | 세 package 모두 `private: false` 또는 미설정 |

## Implementation

### 변경할 파일

```
packages/axia-mcp-server/package.json    — metadata + prepublishOnly + private:false
packages/create-axia-mcp/package.json    — metadata + prepublishOnly + private:false
packages/axia-mcp-server/scripts/verify-schema-pin.mjs (NEW)
packages/release-meta.test.ts            — 6 회귀 테스트 (NEW, root-level)
crates/axia-wasm/Cargo.toml              — license + repository
.github/workflows/release.yml            — provenance publish workflow (skeleton)
```

axia-wasm-node 의 package.json 은 wasm-pack 자동 생성 — Cargo.toml 의
`[package.metadata.wasm-pack.profile.release]` 또는 post-build patch
스크립트로 수정.

### 본 PR scope

**디자인 + 구성만**. 실제 `npm publish` 명령은 사용자가 npm/@axia org
admin 권한 확보 + repository secret 설정 후 별도 trigger.

본 commit:
- ADR-044 결정 고정
- package.json metadata + prepublishOnly + files 화이트리스트
- verify-schema-pin.mjs 스크립트
- release-meta.test.ts 6 회귀
- (선택) release.yml skeleton workflow

## Risks & Mitigations

- **R1** — npm `@axia` scope unavailable: amendment ADR-044.1 (재명명)
  + scaffold 의 MCP_SERVER_VERSION_RANGE 도 동시 갱신 필요
- **R2** — 사용자 npm publish 시 lockstep 위반: P29.7 회귀 + CI block
- **R3** — Engine MAJOR bump 시 server / scaffold 도 bump 필요: P29.1
  수동 절차 + commit message convention
- **R4** — provenance 설정 누락 시 supply-chain 신뢰 ↓: workflow 의
  `id-token: write` 권한 필수 (P29.6)
- **R5** — wasm-pack 자동 생성 package.json 이 P29.4 metadata 못 받음:
  Cargo.toml `[package.metadata.wasm-pack.profile.release]` 또는 별도
  patch 스크립트 (`scripts/patch-wasm-package.mjs` follow-up)

## Success Criteria

- ✅ ADR-044 P29 결정 commit (이 PR)
- ✅ 3 package metadata 통일 (license MIT / repository / keywords / files /
  publishConfig provenance + access)
- ✅ `verify-schema-pin.mjs` (3-source 일관성) + `guard-publish.mjs`
  (CI-only enforcement)
- ✅ `prepublishOnly` hook 모든 publishable 에 추가 (build + test +
  schema-pin)
- ✅ `release-meta.test.ts` 6 회귀 + 보너스 publishConfig 검증
  통과 (12 / 12)
- ✅ `.github/workflows/release.yml` skeleton (provenance + lockstep
  publish, gated by `inputs.publish`)
- ⏳ 실제 첫 publish (별도 release tag + `NPM_TOKEN` secret + admin
  권한 + manual trigger)
- ⏳ npm `@axia` org 등록 (실패 시 ADR-044.1 amendment)

## References

- ADR-041 P26.2 (Schema Versioning), P26.7 (Audit Trail)
- ADR-043 P28 (Scaffold caret-range pin)
- npm provenance: <https://docs.npmjs.com/generating-provenance-statements>
- changesets monorepo orchestration: <https://github.com/changesets/changesets>
- 메타-원칙 #5 (사용자 편의), #10 (ADR 불변)

## 변경 이력

- **2026-05-02 (initial + accepted)**: P29 + LOCKED #22. 7 세부 규칙
  (lockstep semver / prepublishOnly / scope / metadata / files /
  CI-only / 6 회귀). 본 PR 은 publish *config + 회귀* — 실제 npm
  publish 는 admin 권한 + secret 확보 후 별도 trigger.
  - 구현 산출물:
    * 3 package.json metadata (license/repository/keywords/files/
      publishConfig provenance+access) 통일
    * scripts/guard-publish.mjs (CI-only enforcement, AXIA_PUBLISH_BYPASS
      escape hatch)
    * scripts/verify-schema-pin.mjs (engine SCHEMA_VERSION ↔ server
      MCP_SERVER_SCHEMA_VERSION ↔ scaffold MCP_SERVER_VERSION_RANGE
      3-source 검증)
    * test/release_meta.test.ts (12 tests passing)
    * .github/workflows/release.yml (preflight + publish jobs,
      `id-token: write` for provenance, gated by inputs.publish)
  - 검증: 131 / 131 MCP server tests, schema-pin OK, guard refuses
    local publish (exit 1) but allows CI (exit 0).
