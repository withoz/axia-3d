//! Half-edge entity — the fundamental traversal element of the DCEL.
//!
//! Each half-edge stores:
//! - Face loop links: next/prev for traversing around a face
//! - Radial link: next_rad for traversing edges sharing a vertex
//! - Topology references: destination vertex, parent edge, parent face

use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use super::id::*;

bitflags! {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
    pub struct HeFlags: u32 {
        /// Soft edge (don't render as hard line)
        const SOFT = 1 << 0;
        /// Use smooth normals across this edge
        const SMOOTH_NORMAL = 1 << 1;
        /// Soften coplanar edges automatically
        const SOFTEN_COPLANAR = 1 << 2;
        /// Hard edge (always render, even between coplanar faces — e.g. face split edges)
        const HARD = 1 << 3;
    }
}

/// A half-edge in the DCEL structure.
///
/// Half-edges are directional: they point FROM their origin vertex
/// TO their destination vertex. Each undirected edge has two half-edges.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HalfEdge {
    // --- Face loop navigation ---
    /// Next half-edge in the face loop (CCW for outer, CW for holes)
    next: HeId,
    /// Previous half-edge in the face loop
    prev: HeId,

    // --- Topology references ---
    /// Destination vertex (this half-edge points toward dst)
    dst: VertId,
    /// Parent edge (the undirected edge this half-edge belongs to)
    edge: EdgeId,
    /// Parent face (NULL = boundary / unassigned)
    face: FaceId,

    // --- Radial navigation ---
    /// Next half-edge in radial chain at the origin vertex
    v_next: HeId,
    /// Twin half-edge (opposite direction on same edge)
    next_rad: HeId,

    // --- Flags ---
    he_flags: HeFlags,
    /// Active flag for soft-delete
    active: bool,
    /// True if part of an outer boundary loop
    is_outer: bool,
}

impl HalfEdge {
    pub fn new(dst: VertId, edge: EdgeId) -> Self {
        Self {
            dst,
            edge,
            active: true,
            ..Default::default()
        }
    }

    // --- Getters ---
    #[inline] pub fn next(&self) -> HeId { self.next }
    #[inline] pub fn prev(&self) -> HeId { self.prev }
    #[inline] pub fn dst(&self) -> VertId { self.dst }
    #[inline] pub fn edge(&self) -> EdgeId { self.edge }
    #[inline] pub fn face(&self) -> FaceId { self.face }
    #[inline] pub fn v_next(&self) -> HeId { self.v_next }
    #[inline] pub fn next_rad(&self) -> HeId { self.next_rad }
    #[inline] pub fn flags(&self) -> HeFlags { self.he_flags }
    #[inline] pub fn is_active(&self) -> bool { self.active }
    #[inline] pub fn is_outer(&self) -> bool { self.is_outer }

    // --- Setters ---
    #[inline] pub fn set_next(&mut self, id: HeId) { self.next = id; }
    #[inline] pub fn set_prev(&mut self, id: HeId) { self.prev = id; }
    #[inline] pub fn set_dst(&mut self, id: VertId) { self.dst = id; }
    #[inline] pub fn set_edge(&mut self, id: EdgeId) { self.edge = id; }
    #[inline] pub fn set_face(&mut self, id: FaceId) { self.face = id; }
    #[inline] pub fn set_v_next(&mut self, id: HeId) { self.v_next = id; }
    #[inline] pub fn set_next_rad(&mut self, id: HeId) { self.next_rad = id; }
    #[inline] pub fn set_flags(&mut self, flags: HeFlags) { self.he_flags = flags; }
    #[inline] pub fn set_active(&mut self, active: bool) { self.active = active; }
    #[inline] pub fn set_outer(&mut self, outer: bool) { self.is_outer = outer; }

    /// Check if this half-edge is on the boundary (no face assigned)
    #[inline]
    pub fn is_boundary(&self) -> bool {
        self.face.is_null()
    }
}
