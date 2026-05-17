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
        // ADR-103-β-1 (Z-up migration): cylinder default axis = +Z.
        // Industry CAD parity (SketchUp / Fusion / SolidWorks).
        let up = DVec3::Z;
        let arbitrary = if up.z.abs() < 0.9 { DVec3::Z } else { DVec3::X };
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

        // ADR-093 + 사용자 통찰 (2026-05-16) — 모든 cylindrical side faces
        // 에 동일 surface_owner_id 부여. SelectTool click 시 N quad sides
        // 일괄 선택 (Path B cylinder 의 single side face canonical 과
        // 동일 성격). "기능 확보 → 결함 자연 해소" canonical strategy.
        let cylinder_owner_id = self.next_surface_owner_id();
        for &fid in &side_faces_for_soften {
            self.set_face_surface_owner_id(fid, Some(cylinder_owner_id));
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
        // ADR-103-β-1 (Z-up migration): parameter semantics 정렬
        //   - width  → X (left/right)
        //   - depth  → Y (front/back, away from viewer)
        //   - height → Z (down/up)
        // Industry CAD parity (SketchUp/Fusion/SolidWorks: Z-up + X-right).
        let hx = width  * 0.5;
        let hy = depth  * 0.5;   // Y-axis half-extent = depth (forward)
        let hz = height * 0.5;   // Z-axis half-extent = height (up)

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
        // ADR-103-β-1 (Z-up): face label semantics:
        //   index 0 = Bottom (-Z), 1 = Top (+Z), 2 = Front (-Y),
        //   3 = Back (+Y), 4 = Right (+X), 5 = Left (-X).
        let mut faces = Vec::with_capacity(6);
        // Bottom (Z=-hz, normal -Z) verts where z bit = 0
        faces.push(self.add_face(&[v000, v010, v110, v100], material)?);
        // Top (Z=+hz, normal +Z) verts where z bit = 1
        faces.push(self.add_face(&[v001, v101, v111, v011], material)?);
        // Front (Y=-hy, normal -Y) verts where y bit = 0
        faces.push(self.add_face(&[v000, v100, v101, v001], material)?);
        // Back (Y=+hy, normal +Y) verts where y bit = 1
        faces.push(self.add_face(&[v010, v011, v111, v110], material)?);
        // Right (X=+hx, normal +X) verts where x bit = 1
        faces.push(self.add_face(&[v100, v110, v111, v101], material)?);
        // Left (X=-hx, normal -X) verts where x bit = 0
        faces.push(self.add_face(&[v000, v001, v011, v010], material)?);

        // ADR-087 K-δ — attach Plane AnalyticSurface to all 6 faces so
        // kernel-aware ops (createSolidExtrude / Boolean / offset) accept
        // any box face as profile. Mirrors ADR-032 P17 cylinder/cone caps.
        // Each face's plane: origin = face center, normal = outward axis,
        // basis_u = perpendicular axis. Order matches faces[] above.
        // ADR-103-β-1 (Z-up): normal axes remapped per face label semantics.
        let face_planes: [(DVec3, DVec3, DVec3); 6] = [
            // Bottom (face 0): origin (cx, cy, cz-hz), normal -Z, basis +X
            (center + DVec3::new(0.0, 0.0, -hz), -DVec3::Z, DVec3::X),
            // Top (face 1): origin (cx, cy, cz+hz), normal +Z, basis +X
            (center + DVec3::new(0.0, 0.0,  hz),  DVec3::Z, DVec3::X),
            // Front (face 2): origin (cx, cy-hy, cz), normal -Y, basis +X
            (center + DVec3::new(0.0, -hy, 0.0), -DVec3::Y, DVec3::X),
            // Back (face 3): origin (cx, cy+hy, cz), normal +Y, basis +X
            (center + DVec3::new(0.0,  hy, 0.0),  DVec3::Y, DVec3::X),
            // Right (face 4): origin (cx+hx, cy, cz), normal +X, basis +Z
            (center + DVec3::new( hx, 0.0, 0.0),  DVec3::X, DVec3::Z),
            // Left (face 5): origin (cx-hx, cy, cz), normal -X, basis +Z
            (center + DVec3::new(-hx, 0.0, 0.0), -DVec3::X, DVec3::Z),
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
        // ADR-103-β-1 (Z-up migration): cone default axis = +Z.
        let up = DVec3::Z;
        let arbitrary = if up.z.abs() < 0.9 { DVec3::Z } else { DVec3::X };
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

        // ADR-093 + 사용자 통찰 (2026-05-16) — 모든 conical side faces 에
        // 동일 surface_owner_id 부여. SelectTool click 시 N triangle sides
        // 일괄 선택 (cylinder 와 동일 성격).
        let cone_owner_id = self.next_surface_owner_id();
        for &fid in &side_faces_for_soften {
            self.set_face_surface_owner_id(fid, Some(cone_owner_id));
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

        // ADR-103-β-1 (Z-up): poles on +Z / -Z axis (industry CAD parity).
        let pole_n = self.add_vertex(center + DVec3::new(0.0, 0.0,  radius));
        let pole_s = self.add_vertex(center + DVec3::new(0.0, 0.0, -radius));

        // 중간 링: v = 1..v_segments-1 (남북극 제외)
        // theta ∈ [0, π] = polar angle from +Z (north pole).
        let mut rings: Vec<Vec<VertId>> = Vec::with_capacity((v_segments - 1) as usize);
        for v in 1..v_segments {
            let theta = std::f64::consts::PI * (v as f64) / (v_segments as f64);
            let z = radius * theta.cos();   // ADR-103-β-1: latitude on Z axis
            let r = radius * theta.sin();
            let mut ring = Vec::with_capacity(u_segments as usize);
            for u in 0..u_segments {
                let phi = 2.0 * std::f64::consts::PI * (u as f64) / (u_segments as f64);
                let x = r * phi.cos();
                let y = r * phi.sin();      // ADR-103-β-1: ring in XY plane
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

        // ADR-103-β-1 (Z-up): phi 가 +Z 에서 본 CCW 방향이라 winding 이
        // Y-up 시점과 반대 — fan 의 next_u/u 순서를 swap 해서 outward +Z.
        // 북극 cap — 삼각형 fan (winding: pole, u, next → outward +Z)
        if let Some(first_ring) = rings.first() {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let tri = vec![
                    pole_n,
                    first_ring[u as usize],
                    first_ring[next_u as usize],
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
                // ADR-103-β-1 (Z-up): phi CCW from +Z view → reverse
                // quad winding for outward radial normal.
                let quad = vec![
                    rings[v][u as usize],
                    rings[v + 1][u as usize],
                    rings[v + 1][next_u as usize],
                    rings[v][next_u as usize],
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

        // 남극 cap — 삼각형 fan (winding: next, u, pole → outward -Z)
        // ADR-103-β-1 (Z-up): symmetry to north cap — swap u/next.
        if let Some(last_ring) = rings.last() {
            for u in 0..u_segments {
                let next_u = (u + 1) % u_segments;
                let tri = vec![
                    last_ring[next_u as usize],
                    last_ring[u as usize],
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
        for fid in &all_sphere_faces {
            self.mark_face_outer_soft(*fid)?;
        }

        // ADR-093 + 사용자 통찰 (2026-05-16) — Sphere 의 모든 face 가
        // 동일 surface_owner_id. SelectTool click 시 전체 sphere 일괄 선택
        // (cylinder/cone 와 동일 성격, "기능 확보 → 결함 자연 해소").
        let sphere_owner_id = self.next_surface_owner_id();
        for &fid in &all_sphere_faces {
            self.set_face_surface_owner_id(fid, Some(sphere_owner_id));
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

    // ════════════════════════════════════════════════════════════════════
    // ADR-093 + 사용자 통찰 (2026-05-16) — primitive surface owner-id grouping.
    //
    // create_cylinder / create_cone / create_sphere 가 N side faces 에
    // 동일 surface_owner_id 부여 → SelectTool click 시 전체 일괄 선택.
    // Path B cylinder 의 single side face canonical 와 동일 성격.
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn primitive_cylinder_sides_share_owner_id() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let segments = 16u32;
        let faces = mesh.create_cylinder(DVec3::ZERO, 50.0, 100.0, segments, mat).unwrap();

        // faces[0] = base, [1] = top, [2..] = N sides
        let side_owner = mesh.face_surface_owner_id(faces[2]);
        assert!(side_owner.is_some(), "cylinder side must have owner_id");
        for &side in &faces[2..] {
            assert_eq!(mesh.face_surface_owner_id(side), side_owner,
                "all cylinder sides share owner_id");
        }
        // Caps should NOT share side owner (different surface type).
        assert_ne!(mesh.face_surface_owner_id(faces[0]), side_owner,
            "base cap must NOT share side owner");
        assert_ne!(mesh.face_surface_owner_id(faces[1]), side_owner,
            "top cap must NOT share side owner");
    }

    #[test]
    fn primitive_cone_sides_share_owner_id() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let segments = 16u32;
        let faces = mesh.create_cone(DVec3::ZERO, 50.0, 100.0, segments, mat).unwrap();

        // faces[0] = base cap, [1..] = N side triangles
        let side_owner = mesh.face_surface_owner_id(faces[1]);
        assert!(side_owner.is_some(), "cone side must have owner_id");
        for &side in &faces[1..] {
            assert_eq!(mesh.face_surface_owner_id(side), side_owner,
                "all cone sides share owner_id");
        }
        assert_ne!(mesh.face_surface_owner_id(faces[0]), side_owner,
            "base cap must NOT share side owner");
    }

    #[test]
    fn primitive_sphere_all_faces_share_owner_id() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_sphere(DVec3::ZERO, 50.0, 8, 16, mat).unwrap();

        // Sphere = closed surface, all faces share single owner_id.
        let first_owner = mesh.face_surface_owner_id(faces[0]);
        assert!(first_owner.is_some(), "sphere face must have owner_id");
        for &fid in &faces {
            assert_eq!(mesh.face_surface_owner_id(fid), first_owner,
                "all sphere faces share single owner_id");
        }
    }

    #[test]
    fn primitive_two_cylinders_get_distinct_owner_ids() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces_a = mesh.create_cylinder(DVec3::ZERO, 5.0, 10.0, 16, mat).unwrap();
        let faces_b = mesh.create_cylinder(DVec3::new(20.0, 0.0, 0.0), 5.0, 10.0, 16, mat).unwrap();

        let owner_a = mesh.face_surface_owner_id(faces_a[2]);
        let owner_b = mesh.face_surface_owner_id(faces_b[2]);
        assert!(owner_a.is_some() && owner_b.is_some());
        assert_ne!(owner_a, owner_b,
            "two separate cylinders must get distinct owner_ids");
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
        // ADR-103-β-1 (Z-up): face label semantics —
        //   Bottom (-Z), Top (+Z), Front (-Y), Back (+Y), Right (+X), Left (-X).
        let expected_normals = [
            -DVec3::Z, DVec3::Z,  // Bottom, Top
            -DVec3::Y, DVec3::Y,  // Front, Back
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
        // ADR-103-β-1 (Z-up): cone axis = +Z → radial extent = X-Y plane.
        let r_apex = ((p_apex.x).powi(2) + (p_apex.y).powi(2)).sqrt();
        let r_base = ((p_base.x).powi(2) + (p_base.y).powi(2)).sqrt();
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
        // ADR-103-β-1 (Z-up): apex now at (0, 0, height).
        let apex_pos = DVec3::new(0.0, 0.0, height);
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
        // ADR-103-β-1 (Z-up): 북극 cap = +Z, 남극 cap = -Z outward.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_sphere(DVec3::ZERO, 100.0, 16, 8, mat).unwrap();

        // 극점 인근 face 판단: face의 평균 z가 매우 높거나 매우 낮은 것들
        let mut pole_n_count = 0;
        let mut pole_s_count = 0;
        for fid in &faces {
            let start = mesh.faces[*fid].outer().start;
            let verts = mesh.collect_loop_verts(start).unwrap();
            let mut avg_z = 0.0;
            for v in &verts {
                avg_z += mesh.vertex_pos(*v).unwrap().z;
            }
            avg_z /= verts.len() as f64;
            let normal = mesh.faces[*fid].normal();
            if avg_z > 80.0 {
                // 북극 근처 — normal.z > 0 이어야 outward
                assert!(normal.z > 0.0,
                    "north cap face {:?} normal.z={} (expect >0)", fid, normal.z);
                pole_n_count += 1;
            } else if avg_z < -80.0 {
                // 남극 근처 — normal.z < 0 이어야 outward
                assert!(normal.z < 0.0,
                    "south cap face {:?} normal.z={} (expect <0)", fid, normal.z);
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

    // ────────────────────────────────────────────────────────────────────
    // ADR-103-β-1 — Z-up coordinate migration regression suite
    //
    // Industry CAD parity (SketchUp / Fusion / SolidWorks): X=right,
    // Y=depth (forward), Z=up. The 5 primitive constructors now place
    // their "up" axis along +Z. These tests pin that decision.
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn adr103_beta1_cylinder_axis_is_z_up() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let height = 50.0;
        let _ = mesh.create_cylinder(DVec3::ZERO, 10.0, height, 12, mat).unwrap();
        // Top ring verts must be at z = height, x/y in radial plane.
        let top_z_count = mesh.verts.iter()
            .filter(|(_, v)| v.is_active()
                && (v.pos().z - height).abs() < 1e-6
                && v.pos().z > height - 1.0)
            .count();
        assert!(top_z_count >= 12,
            "ADR-103-β-1: cylinder top ring must be on +Z plane (height={}), \
             found {} verts there", height, top_z_count);
    }

    #[test]
    fn adr103_beta1_cone_apex_on_positive_z() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let height = 60.0;
        let _ = mesh.create_cone(DVec3::ZERO, 30.0, height, 12, mat).unwrap();
        // Apex single vertex at (0, 0, height).
        let apex_z = mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos().z) } else { None })
            .fold(f64::NEG_INFINITY, f64::max);
        assert!((apex_z - height).abs() < 1e-6,
            "ADR-103-β-1: cone apex must be on +Z (expected z={}, got max z={})",
            height, apex_z);
    }

    #[test]
    fn adr103_beta1_box_top_face_normal_is_plus_z() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_box(DVec3::ZERO, 10.0, 10.0, 10.0, mat).unwrap();
        // Face order: [Bottom, Top, Front, Back, Right, Left].
        let top_normal = mesh.faces[faces[1]].normal();
        assert!((top_normal - DVec3::Z).length() < 1e-6,
            "ADR-103-β-1: box top face (index 1) must have +Z outward normal, \
             got {:?}", top_normal);
        let bottom_normal = mesh.faces[faces[0]].normal();
        assert!((bottom_normal - (-DVec3::Z)).length() < 1e-6,
            "ADR-103-β-1: box bottom face (index 0) must have -Z outward normal, \
             got {:?}", bottom_normal);
    }

    #[test]
    fn adr103_beta1_box_height_param_extends_along_z() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // width=2, height=20 (large), depth=4 → Z-extent must be 20, Y-extent 4.
        let _ = mesh.create_box(DVec3::ZERO, 2.0, 20.0, 4.0, mat).unwrap();
        let mut max_z = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for (_, v) in mesh.verts.iter().filter(|(_, vt)| vt.is_active()) {
            max_z = max_z.max(v.pos().z);
            max_y = max_y.max(v.pos().y);
        }
        assert!((max_z - 10.0).abs() < 1e-6,
            "ADR-103-β-1: box `height` param must extend along Z (expected \
             max z = 10, got {})", max_z);
        assert!((max_y - 2.0).abs() < 1e-6,
            "ADR-103-β-1: box `depth` param must extend along Y (expected \
             max y = 2, got {})", max_y);
    }

    #[test]
    fn adr103_beta1_sphere_north_pole_on_positive_z() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let radius = 30.0;
        let _ = mesh.create_sphere(DVec3::ZERO, radius, 12, 8, mat).unwrap();
        // North pole = single vertex at (0, 0, +radius).
        let n_pole_z = mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos().z) } else { None })
            .fold(f64::NEG_INFINITY, f64::max);
        assert!((n_pole_z - radius).abs() < 1e-6,
            "ADR-103-β-1: sphere north pole must be on +Z (expected z={}, \
             got max z={})", radius, n_pole_z);
        let s_pole_z = mesh.verts.iter()
            .filter_map(|(_, v)| if v.is_active() { Some(v.pos().z) } else { None })
            .fold(f64::INFINITY, f64::min);
        assert!((s_pole_z + radius).abs() < 1e-6,
            "ADR-103-β-1: sphere south pole must be on -Z (expected z={}, \
             got min z={})", -radius, s_pole_z);
    }

    #[test]
    fn adr103_beta1_cylinder_surface_axis_dir_is_plus_z() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let faces = mesh.create_cylinder(DVec3::ZERO, 5.0, 20.0, 12, mat).unwrap();
        // Side face (faces[2..]): AnalyticSurface::Cylinder.axis_dir = +Z.
        let side_face = faces[2];
        let surf = mesh.face_surface(side_face).expect("cylinder side surface");
        if let AnalyticSurface::Cylinder { axis_dir, .. } = surf {
            assert!((*axis_dir - DVec3::Z).length() < 1e-6,
                "ADR-103-β-1: cylinder analytic axis_dir must be +Z, got {:?}",
                axis_dir);
        } else {
            panic!("expected Cylinder surface, got {:?}", surf);
        }
    }

    #[test]
    fn adr103_beta1_all_primitives_invariants_pass() {
        // 사용자 시연 시나리오: 4 primitive 가 Z-up 으로 동시 생성 시 invariants
        // 모두 통과. ADR-007 winding + manifold 정합.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        mesh.create_box(DVec3::new(-100.0, 0.0, 0.0), 20.0, 20.0, 20.0, mat).unwrap();
        mesh.create_cylinder(DVec3::new(-50.0, 0.0, 0.0), 10.0, 30.0, 16, mat).unwrap();
        mesh.create_cone(DVec3::new(0.0, 0.0, 0.0), 12.0, 40.0, 16, mat).unwrap();
        mesh.create_sphere(DVec3::new(50.0, 0.0, 0.0), 15.0, 16, 12, mat).unwrap();
        let report = mesh.verify_face_invariants();
        assert!(report.is_valid(),
            "ADR-103-β-1: 4-primitive Z-up scene must pass all invariants; \
             got: {}", report.summary());
    }

    // ────────────────────────────────────────────────────────────────────
    // ADR-089 A-Γ-β — Path B 트리거 정량화 audit
    // ────────────────────────────────────────────────────────────────────

    /// Helper — measure max chord error of N-segment polygon vs analytic
    /// circle of given radius. Returns max distance from polygon edge
    /// midpoint to the actual circle.
    fn measure_polygon_chord_error(radius: f64, segments: u32) -> f64 {
        // Chord length: c = 2r * sin(π/N)
        // Sagitta (edge midpoint to circle): s = r * (1 - cos(π/N))
        let half_angle = std::f64::consts::PI / (segments as f64);
        radius * (1.0 - half_angle.cos())
    }

    /// Helper — measure polygon perimeter of N-segment regular polygon
    /// vs analytic circle perimeter.
    fn measure_perimeter_deviation(radius: f64, segments: u32) -> (f64, f64, f64) {
        let half_angle = std::f64::consts::PI / (segments as f64);
        let chord = 2.0 * radius * half_angle.sin();
        let polygon_perimeter = chord * (segments as f64);
        let circle_perimeter = 2.0 * std::f64::consts::PI * radius;
        let absolute_diff = (circle_perimeter - polygon_perimeter).abs();
        let relative_diff = absolute_diff / circle_perimeter;
        (polygon_perimeter, circle_perimeter, relative_diff)
    }

    #[test]
    fn adr089_a_gamma_cylinder_chord_error_corpus() {
        // 5 사이즈 × 4 segments = 20 측정 포인트
        // Path A 의 polygonal 강등 정량화 — chord error (sagitta).
        let radii = [10.0, 50.0, 100.0, 500.0, 1000.0];
        let segments = [8, 16, 32, 64];
        let mut measurements = Vec::new();
        for &r in &radii {
            for &n in &segments {
                let chord_err = measure_polygon_chord_error(r, n);
                let chord_err_mm = chord_err; // already mm
                let chord_err_pct = (chord_err / r) * 100.0;
                measurements.push((r, n, chord_err_mm, chord_err_pct));
            }
        }
        // Verify expected ordering: smaller segments → larger error.
        // For r=100, segments 8: chord error ≈ 7.6mm. 64: ≈ 0.12mm.
        let r100_n8 = measure_polygon_chord_error(100.0, 8);
        let r100_n64 = measure_polygon_chord_error(100.0, 64);
        assert!(r100_n8 > r100_n64);
        assert!((r100_n8 - 7.6).abs() < 0.5,
            "r=100 N=8 chord error ~7.6mm, got {:.3}", r100_n8);
        assert!((r100_n64 - 0.12).abs() < 0.05,
            "r=100 N=64 chord error ~0.12mm, got {:.3}", r100_n64);
        // Print to stdout for audit report (cargo test -- --nocapture).
        // Format: r=N segments → chord err (mm, %)
        for (r, n, err_mm, err_pct) in &measurements {
            // Use eprintln to ensure visible (test stdout sometimes captured)
            // Note: this is data collection, not assertion — stays for audit
            let _ = (r, n, err_mm, err_pct); // silence unused warning if no print
        }
    }

    #[test]
    fn adr089_a_gamma_cylinder_perimeter_deviation_corpus() {
        // Cylinder top circle perimeter Path A vs analytic.
        let radii = [10.0, 100.0, 1000.0];
        let segments = [8, 16, 32, 64];
        for &r in &radii {
            for &n in &segments {
                let (poly_p, circ_p, rel_diff) = measure_perimeter_deviation(r, n);
                // Path A polygon perimeter is always less than analytic circle
                assert!(poly_p < circ_p);
                // Relative diff decreases with N, independent of r
                if n == 64 {
                    assert!(rel_diff < 0.001,
                        "N=64 should give <0.1% perimeter error, got {:.5}", rel_diff);
                }
            }
        }
    }

    #[test]
    fn adr089_a_gamma_cylinder_path_a_memory_footprint() {
        // Path A cylinder memory footprint per segment count.
        // 8/16/32/64 segments × radius 100mm × height 200mm.
        let mat = MaterialId::new(0);
        let segments_corpus = [8u32, 16, 32, 64];
        let mut measurements = Vec::new();
        for &n in &segments_corpus {
            let mut mesh = Mesh::new();
            mesh.create_cylinder(DVec3::ZERO, 100.0, 200.0, n, mat).unwrap();
            let active_faces = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
            let active_edges = mesh.edges.iter().filter(|(_, e)| e.is_active()).count();
            let active_verts = mesh.verts.iter().filter(|(_, v)| v.is_active()).count();
            measurements.push((n, active_faces, active_edges, active_verts));
        }
        // Verify Path A topology scales with N:
        //   faces = 2 caps + N side = N + 2 (using fan caps in current primitive)
        //   verts = 2N + 2 fan_centers (or ≈ 2N)
        for (n, f, e, v) in &measurements {
            let n = *n as usize;
            // Path A faces: at minimum 2 + N (caps + sides), often more with fan
            assert!(*f >= n + 2, "N={} faces={} expected >= N+2", n, f);
            // Verts at minimum: 2N (top + bottom rings)
            assert!(*v >= 2 * n, "N={} verts={} expected >= 2N", n, v);
        }
        // Path B theoretical (산업 CAD parity): 3 faces / 2 edges / 2 verts
        // for ANY N. Memory savings = (Path A) / 3
        let path_b_faces = 3;
        let path_b_edges = 2;
        let path_b_verts = 2;
        // For N=64, Path A vs Path B savings:
        let (n64, f64_, e64, v64) = measurements.last().unwrap();
        let face_ratio = (*f64_ as f64) / (path_b_faces as f64);
        let edge_ratio = (*e64 as f64) / (path_b_edges as f64);
        let vert_ratio = (*v64 as f64) / (path_b_verts as f64);
        // For N=64, Path A face count ≈ 66, edges ≈ 192, verts ≈ 130
        // Path B: 3/2/2 → ratio 22x face, 96x edge, 65x vert
        assert!(face_ratio > 10.0,
            "N=64 face ratio {} expected >10x (Path A:Path B)", face_ratio);
        assert!(edge_ratio > 50.0,
            "N=64 edge ratio {} expected >50x", edge_ratio);
        assert!(vert_ratio > 30.0,
            "N=64 vert ratio {} expected >30x", vert_ratio);
        let _ = (n64, f64_, e64, v64); // for audit doc
    }

    #[test]
    fn adr089_a_gamma_cylinder_per_segment_face_count() {
        // Path A 의 N-segment cylinder face count 정확 측정.
        let mat = MaterialId::new(0);
        let mut mesh = Mesh::new();
        let faces = mesh.create_cylinder(DVec3::ZERO, 100.0, 200.0, 16, mat).unwrap();
        // Path A primitive 의 face 수 = 16 side + 2 caps (fan-fragmented?)
        // 정확한 face count 는 primitive 구현에 의존 — 회귀 보호용 baseline
        assert!(faces.len() >= 16,
            "16-segment cylinder must have at least 16 side faces, got {}",
            faces.len());
    }

    #[test]
    fn adr089_a_gamma_path_b_savings_table() {
        // Path A vs Path B theoretical memory savings (산업 CAD parity).
        // 전체 audit 결과의 핵심 table — N 별 절감률.
        let segments_corpus = [8u32, 16, 32, 64, 128];
        for &n in &segments_corpus {
            let path_a_faces = (n + 2) as usize; // approximately
            let path_b_faces = 3;
            let savings_pct = ((path_a_faces - path_b_faces) as f64
                / path_a_faces as f64) * 100.0;
            // For N >= 8, savings >= 50%
            if n >= 8 {
                assert!(savings_pct > 50.0,
                    "N={} savings {} expected >50%", n, savings_pct);
            }
            // For N=64, savings ~95%
            if n == 64 {
                assert!(savings_pct > 90.0,
                    "N=64 savings {} expected >90%", savings_pct);
            }
        }
    }
}
