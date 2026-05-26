//! ADR-148 — Point-Localized BoundaryTool (B-γ' Engine implementation).
//!
//! CAD 표준 BOUNDARY 명령 equivalent — 사용자가 영역 내부의 한 점을 클릭
//! 하면 그 점을 둘러싼 가장 작은 boundary loop 검출 → face 합성.
//!
//! ADR-139 (Boundary tool 명시 only) 직계 후속 — full mesh sweep
//! (`Scene::resynthesize_orphan_faces`) 보다 정밀한 *국지적* 명시 trigger.
//!
//! **메타-원칙 #16 정합**: 휴리스틱 자동 activation 0, 사용자 클릭 =
//! 명시 의도 canonical.
//!
//! # β-1 scope (current commit — skeleton + 4 validation)
//!
//! - `BoundaryError` enum (4 variant — validation failures + promote
//!   logic deferred)
//! - `boundary_from_point(&mut Mesh, ...)` — 4 validation + promote stub
//!   (returns `BoundaryError::AlgorithmDeferred` until β-2)
//!
//! Validation 4단계 (ADR-148 §2.1):
//! 1. point 가 plane 에 평면적 (LOCKED #5 ε=1.5μm)
//! 2. orphan edges 수집 (active edges with no face) — empty → NoOrphan
//! 3. 점을 둘러싼 cycle 발견 (β-2 본체) → 없음 → NoEnclosingCycle
//! 4. cycle 이 이미 face 인지 검사 → CycleAlreadyFaced
//!
//! Algorithm (β-2, Q1=c Hybrid):
//! - BVH spatial query (search_radius 내 orphan edges 만)
//! - DFS cycle finder (existing `mop_up_orphan_cycles_via_dfs` 자산 재활용)
//! - point-in-polygon 2D (smallest enclosing area)
//! - face 합성 (`add_face_with_holes` 등 existing API)
//!
//! # Cross-link
//!
//! - ADR-148 α spec (docs/adr/148-point-localized-boundary-tool.md)
//! - ADR-139 (LOCKED #64 Boundary tool 명시) — 직계 predecessor
//! - 메타-원칙 #5 / #14 / #16
//! - LOCKED #5 (1.5μm spatial-hash — proximity tolerance)
//! - LOCKED #44 / #63 / #64 / #65 / #66

use crate::mesh::Mesh;
use crate::FaceId;
use crate::operations::boolean_geo::Plane;
use glam::DVec3;

/// ADR-148 β-1 — Point-Localized BoundaryTool errors.
///
/// Returned by `boundary_from_point`. Each variant 은 명시 validation
/// failure (silent skip 차단, 메타-원칙 #16 정합). β-1 의 `AlgorithmDeferred`
/// variant 는 β-2 진입 시 제거 예정 (skeleton 단계 표시).
#[derive(Debug, Clone, PartialEq)]
pub enum BoundaryError {
    /// 점이 plane 에 평면적 (LOCKED #5 ε=1.5μm 초과).
    /// `distance_mm` 은 plane 까지의 부호없는 거리 (Toast 표시용).
    PointNotOnPlane { distance_mm: f64 },

    /// search_radius 내 orphan edges 0 (작업 영역 비어 있음).
    /// `search_radius_mm` 은 caller 지정 또는 default 1000mm.
    NoOrphanEdgesInRadius { search_radius_mm: f64 },

    /// 점을 둘러싼 simple closed cycle 없음 (free space click 또는
    /// 모든 cycle 이 점을 포함하지 않음).
    NoEnclosingCycle,

    /// 발견된 cycle 이 이미 active face (중복 합성 차단).
    /// `existing_face_id` 는 Toast 에서 사용자에게 알림.
    CycleAlreadyFaced { existing_face_id: u32 },

    /// β-1 sentinel — β-2 Algorithm 구현 전 placeholder.
    /// β-2 commit 에서 제거됨.
    AlgorithmDeferred,
}

impl std::fmt::Display for BoundaryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BoundaryError::PointNotOnPlane { distance_mm } => {
                write!(f, "PointNotOnPlane (distance {:.3}mm)", distance_mm)
            }
            BoundaryError::NoOrphanEdgesInRadius { search_radius_mm } => {
                write!(f, "NoOrphanEdgesInRadius (radius {:.1}mm)", search_radius_mm)
            }
            BoundaryError::NoEnclosingCycle => write!(f, "NoEnclosingCycle"),
            BoundaryError::CycleAlreadyFaced { existing_face_id } => {
                write!(f, "CycleAlreadyFaced (face {})", existing_face_id)
            }
            BoundaryError::AlgorithmDeferred => write!(f, "AlgorithmDeferred"),
        }
    }
}

impl std::error::Error for BoundaryError {}

/// LOCKED #5 — point-plane proximity tolerance (1.5μm = 1.5e-3 mm).
/// AxiA 의 모든 geometric proximity 의 canonical ε.
pub const POINT_ON_PLANE_TOL_MM: f64 = 1.5e-3;

/// Default search radius (10×10×10m 작업 공간 표준).
/// caller 가 0 또는 negative 전달 시 본 값 사용.
pub const DEFAULT_SEARCH_RADIUS_MM: f64 = 1000.0;

/// ADR-148 β-1 — Point-localized boundary face detection (skeleton).
///
/// Given a 3D point and a plane, find the smallest enclosing orphan
/// edge cycle on that plane containing the point, and synthesize a
/// face from that cycle.
///
/// # Parameters
/// - `mesh`: target mesh (mutable — face 합성 시 update)
/// - `point`: 3D world-space click point
/// - `plane`: target plane (cardinal projection or face plane)
/// - `search_radius`: BVH spatial query radius (mm). ≤0 시 default 1000mm.
///
/// # Returns
/// - `Ok(FaceId)`: 새로 합성된 boundary face
/// - `Err(BoundaryError)`: 4 validation failure 또는 β-1 의 AlgorithmDeferred
///
/// # β-1 scope
/// 본 commit 은 validation 1+2 만 활성. validation 3+4 (cycle detection
/// + face 합성) 는 β-2 commit 에서 활성. 현재는 validation 통과 시
/// `Err(AlgorithmDeferred)` 반환.
///
/// β-2 활성 시 본 함수의 happy path 가 `Ok(FaceId)` 반환.
pub fn boundary_from_point(
    mesh: &mut Mesh,
    point: DVec3,
    plane: Plane,
    search_radius: f64,
) -> Result<FaceId, BoundaryError> {
    // Validation #1 — point 가 plane 에 평면적 (LOCKED #5 ε=1.5μm).
    // signed distance = normal · (point - plane_anchor). plane.dist =
    // normal · plane_point, so signed_dist = normal · point - plane.dist.
    let signed_dist = plane.normal.dot(point) - plane.dist;
    let distance_mm = signed_dist.abs();
    if distance_mm > POINT_ON_PLANE_TOL_MM {
        return Err(BoundaryError::PointNotOnPlane { distance_mm });
    }

    // Validation #2 — search_radius 내 orphan edges 수집.
    // search_radius ≤ 0 → DEFAULT_SEARCH_RADIUS_MM.
    let radius_mm = if search_radius <= 0.0 {
        DEFAULT_SEARCH_RADIUS_MM
    } else {
        search_radius
    };
    let orphan_count = count_orphan_edges_in_radius(mesh, point, radius_mm);
    if orphan_count == 0 {
        return Err(BoundaryError::NoOrphanEdgesInRadius {
            search_radius_mm: radius_mm,
        });
    }

    // β-1: Validation #3 + #4 + algorithm body deferred to β-2.
    // β-2 commit 이 본 sentinel 을 제거하고 cycle detection + face
    // synthesis 활성.
    Err(BoundaryError::AlgorithmDeferred)
}

/// β-1 helper — orphan edges within search_radius (sphere AABB test).
///
/// β-2 에서 BVH spatial query 로 교체될 placeholder. 현재는 linear
/// scan (active edges with no face, vertex within radius).
///
/// `mesh.edges.iter()` 의 active filter + face-bearing check + vert
/// proximity check. 본 count 는 validation #2 용 (실제 cycle detection
/// 은 β-2 에서 BVH + DFS).
fn count_orphan_edges_in_radius(
    mesh: &Mesh,
    point: DVec3,
    radius_mm: f64,
) -> usize {
    use crate::EdgeId;
    let r2 = radius_mm * radius_mm;
    let mut count = 0usize;
    let edge_ids: Vec<EdgeId> = mesh.edges.iter().map(|(id, _)| id).collect();
    for eid in edge_ids {
        let edge = &mesh.edges[eid];
        if !edge.is_active() {
            continue;
        }
        // Orphan = active edge with no active face on either side.
        let (faces, _) = mesh.get_faces_sharing_edge(eid);
        let any_face = faces
            .iter()
            .any(|&f| mesh.faces.contains(f) && mesh.faces[f].is_active());
        if any_face {
            continue;
        }
        // Vertex proximity — either endpoint within radius (cheap AABB
        // approximation; β-2 BVH 는 정확 edge-point distance 사용).
        let va = edge.v_small();
        let vb = edge.v_large();
        // Vert proximity check — both endpoints active.
        if !mesh.verts.contains(va) || !mesh.verts.contains(vb) {
            continue;
        }
        if !mesh.verts[va].is_active() || !mesh.verts[vb].is_active() {
            continue;
        }
        let pa = mesh.verts[va].pos();
        let pb = mesh.verts[vb].pos();
        if pa.distance_squared(point) <= r2 || pb.distance_squared(point) <= r2 {
            count += 1;
        }
    }
    count
}

// ════════════════════════════════════════════════════════════════════
// β-1 회귀 자산 — 4 tests (절대 #[ignore] 금지)
//
// L-148-7: 절대 #[ignore] 금지 — 회귀 자산 모두 enabled.
// β-1 scope: validation 1+2 + AlgorithmDeferred sentinel.
// β-2 commit 시 happy path (Ok(FaceId)) 회귀 자산 추가.
// ════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Mesh;

    fn make_plane_z0() -> Plane {
        Plane {
            normal: DVec3::new(0.0, 0.0, 1.0),
            dist: 0.0,
        }
    }

    #[test]
    fn adr148_beta1_rejects_point_not_on_plane() {
        // L-148-3 정합: point 가 plane 에서 1.5μm 초과 시 강제 reject.
        let mut mesh = Mesh::new();
        let plane = make_plane_z0();
        // Point at z=10mm (well above 1.5μm tolerance).
        let point = DVec3::new(0.0, 0.0, 10.0);
        let result = boundary_from_point(&mut mesh, point, plane, 1000.0);
        match result {
            Err(BoundaryError::PointNotOnPlane { distance_mm }) => {
                assert!(
                    (distance_mm - 10.0).abs() < 1e-6,
                    "expected distance ~10mm, got {}",
                    distance_mm,
                );
            }
            other => panic!("expected PointNotOnPlane, got {:?}", other),
        }
    }

    #[test]
    fn adr148_beta1_point_within_tolerance_passes_validation_1() {
        // Boundary edge case — distance just below POINT_ON_PLANE_TOL_MM.
        let mut mesh = Mesh::new();
        let plane = make_plane_z0();
        // Point at z = 1.4μm (just within 1.5μm tolerance).
        let point = DVec3::new(0.0, 0.0, 1.4e-3);
        let result = boundary_from_point(&mut mesh, point, plane, 1000.0);
        // Validation #1 passes, but validation #2 fails (empty mesh,
        // no orphan edges in radius).
        match result {
            Err(BoundaryError::NoOrphanEdgesInRadius { search_radius_mm }) => {
                assert!((search_radius_mm - 1000.0).abs() < 1e-9);
            }
            other => panic!("expected NoOrphanEdgesInRadius, got {:?}", other),
        }
    }

    #[test]
    fn adr148_beta1_negative_radius_uses_default() {
        // search_radius ≤ 0 → DEFAULT_SEARCH_RADIUS_MM (1000mm).
        let mut mesh = Mesh::new();
        let plane = make_plane_z0();
        let point = DVec3::new(0.0, 0.0, 0.0);

        // Test both 0 and negative.
        for radius in [0.0, -1.0, -100.0] {
            let result = boundary_from_point(&mut mesh, point, plane, radius);
            match result {
                Err(BoundaryError::NoOrphanEdgesInRadius { search_radius_mm }) => {
                    assert!(
                        (search_radius_mm - DEFAULT_SEARCH_RADIUS_MM).abs() < 1e-9,
                        "expected default {} for input {}",
                        DEFAULT_SEARCH_RADIUS_MM,
                        radius,
                    );
                }
                other => panic!("expected default radius substitution, got {:?}", other),
            }
        }
    }

    #[test]
    fn adr148_beta1_skeleton_returns_algorithm_deferred_on_validation_pass() {
        // β-1 sentinel — validation 1+2 통과 시 AlgorithmDeferred 반환.
        // β-2 commit 에서 본 sentinel 제거 + happy path Ok(FaceId).
        //
        // We need a mesh with at least 1 orphan edge within radius to
        // pass validation #2.
        let mut mesh = Mesh::new();
        // Add 2 verts + 1 orphan edge near origin.
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        // Orphan edge (no face) — add via add_edge.
        let _ = mesh.add_edge(v0, v1);

        let plane = make_plane_z0();
        let point = DVec3::new(5.0, 0.0, 0.0); // exact on plane, near edge
        let result = boundary_from_point(&mut mesh, point, plane, 100.0);
        // Validation #1 (on plane) + #2 (orphan edge in radius) pass →
        // AlgorithmDeferred sentinel.
        assert_eq!(result, Err(BoundaryError::AlgorithmDeferred));
    }
}
