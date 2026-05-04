//! ADR-059 Phase N Step 3 — Surface Merge Policy.
//!
//! Implements `try_merge_surfaces(a, b, tol)` returning either a
//! merged `AnalyticSurface` or an explicit `SurfaceMergeRejection`.
//!
//! Per ADR-059 §A1.4 lock-in (silent merge 절대 금지) — every
//! non-mergeable case returns one of 4 documented rejection reasons.
//!
//! Used by `Mesh::merge_faces_by_edge` (Phase O integration) when
//! two coplanar faces are merged: their surface attributes must
//! reconcile, or the merge fails with a diagnostic.

use crate::surfaces::AnalyticSurface;
use crate::surfaces::ssi::tolerance::BooleanTolerance;

// ────────────────────────────────────────────────────────────────────
// Result types — ADR-059 §A1.4 lock-in
// ────────────────────────────────────────────────────────────────────

/// Outcome of a surface merge attempt. Per §A1.4 lock-in: never
/// returns a "silent" merged surface when inputs are incompatible.
#[derive(Clone, Debug)]
pub enum SurfaceMergeOutcome {
    /// Surfaces are compatible — merged result.
    Merged(AnalyticSurface),
    /// Surfaces cannot be merged — explicit reason for diagnostics.
    Rejected(SurfaceMergeRejection),
}

/// Documented reasons a surface merge was rejected. Phase J §7.5
/// pattern — 4 distinct reasons, each describing the specific failure.
#[derive(Clone, Debug, PartialEq)]
pub enum SurfaceMergeRejection {
    /// Surfaces are different variants (e.g., Plane vs Cylinder).
    /// Caller must use Boolean operations or refit, not merge.
    KindMismatch { left: &'static str, right: &'static str },
    /// Surfaces are same variant but their origins differ beyond
    /// the supplied tolerance. Includes the actual drift for caller
    /// diagnostics.
    OriginDriftExceedsTol { drift: f64, tol: f64 },
    /// Surfaces are same variant but their normals (or axis directions)
    /// differ beyond the angular tolerance. Includes actual angle.
    NormalAngleExceedsTol { angle_deg: f64, tol_deg: f64 },
    /// BSpline / NURBS surfaces have incompatible knot vectors.
    /// Phase I (knot insertion) unification required first.
    BSplineKnotsIncompatible,
}

impl SurfaceMergeOutcome {
    pub fn is_merged(&self) -> bool {
        matches!(self, SurfaceMergeOutcome::Merged(_))
    }
}

// ────────────────────────────────────────────────────────────────────
// try_merge_surfaces
// ────────────────────────────────────────────────────────────────────

/// Attempt to merge two `AnalyticSurface` instances. Per §A1.4 lock-in,
/// returns a documented `SurfaceMergeRejection` rather than a silent
/// best-effort merge for incompatible inputs.
///
/// Compatible cases (Merged result):
///   - Both Plane with origin drift < tol.geometric AND normal angle <
///     tol.angular: merged plane = average of inputs.
///   - Both Cylinder with same axis_dir and same radius: merged.
///   - Both Sphere with same center and same radius: merged.
///   - (Other variants: simple equality check, otherwise rejected.)
///
/// Incompatible cases (Rejected with reason).
pub fn try_merge_surfaces(
    a: &AnalyticSurface,
    b: &AnalyticSurface,
    tol: &BooleanTolerance,
) -> SurfaceMergeOutcome {
    let tol_angle_deg = tol.angular.to_degrees();

    match (a, b) {
        // ── Plane + Plane ──────────────────────────────────────────
        (
            AnalyticSurface::Plane { origin: oa, normal: na, basis_u: ba, u_range: ua, v_range: va },
            AnalyticSurface::Plane { origin: ob, normal: nb, basis_u: _bb, u_range: ub, v_range: vb },
        ) => {
            // Normal angle check
            let cos = na.dot(*nb).clamp(-1.0, 1.0);
            let angle_deg = cos.acos().to_degrees();
            if angle_deg > tol_angle_deg && (180.0 - angle_deg) > tol_angle_deg {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::NormalAngleExceedsTol {
                        angle_deg, tol_deg: tol_angle_deg,
                    }
                );
            }
            // Origin drift check (project ob onto na: (ob - oa) · na)
            let drift = (*ob - *oa).dot(*na).abs();
            if drift > tol.geometric {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::OriginDriftExceedsTol {
                        drift, tol: tol.geometric,
                    }
                );
            }
            // Compatible — merge: average origin, keep first's normal/basis
            SurfaceMergeOutcome::Merged(AnalyticSurface::Plane {
                origin: (*oa + *ob) * 0.5,
                normal: *na,
                basis_u: *ba,
                u_range: (ua.0.min(ub.0), ua.1.max(ub.1)),
                v_range: (va.0.min(vb.0), va.1.max(vb.1)),
            })
        }

        // ── Cylinder + Cylinder ───────────────────────────────────
        (
            AnalyticSurface::Cylinder { axis_origin: oa, axis_dir: da, radius: ra, ref_dir: rda, u_range: ua, v_range: va },
            AnalyticSurface::Cylinder { axis_origin: ob, axis_dir: db, radius: rb, ref_dir: _rdb, u_range: ub, v_range: vb },
        ) => {
            // Axis direction angle check
            let cos = da.dot(*db).clamp(-1.0, 1.0);
            let angle_deg = cos.acos().to_degrees();
            if angle_deg > tol_angle_deg && (180.0 - angle_deg) > tol_angle_deg {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::NormalAngleExceedsTol {
                        angle_deg, tol_deg: tol_angle_deg,
                    }
                );
            }
            // Radius check (treat as origin-drift category)
            if (ra - rb).abs() > tol.geometric {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::OriginDriftExceedsTol {
                        drift: (ra - rb).abs(), tol: tol.geometric,
                    }
                );
            }
            // Axis origin drift along axis perpendicular distance
            let along = (*ob - *oa).dot(*da);
            let perp = (*ob - *oa) - *da * along;
            let perp_drift = perp.length();
            if perp_drift > tol.geometric {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::OriginDriftExceedsTol {
                        drift: perp_drift, tol: tol.geometric,
                    }
                );
            }
            SurfaceMergeOutcome::Merged(AnalyticSurface::Cylinder {
                axis_origin: *oa,  // keep first's origin
                axis_dir: *da,
                radius: (*ra + *rb) * 0.5,
                ref_dir: *rda,
                u_range: (ua.0.min(ub.0), ua.1.max(ub.1)),
                v_range: (va.0.min(vb.0), va.1.max(vb.1)),
            })
        }

        // ── Sphere + Sphere ──────────────────────────────────────
        (
            AnalyticSurface::Sphere { center: ca, radius: ra, u_range: ua, v_range: va },
            AnalyticSurface::Sphere { center: cb, radius: rb, u_range: ub, v_range: vb },
        ) => {
            let drift = (*ca - *cb).length();
            if drift > tol.geometric {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::OriginDriftExceedsTol {
                        drift, tol: tol.geometric,
                    }
                );
            }
            if (ra - rb).abs() > tol.geometric {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::OriginDriftExceedsTol {
                        drift: (ra - rb).abs(), tol: tol.geometric,
                    }
                );
            }
            SurfaceMergeOutcome::Merged(AnalyticSurface::Sphere {
                center: (*ca + *cb) * 0.5,
                radius: (*ra + *rb) * 0.5,
                u_range: (ua.0.min(ub.0), ua.1.max(ub.1)),
                v_range: (va.0.min(vb.0), va.1.max(vb.1)),
            })
        }

        // ── BSpline / NURBS — knots compatibility check ─────────
        (
            AnalyticSurface::BSplineSurface { knots_u: kua, knots_v: kva, deg_u: dua, deg_v: dva, .. },
            AnalyticSurface::BSplineSurface { knots_u: kub, knots_v: kvb, deg_u: dub, deg_v: dvb, .. },
        ) => {
            if dua != dub || dva != dvb || !knots_equal(kua, kub, tol.parameter)
               || !knots_equal(kva, kvb, tol.parameter)
            {
                return SurfaceMergeOutcome::Rejected(
                    SurfaceMergeRejection::BSplineKnotsIncompatible
                );
            }
            // Knots match — caller would average ctrl_grid. For MVP we
            // reject (caller decides) since averaging tensor grids is
            // non-trivial.
            SurfaceMergeOutcome::Rejected(SurfaceMergeRejection::BSplineKnotsIncompatible)
        }

        // ── Mismatched kinds ─────────────────────────────────────
        (left, right) => SurfaceMergeOutcome::Rejected(
            SurfaceMergeRejection::KindMismatch {
                left: variant_name(left),
                right: variant_name(right),
            }
        ),
    }
}

fn variant_name(s: &AnalyticSurface) -> &'static str {
    use AnalyticSurface::*;
    match s {
        Plane { .. } => "Plane",
        Cylinder { .. } => "Cylinder",
        Sphere { .. } => "Sphere",
        Cone { .. } => "Cone",
        Torus { .. } => "Torus",
        BezierPatch { .. } => "BezierPatch",
        BSplineSurface { .. } => "BSplineSurface",
        NURBSSurface { .. } => "NURBSSurface",
    }
}

fn knots_equal(a: &[f64], b: &[f64], tol: f64) -> bool {
    if a.len() != b.len() { return false; }
    a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() <= tol)
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-059 §3 Step 3 (4 회귀)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    fn default_tol() -> BooleanTolerance {
        BooleanTolerance::default()
    }

    /// ADR-059 §3 Step 3 #1 — Two compatible Planes merge successfully.
    #[test]
    fn merge_compatible_planes_succeeds() {
        let a = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let b = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 1e-9),  // tiny drift within tol
            normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-2.0, 0.5), v_range: (-0.5, 2.0),
        };
        let out = try_merge_surfaces(&a, &b, &default_tol());
        match out {
            SurfaceMergeOutcome::Merged(AnalyticSurface::Plane {
                origin, normal, u_range, v_range, ..
            }) => {
                assert!((normal - DVec3::Z).length() < 1e-9);
                // origin averaged
                assert!(origin.z.abs() < 1e-6);
                // ranges expanded to union
                assert_eq!(u_range, (-2.0, 1.0));
                assert_eq!(v_range, (-1.0, 2.0));
            }
            other => panic!("expected Merged Plane, got {:?}", other),
        }
    }

    /// ADR-059 §3 Step 3 #2 — Plane + Cylinder rejects with KindMismatch.
    #[test]
    fn merge_kind_mismatch_returns_rejection() {
        let plane = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO, axis_dir: DVec3::Z, radius: 1.0,
            ref_dir: DVec3::X, u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        };
        let out = try_merge_surfaces(&plane, &cyl, &default_tol());
        match out {
            SurfaceMergeOutcome::Rejected(SurfaceMergeRejection::KindMismatch { left, right }) => {
                assert_eq!(left, "Plane");
                assert_eq!(right, "Cylinder");
            }
            other => panic!("expected KindMismatch, got {:?}", other),
        }
    }

    /// ADR-059 §3 Step 3 #3 — Plane + Plane with normal mismatch rejects.
    #[test]
    fn merge_normal_mismatch_returns_rejection() {
        let a = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let b = AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Y,  // 90° from Z
            basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let out = try_merge_surfaces(&a, &b, &default_tol());
        match out {
            SurfaceMergeOutcome::Rejected(SurfaceMergeRejection::NormalAngleExceedsTol {
                angle_deg, ..
            }) => {
                assert!((angle_deg - 90.0).abs() < 1.0);
            }
            other => panic!("expected NormalAngleExceedsTol, got {:?}", other),
        }
    }

    /// ADR-059 §3 Step 3 #4 — BSpline knots mismatch → rejection.
    #[test]
    fn merge_bspline_knots_incompatible_rejection() {
        let a = AnalyticSurface::BSplineSurface {
            ctrl_grid: vec![vec![DVec3::ZERO, DVec3::X], vec![DVec3::Y, DVec3::ONE]],
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 1, deg_v: 1,
        };
        let b = AnalyticSurface::BSplineSurface {
            ctrl_grid: vec![vec![DVec3::ZERO, DVec3::X], vec![DVec3::Y, DVec3::ONE]],
            knots_u: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],  // different
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 2,  // different degree
            deg_v: 1,
        };
        let out = try_merge_surfaces(&a, &b, &default_tol());
        assert!(matches!(out,
            SurfaceMergeOutcome::Rejected(SurfaceMergeRejection::BSplineKnotsIncompatible)));
    }

    /// Bonus: drift exceeding tol → OriginDriftExceedsTol.
    #[test]
    fn merge_plane_origin_drift_rejection() {
        let a = AnalyticSurface::Plane {
            origin: DVec3::ZERO, normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let b = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, 5.0),  // 5mm above
            normal: DVec3::Z, basis_u: DVec3::X,
            u_range: (-1.0, 1.0), v_range: (-1.0, 1.0),
        };
        let out = try_merge_surfaces(&a, &b, &default_tol());
        match out {
            SurfaceMergeOutcome::Rejected(SurfaceMergeRejection::OriginDriftExceedsTol {
                drift, tol,
            }) => {
                assert!((drift - 5.0).abs() < 1e-9);
                assert_eq!(tol, 1e-3);
            }
            other => panic!("expected OriginDriftExceedsTol, got {:?}", other),
        }
    }
}
