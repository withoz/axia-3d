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
use crate::promote_curve::ForeignCurveKind;
use crate::promote_surface::ForeignSurfaceKind;

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

    /// `StepFile.header` 의 FILE_SCHEMA / FILE_NAME 으로부터 추출.
    pub fn from_parsed(file: &crate::step_parser::StepFile) -> Self {
        let mut header = Self::default();
        if let Some(schema) = file.header_entity("FILE_SCHEMA") {
            // FILE_SCHEMA 의 args[0] = list of strings
            if let Some(crate::step_parser::Value::List(items)) = schema.args.first() {
                for item in items {
                    if let crate::step_parser::Value::Str(s) = item {
                        header.file_schema.push(s.clone());
                    }
                }
            }
        }
        if let Some(name) = file.header_entity("FILE_NAME") {
            // FILE_NAME args: name, time_stamp, author, organization, preprocessor_version,
            //                 originating_system, authorization
            if let Some(crate::step_parser::Value::Str(s)) = name.args.get(5) {
                header.originating_system = Some(s.clone());
            }
            if let Some(crate::step_parser::Value::Str(s)) = name.args.get(6) {
                header.authorization = Some(s.clone());
            }
        }
        header
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
    /// **A-4 (이번 PR)**: end-to-end pipeline 작동. parse → classify →
    /// resolve → promote. 직접 매핑된 entity (LINE / CIRCLE /
    /// B_SPLINE_CURVE_WITH_KNOTS / PLANE / CYLINDRICAL_SURFACE) 는
    /// AnalyticCurve / AnalyticSurface 로 변환됨. 나머지는 Tessellate
    /// fallback + warnings 누적 (P21.7 정합).
    pub fn parse_str(&self, content: &str) -> Result<ImportResult> {
        use crate::promote_curve::{self, CurvePromotion};
        use crate::promote_surface::{self, SurfacePromotion};
        use crate::step_resolver::ResolveCache;

        let parsed = match crate::step_parser::parse(content) {
            Ok(p) => p,
            Err(e) => {
                let mut result = ImportResult::default();
                result.warnings.push(format!("STEP parse failed: {}", e));
                return Ok(result);
            }
        };

        let header = StepHeader::from_parsed(&parsed);
        let format = header.detect_format();
        let mut result = ImportResult::new(format);

        // Iterate DATA section entities. For each one, classify its tag and
        // dispatch to the matching promote_step_*. Skip entities that aren't
        // top-level curves/surfaces (e.g. CARTESIAN_POINT — building block).
        let mut cache = ResolveCache::new();
        let mut ids: Vec<u32> = parsed.data.keys().copied().collect();
        ids.sort();  // 결정적 순서

        for id in ids {
            let entity = parsed.data.get(&id).expect("id from keys");
            let curve_kind = classify_curve_entity(&entity.tag);
            let surface_kind = classify_surface_entity(&entity.tag);

            if curve_kind != crate::promote_curve::ForeignCurveKind::Unsupported {
                let promo = promote_curve::promote_step_curve(&parsed, id, &mut cache);
                for w in promo.warnings { result.warnings.push(w); }
                if let Some(p) = promo.promotion {
                    // 모든 curve 가 promotion 결과를 가짐 (Tessellate 포함).
                    // Tessellate 는 follow-up 에서 점검 가능하도록 보존.
                    result.curves.push(p);
                }
                continue;
            }
            if surface_kind != crate::promote_surface::ForeignSurfaceKind::Unsupported {
                let promo = promote_surface::promote_step_surface(&parsed, id, &mut cache);
                for w in promo.warnings { result.warnings.push(w); }
                if let Some(p) = promo.promotion {
                    result.surfaces.push(p);
                }
                continue;
            }
            // Building-block entities (CARTESIAN_POINT / DIRECTION / VECTOR /
            // AXIS2_PLACEMENT_3D / etc) — skipped silently. resolve 시점에
            // refs 로 자동 해소.
        }

        // Suppress dead_code warning while promote_curve module not all wired:
        let _: Option<CurvePromotion> = None;
        let _: Option<SurfacePromotion> = None;

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
        // Empty input → parser error (no HEADER) → captured as warning.
        let importer = StepImporter::new();
        let result = importer.parse_str("").unwrap();
        assert!(result.is_empty());
        assert!(!result.warnings.is_empty());
        assert!(result.warnings[0].contains("parse failed"));
    }

    #[test]
    fn parse_minimal_file_succeeds_via_importer() {
        // Legitimate LINE with VECTOR ref.
        let src = "ISO-10303-21;\n\
            HEADER;\n\
            FILE_DESCRIPTION(('test'),'2;1');\n\
            FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));\n\
            ENDSEC;\n\
            DATA;\n\
            #1 = CARTESIAN_POINT('', (0., 0., 0.));\n\
            #2 = DIRECTION('', (1., 0., 0.));\n\
            #3 = VECTOR('', #2, 5.0);\n\
            #4 = LINE('', #1, #3);\n\
            ENDSEC;\n\
            END-ISO-10303-21;\n";
        let importer = StepImporter::new();
        let result = importer.parse_str(src).unwrap();
        assert_eq!(result.format, Some(ForeignFormat::StepAp203));
        // 1 LINE promoted to CurvePromotion::Line.
        assert_eq!(result.curves.len(), 1);
        match &result.curves[0] {
            crate::promote_curve::CurvePromotion::Line { start, end, .. } => {
                assert_eq!(*start, [0.0, 0.0, 0.0]);
                assert_eq!(*end, [5.0, 0.0, 0.0]);
            }
            other => panic!("expected Line, got {:?}", other),
        }
    }

    #[test]
    fn end_to_end_mixed_curve_surface_pipeline() {
        // 1 LINE + 1 CIRCLE + 1 PLANE + 1 CYLINDRICAL_SURFACE → 4 promotions.
        let src = "ISO-10303-21;\n\
            HEADER;\n\
            FILE_DESCRIPTION(('mixed'),'2;1');\n\
            FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));\n\
            ENDSEC;\n\
            DATA;\n\
            #1 = CARTESIAN_POINT('', (0., 0., 0.));\n\
            #2 = DIRECTION('', (1., 0., 0.));\n\
            #3 = DIRECTION('', (0., 0., 1.));\n\
            #4 = AXIS2_PLACEMENT_3D('', #1, #3, #2);\n\
            #5 = VECTOR('', #2, 1.0);\n\
            #6 = LINE('', #1, #5);\n\
            #7 = CIRCLE('', #4, 5.0);\n\
            #8 = PLANE('', #4);\n\
            #9 = CYLINDRICAL_SURFACE('', #4, 3.0);\n\
            ENDSEC;\n\
            END-ISO-10303-21;\n";
        let importer = StepImporter::new();
        let result = importer.parse_str(src).unwrap();
        assert_eq!(result.curves.len(), 2);     // LINE + CIRCLE
        assert_eq!(result.surfaces.len(), 2);   // PLANE + CYLINDRICAL_SURFACE
        assert!(result.warnings.is_empty(), "warnings: {:?}", result.warnings);
    }

    #[test]
    fn parse_ap242_file_detected() {
        let src = "ISO-10303-21;\n\
            HEADER;\n\
            FILE_DESCRIPTION(('test'),'2;1');\n\
            FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\n\
            ENDSEC;\n\
            DATA;\n\
            ENDSEC;\n\
            END-ISO-10303-21;\n";
        let importer = StepImporter::new();
        let result = importer.parse_str(src).unwrap();
        assert_eq!(result.format, Some(ForeignFormat::StepAp242));
    }

    #[test]
    fn parse_malformed_returns_warning_not_panic() {
        let importer = StepImporter::new();
        let result = importer.parse_str("HEADER;\nGARBAGE_NO_PAREN\nENDSEC;").unwrap();
        assert!(!result.warnings.is_empty());
        assert!(result.warnings[0].contains("parse failed"));
    }
}

