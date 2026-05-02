# ADR-040: AnalyticCurve Distance Hover (Precision-First)

**Status**: **Accepted** (2026-05-01) — LOCKED 정책 #18
**Initiative**: AxiA 3D Hover 정밀도 도약
**Builds on**: ADR-014 메타-원칙 #13 (One Source, Two Views), ADR-028
(분석적 곡선), ADR-037 (Pick→Promote selection), ADR-039 (Hover Pick→Promote)

## Context

ADR-039 P24 로 **hover 의 의미 단위** (EdgeId/FaceId) 가 잠긴 상태. 다만
hover 의 **정밀도** 는 여전히 polyline tessellation 에 의존:

```
[mousemove]
  → BVH raycast on tessellated edge segments  ← polyline (e.g., 64 sample for circle)
    → hit segment N
      → segMap[N] = EdgeId (P24 promotion)
        → setHoverTarget(EdgeId)
```

### 한계

분석적 곡선 (Circle / Arc / Bezier / NURBS) 의 hover 는:
- **Polyline 거리** 를 측정 (실제 곡선과 차이 있음)
- 64-sample circle → max chord error ≈ 1% of radius
- 사용자: 곡선 가까이 마우스를 올려도 polyline 사이 영역이라 hit 안 됨
- **Pick threshold 가 시각 인지보다 느슨하거나 빡빡함**

### AxiA 의 우위 — Phase D 의 산출물 활용

`Edge.curve = Some(AnalyticCurve)` 인 edge 는 **정확한 분석적 표현**
보유. CCI (Phase C) 의 거리 계산 로직 재활용 시 cursor ray 와 **곡선
자체** 의 정확한 거리 측정 가능.

## Decision

### P25 — 새 원칙: AnalyticCurve Distance Hover

> **`Edge.curve = Some(AnalyticCurve)` 인 edge 의 hover 거리는 polyline
> tessellation 이 아닌 곡선 자체에 대해 측정한다. Cursor screen-space ray
> 와 AnalyticCurve 의 closest-point distance 를 직접 evaluate.**

ADR-014 메타-원칙 #13 의 자연 연장 — Truth (analytic) 우선, View
(tessellation) 는 fallback.

### P25 세부 규칙 (6 항목)

**P25.1 — 정밀도 우선순위**

```
mousemove 의 cursor 좌표
  ↓
1. Edge.curve = Some(AnalyticCurve) → analytic distance evaluate
2. Edge.curve = None → polyline BVH raycast (기존)
3. 측정 실패 → null hover (기존)
```

**P25.2 — Curve 별 distance 함수**

| AnalyticCurve | Distance metric | 구현 |
|---|---|---|
| Line | Point-to-line segment 3D distance | Closed-form (cross product / projection) |
| Circle | Distance to circle (3D) — projection to plane + circular distance | Closed-form |
| Arc | Distance to arc — projection + parameter clamp | Closed-form |
| Bezier | Newton refinement on \|cursor_ray - C(t)\|² → 최소값 t* | Phase F Stage 3 의 newton 모듈 재활용 |
| BSpline | 동일 (Bezier 의 piecewise) | knot interval 별 Newton |
| NURBS | 동일 (rational Bezier basis) | 동일 |

**P25.3 — Threshold 의 화면 공간 일관성**

Pick threshold = `12px` (산업 CAD 표준) — **screen-space** 단위. 3D
거리는 distance × screen_pixel_per_world 로 변환:

```typescript
const screen_threshold_px = 12;
const world_threshold = screen_threshold_px / screen_to_world_scale(cursor_3d);
// world distance < world_threshold 면 hover hit
```

`screen_to_world_scale` 는 camera projection 에 의존 — perspective 시
distance 마다 다름. 본 ADR 은 cursor 위치 기준 단일 scale 사용 (single
ray-curve closest point 의 depth 에서 측정).

**P25.4 — Newton 발산 / 정확도 미달 fallback**

분석적 거리 evaluate 가 실패 (Newton 50 iter 미수렴 / NaN) 시:
- **즉시 fallback** to polyline BVH raycast (기존 path)
- Warning 누적 (debugLog only — 사용자 UI 영향 없음)

**P25.5 — Cache / 성능**

mousemove 가 60Hz 이상 → analytic distance 평가 비용 우려:
- **Per-frame cursor ray** 는 한 번만 — viewport 가 RAF 단위 caching
- AnalyticCurve 별 evaluate 는 O(degree) ~ O(degree²) — 무시 가능
- Edge 후보 선별: **BVH 로 polyline 가까운 edge** 만 후보, 그 edge 들에 대해 analytic 거리 정밀 측정 (2-stage)

**P25.6 — 회귀 테스트 (P25.7)**

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `analytic_circle_hover_perfect_radius_distance` | Cursor at radius+ε → hit; radius-ε → not hit (polyline gap 흡수) |
| 2 | `analytic_arc_hover_outside_arc_range_misses` | Arc [0, π/2] 의 [π, 2π] 영역 cursor → no hit (polyline 은 hit 가능했음) |
| 3 | `polyline_fallback_when_analytic_diverges` | Newton 발산 → polyline raycast 로 fallback |
| 4 | `screen_threshold_independent_of_camera_distance` | Camera 가 줌인/줌아웃 해도 12px threshold 일정 |

### P25.7 — Migration scope (이 ADR 결정 고정만)

본 ADR commit 은 **결정 고정**. 실제 코드 변경:

1. **Stage 1**: `axia-geo` 또는 `axia-wasm` 에 `edge_distance_to_ray(edge_id, ray_origin, ray_dir) -> f64` API 추가 (curve 별 closed-form)
2. **Stage 2**: WasmBridge wrapper + Viewport `pickEdgeAnalytic` 메서드
3. **Stage 3**: SelectTool / EraseTool 의 hover 가 BVH 결과 후 analytic 거리로 refine
4. **Stage 4**: 회귀 테스트 4개

각 stage 독립 commit, 회귀 0 가능.

## Implementation 후속 PR scope

### Stage 1 — Rust API
```rust
// crates/axia-geo/src/curves/distance.rs (신규)
pub fn ray_to_curve_distance(
    curve: &AnalyticCurve,
    ray_origin: DVec3,
    ray_dir: DVec3,
) -> Option<RayCurveResult> {
    // RayCurveResult { distance: f64, t_on_curve: f64, point_on_curve: DVec3 }
}
```

| Curve | Algorithm |
|---|---|
| Line | Cross product 3D — closed form |
| Circle | Project ray onto plane, project to circle → analytic |
| Arc | Same as circle + angle clamp |
| Bezier | Newton on \|R(s) - C(t)\|² (3D × 1D 변수, gradient + Hessian) |
| BSpline | knot interval 별 Bezier 변환 후 동일 Newton |
| NURBS | Rational Bezier 변환 |

### Stage 2 — TS bridge
```typescript
// WasmBridge
pickEdgeAnalytic(rayOrigin: Vec3, rayDir: Vec3, thresholdPx: number):
  { edgeId: number; pointOnCurve: Vec3; distance: number } | null
```

### Stage 3 — Tool integration
SelectTool / EraseTool 의 `computeHoverTarget` :
1. BVH raycast (기존) → 후보 edges (within 50px screen-space)
2. 각 후보 edge 에 대해 ray_to_curve_distance 호출
3. `min(distance) ≤ thresholdPx` 이면 그 EdgeId, 아니면 null

## Risks & Mitigations

- **R1** — Newton 발산: P25.4 의 polyline fallback 으로 차단
- **R2** — 60Hz mousemove 의 분석 비용: P25.5 의 2-stage (BVH 후보 + 분석) 로 ~100x 감소
- **R3** — Screen ↔ world scale 의 perspective 곡률: P25.3 의 cursor depth 기반 단일 scale (대부분 industry CAD 도 동일)
- **R4** — Closed-form distance 가 multi-modal (예: NURBS): Newton 의 다중 시작점 권장 (별도 phase, 본 ADR scope 외)

## Success Criteria

- ✅ ADR-040 P25 결정이 commit 으로 고정 (이 PR)
- ✅ CLAUDE.md LOCKED #18 추가
- ✅ **Stage 1 완료**: `crates/axia-geo/src/curves/distance.rs` —
  `ray_to_curve_distance()` API. Line / Circle / Arc closed-form +
  Bezier/BSpline/NURBS Gauss-Newton. 8 회귀 unit test 통과 (P25.7 #1, #2, #3).
- ✅ **Stage 2 완료**: WASM `edgeRayDistance` export
  (`Float64Array([d, px, py, pz, t])`) + TS `WasmBridge.edgeRayDistance`
  wrapper. 빈 array → null fallback (P25.4).
- ✅ **Stage 3 완료**: `Viewport.refineEdgeHoverWithAnalytic()` +
  `pixelToWorldAtDepth()` helper (12px screen-space 표준, P25.3).
  Pure helper `screen_threshold.ts` 추출.
- ✅ **Stage 4 완료**: P25.7 4 회귀 테스트 통과:
  * `analytic_circle_hover_perfect_radius_distance` (Rust)
  * `analytic_arc_hover_outside_arc_range_misses` (Rust)
  * `polyline_fallback_when_analytic_diverges` (Rust)
  * `screen_threshold_independent_of_camera_distance` (TS, 9 tests
    cover perspective + ortho + zoom + viewport size)
- ✅ 회귀 0: web 1320/1320, MCP 119/119, axia-geo unit tests 8/8.
- ⏳ 사용자 검증: SelectTool / EraseTool 의 hover 가 곡선 hover 시
  refineEdgeHoverWithAnalytic 호출 wiring (별도 ergonomic PR — engine
  은 ready, 호출 plumbing 남음).

## References

- ADR-014 메타-원칙 #13 (One Source, Two Views)
- ADR-028 (Analytic Edge Curve Foundation)
- ADR-030 (Phase C: NURBS curves + CCI — distance evaluation 인프라)
- ADR-037 P22 (Pick → Promote selection)
- ADR-039 P24 (Hover Pick → Promote)
- 산업 CAD 의 analytic hover (SolidWorks Hover Quick Filter, Fusion 360
  selection precision, Rhino "Curve" snap mode)

## 변경 이력

- **2026-05-01 (initial)**: P25 채택. 6 세부 규칙 + 4 회귀 테스트.
  Migration 4-stage 분할 (Rust API → TS bridge → Tool integration → tests).
  본 commit 은 결정 고정만. 실제 코드 변경은 후속 PR.
- **2026-05-02 (D1 implementation)**: Stage 1~4 4-PR 1 commit 으로 완성.
  - Stage 1: `crates/axia-geo/src/curves/distance.rs` (450 LOC) —
    Line/Circle/Arc closed-form, Bezier/BSpline/NURBS Gauss-Newton on
    perpendicular distance squared. 8 unit tests passing.
  - Stage 2: WASM `edgeRayDistance` + TS `WasmBridge.edgeRayDistance`.
  - Stage 3: `Viewport.refineEdgeHoverWithAnalytic` + pure helper
    `screen_threshold.ts` (`pixelToWorldPerspective` /
    `pixelToWorldOrthographic`).
  - Stage 4: 4 회귀 테스트 (Rust 3 + TS 9). 기존 회귀 0
    (web 1320/1320, MCP 119/119).
  - Tool integration plumbing (SelectTool / EraseTool 호출) 은 별도
    ergonomic PR — engine API 는 ready.
