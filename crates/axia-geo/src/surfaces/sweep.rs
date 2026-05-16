//! ADR-056 Phase K Step 3 — Sweep Surface (1-rail) + Extrusion.
//!
//! ## Extrusion (linear rail special case)
//!
//! Translates the profile by `direction * distance` to form a second
//! cross-section, then lofts (degree_v = 1) — this gives a precise
//! flat-tube surface.
//!
//! ## 1-Rail Sweep (general curved rail)
//!
//! For each sample on the rail, compute a local frame:
//!   - tangent T = rail.derivative(t).normalize()
//!   - normal N (Frenet rotation-minimizing — see notes below)
//!   - binormal B = T × N
//! Translate + rotate the profile control points so the profile's
//! local Z-axis aligns with T at each sample. Loft through the
//! resulting cross-sections.
//!
//! **Frenet frame fallback** (for straight or near-straight rails):
//! When `r''(t)` is near zero, use a fixed reference normal (Z if
//! rail is not vertical, else Y). This avoids the classical Frenet
//! singularity at inflection points.

use anyhow::{bail, Result};
use glam::DVec3;

use crate::curves::bspline as bs;

/// Extrude `profile` along `direction` for `distance`. Returns a
/// loft-style NURBS surface with degree_v = 1.
///
/// `profile_*` describes a B-spline curve in 3D (typically planar).
/// The extruded surface places the profile at v=0 and a translated
/// copy at v=1.
pub fn extrusion_surface(
    profile_ctrl: &[DVec3],
    profile_knots: &[f64],
    profile_degree: usize,
    direction: DVec3,
    distance: f64,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)> {
    if profile_ctrl.len() < profile_degree + 1 {
        bail!("extrusion: profile needs >= degree+1 ctrl pts");
    }
    if direction.length_squared() < 1e-30 {
        bail!("extrusion: direction must be non-zero");
    }
    let dir = direction.normalize() * distance;

    // ctrl_grid[u][v]: u indexes profile, v ∈ {0, 1}
    let n_u = profile_ctrl.len();
    let mut grid: Vec<Vec<DVec3>> = vec![Vec::with_capacity(2); n_u];
    for i in 0..n_u {
        grid[i].push(profile_ctrl[i]);
        grid[i].push(profile_ctrl[i] + dir);
    }
    let knots_v = vec![0.0, 0.0, 1.0, 1.0]; // degree 1
    Ok((grid, profile_knots.to_vec(), knots_v, profile_degree, 1))
}

/// 1-rail sweep: orient `profile` along `rail` using a rotation-minimizing
/// frame.
///
/// MVP scope:
///   - Sample N points on the rail (N = `n_v_samples`, default 8).
///   - At each sample: compute tangent (Frenet first-order).
///   - Use a **rotation-minimizing frame** (Bishop frame) initialized
///     from a reference normal — propagate by parallel transport.
///   - Translate profile to sample position; rotate so profile's
///     reference direction aligns with the local frame.
///   - Loft (degree_v = 1) through the resulting cross-sections.
///
/// `profile_ref_dir`: a unit vector indicating the profile's "up"
/// direction in its local frame (e.g., DVec3::Z for an XY-plane
/// profile). The sweep aligns this with the rail's local normal.
pub fn sweep_surface_1_rail(
    profile_ctrl: &[DVec3],
    profile_knots: &[f64],
    profile_degree: usize,
    profile_ref_dir: DVec3,
    rail_ctrl: &[DVec3],
    rail_knots: &[f64],
    rail_degree: usize,
    n_v_samples: usize,
) -> Result<(Vec<Vec<DVec3>>, Vec<f64>, Vec<f64>, usize, usize)> {
    if profile_ctrl.len() < profile_degree + 1 {
        bail!("sweep: profile needs >= degree+1 ctrl pts");
    }
    if rail_ctrl.len() < rail_degree + 1 {
        bail!("sweep: rail needs >= degree+1 ctrl pts");
    }
    if rail_degree < 1 { bail!("rail degree must be >= 1"); }
    if n_v_samples < 2 { bail!("n_v_samples must be >= 2"); }
    if profile_ref_dir.length_squared() < 1e-30 {
        bail!("profile_ref_dir must be non-zero");
    }

    // Special case: linear rail → extrusion path
    if rail_degree == 1 && rail_ctrl.len() == 2 {
        let direction = rail_ctrl[1] - rail_ctrl[0];
        let distance = direction.length();
        if distance < 1e-30 { bail!("degenerate rail (zero length)"); }
        return extrusion_surface(profile_ctrl, profile_knots, profile_degree,
                                  direction, distance);
    }

    let ref_dir = profile_ref_dir.normalize();

    // Sample N points along the rail (uniform t in valid range)
    let (t_min, t_max) = (rail_knots[rail_degree], rail_knots[rail_ctrl.len()]);
    let mut samples_pos: Vec<DVec3> = Vec::with_capacity(n_v_samples);
    let mut samples_tan: Vec<DVec3> = Vec::with_capacity(n_v_samples);
    for k in 0..n_v_samples {
        let t = t_min + (t_max - t_min) * (k as f64 / (n_v_samples - 1) as f64);
        let p = bs::evaluate(rail_ctrl, rail_knots, rail_degree, t)?;
        let d = bs::derivative(rail_ctrl, rail_knots, rail_degree, t)?;
        if d.length_squared() < 1e-30 {
            bail!("sweep: rail tangent degenerate at t={}", t);
        }
        samples_pos.push(p);
        samples_tan.push(d.normalize());
    }

    // Build rotation-minimizing frame (Bishop) by parallel transport.
    // Initialize first frame: pick any unit normal perpendicular to
    // tangent[0] that is closest to ref_dir.
    let mut normals: Vec<DVec3> = Vec::with_capacity(n_v_samples);
    let n0 = make_initial_normal(samples_tan[0], ref_dir);
    normals.push(n0);
    for k in 1..n_v_samples {
        let prev_t = samples_tan[k - 1];
        let prev_n = normals[k - 1];
        let cur_t = samples_tan[k];
        // Parallel transport: rotate prev_n by the rotation that maps
        // prev_t onto cur_t (about axis = prev_t × cur_t).
        let axis = prev_t.cross(cur_t);
        let axis_len = axis.length();
        let new_n = if axis_len < 1e-12 {
            prev_n // tangent unchanged → frame unchanged
        } else {
            let theta = prev_t.dot(cur_t).clamp(-1.0, 1.0).acos();
            rotate_about_axis(prev_n, axis / axis_len, theta).normalize()
        };
        normals.push(new_n);
    }

    // For each rail sample, build a transformed copy of the profile.
    // Profile is interpreted in its own local frame; we map:
    //   profile.x_axis → local binormal B = T × N
    //   profile.y_axis → local normal   N
    //   profile.z_axis → local tangent  T
    // Find profile center (use centroid of control points)
    let profile_centroid: DVec3 = profile_ctrl.iter().copied().sum::<DVec3>()
        / (profile_ctrl.len() as f64);

    let n_u = profile_ctrl.len();
    let mut grid: Vec<Vec<DVec3>> = vec![Vec::with_capacity(n_v_samples); n_u];
    for k in 0..n_v_samples {
        let pos = samples_pos[k];
        let n = normals[k];
        let t = samples_tan[k];
        let b = t.cross(n).normalize();

        for i in 0..n_u {
            // Express profile_ctrl[i] - centroid in original axes; translate
            // and rotate into rail frame.
            let local = profile_ctrl[i] - profile_centroid;
            let world = pos + b * local.x + n * local.y + t * local.z;
            grid[i].push(world);
        }
    }

    let _knots_v = vec![0.0; n_v_samples + 2]; // placeholder
    let knots_v = knots_v_for_sweep(n_v_samples);
    Ok((grid, profile_knots.to_vec(), knots_v, profile_degree, 1))
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Find a unit normal perpendicular to `tangent` that is closest in
/// direction to `reference`. If reference is parallel to tangent,
/// fall back to a canonical perpendicular axis.
fn make_initial_normal(tangent: DVec3, reference: DVec3) -> DVec3 {
    // Project reference onto plane perpendicular to tangent
    let proj = reference - tangent * reference.dot(tangent);
    if proj.length_squared() < 1e-12 {
        // Reference parallel to tangent — pick canonical
        let alt = if tangent.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
        let proj = alt - tangent * alt.dot(tangent);
        return proj.normalize();
    }
    proj.normalize()
}

/// Rodrigues' rotation formula: rotate `v` about unit `axis` by `theta`.
fn rotate_about_axis(v: DVec3, axis: DVec3, theta: f64) -> DVec3 {
    let cos_t = theta.cos();
    let sin_t = theta.sin();
    v * cos_t + axis.cross(v) * sin_t + axis * axis.dot(v) * (1.0 - cos_t)
}

fn knots_v_for_sweep(n_samples: usize) -> Vec<f64> {
    // Uniform clamped knots for degree 1, n_samples ctrl pts.
    // Length = n_samples + 2.
    let mut k = vec![0.0_f64; n_samples + 2];
    k[0] = 0.0; k[1] = 0.0;
    for i in 2..n_samples {
        k[i] = (i - 1) as f64 / (n_samples - 1) as f64;
    }
    k[n_samples] = 1.0;
    k[n_samples + 1] = 1.0;
    k
}

// ────────────────────────────────────────────────────────────────────
// Tests (4 — ADR-056 §2.7 step 3)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surfaces::bspline_surface as bss;

    /// ADR-056 §2.7 #10 — Extrusion preserves profile shape.
    #[test]
    fn extrusion_preserves_profile_shape() {
        let profile_ctrl = vec![
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
        ];
        let profile_knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let (grid, ku, kv, du, dv) = extrusion_surface(
            &profile_ctrl, &profile_knots, 2,
            DVec3::Y, 5.0,
        ).unwrap();
        assert_eq!(du, 2);
        assert_eq!(dv, 1);
        assert_eq!(grid.len(), 3);     // n_u = profile len
        assert_eq!(grid[0].len(), 2);  // n_v = 2

        // At u=0, v=0 the surface should be profile_ctrl[0] = origin
        let p_start = bss::evaluate(&grid, &ku, &kv, du, dv, 0.0, 0.0).unwrap();
        assert!((p_start - DVec3::ZERO).length() < 1e-9);
        // At u=1, v=0 the surface should be profile_ctrl[2] = (2,0,0)
        let p_end = bss::evaluate(&grid, &ku, &kv, du, dv, 1.0, 0.0).unwrap();
        assert!((p_end - DVec3::new(2.0, 0.0, 0.0)).length() < 1e-9);
    }

    /// ADR-056 §2.7 #11 — Extrusion height matches distance.
    #[test]
    fn extrusion_height_matches_distance() {
        let profile = vec![DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0)];
        let knots = vec![0.0, 0.0, 1.0, 1.0];
        let (grid, ku, kv, du, dv) = extrusion_surface(
            &profile, &knots, 1,
            DVec3::Z, 7.5,
        ).unwrap();
        // At u=0, v=1 should be (0,0,7.5)
        let p_top = bss::evaluate(&grid, &ku, &kv, du, dv, 0.0, 1.0).unwrap();
        assert!((p_top - DVec3::new(0.0, 0.0, 7.5)).length() < 1e-9);
    }

    /// ADR-056 §2.7 #12 — Sweep along arc orients profile.
    /// Just verify it runs and produces a valid grid; geometric
    /// correctness of orientation is hard to assert at this MVP scope.
    #[test]
    fn sweep_along_arc_orients_profile() {
        // Profile: small horizontal segment in XY plane
        let profile = vec![
            DVec3::new(-0.5, 0.0, 0.0),
            DVec3::new( 0.5, 0.0, 0.0),
        ];
        let p_knots = vec![0.0, 0.0, 1.0, 1.0];

        // Rail: cubic curve from (0,0,0) to (10,5,0) (curved)
        let rail = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(3.0, 5.0, 0.0),
            DVec3::new(7.0, 5.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
        ];
        let r_knots = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];

        let (grid, _ku, _kv, du, dv) = sweep_surface_1_rail(
            &profile, &p_knots, 1,
            DVec3::Z,                // profile reference dir
            &rail, &r_knots, 3,
            8,                       // 8 samples along rail
        ).unwrap();
        assert_eq!(du, 1);
        assert_eq!(dv, 1);
        assert_eq!(grid.len(), 2);     // n_u
        assert_eq!(grid[0].len(), 8);  // n_v

        // Centroid of grid should follow rail roughly
        let center_v0: DVec3 = (grid[0][0] + grid[1][0]) * 0.5;
        let center_v_end: DVec3 = (grid[0][7] + grid[1][7]) * 0.5;
        assert!((center_v0 - DVec3::ZERO).length() < 0.5,
            "first cross-section center near rail start, got {:?}", center_v0);
        assert!((center_v_end - DVec3::new(10.0, 0.0, 0.0)).length() < 0.5,
            "last cross-section center near rail end, got {:?}", center_v_end);
    }

    /// ADR-056 §2.7 #13 — Sweep rejects degenerate rail.
    #[test]
    fn sweep_rejects_degenerate_rail() {
        let profile = vec![DVec3::ZERO, DVec3::X];
        let p_knots = vec![0.0, 0.0, 1.0, 1.0];

        // Degenerate rail (both points at same location)
        let rail = vec![DVec3::ZERO, DVec3::ZERO];
        let r_knots = vec![0.0, 0.0, 1.0, 1.0];
        let r = sweep_surface_1_rail(
            &profile, &p_knots, 1, DVec3::Z,
            &rail, &r_knots, 1, 4,
        );
        assert!(r.is_err(), "degenerate rail should error");
    }
}
