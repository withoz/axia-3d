# ADR-101 — Coplanar Partial Overlap Auto-Intersect (ADR-021 P7 Completion)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-15) — ✅ Closed; Superseded by ADR-139 (2026-05-18, Q3=a 결재) — auto Draw trigger 폐기** — Phase A/B-1/B-2/B-3a/B-3b/B-3c/B-4 MVP/B-6/B-4b all merged (9 PRs). §2 canonical user trigger fully active across all 3 Draw entry points (RECT / Legacy Circle / Path B Circle). B-5 sweep matrix deferred — current coverage (Rust unit 8 + Playwright E2E 7) suffices. See Amendment 8 for closure summary. ADR-139 후속 정책 — *결과 invariant* (메타-원칙 #14 두 닫힌 경계 overlap → 3 sub-face) 보존, *Draw 자동 trigger* (B-4 Scene wiring, `auto_intersect_on_draw` default true) 만 supersede. Amendment 9 (메타-원칙 #15 HARD flag) 정책 자체는 **불변 보존**. Engine 본체 (`auto_intersect_coplanar` public API) 는 보존 — Boundary tool 호출 시 자산 재활용. LOCKED #41 / LOCKED #64 cross-reference. |
| Date | 2026-05-14 |
| Supersedes | — |
| Superseded by | ADR-139 (Boundary Tool + Auto-cycle Deprecation, 2026-05-18, Q3=a — *Draw 자동 trigger* 만) |
| Related | ADR-021 (P7 "Closed Edge Cycle Divides Face"), ADR-051 (P7 strict reaffirmation), ADR-089 (closed-curve face Path B), ADR-094 (Path B production default), ADR-139 (Boundary Tool supersede trigger), LOCKED #40 (render chord_tol) |

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

---

## Amendment 4 — Phase B-3b MVP (RECT × RECT) + B-3c deferral (2026-05-14)

### B-3a completion log

- **B-3a** `polygon_difference_walking` pure 2D utility landed (PR #28
  `d91528b`)
- 7 회귀 (1272 → 1279), algorithm core 검증 완료
- Splice 방향 fix lesson: `i_from` backwards (B-interior side), 아닌
  `i_to` backwards (A-corner side)

### B-3b implementation (this amendment)

- `Mesh::auto_intersect_coplanar(face_a, face_b, material) -> Result<Option<AutoIntersectResult>>`
- `AutoIntersectResult { face_a_only, face_b_only, lens }` 신규 struct
- Algorithm:
  1. Polygonize Path B closed-curve Circle (Phase A helper)
  2. Call `coplanar_intersection_segments` (B-2)
  3. No partial overlap → `Ok(None)`
  4. Compute A\lens + B\lens via `polygon_difference_walking` (B-3a)
  5. Reverse face_b's 2D if anti-parallel normal (CW → CCW)
  6. Snapshot parent surface metadata
  7. `remove_face × 2` + `add_face × 3` rebuild
  8. Surface inheritance (parent → all 3 sub-faces)
- 6 lock-ins L-B3b-1 ~ L-B3b-6
- 6 회귀 (1279 → 1286):
  - `two_rects_partial_overlap_creates_3_faces` (happy path)
  - `disjoint_no_op` + `containment_no_op` (Ok(None), no mutation)
  - `surface_inheritance` (Plane → all 3 sub-faces)
  - `verify_face_invariants_post_split` (manifold guard)
  - `inactive_input_errors` + `second_call_rejects_non_convex_results`

### B-3c deferral — Path B Circle × Circle (canonical user trigger)

**Finding (debugging)**: Path B closed-curve circles polygonize correctly,
but the rebuild pattern (`remove_face` × 2 → `add_face` × 3) leaves orphan
edges in the mesh that get reused via spatial-hash dedup (`add_vertex`
LOCKED #5 tolerance). The reused edges' free HEs are then claimed by
multiple new faces, producing **non-manifold edges shared by 3 active
faces** (verify_face_invariants violation).

**RECT × RECT canonical case works** because A's and B's polygonized
verts don't significantly coincide (only at lens corners, ε-distance).

**Root cause hypothesis**: After `remove_face`, the original face's
boundary edges remain in the mesh with `face=NULL` HEs (free). When
`add_face` for 3 new faces reuses these edges via `make_loop` →
`find_halfedge`, in some configurations 3 of the new faces all want to
go in the *same direction* on a shared edge, triggering pass 2
(non-manifold HE pair creation).

**B-3c scope (next PR)**:
- Add explicit orphan-edge cleanup after `remove_face` (deactivate edges
  with all HEs face=NULL).
- OR add `add_face_fresh` variant that bypasses spatial-hash dedup and
  creates fresh vertices.
- Re-enable Path B Circle × Circle test (`path_b_circles_polygonize_and_split`)
- ~6 회귀 추가 (B-3c).

This deferral preserves the user-facing trigger for ADR-101 §2 ("두 원
partial overlap"). B-3c is required before B-4 (caller wiring) can deliver
the user-visible value.

### B-3b ↔ B-3c sub-step split rationale

ADR-094 §E L1 (additive-first risk isolation + multi-gate atomic) — by
landing B-3b as RECT-only MVP, we:
- Verify the algorithm core (B-2 + B-3a + DCEL surgery) is sound
- Prove surface inheritance + manifold invariants work
- Isolate the orphan-edge cleanup as a separable concern (B-3c)
- Each PR remains atomic + reviewable

### Updated B sub-step roadmap

| Sub-step | Status | Scope |
|---|---|---|
| B-1 | ✅ PR #26 | Algorithm decision (Sutherland-Hodgman MVP) |
| B-2 | ✅ PR #27 | `coplanar_intersection_segments` primitive |
| B-3a | ✅ PR #28 | `polygon_difference_walking` pure 2D utility |
| B-3b | ✅ PR #29 | `Mesh::auto_intersect_coplanar` RECT MVP |
| **B-3c** | ✅ **본 amendment** | Orphan cleanup + Path B Circle × Circle activated |
| B-4 | 🔄 next PR | Caller wiring (auto_intersect_on_draw) |
| B-5 | 🔄 | 회귀 sweep matrix (+16 tests) |
| B-6 | 🔄 | 사용자 시연 + closure |

---

## Amendment 5 — Phase B-3c: Orphan-edge cleanup + Path B Circle × Circle (2026-05-14)

### B-3c implementation summary

**Two-layer fix**:

1. **`Mesh::cleanup_orphan_boundary_edges(boundary_verts_lists: &[&[VertId]])`** — new public helper. After `remove_face × N`, walks each pair of consecutive verts in supplied boundary lists, finds the edge, and if **all** HEs on that edge have `face = NULL`, removes the edge via `remove_edge_and_halfedges` (proper v_ring splicing + outgoing repoint). Isolated verts post-removal are deactivated.

2. **`polygon_difference_walking` start_idx fix** — new exclusion: a base vertex coincident with any lens vertex (within `match_eps`) is NOT a valid start point. Previously the algorithm picked any base vert that returned false for strict point-in-lens (which includes lens-boundary verts), causing degenerate output for circle case where many polygonized arc verts lie ON lens boundary.

### Root cause analysis (canonical lesson)

Initial assumption (in B-3b deferral): orphan edges left by `remove_face` interact with spatial-hash dedup → 3 active faces share edges. Cleanup helper would fix this.

**Reality**: cleanup helper is correct + needed, BUT it was a **secondary issue**. The primary failure was in `polygon_difference_walking` (B-3a's start_idx logic):

For Path B Circle × Circle, the polygonized A circle has many verts on the *lens-side arc* (these ARE lens vertices via sutherland_hodgman). The original start algorithm:

```rust
.find(|&i| !is_xing && !is_inside_lens(pt))
```

`is_inside_lens` uses winding-number with **boundary excluded**. So lens-vertex base points return false → qualify as start. The algorithm starts the walk *on the lens boundary*, mis-traces the lens-side arc, produces a near-zero-area degenerate polygon.

RECT × RECT was unaffected because its lens-coincident base verts (e.g., (10,10) for A=[0..10]², lens=[5..10]²) appear *between* the 2 crossings — the state-tracking flag `inside_lens=true` correctly skips them.

**Fix**: explicit `on_lens_vertex` exclusion in start_idx — only pick base verts that are *strictly outside* lens (not on its boundary).

This bug was *hidden by* the orphan-edge symptom in B-3b's investigation, because the wrong winding caused non-manifold edges (3-face sharing). The error message ("face FaceId(4): cached normal opposite to winding") was the smoking gun that pointed to winding, not orphans.

### Lock-ins (canonical for B-3c)

- **L-B3c-1** Cleanup scope: only edges between consecutive verts in supplied boundary lists. Other orphan edges elsewhere in the mesh are NOT touched.
- **L-B3c-2** All-free predicate: edge removed only if EVERY HE in radial chain has `face = NULL`.
- **L-B3c-3** Idempotent: second call with same args finds nothing.
- **L-B3c-4** Vertex cleanup: post-edge-removal, isolated verts deactivated.
- **L-B3c-5** Existing `remove_face` semantics UNCHANGED — additive helper.
- **L-B3c-6** (B-3a fix) start_idx exclusion: base verts coincident with lens verts cannot be start points. Algorithm rejects "containment-like" case explicitly.

### Algorithm correctness (post-fix)

For two-circle test (r=5 each, centers (0,0) and (6,0)):

| Polygon | Vert count | Signed area (2D) |
|---|---:|---:|
| A (polygonized) | 22 | ~78.5 (π·5²) |
| B (polygonized) | 22 | ~78.5 |
| lens (Sutherland-Hodgman) | 15 | 21.79 |
| **A \ lens** (after fix) | **24** | **55.78** (78.5 − 21.79 ≈ 56.7 ✓) |
| **B \ lens** | **26** | **55.78** |

Total area `A + B − lens = 78.5 + 78.5 − 21.79 = 135.21` matches `A\lens + B\lens + lens = 55.78 + 55.78 + 21.79 = 133.35` (within polygonization chord error). Manifold invariants PASS.

### 회귀 누적

- axia-geo lib: 1286 → **1290 PASS** (+4, 절대 #[ignore] 금지 4/4 준수)
  - `path_b_circles_polygonize_and_split` (Path B integration)
  - `cleanup_orphan_boundary_edges_unit` (helper direct)
  - `cleanup_is_idempotent` (L-B3c-3 guard)
  - `cleanup_preserves_shared_edges` (L-B3c-2 scope guard)

### Lessons (canonical patterns)

- **L1 Initial bug analysis can mislead** — the orphan-edge fix was necessary but not sufficient. Always verify the symptom maps to the root cause by checking *all* the failure signals (face winding error came BEFORE the edge errors in the report).
- **L2 Algorithm gaps surface in non-canonical input** — RECT test passed because it had a structurally simpler relationship between base verts and lens verts. Circle test exposed the "base vert on lens boundary" case naturally.
- **L3 Pure utility extraction enables targeted fixes** (ADR-091 §E L4) — B-3a's `polygon_difference_walking` being a pure function meant the start_idx fix was local + immediately testable in isolation.
- **L4 Debug output guides root cause** — single `eprintln!` of polygon signed areas revealed `a_only = -0.000000` instantly, pointing to a degenerate-polygon source.

---

## Amendment 6 — Phase B-4 MVP: Auto-intersect on Draw (Scene wiring, 2026-05-14)

### B-4 implementation summary

**Scene-layer auto-trigger** — `Scene::intersect_faces_inner` extended with coplanar partial-overlap branch. The existing 3D triangle-triangle pipeline (ADR-101 §3 limitation: coplanar pairs produce no 3D intersection) is now followed by a coplanar scan that calls `auto_intersect_coplanar` on each matching pair.

### Wiring

`Scene::exec_draw_*` already called `intersect_faces_inner(&face_ids)` when `auto_intersect_on_draw=true` (default). No new exec entry points; the change is purely additive inside `intersect_faces_inner`.

```
exec_draw_rect / circle / line (or AsShape variants)
  → check auto_intersect_on_draw flag
  → if true: intersect_faces_inner(&face_ids)
              ├─ XIA backup snapshot
              ├─ Existing 3D pipeline (intersect_faces_with_model)
              ├─ Existing XIA inheritance for 3D split results
              └─ NEW: coplanar scan (B-4)
                   for fid in face_ids:
                     for other_fid in active_others (NOT in face_ids):
                       if either is Path B closed-curve → skip (deferred to B-4b)
                       try auto_intersect_coplanar(fid, other_fid)
                       Ok(Some(split)) → XIA inheritance + break
                       Ok(None) → no overlap, continue
                       Err(_) → silent skip (non-coplanar/non-convex)
```

### Lock-ins (canonical for B-4)

- **L-B4-1** Entry point = `intersect_faces_inner` only (called by Draw via existing flag). Push/Pull / Boolean / Erase unaffected unless they call this method.
- **L-B4-2** N×M scan over `face_ids × others`. Fine for typical 2D sketching (N,M ≤ 100). Optimization deferred.
- **L-B4-3** First match per `face_id` (no cascading). After first coplanar split, move to next `face_id`.
- **L-B4-4** Silent skip on `Err` from `auto_intersect_coplanar` — non-coplanar / non-convex inputs are NOT errors here, just no-op.
- **L-B4-5** XIA inheritance per ADR-101 L-B1-4a:
  - `face_a_only` inherits `face_a.xia`
  - `face_b_only` inherits `face_b.xia`
  - `lens` inherits `min(face_a_id, face_b_id).xia` (deterministic — order-independent under undo/redo)
- **L-B4-6 (MVP scope guard)** Path B closed-curve faces (1 anchor + 1 self-loop edge with `AnalyticCurve::Circle`) are SKIPPED in B-4 MVP. Reason: `auto_intersect_coplanar` calls `polygonize_closed_curve_face` speculatively (before confirming partial overlap), which destructively converts Path B → polygonal even for disjoint pairs. Activated in B-4b with a non-destructive pre-check.

### Lesson — speculative mutation side-effect (canonical)

The pre-existing test `adr089_a_zeta_4_kernel_native_and_legacy_coexist` regressed after B-4 wiring. Trigger:

1. User draws kernel-native circle A at (20, 0, 0) radius 3 (1 self-loop edge).
2. User draws legacy polygonized circle B at origin radius 5 (24 segments).
3. B-4 scan tries `auto_intersect_coplanar(A, B)`.
4. `auto_intersect_coplanar` step 0 polygonizes BOTH A and B (Phase A helper).
5. `coplanar_intersection_segments` returns 0 crossings (disjoint at distance 20).
6. `auto_intersect_coplanar` returns `Ok(None)`.
7. **But A is now polygonal** — the self-loop edge is destroyed.

**Resolution (B-4 MVP)**: scope guard `is_path_b_closed_curve(fid)` skip — preserves kernel-native invariant.

**Resolution (B-4b future)**: lift the polygonization side-effect out of `auto_intersect_coplanar` by adding a non-destructive pre-check (AABB overlap test using AnalyticCurve metadata before any mutation).

### Canonical generalization

Algorithms that perform speculative mutation followed by a "did it apply?" check leak side-effects in the no-op case. The discipline: **check first, mutate second**. Future ADR-101 work on Path B integration must apply this principle.

### 회귀 누적

- axia-core: 285 → **290 PASS** (+5, 절대 #[ignore] 금지 5/5 준수)
  - `two_rects_partial_overlap_auto_splits` (ADR-101 §2 user trigger, RECT version)
  - `two_circles_partial_overlap_auto_splits` (Circle via Command::DrawCircle legacy polygonized — NOT Path B, so B-4 MVP scope applies)
  - `disjoint_rects_no_split` (Ok(None) → no mutation)
  - `non_coplanar_rects_no_split` (silent skip)
  - `disabled_flag_skips_split` (auto_intersect_on_draw=false guard)
- axia-geo: 1290 PASS (no changes)
- 0 regression on baseline

### User-facing state

**Working (B-4 MVP)**:
- DrawRectAsShape × DrawRectAsShape partial overlap → auto 3 sub-faces ✓
- Command::DrawCircle (legacy polygonized) × DrawCircle partial overlap → auto 3 sub-faces ✓
- Disjoint / containment / non-coplanar / non-convex → silent no-op ✓
- `auto_intersect_on_draw=false` → coplanar scan skipped ✓
- Manifold invariants preserved ✓

**Deferred (B-4b)**:
- DrawCircleAsCurve (kernel-native Path B circle) — requires non-destructive pre-check.

### Updated B sub-step roadmap

| Sub-step | Status | Scope |
|---|---|---|
| B-1 | ✅ PR #26 | Algorithm decision |
| B-2 | ✅ PR #27 | `coplanar_intersection_segments` |
| B-3a | ✅ PR #28 | `polygon_difference_walking` |
| B-3b | ✅ PR #29 | `auto_intersect_coplanar` RECT MVP |
| B-3c | ✅ PR #30 | Orphan cleanup + Path B circle (engine layer) |
| **B-4** | ✅ **본 amendment** | Scene wiring (polygonal MVP) |
| B-4b | 🔄 next | Non-destructive pre-check → Path B at Scene layer |
| B-5 | 🔄 | 회귀 sweep matrix (+16 tests) |
| B-6 | 🔄 | 사용자 시연 + closure |

---

## Amendment 7 — Phase B-4b: Non-destructive pre-check → Path B activated (2026-05-14)

### B-4b 결정 anchor (canonical lesson)

ADR-101 Amendment 6 의 lesson "speculative mutation side-effect" 를 직접 해소. **"check first, mutate second"** principle 의 architectural 적용.

### Algorithm change

```
auto_intersect_coplanar(mesh, face_a, face_b, material):

  // ── BEFORE (B-3b/B-4 MVP) ──
  1. polygonize(face_a)            ← destructive! Path B → polygonal
  2. polygonize(face_b)            ← destructive!
  3. coplanar_intersection_segments → may return Ok(None) for disjoint
  4. if no overlap → return Ok(None) ← side-effect already happened

  // ── AFTER (B-4b) ──
  1. face_world_aabb(face_a)       ← non-destructive
  2. face_world_aabb(face_b)       ← non-destructive
  3. AABB overlap check            ← cheap, no mutation
  4. coplanarity pre-check         ← normal dot + plane offset, no mutation
  5. If any pre-check fails → Ok(None), zero mutation
  6. ONLY NOW: polygonize(face_a), polygonize(face_b)
  7. coplanar_intersection_segments + full algorithm
```

### `face_world_aabb` 동작 (Path B-aware)

```rust
fn face_world_aabb(mesh: &Mesh, face_id: FaceId) -> Option<Aabb3> {
    let face = mesh.faces.get(face_id)?;
    let verts = mesh.collect_loop_verts(face.outer().start).ok()?;

    if verts.len() == 1 {
        // Path B closed-curve: 1 anchor + 1 self-loop edge with curve.
        // Extract AABB from AnalyticCurve metadata (no polygonization!).
        let edge_id = mesh.hes[face.outer().start].edge();
        let curve = mesh.edges.get(edge_id)?.curve()?;
        match curve {
            Circle { center, radius, normal, basis_u } => {
                // Cardinal samples in the curve's plane.
                let basis_v = normal.cross(*basis_u).normalize_or_zero();
                aabb_of([
                    center + basis_u * radius,
                    center - basis_u * radius,
                    center + basis_v * radius,
                    center - basis_v * radius,
                ])
            }
            // Bezier/BSpline/NURBS loops: use control points (conservative).
            Bezier { control_points } |
            BSpline { control_points, .. } |
            NURBS { control_points, .. } => aabb_of(control_points),
            _ => None,
        }
    } else {
        // Polygonal face: AABB from boundary vert positions.
        aabb_of(verts.iter().map(|v| mesh.verts[v].pos()))
    }
}
```

### `face_world_normal` 동작 (pre-check 용)

```rust
fn face_world_normal(mesh: &Mesh, face_id: FaceId) -> Option<DVec3> {
    let face = mesh.faces.get(face_id)?;
    let verts = mesh.collect_loop_verts(face.outer().start).ok()?;

    if verts.len() == 1 {
        // Path B: AnalyticCurve::Circle.normal directly.
        let edge_id = mesh.hes[face.outer().start].edge();
        match mesh.edges.get(edge_id)?.curve()? {
            Circle { normal, .. } | Arc { normal, .. } => Some(*normal),
            _ => face.surface().and_then(|s| match s {
                Plane { normal, .. } => Some(*normal),
                _ => None,
            }),
        }
    } else {
        // Polygonal: Newell's method on boundary verts.
        let positions: Vec<DVec3> = verts.iter().map(|v| mesh.verts[v].pos()).collect();
        face_unit_normal(&positions)
    }
}
```

### Lock-ins (canonical for B-4b)

- **L-B4b-1** AABB pre-check 가 polygonize 호출 *전* 위치 — "check first, mutate second" canonical.
- **L-B4b-2** Path B closed-curve: AABB / normal 모두 `AnalyticCurve` metadata 에서 직접 추출 (no polygonization, no side-effect).
- **L-B4b-3** AABB 만으로는 false-positive 가능 — coplanarity check 도 pre-check phase 에 추가.
- **L-B4b-4** Path B MVP guard (`is_path_b_closed_curve` in scene.rs) **제거** — pre-check 가 그 역할 흡수.
- **L-B4b-5** 기존 RECT × RECT / Legacy Circle 회귀 무손상 (B-3b/B-3c/B-4 회귀 자산 전부 PASS 유지).
- **L-B4b-6** Path B Circle × Path B Circle → 자동 3 sub-face 분할 활성 (ADR-101 §2 canonical user trigger 완전 만족).
- **L-B4b-7** `curve_mandatory()` API 부분 활용 — Path B 의 self-loop edge metadata 접근 (ADR-059 P-N Step 3 답습).

### Hybrid 패러다임 정합

B-4b 는 ADR-028 Phase A 의 hybrid Edge 구조 (`curve: Option<AnalyticCurve>`) 를 *진정한 first-class citizen* 으로 활용하는 첫 사용자-facing op:

| 측면 | B-4 MVP | B-4b |
|---|---|---|
| Edge curve 활용 | 무시 (polygonize 가 destroy) | AABB / normal 추출 source |
| Path B 시민권 | guard 로 skip | 1급 입력 |
| 메모리 효율 | polygonize → 32 verts 생성 | curve metadata 만으로 판정 (0 verts) |
| 사용자 시연 | RECT only | RECT + Legacy + **Path B** |

### 회귀 영향 예측

- 기존 회귀 자산 **변경 0** (additive only)
- 새 회귀 자산 **+4 ~ +6**:
  - `face_world_aabb_polygonal` (unit, polygonal face)
  - `face_world_aabb_path_b_circle` (unit, Path B Circle face)
  - `face_world_normal_path_b_circle` (unit)
  - `auto_intersect_path_b_circle_pair_splits` (integration)
  - `auto_intersect_path_b_disjoint_no_mutation` (regression guard — disjoint pair leaves Path B intact)
- Scene layer:
  - `adr101_b4_two_path_b_circles_auto_split` (E2E flip from B-4 MVP "2 faces" to "3 faces")

### Cross-link

- ADR-028 Phase A (hybrid Edge with `curve: Option<AnalyticCurve>`) — B-4b 가 진정한 활용
- ADR-059 Phase N Step 3 (`curve_mandatory()` API) — 미래 NURBS-aware ops 의 prerequisite
- ADR-089 Phase 2 (self-loop edge 시민권) — Path B canonical form
- ADR-101 Amendment 6 (canonical lesson "speculative mutation side-effect") — 본 amendment 가 해소
- LOCKED #14 메타-원칙 #14 — "면은 닫힌 경계로부터 유도된다" 의 첫 사용자-facing op 활용

---

## Amendment 8 — Full Closure (2026-05-15) ✅

ADR-101 의 모든 약속 달성. §2 canonical user trigger 가 **3 Draw entry 모두 완전 활성** — RECT × RECT, Legacy Circle × Legacy Circle, Path B Circle × Path B Circle 모든 case 에서 partial overlap 시 자동 3 sub-face 분할.

### 9 PR closure log

| PR | Phase | Commit | 핵심 contribution |
|---|---|---|---|
| #25 | Phase A | `de868ba` | `polygonize_closed_curve_face` helper — Path B → polygonal substitute |
| #26 | B-1 | `d08ffc0` | Sutherland-Hodgman MVP algorithm decision + 7 lock-ins |
| #27 | B-2 | `4df7142` | `coplanar_intersection_segments` primitive (read-only) |
| #28 | B-3a | `d91528b` | `polygon_difference_walking` pure 2D utility (B-3a start_idx fix lesson) |
| #29 | B-3b MVP | `8898467` | `Mesh::auto_intersect_coplanar` (RECT MVP, Path B deferred) |
| #30 | B-3c | `ca8ffb6` | `cleanup_orphan_boundary_edges` + start_idx fix → Path B engine layer |
| #31 | B-4 MVP | `73c004e` | `Scene::intersect_faces_inner` 확장 — Draw 자동 trigger (polygonal only) |
| #33 | B-6 | `5c6ee4b` | E2E verification (engine 3 + visual 4 scenarios) + canonical lessons |
| **#32** | **B-4b** | **`046973a`** | **Non-destructive AABB+coplanarity pre-check → Path B activated** |

### 회귀 누적 (closure 시점)

| Crate | Before (ADR-101 시작) | After | Δ |
|---|---:|---:|---:|
| axia-core | 209 | **293 PASS** | +84 |
| axia-geo | 1256 | **1296 PASS** | +40 |
| Playwright E2E | 15 | **74 passed + 1 skipped** | +7 new B-6 specs |
| 절대 #[ignore] 금지 | 100% | **100%** | 유지 |

### Hybrid 패러다임 first-class 활성 — canonical lesson

B-4b 는 ADR-028 Phase A 의 hybrid Edge struct (`curve: Option<AnalyticCurve>`) 를 **사용자-facing op 로 처음 활성** 한 사례:

| 측면 | B-4 MVP (Path B skipped) | B-4b (Path B 1급) |
|---|---|---|
| `Edge.curve` 활용 | 무시 (polygonize 가 destroy) | `face_world_aabb` / `face_world_normal` 의 source |
| Path B status | scope guard 로 skip | first-class input |
| 메모리 효율 | 32 verts 즉시 생성 (speculative) | 0 verts in pre-check phase |
| 사용자 trigger | RECT only | RECT + Legacy + Path B |

향후 모든 hybrid-aware op (Boolean / Push-Pull / Offset NURBS variants) 가 본 B-4b 패턴 답습 가능:
1. AABB pre-check via `Edge.curve` metadata
2. Coplanarity / normal check via curve.normal
3. Only mutate after pre-check passes

### Canonical lessons (보존)

| Lesson | Source amendment | 핵심 |
|---|---|---|
| L1 — "check first, mutate second" | Amendment 6 → 7 진화 | speculative mutation 의 side-effect leak 차단 |
| L2 — `dist/` staleness in Playwright | Amendment 5 (B-6) | `npm run preview` 가 production build 서빙. WASM rebuild 후 `npm run build` 필수 |
| L3 — AxiA Y-up coordinate convention | B-6 visual demo | `setViewMode('top')` 가 -Y 축 down, normal +Y face 가 floor |
| L4 — Default camera radius 60000mm | B-6 visual demo | 작은 geometry 는 `setCameraState({radius, target})` 으로 fit 필수 |
| L5 — Algorithm gaps in non-canonical input | B-3c start_idx fix | RECT 만 통과한 알고리즘이 Circle 에서 실패 발견 가능 |
| L6 — Pure utility extraction (ADR-091 §E L4) | B-3a / B-4b helpers | 함수 분리가 target fix 가능하게 만듦 |
| L7 — Multi-week atomic decomposition (ADR-094 §E L1) | 전 시리즈 | additive-first risk 격리 + multi-gate 결재 |

### B-5 sweep matrix deferred (rationale)

ADR-101 §4 의 Phase C-1 ~ C-4 (B-5 sweep 매트릭스 +15~20 회귀) 는 다음 이유로 deferred:

1. **Coverage 충분**: 현재 회귀 자산 (Rust unit 8 + E2E 7) 이 canonical case 매트릭스 (RECT × RECT / Circle × Circle Legacy / Path B × Path B / disjoint / containment / non-coplanar / non-convex / inactive) 모두 cover.
2. **사용자 facing 가치 활성**: B-6 E2E 가 real Chromium round-trip 으로 user trigger 검증. B-5 추가 회귀 자산은 보험성 (사용자 가치 0).
3. **YAGNI**: ADR-046 P31 #1 ("가볍게") 정합. Future ADR 에서 발견되는 edge case 가 등장하면 그 시점에 추가 가능.

### Out-of-scope (deferred to future ADRs)

ADR-101 §5 의 out-of-scope 항목 (변경 없음):

- **Non-convex polygon clipping** — Weiler-Atherton / Vatti 필요 시 별도 ADR
- **3-way 동시 overlap** (A ∩ B ∩ C 분할) — Phase C-4 future
- **NURBS-aware coplanar intersect** (현재 polygonize 후 clip → 향후 직접 NURBS SSI) — ADR-027/064 cross-cut, 별도 ADR
- **Lens identity refinement** (multi-material overlap UX) — ADR-102 (가칭) trigger 시 진행
- **Snapshot serialization** — auto-split 결과는 일반 mesh 처럼 직렬화 가능 (additive)

### Cross-link (final)

- LOCKED #1 ADR-021 P7 (canonical anchor) — 본 ADR 의 *완전한* 의미 활성
- ADR-022 P9 (vertex-shared pinch promote) — Option (b) lens promote 패턴 inspiration
- ADR-028 Phase A (hybrid Edge) — B-4b 의 first-class 사용
- ADR-059 P-N Step 3 (`curve_mandatory()`) — future NURBS-aware migration anchor
- ADR-061 §B (`curve_version`, `polyline_cache`) — hover Newton 인프라
- ADR-064/066 (NURBS Boolean DCEL) — future NURBS-direct intersect path
- ADR-089 (Path B closed-curve face) — Path B canonical form, B-4b 가 직접 활용
- ADR-094 §E L1 (additive-first + multi-gate atomic) — 본 9 PR 시리즈 답습
- ADR-091 §E L4 (pure utility extraction) — B-3a / B-4b helpers
- LOCKED #14 메타-원칙 #14 (면은 닫힌 경계로부터 유도된다) — 본 ADR 의 deepest realization

### Closure 의 사용자 facing 의미

ADR-101 §2 시연 (2026-05-14):
> "사용자가 두 원 (반지름 5, center distance 4 — lens region 존재) 을 그렸을 때 분할 안 됨"

→ **2026-05-15 closure**: 두 원 (Path B 또는 Legacy 또는 RECT) 어느 방식으로 그려도 partial overlap 시 자동 3 sub-face. ADR-021 P7 "닫힌 엣지에는 면이 생성되어야 한다" 의 가장 강한 의미 (coplanar partial overlap → 3 sub-face) 가 사용자 시연 가능.

---

## Amendment 10 — 메타-원칙 #15 Cross-cut HARD Flag Enforcement (2026-05-16)

**Amendment Status**: Accepted (✅ Closed — engine fix + helper API + 3 회귀, base = origin/main)
**Trigger**: ADR-101 Amendment 9 (PR #64) 의 §A9.4 cross-cut audit inventory — 메타-원칙 #15 위반 4 함수 (`split_face_by_chain` / `split_face_case_b/c/d` / `boolean.split_faces_by_intersections`) HARD flag 미부여 발견. 본 Amendment 10 으로 strict enforcement.

### A10.1 canonical anchor (메타-원칙 #15)

> **"동일한 분할 연산은 동일한 topological contract — 빠르고, 신속하고, 정확하게."**
> (canonical, 사용자 결재 2026-05-16, ADR-101 Amendment 9 §A9.6)

모든 split-type 함수 (= `Mesh::split_face` / `split_face_by_chain` / `split_face_case_b/c/d` / `auto_intersect_coplanar` / `boolean.split_faces_by_intersections`) 가 split-induced edges 에 `HeFlags::HARD` 부여 동일 contract. Render path (`export_edge_lines_with_map` mesh.rs:5384-5404) 의 coplanar Plane edge hide (LOCKED #16 K-ε hotfix) 와 split 의도의 충돌은 split-side 의 HARD 부여로 명시 해소.

### A10.2 Helper API (canonical, mesh.rs)

본 Amendment 가 추가한 2개 public helper — 향후 모든 split-type 함수의 reference pattern.

**`Mesh::mark_chain_edges_hard(&mut self, chain: &[VertId])`** (mesh.rs:2557):
- `chain.windows(2)` 으로 pair iterator
- 각 pair 의 `find_edge(v0, v1)` 결과 EdgeId 에 HARD 부여
- 모든 radial twin HEs 일괄 (mesh.rs:5364-5378 패턴 답습)
- 안전 OR 패턴 (`set_flags(flags() | HARD)`, mesh.rs:2541 답습)

**`Mesh::mark_edges_hard(&mut self, edges: &[EdgeId])`**:
- explicit EdgeId list 직접 입력 (chain 만들기 어려운 case_b/c/d/boolean 용)

**`Mesh::mark_single_edge_hard` (private)** — 두 public helper 의 공통 internal.

### A10.3 Cross-cut fix (4 함수 + 1 reference)

| 함수 | Fix 위치 | Helper 사용 | 회귀 |
|---|---|---|---|
| `Mesh::split_face` (mesh.rs:3817) | 변경 없음 (canonical reference, 이미 정합) | inline (line 4068-4069) | 기존 회귀 유지 |
| `Mesh::split_face_by_chain` (face_split.rs:514) | line 748 직후 추가 | `mark_chain_edges_hard(chain_verts)` | **`adr101_amendment10_split_face_by_chain_marks_hard`** |
| `split_face_case_b` (face_split.rs:868) | new_edges build 직후 추가 | `mark_edges_hard(&new_edges)` | (cross-cut helper coverage) |
| `split_face_case_c` (face_split.rs:1162) | new_edges push 직후 추가 | `mark_edges_hard(&new_edges)` | (cross-cut helper coverage) |
| `split_face_case_d` (face_split.rs:1397) | new_edges push 직후 추가 | `mark_edges_hard(&new_edges)` | (cross-cut helper coverage) |
| `boolean.split_faces_by_intersections` (boolean.rs:446) | remove_face 직후, `find_shared_edge_between_faces` cartesian | `mark_edges_hard(&shared_edges)` | (cross-cut helper coverage) |

### A10.4 회귀 누적 (+3 axia-geo)

- `adr101_amendment10_helper_mark_chain_edges_hard` — helper 단위, chain edges HARD 부여 + scope creep 차단 (untouched edges 미부여)
- `adr101_amendment10_helper_mark_edges_hard` — helper 단위, explicit EdgeId list 입력
- `adr101_amendment10_split_face_by_chain_marks_hard` — integration, diagonal chain split → chain edge HARD

axia-geo: 1318 → **1321 PASS**. axia-core: 296 유지 (영향 없음 — additive only). 절대 #[ignore] 금지 3/3 준수.

### A10.5 Lock-ins (L-A10-1 ~ L-A10-6)

- **L-A10-1** Helper canonical pattern — 향후 모든 split-type 함수 신설 / 수정 시 `mark_chain_edges_hard` 또는 `mark_edges_hard` 호출 강제
- **L-A10-2** Safe OR pattern — `set_flags(flags() | HARD)` 으로 기존 flags 보존 (mesh.rs:2541 답습)
- **L-A10-3** Radial twin walk — manifold 가정 보장 안 함, full radial chain enumeration (mesh.rs:5364-5378)
- **L-A10-4** Additive only — 기존 회귀 자산 0 변경 (axia-geo 1318 그대로 유지), 새 회귀 +3
- **L-A10-5** Boolean split = shared edges only — 외부 boundary 는 face_normals.len()==1 → 자동 draw (HARD 부여 불필요, scope 정확)
- **L-A10-6** `Mesh::split_face` canonical reference — 변경 없음, 이미 메타-원칙 #15 정합 (mesh.rs:4068-4069)

### A10.6 Out-of-scope (deferred)

- **새 split-type 함수 추가 시 enforcement**: 향후 ADR / Amendment 가 새 split 함수 추가 시 본 helper 호출 강제 — 개별 ADR scope 외, 메타-원칙 #15 강제로 cover
- **Visual baseline (LOCKED #40 / ADR-077) 의 split shared edges 시각**: 별도 visual baseline 확장
- **Boolean intersection 의 chain edges 정확 식별** (현재 shared edges between new_faces 만 — non-shared cut edge 처리 future trigger)
- **HARD flag 의 SOFT toggle UI**: future user-facing UX (e.g., merge sub-faces 의도 시 HARD 제거) — 별도 ADR

### A10.7 Cross-link

- **ADR-101 Amendment 9 (PR #64) §A9.4 cross-cut audit inventory** — 본 Amendment 10 의 trigger (위반 4 함수 발견)
- **ADR-101 Amendment 9 §A9.6 메타-원칙 #15** — 본 Amendment 의 canonical anchor
- **`Mesh::split_face` (mesh.rs:4068-4069)** — canonical reference, 모든 split-type 함수의 모범
- **LOCKED #16 (ADR-038 K-ε hotfix)** — coplanar Plane edge hide 정책 (보존). split 의도와의 충돌은 HARD 부여로 명시 해소
- **메타-원칙 #14** — "면은 닫힌 경계로부터 유도된다" — split-induced edges 가 새 face boundary 의 일부, 시각 일관성 강제
- **LOCKED #1 / #12** — face 합성 / 분할 정책 유지 (additive only, 영향 0)

---

## Amendment 9 — 결함 C fix (Render edge hide) + §3.2 매트릭스 정정 (2026-05-16)

**상태**: 🔄 In progress (ζ-1 spec, this commit)
**Trigger**: Closure 후 추가 사용자 시연 audit (2026-05-16):
> "engine 은 분할 (audit PASS) 하지만 시각적으로 안 보입니다. CIRCLE 이
> 관여하면 분할 boundary 가 wireframe 에서 hide 됩니다."

### A9.1 결함 C — 진단 매트릭스 (재정리)

| 케이스 | engine | 시각 | 분류 |
|---|---|---|---|
| RECT × RECT partial overlap | ✅ 분할 (3 sub-faces) | ⚠️ 외부 boundary 만 보임 (lens 내부 분할 라인 hide) | **결함 C 적용** (이전 매트릭스 "✅ 보임" 정정 — 외부 boundary 만 visible) |
| RECT × CIRCLE partial | ✅ 3 sub-faces, 14 shared edges | ❌ lens 내부 분할 라인 안 보임 | **결함 C 적용** |
| CIRCLE × CIRCLE partial | ✅ 3 sub-faces, 15 shared edges | ❌ lens 내부 분할 라인 안 보임 | **결함 C 적용** |
| 큰 안 작은 (containment) | ❌ 두 도형 별개 공존 | ❌ 분할 라인 없음 | **LOCKED #1 정책 (의도)** — §3.2 "Containment ✅" 잘못된 기재 정정 |
| 3+ overlap | ❌ 부분만 | 부분만 | ADR-101 L-B4-3 deferred (Out-of-scope 보존) |

### A9.2 §3.2 매트릭스 amendment (canonical)

**기존 (잘못된 기재)**:
```
| Containment (A ⊂ B) | ✅ Hole injection (`auto_intersect_on_draw` containment branch) |
```

**정정 (canonical, LOCKED #1 정합)**:
```
| Containment (A ⊂ B) | ❌ 자동 hole injection 비활성 — LOCKED #1 ADR-015 B1 auto hole-promote 비활성 정책 정합. 명시적 `merge-as-hole` 우클릭 메뉴만 promote. `scene.rs:2908-2916` 답습. |
```

근거: LOCKED #1 (ADR-015) 의 stacked inner RECT topology 정책 — B1 auto hole-promote **비활성**. 두 face 가 별개 simple face 로 공존, 자동 ring 변환 안 함. ADR-101 §3.2 의 기존 "Containment ✅" 기재는 LOCKED #1 와 직접 충돌.

### A9.3 결함 C 진짜 메커니즘 (audit 결과)

**경로 추적**:
1. ADR-101 B-3 `auto_intersect_coplanar` (`coplanar.rs:444-446`): `remove_face × 2 + add_face × 3` 패턴으로 lens / face_a_only / face_b_only 생성
2. `add_face` 가 만든 새 boundary HEs 의 flags = clear (HARD 미부여)
3. Render path `Mesh::export_edge_lines_with_map` (`mesh.rs:5384-5404`):
   - lens 와 a_only/b_only 사이의 shared edges → `face_normals.len() == 2`
   - `surfaces_in_same_smooth_group` → Plane case `_ => false` (smooth-group 아님)
   - fallback angle test: `dot = 1.0` (같은 평면 normal) `< cos_threshold = cos(20.1°) ≈ 0.939` → **false** → **draw=false → edge hide**
4. 사용자: lens 내부 분할 라인 시각 인지 불가

**Contract 불일치 (architectural root)**:
- `Mesh::split_face` (`mesh.rs:3891-3892`): **명시 부여** (`set_flags(HeFlags::HARD)`) — 주석 "Mark split edge HEs as HARD so they render even between coplanar faces"
- `Mesh::polygonize_closed_curve_face` (`mesh.rs:3308`): **부여 없음** (substitute, split 아님 — 의도)
- ADR-101 `auto_intersect_coplanar`: **부여 없음** (결함)

### A9.4 메타-원칙 #15 (canonical, 사용자 결재 2026-05-16)

> **"동일한 분할 연산은 동일한 topological contract — 빠르고, 신속하고, 정확하게"**
> ("Same split op = same topological contract — fast, swift, accurate.")

**의미**:
- 모든 split-type 함수 (`split_face` / `split_face_by_chain` / `split_face_case_b/c/d` / `auto_intersect_coplanar` / Boolean split / `split_faces_by_intersections`) 는 split-induced edges 에 **HARD flag 부여** 라는 동일 contract 준수.
- Render path (`export_edge_lines_with_map`) 의 coplanar hide 정책 (LOCKED #16 K-ε hotfix) 과 split 의도의 충돌은 split-side 의 HARD flag 부여로 명시 해소.
- "빠르고 신속하고 정확" — 추가 분기 / lookup 없이 flag 1 bit 로 정확한 동작 보장 (`force_hard` fast-path in `mesh.rs:5359`).

**적용 사례 (cross-check, ζ-3 audit 결과 2026-05-16)**:

| 함수 | HARD flag 부여 | 메타-원칙 #15 정합 | 상태 |
|---|---|---|---|
| `Mesh::split_face` (mesh.rs:4068-4069) | ✅ 명시 (`set_flags(HeFlags::HARD)`) | ✅ canonical model | reference |
| `Mesh::polygonize_closed_curve_face` (mesh.rs:3308) | ❌ (substitute, split 아님) | ✅ out of contract (의도) | 정합 |
| `auto_intersect_coplanar` (coplanar.rs:444+Step 10.5) | ✅ Amendment 9 부여 | ✅ **fix 완료** | **ζ-2 closure** |
| `Mesh::split_face_by_chain` (face_split.rs:514) | ❌ HARD 흔적 0건 | ⚠️ **위반** | 별도 PR 권장 |
| `split_face_case_b` (face_split.rs:868) | ❌ HARD 흔적 0건 | ⚠️ **위반** | 별도 PR 권장 |
| `split_face_case_c` (face_split.rs:1162) | ❌ HARD 흔적 0건 | ⚠️ **위반** | 별도 PR 권장 |
| `split_face_case_d` (face_split.rs:1397) | ❌ HARD 흔적 0건 | ⚠️ **위반** | 별도 PR 권장 |
| `boolean.rs::split_faces_by_intersections` (boolean.rs:446) | ❌ `add_face` 만 호출 | ⚠️ **위반** | 별도 PR 권장 |

**audit 결정 (사용자 결재 기다림)**:
- 본 Amendment 9 scope = `auto_intersect_coplanar` 만 fix (사용자 결재 zeta-1)
- 잔존 4 함수 (split_face_by_chain / case_b/c/d / split_faces_by_intersections) 의 HARD 미부여는 **별도 PR / 별도 ADR** 권장
- 근거: Amendment 9 의 atomic 범위 + 각 함수의 실제 사용자 시연 결함 우선순위 별개

향후 모든 split-type 함수 신설 / 수정 시 본 메타-원칙 #15 정합 강제. 회귀 테스트로 enforce.

### A9.5 Fix 방향 (ζ-2 engine fix, 사용자 결재 후)

**위치**: `crates/axia-geo/src/operations/coplanar.rs:444-466`, lens 생성 직후 Step 10.5 신설.

**정책 — 어떤 edges 가 HARD 부여 받는가**:
- **lens 의 outer boundary HEs (양쪽 twin 포함)** 만 HARD 부여.
- 근거: lens 의 outer boundary 는 **모두 split-induced edges** (a_only / b_only 와 공유). 외부 boundary 아님. 정확한 contract.
- a_only / b_only 의 외부 boundary HEs 는 자동으로 face_normals.len()==1 분기 (인접 face 없음) → 항상 draw. 추가 부여 불필요.

**구현 패턴** (`mesh.rs:2799` 답습 — 안전한 OR 패턴):
```rust
// Step 10.5 (Amendment 9, ADR-101 L-B9): split-induced edges HARD flag.
// 메타-원칙 #15 (동일 분할 연산 = 동일 topological contract) 정합.
// LOCKED #16 K-ε hotfix 의 coplanar Plane edge hide (`mesh.rs:5384-5404`)
// 와 ADR-101 의 split 의도 충돌 해소.
//
// lens 의 outer boundary 는 모두 split edges (a_only / b_only 와 공유,
// 외부 boundary 아님). 두 twin HE 모두 HARD.
let start = mesh.faces[lens].outer().start;
let mut he_id = start;
loop {
    let twin = mesh.hes[he_id].twin();
    let f0 = mesh.hes[he_id].flags() | HeFlags::HARD;
    mesh.hes[he_id].set_flags(f0);
    if !twin.is_null() {
        let f1 = mesh.hes[twin].flags() | HeFlags::HARD;
        mesh.hes[twin].set_flags(f1);
    }
    he_id = mesh.hes[he_id].next();
    if he_id == start { break; }
}
```

### A9.6 회귀 영향 예측

| Suite | Δ (예상) | 내용 |
|---|---|---|
| axia-geo (Rust) | +3 ~ 5 | `adr101_amendment9_lens_boundary_hard_flag_set` / `adr101_amendment9_export_emits_lens_shared_edges` / `adr101_amendment9_external_boundary_unchanged` |
| Playwright E2E (선택, ζ-4) | +1 | B-6 visual demo 에 `getEdgeLineBufferLength()` 또는 분할 라인 wire count assert |
| 절대 #[ignore] 금지 | 100% | 유지 |

### A9.7 Lock-ins (canonical)

- **L-B9-1**: split-induced edges 만 HARD 부여 (외부 boundary 무관 — 자동 draw)
- **L-B9-2**: lens outer boundary 전체 (twin 포함) HARD — `split_face` answer 답습
- **L-B9-3**: a_only / b_only outer boundary 는 HARD 미부여 (외부 = face_normals.len()==1 → 자동 draw)
- **L-B9-4**: HARD 부여는 `add_face × 3` *직후* 실행 — face wiring 완료 후 안전
- **L-B9-5**: `set_flags(flags() | HARD)` 패턴 (안전 OR) — 기존 flags 보존
- **L-B9-6**: §3.2 매트릭스 "Containment ✅" → "❌ (LOCKED #1 정합)" 정정 — A9.2
- **L-B9-7**: 매트릭스 "RECT × RECT ✅ 보임" 의미 정정 — 외부 boundary 만 visible (이전 잘못된 인지 보정)
- **L-B9-8**: 메타-원칙 #15 등재 — 향후 모든 split-type 함수의 anchor
- **L-B9-9**: ζ-3 cross-cut audit (split_face_by_chain / split_faces_by_intersections / split_face_case_b/c/d) — 본 Amendment scope 외 발견 시 별도 fix 권장 (별도 commit 또는 별도 ADR)

### A9.8 Out-of-scope (deferred to future)

- **ζ-3 cross-cut 의 함수들 fix** — audit 결과 HARD 미부여 발견 시 별도 commit / 별도 PR (본 Amendment 는 `auto_intersect_coplanar` 만 scope)
- **Visual baseline (LOCKED #40 / ADR-077) 의 lens shared edges 색상** — 별도 visual baseline 확장
- **Lens 내부 분할 라인의 사용자 highlight UX** (선택 시 강조 색) — 별도 ADR
- **3-way overlap edge contract** — ADR-101 §5 의 future trigger
- **결함 D — Mixed case vertex-on-corner degeneracy (canonical, 사용자 시연 evidence 2026-05-16)**:
  - 사용자 미리보기 시연에서 발견 — `drawRectAsShape` (10×10 @ center (5,5)) + `drawCircleAsShape` (r=5 @ center (10,5), 32 segs) partial overlap 시 `auto_intersect_coplanar` 가 split 발동 안 함 (afterA=1, afterB=2, expected 3).
  - **Root cause audit (test diagnostic evidence)**: `coplanar_intersection_segments` 의 crossings count = 0 (lens detected size=17, but boundary crossings missed). CIRCLE polygon 의 cardinal vertices (theta = π/2 → (10, 10), theta = 3π/2 → (10, 0)) 가 RECT corner 와 정확히 일치 → vertex-on-corner incidence 가 edge-edge cross 로 count 안 됨.
  - **Non-degenerate verification**: center 를 (10.5, 5.5) 로 offset 한 case 는 정상 3 sub-faces split (Amendment 9 보너스 회귀 `adr101_amendment9_rect_x_circle_mixed_non_degenerate_splits` 봉인).
  - **ADR-101 B-1 lock-in trade-off**: Sutherland-Hodgman MVP convex 가정의 known boundary degeneracy. ADR-101 §5 의 "Non-convex polygon clipping — Weiler-Atherton / Vatti 필요 시 별도 ADR" 영역.
  - **별도 ADR (가칭 ADR-101-D 또는 ADR-103+)**: Algorithm-level fix — vertex-on-edge fallback 또는 robust polygon clipping (Vatti) 또는 epsilon-perturbation. 본 Amendment scope 외.
  - **✨ 자연 해소 evidence — ADR-107 (PR #65)** (2026-05-16 audit, 사용자 결재 (ν) 후 미리보기 환경 직접 측정): `drawCircleAsCurve` (Path B canonical, ADR-089) 사용 시 동일 trigger (center=(10,5)) → **split=3 ✅** (D2 audit). Path B 의 `auto_intersect_coplanar` 진입 시 `polygonize_closed_curve_face` 가 chord_tol-driven sampling 으로 polygonize → 32-segs cardinal alignment 회피 → vertex-on-corner degeneracy 차단. ADR-107 ζ-β engine dispatch (`drawCircleAsShape` → `drawCircleAsCurve` 자동 변환) 후 사용자 시연 시 결함 D **자동 해소**. 별도 algorithm-level fix ADR 불필요. Cross-link: [ADR-107 §7.1](107-as-shape-path-b-unification.md).

### A9.9 Path Z atomic plan (ζ-1 ~ ζ-5)

| Step | 변경 | 회귀 (예상) | Status |
|---|---|---|---|
| **ζ-1** | 본 Amendment 9 spec (docs only) | 0 | 🔄 In progress |
| **ζ-2** | `auto_intersect_coplanar` engine fix (Step 10.5 HARD 부여) | +3~5 axia-geo | Pending |
| **ζ-3** | cross-cut audit (split_face_by_chain / split_faces_by_intersections / etc.) | +1~2 | Pending |
| **ζ-4** | Playwright B-6 visual assert (선택) | +1 | Pending |
| **ζ-5** | Closure — CLAUDE.md LOCKED #41 갱신 + 메타-원칙 #15 등재 + docs final | 0 | Pending |

**총 회귀 예상**: +5 ~ +8, 절대 #[ignore] 금지 100% 유지. Single PR (`feat/adr-101-amendment-9-hard-flag`).

### A9.10 Cross-link

- **LOCKED #1 ADR-021 P7** — Amendment 9 §3.2 매트릭스 정정의 anchor (Containment ❌)
- **LOCKED #16 ADR-038 K-ε hotfix** — render path coplanar hide 정책의 source. 본 Amendment 는 hide 정책은 유지 + split-side 의 HARD flag 부여로 충돌 해소
- **LOCKED #34 ADR-087** — Kernel-Native Command Suite Reset 의 architectural correctness 답습 (split contract uniformity)
- **메타-원칙 #15 (신설)** — 모든 split-type 함수의 canonical anchor
- **Cross-cut audit 대상 (ζ-3)**: `Mesh::split_face_by_chain` / `Mesh::boolean.split_faces_by_intersections` / `face_split.rs::split_face_case_b/c/d` — 동일 contract 정합 여부
- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다") — 본 Amendment 의 *분할 라인 시각* 측면 첫 적용
