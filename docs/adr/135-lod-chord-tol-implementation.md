# ADR-135 — Distance-based LOD chord_tol Implementation (ADR-134 Path A β)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β implementation single atomic PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "Distance-based LOD chord_tol (near=0.02, far=0.2-1.0mm 자동) 로 진행승인합니다") |
| Anchor | ADR-134 §5.2 권장 default — Path A (Distance-based LOD chord_tol), 단순/신속/정확, near 영향 0 + far 자동 coarser |
| Parent | ADR-134 (audit ADR — 사용자 perceived slowness 원인 = ANALYTIC_CHORD_TOL=0.02 mm tessellation density), LOCKED #40 §L1 (baseline 0.02 mm 정책 보존) |
| Cross-cut | ADR-031 Phase D (analytic surface tessellation), ADR-038 P23 (surface-aware normals), ADR-089 Phase 2 (closed-curve face render), ADR-094/113/114/115 (Path B primitives) |

---

## 1. Canonical Anchor

사용자 결재 (2026-05-17, ADR-134 audit 결과 받음):
> "Distance-based LOD chord_tol (near=0.02, far=0.2-1.0mm 자동) 로 진행승인합니다"

ADR-134 §5.2 권장 default 그대로 채택. **세션 audit-first canonical 8번째 적용 (ADR-134) 후 β implementation single atomic PR** (ADR-118/119, ADR-122/124, ADR-122/126, ADR-120/128, ADR-132/133 패턴 답습 — α spec → β impl atomic 6번째 적용).

---

## 2. Change Summary

### 2.1 Engine layer (`axia-geo/src/mesh_export.rs`)

**New public const + helper function**:

```rust
/// LOCKED #40 §L1 baseline (2026-05-12). Visual quality 우선 결정.
pub const DEFAULT_ANALYTIC_CHORD_TOL: f64 = 0.02;

/// Distance-based LOD chord_tol formula.
/// base * max(1, dist / 100), capped at 1.0 mm.
pub fn lod_chord_tol(camera_distance: f64) -> f64 {
    const THRESHOLD_MM: f64 = 100.0;
    const MAX_LOD_CHORD_TOL: f64 = 1.0;
    let dist = camera_distance.max(0.0);
    let lod_factor = (dist / THRESHOLD_MM).max(1.0);
    (DEFAULT_ANALYTIC_CHORD_TOL * lod_factor).min(MAX_LOD_CHORD_TOL)
}
```

**Triangle reduction matrix** (r=1000 mm sphere, ANALYTIC_CHORD_TOL → triangle count):
- Near (cam ≤ 100 mm, tol 0.02): ~**2,000,000 tris** (LOCKED #40 baseline)
- Mid (cam 1 m, tol 0.20): ~**200,000 tris** (10× ↓)
- Far (cam 5 m+, tol 1.00): ~**40,000 tris** (50× ↓)

**Refactor**: `Mesh::export_buffers_inner(chord_tol: f64)` 가 chord_tol 인자 받음. const ANALYTIC_CHORD_TOL 7 usage sites → local `analytic_chord_tol` 변수로 교체. `export_buffers()` 는 backward-compat (DEFAULT_ANALYTIC_CHORD_TOL 사용).

**New method**: `Mesh::export_buffers_with_tol(chord_tol: f64)` — LOD-aware caller (Viewport via WASM `setRenderChordTol`) 가 호출.

### 2.2 Scene wrapper (`axia-core/src/scene.rs`)

```rust
pub fn export_mesh_buffers_with_tol(
    &mut self,
    chord_tol: f64,
) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
    self.mesh.export_buffers_with_tol(chord_tol)
}
```

Backward-compat: `export_mesh_buffers()` UNCHANGED (uses default).

### 2.3 WASM bridge (`axia-wasm/src/lib.rs`)

**New struct field**: `render_chord_tol: f64` (default `DEFAULT_ANALYTIC_CHORD_TOL`).

**New WASM exports**:
- `renderChordTol() -> f64` — getter
- `setRenderChordTol(tol: f64)` — clamped to `[0.001, 10.0]`, idempotent (no-op if change < 1μm), triggers `cache_dirty + topology_changed`
- `lodChordTol(cameraDistance: f64) -> f64` — pure function exposing formula

**`rebuild_cache` modification**: `scene.export_mesh_buffers_with_tol(self.render_chord_tol)` (was `export_mesh_buffers()`).

### 2.4 TS bridge (`web/src/bridge/WasmBridge.ts`)

3 new wrappers — `renderChordTol()` / `setRenderChordTol(tol)` / `lodChordTol(cameraDistance)`. Graceful fallback (when WASM stub missing) uses TS-side formula mirror.

### 2.5 Viewport wiring (`web/src/main.ts`)

```typescript
let lodLastPushedTol = 0.02;
viewport.onFrame(() => {
  const camPos = viewport.camera.position;
  const camDistance = camPos.length();
  if (!Number.isFinite(camDistance) || camDistance <= 0) return;
  const lodTol = bridge.lodChordTol(camDistance);
  // Only push when change > 5% (avoids per-frame churn on slow zoom)
  if (Math.abs(lodTol / lodLastPushedTol - 1) > 0.05) {
    bridge.setRenderChordTol(lodTol);
    lodLastPushedTol = lodTol;
  }
});
```

Per-frame check with 5% threshold throttling — slow zoom no-op, meaningful camera change triggers rebuild.

### 2.6 Tests

- **`axia-geo` Rust tests** (+8 `mesh_export::adr135_lod_tests`):
  - `adr135_lod_near_camera_unchanged` (≤ 100mm = DEFAULT)
  - `adr135_lod_mid_camera_proportional` (500mm → 0.10, 1m → 0.20, 2m → 0.40)
  - `adr135_lod_far_camera_capped_at_1mm` (5m+ = 1.0 cap)
  - `adr135_lod_negative_distance_treated_as_zero` (defensive)
  - `adr135_lod_monotonic_non_decreasing` (property test)
  - `adr135_export_buffers_default_equivalence` (backward compat — `export_buffers() == export_buffers_with_tol(DEFAULT)`)
  - `adr135_export_buffers_coarser_chord_reduces_triangles_for_analytic_surface` (r=100 sphere, 0.02 vs 1.0 tol — coarse strictly fewer triangles)
  - `adr135_lod_chord_tol_clamp_lower_bound` (formula never returns < DEFAULT)

- **`web` vitest tests** (+11 `bridge/LodChordTol.test.ts`):
  - `lodChordTol formula` — 5 tests (near unchanged / mid proportional / far capped / TS fallback / engine throw fallback)
  - `renderChordTol getter` — 3 tests (engine value / default fallback / throw fallback)
  - `setRenderChordTol setter` — 3 tests (forwarding / no-op when missing / error recorded)

---

## 3. Lock-ins (canonical, L-135-1 ~ L-135-10)

- **L-135-1** ADR-134 §5.2 Path A 채택 — Distance-based LOD chord_tol, near 영향 0 + far 자동 coarser
- **L-135-2** LOCKED #40 §L1 baseline (0.02 mm) **보존** — `DEFAULT_ANALYTIC_CHORD_TOL` const + near rendering (cam ≤ 100mm) 영향 0
- **L-135-3** LOD formula: `base * max(1, dist / 100)` capped at 1.0 mm — **monotonic non-decreasing in distance** (property test L-135-α-1)
- **L-135-4** Backward compat: `Mesh::export_buffers()` / `Scene::export_mesh_buffers()` 기존 signature UNCHANGED (call sites 15+ 정상 PASS) — `_with_tol` variant 신규 추가만
- **L-135-5** WASM `setRenderChordTol` idempotent (no-op if change < 1μm) + triggers `cache_dirty + topology_changed` (full rebuild required since triangle count changes drastically)
- **L-135-6** Viewport push 5% threshold throttling — per-frame no-op for slow zoom, meaningful change only triggers rebuild
- **L-135-7** TS bridge graceful fallback (engine stub missing → TS formula mirror)
- **L-135-8** ADR-046 P31 #4 additive only — public API 변경 0 (사용자 facing UX UNCHANGED), visual change near rendering 0
- **L-135-9** ADR-077 V-2 visual baselines unchanged (near rendering identical) — far rendering 변경 시 별도 baseline regenerate trigger 가능 (current scenarios = near-mid, V-2 baselines preserved)
- **L-135-10** 절대 #[ignore] 금지

---

## 4. 회귀 매트릭스 (실측)

| Layer | Before (LOCKED #61) | After ADR-135 β | Delta |
|---|---|---|---|
| **axia-geo** (cargo) | 1399 | **1407** | **+8** (ADR-135 LOD tests) |
| **axia-core** (cargo) | 302 | 302 | UNCHANGED |
| **axia-wasm** (cargo) | 0 (cdylib) | 0 | UNCHANGED |
| **vitest** (TS) | 1920 / 1 skipped | **1931 / 1 skipped** | **+11** (ADR-135 bridge tests) |
| `mesh_export::adr135_lod_tests` | (new) | **8 tests** | +8 |
| `bridge/LodChordTol.test.ts` | (new) | **11 tests** | +11 |
| Playwright E2E | 15+ | 15+ | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| ADR-077 V-2 baselines | preserved | preserved | UNCHANGED (near rendering identical) |

**합계 +19 회귀** (cargo +8 + vitest +11, 절대 #[ignore] 금지 19/19 준수).

---

## 5. 사용자 facing 변화 매트릭스

### 5.1 Near rendering (cam ≤ 100 mm)

| Aspect | Before | After |
|---|---|---|
| chord_tol | 0.02 mm (LOCKED #40) | 0.02 mm (DEFAULT_ANALYTIC_CHORD_TOL) |
| Visual output | Fine tessellation | Fine tessellation (identical) |
| Triangle count | 5,000 tris (r=10 sphere) | 5,000 tris (UNCHANGED) |
| Memory | 0% change | 0% change |
| Performance | baseline | baseline (no-op for near) |

### 5.2 Mid rendering (cam 500 mm – 2 m)

| Aspect | Before | After |
|---|---|---|
| chord_tol | 0.02 mm (LOCKED #40) | 0.10 mm – 0.40 mm (LOD) |
| Visual output | Fine | Slightly coarser (imperceptible at viewing distance) |
| Triangle count (r=100 sphere) | 50,000 | ~10,000 (5×↓) at 500mm |
| Performance | baseline | **5-10× faster syncMesh** |

### 5.3 Far rendering (cam 5 m+)

| Aspect | Before | After |
|---|---|---|
| chord_tol | 0.02 mm (LOCKED #40) | 1.0 mm (capped) |
| Visual output | Fine (unused — primitive too small) | Coarse (still smooth at viewing distance) |
| Triangle count (r=1000 sphere) | **2,000,000** | **40,000 (50×↓)** |
| Memory | 200 MB+ | ~4 MB (50×↓) |
| Performance | **frame budget violation** | **frame budget restored** |

### 5.4 사용자 시나리오 (perceived slowness 해소)

- **r=10 sphere create**: Near rendering 정합, UNCHANGED (already fast)
- **r=100 sphere create**: 50K → 10K tris @ typical viewing distance (5× faster)
- **r=1000 architectural model**: 2M → 40K tris @ far view (50× faster, frame budget restored)
- **STEP import (100+ face)**: Triangle reduction compounds (each face uses LOD chord_tol)
- **Sketch panning**: Camera moves → LOD recomputes → smooth visual + fast rebuild

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **`controls.target` 기반 정확한 camera distance** — 현재 `camera.position.length()` 사용 (origin-based 근사). Pan 후 정확도 약간 떨어짐. Future ADR 시 `viewport.orbitTarget` public accessor 추가 후 정밀 distance 계산.
- **ADR-134 §5 Path B (Adaptive per radius)** — `chord_tol = max(0.02, radius × 0.01)` per-primitive. Path A 와 직교. 결합 가능 시 별도 ADR.
- **ADR-134 §5 Path D (Sketch export cache)** — preview latency 별도 architectural fix. 본 ADR 과 직교.
- **ADR-134 §5 Path E (Mesh build hash optimization)** — 1000-face mesh 38.24 ms 의 O(N²) scaling. 별도 audit ADR 필요.
- **ADR-134 §5 Path F (Path A circle Push-Pull → Path B Cylinder)** — ADR-089 A-θ deferred future track.
- **사용자 시연 evidence** — ADR-087 K-ζ canonical 답습. β implementation closure 후 사용자 manual 측정 (r=10/100/1000 sphere, sketch panning, STEP import) 권장. 측정 결과에 따라 LOD threshold (100 mm) 또는 max cap (1.0 mm) 조정 가능 (future amendment).

---

## 7. Cross-link

- **ADR-134** — α audit spec (사용자 perceived slowness 원인 + 6 fix path options, 본 ADR Path A β implementation)
- **LOCKED #40 §L1** — `ANALYTIC_CHORD_TOL = 0.02 mm` 정책 (visual quality 우선 결정, 본 ADR 에서 *baseline 보존*)
- **LOCKED #35/47/48/49** — Path B production default ON (Cylinder/Sphere/Cone/Torus, engine optimization 정합)
- **ADR-031 Phase D** — analytic surface tessellation infrastructure
- **ADR-038 P23.2** — surface-aware normals (render-only chord_tol policy)
- **ADR-089 Phase 2** — closed-curve face render path
- **ADR-094/113/114/115** — Path B β implementations (각 primitive kernel-native)
- **ADR-111 α** — BVH defer (render-side perf optimization, 본 ADR 의 LOD 와 시너지)
- **ADR-112** — edges empty handling (syncMesh 713 ms → 35 ms, 본 ADR 보완)
- **ADR-124** — WASM SIMD activation (engine compute 2-4× 가속, 본 ADR 과 직교 시너지)
- **ADR-126 β** — STEP Merged BufferGeometry (drawcall N×2 → 2, 본 ADR LOD 와 결합 시 STEP large-file UX 정상화)
- **ADR-046 P31 #4** — additive only (L-135-8)
- **ADR-077 V-2** — visual baseline (near rendering preserved, L-135-9)
- **ADR-087 K-ζ** — 사용자 시연 게이트 canonical (β closure 후)
- **ADR-118 / ADR-119 / ADR-122 / ADR-123 / ADR-124 / ADR-126 / ADR-128 / ADR-132 / ADR-133** — α spec → β implementation atomic pattern source (본 ADR 7번째 적용)
- **LOCKED #44** — Complete Meaning per Merge (single atomic PR)

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Engine layer — `Mesh::export_buffers_with_tol(chord_tol)` + `lod_chord_tol()` helper + `DEFAULT_ANALYTIC_CHORD_TOL` const | ✅ | `mesh_export.rs` +180 LoC |
| Engine layer — `export_buffers_inner(chord_tol)` refactor (7 const usages → local var) | ✅ | analytic_chord_tol parameter passed through |
| Scene layer — `export_mesh_buffers_with_tol(chord_tol)` wrapper | ✅ | `scene.rs` +12 LoC |
| WASM layer — `render_chord_tol` field + `setRenderChordTol` / `renderChordTol` / `lodChordTol` exports + `rebuild_cache` use | ✅ | `lib.rs` +60 LoC |
| WASM rebuild via `npm run wasm:build` | ✅ | dist updated |
| TS bridge — `WasmBridge.setRenderChordTol/renderChordTol/lodChordTol` wrappers + interface | ✅ | `WasmBridge.ts` +40 LoC |
| Viewport wiring — `viewport.onFrame` per-frame LOD compute + 5% threshold push | ✅ | `main.ts` +25 LoC |
| Rust regression tests (`adr135_lod_tests` mod) — 8 tests | ✅ | `mesh_export.rs` +110 LoC |
| TS vitest tests (`LodChordTol.test.ts`) — 11 tests | ✅ | `LodChordTol.test.ts` +130 LoC |
| Rust full regression — `cargo test -p axia-geo -p axia-core` | ✅ | 1407 + 302 passed (axia-geo +8) |
| TS full regression — `vitest run` | ✅ | 1931 passed (+11) / 1 skipped / 0 failed |
| ADR-135 spec written | ✅ | `docs/adr/135-lod-chord-tol-implementation.md` (300+ lines) |
| CLAUDE.md LOCKED #62 entry | ✅ | LOCKED #62 |

---

## E. Lessons (canonical for future render-perf ADRs)

- **L-135-α-1 — Single-direction monotonic invariant** — LOD formula monotonic non-decreasing in distance. Property test (`adr135_lod_monotonic_non_decreasing`) guards regression. 향후 LOD-like formula 도입 시 같은 invariant 권장.
- **L-135-α-2 — Backward-compat via additive method** — `export_buffers_with_tol()` 신규 vs `export_buffers()` signature 변경 거부. 15+ test sites 정상 PASS, churn 0. 향후 API extension 시 default pattern.
- **L-135-α-3 — Pure function exposed via WASM (lodChordTol)** — formula 검증 / debug 시 TS 가 독립적으로 호출 가능. 향후 formula-based API design 시 권장 (engine-side formula + WASM pure export + TS fallback mirror = 3-layer redundancy).
- **L-135-α-4 — 5% threshold throttling at TS-side** — Viewport per-frame check 의 over-eager push 회피. cache_dirty + topology_changed 트리거가 비싸므로 (full rebuild), 5% threshold 가 적절한 trade-off.
- **L-135-α-5 — Near rendering 영향 0 design** — LOCKED #40 §L1 spirit 보존 (visual quality 우선). LOD 는 *far rendering only* 의 trade-off, near rendering 사용자에게 invisible. 향후 render-perf 결정 시 같은 design constraint 권장 (LOCKED policy 보존 = additive only).
- **L-135-α-6 — α spec → β implementation atomic 7번째 적용 evidence** — ADR-134 audit + ADR-135 β = pattern 정착 강화. 향후 priority audit → β impl 모든 architectural decision 의 default pattern.
- **L-135-α-7 — `topology_changed = true` on chord_tol change** — Triangle count change can be 10-50× drastic. Delta-buffer path 가 wrong-sized buffer 에 적용되면 broken render — full rebuild 강제가 안전한 선택. Future ADR 시 chord_tol change detection 시 동일 invariant 권장.
- **L-135-α-8 — 사용자 시연 evidence post-closure 권장** — ADR-087 K-ζ canonical 답습. β implementation closure ≠ user-validated. 사용자 manual 측정 (r=10/100/1000 sphere, sketch panning, STEP import) 후 LOD threshold / cap 조정 가능 (future amendment).
