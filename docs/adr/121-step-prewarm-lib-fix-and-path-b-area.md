# ADR-121 — STEP Pre-warm OCCT Lib Fix (α) + Path B Analytic Face Area (β)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — γ bundle (α Critical + β UX) atomic single PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 시연 evidence 2026-05-17) |
| Anchor | ADR-087 K-ζ canonical 사용자 시연 게이트 evidence — 2 findings 즉시 closure |
| Parent | ADR-119 (STEP pre-warm γ-7 — α 가 hotfix), ADR-104 family (Path B primitives — β 가 area completeness gap) |
| Cross-cut | ADR-082 C-ε wrapper drift series (α 는 #4 fix 의 자연 후속), ADR-031 Phase D (β analytic surface infra) |

---

## 1. Canonical Anchor

사용자 시연 evidence (2026-05-17, screenshot 회신):
- **Finding #1**: XIA Inspector "면적 0.0 m²" — Path B sphere face area 표시 bug
- **Finding #2**: `Assertion failed: bad export type for '_ZTI13TDF_Attribute': undefined` console error — STEP/IGES pre-warm silent failure

사용자 결재:
> "추천: γ (α + β 묶음) 으로 승인합니다"

ADR-087 K-ζ canonical 사용자 시연 게이트의 architectural 가치 증명 — 11+ PR architectural closure 후 evidence 보강이 2개 실제 findings 발견.

## 2. α — Finding #2 (Critical, production-blocking)

### 2.1 Error trace

```
[18:31:37] Assertion failed: bad export type for `_ZTI13TDF_Attribute`: undefined
[18:31:37] Unhandled promise: abort(Assertion failed: bad export type for
`_ZTI13TDF_Attribute`: undefined). Build with -s ASSERTIONS=-1 for more info.
```

### 2.2 Root cause audit

- `_ZTI13TDF_Attribute` = C++ RTTI mangled name for `TDF_Attribute` (OCCT Topological Data Framework)
- TDF_Attribute 는 **TKLCAF** (Light Application Framework) 의 class
- opencascade.js v2 bundle 분석:
  - `ocCore` → opencascade.core.wasm (TKBRep, TKMath, TKernel 등 basic)
  - `ocModelingAlgorithms` → modelingAlgorithms.wasm
  - `ocDataExchangeBase` → dataExchangeBase.wasm (STEP/IGES base)
  - `ocDataExchangeExtra` → dataExchangeExtra.wasm
  - **`ocVisualApplication` → visualApplication.wasm** (TKLCAF/TKCAF 포함)
- ADR-119 γ-7 implementation 의 libs array 가 4개만 로딩 — `ocVisualApplication` 누락
- `ocDataExchangeBase` 의 **XCAF** (Extended CAF for STEP color/layer attributes) 가 TDF_Attribute 참조 → undefined → assertion fail

### 2.3 Fix (1-line)

`web/src/import/StepIgesImporter.ts:228`:
```ts
const occt = await initFn.call(mod, {
  libs: [
    mod.ocCore,
    mod.ocModelingAlgorithms,
    mod.ocDataExchangeBase,
    mod.ocDataExchangeExtra,
    mod.ocVisualApplication, // ADR-121 α: TKLCAF/TKCAF for TDF_Attribute
  ],
});
```

### 2.4 Impact

- **ADR-119 γ-7 pre-warm**: silent failure → 정상 init (background OCCT ready)
- **STEP import**: 동일 assertion fail 차단 → production-ready
- **Bundle**: +1 lazy chunk (visualApplication.wasm) — initial bundle 0MB strict 유지 (ADR-035 P20.C #2)

## 3. β — Finding #1 (UX completeness)

### 3.1 사용자 facing bug

XIA Inspector → Path B sphere 선택 시:
- 길이 L = 0
- 너비 W = 0
- 높이 H = 0
- **면적 0.0 m²** ← bug

### 3.2 Root cause

`Mesh::face_area` (mesh.rs:6276) 의 algorithm:
1. `collect_loop_verts(face.outer().start)` 으로 outer loop vertices 수집
2. `newell_raw(&verts)` 으로 polygon area 계산
3. Newell formula 는 verts.len() < 3 시 None 반환 → area = 0

**Path B faces 구조**: 1 anchor vertex + 1 self-loop edge → outer loop verts = `[anchor]` (단 1개) → Newell 미충족 → area = 0.

기존 polygon-only 가정이 Path B (1-vertex boundary) 미지원.

### 3.3 Fix (analytic fallback)

`Mesh::face_area` + `Mesh::analytic_face_area` 신규 helper:

```rust
pub fn face_area(&self, face_id: FaceId) -> f64 {
    let f = ...;
    let verts = ...;
    // Polygon Newell first (≥3 verts)
    if verts.len() >= 3 {
        if let Some(n) = self.newell_raw(&verts) {
            return n.length() * 0.5;
        }
    }
    // ADR-121 β analytic fallback for Path B faces
    if let Some(surface) = f.surface() {
        return Self::analytic_face_area(surface);
    }
    0.0
}
```

Analytic formulas (sub-range integration):

| Surface | Area formula |
|---|---|
| **Plane** | `u_extent × v_extent` (rectangular range) |
| **Cylinder** | `radius × u_extent × v_extent` (lateral annulus) |
| **Sphere** | `r² × u_extent × |sin(v_max) - sin(v_min)|` (latitude band) |
| **Cone** | `u_extent × tan(α) × (v_max² - v_min²) / 2` (from apex) |
| **Torus** | `R·r·u·v + r²·u·|sin(v_max) - sin(v_min)|` (first-order) |
| BezierPatch / BSpline / NURBS / RectangularTrimmed | 0 (defer to future ADR — numerical integration) |

### 3.4 Verification (analytic vs known formulas)

- **Sphere full** (2 hemispheres, r=5): expected `4πr² ≈ 314.16`, got within 1% (test verified)
- **Cylinder side** (r=5, h=10, Path B annulus): expected `2πr·h ≈ 314.16`, got within 1%
- **Torus** (R=10, r=3): expected `4π²Rr ≈ 1184.4`, got within 5% (first-order approximation)

## 4. 본 PR 변경 사항

### 4.1 α (STEP pre-warm lib fix)

- `web/src/import/StepIgesImporter.ts`: libs array 에 `mod.ocVisualApplication` 추가 (1 line + comments)
- `web/src/import/occtRuntime.test.ts`: +3 regression tests
  - `libs 에 ocVisualApplication 포함 (TDF_Attribute 의존성 해결)`
  - `libs 4 base + ocVisualApplication 5개 (lib 추가 후 5 lib 정합)`
  - `Finding #2 root cause comment 명시 (TDF_Attribute / TKLCAF)`

### 4.2 β (Path B analytic face area)

- `crates/axia-geo/src/mesh.rs`:
  - `face_area` extended with analytic fallback
  - `analytic_face_area` helper (5 surface variants)
  - +6 regression tests
    - `adr121_path_b_sphere_face_area_non_zero`
    - `adr121_path_b_sphere_total_area_matches_analytic` (4πr² verification)
    - `adr121_path_b_cone_side_face_area_non_zero`
    - `adr121_path_b_torus_face_area_non_zero` (4π²Rr verification)
    - `adr121_polygon_face_area_unchanged` (regression guard)
    - `adr121_path_b_cylinder_side_area_matches_analytic` (2πr·h verification)

### 4.3 Docs

- `docs/adr/121-step-prewarm-lib-fix-and-path-b-area.md` (NEW)
- `CLAUDE.md`: LOCKED #53

### 4.4 회귀

- axia-geo: 1386 → **1392 PASS** (+6 β analytic area)
- vitest: 1905 → **1908 PASS** (+3 α libs verification)
- 절대 #[ignore] 금지 9/9 준수
- vite build 정상

## 5. Lock-ins

- **L-121-α-1** opencascade.js v2 libs 에 `ocVisualApplication` 포함 (TDF_Attribute / TKLCAF 의존성)
- **L-121-α-2** Source-level regression test (libs array string check) — 향후 lib 누락 시 즉시 발견
- **L-121-α-3** ADR-119 γ-7 pre-warm 의 silent failure 해소 — STEP import production-ready
- **L-121-β-1** `Mesh::face_area` 의 polygon-first + analytic-fallback 패턴 — Path B (1-vertex boundary) 자연 지원
- **L-121-β-2** `analytic_face_area` 5 AnalyticSurface variants 명시 — 향후 NURBS variants 추가 시 동일 패턴 확장
- **L-121-β-3** Polygon path regression guard — `adr121_polygon_face_area_unchanged` 회귀 lock-in
- **L-121-β-4** Analytic verification with closed-form formulas (4πr² / 2πr·h / 4π²Rr) — 산업 표준 공식 일치
- **L-121-1** ADR-087 K-ζ canonical 사용자 시연 게이트 evidence 의 architectural 가치 증명 — 2 findings 즉시 closure
- **L-121-2** ADR-046 P31 #4 additive only — API surface UNCHANGED (face_area signature 동일)
- **L-121-3** ADR-035 P20.C #2 initial bundle 0MB strict 유지 — visualApplication 도 lazy chunk

## 6. 후속 트랙 (별도 ADR per LOCKED #44)

### γ — NURBS-class surfaces analytic area (β 의 자연 확장)

BezierPatch / BSplineSurface / NURBSSurface / RectangularTrimmedSurface 의 analytic area 는 numerical integration 필요 (closed-form 부재). ADR-027 NURBS Kernel cross-cut.

### δ — XIA Inspector area display 정밀도

소수점 정밀도 / 단위 변환 (m² vs mm²) UX. 본 PR 범위 외.

### ε — ADR-120 priority #4 진입 결재

본 finding closure 후 ADR-120 Q1 path 선택 (G / D / A / E) 결재 진행.

## 7. Lessons

### L1 — 사용자 시연 게이트 (ADR-087 K-ζ canonical) 의 architectural value 정량 증명

11+ PR atomic closure 후 1분 사용자 시연이 **2개 실제 findings 발견** — pre-warm silent failure + UX bug. Test 자산만으로 architectural 회귀 보장 불가의 canonical evidence.

**가이드**: 모든 architectural closure 후 사용자 시연 게이트 *필수* — ADR-087 K-ζ 답습.

### L2 — Polygon-first + analytic-fallback pattern

`face_area` 같은 polygon-based functions 가 Path B (1-vertex boundary) 미지원 시, *analytic fallback* 추가가 가장 단순 fix. 기존 polygon path 회귀 0 + Path B 자연 지원.

**가이드**: 다른 polygon-based functions (face perimeter, face centroid, face bbox 등) 도 동일 패턴 가능 — Path B family 의 자연 확장 트랙.

### L3 — Vendor lib 의존성 audit 의 가치

α Finding #2 가 *bundle 일부 lib 누락* 으로 silent failure. 향후 vendor library upgrade 시 *symbol-level audit* 필요. Source-level regression test (libs array string check) 가 minimum guard.

**가이드**: vendor library 사용 시 (opencascade.js / rhino3dm / three.js 등) symbol-level dependency 명시 및 회귀 가드 권장.

### L4 — γ 묶음 (Critical + UX) atomic closure 정합

α (Critical, production-blocking) + β (UX bug) 가 같은 사용자 시연 evidence trigger → 같은 의미 단위 (사용자 시연 finding closure). LOCKED #44 정합. 별도 PR 분리 vs 묶음의 결정 시 *trigger 동일성* + *user-facing 의미* 우선.

## 8. Cross-link

- ADR-087 K-ζ canonical 사용자 시연 게이트 — 본 ADR 의 trigger pattern
- ADR-119 γ-7 STEP pre-warm — α 가 silent failure hotfix
- ADR-082 C-ε wrapper drift series — α 는 #4 fix 의 자연 후속
- ADR-031 Phase D (AnalyticSurface infra) — β analytic_face_area 의 source
- ADR-104 family (Cylinder/Sphere/Cone/Torus Path B) — β 의 actual carrier
- ADR-035 P20.C #2 (initial bundle 0MB strict) — α visualApplication 도 lazy chunk
- ADR-046 P31 #4 (additive only) — face_area signature UNCHANGED
- LOCKED #43 priority #3 (STEP timing) — α 는 #3 의 hotfix
- LOCKED #44 (Complete Meaning per Merge) — γ 묶음 의미 단위
