# ADR-088 — Curve Owner ID Grouping for Analytic Curve Edges (Phase 1)

**Status**: **Accepted + Closed** (S-α ~ S-ε 모두 완료, 2026-05-08).
ADR-089 (Phase 2: true kernel-native closed edges) 후속 트랙.
**Date**: 2026-05-08
**Author**: AXiA team (사용자 통찰 + Claude spec)
**Anchor**: 사용자 통찰 (2026-05-08, ADR-087 K-η closure 직후):
> "Option B: DrawCircle → single-edge curve representation 으로 진행해야
> 원칙입니다. 추후 문제점을 없애는 방법입니다."
**Parent**: ADR-019 (Line is Truth), ADR-027 (NURBS Kernel), ADR-028
(Edge curve attach), ADR-037 (P22 Pick → Promote owner ID), ADR-087
(Kernel-Native Command Suite Reset closure)
**Cross-cut**: 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다")

---

## 0. Summary (8 lines)

> ADR-037 LOCKED #15 (P22.5) 의 canonical 정책: "Edge.curve = Some(...)
> 인 edge 의 N segments 모두 동일 EdgeId 로 promote." 현재 DrawCircle
> 은 N 개 분리된 EdgeId 로 segments 생성 → SelectTool 클릭 시 1개만
> 선택. 사용자 시연 (2026-05-08) 회귀.
>
> 본 ADR Phase 1 은 **DCEL surgery 없이** Edge 에 `curve_owner_id:
> Option<u32>` 필드 추가 (additive). 같은 curve 의 N segments 가 동일
> owner_id 공유 → SelectTool walk 가 grouping 으로 통일 선택. ADR-089
> Phase 2 (true kernel-native closed edges, multi-week DCEL surgery)
> 의 사전 단계.

---

## 1. Background

### 1.1 사용자 보고 (2026-05-08)

DrawCircle 후 SelectTool 클릭 시 1개 segment 만 빨갛게 highlight,
나머지 23 segments 는 검은색. 사용자 의도: 한 클릭으로 원 전체 선택.

### 1.2 Canonical 정책 (LOCKED #15 P22.5)

> "분석적 곡선 균일 promotion: Edge.curve = Some(...) 인 edge 의 N
> segments 모두 동일 EdgeId 로 promote. 회귀 테스트로 강제."

### 1.3 현재 구현 vs canonical

- **현재**: `exec_draw_circle` 가 N 개 `DrawLine` segments 로 분해. 각
  segment 가 별개 EdgeId + 별개 `AnalyticCurve::Arc` attach (ADR-028).
- **canonical 의도**: 한 logical curve = 단일 selection unit.
- **mismatch**: DCEL representation (N edges) 와 logical curve (1
  circle) 의 layer 충돌.

### 1.4 Architectural 제약 (DCEL)

- `Edge` schema: `v_small < v_large` canonical 정렬, self-loop 미지원
  (`v_small != v_large` 강제)
- `add_face_with_holes`: ≥3 verts 강제
- → True self-loop closed edge (1 vertex, 1 self-edge) 는 DCEL surgery
  필요 (ADR-089 Phase 2 영역)

### 1.5 Phase 1 vs Phase 2

| Phase | 접근 | 회귀 | DCEL surgery |
|-------|------|------|------|
| **Phase 1** (본 ADR-088) | Edge 에 `curve_owner_id` 필드 추가, selection-layer grouping | +5~8 | 0 |
| Phase 2 (ADR-089, future) | DCEL Edge schema relaxation (self-loop 허용), add_face curve loops | +30~50 multi-week | 깊은 surgery |

Phase 1 만으로 사용자 facing 문제 (segment selection) 즉시 해결 + Phase
2 의 사전 인프라.

---

## 2. Decision

### 2.1 P-1 (canonical) — Edge curve_owner_id grouping

> Edge 에 optional `curve_owner_id: Option<u32>` 필드 추가. 같은
> logical curve (Circle/Arc/Bezier/BSpline/NURBS) 의 N segments 가
> 동일 owner_id 공유. SelectTool 의 pick 결과는 owner_id 기준으로
> grouping promote — 한 segment 클릭 = curve 전체 선택.

### 2.2 5 lock-in 원칙

- **L1**: Additive only — Edge 기존 필드 (v_small, v_large, curve, ...)
  UNCHANGED. DCEL topology 무변화.
- **L2**: Mesh 가 monotonic counter (`next_curve_owner_id: u32`) 관리.
  새 group 시 increment.
- **L3**: DrawCircle/Arc/Bezier/BSpline 의 N segments 모두 같은 owner_id
  부여 (creation 시점 결정).
- **L4**: SelectTool: pick edge → owner_id 가 None 이면 단일 EdgeId
  선택 (현 동작). owner_id 가 Some(id) 이면 같은 id 모든 edges 선택.
- **L5**: 시각적 highlight: SelectionManager 가 curve owner group 모든
  edges 동시 highlight. Render path 무변화.

### 2.3 LOCKED 정책 정합

- **LOCKED #15 (P22.5) strict 준수** — N segments 동일 owner 로 promote
- **LOCKED #1 (P7) / #12 (P11)**: Face 합성 / 분할 회귀 자산 영향 0
  (DCEL topology 무변화)
- **LOCKED #16 (P23 surface tessellation)**: Edge curve metadata 무변화
- **LOCKED #26 (Two-Layer Citizenship)**: Shape ↔ Xia 시민권 무영향
- **메타-원칙 #14 (canonical)**: "면은 닫힌 경계로부터 유도된다" — Edge
  curve 의 owner grouping 은 boundary 의 logical 통일성 강화.

---

## 3. Approach — Path Z atomic 5-step

### 3.1 Step roadmap

| Step | Title | 핵심 변경 | 회귀 (예상) | Risk |
|------|-------|----------|----------|------|
| **S-α** | Spec only (본 commit) | ADR-088 본문 작성 | +0 | 0 |
| **S-β** | Edge schema + Mesh counter | `curve_owner_id` 필드 + monotonic counter API | +3 | 낮음 |
| **S-γ** | DrawCircle/Arc/Bezier owner_id assignment | `exec_draw_circle` 등 N segments 동일 owner_id 부여 | +3 | 낮음 |
| **S-δ** | WASM + TS bridge query + SelectTool walk | `getEdgeCurveOwnerId` export + SelectTool group walk | +4 | 중간 |
| **S-ε** | 사용자 시연 + 회귀 closure | LOCKED #15 P22.5 회귀 자산 + 시연 게이트 | +0 | 낮음 |

**누적 회귀 예상**: **+10** (절대 #[ignore] 금지 10/10).

### 3.2 사용자 결재 시점

- S-α 진입 결재 (✅ 본 commit)
- S-β/γ/δ/ε 별 결재 (Path Z atomic)

---

## 4. Lock-ins (S-α 시점)

- **L-α-1** Edge 의 `curve_owner_id` 는 optional `Option<u32>` —
  None 은 단일 segment (legacy) 의미.
- **L-α-2** `Mesh::next_curve_owner_id` monotonic counter — overflow 시
  panic (u32::MAX = 4 billion groups, 실용상 미발생).
- **L-α-3** DCEL topology 무변화 — `add_face_with_holes` 등 기존 API
  무영향.
- **L-α-4** Selection-layer grouping — SelectTool / SelectionManager
  변경. 다른 tools (SelectFace, SelectVertex, GroupTool) 영향 없음.
- **L-α-5** `serde(default)` 로 legacy snapshot 호환 — 기존 `.axia`
  파일 load 시 owner_id = None 자동.

---

## 5. Non-goals (S-α 시점)

- **N-1** True kernel-native closed edges (self-loop) — ADR-089 Phase 2.
- **N-2** Edge.curve 자체 변경 — owner_id 는 *grouping* 만. curve
  metadata 는 ADR-028 그대로.
- **N-3** Face boundary 변경 — face_outer 의 edge sequence 무변화.
- **N-4** Render layer 변경 — 시각적 wireframe 은 K-η chord soft 로
  이미 매끈 (별도 visual fix).
- **N-5** Other selection types (SelectFace, SelectVertex) — 본 ADR
  은 Edge selection 에 한정.
- **N-6** Multi-curve grouping (e.g., 두 원이 같은 sketch 의) — 단일
  curve 의 N segments 만 grouping, 더 큰 그룹은 ADR-053 Phase 3 (Sketch
  시민권).

---

## 6. Acceptance criteria (S-α 시점)

본 commit (S-α) 가 만족해야:
- ✅ `docs/adr/088-curve-owner-id-grouping.md` 신설 (본 파일).
- ✅ §1 Background / §2 Decision / §3 Approach / §4 Lock-ins / §5
  Non-goals / §6 Acceptance criteria 명시.
- ✅ 5-step roadmap (S-α ~ S-ε) 의 각 step 별 회귀 / risk 추정.
- ✅ ADR-019 + LOCKED #15 + 메타-원칙 #14 cross-link.
- ✅ Phase 2 (ADR-089) 와의 영역 분리 명시.
- ✅ Code 변경 0 — spec only.

---

## §D Acceptance Log

### S-α (2026-05-08, commit `6bc16e6`)
- **사용자 결재**: "네 승인합니다."
- **변경**: `docs/adr/088-curve-owner-id-grouping.md` (본 파일) 신설.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.
- **Bundle 영향**: 0 (TS/Rust 변경 0).

### S-β (2026-05-08, commit `d3aa9ae`)
- **사용자 결재**: "네 승인합니다."
- **변경**:
  - `crates/axia-geo/src/entities/edge.rs`: `curve_owner_id: Option<u32>`
    필드 + `#[serde(default)]` + getter/setter
  - `crates/axia-geo/src/mesh.rs`: `next_curve_owner_id: u32` counter +
    4 impl methods (`next_curve_owner_id`, `set_edge_curve_owner_id`,
    `edge_curve_owner_id`, `edges_by_curve_owner`)
- **회귀**: +3 (axia-geo)
  - `adr088_edge_default_curve_owner_id_is_none` (L1 default)
  - `adr088_mesh_counter_monotonic_unique` (L2 monotonic)
  - `adr088_edges_by_curve_owner_groups_correctly` (cross-group isolation)
- **Legacy 호환**: `#[serde(default)]` 양 필드 → 기존 `.axia` 파일 load 시
  None / 0 자동.

### S-γ (2026-05-08, commit `535ce4e`)
- **사용자 결재**: "승인 합니다."
- **변경 (4 creator sites)**:
  - `Scene::exec_draw_circle`: N segments owner_id 부여 (Arc curve attach 후)
  - `WasmBridge::draw_arc_with_curve`: Sub-arc segments owner_id 부여
  - `WasmBridge::draw_bezier_with_curve`: Bezier segments owner_id 부여
  - `WasmBridge::draw_bspline_with_curve`: B-spline segments owner_id 부여
- **회귀**: +3 (axia-core)
  - `adr088_s_gamma_draw_circle_segments_share_owner_id` (16 → 1 owner)
  - `adr088_s_gamma_draw_circle_as_shape_segments_share_owner_id`
    (AsShape delegate)
  - `adr088_s_gamma_two_circles_get_distinct_owner_ids` (cross-leak 차단)
- **DrawCircleAsShape / DrawLineAsShape** 는 `exec_draw_circle` 등으로
  delegate → 자동 owner_id 부여.

### S-δ (2026-05-08, commit `2fbf0c2`)
- **사용자 결재**: "승인합니다."
- **변경 (4 layers)**:
  - WASM: `getEdgeCurveOwnerId` / `getEdgesByCurveOwner` 2 새 export
  - export_baseline.txt: 2 새 entries
  - TS bridge: `WasmBridge.getEdgeCurveOwnerId(eid)` / `getEdgesByCurveOwner(id)`
  - `SelectTool::onMouseDown` single-click 분기에 curve_owner_id walk:
    * ownerId >= 0 + groupEdges.length > 1 → group 전체 선택
      (첫 edge: caller modifiers, 나머지: shift=true additive)
    * ownerId < 0 또는 stale group → 단일 edge fallback (legacy 보존)
- **회귀**: +4 (vitest, SelectTool S-δ describe block)
- **기존 테스트 mock 업데이트** (3 files): SelectTool / SegmentVsCurveSelection
  / HoverPickPromote — bridge mock 에 default `getEdgeCurveOwnerId: -1` /
  `getEdgesByCurveOwner: []` 추가.
- **사용자 facing**: DrawCircle 한 segment 클릭 → 전체 원 highlight ✅
  LOCKED #15 P22.5 canonical 준수.

### S-ε (2026-05-08, 본 commit) — Closure
- **사용자 결재**: "승인합니다."
- **변경**: 본 ADR §D Acceptance Log 최종 갱신 + Status closure.
- **회귀**: +0 (docs only).

---

## §E ADR-088 누적 회귀 (S-α ~ S-ε 합산)

| Suite | S-α 시작 전 | S-ε closure |
|-------|------------|-------------|
| axia-core | 193 | **196** (+3) |
| axia-geo | 1107 | **1110** (+3) |
| axia-wasm | 34 | 34 (baseline +1 line) |
| vitest | 1618 | **1622** (+4) |
| **Total** | 2952 | **2962** (+10) |

**절대 #[ignore] 금지 10/10 준수**.

---

## §F Lessons (S-α ~ S-ε 회고)

1. **Phase 분리 효과**: DCEL surgery (Phase 2 = ADR-089) 회피하면서도
   사용자 facing canonical 의도 (LOCKED #15 P22.5) 달성. 점진 진화의
   가치 — 큰 architectural surgery 를 한 번에 하지 않고 selection-layer
   grouping 으로 단계 unlock.

2. **selection-layer abstraction 의 가치**: DCEL representation (N edges)
   과 user-facing entity (1 logical curve) 의 mismatch 를 selection
   layer 의 grouping 으로 해결. 향후 ADR 가이드: layer 별 책임 분리
   원칙 (DCEL=topology truth / selection=user intent) 적용.

3. **delegate 자동 cover 패턴**: S-γ 에서 `DrawCircleAsShape` 가
   `exec_draw_circle` 로 delegate 하는 구조 덕분에 owner_id 부여가
   자동. K-α~K-ζ 의 AsShape ↔ 기본 exec 분리 architecture 의 자연
   benefit.

4. **defensive fallback**: S-δ 의 stale owner_id (group empty) 케이스
   가 undo / erase / cascade 시나리오의 defense. `groupEdges.length
   <= 1` 분기로 single edge fallback. Selection state 의 robustness.

5. **mock 일관성 유지**: S-δ 에서 3 test file 의 bridge mock 업데이트.
   bridge 인터페이스 확장 시 기본 mock (default no-op) 일관 적용 패턴
   — 향후 bridge 메서드 추가 시 동일 절차.

---

## 7. Cross-link

- **ADR-019** ("Line is Truth, Face is Byproduct"): edge 가 fundamental,
  curve owner 는 그 자연 연장.
- **ADR-027** (NURBS Kernel): analytic curve / surface infrastructure.
- **ADR-028** (Edge curve attach Phase A): Edge.curve = Option<AnalyticCurve>
  의 base layer.
- **ADR-037 P22.5 / LOCKED #15**: "Edge.curve = Some(...) 의 N segments
  모두 동일 EdgeId 로 promote" — 본 ADR 의 enforcement target.
- **ADR-087** (K-α ~ K-η closure): Kernel-Native Command Suite Reset
  의 마무리 후 자연 후속.
- **ADR-089** (future Phase 2): True kernel-native closed edges, DCEL
  Edge schema relaxation (self-loop). 본 ADR Phase 1 의 사전 단계.
- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다"): curve owner
  grouping 은 boundary 의 logical 통일성 강화.
- **LOCKED #1 (P7) / #12 (P11)**: Face 합성 / 분할 회귀 자산 영향 0
  (DCEL topology 무변화로 봉인 보존).

---

*ADR-088 S-α — Curve Owner ID Grouping Phase 1 의 architectural spec.
ADR-087 closure 후 사용자 시연 회귀 (Circle segment selection) 의
canonical fix. Path Z atomic 5-step 의 시작점.*
