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
}
