# ADR-021: Closed Edge Loop Divides Face

**Status**: Superseded by ADR-139 (2026-05-18, Q3=a 결재)

**History**:
- Accepted (2026-04-29)
- Locked as LOCKED #1 (CLAUDE.md §1)
- Amended by ADR-051 (2026-05-05) — strict reaffirmation + verify_p7_manifold
  invariants (P7-M1/M2/M3)
- Extended by ADR-101 (2026-05-15) — Coplanar Partial Overlap Auto-Intersect
  (P7 Completion, 9 PR series)
- Superseded by ADR-139 (2026-05-18, Q3=a 결재) — Auto containment split
  trigger 폐기 (Boundary tool 명시 only). *결과 invariant* (메타-원칙
  #14 닫힌 경계 → 면) 보존, *trigger 정책* 만 supersede.

**Owner**: AXiA Geometry/Core
**Supersedes**: ADR-015 LOCKED #1 (single-promote heuristic), ADR-016 single-inner
conditional B1 (확장)
**Related**: ADR-007 (Winding), ADR-008 (Axioms — Axiom 1 운영 명시), ADR-016
(Conditional B1), ADR-019 (Line is Truth, A6), ADR-051 (P7 strict
reaffirmation), ADR-101 (Coplanar Partial Overlap), ADR-139 (Boundary
Tool + Auto-cycle Deprecation)

**Governance note (2026-05-21, 보고서 P1 정정)**: 본 ADR 의 이전 Status
`Draft` 표기는 거버넌스 drift 였음 — 실제로는 LOCKED #1 anchor +
ADR-051 amendment + ADR-101 extension 모두 active policy 로 인용 중.
메타-원칙 #10 ("ADR 불변 — 변경 시 새 ADR + Superseded") 정합 회복.
자세한 근거는 `reports/엔진_개념_이론_검토_보고서.html` §2 P1 참조.

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

## 6.6 Phase A/B Implementation Update (2026-04-29 v1.1)

### Phase A — HE manifold reverse_loop fix ✅

**Bug 발견 + 수정**: `reverse_loop` (operations/orient.rs) 가 loop HE 의
dst 를 shift 했지만 그 **twin HE 의 dst 는 업데이트 안 함** → 2-manifold
invariant 위반 (edge 의 두 HE 가 같은 dst 를 가짐).

수정: reverse_loop 에서 twin 도 업데이트 (단 twin.face=null 인 경우만 —
multi-shared edge 는 다른 face 의 loop 이라 보호).

영향: Step 4.95 postprocess promote 후 ring 의 outer edge radial 일관성
보장.

### Phase B — Ring as inner candidate ✅ (Test 3B fix)

`run_face_synthesis_postprocess` Step 4.95 의 candidates filter 에서
`f.inners().is_empty()` 제거 — ring 도 더 큰 simple container 의 hole
loop 후보로 인식.

결과: Test 3B (smallest first → middle → largest) 가 두 nested ring 으로
정상 promote.

### Phase C — Ring as container ✅ (b1_promote_safe disjoint allow)

Phase C (commit `c620a88`): `b1_promote_safe` 의 single-promote 제약 완화 →
container 가 ring 이어도 새 inner 가 기존 sub-face 들과 disjoint 인 경우
hole 로 추가 promote.

### Phase D — Ring as container in Step 4.95 + P9 pinch ✅ (ADR-022)

ADR-022 에서 Step 4.95 second-pass 의 simple-only container 제약을 폐기,
ring container 도 처리. 동시에 Connected Case B (vertex 공유 inner) 도
P9 pinch 정책으로 자동 promote 가능.

**해결**: 1B/4B + Connected Case B 모두 자동 처리. 명시적 `merge-as-hole`
우클릭은 보조 op 로만 유지.

## 7. Known Limitations (v1.1 — 2026-04-29)

검토 결과 발견된 v1 의 그리기 순서 의존성:

### Test Matrix

| 시나리오 | Result | 원인 |
|---------|--------|------|
| Inner first → outer (1A, 4A) | ✅ 정상 | v1 P7 정합 |
| Outer first → disjoint inners (1B) | ❌ 1 hole only | container 가 ring 이면 skip |
| Smallest → largest nested (3B) | ❌ outermost simple | inner 가 ring 이면 skip + HE corruption |
| Outer first → mixed (4B) | ❌ 1 hole only | 1B 와 동일 |
| Adjacent Axiom 7 (5A/5B) | ✅ 정상 | edge 공유 자연 처리 |
| M1 partial overlap (2A/2B) | ✅ 정상 | M1 split 안정 |

### 근본 원인

1. **Step 4.95 v1 의 simple-only 제약**:
   ```rust
   if !self.mesh.faces.get(container)
       .map(|f| f.is_active() && f.inners().is_empty())
       .unwrap_or(false)
   { continue; }
   ```
   Container 가 ring 이면 promote 처리 skip. 결과: 추가 inner 들이 새 hole 로 흡수 안 됨.

2. **promote_face_to_hole 의 HE manifold corruption**:
   v1.1 디버깅 중 발견 — middle ring 의 outer edge radial chain 에 두
   HE 가 같은 dst 를 가지는 비정상 상태:
   ```
   HE 12: dst=v6 face=middle
   HE 13: dst=v6 face=NULL  ← 정상이라면 dst=v_other
   ```
   → `he_twin` 이 self 반환 → boundary 검출 실패.
   → ring 을 component perimeter walk 시 실패.

   추정 원인: `make_loop` / `find_halfedge` / `add_face_with_holes` 가
   기존 edge 재사용 시 HE 방향 / dst 를 잘못 설정하는 케이스.

### Workaround (현재)

사용자 측면:
- inner 먼저 그리고 outer 둘러싸기 (Case A 패턴) → 정상 작동
- outer 먼저 그리는 경우 첫 inner 만 hole 로 promote, 후속 inner 는
  명시적 `merge-as-hole` 우클릭 메뉴 사용

### 후속 작업 계획

- **Phase A**: HE manifold corruption 디버깅 (최우선)
  - `add_face_with_holes` 의 HE 재사용 로직 검토
  - 단일 inner promote 도 잠재적으로 영향 (현재는 안 깨지만 위험)
- **Phase B**: ring as inner 처리 (3B 해결, Phase A 후)
- **Phase C**: ring as container 처리 (1B/4B 해결, Phase A/B 후)

---

## 8. Decision Record

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

## Amendment 2026-05-02 — Non-Manifold By Design (P7-N)

P7 의 stacked-inner 케이스 (사용자 보고 시나리오 "RECT 그리면 인접 face 가
wireframe 만 남음" 수사 결과) 에서 발견된 fundamental 결과:

**Stacked inner rectangles produce non-manifold edges by design.**

### 왜

DCEL 은 edge 당 정확히 2 half-edges 를 가진다. P7 은 outer ring 위에 두
개의 inner face 가 같은 edge 를 공유하는 토폴로지를 의도적으로 형성한다:
- Outer ring 의 경계 HE1
- Inner face A 의 경계 HE2
- Inner face B 의 경계 HE3 ← 세 번째 face 가 같은 edge 를 share

이는 `Mesh::verify_face_invariants` 가 "edge shared by 3 active faces
(non-manifold)" 로 보고하는 패턴이다. **위반이 아니라 정책의 직접 산출물**.

### 영향 범위

1. **`Mesh::verify_face_invariants`** 의 non-manifold 카테고리: P7 케이스에선
   informational. Boolean / Merge 사전 검증에서만 hard-fail (ADR-007 원칙 5).
2. **렌더링**: 같은 edge 를 공유한 두 inner face 가 같은 평면에 있어 z-fight
   현상 발생 가능. Rendering layer 가 polygonOffset / outline 강조 등으로
   대응 (ADR-047 R-track 별도 작업).
3. **사용자 인지**: "면이 사라진 것처럼 보임" — 실제 face 는 active. 원인은
   visual artifact. 데이터 손실 아님.

### Pre-commit guard 가 불가능한 이유

verify_face_invariants 만으로는 사용자 버그 패턴과 P7 의 정상 동작을 구분할
수 없다 (둘 다 동일 "edge shared by 3 active faces" 위반 생성). 따라서
`exec_draw_rect` 에 manifold guard 추가 시도는 LOCKED #1 ADR-021 P7 회귀
테스트 (`test_two_stacked_inner_rects_both_faced` /
`test_column_of_inner_rects_all_faced`) 를 깨뜨림.

엔진 단계 안전망 (Boolean/Merge 거부) 은 그대로 유지, draw 경로엔 가드 없음.

### 향후 root fix (Strategy C, 별도 PR)

`exec_draw_line` 의 `split_edge` HE2 claim 로직을 정밀화해서 사용자 패턴은
non-manifold 안 만들고 P7 의 의도된 stacked-inner 패턴은 그대로 유지.
HE 매핑 재설계 + 회귀 광범위 — 신중한 별도 작업 필요.

### Cross-links

- **ADR-007 원칙 5** (Boolean/Merge 사전 검증) — non-manifold 는 거기서만
  hard-fail. Draw 단계는 통과.
- **ADR-047 P32** (Snap chain self-touch) 와 같은 맥락: 정책 (P7) 자체는
  변경하지 않고 enforcement / 시각화 레이어에서 사용자 보호.
- **CLAUDE.md LOCKED #1** — P7 정책 자체는 LOCKED, 변경 시 새 ADR 필요.

---

*Author*: AXiA development (사용자 P7 정의 + Claude 보강) |
*Implementation*: Phase 1-3 (~1주) |
*Date*: 2026-04-29 (charter)
