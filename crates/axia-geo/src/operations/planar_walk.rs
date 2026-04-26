//! Left-turn chain enumeration for ADR-008 M1 (Mixed-Cycle Split).
//!
//! Replaces the older BFS-based `find_mixed_cycle_chain`. The BFS variant
//! returned the first chain encountered, which made M1 non-deterministic
//! (depending on slot-map iteration order) and occasionally cut along
//! wrong topology when multiple chains were possible.
//!
//! ## Algorithm
//!
//! For a target face F with free interior edges that connect boundary
//! vertices, we want the chain that "tightly hugs" the face boundary —
//! i.e. the chain that, together with the boundary arc between its two
//! endpoints, encloses no other free edges. The classical PSLG result
//! (de Berg et al, *Computational Geometry*) is that this is found by
//! the **left-turn** rule:
//!
//!   At each vertex along the walk, pick the next edge that makes the
//!   *smallest counter-clockwise turn* from the reverse of the incoming
//!   direction (equivalently — sweep CCW from the reverse of the
//!   incoming edge and pick the first free edge encountered).
//!
//! For each (entry, first-spoke) pair, the left-turn walk produces a
//! deterministic chain. Enumerating over all such pairs and dedup'ing
//! gives the full set of chains across F.
//!
//! ## API
//!
//! * [`find_all_left_turn_paths`] — return every distinct chain
//! * [`find_first_left_turn_path`] — convenience: shortest chain found

use rustc_hash::FxHashSet;
use std::f64::consts::TAU;

use crate::{FaceId, VertId};
use crate::mesh::Mesh;

/// Find every distinct boundary-to-boundary free-edge chain on `face_id`
/// using the left-turn rule. The chains are deduplicated up to direction
/// (i.e. `[a, b, c]` and `[c, b, a]` are considered the same).
pub fn find_all_left_turn_paths(mesh: &Mesh, face_id: FaceId) -> Vec<Vec<VertId>> {
    let Some(face) = mesh.faces.get(face_id) else { return Vec::new(); };
    let boundary = match mesh.collect_loop_verts(face.outer().start) {
        Ok(b) if b.len() >= 3 => b,
        _ => return Vec::new(),
    };
    let boundary_set: FxHashSet<VertId> = boundary.iter().copied().collect();

    // Build face's plane basis from boundary verts.
    let pts: Vec<glam::DVec3> = boundary.iter()
        .filter_map(|&v| mesh.verts.get(v).map(|x| x.pos()))
        .collect();
    if pts.len() < 3 { return Vec::new(); }
    let origin = pts[0];

    // Pick a stable u (direction to the first vertex distinct from origin).
    let mut u = glam::DVec3::ZERO;
    for p in &pts[1..] {
        let d = *p - origin;
        if d.length_squared() > 1e-12 { u = d.normalize(); break; }
    }
    if u.length_squared() < 1e-10 { return Vec::new(); }

    // Compute face normal from cached value (fall back to Newell on the
    // boundary if cache is zero — should be filled by reconcile but be safe).
    let normal_cached = face.normal();
    let normal = if normal_cached.length_squared() > 1e-12 {
        normal_cached.normalize()
    } else {
        // Newell's method on boundary
        let mut n = glam::DVec3::ZERO;
        for i in 0..pts.len() {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            n.x += (a.y - b.y) * (a.z + b.z);
            n.y += (a.z - b.z) * (a.x + b.x);
            n.z += (a.x - b.x) * (a.y + b.y);
        }
        if n.length_squared() < 1e-12 { return Vec::new(); }
        n.normalize()
    };

    // Re-orthogonalise u with respect to normal (in case the chosen u
    // wasn't quite in-plane due to coplanarity tolerance).
    let u_proj = u - normal * normal.dot(u);
    let u = if u_proj.length_squared() > 1e-12 { u_proj.normalize() } else { u };
    let v = normal.cross(u).normalize();

    // 2D projection helper (None on missing vertex).
    let project = |vid: VertId| -> Option<(f64, f64)> {
        let p = mesh.verts.get(vid)?.pos();
        let d = p - origin;
        Some((d.dot(u), d.dot(v)))
    };

    // List free spokes incident to a vertex (edges with no face on either
    // side, of topological class).
    let free_spokes = |vid: VertId| -> Vec<VertId> {
        let mut out = Vec::new();
        for (eid, edge) in mesh.edges.iter() {
            if !edge.is_active() { continue; }
            if !edge.class().is_topological() { continue; }
            if !mesh.is_edge_completely_free(eid) { continue; }
            if edge.v_small() == vid {
                out.push(edge.v_large());
            } else if edge.v_large() == vid {
                out.push(edge.v_small());
            }
        }
        out
    };

    // Walk a single left-turn path starting from (entry → start) and
    // ending when we hit a boundary vertex (success) or get stuck (None).
    let walk = |entry: VertId, start: VertId| -> Option<Vec<VertId>> {
        let mut chain: Vec<VertId> = vec![entry, start];
        let mut visited: FxHashSet<VertId> = chain.iter().copied().collect();
        let mut prev = entry;
        let mut cur = start;
        // Bound walk length to avoid runaway on pathological inputs.
        for _step in 0..512 {
            if boundary_set.contains(&cur) && cur != entry {
                // Validate: interior verts (chain[1..len-1]) must not be on boundary.
                let interior_ok = chain[1..chain.len()-1].iter()
                    .all(|v| !boundary_set.contains(v));
                if !interior_ok { return None; }
                if chain.len() < 2 { return None; }
                return Some(chain);
            }
            // Pick next: leftmost CCW turn from reverse of incoming.
            let p_prev = project(prev)?;
            let p_cur = project(cur)?;
            let in_dx = p_cur.0 - p_prev.0;
            let in_dy = p_cur.1 - p_prev.1;
            // -in (the "outgoing" direction the boundary HE sees if prev→cur ended here).
            let neg_in = (-in_dx, -in_dy);

            let candidates: Vec<VertId> = free_spokes(cur).into_iter()
                .filter(|n| *n != prev && !visited.contains(n))
                .collect();
            if candidates.is_empty() { return None; }

            let mut best: Option<(VertId, f64)> = None;
            for n in candidates {
                let p_n = project(n)?;
                let out = (p_n.0 - p_cur.0, p_n.1 - p_cur.1);
                let angle = ccw_angle(neg_in, out);
                // Smallest positive CCW angle = leftmost turn.
                match best {
                    None => best = Some((n, angle)),
                    Some((_, a)) if angle < a => best = Some((n, angle)),
                    _ => {}
                }
            }
            let (next, _) = best?;
            chain.push(next);
            visited.insert(next);
            prev = cur;
            cur = next;
        }
        None
    };

    // Enumerate from every boundary entry × every free spoke.
    let mut paths: Vec<Vec<VertId>> = Vec::new();
    for &entry in &boundary {
        for first in free_spokes(entry) {
            // Skip degenerate: spoke directly to another boundary vert that's
            // adjacent on the boundary loop (would be a parallel-to-edge cut).
            if boundary_set.contains(&first) {
                let i_a = match boundary.iter().position(|v| *v == entry) {
                    Some(i) => i, None => continue,
                };
                let i_b = match boundary.iter().position(|v| *v == first) {
                    Some(i) => i, None => continue,
                };
                let diff = if i_a < i_b { i_b - i_a } else { i_a - i_b };
                let wrap = boundary.len() - diff;
                if diff == 1 || wrap == 1 { continue; }
                paths.push(vec![entry, first]);
                continue;
            }
            if let Some(p) = walk(entry, first) {
                paths.push(p);
            }
        }
    }

    // Dedup: treat chains as equal up to reversal. Use the canonical form
    // where the chain is rotated so the smaller endpoint id comes first.
    paths.sort_by(|a, b| {
        let ka = canonical_key(a);
        let kb = canonical_key(b);
        ka.cmp(&kb)
    });
    paths.dedup_by(|a, b| canonical_key(a) == canonical_key(b));
    paths
}

/// Convenience wrapper: return the shortest left-turn chain (deterministic
/// tiebreak by canonical key). Callers replacing the old BFS-based finder
/// can drop this in.
pub fn find_first_left_turn_path(mesh: &Mesh, face_id: FaceId) -> Option<Vec<VertId>> {
    let mut paths = find_all_left_turn_paths(mesh, face_id);
    if paths.is_empty() { return None; }
    paths.sort_by(|a, b| {
        a.len().cmp(&b.len())
            .then_with(|| canonical_key(a).cmp(&canonical_key(b)))
    });
    Some(paths.remove(0))
}

// ── Helpers ────────────────────────────────────────────────────────

#[inline]
fn ccw_angle(from: (f64, f64), to: (f64, f64)) -> f64 {
    // CCW angle from `from` to `to` in [0, 2π).
    let cos_a = to.0 * from.0 + to.1 * from.1;
    let sin_a = from.0 * to.1 - from.1 * to.0; // cross z component (=sin·|a||b|)
    let a = sin_a.atan2(cos_a);
    if a < 0.0 { a + TAU } else { a }
}

fn canonical_key(chain: &[VertId]) -> Vec<u32> {
    let raws: Vec<u32> = chain.iter().map(|v| v.raw()).collect();
    let rev: Vec<u32> = raws.iter().rev().copied().collect();
    if raws < rev { raws } else { rev }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;
    use glam::DVec3;

    /// Build a 4×4 rectangle face with a single internal free edge from
    /// midpoint of left edge to midpoint of right edge.
    fn rect_with_interior_chord(mesh: &mut Mesh, m: MaterialId) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(4.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(4.0, 4.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 4.0, 0.0));
        // Splits at midpoints
        let v_mid_l = mesh.add_vertex(DVec3::new(0.0, 2.0, 0.0));
        let v_mid_r = mesh.add_vertex(DVec3::new(4.0, 2.0, 0.0));
        // Build face with the midpoint verts on its outer loop.
        let fid = mesh.add_face(&[v0, v1, v_mid_r, v2, v3, v_mid_l], m).unwrap();
        // Add a free edge from v_mid_l to v_mid_r (interior chord).
        let _ = mesh.add_edge(v_mid_l, v_mid_r).unwrap();
        fid
    }

    #[test]
    fn finds_simple_chord() {
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let fid = rect_with_interior_chord(&mut mesh, m);
        let paths = find_all_left_turn_paths(&mesh, fid);
        assert_eq!(paths.len(), 1, "expected one chord chain");
        assert_eq!(paths[0].len(), 2, "chord chain has 2 verts");
    }

    #[test]
    fn first_path_returns_some_for_chord() {
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let fid = rect_with_interior_chord(&mut mesh, m);
        assert!(find_first_left_turn_path(&mesh, fid).is_some());
    }

    #[test]
    fn no_paths_when_no_free_edges() {
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let fid = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();
        assert!(find_all_left_turn_paths(&mesh, fid).is_empty());
        assert!(find_first_left_turn_path(&mesh, fid).is_none());
    }

    #[test]
    fn multi_chain_face_enumerates_all() {
        // A hexagonal face with TWO independent free chords across it:
        // splits going from one side to the opposite side, non-intersecting.
        let mut mesh = Mesh::new();
        let m = MaterialId::new(0);
        // Hex with verts at angles 0,60,...,300 on radius 4
        let mut hex_verts = Vec::new();
        for i in 0..6 {
            let theta = (i as f64) * std::f64::consts::PI / 3.0;
            let p = DVec3::new(4.0 * theta.cos(), 4.0 * theta.sin(), 0.0);
            hex_verts.push(mesh.add_vertex(p));
        }
        // Insert two midpoints on edges 0 (v0→v1) and 3 (v3→v4) — these
        // become boundary entries for two separate chords.
        let m_01 = mesh.add_vertex(DVec3::new(
            (mesh.verts[hex_verts[0]].pos().x + mesh.verts[hex_verts[1]].pos().x) * 0.5,
            (mesh.verts[hex_verts[0]].pos().y + mesh.verts[hex_verts[1]].pos().y) * 0.5,
            0.0,
        ));
        let m_34 = mesh.add_vertex(DVec3::new(
            (mesh.verts[hex_verts[3]].pos().x + mesh.verts[hex_verts[4]].pos().x) * 0.5,
            (mesh.verts[hex_verts[3]].pos().y + mesh.verts[hex_verts[4]].pos().y) * 0.5,
            0.0,
        ));
        let fid = mesh.add_face(
            &[hex_verts[0], m_01, hex_verts[1], hex_verts[2], hex_verts[3], m_34, hex_verts[4], hex_verts[5]],
            m,
        ).unwrap();
        // Two chords from m_01 → hex_verts[3], and m_34 → hex_verts[0]:
        // both connect a midpoint to a non-adjacent boundary vert.
        let _ = mesh.add_edge(m_01, hex_verts[3]).unwrap();
        let _ = mesh.add_edge(m_34, hex_verts[0]).unwrap();

        let paths = find_all_left_turn_paths(&mesh, fid);
        assert_eq!(paths.len(), 2, "expected exactly two chord chains, got {}", paths.len());
    }
}
