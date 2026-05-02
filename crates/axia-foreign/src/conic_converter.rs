//! Conic curve → NURBS 변환 (ADR-036 P21.1, Piegl & Tiller §7).
//!
//! STEP 의 ELLIPSE / PARABOLA / HYPERBOLA 는 AxiA `AnalyticCurve` enum 에
//! 직접 대응 variant 가 없음 → rational quadratic NURBS 표현으로 변환.
//! 이 표현은 lossless (정확한 conic 동치).
//!
//! ## References
//!
//! Piegl, L. & Tiller, W. *The NURBS Book*, 2nd ed. Springer, 1997.
//! - **A7.1** — Make rational quadratic NURBS for full ellipse arc
//! - **A7.4** — Make non-rational quadratic Bezier for parabola
//! - **A7.5** — Make rational quadratic NURBS for hyperbola
//!
//! ## MVP scope (B5)
//!
//! 본 commit:
//! - ✅ Full ellipse (Piegl A7.1, 9 control points)
//! - ⏳ Trimmed ellipse (start_angle ~ end_angle): basis 의 full conversion
//!      후 TRIMMED_CURVE wrapper 가 parameter_range 갱신 (B2 logic 재활용)
//! - ⏳ Parabola (A7.4) — 무한 curve, trim 필수
//! - ⏳ Hyperbola (A7.5) — 무한 curve, trim 필수

/// Output of ellipse-to-NURBS conversion (Piegl A7.1).
///
/// 9 control points + 9 weights + 12 knots, degree 2. 단위 원의 경우 정확.
/// 타원의 경우 affine 변환으로 정확 보장.
#[derive(Clone, Debug)]
pub struct EllipseNurbsData {
    pub control_pts: Vec<[f64; 3]>,  // 9 points
    pub weights: Vec<f64>,           // 9 weights
    pub knots: Vec<f64>,             // 12 knots
    pub degree: usize,               // 2
}

/// Full ellipse → rational quadratic NURBS curve (Piegl A7.1).
///
/// 입력 conjugate semi-axes (이미 스케일된 벡터):
/// - `x_axis`: 길이 = a (semi-major), unit dir 의 a 배
/// - `y_axis`: 길이 = b (semi-minor), unit dir 의 b 배 (x_axis ⊥ y_axis 가정)
///
/// 출력: 9 control points / weights / 12 knots (closed quadratic NURBS):
/// - Weights: `[1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]`
/// - Knots:   `[0, 0, 0, 1/4, 1/4, 1/2, 1/2, 3/4, 3/4, 1, 1, 1]`
///
/// 평가 정확도:
/// - t = 0   → center + x_axis
/// - t = 1/4 → center + y_axis
/// - t = 1/2 → center - x_axis
/// - t = 3/4 → center - y_axis
/// - t = 1   → center + x_axis (closing)
pub fn full_ellipse_to_nurbs(
    center: [f64; 3],
    x_axis: [f64; 3],
    y_axis: [f64; 3],
) -> EllipseNurbsData {
    let s: f64 = std::f64::consts::FRAC_1_SQRT_2;  // √2/2

    // Helper: center + coef_x * x_axis + coef_y * y_axis
    let p = |cx: f64, cy: f64| -> [f64; 3] {
        [
            center[0] + cx * x_axis[0] + cy * y_axis[0],
            center[1] + cx * x_axis[1] + cy * y_axis[1],
            center[2] + cx * x_axis[2] + cy * y_axis[2],
        ]
    };

    // Piegl A7.1: 9 control points around ellipse perimeter.
    // P_2k = corners (on-ellipse points), P_2k+1 = control 'kink' points.
    let control_pts = vec![
        p( 1.0,  0.0),  // P0: +X axis
        p( 1.0,  1.0),  // P1: corner +X +Y
        p( 0.0,  1.0),  // P2: +Y axis
        p(-1.0,  1.0),  // P3: corner -X +Y
        p(-1.0,  0.0),  // P4: -X axis
        p(-1.0, -1.0),  // P5: corner -X -Y
        p( 0.0, -1.0),  // P6: -Y axis
        p( 1.0, -1.0),  // P7: corner +X -Y
        p( 1.0,  0.0),  // P8: +X axis (closing, = P0)
    ];

    let weights = vec![
        1.0, s, 1.0, s, 1.0, s, 1.0, s, 1.0,
    ];

    let knots = vec![
        0.0, 0.0, 0.0,
        0.25, 0.25,
        0.5, 0.5,
        0.75, 0.75,
        1.0, 1.0, 1.0,
    ];

    EllipseNurbsData {
        control_pts, weights, knots, degree: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq3(a: [f64; 3], b: [f64; 3], eps: f64) -> bool {
        (0..3).all(|i| (a[i] - b[i]).abs() < eps)
    }

    #[test]
    fn full_ellipse_unit_circle_control_points() {
        // Unit circle: a = b = 1, center at origin
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        assert_eq!(data.control_pts.len(), 9);
        assert_eq!(data.weights.len(), 9);
        assert_eq!(data.knots.len(), 12);
        assert_eq!(data.degree, 2);

        // Spot-check key control points (Piegl A7.1 standard)
        assert!(approx_eq3(data.control_pts[0], [1.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [0.0, 1.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[4], [-1.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[6], [0.0, -1.0, 0.0], 1e-12));
        // P8 should equal P0 (closing)
        assert_eq!(data.control_pts[0], data.control_pts[8]);

        // Corner points (P1, P3, P5, P7) at unit "kink" positions
        assert!(approx_eq3(data.control_pts[1], [1.0, 1.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[7], [1.0, -1.0, 0.0], 1e-12));
    }

    #[test]
    fn full_ellipse_weights_alternate_one_and_sqrt2_half() {
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let s = std::f64::consts::FRAC_1_SQRT_2;
        let expected = vec![1.0, s, 1.0, s, 1.0, s, 1.0, s, 1.0];
        for (i, (a, b)) in data.weights.iter().zip(expected.iter()).enumerate() {
            assert!(
                (a - b).abs() < 1e-15,
                "weight[{}] = {} != {}", i, a, b,
            );
        }
    }

    #[test]
    fn full_ellipse_knots_match_piegl_a71() {
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let expected = vec![
            0.0, 0.0, 0.0,
            0.25, 0.25,
            0.5, 0.5,
            0.75, 0.75,
            1.0, 1.0, 1.0,
        ];
        assert_eq!(data.knots, expected);

        // Knot count = n_ctrl + degree + 1 = 9 + 2 + 1 = 12
        assert_eq!(data.knots.len(), data.control_pts.len() + data.degree + 1);
    }

    #[test]
    fn full_ellipse_with_offset_center() {
        // Center at (10, 20, 30), unit ellipse
        let data = full_ellipse_to_nurbs(
            [10.0, 20.0, 30.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        assert!(approx_eq3(data.control_pts[0], [11.0, 20.0, 30.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [10.0, 21.0, 30.0], 1e-12));
        assert!(approx_eq3(data.control_pts[4], [9.0, 20.0, 30.0], 1e-12));
    }

    #[test]
    fn full_ellipse_with_axes_2_and_3() {
        // semi-major = 2 (x), semi-minor = 3 (y)
        // (note: y > x is allowed — STEP doesn't enforce major > minor here)
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],   // length 2
            [0.0, 3.0, 0.0],   // length 3
        );
        assert!(approx_eq3(data.control_pts[0], [2.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [0.0, 3.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[4], [-2.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[6], [0.0, -3.0, 0.0], 1e-12));
        // Corners scaled appropriately
        assert!(approx_eq3(data.control_pts[1], [2.0, 3.0, 0.0], 1e-12));
    }

    #[test]
    fn full_ellipse_with_3d_orientation() {
        // Ellipse on Y-Z plane: x_axis = +Y, y_axis = +Z
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [0.0, 5.0, 0.0],
            [0.0, 0.0, 7.0],
        );
        assert!(approx_eq3(data.control_pts[0], [0.0, 5.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [0.0, 0.0, 7.0], 1e-12));
        assert!(approx_eq3(data.control_pts[4], [0.0, -5.0, 0.0], 1e-12));
    }

    #[test]
    fn nurbs_evaluation_at_knot_breakpoints() {
        // Standard NURBS evaluation: at multi-knots t = 0, 0.25, 0.5, 0.75, 1
        // the curve should pass exactly through P0, P2, P4, P6, P8 respectively.
        // (Piegl A7.1 invariant — P0 P2 P4 P6 P8 are the on-curve points)
        //
        // 본 테스트는 데이터의 invariant 만 검증 (실제 evaluate 는
        // axia-geo 의 NURBS evaluator 가 담당). 회귀 가드 차원.
        let data = full_ellipse_to_nurbs(
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        // P0 P2 P4 P6 P8 = on-curve, weight = 1.0
        for &i in &[0, 2, 4, 6, 8] {
            assert_eq!(
                data.weights[i], 1.0,
                "P{} should have weight 1.0 (on-curve point)", i,
            );
        }
        // P1 P3 P5 P7 = off-curve (corners), weight = √2/2
        for &i in &[1, 3, 5, 7] {
            assert!(
                (data.weights[i] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15,
                "P{} should have weight √2/2 (corner)", i,
            );
        }
    }
}
