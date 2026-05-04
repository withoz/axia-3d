# ADR-076 — Legacy Boolean Path Sunset

**Status**: Step 1 진입 (Path Z atomic, 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-064 §E.5 + ADR-066 §E.5 (legacy single-face DCEL fast-path
+ NURBS probe deprecation)
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

| Sub-step | 영역 | 예상 변경 |
|----------|------|----------|
| Step 1 | UI cleanup (BooleanHandler.ts + test 삭제) | -11 vitest |
| Step 2 | Bridge wrapper / WASM export 제거 | Rust 변경 + WASM rebuild + export_baseline change + WasmBridge.test.ts 정리 |
| Step 3 | Type deprecation (NurbsBooleanResult / BooleanDispatchDcelResult) | API 영향 검토 후 |

---

## 5. References

- ADR-064 §E.5 (기존 NURBS probe deprecation 미해결)
- ADR-066 §E.5 (기존 single-face DCEL fast-path unreachability)
- ADR-066 Y-4 (multi DCEL fast-path 가 single 흡수)
- ADR-027 Phase G3 (legacy NURBS probe — superseded)
- BooleanHandler.startBooleanOp (cleanup 대상 함수)

---

*Author*: AXiA team (E.5 Cleanup 트랙 사용자 결정 2026-05-04)
*Status*: Step 1 implementation 진행 중
