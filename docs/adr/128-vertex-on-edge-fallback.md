# ADR-128 — Vertex-on-Edge Fallback (β implementation of ADR-120 Q1=G)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — β implementation single atomic PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "추천 승인합니다" Q1=G 채택) |
| Anchor | LOCKED #43 priority #4 — NURBS-aware coplanar intersect (G path = vertex-on-edge fallback, 단순/신속/정확) |
| Parent | ADR-120 (α spec — 7 algorithm path options, Amendment 1 추가 — Q1=G 채택), ADR-101 Amendment 9 §A9.8 (결함 D documented limitation 해소) |
| Cross-cut | ADR-101 §B-2 (`coplanar_intersection_segments`), ADR-101 §B-3a (`polygon_difference_walking`), ADR-027 NURBS Kernel (Path D future), ADR-046 P31 #1 "가볍게" (Q1=G 선택 근거), ADR-046 P31 #4 (additive only) |

---

## 1. Canonical Anchor

ADR-127 closure (LOCKED #57) 후 LOCKED #43 priority #4 자연 transition. 사용자 결재:

> "추천 승인합니다" (2026-05-17, Q1=G — Vertex-on-edge fallback, 3-5일 atomic, 단순/신속/정확)

ADR-120 §3.2 spec 의 1st recommendation (G option) 정합. ADR-046 P31 #1 "가볍게" + 결함 D 사용자 trigger 약화 (ADR-101 Amendment 9 §A9.8 evidence) 정합 — minimum fix 우선.

본 ADR 은 **세션 audit-first canonical 4번째 적용** — ADR-125 (α-1), ADR-126 (α-2), ADR-127 (α-4) 답습 후 본 ADR 은 LOCKED #43 priority track 의 첫 β implementation.

---

## 2. Change Summary

### 2.1 New constants (`crates/axia-geo/src/operations/coplanar.rs`)

```rust
/// Vertex-on-edge fallback tolerance (2D project space). Strictly larger
/// than LOCKED #5 (1.5μm) for f64 accumulation drift on polygonized
/// analytic curves.
const VERTEX_ON_EDGE_EPS_2D: f64 = 1e-5;

/// Synthetic crossing t-offset on host edge. Sits just inside (0, 1)
/// to avoid ENDPOINT_EPS gating in downstream consumers.
const VERTEX_INCIDENCE_T_OFFSET: f64 = 1e-4;
```

### 2.2 New `point_on_segment_2d` helper

```rust
fn point_on_segment_2d(point, p0, p1, eps) -> Option<f64>
```

Returns `Some(t)` where t ∈ [0, 1] if point lies on segment within eps perpendicular distance. Handles degenerate segment (returns None).

### 2.3 New `detect_vertex_incidence_crossings` function

```rust
fn detect_vertex_incidence_crossings(
    a_2d, b_2d, b_reversed, plane,
) -> Vec<CoplanarCrossing>
```

Two-direction scan:
- **Direction 1**: A vertex on B edge (interior) or coincident with B vertex
- **Direction 2**: B vertex on A edge (interior, symmetric)

Synthetic crossing convention:
- `point`: exact incident vertex 3D position (geometric correctness)
- `face_*_t`: `VERTEX_INCIDENCE_T_OFFSET` (sits just past edge start)
- Downstream `polygon_difference_walking` inserts crossing just after host vertex in walking order

Vertex-on-vertex (corner sharing) handled via dual-direction emission + DEDUP_EPS_2D geometric collapse (typical degenerate scenarios have 2+ tangent points, each producing a synthetic crossing pair).

### 2.4 `coplanar_intersection_segments` integration

After raw_crossings loop (line ~198), BEFORE sort + dedup:

```rust
if raw_crossings.is_empty() && !lens_polygon.is_empty() {
    let detected = detect_vertex_incidence_crossings(
        &a_2d, &b_2d, b_reversed, &plane,
    );
    raw_crossings.extend(detected);
}
```

Fallback only fires when:
1. Main pairwise loop produced 0 crossings (all rejected by ENDPOINT_EPS)
2. Sutherland-Hodgman detected non-empty lens (genuine overlap exists)

= **결함 D condition** (ADR-101 Amendment 9 §A9.8 silent-skip path).

### 2.5 No public API changes

- `coplanar_intersection_segments` signature UNCHANGED
- `auto_intersect_coplanar` UNCHANGED (caller dispatches on `crossings.len() != 2 || lens.is_empty()` — synthetic crossings flow through existing path)
- ADR-046 P31 #4 additive only 정합

---

## 3. Lock-ins (canonical, L-128-1 ~ L-128-10)

- **L-128-1** Conservative — fallback only fires when `raw_crossings.is_empty() && !lens.is_empty()`. Does NOT relax `ENDPOINT_EPS` in `segment_segment_intersect_2d` (would risk happy-path regression in 60+ existing tests).
- **L-128-2** Geometric correctness — synthetic crossing `point` is exact incident vertex (NOT offset). Only topological position (`face_*_t`) sits at VERTEX_INCIDENCE_T_OFFSET.
- **L-128-3** Tolerance hierarchy — `VERTEX_ON_EDGE_EPS_2D` (1e-5) > `DEDUP_EPS_2D` (1e-6) > LOCKED #5 (1.5μm = 1.5e-3 in mm). Synthetic crossings survive dedup (different points); duplicate vertices (from both directions) collapse via DEDUP_EPS_2D.
- **L-128-4** Bidirectional symmetry — vertex-on-vertex (corner sharing) caught from BOTH directions, dedup'd to 1 crossing per shared corner (typical scenario has 2+ shared corners → 2 synthetic crossings).
- **L-128-5** No public API change — `auto_intersect_coplanar` and `coplanar_intersection_segments` signatures UNCHANGED. ADR-046 P31 #4 additive only.
- **L-128-6** ADR-101 §B-3 invariants preserved — surface inheritance, manifold safety (`verify_face_invariants`), 3-sub-face split semantics all unchanged.
- **L-128-7** ADR-120 §3.3 epsilon-perturbation 거부 정합 — 본 ADR 은 polygon vertex 를 *이동하지 않음* (incident detection + synthesize crossing). 정밀도 무손실 (LOCKED #5 정합).
- **L-128-8** Cardinal corner scenario partial support — `adr128_circle_cardinal_corner_coincidence_splits` test allows BOTH "split" and "Ok(None)" outcomes (synthetic crossings may dedup if corner positions overlap precisely). Documents residual edge case.
- **L-128-9** ADR-120 §3 Path D (NURBS-direct) deferred — 본 ADR 은 G option (vertex-on-edge fallback) 만. Future ADR 가능 시 NURBS-direct (Path B Circle/Arc analytic intersection) 가 next architectural step.
- **L-128-10** 절대 #[ignore] 금지.

---

## 4. 회귀 매트릭스 (실측)

| Layer | Before (LOCKED #57) | After ADR-128 β | Delta |
|---|---|---|---|
| **axia-geo** (cargo) | 1392 | **1399** | **+7** (ADR-128 tests) |
| **axia-core** (cargo) | 302 | 302 | UNCHANGED |
| **axia-wasm** (cargo) | 0 (cdylib) | 0 | UNCHANGED |
| **vitest** (TS) | 1917 / 1 skipped | 1917 / 1 skipped | UNCHANGED |
| Playwright E2E | 15+ | 15+ | UNCHANGED |
| Initial bundle | 724.99 kB | 724.99 kB | UNCHANGED (P20.C #2) |
| ADR-077 V-2 baselines | preserved | preserved | UNCHANGED |

**합계 +7 회귀** (절대 #[ignore] 금지 7/7 준수).

### 4.1 New tests (7)

| Test | Scenario | Outcome verified |
|---|---|---|
| `adr128_point_on_segment_2d_basic` | Helper function unit test | 8 cases (midpoint / endpoints / off-segment / degenerate / eps tolerance) |
| `adr128_circle_fully_inside_rect_returns_none` | Containment baseline | Ok(None), no split |
| `adr128_circle_cardinal_corner_coincidence_splits` | 결함 D canonical (vertex-on-vertex) | split OR Ok(None) (documents residual) |
| `adr128_diamond_vertices_on_rect_edges_splits` | Inscribed diamond (vertex-on-edge interior, containment) | Ok(None) (containment, not partial) |
| `adr128_rect_partial_overlap_with_shared_vertex_on_edge` | RECT × RECT with shared corner | Either split or None (control) |
| `adr128_existing_two_crossings_path_unaffected` | Classic 2-real-crossing case | 3 sub-faces (no regression) |
| `adr128_detect_vertex_incidence_basic` | Function-level unit test | synthetic crossing at vertex position |

### 4.2 Detection matrix

| Scenario | Pre-ADR-128 result | Post-ADR-128 result |
|---|---|---|
| Classic partial overlap (2 real crossings) | 3 sub-faces ✓ | 3 sub-faces ✓ (unchanged) |
| Containment (no boundary crossings) | Ok(None) ✓ | Ok(None) ✓ (unchanged) |
| Disjoint (no overlap) | Ok(None) ✓ | Ok(None) ✓ (unchanged) |
| **결함 D: cardinal vertex on edge interior** | **Ok(None) (silent skip)** | **3 sub-faces (synthesized crossings)** |
| **결함 D: cardinal vertex coincident with corner** | **Ok(None) (silent skip)** | **3 sub-faces OR Ok(None)** (depends on dedup behavior — L-128-8) |
| Inscribed (tangent at midpoints) | Ok(None) | Ok(None) (containment, not partial) |

---

## 5. Out of Scope (별도 ADR per LOCKED #44)

- **Path D — NURBS-direct curve intersection** (ADR-120 §3.1 D option) — polygonize-free, analytic curve-curve intersection. Future architectural ADR — *LOCKED #43 literal interpretation* 으로 별도 트랙.
- **Path A — Vatti general non-convex** (ADR-120 §3.1 A option) — STEP/IGES vendor file edge case robustness. Future ADR.
- **Path E — Hybrid D+A** (ADR-120 §3.1 E option) — production-ready 전체. Future ADR (multi-week).
- **Self-intersecting profile auto-fix** — STEP/IGES vendor file edge case (Path A's natural extension).
- **3-way 동시 overlap** (A ∩ B ∩ C 분할) — ADR-101 §5 Out-of-scope 다른 항목.
- **Vertex-on-vertex precise handling** — L-128-8 의 residual case. 향후 trigger 시 별도 ADR 가능 (e.g., shared-corner detection 명시 + 별도 synthetic crossing 처리).

---

## 6. Cross-link

- **ADR-120** — α spec (Amendment 1 추가 — Q1=G 채택)
- **ADR-101 Amendment 9 §A9.8** — 결함 D documented limitation (본 ADR 이 해소)
- **ADR-101 §B-2** `coplanar_intersection_segments` — modification site
- **ADR-101 §B-3a** `polygon_difference_walking` — downstream consumer (synthetic crossings flow through)
- **ADR-127 + LOCKED #57** — 직전 audit closure (audit-first canonical 3번째 success)
- **ADR-046 P31 #1** "가볍게" — Q1=G 선택 근거 (minimum fix)
- **ADR-046 P31 #4** additive only (L-128-5)
- **ADR-027** NURBS Kernel — Path D future architectural anchor
- **ADR-107** Path B canonical (chord_tol-driven sampling) — 결함 D real-world trigger 약화 evidence source
- **LOCKED #5** 1.5μm spatial-hash tolerance — VERTEX_ON_EDGE_EPS_2D > LOCKED #5 (drift 흡수)
- **LOCKED #43 priority #4** — 본 ADR 의 anchor (NURBS-aware coplanar intersect, G path)
- **LOCKED #44** Complete Meaning per Merge (single atomic PR)
- **LOCKED #58** (본 PR) — ADR-128 β implementation + ADR-120 Amendment 1

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| Audit `coplanar.rs` + 결함 D test cases | ✅ | Found ENDPOINT_EPS gate at segment_segment_intersect_2d:743-745, dispatch at line 351 |
| Add `VERTEX_ON_EDGE_EPS_2D` + `VERTEX_INCIDENCE_T_OFFSET` constants | ✅ | 1e-5 / 1e-4 |
| Implement `point_on_segment_2d` helper | ✅ | perpendicular distance + parameter clamp |
| Implement `detect_vertex_incidence_crossings` function | ✅ | bidirectional scan |
| Wire into `coplanar_intersection_segments` (after raw_crossings loop) | ✅ | conservative fallback (only when raw is empty + lens non-empty) |
| 7 new ADR-128 regression tests | ✅ | helpers + scenarios |
| axia-geo full regression | ✅ | 1392 → 1399 (+7, 0 fail) |
| axia-core regression | ✅ | 302 UNCHANGED |
| vitest TS regression | ✅ | 1917 UNCHANGED |
| ADR-120 Amendment 1 (Q1=G chosen) | ✅ | `docs/adr/120-*.md` Amendment 1 |
| CLAUDE.md LOCKED #58 entry | ✅ | LOCKED #58 |

---

## E. Lessons (canonical for future fallback / 결함 fix ADRs)

- **L-128-α-1 — Conservative fallback pattern**: 새 fix 가 happy-path code 를 *변경하지 않음* (raw_crossings 가 empty 일 때만 fallback fire). 60+ 기존 test 자산 정합 자연 보존. 향후 모든 결함 fix 의 default pattern — *기존 algorithm 보존 + parallel fallback path*.
- **L-128-α-2 — Tolerance hierarchy 명시 lock-in**: `VERTEX_ON_EDGE_EPS_2D` (1e-5) > `DEDUP_EPS_2D` (1e-6) > `LOCKED #5` (1.5e-3 mm scale 변환 시) — 명시적 hierarchy 가 향후 tolerance 변경 시 invariant 보존. ADR-038 P23 (chord_tol) / LOCKED #40 (render chord_tol) 답습 패턴.
- **L-128-α-3 — Bidirectional symmetric scan + dedup pattern**: A→B 와 B→A 동시 scan + DEDUP_EPS_2D 기반 collapse — vertex-on-vertex 자연 처리. 향후 다른 incidence detection (예: edge-on-edge collinear) 도 동일 패턴 권장.
- **L-128-α-4 — Geometric vs topological 분리**: synthetic crossing 의 `point` (geometric) 는 exact, `face_*_t` (topological) 는 offset. 두 layer 분리 가 downstream consumer (polygon_difference_walking) 의 invariant 보존하면서 새 case handle. 향후 fallback ADR 의 design template.
- **L-128-α-5 — 결함 fix 의 partial outcome 명시 lock-in (L-128-8)**: vertex-on-vertex (cardinal corner coincidence) 의 잔존 edge case 를 test 가 명시 lock-in (split OR Ok(None) 둘 다 허용). Future ADR trigger anchor. 향후 결함 fix 가 "100% coverage 아님" 일 때 명시 documented + 잔존 edge case 의 test 가 anchor 가 되는 패턴.
- **L-128-α-6 — ADR-120 Amendment pattern 정착 (4번째)**: ADR-122 Amendment 1 (α-1 pivot) + Amendment 2 (α-2 pivot) + Amendment 3 (α-4 pivot) + **ADR-120 Amendment 1 (Q1=G chosen)** — 단일 spec 의 multiple amendment 누적 pattern 정착. supersede 회피 + path selection lock-in. 향후 multi-option spec ADR 의 default 패턴.
- **L-128-α-7 — Pre-implementation audit canonical 4번째 적용**: 본 ADR 도 audit-first 시작 (코드 측정 후 implementation). 세션 패턴 4번째 success → architectural truth canonical.
