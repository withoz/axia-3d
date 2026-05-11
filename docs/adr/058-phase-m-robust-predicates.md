# ADR-058 — Phase M: Robust Geometric Predicates

**Status**: Accepted (Phase M spec — 5 lock-in 사전 적용)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase M, 3주, 위험: 낮음)
**Parent**: ADR-052 §2.3 Phase M
**Prerequisites**: 모두 충족 — Phase J (병행 가능했음) 와 직교
**Related**: ADR-007 (Face Orientation Policy), ADR-055 (Phase J Boolean),
ADR-057 (Phase L Advanced Surfaces — Tangent-touch enabling),
ADR-059 (Phase N Curve & Surface Mandatory — 후속 prerequisite)

---

## 0. Summary (4 lines)

> Shewchuk (1996) adaptive precision predicates 통합. 5개 HOTSPOTS 만
> 교체 (전면 교체 금지) — silent correctness regression 차단. External
> `robust` crate 채택 (자체 구현 금지) + FMA 비활성 강제. Phase L
> Tangent-touch deferred 해소 + Phase N silent bug 사전 차단의 두 enabling.

---

## 1. Context

### 1.1 현재 AxiA 의 sign-determination 패턴

모든 cross product / signed area 가 **naive f64**:

```rust
// ADR-007 winding check
let signed_area = newell_normal.dot(surface_normal_hint);
if signed_area > 0.0 { /* CCW */ }

// M1 mixed-cycle classification
let cross = (b - a).cross(c - a);

// Phase J entry/exit (eps offset 패턴 — partial mitigation)
// Phase J trim_loop_classify::build_containment_tree
// Phase L convexity check
```

### 1.2 문제 — silent wrong topology

4개 거의 공선 점:
```
naive cross.length() ≈ 1e-15  →  sign 이 floating-point 오차에 좌우
                                   같은 입력에 다른 위상 분류
                                   ADR-007 invariant violation
                                   Phase J trim 분류 오류
                                   Phase L convexity 오판
```

### 1.3 Shewchuk (1996) 해결

3-stage adaptive predicates:
- Stage A: 빠른 filter (대부분 케이스 정확)
- Stage B: 더 정확한 filter (대부분 잔여 케이스)
- Stage C: 정확한 expansion 산술 (보장된 정답)

각 stage 의 error bound 추정으로 다음 stage 진입 결정.

### 1.4 Phase M 의 두 enabling 효과

```
1. Phase L Tangent-touch deferred 해소
   현재: dihedral_deg < 1.0 (naive 비교)
   robust 후: orient3d_robust 가 정확히 Equal/Less/Greater 구분
   → FilletSkipReason::TangentNeighbors 가 진짜 tangent 만 분류

2. Phase N (Curve & Surface Mandatory) silent bug 사전 차단
   Phase N 후 모든 도구가 BRep 경로만 사용
   → degenerate edge case 빈도 ↑ (mesh fallback 제거)
   → Phase M 이 robust topology 보장 prerequisite 역할
```

---

## 2. Decision

### 2.1 §A — External `robust` crate 채택 (자체 구현 금지)

```toml
# crates/axia-geo/Cargo.toml
[dependencies]
robust = "1.1"  # BSD3 — Shewchuk predicates port
```

**근거** (사용자 review 2026-05-04):
- Shewchuk 알고리즘은 30년간 변하지 않음 — 자체 구현 가치 0
- NURBS kernel 자체 구현은 **창의적 표현** 영역, robust predicates 는 **수치 정확성** 영역
- 자체 구현 시 Two-Sum / Two-Product round 순서 미세 버그 발견에 수 주 소요

### 2.2 §B — FMA 비활성 강제 (Cargo profile + runtime sanity)

Shewchuk 는 IEEE 754 strict 가 prerequisite. FMA 활성화 시:
```
naive:  a*b + c  →  중간 round → 최종 round  (2 rounds, 오차 분리)
FMA:    a*b + c  →  내부 정확 → 1 round    (1 round, 오차 합침)
```

Two-Sum / Two-Product 의 정확한 보정값 패턴이 깨짐.

```toml
# Cargo.toml — workspace level
[profile.release]
codegen-units = 1
# target-cpu native 사용 시 +fma 자동 추가 — 강제 차단:
# (CI / build script 에서 RUSTFLAGS 검증)
```

런타임 sanity:
```rust
#[cfg(debug_assertions)]
pub fn verify_predicates_environment() {
    // robust crate 의 self-test 호출 — Two-Sum 정확성 검증
    debug_assert!(robust::orient2d(...) == ...);  // known case
}
```

### 2.3 §C — Sign 반환 타입 = `std::cmp::Ordering`

```rust
use std::cmp::Ordering;

pub fn orient2d_robust(a: DVec2, b: DVec2, c: DVec2) -> Ordering;
pub fn orient3d_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3) -> Ordering;
pub fn in_circle_robust(a: DVec2, b: DVec2, c: DVec2, p: DVec2) -> Ordering;
pub fn in_sphere_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3, p: DVec3) -> Ordering;

// 호출 사이트:
match orient2d_robust(a, b, c) {
    Ordering::Less    => /* CW */,
    Ordering::Greater => /* CCW */,
    Ordering::Equal   => /* exactly collinear (robust 보장) */,
}
```

`bool` 금지 — `Equal` 분기 강제 → silent wrong-result 차단.

### 2.4 §D — HOTSPOTS 5개만 교체 (전면 교체 금지)

| # | 위치 | 호출 사이트 | 효과 |
|---|---|---|---|
| 1 | `crates/axia-geo/src/mesh.rs` ADR-007 winding check | `face.normal.dot(surface_normal_hint).signum()` | invariant 신뢰성 |
| 2 | `crates/axia-geo/src/operations/face_split.rs` M1 mixed-cycle | `signed area pre-check` | sub-face 소속 정확 |
| 3 | `crates/axia-geo/src/surfaces/ssi/trim_classify.rs` containment | `point_in_polygon` (probe vertex) | hole nesting 정확 |
| 4 | `crates/axia-geo/src/surfaces/ssi/trim_boolean.rs` entry/exit | eps-offset inside test 보강 | Boolean correctness |
| 5 | `crates/axia-geo/src/operations/fillet_brep.rs` convexity | `(n_a × n_b) · edge_dir` 부호 | Tangent-touch 분류 |

**나머지 cross product 는 naive 유지** — 성능/회귀 영향 최소화.

### 2.5 §E — Performance budget

```
허용 delta (Pre-baseline = Phase L 완료 시점 cargo bench):
  Hot path operations (draw / push-pull):  ≤ 5% slowdown
  Cold path (Boolean / SSI):                ≤ 20% slowdown
  Test suite total runtime:                  ≤ 15% slowdown

측정: cargo test --release wall time, bench 회귀 추가
```

### 2.6 신규 모듈 구조

```
crates/axia-geo/src/
  ├─ predicates/             ← 신규 모듈
  │   ├─ mod.rs             — pub use orient2d_robust 등
  │   ├─ adapter.rs         — robust crate ↔ AxiA 타입 변환 (DVec2/3 ↔ [f64;2/3])
  │   └─ filter.rs          — fast filter chain (선택적 layer)
```

`robust` crate 가 내부 구현 — `predicates/` 는 얇은 adapter + filter.

### 2.7 회귀 테스트 (12개)

#### Predicate correctness (4)
1. `orient2d_robust_classifies_collinear_correctly`
2. `orient3d_robust_classifies_coplanar_correctly`
3. `in_circle_robust_distinguishes_cocircular`
4. `in_sphere_robust_distinguishes_cospherical`

#### Filter chain (2)
5. `fast_filter_returns_same_as_robust_for_non_degenerate`
6. `fast_filter_falls_back_to_robust_at_threshold`

#### HOTSPOT integration (5)
7. `adr_007_winding_uses_orient2d_robust`
8. `m1_mixed_cycle_uses_orient2d_robust`
9. `phase_j_containment_uses_point_in_polygon_robust`
10. `phase_j_entry_exit_eps_offset_unchanged`  (회귀 — 기존 동작 유지 확인)
11. `phase_l_convexity_uses_orient3d_robust`

#### Cross-phase + perf (1+1)
12. `no_existing_regression_breaks` (804 → 804+12 모두 통과)
13. `phase_l_tangent_touch_now_correctly_classified_via_robust` (enabling)

---

## 3. Out of Scope

본 Phase M 가 다루지 않음:

- **모든 cross product 교체** — HOTSPOTS 5개만, 나머지는 후속 phase
- **Predicates 자체 구현** — `robust` crate 사용 (변경 시 새 ADR)
- **Sign != Ordering 반환 타입** — bool 금지 lock-in (변경 시 새 amendment)
- **GPU robust predicates** — CPU 만, 별도 ADR

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| FMA 자동 활성화 | Cargo profile + RUSTFLAGS 검증 + runtime sanity |
| `robust` crate 의존성 | BSD3 — license OK, 1.1 stable |
| Performance 5% 초과 | HOTSPOTS 만 교체 + bench baseline 비교 |
| 기존 회귀 깨짐 | Pre/Post baseline 5-pass 검증 |
| Sign Ordering vs naive 동작 차이 | 기존 회귀에서 silent bug 발견 가능 — 의도적 동작 vs bug 분석 |

---

## 5. §X.5 영구 Lock-in (사용자 결정)

다음 5개 항목은 **영구 lock-in** 으로 보호:

```
1. FMA 비활성 강제
   - Cargo.toml profile.release lock
   - 런타임 verify_predicates_environment() debug_assert
   - 변경 절차: 새 amendment + Two-Sum 정확성 재검증

2. External `robust` crate 채택
   - Cargo.toml dependency lock
   - 자체 구현 금지 — 변경 시 새 ADR (강한 사유 필요)

3. HOTSPOTS 5개만 교체
   - §2.4 5 사이트 lock
   - 6번째 hotspot 추가 시 amendment 필수

4. Sign 반환 = std::cmp::Ordering
   - bool 사용 금지
   - 변경 시 새 amendment + Equal 분기 강제 검증

5. Performance ≤ 5% delta (hot path)
   - bench 회귀로 강제
   - 초과 시 hotspot 재검토 (제거 or 우회)
```

---

## 6. Implementation Plan

### 6.1 4-Step 분할

| Step | 영역 | LOC | 회귀 |
|---|---|---|---|
| 1 | `predicates/` 모듈 + adapter (`robust` crate wrap) | ~150 | 4 |
| 2 | Fast filter chain (선택적 — robust crate 가 자체 보유 시 skip) | ~100 | 2 |
| 3 | 5 HOTSPOTS 교체 (incremental, 각 hotspot 별 commit 가능) | ~250 | 5 |
| 4 | Phase L Tangent-touch enablement + perf bench + final | ~100 | 1+1 |
| **합계** | — | ~600 | **13** |

### 6.2 Pre-baseline 검증 (Step 1 이전)

```
□ cargo test --release: 804 통과 확인
□ cargo bench (운영 중인 bench 가 있으면 시간 기록)
□ Cargo.toml + RUSTFLAGS FMA off 검증
```

### 6.3 Post-baseline 검증 (Step 4 후)

```
□ cargo test --release: ≥ 804 + 12 = 816 통과
□ 깨진 회귀 = 0 (있으면 silent bug vs 의도적 동작 분석)
□ cargo bench: ≤ 5% delta on hot path
□ FMA off runtime sanity check 통과
```

---

## 7. References

- ADR-052 master roadmap §2.3 Phase M
- 사용자 review 2026-05-04 (Phase M 진입점 검토 — 5 lock-ins)
- Shewchuk (1996), *Adaptive Precision Floating-Point Arithmetic and
  Fast Robust Geometric Predicates*
- `robust` crate (BSD3, github.com/georust/robust)
- ADR-007 (Face Orientation Policy — winding hotspot)
- ADR-055 §7.5 (Phase J lock-in 패턴 reference)
- ADR-057 §3.3 (Phase L Tangent-touch deferred — Phase M enables)

---

*Author*: AXiA team (사용자 review 2026-05-04 + Claude spec)
*Status*: Phase M spec accepted — Step 1 부터 incremental 구현
