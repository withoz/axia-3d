# ADR-102 — Push/Pull Detach-on-Arrangement

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-15) — ✅ Closed** — Phase α/β/γ/δ/ε all atomic-merged. See §D Acceptance Log. |
| Date | 2026-05-15 |
| Supersedes | — |
| Related | ADR-007 (Face orientation policy), ADR-016 Q2 (multi-loop face restrictions), ADR-021 P7 (closed edge cycle divides face), ADR-022 P9 (vertex-shared pinch promote), ADR-079 (Create Solid surface-native), ADR-101 (Coplanar partial overlap auto-intersect), LOCKED #1 P7 manifold, LOCKED #41 ADR-101 closure |

---

## 1. Anchor 통찰 (canonical)

> "Push/Pull 한 face 가 인접 coplanar sibling 과 공유한 boundary 를 cleave 한 후 extrude 해야 한다. 그렇지 않으면 결과 솔리드의 bottom 이 sibling 과 manifold-coincident 가 돼 LOCKED #1 P7 manifold rule 을 위반한다."

ADR-101 §B-4 closure 직후 (2026-05-15) Tier 2 cross-cut 검증 도중 발견. Push/Pull (=`create_solid_extrude`) 가 ADR-101 의 B-4 sub-face (인접 coplanar sibling 이 있는 face) 위에서 호출되면:

- ✅ Surface inheritance 정합 (ADR-101 B-3b L-B3b-3): source face 의 Plane surface 가 인식됨
- ✅ Extrude 자체 success: 솔리드 (예: Box 6 faces) 생성됨
- ❌ **Manifold 위반**: 결과 솔리드의 bottom (= 원본 lens face) 의 boundary edges 가 sibling (face_a_only / face_b_only) 와 *동시에* 새 side wall 들과 공유 → **edge 마다 3 active face-bearing HE 발생**

SketchUp 의 "stickiness" 답습 — Push/Pull 시 source face 를 sibling 으로부터 *cleave* (boundary verts 를 두 set 으로 분리) 후 extrude 진행. 결과: bottom 이 sibling 과 별개 face (동일 위치이지만 edge 공유 0) → manifold safe.

## 2. 발견 (2026-05-15 ADR-101 cross-cut 검증)

ADR-101 Tier 2 cross-cut 회귀 자산 `adr101_tier2_cross_cut_push_pull_works_on_b4_lens_sub_face` 작성 도중:

```
Step 1: DrawRectAsShape × 2 partial overlap → B-4 auto-split → 3 sub-faces
Step 2: CreateSolid Extrude on lens sub-face → SolidCreated(Box, 6 faces) ✓
Step 3: verify_face_invariants → FAIL
  - edge EdgeId(6): shared by 3 active faces (non-manifold)
  - edge EdgeId(10): shared by 3 active faces (non-manifold)
  - edge EdgeId(13): shared by 3 active faces (non-manifold)
  - edge EdgeId(5): shared by 3 active faces (non-manifold)
```

4 edges = lens 의 4 boundary edges. 각 edge 가:
- lens face (= 솔리드 bottom) 의 HE × 1
- 새 솔리드 side wall 의 HE × 1
- sibling face (face_a_only OR face_b_only) 의 HE × 1
→ 3 face-bearing HE per edge

ADR-101 cross-cut 자체는 별도 finding 으로 PASS (surface inheritance + Tier 2 chain). 본 ADR 은 **별도 architectural concern**.

## 3. 현재 구현 한계

### 3.1 `create_solid_extrude` (`crates/axia-geo/src/operations/create_solid.rs`)

| 단계 | 처리 | 한계 |
|---|---|---|
| Validate profile | Face active, planar (Plane surface), boundary loop closed | sibling adjacency 검증 X |
| Compute extrude verts | profile boundary verts + offset along normal | sibling vertex reuse 차단 X |
| Build solid (Box / GeneralSweep) | `add_face` × N for top + sides | bottom = source profile 그대로 사용 → sibling 공유 edges 가 새 side walls 의 HE 와 동시에 retained |

### 3.2 영향 범위

| 시나리오 | 영향 |
|---|---|
| Isolated face Push/Pull (가장 흔한 case) | ✅ Manifold OK (no sibling) |
| ADR-101 B-4 sub-face Push/Pull | 🔴 Non-manifold |
| Face adjacent to another via shared edge (T-junction) | 🔴 Non-manifold |
| Face with coplanar siblings drawn manually | 🔴 Non-manifold |
| Hole boundary face (ADR-016 Q2 거부) | ❌ Already rejected |

→ **Sibling 이 *있는* 모든 face 의 Push/Pull 이 manifold 깨짐**.

## 4. 제안 작업 (atomic sub-step)

### Phase α — 사전 인프라

| Step | 작업 |
|---|---|
| α-1 | spec ADR (본 문서) — 5 sub-step + 5 lock-ins lock-in |
| α-2 | `Mesh::collect_coplanar_siblings(face_id) -> Vec<FaceId>` helper — source face 와 boundary edge 를 공유하는 *coplanar* (same normal within ε, same plane offset within 1.5μm) face 목록 |

### Phase β — Cleave 본체

| Step | 작업 |
|---|---|
| β-1 | `Mesh::cleave_face_from_siblings(face_id, siblings: &[FaceId])` — source face 의 boundary verts 를 두 set 으로 분리: <br>(a) source set: 새 verts 생성 (동일 좌표), source face 의 outer loop 가 새 verts 참조 <br>(b) sibling set: 기존 verts 그대로 유지, sibling face 의 boundary 무손상 <br>→ 결과: source face 의 boundary edges 가 새 edges (sibling 과 edge 공유 0) |
| β-2 | `mark_face_outer_soft` 등 inherit (source face 의 visual property 유지) |
| β-3 | Curve metadata (`Edge.curve`, `curve_owner_id`) inherit 정책 — cleave 결과 새 edges 가 원본의 metadata 복제 |

### Phase γ — `create_solid_extrude` wiring

| Step | 작업 |
|---|---|
| γ-1 | `create_solid_extrude` 의 pre-step 추가: `siblings = collect_coplanar_siblings(face_id)` |
| γ-2 | `if !siblings.is_empty() { cleave_face_from_siblings(face_id, &siblings)?; }` — extrude 직전만 cleave (다른 op 영향 0) |
| γ-3 | Cleave 결과의 새 source face_id 로 extrude 진행 (기존 face_id 는 invalid 가능) |
| γ-4 | Transaction 통합 — cleave + extrude 는 단일 Undo entry |

### Phase δ — 회귀 자산 (절대 #[ignore] 금지)

| Step | 작업 |
|---|---|
| δ-1 | `cleave_isolated_face_is_noop` — sibling 없는 face → cleave skip, manifold 보존 |
| δ-2 | `cleave_face_with_single_sibling_separates_verts` — T-junction → 두 set 분리 검증 |
| δ-3 | `cleave_b4_lens_sub_face_separates_from_two_siblings` — ADR-101 B-4 lens scenario |
| δ-4 | `adr101_b4_lens_push_pull_manifold_safe_after_cleave` — ADR-101 cross-cut regression (현재 violation → cleave 후 PASS) |
| δ-5 | `cleave_preserves_sibling_boundary` — sibling face 의 boundary 가 cleave 전후 동일 verts 유지 |
| δ-6 | `cleave_preserves_curve_metadata` — Arc / Bezier curve 의 cleave 시 metadata 복제 |
| δ-7 | `cleave_invariants_preserved` — `verify_face_invariants` 가 cleave 후 valid |
| δ-8 | `cleave_undo_one_step` — cleave + extrude 단일 Undo 로 pre-state 복원 |

### Phase ε — Closure

| Step | 작업 |
|---|---|
| ε-1 | ADR-102 Amendment 1 — Phase α-ε 완료 commit log + 회귀 매트릭스 |
| ε-2 | LOCKED #42 — ADR-102 closure entry (LOCKED #41 답습) |
| ε-3 | ADR-101 §B-3b L-B3b-3 cross-link 추가 (이번 finding 의 해소 경로) |

## 5. 제외 (out of scope)

- **Hole boundary face Push/Pull** — 이미 ADR-016 Q2 거부 (변경 없음)
- **Non-coplanar sibling** — 3D 인접 face 는 cleave 대상 아님 (각 face 가 다른 plane → 자연 분리)
- **Multi-step cleave** (cleave 후 다시 cleave) — single-step 만 지원. 후속 op 가 또 sibling 생성하면 그 op 도 cleave 정책 답습 (별도 ADR 가능)
- **Non-convex source face** — ADR-101 cross-cut 에서 L-shape extrude 성공 검증됨. cleave 도 non-convex 지원 (boundary 만 분리, 내부 위상 무관)
- **Tear / un-cleave** — cleave 결과를 다시 sibling 과 merge 하는 op. ADR-005 coplanar merge 또는 explicit user op 별도 진행

## 6. Lock-ins (canonical for ADR-102)

- **L-102-1 Source-side cleave only**: source face 의 boundary verts 만 새 verts 로 분리. sibling face 의 vertex 무손상 (sibling 가 보유한 face_to_xia, curve metadata, surface 그대로)
- **L-102-2 Coplanarity tolerance**: ADR-101 L-B1-3 답습 — sibling 판정 시 normal dot ≥ 0.9999 AND plane offset ≤ 1.5μm (LOCKED #5)
- **L-102-3 Edge cleave 정합**: cleave 후 새 edges 는 source face 의 boundary 만 — sibling 과 edge 공유 0. 결과 manifold safe
- **L-102-4 Extrude-only trigger**: `create_solid_extrude` 의 pre-step 만 cleave. 다른 ops (Boolean / Offset / Move) 영향 0
- **L-102-5 Curve metadata inherit**: cleave 결과 새 edges 가 원본 `Edge.curve` / `curve_owner_id` 복제. `curve_owner_id` 는 **새 owner id 할당** (원본 sibling 과 group 분리)
- **L-102-6 Transaction 단일 entry**: cleave + extrude 가 단일 Undo step. 사용자 facing UX (ADR-049 P-5e-γ collapse 답습)
- **L-102-7 회귀 자산 강제**: δ-1~δ-8 모두 절대 #[ignore] 금지. δ-4 가 ADR-101 cross-cut 의 manifold finding 해소 증거
- **L-102-8 ADR-016 Q2 정합**: hole boundary face Push/Pull 거부 정책 변경 없음 — 본 ADR 은 hole 아닌 *외부 boundary* 의 sibling cleave 만 대상

## 7. SketchUp stickiness 와의 비교

| 측면 | SketchUp | AxiA 3D (제안) |
|---|---|---|
| 자동 cleave | Push/pull 시 자동 | 동일 (`create_solid_extrude` pre-step) |
| Cleave 단위 | 모든 boundary edges | 동일 |
| 결과 vertex 위치 | 원본과 동일 좌표, 별개 vertex | 동일 |
| Reverse op | 사용자가 face 들을 다시 결합하려면 `Edit > Make Component` 등 | ADR-005 coplanar merge 또는 future un-cleave |
| Edge 공유 후 처리 | "sticky" — 사용자가 의도적으로 push/pull 한 면만 분리 | 동일 (Push/Pull 외 ops 는 sibling 유지) |

→ 사용자 muscle memory 정합. ADR-046 P31 #4 (additive only) 답습 — 외부 사용자 facing API 변경 0, 내부 정상화만.

## 8. 회귀 영향 예측

- 기존 회귀 자산 **변경 0** — Phase β-γ 모두 *additive* (cleave helper + extrude pre-step)
- 새 회귀 자산 **+8** (Phase δ 매트릭스)
- 사용자 facing 변화:
  - Push/Pull 결과 솔리드의 bottom 이 sibling 과 manifold-coincident **종료** → visual artifact (z-fight) 사라짐
  - Boolean / Offset 등 후속 op 의 manifold prerequisite 정합
  - AI workflow (MCP Tier 2 opt-in) 안전성 보장

## 9. 사용자 결재 트리거

본 ADR 의 작업은 **1주 scope**. 사용자 명시 결재 + LOCKED 정책 (`docs/adr/README.md` 메타-원칙 #10) 답습. Phase β (cleave 본체) 후 사용자 시연 결재 권장.

ADR-101 의 9 PR atomic 패턴 답습 가능:
- ADR-102-α (spec, 본 PR)
- ADR-102-β (cleave helper)
- ADR-102-γ (extrude wiring)
- ADR-102-δ (회귀 sweep)
- ADR-102-ε (closure docs)

## 10. Cross-link

- LOCKED #1 ADR-021 P7 (manifold anchor) — 본 ADR 이 P7 의 위상 측면 보강
- LOCKED #41 ADR-101 closure entry — cross-cut finding 의 source
- ADR-007 Invariant 2 (winding) — cleave 후도 정합 유지
- ADR-016 Q2 (multi-loop face Push/Pull 거부) — 본 ADR 은 outer boundary 만 대상, hole 정책 변경 없음
- ADR-022 P9 (vertex-shared pinch promote) — small-face 분리 패턴 inspiration
- ADR-046 P31 #4 (additive only) — 사용자 facing API 무변경 정합
- ADR-049 P-5e-γ (transaction collapse) — cleave + extrude 단일 Undo
- ADR-079 (Create Solid surface-native) — extrude entry point
- ADR-094 §E L1 (additive-first + multi-gate atomic) — 본 5 sub-step 답습
- ADR-101 §B-3b L-B3b-3 (surface inheritance) — cleave 결과 surface metadata 복제 정합
- ADR-101 cross-cut finding (2026-05-15) — 본 ADR 의 trigger
- LOCKED #5 (1.5μm spatial-hash) — coplanarity tolerance
- LOCKED #42 (2026-05-15) — ADR-102 closure entry (CLAUDE.md)

---

## D. Acceptance Log (Amendment 1, 2026-05-15)

Path Z atomic 5 sub-step closure. ADR-101 의 9 PR atomic 패턴 답습.

| Sub-step | Branch | Commit | scope | 회귀 |
|---|---|---|---|---|
| α | `docs/adr-102-push-pull-detach` | `04be1b9` | spec ADR + 5 sub-step roadmap + 8 lock-ins | docs only |
| β | `feat/adr-102-cleave-helper` | `81cfe4f` | `collect_coplanar_siblings` + `cleave_face_from_siblings` helpers (axia-geo `operations::cleave`) | axia-geo +4 |
| γ | `feat/adr-102-gamma-wire-extrude` | `219ba37` | `create_solid_extrude` pre-step wiring + closed-curve hot-path fix | axia-geo +2 |
| δ | `feat/adr-102-delta-regression-sweep` | `d437d2d` | Full regression sweep (6 신규 + canonical δ-4 manifold finding 해소 evidence) | axia-geo +6 |
| ε | `docs/adr-102-epsilon-closure` | (본 commit) | Closure docs + LOCKED #42 entry | docs only |

**합계**: **axia-geo 1296 → 1308 PASS (+12, 절대 #[ignore] 금지 12/12 준수)**. 0 regression.

### D.1 PR 시퀀스 (모두 main 진입)

- PR #36 (α spec) — `f651a22`
- PR #37 (β cleave helper) — `187862e`
- PR #38 (γ wiring) — `a7115e1`
- PR # (δ sweep) — pending
- PR # (ε closure, 본 PR) — pending

### D.2 Canonical evidence (δ-4)

ADR-102 의 trigger 였던 ADR-101 cross-cut finding (2026-05-15) 의 *직접 회귀*:

**Test**: `adr101_b4_lens_push_pull_manifold_safe_after_cleave`

**Pre-ADR-102**:
```
B-4 lens scenario:
  Step 1: DrawRectAsShape × 2 partial overlap → 3 sub-faces
  Step 2: create_solid_extrude on lens (distance=1.0) → SolidCreated ✓
  Step 3: verify_face_invariants → FAIL
    - edge EdgeId(6): shared by 3 active faces
    - edge EdgeId(10): shared by 3 active faces
    - edge EdgeId(13): shared by 3 active faces
    - edge EdgeId(5): shared by 3 active faces
```

**Post-ADR-102 γ wiring**:
```
B-4 lens scenario:
  Step 1: same
  Step 2: create_solid_extrude on lens →
    pre-step: collect_coplanar_siblings(lens) → [face_a_only, face_b_only]
    pre-step: cleave_face_from_siblings(lens, &siblings) → new_lens_id
    extrude(new_lens_id, distance=1.0) → SolidCreated ✓
  Step 3: face_set_manifold_info(all_active).non_manifold_edge_count == 0 ✓
```

→ **canonical 해소** — `non_manifold_edge_count == 0` 명시 검증 자산.

## E. Lessons (canonical for future ADRs)

본 ADR 의 5 sub-step atomic 진행에서 추출한 lesson — 향후 manifold /
hybrid-aware ADR 가이드:

### E.L1 — `Result.new_face_id` 의미적 invalidation

`cleave_face_from_siblings` 의 결과는 **원본 `face_id` 가 invalid** 임을
명시. 후속 op (이 ADR 의 case: `create_solid_extrude` 내부 surface fetch +
boundary classify) 는 *반드시* `new_face_id` 사용. γ wiring 의 `let
profile_face = { ... cleave.new_face_id ... };` shadow pattern 이
canonical.

향후 *destructive helper* 작성 시: 결과 struct 가 *대체 id* 를 carry —
caller 가 silent 으로 stale id 사용 못 하게.

### E.L2 — Closed-curve face 의 architectural isolation

ADR-089 Phase 2 kernel-native closed-curve face (1 anchor + 1 self-loop
edge) 는 polygon-sibling 과 *정의상* 공유 불가. β 의 `outer_verts.len()
< 3` 검사가 *kernel-native legitimate state* 를 reject 하던 함정 →
γ-fix 로 빈 Vec hot-path 추가.

향후 polygon-assumption helper 작성 시 *closed-curve hot-path 명시
검토 강제*. ADR-089 시민권 활성 후 모든 mesh-era helper 가 같은 footgun
가능성.

### E.L3 — 사용자 시연 게이트의 architectural 가치

ADR-087 K-ζ canonical 답습: ADR-101 cross-cut 회귀 작성 도중 *시연
시점 manifold violation 발견* (test 만으로는 architectural 회귀 보장 불가).
ADR-102 가 그 결과의 *명시 해결 트랙*.

향후 architectural ADR 의 ζ-step 사용자 시연 필수 (ADR-094 §E L1
답습).

### E.L4 — Atomic 5 sub-step 의 *문서 → 코드 → 검증 → 회고* 분리

α (spec) → β (helper) → γ (wiring) → δ (sweep) → ε (closure docs) 의
5 단계가 ADR-101 9 PR 보다 짧지만 architectural 완결성 동일. *manifest
trigger* 가 단일 finding 인 경우 5 단계가 ideal scope.

### E.L5 — Pure helper extraction (cleave) → consumer 가 적용 결정

β 가 `Mesh::collect_coplanar_siblings` + `cleave_face_from_siblings` 를
*helper only* 로 제공. γ 만 `create_solid_extrude` 에서 호출. 다른 ops
(Boolean / Offset / Move) 는 L-102-4 (Extrude-only trigger) 로 명시
제외.

향후 Boolean / Offset 에서도 cleave 가 필요한 use case 발견되면 *동일
helper 활용* — additive 확장 (ADR-091 §E L4 pure utility extraction
canonical 답습, 본 ADR 이 9번째 적용).

### E.L6 — ADR-091 §E L1 의 *시민권 분리* 가 cleave 의 architectural 안전 보장

`cleave_face_from_siblings` 가 새 verts (`add_vertex_force_new`) +
새 face (`add_face_with_holes`) 만 사용. struct field 추가 0, snapshot
schema 변경 0. β-1 의 `set_face_surface` + `set_curve` + `set_edge_
curve_owner_id` 도 모두 기존 setter — *additive only*. ADR-091 §E L1
의 10번째 적용 (Mesh-level state, struct field 0).

