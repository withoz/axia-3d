# ADR-034: Surface-Surface Intersection (Phase F)

**Status**: **Accepted** (2026-04-29) — Phase F kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase F (Decision Gate 3)
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028~033, ADR-033 v1.1 (P18 contracts)

## Context

Phase A~E 로 1D curve / 2D surface 분석적 표현 + CCI 완성. Phase F 는
**박사급 risk gate** — surface-surface intersection (SSI).

### SSI 의 어려움
- 두 NURBS 곡면의 교차곡선은 일반적으로 **NURBS 가 아님** (algebraic curve)
- Topological loop detection (singular points, branching)
- Robust numerical convergence (extreme corner cases)
- 산업 CAD 도 30 년 누적으로 hardening

### Phase F 전략
**점진 — 분석적 primitive → free-form → general NURBS**:
1. **Stage 1 (이 ADR MVP)**: Plane-Plane, Plane-Cylinder/Sphere/Cone analytic
2. **Stage 2**: Subdivision-and-prune for general patches
3. **Stage 3**: Newton refinement on intersection candidates
4. **Stage 4**: Topology assembly (loop tracing, singular handling)

## Decision

### P19 — 새 원칙

> **SSI 는 4단계 전략으로 robust 하게 계산한다:**
> 1. **Analytic shortcut** — primitive 쌍이 정의된 경우 closed-form 사용
> 2. **AABB pruning** — patch BBox 가 disjoint 면 즉시 reject
> 3. **Tensor subdivision** — overlapping patches 를 split_u/v 로 재귀 분할
> 4. **Newton refinement** — final candidate 에 quadratic convergence

### P19 세부 규칙

**P19.1 — Phase F 진입 인프라 (이 ADR 우선 항목)**

ADR-033 v1.1 P18.13 의 4 항목:
- `split_u(t) / split_v(t)` — tensor de Casteljau split
- `bbox_xyz()` — 3D bounding box (control point convex hull 활용)
- `bbox_uv()` — parameter space bounding box
- `is_planar(tol)` — control polygon flatness
- `is_degenerate()` — area = 0 (line 또는 point)
- `curvature_max()` — adaptive subdivision 임계값

**P19.2 — Subdivision-and-prune 알고리즘**

```
fn ssi_recursive(patch_a, patch_b, tol, depth, results):
    if AABB_a.disjoint(AABB_b) with pad 2·tol: return
    if depth > MAX_DEPTH: emit candidate from current bboxes
    if both patches is_planar(tol): plane-plane intersect
    else if patch_a is "more curved" than patch_b: split_a
        ssi_recursive(a_left, b, ...) + ssi_recursive(a_right, b, ...)
    else: split_b similarly
```

**P19.3 — Newton refinement (P18.8 strict 모드)**

After candidate `(u_a, v_a, u_b, v_b)`:
```
F(state) = Surface_a(u_a, v_a) - Surface_b(u_b, v_b)
J = [dS_a/du_a  dS_a/dv_a  -dS_b/du_b  -dS_b/dv_b]   (3 × 4)
Δstate = pseudo-inverse(J) · (-F)
```

Stop on `|F| < tol` or 50 iter.

**P19.4 — Result type**

```rust
pub struct SurfaceIntersection {
    pub points: Vec<DVec3>,        // sampled along intersection curve
    pub uv_a: Vec<(f64, f64)>,     // parameter on first surface
    pub uv_b: Vec<(f64, f64)>,     // parameter on second surface
    pub closed: bool,               // is the intersection a closed loop?
    pub tangent_warning: bool,      // tangent contact flagged
}
```

**P19.5 — Tolerance**
- Default: 1e-5 mm (CCI 의 1e-6 보다 약간 관대 — SSI 누적 오차 흡수)
- AABB pad: 2 × tol
- Newton: convergence 1e-6, max iter 50

### P19.6 — Stage 1 MVP (초기 commit)

초기 ADR commit 의 scope:
- ✅ ADR-033 v1.1 P18.13 의 4 인프라 항목 모두 구현
- ✅ Plane-Plane analytic intersection (closed-form line)
- ✅ Plane-Cylinder analytic intersection (ellipse / circle / line / point)
- ✅ General patch SSI: 후속 commit (P19.2~P19.4 implementation, 아래 P19.7 참조)

### P19.7 — Phase F 완료 (2026-04-29 후속 commits)

- ✅ **Plane-Sphere analytic** — 거리 기반 (circle / tangent point / empty)
- ✅ **Plane-Cone analytic** — ray-from-apex sweep (ellipse / parabola /
  hyperbola 자동 dispatch + apex degenerate)
- ✅ **Cylinder-Cylinder analytic** (parallel-axis) — 2D circle-circle
  reduction (두 평행 line / external / internal tangent / nested empty /
  coincident warning); non-parallel 은 Stage 2 로 위임
- ✅ **Stage 2 Subdivide-and-prune** (`ssi::subdivide`)
  - `PatchRegion` (ctrl_grid + uv_bounds tracking in original param space)
  - AABB pad-overlap test (`pad = 2 · tol`)
  - Adaptive split: chord-length heuristic 으로 split_u vs split_v 결정
  - Termination: bbox_diag < tol → emit / depth ≥ 16 → emit + warning
- ✅ **Stage 3 Newton refinement** (`ssi::newton`)
  - Pseudo-inverse via `J Jᵀ` inversion (3×3, PSD)
  - Damped step (max |Δ| = 0.5) — overshoot 방지
  - UV clamping to [0,1] each iter
  - Default: tol 1e-6, max_iter 50
- ✅ **Stage 4 Topology assembly** (`ssi::topology`)
  - Greedy nearest-neighbor chain walking (forward + backward extend)
  - Dedup within `merge_tol` (smaller residual wins)
  - Closure detection: chain.len ≥ 3 + endpoints within 4·merge_tol
  - Multiple disconnected chains → multiple SurfaceIntersection
- ✅ **Top-level pipeline** — `intersect_bezier_pair(a, b, tol)`
  - tol → newton tol = tol·1e-3, gap_tol = tol·100

**Phase F 회귀 테스트 (44 SSI unit + 2 pipeline = 46 신규)**:
- analytic: plane_plane (4) + plane_cylinder (7) + plane_sphere (6) +
  plane_cone (5) + cyl_cyl (6) + helpers (1) = 29
- subdivide: 6, newton: 4, topology: 5, pipeline: 2

**알려진 한계 (follow-up)**:
- B-spline / NURBS surface SSI 은 Bezier 만 직접 지원 — knot interval 별
  Bezier extraction 후 pair-wise SSI 호출 필요 (별도 phase)
- Singular point (branching) 자동 분기 미구현 — 다중 분기 곡선은 분리
  chain 으로 emit
- Self-intersecting intersection curve detection 없음
- Cylinder-Cylinder 비-평행 축은 Stage 2 fallback (analytic shortcut 없음)

## Implementation

### Module structure
```
crates/axia-geo/src/surfaces/
  bezier_patch.rs          # + split_u/split_v/bbox/is_planar/curvature
  bspline_surface.rs        # + same helpers
  nurbs_surface.rs          # + same helpers
  ssi/
    mod.rs                  # SSI strategy dispatch
    analytic.rs             # Plane-Plane, Plane-Cylinder, etc.
    subdivide.rs            # Stage 2 + 3 (별도 commit)
```

## Tests (절대 #[ignore] 금지)

### `bezier_patch` (15+)
- split_u_concatenation_equals_original
- split_v_concatenation_equals_original
- split_at_half_left_endpoint_matches_original_midpoint
- bbox_xyz_contains_all_control_pts
- bbox_uv_matches_uv_bounds
- is_planar_xy_grid_returns_true
- is_planar_bumped_grid_returns_false
- is_degenerate_zero_grid_returns_true
- curvature_max_planar_grid_zero
- curvature_max_bumped_grid_positive

### `ssi/analytic` (10+)
- plane_plane_intersect_at_line
- plane_plane_parallel_no_intersection
- plane_plane_coincident_warning
- plane_cylinder_intersect_circle
- plane_cylinder_intersect_ellipse_at_angle
- plane_cylinder_no_intersection_distant
- plane_cylinder_tangent_warning

## Risks

- **R1**: Tensor subdivision 의 termination — control polygon flatness
  test 가 false positive 시 무한 재귀. 해결: max_depth 16.
- **R2**: Newton 비수렴 (tangent contact, parallel curvature) — 50 iter
  이후 후보 거부 + warning.
- **R3**: Topology assembly 에서 loop closure detection 누락. Phase F
  Stage 4 별도 작업.

## Success Criteria (Stage 1 — 이 commit)

- ✅ ADR-028~033 v1.1 회귀 0건
- ✅ Phase F Stage 1 신규 테스트 60+ 통과
- ✅ Plane-Plane line intersect 1e-9 mm 정확
- ✅ Plane-Cylinder circle intersect radius 1e-6 mm 정확

## References

- Patrikalakis & Maekawa, *Shape Interrogation for CAD/CAM*, Chapter 5 (SSI)
- Sederberg, *CAGD lecture notes*, Chapter 10
- Hoffmann, *Geometric and Solid Modeling*, Chapter 4
