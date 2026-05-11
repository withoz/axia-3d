# ADR-036: STEP/IGES Curve & Surface Promotion (Phase G Stage 4-A architectural)

**Status**: **Accepted** (2026-04-30) — Phase G Stage 4-A architectural commitment
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md) Phase G Stage 4
**Initiative**: ADR-027 (Accepted)
**Builds on**: ADR-028~035 (Phases A~G + STEP/IGES Hybrid)
**Binds**: Stage 4-A (OCCT.js) AND Stage 4-B (axia-foreign 자체 파서) — 두 경로 모두 본 ADR 의 매핑 규약을 준수해야 함

## Context

ADR-035 P20.7 으로 Stage 4-A scaffolding 완료. 다음 결정 = "BRep edge / face
의 parametric definition 을 어떻게 우리 `AnalyticCurve` /
`AnalyticSurface` enum 에 매핑하는가." 이건 단순 구현 선택이 아니라
**precision / Boolean / round-trip 의 토대**.

### 왜 지금 잠그는가

- Stage 4-A 후속 PR 에서 OCCT BRep traversal 시작 → 매핑 결정 필요
- Stage 4-B 자체 파서 spike 도 **동일 매핑** 을 따라야 cross-validation
  (ADR-035 P20.E 트리거 #2 "정확도 1e-3 mm") 이 의미를 가짐
- 매핑이 두 곳에서 갈라지면 P20.E 의 12개월 default 결정이 무효화됨

## Decision

### P21 — 새 원칙: Precision-First Promotion

> **STEP/IGES 의 BRep edge / face 의 parametric definition 은 항상
> 직접 매핑되는 `AnalyticCurve` / `AnalyticSurface` variant 로 승격된
> 후 mesh 에 attach 한다. Tessellation 은 렌더 캐시일 뿐 truth 가
> 아니다.**

ADR-014 메타-원칙 #13 "One Source, Two Views" 의 STEP/IGES 도메인 적용.

### P21.1 — Curve 매핑 (BRep edge → AnalyticCurve)

| OCCT type | → AnalyticCurve variant | 변환 규칙 |
|---|---|---|
| `Geom_Line` | `Line { start, end }` | trim range `[u_a, u_b]` 의 양 끝점 evaluate |
| `Geom_Circle` (full) | `Circle { center, normal, radius }` | trim range == 2π 인지 확인 |
| `Geom_TrimmedCurve(Geom_Circle, t1, t2)` | `Arc { center, axis, start_angle, end_angle, radius }` | OCCT angle (radian) 그대로 사용 |
| `Geom_BezierCurve` | `Bezier { control_pts }` | 동일 De Casteljau 좌표계 — 직접 복사 |
| `Geom_BSplineCurve` (`IsRational == false`) | `BSpline { control_pts, knots, degree }` | knot vector / degree 직접 복사 |
| `Geom_BSplineCurve` (`IsRational == true`) | `NURBS { control_pts, weights, knots, degree }` | weight 배열 OCCT 순서 그대로 |
| `Geom_TrimmedCurve(parent)` (parent ≠ Circle) | parent 매핑 후 trim sub-range 만 보존 | `validate_param_in_range` 가드 |
| `Geom_Ellipse` | **변환** → `NURBS` (rational quadratic 9-CP form) | Piegl & Tiller A7.1 |
| `Geom_Hyperbola` | **변환** → `NURBS` | Piegl & Tiller A7.5 |
| `Geom_Parabola` | **변환** → `NURBS` | Piegl & Tiller A7.4 |
| `Geom_OffsetCurve` | **변환** → `NURBS` (basis curve 승격 후 offset 샘플 → fitting) | 정밀도 ε ≤ 1e-3 mm 검증 필수 |

**P21.1 결정 규칙**:
1. **Direct mapping 우선** — table 의 1~6 번은 lossless 직접 복사
2. **Conic conversion** — table 의 7~9 번은 정확한 rational form (degree 2,
   특정 weight 패턴) 으로 표현 가능 → lossless
3. **Fitting fallback** — `Geom_OffsetCurve` 같은 procedural curve 는
   sampled fitting 으로 1e-3 mm 이내 근사

### P21.2 — Surface 매핑 (BRep face → AnalyticSurface)

| OCCT type | → AnalyticSurface variant | 변환 규칙 |
|---|---|---|
| `Geom_Plane` | `Plane { origin, normal }` | direct |
| `Geom_CylindricalSurface` | `Cylinder { axis_origin, axis_dir, ref_dir, radius }` | OCCT `Position` → axis basis |
| `Geom_SphericalSurface` | `Sphere { center, radius }` | direct |
| `Geom_ConicalSurface` | `Cone { apex, axis_dir, half_angle }` | apex = base + height·axis (OCCT 의 base + semi-angle) |
| `Geom_ToroidalSurface` | `Torus { center, axis, major_radius, minor_radius }` | direct |
| `Geom_BezierSurface` | `BezierPatch { ctrl_grid }` | row-major direct copy |
| `Geom_BSplineSurface` (non-rational) | `BSplineSurface { ctrl_grid, knots_u, knots_v, deg_u, deg_v }` | direct |
| `Geom_BSplineSurface` (rational) | `NURBSSurface { + weights_grid, trim_loops }` | weight 2D grid |
| `Geom_SurfaceOfRevolution` | **변환** → `NURBSSurface` (basis curve 회전 → tensor product) | Piegl & Tiller A8.1 |
| `Geom_SurfaceOfLinearExtrusion` | **변환** → `NURBSSurface` (basis curve × line tensor) | Piegl & Tiller A8.2 |
| `Geom_OffsetSurface` | **변환** → `BSplineSurface` (sampled fitting) | ε ≤ 1e-3 mm 검증 |
| `Geom_RectangularTrimmedSurface(parent)` | parent 매핑 + uv_bounds clip | trim_loops 동기화 |

**P21.2 결정 규칙**:
1. **Direct mapping** (1~8 번): lossless
2. **Sweep conversion** (9, 10): lossless rational tensor (Piegl & Tiller §8)
3. **Fitting fallback** (11): sampled control net + 1e-3 mm 검증

### P21.3 — Trim Loops (PCurve)

STEP `EDGE_CURVE` 의 PCurve (parameter-space curve) → `TrimCurve2D`:

| 3D curve type → PCurve form | → TrimCurve2D variant |
|---|---|
| `Line` (PCurve = parameter line) | `Line { a, b }` |
| `Circle` / `Arc` (PCurve = parametric circle) | `Arc { center, radius, start_angle, end_angle }` |
| `Bezier` (PCurve degree 1~3) | `Bezier { control_pts }` |
| `BSpline` PCurve | `BSpline { control_pts, knots, degree }` |

PCurve 가 missing (STEP 파일이 누락) 인 경우 → 3D curve 의 inverse projection 으로 재계산.

### P21.4 — Vertex Coordinate Tolerance

OCCT 의 `BRep_Tool::Pnt(vertex)` 결과는 STEP 의 `CARTESIAN_POINT` 와
직접 일치. **단**:
- LOCKED #5 정책: 우리 mesh 에 들어가기 전에 1.5μm spatial-hash dedup
  통과
- ADR-026 P12 (cardinal plane SSOT) 통과 — sub-tol 좌표는 0 으로
  강제

### P21.5 — Parameter Range 정합

OCCT 의 trim range `[u_first, u_last]` ↔ 우리 `AnalyticCurve` 의
parameter range:
- `Line`: t ∈ [0, 1] (start 0, end 1) → OCCT `[u_a, u_b]` 매핑 시
  evaluate 후 endpoint 만 저장 (u 미보존)
- `Circle/Arc`: angle ∈ [start_angle, end_angle] (radian)
- `Bezier`: t ∈ [0, 1]
- `BSpline/NURBS`: knot range [knots[degree], knots[n_ctrl]] 보존

### P21.6 — 라운드트립 1e-3 mm 검증

각 매핑마다 **양방향 정합성** 검증:
- Forward: OCCT `Geom_*` → AnalyticCurve/Surface → tessellate → 좌표
- Reverse: AnalyticCurve/Surface → OCCT `Geom_*` (export) → tessellate
  → 좌표
- 동일 파라미터에서 좌표 차이 ≤ 1e-3 mm 보장

검증 코퍼스: ADR-035 P20.D 의 5 파일 (NIST 2 + 벤더별 3) — 동일 fixtures
재사용. **P20.E 트리거 #2 (정확도)** 와 직접 연동.

### P21.7 — 실패 처리

각 매핑 단계의 실패 모드 + 회복:

| 실패 케이스 | 처리 |
|---|---|
| OCCT downcast 실패 (unknown subtype) | tessellate fallback + warning ("타입 X 미지원") |
| Conic → NURBS 변환 정확도 미달 | tessellate fallback + warning ("정확도 미달") |
| Fitting tolerance 초과 (1e-3 mm) | tessellate fallback + 사용자 명시 경고 |
| Rational NURBS surface SSI 호출 (G1 한계) | 거부 + alternate 안내 |
| Trim PCurve missing | 3D curve inverse projection 재계산 |
| Trim self-intersection | warning + 첫 self-intersection 점에서 split 후 재시도 |

모든 fallback / failure 는 `ImportResult.warnings` 에 누적 → 사용자
가 STEP/IGES import 결과의 정확도를 검증할 수 있어야 함.

### P21.8 — Stage 4-A / 4-B 매핑 일관성 강제

이 ADR 은 두 경로 모두에 적용:
- **Stage 4-A (OCCT.js)** — `web/src/import/occtCurvePromote.ts`,
  `occtSurfacePromote.ts` 가 본 매핑 표 그대로 구현
- **Stage 4-B (axia-foreign)** — `crates/axia-foreign/src/promote_curve.rs`,
  `promote_surface.rs` 가 동일 매핑 구현 (STEP entity ↔ AnalyticCurve/
  Surface)
- **Cross-validation harness** — 두 경로의 출력이 동일 입력 파일에서
  1e-3 mm 이내 일치하는지 자동 검증 → ADR-035 P20.E 트리거 #2

## Implementation

### Module structure

**Stage 4-A** (TS, OCCT.js):
```
web/src/import/
  occtCurvePromote.ts      # OCCT Geom_Curve → AnalyticCurve 매핑
  occtSurfacePromote.ts    # OCCT Geom_Surface → AnalyticSurface 매핑
  occtBrepWalker.ts        # TopExp_Explorer 순회 + promotion 호출
  occtConicConverter.ts    # Ellipse/Hyperbola/Parabola → NURBS
  occtSweepConverter.ts    # SurfaceOfRevolution/Extrusion → NURBSSurface
  occtFittingFallback.ts   # OffsetCurve/Surface fitting + tolerance check
```

**Stage 4-B** (Rust, 자체 파서):
```
crates/axia-foreign/src/
  promote_curve.rs         # STEP entity → AnalyticCurve
  promote_surface.rs       # STEP entity → AnalyticSurface
  conic_converter.rs       # 분리된 conic 변환 모듈 (TS 와 동일 알고리즘)
  sweep_converter.rs
  fitting_fallback.rs
```

알고리즘은 양쪽이 동일 (Piegl & Tiller A7.1, A7.4, A7.5, A8.1, A8.2 +
fitting). 구현은 TS / Rust 로 분리되지만 출력 정합성 보장.

### Tests (절대 #[ignore] 금지)

**Stage 4-A 단위**:
- `occtCurvePromote.test.ts` — 각 매핑 type 별 1 test (12+)
- `occtSurfacePromote.test.ts` — 각 매핑 type 별 1 test (12+)
- `occtConicConverter.test.ts` — Ellipse / Parabola / Hyperbola 1e-9 정확
  도 (3+)
- `occtSweepConverter.test.ts` — Revolution / Extrusion (2+)

**통합**:
- 5 코퍼스 파일 round-trip < 1e-3 mm
- Stage 4-A vs Stage 4-B cross-validation < 1e-3 mm (Stage 4-B
  spike 완료 후 enable)

## Risks & Mitigations

- **R1 — Conic 변환 정밀도** (P20.E 트리거 #2 영향): Piegl & Tiller
  알고리즘 + 1e-9 mm 단위 테스트
- **R2 — TS / Rust 매핑 drift**: ADR 매핑 표가 SSOT. 두 구현 모두 매핑
  표를 주석에 인용 (cross-reference link)
- **R3 — Procedural curve fitting 정확도**: 1e-3 mm 통과 못 하면
  tessellate fallback + warning
- **R4 — Rational NURBS surface SSI 미지원**: import 는 가능하지만
  Boolean 시도 시 거부 — Phase G1 follow-up 으로 해소
- **R5 — Trim PCurve 정합 오류**: 3D curve inverse projection 으로
  재계산 (P21.7)

## Success Criteria

- ✅ ADR-036 의 매핑 표가 commit 으로 고정 (이 PR)
- ⏳ `occtCurvePromote.ts` / `occtSurfacePromote.ts` 스텁 (다음 PR)
- ⏳ 12 매핑 단위 테스트 통과
- ⏳ 5 코퍼스 round-trip < 1e-3 mm
- ⏳ Stage 4-B spike 완료 후 cross-validation < 1e-3 mm

## References

- Piegl, L. & Tiller, W. *The NURBS Book*, 2nd ed., Chapters 7~8
  (algorithm A7.1 Ellipse, A7.4 Parabola, A7.5 Hyperbola, A8.1
  SurfaceOfRevolution, A8.2 SurfaceOfExtrusion)
- OpenCascade `Geom_*` documentation
- ISO 10303-203:2011 (STEP AP203 entity 정의)
- ADR-027 (NURBS Kernel Initiative)
- ADR-028 (AnalyticCurve enum 정의)
- ADR-031 (AnalyticSurface enum 정의)
- ADR-032 (Promotion paths — atomic API 패턴 SSOT)
- ADR-035 (STEP/IGES Hybrid Strategy)
- PLAN-001 Phase G

## 변경 이력

- **2026-04-30 (initial)**: P21 채택 — Precision-First Promotion. 12 curve
  + 11 surface 매핑 표 고정. Stage 4-A / 4-B 양쪽 동일 매핑 강제.
