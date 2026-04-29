# ADR-019: Line is Truth, Face is Byproduct (v2)

**Status**: 🔒 **Accepted & LOCKED** (2026-04-29, v2 갱신)
**Supersedes**: ADR-016 §2 (Erase auto-fill table) — interior split fast-path 폐기
**Related**: ADR-007 (Winding), ADR-008 (Axioms — Axiom 1 운영 명시화),
ADR-016 (Conditional B1 + Path B), ADR-017 (Line 격상, 후속 ADR),
ADR-020 (Centerline Layer Separation, 별도 ADR 후보)

> ⚠️ **DO NOT MODIFY** without explicit user consent.
> 사용자가 명시적으로 거부 또는 변경 요청 전까지 본 ADR 의 결정은
> 모든 후속 세션에서 그대로 유지되어야 합니다 (ADR-014 메타-원칙 #10).

> **v2 변경 (2026-04-29)**:
> - R1 ε = 1.5μm (B7) 명시
> - R2 EdgeClass::Geometry only 명시
> - R3 새 face surface_normal 결정 우선순위 추가 (3단계)
> - R4 sibling 정의 + Path B 직접 reference
> - R5 split_edge 의 ID 보존 약속 폐기 — 현재 동작 (원본 deactivate, 두 새 ID) 명시
> - R6 centerline 절단 효과 없음 명시. "별도 레이어" 는 ADR-020 후보로 분리

---

## Context

ADR-008 Axiom 1 ("Face = byproduct of topology") 은 선언적이었음.
실제 운영에서는 face 가 별개 entity 처럼 취급되었고:

- Erase fast-path 가 "면 통합" 동작으로 인식됨
- Edge 가 익명 boundary 로 취급 (1급 시민 아님)
- 사용자 시각으로 "라인이 사라지면 면이 사라진다" 와 "면을 합친다"
  가 분리된 동작으로 보임

사용자 원칙 정의 (2026-04-29):

> 선이란 존재는 있지만 크게 역할이 없을 수도 있습니다.
> 선을 그리는 것은 경계이자 엣지를 만드는 것입니다.
> 그러므로 엣지는 모든 면과 엣지, 선의 절단 도구입니다.

이는 ADR-008 Axiom 1 의 운영 차원 명시화. 본 ADR 은 이 원칙을 코드 정책 +
회귀 테스트로 고정한다.

---

## Decision

### 핵심 원칙 (사용자 정의 P1-P6)

```
P1. Line 은 1급 entity (ADR-017 격상 후 더 강화).
    단독으로 의미 있을 수 있음 (wire, 주석선, 중심선),
    또는 face boundary 의 일부로 의미 발생.

P2. Line 그리기 = Edge 만들기 = 잠재적 boundary 형성.

P3. Edge 는 모든 면/엣지/선의 절단 도구 (cutting tool).

P4. 면 위에 edge 가 추가되는 순간 기존 면은 자동 분할.

P5. 면의 edge (line) 를 지우면 그 line 만 제거 — 주변 line 은 상태 유지.
    영향 region 토폴로지 재평가 → 닫힌 boundary 있으면 새 면 자동 생성.

P6. 인접 면 사이의 edge 를 지우면 P5 와 동일 메커니즘 — 닫힌 boundary
    찾아 새 면 생성.
```

### 보강 정의 (Claude 추가, A1-A5 + R1-R6 반영)

```
A1. Centerline class edge 는 절단/면화에 참여하지 않음 (가상 기준선).
    Geometry class edge 만 P3 의 절단 효과 발휘.
    Erase 시 centerline 은 자기 자신만 제거 — 주변 face/edge 영향 없음.
    re-resolve 단계의 free-edge collection 은 EdgeClass::Geometry only,
    Centerline 제외.
    (참고: centerline 의 별도 storage / 별도 layer 는 ADR-020 후보로 분리.)

A2. Vertex 는 edge endpoint 로만 존재 — 단독 1급 entity 아님.
    사용자가 단독 vertex 를 그릴 수 없음.

A3. P4 자동 분할 조건:
      (i) Edge 의 양 endpoint 가 같은 face 의 boundary loop (outer 또는 hole)
          위 (definition 아래)
      (ii) Edge 가 face 와 coplanar (1.5μm exact, B7)
    → 둘 다 만족 시에만 자동 분할.
    한 endpoint 만 boundary, 나머지 face 안 → 분할 안 됨, wire 추가만.
    Skew (비-coplanar) → 분할 안 됨, 3D 공간에 line 만 추가.

    Definition — "boundary loop 위 (on a boundary loop)":
      어떤 점 P 가 face 의 boundary loop "위" 에 있다 ⇔
      (a) P 가 boundary 의 기존 vertex 와 정확히 일치 (snap 후 dedup
          기준 1.5μm = ε, B7), OR
      (b) P 가 boundary edge 의 interior (끝점 제외) 위에 있음 (1.5μm 이내).
      (b) 의 경우 해당 boundary edge 는 split_edge 로 분할되어 새 vertex
      가 생성된 후 분할 진행.
      "boundary loop 위" 의 정의는 (a) ∪ (b) 이며, ε = 1.5μm = B7 정책.

A4. 닫힌 cycle 자동 면화 정책 (사용자 Q1=동의):
      • 모든 CCW 닫힌 cycle 이 새 face 가 됨 (signed_area > 0).
      • CW (외곽) cycle 은 skip — 무한 외부 영역 표현 안 함.
      • 다중 cycle 가능 — 모두 처리.

      CCW 판정 기준:
        해당 평면의 surface_normal (오른손 법칙) 기준 signed_area 부호.
        동일 free-edge component 에서 walker 가 동일 경계를 양방향으로
        발견 가능 — surface_normal 기준 CCW 만 채택, CW 는 skip.

      새 face 의 surface_normal 결정 우선순위 (R3):
        1. Erase 영향 face 들의 normal 평균 (가장 자연스러움)
        2. (1) 가 zero / 미가용이면: epoch surface_normal hint
        3. (1)(2) 모두 없으면: 3-vertex 기반 자동 추론 (cross product)
      이 surface_normal 을 ADR-007 Invariant 2 의 hint 로 사용해 winding 강제.

A5. Wire ↔ face boundary 의 통일:
      • Wire = face=null on every HE of the edge
      • Face boundary = face=fid on at least one HE
      • 둘은 같은 entity, 단지 인접 face 유무가 다름.
      • 사용자 시각으로 동일 line 표시 (wire 도 일반 line 처럼 보임).
```

### 운영 정책 (B1-B7, 사용자 결정 반영)

```
B1. Re-resolve 범위 = local:
    삭제된 edge 의 양 endpoint 주변 connected component 만 재평가.
    Free-edge collection: EdgeClass::Geometry only (R6 정합).
    Global re-resolve 는 비용 큼, 사용 안 함.
    → resolve_planar_free_faces_scoped(seed_verts) 사용.

    Definition — "닫힌 boundary (closed boundary)":
      Erase 후 re-resolve 에서의 "닫힌 boundary" 는, 영향 영역 (scope =
      B1 의 local component) 안에서 face=null 이고 EdgeClass::Geometry 인
      free edges 집합을 대상으로 leftmost-turn walker 가 보행했을 때 닫힌
      cycle 을 형성하는 경계를 말한다.
      해당 cycle 이 과거 face 의 일부였든 빈 영역이었든 무관 (A4) — 새
      face 생성 후보가 된다.
      cycle 을 만들지 못하는 격리된 wire chain 은 face 로 승격되지 않음.

B2. Edge 이동 ≡ 양 endpoint vertex 이동:
    "Line 자체 이동" 은 별도 동작 아님 — vertex 위치 변경의 결과.

    B2-addendum — Line / Edge ID stability:
      EdgeId 보존 케이스:
        • vertex translate / rotate / scale (endpoint 이동만)
        • 다른 edge 를 erase 한 후에도 잔존 edge 의 ID 는 유지.
      EdgeId 분기 / 폐기 케이스 (R5 — Option A 채택):
        • split_edge 발생 시 원본 EdgeId 는 deactivate.
          두 조각 모두 새 EdgeId 를 받는다 (현재 split_edge 구현 그대로).
          → 사용자가 "동일 line" 으로 인식하더라도 내부적으로 새 ID.
          향후 ADR-017 (Edge 격상) 단계에서 ID 보존 / metadata 승계
          정책 별도 검토.
        • Boolean / Push-Pull 등에서 만들어지는 교차 / 측면 edge 는
          새 EdgeId — 원본 과 무관.

B3. 자동 생성 sub-edge / sub-vertex 의 owner:
    P4 자동 분할 / P5 재평가로 만들어진 sub-edge / vertex →
    default (no owner). 사용자 직접 그린 line 만 owner XIA 가짐
    (ADR-017 격상 후).

B4. 분할 sub-face XIA 승계:
    P4 자동 분할 결과 sub-face 들 → 원본 face 의 XIA 승계.
    이미 ADR-015 LOCKED #3 정책. 본 ADR 도 동일 유지.

B5. Cascade 모드 (Shift+erase) — 유지 (사용자 Q2=(b)):
    Shift 누르고 erase → "면도 함께 삭제" 명시 cascade.
    재평가 안 함 — 사용자 명시 의도 우선.
    Hover 색상: red (cascade) 그대로 유지.

B6. 재평가 시 ring topology — 명시 promote 만 (사용자 Q3=명시):
    ADR-016 의 conditional B1 promote 는 draw 시점에만 발동.
    Erase 후 re-resolve 단계에서는 ring topology 자동 형성 안 함 —
    발견된 CCW cycle 은 기본적으로 simple face 로 승격.

    Definition — "Sibling" (R4):
      ADR-016 의 ring face 의 hole loop 과 그 안의 inner sub-face 의
      관계. 둘이 같은 hole 영역의 양면 (ring 측 hole HE + inner 측
      outer HE) 을 공유하면 sibling.

    Sibling 관계가 깨지는 경우 (예: hole boundary edge 1개 erase) →
    ADR-016 §2 Path B 의 결과와 동일:
      • Ring 의 hole 제거 → simple face 로 변환
      • Inner sub-face 제거
      • 잔여 wire 보존 (cleanup_dangling = false)
    (ADR-016 §2 Path B 정책 그대로 reference, 본 ADR 에서 재정의 안 함.)

    사용자 명시 op 는 그대로 유지:
      • `merge-as-hole` (우클릭 메뉴) — inner 면을 outer 의 hole 로 명시
        promote. ADR-019 P5/P6 의 자동 동작 위에 사용자 의도 추가.

B7. Coplanar tolerance — 1.5μm exact (사용자 Q4=동의):
    A3 의 coplanar 판정은 spatial-hash dedup 기준 (1.5μm).
    Mesh 층에서 mm 단위 fuzzy snap 금지 (LOCKED 정책 #5 유지).
    UI snap 으로 정렬 — 입력 단계에서 해소.
```

### 통합된 Erase Pipeline (ADR-019 단일 정책)

기존 ADR-016 §2 의 cyan/amber/red 3단 분기 단순화:

```
Erase 동작 (Shift 없을 때 — default):
  사용자가 line 1개 클릭 → 그 line 만 제거 (B2 의 "edge 이동" 과 대조)
  → 영향받은 face 들 soft-remove
  → seed_verts 기반 local re-resolve (B1)
  → 닫힌 CCW cycle 발견 시 새 face (A4, B6: simple only)
  → 다른 line 모두 상태 유지 (P5)
  → orphan wire 도 보존 (cleanup_dangling = false 항상)

Erase + Shift (cascade):
  사용자 명시 cascade → 인접 face 도 직접 삭제, 재평가 안 함 (B5)
```

Hover preview 단순화:
- **amber** — default mode (line 제거 + 토폴로지 재평가)
- **red** — Shift cascade mode

### Hover preview 추가 정보

amber preview 시 영향 시각화:
- 제거되는 line: amber 굵게 강조
- 영향 face 영역: amber tint
- 새로 생길 face (예측): cyan tint (선택적, 성능 허용 시 — 의미 재정의:
  "merge 가능" 이 아니라 "예측되는 새 face 영역")

---

## Implementation Plan

### Phase 1 — 진단 + Path B Universal 통일 (2-3일)

- 사용자 화면 시나리오 재현 (인접 floating rect 의 dividing line erase)
- `erase_edge_resynthesize` 를 default erase path 로 통일
- ADR-016 의 hole-edge 분기 + 신규 interior split 분기 통합
- `merge_faces_by_edge_with_tolerance` fast-path → Path B 내부 fast-route 또는 폐기
- Cascade 분기 (Shift) 는 그대로 유지 (B5)

### Phase 1.5 — 회귀 점검 (mid-checkpoint)

Phase 1 끝나고 기존 LOCKED 8개 회귀 모두 통과 확인 후 Phase 2 진행.
통과 못하면 Phase 1 재작업 (or ADR 재검토).

### Phase 2 — 인접 (geometric) 처리 (2일)

- 1.5μm 이내 collinear edge geometric 인접 자동 dedup
- 사용자가 한 line erase 시 같은 위치의 인접 line 동시 처리 옵션
- 또는: 양쪽 별개 line 각각 erase 한 후 자연 재평가로 합성

### Phase 3 — UI (1-2일)

- EraseTool hover preview: amber 단일 (cyan = "merge 가능" 의미 폐기)
- 영향 시각화: face tint + 예측 cycle 표시 (cyan 색상 의미 재정의)
- Cascade (Shift) red 유지

### Phase 4 — 회귀 테스트 (2일)

새 회귀 테스트 (~20개):
```
test_p4_edge_added_on_face_auto_splits
test_p4_edge_skew_no_split
test_p4_centerline_no_split
test_p5_erase_face_edge_keeps_other_lines
test_p5_erase_creates_new_face_when_cycle_closes
test_p5_orphan_wire_preserved
test_p6_adjacent_face_erase_creates_merged_face
test_p6_drawing_order_independent
test_a3_endpoint_only_no_split
test_a3_boundary_loop_position_definition
test_a4_multiple_cycles_all_become_faces
test_a4_surface_normal_priority
test_b5_shift_erase_cascades_unchanged
test_b6_no_auto_ring_on_resynthesize
test_b6_sibling_break_uses_path_b
test_b7_coplanar_tolerance_exact
test_b2_edge_id_split_creates_two_new_ids
test_xia_inheritance_preserved
test_constraint_cleanup_on_erase
```

기존 LOCKED 회귀 테스트 8개 + ADR-018 새 회귀 그대로 유지.

### Phase 5 — 문서화 + 정합 (1일)

- ADR-016 §2 의 erase table 업데이트 (cyan 분기 폐기)
- ADR-008 Axiom 1 의 본문에 "ADR-019 로 운영 명시화" 주석
- ADR-017 (Edge 격상, 미래) 와의 정합 명시
- ADR-020 (Centerline Layer Separation) 별도 ADR 작성 후보 확인
- CLAUDE.md LOCKED 섹션 갱신

**총 작업량**: 1.5-2주

---

## Trade-offs

### Gained
1. **Mental model 일관성** — Line 1급, Face 결과 — 사용자 직관 정합
2. **Erase 동작 통일** — cyan/amber/red 3단 → amber/red 2단
3. **그리기 순서 무관 자동 보장** — 토폴로지가 진실, 순서 무관
4. **ADR-008 Axiom 1 운영 명시화** — 추후 도구 추가 시 일관 기준
5. **Edge 격상 (ADR-017) 과 자연 정합**

### Lost
1. **Fast-path merge 의 미묘한 동작 손실 가능** — 일부 회귀 케이스 검증 필요
2. **자동 ring formation 안 함** — Erase 후 hole 자동 안 생김 (B6, 사용자 결정)
3. **Cyan preview 색상의 기존 의미 폐기** — 단순화 trade-off
4. **EdgeId 보존 약속 폐기** — split_edge 시 ID 분기 (Option A, B2-addendum)

### Future Work
1. **ADR-017 (Edge 격상)** — line 1급 metadata layer + 가능 시 ID 보존 정책
2. **ADR-020 (Centerline Layer Separation)** — centerline storage / render 분리
3. **Curve 메타데이터 (Stage 1)** — 곡선 line 도 동일 원칙 적용
4. **Boolean / Push-Pull 의 동일 원칙 표현** — 복합 도구도 line 추가/삭제의 합

---

## Decision Record

### What we decided (사용자 결정)
1. **A4** — 닫힌 CCW cycle 모두 자동 면화 (Q1=동의)
2. **B5** — Cascade 모드 유지 (Shift+erase) (Q2=b)
3. **B6** — 재평가 시 명시 promote 만 — auto ring 형성 안 함 (Q3=명시)
4. **B7** — Coplanar 1.5μm exact tolerance (Q4=동의)
5. **신규 ADR 작성 진행** (Q5=동의)
6. **v2 보강** — R1~R6 반영, R5=(A) 정책, R6 의 "별도 레이어" 는 ADR-020 분리

### What we rejected
- **자동 통합 (auto-merge) 동작** — 사용자 명시 거부. "통합" 은 별개
  동작이 아니라 토폴로지 재평가의 결과.
- **Cyan/amber/red 3단 hover** — amber 단일 + red(cascade) 만으로 단순화.
- **Cleanup_dangling 자동 호출** — orphan wire 자동 정리 안 함. line 상태 유지.
- **EdgeId 보존 (split_edge)** — 현재 구현 변경 안 함. 두 새 ID 사용. ADR-017
  격상 시점에 재검토.
- **"Centerline 별도 레이어"** — ADR-019 범위 초과. ADR-020 후보로 분리.

### Open questions
- ADR-017 (Edge 격상) 과 ADR-019 의 시점 — 동시? 별개? 본 ADR 은
  격상 전후 모두 호환되도록 설계됨.
- Boolean / Push-Pull 의 P1-P6 표현 방식 — 별도 ADR 후보.
- ADR-020 의 "별도 레이어" 정의 — 별도 ADR 에서 확정.

---

*Author*: AXiA development (사용자 원칙 정의 + Claude 보강) |
*Implementation*: Phase 1-5 계획, 1.5-2주 (commit hash TBD)
