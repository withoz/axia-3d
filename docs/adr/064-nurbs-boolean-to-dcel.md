# ADR-064 — NURBS Boolean → DCEL Conversion

**Status**: Accepted (Path Z 전 stack 완료 — Steps 1 / 2.A / 2.B+2.C / 3-α / 4 / 5 / 6-α/β/γ/δ, 2026-05-04)
**Last commit**: `946e247` (Step 6-δ Undo cross-method 계약)
**Date**: 2026-05-04 (Path Z 진입) → 2026-05-04 (Path Z 완료, 같은 세션)
**Anchor**: ADR-052 master roadmap (Phase L₂ Boolean — ADR-067 Step 4 prerequisite)
**Parent**: ADR-060 Step 4 (boolean_dispatch §F lock-in)
**Prerequisites**: Phase J nurbs_boolean_v2 (Phase J/L₁ 완료), ADR-062
(Validated Surface Attach), ADR-063 (Path Z 패턴)
**Related**: ADR-067 (Press-Pull Engine, Step 4 의존), Phase O Step 4

---

## 0. Summary (4 lines)

> ADR-060 Phase O Step 4 의 boolean_dispatch 가 NURBS path 진단만 제공
> 하고 mesh fallback 으로 실제 결과를 만든다 — 사용자가 "Nurbs path
> 성공" 보지만 STEP export 시 정밀도 손실. ADR-064 Path Z Step 1 =
> trim curve → 3D polyline 변환 인프라 (atomic piece). 풀 Steps 2-5
> 는 별도 사인-오프. 5 sub-step / 6 회귀 / 2-3주.

---

## 1. Context — Path Z 채택 이유

### 1.1 사용자 패턴 (8번째 Path Z)

| ADR | Path 선택 |
|-----|----------|
| ADR-061~063, 067 Step 1, 068, 069, 070 | Path Z (모두) |
| **ADR-064** | **Path Z Step 1 only** (인프라 atomic piece) |

### 1.2 ADR-064 Step 1 가 풀 사용자 pain (간접)

**P3 (AI agent)**: NURBS Boolean 호출 시 정확한 DCEL 결과 받기
**STEP/IGES export**: trim curve 정확도 1e-3mm 라운드트립
**Press-Pull Engine (ADR-067 Step 4)**: extrude + Boolean 통합 시 정밀도

본 Step 1 단독으로는 사용자 perceived 가치 작음 (backend 인프라). Steps 2-3 에서 가치 발현.

### 1.3 Phase J nurbs_boolean_v2 산출물 분석

```
nurbs_boolean_v2 returns NurbsBooleanResultV2 {
  intersection: Vec<SurfaceIntersection>,  // SSI chains (3D + uv)
  trim_a: ContainmentTree,                 // surface A 의 trim loops
  trim_b: ContainmentTree,                 // surface B 의 trim loops
  robustness: SsiRobustnessReport,
  is_clean: bool,
}
```

**Step 1 의 목표**: `trim_a` / `trim_b` (TrimLoop 모음) → **3D polyline**
(world-space DVec3 sequence) 변환 인프라.

---

## 2. Decision — Path Z scope + 7개 D + 4 영구 Lock-in

### 2.1 §A — Step 1 scope

**채택 (Step 1 atomic)**:
- TrimCurve2D → 2D polyline sampling (chord_tol 정합)
- TrimLoop → 3D polyline (uv → surface.evaluate(u, v))
- 외부 진입점: `Mesh::trim_loops_to_dcel_polyline(...)` (vertex dedup 활용)
- LOCKED #5 1.5μm dedup 정합

**제외 (Steps 2-5 별도 ADR)**:
- 1×1 face Boolean DCEL 생성 (Step 2)
- Multi-face Boolean (Step 3)
- Tensor surface uv inversion (Step 4)
- mesh fallback 폐지 (Step 5 production cutover)

### 2.2 §B — 7개 D 결정 (확정)

| D | 결정 | 비고 |
|---|------|------|
| **D-A** | Path Z (Step 1 only) | 사용자 패턴 8번째 Path Z |
| **D-B** | 1×1 only — multi-face deferred | Step 3 별도 |
| **D-C** | Primitives only (Plane/Cyl/Sph/Cone/Torus + tensor 의 BSpline limited) | Step 4 deferred |
| **D-D** | Mesh fallback coexist (drop-in alongside) | mesh path 무변경 |
| **D-E** | chord_tol = HOVER_CHORD_TOL (0.01mm) | 일관성 |
| **D-F** | Vertex dedup = 기존 add_vertex spatial-hash | LOCKED #5 정합 |
| **D-G** | API = 신규 함수 (drop-in alongside) | 기존 boolean.rs 무변경 |

### 2.3 §C — 4 영구 Lock-in

```
1. Step 1 = trim curve → 3D polyline 인프라 only.
   실제 Boolean DCEL 생성 (Step 2) 본 ADR scope 외.
   Steps 2-5 별도 사인-오프 강제.

2. drop-in alongside — 기존 boolean.rs (mesh path) 변경 0.
   §A 패턴 일관 (Phase O Step 3-5 / ADR-061 / ADR-062).

3. LOCKED #5 1.5μm dedup 정합.
   기존 add_vertex spatial-hash 재사용. 신규 dedup 인프라 0.

4. chord_tol = HOVER_CHORD_TOL (0.01mm).
   ADR-061 §B 의 hover polyline tol 와 동일 — single SSOT.
```

---

## 3. Acceptance — 5 sub-step + 6 회귀

### 3.1 Sub-step 분해 (예상 2-3주)

| Sub-step | 영역 | 회귀 |
|----------|------|------|
| 1.1 | `surfaces/ssi/trim_to_polyline.rs` 신규 모듈 | 2 |
| 1.2 | `TrimCurve2D::sample_polyline_2d(chord_tol)` per-variant | 1 |
| 1.3 | `TrimLoop::to_world_polyline(surface, chord_tol)` (uv→3D) | 1 |
| 1.4 | `Mesh::trim_loops_to_dcel_polyline(...)` 외부 진입점 | 1 |
| 1.5 | 종합 + multi-loop hole 회귀 + disjoint case | 1 |
| **합계** | — | **6** |

### 3.2 6 회귀 invariants (절대 #[ignore] 금지)

1. `trim_to_polyline_line_curve_2_points` — Line 변종 = 정확 2 points
2. `trim_to_polyline_arc_chord_tolerance_satisfied` — Arc sagitta ≤ chord_tol
3. `trim_loop_to_world_evaluates_via_surface` — uv → world 정합 (sphere/cylinder)
4. `mesh_trim_loops_to_dcel_polyline_dedups_at_locked_5` — 1.5μm 이내 vertex 합치기
5. `multi_inner_hole_loops_preserved_in_dcel` — outer + N inner loops 모두 변환
6. `trim_polyline_returns_disjoint_when_no_intersection` — empty trim → empty polyline

---

## 4. Future Steps (별도 사인-오프)

| Step | 영역 | 위험 | 기간 | 상태 |
|------|------|------|------|------|
| 2 | 1×1 face Boolean DCEL 생성 (primitives) | 중-고 | 3-4주 | **✅ 본 ADR §D2** |
| 3-α | Union/Intersect 확장 (3 ops) | 중 | 1주 | **✅ 본 ADR §D3-α** |
| 4 | Op-specific input removal | 중 | 1주 | **✅ 본 ADR §D4** |
| 5 | boolean_dispatch_dcel cutover (Rust API) | 중 | 1주 | **✅ 본 ADR §D5** |
| 6-α/β/γ/δ | WASM/TS/UI/Undo 통합 | 중 | 2주 | **✅ 본 ADR §D6** |
| 3-β | Containment depth ≥ 2 (nested outer) | 高 | 4-6주 | 미착수 (별도 ADR) |
| Path Y | Multi-face Boolean dispatch | 高 | 4-6주 | 미착수 (별도 ADR) |
| 진짜 cutover | `boolean_dispatch` mesh fallback 폐지 | **매우 高** | 2-3주 | 미착수 (별도 ADR, 사용자 텔레메트리 후) |
| Tensor uv inversion | Bezier/B-spline 정확 inversion | **매우 高** | 6-8주 | 미착수 (Path X 후속) |

각 미착수 Step 진입 시 사용자 명시 사인-오프 + 별도 사전 검토 필요.

---

## D. Acceptance Log — Path Z 전 stack (2026-05-04)

본 세션에서 Path Z 의 모든 sub-step 이 atomic 하게 닫혔다. 각 commit 은
사용자 명시 사인-오프 (`권장 (한 줄)` 패턴) + 회귀 절대 #[ignore] 금지
정책 정합. 누적 회귀 38 / 38 그린.

### §D2 — Step 2.B+2.C (commit `79b1fbc`)

**의의**: NURBS Boolean → DCEL face dispatcher. Phase J `nurbs_boolean_v2`
+ Step 1 (`trim_loops_to_dcel_polyline`) + Step 2.A (`trim_loops_to_face`)
를 단일 `Mesh::nurbs_boolean_to_dcel` 진입점으로 통합.

**D-decisions**: D-A=(c) Path Z, D-B=(b) Subtract only, D-C=(b) Additive,
D-D=(a) Full surface clone, D-E=(a) Material inherit, D-F=(b) Disjoint
empty + flag, D-G=(b) Drop-in alongside.

**부가 변경**: `NurbsBooleanResultV2` 에 `trim_a_loops` / `trim_b_loops`
flat 슬라이스 추가 (additive — `ContainmentTree.loop_index` 가 가리키는
원본 loop 슬라이스를 다운스트림이 접근). `BSplineParams` /
`surface_to_bspline` `pub(crate)` 격상.

**회귀 (6, 절대 #[ignore] 금지)**: disjoint / preserves-originals /
drop-in / rejects-non-subtract / rejects-invalid-input /
robustness-clean-for-disjoint.

**Containment 한계**: depth ≤ 1 (1 outer + N immediate hole children).
depth ≥ 2 → Err. Step 3-β 별도 ADR.

### §D3-α — Step 3-α (commit `89337b1`)

**의의**: D-B 가 Subtract-only 에서 3 ops (Subtract + Union + Intersect)
로 확장. Phase J `nurbs_boolean_v2` 가 이미 3 ops 지원 — 가드만 풀고
직접 forwarding.

**D-decisions**: D-B=(a) 3 ops 모두 (was Subtract only); 나머지 2.B+2.C 유지.

**Disjoint 의미**: Subtract → A 유지 / Union → 둘 다 / Intersect → 빈
결과 (수학적 정답이지만 D-F=(c) 에서 재정의됨, §D4 참조).

**회귀 (4, 절대 #[ignore] 금지, 1 obsolete 교체)**:
union_accepted / intersect_accepted / union_disjoint /
intersect_disjoint. `rejects_non_subtract` 폐기.

### §D4 — Step 4 (commit `906fb42`) — 결정적 분기점

**의의**: D-C 가 additive 에서 op-specific removal 로 확장. mesh-level
Boolean 의 의미론적 계약이 처음으로 닫힘. `nurbs_boolean_to_dcel` 가
이제 사용자가 기대하는 Boolean 의 의미를 mesh state 에 직접 반영.

**D-decisions**:
- D-C=(a) Op-specific removal: Subtract → face_a 만 / Union → 둘 다 /
  Intersect → 둘 다.
- D-F=(c) **Op-specific no-op (was 빈 결과 + flag)**: disjoint 시 op
  무관 둘 다 보존. Intersect 의 "수학적으로 빈 결과" → "사용자 geometry
  파괴 회피" 로 재정의.
- D-H=safe-only **(stricter form)**: removal 은 `new_faces` 적어도
  1개 생성된 경우에만. SSI 비어있지 않더라도 closed loop 없으면 →
  입력 보존. 사용자 geometry 파괴 차단.
- D-I=batch: 1 호출 = 1 logical undo 단위.

**결과 struct 변경**: `removed_faces: Vec<FaceId>` 필드 추가.
**Invariant**: `removed_faces ∪ preserved_faces ⊇ {face_a, face_b}`,
중복 0 (한 face 는 정확히 한 쪽에만).

**회귀 (5, 절대 #[ignore] 금지)**: subtract_disjoint_no_removal /
union_disjoint_no_removal / intersect_disjoint_no_removal /
no_removal_when_no_closed_loops / removed_plus_preserved_covers_inputs.

### §D5 — Step 5 (commit `b78129e`)

**의의**: `Mesh::boolean_dispatch_dcel` 신규 method — opt-in DCEL
dispatcher. 기존 `boolean_dispatch` 의 "probe + 항상 mesh assembly"
패턴을 "eligible 시 DCEL 직접" 로 갈아엎되, drop-in alongside 정책으로
기존 method UNCHANGED.

**D-decisions**:
- D-J=(b) Opt-in 새 method (기존 `boolean_dispatch` UNCHANGED).
- D-K=(a) Mesh path 유지 (caller 가 ineligible 시 명시적 호출).
- D-L=(b) 새 result type `BooleanDispatchDcelResult` (`removed_faces`
  포함 — 구조적 차이).
- D-M=(b) Probe-then-assemble 중복 회피 (Phase J 1회 실행).
- D-N=(b) D-H safe-only 일관 (open chain → 입력 보존).
- D-O=(a) D-F=(c) 일관 (disjoint 둘 다 보존).
- D-P=(a) 기존 `boolean_dispatch` UNCHANGED.
- D-Q=(b) WASM/UI/Undo 별도 (Step 6).

**Path 결정**:
- `BooleanPath::Nurbs` → `dcel = Some(...)`
- `BooleanPath::Mesh` → `dcel = None`, `fallback_reason = Some(...)`
  (caller 책임 — 자동 fallback 0).
- `BooleanPath::NurbsWithMeshFallback` → 본 method 에서 절대 사용
  안 함 (Err 전파).

**회귀 (5, 절대 #[ignore] 금지)**: eligible_disjoint_subtract /
ineligible_no_surface / perpendicular_no_closed_loops /
dropin_alongside_no_regression / all_three_ops_accepted.

### §D6 — Step 6 (4 sub-commits, 사용자 노출 stack)

#### §D6α — WASM bridge (commit `230741a`)

**의의**: `booleanDispatchDcelJson(faceA, faceB, opStr, tolGeometric)`
WASM export. JSON return + transaction wrapping (begin → before-snapshot
→ cancel|commit → mark_topology_changed).

**D-decisions**: D-R=(a) JSON return / D-S=`booleanDispatchDcelJson`
명명 / D-T=(c) `tol_geometric` 단일 파라미터 / D-U=(c) face IDs 포함
JSON shape / D-V=(a) 기존 `booleanDispatchJson` UNCHANGED /
D-W=(a) `tests/step6_additive_only.rs` 패턴 정합.

**JSON schema**:
```json
{ "schemaVersion": 1, "ok": true,
  "pathUsed": "Nurbs"|"Mesh"|"NurbsWithMeshFallback",
  "fallbackReason": { "kind": "...", "label": "..." } | null,
  "dcel": { "newFacesA": [...], "newFacesB": [...],
            "removedFaces": [...], "preservedFaces": [...],
            "disjoint": bool, "robustnessClean": bool } | null,
  "nurbsAttempted": bool, "nurbsClean": bool,
  "intersectionChainCount": N }
```

**회귀 (4, 절대 #[ignore] 금지)**: includes_path_and_dcel_fields /
disjoint_and_ineligible_branches / endpoint_wired_with_op_string /
uses_transactions_for_safe_rollback. `export_baseline.txt` additive
update (R1 §D lock-in 준수).

#### §D6β — TS bridge typed wrapper (commit `f8a7ec2`)

**의의**: `WasmBridge.booleanDispatchDcel(faceA, faceB, op, tolGeometric=1e-3)`
TypeScript typed wrapper. Discriminated union (`kind: 'ok'` | `'error'`)
+ defensive parsing + 명시적 error reason.

**D-decisions**: D-X=`booleanDispatchDcel` 명명 / D-Y=(a) discriminated
union / D-Z=(b) cardinal snap 미적용 (face IDs only) / D-AA=(a) markDirty
호출 / D-AB=(a) `AxiaEngineExtended` optional method 추가 /
D-AC=`WasmBridge.test.ts` / D-AD=tolGeometric default 1e-3 (LOCKED #5).

**Exported types** (6): `BooleanDispatchPath`, `BooleanDispatchFallbackKind`,
`BooleanDispatchFallbackReason`, `BooleanDispatchDcel`,
`BooleanDispatchDcelErrorReason`, `BooleanDispatchDcelResult`.

**Error reasons**: `'invalidOp' | 'engineErr' | 'parse'`.

**회귀 (5, 절대 #[ignore] 금지)**: returns_null_when_engine_missing /
parses_ok_with_dcel / parses_ok_with_null_dcel_for_mesh_path /
parses_error_on_engine_error / non_json_returns_parse_error.

#### §D6γ — UI BooleanHandler 라우팅 (commit `93b4923`)

**의의**: `BooleanHandler.startBooleanOp` 의 selection 검증 직후 DCEL
fast-path 삽입. 7 case 분기 + 한국어 Toast + 기존 NURBS probe / Sheet
/ Mesh boolean path 모두 UNCHANGED.

**D-decisions**: D-AE=(c) eligibility 는 dispatcher 의 `pathUsed` 로
판단 / D-AF=(b) 기존 NURBS probe (kind===7) 유지 / D-AG=(a) ineligible
fall-through / D-AH DCEL 우선 / D-AI/AJ/AL 한국어 Toast / D-AK syncMesh
on success.

**Result 매트릭스**:
| Case | Toast | syncMesh | Fall-through |
|------|-------|----------|--------------|
| null bridge | none | no | yes |
| `kind:'error'` | error | no | no |
| `pathUsed:'Mesh'` | none (debug log) | no | yes |
| Nurbs + null dcel (broken) | error | no | no |
| disjoint=true | info "교차하지 않음" | no | no |
| 새 면 0개 (D-H) | warning "교차선만 검출" | no | no |
| success | info (face deltas) | yes | no |

**회귀 (6, 절대 #[ignore] 금지)**: 7 case 매트릭스 검증.

#### §D6δ — Undo cross-method 계약 (commit `946e247`)

**의의**: `WasmBridge.booleanDispatchDcel` ↔ `WasmBridge.undo` cross-method
contract 검증. Real runtime E2E 는 browser-only — TS bridge 계층의
mock-level contract 검증으로 닫음.

**D-decisions**: D-AM=(a) Mock cross-method / D-AN/AO/AQ=(a) 명시
assertion / D-AP=(b) Transaction wrapping 은 6-α 검증 의존 /
D-AR=(b) BooleanHandler undo 미노출 / D-AS=`WasmBridge.test.ts`.

**검증 4 invariant**:
1. `markDirty()` 가 engine 호출 BEFORE 실행 (fresh fetch 보장)
2. boolean → undo 시퀀스 호출 OK (cross-method 정합성)
3. Nurbs success 후 undo true (transaction commit 인식)
4. Error envelope 후 undo 동작 (transaction.cancel 누수 차단)

---

## E. Known Limitations (Path Z 미해결)

### E.1 Containment depth ≥ 2 (Step 3-β 별도 ADR)

`nurbs_boolean_to_dcel` 의 Path Z 는 depth ≤ 1 만 처리 (1 outer + N
immediate hole children). Nested outer (hole 안에 또 outer 가 있는
case) 는 `Err` 반환 — `containment_to_faces_with_loops` 의 명시적 가드.

**언제 트리거**: Boolean 결과가 self-nested 토폴로지 인 케이스. 실제
코퍼스에서 드묾 (NURBS Boolean 의 closed-loop 결과는 보통 depth 1).

**해결 방향**: 재귀적 group 처리 + depth 별 outer/inner 결정. 별도
ADR 필요 (회귀 surface 가 매우 넓음).

### E.2 Multi-face Boolean (Path Y 별도 ADR)

`boolean_dispatch_dcel` 의 Path Z 는 single-face × single-face 만
처리. multi-face operand 는 `eligibility = MultipleFacesNotSupported`
로 `pathUsed = Mesh` 반환.

**현재 fallback**: 사용자 측에서 `BooleanHandler` 가 selection 을
반/반 split → 기존 mesh boolean 호출. Path Y 가 enabled 되면 multi-face
NURBS aware dispatch 가능.

### E.3 Tensor surface uv inversion (Path X 별도 ADR)

`surface_to_bspline` 가 처리하는 surface kinds (Plane / Cylinder /
Sphere / Cone / Torus / BezierPatch / BSplineSurface) 외의 NURBS
(Rational `NURBSSurface` with weights ≠ 1, RectangularTrimmedSurface
등) 는 `UnsupportedSurfaceKind` 로 fall-through.

**해결 방향**: BezierPatch / BSplineSurface 의 uv inversion 정확도
개선 + Rational NURBS surface SSI 지원. ADR-036 P21.7 §SSI rational
NURBS surface 미해결 항목 정합.

### E.4 Real browser-runtime E2E

본 세션의 회귀 38 개는 mock + source-inspection 기반 contract 검증.
실제 WASM 로딩 후 사용자 클릭 → boolean → undo 의 round-trip 은
별도 인프라 (Playwright/Cypress) 필요. 별도 PR.

### E.5 기존 NURBS probe (kind===7 fast-path) deprecation

`BooleanHandler.ts` 의 line 102-143 fast-path (`bridge.nurbsBoolean`)
는 ADR-027 Phase G3 에서 도입된 probe-only 경로 (`No syncMesh — MVP
does not mutate mesh state yet`). DCEL fast-path 가 superset 이므로
이론상 dead code 이지만, drop-in alongside 정책 (D-AF=(b)) 로 보존.

**Cleanup 시점**: Path Y 진입 또는 별도 cleanup ADR — 사용자 텔레메트리
로 legacy probe 호출 빈도 0 확인 후.

---

## F. 회귀 누적 (Path Z 전 stack)

| Suite | Baseline | After Path Z | Δ |
|-------|----------|--------------|---|
| axia-geo lib | 940 | **959** | +19 |
| axia-wasm tests | 8 | **12** | +4 |
| web TS | 1395 | **1410** | +15 |
| **합계** | 2343 | **2381** | **+38** |

**38 / 38 모두 절대 #[ignore] 금지 정책 준수**.

Sub-step 별 distribution:
- Step 2.B+2.C: 6 (axia-geo)
- Step 3-α: 4 (axia-geo, 1 obsolete 교체로 net +3)
- Step 4: 5 (axia-geo)
- Step 5: 5 (axia-geo)
- Step 6-α: 4 (axia-wasm)
- Step 6-β: 5 (web TS)
- Step 6-γ: 6 (web TS)
- Step 6-δ: 4 (web TS)

---

## G. ADR-064 의 의미 (이 세션에서 닫힌 것)

ADR-064 가 단순한 코드 추가가 아닌 **mesh-level Boolean 의 의미론적
계약 closure** 인 이유:

| 계층 | Path Z 진입 전 | Path Z 완료 후 |
|------|----------------|----------------|
| SSI | Phase J intersection chains | unchanged |
| Trim | TrimLoop / ContainmentTree | unchanged |
| **DCEL** | additive (두 면 공존) | **op-specific 변환** |
| Mesh state | "결과 미정" — caller 가 정리 | **"결과 = 새 면 + op 별 입력 제거"** atomic |
| **사용자 의도** | **표현 불가** (probe-only) | **표현 완료** (실제 결과 반영) |
| **WASM/UI/Undo** | 미연결 | **전 stack 연결** |

Step 5 가 결정적 분기점이었고, Step 6-α/β/γ/δ 가 사용자 노출. Path Y
와 Step 3-β 는 모두 **확장** (의미론적 위험 0) — 결정적 의사결정은
이 세션에서 모두 완료.

---

## 5. References

- ADR-052 master roadmap §Phase L₂
- ADR-060 Step 4 (boolean_dispatch §F lock-in)
- ADR-067 (Press-Pull Engine, Step 4 prerequisite)
- Phase J nurbs_boolean_v2 (`crates/axia-geo/src/surfaces/ssi/boolean.rs`)
- 사용자 사전 검토 + Path Z 채택 (8번째) 2026-05-04

---

*Author*: AXiA team (Path Z 사용자 결정 2026-05-04)
*Status*: **Path Z 전 stack 완료 2026-05-04** — 10 commits, 38 회귀,
모든 D-decision lock-in. Path Y / Step 3-β / 진짜 cutover / browser
runtime E2E 는 별도 ADR.
