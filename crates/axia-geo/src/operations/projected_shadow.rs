//! Per-face Projected Shadow — SketchUp-style matrix projection onto ground plane.
//!
//! 각 active face 중 "위를 향하는" 면(normal.y > threshold)을 sun direction을
//! 따라 ground plane (y=0)으로 투영한 2D polygon을 반환한다. Shadow map을
//! 전혀 사용하지 않아 scanline / texel acne 등의 artifact 불가능.
//!
//! ## 왜 위를 향하는 면만 projection?
//!
//! 태양이 위에서 비출 때, 빛을 차단하는 "occluder silhouette"의 top 경계를
//! 형성하는 것은 위쪽 normal을 가진 face들이다. 예:
//!   - Cube 상단 face (normal +Y) → ground에 사각형 그림자
//!   - Wall 상단의 얇은 strip → ground에 wall 실루엣
//!   - Sphere 상반구 face들 → ground에 반구 그림자 approximation
//!
//! 옆·아래 face를 추가하면 shadow가 중첩되어 "shadow volume 전체가 ground에
//! 떨어진" 듯한 오표시 발생. Top-only 규칙이 architectural silhouette에 딱.
//!
//! ## 현재 제약 (MVP)
//!
//! - Ground (y=0)에만 투영. 벽/slab 위 receiver는 Phase 2 작업.
//! - Fan triangulation 사용 → convex face(box top)만 정확. Concave/hole은
//!   earcut 필요 (Phase 2).
//! - Ground-level face (all verts y ≤ eps) 는 skip — 자기 자신에 투영 방지.
//!
//! ## 출력 포맷
//!
//! `Vec<f32>`, 각 9 float = 1 triangle (3 vertex × {x, y, z}). y는 항상 0.
//! TS는 이 buffer를 `BufferGeometry`에 직접 세팅해 dark translucent mesh로 렌더.

use glam::DVec3;

use crate::mesh::Mesh;

impl Mesh {
    /// Compute projected shadow triangles on ground (y=0) from all active
    /// top-facing faces. Returns flat buffer of triangle vertices (9 f32 per tri).
    ///
    /// `sun_dir`: normalized light travel direction (from sun toward ground).
    /// Typical value in AXiA scene: normalize(-8000, -15000, -10000) ≈
    /// (-0.408, -0.816, -0.408). sun_dir.y MUST be < -eps; otherwise sun is
    /// parallel to or below ground → no shadow.
    pub fn compute_ground_projected_shadows(&self, sun_dir: DVec3) -> Vec<f32> {
        let mut out = Vec::new();
        if sun_dir.y > -1e-4 {
            // Sun going up or sideways — no cast onto ground.
            return out;
        }

        // Top-face threshold: normal.y > 0.3 → face is "tilted up enough" to
        // cast a meaningful top silhouette. Walls (normal.y ≈ 0) skipped.
        const NORMAL_Y_THRESHOLD: f64 = 0.3;
        // Min face height above ground to cast. User가 그린 ground-level rect
        // 는 자기 자신에 투영하지 않도록 필터.
        const MIN_HEIGHT: f64 = 1.0;

        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let normal = face.normal();
            if normal.y < NORMAL_Y_THRESHOLD { continue; }

            // Collect face outer loop vertices (skip holes for MVP — holes in
            // shadow polygon would need earcut with holes).
            let outer_start = face.outer().start;
            if outer_start.is_null() { continue; }
            let loop_verts = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if loop_verts.len() < 3 { continue; }

            // World positions.
            let positions: Vec<DVec3> = loop_verts.iter()
                .filter_map(|&vid| self.vertex_pos(vid).ok())
                .collect();
            if positions.len() != loop_verts.len() { continue; }

            // Skip ground-level faces.
            let max_y = positions.iter()
                .map(|p| p.y)
                .fold(f64::NEG_INFINITY, f64::max);
            if max_y <= MIN_HEIGHT { continue; }

            // Project each vertex onto y=0 along sun_dir.
            // Ray: p(t) = v + sun_dir * t
            // Solve p.y = 0:  v.y + sun_dir.y * t = 0  →  t = -v.y / sun_dir.y
            let projected: Vec<(f64, f64)> = positions.iter().map(|v| {
                let t = -v.y / sun_dir.y;
                let px = v.x + sun_dir.x * t;
                let pz = v.z + sun_dir.z * t;
                (px, pz)
            }).collect();

            // Fan-triangulate the projected polygon from vertex 0.
            // Works for convex faces (box tops, rect primitives). Concave
            // faces (L-shape slabs) will produce overlap/gaps — acceptable
            // artifact for MVP.
            let (x0, z0) = projected[0];
            for i in 1..projected.len() - 1 {
                let (x1, z1) = projected[i];
                let (x2, z2) = projected[i + 1];
                // Vertex 0 (x0, 0, z0)
                out.push(x0 as f32); out.push(0.0); out.push(z0 as f32);
                // Vertex 1 (x1, 0, z1)
                out.push(x1 as f32); out.push(0.0); out.push(z1 as f32);
                // Vertex 2 (x2, 0, z2)
                out.push(x2 as f32); out.push(0.0); out.push(z2 as f32);
            }
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::*;

    #[test]
    fn empty_mesh_returns_empty() {
        let mesh = Mesh::new();
        let out = mesh.compute_ground_projected_shadows(DVec3::new(0.0, -1.0, 0.0));
        assert!(out.is_empty());
    }

    #[test]
    fn sun_from_above_projects_top_face_onto_ground() {
        // Single face at y=1000, normal +Y (top of a notional cube)
        // CCW from above = (0,0) → (0,1000) → (1000,1000) → (1000,0) gives +Y
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        // Sun straight down → projection should equal source rect
        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        // 4-vertex polygon → fan tri (2 triangles) → 2 * 9 = 18 floats
        assert_eq!(tris.len(), 18);
        // All projected y should be 0
        for i in 0..6 {
            assert!((tris[i * 3 + 1]).abs() < 1e-4);
        }
    }

    #[test]
    fn sun_with_lateral_offset_shifts_projection() {
        // Same face at y=1000 (CCW from above → normal +Y), sun tilted.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(-1.0, -1.0, 0.0).normalize();
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty());
        // All projected y should be 0
        for tri_idx in 0..(tris.len() / 9) {
            assert!((tris[tri_idx * 9 + 1]).abs() < 1e-4, "y0 must be 0");
            assert!((tris[tri_idx * 9 + 4]).abs() < 1e-4, "y1 must be 0");
            assert!((tris[tri_idx * 9 + 7]).abs() < 1e-4, "y2 must be 0");
        }
        // Shadow should be shifted in -X direction (sun_dir.x = -0.707 < 0)
        // Sum all x coordinates — should be overwhelmingly negative since
        // the shadow is shifted to -X side.
        let sum_x: f32 = (0..(tris.len() / 9))
            .flat_map(|i| [tris[i * 9 + 0], tris[i * 9 + 3], tris[i * 9 + 6]])
            .sum();
        assert!(sum_x < -1000.0, "shadow must be shifted toward -X, got sum_x={}", sum_x);
    }

    #[test]
    fn vertical_face_not_projected() {
        // Face with normal pointing sideways (not up-ish)
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(tris.is_empty(), "vertical face (normal.y≈0) should not cast");
    }

    #[test]
    fn ground_level_face_skipped() {
        // Face at y=0 (on ground) — avoid self-projection
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(tris.is_empty(), "ground-level face should not cast on itself");
    }
}
