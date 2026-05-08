# A-ζ 사전검토 — Face synthesis pipeline closed-curve aware

**작성**: 2026-05-08
**상태**: **검토 대기** (사용자 결재 전 코드 변경 0)
**Risk**: **매우 높음** — LOCKED #1 P7 / #12 P11 회귀 자산 직접 영향

---

## 1. 핵심 위험

A-ζ 는 **face synthesis pipeline** 의 핵심 path 변경. 이 영역은:

- LOCKED #1 (ADR-021 P7) — "닫힌 라인은 면을 나눈다"
- LOCKED #12 (ADR-025 P11) — "닫힌 엣지에는 반드시 면이 생성"
- ADR-019 (Line is Truth, Face is Byproduct)

5년간 누적된 **245+ 회귀 자산** 의 direct dependency.

---

## 2. 영향 범위 — 코드 hot-spots

### 2.1 Free-edge loop detection (mesh.rs)

```rust
// 라인 3775: detect_free_edge_loop
//   v0, v1 → 새 line 의 closing 검출. polygon edge cycle 가정.
// 라인 3787: detect_free_edge_loop_excluding
// 라인 3800: detect_loop_by_chain_walk_excluding
//   → vert_to_edge map 의 (v_small, v_large) key 로 walk
//   → self-loop edge 의 (V, V) key 도 traverse 결과에 포함됨
// 라인 3837: detect_loop_by_bfs_excluding
//   → BFS 도 self-loop edge 처리 필요
```

**현재 동작**:
- vert_to_edge walk 시 self-loop edge 가 1 vertex 만 가짐
- `key.v_small != curr_v && key.v_large != curr_v` check 통과 시 self-loop 의 양 endpoint 가 동일 → curr_v 와 매칭
- `other = if key.v_small == curr_v { key.v_large } else { key.v_small }` → other == curr_v (자기 자신)
- neighbor 로 자기 추가 → 무한 loop 또는 잘못된 path

**필요한 변경**:
- `is_self_loop` skip 또는 special-case 처리
- BFS 의 adj map 에 self-loop 가 v→v 자신을 가리키지 않도록 가드

### 2.2 Planar free face resolver (mesh.rs:1519~)

```rust
// resolve_planar_free_faces_scoped
//   → free HE 를 connected component 로 그룹
//   → he_source(he) / hes[he].dst() 사용
//   → self-loop HE 의 src == dst 이므로 같은 vertex 두 번 push
//   → component 빌드 정상 (HashSet 으로 dedup)
//   → resolve_component 가 closed loop 를 face 로 변환
```

**현재 동작**:
- self-loop HE 의 src == dst → component 분류 OK (vertex 1개)
- resolve_component 의 cycle walking 이 polygon 가정 — self-loop 1-HE cycle 처리 미정

**필요한 변경**:
- self-loop component 인식 (HE 1개 + vert 1개 + curve attached)
- `add_face_with_holes` 호출 (≥3 verts 강제) → `add_face_closed_curve` 분기

### 2.3 Postprocess Step 4.5 / 4.95 / 4.99 (scene.rs:1726~)

```rust
// run_face_synthesis_postprocess
//   → Step 4.5: dissolve_and_fan_split
//   → Step 4.95: second-pass for stacked-inner
//   → Step 4.99: resolve_planar_free_faces fixed-point
//   → mop_up_orphan_cycles_via_dfs / split_face_by_chain
```

**필요한 변경**:
- 모든 cycle detection 알고리즘에 self-loop 인식 추가
- `split_face_by_chain` 는 polygon 가정 → closed curve face 분할 가능?
  → ADR-089 의 future scope (deferred)

### 2.4 verify_face_invariants (mesh.rs)

```rust
// I1~I5 invariant 검사
// I3: outer loop 의 vertex count ≥3 강제 (현재)
// → A-δ 의 closed-curve face 와 충돌
```

**필요한 변경**:
- I3 invariant 갱신: closed-curve face (Edge.curve.is_some + self-loop) 는 1-vert outer loop 허용

---

## 3. LOCKED 회귀 자산 (245+ tests)

### 3.1 LOCKED #1 P7 — closed boundary divides face

| 테스트 | 검증 내용 |
|--------|----------|
| `test_p7_canonical_stacked_inner_manifold` | RECT in RECT |
| `test_p7_canonical_disjoint_inner_multi_hole` | 2 disjoint inner |
| `test_p7_canonical_sweep_locked_scenarios` | 3 시나리오 sweep |
| `test_p7_canonical_burge_centered_scenario` | burge fixture |
| `test_two_stacked_inner_rects_both_faced` | 두 stacked rect |
| `test_column_of_inner_rects_all_faced` | 5 stacked rects |
| `test_user_pattern_no_missing_faces` | 사용자 화면 reproduction |
| `test_complex_overlap_no_missing_faces` | 9-RECT overlap |
| (외 약 30+ test) | |

### 3.2 LOCKED #12 P11 — closed edge → 면 합성

| 테스트 | 검증 내용 |
|--------|----------|
| `test_p11_27rect_orphan_count_regression_guard` | 27 RECT 0 orphan |
| `test_user_stress_27_overlapping_rects_all_close` | 사용자 stress |

### 3.3 ADR-007 invariant — winding / normal

`verify_face_invariants` 와 통합 → I3 변경 시 모든 face 의 invariant pass 영향.

---

## 4. 구체적 변경안 — 4 sub-step

A-ζ 자체를 atomic 분할:

### Step 4a — verify_face_invariants 의 I3 갱신 (가장 작음)

- `outer_verts.len() < 3` 체크 → `outer_verts.len() == 1 && edge.curve.is_some()` 허용
- 영향: 모든 face 의 invariant 검사 → polygon face 변화 0 (1-vert + curve 케이스만 통과)
- 회귀: +2 (closed-curve face invariant pass 검증)

### Step 4b — `detect_free_edge_loop_*` self-loop 가드

- `key.v_small == key.v_large` 체크 → self-loop edge skip 또는 special-case
- BFS adj map self-loop guard
- 영향: free-edge loop detection 의 polygon path 변화 0
- 회귀: +3

### Step 4c — `resolve_planar_free_faces_scoped` self-loop component 처리

- 1 HE + 1 vert + curve attached component 인식
- `add_face_with_holes` 호출 분기 → `add_face_closed_curve` 호출
- 영향: postprocess pipeline 의 closed-curve component 자연 합성
- 회귀: +3

### Step 4d — DrawCircle bridging (사용자 facing 진입)

- `exec_draw_circle` (또는 `Command::DrawCircleAsCurve` 신규) 가 N-segment polygon 대신 1-vert + 1 self-loop edge + 1 closed-curve face 생성
- 영향: **사용자 facing 첫 변화** — Circle 이 single self-loop edge
- 회귀: +2 (closed-curve representation end-to-end)
- LOCKED 245+ 회귀 자산 모두 PASS 보장 (postprocess pipeline 무영향)

---

## 5. 잠재 회귀 시나리오

### 5.1 Polygon Circle 회귀 (RECT/사각형 등)

- 현재 DrawCircle 이 N-segment polygon → polygon path 의 P7 / P11 회귀 자산 의존
- **새 closed-curve representation 진입 시**: Circle 의 polygon path 폐기 → 기존 polygon-path 회귀 자산 의존성 변경
- 위험: Circle in Rect (P7 stacked) 의 분할 동작 변경
- **mitigation**: 새 representation 은 separate API (drawCircleAsCurve), 기존 drawCircle UNCHANGED. 사용자 시연 게이트로 양 path 정합 검증.

### 5.2 Boolean / Push-Pull 의 closed-curve face 수용

- 현재 NURBS Boolean (ADR-064/066) 의 entry: polygon faces → SSI
- **A-ζ 후**: closed-curve face 도 Boolean 의 입력 가능?
- 위험: SSI 가 single self-loop edge boundary 인식 못함
- **mitigation**: A-η (Boolean / NURBS SSI 통합) step 에서 별도 처리. A-ζ 는 face 합성만, Boolean 은 deferred.

### 5.3 Push-Pull / create_solid 의 closed-curve face

- closed-curve face → create_solid Extrude → cylinder
- 위험: ADR-079 의 SolidKind 분기가 closed-curve aware 가 아님
- **mitigation**: A-θ 에서 통합. A-ζ 는 단순히 face 가 존재만 보장.

---

## 6. Atomic 진입 권장

A-ζ 를 다시 4 sub-step 분리:

| Sub-step | 변경 | 회귀 | Risk |
|----------|------|------|------|
| **A-ζ-1** | verify_face_invariants I3 갱신 | +2 | 낮음 |
| **A-ζ-2** | detect_free_edge_loop self-loop 가드 | +3 | 중간 |
| **A-ζ-3** | resolve_planar_free_faces closed-curve component | +3 | 중간 |
| **A-ζ-4** | DrawCircleAsCurve bridging + 사용자 시연 | +2 | **높음** |

각 sub-step 별 사용자 결재 권장.

---

## 7. 사용자 시연 게이트 — A-ζ 마무리 직전

### 필수 시나리오 (회귀 검증)

1. ✅ DrawRect / DrawLine 4개 → 면 합성 정상 (polygon path 보존)
2. ✅ DrawRect 안 DrawRect → ring + sub-face (P7 stacked)
3. ✅ DrawCircle (legacy polygon) → 24 segments + face (drawCircle UNCHANGED)
4. 🆕 DrawCircleAsCurve → 1 vert + 1 self-loop edge + 1 face (NEW)
5. 🆕 DrawCircleAsCurve 후 Push/Pull → fail or fallback (closed-curve Push/Pull 은 A-θ 에서 unlock)
6. 🆕 DrawCircleAsCurve 후 selection → 1 EdgeId 한 클릭 (canonical)
7. ✅ LOCKED #1 P7 회귀 자산 모두 PASS (cargo test)
8. ✅ LOCKED #12 P11 회귀 자산 모두 PASS

### 게이트 통과 조건

- 4-step 모두 회귀 0
- 사용자 시연 8 시나리오 모두 ✅
- `cargo test -p axia-core --lib test_p7 test_p11 test_user_pattern test_complex_overlap` 모두 PASS

---

## 8. Rollback 전략

각 sub-step 이 atomic commit. 회귀 발견 시:
- `git revert <commit>` 으로 sub-step 단위 rollback
- `git reset --hard <prev>` 으로 multi-step rollback
- A-ζ 진입 전 baseline: `945f46d` (A-ε closure)

---

## 9. 결재 요청

**다음 진입 옵션**:

| 옵션 | 의미 |
|------|------|
| 🅰 (권장) | **A-ζ-1 (invariant I3 갱신)** 만 먼저 — 가장 작은 변경, low risk |
| 🅱 | A-ζ 전체 (4 sub-step 한 번에) — 일관성, but risk 큼 |
| 🅲 | A-ζ 보류 + 다른 ADR-089 step 우선 (예: A-κ render path) — schema OK 후 visual 먼저 |
| 🅳 | A-ζ 잠시 보류 + 사용자 시연 회고 (1일) | 검증 후 진입 |

**🅰 권장 이유**:
- Path Z atomic 의 atomic 정합 (sub-step 도 atomic)
- 가장 작은 변경 (I3 만, polygon path 변화 0)
- 회귀 +2 만으로 baseline 안전 검증
- 그 다음 sub-step 별도 결재 가능

---

## 10. 사전 답변 — FAQ

**Q. A-ζ 후 사용자 facing 변화?**
- A. A-ζ-3 까지: 변화 0 (postprocess infra 만)
- A-ζ-4 진입 시: DrawCircleAsCurve API 등장 → DrawCircle 와 별도. 사용자 선택.
- 기존 DrawCircle (polygon) 은 K-ζ 답습 — UNCHANGED until A-ν.

**Q. LOCKED #1 P7 회귀 우려?**
- A. polygon-path 의 P7 unchanged (drawCircle 그대로). closed-curve face 는 별도 path → P7 영역 외 (deferred to A-ζ-4 사용자 시연 게이트).

**Q. 3-주 전체 트랙 진행?**
- A. A-ζ 가 가장 큰 risk step. 통과 시 A-η ~ A-ξ 점진 가능. 회귀 시 ADR-089 부분 closure 후 future ADR.

---

*ADR-089 A-ζ 사전검토 — 사용자 결재 전 코드 변경 0. Path Z atomic
의 atomic 분리 (4 sub-step) 권장. 가장 작은 sub-step (I3 갱신) 부터
점진 진입.*
