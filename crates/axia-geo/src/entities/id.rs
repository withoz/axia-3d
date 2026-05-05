//! Strongly-typed entity IDs backed by u32.
//!
//! Each entity type has its own ID type to prevent accidental mixing.
//! IDs are simple wrappers around u32 with a NULL sentinel for "no entity".

use serde::{Deserialize, Serialize};
use std::fmt;

/// Macro to generate strongly-typed entity ID types
macro_rules! define_id {
    ($name:ident) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(u32);

        impl $name {
            pub const NULL: Self = Self(u32::MAX);

            #[inline]
            pub const fn new(raw: u32) -> Self {
                Self(raw)
            }

            #[inline]
            pub fn raw(self) -> u32 {
                self.0
            }

            #[inline]
            pub fn is_null(self) -> bool {
                self.0 == u32::MAX
            }

            #[inline]
            pub fn is_valid(self) -> bool {
                self.0 != u32::MAX
            }
        }

        /// Default = NULL (u32::MAX), NOT 0.
        /// This prevents accidental reassignment to face 0 / vert 0 / etc.
        impl Default for $name {
            #[inline]
            fn default() -> Self {
                Self::NULL
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                if self.is_null() {
                    write!(f, "{}(NULL)", stringify!($name))
                } else {
                    write!(f, "{}({})", stringify!($name), self.0)
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                if self.is_null() {
                    write!(f, "NULL")
                } else {
                    write!(f, "{}", self.0)
                }
            }
        }
    };
}

define_id!(VertId);
define_id!(EdgeId);
define_id!(HeId);
define_id!(FaceId);
define_id!(ShellId);
define_id!(MaterialId);

/// Canonical vertex pair key for edge lookup.
/// Always stores (smaller_id, larger_id) for consistent hashing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VertPairKey {
    pub v_small: VertId,
    pub v_large: VertId,
}

impl VertPairKey {
    pub fn new(a: VertId, b: VertId) -> Self {
        if a.raw() <= b.raw() {
            Self { v_small: a, v_large: b }
        } else {
            Self { v_small: b, v_large: a }
        }
    }
}

/// Vertex pair with original insertion order preserved.
#[derive(Clone, Copy, Debug)]
pub struct VertPair {
    pub key: VertPairKey,
    /// true if the original order matches the canonical order
    pub same_order: bool,
    pub v_start: VertId,
    pub v_end: VertId,
}

impl VertPair {
    pub fn new(start: VertId, end: VertId) -> Self {
        let key = VertPairKey::new(start, end);
        Self {
            key,
            same_order: start.raw() <= end.raw(),
            v_start: start,
            v_end: end,
        }
    }
}
