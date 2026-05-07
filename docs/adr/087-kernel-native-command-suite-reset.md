# ADR-087 — Kernel-Native Command Suite Reset (Architectural Spec)

**Status**: **Accepted** (K-α spec only — code 변경은 후속 K-β ~ K-η
별도 atomic commits, 각 step 사용자 결재)
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

### K-α (2026-05-08, 본 commit)
- **사용자 결재**: 2026-05-08, "네 진입을 승인합니다."
- **Commit hash**: (본 commit)
- **변경**: `docs/adr/087-kernel-native-command-suite-reset.md` (본 파일) 신설.
- **회귀**: +0 (docs only). 절대 #[ignore] 금지 0/0 준수.
- **Bundle 영향**: 0 (TS/Rust 변경 0).
- **다음 step**: K-β (Polygon Plane attach + AsShape) — 사용자 별도 결재 후 진입.

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
