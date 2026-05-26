//! ADR-145 — Circle Annulus 명시 활성 (옵션 B).
//!
//! Circle 두 별개 face → 사용자 명시 trigger ("annulus 만들기" 우클릭)
//! 시 outer face 의 hole 로 inner Circle 명시 promote.
//!
//! **메타-원칙 #16 정합**: 휴리스틱 자동 annulus promote 폐기, 사용자
//! 명시 의도 canonical. ADR-139 (Boundary tool 명시) pattern 1:1 mirror.
//!
//! # β-1 scope (current commit)
//!
//! - `AnnulusError` enum (5 variant — 4 validation + 1 promote stub)
//! - `promote_circles_to_annulus` 함수 — 4 validation full implementation
//! - Promote logic = `bail!` placeholder (별도 atomic sub-step)
//!
//! Validation 4단계:
//! 1. outer + inner 둘 다 active face
//! 2. 둘 다 closed-curve Circle face (outer loop = 1 self-loop edge with
//!    `AnalyticCurve::Circle`)
//! 3. outer + inner coplanar (normal parallel + 같은 plane 식 정합)
//! 4. inner Circle fully contained in outer Circle (center distance +
//!    inner.radius <= outer.radius)
//!
//! # Future sub-step (β-1+ amendment 또는 별도 atomic)
//!
//! - Promote logic — outer face 의 inner LoopRef 로 inner self-loop
//!   reparent + inner face deactivate. HE.face() pointer 변경 +
//!   `Face::add_inner` 사용.
//!
//! # Cross-link
//!
//! - ADR-145 α spec (docs/adr/145-circle-annulus-explicit-activation.md)
//! - ADR-139 (Boundary tool 명시) — pattern 1:1 mirror
//! - ADR-089 Phase 2 (closed-curve face) — `add_face_closed_curve`
//! - 메타-원칙 #16 (자동화 antipattern)
//! - LOCKED #1 P7 (hole loop manifold)
//! - LOCKED #44 (Complete Meaning per Merge — sub-step atomic)
//! - LOCKED #66 (ADR-164 Sunset Policy — Status canonical)

use crate::mesh::Mesh;
use crate::FaceId;
use glam::DVec3;

/// ADR-145 β-1 — Circle annulus promote errors.
///
/// Returned by `promote_circles_to_annulus`. Each variant 은 명시
/// validation failure (silent skip 차단, 메타-원칙 #16 정합).
#[derive(Debug, Clone, PartialEq)]
pub enum AnnulusError {
    /// outer 또는 inner face 가 inactive 또는 not found.
    InactiveFace { face_id: u32, role: &'static str },

    /// outer 또는 inner 가 closed-curve Circle face 아님 (outer loop
    /// 가 1 self-loop edge with `AnalyticCurve::Circle` 형태 아님).
    NotCircleFace { face_id: u32, role: &'static str },

    /// outer + inner 가 다른 평면 (normal parallel 미달 또는 plane
    /// 식 distance 미달).
    NotCoplanar {
        outer_normal: DVec3,
        inner_normal: DVec3,
        plane_distance: f64,
    },

    /// inner Circle 이 outer Circle 안에 fully contained 안 됨
    /// (off-center distance + inner.radius > outer.radius).
    InnerNotContained {
        center_distance: f64,
        inner_radius: f64,
        outer_radius: f64,
    },

    /// Promote logic 미구현 (β-1 scope — validation only). 별도 atomic
    /// sub-step (β-1+ amendment 또는 β-1.5) 후 active.
    PromoteLogicDeferred,
}

impl std::fmt::Display for AnnulusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InactiveFace { face_id, role } => write!(
                f,
                "ADR-145: {} face {} is inactive or not found",
                role, face_id,
            ),
            Self::NotCircleFace { face_id, role } => write!(
                f,
                "ADR-145: {} face {} is not a closed-curve Circle face \
                 (expected 1 self-loop edge with AnalyticCurve::Circle)",
                role, face_id,
            ),
            Self::NotCoplanar {
                outer_normal,
                inner_normal,
                plane_distance,
            } => write!(
                f,
                "ADR-145: outer + inner not coplanar (outer_normal={:?}, \
                 inner_normal={:?}, plane_distance={:.3e})",
                outer_normal, inner_normal, plane_distance,
            ),
            Self::InnerNotContained {
                center_distance,
                inner_radius,
                outer_radius,
            } => write!(
                f,
                "ADR-145: inner Circle not fully contained in outer Circle \
                 (center_distance={:.3} + inner_radius={:.3} > outer_radius={:.3})",
                center_distance, inner_radius, outer_radius,
            ),
            Self::PromoteLogicDeferred => write!(
                f,
                "ADR-145 β-1: promote logic deferred to next atomic sub-step \
                 (β-1+ amendment or β-1.5). Validation passed; promote not yet implemented.",
            ),
        }
    }
}

impl std::error::Error for AnnulusError {}

/// Coplanarity tolerance (1.5 μm, LOCKED #5 spatial-hash dedup tolerance).
const COPLANAR_TOL: f64 = 1.5e-3;
/// Normal direction parity tolerance (parallel — 1 - |dot| < 1e-6 = nearly parallel).
const NORMAL_PARITY_TOL: f64 = 1e-6;

/// ADR-145 — Circle annulus 명시 promote.
///
/// 두 coplanar Circle face (outer + inner) 를 annulus (outer with
/// inner hole) 로 명시 promote. inner face deactivate.
///
/// **사용자 명시 trigger only** (메타-원칙 #16) — 휴리스틱 자동 detect
/// 안 됨. ContextMenu "annulus 만들기" 우클릭 후 호출 (β-4).
///
/// # β-1 scope (current)
///
/// Validation 4단계 full implementation + promote logic placeholder.
/// 본 commit 후 validation pass 시 `AnnulusError::PromoteLogicDeferred`
/// 반환 (silent success 차단). 별도 atomic sub-step (β-1+ amendment 또는
/// β-1.5) 에서 promote logic 활성.
///
/// # Errors
///
/// - `InactiveFace` — outer 또는 inner active 아님
/// - `NotCircleFace` — outer 또는 inner 가 closed-curve Circle 아님
/// - `NotCoplanar` — 다른 평면
/// - `InnerNotContained` — inner Circle 이 outer 안 contained 안 됨
/// - `PromoteLogicDeferred` — validation 통과, promote 미구현 (β-1 scope)
pub fn promote_circles_to_annulus(
    mesh: &Mesh,
    outer_face: FaceId,
    inner_face: FaceId,
) -> Result<(), AnnulusError> {
    // === Validation 1: outer + inner active ===
    let outer = mesh.faces.get(outer_face).ok_or(AnnulusError::InactiveFace {
        face_id: outer_face.raw(),
        role: "outer",
    })?;
    if !outer.is_active() {
        return Err(AnnulusError::InactiveFace {
            face_id: outer_face.raw(),
            role: "outer",
        });
    }
    let inner = mesh.faces.get(inner_face).ok_or(AnnulusError::InactiveFace {
        face_id: inner_face.raw(),
        role: "inner",
    })?;
    if !inner.is_active() {
        return Err(AnnulusError::InactiveFace {
            face_id: inner_face.raw(),
            role: "inner",
        });
    }

    // === Validation 2: 둘 다 Circle face ===
    let outer_circle = extract_circle(mesh, outer_face).ok_or(AnnulusError::NotCircleFace {
        face_id: outer_face.raw(),
        role: "outer",
    })?;
    let inner_circle = extract_circle(mesh, inner_face).ok_or(AnnulusError::NotCircleFace {
        face_id: inner_face.raw(),
        role: "inner",
    })?;

    // === Validation 3: coplanar (normal parallel + plane distance) ===
    let n_outer = outer_circle.normal.normalize_or_zero();
    let n_inner = inner_circle.normal.normalize_or_zero();
    let dot = n_outer.dot(n_inner).abs();
    if (1.0 - dot) > NORMAL_PARITY_TOL {
        return Err(AnnulusError::NotCoplanar {
            outer_normal: n_outer,
            inner_normal: n_inner,
            plane_distance: f64::INFINITY,
        });
    }
    // Plane equation distance: (inner.center - outer.center) · outer.normal
    let plane_distance = (inner_circle.center - outer_circle.center).dot(n_outer).abs();
    if plane_distance > COPLANAR_TOL {
        return Err(AnnulusError::NotCoplanar {
            outer_normal: n_outer,
            inner_normal: n_inner,
            plane_distance,
        });
    }

    // === Validation 4: inner ⊂ outer ===
    let center_distance = (inner_circle.center - outer_circle.center).length();
    if center_distance + inner_circle.radius > outer_circle.radius {
        return Err(AnnulusError::InnerNotContained {
            center_distance,
            inner_radius: inner_circle.radius,
            outer_radius: outer_circle.radius,
        });
    }

    // === Promote logic (β-1 scope — deferred) ===
    //
    // β-1+ amendment 또는 β-1.5 별도 atomic sub-step:
    //   1. inner face 의 outer LoopRef 의 HEs reparent (face() → outer_face_id)
    //   2. outer face 의 add_inner(inner_outer_loop) 호출
    //   3. inner face deactivate
    //
    // 본 β-1 commit 은 validation only — silent success 차단을 위해
    // PromoteLogicDeferred 반환 (caller 가 명시 추적 가능).
    Err(AnnulusError::PromoteLogicDeferred)
}

/// Helper: face 가 closed-curve Circle face 인지 확인 + Circle 메타데이터 반환.
///
/// Circle face = outer loop 가 1 self-loop edge with
/// `AnalyticCurve::Circle` 형태 (ADR-089 Phase 2 canonical).
fn extract_circle(mesh: &Mesh, face_id: FaceId) -> Option<CircleData> {
    let face = mesh.faces.get(face_id)?;
    let outer_start = face.outer().start;
    if outer_start.is_null() {
        return None;
    }
    // Collect loop HEs — Circle face = exactly 1 HE (self-loop)
    let hes = mesh.collect_loop_hes(outer_start).ok()?;
    if hes.len() != 1 {
        return None;
    }
    let he = mesh.hes.get(hes[0])?;
    let curve = mesh.edge_curve(he.edge())?;  // Mesh API — Option<&AnalyticCurve>
    match curve {
        crate::curves::AnalyticCurve::Circle {
            center,
            radius,
            normal,
            ..
        } => Some(CircleData {
            center: *center,  // *&DVec3 → DVec3 (Copy)
            radius: *radius,  // *&f64 → f64 (Copy)
            normal: *normal,  // *&DVec3 → DVec3 (Copy)
        }),
        _ => None,
    }
}

/// Minimal Circle metadata extracted from a face's self-loop edge.
struct CircleData {
    center: DVec3,
    radius: f64,
    normal: DVec3,
}

// ════════════════════════════════════════════════════════════════════
// Tests (ADR-145 β-1 — 5 회귀 자산)
// ════════════════════════════════════════════════════════════════════
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{curves::AnalyticCurve, MaterialId};
    use glam::DVec3;

    /// Helper: build a Circle face at (center, radius) on Z=0 plane.
    fn build_circle_face(
        mesh: &mut Mesh,
        center: DVec3,
        radius: f64,
        normal: DVec3,
    ) -> FaceId {
        // ADR-089 Phase 2: 1 anchor + 1 self-loop edge with AnalyticCurve::Circle
        let anchor_pos = center + DVec3::new(radius, 0.0, 0.0);  // anchor at θ=0
        let anchor = mesh.add_vertex(anchor_pos);
        let curve = AnalyticCurve::Circle {
            center,
            radius,
            normal,
            basis_u: DVec3::X,
        };
        mesh.add_face_closed_curve(anchor, curve, MaterialId::new(0))
            .expect("Circle face creation must succeed")
    }

    #[test]
    fn adr145_beta1_validation_passes_with_concentric_circles() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        // Validation 통과 → β-1 scope 의 PromoteLogicDeferred 반환
        let result = promote_circles_to_annulus(&mesh, outer, inner);
        assert_eq!(result, Err(AnnulusError::PromoteLogicDeferred),
            "Validation passed; expected PromoteLogicDeferred (β-1 scope)");
    }

    #[test]
    fn adr145_beta1_rejects_inactive_outer() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        // Deactivate outer
        mesh.faces[outer].set_active(false);

        let result = promote_circles_to_annulus(&mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InactiveFace { role: "outer", .. })),
            "expected InactiveFace(outer); got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_not_coplanar() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        // Inner on Y-up plane (different normal)
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Y);

        let result = promote_circles_to_annulus(&mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::NotCoplanar { .. })),
            "expected NotCoplanar; got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_inner_not_contained_off_center() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        // Inner at (8, 0, 0) with radius 5 — center_distance 8 + radius 5 = 13 > outer.radius 10
        let inner = build_circle_face(&mut mesh, DVec3::new(8.0, 0.0, 0.0), 5.0, DVec3::Z);

        let result = promote_circles_to_annulus(&mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InnerNotContained { .. })),
            "expected InnerNotContained; got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_inner_larger_than_outer() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);
        // Inner radius 10 > outer radius 5
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);

        let result = promote_circles_to_annulus(&mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InnerNotContained { .. })),
            "expected InnerNotContained (inner > outer); got {:?}", result);
    }
}
