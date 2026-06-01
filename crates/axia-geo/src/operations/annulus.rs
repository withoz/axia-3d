//! ADR-145 — Circle Annulus 명시 활성 (옵션 B).
//!
//! Circle 두 별개 face → 사용자 명시 trigger ("annulus 만들기" 우클릭)
//! 시 outer face 의 hole 로 inner Circle 명시 promote.
//!
//! **메타-원칙 #16 정합**: 휴리스틱 자동 annulus promote 폐기, 사용자
//! 명시 의도 canonical. ADR-139 (Boundary tool 명시) pattern 1:1 mirror.
//!
//! # β-1+ scope (current commit — promote logic 활성)
//!
//! - `AnnulusError` enum (4 variant — validation only, PromoteLogicDeferred 제거)
//! - `promote_circles_to_annulus(&mut Mesh, ...)` — 4 validation +
//!   promote logic full implementation
//!
//! Validation 4단계:
//! 1. outer + inner 둘 다 active face
//! 2. 둘 다 closed-curve Circle face (outer loop = 1 self-loop edge with
//!    `AnalyticCurve::Circle`)
//! 3. outer + inner coplanar (normal parallel + 같은 plane 식 정합)
//! 4. inner Circle fully contained in outer Circle (center distance +
//!    inner.radius <= outer.radius)
//!
//! Promote logic (`create_solid.rs` annulus_face pattern 1:1 답습):
//! 1. inner face 의 outer LoopRef + HEs collect
//! 2. HEs reparent (face pointer → outer_face_id, set_outer(false))
//! 3. outer face 에 `add_inner(inner_outer_loop)` 호출
//! 4. inner face `set_active(false)` (HE/edge/vert 보존)
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

use crate::entities::LoopRef;
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
        }
    }
}

impl std::error::Error for AnnulusError {}

// ADR-167 β-3 — `COPLANAR_TOL` alias removed; callsite now imports
// `crate::plane::EPS_PLANE_OFFSET` directly (canonical SSOT, 1.5μm,
// LOCKED #5 spatial-hash dedup). Pre-β-3 alias was `const COPLANAR_TOL:
// f64 = crate::plane::EPS_PLANE_OFFSET;` — identical value, redundant
// indirection sunset.
/// Normal direction parity tolerance (parallel — 1 - |dot| < 1e-6 = nearly parallel).
///
/// ADR-167 β-2 — *Stricter than* canonical `EPS_PLANE_NORMAL` (1e-4) —
/// annulus inherits its inner circle's plane via Plane attach, so the
/// parity check tolerates only numerical drift (1e-6), not modeling
/// slop. Preserved per-call override (L-167-3 "Per-call tolerance
/// overrides").
const NORMAL_PARITY_TOL: f64 = 1e-6;

/// ADR-145 — Circle annulus 명시 promote.
///
/// 두 coplanar Circle face (outer + inner) 를 annulus (outer with
/// inner hole) 로 명시 promote. inner face deactivate.
///
/// **사용자 명시 trigger only** (메타-원칙 #16) — 휴리스틱 자동 detect
/// 안 됨. ContextMenu "annulus 만들기" 우클릭 후 호출 (β-4).
///
/// # β-1+ scope (current — promote logic 활성)
///
/// Validation 4단계 + promote logic full implementation. `create_solid.rs`
/// 의 annulus_face 패턴 1:1 답습 — HE reparent (set_face/set_outer) +
/// outer face `add_inner(LoopRef)` + inner face deactivate.
///
/// # Errors
///
/// - `InactiveFace` — outer 또는 inner active 아님
/// - `NotCircleFace` — outer 또는 inner 가 closed-curve Circle 아님
/// - `NotCoplanar` — 다른 평면
/// - `InnerNotContained` — inner Circle 이 outer 안 contained 안 됨
pub fn promote_circles_to_annulus(
    mesh: &mut Mesh,
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
    // ADR-167 β-3 — canonical SSOT (EPS_PLANE_OFFSET = 1.5μm).
    if plane_distance > crate::plane::EPS_PLANE_OFFSET {
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

    // === Promote logic (β-1+ — create_solid.rs annulus_face pattern 1:1 답습) ===

    // 1. Collect inner face 의 outer loop HEs (Circle face = 1 self-loop HE)
    //    Validation 2 (extract_circle) 가 이미 보장 — collect_loop_hes safe.
    let inner_outer_start = mesh.faces[inner_face].outer().start;
    let hes = mesh.collect_loop_hes(inner_outer_start)
        .expect("ADR-145 β-1+: validation 2 (Circle face) guarantees collect_loop_hes OK");

    // 2. Get inner outer LoopRef (Copy — LoopRef is small struct)
    let inner_outer_loop = mesh.faces[inner_face].outer();

    // 3. Reparent HEs (face pointer → outer_face_id, set_outer(false))
    //    create_solid.rs:917-928 pattern 답습.
    for he_id in &hes {
        mesh.hes[*he_id].set_face(outer_face);
        mesh.hes[*he_id].set_outer(false);  // 이제 inner loop (hole)
    }

    // 4. Add inner loop to outer face (Face::add_inner — ADR-061 Step 2:
    //    bumps boundary_version + invalidates normal_cache)
    mesh.faces[outer_face].add_inner(inner_outer_loop);

    // 5. Deactivate inner face (HE/edge/vert 보존 — manifold safe).
    //    inner face 의 outer LoopRef 가 outer face 의 inner 로 reparent 된
    //    상태이므로 inner face 자체는 dangling outer ref 가 있으나 inactive.
    mesh.faces[inner_face].set_active(false);

    Ok(())
}

/// ADR-185 — Circle containment → **ring + inner disk** (면분할).
///
/// `promote_circles_to_annulus` 와 달리 inner disk 를 **보존**한다. outer face
/// 를 ring 으로 (inner circle = hole) 만들되, inner face 는 disk 로 유지 →
/// 두 face (ring + disk). 사용자 "원 안에 원을 그려서 면분할" 의미.
///
/// 차이: annulus 는 inner 의 outer-loop HE (CCW) 를 reparent + inner deactivate
/// → ring + 빈 hole. ring+disk 는 inner edge 의 **twin HE** (CW, ring 측) 를
/// outer 의 hole 로 사용 → inner disk 의 HE (CCW) 와 분리, inner 유지. edge 는
/// 2 face-bearing HE (disk + ring) → manifold.
pub fn split_face_by_inner_circle(
    mesh: &mut Mesh,
    outer_face: FaceId,
    inner_face: FaceId,
) -> Result<(), AnnulusError> {
    // === Validation 1: outer + inner active ===
    let outer = mesh.faces.get(outer_face).ok_or(AnnulusError::InactiveFace {
        face_id: outer_face.raw(),
        role: "outer",
    })?;
    if !outer.is_active() {
        return Err(AnnulusError::InactiveFace { face_id: outer_face.raw(), role: "outer" });
    }
    let inner = mesh.faces.get(inner_face).ok_or(AnnulusError::InactiveFace {
        face_id: inner_face.raw(),
        role: "inner",
    })?;
    if !inner.is_active() {
        return Err(AnnulusError::InactiveFace { face_id: inner_face.raw(), role: "inner" });
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

    // === Validation 3: coplanar ===
    let n_outer = outer_circle.normal.normalize_or_zero();
    let n_inner = inner_circle.normal.normalize_or_zero();
    if (1.0 - n_outer.dot(n_inner).abs()) > NORMAL_PARITY_TOL {
        return Err(AnnulusError::NotCoplanar {
            outer_normal: n_outer,
            inner_normal: n_inner,
            plane_distance: f64::INFINITY,
        });
    }
    let plane_distance = (inner_circle.center - outer_circle.center).dot(n_outer).abs();
    if plane_distance > crate::plane::EPS_PLANE_OFFSET {
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

    // === Ring + disk promote (inner disk 보존) ===
    // inner 의 outer-loop HE (HE1, CCW disk boundary).
    let he1 = mesh.faces[inner_face].outer().start;
    // twin HE (HE2, CW ring-side) via radial chain.
    let he2 = mesh.hes[he1].next_rad();
    if he2 == he1 || !mesh.hes.contains(he2) {
        // 2-manifold circle edge 면 twin 항상 존재 — 방어적 silent reject.
        return Err(AnnulusError::NotCircleFace { face_id: inner_face.raw(), role: "inner" });
    }
    // twin → outer face 의 hole 로 reparent.
    mesh.hes[he2].set_face(outer_face);
    mesh.hes[he2].set_outer(false);
    mesh.faces[outer_face].add_inner(LoopRef { start: he2, is_outer: false });
    // inner disk 는 active 유지 (HE1 그대로 inner face boundary).
    Ok(())
}

/// ADR-185 — 두 face 가 coplanar Circle 이고 한쪽이 다른쪽을 완전 포함하면
/// `(outer, inner)` 반환. partial overlap / disjoint / non-circle → `None`.
///
/// auto-draw 파이프라인의 containment 감지용 (Scene `intersect_faces_inner`
/// 의 `Ok(None)` 분기에서 사용 — auto_intersect_coplanar 가 partial overlap
/// 만 처리하므로 containment 는 본 helper + `split_face_by_inner_circle`).
pub fn detect_circle_containment(
    mesh: &Mesh,
    fid_a: FaceId,
    fid_b: FaceId,
) -> Option<(FaceId, FaceId)> {
    let ca = extract_circle(mesh, fid_a)?;
    let cb = extract_circle(mesh, fid_b)?;
    // coplanar (normal parallel + same plane).
    let na = ca.normal.normalize_or_zero();
    let nb = cb.normal.normalize_or_zero();
    if (1.0 - na.dot(nb).abs()) > NORMAL_PARITY_TOL {
        return None;
    }
    if (cb.center - ca.center).dot(na).abs() > crate::plane::EPS_PLANE_OFFSET {
        return None;
    }
    // containment: d + r_inner <= r_outer.
    let d = (cb.center - ca.center).length();
    if d + cb.radius <= ca.radius {
        Some((fid_a, fid_b)) // a = outer, b = inner
    } else if d + ca.radius <= cb.radius {
        Some((fid_b, fid_a)) // b = outer, a = inner
    } else {
        None // partial overlap or disjoint
    }
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
    fn adr145_beta1plus_promote_concentric_circles_succeeds() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        // Pre-promote state
        assert_eq!(mesh.faces[outer].inners().len(), 0,
            "Pre-promote: outer has no inner loops");
        assert!(mesh.faces[inner].is_active(), "Pre-promote: inner is active");

        // Promote
        let result = promote_circles_to_annulus(&mut mesh, outer, inner);
        assert!(result.is_ok(), "expected Ok; got {:?}", result);

        // Post-promote: outer has 1 inner loop (hole), inner face deactivated
        assert_eq!(mesh.faces[outer].inners().len(), 1,
            "Post-promote: outer has 1 inner loop (annulus hole)");
        assert!(!mesh.faces[inner].is_active(),
            "Post-promote: inner face is deactivated");
    }

    #[test]
    fn adr185_split_keeps_inner_disk_ring_plus_disk() {
        // ADR-185 — 원 안에 원 → ring + disk (면분할). annulus 와 달리 inner
        // disk 보존.
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        let result = split_face_by_inner_circle(&mut mesh, outer, inner);
        assert!(result.is_ok(), "expected Ok; got {:?}", result);

        // outer = ring (1 inner loop hole), inner = disk STILL ACTIVE.
        assert_eq!(mesh.faces[outer].inners().len(), 1, "outer has 1 hole (ring)");
        assert!(mesh.faces[outer].is_active(), "outer ring active");
        assert!(
            mesh.faces[inner].is_active(),
            "ADR-185: inner DISK kept active (vs annulus deactivates)"
        );
        // manifold preserved (edge has 2 face-bearing HEs: disk + ring hole).
        let report = mesh.verify_face_invariants();
        assert_eq!(
            report.violations.len(),
            0,
            "ADR-185: ring+disk manifold-safe; violations: {:?}",
            report.violations
        );
    }

    #[test]
    fn adr185_split_rejects_not_contained() {
        // inner 가 outer 밖이면 reject (silent skip 용).
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::new(20.0, 0.0, 0.0), 5.0, DVec3::Z);
        let result = split_face_by_inner_circle(&mut mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InnerNotContained { .. })),
            "expected InnerNotContained; got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_inactive_outer() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        // Deactivate outer
        mesh.faces[outer].set_active(false);

        let result = promote_circles_to_annulus(&mut mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InactiveFace { role: "outer", .. })),
            "expected InactiveFace(outer); got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_not_coplanar() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        // Inner on Y-up plane (different normal)
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Y);

        let result = promote_circles_to_annulus(&mut mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::NotCoplanar { .. })),
            "expected NotCoplanar; got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_inner_not_contained_off_center() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        // Inner at (8, 0, 0) with radius 5 — center_distance 8 + radius 5 = 13 > outer.radius 10
        let inner = build_circle_face(&mut mesh, DVec3::new(8.0, 0.0, 0.0), 5.0, DVec3::Z);

        let result = promote_circles_to_annulus(&mut mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InnerNotContained { .. })),
            "expected InnerNotContained; got {:?}", result);
    }

    #[test]
    fn adr145_beta1_rejects_inner_larger_than_outer() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);
        // Inner radius 10 > outer radius 5
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);

        let result = promote_circles_to_annulus(&mut mesh, outer, inner);
        assert!(matches!(result, Err(AnnulusError::InnerNotContained { .. })),
            "expected InnerNotContained (inner > outer); got {:?}", result);
    }

    /// ADR-145 β-1+ — annulus 가 manifold safe (verify_face_invariants 통과).
    /// promote 후 outer face 의 hole topology 가 LOCKED #1 P7 정합 검증.
    #[test]
    fn adr145_beta1plus_annulus_preserves_manifold_invariants() {
        let mut mesh = Mesh::new();
        let outer = build_circle_face(&mut mesh, DVec3::ZERO, 10.0, DVec3::Z);
        let inner = build_circle_face(&mut mesh, DVec3::ZERO, 5.0, DVec3::Z);

        promote_circles_to_annulus(&mut mesh, outer, inner).expect("promote OK");

        // ADR-145 L-145-8 — hole inheritance manifold-safe
        let report = mesh.verify_face_invariants();
        assert!(report.violations.is_empty(),
            "ADR-145 β-1+: annulus topology must preserve manifold invariants; \
             got {:?}", report.violations);
    }
}
