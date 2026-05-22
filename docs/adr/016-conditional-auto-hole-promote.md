# ADR-016: Conditional Auto Hole-Promote — SketchUp-style Inner-in-Outer

**Status**: Accepted (🔒 LOCKED, 2026-04-28)
**Supersedes**: ADR-015 (Stacked Inner RECT Manifold-First B1 Policy)
**Related**: ADR-006 (Multi-loop Face), ADR-007 (Face Orientation Policy),
ADR-008 (Face Operation Axioms)

> ⚠️ **DO NOT MODIFY** without explicit user consent.
> 사용자가 명시적으로 거부 또는 변경 요청 전까지 본 ADR 의 결정은
> 모든 후속 세션에서 그대로 유지되어야 합니다 (ADR-014 메타-원칙 #10).

---

## Context

ADR-015 는 stacked-inner manifold 위반 (inner1 옆 inner2 가 wire-only 로 남는
회귀) 을 막기 위해 **B1 auto hole-promote 를 전면 비활성** 했다. 그러나
사용자 UX 측면에서:

- inner-in-outer 의 자연스러운 워크플로우 (SketchUp 식) 가 깨짐
- 사용자가 의도적으로 "벽 안에 창문" 을 그린 경우 매번 우클릭으로
  명시적 promote 필요
- "왜 자동으로 안 되지?" 라는 사용자 혼란

사용자 결정 (2026-04-28):
- **Q1 (a)**: SketchUp 처럼 첫 inner 만 auto-promote, 둘째 inner 부터는
  별개 face 로 둠 (manifold 안전).
- **Q2**: Boolean / Push-Pull / Offset 등 multi-loop face 미지원 도구는
  거부 유지 (Solid Tools 관행).
- **Q3 (a)**: 기존 저장 파일 (ADR-015 시기) 마이그레이션 없음.

---

## Decision

### 1. Conditional B1 Auto-Promote

새 RECT 가 기존 face 의 strict interior 일 때:

```
IF promote_safe(container, inner) THEN
    promote inner → hole of container ring
ELSE
    keep inner as separate floating face (no promote)
```

**`promote_safe` 조건** — 모두 충족해야 promote:

1. **Manifold safety** — inner 의 perimeter HE 들이 모두 claim 가능:
   - 각 HE 의 face 가 `container_face` 이거나 `null` (free)
   - 어느 HE 라도 다른 face 또는 다른 hole loop 에 claim 됨 → skip

2. **Single-promote heuristic (SketchUp-style)**:
   - container 가 이미 ring (`face.inners.len() > 0`) 인 경우 → skip
   - 즉 첫 inner 만 promote, 둘째부터는 별개 face

3. **Adjacency check**:
   - inner 의 어느 vert/edge 가 container 의 outer loop 위에 lie 하면 skip
   - 이 경우 M1 split 으로 처리 (별도 sub-face 생성)

### 2. Multi-loop Face Operation Policy

ring face (hole 보유) 에 대한 도구별 정책:

| 도구 | 정책 |
|------|------|
| Push/Pull | 거부 + Toast: "구멍 있는 면은 Push/Pull 미지원. 구멍을 먼저 분리하세요." |
| Boolean | 현재 정책 유지 (이미 거부) |
| Offset | 거부 + Toast |
| Fillet/Bevel (outer boundary) | 허용 |
| Fillet/Bevel (hole boundary) | 거부 + Toast |
| Erase (hole edge) | **Re-synthesize (Path B)** — 인접 face soft-remove → edge 제거 → free-edge resolver → 새 면 합성. amber preview. |
| Move/Rotate/Scale | 허용 (ring 전체 trans) |
| Loop Select | hole boundary 도 따라감 (valence-2 BFS) |
| Material assign | ring face 단위 (hole 영역은 다른 XIA 의 face 가 보유) |

> **Erase auto-fill (cyan) applies only to coplanar interior split edges.**
> **Hole boundary edges trigger Path B re-synthesize (amber).**
>
> 즉 Erase tool 의 hover preview 색상 정책:
> - **Cyan** — outer-loop 끼리 공유하는 interior split edge. fast-path
>   `merge_faces_by_edge` 가 두 face 를 하나로 합침.
> - **Amber** — hole boundary edge. Path B `erase_edge_resynthesize` 로
>   인접 face soft-remove → edge 제거 → free-edge resolver 가 새 면 합성.
> - **Red** — 위 둘 다 아닌 경우. cascade-delete (인접 face 도 삭제).
>
> ### Path B (Erase + Re-synthesize) 동작
> ADR-008 Axiom 1 ("Face = byproduct of topology") 정합. 사용자 정책
> "바운더리가 깨지면 새 boundary 찾아서 새 면 생성" 의 직접 구현.
>
> 1. 대상 edge 의 인접 face 수집 (next_rad 체인 순회 → outer + hole loop 모두 포함)
> 2. 각 face soft-remove (HE next/prev 보존)
> 3. 대상 edge 와 HE 들 제거
> 4. seed verts (edge endpoints + 제거된 face 들의 모든 vert) 기반으로
>    `resolve_planar_free_faces_scoped` 실행 → 새 face 합성
> 5. XIA 승계: 첫 번째 non-None container XIA 가 새 face 들 inherit
>
> **잔여 wire 정책**: 기본 보존 (`cleanup_dangling=false`). SketchUp 식 —
> 사용자가 추가 wire edges 를 별도로 선택해 삭제 가능.
>
> **회귀 테스트**:
> - `test_adr016_path_b_hole_edge_resynthesize` (axia-core)
> - `erase_isolated_edge_is_safe` (axia-geo, no-op 케이스)

### 3. XIA Inheritance on B1 Promote

- container 의 outer XIA: ring face 보유 (id 동일, multi-loop 갱신)
- inner 의 XIA: hole loop **만** 보유, face 영역 없음
- `face_to_xia` 매핑: ring face → container XIA
- `face_inners[]` 의 hole loop 은 별도 XIA 식별자 없음 (boundary-only)
- 사용자 의도: inner XIA 는 "구멍 정의" semantic 으로 남음

### 4. File Migration

기존 ADR-015 시기 저장 파일:
- 별개 face 들로 그대로 로드
- 자동 promote 시도하지 않음
- 사용자가 새 RECT 를 그릴 때만 새 정책 적용

---

## Stacked-inner Behavior (의도된 trade-off)

```
사용자 액션:
1. outer RECT 그림 → 단일 face
2. outer 안에 inner1 그림 → outer 가 ring 으로 변환 + inner1 = hole
3. outer 안에 inner1 옆 inner2 그림 (인접) →
   - container = ring (이미 inners 보유)
   - single-promote heuristic → skip
   - inner2 = 별개 floating face (geometric overlap with ring's hole region 또는 ring's filled region)
```

사용자가 inner2 도 hole 로 만들고 싶으면:
- 우클릭 → "내부 면을 구멍으로 합치기" (`merge-as-hole`)
- 단, manifold 검사 통과해야 함 (inner1 과 edge 공유 시 manifold 위반 → 거부)

---

## Implementation

### Code Changes

#### `crates/axia-core/src/scene.rs`

```rust
// exec_draw_rect interior fast-path:
if let Some(container_fid) = self.find_strict_interior_container(&new_face) {
    if self.promote_safe(container_fid, new_face_id) {
        self.promote_face_to_hole(container_fid, new_face_id)?;
    }
    // else: leave as separate face
}

// run_face_synthesis_postprocess Step 4.8 / 4.95:
// promote_safe 검사 추가 후 conditional fire
```

새 헬퍼 함수:

```rust
fn promote_safe(&self, container: FaceId, inner: FaceId) -> bool {
    // 1. Single-promote heuristic
    if self.mesh.faces[container].inners().len() > 0 {
        return false;
    }

    // 2. Manifold safety
    let inner_face = &self.mesh.faces[inner];
    for he in inner_face.outer_loop_hes() {
        let twin_face = self.mesh.he_twin_face(he);
        if let Some(tf) = twin_face {
            if tf != container { return false; }
        }
        // null = free, OK
    }

    // 3. Adjacency check
    for vid in inner_face.outer_loop_verts() {
        if self.vert_on_loop(vid, container_outer_loop) {
            return false;
        }
    }

    true
}
```

### Test Updates

`test_two_stacked_inner_rects_both_faced`:
- 이전 의미: 두 inner RECT 가 둘 다 별개 face
- 새 의미: 첫 inner = ring's hole (no separate face), 둘째 inner = 별개 face
- 테스트 이름 변경: `test_two_stacked_inner_rects_first_promoted_second_separate`
- 검증: ring 1 개 (with 1 hole) + standalone inner face 1 개 = 총 2 active face

`test_column_of_inner_rects_all_faced`:
- 이전: 5 inner 모두 별개 face
- 새: 1 ring (1 hole) + 4 standalone inner = 5 active face
- 테스트 이름 변경: `test_column_of_inner_rects_first_hole_rest_separate`

기타 회귀 테스트는 이름 변경 또는 의미 명시화.

### New Regression Tests

- `test_b1_single_inner_promotes_to_hole` — 첫 inner promote 검증
- `test_b1_second_inner_stays_separate` — 둘째 inner skip 검증
- `test_b1_skips_when_inner_touches_outer_boundary` — adjacency 검사
- `test_b1_skips_when_he_already_claimed` — manifold safety
- `test_push_pull_rejects_ring_face` — Q2 정책
- `test_offset_rejects_ring_face` — Q2 정책
- `test_erase_hole_edge_separates_inner` — hole edge erase 동작

---

## Trade-offs

### Gained
1. **SketchUp UX 동등성** — 흔한 inner-in-outer 워크플로우 자동
2. **Manifold 안전** — single-promote heuristic 으로 stacked-inner 회귀 차단
3. **명확한 도구 정책** — multi-loop face 는 Solid Tools 관행대로 거부

### Lost
1. **Stacked-inner 자동 통합 불가** — 둘째부터 수동 promote 필요
2. **그리기 순서 의존성 일부 부활** — outer→inner 와 inner→outer postprocess 가 다른 path
3. **inner XIA 의미 약화** — hole 로 흡수된 inner XIA 는 face 영역 없음

### Future Work
- 명시적 multi-inner 그룹화 UX
- 자동 detect: 사용자가 명백히 다중 hole 의도 시 multi-hole rebuild 시도
- Path C (정공법 walker 재설계) 는 별도 ADR 로

---

## Decision Record

### What we decided
1. 첫 inner 만 conditional B1 auto-promote (manifold safety + single-promote).
2. 둘째 inner 부터는 별개 face (사용자 명시적 `merge-as-hole` 만).
3. Multi-loop face 는 Push/Pull/Offset/Boolean 거부 (Solid Tools 관행).
4. 기존 파일 마이그레이션 없음.

### What we rejected
- Path A 무조건 B1: stacked-inner manifold 위반 회귀.
- Path C 정공법 walker 재설계: 시간 소요 + 검증 비용 큼, 별도 ADR.

### Open questions
- multi-hole 사용자 의도 detect heuristic 정의 시점?
- ring face 에 push/pull 허용하는 future 구현 범위?

---

*Author*: AXiA development (사용자 결정 + Claude 분석) |
*Implementation*: Phase 3 (commit hash TBD)
