//! XIA Lifecycle Management
//!
//! State is computed from owned geometry via geometry_state() — not stored or transitioned.
//! Only dissolve remains as an explicit operation (clears geometry references).

use crate::xia::Xia;

/// Check if a set of edges form a closed loop (prerequisite for Face creation).
pub fn edges_form_loop(edge_count: usize, shared_vertices: usize) -> bool {
    // A closed loop has N edges sharing N vertices
    edge_count >= 3 && shared_vertices == edge_count
}

/// Dissolve a XIA (soft-delete) — clears all geometry references.
/// After this, geometry_state() will return Dissolved.
pub fn dissolve(xia: &mut Xia) {
    xia.face_ids.clear();
    xia.standalone_edge_id = None;
}
