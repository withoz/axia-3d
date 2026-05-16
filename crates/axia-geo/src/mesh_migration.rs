//! ADR-059 Phase N Step 4 — v3 → v4 Mesh Migration with Drift Sanity.
//!
//! Per ADR-059 §A1.5 lock-in (Migration = post-deserialize pass, 옵션 A):
//! after deserializing a v3 .axia file (where Edge.curve / Face.surface
//! were `Option`), this module:
//!
//!   1. For each edge with `curve = None`: leave as None (curve_mandatory()
//!      synthesizes Line on demand).
//!   2. For each edge with `curve = Some(curve)`: verify endpoint drift.
//!      If `curve.evaluate(t_start) ≈ v_small_pos` AND
//!         `curve.evaluate(t_end) ≈ v_large_pos` within LOCKED #5 (1.5μm),
//!      keep as-is. Otherwise downgrade to `None` (Line synthesis).
//!   3. Same for face surfaces (drift check planned for Phase O integration —
//!      MVP only counts faces).
//!
//! Drift detection is the safety net for Phase N→O transition: between
//! Phase N completion and Phase O Tools NURBS-aware integration, vertex
//! moves can desync curves. Drift sanity catches stale curves and
//! demotes them to safe Line defaults.

use crate::curves::CurveOps;
use crate::mesh::Mesh;

/// Tolerance for migration drift check — matches LOCKED #5 spatial-hash
/// dedup tolerance (1.5μm). Curves whose endpoints drift beyond this
/// from their owning vertices are demoted to `None` (Line synthesis).
pub const MIGRATION_DRIFT_TOL: f64 = 1.5e-3;

/// Report from `Mesh::migrate_v3_to_v4_with_sanity`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MigrationReport {
    /// Edges that already had a curve attached (no drift). Preserved.
    pub edges_promoted_with_curve: usize,
    /// Edges with no curve attached. curve_mandatory() will synthesize
    /// Line on demand (Step 1 §B lock-in).
    pub edges_synthesized_as_line: usize,
    /// Edges where the attached curve drifted beyond MIGRATION_DRIFT_TOL
    /// from vertex positions. Demoted to None (safe fallback).
    pub edges_demoted_due_to_drift: usize,
    /// Faces that already had a surface attached. Preserved (no drift
    /// check at MVP — Phase O integration will add).
    pub faces_promoted_with_surface: usize,
    /// Faces with no surface attached. surface_mandatory() will
    /// synthesize Plane on demand.
    pub faces_synthesized_as_plane: usize,
    /// Reserved for Phase O drift integration.
    pub faces_demoted_due_to_drift: usize,
}

impl MigrationReport {
    pub fn total_edges(&self) -> usize {
        self.edges_promoted_with_curve
            + self.edges_synthesized_as_line
            + self.edges_demoted_due_to_drift
    }

    pub fn total_faces(&self) -> usize {
        self.faces_promoted_with_surface
            + self.faces_synthesized_as_plane
            + self.faces_demoted_due_to_drift
    }

    /// True if no demotions occurred (all curves preserved or synthesized
    /// without issue).
    pub fn is_clean(&self) -> bool {
        self.edges_demoted_due_to_drift == 0
            && self.faces_demoted_due_to_drift == 0
    }
}

impl Mesh {
    /// ADR-059 Phase N Step 4 — Migrate this mesh from v3 (Option-based
    /// curves/surfaces) to v4 (mandatory accessors backed by drift-checked
    /// state).
    ///
    /// Per §A1.5 lock-in, this is the **single canonical entry point** for
    /// post-deserialize migration. Call once after `Scene::import_versioned_snapshot`
    /// (or equivalent serde load).
    ///
    /// Drift threshold = `MIGRATION_DRIFT_TOL` (1.5μm = LOCKED #5).
    pub fn migrate_v3_to_v4_with_sanity(&mut self) -> MigrationReport {
        let mut report = MigrationReport::default();

        // ── Edge curves ───────────────────────────────────────────
        // Collect drift-failed edges first to avoid borrow conflicts
        let mut to_demote: Vec<crate::entities::id::EdgeId> = Vec::new();
        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            match edge.curve() {
                None => report.edges_synthesized_as_line += 1,
                Some(curve) => {
                    if curve_drifts_from_endpoints(curve, edge.v_small(), edge.v_large(), self) {
                        to_demote.push(eid);
                    } else {
                        report.edges_promoted_with_curve += 1;
                    }
                }
            }
        }
        for eid in to_demote {
            self.edges[eid].set_curve(None);
            report.edges_demoted_due_to_drift += 1;
        }

        // ── Face surfaces (MVP — drift check deferred to Phase O) ─
        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            match face.surface() {
                None => report.faces_synthesized_as_plane += 1,
                Some(_) => report.faces_promoted_with_surface += 1,
            }
        }

        report
    }
}

/// Check whether `curve.evaluate(t_min) ≈ v_small_pos` AND
/// `curve.evaluate(t_max) ≈ v_large_pos` within `MIGRATION_DRIFT_TOL`.
/// If either endpoint exceeds tolerance, returns true (drift detected).
///
/// Bezier/BSpline/NURBS curves cannot be reliably checked here because
/// their `evaluate()` may need parameter range clamping; for MVP we
/// only validate Line/Circle/Arc which have direct closed-form eval.
fn curve_drifts_from_endpoints(
    curve: &crate::curves::AnalyticCurve,
    v_small: crate::entities::id::VertId,
    v_large: crate::entities::id::VertId,
    mesh: &Mesh,
) -> bool {
    use crate::curves::AnalyticCurve;
    // Skip drift check for control-point variants — they may use
    // parameter ranges incompatible with vertex endpoints.
    if matches!(curve,
        AnalyticCurve::Bezier { .. }
        | AnalyticCurve::BSpline { .. }
        | AnalyticCurve::NURBS { .. })
    {
        return false; // conservative: don't demote what we can't verify
    }

    let v_small_pos = match mesh.vertex_pos(v_small) { Ok(p) => p, Err(_) => return true };
    let v_large_pos = match mesh.vertex_pos(v_large) { Ok(p) => p, Err(_) => return true };

    let (t_min, t_max) = curve.parameter_range();
    let p_start = match curve.evaluate(t_min, mesh) { Ok(p) => p, Err(_) => return true };
    let p_end = match curve.evaluate(t_max, mesh) { Ok(p) => p, Err(_) => return true };

    // Try forward orientation first (curve t_min → v_small)
    let drift_fwd = (p_start - v_small_pos).length()
        .max((p_end - v_large_pos).length());
    let drift_rev = (p_start - v_large_pos).length()
        .max((p_end - v_small_pos).length());

    let drift = drift_fwd.min(drift_rev);
    drift > MIGRATION_DRIFT_TOL
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-059 §3 Step 4 (6 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;
    use crate::curves::AnalyticCurve;
    use crate::curves::synthesize::synthesize_line_curve;

    fn make_test_mesh_with_one_edge() -> (Mesh, crate::entities::id::EdgeId) {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _new) = m.add_edge(v0, v1).unwrap();
        (m, eid)
    }

    /// ADR-059 §3 Step 4 #1 — Empty mesh produces zero-counts report.
    #[test]
    fn migration_empty_mesh_returns_zero_counts() {
        let mut m = Mesh::new();
        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report, MigrationReport::default());
        assert!(report.is_clean());
    }

    /// ADR-059 §3 Step 4 #2 — Edges without curves count as
    /// "synthesized as Line" (curve_mandatory takes over on demand).
    #[test]
    fn migration_edges_without_curves_synthesize_line() {
        let (mut m, _eid) = make_test_mesh_with_one_edge();
        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report.edges_synthesized_as_line, 1);
        assert_eq!(report.edges_promoted_with_curve, 0);
        assert_eq!(report.edges_demoted_due_to_drift, 0);
        assert!(report.is_clean());
    }

    /// ADR-059 §3 Step 4 #3 — Clean (no drift) Line curve is preserved.
    #[test]
    fn migration_clean_line_curve_preserved() {
        let (mut m, eid) = make_test_mesh_with_one_edge();
        let v_small = m.edges[eid].v_small();
        let v_large = m.edges[eid].v_large();
        // Attach Line curve referencing the same vertex pair (zero drift)
        m.edges[eid].set_curve(Some(synthesize_line_curve(v_small, v_large)));

        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report.edges_promoted_with_curve, 1, "clean Line should be preserved");
        assert_eq!(report.edges_demoted_due_to_drift, 0);
        // Curve still attached after migration
        assert!(m.edges[eid].curve().is_some());
    }

    /// ADR-059 §3 Step 4 #4 — Drift > LOCKED #5 demotes curve to None.
    #[test]
    fn migration_drift_detect_demotes_to_line() {
        let (mut m, eid) = make_test_mesh_with_one_edge();
        // Attach a Circle whose evaluate at t_min would NOT match v_small.
        // Circle at center (100, 100, 0) radius 5 — vastly different from
        // v_small=(0,0,0) and v_large=(10,0,0).
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(100.0, 100.0, 0.0),
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));

        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report.edges_demoted_due_to_drift, 1,
            "drifted curve should be demoted");
        assert_eq!(report.edges_promoted_with_curve, 0);
        // After migration, curve should be None (curve_mandatory will synth Line)
        assert!(m.edges[eid].curve().is_none(),
            "demoted curve should be cleared to None");
    }

    /// ADR-059 §3 Step 4 #5 — Bezier/BSpline/NURBS not demoted (cannot
    /// reliably drift-check; conservative pass-through).
    #[test]
    fn migration_bezier_curve_conservatively_preserved() {
        let (mut m, eid) = make_test_mesh_with_one_edge();
        // Even though this Bezier doesn't pass through endpoints, MVP
        // doesn't drift-check it (DeferredToPhaseI policy).
        m.edges[eid].set_curve(Some(AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(50.0, 50.0, 0.0),
                DVec3::new(60.0, 60.0, 0.0),
                DVec3::new(70.0, 50.0, 0.0),
            ],
        }));

        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report.edges_promoted_with_curve, 1,
            "Bezier conservatively preserved (drift check deferred)");
        assert_eq!(report.edges_demoted_due_to_drift, 0);
    }

    /// ADR-059 §3 Step 4 #6 — MigrationReport sums and clean-check API.
    #[test]
    fn migration_report_counts_match_actual() {
        let mut m = Mesh::new();
        // 3 edges: 2 without curves, 1 with clean Line
        let v0 = m.add_vertex(DVec3::ZERO);
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(30.0, 0.0, 0.0));
        let (_e1, _) = m.add_edge(v0, v1).unwrap();
        let (_e2, _) = m.add_edge(v1, v2).unwrap();
        let (e3, _) = m.add_edge(v2, v3).unwrap();
        let (vs, vl) = (m.edges[e3].v_small(), m.edges[e3].v_large());
        m.edges[e3].set_curve(Some(synthesize_line_curve(vs, vl)));

        let report = m.migrate_v3_to_v4_with_sanity();
        assert_eq!(report.total_edges(), 3);
        assert_eq!(report.edges_synthesized_as_line, 2);
        assert_eq!(report.edges_promoted_with_curve, 1);
        assert!(report.is_clean());
    }
}
