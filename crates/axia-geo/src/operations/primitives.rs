//! Primitive shape creation — Cylinder, Cone, Sphere.

use glam::DVec3;
use anyhow::Result;

use crate::entities::id::*;
use crate::mesh::Mesh;

impl Mesh {
    /// Create a cylinder (quads only).
    pub fn create_cylinder(
        &mut self,
        center: DVec3,
        radius: f64,
        height: f64,
        segments: u32,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        let mut faces = Vec::new();
        let up = DVec3::Y;
        let arbitrary = if up.y.abs() < 0.9 { DVec3::Y } else { DVec3::X };
        let radial = up.cross(arbitrary).normalize();
        let tangent = up.cross(radial).normalize();

        let bottom_center = center;
        let top_center = center + up * height;

        let mut bottom_verts = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = bottom_center + radial * (radius * angle.cos()) + tangent * (radius * angle.sin());
            bottom_verts.push(self.add_vertex(pos));
        }

        let mut top_verts = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = top_center + radial * (radius * angle.cos()) + tangent * (radius * angle.sin());
            top_verts.push(self.add_vertex(pos));
        }

        let mut base_verts = bottom_verts.clone();
        base_verts.reverse();
        let base_face = self.add_face(&base_verts, material)?;
        faces.push(base_face);

        let top_face = self.add_face(&top_verts, material)?;
        faces.push(top_face);

        for i in 0..segments {
            let next = (i + 1) % segments;
            let quad = vec![
                bottom_verts[i as usize],
                bottom_verts[next as usize],
                top_verts[next as usize],
                top_verts[i as usize],
            ];
            let side_face = self.add_face(&quad, material)?;
            faces.push(side_face);
        }

        // Hide tessellation chord edges on top/bottom rings so the cylinder
        // appears as a smooth curve rather than an n-gon. Verticals between
        // side faces are already hidden by the angle-based soft filter (~15°).
        self.mark_face_outer_soft(base_face)?;
        self.mark_face_outer_soft(top_face)?;

        Ok(faces)
    }

    /// Create a truncated cone (proper geometry, no degenerate faces).
    pub fn create_cone(
        &mut self,
        center: DVec3,
        radius: f64,
        height: f64,
        segments: u32,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        let mut faces = Vec::new();
        let up = DVec3::Y;
        let arbitrary = if up.y.abs() < 0.9 { DVec3::Y } else { DVec3::X };
        let radial = up.cross(arbitrary).normalize();
        let tangent = up.cross(radial).normalize();

        let base_center = center;
        let top_center = center + up * height;
        
        // Top radius is 10% of base radius for cone appearance
        let top_radius = radius * 0.1;

        let mut base_verts = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = base_center + radial * (radius * angle.cos()) + tangent * (radius * angle.sin());
            base_verts.push(self.add_vertex(pos));
        }

        let mut top_verts = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = top_center + radial * (top_radius * angle.cos()) + tangent * (top_radius * angle.sin());
            top_verts.push(self.add_vertex(pos));
        }

        let mut base_face_verts = base_verts.clone();
        base_face_verts.reverse();
        let base_face = self.add_face(&base_face_verts, material)?;
        faces.push(base_face);

        let top_face = self.add_face(&top_verts, material)?;
        faces.push(top_face);

        // Side quads
        for i in 0..segments {
            let next = (i + 1) % segments;
            let quad = vec![
                base_verts[i as usize],
                base_verts[next as usize],
                top_verts[next as usize],
                top_verts[i as usize],
            ];
            let side_face = self.add_face(&quad, material)?;
            faces.push(side_face);
        }

        // Hide tessellation chord rings (base + top) — same as cylinder.
        self.mark_face_outer_soft(base_face)?;
        self.mark_face_outer_soft(top_face)?;

        Ok(faces)
    }

    /// Create a sphere (quads only, no triangular poles).
    pub fn create_sphere(
        &mut self,
        center: DVec3,
        radius: f64,
        u_segments: u32,
        v_segments: u32,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        let mut faces = Vec::new();
        let mut rings: Vec<Vec<VertId>> = Vec::new();

        for v in 0..=v_segments {
            let theta = std::f64::consts::PI * (v as f64) / (v_segments as f64);
            let y = radius * theta.cos();
            let r = radius * theta.sin();
            let mut ring = Vec::new();
            for u in 0..u_segments {
                let phi = 2.0 * std::f64::consts::PI * (u as f64) / (u_segments as f64);
                let x = r * phi.cos();
                let z = r * phi.sin();
                let pos = center + DVec3::new(x, y, z);
                ring.push(self.add_vertex(pos));
            }
            rings.push(ring);
        }

        for v in 0..(rings.len() as u32 - 1) {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let quad = vec![
                    rings[v as usize][u as usize],
                    rings[v as usize][next_u as usize],
                    rings[(v + 1) as usize][next_u as usize],
                    rings[(v + 1) as usize][u as usize],
                ];
                let face = self.add_face(&quad, material)?;
                faces.push(face);
            }
        }

        Ok(faces)
    }
}
