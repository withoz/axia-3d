//! Non-linear vertex deformers: Bend, Twist, Taper.
//!
//! All three operate on a vertex set (no topology change), so they belong
//! to the same family as `translate_verts`/`rotate_verts`/`scale_verts`:
//! positions change, adjacent face normals are recomputed, and ADR-007
//! invariants are re-verified. A delta path (instead of a full topology
//! rebuild) is therefore valid — the WASM wrappers mark faces dirty only.
//!
//! ## Bend
//!
//! For each vertex `v`, compute its projected distance `t` along the
//! bend direction `bend_dir` relative to `origin`. Clamp to
//! `[0, length_limit]`, rotate `v` around `bend_axis` (through `origin`)
//! by `angle * (t / length_limit)`. The result curves a rod-like shape
//! around `bend_axis` — think "rolling a noodle". Verts with `t < 0`
//! stay put (the "fixed" side of the bend).
//!
//! ## Twist
//!
//! For each vertex `v`, compute its projected distance `t` along
//! `axis_dir` from `axis_origin`. Rotate `v` around the axis by
//! `angle_per_unit * t`. Linear accumulation produces a spiral, like
//! wringing a towel.
//!
//! ## Taper
//!
//! For each vertex `v`, compute `t = (v - axis_origin) · axis_dir / length`
//! clamped to `[0, 1]`. Linearly interpolate the scale factor from
//! `start_scale` (t=0) to `end_scale` (t=1). Project `v` onto the axis
//! for the center, then scale the perpendicular component by the
//! interpolated factor.

use std::collections::HashSet;

use anyhow::{Result, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;
use crate::operations::transform::TransformResult;
use crate::tolerances::EPSILON_LENGTH;

impl Mesh {
    /// Bend the given verts around `bend_axis` (through `origin`). Rotation
    /// angle ramps linearly from 0 at `t = 0` to `angle_rad` at
    /// `t = length_limit`, where `t = (v - origin) · bend_dir`. Verts
    /// behind the origin (t < 0) are left untouched.
    pub fn bend_verts(
        &mut self,
        vert_ids: &[VertId],
        bend_axis: DVec3,
        bend_dir: DVec3,
        origin: DVec3,
        angle_rad: f64,
        length_limit: f64,
    ) -> Result<TransformResult> {
        ensure!(
            angle_rad.is_finite(),
            "bend: angle must be finite, got {}", angle_rad,
        );
        ensure!(
            length_limit.is_finite() && length_limit > EPSILON_LENGTH,
            "bend: length_limit must be positive and finite, got {}", length_limit,
        );
        ensure!(
            bend_axis.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "bend: bend_axis must be non-zero",
        );
        ensure!(
            bend_dir.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "bend: bend_dir must be non-zero",
        );
        ensure!(
            origin.x.is_finite() && origin.y.is_finite() && origin.z.is_finite(),
            "bend: origin must be finite",
        );
        if vert_ids.is_empty() || angle_rad.abs() < 1e-12 {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        let axis_n = bend_axis.normalize();
        let dir_n = bend_dir.normalize();
        // Remove axis component from dir so `bend_dir` is purely the
        // "length" direction perpendicular to the axis of rotation.
        let dir_perp = (dir_n - axis_n * axis_n.dot(dir_n)).normalize_or_zero();
        ensure!(
            dir_perp.length_squared() > 0.1,
            "bend: bend_dir must not be parallel to bend_axis",
        );

        for &vid in vert_ids {
            let p = match self.verts.get(vid).map(|v| v.pos()) {
                Some(p) => p,
                None => continue,
            };
            let rel = p - origin;
            let t = rel.dot(dir_perp).clamp(0.0, length_limit);
            if t <= EPSILON_LENGTH {
                continue;
            }
            let theta = angle_rad * (t / length_limit);
            let rot = rodrigues(axis_n, theta);
            let new_rel = rot * rel;
            if let Some(vert) = self.verts.get_mut(vid) {
                vert.set_pos(origin + new_rel);
            }
        }

        let affected = collect_incident_active_faces(self, vert_ids);
        if !affected.is_empty() {
            self.recompute_face_normals(&affected)?;
        }
        self.debug_verify_invariants();
        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: affected.len(),
        })
    }

    /// Twist the given verts around `(axis_origin, axis_dir)`. Rotation
    /// angle at each vertex = `angle_per_unit · axial_distance`, so
    /// positive verts rotate more than zero-axial verts (and negative
    /// axial verts counter-rotate, producing a full spiral).
    pub fn twist_verts(
        &mut self,
        vert_ids: &[VertId],
        axis_origin: DVec3,
        axis_dir: DVec3,
        angle_per_unit: f64,
    ) -> Result<TransformResult> {
        ensure!(
            angle_per_unit.is_finite(),
            "twist: angle_per_unit must be finite, got {}", angle_per_unit,
        );
        ensure!(
            axis_dir.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "twist: axis_dir must be non-zero",
        );
        ensure!(
            axis_origin.x.is_finite() && axis_origin.y.is_finite() && axis_origin.z.is_finite(),
            "twist: axis_origin must be finite",
        );
        if vert_ids.is_empty() || angle_per_unit.abs() < 1e-12 {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        let axis_n = axis_dir.normalize();

        for &vid in vert_ids {
            let p = match self.verts.get(vid).map(|v| v.pos()) {
                Some(p) => p,
                None => continue,
            };
            let rel = p - axis_origin;
            let t = rel.dot(axis_n);
            let theta = angle_per_unit * t;
            if theta.abs() < 1e-12 { continue; }
            let rot = rodrigues(axis_n, theta);
            let new_rel = rot * rel;
            if let Some(vert) = self.verts.get_mut(vid) {
                vert.set_pos(axis_origin + new_rel);
            }
        }

        let affected = collect_incident_active_faces(self, vert_ids);
        if !affected.is_empty() {
            self.recompute_face_normals(&affected)?;
        }
        self.debug_verify_invariants();
        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: affected.len(),
        })
    }

    /// Taper the given verts along `(axis_origin, axis_dir)`. At axial
    /// position `t / length`, the perpendicular component is scaled by
    /// `lerp(start_scale, end_scale, t/length)` (clamped outside
    /// `[0, 1]`). The axial component is preserved.
    pub fn taper_verts(
        &mut self,
        vert_ids: &[VertId],
        axis_origin: DVec3,
        axis_dir: DVec3,
        start_scale: f64,
        end_scale: f64,
        length: f64,
    ) -> Result<TransformResult> {
        ensure!(
            start_scale.is_finite() && end_scale.is_finite(),
            "taper: scale factors must be finite",
        );
        ensure!(
            start_scale > 0.0 && end_scale > 0.0,
            "taper: scales must be positive (mirror via negative is explicit scale_verts)",
        );
        ensure!(
            length.is_finite() && length > EPSILON_LENGTH,
            "taper: length must be positive",
        );
        ensure!(
            axis_dir.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "taper: axis_dir must be non-zero",
        );
        if vert_ids.is_empty() {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        let axis_n = axis_dir.normalize();

        for &vid in vert_ids {
            let p = match self.verts.get(vid).map(|v| v.pos()) {
                Some(p) => p,
                None => continue,
            };
            let rel = p - axis_origin;
            let t = rel.dot(axis_n);
            let u = (t / length).clamp(0.0, 1.0);
            let s = start_scale * (1.0 - u) + end_scale * u;
            if (s - 1.0).abs() < 1e-12 { continue; }
            let axial_part = axis_n * t;
            let perp_part = rel - axial_part;
            let new_rel = axial_part + perp_part * s;
            if let Some(vert) = self.verts.get_mut(vid) {
                vert.set_pos(axis_origin + new_rel);
            }
        }

        let affected = collect_incident_active_faces(self, vert_ids);
        if !affected.is_empty() {
            self.recompute_face_normals(&affected)?;
        }
        self.debug_verify_invariants();
        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: affected.len(),
        })
    }
}

/// Rodrigues rotation matrix builder. `axis` must be a unit vector.
fn rodrigues(axis: DVec3, angle: f64) -> glam::DMat3 {
    let c = angle.cos();
    let s = angle.sin();
    let one_m = 1.0 - c;
    let (x, y, z) = (axis.x, axis.y, axis.z);
    glam::DMat3::from_cols_array(&[
        c + x * x * one_m,
        x * y * one_m + z * s,
        x * z * one_m - y * s,
        x * y * one_m - z * s,
        c + y * y * one_m,
        y * z * one_m + x * s,
        x * z * one_m + y * s,
        y * z * one_m - x * s,
        c + z * z * one_m,
    ])
}

/// Walk each vertex's outgoing-HE ring and collect unique active face
/// IDs. Shared with bend/twist/taper to recompute normals of only the
/// faces actually touched by the deformation.
fn collect_incident_active_faces(mesh: &Mesh, vert_ids: &[VertId]) -> Vec<FaceId> {
    let mut set: HashSet<FaceId> = HashSet::new();
    for &vid in vert_ids {
        let start = match mesh.verts.get(vid).and_then(|v| v.outgoing()) {
            Some(h) if !h.is_null() && mesh.hes.contains(h) => h,
            _ => continue,
        };
        let mut cur = start;
        for _ in 0..10_000 {
            if !mesh.hes.contains(cur) { break; }
            let f = mesh.hes[cur].face();
            if !f.is_null() && mesh.faces.contains(f) && mesh.faces[f].is_active() {
                set.insert(f);
            }
            let nxt = mesh.hes[cur].v_next();
            if nxt.is_null() || nxt == start { break; }
            cur = nxt;
        }
    }
    set.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simple 2×2 grid of verts in the XY plane at z=0. Useful for
    /// testing deformers without having to build a complete manifold.
    fn make_flat_verts(mesh: &mut Mesh) -> Vec<VertId> {
        let mut out = Vec::new();
        for i in 0..=4 {
            let x = i as f64;
            out.push(mesh.add_vertex(DVec3::new(x, 0.0, 0.0)));
        }
        out
    }

    #[test]
    fn bend_rotates_far_verts_more_than_near() {
        let mut m = Mesh::new();
        let verts = make_flat_verts(&mut m);
        m.bend_verts(
            &verts,
            DVec3::new(0.0, 0.0, 1.0),  // bend around Z
            DVec3::new(1.0, 0.0, 0.0),  // length measured along +X
            DVec3::ZERO,
            std::f64::consts::FRAC_PI_2, // 90° max bend
            4.0,                          // t=0..4 → angle 0..90°
        ).unwrap();

        // Vert at x=0 stays put
        assert!((m.vertex_pos(verts[0]).unwrap() - DVec3::new(0.0, 0.0, 0.0)).length() < 1e-9);
        // Vert at x=4 should rotate 90° around +Z → end at (0, 4, 0)
        let far = m.vertex_pos(verts[4]).unwrap();
        assert!((far - DVec3::new(0.0, 4.0, 0.0)).length() < 1e-6,
            "vert at x=4 → {:?}", far);
        // Vert at x=2 should rotate 45°
        let mid = m.vertex_pos(verts[2]).unwrap();
        let expected_mid = DVec3::new(
            2.0 * std::f64::consts::FRAC_1_SQRT_2,
            2.0 * std::f64::consts::FRAC_1_SQRT_2,
            0.0,
        );
        assert!((mid - expected_mid).length() < 1e-6,
            "mid should rotate 45°, got {:?} (expected {:?})", mid, expected_mid);
    }

    #[test]
    fn twist_angle_scales_with_axial_position() {
        let mut m = Mesh::new();
        // Verts at (1, y, 0) for y = 0, 1, 2
        let v0 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let verts = vec![v0, v1, v2];
        // π/2 radians per mm along +Y
        m.twist_verts(&verts, DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0),
            std::f64::consts::FRAC_PI_2).unwrap();

        // v0 at y=0: angle 0 → no change
        assert!((m.vertex_pos(v0).unwrap() - DVec3::new(1.0, 0.0, 0.0)).length() < 1e-6);
        // v1 at y=1: 90° twist around +Y. Rodrigues with +Y axis and +90°
        // sends (1,0,0) to (0, 0, -1).
        let p1 = m.vertex_pos(v1).unwrap();
        assert!((p1 - DVec3::new(0.0, 1.0, -1.0)).length() < 1e-6,
            "v1 → {:?}", p1);
        // v2 at y=2: 180° → (-1, 2, 0)
        let p2 = m.vertex_pos(v2).unwrap();
        assert!((p2 - DVec3::new(-1.0, 2.0, 0.0)).length() < 1e-6,
            "v2 → {:?}", p2);
    }

    #[test]
    fn taper_scales_perpendicular_component_linearly() {
        let mut m = Mesh::new();
        // Verts on a vertical line at y = 0, 1, 2 with +X offset of 1
        let v0 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(1.0, 2.0, 0.0));
        let verts = vec![v0, v1, v2];

        // Taper along +Y: scale 1.0 at y=0, 0.0 at y=2 (length=2, end=0).
        // With positive-only scale enforcement we can't do 0.0 exactly;
        // use 0.01 as the "thin tip" and 1.0 as the fat base.
        m.taper_verts(&verts, DVec3::ZERO, DVec3::new(0.0, 1.0, 0.0),
            1.0, 0.01, 2.0).unwrap();

        // v0: u=0 → scale 1.0 → unchanged
        assert!((m.vertex_pos(v0).unwrap() - DVec3::new(1.0, 0.0, 0.0)).length() < 1e-6);
        // v1: u=0.5 → scale 0.505 → perp 1.0 · 0.505 = 0.505 in +X
        let p1 = m.vertex_pos(v1).unwrap();
        assert!((p1 - DVec3::new(0.505, 1.0, 0.0)).length() < 1e-6,
            "v1 → {:?}", p1);
        // v2: u=1.0 → scale 0.01
        let p2 = m.vertex_pos(v2).unwrap();
        assert!((p2 - DVec3::new(0.01, 2.0, 0.0)).length() < 1e-6,
            "v2 → {:?}", p2);
    }

    #[test]
    fn bend_rejects_bad_input() {
        let mut m = Mesh::new();
        let verts = make_flat_verts(&mut m);
        // Zero length_limit
        assert!(m.bend_verts(&verts, DVec3::Z, DVec3::X, DVec3::ZERO, 1.0, 0.0).is_err());
        // Zero bend axis
        assert!(m.bend_verts(&verts, DVec3::ZERO, DVec3::X, DVec3::ZERO, 1.0, 2.0).is_err());
        // bend_dir parallel to bend_axis
        assert!(m.bend_verts(&verts, DVec3::Z, DVec3::Z, DVec3::ZERO, 1.0, 2.0).is_err());
    }

    #[test]
    fn twist_rejects_bad_input() {
        let mut m = Mesh::new();
        let verts = make_flat_verts(&mut m);
        assert!(m.twist_verts(&verts, DVec3::ZERO, DVec3::ZERO, 1.0).is_err());
        assert!(m.twist_verts(&verts, DVec3::ZERO, DVec3::Y, f64::NAN).is_err());
    }

    #[test]
    fn taper_rejects_bad_input() {
        let mut m = Mesh::new();
        let verts = make_flat_verts(&mut m);
        // Negative scale
        assert!(m.taper_verts(&verts, DVec3::ZERO, DVec3::Y, -1.0, 1.0, 2.0).is_err());
        // Zero scale
        assert!(m.taper_verts(&verts, DVec3::ZERO, DVec3::Y, 0.0, 1.0, 2.0).is_err());
        // Zero length
        assert!(m.taper_verts(&verts, DVec3::ZERO, DVec3::Y, 1.0, 0.5, 0.0).is_err());
    }
}
