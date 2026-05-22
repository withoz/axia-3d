# ADR-066 — Multi-face NURBS Boolean Dispatch (Path Y)

**Status**: Accepted (Path Y 전 stack 완료 — Y-1 / Y-2 / Y-3 / Y-4 / Y-5 / Y-6, 2026-05-04)
**Last commit**: `08dcce1` (Y-5 Undo cross-method 계약) → 본 commit (Y-6 회고)
**Date**: 2026-05-04 (Path Y 진입) → 2026-05-04 (Path Y 완료, 같은 세션)
**Anchor**: ADR-064 §E.2 (Multi-face Boolean — 별도 ADR 미착수 항목)
**Parent**: ADR-064 Path Z 전 stack 완료 (`03fb6e8`)
**Prerequisites**: `Mesh::boolean_dispatch_dcel` (single-face × single-face,
ADR-064 Step 5), `Mesh::nurbs_boolean_to_dcel` (Step 4).

---

## 0. Summary (4 lines)

> ADR-064 의 single-face dispatcher 위에 multi-face × multi-face
> dispatch 를 쌓는 트랙. Y-G=(a) cartesian 단순 조합 + Y-H=(c)
> skip-and-warn + Y-I=(b) per-pair safe-only removal 의미론. Y-1 =
> Rust API 골격 atomic. Y-2~Y-6 별도 sub-step.

---

## 1. Context

ADR-064 Path Z 가 single-face × single-face 만 처리. 사용자 multi-face
selection 시 `BooleanHandler` 가 selection 을 반/반 split → 기존 mesh
boolean 호출. NURBS-aware multi-face dispatch 미존재.

### 1.1 ADR-064 §E.2 의 미해결 항목

> `boolean_dispatch_dcel` 의 Path Z 는 single-face × single-face 만
> 처리. multi-face operand 는 `eligibility = MultipleFacesNotSupported`
> 로 `pathUsed = Mesh` 반환.

### 1.2 사용자 가치

- **P1 (사용자)**: 여러 면 선택 → NURBS Boolean 직접 동작.
- **P3 (AI agent)**: multi-face Boolean API 사용 가능.
- **Press-Pull (ADR-067)**: 다면 extrude + Boolean 결합 시 직접 dispatch.

---

## 2. Decision — Y-총체 scope + 9개 Y + 4 Lock-in

### 2.1 §A — Y-1 scope

**채택 (Y-1 atomic)**:
- `Mesh::boolean_dispatch_dcel_multi(facesA, facesB, op, tol)` Rust API
- Cartesian pair iteration (Y-G=(a))
- Eligibility 검사 = 모든 face 가 `surface_to_bspline` 통과 (Y-E=(a))
- Per-pair Err → warning 누적 + skip (Y-H=(c))
- Per-pair Ok → `removed_faces` / `new_faces` 누적 (Y-I=(b))
- Single-face × single-face degenerate → Path Z `boolean_dispatch_dcel`
  delegation
- `BooleanDispatchDcelMultiResult` 신규 result type
- 기존 `boolean_dispatch_dcel` UNCHANGED (D-P / Y-D 일관)

**제외 (Y-2~Y-6 별도 sub-step)**:
- Y-2: WASM bridge (multi JSON export)
- Y-3: TS bridge typed wrapper
- Y-4: BooleanHandler.ts UI 통합 (selection split 정책 변경)
- Y-5: Undo cross-method 계약 검증
- Y-6: 회고 / docs

### 2.2 §B — 9개 Y 결정

| Y | 결정 | 비고 |
|---|------|------|
| **Y-A** | ADR-066: Multi-face NURBS Boolean Dispatch | 자연 번호 |
| **Y-B** | (b) Y-1 only (atomic Path Z 답습) | sub-step 분할 |
| **Y-C** | (a) 새 method `boolean_dispatch_dcel_multi` | drop-in alongside |
| **Y-D** | 기존 Path Z method UNCHANGED | 회귀 0 |
| **Y-E** | (a) 모든 face NURBS 부착 (strict) | 의미론 명확 |
| **Y-F** | (a) caller 명시 (`facesA: &[FaceId]`, `facesB: &[FaceId]`) | 기존 시그니처 정합 |
| **Y-G** | (a) Cartesian (N×M pairs) | atomic 단순 형태, (b)/(c) 별도 ADR |
| **Y-H** | (c) skip-and-warn | per-pair Err → 보존 + 누적 |
| **Y-I** | (b) per-pair safe-only removal | 성공 pair 의 face 만 제거 |

### 2.3 §C — 4 Lock-in

```
1. Y-1 = Rust API only. WASM/UI/Undo (Y-2~Y-5) 별도 sub-step.

2. Drop-in alongside — 기존 boolean_dispatch_dcel UNCHANGED.
   Path Z 자산 (Step 5) 보존.

3. Cascade 시맨틱 (자연스러운 결과):
   Subtract(a, b1) 가 a 제거 → 후속 (a, b2) 는 InactiveFace Err
   → Y-H=(c) warning 으로 captured. Y-3/Y-4 에서 재논의 가능.

4. Single-face × single-face degenerate → Path Z method 직접 위임
   (per_pair[0] 만 채워짐). 이중 진입점 회피.
```

---

## 3. Acceptance — Y-1

### 3.1 Y-1 scope

```rust
pub struct PerPairDcelOutcome {
    pub face_a: FaceId,
    pub face_b: FaceId,
    pub result: Result<NurbsBooleanDcelResult, String>,  // Err = warning
}

pub struct BooleanDispatchDcelMultiResult {
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
    pub per_pair: Vec<PerPairDcelOutcome>,
    pub all_new_faces: Vec<FaceId>,        // aggregate (deduped)
    pub all_removed_faces: Vec<FaceId>,    // aggregate (deduped)
    pub warnings: Vec<String>,
}

impl Mesh {
    pub fn boolean_dispatch_dcel_multi(
        &mut self,
        faces_a: &[FaceId],
        faces_b: &[FaceId],
        op: BoolOp,
        tol: BooleanTolerance,
    ) -> Result<BooleanDispatchDcelMultiResult>;
}
```

### 3.2 Y-1 회귀 (5, 절대 #[ignore] 금지)

1. `multi_face_dispatch_eligible_2x2_subtract_succeeds` — 정상 cartesian
2. `multi_face_dispatch_one_missing_surface_routes_mesh_path` — Y-E strict
3. `multi_face_dispatch_single_face_fallback_to_path_z` — degenerate 1×1
4. `multi_face_dispatch_per_pair_safe_only_preserves_when_all_disjoint` —
   Y-H/Y-I, 모두 disjoint → 보존
5. `multi_face_dispatch_drop_in_alongside_path_z_unchanged` — Y-D 회귀

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 | 상태 |
|----------|------|------|------|
| Y-1 | Rust API 골격 + cartesian dispatch | 5 | **✅ 본 ADR §D-Y1** |
| Y-2 | WASM bridge (`booleanDispatchDcelMultiJson`) | 4 | **✅ 본 ADR §D-Y2** |
| Y-3 | TS bridge typed wrapper | 5 | **✅ 본 ADR §D-Y3** |
| Y-4 | BooleanHandler.ts UI 통합 | 6 | **✅ 본 ADR §D-Y4** |
| Y-5 | Undo cross-method 계약 (multi) | 4 | **✅ 본 ADR §D-Y5** |
| Y-6 | 회고 / docs | 0 | **✅ 본 commit** |
| **합계** | — | **24** | — |

---

## D. Acceptance Log — Path Y 전 stack (2026-05-04)

본 세션에서 Path Y 의 모든 sub-step (Y-1~Y-6) 이 atomic 하게 닫혔다.
ADR-064 Path Z 의 자산 위에 multi-face × multi-face dispatch 를 올리되,
의미론적 결정은 Path Z 에서 모두 닫혀 있어 Path Y 는 **확장 + 새
결정 매트릭스 (Y-G cartesian / Y-H skip-and-warn / Y-I per-pair safe-only)
추가** 수준. 누적 회귀 24 / 24 그린.

### §D-Y1 — Y-1 Rust API 골격 (commit `f578cf3`)

**의의**: `Mesh::boolean_dispatch_dcel_multi(facesA, facesB, op, tol)`
신규 method. cartesian pair iteration 으로 single-face Path Z method
(`boolean_dispatch_dcel`) 를 N×M 회 호출하고 결과 누적.

**Y-decisions**: Y-A=ADR-066, Y-B=(b) atomic Y-1 only, Y-C=(a) 새 method,
Y-D=Path Z method UNCHANGED, Y-E=(a) strict eligibility (모든 face 가
analytic surface + surface_to_bspline 통과), Y-F=(a) caller-named
operands, Y-G=(a) cartesian, Y-H=(c) per-pair Err → warning + skip,
Y-I=(b) per-pair safe-only removal.

**Result struct**:
- `BooleanDispatchDcelMultiResult { path_used, fallback_reason,
  per_pair, all_new_faces, all_removed_faces, warnings }`
- `PerPairDcelOutcome { face_a, face_b, result: Result<NurbsBooleanDcelResult, String> }`

**Lock-in #4**: 1×1 degenerate → Path Z method 직접 위임 (이중 진입점
회피, per_pair[0] 만 채워짐).

**Cascade 시맨틱 (자연스러운 결과)**:
Subtract(a, b1) 가 a 제거 → 후속 (a, b2) 는 InactiveFace Err
→ Y-H=(c) warning 으로 captured. Y-3/Y-4 에서 재논의 가능.

**회귀 (5, 절대 #[ignore] 금지)**:
- multi_face_dispatch_eligible_2x2_subtract_succeeds
- multi_face_dispatch_one_missing_surface_routes_mesh_path
- multi_face_dispatch_single_face_fallback_to_path_z
- multi_face_dispatch_per_pair_safe_only_preserves_when_all_disjoint
- multi_face_dispatch_drop_in_alongside_path_z_unchanged

### §D-Y2 — Y-2 WASM bridge (commit `dc4c61c`)

**의의**: `booleanDispatchDcelMultiJson(facesA, facesB, opStr, tolGeometric)`
WASM export. JSON return + transaction wrapping (begin → before-snapshot
→ cancel|commit → mark_topology_changed). Path Z Step 6-α 패턴 답습.

**Y-decisions**: Y-2-a 명명, Y-2-b `&[u32]` 슬라이스 input, Y-2-c
per-pair full 직렬화, Y-2-d aggregates 표시, Y-2-e warnings 배열,
Y-2-f transaction wrapping, Y-2-g op string parse, Y-2-h invalid op
envelope, Y-2-i tests/step6_additive_only.rs 패턴, Y-2-j discriminated
outcome `kind: "ok" | "err"`.

**JSON schema**:
```json
{ "schemaVersion": 1, "ok": true,
  "pathUsed": "Nurbs"|"Mesh",
  "fallbackReason": {...} | null,
  "perPair": [
    { "faceA": u32, "faceB": u32,
      "outcome": { "kind": "ok", "dcel": {...} }
                | { "kind": "err", "detail": "..." } },
    ...
  ],
  "allNewFaces": [u32, ...], "allRemovedFaces": [u32, ...],
  "warnings": [string, ...] }
```

**JSON 이스케이프**: per-pair err detail + warnings 의 quote /
backslash / newline / control chars 처리. 엔진 측 에러 메시지의 special
chars 방어.

**회귀 (4, 절대 #[ignore] 금지)**:
- includes_per_pair_and_aggregates / endpoint_wired /
  uses_transactions / handles_mesh_path_branch.
- `export_baseline.txt` additive 갱신 (R1 §D lock-in 준수).

### §D-Y3 — Y-3 TS bridge typed wrapper (commit `f491a52`)

**의의**: `WasmBridge.booleanDispatchDcelMulti(facesA, facesB, op,
tolGeometric=1e-3)` typed TypeScript wrapper. Path Z Step 6-β 패턴
답습. Discriminated union (`kind: 'ok' | 'error'`) + per-pair
discriminated (`kind: 'ok' | 'err'`) + defensive parsing.

**Y-decisions**: Y-3-a 명명, Y-3-b/c 두 단계 discriminated union,
Y-3-d aggregates 직접 노출, Y-3-e cardinal snap 미적용, Y-3-f
markDirty, Y-3-g optional method 추가, Y-3-h `WasmBridge.test.ts`,
Y-3-i tolGeometric default 1e-3, Y-3-j `number[]` → `Uint32Array`
자동 변환.

**Exported types** (3): `PerPairDcelOutcome`, `PerPairDcelEntry`,
`BooleanDispatchDcelMultiResult`. 기존 ADR-064 의
`BooleanDispatchPath` / `BooleanDispatchFallbackReason` /
`BooleanDispatchDcel` / `BooleanDispatchDcelErrorReason` 재사용.

**회귀 (5, 절대 #[ignore] 금지)**:
- returns_null_when_engine_missing / parses_ok_with_full_per_pair /
  parses_ok_with_err_per_pair_entry /
  parses_ok_with_empty_arrays_for_mesh_path / parses_error_envelope.

### §D-Y4 — Y-4 BooleanHandler UI 통합 (commit `113bd57`)

**의의**: `BooleanHandler.startBooleanOp` 의 selection 검증 직후
multi DCEL fast-path 삽입 (기존 single fast-path BEFORE). Y-1 의 1×1
degenerate 가 single 자리도 처리하므로, 사실상 single fast-path 는
unreachable 이지만 Y-4-g=(b) 회귀 0 우선 정책으로 유지. Path Z Step
6-γ 패턴 답습.

**Y-decisions**: Y-4-a=(c) 대체 (multi 우선), Y-4-b=(a) 반/반 split
(기존 mesh path 와 일관), Y-4-c per-pair count 가시화, Y-4-d=(a)
부분성공 시 syncMesh + warning, Y-4-e=(b) all-disjoint info,
Y-4-f=(a) Mesh path fall-through, Y-4-g=(b) single fast-path 보존,
Y-4-h=(a) graceful null bridge.

**handleMultiDcelResult 매트릭스**:
| Case | Toast | syncMesh | Fall-through |
|------|-------|----------|--------------|
| null bridge | none | no | yes |
| `kind: 'error'` | error | no | no |
| `pathUsed: 'Mesh'` (Y-E) | none | no | yes |
| all-disjoint / no-loops | info | no | no |
| partial (some err'd) | warning | yes | no |
| full success | info | yes | no |

**Korean Toast 메시지** (per-pair count 가시화):
- success: "NURBS {op} (multi) 완료 — 새 면 N개, 제거 면 M개 (X/Y pair 성공)."
- partial: "NURBS {op} (multi) 부분 성공 — X/Y pair 성공, ... 첫 경고: ..."
- disjoint: "NURBS {op} (multi): 모든 N개 pair 가 교차하지 않거나 면 분할 미생성 (변경 없음)."
- error: "NURBS {op} (multi) — 엔진 오류 ({reason}): ..."

**회귀 (6, 절대 #[ignore] 금지)**:
- new_faces_calls_syncmesh_and_success_toast
- all_disjoint_pairs_info_toast_skips_syncmesh
- partial_failures_warning_toast_syncs_mesh
- mesh_path_falls_through_to_legacy
- null_bridge_falls_through_graceful
- engine_error_envelope_stops_no_fallback

### §D-Y5 — Y-5 Undo cross-method 계약 (commit `08dcce1`)

**의의**: `WasmBridge.booleanDispatchDcelMulti` ↔ `WasmBridge.undo`
cross-method contract 검증. Path Z Step 6-δ 패턴 답습. Real runtime
E2E 는 browser-only — TS bridge 계층의 mock-level contract 검증으로
닫음.

**Y-decisions**: Y-5-a=(a) Mock cross-method, Y-5-b/c/e=(a) 명시
assertion, Y-5-d=(b) Y-2 transaction wrapping 의존 (재검증 회피),
Y-5-f=(a) **partial-success batch atomic undo** (multi 의 특성 추가
검증), Y-5-g `WasmBridge.test.ts`, Y-5-h=(b) handler undo 미노출.

**검증 4 invariant**:
1. `markDirty()` 가 engine 호출 BEFORE 실행 (fresh fetch)
2. multi → undo 시퀀스 (2×2 cartesian fixture)
3. **Partial-success batch atomic undo** — 1 ok + 1 err per_pair 시
   single undo 가 전체 batch 복구 (Y-2 transaction wrapping 의 자연
   결과)
4. Error envelope 후 undo 동작 (transactions.cancel 누수 차단)

---

## E. Known Limitations (Path Y 미해결)

### E.1 Cascade 시맨틱 (Y-1 Lock-in #3)

`Subtract(a, b1)` 가 a 를 제거하면 후속 `(a, b2)` 는 InactiveFace
Err 를 반환 (Path Z 의 자연 결과). 현재는 Y-H=(c) skip-and-warn 으로
captured. Path Z 를 거쳐가는 cartesian 의 결과 — atomic Y-1 에서는
의도된 동작.

**해결 방향 (별도 ADR)**: Cascade-aware ordering / 정책별 우선순위
(예: Subtract 의 경우 face_a 의 모든 b 를 한 SSI 로 합산). 결정
매트릭스가 새로 열리므로 별도 ADR 후보.

### E.2 Multi-face Sheet Boolean (별도 ADR)

Y-1 의 strict eligibility (Y-E=(a)) 는 모든 face 가 analytic surface
부착을 요구. Sheet face (`isFaceInVolume === false`) 는 surface 가
없을 가능성이 있어 multi DCEL fall-through → 기존 sheet boolean
path. 즉 multi sheet 는 **현 상태 미지원**.

**해결 방향**: Sheet 의 multi-face 2D Boolean 별도 ADR 또는 Y-E 완화
(Sheet 인 경우 별도 path).

### E.3 사용자 명시 Group A/B 선택 UX (별도 ADR)

Y-4-b=(a) 반/반 split 은 selection 의 의미 있는 grouping 보장 0.
사용자가 첫 N face 를 A, 나머지를 B 로 의도한다는 보장 없음.

**해결 방향**: 사용자 명시 group 선택 UX (예: 우클릭 메뉴 "Set as
Group A" + "Set as Group B"). 별도 ADR — UI / Tool 결정 매트릭스 큼.

### E.4 Real browser-runtime E2E

본 세션의 회귀 24 개는 mock + source-inspection 기반 contract 검증.
실제 WASM 로딩 후 multi-face Boolean → undo round-trip 은 별도
인프라 (Playwright/Cypress) 필요. **ADR-064 §E.4 와 동일한 인프라
공유**.

### E.5 기존 single-face DCEL fast-path 의 unreachability

Y-4-g=(b) 회귀 0 정책으로 기존 ADR-064 Step 6-γ single fast-path 가
유지되지만, Y-1 의 1×1 degenerate (Path Z 위임) 가 동일 case 를 multi
경로로 처리하므로 **사실상 dead code**. ADR-064 §E.5 의 NURBS probe
deprecation 과 묶어 별도 cleanup ADR.

---

## F. 회귀 누적 (Path Y 전 stack)

| Suite | Pre-Y baseline | After Path Y | Δ |
|-------|----------------|--------------|---|
| axia-geo lib | 959 | **964** | +5 (Y-1) |
| axia-wasm tests | 12 | **16** | +4 (Y-2) |
| web TS | 1410 | **1425** | +15 (Y-3 + Y-4 + Y-5) |
| **합계 (Path Y)** | 2381 | **2405** | **+24** |

**24 / 24 모두 절대 #[ignore] 금지 정책 준수**.

Sub-step 별 distribution:
- Y-1 Rust API: 5 (axia-geo)
- Y-2 WASM bridge: 4 (axia-wasm) + export_baseline 1 update
- Y-3 TS wrapper: 5 (web TS)
- Y-4 UI 통합: 6 (web TS)
- Y-5 Undo 계약: 4 (web TS)
- Y-6 회고: 0 (docs only)

### Path Z + Path Y 합산 (ADR-064 + ADR-066)

| Suite | Original baseline | After Path Z + Path Y | Δ |
|-------|-------------------|------------------------|---|
| axia-geo lib | 940 | 964 | +24 |
| axia-wasm tests | 8 | 16 | +8 |
| web TS | 1395 | 1425 | +30 |
| **합계** | 2343 | **2405** | **+62** |

**62 / 62 모두 절대 #[ignore] 금지 정책 준수**.

---

## G. ADR-066 의 의미 (Path Y 시점)

ADR-064 Path Z 가 single-face × single-face mesh-level Boolean 의미론을
처음으로 닫았고, ADR-066 Path Y 는 그 위에 **multi-face × multi-face
를 올리되 의미론적 결정 0** 으로 통과:

| 측면 | Path Z | Path Y |
|------|--------|--------|
| **결정 성격** | mesh-level Boolean **의미론 closure** (Step 4 결정적 분기점) | 의미론 closure 위의 **확장 + 새 결정 매트릭스** (cartesian / skip-and-warn / per-pair safe-only) |
| **위험** | 中-高 (의미론 + 회귀 정책 정의) | 低-中 (Path Z 자산 활용, 새 결정만) |
| **commits** | 10 | 6 |
| **회귀** | +38 | +24 |
| **stack** | 사용자 메뉴 → mesh-level | 사용자 메뉴 (multi) → mesh-level (cartesian) |

Path Y 는 Path Z 자산의 **검증** 도 됨:
- Y-1 1×1 degenerate 가 Path Z method 를 그대로 위임 → Path Z 가 충분히
  generic.
- Y-2 transaction wrapping 이 partial-success 케이스에서도 atomic undo
  보장 → ADR-064 의 transaction 정책이 Path Y 에 그대로 적용 가능.
- Y-4 fall-through 정책이 Path Z 의 D-G drop-in alongside 와 정합 →
  ADR-066 가 ADR-064 회귀 0 보장.

남은 미착수 (E.1 cascade 정책 / E.2 multi sheet / E.3 group selection UX
/ E.4 browser E2E / E.5 single fast-path cleanup) 는 모두 **확장 또는
별도 트랙** — 본 ADR 의 결정 매트릭스 위에 새 결정 추가만 필요.

---

## 5. References

- ADR-064 Path Z 전 stack 완료 (`03fb6e8`)
- ADR-064 §E.2 Multi-face Boolean (Path Y 별도 ADR — 본 ADR-066)
- `Mesh::boolean_dispatch_dcel` (ADR-064 Step 5)
- `Mesh::nurbs_boolean_to_dcel` (ADR-064 Step 4)

---

*Author*: AXiA team (Path Y 사용자 결정 2026-05-04)
*Status*: **Path Y 전 stack 완료 2026-05-04** — 6 commits, 24 회귀,
모든 Y-decision lock-in. E.1~E.5 미해결 항목은 모두 확장 또는 별도
트랙.
