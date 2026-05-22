# ADR-067 — Press-Pull Engine (Smart Push/Pull Orchestration)

**Status**: Draft (Step 1 entry — 자동 진입 from ADR-063 §4 큐 commitment 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap §Phase R (UX integration layer)
**Parent**: ADR-060 Phase O Step 3 (push_pull) + Step 4 (boolean_dispatch)
**Prerequisites**: ADR-060 (Phase O 완료) + ADR-063 5/5 step (Phase 1 Path Z 완료)
**Related**: ADR-064 (NURBS Boolean → DCEL, Step 4 의존)

---

## 0. Summary (4 lines)

> SketchUp-style "면 잡고 밀고 당기기" UX 를 5-step 점진 도입.
> Step 1 = push_pull commit 후 인접 coplanar face 자동 merge (잡 edge
> 정리). Step 2-5 는 별도 사인-오프 (Step 4 는 ADR-064 의존). Engine =
> 커널 재구현 X, 기존 자산 (push_pull / boolean_dispatch / merge) 의
> 상위 orchestrator.

---

## 1. Context — 5-step 비전

### 1.1 사용자 비전 (이전 검토 합의)

```
사용자: "툴 하나로 Extrude/Offset/Boolean 자동 결정"
검토:
  - Engine = 상위 controller (커널 재구현 X)
  - State machine: Local / Add / Subtract
  - Preview / Commit 분리
  - Diagnostics 항상 노출 (§F lock-in 일관)
  - NURBS Boolean (ADR-064) 미완 시 mesh fallback 의 silent mismatch 위험
```

### 1.2 5-step 분할 (incremental)

| Step | 영역 | 사용자 가치 | 의존 | 위험 |
|------|------|-----------|------|------|
| **1** | **Auto-merge after push_pull commit** | push_pull 후 잡 edge 자동 정리 | 없음 | **저** |
| 2 | Collision Detection (BVH 기반 face-vs-face) | "관통 경고" Toast | 없음 | 중 |
| 3 | State Machine (LocalDeform / AddVolume / SubtractVolume) | preview 의미 명시 | 없음 | 중 |
| 4 | Add/Subtract Commit Pipeline (extrude proxy + boolean_dispatch) | "면 밀기 → 자동 cut" | **ADR-064** | **고** |
| 5 | UI Mode Display (badge + predictive snap) | UX 완성 | 없음 | 중 |

---

## 2. Step 1 결정 — Auto-merge after push_pull commit

### 2.1 §A — Step 1 scope

**채택 (Step 1)**:
- `Mesh::push_pull` commit 종료 직전 자동 merge pass
- `merge_coplanar_result_faces` (boolean.rs) 재사용
- Top + side faces 대상
- §A drop-in alongside (기존 push_pull behavior 보존)

**제외 (Steps 2-5)**:
- Collision detection / 상태 기계 / Add-Subtract dispatch / UI

### 2.2 §B — 통합 위치

```
push_pull() 흐름 (Step 1 도입 후):
  1. Geometric guards (NaN/dist=0/EPSILON)
  2. is_move_only 모드 판정
  3. push_pull_move_only / push_pull_create_face
  4. ADR-060 Step 3 — BRep surface attach (top + sides)
  5. *NEW* ADR-067 Step 1 — auto-merge coplanar
  6. debug_verify_invariants (ADR-007)
```

### 2.3 §C — 5개 D 결정

| D | 결정 | 비고 |
|---|------|------|
| **D1** | Step 1 만 자동 진입 (Steps 2-5 별도 사인-오프) | ADR-063 §4 commitment |
| **D2** | Auto-merge 위치 = push_pull 끝 직전 | ADR-060 Step 3 surface attach 후 |
| **D3** | Auto-merge 대상 = top + side faces (CreateFace 모드만) | MoveOnly 는 새 face 0 → 무관 |
| **D4** | `merge_coplanar_result_faces` 재사용 | boolean.rs `pub(crate)` 승격 |
| **D5** | PushPullResult 업데이트 — merged top_face / side_faces 반영 | caller 가 정확한 ID 사용 |

### 2.4 §D — 4 영구 Lock-in (Step 1 한정)

```
1. Auto-merge 만 — collision detect / state machine / dispatch 본 ADR scope 외.
   Step 2-5 는 별도 사인-오프 강제 (Step 4 는 ADR-064 prerequisite).

2. CreateFace 모드만 — MoveOnly 는 새 face 0, 무관.

3. merge_coplanar_result_faces 재사용 — 재구현 금지.
   `pub(crate)` 승격 후 push_pull / boolean 양쪽 호출.

4. §A drop-in alongside — 기존 push_pull behavior 변경 0.
   Auto-merge 가 0 face merge 시 결과 동일.
```

---

## 3. Acceptance — Step 1 / 4 회귀

### 3.1 회귀 invariants (절대 #[ignore] 금지)

1. **`auto_merge_after_push_pull_collapses_coplanar_neighbors`** — 인접 coplanar face 가 push_pull 결과에 자동 merge
2. **`auto_merge_preserves_non_coplanar_geometry`** — 비-coplanar face 는 변경 0
3. **`auto_merge_disabled_for_move_only_mode`** — MoveOnly 모드는 auto-merge 미발동 (D3)
4. **`auto_merge_returns_updated_face_ids_in_result`** — `PushPullResult.top_face` / `side_faces` 가 merge 후 ID 반영

### 3.2 위험 매트릭스

| 위험 | 대책 |
|------|------|
| Surface attach (ADR-060 Step 3) 후 merge → surface 데이터 손실 | merge 가 surface 보존 또는 명시 drop |
| 기존 push_pull 회귀 (axia-geo 923) | drop-in alongside 강제 |
| `merge_coplanar_result_faces` 비공개 | `pub(crate)` 승격 |

---

## 4. Future Steps (별도 사인-오프 강제)

```
Step 2: Collision Detection — 1-2개월, 위험 중
Step 3: State Machine     — 1개월, 위험 중
Step 4: Add/Subtract Commit — 2-3개월, 위험 고, ADR-064 의존
Step 5: UI Mode Display    — 1개월, 위험 중
```

본 ADR-067 자동 진입은 **Step 1 한정**. Step 2 진입 시 사용자 명시 사인-오프 + 별도 사전 검토 필요.

---

## 5. References

- ADR-052 master roadmap §Phase R
- ADR-060 Phase O (push_pull / boolean_dispatch / fillet_dispatch)
- ADR-063 §4 Future Queue Commitment (Step 1 자동 진입 약속)
- ADR-064 (NURBS Boolean → DCEL, Step 4 의존)
- 사용자 비전 검토 + 78% lock-in 정합성 결과 2026-05-04

---

*Author*: AXiA team (Step 1 자동 진입 2026-05-04)
*Status*: Step 1 implementation in progress
