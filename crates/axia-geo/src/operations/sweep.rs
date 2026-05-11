//! Sweep operation — extrude a 2D profile along an arbitrary 3D path.
//!
//! The profile is given in a local XY plane (z = 0 for a pure 2D cross-
//! section). At each point on the path we build a local orthonormal frame
//! (R, U, T) where T is the path tangent, and we map profile's (x, y, z)
//! into world-space R, U, T directions centered on the path point.
//!
//! Internally this delegates to `Mesh::loft` — we simply compute one
//! transformed section per path point and then loft between them, which
//! means winding conventions and invariant handling stay consistent
//! with the rest of the organic-modeling pipeline.
//!
//! ## Frame choice
//!
//! We use a fixed world-up reference (default +Y) and orthogonalize
//! against the local tangent. When the tangent is nearly parallel to
//! world-up (|T · Y| > 0.95), we fall back to +X as the secondary
//! reference to avoid a degenerate frame. This keeps twisting under
//! control for paths that stay "mostly horizontal" (dog bodies,
//! pipes, curves-in-plane) but will visibly twist if the path
//! actually needs a rotation-minimizing frame (tight spirals,
//! helix-like geometry). That's a future upgrade.

use anyhow::{Result, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;

impl Mesh {
    /// Sweep `profile` (2D cross-section in XY plane) along `path`
    /// (polyline in 3D). Each path point becomes one cross-section of
    /// the resulting surface. `closed_profile` decides whether the
    /// profile wraps around (a closed cross-section gives a solid-like
    /// tube; an open cross-section gives a ruled strip).
    pub fn sweep(
        &mut self,
        profile: &[DVec3],
        path: &[DVec3],
        closed_profile: bool,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        ensure!(profile.len() >= 3, "sweep: profile needs ≥ 3 points, got {}", profile.len());
        ensure!(path.len() >= 2, "sweep: path needs ≥ 2 points, got {}", path.len());
        for (i, p) in profile.iter().enumerate() {
            ensure!(
                p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                "sweep: profile[{}] must be finite, got {:?}", i, p,
            );
        }
        for (i, p) in path.iter().enumerate() {
            ensure!(
                p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                "sweep: path[{}] must be finite, got {:?}", i, p,
            );
        }

        let world_up = DVec3::Y;
        let n = path.len();
        let mut sections: Vec<Vec<DVec3>> = Vec::with_capacity(n);

        for i in 0..n {
            let tangent_raw = if i == 0 {
                path[1] - path[0]
            } else if i == n - 1 {
                path[n - 1] - path[n - 2]
            } else {
                path[i + 1] - path[i - 1]
            };
            ensure!(
                tangent_raw.length_squared() > 1e-12,
                "sweep: path has coincident points near index {}", i,
            );
            let tangent = tangent_raw.normalize();

            // Pick an up-reference perpendicular-ish to tangent.
            let up_ref = if tangent.dot(world_up).abs() > 0.95 {
                DVec3::X
            } else {
                world_up
            };
            let r = tangent.cross(up_ref).normalize();
            let u = r.cross(tangent).normalize();

            let mut section: Vec<DVec3> = Vec::with_capacity(profile.len());
            for &p in profile {
                let world_p = path[i] + r * p.x + u * p.y + tangent * p.z;
                section.push(world_p);
            }
            sections.push(section);
        }

        // Delegate ring-stitching to loft — same winding & invariant contract.
        self.loft(&sections, closed_profile, material)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sweep a small square profile along a straight path → rectangular tube.
    #[test]
    fn sweep_square_along_straight_path() {
        let mut m = Mesh::new();
        // Square profile in XY plane, radius 1
        let profile = vec![
            DVec3::new( 1.0,  1.0, 0.0),
            DVec3::new(-1.0,  1.0, 0.0),
            DVec3::new(-1.0, -1.0, 0.0),
            DVec3::new( 1.0, -1.0, 0.0),
        ];
        // Straight path along +Z
        let path = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 0.0, 5.0),
        ];
        let faces = m.sweep(&profile, &path, true, MaterialId::new(0)).unwrap();
        assert_eq!(faces.len(), 4, "4 sides for a closed-square sweep across 2 sections");
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0, "invariants:\n{}", report.summary());
    }

    /// Sweep over a multi-segment path should leave every generated face
    /// in a valid ADR-007 state (winding + manifoldness + normal match).
    /// Regression guard against silent loft invariant drift when sweep
    /// is the caller.
    #[test]
    fn sweep_bent_and_vertical_paths_preserve_invariants() {
        let hex: Vec<DVec3> = (0..6).map(|i| {
            let a = (i as f64) * std::f64::consts::TAU / 6.0;
            DVec3::new(a.cos(), a.sin(), 0.0)
        }).collect();

        // Bent path (horizontal → vertical 90° turn)
        let mut m1 = Mesh::new();
        let path_bent = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(4.0, 0.0, 0.0),
            DVec3::new(4.0, 4.0, 0.0),
            DVec3::new(4.0, 4.0, 4.0),
        ];
        m1.sweep(&hex, &path_bent, true, MaterialId::new(0)).unwrap();
        let r1 = m1.verify_face_invariants();
        assert_eq!(r1.violations.len(), 0,
            "bent-path sweep invariants:\n{}", r1.summary());

        // Vertical path — exercises the `|T · Y| > 0.95` up-reference
        // fallback branch in sweep's frame computation.
        let mut m2 = Mesh::new();
        let path_vert = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 3.0, 0.0),
            DVec3::new(0.0, 6.0, 0.0),
        ];
        m2.sweep(&hex, &path_vert, true, MaterialId::new(0)).unwrap();
        let r2 = m2.verify_face_invariants();
        assert_eq!(r2.violations.len(), 0,
            "vertical-path sweep invariants:\n{}", r2.summary());
    }

    /// Sweep along a right-angle path — bend in the middle.
    #[test]
    fn sweep_along_bent_path_produces_bent_surface() {
        let mut m = Mesh::new();
        let profile: Vec<DVec3> = (0..6).map(|i| {
            let a = (i as f64) * std::f64::consts::TAU / 6.0;
            DVec3::new(a.cos(), a.sin(), 0.0)
        }).collect();
        // L-shaped path: along +X, then turn upward along +Y
        let path = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(5.0, 0.0, 0.0),
            DVec3::new(5.0, 5.0, 0.0),
        ];
        let faces = m.sweep(&profile, &path, true, MaterialId::new(0)).unwrap();
        // 2 bands × 6 sides = 12 faces
        assert_eq!(faces.len(), 12);
    }

    /// Open profile (a strip instead of a tube) — one fewer face per band.
    #[test]
    fn sweep_open_profile_yields_strip() {
        let mut m = Mesh::new();
        // Open profile: four colinear points (a line "strip")
        let profile = vec![
            DVec3::new(-1.0, 0.0, 0.0),
            DVec3::new(-0.3, 0.5, 0.0),
            DVec3::new( 0.3, 0.5, 0.0),
            DVec3::new( 1.0, 0.0, 0.0),
        ];
        let path = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 0.0, 2.0),
            DVec3::new(0.0, 0.0, 4.0),
        ];
        let faces = m.sweep(&profile, &path, false, MaterialId::new(0)).unwrap();
        // 2 bands × 3 strip-quads = 6 faces
        assert_eq!(faces.len(), 6);
    }

    #[test]
    fn sweep_handles_vertical_path() {
        // Path along +Y — tests the |T·up| > 0.95 fallback branch.
        let mut m = Mesh::new();
        let profile: Vec<DVec3> = (0..4).map(|i| {
            let a = (i as f64) * std::f64::consts::TAU / 4.0;
            DVec3::new(a.cos(), a.sin(), 0.0)
        }).collect();
        let path = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(0.0, 3.0, 0.0),
        ];
        let faces = m.sweep(&profile, &path, true, MaterialId::new(0)).unwrap();
        assert_eq!(faces.len(), 4);
    }

    #[test]
    fn sweep_rejects_bad_input() {
        let mut m = Mesh::new();
        let good_prof = vec![DVec3::X, DVec3::Y, DVec3::Z];
        let good_path = vec![DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0)];
        assert!(m.sweep(&[DVec3::X], &good_path, true, MaterialId::new(0)).is_err());
        assert!(m.sweep(&good_prof, &[DVec3::ZERO], true, MaterialId::new(0)).is_err());
        // Coincident path points
        let bad_path = vec![DVec3::ZERO, DVec3::ZERO];
        assert!(m.sweep(&good_prof, &bad_path, true, MaterialId::new(0)).is_err());
    }
}
