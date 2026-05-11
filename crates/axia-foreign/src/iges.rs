//! IGES 5.3 import (Stage 4-B spike).
//!
//! ADR-035 P20.2 의 zero-deps 자체 파서. ANSI Y14.26 / IGES 5.3 fixed-format
//! ASCII 파일 (80-column, 5 sections: S/G/D/P/T) parsing.
//!
//! ## IGES 구조
//!
//! - **S** (Start): 자유 텍스트 헤더
//! - **G** (Global): 단위 / precision / version
//! - **D** (Directory Entry): entity 디렉토리 (각 20-field, 2-line)
//! - **P** (Parameter Data): entity 파라미터 (D entry 가 가리킴)
//! - **T** (Terminate): 섹션 카운트
//!
//! ## Entity Type 매핑 (MVP scope, ADR-036 P21)
//!
//! | IGES Type | Name | → AnalyticCurve / AnalyticSurface |
//! |---|---|---|
//! | 100 | Circular Arc | `Circle` (full) or `Arc` |
//! | 110 | Line | `Line` |
//! | 116 | Point | (vertex 데이터) |
//! | 120 | Surface of Revolution | `NurbsSurface` (Piegl A8.1) |
//! | 122 | Tabulated Cylinder (Linear Extrusion) | `NurbsSurface` (Piegl A8.2) |
//! | 126 | Rational B-Spline Curve | `BSpline` or `Nurbs` (PROP 3 PROP3 = rational flag) |
//! | 128 | Rational B-Spline Surface | `BSplineSurface` or `NurbsSurface` |
//! | 142 | Curve on a Parametric Surface | (PCurve → TrimCurve2D 매핑) |
//! | 144 | Trimmed Parametric Surface | `RectangularTrimmedSurface` 변환 |
//! | 190 | Plane Surface (AP242 IGES) | `Plane` |
//! | 192 | Right Circular Cylindrical Surface | `Cylinder` |
//! | 194 | Right Circular Conical Surface | `Cone` |
//! | 196 | Spherical Surface | `Sphere` |
//! | 198 | Toroidal Surface | `Torus` |

use anyhow::Result;

use crate::ImportResult;
use crate::ForeignFormat;
use crate::promote_curve::ForeignCurveKind;
use crate::promote_surface::ForeignSurfaceKind;

/// IGES Type 번호 → ForeignCurveKind 매핑 (P21.1).
///
/// IGES Type 126 (Rational B-Spline Curve) 의 rational 분기는 PROP3
/// flag 가 결정 → 본 함수는 BSpline 으로 반환, parser 가 rational 시
/// `Nurbs` 로 promote.
pub fn classify_curve_iges_type(iges_type: u16) -> ForeignCurveKind {
    match iges_type {
        100 => ForeignCurveKind::Arc,           // 또는 Circle (PARM 결정)
        110 => ForeignCurveKind::Line,
        126 => ForeignCurveKind::BSpline,       // PROP3 = 1 → Nurbs
        // 102 (Composite Curve) / 104 (Conic Arc) / 106 (Copious Data) 등은
        // MVP 범위 외 — 별도 PR 에서 격상.
        _ => ForeignCurveKind::Unsupported,
    }
}

pub fn classify_surface_iges_type(iges_type: u16) -> ForeignSurfaceKind {
    match iges_type {
        120 => ForeignSurfaceKind::SurfaceOfRevolution,
        122 => ForeignSurfaceKind::SurfaceOfLinearExtrusion,
        128 => ForeignSurfaceKind::BSplineSurface,  // PROP3 = 1 → NurbsSurface
        144 => ForeignSurfaceKind::RectangularTrimmedSurface,
        190 => ForeignSurfaceKind::Plane,
        192 => ForeignSurfaceKind::Cylinder,
        194 => ForeignSurfaceKind::Cone,
        196 => ForeignSurfaceKind::Sphere,
        198 => ForeignSurfaceKind::Torus,
        // 118 (Ruled Surface) 등은 MVP 범위 외.
        _ => ForeignSurfaceKind::Unsupported,
    }
}

/// IGES Global section — version / units / tolerance.
#[derive(Clone, Debug, Default)]
pub struct IgesGlobal {
    pub version: u8,                         // 11 = IGES 5.3 (most common)
    pub originating_system_product: Option<String>,
    pub model_space_scale: f64,
    pub model_units_flag: u8,                // 1 = inches, 2 = millimeters, 6 = mm
    pub min_resolution: f64,
}

/// IGES importer — fixed-format ASCII parser.
///
/// **현재 스텁** — section / DE / PD parser 본체는 후속 PR.
pub struct IgesImporter;

impl IgesImporter {
    pub fn new() -> Self {
        Self
    }

    /// IGES 파일 텍스트 → ImportResult.
    ///
    /// MVP: section detection (S/G/D/P/T 80-col line classifier) + DE
    /// directory iteration + PD field 분리. entity promotion 본체는 후속 PR.
    pub fn parse_str(&self, _content: &str) -> Result<ImportResult> {
        // TODO Phase G Stage 4-B:
        //   1. 80-col line 의 section letter (col 73) 로 분류
        //   2. Global section: 7-bit param delim (default ',') + record delim
        //      (default ';') 로 field split
        //   3. DE section: 각 entity 의 2-line 20-field block 파싱
        //   4. PD section: DE 가 가리키는 record 의 자유-form 파라미터 파싱
        //   5. classify_*_iges_type → promote dispatch
        //   6. ImportResult 누적
        let mut result = ImportResult::new(ForeignFormat::Iges53);
        result.warnings.push(
            "IGES parser not yet wired (Phase G Stage 4-B pending)".to_string(),
        );
        Ok(result)
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn parse_file<P: AsRef<std::path::Path>>(&self, path: P) -> Result<ImportResult> {
        let content = std::fs::read_to_string(path)?;
        self.parse_str(&content)
    }
}

impl Default for IgesImporter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_curve_iges_types_known() {
        assert_eq!(classify_curve_iges_type(110), ForeignCurveKind::Line);
        assert_eq!(classify_curve_iges_type(100), ForeignCurveKind::Arc);
        assert_eq!(classify_curve_iges_type(126), ForeignCurveKind::BSpline);
    }

    #[test]
    fn classify_curve_iges_unknown_returns_unsupported() {
        assert_eq!(classify_curve_iges_type(999), ForeignCurveKind::Unsupported);
    }

    #[test]
    fn classify_surface_iges_types_known() {
        assert_eq!(classify_surface_iges_type(190), ForeignSurfaceKind::Plane);
        assert_eq!(classify_surface_iges_type(192), ForeignSurfaceKind::Cylinder);
        assert_eq!(classify_surface_iges_type(196), ForeignSurfaceKind::Sphere);
        assert_eq!(classify_surface_iges_type(194), ForeignSurfaceKind::Cone);
        assert_eq!(classify_surface_iges_type(198), ForeignSurfaceKind::Torus);
        assert_eq!(classify_surface_iges_type(128), ForeignSurfaceKind::BSplineSurface);
        assert_eq!(classify_surface_iges_type(120), ForeignSurfaceKind::SurfaceOfRevolution);
        assert_eq!(classify_surface_iges_type(122), ForeignSurfaceKind::SurfaceOfLinearExtrusion);
        assert_eq!(classify_surface_iges_type(144), ForeignSurfaceKind::RectangularTrimmedSurface);
    }

    #[test]
    fn classify_surface_iges_unknown_returns_unsupported() {
        assert_eq!(classify_surface_iges_type(999), ForeignSurfaceKind::Unsupported);
    }

    #[test]
    fn parse_empty_returns_warning_iges() {
        let importer = IgesImporter::new();
        let result = importer.parse_str("").unwrap();
        assert!(result.is_empty());
        assert_eq!(result.format, Some(ForeignFormat::Iges53));
        assert!(!result.warnings.is_empty());
    }
}
