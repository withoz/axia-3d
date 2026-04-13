//! Shared entity flags for selection, visibility, locking.

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

bitflags! {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
    pub struct SharedFlags: u32 {
        const SELECTED   = 1 << 0;
        const HIDDEN     = 1 << 1;
        const LOCKED     = 1 << 2;
        const HIGHLIGHTED = 1 << 3;
    }
}
