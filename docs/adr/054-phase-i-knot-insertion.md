# ADR-054 — Phase I: Knot Insertion & Curve Refinement

**Status**: Accepted (Phase I spec — implementation in progress)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase I, 2주)
**Parent**: ADR-052 §2.3 Phase I
**Prerequisites**: ADR-029 (B-spline), ADR-030 (NURBS), ADR-033 (NURBS surface)
**Related**: ADR-053 (Phase H), ADR-055 (Phase J Robust Boolean — knot insertion 의존)

---

## 0. Summary (4 lines)

> B-spline / NURBS / Surface 의 knot insertion / refinement / degree
> elevation 알고리즘 구현 (Piegl A5.1 / A5.4 / A5.5 / A5.9). Phase J
> (Robust NURBS Boolean) 의 SSI subdivide stage 와 trim loop arithmetic
> 이 본 알고리즘 의존. 모든 변환은 **shape-preserving** (geometry 불변).

---

## 1. Context

### 1.1 왜 필요한가

NURBS Boolean / SSI / Trim loop arithmetic 의 핵심 연산:

1. **Knot insertion** — 두 NURBS surface 의 knot vector 를 일치시켜
   intersection curve 를 동일 parameter space 에서 처리
2. **Knot refinement** — Phase F SSI Stage 2 (subdivision) 가 patch 를
   더 작은 patch 로 분할할 때 사용
3. **Degree elevation** — Loft / Sweep (Phase K) 에서 다른 차수의 곡선
   들을 동일 차수로 통일
4. **Knot removal** — Boolean 결과의 over-subdivided patch 정리

현재 ADR-029/030/033 의 evaluate / derivative 만 구현, knot 변경 알고리즘 부재.

### 1.2 Piegl Algorithm Mapping

| 알고리즘 | 책 §  | 함수 |
|---|---|---|
| A5.1 Curve knot insertion | §5.2  | `insert_knot_curve(t, r)` |
| A5.4 Curve knot refinement | §5.4  | `refine_knot_curve(X)` |
| A5.5 Decompose to Bezier | §5.6  | `decompose_to_bezier_curve()` |
| A5.6 Bezier patch decompose | §5.6  | `decompose_to_bezier_surface()` |
| A5.9 Curve degree elevation | §5.5  | `elevate_degree_curve(target)` |
| A5.10 Knot removal | §5.4  | `remove_knot_curve(t, num, tol)` |
| A5.11 Surface knot insertion (u or v) | §5.3 | `insert_knot_surface_u/v(t, r)` |

### 1.3 Phase J 의존성

```
Phase J Robust NURBS Boolean
   │
   ├─→ SSI Stage 2 (subdivide patches)  ← A5.6 surface decompose
   │
   ├─→ Trim loop arithmetic
   │       └─→ NURBS curve clipping     ← A5.1 + A5.4 (knot insert)
   │
   └─→ Multi-loop intersection
           └─→ Common knot space        ← A5.4 (refinement)
```

본 Phase I 가 Phase J 의 prerequisite. Phase H (transform) 와 직교.

---

## 2. Decision

### 2.1 신규 모듈 구조

```
crates/axia-geo/src/curves/
  ├─ knot.rs             ← 본 ADR 신규
  │   ├─ insert_knot_bspline()
  │   ├─ insert_knot_nurbs()
  │   ├─ refine_knots_bspline()
  │   ├─ refine_knots_nurbs()
  │   ├─ elevate_degree_bspline()
  │   ├─ elevate_degree_nurbs()
  │   └─ decompose_to_bezier()         ← A5.5

crates/axia-geo/src/surfaces/
  └─ knot.rs             ← 본 ADR 신규
      ├─ insert_knot_surface_u()
      ├─ insert_knot_surface_v()
      ├─ refine_knots_surface_u/v()
      └─ decompose_to_bezier_patches() ← A5.6
```

### 2.2 핵심 알고리즘 — A5.1 Curve Knot Insertion

NURBS curve `(P, w, U, p)`에 knot `t` 를 `r` 번 삽입할 때:

```
Span k 찾기: t ∈ [u_k, u_{k+1})
초기 multiplicity s = U 안의 t 횟수
조건: r + s ≤ p + 1

새 control points (Boehm's algorithm):
  새 control 개수 = n + r
  for j = 1 .. r:
    for i = k - p + j .. k - s:
      α_i = (t - u_i) / (u_{i+p-j+1} - u_i)
      Q_i = (1 - α_i) Q_{i-1} + α_i Q_i
  knot vector 에 t 를 r 번 삽입
```

NURBS 의 경우 control point 를 4D homogeneous (w·P, w) 로 lift 해서 처리
→ 결과를 다시 3D + weight 로 분리.

### 2.3 API 설계

```rust
// crates/axia-geo/src/curves/knot.rs

/// Insert knot value `t` into a B-spline `r` times.
/// Returns (new_ctrl_pts, new_knots).
/// Caller must verify `r + multiplicity(t, knots) ≤ degree + 1`.
pub fn insert_knot_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)>;

/// NURBS variant — works in 4D homogeneous space.
pub fn insert_knot_nurbs(
    ctrl_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    t: f64,
    r: usize,
) -> Result<(Vec<DVec3>, Vec<f64>, Vec<f64>)>;

/// Insert a vector of knots `X` (sorted, may contain repeats).
/// Implements Piegl A5.4 (more efficient than calling insert_knot N times).
pub fn refine_knots_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    x: &[f64],
) -> Result<(Vec<DVec3>, Vec<f64>)>;

pub fn refine_knots_nurbs(
    ctrl_pts: &[DVec3],
    weights: &[f64],
    knots: &[f64],
    degree: usize,
    x: &[f64],
) -> Result<(Vec<DVec3>, Vec<f64>, Vec<f64>)>;

/// Decompose a B-spline / NURBS curve into its constituent Bezier
/// segments. Each segment has degree `p` and parameter range `[0, 1]`.
/// Returns `Vec<Vec<DVec3>>` (one Bezier per knot span).
pub fn decompose_to_bezier_segments(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
) -> Result<Vec<Vec<DVec3>>>;

/// Elevate degree from `p` to `p + t`. Returns new (ctrl, knots).
pub fn elevate_degree_bspline(
    ctrl_pts: &[DVec3],
    knots: &[f64],
    degree: usize,
    t: usize,
) -> Result<(Vec<DVec3>, Vec<f64>, usize)>;
```

### 2.4 AnalyticCurve 인터페이스

```rust
impl AnalyticCurve {
    /// Phase I — insert knot value t r times.
    /// Only valid for BSpline / NURBS variants.
    pub fn insert_knot(&self, t: f64, r: usize) -> Result<AnalyticCurve>;

    /// Phase I — refine with sorted knot vector X.
    pub fn refine_knots(&self, x: &[f64]) -> Result<AnalyticCurve>;

    /// Phase I — elevate degree by t.
    pub fn elevate_degree(&self, t: usize) -> Result<AnalyticCurve>;

    /// Phase I — decompose to a list of Bezier segments.
    pub fn to_bezier_segments(&self) -> Result<Vec<AnalyticCurve>>;
}
```

### 2.5 Surface API

```rust
// crates/axia-geo/src/surfaces/knot.rs
pub fn insert_knot_surface_u(...) -> Result<...>;
pub fn insert_knot_surface_v(...) -> Result<...>;
pub fn refine_knots_surface_u(...) -> Result<...>;
pub fn refine_knots_surface_v(...) -> Result<...>;
pub fn decompose_to_bezier_patches(...) -> Result<Vec<Vec<Vec<DVec3>>>>;

impl AnalyticSurface {
    pub fn insert_knot_u(&self, t: f64, r: usize) -> Result<AnalyticSurface>;
    pub fn insert_knot_v(&self, t: f64, r: usize) -> Result<AnalyticSurface>;
    pub fn refine_knots_u(&self, x: &[f64]) -> Result<AnalyticSurface>;
    pub fn refine_knots_v(&self, x: &[f64]) -> Result<AnalyticSurface>;
}
```

### 2.6 Shape Preservation Invariant (회귀 강제)

모든 knot 변경 후 곡선/면을 sample 하면 원본과 동일한 점:

```
Invariant K-1: ∀t ∈ parameter_range:
  curve.evaluate(t) ≈ curve.insert_knot(t0, r).evaluate(t)  within 1e-9
```

**18 회귀 중 4개**가 이 invariant 검증 (curve 2 + surface 2).

### 2.7 회귀 테스트 (18개)

#### Curve knot insertion (8개)
1. `bspline_insert_knot_preserves_evaluate` — K-1
2. `bspline_insert_knot_grows_ctrl_count_by_r`
3. `nurbs_insert_knot_preserves_evaluate` — K-1
4. `nurbs_insert_knot_preserves_weights_count`
5. `bspline_refine_with_multiple_knots_equivalent_to_sequence`
6. `decompose_curve_to_bezier_count_equals_distinct_spans`
7. `decompose_then_evaluate_matches_original` — K-1
8. `elevate_degree_curve_preserves_shape` — K-1

#### Surface knot insertion (6개)
9. `bspline_surface_insert_knot_u_preserves_evaluate` — K-1
10. `bspline_surface_insert_knot_v_preserves_evaluate` — K-1
11. `nurbs_surface_insert_knot_u_preserves_evaluate` — K-1
12. `surface_refine_u_grid_grows_correctly`
13. `surface_refine_v_does_not_affect_u_count`
14. `decompose_surface_to_bezier_patches_count`

#### Edge cases (4개)
15. `insert_knot_outside_range_returns_err`
16. `insert_knot_exceeding_degree_plus_one_returns_err` (multiplicity check)
17. `insert_knot_zero_times_is_no_op`
18. `degree_elevation_zero_is_no_op`

### 2.8 Acceptance

- [ ] BSpline / NURBS knot insertion (curve)
- [ ] BSpline / NURBS knot refinement (curve)
- [ ] BSpline / NURBS knot insertion (surface u + v)
- [ ] Decompose to Bezier (curve + surface)
- [ ] Curve degree elevation
- [ ] 18 회귀 테스트 통과 (모두 절대 #[ignore] 금지)
- [ ] Shape-preservation 1e-9
- [ ] LOC 추정: ~700-1000줄
- [ ] 기존 회귀 683 (axia-geo lib) 모두 통과

---

## 3. Out of Scope

- **Knot removal (A5.10)** — Phase J 와 함께 (정확도 tol 정책 의존)
- **Degree elevation (surface)** — Phase K (Loft) 에서 필요 시
- **Knot reduction** — 별도 ADR (rare optimization)

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| Boehm algorithm α 계산 정확성 | Piegl §5.2 참조 + shape-preserve 회귀 |
| NURBS 4D lift 후 weight 음수 가능성 | weight > 0 invariant 강제 |
| Surface knot insert 의 grid update 복잡성 | Curve insertion 을 row/column 별 호출 (composition) |
| Bezier decompose 의 knot multiplicity edge case | end-knot multiplicity = degree + 1 보정 |

---

## 5. References

- Piegl & Tiller, *The NURBS Book* §5.2-5.6 (knot insertion / refinement /
  decomposition / degree elevation)
- ADR-029 (B-spline) / ADR-030 (NURBS) / ADR-033 (NURBS surface)
- ADR-052 master roadmap §2.3 Phase I

---

*Author*: AXiA team (사용자 결정 + Claude spec)
*Status*: Phase I spec accepted — implementation 별도 commits
