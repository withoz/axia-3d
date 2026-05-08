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

### A-ι-α (본 commit)
- **사용자 결재**: 2026-05-08, "A-ι 진행".
- **변경**: 본 §D `A-ι-α` amendment.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.

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
