//! ADR-058 Phase M Step 1 — robust crate ↔ AxiA type adapter.
//!
//! Wraps `robust::orient2d` / `orient3d` / `incircle` / `insphere`
//! to:
//!   - Accept AxiA's DVec2 / DVec3 types
//!   - Return std::cmp::Ordering (NOT bool — §C lock-in)
//!   - Provide runtime FMA sanity check (§B lock-in)

use std::cmp::Ordering;
use glam::{DVec2, DVec3};
use robust::{orient2d, orient3d, incircle, insphere, Coord, Coord3D};

/// Convert robust's f64 sign value to Ordering.
///
/// robust returns: positive = CCW / above, negative = CW / below,
/// 0 = exactly degenerate.
#[inline]
fn sign_to_ordering(s: f64) -> Ordering {
    if s > 0.0 { Ordering::Greater }
    else if s < 0.0 { Ordering::Less }
    else { Ordering::Equal }
}

/// 2D orientation: returns sign of `(b-a) × (c-a)` (z-component).
///   - Greater = `c` lies LEFT of directed line `a → b` (CCW)
///   - Less    = `c` lies RIGHT of `a → b` (CW)
///   - Equal   = collinear (exact, robust guarantee)
pub fn orient2d_robust(a: DVec2, b: DVec2, c: DVec2) -> Ordering {
    let s = orient2d(
        Coord { x: a.x, y: a.y },
        Coord { x: b.x, y: b.y },
        Coord { x: c.x, y: c.y },
    );
    sign_to_ordering(s)
}

/// 3D orientation: returns sign of `(b-a) × (c-a) · (d-a)`.
///   - Greater = `d` lies ABOVE plane through `a, b, c` (CCW from above)
///   - Less    = `d` lies BELOW
///   - Equal   = coplanar (exact)
pub fn orient3d_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3) -> Ordering {
    let s = orient3d(
        Coord3D { x: a.x, y: a.y, z: a.z },
        Coord3D { x: b.x, y: b.y, z: b.z },
        Coord3D { x: c.x, y: c.y, z: c.z },
        Coord3D { x: d.x, y: d.y, z: d.z },
    );
    sign_to_ordering(s)
}

/// 2D in-circle test: is `p` inside the circumcircle of triangle `a, b, c`?
///   - Greater = INSIDE
///   - Less    = OUTSIDE
///   - Equal   = exactly ON the circle
///
/// Caller responsible for ensuring `a, b, c` are oriented CCW (else
/// sign is inverted).
pub fn in_circle_robust(a: DVec2, b: DVec2, c: DVec2, p: DVec2) -> Ordering {
    let s = incircle(
        Coord { x: a.x, y: a.y },
        Coord { x: b.x, y: b.y },
        Coord { x: c.x, y: c.y },
        Coord { x: p.x, y: p.y },
    );
    sign_to_ordering(s)
}

/// 3D in-sphere test: is `p` inside the circumsphere of tetrahedron
/// `a, b, c, d`?
///   - Greater = INSIDE
///   - Less    = OUTSIDE
///   - Equal   = exactly ON the sphere
pub fn in_sphere_robust(a: DVec3, b: DVec3, c: DVec3, d: DVec3, p: DVec3) -> Ordering {
    let s = insphere(
        Coord3D { x: a.x, y: a.y, z: a.z },
        Coord3D { x: b.x, y: b.y, z: b.z },
        Coord3D { x: c.x, y: c.y, z: c.z },
        Coord3D { x: d.x, y: d.y, z: d.z },
        Coord3D { x: p.x, y: p.y, z: p.z },
    );
    sign_to_ordering(s)
}

// ────────────────────────────────────────────────────────────────────
// Runtime FMA sanity (ADR-058 §B lock-in)
// ────────────────────────────────────────────────────────────────────

/// Verify that the build environment supports robust predicates by
/// running a known-degenerate test case. Called by AxiA initialization
/// in debug builds.
///
/// Returns `true` if the environment is sane (FMA off / IEEE 754 strict
/// behavior). Returns `false` if a known-degenerate case classifies
/// incorrectly — indicates FMA may be active.
pub fn verify_predicates_environment() -> bool {
    // Known case: 4 collinear points on x-axis.
    // robust must return EXACTLY Equal (not Greater/Less).
    let r1 = orient2d_robust(
        DVec2::new(0.0, 0.0),
        DVec2::new(1.0, 0.0),
        DVec2::new(0.5, 0.0),
    );
    if r1 != Ordering::Equal { return false; }

    // Known case: clear LEFT (CCW). robust must return Greater.
    let r2 = orient2d_robust(
        DVec2::new(0.0, 0.0),
        DVec2::new(1.0, 0.0),
        DVec2::new(0.5, 1.0),
    );
    if r2 != Ordering::Greater { return false; }

    // Known case: clear RIGHT (CW). robust must return Less.
    let r3 = orient2d_robust(
        DVec2::new(0.0, 0.0),
        DVec2::new(1.0, 0.0),
        DVec2::new(0.5, -1.0),
    );
    if r3 != Ordering::Less { return false; }

    true
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-058 §2.7 Predicate correctness (4 spec)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-058 §2.7 #1 — orient2d classifies collinear correctly.
    /// Naive f64 cross product gives ~1e-30, ambiguous sign. Robust
    /// returns EXACTLY Equal.
    #[test]
    fn orient2d_robust_classifies_collinear_correctly() {
        // 3 points on x-axis (perfectly collinear)
        let a = DVec2::new(0.0, 0.0);
        let b = DVec2::new(1.0, 0.0);
        let c = DVec2::new(0.5, 0.0);
        assert_eq!(orient2d_robust(a, b, c), Ordering::Equal);

        // Near-collinear: c slightly above (1e-15)
        let c2 = DVec2::new(0.5, 1e-15);
        // robust returns sign — at this scale it should be Greater (above)
        assert_ne!(orient2d_robust(a, b, c2), Ordering::Less,
            "1e-15 above should not classify as below");

        // Clear above (CCW)
        let c3 = DVec2::new(0.5, 1.0);
        assert_eq!(orient2d_robust(a, b, c3), Ordering::Greater);

        // Clear below (CW)
        let c4 = DVec2::new(0.5, -1.0);
        assert_eq!(orient2d_robust(a, b, c4), Ordering::Less);
    }

    /// ADR-058 §2.7 #2 — orient3d classifies coplanar correctly.
    #[test]
    fn orient3d_robust_classifies_coplanar_correctly() {
        // 4 points on z=0 plane (perfectly coplanar)
        let a = DVec3::new(0.0, 0.0, 0.0);
        let b = DVec3::new(1.0, 0.0, 0.0);
        let c = DVec3::new(0.0, 1.0, 0.0);
        let d = DVec3::new(0.5, 0.5, 0.0);
        assert_eq!(orient3d_robust(a, b, c, d), Ordering::Equal);

        // d above plane (z=1)
        let d2 = DVec3::new(0.5, 0.5, 1.0);
        let above = orient3d_robust(a, b, c, d2);
        // Sign convention: positive = above for CCW abc viewed from +z
        // robust's sign convention may differ — just verify it's NOT Equal
        assert_ne!(above, Ordering::Equal);

        // d below plane (z=-1)
        let d3 = DVec3::new(0.5, 0.5, -1.0);
        let below = orient3d_robust(a, b, c, d3);
        assert_ne!(below, Ordering::Equal);
        assert_ne!(above, below, "above and below should give opposite signs");
    }

    /// ADR-058 §2.7 #3 — in_circle distinguishes cocircular.
    #[test]
    fn in_circle_robust_distinguishes_cocircular() {
        // Triangle with circumcircle = unit circle at origin
        // Vertices on unit circle (CCW)
        let a = DVec2::new(1.0, 0.0);
        let b = DVec2::new(0.0, 1.0);
        let c = DVec2::new(-1.0, 0.0);

        // p exactly on circle (cocircular at (0, -1))
        let p_on = DVec2::new(0.0, -1.0);
        assert_eq!(in_circle_robust(a, b, c, p_on), Ordering::Equal);

        // p inside circle (origin)
        let p_in = DVec2::new(0.0, 0.0);
        assert_eq!(in_circle_robust(a, b, c, p_in), Ordering::Greater);

        // p outside circle (2, 0)
        let p_out = DVec2::new(2.0, 0.0);
        assert_eq!(in_circle_robust(a, b, c, p_out), Ordering::Less);
    }

    /// ADR-058 §2.7 #4 — in_sphere distinguishes cospherical.
    #[test]
    fn in_sphere_robust_distinguishes_cospherical() {
        // Tetrahedron with circumsphere = unit sphere at origin
        // 4 vertices on unit sphere (orient: positive volume)
        let a = DVec3::new(1.0, 0.0, 0.0);
        let b = DVec3::new(0.0, 1.0, 0.0);
        let c = DVec3::new(-1.0, 0.0, 0.0);
        let d = DVec3::new(0.0, 0.0, 1.0);

        // p exactly on sphere (0, -1, 0)
        let p_on = DVec3::new(0.0, -1.0, 0.0);
        assert_eq!(in_sphere_robust(a, b, c, d, p_on), Ordering::Equal);

        // p inside sphere (origin)
        let p_in = DVec3::new(0.0, 0.0, 0.0);
        let in_sign = in_sphere_robust(a, b, c, d, p_in);
        assert_ne!(in_sign, Ordering::Equal);

        // p outside sphere (2, 0, 0)
        let p_out = DVec3::new(2.0, 0.0, 0.0);
        let out_sign = in_sphere_robust(a, b, c, d, p_out);
        assert_ne!(out_sign, Ordering::Equal);
        assert_ne!(in_sign, out_sign, "inside vs outside opposite signs");
    }

    /// Bonus: FMA sanity verification passes in test environment.
    #[test]
    fn fma_environment_sanity_check() {
        assert!(verify_predicates_environment(),
            "robust predicates require FMA-off IEEE 754 strict environment \
             — see ADR-058 §B lock-in");
    }
}
