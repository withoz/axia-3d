# ADR-164 — Auto Plane Detection (Sticky Last Drawn Plane)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-27
**Author**: WYKO + Claude
**Trigger**: 사용자 작업지시 (2026-05-27, canonical):
> "기본적으로 각 평면에 도형을 그릴때 같은 평면에 그려질수 있도록 해야
> 합니다. 자동 평면 감지 기능이 있는지 확인하고, 최대한 같은 평면에
> 그려질수 있도록 구현합니다. 작업지시 > 같은 plane에 그릴 확률을 높이
> 는 방향으로 개선하도록 사전검토 합니다."
**Audit precondition**: `docs/audits/2026-05-27-auto-plane-detection-
precheck.md` (PR #210) — 자동 평면 감지 자산 *부분 존재* finding +
4 옵션 매트릭스 + Option A 추천. audit-first canonical 12번째 적용.
**Direct predecessor**:
- ADR-140 (Surface-Aware `getDrawPlane`) — 우선순위 #2 (Cursor on face)
  의 surface-aware dispatch
- ADR-149 / ADR-150 (Sprint 3 6-step template source)

## Canonical anchor

ADR-141 §3 reserve 외부 — 사용자 작업지시 trigger 로 신설. 메타-원칙 #5
정합 (사용자 편의 — 명확하면 자동) + 메타-원칙 #16 보완 (reset trigger
명시).

**핵심 통찰** (사용자 작업지시 정확 해석):
> "**같은 plane에 그릴 확률**을 높이는 방향" — 100% guarantee 아닌 확률
> 향상. 보수적 (안전) approach 가능.

→ Default 동작 개선 + 명시 reset trigger 동시 제공 (Option A "Sticky
last drawn plane").

## 1. Problem statement

### 1.1 현재 `getDrawPlane(e)` 우선순위 매트릭스

**위치**: `web/src/tools/ToolManagerRefactored.ts:2703`

| 우선순위 | 조건 | 결과 |
|---|---|---|
| 1 | Sketch mode 활성 | Sketch plane lock-in |
| 2 | Cursor on face + hit success | Face hit plane (ADR-140 surface-aware) |
| 3 | (otherwise) | View-mode default (XY ground / XZ wall / YZ wall) |

### 1.2 사용자 의도 vs 현재 동작 매트릭스

| 시나리오 | 사용자 의도 | 현재 결과 | 정합? |
|---|---|---|---|
| Top view RECT × 2 (모두 XY ground) | 같은 XY plane | ✅ XY plane | OK |
| 경사 면 위 RECT × 2 (cursor 정확 위) | 같은 면 | ✅ 같은 면 | OK |
| 경사 면 위 RECT × 2 (cursor 약간 빗나감) | 같은 면 | ❌ XY ground reset | **미스** |
| Box 측면 RECT × 2 (cursor 측면 외) | 같은 측면 | ❌ XY ground reset | **미스** |

### 1.3 Audit finding (PR #210 자산 inventory)

자동 평면 감지 자산 *부분 존재*:
- ✅ **Sketch mode** `axia.sketch.lastPlane` (localStorage, 명시 호출만)
- ❌ **Non-sketch Draw 도구** sticky plane — **미구현**

→ Sketch mode 의 lastPlane 패턴을 Non-sketch Draw 도구에 답습 (간단한
in-memory cache + 자동 활용).

### 1.4 메타-원칙 정합

- **메타-원칙 #5 (사용자 편의)** — 명확하면 자동 / 모호하면 명시. 마지막
  그린 평면은 *명확한 default* (사용자 의도 자연 추론).
- **메타-원칙 #16 (자동화 antipattern)** — 휴리스틱 자동화는 cascading
  부작용 source. 본 ADR 의 **reset trigger** (view mode / Sketch / Esc)
  가 자동화 antipattern 보완 — 사용자 명시 의도 변경 신호 시 즉시 reset.
- **LOCKED #44 (Complete Meaning per Merge)** — 6-step single atomic per
  sub-step.

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — Option 선택: (a) Option A "Sticky last drawn plane"

**Lock-in**: ToolManager 에 `_lastDrawnPlane?: DrawPlaneInfo` 멤버 추가.
Draw 도구가 face 합성 후 자동 저장. `getDrawPlane(e)` 우선순위 #3 (view-
mode default) 앞에 `_lastDrawnPlane` 삽입.

**개선된 우선순위 매트릭스**:

| 우선순위 | 조건 | 결과 |
|---|---|---|
| 1 | Sketch mode | Sketch plane (현재 유지) |
| 2 | Cursor on face | Face hit plane (현재 유지, ADR-140) |
| **3 (NEW)** | **`_lastDrawnPlane` 존재 + face hit miss** | **Last drawn plane (sticky)** |
| 4 | (otherwise) | View-mode default (현재 유지) |

### Q2 — Reset trigger 정책: (a) view + sketch enter+exit + Esc

**Lock-in**: 사용자 의도 변경 신호 시 즉시 reset (메타-원칙 #16 보완).

**Reset 시점**:
1. **View mode 변경** (3d ↔ top ↔ front ↔ ...) — `setViewMode` hook
2. **Sketch mode 진입** — `enterSketch` hook (Sketch lock-in 으로 sticky
   자연 무효)
3. **Sketch mode 종료** — `exitSketch` hook (sketch plane → default 로
   reset, 다시 시작)
4. **Esc 키** — global cancel signal
5. **명시 메뉴** — ContextMenu "기본 평면으로" (옵션, β-4 scope)

### Q3 — Status display 동시 진행: (a) Yes (β-extension)

**Lock-in**: 사용자 인지 강화 (메타-원칙 #5 정합). 의도 미스 시 사용자
가 즉시 인지 가능.

**구현**: StatusBar 에 현재 그리기 평면 표시:
- "📐 그리기 평면: XY ground (Z=0)" — view mode default
- "📐 그리기 평면: 면 #42 (Z 법선)" — face hit
- "📐 그리기 평면: 마지막 (Z 법선) ⚲" — sticky (⚲ icon = locked)
- "📐 그리기 평면: 스케치 lock" — sketch mode

### Q4 — ADR 작성: (a) 신규 ADR + Path Z atomic 6-step

**Lock-in**: ADR-149/150/151 canonical pattern 1:1 mirror (4번째 ADR
template reproducibility).

### Q5 — 진입 시점: (b) ADR-151 closure 후 (순차 안전)

**Lock-in**: ADR-151 (Sprint 3 셋째) 완료 후 ADR-164 진입. 두 ADR
서로 무관 파일이지만 *순차 진행* 으로 결재 cycle 최소화 + cross-cut
risk 차단.

## 3. Path Z atomic plan (5 sub-step, ADR-149/150/151 보다 단순)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-164 spec only commit (본 PR) | +0 |
| **β-1** | ToolManager `_lastDrawnPlane` 멤버 + setter API + reset hooks (view/sketch/Esc) + 4 회귀 | +4 (vitest) |
| **β-2** | Draw 도구 (6개 — Rect/Circle/Line/Arc/Bezier/Freehand) hook 통합 — `setLastDrawnPlane` 호출 + 6 회귀 | +6 (vitest) |
| **β-3** | UI StatusBar plane display + ContextMenu "기본 평면으로" reset + 4 회귀 | +4 (vitest) |
| **γ** | E2E + closure docs (Status Proposed → Accepted + §9 Lessons) | +3 (Playwright) |
| **합계** | | **+17** |

**예상 시간**: 5일 (1주 single-week — ADR-149/150 보다 단순, Engine
변경 0 + WASM bridge 0, TS only).

**ADR-141 §3 Sprint scope 외부**: 사용자 작업지시 trigger 로 별도 추가.
Sprint 3 의 ADR-151 closure 후 진입.

## 4. Lock-ins (canonical for ADR-164)

- **L-164-1** Q1=(a) Option A — Sticky last drawn plane (in-memory only,
  localStorage 미사용)
- **L-164-2** Q2=(a) Reset trigger: view mode change / sketch enter+exit
  / Esc (메타-원칙 #16 보완)
- **L-164-3** Q3=(a) Status display 동시 (β-3 스코프, 메타-원칙 #5
  강화)
- **L-164-4** Q4=(a) 신규 ADR + Path Z atomic 5-step (ADR-149/150 1:1
  mirror, β-1/β-2/β-3 단순화)
- **L-164-5** Q5=(b) ADR-151 closure 후 진입 (순차 안전)
- **L-164-6** Engine 변경 0 — TypeScript only (`web/src/tools/`)
- **L-164-7** ADR-046 P31 #4 additive only — 기존 동작 변경 시점 명확
  (Cursor on face 우선순위 #2 UNCHANGED, sticky 는 fallback layer 만)
- **L-164-8** 기존 회귀 자산 변경 0 — Cursor-on-face 동작 보존
- **L-164-9** localStorage 미사용 — session-only (cross-session sticky
  는 별도 ADR, 현재 scope 명확화)
- **L-164-10** 절대 #[ignore] 금지 17/17 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **Cross-session sticky (localStorage)** — 별도 ADR (현재는 session 만)
- **Recent face proximity match** (Option B audit) — 별도 ADR
- **Selection-driven plane lock** (Option C audit) — 별도 ADR (메타-원칙
  #16 명시 trigger 패턴)
- **Layered priority (Option D)** — multi-week atomic, 별도 ADR
- **Plane tolerance UI slider** — 별도 ADR (현재는 strict)
- **Multi-monitor / split-view sticky** — 별도 ADR

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (vitest +4)**:
- `adr164_last_drawn_plane_initial_undefined` (baseline)
- `adr164_last_drawn_plane_setter_stores_value`
- `adr164_last_drawn_plane_reset_on_view_mode_change`
- `adr164_last_drawn_plane_reset_on_sketch_enter_and_exit`

**β-2 회귀 (vitest +6)**:
- `adr164_drawrect_sets_last_drawn_plane`
- `adr164_drawcircle_sets_last_drawn_plane`
- `adr164_drawline_sets_last_drawn_plane`
- `adr164_drawarc_sets_last_drawn_plane`
- `adr164_drawbezier_sets_last_drawn_plane`
- `adr164_drawfreehand_sets_last_drawn_plane`

**β-3 회귀 (vitest +4)**:
- `adr164_status_bar_displays_default_plane`
- `adr164_status_bar_displays_face_hit_plane`
- `adr164_status_bar_displays_sticky_plane`
- `adr164_status_bar_displays_sketch_plane`

**γ 회귀 (Playwright +3)**:
- `adr164_sticky_canonical_top_view_rect_chain` (3 RECT 연속 — 모두 XY)
- `adr164_sticky_reset_on_view_mode_change`
- `adr164_status_bar_visible_in_production_build`

## 7. Cross-link

- **Audit precondition**: PR #210 (`docs/audits/2026-05-27-auto-plane-
  detection-precheck.md`) — 4 옵션 매트릭스 + Option A 추천 finding
- ADR-140 (Surface-Aware `getDrawPlane` — 우선순위 #2 face hit
  enhanced)
- ADR-103 (Z-up view-mode default plane — 우선순위 #4)
- ADR-026 P12 (Cardinal snap SSOT — bridge level)
- ADR-149 / 150 / 151 (Sprint 3 6-step template canonical, ADR-164
  5-step 단순화)
- ADR-046 P31 #4 (additive only)
- LOCKED #7 (cardinal snap) / #43 (Z-up) / #44 (atomic per merge) / #63
  (z=0 invariant) / #65 (메타-원칙 #16) / #66 (STATUS-POLICY)
- 메타-원칙 #5 (사용자 편의) / #16 (자동화 antipattern) — canonical
  anchors

## 8. 결재 cycle log

- **2026-05-27 사용자 작업지시** — "기본적으로 각 평면에 도형을 그릴때
  같은 평면에 그려질수 있도록... 사전검토 합니다"
- **2026-05-27 audit-first canonical 12번째** (PR #210) — 4 옵션 매트
  릭스 + Option A 추천 finding
- **2026-05-27 Q1~Q5 결재** — 사용자 "(a) 추천 default 5/5 결재 → ADR
  즉시 작성" (5/5 default a/a/a/a/b):
  - Q1=(a) Option A Sticky ✅
  - Q2=(a) Reset: view + sketch enter+exit + Esc ✅
  - Q3=(a) Status display 동시 (β-extension) ✅
  - Q4=(a) 신규 ADR 작성 ✅
  - Q5=(b) ADR-151 closure 후 진입 ✅
- **2026-05-27 α** (본 commit) — ADR-164 spec only PR
- **TBD β-1** — ToolManager `_lastDrawnPlane` 멤버 + 4 회귀
- **TBD β-2** — Draw 도구 6개 hook + 6 회귀
- **TBD β-3** — UI Status display + ContextMenu reset + 4 회귀
- **TBD γ** — E2E + closure docs + §9 Lessons

## 9. Lessons (TBD — γ closure 시 작성)

본 섹션은 γ closure (Status Proposed → Accepted) 시 작성. ADR-149 / 150
/ 151 §9 Lessons (canonical for Sprint 3 ADRs) 답습 + ADR-164 의 추가
lessons 누적.

후보 lessons (β implementation 완료 시 확정):
- **audit-first canonical 12번째 가치** — 사용자 작업지시 → 사전검토 →
  4 옵션 매트릭스 → Option A 추천 (multi-week 회피)
- ADR-149 → ADR-150 → ADR-151 → ADR-164 4-ADR template reproducibility
  (Sprint 3 cumulative pattern, 단 ADR-164 는 TS only 5-step 단순화)
- 메타-원칙 #5 정합 — 명확하면 자동 (sticky), 모호하면 명시 (reset
  trigger)
- 메타-원칙 #16 보완 — 자동화 trigger 의 *명시 reset path* 가 antipattern
  완화 (view mode / Sketch / Esc — 사용자 의도 변경 명시 신호)
- Sketch mode lastPlane 패턴을 non-sketch Draw 도구에 답습 — 기존 자산
  의 architectural reuse
- TS only 5-step (vs Sprint 3 6-step) — Engine/WASM 변경 0 시 β-3 가
  UI integration 직접 포함 가능
