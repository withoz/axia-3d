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
        // ADR-007 — polar singularity 문제 해결:
        // 기존 코드는 북/남극에서 u_segments개의 정점을 생성했으나 spatial hash
        // dedup으로 전부 단일 vertex로 병합 → quad가 퇴화되고 한 엣지가 N개
        // face에 공유돼 non-manifold 위반.
        //
        // 올바른 토폴로지:
        //   - 북극: 단일 vertex (pole_n)
        //   - 남극: 단일 vertex (pole_s)
        //   - 사이에 (v_segments - 1)개의 intermediate ring
        //   - 북극 cap: 삼각형 fan (pole_n, ring[0][u], ring[0][next_u])
        //   - 중간: quad strip
        //   - 남극 cap: 삼각형 fan (ring[last][next_u], ring[last][u], pole_s)

        if v_segments < 2 || u_segments < 3 {
            anyhow::bail!(
                "create_sphere: need u_segments>=3, v_segments>=2 (got {}, {})",
                u_segments, v_segments
            );
        }

        let mut faces = Vec::new();

        // 극점 단일 정점
        let pole_n = self.add_vertex(center + DVec3::new(0.0, radius, 0.0));
        let pole_s = self.add_vertex(center + DVec3::new(0.0, -radius, 0.0));

        // 중간 링: v = 1..v_segments-1 (남북극 제외)
        let mut rings: Vec<Vec<VertId>> = Vec::with_capacity((v_segments - 1) as usize);
        for v in 1..v_segments {
            let theta = std::f64::consts::PI * (v as f64) / (v_segments as f64);
            let y = radius * theta.cos();
            let r = radius * theta.sin();
            let mut ring = Vec::with_capacity(u_segments as usize);
            for u in 0..u_segments {
                let phi = 2.0 * std::f64::consts::PI * (u as f64) / (u_segments as f64);
                let x = r * phi.cos();
                let z = r * phi.sin();
                ring.push(self.add_vertex(center + DVec3::new(x, y, z)));
            }
            rings.push(ring);
        }

        // 북극 cap — 삼각형 fan (winding: pole, next, u → outward +Y)
        // u→next가 구의 측면에서 CCW이지만, pole 중심의 fan에서는 반대로
        // 돌려야 normal이 +Y (바깥쪽)로 향함.
        if let Some(first_ring) = rings.first() {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let tri = vec![
                    pole_n,
                    first_ring[next_u as usize],
                    first_ring[u as usize],
                ];
                let f = self.add_face(&tri, material)?;
                faces.push(f);
            }
        }

        // 중간 quad strips — 인접 ring 사이
        for v in 0..(rings.len().saturating_sub(1)) {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let quad = vec![
                    rings[v][u as usize],
                    rings[v][next_u as usize],
                    rings[v + 1][next_u as usize],
                    rings[v + 1][u as usize],
                ];
                let f = self.add_face(&quad, material)?;
                faces.push(f);
            }
        }

        // 남극 cap — 삼각형 fan (winding: u, next, pole → outward -Y)
        // 북극과 대칭: 바깥쪽 normal이 -Y 향하도록 순서 설정.
        if let Some(last_ring) = rings.last() {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let tri = vec![
                    last_ring[u as usize],
                    last_ring[next_u as usize],
                    pole_s,
                ];
                let f = self.add_face(&tri, material)?;
                faces.push(f);
            }
        }

        Ok(faces)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::id::MaterialId;

    // ADR-007 Phase 2 — 프리미티브가 invariants를 준수하는지 전수 감사

    #[test]
    fn cylinder_invariants_pass() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_cylinder(DVec3::ZERO, 50.0, 100.0, 16, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "cylinder: {}", report.summary());
    }

    #[test]
    fn cone_invariants_pass() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_cone(DVec3::ZERO, 50.0, 100.0, 16, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "cone: {}", report.summary());
    }

    #[test]
    fn sphere_invariants_pass() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_sphere(DVec3::ZERO, 50.0, 16, 12, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "sphere: {}", report.summary());
    }

    #[test]
    fn sphere_poles_face_outward() {
        // 북극 cap은 +Y, 남극 cap은 -Y 방향 normal 향해야 함
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_sphere(DVec3::ZERO, 100.0, 16, 8, mat).unwrap();

        // 극점 인근 face 판단: face의 평균 y가 매우 높거나 매우 낮은 것들
        let mut pole_n_count = 0;
        let mut pole_s_count = 0;
        for fid in &faces {
            let start = mesh.faces[*fid].outer().start;
            let verts = mesh.collect_loop_verts(start).unwrap();
            let mut avg_y = 0.0;
            for v in &verts {
                avg_y += mesh.vertex_pos(*v).unwrap().y;
            }
            avg_y /= verts.len() as f64;
            let normal = mesh.faces[*fid].normal();
            if avg_y > 80.0 {
                // 북극 근처 — normal.y > 0 이어야 outward
                assert!(normal.y > 0.0,
                    "north cap face {:?} normal.y={} (expect >0)", fid, normal.y);
                pole_n_count += 1;
            } else if avg_y < -80.0 {
                // 남극 근처 — normal.y < 0 이어야 outward
                assert!(normal.y < 0.0,
                    "south cap face {:?} normal.y={} (expect <0)", fid, normal.y);
                pole_s_count += 1;
            }
        }
        assert!(pole_n_count >= 3, "expected ≥3 north cap faces, got {}", pole_n_count);
        assert!(pole_s_count >= 3, "expected ≥3 south cap faces, got {}", pole_s_count);
    }

    #[test]
    fn multiple_primitives_invariants_pass() {
        // 여러 프리미티브 동시 생성 후에도 invariants 유지
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_cylinder(DVec3::new(-200.0, 0.0, 0.0), 30.0, 80.0, 12, mat).unwrap();
        mesh.create_cone(DVec3::new(0.0, 0.0, 0.0), 40.0, 90.0, 16, mat).unwrap();
        mesh.create_sphere(DVec3::new(200.0, 0.0, 0.0), 50.0, 20, 14, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(), "combined: {}", report.summary());
    }
}
