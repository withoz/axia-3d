//! STEP AP203 / AP242 import (Stage 4-B spike).
//!
//! ADR-035 P20.2 의 zero-deps 자체 파서. 외부 STEP 라이브러리 의존 없이
//! ISO 10303-21 (Part 21) 형식의 ASCII STEP 파일을 parsing.
//!
//! ## ISO 10303-21 구조
//!
//! ```text
//! ISO-10303-21;
//! HEADER;
//!   FILE_DESCRIPTION(...);
//!   FILE_NAME(...);
//!   FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));  -- AP203
//! ENDSEC;
//! DATA;
//!   #1 = CARTESIAN_POINT('', (0.0, 0.0, 0.0));
//!   #2 = LINE('', #1, #3);
//!   ...
//! ENDSEC;
//! END-ISO-10303-21;
//! ```
//!
//! ## MVP scope
//!
//! 본 commit 은 lexer / parser / entity dispatch 의 **시그니처 + 매핑
//! enum** 만. 실제 entity 파싱 본체는 후속 PR.

use anyhow::Result;

use crate::ImportResult;
use crate::ForeignFormat;
use crate::promote_curve::{self, ForeignCurveKind};
use crate::promote_surface::{self, ForeignSurfaceKind};

/// STEP entity tag (예: `LINE`, `B_SPLINE_CURVE_WITH_KNOTS`).
///
/// 매핑 (ADR-036 P21.1 / P21.2):
/// - Curve entity tag → `ForeignCurveKind`
/// - Surface entity tag → `ForeignSurfaceKind`
pub fn classify_curve_entity(tag: &str) -> ForeignCurveKind {
    match tag {
        "LINE" => ForeignCurveKind::Line,
        "CIRCLE" => ForeignCurveKind::Circle,
        "ELLIPSE" => ForeignCurveKind::Ellipse,
        "PARABOLA" => ForeignCurveKind::Parabola,
        "HYPERBOLA" => ForeignCurveKind::Hyperbola,
        "BEZIER_CURVE" => ForeignCurveKind::Bezier,
        // STEP 의 AP203/AP242 는 B_SPLINE_CURVE_WITH_KNOTS 를 rational 여부와
        // 무관하게 사용. RATIONAL_B_SPLINE_CURVE 는 AP242 의 weighted 버전.
        "B_SPLINE_CURVE_WITH_KNOTS" => ForeignCurveKind::BSpline,
        "RATIONAL_B_SPLINE_CURVE" => ForeignCurveKind::Nurbs,
        "OFFSET_CURVE_3D" => ForeignCurveKind::OffsetCurve,
        "TRIMMED_CURVE" => ForeignCurveKind::TrimmedCurve,
        _ => ForeignCurveKind::Unsupported,
    }
}

pub fn classify_surface_entity(tag: &str) -> ForeignSurfaceKind {
    match tag {
        "PLANE" => ForeignSurfaceKind::Plane,
        "CYLINDRICAL_SURFACE" => ForeignSurfaceKind::Cylinder,
        "SPHERICAL_SURFACE" => ForeignSurfaceKind::Sphere,
        "CONICAL_SURFACE" => ForeignSurfaceKind::Cone,
        "TOROIDAL_SURFACE" => ForeignSurfaceKind::Torus,
        "BEZIER_SURFACE" => ForeignSurfaceKind::BezierSurface,
        "B_SPLINE_SURFACE_WITH_KNOTS" => ForeignSurfaceKind::BSplineSurface,
        "RATIONAL_B_SPLINE_SURFACE" => ForeignSurfaceKind::NurbsSurface,
        "SURFACE_OF_REVOLUTION" => ForeignSurfaceKind::SurfaceOfRevolution,
        "SURFACE_OF_LINEAR_EXTRUSION" => ForeignSurfaceKind::SurfaceOfLinearExtrusion,
        "OFFSET_SURFACE" => ForeignSurfaceKind::OffsetSurface,
        "RECTANGULAR_TRIMMED_SURFACE" => ForeignSurfaceKind::RectangularTrimmedSurface,
        _ => ForeignSurfaceKind::Unsupported,
    }
}

/// STEP file header — 파싱된 메타데이터.
#[derive(Clone, Debug, Default)]
pub struct StepHeader {
    pub file_schema: Vec<String>,
    pub originating_system: Option<String>,
    pub authorization: Option<String>,
}

impl StepHeader {
    /// Schema 로부터 AP version 추정.
    pub fn detect_format(&self) -> ForeignFormat {
        for s in &self.file_schema {
            let upper = s.to_uppercase();
            if upper.contains("AP242") || upper.contains("MANAGED_MODEL_BASED_3D") {
                return ForeignFormat::StepAp242;
            }
            if upper.contains("AP214") || upper.contains("AUTOMOTIVE_DESIGN") {
                return ForeignFormat::StepAp214;
            }
        }
        ForeignFormat::StepAp203
    }
}

/// STEP importer — ISO 10303-21 ASCII parser.
///
/// **현재 스텁** — lexer / parser 본체는 후속 PR. 본 commit 은 시그니처
/// + classify_*_entity 매핑 함수 (ADR-036 P21 정합) + 회귀 테스트만 잠금.
pub struct StepImporter;

impl StepImporter {
    pub fn new() -> Self {
        Self
    }

    /// STEP 파일 텍스트 → ImportResult.
    ///
    /// MVP: header section parsing (schema 탐지) + DATA section
    /// scaffolding. 실제 entity reference 해소는 후속 PR.
    pub fn parse_str(&self, _content: &str) -> Result<ImportResult> {
        // TODO Phase G Stage 4-B:
        //   1. ISO 10303-21 header section lexer (FILE_DESCRIPTION /
        //      FILE_NAME / FILE_SCHEMA)
        //   2. DATA section: `#N = ENTITY_NAME(args);` 시그니처 파서
        //   3. entity reference resolution (#N -> Box<Entity>)
        //   4. CARTESIAN_POINT / DIRECTION / VECTOR / AXIS2_PLACEMENT_3D
        //      basic geometry resolution
        //   5. classify_*_entity → promote_curve::promote / promote_surface::promote
        //      dispatch
        //   6. ImportResult { curves, surfaces, warnings } 누적
        let mut result = ImportResult::default();
        result.warnings.push(
            "STEP parser not yet wired (Phase G Stage 4-B pending)".to_string(),
        );
        Ok(result)
    }

    /// 파일 경로로부터 직접 import.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn parse_file<P: AsRef<std::path::Path>>(&self, path: P) -> Result<ImportResult> {
        let content = std::fs::read_to_string(path)?;
        self.parse_str(&content)
    }
}

impl Default for StepImporter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_curve_entities_match_adr_036_p21_1() {
        // ADR-036 P21.1 매핑 표의 11항목 모두 Unsupported 가 아니어야 함.
        let cases = [
            ("LINE", ForeignCurveKind::Line),
            ("CIRCLE", ForeignCurveKind::Circle),
            ("ELLIPSE", ForeignCurveKind::Ellipse),
            ("PARABOLA", ForeignCurveKind::Parabola),
            ("HYPERBOLA", ForeignCurveKind::Hyperbola),
            ("BEZIER_CURVE", ForeignCurveKind::Bezier),
            ("B_SPLINE_CURVE_WITH_KNOTS", ForeignCurveKind::BSpline),
            ("RATIONAL_B_SPLINE_CURVE", ForeignCurveKind::Nurbs),
            ("OFFSET_CURVE_3D", ForeignCurveKind::OffsetCurve),
            ("TRIMMED_CURVE", ForeignCurveKind::TrimmedCurve),
        ];
        for (tag, expected) in cases {
            assert_eq!(classify_curve_entity(tag), expected, "tag={}", tag);
        }
    }

    #[test]
    fn classify_unknown_curve_returns_unsupported() {
        assert_eq!(
            classify_curve_entity("UNKNOWN_CURVE_TYPE"),
            ForeignCurveKind::Unsupported
        );
    }

    #[test]
    fn classify_surface_entities_match_adr_036_p21_2() {
        // ADR-036 P21.2 매핑 표의 12항목 모두 Unsupported 가 아니어야 함.
        let cases = [
            ("PLANE", ForeignSurfaceKind::Plane),
            ("CYLINDRICAL_SURFACE", ForeignSurfaceKind::Cylinder),
            ("SPHERICAL_SURFACE", ForeignSurfaceKind::Sphere),
            ("CONICAL_SURFACE", ForeignSurfaceKind::Cone),
            ("TOROIDAL_SURFACE", ForeignSurfaceKind::Torus),
            ("BEZIER_SURFACE", ForeignSurfaceKind::BezierSurface),
            ("B_SPLINE_SURFACE_WITH_KNOTS", ForeignSurfaceKind::BSplineSurface),
            ("RATIONAL_B_SPLINE_SURFACE", ForeignSurfaceKind::NurbsSurface),
            ("SURFACE_OF_REVOLUTION", ForeignSurfaceKind::SurfaceOfRevolution),
            ("SURFACE_OF_LINEAR_EXTRUSION", ForeignSurfaceKind::SurfaceOfLinearExtrusion),
            ("OFFSET_SURFACE", ForeignSurfaceKind::OffsetSurface),
            ("RECTANGULAR_TRIMMED_SURFACE", ForeignSurfaceKind::RectangularTrimmedSurface),
        ];
        for (tag, expected) in cases {
            assert_eq!(classify_surface_entity(tag), expected, "tag={}", tag);
        }
    }

    #[test]
    fn classify_unknown_surface_returns_unsupported() {
        assert_eq!(
            classify_surface_entity("UNKNOWN_SURFACE_TYPE"),
            ForeignSurfaceKind::Unsupported
        );
    }

    #[test]
    fn step_header_detects_ap203_default() {
        let h = StepHeader::default();
        assert_eq!(h.detect_format(), ForeignFormat::StepAp203);
    }

    #[test]
    fn step_header_detects_ap242() {
        let h = StepHeader {
            file_schema: vec!["AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF".to_string()],
            ..Default::default()
        };
        assert_eq!(h.detect_format(), ForeignFormat::StepAp242);
    }

    #[test]
    fn step_header_detects_ap214() {
        let h = StepHeader {
            file_schema: vec!["AUTOMOTIVE_DESIGN".to_string()],
            ..Default::default()
        };
        assert_eq!(h.detect_format(), ForeignFormat::StepAp214);
    }

    #[test]
    fn parse_empty_returns_warning() {
        let importer = StepImporter::new();
        let result = importer.parse_str("").unwrap();
        assert!(result.is_empty());
        assert!(!result.warnings.is_empty());
        assert!(result.warnings[0].contains("not yet wired"));
    }
}

// Suppress unused warning for the dispatch helpers (used after parser wiring).
#[allow(dead_code)]
fn _silence_unused() {
    let _ = promote_curve::promote(ForeignCurveKind::Line);
    let _ = promote_surface::promote(ForeignSurfaceKind::Plane);
}
