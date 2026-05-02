# ADR-043: `npm create axia-mcp` Init Template

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #21
**Initiative**: AxiA MCP adoption ramp
**Builds on**: ADR-041 P26 (Capability Surface), ADR-042 P27 (ALLOW/DENY)

## Context

ADR-041 의 MCP server 는 동작하지만 **adoption barrier 가 높음**:

1. AxiA repo clone 필요 (수 GB)
2. Rust + wasm-pack 설치 필요
3. 수동 빌드 후 Claude Desktop config 편집
4. 경로 / env / tier 설정 학습 필요

AI client 통합을 시도하는 일반 사용자 (특히 비-Rust 개발자) 에게는 **5분 안에 동작하는 길** 이 필요. 산업 표준은 `npx create-*` / `npm create *` 스캐폴드 — Vite, Next, T3 등 모두 이 패턴.

### 위험 — naive scaffold 의 함정

단순 file copy 스크립트는:
- 🔴 **Stale dependencies**: peer 패키지 버전이 메인 repo 와 drift
- 🔴 **Schema drift**: scaffold 가 ADR-041 P26.2 schema 와 mismatch
- 🔴 **Missing WASM**: scaffold 만 받고 Rust 빌드 단계 안내 부족
- 🔴 **Capability 누락**: ADR-041 surface 에 새 capability 추가 시 scaffold 도 갱신해야

## Decision

### P28 — 새 원칙: Scaffold = Self-contained, Schema-pinned, WASM-aware

> **`npm create axia-mcp` 는 axia-mcp-server 의 release npm package
> (또는 git-pinned tarball) 을 dependency 로 받는 thin wrapper 만 생성한다.
> scaffold 자체는 capability 목록 / handler 코드를 복사하지 않는다.
> WASM 빌드 부재 시 graceful 안내 (ADR-041 follow-up postinstall guard 활용).**

### P28 세부 규칙 (5 항목)

**P28.1 — Scaffold 의 책임 한정**

scaffold 는 다음 4가지만 생성:
- `package.json` — `@axia/mcp-server` 를 dependency 로 (semver pin)
- `axia-mcp.config.json` — tiers/allow/deny + audit dir override
- `claude_desktop_config.snippet.json` — 사용자가 복사할 MCP 등록 예제
- `README.md` — 5-step quickstart

scaffold 는 **handler 코드 / capability 정의 / Zod schema 를 절대
복제하지 않음**. ADR-041 surface 변경 시 사용자는 `npm update` 만 하면 됨.

**P28.2 — Schema version pinning**

`package.json` 의 `@axia/mcp-server` 버전은 **caret-range** (예: `^0.1.0`).
새 MINOR (capability 추가) 자동 수용, MAJOR 는 명시적 upgrade.

ADR-041 P26.2 schema 와 정합 — 사용자가 `npm update` 로 server 만 올려도
engine WASM 이 forward-compatible 인 한 동작.

**P28.3 — WASM dependency 처리**

scaffold 는 두 모드 지원:
- **모드 A — Bundled WASM (default)**: `@axia/wasm-node` 도 npm
  dependency. 사용자 Rust 미설치도 즉시 동작. (현재 axia-wasm-node 가
  npm 에 publish 안 됨 — 별도 publish PR 선행 필요.)
- **모드 B — Local build**: `--from-source` flag. AxiA repo 위치를
  prompt 로 받고 symlink. 개발자/contributor 용.

본 ADR 은 모드 A 를 default 로 결정. 모드 B 는 별도 ADR-044 trigger.

**P28.4 — Postinstall guard 재사용**

`@axia/mcp-server` 의 기존 `postinstall scripts/check-wasm.mjs` 가
이미 있음. scaffold 를 통해 들어온 사용자도 동일 경고 메시지 받음.
scaffold 는 추가 guard 없음 (단일 SSOT).

**P28.5 — 회귀 테스트 (절대 #[ignore] 금지)**

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `scaffold_creates_minimal_files` | 4개 파일 모두 존재 |
| 2 | `scaffold_pins_caret_range` | package.json 의 @axia/mcp-server 가 ^semver |
| 3 | `scaffold_config_passes_schema_validation` | 생성된 axia-mcp.config.json 이 P27.3 unknown-cap fatal 없이 load 됨 |
| 4 | `scaffold_does_not_duplicate_handlers` | scaffold 출력에 capability 코드 (draw_rect 등) 미포함 |
| 5 | `scaffold_init_smoke_runs` | 생성 직후 `npm install` + handshake 까지 통과 |

## Implementation

### `packages/create-axia-mcp/`

```
packages/create-axia-mcp/
  package.json           — bin: "create-axia-mcp"
  src/
    index.ts             — entry: parse args, run scaffold
    template/
      package.json       — dependency: "@axia/mcp-server": "^X.Y.Z"
      axia-mcp.config.json
      claude_desktop_config.snippet.json
      README.md
  test/
    scaffold.test.ts     — P28.5 회귀 5개
```

### Sample scaffold output (사용자 디렉토리)

```
my-axia-mcp/
  package.json           — { dependencies: { @axia/mcp-server: "^0.1.0" } }
  axia-mcp.config.json   — { enabled_tiers: [0, 1], allow_caps: [], deny_caps: [] }
  claude_desktop_config.snippet.json — Claude Desktop config 예제
  README.md              — 5-step: install / config / register / restart / try
  node_modules/...
```

## Risks & Mitigations

- **R1** — `@axia/mcp-server` npm publish 미완: scaffold 가 동작 안함
  → 본 PR 은 scaffold 코드만, npm publish 는 별도 ADR-044 (release process)
- **R2** — Schema drift: P28.2 caret-range + ADR-041 P26.8 회귀로 차단
- **R3** — Capability 추가 시 scaffold 갱신 부담: P28.1 (scaffold 가 capability 모름) 으로 영구 해소
- **R4** — Bundled WASM 가 OS-binary 이슈 (Linux/Mac/Windows): wasm-bindgen 산출물은 platform-agnostic — 단일 .wasm 으로 모든 OS 동작

## Success Criteria

- ✅ ADR-043 P28 결정이 commit 으로 고정 (이 PR)
- ⏳ `packages/create-axia-mcp` scaffold 패키지 구현
- ⏳ 5 회귀 테스트 (P28.5)
- ⏳ Local 검증: `node packages/create-axia-mcp/dist/index.js my-test-app`
  → 4 파일 생성 확인
- ⏳ npm publish 흐름 (별도 ADR-044)

## References

- ADR-041 P26 (Capability Surface), P26.2 (Schema versioning),
  P26.4 (headless), P26.7 (audit)
- ADR-042 P27 (ALLOW/DENY)
- 산업 패턴: `create-vite`, `create-next-app`, `create-t3-app`
- 메타-원칙 #5 (사용자 편의: 명확하면 자동, 모호하면 명시 동의)

## 변경 이력

- **2026-05-02 (initial + accepted)**: P28 신규 + LOCKED #21. Scaffold
  scope 한정 (4 파일, capability 코드 미복제) + npm semver caret pin +
  postinstall guard 재사용. mode A (bundled WASM) default. 본 commit 후속:
  `packages/create-axia-mcp` 구현 + 5 회귀.
