//! Edge entity — connects two vertices, owns a pair of half-edges.

use serde::{Deserialize, Serialize};
use super::id::*;
use super::flags::SharedFlags;
use crate::curves::AnalyticCurve;

/// Edge semantic class — distinguishes real geometry (participates in face
/// synthesis, intersection-splitting, boolean) from reference lines that
/// exist for layout/construction only.
///
/// MVP: Geometry + Centerline. Construction can be added later for
/// scaffolding lines that get auto-cleaned on save.
///
/// Serialization note: `#[serde(default)]` on Edge.class ensures old AXIA
/// files (no class field) load as Geometry — full backward compatibility.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EdgeClass {
    /// 일반 기하 선 — split on intersection, 닫힌 loop 감지 시 face 후보,
    /// boolean 참여. 기존 엔진 동작 그대로 (이 enum의 default).
    #[default]
    Geometry,
    /// 중심선/참조 축 — 교차해도 미분절, face 후보 아님, boolean 미참여.
    /// 평면 배치에서 "벽의 중심" 같은 가상 기준선.
    Centerline,
}

impl EdgeClass {
    /// Raw u32 for WASM boundary. 0 = Geometry, 1 = Centerline.
    pub fn to_raw(self) -> u32 {
        match self {
            EdgeClass::Geometry => 0,
            EdgeClass::Centerline => 1,
        }
    }
    pub fn from_raw(raw: u32) -> Self {
        match raw {
            1 => EdgeClass::Centerline,
            _ => EdgeClass::Geometry,
        }
    }
    /// Whether this class participates in intersection-splitting and face synthesis.
    /// Currently == Geometry, but kept as a predicate in case future classes
    /// (e.g. Construction) also need split behavior.
    pub fn is_topological(self) -> bool {
        matches!(self, EdgeClass::Geometry)
    }
}

/// An edge in the Half-Edge mesh.
///
/// Stores its two endpoint vertices in canonical order (v_small < v_large)
/// and a reference to one of its half-edges for radial traversal.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Edge {
    /// Smaller vertex ID (canonical ordering)
    v_small: VertId,
    /// Larger vertex ID (canonical ordering)
    v_large: VertId,
    /// Geometric tolerance
    tolerance: f64,
    /// One of the half-edges belonging to this edge (radial anchor)
    any_he: HeId,
    /// Active flag for soft-delete
    active: bool,
    /// Shared flags (selection, visibility, etc.)
    flags: SharedFlags,
    /// Semantic class (Geometry default; Centerline etc.). Controls whether
    /// intersection-split / face synthesis / boolean apply to this edge.
    /// `#[serde(default)]` allows old AXIA files (no field) to deserialize.
    #[serde(default)]
    class: EdgeClass,
    /// ADR-028 Phase A — optional analytic curve definition.
    ///
    /// When `None`, the edge is a straight line between v_small and v_large
    /// (default, 100% backward compatible with pre-Phase-A meshes).
    ///
    /// When `Some`, the edge represents an analytic curve. The two endpoints
    /// (v_small, v_large) still anchor the topology — they correspond to the
    /// curve's start/end positions — but the geometric path between them is
    /// defined by the variant (Circle, Arc, etc.).
    ///
    /// `#[serde(default)]` ensures old AXIA files load with `curve = None`.
    #[serde(default)]
    curve: Option<AnalyticCurve>,
}

impl Edge {
    pub fn new(v_small: VertId, v_large: VertId, tolerance: f64) -> Self {
        Self {
            v_small,
            v_large,
            tolerance,
            any_he: HeId::NULL,
            active: true,
            flags: SharedFlags::empty(),
            class: EdgeClass::default(),
            curve: None,
        }
    }

    /// ADR-028 Phase A — read the optional analytic curve.
    #[inline]
    pub fn curve(&self) -> Option<&AnalyticCurve> {
        self.curve.as_ref()
    }

    /// ADR-028 Phase A — set or clear the analytic curve.
    /// `None` reverts to a straight-line edge.
    #[inline]
    pub fn set_curve(&mut self, curve: Option<AnalyticCurve>) {
        self.curve = curve;
    }

    /// ADR-059 Phase N Step 3 — Mandatory curve accessor (drop-in alongside).
    ///
    /// Per ADR-059 §A1.6 lock-in (Phase M pattern): existing `curve()`
    /// returning `Option` is preserved unchanged. `curve_mandatory()` is
    /// the NEW Path D API that always returns an `AnalyticCurve` —
    /// synthesizing a `Line { start: v_small, end: v_large }` if no
    /// explicit curve is attached.
    ///
    /// Phase N Step 4 (Migration) will make this the authoritative
    /// access path; Phase O Tools NURBS-aware will route all consumers
    /// through this accessor.
    #[inline]
    pub fn curve_mandatory(&self) -> AnalyticCurve {
        self.curve.clone().unwrap_or_else(||
            crate::curves::synthesize::synthesize_line_curve(
                self.v_small, self.v_large,
            )
        )
    }

    /// ADR-028 Phase A / ADR-029 Phase B — convenience: true if this edge
    /// has an analytic curve other than a Line variant.
    #[inline]
    pub fn is_curved(&self) -> bool {
        matches!(
            self.curve,
            Some(
                AnalyticCurve::Circle { .. }
                | AnalyticCurve::Arc { .. }
                | AnalyticCurve::Bezier { .. }
                | AnalyticCurve::BSpline { .. }
                | AnalyticCurve::NURBS { .. }
            )
        )
    }

    #[inline]
    pub fn class(&self) -> EdgeClass { self.class }

    #[inline]
    pub fn set_class(&mut self, class: EdgeClass) { self.class = class; }

    #[inline]
    pub fn v_small(&self) -> VertId {
        self.v_small
    }

    #[inline]
    pub fn v_large(&self) -> VertId {
        self.v_large
    }

    #[inline]
    pub fn tolerance(&self) -> f64 {
        self.tolerance
    }

    #[inline]
    pub fn any_he(&self) -> HeId {
        self.any_he
    }

    #[inline]
    pub fn set_any_he(&mut self, he: HeId) {
        self.any_he = he;
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.active
    }

    #[inline]
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
    }

    #[inline]
    pub fn flags(&self) -> SharedFlags {
        self.flags
    }

    #[inline]
    pub fn flags_mut(&mut self) -> &mut SharedFlags {
        &mut self.flags
    }

    /// Check if this edge connects the given two vertices
    pub fn connects(&self, a: VertId, b: VertId) -> bool {
        let key = VertPairKey::new(a, b);
        self.v_small == key.v_small && self.v_large == key.v_large
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_default_curve_is_none() {
        let e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        assert!(e.curve().is_none(), "default Edge.curve should be None");
        assert!(!e.is_curved());
    }

    #[test]
    fn edge_set_curve_to_arc() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        let arc = AnalyticCurve::Arc {
            center: glam::DVec3::ZERO,
            radius: 5.0,
            normal: glam::DVec3::Z,
            basis_u: glam::DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        e.set_curve(Some(arc.clone()));
        assert!(e.curve().is_some());
        assert!(e.is_curved());
        assert_eq!(e.curve(), Some(&arc));
    }

    #[test]
    fn edge_set_curve_clear() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        e.set_curve(Some(AnalyticCurve::Circle {
            center: glam::DVec3::ZERO,
            radius: 1.0,
            normal: glam::DVec3::Z,
            basis_u: glam::DVec3::X,
        }));
        assert!(e.is_curved());
        e.set_curve(None);
        assert!(!e.is_curved());
        assert!(e.curve().is_none());
    }

    /// ADR-059 Phase N Step 3 — curve_mandatory() synthesizes Line when
    /// no explicit curve is attached (drop-in alongside accessor).
    #[test]
    fn adr_059_edge_curve_mandatory_synthesizes_line_when_none() {
        let v0 = VertId::new(7);
        let v1 = VertId::new(13);
        let e = Edge::new(v0, v1, 1e-7);
        assert!(e.curve().is_none(), "no explicit curve attached");
        let mandatory = e.curve_mandatory();
        match mandatory {
            AnalyticCurve::Line { start, end } => {
                assert_eq!(start, v0);
                assert_eq!(end, v1);
            }
            other => panic!("expected synthesized Line, got {:?}", other),
        }
    }

    /// ADR-059 Phase N Step 3 — curve_mandatory() returns explicit curve
    /// when one is attached (no synthesis override).
    #[test]
    fn adr_059_edge_curve_mandatory_returns_attached_curve() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        let circle = AnalyticCurve::Circle {
            center: glam::DVec3::ZERO, radius: 5.0,
            normal: glam::DVec3::Z, basis_u: glam::DVec3::X,
        };
        e.set_curve(Some(circle.clone()));
        let mandatory = e.curve_mandatory();
        assert_eq!(mandatory, circle, "attached curve must NOT be synthesized over");
    }

    #[test]
    fn edge_serialize_with_curve_roundtrip() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        e.set_curve(Some(AnalyticCurve::Circle {
            center: glam::DVec3::new(1.0, 2.0, 3.0),
            radius: 4.0,
            normal: glam::DVec3::Y,
            basis_u: glam::DVec3::X,
        }));
        let json = serde_json::to_string(&e).expect("serialize");
        let e2: Edge = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(e.curve(), e2.curve());
    }

    #[test]
    fn edge_serialize_legacy_no_curve_field_loads_as_none() {
        // Round-trip: serialize, strip the "curve" field (mimicking legacy AXIA
        // files that pre-date Phase A), deserialize → must load with None.
        let original = Edge::new(VertId::default(), VertId::default(), 1e-7);
        let json = serde_json::to_string(&original).expect("serialize");
        // Strip "curve":null entry to simulate a pre-Phase-A file.
        let legacy = json
            .replace(r#","curve":null"#, "")
            .replace(r#""curve":null,"#, "");
        // Confirm we actually stripped it.
        assert!(!legacy.contains("\"curve\""),
            "test setup failed: curve field still present in legacy JSON");
        let e: Edge = serde_json::from_str(&legacy).expect("legacy roundtrip");
        assert!(e.curve().is_none(), "legacy edge must load with curve=None");
    }

    #[test]
    fn edge_is_curved_false_for_line_variant() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        e.set_curve(Some(AnalyticCurve::Line {
            start: VertId::default(),
            end: VertId::default(),
        }));
        // Line variant of AnalyticCurve is treated as straight line — not curved.
        assert!(!e.is_curved());
    }

    #[test]
    fn edge_is_curved_true_for_nurbs() {
        let mut e = Edge::new(VertId::default(), VertId::default(), 1e-7);
        e.set_curve(Some(AnalyticCurve::NURBS {
            control_pts: vec![
                glam::DVec3::ZERO,
                glam::DVec3::X,
                glam::DVec3::new(2.0, 0.0, 0.0),
            ],
            weights: vec![1.0, 1.0, 1.0],
            knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            degree: 2,
        }));
        assert!(e.is_curved());
    }
}
