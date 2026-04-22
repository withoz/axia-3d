//! Silhouette Projected Shadow — Sun-facing silhouette edges의 ground 투영.
//!
//! ## Phase 2.2 업그레이드 (2026-04-23)
//!
//! 이전 알고리즘 (Phase 1~2.1): "모든 sun-facing face를 각자 projection".
//! 문제:
//!   - Face마다 독립 polygon → 수많은 overlapping triangles
//!   - Overlap 누적 darkening → 그림자 내부가 불균일하게 더 어두움
//!   - Tube 같은 sweep 객체에서 face 사이 간격으로 "segment 끊어짐"
//!
//! 신 알고리즘: silhouette 원칙.
//!
//! ### 1단계: Face 분류
//! 각 active face의 normal · (-sun_dir) 을 계산:
//!   > 0  → sun-facing (빛을 향함)
//!   < 0  → sun-averted (뒷면)
//!
//! ### 2단계: Silhouette edge 추출
//! Edge는 인접 두 face의 sun-facing 상태가 다를 때 silhouette:
//!   - Manifold interior edge: 두 face의 분류가 다르면 silhouette
//!   - Boundary edge (face 1개): 그 face가 sun-facing이면 silhouette
//!
//! 이 edge들이 바로 object의 "실루엣 윤곽"을 이룬다.
//!
//! ### 3단계: Loop grouping
//! Silhouette edge들을 연결된 loop들로 그룹핑. 각 loop는 한 object (또는
//! 한 object의 한 silhouette region)의 외곽 경계.
//!
//! ### 4단계: Ground 투영 + triangulation
//! Loop vertex들을 sun direction으로 y=0 평면에 matrix projection. fan
//! triangulation으로 버퍼 생성.
//!
//! ## 장점
//! - Overlap 제거 → 그림자 내부 균일한 darkness
//! - Tube/sweep: silhouette 따라 연속된 외곽 → segment 끊어짐 없음
//! - Shadow polygon 수 대폭 감소 → GPU 부담 ↓
//!
//! ## 제약 (MVP)
//! - Ground (y=0) 만 receiver (Phase 2.3에서 multi-plane 확장)
//! - Fan tri 사용 → convex silhouette 가정 (concave shape은 slight artifact)
//! - Non-manifold edge (>2 face) 은 안전하게 skip
//! - Multiple disjoint objects의 silhouette은 각자 독립 loop로 처리 ✓

use std::collections::{HashMap, HashSet};
use glam::DVec3;

use crate::entities::*;
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

        // Sun-facing threshold — 0 이면 정확 silhouette이지만 grazing edge
        // 안정성을 위해 epsilon. Polygon normal 정확도(deg_to_rad의 floating
        // error)와 ADR-007 recompute 후 정밀도 여유분을 고려해 ±0.001.
        const SF_EPS: f64 = 0.001;
        const MIN_HEIGHT: f64 = 1.0;

        // ─── 1) Face sun-facing classification ───
        let mut sun_facing: HashMap<FaceId, bool> = HashMap::new();
        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let dot = face.normal().dot(-sun_dir);
            sun_facing.insert(fid, dot > SF_EPS);
        }

        // ─── 2) Silhouette edge 추출 ───
        // Adjacent faces의 sun-facing 상태가 다르면 silhouette.
        let mut silhouette_edges: Vec<EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            let (faces, _) = self.get_faces_sharing_edge(eid);
            let active: Vec<FaceId> = faces.into_iter()
                .filter(|f| sun_facing.contains_key(f))
                .collect();

            let is_silhouette = match active.len() {
                0 => false,           // no adjacent active face
                1 => sun_facing[&active[0]],  // boundary edge: silhouette if lit
                _ => {
                    // Interior: 두 face 중 sun-facing 상태가 다른 경우
                    let first = sun_facing[&active[0]];
                    active.iter().any(|f| sun_facing[f] != first)
                }
            };
            if !is_silhouette { continue; }

            // Edge height filter — 두 endpoint 중 하나라도 ground 위면 포함.
            let a_y = self.vertex_pos(edge.v_small()).map(|p| p.y).unwrap_or(0.0);
            let b_y = self.vertex_pos(edge.v_large()).map(|p| p.y).unwrap_or(0.0);
            if a_y.max(b_y) <= MIN_HEIGHT { continue; }

            silhouette_edges.push(eid);
        }

        if silhouette_edges.is_empty() { return out; }

        // ─── 3) Loop grouping ───
        let loops = self.group_silhouette_loops(&silhouette_edges);

        // ─── 4) Project + triangulate each loop ───
        for loop_verts in loops {
            if loop_verts.len() < 3 { continue; }
            let projected: Vec<(f64, f64)> = loop_verts.iter()
                .filter_map(|&vid| self.vertex_pos(vid).ok())
                .map(|v| {
                    let t = -v.y / sun_dir.y;
                    (v.x + sun_dir.x * t, v.z + sun_dir.z * t)
                })
                .collect();

            if projected.len() < 3 { continue; }

            // Fan triangulation from vertex 0.
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

    /// Silhouette edge들을 연결된 loop로 그룹화.
    /// 각 vertex의 neighbor를 graph로 보고, 방문하지 않은 edge부터 walk해
    /// 닫힌 loop 또는 open chain을 추출. Loop 1개당 vertex sequence 반환.
    ///
    /// Non-manifold 정점(silhouette 그래프에서 degree ≥ 3)은 첫 발견된
    /// unvisited edge를 따라감 — greedy heuristic이지만 대부분의 건축
    /// 실루엣에 충분.
    fn group_silhouette_loops(&self, edges: &[EdgeId]) -> Vec<Vec<VertId>> {
        // Adjacency: VertId → Vec<(other_vert, edge_id)>
        let mut adj: HashMap<VertId, Vec<(VertId, EdgeId)>> = HashMap::new();
        for &eid in edges {
            if let Some(edge) = self.edges.get(eid) {
                let a = edge.v_small();
                let b = edge.v_large();
                adj.entry(a).or_default().push((b, eid));
                adj.entry(b).or_default().push((a, eid));
            }
        }

        let mut visited: HashSet<EdgeId> = HashSet::new();
        let mut loops: Vec<Vec<VertId>> = Vec::new();

        for &seed_edge in edges {
            if visited.contains(&seed_edge) { continue; }
            let seed = match self.edges.get(seed_edge) { Some(e) => e, None => continue };
            let start_vert = seed.v_small();

            let mut loop_verts: Vec<VertId> = Vec::new();
            let mut cur_vert = start_vert;
            let mut cur_edge = seed_edge;

            // Safety guard — 무한루프 방지
            for _ in 0..100_000 {
                visited.insert(cur_edge);
                loop_verts.push(cur_vert);

                // cur_edge의 반대 endpoint 로 이동
                let edge = match self.edges.get(cur_edge) { Some(e) => e, None => break };
                let next_vert = if cur_vert == edge.v_small() { edge.v_large() } else { edge.v_small() };

                if next_vert == start_vert && loop_verts.len() >= 3 {
                    break;  // closed loop
                }

                // next_vert에서 unvisited edge 선택
                let neighbors = match adj.get(&next_vert) {
                    Some(ns) => ns.clone(),
                    None => { loop_verts.push(next_vert); break; }
                };
                let next = neighbors.into_iter()
                    .find(|(_, eid)| !visited.contains(eid));

                match next {
                    Some((_, eid)) => {
                        cur_vert = next_vert;
                        cur_edge = eid;
                    }
                    None => {
                        // dead end — open chain
                        loop_verts.push(next_vert);
                        break;
                    }
                }
            }

            if loop_verts.len() >= 3 {
                loops.push(loop_verts);
            }
        }

        loops
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
