//! Shell entity — a connected set of faces forming a closed or open surface.
//!
//! In the Geometry Layer:
//!   Point → Edge → Face → Volume
//!
//! A Shell groups faces that share edges (topologically connected).
//! A closed Shell (all edges shared by exactly 2 faces) constitutes a Volume.
//! Shell is a DCEL implementation detail, not a user-facing geometry state.

use super::id::FaceId;
use serde::{Serialize, Deserialize};
use smallvec::SmallVec;

/// A shell is a connected component of faces in the mesh.
///
/// - **Closed shell**: every edge is shared by exactly 2 faces → solid boundary
/// - **Open shell**: at least one boundary edge (shared by only 1 face) → surface
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shell {
    /// Face IDs belonging to this shell
    faces: SmallVec<[FaceId; 8]>,
    /// Whether this shell is closed (watertight)
    closed: bool,
}

impl Shell {
    /// Create a new shell with the given faces.
    pub fn new(faces: Vec<FaceId>, closed: bool) -> Self {
        Self {
            faces: SmallVec::from_vec(faces),
            closed,
        }
    }

    /// Create an empty shell.
    pub fn empty() -> Self {
        Self {
            faces: SmallVec::new(),
            closed: false,
        }
    }

    /// Get the face IDs in this shell.
    pub fn faces(&self) -> &[FaceId] {
        &self.faces
    }

    /// Get the number of faces.
    pub fn face_count(&self) -> usize {
        self.faces.len()
    }

    /// Whether this shell is closed (all edges shared by 2 faces).
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// Set the closed status.
    pub fn set_closed(&mut self, closed: bool) {
        self.closed = closed;
    }

    /// Add a face to this shell.
    pub fn add_face(&mut self, face: FaceId) {
        if !self.faces.contains(&face) {
            self.faces.push(face);
        }
    }

    /// Remove a face from this shell. Returns true if found and removed.
    pub fn remove_face(&mut self, face: FaceId) -> bool {
        if let Some(pos) = self.faces.iter().position(|&f| f == face) {
            self.faces.swap_remove(pos);
            true
        } else {
            false
        }
    }

    /// Check if this shell contains a specific face.
    pub fn contains_face(&self, face: FaceId) -> bool {
        self.faces.contains(&face)
    }
}
