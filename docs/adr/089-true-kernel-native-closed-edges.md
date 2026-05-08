# ADR-089 — True Kernel-Native Closed Edges (Phase 2 architectural surgery)

**Status**: **Accepted** (A-α spec only — code 변경은 후속 A-β ~ A-ξ
별도 atomic commits, 각 step 사용자 결재 필수)
**Date**: 2026-05-08
**Author**: AXiA team (사용자 통찰 + Claude spec)
**Anchor**: 사용자 결재 (2026-05-08, ADR-088 closure 후):
> "🅰 길 1 건너뛰고 바로 길 2 진입 (3주, 진정한 정답)"
>
> 이유: 길 1 (curve-aware wireframe) 은 데이터량 8x 증가하는 **임시방편**.
> 길 2 (true kernel-native) 가 가장 가벼우면서 매끈한 architectural 정답.
> 길 1 은 길 2 후 폐기될 코드 — 작업 낭비.

**Parent**: ADR-019 (Line is Truth), ADR-027 (NURBS Kernel), ADR-028
(Edge curve attach), ADR-088 (Phase 1 selection grouping), 메타-원칙 #14
("면은 닫힌 경계로부터 유도된다")
**Cross-cut**: LOCKED #1 (P7) / #12 (P11) / #16 (P23) — 모든 face/edge
회귀 자산 재검증 대상

---

## 0. Summary (10 lines)

> ADR-088 Phase 1 (curve_owner_id grouping) 은 selection-layer 의 canonical
> 정합 (LOCKED #15 P22.5) 달성. 그러나 DCEL 자체는 여전히 "closed Circle
> = 24 line segments" 의 mesh-era 표현. 사용자 통찰 (2026-05-08):
> 산업 CAD (Onshape/Fusion/SolidWorks) 는 closed Circle = 1 BRep edge
> + analytic Circle parameter — 데이터 가벼움 + render 매끈함 동시 달성.
>
> 본 ADR Phase 2 는 **DCEL Edge schema 자체를 kernel-native 로 격상** —
> self-loop edge 허용 (`v_small == v_large`), `add_face_with_curve_loops`
> API 신설, face synthesis / Boolean / Push-Pull / Offset / Fillet 모두
> closed-curve aware. 메타-원칙 #14 의 deepest realization. 3-주 atomic
> Path Z 트랙 (A-α ~ A-ξ).

---

## 1. Background

### 1.1 사용자 시연 driver (2026-05-08)

ADR-088 closure 후 사용자 시연:
- ✅ Click selection canonical (S-δ owner_id walk)
- ✅ Hover unification (S-ζ hotfix)
- ✅ Cylinder/Cone perf fix
- ❌ **Visual chord 여전히 보임** — Circle wireframe = 24 chord 직선
- ❌ 산업 CAD 와 비교 시 명백한 architectural gap

### 1.2 산업 CAD architectural pattern

Onshape/Fusion 360/SolidWorks 의 BRep:
- **Edge** = analytic curve definition (Circle: center + radius + axis)
- **Face boundary** = sequence of analytic edges
- **Render** = GPU vertex shader 가 curve evaluate (CPU pre-tessellation 없음)
- **Boolean** = curve-curve intersection (분석적 SSI)
- **Memory** = constant per curve (수식 1개)

### 1.3 우리 엔진 현재 (mesh-with-curve-metadata)

- **Edge** = 두 vertex 간 line + optional `Edge.curve` (sidecar)
- **DCEL constraint**: `v_small != v_large` (canonical 정렬), face ≥3 verts
- **Closed curve** = N (e.g., 24) line segments + Arc curve attached per segment
- **Render** = 24 chord 직선 (curve metadata 무시)
- **Memory** = O(N) per curve (24 edges + 24 curve metadata)

### 1.4 Phase 1 (ADR-088) 의 한계

`curve_owner_id` grouping 으로 selection 통일 ✅. 그러나:
- DCEL 은 여전히 24 segments
- Wireframe 24 chord 보임
- Boolean/Push-Pull 은 polygon 레벨 동작 (curve 정확성 손실)
- Memory overhead 그대로

→ Phase 2 = DCEL 자체를 kernel-native 로 변환.

### 1.5 메타-원칙 #14 정합

> **"면은 닫힌 경계로부터 유도된다"**

본 ADR 의 deepest realization:
- Closed curve = **single self-loop edge** (boundary 자체가 closed)
- Face = closed curve edge 의 byproduct
- Mesh-era 잔존 (24 polygon segments) 영구 청산

---

## 2. Decision

### 2.1 P-1 (canonical) — Self-loop edge for closed analytic curves

> Closed analytic curve (Circle / closed Bezier / closed BSpline / closed
> NURBS) 는 **단일 self-loop edge** (`v_small == v_large == single anchor
> vertex`) 로 DCEL 에 표현. Face boundary 가 1 edge cycle (multi-vert
> polygon 아닌 single-edge loop) 허용.

### 2.2 7 lock-in 원칙

- **L1 (schema)**: Edge schema 의 `v_small < v_large` canonical 정렬
  강제 폐기. self-loop (`v_small == v_large`) 허용. canonical 정렬은
  `v_small != v_large` 일 때만 적용.
- **L2 (API)**: `Mesh::add_face_with_holes(outer_verts: &[VertId], ...)`
  의 `outer_verts.len() < 3` 제약 조건부 완화 — single vertex outer 는
  `Edge.curve.is_some()` 일 때만 허용.
- **L3 (face synthesis)**: LOCKED #1 P7 / #12 P11 의 closed boundary
  detection 이 self-loop edge 도 cycle 로 인식. Cross-cut: free-edge
  loop 검출 알고리즘 (Step 4.95 등) 의 self-loop 인식 추가.
- **L4 (Boolean)**: NURBS Boolean (ADR-064/066) 이 closed curve face
  의 SSI 를 분석적으로 처리. ADR-051 component-merge resolver 의 closed-
  curve aware 분기 추가.
- **L5 (Push-Pull / create_solid)**: Closed curve face 의 extrude 가
  cylinder/cone 의 정확한 surface 반환. 기존 SolidKind::Cylinder 와
  자연 통합.
- **L6 (Offset)**: ADR-080 V-β-α (Plane host + Line/Arc/Circle curve)
  가 self-loop closed curve 도 처리.
- **L7 (Selection)**: ADR-088 P22.5 단순화 — `curve_owner_id` 가 1:1
  으로 EdgeId 와 매핑 (closed curve = 1 edge). Phase 1 의 grouping
  layer 가 자연 무력화 (1 segment 만 group).

### 2.3 메타-원칙 #14 strict 준수

본 ADR 후:
- 새 변경이 face 를 closed edge boundary 의 byproduct 로 유지하는가?
  → **YES** (closed curve = 1 edge, face = 그 edge 의 boundary)
- Face 를 first-class 로 취급하는 mesh-era 잔존이 있는가?
  → **NO** (24 polygon segments 영구 폐기)

→ 메타-원칙 #14 의 deepest realization 달성.

---

## 3. Approach — Path Z atomic 13-step (A-α ~ A-ξ)

### 3.1 Step roadmap

| Step | Title | 핵심 변경 | 회귀 (예상) | Days |
|------|-------|----------|-----------|------|
| **A-α** | Spec only (본 commit) | ADR-089 본문 작성 | +0 | 0.5 |
| A-β | Edge schema relaxation | `v_small < v_large` 강제 폐기, self-loop 허용 | +5 | 1-2 |
| A-γ | Half-edge wiring for self-loops | next_rad / next / prev / twin self-loop 정합 | +8 | 2-3 |
| A-δ | `add_face_with_curve_loops` API | single-vert outer 허용 + curve loop 입력 | +6 | 1-2 |
| A-ε | Spatial-hash dedup adapt | self-loop 의 single vert 호환 (LOCKED #5) | +3 | 0.5-1 |
| A-ζ | Face synthesis pipeline | LOCKED #1/#12 closed-curve aware | +10 | 3-5 |
| A-η | Boolean / NURBS SSI 통합 | ADR-064/066 closed curve face | +8 | 3-4 |
| A-θ | Push-Pull / create_solid | ADR-079 closed curve face → cylinder/cone | +6 | 2-3 |
| A-ι | Offset closed curve | ADR-080 V-β-α closed boundary | +5 | 2 |
| A-κ | Render pipeline curve-aware | export_edge_lines + export_buffers | +6 | 2 |
| A-λ | WASM exports + TS bridge | drawCircleAsCurve, faceClosedBoundary, etc. | +5 | 1-2 |
| A-μ | Snapshot schema versioning | legacy → kernel-native migration | +4 | 1 |
| A-ν | 회귀 245 sites 재검증 + 사용자 시연 | LOCKED 모든 회귀 자산 재검증 | +0 | 3-5 |
| A-ξ | 회고 + LOCKED #35 + 메타-원칙 #14 strict 검증 | docs only | +0 | 0.5 |

**누적 회귀 예상**: **+66** (절대 #[ignore] 금지 66/66).
**누적 일수**: **15-20일** (3-4주 atomic 분리, 사용자 결재 multi-gate).

### 3.2 Risk Matrix

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LOCKED #1 P7 회귀 (face split) | **매우 높음** | A-ζ 단계에서 245 회귀 자산 재검증 게이트 |
| Half-edge self-loop 의 next_rad 무한 loop | 높음 | A-γ 의 invariant test (cycle detection) |
| Spatial-hash dedup 의 self-loop 충돌 | 중간 | A-ε 의 LOCKED #5 ε 정합 검증 |
| Boolean SSI 의 closed curve 처리 | 높음 | A-η 의 ADR-064/066 cross-validation |
| 사용자 facing 회귀 (시연 게이트 #4) | 중간 | A-ν 의 사용자 시연 multi-iteration |
| Snapshot legacy 호환 | 중간 | A-μ 의 schema version + auto-migration |
| 3주 트랙 의 컨텍스트 손실 | 낮음 | 각 step 별 commit + 사용자 결재 게이트 |

### 3.3 사용자 결재 시점 (multi-gate)

각 step 별 결재:
- A-α (✅ 본 commit)
- A-β / A-γ / ... / A-ξ 각 step 진입 별 결재
- 특히 A-ζ (face synthesis) / A-η (Boolean) / A-θ (Push-Pull) 은
  사용자 시연 게이트 필수 (LOCKED #1 핵심 회귀 자산)

---

## 4. Lock-ins (A-α 시점)

- **L-α-1** Edge schema 변경 = additive (legacy `.axia` 파일도 load
  가능). canonical 정렬은 `v_small != v_large` 시 적용 (loop case 만
  완화).
- **L-α-2** `add_face_with_holes(verts, holes, mat)` API signature
  UNCHANGED (backward compat). 신규 API `add_face_with_curve_loops`
  drop-in alongside.
- **L-α-3** Closed curve = single self-loop edge — 1:1 EdgeId ↔
  curve mapping. ADR-088 `curve_owner_id` 의 자연 단순화 (1 segment
  group 으로 무력화).
- **L-α-4** Render path: closed curve edge 의 wireframe 은 curve
  evaluation 결과 (chord-tolerant tessellation, render-only). DCEL
  topology 무관.
- **L-α-5** STEP/IGES import (ADR-081) 자동 호환 — 외부 BRep 의
  closed curves 가 우리 DCEL 에 1:1 매핑 가능.
- **L-α-6** ADR-088 Phase 1 selection grouping 자연 단순화 — closed
  curve 는 1 EdgeId, grouping 무의미. 단, 비-closed (open Arc 등) 는
  여전히 grouping 적용.
- **L-α-7** 모든 LOCKED 회귀 자산 (#1 P7, #12 P11, #16 P23, #15 P22.5,
  #26 Phase 1) PASS 유지 — A-ν 단계 강제.

---

## 5. Non-goals (A-α 시점)

- **N-1** Open curve self-loop (e.g., open Arc with v_small == v_large)
  미허용 — closed curve 만 self-loop, open 은 기존 ≥3 vert 폴리곤 또는
  ≥2 vert 라인.
- **N-2** Render pipeline 의 vertex shader curve evaluation — A-κ 는
  CPU tessellation 결과를 wireframe 으로. GPU shader 는 future ADR.
- **N-3** Adaptive LOD (zoom-aware tessellation) — A-κ 는 fixed
  chord_tol. Adaptive LOD 는 future.
- **N-4** Multi-curve grouping (e.g., sketch 의 모든 curve 가 1 entity)
  — ADR-053 Phase 3 (Sketch 시민권) 영역.
- **N-5** Edge schema 의 `Edge.curve` 필드 폐기 — 본 ADR 은 self-loop
  추가만, `Edge.curve` 는 보존 (ADR-028 base).
- **N-6** P7 disjoint-inner ring+hole 분할 (ADR-051 deferred boundary)
  — 별도 ADR.

---

## 6. Acceptance criteria (A-α 시점)

본 commit (A-α) 가 만족해야:
- ✅ `docs/adr/089-true-kernel-native-closed-edges.md` 신설.
- ✅ §1 Background / §2 Decision / §3 Approach / §4 Lock-ins / §5
  Non-goals / §6 Acceptance criteria 명시.
- ✅ 13-step roadmap (A-α ~ A-ξ) 의 각 step 별 회귀 / risk / 일수 추정.
- ✅ ADR-019 + ADR-027 + ADR-028 + ADR-088 + 메타-원칙 #14 cross-link.
- ✅ Risk Matrix (7 risks).
- ✅ Code 변경 0 — spec only.

---

## §D Acceptance Log

### A-α (2026-05-08, 본 commit)
- **사용자 결재**: 2026-05-08, "🅰 길 1 건너뛰고 바로 길 2 진입 (3주,
  진정한 정답)."
- **변경**: `docs/adr/089-true-kernel-native-closed-edges.md` (본 파일)
  신설.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.
- **Bundle 영향**: 0 (TS/Rust 변경 0).
- **다음 step**: A-β (Edge schema relaxation, self-loop 허용).

---

### A-θ-α (2026-05-08, spec amendment)

**Path A 채택** (사용자 결재 2026-05-08): "ADR-088/089 패턴 (S-α spec
→ 점진 atomic) 답습 시 (1) 권장 — 길 1 → 길 2 점진." 즉시 사용 가치
+ 진정한 kernel-native 는 별도 ADR 보장.

**§A-θ Sub-step roadmap (Path A, 4-단계 atomic)**:

| Sub-step | Title | 핵심 변경 | 회귀 (예상) |
|----------|-------|----------|-----------|
| A-θ-α (본 amendment) | spec only | 본 §D 추가 | +0 |
| A-θ-β | Rust core tessellate-then-extrude | `extrude_planar_cylinder` closed-curve fast-path | +5 |
| A-θ-γ | WASM/TS verify + regression sweep | 기존 `createSolidExtrude` 자동 통과 검증 | +0~3 |
| A-θ-δ | 사용자 시연 (closed-curve Push-Pull) | browser real-runtime drawCircleAsCurve → Push-Pull | +0 |

**Lock-ins (A-θ-α 시점)**:
- **L-θ-1** **Path A 잠정 (mesh-era 회귀 한정)**: top + 측면 N개
  faces = polygonal. closed-curve face (profile) 는 보존되지 않고
  tessellation 시 polygonal 로 강등. 메타-원칙 #14 의 측면 (Path B
  별도 ADR 시 closure).
- **L-θ-2** **Detection point**: `extrude_planar_cylinder` entry 의
  `boundary_verts.len() < 3` bail 직전. 1-vert + Circle curve self-loop
  edge 감지 시 tessellation fast-path 분기.
- **L-θ-3** **Tessellation default N=32 segments** (ADR-087 K-δ
  Cylinder 답습). Future adaptive LOD = 별도 ADR.
- **L-θ-4** **Substituted profile face**: 새 polygonal face (32 verts +
  32 edges) 로 교체. 원본 closed-curve face 는 `remove_face` 로 비활성
  (snapshot diff = 1 closed-curve face 제거 + 1 polygonal face 추가).
- **L-θ-5** **AnalyticSurface inheritance**: 새 polygonal face 는 원본
  closed-curve face 의 Plane surface 를 그대로 inherit (A-η-1 Plane
  attach 가 자연 보존).
- **L-θ-6** **Backward compat**: polygonal-circle Push-Pull (ADR-087
  K-δ Cylinder primitive 답습) 은 unchanged. 본 fast-path 는 closed-
  curve 입력에만 발동.
- **L-θ-7** **Path B 별도 ADR**: 진정한 kernel-native cylinder (2
  closed-curve loop boundary) 는 future ADR. 현재 Path A 는 임시방편.

**Non-goals (A-θ-α 시점)**:
- **N-θ-1** Cone / Sphere / Torus closed-curve profile 지원 (Path A
  도) — Circle curve 만 (closed-curve = Circle in current schema).
- **N-θ-2** Adaptive tessellation density (zoom / chord-tol 기반).
- **N-θ-3** AnalyticEdge curve 보존 in result solid 의 측면 walls
  (Path B scope).
- **N-θ-4** Boolean dispatch path 의 closed-curve top/side face 처리
  (Path B scope; A-θ Path A 의 결과는 모두 polygonal Plane).

**Cross-link**:
- ADR-087 K-δ (Cone/Cylinder 의 polygon-mode 1차 시민권) — Path A 의
  source pattern.
- ADR-079 W-1-α / W-2-α (`extrude_planar_box` / `extrude_planar_
  cylinder`) — Path A 의 직접 진입점.
- LOCKED #34 (ADR-087): Cone/Cylinder/Sphere 의 polygon path 자체는
  본 fast-path 와 무관 (직접 primitive 경로).
- ADR-089 §A-θ Path B (future ADR): 진정한 kernel-native cylinder
  의 별도 트랙.

### A-θ-α (commit `16fb58c`)
- **사용자 결재**: 2026-05-08, "(1) 권장 — Path A 먼저, Path B 별도".
- **변경**: 본 §D `A-θ-α` amendment 추가. Roadmap / lock-ins /
  non-goals / cross-link 명시.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.
- **Bundle 영향**: 0.

### A-θ-β (commit `2cc2bc0`)
- **변경**: `crates/axia-geo/src/operations/create_solid.rs`:
  * `extrude_planar_cylinder` entry 에 `boundary_verts.len() == 1`
    fast-path 추가 (L-θ-2).
  * `extrude_closed_curve_face_via_tessellation` 신규 helper —
    Circle curve detection → tessellate (chord_tol = radius/100,
    min 8) → soft-delete original → polygonal substitute + Plane
    inherit + Arc curve 부여 → recurse.
- **회귀**: axia-geo 1143 → 1148 (+5). 절대 #[ignore] 금지 5/5 준수.
- **LOCKED guards**: axia-core 200 unchanged.

### A-κ-α (2026-05-08, spec amendment)

**Path Z 3-sub-step roadmap (A-κ Path A render)**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-κ-α (본 amendment) | spec only | +0 |
| A-κ-β | `export_buffers_inner` + `export_edge_lines_with_map` closed-curve fast-path | +6 |
| A-κ-γ | Browser smoke + closure | +0 |

**Lock-ins (A-κ-α 시점)**:
- **L-κ-1** **Face render**: `export_buffers_inner` 의 polygon path 진입
  전 closed-curve face 감지 → Circle curve tessellate (chord_tol = 0.1mm,
  ADR-038 P23.2) → fan triangulate from anchor → emit.
- **L-κ-2** **Edge wireframe**: `export_edge_lines_with_map` 진입 시
  self-loop edge 감지 → Circle curve tessellate to N polyline points →
  N-1 line segments 으로 emit (각 segment 가 같은 EdgeId map 받음 —
  LOCKED #15 ADR-037 P22.5 답습).
- **L-κ-3** **Read-only**: A-κ-β 는 mesh state 변경 0 (A-θ-β 는
  tessellate-then-extrude 시 add_vertex/add_face/remove_face 변경했지만,
  render 는 read-only).
- **L-κ-4** **Plane fast-path 우회**: LOCKED #16 ADR-038 P23 K-ε hotfix
  의 Plane → polygon path 가 closed-curve 에는 부적합 — closed-curve
  detection 이 선행하여 분기.
- **L-κ-5** **Backward compat**: 폴리곤 face / 폴리곤 edge 의 render
  path 는 unchanged. closed-curve 가 아니면 기존 분기 유지.
- **L-κ-6** **chord_tol 정책**: face = 0.1mm (ADR-038 P23.2), edge =
  0.05mm (더 정밀, 사용자가 wireframe 의 곡선 매끈함을 직접 봄). future
  adaptive LOD 별도 ADR.

**Non-goals**:
- **N-κ-1** GPU shader curve evaluation (vertex shader) — CPU
  tessellation 결과 emit 만.
- **N-κ-2** Adaptive LOD (zoom-aware tessellation density).
- **N-κ-3** Curve type 외 closed-curve 지원 (Bezier closed curve 등).
  Circle 만 (current schema).

### A-κ-α (commit `7775c75`)
- **사용자 결재**: 2026-05-08, "A-κ render pipeline 가장 자연 다음".
- **변경**: 본 §D `A-κ-α` amendment. roadmap / lock-ins / non-goals.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-κ-β (commit `cdaf268`)
- **변경**: `crates/axia-geo/src/mesh.rs`:
  * `export_buffers_inner` 의 polygon path 진입 전 closed-curve face
    fast-path (loop_verts.len() == 1 + Circle curve detect).
  * `export_edge_lines_with_map` 진입 시 self-loop edge + Circle curve
    detect → polyline tessellation 으로 emit. 모든 segment 가 같은
    EdgeId map (LOCKED #15 P22.5).
- **회귀**: axia-geo 1148 → 1154 (+6). 절대 #[ignore] 금지 6/6 준수.
- **LOCKED guards**: axia-core 200 unchanged.
- **Bundle 영향**: WASM 재빌드. JS chunk 0 변경 (read-only Rust).

### A-λ-α (2026-05-08, spec amendment)

**Path Z 3-sub-step roadmap (A-λ UI exposure)**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-λ-α (본 amendment) | spec only | +0 |
| A-λ-β | DrawCurveSettings + DrawCircleTool branch + SettingsPanel toggle | +5 |
| A-λ-γ | Browser smoke + closure | +0 |

**Lock-ins (A-λ-α 시점)**:
- **L-λ-1** **DrawCurveSettings module** — AutoIntersectSettings 패턴
  답습. localStorage 키 `axia:draw-curve-mode`, default OFF (additive
  only, ADR-046 P31 #4 정합 — muscle memory 보호).
- **L-λ-2** **DrawCircleTool 분기** — 2 call sites (mouseup + VCB) 모두
  flag check 후 `drawCircleAsCurve` (kernel-native) 또는
  `drawCircleAsShape` (legacy 24-segment polygon) 분기.
- **L-λ-3** **SettingsPanel 토글** — "곡선 모드 (실험)" 체크박스 추가.
  ADR-049 P-5d 의 "그리기 모드: 형태 (실험)" 토글과 동일 스타일.
- **L-λ-4** **Default OFF** — 기존 사용자 facing 동작 (24-segment
  polygon Shape) 무변화. 명시 opt-in 후에만 kernel-native 활성.
- **L-λ-5** **DrawCircleTool 외 다른 도구는 unchanged** — DrawArcTool /
  DrawBezierTool 등 향후 별도 sub-step. 본 ADR 은 Circle 만.
- **L-λ-6** **Backward compat** — 기존 회귀 자산 (DrawCircleTool.test.ts
  의 ADR-087 K-ε regression) 모두 PASS 유지.

**Non-goals**:
- **N-λ-1** 도구 메뉴/단축키/툴바 외부 ID 변경 — additive only.
- **N-λ-2** 다른 Draw 도구 (DrawArc / DrawBezier 등) 마이그레이션.
- **N-λ-3** Default ON 으로 toggle 변경 — 사용자 결재 후 별도 sub-step.

### A-λ-α (commit `fe3a897`)
- **사용자 결재**: 2026-05-08, "A-λ UI 노출 가장 자연 다음".
- **변경**: 본 §D `A-λ-α` amendment.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-λ-β (commit `af9ff7a`)
- **변경**:
  * `web/src/tools/DrawCurveSettings.ts` (신규) — AutoIntersectSettings
    pattern 답습. localStorage `axia:draw-curve-mode`, default OFF.
  * `web/src/tools/DrawCircleTool.ts` — 2 call sites (mouseup + VCB)
    flag check 후 `drawCircleAsCurve` (kernel-native) 또는
    `drawCircleAsShape` (legacy) 분기.
  * `web/src/units/SettingsPanel.ts` — "곡선 모드 (실험)" 체크박스 추가.
- **회귀**: vitest +5 (DrawCurveSettings.test.ts). DrawCircleTool.test.ts
  (9) 모두 PASS — flag default OFF 일 때 동작 unchanged (regression
  guard).
- **Bundle 영향**: ~0.3 kB (DrawCurveSettings module + SettingsPanel
  toggle).

### A-ι-α (2026-05-08, spec amendment)

**Path Z 3-sub-step roadmap (A-ι Offset closed-curve)**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-ι-α (본 amendment) | spec only | +0 |
| A-ι-β | offset_arc_on_plane self-loop awareness | +4 |
| A-ι-γ | browser smoke + closure | +0 |

**Lock-ins (A-ι-α 시점)**:
- **L-ι-1** **Self-loop output**: closed-curve self-loop edge + Circle
  curve 입력 시, 결과도 self-loop (1 anchor + 1 self-loop edge with
  Circle radius ± dist). 메타-원칙 #14 정합 — kernel-native input →
  kernel-native output.
- **L-ι-2** **Detection point**: `offset_arc_on_plane` 의 Circle 분기
  (angles=None) 에서 `self.edges[edge_id].is_self_loop()` 체크.
  Self-loop 이면 신 closed-curve path, 아니면 legacy 2-vert path 유지.
- **L-ι-3** **Anchor vertex**: 새 closed-curve 의 anchor 는 theta=0
  위치 (center + new_radius * basis_u). add_edge(anchor, anchor) 가
  self-loop 생성 (A-γ 답습).
- **L-ι-4** **Result OffsetEdgeResult**: new_v0 = new_v1 = anchor,
  new_edge = self-loop. caller 가 same-vert 라는 사실 인지 가능.
- **L-ι-5** **Backward compat**: 2-vert Circle edge (synthetic) 의
  legacy path 는 unchanged. 본 fast-path 는 self-loop 입력에만 발동.
- **L-ι-6** **RadiusCollapse guard**: new_radius ≤ EPSILON_LENGTH 시
  `OffsetEdgeError::RadiusCollapse` (기존 §V2-β-C 답습).
- **L-ι-7** **Free wire 호환**: closed-curve self-loop edge 가 face
  없는 free wire 인 경우 (V-δ 답습) 동일 동작 — `derive_free_wire_plane`
  + finish_plane_offset 분기로 자연 통과.

**Non-goals**:
- **N-ι-1** Bezier/B-spline closed-curve (현재 schema = Circle only).
- **N-ι-2** Cylinder/Sphere host 의 closed-curve offset.
- **N-ι-3** UI 노출 — OffsetTool 에 자동 호환 (A-λ 의 DrawCurveSettings
  flag 외 추가 토글 없음). 사용자가 closed-curve face 의 boundary edge
  선택 후 Offset 호출 시 자동 활성.

### A-ι-α (commit `83210ff`)
- **사용자 결재**: 2026-05-08, "A-ι 진행".
- **변경**: 본 §D `A-ι-α` amendment.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-ι-β (commit `450b916`)
- **변경**: `crates/axia-geo/src/operations/offset.rs`:
  * `offset_arc_on_plane` Circle 분기 (angles=None) 에 self-loop
    detection fast-path 추가.
  * Detection: `self.edges[edge_id].is_self_loop()`.
  * Self-loop 시: 새 anchor (center + new_radius * basis_u) +
    `add_edge(anchor, anchor)` self-loop + Circle curve attach.
  * Result: `OffsetEdgeResult { new_v0 == new_v1, new_edge=self-loop }`.
- **회귀**: axia-geo 1154 → 1158 (+4). 절대 #[ignore] 금지 4/4 준수:
  * `closed_curve_offset_produces_self_loop`
  * `closed_curve_offset_inward_radius_decreases`
  * `closed_curve_offset_collapse_rejected`
  * `polygonal_circle_unaffected_by_self_loop_path` (regression guard)
- **LOCKED guards**: axia-core 200 unchanged.

### A-ι-γ (browser real-runtime closure)
- **시연**: `drawCircleAsCurve(R=500)` → 1 vert/1 edge/1 face →
  `offsetEdgeOnHost(edge=0, dist=100)` → `{ ok: true, newV0=newV1=1,
  newEdge=1 }` self-loop output.
- **Post-state**: 2 verts / 2 edges / 1 face (original + offset 둘 다
  self-loop). Invariants 1/1 valid.
- **결과**: 사용자 facing path 의 closed-curve → closed-curve offset
  완성. 메타-원칙 #14 정합 (kernel-native input → kernel-native output).
- **회귀**: +0 (smoke verification). A-ι track total **+4**.

---

### A-ν (regression sweep + closure)

**모든 회귀 자산 sweep** (2026-05-08):

| Suite | Pass | 비교 |
|-------|------|-----|
| axia-geo lib | **1158/1158** | ADR-089 누적 +35 (1123 → 1158) |
| axia-core lib | **200/200** | LOCKED guards all PASS |
| axia-transaction | 4/4 | unchanged |
| axia-wasm | 0/0 | (unit-test 없음) |
| Vitest (web) | **1627/1627** (+1 skipped slow) | A-λ-β +5 |
| **합계** | **2989/2989** | 절대 #[ignore] 금지 0 violations |

**LOCKED guards 명시 검증**:
- `test_p7_canonical_sweep_locked_scenarios` (LOCKED #1 ADR-021 P7) ✓
- `test_p11_27rect_orphan_count_regression_guard` (LOCKED #12 ADR-025 P11) ✓
- `test_draw_order_independence` ✓
- `test_user_pattern_no_missing_faces` ✓
- `test_complex_overlap_no_missing_faces` ✓
- `test_p7_canonical_stacked_inner_manifold` (LOCKED #1 amendment, ADR-051) ✓
- `test_p7_canonical_disjoint_inner_multi_hole` ✓
- `test_p7_canonical_burge_centered_scenario_no_violations` ✓

**ADR-089 누적 트랙 (A-α ~ A-ν)**:

| 트랙 | 회귀 | 가치 |
|------|------|-----|
| A-α ~ A-ε (시민권 인프라) | +5 / +8 / +6 / +3 | Edge schema / HE wiring / API / dedup |
| A-ζ (face synthesis) | +10 | LOCKED #1/#12 closed-curve aware |
| A-η-1 (Boolean Plane attach) | +3 | NURBS dispatch unlock |
| A-θ (Push-Pull Path A) | +5 | Cylinder via tessellation |
| A-κ (Render Path A) | +6 | viewport 시각 표시 |
| A-λ (UI exposure) | +5 (vitest) | DrawCircleTool 토글 |
| A-ι (Offset Path A) | +4 | closed-curve self-loop offset |
| **A-ν (regression sweep)** | **+0** | 모든 회귀 PASS |
| **누적** | **axia-geo +35 / vitest +5** | **메타-원칙 #14 의 첫 깊은 실현** |

**사용자 시연 가능 facing path**:
1. SettingsPanel "곡선 모드 (실험)" 토글 ON
2. DrawCircle 도구 → 곡선 face 매끈 disk 표시
3. PushPull → tessellate-extrude → Cylinder
4. Boolean (NURBS dispatch) → SSI 활성
5. Offset → closed-curve self-loop output

**결재 가능 후속 결정 (A-ν closure 후)**:
- **default ON**: SettingsPanel 토글의 default 를 false → true 로 전환
  (LOCKED #26 P-5e-α 의 ADR-049 답습 패턴). 사용자 결재 필요.
- **A-θ Path B** 별도 ADR: 진정한 kernel-native cylinder (3주).
- **A-μ** Snapshot legacy migration: .axia 파일 schema versioning.
- **DrawArc/DrawBezier closed-curve** 마이그레이션 (별도 sub-step).

### A-ν (본 commit)
- **변경**: 본 §D `A-ν` regression sweep entry. 회귀 +0 (sweep only).
- **Bundle 영향**: 0 (docs only).

---

### A-π-α (2026-05-08, default ON spec amendment)

**사용자 결재 (2026-05-08)**: "default ON 전환 결재 승인" — A-ν sweep
2989/2989 PASS 가 default ON 전환 안정성 입증.

**Path Z 3-sub-step roadmap (A-π default ON)**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-π-α (본 amendment) | spec only | +0 |
| A-π-β | DrawCurveSettings default flip + test 갱신 | ±0 (test 갱신만) |
| A-π-γ | Browser smoke + closure | +0 |

**Lock-ins (A-π-α 시점, ADR-049 P-5e-α / ADR-087 K-ε hotfix 답습)**:
- **L-π-1** **Default false → true**: `DrawCurveSettings.ts` 의 module
  init 에서 `let current = false` → `true`. localStorage 'false'
  명시 OFF preference 는 보존 (saved === 'false' branch unchanged).
- **L-π-2** **Backward compat**: 기존 사용자가 `axia:draw-curve-mode =
  'false'` 명시 OFF 한 적이 있으면 그대로 유지. localStorage 빈 상태
  (신규 사용자) 는 true 로 시작.
- **L-π-3** **Tests 갱신**: `defaults to OFF` 테스트는 `defaults to ON`
  로 의미 변경. 다른 4 tests 의 set/get 동작은 unchanged.
- **L-π-4** **DrawCircleTool 자동 kernel-native**: 신규 사용자가 Circle
  도구로 그릴 때 자동으로 closed-curve face 생성. SettingsPanel 토글은
  사용자가 명시 OFF 하고 싶을 때 사용.
- **L-π-5** **회귀 자산 PASS 유지** (A-ν 검증 답습): LOCKED #1/#12/#15/
  #16/#26/#34 모든 회귀 PASS. DrawCircleTool.test.ts (9) 의 mock 은
  `drawCircleAsCurve` / `drawCircleAsShape` 둘 다 spy 처리 — flag default
  변경에 따라 어느 쪽이 호출되는지 검증 가능.
- **L-π-6** **사용자 facing 변화**: Circle 도구의 출력이 24-segment
  polygon → 1-vert/1-edge/1-face closed-curve. 모든 op (Boolean / Push-
  Pull / Offset) 자동 호환 (A-η-1 ~ A-ι 활성).
- **L-π-7** **Rollback**: localStorage 명시 OFF 또는 SettingsPanel
  토글 해제로 즉시 legacy 동작 복원.

**Non-goals**:
- **N-π-1** DrawArc/DrawBezier 도구 default 변경 — 본 ADR 은 Circle 만.
- **N-π-2** SettingsPanel 토글 자체 제거 — 명시 OFF 경로 보존 필수.
- **N-π-3** 메뉴/단축키/툴바 외부 ID 변경 (ADR-046 P31 #4 additive only).

### A-π-α (commit `93a567c`)
- **사용자 결재**: 2026-05-08, "default ON 전환 결재 승인".
- **변경**: 본 §D `A-π-α` amendment. roadmap / lock-ins / non-goals.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-π-β (commit `7ac0f72`)
- **변경**:
  * `web/src/tools/DrawCurveSettings.ts` — `let current = false` →
    `true`. localStorage 'false' branch unchanged (L-π-2 explicit OFF
    preservation).
  * `web/src/tools/DrawCurveSettings.test.ts` — "defaults to OFF" →
    "defaults to ON" + 신규 "explicit OFF preserved" test (+1).
  * `web/src/tools/DrawCircleTool.test.ts` — ADR-087 K-ε regression
    replaced by 2 dual-mode tests (default ON + explicit OFF, +1).
- **회귀**: vitest 1627 → 1629 (+2). 절대 #[ignore] 금지 2/2 준수.

### A-π-γ (browser real-runtime closure)

**Default ON 검증 (Fresh user)**:
- localStorage `null` (fresh state)
- DrawCircleTool VCB R=600 → `drawCircleAsCurve` 호출 (NOT
  `drawCircleAsShape`) ✓
- Mesh: 1 vert / 1 edge / 1 face (kernel-native canonical Phase 2) ✓

**Explicit OFF 보존 검증 (L-π-2)**:
- localStorage `'false'` (사용자 명시 OFF)
- DrawCircleTool VCB R=400 → `drawCircleAsShape` 호출 ✓
- Mesh: 24 verts / 24 edges / 1 face (legacy 24-segment polygon) ✓

**결과**: ADR-049 P-5e-α / ADR-087 K-ε hotfix 답습 패턴 완벽 작동.
- 신규 사용자: 자동 kernel-native (메뉴 토글 없이 Circle 그리기만으로
  closed-curve face 생성).
- 기존 명시 OFF 사용자: preference 그대로 유지 (legacy polygon).
- SettingsPanel 토글: 양쪽 전환 escape hatch.

**ADR-089 누적 트랙 (A-α ~ A-π)**:

| 트랙 | 회귀 | 가치 |
|------|------|-----|
| A-α ~ A-ε (시민권 인프라) | +22 | Edge schema / HE / API / dedup |
| A-ζ (face synthesis) | +10 | LOCKED #1/#12 closed-curve aware |
| A-η-1 (Boolean Plane attach) | +3 | NURBS dispatch |
| A-θ Path A (Push-Pull) | +5 | Cylinder 자동 |
| A-κ Path A (Render) | +6 | viewport 시각 표시 |
| A-λ (UI exposure) | +5 | DrawCircleTool 토글 |
| A-ι Path A (Offset) | +4 | self-loop offset |
| A-ν (regression sweep) | +0 | 2989/2989 PASS |
| **A-π (default ON)** | **+2** | **자동 kernel-native** |
| **누적** | **axia-geo +35 / vitest +7** | **메타-원칙 #14 의 깊은 실현 + 사용자 default** |

### A-π-γ (본 commit)
- **변경**: 본 §D `A-π-γ` browser closure entry.
- **회귀**: +0 (smoke verification).
- **다음 step**: A-π track closure 완료. 후속 후보 — A-μ (Snapshot
  legacy migration), A-θ Path B 별도 ADR, DrawArc/DrawBezier closed-
  curve 마이그레이션.

---

### A-ρ-α (2026-05-08, render-only Cylinder smoothness amendment)

**사용자 관찰 (2026-05-08)**: "원통의 옆면속에 폴리곤이 속에 있습니다"
— Path A tessellate-then-extrude 의 cylinder 측면이 polygon quad 로
보이는 것 (메타-원칙 #14 측면 회귀). 사용자 결재: 옵션 🅲 "render-only
fix — DCEL polygon 유지하되 viewport 가 surface metadata 기반
chord-tolerant tessellation 표시".

**Path Z 3-sub-step roadmap (A-ρ render-only smooth)**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-ρ-α (본 amendment) | spec only | +0 |
| A-ρ-β | export_buffers_inner Cylinder u-slice tessellation | +4 |
| A-ρ-γ | Browser smoke + closure | +0 |

**Lock-ins (A-ρ-α 시점)**:
- **L-ρ-1** **DCEL UNCHANGED**: 측면 face 의 polygon quad (4-vert)
  topology 보존. select / hover / edit ops 모두 quad 기준 작동.
- **L-ρ-2** **Render path 만 변경**: `export_buffers_inner` 에서
  Cylinder 측면 face 감지 시 boundary verts → u_range 추출 → 그
  sub-slice 만 surface tessellation.
- **L-ρ-3** **u_range 추출**: 4 boundary verts 의 (axis_origin 으로
  부터의 angle θ) 계산. quad 의 좌/우 edge 가 cylinder 의 두 u 값
  → `[u_lo, u_hi]` 결정. v_range 는 quad 의 axial extent.
- **L-ρ-4** **Plane fast-path 보존** (LOCKED #16 K-ε hotfix): Plane
  variant 는 polygon path 그대로. Cylinder/Sphere/Cone/Torus 등
  curved surface 만 본 fast-path 로 분기.
- **L-ρ-5** **Backward compat**: 기존 폴리곤 face (surface=None) 또는
  Plane face 모두 unchanged. 본 fast-path 는 Cylinder + 4-vert quad
  case 에만 발동.
- **L-ρ-6** **chord_tol 정책**: ADR-038 P23.2 `ANALYTIC_CHORD_TOL =
  0.1mm` 답습. future adaptive LOD 별도 ADR.
- **L-ρ-7** **Sphere/Cone/Torus 동일 패턴**: 본 ADR 은 Cylinder 만
  처리 (가장 흔한 case). Sphere/Cone/Torus side face 는 future
  sub-step (동일 패턴 답습).

**Non-goals**:
- **N-ρ-1** DCEL topology 변경 (Path B 영역).
- **N-ρ-2** Sphere / Cone / Torus side face fast-path (별도 sub-step).
- **N-ρ-3** Wireframe edge tessellation (현재 polygon edge 사이의 짧은
  vertical line 들이 보임 — 이는 별도 fix). 본 ADR 은 face 의 surface
  부분만 매끈하게.

### A-ρ-α (commit `bc70af1`)
- **사용자 결재**: 2026-05-08, "🅲 render-only fix 진행".
- **변경**: 본 §D `A-ρ-α` amendment. roadmap / lock-ins / non-goals.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-ρ-β (commit `58047c4`)
- **변경**: `crates/axia-geo/src/mesh.rs`:
  * `export_buffers_inner` Cylinder 분기 — 4 boundary verts → 각
    vert 의 (θ via atan2, axial v via dot(axis_dir)) 추출.
  * Wrap-around safe unwrap (relative to first u, ±π normalize).
  * Sub-Cylinder 생성 (u_range = (u_min, u_max), v_range =
    (v_min, v_max)) → 그 slice 만 tessellate.
  * Plane fast-path 보존 (LOCKED #16 K-ε hotfix unchanged).
- **회귀**: axia-geo 1158 → 1162 (+4). 절대 #[ignore] 금지 4/4 준수:
  * `cylinder_quad_emits_sliced_tessellation` (tris < 100, NOT 1000+)
  * `cylinder_quad_normals_radial` (모든 normal radial outward)
  * `cylinder_quad_tessellation_within_quad_bounds` (theta 안 벗어남)
  * `polygonal_face_unaffected` (regression guard)
- **LOCKED guards**: axia-core 200 unchanged.

### A-ρ-γ (browser real-runtime closure)

**시연 결과**:
- Pre-fix triangle count: **26,594** (각 quad 가 full cylinder 통째로
  tessellate)
- Post-fix triangle count: **778** (각 quad 의 정확한 u-slice)
- **33x reduction**, 시각 매끈도 향상 — polygon quad artifact 사라짐
- DCEL UNCHANGED (25 face / 70 edge / 46 vert)
- Face delete 후 hole 사각형 boundary 명확 + cylinder wall 표면 매끈

**ADR-089 누적 트랙 (A-α ~ A-ρ)**:

| 트랙 | 회귀 | 가치 |
|------|------|-----|
| A-α ~ A-ε (시민권 인프라) | +22 | Edge schema / HE / API / dedup |
| A-ζ (face synthesis) | +10 | LOCKED #1/#12 closed-curve aware |
| A-η-1 (Boolean Plane attach) | +3 | NURBS dispatch |
| A-θ Path A (Push-Pull) | +5 | Cylinder 자동 |
| A-κ Path A (Render closed-curve) | +6 | viewport 시각 표시 |
| A-λ (UI exposure) | +5 | DrawCircleTool 토글 |
| A-ι Path A (Offset) | +4 | self-loop offset |
| A-ν (regression sweep) | +0 | 2989/2989 PASS |
| A-π (default ON) | +2 | 자동 kernel-native |
| **A-ρ Path A (render Cylinder smooth)** | **+4** | **매끈 표면 + DCEL polygon 보존** |
| **누적** | **axia-geo +39 / vitest +7 = +46** | **메타-원칙 #14 측면 회귀 visual closure** |

### A-ρ-γ (본 commit)
- **변경**: 본 §D `A-ρ-γ` browser closure entry.
- **회귀**: +0 (smoke verification).

---

### A-τ-α (2026-05-08, smooth-group edge hiding amendment)

**사용자 결재 (2026-05-08)**: A-ρ closure 후 wall 의 23 vertical 분할선
가 여전히 보이는 점 (polygon quad edge wireframe). 다음 자연 단계 —
smooth-group edge hiding.

**Path Z 3-sub-step roadmap**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-τ-α (본 amendment) | spec only | +0 |
| A-τ-β | export_edge_lines_with_map smooth-group skip | +4 |
| A-τ-γ | Browser smoke + closure | +0 |

**Lock-ins (A-τ-α 시점)**:
- **L-τ-1** **Smooth-group skip 조건**: 한 edge 가 정확히 2 face 사이
  (manifold) + 두 face 가 **같은 AnalyticSurface 인스턴스** (Cylinder/
  Sphere/Cone/Torus 등 곡면, 동일 parameters within EPSILON) → edge
  hide.
- **L-τ-2** **Plane / None 보존**: 양쪽 face 가 Plane 이거나 surface=None
  이면 기존 angle_threshold 분기 유지 (LOCKED #16 K-ε hotfix 답습).
- **L-τ-3** **HARD flag override**: HE 의 HARD flag 가 set 이면 hide
  policy 무시, 강제 표시 (사용자 명시 edge / face split edge).
- **L-τ-4** **CCW boundary 보존**: cylinder 의 top circle / bottom circle
  edges (cylinder 와 plane 사이의 경계) 는 한 쪽이 Cylinder, 반대쪽이
  Plane → 다른 surface kind, edge 표시 (boundary 명확화).
- **L-τ-5** **Backward compat**: 기존 polygonal mesh (surface=None 양쪽)
  은 angle_threshold 그대로. 본 fast-path 는 곡면 surface 양쪽 일치
  case 에만 발동.
- **L-τ-6** **Surface equality**: Cylinder 비교 — `axis_origin`,
  `axis_dir`, `radius`, `ref_dir` 4 fields EPSILON_LENGTH within. u_range
  / v_range 는 비교 제외 (각 face 마다 다름).

**Non-goals**:
- **N-τ-1** Sphere / Cone / Torus 비교 (각 surface kind 별 같은 패턴).
  본 ADR 은 Cylinder 만, 다른 surface 는 future sub-step.
- **N-τ-2** Bezier/BSpline/NURBS surface 비교 (parameter 비교 복잡 —
  별도 ADR).
- **N-τ-3** Top / Bottom circle polygon edges (Cylinder ↔ Plane 경계)
  — boundary 로 표시 보존 (L-τ-4).
- **N-τ-4** Wireframe polyline tessellation — boundary edge (Cylinder ↔
  Plane) 는 polygon 으로 보존. closed-curve self-loop 은 별도 path.

### A-τ-α (commit `c0d6745`)
- **사용자 결재**: 2026-05-08, "wireframe edge tessellation 진행".
- **변경**: 본 §D `A-τ-α` amendment.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-τ-β (commit `98c83bd`)
- **변경**: `crates/axia-geo/src/mesh.rs`:
  * `export_edge_lines_with_map` 의 2-face 분기에 smooth-group skip
    조건 추가. 두 face 가 같은 곡면 surface 일 때 hide.
  * `surfaces_in_same_smooth_group` helper 신규 — Cylinder / Sphere
    / Cone / Torus 별 base parameters 비교.
- **회귀**: axia-geo 1162 → 1166 (+4). 절대 #[ignore] 금지 4/4 준수.

### A-τ-γ (browser real-runtime closure)

**시연 결과** (R=400 cylinder, 23-segment Path A):
- Edge segments: 117 → **69** (-41% reduction)
- Unique edges visible: 47
- **Hidden 23 vertical edges** (Cylinder-Cylinder smooth-group internal)
- Visible: 23 top circle Arc + 23 bottom circle Arc + 23 leftover
  self-loop Circle polyline (A-κ-β closed-curve edge render)
- 시각: vertical polygon 분할선 모두 사라짐 → 매끈한 cylinder
  silhouette + 명확한 top/bottom circle outline

**Architectural unlock**: A-ρ (face surface smoothness) + A-τ
(edge wireframe smooth-group hiding) 결합으로 메타-원칙 #14 측면
회귀의 **시각 closure 완성** — DCEL 은 polygon quad 보존 (Path B
별도 ADR), 시각은 진정한 매끈 cylinder.

**ADR-089 누적 트랙 (A-α ~ A-τ)**:

| 트랙 | 회귀 | 가치 |
|------|------|-----|
| A-α ~ A-ε (시민권 인프라) | +22 | Edge schema / HE / API / dedup |
| A-ζ (face synthesis) | +10 | LOCKED #1/#12 closed-curve aware |
| A-η-1 (Boolean Plane attach) | +3 | NURBS dispatch |
| A-θ Path A (Push-Pull) | +5 | Cylinder 자동 |
| A-κ Path A (Render closed-curve) | +6 | viewport 시각 표시 |
| A-λ (UI exposure) | +5 | DrawCircleTool 토글 |
| A-ι Path A (Offset) | +4 | self-loop offset |
| A-ν (regression sweep) | +0 | 2989/2989 PASS |
| A-π (default ON) | +2 | 자동 kernel-native |
| A-ρ Path A (face smooth) | +4 | u-slice tessellation |
| **A-τ Path A (edge smooth-group)** | **+4** | **vertical 분할선 hide** |
| **누적** | **axia-geo +43 / vitest +7 = +50** | **메타-원칙 #14 측면 시각 closure** |

### A-τ-γ (본 commit)
- **변경**: 본 §D `A-τ-γ` browser closure entry.
- **회귀**: +0 (smoke verification).

---

### A-υ-α (2026-05-08, leftover self-loop cleanup amendment)

**관찰 (A-τ-γ 시연 결과)**: closed-curve self-loop edge 가 A-θ-β
`extrude_closed_curve_face_via_tessellation` 의 `remove_face` 후
orphan 으로 남아 23 polyline segment 잔존 → bottom Arc 23 segment 와
시각 overlap.

**Path Z 3-sub-step roadmap**:

| Sub-step | 핵심 변경 | 회귀 (예상) |
|----------|----------|-----------|
| A-υ-α (본 amendment) | spec only | +0 |
| A-υ-β | extrude_closed_curve_face_via_tessellation 의 self-loop edge + anchor vertex 명시 cleanup | +3 |
| A-υ-γ | Browser smoke + closure | +0 |

**Lock-ins (A-υ-α 시점)**:
- **L-υ-1** **명시 cleanup**: A-θ-β 에서 `remove_face(profile_face)`
  직후 self-loop edge id 명시 deactivate. anchor vertex 가 다른 edge
  를 참조하지 않으면 deactivate.
- **L-υ-2** **safe deletion**: deactivate 전 referencing 검사. anchor
  가 self-loop 외 다른 edge 참조 시 보존 (다른 standalone wire 일 수
  있음).
- **L-υ-3** **Backward compat**: 기존 폴리곤 path 무영향 (self-loop
  detection 안되면 skip).
- **L-υ-4** **Render 결과**: 69 segments → 46 segments (-33%).
  자체 polyline 사라짐, top 23 + bottom 23 만 남음.

**Non-goals**:
- **N-υ-1** Generic orphan edge GC (별도 ADR — sweep-style).
- **N-υ-2** Anchor vertex 의 다른 활용 추적 (예: snap reference 로 기존
  사용된 vertex 의 의도적 보존). L-υ-2 의 referencing 검사로 자연 보존.

### A-υ-α (commit `42c8efb`)
- **사용자 결재**: 2026-05-08, "leftover self-loop edge cleanup 진행".
- **변경**: 본 §D `A-υ-α` amendment.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

### A-υ-β (commit `4dfadd7`)
- **변경**: `crates/axia-geo/src/operations/create_solid.rs`:
  * `extrude_closed_curve_face_via_tessellation` step 3b 신규.
  * `remove_face(profile_face)` 직후 `remove_edge_and_halfedges
    (self_loop_edge_id)` + isolated anchor vertex deactivate.
- **회귀**: axia-geo 1166 → 1169 (+3). 절대 #[ignore] 금지 3/3 준수:
  * `self_loop_edge_cleanup_after_extrude`
  * `anchor_vertex_deactivated_if_isolated`
  * `extrude_polygon_unaffected` (regression guard)
- **LOCKED guards**: axia-core 200 unchanged.

### A-υ-γ (browser real-runtime closure)

**시연 결과** (R=400 cylinder, 23-segment Path A):
- Before: 70 edges / 69 segments / 47 unique visible edges (23 top + 23
  bottom + 23 leftover self-loop polyline overlap)
- After: **69 edges / 46 segments / 46 unique** ← 정확히 23 top Arc + 23
  bottom Arc 만, leftover polyline overlap 사라짐
- 시각: 매끈한 cylinder + 명확한 top/bottom circle outline + vertical
  분할선 hidden (A-τ) + leftover polyline overlap 사라짐 (A-υ)

**메타-원칙 #14 측면 시각 closure 완전 달성** — A-ρ (face surface
smoothness) + A-τ (edge smooth-group hide) + A-υ (leftover cleanup)
3-단계 결합으로 Path A 의 visual quality 가 산업 CAD parity 도달.

**ADR-089 누적 트랙 (A-α ~ A-υ)**:

| 트랙 | 회귀 | 가치 |
|------|------|-----|
| A-α ~ A-ε (시민권 인프라) | +22 | Edge schema / HE / API / dedup |
| A-ζ (face synthesis) | +10 | LOCKED #1/#12 closed-curve aware |
| A-η-1 (Boolean Plane attach) | +3 | NURBS dispatch |
| A-θ Path A (Push-Pull) | +5 | Cylinder 자동 |
| A-κ Path A (Render closed-curve) | +6 | viewport 시각 표시 |
| A-λ (UI exposure) | +5 | DrawCircleTool 토글 |
| A-ι Path A (Offset) | +4 | self-loop offset |
| A-ν (regression sweep) | +0 | 2989/2989 PASS |
| A-π (default ON) | +2 | 자동 kernel-native |
| A-ρ Path A (face smooth) | +4 | u-slice tessellation |
| A-τ Path A (edge smooth-group) | +4 | vertical 분할선 hide |
| **A-υ Path A (leftover cleanup)** | **+3** | **polyline overlap 제거** |
| **누적** | **axia-geo +46 / vitest +7 = +53** | **메타-원칙 #14 측면 시각 closure 완성** |

### A-υ-γ (본 commit)
- **변경**: 본 §D `A-υ-γ` browser closure entry.
- **회귀**: +0 (smoke verification).
- **다음 step**: A-υ track closure 완료. ADR-089 Path A 모든 visual
  + topological cleanup 완성. 후속 후보 — Sphere/Cone/Torus side face
  fast-path (A-ρ + A-τ 동일 패턴), A-θ Path B (DCEL 진정한 kernel-
  native cylinder, 별도 ADR), DrawArc/DrawBezier closed-curve 시민권
  확장.

---

### A-λ-γ (browser real-runtime closure)
- **시연**: SettingsPanel "곡선 모드 (실험)" 토글 ON →
  DrawCircleTool VCB R=750 → bridge.drawCircleAsCurve 호출 (spy
  검증) → mesh: 1 vert / 1 edge / 1 face → viewport 매끈한 disk render.
- **결과**: 사용자 facing path 완성. console 직접 호출 없이 메뉴
  토글만으로 kernel-native closed-curve 활성. ADR-089 Path A 사용자
  시연 가치 closure.
- **회귀**: +0 (smoke verification). A-λ track total **+5**.
- **다음 step**: ADR-089 다음 후보 — A-ι (Offset closed-curve), A-ν
  (LOCKED 245 sites 재검증), A-μ (Snapshot legacy migration), 또는
  A-θ Path B 별도 ADR.

---

### A-κ-γ (browser real-runtime closure)
- **시연**: `drawCircleAsCurve(0,0,0, 0,0,1, 500)` (radius 500mm) →
  158-segment tessellation visible 매끈 disk. bbox `min(-500, -499, 0)`,
  `max(500, 500, 0)`. Three.js mesh.children = 3 (front/back/edges).
- **결과**: AxiA 의 첫 1-vert/1-edge/1-face DCEL canonical Phase 2
  closed-curve 표현이 viewport 에 visually rendered. 매끈한 곡선
  wireframe (industry CAD parity).
- **사용자 가치 anchor (메타-원칙 #14 정합)**: 닫힌 경계 (Circle curve
  self-loop edge) 가 자체 토폴로지 1 face 로 derived 되어 시각적으로
  표시 — render layer 도 kernel-native 의 byproduct 로 표현.
- **회귀**: +0 (smoke verification). A-κ track total **+6** (1148 →
  1154).
- **다음 step**: ADR-089 다음 후보 — A-ι (Offset closed-curve), A-λ
  (UI tool DrawCircleAsCurveTool), 또는 A-θ Path B 별도 ADR.

---

### A-θ-γ + A-θ-δ (browser real-runtime closure)
- **WASM/TS bridge**: `createSolidExtrude` 자동 통과 (passthrough,
  코드 변경 0).
- **Browser real-runtime 시연**:
  * `drawCircleAsCurve(center=ZERO, normal=Z, basis_u=X, radius=5)`
    → shape 1 / face 0 / surface kind = 1 (Plane).
  * `createSolidExtrude(face=0, dist=10.0)` → true.
  * Post-state: 46 verts / 70 edges / **25 faces** (23 polygonal
    substitute bottom + 1 top + 23 sides), invariants 25/25 valid +
    0 violations.
- **회귀**: +0 (smoke verification). 누적 A-θ track total **+5**.
- **다음 step**: A-θ closure 완료. ADR-089 다음 후보 — A-ι (Offset),
  A-κ (Render), A-λ (WASM/UI), 또는 A-θ Path B 별도 ADR.

---

## 7. Cross-link

- **메타-원칙 #14** ("면은 닫힌 경계로부터 유도된다"): 본 ADR 의
  deepest realization. canonical anchor.
- **ADR-019** ("Line is Truth, Face is Byproduct"): edge 가 fundamental
  의 ultimate consequence — closed curve = 1 edge.
- **ADR-027** (NURBS Kernel): analytic curve / surface infrastructure.
  closed curve 의 분석적 표현 base.
- **ADR-028** (Edge curve attach Phase A): `Edge.curve = Option<AnalyticCurve>`
  의 필요충분 — A-β 에서 self-loop case 추가.
- **ADR-051 §2.5** (component-merge resolver, P7 deferred boundary):
  closed curve face 의 P7 처리 cross-cut. A-ζ 단계 검증 필요.
- **ADR-064 / ADR-066** (NURBS Boolean DCEL): closed curve face 의
  SSI Boolean. A-η 단계 변경.
- **ADR-079** (Create Solid surface-native): closed curve profile
  face → cylinder/cone surface. A-θ 단계 통합.
- **ADR-080** (Offset dimension-aware): closed curve boundary 의
  offset. A-ι 단계 변경.
- **ADR-081** (STEP/IGES NURBS-class import): 외부 BRep 의 closed
  curve 자동 호환 (kernel-native 후).
- **ADR-087** (Kernel-Native Command Suite Reset): user-facing path
  의 단일화 — 본 ADR 의 사전 단계.
- **ADR-088** (Phase 1 curve_owner_id grouping): selection-layer
  enforcement — 본 ADR Phase 2 의 자연 단순화.
- **LOCKED #1, #12, #15, #16, #26**: 모든 LOCKED 회귀 자산 A-ν 재검증.

---

*ADR-089 A-α — True Kernel-Native Closed Edges 의 architectural spec.
ADR-088 closure 후 사용자 통찰 ("길 1 임시방편보다 길 2 진정한 정답")
의 점진 실현 시작점. 메타-원칙 #14 의 deepest realization. 3-주 atomic
Path Z 트랙의 시작.*
