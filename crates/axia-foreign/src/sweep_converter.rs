//! Sweep curve → NURBS surface 변환 (ADR-036 P21.2, Piegl & Tiller §8).
//!
//! STEP 의 `SURFACE_OF_LINEAR_EXTRUSION` / `SURFACE_OF_REVOLUTION` 는 AxiA
//! `AnalyticSurface` enum 에 직접 대응 variant 가 없음 → tensor-product
//! NURBS surface 표현으로 변환. lossless (정확한 sweep 동치).
//!
//! ## References
//!
//! Piegl, L. & Tiller, W. *The NURBS Book*, 2nd ed. Springer, 1997.
//! - **A8.1** — Make NURBS surface of revolution (full 360°)
//! - **A8.2** — Make NURBS surface of linear extrusion
//!
//! ## MVP scope (B6)
//!
//! - ✅ Linear extrusion (Piegl A8.2, degree 1 in v direction)
//! - ✅ Full revolution (Piegl A8.1, degree 2 rational in v direction)

/// Output of sweep-to-NURBS-surface conversion.
///
/// Tensor product 표현: ctrl_grid[i][j] (row-major, i = u, j = v).
#[derive(Clone, Debug)]
pub struct SweepNurbsData {
    pub ctrl_grid: Vec<Vec<[f64; 3]>>,
    pub weights_grid: Vec<Vec<f64>>,
    pub knots_u: Vec<f64>,
    pub knots_v: Vec<f64>,
    pub deg_u: usize,
    pub deg_v: usize,
}

/// Linear extrusion of a profile curve along a direction (Piegl A8.2).
///
/// Input:
/// - `profile_pts`, `profile_weights`, `profile_knots`, `profile_degree`:
///   profile curve (NURBS) representation. Line: 2 CPs deg 1, Circle: 9 CPs
///   deg 2 rational, BSpline/NURBS: as-is.
/// - `direction`: extrusion direction (이미 unit-normalized 권장)
/// - `magnitude`: extrusion length (positive Real)
///
/// Output: NURBS surface where:
/// - u direction = profile curve parameter (degree = profile_degree)
/// - v direction = extrusion (degree 1, 2 control rows)
/// - ctrl_grid[0][j] = profile_pts[j]
/// - ctrl_grid[1][j] = profile_pts[j] + magnitude * direction
/// - weights_grid[i][j] = profile_weights[j] (v-direction weights all 1)
/// - knots_u = profile_knots
/// - knots_v = [0, 0, 1, 1]
/// - deg_u = profile_degree, deg_v = 1
pub fn linear_extrusion_to_nurbs(
    profile_pts: &[[f64; 3]],
    profile_weights: &[f64],
    profile_knots: &[f64],
    profile_degree: usize,
    direction: [f64; 3],
    magnitude: f64,
) -> SweepNurbsData {
    let n_profile = profile_pts.len();

    // Row 0 (v=0): 원본 profile
    let row0: Vec<[f64; 3]> = profile_pts.to_vec();

    // Row 1 (v=1): profile + magnitude * direction
    let row1: Vec<[f64; 3]> = profile_pts.iter()
        .map(|p| [
            p[0] + magnitude * direction[0],
            p[1] + magnitude * direction[1],
            p[2] + magnitude * direction[2],
        ])
        .collect();

    // weights_grid: 두 row 모두 profile weights 그대로
    // (v-direction 은 non-rational degree 1 라 v-weights 영향 없음)
    let weights_row: Vec<f64> = profile_weights.to_vec();
    let weights_grid = vec![weights_row.clone(), weights_row];

    SweepNurbsData {
        ctrl_grid: vec![row0, row1],  // 2 rows × n_profile cols
        weights_grid,
        knots_u: profile_knots.to_vec(),
        knots_v: vec![0.0, 0.0, 1.0, 1.0],
        deg_u: profile_degree,
        deg_v: 1,
    }
}

/// Full 360° revolution of a profile curve around an axis (Piegl A8.1).
///
/// 각 profile control point 가 axis 주위 9개 control point 의 원으로
/// 확장 (Piegl A7.1 의 full circle 패턴 재활용).
///
/// Input:
/// - profile (control net + weights + knots + degree): u 방향 그대로
/// - `axis_origin`, `axis_dir` (unit): 회전 축
///
/// Output: NURBS surface where:
/// - u direction = profile parameter (degree = profile_degree)
/// - v direction = revolution angle 0 → 2π (degree 2, 9 control points)
/// - knots_v = `[0, 0, 0, 1/4, 1/4, 1/2, 1/2, 3/4, 3/4, 1, 1, 1]`
/// - 각 profile CP 마다 9개 v-CP 생성 (full circle 의 9 corner points)
/// - v-weights 패턴: `[1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]`
/// - 각 (u, v) cell weight = profile_weights[u] × v_weight[v]
pub fn full_revolution_to_nurbs(
    profile_pts: &[[f64; 3]],
    profile_weights: &[f64],
    profile_knots: &[f64],
    profile_degree: usize,
    axis_origin: [f64; 3],
    axis_dir: [f64; 3],
) -> SweepNurbsData {
    let s: f64 = std::f64::consts::FRAC_1_SQRT_2;  // √2/2

    let n_profile = profile_pts.len();
    let n_v = 9;  // Piegl A7.1: 9 control points around full circle

    // Per-CP 9-point ring around the axis.
    // d = projection-perpendicular vector from axis to CP
    // radius = |d|
    // Build orthonormal frame (d_hat, t_hat) in plane perpendicular to axis
    // 9 CPs: (P, P+r*t, P_corner_1, ..., closing P)
    //
    // Pattern (matches Piegl A7.1 ellipse with a=b=radius, oriented in
    // (d_hat, axis_dir × d_hat) plane):
    //   k=0: P + r * d_hat                       (on-curve, w=1)
    //   k=1: P + r * d_hat + r * t_hat           (corner, w=s)
    //   k=2: P + r * t_hat                       (on-curve, w=1)
    //   k=3: P - r * d_hat + r * t_hat           (corner, w=s)
    //   k=4: P - r * d_hat                       (on-curve, w=1)
    //   k=5: P - r * d_hat - r * t_hat           (corner, w=s)
    //   k=6: P - r * t_hat                       (on-curve, w=1)
    //   k=7: P + r * d_hat - r * t_hat           (corner, w=s)
    //   k=8: P + r * d_hat                       (closing, = k=0)

    let v_weight = |k: usize| if k % 2 == 0 { 1.0 } else { s };

    let mut ctrl_grid: Vec<Vec<[f64; 3]>> = Vec::with_capacity(n_profile);
    let mut weights_grid: Vec<Vec<f64>> = Vec::with_capacity(n_profile);

    for (i, profile_pt) in profile_pts.iter().enumerate() {
        let pw = profile_weights[i];

        // d = (CP - axis_origin) - axis_dir * ((CP - axis_origin) · axis_dir)
        let dp = [
            profile_pt[0] - axis_origin[0],
            profile_pt[1] - axis_origin[1],
            profile_pt[2] - axis_origin[2],
        ];
        let proj = dp[0] * axis_dir[0] + dp[1] * axis_dir[1] + dp[2] * axis_dir[2];
        let d = [
            dp[0] - axis_dir[0] * proj,
            dp[1] - axis_dir[1] * proj,
            dp[2] - axis_dir[2] * proj,
        ];
        let r_sq = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];

        // Center on axis = profile_pt - d
        let on_axis = [
            profile_pt[0] - d[0],
            profile_pt[1] - d[1],
            profile_pt[2] - d[2],
        ];

        let mut row: Vec<[f64; 3]> = Vec::with_capacity(n_v);
        let mut w_row: Vec<f64> = Vec::with_capacity(n_v);

        if r_sq < 1e-20 {
            // Profile CP on the axis — 9 CPs all collapse to profile point
            for k in 0..n_v {
                row.push(*profile_pt);
                w_row.push(pw * v_weight(k));
            }
        } else {
            // d_hat = d / |d|, t_hat = axis_dir × d_hat (perpendicular in plane)
            let r = r_sq.sqrt();
            let d_hat = [d[0] / r, d[1] / r, d[2] / r];
            let t_hat = [
                axis_dir[1] * d_hat[2] - axis_dir[2] * d_hat[1],
                axis_dir[2] * d_hat[0] - axis_dir[0] * d_hat[2],
                axis_dir[0] * d_hat[1] - axis_dir[1] * d_hat[0],
            ];

            // 9-point ring (Piegl A7.1)
            // Coefficient pairs (cd, ct) — multiplied by r and added to on_axis.
            let coefs: [(f64, f64); 9] = [
                ( 1.0,  0.0),  // k=0: +d
                ( 1.0,  1.0),  // k=1: corner +d+t
                ( 0.0,  1.0),  // k=2: +t
                (-1.0,  1.0),  // k=3: corner -d+t
                (-1.0,  0.0),  // k=4: -d
                (-1.0, -1.0),  // k=5: corner -d-t
                ( 0.0, -1.0),  // k=6: -t
                ( 1.0, -1.0),  // k=7: corner +d-t
                ( 1.0,  0.0),  // k=8: +d (closing)
            ];

            for (k, (cd, ct)) in coefs.iter().enumerate() {
                let pt = [
                    on_axis[0] + r * cd * d_hat[0] + r * ct * t_hat[0],
                    on_axis[1] + r * cd * d_hat[1] + r * ct * t_hat[1],
                    on_axis[2] + r * cd * d_hat[2] + r * ct * t_hat[2],
                ];
                row.push(pt);
                w_row.push(pw * v_weight(k));
            }
        }

        ctrl_grid.push(row);
        weights_grid.push(w_row);
    }

    let knots_v = vec![
        0.0, 0.0, 0.0,
        0.25, 0.25,
        0.5, 0.5,
        0.75, 0.75,
        1.0, 1.0, 1.0,
    ];

    SweepNurbsData {
        ctrl_grid,
        weights_grid,
        knots_u: profile_knots.to_vec(),
        knots_v,
        deg_u: profile_degree,
        deg_v: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq3(a: [f64; 3], b: [f64; 3], eps: f64) -> bool {
        (0..3).all(|i| (a[i] - b[i]).abs() < eps)
    }

    // ─── Linear extrusion (Piegl A8.2) ───────────────────────────────

    #[test]
    fn linear_extrusion_line_profile_to_quad() {
        // Line profile from (0,0,0) → (1,0,0), extrude +Z by 5
        let data = linear_extrusion_to_nurbs(
            &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
            &[1.0, 1.0],
            &[0.0, 0.0, 1.0, 1.0],
            1,
            [0.0, 0.0, 1.0],
            5.0,
        );
        assert_eq!(data.ctrl_grid.len(), 2);
        assert_eq!(data.ctrl_grid[0].len(), 2);  // 2 profile CPs
        assert_eq!(data.ctrl_grid[1].len(), 2);
        // Row 0: original profile
        assert!(approx_eq3(data.ctrl_grid[0][0], [0., 0., 0.], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][1], [1., 0., 0.], 1e-12));
        // Row 1: extruded by +Z*5
        assert!(approx_eq3(data.ctrl_grid[1][0], [0., 0., 5.], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[1][1], [1., 0., 5.], 1e-12));
        // Knot vector
        assert_eq!(data.knots_v, vec![0.0, 0.0, 1.0, 1.0]);
        assert_eq!(data.deg_u, 1);
        assert_eq!(data.deg_v, 1);
    }

    #[test]
    fn linear_extrusion_preserves_profile_weights() {
        // Profile = circle 9 CPs (rational), extrude → tensor surface
        // 모든 row 의 weight 가 profile weights 와 동일
        let s: f64 = std::f64::consts::FRAC_1_SQRT_2;
        let weights = vec![1.0, s, 1.0, s, 1.0, s, 1.0, s, 1.0];
        let pts: Vec<[f64; 3]> = (0..9).map(|_| [0.0, 0.0, 0.0]).collect();
        let knots = vec![0.0, 0.0, 0.0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1.0, 1.0, 1.0];

        let data = linear_extrusion_to_nurbs(
            &pts, &weights, &knots, 2,
            [0.0, 0.0, 1.0], 3.0,
        );
        // weights_grid[0] = weights_grid[1] = weights (extrude 가 v-방향 단순 복제)
        assert_eq!(data.weights_grid[0], weights);
        assert_eq!(data.weights_grid[1], weights);
    }

    #[test]
    fn linear_extrusion_zero_magnitude_collapses_rows() {
        // Magnitude 0 → row 0 == row 1 (degenerate quad)
        let data = linear_extrusion_to_nurbs(
            &[[1.0, 2.0, 3.0]],
            &[1.0],
            &[0.0, 1.0],
            0,
            [0.0, 0.0, 1.0],
            0.0,
        );
        assert!(approx_eq3(data.ctrl_grid[0][0], [1., 2., 3.], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[1][0], [1., 2., 3.], 1e-12));
    }

    // ─── Full revolution (Piegl A8.1) ────────────────────────────────

    #[test]
    fn revolution_axis_aligned_profile_creates_circle() {
        // Profile = single point at (3, 0, 0), revolve around Z axis
        // → 9 CPs forming a circle of radius 3 in XY plane
        let data = full_revolution_to_nurbs(
            &[[3.0, 0.0, 0.0]],
            &[1.0],
            &[0.0, 1.0],
            0,
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        assert_eq!(data.ctrl_grid.len(), 1);  // 1 profile CP
        assert_eq!(data.ctrl_grid[0].len(), 9);  // 9 v-CPs around circle

        // Standard Piegl A7.1 pattern at radius 3:
        // k=0: (+r, 0)         on-curve, w=1
        // k=2: (0, +r)         on-curve, w=1
        // k=4: (-r, 0)         on-curve, w=1
        // k=6: (0, -r)         on-curve, w=1
        // k=8: (+r, 0)         closing
        // Note: t_hat = axis × d_hat = +Z × +X = +Y
        assert!(approx_eq3(data.ctrl_grid[0][0], [3.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][2], [0.0, 3.0, 0.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][4], [-3.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][6], [0.0, -3.0, 0.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][8], [3.0, 0.0, 0.0], 1e-12));

        // V-weights: [1, √2/2, 1, √2/2, ...]
        let s = std::f64::consts::FRAC_1_SQRT_2;
        for k in 0..9 {
            let expected = if k % 2 == 0 { 1.0 } else { s };
            assert!((data.weights_grid[0][k] - expected).abs() < 1e-12);
        }

        assert_eq!(data.deg_v, 2);
        assert_eq!(data.knots_v.len(), 12);
    }

    #[test]
    fn revolution_profile_on_axis_degenerates_to_point() {
        // Profile entirely on axis (Z-axis) → 9 CPs all collapse to profile point
        let data = full_revolution_to_nurbs(
            &[[0.0, 0.0, 5.0]],
            &[1.0],
            &[0.0, 1.0],
            0,
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        for k in 0..9 {
            assert!(approx_eq3(data.ctrl_grid[0][k], [0.0, 0.0, 5.0], 1e-12));
        }
    }

    #[test]
    fn revolution_two_point_profile_creates_two_rings() {
        // Profile = 2 points at radii 2 and 4 along Z axis
        // → tensor surface 2 × 9 = 18 CPs (2 rings)
        let data = full_revolution_to_nurbs(
            &[[2.0, 0.0, 0.0], [4.0, 0.0, 1.0]],
            &[1.0, 1.0],
            &[0.0, 0.0, 1.0, 1.0],
            1,
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        assert_eq!(data.ctrl_grid.len(), 2);
        assert_eq!(data.ctrl_grid[0].len(), 9);
        assert_eq!(data.ctrl_grid[1].len(), 9);

        // First ring at z=0, radius 2
        assert!(approx_eq3(data.ctrl_grid[0][0], [2.0, 0.0, 0.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[0][2], [0.0, 2.0, 0.0], 1e-12));

        // Second ring at z=1, radius 4
        assert!(approx_eq3(data.ctrl_grid[1][0], [4.0, 0.0, 1.0], 1e-12));
        assert!(approx_eq3(data.ctrl_grid[1][2], [0.0, 4.0, 1.0], 1e-12));
    }

    #[test]
    fn revolution_v_weights_pattern_per_profile_cp() {
        // 4-CP profile, 각 row 의 v-weights 가 [1, s, 1, s, 1, s, 1, s, 1]
        let s = std::f64::consts::FRAC_1_SQRT_2;
        let data = full_revolution_to_nurbs(
            &[[1.0, 0., 0.], [1.0, 0., 1.], [1.0, 0., 2.], [1.0, 0., 3.]],
            &[1.0, 1.0, 1.0, 1.0],
            &[0.0, 0.0, 0.5, 1.0, 1.0],
            1,
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        for u in 0..4 {
            for v in 0..9 {
                let expected = if v % 2 == 0 { 1.0 } else { s };
                assert!(
                    (data.weights_grid[u][v] - expected).abs() < 1e-12,
                    "weights_grid[{}][{}] = {} != {}",
                    u, v, data.weights_grid[u][v], expected,
                );
            }
        }
    }
}
