# ADR-074 — Boolean Group Selection UX

**Status**: U-1 진입 (Path Z atomic, 사용자 결정 2026-05-04)
**Date**: 2026-05-04
**Anchor**: ADR-066 §E.3 (사용자 명시 Group A/B 선택 UX 미해결)
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

| Sub-step | 영역 | 회귀 (예상) |
|----------|------|------------|
| U-1 | SelectionManager 모델 확장 | 8 |
| U-2 | UI 도구 (우클릭 메뉴 / 단축키) | 4 |
| U-3 | BooleanHandler 라우팅 변경 (group 우선 + fallback) | 5 |
| U-4 | Playwright E2E (group 선택 → multi DCEL 검증) | 3 |
| U-5 | Visual feedback (group 색상 / outline) — 선택적 | 2 |
| U-6 | 회고 / docs | 0 |
| **합계 (예상)** | — | **~22** |

---

## 5. References

- ADR-066 §E.3 (Group A/B 선택 UX 미해결)
- ADR-066 Y-4 (반/반 split 의 위치)
- `web/src/tools/SelectionManager.ts` (확장 대상)
- `web/src/ui/BooleanHandler.ts` (U-3 의 라우팅 변경 대상)

---

*Author*: AXiA team (E.3 트랙 사용자 결정 2026-05-04)
*Status*: U-1 implementation 진행 중
