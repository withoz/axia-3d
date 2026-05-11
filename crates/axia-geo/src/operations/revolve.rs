//! Revolve (lathe) operation — rotate a 2D profile around an axis.
//!
//! Takes a polyline profile (≥2 points, expected in a plane containing the
//! rotation axis) and spins it through `segments` angular steps to form a
//! surface of revolution. Classic CAD operation for vases, columns, tapered
//! organic shapes, and animal body parts.
//!
//! ## Profile orientation
//!
//! Profile points are ordered in the direction the face normal should curl
//! around with rotation (right-hand rule around `axis_dir`). For a "vase
//! standing up" around the +Y axis, order the profile from the bottom rim
//! going up to the top rim — then the generated surface faces outward.
//! If a user passes it in reverse, every face is inverted; they can follow
//! up with `flip_face` or reorder the profile.
//!
//! ## Pole handling
//!
//! If a profile point lies ON the axis (within `EPSILON_LENGTH * 10`), all
//! rings share a single "pole" vertex for that point. Adjacent faces
//! collapse from quads to triangles (a proper fan at the pole), avoiding
//! the spatial-hash dedup bug that polar singularities caused in the
//! sphere primitive (ADR-007).

use anyhow::{Result, bail, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;
use crate::tolerances::EPSILON_LENGTH;

impl Mesh {
    /// Generate a surface of revolution from `profile` around the line
    /// `(axis_origin, axis_dir)`. Returns the FaceIds of every generated
    /// side face in profile-major, ring-minor order.
    ///
    /// `profile.len() ≥ 2`, `segments ≥ 3`. Non-zero axis. No endcaps
    /// are generated (caller adds them if needed).
    pub fn revolve(
        &mut self,
        profile: &[DVec3],
        axis_origin: DVec3,
        axis_dir: DVec3,
        segments: u32,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        // ─── Guards (ADR-003) ───────────────────────────────────────
        ensure!(
            profile.len() >= 2,
            "revolve: profile needs at least 2 points, got {}",
            profile.len(),
        );
        ensure!(segments >= 3, "revolve: segments must be ≥ 3, got {}", segments);
        ensure!(
            axis_dir.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "revolve: axis direction must be a non-zero vector",
        );
        ensure!(
            axis_origin.x.is_finite() && axis_origin.y.is_finite() && axis_origin.z.is_finite(),
            "revolve: axis origin must be finite",
        );
        for (i, p) in profile.iter().enumerate() {
            ensure!(
                p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                "revolve: profile[{}] must be finite, got {:?}", i, p,
            );
        }

        let axis_n = axis_dir.normalize();
        let n_profile = profile.len();
        let n_rings = segments as usize;
        let pole_threshold = EPSILON_LENGTH * 10.0;

        // ─── Detect pole points (on axis) ────────────────────────────
        // A pole point is shared by all rings; it saves N-1 duplicates
        // and keeps the topology manifold (see sphere fix in ADR-007).
        let mut is_pole = vec![false; n_profile];
        for (i, &p) in profile.iter().enumerate() {
            let rel = p - axis_origin;
            let axial = rel.dot(axis_n);
            let radial = rel - axis_n * axial;
            if radial.length() < pole_threshold {
                is_pole[i] = true;
            }
        }

        // ─── Allocate ring vertices ──────────────────────────────────
        // rings[k][i] = vertex id for ring k, profile index i.
        let mut rings: Vec<Vec<VertId>> = Vec::with_capacity(n_rings);
        let mut pole_verts: Vec<Option<VertId>> = vec![None; n_profile];

        for k in 0..n_rings {
            let theta = (k as f64) * (2.0 * std::f64::consts::PI / (segments as f64));
            let mut ring: Vec<VertId> = Vec::with_capacity(n_profile);
            for (i, &p) in profile.iter().enumerate() {
                if is_pole[i] {
                    let v = match pole_verts[i] {
                        Some(v) => v,
                        None => {
                            let new_v = self.add_vertex(p);
                            pole_verts[i] = Some(new_v);
                            new_v
                        }
                    };
                    ring.push(v);
                } else {
                    let rotated = rotate_around_axis(p, axis_origin, axis_n, theta);
                    ring.push(self.add_vertex(rotated));
                }
            }
            rings.push(ring);
        }

        // ─── Build side faces ────────────────────────────────────────
        // Winding [v00, v10, v11, v01] where v00=ring_k[i], v01=ring_k[i+1],
        // v10=ring_{k+1}[i], v11=ring_{k+1}[i+1].
        //
        // Right-hand rotation around axis_dir takes a point on +radial
        // toward -cross(axis, radial). Under that convention the above
        // walk yields an outward-facing normal (radially away from axis)
        // when `profile` is ordered along +axis_dir. Pole cases collapse
        // to triangles.
        let mut new_faces = Vec::with_capacity((n_profile - 1) * n_rings);
        for k in 0..n_rings {
            let k_next = (k + 1) % n_rings;
            for i in 0..(n_profile - 1) {
                let v00 = rings[k][i];
                let v01 = rings[k][i + 1];
                let v10 = rings[k_next][i];
                let v11 = rings[k_next][i + 1];
                let pi_pole = is_pole[i];
                let pi1_pole = is_pole[i + 1];

                if pi_pole && pi1_pole {
                    // Entire profile segment on axis — nothing to revolve
                    continue;
                } else if pi_pole {
                    // v00 == v10 (pole). Quad [v00, v10, v11, v01] collapses
                    // to triangle [pole, v11, v01].
                    let fid = self.add_face_with_holes(&[v00, v11, v01], &[], material)?;
                    new_faces.push(fid);
                } else if pi1_pole {
                    // v01 == v11 (pole). Quad collapses to [v00, v10, pole].
                    let fid = self.add_face_with_holes(&[v00, v10, v01], &[], material)?;
                    new_faces.push(fid);
                } else {
                    let fid = self.add_face_with_holes(&[v00, v10, v11, v01], &[], material)?;
                    new_faces.push(fid);
                }
            }
        }

        // ADR-007 — verify winding & topology
        self.debug_verify_invariants();

        Ok(new_faces)
    }
}

/// Rotate point `p` around line `(origin, axis_unit)` by `angle` radians
/// using Rodrigues' formula. `axis_unit` must be normalized.
#[inline]
fn rotate_around_axis(p: DVec3, origin: DVec3, axis_unit: DVec3, angle: f64) -> DVec3 {
    let v = p - origin;
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    let rotated = v * cos_a
        + axis_unit.cross(v) * sin_a
        + axis_unit * (axis_unit.dot(v) * (1.0 - cos_a));
    origin + rotated
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Straight vertical line of radius 1, height 2, revolve around Y axis
    /// → open cylinder shell. N_side_faces = (profile_pts-1) * segments.
    #[test]
    fn revolve_vertical_line_produces_cylinder_shell() {
        let mut m = Mesh::new();
        let profile = vec![
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
        ];
        let faces = m.revolve(
            &profile,
            DVec3::ZERO,
            DVec3::Y,
            12,
            MaterialId::new(0),
        ).unwrap();
        assert_eq!(faces.len(), 12, "cylinder should have 12 side quads");
        // No poles — every face is a quad (4 verts)
        for &f in &faces {
            let verts = m.collect_loop_verts(m.faces[f].outer().start).unwrap();
            assert_eq!(verts.len(), 4, "non-pole face should be a quad");
        }
    }

    /// Profile touches axis at top (pole) — fan of triangles.
    #[test]
    fn revolve_with_top_pole_produces_triangles() {
        let mut m = Mesh::new();
        // Cone: base at radius 1, apex on axis
        let profile = vec![
            DVec3::new(1.0, 0.0, 0.0),   // base rim
            DVec3::new(0.0, 2.0, 0.0),   // apex — on axis (pole)
        ];
        let faces = m.revolve(
            &profile,
            DVec3::ZERO,
            DVec3::Y,
            8,
            MaterialId::new(0),
        ).unwrap();
        assert_eq!(faces.len(), 8);
        for &f in &faces {
            let verts = m.collect_loop_verts(m.faces[f].outer().start).unwrap();
            assert_eq!(verts.len(), 3,
                "pole-touching revolve face should be a triangle (fan)");
        }
    }

    /// Both ends on axis = sphere-like (just 2 ring, poles at both).
    /// Every face should be a pole triangle.
    #[test]
    fn revolve_with_both_poles_forms_closed_lens() {
        let mut m = Mesh::new();
        // Semi-circular arc approximation with 3 points,
        // both endpoints on Y axis
        let profile = vec![
            DVec3::new(0.0, -1.0, 0.0),  // south pole
            DVec3::new(1.0,  0.0, 0.0),  // equator
            DVec3::new(0.0,  1.0, 0.0),  // north pole
        ];
        let faces = m.revolve(
            &profile,
            DVec3::ZERO,
            DVec3::Y,
            8,
            MaterialId::new(0),
        ).unwrap();
        // 8 segments × 2 profile spans = 16 faces, all triangles
        assert_eq!(faces.len(), 16);
        for &f in &faces {
            let verts = m.collect_loop_verts(m.faces[f].outer().start).unwrap();
            assert_eq!(verts.len(), 3);
        }
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "lens surface invariants broken:\n{}", report.summary());
    }

    /// Face normal of a cylinder surface points outward (away from axis).
    #[test]
    fn revolve_produces_outward_normals() {
        let mut m = Mesh::new();
        let profile = vec![
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
        ];
        let faces = m.revolve(
            &profile,
            DVec3::ZERO,
            DVec3::Y,
            16,
            MaterialId::new(0),
        ).unwrap();
        // Check the first face (around θ ≈ 0 to θ ≈ 22.5°): its center is
        // at approximately (0.96, 1.0, 0.2). Outward should be roughly +X.
        let f0 = faces[0];
        let n = m.faces[f0].normal();
        assert!(n.x > 0.7,
            "first cylinder face normal should point +X-ish, got {:?}", n);
        assert!(n.y.abs() < 0.3,
            "first cylinder face normal should have small Y, got {:?}", n);
    }

    /// Pole sharing — all rings at a pole point use the same vertex id.
    #[test]
    fn revolve_pole_vertices_are_shared() {
        let mut m = Mesh::new();
        let profile = vec![
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(0.0, 1.0, 0.0),  // pole
        ];
        let v_before = m.verts.iter().count();
        let _ = m.revolve(
            &profile,
            DVec3::ZERO,
            DVec3::Y,
            6,
            MaterialId::new(0),
        ).unwrap();
        let v_added = m.verts.iter().count() - v_before;
        // 6 ring verts on rim + 1 shared pole = 7. Without pole sharing
        // we'd have 6 + 6 = 12.
        assert_eq!(v_added, 7,
            "pole must be shared across rings; expected 7 new verts, got {}",
            v_added,
        );
    }

    #[test]
    fn revolve_rejects_bad_input() {
        let mut m = Mesh::new();
        let good = vec![DVec3::new(1.0, 0.0, 0.0), DVec3::new(1.0, 1.0, 0.0)];
        assert!(m.revolve(&[DVec3::X], DVec3::ZERO, DVec3::Y, 8, MaterialId::new(0)).is_err());
        assert!(m.revolve(&good, DVec3::ZERO, DVec3::Y, 2, MaterialId::new(0)).is_err());
        assert!(m.revolve(&good, DVec3::ZERO, DVec3::ZERO, 8, MaterialId::new(0)).is_err());
    }
}
