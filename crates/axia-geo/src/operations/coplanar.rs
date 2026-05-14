//! ADR-101 Phase B-2 — Coplanar partial-overlap intersection primitive.
//!
//! Pure function (no DCEL mutation) that takes two coplanar convex faces and
//! computes:
//!   - the A ∩ B lens polygon (lifted to 3D world coords)
//!   - the edge-edge crossing points with edge ownership info (for B-3's
//!     `split_edge` calls)
//!
//! Caller responsibilities (B-3 will wire these):
//!   - Both faces must already be polygonal (closed-curve Circle faces must
//!     be polygonized via `Mesh::polygonize_closed_curve_face` first).
//!   - Both faces must be coplanar within `COPLANARITY_NORMAL_DOT_MIN` and
//!     `COPLANARITY_OFFSET_TOL` — ADR-101 §B-1 L-B1-3.
//!   - Both faces must be convex — ADR-101 §B-1 L-B1-1/L-B1-2.
//!
//! Errors (explicit, not silent skip — ADR-101 §B-1 L-B1-7):
//!   - `face {:?} not found / inactive`
//!   - `face {:?} boundary has fewer than 3 verts`
//!   - `faces not coplanar (normal dot {:.6} < 0.9999 or offset {:.3e} > 1.5e-6)`
//!   - `coplanar clipping requires convex faces; face {:?} is non-convex`
//!
//! This module is intentionally additive — no caller wired up. ADR-101 §B-3
//! will be the first caller.
//!
//! Cross-link: ADR-021 P7 (closed edge cycle divides face), ADR-101 §B-1
//! (Sutherland-Hodgman MVP decision), LOCKED #5 (1.5μm tolerance).

use glam::DVec3;
use anyhow::{Result, bail};

use crate::mesh::Mesh;
use crate::FaceId;
use super::polygon_geom::{PlaneBasis, face_unit_normal, sutherland_hodgman};

/// Two coplanar normals must agree within ~0.81° (cos ≥ 0.9999).
/// ADR-101 §B-1 L-B1-3.
pub const COPLANARITY_NORMAL_DOT_MIN: f64 = 0.9999;

/// LOCKED #5 — spatial-hash dedup tolerance, 1.5μm.
/// Used here as plane-offset tolerance.
pub const COPLANARITY_OFFSET_TOL: f64 = 1.5e-6;

/// 2D dedup tolerance for crossings + lens vertices (project space).
const DEDUP_EPS_2D: f64 = 1e-6;

/// Result of `coplanar_intersection_segments` — see module docs.
#[derive(Debug, Clone)]
pub struct CoplanarIntersection {
    /// Shared plane basis (derived from `face_a`'s boundary).
    pub plane: PlaneBasis,
    /// A ∩ B polygon in world coordinates, CCW on the plane.
    /// Empty `Vec` if no overlap (caller treats as "skip").
    pub lens_polygon: Vec<DVec3>,
    /// Edge-edge crossing points with edge-ownership info, ordered along
    /// `face_a`'s outer boundary (edge index ascending, t ascending within
    /// an edge). For convex × convex partial overlap, length is exactly 2
    /// (entry + exit). Empty if no overlap, or if one face fully contains
    /// the other (no boundary crossings).
    pub crossings: Vec<CoplanarCrossing>,
}

/// One edge-edge crossing point. ADR-101 §B-3 will consume this to issue
/// `split_edge` calls on both faces, then `split_face_by_chain` along the
/// segment connecting paired crossings.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoplanarCrossing {
    /// World-space crossing point (on the shared plane).
    pub point: DVec3,
    /// Index of the outer-loop edge of `face_a` that contains this point
    /// (0..N-1 for an N-vertex face; edge i connects boundary[i] →
    /// boundary[(i+1) % N]).
    pub face_a_edge: usize,
    /// Parameter t ∈ (0, 1) of the crossing along `face_a`'s edge.
    pub face_a_t: f64,
    /// Same for `face_b`.
    pub face_b_edge: usize,
    pub face_b_t: f64,
}

/// Compute the coplanar partial-overlap intersection of two convex faces.
///
/// See module documentation for invariants and error cases.
///
/// ADR-101 Phase B-2 primitive. Additive — no DCEL mutation.
pub fn coplanar_intersection_segments(
    mesh: &Mesh,
    face_a: FaceId,
    face_b: FaceId,
) -> Result<CoplanarIntersection> {
    let poly_a = collect_face_boundary(mesh, face_a)?;
    let poly_b = collect_face_boundary(mesh, face_b)?;

    let normal_a = face_unit_normal(&poly_a)
        .ok_or_else(|| anyhow::anyhow!(
            "face {:?} has degenerate boundary (Newell normal failed)", face_a))?;
    let normal_b = face_unit_normal(&poly_b)
        .ok_or_else(|| anyhow::anyhow!(
            "face {:?} has degenerate boundary (Newell normal failed)", face_b))?;

    // Coplanarity: normals must agree (allow either orientation) AND
    // face_b vertices must lie on face_a's plane within ε.
    let dot = normal_a.dot(normal_b).abs();
    if dot < COPLANARITY_NORMAL_DOT_MIN {
        bail!(
            "faces not coplanar: normal dot {:.6} < {:.4}",
            dot, COPLANARITY_NORMAL_DOT_MIN
        );
    }
    let origin_a = poly_a[0];
    for (i, p) in poly_b.iter().enumerate() {
        let offset = (p - origin_a).dot(normal_a).abs();
        if offset > COPLANARITY_OFFSET_TOL {
            bail!(
                "faces not coplanar: face_b vertex {} offset {:.3e} > {:.3e}",
                i, offset, COPLANARITY_OFFSET_TOL
            );
        }
    }

    let plane = PlaneBasis::from_polygon(&poly_a)
        .ok_or_else(|| anyhow::anyhow!(
            "could not build PlaneBasis from face {:?}", face_a))?;

    // Project both polygons to 2D in the shared basis.
    let a_2d: Vec<(f64, f64)> = poly_a.iter().map(|p| plane.project(*p)).collect();
    let b_2d_raw: Vec<(f64, f64)> = poly_b.iter().map(|p| plane.project(*p)).collect();

    // Sutherland-Hodgman requires the clip polygon (b) to be CCW in the
    // basis. If face_b's projected orientation is reversed (because its
    // normal is anti-parallel to face_a's), flip the 2D points so the
    // clipping math works.
    let area_b = polygon_signed_area_2d(&b_2d_raw);
    let b_2d: Vec<(f64, f64)> = if area_b < 0.0 {
        b_2d_raw.iter().rev().copied().collect()
    } else {
        b_2d_raw.clone()
    };

    // Both polygons must be convex (ADR-101 §B-1 L-B1-1/2).
    if !is_convex_ccw_2d(&a_2d) {
        bail!(
            "coplanar clipping requires convex faces; face {:?} is non-convex",
            face_a
        );
    }
    if !is_convex_ccw_2d(&b_2d) {
        bail!(
            "coplanar clipping requires convex faces; face {:?} is non-convex",
            face_b
        );
    }

    // ── Lens polygon (Sutherland-Hodgman) ──
    let lens_polygon = match sutherland_hodgman(&a_2d, &b_2d) {
        Some(lens_2d) => lens_2d.into_iter().map(|(x, y)| plane.lift(x, y)).collect(),
        None => Vec::new(),
    };

    // ── Edge-edge crossings ──
    // Pairwise — N×M is fine for our sizes (typical N,M ≤ 64 for circles
    // post-polygonization). For each pair compute the 2D segment-segment
    // intersection. Map face_b's edge index back to original orientation
    // if we reversed b_2d above.
    let n_a = a_2d.len();
    let n_b = b_2d.len();
    let b_reversed = area_b < 0.0;
    let mut raw_crossings: Vec<CoplanarCrossing> = Vec::new();
    for i in 0..n_a {
        let a0 = a_2d[i];
        let a1 = a_2d[(i + 1) % n_a];
        for j in 0..n_b {
            let b0 = b_2d[j];
            let b1 = b_2d[(j + 1) % n_b];
            if let Some((pt2d, ta, tb)) = segment_segment_intersect_2d(a0, a1, b0, b1) {
                // Map j back to the *original* face_b edge index.
                // If b_2d was reversed, then b_2d[j] corresponds to
                // poly_b[(n_b - 1) - j], and b_2d[j+1] to
                // poly_b[(n_b - 1) - (j+1)] = poly_b[n_b - 2 - j].
                // The original edge index is (n_b - 2 - j) mod n_b, and
                // t along it is (1.0 - tb).
                let (orig_b_edge, orig_b_t) = if b_reversed {
                    let edge = (n_b + n_b - 2 - j) % n_b;
                    (edge, 1.0 - tb)
                } else {
                    (j, tb)
                };
                let pt3d = plane.lift(pt2d.0, pt2d.1);
                raw_crossings.push(CoplanarCrossing {
                    point: pt3d,
                    face_a_edge: i,
                    face_a_t: ta,
                    face_b_edge: orig_b_edge,
                    face_b_t: orig_b_t,
                });
            }
        }
    }

    // Sort by (face_a_edge, face_a_t) so output is deterministic and ready
    // for B-3 to consume in boundary order.
    raw_crossings.sort_by(|c1, c2| {
        c1.face_a_edge.cmp(&c2.face_a_edge)
            .then(c1.face_a_t.partial_cmp(&c2.face_a_t).unwrap_or(std::cmp::Ordering::Equal))
    });

    // Dedup near-duplicates in 2D (shared corner between two adjacent
    // edges of face_a getting hit by the same face_b edge, etc.).
    let mut crossings: Vec<CoplanarCrossing> = Vec::with_capacity(raw_crossings.len());
    for c in raw_crossings {
        let dup = crossings.iter().any(|prev| {
            let d = c.point - prev.point;
            d.length_squared() < DEDUP_EPS_2D * DEDUP_EPS_2D
        });
        if !dup {
            crossings.push(c);
        }
    }

    Ok(CoplanarIntersection { plane, lens_polygon, crossings })
}

// ─── Helpers ──────────────────────────────────────────────────────────

fn collect_face_boundary(mesh: &Mesh, face_id: FaceId) -> Result<Vec<DVec3>> {
    let face = mesh.faces.get(face_id)
        .ok_or_else(|| anyhow::anyhow!("face {:?} not found", face_id))?;
    if !face.is_active() {
        bail!("face {:?} is inactive", face_id);
    }
    let outer_start = face.outer().start;
    if outer_start.is_null() {
        bail!("face {:?} has null outer loop", face_id);
    }
    let verts = mesh.collect_loop_verts(outer_start)?;
    if verts.len() < 3 {
        bail!("face {:?} boundary has fewer than 3 verts", face_id);
    }
    let positions: Vec<DVec3> = verts.iter()
        .map(|&vid| mesh.verts.get(vid).map(|v| v.pos()).unwrap_or(DVec3::ZERO))
        .collect();
    Ok(positions)
}

/// Shoelace signed area (CCW > 0).
fn polygon_signed_area_2d(poly: &[(f64, f64)]) -> f64 {
    let n = poly.len();
    if n < 3 { return 0.0; }
    let mut a = 0.0;
    for i in 0..n {
        let (x1, y1) = poly[i];
        let (x2, y2) = poly[(i + 1) % n];
        a += x1 * y2 - x2 * y1;
    }
    a * 0.5
}

/// Convex CCW polygon ⇔ every consecutive cross product has the same sign
/// (here: ≥ -eps, since CCW polygon area > 0 implies left turns).
fn is_convex_ccw_2d(poly: &[(f64, f64)]) -> bool {
    let n = poly.len();
    if n < 3 { return false; }
    // Polygon must already be CCW for `sutherland_hodgman` to be valid.
    if polygon_signed_area_2d(poly) <= 0.0 { return false; }
    const EPS: f64 = -1e-9;
    for i in 0..n {
        let (ax, ay) = poly[i];
        let (bx, by) = poly[(i + 1) % n];
        let (cx, cy) = poly[(i + 2) % n];
        let cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if cross < EPS { return false; }
    }
    true
}

/// Strict segment-segment intersection in 2D, returning `(point, ta, tb)`
/// where `ta, tb ∈ (0, 1)` are the parameters along each segment.
///
/// Returns `None` for:
///   - parallel segments (denom ≈ 0)
///   - intersection at endpoint (t ≤ 0 or t ≥ 1 within eps) — these would
///     just be shared vertices, not new crossings
///   - intersection outside both segments
fn segment_segment_intersect_2d(
    a0: (f64, f64),
    a1: (f64, f64),
    b0: (f64, f64),
    b1: (f64, f64),
) -> Option<((f64, f64), f64, f64)> {
    let ra = (a1.0 - a0.0, a1.1 - a0.1);
    let rb = (b1.0 - b0.0, b1.1 - b0.1);
    let denom = ra.0 * rb.1 - ra.1 * rb.0;
    if denom.abs() < 1e-12 { return None; }
    let d = (b0.0 - a0.0, b0.1 - a0.1);
    let ta = (d.0 * rb.1 - d.1 * rb.0) / denom;
    let tb = (d.0 * ra.1 - d.1 * ra.0) / denom;
    const ENDPOINT_EPS: f64 = 1e-9;
    if ta <= ENDPOINT_EPS || ta >= 1.0 - ENDPOINT_EPS { return None; }
    if tb <= ENDPOINT_EPS || tb >= 1.0 - ENDPOINT_EPS { return None; }
    let pt = (a0.0 + ta * ra.0, a0.1 + ta * ra.1);
    Some((pt, ta, tb))
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;

    fn add_quad(mesh: &mut Mesh, verts: [DVec3; 4]) -> FaceId {
        let vids: Vec<_> = verts.iter().map(|p| mesh.add_vertex(*p)).collect();
        mesh.add_face(&vids, MaterialId::new(0)).expect("add_face OK")
    }

    fn xy(x: f64, y: f64) -> DVec3 { DVec3::new(x, y, 0.0) }

    // ── Happy-path: two axis-aligned squares with partial overlap ──
    //
    // face_a: square [0,0]–[10,10]
    // face_b: square [5,5]–[15,15]  → lens = [5,5]–[10,10], 4 crossings
    #[test]
    fn adr101_phase_b2_partial_overlap_returns_lens_and_2_crossings() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let result = coplanar_intersection_segments(&mesh, a, b).expect("OK");
        assert!(!result.lens_polygon.is_empty(),
            "expected non-empty lens, got {:?}", result.lens_polygon);
        assert_eq!(result.crossings.len(), 2,
            "convex × convex partial overlap → exactly 2 boundary crossings, got {}: {:?}",
            result.crossings.len(), result.crossings);
        // Lens should contain (7.5, 7.5) — center of the overlap region.
        let centroid = result.lens_polygon.iter()
            .copied()
            .reduce(|a, b| a + b)
            .unwrap() / result.lens_polygon.len() as f64;
        assert!((centroid.x - 7.5).abs() < 0.5);
        assert!((centroid.y - 7.5).abs() < 0.5);
        assert!(centroid.z.abs() < 1e-9);
    }

    // ── No overlap: lens empty + 0 crossings ──
    #[test]
    fn adr101_phase_b2_disjoint_returns_empty() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(1.0, 0.0), xy(1.0, 1.0), xy(0.0, 1.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(6.0, 5.0), xy(6.0, 6.0), xy(5.0, 6.0),
        ]);
        let result = coplanar_intersection_segments(&mesh, a, b).expect("OK");
        assert!(result.lens_polygon.is_empty(),
            "disjoint faces should produce empty lens, got {:?}", result.lens_polygon);
        assert!(result.crossings.is_empty(),
            "disjoint faces should produce 0 crossings, got {:?}", result.crossings);
    }

    // ── Full containment (A ⊂ B): lens = A, 0 crossings ──
    #[test]
    fn adr101_phase_b2_containment_no_crossings() {
        let mut mesh = Mesh::new();
        let inner = add_quad(&mut mesh, [
            xy(2.0, 2.0), xy(3.0, 2.0), xy(3.0, 3.0), xy(2.0, 3.0),
        ]);
        let outer = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let result = coplanar_intersection_segments(&mesh, inner, outer).expect("OK");
        assert!(!result.lens_polygon.is_empty(), "containment → lens = inner");
        assert!(result.crossings.is_empty(),
            "containment → 0 boundary crossings, got {:?}", result.crossings);
    }

    // ── Non-coplanar: explicit error ──
    #[test]
    fn adr101_phase_b2_non_coplanar_errors() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        // face_b lies on z = 1 plane — not coplanar with face_a (z = 0).
        let b = add_quad(&mut mesh, [
            DVec3::new(5.0, 5.0, 1.0), DVec3::new(15.0, 5.0, 1.0),
            DVec3::new(15.0, 15.0, 1.0), DVec3::new(5.0, 15.0, 1.0),
        ]);
        let err = coplanar_intersection_segments(&mesh, a, b)
            .expect_err("expected non-coplanar error");
        let msg = format!("{}", err);
        assert!(msg.contains("not coplanar"), "got error: {}", msg);
    }

    // ── Coplanarity ε boundary: 1μm offset (under 1.5μm) should pass ──
    #[test]
    fn adr101_phase_b2_within_epsilon_passes() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        // 1μm = 1e-6, under 1.5e-6 tolerance.
        let b = add_quad(&mut mesh, [
            DVec3::new(5.0, 5.0, 1e-6), DVec3::new(15.0, 5.0, 1e-6),
            DVec3::new(15.0, 15.0, 1e-6), DVec3::new(5.0, 15.0, 1e-6),
        ]);
        let result = coplanar_intersection_segments(&mesh, a, b)
            .expect("1μm offset within tol must pass");
        assert_eq!(result.crossings.len(), 2);
    }

    // ── Anti-parallel normals (opposite winding) should still be "coplanar" ──
    // ADR-101: face orientation is determined by surface_normal_hint, but
    // user may stack two opposite-winding rects on the same plane. The
    // primitive must handle this gracefully.
    #[test]
    fn adr101_phase_b2_anti_parallel_normals_treated_as_coplanar() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        // CW winding → normal is -Z (anti-parallel to face_a's +Z).
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(5.0, 15.0), xy(15.0, 15.0), xy(15.0, 5.0),
        ]);
        let result = coplanar_intersection_segments(&mesh, a, b)
            .expect("anti-parallel normals on shared plane must be accepted");
        // Lens still computed even with reversed orientation.
        assert!(!result.lens_polygon.is_empty());
        assert_eq!(result.crossings.len(), 2);
    }

    // ── Non-convex face rejected ──
    #[test]
    fn adr101_phase_b2_non_convex_face_errors() {
        let mut mesh = Mesh::new();
        // L-shape (5 verts, concave at index 2).
        let verts = [
            xy(0.0, 0.0), xy(4.0, 0.0), xy(4.0, 2.0),
            xy(2.0, 2.0), xy(2.0, 4.0), xy(0.0, 4.0),
        ];
        let vids: Vec<_> = verts.iter().map(|p| mesh.add_vertex(*p)).collect();
        let l_shape = mesh.add_face(&vids, MaterialId::new(0)).expect("add_face OK");
        let convex = add_quad(&mut mesh, [
            xy(1.0, 1.0), xy(5.0, 1.0), xy(5.0, 5.0), xy(1.0, 5.0),
        ]);
        let err = coplanar_intersection_segments(&mesh, l_shape, convex)
            .expect_err("expected non-convex error");
        let msg = format!("{}", err);
        assert!(msg.contains("non-convex"), "got error: {}", msg);
    }

    // ── Edge ownership info: crossings carry valid (edge_index, t) ──
    //
    // For canonical happy-path: 2 crossings must lie on shared boundary
    // segments. Each crossing must:
    //   - reconstruct exactly from face_a's boundary edge at face_a_t
    //   - reconstruct exactly from face_b's boundary edge at face_b_t
    //   - have both t-values strictly in (0, 1)
    // We do NOT assert specific edge indices because `collect_loop_verts`
    // traversal start depends on which HE is `outer().start`, which is
    // implementation detail of `add_face`. The invariant is that the
    // (edge_index, t) pair correctly reconstructs the world point.
    #[test]
    fn adr101_phase_b2_crossings_carry_edge_ownership_info() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let result = coplanar_intersection_segments(&mesh, a, b).expect("OK");
        assert_eq!(result.crossings.len(), 2);

        let poly_a = collect_face_boundary(&mesh, a).expect("collect a");
        let poly_b = collect_face_boundary(&mesh, b).expect("collect b");

        // Crossings happen at (10, 5) and (5, 10) — verify each crossing
        // matches one of those world points.
        let expected_points = [DVec3::new(10.0, 5.0, 0.0), DVec3::new(5.0, 10.0, 0.0)];
        for c in &result.crossings {
            // 1) t-values strictly in open interval (0, 1)
            assert!(c.face_a_t > 0.0 && c.face_a_t < 1.0,
                "face_a_t out of (0,1): {}", c.face_a_t);
            assert!(c.face_b_t > 0.0 && c.face_b_t < 1.0,
                "face_b_t out of (0,1): {}", c.face_b_t);
            // 2) point matches one of the expected world crossings
            let matches_expected = expected_points.iter()
                .any(|p| (*p - c.point).length() < 1e-9);
            assert!(matches_expected,
                "crossing {:?} does not match expected (10,5) or (5,10)",
                c.point);
            // 3) reconstruction from face_a: edge[i] + t * (edge[i+1] - edge[i]) == point
            let n_a = poly_a.len();
            let recon_a = poly_a[c.face_a_edge]
                + (poly_a[(c.face_a_edge + 1) % n_a] - poly_a[c.face_a_edge]) * c.face_a_t;
            assert!((recon_a - c.point).length() < 1e-9,
                "face_a edge reconstruction failed: expected {:?}, got {:?}",
                c.point, recon_a);
            // 4) reconstruction from face_b
            let n_b = poly_b.len();
            let recon_b = poly_b[c.face_b_edge]
                + (poly_b[(c.face_b_edge + 1) % n_b] - poly_b[c.face_b_edge]) * c.face_b_t;
            assert!((recon_b - c.point).length() < 1e-9,
                "face_b edge reconstruction failed: expected {:?}, got {:?}",
                c.point, recon_b);
        }
    }

    // ── Inactive face rejected ──
    #[test]
    fn adr101_phase_b2_inactive_face_errors() {
        let mut mesh = Mesh::new();
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        mesh.remove_face(b).expect("deactivate b");
        let err = coplanar_intersection_segments(&mesh, a, b)
            .expect_err("inactive face should error");
        let msg = format!("{}", err);
        assert!(msg.contains("inactive") || msg.contains("not found"),
            "got error: {}", msg);
    }
}
