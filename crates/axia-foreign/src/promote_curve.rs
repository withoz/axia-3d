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
}
