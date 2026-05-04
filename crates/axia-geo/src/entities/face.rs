//! Face entity — a planar polygon bounded by half-edge loops.

use std::cell::RefCell;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use super::id::*;
use super::flags::SharedFlags;
use crate::surfaces::AnalyticSurface;

// ════════════════════════════════════════════════════════════════════
// ADR-061 Phase P-narrow Step 1a — Face cache slots (Z.1 Normal Cache).
//
// Decisions:
//   D-A=RefCell  → interior mutability so &Mesh read paths can lazy-fill
//                  cache without breaking existing tessellate_face_surface
//                  signature (drop-in alongside, §B lock-in).
//   D-B=추가     → cache_invalidates_after_load regression added in tests.
//   D-C=작성     → Face does not derive PartialEq currently; defer custom
//                  impl until first consumer needs it (no API inflation).
//   D-D=세분화   → Step 1a is Face only; Step 1b will mirror for Edge.
//
// Lock-ins (ADR-061 §D):
//   #1 Cache field position = derived data on Face (Phase L compatible).
//   #5 Cache excluded from serialization (#[serde(skip)] + Default).
// ════════════════════════════════════════════════════════════════════

/// ADR-061 §A — One cache entry attached to a Face. Holds per-vertex
/// analytic-evaluated normals at the face's outer-loop vertices.
///
/// Versioned against the owning Face's `surface_version` AND
/// `boundary_version` — both must match for a cache hit. Any mutator
/// that bumps either version invalidates this entry on next read.
#[derive(Clone, Debug)]
pub struct NormalCacheEntry {
    /// Face surface_version observed when this entry was computed.
    pub surface_version: u64,
    /// Face boundary_version observed when this entry was computed.
    pub boundary_version: u64,
    /// Per-vertex normals in outer-loop order (Plane is excluded per
    /// ADR-061 §D #2 — `should_cache` helper enforces this).
    pub per_vertex_normals: Vec<DVec3>,
    /// ADR-061 Step 5 — Monotonic last-access tick (Mesh `cache_clock`).
    /// Updated on populate AND on cache hit (touch-on-access). Used by
    /// `Mesh::evict_lru_if_over_cap` to drop oldest entries first.
    pub last_access_tick: u64,
}

impl NormalCacheEntry {
    /// ADR-061 §D #4 — Estimated heap bytes for byte-cap accounting.
    /// `Vec<DVec3>` = `24 bytes/vec3`; struct overhead conservatively 48.
    pub fn estimated_bytes(&self) -> usize {
        48 + self.per_vertex_normals.len() * 24
    }
}

/// Reference to a half-edge loop (outer boundary or hole).
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct LoopRef {
    /// First half-edge in the loop
    pub start: HeId,
    /// True for outer boundary (CCW), false for holes (CW)
    pub is_outer: bool,
}

impl LoopRef {
    pub fn new(start: HeId, is_outer: bool) -> Self {
        Self { start, is_outer }
    }
}

impl Default for LoopRef {
    fn default() -> Self {
        Self {
            start: HeId::NULL,
            is_outer: true,
        }
    }
}

/// A face in the Half-Edge mesh.
///
/// A face is a planar polygon defined by:
/// - One outer boundary loop (CCW winding)
/// - Zero or more inner loops (holes, CW winding)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Face {
    /// Outer boundary loop
    outer: LoopRef,
    /// Inner loops (holes) — SmallVec optimized for 0-1 holes
    inners: SmallVec<[LoopRef; 1]>,
    /// Geometric tolerance
    tolerance: f64,
    /// Cached unit normal vector
    normal: DVec3,
    /// Parent face (for hierarchical grouping)
    parent: Option<FaceId>,
    /// Material reference
    material: MaterialId,
    /// Double-sided rendering
    double_sided: bool,
    /// Active flag for soft-delete
    active: bool,
    /// Visibility flag
    visible: bool,
    /// Shared flags (selection, etc.)
    flags: SharedFlags,
    /// ADR-031 Phase D — optional analytic surface definition.
    /// `None` = polygon face (default, backward-compat).
    /// `Some` = parametric surface, view-time tessellation.
    #[serde(default)]
    surface: Option<AnalyticSurface>,

    /// ADR-061 Phase P-narrow §A — incremented on every mutation of
    /// `surface`. Cache entries observe this; mismatch = MISS = recompute.
    /// Excluded from serialization (volatile cache state, §D #5).
    #[serde(skip)]
    surface_version: u64,

    /// ADR-061 Phase P-narrow §A — incremented on every mutation of
    /// outer or inner loops (boundary topology change).
    #[serde(skip)]
    boundary_version: u64,

    /// ADR-061 Phase P-narrow Z.1 — Per-face cached analytic normals.
    /// `RefCell` (D-A=RefCell) enables lazy fill from `&Face` read paths
    /// without cascading mutability. Excluded from serialization.
    #[serde(skip)]
    normal_cache: RefCell<Option<NormalCacheEntry>>,
}

impl Face {
    pub fn new(outer: LoopRef, normal: DVec3, tolerance: f64, material: MaterialId) -> Self {
        Self {
            outer,
            inners: SmallVec::new(),
            tolerance,
            normal,
            parent: None,
            material,
            double_sided: false,
            active: true,
            visible: true,
            flags: SharedFlags::empty(),
            surface: None,
            // ADR-061 Step 1a — cache slots start at version 0 + empty.
            surface_version: 0,
            boundary_version: 0,
            normal_cache: RefCell::new(None),
        }
    }

    // ── ADR-061 Phase P-narrow Step 1a — Cache accessors ─────────────
    //
    // Step 1a only adds the slots and read-only accessors. Step 2 will
    // wire up version bumps to all surface/boundary mutators.

    /// ADR-061 §A — Current surface_version counter. Read-only accessor;
    /// increment is reserved for `set_surface` and Step 2 mutator hooks.
    #[inline]
    pub fn surface_version(&self) -> u64 { self.surface_version }

    /// ADR-061 §A — Current boundary_version counter.
    #[inline]
    pub fn boundary_version(&self) -> u64 { self.boundary_version }

    /// ADR-061 §A — Borrow the cache slot. `None` = no cached entry yet
    /// or invalidated.
    #[inline]
    pub fn normal_cache(&self) -> std::cell::Ref<'_, Option<NormalCacheEntry>> {
        self.normal_cache.borrow()
    }

    /// ADR-061 §A — Mutator-internal helper for Step 2/3. Increments
    /// surface_version (use after any mutation of `self.surface`).
    /// Pub(crate) keeps this off the public API surface.
    #[inline]
    pub(crate) fn bump_surface_version(&mut self) {
        self.surface_version = self.surface_version.wrapping_add(1);
    }

    /// ADR-061 §A — Mutator-internal helper for Step 2. Increments
    /// boundary_version (use after any mutation of outer/inner loops).
    #[inline]
    pub(crate) fn bump_boundary_version(&mut self) {
        self.boundary_version = self.boundary_version.wrapping_add(1);
    }

    /// ADR-061 §A — Internal cache populate (Step 3 will use). For now
    /// crate-private; not exposed to WASM until Step 3 hot-path.
    #[inline]
    pub(crate) fn cache_normals(&self, entry: NormalCacheEntry) {
        *self.normal_cache.borrow_mut() = Some(entry);
    }

    /// ADR-061 §A — Drop cached entry (used by Step 5 LRU eviction).
    #[inline]
    pub(crate) fn invalidate_normal_cache(&self) {
        *self.normal_cache.borrow_mut() = None;
    }

    /// ADR-061 Step 5 — Touch-on-access: update `last_access_tick` if a
    /// cache entry exists. No-op if cache is empty. Used by hot-path
    /// HIT to keep LRU ordering accurate.
    #[inline]
    pub(crate) fn touch_normal_cache(&self, tick: u64) {
        if let Some(entry) = self.normal_cache.borrow_mut().as_mut() {
            entry.last_access_tick = tick;
        }
    }

    /// ADR-061 §D #2 — Lock-in: Plane surfaces are excluded from caching
    /// (all vertex normals identical → cache wastes memory). This helper
    /// is the single source of truth for the inclusion policy.
    pub fn should_cache_normals(&self) -> bool {
        match &self.surface {
            None => false,                                          // polygon face
            Some(AnalyticSurface::Plane { .. }) => false,           // §D #2 lock-in
            Some(_) => true,                                        // Cylinder/Sphere/Cone/Torus/tensor
        }
    }

    /// ADR-031 Phase D — read the optional analytic surface.
    #[inline]
    pub fn surface(&self) -> Option<&AnalyticSurface> {
        self.surface.as_ref()
    }

    /// ADR-031 Phase D — set or clear the analytic surface.
    /// `None` reverts to a planar polygon face.
    ///
    /// ADR-061 Step 1a — bumps `surface_version` and invalidates cached
    /// normals (any cached entry's surface_version will mismatch on the
    /// next read → MISS → recompute via Step 3 hot-path).
    #[inline]
    pub fn set_surface(&mut self, surface: Option<AnalyticSurface>) {
        self.surface = surface;
        self.bump_surface_version();
        self.invalidate_normal_cache();
    }

    /// ADR-059 Phase N Step 3 — Mandatory surface accessor (drop-in alongside).
    ///
    /// Per ADR-059 §A1.6 lock-in (Phase M pattern): existing `surface()`
    /// returning `Option` is preserved unchanged. `surface_mandatory()` is
    /// the NEW Path D API that always returns an `AnalyticSurface` —
    /// synthesizing a best-fit `Plane` from the supplied outer-loop
    /// vertex positions if no explicit surface is attached.
    ///
    /// Caller passes `outer_verts` (resolved DVec3 positions of the
    /// face's outer loop) since `Face` itself is decoupled from `Mesh`.
    /// Phase O integration will provide `Mesh::face_surface_mandatory(fid)`
    /// that handles the lookup.
    #[inline]
    pub fn surface_mandatory(&self, outer_verts: &[DVec3]) -> AnalyticSurface {
        self.surface.clone().unwrap_or_else(||
            crate::curves::synthesize::synthesize_plane_surface(outer_verts)
        )
    }

    /// ADR-031 Phase D — true if a non-Plane analytic surface is attached.
    #[inline]
    pub fn has_curved_surface(&self) -> bool {
        matches!(
            self.surface,
            Some(
                AnalyticSurface::Cylinder { .. }
                | AnalyticSurface::Sphere { .. }
                | AnalyticSurface::Cone { .. }
                | AnalyticSurface::Torus { .. }
            )
        )
    }

    // --- Getters ---
    #[inline] pub fn outer(&self) -> LoopRef { self.outer }
    #[inline] pub fn inners(&self) -> &[LoopRef] { &self.inners }
    #[inline] pub fn normal(&self) -> DVec3 { self.normal }
    #[inline] pub fn tolerance(&self) -> f64 { self.tolerance }
    #[inline] pub fn parent(&self) -> Option<FaceId> { self.parent }
    #[inline] pub fn material(&self) -> MaterialId { self.material }
    #[inline] pub fn is_double_sided(&self) -> bool { self.double_sided }
    #[inline] pub fn is_active(&self) -> bool { self.active }
    #[inline] pub fn is_visible(&self) -> bool { self.visible }
    #[inline] pub fn flags(&self) -> SharedFlags { self.flags }

    // --- Setters ---
    /// ADR-061 Step 2 — bumps boundary_version + invalidates normal_cache.
    #[inline]
    pub fn set_outer(&mut self, l: LoopRef) {
        self.outer = l;
        self.bump_boundary_version();
        self.invalidate_normal_cache();
    }
    #[inline] pub fn set_normal(&mut self, n: DVec3) { self.normal = n; }
    #[inline] pub fn set_parent(&mut self, p: Option<FaceId>) { self.parent = p; }
    #[inline] pub fn set_material(&mut self, m: MaterialId) { self.material = m; }
    #[inline] pub fn set_double_sided(&mut self, ds: bool) { self.double_sided = ds; }
    #[inline] pub fn set_active(&mut self, a: bool) {
        self.active = a;
        // Inactive faces cannot serve cached data; drop on deactivation.
        if !a { self.invalidate_normal_cache(); }
    }
    #[inline] pub fn set_visible(&mut self, v: bool) { self.visible = v; }
    #[inline] pub fn flags_mut(&mut self) -> &mut SharedFlags { &mut self.flags }

    /// Add an inner loop (hole) to this face.
    /// ADR-061 Step 2 — bumps boundary_version + invalidates normal_cache.
    pub fn add_inner(&mut self, inner: LoopRef) {
        self.inners.push(inner);
        self.bump_boundary_version();
        self.invalidate_normal_cache();
    }

    /// Get mutable reference to inner loops.
    ///
    /// **ADR-061 Step 2 caveat**: this is an unguarded escape hatch —
    /// callers MUST invoke `bump_boundary_version_after_inners_mut()`
    /// after any modification (push/remove/clear). Prefer `add_inner` /
    /// `clear_inners` which auto-bump.
    pub fn inners_mut(&mut self) -> &mut SmallVec<[LoopRef; 1]> {
        &mut self.inners
    }

    /// ADR-061 Step 2 — caller-driven bump for `inners_mut` mutations.
    /// Idempotent at the cache level — the version monotonically advances.
    #[inline]
    pub fn bump_boundary_version_after_inners_mut(&mut self) {
        self.bump_boundary_version();
        self.invalidate_normal_cache();
    }

    /// ADR-061 Step 2 — clear all inner loops (auto-bumps).
    pub fn clear_inners(&mut self) {
        if !self.inners.is_empty() {
            self.inners.clear();
            self.bump_boundary_version();
            self.invalidate_normal_cache();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::id::{HeId, VertId};
    use crate::entities::{LoopRef, MaterialId};

    fn make_test_face() -> Face {
        Face::new(
            LoopRef { start: HeId::default(), is_outer: true },
            DVec3::Z,
            1e-7,
            MaterialId::new(0),
        )
    }

    /// ADR-059 Phase N Step 3 — surface_mandatory() synthesizes Plane
    /// from outer-loop vertex positions when no explicit surface attached.
    #[test]
    fn adr_059_face_surface_mandatory_synthesizes_plane_when_none() {
        let f = make_test_face();
        assert!(f.surface().is_none(), "no explicit surface attached");
        // CCW XY square (outer loop verts)
        let outer = vec![
            DVec3::new(0.0, 0.0, 5.0),
            DVec3::new(1.0, 0.0, 5.0),
            DVec3::new(1.0, 1.0, 5.0),
            DVec3::new(0.0, 1.0, 5.0),
        ];
        let mandatory = f.surface_mandatory(&outer);
        match mandatory {
            AnalyticSurface::Plane { origin, normal, .. } => {
                // Centroid = (0.5, 0.5, 5.0), Newell normal = +Z
                assert!((origin - DVec3::new(0.5, 0.5, 5.0)).length() < 1e-9);
                assert!((normal - DVec3::Z).length() < 1e-9);
            }
            other => panic!("expected synthesized Plane, got {:?}", other),
        }
    }

    /// ADR-059 Phase N Step 3 — surface_mandatory() returns attached
    /// surface when one is set (no synthesis override).
    #[test]
    fn adr_059_face_surface_mandatory_returns_attached_surface() {
        let mut f = make_test_face();
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 3.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 5.0),
        };
        f.set_surface(Some(cyl.clone()));
        let mandatory = f.surface_mandatory(&[]);
        assert_eq!(mandatory, cyl, "attached surface must NOT be synthesized over");
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-061 Phase P-narrow Step 1a — Cache slot regression tests
    //
    // Step 1a invariants (4 tests, none #[ignore] per §X.5 #6):
    //   1. face_default_cache_state         — fresh face has empty cache
    //   2. face_set_surface_bumps_version   — set_surface increments version
    //   3. face_serde_skips_cache           — roundtrip drops cache state
    //   4. face_cache_invalidates_after_load (D-B) — load → mutate → version mismatch
    // ════════════════════════════════════════════════════════════════

    /// ADR-061 §A — A freshly constructed Face has version=0 and an
    /// empty normal_cache. Establishes the documented initial state.
    #[test]
    fn face_default_cache_state() {
        let f = make_test_face();
        assert_eq!(f.surface_version(), 0,
            "new face must start at surface_version=0");
        assert_eq!(f.boundary_version(), 0,
            "new face must start at boundary_version=0");
        assert!(f.normal_cache().is_none(),
            "new face must have empty normal_cache");
        // Plane policy (§D #2): polygon face is NOT cacheable.
        assert!(!f.should_cache_normals(),
            "polygon (no surface) face must not be marked cacheable");
    }

    /// ADR-061 §A — `set_surface` bumps surface_version and clears any
    /// cached entry (the current MUST become stale on the next read).
    #[test]
    fn face_set_surface_bumps_version() {
        let mut f = make_test_face();
        let v0 = f.surface_version();
        // Pre-populate cache with stale data.
        f.cache_normals(NormalCacheEntry {
            surface_version: v0,
            boundary_version: 0,
            per_vertex_normals: vec![DVec3::Z, DVec3::Z],
            last_access_tick: 0,
        });
        assert!(f.normal_cache().is_some());

        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        };
        f.set_surface(Some(cyl));

        assert_eq!(f.surface_version(), v0 + 1,
            "set_surface must bump surface_version by 1");
        assert!(f.normal_cache().is_none(),
            "set_surface must invalidate normal_cache");
        // §D #2 — Cylinder is cacheable.
        assert!(f.should_cache_normals(),
            "Cylinder face must be marked cacheable");
    }

    /// ADR-061 §D #5 — Cache state MUST NOT survive serialization
    /// roundtrip (cache is volatile derived data).
    #[test]
    fn face_serde_skips_cache() {
        let mut f = make_test_face();
        // Populate cache + bump versions.
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        };
        f.set_surface(Some(cyl));
        f.bump_boundary_version();
        f.cache_normals(NormalCacheEntry {
            surface_version: f.surface_version(),
            boundary_version: f.boundary_version(),
            per_vertex_normals: vec![DVec3::X, DVec3::Y, DVec3::Z],
            last_access_tick: 0,
        });
        assert!(f.normal_cache().is_some());
        assert_eq!(f.surface_version(), 1);
        assert_eq!(f.boundary_version(), 1);

        let json = serde_json::to_string(&f).unwrap();
        // Cache + version fields MUST NOT appear in JSON output.
        assert!(!json.contains("normal_cache"),
            "normal_cache leaked into serialization: {}", json);
        assert!(!json.contains("surface_version"),
            "surface_version leaked into serialization: {}", json);
        assert!(!json.contains("boundary_version"),
            "boundary_version leaked into serialization: {}", json);

        let restored: Face = serde_json::from_str(&json).unwrap();
        assert!(restored.normal_cache().is_none(),
            "deserialized face must have empty cache");
        assert_eq!(restored.surface_version(), 0,
            "deserialized face surface_version must reset to 0");
        assert_eq!(restored.boundary_version(), 0,
            "deserialized face boundary_version must reset to 0");
    }

    /// ADR-061 D-B — After load (deserialize), if a mutation happens
    /// the resulting state MUST be cache-MISS-consistent: any pre-load
    /// cache entry the user might re-attach with old version numbers
    /// must mismatch and force recompute.
    ///
    /// Concretely: deserialize gives surface_version=0; if some code
    /// path naively used a stale cache entry recorded with version=5
    /// (from before the save), the version comparator catches it.
    #[test]
    fn face_cache_invalidates_after_load() {
        // Build a face, save snapshot.
        let mut original = make_test_face();
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        };
        original.set_surface(Some(cyl.clone()));
        original.bump_boundary_version();
        original.bump_boundary_version();
        let pre_save_surface_v = original.surface_version();   // = 1
        let pre_save_boundary_v = original.boundary_version(); // = 2
        let json = serde_json::to_string(&original).unwrap();

        // Restore (versions reset to 0 per #5 lock-in).
        let restored: Face = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.surface_version(), 0);
        assert_eq!(restored.boundary_version(), 0);

        // Synthetic stale cache entry with pre-save versions — would be
        // a bug to use, version comparator MUST detect mismatch.
        let stale = NormalCacheEntry {
            surface_version: pre_save_surface_v,
            boundary_version: pre_save_boundary_v,
            per_vertex_normals: vec![DVec3::Z],
            last_access_tick: 0,
        };

        // The cache hit predicate (Step 3 hot-path will use this exact
        // logic): both versions must match face's current versions.
        let hit = stale.surface_version == restored.surface_version()
            && stale.boundary_version == restored.boundary_version();
        assert!(!hit,
            "stale cache from pre-save state MUST NOT register as cache hit \
             after load (pre={},{} vs post={},{})",
            pre_save_surface_v, pre_save_boundary_v,
            restored.surface_version(), restored.boundary_version());
    }
}
