//! Face Split operations — draw lines on existing faces to subdivide them.
//!
//! This is the key enabler for SketchUp-style modeling:
//! Draw a shape on a face → face splits → Push/Pull the inner part → protrusion.
//!
//! ## Operations
//! - `point_on_face()` — test if a 3D point lies on a face's plane and within its boundary
//! - `line_edge_intersection()` — find where a line segment crosses an edge
//! - `split_face_by_line()` — split a face with a line segment (main entry point)

use glam::DVec3;
use anyhow::{Result, ensure};

use crate::entities::*;
use crate::mesh::Mesh;
use crate::tolerances::*;

/// Result of a face split operation.
#[derive(Clone, Debug)]
pub struct FaceSplitResult {
    /// The new faces created (original face is removed)
    pub new_faces: Vec<FaceId>,
    /// New vertices created on edges (intersection points)
    pub new_verts: Vec<VertId>,
    /// New edges created by the split
    pub new_edges: Vec<EdgeId>,
    /// Debug info
    pub debug: Vec<String>,
}

// ════════════════════════════════════════════════════════════════════════════
// Geometric queries
// ════════════════════════════════════════════════════════════════════════════

/// Test if a 3D point lies on a face's plane (within tolerance).
///
/// Returns the signed distance from the face plane.
/// A point is "on" the face plane if |distance| < FACE_TOLERANCE.
pub fn point_on_face_plane(mesh: &Mesh, face_id: FaceId, point: DVec3) -> Result<f64> {
    let face = mesh.faces.get(face_id)
        .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;
    let normal = face.normal();

    // Get any vertex on the face to define the plane
    let outer_start = face.outer().start;
    let loop_verts = mesh.collect_loop_verts(outer_start)?;
    ensure!(!loop_verts.is_empty(), "Face has no vertices");

    let face_point = mesh.vertex_pos(loop_verts[0])?;
    let dist = (point - face_point).dot(normal);
    Ok(dist)
}

/// Test if a 3D point lies within a face's boundary (2D containment test).
///
/// Projects the face and point onto 2D (dropping the dominant normal axis),
/// then uses ray casting (point-in-polygon) to test containment.
///
/// Returns true if the point is inside the face boundary.
pub fn point_in_face(mesh: &Mesh, face_id: FaceId, point: DVec3) -> Result<bool> {
    let face = mesh.faces.get(face_id)
        .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;
    let normal = face.normal();

    // Check point is on the face plane first
    let plane_dist = point_on_face_plane(mesh, face_id, point)?;
    if plane_dist.abs() > FACE_TOLERANCE {
        return Ok(false);
    }

    // Get face boundary vertices
    let outer_start = face.outer().start;
    let loop_verts = mesh.collect_loop_verts(outer_start)?;

    // Project to 2D (drop dominant axis of normal)
    let (ax1, ax2) = projection_axes(normal);

    let px = component(point, ax1);
    let py = component(point, ax2);

    // Ray casting algorithm (point-in-polygon)
    let mut inside = false;
    let n = loop_verts.len();
    let mut j = n - 1;

    for i in 0..n {
        let pi = mesh.vertex_pos(loop_verts[i])?;
        let pj = mesh.vertex_pos(loop_verts[j])?;

        let yi = component(pi, ax2);
        let yj = component(pj, ax2);
        let xi = component(pi, ax1);
        let xj = component(pj, ax1);

        if ((yi > py) != (yj > py)) &&
           (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
        {
            inside = !inside;
        }
        j = i;
    }

    Ok(inside)
}

/// Find the intersection point of a line segment with an edge.
///
/// Both the line segment (p0→p1) and the edge must be coplanar.
/// Returns Some((intersection_point, t_param)) where t_param ∈ [0,1]
/// is the parametric position on the edge.
///
/// Returns None if they don't intersect or are parallel.
pub fn line_edge_intersection(
    mesh: &Mesh,
    p0: DVec3,
    p1: DVec3,
    edge_id: EdgeId,
) -> Result<Option<(DVec3, f64)>> {
    let edge = mesh.edges.get(edge_id)
        .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;

    let ea = mesh.vertex_pos(edge.v_small())?;
    let eb = mesh.vertex_pos(edge.v_large())?;

    // Use 3D segment-segment closest approach
    let d1 = p1 - p0;       // line direction
    let d2 = eb - ea;       // edge direction
    let d0 = p0 - ea;

    let a = d1.dot(d1);     // |d1|²
    let b = d1.dot(d2);
    let c = d2.dot(d2);     // |d2|²
    let d = d1.dot(d0);
    let e = d2.dot(d0);

    let denom = a * c - b * b;

    // Parallel (or degenerate) segments
    if denom.abs() < 1e-12 {
        return Ok(None);
    }

    let t = (b * e - c * d) / denom;  // parameter on line segment
    let u = (a * e - b * d) / denom;  // parameter on edge

    // Both parameters must be in [0, 1] (with small tolerance)
    const EPS: f64 = 1e-8;
    if t < -EPS || t > 1.0 + EPS || u < -EPS || u > 1.0 + EPS {
        return Ok(None);
    }

    // Compute intersection points on both segments
    let pt_on_line = p0 + d1 * t;
    let pt_on_edge = ea + d2 * u;

    // Check they're actually close (coplanarity check)
    let gap = (pt_on_line - pt_on_edge).length();
    if gap > FACE_TOLERANCE * 10.0 {
        return Ok(None);
    }

    // Use the edge point for consistency
    let intersection = pt_on_edge;
    let u_clamped = u.clamp(0.0, 1.0);

    Ok(Some((intersection, u_clamped)))
}

// ════════════════════════════════════════════════════════════════════════════
// Main face split operation
// ════════════════════════════════════════════════════════════════════════════

/// Split a face by drawing a line segment across it.
///
/// This is the main entry point for "draw on face" operations.
/// The line segment must have both endpoints either:
/// - On the face boundary (on an edge or at a vertex)
/// - Inside the face
///
/// ## Algorithm
/// 1. Find where the line intersects the face's boundary edges
/// 2. Insert new vertices at intersection points (split edges)
/// 3. Split the face using the two boundary points
///
/// ## Cases handled
/// - **Edge-to-edge**: line crosses two boundary edges → face splits in two
/// - **Vertex-to-vertex**: line connects two existing boundary verts → face splits in two
/// - **Vertex-to-edge**: line from a vertex to a point on an edge → face splits in two
/// - **Internal closed loop**: (future) line forms a closed shape inside → inner face + outer ring
pub fn split_face_by_line(
    mesh: &mut Mesh,
    face_id: FaceId,
    line_start: DVec3,
    line_end: DVec3,
) -> Result<FaceSplitResult> {
    ensure!(mesh.faces.contains(face_id), "Face {:?} not found", face_id);

    let mut debug = Vec::new();
    let mut new_verts = Vec::new();
    let mut new_edges = Vec::new();

    // ─── Step 0: Project line endpoints onto face plane ─────────────────
    // Three.js raycast coordinates may not be exactly on the face plane.
    // Project them onto the face plane to ensure coplanarity.
    let face_normal = mesh.faces[face_id].normal();
    let outer_start = mesh.faces[face_id].outer().start;
    let loop_verts = mesh.collect_loop_verts(outer_start)?;
    let loop_hes = mesh.collect_loop_hes(outer_start)?;

    ensure!(!loop_verts.is_empty(), "Face has no boundary vertices");
    let face_origin = mesh.vertex_pos(loop_verts[0])?;

    // Compute face bounding box diagonal for distance thresholds
    let face_diag = compute_face_diagonal(mesh, &loop_verts)?;
    let max_plane_dist = face_diag.max(1.0); // Allow projection from up to face-diagonal distance
    debug.push(format!("face_diag={:.4}, normal={:?}", face_diag, face_normal));

    let proj_start = project_to_plane(line_start, face_origin, face_normal, max_plane_dist)?;
    let proj_end = project_to_plane(line_end, face_origin, face_normal, max_plane_dist)?;

    debug.push(format!("projected start: {:?} (plane_dist={:.6})", proj_start,
        (line_start - proj_start).length()));
    debug.push(format!("projected end: {:?} (plane_dist={:.6})", proj_end,
        (line_end - proj_end).length()));

    // ─── Step 1: Determine where line endpoints touch the face boundary ─
    let snap_tolerance = face_diag * 0.02; // 2% of face diagonal — generous for UI precision
    let split_v1 = find_boundary_point(mesh, face_id, proj_start, &loop_verts, &loop_hes, snap_tolerance)?;
    let split_v2 = find_boundary_point(mesh, face_id, proj_end, &loop_verts, &loop_hes, snap_tolerance)?;

    debug.push(format!("split_v1: {:?}", split_v1));
    debug.push(format!("split_v2: {:?}", split_v2));

    // ─── Step 2: Realize the boundary points as actual vertices ─────────
    // If a point is on an edge, split that edge to create the vertex.
    // IMPORTANT: If both points are on the SAME edge, we must handle carefully:
    //   - After splitting the edge for v1, the original edge is deactivated.
    //   - v2's edge_id would be stale. We fix this by finding which new edge v2 falls on.

    // Check for same-edge case
    let (split_v1_final, split_v2_final) = fix_same_edge_case(split_v1, split_v2);

    let v1 = realize_boundary_point(mesh, &split_v1_final, &mut new_verts, &mut new_edges, &mut debug)?;

    // After v1's edge split, v2's edge_id might be stale — re-resolve if needed
    let split_v2_resolved = if let BoundaryPoint::OnEdge { edge_id, position, t } = &split_v2_final {
        if !mesh.edges[*edge_id].is_active() {
            // The edge was split by v1 — find which new edge contains this position
            debug.push(format!("  v2's edge {} was split, re-resolving...", edge_id.raw()));
            resolve_on_split_edge(mesh, *edge_id, *position, &new_edges, &mut debug)?
        } else {
            split_v2_final.clone()
        }
    } else {
        split_v2_final.clone()
    };

    let v2 = realize_boundary_point(mesh, &split_v2_resolved, &mut new_verts, &mut new_edges, &mut debug)?;

    ensure!(v1 != v2, "Both split points resolved to the same vertex {:?}", v1);

    debug.push(format!("splitting face {:?} between v{} and v{}", face_id.raw(), v1.raw(), v2.raw()));

    // ─── Step 3: Split the face ─────────────────────────────────────────
    let (face_a, face_b) = mesh.split_face(face_id, v1, v2)?;

    // Track the new split edge
    if let Some(eid) = mesh.find_edge(v1, v2) {
        new_edges.push(eid);
    }

    debug.push(format!("result: face_a={}, face_b={}", face_a.raw(), face_b.raw()));

    Ok(FaceSplitResult {
        new_faces: vec![face_a, face_b],
        new_verts,
        new_edges,
        debug,
    })
}

/// Project a 3D point onto a plane defined by (origin, normal).
/// Returns error if the point is too far from the plane.
fn project_to_plane(
    point: DVec3,
    plane_origin: DVec3,
    plane_normal: DVec3,
    max_distance: f64,
) -> Result<DVec3> {
    let dist = (point - plane_origin).dot(plane_normal);
    ensure!(dist.abs() < max_distance,
        "Point is {:.4} from face plane (max allowed: {:.4})", dist.abs(), max_distance);
    Ok(point - plane_normal * dist)
}

/// Compute the bounding box diagonal of a face (for relative tolerance calculation).
fn compute_face_diagonal(mesh: &Mesh, verts: &[VertId]) -> Result<f64> {
    let mut min = DVec3::splat(f64::MAX);
    let mut max = DVec3::splat(f64::MIN);
    for &vid in verts {
        let p = mesh.vertex_pos(vid)?;
        min = min.min(p);
        max = max.max(p);
    }
    Ok((max - min).length())
}

// ════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ════════════════════════════════════════════════════════════════════════════

/// Where a point touches the face boundary.
#[derive(Clone, Debug)]
enum BoundaryPoint {
    /// Point coincides with an existing vertex
    ExistingVertex(VertId),
    /// Point lies on an edge (needs edge split)
    OnEdge {
        edge_id: EdgeId,
        position: DVec3,
        /// Parametric position on edge [0, 1]
        t: f64,
    },
}

/// Find where a point touches a face's boundary.
///
/// Uses a relative tolerance based on face size (snap_tolerance).
///
/// Strategy:
/// 1. Check if point is on an existing vertex (within tolerance)
/// 2. Project point onto each boundary edge, find closest within tolerance
/// 3. If inside face: extend the split line to intersect the boundary (future)
/// 4. Snap to nearest edge as fallback (for interior points from UI clicks)
///
/// The snap_tolerance should be proportional to face size (e.g. face_diagonal * 0.02).
fn find_boundary_point(
    mesh: &Mesh,
    _face_id: FaceId,
    point: DVec3,
    loop_verts: &[VertId],
    loop_hes: &[HeId],
    snap_tolerance: f64,
) -> Result<BoundaryPoint> {
    let n = loop_verts.len();
    // Vertex snap threshold: generous enough for UI precision
    let vert_snap = snap_tolerance;

    // ── Pass 1: Check if point coincides with an existing vertex ──
    let mut best_vert: Option<(VertId, f64)> = None;
    for &vid in loop_verts {
        let vpos = mesh.vertex_pos(vid)?;
        let dist = (vpos - point).length();
        if dist < vert_snap {
            if best_vert.is_none() || dist < best_vert.unwrap().1 {
                best_vert = Some((vid, dist));
            }
        }
    }
    if let Some((vid, _)) = best_vert {
        return Ok(BoundaryPoint::ExistingVertex(vid));
    }

    // ── Pass 2: Project onto each boundary edge, find best match ──
    // Use a 2-tier approach:
    //   - Tight: edge distance < snap_tolerance → high confidence
    //   - Loose: always track the closest edge as fallback
    let mut tight_best: Option<(EdgeId, DVec3, f64, f64)> = None; // (edge_id, pos, t, dist)
    let mut loose_best: Option<(EdgeId, DVec3, f64, f64)> = None;

    for i in 0..n {
        let he_id = loop_hes[i];
        let edge_id = mesh.hes[he_id].edge();

        let edge = &mesh.edges[edge_id];
        let ea = mesh.vertex_pos(edge.v_small())?;
        let eb = mesh.vertex_pos(edge.v_large())?;

        let edge_dir = eb - ea;
        let edge_len_sq = edge_dir.length_squared();
        if edge_len_sq < 1e-20 { continue; }
        let edge_len = edge_len_sq.sqrt();

        let t = (point - ea).dot(edge_dir) / edge_len_sq;
        let t_clamped = t.clamp(0.0, 1.0);
        let closest = ea + edge_dir * t_clamped;
        let dist = (point - closest).length();

        // Snap t close to endpoints to vertex instead
        // Use relative threshold based on edge length
        let endpoint_threshold = (vert_snap / edge_len).min(0.05);
        if t_clamped < endpoint_threshold {
            // Close to v_small — check if it's a loop vertex
            let src_vid = if mesh.hes[he_id].dst() == edge.v_small() {
                edge.v_large()
            } else {
                edge.v_small()
            };
            if dist < vert_snap * 2.0 {
                return Ok(BoundaryPoint::ExistingVertex(src_vid));
            }
            continue;
        }
        if t_clamped > 1.0 - endpoint_threshold {
            let dst_vid = mesh.hes[he_id].dst();
            if dist < vert_snap * 2.0 {
                return Ok(BoundaryPoint::ExistingVertex(dst_vid));
            }
            continue;
        }

        // Tight match (close to boundary edge)
        if dist < snap_tolerance {
            if tight_best.is_none() || dist < tight_best.as_ref().unwrap().3 {
                tight_best = Some((edge_id, closest, t_clamped, dist));
            }
        }

        // Loose: always track closest (for interior point fallback)
        if loose_best.is_none() || dist < loose_best.as_ref().unwrap().3 {
            loose_best = Some((edge_id, closest, t_clamped, dist));
        }
    }

    // Return tight match if found
    if let Some((edge_id, pos, t, _dist)) = tight_best {
        return Ok(BoundaryPoint::OnEdge { edge_id, position: pos, t });
    }

    // ── Pass 3: Interior point — snap to closest edge ──
    // This handles the case where the user clicks inside the face (common with Three.js raycast).
    // The point gets projected onto the nearest boundary edge.
    if let Some((edge_id, pos, t, dist)) = loose_best {
        // Sanity check: don't snap unreasonably far
        if dist < snap_tolerance * 50.0 {
            return Ok(BoundaryPoint::OnEdge { edge_id, position: pos, t });
        }
    }

    // ── Pass 4: Last resort — snap to nearest vertex ──
    let mut best_vid = loop_verts[0];
    let mut best_dist = f64::MAX;
    for &vid in loop_verts {
        let d = (mesh.vertex_pos(vid)? - point).length();
        if d < best_dist {
            best_dist = d;
            best_vid = vid;
        }
    }
    Ok(BoundaryPoint::ExistingVertex(best_vid))
}

/// Handle the case where both boundary points are on the same edge.
///
/// If both are OnEdge with the same edge_id, we ensure v1 has the smaller t
/// so that after splitting for v1, v2's position falls on the correct new sub-edge.
fn fix_same_edge_case(bp1: BoundaryPoint, bp2: BoundaryPoint) -> (BoundaryPoint, BoundaryPoint) {
    if let (
        BoundaryPoint::OnEdge { edge_id: e1, t: t1, .. },
        BoundaryPoint::OnEdge { edge_id: e2, t: t2, .. },
    ) = (&bp1, &bp2) {
        if e1 == e2 {
            // Same edge: ensure t1 < t2 for consistent ordering
            if t1 > t2 {
                return (bp2, bp1);
            }
        }
    }
    (bp1, bp2)
}

/// After an edge was split, find which new sub-edge contains the given position.
///
/// When edge E (A→B) is split at point P creating edges E1(A→P) and E2(P→B),
/// we need to find which of E1 or E2 contains our target position.
fn resolve_on_split_edge(
    mesh: &Mesh,
    _old_edge_id: EdgeId,
    position: DVec3,
    new_edges: &[EdgeId],
    debug: &mut Vec<String>,
) -> Result<BoundaryPoint> {
    let mut best: Option<(EdgeId, DVec3, f64, f64)> = None; // (edge_id, closest, t, dist)

    for &eid in new_edges {
        if !mesh.edges.contains(eid) || !mesh.edges[eid].is_active() { continue; }
        let ea = mesh.vertex_pos(mesh.edges[eid].v_small())?;
        let eb = mesh.vertex_pos(mesh.edges[eid].v_large())?;
        let dir = eb - ea;
        let len_sq = dir.length_squared();
        if len_sq < 1e-20 { continue; }

        let t = (position - ea).dot(dir) / len_sq;
        let t_clamped = t.clamp(0.0, 1.0);
        let closest = ea + dir * t_clamped;
        let dist = (position - closest).length();

        if t_clamped > 0.01 && t_clamped < 0.99 {
            if best.is_none() || dist < best.as_ref().unwrap().3 {
                best = Some((eid, closest, t_clamped, dist));
            }
        }
    }

    if let Some((edge_id, pos, t, dist)) = best {
        debug.push(format!("  re-resolved to edge {} at t={:.4} (dist={:.6})", edge_id.raw(), t, dist));
        Ok(BoundaryPoint::OnEdge { edge_id, position: pos, t })
    } else {
        // Fallback: snap to nearest new vertex
        anyhow::bail!("Could not resolve position on split edge — no suitable new edge found")
    }
}

/// Convert a BoundaryPoint into an actual VertId.
///
/// If the point is on an edge, splits the edge to create a new vertex.
fn realize_boundary_point(
    mesh: &mut Mesh,
    bp: &BoundaryPoint,
    new_verts: &mut Vec<VertId>,
    new_edges: &mut Vec<EdgeId>,
    debug: &mut Vec<String>,
) -> Result<VertId> {
    match bp {
        BoundaryPoint::ExistingVertex(vid) => {
            debug.push(format!("  using existing vertex {}", vid.raw()));
            Ok(*vid)
        }
        BoundaryPoint::OnEdge { edge_id, position, t } => {
            debug.push(format!("  splitting edge {} at t={:.4}", edge_id.raw(), t));
            let (vp, e1, e2) = mesh.split_edge(*edge_id, *position)?;
            new_verts.push(vp);
            new_edges.push(e1);
            new_edges.push(e2);
            debug.push(format!("  → new vertex {}, edges {}, {}", vp.raw(), e1.raw(), e2.raw()));
            Ok(vp)
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════════════════════════════════════

/// Choose the best 2D projection axes based on a normal vector.
fn projection_axes(normal: DVec3) -> (usize, usize) {
    let abs_n = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
    if abs_n[0] >= abs_n[1] && abs_n[0] >= abs_n[2] {
        (1, 2) // Drop X
    } else if abs_n[1] >= abs_n[0] && abs_n[1] >= abs_n[2] {
        (0, 2) // Drop Y
    } else {
        (0, 1) // Drop Z
    }
}

/// Get a specific component of a DVec3 by axis index.
#[inline]
fn component(v: DVec3, axis: usize) -> f64 {
    match axis {
        0 => v.x,
        1 => v.y,
        _ => v.z,
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    /// Create a simple 4×4 square face on the XZ plane (Y=0)
    fn make_square(mesh: &mut Mesh) -> (FaceId, [VertId; 4]) {
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        (fid, [v0, v1, v2, v3])
    }

    // ── split_edge tests ─────────────────────────────────────────────

    #[test]
    fn split_edge_creates_new_vertex() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Split edge v0–v1 at midpoint (2, 0, 0)
        let eid = m.find_edge(v0, v1).expect("edge should exist");
        let (vp, e1, e2) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        assert_ne!(vp, v0);
        assert_ne!(vp, v1);
        assert!(!e1.is_null());
        assert!(!e2.is_null());

        // New vertex position
        let pos = m.vertex_pos(vp).unwrap();
        assert!((pos - DVec3::new(2.0, 0.0, 0.0)).length() < 1e-10);
    }

    #[test]
    fn split_edge_preserves_face_loop() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        let eid = m.find_edge(v0, v1).unwrap();
        let (vp, _, _) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Face should now have 5 vertices (was 4, split added 1)
        let loop_verts = m.collect_loop_verts(m.faces[fid].outer().start).unwrap();
        assert_eq!(loop_verts.len(), 5, "face should have 5 verts after edge split");

        // The new vertex should be in the loop
        assert!(loop_verts.contains(&vp), "new vertex should be in face loop");
    }

    #[test]
    fn split_edge_old_edge_deactivated() {
        let mut m = Mesh::new();
        let (_, [v0, v1, _, _]) = make_square(&mut m);

        let eid = m.find_edge(v0, v1).unwrap();
        m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Old edge should be inactive
        assert!(!m.edges[eid].is_active());

        // Old edge should not be in vert_to_edge
        assert!(m.find_edge(v0, v1).is_none());
    }

    #[test]
    fn split_edge_new_edges_findable() {
        let mut m = Mesh::new();
        let (_, [v0, v1, _, _]) = make_square(&mut m);

        let eid = m.find_edge(v0, v1).unwrap();
        let (vp, _, _) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Should find edges v0–vp and vp–v1
        assert!(m.find_edge(v0, vp).is_some(), "edge v0-vp should exist");
        assert!(m.find_edge(vp, v1).is_some(), "edge vp-v1 should exist");
    }

    #[test]
    fn split_edge_on_box_preserves_all_faces() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);

        // Create a box: rect → push/pull
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let base = m.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let pp = m.push_pull(base, 3.0, mat).unwrap();

        assert_eq!(m.face_count(), 6, "box should have 6 faces");

        // Split an edge shared by two faces (e.g., v0–v1 on the bottom)
        let eid = m.find_edge(v0, v1).unwrap();
        let (vp, _, _) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // All 6 faces should still be valid (edge split doesn't remove faces)
        assert_eq!(m.face_count(), 6, "face count should remain 6 after edge split");

        // The two faces sharing the split edge should now have 5 verts each
        // (they were quads with 4 verts, now pentagons with 5)
    }

    // ── split_face tests ─────────────────────────────────────────────

    #[test]
    fn split_face_creates_two_faces() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Split diagonally: v0 to v2
        let (fa, fb) = m.split_face(fid, v0, v2).unwrap();

        assert_ne!(fa, fb);
        // Original face is reused for one of the two sub-faces (DCEL surgery)
        assert_eq!(fa, fid);
        // Two faces total (original reused + one new)
        assert_eq!(m.face_count(), 2);
    }

    #[test]
    fn split_face_vertex_counts() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Split v1–v3: creates two triangles
        let (fa, fb) = m.split_face(fid, v1, v3).unwrap();

        let va = m.collect_loop_verts(m.faces[fa].outer().start).unwrap();
        let vb = m.collect_loop_verts(m.faces[fb].outer().start).unwrap();

        assert_eq!(va.len(), 3, "face A should be triangle");
        assert_eq!(vb.len(), 3, "face B should be triangle");
    }

    #[test]
    fn split_face_preserves_material() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(42);
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let fid = m.add_face(&[v0, v1, v2, v3], mat).unwrap();

        let (fa, fb) = m.split_face(fid, v0, v2).unwrap();

        assert_eq!(m.faces[fa].material().raw(), 42);
        assert_eq!(m.faces[fb].material().raw(), 42);
    }

    #[test]
    fn split_face_rejects_adjacent_vertices() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, _, _]) = make_square(&mut m);

        // v0 and v1 are adjacent — should fail
        let result = m.split_face(fid, v0, v1);
        assert!(result.is_err());
    }

    #[test]
    fn split_face_rejects_same_vertex() {
        let mut m = Mesh::new();
        let (fid, [v0, _, _, _]) = make_square(&mut m);

        let result = m.split_face(fid, v0, v0);
        assert!(result.is_err());
    }

    #[test]
    fn split_face_preserves_adjacent_face_loops() {
        // This is the critical test: splitting a face on a box must NOT
        // corrupt the loops of adjacent (neighbor) faces that share edges.
        // The old remove_face+add_face approach broke this.
        let mut m = Mesh::new();
        let mat = MaterialId::default();

        // Create a box via push_pull (6 faces sharing edges)
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let base = m.add_face(&[v0, v3, v2, v1], mat).unwrap(); // CCW for Y-up normal
        let pp = m.push_pull(base, 3.0, mat).unwrap();

        let face_count_before = m.face_count();
        assert_eq!(face_count_before, 6, "box should have 6 faces");

        // Find the top face (the one returned by push_pull)
        let top_face = pp.top_face;
        let top_verts = m.collect_loop_verts(m.faces[top_face].outer().start).unwrap();
        assert_eq!(top_verts.len(), 4, "top face should be a quad");

        // Split the top face diagonally
        let (fa, fb) = m.split_face(top_face, top_verts[0], top_verts[2]).unwrap();

        // Should now have 7 faces (6 - 1 original + 2 new = 7, but original reused so 6 + 1 = 7)
        assert_eq!(m.face_count(), 7, "box + split should have 7 faces");

        // Verify BOTH new faces have valid loops
        let verts_a = m.collect_loop_verts(m.faces[fa].outer().start).unwrap();
        let verts_b = m.collect_loop_verts(m.faces[fb].outer().start).unwrap();
        assert_eq!(verts_a.len(), 3, "face A should be a triangle");
        assert_eq!(verts_b.len(), 3, "face B should be a triangle");

        // CRITICAL: Verify ALL remaining faces (the 5 side/bottom faces) still have valid loops
        for (fid, face) in m.faces.iter() {
            if !face.is_active() { continue; }
            let loop_start = face.outer().start;
            let verts = m.collect_loop_verts(loop_start);
            assert!(verts.is_ok(), "Face {:?} has broken loop after split", fid);
            let verts = verts.unwrap();
            assert!(verts.len() >= 3, "Face {:?} has degenerate loop ({} verts)", fid, verts.len());
        }

        // Verify export_buffers works (the ultimate integration test — it triangulates all faces)
        let bufs = m.export_buffers().unwrap();
        assert!(bufs.0.len() > 0, "export_buffers should produce vertices");
    }

    // ── split_face_by_line tests ─────────────────────────────────────

    #[test]
    fn split_face_by_line_midpoints() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Draw a line from midpoint of v0–v1 to midpoint of v2–v3
        // This should: split edge v0-v1, split edge v2-v3, then split the face
        let line_start = DVec3::new(2.0, 0.0, 0.0);  // mid of v0–v1
        let line_end = DVec3::new(2.0, 0.0, 4.0);    // mid of v2–v3

        let result = split_face_by_line(&mut m, fid, line_start, line_end).unwrap();

        assert_eq!(result.new_faces.len(), 2, "should create 2 faces");
        assert_eq!(result.new_verts.len(), 2, "should create 2 new vertices");

        // Total faces should be 2 (original removed, 2 new)
        assert_eq!(m.face_count(), 2);
    }

    #[test]
    fn split_face_by_line_vertex_to_vertex() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Draw from v0 to v2 (diagonal)
        let p0 = m.vertex_pos(v0).unwrap();
        let p2 = m.vertex_pos(v2).unwrap();

        let result = split_face_by_line(&mut m, fid, p0, p2).unwrap();

        assert_eq!(result.new_faces.len(), 2);
        assert_eq!(result.new_verts.len(), 0, "no new verts needed (existing vertices)");
        assert_eq!(m.face_count(), 2);
    }

    #[test]
    fn split_face_by_line_vertex_to_edge() {
        let mut m = Mesh::new();
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Draw from v0 to midpoint of v1–v2
        let p0 = m.vertex_pos(v0).unwrap();
        let mid12 = DVec3::new(4.0, 0.0, 2.0);  // midpoint of v1–v2

        let result = split_face_by_line(&mut m, fid, p0, mid12).unwrap();

        assert_eq!(result.new_faces.len(), 2);
        assert_eq!(result.new_verts.len(), 1, "one new vert on edge v1-v2");
        assert_eq!(m.face_count(), 2);
    }

    // ── point_in_face tests ──────────────────────────────────────────

    #[test]
    fn point_in_face_center() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);

        // Center of 4×4 square at y=0
        let center = DVec3::new(2.0, 0.0, 2.0);
        assert!(point_in_face(&m, fid, center).unwrap());
    }

    #[test]
    fn point_in_face_outside() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);

        let outside = DVec3::new(10.0, 0.0, 10.0);
        assert!(!point_in_face(&m, fid, outside).unwrap());
    }

    #[test]
    fn point_in_face_off_plane() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);

        // Above the face
        let above = DVec3::new(2.0, 5.0, 2.0);
        assert!(!point_in_face(&m, fid, above).unwrap());
    }

    // ── line_edge_intersection tests ─────────────────────────────────

    #[test]
    fn line_edge_intersection_crossing() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();

        // Line from (2, 0, -1) to (2, 0, 1) crosses edge at (2, 0, 0)
        let result = line_edge_intersection(
            &m,
            DVec3::new(2.0, 0.0, -1.0),
            DVec3::new(2.0, 0.0, 1.0),
            eid,
        ).unwrap();

        assert!(result.is_some());
        let (pt, t) = result.unwrap();
        assert!((pt - DVec3::new(2.0, 0.0, 0.0)).length() < 1e-6);
        assert!((t - 0.5).abs() < 1e-6);
    }

    #[test]
    fn line_edge_intersection_parallel() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();

        // Parallel line
        let result = line_edge_intersection(
            &m,
            DVec3::new(0.0, 0.0, 1.0),
            DVec3::new(4.0, 0.0, 1.0),
            eid,
        ).unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn line_edge_intersection_miss() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();

        // Line doesn't reach the edge
        let result = line_edge_intersection(
            &m,
            DVec3::new(10.0, 0.0, -1.0),
            DVec3::new(10.0, 0.0, 1.0),
            eid,
        ).unwrap();

        assert!(result.is_none());
    }

    // ── Box face split tests (real 3D scenario) ──────────────────────

    /// Helper: create a box by making a rect on XZ plane and push_pull upward.
    ///
    /// Vertex winding [v0,v3,v2,v1] → upward normal (0,1,0)
    /// push_pull(height) goes +Y → top face at Y=height.
    fn make_box(mesh: &mut Mesh, width: f64, depth: f64, height: f64) -> (FaceId, crate::operations::push_pull::PushPullResult) {
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(width, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(width, 0.0, depth));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, depth));
        // CCW winding for upward normal: v0→v3→v2→v1
        let base = mesh.add_face(&[v0, v3, v2, v1], mat).unwrap();
        let pp = mesh.push_pull(base, height, mat).unwrap();
        let top = pp.top_face;
        (top, pp)
    }

    #[test]
    fn box_face_split_top_edge_to_edge_midpoints() {
        // Create a 4x3x4 box (width=4, depth=4, height=3)
        // Top face at Y=3 should have verts at (0,3,0), (4,3,0), (4,3,4), (0,3,4)
        let mut m = Mesh::new();
        let (top_face, pp) = make_box(&mut m, 4.0, 4.0, 3.0);

        println!("=== BOX FACE SPLIT: edge-to-edge midpoints ===");
        println!("Total faces after push_pull: {}", m.face_count());
        println!("Top face: {:?}", top_face);
        println!("Push/Pull debug: {:?}", pp.split_debug);

        // Inspect the top face
        let outer_start = m.faces[top_face].outer().start;
        let loop_verts = m.collect_loop_verts(outer_start).unwrap();
        let loop_hes = m.collect_loop_hes(outer_start).unwrap();
        println!("Top face vertex count: {}", loop_verts.len());
        for (i, &vid) in loop_verts.iter().enumerate() {
            let pos = m.vertex_pos(vid).unwrap();
            let he = loop_hes[i];
            let edge = m.hes[he].edge();
            println!("  v{} = {:?} (vert_id={}, he={}, edge={})", i, pos, vid.raw(), he.raw(), edge.raw());
        }

        let normal = m.faces[top_face].normal();
        println!("Top face normal: {:?}", normal);

        // Attempt split: midpoint of one edge to midpoint of opposite edge
        // For a top face at Y=3, we want to split from midpoint of edge at Z=0 to midpoint of edge at Z=4
        // i.e., from (2, 3, 0) to (2, 3, 4)
        let line_start = DVec3::new(2.0, 3.0, 0.0);
        let line_end = DVec3::new(2.0, 3.0, 4.0);

        println!("\nSplit line: {:?} → {:?}", line_start, line_end);

        // Check plane distance first
        let plane_dist = point_on_face_plane(&m, top_face, line_start).unwrap();
        println!("line_start plane distance: {:.2e} (FACE_TOLERANCE = {:.2e})", plane_dist, FACE_TOLERANCE);

        let plane_dist2 = point_on_face_plane(&m, top_face, line_end).unwrap();
        println!("line_end plane distance: {:.2e}", plane_dist2);

        // Check point_in_face
        let in_face_start = point_in_face(&m, top_face, line_start).unwrap();
        let in_face_end = point_in_face(&m, top_face, line_end).unwrap();
        println!("line_start in face: {}", in_face_start);
        println!("line_end in face: {}", in_face_end);

        // Check boundary point detection
        let bp1 = find_boundary_point(&m, top_face, line_start, &loop_verts, &loop_hes, 1.0);
        let bp2 = find_boundary_point(&m, top_face, line_end, &loop_verts, &loop_hes, 1.0);
        println!("boundary_point for line_start: {:?}", bp1);
        println!("boundary_point for line_end: {:?}", bp2);

        // Check each edge for proximity to line_start
        println!("\n--- Edge distances from line_start (2, 3, 0) ---");
        for i in 0..loop_verts.len() {
            let he_id = loop_hes[i];
            let edge_id = m.hes[he_id].edge();
            let edge = &m.edges[edge_id];
            let ea = m.vertex_pos(edge.v_small()).unwrap();
            let eb = m.vertex_pos(edge.v_large()).unwrap();
            let edge_dir = eb - ea;
            let edge_len_sq = edge_dir.length_squared();
            if edge_len_sq < 1e-20 { continue; }
            let t = ((line_start - ea).dot(edge_dir) / edge_len_sq).clamp(0.0, 1.0);
            let closest = ea + edge_dir * t;
            let dist = (line_start - closest).length();
            println!("  edge {} ({:?} → {:?}): t={:.4}, dist={:.2e}, FACE_TOLERANCE*100={:.2e}, pass={}",
                edge_id.raw(), ea, eb, t, dist, FACE_TOLERANCE * 100.0, dist < FACE_TOLERANCE * 100.0);
        }

        // Now actually attempt the split
        let result = split_face_by_line(&mut m, top_face, line_start, line_end);
        match &result {
            Ok(r) => {
                println!("\nSplit SUCCEEDED!");
                println!("  new_faces: {:?}", r.new_faces);
                println!("  new_verts: {:?}", r.new_verts);
                println!("  debug: {:?}", r.debug);
                assert_eq!(r.new_faces.len(), 2, "should create 2 faces");
            }
            Err(e) => {
                println!("\nSplit FAILED: {}", e);
                panic!("Face split failed on box top face: {}", e);
            }
        }
    }

    #[test]
    fn box_face_split_interior_points() {
        // Simulate what happens when Three.js raycast gives interior points
        // (user draws a line across the middle of the face, not snapped to edges)
        let mut m = Mesh::new();
        let (top_face, _) = make_box(&mut m, 4.0, 4.0, 3.0);

        println!("=== BOX FACE SPLIT: interior points (raycast scenario) ===");

        let outer_start = m.faces[top_face].outer().start;
        let loop_verts = m.collect_loop_verts(outer_start).unwrap();
        let loop_hes = m.collect_loop_hes(outer_start).unwrap();
        println!("Top face verts:");
        for (i, &vid) in loop_verts.iter().enumerate() {
            println!("  {:?}", m.vertex_pos(vid).unwrap());
        }

        // Interior points: (2, 3, 0.5) to (2, 3, 3.5)
        // These are INSIDE the face, not on any boundary edge
        let line_start = DVec3::new(2.0, 3.0, 0.5);
        let line_end = DVec3::new(2.0, 3.0, 3.5);

        println!("\nInterior split line: {:?} → {:?}", line_start, line_end);

        // Check closest edge for each point
        for (label, pt) in [("start", line_start), ("end", line_end)] {
            let mut closest_dist = f64::MAX;
            let mut closest_edge_info = String::new();
            for i in 0..loop_verts.len() {
                let he_id = loop_hes[i];
                let edge_id = m.hes[he_id].edge();
                let edge = &m.edges[edge_id];
                let ea = m.vertex_pos(edge.v_small()).unwrap();
                let eb = m.vertex_pos(edge.v_large()).unwrap();
                let edge_dir = eb - ea;
                let edge_len_sq = edge_dir.length_squared();
                if edge_len_sq < 1e-20 { continue; }
                let t = ((pt - ea).dot(edge_dir) / edge_len_sq).clamp(0.0, 1.0);
                let closest = ea + edge_dir * t;
                let dist = (pt - closest).length();
                if dist < closest_dist {
                    closest_dist = dist;
                    closest_edge_info = format!("edge {} ({:?}→{:?}) t={:.4} dist={:.6}", edge_id.raw(), ea, eb, t, dist);
                }
            }
            println!("  {} closest: {} (FACE_TOL*100={:.2e})", label, closest_edge_info, FACE_TOLERANCE * 100.0);
        }

        // Try the split — the fallback logic should snap interior points to closest edges
        let result = split_face_by_line(&mut m, top_face, line_start, line_end);
        match &result {
            Ok(r) => {
                println!("\nInterior split SUCCEEDED!");
                println!("  new_faces: {:?}", r.new_faces);
                println!("  new_verts: {:?}", r.new_verts);
                println!("  debug: {:?}", r.debug);
                assert_eq!(r.new_faces.len(), 2);
            }
            Err(e) => {
                println!("\nInterior split FAILED: {}", e);
                panic!("Interior face split failed: {}", e);
            }
        }
    }

    #[test]
    fn box_face_split_tolerance_analysis() {
        // Analyze tolerance thresholds for boundary point detection
        let mut m = Mesh::new();
        let (top_face, _) = make_box(&mut m, 4.0, 4.0, 3.0);

        println!("=== TOLERANCE ANALYSIS ===");
        println!("FACE_TOLERANCE = {:.2e}", FACE_TOLERANCE);
        println!("VERTEX_TOLERANCE = {:.2e}", VERTEX_TOLERANCE);
        println!("FACE_TOLERANCE * 100 = {:.2e} (boundary edge match)", FACE_TOLERANCE * 100.0);
        println!("VERTEX_TOLERANCE * 100 = {:.2e} (vertex match)", VERTEX_TOLERANCE * 100.0);

        let outer_start = m.faces[top_face].outer().start;
        let loop_verts = m.collect_loop_verts(outer_start).unwrap();
        let loop_hes = m.collect_loop_hes(outer_start).unwrap();

        // Test: exact boundary point at (2, 3, 0) — should be on edge
        let exact_boundary = DVec3::new(2.0, 3.0, 0.0);
        let bp = find_boundary_point(&m, top_face, exact_boundary, &loop_verts, &loop_hes, 1.0);
        println!("\nExact boundary point (2,3,0): {:?}", bp);

        // Test: point slightly off the face plane
        let offsets = [1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3];
        println!("\n--- Plane distance tolerance test ---");
        for off in offsets {
            let pt = DVec3::new(2.0, 3.0 + off, 0.0);
            let plane_dist = point_on_face_plane(&m, top_face, pt).unwrap();
            let on_plane = plane_dist.abs() < FACE_TOLERANCE;
            println!("  offset={:.0e}: plane_dist={:.2e}, on_plane={}", off, plane_dist.abs(), on_plane);
        }

        // Test: point near edge but at various distances
        // Edge from (0,3,0) to (4,3,0) — point at (2, 3, dist) for various dist
        println!("\n--- Edge proximity tolerance test (point offset from edge in Z) ---");
        let distances = [0.0, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 0.5];
        for d in distances {
            let pt = DVec3::new(2.0, 3.0, d);
            let bp = find_boundary_point(&m, top_face, pt, &loop_verts, &loop_hes, 1.0);
            let bp_type = match &bp {
                Ok(BoundaryPoint::ExistingVertex(vid)) => format!("ExistingVertex({})", vid.raw()),
                Ok(BoundaryPoint::OnEdge { edge_id, t, .. }) => format!("OnEdge(edge={}, t={:.4})", edge_id.raw(), t),
                Err(e) => format!("Error: {}", e),
            };
            println!("  dist_from_edge={:.0e}: {}", d, bp_type);
        }

        // The key question: with FACE_TOLERANCE*100 = 1e-4, a point 0.5 units from
        // the nearest edge will NOT match any boundary edge in the first pass (dist > 1e-4).
        // The fallback code at line 322-361 kicks in and snaps to the closest edge.
        // But the snapped point will be at (2, 3, 0) instead of (2, 3, 0.5).
        // This means the SPLIT LINE is changed from the user's intent!

        // Verify: what does the fallback produce for an interior point?
        let interior = DVec3::new(2.0, 3.0, 0.5);
        let bp = find_boundary_point(&m, top_face, interior, &loop_verts, &loop_hes, 1.0).unwrap();
        println!("\nInterior point (2,3,0.5) resolved to: {:?}", bp);
        match &bp {
            BoundaryPoint::OnEdge { position, .. } => {
                println!("  Snapped position: {:?}", position);
                println!("  Distance from original: {:.6}", (interior - *position).length());
            }
            BoundaryPoint::ExistingVertex(vid) => {
                let vpos = m.vertex_pos(*vid).unwrap();
                println!("  Snapped to vertex position: {:?}", vpos);
                println!("  Distance from original: {:.6}", (interior - vpos).length());
            }
        }

        // This should pass — the tolerance analysis itself is informational
        println!("\n=== CONCLUSION ===");
        println!("FACE_TOLERANCE*100 = {:.2e} is the threshold for 'on boundary' detection.", FACE_TOLERANCE * 100.0);
        println!("Points more than {:.2e} from any edge are treated as interior.", FACE_TOLERANCE * 100.0);
        println!("Interior points get SNAPPED to the nearest edge (fallback behavior).");
        println!("This changes the split line geometry but still produces a valid split.");
    }

    // ── Integration: split_face + push_pull ──────────────────────────

    #[test]
    fn split_face_then_pushpull_creates_protrusion() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let (fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // Split the square face into two rectangles using a line at x=2
        let line_start = DVec3::new(2.0, 0.0, 0.0);
        let line_end = DVec3::new(2.0, 0.0, 4.0);

        let split_result = split_face_by_line(&mut m, fid, line_start, line_end).unwrap();
        assert_eq!(split_result.new_faces.len(), 2);

        // Now push/pull one of the new faces — should CreateFace (flat face with no parallel edges)
        use crate::operations::push_pull::is_move_only;

        let face_a = split_result.new_faces[0];
        assert!(!is_move_only(&m, face_a), "split face should use CreateFace mode");

        // Push/Pull should create a new box/protrusion
        let faces_before = m.face_count();
        let pp = m.push_pull(face_a, 2.0, mat).unwrap();
        let faces_after = m.face_count();

        assert!(faces_after > faces_before, "push/pull should create new faces");
        assert!(!pp.side_faces.is_empty(), "should have side walls");
    }
}
