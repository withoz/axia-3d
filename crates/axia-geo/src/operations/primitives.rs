//! Primitive shape creation — Cylinder, Cone, Sphere.

use glam::DVec3;
use anyhow::Result;

use crate::entities::id::*;
use crate::mesh::Mesh;
use crate::surfaces::AnalyticSurface;

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

        let mut side_faces_for_soften: Vec<FaceId> = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let next = (i + 1) % segments;
            let quad = vec![
                bottom_verts[i as usize],
                bottom_verts[next as usize],
                top_verts[next as usize],
                top_verts[i as usize],
            ];
            let side_face = self.add_face(&quad, material)?;
            side_faces_for_soften.push(side_face);

            // ADR-032 P17 — attach Cylinder analytic surface to each side
            // face for view-time refinement and downstream analytical ops.
            let two_pi = 2.0 * std::f64::consts::PI;
            let theta_start = two_pi * (i as f64) / (segments as f64);
            let theta_end = two_pi * ((i + 1) as f64) / (segments as f64);
            let surface = AnalyticSurface::Cylinder {
                axis_origin: bottom_center,
                axis_dir: up,
                radius,
                ref_dir: radial,
                u_range: (theta_start, theta_end),
                v_range: (0.0, height),
            };
            if let Some(f) = self.faces.get_mut(side_face) {
                f.set_surface(Some(surface));
            }
            faces.push(side_face);
        }

        // ADR-032 P17 — caps get Plane surface (axis-perpendicular planes).
        let v_perp = up.cross(radial).normalize_or_zero();
        let plane_basis_u = if v_perp.length_squared() > 0.5 { v_perp } else { radial };
        let cap_range = (-radius * 1.5, radius * 1.5);
        if let Some(f) = self.faces.get_mut(base_face) {
            f.set_surface(Some(AnalyticSurface::Plane {
                origin: bottom_center,
                normal: -up,                 // outward at base = -axis
                basis_u: plane_basis_u,
                u_range: cap_range,
                v_range: cap_range,
            }));
        }
        if let Some(f) = self.faces.get_mut(top_face) {
            f.set_surface(Some(AnalyticSurface::Plane {
                origin: top_center,
                normal: up,                  // outward at top = +axis
                basis_u: plane_basis_u,
                u_range: cap_range,
                v_range: cap_range,
            }));
        }

        // Hide tessellation chord edges on top/bottom rings so the cylinder
        // appears as a smooth curve rather than an n-gon.
        self.mark_face_outer_soft(base_face)?;
        self.mark_face_outer_soft(top_face)?;
        // ADR-087 K-η: vertical chord edges between adjacent side faces
        // also marked soft. Angle-based filter (~20.1°) doesn't catch them
        // for low segment count (e.g., 16 segments → 22.5° each, > 20.1°).
        // Explicit soft marking → smooth visual at any segment count.
        for &fid in &side_faces_for_soften {
            self.mark_face_outer_soft(fid)?;
        }

        Ok(faces)
    }

    /// Create an axis-aligned box (6 faces, closed solid).
    ///
    /// `center` is the box centroid. `width` is the X-extent, `height` the
    /// Y-extent, `depth` the Z-extent. All 6 faces wound CCW from outside
    /// so the result satisfies ADR-007 invariants out of the box (pun
    /// intended) — every face classifies as Wall, normal points outward.
    pub fn create_box(
        &mut self,
        center: DVec3,
        width: f64,
        height: f64,
        depth: f64,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        let hx = width  * 0.5;
        let hy = height * 0.5;
        let hz = depth  * 0.5;

        // 8 corners — naming: x{0|1}y{0|1}z{0|1}
        // 0 = -half, 1 = +half along that axis.
        let v000 = self.add_vertex(center + DVec3::new(-hx, -hy, -hz));
        let v100 = self.add_vertex(center + DVec3::new( hx, -hy, -hz));
        let v110 = self.add_vertex(center + DVec3::new( hx,  hy, -hz));
        let v010 = self.add_vertex(center + DVec3::new(-hx,  hy, -hz));
        let v001 = self.add_vertex(center + DVec3::new(-hx, -hy,  hz));
        let v101 = self.add_vertex(center + DVec3::new( hx, -hy,  hz));
        let v111 = self.add_vertex(center + DVec3::new( hx,  hy,  hz));
        let v011 = self.add_vertex(center + DVec3::new(-hx,  hy,  hz));

        // Right-hand rule winding: outward normal points away from box
        // interior. Each face uses ONLY the four corners on its plane.
        let mut faces = Vec::with_capacity(6);
        // Bottom (Y=-hy, normal -Y) verts where y bit = 0
        faces.push(self.add_face(&[v000, v100, v101, v001], material)?);
        // Top (Y=+hy, normal +Y) verts where y bit = 1
        faces.push(self.add_face(&[v010, v011, v111, v110], material)?);
        // Front (Z=+hz, normal +Z) verts where z bit = 1
        faces.push(self.add_face(&[v001, v101, v111, v011], material)?);
        // Back (Z=-hz, normal -Z) verts where z bit = 0
        faces.push(self.add_face(&[v000, v010, v110, v100], material)?);
        // Right (X=+hx, normal +X) verts where x bit = 1
        faces.push(self.add_face(&[v100, v110, v111, v101], material)?);
        // Left (X=-hx, normal -X) verts where x bit = 0
        faces.push(self.add_face(&[v000, v001, v011, v010], material)?);

        // ADR-087 K-δ — attach Plane AnalyticSurface to all 6 faces so
        // kernel-aware ops (createSolidExtrude / Boolean / offset) accept
        // any box face as profile. Mirrors ADR-032 P17 cylinder/cone caps.
        // Each face's plane: origin = face center, normal = outward axis,
        // basis_u = perpendicular axis. Order matches faces[] above.
        let face_planes: [(DVec3, DVec3, DVec3); 6] = [
            // Bottom (face 0): origin (cx, cy-hy, cz), normal -Y, basis +X
            (center + DVec3::new(0.0, -hy, 0.0), -DVec3::Y, DVec3::X),
            // Top (face 1): origin (cx, cy+hy, cz), normal +Y, basis +X
            (center + DVec3::new(0.0,  hy, 0.0),  DVec3::Y, DVec3::X),
            // Front (face 2): origin (cx, cy, cz+hz), normal +Z, basis +X
            (center + DVec3::new(0.0, 0.0,  hz),  DVec3::Z, DVec3::X),
            // Back (face 3): origin (cx, cy, cz-hz), normal -Z, basis +X
            (center + DVec3::new(0.0, 0.0, -hz), -DVec3::Z, DVec3::X),
            // Right (face 4): origin (cx+hx, cy, cz), normal +X, basis +Y
            (center + DVec3::new( hx, 0.0, 0.0),  DVec3::X, DVec3::Y),
            // Left (face 5): origin (cx-hx, cy, cz), normal -X, basis +Y
            (center + DVec3::new(-hx, 0.0, 0.0), -DVec3::X, DVec3::Y),
        ];
        let max_extent = hx.max(hy).max(hz) * 1.5;
        let plane_range = (-max_extent, max_extent);
        for (i, &fid) in faces.iter().enumerate() {
            let (origin, normal, basis_u) = face_planes[i];
            if let Some(f) = self.faces.get_mut(fid) {
                f.set_surface(Some(AnalyticSurface::Plane {
                    origin,
                    normal,
                    basis_u,
                    u_range: plane_range,
                    v_range: plane_range,
                }));
            }
        }

        Ok(faces)
    }

    /// Create a true cone with single apex vertex (사용자 시연 2026-05-08):
    /// - 1 apex vertex at top
    /// - N base ring vertices
    /// - 1 N-gon base cap face (Plane surface, normal -up)
    /// - N triangle side faces sharing apex (Cone surface)
    ///
    /// ADR-087 K-η: 이전 truncated frustum (top_radius = 0.1 * radius) →
    /// true cone (top_radius = 0). 사용자 보고 "콘의 VERTEX가 이상":
    /// truncation 으로 인한 small flat top cap 제거, single apex 정점.
    ///
    /// Manifold safety (ADR-007): N triangles share apex (N-valent vertex).
    /// 이는 manifold 정의 (edge incidence) 에서 허용 — sphere 의 polar fan
    /// 패턴 (LOCKED #16 ADR-007 Phase 2) 동일.
    pub fn create_cone(
        &mut self,
        center: DVec3,
        radius: f64,
        height: f64,
        segments: u32,
        material: MaterialId,
    ) -> Result<Vec<FaceId>> {
        if segments < 3 {
            anyhow::bail!("create_cone: need segments >= 3 (got {})", segments);
        }
        if radius <= 1e-9 || height <= 1e-9 {
            anyhow::bail!(
                "create_cone: radius and height must be positive (got r={}, h={})",
                radius, height,
            );
        }

        let mut faces = Vec::new();
        let up = DVec3::Y;
        let arbitrary = if up.y.abs() < 0.9 { DVec3::Y } else { DVec3::X };
        let radial = up.cross(arbitrary).normalize();
        let tangent = up.cross(radial).normalize();

        let base_center = center;
        let apex_pt = center + up * height;

        // Apex single vertex.
        let apex_v = self.add_vertex(apex_pt);

        // Base ring vertices (CCW from above when viewed normally; reversed
        // for the base cap face below to ensure outward (-up) normal).
        let mut base_verts = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
            let pos = base_center + radial * (radius * angle.cos()) + tangent * (radius * angle.sin());
            base_verts.push(self.add_vertex(pos));
        }

        // Base cap face (CW when viewed from above → normal points -up).
        let mut base_face_verts = base_verts.clone();
        base_face_verts.reverse();
        let base_face = self.add_face(&base_face_verts, material)?;
        faces.push(base_face);

        // ADR-087 K-η Cone surface params: apex above base, axis points
        // DOWN (apex → base). v = axial distance from apex along axis_dir.
        // At v = height: radius = height * tan(α) = radius (base) ✓
        // At v = 0: radius = 0 (apex) ✓
        let cone_half_angle = (radius / height).atan();
        let cone_axis_dir = -up;
        let v_base = height; // (base - apex)·(-up) = height since apex = base + up*height

        // Side triangles — N faces, each sharing apex_v + two adjacent
        // base ring verts. Winding: [apex, base[i+1], base[i]] gives outward
        // normal (perpendicular to axis, radially outward).
        let two_pi = 2.0 * std::f64::consts::PI;
        let mut side_faces_for_soften: Vec<FaceId> = Vec::with_capacity(segments as usize);
        for i in 0..segments {
            let next = (i + 1) % segments;
            let tri = vec![
                apex_v,
                base_verts[next as usize],
                base_verts[i as usize],
            ];
            let side_face = self.add_face(&tri, material)?;
            side_faces_for_soften.push(side_face);

            // Cone surface attach — partial sector (theta_start..theta_end),
            // v_range from apex (0) to base (height).
            let theta_start = two_pi * (i as f64) / (segments as f64);
            let theta_end = two_pi * ((i + 1) as f64) / (segments as f64);
            let surface = AnalyticSurface::Cone {
                apex: apex_pt,
                axis_dir: cone_axis_dir,
                half_angle: cone_half_angle,
                ref_dir: radial,
                u_range: (theta_start, theta_end),
                v_range: (0.0, v_base),
            };
            if let Some(f) = self.faces.get_mut(side_face) {
                f.set_surface(Some(surface));
            }
            faces.push(side_face);
        }

        // ADR-087 K-δ — Base cap Plane surface attach for kernel-aware ops
        // (Push/Pull / Boolean / Offset). True cone has no top cap.
        let v_perp = up.cross(radial).normalize_or_zero();
        let plane_basis_u = if v_perp.length_squared() > 0.5 { v_perp } else { radial };
        let cap_range = (-radius * 1.5, radius * 1.5);
        if let Some(f) = self.faces.get_mut(base_face) {
            f.set_surface(Some(AnalyticSurface::Plane {
                origin: base_center,
                normal: -up,                 // outward at base = -axis
                basis_u: plane_basis_u,
                u_range: cap_range,
                v_range: cap_range,
            }));
        }

        // Hide tessellation chord rings (base only — true cone has no top).
        self.mark_face_outer_soft(base_face)?;
        // ADR-087 K-η: side fan chord edges (apex→base) also soft.
        for &fid in &side_faces_for_soften {
            self.mark_face_outer_soft(fid)?;
        }

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

        // ADR-032 P17 — helper: build a Sphere analytic surface for a face
        // covering parameter sub-range [u_min, u_max] × [v_lat_min, v_lat_max].
        // The mesh uses sphere convention: y = radius·cos(θ), where θ ∈ [0,π]
        // is the polar (theta) angle from north pole. Convert to our latitude
        // convention: latitude = π/2 - θ ∈ [-π/2, +π/2].
        let two_pi = 2.0 * std::f64::consts::PI;
        let make_sphere_surface = |u_min: f64, u_max: f64, lat_min: f64, lat_max: f64| {
            AnalyticSurface::Sphere {
                center,
                radius,
                u_range: (u_min, u_max),
                v_range: (lat_min, lat_max),
            }
        };
        let theta_for_v = |v: u32| std::f64::consts::PI * (v as f64) / (v_segments as f64);
        let lat_for_v = |v: u32| std::f64::consts::FRAC_PI_2 - theta_for_v(v);

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
                let u_min = two_pi * (u as f64) / (u_segments as f64);
                let u_max = two_pi * ((u + 1) as f64) / (u_segments as f64);
                let surface = make_sphere_surface(
                    u_min, u_max,
                    lat_for_v(1), std::f64::consts::FRAC_PI_2,
                );
                if let Some(face_ref) = self.faces.get_mut(f) {
                    face_ref.set_surface(Some(surface));
                }
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
                let u_min = two_pi * (u as f64) / (u_segments as f64);
                let u_max = two_pi * ((u + 1) as f64) / (u_segments as f64);
                let lat_lower = lat_for_v((v + 2) as u32);  // smaller latitude (going south)
                let lat_upper = lat_for_v((v + 1) as u32);
                let (lat_min, lat_max) = if lat_lower < lat_upper {
                    (lat_lower, lat_upper)
                } else {
                    (lat_upper, lat_lower)
                };
                let surface = make_sphere_surface(u_min, u_max, lat_min, lat_max);
                if let Some(face_ref) = self.faces.get_mut(f) {
                    face_ref.set_surface(Some(surface));
                }
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
                let u_min = two_pi * (u as f64) / (u_segments as f64);
                let u_max = two_pi * ((u + 1) as f64) / (u_segments as f64);
                let surface = make_sphere_surface(
                    u_min, u_max,
                    -std::f64::consts::FRAC_PI_2,
                    lat_for_v(v_segments - 1),
                );
                if let Some(face_ref) = self.faces.get_mut(f) {
                    face_ref.set_surface(Some(surface));
                }
                faces.push(f);
            }
        }

        // ADR-087 K-η — Sphere 의 모든 face 가 동일 Sphere surface 를 공유
        // → 인접 face 사이 chord edges 는 surface 의 부산물 (tessellation
        // boundary), 시각적으로 hide 해야 매끈한 구. 모든 face 의 outer
        // edges 를 soft 마킹.
        let all_sphere_faces = faces.clone();
        for fid in all_sphere_faces {
            self.mark_face_outer_soft(fid)?;
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

    /// ADR-032 P17 — Cylinder side faces carry analytic Cylinder surface.
    #[test]
    fn cylinder_side_faces_have_cylinder_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let segments = 16u32;
        let faces = mesh.create_cylinder(DVec3::ZERO, 50.0, 100.0, segments, mat).unwrap();
        // Faces[0] = base, faces[1] = top, faces[2..] = N side faces.
        assert_eq!(faces.len() as u32, 2 + segments);
        let mut cylinder_count = 0;
        for &fid in &faces[2..] {
            match mesh.face_surface(fid) {
                Some(AnalyticSurface::Cylinder { radius, .. }) => {
                    assert!((radius - 50.0).abs() < 1e-9);
                    cylinder_count += 1;
                }
                other => panic!("expected Cylinder surface on side face, got {:?}", other),
            }
        }
        assert_eq!(cylinder_count, segments as usize);
    }

    #[test]
    fn cylinder_caps_have_plane_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_cylinder(DVec3::ZERO, 25.0, 50.0, 8, mat).unwrap();
        // Both caps should be Plane surfaces.
        for &fid in &faces[..2] {
            match mesh.face_surface(fid) {
                Some(AnalyticSurface::Plane { .. }) => {}
                other => panic!("expected Plane surface on cap face, got {:?}", other),
            }
        }
    }

    #[test]
    fn cylinder_surface_radius_matches_input() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let r = 12.345;
        let faces = mesh.create_cylinder(DVec3::ZERO, r, 100.0, 12, mat).unwrap();
        for &fid in &faces[2..] {
            if let Some(AnalyticSurface::Cylinder { radius, .. }) = mesh.face_surface(fid) {
                assert!((radius - r).abs() < 1e-12, "radius {} != input {}", radius, r);
            }
        }
    }

    #[test]
    fn sphere_side_faces_have_sphere_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let r = 25.0;
        let faces = mesh.create_sphere(DVec3::ZERO, r, 16, 8, mat).unwrap();
        let mut sphere_count = 0;
        for &fid in &faces {
            if let Some(AnalyticSurface::Sphere { radius, .. }) = mesh.face_surface(fid) {
                assert!((radius - r).abs() < 1e-9);
                sphere_count += 1;
            }
        }
        assert!(sphere_count > 0,
            "expected at least 1 Sphere surface, got 0 / {}", faces.len());
    }

    #[test]
    fn cone_side_faces_have_cone_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let radius = 50.0;
        let height = 100.0;
        let faces = mesh.create_cone(DVec3::ZERO, radius, height, 16, mat).unwrap();
        let mut cone_count = 0;
        for &fid in &faces {
            if let Some(AnalyticSurface::Cone { half_angle, .. }) = mesh.face_surface(fid) {
                // ADR-087 K-η true cone: tan(half_angle) = radius / height = 0.5
                // → half_angle = atan(0.5) ≈ 0.4636 rad.
                let expected = (radius / height).atan();
                assert!((half_angle - expected).abs() < 1e-6,
                    "half_angle {} ≠ expected {}", half_angle, expected);
                cone_count += 1;
            }
        }
        assert!(cone_count > 0, "expected ≥ 1 Cone surface");
    }

    /// ADR-087 K-δ — Box 6 faces 는 axis-aligned Plane 6개 attach.
    /// 이전 정책 (`box_faces_have_no_surface`) 폐기 — Push/Pull /
    /// createSolidExtrude / Boolean 의 입력으로 box face 사용 시
    /// NoProfileSurface 거부 회귀 차단.
    #[test]
    fn k_delta_box_faces_have_plane_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_box(DVec3::ZERO, 10.0, 10.0, 10.0, mat).unwrap();
        assert_eq!(faces.len(), 6, "box should have exactly 6 faces");
        for &fid in &faces {
            match mesh.face_surface(fid) {
                Some(AnalyticSurface::Plane { .. }) => {}
                other => panic!(
                    "ADR-087 K-δ: box face should have Plane surface, got {:?}",
                    other,
                ),
            }
        }
    }

    /// ADR-087 K-δ — Box 6 faces 의 outward normal 정확성.
    /// 정확한 axis-aligned outward normal 을 가져야 함.
    #[test]
    fn k_delta_box_face_planes_outward_normals_correct() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_box(DVec3::ZERO, 10.0, 10.0, 10.0, mat).unwrap();
        // Order from create_box: Bottom, Top, Front, Back, Right, Left.
        let expected_normals = [
            -DVec3::Y, DVec3::Y,  // Bottom, Top
            DVec3::Z, -DVec3::Z,  // Front, Back
            DVec3::X, -DVec3::X,  // Right, Left
        ];
        for (i, &fid) in faces.iter().enumerate() {
            if let Some(AnalyticSurface::Plane { normal, basis_u, .. }) = mesh.face_surface(fid) {
                assert!(
                    (*normal - expected_normals[i]).length() < 1e-12,
                    "face {i}: normal {:?} != expected {:?}",
                    normal, expected_normals[i],
                );
                // basis_u perpendicular to normal (Plane invariant)
                assert!(
                    basis_u.dot(*normal).abs() < 1e-12,
                    "face {i}: basis_u not perpendicular to normal",
                );
            } else {
                panic!("face {i} missing Plane surface");
            }
        }
    }

    /// ADR-087 K-ε hotfix — LOCKED #12 (ADR-025 P11) regression guard:
    /// Plane attach must NOT cause render mesh to exceed DCEL edges.
    ///
    /// Box has 6 axis-aligned Plane faces (K-δ). export_buffers must use
    /// polygon tessellation (DCEL boundary = exact), NOT surface
    /// tessellation (which would render Plane as 2km × 2km mesh from the
    /// (-1e6, 1e6) parameter range).
    ///
    /// Test: emitted vertex count for a 10×10×10 box must be the polygon
    /// fan triangulation count (4 verts × 6 faces = 24 verts) — not
    /// the surface tessellation count (a sampled grid of >> 24 verts).
    #[test]
    fn k_epsilon_box_plane_uses_polygon_path_not_surface_tess() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_box(DVec3::ZERO, 10.0, 10.0, 10.0, mat).unwrap();
        let (positions, _normals, _indices, _face_map, _positions_f64) =
            mesh.export_buffers().unwrap();
        let n_verts = positions.len() / 3;
        // Polygon path emits each face's outer-loop vertices duplicated
        // per-face (no welding). Box: 6 faces × 4 verts = 24 verts.
        // Surface tessellation would emit O(grid resolution²) >> 24.
        assert!(
            n_verts < 100,
            "ADR-087 K-ε hotfix: Box Plane faces should use polygon path \
             (expected ~24 verts, got {n_verts}). Surface tessellation of \
             Plane (-1e6, 1e6) would explode the vertex count.",
        );
    }

    /// ADR-087 K-δ — End-to-end: Box face + create_solid Extrude
    /// 즉시 통과 (NoProfileSurface 거부 없음).
    #[test]
    fn k_delta_box_face_create_solid_extrude_succeeds() {
        use crate::operations::create_solid::CreateSolidMode;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_box(DVec3::ZERO, 10.0, 10.0, 10.0, mat).unwrap();
        let any_face = faces[0]; // bottom face
        let result = mesh.create_solid(
            any_face,
            CreateSolidMode::Extrude { distance: 5.0 },
            mat,
        );
        assert!(
            result.is_ok(),
            "ADR-087 K-δ: box face Extrude should succeed, got {:?}",
            result.err(),
        );
    }

    /// ADR-087 K-δ — End-to-end: Cone cap + create_solid Extrude.
    #[test]
    fn k_delta_cone_cap_create_solid_extrude_succeeds() {
        use crate::operations::create_solid::CreateSolidMode;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_cone(DVec3::ZERO, 50.0, 100.0, 16, mat).unwrap();
        let cap_face = faces[0]; // base cap
        let result = mesh.create_solid(
            cap_face,
            CreateSolidMode::Extrude { distance: 10.0 },
            mat,
        );
        assert!(
            result.is_ok(),
            "ADR-087 K-δ: cone cap Extrude should succeed, got {:?}",
            result.err(),
        );
    }

    /// ADR-087 K-η hotfix regression — Cone surface evaluated at (v_base, 0)
    /// must equal base radius, and (v_top, 0) must equal top radius. Prior
    /// to fix, apex was below base + axis_dir up → surface widened going up,
    /// 사용자 시연 (2026-05-08) 에서 흰색 cone side 가 base 너머로 퍼지는
    /// 회귀로 노출.
    #[test]
    fn k_eta_cone_surface_evaluates_to_correct_radii() {
        use crate::surfaces::SurfaceOps;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let radius = 50.0;
        let height = 100.0;
        let segments = 16u32;
        let faces = mesh.create_cone(DVec3::ZERO, radius, height, segments, mat).unwrap();
        // ADR-087 K-η true cone — faces[0]=base cap, faces[1..]=N side triangles.
        let side_face = faces[1];
        let surf = mesh.face_surface(side_face).expect("Cone surface attached");
        let (v_min, v_max) = match surf {
            AnalyticSurface::Cone { v_range, .. } => *v_range,
            _ => panic!("expected Cone surface"),
        };
        // True cone: v_min = 0 (apex), v_max = height (base).
        let p_apex = surf.evaluate(0.0, v_min);
        let p_base = surf.evaluate(0.0, v_max);
        let r_apex = ((p_apex.x).powi(2) + (p_apex.z).powi(2)).sqrt();
        let r_base = ((p_base.x).powi(2) + (p_base.z).powi(2)).sqrt();
        assert!(
            r_apex < 1e-3,
            "ADR-087 K-η: Cone apex (v={v_min}) radius should be 0, got {r_apex}",
        );
        assert!(
            (r_base - radius).abs() < 1e-3,
            "ADR-087 K-η: Cone base (v={v_max}) radius should be {radius}, got {r_base}",
        );
    }

    /// ADR-087 K-η — Cone is a TRUE cone (single apex, no top cap).
    /// Only base cap has Plane surface; sides have Cone surface.
    #[test]
    fn k_eta_cone_has_only_base_cap_with_plane_surface() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let segments = 16u32;
        let faces = mesh.create_cone(DVec3::ZERO, 50.0, 100.0, segments, mat).unwrap();
        // True cone: 1 base cap + N side triangles. No top cap.
        assert_eq!(
            faces.len() as u32, 1 + segments,
            "true cone should have 1 base + N side faces (got {})",
            faces.len(),
        );
        // faces[0] = base cap (Plane), faces[1..] = side triangles (Cone).
        match mesh.face_surface(faces[0]) {
            Some(AnalyticSurface::Plane { .. }) => {}
            other => panic!("base cap should have Plane surface, got {:?}", other),
        }
        for &fid in &faces[1..] {
            match mesh.face_surface(fid) {
                Some(AnalyticSurface::Cone { .. }) => {}
                other => panic!("side face should have Cone surface, got {:?}", other),
            }
        }
    }

    /// ADR-087 K-η — Apex must be a single shared vertex (n-valent), not
    /// N separate truncation verts.
    #[test]
    fn k_eta_cone_apex_is_single_vertex() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let segments = 16u32;
        let height = 100.0;
        let faces = mesh.create_cone(DVec3::ZERO, 50.0, height, segments, mat).unwrap();
        // Find vertex at expected apex position (0, height, 0).
        let apex_pos = DVec3::new(0.0, height, 0.0);
        let mut apex_count = 0;
        for (_, vert) in mesh.verts.iter().filter(|(_, v)| v.is_active()) {
            if (vert.pos() - apex_pos).length() < 1e-6 {
                apex_count += 1;
            }
        }
        assert_eq!(
            apex_count, 1,
            "ADR-087 K-η: apex should be a SINGLE vertex (got {} verts at {:?}) \
             — true cone has 1 apex, no truncation cap",
            apex_count, apex_pos,
        );
        // Side faces 모두 apex 와 관련 (faces[1..] = N side triangles).
        let _ = faces;
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
