//! SSI Stage 3 — Newton refinement (ADR-034 §P19.3).
//!
//! Refines a Stage 2 candidate `(u_a, v_a, u_b, v_b)` so that
//! `Surface_a(u_a, v_a) ≈ Surface_b(u_b, v_b)` to within `tol`.
//!
//! ## Math
//! - State: `x = (u_a, v_a, u_b, v_b)ᵀ ∈ ℝ⁴`
//! - Residual: `F(x) = S_a(u_a, v_a) - S_b(u_b, v_b) ∈ ℝ³`
//! - Jacobian: `J = [∂S_a/∂u_a  ∂S_a/∂v_a  -∂S_b/∂u_b  -∂S_b/∂v_b]` (3×4)
//! - Step: `Δx = -J⁺ F` where `J⁺` is the Moore-Penrose pseudo-inverse
//!   `J⁺ = Jᵀ (J Jᵀ)⁻¹` (since J is wide).
//!
//! Convergence target: `|F| < 1e-6` mm in 50 iters max (per ADR-034).

use glam::{DMat3, DVec3};

use super::super::bezier_patch;

/// Default convergence tolerance (per ADR-034 §P19.5).
pub const DEFAULT_NEWTON_TOL: f64 = 1e-6;
/// Default max iterations (per ADR-034 §P19.5).
pub const DEFAULT_NEWTON_MAX_ITER: usize = 50;

/// Outcome of Newton refinement.
#[derive(Clone, Debug)]
pub struct RefinementResult {
    pub uv_a: (f64, f64),
    pub uv_b: (f64, f64),
    pub point: DVec3,
    pub residual: f64,
    pub iterations: usize,
    pub converged: bool,
}

/// Refine a candidate intersection between two Bezier patches via Newton.
///
/// `tol` is the residual norm target; `max_iter` caps iterations.
/// Returns the polished result; check `converged` to know if `tol` was hit.
pub fn refine_bezier_pair(
    patch_a_ctrl: &[Vec<DVec3>],
    patch_b_ctrl: &[Vec<DVec3>],
    initial_uv_a: (f64, f64),
    initial_uv_b: (f64, f64),
    tol: f64,
    max_iter: usize,
) -> RefinementResult {
    let mut ua = initial_uv_a.0.clamp(0.0, 1.0);
    let mut va = initial_uv_a.1.clamp(0.0, 1.0);
    let mut ub = initial_uv_b.0.clamp(0.0, 1.0);
    let mut vb = initial_uv_b.1.clamp(0.0, 1.0);

    let mut iter = 0;
    let mut residual = f64::INFINITY;
    let mut last_point = DVec3::ZERO;

    while iter < max_iter {
        let pa = match bezier_patch::evaluate(patch_a_ctrl, ua, va) {
            Ok(p) => p,
            Err(_) => break,
        };
        let pb = match bezier_patch::evaluate(patch_b_ctrl, ub, vb) {
            Ok(p) => p,
            Err(_) => break,
        };
        let f = pa - pb;
        residual = f.length();
        last_point = 0.5 * (pa + pb);
        if residual < tol {
            return RefinementResult {
                uv_a: (ua, va), uv_b: (ub, vb),
                point: last_point, residual, iterations: iter, converged: true,
            };
        }

        let dau = bezier_patch::derivative_u(patch_a_ctrl, ua, va).unwrap_or(DVec3::ZERO);
        let dav = bezier_patch::derivative_v(patch_a_ctrl, ua, va).unwrap_or(DVec3::ZERO);
        let dbu = bezier_patch::derivative_u(patch_b_ctrl, ub, vb).unwrap_or(DVec3::ZERO);
        let dbv = bezier_patch::derivative_v(patch_b_ctrl, ub, vb).unwrap_or(DVec3::ZERO);

        // J = [dau  dav  -dbu  -dbv]  (3×4)
        // We solve  J Δx = -F  via pseudo-inverse: Δx = Jᵀ (J Jᵀ)⁻¹ (-F).
        // J Jᵀ = (dau dauᵀ + dav davᵀ + dbu dbuᵀ + dbv dbvᵀ)  — sum of outer
        // products (3×3, symmetric PSD).
        let jjt = outer(dau) + outer(dav) + outer(dbu) + outer(dbv);
        let inv = match invert_3x3(jjt) {
            Some(m) => m,
            None => break,  // singular — abort, leave residual as-is.
        };
        let neg_f = -f;
        let lambda = inv * neg_f;  // = (J Jᵀ)⁻¹ (-F)

        // Δx_i = (column i of Jᵀ) · lambda
        // Column i of Jᵀ = row i of J = the i-th derivative vector.
        let dua_step = dau.dot(lambda);
        let dva_step = dav.dot(lambda);
        let dub_step = (-dbu).dot(lambda);
        let dvb_step = (-dbv).dot(lambda);

        // Damped step — clamp |Δ| to avoid overshoot.
        let max_step = 0.5;
        let scale = {
            let m = dua_step.abs()
                .max(dva_step.abs())
                .max(dub_step.abs())
                .max(dvb_step.abs());
            if m > max_step { max_step / m } else { 1.0 }
        };

        ua = (ua + dua_step * scale).clamp(0.0, 1.0);
        va = (va + dva_step * scale).clamp(0.0, 1.0);
        ub = (ub + dub_step * scale).clamp(0.0, 1.0);
        vb = (vb + dvb_step * scale).clamp(0.0, 1.0);

        iter += 1;
    }

    RefinementResult {
        uv_a: (ua, va), uv_b: (ub, vb),
        point: last_point, residual, iterations: iter, converged: residual < tol,
    }
}

fn outer(v: DVec3) -> DMat3 {
    DMat3::from_cols(
        DVec3::new(v.x * v.x, v.y * v.x, v.z * v.x),
        DVec3::new(v.x * v.y, v.y * v.y, v.z * v.y),
        DVec3::new(v.x * v.z, v.y * v.z, v.z * v.z),
    )
}

fn invert_3x3(m: DMat3) -> Option<DMat3> {
    let det = m.determinant();
    if det.abs() < 1e-14 {
        None
    } else {
        Some(m.inverse())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_grid_at(z: f64, dim: usize) -> Vec<Vec<DVec3>> {
        let mut g = vec![vec![DVec3::ZERO; dim]; dim];
        for i in 0..dim {
            for j in 0..dim {
                let u = i as f64 / (dim - 1) as f64;
                let v = j as f64 / (dim - 1) as f64;
                g[i][j] = DVec3::new(u, v, z);
            }
        }
        g
    }

    #[test]
    fn refine_intersects_perpendicular_squares() {
        // Patch A on z=0 (1×1 square), Patch B on x=0.5 (1×1 square).
        let a = flat_grid_at(0.0, 3);
        let mut b = vec![vec![DVec3::ZERO; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let u = i as f64 / 2.0;
                let v = j as f64 / 2.0;
                b[i][j] = DVec3::new(0.5, u, v - 0.5);
            }
        }
        // Initial guess far from solution.
        let res = refine_bezier_pair(&a, &b, (0.4, 0.4), (0.4, 0.4), 1e-6, 50);
        assert!(res.converged, "Newton failed to converge: {:?}", res);
        // Solution lies at (0.5, *, 0) on patch A and on patch B both → x≈0.5, z≈0.
        assert!((res.point.x - 0.5).abs() < 1e-3);
        assert!(res.point.z.abs() < 1e-3);
    }

    #[test]
    fn refine_already_converged_returns_immediately() {
        let a = flat_grid_at(0.0, 2);
        let b = flat_grid_at(0.0, 2);  // coincident
        let res = refine_bezier_pair(&a, &b, (0.5, 0.5), (0.5, 0.5), 1e-6, 50);
        assert!(res.converged);
        assert_eq!(res.iterations, 0);
        assert!(res.residual < 1e-12);
    }

    #[test]
    fn refine_disjoint_does_not_converge() {
        // Two parallel planes 10mm apart → no intersection possible.
        let a = flat_grid_at(0.0, 2);
        let b = flat_grid_at(10.0, 2);
        let res = refine_bezier_pair(&a, &b, (0.5, 0.5), (0.5, 0.5), 1e-6, 20);
        assert!(!res.converged);
        // Residual should remain near 10 (the plane offset).
        assert!(res.residual > 1.0);
    }

    #[test]
    fn invert_3x3_singular_returns_none() {
        let m = DMat3::from_cols(DVec3::ZERO, DVec3::ZERO, DVec3::ZERO);
        assert!(invert_3x3(m).is_none());
    }
}
