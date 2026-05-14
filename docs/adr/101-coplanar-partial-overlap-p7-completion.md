# ADR-101 — Coplanar Partial Overlap Auto-Intersect (ADR-021 P7 Completion)

| Field | Value |
|---|---|
| Status | **In Progress** — Phase A landed (PR #25) / B-1 decision landed (PR #26) / B-2 primitive landed (PR #27) / B-3 lens semantics + B-3a utility landed (본 amendment) |
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

---

## Amendment 1 — Phase A 완료 (2026-05-14, PR #25 `de868ba`)

- **Phase A-α** spec 결재 — 본 ADR §4 Phase A table
- **Phase A-β/γ** `Mesh::polygonize_closed_curve_face(face_id, material) -> Result<Option<FaceId>>` 추출
  - Source: `extrude_closed_curve_face_via_tessellation` step 4-6 + ADR-089 A-υ-β cleanup pattern
  - Engine chord_tol `(radius * 0.01).max(1e-6)` (LOCKED #40 L1)
  - Surface inheritance (Plane attach 보존)
  - Anchor + self-loop edge cleanup (isolated anchor deactivate)
- **회귀 +7** (절대 #[ignore] 금지 7/7): happy path / polygonal no-op / non-Circle self-loop no-op / surface inheritance / anchor deactivation / verify_face_invariants() / inactive face error
- **Full axia-geo: 1263/1263 PASS** (1256 baseline + 7 new)
- **Phase A-δ** PR #25 merged to main, CI green (`rust-test` + `web-e2e` + `Build` + `Deploy` + `MCP`)
- **Additive only** — caller 미연결, Phase B-2 의 첫 caller 가 활용 예정

## Amendment 2 — Phase B-1 알고리즘 결정 (2026-05-14, 본 commit)

### B-1.1 알고리즘 후보 trade-off

| Algorithm | Convex 제약 | LoC (예상) | Degenerate 처리 | Multi-hole | License/구현 |
|---|---|---|---|---|---|
| **Sutherland-Hodgman** | Subject + clip 모두 **convex** | ~80 | 단순 (vertex classification) | ❌ | Public domain, 단일 함수 |
| **Weiler-Atherton** | Subject 비-convex 허용 | ~250 | Coincident edge 별도 처리 필요 | ✅ (hole as inner loop) | Public domain, 그래프 traversal |
| **Vatti** | 일반 (self-intersect 포함) | ~600 | 강건 (scanline + AET) | ✅ | LGPL Clipper2 의 알고리즘 base, 자체 구현 시 PD |

### B-1.2 결정: **Sutherland-Hodgman MVP** (option (a))

**Lock-ins**:

- **L-B1-1 Convex-only MVP**: ADR-101 §5 의 "Non-convex polygon clipping out of scope" 명시 정합. 현재 user-facing trigger 시나리오 (RECT × RECT, Circle × Circle, RECT × Circle mixed) 가 모두 convex (Circle 의 polygonized N-gon 은 convex N-gon).
- **L-B1-2 Subject + clip 모두 convex 강제**: 비-convex face (multi-hole / dent 등) 시 Phase B 가 skip + warning. ADR-016 Q2 의 multi-loop face 제약 (Push/Pull / Boolean / Offset / hole boundary fillet 거부) 와 정합 — 같은 face 분류는 같은 정책.
- **L-B1-3 Plane coplanarity tolerance**: 두 face 의 normal dot product ≥ 0.9999 + plane offset ≤ 1.5μm (LOCKED #5 spatial-hash dedup tolerance) 일 때만 coplanar 판정. ε 누설 차단.
- **L-B1-4 결과 3 sub-face**: A only / B only / A ∩ B (lens). Lens 영역 sub-face 는 양 face 의 sub-face 로 동시 등록 (LOCKED #3 답습 — 원본 XIA inheritance).
- **L-B1-5 Phase A 첫 caller**: Phase B-3 에서 `polygonize_closed_curve_face` 를 양 operand 에 호출 → 두 polygonal face 로 변환 후 clipping. Circle / Bezier closed curve 모두 동일 경로.
- **L-B1-6 Future ADR (별도 트랙)**: Weiler-Atherton 또는 Vatti 로 algorithm upgrade 가 필요해지는 trigger (non-convex face / multi-hole / 3-way overlap) 는 별도 ADR. 본 ADR Phase B 의 sweep 매트릭스 안에서 발견되면 ADR-101 amendment 가 아닌 *별도 ADR 신설*.
- **L-B1-7 회귀 가드 (Phase B-5)**: 비-convex 입력 시 `Err(MeshOpError::CoplanarClippingRequiresConvex)` 명시 반환 — silent skip 차단. 회귀 자산 1건으로 강제.

### B-1.3 후보 기각 사유

- **Weiler-Atherton 기각**: non-convex 지원이 현재 트리거 시나리오에 불필요. ~3× LoC + degenerate (coincident edge / vertex-on-edge) 별도 처리 → MVP scope 부적합. Phase B 의 risk 격리 원칙 (additive + multi-gate 결재 — ADR-094 §E L1 답습) 위반.
- **Vatti 기각**: scanline + AET 일반성은 mesh-era 의 mature 솔루션 (Clipper2 등) 의 가치이지만, axia-geo 의 face partition 정책 (LOCKED #1 P7 / LOCKED #12 P11) 위에서는 over-engineering. ADR-046 P31 #1 ("가볍게") 정합. 미래 STEP/IGES import 의 self-intersecting profile 처리 시 재검토 가능.

### B-1.4 Phase B 후속 sub-step (B-2 ~ B-6)

- **B-2**: `coplanar_intersection_segments(face_a, face_b) -> Result<Vec<Segment>>` 신규 (boundary intersection points + segment chains, Sutherland-Hodgman 의 vertex classification + intersection 단계만 추출). caller-side polygonization 가정 (B-3 가 wire-up).
- **B-3**: `split_faces_by_intersections` 가 coplanar segment 도 처리하도록 확장. `polygonize_closed_curve_face` 첫 호출 site.
- **B-4**: Lens 영역 sub-face 생성 + 양 face 의 sub-face 로 등록 (LOCKED #3 XIA inheritance 답습).
- **B-5**: 회귀 자산 매트릭스 (RECT×RECT 7 case + Circle×Circle 5 case + RECT×Circle mixed 3 case + non-convex reject 1 case + 3-way overlap deferred guard 1 case).
- **B-6**: 사용자 시연 + closure (실제 두 원 그리기 → 자동 3 sub-face).

### B-1.5 회귀 영향 예측 (재확인)

- 기존 회귀 자산 **변경 0** (B-2 ~ B-4 additive)
- 새 회귀 자산 **+17** (B-5 매트릭스)
- 사용자 facing: 두 원 / 두 사각형 / mixed partial overlap → 자동 3 sub-face

### B-1.6 코드 변경 0

본 amendment 는 **algorithm 결정 + lock-in 만**. 구현 코드 변경 0. Phase B-2 ~ B-6 별도 PR, 각 sub-step 사용자 결재.

## Amendment 1+2 Cross-link

- ADR-094 §E L1 (additive-first + multi-gate atomic) — Phase B 의 sweep 매트릭스 정책 anchor
- ADR-046 P31 #1 ("가볍게" — over-engineering 회피) — Vatti 기각 근거
- ADR-016 Q2 (multi-loop face 도구 정책) — convex-only 정합
- ADR-091 §E L1 (Mesh-level Map canonical) — Phase B-3 의 sub-face 등록 시 답습

---

## Amendment 3 — Phase B-2 완료 + B-3 lens semantics 결정 + B-3 sub-step split (2026-05-14)

### B-2 completion log

- **B-2** `coplanar_intersection_segments(mesh, face_a, face_b)` pure
  function landed (PR #27 `4df7142`)
- 7 lock-ins L-B2-1 ~ L-B2-7 (convex enforcement / coplanarity ε / anti-
  parallel normals / endpoint filter / deterministic sort / polygonal-input
  assumption / explicit errors)
- 회귀 +9 (1263 → 1272), 절대 #[ignore] 금지 9/9 준수
- Architectural win: 기존 `polygon_geom::sutherland_hodgman` + `PlaneBasis`
  재사용 — Phase B-1 결정 (Sutherland-Hodgman MVP) 가치 실증

### B-3 lens region 표현 결정 (canonical lock-in)

본 amendment 의 핵심 — ADR-101 §B-1 L-B1-4 의 *원안* ("lens 영역 sub-face
양 face 모두에 등록") **수정**.

#### 후보 3 옵션 trade-off (사전 검토 2026-05-14)

| Option | 설명 | Manifold | XIA inheritance |
|---|---|---|---|
| (a) Manifold-coincident sub-faces | 양 face 의 sub-face 로 동시 등록 (원안) | **위반** (한 edge 4 HE) | 자연 (양쪽) |
| **(b) Single promoted lens face** | face_a 의 sub-face 로 promote, face_b 는 분할만 | **보장** | 비대칭 (deterministic min-ID) |
| (c) XOR fragmentation (neutral form Shape) | lens = LOCKED #26 form-layer Shape, 사용자 명시 promote | 보장 | 사용자 결재 |

#### 채택: **Option (b)** — Single promoted lens face

**근거**:

1. **Manifold-safe** — LOCKED #1/#7/#16/#26 + ADR-007 / ADR-021 P7 /
   ADR-051 `verify_p7_manifold` 모두 자연 정합
2. **ADR-022 P9 promote 패턴 답습** — vertex-shared pinch 의 small-face
   promote 패턴이 이미 정착
3. **메타-원칙 #5** ("명확하면 자동, 모호하면 명시 동의") — 현재 trigger
   시나리오 (같은 평면, 동일/유사 재질) 는 *명확*. 사용자 결재 불필요
4. **그리기 순서 무관성** (LOCKED #1 P7 신규 원칙) — XIA inheritance =
   `min(face_a_id, face_b_id).xia` deterministic
5. **YAGNI** — Option (c) 의 multi-material 모호성 trigger 는 현재 부재.
   미래 별도 ADR (Lens Identity Refinement) 으로 격리.

**Option (a) 기각**: manifold 위반 → 후속 ops (Boolean / Offset / Push-
Pull) 모두 모호 + `verify_p7_manifold` P7-M1 violation.

**Option (c) 보류**: ADR-102 (가칭, future) 의 trigger 3건 (T1 multi-
material 모호성 / T2 3-way overlap / T3 명시적 Manual Split 도구) 중
하나 활성 시 진행.

#### Lock-ins L-B1-4-revised (Option (b) 답습)

- **L-B1-4 (revised)**: Lens 영역은 **face_a 의 sub-face 로만 promote**
  (face_b 는 lens 영역을 제외한 부분만 유지). face_a / face_b 의 결정
  순서는 `min(face_a_id, face_b_id)` deterministic.
- **L-B1-4a**: XIA inheritance — `min(face_a_id, face_b_id).xia` 가 lens
  의 XIA. ADR-101 §B-1 L-B1-1 의 LOCKED #3 ("sub-face = 원본 XIA
  inherit") 답습, 모호성은 deterministic min 으로 해소.
- **L-B1-4b**: Surface metadata — parent face_a 의 surface (Plane 등)
  를 lens + face_a_only + face_b_only 모두 inherit (LOCKED #9 A-χ 답습).

### B-3 sub-step split (Path Z atomic)

다음 sub-step 으로 분할 — risk 격리 + 사용자 결재 단위 명시:

| Sub-step | Scope | LoC 추정 | 회귀 | Caller |
|---|---|---|---|---|
| **B-3a** (이 amendment) | `polygon_difference_walking` pure 2D utility — Greiner-Hormann style boundary walking, A \ lens 또는 B \ lens 단일 closed polygon 반환 | ~150 | ~6 | 없음 (B-3b wire-up) |
| **B-3b** (별도 PR) | `Mesh::auto_intersect_coplanar` — polygonize + B-2 + B-3a + remove_face + add_face × 3 + surface/XIA inherit | ~80 | ~6 | 없음 (B-4 wire-up) |
| **B-4** (별도 PR) | Caller wiring — `intersect_faces_with_model` 또는 `auto_intersect_on_draw` coplanar branch | ~50 | ~3 | 사용자 |
| **B-5** (별도 PR) | 회귀 sweep — RECT×RECT 7 + Circle×Circle 5 + RECT×Circle mixed 3 + non-convex reject 1 + invariants | ~0 | +16 | 자동 |
| **B-6** (별도 PR) | 사용자 시연 + closure docs | ~0 | 0 | 사용자 |

#### B-3a Lock-ins (이 amendment)

- **L-B3a-1** Pure 2D function — no DCEL, no FaceId. Input 2D polygon
  arrays only.
- **L-B3a-2** Convex × convex 2-crossing partial overlap 만 지원. 다른
  case (no overlap / containment / multi-crossing) → `Err` (silent skip
  차단).
- **L-B3a-3** Result polygon **may be non-convex** (crescent / L-shape).
  DCEL 은 non-convex face 허용 (ADR-021 P7 의 closed boundary = face
  원칙).
- **L-B3a-4** CCW orientation 유지 (caller 의 후속 add_face 가 정합).
- **L-B3a-5** Algorithm: walk base polygon with crossings inserted,
  collect "outside lens" arc + reverse-walk lens "inside base" arc.
- **L-B3a-6** Deterministic + idempotent (같은 input → 같은 output).

### B-3a 회귀 매트릭스 (~6 tests)

- `b3a_partial_overlap_two_rects_returns_l_shape` — happy path
- `b3a_two_circles_returns_crescent` — non-convex result
- `b3a_no_crossings_errors` — disjoint / containment
- `b3a_three_or_more_crossings_errors` — non-convex 입력 (현재 미지원)
- `b3a_ccw_orientation_preserved` — winding 정합
- `b3a_idempotent_same_input_same_output` — deterministic guard

### B-3a Cross-link

- ADR-091 §E L4 (pure utility extraction) — B-3a 가 B-3b 의 pure
  primitive prerequisite
- ADR-094 §E L1 (additive-first) — DCEL mutation 없는 utility 가
  B-3b/B-4 의 risk 격리
- LOCKED #26 Phase 1 (Form/Property layer) — Option (c) 보류 anchor
- ADR-022 P9 (small-face promote pattern) — Option (b) 의 inspiration
