//! ADR-053 Phase H — Curve Transform & Continuity (Step 1 PoC)
//!
//! Variant promotion matrix (curve side):
//!   Line:           no-op (mesh vertex transform handles it; the Line
//!                   variant stores VertId which auto-evaluates from
//!                   current mesh state)
//!   Circle / Arc:   rigid / uniform-scale → kind preserved
//!                   non-uniform / shear   → NURBS promote (Step 2)
//!   Bezier:         control point transform — kind preserved (affine)
//!                   (Step 2)
//!   BSpline / NURBS: control point transform — kind preserved (Step 2)
//!
//! See ADR-053 §2.4 "Variant 별 Transform 구현 매트릭스".

use anyhow::{bail, Result};
use glam::{DMat4, DVec3};

use super::AnalyticCurve;
use crate::mesh::Mesh;

// ────────────────────────────────────────────────────────────────────
// Transform classification (TransformKind + classify_transform)
// ────────────────────────────────────────────────────────────────────

/// Classification of a transform matrix's geometric character.
/// Used by `AnalyticCurve::transform` and `AnalyticSurface::transform`
/// to decide whether the variant kind is preserved or must be promoted
/// to a more general representation (e.g. Circle → rational NURBS for
/// non-uniform scale producing an ellipse).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransformKind {
    /// `M ≈ I` within ε. transform is a no-op for any geometry.
    Identity,
    /// Pure translation (linear part = I, translation ≠ 0).
    Translation,
    /// Rotation + Translation (no scale, no reflection).
    Rigid,
    /// Uniform scale + Rigid (single scale factor on all 3 axes).
    UniformScale,
    /// Non-uniform scale, shear, projection, or reflection.
    /// Most variants must promote to NURBS under this kind.
    NonUniform,
}

/// Tolerance for transform classification. Loose enough to absorb f64
/// drift from typical pipeline operations (matrix composition, etc.)
/// but tight enough to distinguish intent.
pub const TRANSFORM_EPSILON: f64 = 1e-9;

/// Inspect a 4×4 matrix and classify its geometric character.
///
/// The classification looks at the linear 3×3 part (column lengths,
/// orthogonality, handedness) and the translation column.
pub fn classify_transform(m: &DMat4) -> TransformKind {
    let eps = TRANSFORM_EPSILON;

    // glam DMat4 is column-major. Extract the 3×3 linear part as columns.
    let c0 = m.x_axis.truncate();
    let c1 = m.y_axis.truncate();
    let c2 = m.z_axis.truncate();
    let t  = m.w_axis.truncate();

    let s0 = c0.length();
    let s1 = c1.length();
    let s2 = c2.length();

    // Singular columns → degenerate, treat as NonUniform (callers must bail)
    if s0 < eps || s1 < eps || s2 < eps {
        return TransformKind::NonUniform;
    }

    let n0 = c0 / s0;
    let n1 = c1 / s1;
    let n2 = c2 / s2;

    // Orthogonality of the rotation part
    let orth_01 = n0.dot(n1).abs();
    let orth_12 = n1.dot(n2).abs();
    let orth_02 = n0.dot(n2).abs();
    let orthogonal = orth_01 < eps && orth_12 < eps && orth_02 < eps;

    // Right-handed: det(R) ≈ +1 (reflections give -1, classified as
    // NonUniform for safety — they break Circle/Arc winding semantics).
    let det = n0.dot(n1.cross(n2));
    let right_handed = (det - 1.0).abs() < eps;

    if !orthogonal || !right_handed {
        return TransformKind::NonUniform;
    }

    // Same scale on all three columns
    let uniform_scale = (s0 - s1).abs() < eps && (s1 - s2).abs() < eps;
    if !uniform_scale {
        return TransformKind::NonUniform;
    }

    let no_scale = (s0 - 1.0).abs() < eps;
    let no_translation = t.length_squared() < eps * eps;

    let identity_rot = (n0 - DVec3::X).length_squared() < eps
                    && (n1 - DVec3::Y).length_squared() < eps
                    && (n2 - DVec3::Z).length_squared() < eps;

    if no_scale {
        match (identity_rot, no_translation) {
            (true,  true)  => TransformKind::Identity,
            (true,  false) => TransformKind::Translation,
            (false, _)     => TransformKind::Rigid,
        }
    } else {
        TransformKind::UniformScale
    }
}

/// Extract the uniform scale factor from a transform matrix.
/// Caller must verify `classify_transform(m)` is `UniformScale` or
/// `Identity` first; otherwise the result is meaningless.
#[inline]
pub fn uniform_scale_factor(m: &DMat4) -> f64 {
    m.x_axis.truncate().length()
}

// ────────────────────────────────────────────────────────────────────
// AnalyticCurve::transform implementation (Step 1: Line + Circle)
// ────────────────────────────────────────────────────────────────────

impl AnalyticCurve {
    /// ADR-053 Phase H — Return a new curve obtained by applying the
    /// transform `m` to this curve.
    ///
    /// Step 1 PoC: Line + Circle implemented. Other variants return
    /// `Err` until Step 2-3.
    ///
    /// `mesh` is needed only for the `Line` variant (which stores
    /// VertIds rather than positions) — Line's transform is a no-op
    /// because the underlying vertex move propagates automatically.
    pub fn transform(&self, m: &DMat4, _mesh: &Mesh) -> Result<AnalyticCurve> {
        match self {
            // Line: no-op. The variant's `start`/`end` are VertIds; the
            // mesh-level vertex translation has already updated the
            // positions that `Line::evaluate` reads. Returning the same
            // variant preserves the EdgeId↔CurveId stability invariant.
            AnalyticCurve::Line { .. } => Ok(self.clone()),

            // Circle: kind preserved under rigid + uniform scale.
            AnalyticCurve::Circle { center, radius, normal, basis_u } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let s = uniform_scale_factor(m);
                        Ok(AnalyticCurve::Circle {
                            center:  m.transform_point3(*center),
                            radius:  *radius * s,
                            normal:  m.transform_vector3(*normal).normalize_or_zero(),
                            basis_u: m.transform_vector3(*basis_u).normalize_or_zero(),
                        })
                    }
                    TransformKind::NonUniform => {
                        // Phase H Step 2: promote to rational NURBS quadratic
                        // (ellipse representation, Piegl §10.7).
                        bail!(
                            "ADR-053 Step 2: Circle under non-uniform transform must \
                             promote to NURBS (Ellipse). Not yet implemented."
                        );
                    }
                }
            }

            // Arc: same kind preservation rules as Circle, plus angle preservation.
            AnalyticCurve::Arc {
                center, radius, normal, basis_u, start_angle, end_angle,
            } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let s = uniform_scale_factor(m);
                        Ok(AnalyticCurve::Arc {
                            center:  m.transform_point3(*center),
                            radius:  *radius * s,
                            normal:  m.transform_vector3(*normal).normalize_or_zero(),
                            basis_u: m.transform_vector3(*basis_u).normalize_or_zero(),
                            start_angle: *start_angle,
                            end_angle:   *end_angle,
                        })
                    }
                    TransformKind::NonUniform => {
                        bail!(
                            "ADR-053 Step 2: Arc under non-uniform transform must \
                             promote to NURBS (Elliptical Arc). Not yet implemented."
                        );
                    }
                }
            }

            // Bezier: control point transform always preserves kind (affine map
            // on Bernstein basis). Works for any transform — kind never promotes.
            AnalyticCurve::Bezier { control_pts } => {
                let new_pts: Vec<DVec3> = control_pts.iter()
                    .map(|p| m.transform_point3(*p))
                    .collect();
                Ok(AnalyticCurve::Bezier { control_pts: new_pts })
            }

            // BSpline: same — control point affine. Knots/degree unchanged.
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                let new_pts: Vec<DVec3> = control_pts.iter()
                    .map(|p| m.transform_point3(*p))
                    .collect();
                Ok(AnalyticCurve::BSpline {
                    control_pts: new_pts,
                    knots: knots.clone(),
                    degree: *degree,
                })
            }

            // NURBS: control points transform, weights handled per kind.
            //   Rigid + UniformScale: weights preserved (rational ratio invariant)
            //   NonUniform: project to 4D homogeneous, transform, re-normalize
            AnalyticCurve::NURBS { control_pts, weights, knots, degree } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let new_pts: Vec<DVec3> = control_pts.iter()
                            .map(|p| m.transform_point3(*p))
                            .collect();
                        Ok(AnalyticCurve::NURBS {
                            control_pts: new_pts,
                            weights: weights.clone(),
                            knots: knots.clone(),
                            degree: *degree,
                        })
                    }
                    TransformKind::NonUniform => {
                        // 4D homogeneous lift: P_h = (w·P, w). Transform 3D part
                        // by m.transform_point3 (affine), keep weight unchanged
                        // since affine transforms preserve barycentric ratios.
                        // For projective transforms (true 4×4 with non-affine
                        // bottom row) a full 4D matrix multiply would be needed —
                        // glam DMat4 with [0,0,0,1] bottom row is always affine.
                        let new_pts: Vec<DVec3> = control_pts.iter()
                            .map(|p| m.transform_point3(*p))
                            .collect();
                        Ok(AnalyticCurve::NURBS {
                            control_pts: new_pts,
                            weights: weights.clone(),
                            knots: knots.clone(),
                            degree: *degree,
                        })
                    }
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests (PoC: 2 baseline regressions for Step 1)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::id::VertId;
    use crate::mesh::Mesh;
    use glam::DQuat;

    #[test]
    fn classify_identity() {
        let m = DMat4::IDENTITY;
        assert_eq!(classify_transform(&m), TransformKind::Identity);
    }

    #[test]
    fn classify_translation() {
        let m = DMat4::from_translation(DVec3::new(3.0, -2.0, 7.5));
        assert_eq!(classify_transform(&m), TransformKind::Translation);
    }

    #[test]
    fn classify_rotation() {
        let m = DMat4::from_rotation_z(0.7);
        assert_eq!(classify_transform(&m), TransformKind::Rigid);
    }

    #[test]
    fn classify_rotation_plus_translation() {
        let m = DMat4::from_rotation_translation(
            DQuat::from_rotation_y(1.1),
            DVec3::new(0.0, 5.0, 0.0),
        );
        assert_eq!(classify_transform(&m), TransformKind::Rigid);
    }

    #[test]
    fn classify_uniform_scale() {
        let m = DMat4::from_scale(DVec3::splat(2.5));
        assert_eq!(classify_transform(&m), TransformKind::UniformScale);
    }

    #[test]
    fn classify_non_uniform() {
        let m = DMat4::from_scale(DVec3::new(1.0, 2.0, 3.0));
        assert_eq!(classify_transform(&m), TransformKind::NonUniform);
    }

    #[test]
    fn classify_reflection_is_non_uniform() {
        // Reflection through XY plane (Z → -Z)
        let m = DMat4::from_scale(DVec3::new(1.0, 1.0, -1.0));
        assert_eq!(classify_transform(&m), TransformKind::NonUniform);
    }

    /// ADR-053 §2.7 #1 — Line transform is a no-op (mesh handles it).
    #[test]
    fn line_transform_is_no_op() {
        let mesh = Mesh::new();
        let line = AnalyticCurve::Line {
            start: VertId::default(),
            end:   VertId::default(),
        };
        let m = DMat4::from_translation(DVec3::new(10.0, 0.0, 0.0));
        let out = line.transform(&m, &mesh).expect("line transform ok");
        assert_eq!(out, line, "Line variant must be returned unchanged");
    }

    /// ADR-053 §2.7 #2 — Circle translate preserves kind + radius.
    #[test]
    fn circle_translate_preserves_kind() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center:  DVec3::new(1.0, 2.0, 3.0),
            radius:  5.0,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
        };
        let m = DMat4::from_translation(DVec3::new(10.0, -4.0, 0.5));
        let out = c.transform(&m, &mesh).expect("circle translate ok");
        match out {
            AnalyticCurve::Circle { center, radius, normal, basis_u } => {
                assert!((center - DVec3::new(11.0, -2.0, 3.5)).length() < 1e-12);
                assert!((radius - 5.0).abs() < 1e-12);
                assert!((normal - DVec3::Z).length() < 1e-12);
                assert!((basis_u - DVec3::X).length() < 1e-12);
            }
            other => panic!("expected Circle, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #3 — Circle uniform scale preserves kind, scales radius.
    #[test]
    fn circle_uniform_scale_preserves_kind_scales_radius() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center:  DVec3::ZERO,
            radius:  4.0,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
        };
        let m = DMat4::from_scale(DVec3::splat(2.0));
        let out = c.transform(&m, &mesh).expect("uniform scale ok");
        match out {
            AnalyticCurve::Circle { radius, .. } => {
                assert!((radius - 8.0).abs() < 1e-12,
                    "radius should be 4*2=8, got {}", radius);
            }
            other => panic!("expected Circle, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #4 — Circle rotation preserves radius, rotates normal.
    #[test]
    fn circle_rotation_preserves_radius() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center:  DVec3::ZERO,
            radius:  3.0,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
        };
        // Rotate +90° around X axis (right-hand rule): Z→-Y, Y→+Z
        let m = DMat4::from_rotation_x(std::f64::consts::FRAC_PI_2);
        let out = c.transform(&m, &mesh).expect("rotation ok");
        match out {
            AnalyticCurve::Circle { radius, normal, basis_u, .. } => {
                assert!((radius - 3.0).abs() < 1e-12);
                // Normal Z → -Y after +90° X rotation
                assert!((normal - DVec3::NEG_Y).length() < 1e-12,
                    "rotated normal should be -Y, got {:?}", normal);
                // basis_u X stays X (axis of rotation)
                assert!((basis_u - DVec3::X).length() < 1e-12);
            }
            other => panic!("expected Circle, got {:?}", other),
        }
    }

    /// Non-uniform Circle transform must Err (Step 2 work — promote pending).
    #[test]
    fn circle_non_uniform_returns_error_until_step2() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center:  DVec3::ZERO,
            radius:  1.0,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
        };
        let m = DMat4::from_scale(DVec3::new(2.0, 1.0, 1.0));
        assert!(c.transform(&m, &mesh).is_err(),
            "non-uniform Circle transform should bail until Step 2 promote");
    }

    // ── Step 2: Arc / Bezier / BSpline / NURBS ──

    /// ADR-053 §2.7 #6 — Arc rigid transform preserves angles.
    #[test]
    fn arc_rigid_transform_preserves_angles() {
        let mesh = Mesh::new();
        let a = AnalyticCurve::Arc {
            center: DVec3::ZERO, radius: 2.0,
            normal: DVec3::Z, basis_u: DVec3::X,
            start_angle: 0.5, end_angle: 1.7,
        };
        let m = DMat4::from_translation(DVec3::new(5.0, 0.0, 0.0));
        let out = a.transform(&m, &mesh).expect("arc translate ok");
        match out {
            AnalyticCurve::Arc { center, radius, start_angle, end_angle, .. } => {
                assert!((center - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-12);
                assert!((radius - 2.0).abs() < 1e-12);
                assert!((start_angle - 0.5).abs() < 1e-15);
                assert!((end_angle - 1.7).abs() < 1e-15);
            }
            other => panic!("expected Arc, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #7 — Bezier control points transform affinely.
    /// Kind preserved under any (even non-uniform) transform.
    #[test]
    fn bezier_affine_preserves_kind() {
        let mesh = Mesh::new();
        let b = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::new(0.0, 0.0, 0.0),
                DVec3::new(1.0, 1.0, 0.0),
                DVec3::new(2.0, 0.0, 0.0),
            ],
        };
        // Non-uniform scale — Bezier still works
        let m = DMat4::from_scale(DVec3::new(2.0, 3.0, 1.0));
        let out = b.transform(&m, &mesh).expect("bezier non-uniform ok");
        match out {
            AnalyticCurve::Bezier { control_pts } => {
                assert_eq!(control_pts.len(), 3);
                assert!((control_pts[0] - DVec3::ZERO).length() < 1e-12);
                assert!((control_pts[1] - DVec3::new(2.0, 3.0, 0.0)).length() < 1e-12);
                assert!((control_pts[2] - DVec3::new(4.0, 0.0, 0.0)).length() < 1e-12);
            }
            other => panic!("expected Bezier, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #8 — BSpline knots/degree preserved under transform.
    #[test]
    fn bspline_affine_preserves_knots() {
        let mesh = Mesh::new();
        let bs = AnalyticCurve::BSpline {
            control_pts: vec![
                DVec3::ZERO, DVec3::X, DVec3::new(2.0, 1.0, 0.0), DVec3::new(3.0, 0.0, 0.0),
            ],
            knots: vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0],
            degree: 2,
        };
        let m = DMat4::from_translation(DVec3::new(10.0, 0.0, 0.0));
        let out = bs.transform(&m, &mesh).expect("bspline transform ok");
        match out {
            AnalyticCurve::BSpline { control_pts, knots, degree } => {
                assert_eq!(degree, 2);
                assert_eq!(knots, vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0]);
                assert!((control_pts[0] - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
                assert!((control_pts[3] - DVec3::new(13.0, 0.0, 0.0)).length() < 1e-12);
            }
            other => panic!("expected BSpline, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #9 — NURBS rigid preserves weights.
    #[test]
    fn nurbs_rigid_preserves_weights() {
        let mesh = Mesh::new();
        let n = AnalyticCurve::NURBS {
            control_pts: vec![
                DVec3::new(1.0, 0.0, 0.0),
                DVec3::new(1.0, 1.0, 0.0),
                DVec3::new(0.0, 1.0, 0.0),
            ],
            weights: vec![1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0],
            knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            degree: 2,
        };
        let m = DMat4::from_rotation_z(0.5);
        let out = n.transform(&m, &mesh).expect("nurbs rigid ok");
        match out {
            AnalyticCurve::NURBS { weights, knots, degree, .. } => {
                assert_eq!(degree, 2);
                assert_eq!(knots, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
                assert!((weights[0] - 1.0).abs() < 1e-15);
                assert!((weights[1] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
                assert!((weights[2] - 1.0).abs() < 1e-15);
            }
            other => panic!("expected NURBS, got {:?}", other),
        }
    }

    /// Round-trip: identity composition (m * m⁻¹) ≈ identity → transform
    /// preserves curve evaluate to 1e-9.
    #[test]
    fn transform_round_trip_identity() {
        let mesh = Mesh::new();
        let c = AnalyticCurve::Circle {
            center:  DVec3::new(2.0, 3.0, 1.0),
            radius:  4.0,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
        };
        let m = DMat4::from_rotation_translation(
            DQuat::from_rotation_z(0.3),
            DVec3::new(7.0, -2.0, 5.0),
        );
        let m_inv = m.inverse();
        let after_forward  = c.transform(&m, &mesh).unwrap();
        let after_round    = after_forward.transform(&m_inv, &mesh).unwrap();
        // Sample evaluate at θ=0.7
        use crate::curves::CurveOps;
        let p_orig  = c.evaluate(0.7, &mesh).unwrap();
        let p_round = after_round.evaluate(0.7, &mesh).unwrap();
        assert!((p_orig - p_round).length() < 1e-9,
            "round-trip evaluate mismatch: {:?} vs {:?}", p_orig, p_round);
    }
}
