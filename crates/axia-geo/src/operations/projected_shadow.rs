//! Projected Shadow — Sun-facing face들의 ground 투영.
//!
//! ## Phase 2.3 재설계 (2026-04-23)
//!
//! Phase 2.2에서 silhouette edge 추출 + loop grouping으로 overlap을 제거하려
//! 했지만, 복잡한 메시(고양이 몸통/꼬리 등)에서 silhouette graph가 junction이나
//! non-manifold edge로 인해 끊겨서 몸통 그림자가 통째로 누락되는 문제 발생.
//!
//! Phase 2.3에서 Viewport material에 `MinEquation` blending을 도입해 overlap
//! 누적 darkening이 수학적으로 해결됨 (min(shadow, bg) per pixel → 균일).
//! 이제 복잡한 silhouette extraction 없이 단순한 per-face projection으로도
//! 결과가 동일하게 균일하면서 topology 실패가 없음.
//!
//! ### 알고리즘
//! 1. 각 active face의 normal · (-sun_dir) 계산 → > eps 면 sun-facing
//! 2. Sun-facing face의 vertex 고리를 sun direction으로 y=0에 투영
//! 3. Fan triangulation으로 버퍼 생성 → Three.js에서 MinEquation으로 렌더
//!
//! ## 장점 (재설계 후)
//! - 모든 복잡한 메시에서 누락 없이 작동 (cat body/tail OK)
//! - MinEquation이 overlap 균일화 담당 → 내부 darkness 균일
//! - 코드 단순, 버그 surface 작음
//!
//! ## 제약 (MVP)
//! - Ground (y=0) 만 receiver
//! - Fan tri 사용 → concave face는 slight artifact (대부분 사용례에서 무시 가능)

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

        // Sun-facing threshold — grazing edge 안정성을 위한 epsilon.
        const SF_EPS: f64 = 0.001;
        // Face의 모든 vertex가 이 높이 이하면 skip (ground self-projection 회피)
        const MIN_HEIGHT: f64 = 1.0;

        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }

            // Sun-facing check
            let dot = face.normal().dot(-sun_dir);
            if dot <= SF_EPS { continue; }

            // Collect outer loop vertices (holes ignored for shadow — 보수적)
            let outer_start = face.outer().start;
            let vert_ids = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if vert_ids.len() < 3 { continue; }
            let verts_3d: Vec<DVec3> = vert_ids.iter()
                .filter_map(|&vid| self.vertex_pos(vid).ok())
                .collect();
            if verts_3d.len() < 3 { continue; }

            // Height filter — 모든 vertex가 ground 이하면 skip
            let max_y = verts_3d.iter().map(|v| v.y).fold(f64::NEG_INFINITY, f64::max);
            if max_y <= MIN_HEIGHT { continue; }

            // Project onto y=0 plane along sun_dir
            let projected: Vec<(f64, f64)> = verts_3d.iter().map(|v| {
                let t = -v.y / sun_dir.y;
                (v.x + sun_dir.x * t, v.z + sun_dir.z * t)
            }).collect();

            // Fan triangulation from vertex 0
            let (x0, z0) = projected[0];
            for i in 1..projected.len() - 1 {
                let (x1, z1) = projected[i];
                let (x2, z2) = projected[i + 1];
                out.push(x0 as f32); out.push(0.0); out.push(z0 as f32);
                out.push(x1 as f32); out.push(0.0); out.push(z1 as f32);
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
