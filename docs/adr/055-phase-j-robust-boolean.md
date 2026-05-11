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

---

## 7. Amendment 1 — Step 2 / Step 4 설계 Lock-in (2026-05-04)

**컨텍스트**: Steps 1+3+5 commit (65e77d1) 후 사용자 가이드 받음.
다음 세션이 흔들림 없이 진입할 수 있도록 핵심 설계 결정을 본 amendment 로
영구 lock.

### 7.1 Step 2 — 3가지 핵심 결정 (변경 시 새 amendment 필요)

#### 7.1.1 Intersection Registry 계약

`IntersectionKind::Coincident` 는 **단일 점이 아니라 overlap 구간**
`(t0_a, t1_a, t0_b, t1_b)` 을 명시적으로 보존한다.

```rust
pub struct Intersection2D {
    pub point: [f64; 2],          // crossing/tangent: 단일 점
                                  // coincident: 구간 시작점
    pub t_a: f64,                 // crossing/tangent: 단일 parameter
                                  // coincident: 구간 t0_a
    pub t_b: f64,
    pub kind: IntersectionKind,
}

pub enum IntersectionKind {
    Crossing,
    Tangent,
    Coincident {
        t1_a: f64,                // 구간 끝 parameter on a
        t1_b: f64,                // 구간 끝 parameter on b
        same_direction: bool,     // 두 segment 의 진행 방향 일치 여부
    },
}
```

**분절/유지/폐기 규칙 표** (Step 2 구현 시 코드화 필수):

| op       | Coincident.same_direction = true | same_direction = false |
|----------|----------------------------------|------------------------|
| Union    | 한쪽만 유지 (중복 제거)              | 둘 다 폐기 (구멍 생성)  |
| Subtract | 폐기 (boundary cancel)            | 한쪽 유지 (orientation flip) |
| Intersect| 한쪽만 유지                         | 폐기                    |

#### 7.1.2 Entry/Exit 판정 — Offset 점 inside 테스트

곡선 일반화에서 "교차 시 미분 부호" 는 **불안정** (cusp / inflection
근처에서 fail). 대신 **양 끝 미소 오프셋 점의 inside 테스트** 를
truth 로 사용:

```rust
// pseudo
fn classify_entry_exit(intersection: &Intersection2D, curve_a: &TrimCurve2D,
                        loop_b: &TrimLoop, tol: f64) -> EntryExit {
    let eps = tol.parameter * 10.0;
    let p_before = curve_a.evaluate((intersection.t_a - eps).max(0.0));
    let p_after  = curve_a.evaluate((intersection.t_a + eps).min(1.0));
    let in_before = point_in_trim_loop(p_before, loop_b, tol.geometric);
    let in_after  = point_in_trim_loop(p_after,  loop_b, tol.geometric);
    match (in_before, in_after) {
        (false, true) => EntryExit::Entry,
        (true, false) => EntryExit::Exit,
        (false, false) => EntryExit::Bouncing,    // tangent-like
        (true, true)   => EntryExit::Skimming,    // coincident-like
    }
}
```

`point_in_trim_loop` (Step 1 구현 완료) 와 boundary-vertex probe
(Step 3 구현 완료) 가 이미 안정적으로 작동 → 그대로 활용.

#### 7.1.3 처리 순서 — Coincident → Tangent → Crossing

```
Step 2 의 trim_loop_boolean(a, b, op) 진입 시:
  1. 모든 segment 쌍의 intersection 계산 (kind 분류)
  2. Coincident 먼저 처리 (overlap 구간 분절 + 위 표 적용)
  3. Tangent 처리 (Bouncing 분류 → 곡선 분절 안 함, op-별 유지/폐기)
  4. Crossing 처리 (일반 케이스, Entry/Exit traversal)
  5. Result loop 조립
```

**근거**: Crossing 을 일반 케이스로 두면 Coincident/Tangent 가 nested
edge case 로 묻힘. 위 순서로 진입하면 일반 케이스 코드가 단순해짐.

### 7.2 Step 4 — 2가지 핵심 결정

#### 7.2.1 Detect 와 Repair 분리

```rust
// 감지 단계 — 순수 분석, 부작용 없음
pub fn detect_ssi_pathologies(...) -> SsiRobustnessReport;

// 복구 단계 — 사용자 / 호출자 동의 후 명시 호출
pub fn repair_pcurve_missing(...) -> Result<...>;
pub fn repair_self_intersection(...) -> Result<...>;
```

이유: Steps 1+3+5 에서 검증된 패턴 (foundational primitives 와 정책
분리). Boolean 결과를 **사용자가 받아본 후** 복구 여부 결정 가능.
NIST 코퍼스 검증 시 detect-only 모드로 정확도 측정.

#### 7.2.2 `reconstruct_pcurve` UV 투영 오차 정책

```
3D chain point P 의 UV 투영:
  (u, v) = surface.invert_to_uv(P)            // Newton iteration
  if newton_residual > tol.geometric:
      return Err(PcurveReconstructionFailed)
  if (u, v) outside surface.uv_range:
      // Clamp by tol.parameter (boundary tolerance)
      u = clamp(u, u_min - tol.parameter, u_max + tol.parameter)
      v = clamp(v, v_min - tol.parameter, v_max + tol.parameter)
      // 만약 clamp 거리 > tol.parameter * 10 이면 reject
```

`tol.parameter` (1e-6 default) 가 명시적 boundary slack — Step 1 +
LOCKED #5 와 정합.

### 7.3 다음 세션 실행 순서 (확정)

```
1. Step 2 Skeleton commit:
   - Intersection2D struct + IntersectionKind enum (Coincident 구간 포함)
   - intersect_trim_curves() — Line∩Line / Line∩Arc / Arc∩Arc
     (Bezier 는 sampling fallback)
   - 회귀: 각 kind 별 1개씩 (3개)

2. Step 2 Boolean Traversal commit:
   - trim_loop_intersect() 부터 (가장 단순 — boundary 보존만)
   - trim_loop_union() (Coincident 표 #1 행)
   - trim_loop_subtract() (Coincident 표 #2 행)
   - 회귀: 각 op 별 disjoint/overlap/nested 3개씩 (9개)

3. Step 4 Detection commit:
   - SsiRobustnessReport struct
   - detect_*() 6개 함수
   - 회귀 6개

4. Step 4 Repair commit:
   - reconstruct_pcurve()
   - 회귀 1개 (UV clamp 정책 검증)

5. Final integration:
   - nurbs_boolean_v2() — Steps 1-4 통합
   - 기존 nurbs_boolean MVP 는 #[deprecated] 표시 보존
```

**Acceptance 변동**: 30 회귀 → 28 회귀 (Step 4 detection 6 + repair 1
= 7, spec 의 6개 보다 1개 추가; UV reconstruction 검증 명시 회귀).

### 7.4 변경 이력

- **2026-05-04 (본 amendment)**: Steps 1+3+5 commit 후 사용자 가이드
  반영. Step 2/4 설계 lock-in. 회귀 spec 미세 조정.
- **2026-05-04 (Step 2 commits 397a6f7 → 35fe799 → a7afe62)**:
  Step 2 Skeleton + Boolean Traversal 구현. 3 critical fixes 적용.
  16 회귀 통과.
- **2026-05-04 (Lock-in confirmation)**: 사용자 review 결과 post-jump
  termination guard 가 핵심 안정화 코드로 lock-in 확정. §7.5 추가.

### 7.5 Post-Jump Termination Guard — 영구 Lock-in (사용자 결정)

`crates/axia-geo/src/surfaces/ssi/trim_boolean.rs::greiner_hormann()`
의 다음 코드 블록은 **영구 lock-in** 으로 보호된다:

```rust
if should_jump && !already_visited {
    if let Some(other) = other_idx_opt {
        on_a = !on_a;
        idx = other;
        // Post-jump termination guard — ADR-055 §7.5 lock-in
        if on_a && idx == start && poly.len() > 2 { break; }
    }
}
```

**제거 시 회귀**: `intersect_overlapping_squares` 가 12.5 (잘못된 삼각형
영역) 를 반환. 정상은 25 (직사각형 overlap 영역).

**lock-in 근거** (사용자 review 2026-05-04):
- ADR-055 Amendment §7.1.2 (op-conditional jump rule) 와 정확히 일치
- 실제 GH 구현에서 흔히 발생하는 "start 통과 오염" 차단
- Step 4 (Coincident matrix) 로 교체돼도 유효한 방어선

**변경 절차**: 본 guard 의 제거 / 수정 시 새 amendment 작성 + 사용자
명시 동의 + 회귀 16개 모두 통과 검증 필수.

---

*Amendment Author*: AXiA team (사용자 가이드 + Claude lock-in)
