//! AXiA Geometry Kernel
//!
//! Half-Edge DCEL mesh representation with CAD-grade operations.
//! Based on the buildragon kernel from KAYAC, rewritten with clean Rust idioms.
//!
//! ## Architecture
//! - `entities/` — Core data types (Vertex, Edge, HalfEdge, Face)
//! - `storage` — Generic slot-map storage with strongly-typed keys
//! - `mesh` — The central Mesh struct combining all entities
//! - `operations/` — High-level geometry operations (Draw, Push/Pull)
//! - `tolerances` — Numerical precision constants
//! - `curves/` — Analytic edge curve primitives (Phase A — ADR-028)

pub mod entities;
pub mod storage;
pub mod mesh;
pub mod operations;
pub mod tolerances;
pub mod curves;
pub mod surfaces;
pub mod predicates;

// Re-export main types
pub use mesh::{Mesh, NormalizeOptions, NormalizeReport, InvariantReport, ManifoldInfo};
pub use entities::id::*;
pub use entities::{Vertex, Edge, EdgeClass, HalfEdge, Face, LoopRef};
pub use tolerances::*;
pub use curves::{AnalyticCurve, CurveOps};
pub use surfaces::{AnalyticSurface, SurfaceOps, SurfaceTessellation};
