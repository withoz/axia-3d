//! XIA Lifecycle Management
//!
//! Handles state transitions and enforces dimensional rules:
//! - Line → Face: when edges form a closed loop
//! - Face → Volume: when Push/Pull is applied
//! - Volume → Xia: when material is assigned

use crate::xia::{Xia, XiaState};

/// Check if a set of edges form a closed loop (prerequisite for Face creation).
pub fn edges_form_loop(edge_count: usize, shared_vertices: usize) -> bool {
    // A closed loop has N edges sharing N vertices
    edge_count >= 3 && shared_vertices == edge_count
}

/// Promote a XIA from Line to Face state.
pub fn promote_to_face(xia: &mut Xia) -> Result<(), String> {
    if xia.state != XiaState::Line {
        return Err(format!("Expected Line state, got {:?}", xia.state));
    }
    xia.transition(XiaState::Face)
}

/// Promote a XIA from Face to Volume state (after Push/Pull).
pub fn promote_to_volume(xia: &mut Xia) -> Result<(), String> {
    if xia.state != XiaState::Face {
        return Err(format!("Expected Face state, got {:?}", xia.state));
    }
    xia.transition(XiaState::Volume)
}

/// Promote a XIA from Volume to Xia state (material assignment).
pub fn promote_to_xia(xia: &mut Xia) -> Result<(), String> {
    if xia.state != XiaState::Volume {
        return Err(format!("Expected Volume state, got {:?}", xia.state));
    }
    xia.transition(XiaState::Xia)
}

/// Demote a XIA from Xia back to Volume (material removed).
pub fn demote_to_volume(xia: &mut Xia) -> Result<(), String> {
    if xia.state != XiaState::Xia {
        return Err(format!("Expected Xia state, got {:?}", xia.state));
    }
    xia.transition(XiaState::Volume)
}

/// Dissolve a XIA (soft-delete).
pub fn dissolve(xia: &mut Xia) {
    xia.state = XiaState::Dissolved;
    xia.face_ids.clear();
}
