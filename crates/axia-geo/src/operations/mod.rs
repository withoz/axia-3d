//! Geometry operations on the Mesh.
//!
//! Each operation corresponds to a user action (Draw, Push/Pull, etc.)

pub mod draw;
pub mod orient;
pub mod push_pull;
pub mod boolean_geo;
pub mod boolean;
pub mod boolean_dispatch;
pub mod transform;
pub mod offset;
pub mod primitives;
pub mod face_split;
pub mod mirror;
pub mod revolve;
pub mod loft;
pub mod sweep;
pub mod subdivide;
pub mod fillet;
pub mod fillet_brep;
pub mod chamfer_brep;
pub mod shell;
pub mod draft;
pub mod offset_surface_robust;
pub mod deform;
pub mod array_op;
pub mod projected_shadow;
pub mod geometric_merge;
pub mod polygon_geom;
pub mod slice;
pub mod repair;
pub mod planar_walk;
pub mod erase_resynth;
