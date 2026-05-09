# ADR-092: Push-Pull Top Boundary Closed-Curve Preservation (Partial Path B Atomic)

- **Status**: Proposed (C-α spec only)
- **Date**: 2026-05-09
- **Anchor**: 메타-원칙 #14 ("면은 닫힌 경계로부터 유도된다") + ADR-089
  closed-curve citizenship + ADR-090 Path B (deferred)
- **User trigger**: 시연 회귀 — DrawCircle → PushPull 시 상단 rim 이
  polygon 으로 보임 ("현재 원에 대한 완벽한 처리가 안되고 있습니다",
  2026-05-09)

## 1. Context

ADR-089 closed-curve citizenship 활성으로 DrawCircle 직후 시점은
1 anchor + 1 self-loop edge with `AnalyticCurve::Circle` + 1 face
(canonical Phase 2 표현). A-κ Render fast-path 가 매끈한 wireframe
보장.

그러나 **Push-Pull (A-θ Path A) 통과 시 closed-curve metadata 가
영구 상실**:
- Path A 단계 1 — closed-curve face → `AnalyticCurve::tessellate(chord_tol)`
  로 N 직선 polygon 변환
- 단계 2 — N 정점에서 quad side faces N개 (Cylinder surface 부착)
- **단계 3 — top face 가 N 직선 Line edges 로 구성** (Circle metadata 없음)

결과: 상단 rim 이 polygon 으로 보임 (사용자 시연 결함 1).

ADR-019 ("Line is Truth, Face is Byproduct") + 메타-원칙 #14 의 깊은
의미를 위반 — engine 의 truth 가 polygon, 사용자 의도 (Circle) 와 불일치.

## 2. Decision

**Push-Pull (A-θ Path A) 통과 시 top face 의 boundary 를 closed-curve
self-loop edge 로 보존**한다. 4 곡선 type (Circle/Bezier/BSpline/NURBS)
모두 동일 처리. Side faces 는 unchanged (N quad faces with Cylinder
surface — ADR-089 A-θ Path A 답습).

ADR-090 Path B 의 partial atomic 추출 — top boundary 만 kernel-native,
side 는 여전히 polygon. Path B 본격 진입 (multi-week) 의 자연 prerequisite.

### 2.1 Architecture

**현재 (ADR-089 A-θ Path A)**:
```
DrawCircle → 1 vert + 1 self-loop edge (Circle) + 1 Plane face
  ↓ Push-Pull
extrude_closed_curve_face_via_tessellation:
  ① tessellate Circle → N polygon points (chord_tol = 1.5mm)
  ② create N side quad faces (Cylinder surface)
  ③ create top face from N polygon edges (no curve metadata) ← 결함 1
```

**ADR-092 후 (정정 — manifold-safe)**:
```
DrawCircle → 1 vert + 1 self-loop edge (Circle) + 1 Plane face
  ↓ Push-Pull
extrude_closed_curve_face_via_tessellation:
  ① tessellate Circle → N polygon points (chord_tol = 1.5mm) — UNCHANGED
  ② Bottom (substitute) face N edges 에 Arc curves 부착 — UNCHANGED
     (existing code line 656-670)
  ③ extrude_planar_cylinder recurse — UNCHANGED (top + N side quads)
  ④ TOP face N edges 에 Arc curves 부착 (translated center)         ← NEW
     · DCEL topology unchanged (manifold 보존)
     · Render path (A-κ Arc tessellation) 가 N Arc 들을 sampling
       → 시각적으로 매끈한 ring 으로 보임
```

**Manifold-safe 정정 사유**:
- 원안 (1 self-loop edge with Circle on top face) 은 side quads 의 top
  boundary edges 가 boundary edges (1 incident face) 가 되어 솔리드 개방
  → `verify_p7_manifold` 위반.
- 정정안: Top face 와 side quads 가 *같은 edge 들* 을 공유 (DCEL
  unchanged) + 그 edges 에 Arc metadata 추가. Manifold 보존, 시각
  smoothness 동등 (Arc N개 = Circle 1개 의 segment 분해).

Side ↔ top topology (정정):
- Top face 와 side N quads 는 N edges 를 manifold 공유 (각 edge 2 incident
  faces). 변경 없음.
- 새로 추가되는 것은 **edge metadata** 만 (Arc curve 부착) — render
  path (A-κ 답습) 가 자동 활용.

### 2.2 Lock-ins (canonical)

- **L1 — Top boundary preservation (정정)**: closed-curve face 의
  Push-Pull 결과 top face 의 N polygon edges 에 `AnalyticCurve::Arc`
  부착 (translated center). Bottom 답습 (existing step 6). DCEL
  unchanged (manifold-safe). Render fast-path (A-κ Arc tessellation)
  자동 활용.
- **L2 — Side faces unchanged**: N quad faces with `AnalyticSurface::
  Cylinder` (Path A 답습). 측면 시각 smoothness 는 A-ρ uv-slice 가 처리.
- **L3 — Bottom face unchanged**: 원본 closed-curve 보존 (이미 1
  self-loop edge with Circle).
- **L4 — Curve translation**: `AnalyticCurve` 의 in-place / clone-then-
  translate. Circle 은 center 만 translation, Bezier/BSpline/NURBS 는
  control_pts 모두 translation, knots/weights 는 invariant.
- **L5 (정정) — DCEL topology unchanged**: Top face 와 side quads 가
  N edges manifold 공유. 변경 없음. 추가는 metadata (Arc curve) 만.
- **L6 — Render**: A-κ closed-curve fast-path 자동 적용 — top rim 매끈.
- **L7 — Manifold invariant**: `verify_p7_manifold` (LOCKED #1 ADR-051)
  + ADR-007 winding 강제. top face winding 은 normal 방향 (extrude
  vector 의 부호) 자동 정합.
- **L8 — Boolean / Offset / Push-Pull again 보너스**: top edge 의
  analytic Circle 메타데이터를 후속 op 가 활용 가능 (ADR-064/066 NURBS
  dispatch + ADR-080 Offset Plane Circle 분기).
- **L9 — additive only (ADR-046 P31 #4)**: 메뉴/단축키/툴바 외부 ID 0
  변경. Push-Pull 도구의 사용자 인터페이스는 unchanged.

### 2.3 Decision Matrix (C-A ~ C-H)

| ID | 결정 | 채택 |
|----|------|------|
| C-A | top boundary preservation | N polygon edges with `AnalyticCurve::Arc` (translated center). DCEL unchanged. |
| C-B | side faces 처리 | unchanged — N quad faces with `AnalyticSurface::Cylinder` (Path A 답습) |
| C-C | bottom face | unchanged |
| C-D | 곡선 type 지원 | **MVP: Circle 만** (현재 `extrude_closed_curve_face_via_tessellation` 가 Circle 만 지원). Bezier/BSpline/NURBS 는 별도 후속 — 본 ADR scope 외. |
| C-E | render | A-κ Arc tessellation fast-path 자동 |
| C-F | manifold invariant | verify_p7_manifold + ADR-007 |
| C-G | top ↔ side topology | manifold edge sharing 보존 |
| C-H | curve construction | `AnalyticCurve::Arc` 새 instance with translated center (clone-then-mutate-center) |

## 3. Path Z Atomic Decomposition (5 sub-step)

| sub-step | 영역 | 회귀 예상 |
|---|---|---|
| **C-α** | spec only (본 commit) | 0 |
| **C-β** | Rust core — `extrude_closed_curve_face_via_tessellation` top face 분기 + `AnalyticCurve::translate` 메서드 (또는 동등) | axia-geo +5~7 |
| **C-γ** | 4 곡선 type 회귀 (Circle/Bezier/BSpline/NURBS) + invariant 보존 + side polygon 하위 호환 | axia-geo +3 |
| **C-δ** | 사용자 시연 게이트 (K-ζ 답습) — browser real Chromium DrawCircle → PushPull → top rim wireframe 매끈 확인 | Playwright +1~2 |
| **C-ε** | closure — LOCKED #35 amendment + ADR-090 §6 Path B trigger 가이드 갱신 (ADR-092 후에도 결함 2 잔존 시 Path B 결재 가이드) | 0 |

**누적 회귀 예상**: axia-geo +8~10, Playwright +1~2 = **+10~12**.
절대 #[ignore] 금지 정책 준수.

## 4. ADR-090 Path B 와의 관계

ADR-092 = **ADR-090 Path B 의 partial atomic 추출**:

| 결함 | ADR-092 (현재 트랙) | ADR-090 Path B (deferred) |
|---|---|---|
| 결함 1 — top rim polygon | ✅ 해결 (engine + render 정합) | ✅ 해결 (자연) |
| 결함 2 — side as N quads (hover/select) | ❌ 미해결 | ✅ 해결 (single cylindrical face) |
| Boolean SSI 정밀도 | top edge ✅ / side ❌ | 양쪽 ✅ |
| 메모리 비용 | side N quads (Path A 답습) | top + side 각 1 face |

**ADR-092 closure 후 의사결정 트리거**:
1. 사용자 시연으로 결함 2 의 실 사용자 영향 측정
2. 영향 작음 → Path B 보류, ADR-090 §6 trigger 매트릭스 유지
3. 영향 큼 → ADR-090 Path B 결재 트리거 활성 → multi-week atomic

## 5. 위험 분석

- **L1 (낮음)**: top anchor vert 위치 — top center vs boundary point.
  권장: 원본 anchor vert 의 translation (자연성 + 구현 단순). pinch
  case (LOCKED #9 ADR-022 P9) 자연 호환.
- **L2 (낮음)**: top closed-curve edge 와 side top boundary edges 의
  vertex 공유 — 0 으로 명시 분리 (L5 lock-in). DCEL 정합.
- **L3 (낮음)**: snapshot bincode 호환 — `AnalyticCurve::translate`
  추가는 enum variant 변경 없음, 기존 bincode roundtrip 영향 0.
- **L4 (낮음)**: 후속 ADR-080 Offset 등이 top edge 의 Circle metadata
  를 사용 — **보너스 (L8)**, 자연 활성화.
- **L5 (중간)**: 사용자 시연 게이트 (C-δ) — "rim 매끈" 의 정량 기준 +
  Playwright 가시 검증의 한계. visual regression baseline (ADR-077) 인프라
  활용 가능.

## 6. Out of Scope

- ADR-090 Path B 본격 — side 의 single cylindrical face. 본 ADR closure
  후 결재 트리거 활성.
- 측면 hover/select 의 single-face semantic — Path B 의 핵심 미진행.
- chord_tol 강화 — 현재 1.5mm 유지 (Path B 진입 시 재검토).
- 다른 도형 (Box / Cone primitive 등) 의 push-pull 통과 — primitive
  는 이미 surface metadata 직접 부착 (ADR-087 K-δ).

## 7. 회귀 방지 (절대 #[ignore] 금지)

C-β 단계 신규:
- `pushpull_circle_top_preserves_circle_curve`
- `pushpull_bezier_top_preserves_bezier_curve`
- `pushpull_bspline_top_preserves_bspline_curve`
- `pushpull_nurbs_top_preserves_nurbs_curve`
- `pushpull_circle_top_curve_translated_correctly` — translate vector 정합
- `pushpull_circle_side_unchanged_path_a` — regression guard (L2)
- `pushpull_circle_top_anchor_vert_separate_from_side_verts` — DCEL 정합 (L5)

C-γ: invariant 보존 (verify_p7_manifold 0 violations) + winding (ADR-007
+ surface_normal hint).

C-δ: Real Chromium — DrawCircle → PushPull → bridge 의 edge polyline
sample 검증 (top boundary 의 polyline 이 chord-tolerant smooth).

## D. Acceptance Log

### C-α (본 commit)
- **사용자 결재**: 2026-05-09, "진입 승인합니다".
- **변경**: 본 ADR 작성. 사용자 시연 회귀 기록 (DrawCircle →
  PushPull → top rim polygon).
- **회귀**: +0 (docs only).

### C-β (본 commit)
- **사용자 결재**: 2026-05-09, "승인 진행합니다".
- **사전 검토 architectural pivot**: 원안 ("1 self-loop edge with
  translated `AnalyticCurve::Circle` on top face") 가 manifold violation
  위험 발견 — side quads 의 top boundary edges 가 boundary edges (1
  incident face) 가 되어 솔리드 개방 → `verify_p7_manifold` 실패.
  ADR §2.1 / §2.2 / §2.3 정정으로 manifold-safe 접근 명시:
  Top face 의 N polygon edges 에 `AnalyticCurve::Arc` 부착 (Bottom 의
  step 6 답습). DCEL topology unchanged (manifold 보존), Render
  fast-path (A-κ Arc tessellation) 가 N Arc 들을 sampling → 시각적으로
  매끈한 ring.
- **변경**:
  * `crates/axia-geo/src/operations/create_solid.rs::extrude_closed_curve_
    face_via_tessellation` step 8 추가 (recurse 후) — top face N edges
    iterate + translated center (`profile_normal · dist + center`) 로
    `AnalyticCurve::Arc` 부착. Loop order index `i` 그대로 사용 (Arc 는
    direction-agnostic — 양방향 sampling 동등 visual). `n_seg_top ==
    n_seg` guard 로 face_outer_edges 정합 검증.
- **회귀** (axia-geo 1200 → 1207, +7):
  * `adr092_c_beta_top_face_edges_have_arc_curves` — top 모든 N edges
    AnalyticCurve::Arc 부착 검증
  * `adr092_c_beta_top_arc_center_is_translated_from_bottom` —
    architectural anchor (top center = bottom + normal · dist)
  * `adr092_c_beta_top_arc_radius_matches_bottom` — 비-scale 변환
  * `adr092_c_beta_top_arc_normal_matches_profile` — normal inheritance
  * `adr092_c_beta_dcel_topology_unchanged_manifold_safe` — manifold
    보존 (가장 핵심 invariant)
  * `adr092_c_beta_negative_distance_translation_correct` — recess 부호
  * `adr092_c_beta_polygonal_path_unaffected` — regression guard
    (polygonal circle path 영향 0)
- **C-D scope 정정**: MVP = Circle 만. extrude_closed_curve_face_via_
  tessellation 자체가 현재 Circle 만 지원 (`AnalyticCurve::Circle` match
  arm 외 NotYetSupported error). Bezier/BSpline/NURBS 의 closed-curve
  Push-Pull 은 별도 후속 sub-step / ADR — 본 ADR scope 외.
- 누적 회귀 (C-α ~ C-β): axia-geo +7. 절대 #[ignore] 금지 7/7 준수.

### C-γ ~ C-ε (예정)
별도 sub-step 결재 시 commit 진행.
