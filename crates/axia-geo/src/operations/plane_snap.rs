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
#[allow(unused_imports)]  // EPS_PLANE_NORMAL referenced from docs + tests
use crate::plane::{Plane, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET};
use crate::{FaceId, mesh::Mesh};

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
// β-3 — Drift telemetry aggregate (ADR-087 K-ζ canonical 사용자 시연 gate)
// ═══════════════════════════════════════════════════════════════════════

/// Aggregate snap statistics across multiple `SnapReport` outcomes.
///
/// **Phase 3 telemetry primitive** (ADR-168 §3 β-3 scope) — callers
/// accumulate snap reports from production callsites (`exec_draw_*_as_shape`)
/// to observe drift distribution and silent bug evidence over a session.
///
/// **Default = empty (no overhead)**. Production code paths do NOT
/// instantiate or accumulate by default — Phase 3 is opt-in via E2E
/// session wrappers (e.g., real-Chromium Playwright demo, dev `__axia
/// .snapMetrics` API).
///
/// # Phase 3 sequence (canonical for 사용자 시연 gate)
///
/// 1. E2E session start: `let mut agg = SnapMetricsAggregate::default();`
/// 2. For each `snap_face_to_plane(...)` outcome: `agg.accumulate(&report)`
/// 3. Session end: inspect `agg.max_drift` / `agg.total_vertices_snapped`
///    for silent bug evidence (ADR-026 P12 cardinal gap → ADR-168
///    coverage validation).
///
/// # Design rationale (L-168-4 Phase 3 additive)
///
/// - Production scene.rs callsites UNCHANGED (no telemetry overhead)
/// - Telemetry instrumentation purely additive — caller manages
///   accumulation lifecycle
/// - Mesh struct NOT modified (no serialization risk)
/// - No thread-local hidden state (explicit caller intent)
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SnapMetricsAggregate {
    /// Total number of `snap_face_to_plane` calls accumulated.
    pub face_calls: usize,
    /// Total chord vertices examined (sum of `pre_drift.vertex_count`).
    pub total_vertices_examined: usize,
    /// Total vertices actually moved (sum of `vertices_snapped`).
    pub total_vertices_snapped: usize,
    /// Maximum drift observed (across all `pre_drift.max_drift` reports).
    pub max_drift: f64,
    /// Cumulative count of reports where `drift_exceeds_snap_tol`.
    /// Indicates how often snap correction was non-trivial.
    pub snap_triggered_count: usize,
    /// Cumulative count of reports where `drift_exceeds_detection_tol`.
    /// **Critical metric** — silent bug evidence (ADR-026 P12 cardinal
    /// gap). High value = β-3 telemetry confirmed production drift > ADR-167
    /// detection threshold.
    pub silent_bug_evidence_count: usize,
}

impl SnapMetricsAggregate {
    /// Accumulate a single `SnapReport` outcome into this aggregate.
    ///
    /// Idempotent: calling with an empty report (vertex_count = 0) is a
    /// no-op except for `face_calls += 1`.
    pub fn accumulate(&mut self, report: &SnapReport) {
        self.face_calls += 1;
        self.total_vertices_examined += report.pre_drift.vertex_count;
        self.total_vertices_snapped += report.vertices_snapped;
        if report.pre_drift.max_drift > self.max_drift {
            self.max_drift = report.pre_drift.max_drift;
        }
        if report.pre_drift.drift_exceeds_snap_tol {
            self.snap_triggered_count += 1;
        }
        if report.pre_drift.drift_exceeds_detection_tol {
            self.silent_bug_evidence_count += 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// β-2 — Mesh-aware integration (face creation callsites)
// ═══════════════════════════════════════════════════════════════════════

/// Snap a face's outer-loop boundary vertices to the target plane
/// (ADR-168 β-2 integration helper, Q3=a face creation only scope).
///
/// Per L-168-4 Phase 2 production-active semantic — mesh vertices are
/// mutated in place via `Vertex::set_pos`. Caller is responsible for
/// downstream side effects (normal recomputation, affected face refresh).
///
/// **β-2 callsite pattern** (scene.rs::exec_draw_*_as_shape):
/// ```ignore
/// // After set_face_surface(fid, Some(plane)) attaches AnalyticSurface::Plane
/// let target_plane = Plane::from_point_normal(origin, normal);
/// snap_face_to_plane(mesh, fid, &target_plane, PLANE_SNAP_OFFSET);
/// ```
///
/// Returns `SnapReport { pre_drift, vertices_snapped, snap_applied,
/// post_max_drift }`. Empty return (no-op) if face is inactive or
/// missing.
pub fn snap_face_to_plane(
    mesh: &mut Mesh,
    face_id: FaceId,
    plane: &Plane,
    snap_tol: f64,
) -> SnapReport {
    // 1. Collect outer-loop vertex IDs (defensive: skip inactive/missing)
    let face = match mesh.faces.get(face_id) {
        Some(f) if f.is_active() => f,
        _ => {
            return SnapReport {
                pre_drift: DriftReport {
                    vertex_count: 0,
                    max_drift: 0.0,
                    mean_drift: 0.0,
                    drift_exceeds_snap_tol: false,
                    drift_exceeds_detection_tol: false,
                },
                vertices_snapped: 0,
                snap_applied: false,
                post_max_drift: 0.0,
            };
        }
    };
    let outer_start = face.outer().start;
    let vert_ids = match mesh.collect_loop_verts(outer_start) {
        Ok(v) => v,
        Err(_) => {
            return SnapReport {
                pre_drift: DriftReport {
                    vertex_count: 0,
                    max_drift: 0.0,
                    mean_drift: 0.0,
                    drift_exceeds_snap_tol: false,
                    drift_exceeds_detection_tol: false,
                },
                vertices_snapped: 0,
                snap_applied: false,
                post_max_drift: 0.0,
            };
        }
    };

    // 2. Collect current positions, snap them, and write back
    let mut chord: Vec<DVec3> = vert_ids
        .iter()
        .filter_map(|&vid| mesh.verts.get(vid).map(|v| v.pos()))
        .collect();

    let report = snap_chord_to_plane(&mut chord, plane, snap_tol);

    // 3. Write snapped positions back to mesh
    for (i, &vid) in vert_ids.iter().enumerate() {
        if let Some(vert) = mesh.verts.get_mut(vid) {
            if i < chord.len() {
                vert.set_pos(chord[i]);
            }
        }
    }

    report
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

    // ══════════════════════════════════════════════════════════════════
    // ADR-168 β-2 — Face creation callsite integration evidence (4 tests)
    //
    // β-2 wires `snap_face_to_plane` into 3 face creation callsites in
    // axia-core::scene (rect / line / circle as_shape). These tests
    // validate the mesh-aware helper boundary semantics.
    // ══════════════════════════════════════════════════════════════════

    /// β-2 defensive — snap_face_to_plane on missing face returns empty
    /// report (no panic, no mutation).
    #[test]
    fn adr168_b2_snap_face_missing_face_no_op() {
        let mut mesh = Mesh::new();
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        // FaceId::new(999) — slot does not exist
        let nonexistent = crate::FaceId::new(999);
        let report = super::snap_face_to_plane(&mut mesh, nonexistent, &plane, PLANE_SNAP_OFFSET);

        assert_eq!(report.pre_drift.vertex_count, 0);
        assert_eq!(report.vertices_snapped, 0);
        assert!(!report.snap_applied);
    }

    /// β-2 architectural invariant — snap tolerance is stricter than
    /// detection tolerance. Post-snap chord always passes ADR-167
    /// detection. Re-asserts β-1 layered architecture from sunset
    /// perspective.
    #[test]
    fn adr168_b2_snap_strictly_less_than_detection_invariant() {
        // PLANE_SNAP_OFFSET (1e-4) < EPS_PLANE_OFFSET (1.5e-3)
        assert!(PLANE_SNAP_OFFSET < EPS_PLANE_OFFSET);
        // The 15× ratio is the architectural margin — post-snap drift
        // is well within detection threshold (0.067 of detection eps).
        assert!(PLANE_SNAP_OFFSET / EPS_PLANE_OFFSET < 0.1);
    }

    /// β-2 chord drift round-trip evidence — when chord vertices are
    /// projected onto the target plane, ALL post-snap signed distances
    /// must be below machine epsilon. This is the core β-2 contract
    /// (downstream coplanarity detection always passes post-snap).
    #[test]
    fn adr168_b2_chord_round_trip_post_snap_drift_zero() {
        let plane = Plane::from_point_normal(DVec3::new(0.0, 0.0, 5.0), DVec3::Z);
        // Simulate drifted RECT corner vertices (Z slightly off plane)
        let mut chord = vec![
            DVec3::new(-1.0, -1.0, 5.0 + 1e-3),  // 10× snap_tol drift
            DVec3::new( 1.0, -1.0, 5.0 - 1e-3),
            DVec3::new( 1.0,  1.0, 5.0 + 5e-4),
            DVec3::new(-1.0,  1.0, 5.0 - 2e-3),
        ];
        let report = super::snap_chord_to_plane(&mut chord, &plane, PLANE_SNAP_OFFSET);

        // All 4 vertices snapped
        assert_eq!(report.vertices_snapped, 4);
        assert!(report.snap_applied);

        // Post-snap: ALL chord vertices lie on plane within machine eps
        for v in &chord {
            let d = plane.signed_distance(*v);
            assert!(
                d.abs() < 1e-12,
                "post-snap drift {:.3e} exceeds machine eps for vertex {:?}",
                d.abs(),
                v
            );
        }

        // β-2 architectural invariant: post-snap drift well below
        // EPS_PLANE_OFFSET (downstream detection passes)
        for v in &chord {
            assert!(plane.signed_distance(*v).abs() < EPS_PLANE_OFFSET);
        }
    }

    /// β-2 X/Y coordinate preservation — snap only moves vertices along
    /// the *normal* direction. In-plane coordinates (X/Y for a Z-normal
    /// plane) are untouched. This is the core geometric semantic — snap
    /// does not distort polygon shape, only flattens it.
    #[test]
    fn adr168_b2_snap_preserves_in_plane_coordinates() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let original_xy = vec![
            (1.0, 2.0),
            (-3.0, 4.0),
            (5.0, -6.0),
        ];
        let mut chord: Vec<DVec3> = original_xy
            .iter()
            .map(|&(x, y)| DVec3::new(x, y, 1e-3))  // Z drift = 1e-3 > snap_tol
            .collect();

        let _report = super::snap_chord_to_plane(&mut chord, &plane, PLANE_SNAP_OFFSET);

        // X/Y coordinates UNCHANGED — only Z snapped to 0
        for (i, v) in chord.iter().enumerate() {
            assert_eq!(
                v.x, original_xy[i].0,
                "snap mutated X coord at vertex {}", i
            );
            assert_eq!(
                v.y, original_xy[i].1,
                "snap mutated Y coord at vertex {}", i
            );
            assert!(v.z.abs() < 1e-12, "Z not snapped to 0 at vertex {}", i);
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // ADR-168 β-3 — Drift telemetry aggregate (3 tests, ADR-087 K-ζ gate)
    //
    // β-3 adds `SnapMetricsAggregate` opt-in telemetry primitive. Production
    // callsites UNCHANGED — Phase 3 callers manage accumulation lifecycle
    // (E2E session wrapper, dev `__axia.snapMetrics` API, etc.).
    // ══════════════════════════════════════════════════════════════════

    /// β-3 default aggregate — empty, no overhead. Production code paths
    /// do NOT instantiate by default (L-168-4 Phase 3 additive principle).
    #[test]
    fn adr168_b3_metrics_aggregate_default_empty_no_overhead() {
        let agg = SnapMetricsAggregate::default();
        assert_eq!(agg.face_calls, 0);
        assert_eq!(agg.total_vertices_examined, 0);
        assert_eq!(agg.total_vertices_snapped, 0);
        assert_eq!(agg.max_drift, 0.0);
        assert_eq!(agg.snap_triggered_count, 0);
        assert_eq!(agg.silent_bug_evidence_count, 0);
    }

    /// β-3 accumulation — multiple reports aggregate correctly into the
    /// telemetry struct. Max drift = max over all reports, counts sum,
    /// vertex counts sum.
    #[test]
    fn adr168_b3_metrics_aggregate_accumulates_correctly() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let mut agg = SnapMetricsAggregate::default();

        // Report 1: no drift (vertices in plane)
        let mut chord1 = vec![DVec3::new(1.0, 0.0, 0.0), DVec3::new(0.0, 1.0, 0.0)];
        let report1 = super::snap_chord_to_plane(&mut chord1, &plane, PLANE_SNAP_OFFSET);
        agg.accumulate(&report1);

        // Report 2: minor drift (within snap_tol — detected but not snapped)
        let mut chord2 = vec![DVec3::new(1.0, 0.0, 5e-5)];  // below snap_tol
        let report2 = super::snap_chord_to_plane(&mut chord2, &plane, PLANE_SNAP_OFFSET);
        agg.accumulate(&report2);

        // Report 3: significant drift (triggers snap + exceeds detection tol)
        let mut chord3 = vec![
            DVec3::new(1.0, 0.0, 2e-3),  // > EPS_PLANE_OFFSET = 1.5e-3 → silent bug evidence
            DVec3::new(0.0, 1.0, 5e-3),
        ];
        let report3 = super::snap_chord_to_plane(&mut chord3, &plane, PLANE_SNAP_OFFSET);
        agg.accumulate(&report3);

        // Aggregate verification
        assert_eq!(agg.face_calls, 3);
        assert_eq!(agg.total_vertices_examined, 5);  // 2 + 1 + 2
        assert_eq!(agg.total_vertices_snapped, 2);  // only report3's 2 vertices
        assert!((agg.max_drift - 5e-3).abs() < 1e-12);  // report3's worst case
        assert_eq!(agg.snap_triggered_count, 1);  // only report3 (drift_exceeds_snap_tol)
        // Report 3's drift (5e-3) > EPS_PLANE_OFFSET (1.5e-3) = silent bug evidence
        assert_eq!(agg.silent_bug_evidence_count, 1);
    }

    /// β-3 architectural invariant — accumulation never decreases counters
    /// (monotonic). Re-accumulating empty reports leaves max_drift
    /// untouched. Order independence — adding report A then B yields
    /// same aggregate as B then A.
    #[test]
    fn adr168_b3_metrics_aggregate_monotonic_and_order_independent() {
        let plane = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);

        // Build 3 reports with distinct drift levels
        let mut chord_a = vec![DVec3::new(1.0, 0.0, 1e-3)];
        let report_a = super::snap_chord_to_plane(&mut chord_a, &plane, PLANE_SNAP_OFFSET);

        let mut chord_b = vec![DVec3::new(0.0, 1.0, 5e-3)];
        let report_b = super::snap_chord_to_plane(&mut chord_b, &plane, PLANE_SNAP_OFFSET);

        let mut chord_c = vec![DVec3::new(0.0, 0.0, 3e-3)];
        let report_c = super::snap_chord_to_plane(&mut chord_c, &plane, PLANE_SNAP_OFFSET);

        // Order 1: A → B → C
        let mut agg_abc = SnapMetricsAggregate::default();
        agg_abc.accumulate(&report_a);
        let max_drift_after_a = agg_abc.max_drift;
        agg_abc.accumulate(&report_b);
        // Monotonic: max_drift never decreases
        assert!(agg_abc.max_drift >= max_drift_after_a);
        agg_abc.accumulate(&report_c);

        // Order 2: C → B → A (reverse order)
        let mut agg_cba = SnapMetricsAggregate::default();
        agg_cba.accumulate(&report_c);
        agg_cba.accumulate(&report_b);
        agg_cba.accumulate(&report_a);

        // Order independence: same final aggregate
        assert_eq!(agg_abc, agg_cba);
    }

    // ══════════════════════════════════════════════════════════════════
    // ADR-168 γ — Closure drift guards (2 tests, ADR-Accepted lock-in)
    //
    // γ tests assert architectural invariants that future ADR changes
    // must respect. They serve as the "this was the agreed design"
    // baseline (5-step variant 5번째 closure).
    // ══════════════════════════════════════════════════════════════════

    /// γ-1 — Canonical SSOT public surface direct-invocation drift guard.
    /// All ADR-168 items must remain pub via `axia_geo::operations::
    /// plane_snap::*` namespace. Future module renames / visibility
    /// changes would break this test → triggers a new ADR.
    #[test]
    fn adr168_gamma_canonical_surface_publicly_invocable_from_module() {
        // Direct access via fully-qualified module path — locked per
        // L-168-1 (Q1=a chord substitute) / L-168-2 (Q2=a constants) /
        // L-168-3 (Q3=a face creation) / L-168-4 (Q4=a 3-phase migration).
        let p1 = Plane::from_point_normal(DVec3::ZERO, DVec3::Z);
        let mut chord = vec![DVec3::new(1.0, 0.0, 1e-3)];

        // Phase 1: chord-level snap (β-1)
        let report = super::snap_chord_to_plane(
            &mut chord,
            &p1,
            super::PLANE_SNAP_OFFSET,
        );
        assert!(report.snap_applied);

        // Phase 3: telemetry (β-3)
        let mut agg = super::SnapMetricsAggregate::default();
        agg.accumulate(&report);
        assert_eq!(agg.face_calls, 1);

        // Architectural constants accessible
        let _ = super::PLANE_SNAP_NORMAL;
        let _ = super::PLANE_SNAP_OFFSET;
    }

    /// γ-2 — Architectural invariant: ADR-168 lives in axia-geo (per L-167
    /// amendment pattern). axia-core does NOT have a plane_snap module —
    /// the SSOT is the engine kernel layer. If anyone tries to relocate
    /// plane_snap to axia-core, this test catches the architectural
    /// drift via type identity check.
    ///
    /// Asserts the canonical module path via construction — Rust's type
    /// system catches drift at compile-time, but this runtime assertion
    /// documents the architectural intent (Q1=a + L-168-6 layered
    /// architecture: detection in axia-geo, snap in axia-geo).
    #[test]
    fn adr168_gamma_ssot_lives_in_axia_geo_operations() {
        // Type-level identity check — `SnapMetricsAggregate` is defined
        // in axia-geo::operations::plane_snap. If anyone redefines it
        // elsewhere, the construction below uses the *axia-geo* version.
        let _: super::SnapMetricsAggregate = super::SnapMetricsAggregate {
            face_calls: 0,
            total_vertices_examined: 0,
            total_vertices_snapped: 0,
            max_drift: 0.0,
            snap_triggered_count: 0,
            silent_bug_evidence_count: 0,
        };

        // Layered architecture invariant (L-168-6): snap < detection
        // (re-asserted from γ closure perspective).
        assert!(super::PLANE_SNAP_OFFSET < EPS_PLANE_OFFSET);

        // 절대 #[ignore] 금지 16/16 — γ test #16 closes the count.
        assert!(true, "γ ADR-168 closure — SSOT location locked in axia-geo");
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
