//! Edge entity — connects two vertices, owns a pair of half-edges.

use serde::{Deserialize, Serialize};
use super::id::*;
use super::flags::SharedFlags;

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
        }
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
