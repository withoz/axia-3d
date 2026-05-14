# ADR-101 — Coplanar Partial Overlap Auto-Intersect (ADR-021 P7 Completion)

| Field | Value |
|---|---|
| Status | **Proposed** (draft — sub-step roadmap pending sign-off) |
| Date | 2026-05-14 |
| Supersedes | — |
| Related | ADR-021 (P7 "Closed Edge Cycle Divides Face"), ADR-051 (P7 strict reaffirmation), ADR-089 (closed-curve face Path B), ADR-094 (Path B production default), LOCKED #40 (render chord_tol) |

## 1. Anchor 통찰 (canonical)

> "닫힌 엣지에는 면이 생성되어야 한다. 두 닫힌 엣지가 겹치면 세 면으로 나뉘어야 한다."

ADR-021 P7 의 자연 확장 — 사용자가 두 원 (또는 두 사각형) 을 같은 평면에서 그려 *부분 겹침* (partial overlap) 시키면 위상이 **자동으로 3 sub-face** (A only / B only / A ∩ B 의 lens 영역) 로 정리되어야 한다. 현재 엔진은 이 케이스에서 분할 안 함 — ADR-021 P7 의 *coplanar partial overlap* sub-case 가 미구현 상태.

## 2. 발견 (2026-05-14 사용자 시연)

사용자가 두 원 (반지름 5, center distance 4 — lens region 존재) 을 그렸을 때 분할 안 됨. XIA Inspector 로 lens 영역 클릭 시 둘 중 하나의 XIA 만 잡힘. 사용자 결재 후 진단 → **architectural gap**.

## 3. 현재 구현 한계

### 3.1 `intersect_faces_with_model` (`boolean.rs:212`)

`prepare_solid` → `find_intersections` → `split_faces_by_intersections` 파이프라인.

| 단계 | 처리 |
|---|---|
| `prepare_solid` | Face 의 boundary loop verts → fan triangulation. **Path B closed-curve face (1 anchor + 1 self-loop edge)** 는 `loop_verts.len() == 1` 로 short-circuit (`positions.len() < 3` → skip) |
| `find_intersections` | Triangle-triangle 교차 only. **Coplanar triangle pair = 교차 없음** (3D 알고리즘 한계) |
| `detect_coplanar_faces` (`boolean.rs:745`) | Placeholder heuristic — fake segment 만 반환, *실제 overlap region* 의 lens boundary 미계산 |
| `split_faces_by_intersections` | DCEL face 의 loop verts 기반. 1-vert closed-curve 는 split 불가 |

### 3.2 결과 매트릭스

| 케이스 | 동작 |
|---|---|
| Non-coplanar 교차 (3D box × box) | ✅ Triangle-triangle (Boolean) |
| Containment (A ⊂ B) | ✅ Hole injection (`auto_intersect_on_draw` containment branch) |
| Boundary touching (T-junction, RECT × RECT 인접) | ✅ Edge split (`split_face_by_chain`) |
| **Coplanar partial overlap (rect ∩ rect, circle ∩ circle, mixed)** | 🔴 **미구현** |

→ Closed-curve circles 와 polygon rectangles 모두 동일 gap.

## 4. 제안 작업 (multi-step atomic)

### Phase A — 사전 인프라

| Step | 작업 |
|---|---|
| A-1 | `Mesh::polygonize_closed_curve_face` helper 추출 — `extrude_closed_curve_face_via_tessellation` 의 step 4-6 패턴 답습. Path B closed-curve → polygonal face 변환 |
| A-2 | `prepare_solid` 가 self-loop 자동 polygonize (mutation 책임 명확) |

### Phase B — Coplanar Polygon Clipping 본체

| Step | 작업 |
|---|---|
| B-1 | Coplanar polygon clipping algorithm 결정 (Sutherland-Hodgman vs Weiler-Atherton vs Vatti) — convex 가정 깰지 결정 |
| B-2 | `coplanar_intersection_segments(face_a, face_b)` 신규 — 두 face 의 *실제 boundary intersection points* 계산 (centroid heuristic 아님) |
| B-3 | `split_faces_by_intersections` 가 coplanar segment 도 처리하도록 확장 |
| B-4 | Lens 영역 sub-face 생성 (양 face 모두의 sub-face 로 등록) |

### Phase C — 회귀 자산

| Step | 작업 |
|---|---|
| C-1 | RECT × RECT partial overlap → 3 sub-face 회귀 |
| C-2 | Circle × Circle partial overlap → 3 sub-face 회귀 |
| C-3 | RECT × Circle mixed → 3 sub-face 회귀 |
| C-4 | 3-way overlap (A ∩ B ∩ C — 가능 케이스) — *out of scope, future* |

### Phase D — Visual baseline

| Step | 작업 |
|---|---|
| D-1 | Visual baseline 추가 — `coplanar-overlap-circles-3-faces.png` (LOCKED #40 visual coverage 확장) |
| D-2 | Hover scenario — lens 영역 hover 시 그 sub-face 만 highlight |

## 5. 제외 (out of scope)

- **Non-convex** polygon clipping (Phase B-1 결정에 따라 다름)
- **3-way 동시 overlap** (A ∩ B ∩ C 분할) — Phase C-4 future
- **Curve-curve precise intersection** (Circle-Circle 의 lens 를 polygonal 이 아닌 정확한 arc boundary 로 유지) — 별도 NURBS SSI cross-cut ADR
- **NURBS / Bezier closed curve** partial overlap — Circle 만 일단

## 6. 회귀 영향 예측

- 기존 회귀 자산 **변경 0** — Phase B 까지 모두 *additive* (containment / T-junction / Boolean 기존 로직 unchanged)
- 새 회귀 자산 **+15 ~ +20** (Phase C 시나리오 매트릭스)
- 사용자 facing 변화: 사용자가 두 원 또는 두 사각형 partial overlap 으로 그리면 **자동으로 3 면 생성** → ADR-021 P7 의 *완전한* 의미 활성

## 7. 사용자 결재 트리거

본 ADR 의 작업은 **multi-day** scope. 사용자가 명시 결재 + LOCKED 정책 (`docs/adr/README.md` 메타-원칙 #10) 답습 필요. Phase 별 atomic sub-step + 각 phase 후 사용자 시연 결재.

## 8. Cross-link

- ADR-021 P7 (LOCKED #1) — anchor
- ADR-051 — P7 strict reaffirmation + verify_p7_manifold
- ADR-089 — closed-curve face Path B (lens 영역의 polygonal substitution 의존)
- ADR-094 — Path B production default (현재 회귀 trigger condition)
- LOCKED #40 — render chord_tol (Phase D visual baseline 인프라)
