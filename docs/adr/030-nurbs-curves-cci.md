# ADR-030: NURBS Curves + Curve-Curve Intersection (Phase C)

**Status**: **Accepted** (2026-04-29) — Phase C kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase C
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028 (Phase A), ADR-029 (Phase B)

## Context

Phase A/B 로 Line/Circle/Arc + Bezier + B-spline 분석적 곡선 완비.
Phase C 는 산업 CAD 표준 NURBS 곡선 + curve-curve intersection (CCI).

### NURBS 의 의미
- **Non-Uniform Rational B-Spline**
- B-spline + 각 control point 의 가중치 (`weight`)
- **정확한 conic section 표현**: 원, 타원, 포물선, 쌍곡선 모두 단일 NURBS 로
  표현 가능 (degree 2 + 적절한 weight)
- 산업 CAD 표준 (STEP, IGES, ACIS, Parasolid 모두 NURBS 채택)

### CCI 의 의미
- 두 곡선의 교차점 계산
- Boolean / trim / split 의 기초 연산
- Phase F (SSI) 대비 1D 단순화 — 충분히 robust 구현 가능

## Decision

### P15 — 새 원칙

> **NURBS curve 는 control points + weights + knot vector + degree 로 정의된다.**
> **Evaluation 은 homogeneous coordinate lifting (4D B-spline) 으로 수치적**
> **안정성을 보장한다. CCI 는 Bezier subdivision (bbox prune) + Newton 정밀화**
> **로 robust 하게 계산한다.**

### P15 세부 규칙

**P15.1 — AnalyticCurve enum 확장**
```rust
pub enum AnalyticCurve {
    // Phase A
    Line, Circle, Arc,
    // Phase B
    Bezier { control_pts },
    BSpline { control_pts, knots, degree },
    // Phase C (this ADR)
    NURBS {
        control_pts: Vec<DVec3>,    // 위치 (3D)
        weights: Vec<f64>,           // 각 ctrl point 의 가중치 (양수)
        knots: Vec<f64>,
        degree: u32,
    },
}
```

**P15.2 — Evaluation via Homogeneous Lift**
- 각 (P_i, w_i) 를 4D 점 (w_i · P_i, w_i) 로 lift
- 4D 점들에 대해 B-spline 평가 (Phase B 의 de Boor 재사용)
- 결과 (X, Y, Z, W) → (X/W, Y/W, Z/W) 로 project back
- `evaluate_homogeneous(t)` helper 로 H(t) 와 w(t) 분리 반환 (derivative 에 필요)

**P15.3 — Derivative**
- Quotient rule: `C'(t) = (H'(t) - w'(t) · C(t)) / w(t)`
- `H = w·C` 는 4D B-spline 의 derivative B-spline 으로 정확 계산
- 별도 NURBS-specific algorithm 불필요 (B-spline 위에 wrapping)

**P15.4 — Knot Insertion (Boehm's algorithm)**
- 기본 NURBS 연산 — degree 유지하면서 knot 추가
- 특정 t 위치에서 곡선 분할에 사용 (subdivision 에서 핵심)
- 알고리즘:
  ```
  α_i = (t_new - knots[i]) / (knots[i + p] - knots[i])
  P'_i = (1 - α_i) P_{i-1} + α_i P_i  (rational: weight 도 동일 보간)
  ```

**P15.5 — Conic representations (예시)**
- **Full circle**: degree 2, 7 control points, weights `[1, √2/2, 1, √2/2, 1, √2/2, 1]`,
  knots `[0,0,0, 1/4,1/4, 1/2,1/2, 3/4,3/4, 1,1,1]`
- 또는 더 단순: 4 quarter-arcs concatenated as degree-2 NURBS (각 arc 3 ctrl points)
- AXiA 는 별도 helper `conic::circle_to_nurbs(...)` 제공

**P15.6 — CCI 알고리즘 (P15 핵심)**

3-단계 robust intersection:

**Stage 1 — Bezier extraction**
- 두 NURBS 를 각각 sub-Bezier 들로 분해 (knot insertion 으로 multiplicity = degree+1
  까지 올려서 각 knot span 에서 Bezier control points 추출)

**Stage 2 — Recursive subdivide-and-prune**
- 두 Bezier 의 AABB overlap 검사
- Overlap 시 두 Bezier 모두 t=0.5 에서 subdivide → 4 쌍 재귀
- AABB 가 chord_tol 미만이면 chord intersection 으로 근사

**Stage 3 — Newton refinement**
- 각 후보 (t1, t2) 쌍에 대해 Newton's method:
  ```
  F(t1, t2) = C1(t1) - C2(t2)
  J = [C1'(t1)  -C2'(t2)]   (3×2 Jacobian)
  ```
- Pseudo-inverse 로 Δ(t1, t2) 계산 → 수렴까지 반복
- 정밀도 1e-9 또는 max_iter 50

**P15.7 — CCI Result type**
```rust
pub struct CurveIntersection {
    pub point: DVec3,         // intersection point
    pub t1: f64,               // parameter on first curve
    pub t2: f64,               // parameter on second curve
    pub angle: f64,            // angle between tangents (rad)
}
pub fn intersect_curves(c1: &AnalyticCurve, c2: &AnalyticCurve, tol: f64)
    -> Vec<CurveIntersection>;
```

**P15.8 — Tolerance / Robustness**
- 기본 intersection tolerance: 1e-6 mm (LOCKED #5 spatial-hash 보다 1000× 정밀)
- AABB pruning 에 padding `2 × tol` 적용
- Newton 비수렴 시 해당 pair 거부 + log

**P15.9 — Backward Compatibility**
- 기존 5 variants 동작 무변동
- NURBS variant 추가는 enum extension — `#[serde]` 자동 호환

## Implementation Plan

### Module 추가
```
crates/axia-geo/src/curves/
  nurbs.rs       — NURBS evaluation, derivative, knot insertion
  intersect.rs   — CCI algorithm (subdivide + Newton)
  conic.rs       — Conic-to-NURBS conversion helpers
```

### `nurbs.rs` API
```rust
pub fn evaluate(ctrl: &[DVec3], weights: &[f64], knots: &[f64], degree: usize, t: f64) -> Result<DVec3>;
pub fn evaluate_homogeneous(...) -> Result<(DVec3, f64)>;  // (H, w)
pub fn derivative(...) -> Result<DVec3>;
pub fn tessellate(..., chord_tol: f64) -> Result<Vec<DVec3>>;
pub fn knot_insert(ctrl, weights, knots, degree, t_new) -> (Vec<DVec3>, Vec<f64>, Vec<f64>);
pub fn extract_bezier_segments(...) -> Vec<BezierSegment>;
```

### `intersect.rs` API
```rust
pub fn intersect_curves(c1: &AnalyticCurve, c2: &AnalyticCurve, tol: f64) -> Vec<CurveIntersection>;
pub fn intersect_bezier_bezier(b1: &[DVec3], b2: &[DVec3], tol: f64) -> Vec<(f64, f64, DVec3)>;
fn newton_refine(c1, c2, t1, t2, tol, max_iter) -> Option<(f64, f64)>;
fn aabb_overlap(b1: &[DVec3], b2: &[DVec3], pad: f64) -> bool;
```

### `conic.rs` API (helpers)
```rust
pub fn full_circle_as_nurbs(center, radius, normal, basis_u) -> AnalyticCurve;
pub fn arc_as_nurbs(center, radius, normal, basis_u, start_angle, end_angle) -> AnalyticCurve;
```

## Tests (절대 #[ignore] 금지)

### `nurbs.rs` (20+)
- evaluate_clamped_endpoints
- evaluate_unit_weights_matches_bspline (when all weights = 1)
- evaluate_circle_via_nurbs_radius_invariant
- derivative_endpoint_tangent
- derivative_chain_rule_correctness
- tessellate_lod_scaling
- knot_insert_preserves_geometry
- knot_insert_increases_count_by_one
- extract_bezier_segments_count_matches_knot_intervals
- validate_weight_count_mismatch_errors
- validate_negative_weight_errors

### `intersect.rs` (20+)
- intersect_two_lines_at_known_point
- intersect_line_circle_two_points
- intersect_circle_circle_two_points
- intersect_no_overlap_returns_empty
- intersect_tangent_returns_one_point
- intersect_bezier_bezier_simple
- intersect_nurbs_nurbs_via_subdivision
- newton_refine_converges_for_close_initial_guess
- aabb_overlap_separating_axis_correctness
- intersect_self_returns_empty (or robust no-op)
- intersect_endpoint_coincidence

### `conic.rs` (10+)
- full_circle_as_nurbs_evaluate_radius
- full_circle_as_nurbs_periodicity
- arc_as_nurbs_endpoint_match
- conic_circle_intersect_with_line_two_points

### Integration (10+)
- analytic_curve_nurbs_parameter_range
- mesh_add_edge_with_nurbs_curve
- mesh_tessellate_edge_nurbs_lod
- intersect_two_arc_edges_returns_intersection
- nurbs_serialize_roundtrip
- edge_curve_kind_returns_6_for_nurbs

### WASM bridge (5+)
- setEdgeNurbsCurve_marshalling
- intersectEdges_returns_pairs
- edgeCurveKind_returns_6_for_nurbs
- tessellateEdge_handles_nurbs_path

## Risks

- **Numerical stability of homogeneous evaluation**: weights near 0 → division
  by tiny w(t). Validation: weights > MIN_WEIGHT (1e-9).
- **CCI false positives**: AABB overlap doesn't imply geometric intersection.
  Stage 3 Newton refinement filters by convergence + final point distance.
- **Multiple intersections at same point**: dedup by t1 / t2 within `tol_param`
  after Newton.
- **Tangent intersections**: Newton may converge to wrong root or fail to
  converge. Detect via `cos(angle)` close to 1, mark as tangent.

## Success Criteria (Gate)

- ✅ Phase A/B 회귀 0건
- ✅ Phase C 신규 테스트 60+ 통과
- ✅ Circle (NURBS form) eval 정확도: radius - 1e-9
- ✅ CCI line-line 정확도: 1e-9 mm
- ✅ CCI nurbs-nurbs 정확도: 1e-6 mm
- ✅ WASM 번들 증가 < 100 KB

## References

- Piegl & Tiller, *The NURBS Book*, Chapter 4 (NURBS curves), Chapter 5
  (knot insertion), Chapter 7 (intersection)
- Sederberg & Nishita, "Curve intersection using Bézier clipping", CAGD 1990
- Sederberg & Goldman, "Algebraic Geometry for Computer-Aided Geometric
  Design", IEEE CG&A 2002
