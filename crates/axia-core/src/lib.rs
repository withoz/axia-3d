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
pub mod shape;
pub mod reference;
pub mod lifecycle;
pub mod commands;
pub mod scene;
pub mod import_dxf;
pub mod group;
pub mod material;
pub mod constraint;
pub mod orphan_recovery;
pub mod promote;
pub mod boolean_group;

pub use xia::{Xia, XiaState};
// ADR-167 β-2 — Plane SSOT relocated to axia-geo (audit-first canonical
// 17번째 — axia-core depends on axia-geo, not the other way). axia-core
// re-exports for backward compat — callers can use either
// `axia_geo::{Plane, ...}` or `axia_core::{Plane, ...}`.
pub use axia_geo::{Plane, same_plane, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET};
pub use shape::{Shape, ShapeId};
pub use reference::{Reference, ReferenceCategory, ReferenceId};
pub use boolean_group::BooleanGroupTag;
pub use promote::{PromoteError, PromoteOk, XiaKind};
pub use commands::{Command, CommandResult};
pub use scene::{
    Scene, FORM_MATERIAL,
    OrphanMaterialReport, OrphanMaterialEntry,
    MaterialRecoveryOutcome, MaterialRemovalOutcome,
};
pub use group::{GroupManager, GroupId, ComponentDefId, ComponentInstanceId, Transform3D};
pub use material::{
    Material, MaterialLibrary, MaterialCategory, PhysicalProperties, VisualProperties,
    FireRating,
    // ADR-099 L-β
    TextureProjection, TextureChannelInfo, LayeredChannels,
};
pub use constraint::{Constraint, ConstraintGraph, ConstraintId, ConstraintKind, ConstraintRef, SolverResult};
