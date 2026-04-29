//! Analytic Edge Curve Layer — Phase A (ADR-028)
//!
//! Edges in AXiA's DCEL can carry an optional analytic curve definition.
//! The curve is the **source of truth**; the polyline tessellation is a
//! view-dependent cache.
//!
//! ## Hierarchy
//!
//! - `AnalyticCurve` enum — variants for each supported curve type
//! - `CurveOps` trait — common operations (evaluate / derivative / tessellate)
//! - Submodules: `line`, `circle`, `arc` (Phase A)
//!   - Phase B will add: `bezier`, `bspline`
//!   - Phase C will add: `nurbs`
//!
//! ## ADR References
//! - ADR-027 (kickoff)
//! - ADR-028 (this phase) — P13: Edge has optional analytic curve
//! - PLAN-001 Phase A
//!
//! ## Coordinate Conventions
//! - All positions in DVec3 (f64) — engine-wide
//! - Plane curves (Circle, Arc) define a 2D plane via `(normal, basis_u)`,
//!   with `basis_v = normal × basis_u` (right-handed). Curve point at
//!   parameter θ: `center + cos(θ) · basis_u · r + sin(θ) · basis_v · r`.
//! - Parameter range: each variant's docstring specifies (e.g. Arc uses
//!   `[start_angle, end_angle]`, Bezier uses `[0, 1]`).

pub mod line;
pub mod circle;
pub mod arc;

use anyhow::Result;
use glam::DVec3;
use serde::{Deserialize, Serialize};

use crate::entities::id::VertId;
use crate::mesh::Mesh;

/// An analytic curve attached to an Edge.
///
/// Phase A variants only. Phase B/C will extend this enum.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum AnalyticCurve {
    /// Straight line segment between two mesh vertices.
    /// (The default Edge type — provided here so curve-aware code paths
    /// can treat all edges uniformly.)
    Line {
        start: VertId,
        end: VertId,
    },
    /// Full circle in a 3D plane.
    Circle {
        center: DVec3,
        radius: f64,
        /// Plane normal (unit length).
        normal: DVec3,
        /// In-plane reference axis (unit length, perpendicular to normal).
        /// Defines θ = 0 direction.
        basis_u: DVec3,
    },
    /// Circular arc — a sub-range of a circle.
    Arc {
        center: DVec3,
        radius: f64,
        normal: DVec3,
        basis_u: DVec3,
        /// Start angle in radians (in plane defined by basis_u).
        start_angle: f64,
        /// End angle in radians. May exceed start_angle by up to 2π.
        /// Direction: positive (CCW around `normal`) when `end_angle > start_angle`.
        end_angle: f64,
    },
}

/// Operations common to all curve variants.
pub trait CurveOps {
    /// Evaluate the curve at parameter `t`.
    /// `t` must be within `parameter_range()`.
    fn evaluate(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;

    /// First derivative (tangent vector, NOT necessarily unit length).
    fn derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3>;

    /// Tessellate the curve into a polyline approximating it within
    /// `chord_tol` (max sagitta error) in mm.
    /// Returns the points in order (start ... end inclusive).
    fn tessellate(&self, chord_tol: f64, mesh: &Mesh) -> Result<Vec<DVec3>>;

    /// Total arc length (mm).
    fn arc_length(&self, mesh: &Mesh) -> Result<f64>;

    /// Valid parameter range `[t_min, t_max]`.
    fn parameter_range(&self) -> (f64, f64);
}

impl CurveOps for AnalyticCurve {
    fn evaluate(&self, t: f64, mesh: &Mesh) -> Result<DVec3> {
        match self {
            AnalyticCurve::Line { start, end } => line::evaluate(*start, *end, t, mesh),
            AnalyticCurve::Circle { center, radius, normal, basis_u } => {
                Ok(circle::evaluate(*center, *radius, *normal, *basis_u, t))
            }
            AnalyticCurve::Arc { center, radius, normal, basis_u, .. } => {
                Ok(circle::evaluate(*center, *radius, *normal, *basis_u, t))
            }
        }
    }

    fn derivative(&self, t: f64, mesh: &Mesh) -> Result<DVec3> {
        match self {
            AnalyticCurve::Line { start, end } => line::derivative(*start, *end, mesh),
            AnalyticCurve::Circle { radius, normal, basis_u, .. } => {
                Ok(circle::derivative(*radius, *normal, *basis_u, t))
            }
            AnalyticCurve::Arc { radius, normal, basis_u, .. } => {
                Ok(circle::derivative(*radius, *normal, *basis_u, t))
            }
        }
    }

    fn tessellate(&self, chord_tol: f64, mesh: &Mesh) -> Result<Vec<DVec3>> {
        match self {
            AnalyticCurve::Line { start, end } => line::tessellate(*start, *end, mesh),
            AnalyticCurve::Circle { center, radius, normal, basis_u } => {
                Ok(circle::tessellate_full(*center, *radius, *normal, *basis_u, chord_tol))
            }
            AnalyticCurve::Arc {
                center, radius, normal, basis_u, start_angle, end_angle,
            } => Ok(arc::tessellate(
                *center, *radius, *normal, *basis_u, *start_angle, *end_angle, chord_tol,
            )),
        }
    }

    fn arc_length(&self, mesh: &Mesh) -> Result<f64> {
        match self {
            AnalyticCurve::Line { start, end } => line::arc_length(*start, *end, mesh),
            AnalyticCurve::Circle { radius, .. } => {
                Ok(2.0 * std::f64::consts::PI * radius)
            }
            AnalyticCurve::Arc { radius, start_angle, end_angle, .. } => {
                Ok(radius * (end_angle - start_angle).abs())
            }
        }
    }

    fn parameter_range(&self) -> (f64, f64) {
        match self {
            AnalyticCurve::Line { .. } => (0.0, 1.0),
            AnalyticCurve::Circle { .. } => (0.0, 2.0 * std::f64::consts::PI),
            AnalyticCurve::Arc { start_angle, end_angle, .. } => (*start_angle, *end_angle),
        }
    }
}

/// Compute the orthonormal basis_v from normal and basis_u.
/// Returns `normal × basis_u` (right-handed, unit length if inputs are unit).
#[inline]
pub(crate) fn basis_v(normal: DVec3, basis_u: DVec3) -> DVec3 {
    normal.cross(basis_u).normalize_or_zero()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analytic_curve_parameter_range_line() {
        let c = AnalyticCurve::Line {
            start: VertId::default(),
            end: VertId::default(),
        };
        assert_eq!(c.parameter_range(), (0.0, 1.0));
    }

    #[test]
    fn analytic_curve_parameter_range_circle() {
        let c = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let (t0, t1) = c.parameter_range();
        assert_eq!(t0, 0.0);
        assert!((t1 - 2.0 * std::f64::consts::PI).abs() < 1e-12);
    }

    #[test]
    fn analytic_curve_parameter_range_arc() {
        let c = AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 5.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.5,
            end_angle: 2.5,
        };
        assert_eq!(c.parameter_range(), (0.5, 2.5));
    }

    #[test]
    fn basis_v_orthogonal_to_inputs() {
        let n = DVec3::Z;
        let u = DVec3::X;
        let v = basis_v(n, u);
        assert!((v - DVec3::Y).length() < 1e-12, "expected +Y, got {:?}", v);
    }

    #[test]
    fn basis_v_right_handed() {
        // n=Z, u=X should give v=Y (right-handed)
        let v = basis_v(DVec3::Z, DVec3::X);
        assert!(v.dot(DVec3::Y) > 0.99);
    }

    #[test]
    fn arc_length_circle_2pi_r() {
        use crate::mesh::Mesh;
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center: DVec3::ZERO,
            radius: 7.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        };
        let len = c.arc_length(&mesh).unwrap();
        assert!((len - 2.0 * std::f64::consts::PI * 7.0).abs() < 1e-9);
    }

    #[test]
    fn arc_length_arc_radius_times_angle() {
        use crate::mesh::Mesh;
        let mesh = Mesh::new();
        let c = AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 4.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,  // 半圆
        };
        let len = c.arc_length(&mesh).unwrap();
        assert!((len - 4.0 * std::f64::consts::PI).abs() < 1e-9);
    }
}
