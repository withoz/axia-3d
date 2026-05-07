# 메뉴구성계획 — Kernel-Native Command Suite Reset (Pre-ADR-087)

**작성일**: 2026-05-08
**상태**: **검토 대기 (Draft)** — 사용자 결재 전 코드 변경 0
**전제**: 사용자 통찰 (2026-05-08)
> "명령어를 처음부터 커널에 맞게 다시 작성하는것이 좋을듯. 현재 명령
> 삭제하는것이 좋지 않은가?"
> "현재 마지막 우리엔진의 상태를 확인하고 메뉴구성계획을 먼저 작성후 검토."

본 문서는 **계획만**. 본 문서가 결재된 후에야 ADR-087 작성 + sub-step
atomic commit 시리즈 진입.

---

## 1. 현재 엔진 상태 매트릭스

### 1.1 Command enum (`crates/axia-core/src/commands.rs`, 25 variants)

| # | Command | Layer | Status |
|---|---------|-------|--------|
| 1 | `DrawLine` | Mesh DCEL | **Legacy** (kernel-blind, no surface) |
| 2 | `DrawCenterline` | Mesh DCEL | Legacy (semantic-only edge) |
| 3 | `SetEdgeClass` | Attribute | Neutral |
| 4 | `DrawRect` | Mesh DCEL | **Legacy** |
| 5 | `DrawRectAsShape` | Mesh + **Plane attach** | **Kernel-native** ✅ (이번 세션 fix `5db6d41`) |
| 6 | `DrawLineAsShape` | Mesh DCEL | **Partial** (Shape but no curve attach) |
| 7 | `DrawCircleAsShape` | Mesh + Arc curve | **Kernel-native** ✅ (ADR-028 curve attach) |
| 8 | `DrawCircle` | Mesh DCEL | **Legacy** |
| 9 | `PushPull` | Mesh DCEL | **Legacy** (intentionally disconnected) |
| 10 | `CreateSolid` | NURBS kernel | **Kernel-native** ✅ (ADR-079 W-1) |
| 11 | `Move` | Mesh transform | Mostly neutral (vertex translate) |
| 12 | `Undo` / 13 `Redo` | Transaction | Neutral |
| 14 | `Select` / 15 `DeselectAll` | Selection state | Neutral |
| 16 | `CreateGroup` | Semantic | Neutral |
| 17~22 | Group/Component ops | Semantic | Neutral |
| 23~25 | Material ops | Semantic | Neutral |

### 1.2 Draw-related WASM exports (`crates/axia-wasm/src/lib.rs`)

| 분류 | exports |
|------|---------|
| **Kernel-native (Shape)** | `draw_rect_as_shape` ✅, `draw_circle_as_shape` ✅, `draw_line_as_shape` (no curve), `create_solid_extrude` ✅ |
| **Curve-attach** (ADR-032) | `draw_arc_with_curve`, `draw_bezier_with_curve`, `draw_bspline_with_curve` |
| **Legacy mesh** | `draw_line`, `draw_rect`, `draw_circle`, `push_pull`, `create_box`, `create_sphere`, `create_cone`, `create_cylinder` |
| **Boolean / Fillet** | `boolean_dispatch_json`, `boolean_dispatch_dcel_multi_json`, `fillet_edge`, `fillet_edge_dispatch_json`, `sheet_boolean` |
| **Import/inject** | `inject_external_face_no_surface`, `inject_external_face_plane` |

### 1.3 Tool registrations (`web/src/tools/ToolManagerRefactored.ts:238-265`, 26 tools)

| Tool name | Class | Bridge → kernel? |
|-----------|-------|------------------|
| `select` | SelectTool | n/a |
| `line` / `polyline` | DrawLineTool | form-mode → `drawLineAsShape` (no curve) ⚠️ |
| `rect` | DrawRectTool | form-mode → `drawRectAsShape` ✅ |
| `circle` | DrawCircleTool | form-mode → `drawCircleAsShape` ✅ |
| `polygon` | DrawPolygonTool | **legacy only** ❌ |
| `arc` | DrawArcTool | curve-attach (ADR-032) ✅ |
| `freehand` | DrawFreehandTool | **legacy only** ❌ |
| `bezier` | DrawBezierTool | curve-attach (ADR-032) ✅ |
| `pushpull` | PushPullTool | form-mode → `createSolidExtrude` ✅ (PushPullTool.ts:306-335) |
| `move` / `rotate` / `scale` | Mesh transform | mesh-level (kernel agnostic) |
| `offset` | OffsetTool | ADR-080 dimension-aware ✅ |
| `erase` | EraseTool | mesh DCEL |
| `split` | SplitTool | mesh DCEL |
| `group` | GroupTool | semantic |
| `measure` | MeasureTool | read-only |
| `centerline` | DrawCenterlineTool | semantic edge class |
| `sphere` / `cylinder` / `cone` / `box` | Primitive tools | **legacy `create_*` only** ❌ |
| `slice` | SliceTool | mesh DCEL |

### 1.4 MenuBar action dispatcher (`web/src/ui/MenuBar.ts`)
- 약 **80개의 `data-action`** dispatch entry (file/edit/view/draw/modify/format/help/boolean/sketch/etc.).
- 다수 entry 가 ToolManager.executeAction(act) 으로 위임 → ToolManagerRefactored 의 case-by-case 분기.
- 일부 (`thicken-faces`, `array-linear`, `subdivide`, `mirror-x` 등) 는 mesh-level 직접 호출.

---

## 2. 분류 요약 (3 단계)

### 🟢 Kernel-native (그대로 유지)
- `DrawRectAsShape` + DrawRectTool form-mode
- `DrawCircleAsShape` + DrawCircleTool form-mode
- `CreateSolid` + PushPullTool form-mode 라우팅 (`createSolidExtrude`)
- `draw_arc_with_curve` / `draw_bezier_with_curve` / `draw_bspline_with_curve` (ADR-032)
- ADR-080 dimension-aware Offset (모든 8 host × 6 curve 활성)
- ADR-064/066/074 NURBS Boolean DCEL stack
- ADR-081 STEP/IGES BRep promotion

### 🟡 Partial (Shape 등록되나 surface/curve 미부착)
- `DrawLineAsShape` — Shape 등록 OK, 그러나 LineCurve attach 안 됨 → Push/Pull 전 1D shape 만 사용 가능
- DrawPolygonTool — N-gon, 평면 face 자동 합성하지만 `Plane` attach 없음 → Push/Pull 시 `NoProfileSurface` 가능

### 🔴 Legacy / Disconnected (커널과 단절)
- `DrawLine` / `DrawRect` / `DrawCircle` (구 명령, AsShape 가 superset)
- `PushPull` (구 mesh-only, form-mode OFF 시에만 도달)
- `create_box` / `create_sphere` / `create_cone` / `create_cylinder` (primitive WASM, surface attach 없음)
- DrawFreehandTool (mesh-only freehand)
- BoxTool / SphereTool / CylinderTool / ConeTool TS — primitive WASM 호출만, kernel-native primitive 부재

---

## 3. 제안 — Kernel-Native Command Suite (Reset 후 목표)

### 3.1 새 Command 분류 원칙
1. **모든 Draw 는 Shape 만 생성** — Xia 는 재질 부여 시 promote (ADR-049/050).
2. **모든 face 합성 시 AnalyticSurface 자동 attach** — Plane 우선, curve-driven 면은 해당 surface variant.
3. **모든 Edge 는 AnalyticCurve attach 가능 시 부착** — Line/Arc/Circle/Bezier/BSpline/NURBS.
4. **Push/Pull = create_solid Extrude only** — mesh-level pushPull 폐지.
5. **Primitive (Box/Sphere/Cylinder/Cone/Torus) = create_solid Revolve/Sweep + AnalyticSurface 직접** — mesh-level `create_*` 폐지.

### 3.2 새 Command 표 (Draft, 결재 후 ADR-087 본문에 정합)

| Group | Command | Surface/Curve attach | Replaces (legacy) |
|-------|---------|---------------------|-------------------|
| **Draw 1D** | `DrawLineShape` | LineCurve attach | DrawLine, DrawLineAsShape |
| Draw 1D | `DrawArcShape` | ArcCurve | (existing draw_arc_with_curve consolidate) |
| Draw 1D | `DrawCircleShape` | CircleCurve + Plane | DrawCircle, DrawCircleAsShape |
| Draw 1D | `DrawBezierShape` / `DrawBSplineShape` / `DrawNurbsShape` | curve attach | (existing curve_with_curve consolidate) |
| Draw 1D | `DrawCenterlineShape` | semantic only | DrawCenterline |
| **Draw 2D** | `DrawRectShape` | Plane attach + 4 LineCurve edges | DrawRect, DrawRectAsShape |
| Draw 2D | `DrawPolygonShape` | Plane attach + N LineCurve edges | DrawPolygon (legacy) |
| Draw 2D | `DrawFreehandShape` | best-fit Plane + BSplineCurve edge | DrawFreehand (legacy) |
| **3D Solid** | `CreateSolid { mode: Extrude/Revolve/Sweep/Loft }` | full SolidKind dispatch | PushPull, create_box/sphere/cylinder/cone |
| 3D Solid | `CreateBoxSolid` | 6 Plane faces | create_box |
| 3D Solid | `CreateSphereSolid` | Sphere surface | create_sphere |
| 3D Solid | `CreateCylinderSolid` | Cylinder + 2 Plane caps | create_cylinder |
| 3D Solid | `CreateConeSolid` | Cone + 1 Plane cap | create_cone |
| 3D Solid | `CreateTorusSolid` | Torus surface | (신규, 현재 없음) |
| **Modify** | `Move` / `Rotate` / `Scale` | (mesh transform 유지, surface preserved) | unchanged |
| Modify | `Offset` | ADR-080 (그대로) | unchanged |
| Modify | `BooleanDispatch` | ADR-064/066 (그대로) | unchanged |
| Modify | `FilletEdge` / `ChamferEdge` | (그대로) | unchanged |
| Modify | `Erase` | (그대로) | unchanged |
| **Semantic** | Group/Component/Material | (그대로) | unchanged |
| **I/O** | STEP/IGES Import | ADR-081 (그대로) | unchanged |

### 3.3 삭제 대상

**Rust 레이어**:
- `Command::DrawLine` / `DrawRect` / `DrawCircle` (3개 enum variant)
- `Command::PushPull` (CreateSolid 가 superset)
- `Command::DrawCenterline` (DrawCenterlineShape 로 흡수)
- `exec_draw_line` / `exec_draw_rect` / `exec_draw_circle` (Scene methods)
- `Mesh::push_pull` (axia-geo, CreateSolid Extrude path 가 cover)
- `create_box/sphere/cylinder/cone` (axia-wasm exports + 내부 mesh 빌더)

**TS 레이어**:
- `WasmBridge.drawLine/drawRect/drawCircle/pushPull` (legacy wrappers)
- `WasmBridge.createBox/createSphere/createCylinder/createCone`
- DrawLineTool / DrawRectTool / DrawCircleTool 의 form-mode OFF 분기 (legacy 코드 삭제, form-mode 1-way)
- BoxTool / SphereTool / CylinderTool / ConeTool 의 primitive WASM 호출을 `createSolid` Revolve/Sweep 으로 교체
- `drawShapeMode` flag 자체 제거 (default = 유일 path)

**UI 레이어**:
- SettingsPanel "그리기 모드: 형태 (실험)" 토글 제거
- 메뉴 / 툴바 action ID 는 그대로 유지 (`tool-rect` 등) — ADR-046 P31 #4 (additive only) 정합
  → 단축키/메뉴 muscle memory 보존, 내부 dispatch 만 kernel-native 로 통일

---

## 4. Sub-Atomic Roadmap (ADR-087 K-α ~ K-η, 결재 후 commit 시리즈)

각 step 은 atomic commit + 회귀 테스트 추가 + 사용자 facing 동작 무회귀 검증.

| Step | Title | 핵심 변경 | Estimated 회귀 |
|------|-------|----------|---------------|
| **K-α** | Spec only | ADR-087 본문 + 본 PLAN promote | +0 |
| **K-β** | Plane attach 보강 | `exec_draw_polygon_as_shape` 신설 + Plane attach + DrawPolygonTool form-mode 옵션 | +5 |
| **K-γ** | LineCurve attach | `DrawLineAsShape` 가 `LineCurve` attach (Edge 1D) | +6 |
| **K-δ** | Primitive kernel-native | `create_box/sphere/cylinder/cone` 4개 함수가 내부적으로 AnalyticSurface attach 후 face 생성 | +12 |
| **K-ε** | Tool form-mode 1-way | DrawLine/Rect/Circle/Polygon Tool 의 legacy 분기 제거. `drawShapeMode` flag 폐기 | +0 (negative diff) |
| **K-ζ** | Legacy command 삭제 | `Command::DrawLine/DrawRect/DrawCircle/PushPull/DrawCenterline` 삭제 + Scene exec_* 삭제 + WASM legacy export 삭제 | -150 ~ -300 LoC, +0 테스트 |
| **K-η** | 회고 + LOCKED #34 | CLAUDE.md LOCKED 신규 항목 + ADR-087 §D Acceptance Log | +0 |

**누적 회귀 예상**: +23 (절대 #[ignore] 금지 23/23). Code -200~500 lines net (legacy 삭제).

### 4.1 안전망
- 각 step 별 commit 전: `cargo test --workspace` + `npm test` + `npx playwright test` 모두 PASS.
- K-ζ deletion step 전: K-α~K-ε 의 Plane/Curve attach 가 모든 사용자 facing path (메뉴/단축키/Toolbar/MCP) 에서 동작 재검증.
- K-ζ 후 사용자 환경에서 directly verifiable 회귀 케이스:
  - DrawRect → Push/Pull (이번 세션 fix 의 산업 표준 path)
  - DrawCircle → Push/Pull
  - DrawPolygon → Push/Pull (K-β 후 활성)
  - Box/Sphere/Cylinder/Cone primitive → Push/Pull / Boolean 정상

### 4.2 Risk Matrix

| Risk | Mitigation |
|------|-----------|
| 메뉴/단축키/툴바 변경 → ADR-046 P31 #4 (additive only) 위반 | 외부 action ID 모두 보존, 내부 dispatch 만 변경 |
| Legacy snapshot (`bincode` Scene) 호환 깨짐 | `Section 7+` 추가 only — 기존 Section 1~6 unchanged |
| MCP capability surface drift | ActionCatalog 의 capability handler 만 내부 변경 (ID 보존) |
| Test regression (legacy paths 의 회귀가 무시되지 않음을 확신해야) | K-ζ 전 K-α~K-ε 가 form-mode 모든 entry path cover |

---

## 5. 사용자 결재 요청 (review questions)

본 PLAN 진행 전 다음 항목 확인 부탁드립니다:

1. **Q1 — 범위**: K-α ~ K-η 7-step 가 적절한 분할인가, 더 잘게 또는 더 크게?
2. **Q2 — 속도**: 한 번에 모두 vs Path Z atomic 1-step 1-commit?
   - 권장: Path Z atomic (각 step 별 사용자 결재)
3. **Q3 — Centerline 처리**: `DrawCenterlineShape` 로 흡수 OK? 또는 별개 시민권 (Reference layer, ADR-053 Phase 3) 으로 보존?
4. **Q4 — Primitive surface attach 깊이**:
   - Option A: Sphere = 단일 `Sphere` AnalyticSurface 1면 (북극/남극 polar singularity 처리 필요)
   - Option B: Sphere = 8 octant Bezier patch (NURBS-class, exact)
   - 권장: Option A (현 ADR-031 Sphere variant 활용, 검증 회귀 풍부)
5. **Q5 — Legacy export deprecation 시점**:
   - K-ζ 에서 즉시 삭제 vs `@deprecated` 1 release 후 삭제?
   - 권장: 즉시 삭제 (사용자 결재 = single source authority, 외부 API 약속 없음)
6. **Q6 — `drawShapeMode` flag**:
   - 즉시 폐기 vs runtime escape hatch (디버그용) 1 release 보존?
   - 권장: 즉시 폐기 (LOCKED #26 P-5e-α 후 default ON, OFF preference 의 user value 0 확인 후)

---

## 6. 결재 전까지

**금지**: 코드 변경 0. 본 PLAN 결재 후에만 ADR-087 작성 + K-α 진입.
**허용**: 본 PLAN 갱신 (사용자 의견 반영), 추가 audit (필요 시).

---

## 7. 부록 — 이번 세션 직접 fix (참고)

| Fix | Commit | Effect |
|-----|--------|--------|
| Vite dev server hang (opencascade.js pre-bundle) | `5ea7b1e` | dev server 정상 기동 |
| `exec_draw_rect_as_shape` Plane attach | `5db6d41` | DrawRect → Push/Pull 즉시 가능 (산업 표준 path) |
| E2E regression spec (DrawRect → Push/Pull) | `25b313b` | Real Chromium round-trip 검증 |
| OCCT slow channel timeout 300→600s | `e8dbb3d` | T-δ slow channel timing 흡수 |

**관찰**: `5db6d41` 가 본 PLAN 의 K-β/K-γ 의 mini-prototype. 
같은 패턴 (Plane/Curve attach) 을 DrawPolygon / DrawLine / Primitive 들에 확장하는 것이 본 PLAN 의 본질.
