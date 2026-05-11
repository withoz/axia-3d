# ADR-029: Free-form Curves — Bezier / B-spline (Phase B)

**Status**: **Accepted** (2026-04-29) — Phase B kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase B
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028 P13 (Analytic Edge Curve Foundation)
**Related**: ADR-019 (Line is Truth)

## Context

Phase A 완료 후 `AnalyticCurve` enum 은 Line / Circle / Arc 만 지원. 사용자
"자유 곡선" 요구 (벡터 그래픽 수준) 를 충족하려면 다항식 기반 free-form 곡선
필요.

산업 CAD 에서 free-form 곡선은:
- **Bezier curve**: 가장 단순, n+1 control points → degree n 다항식
- **B-spline**: piecewise Bezier, knot vector 로 구간 분할 — local 변형 가능
- **NURBS**: B-spline + weights (rational) — 정확한 conic section (Phase C)

Phase B 는 Bezier + B-spline 기초 구현. NURBS 는 Phase C 확장.

## Decision

### P14 — 새 원칙

> **Free-form curve 는 control points + (optional) knot vector 로 정의된다.**
> **Evaluation 은 numerically stable algorithm (de Casteljau / de Boor) 사용,**
> **자체 분석적 미분 + adaptive tessellation 지원.**

### P14 세부 규칙

**P14.1 — AnalyticCurve enum 확장**
```rust
pub enum AnalyticCurve {
    // Phase A
    Line { start: VertId, end: VertId },
    Circle { ... },
    Arc { ... },
    // Phase B (this ADR)
    Bezier {
        control_pts: Vec<DVec3>,   // n+1 points
        // degree = control_pts.len() - 1 (implicit)
    },
    BSpline {
        control_pts: Vec<DVec3>,   // n+1 points
        knots: Vec<f64>,           // m+1 knots, m = n + degree + 1
        degree: u32,                // 보통 3 (cubic)
    },
}
```

**P14.2 — Parameter range**
- Bezier: `t ∈ [0, 1]` (canonical)
- B-spline: `t ∈ [knots[degree], knots[knots.len() - degree - 1]]`
- 양쪽 endpoints 에서 control points 첫/끝과 일치 (clamped uniform)

**P14.3 — Evaluation algorithms**
- **Bezier**: de Casteljau (recursive linear interpolation, O(n²))
- **B-spline**: de Boor (extension of de Casteljau with knots, O(p²) per point where p = degree)
- 둘 다 numerically stable (vs. Bernstein/B-spline basis 직접 계산보다 안전)

**P14.4 — Derivative**
- **Bezier of degree n**: derivative is Bezier of degree n-1, control points
  `Q_i = n · (P_{i+1} - P_i)`
- **B-spline**: derivative is B-spline of degree p-1 with same interior knots
- 양쪽 모두 같은 algorithm 으로 평가 → 정확 / 빠름

**P14.5 — Tessellation**
- Adaptive subdivision: max chord error 기준
- Bezier: bisection at t=0.5, recurse if chord error > tol
- B-spline: knot insertion 후 sub-Bezier 추출 → Bezier subdivision

**P14.6 — Validation**
- Bezier: ≥ 2 control points (minimum: linear Bezier = line)
- B-spline:
  - degree ≥ 1
  - control_pts.len() ≥ degree + 1
  - knots.len() = control_pts.len() + degree + 1
  - knots non-decreasing

**P14.7 — Backward compatibility**
- Phase A 의 Line/Circle/Arc 동작 무변동
- 새 variants 는 enum 확장 — `#[serde]` 자동 호환 (variant 추가는 forward
  compat, 옛 파일은 새 variants 모름)

## Implementation Plan

### Module structure
```
crates/axia-geo/src/curves/
  mod.rs           — AnalyticCurve enum + CurveOps trait (Phase A)
  line.rs          — (Phase A)
  circle.rs        — (Phase A)
  arc.rs           — (Phase A)
  bezier.rs        — Phase B: de Casteljau + adaptive tessellation
  bspline.rs       — Phase B: de Boor + knot operations
```

### `bezier.rs` API
```rust
pub fn evaluate(control_pts: &[DVec3], t: f64) -> DVec3;
pub fn derivative(control_pts: &[DVec3], t: f64) -> DVec3;
pub fn tessellate(control_pts: &[DVec3], chord_tol: f64) -> Vec<DVec3>;
pub fn arc_length(control_pts: &[DVec3]) -> f64;  // adaptive Gauss-Legendre

// Internal helpers
fn de_casteljau(control_pts: &[DVec3], t: f64) -> DVec3;
fn subdivide(control_pts: &[DVec3], t: f64) -> (Vec<DVec3>, Vec<DVec3>);
fn derivative_control_pts(control_pts: &[DVec3]) -> Vec<DVec3>;
```

### `bspline.rs` API
```rust
pub fn evaluate(control_pts: &[DVec3], knots: &[f64], degree: usize, t: f64) -> Result<DVec3>;
pub fn derivative(...) -> Result<DVec3>;
pub fn tessellate(..., chord_tol: f64) -> Result<Vec<DVec3>>;
pub fn arc_length(...) -> Result<f64>;

// Internal
fn find_knot_span(knots: &[f64], degree: usize, t: f64) -> usize;
fn de_boor(control_pts: &[DVec3], knots: &[f64], degree: usize, span: usize, t: f64) -> DVec3;
fn knot_insert(...) -> (Vec<DVec3>, Vec<f64>);
```

## Tests (절대 #[ignore] 금지)

### `bezier.rs` (15+)
- linear_bezier_matches_line — degree 1 = line
- quadratic_evaluate_endpoints
- cubic_evaluate_endpoints
- de_casteljau_t_zero_returns_first_pt
- de_casteljau_t_one_returns_last_pt
- subdivide_t_half_concatenation_equals_original
- derivative_endpoint_matches_n_times_first_diff
- tessellate_chord_error_within_tol
- tessellate_lod_scales_with_tolerance
- arc_length_matches_distance_for_linear
- evaluate_outside_param_range_extrapolates_via_de_casteljau

### `bspline.rs` (15+)
- linear_bspline_matches_polyline
- cubic_uniform_bspline_smooth
- find_knot_span_correctness
- de_boor_endpoints_match_clamped_control_pts
- knot_insertion_preserves_geometry
- tessellate_chord_error_within_tol
- derivative_degree_drops_by_one
- evaluate_at_knot_value_continuous
- validate_invalid_knots_returns_err
- validate_too_few_control_pts_returns_err

### Integration (10+)
- analytic_curve_bezier_parameter_range_zero_one
- analytic_curve_bspline_parameter_range_clamped
- edge_with_bezier_curve_serializes
- edge_with_bspline_curve_serializes
- mesh_tessellate_edge_bezier_lod
- mesh_tessellate_edge_bspline_lod
- bezier_arc_length_increases_with_subdivision
- bspline_evaluate_continuous_across_knot

### WASM bridge (5+)
- setEdgeBezierCurve_marshalling
- setEdgeBSplineCurve_marshalling
- edgeCurveKind_returns_4_for_bezier
- edgeCurveKind_returns_5_for_bspline
- tessellateEdge_handles_bezier_path

## Migration

기존 도구 (DrawBezier, DrawCurve 같은 TS 도구) 가 사용 중이면 Phase A 마이그레
이션 패턴 (DrawCircle 처럼) 따라 점진 적용. Phase B 는 **API foundation 위주**,
도구 전환은 follow-up.

## Risks

- Adaptive tessellation 의 chord error 계산 — Bezier 의 control polygon 길이 -
  chord 길이 차이를 conservative bound 로 사용 (Phase B 채택)
- Knot vector validation 엄격 — invalid 시 명확한 에러
- Numerical stability 검증 — degree 6+ 는 별도 fuzzing test

## Success Criteria (Gate)

- ✅ Phase A 회귀 0건
- ✅ Phase B 신규 테스트 50+ 통과
- ✅ Bezier degree 5 까지 정확 (chord_tol 1e-3 mm)
- ✅ B-spline cubic uniform 표준 case 검증
- ✅ WASM 번들 증가 < 50 KB

## References

- Piegl & Tiller, *The NURBS Book*, Chapter 1 (Bezier), Chapter 2 (B-spline)
- Sederberg, *Computer Aided Geometric Design*, BYU lecture notes
- Farin, *Curves and Surfaces for CAGD*, Ch 3-5
