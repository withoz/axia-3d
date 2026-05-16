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
use crate::entities::HeFlags;
use crate::{FaceId, VertId};
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

// ─── B-3b: auto_intersect_coplanar (DCEL surgery) ─────────────────────

/// Result of `auto_intersect_coplanar` — three new face IDs replacing the
/// two original input faces. ADR-101 §B-3 lens semantics — Option (b).
#[derive(Debug, Clone, Copy)]
pub struct AutoIntersectResult {
    /// face_a's region minus the lens — may be non-convex.
    pub face_a_only: FaceId,
    /// face_b's region minus the lens — may be non-convex.
    pub face_b_only: FaceId,
    /// A ∩ B lens region — promoted as a standalone face.
    pub lens: FaceId,
}

/// ADR-101 §B-3b — Coplanar partial-overlap auto-intersect.
///
/// Splits two coplanar convex faces with partial overlap into three
/// sub-faces (face_a_only / face_b_only / lens) per ADR-101 §B-3 Option
/// (b) "Single promoted lens face" semantics.
///
/// # Behavior
///
/// - Path B closed-curve Circle faces are auto-polygonized first
///   (Phase A `polygonize_closed_curve_face` helper, L-B3b-1).
/// - If no partial overlap (disjoint or full containment) → returns
///   `Ok(None)` without DCEL mutation (L-B3b-5, silent skip 차단 only
///   for actual errors).
/// - Original `face_a` and `face_b` are deactivated; three new faces
///   are created via remove + add rebuild pattern (L-B3b-2).
/// - All three new sub-faces inherit `face_a`'s surface metadata
///   (LOCKED #9 A-χ answer pattern, L-B3b-3).
/// - XIA inheritance is a Scene-layer concern — Mesh layer only returns
///   the three new FaceIds. Caller is responsible for `min(face_a_id,
///   face_b_id).xia` assignment per ADR-101 L-B1-4a.
///
/// # Errors
///
/// - Inherits all errors from `coplanar_intersection_segments`
///   (not-coplanar, non-convex, inactive face, etc.).
/// - `polygon_difference_walking` failures (degenerate input, etc.).
///
/// # Lock-ins (ADR-101 §B-3b)
///
/// - L-B3b-1 Path B closed-curve auto-polygonize before intersection
///   (Phase A helper). Path B Circle × Circle activated by B-3c
///   orphan-edge cleanup (step 8.5 below).
/// - L-B3b-2 Rebuild via remove_face × 2 + cleanup orphan edges (B-3c)
///   + add_face × 3.
/// - L-B3b-3 Surface metadata inheritance (parent → all 3 sub-faces)
/// - L-B3b-4 XIA inheritance deferred to Scene-layer caller
/// - L-B3b-5 No overlap → `Ok(None)`, no mutation
/// - L-B3b-6 `verify_face_invariants()` 회귀 강제 (manifold guard)
/// - L-B3c-* See `Mesh::cleanup_orphan_boundary_edges` docs for the
///   orphan-cleanup lock-ins.
///
/// # Cross-link
///
/// ADR-101 §B-3 (Option (b) decision), ADR-021 P7 (closed boundary =
/// face), ADR-022 P9 (small-face promote pattern), Phase A (Path B
/// polygonize helper), Phase B-2 (`coplanar_intersection_segments`),
/// Phase B-3a (`polygon_difference_walking`).
pub fn auto_intersect_coplanar(
    mesh: &mut Mesh,
    face_a_input: FaceId,
    face_b_input: FaceId,
    material: crate::MaterialId,
) -> Result<Option<AutoIntersectResult>> {
    // ── B-4b PRE-CHECK (non-destructive) ──
    //
    // ADR-101 Amendment 7 canonical "check first, mutate second":
    // before polygonizing Path B closed-curve faces (destructive),
    // perform cheap non-destructive checks that can short-circuit for
    // disjoint / non-coplanar pairs. This preserves Path B's kernel-
    // native representation when no auto-split is needed.
    //
    // L-B4b-1: pre-check ordering — AABB → coplanarity → polygonize.
    // L-B4b-2: Path B AABB / normal extracted from AnalyticCurve metadata.

    // AABB overlap. If disjoint, return Ok(None) immediately — no mutation.
    let aabb_a = face_world_aabb(mesh, face_a_input);
    let aabb_b = face_world_aabb(mesh, face_b_input);
    if let (Some(a), Some(b)) = (aabb_a, aabb_b) {
        if !aabb_overlaps(&a, &b, COPLANARITY_OFFSET_TOL) {
            return Ok(None);
        }
    }
    // (If either AABB is None — degenerate face — fall through to the
    // existing path which will return Err/None at the right step.)

    // Coplanarity pre-check (normal + plane offset). Skip polygonization
    // for clearly non-coplanar pairs.
    if let (Some(na), Some(nb)) = (
        face_world_normal(mesh, face_a_input),
        face_world_normal(mesh, face_b_input),
    ) {
        let dot = na.dot(nb).abs();
        if dot < COPLANARITY_NORMAL_DOT_MIN {
            return Ok(None);
        }
        if let (Some(pa), Some(pb)) = (
            face_anchor_position(mesh, face_a_input),
            face_anchor_position(mesh, face_b_input),
        ) {
            let offset = (pb - pa).dot(na).abs();
            if offset > COPLANARITY_OFFSET_TOL {
                return Ok(None);
            }
        }
    }

    // Step 0: NOW polygonize Path B closed-curve Circle faces (L-B3b-1).
    // The pre-checks above ensured we only mutate when intersection is
    // genuinely plausible.
    let face_a = mesh
        .polygonize_closed_curve_face(face_a_input, material)?
        .unwrap_or(face_a_input);
    let face_b = mesh
        .polygonize_closed_curve_face(face_b_input, material)?
        .unwrap_or(face_b_input);

    // Step 1: Compute intersection (read-only).
    let inter = coplanar_intersection_segments(mesh, face_a, face_b)?;

    // Step 2: No partial overlap → no-op (L-B3b-5).
    // Partial overlap is characterized by EXACTLY 2 boundary crossings
    // and a non-empty lens polygon. Disjoint (0 crossings, empty lens),
    // containment (0 crossings, full A or B lens), and degenerate
    // touching (1+ crossings but degenerate lens) all return Ok(None).
    if inter.crossings.len() != 2 || inter.lens_polygon.is_empty() {
        return Ok(None);
    }

    let plane = inter.plane;
    let lens_3d = inter.lens_polygon;
    let lens_2d: Vec<(f64, f64)> = lens_3d.iter().map(|p| plane.project(*p)).collect();

    // Step 3: Collect 2D boundaries.
    let poly_a_3d = collect_face_boundary(mesh, face_a)?;
    let poly_b_3d = collect_face_boundary(mesh, face_b)?;
    let poly_a_2d: Vec<(f64, f64)> = poly_a_3d.iter().map(|p| plane.project(*p)).collect();
    let poly_b_2d_raw: Vec<(f64, f64)> = poly_b_3d.iter().map(|p| plane.project(*p)).collect();

    // face_b may be CW in the basis (anti-parallel normal vs face_a) —
    // polygon_difference_walking requires CCW input. Reverse if needed
    // and adjust crossing edge indices accordingly.
    let area_b = polygon_signed_area_2d(&poly_b_2d_raw);
    let b_reversed = area_b < 0.0;
    let poly_b_2d: Vec<(f64, f64)> = if b_reversed {
        poly_b_2d_raw.iter().rev().copied().collect()
    } else {
        poly_b_2d_raw
    };
    let n_b = poly_b_2d.len();

    // Step 4: Build crossings arrays for each face's polygon_difference
    //         walking call.
    let crossings_a: Vec<(usize, f64, (f64, f64))> = inter
        .crossings
        .iter()
        .map(|c| (c.face_a_edge, c.face_a_t, plane.project(c.point)))
        .collect();

    let crossings_b: Vec<(usize, f64, (f64, f64))> = inter
        .crossings
        .iter()
        .map(|c| {
            if b_reversed {
                // Reversed b: original edge `e` ↔ new edge `(n - 2 - e) mod n`,
                //             t `tb` ↔ `1 - tb`.
                let new_edge = (n_b + n_b - 2 - c.face_b_edge) % n_b;
                (new_edge, 1.0 - c.face_b_t, plane.project(c.point))
            } else {
                (c.face_b_edge, c.face_b_t, plane.project(c.point))
            }
        })
        .collect();

    // Step 5: Compute A \ lens and B \ lens via boundary walking.
    let a_only_2d = polygon_difference_walking(&poly_a_2d, &lens_2d, &crossings_a)?;
    let b_only_2d = polygon_difference_walking(&poly_b_2d, &lens_2d, &crossings_b)?;

    // Step 6: Lift back to 3D world coords.
    let a_only_3d: Vec<DVec3> = a_only_2d.iter().map(|(x, y)| plane.lift(*x, *y)).collect();
    let b_only_3d: Vec<DVec3> = b_only_2d.iter().map(|(x, y)| plane.lift(*x, *y)).collect();

    // Step 7: Snapshot parent surface metadata (L-B3b-3). Both faces
    //         should share the same surface (Plane) — we use face_a's
    //         as the canonical source per ADR-101 L-B1-4.
    let surface_inherit = mesh
        .faces
        .get(face_a)
        .and_then(|f| f.surface().cloned());

    // Step 7.5 (B-3c L-B3c-5): snapshot boundary vert lists BEFORE
    //         removing the faces, for orphan-edge cleanup step 8.5.
    let face_a_boundary_verts: Vec<VertId> = {
        let outer_start = mesh.faces[face_a].outer().start;
        mesh.collect_loop_verts(outer_start)?
    };
    let face_b_boundary_verts: Vec<VertId> = {
        let outer_start = mesh.faces[face_b].outer().start;
        mesh.collect_loop_verts(outer_start)?
    };

    // Step 8: Deactivate originals.
    mesh.remove_face(face_a)?;
    mesh.remove_face(face_b)?;

    // Step 8.5 (B-3c): cleanup orphan boundary edges left over by
    //         remove_face. Without this, the subsequent add_face × 3
    //         can reuse free HEs in conflicting directions, producing
    //         non-manifold edges (shared by 3 active faces).
    let _orphans_removed = mesh.cleanup_orphan_boundary_edges(&[
        face_a_boundary_verts.as_slice(),
        face_b_boundary_verts.as_slice(),
    ]);

    // Step 9: Build new faces (L-B3b-2 rebuild pattern).
    let a_only_vids: Vec<VertId> = a_only_3d.iter().map(|p| mesh.add_vertex(*p)).collect();
    let b_only_vids: Vec<VertId> = b_only_3d.iter().map(|p| mesh.add_vertex(*p)).collect();
    let lens_vids: Vec<VertId> = lens_3d.iter().map(|p| mesh.add_vertex(*p)).collect();

    let face_a_only = mesh.add_face(&a_only_vids, material)?;
    let face_b_only = mesh.add_face(&b_only_vids, material)?;
    let lens = mesh.add_face(&lens_vids, material)?;

    // Step 10: Surface inheritance (L-B3b-3).
    if let Some(surf) = surface_inherit {
        if let Some(f) = mesh.faces.get_mut(face_a_only) {
            f.set_surface(Some(surf.clone()));
        }
        if let Some(f) = mesh.faces.get_mut(face_b_only) {
            f.set_surface(Some(surf.clone()));
        }
        if let Some(f) = mesh.faces.get_mut(lens) {
            f.set_surface(Some(surf));
        }
    }

    // Step 10.5 (Amendment 9, ADR-101 L-B9): split-induced edges HARD flag.
    // 메타-원칙 #15 — 동일 분할 연산은 동일 topological contract.
    // `Mesh::split_face` (mesh.rs:4068-4069) 답습. lens 의 outer boundary 는
    // 모두 split-induced edges (a_only / b_only 와 공유, 외부 boundary 아님)
    // — render path `export_edge_lines_with_map` 의 coplanar Plane edge hide
    // (LOCKED #16 K-ε hotfix) 우회 → wireframe 에 lens 분할 라인 emit.
    {
        let lens_outer_start = mesh.faces[lens].outer().start;
        let mut he_id = lens_outer_start;
        loop {
            // Walk radial chain — mark all twin HEs HARD for both face sides.
            // Pattern: mesh.rs:5364-5378 (radial chain enumeration).
            let mut rad_id = he_id;
            loop {
                let cur = mesh.hes[rad_id].flags();
                mesh.hes[rad_id].set_flags(cur | HeFlags::HARD);
                rad_id = mesh.hes[rad_id].next_rad();
                if rad_id == he_id { break; }
            }
            he_id = mesh.hes[he_id].next();
            if he_id == lens_outer_start { break; }
        }
    }

    Ok(Some(AutoIntersectResult {
        face_a_only,
        face_b_only,
        lens,
    }))
}

// ─── B-4b: Non-destructive pre-check helpers ─────────────────────────

/// Axis-aligned bounding box in 3D world space.
#[derive(Debug, Clone, Copy)]
pub struct Aabb3 {
    pub min: DVec3,
    pub max: DVec3,
}

impl Aabb3 {
    fn from_points<'a>(points: impl IntoIterator<Item = &'a DVec3>) -> Option<Self> {
        let mut iter = points.into_iter();
        let first = iter.next()?;
        let mut min = *first;
        let mut max = *first;
        for p in iter {
            min.x = min.x.min(p.x);
            min.y = min.y.min(p.y);
            min.z = min.z.min(p.z);
            max.x = max.x.max(p.x);
            max.y = max.y.max(p.y);
            max.z = max.z.max(p.z);
        }
        Some(Aabb3 { min, max })
    }
}

/// True if two AABBs overlap (touching counts as overlap within `eps`).
fn aabb_overlaps(a: &Aabb3, b: &Aabb3, eps: f64) -> bool {
    a.min.x <= b.max.x + eps && a.max.x >= b.min.x - eps
        && a.min.y <= b.max.y + eps && a.max.y >= b.min.y - eps
        && a.min.z <= b.max.z + eps && a.max.z >= b.min.z - eps
}

/// ADR-101 §B-4b — Non-destructive AABB extraction.
///
/// Returns the world-space AABB of a face WITHOUT polygonizing Path B
/// closed-curve faces. For:
///   - Polygonal face: AABB of boundary vertex positions.
///   - Path B Circle: cardinal samples in the curve's plane (4 points).
///   - Path B Bezier / BSpline / NURBS loop: control-points AABB
///     (conservative; control polygon bounds the curve).
///   - Path B Arc: best-effort cardinal sample (full circle AABB if range
///     ≥ 2π, else 8-sample chord polyline).
///   - Other / degenerate: `None`.
pub fn face_world_aabb(mesh: &Mesh, face_id: FaceId) -> Option<Aabb3> {
    let face = mesh.faces.get(face_id)?;
    if !face.is_active() { return None; }
    let outer_start = face.outer().start;
    if outer_start.is_null() { return None; }
    let verts = mesh.collect_loop_verts(outer_start).ok()?;

    if verts.len() == 1 {
        // Path B closed-curve face — peek at the self-loop edge's curve.
        let edge_id = mesh.hes[outer_start].edge();
        let edge = mesh.edges.get(edge_id)?;
        let curve = edge.curve()?;
        match curve {
            crate::curves::AnalyticCurve::Circle { center, radius, normal, basis_u } => {
                let basis_v = normal.cross(*basis_u).normalize_or_zero();
                let r = *radius;
                let pts = [
                    *center + *basis_u * r,
                    *center - *basis_u * r,
                    *center + basis_v * r,
                    *center - basis_v * r,
                ];
                Aabb3::from_points(pts.iter())
            }
            crate::curves::AnalyticCurve::Arc {
                center, radius, normal, basis_u, start_angle, end_angle,
            } => {
                // Best-effort: 8 chord samples between start and end.
                let basis_v = normal.cross(*basis_u).normalize_or_zero();
                let mut pts = Vec::with_capacity(9);
                for i in 0..=8 {
                    let t = i as f64 / 8.0;
                    let theta = start_angle + (end_angle - start_angle) * t;
                    pts.push(
                        *center + *basis_u * (radius * theta.cos())
                                + basis_v * (radius * theta.sin())
                    );
                }
                Aabb3::from_points(pts.iter())
            }
            crate::curves::AnalyticCurve::Bezier { control_pts }
            | crate::curves::AnalyticCurve::BSpline { control_pts, .. }
            | crate::curves::AnalyticCurve::NURBS { control_pts, .. } => {
                Aabb3::from_points(control_pts.iter())
            }
            _ => None,
        }
    } else {
        // Polygonal face: AABB from boundary vertex positions.
        let positions: Vec<DVec3> = verts
            .iter()
            .map(|&v| mesh.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO))
            .collect();
        Aabb3::from_points(positions.iter())
    }
}

/// ADR-101 §B-4b — Non-destructive face normal.
///
/// For polygonal face: Newell's method on boundary verts.
/// For Path B closed-curve face: `AnalyticCurve::Circle.normal` (or
///   `Arc.normal`) directly. Falls back to `Face.surface` Plane normal
///   if the curve doesn't carry a normal.
pub fn face_world_normal(mesh: &Mesh, face_id: FaceId) -> Option<DVec3> {
    let face = mesh.faces.get(face_id)?;
    if !face.is_active() { return None; }
    let outer_start = face.outer().start;
    if outer_start.is_null() { return None; }
    let verts = mesh.collect_loop_verts(outer_start).ok()?;

    if verts.len() == 1 {
        // Path B: read normal from AnalyticCurve metadata.
        let edge_id = mesh.hes[outer_start].edge();
        let edge = mesh.edges.get(edge_id)?;
        if let Some(curve) = edge.curve() {
            match curve {
                crate::curves::AnalyticCurve::Circle { normal, .. }
                | crate::curves::AnalyticCurve::Arc { normal, .. } => {
                    return Some(*normal);
                }
                _ => {}
            }
        }
        // Bezier/BSpline/NURBS loops — derive normal from control points
        // (best-fit plane). Try the existing helper.
        if let Some(curve) = edge.curve() {
            let cp_opt = match curve {
                crate::curves::AnalyticCurve::Bezier { control_pts } => Some(control_pts),
                crate::curves::AnalyticCurve::BSpline { control_pts, .. } => Some(control_pts),
                crate::curves::AnalyticCurve::NURBS { control_pts, .. } => Some(control_pts),
                _ => None,
            };
            if let Some(cp) = cp_opt {
                if cp.len() >= 3 {
                    // Newell on control polygon — gives best-fit plane normal.
                    let mut n = DVec3::ZERO;
                    for i in 0..cp.len() {
                        n += cp[i].cross(cp[(i + 1) % cp.len()]);
                    }
                    let len = n.length();
                    if len > 1e-10 { return Some(n / len); }
                }
            }
        }
        // Fallback: Face.surface Plane normal.
        face.surface().and_then(|s| match s {
            crate::surfaces::AnalyticSurface::Plane { normal, .. } => Some(*normal),
            _ => None,
        })
    } else {
        // Polygonal: Newell.
        let positions: Vec<DVec3> = verts
            .iter()
            .map(|&v| mesh.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO))
            .collect();
        crate::operations::polygon_geom::face_unit_normal(&positions)
    }
}

/// ADR-101 §B-4b — Non-destructive anchor position for plane-offset check.
/// Returns the first boundary vertex's world position.
pub fn face_anchor_position(mesh: &Mesh, face_id: FaceId) -> Option<DVec3> {
    let face = mesh.faces.get(face_id)?;
    if !face.is_active() { return None; }
    let outer_start = face.outer().start;
    if outer_start.is_null() { return None; }
    let verts = mesh.collect_loop_verts(outer_start).ok()?;
    let first = *verts.first()?;
    mesh.verts.get(first).map(|v| v.pos())
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

// ─── B-3a: polygon_difference_walking (pure 2D utility) ──────────────

/// ADR-101 §B-3a pure 2D utility — boundary walking for `base \ lens`.
///
/// Computes a single closed CCW polygon representing the difference
/// `base_polygon \ lens_polygon` for the convex × convex partial-overlap
/// case (exactly 2 boundary crossings).
///
/// The result is **may be non-convex** (typical case: crescent for two
/// overlapping circles, L-shape for two overlapping squares). DCEL allows
/// non-convex faces per ADR-021 P7 (closed boundary = face).
///
/// # Inputs
///
/// - `base_polygon` — CCW 2D vertex list of the polygon being cut.
/// - `lens_polygon` — CCW 2D vertex list of the A ∩ B intersection.
/// - `crossings` — boundary crossings between base and lens, as
///   `(base_edge_index, t_on_base_edge, crossing_point_2d)`. Must contain
///   exactly 2 entries.
///
/// # Errors
///
/// - `polygon_difference_walking: requires exactly 2 crossings, got N`
/// - `polygon_difference_walking: lens has fewer than 3 vertices`
/// - `polygon_difference_walking: base polygon has fewer than 3 vertices`
/// - `polygon_difference_walking: lens does not start/end at the supplied crossings`
///
/// # Algorithm
///
/// 1. Insert the 2 crossings into `base_polygon`'s vertex list at the
///    correct (edge_index, t) positions → `base_with_crossings`.
/// 2. Classify each base vertex as inside / outside lens (crossings are
///    on boundary — treat as "switch point").
/// 3. Walk `base_with_crossings` in CCW order. Collect vertices that lie
///    outside the lens (including the 2 crossings as switch points).
/// 4. When we hit the first crossing while building the outside arc,
///    splice in the **reverse** of the lens boundary between the 2
///    crossings (i.e., the lens vertices that are NOT crossings, which
///    by construction lie inside `base_polygon`).
/// 5. Return the concatenated polygon.
///
/// # Lock-ins (ADR-101 §B-3a)
///
/// - L-B3a-1 Pure 2D — no DCEL, no FaceId
/// - L-B3a-2 Convex × convex 2-crossing only — other cases → Err
/// - L-B3a-3 Result may be non-convex (acceptable per ADR-021 P7)
/// - L-B3a-4 CCW orientation preserved
/// - L-B3a-5 Walking algorithm — base outside arc + reverse lens inside arc
/// - L-B3a-6 Deterministic + idempotent
pub fn polygon_difference_walking(
    base_polygon: &[(f64, f64)],
    lens_polygon: &[(f64, f64)],
    crossings: &[(usize, f64, (f64, f64))],
) -> Result<Vec<(f64, f64)>> {
    if crossings.len() != 2 {
        bail!(
            "polygon_difference_walking: requires exactly 2 crossings, got {}",
            crossings.len()
        );
    }
    if base_polygon.len() < 3 {
        bail!("polygon_difference_walking: base polygon has fewer than 3 vertices");
    }
    if lens_polygon.len() < 3 {
        bail!("polygon_difference_walking: lens has fewer than 3 vertices");
    }

    // ── Step 1: build `base_with_crossings` and remember crossing positions ──
    let n_base = base_polygon.len();
    let mut on_edge: Vec<Vec<(f64, (f64, f64))>> = vec![Vec::new(); n_base];
    for &(edge_idx, t, pt) in crossings {
        if edge_idx >= n_base {
            bail!(
                "polygon_difference_walking: crossing edge_index {} out of range (n_base={})",
                edge_idx, n_base
            );
        }
        on_edge[edge_idx].push((t, pt));
    }
    for edge_pts in on_edge.iter_mut() {
        edge_pts.sort_by(|(ta, _), (tb, _)| ta.partial_cmp(tb).unwrap_or(std::cmp::Ordering::Equal));
    }

    // base_with_crossings: Vec<(point, is_crossing)>
    let mut base_with_crossings: Vec<((f64, f64), bool)> =
        Vec::with_capacity(n_base + 2);
    for i in 0..n_base {
        base_with_crossings.push((base_polygon[i], false));
        for &(_, pt) in &on_edge[i] {
            base_with_crossings.push((pt, true));
        }
    }

    // Locate the 2 crossing indices in `base_with_crossings`.
    let crossing_positions: Vec<usize> = base_with_crossings
        .iter()
        .enumerate()
        .filter_map(|(i, &(_, is_xing))| if is_xing { Some(i) } else { None })
        .collect();
    if crossing_positions.len() != 2 {
        bail!(
            "polygon_difference_walking: internal error — expected 2 crossings in walk, got {}",
            crossing_positions.len()
        );
    }
    let _cross_pos_1 = crossing_positions[0];
    let _cross_pos_2 = crossing_positions[1];

    // ── Step 2: classify base vertices as inside/outside lens. Crossings
    //   are treated as on-boundary (switch points).
    let is_inside_lens = |pt: (f64, f64)| -> bool {
        point_in_polygon_2d_strict(pt, lens_polygon)
    };

    // Find a starting index that is *clearly* OUTSIDE the lens — i.e.,
    // not a crossing, not strictly inside lens, AND not coincident with
    // any lens boundary vertex (within match_eps).
    //
    // Without the lens-vertex exclusion, when the base polygon's vertices
    // include arc points that lie ON the lens boundary (e.g., circle ∩
    // circle case where polygonized arc verts coincide with lens-side-arc
    // verts), the start algorithm picks a base vert that sits ON lens.
    // The walk then mis-classifies it as "outside" and traces back across
    // the lens-side arc, producing a degenerate polygon with ~0 area.
    //
    // This bug was masked in the RECT × RECT case because lens corners
    // (5,5), (10,10) appear on A's/B's boundary BETWEEN the 2 crossings —
    // so the state-tracking flag (`inside_lens=true`) correctly skips
    // them. For Circle × Circle, the on-lens base verts span a much
    // larger arc, and the start algorithm picks one of them by accident.
    const LENS_VERT_MATCH_EPS: f64 = 1e-6;
    let on_lens_vertex = |pt: (f64, f64)| -> bool {
        lens_polygon.iter().any(|q| {
            (q.0 - pt.0).abs() < LENS_VERT_MATCH_EPS
                && (q.1 - pt.1).abs() < LENS_VERT_MATCH_EPS
        })
    };
    let n_bwx = base_with_crossings.len();
    let start_idx = (0..n_bwx)
        .find(|&i| {
            let (pt, is_xing) = base_with_crossings[i];
            !is_xing && !is_inside_lens(pt) && !on_lens_vertex(pt)
        })
        .ok_or_else(|| anyhow::anyhow!(
            "polygon_difference_walking: no base vertex strictly outside lens — \
             input may be containment rather than partial overlap"
        ))?;

    // ── Step 3: walk base CCW from `start_idx`, building the outside arc.
    //   When we hit a crossing, we transition: outside → inside (skip
    //   base verts) until next crossing, then back to outside.
    //
    //   We also need to splice the lens "inside-base" arc into the
    //   result, going from the second crossing back to the first
    //   (i.e., REVERSE lens direction).
    let mut result: Vec<(f64, f64)> = Vec::new();
    let mut inside_lens = false;
    let mut crossing_seen: Option<(f64, f64)> = None;  // last crossing point

    for k in 0..n_bwx {
        let idx = (start_idx + k) % n_bwx;
        let (pt, is_xing) = base_with_crossings[idx];

        if is_xing {
            if !inside_lens {
                // OUTSIDE → INSIDE. Push entry crossing; remember it.
                result.push(pt);
                crossing_seen = Some(pt);
                inside_lens = true;
            } else {
                // INSIDE → OUTSIDE. We've reached the exit crossing.
                // Splice the lens "interior" arc (the part inside `base`)
                // BEFORE pushing the exit crossing, so the polygon walks
                // in correct CCW order:
                //   ... entry_xing → (interior lens verts) → exit_xing → ...
                let first_xing = crossing_seen
                    .ok_or_else(|| anyhow::anyhow!(
                        "polygon_difference_walking: internal — second crossing without first"
                    ))?;
                splice_interior_lens_arc(
                    lens_polygon,
                    first_xing,
                    pt,
                    &mut result,
                )?;
                result.push(pt);
                inside_lens = false;
                crossing_seen = None;
            }
        } else if !inside_lens {
            result.push(pt);
        }
        // else: inside_lens && !is_xing → skip (this base vert is inside lens)
    }

    if result.len() < 3 {
        bail!(
            "polygon_difference_walking: result polygon has fewer than 3 vertices ({})",
            result.len()
        );
    }

    // Final dedup pass (numerical noise).
    let mut dedup: Vec<(f64, f64)> = Vec::with_capacity(result.len());
    for p in &result {
        if let Some(last) = dedup.last() {
            let dx = p.0 - last.0;
            let dy = p.1 - last.1;
            if dx.abs() < DEDUP_EPS_2D && dy.abs() < DEDUP_EPS_2D { continue; }
        }
        dedup.push(*p);
    }
    if dedup.len() >= 2 {
        let first = dedup[0];
        let last = *dedup.last().unwrap();
        if (first.0 - last.0).abs() < DEDUP_EPS_2D
            && (first.1 - last.1).abs() < DEDUP_EPS_2D
        {
            dedup.pop();
        }
    }
    if dedup.len() < 3 {
        bail!(
            "polygon_difference_walking: dedup'd result has fewer than 3 vertices"
        );
    }

    Ok(dedup)
}

/// Find the two indices of `lens_polygon` matching `from` (entry crossing)
/// and `to` (exit crossing) within `match_eps`, then append the *interior*
/// lens vertices walked from `from` BACKWARDS to `to` (exclusive of both
/// endpoints).
///
/// The "interior" arc is the half of the lens boundary that lies INSIDE
/// the `base_polygon` — i.e., the half that does NOT coincide with the
/// base's boundary between the two crossings.
///
/// For CCW lens with CCW base and entry < exit (in lens index order along
/// the "base-side" of lens), the interior arc is the OTHER half: walk
/// from `i_from` backwards (decrementing) until reaching `i_to`.
fn splice_interior_lens_arc(
    lens_polygon: &[(f64, f64)],
    from: (f64, f64),
    to: (f64, f64),
    out: &mut Vec<(f64, f64)>,
) -> Result<()> {
    let n = lens_polygon.len();
    let match_eps = 1e-6_f64;
    let find_idx = |pt: (f64, f64)| -> Option<usize> {
        lens_polygon.iter().position(|q| {
            (q.0 - pt.0).abs() < match_eps && (q.1 - pt.1).abs() < match_eps
        })
    };
    let i_from = find_idx(from).ok_or_else(|| anyhow::anyhow!(
        "polygon_difference_walking: crossing point {:?} not found in lens",
        from
    ))?;
    let i_to = find_idx(to).ok_or_else(|| anyhow::anyhow!(
        "polygon_difference_walking: crossing point {:?} not found in lens",
        to
    ))?;
    // Walk lens from i_from BACKWARDS to i_to, exclusive of both endpoints.
    // This traverses the "interior" half of lens — the part inside base.
    let mut i = (i_from + n - 1) % n;
    while i != i_to {
        out.push(lens_polygon[i]);
        i = (i + n - 1) % n;
    }
    Ok(())
}

/// Strict 2D point-in-polygon test using winding-number method.
/// Returns true if `pt` is strictly inside `polygon` (boundary excluded).
fn point_in_polygon_2d_strict(pt: (f64, f64), polygon: &[(f64, f64)]) -> bool {
    let n = polygon.len();
    if n < 3 { return false; }
    let mut sum = 0.0_f64;
    for i in 0..n {
        let (ax, ay) = polygon[i];
        let (bx, by) = polygon[(i + 1) % n];
        let ux = ax - pt.0; let uy = ay - pt.1;
        let vx = bx - pt.0; let vy = by - pt.1;
        let ulen = (ux * ux + uy * uy).sqrt();
        let vlen = (vx * vx + vy * vy).sqrt();
        if ulen < 1e-9 || vlen < 1e-9 { return false; } // pt on a vertex → boundary
        let cross = ux * vy - uy * vx;
        let dot = ux * vx + uy * vy;
        let ang = cross.atan2(dot);
        sum += ang;
    }
    (sum.abs() - std::f64::consts::TAU).abs() < 1e-3
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

    // ── B-3a tests: polygon_difference_walking ────────────────────────

    /// Returns CCW signed area; negative means CW.
    fn signed_area_2d(poly: &[(f64, f64)]) -> f64 {
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

    /// Two squares partial overlap → A \ lens is an L-shape (non-convex).
    ///
    /// A = [(0,0), (10,0), (10,10), (0,10)]  (CCW)
    /// B = [(5,5), (15,5), (15,15), (5,15)]  (CCW)
    /// Lens = [(10,5), (10,10), (5,10), (5,5)]  (CCW)
    /// Crossings on A:
    ///   - (10, 5) on A's edge 1 (right) at t=0.5
    ///   - (5, 10) on A's edge 2 (top) at t=0.5
    /// A \ lens = L-shape with 6 vertices:
    ///   [(0,0), (10,0), (10,5), (5,5), (5,10), (0,10)]
    #[test]
    fn adr101_phase_b3a_partial_overlap_two_rects_returns_l_shape() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(10.0, 5.0), (10.0, 10.0), (5.0, 10.0), (5.0, 5.0)];
        let crossings = vec![
            (1usize, 0.5, (10.0, 5.0)),
            (2usize, 0.5, (5.0, 10.0)),
        ];
        let result = polygon_difference_walking(&a, &lens, &crossings)
            .expect("OK");
        assert_eq!(result.len(), 6,
            "L-shape should have 6 vertices, got {}: {:?}",
            result.len(), result);
        // All 6 expected points present (in some rotation).
        let expected = [
            (0.0, 0.0), (10.0, 0.0), (10.0, 5.0),
            (5.0, 5.0), (5.0, 10.0), (0.0, 10.0),
        ];
        for ep in &expected {
            assert!(result.iter().any(|p| (p.0 - ep.0).abs() < 1e-6 && (p.1 - ep.1).abs() < 1e-6),
                "expected vertex {:?} missing from result {:?}", ep, result);
        }
    }

    /// Result polygon must have CCW orientation (positive signed area).
    /// ADR-101 §B-3a L-B3a-4.
    #[test]
    fn adr101_phase_b3a_ccw_orientation_preserved() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(10.0, 5.0), (10.0, 10.0), (5.0, 10.0), (5.0, 5.0)];
        let crossings = vec![
            (1usize, 0.5, (10.0, 5.0)),
            (2usize, 0.5, (5.0, 10.0)),
        ];
        let result = polygon_difference_walking(&a, &lens, &crossings).expect("OK");
        let area = signed_area_2d(&result);
        assert!(area > 0.0, "result must be CCW (positive area), got {}", area);
        // Expected area: A=100, lens=25, A\lens=75
        assert!((area - 75.0).abs() < 1e-6,
            "L-shape area should be 75.0, got {}", area);
    }

    /// Wrong number of crossings → explicit error (silent skip 차단,
    /// ADR-101 §B-3a L-B3a-2).
    #[test]
    fn adr101_phase_b3a_zero_crossings_errors() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(2.0, 2.0), (3.0, 2.0), (3.0, 3.0), (2.0, 3.0)];
        let crossings: Vec<(usize, f64, (f64, f64))> = vec![];
        let err = polygon_difference_walking(&a, &lens, &crossings)
            .expect_err("0 crossings should error");
        assert!(format!("{}", err).contains("exactly 2 crossings"));
    }

    #[test]
    fn adr101_phase_b3a_four_crossings_errors() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(5.0, 5.0), (6.0, 5.0), (6.0, 6.0), (5.0, 6.0)];
        // Fake 4 crossings — non-convex / multi-crossing case unsupported.
        let crossings = vec![
            (0usize, 0.3, (3.0, 0.0)),
            (1usize, 0.3, (10.0, 3.0)),
            (2usize, 0.3, (7.0, 10.0)),
            (3usize, 0.3, (0.0, 7.0)),
        ];
        let err = polygon_difference_walking(&a, &lens, &crossings)
            .expect_err("4 crossings should error");
        assert!(format!("{}", err).contains("exactly 2 crossings"));
    }

    /// Idempotent: same input → byte-identical output.
    /// ADR-101 §B-3a L-B3a-6.
    #[test]
    fn adr101_phase_b3a_idempotent_same_input_same_output() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(10.0, 5.0), (10.0, 10.0), (5.0, 10.0), (5.0, 5.0)];
        let crossings = vec![
            (1usize, 0.5, (10.0, 5.0)),
            (2usize, 0.5, (5.0, 10.0)),
        ];
        let r1 = polygon_difference_walking(&a, &lens, &crossings).expect("OK");
        let r2 = polygon_difference_walking(&a, &lens, &crossings).expect("OK");
        let r3 = polygon_difference_walking(&a, &lens, &crossings).expect("OK");
        assert_eq!(r1, r2);
        assert_eq!(r2, r3);
    }

    /// Crescent-shaped result: A is a wide rect, lens is a smaller rect
    /// poking in from one side, A \ lens is a U-shape (non-convex).
    ///
    /// A = [(0,0), (10,0), (10,10), (0,10)]  (CCW)
    /// B (lens donor) = [(3,7), (7,7), (7,15), (3,15)]
    /// Lens = [(7,7), (3,7), (3,10), (7,10)]  but reordered CCW =
    ///   [(3,7), (7,7), (7,10), (3,10)]
    /// Crossings on A:
    ///   - (3,10) on A's edge 2 (top) at t = (10-3)/10 = 0.7
    ///   - (7,10) on A's edge 2 (top) at t = (10-7)/10 = 0.3
    /// A \ lens = U-shape with 8 vertices:
    ///   [(0,0), (10,0), (10,10), (7,10), (7,7), (3,7), (3,10), (0,10)]
    #[test]
    fn adr101_phase_b3a_u_shape_two_crossings_on_same_edge() {
        let a = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let lens = vec![(3.0, 7.0), (7.0, 7.0), (7.0, 10.0), (3.0, 10.0)];
        let crossings = vec![
            (2usize, 0.3, (7.0, 10.0)),  // A's edge 2 goes (10,10)→(0,10), t=0.3 → (7,10)
            (2usize, 0.7, (3.0, 10.0)),  // t=0.7 → (3,10)
        ];
        let result = polygon_difference_walking(&a, &lens, &crossings)
            .expect("OK");
        // U-shape should have 8 vertices.
        assert_eq!(result.len(), 8,
            "U-shape should have 8 vertices, got {}: {:?}",
            result.len(), result);
        // Area: A=100, lens=12, A\lens=88
        let area = signed_area_2d(&result);
        assert!((area - 88.0).abs() < 1e-6,
            "U-shape area should be 88.0, got {}", area);
    }

    /// Degenerate input: base polygon < 3 verts.
    #[test]
    fn adr101_phase_b3a_degenerate_base_errors() {
        let a = vec![(0.0, 0.0), (10.0, 0.0)];
        let lens = vec![(1.0, 1.0), (2.0, 1.0), (2.0, 2.0), (1.0, 2.0)];
        let crossings = vec![
            (0usize, 0.3, (3.0, 0.0)),
            (0usize, 0.7, (7.0, 0.0)),
        ];
        let err = polygon_difference_walking(&a, &lens, &crossings)
            .expect_err("base < 3 verts should error");
        assert!(format!("{}", err).contains("base polygon"));
    }

    // ── B-3b tests: auto_intersect_coplanar ──────────────────────────

    /// Happy path: two coplanar RECTs with partial overlap → 3 sub-faces.
    ///
    /// A = [0,0]–[10,10], B = [5,5]–[15,15]. Lens = [5,5]–[10,10].
    /// Expected: 3 new faces (face_a_only L-shape, face_b_only L-shape,
    /// lens square).
    #[test]
    fn adr101_phase_b3b_two_rects_partial_overlap_creates_3_faces() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let active_before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_before, 2);

        let result = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK")
            .expect("partial overlap should produce result");

        // 3 new faces are active; originals are inactive.
        let active_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_after, 3,
            "exactly 3 active faces after split, got {}", active_after);
        assert!(mesh.faces.get(a).map(|f| !f.is_active()).unwrap_or(true),
            "original face_a should be inactive");
        assert!(mesh.faces.get(b).map(|f| !f.is_active()).unwrap_or(true),
            "original face_b should be inactive");

        // Each new FaceId must be distinct.
        assert_ne!(result.face_a_only, result.face_b_only);
        assert_ne!(result.face_a_only, result.lens);
        assert_ne!(result.face_b_only, result.lens);

        // Lens face has 4 vertices (the [5,5]-[10,10] square).
        let lens_boundary = collect_face_boundary(&mesh, result.lens).unwrap();
        assert_eq!(lens_boundary.len(), 4,
            "lens should be a quad, got {} verts", lens_boundary.len());

        // A_only and B_only are L-shapes (6 verts each).
        let a_only_boundary = collect_face_boundary(&mesh, result.face_a_only).unwrap();
        let b_only_boundary = collect_face_boundary(&mesh, result.face_b_only).unwrap();
        assert_eq!(a_only_boundary.len(), 6, "face_a_only should be L-shape (6 verts)");
        assert_eq!(b_only_boundary.len(), 6, "face_b_only should be L-shape (6 verts)");
    }

    /// Disjoint faces → Ok(None), no mutation.
    #[test]
    fn adr101_phase_b3b_disjoint_no_op() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(1.0, 0.0), xy(1.0, 1.0), xy(0.0, 1.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(6.0, 5.0), xy(6.0, 6.0), xy(5.0, 6.0),
        ]);
        let active_before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let result = auto_intersect_coplanar(&mut mesh, a, b, mat).expect("OK");
        assert!(result.is_none(), "disjoint → None");
        let active_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_before, active_after, "no mutation on disjoint");
        assert!(mesh.faces.get(a).map(|f| f.is_active()).unwrap_or(false));
        assert!(mesh.faces.get(b).map(|f| f.is_active()).unwrap_or(false));
    }

    /// Containment (A ⊂ B) → Ok(None) (0 boundary crossings).
    #[test]
    fn adr101_phase_b3b_containment_no_op() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let inner = add_quad(&mut mesh, [
            xy(2.0, 2.0), xy(3.0, 2.0), xy(3.0, 3.0), xy(2.0, 3.0),
        ]);
        let outer = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let result = auto_intersect_coplanar(&mut mesh, inner, outer, mat).expect("OK");
        assert!(result.is_none(), "containment → None (no boundary crossings)");
        assert!(mesh.faces.get(inner).map(|f| f.is_active()).unwrap_or(false));
        assert!(mesh.faces.get(outer).map(|f| f.is_active()).unwrap_or(false));
    }

    /// Surface inheritance: all 3 new sub-faces inherit parent's surface
    /// (L-B3b-3, LOCKED #9 A-χ pattern).
    #[test]
    fn adr101_phase_b3b_surface_inheritance() {
        use crate::surfaces::{AnalyticSurface};
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        // Attach Plane surface to face_a (parent of inheritance).
        let plane = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            basis_u: DVec3::new(1.0, 0.0, 0.0),
            u_range: (-100.0, 100.0),
            v_range: (-100.0, 100.0),
        };
        mesh.faces.get_mut(a).unwrap().set_surface(Some(plane.clone()));

        let result = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK").expect("partial overlap");

        // All 3 sub-faces must have a Plane surface attached.
        for fid in [result.face_a_only, result.face_b_only, result.lens] {
            let surf = mesh.faces.get(fid).and_then(|f| f.surface().cloned());
            match surf {
                Some(AnalyticSurface::Plane { .. }) => {},
                other => panic!("face {:?} expected Plane surface, got {:?}", fid, other),
            }
        }
    }

    /// Manifold invariant: post-split mesh must pass verify_face_invariants
    /// (L-B3b-6).
    #[test]
    fn adr101_phase_b3b_verify_face_invariants_post_split() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK").expect("partial overlap");

        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-split mesh must satisfy face invariants — got {:?}",
            report.violations);
    }

    /// Inactive face input → error (silent skip 차단).
    #[test]
    fn adr101_phase_b3b_inactive_input_errors() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        mesh.remove_face(b).expect("deactivate b");
        let err = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect_err("inactive face should error");
        let msg = format!("{}", err);
        assert!(msg.contains("inactive") || msg.contains("not found"),
            "got error: {}", msg);
    }

    // ── B-3c tests: Path B Circle × Circle + cleanup helper ──────────

    /// B-3c: Path B Circle × Circle partial overlap → 3 sub-faces,
    /// manifold-safe. Was deferred from B-3b due to orphan-edge issue.
    #[test]
    fn adr101_phase_b3c_path_b_circles_polygonize_and_split() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);

        let center_a = DVec3::ZERO;
        let center_b = DVec3::new(6.0, 0.0, 0.0);
        let radius = 5.0;
        let normal = DVec3::new(0.0, 0.0, 1.0);
        let basis_u = DVec3::new(1.0, 0.0, 0.0);

        let circle_a_curve = AnalyticCurve::Circle {
            center: center_a, radius, normal, basis_u,
        };
        let circle_b_curve = AnalyticCurve::Circle {
            center: center_b, radius, normal, basis_u,
        };
        let v_a = mesh.add_vertex(center_a + basis_u * radius);
        let v_b = mesh.add_vertex(center_b + basis_u * radius);
        let face_a = mesh.add_face_closed_curve(v_a, circle_a_curve, mat)
            .expect("add Path B circle A");
        let face_b = mesh.add_face_closed_curve(v_b, circle_b_curve, mat)
            .expect("add Path B circle B");

        let result = auto_intersect_coplanar(&mut mesh, face_a, face_b, mat)
            .expect("OK")
            .expect("two overlapping circles must produce result");

        // 3 active faces after split.
        let active_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_after, 3,
            "two circles partial overlap → 3 sub-faces, got {} active",
            active_after);

        // Lens has ≥ 4 verts (mix of arc verts + 2 crossings).
        let lens_boundary = collect_face_boundary(&mesh, result.lens).unwrap();
        assert!(lens_boundary.len() >= 4,
            "circle lens should have ≥4 boundary verts, got {}",
            lens_boundary.len());

        // Manifold invariants preserved (the B-3c primary success criterion).
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-split circle-circle mesh must satisfy invariants — got {:?}",
            report.violations);
    }

    /// B-3c: cleanup_orphan_boundary_edges removes orphan edges + deactivates
    /// isolated verts. Direct unit test of the helper.
    #[test]
    fn adr101_phase_b3c_cleanup_orphan_boundary_edges_unit() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(xy(0.0, 0.0));
        let v1 = mesh.add_vertex(xy(1.0, 0.0));
        let v2 = mesh.add_vertex(xy(1.0, 1.0));
        let v3 = mesh.add_vertex(xy(0.0, 1.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        // Before remove_face: 4 edges all have face-bearing HEs.
        let edges_before = mesh.edges.iter()
            .filter(|(eid, _)| {
                let any = mesh.edges[*eid].any_he();
                !any.is_null() && mesh.hes.contains(any)
            })
            .count();
        assert_eq!(edges_before, 4);

        // Remove face, then cleanup.
        mesh.remove_face(face).expect("remove");
        let removed = mesh.cleanup_orphan_boundary_edges(&[&[v0, v1, v2, v3]]);
        assert_eq!(removed, 4, "all 4 orphan edges should be cleaned, got {}", removed);

        // After cleanup, all 4 verts are isolated → deactivated.
        for v in [v0, v1, v2, v3] {
            assert!(!mesh.verts[v].is_active(),
                "isolated vert {:?} should be deactivated", v);
        }
    }

    /// B-3c: cleanup is idempotent — second call with same args returns 0
    /// (L-B3c-3).
    #[test]
    fn adr101_phase_b3c_cleanup_is_idempotent() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(xy(0.0, 0.0));
        let v1 = mesh.add_vertex(xy(1.0, 0.0));
        let v2 = mesh.add_vertex(xy(1.0, 1.0));
        let v3 = mesh.add_vertex(xy(0.0, 1.0));
        let face = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        mesh.remove_face(face).expect("remove");

        let first = mesh.cleanup_orphan_boundary_edges(&[&[v0, v1, v2, v3]]);
        let second = mesh.cleanup_orphan_boundary_edges(&[&[v0, v1, v2, v3]]);
        assert!(first > 0, "first cleanup should remove something");
        assert_eq!(second, 0, "second cleanup should find nothing");
    }

    /// B-3c: cleanup must NOT touch edges that still have an active
    /// face-bearing HE (scope L-B3c-2: all-free predicate).
    #[test]
    fn adr101_phase_b3c_cleanup_preserves_shared_edges() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(xy(0.0, 0.0));
        let v1 = mesh.add_vertex(xy(2.0, 0.0));
        let v2 = mesh.add_vertex(xy(2.0, 2.0));
        let v3 = mesh.add_vertex(xy(0.0, 2.0));
        let v4 = mesh.add_vertex(xy(4.0, 0.0));
        let v5 = mesh.add_vertex(xy(4.0, 2.0));
        // face_a uses edges v0-v1, v1-v2, v2-v3, v3-v0.
        let face_a = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        // face_b shares edge v1-v2 with face_a (adjacent).
        let face_b = mesh.add_face(&[v1, v4, v5, v2], mat).unwrap();

        // Remove only face_a. Edge v1-v2 still belongs to face_b → not orphan.
        mesh.remove_face(face_a).expect("remove face_a");
        let removed = mesh.cleanup_orphan_boundary_edges(&[&[v0, v1, v2, v3]]);
        // Edges v0-v1, v2-v3, v3-v0 are orphan (3 edges). Edge v1-v2 has
        // face_b's HE still active.
        assert_eq!(removed, 3, "3 orphan edges expected, got {}", removed);
        assert!(mesh.find_edge(v1, v2).is_some(),
            "shared edge v1-v2 must be preserved (face_b still uses it)");
        let _ = face_b;
    }

    /// Second call after split: face_a_only / face_b_only are non-convex
    /// L-shapes from the previous split. Per ADR-101 §B-1 L-B1-1/L-B1-2
    /// (convex-only enforcement), the second call must error (silent
    /// skip 차단).
    #[test]
    fn adr101_phase_b3b_second_call_rejects_non_convex_results() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let r1 = auto_intersect_coplanar(&mut mesh, a, b, mat).unwrap().unwrap();
        // Second call: face_a_only is an L-shape (non-convex). Convex-only
        // enforcement (L-B1-1/2) must reject explicitly.
        let err = auto_intersect_coplanar(&mut mesh, r1.face_a_only, r1.face_b_only, mat)
            .expect_err("non-convex L-shape must be rejected");
        let msg = format!("{}", err);
        assert!(msg.contains("non-convex"),
            "expected non-convex error, got: {}", msg);
    }

    // ── B-4b tests: non-destructive pre-check + Path B activation ────

    /// AABB extraction works for polygonal face.
    #[test]
    fn adr101_phase_b4b_face_world_aabb_polygonal() {
        let mut mesh = Mesh::new();
        let f = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 5.0), xy(0.0, 5.0),
        ]);
        let aabb = face_world_aabb(&mesh, f).expect("polygonal AABB");
        assert!((aabb.min.x - 0.0).abs() < 1e-9);
        assert!((aabb.min.y - 0.0).abs() < 1e-9);
        assert!((aabb.max.x - 10.0).abs() < 1e-9);
        assert!((aabb.max.y - 5.0).abs() < 1e-9);
    }

    /// AABB extraction works for Path B Circle WITHOUT polygonization.
    /// Critical: the face must remain Path B (1 boundary vert) after the
    /// call — proves the pre-check is non-destructive.
    #[test]
    fn adr101_phase_b4b_face_world_aabb_path_b_circle_non_destructive() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let center = DVec3::ZERO;
        let radius = 5.0;
        let normal = DVec3::new(0.0, 0.0, 1.0);
        let basis_u = DVec3::new(1.0, 0.0, 0.0);
        let v = mesh.add_vertex(center + basis_u * radius);
        let fid = mesh.add_face_closed_curve(
            v,
            AnalyticCurve::Circle { center, radius, normal, basis_u },
            mat,
        ).expect("add path B circle");

        let aabb = face_world_aabb(&mesh, fid).expect("Path B AABB");
        assert!((aabb.min.x - (-5.0)).abs() < 1e-9);
        assert!((aabb.max.x - 5.0).abs() < 1e-9);
        assert!((aabb.min.y - (-5.0)).abs() < 1e-9);
        assert!((aabb.max.y - 5.0).abs() < 1e-9);

        // Non-destructive: face still has 1 boundary vert (Path B form).
        let outer_start = mesh.faces[fid].outer().start;
        let verts = mesh.collect_loop_verts(outer_start).expect("collect");
        assert_eq!(verts.len(), 1, "Path B face must remain 1-vert after AABB query");
    }

    /// Normal extraction returns curve.normal directly for Path B Circle.
    #[test]
    fn adr101_phase_b4b_face_world_normal_path_b_circle() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let normal = DVec3::new(0.0, 0.0, 1.0);
        let basis_u = DVec3::new(1.0, 0.0, 0.0);
        let v = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let fid = mesh.add_face_closed_curve(
            v,
            AnalyticCurve::Circle {
                center: DVec3::ZERO, radius: 5.0, normal, basis_u,
            },
            mat,
        ).expect("add path B circle");

        let n = face_world_normal(&mesh, fid).expect("normal");
        assert!((n - normal).length() < 1e-9);
    }

    /// Disjoint Path B circles → Ok(None), NO mutation. Critical
    /// regression for L-B4b-2: the kernel-native form must survive the
    /// no-op case.
    #[test]
    fn adr101_phase_b4b_disjoint_path_b_circles_no_mutation() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let normal = DVec3::new(0.0, 0.0, 1.0);
        let basis_u = DVec3::new(1.0, 0.0, 0.0);

        let va = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let fa = mesh.add_face_closed_curve(
            va,
            AnalyticCurve::Circle {
                center: DVec3::ZERO, radius: 3.0, normal, basis_u,
            },
            mat,
        ).expect("circle A");

        // Circle B far away — AABBs disjoint.
        let vb = mesh.add_vertex(DVec3::new(105.0, 0.0, 0.0));
        let fb = mesh.add_face_closed_curve(
            vb,
            AnalyticCurve::Circle {
                center: DVec3::new(100.0, 0.0, 0.0), radius: 3.0, normal, basis_u,
            },
            mat,
        ).expect("circle B");

        let active_before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let result = auto_intersect_coplanar(&mut mesh, fa, fb, mat).expect("OK");
        assert!(result.is_none(), "disjoint → None");

        // CRITICAL: Path B form preserved. Both faces still 1 boundary
        // vert (self-loop edge). No polygonization happened.
        let active_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active_before, active_after);

        let verts_a = mesh.collect_loop_verts(mesh.faces[fa].outer().start).expect("a");
        let verts_b = mesh.collect_loop_verts(mesh.faces[fb].outer().start).expect("b");
        assert_eq!(verts_a.len(), 1, "Path B face A intact");
        assert_eq!(verts_b.len(), 1, "Path B face B intact");
    }

    /// Non-coplanar Path B circles → Ok(None), NO mutation.
    #[test]
    fn adr101_phase_b4b_non_coplanar_path_b_circles_no_mutation() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);

        let va = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let fa = mesh.add_face_closed_curve(
            va,
            AnalyticCurve::Circle {
                center: DVec3::ZERO,
                radius: 5.0,
                normal: DVec3::new(0.0, 0.0, 1.0),  // XY plane
                basis_u: DVec3::new(1.0, 0.0, 0.0),
            },
            mat,
        ).expect("circle A");

        // Circle B on YZ plane (perpendicular) but bounding boxes overlap.
        let vb = mesh.add_vertex(DVec3::new(0.0, 5.0, 0.0));
        let fb = mesh.add_face_closed_curve(
            vb,
            AnalyticCurve::Circle {
                center: DVec3::ZERO,
                radius: 5.0,
                normal: DVec3::new(1.0, 0.0, 0.0),  // YZ plane — perpendicular!
                basis_u: DVec3::new(0.0, 1.0, 0.0),
            },
            mat,
        ).expect("circle B");

        let result = auto_intersect_coplanar(&mut mesh, fa, fb, mat).expect("OK");
        assert!(result.is_none(), "non-coplanar → None");

        // Path B form preserved.
        let verts_a = mesh.collect_loop_verts(mesh.faces[fa].outer().start).expect("a");
        let verts_b = mesh.collect_loop_verts(mesh.faces[fb].outer().start).expect("b");
        assert_eq!(verts_a.len(), 1);
        assert_eq!(verts_b.len(), 1);
    }

    /// Path B Circle × Path B Circle partial overlap → 3 sub-faces
    /// (L-B4b-6: ADR-101 §2 canonical user trigger fully active).
    #[test]
    fn adr101_phase_b4b_path_b_circles_partial_overlap_auto_splits() {
        use crate::curves::AnalyticCurve;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let normal = DVec3::new(0.0, 0.0, 1.0);
        let basis_u = DVec3::new(1.0, 0.0, 0.0);

        // Circle A: center (0,0), radius 5
        let va = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let fa = mesh.add_face_closed_curve(
            va,
            AnalyticCurve::Circle {
                center: DVec3::ZERO, radius: 5.0, normal, basis_u,
            },
            mat,
        ).expect("circle A");

        // Circle B: center (6,0), radius 5 — AABBs overlap, coplanar, partial overlap.
        let vb = mesh.add_vertex(DVec3::new(11.0, 0.0, 0.0));
        let fb = mesh.add_face_closed_curve(
            vb,
            AnalyticCurve::Circle {
                center: DVec3::new(6.0, 0.0, 0.0), radius: 5.0, normal, basis_u,
            },
            mat,
        ).expect("circle B");

        let result = auto_intersect_coplanar(&mut mesh, fa, fb, mat)
            .expect("OK")
            .expect("Path B partial overlap MUST produce split");

        let active = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(active, 3,
            "Path B × Path B partial overlap → 3 sub-faces, got {}", active);

        // Manifold invariants preserved (regression guard for L-B4b-5).
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post-split Path B mesh must satisfy invariants — got {:?}",
            report.violations);

        let _ = result;
    }

    // ── Amendment 9 tests: HARD flag for split-induced edges ──────────
    //
    // 메타-원칙 #15 (canonical, 사용자 결재 2026-05-16):
    //   "동일한 분할 연산은 동일한 topological contract — 빠르고,
    //    신속하고, 정확하게."
    //
    // `Mesh::split_face` (mesh.rs:4068-4069) 가 split-induced edges 에
    // HARD flag 명시 부여하는 contract 를 `auto_intersect_coplanar` 도
    // 답습해야. 결함 C — `export_edge_lines_with_map` (mesh.rs:5384-5404)
    // 의 angle coplanar test 가 두 Plane face 사이 shared edge 를 hide.
    // HARD flag 부여 시 force_hard fast-path (mesh.rs:5359) 우회로 draw.

    /// L-B9-2 — lens 의 outer boundary 모든 HE (radial 포함) HARD 부여.
    #[test]
    fn adr101_amendment9_lens_outer_boundary_hes_hard() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let result = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK")
            .expect("partial overlap → 3 sub-faces");

        // Walk lens outer boundary + every radial twin must be HARD.
        let start = mesh.faces[result.lens].outer().start;
        let mut he_id = start;
        let mut he_count = 0usize;
        let mut rad_count = 0usize;
        loop {
            let mut rad_id = he_id;
            loop {
                assert!(
                    mesh.hes[rad_id].flags().contains(HeFlags::HARD),
                    "lens boundary HE (or radial twin) {:?} missing HARD flag — \
                     메타-원칙 #15 violation",
                    rad_id,
                );
                rad_count += 1;
                rad_id = mesh.hes[rad_id].next_rad();
                if rad_id == he_id { break; }
            }
            he_count += 1;
            he_id = mesh.hes[he_id].next();
            if he_id == start { break; }
        }
        // Lens is a quad (4 outer HEs), each manifold edge has 2 radial HEs.
        assert_eq!(he_count, 4, "lens outer should have 4 HEs (quad), got {}", he_count);
        assert!(rad_count >= 8, "expected ≥ 8 HEs marked HARD (4 × twins), got {}", rad_count);
    }

    /// L-B9-3 — a_only / b_only 외부 boundary HE 는 HARD 미부여 (자동
    /// draw via face_normals.len()==1 분기). split 영역 (lens 와 공유) 만
    /// HARD 부여 contract 정합.
    ///
    /// 외부 = 인접 face 없는 boundary HE (twin 의 face == NULL).
    #[test]
    fn adr101_amendment9_external_boundary_unaffected() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let result = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK")
            .expect("partial overlap → 3 sub-faces");

        // For face_a_only L-shape, find HEs whose radial twin sits on
        // a boundary (face == NULL). Those external HEs must NOT have
        // been touched by the Amendment 9 fix.
        let start = mesh.faces[result.face_a_only].outer().start;
        let mut he_id = start;
        let mut external_count = 0usize;
        loop {
            // Detect external: any radial twin with face NULL
            let mut rad_id = mesh.hes[he_id].next_rad();
            let mut is_external = false;
            while rad_id != he_id {
                if mesh.hes[rad_id].face().is_null() {
                    is_external = true;
                    break;
                }
                rad_id = mesh.hes[rad_id].next_rad();
            }
            if is_external {
                external_count += 1;
                // External HE itself may legitimately have HARD from earlier
                // logic — we only assert Amendment 9 did not *spuriously*
                // mark external boundaries of a_only/b_only.
                // The fix only walks lens.outer(), so a_only external
                // can only carry HARD if some prior step set it. Assert
                // the AND of "external AND HARD" never happens for fresh
                // a_only HEs.
                assert!(
                    !mesh.hes[he_id].flags().contains(HeFlags::HARD),
                    "external boundary HE {:?} unexpectedly HARD — Amendment 9 \
                     scope creep (should only touch lens boundary)",
                    he_id,
                );
            }
            he_id = mesh.hes[he_id].next();
            if he_id == start { break; }
        }
        assert!(external_count >= 3,
            "L-shape face_a_only should have ≥ 3 external HEs (4 outer corners), \
             got {}", external_count);
    }

    /// L-B9-2 + L-B9-5 — wireframe 에 lens shared edges 가 실제로 emit
    /// 되는지 verify. Render path `export_edge_lines_with_map` 호출 후
    /// edge_map 에 lens boundary edge IDs 가 포함되어야.
    #[test]
    fn adr101_amendment9_export_emits_lens_shared_edges() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let result = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK")
            .expect("partial overlap → 3 sub-faces");

        // Snapshot lens outer edge IDs.
        let mut lens_edge_ids: Vec<u32> = Vec::new();
        let start = mesh.faces[result.lens].outer().start;
        let mut he_id = start;
        loop {
            lens_edge_ids.push(mesh.hes[he_id].edge().raw());
            he_id = mesh.hes[he_id].next();
            if he_id == start { break; }
        }
        assert_eq!(lens_edge_ids.len(), 4,
            "lens outer should have 4 edges (quad)");

        // Export wireframe with default 20.1° angle threshold.
        let (lines, edge_map) = mesh.export_edge_lines_with_map(20.1);

        // Every lens edge must appear in edge_map at least once.
        for eid in &lens_edge_ids {
            assert!(
                edge_map.contains(eid),
                "lens edge {} missing from wireframe emit (export_edge_lines_with_map) — \
                 결함 C regression (HARD flag fix should make lens shared edges visible)",
                eid,
            );
        }
        // Lines must be non-empty (6 floats per segment).
        assert!(!lines.is_empty(), "export_edge_lines lines must include lens segments");
        assert_eq!(lines.len() % 6, 0, "lines buffer must be multiple of 6");
    }

    /// Regression guard — fix MUST NOT increase orphan_count or break
    /// face invariants.
    #[test]
    fn adr101_amendment9_invariants_preserved() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = add_quad(&mut mesh, [
            xy(0.0, 0.0), xy(10.0, 0.0), xy(10.0, 10.0), xy(0.0, 10.0),
        ]);
        let b = add_quad(&mut mesh, [
            xy(5.0, 5.0), xy(15.0, 5.0), xy(15.0, 15.0), xy(5.0, 15.0),
        ]);
        let _ = auto_intersect_coplanar(&mut mesh, a, b, mat)
            .expect("OK")
            .expect("partial overlap");

        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "post Amendment 9 fix must satisfy invariants — got {:?}",
            report.violations);
    }
}
