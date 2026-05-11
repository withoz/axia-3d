//! STEP / IGES curve entity → `axia_geo::AnalyticCurve` promotion
//! (Stage 4-B 자체 파서 경로, ADR-036 P21.1 매핑 표).
//!
//! **본 모듈은 ADR-036 P21.1 매핑 표의 Rust SSOT.**
//!
//! Stage 4-A (TS, OCCT.js) 의 `web/src/import/occtCurvePromote.ts` 와
//! 동일 enum + 동일 dispatch 사용 — cross-validation harness 가
//! type-safe 하게 두 경로를 비교 (ADR-035 P20.E #2, ADR-036 P21.8).
//!
//! ## 매핑 표 (ADR-036 P21.1, 11항목)
//!
//! | STEP entity / IGES type | → AnalyticCurve | 변환 |
//! |---|---|---|
//! | `LINE` (STEP) / IGES Type 110 | `Line` | direct |
//! | `CIRCLE` (full) / IGES Type 100 (full) | `Circle` | direct |
//! | `TRIMMED_CURVE(CIRCLE)` / IGES Type 100 (arc) | `Arc` | trim range → angles |
//! | `BEZIER_CURVE` | `Bezier` | direct |
//! | `B_SPLINE_CURVE_WITH_KNOTS` (rational=false) | `BSpline` | direct |
//! | `B_SPLINE_CURVE_WITH_KNOTS` (rational=true) / IGES Type 126 | `NURBS` | direct |
//! | `ELLIPSE` | `NURBS` (Piegl A7.1, rational quadratic 9-CP) | conversion |
//! | `PARABOLA` | `Bezier` (Piegl A7.4, quadratic) | conversion |
//! | `HYPERBOLA` | `NURBS` (Piegl A7.5, rational quadratic) | conversion |
//! | `OFFSET_CURVE` | `BSpline` (sampled fitting) | fitting fallback |
//! | `TRIMMED_CURVE(parent ≠ CIRCLE)` | parent + trim sub-range | indirect |

use serde::{Deserialize, Serialize};

use crate::step::classify_curve_entity;
use crate::step_parser::{Entity, StepFile, Value};
use crate::step_resolver::{
    self, Axis2Placement3D, ResolveCache, ResolveError,
    resolve_real_list, resolve_ref_list, resolve_uint_list,
};

/// STEP / IGES curve entity 의 runtime 식별자 (ADR-036 P21.1 매핑 키).
///
/// Stage 4-A `OcctCurveKind` 와 1:1 대응 — cross-validation 시 동일 키로
/// dispatch 가능.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForeignCurveKind {
    Line,
    Circle,
    Arc,
    Bezier,
    BSpline,
    Nurbs,
    Ellipse,
    Parabola,
    Hyperbola,
    OffsetCurve,
    TrimmedCurve,
    Unsupported,
}

/// Parameter range — `[t_first, t_last]` (P21.5 정합).
pub type ParameterRange = [f64; 2];

/// Promotion 결과 — caller 가 `axia_geo::Mesh::set_edge_*_curve` API 로 dispatch.
///
/// 모든 variant 는 optional `parameter_range` 를 가진다 (Stage 4-A
/// `CurvePromotion` 와 정합).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CurvePromotion {
    Line {
        start: [f64; 3],
        end: [f64; 3],
        parameter_range: Option<ParameterRange>,
    },
    Circle {
        center: [f64; 3],
        normal: [f64; 3],
        radius: f64,
        parameter_range: Option<ParameterRange>,
    },
    Arc {
        center: [f64; 3],
        axis: [f64; 3],
        ref_dir: [f64; 3],
        radius: f64,
        start_angle: f64,
        end_angle: f64,
        parameter_range: Option<ParameterRange>,
    },
    Bezier {
        control_pts: Vec<[f64; 3]>,
        parameter_range: Option<ParameterRange>,
    },
    BSpline {
        control_pts: Vec<[f64; 3]>,
        knots: Vec<f64>,
        degree: usize,
        parameter_range: Option<ParameterRange>,
    },
    Nurbs {
        control_pts: Vec<[f64; 3]>,
        weights: Vec<f64>,
        knots: Vec<f64>,
        degree: usize,
        parameter_range: Option<ParameterRange>,
    },
    Tessellate {
        reason: String,
        parameter_range: Option<ParameterRange>,
    },
}

/// Promotion 호출 결과 wrapper (ADR-036 P21.7 warnings 누적).
#[derive(Clone, Debug, Default)]
pub struct CurvePromotionResult {
    pub promotion: Option<CurvePromotion>,
    pub warnings: Vec<String>,
}

/// Promotion dispatch (스텁 — STEP/IGES 파서 통합 후 본체 작성).
///
/// `entity_kind` 는 STEP entity tag 또는 IGES Type 번호로부터 식별된 결과.
pub fn promote(entity_kind: ForeignCurveKind) -> CurvePromotionResult {
    let mut warnings = Vec::new();
    let promotion = match entity_kind {
        ForeignCurveKind::Unsupported => {
            let reason = format!("Foreign curve entity unsupported (kind={:?})", entity_kind);
            warnings.push(reason.clone());
            Some(CurvePromotion::Tessellate { reason, parameter_range: None })
        }
        // TODO (Stage 4-B 본체):
        // - Line:        STEP CARTESIAN_POINT pair → Line
        // - Circle/Arc:  STEP AXIS2_PLACEMENT_3D + radius
        // - Bezier:      STEP BEZIER_CURVE → control_pts
        // - BSpline:     STEP B_SPLINE_CURVE_WITH_KNOTS (rational=false)
        // - Nurbs:       STEP B_SPLINE_CURVE_WITH_KNOTS (rational=true) /
        //                IGES Type 126
        // - Ellipse:     STEP ELLIPSE → Piegl A7.1 conversion (occt_conic_converter
        //                와 동일 알고리즘 사용 — Stage 4-A / 4-B cross-validate)
        // - Parabola:    STEP PARABOLA → Piegl A7.4
        // - Hyperbola:   STEP HYPERBOLA → Piegl A7.5
        // - OffsetCurve: 샘플 fitting + 1e-3 mm 검증
        // - TrimmedCurve: parent promote + sub-range
        _ => {
            warnings.push(format!("promote {:?} not yet wired", entity_kind));
            Some(CurvePromotion::Tessellate {
                reason: format!("{:?} promotion not yet wired", entity_kind),
                parameter_range: None,
            })
        }
    };
    CurvePromotionResult { promotion, warnings }
}

/// 본 모듈이 처리하는 STEP/IGES curve 종류 SSOT.
///
/// **이 배열은 Stage 4-A `SUPPORTED_CURVE_KINDS` (TS) 와 동일 길이/순서**.
/// ADR-036 P21.1 매핑 표 변경 시 양쪽이 동시 갱신되어야 함.
pub const SUPPORTED_CURVE_KINDS: &[ForeignCurveKind] = &[
    ForeignCurveKind::Line,
    ForeignCurveKind::Circle,
    ForeignCurveKind::Arc,
    ForeignCurveKind::Bezier,
    ForeignCurveKind::BSpline,
    ForeignCurveKind::Nurbs,
    ForeignCurveKind::Ellipse,
    ForeignCurveKind::Parabola,
    ForeignCurveKind::Hyperbola,
    ForeignCurveKind::OffsetCurve,
    ForeignCurveKind::TrimmedCurve,
];

// ────────────────────────────────────────────────────────────────────────
// STEP → CurvePromotion 본체 (A-4, ADR-036 P21.1 직접 매핑)
// ────────────────────────────────────────────────────────────────────────

/// STEP file 의 curve entity 를 promote.
///
/// `entity_id` 가 가리키는 entity 의 tag 로 dispatch:
/// - `LINE` → `promote_step_line`
/// - `CIRCLE` → `promote_step_circle` (full circle 또는 Arc 자동 분기)
/// - `B_SPLINE_CURVE_WITH_KNOTS` → `promote_step_bspline_curve` (non-rational)
/// - 기타 (Bezier / Conic conversion / OffsetCurve / TrimmedCurve / Rational)
///   → `Tessellate` fallback + warning (후속 PR 에서 채움)
///
/// 모든 dispatch 실패 / fallback 은 warnings 에 누적됨.
pub fn promote_step_curve(
    file: &StepFile,
    entity_id: u32,
    cache: &mut ResolveCache,
) -> CurvePromotionResult {
    let mut warnings = Vec::new();
    let entity = match file.entity(entity_id) {
        Some(e) => e,
        None => {
            let reason = format!("entity #{} not found", entity_id);
            warnings.push(reason.clone());
            return CurvePromotionResult {
                promotion: Some(CurvePromotion::Tessellate { reason, parameter_range: None }),
                warnings,
            };
        }
    };
    let kind = classify_curve_entity(&entity.tag);

    let result = match kind {
        ForeignCurveKind::Line => promote_step_line(file, entity_id, entity, cache),
        ForeignCurveKind::Circle => promote_step_circle(file, entity_id, entity, cache),
        ForeignCurveKind::BSpline => promote_step_bspline_curve(file, entity_id, entity, cache),
        ForeignCurveKind::TrimmedCurve => promote_step_trimmed_curve(file, entity_id, entity, cache),
        ForeignCurveKind::Ellipse => promote_step_ellipse(file, entity_id, entity, cache),
        // Other kinds defer to follow-up PR.
        other => Err(ResolveError::at(
            format!("promote_step_{:?} not yet wired (A-4 follow-up)", other),
            entity_id,
        )),
    };

    match result {
        Ok(promotion) => CurvePromotionResult {
            promotion: Some(promotion),
            warnings,
        },
        Err(err) => {
            let reason = err.message.clone();
            warnings.push(err.into_warning());
            CurvePromotionResult {
                promotion: Some(CurvePromotion::Tessellate { reason, parameter_range: None }),
                warnings,
            }
        }
    }
}

/// `LINE('', point_ref, vector_ref)` → `CurvePromotion::Line`.
///
/// AP203: arg[0] = name, arg[1] = pnt (CARTESIAN_POINT ref),
///        arg[2] = dir (VECTOR ref).
///
/// LINE 자체는 무한 직선이므로 trim 없이 호출되면 unit-magnitude 의 두
/// 점만 반환. TRIMMED_CURVE wrapper 가 trim range 결정.
fn promote_step_line(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    let pnt_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("LINE arg[1] (pnt) not a ref", entity_id))?;
    let vec_ref = entity.args.get(2)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("LINE arg[2] (dir) not a ref", entity_id))?;

    let start = cache.cartesian_point(file, pnt_ref)?;
    let (dir, mag) = step_resolver::resolve_vector(file, vec_ref)?;

    // Default: end = start + dir × (mag if > 0 else 1.0)
    // (mag == 0 인 STEP 파일이 드물게 존재 → unit-length fallback 으로 ill-defined
    // line 회피)
    let length = if mag > 0.0 { mag } else { 1.0 };
    let end = [
        start[0] + dir[0] * length,
        start[1] + dir[1] * length,
        start[2] + dir[2] * length,
    ];

    Ok(CurvePromotion::Line {
        start,
        end,
        parameter_range: Some([0.0, length]),
    })
}

/// `CIRCLE('', placement_ref, radius)` → `CurvePromotion::Circle` (또는 Arc).
///
/// AP203: arg[1] = AXIS2_PLACEMENT_3D ref, arg[2] = radius (positive Real).
///
/// Trim 없이 호출되면 full circle. TRIMMED_CURVE wrapper 가 Arc 변환.
fn promote_step_circle(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("CIRCLE arg[1] (placement) not a ref", entity_id))?;
    let radius = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("CIRCLE arg[2] (radius) not a real", entity_id))?;
    if radius <= 0.0 {
        return Err(ResolveError::at(
            format!("CIRCLE radius must be positive, got {}", radius),
            entity_id,
        ));
    }
    let placement: Axis2Placement3D = cache.placement(file, placement_ref)?;

    // Circle on placement.axis (z) plane, centered at placement.location.
    // ref_direction (x) is start angle = 0.
    // Full circle: parameter range [0, 2π].
    Ok(CurvePromotion::Circle {
        center: placement.location,
        normal: placement.axis,
        radius,
        parameter_range: Some([0.0, std::f64::consts::TAU]),
    })
}

/// `B_SPLINE_CURVE_WITH_KNOTS` → `CurvePromotion::BSpline`.
///
/// AP203 인자 순서:
/// - arg[0] = name
/// - arg[1] = degree (Int)
/// - arg[2] = control_points_list (list of CARTESIAN_POINT refs)
/// - arg[3] = curve_form (Enum: POLYLINE_FORM / CIRCULAR_ARC / ... / UNSPECIFIED)
/// - arg[4] = closed_curve (Enum: .T. / .F.)
/// - arg[5] = self_intersect (Enum: .T. / .F. / .UNKNOWN.)
/// - arg[6] = knot_multiplicities (list of Int)
/// - arg[7] = knots (list of Real, unique values)
/// - arg[8] = knot_spec (Enum: PIECEWISE_BEZIER_KNOTS / UNIFORM_KNOTS / ...)
///
/// AP203 의 `knots` + `knot_multiplicities` 는 compact form. 우리
/// `AnalyticCurve::BSpline` 은 expanded form (`knots[i]` 가 도메인 전체)
/// 사용 → expand 함수로 변환.
fn promote_step_bspline_curve(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    let degree = entity.args.get(1)
        .and_then(|v| match v {
            Value::Int(n) if *n >= 1 => Some(*n as usize),
            _ => None,
        })
        .ok_or_else(|| ResolveError::at(
            "B_SPLINE_CURVE_WITH_KNOTS arg[1] (degree) not positive integer",
            entity_id,
        ))?;
    let cp_refs_value = entity.args.get(2)
        .ok_or_else(|| ResolveError::at(
            "B_SPLINE_CURVE_WITH_KNOTS arg[2] (control_points) missing",
            entity_id,
        ))?;
    let cp_refs = resolve_ref_list(cp_refs_value)
        .map_err(|e| ResolveError::at(
            format!("control_points: {}", e.message), entity_id,
        ))?;
    let mut control_pts = Vec::with_capacity(cp_refs.len());
    for r in &cp_refs {
        control_pts.push(cache.cartesian_point(file, *r)?);
    }

    let mults_value = entity.args.get(6).ok_or_else(|| ResolveError::at(
        "B_SPLINE_CURVE_WITH_KNOTS arg[6] (knot_multiplicities) missing",
        entity_id,
    ))?;
    let mults = resolve_uint_list(mults_value)
        .map_err(|e| ResolveError::at(
            format!("knot_multiplicities: {}", e.message), entity_id,
        ))?;

    let knots_value = entity.args.get(7).ok_or_else(|| ResolveError::at(
        "B_SPLINE_CURVE_WITH_KNOTS arg[7] (knots) missing",
        entity_id,
    ))?;
    let unique_knots = resolve_real_list(knots_value)
        .map_err(|e| ResolveError::at(
            format!("knots: {}", e.message), entity_id,
        ))?;

    if mults.len() != unique_knots.len() {
        return Err(ResolveError::at(
            format!(
                "knot_multiplicities ({}) and knots ({}) length mismatch",
                mults.len(), unique_knots.len()
            ),
            entity_id,
        ));
    }

    // Expand compact form → full knot vector.
    let knots = expand_knots(&unique_knots, &mults);

    // Validation (axia-geo bspline::validate 와 동일 invariant):
    // length(knots) == n_ctrl + degree + 1
    let expected_knot_len = control_pts.len() + degree + 1;
    if knots.len() != expected_knot_len {
        return Err(ResolveError::at(
            format!(
                "expanded knots length {} != n_ctrl + degree + 1 = {}",
                knots.len(), expected_knot_len
            ),
            entity_id,
        ));
    }

    let parameter_range = if knots.len() >= degree + 2 {
        Some([knots[degree], knots[knots.len() - degree - 1]])
    } else {
        None
    };

    Ok(CurvePromotion::BSpline {
        control_pts,
        knots,
        degree,
        parameter_range,
    })
}

/// `ELLIPSE('', placement_ref, semi_axis_1, semi_axis_2)` → `Nurbs` (Piegl A7.1).
///
/// AP203 인자:
/// - arg[1] = AXIS2_PLACEMENT_3D ref (center + axis (z) + ref_dir (x))
/// - arg[2] = semi_axis_1 (semi-major along ref_dir, positive Real)
/// - arg[3] = semi_axis_2 (semi-minor perpendicular, positive Real)
///
/// 변환 (ADR-036 P21.1, Piegl & Tiller A7.1):
/// - x_axis = ref_direction × semi_axis_1
/// - y_axis = (axis × ref_direction) × semi_axis_2
/// - 9 control points + weights `[1, √2/2, 1, ...]` + knots
///   `[0,0,0, 1/4,1/4, 1/2,1/2, 3/4,3/4, 1,1,1]`
/// - Degree 2, parameter range [0, 1] (full ellipse)
///
/// Trimmed (start/end angle): basis 의 full conversion 후 TRIMMED_CURVE
/// wrapper 가 parameter_range 갱신 (B2 logic 재활용).
fn promote_step_ellipse(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    use crate::conic_converter::full_ellipse_to_nurbs;

    let placement_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at("ELLIPSE arg[1] (placement) not a ref", entity_id))?;
    let semi_axis_1 = entity.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("ELLIPSE arg[2] (semi_axis_1) not a real", entity_id))?;
    let semi_axis_2 = entity.args.get(3)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at("ELLIPSE arg[3] (semi_axis_2) not a real", entity_id))?;

    if semi_axis_1 <= 0.0 || semi_axis_2 <= 0.0 {
        return Err(ResolveError::at(
            format!("ELLIPSE semi_axes must be positive, got ({}, {})",
                semi_axis_1, semi_axis_2),
            entity_id,
        ));
    }

    let placement = cache.placement(file, placement_ref)?;
    // x_axis = ref_dir × semi_axis_1
    let x_axis = [
        placement.ref_direction[0] * semi_axis_1,
        placement.ref_direction[1] * semi_axis_1,
        placement.ref_direction[2] * semi_axis_1,
    ];
    // y_axis = (axis × ref_dir) × semi_axis_2 — placement.y_axis() helper 사용
    let y_unit = placement.y_axis();
    let y_axis = [
        y_unit[0] * semi_axis_2,
        y_unit[1] * semi_axis_2,
        y_unit[2] * semi_axis_2,
    ];

    let nurbs = full_ellipse_to_nurbs(placement.location, x_axis, y_axis);

    Ok(CurvePromotion::Nurbs {
        control_pts: nurbs.control_pts,
        weights: nurbs.weights,
        knots: nurbs.knots,
        degree: nurbs.degree,
        parameter_range: Some([0.0, 1.0]),  // full ellipse
    })
}

/// `TRIMMED_CURVE('', basis_curve_ref, trim_1, trim_2, sense, master_representation)`
///
/// AP203 인자:
/// - arg[0] = name
/// - arg[1] = basis_curve_ref (LINE / CIRCLE / B_SPLINE_CURVE_WITH_KNOTS / ...)
/// - arg[2] = trim_1 — list 형식, 보통 PARAMETER_VALUE(t) 또는
///            CARTESIAN_POINT ref 포함 (TYPED VALUE)
/// - arg[3] = trim_2 — 동일
/// - arg[4] = sense (.T. / .F.)
/// - arg[5] = master_representation (.PARAMETER. / .CARTESIAN. /
///            .UNSPECIFIED.)
///
/// **현재 처리** (Stage 4-B MVP):
/// - basis_curve 의 promote 결과를 받음
/// - trim_1 / trim_2 에서 `PARAMETER_VALUE(t)` 추출 시도
/// - 추출 성공 시 결과의 `parameter_range` 갱신
/// - `master_representation` 가 `.CARTESIAN.` 일 때는 (현재 미지원)
///   parameter_range 그대로 → caller 가 fallback
///
/// **Circle + trim → Arc 변환**: basis 가 Circle 이고 trim 이 모두
/// PARAMETER 면 ForeignCurveKind 의 Arc 와 동치. 하지만 본 MVP 에서는
/// CurvePromotion::Circle 의 parameter_range 만 갱신 (사용자 측에서
/// Arc 로 자동 변환 가능).
fn promote_step_trimmed_curve(
    file: &StepFile,
    entity_id: u32,
    entity: &Entity,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    let basis_ref = entity.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "TRIMMED_CURVE arg[1] (basis_curve) not a ref", entity_id,
        ))?;

    // Trim parameter 추출. AP203 의 trim_1 / trim_2 는 SET[1:2] OF
    // (PARAMETER_VALUE | CARTESIAN_POINT) 형태 — 즉 list of typed values.
    let t1 = extract_trim_parameter(entity.args.get(2));
    let t2 = extract_trim_parameter(entity.args.get(3));

    // B5 follow-up — Parabola / Hyperbola 는 무한 curve 이므로 trim 파라미터
    // 가 있을 때만 변환 가능 (Piegl A7.4 / A7.5). 이 case 는 기본 dispatch
    // 보다 먼저 분기하여 specialized converter 호출.
    let basis_entity = file.entity(basis_ref);
    if let (Some(basis), Some(u1), Some(u2)) = (basis_entity, t1, t2) {
        let basis_kind = crate::step::classify_curve_entity(&basis.tag);
        match basis_kind {
            ForeignCurveKind::Parabola => {
                return promote_step_trimmed_parabola(
                    file, basis_ref, basis, u1, u2, cache,
                );
            }
            ForeignCurveKind::Hyperbola => {
                return promote_step_trimmed_hyperbola(
                    file, basis_ref, basis, u1, u2, cache,
                );
            }
            _ => {}
        }
    }

    // Recurse into basis curve. Note: P21.5 — sub-range 의 부모는 promote 시
    // parameter_range 가 None 또는 full range 로 설정되어야 함. trim_1/2
    // 가 그 위를 덮어씀.
    let mut promoted = match crate::promote_curve::promote_step_curve(file, basis_ref, cache) {
        CurvePromotionResult { promotion: Some(p), warnings } if warnings.is_empty() => p,
        CurvePromotionResult { promotion: Some(p), warnings: _ } => {
            // basis 가 Tessellate fallback 이어도 trim 적용은 시도 — caller
            // 의 follow-up 에 맡김. 본 commit 은 parameter_range 만 보존.
            p
        }
        _ => return Err(ResolveError::at(
            format!("TRIMMED_CURVE basis_curve #{} promotion failed", basis_ref),
            entity_id,
        )),
    };

    if let (Some(t1), Some(t2)) = (t1, t2) {
        // Sense flag 확인 (.T. = same direction, .F. = reversed)
        let sense = entity.args.get(4)
            .and_then(Value::as_enum)
            .map(|e| e == "T")
            .unwrap_or(true);
        let (low, high) = if sense { (t1, t2) } else { (t2, t1) };

        // CurvePromotion variant 별로 parameter_range 갱신.
        promoted = apply_parameter_range(promoted, [low, high]);
    }
    Ok(promoted)
}

/// trim_N argument (Vec<Value> as List) 에서 PARAMETER_VALUE(t) 의 t 추출.
///
/// AP203 trim 의 form: `(PARAMETER_VALUE(0.0), CARTESIAN_POINT('', (...)))`
/// 또는 `(PARAMETER_VALUE(0.0))`. CARTESIAN 만 있으면 None (현재 unsupported).
fn extract_trim_parameter(arg: Option<&Value>) -> Option<f64> {
    let list = arg?.as_list()?;
    for item in list {
        if let Value::Typed { tag, args } = item {
            if tag == "PARAMETER_VALUE" {
                if let Some(v) = args.first() {
                    return v.as_f64();
                }
            }
        }
    }
    None
}

/// CurvePromotion 의 parameter_range 필드만 교체. 다른 필드는 보존.
fn apply_parameter_range(p: CurvePromotion, range: [f64; 2]) -> CurvePromotion {
    match p {
        CurvePromotion::Line { start, end, .. } =>
            CurvePromotion::Line { start, end, parameter_range: Some(range) },
        CurvePromotion::Circle { center, normal, radius, .. } =>
            CurvePromotion::Circle { center, normal, radius, parameter_range: Some(range) },
        CurvePromotion::Arc { center, axis, ref_dir, radius, start_angle, end_angle, .. } =>
            CurvePromotion::Arc {
                center, axis, ref_dir, radius,
                start_angle, end_angle,
                parameter_range: Some(range),
            },
        CurvePromotion::Bezier { control_pts, .. } =>
            CurvePromotion::Bezier { control_pts, parameter_range: Some(range) },
        CurvePromotion::BSpline { control_pts, knots, degree, .. } =>
            CurvePromotion::BSpline {
                control_pts, knots, degree,
                parameter_range: Some(range),
            },
        CurvePromotion::Nurbs { control_pts, weights, knots, degree, .. } =>
            CurvePromotion::Nurbs {
                control_pts, weights, knots, degree,
                parameter_range: Some(range),
            },
        CurvePromotion::Tessellate { reason, .. } =>
            CurvePromotion::Tessellate { reason, parameter_range: Some(range) },
    }
}

/// `TRIMMED_CURVE(PARABOLA, ...)` → `Bezier` (Piegl A7.4).
///
/// Parabola 는 무한 curve 라 PARABOLA 단독 promote 는 Tessellate.
/// TRIMMED_CURVE wrapper 가 trim 범위를 제공하면 quadratic Bezier 변환.
///
/// STEP form: `PARABOLA('', placement_ref, focal_dist)`
/// - placement.location = vertex (apex)
/// - placement.ref_direction = axis of symmetry (opening direction = +X local)
/// - placement.axis = z (perpendicular to parabola plane)
fn promote_step_trimmed_parabola(
    file: &StepFile,
    basis_ref: u32,
    basis: &Entity,
    u1: f64,
    u2: f64,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    use crate::conic_converter::trimmed_parabola_to_bezier;

    let placement_ref = basis.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "PARABOLA arg[1] (placement) not a ref", basis_ref,
        ))?;
    let focal_dist = basis.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at(
            "PARABOLA arg[2] (focal_dist) not a real", basis_ref,
        ))?;
    if focal_dist <= 0.0 {
        return Err(ResolveError::at(
            format!("PARABOLA focal_dist must be positive, got {}", focal_dist),
            basis_ref,
        ));
    }

    let placement = cache.placement(file, placement_ref)?;
    // x_axis (local) = ref_direction (unit), y_axis = axis × ref_direction
    let bezier = trimmed_parabola_to_bezier(
        focal_dist, u1, u2,
        placement.location,
        placement.ref_direction,
        placement.y_axis(),
    );

    Ok(CurvePromotion::Bezier {
        control_pts: bezier.control_pts,
        parameter_range: Some([0.0, 1.0]),  // Bezier param [0, 1]
    })
}

/// `TRIMMED_CURVE(HYPERBOLA, ...)` → `Nurbs` rational quadratic (Piegl A7.5).
///
/// Hyperbola 단일 branch (right branch x ≥ a) 의 trim 변환.
///
/// STEP form: `HYPERBOLA('', placement_ref, semi_axis, semi_imag_axis)`
/// - semi_axis = a (real semi-axis, positive)
/// - semi_imag_axis = b (imaginary semi-axis, positive)
fn promote_step_trimmed_hyperbola(
    file: &StepFile,
    basis_ref: u32,
    basis: &Entity,
    u1: f64,
    u2: f64,
    cache: &mut ResolveCache,
) -> Result<CurvePromotion, ResolveError> {
    use crate::conic_converter::trimmed_hyperbola_to_nurbs;

    let placement_ref = basis.args.get(1)
        .and_then(Value::as_ref)
        .ok_or_else(|| ResolveError::at(
            "HYPERBOLA arg[1] (placement) not a ref", basis_ref,
        ))?;
    let semi_axis = basis.args.get(2)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at(
            "HYPERBOLA arg[2] (semi_axis) not a real", basis_ref,
        ))?;
    let semi_imag = basis.args.get(3)
        .and_then(Value::as_f64)
        .ok_or_else(|| ResolveError::at(
            "HYPERBOLA arg[3] (semi_imag_axis) not a real", basis_ref,
        ))?;
    if semi_axis <= 0.0 || semi_imag <= 0.0 {
        return Err(ResolveError::at(
            format!("HYPERBOLA semi_axes must be positive, got ({}, {})",
                semi_axis, semi_imag),
            basis_ref,
        ));
    }

    let placement = cache.placement(file, placement_ref)?;
    let nurbs = trimmed_hyperbola_to_nurbs(
        semi_axis, semi_imag, u1, u2,
        placement.location,
        placement.ref_direction,
        placement.y_axis(),
    );

    Ok(CurvePromotion::Nurbs {
        control_pts: nurbs.control_pts,
        weights: nurbs.weights,
        knots: nurbs.knots,
        degree: nurbs.degree,
        parameter_range: Some([0.0, 1.0]),  // NURBS param [0, 1]
    })
}

/// AP203 의 (unique_knots, multiplicities) 형식 → expanded knot vector.
///
/// 예: knots=[0, 0.5, 1], mults=[3, 2, 3] → [0, 0, 0, 0.5, 0.5, 1, 1, 1]
fn expand_knots(unique_knots: &[f64], mults: &[usize]) -> Vec<f64> {
    let total: usize = mults.iter().sum();
    let mut out = Vec::with_capacity(total);
    for (k, m) in unique_knots.iter().zip(mults.iter()) {
        for _ in 0..*m {
            out.push(*k);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_kinds_matches_adr_036_p21_1_count() {
        // ADR-036 P21.1 매핑 표 = 11항목 (Direct 6 + Conic 3 + Fitting 1 + Trimmed 1)
        assert_eq!(SUPPORTED_CURVE_KINDS.len(), 11);
    }

    #[test]
    fn supported_kinds_does_not_contain_unsupported() {
        assert!(!SUPPORTED_CURVE_KINDS.contains(&ForeignCurveKind::Unsupported));
    }

    #[test]
    fn supported_kinds_matches_stage_4a_order() {
        // ADR-036 P21.8 cross-validation 강제: Stage 4-A SUPPORTED_CURVE_KINDS
        // 와 동일 순서. 이 테스트가 깨지면 두 경로의 매핑이 표류한 것.
        let expected = [
            ForeignCurveKind::Line,
            ForeignCurveKind::Circle,
            ForeignCurveKind::Arc,
            ForeignCurveKind::Bezier,
            ForeignCurveKind::BSpline,
            ForeignCurveKind::Nurbs,
            ForeignCurveKind::Ellipse,
            ForeignCurveKind::Parabola,
            ForeignCurveKind::Hyperbola,
            ForeignCurveKind::OffsetCurve,
            ForeignCurveKind::TrimmedCurve,
        ];
        assert_eq!(SUPPORTED_CURVE_KINDS, expected);
    }

    #[test]
    fn promote_returns_tessellate_with_warnings_for_stub() {
        let result = promote(ForeignCurveKind::Line);
        assert!(!result.warnings.is_empty());
        match result.promotion {
            Some(CurvePromotion::Tessellate { reason, .. }) => {
                assert!(reason.contains("not yet wired"));
            }
            _ => panic!("expected Tessellate fallback for stub"),
        }
    }

    #[test]
    fn promote_unsupported_includes_warning() {
        let result = promote(ForeignCurveKind::Unsupported);
        assert!(result.warnings.iter().any(|w| w.contains("unsupported")));
    }

    // ─── A-4: promote_step_curve direct mapping tests ──────────────────────

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
    fn promote_step_line_basic() {
        // Line from (1, 2, 3) along +x with magnitude 5 → end (6, 2, 3).
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (1., 2., 3.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = VECTOR('', #2, 5.0);\n",
            "#4 = LINE('', #1, #3);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Line { start, end, parameter_range } => {
                assert!(approx_eq3(start, [1.0, 2.0, 3.0], 1e-12));
                assert!(approx_eq3(end, [6.0, 2.0, 3.0], 1e-12));
                assert_eq!(parameter_range, Some([0.0, 5.0]));
            }
            other => panic!("expected Line, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_line_zero_magnitude_uses_unit_fallback() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 1., 0.));\n",
            "#3 = VECTOR('', #2, 0.0);\n",
            "#4 = LINE('', #1, #3);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        match result.promotion.unwrap() {
            CurvePromotion::Line { start, end, parameter_range } => {
                assert!(approx_eq3(start, [0.0, 0.0, 0.0], 1e-12));
                // Falls back to unit length along DIRECTION
                assert!(approx_eq3(end, [0.0, 1.0, 0.0], 1e-12));
                assert_eq!(parameter_range, Some([0.0, 1.0]));
            }
            other => panic!("expected Line, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_circle_full_loop() {
        // Circle: center (10, 0, 0), z-axis, x-axis ref, radius 5.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (10., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = CIRCLE('', #4, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            CurvePromotion::Circle { center, normal, radius, parameter_range } => {
                assert!(approx_eq3(center, [10.0, 0.0, 0.0], 1e-12));
                assert!(approx_eq3(normal, [0.0, 0.0, 1.0], 1e-12));
                assert_eq!(radius, 5.0);
                assert_eq!(parameter_range, Some([0.0, std::f64::consts::TAU]));
            }
            other => panic!("expected Circle, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_circle_negative_radius_errors() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = CIRCLE('', #2, -1.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 3, &mut cache);
        // Returns Tessellate fallback, not panic.
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("must be positive")));
    }

    #[test]
    fn promote_step_bspline_curve_minimal() {
        // Cubic Bezier (degree 3) as B-spline: 4 control points,
        // knots [0, 0, 0, 0, 1, 1, 1, 1] = (knots [0, 1] × mults [4, 4]).
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = CARTESIAN_POINT('', (1., 1., 0.));\n",
            "#3 = CARTESIAN_POINT('', (2., 1., 0.));\n",
            "#4 = CARTESIAN_POINT('', (3., 0., 0.));\n",
            "#5 = B_SPLINE_CURVE_WITH_KNOTS('', 3, (#1, #2, #3, #4),\n",
            "    .UNSPECIFIED., .F., .F., (4, 4), (0., 1.), .UNSPECIFIED.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::BSpline { control_pts, knots, degree, parameter_range } => {
                assert_eq!(control_pts.len(), 4);
                assert!(approx_eq3(control_pts[2], [2.0, 1.0, 0.0], 1e-12));
                assert_eq!(degree, 3);
                // Expanded: [0, 0, 0, 0, 1, 1, 1, 1]
                assert_eq!(knots, vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
                assert_eq!(parameter_range, Some([0.0, 1.0]));
            }
            other => panic!("expected BSpline, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_bspline_with_interior_knots() {
        // 5 ctrl pts, degree 2, knots [0, 0.5, 1] × mults [3, 2, 3]
        // → expanded [0, 0, 0, 0.5, 0.5, 1, 1, 1] (length 8 = 5 + 2 + 1 ✓)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = CARTESIAN_POINT('', (1., 1., 0.));\n",
            "#3 = CARTESIAN_POINT('', (2., 0., 0.));\n",
            "#4 = CARTESIAN_POINT('', (3., -1., 0.));\n",
            "#5 = CARTESIAN_POINT('', (4., 0., 0.));\n",
            "#6 = B_SPLINE_CURVE_WITH_KNOTS('', 2, (#1, #2, #3, #4, #5),\n",
            "    .UNSPECIFIED., .F., .F., (3, 2, 3), (0., 0.5, 1.), .UNSPECIFIED.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 6, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::BSpline { knots, degree, parameter_range, .. } => {
                assert_eq!(degree, 2);
                assert_eq!(knots, vec![0.0, 0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0]);
                assert_eq!(parameter_range, Some([0.0, 1.0]));
            }
            _ => panic!("expected BSpline"),
        }
    }

    #[test]
    fn promote_step_bspline_count_mismatch_errors() {
        // Wrong: 4 ctrl, degree 3, but only mults sum to 7 instead of 8.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = CARTESIAN_POINT('', (1., 0., 0.));\n",
            "#3 = CARTESIAN_POINT('', (2., 0., 0.));\n",
            "#4 = CARTESIAN_POINT('', (3., 0., 0.));\n",
            "#5 = B_SPLINE_CURVE_WITH_KNOTS('', 3, (#1, #2, #3, #4),\n",
            "    .UNSPECIFIED., .F., .F., (4, 3), (0., 1.), .UNSPECIFIED.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("expanded knots length")));
    }

    #[test]
    fn promote_step_curve_missing_entity() {
        let f = parse(&minimal("")).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 999, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("not found")));
    }

    #[test]
    fn promote_step_curve_unsupported_kind() {
        // B5 follow-up (2026-05-01): PARABOLA / HYPERBOLA 는 TRIMMED_CURVE
        // wrapper 가 있을 때만 변환 가능. 단독 PARABOLA / HYPERBOLA / Bezier
        // / OffsetCurve 는 여전히 unsupported.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = OFFSET_CURVE_3D('', #2, 1.0, .T., #2);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("not yet wired")));
    }

    // ─── B5 follow-up — TRIMMED parabola / hyperbola ─────────────────

    #[test]
    fn promote_step_trimmed_parabola_to_bezier() {
        // y² = 4x (focal_dist 1), trim [-2, 2]
        // P0 = (1, -2), P1 = (-1, 0), P2 = (1, 2) [in placement frame]
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = PARABOLA('', #4, 1.0);\n",
            "#6 = TRIMMED_CURVE('', #5, (PARAMETER_VALUE(-2.0)), \
                  (PARAMETER_VALUE(2.0)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 6, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Bezier { control_pts, parameter_range } => {
                assert_eq!(control_pts.len(), 3);
                // x_axis = ref_dir = +X, y_axis = axis × ref = +Z × +X = +Y
                assert!(approx_eq3(control_pts[0], [1.0, -2.0, 0.0], 1e-12));
                assert!(approx_eq3(control_pts[1], [-1.0, 0.0, 0.0], 1e-12));
                assert!(approx_eq3(control_pts[2], [1.0, 2.0, 0.0], 1e-12));
                assert_eq!(parameter_range, Some([0.0, 1.0]));
            }
            other => panic!("expected Bezier, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_trimmed_hyperbola_to_nurbs() {
        // x² - y² = 1, trim [-1, 1]
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = HYPERBOLA('', #4, 1.0, 1.0);\n",
            "#6 = TRIMMED_CURVE('', #5, (PARAMETER_VALUE(-1.0)), \
                  (PARAMETER_VALUE(1.0)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 6, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Nurbs {
                control_pts, weights, knots, degree, parameter_range,
            } => {
                assert_eq!(control_pts.len(), 3);
                assert_eq!(weights.len(), 3);
                assert_eq!(degree, 2);
                let cosh1 = 1.0_f64.cosh();
                let sinh1 = 1.0_f64.sinh();
                assert!(approx_eq3(control_pts[0], [cosh1, -sinh1, 0.0], 1e-12));
                assert!(approx_eq3(control_pts[1], [1.0 / cosh1, 0.0, 0.0], 1e-12));
                assert!(approx_eq3(control_pts[2], [cosh1, sinh1, 0.0], 1e-12));
                assert_eq!(weights[0], 1.0);
                assert_eq!(weights[2], 1.0);
                assert!((weights[1] - cosh1).abs() < 1e-12);
                assert_eq!(knots, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
                assert_eq!(parameter_range, Some([0.0, 1.0]));
            }
            other => panic!("expected Nurbs, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_parabola_without_trim_returns_tessellate() {
        // 단독 PARABOLA → "not yet wired" Tessellate
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = PARABOLA('', #2, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
    }

    #[test]
    fn promote_step_hyperbola_negative_axis_errors() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = HYPERBOLA('', #2, -1.0, 1.0);\n",
            "#4 = TRIMMED_CURVE('', #3, (PARAMETER_VALUE(0.0)), \
                  (PARAMETER_VALUE(1.0)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("must be positive")));
    }

    #[test]
    fn expand_knots_basic() {
        let knots = expand_knots(&[0.0, 0.5, 1.0], &[3, 2, 3]);
        assert_eq!(knots, vec![0.0, 0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0]);
    }

    // ─── B2 신규 — TRIMMED_CURVE ────────────────────────────────────

    #[test]
    fn promote_step_trimmed_circle_to_arc_quarter() {
        // Circle radius 5 at origin, trimmed [0, π/2] = quarter arc.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = CIRCLE('', #4, 5.0);\n",
            "#6 = TRIMMED_CURVE('', #5, (PARAMETER_VALUE(0.0)), \
                  (PARAMETER_VALUE(1.5707963267948966)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 6, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Circle { radius, parameter_range, .. } => {
                assert_eq!(radius, 5.0);
                assert_eq!(
                    parameter_range,
                    Some([0.0, std::f64::consts::FRAC_PI_2]),
                );
            }
            other => panic!("expected Circle with trim range, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_trimmed_line_with_subrange() {
        // Line trimmed to [2, 7] sub-range
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = VECTOR('', #2, 10.0);\n",
            "#4 = LINE('', #1, #3);\n",
            "#5 = TRIMMED_CURVE('', #4, (PARAMETER_VALUE(2.0)), \
                  (PARAMETER_VALUE(7.0)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Line { parameter_range, .. } => {
                assert_eq!(parameter_range, Some([2.0, 7.0]));
            }
            other => panic!("expected Line with trim range, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_trimmed_curve_sense_false_swaps() {
        // Sense .F. → trim_2 / trim_1 swapped (start = trim_2, end = trim_1)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = CIRCLE('', #2, 5.0);\n",
            "#4 = TRIMMED_CURVE('', #3, (PARAMETER_VALUE(0.5)), \
                  (PARAMETER_VALUE(1.5)), .F., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        match result.promotion.unwrap() {
            CurvePromotion::Circle { parameter_range, .. } => {
                // Sense F → swapped: low=1.5, high=0.5 (which is the
                // backward direction). 본 MVP 는 raw (low, high) 순서대로
                // 저장 — sense interpretation 은 caller 책임.
                assert_eq!(parameter_range, Some([1.5, 0.5]));
            }
            _ => panic!("expected Circle"),
        }
    }

    #[test]
    fn promote_step_trimmed_curve_no_parameter_value_keeps_original_range() {
        // trim 이 PARAMETER_VALUE 없이 CARTESIAN_POINT 만 → MVP 미지원,
        // basis 의 parameter_range 그대로 유지 (Circle 의 default [0, 2π]).
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = CIRCLE('', #2, 5.0);\n",
            "#4 = CARTESIAN_POINT('', (5., 0., 0.));\n",
            "#5 = CARTESIAN_POINT('', (0., 5., 0.));\n",
            "#6 = TRIMMED_CURVE('', #3, (#4), (#5), .T., .CARTESIAN.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 6, &mut cache);
        match result.promotion.unwrap() {
            CurvePromotion::Circle { parameter_range, .. } => {
                // CARTESIAN-only trim → MVP 미지원 → basis 의 [0, 2π] 유지
                assert_eq!(parameter_range, Some([0.0, std::f64::consts::TAU]));
            }
            _ => panic!("expected Circle"),
        }
    }

    #[test]
    fn promote_step_trimmed_curve_basis_unsupported_propagates() {
        // B5 follow-up (2026-05-01): basis ELLIPSE / PARABOLA / HYPERBOLA
        // 모두 supported. OFFSET_CURVE_3D 는 여전히 unsupported.
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = OFFSET_CURVE_3D('', #2, 1.0, .T., #2);\n",
            "#4 = TRIMMED_CURVE('', #3, (PARAMETER_VALUE(0.0)), \
                  (PARAMETER_VALUE(3.14)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        // basis 가 Tessellate 라도 trim 의 parameter_range 는 보존
        match result.promotion.unwrap() {
            CurvePromotion::Tessellate { parameter_range, .. } => {
                assert_eq!(parameter_range, Some([0.0, 3.14]));
            }
            _ => panic!("expected Tessellate (basis OFFSET_CURVE_3D unsupported)"),
        }
    }

    // ─── B5 신규 — ELLIPSE 변환 (Piegl A7.1) ───────────────────────────

    #[test]
    fn promote_step_ellipse_full_unit() {
        // Unit ellipse (semi_axes 1, 1 = circle) at origin
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",  // axis = +Z
            "#3 = DIRECTION('', (1., 0., 0.));\n",  // ref = +X
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = ELLIPSE('', #4, 1.0, 1.0);"  // semi_axis_1=a=1, semi_axis_2=b=1
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
        match result.promotion.unwrap() {
            CurvePromotion::Nurbs {
                control_pts, weights, knots, degree, parameter_range,
            } => {
                assert_eq!(control_pts.len(), 9);
                assert_eq!(weights.len(), 9);
                assert_eq!(knots.len(), 12);
                assert_eq!(degree, 2);
                assert_eq!(parameter_range, Some([0.0, 1.0]));
                // Spot-check P0 = +X, P2 = +Y, P4 = -X, P6 = -Y
                assert!(approx_eq3(control_pts[0], [1., 0., 0.], 1e-12));
                assert!(approx_eq3(control_pts[2], [0., 1., 0.], 1e-12));
                assert!(approx_eq3(control_pts[4], [-1., 0., 0.], 1e-12));
                assert!(approx_eq3(control_pts[6], [0., -1., 0.], 1e-12));
                // Weights pattern [1, √2/2, 1, ...]
                assert_eq!(weights[0], 1.0);
                assert!((weights[1] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
            }
            other => panic!("expected Nurbs, got {:?}", other),
        }
    }

    #[test]
    fn promote_step_ellipse_axes_3_5_at_offset() {
        // semi-axis 3 along +X, 5 along +Y, center (10, 20, 30)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (10., 20., 30.));\n",
            "#2 = DIRECTION('', (0., 0., 1.));\n",
            "#3 = DIRECTION('', (1., 0., 0.));\n",
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = ELLIPSE('', #4, 3.0, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            CurvePromotion::Nurbs { control_pts, .. } => {
                // P0 = center + 3 * X = (13, 20, 30)
                assert!(approx_eq3(control_pts[0], [13., 20., 30.], 1e-12));
                // P2 = center + 5 * Y = (10, 25, 30)
                assert!(approx_eq3(control_pts[2], [10., 25., 30.], 1e-12));
                // P4 = center - 3 * X = (7, 20, 30)
                assert!(approx_eq3(control_pts[4], [7., 20., 30.], 1e-12));
                // P6 = center - 5 * Y = (10, 15, 30)
                assert!(approx_eq3(control_pts[6], [10., 15., 30.], 1e-12));
            }
            _ => panic!("expected Nurbs"),
        }
    }

    #[test]
    fn promote_step_ellipse_negative_axis_errors() {
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = ELLIPSE('', #2, -1.0, 5.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("must be positive")));
    }

    #[test]
    fn promote_step_ellipse_with_3d_placement() {
        // Ellipse on Y-Z plane (placement.axis = +X, ref_dir = +Y)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",  // axis = +X
            "#3 = DIRECTION('', (0., 1., 0.));\n",  // ref = +Y
            "#4 = AXIS2_PLACEMENT_3D('', #1, #2, #3);\n",
            "#5 = ELLIPSE('', #4, 2.0, 4.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 5, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            CurvePromotion::Nurbs { control_pts, .. } => {
                // P0 = center + 2 * Y = (0, 2, 0)
                assert!(approx_eq3(control_pts[0], [0., 2., 0.], 1e-12));
                // y_axis = axis × ref = X × Y = +Z, P2 = center + 4 * Z = (0, 0, 4)
                assert!(approx_eq3(control_pts[2], [0., 0., 4.], 1e-12));
                // P4 = center - 2 * Y = (0, -2, 0)
                assert!(approx_eq3(control_pts[4], [0., -2., 0.], 1e-12));
                // P6 = center - 4 * Z = (0, 0, -4)
                assert!(approx_eq3(control_pts[6], [0., 0., -4.], 1e-12));
            }
            _ => panic!("expected Nurbs"),
        }
    }

    #[test]
    fn promote_step_ellipse_trimmed_quarter_arc() {
        // Ellipse + TRIMMED_CURVE [0, 0.25] (quarter arc in NURBS parameter)
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = ELLIPSE('', #2, 5.0, 3.0);\n",
            "#4 = TRIMMED_CURVE('', #3, (PARAMETER_VALUE(0.0)), \
                  (PARAMETER_VALUE(0.25)), .T., .PARAMETER.);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 4, &mut cache);
        assert!(result.warnings.is_empty());
        match result.promotion.unwrap() {
            CurvePromotion::Nurbs { control_pts, parameter_range, .. } => {
                // 9 control points 그대로 보존 (full NURBS), parameter_range 만 trim
                assert_eq!(control_pts.len(), 9);
                assert_eq!(parameter_range, Some([0.0, 0.25]));
            }
            _ => panic!("expected Nurbs (trimmed)"),
        }
    }
}
