//! AXiA Transaction Manager
//!
//! Undo/Redo system using snapshot-based reconstruction.
//! Every topology-changing operation is wrapped in a transaction frame
//! that records before/after states for rollback.

use rustc_hash::FxHashSet;

/// Unique identifier for a mesh instance
pub type MeshUUID = u64;

/// Generic entity ID wrapper for transaction tracking
#[derive(Clone, Debug, Hash, Eq, PartialEq)]
pub enum EntityRef {
    Vertex(u32),
    Edge(u32),
    HalfEdge(u32),
    Face(u32),
}

/// A single transaction frame capturing all entity changes
#[derive(Clone, Debug, Default)]
pub struct TransactionFrame {
    /// Entities created in this frame
    pub created: Vec<EntityRef>,
    /// Entities modified in this frame (store old state externally)
    pub modified: Vec<EntityRef>,
    /// Entities deleted in this frame
    pub deleted: Vec<EntityRef>,
    /// Serialized snapshot of affected entities before the operation
    pub before_snapshot: Vec<u8>,
    /// Serialized snapshot of affected entities after the operation
    pub after_snapshot: Vec<u8>,
}

/// Transaction manager with undo/redo stacks
#[derive(Clone, Debug)]
pub struct TransactionManager {
    /// Whether we're currently recording changes
    is_recording: bool,
    /// Current frame being recorded
    current_frame: TransactionFrame,
    /// Committed undo stack
    undo_stack: Vec<TransactionFrame>,
    /// Redo stack (cleared on new commit)
    redo_stack: Vec<TransactionFrame>,
    /// Max undo depth
    max_depth: usize,
    /// Entities touched in current recording session
    touched_entities: FxHashSet<EntityRef>,
}

impl TransactionManager {
    pub fn new(max_depth: usize) -> Self {
        Self {
            is_recording: false,
            current_frame: TransactionFrame::default(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_depth,
            touched_entities: FxHashSet::default(),
        }
    }

    /// Begin recording a new transaction
    pub fn begin(&mut self) {
        self.is_recording = true;
        self.current_frame = TransactionFrame::default();
        self.touched_entities.clear();
    }

    // is_recording() is defined further below (used by re-entrant callers
    //   to avoid nested begin() wiping the outer transaction's frame).

    /// Record an entity creation
    pub fn record_create(&mut self, entity: EntityRef) {
        if self.is_recording {
            self.touched_entities.insert(entity.clone());
            self.current_frame.created.push(entity);
        }
    }

    /// Record an entity modification
    pub fn record_modify(&mut self, entity: EntityRef) {
        if self.is_recording && !self.touched_entities.contains(&entity) {
            self.touched_entities.insert(entity.clone());
            self.current_frame.modified.push(entity);
        }
    }

    /// Record an entity deletion
    pub fn record_delete(&mut self, entity: EntityRef) {
        if self.is_recording {
            self.touched_entities.insert(entity.clone());
            self.current_frame.deleted.push(entity);
        }
    }

    /// Store before-snapshot data (serialized mesh state)
    pub fn set_before_snapshot(&mut self, data: Vec<u8>) {
        if self.is_recording {
            self.current_frame.before_snapshot = data;
        }
    }

    /// Store after-snapshot data
    pub fn set_after_snapshot(&mut self, data: Vec<u8>) {
        if self.is_recording {
            self.current_frame.after_snapshot = data;
        }
    }

    /// Commit current transaction frame to undo stack
    pub fn commit(&mut self) {
        if !self.is_recording {
            return;
        }
        self.is_recording = false;

        let frame = std::mem::take(&mut self.current_frame);
        self.undo_stack.push(frame);

        // Clear redo stack on new commit (standard undo/redo behavior)
        self.redo_stack.clear();

        // Enforce max depth
        while self.undo_stack.len() > self.max_depth {
            self.undo_stack.remove(0);
        }

        self.touched_entities.clear();
    }

    /// Cancel current recording without committing
    pub fn cancel(&mut self) {
        self.is_recording = false;
        self.current_frame = TransactionFrame::default();
        self.touched_entities.clear();
    }

    /// Pop the last undo frame (caller applies the before_snapshot)
    pub fn undo(&mut self) -> Option<&TransactionFrame> {
        if let Some(frame) = self.undo_stack.pop() {
            self.redo_stack.push(frame);
            self.redo_stack.last()
        } else {
            None
        }
    }

    /// Pop the last redo frame (caller applies the after_snapshot)
    pub fn redo(&mut self) -> Option<&TransactionFrame> {
        if let Some(frame) = self.redo_stack.pop() {
            self.undo_stack.push(frame);
            self.undo_stack.last()
        } else {
            None
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording
    }

    pub fn undo_count(&self) -> usize {
        self.undo_stack.len()
    }

    pub fn redo_count(&self) -> usize {
        self.redo_stack.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_undo_redo() {
        let mut tm = TransactionManager::new(100);

        // Record first operation
        tm.begin();
        tm.record_create(EntityRef::Vertex(0));
        tm.record_create(EntityRef::Edge(0));
        tm.set_before_snapshot(vec![0]);
        tm.set_after_snapshot(vec![1]);
        tm.commit();

        assert_eq!(tm.undo_count(), 1);
        assert!(tm.can_undo());
        assert!(!tm.can_redo());

        // Undo
        let frame = tm.undo().unwrap();
        assert_eq!(frame.before_snapshot, vec![0]);
        assert!(tm.can_redo());
        assert!(!tm.can_undo());

        // Redo
        let frame = tm.redo().unwrap();
        assert_eq!(frame.after_snapshot, vec![1]);
        assert!(tm.can_undo());
        assert!(!tm.can_redo());
    }

    #[test]
    fn test_new_commit_clears_redo() {
        let mut tm = TransactionManager::new(100);

        tm.begin();
        tm.record_create(EntityRef::Vertex(0));
        tm.commit();

        tm.undo();
        assert!(tm.can_redo());

        // New commit should clear redo stack
        tm.begin();
        tm.record_create(EntityRef::Vertex(1));
        tm.commit();

        assert!(!tm.can_redo());
    }
}
