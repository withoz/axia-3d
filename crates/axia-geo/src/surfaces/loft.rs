//! ADR-056 Phase K Step 2 — Loft Surface (Skinning, Piegl A10.3).
//!
//! Constructs a NURBS surface that interpolates a sequence of section
//! curves. Each section curve becomes an iso-curve at parameter v_i.
//!
//! ## Constraint (MVP)
//!
//! All input curves must share the SAME degree and SAME knot vector
//! in the u-direction. If they don't, the caller must pre-unify via
//! Phase I (`elevate_degree_bspline`, `refine_knots_bspline`) first.
//!
//! ## Algorithm (Piegl A10.3)
//!
//! Given K section curves with n_u control points each:
//!   1. Compute v-parameters `v_0, ..., v_{K-1}` (chord length on the
//!      first control point of each section by default).
//!   2. Compute v-knots U_v from v-parameters via averaging
//!      (Piegl Eq. 9.8).
//!   3. For each u-row index i: globally interpolate the v-direction
//!      through `[ctrl_curves[k][i] for k in 0..K]` to produce one
//!      column of the output ctrl_grid.
//!   4. Result: surface with `(n_u, K)` control grid, knots
//!      `(knots_u_input, knots_v_computed)`, degrees
//!      `(degree_u_input, degree_v_input)`.

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::fitting::{
    compute_parameters, interpolate_with_params_and_knots, knots_for_interpolation,
    Parameterization,
};

/// Loft (skin) a surface through `curves`, each described as
/// `(control_points, knot_vector, degree_u)`. All curves must share
/// the same `degree_u` and identical `knot_vector` (length-equal,
/// element-equal within 1e-9). The v-direction degree is `degree_v`.
///
/// Returns: `(ctrl_grid, knots_u, knots_v, deg_u, deg_v)`.
/// Per AxiA convention: `ctrl_grid[u_idx][v_idx]`.
pub fn loft_surface(
    curves: &[(&[DVec3], &[f64], usize)],
    degree_v: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)> {
    if curves.len() < 2 {
        bail!("loft: need at least 2 section curves, got {}", curves.len());
    }
    if degree_v < 1 { bail!("degree_v must be >= 1"); }

    // 1. Validate uniform degree + knots
    let (ctrl0, knots0, deg_u) = curves[0];
    let n_u = ctrl0.len();
    for (i, (c, k, d)) in curves.iter().enumerate().skip(1) {
        if *d != deg_u {
            bail!("loft: curve[{}] degree {} ≠ first curve degree {}", i, d, deg_u);
        }
        if c.len() != n_u {
            bail!("loft: curve[{}] has {} ctrl pts ≠ first curve {}", i, c.len(), n_u);
        }
        if k.len() != knots0.len() {
            bail!("loft: curve[{}] knot length {} ≠ first {}", i, k.len(), knots0.len());
        }
        for (kj, (a, b)) in k.iter().zip(knots0.iter()).enumerate() {
            if (a - b).abs() > 1e-9 {
                bail!("loft: curve[{}] knot[{}] = {} ≠ first {}", i, kj, a, b);
            }
        }
    }

    let n_v = curves.len();
    if n_v < degree_v + 1 {
        bail!("loft: need >= degree_v+1 = {} curves, got {}", degree_v + 1, n_v);
    }

    // 2. Compute v-parameters from FIRST control points of each section
    //    (chord-length on representative points, per ADR-056 §2.3 lock).
    //    Reuses Step 1 `compute_parameters` (single SSOT for chord/centripetal/
    //    uniform), then strictifies to guarantee strict monotonic increase
    //    — protects against singular interpolation matrix when consecutive
    //    sections happen to share their first control point (chord = 0).
    let first_pts: Vec<DVec3> = curves.iter().map(|(c, _, _)| c[0]).collect();
    let v_params = strictify_params(
        compute_parameters(&first_pts, Parameterization::ChordLength)
    );

    // 3. Compute v-knots ONCE (CRITICAL: must be shared across all u-rows
    //    for tensor-product surface validity — per-row knot recomputation
    //    would yield a non-tensor-product result).
    let knots_v = knots_for_interpolation(&v_params, degree_v);

    // 4. For each u-control index i: interpolate the v-direction column
    //    using the SHARED (v_params, knots_v). Uses the fitting.rs
    //    helper that takes pre-computed params + knots.
    let mut ctrl_grid: Vec<Vec<DVec3>> = vec![Vec::with_capacity(n_v); n_u];
    for i in 0..n_u {
        let column: Vec<DVec3> = curves.iter().map(|(c, _, _)| c[i]).collect();
        let col_ctrl = interpolate_with_params_and_knots(
            &column, degree_v, &v_params, &knots_v,
        )?;
        ctrl_grid[i] = col_ctrl;
    }

    Ok((ctrl_grid, knots0.to_vec(), knots_v, deg_u, degree_v))
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Force strict monotonic increase on a [0, 1] parameter sequence.
/// If `compute_parameters` produces equal consecutive values (chord=0
/// case where two representative points coincide), bump them by `eps`
/// to keep the global interpolation matrix non-singular.
///
/// Per user review (ADR-056 Step 2 follow-up): this protects against
/// singular A in `interpolate_with_params_and_knots` when adjacent
/// sections share their first control point.
fn strictify_params(mut v: Vec<f64>) -> Vec<f64> {
    if v.len() < 2 { return v; }
    let eps = 1e-10;
    for i in 1..v.len() {
        if v[i] <= v[i - 1] + eps {
            v[i] = (v[i - 1] + eps).min(1.0);
        }
    }
    v[0] = 0.0;
    *v.last_mut().unwrap() = 1.0;
    v
}

// ────────────────────────────────────────────────────────────────────
// Tests (6 — ADR-056 §2.7 step 2 + 사용자 보강 Tests A/B)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surfaces::bspline_surface as bs;

    /// ADR-056 §2.7 #6 — Loft 2 lines forms a planar quad surface.
    #[test]
    fn loft_two_lines_returns_planar_surface() {
        // Two parallel lines from y=0 to y=10, at x=0 and x=5
        let line_a_ctrl = vec![DVec3::ZERO, DVec3::new(0.0, 10.0, 0.0)];
        let line_b_ctrl = vec![DVec3::new(5.0, 0.0, 0.0), DVec3::new(5.0, 10.0, 0.0)];
        let knots = vec![0.0, 0.0, 1.0, 1.0]; // degree 1 (linear)
        let curves = vec![
            (&line_a_ctrl[..], &knots[..], 1usize),
            (&line_b_ctrl[..], &knots[..], 1usize),
        ];
        let (grid, ku, kv, du, dv) = loft_surface(&curves, 1).unwrap();
        assert_eq!(du, 1);
        assert_eq!(dv, 1);
        assert_eq!(ku, knots);
        assert_eq!(kv, vec![0.0, 0.0, 1.0, 1.0]);
        assert_eq!(grid.len(), 2);     // n_u = 2
        assert_eq!(grid[0].len(), 2);  // n_v = 2

        // Evaluate at (0.5, 0.5) — should be (2.5, 5.0, 0.0) for planar quad
        let mid = bs::evaluate(&grid, &ku, &kv, du, dv, 0.5, 0.5).unwrap();
        assert!((mid - DVec3::new(2.5, 5.0, 0.0)).length() < 1e-9,
            "expected (2.5, 5.0, 0.0), got {:?}", mid);
    }

    /// ADR-056 §2.7 #7 — Loft 4 sections (degree_v = 3).
    #[test]
    fn loft_four_sections_cubic_v_direction() {
        // 4 horizontal lines at increasing z, each from x=0 to x=10
        let knots = vec![0.0, 0.0, 1.0, 1.0]; // degree 1 in u
        let make_section = |z: f64| -> Vec<DVec3> {
            vec![DVec3::new(0.0, 0.0, z), DVec3::new(10.0, 0.0, z)]
        };
        let s0 = make_section(0.0);
        let s1 = make_section(1.0);
        let s2 = make_section(2.0);
        let s3 = make_section(3.0);
        let curves = vec![
            (&s0[..], &knots[..], 1usize),
            (&s1[..], &knots[..], 1usize),
            (&s2[..], &knots[..], 1usize),
            (&s3[..], &knots[..], 1usize),
        ];
        let (grid, _ku, _kv, du, dv) = loft_surface(&curves, 3).unwrap();
        assert_eq!(du, 1);
        assert_eq!(dv, 3);
        assert_eq!(grid.len(), 2);     // n_u
        assert_eq!(grid[0].len(), 4);  // n_v
    }

    /// ADR-056 §2.7 #8 — Loft surface passes through input curves
    /// at v_k parameters.
    #[test]
    fn loft_passes_through_input_curves() {
        // 3 sections — verify the surface evaluated at v_k matches
        // the k-th section's evaluation.
        let knots_u = vec![0.0, 0.0, 0.5, 1.0, 1.0];  // degree 1, 3 ctrl
        let s0 = vec![DVec3::ZERO, DVec3::new(5.0, 0.0, 0.0), DVec3::new(10.0, 0.0, 0.0)];
        let s1 = vec![DVec3::new(0.0, 5.0, 0.0), DVec3::new(5.0, 5.0, 2.0), DVec3::new(10.0, 5.0, 0.0)];
        let s2 = vec![DVec3::new(0.0, 10.0, 0.0), DVec3::new(5.0, 10.0, 0.0), DVec3::new(10.0, 10.0, 0.0)];
        let curves = vec![
            (&s0[..], &knots_u[..], 1usize),
            (&s1[..], &knots_u[..], 1usize),
            (&s2[..], &knots_u[..], 1usize),
        ];
        let (grid, ku, kv, du, dv) = loft_surface(&curves, 2).unwrap();

        // v_params for chord-length on first control points (0,0,0)→(0,5,0)→(0,10,0):
        // chords 5, 5 → v = [0, 0.5, 1.0]
        // Verify surface at (u=0, v=0) is s0[0], at (u=0, v=1) is s2[0], etc.
        let p_at_v0_u0 = bs::evaluate(&grid, &ku, &kv, du, dv, 0.0, 0.0).unwrap();
        let p_at_v1_u0 = bs::evaluate(&grid, &ku, &kv, du, dv, 0.0, 1.0).unwrap();
        let p_at_v0_u1 = bs::evaluate(&grid, &ku, &kv, du, dv, 1.0, 0.0).unwrap();
        let p_at_v1_u1 = bs::evaluate(&grid, &ku, &kv, du, dv, 1.0, 1.0).unwrap();
        assert!((p_at_v0_u0 - s0[0]).length() < 1e-9, "corner (0,0): got {:?} expected {:?}", p_at_v0_u0, s0[0]);
        assert!((p_at_v1_u0 - s2[0]).length() < 1e-9, "corner (0,1): got {:?} expected {:?}", p_at_v1_u0, s2[0]);
        assert!((p_at_v0_u1 - *s0.last().unwrap()).length() < 1e-9);
        assert!((p_at_v1_u1 - *s2.last().unwrap()).length() < 1e-9);
    }

    /// ADR-056 §2.7 #9 — Loft rejects mismatched-degree sections.
    #[test]
    fn loft_rejects_mismatched_degrees() {
        let knots_d1 = vec![0.0, 0.0, 1.0, 1.0];
        let knots_d2 = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let s0 = vec![DVec3::ZERO, DVec3::new(10.0, 0.0, 0.0)];
        let s1 = vec![DVec3::new(0.0, 5.0, 0.0), DVec3::new(5.0, 5.0, 0.0), DVec3::new(10.0, 5.0, 0.0)];
        let curves = vec![
            (&s0[..], &knots_d1[..], 1usize),
            (&s1[..], &knots_d2[..], 2usize),  // mismatched degree
        ];
        assert!(loft_surface(&curves, 1).is_err());
    }

    /// 사용자 보강 Test A — 2 profiles + degree_v=1 → Ruled Surface.
    /// Property: ∀ u ∈ [0,1], S(u, 0) == profile0(u), S(u, 1) == profile1(u).
    #[test]
    fn loft_two_profiles_v1_is_ruled_surface() {
        use crate::curves::bspline as bs_c;
        // Two cubic profile curves (4 ctrl pts each, degree 3, identical
        // knot vector — clamped uniform).
        let knots_u = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
        let p0 = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(3.0, 2.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let p1 = vec![
            DVec3::new(0.0, 0.0, 5.0),
            DVec3::new(1.0, 1.0, 5.0),
            DVec3::new(3.0, 1.0, 5.0),
            DVec3::new(4.0, 0.0, 5.0),
        ];
        let curves = vec![
            (&p0[..], &knots_u[..], 3usize),
            (&p1[..], &knots_u[..], 3usize),
        ];
        let (grid, ku, kv, du, dv) = loft_surface(&curves, 1).unwrap();
        assert_eq!(du, 3); assert_eq!(dv, 1);

        // Verify ruled property at multiple u samples
        for k in 0..=6 {
            let u = k as f64 / 6.0;
            let s_at_v0 = bs::evaluate(&grid, &ku, &kv, du, dv, u, 0.0).unwrap();
            let s_at_v1 = bs::evaluate(&grid, &ku, &kv, du, dv, u, 1.0).unwrap();
            let p0_at_u = bs_c::evaluate(&p0, &knots_u, 3, u).unwrap();
            let p1_at_u = bs_c::evaluate(&p1, &knots_u, 3, u).unwrap();
            assert!((s_at_v0 - p0_at_u).length() < 1e-9,
                "ruled property v=0 at u={}: S={:?} ≠ profile0={:?}",
                u, s_at_v0, p0_at_u);
            assert!((s_at_v1 - p1_at_u).length() < 1e-9,
                "ruled property v=1 at u={}: S={:?} ≠ profile1={:?}",
                u, s_at_v1, p1_at_u);
        }
    }

    /// 사용자 권장 회귀 — strictify_params 보호 검증.
    /// 두 인접 section이 IDENTICAL first control point를 가질 때
    /// (chord = 0), 보간 행렬이 singular가 되어선 안 된다.
    #[test]
    fn loft_handles_zero_chord_between_sections() {
        let knots_u = vec![0.0, 0.0, 1.0, 1.0]; // degree 1
        // 3 sections: s0 starts at (0,0,0); s1 STARTS AT THE SAME POINT
        // (chord_01 = 0); s2 starts at (0,0,5).
        let s0 = vec![DVec3::ZERO,             DVec3::new(5.0, 0.0, 0.0)];
        let s1 = vec![DVec3::new(0.0, 0.0, 0.0), DVec3::new(5.0, 1.0, 0.0)];
        let s2 = vec![DVec3::new(0.0, 0.0, 5.0), DVec3::new(5.0, 0.0, 5.0)];
        let curves = vec![
            (&s0[..], &knots_u[..], 1usize),
            (&s1[..], &knots_u[..], 1usize),
            (&s2[..], &knots_u[..], 1usize),
        ];
        // Without strictify, this would attempt interpolation with
        // duplicate v_params[0] == v_params[1] → singular matrix.
        // With strictify the loft must still succeed.
        let r = loft_surface(&curves, 2);
        assert!(r.is_ok(), "loft must not be singular at chord=0: {:?}", r.err());
        let (grid, _, _, du, dv) = r.unwrap();
        assert_eq!(du, 1); assert_eq!(dv, 2);
        assert_eq!(grid.len(), 2);     // n_u
        assert_eq!(grid[0].len(), 3);  // n_v
    }

    /// 사용자 보강 Test B — 3 profiles, evaluate at v_params[k] across u
    /// must equal profile_k(u) at every u sample (not just corners).
    #[test]
    fn loft_three_profiles_pass_through_at_v_params() {
        use crate::curves::bspline as bs_c;
        // 3 quadratic profile curves with identical (degree 2, clamped uniform)
        let knots_u = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let p0 = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 3.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
        ];
        let p1 = vec![
            DVec3::new(0.0, 1.0, 2.0),
            DVec3::new(2.0, 4.0, 2.0),
            DVec3::new(4.0, 1.0, 2.0),
        ];
        let p2 = vec![
            DVec3::new(0.0, 2.0, 5.0),
            DVec3::new(2.0, 5.0, 5.0),
            DVec3::new(4.0, 2.0, 5.0),
        ];
        let curves = vec![
            (&p0[..], &knots_u[..], 2usize),
            (&p1[..], &knots_u[..], 2usize),
            (&p2[..], &knots_u[..], 2usize),
        ];
        let (grid, ku, kv, du, dv) = loft_surface(&curves, 2).unwrap();
        assert_eq!(du, 2); assert_eq!(dv, 2);

        // v_params (chord length on first ctrl pts = (0,0,0)→(0,1,2)→(0,2,5)):
        // chord_01 = sqrt(1+4) = sqrt(5) ≈ 2.2361
        // chord_12 = sqrt(1+9) = sqrt(10) ≈ 3.1623
        // total = 5.3984
        let chord_01 = (5.0_f64).sqrt();
        let chord_12 = (10.0_f64).sqrt();
        let total = chord_01 + chord_12;
        let v_params = [0.0, chord_01 / total, 1.0];

        // For each profile k and each u sample, surface at (u, v_params[k])
        // must match profile_k(u) exactly.
        for (k, profile_ctrl) in [&p0, &p1, &p2].iter().enumerate() {
            let v = v_params[k];
            for ui in 0..=8 {
                let u = ui as f64 / 8.0;
                let s = bs::evaluate(&grid, &ku, &kv, du, dv, u, v).unwrap();
                let pk = bs_c::evaluate(profile_ctrl, &knots_u, 2, u).unwrap();
                assert!((s - pk).length() < 1e-9,
                    "loft passes-through fail: k={}, u={}, v={}: S={:?} ≠ profile={:?}",
                    k, u, v, s, pk);
            }
        }
    }
}
