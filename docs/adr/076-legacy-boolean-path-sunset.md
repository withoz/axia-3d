# ADR-076 — Legacy Boolean Path Sunset

**Status**: Accepted (Step 1 + Step 1.1 + Step 2 완료 — Path Z atomic, 2026-05-04 ~ 2026-05-05)
**Last commits**: Step 1 (`06e73a8`) + Step 1.1 (`580a64a`) + **Step 2 (본 commit)**
**Anchor**: ADR-064 §E.5 + ADR-066 §E.5 (legacy single-face DCEL fast-path
+ NURBS probe deprecation) — **본 ADR Step 2 으로 surface 전체 닫음**
**Parent**: ADR-064 Path Z 완료 (`03fb6e8`) + ADR-066 Path Y 완료
(`eb71e7e`) + ADR-075 E.4 트랙 완료 (`92056f6`)
**Prerequisites**: ADR-066 Y-4 multi DCEL fast-path 가 single-face
case 을 superset 으로 흡수 (Y-1 1×1 degenerate → Path Z 위임).

---

## 0. Summary (4 lines)

> ADR-066 Y-4 multi DCEL fast-path 가 BooleanHandler 의 첫 NURBS-aware
> path 가 됨 → 이후 single DCEL fast-path / legacy NURBS probe 모두
> unreachable. Step 1 = TS UI dead code 제거 atomic. WASM export +
> bridge wrapper 는 Step 2 별도.

---

## 1. Context — Dead code 진단

### 1.1 ADR-064 §E.5 / ADR-066 §E.5 의 미해결 항목

> **ADR-064 §E.5**: 기존 NURBS probe (kind===7 fast-path) 의 cleanup
> — drop-in alongside 정책 (D-AF=(b)) 으로 보존. Path Y 진입 또는
> 별도 cleanup ADR.

> **ADR-066 §E.5**: 기존 single-face DCEL fast-path 의 unreachability
> — Y-4-g=(b) 회귀 0 정책으로 유지. 사실상 dead code.

### 1.2 BooleanHandler.startBooleanOp 현재 흐름

```
1. Selection 검증 (≥2)
2. Multi DCEL fast-path (ADR-066 Y-4)         ← FIRST: 모든 case 처리
3. Single DCEL fast-path (ADR-064 Step 6-γ)   ← UNREACHABLE
4. Legacy NURBS probe (ADR-027 Phase G3)      ← UNREACHABLE
5. Sheet 2D Boolean
6. Mesh boolean (반/반 split)
```

### 1.3 Unreachability 증명

- Multi (selection.length >= 2) 가 selection.length === 2 case 도 처리
- Y-1 1×1 degenerate 가 Path Z (single DCEL) method 직접 위임
- Y-1 surface_to_bspline 가 BSpline kind 도 처리 → kind===7 case 도 multi 흡수
- Multi 의 fall-through 조건: `pathUsed === 'Mesh'` 또는 null bridge
  - `pathUsed === 'Mesh'` 시 single 경로도 동일 surface 검사로 거부 → Mesh fallback
  - null bridge 시 single 도 null bridge → fallback

→ Single DCEL 와 Legacy NURBS probe 모두 **도달 불가능**.

---

## 2. Decision — Step 1 scope + 7개 CL + 4 Lock-in

### 2.1 §A — Step 1 scope (UI only, atomic)

**채택 (Step 1)**:
- BooleanHandler.ts 의 dead code 제거 (5 항목)
  - Single DCEL fast-path (line 319-338)
  - Legacy NURBS probe (line 340-381)
  - `handleDcelResult` helper (line 95-179)
  - `formatNurbsBooleanOk` / `formatNurbsBooleanError` (line 17-59)
  - `SURFACE_KIND_BSPLINE` 상수 (line 13)
- Imports 정리 (NurbsBooleanResult, BooleanDispatchDcelResult unused)
- `NurbsBooleanHandler.test.ts` 삭제 (제거된 path 만 testing)
- 모든 layer 회귀 변화 0 검증 (vitest / Rust / Playwright / tsc)

**제외 (Step 2 별도)**:
- `WasmBridge.booleanDispatchDcel()` (single) wrapper 제거
- `WasmBridge.nurbsBoolean()` (legacy) wrapper 제거
- `nurbsBoolean` WASM export 제거 (Rust + bindings + export_baseline.txt)
- `BooleanDispatchDcelResult` / `NurbsBooleanResult` 타입 deprecation
- WasmBridge.test.ts 의 single DCEL 회귀 정리

### 2.2 §B — 7개 CL 결정

| CL | 결정 | 비고 |
|----|------|------|
| **CL-A** | ADR-076: Legacy Boolean Path Sunset | 자연 번호 |
| **CL-B** | (a) UI only | atomic 짧은 세션 |
| **CL-C** | (a) `NurbsBooleanHandler.test.ts` 삭제 | dead code 의 test 도 dead |
| **CL-D** | 모든 layer 회귀 변화 0 검증 | 신규 회귀 0 |
| **CL-E** | (a) 한 commit | atomic |
| **CL-F** | git revert 가능 | drop-in alongside 자연 종료 |
| **CL-G** | 신규 회귀 0 (cleanup) | 변화 0 = 검증 |

### 2.3 §C — 4 Lock-in

```
1. Step 1 = UI BooleanHandler.ts 만. Bridge wrapper / WASM export
   는 Step 2 별도 sub-step (Rust 변경 + WASM rebuild 필요).

2. Drop-in alongside 정책 의 자연 종료. ADR-064 §E.5 + ADR-066 §E.5
   의 "회귀 0 우선 정책의 유효 기간 종료" 가 본 ADR 으로 명시.

3. 모든 기존 회귀 unchanged 가 cleanup 검증의 핵심.
   - vitest 1425 → 1414 (NurbsBooleanHandler.test.ts 11 tests 제거)
   - Rust 980 / Playwright 11 unchanged
   - tsc clean

4. Multi DCEL fast-path (Y-4) 가 모든 single-face / kind===7 case 을
   superset 으로 흡수함을 Path Y / E.4 회귀 +35 (Y +24, E.4 +11) 가
   이미 검증 완료 — 본 cleanup 은 안전.
```

---

## 3. Acceptance — Step 1

### 3.1 Step 1 산출물

**Files modified**:
- `web/src/ui/BooleanHandler.ts` (5 항목 제거)

**Files deleted**:
- `web/src/ui/NurbsBooleanHandler.test.ts`

### 3.2 Step 1 검증 (회귀 변화 0)

| Suite | Before | After | Δ | 검증 |
|-------|--------|-------|---|------|
| vitest | 1425 | 1414 | -11 (test 파일 삭제만) | 본 commit run |
| Rust axia-geo | 964 | 964 | 0 | 본 commit run |
| Rust axia-wasm | 16 | 16 | 0 | 본 commit run |
| Playwright E2E | 11 | 11 | 0 | 본 commit run |
| tsc | clean | clean | 0 | 본 commit run |

**핵심 invariant**: BooleanHandler.test.ts 의 17 회귀 (11 baseline +
6 multi DCEL) 모두 그대로 그린 — multi 경로가 모든 case 흡수 검증.

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 변경 | 상태 |
|----------|------|------|------|
| Step 1 | UI cleanup (BooleanHandler.ts + test 삭제) | -15 vitest | **✅ commit `06e73a8`** |
| Step 1.1 | handleMultiDcelResult JSDoc cross-link | docs only | **✅ commit `580a64a`** |
| Step 2 | Bridge wrapper + WASM export + types + tests + baseline | -9 vitest, -4 axia-wasm, -4 Playwright | **✅ 본 commit** |
| Step 3 | (없음 — Step 2 가 type deprecation 까지 포함) | — | N/A |

## §C-amendment-1 (cleanup deletion)

ADR-064/066/075 의 R1 §D "additive-only baseline" 정책은
**deprecation-driven cleanup ADR** 의 명시적 deletion 을 예외로 허용.
본 ADR-076 Step 2 가 첫 사례 — 2 WASM exports + 2 baseline entries
삭제. 향후 cleanup ADR 도 동일 정책. 단, deletion 은 별도 ADR 명시
+ Path Y / E.4 / E.3 회귀 surface 보존 검증 후만 허용 (본 commit
은 axia-geo 964 / Playwright multi 9 / vitest multi 회귀 모두 그린
검증 후 진행).

## §D Step 2 Acceptance Log (commit 본 commit)

### 산출물 (변경 layer)

**TS bridge** (`web/src/bridge/WasmBridge.ts`):
- `nurbsBoolean()` wrapper 제거 (ADR-027 Phase G3 legacy probe)
- `booleanDispatchDcel()` wrapper 제거 (ADR-064 Step 6-β single)
- `AxiaEngineExtended.nurbsBoolean?` interface entry 제거
- `AxiaEngineExtended.booleanDispatchDcelJson?` interface entry 제거
- `NurbsBooleanResult` type export 제거
- `BooleanDispatchDcelResult` type export 제거
- 보존: `BooleanDispatchPath` / `BooleanDispatchFallbackKind` /
  `BooleanDispatchFallbackReason` / `BooleanDispatchDcel` /
  `BooleanDispatchDcelErrorReason` (multi 가 재사용)

**WASM exports** (`crates/axia-wasm/src/lib.rs`):
- `nurbsBoolean` (`pub fn nurbs_boolean`) 제거 (~88 lines)
- `booleanDispatchDcelJson` (`pub fn boolean_dispatch_dcel_json`)
  제거 (~65 lines)

**WASM helpers** (`crates/axia-wasm/src/step6_json.rs`):
- `boolean_dispatch_dcel_result_json` 제거 (~75 lines)
- `BooleanDispatchDcelResult` import 제거

**Rust impl preserved**:
- `Mesh::boolean_dispatch_dcel` (single-face Path Z)
  — multi internal caller (Y-1 1×1 degenerate + cartesian per-pair)
- `Mesh::nurbs_boolean_to_dcel` (Step 4 op-specific removal)
- 모든 internal types (BooleanDispatchDcelResult struct, etc.)

**Tests removed**:
- `WasmBridge.test.ts`: ADR-064 Step 6-β describe (5 tests) +
  ADR-064 Step 6-δ describe (4 tests) — total -9
- `step6_additive_only.rs`: 4 single-DCEL JSON tests (-4)
- `web/e2e/dcel-single.spec.ts`: 전체 파일 삭제 (3 tests)
- `web/e2e/undo-roundtrip.spec.ts`: single-face describe 제거 (-1)
- `web/e2e/helpers/boolean-fixtures.ts`: `invokeBooleanDispatchDcel`
  helper 제거

**export_baseline.txt**:
- `js_name = "booleanDispatchDcelJson"` 제거
- `js_name = "nurbsBoolean"` 제거

### 회귀 변화 (Step 2 commit 시점)

| Suite | Before Step 2 | After Step 2 | Δ |
|-------|---------------|--------------|---|
| axia-geo lib | 964 | **964** | 0 (Rust impl 보존) |
| axia-wasm tests | 16 | **12** | -4 (single JSON tests) |
| web TS vitest | 1428 | **1419** | -9 (bridge tests) |
| web TS Playwright E2E | 13 | **9** | -4 (single E4-2 + single undo) |
| **합계** | 2421 | **2404** | **-17** |

**모든 layer green**. 0 regression in functional behavior — multi
(Y-3) tests cover identical canonical surface via Y-1 1×1 degenerate.

### Verification (executed in this commit's dev environment)

```
cargo test -p axia-geo --lib       → 964 passed
cargo test -p axia-wasm --tests    → 12 passed
npm run wasm:build                 → success (artifacts updated)
npm run build (dist)               → success
npx tsc --noEmit                   → clean
npx vitest run                     → 1419 passed (1 skipped pre-existing)
npx playwright test                → 9 passed (real Chromium browser
                                     verification — drop-in alongside
                                     U-4 group routing tests still green)
```

### ADR-064/066/075 §E lock-ins 영향

- ADR-064 §E.5 (NURBS probe deprecation) — 본 commit 으로 닫음
- ADR-066 §E.5 (single-face DCEL fast-path cleanup) — 본 commit 으로 닫음
- ADR-075 §E.6 (browser E2E real-runtime) — Playwright 9 unchanged
- ADR-064/066 R1 §D additive-only — §C-amendment-1 으로 cleanup 예외 허용

---

## 5. References (Step 2)

- ADR-076 Step 1 / Step 1.1 commits (`06e73a8` / `580a64a`)
- ADR-064 §E.5 / ADR-066 §E.5 (closure target)
- ADR-066 Y-1 lock-in #4 (1×1 degenerate → boolean_dispatch_dcel
  internal preservation)
- `Mesh::boolean_dispatch_dcel` (Rust impl, preserved internal API)

---

## 5. References

- ADR-064 §E.5 (기존 NURBS probe deprecation 미해결)
- ADR-066 §E.5 (기존 single-face DCEL fast-path unreachability)
- ADR-066 Y-4 (multi DCEL fast-path 가 single 흡수)
- ADR-027 Phase G3 (legacy NURBS probe — superseded)
- BooleanHandler.startBooleanOp (cleanup 대상 함수)

---

*Author*: AXiA team (E.5 Cleanup 트랙 사용자 결정 2026-05-04)
*Status*: **Step 1 + Step 1.1 + Step 2 완료 2026-05-05** —
ADR-064 §E.5 + ADR-066 §E.5 surface 전체 sunset. Rust impl
(`Mesh::boolean_dispatch_dcel` + `nurbs_boolean_to_dcel`) 보존 —
multi 가 1×1 degenerate 로 위임. §C-amendment-1 (cleanup deletion
예외) 명시.
