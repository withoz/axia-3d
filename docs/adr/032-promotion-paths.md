# ADR-032: Promotion Paths for Analytic Curves & Surfaces (Phase D')

**Status**: **Accepted** (2026-04-29) — Phase D 후속 단기 작업
**Builds on**: ADR-028, ADR-029, ADR-030, ADR-031
**Related**: 메타-원칙 #5 (명확하면 자동, 모호하면 명시 동의), LOCKED #5 (exact input)

## Context

Phase A~D 로 AnalyticCurve / AnalyticSurface 인프라가 완성됐지만 **승격 경로**
가 일부에만 적용됨:
- ✅ DrawCircle (Phase A Week 11-12)
- ⚠ DrawArc / DrawBezier / DrawSpline — TS 도구가 polyline 만 생성
- ⚠ DXF Import — ARC/CIRCLE/SPLINE 가 polyline tessellate 만
- ⚠ Cylinder / Sphere / Cone primitives — mesh 만, surface metadata 없음

이로 인해 사용자가 "원" 을 그렸어도 import 후엔 N-각형으로 인식되거나,
cylinder primitive 의 side face 에 analytic surface 가 attach 되지 않음.

## Decision

### P17 — 새 원칙 (승격 정책)

> **Polyline → AnalyticCurve, Polygon → AnalyticSurface 승격은 다음 조건에서**
> **만 자동 수행:**
> 1. **사용자 의도 명시** — DrawCircle/Arc/Bezier/NURBS 도구 사용 시
> 2. **Import 데이터에 분석적 정의 존재** — DXF ARC/CIRCLE/SPLINE/ELLIPSE 등
> 3. **연산 결과가 결정적 분석 형태** — primitive 생성, push/pull on circle
>
> **자동 기하 추론 (RANSAC fitting / 등) 은 사용자 명시 명령** 에서만 수행.
> 거짓 양성 차단을 위해 자동 추론 금지.

### P17.1 — 보존 원칙
- 승격은 항상 **information preservation** — polyline DCEL 토폴로지 유지
- 분석적 정의는 metadata 로 attach (ADR-028 P13, ADR-031 P16 일관)
- View-time tessellation 은 cache, 진실은 분석적 정의

### P17.2 — Phase D' 즉시 구현 범위 (이 ADR)

#### 1) Primitive Surface Auto-Attach
- `Mesh::create_cylinder` 결과의 side face → `AnalyticSurface::Cylinder`
- `Mesh::create_sphere` 결과의 모든 side face → `AnalyticSurface::Sphere`
- `Mesh::create_cone` 결과의 side face → `AnalyticSurface::Cone`
- top/bottom (cap) face 는 `AnalyticSurface::Plane` (선택적)

#### 2) DrawArcTool TS 승격
- `bridge.drawPolyline(flatPts)` 호출 후 → 결과 edge ID 들 조회 (XIA 통해)
- 각 edge 에 `setEdgeArcCurve` 호출, sub-angle range 자동 분할

#### 3) DrawBezierTool / DrawSplineTool TS 승격
- 동일 패턴 — `setEdgeBezierCurve` 또는 `setEdgeBSplineCurve` 호출

#### 4) DXF Import 승격
- Parser 가 ARC / CIRCLE / SPLINE / ELLIPSE entity 만나면:
  - polyline tessellation 생성 (기존)
  - 각 edge 에 분석적 curve attach
- 사용자가 import → export STEP 했을 때 정보 보존

### P17.3 — 향후 단계 (별도 ADR)
- Phase E: Push/Pull / Fillet 결과 surface auto-attach
- Phase G: STEP/IGES import 의 NURBS 직접 사용
- 별도: 사용자 명시 "convert to arc/circle/spline" 명령 (RANSAC fitting)

### P17.4 — Phase D' 구현 결과 (2026-04-29 종료)

#### ✅ 완료
1. **Primitive surface auto-attach** — create_cylinder/sphere/cone 결과 face
   에 AnalyticSurface 자동 attach (cylinder 16 segments cap/side, sphere
   poles+rings, cone frustum→full cone parameters)
2. **drawArcWithCurve atomic API** — Rust 측 단일 트랜잭션 + DrawArcTool
   migration
3. **drawBezierWithCurve atomic API** — DrawBezierTool migration
4. **drawBSplineWithCurve atomic API** — bridge wrapper (UI 도구는 follow-up)

#### ⏭ 적용 불가 (현 codebase 에 entry point 없음)
- **DrawSplineTool**: 별도 도구 미존재. DrawFreehandTool 은 Catmull-Rom
  사용 — NURBS 변환 필요 (별도 phase: Catmull→B-spline conversion).
- **DXF Import 승격**: DxfSceneBuilder 는 Three.js display 전용 (overlay
  geometry), 엔진 mesh 로 import 하는 path 가 현재 codebase 에 없음.
  사용자가 import 후 수동 trace — 별도 "DXF→Mesh import" 기능이 추가될 때
  본 ADR 의 promotion 패턴 적용 가능.

## Implementation

### Rust 측 (axia-geo 의 primitives.rs)

기존:
```rust
pub fn create_cylinder(&mut self, ...) -> Result<Vec<FaceId>> {
    // mesh 만 생성
}
```

신규:
```rust
pub fn create_cylinder(&mut self, ...) -> Result<CreateCylinderResult> {
    // mesh 생성
    // side faces 에 AnalyticSurface::Cylinder attach
    // top/bottom 에 Plane attach (optional)
}
pub struct CreateCylinderResult {
    pub all_faces: Vec<FaceId>,
    pub side_faces: Vec<FaceId>,
    pub cap_faces: Vec<FaceId>,
}
```

기존 API 는 유지 (backward compat) — 새 API 는 별도 함수.

### TS 측 (DrawArcTool 등)

기존:
```typescript
const xiaId = bridge.drawPolyline(flat);
```

신규:
```typescript
const xiaId = bridge.drawPolyline(flat);
// Promote: get edges + attach analytic curve
const faceIds = bridge.getXiaFaceIds(xiaId);
const edges = collectFaceBoundaryEdges(faceIds);
edges.forEach((eid, i) => {
    const arcParams = computeSubArc(this.startAngle, this.endAngle, edges.length, i);
    bridge.setEdgeArcCurve(eid, ...arcParams);
});
```

### DXF Import (DxfImportHandler.ts)

각 ARC/CIRCLE/SPLINE entity 처리 시:
1. 기존 tessellation 으로 polyline 생성
2. drawPolyline → XIA 생성
3. 결과 edges 에 적절한 setEdge*Curve 호출

## Tests (절대 #[ignore] 금지)

### Rust (primitives 자동 attach)
- `create_cylinder_attaches_cylindrical_surface_to_sides`
- `create_sphere_attaches_spherical_surface`
- `create_cone_attaches_conical_surface`
- `cylinder_caps_have_plane_surface_or_none`
- `primitive_surface_radius_matches_input`

### TS (도구 승격)
- DrawArcTool 의 결과 edges 가 Arc curve 보유 (mock bridge)
- DrawBezierTool 결과 edges 가 Bezier curve 보유
- DrawSplineTool 결과 edges 가 BSpline curve 보유

### DXF (import 승격)
- DXF ARC entity import → analytic Arc 보존
- DXF CIRCLE entity import → analytic Circle (or 24-Arc segments)
- DXF SPLINE entity import → analytic NURBS

## Risks

- **Primitive cylindrical 정렬 오류**: side face 의 axis_dir / ref_dir 이 mesh
  topology 와 일치해야 — 회귀 테스트로 검증
- **TS 도구의 edge ID 추적**: drawPolyline 결과로부터 edge 순서 추론 — XIA
  의 face_ids → outer loop edges 로 매핑 필요
- **DXF 호환성**: 기존 import 결과와 동일한 visual — surface 가 추가 metadata

## Success Criteria

- ✅ 기존 회귀 0건
- ✅ Primitive 회귀 테스트 5+ 통과 (radius 정확, surface kind 일치)
- ✅ TS 도구 회귀 테스트 3+ 통과
- ✅ DXF 회귀 테스트 3+ 통과
