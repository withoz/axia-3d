//! XIA Lifecycle Management
//!
//! With computed state (geometry_state()), most lifecycle transitions are automatic.
//! Only dissolve remains as an explicit operation.

use crate::xia::Xia;

/// Check if a set of edges form a closed loop (prerequisite for Face creation).
pub fn edges_form_loop(edge_count: usize, shared_vertices: usize) -> bool {
    // A closed loop has N edges sharing N vertices
    edge_count >= 3 && shared_vertices == edge_count
}

/// Dissolve a XIA (soft-delete) — clears all face references.
/// After this, geometry_state() will return Dissolved.
pub fn dissolve(xia: &mut Xia) {
    xia.face_ids.clear();
}
