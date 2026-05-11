//! 2D parameter-space trim curves (Phase E, ADR-033).
//!
//! Trim curves live in the surface's `(u, v)` parameter space and define
//! "interior holes" or "outer cutouts" — used by industry CAD to represent
//! arbitrary face boundaries on a NURBS surface.
//!
//! ## Phase E MVP
//!
//! This module provides the **data structure** for trim curves. Full trim
//! handling (clipping, point-in-trim test, interior tessellation) is
//! deferred to Phase F (where it integrates with surface-surface
//! intersection).
//!
//! Each trim loop is a sequence of 2D curves forming a closed cycle in
//! the parameter space.

use serde::{Deserialize, Serialize};

/// One closed loop of trim curves in 2D parameter space.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TrimLoop {
    pub curves: Vec<TrimCurve2D>,
    /// Whether this loop bounds the surface from outside (CCW) or describes
    /// a hole (CW). A trimmed face's outer boundary has `is_outer = true`,
    /// inner cutouts have `is_outer = false`.
    pub is_outer: bool,
}

/// A single 2D curve in parameter space.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum TrimCurve2D {
    Line {
        a: [f64; 2],
        b: [f64; 2],
    },
    Arc {
        center: [f64; 2],
        radius: f64,
        start_angle: f64,
        end_angle: f64,
    },
    Bezier {
        control_pts: Vec<[f64; 2]>,
    },
    BSpline {
        control_pts: Vec<[f64; 2]>,
        knots: Vec<f64>,
        degree: u32,
    },
}

impl TrimCurve2D {
    /// Evaluate the curve at parameter `t` (in its own canonical range).
    pub fn evaluate(&self, t: f64) -> [f64; 2] {
        match self {
            TrimCurve2D::Line { a, b } => [
                a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t,
            ],
            TrimCurve2D::Arc {
                center, radius, start_angle, end_angle,
            } => {
                // Map t ∈ [0, 1] to angle ∈ [start, end]
                let angle = start_angle + (end_angle - start_angle) * t;
                [
                    center[0] + radius * angle.cos(),
                    center[1] + radius * angle.sin(),
                ]
            }
            TrimCurve2D::Bezier { control_pts } => {
                // De Casteljau on 2D points
                let mut pts: Vec<[f64; 2]> = control_pts.clone();
                let n = pts.len();
                for r in 1..n {
                    for i in 0..n - r {
                        pts[i] = [
                            pts[i][0] * (1.0 - t) + pts[i + 1][0] * t,
                            pts[i][1] * (1.0 - t) + pts[i + 1][1] * t,
                        ];
                    }
                }
                pts[0]
            }
            TrimCurve2D::BSpline {
                control_pts, knots, degree,
            } => {
                // 2D de Boor — simplified for trim use only.
                let p = *degree as usize;
                let n = control_pts.len();
                if n < p + 1 || knots.len() != n + p + 1 {
                    return control_pts.first().copied().unwrap_or([0.0, 0.0]);
                }
                // Find span
                let mut span = p;
                for i in p..n {
                    if t < knots[i + 1] {
                        span = i;
                        break;
                    }
                    span = n - 1;
                }
                // Working buffer
                let mut d: Vec<[f64; 2]> = (0..=p)
                    .map(|j| control_pts[span - p + j]).collect();
                for r in 1..=p {
                    for j in (r..=p).rev() {
                        let i = span - p + j;
                        let denom = knots[i + p - r + 1] - knots[i];
                        let alpha = if denom.abs() < 1e-12 {
                            0.0
                        } else {
                            (t - knots[i]) / denom
                        };
                        d[j] = [
                            d[j - 1][0] * (1.0 - alpha) + d[j][0] * alpha,
                            d[j - 1][1] * (1.0 - alpha) + d[j][1] * alpha,
                        ];
                    }
                }
                d[p]
            }
        }
    }

    /// Tessellate to a polyline of `n_samples` points (for visual / clipping).
    pub fn tessellate(&self, n_samples: usize) -> Vec<[f64; 2]> {
        let n = n_samples.max(2);
        let mut out = Vec::with_capacity(n + 1);
        for i in 0..=n {
            let t = (i as f64) / (n as f64);
            out.push(self.evaluate(t));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: [f64; 2], b: [f64; 2], eps: f64) -> bool {
        (a[0] - b[0]).abs() < eps && (a[1] - b[1]).abs() < eps
    }

    #[test]
    fn trim_line_evaluate_endpoints() {
        let c = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 5.0] };
        assert!(approx_eq(c.evaluate(0.0), [0.0, 0.0], 1e-12));
        assert!(approx_eq(c.evaluate(1.0), [10.0, 5.0], 1e-12));
        assert!(approx_eq(c.evaluate(0.5), [5.0, 2.5], 1e-12));
    }

    #[test]
    fn trim_arc_evaluate_quarter() {
        // Quarter arc center (0,0), radius 5, 0 → π/2.
        let c = TrimCurve2D::Arc {
            center: [0.0, 0.0],
            radius: 5.0,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        };
        assert!(approx_eq(c.evaluate(0.0), [5.0, 0.0], 1e-12));
        assert!(approx_eq(c.evaluate(1.0), [0.0, 5.0], 1e-9));
    }

    #[test]
    fn trim_arc_evaluate_offset_center() {
        let c = TrimCurve2D::Arc {
            center: [10.0, 20.0],
            radius: 3.0,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        };
        let p_mid = c.evaluate(0.5);
        // Midpoint angle = π/2 → (10 + 0, 20 + 3) = (10, 23)
        assert!(approx_eq(p_mid, [10.0, 23.0], 1e-9));
    }

    #[test]
    fn trim_bezier_evaluate_corner_endpoints() {
        let c = TrimCurve2D::Bezier {
            control_pts: vec![[0.0, 0.0], [5.0, 10.0], [10.0, 0.0]],
        };
        assert!(approx_eq(c.evaluate(0.0), [0.0, 0.0], 1e-12));
        assert!(approx_eq(c.evaluate(1.0), [10.0, 0.0], 1e-12));
    }

    #[test]
    fn trim_bezier_quadratic_midpoint() {
        let c = TrimCurve2D::Bezier {
            control_pts: vec![[0.0, 0.0], [4.0, 6.0], [10.0, 0.0]],
        };
        // P(0.5) = 0.25·P0 + 0.5·P1 + 0.25·P2
        let mid = c.evaluate(0.5);
        assert!(approx_eq(mid, [4.5, 3.0], 1e-9));
    }

    #[test]
    fn trim_bspline_clamped_endpoints() {
        let c = TrimCurve2D::BSpline {
            control_pts: vec![[0.0, 0.0], [3.0, 5.0], [7.0, 5.0], [10.0, 0.0]],
            knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
            degree: 3,
        };
        let p0 = c.evaluate(0.0);
        let p1 = c.evaluate(1.0);
        assert!(approx_eq(p0, [0.0, 0.0], 1e-9));
        assert!(approx_eq(p1, [10.0, 0.0], 1e-9));
    }

    #[test]
    fn trim_tessellate_returns_n_plus_one_points() {
        let c = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 0.0] };
        let pts = c.tessellate(8);
        assert_eq!(pts.len(), 9);
        assert!(approx_eq(pts[0], [0.0, 0.0], 1e-12));
        assert!(approx_eq(pts[8], [10.0, 0.0], 1e-12));
    }

    #[test]
    fn trim_loop_is_outer_flag() {
        let outer = TrimLoop {
            curves: vec![TrimCurve2D::Line { a: [0.0, 0.0], b: [1.0, 0.0] }],
            is_outer: true,
        };
        let inner = TrimLoop {
            curves: vec![TrimCurve2D::Arc {
                center: [0.5, 0.5], radius: 0.1,
                start_angle: 0.0, end_angle: std::f64::consts::TAU,
            }],
            is_outer: false,
        };
        assert!(outer.is_outer);
        assert!(!inner.is_outer);
    }

    #[test]
    fn trim_curve_serialize_roundtrip() {
        let c = TrimCurve2D::Bezier {
            control_pts: vec![[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]],
        };
        let json = serde_json::to_string(&c).unwrap();
        let c2: TrimCurve2D = serde_json::from_str(&json).unwrap();
        assert_eq!(c, c2);
    }
}
