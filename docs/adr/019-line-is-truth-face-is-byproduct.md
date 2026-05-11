# ADR-019: Line is Truth, Face is Byproduct (v2.1)

**Status**: Draft (canonical statement upgraded to 메타-원칙 #14, 2026-05-08)
**Owner**: AXiA Geometry/Core
**Related**: ADR-007 (Winding), ADR-008 (Axioms), ADR-016 (Conditional B1),
ADR-017 (Edge/Line elevation; future), ADR-018 (Uniform Surface Render),
ADR-020 (Centerline layer separation; candidate), ADR-087 (Kernel-Native
Command Suite Reset 의 anchor)

---

## 0. Summary (Decision Summary — 5 lines)

> **면은 닫힌 경계로부터 유도된다** (메타-원칙 #14, canonical 사용자 통찰
> 2026-05-08).
> Line is Truth. Face is Byproduct.
> Erase는 깨고, 다시 만든다.
> 모든 CCW 닫힌 경계는 면화한다.
> Ring/Hole은 의도적 동작(그릴 때)에만 형성한다.

---

## 1. Context

AXiA는 SketchUp/CAD 계열의 "선 중심" 편집 모델을 목표로 한다. 기존에는
일부 fast-path(자동 merge)와 예외 분기들이 혼재되어, 사용자가 기대하는
"선을 지우면 경계가 재구성되고 면이 다시 생기는" 경험이 일관되지 않았다.

본 ADR은 다음을 명확히 한다.

- 선(Line/Edge)은 1급 본질
- 면(Face)은 선들의 토폴로지 결과
- 삭제/편집은 **경계 무효화 → 재평가(re-resolve)** 로 통일

그리고 **Undo-first UX** 를 기본 철학으로 둔다.

---

## 2. Principles (User-defined)

```
P1. Line은 1급(entity)이다. 단독으로도 존재하며 의미를 가진다.
P2. Line 그리기 = Edge 만들기 = 잠재적 boundary 생성.
P3. Edge는 모든 면/엣지/선의 절단 도구이다.
P4. Edge 추가 → (조건 충족 시) 기존 면 자동 분할.
P5. Edge 삭제 → 그 Edge만 제거. 다른 Line 상태는 유지.
    이후 토폴로지 재평가(re-resolve) 수행, 닫힌 boundary가 있으면
    새 면 자동 생성.
P6. 인접 면의 공유 Edge 삭제 → P5와 동일 메커니즘으로 처리.
```

---

## 3. Augmentations (R1–R6 반영, 명료화)

### A1. EdgeClass and operational participation (Centerline 포함)

- **Geometry class edge** 만 절단/분할/면화/re-resolve 에 참여한다.
- **Centerline class edge** 는 기하 조작 (Move/Offset/Erase) 은 가능하나,
  절단/분할/면화/re-resolve 에는 참여하지 않는다.
- re-resolve 단계의 free-edge collection 에는 `EdgeClass::Geometry` 만
  포함하고 Centerline 은 제외한다.
- **검증 의무 (Phase 1)**: Move/Offset/Erase 도구가 Centerline 을 차별
  없이 처리하는지 회귀 테스트로 확인.
- 참고: Centerline 의 storage / render 분리("레이어")는 범위가 크므로
  **ADR-020** 에서 별도 정의.

### A2. Vertex

- Vertex 는 Edge 의 endpoint 로만 존재한다.
- 단독 vertex 는 1급 엔티티로 취급하지 않는다.

### A3. Auto-split 조건 (R1 포함)

Edge 가 face 를 자동 분할하려면 둘 다 만족해야 한다.

1. 새 Edge 의 양 endpoint 가 같은 face 의 boundary loop "위"
2. 새 Edge 가 해당 face 와 coplanar

**Definition — "boundary loop 위 (on a boundary loop)"** (R1)

점 P 가 boundary loop "위" 에 있음을 의미하는 조건:

- **(a)** P 가 boundary 의 기존 vertex 와 정확히 일치 (snap 포함)
- **(b)** P 가 boundary edge 의 interior (끝점 제외) 위에 있으며 허용오차
  ε 이내. 이 경우 boundary edge 를 split 하여 새 vertex 를 만든 뒤 분할 진행.

ε = **1.5 μm** (= LOCKED #5 의 spatial-hash dedup tolerance — f32 drift
흡수만 허용. 그 이상의 fuzzy snap 은 mesh 층에서 금지).

그 외:

- 한 endpoint 만 boundary 위 → 분할 없음, wire 추가
- non-coplanar → 분할 없음, 3D line 추가

### A4. Closed boundary → face 생성 규칙 (R2/R3)

**Definition — "닫힌 boundary (closed boundary)"** (R2)

Erase 후 re-resolve 에서의 닫힌 boundary 는,

- 영향 영역 (scope; B1 local component) 안에서
- `face = null` 이며
- `EdgeClass::Geometry` 인 free edges 를 대상으로
- leftmost-turn walker 로 보행 시 닫힌 cycle 을 형성하는 경계

를 말한다. cycle 을 만들지 못하는 격리된 wire chain 은 face 로 승격되지
않는다.

**CCW vs CW 선택** (R3)

- CCW 판정은 해당 평면의 surface_normal (오른손 법칙) 기준 signed area 로
  결정한다.
- 동일 free-edge component 에서 동일 경계를 양방향으로 발견하면,
  surface_normal 기준 CCW cycle 만 채택하고 반대 (CW) 는 skip 한다.
- 결과적으로 무한 외부 영역에 해당하는 cycle 은 채택되지 않는다.

### A5. Wire vs Face boundary

- Wire 와 face boundary 는 같은 Edge 이며 차이는 **face 인접 여부 (토폴로지
  결과)** 뿐이다.
- 사용자 시각 표시는 동일 (스타일은 힌트 수준).

### A6. Closed wire loop in face interior — auto-synthesize (2026-04-29 추가)

P3 ("Edge 는 절단 도구") 의 운영 보강.

DrawLine 으로 face 의 interior 에 닫힌 loop 를 형성하면, 입력 방법
(DrawRect/DrawCircle interior fast-path 또는 4-line 수동) 에 무관하게
같은 결과를 보장한다.

**조건 / 동작**:

- DrawLine 의 endpoint 가 기존 vertex 와 dedup (1.5μm) 매칭하거나,
  기존 vertex 와 같은 위치인 경우 → "wire chain extension" 으로 인식
- 즉시 face_synthesis_postprocess 발동 (기존 perf-cut 우회)
- Resolver 가 닫힌 CCW cycle 발견 시 sub-face 자동 합성 (A4 와 정합)
- 합성된 sub-face 는 ADR-016 conditional B1 promote 정책 적용 가능
  (첫 inner 면 hole-promote, 둘째부터 별개 floating face)

**구현 위치**: `exec_draw_line` 의 perf-cut 조건에
`endpoint_connects_existing` 추가.

**사용자 시각 결과**: DrawRect 와 DrawLine 4번이 동일 결과 — "엣지는
어떤 도구로 그리든 절단/면화에 동일하게 참여한다" (P3 정합).

---

## 4. Operational Policies

### B1. Re-resolve scope

- 기본은 **Local scope**: 삭제된 Edge 의 endpoint (또는 seed verts) 에서
  시작하는 연결 성분만 재평가.
- Global 재평가 함수는 backend 에 존재 (`resolve_planar_free_faces`) 하나
  사용자 노출은 하지 않음. 향후 진단 도구로 활용 가능.

### B2. Transform semantics (+ ID stability; R5)

- Edge 이동 = endpoint vertex 이동의 결과.
- 일반 이동/회전/스케일은 edge ID 유지.

**B2-addendum — ID stability**

| 케이스 | 정책 |
|--------|------|
| Vertex translate/rotate/scale | EdgeId 유지 |
| 다른 edge erase 후 잔존 edge | EdgeId 유지 |
| `split_edge` | 원본 EdgeId 비활성화, sub-edge 모두 새 EdgeId 부여 (현 구현 정합) |
| Boolean / Push-Pull 신규 edge | 신규 EdgeId |

EdgeId 보존/승계 변경은 **ADR-017** 에서 재검토.

### B3. Auto-generated sub-edge ownership

- 자동 생성 (split / sub) edge 는 owner 없음 (default).
- 사용자 명시 입력 (직접 그린) edge 만 owner / 메타 보유.

### B4. Sub-face XIA inheritance

- 자동 분할 sub-face 는 원본 face 의 XIA 승계 (LOCKED).

### B5. Cascade mode (Undo-first)

- 기본 Erase 는 P5/P6 re-resolve.
- **Shift+Erase 는 "면도 함께 지우기" 보조 모드로 유지한다** (Q2=b).
- 모든 모드는 Undo-first 를 전제로 즉시 반영.

### B6. Ring/Hole on re-resolve (R4)

- ADR-016 의 conditional B1 promote 는 **draw 시점에만** 적용.
- Erase 후 re-resolve 에서는 ring/hole 을 자동 형성하지 않음.

**Definition — "Sibling"** (R4)

ADR-016 ring face 의 hole loop 와, 그 hole 의 perimeter edges 를 공유하는
**inner sub-face (면 영역은 hole 안쪽)** 의 관계.

Sibling 관계가 끊어질 경우 (예: hole boundary 일부 erase) 는
**ADR-016 §2 Path B** 를 따른다:

- ring → simple face 로 수렴
- inner sub-face → 제거
- 잔여 wire → 보존

(향후 detach-hole 명시 op 로 standalone 복귀 옵션을 도입할 수 있으나,
본 ADR 범위 외)

---

## 5. Erase Semantics (Unified)

> **Erase = merge 가 아니다.**

표준 흐름:

1. Edge 제거
2. 인접 face soft-remove
3. free-edge re-resolve (`EdgeClass::Geometry` 만)
4. CCW 닫힌 boundary → face 생성

**Centerline edge**:

- Move/Offset/Erase 가능
- 절단/면화/re-resolve 불참
- erase 시 자기 자신만 제거

---

## 6. Compatibility & Guardrails

### 6.1 Winding (ADR-007)

- Outer loop → CCW
- Hole loop → CW
- 새 face 생성 시 winding 강제

### 6.2 surface_normal 결정 우선순위 (R3)

re-resolve 로 새 face 생성 시 surface_normal (hint) 을 아래 우선순위로
결정하고, 이를 ADR-007 의 `normal.dot(hint) >= 0` 조건의 hint 로 사용해
winding 을 강제한다.

1. 영향 face 들의 normal 평균
2. (1) 이 0 에 가까우면 epoch surface_normal hint
3. 둘 다 없으면 3-vertex 기반 자동 추론 (cross product)

### 6.3 Coplanar tolerance (I2)

- kernel 의 거리/평면 판정은 **1.5 μm tolerance** 만 허용
- 그 이상의 fuzzy 는 금지, fuzzy 는 UI snap 입력 단계에서만 허용

### 6.4 Undo-first UX

- 위험한 자동 판단 대신 **즉시 적용 + Undo** 가 기본
- 확인 다이얼로그 / 거부 메시지 남발 지양

### 6.5 Render 정합 (ADR-018)

- 새 face 생성 시 ADR-018 의 wall/sheet 분류 (`isFaceInVolume` +
  `isClosedSolid` gate) 자동 적용
- Open mesh 새 face → uniform white
- Closed solid 새 face → 2-tone

---

## 7. Implementation Plan

### Phase 1 — Erase 파이프라인 표준화

- Erase 기본 경로를 re-resolve 표준으로 고정 (`erase_edge_resynthesize`)
- Cascade (Shift) 분기 유지
- Centerline 도구 호환성 검증 포함

### Phase 1.5 — Mid-checkpoint (회귀 검증)

다음 통과 시 Phase 2 진행:

- 기존 LOCKED 회귀 8개 전부
- Appendix B 핵심 5개: #1, #3, #5, #6, #16

미통과 시 Phase 1 재작업 또는 ADR 재검토.

### Phase 2 — 도구별 정합

- Offset / Fillet / Boolean / Push-Pull 의 edge 생성 규칙을 ADR-019 에 정합
- 도구별 회귀 테스트 추가

### Phase 3 — Hover preview 의미 정리

- 기존 cyan (merge 가능) 의미 폐기
- 새 cyan tint = **"새 face 예측 영역"**
- amber = 기본 re-resolve preview
- red = Shift cascade preview

### Phase 4 — Out-of-scope

- Edge/Line metadata elevation 은 **ADR-017** 에서 별도 진행
- ADR-019 구현은 Phase 1–3 으로 종료

### CLAUDE.md 동기화 (필수)

v2.1 커밋과 함께 LOCKED #8 업데이트:

- R5 (`split_edge` ID 정책) 반영
- "별도 레이어" 문구 제거
- ADR-018 / ADR-020 참조 추가

---

## Appendix A — Decision Record (Q1–Q5)

| # | 질문 | 결정 | 근거 |
|---|------|------|------|
| Q1 | A4 "닫힌 cycle 자동 면화 (CCW 모두)" | **YES** | SketchUp 방식, Axiom 1 운영화, Undo-first |
| Q2 | Cascade 모드 (B5) | **유지 (b)** | 보조 모드 가치 + 기본 re-resolve 병행 |
| Q3 | re-resolve 시 ring topology 자동 형성 | **NO** | stacked-inner 회귀 방지, 의도 기반 hole 정책 |
| Q4 | coplanar tolerance (1.5 μm) | **YES** | kernel fuzzy 금지, UI snap만 보정 |
| Q5 | ADR-019 작성/유지 | **YES** | ADR-008 선언을 운영 규칙으로 승격 |

추가 결정:

- **R5**: `split_edge` → 원본 ID 비활성, 새 ID 부여 (현 구현 수용)
- **R6**: Centerline "별도 레이어" 는 ADR-020 분리
- **I1–I13**: 전부 반영 (auto-link artifact 제거 / table 포맷 / 각 항목)

---

## Appendix B — Regression Checklist (20)

1. `erase_interior_split_edge_merges_face`
2. `erase_boundary_edge_breaks_face_then_resolve_if_cycle`
3. `erase_shared_edge_two_faces_resolves_to_merged`
4. `erase_edge_no_cycle_leaves_wires_only`
5. `erase_hole_boundary_triggers_pathB`
6. `centerline_move_offset_erase_no_topology_effect`
7. `centerline_excluded_from_reresolve`
8. `auto_split_requires_both_endpoints_on_same_boundary`
9. `auto_split_endpoint_on_edge_interior_splits_boundary_edge`
10. `auto_split_rejects_non_coplanar`
11. `reresolve_generates_all_ccw_regions`
12. `reresolve_skips_cw_cycles`
13. `surface_normal_hint_uses_affected_faces_average`
14. `surface_normal_fallback_epoch_hint_then_infer`
15. `split_edge_deactivates_original_creates_two_new_ids`
16. `draw_order_independence_rect_inner_outer`
17. `stacked_inner_second_is_separate_face_not_hole`
18. `local_scope_reresolve_does_not_touch_unrelated_components`
19. `coplanar_tolerance_15um_enforced`
20. `undo_first_no_preventive_blocking`

---

## Appendix C — Trade-offs

### Gained

1. 일관된 멘탈 모델 (Line 1급, Face 결과)
2. Erase 동작 통일 (예외 제거)
3. 그리기 순서 무관 보장
4. ADR-008 Axiom 의 운영 규칙화
5. ADR-017 격상과 자연 정합

### Lost

1. 일부 fast-path merge 의 즉시 편의/성능
2. split 시 EdgeId 보존 (ADR-017 까지 수용)
3. cyan = "merge 가능" 직관 (의미 재정의로 학습 비용)

---

*Document version*: v2.1 final — I1–I13 전부 반영
*Date*: 2026-04-29
