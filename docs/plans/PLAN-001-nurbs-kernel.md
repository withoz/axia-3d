# PLAN-001: AXiA 자체 NURBS 커널 작성 계획서

**Status**: Active (2026-04-29 → updated 2026-04-30)
**Target**: 자체 분석적 곡선/곡면 커널 (옵션 A — `truck`/OCCT 의존 없음 +
Phase G STEP/IGES Hybrid via ADR-035: OCCT.js 옵션 + axia-foreign 자체 spike)
**Owner**: TBD
**ADR Linkage**: ADR-027 (kickoff) → ADR-028~034 (Phases A~F 완료) →
ADR-035 (Phase G STEP/IGES Hybrid Strategy) → ADR-036 (Curve/Surface
Promotion architectural)

## Phase 진행 상황 (2026-04-30)

| Phase | 기간 | 상태 | ADR | 산출물 |
|---|---|---|---|---|
| **A** Analytic Edge Curve | Months 1-3 | ✅ **완료** | ADR-028 | Line/Circle/Arc + CurveOps trait (59 tests) |
| **B** Free-form Curves | Months 4-6 | ✅ **완료** | ADR-029 | Bezier (de Casteljau) + B-spline (de Boor) (43 tests) |
| **C** NURBS Curves + CCI | Months 7-9 | ✅ **완료** | ADR-030 | NURBS curves + Curve-Curve Intersection (67 tests) |
| **D** Analytic Surface Primitives | Months 10-15 | ✅ **완료** | ADR-031 | Plane/Cylinder/Sphere/Cone/Torus (78 tests) |
| **D'** Promotion Paths | — | ✅ **완료** | ADR-032 | DrawArc/Bezier 마이그레이션 + atomic API (10 tests) |
| **E** NURBS Surfaces | Months 16-21 | ✅ **완료** | ADR-033 | BezierPatch / BSplineSurface / NURBSSurface + TrimLoop (45 tests) |
| **F** Surface-Surface Intersection | Months 22-30 | ✅ **완료** | ADR-034 | Stage 1 analytic (5 pairs) + Stage 2 subdivide + Stage 3 Newton + Stage 4 topology (46 tests) |
| **G1** NURBS surface SSI wrapper | — | ✅ **완료** | — | `bspline::extract_bezier_strips` + `bspline_surface::extract_bezier_patches` + `intersect_bspline_pair` (6 tests) |
| **G2** SSI → TrimCurve2D 변환 | — | ✅ **완료** | — | `ssi::trim_gen` 모듈 (4 tests) |
| **G3** NURBS Boolean primitives | — | ✅ **완료 (MVP)** | — | `ssi::boolean::nurbs_boolean(op)` Union/Subtract/Intersect (3 tests) |
| **G4-A** STEP/IGES via OCCT.js | Months 31-32 | 🔄 **진행 중 (scaffolding)** | ADR-035, ADR-036 | StepIgesImporter + occtCurvePromote/SurfacePromote 스텁 + occtAccessors 헬퍼 (41 tests) |
| **G4-B** axia-foreign 자체 파서 | Months 31-39 (병행) | ⏳ **대기 (착수 예정)** | ADR-035 P20.2 | STEP AP203 + IGES 5.3 lexer/parser/promote |
| **G4-decision** Default 결정 | Months 36-43 | ⏳ **+12개월 후** | ADR-035 P20.E | 5-트리거 정량 매트릭스 |

총 회귀 테스트 누적: **Rust 751 + TS 1235 = 1986 passed, 0 회귀**.

**Phase G 커버리지**: Phases A~E (NURBS 인프라) ✅, Phase F (SSI) ✅,
Phase G1~G3 (NURBS 통합) ✅, Phase G4 (STEP/IGES 외부 연결) 🔄 진행 중.
초기 번들 영향 0 MB 보장 (P20.C #2) — opencascade.js 설치 시에만 chunk 생성.


**Related**: ADR-007 (Face Orientation), ADR-019 (Line is Truth), ADR-021 (Closed loop divides face), ADR-025 (P11), ADR-026 (Cardinal SSOT)

---

## 0. Executive Summary

AXiA 3D 의 현재 DCEL polygon 엔진을 기반으로, **분석적 곡선 (Analytic Curve)
→ 분석적 곡면 (Analytic Surface) → NURBS B-rep** 으로 점진 진화하는
**자체 커널** 을 작성한다. 외부 의존 (truck / OCCT) 없이 Rust 로 직접 구현.

**예상 기간**: 24~36 개월 (1인 fulltime 가정), 산업 robustness 까지 60+ 개월
**예상 LOC**: 60,000 ~ 80,000 (Rust)
**핵심 위험**: SSI / Boolean 의 수치 robustness — 학술 박사급 주제

**점진 진화 원칙**:
- 각 Phase 끝에 사용자에게 가시적 가치 제공 (waterfall 아닌 incremental)
- 기존 LOCKED 정책 / ADR invariants 모두 보존하면서 확장
- 어느 Phase 에서 멈춰도 **그 시점까지의 결과물은 자급자족 가능**

---

## 1. 비전 (Vision)

### 1.1 최종 모습 (5+ 년 후)

```
[B-rep Topology (DCEL 확장)]
    Vertex ─ Edge ─ Loop ─ Face ─ Shell ─ Solid
              │         │
              │         └─ surface: AnalyticSurface
              │              ├── Plane / Cylinder / Sphere / Cone / Torus
              │              ├── Bezier / B-spline patch
              │              └── Trimmed NURBS surface
              │
              └─ curve: AnalyticCurve
                   ├── Line / Circle / Arc / Ellipse
                   ├── Bezier / B-spline curve
                   └── Trimmed NURBS curve
```

### 1.2 사용자 경험 변화

| 시나리오 | 현재 (polygon) | 목표 (NURBS) |
|---|---|---|
| 원 그리기 | 24-각형 mesh | 진짜 원 (zoom-in 시 부드러움) |
| Cylinder Push/Pull | side face N개 | side face 1개 (analytic) |
| Fillet | flat chamfer | tangent NURBS patch |
| STEP import | 미지원 | 정확한 변환 |
| Cross-section | 직선 polyline | 진짜 곡선 |
| 면 합성 | 5° 미만만 | NURBS 곡면 합성 |

### 1.3 비-목표 (Non-Goals)

이 계획서는 다음을 **포함하지 않음**:
- Subdivision surfaces (Catmull-Clark) — 별도 영역
- T-Splines — Autodesk 특허 영역
- Mesh-to-NURBS 자동 변환 — 매우 어려움, 별도 phase
- 산업 동급 robustness (10년+ 작업 필요)
- Real-time collaborative editing — 별도 영역

---

## 2. 범위 (Scope)

### 2.1 In Scope (자체 작성)

#### 2.1.1 곡선 (1D)
- ✅ Line, Circle, Arc, Ellipse (analytic 정확)
- ✅ Bezier curve (n-degree, control points)
- ✅ B-spline (knot vector, basis functions, de Boor algorithm)
- ✅ NURBS curve (rational B-spline)
- ✅ Curve evaluation, derivative, parametric→3D
- ✅ Curve-curve intersection (CCI) — Newton-Raphson + subdivision
- ✅ Tangent / curvature / arc length

#### 2.1.2 곡면 (2D)
- ✅ Plane, Cylinder, Sphere, Cone, Torus (analytic primitives)
- ✅ Bezier patch (bicubic, bilinear)
- ✅ NURBS surface (knot vectors u/v, weighted control net)
- ✅ Trimmed NURBS (외부/내부 trim curves)
- ✅ Surface evaluation, normal, principal curvatures
- ⚠ Surface-surface intersection (SSI) — Phase F+ 박사급 주제

#### 2.1.3 위상 (B-rep)
- ✅ DCEL 확장: Edge.curve / Face.surface optional 분석적 reference
- ✅ Shell (closed face set)
- ✅ Solid (closed shell)
- ✅ Tolerance management (geometry-topology 일관성)

#### 2.1.4 연산
- ✅ Polyline tessellation (LOD, view-dependent)
- ✅ Coplanar surface merge (analytic)
- ✅ Curve-based fillet (tangent arc)
- ✅ Loft / Sweep / Revolve (curve → surface)
- 🟡 Boolean on analytic primitives (Phase E)
- 🔴 Boolean on general NURBS (Phase F — 학술적 한계)

#### 2.1.5 직렬화
- ✅ AXIA native format 확장 (NURBS 데이터)
- 🟡 STEP / IGES export (Phase F)
- 🔴 STEP / IGES import (Phase G — 매우 어려움)

### 2.2 Out of Scope (이 계획서)

- T-splines (특허)
- Subdivision surfaces
- Mesh-to-NURBS 변환
- Reverse engineering (point cloud → surface)
- GD&T (Geometric Dimensioning & Tolerancing)
- PMI (Product Manufacturing Information)
- CAM / toolpath 생성

---

## 3. 아키텍처 결정 (Architecture)

### 3.1 핵심 원칙

#### A1. **점진 진화** (메타-원칙 #1 호환)
- 기존 명령은 모두 그대로 유지
- 새 NURBS 기능은 **opt-in** (사용자 명시 활성화 또는 도구 선택)
- 각 Phase 끝에 새 기능 + 회귀 0건

#### A2. **Single Source of Truth** (메타-원칙 #4)
- Edge / Face 의 분석적 정의가 **1차 진실 (truth)**
- DCEL polyline / mesh 는 **derivative cache** (재계산 가능)
- 직렬화는 분석적 정의만 저장 (mesh 는 load 시 재계산)

#### A3. **Topology > Cache** (메타-원칙 #7)
- 분석적 곡면도 DCEL 위상에 attach (LoopRef, HE 그대로)
- 곡면 변경 시 cache 즉시 invalidate, 재 tessellate

#### A4. **One Source, Two Views** (메타-원칙 #13)
- Rust = analytic truth (NURBS 정의)
- WebGL = view (LOD-tessellated mesh)
- TS / WASM 경계: analytic data 만 전송, mesh 는 GPU buffer

### 3.2 Rust 측 데이터 모델

```rust
// crates/axia-geo/src/curves/mod.rs (NEW)
pub enum AnalyticCurve {
    Line     { start: VertId, end: VertId },
    Circle   { center: DVec3, radius: f64, normal: DVec3, basis_u: DVec3 },
    Arc      { center: DVec3, radius: f64, normal: DVec3, basis_u: DVec3,
               start_angle: f64, end_angle: f64 },
    Ellipse  { center: DVec3, axes: (DVec3, DVec3), normal: DVec3 },
    Bezier   { control_pts: Vec<DVec3>, degree: u32 },
    BSpline  { control_pts: Vec<DVec3>, knots: Vec<f64>, degree: u32 },
    NURBS    { control_pts: Vec<DVec3>, weights: Vec<f64>,
               knots: Vec<f64>, degree: u32 },
}

// crates/axia-geo/src/surfaces/mod.rs (NEW)
pub enum AnalyticSurface {
    Plane    { origin: DVec3, normal: DVec3, basis_u: DVec3 },
    Cylinder { axis_origin: DVec3, axis_dir: DVec3, radius: f64,
               u_range: (f64, f64), v_range: (f64, f64) },
    Sphere   { center: DVec3, radius: f64,
               u_range: (f64, f64), v_range: (f64, f64) },
    Cone     { apex: DVec3, axis_dir: DVec3, half_angle: f64,
               u_range: (f64, f64), v_range: (f64, f64) },
    Torus    { center: DVec3, axis_dir: DVec3, major_r: f64, minor_r: f64,
               u_range: (f64, f64), v_range: (f64, f64) },
    BezierPatch { ctrl_grid: Vec<Vec<DVec3>>, deg_u: u32, deg_v: u32 },
    NURBS    { ctrl_grid: Vec<Vec<DVec3>>, weights: Vec<Vec<f64>>,
               knots_u: Vec<f64>, knots_v: Vec<f64>,
               deg_u: u32, deg_v: u32,
               trim_loops: Vec<TrimLoop>,  // 2D parameter-space trim curves
    },
}

// 기존 Edge / Face 확장
pub struct Edge {
    // ... existing fields ...
    pub curve: Option<AnalyticCurve>,   // None = polyline straight line
}

pub struct Face {
    // ... existing fields ...
    pub surface: Option<AnalyticSurface>, // None = planar polygon
}
```

### 3.3 Tessellation 전략

```
Analytic curve / surface
    ↓ tessellate(tolerance)  [view-dependent LOD]
Polyline / Mesh (현재 DCEL)
    ↓ render
WebGL buffer
```

- **Edge tessellation**: chord error tolerance (sagitta-based)
- **Face tessellation**: parametric grid + trim curve clipping
- **LOD**: zoom level 별 tolerance 조정 (캐시)

### 3.4 호환성 전략

- 기존 polygon-only mesh 는 100% 동작 유지
- 새 NURBS edge 는 **fallback tessellation** 으로 polygon 시스템과 공존
- Boolean / Push-Pull 등 기존 op 는 NURBS edge 만나면 자동 tessellate (Phase F 이전)

---

## 4. Phase 분할 (Roadmap)

### Phase A (Months 1-3) — Foundation: Analytic Edge Curve
**목표**: Edge 가 분석적 곡선 정보 보유. Line/Arc/Circle 정확 표현.

**산출물**:
- `crates/axia-geo/src/curves/{line, arc, circle}.rs` — primitives
- `Edge.curve: Option<AnalyticCurve>` 필드 추가
- Curve evaluation: `curve.evaluate(t)` → DVec3
- Derivative: `curve.derivative(t)` → DVec3
- Tessellation: `curve.tessellate(chord_tol)` → Vec<DVec3>
- Web 측: 기존 `Curve.ts` Layer 가 Rust API 호출
- DrawCircle / DrawArc 가 분석적 edge 생성

**ADR**: ADR-028 (Analytic Edge Foundation)

**Success Criteria**:
- 24-segment 원 그리기 → 내부적으로 analytic Circle, render 시 LOD-tessellated
- Zoom-in 시 부드러운 곡선 (segment 수 자동 증가)
- 회귀 0건 (기존 DCEL invariants 유지)
- Tests: 30+ 신규 (curve eval, tessellation, edge cases)

---

### Phase B (Months 4-6) — Bezier / B-spline Curves
**목표**: Free-form 곡선 지원. 사용자 ControlPoints 그리기 도구.

**산출물**:
- `bezier.rs` — n-degree Bezier (de Casteljau)
- `bspline.rs` — B-spline (de Boor, knot insertion)
- Control point editing UI (drag handles)
- Curve fitting (4-point Bezier 보간)
- AXIA serialization 확장 (curve data)

**ADR**: ADR-029 (Free-form Curves)

**Success Criteria**:
- DrawBezier / DrawSpline 도구 사용 가능
- Control points drag 시 실시간 곡선 update
- Tessellation 정확도 chord error < 1e-3 mm
- Tests: 50+

---

### Phase C (Months 7-9) — NURBS Curves + CCI
**목표**: 산업 표준 NURBS curve. Curve-curve intersection.

**산출물**:
- `nurbs.rs` — rational B-spline, weights, derivatives
- `intersect/curve_curve.rs` — Newton-Raphson + Bezier subdivision
- Knot insertion / refinement
- Curve degree elevation
- 회전 / 변환 (rational arithmetic)

**ADR**: ADR-030 (NURBS Curves)

**Success Criteria**:
- Conic sections (circle, ellipse) 의 NURBS 표현 검증
- CCI 정확도: 1e-6 mm 이내 (~ machine epsilon × bbox)
- Tests: 70+
- 회귀 0건

---

### Phase D (Months 10-15) — Analytic Surface Primitives
**목표**: Plane / Cylinder / Sphere / Cone / Torus 분석적 곡면.

**산출물**:
- `crates/axia-geo/src/surfaces/{plane, cylinder, sphere, cone, torus}.rs`
- `Face.surface: Option<AnalyticSurface>` 필드
- Push/Pull on cylinder → analytic side surface (segment 1개)
- Surface evaluation `(u, v) → DVec3`
- Surface normal, principal curvatures
- Tessellation: parametric grid + trim
- Curve-on-surface (geodesic-like, parametric)

**ADR**: ADR-031 (Analytic Surface Primitives)

**Success Criteria**:
- Cylinder push/pull → 1 analytic face (mesh tessellation 자동)
- Sphere primitive → 1 face (현재는 360+ triangle)
- 회귀 0건
- 메모리 효율 ~50× 개선 (간단 cylinder 기준)
- Tests: 80+

---

### Phase E (Months 16-21) — Bezier / NURBS Surfaces
**목표**: Free-form NURBS surface. Trimmed NURBS.

**산출물**:
- `nurbs_surface.rs` — bicubic Bezier patch, B-spline surface, NURBS
- `trim.rs` — 2D parameter-space trim curves
- Loft / Sweep / Revolve 도구 (curve → surface)
- Surface fitting (control net 보간)

**ADR**: ADR-032 (NURBS Surfaces)

**Success Criteria**:
- Loft 도구로 2 곡선 사이 surface 생성
- Revolve 도구로 axis-revolve surface
- Trim curves 정확 적용
- Tests: 100+
- 회귀 0건

---

### Phase F (Months 22-30) — Surface-Surface Intersection (SSI)
**목표**: 가장 어려운 단계. 두 NURBS 곡면 교차곡선 robust 계산.

**산출물**:
- `intersect/surface_surface.rs`:
  - Lattice / marching method (initial)
  - Newton refinement
  - Topological loop detection
  - Singular point handling
- Boolean on analytic primitives (cylinder ∪ sphere 등)
- Robust tolerance handling

**ADR**: ADR-033 (Surface-Surface Intersection)

**Success Criteria**:
- 2 cylinder 교차 → 정확한 SSI curve
- Boolean (analytic primitives 한정) 검증
- 회귀 0건 (기존 polygon Boolean 보존)
- Tests: 150+

**위험**: 박사급 수치 robustness 주제. 일부 corner case 미해결 가능 (TBD).

---

### Phase G (Months 31-36) — Boolean on NURBS, STEP/IGES
**목표**: NURBS-NURBS Boolean. STEP/IGES export.

**산출물**:
- `boolean/nurbs.rs`:
  - SSI 결과 곡선으로 trim 적용
  - 결과 surface set 의 topology 재구성
- STEP AP203/AP214 export (NURBS data 직렬화)
- IGES 5.3 export
- 단순 case 만 (산업 robustness 미달 인지)

**ADR**: ADR-034 (NURBS Boolean), ADR-035 (Standard CAD I/O)

**Success Criteria**:
- 단순 NURBS Boolean (cube ∪ cylinder 등) 정확
- STEP export 가 SolidWorks/Fusion 에서 정상 import
- Tests: 120+
- Robustness: 80% case 통과 (Phase H+ 에서 개선)

---

### Post-Phase G (36+ Months) — Robustness & Special Operations
- Complex Boolean robustness 강화
- Fillet (true tangent NURBS surface)
- Variable radius fillet
- Lofted Boolean
- STEP/IGES import (역구문 분석)
- Performance optimization (caching, parallelism)
- 산업 동급은 5~10년 추가 — 전담 인력 확장 필요

---

## 5. 기술 스택

### 5.1 핵심 라이브러리 (Rust)
- `glam` (DVec3, DMat3) — 이미 사용 중
- `nalgebra` — 큰 matrix, 선형대수 (NURBS knot solver)
- `ordered-float` — knot vector ordering
- `rstar` — R-tree (curve/surface spatial index)
- `arrayvec` / `smallvec` — control point vector 최적화

### 5.2 알고리즘 참조
- Piegl & Tiller, *The NURBS Book* (Springer 1997) — primary reference
- Patrikalakis & Maekawa, *Shape Interrogation for Computer Aided Design and Manufacturing* (Springer 2002)
- Sederberg, *Computer Aided Geometric Design* (BYU lecture notes, free)
- Farin, *Curves and Surfaces for CAGD* (Morgan Kaufmann 2002)

### 5.3 검증 데이터
- NIST CAD interoperability test cases
- ISO 10303 STEP test models
- 자체 회귀 suite (각 Phase 별 100+ test)

---

## 6. 위험 분석 (Risk Assessment)

### 6.1 기술적 위험

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| R1 | SSI 수치 robustness (Phase F) | 🔴 매우 높음 | Marching method + Newton + interval arithmetic 다단계 |
| R2 | Boolean 의 corner case (Phase G) | 🔴 매우 높음 | 분석적 primitive 만 우선 → NURBS general 별도 |
| R3 | Tolerance 일관성 (geometry vs topology) | 🟡 중간 | ADR-007 invariants 의 NURBS 확장 정의 |
| R4 | Tessellation chord error 누적 | 🟡 중간 | View-dependent LOD + cache invalidation |
| R5 | NURBS surface trim 의 self-intersect | 🟡 중간 | 2D parameter space self-int test |

### 6.2 일정 위험

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| S1 | Phase F (SSI) 가 1년+ 지연 | 🔴 높음 | Phase E 에서 truck/OCCT 통합 옵션 재평가 |
| S2 | 1인 fulltime 가정 깨짐 | 🟡 중간 | Phase A/B/C 만으로도 큰 가치 (멈춰도 OK) |
| S3 | 학습 곡선 (Piegl & Tiller 등 학습) | 🟡 중간 | 첫 2개월 학습 + prototype |

### 6.3 정책 위험

| # | 위험 | 완화 |
|---|---|---|
| P1 | 기존 LOCKED 정책 위반 | 각 Phase ADR 작성 시 호환성 명시 |
| P2 | DCEL invariants 깨짐 | 회귀 테스트 + verify_face_invariants 확장 |
| P3 | WASM 번들 크기 증가 | Phase 별 측정, 1MB 초과 시 dynamic import |

---

## 7. 메트릭 및 성공 기준

### 7.1 품질 메트릭 (Phase 별 측정)

| 메트릭 | Phase A | Phase D | Phase G |
|---|---|---|---|
| 회귀 테스트 통과 | 100% | 100% | 100% |
| 신규 테스트 | 30+ | 200+ | 500+ |
| Curve evaluation 정확도 | 1e-6 mm | 1e-7 mm | 1e-8 mm |
| Tessellation chord error | 1e-3 mm | 1e-4 mm | 1e-5 mm |
| WASM 번들 증가 | < 100 KB | < 500 KB | < 2 MB |
| Tessellation perf | 60 FPS | 60 FPS | 30+ FPS |

### 7.2 사용자 가치 마일스톤

- **Month 3 (Phase A)**: 진짜 원 / 호 — zoom 시 부드러움
- **Month 6 (Phase B)**: Bezier 곡선 도구 — 자유 그리기
- **Month 9 (Phase C)**: NURBS 정확 표현 — STEP-like 데이터 import 준비
- **Month 15 (Phase D)**: Cylinder push/pull — 1 face (현재 N face)
- **Month 21 (Phase E)**: Loft / Sweep — 곡면 모델링
- **Month 30 (Phase F)**: SSI 기반 곡면 합성
- **Month 36 (Phase G)**: STEP export — 산업 호환

### 7.3 기술 부채 관리

- 각 Phase 종료 시 **ADR 작성** (LOCKED 정책 추가/변경 명시)
- 각 Phase 종료 시 **회귀 테스트 추가** (절대 #[ignore] 금지)
- Refactoring debt: Phase F 전 **Phase A~E 통합 review** (1개월 기간)

---

## 8. 의사결정 게이트 (Decision Gates)

각 Phase 종료 시 다음을 결정:

### Gate 1 (after Phase A, Month 3)
- Q: Phase B 진행 vs `truck` 통합?
- 기준: Phase A 가 60% 시간 안에 완료 → 자체 진행 유리

### Gate 2 (after Phase C, Month 9)
- Q: Phase D (surface) 자체 vs NURBS curve only 로 멈춤?
- 기준: Curve only 도 사용자 가치 큼 → 멈춰도 OK

### Gate 3 (after Phase E, Month 21)
- Q: Phase F (SSI) 자체 vs OCCT/truck 통합?
- 기준: SSI 가 박사급 주제 — 1인 6 개월에 완료 가능성 50%
- 통합 옵션: AXiA 의 polygon op 보존 + truck 의 NURBS 연산

### Gate 4 (after Phase G, Month 36)
- Q: 산업 robustness 까지 추가 투자 vs feature 확장?
- 기준: 사용자 피드백 + 시장 위치

---

## 9. 자원 (Resources)

### 9.1 인력
- **현재**: 1인 fulltime (Claude + 사용자) — Phase A~C 에 적합
- **권장**: Phase D 부터 numerical analyst 1인 추가 합류
- **이상적**: Phase F 에서 PhD-level CG 전문가 1인

### 9.2 비용
- 학습 자료: 책 ~$300 (Piegl & Tiller, Patrikalakis 등)
- 외부 검증: NIST test cases 무료
- 산업 CAD 비교용 SolidWorks/Fusion subscription: ~$3,000/year

### 9.3 시간
- 36 개월 (자체 핵심)
- 60+ 개월 (산업 동급)

---

## 10. 의존성 (Dependencies)

### 10.1 코드베이스 의존
- 기존 LOCKED 정책 (ADR-007/019/021/025/026) — 모두 보존
- 기존 DCEL (axia-geo) — 확장 (필드 추가)
- 기존 transaction system — 그대로 사용
- 기존 WASM bridge — 확장 (NURBS 데이터 marshalling)

### 10.2 외부 의존
- Rust crates (위 5.1)
- 필수 외부 의존 0개 (자체 작성 원칙)
- 선택적: Phase F+ 에서 truck 통합 검토

---

## 11. 거버넌스 (Governance)

### 11.1 ADR 시리즈 매핑
| Phase | ADR | 제목 |
|---|---|---|
| Kickoff | ADR-027 | NURBS Kernel Initiative |
| Phase A | ADR-028 | Analytic Edge Curve Foundation |
| Phase B | ADR-029 | Free-form Curves (Bezier / B-spline) |
| Phase C | ADR-030 | NURBS Curves + CCI |
| Phase D | ADR-031 | Analytic Surface Primitives |
| Phase E | ADR-032 | NURBS Surfaces (Bezier / B-spline / Trimmed) |
| Phase F | ADR-033 | Surface-Surface Intersection |
| Phase G | ADR-034 | NURBS Boolean Operations |
| Phase G | ADR-035 | STEP / IGES Export |

### 11.2 LOCKED 정책 진화

각 Phase 에서 추가될 LOCKED 항목 (예측):
- LOCKED #14: Analytic curve = truth, polyline = cache
- LOCKED #15: Analytic surface tessellation chord error
- LOCKED #16: NURBS knot vector normalization
- LOCKED #17: Trim curve self-intersection 금지

### 11.3 회귀 방지

- 각 Phase 신규 테스트는 **절대 `#[ignore]` 금지** (LOCKED 정책 #9)
- `verify_face_invariants` 의 NURBS 확장
- CI 에 NURBS-specific invariant 검증 추가

---

## 12. 결정 사항 (Open Questions)

### Q1. 시작 시점
- 즉시 vs 현재 polygon 안정화 우선?
- **권장**: 현재 ADR-021/022/023/024/025/026 안정화 검증 후 (1~2 개월 후)

### Q2. 1차 사용자 피드백 시점
- Phase A 종료 시점 (Month 3)
- 실제 도구 (DrawArc / DrawCircle) 가 분석적 곡선 사용

### Q3. Documentation 전략
- 코드 docstring vs 별도 문서?
- **권장**: 양쪽 모두 — Rust doctest + docs/ 폴더 가이드

### Q4. WASM 번들 크기 한계
- Phase G 까지 합계 예상 < 5 MB
- 한계 도달 시 dynamic import 분리 (NURBS-only operations)

### Q5. UI 변경
- DrawBezier / DrawSpline 도구 신설 시 UI 충격 정도
- **권장**: 기존 DrawArc / DrawCircle 도 내부적으로 분석적 처리하되 UI 동일 유지

---

## 13. 선행 작업 (Prerequisites)

이 계획서 진행 전에 완료해야 할 사항:

1. ✅ **ADR-021/022/023/024/025/026 안정화** — 이미 완료 (이 세션)
2. ⏳ **현재 polygon stress test 1주 운영** — Phase 1 P9 ~ Phase 7 P11 strict 회귀 모니터링
3. ⏳ **사용자 합의 / kickoff ADR-027 작성**
4. ⏳ **학습 기간 1~2 개월** — Piegl & Tiller, 유사 오픈소스 (truck) 코드 review
5. ⏳ **Prototype 2주** — analytic Line+Arc edge, throw-away code 로 학습

---

## 14. 결론

**가능 여부**: 🟢 **YES — 점진적, 자체 작성 가능**

**합리적 시작점**: Phase A (Analytic Edge Curve, 3개월)
- 가장 적은 위험
- 가장 큰 즉각 가치 (진짜 원/호)
- 멈춰도 자급자족
- LOCKED 정책 거의 무변동

**최종 의사결정**: 사용자 승인 + Gate 1 (Month 3) 결과로 Phase B 진행 여부 결정

---

## Appendix A — Phase 의존성 그래프

```
Phase A (Edge curve foundation)
    ↓
    ├─→ Phase B (Bezier/B-spline curve)
    │        ↓
    │        Phase C (NURBS curve + CCI)
    │              ↓
    └─→ Phase D (Analytic surface primitives) ←┐
              ↓                                  │
              Phase E (NURBS surfaces) ←─────────┘
                    ↓
                    Phase F (SSI)  ← 박사급 risk gate
                          ↓
                          Phase G (Boolean + STEP I/O)
```

## Appendix B — 비교 표 (다른 옵션 대비)

| 항목 | 자체 (이 계획) | truck 통합 | OCCT 통합 |
|---|---|---|---|
| 라이선스 자유도 | ✅ 완전 자유 | ✅ MIT | ⚠ LGPL |
| 통제권 | ✅ 100% | 🟡 70% | 🔴 30% |
| 첫 가치 시점 | 3 개월 | 1 주 | 1~2 주 |
| 시간 (대략 동급까지) | 36~60 개월 | 12~24 개월 | 6~12 개월 |
| WASM 번들 | < 5 MB | ~5 MB | ~10 MB |
| LOCKED 정책 호환 | ✅ 직접 | 🟡 wrap | 🔴 ABI 통과 |
| 학습 가치 | 🌟🌟🌟 | 🌟 | 🌟 |
| 산업 robustness | ❌ (10년+) | 🟡 (개발 중) | ✅ |

## Appendix C — 위험 시나리오 대응

### 시나리오 1: Phase F (SSI) 가 6개월 + 미해결
- **대응**: Phase F 종료 시 truck/OCCT 통합 결정 (Gate 3)
- Phase E 까지의 자체 코드는 보존 (curve/surface primitives 로 활용)

### 시나리오 2: 사용자 피드백이 다른 우선순위 요구
- **대응**: 각 Phase 끝 자급자족 → 다른 작업으로 전환 가능
- 가장 짧은 완성 단위는 Phase A (3개월)

### 시나리오 3: 인력 부족
- **대응**: Phase A~C (curve only) 만 자체, 이후 truck 통합 결정

---

**End of Plan Document**
