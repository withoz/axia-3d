//! AXiA Core — XIA Object Model, Scene, Command Pattern
//!
//! This crate defines the Semantic Layer concepts:
//! - **Object (= XIA)**: owns geometry (face_ids), has material, name, visibility
//! - **Geometry state**: computed from owned geometry (Point → Edge → Face → Volume)
//! - **Material**: property of Object, not a state trigger
//! - **Group**: UI-only selection set, references faces but doesn't own them
//! - Command Pattern: Preview → Commit pipeline
//! - Scene Graph: Collection of XIA entities with relations

pub mod xia;
pub mod lifecycle;
pub mod commands;
pub mod scene;
pub mod import_dxf;
pub mod group;
pub mod material;
pub mod constraint;

pub use xia::{Xia, XiaState};
pub use commands::{Command, CommandResult};
pub use scene::Scene;
pub use group::{GroupManager, GroupId, ComponentDefId, ComponentInstanceId, Transform3D};
pub use material::{Material, MaterialLibrary, MaterialCategory, PhysicalProperties, VisualProperties, FireRating};
pub use constraint::{Constraint, ConstraintGraph, ConstraintId, ConstraintKind, ConstraintRef, SolverResult};
