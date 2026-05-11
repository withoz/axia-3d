//! ADR-055 Phase J Step 4 — SSI Robustness Detection + Repair.
//!
//! Per ADR-055 Amendment §7.2 (사용자 결정 lock-in):
//!
//!   §7.2.1 Detect 와 Repair 분리
//!     `detect_ssi_pathologies()` — pure analysis, no side effects
//!     `repair_*()` — explicit caller invocation only
//!
//!   §7.2.2 reconstruct_pcurve UV 투영 오차 정책
//!     Newton 잔차 > tol.geometric → Err
//!     Boundary slack: tol.parameter
//!     Slack 초과 시 reject
//!
//! 6 pathologies detected on `Vec<SurfaceIntersection>`:
//!   1. Tangent contacts        — single-point contact, no crossing
//!   2. Coincident regions      — overlapping segments (Step 2 fail-fast
//!                                 will be replaced via `coincident_matrix`
//!                                 once Step 4 lands)
//!   3. Branch points           — 3+ surfaces meeting (chains intersecting)
//!   4. PCurve missing          — open chain with no surface anchor
//!   5. Self-intersections      — chain crosses itself in 3D
//!   6. Boundary grazing        — open chain endpoint at surface edge

use super::SurfaceIntersection;
use super::tolerance::BooleanTolerance;
use super::super::AnalyticSurface;
use anyhow::{bail, Result};
use glam::DVec3;

// ────────────────────────────────────────────────────────────────────
// SsiRobustnessReport — pure detect-only analysis result
// ────────────────────────────────────────────────────────────────────

/// Result of `detect_ssi_pathologies()`. Indices reference the original
/// chain slice by position. A chain may appear in multiple lists if it
/// has overlapping pathologies (e.g., a self-intersecting chain that
/// also has a tangent contact).
#[derive(Clone, Debug, Default)]
pub struct SsiRobustnessReport {
    /// Chains where `tangent_warning == true` (set by Phase F newton).
    pub tangent_contacts: Vec<usize>,
    /// Chains containing coincident sub-regions (consecutive 3D points
    /// at near-zero distance over a non-trivial parameter span).
    pub coincident_regions: Vec<usize>,
    /// Indices where 3+ chains meet at a common 3D point (within tol).
    /// Reported as the chain index whose endpoint is the branch point.
    pub branch_points: Vec<usize>,
    /// Chains missing UV projection on either surface (uv_a or uv_b
    /// shorter than points).
    pub pcurve_missing: Vec<usize>,
    /// Chains that cross themselves in 3D (any non-adjacent point pair
    /// within tol of each other).
    pub self_intersections: Vec<usize>,
    /// Open chains whose endpoints lie within tol of the surface UV
    /// boundary (would need to connect to a boundary edge).
    pub boundary_grazing: Vec<usize>,
}

impl SsiRobustnessReport {
    pub fn is_clean(&self) -> bool {
        self.tangent_contacts.is_empty()
            && self.coincident_regions.is_empty()
            && self.branch_points.is_empty()
            && self.pcurve_missing.is_empty()
            && self.self_intersections.is_empty()
            && self.boundary_grazing.is_empty()
    }

    pub fn total_pathologies(&self) -> usize {
        self.tangent_contacts.len()
            + self.coincident_regions.len()
            + self.branch_points.len()
            + self.pcurve_missing.len()
            + self.self_intersections.len()
            + self.boundary_grazing.len()
    }
}

// ────────────────────────────────────────────────────────────────────
// Detection (pure, no side effects)
// ────────────────────────────────────────────────────────────────────

/// Inspect a slice of SSI chains and report all detected pathologies.
/// Pure analysis — does NOT modify chains, does NOT attempt repair.
///
/// Per §7.2.1 lock-in: caller must invoke `repair_*()` explicitly with
/// user/automation consent before mutating any chain.
pub fn detect_ssi_pathologies(
    chains: &[SurfaceIntersection],
    tol: &BooleanTolerance,
) -> SsiRobustnessReport {
    let mut report = SsiRobustnessReport::default();

    for (i, c) in chains.iter().enumerate() {
        if detect_tangent_contact(c)        { report.tangent_contacts.push(i); }
        if detect_coincident_region(c, tol) { report.coincident_regions.push(i); }
        if detect_pcurve_missing(c)         { report.pcurve_missing.push(i); }
        if detect_self_intersection(c, tol) { report.self_intersections.push(i); }
        if detect_boundary_grazing(c, tol)  { report.boundary_grazing.push(i); }
    }

    // Branch points: O(N²) endpoint matching across chain pairs.
    let branches = detect_branch_points(chains, tol);
    report.branch_points = branches;

    report
}

// ── Per-chain detectors ──────────────────────────────────────────────

/// 1. Tangent contact = the Phase F SSI Newton flagged tangent_warning.
fn detect_tangent_contact(c: &SurfaceIntersection) -> bool {
    c.tangent_warning
}

/// 2. Coincident region = two consecutive 3D points within tol.geometric
///    over a non-trivial portion of the chain (≥ 3 consecutive points).
///    Suggests the chain is degenerate / overlapping.
fn detect_coincident_region(c: &SurfaceIntersection, tol: &BooleanTolerance) -> bool {
    if c.points.len() < 4 { return false; }
    let mut consecutive_close = 0;
    for w in c.points.windows(2) {
        if (w[1] - w[0]).length() < tol.geometric {
            consecutive_close += 1;
            if consecutive_close >= 3 { return true; }
        } else {
            consecutive_close = 0;
        }
    }
    false
}

/// 4. PCurve missing = uv_a or uv_b length < points length.
fn detect_pcurve_missing(c: &SurfaceIntersection) -> bool {
    c.uv_a.len() < c.points.len() || c.uv_b.len() < c.points.len()
}

/// 5. Self-intersection = any non-adjacent point pair within tol.
fn detect_self_intersection(c: &SurfaceIntersection, tol: &BooleanTolerance) -> bool {
    let n = c.points.len();
    if n < 4 { return false; }
    for i in 0..n {
        for j in (i + 2)..n {
            // Skip the closing pair on closed chains
            if c.closed && i == 0 && j == n - 1 { continue; }
            if (c.points[i] - c.points[j]).length() < tol.geometric {
                return true;
            }
        }
    }
    false
}

/// 6. Boundary grazing = open chain whose either endpoint lies within
///    tol.parameter of the canonical [0, 1]² UV box edge.
fn detect_boundary_grazing(c: &SurfaceIntersection, tol: &BooleanTolerance) -> bool {
    if c.closed { return false; }
    if c.uv_a.is_empty() && c.uv_b.is_empty() { return false; }
    // Check both endpoints against [0, 1]² (canonical Bezier patch range)
    let near_edge = |uv: (f64, f64)| -> bool {
        uv.0.abs() < tol.parameter
            || (uv.0 - 1.0).abs() < tol.parameter
            || uv.1.abs() < tol.parameter
            || (uv.1 - 1.0).abs() < tol.parameter
    };
    let endpoints_a = [c.uv_a.first(), c.uv_a.last()];
    let endpoints_b = [c.uv_b.first(), c.uv_b.last()];
    endpoints_a.iter().filter_map(|x| *x).any(|uv| near_edge(*uv))
        || endpoints_b.iter().filter_map(|x| *x).any(|uv| near_edge(*uv))
}

/// 3. Branch points = 3+ chains share a common endpoint within tol.
///    Returns the index of any chain whose endpoint participates.
fn detect_branch_points(chains: &[SurfaceIntersection], tol: &BooleanTolerance) -> Vec<usize> {
    let mut endpoints: Vec<(usize, DVec3)> = Vec::new();
    for (i, c) in chains.iter().enumerate() {
        if c.closed { continue; }
        if let Some(p) = c.points.first() { endpoints.push((i, *p)); }
        if let Some(p) = c.points.last()  { endpoints.push((i, *p)); }
    }

    let n = endpoints.len();
    let mut affected = std::collections::HashSet::new();
    for i in 0..n {
        let mut count = 1usize;
        let mut group: Vec<usize> = vec![endpoints[i].0];
        for j in (i + 1)..n {
            if (endpoints[i].1 - endpoints[j].1).length() < tol.geometric {
                count += 1;
                group.push(endpoints[j].0);
            }
        }
        if count >= 3 {
            for ci in group { affected.insert(ci); }
        }
    }

    let mut out: Vec<usize> = affected.into_iter().collect();
    out.sort();
    out
}

// ────────────────────────────────────────────────────────────────────
// Repair (explicit caller invocation only — §7.2.1)
// ────────────────────────────────────────────────────────────────────

/// Reconstruct missing UV projections on `chain` from its 3D points,
/// using the supplied surfaces' inverse evaluation.
///
/// Per §7.2.2 UV clamp policy (사용자 결정 lock-in):
///   - For each 3D point P: invert to (u, v) via best-effort projection
///     (currently brute-force candidate sampling — Newton refinement
///     deferred to Phase L).
///   - If projection error > `tol.geometric` → return Err
///   - If (u, v) lies outside surface UV range:
///       slack = `tol.parameter` boundary clamp
///       if exceeded → return Err
///   - On success: replace `chain.uv_a` (or uv_b) with reconstructed
///     parameter list of identical length to `chain.points`.
///
/// `which` selects which side to repair: `0 = uv_a`, `1 = uv_b`.
pub fn reconstruct_pcurve(
    chain: &mut SurfaceIntersection,
    surface: &AnalyticSurface,
    which: u8,
    tol: &BooleanTolerance,
) -> Result<()> {
    if which > 1 { bail!("which must be 0 (uv_a) or 1 (uv_b)"); }
    if chain.points.is_empty() { return Ok(()); }

    use crate::surfaces::SurfaceOps;
    let ((u_min, u_max), (v_min, v_max)) = surface.parameter_range();

    let mut new_uv: Vec<(f64, f64)> = Vec::with_capacity(chain.points.len());
    for p in &chain.points {
        let (u, v, residual) = invert_to_uv_brute_force(surface, *p, u_min, u_max, v_min, v_max);
        if residual > tol.geometric {
            bail!("reconstruct_pcurve: Newton residual {} > tol.geometric {}", residual, tol.geometric);
        }
        // §7.2.2 boundary slack clamp
        let u_clamped = clamp_with_slack(u, u_min, u_max, tol.parameter)
            .ok_or_else(|| anyhow::anyhow!(
                "reconstruct_pcurve: u {} outside [{}, {}] beyond slack {}",
                u, u_min, u_max, tol.parameter))?;
        let v_clamped = clamp_with_slack(v, v_min, v_max, tol.parameter)
            .ok_or_else(|| anyhow::anyhow!(
                "reconstruct_pcurve: v {} outside [{}, {}] beyond slack {}",
                v, v_min, v_max, tol.parameter))?;
        new_uv.push((u_clamped, v_clamped));
    }
    if which == 0 { chain.uv_a = new_uv; } else { chain.uv_b = new_uv; }
    Ok(())
}

/// Brute-force UV inversion: sample a coarse grid then refine by local
/// search. Returns (u, v, residual_distance). Phase L will replace this
/// with proper Newton iteration on r(u,v) = P_target.
fn invert_to_uv_brute_force(
    surface: &AnalyticSurface, target: DVec3,
    u_min: f64, u_max: f64, v_min: f64, v_max: f64,
) -> (f64, f64, f64) {
    use crate::surfaces::SurfaceOps;
    const COARSE: usize = 16;
    let mut best_u = u_min;
    let mut best_v = v_min;
    let mut best_d = f64::INFINITY;

    for ui in 0..=COARSE {
        for vi in 0..=COARSE {
            let u = u_min + (u_max - u_min) * (ui as f64 / COARSE as f64);
            let v = v_min + (v_max - v_min) * (vi as f64 / COARSE as f64);
            let p = surface.evaluate(u, v);
            let d = (p - target).length();
            if d < best_d {
                best_d = d;
                best_u = u;
                best_v = v;
            }
        }
    }

    // Local refinement with shrinking step
    let mut step_u = (u_max - u_min) / COARSE as f64;
    let mut step_v = (v_max - v_min) / COARSE as f64;
    for _iter in 0..30 {
        let mut improved = false;
        for du in [-1.0_f64, 0.0, 1.0] {
            for dv in [-1.0_f64, 0.0, 1.0] {
                if du == 0.0 && dv == 0.0 { continue; }
                let u_try = best_u + du * step_u;
                let v_try = best_v + dv * step_v;
                let p = surface.evaluate(u_try, v_try);
                let d = (p - target).length();
                if d < best_d {
                    best_d = d;
                    best_u = u_try;
                    best_v = v_try;
                    improved = true;
                }
            }
        }
        if !improved {
            step_u *= 0.5;
            step_v *= 0.5;
        }
        if step_u < 1e-12 && step_v < 1e-12 { break; }
    }

    (best_u, best_v, best_d)
}

/// Clamp `x` to `[lo, hi]` allowing a `slack` beyond either boundary.
/// Returns `None` if `x` exceeds `[lo - slack, hi + slack]`.
fn clamp_with_slack(x: f64, lo: f64, hi: f64, slack: f64) -> Option<f64> {
    if x < lo - slack || x > hi + slack { return None; }
    Some(x.clamp(lo, hi))
}

// ────────────────────────────────────────────────────────────────────
// Tests (7 — ADR-055 Amendment §7.3 step 3+4)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chain(points: Vec<DVec3>) -> SurfaceIntersection {
        let n = points.len();
        SurfaceIntersection {
            uv_a: (0..n).map(|i| (i as f64 / n as f64, 0.5)).collect(),
            uv_b: (0..n).map(|i| (i as f64 / n as f64, 0.5)).collect(),
            points,
            closed: false,
            tangent_warning: false,
        }
    }

    /// ADR-055 §7.3 step 3 #1 — Detect tangent contact (flag set by Newton).
    #[test]
    fn detect_tangent_contact() {
        let mut c = make_chain(vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0)]);
        c.tangent_warning = true;
        let report = detect_ssi_pathologies(&[c], &BooleanTolerance::default());
        assert_eq!(report.tangent_contacts, vec![0]);
        assert!(!report.is_clean());
    }

    /// ADR-055 §7.3 step 3 #2 — Detect coincident region (3+ near-zero
    /// consecutive distances).
    #[test]
    fn detect_coincident_region() {
        // 5 points where middle 4 collapse to nearly the same location
        let near = DVec3::new(1e-7, 0.0, 0.0);
        let c = make_chain(vec![
            DVec3::ZERO,
            near, near, near, near,
            DVec3::new(10.0, 0.0, 0.0),
        ]);
        let report = detect_ssi_pathologies(&[c], &BooleanTolerance::default());
        assert_eq!(report.coincident_regions, vec![0]);
    }

    /// ADR-055 §7.3 step 3 #3 — Detect self-intersection (non-adjacent
    /// near-coincident point pair).
    #[test]
    fn detect_self_intersection() {
        // Figure-8 in XY: 5 points where p[0] and p[3] coincide
        let c = make_chain(vec![
            DVec3::ZERO,
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::ZERO,                       // self-intersect with p[0]
            DVec3::new(1.0, -1.0, 0.0),
        ]);
        let report = detect_ssi_pathologies(&[c], &BooleanTolerance::default());
        assert_eq!(report.self_intersections, vec![0]);
    }

    /// ADR-055 §7.3 step 3 #4 — Detect boundary grazing (open chain
    /// endpoint at UV boundary).
    #[test]
    fn detect_boundary_grazing_open_chain() {
        let mut c = make_chain(vec![
            DVec3::ZERO,
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(2.0, 2.0, 0.0),
        ]);
        // Last UV at u=1.0 (canonical patch boundary)
        c.uv_a = vec![(0.5, 0.5), (0.5, 0.5), (1.0, 0.5)];
        c.uv_b = vec![(0.5, 0.5), (0.5, 0.5), (0.5, 0.5)];
        c.closed = false;
        let report = detect_ssi_pathologies(&[c], &BooleanTolerance::default());
        assert_eq!(report.boundary_grazing, vec![0]);
    }

    /// ADR-055 §7.3 step 3 #5 — Detect branch point (3+ chains meet).
    #[test]
    fn detect_branch_point() {
        // 3 chains all ending at origin
        let chains = vec![
            make_chain(vec![DVec3::new(1.0, 0.0, 0.0), DVec3::ZERO]),
            make_chain(vec![DVec3::new(0.0, 1.0, 0.0), DVec3::ZERO]),
            make_chain(vec![DVec3::new(0.0, 0.0, 1.0), DVec3::ZERO]),
        ];
        let report = detect_ssi_pathologies(&chains, &BooleanTolerance::default());
        assert!(report.branch_points.len() >= 3,
            "all 3 chains should be reported as participating in branch");
    }

    /// ADR-055 §7.3 step 3 #6 — Detect missing PCurve (uv_a < points).
    #[test]
    fn detect_pcurve_missing() {
        let mut c = make_chain(vec![
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
        ]);
        c.uv_a.pop();
        c.uv_a.pop();
        let report = detect_ssi_pathologies(&[c], &BooleanTolerance::default());
        assert_eq!(report.pcurve_missing, vec![0]);
    }

    /// ADR-055 §7.3 step 4 — reconstruct_pcurve on a planar surface
    /// with known UV projection (Newton residual 0, no slack triggered).
    #[test]
    fn reconstruct_pcurve_uv_clamp_policy() {
        // Plane z=0, UV ∈ [0, 1]², parameterized as (u, v, 0)
        let plane = AnalyticSurface::Plane {
            origin:  DVec3::ZERO,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        };
        // 3D points strictly inside the plane's UV range
        let mut chain = SurfaceIntersection {
            points: vec![
                DVec3::new(0.25, 0.25, 0.0),
                DVec3::new(0.50, 0.50, 0.0),
                DVec3::new(0.75, 0.75, 0.0),
            ],
            uv_a: Vec::new(),
            uv_b: Vec::new(),
            closed: false,
            tangent_warning: false,
        };
        let tol = BooleanTolerance::relaxed(); // 1e-2 geometric — brute-force tolerant
        reconstruct_pcurve(&mut chain, &plane, 0, &tol).expect("reconstruction ok");

        // Verify: uv_a length matches points; UV in [0, 1]
        assert_eq!(chain.uv_a.len(), 3);
        for (u, v) in &chain.uv_a {
            assert!(*u >= 0.0 && *u <= 1.0, "u {} out of range", u);
            assert!(*v >= 0.0 && *v <= 1.0, "v {} out of range", v);
        }
    }

    /// reconstruct_pcurve rejects 3D points too far from surface (>
    /// tol.geometric).
    #[test]
    fn reconstruct_pcurve_rejects_far_point() {
        let plane = AnalyticSurface::Plane {
            origin:  DVec3::ZERO,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        };
        // Point 5mm above the plane — way more than 1μm tol.geometric
        let mut chain = SurfaceIntersection {
            points: vec![DVec3::new(0.5, 0.5, 5.0)],
            uv_a: Vec::new(), uv_b: Vec::new(),
            closed: false, tangent_warning: false,
        };
        let tol = BooleanTolerance::default(); // 1e-3 mm geometric
        assert!(reconstruct_pcurve(&mut chain, &plane, 0, &tol).is_err(),
            "point 5mm above plane should fail strict tol");
    }
}
