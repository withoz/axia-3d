# ADR-021: Closed Edge Loop Divides Face

**Status**: Draft
**Owner**: AXiA Geometry/Core
**Supersedes**: ADR-015 LOCKED #1 (single-promote heuristic), ADR-016 single-inner
conditional B1 (확장)
**Related**: ADR-007 (Winding), ADR-008 (Axioms — Axiom 1 운영 명시), ADR-016
(Conditional B1), ADR-019 (Line is Truth, A6)

---

## 0. Summary (4 lines)

> 닫힌 라인(엣지)는 면을 나눈다.
> Connected inner components 는 1 combined hole 로 합쳐진다.
> 그리기 순서 무관 — Case A (inner 먼저) = Case B (outer 먼저).
> ADR-015 의 stacked-inner manifold 우회는 combined-perimeter 로 자연 해결.

---

## 1. Context

ADR-015 LOCKED #1 의 single-promote heuristic 은 stacked-inner 시나리오의
manifold 위반 (HE2 claim 충돌) 을 회피하기 위해 도입되었다. 결과적으로:

- 첫 inner 만 hole-promote
- 둘째 inner 부터 별개 floating face
- → 그리기 순서에 따라 결과 달라짐

사용자 보고 (2026-04-29):
- Case A (2 inner 먼저, big outer 나중): 3 simple face — big 은 ring 아님
- Case B (big outer 먼저, 2 inner 나중): big = ring with 1 hole + 1 floating
- **두 case 모두 사용자 의도 미충족** — 사용자 기대: big = ring with combined
  hole + 2 sub-face

사용자 정의 새 원칙:
> "닫힌 라인(엣지)는 면을 나눈다"

---

## 2. New Principle (P7)

```
P7. Closed Edge Loop Divides Face

Face F 의 interior 에 형성되는 모든 닫힌 edge loop 는 F 를 나눈다.

"닫힌 loop" 의 형태:
  (a) 단일 inner face 의 perimeter → 단일 hole
  (b) 다중 inner faces (edge 공유, connected component) 의 combined
      perimeter → 단일 combined hole
  (c) 다중 inner faces (disjoint, 별개 component) → 별개 hole 들 (multi-hole ring)
  (d) 자유 wire 들의 closed cycle → ADR-019 A6 그대로 (단일 hole)

결과:
  F → ring face (with N holes, N = connected component 수)
  각 hole = 해당 component 의 combined outer perimeter (CW direction)
  Component 안의 inner sub-face 들은 별개 simple face 로 유지
```

---

## 3. Manifold Safety

### Connected component 1 hole (combined perimeter)

```
2 inner (small_1, small_2) sharing 1 edge `e`:
  small_1.outer: 4 HEs (CCW), claims 4 edges' HE1
  small_2.outer: 4 HEs (CCW), claims 4 edges' HE1 (different edges)
  Shared edge `e`:
    HE1: face = small_1
    HE2: face = small_2

big.hole_loop = combined perimeter (6 edges, edge `e` 제외):
  각 hole edge HE2 (CW around inner): face = big (이전 face=null → 이제 hole loop 차지)
  각 inner edge HE1: 변화 없음 (face = small_*)
  
공유 edge `e` 는 hole loop 미경유 → 기존 HE 분포 유지 → manifold ✓
모든 다른 edge: 정확히 2 HEs per edge → manifold ✓
```

### Disjoint inner 들 (별개 component) — multi-hole ring

```
inner_1 (component 1), inner_2 (component 2) — 서로 edge 공유 없음
big.hole_loop_1 = inner_1's perimeter
big.hole_loop_2 = inner_2's perimeter
각각 독립 → manifold ✓
```

---

## 4. Order Independence

```
Case A (inner 먼저, outer 나중):
  draw small_1 → simple face
  draw small_2 → simple face (small_1 과 edge 공유)
  draw big (둘러쌈) → Step 4.95 P7 발동:
    * inners = [small_1, small_2]
    * connected component = {[small_1, small_2]} (1 component)
    * combined perimeter = 6 edges
    * big → ring with 1 combined hole
  결과: 1 ring + 2 sub-face = 3 face ✓

Case B (outer 먼저, inner 나중):
  draw big → simple face
  draw small_1 → ADR-016 conditional B1: container=big, inner=small_1, alone
    → big → ring with 1 hole (small_1's perimeter)
  draw small_2 (인접 small_1) → P7 발동:
    * 기존 hole 해제 (small_1 만 감싸고 있음)
    * 새 component 형성 = {small_1, small_2}
    * combined perimeter 6 edges 로 hole loop 재구성
    → big → ring with 1 combined hole
  결과: 1 ring + 2 sub-face = 3 face ✓ (Case A 와 동일)
```

→ **그리기 순서 무관성 자동 보장**.

---

## 5. Implementation Plan

### Phase 1 — Multi-inner component detection (3-5일)

#### 1.1 새 helper 함수
```rust
// Mesh 또는 Scene 에 추가:

fn find_inner_components(
    container: FaceId,
    candidate_inners: &[FaceId],
) -> Vec<Vec<FaceId>>;

fn compute_combined_perimeter(
    component: &[FaceId],
) -> Result<Vec<VertId>>; // CW direction (hole loop)
```

#### 1.2 Step 4.95 second-pass B1 확장
```rust
// 기존 single-inner B1 → component-based:
// 1. 모든 candidate (active simple face, enclosed by some container) 수집
// 2. container 별로 그룹
// 3. 각 container 의 inners 를 connected component 로 그룹
// 4. 각 component → 1 hole 로 promote_face_to_hole_with_component(combined_perimeter)
```

#### 1.3 Draw 시점 dynamic update
```rust
// New small_2 drawn adjacent to existing small_1 (inside ring):
// 1. Detect connection: new face shares edge with existing sub-face inside ring
// 2. Dissolve current ring's hole loop touching small_1's perimeter
// 3. Recompute combined perimeter (small_1 + small_2)
// 4. Rebuild ring with new combined hole
```

### Phase 2 — Regression tests + 회귀 검증 (2일)

```
test_p7_case_a_inner_first_then_outer_combined_hole
test_p7_case_b_outer_first_then_inner_combined_hole
test_p7_disjoint_inners_multi_hole
test_p7_three_connected_inners_single_combined_hole
test_p7_draw_order_independence_general
```

ADR-015 시기 LOCKED 회귀 테스트 의미 재정의:
- `test_two_stacked_inner_rects_both_faced` →
  `test_two_stacked_inners_form_combined_hole` (또는 변경)
- 기존 "2 simple face" 결과를 "ring + 2 sub-face" 로 변경 의미

### Phase 3 — 문서화 + LOCKED 갱신 (1일)

- ADR-021 v1 → Accepted
- ADR-015 supersede 표시 (LOCKED #1 의 manifold mechanism 변경)
- ADR-016 supersede (single-promote heuristic 확장)
- ADR-019 A4 와 정합 (CCW cycle → face)
- CLAUDE.md LOCKED #1, #8 갱신

**총 작업량**: 1주

---

## 6. Compatibility

### ADR-007 (Winding)
- Combined hole loop 의 winding 계산 — surface_normal hint 우선순위 (ADR-019 6.2):
  1. 영향 face 들 (component 의 inner faces) 의 normal 평균
  2. epoch hint
  3. 3-vertex 자동 추론
- Outer loop CCW, hole loop CW (ADR-007 변경 없음)

### ADR-016 (Conditional B1)
- Single-inner case: 기존 B1 그대로 (P7 의 case (a))
- Multi-inner connected: P7 case (b) 새 처리
- Multi-inner disjoint: P7 case (c) 새 처리

### ADR-018 (Render)
- Ring face 의 wall/sheet 분류: open mesh → uniform white (ADR-018 정합)
- 사용자 시각: hole 영역에 sub-face 들 그대로 보임

### ADR-019 (Line is Truth)
- A4 (CCW cycle 자동 면화): 그대로 적용 — re-resolve 시점
- A6 (DrawLine closed loop): 그대로 적용 — sub-face 합성
- B6 (re-resolve ring 자동 안 함): 유지 — P7 은 draw 시점만, erase 시점은 simple face 만

### ADR-015 LOCKED #1
- Single-promote heuristic → component-based promote 로 확장
- "stacked-inner 별개" 정책 폐기 — combined hole 로 합쳐짐
- 기존 manifold 보호는 combined-perimeter 방식으로 자연 보장

---

## 7. Decision Record

### What we decided
1. **P7 신규 원칙** — 닫힌 edge loop 가 면을 나눈다.
2. **Connected component → 1 combined hole** — 인접 inner 는 합쳐진 hole.
3. **Disjoint inners → multi-hole ring** — 별개 inner 는 별개 hole.
4. **Order independence** — Case A = Case B = 동일 결과.
5. **ADR-015 LOCKED #1 변경** — 사용자 명시 동의로 single-promote 폐기.

### What we rejected
- 단일 inner 만 promote (ADR-016 v1 정책) — 사용자 의도 미충족.
- 사용자 명시 op (`merge-as-hole`) 만 — 자동화 부족.

### Open questions
- 사용자가 의도적으로 "combined 안 시키고 별개 hole" 원하는 경우 UI?
  (현재 정책: connected → 항상 combined. 별개 hole 강제 명령 별도 후보.)
- 3+ inner 의 partial connection (예: A-B 인접 + C 별개) 처리 검증.

---

*Author*: AXiA development (사용자 P7 정의 + Claude 보강) |
*Implementation*: Phase 1-3 (~1주) |
*Date*: 2026-04-29 (charter)
