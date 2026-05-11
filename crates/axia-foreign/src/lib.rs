//! AXiA `axia-foreign` — 자체 STEP / IGES 파서 (Phase G Stage 4-B spike).
//!
//! ## Mission
//!
//! ADR-035 P20.2 의 자체 파서 spike. 12개월 후 P20.E 트리거 만족 시
//! OCCT.js 옵션을 대체하여 default 로 promote.
//!
//! ## Scope (MVP, ADR-035 P20.2)
//!
//! - **STEP AP203** import: `B_SPLINE_SURFACE_WITH_KNOTS`, `BOUNDED_CURVE`,
//!   `CARTESIAN_POINT`, `ADVANCED_FACE`, `EDGE_CURVE`
//! - **IGES 5.3** import: Type 128 (NURBS surface), Type 126 (NURBS curve),
//!   Type 110 (line), Type 100 (circle), Type 116 (point)
//! - **Round-trip Export**: 같은 entity types 의 reverse path
//! - **Promotion** to `axia_geo::AnalyticCurve` / `AnalyticSurface` —
//!   ADR-036 P21 매핑 표 그대로 (Stage 4-A OCCT.js 경로와 동일 매핑)
//!
//! ## Out of Scope
//!
//! - AP242 / AP238 / IFC — 별도 ADR
//! - Drawing views / annotations / PMI — ADR-035 P20.B
//! - Assembly hierarchy — ADR-035 P20.B
//!
//! ## 의존성 정책 (zero-deps)
//!
//! 외부 STEP/IGES 라이브러리 의존 0. `axia-geo` (AnalyticCurve / Surface
//! enum) + `glam` + `anyhow` + `serde` 만 사용. ADR-035 P20.2 명시 사항.

pub mod step;
pub mod step_lexer;
pub mod step_parser;
pub mod step_resolver;
pub mod conic_converter;
pub mod sweep_converter;
pub mod iges;
pub mod promote_curve;
pub mod promote_surface;

pub use step::StepImporter;
pub use iges::IgesImporter;

/// Format identifier — caller dispatch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForeignFormat {
    StepAp203,
    StepAp214,
    StepAp242,
    Iges53,
}

/// Import 결과 — promoted geometry + warnings.
///
/// Promotion 매핑은 ADR-036 P21 의 Stage 4-A / 4-B 공통 결정에 의거.
/// `warnings` 는 ADR-036 P21.7 의 6 case 누적 (DownCast 실패 / 변환
/// 정확도 미달 / fitting tolerance 초과 / rational SSI / PCurve missing /
/// self-intersection).
#[derive(Clone, Debug, Default)]
pub struct ImportResult {
    pub format: Option<ForeignFormat>,
    pub curves: Vec<promote_curve::CurvePromotion>,
    pub surfaces: Vec<promote_surface::SurfacePromotion>,
    pub warnings: Vec<String>,
}

impl ImportResult {
    pub fn new(format: ForeignFormat) -> Self {
        Self {
            format: Some(format),
            curves: Vec::new(),
            surfaces: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.curves.is_empty() && self.surfaces.is_empty()
    }
}
