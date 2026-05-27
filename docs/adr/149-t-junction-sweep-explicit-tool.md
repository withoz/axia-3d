# ADR-149 — T-junction Sweep 명시 도구 (Sprint 3 첫 ADR)

**Status**: **Accepted** (γ closure 2026-05-27 — Path Z atomic 6 sub-step 완료)
**Date**: 2026-05-27
**Author**: WYKO + Claude
**Trigger**: LOCKED #65 (ADR-141 Master Roadmap) Sprint 3 첫 ADR.
ADR-141 §3 reserve:
> "ADR-149 | T-junction Sweep 명시 도구 | S3 | 1주"
**Direct predecessor**: LOCKED #64 ADR-139 (Boundary tool 명시 only) +
ADR-148 (Point-localized BoundaryTool, B-γ' 자연 후속) — 모두 메타-원칙
#16 정합 패턴 답습.
**Sprint**: S3 (ADR-141 §3 — 3~4주, 회귀 +50 share ~18).

## Canonical anchor

ADR-141 §3 Sprint 3 매트릭스:
| ADR | 제목 | 기간 |
|---|---|---|
| **ADR-149** | **T-junction Sweep 명시 도구** | **1주** |
| ADR-150 | 자동 Coplanar Face Merge (opt-in, 메타-원칙 #16 정합) | 1주 |
| ADR-151 | Connected Stacked-inner Component-Merge Resolver (LOCKED #1 deferred boundary) | 2주 |

Sprint 3 (Topology Cleanup Step 3) 의 첫 ADR — 메타-원칙 #16 정합으로
*휴리스틱 자동 sweep* 폐기, *사용자 명시 호출* 만 활성. ADR-139 / 145 / 148
canonical pattern 답습.

## 1. Problem statement

### 1.1 T-junction 의 architectural risk

**T-junction 정의** (mesh-level): vertex V 가 face F 의 edge E interior 에
위치하지만, E 는 V 를 endpoint 로 갖지 않음 (F 의 loop traversal 시 V 를
거치지 않음). T 모양의 위상 결함.

**예시**:
```
       V (vertex)
       |
   ────●────       F (face)
   |   |   |
   ────────       E (edge of F, V on interior)
```

V 는 mesh 의 다른 face 의 vertex 일 수 있으나, F 의 boundary loop 에는
미반영 → manifold 위반 + render artifact + downstream op (Boolean/Push-
Pull) 회귀.

### 1.2 Codebase 자산 audit (Sprint 0 α-audit 결과)

| 자산 | 위치 | scope |
|---|---|---|
| `simplify_collinear_loop` (F6) | `mesh.rs:6201` | post face-merge collinear vertex 제거 (loop-level) |
| ADR-128 `VERTEX_ON_EDGE_EPS_2D` | `coplanar.rs:55` | 2D plane intersection 시점 fallback |
| `edge_chain_stops_at_junction` | `mesh.rs:7953` | edge chain BFS junction termination |

**Gap**: *mesh-level* T-junction (vertex-on-edge-interior, DCEL 전체 sweep)
의 검출 + healing **자산 부재**. `simplify_collinear_loop` 은 collinear
vertex 제거만, *T-junction healing (vertex 보존 + edge split + loop insert)*
은 별개 동작.

### 1.3 메타-원칙 #16 정합

*자동 sweep* (예: 매 mutation 후 T-junction scan + auto-heal) 은 휴리스틱
자동화의 전형 — cascading 부작용 source. P5.UX.39-45 패턴 evidence 답습.

본 ADR 은 **명시 trigger only** (ADR-139 / 145 / 148 답습) — 사용자
ContextMenu 호출 시점에만 sweep + heal.

### 1.4 LOCKED 정책 cross-cut

- **LOCKED #1 P7 manifold**: T-junction → non-manifold edge 가능 (한 edge
  를 3+ face 공유)
- **LOCKED #5 spatial-hash**: 0.15μm tolerance — T-junction detection 의
  vertex-on-edge distance threshold 자연 활용
- **LOCKED #7 ADR-026 P12**: cardinal snap SSOT — sweep tolerance 와
  정합
- **LOCKED #15 메타-원칙 #15**: 동일 split = 동일 contract — heal 시
  `split_edge` 의 HARD flag 부여 의무
- **LOCKED #16 ADR-038 P23**: surface-aware normals — T-junction healing
  후 normal 재계산 trigger 필요
- **LOCKED #65 메타-원칙 #16**: 자동화 antipattern — *명시 호출 only*
  강제

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — Detection algorithm: (a) Full mesh sweep + spatial-hash candidate

**Lock-in**: ADR-148 Hybrid BVH + DFS pattern 1:1 mirror — *spatial-hash
candidate compression* 로 O(N+M) 후보 → 2D project distance check.

**Algorithm**:
1. 모든 active edges E (DCEL face boundary HE 의 base edge) 수집
2. 모든 active vertices V (face 의 boundary loop 에 포함된 vertex) 수집
3. Spatial-hash (LOCKED #5 0.15μm cell) 으로 edge AABB ∩ vertex 후보 쌍
   필터링 — O(N+M) bucket lookup
4. 각 후보 (E, V) 쌍에 대해:
   - V 가 E 의 endpoint 면 skip (정상)
   - V 의 position 이 E 의 line segment 위에 있고 (distance < tol)
   - V 가 E 의 incident face 의 boundary loop 에 미포함 (T-junction
     condition)
   → T-junction report 발생

**Return type**: `Vec<TJunctionReport { face_id, edge_id, vertex_id, t_along_edge }>`

### Q2 — Healing strategy: (a) `split_edge` at V + loop reparent

**Lock-in**: ADR-149 healing 의 manifold-safe canonical.

**Algorithm**:
1. `Mesh::split_edge(E, V.position())` 호출 → V_new (V 와 spatial-hash
   collide 시 V 로 dedup)
2. V_new 가 V 와 다르면 (drift), `Mesh::merge_vertices(V_new, V)` 호출
3. F 의 outer/inner loop traversal 에 V 자연 삽입 (split_edge 가 이미 처리)
4. Healed HE 들에 `HeFlags::HARD` 부여 — 메타-원칙 #15 정합 강제

**Return type**: `Result<HealReport { healed_count, skipped_count }, TJunctionError>`

### Q3 — UI entry: (a) ContextMenu "T-junction 정리"

**Lock-in**: ADR-148 BoundaryTool (Ctrl+B), ADR-145 ContextMenu "annulus
만들기" 패턴 답습. 새 panel / 단축키 신설 0.

**위치**: ContextMenu 의 "정리 (Cleanup)" 그룹 안 (Heal Mesh 와 인접).

**호출 시점**: 사용자 선택 face(s) (또는 mesh 전체 default) 위 우클릭 →
"T-junction 정리" 클릭.

### Q4 — 자동 trigger 정책: (a) Default OFF + 명시 호출 only

**Lock-in**: 메타-원칙 #16 정합 강제. autopilot 0.

- 자동 trigger / 자동 detect / 자동 heal **모두 0**
- 사용자 ContextMenu 클릭 = 유일한 trigger
- localStorage opt-in 없음 (휴리스틱 활성 경로 자체 미제공)
- ADR-139 / 145 / 148 canonical 답습

### Q5 — Tolerance: (a) LOCKED #5 0.15μm 답습

**Lock-in**: 3-layer precision (ADR-147 Scenario B1) 의 자연 확장.

```rust
/// ADR-149 — T-junction detection tolerance (vertex-on-edge distance).
/// LOCKED #5 spatial-hash 0.15μm 와 정합 (vertex dedup 와 동일 scale).
const T_JUNCTION_TOL: f64 = 1.5e-4; // 0.15μm
```

별도 const 도입 (LOCKED #5 SSOT 보존, 의미 명시).

## 3. Path Z atomic plan (6 sub-step)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-149 spec only commit (본 PR) | +0 |
| **β-1** | Engine `Mesh::detect_t_junctions(tol) -> Vec<TJunctionReport>` + 6 회귀 | +6 (axia-geo) |
| **β-2** | Engine `Mesh::heal_t_junction(report) -> Result<HealReport>` + 6 회귀 | +6 (axia-geo) |
| **β-3** | WASM bridge `detectTJunctions` / `healTJunction` exports + TS bridge wrappers | +2 (axia-wasm) |
| **β-4** | UI ContextMenu "T-junction 정리" integration | +4 (vitest) |
| **γ** | E2E + closure docs (Status Proposed → Accepted + §9 Lessons) | +0 |
| **합계** | | **+18** |

**ADR-141 §3 Sprint 3 회귀 share**: +18 (S3 +50 share ~36%, 1주 분 적정).

## 4. Lock-ins (canonical for ADR-149)

- **L-149-1** 메타-원칙 #16 정합 강제 — 자동 trigger 0, 명시 호출 only
- **L-149-2** ADR-139 / 145 / 148 canonical pattern 1:1 mirror (Sprint 1+2
  답습 evidence)
- **L-149-3** Q1=(a) Full mesh sweep + spatial-hash candidate compression
  (ADR-148 Hybrid pattern 답습)
- **L-149-4** Q2=(a) `split_edge` at V + loop reparent + HARD flag 부여
  (메타-원칙 #15 정합)
- **L-149-5** Q3=(a) ContextMenu "T-junction 정리" — 새 단축키/panel 0
  (ADR-046 P31 #4 additive only)
- **L-149-6** Q4=(a) Default OFF + 명시 호출 only — localStorage opt-in
  미제공 (휴리스틱 활성 경로 자체 차단)
- **L-149-7** Q5=(a) `T_JUNCTION_TOL = 1.5e-4` (LOCKED #5 0.15μm 정합)
- **L-149-8** ADR-046 P31 #4 additive only — public API + UX UNCHANGED
- **L-149-9** ADR-077 V-2 visual baselines 보존 (T-junction healing 후
  visible 변화 0 — 사용자 명시 호출 시점만 활성)
- **L-149-10** 절대 #[ignore] 금지 18/18 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **자동 sweep on draw** — 메타-원칙 #16 정합 위반 → 영구 거부 (ADR-139
  Q3=a 답습)
- **3D T-junction (vertex-on-face-interior)** — ADR-149 scope = vertex-
  on-edge-interior only. Face interior 의 vertex 는 ADR-150/151 또는 별도
  ADR.
- **Multi-vertex T-junction healing batch** — β-2 는 single report healing.
  Batch 는 β-2-extension 또는 별도 sub-step.
- **Visual feedback (T-junction highlight overlay)** — ADR-046 P31 Pillar
  2 (Precision Visibility) 별도 ADR.
- **Selection 통합 (T-junction 한 곳 선택 후 healing)** — ADR-037 P22.4
  owner-ID highlight 와 cross-cut, 별도 ADR.

## 6. 회귀 자산 강제

**β-1 회귀 (axia-geo +6)**:
- `adr149_detect_no_tjunction_on_clean_mesh` (baseline)
- `adr149_detect_single_vertex_on_edge_interior` (canonical positive)
- `adr149_detect_excludes_endpoint_vertex` (regression guard — endpoint
  vertex 는 T-junction 아님)
- `adr149_detect_multiple_tjunctions_on_single_edge` (multi-vertex on
  edge)
- `adr149_detect_respects_tolerance` (0.15μm boundary case)
- `adr149_detect_spatial_hash_optimization` (large mesh 1000-face 성능
  체크)

**β-2 회귀 (axia-geo +6)**:
- `adr149_heal_split_edge_at_vertex` (canonical healing)
- `adr149_heal_assigns_hard_flag` (메타-원칙 #15 정합)
- `adr149_heal_manifold_safe_post_healing` (LOCKED #1 invariant)
- `adr149_heal_dedup_vertex_via_spatial_hash` (drift absorption)
- `adr149_heal_rejects_invalid_report` (TJunctionError variants)
- `adr149_heal_normal_recomputed_post_healing` (LOCKED #16 P23 정합)

**β-3 회귀 (axia-wasm +2)**:
- `detect_t_junctions_basic` (WASM round-trip)
- `heal_t_junction_basic` (WASM round-trip)

**β-4 회귀 (vitest +4)**:
- `ContextMenu_TJunction_cleanup_visible` (메뉴 표시)
- `ContextMenu_TJunction_cleanup_disabled_when_no_mesh` (disabled state)
- `ContextMenu_TJunction_cleanup_invokes_bridge` (callback 검증)
- `ContextMenu_TJunction_cleanup_Toast_on_zero_found` (UX feedback)

**γ 회귀**: 0 (docs only)

## 7. Cross-link

- ADR-141 §3 Sprint 3 (canonical roadmap anchor)
- ADR-139 (LOCKED #64, Boundary tool 명시 only — canonical pattern source)
- ADR-145 (LOCKED #64 자연 후속, ContextMenu 패턴)
- ADR-148 (Point-localized BoundaryTool — 직전 ADR, Hybrid algorithm
  pattern)
- ADR-128 (LOCKED #58 vertex-on-edge fallback — 다른 layer 의 동일 기술)
- ADR-007 (LOCKED Invariant 2 — manifold + winding)
- LOCKED #1 ADR-021 P7 (manifold anchor — healing 후 invariant 강제)
- LOCKED #5 (spatial-hash 0.15μm canonical — T_JUNCTION_TOL 답습)
- LOCKED #15 메타-원칙 #15 (동일 split = 동일 contract — HARD flag 의무)
- LOCKED #16 ADR-038 P23 (surface-aware normals — healing 후 재계산)
- LOCKED #44 (Complete Meaning per Merge — single atomic PR per sub-step)
- LOCKED #65 메타-원칙 #16 (자동화 antipattern — 본 ADR 의 canonical anchor)
- LOCKED #66 STATUS-POLICY (Proposed → Accepted, audit-first canonical 8번째 적용)

## 8. 결재 cycle log

- **2026-05-27 α-audit** (본 ADR α PR) — Sprint 3 source materials inventory
  + ADR-141 §3 매트릭스 확인 + codebase T-junction 자산 audit (`simplify_
  collinear_loop` + ADR-128 fallback) + scope 분리 명시 (mesh-level vertex-
  on-edge-interior, ADR-149 scope = T-junction Sweep 명시 도구)
- **2026-05-27 Q1~Q5 결재** — 사용자 "승인" (default 5/5):
  - Q1=(a) Full mesh sweep + spatial-hash candidate ✅
  - Q2=(a) `split_edge` at V + loop reparent ✅
  - Q3=(a) ContextMenu "T-junction 정리" ✅
  - Q4=(a) Default OFF + 명시 호출 only ✅
  - Q5=(a) LOCKED #5 0.15μm 답습 ✅
- **2026-05-27 α** (PR #196, merged `86dac6d`) — ADR-149 spec only PR
- **2026-05-27 β-1** (PR #197, merged `0ea83da`) — Engine
  `Mesh::detect_t_junctions` + `TJunctionReport` + `T_JUNCTION_TOL`.
  `operations/t_junction.rs` 신설 (mesh.rs 추가 0, 정책 (B) hybrid).
  회귀 axia-geo **+6** (baseline / canonical / endpoint exclude /
  multi-vertex / tolerance boundary / spatial-hash performance).
- **2026-05-27 β-2** (PR #198, merged `f35523b`) — Engine
  `heal_t_junction` + `TJunctionError` + `HealReport`. `mesh.split_edge`
  위임 + `mesh.mark_edges_hard` HARD flag 부여 (메타-원칙 #15 정합 +
  ADR-101 Amendment 10 canonical 답습). 회귀 axia-geo **+6**
  (canonical heal / HARD flag / manifold post-heal / invalid report
  reject / vertex drift reject / multi-heal sequence).
- **2026-05-27 β-3** (PR #199, merged `57bc009`) — WASM bridge
  `detectTJunctions` + `healTJunction` exports + `parse_t_junction_
  report` helper. TS bridge `TJunctionReport` + `TJunctionHealReport`
  interfaces + `detectTJunctions(tolMm = 0)` (graceful fallback) +
  `healTJunction(report, tolMm = 0)` (strict throw). 회귀 axia-wasm
  **+4** (parser) + vitest **+6** (TS wrapper).
- **2026-05-27 β-4** (PR #200, merged `c4ed621`) — UI ContextMenu
  `heal-t-junctions` 메뉴 entry + handler. detect → heal sequence
  + 3-way Toast feedback (success / info / error). 회귀 vitest **+4**
  (zero / detect throw / canonical heal / partial failure).
- **2026-05-27 γ** (본 commit) — Closure: Status flip + Acceptance Log
  + §9 Lessons + README catalog Status update + E2E spec.
  - **Status**: Proposed → **Accepted** (header).
  - **README catalog** — ADR-149 row Status: `Proposed` → `Accepted`.
  - **E2E spec** (`web/e2e/adr-149-t-junction-demo.spec.ts`) — Real
    Chromium 3 회귀: detectTJunctions empty / healTJunction invalid
    throw / ContextMenu wiring. ADR-148 γ pattern 1:1 mirror.
  - §9 Lessons 신규 — 5-항목 회고.

## 9. Lessons (canonical for future Sprint 3 ADRs)

ADR-149 Path Z atomic 6-sub-step closure 의 5개 회고 항목:

### L1 — Path Z atomic 6-sub-step 의 사용자 결재 효율성

α spec → β-1 / β-2 / β-3 / β-4 → γ closure. 각 sub-step single atomic PR
(LOCKED #44 정합). 본 ADR 의 sub-step 들은 *layered dependency* —
β-1 (engine detect) → β-2 (engine heal, β-1 자산 활용) → β-3 (WASM bridge
+ TS wrapper, β-1+β-2 자산 export) → β-4 (UI, β-3 wrapper 활용).
ADR-146 의 parallel sub-step 과 대조 — *bridge/UI stack* ADR 은 sequential
가 자연.

향후 *engine → bridge → UI* 3-layer ADR 가이드 — sequential atomic 가
canonical. parallel 시도는 의존성 graph audit 우선.

### L2 — 정책 (B) hybrid 답습 — mesh.rs 추가 0 일관 적용

본 ADR β-1 진입 시 사용자가 "과부하 상태를 최적화하는 방법은?" 질문 →
audit-first canonical 9번째 적용 → 4 옵션 매트릭스 → 정책 (B) hybrid
선택 (Sprint 3 진행 + 별도 audit ADR 예약). β-1 부터 β-4 까지 *mesh.rs
추가 0* 강제 일관 적용 — `operations/t_junction.rs` 신설.

향후 architectural debt 해결 가이드 — *Sprint 진행 중에는 hybrid 정책,
별도 audit ADR* 패턴. β-1 sub-step 진입 직전 panel 결재 anchor 가 향후
Sprint 4/5 진입 시에도 유효.

### L3 — ADR-148 1:1 mirror reproducibility 증명 (Sprint 2 → Sprint 3)

ADR-148 (point-localized BoundaryTool) 의 6-step closure 패턴 (α / β-1 /
β-2 / β-3 / β-4 / γ) 이 ADR-149 (T-junction sweep) 에 거의 *1:1 transfer*
됨:
- α: spec docs + 결재 anchor
- β-1: engine detection (read-only API)
- β-2: engine algorithm (mutation API + HARD flag)
- β-3: WASM bridge + TS wrapper (graceful read / strict mutate)
- β-4: UI ContextMenu entry + handler
- γ: E2E + Status flip + §9 Lessons

향후 Sprint 3 ADR-150 / 151 + Sprint 4 + 5 *명시 trigger 도구* ADR 가이드
— 본 6-step template 답습. 사용자 결재 cycle 최소화.

### L4 — Read-only vs Mutate API 의 graceful vs strict 분리

β-3 TS wrapper 의 의도된 패턴:
- `detectTJunctions()` — **graceful fallback** (WASM 없을 시 `[]` 반환)
- `healTJunction(report)` — **strict throw** (WASM 없을 시 Error)

read-only API 는 UI 가 "메뉴 표시 여부" 결정에 사용 → graceful 가 자연
(예: clean mesh / WASM 미로드 모두 동일 "T-junction 없음" UX). mutate API
는 silent skip 위험 = 메타-원칙 #16 위반 → strict throw 필수.

향후 *engine 호출 wrapper* 가이드 — read vs mutate 의미 분리 후 errcase
policy 별도 결정.

### L5 — Sprint 3 첫 ADR closure → Sprint 3 잔존 자연 진행

본 ADR closure 후 Sprint 3 ADR-150 (자동 Coplanar Face Merge, opt-in)
또는 ADR-151 (Connected Stacked-inner Component-Merge Resolver) 진입
가능. ADR-141 §3 Sprint 3 reserve 3~4주 / 회귀 +50 share.

ADR-149 누적 회귀 **+26** (axia-geo +12 + axia-wasm +4 + vitest +10 +
Playwright +3) — Sprint 3 share +50 의 ~52%. ADR-150/151 자연 분담 +24.

향후 Sprint scope 결정 가이드 — Sprint 내 ADR 간 회귀 share 분배 +
사용자 결재 anchor (사용자 "다음 진행" / "추천 승인" 응답) 우선.

---

**ADR-149 closure**: Path Z atomic 6 sub-step 완료. 사용자 facing 즉시
가치 — T-junction Sweep 명시 도구 활성 (ContextMenu "T-junction 정리").
메타-원칙 #16 정합의 9번째 적용 (휴리스틱 자동 sweep 폐기 + 사용자 명시
호출 only). Sprint 3 진행 +52% (회귀 share).
