# ADR-113 — Sphere Path B Production Wiring (ADR-104 β-1 closure)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β-1-δ + β-1-ε + β-1-ζ + β-1-η atomic closure (single PR per LOCKED #44) |
| Date | 2026-05-17 |
| Supersedes | — |
| Closes | ADR-104 β-1 (Sphere Path B), Amendment 2 (Q1 = 2-hemisphere) |
| Related | ADR-094 (Cylinder Path B-full canonical, 1:1 mirror), ADR-104 (Path B expansion spec), ADR-049 P-5e-α (engine OFF + production ON pattern), LOCKED #43 (Z-up), LOCKED #44 (Complete Meaning per Merge) |

---

## 1. Canonical Anchor

ADR-104 β-1-β (Sphere Path B engine `create_sphere_kernel_native` 본체) 는 이미 main 에 closure 됨 (11 회귀 PASS). 본 ADR-113 은 **남은 wiring layers (β-1-δ ~ β-1-η)** 를 *single atomic PR* 으로 closure — LOCKED #44 "Complete Meaning per Merge" 정합.

**사용자 결재 anchor (2026-05-17)**:
> "ζ (β-1 atomic + β-2/β-3 별도 후속)으로 진행" — β-1 Sphere 완전 활성 단일 PR.

## 2. β-1 sub-step closure 매트릭스

| Sub-step | scope | 상태 | 본 PR |
|---|---|---|---|
| β-1-α | spec + Amendment 2 | ✅ main | — |
| β-1-β | engine `create_sphere_kernel_native` + 11 회귀 | ✅ main | — |
| β-1-γ | Mesh-level Map verify | ✅ unnecessary (single-loop per face, multi-loop schema 불필요) | docs note |
| **β-1-δ** | WASM bridge + TS wrapper | ✅ this PR | engine ↔ TS |
| **β-1-ε** | Render `tessellate_face_surface` verification | ✅ this PR | preview measure |
| **β-1-ζ** | `sphere_path_b_default` flag + localStorage + production ON | ✅ this PR | UX activation |
| **β-1-η** | Real Chromium 시연 + closure docs | ✅ this PR | preview screenshot |

## 3. 본 PR 변경 사항

### 3.1 Engine layer (Rust)

- `crates/axia-geo/src/mesh.rs:178+`: `Mesh::sphere_path_b_default: bool` field 추가 (mirror cylinder, `#[serde(skip, default)]`)
- `crates/axia-geo/src/mesh.rs:407+` (Mesh::new): `sphere_path_b_default: false` 초기화
- `crates/axia-geo/src/mesh_path_b.rs:`: `set_sphere_path_b_default()` + `sphere_path_b_default()` accessor methods (ADR-094 cylinder pattern 1:1 mirror)
- `crates/axia-geo/src/operations/primitives.rs:356`: `create_sphere` dispatch — `if self.sphere_path_b_default { return self.create_sphere_kernel_native(...); }` (fall-through to Path A polygonal otherwise)

### 3.2 WASM bridge (Rust)

- `crates/axia-wasm/src/lib.rs:1363+`: `setSpherePathBDefault(on)` + `getSpherePathBDefault()` exports (mirror cylinder)

### 3.3 TypeScript bridge

- `web/src/bridge/WasmBridge.ts:506+`: typed interface entries (optional methods)
- `web/src/bridge/WasmBridge.ts:1366+`: wrapper methods `setSpherePathBDefault(on)` + `getSpherePathBDefault()` (graceful no-op on legacy WASM)

### 3.4 Production layer (TS)

- `web/src/tools/SpherePathBSettings.ts` (NEW): localStorage `axia:sphere-path-b-mode` settings module (1:1 mirror of `CylinderPathBSettings.ts`)
- `web/src/main.ts:111+`: app init reads `getSpherePathBMode()` → `bridge.setSpherePathBDefault(true)` (default ON, explicit OFF preference 보존)

### 3.5 회귀 자산 (절대 #[ignore] 금지)

**axia-geo** (+6 in `primitives::tests`):
- `adr104_b1_zeta_engine_default_is_path_a_legacy`
- `adr104_b1_zeta_path_b_active_after_flag_flip`
- `adr104_b1_zeta_path_a_default_off_preserved`
- `adr104_b1_zeta_path_a_explicit_off_after_toggle`
- `adr104_b1_zeta_dispatch_invariants_pass`
- `adr104_b1_zeta_path_b_dispatch_memory_reduction`

**vitest** (+9):
- `WasmBridge.test.ts` β-1-ζ: 4 tests (setSpherePathBDefault forwards / graceful / getSpherePathBDefault returns / legacy false)
- `SpherePathBSettings.test.ts` (NEW): 5 tests (default ON / localStorage true / localStorage false / setSpherePathBMode persists / onChange fires)

**Total**: **+15 회귀**, 절대 #[ignore] 금지 15/15 준수.

axia-geo total: 1339 → **1345 PASS**
vitest total: 1851 → **1864 PASS**

## 4. 측정 매트릭스 (real Chromium preview)

### 4.1 Engine layer DCEL count (Path B vs Path A baseline)

| Sphere count | Path A (default 12×12) | Path B (Amendment 2) | 감소율 |
|---|---|---|---|
| 1 | 144 face / 264 edge / 122 vert | **2 face / 1 edge / 1 vert** | 99.0% / 99.6% / 99.2% |
| 5 | 720 face / 1320 edge / 610 vert | **10 face / 5 edge / 5 vert** | 98.6% / 99.6% / 99.2% |

### 4.2 Production runtime verification

- `bridge.getSpherePathBDefault()` = `true` ✓ (localStorage default ON 작동)
- 5-sphere stress test: 모든 sphere 가 정확히 2 hemisphere face 생성 ✓
- 1-sphere visual: 매끈한 곡면 + 적도 edge 가시 (Z-up 정합, ADR-103) ✓
- Render path zero-code-change: `tessellate_face_surface` 가 v-range subset 자동 활용 ✓

## 5. Lock-ins

- **L-113-1** Single atomic PR per LOCKED #44 — Engine + WASM + TS + Production wiring 같은 의미 단위 (Sphere Path B 활성)
- **L-113-2** ADR-094 B-η 1:1 mirror pattern — 모든 layer 가 cylinder pattern 답습
- **L-113-3** Engine default OFF + production ON via localStorage (ADR-049 P-5e-α 답습)
- **L-113-4** Explicit OFF preference 보존 (`localStorage 'false'` 명시 시 Path A 보존)
- **L-113-5** Path A 회귀 자산 245+ 보존 (engine default OFF + dispatch 시점만 분기)
- **L-113-6** Render zero-code-change (`tessellate_face_surface` 자연 활용 — ADR-031 Phase D infra)
- **L-113-7** ADR-046 P31 #4 additive only (`create_sphere(...)` signature UNCHANGED)
- **L-113-8** 사용자 시연 게이트 PASS (real Chromium preview screenshot 첨부)

## 6. 후속 트랙 (별도 ADR)

### β-2 — Cone Path B (ADR-104 §11.1)

- `Mesh::create_cone_kernel_native(center, radius, height, material) -> Result<Vec<FaceId>>`
- 2 face (base disk Plane + cone side AnalyticSurface::Cone with apex degenerate)
- apex singularity 처리: NURBS degenerate parameter edge 또는 base ring polyline
- 본 ADR-113 패턴 1:1 mirror (별도 atomic PR)

### β-3 — Torus Path B (ADR-104 §11.2)

- `Mesh::create_torus_kernel_native(center, major_radius, minor_radius, material) -> Result<FaceId>`
- 1 face with AnalyticSurface::Torus + 2 seam edges (axial + meridional)
- u/v 모두 periodic
- 본 ADR-113 패턴 1:1 mirror (별도 atomic PR)

### γ — sub-step (ADR-104 §3.1 γ/δ)

ADR-094 B-ζ-prep / B-ε-prep 답습 — 별도 atomic 가능:
- Boolean / Offset / Push-Pull 의 surface-driven dispatch 자연 결합 verification
- STEP export NURBSSurface round-trip 정확도 (1e-3 mm) audit

## 7. Lessons

### L1 — β-1-β 가 main 에 먼저 존재 → wiring layers 만 묶음

ADR-104 의 가장 큰 architectural work (engine 본체) 가 이전 세션에서 closure 되어 있었음. 본 PR 은 audit 후 *남은* wiring 만 분리 → 의미 단위 명확.

**가이드**: 향후 multi-week atomic ADR 진행 시 main audit 우선 (`git log <file>` + `grep -n <symbol>`) — 이미 완료된 work 발견 시 wiring 만 분리.

### L2 — Cylinder pattern 1:1 mirror canonical

ADR-094 B-η 의 cylinder Path B wiring 패턴 (engine flag + WASM + TS + localStorage + main.ts 4-layer) 이 sphere 에 *완전 답습 가능*. 새 패턴 0.

**가이드**: 향후 Cone / Torus Path B 도 동일 패턴 1:1 mirror — 본 PR 이 reference template.

### L3 — Render zero-code-change architectural value

`tessellate_face_surface` framework (ADR-031 Phase D, ADR-094 B-ζ-prep) 가 Sphere Path B (2-hemisphere face) 에 *zero-code-change* 으로 작동. `AnalyticSurface::Sphere`의 `u_range / v_range` subset 이 chord-tolerant tessellation 의 자연 input.

**가이드**: AnalyticSurface variant 의 uv-range subset 활용은 Path B 확장의 universal pattern — Cone / Torus 도 동일 unlock 가능.

### L4 — LOCKED #44 의미 단위 분할 정확성

β-1 (Sphere) 이 *one complete meaning* — engine + WASM + TS + production + 시연 + closure 단일 PR. β-2 Cone / β-3 Torus 는 별도 *one complete meaning* 으로 자연 분리.

**가이드**: ADR-104 같은 multi-primitive ADR 의 closure 는 primitive 별 atomic PR — 각각 LOCKED #44 정합.

## 8. Cross-link

- ADR-094 (Cylinder Path B-full canonical) — 1:1 mirror source
- ADR-104 (Path B Expansion spec) — 본 PR 의 anchor spec
- ADR-104 Amendment 2 — Q1 = 2-hemisphere 결정 (본 PR 의 engine impl 기반)
- ADR-049 P-5e-α — engine OFF + production ON pattern
- ADR-031 Phase D — AnalyticSurface::Sphere 인프라
- ADR-046 P31 #4 — additive only (create_sphere signature 보존)
- ADR-091 §E L1 — Mesh-level Map canonical
- LOCKED #43 (ADR-103 Z-up) — 본 PR 의 좌표 정합 (equator anchor at +X·radius, Z-up)
- LOCKED #44 (Complete Meaning per Merge) — 본 PR 의 single-atomic anchor
