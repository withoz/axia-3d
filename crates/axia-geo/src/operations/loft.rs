//! Loft operation — interpolate surface through a stack of cross-sections.
//!
//! Given N cross-sections, each a list of K points in matching order, builds
//! a surface by stitching consecutive sections together. For closed sections
//! (the usual case: a loop of points defining a cross-sectional ring), each
//! band becomes a strip of K quads. For open sections (e.g. two parallel
//! curves in space), the band is K-1 quads.
//!
//! Applications: dog body from a few circular cross-sections at hip/mid/
//! chest; airfoil wing from airfoil profiles at root and tip; bottle with
//! changing silhouette at neck/body/base.
//!
//! ## Section order & winding
//!
//! Within a section the point order defines one ring direction. Consecutive
//! sections are stitched in the order they were passed in — "section 0" is
//! one end, "section N-1" is the other. The winding of the generated bands
//! follows the same [v00, v10, v11, v01] quad walk as Revolve, so the face
//! normal points "outward" when the section point order is consistent with
//! stacking from 0→N-1 along the local surface normal (right-hand rule).
//!
//! If the user gets an inward-facing surface, reversing each section's
//! point order (or the section order) fixes it; alternatively a follow-up
//! `flip_face_safe` on each band works.

use anyhow::{Result, bail, ensure};
use glam::DVec3;

use crate::entities::*;
use crate::mesh::Mesh;

impl Mesh {
    /// Stitch consecutive cross-sections into a surface.
    ///
    /// - `sections.len() >= 2`
    /// - Every section has the same length `K >= 3`
    /// - If `closed_sections` is true, each section is treated as a loop
    ///   (the last point connects to the first).
    ///
    /// Returns the FaceIds of every generated band quad in
    /// section-major, point-minor order.
    pub fn loft(
        &mut self,
        sections: &[Vec<DVec3>],
        closed_sections: bool,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        // ─── Guards (ADR-003) ─────────────────────────────────────
        ensure!(
            sections.len() >= 2,
            "loft: need at least 2 cross-sections, got {}",
            sections.len(),
        );
        let k = sections[0].len();
        ensure!(k >= 3, "loft: each section needs ≥ 3 points, got {}", k);
        for (i, sec) in sections.iter().enumerate() {
            ensure!(
                sec.len() == k,
                "loft: section {} has {} points, expected {} (all sections must match)",
                i, sec.len(), k,
            );
            for (j, p) in sec.iter().enumerate() {
                ensure!(
                    p.x.is_finite() && p.y.is_finite() && p.z.is_finite(),
                    "loft: section[{}][{}] must be finite, got {:?}",
                    i, j, p,
                );
            }
        }

        // ─── Allocate ring vertices ───────────────────────────────
        // rings[i][j] = VertId for section i, point j.
        let mut rings: Vec<Vec<VertId>> = Vec::with_capacity(sections.len());
        for sec in sections {
            let mut ring: Vec<VertId> = Vec::with_capacity(k);
            for &p in sec {
                ring.push(self.add_vertex(p));
            }
            rings.push(ring);
        }

        // ─── Emit band faces ──────────────────────────────────────
        // For each consecutive pair of sections (i, i+1) and each edge
        // of the section polyline (j → j+1), build a quad. Winding
        // matches Revolve so all lofts created from consistently-
        // oriented sections face outward.
        let n_sections = sections.len();
        let band_faces_per = if closed_sections { k } else { k - 1 };
        let mut new_faces = Vec::with_capacity((n_sections - 1) * band_faces_per);

        for i in 0..(n_sections - 1) {
            let r0 = &rings[i];
            let r1 = &rings[i + 1];
            let limit = if closed_sections { k } else { k - 1 };
            for j in 0..limit {
                let j_next = if closed_sections { (j + 1) % k } else { j + 1 };
                let v00 = r0[j];
                let v01 = r0[j_next];
                let v10 = r1[j];
                let v11 = r1[j_next];
                // Skip fully-degenerate quads (all four verts coincident).
                if v00 == v01 && v10 == v11 { continue; }
                // Walk [v00, v01, v11, v10]: within-section step first, then
                // cross to the next section. Outer loop (section) runs over
                // the stacking direction; inner loop (j) runs tangentially
                // around the ring. This is mirror-imaged from Revolve's
                // outer=rotation / inner=profile layout, so Loft uses the
                // OPPOSITE quad walk to end up with the same outward-
                // facing normal convention.
                let fid = self.add_face_with_holes(&[v00, v01, v11, v10], &[], material)?;
                new_faces.push(fid);
            }
        }

        if new_faces.is_empty() {
            bail!("loft: no faces created — sections may be fully degenerate");
        }

        self.debug_verify_invariants();
        Ok(new_faces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2 identical circles stacked → cylinder band.
    #[test]
    fn loft_two_circles_makes_cylinder_band() {
        let mut m = Mesh::new();
        let make_circle = |y: f64| -> Vec<DVec3> {
            (0..8).map(|i| {
                let a = (i as f64) * std::f64::consts::TAU / 8.0;
                DVec3::new(a.cos(), y, a.sin())
            }).collect()
        };
        let sections = vec![make_circle(0.0), make_circle(2.0)];
        let faces = m.loft(&sections, true, MaterialId::new(0)).unwrap();
        assert_eq!(faces.len(), 8, "8 quads around a closed circular section");
        for &f in &faces {
            let verts = m.collect_loop_verts(m.faces[f].outer().start).unwrap();
            assert_eq!(verts.len(), 4);
        }
    }

    /// 3 scaled circles → tapered silhouette (vase-ish).
    #[test]
    fn loft_three_circles_tapers() {
        let mut m = Mesh::new();
        let make_ring = |y: f64, r: f64| -> Vec<DVec3> {
            (0..6).map(|i| {
                let a = (i as f64) * std::f64::consts::TAU / 6.0;
                DVec3::new(r * a.cos(), y, r * a.sin())
            }).collect()
        };
        let sections = vec![
            make_ring(0.0, 1.0),
            make_ring(1.0, 2.0),
            make_ring(2.0, 1.5),
        ];
        let faces = m.loft(&sections, true, MaterialId::new(0)).unwrap();
        // 2 bands × 6 quads = 12 faces
        assert_eq!(faces.len(), 12);
        let report = m.verify_face_invariants();
        assert_eq!(report.violations.len(), 0,
            "invariants after taper loft:\n{}", report.summary());
    }

    /// Open sections (not closed) — one fewer face per band.
    #[test]
    fn loft_open_sections_omit_wrap_face() {
        let mut m = Mesh::new();
        let sec_a: Vec<DVec3> = (0..4).map(|i| DVec3::new(i as f64, 0.0, 0.0)).collect();
        let sec_b: Vec<DVec3> = (0..4).map(|i| DVec3::new(i as f64, 1.0, 0.0)).collect();
        let faces = m.loft(&[sec_a, sec_b], false, MaterialId::new(0)).unwrap();
        assert_eq!(faces.len(), 3, "open 4-point sections → 3 quads per band");
    }

    #[test]
    fn loft_rejects_mismatched_section_sizes() {
        let mut m = Mesh::new();
        let sec_a = vec![DVec3::X, DVec3::Y, DVec3::Z];
        let sec_b = vec![DVec3::X, DVec3::Y, DVec3::Z, DVec3::new(1.0, 1.0, 1.0)];
        let err = m.loft(&[sec_a, sec_b], true, MaterialId::new(0));
        assert!(err.is_err());
    }

    #[test]
    fn loft_rejects_single_section() {
        let mut m = Mesh::new();
        let sec = vec![DVec3::X, DVec3::Y, DVec3::Z];
        let err = m.loft(&[sec], true, MaterialId::new(0));
        assert!(err.is_err());
    }

    #[test]
    fn loft_preserves_outward_normals_for_ccw_circles() {
        // Two circles (ring order CCW viewed from +Y) stacked along +Y.
        // Each band face should point outward (radially away from central
        // axis) just like the Revolve cylinder does.
        let mut m = Mesh::new();
        let make_circle = |y: f64| -> Vec<DVec3> {
            (0..8).map(|i| {
                // Use -θ so that when viewed from +Y looking down, ring is
                // CCW in right-hand convention and matches how Revolve
                // around +Y walks (θ goes from +X toward -Z).
                let a = -(i as f64) * std::f64::consts::TAU / 8.0;
                DVec3::new(a.cos(), y, a.sin())
            }).collect()
        };
        let sections = vec![make_circle(0.0), make_circle(2.0)];
        let faces = m.loft(&sections, true, MaterialId::new(0)).unwrap();
        let f0 = faces[0];
        let n = m.faces[f0].normal();
        // First face spans θ = 0 → -TAU/8, i.e. centered at θ ≈ -π/8.
        // Outward radial at that angle: (cos(-π/8), 0, sin(-π/8)) ≈ (0.92, 0, -0.38).
        assert!(n.x > 0.5, "face normal x should be + (outward), got {:?}", n);
    }
}
