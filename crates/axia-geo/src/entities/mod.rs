//! Entity types for the Half-Edge DCEL mesh representation.
//!
//! Based on the buildragon kernel, cleaned up with:
//! - Clear naming conventions (no caya_ prefix)
//! - Proper Rust idioms (Option instead of sentinel values)
//! - Comprehensive documentation

mod vertex;
mod edge;
mod half_edge;
mod face;
mod shell;
pub mod id;
mod flags;

pub use vertex::Vertex;
pub use edge::{Edge, EdgeClass, PolylineCacheEntry};
pub use half_edge::{HalfEdge, HeFlags};
pub use face::{Face, LoopRef, NormalCacheEntry};
pub use shell::Shell;
pub use id::*;
pub use flags::SharedFlags;
