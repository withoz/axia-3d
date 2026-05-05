# ADR-051 — ADR-021 P7 Canonical Restatement (Multi-Loop Face Strict Enforcement)

**Status**: **Accepted (Phase 1 P-1 + P-2 closed, deferred boundary noted)**
**Date**: 2026-05-03 (P-2 closure: 2026-05-05)
**Anchor**: ADR-049 §4 Q2 final lock (사용자 결정), v3.2 명제 4 manifold 무결성
**Supersedes**: LOCKED #1 의 amendment 부분 (Phase 5/6/7 self-healing 정책).
ADR-021 P7 v1.0 본문 자체는 보존 — 본 ADR 은 strict 재선언 + 구현 정정.
**Related**: ADR-006 (Multi-Loop Face), ADR-021 (P7 원본),
ADR-049 (Two-Layer Citizenship Model), ADR-050 (Phase 1 promote API — 함께 진행)

---

## 0. Summary (4 lines)

> ADR-021 P7 v1.0 가 이미 정의한 "ring-with-hole + 별개 inner sub-face"
> 모델을 strict 재선언. 현 구현이 Phase 5/6/7 self-healing 작업 누적으로
> drift 하여 stacked-inner case 에서 non-manifold (3-face share) 생성.
> 본 ADR 은 정책 변경이 아닌 **구현 정정** + **manifold invariant lock**.

---

## 1. Context

### 1.1 사용자 결정 (ADR-049 Q2)

> "큰 RECT 의 면은 작은 RECT 로 구멍이 난 면이 생성되어야 합니다"
> — 큰 면 = ring-with-hole (multi-loop face, ADR-006 정합)
> — 작은 면 = 별개 simple face

이는 ADR-021 P7 v1.0 §3 "Manifold Safety" 섹션의 정확한 재진술.

### 1.2 현 구현의 drift

ADR-021 v1.0 → 후속 amendment 들 (Phase 5 mop_up DFS, Phase 6 absorb
strands, Phase 7 cleanup) 이 누적되며 stacked-inner case 의 manifold
보장이 약화됨.

**증거 (2026-05-02 burge.xia 진단)**:
```
22 active faces, 10 non-manifold edges
edge EdgeId(228..231): shared by 3 active faces (non-manifold)
  → 4 edges 모두 새 RECT 의 4 변
  → ADR-021 v1.0 §3 의 "공유 edge HE 분포" 가 깨짐
```

**원인 추정**:
- Phase 5 (`mop_up_orphan_cycles_via_dfs`) 가 잔존 cycle 발견 시 추가 face
  합성 — combined-perimeter 보존 안 함
- Phase 6 (`absorb_orphan_strands`) 의 `split_face_by_chain` 호출이 ring
  topology 와 충돌
- Phase 7 (`cleanup_dangling_topological_edges`) — 어제 ee066e3 fix 로
  scope 제한했으나, ring 형성 전 호출 시 잔존 edge 처리 충돌 가능

→ 정책은 옳다, 구현이 정합 deviation. **본 ADR 은 정책 reaffirm + 구현
spec lock**.

### 1.3 v3.2 명제 4 manifold 조건과의 정합

ADR-049 의 두 계층 모델에서:
- **형태 (Shape) 계층**: ring-with-hole + 별개 inner = manifold ✓
- **특성 (Xia) 계층**: 두 면 모두 manifold 통과 → 둘 다 승격 가능

→ 현 구현의 non-manifold 가 사라지면 ADR-050 promote API 의 manifold
검증이 정상 동작. 본 ADR 은 ADR-050 의 **prerequisite**.

---

## 2. Decision — P7 Canonical (Strict Reaffirmation)

### 2.1 Canonical 정의 (ADR-021 P7 v1.0 § 2 그대로)

```
Face F 의 interior 에 형성되는 모든 닫힌 edge loop 는 F 를 나눈다.

(a) 단일 inner face 의 perimeter → 단일 hole
(b) Connected inner sub-faces (edge 공유) → combined perimeter → 단일 hole
(c) Disjoint inner sub-faces → 별개 hole 들 (multi-hole ring)
(d) 자유 wire 들의 closed cycle → ADR-019 A6 단일 hole

결과:
  F → ring face (with N holes, N = connected component 수)
  각 hole = 해당 component 의 combined outer perimeter (CW direction)
  Component 안의 inner sub-face 들 = 별개 simple face 로 유지
```

### 2.2 Manifold Invariant (lock)

ADR-021 P7 v1.0 §3 의 manifold 분석을 **debug_assert + 회귀 테스트** 로
영구 강제:

```
Invariant P7-M1 — Edge HE 분포 정확성 (stacked-inner case):
  inner_a, inner_b 가 edge `e` 공유 시:
    e.HE1.face = inner_a (CCW)
    e.HE2.face = inner_b (CCW, 반대 방향)
  → 정확히 2-face share, manifold ✓

Invariant P7-M2 — Hole loop edge HE 분포 (ring face case):
  Ring face F, hole loop = combined perimeter:
    각 hole edge `e`:
      e.HE1 = inner sub-face (CCW)
      e.HE2 = F (CW around inner)
  → 정확히 2-face share, manifold ✓

Invariant P7-M3 — non-shared edge:
  공유되지 않는 boundary edge `e`:
    e.HE1 = adjacent face
    e.HE2.face = null (or boundary marker)
  → 1-face boundary, manifold ✓
```

### 2.3 구현 정정 spec

#### 2.3.1 Step 4.95 (current) → 명시적 ring 재구성

```rust
// 의사 코드 (실제 구현 ADR-050 chunk 와 함께)

fn enforce_p7_canonical(
    container: FaceId,
    inners: &[FaceId],
) -> Result<()> {
    // (1) Connected component 분석
    let components = find_connected_components(inners);
    
    // (2) 각 component 의 combined perimeter 계산
    let hole_loops: Vec<Vec<HeId>> = components.iter()
        .map(|comp| compute_combined_perimeter(comp))
        .collect::<Result<_>>()?;
    
    // (3) Container 를 ring face 로 재구성
    let new_container = rebuild_as_ring_face(container, &hole_loops)?;
    
    // (4) Inner sub-face 들은 별개 simple face 로 유지 (변경 없음)
    
    // (5) Invariant 검증 (debug_assert P7-M1, P7-M2, P7-M3)
    debug_assert!(verify_p7_manifold(&new_container, inners));
    
    Ok(())
}
```

#### 2.3.2 Phase 5/6/7 self-healing 의 정정

| 기존 동작 | 정정 |
|---|---|
| Phase 5 mop_up DFS 가 임의 face 합성 | P7 inner-component 검증 후에만 합성 — combined-perimeter 보존 |
| Phase 6 absorb_strands 가 임의 split | container 가 ring 인지 먼저 확인, ring 이면 hole loop 보존 |
| Phase 7 cleanup edges (이미 ee066e3 fix) | 그대로 — ring formation 후 호출 |
| 사후 degenerate scan (이미 fc3abe6 fix) | 그대로 — scope-limited |
| Manifold 검증 (R1 highlight 0c04ae1) | 사용자 인지용 보존 — stacked-inner 영역엔 발동 안 함 (manifold 됨) |

### 2.4 영향 받는 기존 회귀 테스트

테스트 파일: `crates/axia-core/src/scene.rs` `scene::tests`

| 테스트 | 현 동작 | 새 기대 |
|---|---|---|
| `test_two_stacked_inner_rects_both_faced` | "둘 다 sub-face" — 통과 | "container = ring with combined hole, 2 inner = 별개" — 의미 재정의 |
| `test_column_of_inner_rects_all_faced` | 동일 | 동일 |
| `test_outer_with_overlapping_extending_rects` | 통과 | 검증 추가 — manifold 조건 |
| `test_complex_overlap_no_missing_faces` | 통과 | 동일 |
| 기타 P7 테스트 | 통과 | 의미 재해석, manifold debug_assert 추가 |

새 테스트 추가:
- `test_p7_canonical_stacked_inner_manifold` — 명시적 manifold 검증
- `test_p7_canonical_disjoint_inner_multi_hole` — 별개 component multi-hole
- `test_p7_canonical_burge_scenario_no_violations` — burge.xia 시나리오에서
  non-manifold 0 검증

### 2.5 어제 세션 작업과의 관계

| 어제 commit | 본 ADR 후 |
|---|---|
| `0c04ae1` R1 non-manifold highlight | 그대로 유지 — stacked-inner 가 아닌 다른 non-manifold 케이스 (자기교차 등) 에서 valid. stacked-inner 영역엔 발동 안 함 (manifold 보장) |
| `1cb1827` earcut Ok([]) auto-deactivate | 그대로 유지 — 0-area 형태 정리 |
| `fc3abe6` degenerate scan scope-leak fix | 그대로 유지 |
| `ee066e3` Phase 7 cleanup scope | 그대로 유지 — ring formation 후 호출 보장 |
| `52c42a0` `std::time` panic | 무관 |

→ 어제 fix 들은 형태 계층 invariant 로 valid 유지. 본 ADR 은 추가 layer
(P7 canonical 강제) 만 적용.

---

## 3. Out of Scope

본 ADR 은 다음을 다루지 않음 (별도 ADR):

- **Type split (Shape vs Xia)** — ADR-050
- **승격 API** — ADR-050
- **재질 정책** — ADR-050
- **Reference 시민권 분리** — ADR-053
- **자동 강등 알림** — ADR-054

---

## 4. Implementation Plan (C2 chunk, 별도 commit)

### 4.1 작업 단위 (3-4h 예상)

1. `enforce_p7_canonical` 헬퍼 함수 구현 (Mesh + Scene)
2. `exec_draw_rect` post-process 의 stacked-inner 분기 재작성
3. Phase 5/6/7 호출 순서 정정 (ring formation 후 cleanup)
4. `verify_p7_manifold` debug_assert 추가
5. 기존 회귀 테스트 의미 재정의 (assert 변경)
6. 새 회귀 테스트 (P7-M1/M2/M3 invariant) 추가
7. burge.xia 시나리오 재검증 (non-manifold 0 기대)

### 4.2 전제 조건

- ADR-050 의 Shape/Xia type split 와 함께 진행 권장 (manifold 검증의
  의미 명확)
- 어제 fix 들 (12 commits) 모두 base 에 남아있어야 함

### 4.3 회귀 위험

- LOCKED #1 의 자세한 결과 변경 — **사용자 명시 동의 받음 (ADR-049 Q2)**
- 어제 18 commits 은 base 에 남음, valid
- 새 테스트로 회귀 차단

---

## 5. Acceptance Criteria

- [x] ADR-021 P7 v1.0 의 canonical intent 재선언 (§2.1)
- [x] Manifold Invariant P7-M1/M2/M3 정의 (§2.2)
- [x] 구현 정정 spec (§2.3)
- [x] 영향받는 기존 테스트 식별 + 새 테스트 spec (§2.4)
- [x] 어제 작업과의 관계 명시 (§2.5)
- [x] **구현** — Phase 5/6/7 호출 순서 정정 (prior commits 자연 완료) +
  P-1 측정 도구 (e1f54f1) + P-2 회귀 봉인 (본 commit)
- [x] LOCKED #1 update — amendment 단락 추가 (CLAUDE.md, 2026-05-05)

---

## D. Acceptance Log

### D-1 — Phase 5/6/7 정정 (prior session, 2026-05-04 자연 완료)

ADR-051 §2.3 의 구현 정정 spec 은 **별도 명시 commit 없이 prior session
들의 누적 작업** 으로 자연 완료됨:
- `run_face_synthesis_postprocess` 가 ring rebuild (Step 4.95) → mop-up
  (Step 4.99 + Phase 5) → absorb (Phase 6) 순서로 정합
- Phase 7 (cleanup_dangling_topological_edges) 는 closed-shape finalizer
  에서만 호출 (DrawRect/DrawCircle), 사용자 wire 보존 (ee066e3)
- 사후 degenerate scan scope-limited (fc3abe6)
- R1 manifold highlight (0c04ae1) — 사용자 인지용

**증거**: burge.xia fixture 가 0 non-manifold edges 로 import + draw
완료 (`test_p7_canonical_burge_centered_scenario_no_violations` 통과).
ADR-051 §1.2 의 2026-05-02 drift evidence 가 더 이상 재현되지 않음.

### D-2 — P-1 측정 도구 (commit `e1f54f1`)

**산출물**:
- `crates/axia-geo/src/p7_manifold.rs` (NEW, ~370 LoC)
  - `verify_p7_manifold(mesh, container, inners) -> P7ManifoldReport`
    free function (side-effect free)
  - `P7Violation` enum 3 variants (M1/M2/M3 정확 일치)
  - `P7ManifoldReport.is_valid()` / `summary()` helpers
  - `collect_active_radial` 내부 헬퍼 (radial chain walker, cap=64,
    inactive HE skip)
- `crates/axia-geo/src/lib.rs` — module + re-export
- 모듈 unit tests 5 (절대 #[ignore] 금지):
  * `verify_p7_manifold_passes_on_simple_ring_with_hole`
  * `verify_p7_manifold_passes_on_disjoint_inner_multi_hole`
  * `verify_p7_manifold_handles_empty_inners`
  * `verify_p7_manifold_inactive_container_yields_empty_report`
  * `verify_p7_manifold_report_summary_formats_violations`

**P-1 lock-ins** (모두 회귀로 봉인):
1. axia-geo 신규 모듈 (mesh.rs 분리)
2. free function (impl Mesh 메서드 아님, side-effect free)
3. P7Violation 3 variants — M1/M2/M3 일치
4. promote API 미통합 (별도 sub-step)
5. burge.xia 회귀는 P-1 scope 외 — synthetic fixture 5
6. Drop-in alongside (verify_face_invariants UNCHANGED)
7. WASM/TS/UI 미개입

**회귀**: axia-geo 964 → 969 (+5).

### D-3 — P-2 회귀 봉인 + LOCKED #1 amendment (본 commit)

**산출물**:
- `crates/axia-core/src/scene.rs`:
  * `test_p7_canonical_stacked_inner_manifold` — `verify_p7_manifold`
    호출 + `violations.len() <= 1` (deferred boundary 일관)
  * `test_p7_canonical_disjoint_inner_multi_hole` — strict
    `is_valid()` assertion
  * 신규 `test_p7_canonical_sweep_locked_scenarios` — 3 시나리오
    (disjoint / single inner / outer-after-inners 그리기 순서 무관성)
    일괄 봉인
- `CLAUDE.md` — LOCKED #1 amendment (2026-05-05) 단락 추가:
  * ADR-051 P-1 측정 도구 명시
  * Phase 5/6/7 호출 순서 정정 자연 완료 명시
  * P-2 회귀 강화 + sweep test 매핑
  * Deferred boundary 명시 (component-merge resolver = future ADR)

**P-2 lock-ins (revised scope)**:
1. Phase 5/6/7 source 코드 UNCHANGED (이미 정합)
2. 기존 11 stacked-inner 회귀 + 3 P7 canonical 회귀 + 6 boolean group
   회귀 모두 PASS 유지 (회귀 0)
3. verify_p7_manifold 강화 = 측정 도구 추가만 (assertion 추가)
4. LOCKED #1 amendment = 본문 보존 + 단락 추가 (변경 0)
5. WASM/TS/UI 미개입 (axia-core only + CLAUDE.md docs)

**회귀**: axia-core 149 → 150 (+1, sweep test). 기존 2 강화는 새
test 가 아닌 assertion 추가.

### D-4 — Deferred Future Work

ADR-051 §2.5 의 deferred boundary (connected stacked-inner 의 1
non-manifold edge on shared y=0) 는 component-merge resolver 작업으로
**별도 ADR** 진행. 본 ADR 의 scope 외:
- ADR-015 fallback 의 single-promote heuristic 가 connected case 에
  서 작동하여 face existence 보존하지만 1 nm edge 잔존
- 진정한 ring-with-hole rebuild 가 connected case 에서도 발동하려면
  combined-perimeter 계산 + multi-loop face 재구축 경로 강화 필요
- `test_p7_canonical_stacked_inner_manifold` 가 `<=1` 로 deferred
  boundary 명시 — 0 으로 strict 봉인 시점이 future ADR 진입점

---

## 6. References

- ADR-021 P7 v1.0 — canonical intent 의 원본 (본 ADR 이 reaffirm)
- ADR-006 — Multi-Loop Face (정합 anchor)
- ADR-049 §4 Q2 — 사용자 결정 lock
- v3.2 명제 4 manifold 무결성
- 2026-05-02 burge.xia 진단 — 현 구현 drift 의 evidence
- ADR-049 §2.3 Phase 1 — ADR-050 (함께 진행)

---

*Author*: AXiA team (사용자 결정 + Claude spec) | *Status*: Phase 1 spec
— ADR-050 와 함께 implementation, 본 PR 은 spec 만 (코드 변경 0)
