//! STEP / IGES surface entity → `axia_geo::AnalyticSurface` promotion
//! (Stage 4-B 자체 파서 경로, ADR-036 P21.2 매핑 표).
//!
//! **본 모듈은 ADR-036 P21.2 매핑 표의 Rust SSOT.**
//!
//! Stage 4-A (TS, OCCT.js) 의 `web/src/import/occtSurfacePromote.ts` 와
//! 동일 enum + 동일 dispatch 사용 — cross-validation harness 가
//! type-safe 하게 두 경로를 비교 (ADR-035 P20.E #2, ADR-036 P21.8).
//!
//! ## 매핑 표 (ADR-036 P21.2, 12항목)
//!
//! | STEP entity / IGES type | → AnalyticSurface | 변환 |
//! |---|---|---|
//! | `PLANE` (STEP) / IGES Type 190 | `Plane` | direct |
//! | `CYLINDRICAL_SURFACE` / IGES Type 192 | `Cylinder` | direct |
//! | `SPHERICAL_SURFACE` / IGES Type 196 | `Sphere` | direct |
//! | `CONICAL_SURFACE` / IGES Type 194 | `Cone` | direct (apex 계산) |
//! | `TOROIDAL_SURFACE` / IGES Type 198 | `Torus` | direct |
//! | `BEZIER_SURFACE` | `BezierPatch` | direct |
//! | `B_SPLINE_SURFACE_WITH_KNOTS` (non-rational) | `BSplineSurface` | direct |
//! | `B_SPLINE_SURFACE_WITH_KNOTS` (rational) / IGES Type 128 | `NurbsSurface` | direct |
//! | `SURFACE_OF_REVOLUTION` / IGES Type 120 | `NurbsSurface` (Piegl A8.1) | conversion |
//! | `SURFACE_OF_LINEAR_EXTRUSION` / IGES Type 122 | `NurbsSurface` (Piegl A8.2) | conversion |
//! | `OFFSET_SURFACE` | `BSplineSurface` (sampled fitting) | fitting fallback |
//! | `RECTANGULAR_TRIMMED_SURFACE` | parent + uv_bounds clip | indirect |

use serde::{Deserialize, Serialize};

use crate::step::classify_surface_entity;
use crate::step_parser::{Entity, StepFile, Value};
use crate::step_resolver::{
    Axis2Placement3D, ResolveCache, ResolveError,
};

/// STEP / IGES surface entity 의 runtime 식별자 (ADR-036 P21.2 매핑 키).
///
/// Stage 4-A `OcctSurfaceKind` 와 1:1 대응.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForeignSurfaceKind {
    Plane,
    Cylinder,
    Sphere,
    Cone,
    Torus,
    BezierSurface,
    BSplineSurface,
    NurbsSurface,
    SurfaceOfRevolution,
    SurfaceOfLinearExtrusion,
    OffsetSurface,
    RectangularTrimmedSurface,
    Unsupported,
}

/// UV bounds — `[u_min, u_max, v_min, v_max]` (P21.2 정합).
pub type UvBounds = [f64; 4];

/// Promotion 결과 — caller 가 `axia_geo::Mesh::set_face_surface_*` API 로 dispatch.
///
/// 모든 variant 는 optional `uv_bounds` 를 가진다 (Stage 4-A
/// `SurfacePromotion` 와 정합).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SurfacePromotion {
    Plane {
        origin: [f64; 3],
        normal: [f64; 3],
        uv_bounds: Option<UvBounds>,
    },
    Cylinder {
        axis_origin: [f64; 3],
        axis_dir: [f64; 3],
        ref_dir: [f64; 3],
        radius: f64,
        uv_bounds: Option<UvBounds>,
    },
    Sphere {
        center: [f64; 3],
        radius: f64,
        uv_bounds: Option<UvBounds>,
    },
    Cone {
        apex: [f64; 3],
        axis_dir: [f64; 3],
        half_angle: f64,
        uv_bounds: Option<UvBounds>,
    },
    Torus {
        center: [f64; 3],
        axis: [f64; 3],
        major_radius: f64,
        minor_radius: f64,
        uv_bounds: Option<UvBounds>,
    },
    BezierPatch {
        ctrl_grid: Vec<Vec<[f64; 3]>>,
        uv_bounds: Option<UvBounds>,
    },
    BSplineSurface {
        ctrl_grid: Vec<Vec<[f64; 3]>>,
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: usize,
        deg_v: usize,
        uv_bounds: Option<UvBounds>,
    },
    NurbsSurface {
        ctrl_grid: Vec<Vec<[f64; 3]>>,
        weights_grid: Vec<Vec<f64>>,
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        deg_u: usize,
        deg_v: usize,
        uv_bounds: Option<UvBounds>,
    },
    Tessellate {
        reason: String,
        uv_bounds: Option<UvBounds>,
    },
}

/// Promotion 호출 결과 wrapper (ADR-036 P21.7 warnings 누적).
#[derive(Clone, Debug, Default)]
pub struct SurfacePromotionResult {
    pub promotion: Option<SurfacePromotion>,
    pub warnings: Vec<String>,
}

/// Promotion dispatch (스텁 — STEP/IGES 파서 통합 후 본체 작성).
pub fn promote(entity_kind: ForeignSurfaceKind) -> SurfacePromotionResult {
    let mut warnings = Vec::new();
    let promotion = match entity_kind {
        ForeignSurfaceKind::Unsupported => {
            let reason = format!("Foreign surface entity unsupported (kind={:?})", entity_kind);
            warnings.push(reason.clone());
            Some(SurfacePromotion::Tessellate { reason, uv_bounds: None })
        }
        // TODO (Stage 4-B 본체):
        // - Plane:                       STEP AXIS2_PLACEMENT_3D → origin + normal
        // - Cylinder:                    STEP cylinder_axis + radius
        // - Sphere:                      STEP sphere_center + radius
        // - Cone:                        apex = base + (-radius / tan(half_angle)) · axis
        // - Torus:                       direct
        // - BezierSurface:               row-major copy
        // - BSplineSurface:              non-rational direct
        // - NurbsSurface:                rational direct
        // - SurfaceOfRevolution:         basis curve promote → Piegl A8.1 (occt_sweep_converter
        //                                와 동일 알고리즘 사용 — cross-validate)
        // - SurfaceOfLinearExtrusion:    Piegl A8.2
        // - OffsetSurface:               control net 샘플 + Hoschek/Lasser fitting
        // - RectangularTrimmedSurface:   parent + uv_bounds clip
        _ => {
            warnings.push(format!("promote {:?} not yet wired", entity_kind));
            Some(SurfacePromotion::Tessellate {
                reason: format!("{:?} promotion not yet wired", entity_kind),
                uv_bounds: None,
            })
        }
    };
    SurfacePromotionResult { promotion, warnings }
}

/// 본 모듈이 처리하는 STEP/IGES surface 종류 SSOT.
///
/// Stage 4-A `SUPPORTED_SURFACE_KINDS` (TS) 와 동일 길이/순서.
pub const SUPPORTED_SURFACE_KINDS: &[ForeignSurfaceKind] = &[
    ForeignSurfaceKind::Plane,
    ForeignSurfaceKind::Cylinder,
    ForeignSurfaceKind::Sphere,
    ForeignSurfaceKind::Cone,
    ForeignSurfaceKind::Torus,
    ForeignSurfaceKind::BezierSurface,
    ForeignSurfaceKind::BSplineSurface,
    ForeignSurfaceKind::NurbsSurface,
    ForeignSurfaceKind::SurfaceOfRevolution,
    ForeignSurfaceKind::SurfaceOfLinearExtrusion,
    ForeignSurfaceKind::OffsetSurface,
    ForeignSurfaceKind::RectangularTrimmedSurface,
];

// ────────────────────────────────────────────────────────────────────────
// STEP → SurfacePromotion 본체 (A-4, ADR-036 P21.2 직접 매핑)
// ────────────────────────────────────────────────────────────────────────

/// STEP file 의 surface entity 를 promote.
///
/// 직접 매핑 우선 구현 (Plane / Cylinder). 나머지는 후속 PR.
pub fn promote_step_surface(
    file: &StepFile,
    entity_id: u32,
    cache: &mut ResolveCache,
) -> SurfacePromotionResult {
    let mut warnings = Vec::new();
    let entity = match file.entity(entity_id) {
        Some(e) => e,
        None => {
            let reason = format!("entity #{} not found", entity_id);
            warnings.push(reason.clone());
            return SurfacePromotionResult {
                promotion: Some(SurfacePromotion::Tessellate { reason, uv_bounds: None }),
                warnings,
            };
        }
    };
    let kind = classify_surface_entity(&entity.tag);

    let result = match kind {
        ForeignSurfaceKind::Plane => promote_step_plane(file, entity_id, entity, cache),
        ForeignSurfaceKind::Cylinder => promote_step_cylinder(file, entity_id, entity, cache),
        ForeignSurfaceKind::Sphere => promote_step_sphere(file, entity_id, entity, cache),
        ForeignSurfaceKind::Cone => promote_step_cone(file, entity_id, entity, cache),
        ForeignSurfaceKind::Torus => promote_step_torus(file, entity_id, entity, cache),
        ForeignSurfaceKind::SurfaceOfLinearExtrusion =>
            promote_step_surface_of_linear_extrusion(file, entity_id, entity, cache),
        ForeignSurfaceKind::SurfaceOfRevolution =>
            promote_step_surface_of_revolution(file, entity_id, entity, cache),
        other => Err(ResolveError::at(
            format!("promote_step_surface_{:?} not yet wired (A-4 follow-up)", other),
            entity_id,
        )),
    };

    match result {
        Ok(promotion) => SurfacePromotionResult { promotion: Some(promotion), warnings },
        Err(err) => {
            let reason = err.message.clone();
            warnings.push(err.into_warning());
            SurfacePromotionResult {
                promotion: Some(SurfacePromotion::Tessellate { reason, uv_bounds: None }),
                warnings,
            }
        }
    }
}

/// `PLANE('', placement_ref)` → `SurfacePromotion::Plane`.
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D ref. Plane 은 placement.location
/// 을 origin 으로, placement.axis 를 normal 로 사용.
fn promote_step_plane(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("PLANE arg[1] (placement) not a ref", entity_id))?;
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    Ok(SurfacePromotion::Plane {
        origin: placement.location,
        normal: placement.axis,
        uv_bounds: None,  // unbounded by default; trim_loops 가 결정
    })
}

/// `CYLINDRICAL_SURFACE('', placement_ref, radius)` → `SurfacePromotion::Cylinder`.
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D, arg[2] = radius.
/// placement.axis = cylinder axis (z 방향), placement.ref_direction = u=0 의 방향 (x).
fn promote_step_cylinder(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("CYLINDRICAL_SURFACE arg[1] (placement) not a ref", entity_id))?;
    let radius = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("CYLINDRICAL_SURFACE arg[2] (radius) not a real", entity_id))?;
    if radius <= 0.0 {
        return Err(ResolveError::at(
            format!("CYLINDRICAL_SURFACE radius must be positive, got {}", radius),
            entity_id,
        ));
    }
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    Ok(SurfacePromotion::Cylinder {
        axis_origin: placement.location,
        axis_dir: placement.axis,
        ref_dir: placement.ref_direction,
        radius,
        uv_bounds: None,
    })
}

/// `SPHERICAL_SURFACE('', placement_ref, radius)` → `SurfacePromotion::Sphere`.
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D, arg[2] = radius.
/// Sphere 의 center 는 placement.location.
fn promote_step_sphere(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("SPHERICAL_SURFACE arg[1] (placement) not a ref", entity_id))?;
    let radius = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("SPHERICAL_SURFACE arg[2] (radius) not a real", entity_id))?;
    if radius <= 0.0 {
        return Err(ResolveError::at(
            format!("SPHERICAL_SURFACE radius must be positive, got {}", radius),
            entity_id,
        ));
    }
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    Ok(SurfacePromotion::Sphere {
        center: placement.location,
        radius,
        uv_bounds: None,
    })
}

/// `CONICAL_SURFACE('', placement_ref, radius, semi_angle)` → `SurfacePromotion::Cone`.
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D, arg[2] = radius (placement 의 평면
/// 에서의 ref radius), arg[3] = semi_angle (radian, half-angle).
///
/// Apex 계산: STEP 의 ConicalSurface 는 base radius 를 placement plane 에서
/// 가지므로, apex = location - axis × (radius / tan(semi_angle)).
/// (radius=0 인 cone 은 apex 가 location 자체.)
fn promote_step_cone(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("CONICAL_SURFACE arg[1] (placement) not a ref", entity_id))?;
    let radius = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("CONICAL_SURFACE arg[2] (radius) not a real", entity_id))?;
    let semi_angle = entity.args.get(3)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("CONICAL_SURFACE arg[3] (semi_angle) not a real", entity_id))?;
    if radius < 0.0 {
        return Err(ResolveError::at(
            format!("CONICAL_SURFACE radius must be ≥ 0, got {}", radius),
            entity_id,
        ));
    }
    if !(semi_angle > 0.0 && semi_angle < std::f64::consts::FRAC_PI_2) {
        return Err(ResolveError::at(
            format!("CONICAL_SURFACE semi_angle must be in (0, π/2), got {}", semi_angle),
            entity_id,
        ));
    }
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    // Apex = location - axis × (radius / tan(semi_angle))
    // (axis 는 단위 벡터, radius/tan 은 placement plane 에서 apex 까지 거리)
    let dist = if radius > 0.0 { radius / semi_angle.tan() } else { 0.0 };
    let apex = [
        placement.location[0] - placement.axis[0] * dist,
        placement.location[1] - placement.axis[1] * dist,
        placement.location[2] - placement.axis[2] * dist,
    ];

    Ok(SurfacePromotion::Cone {
        apex,
        axis_dir: placement.axis,
        half_angle: semi_angle,
        uv_bounds: None,
    })
}

/// `TOROIDAL_SURFACE('', placement_ref, major_radius, minor_radius)`
/// → `SurfacePromotion::Torus`.
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D, arg[2] = major_radius (center →
/// tube center), arg[3] = minor_radius (tube radius).
///
/// Spec: `major_radius > minor_radius > 0` (proper torus).
/// Degenerate (major ≤ minor) 는 self-intersection — Tessellate fallback.
fn promote_step_torus(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("TOROIDAL_SURFACE arg[1] (placement) not a ref", entity_id))?;
    let major_radius = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("TOROIDAL_SURFACE arg[2] (major_radius) not a real", entity_id))?;
    let minor_radius = entity.args.get(3)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("TOROIDAL_SURFACE arg[3] (minor_radius) not a real", entity_id))?;
    if minor_radius <= 0.0 {
        return Err(ResolveError::at(
            format!("TOROIDAL_SURFACE minor_radius must be positive, got {}", minor_radius),
            entity_id,
        ));
    }
    if major_radius <= minor_radius {
        return Err(ResolveError::at(
            format!("TOROIDAL_SURFACE expects major_radius ({}) > minor_radius ({}) — degenerate (self-intersection)",
                major_radius, minor_radius),
            entity_id,
        ));
    }
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    Ok(SurfacePromotion::Torus {
        center: placement.location,
        axis: placement.axis,
        major_radius,
        minor_radius,
        uv_bounds: None,
    })
}

/// Extract NURBS-form (control_pts, weights, knots, degree) from a basis
/// curve referenced by a STEP sweep entity.
///
/// Supports: Line, Circle, BSpline (non-rational), Nurbs (rational).
/// Other curve kinds → ResolveError ("unsupported sweep profile").
fn extract_profile_nurbs_form(
    file: &StepFile,
    curve_ref: u32,
    cache: &mut ResolveCache,
) -> Result<(Vec<[f64; 3]>, Vec<f64>, Vec<f64>, usize), ResolveError> {
    use crate::promote_curve::{promote_step_curve, CurvePromotion};

    let promo = promote_step_curve(file, curve_ref, cache);
    let promotion = promo.promotion.ok_or_else(|| ResolveError::at(
        "sweep profile curve promote returned None", curve_ref,
    ))?;

    match promotion {
        CurvePromotion::Line { start, end, .. } => {
            // Line: 2 CPs, knots [0, 0, 1, 1], degree 1, weights [1, 1]
            Ok((
                vec![start, end],
                vec![1.0, 1.0],
                vec![0.0, 0.0, 1.0, 1.0],
                1,
            ))
        }
        CurvePromotion::Circle { center, normal, radius, .. } => {
            // Circle → Piegl A7.1 9-CP rational quadratic NURBS.
            // 본 함수는 surface_of_revolution / extrusion 의 profile 로
            // 사용. axis frame 은 normal (z) 와 임의 perpendicular 로 구성.
            let s = std::f64::consts::FRAC_1_SQRT_2;
            // 임의 perpendicular: normal 과 가장 다른 cardinal axis 로 cross.
            let arb = if normal[0].abs() < 0.9 { [1.0, 0.0, 0.0] }
                      else { [0.0, 1.0, 0.0] };
            let x_axis_unscaled = [
                normal[1] * arb[2] - normal[2] * arb[1],
                normal[2] * arb[0] - normal[0] * arb[2],
                normal[0] * arb[1] - normal[1] * arb[0],
            ];
            let len = (x_axis_unscaled[0].powi(2) + x_axis_unscaled[1].powi(2)
                    + x_axis_unscaled[2].powi(2)).sqrt();
            if len < 1e-12 {
                return Err(ResolveError::at(
                    "Circle profile normal degenerate", curve_ref,
                ));
            }
            let x_axis = [
                radius * x_axis_unscaled[0] / len,
                radius * x_axis_unscaled[1] / len,
                radius * x_axis_unscaled[2] / len,
            ];
            // y_axis = normal × x_axis_unit, scaled by radius
            let xu = [x_axis[0] / radius, x_axis[1] / radius, x_axis[2] / radius];
            let y_axis = [
                radius * (normal[1] * xu[2] - normal[2] * xu[1]),
                radius * (normal[2] * xu[0] - normal[0] * xu[2]),
                radius * (normal[0] * xu[1] - normal[1] * xu[0]),
            ];
            let nurbs = crate::conic_converter::full_ellipse_to_nurbs(
                center, x_axis, y_axis,
            );
            Ok((nurbs.control_pts, nurbs.weights, nurbs.knots, nurbs.degree))
        }
        CurvePromotion::BSpline { control_pts, knots, degree, .. } => {
            let n = control_pts.len();
            let weights = vec![1.0; n];
            Ok((control_pts, weights, knots, degree))
        }
        CurvePromotion::Nurbs { control_pts, weights, knots, degree, .. } => {
            Ok((control_pts, weights, knots, degree))
        }
        other => Err(ResolveError::at(
            format!("sweep profile curve unsupported variant: {:?}", other),
            curve_ref,
        )),
    }
}

/// `SURFACE_OF_LINEAR_EXTRUSION('', basis_curve_ref, vector_ref)`
/// → tensor-product NURBS surface (Piegl A8.2).
///
/// AP203:
/// - arg[1] = basis_curve_ref (LINE / CIRCLE / B_SPLINE_CURVE_WITH_KNOTS)
/// - arg[2] = VECTOR ref (direction × magnitude)
fn promote_step_surface_of_linear_extrusion(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    use crate::sweep_converter::linear_extrusion_to_nurbs;

    let basis_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "SURFACE_OF_LINEAR_EXTRUSION arg[1] (basis_curve) not a ref", entity_id,
        ))?;
    let vector_ref = entity.args.get(2)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "SURFACE_OF_LINEAR_EXTRUSION arg[2] (vector) not a ref", entity_id,
        ))?;

    let (profile_pts, profile_weights, profile_knots, profile_degree) =
        extract_profile_nurbs_form(file, basis_ref, cache)?;

    let (direction, magnitude) =
        crate::step_resolver::resolve_vector(file, vector_ref)?;

    let sweep = linear_extrusion_to_nurbs(
        &profile_pts, &profile_weights, &profile_knots, profile_degree,
        direction, magnitude,
    );

    Ok(SurfacePromotion::NurbsSurface {
        ctrl_grid: sweep.ctrl_grid,
        weights_grid: sweep.weights_grid,
        knots_u: sweep.knots_u,
        knots_v: sweep.knots_v,
        deg_u: sweep.deg_u,
        deg_v: sweep.deg_v,
        uv_bounds: None,
    })
}

/// `SURFACE_OF_REVOLUTION('', basis_curve_ref, axis1_placement_ref)`
/// → tensor-product NURBS surface (Piegl A8.1, full 360°).
///
/// AP203:
/// - arg[1] = basis_curve_ref
/// - arg[2] = AXIS1_PLACEMENT ref (origin + direction — 회전 축)
///
/// Note: STEP 의 SURFACE_OF_REVOLUTION 은 항상 360° (no angle parameter
/// in entity). Partial revolution 은 RECTANGULAR_TRIMMED_SURFACE wrapper
/// 가 처리.
fn promote_step_surface_of_revolution(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<SurfacePromotion, ResolveError> {
    use crate::sweep_converter::full_revolution_to_nurbs;

    let basis_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "SURFACE_OF_REVOLUTION arg[1] (basis_curve) not a ref", entity_id,
        ))?;
    let axis1_ref = entity.args.get(2)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "SURFACE_OF_REVOLUTION arg[2] (axis1_placement) not a ref", entity_id,
        ))?;

    let (profile_pts, profile_weights, profile_knots, profile_degree) =
        extract_profile_nurbs_form(file, basis_ref, cache)?;

    // AXIS1_PLACEMENT('', loc_ref, dir_ref?) — arg[1] = location, arg[2] = direction (optional, default Z)
    let axis_entity = file.entity(axis1_ref).ok_or_else(|| ResolveError::at(
        format!("AXIS1_PLACEMENT #{} not found", axis1_ref), entity_id,
    ))?;
    let loc_ref = axis_entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "AXIS1_PLACEMENT arg[1] (location) not a ref", axis1_ref,
        ))?;
    let axis_origin = cache.cartesian_point(file, loc_ref)?;

    let axis_dir = match axis_entity.args.get(2) {
        Some(Value::Ref(r)) => crate::step_resolver::resolve_direction(file, *r)?,
        Some(Value::Null) | None => [0.0, 0.0, 1.0],  // spec default
        Some(other) => return Err(ResolveError::at(
            format!("AXIS1_PLACEMENT arg[2] (direction) unexpected: {:?}", other),
            axis1_ref,
        )),
    };

    let sweep = full_revolution_to_nurbs(
        &profile_pts, &profile_weights, &profile_knots, profile_degree,
        axis_origin, axis_dir,
    );

    Ok(SurfacePromotion::NurbsSurface {
        ctrl_grid: sweep.ctrl_grid,
        weights_grid: sweep.weights_grid,
        knots_u: sweep.knots_u,
        knots_v: sweep.knots_v,
        deg_u: sweep.deg_u,
        deg_v: sweep.deg_v,
        uv_bounds: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_kinds_matches_adr_036_p21_2_count() {
        // ADR-036 P21.2 = 12항목 (Direct 8 + Sweep 2 + Fitting 1 + Trim 1)
        assert_eq!(SUPPORTED_SURFACE_KINDS.len(), 12);
    }

    #[test]
    fn supported_kinds_does_not_contain_unsupported() {
        assert!(!SUPPORTED_SURFACE_KINDS.contains(&ForeignSurfaceKind::Unsupported));
    }

    #[test]
    fn supported_kinds_matches_stage_4a_order() {
        let expected = [
            ForeignSurfaceKind::Plane,
            ForeignSurfaceKind::Cylinder,
            ForeignSurfaceKind::Sphere,
            ForeignSurfaceKind::Cone,
            ForeignSurfaceKind::Torus,
            ForeignSurfaceKind::BezierSurface,
            ForeignSurfaceKind::BSplineSurface,
            ForeignSurfaceKind::NurbsSurface,
            ForeignSurfaceKind::SurfaceOfRevolution,
            ForeignSurfaceKind::SurfaceOfLinearExtrusion,
            ForeignSurfaceKind::OffsetSurface,
            ForeignSurfaceKind::RectangularTrimmedSurface,
        ];
        assert_eq!(SUPPORTED_SURFACE_KINDS, expected);
    }

    #[test]
    fn promote_returns_tessellate_with_warnings_for_stub() {
        let result = promote(ForeignSurfaceKind::Plane);
        assert!(!result.warnings.is_empty());
        match result.promotion {
            Some(SurfacePromotion::Tessellate { reason, .. }) => {
                assert!(reason.contains("not yet wired"));
            }
            _ => panic!("expected Tessellate fallback for stub"),
        }
    }

    #[test]
    fn promote_unsupported_includes_warning() {
        let result = promote(ForeignSurfaceKind::Unsupported);
        assert!(result.warnings.iter().any(|w| w.contains("unsupported")));
    }

    // ─── A-4: promote_step_surface direct mapping tests ────────────────────

    use crate::step_parser::parse;

    fn minimal(data_body: &str) -> String {
        format!(
            "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('test'),'2;1');\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
            data_body
        )
    }

    fn approx_eq3(a: [f64; 3], b: [f64; 3], eps: f64) -> bool {
        (0..3).all(|i| (a[i] - b[i]).abs() < eps)
    }

    #[test]
    fn promote_step_plane_xy() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (1., 2., 3.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = PLANE('', #4);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::Plane { origin, normal, uv_bounds } => {
                assert!(approx_eq3(origin, [1., 2., 3.], 1e-12));
                assert!(approx_eq3(normal, [0., 0., 1.], 1e-12));
                assert_eq!(uv_bounds, None);
            }
            other => panic!("expected Plane, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_plane_default_directions() {
        // $ defaults: axis = +z, ref_dir = +x
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = PLANE('', #2);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            SurfacePromotion::Plane { normal, .. } => {
                assert!(approx_eq3(normal, [0., 0., 1.], 1e-12));
            }
            _ => panic!("expected Plane"),
        }
    }

    #[test]
    fn promote_step_cylinder_basic() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (10., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 1., 0.));\n",       // axis = +y
            "#3 = DIRECTION('', (1., 0., 0.));\n",       // ref_dir = +x
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = CYLINDRICAL_SURFACE('', #4, 7.5);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::Cylinder {
                axis_origin, axis_dir, ref_dir, radius, uv_bounds,
            } => {
                assert!(approx_eq3(axis_origin, [10., 0., 0.], 1e-12));
                assert!(approx_eq3(axis_dir, [0., 1., 0.], 1e-12));
                assert!(approx_eq3(ref_dir, [1., 0., 0.], 1e-12));
                assert_eq!(radius, 7.5);
                assert_eq!(uv_bounds, None);
            }
            other => panic!("expected Cylinder, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_cylinder_zero_radius_errors() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = CYLINDRICAL_SURFACE('', #2, 0.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("must be positive")));
    }

    #[test]
    fn promote_step_surface_missing_entity() {
        let f = parse(&minimal("")).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 999, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("not found")));
    }

    #[test]
    fn promote_step_surface_unsupported_kind() {
        // B6 (2026-05-01): SURFACE_OF_REVOLUTION / SURFACE_OF_LINEAR_EXTRUSION
        // 모두 wired. 이제 OFFSET_SURFACE / RECTANGULAR_TRIMMED_SURFACE 가 unsupported.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = PLANE('', #2);\n",
            "#4 = OFFSET_SURFACE('', #3, 1.0, .T.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 4, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("not yet wired")));
    }

    // ─── B6: Sweep variants (Piegl A8.1, A8.2) ───────────────────────

    #[test]
    fn promote_step_linear_extrusion_of_line_creates_quad() {
        // Profile = LINE from (0,0,0) → (1,0,0), extrude +Z by 5
        // → 2 × 2 control grid (bilinear surface)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = VECTOR('', #2, 1.0);\n",
            "#4 = LINE('', #1, #3);\n",
            "#5 = DIRECTION('', (0., 0., 1.));\n",
            "#6 = VECTOR('', #5, 5.0);\n",
            "#7 = SURFACE_OF_LINEAR_EXTRUSION('', #4, #6);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 7, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::NurbsSurface {
                ctrl_grid, knots_u, knots_v, deg_u, deg_v, ..
            } => {
                assert_eq!(ctrl_grid.len(), 2);  // 2 v-rows (extrusion direction)
                assert_eq!(ctrl_grid[0].len(), 2);  // 2 profile CPs (line)
                // Row 0 = profile
                assert!(approx_eq3(ctrl_grid[0][0], [0., 0., 0.], 1e-12));
                assert!(approx_eq3(ctrl_grid[0][1], [1., 0., 0.], 1e-12));
                // Row 1 = profile + 5*Z
                assert!(approx_eq3(ctrl_grid[1][0], [0., 0., 5.], 1e-12));
                assert!(approx_eq3(ctrl_grid[1][1], [1., 0., 5.], 1e-12));
                assert_eq!(knots_v, vec![0.0, 0.0, 1.0, 1.0]);
                assert_eq!(deg_u, 1);
                assert_eq!(deg_v, 1);
            }
            other => panic!("expected NurbsSurface, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_revolution_of_offset_point_creates_torus_like_ring() {
        // Profile = LINE from (3, 0, 0) (length 0 actually, just a point-line)
        // axis = Z axis at origin → revolution creates a circle of radius 3
        //
        // 단순화: profile 이 너무 작아서 line 으로 한다.
        // Line from (3,0,0) to (3,0,1), revolve around +Z → cylinder
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (3., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = VECTOR('', #2, 1.0);\n",
            "#4 = LINE('', #1, #3);\n",
            "#5 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#6 = AXIS1_PLACEMENT('', #5, #2);\n",  // origin + Z dir
            "#7 = SURFACE_OF_REVOLUTION('', #4, #6);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 7, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::NurbsSurface {
                ctrl_grid, knots_v, deg_v, ..
            } => {
                // 2 profile CPs (line endpoints) × 9 v-CPs (full circle) = 2x9 grid
                assert_eq!(ctrl_grid.len(), 2);
                assert_eq!(ctrl_grid[0].len(), 9);
                assert_eq!(deg_v, 2);
                assert_eq!(knots_v.len(), 12);

                // Bottom ring: at z=0, radius 3
                assert!(approx_eq3(ctrl_grid[0][0], [3., 0., 0.], 1e-12));
                assert!(approx_eq3(ctrl_grid[0][2], [0., 3., 0.], 1e-12));
                assert!(approx_eq3(ctrl_grid[0][4], [-3., 0., 0.], 1e-12));

                // Top ring: at z=1, radius 3 (line endpoints both at radius 3)
                assert!(approx_eq3(ctrl_grid[1][0], [3., 0., 1.], 1e-12));
                assert!(approx_eq3(ctrl_grid[1][2], [0., 3., 1.], 1e-12));
            }
            other => panic!("expected NurbsSurface, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_revolution_default_axis_dir() {
        // AXIS1_PLACEMENT 의 dir 가 $ → spec default +Z 사용
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (2., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = VECTOR('', #2, 1.0);\n",
            "#4 = LINE('', #1, #3);\n",
            "#5 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#6 = AXIS1_PLACEMENT('', #5, $);\n",  // default direction
            "#7 = SURFACE_OF_REVOLUTION('', #4, #6);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 7, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            SurfacePromotion::NurbsSurface { ctrl_grid, .. } => {
                // Default Z axis revolution → bottom ring at z=0, top at z=1
                assert!(approx_eq3(ctrl_grid[0][0], [2., 0., 0.], 1e-12));
                assert!(approx_eq3(ctrl_grid[1][0], [2., 0., 1.], 1e-12));
            }
            _ => panic!("expected NurbsSurface"),
        }
    }

    // ─── B1 신규 — Sphere / Cone / Torus 매핑 ─────────────────────────────

    #[test]
    fn promote_step_sphere_basic() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (10., 20., 30.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = SPHERICAL_SURFACE('', #2, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::Sphere { center, radius, uv_bounds } => {
                assert!(approx_eq3(center, [10., 20., 30.], 1e-12));
                assert_eq!(radius, 5.0);
                assert_eq!(uv_bounds, None);
            }
            other => panic!("expected Sphere, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_sphere_negative_radius_errors() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = SPHERICAL_SURFACE('', #2, -1.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("must be positive")));
    }

    #[test]
    fn promote_step_cone_apex_calculated() {
        // Cone: placement at origin, axis = +Z, ref radius = 5, semi_angle = 45°.
        // Apex 거리 = radius / tan(45°) = 5
        // Apex = location - axis × 5 = (0, 0, 0) - (0, 0, 1) × 5 = (0, 0, -5)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = CONICAL_SURFACE('', #4, 5.0, 0.7853981633974483);"  // π/4
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::Cone { apex, axis_dir, half_angle, .. } => {
                assert!(approx_eq3(apex, [0., 0., -5.], 1e-9), "apex: {:?}", apex);
                assert!(approx_eq3(axis_dir, [0., 0., 1.], 1e-12));
                assert!((half_angle - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
            }
            other => panic!("expected Cone, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_cone_invalid_semi_angle_errors() {
        // semi_angle = 0 → degenerate (line)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = CONICAL_SURFACE('', #2, 5.0, 0.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("semi_angle")));
    }

    #[test]
    fn promote_step_torus_basic() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (1., 2., 3.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = TOROIDAL_SURFACE('', #4, 10.0, 2.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            SurfacePromotion::Torus { center, axis, major_radius, minor_radius, .. } => {
                assert!(approx_eq3(center, [1., 2., 3.], 1e-12));
                assert!(approx_eq3(axis, [0., 0., 1.], 1e-12));
                assert_eq!(major_radius, 10.0);
                assert_eq!(minor_radius, 2.0);
            }
            other => panic!("expected Torus, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_torus_degenerate_self_intersection_errors() {
        // major <= minor → torus self-intersection
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = TOROIDAL_SURFACE('', #2, 2.0, 5.0);"  // major < minor
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_surface(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(SurfacePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("self-intersection")));
    }
}
