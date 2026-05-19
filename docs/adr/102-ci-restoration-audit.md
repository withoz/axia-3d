# ADR-102: CI Restoration — 4-Track Audit & Recovery Plan

- **Status**: R-α Draft (spec only audit, 2026-05-19)
- **Date**: 2026-05-19
- **Anchor**: Session 2026-05-19 PR-105 (ADR-101) merge 후 CI red 발견
  → audit 결과 **2026-05-09 부터 일관 실패** (20+ 연속 commit). 본 PR
  변경 파일과 CI 실패 파일 교집합 0 — pre-existing scope.
- **Parent**: 없음 (operational health track)
- **Sibling**: ADR-087 (K-ζ legacy draw_* 제거 — Track A 원인), ADR-082
  (OCCT.js promotion — Track B 추정 원인)
- **Related LOCKED**: #29 (ADR-082 OCCT.js), #34 (ADR-087 kernel-native
  command suite reset), 본 ADR 으로 추가될 #41
- **Successor (planned)**: 각 track 의 individual ADR (R-β ~ R-ε 별도)

---

## A. Problem Statement

PR-105 (ADR-101) merge 직후 `claude/zealous-boyd` 의 CI 3 workflow
(Build AXiA 3D / CI / MCP Server) 모두 failure. Audit:

```
2026-05-19  c9f09fd  PR-105 (ADR-101)        ← red (본 audit trigger)
2026-05-11  48ae3b4  PR-5 ci-vitest-fix      ← red (이미)
2026-05-11  0108778  main merge              ← red
2026-05-11  31ef88a  LOCKED #26 closure      ← red
...
2026-05-09  eaff383  (가장 오래된 확인)        ← red
```

**본 PR 책임 0**:
- ADR-101 변경 파일 = `CLAUDE.md`, `crates/axia-geo/src/mesh.rs`,
  `packages/axia-wasm-node/README.md`, `docs/adr/101-...md`,
  `packages/axia-mcp-server/test/headless_hole_synthesis.test.ts`,
  `web/scripts/make-*.mjs`
- CI 실패 파일 = `WasmBridge.test.ts`, `WasmBridge.ts:1851`,
  `StepIgesImporter.test.ts`, `occtBrepTraversal.test.ts`,
  `occtRuntime.test.ts`, `capabilities/draw_rect.ts`,
  `capabilities/draw_circle.ts`, `capabilities/draw_line.ts`
- 교집합 = ∅

**4 독립 root cause 추정** — 본 ADR 의 R-β/R-γ/R-δ/R-ε 4 sub-track 으로
분리:

| Track | Layer | Root cause 추정 |
|-------|-------|----------------|
| R-β | MCP capabilities `draw_*` handlers | ADR-087 K-ζ 가 `draw_rect` / `draw_circle` / `draw_line` legacy WASM exports 제거. MCP handler 들이 여전히 `engine.draw_rect(...)` 호출 → `TypeError: engine.draw_rect is not a function` |
| R-γ | OCCT.js API drift (browser + tests) | ADR-082 C-ε amendment 의 OCCT.js dependency promotion + libs 명시화 이후 `BRep_Tool` / `BRepTools` / `Polygon3D` / `TopAbs_EDGE` 등이 mock fixture 의 stale shape 와 drift |
| R-δ | TypeScript strict tuple errors (`WasmBridge.test.ts`) | `fn.mock.calls[0]` 가 빈 tuple `[]` 로 inference — `[0]` / `[1]` indexed access 모두 TS2493. ADR-046 P31 TS strict upgrade 시점 추정 |
| R-ε | `occtRuntime.test.ts` `Cannot find module 'fs'` | Node-only module 을 web test 에서 import — Vite test env `@types/node` 누락 또는 별도 vitest config 필요 |

---

## B. Lock-ins

### R-A — 본 ADR 의 scope = 4-track audit + recovery plan, code 변경 0
- 본 commit (R-α) = spec only (ADR draft + LOCKED #41 entry)
- 각 track 의 actual fix 는 **별도 ADR + 별도 PR** (R-β ~ R-ε 각각)
- ADR-101 H-B (Q2=a) 의 정신 답습 — docs first, code 변경은 명시 결재 후

### R-B — Track 별 결재 옵션 (사용자 선택 가능)
각 track 별로 lettered 결재 옵션 제공:
- (a) 별도 ADR + 별도 PR + 별도 sub-step (가장 정밀)
- (b) 한 PR 에 batch (R-β + R-γ 등) — 관련 layer 묶음
- (c) 보류 — 별도 follow-up issue 트래킹

### R-C — Track A (R-β) hotfix candidate — 가장 작은 surface
**Root cause**: `engine.draw_rect / draw_circle / draw_line` 호출 →
ADR-087 K-ζ 가 이미 제거.

**Fix path** (제안):
- `packages/axia-mcp-server/src/capabilities/draw_rect.ts:42` →
  `engine.draw_rect_as_shape(...)` 로 마이그레이션
- `draw_circle.ts` → `draw_circle_as_shape(...)` (segments 파라미터
  추가 필요)
- `draw_line.ts` → `draw_line_as_shape(...)` (surface_normal 파라미터
  추가)
- 반환 의미 검토: ADR-050 P-5c 의 As-Shape 변형은 `ShapeId.raw()` 반환,
  legacy `draw_rect` 는 `XiaId` 반환 — schema 변경 필요? **결재 필요**.
- ADR-041 P26.2 schema versioning — schema_version bump 필요?
  **결재 필요**.

### R-D — Track B (R-γ) OCCT.js API drift
**Root cause**: ADR-082 C-ε amendment 의 wrapper 의 `_2 ?? _1 ?? bare`
chain + libs 명시화 이후 test mock 의 fixture shape 가 stale.

**Fix path** (제안):
- `web/src/import/occtBrepTraversal.test.ts:199~216` — `BRep_Tool` /
  `BRepTools` mock 추가
- `web/src/import/StepIgesImporter.test.ts:319~322` — `TopAbs_EDGE` /
  `Polygon3D` mock 추가
- 별도 ADR 가능성 (OCCT mock fixture 의 SSOT 정합)

### R-E — Track C (R-δ) TS strict tuple errors
**Root cause**: `fn.mock.calls[0]` 의 inferred type `[]` (vitest mock
함수의 default empty tuple) 에 indexed access. 8 sites (1447, 1450,
1728~1730, 2351~2353, 2363).

**Fix path** (제안):
- vitest mock 타이핑 명시 (`vi.fn<[arg1, arg2, ...]>(...)`)
- `WasmBridge.ts:1851` — function-type assertion 정정 (자체 cast 문제)
- vitest config 의 `globals: false` 확인 (현재 mcp-server vitest config
  은 globals: false)

### R-F — Track D (R-ε) `occtRuntime.test.ts` `fs` 누락
**Root cause**: Node `fs` module 을 vite test env 에서 import. 가장
간단 fix.

**Fix path** (제안):
- `@types/node` devDependency 확인
- vitest config `environment: 'node'` 분기 또는 fs import 제거

### R-G — Backward compatibility
- 본 R-α (spec only) 는 회귀 0
- 각 R-β~R-ε 의 fix 는 surface 별 회귀 자산 추가 (각 ADR 에서 정의)

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| R-α | ADR draft + CLAUDE.md LOCKED #41 entry 작성, 코드 변경 0 |
| R-β | MCP `draw_*` capability `_as_shape` migration → 3 workflow PASS 의 MCP Server 부분 회복. 별도 ADR |
| R-γ | OCCT mock fixture 갱신 → CI 의 Web E2E TS build pass. 별도 ADR |
| R-δ | TS strict tuple fix → CI 의 TypeScript typecheck pass. 별도 ADR |
| R-ε | `fs` module 해결 → occtRuntime 분기 통과. 별도 ADR |
| **CI 전 workflow green** | R-β/γ/δ/ε 모두 closure 시 |

---

## D. Acceptance Log

### R-α (본 commit) — Spec only audit + LOCKED #41

- **commit**: 본 commit (`docs/adr/102-ci-restoration-audit.md` 추가
  + `CLAUDE.md` LOCKED #41 entry)
- **변경**: ADR draft 1 file + CLAUDE.md LOCKED entry
- **회귀**: 0 (spec only)
- **다음**: R-β ~ R-ε 결재 옵션 사용자 선택 후 진행. Track A (R-β) 가
  가장 작은 surface — 권장 첫 trial.

### R-β (본 commit) — MCP `draw_*` capability migration to `_as_shape`

- **commit**: 본 commit (`packages/axia-mcp-server/src/capabilities/
  {draw_rect,draw_circle,draw_line}.ts` + `types.ts` + 6 test files)
- **Root cause confirmed**: ADR-087 K-ζ legacy WASM exports `draw_rect /
  draw_circle / draw_line` 제거. MCP capabilities 가 여전히 legacy
  method 호출 → `TypeError: engine.draw_rect is not a function`.
- **Fix path applied**:
  - 3 capability handlers 의 engine call 을 `_as_shape` variant 로 마이그
    레이션 (`draw_rect_as_shape` / `draw_circle_as_shape` /
    `draw_line_as_shape`)
  - Return `-1` 에러 sentinel detection + throw
  - `EngineInstance` interface (`src/capabilities/types.ts`) — legacy
    method signatures 제거, `_as_shape` variants 추가
  - 6 test files 의 mock entries (`draw_rect: ()=>1` 등 17 callsites) 를
    `_as_shape` 로 일괄 rename
  - `capabilities_extra.test.ts:243` 의 `draw_circle → list_xias workflow`
    test 의미 갱신 — ADR-049/050 Two-Layer Citizenship 반영, Shape
    drawing 후 `list_xias.count === 0` 검증 (material 부착 전 promotion
    없음)
- **Schema preservation**: Output field name `xia_id` 유지 (backward
  compat). 값은 이제 ShapeId. capability description 에 명시 — "value
  is a ShapeId; promotion to property-layer Xia requires explicit
  material assignment (ADR-049 §4 Q1)". ADR-041 P26.2 schema_version
  bump 불필요 (field shape 동일).
- **Sweep**: vitest @axia/mcp-server 17 files / **167/167 PASS**
  (이전 166/167, draw_circle workflow test 의 의미 갱신으로 정합 완료).
  절대 #[ignore] 금지 167/167 준수.
- **알려진 semantic drift (별도 트랙)**: ADR-049 §4 Q1 의 4-condition
  promotion 이 MCP layer 에 노출되지 않음 — Shape ↔ Xia 전이 capability
  (가칭 `promote_shape_to_xia`) 향후 ADR. 본 R-β scope 외.

### R-ε (본 commit) — `web/` `@types/node` + `node:` prefix imports

- **commit**: 본 commit (`web/package.json` + `web/package-lock.json` +
  `web/src/import/occtRuntime.test.ts`)
- **Root cause confirmed**: `occtRuntime.test.ts:29` 의 `import 'fs'`
  가 TS strict typecheck 에서 `TS2307: Cannot find module 'fs'` —
  `@types/node` 가 `web/package.json` devDependencies 에 미포함.
- **Fix path applied**:
  - `@types/node: ^22.0.0` devDep 추가 (CI matrix `node-version: [22.x,
    24.x]` 정합)
  - `occtRuntime.test.ts` 의 `from 'fs'` → `from 'node:fs'`,
    `from 'path'` → `from 'node:path'` (modern Node import prefix —
    Node-only intent 명시)
- **Sweep**: vitest occtRuntime 8/8 PASS (`Drift #2 회귀 가드` 포함).
  절대 #[ignore] 금지 8/8 준수.
- **TS strict typecheck**: `occtRuntime.test.ts` errors 0 (이전 1).
  나머지 typecheck errors 는 R-γ / R-δ scope (별도 트랙).

### R-γ (본 commit) — OCCT mock fixture 갱신

- **commit**: 본 commit (`web/src/import/occtBrepTraversal.test.ts` +
  `web/src/import/StepIgesImporter.test.ts`)
- **Root cause confirmed**: 두 test 의 `mockOcctWithShape /
  mockOcctWithFaces` 반환 타입이 좁아서 helper 들이 `BRep_Tool /
  BRepTools / Polygon3D / TopAbs_EDGE` 등을 동적 추가할 때 TS strict
  TS2339 / TS2353 reject.
- **Fix path applied**:
  - 두 함수의 return type 을 `Record<string, any>` 로 명시 →
    augmentation 허용
  - Mock fixture 자체는 변경 없음 (구조적 mock 유지)
- **Sweep**: occtBrepTraversal / StepIgesImporter 두 파일 TS strict 0
  errors.

### R-δ (본 commit) — vitest mock 타이핑 + WasmBridge.ts cast

- **commit**: 본 commit (`web/src/bridge/WasmBridge.test.ts` 4 sites +
  `web/src/bridge/WasmBridge.ts:1851` cast)
- **Root cause confirmed**:
  - `vi.fn(() => N)` 의 generic inference 가 `() => N` (zero arg) 로
    type 됨 → `fn.mock.calls[0]` 가 `[]` 빈 tuple → indexed access
    `args[i]` 모두 TS2493 reject (9 sites)
  - `WasmBridge.ts:1851` 의 `(fn as (pts: Float64Array, ...) => number)`
    cast 가 TS2352 — `(...args: number[]) => number` 에서 Float64Array
    first arg 로 직접 cast 불가
- **Fix path applied**:
  - 4 `vi.fn(...)` 호출에 explicit signature type
    (`vi.fn<(name: string, faces: Uint32Array) => number>(...)` 등)
    추가
  - `mock.calls[0]!` non-null assertion (vitest API 의 inferred shape
    정합)
  - `WasmBridge.ts:1851` cast 를 `fn as unknown as (...) => number`
    로 정정 (TS strict 권장 패턴)
- **Sweep**: WasmBridge.test.ts / WasmBridge.ts TS strict 0 errors.

### R-ζ (본 commit, 확장 scope) — 추가 typecheck cleanup

R-γ + R-δ 진행 중 audit 외부 추가 errors 8 sites 발견 (이전 audit 가
WasmBridge / occt errors 에 가려서 미감지). 동일 PR 에 batch — CI 완전
green 목표 정합 (사용자 권장 (c) 의도 답습).

- **8 sites 분류**:
  - `@axia/action-catalog` workspace 패키지의 `dist/` 가 web/'s
    npm ci 시 자동 빌드 안 됨 → `CapabilityExplorerPanel.ts:25`
    module not found + 종속 implicit any 3 sites (main.ts:703,
    CapabilityExplorerPanel.test.ts:212, CapabilityExplorerPanel.ts:200,
    317)
  - `InitialScene.test.ts:11,12,47,48` — legacy `drawRect` / `drawCircle`
    참조 (ADR-087 K-ζ 의 web/src/bridge 의 자연 변경 — R-β 의 자매 site)
  - `LayeredMaterialDialog.test.ts:55` — `ReturnType<typeof vi.spyOn>`
    generic empty-args signature vs 실제 `prompt` spy variance reject
    (vitest 3.x bivariance)
- **Fix path applied**:
  - `web/package.json` 에 `build:action-catalog` 보조 script 추가
    + `prebuild` / `pretypecheck` / `pretest` 훅으로 일관 호출 (workspace
    file: dep 의 dist 자동 생성)
  - `InitialScene.test.ts` mock entries 와 assertions 모두 `_AsShape`
    variants 로 마이그레이션 (R-β 패턴 답습)
  - `LayeredMaterialDialog.test.ts` 의 `promptSpy: any` (jsdom prompt
    spy 의 한정 surface 정합)
- **Sweep**: full vitest 1828/1828 PASS + 1 skipped (이전 1827 + 1
  fail). vite build 정상 (724.34 KB three-loaders + 5,368.70 KB
  opencascade lazy chunk).

### 전체 회복 결과

- **`npm run typecheck`** (web/): TS strict 0 errors
- **`npm test`** (web/): vitest 116/116 files, **1828/1828 tests PASS**
  + 1 skipped (pre-existing)
- **`npm run build`** (web/): vite 정상 (29.83s)
- **`cargo test --package axia-geo --lib`**: **1259 PASS**, 0 failed,
  0 ignored
- **`npm test` (@axia/mcp-server)**: **167/167 PASS**

**CI workflow 회복 전망** (PR merge 후):
- **MCP Server (ADR-041)**: 이미 R-β PR-107 closure 로 회복 ✅
- **Build AXiA 3D**: 본 PR 로 회복 예상 (typecheck + vitest + build 정상)
- **CI (Web E2E)**: 본 PR 로 typecheck 부분 회복 예상.
  Playwright E2E 별도 분석 필요 (회귀 자체 통과 시 확정)

### 누적 (R-α ~ R-ζ)

- ADR-102 R-α (audit + LOCKED #41 entry) — PR-106 merged
- ADR-102 R-β + R-ε (MCP `_as_shape` + `@types/node`) — PR-107 merged
- ADR-102 R-γ + R-δ + R-ζ (OCCT mock + vitest typing + workspace
  build hook + drift cleanup) — 본 commit

4-Track audit 100% closure.

---

## E. Lessons (filled at R-ε closure 시)

(TBD — 각 track 의 root cause 가 같은 architectural 원인 (ADR-087
K-ζ 의 cleanup 미완 등) 인지 다른지 확인 후 작성)

---

## F. Cross-link

- ADR-087 LOCKED #34 (K-ζ legacy `draw_*` 제거 — Track A 원인)
- ADR-082 LOCKED #29 (OCCT.js promotion C-ε amendment — Track B 추정 원인)
- ADR-046 P31 (UI/UX 5-Pillar Roadmap — TS strict upgrade 시점 추정,
  Track C 원인)
- ADR-101 LOCKED #40 (본 audit 의 trigger — PR-105 merge 후 CI red 발견)
- ADR-076 §C-amendment-1 (additive baseline + deletion 정책 — 본
  cleanup ADR 의 base)
- 메타-원칙 #4 SSOT (capability surface drift 의 anchor)
- 메타-원칙 #6 Preventive (CI green 이 자체 invariant)
- 메타-원칙 #9 회귀 없음 (CI red 상태에서 merge 진행 시 위반 — 본
  audit 의 정합 가치)
- 메타-원칙 #15 신설 (Headless API ≡ Tool Path 의미 동등 — Track A
  의 직접 원인 = 의미 동등 깨짐)
