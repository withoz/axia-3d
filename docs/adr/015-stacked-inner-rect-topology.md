# ADR-015: Stacked Inner RECT Topology — Manifold-First B1 Policy

**Status**: Superseded by ADR-016 (2026-04-28)
**Supersedes**: ADR-008 Phase E (B1 auto-promote, partial)
**Superseded by**: ADR-016 (Conditional Auto Hole-Promote)
**Related**: ADR-007 (Face Orientation Policy), ADR-008 (Face Operation Axioms), ADR-006 (Multi-loop Face)

> ⚠️ 본 ADR 은 ADR-016 으로 대체되었습니다. ADR-015 의 "B1 전면 비활성"
> 정책은 사용자 UX 손해가 컸습니다 (SketchUp 식 inner-in-outer 워크플로우
> 매번 우클릭 필요). ADR-016 에서 manifold safety 검사를 통한 conditional
> B1 promote 로 변경되었습니다.

> ⚠️ **DO NOT MODIFY** without explicit user consent.
> 사용자가 명시적으로 거부 또는 변경 요청 전까지 본 ADR 의 결정은
> 모든 후속 세션에서 그대로 유지되어야 합니다 (ADR-014 메타-원칙 #10).
> 변경 필요 시: 새 ADR 작성 + 본 ADR 에 `Superseded by ADR-XXX` 표시.

---

## Context

사용자 보고 (2026-04-28): RECT 를 미리보기에서 계속 그리는 동안 일부 RECT 가
"빈 RECT" (wire-only — edge 만 있고 face 없음) 로 남는 회귀.

원인 분석에서 ADR-008 의 두 정책이 직접 충돌함을 발견:

### Axiom 7 (정합 정책)
> Adjacent RECTs (sharing an edge segment) → DCEL edge shared (single
> topology edge with both faces on either side)

shared edge `e` 는 다음과 같이 사용되어야 한다:
- `e.HE1` → inner1 face (CCW direction for inner1)
- `e.HE2` → inner2 face (CCW direction for inner2)

### Phase E B1 hole-promote (구현 정책)
> RECT 가 다른 RECT 안에 그려지면 outer 가 ring face 로 변환되고 inner 는
> hole 이 된다 (multi-loop face via ADR-006 Phase F).

ring face 의 hole loop 는 inner 의 CW perimeter HEs 를 claim 한다.
inner1 의 top edge `e` 의 경우:
- `e.HE1` → inner1 face (CCW: 서쪽 방향)
- `e.HE2` → ring 의 hole loop (CW: 동쪽 방향)

### 충돌 시나리오

사용자가 inner1 위에 inner2 를 그릴 때 (shared edge `e`):
- inner2 의 CCW 경계는 `e` 에서 동쪽 방향 HE 가 필요 = `e.HE2`
- 그러나 `e.HE2` 는 이미 ring hole loop 에 claim 됨
- **DCEL manifold 제약**: 한 HE 는 정확히 하나의 face 에 attach
- → inner2 의 free-cycle 합성 불가 → wire-only

### 시도한 우회

| 접근 | 결과 |
|------|------|
| Step 4.96 host-ring rebuild (dissolve + re-resolve) | leftmost-turn walker 가 CW combined cycle 을 우선 walk → free HE 소진. inner2 CCW cycle 미합성. |
| permissive resolver mode (cycle 방향 HE 만 free 검사) | 다른 케이스 (cross-overlap 4 RECT) 에서 non-manifold 생성. |
| walk_visited rollback | walk 우선순위는 좌우, dedup 의 oldest-first 와 결합되어 inner1 face 를 잘못 흡수. |

세 시도 모두 다른 케이스에 회귀를 유발. 본질적 한계는 leftmost-turn walker
의 cycle-priority + dedup 정책이 stacked-inner 시나리오에 부적합.

---

## Decision

**B1 auto hole-promote 정책을 보수적으로 변경한다.**

### Phase 2 구현 (본 ADR)

1. **`exec_draw_rect` interior fast-path 의 B1 auto-promote 비활성화**:
   - 이전: 새 RECT 가 기존 face 안에 strict interior 면 자동 hole-promote
   - 새: 자동 promote 를 안 함. inner face 와 outer face 가 별개 face 로 공존.
   - 결과: 두 face 가 geometric overlap. 사용자는 **smaller face wins**
     priority 로 인접 face 클릭 가능.

2. **`run_face_synthesis_postprocess` Step 4.8 (B1) 의 자동 promote 비활성화**.

3. **Step 4.95 (second B1) 비활성화**.

4. **명시적 promote 명령 신설** (사용자 요청 시):
   - 우클릭 메뉴: "내부 면을 구멍으로 합치기" (이미 존재 — `merge-as-hole`)
   - 사용자가 명시적으로 호출 시에만 hole-promote 실행
   - 이 경우 사용자는 stacked-inner 시나리오 의도가 아님을 보장

### Manifold 보장

B1 auto-promote 없이 inner face 가 outer face 안에 그려질 때, 토폴로지는:
- outer face: 4-vert 단순 face (원래 RECT 그대로)
- inner face: 4-vert 단순 face
- inner face 의 perimeter HEs:
  - HE1 (CCW direction) → inner face
  - HE2 (CW direction, 외부 향함) → **face=null** (free)

HE2 가 free 인 것은 manifold 측면에서 OK — boundary edge 의 외부 면은
DCEL 에서 face=null (즉 "외부 face") 로 표현 가능. 단순 face 가 다른
face 안에 위치한 경우, 위에서 보면 두 face 가 겹쳐 보이지만 DCEL 은
일관성 유지.

### 인접 시나리오 (Axiom 7 정합)

inner1 + inner2 가 edge 공유:
- shared edge `e`:
  - HE1 (inner2 CCW direction = 동쪽) → inner2 face ✓
  - HE2 (inner1 CCW direction = 서쪽) → inner1 face ✓
- 두 HE 모두 face 보유 → manifold ✓
- Axiom 7 정합 ✓

### 렌더링 영향

geometric overlap 으로 z-fighting 가능성:
- Three.js: `polygonOffset` 으로 mitigation
- inner face 가 더 작으므로 render priority 자연스럽게 위에 올림
- 향후 explicit z-order 또는 render-priority API 도입 가능

### Push/Pull 영향

outer face push/pull 은 OUTER 의 4-vert boundary 만 사용. inner face 영역은
별개 face 이므로 outer push 시 함께 이동 안 함 (정확히는 outer 의 vertex 들만
이동, inner 는 그대로).

만약 사용자가 outer 의 inner 영역까지 함께 push 하길 원하면 별도 명시
operation 필요 (Group 또는 Component 활용).

---

## Implementation

### Code Changes

```rust
// scene.rs exec_draw_rect interior fast-path:
// 이전:
if let Ok(new_outer) = self.promote_face_to_hole(container_fid, inner_fid) {
    // ... XIA migration ...
}
// 새:
// B1 auto-promote 비활성 (ADR-015). inner face 만 생성.
let _ = container_fid;

// scene.rs run_face_synthesis_postprocess:
// Step 4.8 (B1) — 비활성
// Step 4.95 (second B1) — 비활성
```

### Test Coverage

- `test_two_stacked_inner_rects_both_faced`: PASS (인접 inner 양쪽 모두 face).
- `test_column_of_inner_rects_all_faced`: PASS (5-stacked 모두 face).
- `test_overlapping_rects_*`: 여전히 PASS (M1 split 처리).
- `test_lshape_with_inner_rects_all_faced`: 검증.
- `test_2x2_grid_all_faces_synthesize`: 검증.

### Migration

기존 사용자 작업 파일 (B1 hole-promote 된 ring face 보유):
- 직렬화는 `Face::inners` 를 보존하므로 호환성 유지
- 새 작업에서 RECT 를 그릴 때만 정책 변경

---

## Trade-offs

### What we gained
1. **Axiom 7 정합** — 인접 RECT 가 자연스럽게 작동
2. **사용자 UX** — stacked-inner 시나리오가 직관적으로 동작
3. **단순한 토폴로지** — multi-loop face 의 복잡성 제거

### What we lost
1. **Geometric containment 자동 인식** — outer 의 hole 영역이 자동으로 인식
   안 됨. Push/pull 등에서 명시적 처리 필요.
2. **렌더 z-fighting 가능성** — polygonOffset 으로 완화.
3. **Multi-loop face 활용도 감소** — ADR-006 Phase F 의 inner loop 지원은
   유지되지만 자동으로 사용 안 됨. 사용자가 명시적으로 `merge-as-hole`
   할 때만 활용.

### Future Work

- **명시적 hole 그룹화 UX**: 사용자가 multi-inner 그룹을 한 번에 hole-
  promote 할 수 있는 명령 (`merge-as-holes-combined`).
- **자동 hole 감지 heuristic**: 사용자가 inner 를 1 개만 그렸을 때만
  자동 promote (multi-inner 은 명시적 요구). 단, "1 개만" 판단이 동적이라
  현재는 보수적으로 항상 비활성.
- **Group/Component 기반 hole 처리**: SketchUp 식 group 으로 묶고 push/pull
  시 group 단위 처리.

---

## Decision Record

### What we decided
1. B1 auto hole-promote 비활성 (interior fast-path + postprocess Step 4.8/4.95).
2. inner-in-outer 토폴로지를 단순한 두 face 로 처리 (geometric overlap 허용).
3. 사용자 명시적 호출 시에만 hole-promote (`merge-as-hole`).
4. ADR-008 Axiom 7 ("adjacent RECTs share DCEL edge") 를 manifold 안전
   topology 로 보장.

### What we rejected
- **Step 4.96 host-ring rebuild (자동)**: leftmost-turn walker 한계로
  안전한 구현 불가.
- **Permissive resolver mode**: 다른 케이스에 non-manifold 회귀.
- **B1 유지 + adjacency 우회 코드**: 복잡도 폭발, ADR-008 정합성 타협.

### Open questions
- Push/Pull 에서 inner face 가 자동으로 "구멍" 으로 인식되도록 할 것인가?
  (현재는 명시적 hole 처리 필요)
- 향후 multi-inner 자동 그룹화 시점은? (사용자 explicit vs 토폴로지 기반)

---

*Author*: AXiA development (사용자 보고 + Claude 분석) |
*Implementation*: PR Phase 2 (commit hash TBD)
