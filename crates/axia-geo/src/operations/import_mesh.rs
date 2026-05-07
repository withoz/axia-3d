//! External Mesh Injection — STEP/IGES Import 의 axia DCEL first-class
//! entity 승격 (ADR-086 Approach A, O-β).
//!
//! 외부 BRep face (boundary loop polylines + analytic surface) 를 axia
//! Mesh DCEL 의 *first-class* face 로 inject. 결과 `FaceId` 는 자체
//! 그린 face 와 equality — offset / extrude / push-pull / Boolean 모두
//! 동작 (ADR-079 / ADR-080 NURBS-class 활성 unlock).
//!
//! ## Architecture
//!
//! 본 모듈은 thin wrapper — 기존 Mesh API 재사용:
//! 1. `add_vertex(pos)` per boundary point → auto-dedup (LOCKED #5
//!    1.5μm spatial hash)
//! 2. `add_face_with_holes(outer, holes, material)` → DCEL 구성 +
//!    ADR-007 winding 자동 정합
//! 3. `set_face_surface(face_id, Some(surface))` → analytic surface
//!    attach (ADR-031~033)
//! 4. ADR-007 invariant verifier 통과 보장 (debug_assertions)
//!
//! ## ADR-049 Two-Layer Citizenship 정합
//!
//! 본 함수는 *Form-layer* face (Shape) 를 생성. STEP import 는 재질
//! 정보 부재 — `FORM_MATERIAL` 사용 (LOCKED #26 ADR-049 P-5e-β).
//! Promote to Xia 는 caller (별도 ADR) 가 4-condition 검증 후 결정.
//!
//! ## Out of scope
//!
//! - Inner loops (holes) — MVP 는 outer loop only. 향후 sub-step.
//! - Boundary edge analytic curves — face surface 만 attach (edge curve
//!   는 별도 sub-step).
//! - Tessellation cache — caller 가 별도 보존 (Three.js 측).

use glam::DVec3;

use crate::mesh::Mesh;
use crate::FaceId;
use crate::surfaces::AnalyticSurface;

/// External BRep face boundary data — ADR-086 inject_external_face 입력.
///
/// `outer_loop` 의 winding 은 `surface_normal_hint` 와 정합해야 함
/// (ADR-007 Invariant 2 — CCW for normal direction). Mesh::add_face_with_holes
/// 가 자동으로 winding 검증 + 필요 시 reverse.
#[derive(Debug, Clone)]
pub struct ImportFaceBoundary {
    /// Outer boundary 의 ordered vertex positions. 첫 점 != 마지막 점
    /// (loop closure 는 implicit). 최소 3개.
    pub outer_loop: Vec<DVec3>,
    /// Inner boundary loops (holes). MVP 는 빈 Vec (outer only). 향후
    /// sub-step 에서 활성.
    pub inner_loops: Vec<Vec<DVec3>>,
}

/// External mesh injection error variants.
///
/// P21.7 답습 — caller (TS layer) 가 warnings 누적 가능.
#[derive(Debug, thiserror::Error)]
pub enum ImportFaceError {
    #[error("Outer loop must have at least 3 vertices, got {0}")]
    InsufficientVertices(usize),

    #[error("Inner loops not yet supported in MVP (ADR-086 O-β)")]
    InnerLoopsNotSupported,

    #[error("DCEL face creation failed: {0}")]
    FaceCreationFailed(String),
}

/// Inject one external BRep face into axia Mesh DCEL (ADR-086 O-β core).
///
/// Returns the new `FaceId` — caller (StepIgesImporter integration, O-δ)
/// 가 traversal stable index → axia FaceId map 에 저장.
///
/// # Steps
///
/// 1. Validate boundary (≥3 outer verts, no inner loops in MVP)
/// 2. `add_vertex(pos)` per outer boundary point (auto-dedup via
///    spatial hash, LOCKED #5)
/// 3. `add_face_with_holes(outer, [], FORM_MATERIAL)` — DCEL 구성
/// 4. `set_face_surface(face_id, surface)` — analytic surface attach
///    (optional)
/// 5. Return `FaceId`
///
/// # ADR-007 invariant
///
/// `add_face_with_holes` 가 ADR-007 winding 자동 정합 — surface_normal_hint
/// 기준으로 CCW/CW 검증 + reverse 시 적용. invariant verifier 통과.
///
/// # Caller responsibility
///
/// - traversal stable index 와 결과 FaceId 의 매핑 보존 (O-δ)
/// - boundary edges 의 analytic curve 별도 attach (별도 sub-step)
/// - Three.js Group userData 갱신 (faceIndex → axia FaceId mapping
///   추가 정보)
pub fn inject_external_face(
    mesh: &mut Mesh,
    boundary: ImportFaceBoundary,
    surface: Option<AnalyticSurface>,
    material: crate::MaterialId,
) -> Result<FaceId, ImportFaceError> {
    // Step 1 — validate
    if boundary.outer_loop.len() < 3 {
        return Err(ImportFaceError::InsufficientVertices(boundary.outer_loop.len()));
    }
    if !boundary.inner_loops.is_empty() {
        return Err(ImportFaceError::InnerLoopsNotSupported);
    }

    // Step 2 — add_vertex per outer point (auto-dedup, LOCKED #5)
    let outer_verts: Vec<crate::VertId> = boundary
        .outer_loop
        .iter()
        .map(|&pos| mesh.add_vertex(pos))
        .collect();

    // Step 3 — add_face_with_holes (DCEL 구성 + ADR-007 winding 자동 정합)
    let face_id = inject_via_add_face(mesh, &outer_verts, material)?;

    // Step 4 — analytic surface attach (optional)
    if let Some(surf) = surface {
        // set_face_surface returns bool (face existence) — face_id 방금
        // 생성했으므로 항상 true. 결과 무시.
        let _ = mesh.set_face_surface(face_id, Some(surf));
    }

    // ADR-007 invariant verifier 는 add_face_with_holes 내부의
    // debug_verify_invariants 가 자동 처리.

    Ok(face_id)
}

/// Internal helper — wraps `add_face_with_holes` with consistent error
/// mapping.
fn inject_via_add_face(
    mesh: &mut Mesh,
    outer_verts: &[crate::VertId],
    material: crate::MaterialId,
) -> Result<FaceId, ImportFaceError> {
    match mesh.add_face_with_holes(outer_verts, &[], material) {
        Ok(face_id) => Ok(face_id),
        Err(e) => Err(ImportFaceError::FaceCreationFailed(format!("{:?}", e))),
    }
}

// ────────────────────────────────────────────────────────────────────────
// Type re-exports (for convenience)
// ────────────────────────────────────────────────────────────────────────

// Allow caller to construct ImportFaceBoundary without importing DVec3 directly.
pub use glam::DVec3 as ImportPos;

// Suppress unused for MVP — inner_loops field reserved for future sub-step.
#[allow(dead_code)]
fn _silence_unused_inner_loops_in_mvp() {
    let _: Vec<Vec<DVec3>> = vec![];
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::Mesh;
    use crate::MaterialId;

    /// Form-layer material — axia-geo equivalent of axia-core's FORM_MATERIAL
    /// (LOCKED #26 ADR-049 P-5e-β). axia-geo 에서는 직접 `MaterialId::new(0)`
    /// 사용 (cross-crate 의존성 회피).
    const FORM_MAT: MaterialId = MaterialId::new(0);

    fn vec3(x: f64, y: f64, z: f64) -> DVec3 {
        DVec3::new(x, y, z)
    }

    #[test]
    fn inject_simple_planar_quad_creates_face() {
        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![],
        };

        let result = inject_external_face(&mut mesh, boundary, None, FORM_MAT);
        assert!(result.is_ok(), "inject_external_face should succeed for simple quad");
        let face_id = result.unwrap();

        // Face exists in mesh
        assert!(mesh.faces.contains(face_id));
    }

    #[test]
    fn inject_triangular_face_creates_face_with_3_vertices() {
        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(1.0, 0.0, 0.0),
                vec3(0.0, 1.0, 0.0),
            ],
            inner_loops: vec![],
        };

        let result = inject_external_face(&mut mesh, boundary, None, FORM_MAT);
        assert!(result.is_ok());
        // Mesh should have 3 vertices
        assert_eq!(mesh.verts.len(), 3);
        // 1 face (face_count() == active face count)
        assert_eq!(mesh.face_count(), 1);
    }

    #[test]
    fn inject_with_analytic_surface_attaches() {
        use crate::surfaces::AnalyticSurface;

        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![],
        };
        // AnalyticSurface::Plane is a struct variant — use struct syntax.
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-1e6, 1e6),
            v_range: (-1e6, 1e6),
        };

        let face_id = inject_external_face(&mut mesh, boundary, Some(plane), FORM_MAT)
            .expect("injection should succeed");

        // Surface attached
        assert!(mesh.face_surface(face_id).is_some());
    }

    #[test]
    fn inject_insufficient_vertices_errors() {
        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![vec3(0.0, 0.0, 0.0), vec3(1.0, 0.0, 0.0)],  // 2 verts
            inner_loops: vec![],
        };

        let result = inject_external_face(&mut mesh, boundary, None, FORM_MAT);
        assert!(matches!(result, Err(ImportFaceError::InsufficientVertices(2))));
    }

    #[test]
    fn inject_inner_loops_not_supported_errors() {
        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![vec![vec3(2.0, 2.0, 0.0), vec3(3.0, 2.0, 0.0), vec3(2.0, 3.0, 0.0)]],
        };

        let result = inject_external_face(&mut mesh, boundary, None, FORM_MAT);
        assert!(matches!(result, Err(ImportFaceError::InnerLoopsNotSupported)));
    }

    #[test]
    fn inject_multiple_faces_separately_creates_distinct_ids() {
        let mut mesh = Mesh::default();
        let make_quad = |z: f64| ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, z),
                vec3(10.0, 0.0, z),
                vec3(10.0, 10.0, z),
                vec3(0.0, 10.0, z),
            ],
            inner_loops: vec![],
        };

        let f1 = inject_external_face(&mut mesh, make_quad(0.0), None, FORM_MAT).unwrap();
        let f2 = inject_external_face(&mut mesh, make_quad(5.0), None, FORM_MAT).unwrap();

        assert_ne!(f1, f2);
        assert_eq!(mesh.face_count(), 2);
    }

    // ────────────────────────────────────────────────────────────────
    // ADR-086 O-ε — ADR-007 invariant 회귀 (post-inject verifier)
    // ────────────────────────────────────────────────────────────────

    #[test]
    fn invariant_quad_inject_passes_adr007_verifier() {
        // ADR-086 O-ε — inject 결과 face 가 ADR-007 invariant verifier
        // 통과 보장. add_face_with_holes 자동 정합 답습.
        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![],
        };
        let _ = inject_external_face(&mut mesh, boundary, None, FORM_MAT)
            .expect("inject should succeed");

        let report = mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "ADR-007 invariant violation after inject: {}",
            report.summary(),
        );
        assert_eq!(report.checked_faces, 1);
    }

    #[test]
    fn invariant_two_inject_faces_both_pass_adr007() {
        // 2 disjoint faces inject → 둘 다 ADR-007 통과 (no cross-contamination)
        let mut mesh = Mesh::default();
        let make_quad = |z: f64| ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, z),
                vec3(10.0, 0.0, z),
                vec3(10.0, 10.0, z),
                vec3(0.0, 10.0, z),
            ],
            inner_loops: vec![],
        };
        let _ = inject_external_face(&mut mesh, make_quad(0.0), None, FORM_MAT).unwrap();
        let _ = inject_external_face(&mut mesh, make_quad(5.0), None, FORM_MAT).unwrap();

        let report = mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "ADR-007 invariant violation: {}",
            report.summary(),
        );
        assert_eq!(report.checked_faces, 2);
    }

    #[test]
    fn invariant_inject_with_plane_surface_passes_adr007() {
        // Plane analytic surface attach 후에도 ADR-007 invariant 통과
        use crate::surfaces::AnalyticSurface;

        let mut mesh = Mesh::default();
        let boundary = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![],
        };
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-1e6, 1e6),
            v_range: (-1e6, 1e6),
        };
        let _ = inject_external_face(&mut mesh, boundary, Some(plane), FORM_MAT)
            .expect("inject should succeed");

        let report = mesh.verify_face_invariants();
        assert!(
            report.is_valid(),
            "ADR-007 invariant violation with surface: {}",
            report.summary(),
        );
    }

    #[test]
    fn inject_shared_vertex_dedup_via_spatial_hash() {
        // 두 face 가 같은 vertex 를 공유 (LOCKED #5 spatial hash dedup)
        let mut mesh = Mesh::default();
        let boundary1 = ImportFaceBoundary {
            outer_loop: vec![
                vec3(0.0, 0.0, 0.0),
                vec3(10.0, 0.0, 0.0),
                vec3(0.0, 10.0, 0.0),
            ],
            inner_loops: vec![],
        };
        let boundary2 = ImportFaceBoundary {
            outer_loop: vec![
                vec3(10.0, 0.0, 0.0),  // shared with face 1
                vec3(10.0, 10.0, 0.0),
                vec3(0.0, 10.0, 0.0),  // shared with face 1
            ],
            inner_loops: vec![],
        };

        let _ = inject_external_face(&mut mesh, boundary1, None, FORM_MAT).unwrap();
        let _ = inject_external_face(&mut mesh, boundary2, None, FORM_MAT).unwrap();

        // Shared vertices: 4 unique (0,0,0), (10,0,0), (0,10,0), (10,10,0)
        // Without dedup would be 6 (3+3).
        assert_eq!(mesh.verts.len(), 4);
        assert_eq!(mesh.face_count(), 2);
    }
}
