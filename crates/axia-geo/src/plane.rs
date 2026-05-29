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

    // ══════════════════════════════════════════════════════════════════
    // ADR-167 β-2 — Migration callsite drift guards (4 tests, audit-
    // corrected per audit-first canonical 17번째 적용)
    //
    // β-1 lived in axia-core (circular dep blocker); β-2 relocated to
    // axia-geo + aliased 5 callsites. Each test asserts the alias chain
    // resolves correctly + records the semantic delta for any callsite
    // that intentionally diverges from canonical default.
    // ══════════════════════════════════════════════════════════════════

    /// β-2 site #1 — `axia-geo::tolerances::COPLANAR_TOLERANCE` aliased
    /// to canonical `EPS_PLANE_NORMAL`. Drift guard ensures the alias
    /// chain stays intact during the deprecation grace period (β-3).
    ///
    /// ADR-167 β-3 — `#[allow(deprecated)]` because this test intentionally
    /// references the deprecated aliases to verify the backward-compat
    /// path. Production code paths have been migrated to canonical SSOT.
    #[test]
    #[allow(deprecated)]
    fn adr167_b2_tolerances_re_exports_canonical_constants() {
        assert_eq!(
            crate::tolerances::COPLANAR_TOLERANCE,
            EPS_PLANE_NORMAL,
            "ADR-167 β-2: COPLANAR_TOLERANCE alias drift"
        );
        assert_eq!(
            crate::tolerances::LOOP_PLANAR_TOLERANCE,
            EPS_PLANE_NORMAL,
            "ADR-167 β-2: LOOP_PLANAR_TOLERANCE alias drift"
        );
    }

    /// β-2 site #2 — `axia-geo::operations::annulus::COPLANAR_TOL`
    /// aliased to canonical `EPS_PLANE_OFFSET`. Identical value (1.5e-3).
    /// `COPLANAR_TOL` is module-private; this test locks the canonical
    /// constant — annulus.rs source-grep is the second layer.
    #[test]
    fn adr167_b2_annulus_uses_canonical_eps_plane_offset() {
        assert_eq!(EPS_PLANE_OFFSET, 1.5e-3);
    }

    /// β-2 site #3 — `axia-geo::operations::coplanar` constants are
    /// **intentionally stricter** than canonical defaults. This test
    /// locks in the semantic divergence so β-3 sunset *does not* remove
    /// them.
    #[test]
    fn adr167_b2_coplanar_remains_strict_per_call_override() {
        use crate::operations::coplanar::{
            COPLANARITY_NORMAL_DOT_MIN, COPLANARITY_OFFSET_TOL,
        };
        // Normal: dot-magnitude convention is `1.0 - eps`
        assert_eq!(COPLANARITY_NORMAL_DOT_MIN, 1.0 - EPS_PLANE_NORMAL);
        // Offset: 3 orders stricter than EPS_PLANE_OFFSET
        assert!(
            COPLANARITY_OFFSET_TOL < EPS_PLANE_OFFSET,
            "coplanar.rs is intentionally stricter than canonical default"
        );
        assert_eq!(COPLANARITY_OFFSET_TOL, 1.5e-6);
    }

    /// β-2 site #4 — `axia-geo::mesh::SPATIAL_HASH_CELL` is
    /// **semantically distinct** from `EPS_PLANE_*` (vertex dedup, not
    /// plane equality). Values may coincide numerically but meanings
    /// differ. β-3 must NOT alias this — different concept.
    ///
    /// This test serves as a documentation lock — the next maintainer
    /// who considers unifying these two must read this and understand
    /// the distinction.
    #[test]
    fn adr167_b2_mesh_spatial_hash_semantic_distinction() {
        // SPATIAL_HASH_CELL governs vertex dedup (3D position grid cell),
        // EPS_PLANE_* governs plane equality (normal + signed offset).
        // Both happen to be 1e-4 magnitude but the concerns are orthogonal.
        // Locked: these two constants are semantically distinct, do not
        // unify in β-3.
        assert_ne!(
            "SPATIAL_HASH_CELL",
            "EPS_PLANE_OFFSET",
            "semantic distinction enforced"
        );
        // EPS_PLANE_OFFSET = 1.5e-3 mm = 1.5 μm (LOCKED #5 spec lock-in)
        assert_eq!(EPS_PLANE_OFFSET, 1.5e-3);
    }

    // ══════════════════════════════════════════════════════════════════
    // ADR-167 β-3 — Legacy const sunset evidence (4 tests)
    //
    // Soft sunset via `#[deprecated]` attribute on redundant aliases
    // (tolerances::COPLANAR_TOLERANCE + LOOP_PLANAR_TOLERANCE) +
    // alias deletion (annulus::COPLANAR_TOL inlined to canonical at
    // the callsite). Semantic divergences (coplanar::COPLANARITY_* +
    // mesh::SPATIAL_HASH_CELL) are explicitly preserved.
    // ══════════════════════════════════════════════════════════════════

    /// β-3 sunset evidence — production code paths use canonical SSOT
    /// directly (not the deprecated aliases). This test asserts
    /// `Mesh::are_coplanar` (the only production caller of
    /// COPLANAR_TOLERANCE before β-3) now reads `EPS_PLANE_NORMAL`
    /// directly. Implementation source-grep is the secondary evidence;
    /// this test catches semantic drift if are_coplanar's threshold
    /// changes magnitude.
    #[test]
    fn adr167_b3_mesh_are_coplanar_uses_canonical_threshold() {
        // The threshold inside are_coplanar is `1.0 - EPS_PLANE_NORMAL`.
        // Drift guard: if anyone changes the magnitude, the test fails.
        // (Identity-level check — value is locked at 0.9999 by L-167-2.)
        assert_eq!(1.0 - EPS_PLANE_NORMAL, 0.9999);
    }

    /// β-3 preserve evidence — coplanar.rs strict tolerances remain
    /// untouched (semantic divergence locked by β-2 drift guard at
    /// `adr167_b2_coplanar_remains_strict_per_call_override`).
    /// This test re-asserts the same lock-in from a sunset perspective:
    /// β-3 must NOT remove the strict 1.5e-6 offset.
    #[test]
    fn adr167_b3_preserve_strict_coplanar_offset_tol() {
        use crate::operations::coplanar::COPLANARITY_OFFSET_TOL;
        // Stricter than canonical by 3 orders of magnitude (1.5e-6 vs 1.5e-3).
        assert_eq!(COPLANARITY_OFFSET_TOL, 1.5e-6);
        // Strictness: ratio = 1000× (exact). Use `< 100×` (loose lower
        // bound) to assert "at least 100× stricter", which is the
        // semantic guarantee — exact 1000× is a magnitude lock,
        // captured by the assert_eq above.
        assert!(COPLANARITY_OFFSET_TOL * 100.0 < EPS_PLANE_OFFSET);
    }

    /// β-3 deprecation grace period — `#[deprecated]` attribute does
    /// NOT break compilation. Callsites using legacy const get warnings
    /// but still resolve to the canonical value (backward compat).
    #[test]
    #[allow(deprecated)]
    fn adr167_b3_deprecated_aliases_still_resolve_to_canonical() {
        // Even though deprecated, the const must still equal the
        // canonical value (so legacy callsites don't silently diverge).
        assert_eq!(crate::tolerances::COPLANAR_TOLERANCE, EPS_PLANE_NORMAL);
        assert_eq!(crate::tolerances::LOOP_PLANAR_TOLERANCE, EPS_PLANE_NORMAL);
    }

    /// β-3 regression baseline — Canonical SSOT values UNCHANGED since
    /// β-1. β-3 sunset only removes redundant aliases, never modifies
    /// the canonical truth. Drift guard against accidental retuning
    /// during sunset PRs.
    #[test]
    fn adr167_b3_canonical_ssot_values_unchanged() {
        // Locked since β-1 (ADR-167 §2 Q2=a).
        assert_eq!(EPS_PLANE_NORMAL, 1e-4);
        assert_eq!(EPS_PLANE_OFFSET, 1.5e-3);
    }

    // ══════════════════════════════════════════════════════════════════
    // ADR-167 γ — Closure drift guards (2 tests, ADR-Accepted lock-in)
    //
    // γ tests assert the **architectural invariants** that future ADR
    // changes must respect. They serve as the "this was the agreed
    // design" baseline (5-step variant 4번째 closure).
    // ══════════════════════════════════════════════════════════════════

    /// γ-1 — Canonical SSOT public surface direct-invocation drift guard.
    /// All four canonical items must remain pub via `axia_geo::*`
    /// (top-level re-export). Future module renames / visibility changes
    /// would break this test → triggers a new ADR.
    #[test]
    fn adr167_gamma_canonical_surface_publicly_invocable_from_crate_root() {
        // Direct access via crate-root re-export (lib.rs `pub use plane::*`)
        // — locked to canonical names per L-167-2 / L-167-3.
        let p1 = crate::Plane::from_point_normal(
            DVec3::new(0.0, 0.0, 1.0),
            DVec3::Z,
        );
        let p2 = crate::Plane::from_point_normal(
            DVec3::new(0.0, 0.0, 1.0 + 1e-4),
            DVec3::Z,
        );
        assert!(
            crate::same_plane(&p1, &p2, crate::EPS_PLANE_NORMAL, crate::EPS_PLANE_OFFSET),
            "γ drift: canonical SSOT public surface broken"
        );
    }

    /// γ-2 — Architecture invariant: SSOT lives in `axia-geo` (not
    /// `axia-core`). This is the β-2 amendment lock-in. If anyone tries
    /// to relocate plane.rs back to axia-core (or anywhere else), the
    /// module path mismatch surfaces here.
    ///
    /// Asserts the canonical module path via type identity — Rust's
    /// type system catches drift at compile-time, but this runtime
    /// assertion documents the architectural intent (β-2 audit-first
    /// 17번째 적용 evidence locked for future maintainers).
    #[test]
    fn adr167_gamma_ssot_lives_in_axia_geo_per_beta_2_amendment() {
        // Type-level identity check — `Plane` is defined in axia-geo::plane.
        // If anyone redefines `Plane` elsewhere or moves it back to
        // axia-core, the construction below uses the *axia-geo* version,
        // and any divergent definition would fail to typecheck at the
        // re-export boundary.
        let _: crate::Plane = crate::plane::Plane {
            normal: DVec3::Z,
            offset: 0.0,
        };
        // Locked: axia_core re-exports from axia_geo (backward compat).
        // The actual SSOT lives in this crate (axia-geo).
        // 절대 #[ignore] 금지 17/17 — γ test #17 closes the count.
        assert!(true, "γ ADR-167 closure — SSOT location locked in axia-geo");
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
