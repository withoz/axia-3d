# ADR-056 — Phase K: Curve/Surface Fitting & Construction

**Status**: Accepted (Phase K spec — implementation in progress)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase K, 3주, 위험: 낮음)
**Parent**: ADR-052 §2.3 Phase K
**Prerequisites**: ADR-029 (B-spline), ADR-030 (NURBS), ADR-033 (NURBS surface),
ADR-054 (Phase I knot insertion)
**Related**: ADR-053 (Phase H Transform), ADR-055 (Phase J Boolean)

---

## 0. Summary (4 lines)

> 산업 CAD 의 표준 surface 생성 도구 — Loft / Sweep / Network surface +
> Curve fitting (least-squares) + Surface grid fitting. Phase H/I 의
> 자산 (transform + knot insert) 위에 구축. 사용자가 sketch 로 그린
> 프로필 → 자동 NURBS surface 생성 가능.

---

## 1. Context

### 1.1 현재 누락된 산업 표준 도구

| 도구 | 산업 CAD (Rhino/CATIA) | AxiA 현재 |
|---|---|---|
| Loft (skinning) | ✅ 일상 도구 | ❌ |
| Sweep (1-rail / 2-rail) | ✅ 일상 도구 | ❌ |
| Network surface (Coons / Gordon) | ✅ | ❌ |
| Curve fitting from points | ✅ | ❌ |
| Surface fitting from grid | ✅ | ❌ |
| Point cloud → NURBS | ✅ (Reverse Engineering) | ❌ |

### 1.2 사용자 가치

```
사용자가 sketch 로 4개 프로필 곡선 그림
   ↓
Phase K loft_surface([c1, c2, c3, c4], degree_v=3)
   ↓
하나의 NURBS surface (vertical NURBS direction)
   ↓
Phase O 도구 통합 후 push-pull / fillet / Boolean 가능
```

현재 워크플로우는 mesh-level extrude 만 가능 — Phase K 가 풀린 후 NURBS-level
construction 가능.

### 1.3 의존성

```
✅ Phase H (Transform) — fitting 결과 변환에 필요
✅ Phase I (Knot insert) — 곡선 차수 unification (loft 시 다른 차수 곡선 통합)
✅ Phase J (Boolean) — 무관 (병행 가능)
⏳ Phase L (Advanced surfaces) — Variable fillet 등은 후속
```

---

## 2. Decision

### 2.1 신규 모듈 구조

```
crates/axia-geo/src/curves/
  └─ fitting.rs              ← Curve least-squares + interpolation

crates/axia-geo/src/surfaces/
  ├─ loft.rs                 ← Skinning (Piegl A10.3)
  ├─ sweep.rs                ← 1-rail sweep
  ├─ network.rs              ← Coons + Gordon (선택적)
  └─ fitting.rs              ← Surface grid + point cloud fitting
```

### 2.2 Step 1 — Curve Fitting (`curves/fitting.rs`)

Piegl & Tiller §9 algorithms:

```rust
/// A9.1 — Global curve interpolation through given points.
/// Constructs a NURBS curve passing EXACTLY through `points`.
pub fn interpolate_nurbs_curve(
    points: &[DVec3],
    degree: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)>;  // (ctrl_pts, knots)

/// A9.6 — Least-squares curve approximation.
/// Constructs a NURBS curve that approximates `points` with at most
/// `n_ctrl` control points, minimizing total squared error.
pub fn fit_nurbs_curve_lsq(
    points: &[DVec3],
    degree: usize,
    n_ctrl: usize,
) -> Result<(Vec<DVec3>, Vec<f64>)>;

/// A9.6 + tolerance termination: increase n_ctrl until max error < tol.
pub fn fit_nurbs_curve_to_tolerance(
    points: &[DVec3],
    degree: usize,
    tol: f64,
) -> Result<(Vec<DVec3>, Vec<f64>)>;

/// Parameterization helpers (Piegl §9.2):
pub enum Parameterization {
    Uniform,        // t_i = i / (n-1)
    ChordLength,    // proportional to chord length (recommended)
    Centripetal,    // proportional to sqrt(chord) (best for sharp turns)
}

pub fn compute_parameters(
    points: &[DVec3],
    method: Parameterization,
) -> Vec<f64>;
```

**Acceptance**: 회귀 5개 (4 happy path + 1 tolerance termination).

### 2.3 Step 2 — Loft Surface (`surfaces/loft.rs`)

Piegl A10.3 — Skinning through cross-section curves:

```rust
/// Construct a NURBS surface that interpolates `curves` (each treated
/// as v-direction iso-curve at parameter `v_i`).
///
/// All curves should have the same degree and knot vector — if not,
/// caller must pre-unify via Phase I `elevate_degree` + `refine_knots`.
/// Phase K MVP: enforce same degree/knots; provide explicit error
/// otherwise.
pub fn loft_surface(
    curves: &[(&[DVec3], &[f64], usize)],  // (ctrl, knots, degree) per curve
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)>;
//          ↑ ctrl_grid              ↑ ku   ↑ kv   ↑ du   ↑ dv
```

**Algorithm** (Piegl A10.3):
1. Compute v-parameters for each section (chord length on first ctrl pt)
2. v-knots from parameters (averaging)
3. For each u-row: globally interpolate v-direction → control row

**Acceptance**: 회귀 4개 (2-section linear / 4-section cubic / parameter-test /
mismatched-input rejected).

### 2.4 Step 3 — Sweep Surface (`surfaces/sweep.rs`)

```rust
/// 1-rail sweep: extrude `profile` along `rail`. The profile's local
/// Frenet frame on the rail orients each cross-section.
pub fn sweep_surface_1_rail(
    profile_ctrl: &[DVec3], profile_knots: &[f64], profile_degree: usize,
    rail_ctrl: &[DVec3],    rail_knots: &[f64],    rail_degree: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)>;

/// Extrusion (special case: rail is a single linear segment).
pub fn extrusion_surface(
    profile_ctrl: &[DVec3], profile_knots: &[f64], profile_degree: usize,
    direction: DVec3,
    distance: f64,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)>;
```

**Algorithm**:
- Sample N points along rail
- At each: compute Frenet frame (tangent, normal, binormal)
- Translate + orient profile control points to that frame
- Loft through resulting cross-sections

**Acceptance**: 회귀 4개 (extrusion / sweep along arc / linear rail edge case /
profile preservation).

### 2.5 Step 4 — Surface Grid Fitting (`surfaces/fitting.rs`)

Piegl A9.7 — Tensor-product surface interpolation:

```rust
/// Interpolate / approximate a NURBS surface through a grid of points.
/// `grid[u_idx][v_idx]` per AxiA convention.
pub fn fit_nurbs_surface_grid(
    grid: &[Vec<DVec3>],
    degree_u: usize,
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)>;

/// Approximate from unstructured 3D point cloud.
/// **Phase K MVP**: simple grid-projection fallback. Full RBF / k-NN
/// fitting is Phase L follow-up.
pub fn fit_nurbs_surface_from_cloud(
    points: &[DVec3],
    target_grid_size: (usize, usize),
    degree_u: usize,
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)>;
```

**Acceptance**: 회귀 5개 (planar grid / cylindrical grid / non-uniform grid /
cloud fallback / size validation).

### 2.6 Step 5 — Network Surface (선택적, Phase K MVP 제외)

Coons patch (4 boundary curves, bilinear blend) + Gordon surface
(N×M grid of curves). 복잡도 높음, Phase L 와 함께 진행.

### 2.7 회귀 테스트 (20개)

#### Curve fitting (5개)
1. `interpolate_curve_passes_through_points`
2. `fit_curve_lsq_reduces_error`
3. `fit_curve_to_tolerance_terminates`
4. `parameterization_chord_length`
5. `parameterization_centripetal_smoother_for_sharp_turn`

#### Loft (4개)
6. `loft_two_lines_returns_planar_surface`
7. `loft_four_circles_returns_cubic_v_direction`
8. `loft_passes_through_input_curves`
9. `loft_rejects_mismatched_degrees`

#### Sweep (4개)
10. `extrusion_preserves_profile_shape`
11. `extrusion_height_matches_distance`
12. `sweep_along_arc_orients_profile`
13. `sweep_rejects_degenerate_rail`

#### Surface grid fitting (5개)
14. `fit_planar_grid_recovers_plane`
15. `fit_curved_grid_within_tolerance`
16. `fit_grid_passes_through_corners`
17. `fit_cloud_fallback_size_validation`
18. `fit_cloud_planar_recovery`

#### Phase H integration (2개)
19. `loft_then_transform_preserves_kind`
20. `extrusion_then_uniform_scale_preserves_height_ratio`

### 2.8 Acceptance

- [ ] Curve fitting (interpolate / lsq / tolerance) — `curves/fitting.rs`
- [ ] Loft surface (Piegl A10.3) — `surfaces/loft.rs`
- [ ] Sweep + Extrusion — `surfaces/sweep.rs`
- [ ] Surface grid fitting (A9.7) — `surfaces/fitting.rs`
- [ ] 20 회귀 테스트 통과 (모두 절대 #[ignore] 금지)
- [ ] Interpolation: passes EXACTLY through input points (1e-9)
- [ ] Loft: surface evaluate at v_i = input curves' i-th
- [ ] LOC 추정: ~1200-1500줄
- [ ] 기존 회귀 749 모두 통과

---

## 3. Out of Scope

본 Phase K 가 다루지 않음:

- **Network surface (Coons + Gordon)** — Phase L 와 함께
- **Variable-radius fillet** — Phase L
- **Skin with explicit u-knot vector** — caller-driven 변형
- **Point cloud robust RBF / kNN** — Phase L (현 MVP 는 grid projection)
- **Loft with shape-preserving smoothing** — 후속 ADR

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| Loft 입력 곡선 차수/knot 불일치 | enforce 후 explicit error — caller 가 Phase I 로 unify |
| Frenet frame singular (직선 rail) | rail 차수 1 = extrusion 분기 — 강제 |
| Cloud fitting 의 underdetermined | target_grid_size validation + 에러 |
| Newton 발산 in interpolation | A9.1 의 chord-length parameterization 안정 (centripetal 더 좋음) |

---

## 5. References

- ADR-052 master roadmap §2.3 Phase K
- Piegl & Tiller, *The NURBS Book*:
  - §9.1 (parameterization), §9.2.1 (interpolation), §9.4.1 (lsq fitting)
  - §10.3 (skinning / loft)
- Hoschek & Lasser (1993) for sweep / Frenet orientation

---

*Author*: AXiA team (사용자 결정 + Claude spec)
*Status*: Phase K spec accepted — incremental implementation
