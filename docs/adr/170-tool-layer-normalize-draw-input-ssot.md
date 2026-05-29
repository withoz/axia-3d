# ADR-170 — Phase 1 Tool Layer `normalizeDrawInput` SSOT

**Status**: Proposed (α spec, 2026-05-29)
**Date**: 2026-05-29
**Author**: WYKO + Claude
**Trigger**: ADR-169 γ closure (2026-05-29). Phase 1-4 sequence 첫째.
**Audit precondition**: ADR-169 β-1/β-2/β-3 cross-validation 정합:
- β-1 boundary element type matrix — 6 type × Tool layer entry 통일 필요
- β-2 drift propagation chain — Layer 7 Tool-specific fragmentation 가
  *가장 큰 single gap* (7 도구 × 다른 routine, β-2 §2 Layer 7 finding)
- β-3 user demo evidence — S1/S2/S4/S7 (50% scenarios) = Phase 1 단독
  cover, 75% (Phase 1+2 cumulative)
**Direct precursors**:
- **ADR-169** (γ closure, LOCKED #70 anchor) — Phase 1-4 sole audit source
- ADR-166 (plane lock) — Step 5 source
- ADR-140 (surface-aware getDrawPlane) — Step 2 face plane source
- ADR-026 P12 (cardinal SSOT, LOCKED #7) — Step 1 source
- ADR-168 (face plane drift snap, LOCKED #69) — Step 2 SSOT

**Sprint scope**: Phase 1 of 4 (LOCKED #44 Complete Meaning per Merge).
ADR-171/172/173 별도 ADR + 별도 atomic PR.

---

## Canonical anchor

ADR-169 §2.2 Q2=(a) lock-in 의 실제 구현. 7 Draw 도구 + SelectTool +
BoundaryTool 의 **single chokepoint SSOT** = `ToolManager.normalizeDrawInput`.
사용자 의도 (DrawLine on face = face split) 의 robust normalization 을
*Tool layer 진입 직후* 적용 → 후속 layer 의 ε amplification 영구 차단.

---

## 1. Problem statement

### 1.1 β-2 Layer 7 Tool-specific fragmentation (canonical finding)

ADR-169 β-2 §2.7 Layer 7 finding (canonical):
> **★ 도구별 분산** — DrawLineTool.tryFaceSplit pre-project (PR #248),
> DrawRectTool plane snap, DrawCircleTool center cardinal, etc. **★ 7
> 도구 각자 다른 routine**.

| Tool | 현재 normalize routine | LOCKED SSOT 적용 |
|---|---|---|
| DrawLineTool | tryFaceSplit pre-project (PR #248 hotfix) | LOCKED #69 partial, LOCKED #7 partial |
| DrawRectTool | plane snap + cardinal corners | LOCKED #7 only |
| DrawCircleTool | center cardinal + radius | LOCKED #7 + center face hit 없음 |
| DrawPolygonTool | DrawRectTool 답습 | LOCKED #7 only |
| DrawBezierTool | control point 직접 사용 (normalize 없음) | 없음 |
| DrawArcTool | center cardinal + arc plane | LOCKED #7 partial |
| DrawFreehandTool | drag path raw | 없음 |
| **SelectTool** | (선택 EdgeId 가 ADR-088 owner promote) | LOCKED #15 only |
| **BoundaryTool** | (ADR-148 click → boundary input) | LOCKED #69 partial |

→ **9 tools × N SSOT = N² 통합도 부재**. Cardinal SSOT (LOCKED #7) 만
defense layer 2 (WasmBridge) 에서 강제, 도구 layer 에서는 분산.

### 1.2 PR #247/#248 hotfix pattern (cascading)

| Hotfix | Trigger | Scope | Routine 통합? |
|---|---|---|---|
| PR #247 (ADR-166 soft lock) | "입체면에 라인 못 만든다" | DrawLineTool face hit | 도구 1개 |
| PR #248 (DrawLineTool face plane re-project) | "Point off face plane" | DrawLineTool tryFaceSplit | 도구 1개 |
| (future hotfix) | 다른 도구 분기 | TBD | 도구 1개 |

각 hotfix = site-local 도구 1개 수정. Tool layer normalize SSOT 없으면
*도구별 hotfix accumulation* 영구 발생.

### 1.3 메타-원칙 정합

- **메타-원칙 #4 (SSOT)** — 9 도구 × N SSOT → Tool layer single chokepoint
- **메타-원칙 #5 (사용자 편의 — 명확하면 자동)** — DrawLine on face 의도
  명확, 엔진이 robust 자동 처리해야
- **메타-원칙 #6 (Preventive over Curative)** — hotfix accumulation 영구 차단
- **메타-원칙 #11 (Latency Budget First)** — Click 33ms budget 보존 강제
- **메타-원칙 #14 (WHAT layer)** — 결과 invariant 변경 0
- **메타-원칙 #16 (WHEN layer)** — ADR-139 trigger 정책 변경 0

---

## 2. Solution architecture — `ToolManager.normalizeDrawInput` SSOT

### 2.1 5-step routine (canonical)

```typescript
// web/src/tools/ToolManagerRefactored.ts (canonical SSOT)
public normalizeDrawInput(
  rawPoint: THREE.Vector3,
  context: NormalizeContext
): NormalizedDrawInput {
  // Step 1: Cardinal axis force (LOCKED #63 z=0 invariant + LOCKED #7)
  let point = this.applyCardinalForce(rawPoint, context.viewMode);

  // Step 2: Face plane projection (LOCKED #69 ADR-168 strict snap)
  if (context.faceId != null) {
    point = this.projectToFacePlane(point, context.faceId);
  }

  // Step 3: Vertex_at silent dedup (LOCKED #5 1.5μm spatial-hash)
  const existingVertId = this.bridge.vertex_at?.(point);

  // Step 4: 10mm short-circuit (axia-sketch pattern 1, drag too small)
  if (context.chainStart != null) {
    const dist = point.distanceTo(context.chainStart);
    if (dist < MIN_DRAW_LENGTH_MM) {
      return { point, skipReason: 'DegenerateBelowEpsilon' };
    }
  }

  // Step 5: Plane lock validation (LOCKED #67 ADR-166 plane lock)
  if (this._planeLock != null) {
    const planeDot = Math.abs(context.targetNormal?.dot(this._planeLock.normal) ?? 1);
    if (planeDot < SAME_PLANE_COS_THRESHOLD) {
      // Soft lock semantic (ADR-166 amendment, PR #247)
      this.unlockPlane();
    }
  }

  return {
    point,
    vertId: existingVertId ?? undefined,
    faceId: context.faceId,
    plane: context.sketchPlane ?? null,
    skipReason: undefined,
  };
}
```

### 2.2 NormalizedDrawInput schema

```typescript
export interface NormalizedDrawInput {
  /** Normalized 3D point (cardinal force + face projection applied). */
  point: THREE.Vector3;

  /** Existing vertex ID if LOCKED #5 spatial-hash matched (silent dedup). */
  vertId?: number;

  /** Active face context (face hit OR locked plane face). */
  faceId?: number;

  /** Active drawing plane (sketch / face / cardinal). */
  plane?: Plane | null;

  /** Skip reason if input below absorption threshold (10mm short-circuit). */
  skipReason?: 'DegenerateBelowEpsilon' | 'DriftBeyondTolerance' | 'VertexCollapse';
}

export interface NormalizeContext {
  /** Active view mode (3d / top / bottom / front / back / left / right / sketch). */
  viewMode: ViewMode;

  /** Face ID under cursor (raycaster hit OR ADR-140 surface-aware). */
  faceId?: number;

  /** Target face normal for plane lock validation (ADR-166). */
  targetNormal?: THREE.Vector3;

  /** Chain start vertex for 10mm short-circuit (DrawLine 2nd click etc.). */
  chainStart?: THREE.Vector3;

  /** Active sketch plane (ADR-166 plane lock OR sketch session). */
  sketchPlane?: Plane;
}
```

### 2.3 Lock-in 매트릭스 (Q1~Q5 결재 default 5/5)

#### Q1=(a) — Single chokepoint SSOT scope: 9 tools

**Lock-in**: 7 Draw 도구 + SelectTool + BoundaryTool 모두 normalizeDrawInput
호출 강제. mousedown / mousemove / firstClick 진입 직후.

#### Q2=(a) — 5-step routine canonical (β-2 SSOT 통합)

**Lock-in**: Step 1 cardinal / Step 2 face projection / Step 3 vertex dedup
/ Step 4 short-circuit / Step 5 plane lock. β-2 §4 SSOT 매트릭스 정합.

#### Q3=(a) — `skipReason` typed envelope (silent skip 차단)

**Lock-in**: `NormalizedDrawInput.skipReason` 가 typed enum 으로 표시. 도구
caller 가 skipReason 있으면 commit 안 함 + Toast 한국어 표시.

#### Q4=(a) — Backward compat additive (LOCKED #44 정합)

**Lock-in**: 기존 `getSnappedPoint` / `get3DPoint` API 보존. normalizeDrawInput
는 새 API 추가 only. 7 도구 점진 migration (β-2 / β-3 step).

#### Q5=(a) — TS-only 변경 (Engine 변경 0)

**Lock-in**: 본 ADR Engine 변경 0. ADR-171 Phase 2 에서 Engine
absorb_boundary_input 신설. Tool layer SSOT 가 Engine 호출 *전*
normalize.

---

## 3. Sub-step roadmap (5-step variant)

본 ADR-170 의 atomic 5-step (LOCKED #44 + ADR-152/164/166/167/168/169 답습):

- **α** (본 PR): spec only — 결재 anchor 확정
- **β-1**: `normalizeDrawInput` API + 5-step routine 구현 + 회귀
- **β-2**: 7 Draw 도구 migrate (DrawLineTool / RECT / CIRCLE / Polygon /
  Bezier / Arc / Freehand) + 회귀
- **β-3**: SelectTool + BoundaryTool migrate + ContextMenu Boundary 통합 + 회귀
- **γ**: closure — Status Accepted + §9 Lessons + LOCKED entry candidate
  + README + Playwright E2E

**기간**: 1주 (5-step variant 7번째 reproducibility 검증).

---

## 4. Lock-ins (canonical for ADR-170)

- **L-170-1** Single chokepoint SSOT (`ToolManager.normalizeDrawInput`)
- **L-170-2** 5-step routine canonical (cardinal / project / dedup /
  short-circuit / plane lock)
- **L-170-3** TypedReason envelope (silent skip 차단)
- **L-170-4** LOCKED #5/7/63/67/69 SSOT consume (새 SSOT 도입 0)
- **L-170-5** 7 Draw + SelectTool + BoundaryTool 통합 (9 tools)
- **L-170-6** Backward compat additive — getSnappedPoint/get3DPoint 보존
- **L-170-7** Engine 변경 0 (Phase 2 ADR-171 별도)
- **L-170-8** ADR-046 P31 #4 additive only
- **L-170-9** 메타-원칙 #14 WHAT + #16 WHEN layer 보존 강제
- **L-170-10** 절대 #[ignore] 금지

---

## 5. Phase target — β-3 user demo evidence

| Scenario | 영향 |
|---|---|
| S1 DrawLine × 평면 | Step 4 short-circuit (draw.rs:38 진입 전 회피) |
| **S2 DrawLine × 입체면** | **Step 2 face projection (PR #248 hotfix → SSOT 흡수)** |
| S3 DrawLine × 곡면 | Step 2 face projection partial (curved surface 영향 일부) |
| S4 RECT × 평면 | Step 4 short-circuit (draw.rs:74/79 회피) |
| S5 RECT × 입체면 | Step 1+2+5 (cardinal + projection + plane lock) |
| S7 CIRCLE × 평면 | Step 4 short-circuit (draw.rs:139 회피) |
| S8 CIRCLE × 입체면 | Step 1+2 (center face hit projection) |
| S10 Bezier × 평면 | Step 4 short-circuit (closure detection) |

**Phase 1 단독 cover**: 8/12 scenarios partial (β-3 finding 50% Phase 1
target). 75% cumulative with Phase 2.

---

## 6. Out of scope (Phase 2-4)

- Engine `absorb_boundary_input` — Phase 2 ADR-171
- DCEL `register_boundary_element` Edge Register — Phase 3 ADR-172
- 12 시연 게이트 PASS — Phase 4 ADR-173
- Curved surface 위 2D primitive (S6/S9/S12) — future ADR
- NURBS kernel `bail!` 변경 — L-169-11 carve-out

---

## 7. Cross-link

### LOCKED 정책 정합
- **LOCKED #5** spatial-hash 1.5μm — Step 3 (vertex_at dedup)
- **LOCKED #7** ADR-026 P12 cardinal — Step 1 (defense layer 1)
- **LOCKED #14** 메타-원칙 #14 (WHAT layer 보존)
- **LOCKED #15** P22.5 owner-ID — SelectTool migrate 정합
- **LOCKED #16** 메타-원칙 #16 (WHEN layer 보존, ADR-139 정합)
- **LOCKED #43** priority sequence ALL CLOSED (foundation)
- **LOCKED #44** Complete Meaning per Merge — 5-step variant 정합
- **LOCKED #63** z=0 invariant — Step 1 (cardinal force)
- **LOCKED #66** STATUS-POLICY — Status field canonical
- **LOCKED #67** ADR-166 plane lock — Step 5 (validation)
- **LOCKED #68** ADR-167 EPS_PLANE — Step 2 (detection)
- **LOCKED #69** ADR-168 PLANE_SNAP — Step 2 (correction)
- **LOCKED #70** ADR-169 Phase 1-4 anchor (사용자 결재 후 등재)

### ADR cross-link
- ADR-026 P12 cardinal SSOT (Step 1 source)
- ADR-046 P31 #4 additive only
- ADR-088 curve_owner_id (SelectTool migrate)
- ADR-101 Amendment 9 HARD flag (Phase 3 prep)
- ADR-139 Boundary tool only (BoundaryTool migrate 정합)
- ADR-140 surface-aware getDrawPlane (Step 2 face plane source)
- ADR-146 SnapManager inferencing (snap pipeline 보존)
- ADR-148 BoundaryTool point-localized (BoundaryTool migrate)
- ADR-152/164/166/167/168 5-step variant precursors
- ADR-166 plane lock (Step 5)
- ADR-167 EPS_PLANE SSOT (Step 2)
- ADR-168 face plane drift snap (Step 2 SSOT)
- ADR-169 Phase 0 audit (본 ADR 의 sole precondition)
- ADR-171/172/173 (Phase 2-4 sibling, separate)

### 메타-원칙
- #4 SSOT / #5 사용자 편의 / #6 Preventive / #11 Latency Budget
- #14 WHAT / #15 split contract / #16 WHEN

---

## 8. Acceptance Log (예고)

### 8.1 α (본 PR)
- spec only — 5-step routine canonical 명시
- Q1~Q5 lock-in default 5/5
- L-170-1 ~ L-170-10 Lock-ins
- 5-step roadmap (α/β-1/β-2/β-3/γ) — 7번째 reproducibility

### 8.2 β-1 (별도 PR)
- `normalizeDrawInput` API + 5-step routine 구현
- 회귀 자산 +20 (5-step × 4 corner case)

### 8.3 β-2 (별도 PR)
- 7 Draw 도구 migrate
- 회귀 자산 +15 (7 도구 × 정합)

### 8.4 β-3 (별도 PR)
- SelectTool + BoundaryTool migrate + ContextMenu 통합
- 회귀 자산 +5

### 8.5 γ (별도 PR)
- closure docs — Status Accepted + §9 Lessons + LOCKED entry candidate + README
- Playwright E2E (S1/S2/S4/S7 baseline + S3/S5/S8 gap evidence)
- 회귀 자산 +5

**합계 예상**: +50 회귀 (ADR-169 §6 +50 추정 부분 cover, refined β-3 cumulative).
