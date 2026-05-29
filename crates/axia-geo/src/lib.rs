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
pub mod mesh_migration;
pub mod mesh_invariants;
pub mod mesh_export;
pub mod mesh_path_b;
pub mod mesh_owner_ids;
pub mod p7_manifold;
pub mod topology_damage;
// ADR-167 β-2 (audit-first canonical 17번째 적용): Plane SSOT 위치를
// axia-core → axia-geo 로 이동. 근거: axia-core 가 axia-geo 에 의존
// (Cargo.toml dep direction) → 원안 (β-1 Q1=a) 가 callsite migration
// 불가능 (circular dep). 아키텍처 truth: plane SSOT 는 geometry kernel
// (axia-geo) 의 자연 home. axia-core 는 re-export 로 backward compat.
pub mod plane;
// ADR-104 γ — Path B family cross-cut verification suite (Cylinder/Sphere/
// Cone/Torus surface attach + tessellation + invariants). Test-only.
#[cfg(test)]
pub mod path_b_family_verification;

// Re-export main types
pub use mesh::{Mesh, NormalizeOptions, NormalizeReport, ManifoldInfo};
pub use mesh_invariants::{InvariantReport, OutwardReport};
pub use topology_damage::{TopologyDamageKind, TopologyDamageReport, RecoveryOutcome};
pub use entities::id::*;
pub use entities::{Vertex, Edge, EdgeClass, HalfEdge, Face, LoopRef};
pub use tolerances::*;
pub use curves::{AnalyticCurve, CurveOps};
pub use surfaces::{AnalyticSurface, SurfaceOps, SurfaceTessellation};
pub use p7_manifold::{verify_p7_manifold, P7ManifoldReport, P7Violation};
pub use plane::{Plane, same_plane, EPS_PLANE_NORMAL, EPS_PLANE_OFFSET};  // ADR-167 β-2 (relocated from axia-core)
pub use operations::create_solid::{
    classify_boundary, BoundaryKind, CreateSolidMode, CreateSolidResult, SolidError, SolidKind,
};
