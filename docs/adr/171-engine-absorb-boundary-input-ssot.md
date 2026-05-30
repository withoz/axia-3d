# ADR-171 — Phase 2 Engine `absorb_boundary_input` SSOT

**Status**: Accepted (γ closure 2026-05-30 — 5-step variant 8번째 reproducibility, β-2 architectural finding "3/4 already-robust")
**Date**: 2026-05-30 (α / β-1 / β-2 / γ — same-day closure)
**Author**: WYKO + Claude
**Trigger**: ADR-170 γ closure (LOCKED #71) + 사용자 결재 "Phase 2 진입
승인" (2026-05-30). Phase 1-4 sequence 둘째.
**Audit precondition**: ADR-169 β-1/β-2/β-3 cross-validation 정합:
- β-1 boundary element type matrix — 6 type × Engine entry 통일 필요
- β-2 drift propagation chain — **Layer 10 Engine entry** 가 secondary gap
  (Tool 외 경로 MCP/import/script/내부호출 의 ε 흡수 부재)
- β-3 user demo evidence — Phase 1 (50% scenarios) → **Phase 1+2 (75%
  cumulative)** — drift 33% + dedup 8% root cause 흡수
**Direct precursors**:
- **ADR-170** (Phase 1 Tool layer SSOT, LOCKED #71) — Tool 경로 ✅, 본 ADR
  은 *Tool 외 모든 경로* 의 이중 방어
- ADR-168 (face plane drift snap, LOCKED #69) — Step 1 SSOT (drift projection)
- ADR-167 (EPS_PLANE SSOT, LOCKED #68) — Step 1 detection
- LOCKED #5 (1.5μm spatial-hash) — Step 2 vertex dedup
- ADR-101 Amendment 9 (split-induced HARD flag, 메타-원칙 #15) — Step 4 contract

**Sprint scope**: Phase 2 of 4 (LOCKED #44 Complete Meaning per Merge).
ADR-172/173 별도 ADR + 별도 atomic PR.

---

## Canonical anchor

ADR-169 §2.2 Q3=(a) lock-in 의 실제 구현. `split_face_by_line` /
`split_face_by_chain` / `auto_intersect_coplanar` / `boundary_from_point`
*4 함수* 가 동일 **engine-internal robustness SSOT** =
`absorb_boundary_input`.

**사용자 정책 (canonical, 2026-05-30)**:
> "중요한 것은 Silent-skip 정책이 아니다. 엔진이 안정적이고 효율적이고
> 빠르게 작동하면서 원하는 표면적 구현을 하는것이 정책이다."

→ `absorb_boundary_input` 는 *입력 거부* (silent-skip) 가 아니라 **입력
robust 흡수 후 원하는 표면 produce**:
- Drift → projection 으로 **고침** (거부 안 함)
- Dedup → silent 통합 (정확한 topology produce)
- Degenerate (10mm 미만) → typed `AbsorbReason` (bail! 아닌 graceful)

---

## 1. Problem statement

### 1.1 β-2 Layer 10 Engine entry secondary gap (canonical finding)

ADR-169 β-2 §2.10 Layer 10 finding:
> `face_split.rs:1803` 의 plane distance check 는 LOCKED #68 (1.5μm
> detection) 보다 약 1000× loose (face bbox diagonal ~ mm 단위) → drift
> 누적 시나리오에서 실패 (PR #248 trigger).

Phase 1 (ADR-170) 가 **Tool 경로** 의 입력 정규화 ✅. 그러나 Engine 함수
는 *여러 경로* 에서 호출:

| 호출 경로 | Phase 1 검문소 통과? | drift 흡수? |
|---|---|---|
| 사용자 Tool 클릭 | ✅ (ADR-170 normalizeDrawInput) | ✅ |
| **MCP API** (AI agent) | ❌ (Tool layer 우회) | ❌ |
| **STEP/IGES import** | ❌ (import 경로 직접) | ❌ |
| **자동화 스크립트** | ❌ | ❌ |
| **엔진 내부 함수 호출** (split → auto_intersect 등) | ❌ | ❌ |

→ **Engine entry 가 마지막 방어선**. Phase 2 가 `absorb_boundary_input`
SSOT 로 *모든 경로* 의 ε 흡수.

### 1.2 cross-cut bail! sites (Phase 2 흡수 대상, β-1 §3 정합)

| bail! site | 함수 | 흡수 방법 |
|---|---|---|
| `face_split.rs:1803` "Point off face plane" | split_face_by_line | Step 1 drift projection |
| `mesh.rs:4671` "v1 v2 adjacent" | split_face_by_line (내부 split_face) | Step 2 dedup-aware split decision |
| `face_split.rs:283` "line length <ε" | split_face_by_line | Step 3 10mm short-circuit |
| `face_split.rs:418` "Both split points same vertex" | split_face_by_line | Step 2 vertex collapse |
| `coplanar.rs:137/146` "faces not coplanar" | auto_intersect_coplanar | Step 1 face plane unification |
| `face_split.rs:574` "chain needs ≥2 verts" | split_face_by_chain | Step 3 degenerate skip |
| `boundary.rs:128` "PointNotOnPlane" | boundary_from_point | Step 1 drift projection |

→ **7+ bail sites 단일 SSOT 흡수**. user-trigger ~95% 해소 (β-3 75%
cumulative target).

### 1.3 메타-원칙 정합

- **메타-원칙 #4 (SSOT)** — 4 함수 × N 입력 정규화 → Engine single chokepoint
- **메타-원칙 #5 (사용자 편의)** — 명확한 의도 robust 자동 처리
- **메타-원칙 #6 (Preventive over Curative)** — PR #248 hotfix pattern 영구 차단
- **메타-원칙 #11 (Latency Budget First)** — absorb 가 33ms click / 100ms commit
  budget 보존 강제 (마이크로초 단위 helper)
- **메타-원칙 #14 (WHAT layer)** — 결과 invariant 변경 0
- **메타-원칙 #15 (동일 분할 contract)** — 4 split 함수 *동일* contract 강제
  = 본 ADR 의 deepest realization
- **메타-원칙 #16 (WHEN layer)** — ADR-139 trigger 정책 변경 0

---

## 2. Solution architecture — `absorb_boundary_input` SSOT

### 2.1 BoundaryInput enum (multi-type 입력 흡수)

4 함수의 서로 다른 입력 타입 (DVec3 point / VertId chain / FaceId pair)
을 단일 enum 으로 통일:

```rust
// crates/axia-geo/src/operations/boundary_input.rs (신설 — Pattern 7 B hybrid)

/// ADR-171 — Boundary input variants for absorb_boundary_input SSOT.
pub enum BoundaryInput {
    /// Line split — 2 endpoint (split_face_by_line).
    Line { start: DVec3, end: DVec3 },
    /// Chain split — N vertex path (split_face_by_chain).
    Chain { verts: Vec<DVec3> },
    /// Coplanar pair — 2 face overlap (auto_intersect_coplanar).
    CoplanarPair { face_a: FaceId, face_b: FaceId },
    /// Boundary point — 1 click point + plane (boundary_from_point).
    Point { point: DVec3, plane: Plane },
}

/// ADR-171 — Typed absorb result (graceful, NOT bail!).
pub enum AbsorbReason {
    /// Input below epsilon (10mm short-circuit) — Step 3.
    DegenerateBelowEpsilon { length: f64 },
    /// Drift beyond face bbox tolerance — Step 1 (after projection failure).
    DriftBeyondTolerance { distance: f64 },
    /// 2 endpoints collapsed to same vertex (Step 2 dedup).
    VertexCollapse { vert_id: VertId },
    /// Faces not coplanar (Step 1, auto_intersect only).
    NotCoplanar { normal_dot: f64 },
}

/// ADR-171 — Normalized boundary input (after absorb 4-step).
pub struct NormalizedBoundaryInput {
    /// Drift-projected, dedup-applied input.
    pub input: BoundaryInput,
    /// Existing vertex IDs matched (LOCKED #5 dedup), parallel to input verts.
    pub matched_verts: Vec<Option<VertId>>,
}
```

### 2.2 absorb_boundary_input 4-step routine (canonical)

```rust
pub fn absorb_boundary_input(
    mesh: &Mesh,
    input: BoundaryInput,
    face_id: Option<FaceId>,
) -> Result<NormalizedBoundaryInput, AbsorbReason> {
    // ─── Step 1: Drift projection (LOCKED #68/69 ADR-167/168) ───
    //   face_id 가 있으면 모든 point 를 face analytic plane 으로 projection.
    //   PLANE_SNAP_OFFSET (1e-4 mm) strict snap.
    let projected = if let Some(fid) = face_id {
        project_input_to_face_plane(mesh, &input, fid)?  // NotCoplanar / DriftBeyondTolerance
    } else {
        input
    };

    // ─── Step 2: Vertex dedup (LOCKED #5 1.5μm spatial-hash) ───
    //   각 point 를 mesh 의 기존 vertex 와 spatial-hash 비교.
    let matched_verts = dedup_input_verts(mesh, &projected);
    //   2 endpoints 가 같은 vertex 로 collapse → VertexCollapse.
    if let Some(reason) = detect_vertex_collapse(&projected, &matched_verts) {
        return Err(reason);
    }

    // ─── Step 3: 10mm short-circuit (axia-sketch pattern 1) ───
    if let Some(len) = input_length(&projected) {
        if len < MIN_BOUNDARY_LENGTH_MM {
            return Err(AbsorbReason::DegenerateBelowEpsilon { length: len });
        }
    }

    // ─── Step 4: split-induced HARD flag prep (ADR-101 A9, 메타-원칙 #15) ───
    //   (실제 HARD flag 부여는 caller 의 split 후 — 본 helper 는 read-only)

    Ok(NormalizedBoundaryInput { input: projected, matched_verts })
}
```

**Read-only 강제** (Pattern 8): `absorb_boundary_input` 은 `&Mesh`
(non-mutable) — 순수 helper. Mutation (split / face emit) 은 caller 책임.
→ 4 함수가 absorb 후 자기 mutation 진행.

### 2.3 Lock-in 매트릭스 (Q1~Q5 결재 default 5/5)

#### Q1=(a) — SSOT scope: 4 함수 (split_line / split_chain / coplanar / boundary_point)

**Lock-in**: `split_face_by_line` / `split_face_by_chain` /
`auto_intersect_coplanar` / `boundary_from_point` 모두 absorb_boundary_input
호출. β-2 §6 cross-cut sites 정합.

#### Q2=(a) — 4-step routine canonical (drift / dedup / short-circuit / HARD prep)

**Lock-in**: Step 1 drift projection (LOCKED #68/69) / Step 2 vertex dedup
(LOCKED #5) / Step 3 10mm short-circuit / Step 4 HARD flag prep (ADR-101 A9).

#### Q3=(a) — `AbsorbReason` typed envelope (bail! 아닌 graceful)

**Lock-in**: bail! 대신 `Result<NormalizedBoundaryInput, AbsorbReason>`.
caller 가 AbsorbReason 받으면 graceful no-op (또는 Toast routing) — 사용자
정책 "엔진 robust 흡수" 정합. **NURBS kernel carve-out (L-169-11)** — curves/
+ surfaces/ 의 Piegl & Tiller bail! 은 절대 변경 안 함.

#### Q4=(a) — Read-only helper (`&Mesh`, Pattern 8 정합)

**Lock-in**: absorb_boundary_input 은 non-mutable `&Mesh`. Mutation 은 caller.
순수 helper → testable + cyclic 의존 회피 (Pattern 7 B hybrid).

#### Q5=(a) — Backward compat additive (LOCKED #44 정합)

**Lock-in**: 4 함수의 기존 signature UNCHANGED. absorb 는 함수 *내부 첫 단계*
로 추가 (additive). 기존 회귀 자산 (axia-geo 1400+ tests) 보존 강제.

---

## 3. Sub-step roadmap (5-step variant)

본 ADR-171 의 atomic 5-step (LOCKED #44 + ADR-152 답습 — Engine + 검증,
UI 없음):

- **α** (본 PR): spec only — 결재 anchor 확정
- **β-1**: `operations/boundary_input.rs` 신설 (BoundaryInput + AbsorbReason +
  NormalizedBoundaryInput + absorb_boundary_input pure helper + 4-step) + 회귀
- **β-2**: 4 함수 call site 통합 (split_face_by_line / split_face_by_chain /
  auto_intersect_coplanar / boundary_from_point 각각 absorb 첫 단계 추가) + 회귀
- **β-3**: WASM telemetry export (AbsorbReason 통계, ADR-168 SnapMetricsAggregate
  답습 opt-in) + regression sweep (cargo full) + 회귀
- **γ**: closure — Status Accepted + §9 Lessons + LOCKED entry candidate +
  README + Playwright E2E (MCP/import 경로 absorb evidence)

**기간**: 2주 (5-step variant 8번째 reproducibility 검증).

---

## 4. Lock-ins (canonical for ADR-171)

- **L-171-1** Engine single chokepoint SSOT (`absorb_boundary_input`)
- **L-171-2** 4-step routine canonical (drift / dedup / short-circuit / HARD prep)
- **L-171-3** `AbsorbReason` typed envelope (bail! 아닌 graceful)
- **L-171-4** LOCKED #5/68/69 + ADR-101 A9 SSOT consume (새 SSOT 도입 0)
- **L-171-5** 4 함수 통합 (split_line / split_chain / coplanar / boundary_point)
- **L-171-6** Read-only helper (`&Mesh`, Pattern 8 — cyclic 의존 회피)
- **L-171-7** Backward compat additive — 4 함수 signature UNCHANGED
- **L-171-8** NURBS kernel carve-out (L-169-11) — curves/ + surfaces/ bail! 불변
- **L-171-9** operations/boundary_input.rs 신설 (Pattern 7 B hybrid — mesh.rs 추가 0)
- **L-171-10** 메타-원칙 #14 WHAT + #15 split contract + #16 WHEN 보존 강제
- **L-171-11** 절대 #[ignore] 금지

---

## 5. Phase target — β-3 user demo evidence

| Scenario | Phase 1 (ADR-170) | Phase 2 (본 ADR) cumulative |
|---|---|---|
| S2 DrawLine × 입체면 (사용자 Tool) | ✅ Step 2 face projection | ✅ (Engine 이중 방어) |
| S3 DrawLine × 곡면 | ⚠ partial | ✅ Step 1 curve-aware drift absorb |
| **MCP draw_line on face** | ❌ Tool 우회 | ✅ **Engine absorb** |
| **STEP import + split** | ❌ import 직접 | ✅ **Engine absorb** |
| S5 RECT × 입체면 | ⚠ | ✅ Step 1+2 |
| S8 CIRCLE × 입체면 | ⚠ | ✅ Step 1+2 |

**Phase 1+2 cumulative cover**: 75% scenarios (β-3 finding). drift 33% +
dedup 8% root cause 모든 경로 흡수.

---

## 6. Out of scope (Phase 3-4 + future)

- DCEL `register_boundary_element` Edge Register — Phase 3 ADR-172
- 12 시연 게이트 PASS — Phase 4 ADR-173
- AbsorbReason 의 사용자 Toast routing 완전 통합 — γ partial, Phase 3 본격
- Curved surface 위 2D primitive (S6/S9/S12) — future ADR
- **NURBS kernel `bail!` 변경 — L-169-11 carve-out (curves/ + surfaces/ 영구 보존)**
- Boolean group routing absorb — ADR-074 자연 연장, future

---

## 7. Cross-link

### LOCKED 정책 정합
- **LOCKED #5** spatial-hash 1.5μm — Step 2 (vertex dedup)
- **LOCKED #7** ADR-026 P12 cardinal — Step 1 (defense layer 3)
- **LOCKED #14** 메타-원칙 #14 (WHAT layer 보존)
- **LOCKED #15** P22.5 owner-ID + 메타-원칙 #15 split contract — Step 4 HARD prep
- **LOCKED #16** 메타-원칙 #16 (WHEN layer 보존)
- **LOCKED #41** ADR-101 (SUPERSEDED by ADR-139, 결과 invariant 보존) — Step 4 Amendment 9
- **LOCKED #43** priority sequence ALL CLOSED (foundation)
- **LOCKED #44** Complete Meaning per Merge — 5-step variant 정합
- **LOCKED #63** z=0 invariant — Step 1 (cardinal force)
- **LOCKED #66** STATUS-POLICY — Status field canonical
- **LOCKED #68** ADR-167 EPS_PLANE — Step 1 (detection)
- **LOCKED #69** ADR-168 PLANE_SNAP — Step 1 (correction)
- **LOCKED #70** ADR-169 Phase 1-4 anchor
- **LOCKED #71** ADR-170 Phase 1 closure — 직계 precursor

### ADR cross-link
- ADR-101 Amendment 9 HARD flag (Step 4)
- ADR-139 Boundary tool only (WHEN layer)
- ADR-167 EPS_PLANE SSOT (Step 1 detection)
- ADR-168 face plane drift snap (Step 1 correction + SnapMetricsAggregate telemetry)
- ADR-169 Phase 0 audit (sole precondition)
- ADR-170 Phase 1 Tool layer SSOT (직계 precursor)
- ADR-172/173 (Phase 3-4 sibling, separate)
- ADR-027/028/029/030 NURBS Kernel (L-171-8 carve-out 강제)

### Sprint atomic patterns
- Pattern 7 B hybrid (operations/boundary_input.rs 신설 — mesh.rs 추가 0)
- Pattern 8 Read-only vs Mutate (absorb = read-only `&Mesh`)
- 5-step variant (ADR-152 답습 — Engine + 검증, UI 없음)

### 메타-원칙
- #4 SSOT / #5 사용자 편의 / #6 Preventive / #11 Latency Budget
- #14 WHAT / #15 split contract / #16 WHEN

---

## 8. Acceptance Log

### 8.1 α (PR #262, merged 2026-05-30)
- spec only — 4-step routine canonical 명시
- Q1~Q5 lock-in default 5/5
- L-171-1 ~ L-171-11 Lock-ins
- 5-step roadmap (α/β-1/β-2/β-3/γ) — 8번째 reproducibility

### 8.2 β-1 (PR #263, merged 2026-05-30)
- operations/boundary_input.rs 신설 + absorb_boundary_input pure helper
- BoundaryInput enum + AbsorbReason + NormalizedBoundaryInput + check_coplanar
- mesh.rs find_existing_vertex 읽기 accessor (read-only mirror)
- 회귀 자산 **+16** (axia-geo 1518 → 1534, 4-step × variant 입력 타입)

### 8.3 β-2 (PR #264, merged 2026-05-30)
- **Architectural finding (audit-first canonical)**: 4 함수 중 3/4 가
  *이미* absorb 패턴 내장 (intentional per-function tolerances). genuine
  gap = boundary_from_point 1개.
- boundary_from_point absorb 통합 (drift projection — PointNotOnPlane
  hard-reject → robust 흡수)
- split_face_by_line / auto_intersect_coplanar 의 기존 absorb 패턴 lock-in
- 회귀 자산 **+3** (axia-geo 1534 → 1537, boundary +2 + face_split finding +1)
- **estimate +30 vs 실측 +3** — audit 가 already-robust 발견 (truth over estimate)

### 8.4 β-3 (FOLDED into γ — β-2 finding 정합)
- **WASM telemetry export 보류** — β-2 finding (3/4 already-robust) 으로
  telemetry 가치 저하. 통합된 함수 1개 (boundary_from_point) 는 기존
  boundary 회귀로 충분 cover. SnapMetricsAggregate-style 계측은 future
  (실측 trigger 시).
- regression sweep (cargo full 1537/1537) 은 β-2 에서 완료.

### 8.5 γ (본 PR)
- closure docs — Status Accepted + §9 Lessons (architectural finding canonical)
  + LOCKED #72 candidate + README
- Playwright E2E **defer** — boundary_from_point 통합은 cargo 회귀로 충분
  cover (E2E 의 MCP/import path absorb 는 future, Phase 3 register API 와
  함께 자연 통합)
- 회귀 자산 +0 (docs closure)

**합계 실측**: **+19 회귀** (β-1 +16 + β-2 +3, axia-geo 1518 → 1537).
estimate +70 vs 실측 +19 — β-2 architectural finding (3/4 already-robust)
으로 genuine 통합 work 축소. Phase 2 의 architectural value 는 "엔진이
이미 robust 했다 + boundary_from_point gap 해소 + SSOT 인프라 (boundary_
input.rs) 확보" 로 달성.

---

## 9. Lessons (canonical for future audit-first engine ADRs)

### L1 — Engine already-robust finding (audit-first canonical, Pattern 3)

β-2 진입 audit 결과: 4 함수 중 3/4 가 이미 per-function absorb 패턴 내장.
genuine gap 은 boundary_from_point 1개. **엔진이 spec 가정보다 robust**.
이건 ADR-116 γ verification finding / ADR-125 audit pivot 답습 —
**"test/integration 진입 시 architectural reality 가 spec 가정과 다름"**
canonical 패턴. 향후 engine SSOT ADR 진입 시 *기존 함수의 ad-hoc 패턴
inventory* 가 β 진입 전 audit 필수.

### L2 — Truth over estimate (회귀 count 정직)

β-2 estimate +30 vs 실측 +3. audit finding 으로 genuine work 축소 →
*억지로 부풀리지 않음*. ADR-116 L2 ("test failure → architectural finding
documentation") 답습. 회귀 count 는 *진실* 이 estimate 보다 우선 (LOCKED
#66 audit-first canonical).

### L3 — Intentional per-function tolerance 보존 (강제 SSOT 금지)

auto_intersect_coplanar 의 COPLANARITY_OFFSET_TOL (1.5e-6) 은 ADR-101
LOCKED #41 의 의도적 strict 값. absorb 의 PLANE_SNAP_OFFSET (1e-4) 로
강제 통합 시 loosen → LOCKED #41 위반. **SSOT 통합은 tolerance alignment
가 안전할 때만** — 강제 통합 금지. 향후 SSOT ADR 가이드.

### L4 — Genuine gap = hard-reject 함수만 (graceful 은 이미 absorb)

3/4 함수가 graceful no-op (Ok(None) / Step 0 projection) 으로 *이미*
absorb 패턴. boundary_from_point 만 hard-reject (PointNotOnPlane). **"거부
하는 함수" 가 genuine absorb target, "graceful 한 함수" 는 이미 robust**.
향후 engine robustness audit 의 분류 기준.

### L5 — SSOT 인프라 확보의 독립 가치 (boundary_input.rs)

β-1 의 operations/boundary_input.rs 는 통합 함수 수와 무관하게 *인프라*
로서 가치 — 향후 새 boundary 함수 (Phase 3 register_boundary_element) 가
즉시 활용. SSOT 모듈의 가치는 "현재 caller 수" 가 아닌 "canonical 패턴
확립". ADR-167 EPS_PLANE SSOT 답습.

### L6 — Phase 2 의 실질 완결 (β-3 fold)

β-2 finding 으로 Phase 2 의 genuine work 가 β-2 에서 사실상 완결 →
β-3 (telemetry) fold into γ. **estimate 의 sub-step 수는 고정 아님** —
audit finding 에 따라 자연 축소 가능 (LOCKED #44 Complete Meaning —
의미 단위가 sub-step 수보다 우선).

---

## 10. LOCKED #72 candidate (사용자 결재 별도)

**Proposed LOCKED entry** (사용자 결재 후 CLAUDE.md 등재):

> **LOCKED #72 — ADR-171 Phase 2 closure (Engine absorb SSOT + already-robust finding)**
>
> Phase 2 (α + β-1 + β-2 + γ) closure. ADR-169 Phase 1-4 sequence 둘째.
>
> **불변 lock-in**:
> - operations/boundary_input.rs SSOT (BoundaryInput / AbsorbReason /
>   absorb_boundary_input 4-step pure helper)
> - boundary_from_point drift absorb (PointNotOnPlane hard-reject →
>   projection 흡수, 1.5μm~1mm drift gap 해소)
> - **architectural finding**: 3/4 함수 (split_face_by_line / auto_intersect_
>   coplanar / split_face_by_chain) 이미 per-function absorb 패턴 내장 —
>   강제 SSOT 통합 금지 (auto_intersect 의 1.5e-6 strict tolerance =
>   ADR-101 LOCKED #41 보존)
> - NURBS kernel carve-out (curves/ + surfaces/ 미접촉, L-171-8)
> - 메타-원칙 #14 WHAT + #15 split contract + #16 WHEN 보존
>
> **회귀 자산**: +19 (β-1 +16 + β-2 +3, axia-geo 1518 → 1537, 절대
> #[ignore] 금지 19/19).

본 LOCKED entry 는 γ closure PR (본 PR) 의 별도 사용자 결재 후 CLAUDE.md
등재.
