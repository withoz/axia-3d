//! Owner-ID Groups — ADR-088 (curve) + ADR-093 (surface).
//!
//! Extracted from `mesh.rs` (Tier 2-A Stack #4, 2026-05-16, LOCKED #44
//! complete meaning per merge). Mesh-level Map canonical (ADR-091
//! §E L1) — bincode struct field 추가 없이 selection-time grouping.
//!
//! ## Contents
//!
//! ### ADR-088 Phase 1 (Curve owner-id, LOCKED #15 P22.5)
//! - `Mesh::next_curve_owner_id` — allocate fresh curve group ID
//! - `Mesh::set_edge_curve_owner_id` — set/clear edge's group ID
//! - `Mesh::edge_curve_owner_id` — read edge's group ID
//! - `Mesh::edges_by_curve_owner` — collect group members
//!
//! ### ADR-093 D-β (Surface owner-id, B-MVP — Path B Light)
//! - `Mesh::next_surface_owner_id` — allocate fresh surface group ID
//! - `Mesh::set_face_surface_owner_id` — set/clear face's group ID
//! - `Mesh::face_surface_owner_id` — read face's group ID
//! - `Mesh::faces_by_surface_owner` — collect group members
//! - `Mesh::walk_face_owner_siblings` — selection-layer entry
//!
//! ## ADR cross-link
//!
//! - ADR-088 Phase 1 (Curve Owner ID Grouping)
//! - ADR-093 D-β (Cylinder Side Face Owner-ID Grouping)
//! - ADR-091 §E L1 (Mesh-level Map canonical — struct field 추가 0)
//! - LOCKED #15 ADR-037 P22.5 (Owner-ID uniformity for analytic curves)
//! - LOCKED #44 (complete meaning per merge)

use crate::entities::*;
use crate::mesh::Mesh;

impl Mesh {
    // ========================================================================
    // ADR-088 Phase 1 — Curve Owner ID Grouping (LOCKED #15 P22.5)
    // ========================================================================

    /// ADR-088 Phase 1 — allocate a fresh curve owner group ID. Use this
    /// once per logical analytic curve (e.g., per DrawCircle), then call
    /// `set_edge_curve_owner_id(eid, Some(id))` on each segment of that
    /// curve. All segments sharing the id form a single selection unit
    /// per LOCKED #15 P22.5.
    ///
    /// Monotonic — IDs are never reused even if associated edges are
    /// deactivated. u32::MAX = 4 billion groups (practically unlimited).
    pub fn next_curve_owner_id(&mut self) -> u32 {
        let id = self.next_curve_owner_id;
        self.next_curve_owner_id = self.next_curve_owner_id.checked_add(1)
            .expect("Mesh::next_curve_owner_id overflow (u32::MAX)");
        id
    }

    /// ADR-088 Phase 1 — set the curve owner group ID on an edge.
    /// `None` removes grouping (edge becomes single-segment).
    /// Returns `false` if edge is missing or inactive.
    pub fn set_edge_curve_owner_id(
        &mut self,
        edge_id: EdgeId,
        owner: Option<u32>,
    ) -> bool {
        if let Some(edge) = self.edges.get_mut(edge_id) {
            if !edge.is_active() {
                return false;
            }
            edge.set_curve_owner_id(owner);
            true
        } else {
            false
        }
    }

    /// ADR-088 Phase 1 — read the curve owner group ID of an edge.
    /// Returns `None` if edge is missing, inactive, or has no group.
    pub fn edge_curve_owner_id(&self, edge_id: EdgeId) -> Option<u32> {
        self.edges.get(edge_id)
            .filter(|e| e.is_active())
            .and_then(|e| e.curve_owner_id())
    }

    /// ADR-088 Phase 1 — collect all active edges sharing a given curve
    /// owner group ID. Used by SelectTool walk: pick one edge → group
    /// promote (LOCKED #15 P22.5).
    ///
    /// Returns empty vec if no edges match (defensive: stale id, all
    /// deactivated, etc.).
    pub fn edges_by_curve_owner(&self, owner: u32) -> Vec<EdgeId> {
        self.edges.iter()
            .filter(|(_, e)| e.is_active() && e.curve_owner_id() == Some(owner))
            .map(|(id, _)| id)
            .collect()
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-093 D-β — Surface owner-id grouping (B-MVP — Path B Light)
    //
    // Mesh-level map (per ADR-091 §E L1 canonical guidance — bincode
    // struct field 추가 금지). Mirrors curve_owner_id pattern from
    // ADR-088 but on Face/surface dimension.
    // ════════════════════════════════════════════════════════════════

    /// ADR-093 D-β — Allocate a fresh surface owner-id (monotonic
    /// counter starting at 1; 0 reserved as null). One id per logical
    /// surface group (e.g., one cylinder = one id shared by all N
    /// side faces).
    ///
    /// Mirrors `next_curve_owner_id()` from ADR-088. Monotonic — IDs
    /// never reused even if associated faces deactivated.
    pub fn next_surface_owner_id(&mut self) -> u32 {
        let id = self.next_surface_owner_id;
        self.next_surface_owner_id = self.next_surface_owner_id.checked_add(1)
            .expect("Mesh::next_surface_owner_id overflow (u32::MAX)");
        id
    }

    /// ADR-093 D-β — Set the surface owner group ID for a face.
    /// `None` removes grouping (face becomes standalone — default).
    /// Returns `false` if face is missing or inactive.
    pub fn set_face_surface_owner_id(
        &mut self,
        face_id: FaceId,
        owner: Option<u32>,
    ) -> bool {
        let face_active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !face_active {
            return false;
        }
        match owner {
            Some(id) => { self.face_to_surface_owner_id.insert(face_id, id); }
            None     => { self.face_to_surface_owner_id.remove(&face_id); }
        }
        true
    }

    /// ADR-093 D-β — Read the surface owner group ID of a face.
    /// Returns `None` if face is missing, inactive, or has no group.
    pub fn face_surface_owner_id(&self, face_id: FaceId) -> Option<u32> {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return None; }
        self.face_to_surface_owner_id.get(&face_id).copied()
    }

    /// ADR-093 D-β — Collect all active faces sharing a given surface
    /// owner group ID. Used by SelectTool walk: pick one face → group
    /// promote (LOCKED #15 ADR-037 P22.5 Face owner-id 자연 확장).
    ///
    /// Returns empty vec if no faces match (defensive: stale id, all
    /// deactivated, etc.).
    pub fn faces_by_surface_owner(&self, owner: u32) -> Vec<FaceId> {
        self.face_to_surface_owner_id.iter()
            .filter_map(|(&fid, &oid)| {
                if oid != owner { return None; }
                self.faces.get(fid)
                    .filter(|f| f.is_active())
                    .map(|_| fid)
            })
            .collect()
    }

    /// ADR-093 D-β — Walk owner-siblings from a starting face.
    ///
    /// Selection-layer entry point: given a clicked face, return all
    /// active faces sharing its surface owner-id (group). If the face
    /// has no owner-id (None), returns just `[face_id]` (no group).
    ///
    /// Result order is unspecified; callers (SelectionManager) handle
    /// dedup/sort.
    pub fn walk_face_owner_siblings(&self, face_id: FaceId) -> Vec<FaceId> {
        match self.face_surface_owner_id(face_id) {
            Some(owner) => self.faces_by_surface_owner(owner),
            None => {
                let active = self.faces.get(face_id)
                    .map(|f| f.is_active())
                    .unwrap_or(false);
                if active { vec![face_id] } else { Vec::new() }
            }
        }
    }

}
