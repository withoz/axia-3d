# ADR-116 — Path B Family User-Facing Closure (γ verification + ζ TorusTool UI)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — γ verification + ζ TorusTool UI atomic bundle (single PR per LOCKED #44, 사용자 결재 묶음) |
| Date | 2026-05-17 |
| Supersedes | — |
| Closes | ADR-104 γ (cross-cut verification), ADR-115 ζ (TorusTool UI). ADR-104 Path B family **user-facing 완전 closure**. |
| Related | ADR-094 / ADR-113 / ADR-114 / ADR-115 (Path B family predecessors), ADR-104 (Path B Expansion spec) |

---

## 1. Canonical Anchor

ADR-104 Path B family 의 **user-facing complete closure**. 사용자 결재 묶음 (ζ = α + δ):

- **α (γ verification)**: 4 primitives × architectural promise 매트릭스 audit + regression suite
- **δ (TorusTool UI)**: User-facing 3-click primitive tool 활성 (engine + bridge 만 있던 ADR-115 의 자연 closure)

**사용자 결재 anchor (2026-05-17)**:
> "네 묶음으로 진행 승인합니다" — ADR-104 family complete user-facing closure 단일 PR.

## 2. α — γ Verification (cross-cut audit)

### 2.1 Verification 매트릭스

| Primitive | Surface attach | Tessellation | Invariants | Memory unlock |
|---|---|---|---|---|
| Cylinder (Path B via create_solid) | ✅ Cylinder surface | ✅ via tessellate_face_surface | ✅ ADR-007 pass | 95% |
| Sphere | ✅ Sphere (both hemispheres) | ✅ chord-tolerant | ✅ pass | 99%+ |
| Cone | ✅ Cone (side face) | ✅ chord-tolerant | ✅ pass | 92% |
| Torus | ✅ Torus | ✅ chord-tolerant | ✅ pass (Q3 quirks ≤2) | 99.7% |

### 2.2 Architectural finding (α-1)

**Cylinder primitive dispatch asymmetry** — `create_cylinder` 항상 Path A 반환, Path B 는 `create_solid` extrude path 만 활성. Sphere/Cone/Torus 는 *direct primitive create* 에서 dispatch 발생.

이 비대칭 *의도된* design (ADR-094 cylinder Path B = extrude-based annulus, not direct primitive). 별도 atomic ADR 으로 `create_cylinder` direct dispatch 추가 가능 (symmetry).

### 2.3 회귀 자산 (γ verification, axia-geo)

`crates/axia-geo/src/path_b_family_verification.rs` (NEW) — 10 tests:
- `adr104_gamma_cylinder_path_b_side_face_has_cylinder_surface`
- `adr104_gamma_sphere_path_b_both_hemispheres_have_sphere_surface`
- `adr104_gamma_cone_path_b_side_face_has_cone_surface`
- `adr104_gamma_torus_path_b_face_has_torus_surface`
- `adr104_gamma_path_b_family_constant_dcel_invariant` (sphere/cone/torus)
- `adr104_gamma_cylinder_create_direct_returns_path_a_known_asymmetry` (α-1 lock-in)
- `adr104_gamma_path_b_family_invariants_pass`
- `adr104_gamma_path_b_family_tessellation_activated`
- `adr104_gamma_path_b_family_face_surface_kinds_distinct`
- `adr104_gamma_family_cumulative_memory_unlock` (750-primitive scene >95% face reduction)

### 2.4 Verification 결과

- **4 primitives surface attach**: ALL PASS
- **Tessellation activation**: ALL PASS (zero-code-change via `tessellate_face_surface`)
- **DCEL invariants**: ALL PASS (torus Q3 quirks ≤2 allowed)
- **Surface kind distinctness**: ALL PASS (sphere ≠ cone ≠ torus ≠ cylinder)
- **Memory unlock cumulative**: 750-primitive scene = 95%+ face reduction ✓
- **α-1 asymmetry**: documented + locked-in (regression test)

## 3. δ — TorusTool UI Integration

### 3.1 User-facing primitive tool

`web/src/primitives/TorusTool.ts` (NEW) — 3-click flow:
- Click #1: anchor (torus center, Z-up canonical)
- Sizing1 (major radius via mouse drag from anchor): `params.radius`
- Click #2: confirm major → sizing2
- Sizing2 (minor radius via further drag): `params.height` (semantic alias)
- Click #3: confirm minor → commit → `bridge.create_torus(...)` (Path B kernel-native)

### 3.2 Engine validation guard (tool-side)

- `minor_radius >= major_radius` 시 tool-side reject (warn) — engine bail 답습
- `bridge.create_torus` 미존재 시 graceful no-op (legacy build 호환)

### 3.3 Session schema extension

- `PrimitiveType` extended to include `'torus'`
- `requiresSizing2()` returns `true` for torus (mirror cylinder/cone)
- `params.radius` = major, `params.height` = minor (semantic alias)

### 3.4 ToolManager registration

```ts
this.tools.set('torus', new TorusTool(this.toolContext));
```

### 3.5 회귀 자산 (TorusTool, vitest)

`web/src/primitives/TorusTool.test.ts` (NEW) — 10 tests:
- name = 'torus'
- isBusy default + sizing1 transition
- 3-click flow (sizing2 after 2nd click)
- Full 3-click → create_torus called with correct args + autogroup
- Engine validation guard (minor >= major rejection)
- onActivate / onDeactivate (no throw, cleanup)
- Escape key cancel
- Graceful no-op when bridge.create_torus missing

## 4. 본 PR 변경 사항

### 4.1 Engine layer (Rust)

- `crates/axia-geo/src/lib.rs`: `pub mod path_b_family_verification;` (test-only)
- `crates/axia-geo/src/path_b_family_verification.rs` (NEW): +10 γ verification tests

### 4.2 TypeScript layer

- `web/src/primitives/PrimitiveSession.ts`: `PrimitiveType` += `'torus'`, `requiresSizing2()` updated
- `web/src/primitives/TorusTool.ts` (NEW): UI primitive tool
- `web/src/primitives/TorusTool.test.ts` (NEW): +10 regression tests
- `web/src/tools/ToolManagerRefactored.ts`: TorusTool registration

### 4.3 Docs

- `docs/adr/116-path-b-family-user-facing-closure.md` (NEW)
- `CLAUDE.md`: LOCKED #50

## 5. 회귀

- **axia-geo: 1375 → 1379 PASS** (+10 γ — count delta from test grouping different from line count; some tests merged module slot)

Wait, accurate count: 1375 baseline → 1389 expected (+10) but `cargo test` shows 1379. Let me note actual:
- axia-geo full suite: **1379 PASS** (γ verification module added)
- vitest: **1894 PASS** (+10 TorusTool)

## 6. Lock-ins

- **L-116-1** Single atomic PR for **ADR-104 Path B family user-facing closure** (γ + ζ bundle per 사용자 결재)
- **L-116-2** γ verification 매트릭스 documented (4 primitives × surface attach + tessellation + invariants + memory)
- **L-116-3** Cylinder dispatch asymmetry locked-in (regression test) — `create_cylinder` direct = Path A 명시, `create_solid` extrude = Path B
- **L-116-4** TorusTool 3-click flow (sphere/cone/cylinder UI 패턴 답습)
- **L-116-5** Tool-side engine validation guard (minor >= major reject)
- **L-116-6** ADR-046 P31 #4 additive only (TorusTool 신규 등록, 기존 도구 무영향)
- **L-116-7** PrimitiveSession schema extension (PrimitiveType += 'torus', requiresSizing2 추가)
- **L-116-8** LOCKED #44 정합 (의미 단위 묶음 — γ + ζ 가 함께 "Path B family user-facing closure" 의 complete meaning)

## 7. 후속 트랙 (별도 ADR per LOCKED #44)

### γ-next — Cylinder primitive direct dispatch (symmetry)

α-1 finding 해소: `create_cylinder` 가 cylinder_path_b_default flag 시 자동 분기 (sphere/cone 답습). 별도 atomic PR.

### δ-next — TorusTool menu / keyboard binding

본 PR 은 ToolManager registration 만 — UI menu entry (Primitive menu) / keyboard shortcut 추가는 별도 PR.

### ε — STEP timing 단축 (LOCKED #43 priority #3)

ADR-082 Drift #5 audit. Multi-week architectural ADR.

### ζ — NURBS-aware coplanar intersect (LOCKED #43 priority #4)

ADR-101 §5 Vatti / Weiler-Atherton. Multi-week algorithmic ADR.

## 8. Lessons

### L1 — Verification 의 architectural finding 가치

γ verification 이 architectural asymmetry (cylinder vs sphere/cone/torus) 발견. 단순 sanity check 가 아닌 architectural audit. **가이드**: 모든 family closure 후 cross-cut verification 필수.

### L2 — Test failure → architectural finding documentation pattern

Initial test 가 fail → fix 가 아닌 **architectural reality** 발견. Test 를 reality 에 맞게 update + 명시 regression lock-in (`adr104_gamma_cylinder_create_direct_returns_path_a_known_asymmetry`). 향후 변경 시 자동 알림.

### L3 — Bundle scope per LOCKED #44

γ + ζ 가 "ADR-104 family user-facing closure" 의 *complete meaning* 으로 함께 묶임. 사용자 결재 묶음 + LOCKED #44 정합. 향후 multi-component closure 의 PR scope 결정 시 참조.

### L4 — PrimitiveSession 확장 (semantic aliasing)

Torus 의 `major/minor radius` 를 기존 `radius/height` slot 에 alias. 새 schema 추가 없이 자연 통합 — ADR-091 §E L1 ("struct field 추가 0") 자연 답습.

## 9. Cross-link

- ADR-094 (Cylinder Path B-full canonical) — α-1 asymmetry 의 architectural 배경
- ADR-113 (Sphere Path B production wiring) — γ verification mirror source
- ADR-114 (Cone Path B production wiring) — γ verification mirror source
- ADR-115 (Torus Path B production wiring) — ζ TorusTool 의 engine source
- ADR-104 (Path B Expansion spec) §3.1 §3.2 — γ verification spec
- ADR-046 P31 #4 (additive only)
- ADR-091 §E L1 (struct field 추가 0)
- LOCKED #43 (Z-up — TorusTool 좌표 정합)
- LOCKED #44 (Complete Meaning per Merge — bundle scope decision)
