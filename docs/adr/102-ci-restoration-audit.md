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

### R-β ~ R-ε (planned)

각 track 별 별도 ADR 번호 + 별도 PR 예정. ADR-103 / 104 / 105 / 106
(추정).

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
