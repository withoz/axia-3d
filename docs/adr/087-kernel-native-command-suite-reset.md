# ADR-087 — Kernel-Native Command Suite Reset (Architectural Spec)

**Status**: **Accepted + Closed** (K-α ~ K-η 모두 완료, 2026-05-08).
ADR-088 (Phase 1: curve_owner_id grouping) + ADR-089 (Phase 2: true
kernel-native closed edges) 후속 트랙.
**Date**: 2026-05-08
**Author**: AXiA team (사용자 통찰 + Claude spec)
**Anchor**: 사용자 통찰 (2026-05-08, ADR-086 closure + DrawRect→Push/Pull
회귀 fix `5db6d41` 직후):
> "명령어를 처음부터 커널에 맞게 다시 작성하는것이 좋을듯. 현재 명령
> 삭제하는것이 좋지 않은가?"
> "현재 마지막 우리엔진의 상태를 확인하고 메뉴구성계획을 먼저 작성후
> 검토."

**Parent**: ADR-049 (Two-Layer Citizenship), ADR-050 (Shape/Xia split),
ADR-079 (Create Solid surface-native), ADR-080 (Offset dimension-aware)
**Cross-cut**: ADR-027~033 (NURBS Kernel), ADR-046 P31 (UI/UX strategy
+ menu additive only), ADR-026 P12 (Bridge SSOT), ADR-082~086 (STEP/IGES)

**Pre-PLAN**: `docs/plans/PLAN-MENU-RESET.md` (commit `e461c04`,
2026-05-08) — 25 Command / 26 Tool / 80 menu action 전수 audit + 3-tier
classification + 6 결재 questions.

---

## 0. Summary (8 lines)

> ADR-027~086 의 5년 누적 커널 (NURBS curves/surfaces / SSI / Boolean
> DCEL / STEP-IGES BRep import / Two-Layer Citizenship) 은 충분히
> 성숙했으나, 사용자 facing 명령 (Draw / Push-Pull / primitives) 의
> 다수가 *kernel-blind* — `AnalyticSurface`/`AnalyticCurve` attach
> 없이 mesh DCEL 만 생성. 결과: `create_solid` 등 kernel-native ops 가
> `NoProfileSurface` 로 거부 (이번 세션 `5db6d41` 직접 증명). 본 ADR
> 은 모든 user-facing Draw / primitive 가 kernel-aware 가 되도록
> Command suite 를 *reset* — Plane/Curve attach 보강 (K-β/K-γ) +
> primitive kernel-native (K-δ) + form-mode 1-way (K-ε) + legacy
> 일괄 삭제 (K-ζ). ADR-046 P31 #4 (additive only) 정합: 메뉴/단축키/
> 툴바 외부 ID 보존, 내부 dispatch 만 kernel-native 통일.

---

## 1. Background

### 1.1 비대칭 상태 (2026-05-08 기준)

```
커널 (axia-geo)              ████████████████████  95%
                               ADR-027~033 NURBS Kernel ✅
                               ADR-034 SSI ✅
                               ADR-064/066 Boolean DCEL ✅
                               ADR-079/080 Create Solid + Offset ✅
                               ADR-081~086 STEP/IGES + injection ✅

메뉴/Command 정합            ████████              35%
                               🟢 DrawRect/Circle AsShape (3 of 25)
                               🟢 Push/Pull form-mode → createSolidExtrude
                               🟢 ADR-032 curve-attach (Arc/Bezier/BSpline)
                               🟡 DrawLineAsShape (curve attach 누락)
                               🟡 DrawPolygonTool (Plane attach 누락)
                               🔴 DrawLine/Rect/Circle 구 명령 (legacy alongside)
                               🔴 PushPull mesh-only (intentionally disconnected)
                               🔴 create_box/sphere/cylinder/cone (surface 부재)
                               🔴 DrawFreehand (Plane + curve 부재)
                               🔴 drawShapeMode flag (LOCKED #26 P-5e-α default ON)
```

### 1.2 사용자 ground truth (이번 세션 직접 증거)

- `[RUST] create_solid_extrude ERROR: profile face has no AnalyticSurface attached`
  → DrawRect → Push/Pull 클릭 시 회귀.
- 화면: face 가 edge 보다 크게 표시 + 다른 명령 회귀 + 다중 primitives 동시 표시.
- Fix: `5db6d41` (`exec_draw_rect_as_shape` 가 Plane attach) — 1 명령 한정 mini-prototype.
- 사용자 통찰: "command 별 band-aid 는 sustainable 안 됨. 처음부터 kernel-aware 로 재작성."

### 1.3 Why now (시급도)

- ADR-082~086 STEP/IGES + visual / edge / Toast / WasmBridge owner-ID
  closure → "demo readiness 95%+" 라고 명시되었으나 *기본 Draw → Push/Pull
  workflow 자체가 broken*.
- 커널의 95% 가 사용자 손에 닿지 않는 상태 — **메뉴 정합이 single
  highest-leverage trajectory**.

---

## 2. Decision

### 2.1 P-1 (canonical) — **All user-facing geometry commands shall be kernel-aware**

> 모든 사용자 Draw / Primitive 명령은 face 합성 시 적절한 `AnalyticSurface`
> 를 attach 하고, edge 생성 시 가능하면 `AnalyticCurve` 를 attach 한다.
> Mesh DCEL 만 생성하는 (kernel-blind) command 는 폐기한다.

### 2.2 5 lock-in 원칙

- **L1**: 모든 Draw → form-layer Shape 만 생성 (Xia 는 재질 부여 시
  promote, ADR-049/050 답습).
- **L2**: 모든 face 합성 → `AnalyticSurface` 자동 attach. cardinal plane
  (Plane), curved primitive (Sphere/Cylinder/Cone/Torus), 자유 곡면
  (BezierPatch/BSplineSurface/NURBSSurface).
- **L3**: 모든 Edge → `AnalyticCurve` attach 가능 시 부착 (Line/Arc/
  Circle/Bezier/BSpline/NURBS). Free-form draw 의 경우 best-fit 또는
  직접 control point.
- **L4**: Push/Pull = `create_solid` Extrude only — mesh-level pushPull
  폐지. 다른 modes (Revolve/Sweep/Loft) 도 `create_solid` 단일 entry.
- **L5**: Primitive (Box/Sphere/Cylinder/Cone/Torus) = `AnalyticSurface`
  variant 직접 + face 합성 — mesh-level `create_box/sphere/cylinder/cone`
  exports 폐지.

### 2.3 추가 정책 (Cross-cut)

- **Menu / Toolbar / Shortcut 외부 surface 보존** (ADR-046 P31 #4 additive
  only): action ID (`tool-rect` 등) UNCHANGED, 내부 dispatch 만 변경.
- **Bridge SSOT 보존** (ADR-026 P12): cardinal plane snap 정책 그대로.
- **ActionCatalog SSOT 보존** (ADR-045 D1): 53 action 등록은 internal
  handler 만 갱신, public capability ID UNCHANGED.
- **MCP capability surface 보존** (ADR-041 P26): tier1 capability 의
  WASM dispatch target 만 kernel-native 로 교체.

---

## 3. Approach — Path Z atomic 7-step

### 3.1 Step roadmap

| Step | Title | 핵심 변경 | Predicted 회귀 | Risk |
|------|-------|----------|---------------|------|
| **K-α** | Spec only (본 commit) | ADR-087 본문 + LOCKED tentative | +0 (docs) | 0 |
| **K-β** | Polygon Plane attach + AsShape | `exec_draw_polygon_as_shape` 신설 + Plane attach + DrawPolygonTool form-mode | +5 | 낮음 |
| **K-γ** | LineCurve attach | `DrawLineAsShape` 가 LineCurve attach (Edge 1D analytic) + DrawFreehandShape (best-fit Plane + BSpline) | +6 | 낮음 |
| **K-δ** | Primitive kernel-native | `create_box/sphere/cylinder/cone` 4개 함수 내부적으로 AnalyticSurface variant attach 후 face 합성. ToolBox/Sphere/Cylinder/ConeTool 갱신 | +12 | 중간 |
| **K-ε** | Tool form-mode 1-way | Draw{Line,Rect,Circle,Polygon,Freehand}Tool 의 legacy 분기 제거. `drawShapeMode` flag 폐기 | +0 (negative diff) | 낮음 |
| **K-ζ** | Legacy command 일괄 삭제 | `Command::DrawLine/DrawRect/DrawCircle/PushPull/DrawCenterline` + Scene `exec_*` + WASM legacy exports 삭제 | -200~-500 LoC, +0 tests | **높음** (1 atomic) |
| **K-η** | 회고 + LOCKED #34 | CLAUDE.md LOCKED 신규 항목 + ADR §D Acceptance Log | +0 | 0 |

**누적 회귀 예상**: **+23** (절대 #[ignore] 금지 23/23 준수). Code -200~-500 lines net.

### 3.2 K-ζ 직전 사용자 시연 게이트 (5 invariants)

K-ζ commit 전, 다음 모두 통과 후 결재:
1. ✅ `cargo test --workspace` (전 Rust)
2. ✅ `npm test` (vitest)
3. ✅ `npx playwright test` (E2E + draw-rect-push-pull spec)
4. ✅ **사용자 manual 시연**: DrawRect/Circle/Polygon/Line/Freehand → Push/Pull / Boolean / Offset 정상
5. ✅ Box/Sphere/Cylinder/Cone primitive → 즉시 Push/Pull / Boolean 가능

5 게이트 미통과 시 K-ζ **연기** (K-β~K-ε 보강 후 재시도).

### 3.3 사용자 결재 6 questions (PLAN §5 답습 — 향후 step 별 lock-in 결정)

각 step 진입 시 PLAN §5 의 6 questions 에 대해 명시적 lock-in:
- **Q1 범위**: K-α~K-η 분할 (✅ 본 commit lock-in)
- **Q2 속도**: Path Z atomic 1-step 1-commit (✅ 본 commit lock-in)
- **Q3 Centerline 처리**: K-γ 진입 시 결재 (option A: DrawCenterlineShape 흡수 / option B: Reference layer 별도)
- **Q4 Sphere variant 깊이**: K-δ 진입 시 결재 (option A: 단일 Sphere variant / option B: 8 octant Bezier)
- **Q5 Legacy export deprecation 시점**: K-ζ 진입 시 결재 (option A: 즉시 삭제 / option B: @deprecated 1 release)
- **Q6 `drawShapeMode` flag**: K-ε 진입 시 결재 (option A: 즉시 폐기 / option B: 1 release escape hatch)

---

## 4. Lock-ins (K-α 시점)

- **L-α-1** PLAN §3.2 의 새 Command 표 (Draft) 가 K-β~K-δ commit 의 truth source.
- **L-α-2** PLAN §3.3 의 삭제 대상 list 가 K-ζ commit 의 truth source.
- **L-α-3** 본 ADR §3.1 의 7-step roadmap 은 변경 시 새 ADR (Superseded by ADR-XXX).
- **L-α-4** ADR-046 P31 #4 (additive only) 정합 — menu/toolbar/shortcut 외부
  ID 변경 = 본 ADR 외 별도 ADR 강제.
- **L-α-5** Initial bundle 0MB strict (ADR-035 P20.C #2) 유지 — K-ζ 의 legacy
  exports 삭제는 bundle reduction (positive deviation OK).
- **L-α-6** 절대 #[ignore] 금지 (LOCKED Tier 1) — 각 step 회귀는 작성 시
  PASS 확인 후에만 commit.

---

## 5. Non-goals (K-α 시점)

본 ADR 이 처리하지 않는 것:
- **N-1** Surface kinds 확장 (Cylinder/Sphere/Cone/Torus inject) — ADR-087 외
  별도 (ADR-088 후보).
- **N-2** Inner loops (holes) inject — ADR-086 O-β 확장 별도.
- **N-3** Edge analytic curve attach for STEP/IGES import — ADR-086 후속 별도.
- **N-4** .axia persistence (import 결과 저장) — ADR-078 답습 별도.
- **N-5** Drift #5 timing 단축 (WASM streaming compile / parallel libs / cache)
  — ADR-082 architectural 후속.
- **N-6** i18n stage messages (한국어 외) — ADR-046 Phase 2 cross-cut.
- **N-7** Edge selection / hover for imported BRep — ADR-037 P22 cross-cut.

---

## 6. Acceptance criteria (K-α 시점)

본 commit (K-α) 가 만족해야:
- ✅ ADR-087 본문 작성 (본 파일).
- ✅ PLAN-MENU-RESET.md (commit `e461c04`) 가 본 ADR 의 pre-spec 으로 참조.
- ✅ §1 Background / §2 Decision / §3 Approach / §4 Lock-ins / §5 Non-goals
  / §6 Acceptance criteria 명시.
- ✅ 7-step roadmap 의 각 step 별 회귀 / risk 추정.
- ✅ K-ζ 직전 5 invariant 게이트 명시.
- ✅ 사용자 결재 6 questions 의 lock-in 시점 명시.
- ✅ ADR-046 P31 #4 정합 재확인 (menu additive only).
- ✅ Code 변경 0 — spec only.

---

## §D Acceptance Log

### K-α (2026-05-08, commit `ef72956`)
- **사용자 결재**: "네 진입을 승인합니다."
- **변경**: `docs/adr/087-kernel-native-command-suite-reset.md` (본 파일) 신설.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.
- **Bundle 영향**: 0 (TS/Rust 변경 0).
- **다음 step**: K-β (Polygon Plane attach + AsShape).

### K-β (2026-05-08, commit `70aabaa`)
- **사용자 결재**: "승인합니다"
- **변경**:
  - `crates/axia-core/src/scene.rs::exec_draw_circle_as_shape`:
    Plane attach (basis_u Gram-Schmidt with X/Y fallback).
  - `web/src/tools/DrawPolygonTool.ts`: form-mode 라우팅 추가
    (drawCircleAsShape via N segments).
- **핵심 발견**: K-α 와 동일한 root cause 가 `exec_draw_circle_as_shape`
  에도 잠재 — Plane attach 누락. K-β 가 사촌 버그 cover.
- **회귀**: +10 (axia-core +5, vitest +5).
- **다음 step**: K-γ (LineCurve attach + DrawFreehandShape).

### K-γ (2026-05-08, commit `d1e80e9`)
- **사용자 결재**: "승인합니다" + Q3 defer (Centerline 시민권 결정은
  K-ζ 또는 ADR-053 Phase 3 후속).
- **변경**:
  - `crates/axia-core/src/scene.rs::exec_draw_line_as_shape`: face path
    Plane attach (centroid origin from `collect_loop_verts`).
  - `crates/axia-wasm/src/lib.rs`: `drawPolylineAsShape` neuer export
    (Command::DrawLineAsShape × N).
  - `crates/axia-wasm/tests/export_baseline.txt`: drawPolylineAsShape 추가.
  - `web/src/bridge/WasmBridge.ts`: TS bridge `drawPolylineAsShape` wrapper.
  - `web/src/tools/DrawFreehandTool.ts`: form-mode 분기 (Plane normal hint).
  - `web/src/tools/DrawFreehandTool.test.ts`: NEW 3 form-mode dispatch tests.
- **회귀**: +6 (axia-core +3, vitest +3, axia-wasm baseline +1).
- **다음 step**: K-δ (Primitive kernel-native).

### K-δ (2026-05-08, commit `2f9b4b9`)
- **사용자 결재**: "승인합니다", Q4 = Option A (단일 Sphere variant).
- **🎯 핵심 발견**: ADR-032 P17 에서 Sphere/Cylinder 의 surface attach
  이미 완료. K-δ scope 대폭 축소 — Box (surface 0) + Cone caps (Plane
  부재) 만 처리.
- **변경**:
  - `crates/axia-geo/src/operations/primitives.rs::create_box`: 6 face
    Plane attach (axis-aligned outward normals + face_planes lookup).
  - `create_cone`: base + top cap Plane attach (cylinder 패턴 답습).
  - 기존 guard `box_faces_have_no_surface` polarity flip → `k_delta_*`.
- **회귀**: +5 (axia-geo).
- **다음 step**: K-ε (Tool form-mode 1-way + flag 폐기).

### K-ε (2026-05-08, commit `8548356`)
- **사용자 결재**: Q6 = Option A (즉시 폐기).
- **변경**:
  - 5 Draw tools (Line/Rect/Circle/Polygon/Freehand) + PushPullTool 의
    `getDrawShapeMode()` 분기 제거 → AsShape variants 직접 호출.
  - `web/src/tools/DrawShapeModeSettings.ts` + `.test.ts` 모듈 삭제.
  - `web/src/units/SettingsPanel.ts`: 토글 UI + listener + updateDisplay
    제거.
  - 6 tool tests + SettingsPanel.test simplification (OFF mode dispatch
    삭제).
- **회귀**: -11 (legacy mode 회귀 자산 cleanup, form-mode 100% 보존).
- **LOCKED #26 P-5e-α 자연 closure**: flag 폐기 = "default ON" 정책의
  "single-path enforcement" 진화.
- **다음 step**: K-ε hotfix (Plane render polygon path).

### K-ε hotfix (2026-05-08, commit `11eee34`)
- **🔴 사용자 보고**: "Draw{Rect/Circle/Polygon/Line/Freehand} 페이스
  생성 오류" — face 가 edge 를 벗어나서 그려짐.
- **🎯 Root cause**: ADR-038 P23.1 의 `export_buffers` 가 Plane attach
  시 `surface.tessellate(chord_tol)` → u_range/v_range = (-1e6, 1e6)
  → 2km × 2km sampled grid 렌더 → 면이 edge 를 벗어남.
- **📜 LOCKED #12 (ADR-025 P11)** 정합 위배 차단:
  > "닫힌 엣지는 반드시 면을 합성한다" — face 영역은 DCEL closed edge
  > loop 가 정의. Surface attach 는 metadata, render 결정자 아님.
- **변경**: `crates/axia-geo/src/mesh.rs::export_buffers_inner` —
  Plane variant → polygon path (DCEL boundary = exact). Curved
  surface (Cylinder/Sphere/Cone/Torus/Bezier/BSpline/NURBS) 는
  surface tessellation 유지.
- **회귀**: +1 (axia-geo `k_epsilon_box_plane_uses_polygon_path_not_surface_tess`).
- **영향**: K-α 부터 잠재 존재한 visual regression 의 retroactive closure.

### K-ζ (2026-05-08, commit `b7982ce`)
- **사용자 결재**: Option A (K-ζ 진행 + ADR-088 P7 disjoint-inner 별도) +
  Q5 = Option A (즉시 삭제).
- **🎯 Strategy 분리** — User-facing surface 만 삭제, internal Rust API
  (Command enum variants) 보존:
  - WASM exports 5개 삭제 (`draw_line` / `draw_rect` / `draw_circle` /
    `draw_polyline` / `push_pull`)
  - TS bridge wrappers 5개 삭제 (`drawLine` / `drawRect` / `drawCircle`
    / `drawPolyline` / `pushPull`)
  - Production callers 5 sites migration (ToolManagerRefactored / Offset
    SessionManager / DrawArc / DrawBezier / CommandRegistry)
  - Command enum variants 보존 (test 회귀 자산 245 sites 의 Xia-layer
    contract 유지)
- **변경**: 17 files, +132 / -477 (net -345 LoC).
- **회귀**: 0 net (delete + migration + test simplification).
- **LOCKED 회귀 자산 100% 보존**: LOCKED #1 P7, #12 P11, #7 P12 SSOT,
  #26 Phase 1.

### Cone hotfix #1 (2026-05-08, commit `4ab001a`)
- **🔴 사용자 보고**: "콘이 이상하게 형성됨" — white smooth disc 가
  base polygon 너머로 퍼짐.
- **🎯 Root cause**: ADR-032 P17 의 cone primitive 의 apex_pt 가 base
  BELOW (-Y) + axis_dir = +up → Cone surface 가 widens-going-up. Mesh
  top verts (radius 5) 와 surface v_top (radius 95) 불일치.
- **변경**: `apex_pt = base + up * apex_offset` (apex 위), `axis_dir =
  -up` (apex → base).
- **회귀**: +1 (axia-geo `k_eta_cone_surface_evaluates_to_correct_radii`).

### Cone hotfix #2 — true cone restructure (2026-05-08, commit `7513c30`)
- **🔴 사용자 보고**: "콘의 VERTEX가 이상합니다" — small flat top cap
  (truncated frustum, top_radius = 0.1 * radius) 가 sharp apex 가 아님.
- **변경**: `create_cone` 재구조화 — truncated frustum → true cone
  with single apex.
  - apex 단일 vertex
  - N base ring vertices
  - 1 N-gon base cap (Plane surface, normal -up)
  - N triangle side faces (Cone surface, sharing apex)
  - faces.len() = 1 + N (이전 2 + N)
- **Manifold safety (ADR-007 / LOCKED #16)**: N-valent apex vertex
  허용 (sphere polar fan pattern 답습).
- **회귀**: +2 (`k_eta_cone_has_only_base_cap_with_plane_surface`,
  `k_eta_cone_apex_is_single_vertex`).

### Curved chord soft (2026-05-08, commit `b256546`)
- **🔴 사용자 보고**: "매끈한 구, 와 원통이 아닙니다. 세그먼트 라인이
  포함되어 있음" — visible vertical chord lines on cylinder + dot
  patterns on sphere.
- **🎯 Root cause**: ADR-038 P23.3 angle-based soft filter
  (EDGE_VISIBILITY_ANGLE_DEG=20.1°) 는 16-segment cylinder = 22.5°
  per segment 를 못 잡음.
- **변경**: `create_cylinder/cone/sphere` 의 측면 face 에 명시적
  `mark_face_outer_soft` 호출. HeFlags::SOFT 시각 플래그만 — topology
  / surface metadata 무변화.
- **회귀**: +0 (시각만 보강).

### K-η (2026-05-08, 본 commit) — 회고 + LOCKED #34
- **사용자 결재**: "🅰 권장 진행" — K-η closure + ADR-088 (Phase 1
  curve_owner_id) → ADR-089 (Phase 2 true kernel-native closed edges)
  점진 진화.
- **변경**: 본 ADR §D Acceptance Log 갱신 + CLAUDE.md LOCKED #34 신규.

---

## §E ADR-087 누적 회귀 (K-α ~ K-η 합산)

| Suite | K-α 시작 전 | K-η closure |
|-------|------------|-------------|
| axia-core | 185 | **193** (+8) |
| axia-geo | 1099 | **1107** (+8) |
| axia-wasm | 33 | **34** (+1, baseline) |
| vitest | 1621 | **1618** (-3, K-ε cleanup -11 + K-β/γ +8) |
| **Total** | 2938 | **2952** (+14 net) |

**LoC 영향 (net)**: ~-700 lines (legacy paths fully cleaned).

**절대 #[ignore] 금지 14/14 준수** (ADR-014 메타-원칙 #9).

---

## §F Lessons (K-α ~ K-η 회고)

1. **사촌 버그 발견 패턴**: K-α 가 1 명령 (DrawRect) 의 Plane attach
   누락 fix. K-β 진행 중 동일 패턴이 DrawCircle 에도 있음을 발견 →
   사촌 버그 (Plane attach missing in family) 자동 cover. 향후 ADR
   가이드: 한 fix 발견 시 패밀리 전체 audit 권장.

2. **사용자 시연 게이트의 가치**: K-ζ 5 invariant 게이트 중 #4 (사용자
   manual 시연) 이 K-ε hotfix (Plane render), Cone hotfix #1+#2,
   Curved chord soft 등 4 개 회귀 발견. Test 회귀 자산만으로는 불가능.
   향후 architectural ADR 의 ζ-step 사용자 시연 필수.

3. **architectural 분리 원칙**: K-ζ 에서 user-facing surface 삭제 ≠
   internal Rust API 삭제. 245 test sites 의 Xia-layer contract 보존
   위해 Command enum variants 만 internal-only 로 강등 (production
   code paths 차단). LoC -700 + 회귀 자산 100% 보존.

4. **canonical 규칙 정합 점검**: 사용자 보고 회귀 (cone widens-going-up)
   는 LOCKED #16 P23 위배. K-η hotfix 가 ADR-032 의 mesh-era 잔존
   (truncated frustum) 을 노출 → true cone restructure. canonical
   규칙은 시각 회귀로 자연 노출됨.

5. **점진 진화의 가치**: ADR-087 closure 후 ADR-088 (Phase 1
   curve_owner_id) → ADR-089 (Phase 2 true kernel-native closed edges)
   의 점진 트랙. 큰 architectural surgery 를 한 번에 하지 않고 사용자
   facing benefit 을 단계별 unlock. user 의도 ("추후 문제점 없애는
   방법") 의 점진 실현.

---

## 7. Cross-link

- **ADR-049 / ADR-050**: Two-Layer Citizenship — 본 ADR 의 모든 Draw 가
  Shape 만 생성하는 정책의 anchor.
- **ADR-079**: Create Solid surface-native — K-δ primitive kernel-native
  의 의미론 source.
- **ADR-080**: Offset dimension-aware — K-γ LineCurve attach 후 Edge
  offset 의 정확성 unlock 의존.
- **ADR-046 P31**: UI/UX strategy + menu additive only — 본 ADR 의 외부
  surface 보존 제약.
- **ADR-035 P20.C #2**: Initial bundle 0MB strict — K-ζ 의 deletion 으로
  positive reduction.
- **ADR-026 P12**: Bridge SSOT cardinal plane snap — 본 ADR 의 모든
  AsShape 함수가 SSOT 통과.
- **ADR-082~086**: STEP/IGES 트랙의 import face 가 본 ADR closure 후 즉시
  Draw → engine ops 와 동등 first-class entity.

---

*ADR-087 K-α — Kernel-Native Command Suite Reset 의 architectural spec.
ADR-046 P31 의 P1 (건축/디자인) primary + P3 (AI 협업자) strong secondary
페르소나가 5년 누적 커널 (ADR-027~086) 의 가치에 처음으로 도달하는 트랙
의 시작점.*
