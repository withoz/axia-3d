# ADR-120 — NURBS-Aware Coplanar Intersect (LOCKED #43 Priority #4 — α spec)

| Field | Value |
|---|---|
| Status | **Proposed (α spec only — algorithm path lock-in pending 사용자 결재)** |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결정 + Claude spec) |
| Anchor | LOCKED #43 절대 우선순위 priority #4 — "NURBS-aware coplanar intersect" |
| Parent | ADR-101 (§5 Out-of-scope `Non-convex polygon clipping` + `NURBS-aware coplanar intersect`), ADR-027 (NURBS Kernel Initiative), ADR-064 / ADR-066 (NURBS Boolean DCEL — 3D 변형, 본 ADR 은 2D coplanar 변형) |
| Cross-cut | ADR-089 (Path B closed-curve face — actual scenario carrier), ADR-101 Amendment 9 §A9.8 (결함 D — vertex-on-corner natural resolution via ADR-107 ζ-β), ADR-046 P31 (P1 + P3 가치 anchor) |

---

## 0. Summary

> ADR-101 §5 의 두 Out-of-scope 항목 (Non-convex polygon clipping + NURBS-aware coplanar intersect) 을 *통합* 해소하는 architectural ADR. 현재 ADR-101 B-1 은 Sutherland-Hodgman MVP (convex-only, polygonize 후 clip). 본 ADR 은 4 algorithm path options 매트릭스 + lettered options 으로 사용자 결재 후 implementation 진입. ADR-118 답습 패턴 (α spec only PR).

---

## 1. Context

### 1.1 ADR-101 § Out-of-scope 두 항목

ADR-101 §5 명시:
```
- Non-convex polygon clipping — Weiler-Atherton / Vatti 필요 시 별도 ADR
- NURBS-aware coplanar intersect (현재 polygonize 후 clip → 향후 직접
  NURBS SSI) — ADR-027/064 cross-cut, 별도 ADR
```

본 ADR-120 가 두 항목 모두 다룸 — **자연스러운 통합** 이유:
- 둘 다 ADR-101 B-3 `auto_intersect_coplanar` 의 algorithmic limit
- 둘 다 polygonize_closed_curve_face (chord_tol-driven sampling) 의 우회
- 사용자 facing 으로는 같은 "겹친 도형 자동 분할" UX

### 1.2 ADR-101 결함 D 자연 해소 evidence (ADR-107 ζ-β)

ADR-101 Amendment 9 §A9.8 (canonical evidence):
> ADR-107 ζ-β engine dispatch (`drawCircleAsShape` → `drawCircleAsCurve` 자동 변환) 후 사용자 시연 시 결함 D **자동 해소**. 별도 algorithm-level fix ADR 불필요.

**Why**: Path B canonical (chord_tol-driven sampling) 이 cardinal alignment 회피 → vertex-on-corner degeneracy *trigger 자체* 차단.

→ **현재 trigger 강도 약화**: 사용자 actual scenarios 에서 결함 D 발생 안 함. 본 ADR 의 trigger 는 *general architectural completeness*, 즉시 user-facing 회귀 fix 아님.

### 1.3 본 ADR trigger 사용자 가치 (ADR-046 P31)

- **P1 (건축/디자인)**: edge case (vertex-on-edge / coincident edge / non-convex profile) 영구 robustness — STEP/IGES import 시 vendor file 의 edge case 자동 처리
- **P3 (AI 협업자)**: AI agent 가 임의 polygon overlap 시도 시 결정적 결과 보장 — *robust contract*

**Demo readiness**: 영향 적음 (현재 사용자 trigger 약하므로). Architectural completeness 우선 가치.

### 1.4 ADR-027 NURBS Kernel 의 자연 확장

ADR-027 (NURBS Kernel Initiative) + ADR-064 / ADR-066 (3D NURBS Boolean DCEL) 의 *2D coplanar variant*:
- 3D SSI: surface-surface intersection (analytic curves output)
- 2D coplanar: curve-curve intersection (analytic points output) → 분할 boundary

본 ADR 은 NURBS Kernel 의 *2D coplanar branch* 확장 — ADR-027 의 architectural anchor 자연 답습.

---

## 2. Current state audit (`crates/axia-geo/src/operations/coplanar.rs`)

### 2.1 ADR-101 B-1 Sutherland-Hodgman 한계

```rust
pub fn coplanar_intersection_segments(
    poly_a: &[DVec3],  // ← polygonized!
    poly_b: &[DVec3],  // ← polygonized!
    plane_normal: DVec3,
) -> (Vec<DVec3>, ...) // lens + crossings
```

- **Input**: polygons (chord_tol-driven N-vertex approximation)
- **Algorithm**: Sutherland-Hodgman convex clip + crossing count
- **Limitation 1**: subject polygon convex 만 정확 (concave 미지원)
- **Limitation 2**: vertex-on-edge / vertex-on-corner degeneracy (결함 D root cause)
- **Limitation 3**: chord_tol 의 정밀도 한계 (analytic curve 정확도 lost in polygonize step)

### 2.2 Path B (ADR-089) 의 위치

Path B closed-curve face 는 1 self-loop edge with `AnalyticCurve::Circle` (또는 Bezier/BSpline/NURBS) — **2D NURBS-direct 의 input source 활성**. 본 ADR 의 actual user-facing carrier.

### 2.3 ADR-101 §B-3 의 surface attach 정합 (이미 활성)

`auto_intersect_coplanar` 가 split 결과 face 에 parent surface clone 부여 (ADR-101 L-B3b-3). 본 ADR 의 algorithm upgrade 시에도 동일 정책 유지.

---

## 3. Algorithm Path Options Matrix

### 3.1 Path option 4 매트릭스

| Path | Description | scope | 시간 | risk | 효과 |
|---|---|---|---|---|---|
| **A — Vatti** | scanline + AET, 모든 polygon (self-intersect 포함) | Rust ~600 LoC + 회귀 30+ | 2-3주 multi-week | 중간 (mature algorithm, Clipper2 reference) | non-convex + vertex degeneracy *완전* 해소 |
| **B — Weiler-Atherton** | 그래프 traversal, non-convex 허용 | Rust ~250 LoC + 회귀 20+ | 1-1.5주 atomic | 중간 (coincident edge 별도 처리 필요) | non-convex 활성, 일부 degeneracy 잔존 |
| **C — Bentley-Ottmann + post-process** | sweep line edge intersection 기반 polygon partition | Rust ~400 LoC + 회귀 25+ | 1.5-2주 | 중간~높음 | robust degeneracy + non-convex |
| **D — NURBS-direct curve intersection** | polygonize 없이 AnalyticCurve 직접 SSI (curve-curve, 2D variant of ADR-064/066) | Rust ~400 LoC + 회귀 25+ | 2-3주 multi-week | 높음 (NURBS Kernel 확장) | **정확도 무한** (analytic), polygonize-free |
| **E — Hybrid (D for Circle/Arc, A for general polygon)** | Path B Circle/Arc 는 analytic, polygon 은 Vatti | Rust ~800 LoC + 회귀 40+ | 3-4주 | 높음 | 모든 case 최적 path |
| **F — epsilon-perturbation (band-aid)** | polygonize 시 vertex 미세 이동으로 cardinal alignment 회피 | Rust ~50 LoC + 회귀 5+ | 1-2일 | 낮음 | 결함 D 만 해소, fundamental 한계 보존 |
| **G — Vertex-on-edge fallback** | Sutherland-Hodgman 의 crossings count 가 0 일 때 vertex-on-edge incidence 분리 처리 | Rust ~100 LoC + 회귀 10+ | 3-5일 | 낮음 | 결함 D 만 해소, MVP 답습 |

### 3.2 추천 매트릭스 (사용자 가치 × scope × risk)

| 추천 순위 | Path | 근거 |
|---|---|---|
| **1st** | **G (vertex-on-edge fallback)** | 가장 단순/신속/정확. 3-5일 atomic. 결함 D 사용자 trigger 약화 (ADR-107) 정합. ADR-046 P31 #1 "가볍게" 정합. |
| **2nd** | **D (NURBS-direct)** | LOCKED #43 priority #4 의 literal interpretation — "NURBS-aware". ADR-027 NURBS Kernel 자연 확장. Path B family (ADR-104) 의 자연 다음 step. |
| **3rd** | **A (Vatti)** | mature, general — STEP/IGES vendor file 처리 시 robustness 보장 |
| **4th** | **E (Hybrid D+A)** | production-ready 전체 — multi-week, 가장 큰 architectural value but high cost |

### 3.3 path 간 trade-off

- **G vs D**: G 는 결함 D 만 fix (사용자 trigger 약함 — gain 적음). D 는 polygonize 자체 우회 (Path B family 자연 확장, *architectural completeness*).
- **D vs A**: D 는 analytic (Path B Circle/Arc 한정 가속), A 는 general polygon. Hybrid (E) 가 두 path 통합.
- **F (epsilon-perturbation)**: 거부 — 정밀도 무손실 정합 (LOCKED #5 spatial-hash 1.5μm 의도) 위반 risk.

---

## 4. 결재 트리거 (사용자 명시 선택 필요)

### 4.1 Q1 — Path 선택

- **(a) G (vertex-on-edge fallback)** — 단순/신속/정확, 3-5일 atomic
- **(b) D (NURBS-direct curve intersection)** — LOCKED #43 priority #4 literal, 2-3주 multi-week
- **(c) A (Vatti general)** — mature, 2-3주
- **(d) E (Hybrid D+A)** — production-ready, 3-4주
- **(e) defer — 현재 trigger 약함, 별도 priority 진행**

### 4.2 Q2 (Path D 선택 시) — Curve type 우선순위

- Circle ∩ Circle (closed-form quadratic)
- Circle ∩ Line/Polygon (closed-form)
- Arc ∩ Arc, Arc ∩ Polygon (parametric clip)
- Bezier/BSpline/NURBS ∩ * (numerical, Newton iteration — ADR-034 Phase F SSI 답습)

### 4.3 Q3 — User-facing UX 변화

- 현재 trigger: 사용자 actual scenarios 약함 (ADR-107 Path B 자동 분기로 결함 D 회피)
- 본 ADR closure 후: STEP/IGES vendor file 의 edge case 자동 처리 가능
- 사용자 facing UI 변화 0 (API surface unchanged, additive only)

### 4.4 Q4 — Atomic 분할

- single PR (G 또는 D 단독)
- α spec → β implementation seq (ADR-118 답습)
- multi-week incremental (D-Circle-only → D-Arc → D-NURBS sub-steps)

### 4.5 권장 default

- **Q1 default**: **(a) G (vertex-on-edge fallback)** — 가장 단순/신속/정확. 결함 D 가 *real-world* trigger 약하나 *architectural completeness* 위해 minimum fix.
- **Q2 N/A** (G 선택 시)
- **Q3 default**: API surface unchanged, additive only
- **Q4 default**: single atomic PR (G scope 작음)

**대안 default**: **(b) D (NURBS-direct)** — LOCKED #43 priority #4 의 literal interpretation. Path B family closure (ADR-104) 의 자연 다음 step. ADR-027 NURBS Kernel 확장. *Architectural value 우선* 사용자 선호 시.

---

## 5. Lock-ins (canonical for whichever path chosen)

- **L-120-1** ADR-101 §5 Out-of-scope 두 항목 (Non-convex + NURBS-aware) 의 통합 architectural ADR
- **L-120-2** ADR-101 B-3 `auto_intersect_coplanar` 의 input/output contract 유지 — algorithm internal 만 변경 (Sutherland-Hodgman → 선택된 path)
- **L-120-3** ADR-101 L-B3b-3 surface attach 정합 유지 (split 결과 face 가 parent surface clone)
- **L-120-4** LOCKED #1 ADR-021 P7 정합 유지 (closed edge cycle → face 합성)
- **L-120-5** ADR-046 P31 #4 additive only — API surface (사용자 facing draw / boolean / extrude) UNCHANGED
- **L-120-6** 사용자 시연 게이트 (ADR-087 K-ζ canonical) — implementation 후 measure
- **L-120-7** 절대 #[ignore] 금지
- **L-120-8** LOCKED #5 정합 (1.5μm spatial-hash dedup tolerance)
- **L-120-9** Path D 선택 시 ADR-027 NURBS Kernel 자연 확장 (curve-curve 2D intersection — ADR-064 SSI 의 2D variant)

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **3-way 동시 overlap** (A ∩ B ∩ C 분할) — ADR-101 §5 Out-of-scope 다른 항목, 본 ADR 미포함
- **Multi-material overlap UX** — ADR-101 §5 lens identity refinement
- **Sheet face 2D variant** — ADR-066 sheet sheet Boolean cross-cut
- **Self-intersecting profile auto-fix** — STEP/IGES vendor file edge case

---

## 7. 사용자 facing 매트릭스 예측 (Path 별)

| Test case | Before (ADR-101 MVP) | After G | After D | After A |
|---|---|---|---|---|
| RECT × RECT partial | ✅ 3 sub-faces | ✅ | ✅ | ✅ |
| Circle × Circle partial (Path B) | ✅ 3 sub-faces | ✅ | ✅ (analytic 정확) | ✅ |
| RECT × Circle vertex-on-corner (결함 D) | ❌ 1 sub-face | ✅ 3 sub-faces | ✅ (analytic 정확) | ✅ |
| Non-convex L-shape × Circle | ❌ partial | ❌ | ✅ (curve clip) | ✅ |
| Self-intersecting profile | ❌ | ❌ | ❌ (out of scope) | ✅ (Vatti) |
| Bundle increase | base | 0 | 0 (Rust only) | 0 |

---

## 8. Cross-link

- ADR-101 §5 (Out-of-scope two items) — 본 ADR 의 직접 trigger
- ADR-101 Amendment 9 §A9.8 (결함 D 자연 해소 via ADR-107) — trigger 약화 evidence
- ADR-027 (NURBS Kernel Initiative) — Path D 의 architectural anchor
- ADR-034 Phase F (Surface-Surface Intersection) — Path D 의 2D variant 자연 답습
- ADR-064 / ADR-066 (3D NURBS Boolean DCEL) — Path D 의 2D variant 패턴
- ADR-089 (Path B closed-curve face) — 본 ADR 의 actual input carrier
- ADR-104 family (Cylinder/Sphere/Cone/Torus Path B) — 본 ADR 의 자연 다음 architectural step
- ADR-046 P31 #1 "가볍게" — Q1 (a) G 선택 시 근거
- ADR-087 K-ζ — 사용자 시연 게이트 canonical
- LOCKED #43 priority #4 (NURBS-aware coplanar intersect)
- LOCKED #44 (Complete Meaning per Merge — α spec → β implementation atomic)

---

## 9. 결재 요청 (사용자 명시 선택)

본 spec only PR (α) 은 implementation 0. 사용자 결재 후 채택된 Path 만 별도 atomic sub-step PR 진행.

**Q1 Path 선택** + **Q2-Q4 default 채택 여부** 명시 부탁드립니다.

권장 default 요약:
- Q1: (a) G (vertex-on-edge fallback) — 단순/신속/정확
- 대안: (b) D (NURBS-direct) — architectural value 우선
- Q3-Q4: default 채택 (API unchanged, single atomic PR)

---

## Amendment 1 — Q1=G Decision Lock-in (2026-05-17, ADR-128 β implementation)

**상태**: ADR-120 spec 본문 (§§1~9) 보존. 본 amendment 만 추가.
**Trigger**: ADR-127 closure 후 LOCKED #43 priority #4 자연 transition.
**사용자 결재**: 2026-05-17, "추천 승인합니다" (Q1=G — Vertex-on-edge fallback).

### A1.1 Q1 path 선택 (canonical lock-in)

**Q1 = G (Vertex-on-edge fallback)** — ADR-120 §3.2 의 1st recommendation 채택.

근거 (사용자 결재 시점 정합):
- **ADR-046 P31 #1 "가볍게"**: minimum fix 우선 — *architectural completeness* 가 user-facing trigger 보다 우선이지만, marginal effort 만 가치
- **ADR-101 Amendment 9 §A9.8 evidence**: 결함 D 가 ADR-107 Path B canonical 로 *real-world trigger 약함* (시연 사례 자연 해소) — Path D (NURBS-direct, 2-3주) 의 multi-week scope 가 ROI 미달
- **세션 패턴 일관**: ADR-124 (2-3일 SIMD), ADR-126 (4-6일 STEP), ADR-127 (30분 audit) — atomic single PR + low risk 일관

### A1.2 Q2-Q4 default 채택

- **Q2 N/A** (G 선택 시, Path D curve type 우선순위 무관)
- **Q3 API surface unchanged** (additive only — ADR-046 P31 #4 정합)
- **Q4 single atomic PR** (G scope ~100-150 LOC + 7 회귀)

### A1.3 ADR-128 β implementation 명시

ADR-128 β implementation 채택:
- `point_on_segment_2d` helper + `detect_vertex_incidence_crossings` function 추가
- `coplanar_intersection_segments` 의 raw_crossings 후 conservative fallback (only fires when empty + lens non-empty)
- 7 new ADR-128 regression tests (axia-geo 1392 → 1399)
- 0 regression on existing 60+ coplanar tests

### A1.4 G option 외 path status (preserved, NOT superseded)

본 amendment 는 다른 path 들 (D / A / B / C / E / F) 을 *supersede 하지 않음*. 보존 사유:
- **D (NURBS-direct)** — LOCKED #43 priority #4 literal interpretation, 향후 architectural value 우선 시 trigger 가능 (ADR-027 NURBS Kernel 확장 anchor)
- **A (Vatti)** — STEP/IGES vendor file edge case robustness, 향후 trigger 시 별도 ADR
- **E (Hybrid D+A)** — production-ready 전체, multi-week scope, 향후 trigger 시 별도 ADR
- 부정 결정 lock-in (ADR-125 §A1.3 + ADR-126 §A2.4 + ADR-127 §A3.3 답습 — 4번째 적용)

### A1.5 회귀 / 산출물

- 본 amendment: docs only, 회귀 0
- ADR-128: axia-geo +7 (1392 → 1399), 0 regression elsewhere
- ADR-077 V-2 visual baseline UNCHANGED
- Initial bundle UNCHANGED (Rust-only change, no WASM bridge)

### A1.6 결함 D detection matrix

| Scenario | Pre-ADR-128 | Post-ADR-128 |
|---|---|---|
| Classic partial overlap (2 real crossings) | 3 sub-faces ✓ | 3 sub-faces ✓ (unchanged) |
| Containment / Disjoint | Ok(None) ✓ | Ok(None) ✓ (unchanged) |
| **결함 D: cardinal vertex on edge interior** | **Ok(None) silent skip** | **3 sub-faces (synthesized crossings)** |
| **결함 D: vertex coincident with corner** | **Ok(None) silent skip** | **3 sub-faces OR Ok(None)** (residual L-128-8) |

### A1.7 Cross-link (Amendment 1)

- **ADR-128** — 본 amendment 의 implementation
- **ADR-101 Amendment 9 §A9.8** — 결함 D documented limitation (본 amendment 가 해소)
- **ADR-107** Path B canonical (real-world trigger 약화 evidence)
- **ADR-046 P31 #1** "가볍게" (Q1=G 선택 근거)
- **ADR-046 P31 #4** additive only
- **ADR-027** NURBS Kernel — Path D future architectural anchor (preserved)
- **LOCKED #43 priority #4** — 본 amendment 의 anchor
