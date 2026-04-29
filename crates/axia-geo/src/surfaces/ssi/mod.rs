//! Surface-Surface Intersection (SSI) — Phase F (ADR-034).
//!
//! Stage 1 (current): Analytic shortcuts for common primitive pairs +
//! infrastructure for general subdivision.
//!
//! Stages 2-4 (subdivide-and-prune, Newton refinement, topology assembly)
//! are deferred to follow-up commits.

pub mod analytic;

use glam::DVec3;
use serde::{Deserialize, Serialize};

/// Result of a surface-surface intersection.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceIntersection {
    /// Sample points along the intersection curve(s), in 3D space.
    pub points: Vec<DVec3>,
    /// Parameter on first surface for each sample.
    pub uv_a: Vec<(f64, f64)>,
    /// Parameter on second surface for each sample.
    pub uv_b: Vec<(f64, f64)>,
    /// True if the intersection forms a closed loop.
    pub closed: bool,
    /// True if a tangent contact was detected (degenerate intersection).
    pub tangent_warning: bool,
}

impl Default for SurfaceIntersection {
    fn default() -> Self {
        Self {
            points: Vec::new(),
            uv_a: Vec::new(),
            uv_b: Vec::new(),
            closed: false,
            tangent_warning: false,
        }
    }
}

impl SurfaceIntersection {
    /// True if the intersection has no points.
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Number of sample points along the intersection.
    pub fn len(&self) -> usize {
        self.points.len()
    }
}
