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
//! # β-2 scope (current commit — algorithm 본체 + happy path)
//!
//! - `BoundaryError` enum (4 variant — AlgorithmDeferred sentinel β-1
//!   에서 본 commit 으로 제거됨)
//! - `boundary_from_point(&mut Mesh, ...)` — 4 validation + 본체 algorithm
//!   (Q1=c Hybrid: search_radius 내 orphan edges → DFS cycle finder →
//!   point-in-polygon 2D → smallest enclosing → face 합성)
//!
//! Validation 4단계 (ADR-148 §2.1):
//! 1. point 가 plane 에 평면적 (LOCKED #5 ε=1.5μm)
//! 2. orphan edges 수집 (active edges with no face, search_radius 내)
//! 3. 점을 둘러싼 cycle 발견 → 없음 → NoEnclosingCycle
//! 4. cycle 이 이미 face 인지 검사 → CycleAlreadyFaced
//!
//! Algorithm (β-2, Q1=c Hybrid):
//! - Linear scan with search_radius filter (β-2 MVP — BVH spatial accel
//!   은 future optimization, ADR-148 §3 trade-off matrix Q1=(c) 정합)
//! - DFS cycle finder on orphan edge subgraph
//! - point-in-polygon 2D (signed area + ray-casting)
//! - smallest enclosing cycle (area minimum)
//! - face 합성 (`add_face` existing API)
//!
//! # Cross-link
//!
//! - ADR-148 α spec (docs/adr/148-point-localized-boundary-tool.md)
//! - ADR-139 (LOCKED #64 Boundary tool 명시) — 직계 predecessor
//! - 메타-원칙 #5 / #14 / #16
//! - LOCKED #5 (1.5μm spatial-hash — proximity tolerance)
//! - LOCKED #44 / #63 / #64 / #65 / #66

use crate::mesh::Mesh;
use crate::{FaceId, VertId, EdgeId, MaterialId};
use crate::operations::boolean_geo::Plane;
use glam::DVec3;
use std::collections::{HashMap, HashSet};

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
/// # β-2 scope (current commit — happy path 활성)
///
/// 4 validation 모두 활성 + face 합성 본체. Returns `Ok(FaceId)` 시 새
/// boundary face 합성. β-1 의 `AlgorithmDeferred` sentinel 본 commit 에서
/// 제거됨.
pub fn boundary_from_point(
    mesh: &mut Mesh,
    point: DVec3,
    plane: Plane,
    search_radius: f64,
) -> Result<FaceId, BoundaryError> {
    // ─── ADR-171 β-2: absorb_boundary_input SSOT (Phase 2) ───────────────
    // Engine-internal robustness — project drift point onto the plane
    // BEFORE Validation #1 (robust 흡수, 사용자 정책 2026-05-30). Covers
    // ALL call paths (MCP / import / script / 내부호출) that bypass the
    // Tool layer (ADR-170 Phase 1).
    //
    // Behavior:
    //   - Point within MAX_DRIFT_MM of plane → projected onto plane (NEW:
    //     previously the 1.5μm-1mm drift gap returned PointNotOnPlane).
    //   - Point beyond MAX_DRIFT_MM → DriftBeyondTolerance → PointNotOnPlane
    //     (preserves the far-off rejection — 10mm test 정합).
    let canonical_plane = crate::plane::Plane {
        normal: plane.normal,
        offset: plane.dist,
    };
    let point = match crate::operations::boundary_input::absorb_boundary_input(
        mesh,
        crate::operations::boundary_input::BoundaryInput::Point {
            point,
            plane: canonical_plane,
        },
        Some(canonical_plane),
    ) {
        Ok(normalized) => {
            if let crate::operations::boundary_input::BoundaryInput::Point {
                point: projected,
                ..
            } = normalized.input
            {
                projected
            } else {
                point // unreachable — defensive
            }
        }
        Err(crate::operations::boundary_input::AbsorbReason::DriftBeyondTolerance {
            distance,
        }) => {
            // Beyond absorb tolerance — preserve original rejection semantics.
            return Err(BoundaryError::PointNotOnPlane {
                distance_mm: distance,
            });
        }
        Err(_) => point, // other reasons N/A to single Point — defensive
    };

    // Validation #1 — point 가 plane 에 평면적 (LOCKED #5 ε=1.5μm).
    // (post-absorb: projected point is on-plane within numerical precision.)
    let signed_dist = plane.normal.dot(point) - plane.dist;
    let distance_mm = signed_dist.abs();
    if distance_mm > POINT_ON_PLANE_TOL_MM {
        return Err(BoundaryError::PointNotOnPlane { distance_mm });
    }

    // Validation #2 — search_radius 내 orphan edges 수집.
    let radius_mm = if search_radius <= 0.0 {
        DEFAULT_SEARCH_RADIUS_MM
    } else {
        search_radius
    };
    let orphan_edges = collect_orphan_edges_in_radius(mesh, point, radius_mm);
    if orphan_edges.is_empty() {
        return Err(BoundaryError::NoOrphanEdgesInRadius {
            search_radius_mm: radius_mm,
        });
    }

    // Algorithm body — DFS cycle finder + point-in-polygon 2D + smallest
    // enclosing cycle selection.
    let cycles = find_all_cycles(mesh, &orphan_edges);
    if cycles.is_empty() {
        return Err(BoundaryError::NoEnclosingCycle);
    }

    // Build 2D plane basis for point-in-polygon test.
    let (u_axis, v_axis) = plane_basis(plane.normal);
    let point_2d = project_to_plane_2d(point, plane, u_axis, v_axis);

    // Filter cycles enclosing the point + select smallest area.
    let mut best: Option<(Vec<VertId>, f64)> = None;
    for cycle_verts in cycles {
        // Project cycle vertices to 2D.
        let poly_2d: Vec<(f64, f64)> = cycle_verts
            .iter()
            .filter_map(|&vid| {
                if mesh.verts.contains(vid) && mesh.verts[vid].is_active() {
                    Some(project_to_plane_2d(
                        mesh.verts[vid].pos(),
                        plane,
                        u_axis,
                        v_axis,
                    ))
                } else {
                    None
                }
            })
            .collect();
        if poly_2d.len() != cycle_verts.len() {
            continue;
        }
        if !point_in_polygon_2d(point_2d, &poly_2d) {
            continue;
        }
        // signed area for smallest selection (absolute value).
        let area = polygon_area_2d(&poly_2d).abs();
        if area <= 1e-9 {
            continue; // degenerate
        }
        match &best {
            None => best = Some((cycle_verts, area)),
            Some((_, current_area)) => {
                if area < *current_area {
                    best = Some((cycle_verts, area));
                }
            }
        }
    }

    let (cycle_verts, _area) = best.ok_or(BoundaryError::NoEnclosingCycle)?;

    // Validation #4 — cycle 이 이미 face 인지 검사. 모든 인접 edge 에
    // active face 있으면 CycleAlreadyFaced.
    if cycle_already_faced(mesh, &cycle_verts) {
        // Best-effort: report first face we find.
        let existing_face_id = find_existing_face_id(mesh, &cycle_verts)
            .unwrap_or(FaceId::new(u32::MAX));
        return Err(BoundaryError::CycleAlreadyFaced {
            existing_face_id: existing_face_id.raw(),
        });
    }

    // Face 합성 — `add_face` (winding 자동 정렬 via normal hint).
    // Material = default (MaterialId::new(0) — FORM_MATERIAL sentinel).
    // ADR-007 + LOCKED #1 P7 invariants are checked inside add_face.
    let face_id = mesh
        .add_face(&cycle_verts, MaterialId::new(0))
        .map_err(|_| BoundaryError::NoEnclosingCycle)?;

    Ok(face_id)
}

/// β-2 helper — collect (edge_id, v_small, v_large) for orphan edges
/// whose any endpoint is within `radius_mm` of `point`.
///
/// Returns a Vec of (EdgeId, VertId, VertId). β-2 MVP uses linear scan;
/// BVH spatial accel is future optimization (Q1=(c) trade-off).
fn collect_orphan_edges_in_radius(
    mesh: &Mesh,
    point: DVec3,
    radius_mm: f64,
) -> Vec<(EdgeId, VertId, VertId)> {
    let r2 = radius_mm * radius_mm;
    let mut result = Vec::new();
    let edge_ids: Vec<EdgeId> = mesh.edges.iter().map(|(id, _)| id).collect();
    for eid in edge_ids {
        let edge = &mesh.edges[eid];
        if !edge.is_active() {
            continue;
        }
        let (faces, _) = mesh.get_faces_sharing_edge(eid);
        let any_face = faces
            .iter()
            .any(|&f| mesh.faces.contains(f) && mesh.faces[f].is_active());
        if any_face {
            continue;
        }
        let va = edge.v_small();
        let vb = edge.v_large();
        if !mesh.verts.contains(va) || !mesh.verts.contains(vb) {
            continue;
        }
        if !mesh.verts[va].is_active() || !mesh.verts[vb].is_active() {
            continue;
        }
        let pa = mesh.verts[va].pos();
        let pb = mesh.verts[vb].pos();
        if pa.distance_squared(point) <= r2 || pb.distance_squared(point) <= r2 {
            result.push((eid, va, vb));
        }
    }
    result
}

/// β-2 helper — DFS cycle finder on the orphan edge subgraph.
///
/// Returns all simple closed cycles (as Vec<VertId>). Each cycle is
/// closed (first vertex == last vertex implicit, not duplicated).
/// MAX_CYCLES = 16 to bound time on dense graphs.
fn find_all_cycles(
    _mesh: &Mesh,
    orphan_edges: &[(EdgeId, VertId, VertId)],
) -> Vec<Vec<VertId>> {
    const MAX_CYCLES: usize = 16;
    const MAX_CYCLE_LEN: usize = 64;

    // Build adjacency
    let mut adj: HashMap<VertId, Vec<VertId>> = HashMap::new();
    for &(_eid, va, vb) in orphan_edges {
        adj.entry(va).or_default().push(vb);
        adj.entry(vb).or_default().push(va);
    }
    let mut cycles: Vec<Vec<VertId>> = Vec::new();
    let mut seen_signatures: HashSet<Vec<u32>> = HashSet::new();

    // Iterate from each vertex as a potential cycle start.
    let mut starts: Vec<VertId> = adj.keys().copied().collect();
    starts.sort_by_key(|v| v.raw());

    for start in starts {
        if cycles.len() >= MAX_CYCLES {
            break;
        }
        let mut path: Vec<VertId> = vec![start];
        let mut visited: HashSet<VertId> = HashSet::new();
        visited.insert(start);
        dfs_find_cycle(start, start, &adj, &mut path, &mut visited, &mut cycles, &mut seen_signatures, MAX_CYCLE_LEN, MAX_CYCLES);
    }
    cycles
}

fn dfs_find_cycle(
    start: VertId,
    current: VertId,
    adj: &HashMap<VertId, Vec<VertId>>,
    path: &mut Vec<VertId>,
    visited: &mut HashSet<VertId>,
    cycles: &mut Vec<Vec<VertId>>,
    seen_signatures: &mut HashSet<Vec<u32>>,
    max_len: usize,
    max_cycles: usize,
) {
    if cycles.len() >= max_cycles || path.len() >= max_len {
        return;
    }
    if let Some(neighbors) = adj.get(&current) {
        for &next in neighbors {
            if next == start && path.len() >= 3 {
                // Cycle found — canonical signature for dedup.
                let mut sig: Vec<u32> = path.iter().map(|v| v.raw()).collect();
                sig.sort();
                if !seen_signatures.contains(&sig) {
                    seen_signatures.insert(sig);
                    cycles.push(path.clone());
                }
                continue;
            }
            if visited.contains(&next) {
                continue;
            }
            visited.insert(next);
            path.push(next);
            dfs_find_cycle(start, next, adj, path, visited, cycles, seen_signatures, max_len, max_cycles);
            path.pop();
            visited.remove(&next);
        }
    }
}

/// β-2 helper — build 2D plane basis from normal.
fn plane_basis(normal: DVec3) -> (DVec3, DVec3) {
    let n = normal.normalize();
    // Pick a reference axis not parallel to n.
    let ref_axis = if n.x.abs() < 0.9 {
        DVec3::X
    } else {
        DVec3::Y
    };
    let u = ref_axis.cross(n).normalize();
    let v = n.cross(u).normalize();
    (u, v)
}

/// β-2 helper — project 3D point to 2D plane coordinates.
fn project_to_plane_2d(point: DVec3, plane: Plane, u: DVec3, v: DVec3) -> (f64, f64) {
    let plane_origin = plane.normal * plane.dist;
    let local = point - plane_origin;
    (local.dot(u), local.dot(v))
}

/// β-2 helper — point-in-polygon 2D (ray-casting).
fn point_in_polygon_2d(point: (f64, f64), poly: &[(f64, f64)]) -> bool {
    let (px, py) = point;
    let n = poly.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        let intersect = ((yi > py) != (yj > py))
            && (px < (xj - xi) * (py - yi) / (yj - yi + f64::EPSILON) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// β-2 helper — signed area of 2D polygon (shoelace).
fn polygon_area_2d(poly: &[(f64, f64)]) -> f64 {
    let n = poly.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        area += (xj + xi) * (yj - yi);
        j = i;
    }
    area * 0.5
}

/// β-2 helper — check if cycle is already an active face.
fn cycle_already_faced(mesh: &Mesh, cycle_verts: &[VertId]) -> bool {
    find_existing_face_id(mesh, cycle_verts).is_some()
}

/// β-2 helper — find existing face id matching cycle (if any).
fn find_existing_face_id(mesh: &Mesh, cycle_verts: &[VertId]) -> Option<FaceId> {
    let cycle_set: HashSet<u32> = cycle_verts.iter().map(|v| v.raw()).collect();
    let face_ids: Vec<FaceId> = mesh.faces.iter().map(|(id, _)| id).collect();
    for fid in face_ids {
        if !mesh.faces[fid].is_active() {
            continue;
        }
        let outer_start = mesh.faces[fid].outer().start;
        if let Ok(face_verts) = mesh.collect_loop_verts(outer_start) {
            if face_verts.len() != cycle_verts.len() {
                continue;
            }
            let face_set: HashSet<u32> = face_verts.iter().map(|v| v.raw()).collect();
            if face_set == cycle_set {
                return Some(fid);
            }
        }
    }
    None
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
    fn adr171_beta2_drift_gap_point_projected_passes_validation_1() {
        // ADR-171 β-2 — point at z=0.5mm is in the (1.5μm, 1mm) drift gap.
        // BEFORE absorb: PointNotOnPlane. AFTER absorb: projected onto plane
        // → passes Validation #1 → fails Validation #2 (empty mesh, no
        // orphan edges). Proves the absorb projection (robust 흡수).
        let mut mesh = Mesh::new();
        let plane = make_plane_z0();
        let point = DVec3::new(0.0, 0.0, 0.5); // 0.5mm off-plane (within 1mm)
        let result = boundary_from_point(&mut mesh, point, plane, 1000.0);
        match result {
            // Validation #1 now passes (projected); Validation #2 fails.
            Err(BoundaryError::NoOrphanEdgesInRadius { .. }) => {}
            other => panic!(
                "expected NoOrphanEdgesInRadius (absorb projected the drift), got {:?}",
                other
            ),
        }
    }

    #[test]
    fn adr171_beta2_far_off_plane_still_rejected() {
        // ADR-171 β-2 — point 10mm off-plane is BEYOND MAX_DRIFT_MM (1.0).
        // absorb returns DriftBeyondTolerance → PointNotOnPlane (preserves
        // far-off rejection semantics, 메타-원칙 #15 contract).
        let mut mesh = Mesh::new();
        let plane = make_plane_z0();
        let point = DVec3::new(0.0, 0.0, 10.0);
        let result = boundary_from_point(&mut mesh, point, plane, 1000.0);
        match result {
            Err(BoundaryError::PointNotOnPlane { distance_mm }) => {
                assert!(
                    (distance_mm - 10.0).abs() < 1e-6,
                    "expected ~10mm, got {}",
                    distance_mm
                );
            }
            other => panic!("expected PointNotOnPlane, got {:?}", other),
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
    fn adr148_beta2_isolated_open_chain_returns_no_enclosing_cycle() {
        // β-2: orphan edge present but no closed cycle → NoEnclosingCycle.
        // Single edge from (0,0,0) to (10,0,0). Point on plane within
        // radius. No cycle exists.
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let _ = mesh.add_edge(v0, v1);

        let plane = make_plane_z0();
        let point = DVec3::new(5.0, 0.0, 0.0);
        let result = boundary_from_point(&mut mesh, point, plane, 100.0);
        assert_eq!(result, Err(BoundaryError::NoEnclosingCycle));
    }

    #[test]
    fn adr148_beta2_square_cycle_synthesizes_face() {
        // β-2 happy path: 4 orphan edges forming a square on Z=0 plane,
        // point at center → Ok(FaceId).
        let mut mesh = Mesh::new();
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        // 4 orphan edges (square boundary, no face yet).
        let _ = mesh.add_edge(v00, v10);
        let _ = mesh.add_edge(v10, v11);
        let _ = mesh.add_edge(v11, v01);
        let _ = mesh.add_edge(v01, v00);

        let plane = make_plane_z0();
        let center = DVec3::new(5.0, 5.0, 0.0); // inside square
        let result = boundary_from_point(&mut mesh, center, plane, 100.0);
        assert!(
            matches!(result, Ok(_)),
            "expected Ok(FaceId) for centered point in square cycle, got {:?}",
            result,
        );
    }

    #[test]
    fn adr148_beta2_point_outside_cycle_returns_no_enclosing() {
        // β-2: square cycle exists but point is outside → NoEnclosingCycle.
        let mut mesh = Mesh::new();
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(10.0, 10.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 10.0, 0.0));
        let _ = mesh.add_edge(v00, v10);
        let _ = mesh.add_edge(v10, v11);
        let _ = mesh.add_edge(v11, v01);
        let _ = mesh.add_edge(v01, v00);

        let plane = make_plane_z0();
        // Point well outside (15, 5, 0) but still within search radius
        // (edges within 100mm).
        let outside = DVec3::new(15.0, 5.0, 0.0);
        let result = boundary_from_point(&mut mesh, outside, plane, 100.0);
        assert_eq!(result, Err(BoundaryError::NoEnclosingCycle));
    }
}
