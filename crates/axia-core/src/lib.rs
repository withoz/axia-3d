//! AXiA Core — XIA Object Model, Lifecycle, Command Pattern
//!
//! This crate defines the high-level modeling concepts:
//! - XIA Lifecycle: Point → Line → Face → Volume → Xia state transitions
//! - Command Pattern: Preview → Commit pipeline
//! - Scene Graph: Collection of XIA entities with relations
//! - Material System: Physical and visual properties

pub mod xia;
pub mod lifecycle;
pub mod commands;
pub mod scene;
pub mod import_dxf;
pub mod group;
pub mod material;

pub use xia::{Xia, XiaState};
pub use commands::{Command, CommandResult};
pub use scene::Scene;
pub use group::{GroupManager, GroupId, ComponentDefId, ComponentInstanceId, Transform3D};
pub use material::{Material, MaterialLibrary, MaterialCategory, PhysicalProperties, VisualProperties, FireRating};
