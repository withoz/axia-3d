//! Draw operations — Line, Rectangle, Circle.
//!
//! These create edges and optionally auto-close faces when a loop is detected.

use glam::DVec3;
use anyhow::Result;

use crate::entities::id::*;
use crate::mesh::Mesh;

impl Mesh {
    /// Draw a line segment between two 3D points.
    /// Creates vertices (with dedup) and the connecting edge.
    /// Returns (v_start, v_end, edge_id).
    pub fn draw_line(
        &mut self,
        start: DVec3,
        end: DVec3,
    ) -> Result<(VertId, VertId, EdgeId)> {
        let v0 = self.add_vertex(start);
        let v1 = self.add_vertex(end);
        let (edge_id, _) = self.add_edge(v0, v1)?;
        Ok((v0, v1, edge_id))
    }

    /// Draw a rectangle on a plane defined by center, normal, and up direction.
    /// Returns the face ID and the 4 vertex IDs.
    pub fn draw_rectangle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
        material: MaterialId,
    ) -> Result<(FaceId, [VertId; 4])> {
        let n = normal.normalize();
        let u = up.normalize();
        let v = n.cross(u).normalize();

        let hw = width / 2.0;
        let hh = height / 2.0;

        let v0 = self.add_vertex(center - u * hh - v * hw);
        let v1 = self.add_vertex(center - u * hh + v * hw);
        let v2 = self.add_vertex(center + u * hh + v * hw);
        let v3 = self.add_vertex(center + u * hh - v * hw);

        // CCW winding when viewed from normal direction → normal points outward
        let face_id = self.add_face(&[v0, v3, v2, v1], material)?;
        Ok((face_id, [v0, v3, v2, v1]))
    }

    /// Draw a regular polygon (approximation of circle) on a plane.
    /// Returns the face ID and vertex IDs.
    pub fn draw_circle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
        material: MaterialId,
    ) -> Result<(FaceId, Vec<VertId>)> {
        let n = normal.normalize();

        // Find a perpendicular basis vector
        let arbitrary = if n.y.abs() < 0.9 {
            DVec3::Y
        } else {
            DVec3::X
        };
        let u = n.cross(arbitrary).normalize();
        let v = n.cross(u).normalize();

        let mut verts = Vec::with_capacity(segments as usize);

        // CCW winding when viewed from normal direction (same as rect)
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = center + u * (radius * angle.cos()) + v * (radius * angle.sin());
            verts.push(self.add_vertex(pos));
        }

        let face_id = self.add_face(&verts, material)?;
        Ok((face_id, verts))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_draw_line() {
        let mut mesh = Mesh::new();
        let (v0, v1, _edge) = mesh.draw_line(
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),
        ).unwrap();

        assert_eq!(mesh.vert_count(), 2);
        assert_eq!(mesh.edge_count(), 1);
        assert_ne!(v0, v1);
    }

    #[test]
    fn test_draw_rectangle() {
        let mut mesh = Mesh::new();
        let (face_id, verts) = mesh.draw_rectangle(
            DVec3::ZERO,
            DVec3::Z,
            DVec3::Y,
            2.0,
            1.0,
            MaterialId::new(0),
        ).unwrap();

        assert_eq!(mesh.vert_count(), 4);
        assert_eq!(mesh.face_count(), 1);

        let normal = mesh.faces[face_id].normal();
        assert!(
            (normal.z.abs() - 1.0).abs() < 1e-6,
            "Rectangle normal should be along Z, got {:?}",
            normal
        );

        // Check all vertices are unique
        for i in 0..4 {
            for j in (i + 1)..4 {
                assert_ne!(verts[i], verts[j]);
            }
        }
    }

    #[test]
    fn test_triangle_loop_detected() {
        // Draw 3 lines forming a triangle: A→B, B→C, C→A
        let mut mesh = Mesh::new();
        let a = DVec3::ZERO;
        let b = DVec3::new(1.0, 0.0, 0.0);
        let c = DVec3::new(0.5, 1.0, 0.0);

        let (_v0, _v1, _e1) = mesh.draw_line(a, b).unwrap();
        let (_v2, _v3, _e2) = mesh.draw_line(b, c).unwrap();
        let (v4, v5, e3) = mesh.draw_line(c, a).unwrap();

        assert_eq!(mesh.vert_count(), 3); // dedup: only 3 unique vertices
        assert_eq!(mesh.edge_count(), 3);

        // Detect loop after third edge
        let loop_verts = mesh.detect_free_edge_loop(v4, v5, e3);
        assert!(loop_verts.is_some(), "Should detect triangle loop");
        let verts = loop_verts.unwrap();
        assert_eq!(verts.len(), 3, "Triangle has 3 vertices");

        // The loop can be used to create a face
        let face_id = mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 1);
        let _ = face_id;
    }

    #[test]
    fn test_quad_loop_detected() {
        // Draw 4 lines forming a square on XY plane
        let mut mesh = Mesh::new();
        let pts = [
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(0.0, 1.0, 0.0),
        ];

        mesh.draw_line(pts[0], pts[1]).unwrap();
        mesh.draw_line(pts[1], pts[2]).unwrap();
        mesh.draw_line(pts[2], pts[3]).unwrap();
        let (v0, v1, eid) = mesh.draw_line(pts[3], pts[0]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_some(), "Should detect quad loop");
        assert_eq!(loop_verts.unwrap().len(), 4);
    }

    #[test]
    fn test_no_loop_with_two_edges() {
        // Two edges don't form a loop
        let mut mesh = Mesh::new();
        let a = DVec3::ZERO;
        let b = DVec3::new(1.0, 0.0, 0.0);
        let c = DVec3::new(2.0, 0.0, 0.0);

        mesh.draw_line(a, b).unwrap();
        let (v0, v1, eid) = mesh.draw_line(b, c).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_none(), "Two edges cannot form a loop");
    }

    #[test]
    fn test_no_loop_non_coplanar() {
        // 4 edges forming a non-coplanar "loop" (3D zigzag)
        let mut mesh = Mesh::new();
        let pts = [
            DVec3::ZERO,
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(0.0, 1.0, 5.0), // far out of plane
        ];

        mesh.draw_line(pts[0], pts[1]).unwrap();
        mesh.draw_line(pts[1], pts[2]).unwrap();
        mesh.draw_line(pts[2], pts[3]).unwrap();
        let (v0, v1, eid) = mesh.draw_line(pts[3], pts[0]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_none(), "Non-coplanar quad should not form face");
    }

    #[test]
    fn test_draw_circle() {
        let mut mesh = Mesh::new();
        let segments = 24;
        let (_face_id, verts) = mesh.draw_circle(
            DVec3::ZERO,
            DVec3::Y,  // Horizontal circle
            1.0,
            segments,
            MaterialId::new(0),
        ).unwrap();

        assert_eq!(mesh.vert_count(), segments as usize);
        assert_eq!(mesh.edge_count(), segments as usize);
        assert_eq!(mesh.face_count(), 1);
        assert_eq!(verts.len(), segments as usize);

        // All vertices should be at distance 1.0 from center
        for &vid in &verts {
            let pos = mesh.vertex_pos(vid).unwrap();
            let dist = pos.length();
            assert!(
                (dist - 1.0).abs() < 1e-6,
                "Vertex should be at radius 1.0, got {}",
                dist
            );
        }
    }
}
