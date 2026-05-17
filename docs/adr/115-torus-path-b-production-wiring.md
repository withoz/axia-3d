# ADR-115 — Torus Path B Production Wiring (ADR-104 β-3 closure + Path B family complete)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β-3-β + γ + δ + ε + ζ + η atomic closure (single PR per LOCKED #44) |
| Date | 2026-05-17 |
| Supersedes | — |
| Closes | ADR-104 β-3 (Torus Path B), Amendment 1 §9.3 Q3 (revised — see §1.1). **ADR-104 Path B family complete** (cylinder + sphere + cone + torus). |
| Related | ADR-094 (Cylinder Path B-full canonical), ADR-113 (Sphere Path B production wiring), ADR-114 (Cone Path B production wiring), ADR-104 (Path B Expansion spec), LOCKED #43 (Z-up), LOCKED #44 (Complete Meaning per Merge) |

---

## 1. Canonical Anchor

ADR-104 β-3 Torus Path B atomic closure — **ADR-114 cone production wiring 패턴 1:1 mirror**. Engine + WASM + TS + Production wiring + 시연 + closure 모두 single PR (LOCKED #44 정합). **ADR-104 Path B family 완전 closure** (cylinder + sphere + cone + torus).

**사용자 결재 anchor (2026-05-17)**:
> "네 승인합니다" — ADR-114 cone closure 직후 β-3 (Torus) 진입.

### 1.1 Q3 결정 revision

ADR-104 Amendment 1 §9.3 Q3 default 였던 "2 seam edges (axial + meridional) + 1 vertex" 는 DCEL 4-HE outer boundary wiring 복잡성으로 별도 atomic 트랙으로 분리. 본 ADR-115 가 **1-loop canonical** 채택 (sphere/cone Q-revision 답습).

**Torus Path B canonical (ADR-115)**:
- 1 anchor vertex at `center + (major_radius + minor_radius, 0, 0)` (Z-up, outer equator u=0 v=0)
- 1 self-loop edge with `AnalyticCurve::Circle` (outer equator):
  - center = torus center
  - radius = `major_radius + minor_radius`
  - normal = `+Z`, basis_u = `+X`
- 1 face with `AnalyticSurface::Torus`:
  - full u/v range periodic: `(0, 2π) × (0, 2π)`
  - render via `tessellate_face_surface` (Torus variant, ADR-031 Phase D)

Memory: **1 face / 1 edge / 1 vert** vs hypothetical Path A 289 face / 577 edge / 289 vert = **~99.7% reduction**.

### 1.2 Q3 revision 근거 (canonical consistency)

| 항목 | 2-seam (Q3 default) | 1-loop (Q3 revision, 채택) |
|---|---|---|
| **DCEL 복잡도** | 4-HE outer boundary, 2 self-loop edges sharing anchor — radial chain wiring 복잡, manifold invariant 변형 가능 | 1 self-loop edge, sphere/cone와 동일 패턴 (검증된 simplest) |
| **Memory** | 1 face / 2 edge / 1 vert | **1 face / 1 edge / 1 vert** |
| **Topological strictness** | 2-seam 이 torus 를 disk 로 분할 — strict | 1 axial seam 단독은 torus 분할 못 함 (genus=1) — sphere/cone 와 *동일 한계* (single self-loop 가 위상적으로 boundary 아닌 cycle) |
| **Sphere Q1 / Cone Q2 답습** | 일관성 부재 (다른 패턴) | **canonical consistency** (3 primitives 모두 동일 self-loop pattern) |
| **Implementation 시간** | β-3 multi-day atomic | **β-3 single PR atomic** |
| **Memory unlock** | 동등 (99.6% vs 99.7%) | 동등 (실용 차이 0) |
| **Render quality** | 동등 (둘 다 tessellate_face_surface 활용) | 동등 |
| **Boolean/Offset dispatch** | 동등 | 동등 |

**Lesson**: Sphere Amendment 2 의 Q1 revision logic (Jordan curve theorem 평면 한정) 이 torus 에 동일 적용되지 않음 — torus 는 closed manifold (genus=1) 로 *애초에* single seam 으로 boundary 표현 불가. Sphere/Cone 와 동일하게 canonical consistency 우선 (2-seam 완전 정합은 별도 atomic).

## 2. β-3 sub-step closure 매트릭스

| Sub-step | scope | 상태 |
|---|---|---|
| β-3-α | spec (ADR-104 §11.2 + 본 ADR Q3 revision) | ✅ this PR |
| **β-3-β** | engine `create_torus_kernel_native` + 12 회귀 | ✅ this PR |
| **β-3-γ** | Mesh-level Map verify (single-loop per face, multi-loop 불필요) | ✅ unnecessary |
| **β-3-δ** | WASM bridge `createTorus` + flag + TS wrapper + 6 회귀 | ✅ this PR |
| **β-3-ε** | Render `tessellate_face_surface` Torus variant verification | ✅ this PR |
| **β-3-ζ** | `torus_path_b_default` flag + localStorage + production ON + 5 회귀 | ✅ this PR |
| **β-3-η** | Real Chromium 시연 (5-torus linear scaling) + closure docs | ✅ this PR |

## 3. 본 PR 변경 사항

### 3.1 Engine layer (Rust)

- `crates/axia-geo/src/mesh.rs`:
  - `Mesh::torus_path_b_default: bool` field (mirror cone, `#[serde(skip, default)]`)
  - `Mesh::create_torus_kernel_native(center, major_radius, minor_radius, material) -> Result<FaceId>` — kernel-native torus with 1 face + outer equator self-loop + Torus surface
  - +12 회귀 (face count / anchor vert / self-loop edge / surface attached / torus params canonical / 4 rejection / Z-up anchor / memory reduction / flag default / flag toggle)
- `crates/axia-geo/src/mesh_path_b.rs`:
  - `set_torus_path_b_default()` / `torus_path_b_default()` accessor methods

### 3.2 WASM bridge (Rust)

- `crates/axia-wasm/src/lib.rs`:
  - `createTorus(cx, cy, cz, major, minor)` — new primitive export (no Path A baseline, kernel-native only)
  - `setTorusPathBDefault` / `getTorusPathBDefault` flag exports

### 3.3 TypeScript bridge

- `web/src/bridge/WasmBridge.ts`: typed interface entries + wrapper methods (`create_torus`, flag accessors)
- `web/src/bridge/WasmBridge.test.ts`: +6 β-3 regression tests

### 3.4 Production layer (TS)

- `web/src/tools/TorusPathBSettings.ts` (NEW): localStorage `axia:torus-path-b-mode` settings (1:1 mirror of sphere/cone)
- `web/src/tools/TorusPathBSettings.test.ts` (NEW): +5 regression tests
- `web/src/main.ts`: production layer wiring (default ON + onChange listener)

### 3.5 회귀 자산 (절대 #[ignore] 금지)

**axia-geo** (+12, mesh::tests):
- `adr104_torus_kernel_native_face_count_1`
- `adr104_torus_kernel_native_anchor_vertex_count_1`
- `adr104_torus_kernel_native_outer_equator_self_loop_edge`
- `adr104_torus_kernel_native_surface_attached`
- `adr104_torus_kernel_native_torus_surface_params_canonical`
- `adr104_torus_kernel_native_rejects_zero_major_radius`
- `adr104_torus_kernel_native_rejects_zero_minor_radius`
- `adr104_torus_kernel_native_rejects_minor_geq_major`
- `adr104_torus_kernel_native_zup_canonical_anchor_position`
- `adr104_torus_kernel_native_memory_reduction_vs_path_a_baseline`
- `adr104_torus_kernel_native_flag_default_off`
- `adr104_torus_kernel_native_flag_toggle`

**vitest** (+11):
- WasmBridge.test.ts β-3 (6: create_torus + 4 flag + missing endpoint)
- TorusPathBSettings.test.ts (5, NEW)

**Total**: **+23 회귀**, 절대 #[ignore] 금지 23/23 준수.

axia-geo total: 1363 → **1375 PASS**
vitest total: 1873 → **1884 PASS**

## 4. 측정 매트릭스 (real Chromium preview)

### 4.1 Engine layer DCEL count (Path B baseline)

| Torus count | hypothetical Path A baseline | **Path B (canonical)** | 감소율 |
|---|---|---|---|
| 1 | 289 / 577 / 289 (typical N=24 M=12) | **1 / 1 / 1** | **99.65% / 99.83% / 99.65%** |
| 5 | 1445 / 2885 / 1445 | **5 / 5 / 5** | linear scaling ✓ |

### 4.2 Production runtime verification

- All 4 Path B flags ON: cylinder ✓ / sphere ✓ / cone ✓ / **torus ✓** ← **ADR-104 family complete**
- 5-torus stress: linear scaling 1/1/1 per torus
- Render path: `tessellate_face_surface` Torus variant (ADR-031 Phase D) zero-code-change activation, ~31K tris per torus (chord-tolerant)

## 5. Path B Family — ADR-104 Complete Closure 매트릭스

ADR-104 Path B Expansion 전체 closure 정량 결과:

| Primitive | ADR | PR | Path A | Path B | 감소율 |
|---|---|---|---|---|---|
| Cylinder | ADR-094 | (merged) | 25/69/46 | 3/2/2 | 95% |
| Sphere | ADR-113 | #76 (merged) | 289/561/290 | 2/1/1 | 99%+ |
| Cone | ADR-114 | #77 | 25/49/26 | 2/1/1 | 92% |
| **Torus** | **ADR-115 (본 PR)** | **#78 (this)** | **289/577/289** | **1/1/1** | **99.7%** |

**모든 Path B primitives = small constant DCEL** (≤3 face / ≤2 edge / ≤2 vert). Render quality 보존 + Boolean/Offset/Push-Pull NURBS direct dispatch 활성 + STEP export NURBSSurface round-trip 활성.

## 6. Lock-ins

- **L-115-1** Single atomic PR per LOCKED #44 (Engine + WASM + TS + Production wiring 같은 의미 단위)
- **L-115-2** ADR-114 1:1 mirror pattern (cone → torus, 4-layer template reproduction)
- **L-115-3** Engine default OFF + production ON via localStorage (ADR-049 P-5e-α 답습)
- **L-115-4** Explicit OFF preference 보존
- **L-115-5** No Path A baseline exists (torus kernel-native from day 1) — flag pattern preserved for consistency + future hook
- **L-115-6** Render zero-code-change (`tessellate_face_surface` Torus variant)
- **L-115-7** ADR-046 P31 #4 additive only (createTorus is new primitive — no signature break)
- **L-115-8** Q3 revision lock-in: 1-loop canonical (sphere/cone 답습 — *canonical consistency* > strict topological correctness)
- **L-115-9** ADR-104 Path B family closure — 모든 4 primitives (cylinder + sphere + cone + torus) production ON

## 7. 후속 트랙 (모두 별도 ADR per LOCKED #44)

### γ — Boolean / Offset / Push-Pull surface-driven dispatch verification

ADR-104 §3.1 §3.2: 모든 Path B primitives 의 NURBS direct dispatch (ADR-064/066 Boolean, ADR-080 Offset, ADR-079 Push-Pull) 의 surface-driven 자연 결합 verification.

### δ — STEP export NURBSSurface round-trip audit

ADR-035/036 P21.6 round-trip 1e-3 mm tolerance audit for all 4 Path B primitives.

### ε — Torus 2-seam DCEL atomic (deferred from Q3 default)

ADR-104 Amendment 1 §9.3 의 strict 2-seam approach. 1-loop canonical 위에서 별도 atomic 트랙으로 진행 가능 (Q3 revision §1.2 매트릭스 참조).

### ζ — User-facing tool integration (TorusTool)

`web/src/primitives/TorusTool.ts` (NEW) — UI primitive tool with 3-click flow (anchor → major_radius → minor_radius). 본 PR 범위 외 (engine + bridge + flag 만), 사용자 facing API 는 별도 PR.

## 8. Lessons

### L1 — Cone → Torus 1:1 mirror 완전성 (3rd successful template reproduction)

ADR-113 sphere → ADR-114 cone → **ADR-115 torus** — 모든 layer (engine + WASM + TS + production) 가 동일 template 으로 reproduction. **새 architectural pattern 0**, 시간 단축.

**가이드**: 향후 새 primitive 추가 (예: ellipsoid, prism) 도 본 4-layer template 답습 가능.

### L2 — Q-revisions canonical consistency (3-primitive lesson)

| Q | ADR | Original default | Revised |
|---|---|---|---|
| Q1 Sphere boundary | Amendment 2 | (c) seam | (b) 2-hemisphere |
| Q2 Cone apex | ADR-114 | NURBS degenerate + N base ring | **base = closed-curve self-loop** (sphere 답습) |
| Q3 Torus periodic | **ADR-115** | 2-seam | **1-loop outer equator** (sphere/cone 답습) |

**Canonical consistency 우선** (3-primitive cross-validation 후 lock-in): closed-curve self-loop pattern. 향후 새 primitive 도 본 패턴 우선 검토.

### L3 — Path B family completion architectural value

| Memory unlock | Cylinder | Sphere | Cone | Torus | 합계 |
|---|---|---|---|---|---|
| Path A face count (per primitive) | 25 | 289 | 25 | ~289 | 628 |
| Path B face count | 3 | 2 | 2 | 1 | **8** |
| 1000 primitive scene Path A | 628,000 | — | — | — | — |
| 1000 primitive scene Path B | 8,000 | — | — | — | **98.7% reduction** |

대규모 scene 에서 ADR-104 family closure 의 cumulative impact = **메모리 99%+ 절감 + NURBS direct ops 전체 활성 + STEP export 산업 CAD parity**.

### L4 — LOCKED #44 의미 단위 분할의 가치 (4-PR seq)

ADR-104 Path B expansion 의 4 primitive (cylinder/sphere/cone/torus) 가 **4 independent atomic PRs** 으로 자연 분리. 코드 conflict 0 (다른 primitive 의 다른 mesh.rs 함수), CI/review independent.

**가이드**: 향후 multi-component ADR (예: ADR-104 와 같은 family expansion) 의 closure 는 *항상* component 별 atomic PR — LOCKED #44 canonical.

## 9. Cross-link

- ADR-094 (Cylinder Path B-full canonical) — Path B family 의 first
- ADR-113 (Sphere Path B production wiring) — first 1:1 mirror
- ADR-114 (Cone Path B production wiring) — second 1:1 mirror, Q2 revision precedent
- ADR-104 (Path B Expansion spec) + Amendment 1 (Q3 default) + Q3 revision (본 ADR)
- ADR-049 P-5e-α (engine OFF + production ON pattern)
- ADR-031 Phase D (AnalyticSurface::Torus 인프라)
- ADR-091 §E L1 (Mesh-level Map canonical)
- LOCKED #43 (ADR-103 Z-up — axis_dir = +Z, ref_dir = +X, anchor at center+(R+r,0,0))
- LOCKED #44 (Complete Meaning per Merge — single atomic PR anchor)
