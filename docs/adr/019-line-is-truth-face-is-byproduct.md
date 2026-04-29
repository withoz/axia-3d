# ADR-019: Line is Truth, Face is Byproduct

**Status**: 🔒 **Accepted & LOCKED** (2026-04-29)
**Supersedes**: ADR-016 §2 (Erase auto-fill table) — interior split fast-path 폐기
**Related**: ADR-007 (Winding), ADR-008 (Axioms — Axiom 1 운영 명시화),
ADR-016 (Conditional B1 + Path B), ADR-017 (Line 격상 — 후속 ADR)

> ⚠️ **DO NOT MODIFY** without explicit user consent.
> 사용자가 명시적으로 거부 또는 변경 요청 전까지 본 ADR 의 결정은
> 모든 후속 세션에서 그대로 유지되어야 합니다 (ADR-014 메타-원칙 #10).

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

### 보강 정의 (Claude 추가, A1-A5)

```
A1. Centerline class edge 는 절단 도구 아님 (가상 기준선).
    Geometry class edge 만 P3 의 절단 효과 발휘.

A2. Vertex 는 edge endpoint 로만 존재 — 단독 1급 entity 아님.
    사용자가 단독 vertex 를 그릴 수 없음.

A3. P4 자동 분할 조건:
      (i) Edge 의 양 endpoint 가 같은 face 의 boundary loop (outer 또는 hole) 위
      (ii) Edge 가 face 와 coplanar (1.5μm exact)
    → 둘 다 만족 시에만 자동 분할.
    한 endpoint 만 boundary, 나머지 face 안 → 분할 안 됨, wire 추가만.
    Skew (비-coplanar) → 분할 안 됨, 3D 공간에 line 만 추가.

A4. 닫힌 cycle 자동 면화 정책 (사용자 Q1=동의):
      • 모든 CCW 닫힌 cycle 이 새 face 가 됨 (signed_area > 0).
      • CW (외곽) cycle 은 skip — 무한 외부 영역 표현 안 함.
      • 다중 cycle 가능 — 모두 처리.

A5. Wire ↔ face boundary 의 통일:
      • Wire = face=null on both HEs of every HE
      • Face boundary = face=fid on at least one HE
      • 둘은 같은 entity, 단지 인접 face 유무가 다름.
      • 사용자 시각으로 동일 line 표시 (wire 도 일반 line 처럼 보임).
```

### 운영 정책 (B1-B5, 사용자 결정 반영)

```
B1. Re-resolve 범위 = local:
    삭제된 edge 의 양 endpoint 주변 connected component 만 재평가.
    Global re-resolve 는 비용 큼, 사용 안 함.
    → resolve_planar_free_faces_scoped(seed_verts) 사용.

B2. Edge 이동 ≡ 양 endpoint vertex 이동:
    "Line 자체 이동" 은 별도 동작 아님 — vertex 위치 변경의 결과.
    Line ID 는 보존 (토폴로지 변화에 robust).

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
    P5/P6 재평가로 닫힌 cycle 발견 시 simple face 로만 합성.
    Hole 자동 형성 안 함. 사용자가 명시적으로 inner-in-outer 그려야
    ADR-016 의 conditional B1 promote 발동.

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
- 새로 생길 face (예측): cyan tint (선택적, 성능 허용 시)

---

## Implementation Plan

### Phase 1 — 진단 + Path B Universal 통일 (2-3일)

- 사용자 화면 시나리오 재현 (인접 floating rect 의 dividing line erase)
- `erase_edge_resynthesize` 를 default erase path 로 통일
- ADR-016 의 hole-edge 분기 + 신규 interior split 분기 통합
- `merge_faces_by_edge_with_tolerance` fast-path → Path B 내부 fast-route 또는 폐기
- Cascade 분기 (Shift) 는 그대로 유지 (B5)

### Phase 2 — 인접 (geometric) 처리 (2일)

- 1.5μm 이내 collinear edge geometric 인접 자동 dedup
- 사용자가 한 line erase 시 같은 위치의 인접 line 동시 처리 옵션
- 또는: 양쪽 별개 line 각각 erase 한 후 자연 재평가로 합성

### Phase 3 — UI (1-2일)

- EraseTool hover preview: amber 단일 (cyan 폐기)
- 영향 시각화: face tint + 예측 cycle 표시
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
test_a4_multiple_cycles_all_become_faces
test_b5_shift_erase_cascades_unchanged
test_b6_no_auto_ring_on_resynthesize
test_b7_coplanar_tolerance_exact
test_xia_inheritance_preserved
test_constraint_cleanup_on_erase
```

기존 LOCKED 회귀 테스트 8개 + ADR-018 새 회귀 그대로 유지.

### Phase 5 — 문서화 + 정합 (1일)

- ADR-016 §2 의 erase table 업데이트 (cyan 분기 폐기)
- ADR-008 Axiom 1 의 본문에 "ADR-019 로 운영 명시화" 주석
- ADR-017 (Edge 격상, 미래) 와의 정합 명시
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
3. **Cyan preview 색상 폐기** — 단순화 trade-off

### Future Work
1. **ADR-017 (Edge 격상)** — line 1급 metadata layer
2. **Curve 메타데이터 (Stage 1)** — 곡선 line 도 동일 원칙 적용
3. **Boolean / Push-Pull 의 동일 원칙 표현** — 복합 도구도 line 추가/삭제의 합

---

## Decision Record

### What we decided (사용자 결정)
1. **A4** — 닫힌 CCW cycle 모두 자동 면화 (Q1=동의)
2. **B5** — Cascade 모드 유지 (Shift+erase) (Q2=b)
3. **B6** — 재평가 시 명시 promote 만 — auto ring 형성 안 함 (Q3=명시)
4. **B7** — Coplanar 1.5μm exact tolerance (Q4=동의)
5. **신규 ADR 작성 진행** (Q5=동의)

### What we rejected
- **자동 통합 (auto-merge) 동작** — 사용자 명시 거부. "통합" 은 별개
  동작이 아니라 토폴로지 재평가의 결과.
- **Cyan/amber/red 3단 hover** — amber 단일 + red(cascade) 만으로 단순화.
- **Cleanup_dangling 자동 호출** — orphan wire 자동 정리 안 함. line 상태 유지.

### Open questions
- ADR-017 (Edge 격상) 과 ADR-019 의 시점 — 동시? 별개? 본 ADR 은
  격상 전후 모두 호환되도록 설계됨.
- Boolean / Push-Pull 의 P1-P6 표현 방식 — 별도 ADR 후보.

---

*Author*: AXiA development (사용자 원칙 정의 + Claude 보강) |
*Implementation*: Phase 1-5 계획, 1.5-2주 (commit hash TBD)
