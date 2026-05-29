//! Canonical Plane SSOT for plane-equality predicates (ADR-167).
//!
//! Consolidates 6+ scattered plane-equality constants/conventions into a
//! single canonical module:
//! - `EPS_PLANE_NORMAL` — normal parallelism tolerance (dot product complement)
//! - `EPS_PLANE_OFFSET` — signed-distance offset tolerance (mm)
//! - `Plane { normal, offset }` — canonical plane representation
//! - `same_plane(a, b, eps_normal, eps_offset)` — equivalence predicate
//!   (anti-parallel safe, per L-167-10)
//!
//! # Lock-ins (canonical)
//! - **L-167-1** Module location: `axia-core/src/plane.rs` (mesh-free,
//!   accessible from axia-geo / axia-wasm / web TS callers).
//! - **L-167-2** 2-constant schema — normal vs offset semantically distinct.
//! - **L-167-3** Struct-based `Plane` + `same_plane(...)` helper.
//! - **L-167-6** ADR-147 Scenario B1 precision answer (1e-4 / 1.5e-3 mm).
//! - **L-167-7** LOCKED #5 (1.5μm spatial-hash dedup) natural anchor for offset.
//! - **L-167-8** 메타-원칙 #4 (SSOT) + #6 (Preventive over Curative).
//! - **L-167-10** Anti-parallel normal handling (flipped face = same plane).
//! - **L-167-11** 절대 #[ignore] 금지 — 회귀 자산 강제.
//!
//! # Cross-link
//! - ADR-167 §3 (Path Z atomic 5-step plan)
//! - ADR-147 (Spatial-hash precision strict, Scenario B1)
//! - LOCKED #5 (1.5μm spatial-hash dedup)
//! - LOCKED #43 priority sequence (b) → ADR-168 sequence anchor
//! - LOCKED #44 (Complete Meaning per Merge — Phase 1 additive only)
//! - 메타-원칙 #4 (SSOT) + #6 (Preventive) + #14 (면은 닫힌 경계로부터)

use glam::DVec3;

// ═══════════════════════════════════════════════════════════════════════
// Constants (canonical SSOT, ADR-167 Q2=a 2-constant schema)
// ═══════════════════════════════════════════════════════════════════════

/// Normal parallelism tolerance — `1.0 - |dot(a.normal, b.normal)|` threshold.
///
/// Default: `1e-4`. Matches legacy `axia-geo::tolerances::COPLANAR_TOLERANCE`
/// (1e-4) — natural SSOT anchor.
///
/// Anti-parallel normals (dot < 0) are also considered parallel
/// (see [`same_plane`] — flipped face = same plane, per L-167-10).
pub const EPS_PLANE_NORMAL: f64 = 1e-4;

/// Signed-distance offset tolerance — `|a.offset - b.offset|` threshold (mm).
///
/// Default: `1.5e-3` mm (1.5 μm). Matches LOCKED #5 spatial-hash dedup
/// (`SPATIAL_HASH_CELL * 1.5 = 1.5μm`) — natural SSOT anchor.
///
/// **Strict callers** (e.g., `axia-geo::operations::coplanar`) may pass
/// a smaller `eps_offset` (e.g., `1.5e-6` for strict coplanarity).
/// **Permissive callers** (e.g., `axia-geo::operations::annulus`) may
/// pass a larger value if needed.
pub const EPS_PLANE_OFFSET: f64 = 1.5e-3;

// ═══════════════════════════════════════════════════════════════════════
// Plane struct (canonical representation, ADR-167 Q3=a struct-based)
// ═══════════════════════════════════════════════════════════════════════

/// Canonical plane representation: normal vector + signed offset from origin.
///
/// **Convention**: `signed_distance(point) = normal.dot(point) - offset`.
/// A point lies on the plane iff `normal.dot(point) == offset`.
///
/// Normal is **always normalized** by `from_point_normal` (defensive).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Plane {
    /// Unit normal vector (always normalized by [`Plane::from_point_normal`]).
    pub normal: DVec3,
    /// Signed offset from world origin (i.e., `normal.dot(P)` for any point P on plane).
    pub offset: f64,
}

impl Plane {
    /// Construct a plane from a point on the plane and a (possibly non-unit)
    /// normal vector. The normal is normalized defensively.
    ///
    /// # Panics
    /// Does NOT panic on zero-length normal — returns `Plane { normal: DVec3::Z, offset: 0.0 }`
    /// (defensive fallback). Callers expecting non-degenerate planes should
    /// validate input first.
    #[inline]
    pub fn from_point_normal(point: DVec3, normal: DVec3) -> Self {
        let len = normal.length();
        let unit_normal = if len > f64::EPSILON {
            normal / len
        } else {
            // Defensive fallback for degenerate input — caller should validate
            DVec3::Z
        };
        Plane {
            normal: unit_normal,
            offset: unit_normal.dot(point),
        }
    }

    /// Signed distance from a point to this plane.
    ///
    /// Positive: point is on the side `normal` points toward.
    /// Negative: point is on the opposite side.
    /// Zero: point lies on the plane (up to numerical precision).
    #[inline]
    pub fn signed_distance(&self, point: DVec3) -> f64 {
        self.normal.dot(point) - self.offset
    }
}

// ═══════════════════════════════════════════════════════════════════════
// same_plane helper (canonical equivalence predicate)
// ═══════════════════════════════════════════════════════════════════════

/// Test whether two planes are geometrically equivalent within tolerances.
///
/// **Anti-parallel safe** (L-167-10): two planes with flipped normals are
/// considered the same plane, *as long as their signed offsets are also
/// flipped*. This is the natural semantic for face plane equality
/// regardless of winding direction.
///
/// # Algorithm
/// 1. `parallel = |dot(a.normal, b.normal)| > 1.0 - eps_normal`
/// 2. If `dot >= 0`: `offset_diff = |a.offset - b.offset|`
///    Else: `offset_diff = |a.offset + b.offset|` (flipped normal → flipped offset)
/// 3. `offset_match = offset_diff < eps_offset`
/// 4. Return `parallel && offset_match`
///
/// # Per-call tolerance overrides
/// Callers may pass `eps_normal = EPS_PLANE_NORMAL` and `eps_offset =
/// EPS_PLANE_OFFSET` for default behavior, or override for strict/permissive
/// callsites (e.g., `axia-geo::operations::coplanar` uses `1.5e-6` offset).
#[inline]
pub fn same_plane(a: &Plane, b: &Plane, eps_normal: f64, eps_offset: f64) -> bool {
    let dot = a.normal.dot(b.normal);
    let parallel = dot.abs() > (1.0 - eps_normal);
    if !parallel {
        return false;
    }
    let offset_diff = if dot >= 0.0 {
        (a.offset - b.offset).abs()
    } else {
        (a.offset + b.offset).abs()
    };
    offset_diff < eps_offset
}

// ═══════════════════════════════════════════════════════════════════════
// 회귀 자산 (ADR-167 §6, 절대 #[ignore] 금지 6/6 강제)
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    /// Q2=a default — `EPS_PLANE_NORMAL = 1e-4` (matches legacy
    /// COPLANAR_TOLERANCE). Drift guard.
    #[test]
    fn adr167_eps_plane_normal_default_value() {
        assert_eq!(EPS_PLANE_NORMAL, 1e-4);
    }

    /// Q2=a default — `EPS_PLANE_OFFSET = 1.5e-3` mm (matches LOCKED #5
    /// spatial-hash dedup 1.5μm). Drift guard.
    #[test]
    fn adr167_eps_plane_offset_default_value() {
        assert_eq!(EPS_PLANE_OFFSET, 1.5e-3);
    }

    /// Q3=a `Plane::from_point_normal` round-trip — point lies on
    /// constructed plane (signed_distance ≈ 0). Normal is normalized.
    #[test]
    fn adr167_plane_struct_from_point_normal_round_trip() {
        let point = DVec3::new(1.0, 2.0, 3.0);
        let normal = DVec3::new(0.0, 0.0, 2.0); // not unit — should be normalized
        let plane = Plane::from_point_normal(point, normal);

        // Normal is normalized
        assert!((plane.normal.length() - 1.0).abs() < 1e-10);
        assert_eq!(plane.normal, DVec3::Z);

        // Point lies on plane
        assert!(plane.signed_distance(point).abs() < 1e-10);

        // Offset = normal · point = 1.0 * 3.0 = 3.0
        assert!((plane.offset - 3.0).abs() < 1e-10);
    }

    /// Q3=a `same_plane` — identical planes (parallel, same offset) → true.
    #[test]
    fn adr167_same_plane_identical_parallel_no_offset_diff() {
        let p = DVec3::new(0.0, 0.0, 5.0);
        let n = DVec3::Z;
        let a = Plane::from_point_normal(p, n);
        let b = Plane::from_point_normal(p, n);
        assert!(same_plane(&a, &b, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));
    }

    /// Q3=a L-167-10 evidence — anti-parallel normal handling.
    /// Two planes with flipped normals (and correspondingly flipped offset)
    /// represent the same physical plane and must compare as same_plane.
    #[test]
    fn adr167_same_plane_anti_parallel_flipped_normal_same_plane() {
        let p = DVec3::new(0.0, 0.0, 5.0);
        let a = Plane::from_point_normal(p, DVec3::Z);    // normal +Z, offset +5
        let b = Plane::from_point_normal(p, -DVec3::Z);   // normal -Z, offset -5
        // Flipped normal + flipped offset = same physical plane
        assert!(same_plane(&a, &b, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));

        // Sanity check: signed_distance evidence
        assert_eq!(a.offset, 5.0);
        assert_eq!(b.offset, -5.0);  // -Z · (0,0,5) = -5
    }

    /// Q3=a — Offset within eps_offset → planes still equivalent
    /// (numerical drift tolerance).
    #[test]
    fn adr167_same_plane_offset_diff_within_eps_passes() {
        let a = Plane::from_point_normal(DVec3::new(0.0, 0.0, 5.0), DVec3::Z);
        let b = Plane::from_point_normal(
            DVec3::new(0.0, 0.0, 5.0 + 0.5e-3),  // within 1.5e-3 eps
            DVec3::Z,
        );
        assert!(same_plane(&a, &b, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));

        // Outside eps_offset → not same
        let c = Plane::from_point_normal(
            DVec3::new(0.0, 0.0, 5.0 + 2e-3),  // beyond 1.5e-3 eps
            DVec3::Z,
        );
        assert!(!same_plane(&a, &c, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));
    }

    /// Edge cases — different normal (not parallel) → false regardless
    /// of offset. Degenerate (zero-length normal) → defensive fallback.
    #[test]
    fn adr167_same_plane_edge_cases() {
        // Perpendicular normals → not same plane
        let a = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let b = Plane::from_point_normal(DVec3::ZERO, DVec3::X);
        assert!(!same_plane(&a, &b, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));

        // 45° tilt → not parallel within 1e-4
        let tilted = Plane::from_point_normal(
            DVec3::ZERO,
            DVec3::new(0.0, 1.0, 1.0),  // 45° from +Z
        );
        assert!(!same_plane(&a, &tilted, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET));

        // Degenerate input — defensive fallback (DVec3::Z, offset 0)
        let degenerate = Plane::from_point_normal(DVec3::ZERO, DVec3::ZERO);
        assert_eq!(degenerate.normal, DVec3::Z);
        assert_eq!(degenerate.offset, 0.0);
    }
}
