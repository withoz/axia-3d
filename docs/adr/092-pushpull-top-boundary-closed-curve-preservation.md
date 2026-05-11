# ADR-092: Push-Pull Top Boundary Closed-Curve Preservation (Partial Path B Atomic) — **Accepted**

- **Status**: Accepted (C-α ~ C-ε closure 2026-05-09)
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

### C-δ (본 commit)
- **사용자 결재**: 2026-05-09, "승인 합니다" (C-γ skip + C-δ 직진).
- **사전 검증 단계 추가 발견 (Render path gap)**: C-β 가 Arc curves 부착
  까지만 처리. Render path `export_edge_lines_with_map` 의 self-loop
  fast-path (mesh.rs:4985+) 는 self-loop edges 만 Arc/Circle tessellation
  활용. **Non-self-loop edges 의 Arc curve 는 무시되고 단일 chord 직선만
  emit** — Push-Pull 결과의 top/bottom rim 은 ADR-089 A-θ 후 N polygon
  edges 인 non-self-loop edges 라서 Arc 부착되어도 시각 변화 0.
  → Render path 도 함께 정정 필요.
- **변경**:
  * `crates/axia-geo/src/mesh.rs::export_edge_lines_with_map` —
    non-self-loop edges 의 draw 분기에 Arc curve fast-path 추가 (single
    chord 대신 chord-tolerant tessellation, edge_map 에 모든 sub-segment
    가 동일 EdgeId 매핑 — LOCKED #15 ADR-037 P22.5 owner-ID uniformity).
  * `web/e2e/adr-092-pushpull-circle-rim.spec.ts` (신규) — Real Chromium
    2 specs:
    - `top rim has Arc curves after Push-Pull on closed-curve Circle`:
      drawCircleAsCurve (closed-curve mode) → createSolidExtrude → edgeMap
      group by EdgeId → multi-segment edges ≥ 16 검증 (2N=2*8 minimum
      for radius=5).
    - `Arc-attached top edges produce visibly smoother polyline than
      straight lines`: avgSegPerCurveEdge > 1 검증 (Arc tessellation
      sampling 동작 확인).
- **회귀**:
  * Playwright 21 → 23 (+2). C-δ 2 specs 모두 PASS in real Chromium.
  * axia-geo 1207 → 1207 unchanged (render path 변경은 기존 회귀에
    영향 0 — 자세한 회귀 자산 보존).
- **사용자 결과 검증 path**:
  - 빌드: `npm run build:wasm` + `npx vite build` → production-like 번들에
    C-β + render path 정정 모두 포함.
  - 시연: DrawCircle (closed-curve mode) → PushPull → top rim 매끈 ring
    visible. ADR-090 §6 Path B trigger 매트릭스 재평가 anchor.
- **누적 회귀** (C-α ~ C-δ): axia-geo +7, Playwright +2 = **+9**.
  절대 #[ignore] 금지 9/9 준수.

### C-ε (본 commit — closure)
- **사용자 결재**: 2026-05-09, "승인 진행".
- **변경**:
  * `CLAUDE.md` LOCKED #35 — ADR-092 closure entry (메타-원칙 #14 의
    Push-Pull 통과 보존 + render path Arc fast-path 확장 가이드 + Path
    B trigger 재평가 anchor).
  * `docs/adr/090-true-kernel-native-cylinder-path-b.md` §6 — trigger
    매트릭스 갱신 (결함 1 해결 후 결함 2 가 새로운 primary trigger).
  * `docs/adr/README.md` — ADR-092 status `Proposed` → `Accepted`.
  * 본 ADR-092 §E Lessons 추가.
- **회귀**: +0 (docs only).

## E. Lessons

### L1 — 사전 검토 가치 재확인 (Path Z atomic)

**관찰**: C-β 의 7 회귀가 Arc 부착 + manifold + translation 정합 등
모든 architectural contract 를 PASS 했음에도, C-δ 단계의 real Chromium
시연 검증에서 **render path Arc fast-path 미확장** gap 발견.

**근본 원인**: ADR-089 A-κ 의 self-loop closed-curve fast-path (mesh.rs
:4985+) 가 self-loop edges 만 처리. Push-Pull 결과의 top/bottom rim 은
non-self-loop edges (N polygon edges with Arc 부착) 라서 동일 path
미적용. Engine 이 정합 ↔ Render 가 정합 의 이중 layer 가 모두 필요.

**향후 ADR 가이드** (canonical):
- AnalyticCurve metadata 부착이 시각 효과를 가지려면 *engine 부착 +
  render path 활용* 두 layer 모두 정합 필요.
- 사전 검토 단계에서 "render path 가 이 metadata 를 활용하는 분기가
  있는가?" 명시 점검 항목 추가.
- C-β 같은 단일 layer 변경은 사용자 facing 결과 0 위험 — C-δ 의 real
  runtime 게이트가 이를 catch 하는 architectural 안전망.

### L2 — Self-loop vs non-self-loop edge fast-path 분리

**관찰**: render path 가 self-loop edges (closed curves) 와 non-self-loop
edges (regular topology) 를 별개 fast-path 로 처리. ADR-089 시점에는
self-loop only 가 자연 — closed-curve face 가 1 self-loop edge 였음.
ADR-092 가 처음으로 *non-self-loop edge with curve metadata* 를 도입
(Push-Pull 결과 top/bottom rim) → 두 fast-path 일관성 통합 필요.

**향후 ADR 가이드**:
- Edge curve metadata 의 render path 처리는 self-loop / non-self-loop
  공통 분기 통합 (or DRY 추출).
- Bezier/BSpline/NURBS 의 non-self-loop case (예: trim curve segments)
  도 동일 패턴 답습 필요 시 본 C-δ render fix 참조.

### L3 — 메타-원칙 #14 의 다단 layer 적용

**canonical**: "면은 닫힌 경계로부터 유도된다."

**ADR-092 의 깊은 적용**:
- Engine truth: Push-Pull 결과의 top boundary 가 closed Circle 로
  *parameterized* (Arc curves on N polygon edges)
- Render truth: 그 Arc parameterization 이 시각 단계까지 propagation
  (chord-tolerant tessellation)
- Boolean / Offset / Push-Pull again 활용: 후속 op 들이 Arc metadata
  를 first-class 로 인식 (보너스 — L8 lock-in)

**향후 ADR 가이드** — 메타-원칙 #14 정합 검증 시 단순 "engine 에 metadata
부착" 으로는 부족. *engine + render + downstream ops* 의 3 layer
모두 정합 확인 필요.

### L4 — Path A 의 점진 Path B 화 패턴

**관찰**: ADR-092 = ADR-090 Path B 의 partial atomic 추출. Side faces
는 unchanged, top boundary 만 closed-curve metadata 부활. *결함 1
해결 + 결함 2 잔존* 의 의도적 trade-off.

**향후 ADR 가이드** — Multi-week atomic (Path B 같은) 진입 전, partial
atomic 추출이 가능한지 사전 검토. 사용자 시연 결과에 따라 trigger 활성
여부 결정. 본 C-α / C-δ 패턴이 Path B 결재 anchor 활용.
