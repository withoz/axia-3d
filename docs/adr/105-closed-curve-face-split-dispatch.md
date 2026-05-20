# ADR-105: Closed-Curve Face Split via Tessellation Dispatch

- **Status**: Accepted (R-α single-step closure, 2026-05-20)
- **Date**: 2026-05-20
- **Anchor**: Bug review report 2026-05-19 시나리오 1 (CRITICAL).
  ADR-089 Phase 2 (closed-curve face 시민권) 적용 범위가 *face split
  영역* 에서 미완 — 5 함수 polygon (≥3 verts) 가정 → 사용자 "원 그리고
  자르기" silent functional failure.
- **Parent**: ADR-089 (closed-curve face 시민권), 메타-원칙 #14 (면은
  닫힌 경계로부터 유도된다)
- **Sibling**: ADR-089 A-θ Path A (extrude_closed_curve_face_via_
  tessellation — 본 fix 의 mirror pattern)
- **Successor (planned)**: Bezier/BSpline/NURBS closed-curve dispatch
  (R-β follow-up, ADR-105 scope 외)

---

## A. Problem Statement

Bug review 시나리오 1 — 사용자가 disk (closed-curve Circle face) 위에
chord line 을 그리면 5 함수 모두 silent fail:

| Bug | 함수 | 위치 | 증상 |
|-----|------|------|------|
| 1A | `split_face_by_line` | face_split.rs:332-364 | 1-vert outer → diag=0 → snap_tol=0 → `bail!(v1!=v2)` |
| 1B | `find_line_crossings` | mesh.rs:1570-1574 | self-loop edge: d2=0 → "parallel" → 0 crossings |
| 1C | `is_vertex_interior_to_any_face` | scene.rs:2335 | `if boundary.len() < 3 { continue; }` skips |
| 1D | `split_edge` (latent) | mesh.rs:3775-3900 | va==vb==anchor → radial chain broken |
| 1E | `point_in_face` | face_split.rs:60-101 | n=1 ray casting → inside=false |

**사용자 facing**: Toast "면 분할 실패: 시작점과 끝점이 같은 정점입니다
— 일반 선으로 그립니다" → free chord 만 그려지고 disk 그대로.

**정책 위반**:
- 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다") — closed-curve 경계가
  *split source* 로 작동 안 함
- LOCKED #1 ADR-021 P7 ("닫힌 라인은 면을 나눈다") — closed-curve 의
  추가 chord 도 면을 나눠야 함

---

## B. Lock-ins

### R-A — Tessellation dispatch (단일 진입점)
5 함수 각각을 closed-curve-aware 로 patch 하지 않는다. 대신 *splittt_
face_by_line 진입부* 에서 closed-curve face 를 polygonal substitute 로
*pre-tessellation* 후 polygon-aware flow 로 dispatch. ADR-089 A-θ Path
A (`extrude_closed_curve_face_via_tessellation`) pattern 의 재사용.

**Rationale**:
- 5 함수를 모두 closed-curve aware 로 만들면 *각 함수마다 edge-case
  분기 + 회귀 자산* 추가 필요 (cumulative 20+ tests, 큰 surface
  area)
- Tessellation substitution 은 *단일 helper* (`tessellate_closed_
  curve_face_in_place`) + *1-line dispatcher* — small surface, low
  risk
- ADR-089 A-θ Path A 가 같은 패턴 (Push-Pull) 으로 이미 검증 — 본
  fix 는 pattern 1:1 mirror

### R-B — Polygonal substitute 가 surface + Arc curve 모두 보존
ADR-089 A-θ Path A step 5/6 답습:
- step 5: parent `AnalyticSurface::Plane` inheritance
- step 6: 각 N 개 segment edge 에 `AnalyticCurve::Arc {center, radius,
  normal, basis_u, start_angle, end_angle}` attach
- ADR-106 R-α: parent `surface_owner_id` inheritance (split sites
  propagation 패턴 답습)

**결과**: tessellation 직후 polygonal substitute 는 *render-time
indistinguishable from original closed-curve* (ADR-089 A-κ-β Arc
fast-path가 N segment edges 모두 multi-segment 로 emit).

### R-C — Recursion via dispatcher
Dispatcher 는 `tessellate_closed_curve_face_in_place(face_id)` → new
`substituted` FaceId 반환 → `return split_face_by_line(mesh,
substituted, ...)` recurse. Recursion 의 *두 번째 진입* 시
`is_closed_curve_face` 가 false (polygonal) 이므로 무한 루프 위험 0.

### R-D — Scope: Circle only (R-α)
ADR-089 가 closed Bezier (A-ω) / BSpline (A-Α) / NURBS (A-Β) 모두
시민권 활성했으나, 본 ADR R-α scope = **Circle 만**. Rationale:
- Bug report 가 명시한 사용자 워크플로우 (DrawCircle → chord) 가
  Circle 만
- Bezier/BSpline/NURBS 의 tessellation 은 `crate::curves::*::
  tessellate` 함수 각각 호출 + closure check 등 추가 surface
- Bezier/BSpline/NURBS closed-curve 시민권 자체가 ADR-089 Phase 2
  후속 트랙 (production 사용 매우 적음)
- R-β follow-up 으로 확장 가능 (dispatcher 분기 추가만 — engine 깊이 0)

`is_closed_curve_face` 가 *Circle 한정* 으로 구현 — Bezier/BSpline/
NURBS closed-curve face 는 false 반환 → polygon-aware path 그대로
fail (기존 동작 보존, regression 0).

### R-E — Engine 외부 변경 0
WASM bridge / TS / Playwright 모두 변경 없음. 본 fix 는 *engine
internal pre-dispatch*. 사용자 facing 효과 (Toast "면 분할 실패" 사라짐
+ chord split 성공) 는 자동.

### R-F — Other 4 bugs 의 effective resolution
1A (split_face_by_line bail) — dispatcher 가 우회 → **해소**
1B (find_line_crossings parallel) — polygonal substitute 후엔 N 개
   regular edges → 정상 동작 → **해소**
1E (point_in_face n=1) — polygonal substitute 가 N=8+ 정점 → 정상
   ray casting → **해소**
1C (is_vertex_interior_to_any_face boundary < 3 skip) — 본 ADR scope
   외 (free-edge resolver 별도 path). Polygon-aware 통과 후 영향 없음
   → **간접 해소** (closed-curve face 는 dispatch 후 polygonal,
   `is_vertex_interior` 도 정상 진입)
1D (split_edge self-loop latent) — dispatcher 가 폴리곤화 후 진입
   → self-loop edge 미존재 → **간접 해소** (latent 그대로 dormant)

5 bugs 중 4 effective resolution, 1 (1C) 은 *별도 free-edge resolver
영역* — 본 ADR scope 외이나 dispatcher 가 closed-curve face 를
유지하지 않으므로 자연 우회.

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| `is_closed_curve_face` API | Circle 시민권 true, polygonal/Bezier/BSpline/NURBS false |
| `tessellate_closed_curve_face_in_place` API | 1-vert closed-curve → N≥8 polygon with Arc edges + Plane surface inheritance + owner_id propagation |
| Dispatcher | `split_face_by_line` 진입부에서 closed-curve detect → tessellate → recurse |
| Recursion 안전 | 2nd 진입 시 polygonal → dispatcher skip → 무한 loop 없음 |
| 회귀 (절대 #[ignore] 금지) | 5 sites: detect / detect_negative / substitute / dispatch / polygonal regression guard |
| 기존 회귀 자산 | axia-geo 1262 → **1267 PASS** (+5), 0 failed, 0 ignored |
| 사용자 facing | "원 그리고 자르기" 워크플로우 동작 (Toast 사라짐 + 2 sub-faces 생성) |

---

## D. Acceptance Log

### R-α (PR-119, 2026-05-20) — Engine fix + 5 regression + ADR (Circle only)

- **commit**: `5642592`
- **변경 (3 파일)**:
  - `crates/axia-geo/src/mesh.rs` — `is_closed_curve_face` +
    `tessellate_closed_curve_face_in_place` API 신규
  - `crates/axia-geo/src/operations/face_split.rs` — dispatcher
    branch at `split_face_by_line` 진입부
  - `docs/adr/105-closed-curve-face-split-dispatch.md` — 본 ADR
- **신규 회귀 자산** (5 in `create_solid.rs::tests`):
  - `adr105_is_closed_curve_face_detects_circle_face`
  - `adr105_is_closed_curve_face_rejects_polygon`
  - `adr105_tessellate_closed_curve_in_place_produces_polygon_with_arc_edges`
  - `adr105_split_face_by_line_dispatches_closed_curve_to_polygon_path`
  - `adr105_polygonal_circle_split_unaffected_by_dispatch` (regression guard)
- **회귀**: axia-geo lib **1267 PASS** (이전 1262, +5), 0 failed, 0 ignored
- **사용자 facing**: DrawCircle (closed-curve mode default ON, ADR-089
  A-π) → DrawLine chord → 면 분할 성공 + Plane surface 보존 + Arc 곡선
  metadata 유지 (render fast-path).

### R-β (본 commit, 2026-05-20) — Bezier / BSpline / NURBS dispatch

- **commit**: 본 commit
- **R-β scope**: R-α 의 자연 확장. closed Bezier / BSpline / NURBS
  face 모두 같은 dispatcher path 진입. R-α 가 미커버한 4 곡선 type 중
  3 (Circle 이미 R-α) 활성. ADR-089 시민권 4 type 모두 split 영역에서
  활성.
- **변경 (2 파일)**:
  - `crates/axia-geo/src/mesh.rs`:
    - `is_closed_curve_face` — Bezier/BSpline/NURBS variant 도 true
    - `tessellate_closed_curve_face_in_place` — curve type 분기 + 각
      tessellate API 호출. **Circle 만 Arc curve attach** (render
      fast-path 활성), **Bezier/BSpline/NURBS 는 sub-edges 가 curve 미부착**
      (R-β scope — analytic-metadata 손실 accepted, polygon facet 으로
      render. 사용자 정신적 trade-off: split 의도 = 의도된 metadata 손실).
- **신규 회귀 자산** (5 in `create_solid.rs::tests`):
  - `adr105_r_beta_is_closed_curve_face_detects_bezier`
  - `adr105_r_beta_is_closed_curve_face_detects_bspline`
  - `adr105_r_beta_is_closed_curve_face_detects_nurbs`
  - `adr105_r_beta_tessellate_closed_bezier_substitutes_to_polygon` —
    sub-edges no curve metadata 확인 (R-β accepted)
  - `adr105_r_beta_split_closed_bezier_face_via_dispatch` — 사용자
    workflow (closed Bezier + chord) end-to-end
- **회귀**: axia-geo lib **1272 PASS** (이전 1267, +5), 0 failed, 0 ignored
- **사용자 facing**: closed Bezier / BSpline / NURBS face (ADR-089 A-ω
  / A-Α / A-Β 시민권) + chord → 면 분할 성공. Sub-faces 는 polygon
  facet 으로 render (R-β accepted trade-off — split 의도).
- **R-α + R-β 합산 효과**: ADR-089 시민권 4 closed-curve type 모두
  split 영역 활성. 메타-원칙 #14 + LOCKED #1 P7 의 *완전* 활성.

---

## E. Lessons

1. **Pattern reuse cost > new-feature cost** — 5 함수 closed-curve
   aware 패치 (cumulative 20+ tests + 큰 surface area) vs 1 helper +
   1-line dispatcher (5 tests + small surface). ADR-089 A-θ Path A 가
   이미 검증한 *tessellation substitution* 패턴의 자연 재사용.
2. **Closed-curve 시민권의 *분산 cost*** — ADR-089 Phase 2 가 시민권
   인프라 (add_face / Boolean / Push-Pull / Offset / Render) 활성했으나
   *face split* + *free-edge resolver* 영역은 별도 트랙 필요. 시민권
   확장 ADR 의 acceptance log 에 *"전체 시민권 사용 surface map"* step
   추가 검토 (메타-인프라).
3. **Recursive dispatcher 의 안전성** — `tessellate_*_in_place` 후
   2nd 진입은 polygonal → dispatcher skip → terminate 보장. 재귀
   pattern 의 *terminating condition* 이 dispatcher 의 detect 와 정합.

---

## F. Cross-link

- ADR-089 Phase 2 (closed-curve 시민권), A-θ Path A (mirror pattern source)
- ADR-106 R-α (split-site surface_owner_id propagation — 본 ADR 의
  tessellation 결과도 동일 inheritance 활용)
- 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다 — 본 ADR 의 *닫힌
  경계 + chord = 새 닫힌 경계 2개* 의미 활성)
- LOCKED #1 ADR-021 P7 (닫힌 라인은 면을 나눈다 — 본 ADR 이 closed-
  curve 경계의 *추가 chord* 도 P7 의미 활성)
- Bug review report 2026-05-19 시나리오 1 (CRITICAL — 본 ADR 의 source)
