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
use crate::curves::AnalyticCurve;
use crate::surfaces::AnalyticSurface;

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

/// ADR-080 V-β-α — Typed errors for `offset_edge_on_host_face`.
///
/// Categorized so that callers (Bridge / OffsetTool / future MCP surface)
/// can dispatch on the failure mode without string parsing. Variants
/// `UnsupportedHostSurface` and `UnsupportedCurveKind` are explicit
/// "not yet" markers — they signal V-β-β / V-β-γ / W-3 work, not bugs.
#[derive(Debug, thiserror::Error)]
pub enum OffsetEdgeError {
    #[error("offset_edge: edge {0:?} not found")]
    EdgeNotFound(EdgeId),
    #[error("offset_edge: edge {0:?} is inactive")]
    EdgeInactive(EdgeId),
    #[error("offset_edge: distance {0} below epsilon")]
    DegenerateDistance(f64),
    /// No active incident face — free wire. V-δ scope.
    #[error("offset_edge: edge has no incident active face (free wire — V-δ scope)")]
    NoIncidentFace,
    /// 2+ incident faces with conflicting host surfaces.
    #[error("offset_edge: ambiguous host face — {n_faces} candidates with conflicting surfaces")]
    AmbiguousHostFace { n_faces: usize },
    /// Host face has hole loops (ADR-016 Q2 / ADR-080 L8).
    #[error("offset_edge: host face {0:?} has hole loops (multi-loop face rejected)")]
    MultiLoopHostFace(FaceId),
    /// Host surface is not yet supported (Cylinder/Sphere/Cone/Torus → V-β-γ scope).
    #[error("offset_edge: host surface kind {kind} not yet supported (V-β-γ scope)")]
    UnsupportedHostSurface { kind: &'static str },
    /// Curve kind not yet supported in V-β-α (Arc/Circle → V-β-β; Bezier/etc → W-3).
    #[error("offset_edge: curve kind {kind} not yet supported in V-β-α")]
    UnsupportedCurveKind { kind: &'static str },
    /// Edge direction parallel to host normal — perpendicular offset undefined.
    #[error("offset_edge: edge direction parallel to host face normal")]
    EdgeParallelToNormal,
    /// Host face has no analytic surface attached (W-2 / Phase N invariant violated).
    #[error("offset_edge: host face {0:?} has no analytic surface attached")]
    NoHostSurface(FaceId),
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

    /// ADR-080 V-β-α — Edge offset using host face's surface as reference.
    ///
    /// Replaces the legacy `offset_edge(edge, dist, plane_normal)` callers'
    /// need to pass `plane_normal` themselves. The host face is auto-resolved
    /// from the edge's incident faces:
    ///   - 1 active incident face → that face is the host.
    ///   - 2+ incident faces all sharing the same Plane (coplanar within
    ///     EPSILON_LENGTH) → either plane is fine; pick first.
    ///   - 0 → `NoIncidentFace` (V-δ scope).
    ///   - 2+ with conflicting surfaces → `AmbiguousHostFace`.
    ///
    /// Curve kind dispatch (§V2-C):
    ///   - `None` (synthesized line) or `AnalyticCurve::Line` → perpendicular
    ///     offset using face normal × edge_dir (existing semantics, but
    ///     normal source = face surface, not caller).
    ///   - `Arc` / `Circle` / Bezier / B-spline / NURBS → `UnsupportedCurveKind`
    ///     (V-β-β / W-3 scope).
    ///
    /// Host surface scope (§V2-D):
    ///   - Plane → fully supported.
    ///   - Cylinder / Sphere / Cone / Torus → `UnsupportedHostSurface`
    ///     (V-β-γ scope).
    ///   - NURBS-class → `UnsupportedHostSurface` (W-3 scope).
    ///
    /// Multi-loop guard (§V2-H, ADR-016 Q2 / ADR-080 L8):
    ///   - Host face with hole loops → `MultiLoopHostFace`.
    ///
    /// Output (§V2-E): same `OffsetEdgeResult` as legacy `offset_edge`.
    /// Returns the typed `OffsetEdgeError` on failure for caller dispatch.
    pub fn offset_edge_on_host_face(
        &mut self,
        edge_id: EdgeId,
        dist: f64,
    ) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
        if dist.abs() < 1e-6 {
            return Err(OffsetEdgeError::DegenerateDistance(dist));
        }

        let edge = self
            .edges
            .get(edge_id)
            .ok_or(OffsetEdgeError::EdgeNotFound(edge_id))?;
        if !edge.is_active() {
            return Err(OffsetEdgeError::EdgeInactive(edge_id));
        }
        let v0 = edge.v_small();
        let v1 = edge.v_large();
        let edge_curve = edge.curve().cloned();

        // §V2-C — Curve kind dispatch (V-β-α: Line + None only).
        match &edge_curve {
            None | Some(AnalyticCurve::Line { .. }) => {
                // OK — fall through to Line offset path.
            }
            Some(c) => {
                let kind = match c {
                    AnalyticCurve::Arc { .. } => "Arc",
                    AnalyticCurve::Circle { .. } => "Circle",
                    AnalyticCurve::Bezier { .. } => "Bezier",
                    AnalyticCurve::BSpline { .. } => "BSpline",
                    AnalyticCurve::NURBS { .. } => "NURBS",
                    AnalyticCurve::Line { .. } => unreachable!(),
                };
                return Err(OffsetEdgeError::UnsupportedCurveKind { kind });
            }
        }

        // §V2-B — Host face resolution.
        let (incident_faces, _hes) = self.get_faces_sharing_edge(edge_id);
        let host = match incident_faces.len() {
            0 => return Err(OffsetEdgeError::NoIncidentFace),
            1 => incident_faces[0],
            _n => {
                // Pick first; verify all share the same surface kind/instance
                // (within EPSILON_LENGTH for Plane). Else AmbiguousHostFace.
                let first = incident_faces[0];
                let first_surface = self
                    .faces
                    .get(first)
                    .and_then(|f| f.surface().cloned());
                let mut all_match = true;
                for &fid in &incident_faces[1..] {
                    let other = self.faces.get(fid).and_then(|f| f.surface().cloned());
                    if !surfaces_equivalent(&first_surface, &other) {
                        all_match = false;
                        break;
                    }
                }
                if !all_match {
                    return Err(OffsetEdgeError::AmbiguousHostFace {
                        n_faces: incident_faces.len(),
                    });
                }
                first
            }
        };

        // §V2-H — Multi-loop guard.
        let host_face = self
            .faces
            .get(host)
            .ok_or(OffsetEdgeError::EdgeNotFound(edge_id))?;
        if !host_face.inners().is_empty() {
            return Err(OffsetEdgeError::MultiLoopHostFace(host));
        }

        // §V2-D — Host surface dispatch (V-β-α: Plane only).
        let host_surface = host_face
            .surface()
            .cloned()
            .ok_or(OffsetEdgeError::NoHostSurface(host))?;
        let host_normal = match &host_surface {
            AnalyticSurface::Plane { normal, .. } => normal.normalize_or_zero(),
            AnalyticSurface::Cylinder { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Cylinder" });
            }
            AnalyticSurface::Sphere { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Sphere" });
            }
            AnalyticSurface::Cone { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Cone" });
            }
            AnalyticSurface::Torus { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Torus" });
            }
            AnalyticSurface::BezierPatch { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "BezierPatch" });
            }
            AnalyticSurface::BSplineSurface { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "BSplineSurface" });
            }
            AnalyticSurface::NURBSSurface { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "NURBSSurface" });
            }
        };
        if host_normal.length_squared() < 0.5 {
            return Err(OffsetEdgeError::NoHostSurface(host));
        }

        // §V2-C continued — Line perpendicular offset on Plane.
        let p0 = self
            .vertex_pos(v0)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
        let p1 = self
            .vertex_pos(v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
        let edge_vec = p1 - p0;
        if edge_vec.length_squared() < 1e-12 {
            return Err(OffsetEdgeError::DegenerateDistance(0.0));
        }
        let edge_dir = edge_vec.normalize();
        let offset_dir = edge_dir.cross(host_normal);
        if offset_dir.length_squared() < 1e-12 {
            return Err(OffsetEdgeError::EdgeParallelToNormal);
        }
        let offset_dir = offset_dir.normalize();

        let new_p0 = p0 + offset_dir * dist;
        let new_p1 = p1 + offset_dir * dist;
        let new_v0 = self.add_vertex(new_p0);
        let new_v1 = self.add_vertex(new_p1);
        let (new_edge, _) = self
            .add_edge(new_v0, new_v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

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

        // 6) 2026-04-27 — 사용자 요청: "offset 명령시 offset 된 라인과 모서리선이
        //    연결되면 안됨. 모서리 연결선을 지워서 완성".
        //
        //    이전: N 개 strip quad 를 만들어 inset 과 outer boundary 사이를 채움
        //    → 모서리에서 quad 끼리 만나는 corner-connector 엣지가 보임.
        //
        //    새로운 방식: 단일 frame face 를 multi-loop 으로 생성.
        //      outer loop = 원본 boundary
        //      inner hole = offset polygon (winding 반대 — hole 규약)
        //    → corner connector 엣지 없음. inner_face 와 frame 이 함께 원래
        //      면 영역을 덮음.
        //
        //    Inset (dist > 0): hole 은 outer 와 같은 CCW (자동 hole 처리에서
        //      add_face_with_holes 가 내부 winding 을 적절히 정규화).
        //    Outset (dist < 0): outer 가 offset polygon, 원본은 hole. → 두
        //      loop 의 역할이 바뀜.
        let (frame_outer, frame_hole): (Vec<VertId>, Vec<VertId>) = if dist > 0.0 {
            (loop_vids.to_vec(), offset_vids.clone())
        } else {
            (offset_vids.clone(), loop_vids.to_vec())
        };
        let frame_face = self.add_face_with_holes(
            &frame_outer,
            &[&frame_hole],
            material,
        )?;
        // strip_faces 는 이제 frame_face 하나로 대체. 호환성 위해 vec 에 담아 반환.
        let strip_faces = vec![frame_face];

        // ADR-007 — offset 후 invariants 검증
        self.debug_verify_invariants();

        Ok(OffsetResult {
            inner_face,
            strip_faces,
            original_face: face_id,
        })
    }

    /// Face만 storage에서 제거하되, half-edge의 face 참조만 NULL로 설정.
    /// next/prev/radial 연결은 보존하여 인접 face topology가 깨지지 않음.
    /// add_face가 find_halfedge에서 face==NULL인 free HE를 찾아 재사용할 수 있게 함.
    pub fn soft_remove_face(&mut self, face_id: FaceId) -> Result<()> {
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

/// ADR-080 §V2-B helper — Are two surfaces "equivalent" for host
/// resolution purposes? In V-β-α we only support Plane host, so
/// equivalence = same Plane (origin + normal coplanar within
/// EPSILON_LENGTH). Other surface kinds are forwarded but only ever
/// reach `UnsupportedHostSurface`, so equivalence for them is whether
/// they're the same kind.
fn surfaces_equivalent(
    a: &Option<AnalyticSurface>,
    b: &Option<AnalyticSurface>,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(s_a), Some(s_b)) => match (s_a, s_b) {
            (
                AnalyticSurface::Plane {
                    origin: oa,
                    normal: na,
                    ..
                },
                AnalyticSurface::Plane {
                    origin: ob,
                    normal: nb,
                    ..
                },
            ) => {
                let normal_match =
                    na.normalize_or_zero().dot(nb.normalize_or_zero()).abs() > 0.999;
                // Coplanarity: project (ob - oa) onto na — should be ~0.
                let off_plane = (*ob - *oa).dot(na.normalize_or_zero()).abs();
                normal_match && off_plane < crate::tolerances::EPSILON_LENGTH
            }
            _ => std::mem::discriminant(s_a) == std::mem::discriminant(s_b),
        },
        _ => false,
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

        // 2026-04-27 — frame face (multi-loop with hole) + inner = 2 faces.
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 2); // 1 inner + 1 frame (with hole)

        // strip_faces 는 이제 [frame_face] 하나만 (호환 vec).
        assert_eq!(result.strip_faces.len(), 1);

        // inner face 존재
        assert!(mesh.faces.get(result.inner_face).is_some());
    }

    #[test]
    fn test_offset_outset() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        let result = mesh.offset_face(fid, -100.0).unwrap();

        // outset 도 동일 — frame + inner.
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 2);
        assert_eq!(result.strip_faces.len(), 1);
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
        assert_eq!(faces_after, 2); // 1 inner + 1 frame
        assert_eq!(result.strip_faces.len(), 1);
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

        // box 6면 - top(삭제) + inner + frame(with hole) = 7면
        let face_count_after_offset = mesh.face_count();
        assert_eq!(face_count_after_offset, 7); // 5 original sides + 1 inner + 1 frame

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

    // ════════════════════════════════════════════════════════════════
    // ADR-080 V-β-α — offset_edge_on_host_face (Line + Plane host)
    // ════════════════════════════════════════════════════════════════

    /// Helper: build a Plane-surfaced unit square face on z=0, normal +Z.
    /// Returns (face_id, [v00, v10, v11, v01]) so callers can pick edges.
    fn build_unit_square_plane(mesh: &mut Mesh) -> (FaceId, [VertId; 4]) {
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        (face, [v00, v10, v11, v01])
    }

    fn find_edge_between(mesh: &Mesh, a: VertId, b: VertId) -> EdgeId {
        for (eid, e) in mesh.edges.iter() {
            if !e.is_active() {
                continue;
            }
            let pair = (e.v_small(), e.v_large());
            if pair == (a, b) || pair == (b, a) {
                return eid;
            }
        }
        panic!("edge between {a:?} and {b:?} not found");
    }

    #[test]
    fn line_on_plane_host_offset_creates_parallel_edge() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        // Bottom edge: v00 → v10 (along +X), face normal +Z.
        // offset_dir = edge_dir × normal = +X × +Z = -Y.
        // dist = 0.3 → new line at y = -0.3 (outside square).
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.3)
            .expect("offset OK");

        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let p1 = mesh.vertex_pos(result.new_v1).unwrap();
        // Both at y = -0.3, z = 0, with x = 0 and x = 1 (in some order).
        assert!((p0.y - (-0.3)).abs() < 1e-9);
        assert!((p1.y - (-0.3)).abs() < 1e-9);
        assert!(p0.z.abs() < 1e-9 && p1.z.abs() < 1e-9);
        let xs = [p0.x, p1.x];
        let mut sorted = xs;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((sorted[0] - 0.0).abs() < 1e-9);
        assert!((sorted[1] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn line_on_plane_host_uses_face_normal_not_caller_arg() {
        // Compare offset using V-β-α API vs legacy with explicit DVec3::Y
        // (wrong normal). New API should follow face's +Z, not Y.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .expect("offset OK");

        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        // With face normal = +Z and edge along +X, offset_dir = -Y.
        // If the API mistakenly used +Y as normal, offset_dir would be +Z
        // (out of plane) — the y-coord would be 0 instead of -0.5.
        assert!(
            (p0.y - (-0.5)).abs() < 1e-9,
            "offset must use face's +Z normal, got y = {}",
            p0.y
        );
        assert!(p0.z.abs() < 1e-9, "z must remain 0 (in-plane)");
    }

    #[test]
    fn line_offset_on_hole_face_rejected() {
        // Build a frame face (square with inner hole) — multi-loop face.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let outer = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 10.0)),
            mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0)),
        ];
        let inner = [
            mesh.add_vertex(DVec3::new(3.0, 0.0, 3.0)),
            mesh.add_vertex(DVec3::new(7.0, 0.0, 3.0)),
            mesh.add_vertex(DVec3::new(7.0, 0.0, 7.0)),
            mesh.add_vertex(DVec3::new(3.0, 0.0, 7.0)),
        ];
        let face = mesh
            .add_face_with_holes(&outer, &[&inner], mat)
            .expect("frame face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));
        let edge = find_edge_between(&mesh, outer[0], outer[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .err()
            .expect("must reject multi-loop");
        assert!(matches!(err, OffsetEdgeError::MultiLoopHostFace(_)));
    }

    #[test]
    fn line_offset_on_cylinder_host_returns_unsupported() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Build a tiny quad face but attach Cylinder surface (synthetic) to
        // exercise the host-surface kind dispatch.
        let vs = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0)),
            mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0)),
        ];
        let face = mesh.add_face(&vs, mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        }));
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 0.3)
            .err()
            .expect("must defer cylinder host");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedHostSurface { kind: "Cylinder" }
        ));
    }

    #[test]
    fn line_offset_no_incident_face_returns_no_incident() {
        let mut mesh = Mesh::new();
        let (_v0, _v1, edge_id) = mesh
            .draw_line(DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0))
            .unwrap();
        let err = mesh
            .offset_edge_on_host_face(edge_id, 0.5)
            .err()
            .expect("must reject free wire");
        assert!(matches!(err, OffsetEdgeError::NoIncidentFace));
    }

    #[test]
    fn line_offset_ambiguous_host_face_rejected() {
        // Two faces sharing an edge but with conflicting Plane normals.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let v5 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));

        // f1 in z=0 plane, normal +Z.
        let f1 = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        mesh.faces[f1].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        // f2 in y=0 plane (sharing edge v0-v1), normal +Y. Conflicting.
        let f2 = mesh.add_face(&[v0, v4, v5, v1], mat).unwrap();
        mesh.faces[f2].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));

        let shared = find_edge_between(&mesh, v0, v1);
        let err = mesh
            .offset_edge_on_host_face(shared, 0.3)
            .err()
            .expect("must reject ambiguous");
        assert!(matches!(err, OffsetEdgeError::AmbiguousHostFace { .. }));
    }

    #[test]
    fn arc_curve_offset_returns_unsupported_in_v_beta_alpha() {
        // Build a quad face on Plane and attach an Arc curve to one edge.
        // V-β-α only handles Line; Arc must defer to V-β-β.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let arc = AnalyticCurve::Arc {
            center: DVec3::new(0.5, 0.0, 0.0),
            radius: 0.5,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        mesh.edges[edge].set_curve(Some(arc));

        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must defer arc");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveKind { kind: "Arc" }
        ));
    }

    #[test]
    fn legacy_offset_edge_signature_unchanged() {
        // Regression — legacy `offset_edge(edge, dist, plane_normal)` still
        // exists and works for Line edges (free wire here).
        let mut mesh = Mesh::new();
        let (_v0, _v1, edge_id) = mesh
            .draw_line(DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0))
            .unwrap();
        let result = mesh
            .offset_edge(edge_id, 0.5, DVec3::Y)
            .expect("legacy API still works");
        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        // edge_dir +X × normal +Y = +Z, so new pos has z = 0.5.
        assert!((p0.z - 0.5).abs() < 1e-9);
    }

    #[test]
    fn line_offset_degenerate_distance_rejected() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 1e-9)
            .err()
            .expect("must reject zero dist");
        assert!(matches!(err, OffsetEdgeError::DegenerateDistance(_)));
    }
}
