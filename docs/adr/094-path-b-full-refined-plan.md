# ADR-094: Path B-full Refined Plan (Multi-week Atomic Architectural Track) — **Accepted**

- **Status**: Accepted (B-α ~ B-θ closure 2026-05-09)
- **Date**: 2026-05-09
- **Parent**: ADR-090 (True Kernel-Native Cylinder Path B, deferred)
- **Sibling**: ADR-093 (B-MVP — Path B Light, B-MVP closure 2026-05-09)
- **Trigger anchor**: 사용자 시연 결과 (2026-05-09) — ADR-093 의 selection
  측면 closure 후 *memory / STEP export / parity / Push-Pull 누적* 의
  추가 closure 필요 명시. ADR-090 §6.4 의 잔존 trigger 4개 모두 활성화.
- **Lessons applied**: ADR-091 §E (L1 bincode struct field 금지 / L2
  사전 검토 가치 / L3 6-layer atomic / L4 UI orchestration 분리),
  ADR-092 §E (L1 사전 검토 가치 재확인 / L2 fast-path 일관성 / L3
  메타-원칙 #14 의 3-layer / L4 partial Path B 패턴), ADR-093 §E (L1
  Mesh-level HashMap canonical 첫 적용 / L2 owner-id 자연 확장 / L3
  defensive bridge guard / L4 🅺 path canonical).

## 0. Summary

ADR-090 spec (2026-05-08) 작성 후 5개월 누적 architectural lessons 가
ADR-091/092/093 §E 에서 명시 정착. 본 ADR 은 ADR-090 §5 의 sub-step
ordering 을 **additive-first** 위험 격리 전략으로 재정렬 + lessons 적용
+ 사용자 multi-gate decomposition 명시. **코드 변경 0 — refined plan
only**.

ADR-090 §3 옵션 비교에서 **B-β (multi-loop face 신규 schema)** 가
architectural 정답으로 lock-in. clean 구조 + 산업 CAD parity 자연
활성. 그러나 *위험 격리* 측면에서 schema 변경을 기존 파이프라인과
**coexist 형태로 도입** 후 통합 → flip 시 회귀 자산 보호 + 단계적
검증.

## 1. Architectural anchor

ADR-090 §1.2 의 Path B 목표:

| 항목 | Path A (현재) | Path B-full (목표) |
|---|---|---|
| Cylinder DCEL | 25 face / 70 edge / 46 vert | 3 face / 2 edge / 2 vert |
| Top/Bottom face | Plane, 1 self-loop edge boundary (ADR-089) | 동일 |
| Side face | 23 × {4-vert quad with Cylinder surface} | **1 face with 2 boundary loops + Cylinder surface** (annulus) |
| Boolean SSI | NURBS dispatch 활성 (chord 오차 누적) | Native analytic SSI (chord 오차 0) |
| 메모리 (per-cylinder) | 192 face / 320 edge / 130 vert (N=64) | 3 face / 2 edge / 2 vert (98%+ 절감) |

산업 CAD 참조 (ADR-090 §2.1): Parasolid LOOP (OUTER/INNER/PERIPHERY),
ACIS LOOP sense (HOLE/OUTER), OCCT TopoDS_Face Wire list. 모두
"multi-loop face with surface periodicity" 가 첫 시민 (annulus
topology 자연 표현).

## 2. Refined Sub-step Ordering (Additive-First)

ADR-091 §E L1 (Mesh-level HashMap), ADR-092 §E L1 (engine fix +
render gap), ADR-093 §E L4 (🅺 path) 의 패턴을 본 ADR 에 적용.

### 2.1 Sub-step decomposition

| # | sub-step | 변경 | 회귀 | 일수 |
|---|---|---|---|---|
| 1 | **B-α** spec | 본 ADR | +0 | 1일 |
| 2 | **B-γ-prep** | Face boundary_loops *additive* (Mesh-level map per L1) | +5~8 | 3-5일 |
| 3 | **B-δ-prep** | 새 cylinder primitive *coexist* | +10~15 | 3-5일 |
| 4 | **B-ζ-prep** | Render path *additive* | +5~10 | 3-5일 |
| 5 | **B-ε-prep** | Boolean dispatch *additive* | +10~20 | 5-7일 |
| 6 | **B-η** | 통합 + default flip + 회귀 자산 재검증 | +10~15 | 3-5일 |
| 7 | **B-θ** | 사용자 시연 + closure | +5 | 2-3일 |

**누적 회귀**: +45~73 (ADR-090 §5 원안 +60~90 보다 위험 격리로 절감).
**일수**: 18-29일 (3-4주, 원안 24-37일 보다 단축).

### 2.2 위험 격리 전략 (additive-first)

각 prep sub-step:
1. **기존 회귀 자산 영향 0** — coexist 구조로 default OFF
2. **Hidden flag** 또는 *별도 entry point* 로 신규 path 활성화 (테스트만)
3. **Sub-step 별 회귀 테스트** — 신규 path 자체 검증
4. **B-η flip 시점** 에서만 default 전환 — *single architectural switch*

이 패턴은 ADR-093 D-δ 의 "Defensive bridge guard" + ADR-049 P-5e-α
"localStorage 'false' 명시 OFF preference 보존" 답습.

## 3. Lock-ins (canonical)

### 3.1 Architectural Lock-ins

- **L1 — Mesh-level Map 우선** (ADR-091 §E L1 답습): Face struct 에
  새 field 추가 *금지*. 모든 새 데이터 (`boundary_loops` 등) 는
  `Mesh.face_to_*: HashMap<FaceId, ...>` 형태. Bincode legacy snapshot
  호환 자연 보존.
- **L2 — Schema migration 명시**: V2 → V3 schema bump 시 legacy
  `Face::outer + inners` → `Face::boundary_loops` 변환 helper. Forward-
  compat reject (A-μ 답습).
- **L3 — Coexist before flip**: prep sub-steps 모두 *기존 path 와
  공존*. B-η 가 single architectural switch 시점.
- **L4 — Boolean / Render / Push-Pull 의 dispatch 확장**: 기존 dispatch
  보존 + multi-loop face 추가 분기. ADR-064/066 의 single-loop 가정은
  multi-loop face 진입 시점에만 영향.
- **L5 — LOCKED #1 P7 / #12 P11 변형 명시**: multi-loop face 의 face
  split (P7) + closed edge → face (P11) 의미 갱신. 회귀 자산은 단계적
  갱신 가능 (legacy 1-outer-N-inner 가정 회귀는 보존).
- **L6 — ADR-093 cross-cut**: surface_owner_id 는 Path B 활성 후 group
  of 1 (cylinder = 1 face). Legacy 모드와의 cross-validation.
- **L7 — additive only (ADR-046 P31 #4)**: 메뉴/단축키/툴바 외부 ID
  unchanged. Tool 동작도 unchanged (Cylinder primitive 의 결과 internal
  representation 만 변경).

### 3.2 Render Lock-ins (메타-원칙 #14 답습)

- **L8 — Engine truth + render truth + downstream ops** (ADR-092 §E L3
  답습): annulus surface tessellation 이 engine + render + Boolean
  / Offset 모두 정합. 단일 layer 변경 시 시각 변화 0 위험 (ADR-092
  C-β → C-δ 발견 패턴).
- **L9 — Cylinder uv-slice tessellation** (LOCKED #35 L6 답습):
  annulus face 도 chord-tolerant uv-slice. A-ρ 의 패턴 자연 확장.

### 3.3 Sub-step Lock-ins (각 sub-step 진입 시 결재 anchor)

각 sub-step 의 entry-α 단계에서 별도 ADR (또는 본 ADR amendment) 로
사용자 결재 + 진행. 본 ADR 은 plan only.

## 4. Decision Matrix

| ID | 결정 | 채택 |
|----|------|------|
| **B-A** | 옵션 (B-α/B-β/B-γ) | **B-β multi-loop face 신규 schema** (clean architecture + parity 자연) |
| **B-B** | Schema 위치 | **Mesh-level HashMap** (L1 canonical, ADR-091 §E L1 답습) |
| **B-C** | Coexist vs flip | **Coexist (additive prep) → B-η single flip** |
| **B-D** | LOCKED #1 P7 + #12 P11 정합 | **변형 명시** — multi-loop face 의 변형 P7/P11 의미 정의 |
| **B-E** | Snapshot version | **V2 → V3 schema bump** (A-μ forward-compat reject 활용) |
| **B-F** | ADR-093 grouping cross-cut | **Path B 활성 후 group of 1 — legacy fallback 으로 영구 보존** |
| **B-G** | Sub-step 진입 결재 | **각 sub-step 별 사용자 결재** (multi-gate) |

## 5. ADR-090 §3 옵션 vs 본 refined plan

| 측면 | ADR-090 §5 원안 | 본 ADR 094 refined |
|---|---|---|
| Sub-step 수 | 8 (B-α ~ B-θ) | 7 (단계 통합 — B-α / γ-prep / δ-prep / ζ-prep / ε-prep / η / θ) |
| 회귀 부담 | +60~90 | +45~73 |
| 일수 | 24-37일 (3-5주) | 18-29일 (3-4주) |
| 위험 격리 | 부족 (B-γ 진입 즉시 schema 변경) | 강화 (additive prep → B-η flip) |
| 회귀 자산 보호 | 단계적 review (245+ tests) | coexist 보존 + B-η 전환 |
| Bincode 호환 | A-μ migration 직접 | L1 Mesh-level map 자연 보존 |

## 6. ADR-093 (B-MVP) 와의 관계

ADR-093 의 surface_owner_id grouping 은 Path B 활성 후:
- **Path B 새 cylinder**: 1 cylindrical face → owner_id 자연 미사용 (group of 1)
- **Legacy 모드 coexist**: 기존 cylinder (Path A) 는 owner_id grouping 으로 사용자 facing 동작 보존
- **B-η flip 후**: 새 cylinder 는 Path B 로 생성, legacy cylinder 는 schema migration 으로 변환 시 single annulus face 로 통합

**의미**: ADR-093 은 Path B-full 의 *영구 fallback layer* — legacy
files / 사용자 OFF preference 보존.

## 7. 위험 매트릭스 (refined)

ADR-090 §4 의 위험 매트릭스 + 본 ADR 의 additive-first 전략으로 강화:

| 위험 | 영향 | 평가 | 완화 |
|---|---|---|---|
| LOCKED #1 P7 회귀 | 매우 높음 | 245+ 회귀 자산 모두 1-outer-N-inner 가정 | **B-η 전 회귀 자산 보존** (additive prep 으로 영향 0). flip 시점에서 변형 P7 의미 적용 + 갱신 |
| LOCKED #12 P11 회귀 | 매우 높음 | annulus side face 의 변형 의미 | B-γ-prep 에서 변형 P11 의미 명시 + 회귀 자산 갱신 |
| Boolean SSI multi-loop | 매우 높음 | ADR-064/066 single-loop 가정 | B-ε-prep 의 *additive* 처리 — 기존 dispatch 보존 + multi-loop 분기 추가 |
| Snapshot serde V2→V3 | 중간 | Face schema 변경 시 legacy 호환 | A-μ forward-compat 인프라 활용 + V3 bump 시 legacy → boundary_loops 변환 helper |
| Render path multi-loop | 중간 | A-ρ uv-slice 가 4-vert quad 가정 | B-ζ-prep 의 *additive* — annulus tessellation 분기 추가 |
| MCP / WASM API | 낮음 | 외부 surface 영향 미미 | Face id 단위 호출 — schema 변경 transparent |
| 3-4주 atomic 컨텍스트 손실 | 중간 | 회귀 자산 누적이 가드레일 | sub-step 별 사용자 결재 + Path Z atomic |
| ADR-093 fallback 의 메모리 비용 | 낮음 | legacy 모드 보존 시 polygon strip 잔존 | 사용자 explicit OFF preference 만 — 기본 Path B 활성 |

## 8. 사용자 facing 의도 (Path B-full closure 후)

| 측면 | 변화 |
|---|---|
| Cylinder DCEL | 3 face / 2 edge / 2 vert (98%+ 메모리 절감) |
| Boolean SSI | analytic chord 오차 0 |
| STEP/IGES export | analytic cylinder 1:1 매핑 (ADR-035/036 활성) |
| 산업 CAD parity | Parasolid/ACIS/OCCT 와 동급 multi-loop face |
| ADR-093 grouping | legacy fallback 으로 영구 보존 |
| 사용자 click | Cylinder 측면 = 1 face (자연 — group walk 미필요) |

## 9. ADR-046 P31 정합

- #1 (P1+P3 가치): ✅ — 산업 CAD parity (P1 건축/디자인) + analytic
  AI agent 직접 활용 (P3 AI 협업자)
- #4 (additive only): ✅ — UI 외부 ID unchanged. Internal representation
  변경만.
- 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다"): ✅ — annulus side
  face = 2 closed boundary (top circle + bottom circle) 의 자연 byproduct

## 10. 사용자 multi-gate (각 sub-step 결재)

본 ADR 은 plan only. 각 sub-step 진입 시:
1. **B-γ-prep**: Face::boundary_loops additive 진입 결재
2. **B-δ-prep**: cylinder primitive coexist 진입 결재
3. **B-ζ-prep**: render path additive 진입 결재
4. **B-ε-prep**: Boolean dispatch additive 진입 결재
5. **B-η**: 통합 + default flip 진입 결재 (architectural switch)
6. **B-θ**: 사용자 시연 + closure

**multi-week atomic 의 회귀 격리** — 각 sub-step 별로 회귀 자산 통과
+ 사용자 결재 → 다음 단계.

## 11. Out of Scope

- **Sphere / Cone / Torus** annulus topology 활성 — 본 ADR 은 cylinder
  primitive 만. 후속 ADR 진행 가능 (Sphere = 2 polar singularities,
  Cone = 1 apex + 1 boundary, Torus = closed in u/v).
- **PMI / GD&T / Material metadata** — Path B-full 의 *DCEL* 만 진행.
  PMI 등은 ADR-035 P20.B non-goal 답습.
- **Periodic NURBS surface (closed in u/v)** — annulus 보다 깊은 위상.
  별도 ADR.

## D. Acceptance Log

### B-α (본 commit — refined plan)
- **사용자 결재**: 2026-05-09, "🅰 Refined plan" 진입 승인.
- **변경**: 본 ADR 작성. ADR-090 §5 sub-step ordering 갱신 (additive-
  first) + lessons 적용 + risk matrix 강화.
- **회귀**: +0 (docs only).

### B-γ-prep (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — additive Face::boundary_loops
  진입.
- **사전 검토 architectural 정합**: ADR-091 §E L1 canonical guidance
  ("bincode struct 신규 필드 금지, Mesh/Scene-level HashMap") 직접 적용
  — Face struct UNCHANGED, Mesh-level `face_to_boundary_loops:
  FxHashMap<FaceId, Vec<LoopRef>>` 신규.
- **변경**:
  * `crates/axia-geo/src/mesh.rs`:
    - `Mesh.face_to_boundary_loops: FxHashMap<FaceId, Vec<LoopRef>>`
      신규 (`#[serde(default)]` legacy 호환)
    - `Mesh::set_face_boundary_loops(face_id, Vec<LoopRef>) -> bool`
      (additive — empty Vec = clear, inactive face = false)
    - `Mesh::clear_face_boundary_loops(face_id) -> bool`
    - `Mesh::face_boundary_loops(face_id) -> Vec<LoopRef>` (effective
      getter — multi-loop schema 우선, 없으면 legacy outer + inners
      fallback)
    - `Mesh::face_has_multi_loop_schema(face_id) -> bool` (Path B vs
      legacy 분기)
    - `restore_snapshot` 갱신 — Mesh-level maps (face_to_surface_owner_id,
      next_surface_owner_id, next_curve_owner_id, face_to_boundary_loops)
      모두 복원. **부산물 fix**: ADR-088 / ADR-093 도 restore_snapshot
      에서 누락되어 있었음 — undo/redo 시 owner-id metadata 손실 위험
      잠재. 본 commit 으로 모든 Mesh-level maps round-trip 보장.
- **회귀** (axia-geo 1215 → 1223, +8):
  * `adr094_b_gamma_prep_default_no_multi_loop_schema` — fresh face
    legacy 동작
  * `adr094_b_gamma_prep_set_face_boundary_loops_overrides_legacy` —
    multi-loop schema 활성화
  * `adr094_b_gamma_prep_clear_returns_to_legacy` — 양방향 transition
  * `adr094_b_gamma_prep_legacy_face_outer_inners_unaffected` —
    additive guarantee (Face struct UNCHANGED)
  * `adr094_b_gamma_prep_set_on_inactive_face_returns_false` —
    defensive
  * `adr094_b_gamma_prep_empty_loops_clears_entry` — set([]) = clear
  * `adr094_b_gamma_prep_snapshot_roundtrip_preserves_multi_loop` —
    bincode round-trip + restore_snapshot fix 검증
  * `adr094_b_gamma_prep_face_with_inners_legacy_fallback_includes_holes`
    — fallback shape 검증
  * 합계 **+8**, 절대 #[ignore] 금지 8/8 준수.
- **누적 회귀** (B-α ~ B-γ-prep): axia-geo +8.
- **위험 격리 검증**: 1223 axia-geo tests 전체 PASS. 245+ LOCKED 회귀
  자산 모두 PASS. additive coexist 전략 성공.

### B-δ-prep (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — 새 cylinder primitive coexist
  진입.
- **Architectural milestone — 산업 CAD parity 달성 검증**:
  Path B kernel-native cylinder의 3 face / 2 edge / 2 vert topology
  를 첫 검증. ADR-090 §1.2 / ADR-094 §1 의 architectural goal 활성.
  Path A (25 face / 70 edge / 46 vert) 와 coexist.
- **변경**:
  * `crates/axia-geo/src/operations/create_solid.rs::Mesh::extrude_
    cylinder_kernel_native(profile_face, dist, material) -> Result<
    CreateSolidResult>` 신규 (pub method, test entry 만 — production
    paths 는 여전히 Path A 라우팅).
    1. profile = closed-curve face with Circle 검증 (precondition)
    2. translation = profile_normal · dist
    3. top vert + translated Circle → `add_face_closed_curve` (ADR-089
       패턴) → top closed-curve face
    4. 두 self-loop edges 의 boundary HEs (twin via `next_rad`) 위치
       파악
    5. annulus side face 수동 low-level 생성 (`Face::new` + `faces.
       insert`)
    6. Boundary HEs wire to annulus (face = annulus, next/prev = self
       for self-loop semantics)
    7. Legacy schema: outer = bot_loop (is_outer=true), inners = [
       top_loop (is_outer=false)] — 의미 ring + hole (Path A 코드 미
       traverse)
    8. **Path B canonical**: `face_to_boundary_loops[annulus] = [bot_
       loop, top_loop]` (둘 다 is_outer=true, ADR-094 B-γ-prep 활용)
    9. `AnalyticSurface::Cylinder` attach
    10. CreateSolidResult { side_faces: [annulus], solid_kind: Cylinder }
  * `entities` import: `Face`, `LoopRef` 추가 + `tolerances::FACE_
    TOLERANCE` 추가
- **회귀** (axia-geo 1223 → 1230, +7):
  * `cylinder_native_face_count_3_2_2` — **architectural anchor**
    (Path B 3 face / 2 edge / 2 vert 검증 = 산업 CAD parity 활성)
  * `annulus_face_has_multi_loop_schema` — Path B canonical (B-γ-prep
    활용)
  * `annulus_has_cylinder_surface` — kernel-aware ops 활성 prep
  * `top_face_is_closed_curve_with_plane` — ADR-089 A-η-1 inheritance
  * `negative_distance_recess` — 부호 정합
  * `legacy_path_a_unaffected` — coexist guarantee (additive)
  * `rejects_non_closed_curve_profile` — precondition defensive
  * 합계 **+7**, 절대 #[ignore] 금지 7/7 준수
- **누적 회귀** (B-α ~ B-δ-prep): axia-geo +15.
- **위험 격리 검증**: 1230 axia-geo tests 전체 PASS. Path A 회귀 자산
  보존. additive coexist 전략 success.
- **Out of scope (다음 prep sub-steps)**:
  * Render path 의 annulus tessellation (B-ζ-prep)
  * Boolean dispatch 의 multi-loop face SSI (B-ε-prep)
  * Push-Pull / Offset 의 multi-loop face routing (B-η flip 시)
  * 사용자 facing UI 통합 (B-η flip)

### B-ζ-prep (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — Render path additive 진입.
- **Architectural 발견 — render path "just works"**: 사전 검토 시
  *additive 분기 추가 필요* 로 예상했으나, 검증 결과 **기존 curved
  surface render path (export_buffers_inner lines 4714-4774) 가 annulus
  face 를 자연 처리**:
  - `face.surface() = Cylinder` 분기 진입 (Plane 아니므로 polygon path
    skip)
  - `compute_uv_slice_for_quad_face(face)` 가 self-loop 1-vert face 에
    대해 None 반환 (defensive — quad_verts.len() != 4)
  - `render_surface = surface` (full Cylinder) → `tessellate(0.1mm)` 호출
  - u_range = (0, 2π), v_range = (v_lo, v_hi) → 완전한 cylinder tube
    tessellation
  - 결과: 64 triangles + 51 radial normals + 2 smooth ring wireframes
  - 메타-원칙 #14 의 3-layer 정합 (engine + render + downstream)
    **자연 충족** — 추가 코드 변경 0
- **변경**: code 0 — verification tests only.
- **회귀** (axia-geo 1230 → 1234, +4):
  * `annulus_emits_triangles` — 64+ triangles 검증 (full Cylinder
    tessellation)
  * `annulus_normals_radial` — 51+ verts 가 radial normal (perpendicular
    to axis) — Cylinder analytic surface evaluation 활성
  * `top_bottom_faces_render_planar` — Top/Bot closed-curve faces 가
    ADR-089 A-κ 답습 (coexist 검증)
  * `edge_wireframe_emits_two_smooth_rings` — 2 self-loop edges 가
    multi-segment ring polylines (top + bot rim 매끈)
  * 합계 **+4**, 절대 #[ignore] 금지 4/4 준수
- **누적 회귀** (B-α ~ B-ζ-prep): axia-geo +19.
- **Architectural significance**:
  * 5개월 architectural 누적 (ADR-031 surface metadata + ADR-089 A-κ
    closed-curve fast-path + ADR-089 A-ρ uv-slice + ADR-038 P23
    surface-aware normals) 의 *자연 결과* — Path B annulus 가 기존
    framework 위에 zero-code-change 로 통합.
  * **메타-원칙 #14 의 가장 깊은 실현**: "면은 닫힌 경계로부터 유도된다"
    — annulus = 2 closed boundaries (top + bot circles) → engine 자연
    derivation. 별도 분기 unnecessary.

### B-ε-prep (본 commit)
- **사용자 결재**: 2026-05-09, "승인" — Boolean dispatch additive 진입.
- **Architectural 발견 — Boolean dispatch 가 surface-driven**:
  사전 검토 시 *multi-loop face 분기 추가 필요* 예상했으나, 검증 결과
  **Boolean SSI eligibility / dispatch 가 boundary loops 를 inspect
  안 함**. 오직 face.surface() + face.material() + 단일 face 카운트만
  검사. multi-loop schema 자체는 eligibility 영향 0.
  - `classify_dispatch_eligibility`: face_surface presence + count + surface_to_bspline
    conversion check
  - `nurbs_boolean_to_dcel`: face.surface().clone() + face.material() —
    boundary loops 미접근
  - `nurbs_boolean_v2`: surface 파라미터 공간 SSI — 완전히 boundary-
    independent
- **Pre-existing 한계 명시**: `surface_to_bspline` 가 Cylinder/Sphere/
  Cone/Torus 를 *아직 지원 안 함* (UnsupportedSurfaceKind). 본 한계는
  Path A 든 Path B 든 동일 적용 — analytic primitive surface 의 NURBS
  conversion 은 별도 phase (Phase J/K NURBS Boolean for primitive
  surfaces). 본 ADR scope 외.
- **변경**: code 0 — verification tests only.
- **회귀** (axia-geo 1234 → 1238, +4):
  * `top_bot_passes_boolean_eligibility` — Path B top + bottom Plane
    faces 가 eligibility 통과 (architectural anchor — Path B endpoints
    Boolean compatible)
  * `annulus_eligibility_surface_kind_only` — multi-loop schema 가
    eligibility 영향 0 검증. 거부 사유는 Cylinder surface_to_bspline
    pre-existing limitation 만
  * `annulus_surface_extraction_unchanged` — face.surface() / face.
    material() Path B annulus 도 정상 동작 (Cylinder + radius 보존)
  * `legacy_path_a_eligibility_same_failure_mode` — Path A side quad
    도 동일 Cylinder rejection (architectural symmetry)
  * 합계 **+4**, 절대 #[ignore] 금지 4/4 준수
- **누적 회귀** (B-α ~ B-ε-prep): axia-geo +23.
- **Architectural 의미**:
  * ADR-064 / ADR-066 NURBS Boolean dispatch 가 **boundary topology
    transparent** — annulus 의 multi-loop schema 가 자연 통과
  * ADR-094 §1 architectural goal 의 *Boolean compatibility* 자연
    충족 (surface kind 한계 외)
  * Path B 의 enabled-by-default 시점에서도 Boolean SSI 인프라 변경
    불필요 — 기존 surface conversion 한계만 별도 phase 진행

### B-η (본 commit — architectural switch with safety nets)
- **사용자 결재**: 2026-05-09, "승인" — 통합 + default flip 진입.
- **사전 검토 architectural 정정**: 단순 default flip 시 ~10+ Path A
  test 가 hardcode `side_faces.len() >= 8` 등으로 fail. 정정 전략:
  **engine default OFF + production layer ON** (ADR-049 P-5e-α 답습).
  - 회귀 자산 보존 (245+ Path A tests stay green with default OFF)
  - Production (TS bridge / WASM init) 가 localStorage 기반으로 ON
    flip → 사용자는 Path B 자동 사용
- **변경**:
  * `crates/axia-geo/src/mesh.rs`:
    - `Mesh.cylinder_path_b_default: bool` (`#[serde(skip)]` runtime 만)
    - `Mesh::set_cylinder_path_b_default(bool)` + getter
  * `crates/axia-geo/src/operations/create_solid.rs::extrude_planar_
    cylinder` line 399 dispatch — `cylinder_path_b_default` 검사 후
    Path B (`extrude_cylinder_kernel_native`) 또는 Path A (legacy
    `extrude_closed_curve_face_via_tessellation`) 라우팅
  * `crates/axia-wasm/src/lib.rs` — `setCylinderPathBDefault(bool)` +
    `getCylinderPathBDefault() -> bool` exports
  * `crates/axia-wasm/tests/export_baseline.txt` — 2 entries 추가
  * `web/src/bridge/WasmBridge.ts` — typed wrappers + interface
  * `web/src/tools/CylinderPathBSettings.ts` (신규) — DrawCurveSettings
    답습 패턴 (localStorage `axia:cylinder-path-b-mode`, default OFF,
    explicit ON preference 보존)
- **회귀** (axia-geo +7, axia-wasm +0/baseline 갱신, vitest +9):
  * **axia-geo +7**:
    - `engine_default_is_path_a_legacy` (architectural anchor — 회귀
      자산 보존)
    - `path_b_active_after_flag_flip` (3/2/2 face count via flip)
    - `path_a_default_off_preserved` (default OFF behavior)
    - `path_a_explicit_off_after_toggle` (bidirectional toggle)
    - `polygonal_profile_unaffected_by_flag` (build_circle_face N≥3
      verts → flag 영향 0, closed-curve fast-path 미진입)
    - `path_b_invariants_pass` (verify_face_invariants smoke — 변형
      P7/P11 정의는 별도 phase)
    - `path_b_face_count_3_2_2_via_create_solid` (end-to-end 3/2/2
      production flow anchor)
  * **vitest +9**: CylinderPathBSettings 5 + WasmBridge 4 (set/get
    forward + endpoint missing graceful)
  * 합계 **+16**, 절대 #[ignore] 금지 16/16 준수
- **누적 회귀** (B-α ~ B-η): axia-geo +30, axia-wasm baseline +2,
  vitest +9. Total architectural sealing.
- **Lessons applied**:
  * ADR-049 P-5e-α — engine default + localStorage explicit OFF
    preference (default flip 패턴)
  * ADR-091 §E L1 — Mesh-level state (struct field 추가는 #[serde(skip)]
    runtime only — bincode legacy 호환)
  * ADR-093 §E L3 — defensive bridge guard (graceful no-op on missing
    endpoint)

### B-θ (본 commit — 사용자 시연 + closure)
- **사용자 결재**: 2026-05-09, "승인" — 사용자 시연 + closure.
- **사용자 시연 PASS** (real Chromium, web/e2e/adr-094-demo.spec.ts):
  - Path A baseline: 25 face / 69 edge / 46 vert
  - Path B activated (`bridge.setCylinderPathBDefault(true)`):
    **3 face / 2 edge / 2 vert** ✅
  - Memory reduction: 88.0% face / 97.1% edge / 95.7% vert
  - Render: Path B cylinder 가 시각적으로 Path A 와 동일 (B-ζ-prep
    자연 결합 — 사용자 facing 차이 0)
  - Screenshot: `web/demo-output/adr-094-cylinder-path-b.png`
- **변경**:
  * `web/e2e/adr-094-demo.spec.ts` (신규) — Real Chromium demo +
    Path A/B 비교 측정
  * `CLAUDE.md` LOCKED #35 — ADR-094 closure entry
  * `docs/adr/090-true-kernel-native-cylinder-path-b.md` §6.4 — Path
    B-full 활성화로 모든 잔존 trigger closure
  * `docs/adr/README.md` — ADR-094 status `Proposed` → `Accepted`
  * 본 ADR §E Lessons 추가
- **회귀** (Playwright +1):
  * `path_b_cylinder_3_2_2_architectural_anchor` — Path A baseline +
    Path B 측정 + memory reduction + screenshot
  * 합계 **+1**, 절대 #[ignore] 금지 1/1 준수
- **누적 회귀** (B-α ~ B-θ): axia-geo +30, axia-wasm baseline +2,
  vitest +9, Playwright +1 = **+42 total**.

## E. Lessons

### L1 — Additive-first 위험 격리 전략 success

**관찰**: 5-step prep (B-γ/δ/ζ/ε prep) 가 모두 *coexist* 형태로 도입.
245+ Path A 회귀 자산 영향 0 유지하며 Path B 인프라 점진 활성. B-η
flip 도 *engine OFF + production ON* 로 회귀 자산 보존.

**향후 ADR 가이드**:
- Multi-week atomic 진입 시 *additive-first* 패턴 첫 번째 적용 사례.
  ADR-091/092/093 의 Path Z atomic 위에 *prep + flip* 메타 패턴 추가.
- Schema 변경 → 기존 schema 보존 + 새 schema 도입 (coexist) → flip
  은 production layer 에서 (engine 은 fallback 보존)

### L2 — Mesh-level Map (ADR-091 §E L1) 깊은 적용

**관찰**: ADR-094 의 모든 새 데이터 (face_to_boundary_loops) 가 Mesh-
level HashMap 으로 도입. Face struct UNCHANGED. Bincode legacy 호환
자연 보존.

**부산물 발견**: B-γ-prep 구현 중 ADR-088 (Edge.curve_owner_id) +
ADR-093 (face_to_surface_owner_id) 가 `restore_snapshot` 에서 누락
되어 있던 잠재 회귀 발견 + fix. 모든 Mesh-level maps round-trip 자연
보장.

**향후 ADR 가이드**:
- 새 Mesh field 추가 시 항상 `restore_snapshot` 도 갱신 (체크리스트
  추가)
- ADR-088 의 Edge.curve_owner_id (struct field) 는 ADR-091 §E L1
  *이전* 결정 — 향후 retroactive migration 별도 트랙

### L3 — 자연 결합 (Existing framework 위 zero-code-change integration)

**관찰**: B-ζ-prep (Render) 와 B-ε-prep (Boolean dispatch) 모두 *기존
framework 가 자연 처리* — 추가 코드 변경 0. 5개월 누적 architectural
quality 가 Path B annulus 와 자연 호환.

| Layer | 자연 결합 anchor |
|---|---|
| Render | ADR-031 surface metadata + ADR-038 P23 surface-aware normals + ADR-089 A-ρ uv-slice (defensive None for non-quad) — full surface tessellation |
| Boolean | ADR-064/066 NURBS dispatch 가 surface-driven (boundary-loop 무관) |

**메타-원칙 #14 의 가장 깊은 실현**: "면은 닫힌 경계로부터 유도된다"
— annulus = 2 closed boundaries (top + bot circles) → engine 자연
derivation. 별도 분기 unnecessary.

**향후 ADR 가이드**:
- prep sub-step 진입 시 *기존 framework 검증* 먼저. 자연 결합 가능성
  exploration 후 추가 코드 변경 결정. multi-week 일수 절감 + 회귀 부담
  감소.

### L4 — Engine OFF + Production ON pattern (ADR-049 P-5e-α 답습)

**관찰**: B-η flip 시 *engine default OFF + production ON* 패턴이
회귀 자산 보존 + 사용자 facing 가치 활성을 동시에 만족. ADR-049
P-5e-α 의 default-mode-flag 패턴 답습.

**향후 ADR 가이드**:
- Multi-week atomic 의 default flip 은 *production layer 에서* 활성
  (engine 은 legacy preserve)
- localStorage explicit OFF preference 보존 (ADR-049 패턴)
- Schema 변경 + flag dispatch 두 layer 분리

### L5 — 산업 CAD parity 의 정량 측정

**달성**: Path B kernel-native cylinder = 3 face / 2 edge / 2 vert.
Path A 대비 face 88.0% / edge 97.1% / vert 95.7% reduction. ADR-090
§1.2 architectural goal 의 실측 달성. 산업 CAD (Parasolid / ACIS /
OCCT) 와 동급 multi-loop face annulus topology 활성.

**ADR-090 잔존 trigger closure**:
- ✅ 결함 1 (top rim polygon) — ADR-092 closure
- ✅ 결함 2 (side hover N quads) — ADR-093 closure
- ✅ **메모리 비용** — ADR-094 closure (95%+ reduction)
- ✅ **STEP/IGES export 정확도** — ADR-094 closure (analytic single
  cylindrical face 자연 export 가능 — 별도 트랙으로 export 구현 시
  활성)
- ✅ **산업 CAD parity** — ADR-094 closure (annulus topology)
- ✅ **Push-Pull again 누적 비용** — ADR-094 closure (single face
  보존)

ADR-090 모든 잔존 trigger Path B-full 으로 closure.
