//! Auto-intersect on draw.
//!
//! 새로 추가된 face 와 기존 coplanar face 사이의 교차 관계를 자동으로
//! topology 에 반영한다. MVP 스코프:
//!
//!   - **Containment**: A 가 B 를 완전히 포함 → A 를 "outer + B 를 hole"
//!     구조로 재구성. (이 한 경우만으로도 "벽에 창 그리기" 류 z-fighting
//!     해소)
//!   - 부분 겹침 / 관통: 현 Phase 는 no-op (후속 Phase polygon clip)
//!
//! 모든 비평면 / 비교차 페어는 무시. 공차는 `COPLANAR_TOL_MM` (= 1e-3 mm).

use anyhow::Result;
use glam::DVec3;

use crate::entities::id::*;
use crate::mesh::Mesh;
use crate::operations::boolean_geo::{
    point_in_polygon_2d, project_to_2d, Plane,
};

/// Coplanar 판정 tolerance.
const COPLANAR_DOT_TOL: f64 = 1e-6;  // 1 − cos(θ) < tol → 평행
const COPLANAR_DIST_TOL: f64 = 1e-3; // mm

impl Mesh {
    /// `new_face` 와 기존 active face 들의 **coplanar containment** 관계를
    /// 감지해 hole 주입으로 topology 를 정리.
    ///
    /// 반환: 변경된 face id 리스트 (renderer rebuild 용 dirty marker).
    ///
    /// **비교차 / 부분 겹침 / 비평면** 케이스는 본 MVP 범위 밖이며 무시된다.
    pub fn auto_intersect_face(&mut self, new_face: FaceId) -> Result<Vec<FaceId>> {
        // 1. 대상 face 검증 + 평면 / 정점 수집
        let new_plane = match self.face_plane(new_face)? {
            Some(p) => p,
            None => return Ok(Vec::new()),
        };
        let new_loop = self.face_outer_verts(new_face)?;
        if new_loop.len() < 3 {
            return Ok(Vec::new());
        }
        let new_pts_3d: Vec<DVec3> = new_loop
            .iter()
            .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
            .collect();

        // 2. 비교 대상 — active 한 다른 face id 스냅샷
        let other_ids: Vec<FaceId> = self
            .faces
            .iter()
            .filter_map(|(id, f)| {
                if id == new_face {
                    None
                } else if f.is_active() {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        let mut changed: Vec<FaceId> = Vec::new();

        for other in other_ids {
            let other_plane = match self.face_plane(other)? {
                Some(p) => p,
                None => continue,
            };
            if !planes_coplanar(&new_plane, &other_plane) {
                continue;
            }
            let other_loop = match self.face_outer_verts(other) {
                Ok(v) if v.len() >= 3 => v,
                _ => continue,
            };
            let other_pts_3d: Vec<DVec3> = other_loop
                .iter()
                .map(|&v| self.vertex_pos(v).unwrap_or(DVec3::ZERO))
                .collect();

            // 공통 평면 normal 로 2D 투영
            let (new_pts_2d, u_ax, v_ax, origin) =
                project_to_2d(&new_pts_3d, new_plane.normal);
            let other_pts_2d: Vec<_> = other_pts_3d
                .iter()
                .map(|p| {
                    let rel = *p - origin;
                    crate::operations::boolean_geo::Pt2::new(
                        rel.dot(u_ax),
                        rel.dot(v_ax),
                    )
                })
                .collect();

            // containment 판정
            let all_new_in_other = new_pts_2d
                .iter()
                .all(|p| point_in_polygon_2d(p, &other_pts_2d));
            let all_other_in_new = other_pts_2d
                .iter()
                .all(|p| point_in_polygon_2d(p, &new_pts_2d));

            if all_new_in_other && !all_other_in_new {
                let new_face_ids = self.inject_hole(other, &other_loop, &new_loop)?;
                changed.extend(new_face_ids);
            } else if all_other_in_new && !all_new_in_other {
                let new_face_ids = self.inject_hole(new_face, &new_loop, &other_loop)?;
                changed.extend(new_face_ids);
            }
        }

        Ok(changed)
    }

    /// face_id 의 outer loop 정점 + material 유지, `hole_loop` 을 hole 로
    /// 갖는 새 face 로 교체. 기존 face_id 는 invalidate.
    fn inject_hole(
        &mut self,
        face_id: FaceId,
        outer_loop: &[VertId],
        hole_loop: &[VertId],
    ) -> Result<Vec<FaceId>> {
        let material = self
            .faces
            .get(face_id)
            .map(|f| f.material())
            .ok_or_else(|| anyhow::anyhow!("inject_hole: face_id {face_id:?} 없음"))?;
        let hole_reversed: Vec<VertId> = hole_loop.iter().rev().copied().collect();
        self.remove_face(face_id)?;
        let new_id = self.add_face_with_holes(outer_loop, &[&hole_reversed[..]], material)?;
        Ok(vec![new_id])
    }

    fn face_plane(&self, face_id: FaceId) -> Result<Option<Plane>> {
        let face = match self.faces.get(face_id) {
            Some(f) if f.is_active() => f,
            _ => return Ok(None),
        };
        let loop_verts = self.collect_loop_verts(face.outer().start)?;
        if loop_verts.len() < 3 {
            return Ok(None);
        }
        let p = self.vertex_pos(loop_verts[0])?;
        let n = face.normal();
        if !n.length().is_finite() || n.length() < 1e-12 {
            return Ok(None);
        }
        Ok(Some(Plane::from_point_normal(p, n)))
    }

    fn face_outer_verts(&self, face_id: FaceId) -> Result<Vec<VertId>> {
        let face = self
            .faces
            .get(face_id)
            .ok_or_else(|| anyhow::anyhow!("face_outer_verts: {face_id:?} 없음"))?;
        self.collect_loop_verts(face.outer().start)
    }
}

fn planes_coplanar(a: &Plane, b: &Plane) -> bool {
    let dot = a.normal.dot(b.normal);
    if (dot.abs() - 1.0).abs() > COPLANAR_DOT_TOL {
        return false;
    }
    let p_on_b = b.normal * b.dist;
    a.signed_distance(p_on_b).abs() < COPLANAR_DIST_TOL
}


#[cfg(test)]
mod tests {
    use super::*;

    fn default_mat() -> MaterialId {
        MaterialId::new(0)
    }

    #[test]
    fn disjoint_rects_no_changes() {
        let mut mesh = Mesh::new();
        let (f1, _) = mesh
            .draw_rectangle(
                DVec3::new(-10.0, 0.0, 0.0),
                DVec3::Y,
                DVec3::Z,
                2.0, 2.0,
                default_mat(),
            ).unwrap();
        let (f2, _) = mesh
            .draw_rectangle(
                DVec3::new(10.0, 0.0, 0.0),
                DVec3::Y,
                DVec3::Z,
                2.0, 2.0,
                default_mat(),
            ).unwrap();
        let changed = mesh.auto_intersect_face(f2).unwrap();
        assert!(changed.is_empty());
        assert!(mesh.faces.get(f1).is_some() && mesh.faces[f1].is_active());
        assert!(mesh.faces.get(f2).is_some() && mesh.faces[f2].is_active());
    }

    #[test]
    fn new_face_contained_in_existing_creates_hole() {
        let mut mesh = Mesh::new();
        let (big, _) = mesh
            .draw_rectangle(DVec3::ZERO, DVec3::Y, DVec3::Z, 10.0, 10.0, default_mat())
            .unwrap();
        let (small, _) = mesh
            .draw_rectangle(DVec3::ZERO, DVec3::Y, DVec3::Z, 2.0, 2.0, default_mat())
            .unwrap();
        let changed = mesh.auto_intersect_face(small).unwrap();
        assert!(!changed.is_empty());
        assert!(
            mesh.faces.get(big).is_none() || !mesh.faces[big].is_active(),
            "big 은 invalidate"
        );
        assert!(
            mesh.faces.get(small).is_some() && mesh.faces[small].is_active(),
            "small 은 active 유지"
        );
    }

    #[test]
    fn non_coplanar_faces_no_changes() {
        let mut mesh = Mesh::new();
        let (_f1, _) = mesh
            .draw_rectangle(DVec3::ZERO, DVec3::Z, DVec3::Y, 4.0, 4.0, default_mat())
            .unwrap();
        let (f2, _) = mesh
            .draw_rectangle(DVec3::ZERO, DVec3::X, DVec3::Y, 4.0, 4.0, default_mat())
            .unwrap();
        let changed = mesh.auto_intersect_face(f2).unwrap();
        assert!(changed.is_empty());
    }

    #[test]
    fn partial_overlap_no_changes_in_mvp() {
        let mut mesh = Mesh::new();
        let (_f1, _) = mesh
            .draw_rectangle(DVec3::ZERO, DVec3::Y, DVec3::Z, 4.0, 4.0, default_mat())
            .unwrap();
        let (f2, _) = mesh
            .draw_rectangle(
                DVec3::new(2.0, 0.0, 2.0),
                DVec3::Y, DVec3::Z, 4.0, 4.0, default_mat(),
            ).unwrap();
        let changed = mesh.auto_intersect_face(f2).unwrap();
        assert!(changed.is_empty(), "부분 겹침은 MVP 범위 밖");
    }
}
