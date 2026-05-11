# ADR-031: Analytic Surface Primitives (Phase D)

**Status**: **Accepted** (2026-04-29) — Phase D kickoff
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase D
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028, ADR-029, ADR-030
**Related**: ADR-007 (Face Orientation)

## Context

Phase A/B/C 로 1D analytic curve 완비 (Line/Circle/Arc/Bezier/B-spline/NURBS).
Phase D 는 2D analytic surface 기초 — 산업 표준 primitive surfaces:
Plane / Cylinder / Sphere / Cone / Torus.

### 현재 한계
- Cylinder primitive 가 N segment + 2N triangle 로 polygon mesh
- Sphere 가 ~360 triangle (20 latitude × 36 longitude)
- 메모리 / 정밀도 모두 낭비
- Push/Pull 결과의 측면이 N face

### Phase D 목표
- 각 primitive 가 **단일 analytic face** 로 표현
- Surface evaluation `(u, v) → DVec3` + normal + tessellation
- 기존 polygon mesh 와 공존 (`Face.surface = Option<AnalyticSurface>`)
- Push/Pull 결과가 cylinder 면 → 1 analytic side surface

## Decision

### P16 — 새 원칙

> **Face 는 boundary loop (DCEL) + 선택적 analytic surface 정의를 갖는다.**
> **Polygon mesh tessellation 은 surface 의 view-dependent cache 일 뿐,**
> **진실은 분석적 정의이다 (P13 의 surface 일반화).**

### P16 세부 규칙

**P16.1 — AnalyticSurface enum (Phase D scope)**
```rust
pub enum AnalyticSurface {
    Plane {
        origin: DVec3,
        normal: DVec3,
        basis_u: DVec3,            // basis_v = normal × basis_u
    },
    Cylinder {
        axis_origin: DVec3,
        axis_dir: DVec3,           // unit length
        radius: f64,
        ref_dir: DVec3,             // u=0 reference (perpendicular to axis)
        u_range: (f64, f64),        // angular [u0, u1] in radians
        v_range: (f64, f64),        // axial extent (mm)
    },
    Sphere {
        center: DVec3,
        radius: f64,
        u_range: (f64, f64),        // longitude [0, 2π]
        v_range: (f64, f64),        // latitude [-π/2, π/2]
    },
    Cone {
        apex: DVec3,
        axis_dir: DVec3,            // unit, away from apex
        half_angle: f64,            // [0, π/2)
        ref_dir: DVec3,             // u=0 reference
        u_range: (f64, f64),
        v_range: (f64, f64),        // distance from apex along axis
    },
    Torus {
        center: DVec3,
        axis_dir: DVec3,
        ref_dir: DVec3,             // major u=0
        major_radius: f64,
        minor_radius: f64,
        u_range: (f64, f64),
        v_range: (f64, f64),
    },
}
```

**P16.2 — SurfaceOps trait**
```rust
pub trait SurfaceOps {
    fn evaluate(&self, u: f64, v: f64) -> DVec3;
    fn normal(&self, u: f64, v: f64) -> DVec3;       // unit, outward
    fn derivative_u(&self, u: f64, v: f64) -> DVec3; // ∂P/∂u
    fn derivative_v(&self, u: f64, v: f64) -> DVec3; // ∂P/∂v
    fn parameter_range(&self) -> ((f64, f64), (f64, f64));
    fn tessellate(&self, chord_tol: f64) -> SurfaceTessellation;
}
pub struct SurfaceTessellation {
    pub vertices: Vec<DVec3>,
    pub triangles: Vec<[u32; 3]>,
    pub uv: Vec<[f64; 2]>,
}
```

**P16.3 — Face 확장**
```rust
pub struct Face {
    // ... existing fields ...
    surface: Option<AnalyticSurface>,
}
```
- `None` → 기존 polygon (default, 100% backward compat)
- `Some` → analytic surface, render 시 tessellate

**P16.4 — Right-handed UV convention**
- `derivative_u × derivative_v` 가 outward `normal` 과 같은 방향
- ADR-007 (Face Orientation) 호환 — winding 일관

**P16.5 — Tessellation 정책**
- Sagitta-based segment count (curve 와 동일)
- u, v 각각 independent 분할 → grid mesh
- u_range / v_range 의 길이 (parametric or arc length) 비례

**P16.6 — Backward Compatibility**
- 기존 polygon face 는 `surface = None` — 동작 무변동
- `Mesh::set_face_surface(fid, surface)` API 로 명시 attach
- Push/Pull / Boolean 등 기존 op 는 tessellation 결과로 작동 (Phase F 까지)

**P16.7 — Validation**
- Cylinder / Cone: `axis_dir.length() > 1e-9`, `ref_dir ⊥ axis_dir`
- Sphere: radius > 0
- Torus: minor_radius < major_radius, > 0
- Range: u_range / v_range 둘 다 양의 길이

## Implementation Plan

### Module structure
```
crates/axia-geo/src/surfaces/
  mod.rs          — AnalyticSurface enum + SurfaceOps trait + SurfaceTessellation
  plane.rs        — Plane primitive
  cylinder.rs     — Cylinder primitive
  sphere.rs       — Sphere primitive
  cone.rs         — Cone primitive
  torus.rs        — Torus primitive
```

### Tests (절대 #[ignore] 금지)

**Per-primitive (10 each, 50 total)**:
- evaluate at corners (parameter range endpoints)
- normal direction outward
- derivative magnitude consistency
- tessellation chord error within tolerance
- LOD scales with chord_tol
- offset / rotation invariance
- degenerate input rejection

**Integration (15+)**:
- mesh_set_face_surface_then_tessellate
- face_surface_serialize_roundtrip
- face_with_surface_unchanged_polygon_topology
- regression: existing polygon faces unaffected

**WASM bridge (8+)**:
- setFaceSurfacePlane / Cylinder / Sphere / Cone / Torus
- tessellateFace returns vertices + triangles
- faceSurfaceKind returns variant index

## Constraints (Locked)

이 Phase 는 다음을 **준수해야 함**:
- ✅ ADR-007 Invariants — face normal/winding 무손상
- ✅ ADR-021/025 — closed loop = face 그대로 적용
- ✅ ADR-026 P12 — Cardinal SSOT (surface origin / center 도 snap)
- ✅ Phase A/B/C curve 회귀 0건
- ✅ LOCKED #5 — exact input

## Success Criteria (Gate 2.5)

- ✅ Phase A/B/C 회귀 0건
- ✅ Phase D 신규 테스트 80+ 통과
- ✅ Cylinder evaluation radius invariant 1e-9 mm
- ✅ Sphere normal magnitude == 1.0 (1e-12)
- ✅ WASM 번들 증가 < 200 KB

## References

- Piegl & Tiller, *The NURBS Book*, Chapter 4 (Geometric primitives as NURBS surfaces)
- Sederberg, *CAGD lecture notes*, Chapter 8 (Surfaces)
- ISO 10303-42 STEP geometric_representation_item types
