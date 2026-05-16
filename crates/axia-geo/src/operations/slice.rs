//! Volume Slice (Plane Cut) — splits a closed Wall volume into two
//! closed sub-volumes by an arbitrary cutting plane.
//!
//! ## Overview
//!
//! Given a set of Wall faces forming a closed 2-manifold solid and a plane
//! `(origin, normal)`:
//!
//! 1. Classify every vertex by signed plane distance: Above / Below / On.
//! 2. For every edge whose endpoints straddle the plane, `split_edge` at the
//!    intersection point — producing a new "On" vertex shared by both
//!    adjacent faces (radial chain preserved).
//! 3. For every face that crosses, locate the two On vertices on its
//!    boundary and `split_face` between them — producing one Above sub-face
//!    and one Below sub-face plus a chord (cut segment) on the plane.
//! 4. Assemble the chord segments into one or more closed cut loops by
//!    walking shared vertices.
//! 5. For each closed loop create **two cap faces** with opposite winding —
//!    one sealing the Above half (normal pointing −plane_normal toward the
//!    cut), one sealing the Below half (normal pointing +plane_normal).
//! 6. Verify both halves are closed Wall volumes and report classification.
//!
//! ## ADR-007 compliance
//!
//! * Walls remain Walls — the two halves are each a closed manifold so all
//!   sub-faces and the new cap faces classify as `is_face_in_volume == true`.
//! * Winding is the single source of truth — caller can run
//!   `mesh.reconcile_face_normals()` afterwards to refresh cached normals.
//!
//! ## MVP scope (limitations)
//!
//! * Each crossed face must have **exactly two** On vertices after edge
//!   splits (true for convex faces). Non-convex faces with > 2 crossings
//!   bail with a clear error.
//! * Faces lying entirely on the plane bail with an error.
//! * Open volumes (cut loop fails to close) bail with an error.

use anyhow::{Result, bail, ensure};
use glam::DVec3;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{FaceId, EdgeId, VertId, MaterialId};
use crate::mesh::Mesh;

/// Tolerance for "vertex on plane" classification. Below this absolute
/// signed distance the vertex is treated as exactly on the cut plane.
const PLANE_EPS: f64 = 1e-4; // 0.1 µm — tighter than VERTEX_TOLERANCE.

#[derive(Debug, Clone, Copy)]
pub struct SlicePlane {
    pub origin: DVec3,
    /// Must be a unit vector. Caller normalizes before passing.
    pub normal: DVec3,
}

impl SlicePlane {
    pub fn new(origin: DVec3, normal: DVec3) -> Result<Self> {
        let len = normal.length();
        ensure!(len > 1e-9, "SlicePlane: normal is degenerate (length {})", len);
        Ok(Self { origin, normal: normal / len })
    }
    #[inline]
    pub fn signed_distance(&self, p: DVec3) -> f64 {
        (p - self.origin).dot(self.normal)
    }
}

#[derive(Debug, Clone)]
pub struct SliceResult {
    /// Wall sub-faces lying on the +normal side (plus any cap_above).
    pub above_walls: Vec<FaceId>,
    /// Wall sub-faces lying on the −normal side (plus any cap_below).
    pub below_walls: Vec<FaceId>,
    /// Cap face(s) sealing the above half (one per cut loop).
    pub cap_above: Vec<FaceId>,
    /// Cap face(s) sealing the below half (one per cut loop, twin winding).
    pub cap_below: Vec<FaceId>,
    /// Cut loops as ordered vertex sequences (for visualization / tests).
    pub cut_loops: Vec<Vec<VertId>>,
}

/// Per-vertex plane classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VC { Above, Below, On }

fn classify(d: f64) -> VC {
    if d >  PLANE_EPS { VC::Above }
    else if d < -PLANE_EPS { VC::Below }
    else { VC::On }
}

impl Mesh {
    /// Slice a closed volume defined by `face_ids` with `plane`.
    ///
    /// On success the volume's faces are split in-place and two cap face
    /// pairs (above / below) are inserted. Returns the classification of
    /// every resulting face plus the cut loops.
    pub fn slice_volume_by_plane(
        &mut self,
        face_ids: &[FaceId],
        plane: SlicePlane,
        material: MaterialId,
    ) -> Result<SliceResult> {
        // ── 0. Validate ──────────────────────────────────────────────────
        ensure!(!face_ids.is_empty(), "slice_volume_by_plane: empty face set");
        let _face_set: FxHashSet<FaceId> = face_ids.iter().copied().collect();
        for &fid in face_ids {
            let face = self.faces.get(fid)
                .ok_or_else(|| anyhow::anyhow!("slice: face {:?} not found", fid))?;
            ensure!(face.is_active(), "slice: face {:?} inactive", fid);
            ensure!(face.inners().is_empty(),
                "slice: face {:?} has holes — not yet supported", fid);
        }
        // Soft check: input should form a closed volume. If any face is a
        // Sheet (free boundary in this set) we still proceed but the cut
        // loops won't close and we'll bail later with a precise message.

        // ── 1. Collect all unique edges in the input face set ───────────
        let mut edge_owners: FxHashMap<EdgeId, Vec<FaceId>> = FxHashMap::default();
        for &fid in face_ids {
            for eid in self.face_outer_edges(fid)? {
                edge_owners.entry(eid).or_default().push(fid);
            }
        }

        // ── 2. Split crossing edges; record produced "On" verts ─────────
        // Map: original edge → new On vert (so all faces sharing that edge
        // pick up the same vertex, which is automatic via radial chain but
        // this map lets us detect duplicates).
        let mut edge_cut_vert: FxHashMap<EdgeId, VertId> = FxHashMap::default();
        // We mutate edges, so iterate over a snapshot of edge ids.
        let edges_snapshot: Vec<EdgeId> = edge_owners.keys().copied().collect();
        for eid in edges_snapshot {
            let edge = match self.edges.get(eid) {
                Some(e) if e.is_active() => e,
                _ => continue,
            };
            let va = edge.v_small();
            let vb = edge.v_large();
            let pa = self.verts.get(va).map(|v| v.pos()).unwrap_or(DVec3::ZERO);
            let pb = self.verts.get(vb).map(|v| v.pos()).unwrap_or(DVec3::ZERO);
            let da = plane.signed_distance(pa);
            let db = plane.signed_distance(pb);
            let ca = classify(da);
            let cb = classify(db);

            // Strict crossing only (Above ↔ Below). On-vertex edges handled
            // implicitly without splitting.
            let crosses = matches!(
                (ca, cb),
                (VC::Above, VC::Below) | (VC::Below, VC::Above)
            );
            if !crosses { continue; }

            let t = da / (da - db); // d=0 at this t, monotonic since signs differ
            let pos = pa + (pb - pa) * t;
            let (new_v, _e1, _e2) = self.split_edge(eid, pos)?;
            edge_cut_vert.insert(eid, new_v);
        }

        // ── 3. Re-classify each input face after edge splits ────────────
        // For each face determine: AllAbove / AllBelow / AllOn / Crossing.
        // For Crossing collect the two "On" verts on its boundary.

        #[derive(Debug)]
        struct CrossInfo {
            face: FaceId,
            cut_a: VertId,
            cut_b: VertId,
        }

        let mut all_above: Vec<FaceId> = Vec::new();
        let mut all_below: Vec<FaceId> = Vec::new();
        let mut crossings: Vec<CrossInfo> = Vec::new();

        for &fid in face_ids {
            let outer_start = self.faces[fid].outer().start;
            let loop_verts = self.collect_loop_verts(outer_start)?;
            let mut above_count = 0usize;
            let mut below_count = 0usize;
            let mut on_verts: Vec<VertId> = Vec::new();

            for &v in &loop_verts {
                let p = self.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO);
                match classify(plane.signed_distance(p)) {
                    VC::Above => above_count += 1,
                    VC::Below => below_count += 1,
                    VC::On => on_verts.push(v),
                }
            }

            if above_count > 0 && below_count == 0 {
                all_above.push(fid);
                continue;
            }
            if below_count > 0 && above_count == 0 {
                all_below.push(fid);
                continue;
            }
            if above_count == 0 && below_count == 0 {
                bail!("slice: face {:?} lies entirely on the cut plane — \
                    refuse (would create degenerate volume)", fid);
            }

            // Crossing — must have exactly 2 distinct On verts.
            // Collapse duplicates (an On vert can appear once per loop slot).
            let mut dedup_on: Vec<VertId> = Vec::new();
            for v in on_verts {
                if !dedup_on.contains(&v) { dedup_on.push(v); }
            }
            if dedup_on.len() != 2 {
                bail!(
                    "slice: face {:?} has {} on-plane vertices after edge \
                    splits (expected exactly 2 — convex faces only in MVP)",
                    fid, dedup_on.len()
                );
            }
            crossings.push(CrossInfo { face: fid, cut_a: dedup_on[0], cut_b: dedup_on[1] });
        }

        if crossings.is_empty() {
            bail!("slice: plane does not cross any face of the volume");
        }

        // ── 4. split_face on each crossing — record sub-face classification
        // We need to know which sub-face is Above vs Below. After
        // split_face(face, v1, v2), we get (face_a, face_b). Walk each
        // result face's loop and check whether its non-On verts are above
        // or below.

        let mut wall_above: Vec<FaceId> = Vec::new();
        let mut wall_below: Vec<FaceId> = Vec::new();

        // Pre-fill all-above / all-below faces.
        wall_above.extend(all_above.iter().copied());
        wall_below.extend(all_below.iter().copied());

        // Track the chord segments for cut-loop assembly.
        // Each chord is an unordered pair {cut_a, cut_b} of On verts.
        let mut chords: Vec<(VertId, VertId)> = Vec::new();

        for ci in &crossings {
            // Verify the original face is still active (split_edge in step 2
            // doesn't destroy faces, only re-routes hes — so face id stable).
            if !self.faces.contains(ci.face) || !self.faces[ci.face].is_active() {
                bail!("slice: face {:?} disappeared before split_face", ci.face);
            }
            let (fa, fb) = self.split_face(ci.face, ci.cut_a, ci.cut_b)?;
            // Classify each sub-face by checking its non-On verts.
            let side_fa = side_of_face(self, fa, plane)?;
            let side_fb = side_of_face(self, fb, plane)?;
            match (side_fa, side_fb) {
                (Side::Above, Side::Below) => { wall_above.push(fa); wall_below.push(fb); }
                (Side::Below, Side::Above) => { wall_above.push(fb); wall_below.push(fa); }
                _ => bail!(
                    "slice: split_face produced inconsistent sides for face {:?} \
                    (sub {:?}={:?}, sub {:?}={:?}) — non-convex face?",
                    ci.face, fa, side_fa, fb, side_fb
                ),
            }
            chords.push((ci.cut_a, ci.cut_b));
        }

        // ── 5. Assemble closed cut loops from chords ────────────────────
        let cut_loops = assemble_loops(&chords)?;
        if cut_loops.is_empty() {
            bail!("slice: no closed cut loops formed — input volume may not be closed");
        }

        // ── 5.5. Detach the below half so the two halves are
        // topologically independent (ADR-007 I5: edge ≤ 2 active faces). ──
        //
        // Strategy: duplicate every cut-loop vertex; rebuild every below
        // sub-wall (and any all-below face that touches a cut vert) with
        // the duplicates substituted in. Above half stays untouched.
        let cut_verts_set: FxHashSet<VertId> = chords.iter()
            .flat_map(|&(a, b)| [a, b].into_iter())
            .collect();
        let mut cut_vert_dup: FxHashMap<VertId, VertId> = FxHashMap::default();
        for &v in &cut_verts_set {
            let p = self.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO);
            let v2 = self.add_vertex_force_new(p);
            cut_vert_dup.insert(v, v2);
        }

        let old_below = wall_below.clone();
        let mut new_below: Vec<FaceId> = Vec::with_capacity(old_below.len());
        for &fid in &old_below {
            // Walk the loop; if any vert is in cut_verts_set, we must rebuild.
            let outer_start = self.faces[fid].outer().start;
            let loop_verts = self.collect_loop_verts(outer_start)?;
            let touches_cut = loop_verts.iter().any(|v| cut_verts_set.contains(v));
            if !touches_cut {
                new_below.push(fid);
                continue;
            }
            let mat_b = self.faces[fid].material();
            let substituted: Vec<VertId> = loop_verts.iter()
                .map(|&v| cut_vert_dup.get(&v).copied().unwrap_or(v))
                .collect();
            self.remove_face(fid)?;
            let new_fid = self.add_face(&substituted, mat_b)?;
            new_below.push(new_fid);
        }
        wall_below = new_below;

        // Build the duplicate cut loops for cap_below.
        let cut_loops_below: Vec<Vec<VertId>> = cut_loops.iter()
            .map(|loop_verts| loop_verts.iter()
                .map(|v| cut_vert_dup.get(v).copied().unwrap_or(*v))
                .collect())
            .collect();

        // ── 6. Build cap faces — one per loop per half, opposite windings.
        // cap_above uses original cut verts; cap_below uses duplicates.
        let mut cap_above: Vec<FaceId> = Vec::new();
        let mut cap_below: Vec<FaceId> = Vec::new();

        for (loop_verts, loop_verts_below) in cut_loops.iter().zip(cut_loops_below.iter()) {
            // Cap face winding rule:
            //   The above half's interior sits on the +normal side of the
            //   plane. The cap closing its underside has front (winding
            //   normal) pointing AWAY from that interior → −plane.normal.
            //   Symmetric for cap_below: its outward normal = +plane.normal.
            let oriented_above = orient_loop_for_normal(self, loop_verts, -plane.normal)?;
            let cap_a = self.add_face(&oriented_above, material)?;
            let oriented_below = orient_loop_for_normal(self, loop_verts_below, plane.normal)?;
            let cap_b = self.add_face(&oriented_below, material)?;

            cap_above.push(cap_a);
            cap_below.push(cap_b);
        }

        // ── 7. Refresh cached normals from new winding ──────────────────
        let _ = self.reconcile_face_normals();

        // ── 8. Verify the two halves are now closed Walls (debug only) ──
        let mut all_above_set = wall_above.clone();
        all_above_set.extend(cap_above.iter().copied());
        let mut all_below_set = wall_below.clone();
        all_below_set.extend(cap_below.iter().copied());

        let above_info = self.face_set_manifold_info(&all_above_set);
        let below_info = self.face_set_manifold_info(&all_below_set);
        if above_info.boundary_edge_count > 0 {
            bail!(
                "slice: above half not closed (boundary edges = {}) — \
                cap topology error",
                above_info.boundary_edge_count
            );
        }
        if below_info.boundary_edge_count > 0 {
            bail!(
                "slice: below half not closed (boundary edges = {})",
                below_info.boundary_edge_count
            );
        }

        // ADR-007 invariants
        self.debug_verify_invariants();

        // Convert cut_loops to result-shape (Vec<Vec<VertId>>).
        let cut_loops_out: Vec<Vec<VertId>> = cut_loops;

        Ok(SliceResult {
            above_walls: wall_above,
            below_walls: wall_below,
            cap_above,
            cap_below,
            cut_loops: cut_loops_out,
        })
    }
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side { Above, Below }

/// Determine which side of `plane` a face lies on after split_face.
/// At least one non-on vertex is required. On-only faces are an error.
fn side_of_face(mesh: &Mesh, fid: FaceId, plane: SlicePlane) -> Result<Side> {
    let outer_start = mesh.faces[fid].outer().start;
    let verts = mesh.collect_loop_verts(outer_start)?;
    for v in verts {
        let p = mesh.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO);
        let d = plane.signed_distance(p);
        if d >  PLANE_EPS { return Ok(Side::Above); }
        if d < -PLANE_EPS { return Ok(Side::Below); }
    }
    bail!("side_of_face: face {:?} has no off-plane vertex", fid);
}

/// Walk shared vertices to build closed loops from unordered chord segments.
///
/// Each chord {a, b} contributes two endpoint references. Build vertex →
/// chord index multi-map; pick an unvisited chord and traverse, hopping
/// through shared vertices, until we return to the start.
fn assemble_loops(chords: &[(VertId, VertId)]) -> Result<Vec<Vec<VertId>>> {
    if chords.is_empty() { return Ok(Vec::new()); }
    let n = chords.len();
    let mut adj: FxHashMap<VertId, Vec<usize>> = FxHashMap::default();
    for (i, &(a, b)) in chords.iter().enumerate() {
        adj.entry(a).or_default().push(i);
        adj.entry(b).or_default().push(i);
    }
    // Sanity: each cut vertex must have degree exactly 2 in the chord graph
    // for a closed manifold cut. Higher degree means non-manifold cut.
    for (v, list) in &adj {
        if list.len() != 2 {
            bail!(
                "slice/assemble_loops: cut vertex {:?} has degree {} (expected 2) — \
                non-manifold cut",
                v, list.len()
            );
        }
    }

    let mut used = vec![false; n];
    let mut loops: Vec<Vec<VertId>> = Vec::new();

    for start_idx in 0..n {
        if used[start_idx] { continue; }
        let (s_a, s_b) = chords[start_idx];
        let mut loop_verts: Vec<VertId> = vec![s_a, s_b];
        used[start_idx] = true;
        let mut current_v = s_b;
        let mut prev_idx = start_idx;
        loop {
            // Find the other chord at current_v.
            let neighbors = &adj[&current_v];
            let next_idx = if neighbors[0] == prev_idx { neighbors[1] } else { neighbors[0] };
            if used[next_idx] {
                if next_idx == start_idx { break; }
                bail!("slice/assemble_loops: traversal revisited used chord — corrupted graph");
            }
            used[next_idx] = true;
            let (na, nb) = chords[next_idx];
            let next_v = if na == current_v { nb } else { na };
            if next_v == s_a {
                // closed
                break;
            }
            loop_verts.push(next_v);
            prev_idx = next_idx;
            current_v = next_v;
            if loop_verts.len() > n + 1 {
                bail!("slice/assemble_loops: traversal exceeded chord count — runaway");
            }
        }
        loops.push(loop_verts);
    }

    Ok(loops)
}

/// Reorder a closed loop's vertices so that the polygon's winding produces
/// a face normal aligned with `desired_normal` (within positive dot
/// product). Uses Newell's signed-area formula for robustness.
fn orient_loop_for_normal(
    mesh: &Mesh,
    loop_verts: &[VertId],
    desired_normal: DVec3,
) -> Result<Vec<VertId>> {
    ensure!(loop_verts.len() >= 3, "orient_loop: degenerate loop ({})", loop_verts.len());
    let pts: Vec<DVec3> = loop_verts.iter()
        .map(|&v| mesh.verts.get(v).map(|x| x.pos()).unwrap_or(DVec3::ZERO))
        .collect();

    // Newell's method
    let mut nrm = DVec3::ZERO;
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        nrm.x += (a.y - b.y) * (a.z + b.z);
        nrm.y += (a.z - b.z) * (a.x + b.x);
        nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    if nrm.length() < 1e-12 {
        bail!("orient_loop: degenerate (collinear) loop");
    }

    let mut out: Vec<VertId> = loop_verts.to_vec();
    if nrm.dot(desired_normal) < 0.0 {
        out.reverse();
    }
    Ok(out)
}
