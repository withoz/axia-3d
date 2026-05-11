//! Draw operations — Line, Rectangle, Circle.
//!
//! These create edges and optionally auto-close faces when a loop is detected.
//!
//! Geometric Validity Guards (ADR-003):
//! - line: start != end (길이 ≥ EPSILON_LENGTH)
//! - rectangle: width, height ≥ EPSILON_LENGTH
//! - circle: radius ≥ EPSILON_LENGTH, segments ≥ 3

use glam::DVec3;
use anyhow::{Result, ensure};

use crate::entities::id::*;
use crate::mesh::Mesh;
use crate::tolerances::EPSILON_LENGTH;

impl Mesh {
    /// Draw a line segment between two 3D points.
    /// Creates vertices (with dedup) and the connecting edge.
    /// Returns (v_start, v_end, edge_id).
    ///
    /// # Guards (ADR-003)
    /// - 좌표 성분이 모두 유한
    /// - 선의 길이 ≥ EPSILON_LENGTH (0-length line 거부)
    pub fn draw_line(
        &mut self,
        start: DVec3,
        end: DVec3,
    ) -> Result<(VertId, VertId, EdgeId)> {
        ensure!(
            start.x.is_finite() && start.y.is_finite() && start.z.is_finite(),
            "draw_line start must be finite"
        );
        ensure!(
            end.x.is_finite() && end.y.is_finite() && end.z.is_finite(),
            "draw_line end must be finite"
        );
        ensure!(
            (end - start).length() >= EPSILON_LENGTH,
            "draw_line length {:.2e} below EPSILON_LENGTH {:.2e} — would create degenerate edge (ADR-003)",
            (end - start).length(),
            EPSILON_LENGTH
        );

        // Note: draw_line 은 circle / rect 의 unified pipeline 내부 segment
        //   을 만드는 데도 사용됨. radius 1mm 같은 작은 geometry 의 인접
        //   segment 가 1mm tol 안에 들어가 자기 dedup 되면 degenerate.
        //   따라서 plain add_vertex (1.5μm dedup) 만 사용 — 외부 geometry
        //   와의 1mm-class snap 은 호출자 (draw_rectangle 등) 가 책임.
        let v0 = self.add_vertex(start);
        let v1 = self.add_vertex(end);
        // Snap/dedup 후 두 점이 동일 vertex로 귀결된 경우 self-loop 방지.
        // draw_line은 사용자 드로잉 경로 — 자기참조 엣지는 의미 없으므로 거부.
        // (add_edge 일반은 cone/sphere apex 등 정당한 pole 공유를 허용해야 하므로 건드리지 않음.)
        ensure!(v0 != v1, "draw_line: start and end snap to same vertex — degenerate");
        let (edge_id, _) = self.add_edge(v0, v1)?;
        Ok((v0, v1, edge_id))
    }

    /// Draw a rectangle on a plane defined by center, normal, and up direction.
    /// Returns the face ID and the 4 vertex IDs.
    ///
    /// # Guards (ADR-003)
    /// - width, height ≥ EPSILON_LENGTH
    pub fn draw_rectangle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        up: DVec3,
        width: f64,
        height: f64,
        material: MaterialId,
    ) -> Result<(FaceId, [VertId; 4])> {
        ensure!(
            width.is_finite() && width >= EPSILON_LENGTH,
            "draw_rectangle width {} below EPSILON_LENGTH {} (ADR-003)",
            width, EPSILON_LENGTH
        );
        ensure!(
            height.is_finite() && height >= EPSILON_LENGTH,
            "draw_rectangle height {} below EPSILON_LENGTH {} (ADR-003)",
            height, EPSILON_LENGTH
        );
        ensure!(
            normal.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "draw_rectangle normal must be non-zero"
        );

        let n = normal.normalize();
        let u = up.normalize();
        let v = n.cross(u).normalize();

        let hw = width / 2.0;
        let hh = height / 2.0;

        // 2026-04-27 — 엔진 허용오차 정책 (사용자 정책):
        //   mesh 층은 exact input 만 처리. UI snap (osnap) 이 cursor 를
        //   정확한 위치로 옮겨주므로 미세 어긋남은 입력 단계에서 해소됨.
        //   기본 add_vertex 의 1.5μm dedup 만 사용 (f32 drift 흡수용).
        let v0 = self.add_vertex(center - u * hh - v * hw);
        let v1 = self.add_vertex(center - u * hh + v * hw);
        let v2 = self.add_vertex(center + u * hh + v * hw);
        let v3 = self.add_vertex(center + u * hh - v * hw);

        // CCW winding when viewed from normal direction → normal points outward
        let face_id = self.add_face(&[v0, v3, v2, v1], material)?;

        // 2026-04-24 (ADR-008 Axiom 2): user-drawn RECT edges are HARD so
        // they render between coplanar faces (e.g. after B1 hole-promote
        // puts the rect next to an outer ring on the same plane). Mirrors
        // the mark_edge_hard call exec_draw_line makes per LINE — keeps
        // LINE↔RECT edge parity regardless of which code path produced
        // the rect.
        if let Ok(edges) = self.face_outer_edges(face_id) {
            for eid in edges {
                self.mark_edge_hard(eid);
            }
        }

        // ADR-007 — draw 후 invariants 검증
        self.debug_verify_invariants();
        Ok((face_id, [v0, v3, v2, v1]))
    }

    /// Draw a regular polygon (approximation of circle) on a plane.
    /// Returns the face ID and vertex IDs.
    ///
    /// # Guards (ADR-003)
    /// - radius ≥ EPSILON_LENGTH
    /// - segments ≥ 3 (삼각형이 최소 다각형)
    pub fn draw_circle(
        &mut self,
        center: DVec3,
        normal: DVec3,
        radius: f64,
        segments: u32,
        material: MaterialId,
    ) -> Result<(FaceId, Vec<VertId>)> {
        ensure!(
            radius.is_finite() && radius >= EPSILON_LENGTH,
            "draw_circle radius {} below EPSILON_LENGTH {} (ADR-003)",
            radius, EPSILON_LENGTH
        );
        ensure!(
            segments >= 3,
            "draw_circle requires segments >= 3, got {}",
            segments
        );
        ensure!(
            normal.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "draw_circle normal must be non-zero"
        );

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

        // CCW winding when viewed from normal direction (same as rect).
        // 엔진 허용오차 정책: plain add_vertex 만 사용 (1.5μm dedup).
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = center + u * (radius * angle.cos()) + v * (radius * angle.sin());
            verts.push(self.add_vertex(pos));
        }

        let face_id = self.add_face(&verts, material)?;

        // 2026-04-24 (ADR-008 Axiom 2): same HARD-edge policy as draw_rectangle.
        if let Ok(edges) = self.face_outer_edges(face_id) {
            for eid in edges {
                self.mark_edge_hard(eid);
            }
        }

        // ADR-007 — draw 후 invariants 검증
        self.debug_verify_invariants();
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
    fn test_pentagon_loop_detected() {
        // Draw 5 lines forming a regular pentagon on XY plane
        let mut mesh = Mesh::new();
        let n = 5;
        let radius = 100.0;
        let pts: Vec<DVec3> = (0..n).map(|i| {
            let angle = std::f64::consts::TAU * (i as f64) / (n as f64);
            DVec3::new(radius * angle.cos(), radius * angle.sin(), 0.0)
        }).collect();

        for i in 0..(n - 1) {
            mesh.draw_line(pts[i], pts[i + 1]).unwrap();
        }
        // Close the loop
        let (v0, v1, eid) = mesh.draw_line(pts[n - 1], pts[0]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_some(), "Should detect pentagon loop");
        assert_eq!(loop_verts.unwrap().len(), 5);
    }

    #[test]
    fn test_hexagon_loop_detected() {
        // Draw 6 lines forming a regular hexagon on XZ plane (ground)
        let mut mesh = Mesh::new();
        let n = 6;
        let radius = 50.0;
        let pts: Vec<DVec3> = (0..n).map(|i| {
            let angle = std::f64::consts::TAU * (i as f64) / (n as f64);
            DVec3::new(radius * angle.cos(), 0.0, radius * angle.sin())
        }).collect();

        for i in 0..(n - 1) {
            mesh.draw_line(pts[i], pts[i + 1]).unwrap();
        }
        let (v0, v1, eid) = mesh.draw_line(pts[n - 1], pts[0]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_some(), "Should detect hexagon loop");
        assert_eq!(loop_verts.unwrap().len(), 6);
    }

    #[test]
    fn test_octagon_loop_detected() {
        // 8-sided polygon on YZ plane
        let mut mesh = Mesh::new();
        let n = 8;
        let radius = 200.0;
        let pts: Vec<DVec3> = (0..n).map(|i| {
            let angle = std::f64::consts::TAU * (i as f64) / (n as f64);
            DVec3::new(0.0, radius * angle.cos(), radius * angle.sin())
        }).collect();

        for i in 0..(n - 1) {
            mesh.draw_line(pts[i], pts[i + 1]).unwrap();
        }
        let (v0, v1, eid) = mesh.draw_line(pts[n - 1], pts[0]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_some(), "Should detect octagon loop");
        assert_eq!(loop_verts.unwrap().len(), 8);
    }

    #[test]
    fn test_l_shape_no_loop() {
        // L-shape: 5 edges that don't close
        let mut mesh = Mesh::new();
        let pts = [
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(1.0, 1.0, 0.0),
            DVec3::new(0.5, 1.0, 0.0),
            DVec3::new(0.5, 0.5, 0.0),
            DVec3::new(0.0, 0.5, 0.0), // doesn't connect back to (0,0,0)
        ];

        for i in 0..4 {
            mesh.draw_line(pts[i], pts[i + 1]).unwrap();
        }
        let (v0, v1, eid) = mesh.draw_line(pts[4], pts[5]).unwrap();

        let loop_verts = mesh.detect_free_edge_loop(v0, v1, eid);
        assert!(loop_verts.is_none(), "Open L-shape should not form a loop");
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

    // ═══════════════════════════════════════════════════════════════════
    // Geometric Validity Guards (ADR-003)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn draw_line_rejects_zero_length() {
        let mut m = Mesh::new();
        let p = DVec3::new(1.0, 2.0, 3.0);
        let r = m.draw_line(p, p);
        assert!(r.is_err(), "zero-length line must be rejected");
    }

    #[test]
    fn draw_line_rejects_subepsilon_length() {
        let mut m = Mesh::new();
        let p0 = DVec3::new(0.0, 0.0, 0.0);
        let p1 = DVec3::new(EPSILON_LENGTH * 0.5, 0.0, 0.0);
        let r = m.draw_line(p0, p1);
        assert!(r.is_err(), "sub-epsilon line must be rejected");
    }

    #[test]
    fn draw_line_rejects_nan_endpoint() {
        let mut m = Mesh::new();
        let r = m.draw_line(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(f64::NAN, 0.0, 0.0),
        );
        assert!(r.is_err());
    }

    #[test]
    fn draw_rectangle_rejects_zero_width() {
        let mut m = Mesh::new();
        let r = m.draw_rectangle(
            DVec3::ZERO, DVec3::Y, DVec3::X,
            0.0, 1.0,
            MaterialId::new(0),
        );
        assert!(r.is_err());
    }

    #[test]
    fn draw_rectangle_rejects_subepsilon() {
        let mut m = Mesh::new();
        let r = m.draw_rectangle(
            DVec3::ZERO, DVec3::Y, DVec3::X,
            EPSILON_LENGTH * 0.5, 1.0,
            MaterialId::new(0),
        );
        assert!(r.is_err(), "sub-epsilon width must be rejected");
    }

    #[test]
    fn draw_circle_rejects_zero_radius() {
        let mut m = Mesh::new();
        let r = m.draw_circle(
            DVec3::ZERO, DVec3::Y,
            0.0, 16,
            MaterialId::new(0),
        );
        assert!(r.is_err());
    }

    #[test]
    fn draw_circle_rejects_too_few_segments() {
        let mut m = Mesh::new();
        let r = m.draw_circle(
            DVec3::ZERO, DVec3::Y,
            1.0, 2,  // 2 segments → 거부 (최소 3)
            MaterialId::new(0),
        );
        assert!(r.is_err());
    }
}
