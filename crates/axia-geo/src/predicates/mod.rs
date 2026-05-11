//! ADR-058 Phase M — Robust Geometric Predicates.
//!
//! AxiA-typed (DVec2 / DVec3) wrappers around the `robust` crate
//! (Shewchuk 1996 adaptive predicates, BSD3).
//!
//! ## Lock-in (ADR-058 §X.5 — 영구 보호)
//!
//! 1. External `robust` crate (BSD3) — 자체 구현 금지
//! 2. FMA 비활성 강제 — Cargo profile + runtime sanity
//! 3. Sign 반환 = std::cmp::Ordering — bool 금지
//! 4. HOTSPOTS 5개만 교체 — 전면 교체 금지
//! 5. Performance ≤ 5% delta on hot path
//!
//! ## API
//!
//! ```rust
//! use axia_geo::predicates::{orient2d_robust, orient3d_robust};
//! use std::cmp::Ordering;
//! use glam::{DVec2, DVec3};
//!
//! match orient2d_robust(
//!     DVec2::new(0.0, 0.0),
//!     DVec2::new(1.0, 0.0),
//!     DVec2::new(0.5, 1e-15),
//! ) {
//!     Ordering::Less    => /* CW (right of line) */ {},
//!     Ordering::Greater => /* CCW (left of line) */ {},
//!     Ordering::Equal   => /* exactly collinear (robust 보장) */ {},
//! }
//! ```

pub mod adapter;
pub mod filter;
pub mod hotspots;

pub use adapter::{
    orient2d_robust, orient3d_robust,
    in_circle_robust, in_sphere_robust,
    verify_predicates_environment,
};
pub use filter::{orient2d_filtered, orient3d_filtered};

// Re-export std Ordering for convenience
pub use std::cmp::Ordering;
