# ADR-074 — Boolean Group Selection UX

**Status**: Accepted (E.3 트랙 핵심 sub-step 완료 — U-1 / U-2 / U-3 / U-4 / U-6, 2026-05-05)
**Last commit**: `7796487` (U-4 Playwright E2E) → 본 commit (U-6 회고)
**Date**: 2026-05-04 (U-1 진입) → 2026-05-05 (U-6 완료)
**Anchor**: ADR-066 §E.3 (사용자 명시 Group A/B 선택 UX 미해결) —
**본 ADR 으로 닫음**
**Parent**: ADR-066 Path Y 전 stack 완료 (`eb71e7e`) + ADR-075 E.4
트랙 핵심 완료 (`92056f6`) + ADR-076 Step 1 cleanup (`580a64a`)
**Prerequisites**: ADR-066 Y-4 multi DCEL fast-path (반/반 selection
split 의 한계 — 사용자 의도 grounding 결여).

---

## 0. Summary (4 lines)

> ADR-066 Y-4 의 반/반 split (Y-4-b=(a)) 은 사용자가 첫 N face 를
> Group A, 나머지를 B 로 의도한다는 보장 0. ADR-074 = 사용자 명시
> "Set as Group A" / "Set as Group B" UX 추가. U-1 = SelectionManager
> 의 group tag 모델 확장 atomic. U-2~U-6 별도 sub-step.

---

## 1. Context

### 1.1 ADR-066 §E.3 의 미해결 항목

> **ADR-066 §E.3**: Y-4-b=(a) 반/반 split 은 selection 의 의미 있는
> grouping 보장 0. 사용자가 첫 N face 를 A, 나머지를 B 로 의도한다는
> 보장 없음. 해결 방향: 사용자 명시 group 선택 UX (예: 우클릭 메뉴
> "Set as Group A" + "Set as Group B"). 별도 ADR — UI / Tool 결정
> 매트릭스 큼.

### 1.2 사용자 가치

- **P1 (사용자)**: Boolean 시 어느 face 가 A operand, 어느 face 가 B
  operand 인지 명시 가능. "이 박스에서 저 박스 빼기" 같은 의도가
  selection 에서 직접 표현됨.
- **P3 (AI agent)**: API 호출 시 group 명시 가능 (multi-face Boolean
  의 의미 명확화).
- **드물지만 결정적인 케이스**: 사용자가 4 개 face 를 선택해서 1 개를
  A, 3 개를 B 로 묶고 싶을 때. 현재 반/반 split 은 (a, b1) (a, b2)
  (a3, b1) (a3, b2) 식으로 cartesian 이 의도와 어긋남.

---

## 2. Decision — U-1 scope + 10개 U + 4 Lock-in

### 2.1 §A — U-1 scope

**채택 (U-1 atomic, model layer only)**:
- `SelectionManager` 에 `groupTags: Map<number, 'A' | 'B'>` 추가
- 신규 method (additive): `setGroupTag` / `getGroupA` / `getGroupB` /
  `clearGroupTags` / `hasGroupSelection`
- `clearSelection` 동작 확장: `groupTags` 도 함께 clear
- 기존 `selected` / `getSelectedFaces` / 모든 method UNCHANGED
- 회귀 8 tests (절대 #[ignore] 금지)

**제외 (U-2~U-6 별도 sub-step)**:
- U-2: UI 도구 (우클릭 메뉴 / 단축키)
- U-3: `BooleanHandler.ts` 라우팅 변경 (group 우선 + fallback)
- U-4: Playwright E2E (group 선택 후 Boolean → cartesian 검증)
- U-5: Visual feedback (group 색상 / outline)
- U-6: 회고 / docs

### 2.2 §B — 10개 U 결정

| U | 결정 | 비고 |
|---|------|------|
| **U-A** | ADR-074: Boolean Group Selection UX | 자연 번호 |
| **U-B** | (b) SelectionManager 내 storage | UI stateful, project 저장 안 함 |
| **U-C** | (b) `Map<faceId, 'A'\|'B'>` | 한 face = 한 group invariant 자동 보장 |
| **U-D** | (a) 미설정 시 반/반 split fallback | drop-in alongside, 회귀 0 |
| **U-E** | `clearSelection` 시 group tags 도 clear | 일관성 |
| **U-F** | (a) A/B 만 (>2 group 미지원) | atomic 시작점 |
| **U-G** | (a) session 만 (project 저장 안 함) | atomic |
| **U-H** | 기존 `SelectionManager` API UNCHANGED | 회귀 0 |
| **U-I** | `notifyChange` 통합 (group tag 변화도 emit) | UI 자동 갱신 |
| **U-J** | 본 세션 = U-1 only | Path Z atomic |

**추가 invariant (U-C 의 자연 결과)**:
- Group A ∩ Group B = ∅ (Map 자동 보장 — 한 key 는 한 value)
- Group tags ⊆ selected (constraint: `setGroupTag` 가 selected 에
  없는 face 받으면 skip + warning)
- `clearSelection` 후 `groupTags.size === 0` (자동)

### 2.3 §C — 4 Lock-in

```
1. U-1 = SelectionManager 모델 확장 only. UI / BooleanHandler 라우팅
   / E2E / 시각 피드백 (U-2~U-5) 별도 sub-step.

2. Drop-in alongside — 기존 SelectionManager API UNCHANGED. 모든
   기존 method 동작 그대로. groupTags 는 추가 storage 일 뿐 기존
   selected 와 직교.

3. Group tags ⊆ selected (constraint). 사용자가 보이는 selection
   에서만 group 지정 가능. clearSelection 시 자연스럽게 group tags
   도 비워짐.

4. ADR-066 Y-4 fall-through 정책 보존 — hasGroupSelection() === false
   시 BooleanHandler 가 기존 반/반 split 유지 (U-3 implement). U-1
   본 sub-step 은 model layer 만 담당.
```

---

## 3. Acceptance — U-1

### 3.1 U-1 산출물

**Files modified**:
- `web/src/tools/SelectionManager.ts` (additive: groupTags + 5 methods,
  + clearSelection 확장)

**Files added**:
- (없음 — 기존 SelectionManager.test.ts 에 회귀 추가)

### 3.2 U-1 회귀 (8, 절대 #[ignore] 금지)

`SelectionManager.test.ts` 의 신규 describe block:
1. `setGroupTag tags faces in Group A correctly`
2. `setGroupTag tags faces in Group B correctly`
3. `face cannot be in both A and B simultaneously (B overwrites A)`
4. `getGroupA / getGroupB return sorted-unique subsets`
5. `clearGroupTags removes all tags but keeps selected`
6. `clearSelection removes both selected and group tags`
7. `hasGroupSelection returns true iff both groups non-empty`
   (boundary: only A → false, only B → false, both → true)
8. `setGroupTag rejects faces not in selected (constraint enforcement)`

---

## 4. Future Steps (별도 sub-step)

| Sub-step | 영역 | 회귀 | 상태 |
|----------|------|------|------|
| U-1 | SelectionManager 모델 확장 | 8 | **✅ 본 ADR §D-U1** |
| U-2 | UI 도구 (ContextMenu) | 5 | **✅ 본 ADR §D-U2** (4 ContextMenu + 1 hasAnyGroupTag) |
| U-3 | BooleanHandler 라우팅 + Toast cleanup | 5 | **✅ 본 ADR §D-U3** |
| U-4 | Playwright E2E (real Chromium) | 2 | **✅ 본 ADR §D-U4** |
| U-5 | Visual feedback (group 색상 / outline) | (~2) | 미착수 (선택적, ADR-075 §E.8 visual regression 인프라와 함께 권장) |
| U-6 | 회고 / docs | 0 | **✅ 본 commit** |
| **합계 (완료)** | — | **20** | — |

---

## D. Acceptance Log — E.3 트랙 핵심 (2026-05-04 ~ 2026-05-05)

본 세션에서 ADR-074 의 핵심 sub-step (U-1~U-4 + U-6) 이 atomic 하게
닫혔다. ADR-066 §E.3 의 미해결 항목 (사용자 명시 Group A/B 선택 UX)
을 model layer + UI 진입점 + routing + real-runtime 검증의 4-layer
stack 으로 해소. 누적 회귀 **20** (vitest 18 + Playwright 2). U-5
visual feedback 은 선택적 — 본 ADR 의 핵심 가치는 이미 완성됨.

### §D-U1 — U-1 SelectionManager 모델 확장 (commit `8b0514d`)

**의의**: ADR-066 Y-4 의 반/반 split 한계 해소를 위한 첫 단추 —
selection 위에 추가 storage `groupTags: Map<faceId, 'A'|'B'>` +
5 신규 method (additive only). 기존 `selected` API UNCHANGED.

**U-decisions**: U-A=ADR-074, U-B=(b) SelectionManager 내,
U-C=(b) `Map<faceId, 'A'|'B'>` (한 face = 한 group invariant 자동
보장), U-D=(a) 미설정 시 반/반 fallback (drop-in alongside),
U-E `clearSelection` 시 group tags 도 clear (consistency),
U-F=(a) A/B 만 (>2 group 미지원, atomic), U-G=(a) session 만
(project 저장 안 함), U-H 기존 API UNCHANGED, U-I `notifyChange`
통합, U-J U-1 only.

**Constraint** (필수 invariant): Group tags ⊆ selected.
`setGroupTag` 가 selected 에 없는 face 받으면 silently skip +
debugLog. `clearSelection` 시 자연 비워짐.

**API 추가** (`SelectionManager.ts`):
- `private groupTags = new Map<number, 'A' | 'B'>()`
- `setGroupTag(faceIds, group)` / `getGroupA()` / `getGroupB()` /
  `clearGroupTags()` / `hasGroupSelection()`
- `clearSelection()` 확장 (groupTags 도 clear)

**회귀 (8, 절대 #[ignore] 금지)**:
- setGroupTag tags faces in Group A correctly
- setGroupTag tags faces in Group B correctly
- face cannot be in both A and B simultaneously (B overwrites A)
- getGroupA / getGroupB return sorted-unique subsets
- clearGroupTags removes all tags but keeps selected
- clearSelection removes both selected and group tags
- hasGroupSelection returns true iff both groups non-empty
- setGroupTag rejects faces not in selected (constraint enforcement)

### §D-U2 — U-2 ContextMenu UI (commit `f56f02a`)

**의의**: U-1 model 위에 사용자 진입점 추가. 우클릭 메뉴 3 항목
("ⓐ Boolean Group A 지정", "ⓑ Boolean Group B 지정", "🗑 Boolean
Group 해제") 으로 selection 을 명시 grouping.

**U-2-decisions**: U-2-a snake-kebab 명명, U-2-b 가시성 클래스
`ctx-bool-group-item` / `ctx-bool-group-clear`, U-2-c Set A/B 표시
(hasSelection), U-2-d Clear 표시 (`hasAnyGroupTag` true), U-2-e=(b)
SelectionManager 직접 호출 (executeAction bypass — 순수 selection
mutation), U-2-f 단축키 미배정 (atomic), U-2-g visual feedback
별도 (U-5), U-2-h Toast 안 함 (메뉴 즉답성), U-2-i 신규 helper
`hasAnyGroupTag()`, U-2-j U-2 only.

**helper 분리**: `hasAnyGroupTag()` ≠ `hasGroupSelection()`.
- `hasAnyGroupTag` — Clear 가시성 (어느 group 이라도 1+ → true)
- `hasGroupSelection` — Routing 분기 (BOTH A and B → true, U-3)

**HTML 추가** (`web/index.html` line 2607~2609 영역):
```html
<div class="ctx-item ctx-bool-group-item" data-action="set-group-a">
  ⓐ Boolean Group A 지정</div>
<div class="ctx-item ctx-bool-group-item" data-action="set-group-b">
  ⓑ Boolean Group B 지정</div>
<div class="ctx-item ctx-bool-group-clear" data-action="clear-group-tags">
  🗑 Boolean Group 해제</div>
```

**ContextMenu.ts 확장**: 가시성 로직 + 3 case 핸들러 (defensive
`typeof setGroupTag === 'function'` 가드 — legacy bridge 호환).

**회귀 (5, 절대 #[ignore] 금지)**:
- ContextMenu (4): set-group-a / set-group-b / clear-group-tags
  → SelectionManager 직접 호출 (executeAction NOT 호출 검증);
  set-group-a no-op when selection empty (defensive)
- SelectionManager (1): hasAnyGroupTag boundary cases (4 케이스
  검증; hasGroupSelection 의 의미 차이까지)

### §D-U3 — U-3 BooleanHandler 라우팅 + Toast cleanup (commit `b275ee2`)

**의의**: U-1 model + U-2 UI 의 **가치 발현 지점**. 사용자 명시
grouping 이 multi DCEL dispatch 에 직접 반영. 부가: 사용자 의견
반영 Toast wording cleanup ("NURBS" prefix 제거 + group source
indicator 도입).

**U-3-decisions**: U-3-a routing 위치 (multi DCEL fast-path 시작),
U-3-b 우선 조건 (`hasGroupSelection() === true`), U-3-c source
(`getGroupA/B` 직접), U-3-d=(a) fallback (반/반 split, drop-in
alongside), U-3-e group ⊃ selection (constraint 보장),
U-3-f Toast 행위 표시 ("명시 그룹" / "자동 분할"), U-3-g length ≥ 2
체크 유지, U-3-h 항상 multi (Y-1 1×1 degenerate 위임), U-3-i 회귀
BooleanHandler.test.ts, U-3-j U-3 only.

**U-3-k (사용자 의견 반영)**: Toast wording cleanup
- "NURBS" prefix 4 paths 모두 제거 (engine-agnostic UX surface)
- Success Toast 에 group source indicator: "(multi, 명시 그룹)" /
  "(multi, 자동 분할)"
- ADR-076 Step 1 의 "canonical path" 정신과 일관

**`handleMultiDcelResult` 시그니처 확장**:
```typescript
groupSource: 'explicit' | 'split' = 'split'
```

**회귀 (5, 절대 #[ignore] 금지)**:
- explicit group selection routes A/B faces directly to multi
  (not half/half split) — 핵심 invariant
- hasGroupSelection() === false → falls back to half/half split
  (drop-in alongside)
- explicit group ignores untagged selected faces (A/B only)
- legacy bridge without selection.hasGroupSelection → graceful
  fallback (older SelectionManager 호환)
- Toast wording (U-3-k) — no "NURBS" prefix in any multi DCEL toast
  (success / disjoint / error 3 paths)

### §D-U4 — U-4 Playwright E2E real-runtime 검증 (commit `7796487`)

**의의**: U-1~U-3 stack 의 real Chromium round-trip 검증. **사용자
명시 grouping 이 실제 mesh dispatch 에 정확히 반영됨을 mock 이 아닌
real engine 으로 증명**. ADR-074 §C lock-in #4 closure.

**U-4-decisions**: U-4-a=(b) helper 확장 4개, U-4-b=(b) 2 atomic
(explicit + fallback), U-4-c=(c) 둘 다 (toolbar click → bridge
spy), U-4-d `dcel-group-routing.spec.ts`, U-4-e=(a) fresh page
per test, U-4-f U-4 only.

**Pre-implementation 검증** (사용자 단일 체크 포인트 반영):
- `container.register` grep 으로 `selection` 접근 경로 확정:
  `toolManager.selection` (별도 service 아님)
- 5-tier defensive throw: `__axia` / `toolManager` / `.selection` /
  U-1 method / silent → 명확한 실패 사유 즉시 식별

**Helper 추가** (`boolean-fixtures.ts`):
- `setupGroupedSelection` (5-tier throw)
- `installMultiDispatchSpy` (bridge monkey-patch capture, real engine
  호출 보존)
- `readCapturedMultiDispatch`
- `clickToolbarAction` (data-action event delegation 활용)

**Build drift 방어**: 첫 run 에서 dist/ stale 시 defensive throw
가 즉시 위치 표시 → `npm run build` rebuild → 13/13 green.

**회귀 (2, 절대 #[ignore] 금지)**:
- explicit Group A/B routes faces directly to multi (not half/half)
  — 4 face 중 [face[0]] vs [face[1..3]] grouping 검증, 반/반 split
  와 명확히 다름
- no group → falls back to half/half split (drop-in alongside)
  — `hasGroupSelection() === false` 시 mid=2 로 정확히 split

### §D-U6 — U-6 회고 / docs (본 commit)

본 회고 commit. ADR-074 §D Acceptance Log 채움 + CLAUDE.md 의
신규 "ADR-074" 섹션. 코드 변경 0.

---

## E. Known Limitations (E.3 트랙 미해결)

### E.5-1 Visual feedback (선택적 sub-step 또는 별도 ADR)

본 ADR 의 핵심 가치 (사용자 명시 grouping → real dispatch) 는
U-1~U-4 로 완성. U-5 visual feedback (group A/B 별 outline 색상)
은 polish only — model 동작은 정확히 작동, 사용자 시각 인지만 미흡.

**미진행 이유**: Three.js mock 단위 test 의 한계 — "outline mesh
가 만들어졌나" 수준 검증만 가능. 진짜 사용자 시각 경험은 ADR-075
§E.8 visual regression (screenshot diff) 인프라가 있어야 의미 있는
검증 가능. 별도 ADR 또는 ADR-075 §E.8 와 함께 진행 권장.

### E.5-2 Multi-group (>2)

U-F=(a) 결정으로 A/B 두 그룹만 지원. 사용자가 3+ operand 를 지정
하고 싶을 때 (예: `(A1 ∪ A2) - B`) 는 두 단계로 분리 (먼저 A1∪A2
union → 결과를 새 A 로 tag → B 와 subtract) 필요.

**해결 방향**: N-group 모델 확장 — `Map<faceId, GroupId>` 로 일반화.
별도 ADR (Path Z 패턴 답습 — atomic Y-N storage / Y-N UI / Y-N
routing).

### E.5-3 Persistence (project 저장 안 함)

U-G=(a) 결정으로 group tags 는 session 만 유지. project 저장
(.axia 파일) 시 group 정보 사라짐. 사용자가 같은 grouping 으로
다시 작업하려면 재선택 필요.

**해결 방향**: AXIA 직렬화 schema 에 groupTags 추가. ADR-007
invariant 검증 + AXIA 매직 바이트 호환 (legacy file 은 빈 group
으로 로드). 별도 ADR 또는 file format ADR 와 함께.

### E.5-4 단축키 (✅ atomic sub-step closure 2026-05-05)

~~U-2-f=(c) 결정으로 단축키 미배정. 우클릭 메뉴만 진입점.
파워유저 효율 제한.~~

→ **본 commit (atomic sub-step) 으로 closure**:
- `KeyboardShortcuts.ts` 에 Alt+A / Alt+B / Alt+0 핸들러 추가
- ContextMenu HTML 항목에 단축키 hint (`Alt+A` / `Alt+B` / `Alt+0`)
- 충돌 검토 완료 — Alt+A/B/0 는 기존 단축키 (Ctrl+A=Select All / 'b'=
  bottom-view / Alt+E/M/I/C/P/L/F/G/X/N=snap toggle) 와 무충돌
- 회귀 +5 (KeyboardShortcuts.test.ts) — 절대 #[ignore] 금지
- 단축키 정책: Alt 조합 + letter mnemonic (A=GroupA / B=GroupB /
  0=clear) — Snap 토글 (Alt+E/M/...) 와 일관 패턴

---

## F. 회귀 누적 (E.3 트랙)

| 단계 | Pre-E3 baseline | After E.3 | Δ |
|------|-----------------|-----------|---|
| axia-geo lib | 964 | 964 | 0 (E.3 = TS only) |
| axia-wasm tests | 16 | 16 | 0 |
| **web TS vitest** | 1410 | **1428** | **+18** (U-1 8 + U-2 5 + U-3 5) |
| **web TS Playwright E2E** | 11 | **13** | **+2** (U-4 2) |
| **합계** | 2401 | **2421** | **+20** |

**20 / 20 모두 절대 #[ignore] 금지 정책 준수**.

Sub-step 별 distribution:
- U-1: 8 vitest (SelectionManager 모델)
- U-2: 5 vitest (4 ContextMenu + 1 hasAnyGroupTag)
- U-3: 5 vitest (BooleanHandler routing + Toast cleanup)
- U-4: 2 Playwright (real Chromium round-trip)
- U-6: 0 (docs only)

### Path Z + Path Y + E.4 + E.5 + E.3 합산 (5 ADR)

| Suite | Original | After all | Δ |
|-------|----------|-----------|---|
| axia-geo lib | 940 | 964 | +24 |
| axia-wasm tests | 8 | 16 | +8 |
| web TS vitest | 1395 | 1428 | +33 |
| web TS Playwright E2E | 0 | 13 | +13 |
| **합계** | 2343 | **2421** | **+78** |

**78 / 78 모두 절대 #[ignore] 금지 정책 준수**.

CI 자동화 (ADR-075 E4-6) 로 PR 마다 자동 검증.

---

## G. ADR-074 의 의미 (E.3 트랙 시점)

ADR-064/066/075/076 의 4 ADR 시리즈 위에 **사용자 의도 grounding**
을 더한 트랙. 이전 ADR 들이 엔진 / 검증 / cleanup 이라면, ADR-074
는 **UX-driven semantic clarity**.

| 측면 | ADR-064 | ADR-066 | ADR-075 | ADR-076 | **ADR-074** |
|------|---------|---------|---------|---------|------------|
| **결정 성격** | 의미론 closure | 확장 | 검증/자동화 | cleanup | **UX grounding** |
| **위험** | 中-高 | 低-中 | 低-中 | 低 | **低-中** |
| **commits** | 10 | 6 | 6 | 2 | **5** (U-1~U-4 + U-6) |
| **회귀** | +38 | +24 | +11 | -15 (cleanup) | **+20** |
| **층** | mesh-level engine | multi-face dispatch | infra | UI sunset | **selection model + UI + routing** |

### ADR-074 의 4-layer closure

본 ADR 가 처음으로 **engine 외부 (selection model + UI + routing
+ real-runtime 검증)** 의 4-layer atomic stack 을 닫음:

| Layer | sub-step | 기여 |
|-------|----------|------|
| **Model** | U-1 | `groupTags: Map<faceId, 'A'\|'B'>` storage |
| **UI** | U-2 | ContextMenu 3 항목 (Set A/B / Clear) |
| **Routing** | U-3 | `hasGroupSelection` 분기 + Toast clarity |
| **Real-runtime** | U-4 | Playwright real Chromium E2E |

이 4-layer 패턴은 향후 selection-driven UX ADR (예: 사용자 명시
fillet edge / extrude 방향 / 등) 의 모범:
1. SelectionManager 에 storage 추가 (Map / Set, additive)
2. ContextMenu HTML + handler (defensive guard)
3. 소비 도구의 routing 분기 (drop-in fallback)
4. Real-runtime E2E (boolean-fixtures helpers 패턴)

남은 미해결 (E.5-1 ~ E.5-4) 은 모두 **선택적 polish 또는 별도
트랙** — 본 ADR 의 핵심 가치 (selection grounding) 는 이미 완성.

---

## 5. References

- ADR-066 §E.3 (Group A/B 선택 UX 미해결)
- ADR-066 Y-4 (반/반 split 의 위치)
- `web/src/tools/SelectionManager.ts` (확장 대상)
- `web/src/ui/BooleanHandler.ts` (U-3 의 라우팅 변경 대상)

---

*Author*: AXiA team (E.3 트랙 사용자 결정 2026-05-04)
*Status*: **E.3 트랙 핵심 sub-step 완료 2026-05-05** — 5 commits,
20 회귀 (vitest 18 + Playwright 2), 모든 U-decision lock-in.
U-5 visual feedback 은 ADR-075 §E.8 visual regression 인프라와
함께 별도 진행 권장. E.5-1~E.5-4 미해결 항목 모두 선택적 확장.
