//! ADR-050 Phase 1.B — Shape (form-layer citizenship type).
//!
//! Two-Layer Citizenship Model (ADR-049 + LOCKED #26): the engine
//! distinguishes between *form* (geometric abstraction, no material)
//! and *property* (member identity, with material + watertight +
//! manifold). This module introduces the `Shape` type as the form
//! citizen — `Xia` (existing) remains the property citizen.
//!
//! Per ADR-050 §2.1.1 spec — Shape has NO material field. Form layer
//! is materially neutral by design. Promotion to Xia (Phase 1.A,
//! `promote.rs`) requires user-supplied material + 4-condition check.
//!
//! P-1 atomic scope (this module):
//! - `ShapeId` newtype + `Shape` struct + lifecycle helpers
//! - NO migration of Draw tools (still produce Xia — deferred to P-4+)
//! - NO snapshot section (deferred to ADR-050 P-3)
//! - NO WASM/TS surface (deferred to P-4+)
//! - Drop-in alongside existing Xia (additive only).
//!
//! Cross-references:
//! - ADR-050 §2.1.1 (Shape struct spec)
//! - ADR-049 §4 Q1+Q3+Q4 (user lock-in)
//! - LOCKED #26 (Two-Layer Citizenship Model)
//! - v3.2 spec §3 시민권 (form vs property)

use serde::{Deserialize, Serialize};
use glam::DVec3;
use axia_geo::{EdgeId, FaceId};

/// Unique identifier for a `Shape` entity.
///
/// Newtype rather than alias (`type ShapeId = u32`) so the compiler
/// catches accidental swaps with `XiaId` (which is currently
/// `pub type XiaId = u32`). The two citizenship layers MUST be
/// type-distinct at the Rust boundary — ADR-050 §2.1.1 lock-in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ShapeId(u32);

impl ShapeId {
    /// Construct a `ShapeId` from a raw `u32`. Use the Scene's
    /// `create_shape` API in normal code — this constructor is for
    /// deserialization, tests, and bridge layers.
    pub fn new(raw: u32) -> Self {
        Self(raw)
    }

    /// Underlying integer (for serialization / WASM bridge).
    pub fn raw(self) -> u32 {
        self.0
    }
}

/// A `Shape` is a form-layer citizen — geometric abstraction with
/// optional faces and/or a standalone edge, but **no material** and
/// **no member identity** (Property XIA promotion required for those).
///
/// ADR-050 §2.1.1: form has 0 area / 0 thickness / 0 volume freely
/// (consistent with v3.2 명제 4 — form is materially-neutral).
///
/// P-1 atomic responsibility:
/// - Identity (id, name)
/// - Geometry ownership (face_ids, standalone_edge_id)
/// - Spatial hint (position, surface_normal)
///
/// Deferred to later sub-steps:
/// - Promotion linkage (`promoted_xia: Option<XiaId>`) — P-2
/// - Snapshot serialization — P-3 (additive section)
/// - Visibility / selection state — P-4+ (UI integration)
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    /// Unique identifier within the Scene.
    pub id: ShapeId,
    /// User-facing display name (e.g., "사각형", "Line", "Circle").
    pub name: String,
    /// Faces owned by this Shape (may be empty for line-only Shapes).
    pub face_ids: Vec<FaceId>,
    /// Standalone edge ID for line-only Shapes (no face).
    /// Mirrors `Xia.standalone_edge_id` — same semantics.
    pub standalone_edge_id: Option<EdgeId>,
    /// Representative spatial position (centroid hint).
    pub position: DVec3,
    /// Surface normal hint (for planar Shapes drawn on a face).
    pub surface_normal: Option<DVec3>,
}

impl Shape {
    /// Construct a new Shape with a given id and name.
    /// Geometry fields default to empty / zero — caller fills via
    /// `face_ids` push or direct mutation.
    pub fn new(id: ShapeId, name: String) -> Self {
        Self {
            id,
            name,
            face_ids: Vec::new(),
            standalone_edge_id: None,
            position: DVec3::ZERO,
            surface_normal: None,
        }
    }

    /// True iff this Shape owns no faces and no standalone edge.
    /// Mirrors `Xia::is_dissolved`.
    pub fn is_empty(&self) -> bool {
        self.face_ids.is_empty() && self.standalone_edge_id.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_id_newtype_roundtrip() {
        let id = ShapeId::new(42);
        assert_eq!(id.raw(), 42);
        // Different value → different id (newtype is value-equality).
        let id2 = ShapeId::new(7);
        assert_ne!(id, id2);
    }

    #[test]
    fn shape_new_starts_empty() {
        let s = Shape::new(ShapeId::new(1), "사각형".to_string());
        assert_eq!(s.id, ShapeId::new(1));
        assert_eq!(s.name, "사각형");
        assert!(s.face_ids.is_empty());
        assert!(s.standalone_edge_id.is_none());
        assert_eq!(s.position, DVec3::ZERO);
        assert!(s.surface_normal.is_none());
        assert!(s.is_empty());
    }

    #[test]
    fn shape_serde_roundtrip() {
        // Critical for ADR-050 P-3 (snapshot section) — ensure Shape is
        // serializable now even though the section is added later.
        let mut s = Shape::new(ShapeId::new(5), "Test".to_string());
        s.face_ids.push(FaceId::new(10));
        s.face_ids.push(FaceId::new(20));
        s.position = DVec3::new(1.0, 2.0, 3.0);
        s.surface_normal = Some(DVec3::Z);

        let bytes = bincode::serialize(&s).expect("serialize");
        let restored: Shape = bincode::deserialize(&bytes).expect("deserialize");
        assert_eq!(restored, s);
    }
}
