# ADR-139 B-β audit + 즉시 회피 가이드 (multi-hole connected inner)

**Status**: Accepted (Audit + workaround docs only — β implementation 별도 multi-session PR)
**Date**: 2026-05-19
**Author**: WYKO (사용자 시연 evidence + 결재) + Claude
**Parent ADR**: ADR-139 (Boundary Tool + Auto-cycle Deprecation)

## Canonical anchor (사용자 통찰 + 시연 evidence, 2026-05-19)

### 사용자 결재 누적

> **2026-05-19 #1** (현재 도구 평가):
> "현재 면생성과 분할은 매우 잘됩니다.
>  문제는 멀티홀 큰경계안에 몇개의 연속된 홀이 있을때 문제가 됩니다."

> **2026-05-19 #2** (architectural 통찰):
> "면을 생성할때 안에 도형이 있어도 단순하게 닫힌 선의 경계로 면생성을
>  해야합니다. 별도로 구멍이 나는 면으로 인식하지말고 구멍이 아닌
>  닫힌 경계로만 인식합니다"

→ ADR-139 Q3=a 결재 (LOCKED #1 P7 Superseded) 의 *직접 정합*.
- 큰 RECT 안 inner RECT = 두 simple face (multi-loop 0)
- "구멍 인식" 자체 폐기

## 1. Multi-hole connected inner reproduce 결과 (Real Chromium E2E)

`web/e2e/multi-hole-connected-inner-diagnostic.spec.ts` 4 scenario 측정:

| Scenario | faces 실측 | 예상 | 결과 |
|---|---|---|---|
| **D1: Single inner contained** | **2** ✅ | 2 (ring + hole) | 정상 |
| **D2: 2 connected inners (shared edge)** | **5** ⚠ | 3 | **과한 분할** |
| **D3: 3 connected inners (chain)** | **4** ⚠ | 4 | 추가 분할 가능 |
| **D4: 2 disjoint inners (gap)** | **5** ✅ | 3+ | 정상 |

### 진단

- **Single inner ✅** — LOCKED #1 P7 정상 작동
- **Disjoint inners (gap) ✅** — Multi-hole ring 정상
- **Connected inners (shared edge) ⚠** — 과한 분할, component-merge resolver 의 deferred boundary case 영향

### LOCKED #1 P7 amendment (ADR-051 §2.5 deferred) 인용

> "connected stacked-inner 의 1 non-manifold edge (shared y=0 boundary) 는
>  ADR-051 §2.5 의 component-merge resolver 작업으로 별도 ADR 진행 — 본
>  LOCKED 영역 외 **future work**."

→ **이미 known limitation** 으로 명시 (ADR-051 deferred future work).

## 2. 즉시 사용자 회피 가이드

### 가이드 1 — Inner RECTs 간 gap 두기 (즉시 사용)

**Before (fail)**:
```
큰 RECT (외부)
├─ inner #1 (좌측)
└─ inner #2 (우측) — inner #1 과 *touching* (shared edge)

→ Connected stacked-inner → component-merge resolver fail → 과한 분할
```

**After (정상)**:
```
큰 RECT (외부)
├─ inner #1 (좌측)
│   ↕ 1mm gap
└─ inner #2 (우측) — inner #1 과 *disjoint*

→ Multi-hole ring → ring + 2 holes 정상
```

**최소 gap = 1mm** (LOCKED #5 1.5μm spatial-hash 미만 → connected 검출 안 됨).

### 가이드 2 — 단일 큰 inner RECT 로 합치기

**Before**:
```
inner #1 + inner #2 (인접) → multi-hole connected
```

**After**:
```
inner_merged = 하나의 큰 RECT (#1 ∪ #2 의 bounding box)
→ 단일 hole → ring + 1 hole 정상
```

시각 동등, 단순.

### 가이드 3 — Boolean Difference 명시 op (미래)

ADR-139 β implementation 후 (Boundary tool 신설 후):
```
큰 RECT 그림 → simple face
inner RECT 그림 → 별개 simple face (overlap)
Boolean Difference 명시 → ring (구멍 의도 explicit)
```

## 3. Audit — Containment auto-split 의 entry points (Engine source)

ADR-139 B-β implementation 의 *정확한 source list*:

| File | role | LoC 영향 (추정) |
|---|---|---|
| `crates/axia-geo/src/mesh.rs` | `compute_combined_perimeter` (Step 4.95 P7 promote), Step 4.95 logic, `add_face_with_holes` | ~100-200 |
| `crates/axia-geo/src/operations/geometric_merge.rs` | second_pass logic + inner_loops absorb | ~50-100 |
| `crates/axia-geo/src/operations/face_split.rs` | face split path (hole propagation) | ~30-50 |
| `crates/axia-geo/src/operations/boolean.rs` | hole inheritance | ~30-50 |
| `crates/axia-geo/src/operations/cleave.rs` | cleave 의 inner_loops 처리 | ~20-30 |
| `crates/axia-geo/src/p7_manifold.rs` | verify_p7_manifold (ADR-051) | (보존 OR disable) |
| `crates/axia-geo/src/operations/orient.rs` | second_pass orient | ~20-30 |
| `crates/axia-geo/src/operations/create_solid.rs` | per-op inner_loops | ~20-30 |
| `crates/axia-geo/src/operations/revolve.rs` | per-op inner_loops | ~20-30 |
| `crates/axia-geo/src/operations/offset.rs` | per-op inner_loops | ~20-30 |
| `crates/axia-geo/src/operations/fillet.rs` | per-op inner_loops | ~20-30 |
| `crates/axia-geo/src/operations/subdivide.rs` | per-op inner_loops | ~20-30 |

**Total Engine scope**: ~400-600 LoC across 12 files.

### 회귀 자산 영향

| Test category | Count | Update type |
|---|---|---|
| LOCKED #1 P7 회귀 자산 | 14 tests | 의미 변경 (ring + hole → 두 simple face) |
| LOCKED #41 ADR-101 회귀 자산 | 다수 | partial overlap split 정합 보존 (ring case 만 변경) |
| ADR-051 verify_p7_manifold 자산 | 5 | deprecation (multi-loop 자체 없음) |
| 새 회귀 자산 (Path B containment 정합) | ~10 신규 | "containment → 두 simple face" 검증 |

**Total test impact**: ~30-40 tests update + ~10 신규.

## 4. Multi-session sub-step plan (B-β-1 ~ B-β-7)

ADR-139 B-β 의 atomic 분할 (multi-week atomic, 각 sub-step 별 PR):

| Sub-step | Scope | 비용 |
|---|---|---|
| **B-β-1** | `mesh.rs::add_face_with_holes` 의 containment 시 hole loop 생성 폐기 + Step 4.95 disable | ~2-3일 |
| **B-β-2** | `geometric_merge.rs::second_pass` 의 inner_loops absorb 폐기 | ~1-2일 |
| **B-β-3** | `face_split.rs / boolean.rs / cleave.rs` 의 hole propagation 폐기 | ~1-2일 |
| **B-β-4** | per-op (revolve/offset/fillet/subdivide/create_solid) 의 inner_loops 처리 폐기 | ~2-3일 |
| **B-β-5** | LOCKED #1 P7 회귀 자산 14 tests update (의미 변경) | ~1-2일 |
| **B-β-6** | LOCKED #41 ADR-101 회귀 자산 update (ring case 만) | ~1일 |
| **B-β-7** | ADR-051 verify_p7_manifold deprecation + p7_manifold.rs disable | ~1일 |

**예상 총 소요**: 9-14일 atomic (~2-3주).

## 5. 사용자 결재 trigger (multi-session 진행)

각 sub-step 진입 전 사용자 결재:
- **B-β-1 결재**: Engine 첫 commit — `add_face_with_holes` 의미 변경, Step 4.95 disable. 시연 검증 후 다음 step.
- **B-β-2~7 결재**: 각각 별도 PR + 사용자 시연 검증.

## 6. ADR-139 Q1~Q5 결재 정합 명시

| Q | 결재 | 본 audit 정합 |
|---|---|---|
| Q1 | Path A (Pure Boundary only) | ✅ B-β-1~7 atomic plan = Path A 의 첫 phase (containment 부분만) |
| Q2 | DrawRect/Circle single-op 보존 | ✅ Containment 폐기 후에도 single op auto-face 보존 |
| Q3 | LOCKED #1 P7 / #12 / #41 Superseded | ✅ B-β-1~7 가 정확 LOCKED #1 P7 supersede 진행 |
| Q4 | 60+ tests 재작성 | ✅ B-β-5/6 atomic 단계로 분할 |
| Q5 | ADR-138 흡수 | ✅ B-β-1 의 결과 = ADR-138 Path B 의 *containment 부분* (자연 흡수) |

## 7. 사용자 facing 가치 매트릭스

| 시나리오 | 현재 (P7 active) | 즉시 회피 (가이드 1/2) | B-β-1 후 |
|---|---|---|---|
| Single inner | ring + hole (2 face) | (해당 없음) | 두 simple (2 face) |
| 2 disjoint inners | ring + 2 holes (3 face) | (그대로) | 3 simple (3 face) |
| **2 connected inners (shared edge)** | **과한 분할 (5 face) ⚠** | **gap 두기 → 3 face ✅** | **3 simple (3 face) ✅** |
| 3 connected inners | 과한 분할 (4 face) | gap → 4 face | 4 simple |
| Multi-hole nested | 복잡 multi-loop | 회피 어려움 | 모두 simple |

## 8. Lock-ins (사용자 결재 정합)

- **L-AUDIT-1** 즉시 회피 가이드 (gap 두기) = 사용자 즉시 사용 가능
- **L-AUDIT-2** B-β multi-session atomic plan = 9-14일 (사용자 시연 게이트 ADR-087 K-ζ canonical 답습)
- **L-AUDIT-3** Engine source scope 정확 명시 (~400-600 LoC across 12 files)
- **L-AUDIT-4** 회귀 자산 영향 명시 (~30-40 tests update + ~10 신규)
- **L-AUDIT-5** ADR-139 Q1~Q5 결재 정합 (Path A 의 첫 phase)
- **L-AUDIT-6** ADR-138 자연 흡수 정합 (B-β-1 결과 = Path B containment)
- **L-AUDIT-7** LOCKED #1 P7 amendment ADR-051 §2.5 deferred case 의 architectural 해소

## 9. Cross-link

- ADR-139 (Boundary Tool — parent ADR)
- ADR-138 (Multi-loop Face Policy Path B — 자연 흡수, B-β-1 결과)
- LOCKED #1 ADR-021 P7 (Superseded by ADR-139 Q3=a)
- LOCKED #1 P7 amendment (ADR-051 §2.5 deferred boundary case)
- 메타-원칙 #14 (불변 — 닫힌 경계 → 면)
- 메타-원칙 #16 (신설 후보 — 자동화 antipattern)
- ADR-087 K-ζ canonical (사용자 시연 게이트)

## 10. Acceptance Log

- **2026-05-19 audit**: 사용자 시연 evidence + reproduce + Engine source audit + 즉시 회피 가이드 + multi-session sub-step plan 작성
- **(B-β-1 결재): TBD** — 사용자 결재 후 별도 PR + multi-session 진행

---

**다음 trigger** (사용자 결재 시 진행):
- B-β-1 진입 (Engine first atomic step — mesh.rs containment auto-split 폐기)
- 사용자 시연 검증 (ADR-087 K-ζ canonical) 매 sub-step 별
- B-β-2~7 단계별 결재 + atomic
