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
use anyhow::{Result, bail, ensure};

use crate::entities::*;
use crate::mesh::Mesh;
use crate::tolerances::*;

/// **K1 hotfix (보고서 시나리오 1, 2026-05-23)** — closed-curve face 자동
/// polygonize helper. Path B closed-curve face (1 anchor + 1 self-loop
/// edge) 는 split 함수 polygon ≥3 verts 가정 위반 → 사용자 demo silent
/// failure. 본 helper 는 진입 시 closed-curve face detect → polygonize
/// 자동 호출 → polygon mode 변환 + new face_id 반환.
///
/// ADR-105 R-α (tessellate closed-curve face in place) 패턴 답습.
///
/// Returns: original face_id if not closed-curve, or new face_id after
/// polygonize. `polygonize_closed_curve_face` returns `Ok(None)` if the
/// face already has polygonal boundary (>1 vert) — in that case we keep
/// the original face_id.
pub(crate) fn polygonize_if_closed_curve(
    mesh: &mut Mesh,
    face_id: FaceId,
) -> Result<FaceId> {
    // Detect closed-curve face: 1-vert boundary loop (anchor + self-loop edge).
    let is_closed_curve = {
        let face = match mesh.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return Ok(face_id),  // inactive — let caller error out
        };
        let outer_start = face.outer().start;
        if outer_start.is_null() {
            return Ok(face_id);
        }
        match mesh.collect_loop_verts(outer_start) {
            Ok(verts) => verts.len() == 1,
            Err(_) => false,
        }
    };

    if !is_closed_curve {
        return Ok(face_id);
    }

    // Polygonize closed-curve face → polygon mode.
    let material = mesh.faces[face_id].material();
    match mesh.polygonize_closed_curve_face(face_id, material)? {
        Some(new_face_id) => Ok(new_face_id),
        None => Ok(face_id),  // unsupported curve type — caller may error
    }
}

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

    // Ray casting algorithm (point-in-polygon) — outer loop
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

    // Phase F — 구멍 안에 있으면 면 '내부'가 아님
    if inside {
        for inner in face.inners() {
            if inner.start.is_null() { continue; }
            let hole_verts = match mesh.collect_loop_verts(inner.start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let mut in_hole = false;
            let h = hole_verts.len();
            if h < 3 { continue; }
            let mut j = h - 1;
            for i in 0..h {
                let pi = mesh.vertex_pos(hole_verts[i])?;
                let pj = mesh.vertex_pos(hole_verts[j])?;
                let yi = component(pi, ax2);
                let yj = component(pj, ax2);
                let xi = component(pi, ax1);
                let xj = component(pj, ax1);
                if ((yi > py) != (yj > py)) &&
                   (px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
                    in_hole = !in_hole;
                }
                j = i;
            }
            if in_hole {
                return Ok(false); // hole 내부 → face 외부로 판정
            }
        }
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
    // ─── Geometric Validity Guards (ADR-003) ───────────────────────────
    ensure!(
        line_start.x.is_finite() && line_start.y.is_finite() && line_start.z.is_finite(),
        "split_face_by_line: line_start must be finite, got {:?}",
        line_start
    );
    ensure!(
        line_end.x.is_finite() && line_end.y.is_finite() && line_end.z.is_finite(),
        "split_face_by_line: line_end must be finite, got {:?}",
        line_end
    );
    let line_len = (line_end - line_start).length();
    ensure!(
        line_len >= crate::tolerances::EPSILON_LENGTH,
        "split_face_by_line: line length {:.2e} below EPSILON_LENGTH ({:.2e}) — \
         would create degenerate split (ADR-003)",
        line_len,
        crate::tolerances::EPSILON_LENGTH
    );

    ensure!(mesh.faces.contains(face_id), "Face {:?} not found", face_id);

    // **K1 hotfix (보고서 시나리오 1, 2026-05-23) — closed-curve face 자동
    // polygonize** — Path B closed-curve face (1 anchor + 1 self-loop edge)
    // 는 split 함수 polygon ≥3 verts 가정 위반 → silent failure 발생
    // (사용자 시연 evidence "Both split points resolved to same vertex" /
    //  "Point is 20218.2384 from face plane").
    // K1 hotfix: 진입 시 closed-curve face detect → polygonize 자동 호출
    // → polygon mode 로 변환 후 split 진행. ADR-105 R-α (tessellate
    // closed-curve face in place) 패턴 답습.
    let face_id = polygonize_if_closed_curve(mesh, face_id)?;

    // Phase G — multi-loop split support.
    //
    // Case (a) supported here: the cutting line lies entirely inside the
    // outer boundary and does not intersect any hole. Each hole is
    // redistributed to whichever of the two resulting faces geometrically
    // contains it (point-in-face test on a hole sample vertex).
    //
    // Not yet handled (rejected with explicit error): the line crossing a
    // hole boundary, or an endpoint landing strictly inside a hole — those
    // require splitting the hole loop itself or bridging hole↔outer.
    let saved_holes = save_hole_loops(mesh, face_id)?;

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

    // ─── Step 0.5: Early case (c) detection ────────────────────────────
    // If exactly one endpoint is strictly inside exactly one hole and no
    // holes are crossed, we take the "bridge" route — one endpoint can't
    // be resolved via find_boundary_point on outer (it's in void), so we
    // dispatch here before the normal outer-resolution step fails.
    if !saved_holes.is_empty() {
        // ─── Step 0.5a: ADR-023 P8 case (d) — BEFORE case (c) ──────────────
        // Endpoint exactly on hole boundary (vertex or edge). Must run before
        // case (c) because point_inside_loop_3d is undefined for boundary
        // points — ray casting may classify them as inside, mis-dispatching
        // to case (c) which then fails with "expected 1 hole crossing".
        let snap_tol_d = face_diag * 0.02;
        if let Some((hole_idx, which_end, hole_bp)) =
            detect_case_d(mesh, proj_start, proj_end, &saved_holes, snap_tol_d)?
        {
            return split_face_case_d(
                mesh, face_id,
                proj_start, proj_end,
                which_end, hole_idx, hole_bp,
                &saved_holes,
                &loop_verts, &loop_hes, face_diag,
                new_verts, new_edges, debug,
            );
        }

        // ─── Step 0.5b: case (c) — endpoint strictly inside hole ──────────
        let early_classifications = classify_holes(mesh, proj_start, proj_end, &saved_holes)?;
        let case_c_match = detect_case_c(&early_classifications);
        if let Some((hole_idx, which_end)) = case_c_match {
            return split_face_case_c(
                mesh, face_id,
                proj_start, proj_end,
                which_end,
                &saved_holes, hole_idx,
                &early_classifications,
                &loop_verts, &loop_hes, face_diag,
                new_verts, new_edges, debug,
            );
        }
    }

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
    let split_v2_resolved = if let BoundaryPoint::OnEdge { edge_id, position, t: _ } = &split_v2_final {
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

    // ─── Step 2.5: Classify each hole vs. the cutting line ─────────────
    // Possible outcomes per hole:
    //   Clear        — safely redistribute by containment (case a)
    //   Crossed(2)   — hole is "eaten" by the cut (case b)
    //   Inside       — endpoint lies strictly inside (case c, not supported)
    //   Ambiguous    — tangent or odd crossing count (not supported)
    let classifications = classify_holes(mesh, proj_start, proj_end, &saved_holes)?;

    // Decision tree: which Phase G branch?
    let mut crossed_indices: Vec<usize> = Vec::new();
    for (i, c) in classifications.iter().enumerate() {
        match c {
            HoleClassification::Clear => {}
            HoleClassification::Crossed(pts) if pts.len() == 2 => {
                crossed_indices.push(i);
            }
            HoleClassification::Crossed(pts) => {
                bail!(
                    "split_face_by_line: line has {} intersections with a hole — \
                     tangent/odd crossings not supported",
                    pts.len()
                );
            }
            HoleClassification::InsideStart | HoleClassification::InsideEnd => {
                // Should have been handled by Step 0.5 early dispatcher; if
                // we got here it means the endpoint-inside condition was
                // combined with other crossings, which we don't yet support.
                bail!(
                    "split_face_by_line: endpoint inside a hole combined with \
                     other hole crossings on face {} — mixed case c+b not supported",
                    face_id.raw()
                );
            }
            HoleClassification::InsideBoth => {
                bail!(
                    "split_face_by_line: both endpoints inside the same hole on \
                     face {} — zero-length cut in void",
                    face_id.raw()
                );
            }
            HoleClassification::Ambiguous(reason) => {
                bail!("split_face_by_line: ambiguous hole interaction — {}", reason);
            }
        }
    }

    // ─── Case (b): one or more holes are crossed — "hole-eaten" reconstruction ──
    if !crossed_indices.is_empty() {
        return split_face_case_b(
            mesh, face_id,
            v1, v2,
            &saved_holes, &crossed_indices, &classifications,
            proj_start, proj_end,
            new_verts, new_edges, debug,
        );
    }

    // ─── Case (a): no hole crossed — redistribute by containment ────────
    // Temporarily detach saved hole refs from the face so mesh.split_face
    // operates on a clean outer-only topology. The hole half-edges remain
    // in the mesh — we re-attach after the split below.
    if !saved_holes.is_empty() {
        mesh.faces[face_id].inners_mut().clear();
        // ADR-061 Step 2 — escape-hatch bump for inners_mut.
        mesh.faces[face_id].bump_boundary_version_after_inners_mut();
    }

    // ─── Step 3: Split the face ─────────────────────────────────────────
    let (face_a, face_b) = mesh.split_face(face_id, v1, v2)?;

    // Track the new split edge
    if let Some(eid) = mesh.find_edge(v1, v2) {
        new_edges.push(eid);
    }

    debug.push(format!("result: face_a={}, face_b={}", face_a.raw(), face_b.raw()));

    // ─── Step 4: Redistribute holes between the two resulting faces ─────
    if !saved_holes.is_empty() {
        for hole in &saved_holes {
            let sample = mesh.vertex_pos(hole.sample_vert)?;
            let in_a = point_in_face(mesh, face_a, sample).unwrap_or(false);
            let target = if in_a { face_a } else { face_b };
            debug.push(format!(
                "hole start={} → face {} (in_a={})",
                hole.loop_ref.start.raw(),
                target.raw(),
                in_a,
            ));
            if target != face_id {
                reassign_loop_face(mesh, hole.loop_ref.start, target)?;
            }
            mesh.faces[target].add_inner(hole.loop_ref);
        }
    }

    Ok(FaceSplitResult {
        new_faces: vec![face_a, face_b],
        new_verts,
        new_edges,
        debug,
    })
}

/// ADR-008 Axiom 7 (B2 Mixed-Cycle Split) — split a face along a chain of
/// existing free edges whose endpoints lie on the face's boundary.
///
/// The caller draws a polyline that enters the face at one boundary vertex,
/// traverses the interior via ≥1 intermediate vertices, and exits at a
/// second boundary vertex. Those edges were just added as free edges by the
/// drawLine pipeline; this function consumes them and produces two new
/// sub-faces that share the chain as their common seam.
///
/// # Arguments
/// * `face_id`          — the face being split. Will be dissolved.
/// * `chain_verts`      — ordered vertex IDs of the cutting polyline.
///                        `chain[0]` and `chain[last]` must be on the
///                        `face_id` outer boundary; intermediate verts
///                        must NOT be on the boundary (strict interior).
///                        The edges between consecutive chain verts must
///                        already exist in the mesh.
/// * `inherit_material` — the material to stamp onto *both* resulting
///                        sub-faces. B1 decision chose "new RECT's material
///                        wins"; the caller passes the draw operation's
///                        current material.
///
/// # Algorithm
/// 1. Walk the face's outer loop to find the two positions where chain
///    endpoints attach. Assert both are boundary vertices (not interior).
/// 2. Build sub-face A's vertex sequence:
///       chain[0], chain[1], …, chain[last],
///       boundary from chain[last] walking forward → chain[0]
/// 3. Build sub-face B's vertex sequence:
///       chain[last], chain[last-1], …, chain[0],
///       boundary from chain[0] walking forward → chain[last]
/// 4. Soft-remove `face_id` so the existing HEs (both outer + chain) are
///    detached from the old face but stay wired for `make_loop` to reuse.
/// 5. Create two new faces via `add_face_with_holes` — existing holes on
///    `face_id` (if any) are redistributed by containment, exactly like
///    Phase G case (a) but using the chain instead of a straight line.
///
/// # Failure modes
/// * Chain endpoints not both on boundary → `Err`
/// * Intermediate chain vertex on boundary → `Err` (would require
///   multi-seam split, not handled).
/// * Edges between consecutive chain verts missing → `Err`.
pub fn split_face_by_chain(
    mesh: &mut Mesh,
    face_id: FaceId,
    chain_verts: &[VertId],
    inherit_material: MaterialId,
) -> Result<FaceSplitResult> {
    ensure!(
        chain_verts.len() >= 2,
        "split_face_by_chain: chain needs ≥2 vertices, got {}",
        chain_verts.len()
    );
    ensure!(mesh.faces.contains(face_id), "Face {:?} not found", face_id);

    let outer_start = mesh.faces[face_id].outer().start;
    let outer_boundary = mesh.collect_loop_verts(outer_start)?;
    ensure!(outer_boundary.len() >= 3, "face boundary has <3 verts");

    // Locate chain[0] and chain[last]. They may be on the OUTER boundary or
    // on one of the INNER (hole) loops. We pick the first loop that contains
    // both endpoints (must be the same loop — chain bridging two loops is not
    // supported here).
    let start = chain_verts[0];
    let end = *chain_verts.last().unwrap();

    let pos_on = |loop_verts: &[VertId], v: VertId| -> Option<usize> {
        loop_verts.iter().position(|&x| x == v)
    };

    // Try outer first.
    let mut chosen_loop_verts: Vec<VertId> = outer_boundary.clone();
    let mut i_start_opt = pos_on(&chosen_loop_verts, start);
    let mut i_end_opt = pos_on(&chosen_loop_verts, end);
    let mut chosen_is_inner = false;

    if i_start_opt.is_none() || i_end_opt.is_none() {
        // Search inner loops for a loop containing both endpoints.
        let inners = mesh.faces[face_id].inners().to_vec();
        for inner in &inners {
            if inner.start.is_null() { continue; }
            let inner_verts = match mesh.collect_loop_verts(inner.start) {
                Ok(v) => v, Err(_) => continue,
            };
            let pa = pos_on(&inner_verts, start);
            let pb = pos_on(&inner_verts, end);
            if pa.is_some() && pb.is_some() {
                chosen_loop_verts = inner_verts;
                i_start_opt = pa;
                i_end_opt = pb;
                chosen_is_inner = true;
                break;
            }
        }
    }

    let i_start = i_start_opt.ok_or_else(|| {
        anyhow::anyhow!(
            "split_face_by_chain: chain start vert {} not on any loop of face {}",
            start.raw(), face_id.raw(),
        )
    })?;
    let i_end = i_end_opt.ok_or_else(|| {
        anyhow::anyhow!(
            "split_face_by_chain: chain end vert {} not on any loop of face {}",
            end.raw(), face_id.raw(),
        )
    })?;
    let n_b = chosen_loop_verts.len();
    let boundary = chosen_loop_verts;
    ensure!(i_start != i_end, "chain endpoints collapsed to same loop vert");

    // Intermediate chain verts must NOT be on the chosen loop.
    for (i, &v) in chain_verts.iter().enumerate().take(chain_verts.len() - 1).skip(1) {
        if boundary.contains(&v) {
            bail!(
                "split_face_by_chain: intermediate chain vert {} at index {} is on chosen loop — \
                 would require multi-seam split (not supported)",
                v.raw(), i,
            );
        }
    }

    // 2026-04-28 — chain endpoints on INNER (hole) loop: not yet implemented in
    //   the split_into_two-simple-faces path below. The correct topology
    //   would produce one simple face (chain area) + one face-with-hole (rest).
    //   Bail with a clear message so caller can route to the alternate fix.
    if chosen_is_inner {
        bail!(
            "split_face_by_chain: chain endpoints on inner (hole) loop of face {} — \
             not yet supported (would need face-with-hole split)",
            face_id.raw(),
        );
    }

    // Chain edges must exist.
    for w in chain_verts.windows(2) {
        let (a, b) = (w[0], w[1]);
        if mesh.find_edge(a, b).is_none() {
            bail!(
                "split_face_by_chain: edge between verts {} and {} missing — caller must draw it first",
                a.raw(), b.raw(),
            );
        }
    }

    // Preserve and detach existing hole loops (same as split_face_by_line
    //   case (a) — they get redistributed after the split).
    let saved_holes = save_hole_loops(mesh, face_id)?;

    // Build the two sub-face vertex sequences.
    //   A: chain[0..=last] + boundary walked from i_end → i_start (skipping
    //      end & start, which are already in the chain).
    //   B: chain reversed + boundary walked from i_start → i_end.
    let mut face_a_verts: Vec<VertId> = chain_verts.to_vec();
    {
        let mut i = (i_end + 1) % n_b;
        while i != i_start {
            face_a_verts.push(boundary[i]);
            i = (i + 1) % n_b;
        }
    }

    let mut face_b_verts: Vec<VertId> = chain_verts.iter().rev().copied().collect();
    {
        let mut i = (i_start + 1) % n_b;
        while i != i_end {
            face_b_verts.push(boundary[i]);
            i = (i + 1) % n_b;
        }
    }

    ensure!(face_a_verts.len() >= 3, "face A has <3 verts — degenerate split");
    ensure!(face_b_verts.len() >= 3, "face B has <3 verts — degenerate split");

    // Fix 3 (2026-04-24) — pre-flight validity guard.
    //
    // If either sub-face's vertex sequence has duplicates, the resulting
    // outer boundary would be self-intersecting (figure-8 topology).
    // That happens when the original face has a hole loop that shares
    // a valence≥3 vertex with the chain — the boundary walk picks up
    // hole HEs through the shared vertex. Rather than build an invalid
    // polygon, refuse the split and leave the original face intact.
    // Caller (Step 4.9 M1) treats Err as "no split, move on".
    let has_dup_a = {
        let mut seen = std::collections::HashSet::new();
        face_a_verts.iter().any(|v| !seen.insert(*v))
    };
    let has_dup_b = {
        let mut seen = std::collections::HashSet::new();
        face_b_verts.iter().any(|v| !seen.insert(*v))
    };
    if has_dup_a || has_dup_b {
        bail!(
            "split_face_by_chain: sub-face boundary has duplicate vertex — \
             chain interacts with a hole loop; aborting to avoid self-intersection \
             (face_a_dup={} face_b_dup={})",
            has_dup_a, has_dup_b,
        );
    }

    // 2026-04-28 — ADR-007 Invariant 2 (Winding) guard.
    //   `find_first_left_turn_path` 가 chain 을 face 의 CCW outer 방향과
    //   반대로 walk 한 경우, face_a 또는 face_b 한 쪽이 CW 로 만들어져
    //   normal 이 -Z 로 뒤집힌다. CAD single-sided 렌더에서 안 보임 (사용자
    //   2026-04-28 보고). 사전에 2D signed area 를 검사해 CW 면 vertex 순서
    //   를 reverse → add_face_with_holes 가 CCW 좌표로 face 생성.
    //
    //   Plane basis: original face 의 normal 로부터 (e1, e2) 정사영. 좌표
    //   값은 normal 평행 성분을 제거한 2D 다각형. signed area 음수 → CW.
    {
        let face_normal = mesh.faces[face_id].normal();
        if face_normal.length_squared() > 1e-12 {
            let n = face_normal.normalize();
            let seed = if n.x.abs() < 0.9 { glam::DVec3::X } else { glam::DVec3::Y };
            let e1 = seed.cross(n).normalize_or_zero();
            let e2 = n.cross(e1).normalize_or_zero();
            if e1.length_squared() > 1e-12 && e2.length_squared() > 1e-12 {
                let signed_area_2d = |verts: &[VertId]| -> f64 {
                    let mut a = 0.0_f64;
                    let n_v = verts.len();
                    for i in 0..n_v {
                        let p = match mesh.vertex_pos(verts[i]) { Ok(p) => p, Err(_) => return 0.0 };
                        let q = match mesh.vertex_pos(verts[(i + 1) % n_v]) { Ok(p) => p, Err(_) => return 0.0 };
                        let (px, py) = (p.dot(e1), p.dot(e2));
                        let (qx, qy) = (q.dot(e1), q.dot(e2));
                        a += px * qy - qx * py;
                    }
                    a * 0.5
                };
                if signed_area_2d(&face_a_verts) < 0.0 {
                    face_a_verts.reverse();
                }
                if signed_area_2d(&face_b_verts) < 0.0 {
                    face_b_verts.reverse();
                }
            }
        }
    }

    // Soft-remove the old face. Preserves HE next/prev so add_face_with_holes
    //   can rediscover the free HEs. Temporarily clears inners so the
    //   soft_remove doesn't touch hole HEs (we'll reattach to whichever
    //   sub-face contains each hole afterwards).
    // ADR-089 A-χ-β — capture parent surface before soft_remove.
    let parent_surface = mesh.faces[face_id].surface().cloned();
    // K3 (보고서 시나리오 3 hotfix, 2026-05-23) — capture parent surface
    // owner_id before soft_remove. Path A cylinder Push/Pull 후 split 시
    // owner-ID propagation 부재로 측면 group N-1 face 만 선택되는 회귀
    // 해소. ADR-089 A-χ-β 패턴 답습.
    let parent_owner = mesh.face_surface_owner_id(face_id);
    mesh.faces[face_id].inners_mut().clear();
    mesh.soft_remove_face(face_id)?;

    // Rebuild two sub-faces with the requested material (Axiom 7 — new RECT
    //   wins over container's original material).
    let fa = mesh.add_face_with_holes(&face_a_verts, &[], inherit_material)?;
    let fb = mesh.add_face_with_holes(&face_b_verts, &[], inherit_material)?;
    // ADR-089 A-χ-β — propagate parent surface to both sub-faces.
    if let Some(ref s) = parent_surface {
        mesh.faces[fa].set_surface(Some(s.clone()));
        mesh.faces[fb].set_surface(Some(s.clone()));
    }
    // K3 — propagate parent surface owner_id to both sub-faces.
    if let Some(owner) = parent_owner {
        mesh.set_face_surface_owner_id(fa, Some(owner));
        mesh.set_face_surface_owner_id(fb, Some(owner));
    }

    // Redistribute any holes by containment, mirroring split_face_by_line.
    for hole in &saved_holes {
        let sample = mesh.vertex_pos(hole.sample_vert)?;
        let in_a = point_in_face(mesh, fa, sample).unwrap_or(false);
        let target = if in_a { fa } else { fb };
        if !hole.loop_ref.start.is_null() {
            reassign_loop_face(mesh, hole.loop_ref.start, target)?;
        }
        mesh.faces[target].add_inner(hole.loop_ref);
    }

    let mut new_edges: Vec<EdgeId> = Vec::with_capacity(chain_verts.len() - 1);
    for w in chain_verts.windows(2) {
        if let Some(eid) = mesh.find_edge(w[0], w[1]) {
            new_edges.push(eid);
        }
    }

    // ADR-101 Amendment 10 — 메타-원칙 #15 cross-cut enforcement.
    // split-induced chain edges 에 HARD flag 부여. render path 의 angle
    // coplanar test (LOCKED #16 K-ε hotfix) 우회 → split edges 가 coplanar
    // sub-faces 사이여도 wireframe emit. `Mesh::split_face` (mesh.rs:4068-
    // 4069) canonical pattern + ADR-101 Amendment 9 §A9.4 cross-cut audit
    // 의 자연 enforcement.
    mesh.mark_chain_edges_hard(chain_verts);

    Ok(FaceSplitResult {
        new_faces: vec![fa, fb],
        new_verts: Vec::new(),
        new_edges,
        debug: vec![format!(
            "split_face_by_chain: face {} → {} + {} (chain len {})",
            face_id.raw(), fa.raw(), fb.raw(), chain_verts.len(),
        )],
    })
}

/// Classification outcome for one hole vs. the cutting line.
enum HoleClassification {
    /// No interaction; hole gets redistributed by containment.
    Clear,
    /// Cutting line crosses this hole's boundary. Carries (segment index,
    /// 3D intersection position) for each crossing, in hole-loop order.
    Crossed(Vec<(usize, DVec3)>),
    /// proj_start lies strictly inside this hole (Phase G case c).
    InsideStart,
    /// proj_end lies strictly inside this hole (Phase G case c).
    InsideEnd,
    /// Both endpoints inside the same hole — reject (zero-length cut in void).
    InsideBoth,
    /// Unusual geometric configuration we don't handle.
    /// Reserved for future Phase G expansion.
    #[allow(dead_code)]
    Ambiguous(String),
}

fn classify_holes(
    mesh: &Mesh,
    proj_start: DVec3,
    proj_end: DVec3,
    saved_holes: &[SavedHole],
) -> Result<Vec<HoleClassification>> {
    let mut out = Vec::with_capacity(saved_holes.len());
    for hole in saved_holes {
        let verts = mesh.collect_loop_verts(hole.loop_ref.start)?;
        let s_in = point_inside_loop_3d(mesh, &verts, proj_start)?;
        let e_in = point_inside_loop_3d(mesh, &verts, proj_end)?;
        if s_in && e_in {
            out.push(HoleClassification::InsideBoth);
            continue;
        }
        if s_in { out.push(HoleClassification::InsideStart); continue; }
        if e_in { out.push(HoleClassification::InsideEnd);   continue; }
        let crossings = find_loop_crossings_3d(mesh, &verts, proj_start, proj_end)?;
        out.push(match crossings.len() {
            0 => HoleClassification::Clear,
            2 => HoleClassification::Crossed(crossings),
            n => HoleClassification::Crossed(vec![(0, DVec3::ZERO); n]),
        });
    }
    Ok(out)
}

/// For each segment of the loop (verts[i] → verts[(i+1)%n]), compute a
/// proper 2D crossing with (a,b). Returns `(i, world_position)` of each
/// crossing in hole-segment order.
fn find_loop_crossings_3d(
    mesh: &Mesh,
    loop_verts: &[VertId],
    a: DVec3,
    b: DVec3,
) -> Result<Vec<(usize, DVec3)>> {
    if loop_verts.len() < 3 { return Ok(vec![]); }
    let (origin, u, v) = loop_basis(mesh, loop_verts)?;
    let a2 = project_to_basis(a, origin, u, v);
    let b2 = project_to_basis(b, origin, u, v);
    let pts_3d: Vec<DVec3> = loop_verts.iter()
        .map(|&vid| mesh.vertex_pos(vid).unwrap_or(origin))
        .collect();
    let pts_2d: Vec<_> = pts_3d.iter()
        .map(|&p| project_to_basis(p, origin, u, v))
        .collect();

    let mut out = Vec::new();
    for i in 0..pts_2d.len() {
        let p = pts_2d[i];
        let q = pts_2d[(i + 1) % pts_2d.len()];
        if segments_cross_2d(a2, b2, p, q) {
            // Compute intersection parameter along the hole segment (p,q),
            // then interpolate in 3D.
            let t = segment_cross_t(a2, b2, p, q);
            let p3 = pts_3d[i];
            let q3 = pts_3d[(i + 1) % pts_3d.len()];
            let world = p3 + (q3 - p3) * t;
            out.push((i, world));
        }
    }
    Ok(out)
}

/// Parameter `t` (in [0,1]) such that the crossing point on segment (p,q)
/// is `p + (q-p)*t`. Assumes segments_cross_2d already returned true.
fn segment_cross_t(
    a: crate::operations::boolean_geo::Pt2,
    b: crate::operations::boolean_geo::Pt2,
    p: crate::operations::boolean_geo::Pt2,
    q: crate::operations::boolean_geo::Pt2,
) -> f64 {
    // Solve for t where (a + s*(b-a)) == (p + t*(q-p)).
    // t = cross(a-p, b-a) / cross(q-p, b-a)
    let rx = b.x - a.x; let ry = b.y - a.y;
    let sx = q.x - p.x; let sy = q.y - p.y;
    let denom = sx * ry - sy * rx;
    if denom.abs() < 1e-12 { return 0.5; }
    let num = (a.x - p.x) * ry - (a.y - p.y) * rx;
    (num / denom).clamp(0.0, 1.0)
}

/// Phase G case (b), multi-hole generalization — cutting line crosses
/// outer twice and N ≥ 1 holes twice each. Every crossed hole is
/// consumed; each output face gets one arc of each crossed hole woven
/// into its outer boundary in the order the cut encounters them.
///
/// Non-crossed ("clear") holes are redistributed between the two
/// output faces by geometric containment.
fn split_face_case_b(
    mesh: &mut Mesh,
    face_id: FaceId,
    outer_a: VertId,
    outer_b: VertId,
    saved_holes: &[SavedHole],
    crossed_indices: &[usize],
    classifications: &[HoleClassification],
    proj_start: DVec3,
    _proj_end: DVec3,
    mut new_verts: Vec<VertId>,
    mut new_edges: Vec<EdgeId>,
    mut debug: Vec<String>,
) -> Result<FaceSplitResult> {
    debug.push(format!(
        "case (b): {} hole(s) crossed",
        crossed_indices.len(),
    ));

    // ── Realize all hole-boundary crossings as real vertices ───────────
    // One entry per crossed hole. Each holds (hole_index_in_saved_holes,
    // realized V closer to A, realized V closer to B).
    struct CrossedHole {
        saved_idx: usize,
        h_a: VertId, // closer to outer_a along cut
        h_b: VertId, // closer to outer_b along cut
    }
    let a_pos = mesh.vertex_pos(outer_a)?;
    let b_pos = mesh.vertex_pos(outer_b)?;
    let cut_dir = b_pos - a_pos;
    let cut_len_sq = cut_dir.length_squared().max(1e-12);
    let t_for_pos = |p: DVec3| (p - a_pos).dot(cut_dir) / cut_len_sq;

    let mut crossed: Vec<CrossedHole> = Vec::with_capacity(crossed_indices.len());
    for &saved_idx in crossed_indices {
        let crossings = match &classifications[saved_idx] {
            HoleClassification::Crossed(c) => c.clone(),
            _ => unreachable!(),
        };
        debug_assert_eq!(crossings.len(), 2);
        let mut realized = [VertId::NULL; 2];
        for (k, (seg_idx, pos)) in crossings.iter().enumerate() {
            let hole_start_now = mesh.faces[face_id].inners()[saved_idx].start;
            let loop_verts = mesh.collect_loop_verts(hole_start_now)?;
            let (eid, _t) = find_hole_edge_containing(mesh, &loop_verts, *seg_idx, *pos)?;
            let (new_v, e1, e2) = mesh.split_edge(eid, *pos)?;
            new_verts.push(new_v);
            new_edges.push(e1);
            new_edges.push(e2);
            realized[k] = new_v;
            debug.push(format!(
                "  hole[{}] crossing {} at edge {} → v{}",
                saved_idx, seg_idx, eid.raw(), new_v.raw(),
            ));
        }
        let p0 = mesh.vertex_pos(realized[0])?;
        let p1 = mesh.vertex_pos(realized[1])?;
        let (h_a, h_b) = if t_for_pos(p0) <= t_for_pos(p1) {
            (realized[0], realized[1])
        } else {
            (realized[1], realized[0])
        };
        crossed.push(CrossedHole { saved_idx, h_a, h_b });
    }

    // Sort crossed holes along the cut direction by h_a's parameter.
    // This gives us the order in which the line enters each hole.
    crossed.sort_by(|x, y| {
        let tx = t_for_pos(mesh.vertex_pos(x.h_a).unwrap_or(a_pos));
        let ty = t_for_pos(mesh.vertex_pos(y.h_a).unwrap_or(a_pos));
        tx.partial_cmp(&ty).unwrap_or(std::cmp::Ordering::Equal)
    });

    // ── Collect updated outer + each crossed-hole loop ─────────────────
    let updated_outer = mesh.collect_loop_verts(mesh.faces[face_id].outer().start)?;
    ensure!(
        updated_outer.contains(&outer_a) && updated_outer.contains(&outer_b),
        "case (b): outer loop lost A/B after edge split",
    );
    let mut updated_holes: Vec<Vec<VertId>> = Vec::with_capacity(crossed.len());
    for ch in &crossed {
        let start = mesh.faces[face_id].inners()[ch.saved_idx].start;
        let verts = mesh.collect_loop_verts(start)?;
        ensure!(
            verts.contains(&ch.h_a) && verts.contains(&ch.h_b),
            "case (b): hole[{}] lost crossing verts after split",
            ch.saved_idx,
        );
        updated_holes.push(verts);
    }

    // ── Build face_1 and face_2 vertex lists ───────────────────────────
    //
    //   face_1 (one side of cut, walked CCW):
    //     A → for each crossed hole in cut order:
    //           [hole_natural(h_a → h_b)] →
    //        B → outer_natural(B → A)[:-1]   (skip duplicate A)
    //
    //   face_2 (other side, walked CCW):
    //     outer_natural(A → B) →
    //     for each crossed hole in REVERSE cut order:
    //           [hole_natural(h_b → h_a)]
    //
    // Single-hole reduction:
    //   face_1 = [A, hole(h_a→h_b), B, outer(B→A)[:-1]]
    //   face_2 = [outer(A→B), hole(h_b→h_a)]
    //
    // Which matches Phase G2 single-hole exactly; verified by shoelace
    // on the 200×200-with-40×40-hole test geometry.
    let outer_arc_1 = arc_natural(&updated_outer, outer_b, outer_a); // [B, ..., A]
    let outer_arc_2 = arc_natural(&updated_outer, outer_a, outer_b); // [A, ..., B]

    let mut face_1_verts: Vec<VertId> = Vec::new();
    face_1_verts.push(outer_a);
    for (k, ch) in crossed.iter().enumerate() {
        let arc = arc_natural(&updated_holes[k], ch.h_a, ch.h_b);
        face_1_verts.extend_from_slice(&arc);
    }
    // After all crossed holes, fall through to outer's B-to-A arc.
    // The next vertex after the last h_b must be B — we append outer_arc_1
    // without repeating B: the outer_arc_1 starts at B, so we skip its
    // first entry and extend the rest, but we also skip the trailing A.
    if !outer_arc_1.is_empty() {
        // Push B explicitly (first elem of outer_arc_1), then the rest
        // excluding trailing A.
        face_1_verts.push(outer_arc_1[0]);
        face_1_verts.extend_from_slice(&outer_arc_1[1..outer_arc_1.len().saturating_sub(1)]);
    }

    let mut face_2_verts: Vec<VertId> = Vec::new();
    face_2_verts.extend_from_slice(&outer_arc_2); // [A, ..., B]
    // Reverse cut order for face_2 — it walks back from B to A through
    // each hole's "other" arc (h_b → h_a).
    for (k, ch) in crossed.iter().enumerate().rev() {
        let arc = arc_natural(&updated_holes[k], ch.h_b, ch.h_a);
        face_2_verts.extend_from_slice(&arc);
    }

    // ── Redistribute clear (untouched) holes by containment ────────────
    let normal = mesh.faces[face_id].normal();
    let face_origin = mesh.vertex_pos(updated_outer[0])?;
    let (u_axis, v_axis) = projection_axes(normal);
    let project_2d = |p: DVec3| -> [f64; 2] {
        [component(p, u_axis), component(p, v_axis)]
    };
    let poly_1: Vec<[f64; 2]> = face_1_verts.iter()
        .map(|&vid| project_2d(mesh.vertex_pos(vid).unwrap_or(face_origin)))
        .collect();

    let crossed_set: std::collections::HashSet<usize> =
        crossed_indices.iter().copied().collect();

    let mut holes_for_1: Vec<Vec<VertId>> = Vec::new();
    let mut holes_for_2: Vec<Vec<VertId>> = Vec::new();
    for (i, hole) in saved_holes.iter().enumerate() {
        if crossed_set.contains(&i) { continue; }  // consumed hole
        if !matches!(classifications[i], HoleClassification::Clear) { continue; }
        let sample3 = mesh.vertex_pos(hole.sample_vert)?;
        let s2 = project_2d(sample3);
        let in_1 = point_in_polygon_axis_2d(s2, &poly_1);
        let verts = mesh.collect_loop_verts(hole.loop_ref.start)?;
        if in_1 { holes_for_1.push(verts); }
        else    { holes_for_2.push(verts); }
    }

    // ── Tear down the original face and rebuild two new faces ─────────
    let material = mesh.faces[face_id].material();
    // ADR-089 A-χ-β — capture parent surface before remove.
    let parent_surface = mesh.faces[face_id].surface().cloned();
    // K3 (보고서 시나리오 3 hotfix, 2026-05-23) — capture parent owner_id.
    let parent_owner = mesh.face_surface_owner_id(face_id);
    mesh.remove_face(face_id)?;

    let holes_for_1_slices: Vec<&[VertId]> = holes_for_1.iter().map(|v| v.as_slice()).collect();
    let holes_for_2_slices: Vec<&[VertId]> = holes_for_2.iter().map(|v| v.as_slice()).collect();

    let face_1 = mesh.add_face_with_holes(&face_1_verts, &holes_for_1_slices, material)?;
    let face_2 = mesh.add_face_with_holes(&face_2_verts, &holes_for_2_slices, material)?;
    // ADR-089 A-χ-β — propagate parent surface to both sub-faces.
    if let Some(ref s) = parent_surface {
        mesh.faces[face_1].set_surface(Some(s.clone()));
        mesh.faces[face_2].set_surface(Some(s.clone()));
    }
    // K3 — propagate parent surface owner_id to both sub-faces.
    if let Some(owner) = parent_owner {
        mesh.set_face_surface_owner_id(face_1, Some(owner));
        mesh.set_face_surface_owner_id(face_2, Some(owner));
    }

    // Track the new cut edges (A↔first h_a, each h_b↔next h_a, last h_b↔B)
    if let Some(first) = crossed.first() {
        if let Some(e) = mesh.find_edge(outer_a, first.h_a) { new_edges.push(e); }
    }
    for pair in crossed.windows(2) {
        if let Some(e) = mesh.find_edge(pair[0].h_b, pair[1].h_a) { new_edges.push(e); }
    }
    if let Some(last) = crossed.last() {
        if let Some(e) = mesh.find_edge(last.h_b, outer_b) { new_edges.push(e); }
    }

    // ADR-101 Amendment 10 — 메타-원칙 #15 cross-cut enforcement.
    // case (b) cut edges 에 HARD flag 부여 (hole 통과 cut chain).
    // `Mesh::split_face` 의 canonical pattern + Amendment 9 §A9.4
    // cross-cut audit 의 자연 enforcement.
    mesh.mark_edges_hard(&new_edges);

    debug.push(format!("case (b) result: face_1={} ({}v), face_2={} ({}v)",
        face_1.raw(), face_1_verts.len(), face_2.raw(), face_2_verts.len()));
    debug.push(format!("  proj_start={:?}", proj_start));

    mesh.debug_verify_invariants();

    Ok(FaceSplitResult {
        new_faces: vec![face_1, face_2],
        new_verts,
        new_edges,
        debug,
    })
}

/// Inclusive natural-order walk from `v_start` to `v_end` around a loop.
/// Returns `[v_start, …, v_end]`. Panics/bails if either endpoint missing.
fn arc_natural(loop_verts: &[VertId], v_start: VertId, v_end: VertId) -> Vec<VertId> {
    let n = loop_verts.len();
    let i_start = loop_verts.iter().position(|&v| v == v_start).unwrap_or(0);
    let i_end = loop_verts.iter().position(|&v| v == v_end).unwrap_or(i_start);
    let mut out = Vec::new();
    let mut i = i_start;
    for _ in 0..n + 1 {
        out.push(loop_verts[i]);
        if i == i_end { break; }
        i = (i + 1) % n;
    }
    out
}

/// Locate the active hole edge that contains the crossing position.
/// Scans the current hole loop (post any prior splits) for the segment
/// whose 3D midpoint is closest to `pos`. Returns its EdgeId.
fn find_hole_edge_containing(
    mesh: &Mesh,
    loop_verts: &[VertId],
    _orig_seg_idx: usize,
    pos: DVec3,
) -> Result<(EdgeId, f64)> {
    let n = loop_verts.len();
    let mut best: Option<(EdgeId, f64, f64)> = None;
    for i in 0..n {
        let a = loop_verts[i];
        let b = loop_verts[(i + 1) % n];
        let pa = mesh.vertex_pos(a)?;
        let pb = mesh.vertex_pos(b)?;
        let ab = pb - pa;
        let len2 = ab.length_squared();
        if len2 < 1e-18 { continue; }
        let t = ((pos - pa).dot(ab) / len2).clamp(0.0, 1.0);
        let proj = pa + ab * t;
        let d2 = (pos - proj).length_squared();
        let eid = mesh.find_edge(a, b)
            .ok_or_else(|| anyhow::anyhow!("find_hole_edge_containing: no edge between verts"))?;
        match best {
            None => best = Some((eid, d2, t)),
            Some((_, d2_prev, _)) if d2 < d2_prev => best = Some((eid, d2, t)),
            _ => {}
        }
    }
    let (eid, _, t) = best.ok_or_else(||
        anyhow::anyhow!("find_hole_edge_containing: empty hole loop"))?;
    Ok((eid, t))
}

/// Which endpoint of the cutting line was flagged inside a hole.
#[derive(Clone, Copy, Debug, PartialEq)]
enum InsideEnd { Start, End }

/// If the classifications describe exactly one hole with exactly one
/// endpoint inside (and no crossings, no other insides, no ambiguity),
/// return `(hole_idx, which_end)` — caller routes to `split_face_case_c`.
fn detect_case_c(classifications: &[HoleClassification]) -> Option<(usize, InsideEnd)> {
    let mut target: Option<(usize, InsideEnd)> = None;
    for (i, c) in classifications.iter().enumerate() {
        match c {
            HoleClassification::Clear => {}
            HoleClassification::InsideStart => {
                if target.is_some() { return None; }
                target = Some((i, InsideEnd::Start));
            }
            HoleClassification::InsideEnd => {
                if target.is_some() { return None; }
                target = Some((i, InsideEnd::End));
            }
            // Anything else (Crossed, InsideBoth, Ambiguous) → not pure case (c)
            _ => return None,
        }
    }
    target
}

/// Phase G case (c) — "bridge" topology. One cutting-line endpoint lies
/// on outer; the other lies strictly inside a hole. We find where the
/// line crosses that hole boundary (H) and create a zero-width bridge
/// A↔H that fuses the hole into the outer loop.
///
/// Result: a single face whose outer loop traverses outer, then the
/// former hole (in the same natural CW winding the hole had), then
/// back — connected by the bridge edge traversed in both directions.
/// All other holes remain as inner loops on the rebuilt face.
fn split_face_case_c(
    mesh: &mut Mesh,
    face_id: FaceId,
    proj_start: DVec3,
    proj_end: DVec3,
    which_end: InsideEnd,
    saved_holes: &[SavedHole],
    hole_idx: usize,
    _classifications: &[HoleClassification],
    outer_loop_verts: &[VertId],
    outer_loop_hes: &[HeId],
    face_diag: f64,
    mut new_verts: Vec<VertId>,
    mut new_edges: Vec<EdgeId>,
    mut debug: Vec<String>,
) -> Result<FaceSplitResult> {
    // Normalize direction: outer_pt is the endpoint on outer, inside_pt is
    // the endpoint inside the hole.
    let (outer_pt, inside_pt) = match which_end {
        InsideEnd::End   => (proj_start, proj_end),
        InsideEnd::Start => (proj_end,   proj_start),
    };
    debug.push(format!(
        "case (c): hole_idx={}, which_end={:?}, outer_pt={:?}, inside_pt={:?}",
        hole_idx, which_end, outer_pt, inside_pt,
    ));

    // ── Resolve the outer endpoint as a real vertex on outer ───────────
    let snap_tol = face_diag * 0.02;
    let outer_bp = find_boundary_point(
        mesh, face_id, outer_pt, outer_loop_verts, outer_loop_hes, snap_tol,
    )?;
    let outer_a = realize_boundary_point(
        mesh, &outer_bp, &mut new_verts, &mut new_edges, &mut debug,
    )?;

    // ── Find the single hole-boundary crossing ─────────────────────────
    // Re-read the crossed hole's current loop (realize_boundary_point on
    // outer didn't touch inners, but be defensive).
    let hole_start_now = mesh.faces[face_id].inners()[hole_idx].start;
    let hole_verts_pre = mesh.collect_loop_verts(hole_start_now)?;
    let crossings = find_loop_crossings_3d(mesh, &hole_verts_pre, outer_pt, inside_pt)?;
    ensure!(
        crossings.len() == 1,
        "case (c): expected exactly 1 hole crossing, got {}",
        crossings.len(),
    );
    let (seg_idx, pos) = crossings[0];
    let (eid, _t) = find_hole_edge_containing(mesh, &hole_verts_pre, seg_idx, pos)?;
    let (h_vert, e1, e2) = mesh.split_edge(eid, pos)?;
    new_verts.push(h_vert);
    new_edges.push(e1);
    new_edges.push(e2);
    debug.push(format!("  hole crossing at edge {} → v{}", eid.raw(), h_vert.raw()));

    // ── Compose the bridged outer loop ──────────────────────────────────
    // outer_walk (starting from outer_a, one full cycle back to outer_a
    // exclusive) + hole_walk from H for one natural-CW cycle, then A
    // appended once to close the bridge.
    //
    // The resulting list has outer_a at index 0 and one further occurrence
    // between H's arrivals — make_loop pairs consecutive entries so A at
    // [0] naturally closes the loop with the last vertex.
    let outer_post = mesh.collect_loop_verts(mesh.faces[face_id].outer().start)?;
    let hole_post  = mesh.collect_loop_verts(
        mesh.faces[face_id].inners()[hole_idx].start,
    )?;

    // Build outer arc starting at outer_a going natural CCW for one cycle.
    let a_pos = outer_post.iter().position(|&v| v == outer_a)
        .ok_or_else(|| anyhow::anyhow!("case (c): outer_a lost from outer loop"))?;
    let mut outer_seq: Vec<VertId> = Vec::with_capacity(outer_post.len());
    for k in 0..outer_post.len() {
        outer_seq.push(outer_post[(a_pos + k) % outer_post.len()]);
    }
    // outer_seq starts with outer_a and contains every outer vert once.

    // Hole arc: natural CW cycle starting and ending at h_vert (exclusive
    // of the trailing duplicate H — we add H and A explicitly in the
    // bridge closure).
    let h_pos = hole_post.iter().position(|&v| v == h_vert)
        .ok_or_else(|| anyhow::anyhow!("case (c): H lost from hole loop"))?;
    let mut hole_seq: Vec<VertId> = Vec::with_capacity(hole_post.len());
    for k in 0..hole_post.len() {
        hole_seq.push(hole_post[(h_pos + k) % hole_post.len()]);
    }
    // hole_seq starts with h_vert and contains every hole vert once.

    // Final bridged loop: outer_seq + [H] + hole_seq[1..] (rest of hole
    // after H) + [H] closes back into the bridge → make_loop walks:
    //   outer_a → outer_seq[1] → … → outer_seq[-1] → H → hole_seq[1]
    //     → … → hole_seq[-1] → H → outer_a (wraps)
    // i.e. the bridge edge A↔H is used twice in opposite directions and
    // the hole is traversed in its natural CW winding.
    let mut bridged: Vec<VertId> = Vec::with_capacity(outer_seq.len() + hole_seq.len() + 2);
    bridged.extend_from_slice(&outer_seq);
    bridged.push(h_vert);
    bridged.extend_from_slice(&hole_seq[1..]);
    bridged.push(h_vert);

    // ── Preserve other (untouched) holes as inners on the new face ─────
    let mut other_holes: Vec<Vec<VertId>> = Vec::new();
    for (i, _hole) in saved_holes.iter().enumerate() {
        if i == hole_idx { continue; }
        let start = mesh.faces[face_id].inners()[i].start;
        other_holes.push(mesh.collect_loop_verts(start)?);
    }

    // ── Remove original + rebuild single face ──────────────────────────
    let material = mesh.faces[face_id].material();
    // ADR-089 A-χ-β — capture parent surface before remove.
    let parent_surface = mesh.faces[face_id].surface().cloned();
    // K3 (보고서 시나리오 3 hotfix, 2026-05-23) — capture parent owner_id.
    let parent_owner = mesh.face_surface_owner_id(face_id);
    mesh.remove_face(face_id)?;

    let other_slices: Vec<&[VertId]> = other_holes.iter().map(|v| v.as_slice()).collect();
    let new_face = mesh.add_face_with_holes(&bridged, &other_slices, material)?;
    if let Some(s) = parent_surface {
        mesh.faces[new_face].set_surface(Some(s));
    }
    // K3 — propagate parent surface owner_id to new face.
    if let Some(owner) = parent_owner {
        mesh.set_face_surface_owner_id(new_face, Some(owner));
    }

    if let Some(e) = mesh.find_edge(outer_a, h_vert) { new_edges.push(e); }

    // ADR-101 Amendment 10 — 메타-원칙 #15 cross-cut enforcement.
    // case (c) bridge edge (outer_a → h_vert, endpoint-on-hole-boundary).
    mesh.mark_edges_hard(&new_edges);

    debug.push(format!("case (c) result: face={} ({}v, {} holes)",
        new_face.raw(), bridged.len(), other_holes.len()));

    mesh.debug_verify_invariants();

    Ok(FaceSplitResult {
        new_faces: vec![new_face],
        new_verts,
        new_edges,
        debug,
    })
}

/// ADR-023 P8 — Strict boundary point detection on a hole loop.
///
/// Returns `Some(BoundaryPoint)` only if `point` is within `tol` of the loop's
/// vertex or edge. No closest-fallback (unlike `find_boundary_point` which
/// always returns something). Used by `detect_case_d` to identify endpoints
/// landing exactly on a hole boundary.
fn try_find_hole_boundary_point(
    mesh: &Mesh,
    point: DVec3,
    hole_verts: &[VertId],
    hole_hes: &[HeId],
    tol: f64,
) -> Result<Option<BoundaryPoint>> {
    if hole_verts.is_empty() { return Ok(None); }

    // Pass 1: vertex match
    let mut best_v: Option<(VertId, f64)> = None;
    for &vid in hole_verts {
        let d = (mesh.vertex_pos(vid)? - point).length();
        if d < tol && (best_v.is_none() || d < best_v.unwrap().1) {
            best_v = Some((vid, d));
        }
    }
    if let Some((vid, _)) = best_v {
        return Ok(Some(BoundaryPoint::ExistingVertex(vid)));
    }

    // Pass 2: edge match (tight only — no fallback)
    let mut best_e: Option<(EdgeId, DVec3, f64, f64)> = None; // (edge, pos, t, dist)
    for i in 0..hole_verts.len() {
        let he = hole_hes[i];
        let edge_id = mesh.hes[he].edge();
        let edge = &mesh.edges[edge_id];
        let a = mesh.vertex_pos(edge.v_small())?;
        let b = mesh.vertex_pos(edge.v_large())?;
        let d = b - a;
        let len2 = d.length_squared();
        if len2 < 1e-20 { continue; }
        let t = ((point - a).dot(d) / len2).clamp(0.0, 1.0);
        let proj = a + d * t;
        let dist = (point - proj).length();
        if dist < tol && (best_e.is_none() || dist < best_e.as_ref().unwrap().3) {
            best_e = Some((edge_id, proj, t, dist));
        }
    }
    if let Some((edge_id, position, t, _)) = best_e {
        // Reject if t is extremely close to endpoints — should have matched vertex.
        if t > 1e-6 && t < 1.0 - 1e-6 {
            return Ok(Some(BoundaryPoint::OnEdge { edge_id, position, t }));
        }
    }
    Ok(None)
}

/// ADR-023 P8 — Detect "endpoint exactly on hole boundary" case.
///
/// Returns `Some((hole_idx, which_end, BoundaryPoint))` if exactly one
/// endpoint of the cutting line lies on exactly one hole's boundary while
/// the other endpoint does NOT lie on the same hole's boundary. Multi-hole
/// scenarios (both endpoints on different holes) are deferred — return None.
fn detect_case_d(
    mesh: &Mesh,
    proj_start: DVec3,
    proj_end: DVec3,
    saved_holes: &[SavedHole],
    tol: f64,
) -> Result<Option<(usize, InsideEnd, BoundaryPoint)>> {
    let mut start_match: Option<(usize, BoundaryPoint)> = None;
    let mut end_match: Option<(usize, BoundaryPoint)> = None;
    for (hole_idx, hole) in saved_holes.iter().enumerate() {
        let hole_verts = mesh.collect_loop_verts(hole.loop_ref.start)?;
        let hole_hes = mesh.collect_loop_hes(hole.loop_ref.start)?;
        if start_match.is_none() {
            if let Some(bp) = try_find_hole_boundary_point(
                mesh, proj_start, &hole_verts, &hole_hes, tol,
            )? {
                start_match = Some((hole_idx, bp));
            }
        }
        if end_match.is_none() {
            if let Some(bp) = try_find_hole_boundary_point(
                mesh, proj_end, &hole_verts, &hole_hes, tol,
            )? {
                end_match = Some((hole_idx, bp));
            }
        }
    }
    match (start_match, end_match) {
        (Some(_), Some(_)) => Ok(None),  // both endpoints on hole boundary — defer
        (Some((idx, bp)), None) => Ok(Some((idx, InsideEnd::Start, bp))),
        (None, Some((idx, bp))) => Ok(Some((idx, InsideEnd::End, bp))),
        (None, None) => Ok(None),
    }
}

/// ADR-023 P8 (Phase G case d) — Bridge with endpoint exactly on hole boundary.
///
/// Outer endpoint (resolved on outer loop as usual) → A. Hole endpoint
/// (BoundaryPoint provided by `detect_case_d`) → H (existing vertex or
/// realized via `split_edge`). Same bridge composition as case (c).
fn split_face_case_d(
    mesh: &mut Mesh,
    face_id: FaceId,
    proj_start: DVec3,
    proj_end: DVec3,
    which_end: InsideEnd,
    hole_idx: usize,
    hole_bp: BoundaryPoint,
    saved_holes: &[SavedHole],
    outer_loop_verts: &[VertId],
    outer_loop_hes: &[HeId],
    face_diag: f64,
    mut new_verts: Vec<VertId>,
    mut new_edges: Vec<EdgeId>,
    mut debug: Vec<String>,
) -> Result<FaceSplitResult> {
    let outer_pt = match which_end {
        InsideEnd::End   => proj_start,  // hole-side is end → outer-side is start
        InsideEnd::Start => proj_end,
    };
    debug.push(format!(
        "case (d) P8: hole_idx={}, which_end={:?}, outer_pt={:?}",
        hole_idx, which_end, outer_pt,
    ));

    // ── Resolve A on outer ─────────────────────────────────────────────
    let snap_tol = face_diag * 0.02;
    let outer_bp = find_boundary_point(
        mesh, face_id, outer_pt, outer_loop_verts, outer_loop_hes, snap_tol,
    )?;
    let outer_a = realize_boundary_point(
        mesh, &outer_bp, &mut new_verts, &mut new_edges, &mut debug,
    )?;

    // ── Realize H from hole_bp ─────────────────────────────────────────
    let h_vert = realize_boundary_point(
        mesh, &hole_bp, &mut new_verts, &mut new_edges, &mut debug,
    )?;
    debug.push(format!("  case (d) H = v{}", h_vert.raw()));

    // ── Compose bridged outer loop (same shape as case c) ──────────────
    let outer_post = mesh.collect_loop_verts(mesh.faces[face_id].outer().start)?;
    let hole_post  = mesh.collect_loop_verts(
        mesh.faces[face_id].inners()[hole_idx].start,
    )?;

    let a_pos = outer_post.iter().position(|&v| v == outer_a)
        .ok_or_else(|| anyhow::anyhow!("case (d): outer_a lost from outer loop"))?;
    let mut outer_seq: Vec<VertId> = Vec::with_capacity(outer_post.len());
    for k in 0..outer_post.len() {
        outer_seq.push(outer_post[(a_pos + k) % outer_post.len()]);
    }

    let h_pos = hole_post.iter().position(|&v| v == h_vert)
        .ok_or_else(|| anyhow::anyhow!("case (d): H lost from hole loop"))?;
    let mut hole_seq: Vec<VertId> = Vec::with_capacity(hole_post.len());
    for k in 0..hole_post.len() {
        hole_seq.push(hole_post[(h_pos + k) % hole_post.len()]);
    }

    let mut bridged: Vec<VertId> = Vec::with_capacity(outer_seq.len() + hole_seq.len() + 2);
    bridged.extend_from_slice(&outer_seq);
    bridged.push(h_vert);
    bridged.extend_from_slice(&hole_seq[1..]);
    bridged.push(h_vert);

    // ── Preserve other holes ───────────────────────────────────────────
    let mut other_holes: Vec<Vec<VertId>> = Vec::new();
    for (i, _hole) in saved_holes.iter().enumerate() {
        if i == hole_idx { continue; }
        let start = mesh.faces[face_id].inners()[i].start;
        other_holes.push(mesh.collect_loop_verts(start)?);
    }

    // ── Rebuild ────────────────────────────────────────────────────────
    let material = mesh.faces[face_id].material();
    // ADR-089 A-χ-β — capture parent surface before remove.
    let parent_surface = mesh.faces[face_id].surface().cloned();
    // K3 (보고서 시나리오 3 hotfix, 2026-05-23) — capture parent owner_id.
    let parent_owner = mesh.face_surface_owner_id(face_id);
    mesh.remove_face(face_id)?;

    let other_slices: Vec<&[VertId]> = other_holes.iter().map(|v| v.as_slice()).collect();
    let new_face = mesh.add_face_with_holes(&bridged, &other_slices, material)?;
    if let Some(s) = parent_surface {
        mesh.faces[new_face].set_surface(Some(s));
    }
    // K3 — propagate parent surface owner_id to new face.
    if let Some(owner) = parent_owner {
        mesh.set_face_surface_owner_id(new_face, Some(owner));
    }

    if let Some(e) = mesh.find_edge(outer_a, h_vert) { new_edges.push(e); }

    // ADR-101 Amendment 10 — 메타-원칙 #15 cross-cut enforcement.
    // case (d) bridge edge (outer_a → h_vert, endpoint-inside-hole bridge).
    mesh.mark_edges_hard(&new_edges);

    debug.push(format!("case (d) result: face={} ({}v, {} holes)",
        new_face.raw(), bridged.len(), other_holes.len()));

    mesh.debug_verify_invariants();

    Ok(FaceSplitResult {
        new_faces: vec![new_face],
        new_verts,
        new_edges,
        debug,
    })
}

/// Axis-projected point-in-polygon (ray cast along +u). Works for polygons
/// expressed as a flat list of [u, v] coordinates.
fn point_in_polygon_axis_2d(p: [f64; 2], poly: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let pi = poly[i];
        let pj = poly[j];
        if (pi[1] > p[1]) != (pj[1] > p[1]) {
            let t = (p[1] - pi[1]) / (pj[1] - pi[1]);
            let xcross = pi[0] + t * (pj[0] - pi[0]);
            if p[0] < xcross { inside = !inside; }
        }
        j = i;
    }
    inside
}

/// Snapshot of one hole loop on the face being split — saves the LoopRef
/// plus a sample vertex on the loop so we can classify containment after
/// the outer split completes.
struct SavedHole {
    loop_ref: LoopRef,
    sample_vert: VertId,
}

/// Collect every hole loop on `face_id` with a representative vertex per
/// loop. Does not mutate the mesh.
fn save_hole_loops(mesh: &Mesh, face_id: FaceId) -> Result<Vec<SavedHole>> {
    let inner_refs: Vec<_> = mesh.faces[face_id].inners().to_vec();
    let mut out = Vec::with_capacity(inner_refs.len());
    for lref in inner_refs {
        let verts = mesh.collect_loop_verts(lref.start)?;
        ensure!(
            !verts.is_empty(),
            "split_face_by_line: hole loop {} is empty",
            lref.start.raw(),
        );
        out.push(SavedHole { loop_ref: lref, sample_vert: verts[0] });
    }
    Ok(out)
}

/// Reject line-vs-hole intersections and endpoints inside holes —
/// those belong to cases (b)/(c). Superseded by `classify_holes` in
/// Phase G2 for case (b) routing; kept only for reference.
#[allow(dead_code)]
fn validate_line_avoids_holes(
    mesh: &Mesh,
    face_id: FaceId,
    proj_start: DVec3,
    proj_end: DVec3,
    saved: &[SavedHole],
) -> Result<()> {
    // Endpoint-inside-hole check: a hole excludes interior, so point_in_face
    // returns false if the point is strictly inside a hole. We detect the
    // intent by checking each hole's polygon directly instead.
    for hole in saved {
        let verts = mesh.collect_loop_verts(hole.loop_ref.start)?;
        if point_inside_loop_3d(mesh, &verts, proj_start)?
            || point_inside_loop_3d(mesh, &verts, proj_end)?
        {
            bail!(
                "split_face_by_line: endpoint lies inside a hole on face {} — \
                 bridge topology not yet supported (Phase G case c)",
                face_id.raw(),
            );
        }
        if segment_crosses_loop_3d(mesh, &verts, proj_start, proj_end)? {
            bail!(
                "split_face_by_line: line crosses hole boundary on face {} — \
                 hole-split not yet supported (Phase G case b)",
                face_id.raw(),
            );
        }
    }
    Ok(())
}

/// Project `loop_verts` and `point` onto the face plane (using the loop's
/// own plane) and run 2D point-in-polygon ray casting.
fn point_inside_loop_3d(mesh: &Mesh, loop_verts: &[VertId], point: DVec3) -> Result<bool> {
    use crate::operations::boolean_geo::point_in_polygon_2d;
    if loop_verts.len() < 3 { return Ok(false); }
    let (origin, basis_u, basis_v) = loop_basis(mesh, loop_verts)?;
    let poly: Vec<_> = loop_verts.iter()
        .map(|&v| project_to_basis(mesh.vertex_pos(v).unwrap_or(origin), origin, basis_u, basis_v))
        .collect();
    let p2 = project_to_basis(point, origin, basis_u, basis_v);
    Ok(point_in_polygon_2d(&p2, &poly))
}

/// True if segment (a,b) crosses any edge of the loop when projected to 2D.
/// Coincident endpoints (segment ends on a loop vertex) do not count.
/// Kept for `validate_line_avoids_holes`; Phase G2 uses
/// `find_loop_crossings_3d` which returns positions too.
#[allow(dead_code)]
fn segment_crosses_loop_3d(
    mesh: &Mesh,
    loop_verts: &[VertId],
    a: DVec3,
    b: DVec3,
) -> Result<bool> {
    if loop_verts.len() < 3 { return Ok(false); }
    let (origin, basis_u, basis_v) = loop_basis(mesh, loop_verts)?;
    let a2 = project_to_basis(a, origin, basis_u, basis_v);
    let b2 = project_to_basis(b, origin, basis_u, basis_v);
    let poly: Vec<_> = loop_verts.iter()
        .map(|&v| project_to_basis(mesh.vertex_pos(v).unwrap_or(origin), origin, basis_u, basis_v))
        .collect();
    for i in 0..poly.len() {
        let p = poly[i];
        let q = poly[(i + 1) % poly.len()];
        if segments_cross_2d(a2, b2, p, q) { return Ok(true); }
    }
    Ok(false)
}

/// Build an orthonormal 2D basis from the first three non-collinear
/// vertices of a loop. Used for per-loop projection so we don't depend
/// on a face-wide normal (holes and outer share it in practice).
fn loop_basis(mesh: &Mesh, loop_verts: &[VertId]) -> Result<(DVec3, DVec3, DVec3)> {
    let p0 = mesh.vertex_pos(loop_verts[0])?;
    let mut u = DVec3::ZERO;
    let mut n = DVec3::ZERO;
    for i in 1..loop_verts.len() {
        let cand = mesh.vertex_pos(loop_verts[i])? - p0;
        if cand.length() > 1e-9 { u = cand.normalize(); break; }
    }
    for i in 2..loop_verts.len() {
        let c = mesh.vertex_pos(loop_verts[i])? - p0;
        let cross = u.cross(c);
        if cross.length() > 1e-9 { n = cross.normalize(); break; }
    }
    ensure!(
        u.length_squared() > 0.0 && n.length_squared() > 0.0,
        "loop_basis: loop is degenerate",
    );
    let v = n.cross(u).normalize();
    Ok((p0, u, v))
}

fn project_to_basis(p: DVec3, origin: DVec3, u: DVec3, v: DVec3) -> crate::operations::boolean_geo::Pt2 {
    let d = p - origin;
    crate::operations::boolean_geo::Pt2 { x: d.dot(u), y: d.dot(v) }
}

/// Standard 2D segment intersection (proper crossing, endpoints exclusive
/// to avoid false positives when the line touches a loop vertex).
fn segments_cross_2d(
    a: crate::operations::boolean_geo::Pt2,
    b: crate::operations::boolean_geo::Pt2,
    c: crate::operations::boolean_geo::Pt2,
    d: crate::operations::boolean_geo::Pt2,
) -> bool {
    fn cross(o: crate::operations::boolean_geo::Pt2,
             a: crate::operations::boolean_geo::Pt2,
             b: crate::operations::boolean_geo::Pt2) -> f64 {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }
    let d1 = cross(c, d, a);
    let d2 = cross(c, d, b);
    let d3 = cross(a, b, c);
    let d4 = cross(a, b, d);
    (d1 * d2 < 0.0) && (d3 * d4 < 0.0)
}

/// Walk every half-edge of the loop starting at `start` and set its
/// face pointer to `target`. Used after the outer split when a hole
/// moves from face_a (== original face_id) to face_b.
fn reassign_loop_face(mesh: &mut Mesh, start: HeId, target: FaceId) -> Result<()> {
    let mut cur = start;
    for _ in 0..10_000 {
        mesh.hes[cur].set_face(target);
        let nxt = mesh.hes[cur].next();
        if nxt == start || nxt.is_null() { return Ok(()); }
        cur = nxt;
    }
    bail!("reassign_loop_face: loop did not close within 10000 steps (possible corruption)");
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

    // ── ADR-059 Phase N Step 2 — split_edge curve inheritance ───────────

    /// ADR-059 Phase N Step 2 follow-up — split_edge inherits Line curve
    /// (Line is mesh-relative; child edges should both have Line curves
    /// referencing the new midpoint vertex).
    #[test]
    fn adr_059_split_edge_inherits_line_curve() {
        use crate::curves::{AnalyticCurve, synthesize::synthesize_line_curve};
        let mut m = Mesh::new();
        let (_fid, [v0, v1, _v2, _v3]) = make_square(&mut m);

        // Attach a Line curve to v0–v1 edge
        let eid = m.find_edge(v0, v1).expect("edge should exist");
        m.edges[eid].set_curve(Some(synthesize_line_curve(v0, v1)));

        // Split the edge at midpoint
        let (vp, e1, e2) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Both new edges should have Line curves referencing the new vertex
        match m.edges[e1].curve() {
            Some(AnalyticCurve::Line { start, end }) => {
                assert!(*start == v0 || *end == v0, "e1 line should reference v0");
                assert!(*start == vp || *end == vp, "e1 line should reference midpoint");
            }
            other => panic!("e1 should inherit Line curve, got {:?}", other),
        }
        match m.edges[e2].curve() {
            Some(AnalyticCurve::Line { start, end }) => {
                assert!(*start == vp || *end == vp, "e2 line should reference midpoint");
                assert!(*start == v1 || *end == v1, "e2 line should reference v1");
            }
            other => panic!("e2 should inherit Line curve, got {:?}", other),
        }
    }

    /// ADR-059 Phase N Step 2 follow-up — Bezier parent leaves children
    /// curveless (DeferredToPhaseI per §A1.3 lock-in — silent fallback,
    /// children keep curve = None).
    #[test]
    fn adr_059_split_edge_bezier_defers_silently() {
        use crate::curves::AnalyticCurve;
        let mut m = Mesh::new();
        let (_fid, [v0, v1, _v2, _v3]) = make_square(&mut m);

        // Attach a Bezier curve (DeferredToPhaseI in current MVP)
        let eid = m.find_edge(v0, v1).expect("edge should exist");
        m.edges[eid].set_curve(Some(AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(2.0, 1.0, 0.0),
                DVec3::new(4.0, 0.0, 0.0),
            ],
        }));

        // Split should still succeed (topology unchanged)
        let (_vp, e1, e2) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Children should have NO curve (DeferredToPhaseI fallback per §A1.3)
        assert!(m.edges[e1].curve().is_none(),
            "Bezier defer should leave e1 curveless");
        assert!(m.edges[e2].curve().is_none(),
            "Bezier defer should leave e2 curveless");
    }

    /// ADR-059 Phase N Step 2 follow-up — Edge without parent curve
    /// produces children without curves (no spurious synthesis).
    #[test]
    fn adr_059_split_edge_no_curve_stays_no_curve() {
        let mut m = Mesh::new();
        let (_fid, [v0, v1, _v2, _v3]) = make_square(&mut m);

        // Edge has no curve attached
        let eid = m.find_edge(v0, v1).expect("edge should exist");
        assert!(m.edges[eid].curve().is_none(), "parent should be curveless");

        let (_vp, e1, e2) = m.split_edge(eid, DVec3::new(2.0, 0.0, 0.0)).unwrap();

        // Children should also be curveless (Phase N doesn't auto-synthesize
        // here — that's Step 4's migration job).
        assert!(m.edges[e1].curve().is_none());
        assert!(m.edges[e2].curve().is_none());
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

    // ═══════════════════════════════════════════════════════════════════
    // Normal consistency after split (앞뒷면 뒤집힘 회귀 방지)
    // ═══════════════════════════════════════════════════════════════════

    /// 박스 윗면을 분할했을 때 두 sub-face 모두 같은 방향 법선을 유지해야 한다.
    /// 이 불변식이 깨지면 렌더링에서 앞/뒷면이 섞여 보인다.
    #[test]
    fn split_face_preserves_normal_direction() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);

        // 박스 생성 후 윗면(=+Y 방향 법선) 분할
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(4.0, 0.0, 4.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 4.0));
        let base = m.add_face(&[v0, v3, v2, v1], mat).unwrap(); // +Y 노멀
        let pp = m.push_pull(base, 3.0, mat).unwrap();
        let top = pp.top_face;
        let original_normal = m.faces[top].normal();

        // 윗면을 중앙에서 가르기
        let top_verts = m.collect_loop_verts(m.faces[top].outer().start).unwrap();
        let (fa, fb) = m.split_face(top, top_verts[0], top_verts[2]).unwrap();

        // 두 sub-face의 저장된 노멀이 원본과 일치하는가
        let stored_a = m.faces[fa].normal();
        let stored_b = m.faces[fb].normal();

        assert!(
            stored_a.dot(original_normal) > 0.0,
            "face_a stored normal {:?} flipped from original {:?}",
            stored_a, original_normal
        );
        assert!(
            stored_b.dot(original_normal) > 0.0,
            "face_b stored normal {:?} flipped from original {:?}",
            stored_b, original_normal
        );

        // 저장된 노멀과 실제 loop 방향의 일치 여부 (이게 깨지면 두-톤 렌더링 뒤집힘)
        let verts_a = m.collect_loop_verts(m.faces[fa].outer().start).unwrap();
        let verts_b = m.collect_loop_verts(m.faces[fb].outer().start).unwrap();
        let computed_a = m.compute_normal(&verts_a).unwrap();
        let computed_b = m.compute_normal(&verts_b).unwrap();

        assert!(
            computed_a.dot(stored_a) > 0.0,
            "face_a loop orientation doesn't match stored normal: \
             computed {:?}, stored {:?}",
            computed_a, stored_a
        );
        assert!(
            computed_b.dot(stored_b) > 0.0,
            "face_b loop orientation doesn't match stored normal: \
             computed {:?}, stored {:?}",
            computed_b, stored_b
        );
    }

    /// **진단용**: split_face_by_line이 edge를 split할 때, **그 edge를 공유하는
    /// 인접 면(박스의 벽)**의 노멀 방향이 영향받지 않는지 확인.
    /// 사용자가 실제로 본 "앞뒷면 뒤집힘"은 이 경로에서 발생할 가능성 큼.
    #[test]
    fn split_face_by_line_preserves_adjacent_normals() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);

        // 박스 생성
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(10.0, 0.0, 8.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 8.0));
        let base = m.add_face(&[v0, v3, v2, v1], mat).unwrap();
        let pp = m.push_pull(base, 5.0, mat).unwrap();
        let top = pp.top_face;

        // 분할 전 모든 face의 노멀 저장
        let before: std::collections::HashMap<_, _> = m.faces.iter()
            .filter(|(_, f)| f.is_active())
            .map(|(id, f)| (id, f.normal()))
            .collect();

        // 윗면 분할 (edge split 2회 → 인접 벽 2개의 loop 업데이트 발생)
        split_face_by_line(
            &mut m, top,
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 8.0),
        ).unwrap();

        // 원래 존재하던 face들 중 여전히 존재하는 것들의 노멀 비교
        let mut adjacent_flipped = Vec::new();
        for (fid, orig_normal) in &before {
            if *fid == top { continue; } // 분할 대상은 제외
            if let Some(face) = m.faces.get(*fid) {
                if !face.is_active() { continue; }
                let stored = face.normal();
                if stored.dot(*orig_normal) < 0.0 {
                    adjacent_flipped.push((fid.raw(), *orig_normal, stored));
                }

                // loop 실제 방향도 확인
                let verts = m.collect_loop_verts(face.outer().start).unwrap();
                let computed = m.compute_normal(&verts).unwrap();
                assert!(
                    computed.dot(stored) > 0.0,
                    "adjacent face {} stored/computed mismatch after split: \
                     stored {:?}, computed {:?}",
                    fid.raw(), stored, computed
                );
            }
        }

        assert!(
            adjacent_flipped.is_empty(),
            "인접 면 노멀이 뒤집힘: {:?}",
            adjacent_flipped
        );
    }

    /// split_face_by_line 경로 (edge split + face split 연쇄)에서도 동일 불변식
    #[test]
    fn split_face_by_line_preserves_normal_direction() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);

        // 박스 생성
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(10.0, 0.0, 8.0));
        let v3 = m.add_vertex(DVec3::new(0.0, 0.0, 8.0));
        let base = m.add_face(&[v0, v3, v2, v1], mat).unwrap();
        let pp = m.push_pull(base, 5.0, mat).unwrap();
        let top = pp.top_face;
        let original_normal = m.faces[top].normal();

        // 윗면의 두 edge 중간점을 잇는 분할선 (edge split 두 번 발생)
        let result = split_face_by_line(
            &mut m, top,
            DVec3::new(5.0, 5.0, 0.0),
            DVec3::new(5.0, 5.0, 8.0),
        ).unwrap();

        assert_eq!(result.new_faces.len(), 2);
        let fa = result.new_faces[0];
        let fb = result.new_faces[1];

        // 두 sub-face의 stored vs computed 노멀 모두 원본과 같은 방향
        for (label, f) in [("A", fa), ("B", fb)] {
            let stored = m.faces[f].normal();
            let verts = m.collect_loop_verts(m.faces[f].outer().start).unwrap();
            let computed = m.compute_normal(&verts).unwrap();

            assert!(
                stored.dot(original_normal) > 0.0,
                "sub-face {} stored normal flipped: {:?} vs orig {:?}",
                label, stored, original_normal
            );
            assert!(
                computed.dot(stored) > 0.0,
                "sub-face {} loop orientation doesn't match stored normal: \
                 computed {:?}, stored {:?}",
                label, computed, stored
            );
        }
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

    // ═══════════════════════════════════════════════════════════════════
    // Geometric Validity Guards (ADR-003) for split_face_by_line
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn split_face_by_line_rejects_nan() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);
        let r = split_face_by_line(
            &mut m, fid,
            DVec3::new(f64::NAN, 0.0, 0.0),
            DVec3::new(4.0, 0.0, 4.0),
        );
        assert!(r.is_err());
        assert!(r.unwrap_err().to_string().contains("finite"));
    }

    #[test]
    fn split_face_by_line_rejects_infinity() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);
        let r = split_face_by_line(
            &mut m, fid,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(f64::INFINITY, 0.0, 4.0),
        );
        assert!(r.is_err());
    }

    #[test]
    fn split_face_by_line_rejects_zero_length() {
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);
        let p = DVec3::new(2.0, 0.0, 2.0);
        let r = split_face_by_line(&mut m, fid, p, p);
        assert!(r.is_err(), "zero-length split line must be rejected");
        let msg = r.unwrap_err().to_string();
        assert!(
            msg.contains("degenerate") || msg.contains("EPSILON"),
            "error should mention degenerate/EPSILON, got: {}",
            msg
        );
    }

    #[test]
    fn split_face_by_line_rejects_subepsilon_length() {
        use crate::tolerances::EPSILON_LENGTH;
        let mut m = Mesh::new();
        let (fid, _) = make_square(&mut m);
        let p0 = DVec3::new(2.0, 0.0, 2.0);
        let p1 = DVec3::new(2.0 + EPSILON_LENGTH * 0.5, 0.0, 2.0);
        let r = split_face_by_line(&mut m, fid, p0, p1);
        assert!(r.is_err(), "sub-epsilon split line must be rejected");
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

    #[test]
    fn box_split_face_then_pushpull() {
        // THE critical scenario: create a box, split its top face, then push/pull one half.
        // This is what causes the app hang in production.
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let (top_face, _pp) = make_box(&mut m, 4.0, 4.0, 3.0);

        assert_eq!(m.face_count(), 6, "box should have 6 faces");

        // Split the top face from midpoint of one edge to midpoint of opposite edge
        let line_start = DVec3::new(2.0, 3.0, 0.0);
        let line_end = DVec3::new(2.0, 3.0, 4.0);

        let split_result = split_face_by_line(&mut m, top_face, line_start, line_end).unwrap();
        assert_eq!(split_result.new_faces.len(), 2, "should create 2 faces");
        assert_eq!(m.face_count(), 7, "box + split = 7 faces");

        // Now push/pull one of the split sub-faces
        let face_a = split_result.new_faces[0];
        println!("Attempting push_pull on split face {:?}", face_a);

        let faces_before = m.face_count();
        let pp = m.push_pull(face_a, 2.0, mat).unwrap();
        let faces_after = m.face_count();

        println!("push_pull result: faces {} → {}, sides={}, debug={:?}",
            faces_before, faces_after, pp.side_faces.len(), pp.split_debug);

        assert!(faces_after > faces_before, "push/pull should create new faces");

        // Verify ALL faces have valid loops (no corrupted topology)
        for (fid, face) in m.faces.iter() {
            if !face.is_active() { continue; }
            let verts = m.collect_loop_verts(face.outer().start);
            assert!(verts.is_ok(), "Face {:?} has broken loop after split+pushpull", fid);
            let verts = verts.unwrap();
            assert!(verts.len() >= 3, "Face {:?} degenerate ({} verts)", fid, verts.len());
        }

        // Verify export_buffers works
        let bufs = m.export_buffers();
        assert!(bufs.is_ok(), "export_buffers failed after split+pushpull");
    }

    // ═════════════════════════════════════════════════════════════════════
    // Phase G — split_face_by_line on faces with holes
    // ═════════════════════════════════════════════════════════════════════

    /// Helper: a 200×200 face on y=0 with a 40×40 hole at the center.
    fn build_holed_face() -> (Mesh, FaceId) {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let o0 = m.add_vertex(DVec3::new(-100.0, 0.0, -100.0));
        let o1 = m.add_vertex(DVec3::new( 100.0, 0.0, -100.0));
        let o2 = m.add_vertex(DVec3::new( 100.0, 0.0,  100.0));
        let o3 = m.add_vertex(DVec3::new(-100.0, 0.0,  100.0));
        // Hole (CW relative to outer CCW — standard convention)
        let h0 = m.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let h1 = m.add_vertex(DVec3::new(-20.0, 0.0,  20.0));
        let h2 = m.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let h3 = m.add_vertex(DVec3::new( 20.0, 0.0, -20.0));
        let f = m.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[h0, h1, h2, h3]],
            mat,
        ).unwrap();
        (m, f)
    }

    #[test]
    fn phase_g_split_above_hole_keeps_hole_below() {
        // Cut horizontally well above the hole (z = 60). The hole center
        // (0, 0, 0) must end up on the lower piece.
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 60.0),
            DVec3::new( 100.0, 0.0, 60.0),
        ).unwrap_or_else(|e| panic!("split failed: {}\ndebug: built a holed 200x200 face", e));
        assert_eq!(res.new_faces.len(), 2);
        let holed: Vec<_> = res.new_faces.iter()
            .filter(|&&fid| !mesh.faces[fid].inners().is_empty())
            .collect();
        assert_eq!(holed.len(), 1, "exactly one output face should carry the hole");
        // Verify the other output face has no inner loops
        let empty_count = res.new_faces.iter()
            .filter(|&&fid| mesh.faces[fid].inners().is_empty())
            .count();
        assert_eq!(empty_count, 1);
        // Invariants hold across the whole mesh
        let report = mesh.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants broken after hole-aware split:\n{}", report.summary());
    }

    #[test]
    fn phase_g_split_below_hole_keeps_hole_above() {
        // Mirror of the above — cut at z=-60, hole should land in upper piece.
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, -60.0),
            DVec3::new( 100.0, 0.0, -60.0),
        ).unwrap();
        let with_hole: Vec<_> = res.new_faces.iter()
            .filter(|&&fid| !mesh.faces[fid].inners().is_empty())
            .collect();
        assert_eq!(with_hole.len(), 1);
    }

    #[test]
    fn phase_g2_hole_split_both_pieces_closed() {
        // After the hole is eaten, each output face must have a single,
        // valid outer loop of 8 vertices (4 outer + 2 hole arc + 2 cut ends).
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 0.0),
            DVec3::new( 100.0, 0.0, 0.0),
        ).unwrap();
        assert_eq!(res.new_faces.len(), 2);
        for &fid in &res.new_faces {
            let verts = mesh.collect_loop_verts(mesh.faces[fid].outer().start).unwrap();
            assert_eq!(verts.len(), 8,
                "each output face should have 8 verts (2 outer endpts + 2 orig outer + 2 hole + 2 hole cut)");
        }
    }

    #[test]
    fn phase_g2_cuts_through_two_holes() {
        // Two holes side by side — cut through both. Phase G2 multi-hole.
        // Both holes eaten; two output faces, each with a long outer loop
        // including two concave notches (one per hole).
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let o0 = m.add_vertex(DVec3::new(-200.0, 0.0, -100.0));
        let o1 = m.add_vertex(DVec3::new( 200.0, 0.0, -100.0));
        let o2 = m.add_vertex(DVec3::new( 200.0, 0.0,  100.0));
        let o3 = m.add_vertex(DVec3::new(-200.0, 0.0,  100.0));
        // Hole A at x≈-80
        let a0 = m.add_vertex(DVec3::new(-100.0, 0.0, -20.0));
        let a1 = m.add_vertex(DVec3::new(-100.0, 0.0,  20.0));
        let a2 = m.add_vertex(DVec3::new( -60.0, 0.0,  20.0));
        let a3 = m.add_vertex(DVec3::new( -60.0, 0.0, -20.0));
        // Hole B at x≈+80
        let b0 = m.add_vertex(DVec3::new(  60.0, 0.0, -20.0));
        let b1 = m.add_vertex(DVec3::new(  60.0, 0.0,  20.0));
        let b2 = m.add_vertex(DVec3::new( 100.0, 0.0,  20.0));
        let b3 = m.add_vertex(DVec3::new( 100.0, 0.0, -20.0));
        let f = m.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[a0, a1, a2, a3], &[b0, b1, b2, b3]],
            mat,
        ).unwrap();
        let res = split_face_by_line(
            &mut m, f,
            DVec3::new(-200.0, 0.0, 0.0),
            DVec3::new( 200.0, 0.0, 0.0),
        ).unwrap_or_else(|e| panic!("multi-hole split failed: {}", e));
        assert_eq!(res.new_faces.len(), 2);
        // Neither output face keeps a hole (both were consumed).
        for &fid in &res.new_faces {
            assert!(m.faces[fid].inners().is_empty(),
                "expected 0 holes, got {}", m.faces[fid].inners().len());
        }
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after multi-hole Phase G2 split:\n{}", report.summary());
    }

    #[test]
    fn phase_g2_cut_one_hole_preserves_other() {
        // Two holes: cut crosses only hole A, hole B is untouched and
        // should end up redistributed onto whichever resulting face
        // geometrically contains it.
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let o0 = m.add_vertex(DVec3::new(-200.0, 0.0, -200.0));
        let o1 = m.add_vertex(DVec3::new( 200.0, 0.0, -200.0));
        let o2 = m.add_vertex(DVec3::new( 200.0, 0.0,  200.0));
        let o3 = m.add_vertex(DVec3::new(-200.0, 0.0,  200.0));
        // Hole A (center, gets cut)
        let a0 = m.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let a1 = m.add_vertex(DVec3::new(-20.0, 0.0,  20.0));
        let a2 = m.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let a3 = m.add_vertex(DVec3::new( 20.0, 0.0, -20.0));
        // Hole B (far above the cut, untouched)
        let b0 = m.add_vertex(DVec3::new(-20.0, 0.0, 120.0));
        let b1 = m.add_vertex(DVec3::new(-20.0, 0.0, 160.0));
        let b2 = m.add_vertex(DVec3::new( 20.0, 0.0, 160.0));
        let b3 = m.add_vertex(DVec3::new( 20.0, 0.0, 120.0));
        let f = m.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[a0, a1, a2, a3], &[b0, b1, b2, b3]],
            mat,
        ).unwrap();

        // Cut at z=0 — crosses hole A only
        let res = split_face_by_line(
            &mut m, f,
            DVec3::new(-200.0, 0.0, 0.0),
            DVec3::new( 200.0, 0.0, 0.0),
        ).unwrap();
        assert_eq!(res.new_faces.len(), 2);

        // Hole B should survive exactly once across the two output faces.
        let total_holes: usize = res.new_faces.iter()
            .map(|&fid| mesh_hole_count(&m, fid))
            .sum();
        assert_eq!(total_holes, 1, "one untouched hole must survive");

        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after mixed case (a+b):\n{}", report.summary());
    }

    fn mesh_hole_count(mesh: &Mesh, f: FaceId) -> usize {
        mesh.faces[f].inners().len()
    }

    #[test]
    fn phase_g2_hole_split_consumes_hole() {
        // Cut horizontally THROUGH the hole (z=0) — Phase G2 case (b).
        // Expected: hole is "eaten"; two output faces each have a concave
        // notch, neither keeps the hole as an inner loop.
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 0.0),
            DVec3::new( 100.0, 0.0, 0.0),
        ).unwrap_or_else(|e| panic!("phase G2 case (b) failed: {}", e));
        assert_eq!(res.new_faces.len(), 2);
        for &fid in &res.new_faces {
            assert!(
                mesh.faces[fid].inners().is_empty(),
                "after hole-crossing split, neither output face should carry a hole",
            );
        }
        let report = mesh.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after Phase G2 split:\n{}", report.summary());
    }

    #[test]
    fn phase_g3_bridge_endpoint_inside_hole() {
        // Endpoint at (0, 0, 0) is inside the hole — case (c) bridge
        // topology. After the operation, the face should be single (no
        // split) and carry no holes (the hole fused into outer).
        let (mut mesh, f) = build_holed_face();
        let before_faces = mesh.face_count();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 60.0),
            DVec3::new(   0.0, 0.0,  0.0),  // inside 40×40 hole at origin
        ).unwrap_or_else(|e| panic!("case (c) bridge failed: {}", e));

        // Case (c) produces exactly one face (not two — it's a merge, not a split).
        assert_eq!(res.new_faces.len(), 1);
        let nf = res.new_faces[0];
        assert!(
            mesh.faces[nf].inners().is_empty(),
            "bridged face should have zero inner loops, got {}",
            mesh.faces[nf].inners().len(),
        );
        // Total face count stays the same (one face removed, one added).
        assert_eq!(mesh.face_count(), before_faces);

        // Outer loop now includes outer (4) + hole (4) + H twice + A
        // unchanged once = 10 entries in the vertex list (A and H each
        // appear twice due to the bridge).
        let loop_verts = mesh.collect_loop_verts(mesh.faces[nf].outer().start).unwrap();
        assert!(loop_verts.len() >= 9,
            "bridged outer loop should be long (outer + hole + bridge), got {}", loop_verts.len());

        let report = mesh.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after Phase G case (c):\n{}", report.summary());
    }

    #[test]
    fn phase_g3_bridge_start_endpoint_inside() {
        // Symmetric case — start inside hole, end on outer. Same topology
        // as the above but exercises the InsideStart path.
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(   0.0, 0.0,  0.0),  // inside hole
            DVec3::new(-100.0, 0.0, 60.0),
        ).unwrap();
        assert_eq!(res.new_faces.len(), 1);
    }

    #[test]
    fn phase_g3_rejects_both_endpoints_inside_hole() {
        let (mut mesh, f) = build_holed_face();
        let err = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-10.0, 0.0, 0.0),  // both inside
            DVec3::new( 10.0, 0.0, 0.0),
        );
        assert!(err.is_err());
        let msg = err.unwrap_err().to_string();
        assert!(
            msg.contains("both endpoints") || msg.contains("InsideBoth")
                || msg.contains("zero-length"),
            "expected InsideBoth rejection, got: {}", msg,
        );
    }

    /// ADR-023 P8 — Bridge endpoint exactly ON hole vertex.
    /// Cut from outer (-100, 0, 60) to hole vertex h0 (-20, 0, -20).
    /// Expected: bridge fuses hole into outer (similar to case (c) but
    /// the hole-side endpoint coincides with an existing hole vertex
    /// → no edge split needed there.
    #[test]
    fn phase_g4_bridge_endpoint_on_hole_vertex() {
        let (mut mesh, f) = build_holed_face();
        let before_faces = mesh.face_count();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 60.0),
            DVec3::new( -20.0, 0.0, -20.0),  // exactly on hole vertex h0
        ).unwrap_or_else(|e| panic!("P8 endpoint-on-hole-vertex failed: {}", e));

        assert_eq!(res.new_faces.len(), 1, "P8 bridge → 1 face");
        let nf = res.new_faces[0];
        assert!(mesh.faces[nf].inners().is_empty(),
            "P8 bridged face: 0 inner loops, got {}", mesh.faces[nf].inners().len());
        assert_eq!(mesh.face_count(), before_faces);

        let report = mesh.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after P8 endpoint-on-hole-vertex:\n{}", report.summary());
    }

    /// ADR-023 P8 — Two holes; bridge to hole A only; hole B preserved.
    #[test]
    fn phase_g4_bridge_preserves_other_holes() {
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let o0 = m.add_vertex(DVec3::new(-200.0, 0.0, -200.0));
        let o1 = m.add_vertex(DVec3::new( 200.0, 0.0, -200.0));
        let o2 = m.add_vertex(DVec3::new( 200.0, 0.0,  200.0));
        let o3 = m.add_vertex(DVec3::new(-200.0, 0.0,  200.0));
        // Hole A (will be bridged)
        let a0 = m.add_vertex(DVec3::new(-20.0, 0.0, -20.0));
        let a1 = m.add_vertex(DVec3::new(-20.0, 0.0,  20.0));
        let a2 = m.add_vertex(DVec3::new( 20.0, 0.0,  20.0));
        let a3 = m.add_vertex(DVec3::new( 20.0, 0.0, -20.0));
        // Hole B (unaffected)
        let b0 = m.add_vertex(DVec3::new(-20.0, 0.0, 120.0));
        let b1 = m.add_vertex(DVec3::new(-20.0, 0.0, 160.0));
        let b2 = m.add_vertex(DVec3::new( 20.0, 0.0, 160.0));
        let b3 = m.add_vertex(DVec3::new( 20.0, 0.0, 120.0));
        let f = m.add_face_with_holes(
            &[o0, o1, o2, o3],
            &[&[a0, a1, a2, a3], &[b0, b1, b2, b3]],
            mat,
        ).unwrap();

        // Cut from outer to hole A's vertex a0
        let res = split_face_by_line(
            &mut m, f,
            DVec3::new(-200.0, 0.0, -100.0),
            DVec3::new( -20.0, 0.0,  -20.0),  // = a0
        ).unwrap_or_else(|e| panic!("P8 multi-hole bridge failed: {}", e));

        assert_eq!(res.new_faces.len(), 1, "P8: 1 face (bridge fuse)");
        let nf = res.new_faces[0];
        assert_eq!(m.faces[nf].inners().len(), 1,
            "P8: hole B preserved as inner; got {}", m.faces[nf].inners().len());

        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after multi-hole P8 bridge:\n{}", report.summary());
    }

    /// ADR-023 P8 — Bridge endpoint exactly ON hole edge midpoint.
    /// Cut from outer to hole's edge midpoint (-20, 0, 0) (midpoint of h0-h1).
    /// Expected: the hole edge is split at the midpoint, then bridge fuses.
    #[test]
    fn phase_g4_bridge_endpoint_on_hole_edge() {
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 60.0),
            DVec3::new( -20.0, 0.0,   0.0),  // midpoint of hole edge h0-h1
        ).unwrap_or_else(|e| panic!("P8 endpoint-on-hole-edge failed: {}", e));

        assert_eq!(res.new_faces.len(), 1, "P8 bridge → 1 face");
        let nf = res.new_faces[0];
        assert!(mesh.faces[nf].inners().is_empty(),
            "P8 bridged face: 0 inner loops, got {}", mesh.faces[nf].inners().len());

        let report = mesh.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after P8 endpoint-on-hole-edge:\n{}", report.summary());
    }

    #[test]
    fn phase_g_preserves_hole_vertex_count() {
        // After splitting above the hole, the hole's 4 vertices must still
        // form a complete 4-edge loop attached to exactly one face.
        let (mut mesh, f) = build_holed_face();
        let res = split_face_by_line(
            &mut mesh, f,
            DVec3::new(-100.0, 0.0, 60.0),
            DVec3::new( 100.0, 0.0, 60.0),
        ).unwrap();
        for &fid in &res.new_faces {
            for inner in mesh.faces[fid].inners().to_vec() {
                let verts = mesh.collect_loop_verts(inner.start).unwrap();
                assert_eq!(verts.len(), 4, "hole should still have 4 verts");
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // ADR-101 Amendment 10 — 메타-원칙 #15 cross-cut HARD flag enforcement
    //
    // canonical: "동일한 분할 연산은 동일한 topological contract — 빠르고,
    //            신속하고, 정확하게."
    //
    // split-type 함수 모두 split-induced edges 에 HARD flag 부여. Render path
    // 의 angle coplanar test (LOCKED #16 K-ε hotfix) 와 split 의도의 충돌은
    // split-side 의 HARD 로 명시 해소.
    // ════════════════════════════════════════════════════════════════════════

    /// Helper unit — `Mesh::mark_chain_edges_hard` chain 의 모든 edges 의
    /// HEs (radial twin 포함) 에 HARD flag 부여.
    #[test]
    fn adr101_amendment10_helper_mark_chain_edges_hard() {
        use crate::entities::HeFlags;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let (_fid, [v0, v1, v2, v3]) = make_square(&mut m);

        // chain = v0 → v1 → v2 (2 edges of the quad boundary)
        let chain = [v0, v1, v2];
        m.mark_chain_edges_hard(&chain);

        // Verify v0-v1 and v1-v2 edges HARD; v2-v3 untouched.
        let e01 = m.find_edge(v0, v1).expect("v0-v1 edge");
        let e12 = m.find_edge(v1, v2).expect("v1-v2 edge");
        let e23 = m.find_edge(v2, v3).expect("v2-v3 edge");

        let f01 = m.hes[m.edges[e01].any_he()].flags();
        let f12 = m.hes[m.edges[e12].any_he()].flags();
        let f23 = m.hes[m.edges[e23].any_he()].flags();

        assert!(f01.contains(HeFlags::HARD), "v0-v1 (chain) must be HARD");
        assert!(f12.contains(HeFlags::HARD), "v1-v2 (chain) must be HARD");
        assert!(!f23.contains(HeFlags::HARD),
            "v2-v3 (not in chain) must NOT be HARD (preserve scope)");
    }

    /// Helper unit — `Mesh::mark_edges_hard` EdgeId list 직접 입력.
    #[test]
    fn adr101_amendment10_helper_mark_edges_hard() {
        use crate::entities::HeFlags;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let (_fid, [v0, v1, v2, v3]) = make_square(&mut m);

        let e01 = m.find_edge(v0, v1).expect("v0-v1");
        let e23 = m.find_edge(v2, v3).expect("v2-v3");
        m.mark_edges_hard(&[e01, e23]);

        let f01 = m.hes[m.edges[e01].any_he()].flags();
        let f23 = m.hes[m.edges[e23].any_he()].flags();
        let e12 = m.find_edge(v1, v2).expect("v1-v2");
        let f12 = m.hes[m.edges[e12].any_he()].flags();

        assert!(f01.contains(HeFlags::HARD));
        assert!(f23.contains(HeFlags::HARD));
        assert!(!f12.contains(HeFlags::HARD),
            "v1-v2 (not in list) must NOT be HARD");
    }

    /// `split_face_by_chain` 의 chain edges 가 HARD flag 부여 (메타-원칙 #15
    /// canonical). chain edge 가 사전 존재 (add_edge) — split_face_by_chain
    /// API requirement.
    #[test]
    fn adr101_amendment10_split_face_by_chain_marks_hard() {
        use crate::entities::HeFlags;
        let mut m = Mesh::new();
        let mat = MaterialId::new(0);
        let (fid, [v0, _v1, v2, _v3]) = make_square(&mut m);

        // Pre-draw chain edge (v0 → v2 diagonal) — split_face_by_chain
        // requires edges to exist.
        let (chain_edge, _is_new) = m.add_edge(v0, v2).expect("add_edge v0-v2");

        // Diagonal chain v0 → v2 (single segment)
        let chain = [v0, v2];
        let _result = split_face_by_chain(&mut m, fid, &chain, mat)
            .expect("split_face_by_chain OK");

        // Verify chain edge HARD (Amendment 10 fix)
        let flags = m.hes[m.edges[chain_edge].any_he()].flags();
        assert!(flags.contains(HeFlags::HARD),
            "split_face_by_chain chain edge must be HARD (메타-원칙 #15)");
    }
}
