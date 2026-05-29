# ADR-169 — Boundary-Routine Unification Audit (Phase 0)

**Status**: Accepted (γ closure 2026-05-29 — 5-step variant 6번째 reproducibility, β-1/β-2/β-3 audit closure)
**Date**: 2026-05-29 (α / β-1 / β-2 / β-3 / γ — same-day closure)
**Author**: WYKO + Claude
**Trigger**: 사용자 비전 (2026-05-29):
> "면생성 경계를 이루는 요소 : 라인, 도형의 모든 모서리, 꼭지점, 곡면의
> 에지 도형의 모든 요소. 면생성 경계를 이루는 요소로 면분할 됨.
> 입체도형의 각 면에 도형그리기. axia-sketch — '선만 그려, 케이크는
> 알아서 나뉜다' 처럼 우리엔진으로 루틴구성. 우리엔진으로는 불가능한
> 것인가? 이렇게 진행할때 계획을 세워줘"

**사용자 결재 (2026-05-29)**: "(D-Then-C) 추천으로 결재승인" — Audit
3-5일 (본 ADR) → Phase 1-4 본격 (6-8주, ADR-170~173).
**Audit precondition**: audit-first canonical **19번째 적용**. 5개월
누적 7+ ADR (ADR-101 P7 / ADR-139 Boundary tool / ADR-064/066 NURBS
Boolean DCEL / ADR-088 curve_owner_id / ADR-089 closed-curve face /
ADR-140 surface-aware getDrawPlane / ADR-166 plane lock / ADR-167
EPS_PLANE SSOT / ADR-168 face plane drift snap) 가 각자 영역만 해결 →
통합 routine 미정착 진단.

**Direct precursors**:
- ADR-139 (Boundary tool only, WHEN layer 신설 + 메타-원칙 #16) — WHAT
  layer (결과 invariant) 보존 anchor
- ADR-167/168 (plane SSOT + drift snap) — engine-side drift 해소 layer
- ADR-166 (active sketch plane session lock) — tool-side plane 결정
  routine
- ADR-140 (surface-aware getDrawPlane) — face plane priority dispatch
- LOCKED #43 priority sequence ALL CLOSED (LOCKED #67/68/69) — drift /
  SSOT / snap foundation complete

**Sprint scope**: Phase 0 (audit only, spec + 3 deliverable). Phase
1-4 본 audit closure 후 별도 ADR (170~173) 진입.

---

## Canonical anchor

사용자 비전 — **"선만 그려, 케이크는 알아서 나뉜다"** (axia-sketch
routine) 를 우리 엔진의 *canonical routine* 으로 정착. 메타-원칙 #14
(WHAT layer — 결과 invariant) 가 5개월간 명시 lock-in 되어 있었지만,
*routine layer* (HOW — "boundary element → DCEL emit face" 의 통일
처리) 는 fragmented.

본 ADR 은 **fragmented → unified** 의 architectural transition 의 sole
audit precondition. Phase 1-4 (ADR-170~173) 의 scope 정확화 deliverable.

---

## 1. Problem statement

### 1.1 사용자 시연 evidence 누적 (2026-05-29 morning)

PR #247 (ADR-166 soft lock hotfix) + PR #248 (DrawLineTool face plane
re-projection hotfix) 의 *trigger pattern* — 사용자가 입체면 위에
라인 그릴 때:

| 시연 시점 | 결함 | 즉시 해소 |
|---|---|---|
| 2026-05-29 morning #1 | "입체면에 라인을 생성할 수 없습니다" | PR #247 — ADR-166 strong lock → soft lock |
| 2026-05-29 morning #2 | `Point is 34704.8 from face plane (max 30346.1)` | PR #248 — DrawLineTool pre-project to face plane |
| 2026-05-29 morning #3 | `v1 and v2 are adjacent or equal — degenerate split` | **미해소** — DCEL split_face bail! site, drift + dedup root cause |

각 hotfix 는 *site-local* 해소이며, 다음 시연 trigger 가 계속 새 bail!
site 노출. **cascading hotfix pattern** = P5.UX.39-45 (ADR-139 trigger
source) 의 재현.

### 1.2 Architectural diagnosis (왜 통합 못하고 있는가)

```
사용자 클릭 (raw mouse, ε ~1px)
  ↓ raycaster ε (f32 → f64 변환, ~10μm drift)
ToolManager.getSnappedPoint / get3DPoint (snap + cardinal force LOCKED #63)
  ↓ ε ε 누적
Tool.firstClick → tryFaceSplit (각 도구 마다 다른 정규화)
  ↓ ε ε ε 누적 + face context 손실 가능
WasmBridge.splitFaceByLine (TS 경계, vertex 변환 시 ε 발생)
  ↓ ε ε ε ε 누적
engine.split_face_by_line (Rust — bail! "Point off plane" / "v1==v2")
  ↓ 실패 → 사용자 시연 결함
```

**근본 원인**: 각 layer 가 자기 ε 만 흡수, 다음 layer 로 *불완전한 입력*
을 throw. 통합된 single chokepoint 부재.

**axia-sketch 의 routine** (참조 reference):
1. Tool layer single chokepoint 가 모든 입력 정규화 (cardinal + project + 10mm short-circuit)
2. Engine 의 `vertex_at(pos, VERTEX_SNAP=0.1mm)` 가 silent dedup → 정확한 topology
3. `add_edge_with_intersections` 가 항상 succeed → DCEL 이 결과 emit
4. Plane is tool-context (F3/F4/F5 + X mesh hit) — face-derived 아닌 explicit
5. Edge Register pattern — "boundary 등록, DCEL 이 face emit"

우리 엔진의 자산은 다 있음, *통합* 만 없음:
- (1) → Tool layer 7 Draw 도구 가 각자 다른 routine
- (2) → LOCKED #5 spatial-hash 1.5μm dedup 존재, 하지만 split_face_by_line 내부 활용 부재
- (3) → ADR-101 auto_intersect / ADR-139 Boundary tool / ADR-148 face_split 가 각자 분기
- (4) → ADR-166 plane lock + ADR-140 surface-aware 통합 routine 미정착
- (5) → DCEL `add_face_with_holes` 존재, 하지만 boundary element queue 미통일

### 1.3 메타-원칙 정합

- **메타-원칙 #4 (SSOT)** — 5개월 누적 자산의 통합 routine SSOT 부재
- **메타-원칙 #5 (사용자 편의 — 명확하면 자동)** — 사용자 의도 (DrawLine
  on face = face split) 가 *명확*, 엔진이 robust 하게 자동 처리해야
- **메타-원칙 #6 (Preventive over Curative)** — cascading hotfix 패턴은
  *curative*, 통합 routine 정착이 *preventive*
- **메타-원칙 #14 (면은 닫힌 경계로부터 유도된다, WHAT layer)** — 결과
  invariant 보존 (변경 0), routine layer 정착은 메타-원칙 #14 의
  자연 *HOW* 실현
- **메타-원칙 #15 (동일 분할 = 동일 contract)** — split_face_by_line /
  split_face_by_chain / auto_intersect_coplanar / boundary_from_point
  의 동일 contract 강제 anchor
- **메타-원칙 #16 (WHEN layer)** — ADR-139 의 trigger 정책 (Boundary
  tool only) 보존, 본 ADR 은 *routine* (HOW) layer 만 통합

---

## 2. Solution architecture — D-Then-C (사용자 결재 2026-05-29)

### 2.1 결재 매트릭스 (lettered options)

| Option | 범위 | 기간 | 효과 | 채택 |
|---|---|---|---|---|
| (A) Tool-only normalization | 7 Draw 도구 pre-projection + vertex_at upstream + 10mm short-circuit | 1-2주 | ~80% | ❌ |
| (B) Tool + Engine routine unification | (A) + `split_face_by_line/chain` 내부 robustness layer | 3-4주 | ~95% | ❌ |
| **(C) Full architectural — Edge Register canonical** | (B) + DCEL "boundary element queue → emit face" canonical pipeline | 6-8주 | ~99% + 영구 회귀 차단 | ✅ |
| **(D) Audit-first canonical 19번째** | 본 ADR-169 — 3-5일 audit + 결재 → (C) 본격 | 3-5일 + 결재 | 정확도 확보 | ✅ |

**결재 결과**: **(D-Then-C)** — 본 ADR 가 audit, ADR-170~173 가 Phase 1-4
implementation.

### 2.2 Lock-in 매트릭스 (Q1~Q5 결재 default 5/5)

#### Q1=(a) — Audit scope: 6 boundary element type × full stack

**Lock-in**: 모든 boundary element type 통합 처리:

| Type | 예시 | 현재 split 참여? |
|---|---|---|
| Line | DrawLine 결과 edge | ✅ (`split_face_by_line`) |
| Polyline edge | RECT 4 edge, Polygon N edge | ⚠ (chain 으로 raster) |
| Arc / Circle edge | DrawCircle / DrawArc self-loop edge | ⚠ (ADR-089 closed-curve, partial) |
| Bezier / BSpline / NURBS edge | DrawBezier curve edge | ❌ (현재 split 미참여) |
| Vertex | Snap target, intersection point | ⚠ (LOCKED #5 spatial-hash dedup, but split 미참여) |
| Solid face edge | 사용자 선택 edge → Boundary input | ❌ (handoff routine 부재) |

**근거**:
- 사용자 비전 명시 6 type 모두 covered
- 부분 참여 (⚠) 는 unification 의 핵심 target
- 미참여 (❌) 는 새 routine 도입 필요

#### Q2=(a) — Phase 1 scope: Tool layer `normalizeDrawInput` helper

**Lock-in**: 7 Draw 도구 *동일* input normalization routine 호출.

```typescript
// ToolManager.ts (canonical SSOT)
public normalizeDrawInput(
  rawPoint: THREE.Vector3,
  context: { faceId?: number; sketchPlane?: Plane }
): NormalizedDrawInput {
  // 1. Cardinal force (LOCKED #63 z=0 invariant)
  // 2. Face plane projection (ADR-168 SSOT)
  // 3. Vertex_at silent dedup (LOCKED #5 1.5μm)
  // 4. 10mm short-circuit (axia-sketch pattern 1)
  // 5. Plane lock validation (ADR-166)
  return { point, vertId?, faceId?, plane, skipReason? };
}
```

#### Q3=(a) — Phase 2 scope: Engine `absorb_boundary_input` helper

**Lock-in**: `split_face_by_line` / `split_face_by_chain` / `auto_intersect_
coplanar` / `boundary_from_point` *동일* internal robustness layer.

```rust
// crates/axia-geo/src/operations/boundary_input.rs (신설)
pub fn absorb_boundary_input(
    mesh: &Mesh,
    input: BoundaryInput,
    face_id: FaceId,
) -> Result<NormalizedInput, AbsorbReason> {
    // 1. Drift projection (ADR-168 snap_face_to_plane SSOT)
    // 2. Vertex dedup via spatial hash (LOCKED #5)
    // 3. 10mm short-circuit (axia-sketch pattern 1, engine-side)
    // 4. TypedReason (DegenerateBelowEpsilon / DriftBeyondTolerance / VertexCollapse)
}
```

#### Q4=(a) — Phase 3 scope: Edge Register canonical

**Lock-in**: axia-sketch pattern 5 — *boundary element queue → DCEL emit
face* canonical pipeline.

```rust
pub enum BoundaryElement {
    Line { start: DVec3, end: DVec3 },
    Polyline { verts: Vec<DVec3> },
    Arc { center: DVec3, normal: DVec3, radius: f64, range: (f64, f64) },
    Bezier { control_pts: Vec<DVec3> },
    BSpline { control_pts: Vec<DVec3>, knots: Vec<f64>, degree: usize },
    NURBS { control_pts: Vec<DVec3>, weights: Vec<f64>, knots: Vec<f64>, degree: usize },
    Vertex { pos: DVec3 },
    FaceEdgeRef { edge_id: EdgeId },
}

impl Mesh {
    pub fn register_boundary_element(&mut self, elem: BoundaryElement) -> RegisterReport {
        // Internal:
        //   1. absorb_boundary_input (Phase 2)
        //   2. dedup + insert vertices
        //   3. split if intersects existing boundary
        //   4. emit face via Boundary tool trigger (ADR-139 정합)
    }
}
```

#### Q5=(a) — Phase 4 scope: User vision realization + 사용자 시연 게이트

**Lock-in**: 12 사용자 시연 scenario PASS = Phase 1-4 closure 강제.

---

## 3. Audit deliverables (β-1, β-2, β-3)

### 3.1 β-1 — Boundary element type matrix
**Output**: `docs/audits/2026-05-29-boundary-element-matrix.md`

| Boundary Type | Split-participate today? | 관련 bail! sites (Phase 0 3 agent audit 참조) | Tolerance source |
|---|---|---|---|

각 6 type 의 *현재 routine* + *target routine* + *gap* + *cross-cut bail!
sites*.

### 3.2 β-2 — Drift propagation chain matrix
**Output**: `docs/audits/2026-05-29-drift-propagation-chain.md`

ε 누적 매트릭스 — Mouse → SnapManager → ToolManager → Tool → WasmBridge →
Engine. 각 layer 의:
- ε 흡수 정책 (어떤 SSOT 사용 — LOCKED #5 / #63 / ADR-167 / ADR-168)
- ε 누적 위치 (LOCKED #67/68/69 cross-link)
- normalize 책임 (현재 분산 → target Tool layer 단일 chokepoint)

### 3.3 β-3 — 사용자 시연 evidence 12 scenario 매트릭스
**Output**: `docs/audits/2026-05-29-user-demo-evidence-matrix.md`

12 시나리오 = (DrawLine / RECT / CIRCLE / Bezier) × (평면 / 입체면 / 곡면).
real Chromium (Claude Preview MCP) 시연 → bail! frequency 통계 → root
cause 분류 (drift / dedup / validation / architectural).

| Scenario | bail! site | Root cause | Phase target |
|---|---|---|---|

---

## 4. Sub-step roadmap (5-step variant)

본 ADR-169 의 atomic 5-step (LOCKED #44 + LOCKED #67/68/69 답습):

- **α** (본 PR): spec only — 결재 anchor 확정
- **β-1**: Boundary element type matrix 작성 (3 agent Phase 0 audit 산출
  물 활용)
- **β-2**: Drift propagation chain matrix 작성
- **β-3**: 사용자 시연 evidence 12 scenario 매트릭스 (Claude Preview MCP)
- **γ**: audit summary + Phase 1-4 scope 정확화 + 사용자 결재 → Status
  Accepted + §9 Lessons + LOCKED entry candidate + README

**기간**: 3-5일 (5-step variant 6번째 reproducibility 검증).

---

## 5. Lock-ins (canonical for ADR-169 + Phase 1-4)

- **L-169-1** D-Then-C 결재 anchor (사용자 결재 2026-05-29) — Phase 1-4
  본격 진입 anchor
- **L-169-2** 6 boundary element type 통합 처리 (Line / Polyline / Arc-
  Circle / Bezier-BSpline-NURBS / Vertex / Solid face edge)
- **L-169-3** Tool layer single chokepoint — `ToolManager.normalize
  DrawInput` SSOT (Phase 1 / ADR-170)
- **L-169-4** Engine internal robustness — `absorb_boundary_input` SSOT
  (Phase 2 / ADR-171)
- **L-169-5** Edge Register canonical — `Mesh::register_boundary_element`
  (Phase 3 / ADR-172)
- **L-169-6** 12 시연 scenario PASS = Phase 4 closure 강제 (ADR-173)
- **L-169-7** 메타-원칙 #14 WHAT layer 보존 강제 — 결과 invariant 변경 0
- **L-169-8** 메타-원칙 #16 WHEN layer 보존 강제 — ADR-139 trigger
  정책 변경 0
- **L-169-9** ADR-046 P31 #4 additive only — public API surface UNCHANGED
- **L-169-10** Phase 0 3-agent audit 산출물 (475 bail! 분류 매트릭스)
  활용 — 새 audit 0
- **L-169-11** NURBS kernel (curves/ + surfaces/) silent-skip 금지 강제 —
  Phase 0 agent 3 finding 정합 (Piegl & Tiller precondition 보존)
- **L-169-12** 절대 #[ignore] 금지

---

## 6. Phase 1-4 ADR sequence (예고)

| Phase | ADR (가칭) | Title | 기간 | 예상 회귀 |
|---|---|---|---|---|
| 1 | ADR-170 | Tool layer `normalizeDrawInput` SSOT (7 Draw 도구 통합) | 1주 | +40 |
| 2 | ADR-171 | Engine `absorb_boundary_input` internal robustness | 2주 | +60 |
| 3 | ADR-172 | DCEL `register_boundary_element` Edge Register canonical | 2-3주 | +80 |
| 4 | ADR-173 | User vision realization + 12 시연 게이트 PASS | 1주 | +30 |
| **합계** | **4 ADRs** | | **6-8주** | **+200 ~ +300** |

각 ADR 는 본 ADR-169 의 audit 후 별도 결재 + 별도 atomic PR. LOCKED
#44 Complete Meaning per Merge 정합.

---

## 7. Cross-link

### 7.1 LOCKED 정책 정합
- **LOCKED #1** ADR-021 P7 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- **LOCKED #5** 1.5μm spatial-hash dedup — Phase 2/3 vertex dedup source
- **LOCKED #7** ADR-026 P12 cardinal SSOT — Phase 1 normalizeDrawInput
  Step 1
- **LOCKED #12** ADR-025 P11 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- **LOCKED #14** 메타-원칙 #14 (WHAT layer 불변) — 본 ADR 의 architectural
  precondition
- **LOCKED #15** P22.5 owner-ID uniformity — Phase 3 BoundaryElement::
  FaceEdgeRef handoff routine
- **LOCKED #16** ADR-038 P23 surface-aware normals — Phase 1 face context
  source
- **LOCKED #41** ADR-101 (SUPERSEDED by ADR-139, 결과 invariant 보존)
- **LOCKED #43** priority sequence (a)→(b)→(c) ALL CLOSED — 본 ADR 의
  foundation
- **LOCKED #44** Complete Meaning per Merge — 4-ADR sequence 분할 anchor
- **LOCKED #63** z=0 invariant — Phase 1 normalizeDrawInput Step 1
  (cardinal force)
- **LOCKED #66** STATUS-POLICY — 본 ADR Status field canonical
- **LOCKED #67** ADR-166 plane lock — Phase 1 normalizeDrawInput Step 5
- **LOCKED #68** ADR-167 EPS_PLANE SSOT — Phase 2 absorb_boundary_input
  Step 1
- **LOCKED #69** ADR-168 face plane drift snap — Phase 2 absorb_boundary_
  input Step 1

### 7.2 ADR 정합 (precursor + sibling)
- **ADR-064/066** NURBS Boolean DCEL — Phase 3 NURBS edge Boolean routing
- **ADR-088** curve_owner_id grouping — Phase 3 Arc/Circle/Bezier owner
- **ADR-089** Phase 2 closed-curve face — Phase 3 self-loop edge
  registration
- **ADR-101** Amendment 9 HARD flag — Phase 3 split-induced edge contract
- **ADR-139** Boundary tool only — 본 ADR 의 WHEN layer foundation
- **ADR-140** surface-aware getDrawPlane — Phase 1 face context
- **ADR-148** point-localized BoundaryTool — Phase 3 register API 자연 연장
- **ADR-149** T-junction sweep — Phase 3 boundary element 충돌 해소
- **ADR-150** Coplanar face merge — Phase 3 emit face post-processing
- **ADR-151** Connected stacked-inner — Phase 3 multi-loop face routing
- **ADR-166/167/168** plane management track — Phase 1/2 foundation

### 7.3 메타-원칙 정합
- **메타-원칙 #4 SSOT** — Phase 1 + Phase 2 + Phase 3 의 single chokepoint
  canonical
- **메타-원칙 #5** 사용자 편의 — 명확한 의도 (DrawLine on face) 자동 처리
- **메타-원칙 #6** Preventive over Curative — cascading hotfix 영구 차단
- **메타-원칙 #11** Latency Budget — Phase 2 absorb 가 16ms hover / 33ms
  click budget 보존
- **메타-원칙 #14** WHAT layer (결과 invariant) 불변 보존
- **메타-원칙 #15** 동일 분할 contract — Phase 2 SSOT 가 메타-원칙 #15
  의 deepest realization
- **메타-원칙 #16** WHEN layer (trigger 정책) 보존 — ADR-139 정합

### 7.4 axia-sketch 패턴 reference
- Pattern 1 (Tool 10mm short-circuit) → Phase 1 normalizeDrawInput Step 4
- Pattern 2 (vertex_at silent dedup) → Phase 2 absorb_boundary_input Step 2
- Pattern 3 (add_edge_with_intersections always succeeds) → Phase 3 register
  API canonical
- Pattern 4 (Plane is tool-context) → Phase 1 normalizeDrawInput Step 5
- Pattern 5 (Edge Register at DCEL) → Phase 3 register_boundary_element

본 ADR 은 axia-sketch *엔진* 도입이 아닌 *패턴* 만 적용 (사용자 결재
2026-05-29: "중요한것은 axia-sketch의 엔진을 따라 가는것이 아니라 방식을
우리엔진에 적용해서 에러를 없애자는 것입니다").

---

## 8. Out of scope (별도 ADR 또는 future)

- NURBS kernel `bail!` 변경 — Phase 0 agent 3 finding 정합, Piegl &
  Tiller precondition 보존 강제 (curves/ + surfaces/ 영역 영구 carve-out)
- STEP/IGES import 의 owner-ID Edge Register handoff — ADR-086 자연
  연장, 별도 ADR
- Boolean group routing 의 BoundaryElement::FaceEdgeRef 통합 — ADR-074
  자연 연장, 별도 ADR
- Snapshot section schema 변경 — Phase 3 RegisterReport 의 persistence
  는 future ADR
- Telemetry / audit trail — ADR-110 entity provenance 자연 연장, future

---

## 9. Acceptance Log

### 9.1 α (PR #249, merged 2026-05-29)
- spec 작성 + 결재 anchor 명시 (D-Then-C, 사용자 결재)
- 5-step roadmap (α / β-1 / β-2 / β-3 / γ)
- Lock-ins 12개 명시
- Phase 1-4 ADR sequence 예고

### 9.2 β-1 (PR #250, merged 2026-05-29)
- Boundary element type matrix → `docs/audits/2026-05-29-boundary-element-matrix.md` (~478 lines)
- 6 type × 4-column gap analysis: Line / Polyline / Arc-Circle / Bezier-NURBS / Vertex / Solid face edge
- 6 type 중 완전 작동 = 0개, 부분 작동 = 3개, 미참여 = 3개
- (C) Full architectural unification 결재 정합 확인
- Phase 1-4 회귀 자산 +240 추정 (refined)

### 9.3 β-2 (PR #251, merged 2026-05-29)
- Drift propagation chain matrix → `docs/audits/2026-05-29-drift-propagation-chain.md` (~465 lines)
- 11-Layer ε propagation: Mouse → Engine
- 11 layer 중 ε 흡수 = 8, 증폭 = 3 (Layer 7 Tool-specific 가장 큰 gap)
- 모든 SSOT 이미 존재, 위치만 분산 — Phase 1+2 통합 chokepoint 필요
- ε accumulation worst-case: stacked transform N=5 + non-cardinal = 110μm > strict 1.5μm → bail!

### 9.4 β-3 (PR #252, merged 2026-05-29)
- 사용자 시연 evidence 12 scenario → `docs/audits/2026-05-29-user-demo-evidence-matrix.md` (~430 lines)
- 12 scenario = 4 tool × 3 surface
- ★ Verified 3건 (S2 PR #248 anchor + cross-cut + ADR-168 closure)
- ⚙ Inferred 6건 (Phase 0 audit + β-1/β-2 cross-link)
- ⏸ Pending 3건 (S11 Phase 3 target + S6/S9/S12 future ADR)
- Root cause: drift 33% + dedup 8% + validation 33% + architectural 42%
- 75% = Phase 1+2 SSOT 통합 흡수

### 9.5 γ (본 PR)
- audit summary + Phase 1-4 scope 정확화 + 사용자 결재
- Status Proposed → Accepted
- §10 Lessons 9개 (canonical for future audit ADRs)
- LOCKED entry candidate (LOCKED #70 anchor)
- README catalog 갱신 (Proposed → Accepted)

---

## 10. Lessons (canonical for future audit ADRs)

본 ADR 의 audit-first canonical **19번째 적용** evidence. 5개월 누적
LOCKED #66 Audit-First Canonical 패턴의 architectural depth 측정 결과.

### L1 — Multi-deliverable audit 분할 패턴 (Path Z atomic 의 audit 변형)

ADR-169 은 single audit ADR 이 아닌 **5-step variant 6번째 reproducibility**
(ADR-152 / ADR-164 / ADR-166 / ADR-167 / ADR-168 의 6번째 답습) 의 audit
변형. α (spec) / β-1 (type matrix) / β-2 (drift chain) / β-3 (evidence)
/ γ (closure) 의 5-step 가 audit deliverable 의 **자연 분할**. 향후
multi-deliverable audit ADR 의 canonical 패턴.

### L2 — Cross-validation through independent deliverables

3 β deliverables 가 *독립* 진행 (별도 PR, 별도 perspective) → 모두 (C)
결재 정합 확인. 단일 audit deliverable 보다 **architectural confidence**
가 높음. β-1 (boundary type) ↔ β-2 (ε chain) ↔ β-3 (scenario evidence)
의 **3-axis triangulation** 패턴.

### L3 — Phase 0 3-agent audit 산출물의 architectural reuse

ADR 작성 직전 Phase 0 audit (mesh+face_split+create_solid 130 / operations
193 / curves+surfaces+scene 124 = 447 bail!) 가 본 ADR 의 *cross-cut
source* 로 100% 재사용. 향후 architectural ADR 진입 전 *bail! 분류 audit*
이 가장 효율적 sub-step. NURBS kernel carve-out (L-169-11) 도 본 audit
finding 에서 자연 도출 (Part 3 91/124 F-category).

### L4 — Audit-first canonical 의 self-applying pattern (ADR-131 답습)

본 ADR 자체가 audit-first canonical → audit ADR 도 자기 검증 적용
(메타-finding). ADR-131 의 audit ADR self-application 패턴 답습 — audit
ADR 가 *자신* 의 architectural reality 도 검증.

### L5 — 사용자 비전 → architectural ADR transition 패턴

사용자 비전 ("선만 그려, 케이크는 알아서 나뉜다") 가 Phase 0 audit 의
finding (cascading hotfix pattern PR #247/248 = P5.UX.39-45 reappear) 과
정합 → 본 ADR 의 architectural 정당화. 사용자 비전을 *직접 구현* 보다
*architectural transition 의 anchor* 로 활용하는 패턴 — 향후 사용자
비전 trigger 시 답습.

### L6 — D-Then-C 결재 패턴 (audit + multi-phase atomic)

사용자 결재 (D-Then-C) = audit 결재 + Phase 1-4 본격 결재 의 *분리*.
"audit 만으로는 implementation 결재가 아니다" 정합. 향후 multi-phase
atomic architectural ADR 진입 시 D-Then-X 패턴 답습 권장.

### L7 — SSOT 통합 시점의 architectural value 정량화

β-2 finding: 11 layer 중 7-8 SSOT 가 *이미 존재*, 위치만 분산. Phase
1+2 통합 의 architectural value = "**새 SSOT 도입 0, 기존 SSOT 위치
통합만**". 향후 SSOT 관련 ADR 진입 시 *기존 SSOT inventory* 가 audit
필수.

### L8 — 메타-원칙 #14 (WHAT) ↔ #16 (WHEN) 직교 분리 정합

본 ADR 은 *routine layer (HOW)* 정착. ADR-139 의 WHEN layer (Boundary
tool trigger 정책) 보존 + 메타-원칙 #14 의 WHAT layer (결과 invariant)
보존 — 두 메타-원칙의 *수직 hierarchy* 확인. 향후 architectural ADR 진입
시 WHAT/WHEN/HOW 3-axis 분리 권장.

### L9 — Phase 1-4 sequence atomic decomposition

Phase 1 (Tool layer) / Phase 2 (Engine routine) / Phase 3 (Edge Register)
/ Phase 4 (User vision) 의 *명확한 layer 분리*. 각 Phase = 별도 ADR =
LOCKED #44 Complete Meaning per Merge 정합. 사용자 시연 가치 누적
패턴 — Phase 1 alone (50%) → Phase 2 cumulative (75%) → Phase 3 (Type 4
Bezier, 90%) → Phase 4 (12 시연 PASS, full closure). 향후 multi-phase
ADR 진입 시 cumulative value chain 명시 권장.

---

## 11. LOCKED #70 candidate (사용자 결재 별도)

**Proposed LOCKED entry** (사용자 결재 후 CLAUDE.md 등재):

> **LOCKED #70 — ADR-169 Boundary-Routine Unification Audit closure
> (Phase 1-4 anchor)**
>
> Phase 0 audit (α + β-1 + β-2 + β-3 + γ) 완료. Phase 1-4 (ADR-170~173,
> 6-8주, +240 회귀) 의 sole architectural anchor.
>
> **불변 lock-in**:
> - 6 boundary element type 통합 처리 (Line / Polyline / Arc-Circle /
>   Bezier-NURBS / Vertex / Solid face edge)
> - 11 layer ε chain 통합 chokepoint (Phase 1 normalizeDrawInput +
>   Phase 2 absorb_boundary_input + Phase 3 register_boundary_element)
> - 12 시연 scenario (★ 3 verified + ⚙ 6 inferred + ⏸ 3 pending) 매트릭스
> - NURBS kernel silent-skip 금지 (curves/ + surfaces/ carve-out, L-169-11)
> - 메타-원칙 #14 WHAT + #16 WHEN layer 보존, Phase 1-4 는 HOW layer 만 변경
>
> **회귀 자산**: γ closure (본 ADR) 0, Phase 1-4 누적 +240 (Phase 1:
> +50, Phase 2: +70, Phase 3: +90, Phase 4: +30, 절대 #[ignore] 금지
> 240/240).

본 LOCKED entry 는 γ closure PR (본 PR) 의 별도 사용자 결재 후 CLAUDE.md
에 등재. ADR-169 자체는 본 PR 으로 closure.
