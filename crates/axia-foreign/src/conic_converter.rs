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

/// Output of parabola-to-Bezier conversion (Piegl A7.4).
///
/// Trimmed parabola arc → 3 control point quadratic Bezier (non-rational).
#[derive(Clone, Debug)]
pub struct ParabolaBezierData {
    pub control_pts: Vec<[f64; 3]>,  // 3 points
    pub knots: Vec<f64>,             // 6 knots [0, 0, 0, 1, 1, 1]
    pub degree: usize,               // 2
}

/// Output of hyperbola-to-NURBS conversion (Piegl A7.5).
///
/// Trimmed hyperbola arc → 3 control point rational quadratic NURBS.
#[derive(Clone, Debug)]
pub struct HyperbolaNurbsData {
    pub control_pts: Vec<[f64; 3]>,  // 3 points
    pub weights: Vec<f64>,           // 3 weights [1, cosh(h), 1]
    pub knots: Vec<f64>,             // 6 knots [0, 0, 0, 1, 1, 1]
    pub degree: usize,               // 2
}

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

/// Trimmed parabola arc → quadratic Bezier (Piegl & Tiller A7.4).
///
/// Parabola in placement coords: `y² = 4 * focal_dist * x`, with vertex at
/// `center`, axis of symmetry along `x_axis`, perpendicular along `y_axis`.
/// Natural parameter u where `P(u) = (u²/(4f), u, 0)` in local coords.
///
/// 입력:
/// - `focal_dist`: f (positive Real, distance from vertex to focus)
/// - `u1, u2`: trim 범위의 자연 파라미터 (u 좌표 = y in local frame)
/// - `center, x_axis, y_axis`: placement frame (x_axis = ref_dir unit,
///   y_axis = (axis × ref_dir) unit)
///
/// 출력 (control points in world frame):
/// - P0 = center + (u1²/(4f)) * x_axis + u1 * y_axis
/// - P1 = center + (u1*u2/(4f)) * x_axis + (u1+u2)/2 * y_axis
/// - P2 = center + (u2²/(4f)) * x_axis + u2 * y_axis
/// - Knots [0, 0, 0, 1, 1, 1], degree 2
///
/// **Derivation**: Tangent at u = (u/(2f), 1, 0). Solving tangent
/// intersection at u=u1 and u=u2 gives α = (u2-u1)/2, β = -α, leading
/// to P1 above (Piegl & Tiller §7.5.4).
pub fn trimmed_parabola_to_bezier(
    focal_dist: f64,
    u1: f64,
    u2: f64,
    center: [f64; 3],
    x_axis: [f64; 3],
    y_axis: [f64; 3],
) -> ParabolaBezierData {
    let inv_4f = 1.0 / (4.0 * focal_dist);

    let local_to_world = |x: f64, y: f64| -> [f64; 3] {
        [
            center[0] + x * x_axis[0] + y * y_axis[0],
            center[1] + x * x_axis[1] + y * y_axis[1],
            center[2] + x * x_axis[2] + y * y_axis[2],
        ]
    };

    let p0 = local_to_world(u1 * u1 * inv_4f, u1);
    let p1 = local_to_world(u1 * u2 * inv_4f, 0.5 * (u1 + u2));
    let p2 = local_to_world(u2 * u2 * inv_4f, u2);

    ParabolaBezierData {
        control_pts: vec![p0, p1, p2],
        knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
        degree: 2,
    }
}

/// Trimmed hyperbola arc (single branch) → rational quadratic NURBS
/// (Piegl & Tiller A7.5).
///
/// Hyperbola in placement coords: `(x/a)² - (y/b)² = 1` (right branch),
/// parameterization `P(u) = (a*cosh(u), b*sinh(u), 0)` in local frame.
///
/// 입력:
/// - `a, b`: semi_axis, semi_imag_axis (positive Real)
/// - `u1, u2`: trim 범위의 자연 파라미터 (hyperbolic angle)
/// - `center, x_axis, y_axis`: placement frame
///
/// 출력 (3 control points + 3 weights):
/// - P0 = (a*cosh(u1), b*sinh(u1)) — local → world via x_axis/y_axis
/// - P1 = (a*cosh(m)/cosh(h), b*sinh(m)/cosh(h)) where m=(u1+u2)/2, h=(u2-u1)/2
/// - P2 = (a*cosh(u2), b*sinh(u2))
/// - Weights = `[1, cosh(h), 1]`
/// - Knots [0, 0, 0, 1, 1, 1], degree 2
///
/// **Derivation** (Piegl & Tiller §7.5.5): Tangent at u = (a*sinh(u),
/// b*cosh(u)). Tangent intersection at u=u1, u=u2 yields
/// α = tanh(h), giving P1 = M_curve / cosh(h). Setting w_1 = cosh(h)
/// makes B(0.5) = M_curve (parametric center on the curve).
pub fn trimmed_hyperbola_to_nurbs(
    a: f64,
    b: f64,
    u1: f64,
    u2: f64,
    center: [f64; 3],
    x_axis: [f64; 3],
    y_axis: [f64; 3],
) -> HyperbolaNurbsData {
    let m = 0.5 * (u1 + u2);
    let h = 0.5 * (u2 - u1);
    let cosh_h = h.cosh();

    let local_to_world = |x: f64, y: f64| -> [f64; 3] {
        [
            center[0] + x * x_axis[0] + y * y_axis[0],
            center[1] + x * x_axis[1] + y * y_axis[1],
            center[2] + x * x_axis[2] + y * y_axis[2],
        ]
    };

    let p0 = local_to_world(a * u1.cosh(), b * u1.sinh());
    let p1 = local_to_world(a * m.cosh() / cosh_h, b * m.sinh() / cosh_h);
    let p2 = local_to_world(a * u2.cosh(), b * u2.sinh());

    HyperbolaNurbsData {
        control_pts: vec![p0, p1, p2],
        weights: vec![1.0, cosh_h, 1.0],
        knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
        degree: 2,
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

    // ─── Parabola (Piegl A7.4) ────────────────────────────────────────

    #[test]
    fn parabola_symmetric_trim_y2_eq_4fx() {
        // Parabola y² = 4*1*x = 4x, trimmed [-2, 2]
        // P0 = (4/4, -2) = (1, -2)
        // P1 = (-4/4, 0) = (-1, 0)  [u1*u2/(4f) = -4/4 = -1]
        // P2 = (1, 2)
        let data = trimmed_parabola_to_bezier(
            1.0, -2.0, 2.0,
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],  // x_axis = ref (axis of symmetry)
            [0.0, 1.0, 0.0],  // y_axis
        );
        assert!(approx_eq3(data.control_pts[0], [1.0, -2.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[1], [-1.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [1.0, 2.0, 0.0], 1e-12));
        assert_eq!(data.knots, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
        assert_eq!(data.degree, 2);
    }

    #[test]
    fn parabola_asymmetric_trim() {
        // y² = 4*2*x = 8x, trim [1, 4]
        // f = 2, 1/(4f) = 1/8
        // P0 = (1/8, 1)
        // P1 = (4/8, 2.5) = (0.5, 2.5)  [u1*u2/(4f) = 4/8 = 0.5]
        // P2 = (16/8, 4) = (2.0, 4)
        let data = trimmed_parabola_to_bezier(
            2.0, 1.0, 4.0,
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        assert!(approx_eq3(data.control_pts[0], [0.125, 1.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[1], [0.5, 2.5, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [2.0, 4.0, 0.0], 1e-12));
    }

    #[test]
    fn parabola_offset_center_3d() {
        // Trim [-1, 1] of y² = 4x, center at (10, 20, 30), Y-Z plane
        let data = trimmed_parabola_to_bezier(
            1.0, -1.0, 1.0,
            [10.0, 20.0, 30.0],
            [0.0, 1.0, 0.0],  // x_axis = +Y in world
            [0.0, 0.0, 1.0],  // y_axis = +Z in world
        );
        // Local P0 = (1/4, -1) → world = (10, 20+0.25, 30-1) = (10, 20.25, 29)
        assert!(approx_eq3(data.control_pts[0], [10.0, 20.25, 29.0], 1e-12));
        // Local P2 = (0.25, 1) → (10, 20.25, 31)
        assert!(approx_eq3(data.control_pts[2], [10.0, 20.25, 31.0], 1e-12));
        // Local P1 = (-0.25, 0) → (10, 19.75, 30)
        assert!(approx_eq3(data.control_pts[1], [10.0, 19.75, 30.0], 1e-12));
    }

    // ─── Hyperbola (Piegl A7.5) ───────────────────────────────────────

    #[test]
    fn hyperbola_symmetric_trim_zero_axis() {
        // x²/1 - y²/1 = 1 (rectangular hyperbola), trim [-1, 1]
        // m = 0, h = 1
        // P0 = (cosh(-1), sinh(-1)) ≈ (1.5430806, -1.1752012)
        // P2 = (cosh(1), sinh(1)) ≈ (1.5430806, 1.1752012)  (symmetric)
        // P1 = (cosh(0)/cosh(1), sinh(0)/cosh(1)) = (1/cosh(1), 0) ≈ (0.6480543, 0)
        // weight w_1 = cosh(1) ≈ 1.5430806
        let data = trimmed_hyperbola_to_nurbs(
            1.0, 1.0, -1.0, 1.0,
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let cosh1 = 1.0_f64.cosh();
        let sinh1 = 1.0_f64.sinh();
        assert!(approx_eq3(data.control_pts[0], [cosh1, -sinh1, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [cosh1, sinh1, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[1], [1.0 / cosh1, 0.0, 0.0], 1e-12));
        assert_eq!(data.weights[0], 1.0);
        assert_eq!(data.weights[2], 1.0);
        assert!((data.weights[1] - cosh1).abs() < 1e-12);
        assert_eq!(data.knots, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
        assert_eq!(data.degree, 2);
    }

    #[test]
    fn hyperbola_with_a_2_b_3() {
        // x²/4 - y²/9 = 1, trim [0, 2]
        // m = 1, h = 1
        // P0 = (2*cosh(0), 3*sinh(0)) = (2, 0)
        // P2 = (2*cosh(2), 3*sinh(2))
        // P1 = (2*cosh(1)/cosh(1), 3*sinh(1)/cosh(1)) = (2, 3*tanh(1))
        // w_1 = cosh(1)
        let data = trimmed_hyperbola_to_nurbs(
            2.0, 3.0, 0.0, 2.0,
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        );
        let cosh2 = 2.0_f64.cosh();
        let sinh2 = 2.0_f64.sinh();
        let tanh1 = 1.0_f64.tanh();
        assert!(approx_eq3(data.control_pts[0], [2.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[2], [2.0 * cosh2, 3.0 * sinh2, 0.0], 1e-12));
        assert!(approx_eq3(data.control_pts[1], [2.0, 3.0 * tanh1, 0.0], 1e-12));
    }

    #[test]
    fn hyperbola_3d_orientation() {
        // Trim [-0.5, 0.5] in Y-Z plane (placement.x = +Y, .y = +Z)
        let data = trimmed_hyperbola_to_nurbs(
            1.0, 1.0, -0.5, 0.5,
            [10.0, 20.0, 30.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        let cosh_half = 0.5_f64.cosh();
        let sinh_half = 0.5_f64.sinh();
        // P0 = (cosh(-0.5), sinh(-0.5)) local = (cosh(0.5), -sinh(0.5)) world
        // → (10, 20 + cosh(0.5), 30 - sinh(0.5))
        assert!(approx_eq3(
            data.control_pts[0],
            [10.0, 20.0 + cosh_half, 30.0 - sinh_half],
            1e-12,
        ));
    }
}
