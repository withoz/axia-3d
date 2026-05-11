# ADR-053 — Phase H: Curve/Surface Transform & Continuity

**Status**: Accepted (Phase H spec — implementation in progress)
**Date**: 2026-05-04
**Anchor**: ADR-052 master roadmap (Phase H, 3주)
**Parent**: ADR-052 §2.3 Phase H
**Prerequisites**: ADR-027~036 (NURBS kernel A~G)
**Related**: ADR-019 (Line is Truth), 메타-원칙 #14 (Parametric Truth — Phase N 격상)

---

## 0. Summary (4 lines)

> 현재 `CurveOps` / `SurfaceOps` 는 evaluate / derivative / tessellate /
> parameter_range 4개 메서드만 보유. Phase H 는 **transform(matrix)** +
> **continuity (G0/G1/G2)** + **curvature analysis** + **kind promotion
> 정책** 추가로 모든 11 curve + 12 surface variant 의 변환 후 표현 정확성 보장.

---

## 1. Context

### 1.1 현재 trait 표면

```rust
// crates/axia-geo/src/curves/mod.rs:102
pub trait CurveOps {
    fn evaluate(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn tessellate(&self, chord_tol: f64, mesh: &Mesh) -> Result<Vec<DVec3>>;
    fn parameter_range(&self) -> (f64, f64);
}

// crates/axia-geo/src/surfaces/mod.rs:149
pub trait SurfaceOps {
    fn evaluate(&self, u: f64, v: f64) -> DVec3;
    fn normal(&self, u: f64, v: f64) -> DVec3;
    fn derivative_u(&self, u: f64, v: f64) -> DVec3;
    fn derivative_v(&self, u: f64, v: f64) -> DVec3;
    fn parameter_range(&self) -> ((f64, f64), (f64, f64));
    fn tessellate(&self, chord_tol: f64) -> SurfaceTessellation;
}
```

### 1.2 Gap 분석

| 영역 | 현재 | Phase H 목표 |
|---|---|---|
| Transform (rigid) | ❌ 없음 | ✅ kind 보존 |
| Transform (uniform scale) | ❌ 없음 | ✅ kind 보존 |
| Transform (non-uniform) | ❌ 없음 | ✅ NURBS auto-promote |
| Tangent unit vector | derivative 만 | ✅ `tangent_at` (정규화) |
| 2nd derivative | ❌ 없음 | ✅ Curve `2nd_derivative_at` / Surface `2nd_uu/uv/vv` |
| Curvature scalar (curve) | ❌ 없음 | ✅ `curvature_at` |
| Gaussian/Mean curvature (surface) | ❌ 없음 | ✅ `gaussian_curvature` / `mean_curvature` |
| Principal directions (surface) | ❌ 없음 | ✅ `principal_directions` |
| G0/G1/G2 continuity | ❌ 없음 | ✅ `is_g0/1/2_to(other, tol)` |

### 1.3 Path D 의존

Phase N (Curve/Surface Mandatory) 에서 도구 (translate/rotate/scale) 가
`curve.transform(m)` 호출 → 본 Phase H 가 이 API 를 제공해야 함.

---

## 2. Decision

### 2.1 Curve 변환 정책 — Variant Promotion Matrix

| 입력 변환 \ 입력 curve | Line | Circle | Arc | Bezier | BSpline | NURBS |
|---|---|---|---|---|---|---|
| Identity | self | self | self | self | self | self |
| Translation | (mesh) | Circle | Arc | Bezier | BSpline | NURBS |
| Rotation | (mesh) | Circle | Arc | Bezier | BSpline | NURBS |
| Uniform scale | (mesh) | Circle | Arc | Bezier | BSpline | NURBS |
| Non-uniform scale | (mesh) | **NURBS** (Ellipse) | **NURBS** | Bezier* | BSpline* | NURBS |
| Shear / projection | (mesh) | **NURBS** | **NURBS** | Bezier* | BSpline* | NURBS |

(*) Bezier / BSpline 의 control point 변환은 affine 보존이므로 kind 유지.
(mesh) Line 은 VertId 참조 → mesh 의 vertex 변환이 처리, 본 메서드는 no-op.

### 2.2 새 CurveOps API

```rust
pub trait CurveOps {
    // ── 기존 (변경 없음) ──
    fn evaluate(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;
    fn tessellate(&self, chord_tol: f64, mesh: &Mesh) -> Result<Vec<DVec3>>;
    fn parameter_range(&self) -> (f64, f64);

    // ── Phase H 신규 ──

    /// 1차 미분의 단위 벡터. 기본 구현: `derivative` 정규화.
    /// 0 길이 (cusp) 면 Err.
    fn tangent_at(&self, t: f64, mesh: &Mesh) -> Result<DVec3> {
        let d = self.derivative(t, mesh)?;
        if d.length_squared() < 1e-20 {
            anyhow::bail!("tangent undefined at parameter {}", t);
        }
        Ok(d.normalize())
    }

    /// 2차 미분 (parametric, 정규화 X).
    fn second_derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;

    /// 곡률 |κ(t)| = |r'(t) × r''(t)| / |r'(t)|³ (Frenet 공식).
    fn curvature_at(&self, t: f64, mesh: &Mesh) -> Result<f64> {
        let d1 = self.derivative(t, mesh)?;
        let d2 = self.second_derivative(t, mesh)?;
        let n = d1.length();
        if n < 1e-12 { return Ok(0.0); }
        Ok(d1.cross(d2).length() / n.powi(3))
    }

    /// 변환된 새 curve. Line 은 self (mesh 가 처리). 다른 variant 는
    /// kind 보존 가능하면 동일 variant, 아니면 NURBS 로 promote.
    fn transform(&self, m: &DMat4, mesh: &Mesh) -> Result<AnalyticCurve>;

    /// G0 — endpoint 일치 (tol 이내).
    fn is_g0_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool>;

    /// G1 — endpoint 일치 + tangent 방향 일치 (cos θ ≥ 1 - tol).
    fn is_g1_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool>;

    /// G2 — G1 + 곡률 일치 (|κ_a - κ_b| ≤ tol).
    fn is_g2_to(&self, other: &AnalyticCurve, mesh: &Mesh, tol: f64) -> Result<bool>;
}
```

### 2.3 새 SurfaceOps API

```rust
pub trait SurfaceOps {
    // ── 기존 (변경 없음) ──
    fn evaluate(&self, u: f64, v: f64) -> DVec3;
    fn normal(&self, u: f64, v: f64) -> DVec3;
    fn derivative_u(&self, u: f64, v: f64) -> DVec3;
    fn derivative_v(&self, u: f64, v: f64) -> DVec3;
    fn parameter_range(&self) -> ((f64, f64), (f64, f64));
    fn tessellate(&self, chord_tol: f64) -> SurfaceTessellation;

    // ── Phase H 신규 ──

    fn second_derivative_uu(&self, u: f64, v: f64) -> DVec3;
    fn second_derivative_uv(&self, u: f64, v: f64) -> DVec3;
    fn second_derivative_vv(&self, u: f64, v: f64) -> DVec3;

    /// First Fundamental Form: E = r_u·r_u, F = r_u·r_v, G = r_v·r_v.
    fn first_fundamental_form(&self, u: f64, v: f64) -> (f64, f64, f64) {
        let ru = self.derivative_u(u, v);
        let rv = self.derivative_v(u, v);
        (ru.dot(ru), ru.dot(rv), rv.dot(rv))
    }

    /// Second Fundamental Form: L = r_uu·n, M = r_uv·n, N = r_vv·n.
    fn second_fundamental_form(&self, u: f64, v: f64) -> (f64, f64, f64) {
        let n = self.normal(u, v);
        (
            self.second_derivative_uu(u, v).dot(n),
            self.second_derivative_uv(u, v).dot(n),
            self.second_derivative_vv(u, v).dot(n),
        )
    }

    /// Gaussian curvature K = (LN - M²) / (EG - F²).
    fn gaussian_curvature(&self, u: f64, v: f64) -> f64 {
        let (e, f, g) = self.first_fundamental_form(u, v);
        let (l, m, n) = self.second_fundamental_form(u, v);
        let det1 = e * g - f * f;
        if det1.abs() < 1e-12 { return 0.0; }
        (l * n - m * m) / det1
    }

    /// Mean curvature H = (EN + GL - 2FM) / (2(EG - F²)).
    fn mean_curvature(&self, u: f64, v: f64) -> f64 {
        let (e, f, g) = self.first_fundamental_form(u, v);
        let (l, m, n) = self.second_fundamental_form(u, v);
        let det1 = e * g - f * f;
        if det1.abs() < 1e-12 { return 0.0; }
        (e * n + g * l - 2.0 * f * m) / (2.0 * det1)
    }

    /// Principal curvatures (κ_max, κ_min) via H + sqrt(H² - K).
    fn principal_curvatures(&self, u: f64, v: f64) -> (f64, f64) {
        let h = self.mean_curvature(u, v);
        let k = self.gaussian_curvature(u, v);
        let disc = (h * h - k).max(0.0).sqrt();
        (h + disc, h - disc)
    }

    fn transform(&self, m: &DMat4) -> AnalyticSurface;
}
```

### 2.4 Variant 별 Transform 구현 매트릭스

#### Curves
| Variant | transform 구현 |
|---|---|
| Line | self (mesh 가 처리) |
| Circle | center → m·center, normal → m_rot·normal, basis_u → m_rot·basis_u, radius unchanged for rigid; non-uniform → promote |
| Arc | Circle 와 동일 + start/end_angle 보존 |
| Bezier | control_pts 각각 m·p — affine 보존 |
| BSpline | control_pts 각각 m·p, knots/degree 보존 |
| NURBS | control_pts → m·p, weights 보존 (rigid+uniform), non-rigid 시 weights 재계산 |

#### Surfaces
| Variant | transform 구현 |
|---|---|
| Plane | origin → m·origin, normal → m_rot·normal |
| Cylinder | axis_origin/axis_dir 변환, radius unchanged for rigid |
| Sphere | center → m·center, radius unchanged for rigid; non-uniform → ellipsoid (NURBS) |
| Cone | apex/axis 변환, half_angle unchanged for uniform |
| Torus | center/axis 변환, radii unchanged for uniform |
| BezierPatch | control_pts 각각 m·p |
| BSplineSurface | control_pts 변환 |
| NURBSSurface | control_pts 변환, weights 보존 |

### 2.5 Promotion Helpers (필요 시)

```rust
/// Circle / Arc / Sphere / Cone / Torus 가 비-uniform 변환을 만나면
/// rational NURBS 표현으로 promote 하는 헬퍼. Phase C/E 의 to_nurbs
/// 메서드 활용.
impl AnalyticCurve {
    pub fn promote_to_nurbs(&self, mesh: &Mesh) -> Result<NURBSCurveData>;
}
impl AnalyticSurface {
    pub fn promote_to_nurbs(&self) -> Result<NURBSSurfaceData>;
}
```

### 2.6 Transform 분류 헬퍼

```rust
pub enum TransformKind {
    Identity,
    Translation,
    Rigid,           // R + T (no scale)
    UniformScale,
    NonUniformScale, // 또는 shear / projection
}

pub fn classify_transform(m: &DMat4) -> TransformKind;
```

DMat4 의 3×3 부분에서 SVD 또는 eigenvalue 검사로 분류. tolerance ε = 1e-9.

### 2.7 회귀 테스트 (24개)

#### Curve transform (12개)
1. `line_transform_no_op` — Line 은 self 반환
2. `circle_translate_preserves_kind`
3. `circle_rotate_preserves_kind`
4. `circle_uniform_scale_preserves_kind`
5. `circle_nonuniform_scale_promotes_to_nurbs`
6. `arc_rigid_transform_preserves_angles`
7. `bezier_affine_preserves_kind` — control point 변환만
8. `bspline_affine_preserves_knots`
9. `nurbs_rigid_preserves_weights`
10. `nurbs_nonrigid_recomputes_weights`
11. `transform_round_trip_identity` — m * m⁻¹ = identity 후 evaluate 1e-9
12. `tangent_unit_length_after_transform`

#### Surface transform (8개)
13. `plane_translate_preserves_normal_direction`
14. `cylinder_rigid_preserves_radius`
15. `sphere_uniform_scale_changes_radius_proportionally`
16. `sphere_nonuniform_scale_promotes_nurbs`
17. `cone_apex_translates_with_origin`
18. `torus_rigid_preserves_minor_major_radii`
19. `nurbs_surface_control_pts_transformed`
20. `surface_normal_invariant_under_rigid`

#### Continuity (4개)
21. `g1_continuous_two_lines_meeting_at_vertex`
22. `g1_arc_to_line_tangent_match`
23. `g2_circle_to_circle_same_radius`
24. `g2_violated_when_curvatures_differ`

### 2.8 Acceptance

- [ ] 11 curve variants × transform 구현
- [ ] 12 surface variants × transform 구현
- [ ] 24 회귀 테스트 통과 (모두 절대 #[ignore] 금지)
- [ ] Round-trip identity 1e-9 정확도
- [ ] G1 / G2 검사 false-positive / false-negative 0
- [ ] LOC 추정: ~800-1200줄 (curves 측 + surfaces 측)
- [ ] 기존 회귀 842 모두 통과

---

## 3. Out of Scope

본 Phase H 가 다루지 않음:

- **Knot insertion / refinement** — Phase I (ADR-054)
- **Higher-order continuity (G3+)** — 산업 표준 G2 까지만
- **Variant 간 normalize** — Bezier↔BSpline 변환 등 Phase K
- **NURBS Boolean** — Phase J
- **도구 통합** — Phase O (transform 호출자 재작성)

---

## 4. 위험 + 완화

| 위험 | 완화 |
|---|---|
| 2nd derivative 의 수치 안정성 | de Boor 의 m차 미분 알고리즘 (Piegl §3.3) 사용 |
| Non-uniform 변환 후 weight 재계산 정확성 | rational projection — weight = w_i, control = (w_i·P_i, w_i) 4D 변환 후 normalize |
| Transform 분류의 ε 선정 | 1e-9 default, 1e-6 fallback (변환 행렬 의존) |
| Line 의 mesh-relative semantics 혼선 | docstring 명시 + 회귀 테스트로 보호 |
| Existing curves/surfaces 코드 회귀 | trait method 모두 default impl 제공 (BC 보장) |

---

## 5. References

- ADR-052 master roadmap §2.3 Phase H
- ADR-028~036 — kernel Phase A~G (transform 미구현 확인)
- Piegl & Tiller, *The NURBS Book*:
  - §3.3 (B-spline derivatives)
  - §4.5 (NURBS derivatives)
  - §10.7 (rational quadratic curves for circles/conics)
- do Carmo, *Differential Geometry of Curves and Surfaces*:
  - Ch. 1-2 (Frenet, curvature)
  - Ch. 3 (First/Second Fundamental Form)
  - Ch. 4 (Gaussian/Mean curvature)

---

*Author*: AXiA team (사용자 결정 + Claude spec)
*Status*: Phase H spec accepted — implementation 별도 commits
