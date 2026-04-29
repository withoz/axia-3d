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
