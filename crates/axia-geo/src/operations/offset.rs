//! Offset Operation — face 경계를 안쪽/바깥쪽으로 일정 거리만큼 이동.
//!
//! 건축 모델링에서 벽 두께, 창문 틀 등을 만들 때 필수적인 기능.
//! SketchUp의 Offset 도구와 동일한 개념.
//!
//! 알고리즘:
//! 1. face의 외곽 loop vertex를 수집
//! 2. face 법선 평면에서 각 변을 inward/outward로 offset
//! 3. 인접 offset 선분의 교점 → 새 polygon
//! 4. offset face + 원본↔offset 사이 strip face 생성

use glam::DVec3;
use anyhow::{Result, bail};

use crate::mesh::Mesh;
use crate::{FaceId, EdgeId, VertId};

/// Offset 결과
#[derive(Debug)]
pub struct OffsetResult {
    /// 새로 생성된 inner(offset) face
    pub inner_face: FaceId,
    /// 원본↔offset 사이 strip face 목록
    pub strip_faces: Vec<FaceId>,
    /// 원본 face (그대로 유지 — offset 방향에 따라 outer 또는 삭제)
    pub original_face: FaceId,
}

/// Line Offset 결과
#[derive(Debug)]
pub struct OffsetEdgeResult {
    /// 새로 생성된 평행 edge의 두 정점
    pub new_v0: VertId,
    pub new_v1: VertId,
    /// 새 edge ID
    pub new_edge: EdgeId,
}

impl Mesh {
    // ════════════════════════════════════════════════════════════════
    // Line (Edge) Offset
    // ════════════════════════════════════════════════════════════════

    /// edge를 평면 위에서 dist만큼 평행 이동하여 새 edge를 만들고,
    /// 원본 + 새 edge를 연결하여 사각형 face를 생성.
    ///
    /// - `edge_id`: offset할 원본 edge
    /// - `dist`: 오프셋 거리 (양수 = edge 방향 × 법선의 cross 방향, 음수 = 반대)
    /// - `plane_normal`: 참조 평면의 법선 (보통 Y-up = (0,1,0))
    /// - `material`: 생성될 face의 재질
    ///
    /// 결과: 새 edge + 사각형 face
    pub fn offset_edge(
        &mut self,
        edge_id: EdgeId,
        dist: f64,
        plane_normal: DVec3,
    ) -> Result<OffsetEdgeResult> {
        if dist.abs() < 1e-6 {
            bail!("Offset distance too small");
        }

        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;

        if !edge.is_active() {
            bail!("Edge {:?} is not active", edge_id);
        }

        let v0 = edge.v_small();
        let v1 = edge.v_large();
        let p0 = self.vertex_pos(v0)?;
        let p1 = self.vertex_pos(v1)?;

        // offset 방향 계산: edge 방향 × 평면 법선
        let edge_dir = (p1 - p0).normalize();
        let fn_norm = plane_normal.normalize();
        let offset_dir = edge_dir.cross(fn_norm).normalize();

        if offset_dir.length() < 1e-6 {
            bail!("Edge is parallel to plane normal, cannot determine offset direction");
        }

        // 새 정점 생성 (평행 복사만 — 면은 만들지 않음, CAD 스타일)
        let new_p0 = p0 + offset_dir * dist;
        let new_p1 = p1 + offset_dir * dist;
        let new_v0 = self.add_vertex(new_p0);
        let new_v1 = self.add_vertex(new_p1);

        // 새 edge만 생성 (선의 평행 복사)
        let (new_edge, _) = self.add_edge(new_v0, new_v1)?;

        Ok(OffsetEdgeResult {
            new_v0,
            new_v1,
            new_edge,
        })
    }

    /// face_id의 경계를 dist만큼 오프셋.
    /// dist > 0: 안쪽 (inset), dist < 0: 바깥쪽 (outset)
    ///
    /// 결과: 원본 face를 inner face + strip faces로 분할.
    /// 인접 face와의 edge 연결이 보존됨.
    pub fn offset_face(
        &mut self,
        face_id: FaceId,
        dist: f64,
    ) -> Result<OffsetResult> {
        if dist.abs() < 1e-6 {
            bail!("Offset distance too small");
        }

        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;

        if !face.is_active() {
            bail!("Face {:?} is not active", face_id);
        }

        let normal = face.normal();
        let material = face.material();
        let start_he = face.outer().start;

        // 1) 외곽 루프 정점 수집 (CCW 순서)
        let loop_vids = self.collect_loop_verts(start_he)?;
        let n = loop_vids.len();
        if n < 3 {
            bail!("Face has fewer than 3 vertices");
        }

        // 정점 좌표 수집
        let positions: Vec<DVec3> = loop_vids.iter()
            .map(|&vid| self.vertex_pos(vid))
            .collect::<Result<Vec<_>>>()?;

        // 2) 각 변의 inward normal 계산 (face 법선 기준)
        //    edge direction × face normal → inward pointing
        let offset_positions = compute_offset_polygon(&positions, normal, dist)?;

        if offset_positions.len() != n {
            bail!("Offset polygon vertex count mismatch");
        }

        // 3) 원본 face 삭제 — soft remove: face만 제거, half-edge face 참조만 해제
        //    next/prev는 보존하여 인접 face의 topology가 깨지지 않도록 함
        self.soft_remove_face(face_id)?;

        // 4) offset polygon의 정점 생성
        let offset_vids: Vec<_> = offset_positions.iter()
            .map(|&pos| self.add_vertex(pos))
            .collect();

        // 5) offset face 생성 (동일 winding)
        let inner_face = self.add_face(&offset_vids, material)?;

        // 6) strip faces 생성 (원본 → offset 사이 quad strip)
        //    원본 vertex 재사용 (아직 storage에 남아있음)
        let mut strip_faces = Vec::with_capacity(n);
        for i in 0..n {
            let j = (i + 1) % n;

            // Inset과 Outset에서 strip quad의 winding 방향이 다름.
            // Inset: offset 정점이 안쪽 → [orig, offset, offset_next, orig_next] = CCW
            // Outset: offset 정점이 바깥 → [orig, orig_next, offset_next, offset] = CCW
            let quad_verts = if dist > 0.0 {
                [loop_vids[i], offset_vids[i], offset_vids[j], loop_vids[j]]
            } else {
                [loop_vids[i], loop_vids[j], offset_vids[j], offset_vids[i]]
            };
            let strip_fid = self.add_face(&quad_verts, material)?;
            strip_faces.push(strip_fid);
        }

        Ok(OffsetResult {
            inner_face,
            strip_faces,
            original_face: face_id,
        })
    }

    /// Face만 storage에서 제거하되, half-edge의 face 참조만 NULL로 설정.
    /// next/prev/radial 연결은 보존하여 인접 face topology가 깨지지 않음.
    /// add_face가 find_halfedge에서 face==NULL인 free HE를 찾아 재사용할 수 있게 함.
    fn soft_remove_face(&mut self, face_id: FaceId) -> Result<()> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found for soft removal", face_id);
        }

        // Outer loop: face 참조만 해제 (next/prev 보존)
        let outer_start = self.faces[face_id].outer().start;
        if !outer_start.is_null() {
            if let Ok(hes) = self.collect_loop_hes(outer_start) {
                for he_id in hes {
                    if let Some(he) = self.hes.get_mut(he_id) {
                        he.set_face(FaceId::NULL);
                        // next/prev는 보존! (인접 face에서 edge를 통해 참조할 수 있음)
                    }
                }
            }
        }

        // Inner loops (holes)
        let inners: Vec<_> = self.faces[face_id].inners().to_vec();
        for inner_ref in inners {
            if !inner_ref.start.is_null() {
                if let Ok(hes) = self.collect_loop_hes(inner_ref.start) {
                    for he_id in hes {
                        if let Some(he) = self.hes.get_mut(he_id) {
                            he.set_face(FaceId::NULL);
                        }
                    }
                }
            }
        }

        // Face storage에서 제거
        self.faces.remove(face_id);
        Ok(())
    }
}

/// 2D(평면 투영) 오프셋 폴리곤 계산.
///
/// 각 변을 face 법선 기준으로 inward 방향으로 dist만큼 이동하고,
/// 인접 이동 선분의 교점을 구함.
fn compute_offset_polygon(
    positions: &[DVec3],
    face_normal: DVec3,
    dist: f64,
) -> Result<Vec<DVec3>> {
    let n = positions.len();
    if n < 3 {
        bail!("Need at least 3 positions");
    }

    let fn_norm = face_normal.normalize();

    // 각 변에 대한 offset 선분 (이동된 직선)
    // edge[i]: positions[i] → positions[(i+1)%n]
    // inward normal: edge_dir × face_normal (normalized)
    struct OffsetLine {
        point: DVec3,   // offset 된 직선 위의 한 점
        dir: DVec3,     // 직선 방향 (= 원본 edge 방향)
    }

    let mut offset_lines: Vec<OffsetLine> = Vec::with_capacity(n);

    for i in 0..n {
        let j = (i + 1) % n;
        let edge_dir = (positions[j] - positions[i]).normalize();

        // inward normal: edge × face_normal
        // dist > 0 → inset (안쪽), dist < 0 → outset (바깥쪽)
        let inward = edge_dir.cross(fn_norm).normalize();

        // offset point: 원본 edge를 inward 방향으로 dist만큼 이동
        let offset_pt = positions[i] + inward * dist;

        offset_lines.push(OffsetLine {
            point: offset_pt,
            dir: edge_dir,
        });
    }

    // 인접 offset 직선의 교점 구하기
    // line[i]와 line[(i+n-1)%n]의 교점 → offset_positions[i]
    let mut result = Vec::with_capacity(n);

    for i in 0..n {
        let prev = (i + n - 1) % n;

        let p1 = offset_lines[prev].point;
        let d1 = offset_lines[prev].dir;
        let p2 = offset_lines[i].point;
        let d2 = offset_lines[i].dir;

        // 3D에서 두 직선의 교점 (같은 평면 위에 있으므로)
        // p1 + t*d1 = p2 + s*d2
        // → (p2 - p1) = t*d1 - s*d2
        // 외적 방법: t = ((p2-p1) × d2) · (d1 × d2) / |d1 × d2|²
        let cross_d = d1.cross(d2);
        let denom = cross_d.length_squared();

        if denom < 1e-12 {
            // 평행한 변 → 원본 offset point 사용
            result.push(offset_lines[i].point);
        } else {
            let dp = p2 - p1;
            let t = dp.cross(d2).dot(cross_d) / denom;
            let intersection = p1 + d1 * t;
            result.push(intersection);
        }
    }

    Ok(result)
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;

    fn make_square_face(mesh: &mut Mesh, size: f64) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(size, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(size, 0.0, size));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, size));
        mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap()
    }

    #[test]
    fn test_offset_inset() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        let faces_before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_before, 1);

        let result = mesh.offset_face(fid, 100.0).unwrap();

        // inner face + 4 strip faces = 5 총 면
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 5); // 1 inner + 4 strips

        // strip faces 수 검증
        assert_eq!(result.strip_faces.len(), 4);

        // inner face가 존재하는지
        assert!(mesh.faces.get(result.inner_face).is_some());
    }

    #[test]
    fn test_offset_outset() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        let result = mesh.offset_face(fid, -100.0).unwrap();

        // 동일 구조: inner face + 4 strip
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 5);
        assert_eq!(result.strip_faces.len(), 4);
    }

    #[test]
    fn test_offset_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(500.0, 0.0, 866.0));
        let fid = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let result = mesh.offset_face(fid, 50.0).unwrap();

        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 4); // 1 inner + 3 strips
        assert_eq!(result.strip_faces.len(), 3);
    }

    #[test]
    fn test_offset_zero_distance() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        // 거리 0은 에러
        assert!(mesh.offset_face(fid, 0.0).is_err());
    }

    #[test]
    fn test_offset_polygon_geometry() {
        // 1000x1000 정사각형을 100 inset → 내부 800x800
        let positions = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 1000.0),
            DVec3::new(0.0, 0.0, 1000.0),
        ];
        let normal = DVec3::new(0.0, 1.0, 0.0);

        let result = compute_offset_polygon(&positions, normal, 100.0).unwrap();
        assert_eq!(result.len(), 4);

        // 각 꼭짓점이 100만큼 안으로 이동했는지 확인
        let eps = 1.0;
        assert!((result[0].x - 100.0).abs() < eps, "got {}", result[0].x);
        assert!((result[0].z - 100.0).abs() < eps, "got {}", result[0].z);
        assert!((result[1].x - 900.0).abs() < eps, "got {}", result[1].x);
        assert!((result[1].z - 100.0).abs() < eps, "got {}", result[1].z);
        assert!((result[2].x - 900.0).abs() < eps, "got {}", result[2].x);
        assert!((result[2].z - 900.0).abs() < eps, "got {}", result[2].z);
        assert!((result[3].x - 100.0).abs() < eps, "got {}", result[3].x);
        assert!((result[3].z - 900.0).abs() < eps, "got {}", result[3].z);
    }

    #[test]
    fn test_offset_on_box_top() {
        // 박스 생성 후 top face에 offset → side wall과 분리되지 않아야 함
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);

        // Ground rect
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let base = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        // Push/Pull → box
        let pp = mesh.push_pull(base, 500.0, mat).unwrap();
        let face_count_after_pp = mesh.face_count();
        assert_eq!(face_count_after_pp, 6); // closed box

        // Offset top face
        let _result = mesh.offset_face(pp.top_face, 100.0).unwrap();

        // box 6면 - top(삭제) + inner + 4 strips = 10면
        let face_count_after_offset = mesh.face_count();
        assert_eq!(face_count_after_offset, 10); // 5 original sides + 1 inner + 4 strips

        // 모든 face가 렌더링 가능한지 (export_buffers가 크래시하지 않는지)
        let buffers = mesh.export_buffers();
        assert!(buffers.is_ok());
    }

    // ════════════════════════════════════════════════════════════════
    // Line (Edge) Offset Tests
    // ════════════════════════════════════════════════════════════════

    #[test]
    fn test_offset_edge_basic() {
        let mut mesh = Mesh::new();

        // X축 위의 선분: (0,0,0) → (1000,0,0)
        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        assert_eq!(mesh.edge_count(), 1);
        assert_eq!(mesh.face_count(), 0);

        // Y-up 평면에서 평행 복사
        let result = mesh.offset_edge(edge_id, 100.0, DVec3::Y).unwrap();

        // 면은 만들지 않음 (선만 복사)
        assert_eq!(mesh.face_count(), 0);
        // edge 2개 (원본 + 복사)
        assert_eq!(mesh.edge_count(), 2);

        // 새 정점 위치 확인
        let new_p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let new_p1 = mesh.vertex_pos(result.new_v1).unwrap();

        assert!((new_p0.y).abs() < 1.0, "Y should stay on plane, got {}", new_p0.y);
        assert!((new_p1.y).abs() < 1.0, "Y should stay on plane, got {}", new_p1.y);

        let dist_0 = (new_p0 - DVec3::new(0.0, 0.0, 0.0)).length();
        let dist_1 = (new_p1 - DVec3::new(1000.0, 0.0, 0.0)).length();
        assert!((dist_0 - 100.0).abs() < 1.0, "Offset distance should be ~100, got {}", dist_0);
        assert!((dist_1 - 100.0).abs() < 1.0, "Offset distance should be ~100, got {}", dist_1);
    }

    #[test]
    fn test_offset_edge_negative() {
        let mut mesh = Mesh::new();

        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        // 반대 방향 offset — 면 없이 선만
        let _result = mesh.offset_edge(edge_id, -100.0, DVec3::Y).unwrap();
        assert_eq!(mesh.face_count(), 0);
        assert_eq!(mesh.edge_count(), 2);
    }

    #[test]
    fn test_offset_edge_zero_distance() {
        let mut mesh = Mesh::new();

        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::ZERO,
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        // 거리 0 → 에러
        assert!(mesh.offset_edge(edge_id, 0.0, DVec3::Y).is_err());
    }
}
