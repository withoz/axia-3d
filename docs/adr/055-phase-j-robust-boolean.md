# ADR-055 — Phase J: Robust NURBS Boolean (G3 MVP → Production)

**Status**: Accepted (Phase J spec — implementation in progress)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase J, 4주, 위험: 중)
**Parent**: ADR-052 §2.3 Phase J
**Prerequisites**: ADR-053 (Phase H Transform), ADR-054 (Phase I Knot
Insert), Phase G3 MVP `nurbs_boolean`
**Related**: ADR-058 (Phase M Robust Predicates — 병행 가능)

---

## 0. Summary (4 lines)

> Phase G3 의 `nurbs_boolean` MVP 를 production-grade 로 격상. 핵심 4축:
> (1) 2D trim loop arithmetic (Greiner-Hormann curve-aware),
> (2) Robust SSI 6 edge case 처리, (3) Multi-loop containment tree,
> (4) DCEL 1.5μm dedup ↔ NURBS 1e-3 mm SSI tolerance 통일 정책.

---

## 1. Context

### 1.1 현재 G3 MVP 상태

`crates/axia-geo/src/surfaces/ssi/boolean.rs::nurbs_boolean` (~140 줄):
- ✅ 작동: closed SSI chain → trim loop 변환
- ❌ 한계:
  - Open chain 은 skip (warning_open_chains_skipped)
  - Multiple/nested loop 처리 안 됨
  - Tangent contact 는 flag 만, 처리 안 함
  - Self-intersection 미감지
  - is_outer 결정이 op 단순 매핑 (geometric containment 검사 없음)
  - **Trim loop 간 Boolean (∪, ∩) 미구현**

### 1.2 Phase J 가 해결하는 4축

```
Axis 1: Trim Loop Arithmetic
  필요: 두 trim loop 의 Boolean (loop_a ∪ loop_b, loop_a ∩ loop_b)
  현재: TrimCurve2D evaluate / tessellate 만 있음
  Phase J: Greiner-Hormann (1998) clipping 의 곡선 일반화

Axis 2: Robust SSI 6 edge case
  현재: tangent_contact 는 flag, self-intersection 미감지
  Phase J:
    1. Tangential intersection (single-point contact)
    2. Coincident surfaces (overlapping regions)
    3. Multiple branch chains (3+ surfaces meeting)
    4. PCurve missing (trim curve 재구축)
    5. Self-intersecting trim
    6. Boundary-grazing chain (open chain → boundary edge 연결)

Axis 3: Multi-loop Containment Tree
  필요: 1 outer + N hole 구조의 N×M intersection
  현재: 1 chain assumption
  Phase J: hole-tree (parent/child) + 정확한 is_outer 결정

Axis 4: Tolerance Unification
  현재: DCEL spatial-hash 1.5μm + NURBS 1e-3 mm SSI 충돌
  Phase J: BooleanTolerance struct 단일 정책
```

### 1.3 의존성

```
✅ Phase H (Transform)        — Boolean 결과 변환 시 필요
✅ Phase I (Knot insert)      — SSI Stage 2 subdivide + 공통 knot space
⏳ Phase M (Robust predicates) — 분류 정확도 향상 (병행 가능, 본 phase 와
                                 독립적으로 진행)
```

---

## 2. Decision

### 2.1 신규 모듈 + 기존 확장

```
crates/axia-geo/src/surfaces/
  ├─ trim.rs                 (기존 — TrimLoop / TrimCurve2D)
  └─ ssi/
      ├─ boolean.rs          (확장 — Phase J production path)
      ├─ trim_geom.rs        (신규 — geometry primitives)
      ├─ trim_boolean.rs     (신규 — 2D Greiner-Hormann curve-aware)
      ├─ trim_classify.rs    (신규 — containment tree, hole nesting)
      └─ tolerance.rs        (신규 — BooleanTolerance struct + 정책)
```

### 2.2 Step 1 — Trim Loop Geometry Primitives (`trim_geom.rs`)

```rust
/// 2D point-in-trim-loop test (winding-number based for curve-aware).
pub fn point_in_trim_loop(p: [f64; 2], loop_: &TrimLoop, tol: f64) -> bool;

/// Signed area of a trim loop (positive = CCW outer, negative = CW hole).
/// Computed via tessellation + shoelace formula (curve-aware via adaptive
/// chord_tol).
pub fn trim_loop_signed_area(loop_: &TrimLoop, chord_tol: f64) -> f64;

/// Axis-aligned bounding box of trim loop in (u, v) space.
pub fn trim_loop_bbox(loop_: &TrimLoop) -> ([f64; 2], [f64; 2]);

/// Loop orientation — derived from signed area.
pub fn trim_loop_orientation(loop_: &TrimLoop, chord_tol: f64) -> LoopOrientation;
pub enum LoopOrientation { Ccw, Cw, Degenerate }

/// Reverse a trim loop's curves (for orientation correction).
pub fn reverse_trim_loop(loop_: TrimLoop) -> TrimLoop;
```

### 2.3 Step 2 — 2D Trim Loop Boolean (`trim_boolean.rs`)

Greiner-Hormann 알고리즘의 곡선 일반화:
1. 두 loop 의 모든 segment 쌍에 대해 intersection 계산
   (Line∩Line, Line∩Arc, Arc∩Arc, Bezier∩anything via subdivision)
2. Intersection 점에 entry/exit flag 부여
3. 결과 loop 따라가기 (Boolean op 별 traversal rule)

```rust
pub fn trim_loop_union(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop>;
pub fn trim_loop_subtract(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop>;
pub fn trim_loop_intersect(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop>;

/// 2D segment-segment intersection on TrimCurve2D pair.
pub fn intersect_trim_curves(
    a: &TrimCurve2D, b: &TrimCurve2D, tol: f64,
) -> Vec<Intersection2D>;

pub struct Intersection2D {
    pub point: [f64; 2],
    pub t_a: f64,        // parameter on curve a
    pub t_b: f64,        // parameter on curve b
    pub kind: IntersectionKind,
}

pub enum IntersectionKind {
    Crossing,            // 일반 교차
    Tangent,             // 접선 (1 point shared but not crossing)
    Coincident,          // 두 segment 일부 겹침 (overlapping range)
}
```

### 2.4 Step 3 — Multi-loop Containment Tree (`trim_classify.rs`)

```rust
/// Given N loops on the same surface, build a containment tree.
/// Root = "infinite outside". Children of root = outer loops.
/// Children of outer = inner holes. Children of holes = nested outers.
pub struct ContainmentTree {
    pub nodes: Vec<ContainmentNode>,
    pub roots: Vec<usize>,
}

pub struct ContainmentNode {
    pub loop_index: usize,
    pub depth: usize,           // 0 = outer, 1 = hole, 2 = nested outer, ...
    pub is_outer: bool,         // depth 짝수 = outer
    pub parent: Option<usize>,
    pub children: Vec<usize>,
}

pub fn build_containment_tree(loops: &[TrimLoop], tol: f64) -> ContainmentTree;
```

### 2.5 Step 4 — Robust SSI 6 Edge Cases (`ssi` 확장)

```rust
pub struct SsiRobustnessReport {
    pub tangent_contacts: Vec<usize>,        // chain index
    pub coincident_regions: Vec<usize>,
    pub branch_points: Vec<usize>,
    pub pcurve_missing: Vec<usize>,
    pub self_intersections: Vec<usize>,
    pub boundary_grazing: Vec<usize>,
}

pub fn detect_ssi_pathologies(
    chains: &[SurfaceIntersection], tol: f64,
) -> SsiRobustnessReport;

/// Reconstruct missing PCurve from 3D chain via parameter projection.
pub fn reconstruct_pcurve(
    chain: &SurfaceIntersection,
    surface: &AnalyticSurface,
    tol: f64,
) -> Result<Vec<TrimCurve2D>>;
```

### 2.6 Step 5 — Tolerance Unification + nurbs_boolean Upgrade (`tolerance.rs`)

```rust
/// Phase J unified Boolean tolerance.
pub struct BooleanTolerance {
    pub geometric: f64,      // mm — distance / position checks
    pub parameter: f64,      // unitless — uv parameter equality
    pub angular: f64,        // rad — tangent comparison
    pub topological: f64,    // mm — DCEL spatial-hash dedup (LOCKED #5: 1.5μm)
}

impl Default for BooleanTolerance {
    fn default() -> Self {
        Self {
            geometric:   1e-3,         // 1 micron
            parameter:   1e-6,
            angular:     1e-4,
            topological: 1.5e-3,       // 1.5 μm = LOCKED #5 spatial-hash
        }
    }
}

/// Production Boolean entry point — replaces MVP signature.
pub fn nurbs_boolean_v2(
    surface_a: &AnalyticSurface,
    surface_b: &AnalyticSurface,
    op: BooleanOp,
    tol: BooleanTolerance,
) -> Result<NurbsBooleanResultV2>;

pub struct NurbsBooleanResultV2 {
    pub trim_a: ContainmentTree,
    pub trim_b: ContainmentTree,
    pub robustness: SsiRobustnessReport,
    pub diagnostics: NurbsBooleanDiagnostics,
}
```

### 2.7 회귀 테스트 (30개)

#### Trim Geometry (8개)
1. `point_in_simple_square_loop`
2. `point_in_loop_with_hole`
3. `signed_area_ccw_positive`
4. `signed_area_cw_negative`
5. `bbox_arc_loop`
6. `orientation_degenerate_zero_area`
7. `reverse_loop_flips_orientation`
8. `point_on_boundary_within_tol`

#### Trim Boolean 2D (10개)
9. `union_disjoint_loops_returns_both`
10. `union_overlapping_squares`
11. `intersect_disjoint_loops_returns_empty`
12. `intersect_nested_returns_inner`
13. `subtract_outside_returns_a`
14. `subtract_inside_creates_hole`
15. `crossing_intersection_two_points`
16. `tangent_contact_one_point`
17. `coincident_segment_overlap`
18. `bezier_arc_intersection`

#### Containment Tree (6개)
19. `single_outer_loop_tree`
20. `outer_with_one_hole`
21. `outer_with_nested_outer_inside_hole`
22. `disjoint_two_outers`
23. `multiple_holes_in_one_outer`
24. `containment_with_curved_loops`

#### SSI Robustness (6개)
25. `detect_tangent_contact`
26. `detect_coincident_region`
27. `detect_self_intersection`
28. `detect_boundary_grazing_open_chain`
29. `reconstruct_missing_pcurve`
30. `nurbs_boolean_v2_box_intersect_tolerance_unified`

### 2.8 Acceptance

- [ ] 5 신규 모듈 (trim_geom / trim_boolean / trim_classify / tolerance + boolean v2)
- [ ] 30 회귀 통과 (모두 절대 #[ignore] 금지)
- [ ] BooleanTolerance default = LOCKED #5 정합 (1.5μm)
- [ ] 기존 `nurbs_boolean` MVP 보존 (deprecated 표시 + v2 권장)
- [ ] LOC 추정: ~1500-2000줄
- [ ] 기존 회귀 703 모두 통과
- [ ] NIST Boolean 코퍼스 sample 5/5 통과 (별도 fixture)

---

## 3. Out of Scope

- **Mesh-level Boolean** (DCEL 통합) — Phase O 의 도구 통합 범위
- **Knot removal** (A5.10) — 후속 ADR
- **Variable-radius fillet** — Phase L
- **Performance benchmark** — Phase J 후 별도 ADR

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| Greiner-Hormann curve generalization 의 robustness | Step 1 geometry primitive 회귀 8개로 기반 검증 |
| Tangent / coincident edge case ε 선정 | BooleanTolerance struct 로 caller 가 명시 제어 |
| Multi-loop containment 의 nested 깊이 | depth limit 16 + 회귀 6개로 보호 |
| 기존 `nurbs_boolean` MVP 회귀 | v2 별도 함수, MVP 보존 + tests 보존 |

---

## 5. Implementation Plan

### 5.1 5-Step incremental (각 Step = 별도 commit, 회귀 0)

| Step | 영역 | LOC | 회귀 |
|---|---|---|---|
| 1 | Trim Geometry Primitives | ~250 | 8 |
| 2 | 2D Trim Boolean | ~600 | 10 |
| 3 | Multi-loop Containment | ~250 | 6 |
| 4 | SSI Robustness Detection | ~300 | 6 |
| 5 | Tolerance Unification + v2 | ~200 | nurbs_boolean_v2 통합 |

**Step 1+2 가 prerequisite of 3, 4, 5.** 본 PR 은 Step 1 부터 시작.

---

## 6. References

- ADR-052 master roadmap §2.3 Phase J
- Phase G3 MVP: `crates/axia-geo/src/surfaces/ssi/boolean.rs`
- Greiner & Hormann (1998), *"Efficient Clipping of Arbitrary Polygons"*
- Piegl & Tiller, *The NURBS Book* §6 (Boolean composition)
- Vatti (1992) clipping (대체 알고리즘 비교)

---

*Author*: AXiA team (사용자 결정 + Claude spec)
*Status*: Phase J spec accepted — Step 1 부터 incremental 구현
