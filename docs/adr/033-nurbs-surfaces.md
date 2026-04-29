# ADR-033: NURBS Surfaces (Phase E)

**Status**: **Accepted** (2026-04-29) — Phase E kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase E
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028, ADR-029, ADR-030, ADR-031, ADR-032

## Context

Phase D 로 5개 analytic surface primitive (Plane/Cylinder/Sphere/Cone/Torus)
완성. Phase E 는 산업 표준 free-form surface — Bezier patch + B-spline
surface + NURBS surface + Trimmed surface.

### 산업 활용
- Loft / Sweep / Revolve 결과는 NURBS surface
- STEP / IGES 의 surface 표현이 NURBS
- Trimmed NURBS = 외부 + 내부 trim curves 로 잘린 NURBS surface (산업 CAD 의 face 표현)

## Decision

### P18 — 새 원칙

> **Surface 도 curve 와 동일한 위계를 갖는다: Plane (= Line), Bezier patch
> (= Bezier), B-spline surface (= B-spline), NURBS surface (= NURBS).**
> **모든 free-form surface 는 tensor product 형식 — 두 매개변수 (u, v) 에**
> **대해 1D basis function 의 곱으로 표현. Evaluation 은 1D 알고리즘
> (de Casteljau / de Boor) 을 u, v 에 순차 적용.**

### P18 세부 규칙

**P18.1 — AnalyticSurface enum 확장**
```rust
pub enum AnalyticSurface {
    // Phase D
    Plane, Cylinder, Sphere, Cone, Torus,
    // Phase E (this ADR)
    BezierPatch {
        ctrl_grid: Vec<Vec<DVec3>>,   // [(deg_u + 1) × (deg_v + 1)] grid
    },
    BSplineSurface {
        ctrl_grid: Vec<Vec<DVec3>>,   // [(n+1) × (m+1)] grid
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: u32,
        deg_v: u32,
    },
    NURBSSurface {
        ctrl_grid: Vec<Vec<DVec3>>,
        weights: Vec<Vec<f64>>,        // [(n+1) × (m+1)] weight grid
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: u32,
        deg_v: u32,
        trim_loops: Vec<TrimLoop>,     // 2D parameter-space loops
    },
}

pub struct TrimLoop {
    pub curves: Vec<TrimCurve2D>,
    pub is_outer: bool,
}

pub enum TrimCurve2D {
    Line { a: [f64; 2], b: [f64; 2] },
    Arc { center: [f64; 2], radius: f64, start_angle: f64, end_angle: f64 },
    Bezier { control_pts: Vec<[f64; 2]> },
    BSpline { control_pts: Vec<[f64; 2]>, knots: Vec<f64>, degree: u32 },
}
```

**P18.2 — Tensor product evaluation**
- BezierPatch `S(u, v) = Σ_i Σ_j B_i^p(u) · B_j^q(v) · P_{ij}`:
  - 알고리즘: 각 행 `i` 에 대해 de Casteljau in `v` → curve_i(v).
    그 결과 (deg_u + 1) 개 점을 다시 de Casteljau in `u` → 최종 점.
- B-spline surface: 동일 패턴, de Boor 사용.
- NURBS surface: 4D B-spline lift (각 ctrl point 를 (w·P, w) 로) +
  tensor product de Boor + project back.

**P18.3 — Derivatives**
- ∂S/∂u: 각 행 `i` 의 v-방향 evaluation 후, deg_u-1 차 hodograph 적용
- ∂S/∂v: 대칭
- Normal: `(∂S/∂u) × (∂S/∂v)`, normalize

**P18.4 — Tessellation**
- u, v 각각 sagitta-based segment count
- Phase D 의 grid tessellation 재사용
- Trim curves 적용: 2D parameter space 에서 trim 외부 영역 제거 (Phase E
  MVP 에선 untrimmed 만, full trim handling 은 Phase F 와 통합)

**P18.5 — Validation**
- ctrl_grid: 직사각형 (모든 행 같은 길이)
- ctrl_grid 크기 ≥ (deg_u + 1) × (deg_v + 1)
- knots: 비감소, 길이 = ctrl + degree + 1 (각 axis)
- weights: 모두 > 0 (NURBS only)
- TrimLoop 가 비어 있으면 untrimmed (full surface)

**P18.6 — Backward Compatibility**
- 기존 5 primitive 동작 무변동
- 새 variants 추가만 (enum 확장은 forward compat)

## Implementation

### Module structure
```
crates/axia-geo/src/surfaces/
  mod.rs               # AnalyticSurface enum + SurfaceOps trait (Phase D)
  plane.rs / ...       # Phase D primitives
  bezier_patch.rs      # Phase E: bicubic/bilinear Bezier
  bspline_surface.rs   # Phase E: tensor B-spline
  nurbs_surface.rs     # Phase E: rational tensor + trim
  trim.rs              # Phase E: 2D trim curve handling
```

## Tests (절대 #[ignore] 금지)

### Per-primitive (15+ each)
- evaluate_corner_points
- evaluate_unit_weights_matches_bspline
- evaluate_full_circle_when_used_as_cylinder
- derivative_u_v_orthogonal_at_corners (where applicable)
- normal_unit_length
- tessellate_chord_error_within_tol
- LOD scaling

### Integration (10+)
- mesh_set_face_surface_bezier_patch
- mesh_set_face_surface_nurbs
- nurbs_surface_serialize_roundtrip
- trim_loop_storage_preserves

## Risks

- **Numerical stability**: high-degree NURBS surfaces (deg ≥ 5) — boundary
  case watch. MVP focuses on ≤ degree 3.
- **Trim curve handling**: Full trim (clipping + topology) is complex.
  Phase E stores trim_loops as data; full clipping is Phase F's task.
- **Performance**: tensor product evaluation is O(p²) per point. Tessellation
  scales as O(N² · p²) where N is grid resolution.

## Amendment v1.1 (2026-04-29) — Kernel Hardening

Kernel-architect review (사용자 5가지 지적) 반영. Phase F (SSI) 진입 전 **계약
명시화 + 안전성 강화**.

### P18.7 — Degree validation

**원칙**: Free-form surface variants 는 `deg_u ≥ 1 AND deg_v ≥ 1` 강제.
- `1×N` 또는 `N×1` 그리드는 surface 가 아닌 curve → degenerate, validate 거부.
- BezierPatch 는 `ctrl_grid.len() ≥ 2 AND ctrl_grid[0].len() ≥ 2` 검증.

### P18.8 — Parameter range policy (raw vs strict)

**원칙**: 두 모드 명시 분리:
- `evaluate(u, v)` — **raw**: u, v 범위 외 extrapolation 허용 (Newton's
  method overshoot 흡수용 — CCI 와 일관)
- `evaluate_strict(u, v)` — **strict**: 범위 외 → `Err` (trim curve eval,
  SSI marching boundary 등에서 사용)
- 각 호출자는 자신의 contract 에 맞춰 선택. 정책은 함수명으로 명시.

### P18.9 — Normal direction contract (formal)

**원칙**: `normal(u, v) = (∂P/∂u × ∂P/∂v).normalize_or_zero()`.
- **Right-handed parametric convention** — 절대 변경 안 함.
- "Outward" 방향은 **caller 의 parameterization 책임** — 패치 grid 의 v-axis
  를 reverse 하면 normal 도 flip. ADR-007 winding 과 정합 시키려면 caller 가
  surface 부착 전에 grid 검증 / 조정.
- SSI / Boolean / Trim 의 inside-outside 판정은 **이 normal contract 를 신뢰**.

### P18.10 — Surface ≠ Face (conceptual contract)

**원칙**: AnalyticSurface 는 **pure geometric surface** 이며 **face 가 아님**.

```
[Geometric Surface]   AnalyticSurface (current — pure math)
    ↓
[Trimmed Surface]    Surface + uv_bounds + trim_loops
    ↓
[Topological Face]   Face struct (DCEL boundary + trimmed surface attached)
```

- BezierPatch / BSplineSurface / NURBSSurface — geometry truth
- `Face.surface: Option<AnalyticSurface>` — surface 부착 후 face 가 wrapping
- Phase F 진입 시 SSI sub-patch tracking 위한 `SubPatch { surface, uv_min,
  uv_max }` wrapper 별도 도입 (별도 ADR)

### P18.11 — BezierPatch uv_bounds (partial-patch 지원)

**원칙**: BezierPatch 는 canonical [0, 1]² 위에서 정의되지만, Face 가 활용
하는 sub-region 을 명시할 수 있어야 한다.

```rust
BezierPatch {
    ctrl_grid: Vec<Vec<DVec3>>,
    #[serde(default = "default_uv_bounds")]
    uv_bounds: ((f64, f64), (f64, f64)),  // 기본 [0,1]²
}
```

- `evaluate(u, v)` 는 ctrl_grid 의 canonical [0, 1]² 에서 평가 (변경 없음)
- `parameter_range()` 는 `uv_bounds` 반환 (face 의 활용 영역)
- 기존 시스템 호환: `#[serde(default)]` 로 옛 데이터는 [0, 1]² 로 load

### P18.12 — Helper methods (SSOT 유지)

**원칙**: 명시 필드 추가 대신 **computed helper** 로 일관성 보장:
- `BezierPatch::deg_u() → usize` = `ctrl_grid.len() - 1`
- `BezierPatch::deg_v() → usize` = `ctrl_grid[0].len() - 1`
- 메타-원칙 #4 (SSOT) 위반 방지: redundant 필드 추가 거부.

### P18.13 — Phase F 진입 체크리스트

다음 항목들이 Phase F 시작 전 완료되어야 함:
- ✅ P18.7~P18.12 (이 amendment)
- ⏳ `split_u(t) / split_v(t)` — tensor de Casteljau (Phase F 시작 시)
- ⏳ BBox in (x,y,z) 와 (u,v) 공간
- ⏳ `is_planar / is_degenerate` heuristic
- ⏳ Curvature magnitude (adaptive subdivision)

## Success Criteria (Gate 3 — Month 21)

- ✅ Phase A~D' 회귀 0건
- ✅ Phase E 신규 테스트 80+ 통과
- ✅ Bezier patch evaluate corner exactness 1e-12
- ✅ NURBS surface unit-weights == BSpline surface
- ✅ WASM 번들 증가 < 200 KB

## References

- Piegl & Tiller, *The NURBS Book*, Chapter 3 (B-spline surfaces),
  Chapter 4 (NURBS surfaces), Chapter 12 (Surface fitting)
- Sederberg, *CAGD lecture notes*, Chapter 8-9
