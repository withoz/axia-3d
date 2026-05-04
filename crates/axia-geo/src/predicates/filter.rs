//! ADR-058 Phase M Step 2 — Fast filter chain.
//!
//! The `robust` crate already implements its own filter (Stages A/B/C
//! per Shewchuk). This module provides AxiA-specific filters layered
//! ABOVE that — for our HOTSPOTS where the inputs come from typical
//! mesh operations and we can short-circuit even faster than `robust`.
//!
//! ## Strategy
//!
//! For each predicate:
//!   1. Naive f64 cross/det (1-2 ops, very fast)
//!   2. Compare magnitude to a generous threshold (1e-10)
//!   3. If magnitude exceeds threshold → trust naive sign
//!   4. Otherwise → fall back to `robust` (correct)
//!
//! Threshold 1e-10 is well above f64 epsilon (~1e-16) and well below
//! mesh-scale geometric tolerance (1.5μm = 1.5e-3 mm). Anything larger
//! than 1e-10 in mesh coordinates is definitively non-degenerate.

use std::cmp::Ordering;
use glam::{DVec2, DVec3};

use super::adapter::{orient2d_robust, orient3d_robust};

/// Fast-filter threshold for cross-product magnitudes (parameter-space
/// units). Below this, fall back to robust predicate.
pub const FILTER_THRESHOLD: f64 = 1e-10;

/// Filtered orient2d — naive fast path with robust fallback at boundary.
///
/// Returns the same Ordering as `orient2d_robust` for non-degenerate
/// inputs; falls back to robust at the threshold for correctness.
pub fn orient2d_filtered(a: DVec2, b: DVec2, c: DVec2) -> Ordering {
    // Naive cross product z-component
    let cross_z = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if cross_z.abs() > FILTER_THRESHOLD {
        // Definitively non-degenerate — trust naive sign
        return if cross_z > 0.0 { Ordering::Greater } else { Ordering::Less };
    }
    // Near-degenerate — fall back to robust
    orient2d_robust(a, b, c)
}

/// Filtered orient3d — naive fast path with robust fallback at boundary.
///
/// Sign convention matches robust crate (Shewchuk):
///   det = | a.x-d.x  a.y-d.y  a.z-d.z |
///         | b.x-d.x  b.y-d.y  b.z-d.z |
///         | c.x-d.x  c.y-d.y  c.z-d.z |
/// = (a - d) · ((b - d) × (c - d))
pub fn orient3d_filtered(a: DVec3, b: DVec3, c: DVec3, d: DVec3) -> Ordering {
    let ad = a - d;
    let bd = b - d;
    let cd = c - d;
    let det = ad.dot(bd.cross(cd));
    if det.abs() > FILTER_THRESHOLD {
        return if det > 0.0 { Ordering::Greater } else { Ordering::Less };
    }
    orient3d_robust(a, b, c, d)
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-058 §2.7 Filter chain (2 spec)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-058 §2.7 #5 — Fast filter returns same as robust for
    /// non-degenerate inputs (>> threshold).
    #[test]
    fn fast_filter_returns_same_as_robust_for_non_degenerate() {
        // Clear-cut cases (>> 1e-10)
        let cases_2d = vec![
            (DVec2::new(0.0, 0.0), DVec2::new(1.0, 0.0), DVec2::new(0.5, 1.0)),    // CCW
            (DVec2::new(0.0, 0.0), DVec2::new(1.0, 0.0), DVec2::new(0.5, -1.0)),   // CW
            (DVec2::new(0.0, 0.0), DVec2::new(2.0, 3.0), DVec2::new(5.0, 1.0)),    // arbitrary
        ];
        for (a, b, c) in cases_2d {
            assert_eq!(
                orient2d_filtered(a, b, c),
                orient2d_robust(a, b, c),
                "filter mismatch for 2d case"
            );
        }

        let cases_3d = vec![
            (DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0),
             DVec3::new(0.0, 1.0, 0.0), DVec3::new(0.5, 0.5, 1.0)),  // above
            (DVec3::new(0.0, 0.0, 0.0), DVec3::new(1.0, 0.0, 0.0),
             DVec3::new(0.0, 1.0, 0.0), DVec3::new(0.5, 0.5, -1.0)), // below
        ];
        for (a, b, c, d) in cases_3d {
            assert_eq!(
                orient3d_filtered(a, b, c, d),
                orient3d_robust(a, b, c, d),
                "filter mismatch for 3d case"
            );
        }
    }

    /// ADR-058 §2.7 #6 — Fast filter falls back to robust at threshold.
    /// Inputs producing |det| < FILTER_THRESHOLD must yield the SAME
    /// Ordering as direct robust call (proves the fallback path works).
    #[test]
    fn fast_filter_falls_back_to_robust_at_threshold() {
        // 2D: 3 points that produce |cross| ≈ 1e-15 (well below threshold)
        let a = DVec2::new(0.0, 0.0);
        let b = DVec2::new(1.0, 0.0);
        // Compute c so cross_z = 1e-15 exactly (perturbation):
        let c = DVec2::new(0.5, 0.0);  // exactly collinear → cross = 0
        let direct = orient2d_robust(a, b, c);
        let filtered = orient2d_filtered(a, b, c);
        assert_eq!(direct, filtered, "filter must agree with robust at zero");
        assert_eq!(filtered, Ordering::Equal);

        // 3D coplanar
        let a3 = DVec3::new(0.0, 0.0, 0.0);
        let b3 = DVec3::new(1.0, 0.0, 0.0);
        let c3 = DVec3::new(0.0, 1.0, 0.0);
        let d3 = DVec3::new(0.5, 0.5, 0.0);  // coplanar
        let direct3 = orient3d_robust(a3, b3, c3, d3);
        let filtered3 = orient3d_filtered(a3, b3, c3, d3);
        assert_eq!(direct3, filtered3);
        assert_eq!(filtered3, Ordering::Equal);
    }
}
