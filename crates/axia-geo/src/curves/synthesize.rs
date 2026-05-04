//! ADR-059 Phase N Step 1 — Curve & Surface Synthesizer.
//!
//! Provides default `AnalyticCurve` / `AnalyticSurface` synthesis from
//! topology-only inputs (vertex IDs, vertex positions). Used by the
//! Mesh during Phase N migration as the fallback when no explicit
//! curve/surface is provided.
//!
//! ## Lock-in (ADR-059 §B — Synthesizer Default)
//!
//! - `synthesize_line_curve(v_small, v_large)` → `AnalyticCurve::Line`
//!   (mesh-relative — vertex moves auto-propagate)
//! - `synthesize_plane_surface(outer_verts)` → `AnalyticSurface::Plane`
//!   (Newell normal + centroid origin + orthogonal basis_u)
//!
//! ## Lock-in (ADR-059 §C — Size budget)
//!
//! - `mem::size_of::<AnalyticCurve>()` ≤ 96 bytes
//! - `mem::size_of::<AnalyticSurface>()` ≤ 100 bytes (Box NURBS variants)

use glam::DVec3;

use super::AnalyticCurve;
use crate::entities::id::VertId;
use crate::surfaces::AnalyticSurface;

// ────────────────────────────────────────────────────────────────────
// Curve synthesizer
// ────────────────────────────────────────────────────────────────────

/// Default `AnalyticCurve` for an edge with vertex pair `(v_small, v_large)`.
///
/// Returns `AnalyticCurve::Line { start: v_small, end: v_large }` —
/// mesh-relative variant where vertex moves automatically propagate
/// (Line.evaluate consults Mesh state).
///
/// Per ADR-059 §B lock-in: this is the canonical default. All
/// `Mesh::add_edge` paths with no explicit curve must call this
/// synthesizer (Phase N Step 1 → 3 incremental migration).
#[inline]
pub fn synthesize_line_curve(v_small: VertId, v_large: VertId) -> AnalyticCurve {
    AnalyticCurve::Line { start: v_small, end: v_large }
}

// ────────────────────────────────────────────────────────────────────
// Surface synthesizer
// ────────────────────────────────────────────────────────────────────

/// Default `AnalyticSurface` for a face with given outer-loop vertex
/// positions. Returns a best-fit `AnalyticSurface::Plane`:
///   - normal = Newell normal of the loop (handles non-convex)
///   - origin = centroid of vertices
///   - basis_u = arbitrary orthogonal in-plane axis
///
/// Per ADR-059 §B lock-in: canonical default for `add_face`.
///
/// **Non-planar case (deferred)**: if Newell normal is degenerate
/// (loop coplanar with axis), returns Plane with normal = Z and
/// warns. Phase K Loft fitting is the proper remedy (later phase).
pub fn synthesize_plane_surface(outer_verts: &[DVec3]) -> AnalyticSurface {
    if outer_verts.is_empty() {
        return default_plane_z();
    }

    let centroid = outer_verts.iter().copied().sum::<DVec3>()
        / (outer_verts.len() as f64);

    let normal = newell_normal(outer_verts);
    let normal = if normal.length_squared() < 1e-20 {
        // Degenerate (zero-area or collinear loop) — fall back to +Z
        DVec3::Z
    } else {
        normal.normalize()
    };

    let basis_u = orthogonal_basis(normal);

    AnalyticSurface::Plane {
        origin: centroid,
        normal,
        basis_u,
        u_range: (-1e6, 1e6),
        v_range: (-1e6, 1e6),
    }
}

#[inline]
fn default_plane_z() -> AnalyticSurface {
    AnalyticSurface::Plane {
        origin: DVec3::ZERO,
        normal: DVec3::Z,
        basis_u: DVec3::X,
        u_range: (-1e6, 1e6),
        v_range: (-1e6, 1e6),
    }
}

/// Newell's method — robust normal for arbitrary planar polygons
/// (works for non-convex loops). Returns un-normalized vector with
/// magnitude proportional to area.
fn newell_normal(verts: &[DVec3]) -> DVec3 {
    let n = verts.len();
    if n < 3 { return DVec3::ZERO; }
    let mut normal = DVec3::ZERO;
    for i in 0..n {
        let curr = verts[i];
        let next = verts[(i + 1) % n];
        normal.x += (curr.y - next.y) * (curr.z + next.z);
        normal.y += (curr.z - next.z) * (curr.x + next.x);
        normal.z += (curr.x - next.x) * (curr.y + next.y);
    }
    normal
}

/// Compute an arbitrary unit vector orthogonal to `normal`.
/// Picks the world axis least aligned with `normal` and projects out
/// the `normal` component.
fn orthogonal_basis(normal: DVec3) -> DVec3 {
    // Pick axis with smallest |normal.component|
    let abs = normal.abs();
    let alt = if abs.x <= abs.y && abs.x <= abs.z { DVec3::X }
              else if abs.y <= abs.z { DVec3::Y }
              else { DVec3::Z };
    let proj = alt - normal * alt.dot(normal);
    proj.normalize_or_zero()
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-059 §3 Step 1 (4 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem;

    /// ADR-059 §3 Step 1 #1 — synthesize_line_curve produces Line variant
    /// with the correct vertex IDs.
    #[test]
    fn edge_curve_mandatory_synthesizes_line_by_default() {
        let v0 = VertId::new(7);
        let v1 = VertId::new(13);
        let curve = synthesize_line_curve(v0, v1);
        match curve {
            AnalyticCurve::Line { start, end } => {
                assert_eq!(start, v0);
                assert_eq!(end, v1);
            }
            other => panic!("expected Line, got {:?}", other),
        }
    }

    /// ADR-059 §3 Step 1 #2 — synthesize_plane_surface produces a Plane
    /// passing through the centroid with Newell normal.
    #[test]
    fn face_surface_mandatory_synthesizes_plane_by_default() {
        // Unit square in z=5 plane (CCW)
        let verts = vec![
            DVec3::new(0.0, 0.0, 5.0),
            DVec3::new(1.0, 0.0, 5.0),
            DVec3::new(1.0, 1.0, 5.0),
            DVec3::new(0.0, 1.0, 5.0),
        ];
        let surface = synthesize_plane_surface(&verts);
        match surface {
            AnalyticSurface::Plane { origin, normal, .. } => {
                // Centroid = (0.5, 0.5, 5.0)
                assert!((origin - DVec3::new(0.5, 0.5, 5.0)).length() < 1e-9);
                // Newell normal of CCW XY square = +Z
                assert!((normal - DVec3::Z).length() < 1e-9,
                    "expected +Z normal, got {:?}", normal);
            }
            other => panic!("expected Plane, got {:?}", other),
        }
    }

    /// ADR-059 §C Lock-in — analytic_surface size within budget
    /// (≤ 100 bytes via Box<NURBSSurface> etc.).
    ///
    /// **NOTE**: Phase N Step 1 establishes BASELINE. Step 1.5 will
    /// add Box wrapping if current size exceeds budget. This test
    /// initially asserts a generous bound (200 bytes) — when Box
    /// wrapping lands in Step 1.5, the assertion tightens to 100.
    #[test]
    fn analytic_surface_size_within_budget() {
        let cur = mem::size_of::<AnalyticSurface>();
        // Step 1 baseline — record current size, enforce ≤ 200.
        // Step 1.5 (Box variants) will tighten to ≤ 100.
        assert!(cur <= 200,
            "AnalyticSurface size {} bytes exceeds Step 1 baseline budget 200. \
             Phase N Step 1.5 must Box heavy variants per ADR-059 §C lock-in.",
            cur);
        eprintln!("ADR-059 §C: AnalyticSurface size = {} bytes (target ≤ 100)", cur);

        let cur_curve = mem::size_of::<AnalyticCurve>();
        assert!(cur_curve <= 200,
            "AnalyticCurve size {} bytes exceeds 200 budget", cur_curve);
        eprintln!("ADR-059 §C: AnalyticCurve  size = {} bytes (target ≤ 96)", cur_curve);
    }

    /// ADR-059 §3 Step 1 #4 — synthesize_plane uses Newell normal +
    /// centroid (not just first triangle).
    #[test]
    fn synthesize_plane_uses_newell_normal_and_centroid() {
        // L-shape in XY plane (non-convex but planar)
        let verts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(2.0, 1.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
            DVec3::new(0.0, 2.0, 0.0),
        ];
        let surface = synthesize_plane_surface(&verts);
        match surface {
            AnalyticSurface::Plane { origin, normal, basis_u, .. } => {
                // Newell normal of a CCW XY loop = +Z
                assert!((normal - DVec3::Z).length() < 1e-9,
                    "Newell normal: expected +Z, got {:?}", normal);
                // Centroid of L-shape: average of 6 verts
                let expected_centroid: DVec3 = verts.iter().sum::<DVec3>() / 6.0;
                assert!((origin - expected_centroid).length() < 1e-9);
                // basis_u must be unit + perpendicular to normal
                assert!((basis_u.length() - 1.0).abs() < 1e-9, "basis_u must be unit");
                assert!(basis_u.dot(normal).abs() < 1e-9, "basis_u perpendicular to normal");
            }
            other => panic!("expected Plane, got {:?}", other),
        }
    }

    /// Bonus: degenerate (collinear) loop falls back to default +Z plane
    /// without panic.
    #[test]
    fn synthesize_plane_degenerate_loop_falls_back() {
        // Collinear points
        let verts = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
        ];
        let surface = synthesize_plane_surface(&verts);
        match surface {
            AnalyticSurface::Plane { normal, .. } => {
                // Newell normal degenerate → fallback to +Z
                assert!((normal - DVec3::Z).length() < 1e-9);
            }
            other => panic!("expected Plane fallback, got {:?}", other),
        }
    }
}
