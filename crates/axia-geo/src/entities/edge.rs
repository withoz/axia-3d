//! Edge entity — connects two vertices, owns a pair of half-edges.

use std::cell::RefCell;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use super::id::*;
use super::flags::SharedFlags;
use crate::curves::AnalyticCurve;

// ════════════════════════════════════════════════════════════════════
// ADR-061 Phase P-narrow Step 1b — Edge cache slots (Z.2 Curve Hover).
//
// Mirrors Step 1a (Face) — same decisions:
//   D-A=RefCell  → interior mutability (consistent with Face).
//   D-B=추가     → edge_cache_invalidates_after_load regression.
//   D-C=작성     → Edge does NOT derive PartialEq either; defer.
//   D-D=세분화   → Step 1b is Edge only; mirrors 1a.
//
// Lock-ins (ADR-061 §D):
//   #1 Cache field on Edge (Phase L compatible).
//   #2 Line excluded from caching (closed-form distance).
//   #5 Cache excluded from serialization.
// ════════════════════════════════════════════════════════════════════

/// ADR-061 §B — One cache entry attached to an Edge. Holds the
/// tessellated polyline used as Newton initial-seed for
/// `ray_to_curve_distance` (ADR-040 P25).
///
/// Versioned against the owning Edge's `curve_version` — mismatch
/// invalidates this entry on next read.
#[derive(Clone, Debug)]
pub struct PolylineCacheEntry {
    /// Edge curve_version observed when this entry was computed.
    pub curve_version: u64,
    /// Polyline sampled at HOVER_CHORD_TOL. Line variant is excluded
    /// per §D #2 — `should_cache_polyline` helper enforces this.
    pub points: Vec<DVec3>,
    /// ADR-061 Step 5 — Monotonic last-access tick (Mesh `cache_clock`).
    /// Updated on populate AND on cache hit. Used by
    /// `Mesh::evict_lru_if_over_cap`.
    pub last_access_tick: u64,
}

impl PolylineCacheEntry {
    /// ADR-061 §D #4 — Estimated heap bytes for byte-cap accounting.
    pub fn estimated_bytes(&self) -> usize {
        48 + self.points.len() * 24
    }
}

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
/// Stores its two endpoint vertices in canonical order
/// (v_small ≤ v_large — equality allowed for self-loops per ADR-089) and
/// a reference to one of its half-edges for radial traversal.
///
/// **ADR-089 Phase 2 (A-β, 2026-05-08)**: Self-loop edges (`v_small ==
/// v_large`) are explicitly permitted as an additive schema relaxation.
/// They represent **closed analytic curves** (e.g., full circle, closed
/// Bezier loop, closed B-spline) where the entire curve loops back to a
/// single anchor vertex. The geometric path between the (identical)
/// endpoints is defined by `Edge.curve = Some(...)`.
///
/// Open edges (default polygon mesh) maintain `v_small < v_large` strict
/// ordering by `VertPairKey::new`. Self-loops are an opt-in extension —
/// callers that don't construct self-loop edges experience zero behavior
/// change (메타-원칙 #14 의 deepest realization).
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

    /// ADR-061 Phase P-narrow §B — incremented on every mutation of
    /// `curve` (or, in Step 2, of endpoint vertices). Cache entries
    /// observe this; mismatch = MISS = recompute via Step 4 hot-path.
    /// Excluded from serialization (volatile cache state, §D #5).
    #[serde(skip)]
    curve_version: u64,

    /// ADR-061 Phase P-narrow Z.2 — Per-edge cached tessellation
    /// polyline for hover Newton seed. `RefCell` (D-A) enables lazy
    /// fill from `&Edge` read paths.
    #[serde(skip)]
    polyline_cache: RefCell<Option<PolylineCacheEntry>>,

    /// ADR-088 Phase 1 — optional curve owner group ID for selection-layer
    /// promotion (LOCKED #15 P22.5). When `Some(id)`, this edge is one of
    /// N segments of a single logical analytic curve (e.g., a Circle's
    /// 24 segments all share the same `curve_owner_id`). SelectTool walk
    /// promotes from one segment to all sharing the owner_id.
    ///
    /// `None` = single-segment edge (legacy, no grouping).
    ///
    /// Drop-in alongside `curve` field (ADR-028) — additive only. DCEL
    /// topology UNCHANGED. `serde(default)` allows old `.axia` files to
    /// load with `curve_owner_id = None` automatically.
    #[serde(default)]
    curve_owner_id: Option<u32>,
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
            // ADR-061 Step 1b — cache slots start at version 0 + empty.
            curve_version: 0,
            polyline_cache: RefCell::new(None),
            // ADR-088 Phase 1 — no owner group by default (single segment).
            curve_owner_id: None,
        }
    }

    /// ADR-088 Phase 1 — read the optional curve owner group ID.
    /// `None` = single segment (legacy). `Some(id)` = part of N-segment
    /// analytic curve group sharing the same id.
    #[inline]
    pub fn curve_owner_id(&self) -> Option<u32> {
        self.curve_owner_id
    }

    /// ADR-088 Phase 1 — set the curve owner group ID. Use `Mesh::
    /// next_curve_owner_id()` to allocate a fresh monotonic id, then
    /// call this on each segment of a single logical curve.
    #[inline]
    pub fn set_curve_owner_id(&mut self, owner: Option<u32>) {
        self.curve_owner_id = owner;
    }

    // ── ADR-061 Phase P-narrow Step 1b — Cache accessors ─────────────

    /// ADR-061 §B — Current curve_version counter. Read-only; increment
    /// is reserved for `set_curve` and Step 2 endpoint-mutator hooks.
    #[inline]
    pub fn curve_version(&self) -> u64 { self.curve_version }

    /// ADR-061 §B — Borrow the polyline cache slot.
    #[inline]
    pub fn polyline_cache(&self) -> std::cell::Ref<'_, Option<PolylineCacheEntry>> {
        self.polyline_cache.borrow()
    }

    /// ADR-061 §B — Mutator-internal helper (Step 2/4). Increments
    /// curve_version after any mutation of `self.curve` or endpoints.
    #[inline]
    pub(crate) fn bump_curve_version(&mut self) {
        self.curve_version = self.curve_version.wrapping_add(1);
    }

    /// ADR-061 §B — Internal cache populate (Step 4 will use).
    #[inline]
    pub(crate) fn cache_polyline(&self, entry: PolylineCacheEntry) {
        *self.polyline_cache.borrow_mut() = Some(entry);
    }

    /// ADR-061 §B — Drop cached polyline (Step 5 LRU eviction).
    #[inline]
    pub(crate) fn invalidate_polyline_cache(&self) {
        *self.polyline_cache.borrow_mut() = None;
    }

    /// ADR-061 Step 5 — Touch-on-access for HIT path.
    #[inline]
    pub(crate) fn touch_polyline_cache(&self, tick: u64) {
        if let Some(entry) = self.polyline_cache.borrow_mut().as_mut() {
            entry.last_access_tick = tick;
        }
    }

    /// ADR-061 §D #2 — Lock-in: Line edges are excluded from caching
    /// (closed-form distance — cache wastes memory). Single source of
    /// truth for the inclusion policy (mirrors Face::should_cache_normals).
    pub fn should_cache_polyline(&self) -> bool {
        match &self.curve {
            None => false,                                       // straight edge (default)
            Some(AnalyticCurve::Line { .. }) => false,           // §D #2 lock-in
            Some(_) => true,                                     // Circle/Arc/Bezier/BSpline/NURBS
        }
    }

    /// ADR-028 Phase A — read the optional analytic curve.
    #[inline]
    pub fn curve(&self) -> Option<&AnalyticCurve> {
        self.curve.as_ref()
    }

    /// ADR-028 Phase A — set or clear the analytic curve.
    /// `None` reverts to a straight-line edge.
    ///
    /// ADR-061 Step 1b — bumps `curve_version` and invalidates cached
    /// polyline (any cached entry's curve_version will mismatch on the
    /// next read → MISS → recompute via Step 4 hot-path).
    #[inline]
    pub fn set_curve(&mut self, curve: Option<AnalyticCurve>) {
        self.curve = curve;
        self.bump_curve_version();
        self.invalidate_polyline_cache();
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

    /// ADR-089 Phase 2 (A-β) — true if this edge is a self-loop, i.e.,
    /// both endpoints are the same vertex. Self-loops represent closed
    /// analytic curves (full circle, closed Bezier, etc.) per `Edge.curve`.
    ///
    /// For polygon (default) edges this returns `false`. For closed-curve
    /// edges (constructed via future `add_face_with_curve_loops` API in
    /// A-δ) this returns `true`.
    ///
    /// Caller invariant: a self-loop edge SHOULD have `Edge.curve = Some(...)`
    /// (analytic curve definition). A self-loop without curve attached is
    /// degenerate (collapsed line) and should be rejected by face synthesis.
    #[inline]
    pub fn is_self_loop(&self) -> bool {
        self.v_small == self.v_large
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

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 1b — Cache slot regression tests
    //
    // Mirrors Step 1a (Face) — 4 invariants, none #[ignore]:
    //   1. edge_default_cache_state         — version=0, cache=None
    //   2. edge_set_curve_bumps_version     — set_curve bumps + clears
    //   3. edge_serde_skips_cache           — roundtrip drops cache
    //   4. edge_cache_invalidates_after_load (D-B) — version reset on load
    // ════════════════════════════════════════════════════════════════

    fn make_test_edge() -> Edge {
        Edge::new(VertId::new(0), VertId::new(1), 1e-6)
    }

    /// ADR-061 §B — Fresh edge starts at version 0 + empty cache. Line
    /// curve (default, no curve attached) is NOT cacheable per §D #2.
    #[test]
    fn edge_default_cache_state() {
        let e = make_test_edge();
        assert_eq!(e.curve_version(), 0,
            "new edge must start at curve_version=0");
        assert!(e.polyline_cache().is_none(),
            "new edge must have empty polyline_cache");
        assert!(!e.should_cache_polyline(),
            "edge with no curve attached must not be marked cacheable");
    }

    /// ADR-061 §B — `set_curve` bumps curve_version and clears any
    /// cached entry. Mirrors Face::set_surface invariant.
    #[test]
    fn edge_set_curve_bumps_version() {
        let mut e = make_test_edge();
        let v0 = e.curve_version();
        // Pre-populate cache with stale data.
        e.cache_polyline(PolylineCacheEntry {
            curve_version: v0,
            points: vec![DVec3::ZERO, DVec3::X],
            last_access_tick: 0,
        });
        assert!(e.polyline_cache().is_some());

        let circle = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        e.set_curve(Some(circle));

        assert_eq!(e.curve_version(), v0 + 1,
            "set_curve must bump curve_version by 1");
        assert!(e.polyline_cache().is_none(),
            "set_curve must invalidate polyline_cache");
        // §D #2 — Circle is cacheable.
        assert!(e.should_cache_polyline(),
            "Circle edge must be marked cacheable");

        // §D #2 — explicit Line curve is NOT cacheable (closed-form).
        e.set_curve(Some(AnalyticCurve::Line {
            start: VertId::new(0),
            end: VertId::new(1),
        }));
        assert!(!e.should_cache_polyline(),
            "Line curve must not be marked cacheable per §D #2");
    }

    /// ADR-061 §D #5 — Cache state MUST NOT survive serialization
    /// roundtrip (cache is volatile derived data).
    #[test]
    fn edge_serde_skips_cache() {
        let mut e = make_test_edge();
        let arc = AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        e.set_curve(Some(arc));
        e.cache_polyline(PolylineCacheEntry {
            curve_version: e.curve_version(),
            points: vec![DVec3::X, DVec3::new(0.707, 0.707, 0.0), DVec3::Y],
            last_access_tick: 0,
        });
        assert!(e.polyline_cache().is_some());
        assert_eq!(e.curve_version(), 1);

        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("polyline_cache"),
            "polyline_cache leaked into serialization: {}", json);
        assert!(!json.contains("curve_version"),
            "curve_version leaked into serialization: {}", json);

        let restored: Edge = serde_json::from_str(&json).unwrap();
        assert!(restored.polyline_cache().is_none(),
            "deserialized edge must have empty cache");
        assert_eq!(restored.curve_version(), 0,
            "deserialized edge curve_version must reset to 0");
    }

    /// ADR-061 D-B — After load, pre-save version numbers MUST NOT
    /// register as a cache hit (versions reset to 0 on deserialize).
    #[test]
    fn edge_cache_invalidates_after_load() {
        let mut original = make_test_edge();
        original.set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::ZERO, radius: 1.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));
        original.bump_curve_version();
        original.bump_curve_version();
        let pre_save_v = original.curve_version();   // = 3
        let json = serde_json::to_string(&original).unwrap();

        let restored: Edge = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.curve_version(), 0);

        // Synthetic stale cache entry with pre-save version — would be
        // a bug to use; version comparator MUST detect mismatch.
        let stale = PolylineCacheEntry {
            curve_version: pre_save_v,
            points: vec![DVec3::X],
            last_access_tick: 0,
        };
        let hit = stale.curve_version == restored.curve_version();
        assert!(!hit,
            "stale cache from pre-save state MUST NOT register as cache hit \
             after load (pre={} vs post={})",
            pre_save_v, restored.curve_version());
    }

    // ════════════════════════════════════════════════════════════════════
    // ADR-089 Phase 2 (A-β) — Edge schema relaxation: self-loop allowed.
    //
    // Invariant tests for closed analytic curve edges (Phase 2 base).
    // Schema only — no behavior change for polygon edges. Self-loop case
    // is opt-in (callers must explicitly construct with v_small == v_large).
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn adr089_a_beta_open_edge_is_not_self_loop() {
        // Default polygon edge (v_small != v_large) — is_self_loop() = false.
        let v0 = VertId::new(0);
        let v1 = VertId::new(1);
        let e = Edge::new(v0, v1, 1e-6);
        assert!(!e.is_self_loop(),
            "ADR-089 A-β L1: open edge must not be self-loop");
        assert_eq!(e.v_small(), v0);
        assert_eq!(e.v_large(), v1);
    }

    #[test]
    fn adr089_a_beta_self_loop_edge_constructible() {
        // Self-loop case: v_small == v_large == single anchor vertex.
        // Schema allows this construction (additive, opt-in for closed curves).
        let v_anchor = VertId::new(42);
        let e = Edge::new(v_anchor, v_anchor, 1e-6);
        assert!(e.is_self_loop(),
            "ADR-089 A-β L1: edge with v_small == v_large is self-loop");
        assert_eq!(e.v_small(), v_anchor);
        assert_eq!(e.v_large(), v_anchor);
    }

    #[test]
    fn adr089_a_beta_self_loop_with_circle_curve_attached() {
        // Closed curve case: self-loop edge + analytic curve attached.
        // This is the canonical Phase 2 representation of a closed circle.
        let v_anchor = VertId::new(5);
        let mut e = Edge::new(v_anchor, v_anchor, 1e-6);
        e.set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));
        assert!(e.is_self_loop());
        assert!(matches!(e.curve(), Some(AnalyticCurve::Circle { .. })));
    }

    #[test]
    fn adr089_a_beta_vert_pair_key_self_loop_canonical() {
        // VertPairKey::new(v, v) yields { v_small: v, v_large: v }.
        // Self-loop key is canonically equal to itself (HashMap stable).
        use crate::entities::id::VertPairKey;
        let v = VertId::new(10);
        let key1 = VertPairKey::new(v, v);
        let key2 = VertPairKey::new(v, v);
        assert_eq!(key1, key2);
        assert_eq!(key1.v_small, v);
        assert_eq!(key1.v_large, v);
    }

    #[test]
    fn adr089_a_beta_self_loop_serde_roundtrip_preserves() {
        // Serialize + deserialize self-loop edge with curve. Schema must
        // preserve self-loop semantics across `.axia` save/load.
        let v = VertId::new(7);
        let mut e = Edge::new(v, v, 1e-6);
        e.set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(1.0, 2.0, 3.0),
            radius: 10.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));
        let json = serde_json::to_string(&e).unwrap();
        let restored: Edge = serde_json::from_str(&json).unwrap();
        assert!(restored.is_self_loop(),
            "ADR-089 A-β L1: self-loop must survive serde roundtrip");
        assert_eq!(restored.v_small(), v);
        assert_eq!(restored.v_large(), v);
        assert!(matches!(restored.curve(), Some(AnalyticCurve::Circle { .. })));
    }
}
