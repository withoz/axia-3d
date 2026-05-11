//! B4 — cube.stp fixture round-trip 검증.
//!
//! ADR-035 P20.D 의 첫 산업 STEP 파일 검증. ADR-035 P20.E 트리거 #2
//! (정확도 ≤ 1e-3 mm) 측정의 출발점.
//!
//! ## 검증 항목
//!
//! 1. **Parse**: cube.stp 가 lex/parse 단계에서 깨지지 않음
//! 2. **Format detection**: AP203 (CONFIG_CONTROL_DESIGN) 자동 인식
//! 3. **Entity count**: 8 vertices + 12 lines + 6 planes + 6 placements 등
//! 4. **Curve promotion**: 12 LINE → CurvePromotion::Line (12개 모두)
//! 5. **Surface promotion**: 6 PLANE → SurfacePromotion::Plane (6개 모두)
//! 6. **Geometric accuracy**: line endpoints / plane origins/normals 가
//!    1e-3 mm 이내 정확
//! 7. **Round-trip invariant**: 모든 vertex 좌표가 [0, 1] 범위 정확 유지
//!
//! Result: TS web 통과 + 본 fixture 통과 = ADR-035 P20.E #2 측정 가능.

use axia_foreign::{StepImporter, ForeignFormat};
use axia_foreign::promote_curve::CurvePromotion;
use axia_foreign::promote_surface::SurfacePromotion;

const TOLERANCE: f64 = 1e-3;  // ADR-035 P20.E #2: 1e-3 mm

fn approx_eq3(a: [f64; 3], b: [f64; 3], tol: f64) -> bool {
    (0..3).all(|i| (a[i] - b[i]).abs() < tol)
}

#[test]
fn b4_cube_stp_parses_successfully() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let importer = StepImporter::new();
    let result = importer.parse_file(&path)
        .expect("cube.stp file must exist + parse");

    // Format detection
    assert_eq!(
        result.format,
        Some(ForeignFormat::StepAp203),
        "cube.stp should be detected as AP203 (CONFIG_CONTROL_DESIGN)",
    );

    // Promotion: 12 LINE → 12 CurvePromotion::Line
    let line_count = result.curves.iter()
        .filter(|c| matches!(c, CurvePromotion::Line { .. }))
        .count();
    assert_eq!(line_count, 12, "expected 12 LINEs, got {}", line_count);

    // Promotion: 6 PLANE → 6 SurfacePromotion::Plane
    let plane_count = result.surfaces.iter()
        .filter(|s| matches!(s, SurfacePromotion::Plane { .. }))
        .count();
    assert_eq!(plane_count, 6, "expected 6 PLANEs, got {}", plane_count);
}

#[test]
fn b4_cube_lines_have_correct_geometry() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let result = StepImporter::new().parse_file(&path).unwrap();

    // 모든 LINE 의 start/end 가 [0, 1] 범위 안에 있어야 함 (unit cube)
    let mut endpoints_in_unit_cube = 0;
    let mut total_lines = 0;
    for c in &result.curves {
        if let CurvePromotion::Line { start, end, parameter_range } = c {
            total_lines += 1;
            // Endpoints in [0-tol, 1+tol]
            for p in [*start, *end] {
                for x in p {
                    assert!(
                        x >= -TOLERANCE && x <= 1.0 + TOLERANCE,
                        "line endpoint {} out of unit cube range", x,
                    );
                }
            }
            // Parameter range [0, 1.0] (magnitude 1.0)
            assert_eq!(
                parameter_range,
                &Some([0.0, 1.0]),
                "line parameter range should be [0, 1] (mag 1.0)",
            );
            endpoints_in_unit_cube += 1;
        }
    }
    assert_eq!(total_lines, 12);
    assert_eq!(endpoints_in_unit_cube, 12);
}

#[test]
fn b4_cube_planes_have_correct_normals() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let result = StepImporter::new().parse_file(&path).unwrap();

    // 6 face 의 normal 이 ±x, ±y, ±z 중 하나여야 함
    let cardinal_normals: Vec<[f64; 3]> = vec![
        [1.0, 0.0, 0.0], [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0], [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0], [0.0, 0.0, -1.0],
    ];

    let mut matched = 0;
    for s in &result.surfaces {
        if let SurfacePromotion::Plane { normal, .. } = s {
            let is_cardinal = cardinal_normals.iter()
                .any(|c| approx_eq3(*normal, *c, TOLERANCE));
            assert!(
                is_cardinal,
                "plane normal {:?} not cardinal axis",
                normal,
            );
            matched += 1;
        }
    }
    assert_eq!(matched, 6);
}

#[test]
fn b4_cube_planes_origins_at_cube_vertices() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let result = StepImporter::new().parse_file(&path).unwrap();

    // 모든 plane origin 이 cube 의 vertex 중 하나
    let cube_vertices: Vec<[f64; 3]> = vec![
        [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0], [1.0, 0.0, 1.0], [1.0, 1.0, 1.0], [0.0, 1.0, 1.0],
    ];

    for s in &result.surfaces {
        if let SurfacePromotion::Plane { origin, .. } = s {
            let is_vertex = cube_vertices.iter()
                .any(|v| approx_eq3(*origin, *v, TOLERANCE));
            assert!(
                is_vertex,
                "plane origin {:?} not a cube vertex",
                origin,
            );
        }
    }
}

#[test]
fn b4_cube_no_warnings_for_valid_input() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let result = StepImporter::new().parse_file(&path).unwrap();

    // Cube fixture 는 직접 매핑 가능 entity 만 사용 → warnings 0
    assert!(
        result.warnings.is_empty(),
        "expected no warnings for valid cube fixture, got: {:?}",
        result.warnings,
    );
}

#[test]
fn b4_cube_round_trip_geometric_invariants() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cube.stp");
    let result = StepImporter::new().parse_file(&path).unwrap();

    // ADR-035 P20.E #2 — 정확도 측정 (1e-3 mm)
    // Cube 의 모든 edge 는 길이 1.0 (parameterRange.high - low = 1.0)
    for c in &result.curves {
        if let CurvePromotion::Line { start, end, parameter_range } = c {
            let length = (
                (end[0] - start[0]).powi(2)
                + (end[1] - start[1]).powi(2)
                + (end[2] - start[2]).powi(2)
            ).sqrt();
            assert!(
                (length - 1.0).abs() < TOLERANCE,
                "cube edge length {} != 1.0 (P20.E #2 violation)",
                length,
            );
            // Parameter range = [0, length]
            if let Some([t0, t1]) = parameter_range {
                assert!(
                    (t1 - t0 - length).abs() < TOLERANCE,
                    "parameter_range span {} != length {}",
                    t1 - t0, length,
                );
            }
        }
    }

    // 6 plane 의 normal 길이 = 1.0 (DIRECTION normalize 검증)
    for s in &result.surfaces {
        if let SurfacePromotion::Plane { normal, .. } = s {
            let mag_sq = normal[0]*normal[0] + normal[1]*normal[1] + normal[2]*normal[2];
            assert!(
                (mag_sq - 1.0).abs() < TOLERANCE,
                "plane normal not unit length: |n|² = {}",
                mag_sq,
            );
        }
    }
}
