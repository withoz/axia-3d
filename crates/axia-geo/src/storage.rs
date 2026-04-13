//! Entity storage using HashMap with auto-incrementing IDs.
//!
//! Based on buildragon's CayaSlot pattern: O(1) access via FxHashMap
//! with strongly-typed ID keys.

use rustc_hash::FxHashMap;
use serde::{Serialize, Deserialize};
use std::fmt;

use crate::entities::id::*;

/// Trait for entity ID types used as storage keys.
pub trait SlotKey: Copy + Default + Eq + std::hash::Hash + fmt::Debug {
    fn from_raw(raw: u32) -> Self;
    fn raw(self) -> u32;
    fn is_null(self) -> bool;
}

// Implement SlotKey for all entity ID types
macro_rules! impl_slot_key {
    ($ty:ty) => {
        impl SlotKey for $ty {
            #[inline]
            fn from_raw(raw: u32) -> Self {
                Self::new(raw)
            }
            #[inline]
            fn raw(self) -> u32 {
                <$ty>::raw(self)
            }
            #[inline]
            fn is_null(self) -> bool {
                <$ty>::is_null(self)
            }
        }
    };
}

impl_slot_key!(VertId);
impl_slot_key!(EdgeId);
impl_slot_key!(HeId);
impl_slot_key!(FaceId);
impl_slot_key!(ShellId);

/// A slot-map-like storage with auto-incrementing strongly-typed keys.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotStorage<K: SlotKey, V> {
    inner: FxHashMap<K, V>,
    next_id: u32,
}

impl<K: SlotKey, V> SlotStorage<K, V> {
    pub fn new() -> Self {
        Self {
            inner: FxHashMap::default(),
            next_id: 0,
        }
    }

    /// Insert a value and return its auto-generated ID.
    pub fn insert(&mut self, value: V) -> K {
        let id = K::from_raw(self.next_id);
        self.next_id += 1;
        self.inner.insert(id, value);
        id
    }

    /// Insert with a specific ID (for deserialization/undo).
    pub fn insert_with_id(&mut self, id: K, value: V) {
        self.inner.insert(id, value);
        // Keep next_id ahead of any manually inserted ID
        if id.raw() >= self.next_id {
            self.next_id = id.raw() + 1;
        }
    }

    /// Get a reference by ID.
    #[inline]
    pub fn get(&self, id: K) -> Option<&V> {
        self.inner.get(&id)
    }

    /// Get a mutable reference by ID.
    #[inline]
    pub fn get_mut(&mut self, id: K) -> Option<&mut V> {
        self.inner.get_mut(&id)
    }

    /// Remove an entity by ID.
    pub fn remove(&mut self, id: K) -> Option<V> {
        self.inner.remove(&id)
    }

    /// Check if an ID exists.
    #[inline]
    pub fn contains(&self, id: K) -> bool {
        self.inner.contains_key(&id)
    }

    /// Number of stored entities.
    #[inline]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Iterate over all (id, value) pairs.
    pub fn iter(&self) -> impl Iterator<Item = (K, &V)> {
        self.inner.iter().map(|(&k, v)| (k, v))
    }

    /// Iterate mutably over all (id, value) pairs.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = (K, &mut V)> {
        self.inner.iter_mut().map(|(&k, v)| (k, v))
    }

    /// Get the next ID that will be assigned.
    pub fn next_id(&self) -> u32 {
        self.next_id
    }
}

impl<K: SlotKey, V> Default for SlotStorage<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

/// Index access: `storage[id]` — panics if not found.
impl<K: SlotKey, V> std::ops::Index<K> for SlotStorage<K, V> {
    type Output = V;

    fn index(&self, id: K) -> &V {
        self.inner.get(&id).unwrap_or_else(|| {
            panic!("Entity {:?} not found in storage", id)
        })
    }
}

impl<K: SlotKey, V> std::ops::IndexMut<K> for SlotStorage<K, V> {
    fn index_mut(&mut self, id: K) -> &mut V {
        self.inner.get_mut(&id).unwrap_or_else(|| {
            panic!("Entity {:?} not found in storage", id)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_and_get() {
        let mut storage: SlotStorage<VertId, f64> = SlotStorage::new();
        let id1 = storage.insert(1.0);
        let id2 = storage.insert(2.0);

        assert_eq!(id1.raw(), 0);
        assert_eq!(id2.raw(), 1);
        assert_eq!(*storage.get(id1).unwrap(), 1.0);
        assert_eq!(storage[id2], 2.0);
    }

    #[test]
    fn test_remove() {
        let mut storage: SlotStorage<VertId, f64> = SlotStorage::new();
        let id = storage.insert(42.0);
        assert!(storage.contains(id));

        storage.remove(id);
        assert!(!storage.contains(id));
    }
}
