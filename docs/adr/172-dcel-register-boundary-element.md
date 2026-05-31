# ADR-172 — Phase 3 DCEL `register_boundary_element` Edge Register Canonical

**Status**: Accepted (γ closure 2026-05-31 — Pattern 12 finding "mechanism already exists" + demo-verified, register SSOT deferred)
**Date**: 2026-05-30 (α) ~ 2026-05-31 (β-1 / γ)
**Author**: WYKO + Claude
**Trigger**: ADR-171 γ closure (LOCKED #72) + 사용자 결재 "Phase 3 진입"
(2026-05-30). Phase 1-4 sequence 셋째 — 사용자 비전의 핵심.
**Audit precondition**: ADR-169 β-1/β-2/β-3 + ADR-171 β-2 finding 정합:
- β-1 boundary element type matrix — 6 type Edge Register canonical entry
- axia-sketch pattern 5 ("선만 등록, 면은 알아서") — Phase 3 본격 구현
- ADR-171 β-2 finding (Pattern 12) — 기존 DCEL 자산 inventory 우선
**Direct precursors**:
- **ADR-171** (Phase 2 Engine absorb SSOT, LOCKED #72) — Step 1 absorb 활용
- ADR-148 (point-localized BoundaryTool, ADR-139 §14) — face emission 자산
- ADR-139 (Boundary tool only, 메타-원칙 #16) — face emission 게이트 anchor
- ADR-101 (coplanar_intersection_segments) — edge crossing 검출 자산
- ADR-088 (curve_owner_id) — Arc/Bezier owner metadata

**Sprint scope**: Phase 3 of 4 (LOCKED #44 Complete Meaning per Merge).
ADR-173 (Phase 4) 별도 ADR + 별도 atomic PR.

---

## Canonical anchor

ADR-169 §2.2 Q4=(a) lock-in 의 실제 구현. axia-sketch pattern 5 —
*"boundary element 등록, DCEL 이 결과 emit"* — 의 우리 엔진 본격 구현.

**사용자 비전 (canonical, 2026-05-29)**:
> "선만 그려, 케이크는 알아서 나뉜다"

본 ADR 이 사용자 비전의 *핵심 mechanism*. 단 ADR-139 (메타-원칙 #16)
정합 — "케이크 나뉜다" (face emission) 는 *명시 Boundary trigger* (사용자
클릭), "선만 그려" (edge register) 는 깨끗한 위상 produce.

---

## 1. Problem statement

### 1.1 핵심 gap — `add_edge` 가 교차점에서 split 안 함 (audit finding)

현재 `Mesh::add_edge(v_start, v_end)` (mesh.rs:759):
```rust
pub fn add_edge(&mut self, v_start: VertId, v_end: VertId) -> Result<(EdgeId, bool)> {
    // existing edge 있으면 반환
    // 없으면 두 vertex 사이 단일 edge 생성
    // → 기존 edge 와의 교차점 무시 (split 안 함)
}
```

**문제**: 사용자가 기존 edge 를 *가로지르는* line 을 그리면:
- 단일 edge 가 기존 edge 를 geometric 으로 교차하지만
- 교차점에 vertex 가 없음 → 위상적으로 미연결
- → Boundary tool 의 cycle walk 가 교차점을 못 따라감
- → "선을 그려도 케이크가 안 나뉜다"

axia-sketch pattern 3 (`add_edge_with_intersections`): line 등록 시
기존 edge 와의 *모든 교차점에서 자동 split* → 위상 항상 manifold-correct.

### 1.2 기존 DCEL 자산 inventory (Pattern 12 — 강제 구현 전 audit)

| 자산 | 현재 capability | Phase 3 활용 |
|---|---|---|
| `add_edge` | 단일 edge, **교차 split 없음** | register 의 base |
| `add_edge_with_curve` (ADR-028) | curve attach | Arc/Bezier register |
| `split_edge` (mesh.rs) | 1 edge 를 2로 split at point | 교차점 split 의 primitive |
| `add_face` / `add_face_with_holes` | face emission | Boundary tool 자산 |
| `add_face_closed_curve` (ADR-089) | closed-curve self-loop face | Circle register |
| `boundary_from_point` (ADR-148) | click → enclosing cycle → face | **face emission SSOT (유지)** |
| `coplanar_intersection_segments` (ADR-101) | face-level edge crossing | edge crossing 검출 참조 |
| `find_existing_vertex` (ADR-171) | vertex dedup | register Step 2 |
| `absorb_boundary_input` (ADR-171) | 4-step absorb | register Step 1 |

→ **face emission 은 이미 robust** (boundary_from_point, ADR-148).
genuine gap = **edge intersection splitting** (add_edge_with_intersections
없음). Phase 3 의 핵심 = 이 gap 해소.

### 1.3 메타-원칙 정합

- **메타-원칙 #4 (SSOT)** — edge register single chokepoint
- **메타-원칙 #5 (사용자 편의 — 명확하면 자동)** — line 교차 = unambiguous
  geometric fact → split 자동 (heuristic 아님)
- **메타-원칙 #14 (WHAT layer — 면은 닫힌 경계로부터)** — 깨끗한 edge 위상이
  face derivation 의 precondition
- **메타-원칙 #15 (동일 분할 contract)** — 교차 split edge 에 HARD flag (ADR-101 A9)
- **메타-원칙 #16 (WHEN layer)** — *face emission* 자동화 금지 (ADR-139),
  단 *edge intersection split* 은 위상 correctness (heuristic 아님)

---

## 2. Solution architecture — `register_boundary_element` SSOT

### 2.1 register_boundary_element 5-step routine (canonical)

```rust
// crates/axia-geo/src/operations/boundary_input.rs (ADR-171 확장)

pub fn register_boundary_element(
    mesh: &mut Mesh,
    elem: BoundaryElement,
    target_plane: Option<Plane>,
) -> Result<RegisterReport, RegisterError> {
    // ─── Step 1: Absorb (ADR-171 Phase 2 SSOT) ───
    //   drift projection + dedup + short-circuit + typed AbsorbReason.
    let normalized = absorb_boundary_input(mesh, elem.to_input(), target_plane)?;

    // ─── Step 2: Register vertices (LOCKED #5 dedup) ───
    //   각 point → find_existing_vertex 또는 add_vertex.
    let verts = register_vertices(mesh, &normalized);

    // ─── Step 3: Intersection split (axia-sketch pattern 3) ───
    //   새 edge 가 기존 edge 와 교차 → 교차점에서 양쪽 split.
    //   위상 correctness (heuristic 아님, 메타-원칙 #5/#15).
    let crossings = detect_edge_crossings(mesh, &verts, target_plane);
    let split_verts = apply_crossing_splits(mesh, crossings);  // HARD flag (ADR-101 A9)

    // ─── Step 4: Register edges (sub-segments between crossings) ───
    //   교차점들로 나뉜 sub-segment 각각 add_edge + curve metadata (ADR-088).
    let edges = register_edges(mesh, &verts, &split_verts, &elem);

    // ─── Step 5: Face emission gate (ADR-139, 메타-원칙 #16) ───
    //   register 는 edge 만 등록. face emission 은 명시 Boundary trigger
    //   (boundary_from_point, ADR-148) 또는 single-explicit-op only.
    //   register_boundary_element 는 절대 자동 face emit 안 함.

    Ok(RegisterReport { verts, edges, split_count: crossings.len() })
}
```

### 2.2 핵심 design 결정 (사용자 결재 필요)

#### Q1 — Edge intersection split 정책 (★ 핵심 결재)

새 line 이 기존 edge 를 교차할 때 자동 split?

- **(a) 자동 split (추천)** — line 교차 = unambiguous geometric fact (두 선이
  *실제로* 교차). 교차점 split 은 *위상 correctness*, heuristic intent 추론
  아님. 메타-원칙 #5 ("명확하면 자동") 정합. ADR-139 (face synthesis 자동화
  금지) 는 *face* 레벨이지 *edge* 레벨 아님 → 위배 0. axia-sketch pattern 3 답습.
- (b) 명시 trigger gate — edge split 도 Boundary tool 시점에만. ADR-139
  메타-원칙 #16 strict 해석.
- (c) Hybrid — register 는 split 안 함, Boundary tool 이 face emission 시점에
  split. 현재 동작 유지 (보수적).

**추천 (a)** — 근거:
1. line 교차는 모호하지 않음 (geometric fact). 메타-원칙 #16 의 "automation
   cannot infer intent" 는 *모호한* 케이스 대상. 교차는 모호하지 않음.
2. ADR-139 가 supersede 한 3 정책 (P11 cycle face / P7 containment / ADR-101
   coplanar overlap) 은 모두 *face* emission 자동화. edge split 은 그 목록에 없음.
3. 위상 correctness — 교차점 미split 시 non-manifold-ish (edge 가 다른 edge
   interior 를 관통하지만 미연결). Boundary tool cycle walk 실패 원인.
4. 사용자 비전 "선만 그려, 케이크는 알아서" 의 "선만 그려" 부분 = 교차 자동 split.

#### Q2 — face emission gate (ADR-139 정합)

register_boundary_element 가 face 를 emit?

- **(a) 절대 안 함 (추천, ADR-139 정합)** — register 는 edge 만. face 는
  boundary_from_point (ADR-148 명시 클릭) 또는 single-explicit-op (DrawRect/
  Circle, ADR-139 Q2=a). register 는 "선만 그려" layer.
- (b) cycle 닫히면 emit — ADR-139 메타-원칙 #16 위배 (자동 face). 거부.

**추천 (a)** — ADR-139 (LOCKED #64) 직계 정합.

#### Q3 — BoundaryElement 6 type scope

- **(a) Line + Polyline 우선 (추천)** — Phase 3 β 는 Line/Polyline register +
  intersection split 본체. Arc/Bezier/NURBS/Vertex/FaceEdgeRef 는 후속 sub-step
  또는 future (β-1 type matrix 우선순위 답습).
- (b) 6 type 전부 — scope 과다, multi-week risk.

**추천 (a)** — Line/Polyline 이 "선만 그려" 의 80%.

#### Q4 — Read+Mutate (register 는 mutate)

- **(a) `&mut Mesh` (추천)** — register 는 vertex/edge 등록 = mutation.
  absorb (Step 1) 만 read-only (ADR-171). Pattern 8 정합 (mutate API = strict).

#### Q5 — Backward compat

- **(a) Additive (추천)** — 기존 add_edge / DrawLine 경로 보존. register 는
  새 SSOT entry. 점진 migration (DrawLineTool → register, 후속).

### 2.3 Lock-in 매트릭스 (Q1~Q5 결재 default 5/5 추천)

상기 Q1~Q5 모두 (a) 추천. 특히 **Q1 (a) 자동 edge split** 이 핵심 결재.

---

## 3. Sub-step roadmap (6-step variant — Engine + 검증, mutate API)

본 ADR-172 의 atomic 6-step (LOCKED #44 + ADR-149~151 답습 — engine mutate):

- **α** (본 PR): spec only — 결재 anchor 확정 (특히 Q1)
- **β-1**: `detect_edge_crossings` read-only helper (line vs 기존 edge 교차 검출) + 회귀
- **β-2**: `register_boundary_element` mutate API (5-step, Line/Polyline) + 회귀
- **β-3**: intersection split 본체 (`apply_crossing_splits`, HARD flag ADR-101 A9) + 회귀
- **β-4**: WASM bridge + TS wrapper (registerBoundaryElement) + 회귀
- **γ**: closure — Status Accepted + §9 Lessons + LOCKED entry + Playwright E2E
  (선 교차 → 자동 split → Boundary 클릭 → 면 시연)

**기간**: 2-3주 (6-step variant, 가장 architectural).

---

## 4. Lock-ins (canonical for ADR-172, 추천 default)

- **L-172-1** `register_boundary_element` SSOT (edge register single chokepoint)
- **L-172-2** Step 1 absorb (ADR-171 Phase 2 SSOT 활용)
- **L-172-3** **Q1=(a) 자동 edge intersection split** (위상 correctness,
  heuristic 아님 — 메타-원칙 #5/#15, ADR-139 위배 0)
- **L-172-4** **Q2=(a) face emission 절대 안 함** (ADR-139 정합 — face 는
  boundary_from_point/single-explicit-op only)
- **L-172-5** Q3=(a) Line/Polyline 우선 (Arc/Bezier/Vertex/FaceEdgeRef 후속)
- **L-172-6** split edge HARD flag (ADR-101 Amendment 9, 메타-원칙 #15)
- **L-172-7** curve metadata inherit (ADR-088 curve_owner_id, Arc/Bezier)
- **L-172-8** Read+Mutate (`&mut Mesh`, Pattern 8 strict)
- **L-172-9** Backward compat additive (add_edge / DrawLine 경로 보존)
- **L-172-10** NURBS kernel carve-out (curves/ + surfaces/ 미접촉, L-171-8 답습)
- **L-172-11** operations/boundary_input.rs 확장 (Pattern 7 B hybrid — mesh.rs split_edge 재사용)
- **L-172-12** 메타-원칙 #14 WHAT + #15 split contract + #16 WHEN 보존 강제
- **L-172-13** 절대 #[ignore] 금지

---

## 5. Phase target — 사용자 비전 mechanism

| 사용자 동작 | Phase 3 mechanism |
|---|---|
| 선 1개 그림 | register Step 1-4 → 깨끗한 edge 등록 |
| 선이 기존 선 가로지름 | Step 3 자동 split → 교차점 vertex + 4 sub-edge |
| 닫힌 영역 형성 | edge 위상 manifold-correct (cycle walk 가능) |
| Boundary tool 클릭 | boundary_from_point (ADR-148) → enclosing cycle → face emit |
| **결과** | **"선만 그려 (자동 split), 케이크는 알아서 (Boundary 클릭) 나뉜다"** |

→ ADR-139 정합 (face = 명시 trigger) + 사용자 비전 (선 교차 자동 위상).

---

## 6. Out of scope (Phase 4 + future)

- 12 시연 게이트 PASS — Phase 4 ADR-173
- Arc/Bezier/BSpline/NURBS BoundaryElement register — 후속 sub-step (Q3=a)
- Vertex / FaceEdgeRef BoundaryElement — future
- DrawLineTool → register migration (사용자 facing 전환) — Phase 4 또는 별도
- Auto face emission (cycle 닫히면 자동) — ADR-139 위배, 영구 금지
- NURBS kernel `bail!` 변경 — L-172-10 carve-out
- Boolean / Offset register 통합 — future

---

## 7. Cross-link

### LOCKED 정책 정합
- **LOCKED #1/12/41** (SUPERSEDED by ADR-139, face 자동화 — edge split 은 별개)
- **LOCKED #5** spatial-hash 1.5μm (Step 2 vertex dedup)
- **LOCKED #15** P22.5 + 메타-원칙 #15 split contract (Step 3 HARD flag)
- **LOCKED #41** ADR-101 Amendment 9 HARD flag (split edge contract)
- **LOCKED #44** Complete Meaning per Merge (6-step variant)
- **LOCKED #63** z=0 invariant (Step 1 absorb)
- **LOCKED #64** ADR-139 Boundary tool only (face emission gate, L-172-4)
- **LOCKED #66** STATUS-POLICY
- **LOCKED #68/69** ADR-167/168 (Step 1 absorb drift)
- **LOCKED #70** ADR-169 Phase 1-4 anchor
- **LOCKED #71** ADR-170 Phase 1 closure
- **LOCKED #72** ADR-171 Phase 2 closure (Step 1 absorb SSOT, direct precursor)

### ADR cross-link
- ADR-088 curve_owner_id (Step 4 curve metadata)
- ADR-089 closed-curve face (Circle register, future)
- ADR-101 coplanar_intersection_segments (edge crossing 검출 참조) + Amendment 9 HARD
- ADR-139 Boundary tool only (face emission gate anchor, 메타-원칙 #16)
- ADR-148 boundary_from_point (face emission SSOT — 유지)
- ADR-167/168 (Step 1 absorb)
- ADR-169 Phase 0 audit (sole precondition)
- ADR-170/171 Phase 1/2 (Step 1 chain)
- ADR-173 (Phase 4 sibling, separate)
- ADR-027/028/029/030 NURBS Kernel (L-172-10 carve-out)

### Sprint atomic patterns
- Pattern 7 B hybrid (boundary_input.rs 확장 — mesh.rs split_edge 재사용)
- Pattern 8 Read-only (absorb) vs Mutate (register)
- Pattern 12 engine already-robust finding (face emission 이미 robust, edge split 만 gap)
- 6-step variant (ADR-149~151 답습 — engine mutate + WASM + 검증)

### 메타-원칙
- #4 SSOT / #5 사용자 편의 (교차 자동 split) / #6 Preventive
- #14 WHAT (면은 닫힌 경계로부터) / #15 split contract / #16 WHEN (face gate)

### axia-sketch 패턴
- Pattern 3 (add_edge_with_intersections always succeeds) → 본 ADR Step 3
- Pattern 5 (Edge Register at DCEL) → 본 ADR register_boundary_element

---

## 8. Acceptance Log

### 8.1 α (PR #267, merged 2026-05-30)
- spec only — register_boundary_element 5-step + Q1~Q5 (Q1 자동 split 결재)
- L-172-1 ~ L-172-13 Lock-ins + 6-step roadmap

### 8.2 β-1 (PR #268, merged 2026-05-31)
- **Pattern 12 finding (decisive)**: 사용자 비전 mechanism (edge crossing-
  split) 이 *이미* DrawLine 경로에 완전 구현 + battle-tested
  (`find_line_crossings` + `exec_draw_line` 파이프라인).
- α premise ("add_edge 가 교차 split 안 함") 은 *low-level primitive* 만
  본 것 — *high-level DrawLine 경로* 는 이미 crossing-split.
- 회귀 자산 **+1** (adr172_beta1_two_crossing_drawlines_auto_split —
  2 crossing DrawLine → 5 verts + manifold)

### 8.3 β-2 / β-3 / β-4 (DEFERRED — Pattern 12 finding 정합)
- **register_boundary_element 신규 SSOT 보류** — β-1 finding + γ demo 로
  mechanism 이 *이미 완전 작동* 확인. 신규 SSOT 는 scene.rs 파이프라인
  *중복* 위험 (battle-tested 회귀 자산 위협). genuine value 부재.
- SSOT consolidation (scene.rs → axia-geo 재사용 API) 은 *non-DrawLine
  caller (MCP/import) 의 실제 trigger* 발생 시 future ADR (현재 DrawLine
  만 필요).

### 8.4 γ (본 PR)
- **Demo verification (Claude Preview MCP, 2026-05-31, 사용자 결재 A)**:
  실제 브라우저에서 사용자 비전 end-to-end 증명:
  * 2 crossing DrawLine → 5 verts (교차점 자동 생성) ✅
  * 4 DrawLine 닫힌 사각형 → 1 face 자동 합성 ✅
  * **사각형 가로지르는 선 1개 → 1 face → 2 faces ("케이크가 나뉘었다")** ✅
- 결정적 회귀 자산 **+1** (adr172_gamma_line_across_face_splits_into_two —
  사각형 + 가로선 → 2 faces, demo-verified lock-in)
- Status Accepted + §9 Lessons + LOCKED #73 candidate + README

**회귀 누적 (Phase 3 실측)**: β-1 +1 + γ +1 = **+2** (axia-core).
estimate +90 vs 실측 +2 — **Pattern 12 (mechanism already exists)** 로
genuine 구현 work 부재. Phase 3 의 architectural value 는 "사용자 비전이
이미 완전 작동 + demo 증명 + 회귀 lock-in" 으로 달성.

---

## 9. Lessons (canonical for future audit-first phase ADRs)

### L1 — Mechanism-already-exists finding (Pattern 12 deepest 적용)

β-1 진입 audit 가 사용자 비전 mechanism (edge crossing-split) 이 *이미
완전 구현 + battle-tested* 발견. ADR-171 β-2 (3/4 already-robust) 의
*더 강한* 형태 — 여기선 *전체 mechanism* 이 이미 작동. spec premise 가
low-level primitive (add_edge) 만 보고 high-level 경로 (exec_draw_line)
의 기존 capability 를 놓침. **향후 SSOT/feature ADR 진입 시 high-level
호출 경로의 기존 동작 inventory 필수**.

### L2 — Demo verification 의 architectural 가치 (ADR-087 K-ζ canonical)

회귀 test (β-1) 는 mechanism 작동을 증명하지만, **실제 브라우저 demo**
(Claude Preview MCP) 가 사용자 비전 end-to-end 를 결정적으로 증명. "사각형
가로선 → 2 faces" 는 test + demo 양쪽으로 lock-in. ADR-087 K-ζ (사용자 시연
게이트) 의 가치 재확인 — test 만으로는 "사용자가 보는 결과" 미증명.

### L3 — 신규 SSOT 보류의 architectural correctness (truth over completion)

α spec 이 register_boundary_element 신규 SSOT 제안했으나 finding 후 보류.
*억지 구현* 은 battle-tested scene.rs 파이프라인 중복 → 회귀 위협 + value
부재. ADR-171 L2 (truth over estimate) + ADR-125 (audit pivot, 부정 결정
명시) 답습. **mechanism 이 작동하면 SSOT 강제 통합 금지** — non-caller
trigger 발생 시 future.

### L4 — estimate +90 vs 실측 +2 (Pattern 12 정량 evidence)

Phase 3 estimate +90 (가장 큰 phase) vs 실측 +2. mechanism 이 이미 작동
하므로 genuine work 부재. **estimate 는 spec premise 기반 — audit finding
이 premise 를 무효화하면 실측 대폭 축소 정상** (LOCKED #44 Complete Meaning
— 의미 단위가 회귀 count 보다 우선).

### L5 — Phase 4 자연 통합 (12 시연 게이트)

Phase 3 demo (2 crossing line / square+cross → 2 faces) 가 Phase 4 (ADR-173,
12 시연 게이트) 와 자연 overlap. Phase 4 는 본 demo 를 확장 (12 scenario
full sweep). Phase 3 closure → Phase 4 entry 자연 transition.

---

## 10. LOCKED #73 candidate (사용자 결재 별도)

**Proposed LOCKED entry** (사용자 결재 후 CLAUDE.md 등재):

> **LOCKED #73 — ADR-172 Phase 3 closure (Edge crossing-split mechanism
> already exists + demo-verified)**
>
> Phase 3 (α + β-1 + γ) closure. ADR-169 Phase 1-4 sequence 셋째.
>
> **불변 lock-in**:
> - **Pattern 12 finding**: 사용자 비전 mechanism ("선만 그려, 케이크는
>   알아서 나뉜다") 이 *이미* DrawLine 경로 (exec_draw_line + find_line_
>   crossings + split_edge + mark_edge_hard) 에 완전 구현 + battle-tested
> - register_boundary_element 신규 SSOT **보류** (mechanism 작동 — scene.rs
>   파이프라인 중복 금지). SSOT consolidation 은 non-DrawLine caller
>   (MCP/import) trigger 시 future ADR
> - Demo-verified (Claude Preview MCP): 2 crossing line → 5 verts /
>   square + cross line → 2 faces
> - 결정적 회귀: adr172_beta1_two_crossing_drawlines_auto_split +
>   adr172_gamma_line_across_face_splits_into_two
> - 메타-원칙 #5 (명확한 교차 자동 split) + #14 (면은 닫힌 경계로부터) +
>   #16 (face emission gate — ADR-139 정합)
>
> **회귀 자산**: +2 (axia-core, 절대 #[ignore] 금지 2/2). estimate +90 vs
> 실측 +2 (Pattern 12 — mechanism already exists).

본 LOCKED entry 는 γ closure PR (본 PR) 의 별도 사용자 결재 후 CLAUDE.md
등재.
