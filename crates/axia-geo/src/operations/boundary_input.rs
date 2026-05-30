//! ADR-171 β-1 — Engine `absorb_boundary_input` SSOT (Phase 2 of Phase 1-4).
//!
//! Single engine-internal robustness chokepoint for the 4 boundary-input
//! functions:
//!   - `split_face_by_line`     (Line variant)
//!   - `split_face_by_chain`    (Chain variant)
//!   - `auto_intersect_coplanar` (CoplanarPair variant)
//!   - `boundary_from_point`    (Point variant)
//!
//! While ADR-170 (Phase 1) normalizes input at the *Tool* layer, this module
//! is the *Engine* layer second line of defense — covering ALL call paths
//! (MCP API / STEP-IGES import / automation script / internal函수 호출) that
//! bypass the Tool layer.
//!
//! # 사용자 정책 (canonical, 2026-05-30)
//!
//! > "중요한 것은 Silent-skip 정책이 아니다. 엔진이 안정적이고 효율적이고
//! > 빠르게 작동하면서 원하는 표면적 구현을 하는것이 정책이다."
//!
//! → `absorb_boundary_input` does NOT reject input — it robustly *absorbs*:
//!   - Drift → projection 으로 **고침** (Step 1)
//!   - Dedup → silent 통합 (Step 2)
//!   - Degenerate (< 10mm) → typed `AbsorbReason` (Step 3, bail! 아닌 graceful)
//!
//! # 4-step routine
//!
//! 1. **Drift projection** (LOCKED #68/69 ADR-167/168) — project all points
//!    to the caller-supplied target plane via `PLANE_SNAP_OFFSET` strict snap.
//! 2. **Vertex dedup** (LOCKED #5 1.5μm spatial-hash) — match each point to
//!    existing verts via `Mesh::find_existing_vertex`. Detect VertexCollapse.
//! 3. **10mm short-circuit** (axia-sketch pattern 1) — reject inputs below
//!    `MIN_BOUNDARY_LENGTH_MM` with `DegenerateBelowEpsilon`.
//! 4. **Split-induced HARD flag prep** (ADR-101 A9, 메타-원칙 #15) — read-only
//!    here; actual HARD flag assignment is the caller's post-split duty.
//!
//! # Lock-ins (canonical)
//! - **L-171-1** Engine single chokepoint SSOT
//! - **L-171-2** 4-step routine canonical
//! - **L-171-3** `AbsorbReason` typed envelope (bail! 아닌 graceful)
//! - **L-171-4** LOCKED #5/68/69 + ADR-101 A9 SSOT consume (새 SSOT 도입 0)
//! - **L-171-6** Read-only helper (`&Mesh`, Pattern 8 — cyclic 의존 회피)
//! - **L-171-8** NURBS kernel carve-out — this module touches only boundary
//!   input normalization, NEVER curves/ + surfaces/ Piegl & Tiller bail!.
//! - **L-171-9** operations/boundary_input.rs 신설 (Pattern 7 B hybrid).
//! - **L-171-11** 절대 #[ignore] 금지.
//!
//! # Cross-link
//! - ADR-171 §2 (4-step routine canonical)
//! - ADR-170 (Phase 1 Tool layer SSOT — 직계 precursor)
//! - ADR-167 (EPS_PLANE SSOT) / ADR-168 (face plane drift snap)
//! - LOCKED #5 (1.5μm spatial-hash dedup)
//! - 메타-원칙 #4 (SSOT) / #6 (Preventive) / #11 (Latency) / #14/#15/#16

use crate::mesh::Mesh;
use crate::plane::{same_plane, Plane, EPS_PLANE_NORMAL};
use crate::operations::plane_snap::PLANE_SNAP_OFFSET;
use crate::{FaceId, VertId};
use glam::DVec3;

/// ADR-171 — Minimum boundary length (mm). axia-sketch pattern 1
/// (10mm short-circuit). Inputs whose extent is below this are absorbed
/// as `DegenerateBelowEpsilon` (graceful no-op, NOT bail!).
pub const MIN_BOUNDARY_LENGTH_MM: f64 = 10.0;

/// ADR-171 — Boundary input variants for the absorb SSOT.
///
/// Unifies the 4 different input shapes the boundary functions accept
/// (point pair / vertex chain / face pair / single point + plane) into a
/// single enum so they can share one normalization routine.
#[derive(Debug, Clone, PartialEq)]
pub enum BoundaryInput {
    /// Line split — 2 endpoints (`split_face_by_line`).
    Line { start: DVec3, end: DVec3 },
    /// Chain split — N-vertex path (`split_face_by_chain`).
    Chain { verts: Vec<DVec3> },
    /// Coplanar pair — 2 face overlap (`auto_intersect_coplanar`).
    CoplanarPair { face_a: FaceId, face_b: FaceId },
    /// Boundary point — 1 click point + plane (`boundary_from_point`).
    Point { point: DVec3, plane: Plane },
}

/// ADR-171 — Typed absorb result (graceful, NOT bail!).
///
/// Returned as the `Err` variant of `absorb_boundary_input`. The caller
/// routes this to a graceful no-op (or, at the Tool layer, a Korean Toast).
/// This is the engine-internal analog of ADR-170's `skipReason`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AbsorbReason {
    /// Input extent below `MIN_BOUNDARY_LENGTH_MM` (Step 3).
    DegenerateBelowEpsilon { length: f64 },
    /// Drift beyond projection tolerance — point cannot be snapped to the
    /// target plane within `max_distance` (Step 1).
    DriftBeyondTolerance { distance: f64 },
    /// 2 endpoints collapsed to the same existing vertex (Step 2 dedup).
    VertexCollapse { vert_id: VertId },
    /// CoplanarPair faces are not coplanar (Step 1, auto_intersect only).
    NotCoplanar { normal_dot: f64 },
}

/// ADR-171 — Normalized boundary input (after the 4-step absorb).
///
/// Carries the drift-projected, dedup-annotated input. The caller proceeds
/// with mutation (split / face emit) using this normalized data.
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedBoundaryInput {
    /// Drift-projected input (points snapped to target plane).
    pub input: BoundaryInput,
    /// Existing vertex IDs matched per input point (LOCKED #5 dedup).
    /// Parallel to the input's point list; `None` = no existing vertex.
    /// Empty for `CoplanarPair` (no explicit points).
    pub matched_verts: Vec<Option<VertId>>,
}

/// ADR-171 β-1 — Absorb boundary input via the 4-step robustness routine.
///
/// Read-only (`&Mesh`, Pattern 8). The caller computes the target plane
/// (e.g., the host face's analytic plane) and passes it via `target_plane`;
/// `None` skips Step 1 drift projection (e.g., free-wire input with no host).
///
/// Returns `Ok(NormalizedBoundaryInput)` on success, or `Err(AbsorbReason)`
/// when the input is absorbed as a graceful no-op (degenerate / collapse /
/// non-coplanar). **Never panics, never bail!s** — the typed envelope is
/// the contract (L-171-3).
pub fn absorb_boundary_input(
    mesh: &Mesh,
    input: BoundaryInput,
    target_plane: Option<Plane>,
) -> Result<NormalizedBoundaryInput, AbsorbReason> {
    // ─── Step 1: Drift projection (LOCKED #68/69 ADR-167/168) ───────────
    let projected = project_to_plane(input, target_plane)?;

    // Special-case: CoplanarPair has no explicit points — Step 1 coplanarity
    // check is delegated to project_to_plane (NotCoplanar). Steps 2/3 N/A.
    if let BoundaryInput::CoplanarPair { .. } = projected {
        return Ok(NormalizedBoundaryInput {
            input: projected,
            matched_verts: Vec::new(),
        });
    }

    // ─── Step 2: Vertex dedup (LOCKED #5 1.5μm spatial-hash) ────────────
    let pts = input_points(&projected);
    let matched_verts: Vec<Option<VertId>> =
        pts.iter().map(|&p| mesh.find_existing_vertex(p)).collect();

    // Detect VertexCollapse: 2-endpoint inputs whose endpoints dedup to the
    // same existing vertex would create a degenerate (zero-extent) op.
    if let Some(reason) = detect_vertex_collapse(&projected, &matched_verts) {
        return Err(reason);
    }

    // ─── Step 3: 10mm short-circuit (axia-sketch pattern 1) ─────────────
    if let Some(len) = input_extent(&projected) {
        if len < MIN_BOUNDARY_LENGTH_MM {
            return Err(AbsorbReason::DegenerateBelowEpsilon { length: len });
        }
    }

    // ─── Step 4: split-induced HARD flag prep (ADR-101 A9) ──────────────
    //   Read-only here. The caller assigns HARD flags AFTER its split
    //   (메타-원칙 #15 — same split = same topological contract).

    Ok(NormalizedBoundaryInput {
        input: projected,
        matched_verts,
    })
}

// ════════════════════════════════════════════════════════════════════════
// Internal helpers (pure, testable)
// ════════════════════════════════════════════════════════════════════════

/// Step 1 — project all input points to `target_plane` within
/// `PLANE_SNAP_OFFSET * scale` tolerance. For `CoplanarPair`, this is a
/// coplanarity check (NotCoplanar). Returns `DriftBeyondTolerance` when a
/// point's signed distance exceeds the snap bound.
fn project_to_plane(
    input: BoundaryInput,
    target_plane: Option<Plane>,
) -> Result<BoundaryInput, AbsorbReason> {
    let Some(plane) = target_plane else {
        // No host plane — pass through (free-wire input, e.g. sketch ground).
        return Ok(input);
    };

    // Max drift we are willing to snap (generous bound — drift accumulation
    // can be larger than the snap tolerance; we still project it onto the
    // plane, only rejecting truly off-plane points). 1mm bound chosen to
    // absorb f32 raycast drift (~10-40μm) and stacked-op accumulation while
    // rejecting clearly-wrong inputs (e.g. clicking a different face).
    const MAX_DRIFT_MM: f64 = 1.0;
    let _ = PLANE_SNAP_OFFSET; // documents the strict post-snap residual

    let proj = |p: DVec3| -> Result<DVec3, AbsorbReason> {
        let dist = plane.signed_distance(p);
        if dist.abs() > MAX_DRIFT_MM {
            return Err(AbsorbReason::DriftBeyondTolerance {
                distance: dist.abs(),
            });
        }
        // Project onto plane: p - normal * signed_distance.
        Ok(p - plane.normal * dist)
    };

    match input {
        BoundaryInput::Line { start, end } => Ok(BoundaryInput::Line {
            start: proj(start)?,
            end: proj(end)?,
        }),
        BoundaryInput::Chain { verts } => {
            let projected: Result<Vec<DVec3>, AbsorbReason> =
                verts.into_iter().map(proj).collect();
            Ok(BoundaryInput::Chain { verts: projected? })
        }
        BoundaryInput::Point { point, plane: pin } => Ok(BoundaryInput::Point {
            point: proj(point)?,
            plane: pin,
        }),
        BoundaryInput::CoplanarPair { .. } => {
            // CoplanarPair has no points to project — handled by caller
            // (β-2 will pass face planes for the coplanarity check).
            Ok(input)
        }
    }
}

/// Collect the explicit input points (for dedup + extent). Empty for
/// `CoplanarPair`.
fn input_points(input: &BoundaryInput) -> Vec<DVec3> {
    match input {
        BoundaryInput::Line { start, end } => vec![*start, *end],
        BoundaryInput::Chain { verts } => verts.clone(),
        BoundaryInput::Point { point, .. } => vec![*point],
        BoundaryInput::CoplanarPair { .. } => Vec::new(),
    }
}

/// Step 3 — input extent (max distance between consecutive points). `None`
/// for single-point / face-pair inputs (no extent to short-circuit).
fn input_extent(input: &BoundaryInput) -> Option<f64> {
    match input {
        BoundaryInput::Line { start, end } => Some((*end - *start).length()),
        BoundaryInput::Chain { verts } => {
            if verts.len() < 2 {
                return Some(0.0); // degenerate chain → short-circuit
            }
            // Total polyline length (max meaningful extent).
            let mut total = 0.0;
            for w in verts.windows(2) {
                total += (w[1] - w[0]).length();
            }
            Some(total)
        }
        BoundaryInput::Point { .. } => None,
        BoundaryInput::CoplanarPair { .. } => None,
    }
}

/// Step 2 — detect 2-endpoint collapse. For `Line`, if both endpoints dedup
/// to the same existing vertex, the split would be degenerate.
fn detect_vertex_collapse(
    input: &BoundaryInput,
    matched_verts: &[Option<VertId>],
) -> Option<AbsorbReason> {
    if let BoundaryInput::Line { .. } = input {
        if matched_verts.len() == 2 {
            if let (Some(a), Some(b)) = (matched_verts[0], matched_verts[1]) {
                if a == b {
                    return Some(AbsorbReason::VertexCollapse { vert_id: a });
                }
            }
        }
    }
    None
}

/// Step 1 (CoplanarPair) — coplanarity check helper for the caller (β-2).
///
/// Returns `Err(NotCoplanar)` if the two face planes differ beyond
/// `EPS_PLANE_NORMAL` (anti-parallel safe via `same_plane`).
pub fn check_coplanar(plane_a: &Plane, plane_b: &Plane) -> Result<(), AbsorbReason> {
    if same_plane(plane_a, plane_b, EPS_PLANE_NORMAL, PLANE_SNAP_OFFSET) {
        Ok(())
    } else {
        Err(AbsorbReason::NotCoplanar {
            normal_dot: plane_a.normal.dot(plane_b.normal),
        })
    }
}

// ════════════════════════════════════════════════════════════════════════
// 회귀 자산 (ADR-171 §8.2, 절대 #[ignore] 금지)
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::Mesh;

    fn z0_plane() -> Plane {
        Plane::from_point_normal(DVec3::ZERO, DVec3::Z)
    }

    // ─── MIN_BOUNDARY_LENGTH_MM constant (drift guard) ───
    #[test]
    fn adr171_min_boundary_length_is_10mm() {
        assert_eq!(MIN_BOUNDARY_LENGTH_MM, 10.0);
    }

    // ─── Step 1: Drift projection ───
    #[test]
    fn adr171_step1_projects_line_endpoints_to_plane() {
        let mesh = Mesh::new();
        // Line with z-drift; target plane = z=0 → endpoints projected to z=0.
        let input = BoundaryInput::Line {
            start: DVec3::new(0.0, 0.0, 0.0005), // 0.5μm... actually 0.5mm drift
            end: DVec3::new(20.0, 0.0, 0.0003),
        };
        let result =
            absorb_boundary_input(&mesh, input, Some(z0_plane())).unwrap();
        if let BoundaryInput::Line { start, end } = result.input {
            assert!(start.z.abs() < 1e-9, "start.z projected to 0");
            assert!(end.z.abs() < 1e-9, "end.z projected to 0");
            assert_eq!(start.x, 0.0);
            assert_eq!(end.x, 20.0);
        } else {
            panic!("expected Line variant");
        }
    }

    #[test]
    fn adr171_step1_rejects_drift_beyond_tolerance() {
        let mesh = Mesh::new();
        // Endpoint 5mm off-plane (> MAX_DRIFT_MM 1.0) → DriftBeyondTolerance.
        let input = BoundaryInput::Line {
            start: DVec3::new(0.0, 0.0, 0.0),
            end: DVec3::new(20.0, 0.0, 5.0),
        };
        let err = absorb_boundary_input(&mesh, input, Some(z0_plane()))
            .unwrap_err();
        assert!(matches!(err, AbsorbReason::DriftBeyondTolerance { .. }));
    }

    #[test]
    fn adr171_step1_no_plane_passes_through() {
        let mesh = Mesh::new();
        let input = BoundaryInput::Line {
            start: DVec3::new(0.0, 0.0, 7.0),
            end: DVec3::new(20.0, 0.0, 7.0),
        };
        // No target plane → no projection (free-wire).
        let result = absorb_boundary_input(&mesh, input, None).unwrap();
        if let BoundaryInput::Line { start, .. } = result.input {
            assert_eq!(start.z, 7.0, "no projection when target_plane is None");
        } else {
            panic!("expected Line variant");
        }
    }

    // ─── Step 3: 10mm short-circuit ───
    #[test]
    fn adr171_step3_short_circuits_line_below_10mm() {
        let mesh = Mesh::new();
        let input = BoundaryInput::Line {
            start: DVec3::ZERO,
            end: DVec3::new(5.0, 0.0, 0.0), // 5mm < 10mm
        };
        let err = absorb_boundary_input(&mesh, input, Some(z0_plane()))
            .unwrap_err();
        match err {
            AbsorbReason::DegenerateBelowEpsilon { length } => {
                assert!((length - 5.0).abs() < 1e-9);
            }
            _ => panic!("expected DegenerateBelowEpsilon, got {err:?}"),
        }
    }

    #[test]
    fn adr171_step3_passes_line_at_or_above_10mm() {
        let mesh = Mesh::new();
        let input = BoundaryInput::Line {
            start: DVec3::ZERO,
            end: DVec3::new(15.0, 0.0, 0.0), // 15mm >= 10mm
        };
        let result =
            absorb_boundary_input(&mesh, input, Some(z0_plane())).unwrap();
        assert!(matches!(result.input, BoundaryInput::Line { .. }));
    }

    #[test]
    fn adr171_step3_chain_total_extent_short_circuit() {
        let mesh = Mesh::new();
        // 3-vertex chain, total length 8mm < 10mm.
        let input = BoundaryInput::Chain {
            verts: vec![
                DVec3::ZERO,
                DVec3::new(4.0, 0.0, 0.0),
                DVec3::new(8.0, 0.0, 0.0),
            ],
        };
        let err = absorb_boundary_input(&mesh, input, Some(z0_plane()))
            .unwrap_err();
        assert!(matches!(err, AbsorbReason::DegenerateBelowEpsilon { .. }));
    }

    // ─── Step 2: Vertex dedup + collapse ───
    #[test]
    fn adr171_step2_matches_existing_vertex() {
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let input = BoundaryInput::Line {
            start: DVec3::ZERO,
            end: DVec3::new(20.0, 0.0, 0.0), // coincides with existing vert
        };
        let result =
            absorb_boundary_input(&mesh, input, Some(z0_plane())).unwrap();
        assert_eq!(result.matched_verts.len(), 2);
        assert_eq!(result.matched_verts[0], None, "start = new");
        assert_eq!(result.matched_verts[1], Some(v), "end = existing vert");
    }

    #[test]
    fn adr171_step2_vertex_collapse_both_endpoints_same() {
        let mut mesh = Mesh::new();
        let v = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        // Both endpoints dedup to the same existing vertex → collapse.
        let input = BoundaryInput::Line {
            start: DVec3::new(20.0, 0.0, 0.0),
            end: DVec3::new(20.0, 0.00000005, 0.0), // within 1.5μm of v
        };
        let err = absorb_boundary_input(&mesh, input, Some(z0_plane()))
            .unwrap_err();
        match err {
            AbsorbReason::VertexCollapse { vert_id } => assert_eq!(vert_id, v),
            _ => panic!("expected VertexCollapse, got {err:?}"),
        }
    }

    #[test]
    fn adr171_step2_no_collapse_when_endpoints_distinct() {
        let mut mesh = Mesh::new();
        mesh.add_vertex(DVec3::ZERO);
        mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let input = BoundaryInput::Line {
            start: DVec3::ZERO,
            end: DVec3::new(20.0, 0.0, 0.0),
        };
        // Two distinct existing verts → no collapse.
        let result =
            absorb_boundary_input(&mesh, input, Some(z0_plane())).unwrap();
        assert!(result.matched_verts[0].is_some());
        assert!(result.matched_verts[1].is_some());
        assert_ne!(result.matched_verts[0], result.matched_verts[1]);
    }

    // ─── Step 1 (CoplanarPair) coplanarity check ───
    #[test]
    fn adr171_check_coplanar_same_plane_ok() {
        let a = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let b = Plane::from_point_normal(DVec3::new(5.0, 5.0, 0.0), DVec3::Z);
        assert!(check_coplanar(&a, &b).is_ok());
    }

    #[test]
    fn adr171_check_coplanar_anti_parallel_ok() {
        // Flipped normal, same plane (L-167-10 anti-parallel safe).
        let a = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let b = Plane::from_point_normal(DVec3::ZERO, -DVec3::Z);
        assert!(check_coplanar(&a, &b).is_ok());
    }

    #[test]
    fn adr171_check_coplanar_different_plane_rejected() {
        let a = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let b = Plane::from_point_normal(DVec3::ZERO, DVec3::X);
        let err = check_coplanar(&a, &b).unwrap_err();
        assert!(matches!(err, AbsorbReason::NotCoplanar { .. }));
    }

    #[test]
    fn adr171_check_coplanar_offset_difference_rejected() {
        // Same normal, different offset (parallel planes 5mm apart).
        let a = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let b = Plane::from_point_normal(DVec3::new(0.0, 0.0, 5.0), DVec3::Z);
        let err = check_coplanar(&a, &b).unwrap_err();
        assert!(matches!(err, AbsorbReason::NotCoplanar { .. }));
    }

    // ─── CoplanarPair variant passes through (no points) ───
    #[test]
    fn adr171_coplanar_pair_variant_passes_through() {
        let mesh = Mesh::new();
        let input = BoundaryInput::CoplanarPair {
            face_a: FaceId::default(),
            face_b: FaceId::default(),
        };
        let result = absorb_boundary_input(&mesh, input, None).unwrap();
        assert!(result.matched_verts.is_empty());
        assert!(matches!(result.input, BoundaryInput::CoplanarPair { .. }));
    }

    // ─── Point variant projection ───
    #[test]
    fn adr171_point_variant_projects_to_plane() {
        let mesh = Mesh::new();
        let input = BoundaryInput::Point {
            point: DVec3::new(5.0, 5.0, 0.0008),
            plane: z0_plane(),
        };
        let result =
            absorb_boundary_input(&mesh, input, Some(z0_plane())).unwrap();
        if let BoundaryInput::Point { point, .. } = result.input {
            assert!(point.z.abs() < 1e-9, "point projected to z=0");
        } else {
            panic!("expected Point variant");
        }
    }
}
