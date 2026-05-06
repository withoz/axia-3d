# ADR-080 — Offset Dimension-Aware Semantics

**Status**: **Accepted** (spec only — 구현은 후속 atomic commit, 2026-05-06)
**Date**: 2026-05-06
**Author**: AXiA team (사용자 정책 + Claude spec)
**Anchor**: 사용자 정책 (2026-05-06, ADR-079 W-2-γ-iii 결재 시점):
> "Offset 은 선택 대상의 차원에 따라 의미가 결정된다.
> 선을 선택하면 기준 평면/면에서의 곡선 offset이 적용되고,
> 면을 선택하면 해당 면의 법선 방향으로 surface offset이 적용된다.
> 이는 단일 명령이지만 서로 다른 기하 의미를 가진다."

**Parent**: ADR-079 (Create Solid — face dimension surface offset 의 운영
근거), ADR-049 (Two-Layer Citizenship — Form vs Property 차원 모델)
**Supersedes**: OffsetTool "Principle 1" (2026-04-24, face-only,
edge-offset removed) — 본 ADR 이 dimension-driven 으로 reformulate.
edge-offset 기능 부분 복원 (semantic 명확화).
**Related**: ADR-016 (Multi-loop face Q2), ADR-027 (NURBS Kernel — curve
offset 정확성), ADR-074 (Boolean Group selection), ADR-031 (Analytic
surface primitives), ADR-038 P23 (surface-aware normals)

---

## 0. Summary (6 lines)

> Offset 명령은 **선택 대상의 차원**에 따라 의미가 결정된다. 단일 UI
> 진입점, 두 의미: 선/엣지 → 호스트 면의 평면/곡면 위에서 곡선 offset
> (in-plane, 1D in 2D parameter space); 면 → 표면 법선 방향으로 surface
> offset (out-of-plane, ADR-079 W-2-γ 의미론과 일관). 사용자는 별도
> 명령을 외울 필요가 없고 선택만으로 의미가 결정. Edge selection 의 의미
> 복원 (Principle 1 2026-04-24 face-only 정책 supersede). Mixed
> selection 은 reject + Toast (사용자 명시 동의 강제).

---

## 1. Context

### 1.1 사용자 정책 출처

ADR-079 W-2-γ-iii (Cone constant-offset) 결재 시점에 사용자가 명시한
메타-원칙. Cone 의 §W2γ3-D (offset 의미론 결정) 가 face dimension 에서
의 정의였다면, 본 정책은 그 결정을 **모든 dimension 으로 일반화**.

### 1.2 W-2-γ 의 face dimension 의미론 (이미 구현됨)

ADR-079 W-2-γ-i ~ iv 에서 `AnalyticSurface::Cylinder / Sphere / Cone /
Torus` 모든 4 종에 대해 surface normal 방향 constant offset 구현. 사용자
가 face 를 클릭하고 push/pull 또는 offset 명령을 호출하면 자동으로
smooth-group 전체에 surface normal 방향 dist 적용.

본 ADR-080 은 이 의미론을 face dimension 의 SSOT 로 lock 하고, edge / 다른
dimension 에 대한 정의를 추가.

### 1.3 기존 OffsetTool 의 한계 (Principle 1, 2026-04-24)

```typescript
// web/src/tools/OffsetTool.ts:1-11
/**
 * Offset Tool — SketchUp-style face-boundary offset.
 *
 * Principle 1 (2026-04-24): edge-only offset was removed from the UI to
 * eliminate the ambiguity between "offset this one edge" and "offset the
 * whole face boundary"...
 */
```

Principle 1 은 "offset this one edge" 와 "offset the whole face boundary"
의 모호성 회피를 위한 보수적 결정. 사용자 정책 (2026-05-06) 은 그
모호성을 dimension-driven 으로 명확히 해소:

- 1 edge 선택 → 그 edge 의 곡선 offset (host face plane/surface 위)
- N edges of face boundary 선택 → 각 edge 별 곡선 offset 후 자동 fuse
  (= 기존 face-boundary 의 expand/contract 동작 재현)
- face 선택 → surface normal 방향 push/pull 의미

즉, 기존 OffsetTool 의 face-boundary 동작은 "모든 edge 가 한꺼번에 offset
된 결과" 의 자연스러운 emergent behavior 가 됨. 명령 UX 는 단일.

### 1.4 ADR-049 Two-Layer Citizenship 와의 정합

ADR-049 의 형태 / 특성 두 계층은 **자료** 의 차원 (geometric dimension
of data: edge=1D / face=2D / volume=3D) 과 별개. 본 ADR-080 은 **선택
대상의 geometric dimension** 을 명령 의미의 dispatch key 로 사용.

| Selection | Geometric dim | Offset 의미 | Math direction |
|-----------|---------------|-------------|-----------------|
| Vertex    | 0D            | (미정 — §3.3) | (n/a)         |
| Edge      | 1D            | curve offset | in-plane (host surface) |
| Face      | 2D            | surface offset | out-of-plane (normal) |
| Volume    | 3D            | (미정 — §3.4) | (n/a)         |

---

## 2. Decision

### 2.1 단일 명령, dimension-driven dispatch

- **단일 UI 진입점**: "Offset" 명령 (메뉴 / 단축키 / OffsetTool). 사용자
  가 외워야 할 명령은 1개.
- **자동 dispatch**: 명령 호출 시점의 active selection 의 dimension 으로
  의미 결정.
- **혼합 selection**: edge + face 동시 선택 시 reject + Toast ("선과
  면을 동시에 선택했습니다. 하나만 선택하세요"). 명시 분리 강제.
- **빈 selection**: tool entry 후 사용자 클릭으로 1차 선택 (기존 OffsetTool
  Phase 0 패턴 답습).

### 2.2 Edge dimension — Curve Offset (in-plane)

Edge `e` 선택 + dist `d` 입력:
- e 가 incident face `F` 의 boundary 위에 있을 때 (대부분의 경우):
  - F 의 surface 위에서 e 의 curve 를 in-plane (surface 의 2D parameter
    space) 으로 d 만큼 offset
  - F 가 Plane → 평면 위 곡선 offset (정확함)
  - F 가 Cylinder/Sphere/Cone/Torus → 곡면 parameter space 위에서 offset
    (analytic 정확함)
  - F 가 NURBS → tessellated polyline 또는 numeric offset (W-3 scope)
- e 가 free wire (incident face 없음) 일 때:
  - 기준 평면 추론: 가장 최근 active sketch plane / camera-aligned ground
    plane / explicit user input
  - 그 평면 위에서 d 만큼 offset

**연쇄 동작**: face boundary 의 N edges 선택 후 offset 실행 → 각 edge 가
곡선 offset → endpoint 일치 (기존 face boundary 의 새 위치) → face 자동
재합성. SketchUp 의 face-boundary offset 과 시각적 동일 결과.

**Multi-loop face guard** (ADR-016 Q2): hole 이 있는 face 의 boundary
edges 동시 offset 은 reject (현재 multi-loop 거부 정책 유지).

### 2.3 Face dimension — Surface Offset (out-of-plane, ADR-079 W-2-γ 의미론)

Face `F` 선택 + dist `d` 입력:
- F 가 Plane / Cylinder / Sphere / Cone / Torus → ADR-079 W-2-γ 의 smooth-
  group constant offset 호출 (이미 구현됨). 모든 group face 가 surface
  normal 방향으로 d 이동. surface 매개변수 (radius / minor_radius / apex)
  자동 갱신.
- F 가 NURBS-class → W-3 미해결 (현재 NotYetSupported → legacy push_pull
  fallback).

**Push/Pull 과의 관계**: 동일한 surface normal offset 의미 → 사용자에게
는 "Offset (face dim)" 과 "Push/Pull" 이 의미적으로 같은 명령. UI 는 두
진입점 모두 제공 (관습 + 직관 모두 만족). 내부적으로 동일한
`Mesh::create_solid` 또는 `offset_smooth_group_*` 호출.

### 2.4 Vertex / Volume dimension (Future)

본 ADR 범위 외. 별도 ADR 로 결정.

- **Vertex**: 점 offset 의 의미는 모호 (어느 방향으로?). 후속 ADR.
- **Volume**: 솔리드 전체 offset = 모든 face 의 surface offset 동시 = §2.3
  의 자연 일반화. 별도 ADR 로 명시 lock-in 권장.

### 2.5 Lock-ins

- **L1 — Single Entry Point**: "Offset" 명령은 1개. UI / 메뉴 / 단축키
  모두 단일 진입.
- **L2 — Dimension Dispatch SSOT**: dispatch key = active selection 의
  geometric dimension. 별도 modifier / mode flag 금지 (헷갈림 방지).
- **L3 — Edge = In-Plane Curve Offset**: edge dimension 의 의미는 host
  surface 의 2D parameter space 에서 곡선 offset. analytic 정확.
- **L4 — Face = Out-of-Plane Surface Offset**: face dimension 의 의미는
  surface normal 방향 constant offset (ADR-079 W-2-γ 답습).
- **L5 — Mixed Reject**: edge + face 혼합 selection → reject + Toast.
- **L6 — Push/Pull Coexistence**: PushPullTool 과 OffsetTool (face dim)
  의 의미가 같음 — 둘 다 SSOT. 사용자 의도에 따라 두 entry 모두 유지.
  내부 구현은 동일 호출 (`Mesh::create_solid` 또는
  `offset_smooth_group_*`).
- **L7 — Backward Compat (Principle 1 supersede)**: 기존 face-boundary
  offset 동작은 "전체 edge selection 후 offset" 으로 emergent. 별도
  플래그 / 메뉴 항목 유지하지 않음.
- **L8 — Multi-loop Guard**: ADR-016 Q2 (multi-loop face 거부) 유지.
  hole 면의 edges 동시 offset 도 reject.
- **L9 — Free Wire Handling**: incident face 없는 edge 의 offset 은
  명시적 reference plane (active sketch / ground / user input) 필요.

### 2.6 Q&A (사용자 결재 예상 항목)

- **Q1**: "기존 OffsetTool 의 face-boundary expand/contract 가 사라지면
  사용자가 혼란스럽지 않나?" → emergent behavior 로 보존 (모든 edges
  선택 후 offset). 시각적 결과 동일.
- **Q2**: "PushPullTool 와 OffsetTool (face) 가 같은 의미면 명령 둘 다
  필요한가?" → UI 직관 + UX 관습 (SketchUp / CAD 사용자) 모두 만족 위해
  둘 다 유지. 내부 SSOT 는 단일.
- **Q3**: "Edge offset 시 host face 가 둘 이상 (manifold edge) 이면 어느
  surface 의 parameter space 를 사용?" → 2 faces 사용 시 둘 다 평면이고
  같은 plane 이면 OK; 다르면 ambiguous → reject + 사용자에게 face 명시
  선택 요구. 단일 face 인 경우 그 face.
- **Q4**: "Free wire 의 reference plane 추론 우선순위?" → (1) active
  sketch plane (ADR-019 sketch session), (2) wire 자체의 평면성 검사
  후 그 평면, (3) ground (z=0). 충돌 시 reject.

---

## 3. Implementation Plan (post-acceptance)

본 ADR commit 은 spec only. 코드 변경 없음. 후속 sub-step:

### 3.1 V-α — OffsetTool dimension dispatch (TS layer)

- `OffsetTool.ts` 에 active selection 검사 추가
- Edge selection → edge offset path (현재 비활성, 복원)
- Face selection → 기존 face-boundary 동작 (또는 §3.3 결정에 따라
  ADR-079 surface normal 으로 swap)
- Mixed selection → Toast + reject
- 회귀: vitest +5~7

### 3.2 V-β — Edge offset Rust core 활성

- `Mesh::offset_edge` (legacy, 현재 internal) 의 contract 재정의:
  - "edge 의 curve 를 host face 의 surface 위에서 in-plane offset"
  - analytic curve 는 정확 (Line/Arc/Circle/Bezier 별 offset 공식)
  - polyline (no curve attached) 은 fallback (basis vector 추출 후
    perpendicular offset)
- 회귀: axia-geo +5~10

### 3.3 V-γ — OffsetTool face semantic 결정

L6 lock-in 의 두 옵션:
- (a) 기존 face-boundary expand/contract 유지, surface normal offset 은
  PushPullTool 만 entry
- (b) ADR-080 §2.3 strict: face dim → surface normal offset (push/pull
  의미와 동일)

V-γ 는 별도 ADR 으로 결재. Backward compat 관점에서 (a) 가 안전.

### 3.4 V-δ — Free wire handling (§2.2 후반부)

Reference plane 추론 알고리즘 + 회귀.

### 3.5 V-ε — V (Vertex) dimension 결정 (future)

별도 ADR.

### 3.6 V-ζ — Volume dimension 결정 (future)

별도 ADR.

---

## 4. Acceptance Criteria

본 ADR 의 commit 만으로 만족:

- [x] 사용자 정책 (2026-05-06, ADR-079 W-2-γ-iii 결재 anchor) 의 정확한
  인용 + cross-link
- [x] Principle 1 (2026-04-24) supersede 명시
- [x] Edge / Face / Vertex / Volume 4 dimension 의 의미 명시 (Vertex /
  Volume 은 future)
- [x] Lock-ins L1 ~ L9 명시
- [x] Q1 ~ Q4 예상 결재 항목 명시
- [x] V-α ~ V-ζ 후속 sub-step 로드맵 명시 (각각 별도 atomic commit)

본 ADR 은 코드 변경 0. 후속 sub-step 에서 의미론 구현 + 회귀 봉인.

---

## 5. Cross-references

- **ADR-079** (Create Solid) — face dimension surface offset 의 운영
  의미 (W-2-γ-i ~ iv 의 4 surface kind 답습). 본 ADR 은 그 의미를 face
  dimension 의 단일 SSOT 로 lock + 다른 dimension 에 일반화.
- **ADR-016 Q2** — multi-loop face 거부. 본 ADR L8 에서 edge offset 시
  multi-loop boundary 도 동일 거부.
- **ADR-019** — Sketch Mode. §2.2 Free Wire Handling 의 reference plane
  추론 시 active sketch plane 우선.
- **ADR-027** — NURBS Kernel. curve offset 의 analytic 정확성 (V-β
  scope).
- **ADR-038 P23** — Surface-aware normals. face offset (§2.3) 의 normal
  source 가 analytic surface evaluate 의 결과.
- **ADR-049** — Two-Layer Citizenship. 본 ADR 은 직교 — geometric
  dimension 을 dispatch key 로 사용.
- **ADR-074** — Boolean Group selection. 본 ADR 의 selection dimension
  자체와 직교하지만, group A/B 가 mixed selection 의 변형이 아님을 명시
  (group ≠ mixed dim).

---

## 6. Lessons (작성 시점)

- **Meta-policy 의 출처는 implementation 결재 중에 떠오를 수 있음**: 본
  ADR 은 ADR-079 W-2-γ-iii (Cone) 의 §W2γ3-D 결재 답변 안에 포함된 한
  문단에서 시작. spec 수준의 의미 결정은 implementation context 와 분리
  되어야 하지만, 자연스럽게 implementation 답변과 함께 등장하는 경우도
  있음 — 빠르게 별도 ADR 로 격상 (메타-원칙 #10 ADR 불변).
- **Single command, multiple meanings**: SketchUp / CAD 사용자 양쪽 모두
  익숙한 패턴 (Move 가 vertex / edge / face 모두 작동하듯). dimension-
  driven dispatch 는 사용자 cognitive load 를 줄임.
- **Backward compat 우선**: 기존 OffsetTool 의 face-boundary 동작은
  "emergent behavior" 로 자연스럽게 보존. 사용자 muscle memory 파괴 없음
  (ADR-046 P31 #4 menu changes additive only 정합).
