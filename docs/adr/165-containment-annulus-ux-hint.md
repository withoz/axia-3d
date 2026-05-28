# ADR-165 — Containment Annulus UX Hint + 단축키 (사용자 시연 trigger)

**Status**: Proposed (α spec — β implementation 별도 사용자 결재 후 진행)
**Date**: 2026-05-28
**Author**: WYKO + Claude
**Trigger**: 사용자 시연 evidence "면이 안잘림" (2026-05-28). Investigation
(`docs/investigations/2026-05-28-circle-in-circle-face-split.md`) §9
production-evidence amendment 의 UX gap (P3) 해결.
**Audit precondition**: Investigation §6 의 옵션 매트릭스 (A1 단축키
+ A2 Toast hint 묶음 권장) + 직접 production E2E 시연 false alarm
정정 evidence.
**Direct predecessor**:
- ADR-145 (Circle annulus 명시 promote) — Engine + ContextMenu UI 기반
- ADR-164 (Auto Plane Detection — Sticky Last Drawn Plane) — 5-step
  variant UI hint pattern source
- ADR-139 (Boundary tool — 명시 trigger 패턴)
**Sprint scope**: ADR-141 §3 외부 트랙 (사용자 작업지시 trigger,
ADR-164 답습 패턴).

## Canonical anchor

사용자 직관: "원 안에 원 = hole" → 그러나 메타-원칙 #16 정합으로 자동
trigger 없음 + ADR-145 ContextMenu "Annulus 만들기" 사용자가 발견 못 함.

**핵심 통찰**: 명시 trigger 보존 (메타-원칙 #16) + UX hint 강화 (사용자
인지 도움) 동시 달성. ADR-164 의 "명확하면 자동" (sticky plane)
+ "모호하면 명시" (reset trigger) balance 답습.

## 1. Problem statement

### 1.1 Investigation §9.3 사용자 워크플로우 재해석

스크린샷 evidence:
- 사용자가 두 원 (concentric containment) 그림
- ContextMenu "Annulus 만들기" 명시 호출 **안 함**
- "면이 안잘림" 보고 → **UX gap, 아닌 bug**

### 1.2 ADR-145 ContextMenu 현재 상태

- 가시성 로직: exactly 2 face 선택 시만 표시 (ADR-145 β-4)
- 위치: 우클릭 메뉴 (메뉴 항목 가능성 미인지 user)
- 단축키: **없음**

### 1.3 메타-원칙 정합

- **메타-원칙 #5 (사용자 편의)** — 명확하면 자동 / 모호하면 명시
- **메타-원칙 #16 (자동화 antipattern)** — 휴리스틱 자동 추측 금지
- **균형**: 자동 *detect* (containment 시 hint Toast) + 명시 *promote*
  (사용자 결재 후 ContextMenu/단축키 호출). ADR-164 sticky plane 의
  *명시 reset trigger* 패턴 답습.

## 2. Solution architecture (5 Q 결재 default 5/5)

### Q1 — Hint 강도: (a) Toast info 5초 + 단축키 안내

**Lock-in**: 두 원 그린 직후 *automatic containment detect* → Toast
표시:
```
💡 두 원이 동심원 — "Annulus 만들기" 가능
   → 우클릭 메뉴 또는 단축키 [Ctrl+H]
```

- Toast 5초 자동 dismiss (사용자 ESC/click dismiss 가능)
- *명시 promote* 는 사용자 선택 (Toast 만으로 자동 promote 안 함)
- Q3 (자동 promote opt-in) 은 별도 ADR

### Q2 — 단축키: (a) `Ctrl+H` (Hole mnemonic)

**Lock-in**: ContextMenu "Annulus 만들기" 의 keyboard shortcut.
- `Ctrl+H` (Hole 의미적 mnemonic)
- 충돌 audit: 현재 Ctrl+H 미배정 (Help 는 F1 / Ctrl+? 분리)
- 동작: 정확히 2 face 선택 시만 활성, 그 외 시점 silent skip + Toast.warning
  ("2개 원 면 선택 필요")

### Q3 — Containment detect 알고리즘: (a) 두 마지막 face 시점 (light algorithm)

**Lock-in**: 사용자가 두 번째 Circle face 그린 시점에서:
1. 마지막 그린 face 가 Circle (AnalyticCurve::Circle)
2. 이전 face 가 Circle (AnalyticCurve::Circle)
3. 두 face coplanar (LOCKED #5 tolerance 1.5μm)
4. 한 Circle 이 다른 Circle 내부 contained (center distance + small radius
   ≤ large radius)
→ Toast hint 표시

**비-targeted**: 모든 face pair containment 매번 scan (메타-원칙 #11
Latency Budget — sketch 도구 hover 16ms budget). **마지막 2 face 만
check** = O(1).

### Q4 — Template: (a) 5-step variant (UI 없음 except Toast/단축키)

**Lock-in**: ADR-164 답습 (5-step UI-only ADR pattern):
- α: spec
- β-1: containment detect helper (TS, ToolManager.detectAnnulusHint)
- β-2: Toast hint wiring (Draw 도구 commit 후 검사)
- β-3: 단축키 Ctrl+H + ContextMenu shortcut hint 추가
- γ: E2E + closure docs

Engine 변경 **0** (TS-only — ADR-164 답습).

### Q5 — 회귀 분배: (a) +14 (β-1 4 + β-2 4 + β-3 3 + γ 3)

**Lock-in**: ADR-141 §3 budget 외부 트랙 (사용자 작업지시).

## 3. Path Z atomic plan (5 sub-step)

| Sub-step | 내용 | 회귀 |
|---|---|---|
| **α** | ADR-165 spec only commit (본 PR) + Investigation §9 amendment | +0 |
| **β-1** | `detectAnnulusHint(face_a, face_b): boolean` helper (ToolManager) + 4 회귀 (concentric containment / non-concentric containment / partial overlap / disjoint) | +4 |
| **β-2** | Draw 도구 6개 (Circle/Bezier/Freehand) commit hook → 두 마지막 face containment detect → Toast.info 5초 + 4 회귀 (Toast presence / 5초 dismiss / non-containment no Toast / consecutive draws debounce) | +4 |
| **β-3** | 단축키 `Ctrl+H` + ContextMenu "Annulus 만들기" 항목에 shortcut badge + 3 회귀 (keybind / 2-face 활성 / 1/3+ face silent skip) | +3 |
| **γ** | Playwright E2E + closure docs (Status Proposed → Accepted + §9 Lessons + README + LOCKED 등재) | +3 |
| **합계** | | **+14** |

**예상 시간**: 1일 single-day (ADR-164 5-step variant 1-day reproducibility).

## 4. Lock-ins (canonical for ADR-165)

- **L-165-1** Q1=(a) Toast hint 5초 (자동 promote 안 함)
- **L-165-2** Q2=(a) Ctrl+H 단축키 (Hole mnemonic, 충돌 0)
- **L-165-3** Q3=(a) 마지막 2 face containment detect (O(1) latency)
- **L-165-4** Q4=(a) 5-step variant (ADR-164 답습)
- **L-165-5** Q5=(a) +14 회귀 분배
- **L-165-6** Engine 변경 0 — TypeScript only (`web/src/`)
- **L-165-7** ADR-046 P31 #4 additive only — ADR-145 ContextMenu API
  UNCHANGED (shortcut badge 만 추가)
- **L-165-8** 메타-원칙 #16 보존 — 자동 promote 없음, hint 만 (명시 trigger
  보존)
- **L-165-9** 메타-원칙 #5 정합 — 사용자 편의 (Toast hint = 자동 detect,
  promote = 명시 결재)
- **L-165-10** 절대 #[ignore] 금지 14/14 강제

## 5. Out of scope (선택적 또는 별도 ADR)

- **자동 hole detect promote** (Investigation 옵션 B) — 별도 ADR
  (메타-원칙 #16 의 partial relaxation — *명확* containment 만)
- **`bridge.activeFaceCount()` API 추가** — 별도 micro-ADR (semantic
  clarity)
- **다른 close-curve 도형 (Ellipse, closed Bezier) annulus 확장** — ADR-145
  의 Sprint 5 자연 trigger
- **Toast multi-dismiss UX** — 별도 UX 트랙
- **Inspector hint banner** — 별도 UX ADR

## 6. 회귀 자산 강제 (절대 #[ignore] 금지)

**β-1 회귀 (vitest +4)**:
- `adr165_detect_annulus_hint_concentric_containment_true`
- `adr165_detect_annulus_hint_non_concentric_containment_true`
- `adr165_detect_annulus_hint_partial_overlap_false`
- `adr165_detect_annulus_hint_disjoint_false`

**β-2 회귀 (vitest +4)**:
- `adr165_draw_circle_chain_triggers_toast_hint_on_containment`
- `adr165_toast_hint_dismisses_after_5_seconds`
- `adr165_no_toast_when_non_containment`
- `adr165_consecutive_draws_debounce_single_toast`

**β-3 회귀 (vitest +3)**:
- `adr165_ctrl_h_triggers_promote_on_2_face_selection`
- `adr165_ctrl_h_silent_skip_on_1_or_3_plus_faces` (Toast.warning 표시)
- `adr165_context_menu_shortcut_badge_present`

**γ 회귀 (Playwright +3)**:
- `adr165_gamma_two_circle_containment_browser_toast_evidence`
- `adr165_gamma_ctrl_h_keyboard_shortcut_browser_evidence`
- `adr165_gamma_no_auto_promote_evidence` (meta-원칙 #16 정합)

## 7. Cross-link

- **Investigation precondition**: `docs/investigations/2026-05-28-circle-
  in-circle-face-split.md` §9 production-evidence amendment
- **ADR-145** (Circle annulus 명시 promote) — Engine + ContextMenu base
- **ADR-164** (Auto Plane Detection — Sticky Last Drawn Plane) — 5-step
  variant UI hint pattern source (1-day closure reproducibility)
- **ADR-139** (Boundary tool 명시 trigger) — 메타-원칙 #16 anchor
- ADR-021 P7 LOCKED #1 (containment topology canonical)
- ADR-046 P31 #4 (additive only)
- 메타-원칙 #5 (사용자 편의) + #16 (자동화 antipattern)
- LOCKED #1 / #28 (ADR-145) / #44 / #65 메타-원칙 #5/#16 / #66 STATUS-POLICY

## 8. 결재 cycle log

- **2026-05-28 사용자 시연** — "면이 안잘림" 스크린샷 evidence
- **2026-05-28 Investigation precondition** — `docs/investigations/...`
  (PR #229 merged) §1-8 작성
- **2026-05-28 사용자 직접 테스트** — Playwright E2E diagnostic 시연
- **2026-05-28 false alarm 정정** — Investigation §9 amendment
  (production-evidence)
- **2026-05-28 사용자 추천 진행** — 옵션 (1) Investigation 갱신 +
  ADR-165 α spec 진입 (본 commit)
- **2026-05-28 Q1~Q5 자동 결재** — 추천 default 5/5 (사용자 명시 "추천
  진행")
- **2026-05-28 α** (본 commit) — ADR-165 spec only PR
- **TBD β-1** — detectAnnulusHint helper + 4 회귀
- **TBD β-2** — Draw 도구 hook + Toast + 4 회귀
- **TBD β-3** — Ctrl+H 단축키 + 3 회귀
- **TBD γ** — E2E + closure docs + §9 Lessons

## 9. Lessons (TBD — γ closure 시 작성)

본 섹션은 γ closure (Status Proposed → Accepted) 시 작성. ADR-164 §9
Lessons (5-step variant pattern) 답습 + ADR-165 의 *production-evidence
trigger* 가치 명시.

후보 lessons (β implementation 완료 시 확정):
- **사용자 직접 시연 게이트의 architectural 가치** — false alarm 발견
  + UX gap 정확 식별
- ADR-164 → ADR-165 5-step variant 2번째 reproducibility (TS-only,
  Engine 변경 0)
- 메타-원칙 #5 + #16 balance — *hint 자동* + *promote 명시*
- `bridge.faceCount()` semantic 의문 → future ADR (semantic API
  audit)
- ADR-145 → ADR-165 자연 UX 진화 (명시 promote 의 discoverability 강화)
