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

    // ─── Step 1: Determine where line endpoints touch the face boundary ─
    let outer_start = mesh.faces[face_id].outer().start;
    let loop_verts = mesh.collect_loop_verts(outer_start)?;
    let loop_hes = mesh.collect_loop_hes(outer_start)?;
    // For each endpoint, find: either an existing vertex, or a point on an edge
    let split_v1 = find_boundary_point(mesh, face_id, line_start, &loop_verts, &loop_hes)?;
    let split_v2 = find_boundary_point(mesh, face_id, line_end, &loop_verts, &loop_hes)?;

    debug.push(format!("split_v1: {:?}", split_v1));
    debug.push(format!("split_v2: {:?}", split_v2));

    // ─── Step 2: Realize the boundary points as actual vertices ─────────
    // If a point is on an edge, split that edge to create the vertex.
    // Process in reverse order to avoid invalidating the second point
    // when splitting an edge for the first point.

    // We need to handle the case where both points are on the same edge
    let v1 = realize_boundary_point(mesh, &split_v1, &mut new_verts, &mut new_edges, &mut debug)?;
    // After edge split, face_id may still be valid (split_edge preserves faces)
    let v2 = realize_boundary_point(mesh, &split_v2, &mut new_verts, &mut new_edges, &mut debug)?;

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
/// Checks vertices first (within tolerance), then edges.
fn find_boundary_point(
    mesh: &Mesh,
    _face_id: FaceId,
    point: DVec3,
    loop_verts: &[VertId],
    loop_hes: &[HeId],
) -> Result<BoundaryPoint> {
    let n = loop_verts.len();

    // Check if point coincides with an existing vertex
    for &vid in loop_verts {
        let vpos = mesh.vertex_pos(vid)?;
        if (vpos - point).length() < VERTEX_TOLERANCE * 100.0 {
            return Ok(BoundaryPoint::ExistingVertex(vid));
        }
    }

    // Check each boundary edge for closest approach
    let mut best_edge: Option<(EdgeId, DVec3, f64, f64)> = None; // (edge_id, pos, t, dist)

    for i in 0..n {
        let he_id = loop_hes[i];
        let edge_id = mesh.hes[he_id].edge();

        let edge = &mesh.edges[edge_id];
        let ea = mesh.vertex_pos(edge.v_small())?;
        let eb = mesh.vertex_pos(edge.v_large())?;

        // Project point onto edge segment
        let edge_dir = eb - ea;
        let edge_len_sq = edge_dir.length_squared();
        if edge_len_sq < 1e-20 { continue; }

        let t = (point - ea).dot(edge_dir) / edge_len_sq;
        let t_clamped = t.clamp(0.0, 1.0);
        let closest = ea + edge_dir * t_clamped;
        let dist = (point - closest).length();

        // Skip if too close to endpoints (will snap to vertex instead)
        if t_clamped < 0.01 || t_clamped > 0.99 {
            continue;
        }

        if dist < FACE_TOLERANCE * 100.0 {
            if best_edge.is_none() || dist < best_edge.as_ref().unwrap().3 {
                best_edge = Some((edge_id, closest, t_clamped, dist));
            }
        }
    }

    if let Some((edge_id, pos, t, _dist)) = best_edge {
        return Ok(BoundaryPoint::OnEdge { edge_id, position: pos, t });
    }

    // Point is not on any boundary — this might be an internal point
    // For now, find the closest edge and snap to it
    let mut closest_edge: Option<(EdgeId, DVec3, f64, f64)> = None;

    for i in 0..n {
        let he_id = loop_hes[i];
        let edge_id = mesh.hes[he_id].edge();
        let edge = &mesh.edges[edge_id];
        let ea = mesh.vertex_pos(edge.v_small())?;
        let eb = mesh.vertex_pos(edge.v_large())?;

        let edge_dir = eb - ea;
        let edge_len_sq = edge_dir.length_squared();
        if edge_len_sq < 1e-20 { continue; }

        let t = ((point - ea).dot(edge_dir) / edge_len_sq).clamp(0.0, 1.0);
        let closest = ea + edge_dir * t;
        let dist = (point - closest).length();

        if t > 0.01 && t < 0.99 {
            if closest_edge.is_none() || dist < closest_edge.as_ref().unwrap().3 {
                closest_edge = Some((edge_id, closest, t, dist));
            }
        }
    }

    if let Some((edge_id, pos, t, _)) = closest_edge {
        Ok(BoundaryPoint::OnEdge { edge_id, position: pos, t })
    } else {
        // Snap to nearest vertex as last resort
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
        // Original face should be removed
        assert!(!m.faces.contains(fid));
        // Two new triangles
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
