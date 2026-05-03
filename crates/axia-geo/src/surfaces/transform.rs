//! ADR-053 Phase H Step 3 — Surface transform.
//!
//! Variant promotion matrix (surface side):
//!   Analytic primitives (Plane/Cylinder/Sphere/Cone/Torus):
//!     rigid / uniform-scale → kind preserved
//!     non-uniform           → NURBS promote (deferred to Phase J)
//!   Patch family (BezierPatch / BSplineSurface / NURBSSurface):
//!     control-grid affine — kind preserved under any DMat4

use anyhow::{bail, Result};
use glam::{DMat4, DVec3};

use super::AnalyticSurface;
use crate::curves::transform::{TransformKind, classify_transform, uniform_scale_factor};

impl AnalyticSurface {
    /// ADR-053 Phase H — Apply transform to this surface, returning a new one.
    pub fn transform(&self, m: &DMat4) -> Result<AnalyticSurface> {
        match self {
            // ── Plane ──
            AnalyticSurface::Plane { origin, normal, basis_u, u_range, v_range } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        Ok(AnalyticSurface::Plane {
                            origin:  m.transform_point3(*origin),
                            normal:  m.transform_vector3(*normal).normalize_or_zero(),
                            basis_u: m.transform_vector3(*basis_u).normalize_or_zero(),
                            u_range: *u_range,
                            v_range: *v_range,
                        })
                    }
                    TransformKind::NonUniform => bail!(
                        "ADR-053 Phase J: Plane under non-uniform transform — promote pending"
                    ),
                }
            }

            // ── Cylinder ──
            AnalyticSurface::Cylinder {
                axis_origin, axis_dir, radius, ref_dir, u_range, v_range,
            } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let s = uniform_scale_factor(m);
                        Ok(AnalyticSurface::Cylinder {
                            axis_origin: m.transform_point3(*axis_origin),
                            axis_dir:    m.transform_vector3(*axis_dir).normalize_or_zero(),
                            radius:      *radius * s,
                            ref_dir:     m.transform_vector3(*ref_dir).normalize_or_zero(),
                            u_range:     *u_range,
                            v_range:     *v_range,
                        })
                    }
                    TransformKind::NonUniform => bail!(
                        "ADR-053 Phase J: Cylinder under non-uniform → generalized cylinder NURBS pending"
                    ),
                }
            }

            // ── Sphere ──
            AnalyticSurface::Sphere { center, radius, u_range, v_range } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let s = uniform_scale_factor(m);
                        Ok(AnalyticSurface::Sphere {
                            center:  m.transform_point3(*center),
                            radius:  *radius * s,
                            u_range: *u_range,
                            v_range: *v_range,
                        })
                    }
                    TransformKind::NonUniform => bail!(
                        "ADR-053 Phase J: Sphere under non-uniform → ellipsoid (NURBS) pending"
                    ),
                }
            }

            // ── Cone ──
            AnalyticSurface::Cone {
                apex, axis_dir, half_angle, ref_dir, u_range, v_range,
            } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        Ok(AnalyticSurface::Cone {
                            apex:       m.transform_point3(*apex),
                            axis_dir:   m.transform_vector3(*axis_dir).normalize_or_zero(),
                            half_angle: *half_angle,
                            ref_dir:    m.transform_vector3(*ref_dir).normalize_or_zero(),
                            u_range:    *u_range,
                            v_range:    *v_range,
                        })
                    }
                    TransformKind::NonUniform => bail!(
                        "ADR-053 Phase J: Cone under non-uniform → NURBS pending"
                    ),
                }
            }

            // ── Torus ──
            AnalyticSurface::Torus {
                center, axis_dir, ref_dir, major_radius, minor_radius, u_range, v_range,
            } => {
                match classify_transform(m) {
                    TransformKind::Identity => Ok(self.clone()),
                    TransformKind::Translation
                    | TransformKind::Rigid
                    | TransformKind::UniformScale => {
                        let s = uniform_scale_factor(m);
                        Ok(AnalyticSurface::Torus {
                            center:       m.transform_point3(*center),
                            axis_dir:     m.transform_vector3(*axis_dir).normalize_or_zero(),
                            ref_dir:      m.transform_vector3(*ref_dir).normalize_or_zero(),
                            major_radius: *major_radius * s,
                            minor_radius: *minor_radius * s,
                            u_range:      *u_range,
                            v_range:      *v_range,
                        })
                    }
                    TransformKind::NonUniform => bail!(
                        "ADR-053 Phase J: Torus under non-uniform → NURBS pending"
                    ),
                }
            }

            // ── BezierPatch — control grid affine, kind preserved always ──
            AnalyticSurface::BezierPatch { ctrl_grid } => {
                let new_grid: Vec<Vec<DVec3>> = ctrl_grid.iter()
                    .map(|row| row.iter().map(|p| m.transform_point3(*p)).collect())
                    .collect();
                Ok(AnalyticSurface::BezierPatch { ctrl_grid: new_grid })
            }

            // ── BSplineSurface ──
            AnalyticSurface::BSplineSurface {
                ctrl_grid, knots_u, knots_v, deg_u, deg_v,
            } => {
                let new_grid: Vec<Vec<DVec3>> = ctrl_grid.iter()
                    .map(|row| row.iter().map(|p| m.transform_point3(*p)).collect())
                    .collect();
                Ok(AnalyticSurface::BSplineSurface {
                    ctrl_grid: new_grid,
                    knots_u: knots_u.clone(),
                    knots_v: knots_v.clone(),
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                })
            }

            // ── NURBSSurface — control grid affine, weights/knots/trim preserved ──
            AnalyticSurface::NURBSSurface {
                ctrl_grid, weights, knots_u, knots_v, deg_u, deg_v, trim_loops,
            } => {
                let new_grid: Vec<Vec<DVec3>> = ctrl_grid.iter()
                    .map(|row| row.iter().map(|p| m.transform_point3(*p)).collect())
                    .collect();
                Ok(AnalyticSurface::NURBSSurface {
                    ctrl_grid: new_grid,
                    weights: weights.clone(),
                    knots_u: knots_u.clone(),
                    knots_v: knots_v.clone(),
                    deg_u: *deg_u,
                    deg_v: *deg_v,
                    trim_loops: trim_loops.clone(),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DQuat;

    /// ADR-053 §2.7 #13 — Plane translate preserves normal direction.
    #[test]
    fn plane_translate_preserves_normal_direction() {
        let p = AnalyticSurface::Plane {
            origin:  DVec3::ZERO,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-10.0, 10.0),
            v_range: (-10.0, 10.0),
        };
        let m = DMat4::from_translation(DVec3::new(5.0, 3.0, 7.0));
        let out = p.transform(&m).unwrap();
        match out {
            AnalyticSurface::Plane { origin, normal, .. } => {
                assert!((origin - DVec3::new(5.0, 3.0, 7.0)).length() < 1e-12);
                assert!((normal - DVec3::Z).length() < 1e-12);
            }
            other => panic!("expected Plane, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #14 — Cylinder rigid preserves radius.
    #[test]
    fn cylinder_rigid_preserves_radius() {
        let c = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir:    DVec3::Z,
            radius:      5.0,
            ref_dir:     DVec3::X,
            u_range:     (0.0, std::f64::consts::TAU),
            v_range:     (0.0, 10.0),
        };
        let m = DMat4::from_rotation_translation(
            DQuat::from_rotation_x(0.4),
            DVec3::new(2.0, 0.0, 0.0),
        );
        let out = c.transform(&m).unwrap();
        match out {
            AnalyticSurface::Cylinder { radius, .. } => {
                assert!((radius - 5.0).abs() < 1e-12);
            }
            other => panic!("expected Cylinder, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #15 — Sphere uniform scale changes radius proportionally.
    #[test]
    fn sphere_uniform_scale_changes_radius_proportionally() {
        let s = AnalyticSurface::Sphere {
            center:  DVec3::ZERO,
            radius:  3.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let m = DMat4::from_scale(DVec3::splat(2.5));
        let out = s.transform(&m).unwrap();
        match out {
            AnalyticSurface::Sphere { radius, .. } => {
                assert!((radius - 7.5).abs() < 1e-12, "expected 3*2.5=7.5, got {}", radius);
            }
            other => panic!("expected Sphere, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #16 — Sphere non-uniform must Err (Phase J promote).
    #[test]
    fn sphere_non_uniform_returns_error() {
        let s = AnalyticSurface::Sphere {
            center:  DVec3::ZERO,
            radius:  1.0,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        };
        let m = DMat4::from_scale(DVec3::new(2.0, 1.0, 3.0));
        assert!(s.transform(&m).is_err());
    }

    /// ADR-053 §2.7 #17 — Cone apex translates with origin.
    #[test]
    fn cone_apex_translates_with_origin() {
        let c = AnalyticSurface::Cone {
            apex:       DVec3::new(0.0, 0.0, 5.0),
            axis_dir:   DVec3::NEG_Z,
            half_angle: 0.4,
            ref_dir:    DVec3::X,
            u_range:    (0.0, std::f64::consts::TAU),
            v_range:    (0.0, 5.0),
        };
        let m = DMat4::from_translation(DVec3::new(1.0, 2.0, 3.0));
        let out = c.transform(&m).unwrap();
        match out {
            AnalyticSurface::Cone { apex, half_angle, .. } => {
                assert!((apex - DVec3::new(1.0, 2.0, 8.0)).length() < 1e-12);
                assert!((half_angle - 0.4).abs() < 1e-15);
            }
            other => panic!("expected Cone, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #18 — Torus rigid preserves both radii.
    #[test]
    fn torus_rigid_preserves_minor_major_radii() {
        let t = AnalyticSurface::Torus {
            center:       DVec3::ZERO,
            axis_dir:     DVec3::Z,
            ref_dir:      DVec3::X,
            major_radius: 5.0,
            minor_radius: 1.0,
            u_range:      (0.0, std::f64::consts::TAU),
            v_range:      (0.0, std::f64::consts::TAU),
        };
        let m = DMat4::from_rotation_z(0.7);
        let out = t.transform(&m).unwrap();
        match out {
            AnalyticSurface::Torus { major_radius, minor_radius, .. } => {
                assert!((major_radius - 5.0).abs() < 1e-12);
                assert!((minor_radius - 1.0).abs() < 1e-12);
            }
            other => panic!("expected Torus, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #19 — NURBS surface control points transformed.
    #[test]
    fn nurbs_surface_control_pts_transformed() {
        let s = AnalyticSurface::NURBSSurface {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::X],
                vec![DVec3::Y,    DVec3::new(1.0, 1.0, 0.0)],
            ],
            weights: vec![vec![1.0, 1.0], vec![1.0, 1.0]],
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 1, deg_v: 1,
            trim_loops: vec![],
        };
        let m = DMat4::from_translation(DVec3::new(10.0, 0.0, 0.0));
        let out = s.transform(&m).unwrap();
        match out {
            AnalyticSurface::NURBSSurface { ctrl_grid, weights, deg_u, deg_v, .. } => {
                assert_eq!(deg_u, 1); assert_eq!(deg_v, 1);
                assert_eq!(weights, vec![vec![1.0, 1.0], vec![1.0, 1.0]]);
                assert!((ctrl_grid[0][0] - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
                assert!((ctrl_grid[1][1] - DVec3::new(11.0, 1.0, 0.0)).length() < 1e-12);
            }
            other => panic!("expected NURBSSurface, got {:?}", other),
        }
    }

    /// ADR-053 §2.7 #20 — Surface normal invariant under rigid (sample evaluate).
    #[test]
    fn surface_normal_invariant_under_rigid() {
        use crate::surfaces::SurfaceOps;
        let p = AnalyticSurface::Plane {
            origin:  DVec3::ZERO,
            normal:  DVec3::Z,
            basis_u: DVec3::X,
            u_range: (-1.0, 1.0),
            v_range: (-1.0, 1.0),
        };
        let m = DMat4::from_rotation_z(0.3);
        let out = p.transform(&m).unwrap();
        // After Z-rotation, normal stays +Z (rotation axis preserves it)
        let n_orig = p.normal(0.0, 0.0);
        let n_out  = out.normal(0.0, 0.0);
        assert!((n_orig - n_out).length() < 1e-12,
            "rigid Z-rotation should preserve plane normal +Z, got {:?}", n_out);
    }

    /// ADR-053 §2.7 #21 — Bezier patch control grid affine.
    #[test]
    fn bezier_patch_control_grid_transformed() {
        let bp = AnalyticSurface::BezierPatch {
            ctrl_grid: vec![
                vec![DVec3::ZERO, DVec3::X, DVec3::new(2.0, 0.0, 0.0)],
                vec![DVec3::Y,    DVec3::new(1.0, 1.0, 0.0), DVec3::new(2.0, 1.0, 0.0)],
            ],
        };
        let m = DMat4::from_scale(DVec3::new(2.0, 3.0, 1.0)); // non-uniform OK for patch
        let out = bp.transform(&m).unwrap();
        match out {
            AnalyticSurface::BezierPatch { ctrl_grid } => {
                assert_eq!(ctrl_grid.len(), 2);
                assert_eq!(ctrl_grid[0].len(), 3);
                assert!((ctrl_grid[0][2] - DVec3::new(4.0, 0.0, 0.0)).length() < 1e-12);
                assert!((ctrl_grid[1][1] - DVec3::new(2.0, 3.0, 0.0)).length() < 1e-12);
            }
            other => panic!("expected BezierPatch, got {:?}", other),
        }
    }
}
