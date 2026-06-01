# ADR-166 — Active Sketch Plane Session Lock (사용자 작업지시 trigger)

**Status**: Accepted (γ closure 2026-05-29 — 5-step variant 3번째 reproducibility, 1-day single-day closure)

> ⚠ **Scope amended by ADR-182** (2026-06-01, 사용자 결재). 본 ADR 의 lock 은
> "cross-tool 영구 유지" 였으나, ADR-182 가 **in-progress multi-click only** 로
> scope 축소 — 새 draw 첫 클릭(tool idle)에 lock 자동 해제 → 커서 아래 입체면
> 재검출 (axia-sketch D102 답습). 진행 중 multi-click 의 corner 일관성 + 명시
> unlock path + sticky coexist + badge 등 나머지 lock-in 은 **불변**. cross-draw
> 평면 연속성은 ADR-164 sticky 가 담당. 근거: `docs/adr/182-plane-lock-
> inprogress-scope.md` §1·§4.

**Date**: 2026-05-28 (α) / 2026-05-29 (β-1 / β-2 / β-3 / γ closure)
**Author**: WYKO + Claude
**Trigger**: 사용자 작업지시 (2026-05-28, canonical):
> "도형을 만들때 같은 plane에 그릴 확률을 높이는 방향으로 개선
> 해결: Sticky plane lock — 첫 도형 first_click 시점에 active_sketch_plane
> 자동 set. 후속 도구도 그 plane 유지 (명시 release 까지)."
**Audit precondition**: 사용자 8-layer 비교 매트릭스 evidence (2026-05-28
세션) — 다른 엔진의 plane management 8-layer 방어선 vs AxiA 현재 4-layer.
audit-first canonical 15번째 적용 (Sprint 4 ADR-153 audit = 14번째).
**Direct predecessor**:
- ADR-164 (Auto Plane Detection — Sticky Last Drawn Plane) — 직계 source,
  5-step variant pattern
- ADR-140 (Surface-Aware getDrawPlane) — 우선순위 #2 보존
- ADR-145 (Annulus 명시 promote) — 명시 trigger pattern
**Sprint scope**: ADR-141 §3 외부 트랙 (사용자 작업지시 trigger,
ADR-164 답습 패턴). Track 5 — Plane Management.

## Canonical anchor

사용자 작업지시 가장 강한 형태 — ADR-164 의 *sticky* (post-commit weak
fallback) 을 *lock* (pre-commit + cross-tool strong) 으로 강화. 8-layer
비교 매트릭스 의 L4 (Auto-Plane Pick set semantic) + L7 (Plane Lock
cross-tool) 답습.

**핵심 통찰**:
- ADR-164 sticky: *post-commit* 마지막 그린 plane 기억 (weak fallback)
- ADR-166 lock: *pre-commit* 첫 클릭에서 plane 잠금 + 모든 도구 유지
  (strong lock, 명시 release 까지)
- 두 mechanism *coexist* — sticky 는 lock 없을 때 fallback

## 1. Problem statement

### 1.1 ADR-164 의 한계

ADR-164 의 sticky semantic (2026-05-28 production active):
- Post-commit hook (β-2) — face 합성 *성공* 후 plane 기억
- Same-tool 가정 — 다음 commit 도 같은 도구 가정
- Weak fallback — face hit miss 시만 priority #3 사용
- Cross-tool 손실 — 도구 전환 시 `_lastDrawnPlane` 그대로지만, 사용자가
  의식적 plane lock 표현 부재

### 1.2 사용자 작업지시 gap

| 사용자 시나리오 | 현재 동작 | 사용자 기대 |
|---|---|---|
| Rect 1 그림 → Rect 2 그릴 때 | ADR-164: sticky last drawn (weak) | 같은 plane 강제 (strong lock) |
| Rect 1 그림 → Circle 도구 전환 | _lastDrawnPlane 보존 + Circle face hit 우선 (weak) | **Circle 도구도 같은 plane** (cross-tool strong lock) |
| 사용자가 다른 plane 그리고 싶음 | View 변경 / Sketch / Esc | **명시 unlock** (UI 명확) |

→ **사용자 작업지시 정확 정합 = strong lock + cross-tool + 명시 release**.

### 1.3 메타-원칙 정합

- **메타-원칙 #5 (사용자 편의)** — *명확하면 자동* (first_click set lock,
  같은 plane 그리기 확률↑)
- **메타-원칙 #16 (자동화 antipattern)** — *명시 unlock path* 보존
  (Ctrl+Shift+P / view 변경 / Sketch mode), cascading 부작용 차단
- **balance** — strong auto-lock + 명시 release = ADR-164 sticky 의 자연
  강화

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — Trigger 시점: (a) first_click

**Lock-in**: Draw 도구 6개 (Rect / Circle / Line / Arc / Bezier / Freehand)
의 *first_click* 에서 plane lock SET. ADR-164 의 post-commit (β-2 hook)
과 *coexist*:
- first_click 시점: lock 안 됐을 시 `_planeLock = activePlane`
- post-commit 시점 (ADR-164): `_lastDrawnPlane = plane` (sticky update)
- `getDrawPlane()` 우선순위: lock > face hit > sticky > view default

### Q2 — Cross-tool 유지: (a) Yes (명시 release 까지)

**Lock-in**: 도구 전환 (`setTool`) 시 `_planeLock` 보존. **명시 release
조건만 unlock**:
- `Ctrl+Shift+P` 단축키 (명시 unlock)
- View mode 변경 (`notifyViewModeChange`, ADR-164 답습)
- Sketch enter/exit (ADR-164 답습)
- Esc (`cancelCurrentTool`, ADR-164 답습)
- ContextMenu "🔓 평면 잠금 해제"

### Q3 — Lock semantics: (a) Strong (face hit 무시)

**Lock-in**: `_planeLock` 활성 시 `getDrawPlane()` 의 face hit (priority
#2, ADR-140) **무시** — lock plane 강제 사용. 사용자 의도:
- "다른 face plane 그리고 싶음" → **명시 unlock 후 face hit 활성**
- 메타-원칙 #5 정합 — *의식적* plane control

ADR-140 surface-aware tangent plane (curved face) 은 lock 활성 시
비활성 (lock plane 우선). Sketch mode 동작과 일관.

### Q4 — 명시 release: (a) `Ctrl+Shift+P` (Plane mnemonic)

**Lock-in**: 새 단축키 `Ctrl+Shift+P`:
- 충돌 audit: 현재 미배정 (P 는 PushPull / Polygon 도구 별도)
- Mnemonic: **P** lane lock toggle (lock → unlock or 명시 unlock)
- 동작: `_planeLock` 활성 시 → unlock + Toast.info "평면 잠금 해제"
- ContextMenu "🔓 평면 잠금 해제" 메뉴 항목 (lock 활성 시만 표시)

### Q5 — UI 노출: (a) 🔒 plane lock badge (sticky badge upgrade)

**Lock-in**: `#sb-plane-badge` (ADR-164 β-3) upgrade:
- `_planeLock` 활성: **"🔒 평면 잠금 (XZ)"** (파랑→빨강 색상 변경,
  lock icon switch)
- `_lastDrawnPlane` 활성 (lock 없음): **"📐 평면: 마지막 (XZ)"**
  (ADR-164 동작 보존)
- 둘 다 없음: hidden (ADR-164 동작 보존)

## 3. Path Z atomic plan (5 sub-step, ADR-164 답습)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-166 spec only commit (본 PR) + 8-layer 비교 evidence 보존 + ADR-167/168 sequence anchor 명시 | +0 |
| **β-1** | `ToolManager._planeLock` field + `lockPlane / unlockPlane / isPlaneLocked / notifyToolChange` API + reset hooks 통합 (Ctrl+Shift+P unlock 등) + 4 회귀 (initial / lock / unlock / cross-tool 유지) | +4 |
| **β-2** | 6 Draw 도구 first_click hook — `_planeLock` 없을 시 `setPlaneLock` 호출 + ADR-164 post-commit hook 보존 + 6 회귀 (도구마다 1 first_click set evidence) | +6 |
| **β-3** | `getDrawPlane()` 우선순위 변경 (lock > face > sticky > default) + UI 🔒 badge upgrade + `Ctrl+Shift+P` 단축키 + ContextMenu "🔓 평면 잠금 해제" + 4 회귀 (priority order / Ctrl+Shift+P / badge / Menu) | +4 |
| **γ** | Playwright E2E + closure docs (Status Accepted + §9 Lessons + LOCKED 등재 + README catalog) + 3 회귀 | +3 |
| **합계** | | **+17** |

**예상 시간**: 1-day single-day (ADR-164 5-step variant 1-day
reproducibility, audit-first 15번째 evidence 예상).

## 4. Lock-ins (canonical for ADR-166)

- **L-166-1** Q1=(a) first_click trigger (사용자 작업지시 정합)
- **L-166-2** Q2=(a) cross-tool 유지 (명시 release 까지)
- **L-166-3** Q3=(a) strong lock (face hit 무시, 메타-원칙 #5)
- **L-166-4** Q4=(a) `Ctrl+Shift+P` unlock 단축키 + ContextMenu menu
- **L-166-5** Q5=(a) 🔒 badge upgrade (sticky → lock visual transition)
- **L-166-6** Engine 변경 0 — TypeScript only (`web/src/`)
- **L-166-7** ADR-164 자산 재활용 — 별도 file 신설 안 함, ToolManager
  extend
- **L-166-8** 메타-원칙 #16 정합 — *명시 unlock* path 보존 (cascading
  부작용 차단)
- **L-166-9** ADR-046 P31 #4 additive only — ADR-164 동작 보존 (sticky
  + lock coexist)
- **L-166-10** ADR-164 답습 패턴 — `_planeLock` field naming + API
  consistency (`lockPlane` mirrors `setLastDrawnPlane`)
- **L-166-11** 절대 #[ignore] 금지 17/17 강제

## 5. Out of scope (별도 ADR sequence)

본 ADR 은 **사용자 작업지시 즉시 해결** scope (L4 first_click + L7
cross-tool lock). 8-layer 비교 매트릭스 의 잔여 layer 는 별도 ADR
sequence:

| ADR | Scope | 우선순위 |
|---|---|---|
| **ADR-166 (본 ADR)** | L4 first_click + L7 plane lock | 🟢 P0 (사용자 작업지시) |
| **ADR-167 (가칭)** | L1 EPS_PLANE SSOT + L2 `same_plane()` helper (architectural debt 정리, 분산 const 6개 → SSOT) | 🟡 P1 (architectural quality) |
| **ADR-168 (가칭)** | L5 Face plane drift snap (non-cardinal face plane drift 보정, silent bug risk 차단) | 🟡 P1 (production silent bug 차단) |

**시퀀스 결재 (사용자 2026-05-28)**: **(a) → (b) → (c) 단계적 진행**.
ADR-166 closure 후 ADR-167 α 진입, ADR-167 closure 후 ADR-168 α 진입.

### 5.1 ADR-167 (가칭) sequence anchor

**EPS_PLANE SSOT + `same_plane()` helper**:
- 현재 분산 const 6개: SPATIAL_HASH_CELL=1e-4 / COPLANAR_TOLERANCE=1e-4 /
  COPLANAR_TOL=1.5e-3 (annulus) / COPLANARITY_OFFSET_TOL=1.5e-6
  (coplanar.rs) / COPLANARITY_NORMAL_DOT_MIN=0.9999 / COPLANAR_PAIR_TOL_DEG=1.0
- 신설: `axia-core/src/plane.rs` + `pub const EPS_PLANE: f64 = 1.0e-4`
  + `pub fn same_plane(a, b, eps) -> bool` (normal 평행 + signed offset)
- 3+ inline duplication 해소

### 5.2 ADR-168 (가칭) sequence anchor

**Face plane drift snap**:
- 현재 ADR-026 P12 cardinal plane SSOT (WasmBridge, normal cardinal axis
  만) — non-cardinal face plane drift 보정 없음
- 신설: `snap_to_canonical_plane(hit_plane, candidates) -> Plane` helper
  + production drift 보정 (PLANE_SNAP_NORMAL=1e-3 + PLANE_SNAP_OFFSET=1mm)
- 8-layer L5 답습 — silent bug risk (DCEL "다른 plane" 판정) 차단

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (vitest +4)**:
- `adr166_plane_lock_initial_null`
- `adr166_plane_lock_set_unlock_round_trip`
- `adr166_plane_lock_preserved_on_tool_change` (cross-tool primary
  evidence)
- `adr166_plane_lock_reset_on_view_mode_change_and_sketch_and_esc`
  (ADR-164 reset hooks integration)

**β-2 회귀 (vitest +6)**:
- `adr166_drawrect_first_click_sets_plane_lock`
- `adr166_drawcircle_first_click_sets_plane_lock`
- `adr166_drawline_first_click_sets_plane_lock`
- `adr166_drawarc_first_click_sets_plane_lock`
- `adr166_drawbezier_first_click_sets_plane_lock`
- `adr166_drawfreehand_first_click_sets_plane_lock`

**β-3 회귀 (vitest +4)**:
- `adr166_getdrawplane_priority_lock_over_face_hit` (strong lock evidence)
- `adr166_ctrl_shift_p_unlocks_plane` (단축키 evidence)
- `adr166_sb_plane_badge_lock_icon_displayed`
- `adr166_context_menu_unlock_visible_when_locked`

**γ 회귀 (Playwright +3)**:
- `adr166_gamma_two_rect_same_plane_lock_browser_evidence` (사용자 작업
  지시 정합)
- `adr166_gamma_cross_tool_lock_preserved` (Rect → Circle 도구 전환)
- `adr166_gamma_ctrl_shift_p_unlocks_browser_evidence`

## 7. Cross-link

- **ADR-164** (Auto Plane Detection — Sticky Last Drawn Plane) — 직계
  source, 5-step variant pattern 1-day closure reproducibility
- **ADR-140** (Surface-Aware getDrawPlane) — 우선순위 #2 (face hit) lock
  활성 시 무시
- **ADR-103-δ** (Z-up default plane) — 우선순위 #4 fallback 보존
- **ADR-145** (Annulus 명시 promote) — 명시 trigger pattern
- **ADR-026 P12** (Cardinal plane SSOT) — 보존
- **ADR-167 (가칭)** — EPS_PLANE SSOT + same_plane() helper (본 ADR 의
  자연 후속)
- **ADR-168 (가칭)** — Face plane drift snap (본 ADR 의 자연 후속)
- **메타-원칙 #5** (사용자 편의) + **#16** (자동화 antipattern 보완 —
  명시 unlock)
- **LOCKED #1** ADR-021 P7 / **LOCKED #44** / **LOCKED #65** 메타-원칙
  / **LOCKED #66** STATUS-POLICY

## 8. 결재 cycle log

- **2026-05-28 사용자 작업지시** — "도형을 만들때 같은 plane 에 그릴
  확률을 높이는 방향으로 개선" + "Sticky plane lock — 첫 도형 first_click
  시점에 active_sketch_plane 자동 set. 후속 도구도 그 plane 유지 (명시
  release 까지)"
- **2026-05-28 8-layer 비교 audit** — 사용자 다른 엔진 8-layer 매트릭스
  evidence + AxiA 현재 4-layer 비교 + 답습/거부 결정 매트릭스
- **2026-05-28 시퀀스 결재** — 사용자 "(a) → (b) → (c) 단계적
  architectural debt 해소" 명시 결재
- **2026-05-28 Q1~Q5 결재** — 추천 default 5/5 (사용자 "(a) ⭐ 추천")
  + 시퀀스 후 fresh 결재 (β-1 진입 시)
- **2026-05-28 α** (본 commit) — ADR-166 spec only PR + ADR-167/168
  sequence anchor 명시
- **2026-05-29 β-1** (PR #233 merged `c808bd4`) — `_planeLock` field +
  `lockPlane/unlockPlane/isPlaneLocked/getPlaneLock` API + 4 reset hooks
  (notifyViewModeChange / enterSketch / exitSketch / cancelCurrentTool)
  + **vitest +4** (절대 #[ignore] 금지 4/4)
- **2026-05-29 β-2** (PR #234 merged `091bb4e`) — ToolContext `lockPlane?`
  + `isPlaneLocked?` 확장 + 6 Draw 도구 first_click hook (idempotent
  source='first_click') + **vitest +6** (절대 #[ignore] 금지 6/6).
  Hotfix: DrawLineTool origin extraction via `normal * (-constant)`
  (THREE.Plane canonical, mock-friendly — 향후 답습 권장).
- **2026-05-29 β-3** (PR #235 merged `e7b9257`) — `getDrawPlane()`
  priority #1 lock dispatch (strong, face hit 무시) + 3-state badge
  (🔒 lock / 📐 sticky / hidden) + Ctrl+Shift+P unlock 단축키
  + ContextMenu "🔓 평면 잠금 해제" + **vitest +4** (절대 #[ignore]
  금지 4/4)
- **2026-05-29 γ** (본 commit) — Playwright E2E 3 spec (API smoke +
  cross-tool 유지 evidence / ContextMenu DOM / Ctrl+Shift+P 단축키
  real-browser dispatch) + Status Proposed → Accepted + §9 Lessons +
  LOCKED entry + README catalog Status 갱신 + **Playwright +3**
  (절대 #[ignore] 금지 3/3)
- **TBD ADR-167 α** — ADR-166 closure 후 진입 (EPS_PLANE SSOT)
- **TBD ADR-168 α** — ADR-167 closure 후 진입 (Face plane drift snap)

## 9. Lessons (γ closure 2026-05-29)

ADR-164 §9 Lessons (5-step variant pattern) 답습 + 사용자 8-layer 비교
매트릭스 audit + 단계적 sequence 결재 가치 명시. 5-step variant 3번째
reproducibility (ADR-164 / ADR-152 답습) — 1-day single-day closure
명시 evidence.

### L1 — 사용자 8-layer 비교 매트릭스 audit의 architectural 가치

사용자 다른 엔진 plane management 8-layer 매트릭스를 직접 evidence
로 받아서, AxiA 의 현재 4-layer 와 비교 후 *답습/거부 결정 매트릭스*
로 활용. audit-first canonical 15번째 적용 (ADR-125/126/127/131 답습).

**Lock-in (canonical for external-spec integration)**: 다른 엔진의
spec 통합 시 단순 답습이 아닌 *매트릭스 비교 + 결정 명시* 가 본 ADR
의 정수. 향후 외부 spec 도입 시 답습.

### L2 — ADR-164 → ADR-166 5-step variant 3번째 reproducibility (TS-only)

ADR-152 (Sprint 4 첫째, 1-day single-day) + ADR-164 (auto plane sticky)
+ ADR-166 (plane lock) — 3번째 1-day single-day 5-step variant closure.
TS-only (Engine 변경 0). audit-first canonical 의 50% time reduction
evidence 누적.

**Lock-in**: 5-step variant (α + β-1 + β-2 + β-3 + γ) 의
*TS-only Engine 변경 0* 패턴은 향후 모든 UI-only architectural ADR
의 default template.

### L3 — 메타-원칙 #5 + #16 정합 balance 강화

ADR-164 sticky (weak fallback) 는 메타-원칙 #5 (사용자 편의) 약형.
ADR-166 lock (strong cross-tool, 명시 release) 가 메타-원칙 #5 +
#16 의 *강한 balance* — *명확하면 자동* (first_click 자동 lock,
같은 plane 그리기 확률↑) + *모호하면 명시* (cross-tool 유지, 명시
unlock).

**Lock-in (canonical for #5+#16 balance)**: strong auto-trigger +
명시 release path 가 두 메타-원칙의 가장 깊은 실현. *자동/명시
의사결정 매트릭스* 의 future ADR 의 anchor pattern.

### L4 — Cross-tool state semantics — ADR-164 sticky → ADR-166 lock 자연 진화

ADR-164 sticky 는 per-tool (post-commit only). ADR-166 lock 은
cross-tool (pre-commit + 모든 도구). 두 mechanism *coexist* —
sticky 는 lock 없을 때 fallback. 자연 진화 패턴.

**Lock-in**: per-X → cross-X state semantics 진화는 *coexist* 패턴
default. 기존 mechanism 제거 안 함 — fallback 으로 통합.

### L5 — ADR-167/168 sequence anchor in spec (단계적 architectural debt 해소)

α spec 작성 시점에 ADR-167 (EPS_PLANE SSOT, P1) + ADR-168 (Face plane
drift snap, P1) 의 **sequence anchor 명시** — closure 후 자연 진입.
multi-ADR roadmap canonical.

**Lock-in**: 큰 architectural debt (8-layer 비교의 잔여 layer 등) 의
단계적 해소는 *sequence anchor in spec* 으로 lock-in. 사용자 결재
없이 진입 안 함 (사용자 명시 결재 후만 ADR-167 α 진입).

### L6 — ContextMenu unlock 패턴 canonical (사용자 명시 trigger UX)

ADR-145 (annulus 명시 promote ContextMenu) + ADR-166 (plane lock
unlock ContextMenu) — 사용자 명시 trigger UX 의 ContextMenu pattern
일관 답습. *ctx-*-item* class + visibility + dispatch handler*
3-layer template.

**Lock-in**: 사용자 명시 trigger UX 는 ContextMenu pattern default.
3-layer template (HTML data-action + visibility class + dispatch
case) 모든 명시 trigger ADR 의 답습 anchor.

### L7 — Audit-first canonical 15번째 적용 (50% time reduction evidence)

ADR-152 (Sprint 4 첫째, 1-day) + ADR-164 (auto plane, 1-day) +
ADR-166 (plane lock, 1-day) — audit-first canonical 의 누적 evidence.
50% time reduction (vs Sprint 1 평균 multi-day) 누적.

**Lock-in**: audit-first canonical 의 architectural 가치 lock-in.
ADR 진입 전 사전 audit (사용자 evidence + 매트릭스) 이 implementation
time 의 50% 절감.
