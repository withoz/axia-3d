# ADR-039: Hover & Preselect Owner-ID Unification

**Status**: **Accepted** (2026-05-01) — LOCKED 정책 #17
**Initiative**: AxiA 3D UX 입력 레이어 정리
**Builds on**: ADR-014 메타-원칙 #13 (One Source, Two Views), ADR-037
(Pick → Promote, P22), ADR-038 (Surface-Aware Normals, P23)

## Context

ADR-037 P22 로 **selection 의 의미 단위** (EdgeId/FaceId) 가 잠긴 상태.
다만 **hover / preselect 는 여전히 raw hit (segment / triangle index) 기준**
으로 작동 — 사용자에게 "조각조각 눌리는 느낌" 의 잔재.

### 현재 상태 베이스라인

| 단계 | 단위 | 검증 |
|---|---|---|
| **Click 후 selection state** | ✅ Owner ID | ADR-037 P22.1 |
| **Highlight 렌더링** | ✅ Owner ID 기반 | ADR-037 P22.4 |
| **Hover / Preselect** | ❌ raw hit (segment/triangle) | 본 ADR 의 대상 |
| **Drag-select** | ✅ Owner ID | (BoxSelect 가 이미 promote 적용) |

### 사용자 인지 영향

ADR-038 의 분석적 곡면 + ADR-037 의 click promote 가 모두 잠겨도, **hover
가 segment 단위면** 사용자는:
- 곡선 위 마우스 이동 시 강조가 끊겨 보임 (1 segment → 다른 segment 로 전환할 때 깜빡임)
- 곡면 위에서도 같은 face 인데 triangle 마다 hover indicator 가 jitter
- **"의미는 하나인데 시각이 부서져 있음"** — Pick→Promote 의 선언이 깨져 보임

## Decision

### P24 — 새 원칙: Hover & Preselect Owner-ID Unification

> **Hover / Preselect 도 Pick → Promote 패턴을 적용한다. 즉시. 항상.**
>
> mousemove 결과의 raw hit (segment/triangle index) 는 **immediate
> promotion** 후 owner ID (`EdgeId` | `FaceId`) 형태로만 저장. 시각
> 표현은 owner ID 의 모든 drawable 을 동시 강조.

### P24 세부 규칙 (8 항목)

**P24.1 — HoverTarget tagged union 강제**

```typescript
type HoverTarget =
  | { kind: 'edge'; id: number }   // EdgeId raw
  | { kind: 'face'; id: number }   // FaceId raw
  | null;
```

이유:
- `EdgeId | FaceId` 는 둘 다 `number` → 컴파일 타임 구분 불가 (footgun)
- Tagged union 으로 `kind` discriminator 강제 — switch case exhaustive check
- "edge/face mixed render path" 의 분기 버그 차단

**P24.2 — Stickiness invariant** (한 줄로 잠금)

```typescript
const newHover = pickAndPromote(...);
if (sameOwner(newHover, this.hovered)) return;  // ← no-op on same owner
this.hovered = newHover;
```

이유:
- BVH raycast 는 1px 차이로도 다른 segment 를 hit
- Promotion 후 owner 가 같으면 hover state 변경 0 → "파르르 떨림" 자연 해소
- 시각적 안정 → 비용 0

**P24.3 — Hover state lifecycle (6 케이스)**

| 트리거 | 동작 |
|---|---|
| Mouse 가 viewport 밖으로 나감 (mouseleave) | clear |
| Mouse 가 empty space 위 (raycast miss) | clear |
| Tool 변경 | clear |
| Drag 시작 (drag-select / 다른 도구의 첫 클릭 후 mouse 이동) | freeze (drag 종료 후 재계산) |
| Modal / dialog 열림 | clear |
| ESC | clear |

**P24.4 — Edge / Face hover 우선순위 (ADR-037 P22 유지)**

기존 `pickEdgeOrFace` 의 `preferEdgeWithinPx` 그대로 사용 — 단 결과는
**owner ID 로 promote** 후 `HoverTarget` 으로 저장:

```typescript
const hit = viewport.pickEdgeOrFace(x, y);
if (!hit) return null;
if (hit.type === 'edge') {
  const segIdx = Math.floor(hit.hit.index / 2);
  const edgeId = ctx.edgeMap[segIdx];
  return { kind: 'edge', id: edgeId };
}
if (hit.type === 'face') {
  const faceId = ctx.getFaceId(hit.hit.faceIndex);
  return { kind: 'face', id: faceId };
}
return null;
```

**P24.5 — Highlight 렌더 시각 규칙 (selection 과 분리)**

| | Selection | Hover (preselect) |
|---|---|---|
| Edge 두께 | 100% | 70% (얇음) |
| Edge 색 | 진한 파랑 #1976d2 | 연한 파랑 #64b5f6 |
| Face 색 | 강조 (orange/blue tint) | 미세 tint (밝기만 ↑) |
| Z-order | 위 | hover 가 selection 보다 아래 |
| Transition | hover → click 시 즉시 selection 상태로 | 시각적 점프 없음 |

본 표는 권장 색상 — UI 구현이 결정 후 본 ADR 갱신 가능.

**P24.6 — `selected ⊃ hover` 일관성**

- Hover 는 항상 0 또는 1개의 owner
- Selection 은 0..n 개
- Hover 한 owner 가 click 되면 selection 에 추가됨
- `hover.id === selected.has(...)` 일 때 시각: selection 색만 표시 (hover 색 가려짐)

**P24.7 — 분석적 곡선 hover 정밀도 (별도 ADR)**

본 ADR 은 segment-tessellation 에 대한 hover promote 까지. AnalyticCurve
의 정확한 거리-기반 hover (Circle/Arc/Bezier/NURBS 의 closed-form
또는 sampling 기반) 는 **ADR-040** 으로 분리.

이유:
- 본 ADR 은 입력→상태 레이어 정리 (UX 일관성)
- ADR-040 은 정밀도/성능 trade-off (CCI 호출 비용)
- 두 ADR 모두 본 P24 의 기반 위에서 작동 가능

**P24.8 — 회귀 테스트 (절대 #[ignore] 금지)**

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `hover_circle_sweep_no_breaking` | 원 위 sweep 시 hovered ID 변화 0 (P24.2 stickiness) |
| 2 | `hover_jitter_1px_stable_owner_id` | 1px 흔들림 → hovered 변화 0 |
| 3 | `hover_clears_on_tool_change` | Tool 변경 → hover null |
| 4 | `hover_clears_on_mouseleave` | mouseleave → hover null |
| 5 | `hover_owner_id_matches_click_result` | 같은 위치에서 hover ↔ click owner 일치 |
| 6 | `multi_curve_hover_switches_owner_correctly` | 다른 curve 로 이동 → owner ID 정확히 전환 |

## Implementation

### Module 변경

| 파일 | 변경 |
|---|---|
| `web/src/tools/SelectTool.ts` | `onMouseMove` 에 hover promote 로직 + `hovered: HoverTarget` 멤버 |
| `web/src/viewport/Viewport.ts` | hover highlight 렌더 (P24.5 시각 규칙) |
| `web/src/tools/ITool.ts` (or context) | `setHover(target: HoverTarget)` API 추가 |

### State 흐름

```
[mousemove]
  → SelectTool.onMouseMove
    → viewport.pickEdgeOrFace(x, y)
      → returns raw hit (segment/triangle)
    → promote to HoverTarget
    → if sameOwner(new, old): return (P24.2)
    → else: setHover(new); render update
```

### Stage 분할 (각 commit 독립 회귀 0)

```
Stage 1: HoverTarget tagged union state 분리 (빈 구현)
  - SelectTool.hovered: HoverTarget | null = null
  - 빈 setHover() 메서드
  - 회귀 0 — 기존 동작 변동 없음

Stage 2: Hover Pick → Promote 로직
  - onMouseMove → pickEdgeOrFace → promote → setHover
  - Stickiness check 포함

Stage 3: Highlight 렌더 경로 owner ID 통일 + 시각 규칙
  - hover 색/두께 적용 (P24.5)
  - selection 과 분리

회귀 테스트 6개 (P24.8) 추가
```

## Risks & Mitigations

- **R1** — 60Hz mousemove 마다 promote 호출 → 비용 증가: 무시 가능
  (HashMap lookup O(1) + BVH raycast 가 이미 매 프레임 호출됨)
- **R2** — Hover state 가 Tool 별로 다른 의미: SelectTool 외 도구에서
  hover 는 "highlight only" 의도. P24 는 SelectTool 우선 적용 후
  Move/Rotate/Scale 등 도구별로 별도 적용 (별도 PR).
- **R3** — Modal / dialog open 시 hover 누수: P24.3 6 케이스 명시 → 회귀
  테스트로 잠금.
- **R4** — Stickiness 의 "동일 owner" 비교에서 edge 와 face 는 다른 namespace
  → tagged union (P24.1) 으로 자연 차단 (kind 부터 비교).

## Success Criteria

- ✅ ADR-039 P24 가 commit 으로 고정 (이 PR)
- ✅ CLAUDE.md LOCKED #17 추가
- ⏳ Stage 1~3 구현 commit
- ⏳ 6개 회귀 테스트 통과
- ⏳ 사용자 검증: 원 위 sweep 시 깜빡임 0

## References

- ADR-014 메타-원칙 #13 (One Source, Two Views)
- ADR-037 P22 (Pick → Promote — selection state)
- ADR-038 P23 (Surface-Aware Normals)
- 산업 CAD 의 hover preview 패턴 (SolidWorks "Selection Filter",
  Fusion 360 "Highlight on hover")

## 변경 이력

- **2026-05-01 (initial)**: P24 채택. 8 세부 규칙 + 6 회귀 테스트 + 3
  stage 분할 + AnalyticCurve hover 는 ADR-040 으로 분리.
