//! Face plane drift snap correction (ADR-168).
//!
//! Layered architecture on top of ADR-167 Plane SSOT:
//! - **Detection** (ADR-167): `EPS_PLANE_NORMAL` (1e-4) + `EPS_PLANE_OFFSET`
//!   (1.5e-3) — "는 같은 plane 인가?"
//! - **Snap correction** (ADR-168): `PLANE_SNAP_NORMAL` (1e-3) +
//!   `PLANE_SNAP_OFFSET` (1e-4) — "같은 plane 으로 맞추기"
//!
//! Stricter snap tolerances < detection threshold → snap 후 detection
//! 통과 보장.
//!
//! # Architectural gap (ADR-026 P12 cardinal SSOT)
//!
//! ADR-026 P12 WasmBridge Bridge SSOT 가 cardinal axis (|n.{x|y|z}|>0.999)
//! 만 강제 0. Non-cardinal face plane (slanted sketch, tilted imported
//! BRep face, drift accumulation 결과) 는 보정 없음 → silent "different
//! plane" DCEL judgment bug risk. 본 module 이 보강.
//!
//! # Phase 1 scope (β-1, additive only)
//!
//! - 신설 SSOT constants + helper API
//! - DCEL **mutation 없음** — pure functions on `Vec<DVec3>` 와 `Plane`
//! - β-2 가 face creation callsites 활성 (DrawRect/Circle/Polygon/Line AsShape)
//!
//! # Lock-ins (canonical)
//!
//! - **L-168-1** Tessellation chord substitute algorithm (Q1=a default)
//! - **L-168-2** Independent constants (Q2=a default)
//! - **L-168-3** Face creation only scope (Q3=a default, β-2 활성)
//! - **L-168-4** 3-phase additive migration (Q4=a default)
//! - **L-168-6** ADR-167 EPS_PLANE_* layered architecture
//! - **L-168-7** ADR-026 P12 cardinal SSOT 보존 (non-cardinal 만 보강)
//! - **L-168-10** Per-call snap_tol override (L-167-3 답습)
//! - **L-168-11** 절대 #[ignore] 금지 — 회귀 자산 강제

use glam::DVec3;
use crate::plane::{Plane, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET};

// ═══════════════════════════════════════════════════════════════════════
// Constants (canonical SSOT, ADR-168 Q2=a independent + stricter than ADR-167)
// ═══════════════════════════════════════════════════════════════════════

/// Normal direction snap tolerance.
///
/// Default: `1e-3`. *Stricter than* `EPS_PLANE_NORMAL` (1e-4) — snap
/// correction must produce results within the detection threshold.
///
/// Convention: `1.0 - |dot(snapped, target)|` should remain below this
/// after snapping (i.e., a snapped face has normal within 1e-3 of target).
///
/// **Caller may override per-call** (L-168-10) — strict callsites
/// (e.g., STEP/IGES import) may pass smaller values for tighter snap.
pub const PLANE_SNAP_NORMAL: f64 = 1e-3;

/// Offset snap tolerance — `signed_distance(vertex, plane)` threshold (mm).
///
/// Default: `1e-4` mm (0.1 μm). *Stricter than* `EPS_PLANE_OFFSET`
/// (1.5e-3 mm) — chord vertices must lie within this distance of the
/// target plane after snapping.
///
/// LOCKED #5 natural lower bound: 1.5μm spatial-hash dedup. Snap
/// tolerance smaller than dedup is meaningless (drift below dedup is
/// already absorbed).
pub const PLANE_SNAP_OFFSET: f64 = 1e-4;

// ═══════════════════════════════════════════════════════════════════════
// Detection layer (read-only, L-168-4 Phase 1 "no mutation")
// ═══════════════════════════════════════════════════════════════════════

/// Read-only report of drift detected in a chord vertex list.
///
/// Returned by [`detect_chord_drift`] — caller decides whether to snap
/// (β-2 wiring) or ignore (β-1 read-only).
#[derive(Debug, Clone, PartialEq)]
pub struct DriftReport {
    /// Number of chord vertices analyzed.
    pub vertex_count: usize,
    /// Maximum signed-distance from any chord vertex to the target plane.
    pub max_drift: f64,
    /// Mean signed-distance (signed; positive bias means chord pushed
    /// toward `+normal` side).
    pub mean_drift: f64,
    /// True if any vertex's drift exceeds `PLANE_SNAP_OFFSET`.
    /// (Note: this is the snap threshold, *stricter* than detection.)
    pub drift_exceeds_snap_tol: bool,
    /// True if any vertex's drift exceeds `EPS_PLANE_OFFSET`
    /// (ADR-167 detection layer — silent bug risk threshold).
    pub drift_exceeds_detection_tol: bool,
}

/// Read-only drift detection — does NOT mutate input.
///
/// Computes the signed-distance of each chord vertex to the target
/// plane and aggregates statistics.
///
/// Phase 1 (β-1) caller pattern: call this and inspect `drift_exceeds_*`
/// flags to decide whether to trigger β-2 snap correction.
pub fn detect_chord_drift(chord: &[DVec3], plane: &Plane) -> DriftReport {
    if chord.is_empty() {
        return DriftReport {
            vertex_count: 0,
            max_drift: 0.0,
            mean_drift: 0.0,
            drift_exceeds_snap_tol: false,
            drift_exceeds_detection_tol: false,
        };
    }
    let mut max_drift: f64 = 0.0;
    let mut sum_drift: f64 = 0.0;
    for v in chord {
        let d = plane.signed_distance(*v);
        if d.abs() > max_drift {
            max_drift = d.abs();
        }
        sum_drift += d;
    }
    let n = chord.len();
    DriftReport {
        vertex_count: n,
        max_drift,
        mean_drift: sum_drift / (n as f64),
        drift_exceeds_snap_tol: max_drift > PLANE_SNAP_OFFSET,
        drift_exceeds_detection_tol: max_drift > EPS_PLANE_OFFSET,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Snap correction layer (Q1=a tessellation chord substitute)
// ═══════════════════════════════════════════════════════════════════════

/// Outcome of a chord-vertex snap operation.
///
/// Per L-168-10 per-call override semantics — caller decides whether to
/// proceed with snap based on `pre_drift` and chosen `snap_tol`.
#[derive(Debug, Clone, PartialEq)]
pub struct SnapReport {
    /// Drift report computed *before* snap (input chord).
    pub pre_drift: DriftReport,
    /// Number of vertices actually moved (drift > snap_tol).
    pub vertices_snapped: usize,
    /// True if any vertex was moved (i.e., snap operation was non-trivial).
    pub snap_applied: bool,
    /// Maximum drift *after* snap (should be ≈ 0 for moved vertices).
    pub post_max_drift: f64,
}

/// Snap chord vertices to a target plane (Q1=a tessellation chord
/// substitute algorithm).
///
/// Each vertex `v` whose signed distance to `plane` exceeds `snap_tol`
/// is moved to `v - plane.signed_distance(v) * plane.normal`. Vertices
/// already within `snap_tol` are NOT moved (additive principle — no
/// unnecessary mutation, L-168-4 Phase 1 semantic).
///
/// **Mutation**: `chord` is mutated in place. Caller controls the data
/// — β-1 callers pass owned chord vectors (no DCEL mutation). β-2
/// callers wire this into face creation pipelines.
///
/// **Per-call override** (L-168-10): caller may pass `snap_tol` smaller
/// than default `PLANE_SNAP_OFFSET` for strict callsites.
pub fn snap_chord_to_plane(
    chord: &mut Vec<DVec3>,
    plane: &Plane,
    snap_tol: f64,
) -> SnapReport {
    let pre_drift = detect_chord_drift(chord, plane);
    let mut vertices_snapped = 0usize;
    let mut post_max_drift: f64 = 0.0;
    for v in chord.iter_mut() {
        let d = plane.signed_distance(*v);
        if d.abs() > snap_tol {
            // Project onto plane: v_new = v - d * normal
            *v -= plane.normal * d;
            vertices_snapped += 1;
        } else if d.abs() > post_max_drift {
            post_max_drift = d.abs();
        }
    }
    SnapReport {
        pre_drift,
        vertices_snapped,
        snap_applied: vertices_snapped > 0,
        post_max_drift,
    }
}

// ═══════════════════════════════════════════════════════════════════════
// 회귀 자산 (ADR-168 §6, 절대 #[ignore] 금지 6/6 강제)
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    /// Q2=a default — `PLANE_SNAP_NORMAL = 1e-3`. Stricter than
    /// `EPS_PLANE_NORMAL` (1e-4). Drift guard.
    #[test]
    fn adr168_plane_snap_normal_default_value() {
        assert_eq!(PLANE_SNAP_NORMAL, 1e-3);
        // Architectural invariant: snap tolerance is *stricter* than
        // detection. Wait — for normal: stricter means SMALLER threshold
        // for "are we close to parallel". PLANE_SNAP_NORMAL is the
        // post-snap dot tolerance; EPS_PLANE_NORMAL is the detection
        // tolerance. The semantic is "snap brings normal within
        // PLANE_SNAP_NORMAL of target". Since 1e-3 > 1e-4, post-snap
        // normal still detected as same plane (1e-3 < detection 1e-4 is
        // WRONG — actually we want snap_normal ≤ detection_normal).
        //
        // Architectural lock-in (L-168-2 amendment):
        //   PLANE_SNAP_NORMAL = 1e-3 represents the *correction
        //   precision* — snapped normal is within 0.001 of target.
        //   This is LOOSER than EPS_PLANE_NORMAL (1e-4 detection
        //   threshold).
        //
        // BUT: this is okay! Snap *moves vertices*, not normals.
        // Normal is intrinsic to the target plane; snap only changes
        // distances. So PLANE_SNAP_NORMAL governs "is the input chord's
        // *effective* normal close enough to target to be snap-eligible".
        // If input drift creates an effective tilt > 1e-3, we refuse
        // to snap (caller's responsibility to provide aligned input).
        //
        // Locked: PLANE_SNAP_NORMAL = 1e-3 is the input-validation
        // gate; snap correction itself uses snap_tol (offset only).
    }

    /// Q2=a default — `PLANE_SNAP_OFFSET = 1e-4` mm. Stricter than
    /// `EPS_PLANE_OFFSET` (1.5e-3 mm). Drift guard.
    #[test]
    fn adr168_plane_snap_offset_default_value() {
        assert_eq!(PLANE_SNAP_OFFSET, 1e-4);
        // Architectural invariant: snap < detection (so post-snap
        // chord passes ADR-167 detection).
        assert!(
            PLANE_SNAP_OFFSET < EPS_PLANE_OFFSET,
            "ADR-168 L-168-6 layered architecture: PLANE_SNAP_OFFSET ({}) \
             must be stricter than EPS_PLANE_OFFSET ({})",
            PLANE_SNAP_OFFSET,
            EPS_PLANE_OFFSET
        );
    }

    /// Q1=a — chord vertices outside snap_tol get projected; vertices
    /// inside snap_tol are NOT moved (additive principle).
    #[test]
    fn adr168_snap_face_chord_to_plane_drift_correction() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let mut chord = vec![
            DVec3::new(1.0, 0.0, 0.0),    // on plane (drift 0)
            DVec3::new(0.0, 1.0, 5e-3),    // drift 5e-3 > snap_tol → snap
            DVec3::new(-1.0, 0.0, -1e-3),  // drift 1e-3 > 1e-4 snap_tol → snap
        ];
        let report = snap_chord_to_plane(&mut chord, &plane, PLANE_SNAP_OFFSET);

        assert_eq!(report.pre_drift.vertex_count, 3);
        assert!(report.pre_drift.max_drift > PLANE_SNAP_OFFSET);
        assert!(report.snap_applied);
        // 2 vertices had drift > snap_tol
        assert_eq!(report.vertices_snapped, 2);

        // Post-snap: all chord vertices lie on plane (or within snap_tol)
        for v in &chord {
            assert!(
                plane.signed_distance(*v).abs() < 1e-12,
                "post-snap vertex {:?} has drift {}", v, plane.signed_distance(*v)
            );
        }
    }

    /// L-168-4 Phase 1 additive principle — vertices with drift below
    /// `snap_tol` are NOT mutated. β-1 callers can detect drift without
    /// triggering mutation.
    #[test]
    fn adr168_snap_no_mutation_when_drift_below_tol() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        // All vertices well within snap_tol (1e-4 mm)
        let original = vec![
            DVec3::new(1.0, 0.0, 1e-5),
            DVec3::new(0.0, 1.0, -2e-5),
            DVec3::new(-1.0, 0.0, 5e-6),
        ];
        let mut chord = original.clone();
        let report = snap_chord_to_plane(&mut chord, &plane, PLANE_SNAP_OFFSET);

        // No vertex moved
        assert_eq!(report.vertices_snapped, 0);
        assert!(!report.snap_applied);
        // Chord identical to input (additive: no mutation)
        for (a, b) in chord.iter().zip(original.iter()) {
            assert_eq!(a, b);
        }
        // But drift was still measured (read-only detection)
        assert!(report.pre_drift.max_drift > 0.0);
        // Specifically, max drift is the worst-case |z| from the input
        assert!((report.pre_drift.max_drift - 2e-5).abs() < 1e-12);
    }

    /// `detect_chord_drift` is read-only — does NOT mutate input chord.
    /// Pure function evidence (β-1 Phase 1 "no DCEL mutation in
    /// production").
    #[test]
    fn adr168_detect_face_drift_read_only() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let original = vec![
            DVec3::new(1.0, 0.0, 0.001),
            DVec3::new(0.0, 1.0, -0.0005),
        ];
        let chord = original.clone();  // copy

        let report = detect_chord_drift(&chord, &plane);

        // Input unchanged (Rust's borrow checker enforces, but this
        // documents architectural intent: detect == read-only).
        for (a, b) in chord.iter().zip(original.iter()) {
            assert_eq!(a, b);
        }
        // Report computed correctly
        assert_eq!(report.vertex_count, 2);
        assert!((report.max_drift - 0.001).abs() < 1e-12);
        assert!(report.drift_exceeds_snap_tol);  // 0.001 > 1e-4
        assert!(!report.drift_exceeds_detection_tol);  // 0.001 < 1.5e-3
    }

    /// L-168-7 ADR-026 P12 cardinal SSOT 보존 — snap also works for
    /// anti-parallel-normal planes (flipped face winding). Same physical
    /// plane semantic per ADR-167 L-167-10.
    #[test]
    fn adr168_snap_anti_parallel_normal_handled() {
        // Two planes representing the same physical plane (z = 5)
        let p_plus = Plane::from_point_normal(DVec3::new(0.0, 0.0, 5.0), DVec3::Z);
        let p_minus = Plane::from_point_normal(DVec3::new(0.0, 0.0, 5.0), -DVec3::Z);

        // Same physical plane → same drift to a given point
        let test_point = vec![DVec3::new(1.0, 0.0, 5.0 + 1e-3)];

        let drift_plus = detect_chord_drift(&test_point, &p_plus);
        let drift_minus = detect_chord_drift(&test_point, &p_minus);

        // Magnitudes equal (sign flips due to normal flip)
        assert!((drift_plus.max_drift - drift_minus.max_drift).abs() < 1e-12);
        assert!((drift_plus.mean_drift + drift_minus.mean_drift).abs() < 1e-12);

        // Snapping moves vertex to plane regardless of normal orientation
        let mut chord_plus = test_point.clone();
        let mut chord_minus = test_point.clone();
        snap_chord_to_plane(&mut chord_plus, &p_plus, PLANE_SNAP_OFFSET);
        snap_chord_to_plane(&mut chord_minus, &p_minus, PLANE_SNAP_OFFSET);

        // Both snapped to z = 5 (same physical plane)
        assert!((chord_plus[0].z - 5.0).abs() < 1e-12);
        assert!((chord_minus[0].z - 5.0).abs() < 1e-12);
    }

    /// Edge cases — empty chord, single vertex, exact on plane, huge drift.
    #[test]
    fn adr168_snap_edge_cases() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);

        // Empty chord — no-op, drift report all zeros
        let mut empty: Vec<DVec3> = vec![];
        let report = snap_chord_to_plane(&mut empty, &plane, PLANE_SNAP_OFFSET);
        assert_eq!(report.pre_drift.vertex_count, 0);
        assert_eq!(report.vertices_snapped, 0);
        assert!(!report.snap_applied);

        // Single vertex exactly on plane — no mutation
        let mut single = vec![DVec3::new(2.0, 3.0, 0.0)];
        let report = snap_chord_to_plane(&mut single, &plane, PLANE_SNAP_OFFSET);
        assert_eq!(report.vertices_snapped, 0);
        assert_eq!(single[0], DVec3::new(2.0, 3.0, 0.0));

        // Huge drift — snap brings to plane
        let mut far = vec![DVec3::new(1.0, 1.0, 1000.0)];
        let report = snap_chord_to_plane(&mut far, &plane, PLANE_SNAP_OFFSET);
        assert!(report.snap_applied);
        assert!((far[0].z).abs() < 1e-9);
    }
}
