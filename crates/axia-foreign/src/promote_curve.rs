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
        // ELLIPSE not yet wired (Conic conversion follow-up).
        let src = minimal(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = AXIS2_PLACEMENT_3D('', #1, $, $);\n",
            "#3 = ELLIPSE('', #2, 5.0, 3.0);"
        ));
        let f = parse(&src).unwrap();
        let mut cache = ResolveCache::new();
        let result = promote_step_curve(&f, 3, &mut cache);
        assert!(matches!(result.promotion, Some(CurvePromotion::Tessellate { .. })));
        assert!(result.warnings.iter().any(|w| w.contains("not yet wired")));
    }

    #[test]
    fn expand_knots_basic() {
        let knots = expand_knots(&[0.0, 0.5, 1.0], &[3, 2, 3]);
        assert_eq!(knots, vec![0.0, 0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0]);
    }
}
