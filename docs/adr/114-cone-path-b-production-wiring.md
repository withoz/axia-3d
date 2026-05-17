# ADR-114 — Cone Path B Production Wiring (ADR-104 β-2 closure)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β-2-β + β-2-γ + β-2-δ + β-2-ε + β-2-ζ + β-2-η atomic closure (single PR per LOCKED #44) |
| Date | 2026-05-17 |
| Supersedes | — |
| Closes | ADR-104 β-2 (Cone Path B), Amendment 1 §9.2 Q2 (revised — see §1.1) |
| Related | ADR-094 (Cylinder Path B-full canonical), ADR-113 (Sphere Path B production wiring — direct 1:1 mirror pattern), ADR-104 (Path B expansion spec), ADR-049 P-5e-α (engine OFF + production ON pattern), LOCKED #43 (Z-up), LOCKED #44 (Complete Meaning per Merge) |

---

## 1. Canonical Anchor

ADR-104 β-2 Cone Path B atomic closure — **ADR-113 Sphere Path B wiring 1:1 mirror**. Engine + WASM + TS + Production wiring + 시연 + closure 모두 single PR (LOCKED #44).

**사용자 결재 anchor (2026-05-17)**:
> "네 승인합니다" — ADR-113 closure 직후 β-2 (Cone) 진입.

### 1.1 Q2 결정 revision

ADR-104 Amendment 1 §9.2 Q2 default 였던 "NURBS degenerate parameter edge + N base ring" 은 *부분적* polygonal — Sphere Q1 revision (Amendment 2: seam edge → 2-hemisphere) 와 *동일 논리* 로, base 도 polyline 대신 **closed-curve self-loop** 으로 통일. 본 ADR 가 채택.

**Cone Path B canonical (ADR-114)**:
- 1 base anchor vertex at `center + (radius, 0, 0)` (Z-up, ADR-103)
- 1 self-loop edge with `AnalyticCurve::Circle` (base circle)
- 2 faces:
  - **Base disk** (outer = HE-bwd, normal = -Z): `AnalyticSurface::Plane`
  - **Cone side** (outer = HE-fwd, normal varies radially): `AnalyticSurface::Cone` (apex degenerate at v=0)
- **0 apex vertex** (degenerate parameter point — accessible via `Surface::Cone.apex`)

Memory: **2 face / 1 edge / 1 vert** vs Path A 25/49/26 (default 24 segs) = **~92% reduction**.

## 2. β-2 sub-step closure 매트릭스

| Sub-step | scope | 상태 |
|---|---|---|
| β-2-α | spec (ADR-104 §11.1 + 본 ADR Q2 revision) | ✅ this PR |
| **β-2-β** | engine `create_cone_kernel_native` + 12 회귀 | ✅ this PR |
| **β-2-γ** | Mesh-level Map verify (single-loop per face, multi-loop schema 불필요) | ✅ unnecessary |
| **β-2-δ** | WASM bridge + TS wrapper + 4 회귀 | ✅ this PR |
| **β-2-ε** | Render `tessellate_face_surface` verification (zero-code-change) | ✅ this PR |
| **β-2-ζ** | `cone_path_b_default` flag + localStorage + production ON + 11 회귀 | ✅ this PR |
| **β-2-η** | Real Chromium 시연 + closure docs | ✅ this PR |

## 3. 본 PR 변경 사항

### 3.1 Engine layer (Rust)

- `crates/axia-geo/src/mesh.rs`:
  - `Mesh::cone_path_b_default: bool` field (mirror sphere, `#[serde(skip, default)]`)
  - `Mesh::create_cone_kernel_native(center, radius, height, material) -> Result<Vec<FaceId>>` — kernel-native cone with 2 hemisphere-like faces + base self-loop + Cone surface
  - +12 회귀 (face count / anchor vert / self-loop edge / surface attached / cone surface params canonical / invariants / 4 rejection cases / Z-up anchor / memory reduction)
- `crates/axia-geo/src/mesh_path_b.rs`:
  - `set_cone_path_b_default()` / `cone_path_b_default()` accessor methods
- `crates/axia-geo/src/operations/primitives.rs`:
  - `create_cone` dispatch — `if self.cone_path_b_default { return self.create_cone_kernel_native(...); }`
  - +6 dispatch 회귀 (mirror sphere β-1-ζ pattern)

### 3.2 WASM bridge (Rust)

- `crates/axia-wasm/src/lib.rs`: `setConePathBDefault` / `getConePathBDefault` exports (mirror sphere)

### 3.3 TypeScript bridge

- `web/src/bridge/WasmBridge.ts`: typed interface entries + wrapper methods
- `web/src/bridge/WasmBridge.test.ts`: +4 β-2 regression tests

### 3.4 Production layer (TS)

- `web/src/tools/ConePathBSettings.ts` (NEW): localStorage `axia:cone-path-b-mode` settings (1:1 mirror of SpherePathBSettings)
- `web/src/tools/ConePathBSettings.test.ts` (NEW): +5 regression tests
- `web/src/main.ts`: production layer wiring (default ON + onChange listener)

### 3.5 회귀 자산 (절대 #[ignore] 금지)

**axia-geo** (+18):
- mesh::tests (12 cone kernel-native):
  - `adr104_cone_kernel_native_face_count_2`
  - `adr104_cone_kernel_native_base_anchor_vertex_count_1`
  - `adr104_cone_kernel_native_base_self_loop_edge`
  - `adr104_cone_kernel_native_surface_attached_both_faces`
  - `adr104_cone_kernel_native_cone_surface_params_canonical`
  - `adr104_cone_kernel_native_invariants_pass`
  - `adr104_cone_kernel_native_rejects_zero_radius`
  - `adr104_cone_kernel_native_rejects_negative_radius`
  - `adr104_cone_kernel_native_rejects_zero_height`
  - `adr104_cone_kernel_native_rejects_negative_height`
  - `adr104_cone_kernel_native_zup_canonical_anchor_position`
  - `adr104_cone_kernel_native_memory_reduction_vs_path_a`
- operations::primitives::tests (6 dispatch):
  - `adr104_b2_zeta_engine_default_is_path_a_legacy`
  - `adr104_b2_zeta_path_b_active_after_flag_flip`
  - `adr104_b2_zeta_path_a_default_off_preserved`
  - `adr104_b2_zeta_path_a_explicit_off_after_toggle`
  - `adr104_b2_zeta_dispatch_invariants_pass`
  - `adr104_b2_zeta_path_b_dispatch_memory_reduction`

**vitest** (+9):
- WasmBridge.test.ts β-2-ζ (4)
- ConePathBSettings.test.ts (5, NEW)

**Total**: **+27 회귀**, 절대 #[ignore] 금지 27/27 준수.

axia-geo total: 1345 → **1363 PASS**
vitest total: 1864 → **1873 PASS**

## 4. 측정 매트릭스 (real Chromium preview)

### 4.1 Engine layer DCEL count (Path B vs Path A baseline)

| Cone count | Path A (default 24 segs) | Path B (canonical) | 감소율 |
|---|---|---|---|
| 1 | 25 face / 49 edge / 26 vert | **2 face / 1 edge / 1 vert** | **92.0% / 98.0% / 96.2%** |
| 5 | 125 face / 245 edge / 130 vert | **10 face / 5 edge / 5 vert** | **92.0% / 98.0% / 96.2%** |

### 4.2 Production runtime verification

- `bridge.getConePathBDefault()` = `true` ✓
- 5-cone stress test: linear scaling 2/1/1 per cone ✓
- All 3 primitive flags ON: cylinder ✓ / sphere ✓ / cone ✓
- Render path zero-code-change: `tessellate_face_surface` (Cone variant, ADR-031 Phase D) 자동 활용

## 5. Lock-ins

- **L-114-1** Single atomic PR per LOCKED #44 — Engine + WASM + TS + Production wiring 같은 의미 단위 (Cone Path B 활성)
- **L-114-2** ADR-113 1:1 mirror pattern — 모든 layer 가 sphere Path B production wiring 답습
- **L-114-3** Engine default OFF + production ON via localStorage (ADR-049 P-5e-α 답습)
- **L-114-4** Explicit OFF preference 보존 (`localStorage 'false'` 명시 시 Path A 보존)
- **L-114-5** Path A 회귀 자산 보존 (engine default OFF + dispatch 시점만 분기)
- **L-114-6** Render zero-code-change (`tessellate_face_surface` Cone variant 자연 활용)
- **L-114-7** ADR-046 P31 #4 additive only (`create_cone(...)` signature UNCHANGED)
- **L-114-8** Q2 revision lock-in: apex degenerate parameter point (DCEL vertex 아님), base = closed-curve self-loop (sphere Q1 Amendment 2 답습 — polyline approach 폐기)

## 6. 후속 트랙 (별도 ADR per LOCKED #44)

### β-3 — Torus Path B (ADR-104 §11.2)

- `Mesh::create_torus_kernel_native(center, major_radius, minor_radius, material) -> Result<FaceId>`
- 1 face with AnalyticSurface::Torus
- u/v 모두 periodic — 2 seam edges (axial + meridional) OR single face with implicit seams
- 본 ADR 1:1 mirror (별도 atomic PR)

### γ — ADR-104 §3.1 verification (별도 ADR)

- Boolean / Offset / Push-Pull surface-driven dispatch with Cone Path B
- STEP export NURBSSurface round-trip audit

## 7. Lessons

### L1 — Sphere → Cone 1:1 mirror 완전성

ADR-113 의 sphere production wiring 패턴이 cone 에 그대로 적용 — *새 architectural pattern 0*. 4-layer template (engine + WASM + TS + production) reproduction 가능성 증명.

**가이드**: β-3 Torus 도 본 PR 1:1 mirror — 같은 4-layer template 답습.

### L2 — Q2 unification with Q1 (canonical consistency)

ADR-104 Amendment 1 의 Q2 default ("NURBS degenerate edge + N base ring") 는 partial polygonal 이었음. Amendment 2 의 Q1 revision (sphere: seam → 2-hemisphere) 와 *동일 논리* 로, Cone 도 base 가 closed-curve self-loop 로 통일. 

**가이드**: β-3 Torus 의 seam 결정도 동일 논리 적용 — closed-curve self-loop pattern canonical.

### L3 — Memory unlock 정량적 consistency

| Primitive | Path A | Path B | 감소율 |
|---|---|---|---|
| Cylinder (ADR-094) | 25/69/46 | 3/2/2 | 95% |
| Sphere (ADR-113) | 289/561/290 | 2/1/1 | 99%+ |
| **Cone (ADR-114)** | **25/49/26** | **2/1/1** | **92%** |

모든 Path B = small constant DCEL (2 face / ≤2 edge / ≤2 vert). 향후 Torus 도 동일 패턴 예상 (1 face / 2 edge / 1 vert).

### L4 — LOCKED #44 의미 단위 분할의 가치 (재확인)

β-1 Sphere → β-2 Cone → β-3 Torus 의 atomic decomposition 이 *완벽하게 작동*. 각 PR 이 self-contained + 자동 dependency-free (각각 다른 primitive — 코드 충돌 0).

**가이드**: 향후 multi-primitive ADR (예: ADR-104) 의 closure 는 *항상* primitive 별 atomic PR.

## 8. Cross-link

- ADR-094 (Cylinder Path B-full canonical) — first Path B primitive
- ADR-113 (Sphere Path B production wiring) — direct 1:1 mirror source for 본 PR
- ADR-104 (Path B Expansion spec) + Amendment 2 (sphere Q1 revision precedent for cone Q2)
- ADR-049 P-5e-α (engine OFF + production ON pattern)
- ADR-031 Phase D (AnalyticSurface::Cone 인프라)
- ADR-091 §E L1 (Mesh-level Map canonical)
- LOCKED #43 (ADR-103 Z-up — apex at center + (0,0,height), base anchor at center + (radius,0,0))
- LOCKED #44 (Complete Meaning per Merge — single atomic PR anchor)
