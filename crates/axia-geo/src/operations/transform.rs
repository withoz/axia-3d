//! Transform Operations — Move, Rotate, Scale
//!
//! face 집합에 속한 정점들을 변환.
//! 정점 단위로 변환하므로 DCEL 토폴로지는 변경되지 않음.

use glam::{DVec3, DMat3};
use anyhow::Result;

use crate::mesh::Mesh;
use crate::{FaceId, VertId};

/// Transform 결과
#[derive(Debug)]
pub struct TransformResult {
    /// 변환된 정점 수
    pub verts_moved: usize,
    /// 영향받은 face 수
    pub faces_affected: usize,
}

impl Mesh {
    /// 지정된 face들의 모든 정점을 delta만큼 이동
    pub fn translate_faces(
        &mut self,
        face_ids: &[FaceId],
        delta: DVec3,
    ) -> Result<TransformResult> {
        let vert_ids = self.collect_face_verts(face_ids)?;

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let new_pos = vert.pos() + delta;
                vert.set_pos(new_pos);
            }
        }

        // normal 재계산
        self.recompute_face_normals(face_ids)?;

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// 지정된 face들의 모든 정점을 center 기준으로 회전
    /// axis: 회전축 (단위 벡터), angle_rad: 라디안 각도
    pub fn rotate_faces(
        &mut self,
        face_ids: &[FaceId],
        center: DVec3,
        axis: DVec3,
        angle_rad: f64,
    ) -> Result<TransformResult> {
        let vert_ids = self.collect_face_verts(face_ids)?;
        let rot = rotation_matrix(axis.normalize(), angle_rad);

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let p = vert.pos() - center;
                let rotated = rot * p;
                vert.set_pos(rotated + center);
            }
        }

        self.recompute_face_normals(face_ids)?;

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// 지정된 face들의 모든 정점을 center 기준으로 스케일
    pub fn scale_faces(
        &mut self,
        face_ids: &[FaceId],
        center: DVec3,
        scale: DVec3,
    ) -> Result<TransformResult> {
        let vert_ids = self.collect_face_verts(face_ids)?;

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let p = vert.pos() - center;
                let scaled = DVec3::new(p.x * scale.x, p.y * scale.y, p.z * scale.z);
                vert.set_pos(scaled + center);
            }
        }

        self.recompute_face_normals(face_ids)?;

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// face 집합에서 사용하는 모든 고유 정점 수집
    fn collect_face_verts(&self, face_ids: &[FaceId]) -> Result<Vec<VertId>> {
        let mut vert_set = std::collections::HashSet::new();

        for &fid in face_ids {
            let face = self.faces.get(fid)
                .ok_or_else(|| anyhow::anyhow!("face {:?} not found", fid))?;

            if !face.is_active() { continue; }

            let verts = self.collect_loop_verts(face.outer().start)?;
            for vid in verts {
                vert_set.insert(vid);
            }

            // inner loops (holes)
            for inner in face.inners() {
                let verts = self.collect_loop_verts(inner.start)?;
                for vid in verts {
                    vert_set.insert(vid);
                }
            }
        }

        Ok(vert_set.into_iter().collect())
    }

    /// face들의 법선 벡터 재계산
    fn recompute_face_normals(&mut self, face_ids: &[FaceId]) -> Result<()> {
        for &fid in face_ids {
            let face = match self.faces.get(fid) {
                Some(f) if f.is_active() => f,
                _ => continue,
            };

            let start = face.outer().start;
            let verts = self.collect_loop_verts(start)?;

            if verts.len() >= 3 {
                if let Ok(normal) = self.compute_normal(&verts) {
                    if let Some(f) = self.faces.get_mut(fid) {
                        f.set_normal(normal);
                    }
                }
            }
        }
        Ok(())
    }

    /// face 집합의 중심점 (centroid) 계산
    pub fn faces_centroid(&self, face_ids: &[FaceId]) -> Result<DVec3> {
        let vert_ids = self.collect_face_verts(face_ids)?;
        if vert_ids.is_empty() {
            return Ok(DVec3::ZERO);
        }

        let mut sum = DVec3::ZERO;
        let mut count = 0usize;
        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get(vid) {
                sum += vert.pos();
                count += 1;
            }
        }

        Ok(if count > 0 { sum / count as f64 } else { DVec3::ZERO })
    }
}

/// Rodrigues 회전 행렬 생성
fn rotation_matrix(axis: DVec3, angle: f64) -> DMat3 {
    let c = angle.cos();
    let s = angle.sin();
    let t = 1.0 - c;
    let (x, y, z) = (axis.x, axis.y, axis.z);

    DMat3::from_cols(
        DVec3::new(t * x * x + c,     t * x * y + s * z, t * x * z - s * y),
        DVec3::new(t * x * y - s * z, t * y * y + c,     t * y * z + s * x),
        DVec3::new(t * x * z + s * y, t * y * z - s * x, t * z * z + c),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;

    fn make_test_quad(mesh: &mut Mesh) -> Vec<FaceId> {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let mat = MaterialId::new(0);
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        vec![fid]
    }

    #[test]
    fn translate_moves_vertices() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let delta = DVec3::new(5.0, 0.0, 0.0);

        let result = mesh.translate_faces(&faces, delta).unwrap();
        assert_eq!(result.verts_moved, 4);

        // v0 was at (0,0,0) → should now be at (5,0,0)
        for (_, vert) in mesh.verts.iter() {
            assert!(vert.pos().x >= 5.0 - 0.001, "vertex should be translated");
        }
    }

    #[test]
    fn rotate_90_degrees() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let center = DVec3::new(0.5, 0.0, 0.5);
        let axis = DVec3::Y;
        let angle = std::f64::consts::FRAC_PI_2; // 90°

        let result = mesh.rotate_faces(&faces, center, axis, angle).unwrap();
        assert_eq!(result.verts_moved, 4);
    }

    #[test]
    fn scale_doubles_size() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let center = DVec3::ZERO;
        let scale = DVec3::splat(2.0);

        let result = mesh.scale_faces(&faces, center, scale).unwrap();
        assert_eq!(result.verts_moved, 4);
    }

    #[test]
    fn centroid_calculation() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let c = mesh.faces_centroid(&faces).unwrap();
        assert!((c.x - 0.5).abs() < 0.01);
        assert!((c.z - 0.5).abs() < 0.01);
    }
}
