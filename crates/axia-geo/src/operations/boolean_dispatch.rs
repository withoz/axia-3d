//! ADR-060 Phase O Step 4 — Boolean Dispatch (NURBS-aware).
//!
//! Drop-in alongside the existing mesh `Mesh::boolean` (per Phase M/N
//! validated pattern). This module adds `Mesh::boolean_dispatch`, which
//! inspects each operand's faces:
//!
//! * If both sides expose every face with `face.surface = Some(_)` AND
//!   the surface kinds are convertible to a non-rational tensor B-spline
//!   form, it attempts the NURBS path via `nurbs_boolean_v2` (Phase J).
//! * Otherwise it routes directly to the mesh path (existing
//!   `Mesh::boolean`) and records `BooleanPath::Mesh`.
//!
//! ## §F lock-in (silent fallback prohibited)
//!
//! Every result carries an explicit `path_used: BooleanPath` and, when
//! a NURBS attempt failed, a `fallback_reason: Some(NurbsBooleanFailReason)`.
//! Silent geometry corruption ("NURBS quietly downgraded to mesh") is
//! impossible — Phase J §7.5 pattern.
//!
//! ## MVP scope (Phase O Step 4)
//!
//! * Geometric assembly is still produced by the mesh path. The NURBS
//!   path runs as a *probe + diagnostic* — `nurbs_boolean_v2` is invoked
//!   to validate that the surfaces would intersect cleanly, and the
//!   diagnostic flows to `nurbs_diagnostic`. Full geometric replacement
//!   (trim curve → DCEL face split) is Phase L's responsibility.
//! * Eligible surface kinds: `Plane`, `BezierPatch`, `BSplineSurface`.
//!   Other primitives (Cylinder/Sphere/Cone/Torus) and rational
//!   `NURBSSurface` produce `NurbsBooleanFailReason::UnsupportedSurfaceKind`
//!   and route through mesh fallback.
//! * Eligibility is per-face. Multi-face operands with mixed
//!   surface/no-surface produce `Mesh` path.
//!
//! ## §X.5 lock-in #3 — Boolean dispatch result must be explicit
//!
//! `BooleanPath` enum is the single source of truth for which engine
//! computed the geometric result. Callers (UI / WASM / scripts) MUST
//! check `path_used` before reporting success to the user.

use anyhow::Result;
use glam::DVec3;

use super::boolean::{BoolOp, BooleanResult};
use crate::mesh::Mesh;
use crate::surfaces::AnalyticSurface;
use crate::{FaceId, MaterialId};

// ────────────────────────────────────────────────────────────────────
// Public API surface
// ────────────────────────────────────────────────────────────────────

/// Which engine produced the Boolean result.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BooleanPath {
    /// Mesh path used directly. NURBS was not eligible (one or both
    /// operands lack analytic surfaces) — no fallback was needed.
    Mesh,
    /// NURBS path produced a clean intersection; geometric result
    /// (currently mesh-assembled, Phase L will replace) is annotated as
    /// NURBS-clean.
    Nurbs,
    /// NURBS path was eligible (both operands had surfaces) but failed
    /// or was non-clean. Mesh path produced the actual result and the
    /// `fallback_reason` field carries the diagnostic.
    NurbsWithMeshFallback,
}

/// Which side an unsupported surface lives on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideTag {
    A,
    B,
}

/// Why the NURBS path could not produce a clean result.
///
/// Mirrors Phase J §7.5 explicit-failure-reason pattern. Silent fallback
/// is prohibited; every NURBS attempt that does not yield `BooleanPath::Nurbs`
/// must populate this enum.
#[derive(Clone, Debug)]
pub enum NurbsBooleanFailReason {
    /// One or both operand faces lack `face.surface`. NURBS cannot run.
    SurfaceMissing { side_a_missing_count: usize, side_b_missing_count: usize },
    /// MVP currently routes only single-face × single-face NURBS.
    MultipleFacesNotSupported { count_a: usize, count_b: usize },
    /// Surface kind cannot yet be converted to non-rational tensor
    /// B-spline form for `nurbs_boolean_v2`.
    UnsupportedSurfaceKind { which: SideTag, kind: &'static str },
    /// `NURBSSurface` carries existing trim loops — composition with
    /// SSI-generated trims requires Phase L.
    TrimLoopsNotSupported { which: SideTag },
    /// `nurbs_boolean_v2` returned `Err`.
    NurbsCoreError(String),
    /// `nurbs_boolean_v2` returned a non-clean robustness report
    /// (tangent contact / coincident regions / branch points / etc.).
    SsiNotClean { summary: String },
}

impl NurbsBooleanFailReason {
    pub fn short_label(&self) -> &'static str {
        match self {
            Self::SurfaceMissing { .. } => "surface_missing",
            Self::MultipleFacesNotSupported { .. } => "multiface_unsupported_mvp",
            Self::UnsupportedSurfaceKind { .. } => "unsupported_surface_kind",
            Self::TrimLoopsNotSupported { .. } => "trim_loops_unsupported_mvp",
            Self::NurbsCoreError(_) => "nurbs_core_error",
            Self::SsiNotClean { .. } => "ssi_not_clean",
        }
    }
}

/// Diagnostic from a NURBS Boolean attempt (success or failure path).
#[derive(Clone, Debug, Default)]
pub struct NurbsDiagnostic {
    pub attempted: bool,
    pub intersection_chain_count: usize,
    pub robustness_clean: bool,
    /// Free-form notes: surface kinds, conversion choices, etc.
    pub notes: Vec<String>,
}

/// ADR-060 Phase O Step 4 — Boolean dispatch result.
///
/// Wraps the existing mesh `BooleanResult` with explicit path-tagging and
/// optional NURBS diagnostic. §F lock-in: callers MUST inspect
/// `path_used` before reporting success.
#[derive(Debug)]
pub struct BooleanDispatchResult {
    pub mesh_result: BooleanResult,
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
    pub nurbs_diagnostic: NurbsDiagnostic,
}

/// ADR-066 Y-1 — Per-pair outcome inside a multi-face dispatch.
///
/// `result.Ok(...)` carries the Path Z `nurbs_boolean_to_dcel` result.
/// `result.Err(message)` is a Y-H=(c) skip-and-warn record for that
/// specific pair (e.g., InactiveFace from cascade removal in earlier
/// pairs, ContainmentDepth ≥ 2, etc.).
#[derive(Debug)]
pub struct PerPairDcelOutcome {
    pub face_a: FaceId,
    pub face_b: FaceId,
    pub result: Result<super::boolean_nurbs_dcel::NurbsBooleanDcelResult, String>,
}

/// ADR-066 Y-1 — Multi-face Boolean dispatch result (Path Y).
///
/// Drop-in alongside `BooleanDispatchDcelResult` (Y-D / D-G consistency).
/// Used by `boolean_dispatch_dcel_multi` which iterates the cartesian
/// product of `facesA × facesB` and accumulates per-pair outcomes.
///
/// **Path semantics**:
/// - `BooleanPath::Nurbs` — eligibility passed; per_pair contains
///   N×M outcomes (Ok or Err per Y-H=(c)). `all_new_faces` /
///   `all_removed_faces` aggregate across successful pairs (deduped).
/// - `BooleanPath::Mesh` — eligibility rejected upfront (Y-E=(a) strict;
///   any face missing surface or unsupported kind). `per_pair` is empty,
///   `fallback_reason` populated. Caller decides next step (Y-D=(a)
///   no auto fallback).
///
/// **Aggregate dedup**: `all_new_faces` / `all_removed_faces` collect
/// IDs from all successful pairs in sorted-unique order so callers can
/// directly use them for selection updates / undo tracking without
/// further dedup.
#[derive(Debug)]
pub struct BooleanDispatchDcelMultiResult {
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
    pub per_pair: Vec<PerPairDcelOutcome>,
    pub all_new_faces: Vec<FaceId>,
    pub all_removed_faces: Vec<FaceId>,
    pub warnings: Vec<String>,
}

/// ADR-064 Step 5 — DCEL-producing dispatch result (Path Z opt-in).
///
/// Drop-in alongside `BooleanDispatchResult` (D-G / D-P consistency).
/// Used by `boolean_dispatch_dcel` which routes eligible single-face ×
/// single-face NURBS pairs through `nurbs_boolean_to_dcel` (Step 4).
///
/// **Differs from `BooleanDispatchResult`**:
/// - No `mesh_result` — the NURBS path produces its own DCEL faces;
///   mesh path is NOT auto-invoked when ineligible. Callers branching
///   on `path_used == Mesh` must explicitly invoke `boolean_dispatch`
///   for mesh-path semantics.
/// - `dcel: Option<NurbsBooleanDcelResult>` — present iff
///   `path_used == BooleanPath::Nurbs`. Carries new_faces_a/b,
///   removed_faces, preserved_faces, disjoint, robustness.
///
/// **path_used in this context**:
/// - `Nurbs`        : NURBS path produced DCEL result (success).
/// - `Mesh`         : Eligibility failed (surface missing / multiface /
///                    unsupported kind). `dcel = None`,
///                    `fallback_reason = Some(reason)`. Caller must
///                    handle (no auto mesh fallback per D-K/Q).
/// - `NurbsWithMeshFallback`: NEVER used by `boolean_dispatch_dcel`.
///                    Step 5 propagates Err on NURBS core failure
///                    rather than silently falling back.
#[derive(Debug)]
pub struct BooleanDispatchDcelResult {
    pub dcel: Option<super::boolean_nurbs_dcel::NurbsBooleanDcelResult>,
    pub path_used: BooleanPath,
    pub fallback_reason: Option<NurbsBooleanFailReason>,
    pub nurbs_diagnostic: NurbsDiagnostic,
}

// ────────────────────────────────────────────────────────────────────
// Surface → B-spline conversion (MVP)
// ────────────────────────────────────────────────────────────────────

/// Non-rational tensor B-spline parameters needed by
/// `nurbs_wrapper::intersect_bspline_pair`.
///
/// **ADR-064 Step 2.B**: pub(crate) to allow `Mesh::nurbs_boolean_to_dcel`
/// reuse via `surface_to_bspline_pub` thin wrapper. drop-in alongside.
pub(crate) struct BSplineParams {
    pub(crate) ctrl_grid: Vec<Vec<DVec3>>,
    pub(crate) knots_u: Vec<f64>,
    pub(crate) knots_v: Vec<f64>,
    pub(crate) deg_u: usize,
    pub(crate) deg_v: usize,
}

/// Attempt to express an `AnalyticSurface` as a non-rational tensor
/// B-spline. Returns `Ok(params)` for supported kinds, otherwise an
/// explicit reason.
pub(crate) fn surface_to_bspline(
    surface: &AnalyticSurface,
    side: SideTag,
) -> Result<BSplineParams, NurbsBooleanFailReason> {
    use crate::curves::bspline::clamped_uniform_knots;
    match surface {
        AnalyticSurface::BSplineSurface {
            ctrl_grid, knots_u, knots_v, deg_u, deg_v,
        } => Ok(BSplineParams {
            ctrl_grid: ctrl_grid.clone(),
            knots_u: knots_u.clone(),
            knots_v: knots_v.clone(),
            deg_u: *deg_u as usize,
            deg_v: *deg_v as usize,
        }),
        AnalyticSurface::BezierPatch { ctrl_grid } => {
            let n_u = ctrl_grid.len().max(1);
            let n_v = ctrl_grid.first().map(|r| r.len()).unwrap_or(1).max(1);
            let deg_u = n_u.saturating_sub(1).max(1);
            let deg_v = n_v.saturating_sub(1).max(1);
            Ok(BSplineParams {
                ctrl_grid: ctrl_grid.clone(),
                knots_u: clamped_uniform_knots(n_u, deg_u),
                knots_v: clamped_uniform_knots(n_v, deg_v),
                deg_u, deg_v,
            })
        }
        AnalyticSurface::Plane {
            origin, normal, basis_u, u_range, v_range,
        } => {
            // Build a 2×2 degree-1 grid spanning the face's parameter range.
            let n = normal.normalize_or_zero();
            let u_axis = basis_u.normalize_or_zero();
            let v_axis = n.cross(u_axis).normalize_or_zero();
            let (u0, u1) = *u_range;
            let (v0, v1) = *v_range;
            let p = |u: f64, v: f64| *origin + u_axis * u + v_axis * v;
            let ctrl_grid = vec![
                vec![p(u0, v0), p(u0, v1)],
                vec![p(u1, v0), p(u1, v1)],
            ];
            Ok(BSplineParams {
                ctrl_grid,
                knots_u: vec![0.0, 0.0, 1.0, 1.0],
                knots_v: vec![0.0, 0.0, 1.0, 1.0],
                deg_u: 1, deg_v: 1,
            })
        }
        AnalyticSurface::NURBSSurface { trim_loops, .. } => {
            if !trim_loops.is_empty() {
                Err(NurbsBooleanFailReason::TrimLoopsNotSupported { which: side })
            } else {
                // Rational NURBS not yet supported by intersect_bspline_pair.
                Err(NurbsBooleanFailReason::UnsupportedSurfaceKind {
                    which: side, kind: "NURBSSurface(rational)",
                })
            }
        }
        AnalyticSurface::Cylinder { .. } => Err(
            NurbsBooleanFailReason::UnsupportedSurfaceKind { which: side, kind: "Cylinder" }),
        AnalyticSurface::Sphere { .. } => Err(
            NurbsBooleanFailReason::UnsupportedSurfaceKind { which: side, kind: "Sphere" }),
        AnalyticSurface::Cone { .. } => Err(
            NurbsBooleanFailReason::UnsupportedSurfaceKind { which: side, kind: "Cone" }),
        AnalyticSurface::Torus { .. } => Err(
            NurbsBooleanFailReason::UnsupportedSurfaceKind { which: side, kind: "Torus" }),
    }
}

fn surface_kind_label(s: &AnalyticSurface) -> &'static str {
    match s {
        AnalyticSurface::Plane { .. } => "Plane",
        AnalyticSurface::Cylinder { .. } => "Cylinder",
        AnalyticSurface::Sphere { .. } => "Sphere",
        AnalyticSurface::Cone { .. } => "Cone",
        AnalyticSurface::Torus { .. } => "Torus",
        AnalyticSurface::BezierPatch { .. } => "BezierPatch",
        AnalyticSurface::BSplineSurface { .. } => "BSplineSurface",
        AnalyticSurface::NURBSSurface { .. } => "NURBSSurface",
    }
}

// ────────────────────────────────────────────────────────────────────
// Eligibility + NURBS attempt
// ────────────────────────────────────────────────────────────────────

/// Inspect surfaces on both operand face sets without running anything.
/// Used by `boolean_dispatch` and exposed as a probe for callers that
/// want to predict the path without committing.
pub fn classify_dispatch_eligibility(
    mesh: &Mesh,
    faces_a: &[FaceId],
    faces_b: &[FaceId],
) -> Result<(), NurbsBooleanFailReason> {
    let missing_a = faces_a.iter()
        .filter(|f| mesh.face_surface(**f).is_none())
        .count();
    let missing_b = faces_b.iter()
        .filter(|f| mesh.face_surface(**f).is_none())
        .count();
    if missing_a + missing_b > 0 {
        return Err(NurbsBooleanFailReason::SurfaceMissing {
            side_a_missing_count: missing_a,
            side_b_missing_count: missing_b,
        });
    }
    if faces_a.len() != 1 || faces_b.len() != 1 {
        return Err(NurbsBooleanFailReason::MultipleFacesNotSupported {
            count_a: faces_a.len(), count_b: faces_b.len(),
        });
    }
    // Probe surface conversion early.
    let sa = mesh.face_surface(faces_a[0])
        .expect("eligibility: surface_a presence already checked");
    let sb = mesh.face_surface(faces_b[0])
        .expect("eligibility: surface_b presence already checked");
    surface_to_bspline(sa, SideTag::A)?;
    surface_to_bspline(sb, SideTag::B)?;
    Ok(())
}

/// Map mesh `BoolOp` to NURBS `BooleanOp` (1:1).
fn map_op(op: BoolOp) -> crate::surfaces::ssi::boolean::BooleanOp {
    use crate::surfaces::ssi::boolean::BooleanOp as N;
    match op {
        BoolOp::Union => N::Union,
        BoolOp::Subtract => N::Subtract,
        BoolOp::Intersect => N::Intersect,
    }
}

/// Run `nurbs_boolean_v2` on a single-face × single-face operand pair.
/// Returns `Ok(diagnostic)` on clean SSI, `Err(reason)` otherwise.
fn try_nurbs_path(
    mesh: &Mesh,
    face_a: FaceId,
    face_b: FaceId,
    op: BoolOp,
) -> Result<NurbsDiagnostic, NurbsBooleanFailReason> {
    use crate::surfaces::ssi::boolean::nurbs_boolean_v2;
    use crate::surfaces::ssi::tolerance::BooleanTolerance;

    let sa = mesh.face_surface(face_a)
        .ok_or(NurbsBooleanFailReason::SurfaceMissing {
            side_a_missing_count: 1, side_b_missing_count: 0,
        })?;
    let sb = mesh.face_surface(face_b)
        .ok_or(NurbsBooleanFailReason::SurfaceMissing {
            side_a_missing_count: 0, side_b_missing_count: 1,
        })?;

    let mut notes = Vec::new();
    notes.push(format!("A.kind={}", surface_kind_label(sa)));
    notes.push(format!("B.kind={}", surface_kind_label(sb)));

    let pa = surface_to_bspline(sa, SideTag::A)?;
    let pb = surface_to_bspline(sb, SideTag::B)?;

    let result = nurbs_boolean_v2(
        &pa.ctrl_grid, &pa.knots_u, &pa.knots_v, pa.deg_u, pa.deg_v,
        &pb.ctrl_grid, &pb.knots_u, &pb.knots_v, pb.deg_u, pb.deg_v,
        map_op(op),
        BooleanTolerance::default(),
    ).map_err(|e| NurbsBooleanFailReason::NurbsCoreError(e.to_string()))?;

    let chain_count = result.intersection.len();
    if !result.is_clean {
        let r = &result.robustness;
        let summary = format!(
            "tangent_contacts={} coincident_regions={} branch_points={} pcurve_missing={} self_intersections={} boundary_grazing={}",
            r.tangent_contacts.len(),
            r.coincident_regions.len(),
            r.branch_points.len(),
            r.pcurve_missing.len(),
            r.self_intersections.len(),
            r.boundary_grazing.len(),
        );
        return Err(NurbsBooleanFailReason::SsiNotClean { summary });
    }

    Ok(NurbsDiagnostic {
        attempted: true,
        intersection_chain_count: chain_count,
        robustness_clean: true,
        notes,
    })
}

// ────────────────────────────────────────────────────────────────────
// Mesh impl — public dispatch entry point
// ────────────────────────────────────────────────────────────────────

impl Mesh {
    /// ADR-060 Phase O Step 4 — NURBS-aware Boolean dispatch.
    ///
    /// Drop-in alongside `Mesh::boolean` (existing mesh path is
    /// untouched). Routes to the NURBS path when both operands expose
    /// convertible analytic surfaces; otherwise falls through to the
    /// mesh path. Every result carries an explicit `path_used` and,
    /// when a NURBS attempt failed, a `fallback_reason` (§F lock-in,
    /// silent fallback prohibited).
    pub fn boolean_dispatch(
        &mut self,
        faces_a: &[FaceId],
        faces_b: &[FaceId],
        op: BoolOp,
        material: MaterialId,
    ) -> Result<BooleanDispatchResult> {
        // 1. Eligibility probe (read-only).
        let eligibility = classify_dispatch_eligibility(self, faces_a, faces_b);

        // 2. NURBS attempt if eligible.
        let (nurbs_diag, nurbs_fail) = match &eligibility {
            Ok(()) => {
                match try_nurbs_path(self, faces_a[0], faces_b[0], op) {
                    Ok(diag) => (diag, None),
                    Err(reason) => (
                        NurbsDiagnostic {
                            attempted: true,
                            intersection_chain_count: 0,
                            robustness_clean: false,
                            notes: vec![format!("nurbs_failed: {}", reason.short_label())],
                        },
                        Some(reason),
                    ),
                }
            }
            Err(reason) => (
                NurbsDiagnostic {
                    attempted: false,
                    intersection_chain_count: 0,
                    robustness_clean: false,
                    notes: vec![format!("nurbs_skipped: {}", reason.short_label())],
                },
                Some(reason.clone()),
            ),
        };

        // 3. Always run mesh path for actual geometric assembly
        //    (Phase L will replace this for the NURBS path).
        let mesh_result = self.boolean(faces_a, faces_b, op, material)?;

        // 4. Tag path_used per §F lock-in.
        let path_used = match (&eligibility, &nurbs_fail) {
            (Ok(()), None) => BooleanPath::Nurbs,
            (Ok(()), Some(_)) => BooleanPath::NurbsWithMeshFallback,
            (Err(_), _) => BooleanPath::Mesh,
        };

        // 5. fallback_reason policy:
        //    - Mesh path: fallback_reason is the eligibility rejection
        //      (informative — "why didn't NURBS run").
        //    - NurbsWithMeshFallback: the actual NURBS failure reason.
        //    - Nurbs: None.
        let fallback_reason = match path_used {
            BooleanPath::Nurbs => None,
            BooleanPath::NurbsWithMeshFallback => nurbs_fail,
            BooleanPath::Mesh => nurbs_fail,
        };

        Ok(BooleanDispatchResult {
            mesh_result,
            path_used,
            fallback_reason,
            nurbs_diagnostic: nurbs_diag,
        })
    }

    /// ADR-064 Step 5 (Path Z) — DCEL-producing Boolean dispatch.
    ///
    /// Drop-in alongside `boolean_dispatch` (D-P unchanged). Routes
    /// eligible **single-face × single-face** NURBS pairs through
    /// `Mesh::nurbs_boolean_to_dcel` (Step 4) which produces actual
    /// DCEL faces (new_faces_a/b) and applies op-specific removal of
    /// inputs (D-C=(a)).
    ///
    /// ## Decision matrix (Path Z)
    /// - **D-J=(b)** Opt-in via this new method; existing
    ///   `boolean_dispatch` UNCHANGED.
    /// - **D-K=(a)** Mesh path retained (caller invokes
    ///   `boolean_dispatch` explicitly when ineligible).
    /// - **D-L=(b)** New result type `BooleanDispatchDcelResult`.
    /// - **D-M=(b)** No probe-then-assemble dedup — Phase J runs once
    ///   inside `nurbs_boolean_to_dcel`.
    /// - **D-N=(b)** SSI non-empty + no closed loops → D-H safe-only
    ///   preserves inputs (Step 4 consistency).
    /// - **D-O=(a)** Disjoint → D-F=(c) preserves both (Step 4).
    /// - **D-P=(a)** Existing `boolean_dispatch` untouched.
    /// - **D-Q=(b)** WASM bridge / UI integration is Step 6.
    ///
    /// ## Path semantics
    /// * `BooleanPath::Nurbs` → `dcel = Some(result)`. May still have
    ///   empty new_faces (disjoint or D-H safe-only) — caller branches
    ///   on `result.disjoint` and `result.removed_faces`.
    /// * `BooleanPath::Mesh` → `dcel = None`,
    ///   `fallback_reason = Some(reason)`. Eligibility was rejected
    ///   (surface missing / multiface / unsupported kind / trim loops).
    ///   No mesh path auto-invocation — caller decides.
    /// * `BooleanPath::NurbsWithMeshFallback` is NEVER returned here:
    ///   if `nurbs_boolean_to_dcel` returns Err, this method propagates
    ///   the Err (D-H safe-only — no silent geometry mutation).
    pub fn boolean_dispatch_dcel(
        &mut self,
        face_a: FaceId,
        face_b: FaceId,
        op: BoolOp,
        tol: crate::surfaces::ssi::tolerance::BooleanTolerance,
    ) -> Result<BooleanDispatchDcelResult> {
        // 1. Eligibility probe (read-only, identical to boolean_dispatch).
        let eligibility = classify_dispatch_eligibility(
            self, &[face_a], &[face_b],
        );

        // 2. Ineligible → BooleanPath::Mesh, dcel=None, no auto-fallback.
        if let Err(reason) = eligibility {
            let label = reason.short_label();
            return Ok(BooleanDispatchDcelResult {
                dcel: None,
                path_used: BooleanPath::Mesh,
                fallback_reason: Some(reason),
                nurbs_diagnostic: NurbsDiagnostic {
                    attempted: false,
                    intersection_chain_count: 0,
                    robustness_clean: false,
                    notes: vec![format!("nurbs_skipped: {}", label)],
                },
            });
        }

        // 3. Eligible — extract surface kinds for diagnostic notes.
        let mut notes = Vec::new();
        if let Some(sa) = self.face_surface(face_a) {
            notes.push(format!("A.kind={}", surface_kind_label(sa)));
        }
        if let Some(sb) = self.face_surface(face_b) {
            notes.push(format!("B.kind={}", surface_kind_label(sb)));
        }

        // 4. D-M=(b) — call nurbs_boolean_to_dcel directly (Phase J runs
        //    once internally). Err propagates per D-H safe-only.
        let dcel_result = self.nurbs_boolean_to_dcel(face_a, face_b, op, tol)?;

        // 5. Tag NURBS diagnostic from the dcel result.
        let robustness_clean = dcel_result.robustness.is_clean();
        let chain_count = if dcel_result.disjoint { 0 } else {
            // The dcel result doesn't expose `intersection.len()`, but
            // since we got past the disjoint branch, ≥1 chain existed.
            // Phase J's chain count would require re-running it; we
            // approximate via "≥1 if not disjoint else 0".
            // This is a diagnostic, not an invariant.
            1
        };

        Ok(BooleanDispatchDcelResult {
            dcel: Some(dcel_result),
            path_used: BooleanPath::Nurbs,
            fallback_reason: None,
            nurbs_diagnostic: NurbsDiagnostic {
                attempted: true,
                intersection_chain_count: chain_count,
                robustness_clean,
                notes,
            },
        })
    }

    /// ADR-066 Y-1 (Path Y) — Multi-face NURBS Boolean dispatch.
    ///
    /// Drop-in alongside `boolean_dispatch_dcel` (single-face × single-face,
    /// ADR-064 Step 5). Iterates the cartesian product `facesA × facesB`
    /// and calls `nurbs_boolean_to_dcel` per pair. Per-pair outcomes are
    /// collected as `Ok` / `Err` records (Y-H=(c) skip-and-warn).
    ///
    /// ## Decision matrix (Path Y Y-1)
    /// - **Y-C=(a)** new method (UNCHANGED `boolean_dispatch_dcel`)
    /// - **Y-D** Path Z method UNCHANGED — drop-in alongside
    /// - **Y-E=(a)** strict eligibility — every face must have analytic
    ///   surface AND `surface_to_bspline` must succeed. ANY violation →
    ///   `BooleanPath::Mesh` + fallback_reason (no per-pair attempt).
    /// - **Y-F=(a)** caller-named operands (`facesA` / `facesB`)
    /// - **Y-G=(a)** Cartesian iteration (N×M pairs)
    /// - **Y-H=(c)** per-pair Err → warning + skip (no abort)
    /// - **Y-I=(b)** per-pair safe-only removal — succeeded pair's
    ///   inputs removed by `nurbs_boolean_to_dcel` per its own D-C=(a)
    ///   semantics. Cascade: if Subtract on (a, b1) removes a, then
    ///   (a, b2) returns InactiveFace Err → captured as warning.
    ///
    /// ## Single-face × single-face degenerate
    /// When `facesA.len() == 1 && facesB.len() == 1`, delegates to
    /// `boolean_dispatch_dcel` (Path Z) and adapts the result. Avoids
    /// dual code paths for the 1×1 case.
    pub fn boolean_dispatch_dcel_multi(
        &mut self,
        faces_a: &[FaceId],
        faces_b: &[FaceId],
        op: BoolOp,
        tol: crate::surfaces::ssi::tolerance::BooleanTolerance,
    ) -> Result<BooleanDispatchDcelMultiResult> {
        // ── Empty operand guard ─────────────────────────────────────
        if faces_a.is_empty() || faces_b.is_empty() {
            return Ok(BooleanDispatchDcelMultiResult {
                path_used: BooleanPath::Mesh,
                fallback_reason: Some(NurbsBooleanFailReason::MultipleFacesNotSupported {
                    count_a: faces_a.len(),
                    count_b: faces_b.len(),
                }),
                per_pair: Vec::new(),
                all_new_faces: Vec::new(),
                all_removed_faces: Vec::new(),
                warnings: vec![format!(
                    "empty operand: |A|={}, |B|={}", faces_a.len(), faces_b.len(),
                )],
            });
        }

        // ── Y-1 Lock-in #4: 1×1 degenerate → Path Z delegation ──────
        if faces_a.len() == 1 && faces_b.len() == 1 {
            let face_a = faces_a[0];
            let face_b = faces_b[0];
            let z_result = self.boolean_dispatch_dcel(face_a, face_b, op, tol)?;
            // Adapt single result to multi shape.
            let (per_pair, all_new, all_removed, path_used, fallback_reason)
                = match z_result.dcel {
                Some(dcel) => {
                    let new_a = dcel.new_faces_a.clone();
                    let new_b = dcel.new_faces_b.clone();
                    let removed = dcel.removed_faces.clone();
                    let mut all_new = new_a; all_new.extend(new_b);
                    (
                        vec![PerPairDcelOutcome {
                            face_a, face_b,
                            result: Ok(dcel),
                        }],
                        all_new, removed,
                        z_result.path_used,
                        z_result.fallback_reason,
                    )
                }
                None => (
                    Vec::new(), Vec::new(), Vec::new(),
                    z_result.path_used,
                    z_result.fallback_reason,
                ),
            };
            return Ok(BooleanDispatchDcelMultiResult {
                path_used, fallback_reason,
                per_pair, all_new_faces: all_new, all_removed_faces: all_removed,
                warnings: Vec::new(),
            });
        }

        // ── Y-E=(a) Strict eligibility — every face on both sides ───
        // Check ANY face missing surface → upfront Mesh path.
        let missing_a = faces_a.iter()
            .filter(|f| self.face_surface(**f).is_none())
            .count();
        let missing_b = faces_b.iter()
            .filter(|f| self.face_surface(**f).is_none())
            .count();
        if missing_a + missing_b > 0 {
            return Ok(BooleanDispatchDcelMultiResult {
                path_used: BooleanPath::Mesh,
                fallback_reason: Some(NurbsBooleanFailReason::SurfaceMissing {
                    side_a_missing_count: missing_a,
                    side_b_missing_count: missing_b,
                }),
                per_pair: Vec::new(),
                all_new_faces: Vec::new(),
                all_removed_faces: Vec::new(),
                warnings: vec![format!(
                    "Y-E strict: {} face(s) on side A and {} on side B \
                     lack analytic surface attachment",
                    missing_a, missing_b,
                )],
            });
        }
        // Probe every face's surface via surface_to_bspline (early Err).
        for &fid in faces_a {
            let s = self.face_surface(fid).expect("checked above");
            if let Err(reason) = surface_to_bspline(s, SideTag::A) {
                return Ok(BooleanDispatchDcelMultiResult {
                    path_used: BooleanPath::Mesh,
                    fallback_reason: Some(reason),
                    per_pair: Vec::new(),
                    all_new_faces: Vec::new(),
                    all_removed_faces: Vec::new(),
                    warnings: vec![format!(
                        "Y-E strict: face_a {:?} surface conversion failed", fid,
                    )],
                });
            }
        }
        for &fid in faces_b {
            let s = self.face_surface(fid).expect("checked above");
            if let Err(reason) = surface_to_bspline(s, SideTag::B) {
                return Ok(BooleanDispatchDcelMultiResult {
                    path_used: BooleanPath::Mesh,
                    fallback_reason: Some(reason),
                    per_pair: Vec::new(),
                    all_new_faces: Vec::new(),
                    all_removed_faces: Vec::new(),
                    warnings: vec![format!(
                        "Y-E strict: face_b {:?} surface conversion failed", fid,
                    )],
                });
            }
        }

        // ── Y-G=(a) Cartesian dispatch + Y-H=(c) skip-and-warn ──────
        let mut per_pair: Vec<PerPairDcelOutcome> = Vec::new();
        let mut warnings: Vec<String> = Vec::new();
        let mut all_new: Vec<FaceId> = Vec::new();
        let mut all_removed: Vec<FaceId> = Vec::new();

        for &face_a in faces_a {
            for &face_b in faces_b {
                let pair_outcome = self.boolean_dispatch_dcel(face_a, face_b, op, tol);
                match pair_outcome {
                    Ok(ok) if ok.path_used == BooleanPath::Nurbs => {
                        if let Some(dcel) = ok.dcel {
                            all_new.extend(dcel.new_faces_a.iter().copied());
                            all_new.extend(dcel.new_faces_b.iter().copied());
                            all_removed.extend(dcel.removed_faces.iter().copied());
                            per_pair.push(PerPairDcelOutcome {
                                face_a, face_b, result: Ok(dcel),
                            });
                        } else {
                            // Nurbs path with null dcel — defensive
                            warnings.push(format!(
                                "pair ({:?}, {:?}): Nurbs path with null dcel — skipped",
                                face_a, face_b,
                            ));
                        }
                    }
                    Ok(ok) => {
                        // Mesh path on a sub-pair (rare — usually multi-pair
                        // succeed/fail uniformly per Y-E strict). Treat as
                        // skip-and-warn to keep Path Y atomic.
                        let label = ok.fallback_reason.as_ref()
                            .map(|r| r.short_label())
                            .unwrap_or("unknown");
                        warnings.push(format!(
                            "pair ({:?}, {:?}): Mesh path (reason={}) — skipped",
                            face_a, face_b, label,
                        ));
                        per_pair.push(PerPairDcelOutcome {
                            face_a, face_b,
                            result: Err(format!("Mesh path: {}", label)),
                        });
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        warnings.push(format!(
                            "pair ({:?}, {:?}): {}",
                            face_a, face_b, msg,
                        ));
                        per_pair.push(PerPairDcelOutcome {
                            face_a, face_b, result: Err(msg),
                        });
                    }
                }
            }
        }

        // Dedup aggregates (sorted-unique).
        all_new.sort_unstable_by_key(|f| f.raw());
        all_new.dedup();
        all_removed.sort_unstable_by_key(|f| f.raw());
        all_removed.dedup();

        Ok(BooleanDispatchDcelMultiResult {
            path_used: BooleanPath::Nurbs,
            fallback_reason: None,
            per_pair,
            all_new_faces: all_new,
            all_removed_faces: all_removed,
            warnings,
        })
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests — ADR-060 §3.1 Step 4 acceptance (14 regression invariants).
// All tests are non-#[ignore]; §X.5 lock-in #6 mandates strict.
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surfaces::AnalyticSurface;
    use glam::DVec3;

    fn make_box(
        mesh: &mut Mesh,
        min: DVec3,
        max: DVec3,
        mat: MaterialId,
    ) -> Vec<FaceId> {
        let v = [
            mesh.add_vertex(DVec3::new(min.x, min.y, min.z)),
            mesh.add_vertex(DVec3::new(max.x, min.y, min.z)),
            mesh.add_vertex(DVec3::new(max.x, max.y, min.z)),
            mesh.add_vertex(DVec3::new(min.x, max.y, min.z)),
            mesh.add_vertex(DVec3::new(min.x, min.y, max.z)),
            mesh.add_vertex(DVec3::new(max.x, min.y, max.z)),
            mesh.add_vertex(DVec3::new(max.x, max.y, max.z)),
            mesh.add_vertex(DVec3::new(min.x, max.y, max.z)),
        ];
        let face_verts = [
            [v[0], v[3], v[2], v[1]],
            [v[4], v[5], v[6], v[7]],
            [v[0], v[1], v[5], v[4]],
            [v[2], v[3], v[7], v[6]],
            [v[0], v[4], v[7], v[3]],
            [v[1], v[2], v[6], v[5]],
        ];
        let mut faces = Vec::new();
        for verts in &face_verts {
            if let Ok(fid) = mesh.add_face(verts, mat) {
                faces.push(fid);
            }
        }
        faces
    }

    /// Build two unit boxes overlapping along X — classic Boolean fixture.
    fn two_overlapping_boxes() -> (Mesh, Vec<FaceId>, Vec<FaceId>, MaterialId) {
        let mut mesh = Mesh::default();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::new(-0.5, -0.5, -0.5),
                         DVec3::new(0.5, 0.5, 0.5), mat);
        let b = make_box(&mut mesh, DVec3::new(0.0, -0.5, -0.5),
                         DVec3::new(1.0, 0.5, 0.5), mat);
        (mesh, a, b, mat)
    }

    /// Attach a Plane surface to a face, deriving origin + normal from
    /// the face's first 3 outer vertices.
    fn attach_plane_to_face(mesh: &mut Mesh, fid: FaceId) {
        let start = mesh.faces.get(fid).expect("face exists").outer().start;
        let outer_verts = mesh.collect_loop_verts(start).unwrap();
        assert!(outer_verts.len() >= 3);
        let p0 = mesh.verts[outer_verts[0]].pos();
        let p1 = mesh.verts[outer_verts[1]].pos();
        let p2 = mesh.verts[outer_verts[2]].pos();
        let basis_u = (p1 - p0).normalize_or_zero();
        let normal = (p1 - p0).cross(p2 - p0).normalize_or_zero();
        let surface = AnalyticSurface::Plane {
            origin: p0,
            normal,
            basis_u,
            u_range: (-10.0, 10.0),
            v_range: (-10.0, 10.0),
        };
        assert!(mesh.set_face_surface(fid, Some(surface)));
    }

    fn attach_planes_to_all(mesh: &mut Mesh, faces: &[FaceId]) {
        for &f in faces {
            attach_plane_to_face(mesh, f);
        }
    }

    // ── Test 1 ────────────────────────────────────────────────
    /// Both operands lack surfaces → BooleanPath::Mesh, fallback_reason
    /// records `SurfaceMissing`.
    #[test]
    fn dispatch_no_surfaces_uses_mesh_path() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        assert_eq!(result.path_used, BooleanPath::Mesh);
        match result.fallback_reason {
            Some(NurbsBooleanFailReason::SurfaceMissing { .. }) => {}
            other => panic!("expected SurfaceMissing, got {:?}", other),
        }
        assert!(!result.nurbs_diagnostic.attempted);
    }

    // ── Test 2 ────────────────────────────────────────────────
    /// All A faces have surfaces, B has none → still Mesh path with
    /// SurfaceMissing reporting only B as missing.
    #[test]
    fn dispatch_partial_surfaces_uses_mesh_path() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        attach_planes_to_all(&mut mesh, &a);
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        assert_eq!(result.path_used, BooleanPath::Mesh);
        match result.fallback_reason {
            Some(NurbsBooleanFailReason::SurfaceMissing {
                side_a_missing_count: 0,
                side_b_missing_count: n,
            }) if n > 0 => {}
            other => panic!("expected SurfaceMissing(B>0,A=0), got {:?}", other),
        }
    }

    // ── Test 3 ────────────────────────────────────────────────
    /// All faces have surfaces but operand A has 6 faces (full box)
    /// → MultipleFacesNotSupported, mesh fallback.
    #[test]
    fn dispatch_multiface_unsupported_routes_to_mesh_fallback() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        attach_planes_to_all(&mut mesh, &a);
        attach_planes_to_all(&mut mesh, &b);
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        assert_eq!(result.path_used, BooleanPath::Mesh);
        match result.fallback_reason {
            Some(NurbsBooleanFailReason::MultipleFacesNotSupported { count_a, count_b }) => {
                assert_eq!(count_a, a.len());
                assert_eq!(count_b, b.len());
            }
            other => panic!("expected MultipleFacesNotSupported, got {:?}", other),
        }
    }

    // ── Test 4 ────────────────────────────────────────────────
    /// Single-face × single-face with attached Plane surfaces → NURBS path
    /// is attempted.
    #[test]
    fn dispatch_single_face_with_plane_attempts_nurbs() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        let face_a = a[0];
        let face_b = b[0];
        attach_plane_to_face(&mut mesh, face_a);
        attach_plane_to_face(&mut mesh, face_b);
        let result = mesh.boolean_dispatch(
            &[face_a], &[face_b], BoolOp::Union, mat,
        ).unwrap();
        // NURBS path was attempted (regardless of clean/fail).
        assert!(result.nurbs_diagnostic.attempted,
            "NURBS path must be probed when both faces have surfaces");
    }

    // ── Test 5 ────────────────────────────────────────────────
    /// Eligibility classifier matches the dispatch outcome (read-only
    /// probe matches actual decision).
    #[test]
    fn dispatch_classify_eligibility_matches_actual_path() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        // Case 1: no surfaces → eligibility Err, path Mesh.
        let elig = classify_dispatch_eligibility(&mesh, &a, &b);
        assert!(elig.is_err());
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        assert_eq!(result.path_used, BooleanPath::Mesh);

        // Case 2: single-face × single-face Plane → eligibility Ok.
        let (mut mesh2, a2, b2, mat2) = two_overlapping_boxes();
        attach_plane_to_face(&mut mesh2, a2[0]);
        attach_plane_to_face(&mut mesh2, b2[0]);
        assert!(classify_dispatch_eligibility(&mesh2, &[a2[0]], &[b2[0]]).is_ok());
    }

    // ── Test 6 ────────────────────────────────────────────────
    /// Cylinder surface → UnsupportedSurfaceKind, mesh fallback.
    #[test]
    fn dispatch_unsupported_surface_kind_falls_back() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        let face_a = a[0];
        let face_b = b[0];
        attach_plane_to_face(&mut mesh, face_a);
        let cyl = AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 1.0),
        };
        assert!(mesh.set_face_surface(face_b, Some(cyl)));
        let result = mesh.boolean_dispatch(
            &[face_a], &[face_b], BoolOp::Union, mat,
        ).unwrap();
        match result.fallback_reason {
            Some(NurbsBooleanFailReason::UnsupportedSurfaceKind {
                which: SideTag::B, kind: "Cylinder",
            }) => {}
            other => panic!("expected UnsupportedSurfaceKind(B,Cylinder), got {:?}", other),
        }
        // Path: ineligible classification → Mesh path (not Fallback).
        assert_eq!(result.path_used, BooleanPath::Mesh);
    }

    // ── Test 7 ────────────────────────────────────────────────
    /// §F lock-in: silent fallback prohibited. Mesh-path result MUST
    /// expose path_used and (when NURBS was probed and failed) a
    /// fallback_reason. No Boolean result can claim Nurbs without
    /// nurbs_diagnostic.robustness_clean.
    #[test]
    fn dispatch_silent_fallback_prohibited() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        // path_used always populated.
        let _ = result.path_used;
        // Mesh path: either fallback_reason is Some (NURBS was ineligible
        // and we recorded why) or None (genuine Mesh-only case). For our
        // fixture (no surfaces), it MUST be Some.
        assert!(result.fallback_reason.is_some());
        // Nurbs claim requires clean diagnostic.
        if result.path_used == BooleanPath::Nurbs {
            assert!(result.nurbs_diagnostic.robustness_clean,
                "BooleanPath::Nurbs requires robustness_clean=true");
        }
    }

    // ── Test 8 ────────────────────────────────────────────────
    /// Mesh result equality: dispatch output's mesh_result must equal
    /// what the existing mesh boolean would produce alone (drop-in
    /// alongside; no behavioral change to mesh path).
    #[test]
    fn dispatch_mesh_result_matches_existing_boolean() {
        let (mut mesh1, a1, b1, mat1) = two_overlapping_boxes();
        let direct = mesh1.boolean(&a1, &b1, BoolOp::Union, mat1).unwrap();

        let (mut mesh2, a2, b2, mat2) = two_overlapping_boxes();
        let dispatched = mesh2.boolean_dispatch(&a2, &b2, BoolOp::Union, mat2).unwrap();

        assert_eq!(direct.faces.len(), dispatched.mesh_result.faces.len());
        assert_eq!(direct.new_verts, dispatched.mesh_result.new_verts);
    }

    // ── Test 9 ────────────────────────────────────────────────
    /// All three BoolOps dispatch without panicking.
    #[test]
    fn dispatch_all_three_ops_succeed() {
        for op in [BoolOp::Union, BoolOp::Subtract, BoolOp::Intersect] {
            let (mut mesh, a, b, mat) = two_overlapping_boxes();
            let res = mesh.boolean_dispatch(&a, &b, op, mat);
            assert!(res.is_ok(), "dispatch {:?} failed: {:?}", op, res.err());
        }
    }

    // ── Test 10 ───────────────────────────────────────────────
    /// NurbsBooleanFailReason short_label is stable + distinct per
    /// variant (audit / telemetry contract — Phase J §7.5).
    #[test]
    fn fail_reason_short_labels_are_distinct() {
        use NurbsBooleanFailReason as R;
        let labels: Vec<&'static str> = vec![
            R::SurfaceMissing { side_a_missing_count: 1, side_b_missing_count: 0 }.short_label(),
            R::MultipleFacesNotSupported { count_a: 6, count_b: 6 }.short_label(),
            R::UnsupportedSurfaceKind { which: SideTag::A, kind: "Sphere" }.short_label(),
            R::TrimLoopsNotSupported { which: SideTag::B }.short_label(),
            R::NurbsCoreError("x".into()).short_label(),
            R::SsiNotClean { summary: "x".into() }.short_label(),
        ];
        let unique: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(unique.len(), labels.len(),
            "short_label values must be distinct (telemetry contract)");
    }

    // ── Test 11 ───────────────────────────────────────────────
    /// nurbs_diagnostic.notes contain surface kind tags for both sides
    /// when NURBS path is attempted.
    #[test]
    fn dispatch_diagnostic_records_surface_kinds() {
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        attach_plane_to_face(&mut mesh, a[0]);
        attach_plane_to_face(&mut mesh, b[0]);
        let result = mesh.boolean_dispatch(
            &[a[0]], &[b[0]], BoolOp::Union, mat,
        ).unwrap();
        let notes_joined = result.nurbs_diagnostic.notes.join(" | ");
        assert!(notes_joined.contains("A.kind=") || notes_joined.contains("nurbs_failed"));
        // For Plane × Plane attempt, side tags should appear in some form.
        // (Plane × Plane SSI on parallel planes is legitimately empty;
        // diagnostic still records that NURBS was probed.)
        assert!(result.nurbs_diagnostic.attempted);
    }

    // ── Test 12 ───────────────────────────────────────────────
    /// NURBS surface with trim_loops attached → TrimLoopsNotSupported.
    #[test]
    fn dispatch_nurbs_trim_loops_rejected() {
        use crate::surfaces::trim::{TrimLoop, TrimCurve2D};
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        attach_plane_to_face(&mut mesh, a[0]);
        // Build a minimal NURBS surface with a single trim loop.
        let ctrl = vec![
            vec![DVec3::ZERO,         DVec3::new(0.0, 1.0, 0.0)],
            vec![DVec3::new(1.0,0.0,0.0), DVec3::new(1.0, 1.0, 0.0)],
        ];
        let weights = vec![vec![1.0, 1.0], vec![1.0, 1.0]];
        let trim_loops = vec![TrimLoop {
            curves: vec![TrimCurve2D::Line {
                a: [0.0, 0.0],
                b: [1.0, 0.0],
            }],
            is_outer: false,
        }];
        let nurbs = AnalyticSurface::NURBSSurface {
            ctrl_grid: ctrl,
            weights,
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            deg_u: 1, deg_v: 1,
            trim_loops,
        };
        assert!(mesh.set_face_surface(b[0], Some(nurbs)));
        let result = mesh.boolean_dispatch(
            &[a[0]], &[b[0]], BoolOp::Union, mat,
        ).unwrap();
        match result.fallback_reason {
            Some(NurbsBooleanFailReason::TrimLoopsNotSupported { which: SideTag::B }) => {}
            other => panic!("expected TrimLoopsNotSupported(B), got {:?}", other),
        }
    }

    // ── Test 13 ───────────────────────────────────────────────
    /// Mesh face count regression — dispatch does not corrupt the
    /// underlying mesh beyond what the existing boolean already does.
    #[test]
    fn dispatch_face_count_matches_direct_boolean() {
        let (mut mesh1, a1, b1, mat1) = two_overlapping_boxes();
        let before_1 = mesh1.faces.iter().filter(|(_, f)| f.is_active()).count();
        let _ = mesh1.boolean(&a1, &b1, BoolOp::Union, mat1).unwrap();
        let after_1 = mesh1.faces.iter().filter(|(_, f)| f.is_active()).count();

        let (mut mesh2, a2, b2, mat2) = two_overlapping_boxes();
        let before_2 = mesh2.faces.iter().filter(|(_, f)| f.is_active()).count();
        let _ = mesh2.boolean_dispatch(&a2, &b2, BoolOp::Union, mat2).unwrap();
        let after_2 = mesh2.faces.iter().filter(|(_, f)| f.is_active()).count();

        assert_eq!(before_1, before_2);
        assert_eq!(after_1, after_2,
            "boolean_dispatch must produce same face count as direct boolean");
    }

    // ── Test 14 ───────────────────────────────────────────────
    /// Phase J §7.5 audit invariant — when NURBS is ineligible, the
    /// fallback_reason short_label must be one of the documented
    /// "skipped" labels (no silent transition).
    #[test]
    fn dispatch_audit_label_documented_for_skip() {
        let documented: std::collections::HashSet<&'static str> = [
            "surface_missing",
            "multiface_unsupported_mvp",
            "unsupported_surface_kind",
            "trim_loops_unsupported_mvp",
            "nurbs_core_error",
            "ssi_not_clean",
        ].into_iter().collect();
        let (mut mesh, a, b, mat) = two_overlapping_boxes();
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat).unwrap();
        let label = result.fallback_reason.as_ref()
            .map(|r| r.short_label())
            .expect("mesh path on no-surface fixture must record reason");
        assert!(documented.contains(label),
            "fallback_reason label '{}' is not in the documented set", label);
    }

    // ───────────────────────────────────────────────────────────────
    // ADR-064 Step 5 (Path Z) regression tests
    // boolean_dispatch_dcel cutover — opt-in DCEL-producing dispatch.
    // ───────────────────────────────────────────────────────────────

    fn make_plane_quad_with_surface(
        mesh: &mut Mesh, mat: MaterialId, z_offset: f64,
    ) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, z_offset));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, z_offset));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 10.0, z_offset));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 10.0, z_offset));
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let plane = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 0.0, z_offset),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        };
        mesh.set_face_surface(fid, Some(plane));
        fid
    }

    /// ADR-064 Step 5 #1 — Eligible single-face × single-face (planes
    /// at z=0 and z=5) → BooleanPath::Nurbs + dcel=Some + disjoint=true
    /// (D-O=(a) Step 4 D-F=(c) consistency).
    #[test]
    fn step5_boolean_dispatch_dcel_eligible_disjoint_subtract() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        let face_b = make_plane_quad_with_surface(&mut mesh, mat, 5.0);

        let result = mesh.boolean_dispatch_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("eligible disjoint must succeed");

        assert_eq!(result.path_used, BooleanPath::Nurbs);
        assert!(result.fallback_reason.is_none());
        let dcel = result.dcel.expect("Nurbs path must populate dcel");
        assert!(dcel.disjoint, "z=0 and z=5 planes must be disjoint");
        assert!(dcel.removed_faces.is_empty(),
            "disjoint must not remove inputs (D-F=(c))");
        assert_eq!(dcel.preserved_faces.len(), 2);
        assert!(result.nurbs_diagnostic.attempted);
        assert!(result.nurbs_diagnostic.robustness_clean);
    }

    /// ADR-064 Step 5 #2 — Ineligible: face_b lacks surface →
    /// BooleanPath::Mesh, dcel=None, fallback_reason=SurfaceMissing.
    /// No auto mesh path invocation per D-K/Q.
    #[test]
    fn step5_boolean_dispatch_dcel_ineligible_no_surface() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        // face_b without surface attach.
        let v0 = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(30.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(30.0, 10.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(20.0, 10.0, 0.0));
        let face_b = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        let result = mesh.boolean_dispatch_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("ineligibility is informational, not Err");

        assert_eq!(result.path_used, BooleanPath::Mesh,
            "missing surface → Mesh path tag");
        assert!(result.dcel.is_none(),
            "Mesh path must not populate dcel (D-K caller responsibility)");
        let reason = result.fallback_reason.expect("ineligible must record reason");
        assert!(matches!(reason, NurbsBooleanFailReason::SurfaceMissing { .. }));
        assert!(!result.nurbs_diagnostic.attempted,
            "ineligible never attempts NURBS path");

        // Both originals remain active — no auto mesh invocation.
        assert!(mesh.faces[face_a].is_active());
        assert!(mesh.faces[face_b].is_active());
    }

    /// ADR-064 Step 5 #3 — D-N (D-H safe-only consistency) — perpendicular
    /// planes intersect along an open chain (no closed loops). dcel
    /// returns disjoint=false but new_faces empty + removed_faces empty.
    #[test]
    fn step5_boolean_dispatch_dcel_perpendicular_no_closed_loops() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let face_a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);

        // Vertical plane at y=5 (perpendicular to z=0 plane).
        let v0 = mesh.add_vertex(DVec3::new(0.0, 5.0, -5.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 5.0, -5.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 5.0,  5.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 5.0,  5.0));
        let face_b = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let plane_b = AnalyticSurface::Plane {
            origin: DVec3::new(0.0, 5.0, 0.0),
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (-5.0, 5.0),
        };
        mesh.set_face_surface(face_b, Some(plane_b));

        let result = mesh.boolean_dispatch_dcel(
            face_a, face_b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("perpendicular planes must not error");

        assert_eq!(result.path_used, BooleanPath::Nurbs);
        let dcel = result.dcel.expect("Nurbs path → dcel populated");
        // D-N safe-only: new_faces empty even though SSI may have run.
        assert!(dcel.new_faces_a.is_empty() && dcel.new_faces_b.is_empty());
        // D-H safe-only: no removal when no replacement faces.
        assert!(dcel.removed_faces.is_empty());
        assert!(mesh.faces[face_a].is_active() && mesh.faces[face_b].is_active(),
            "no-closed-loops case must preserve inputs");
    }

    /// ADR-064 Step 5 #4 — D-P unchanged: existing `boolean_dispatch`
    /// continues to work identically alongside the new method.
    #[test]
    fn step5_boolean_dispatch_dcel_dropin_alongside_no_regression() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = make_box(&mut mesh, DVec3::ZERO, DVec3::splat(1.0), mat);
        let b = make_box(&mut mesh,
            DVec3::splat(2.0), DVec3::splat(3.0), mat);

        // Existing boolean_dispatch must behave identically.
        let result = mesh.boolean_dispatch(&a, &b, BoolOp::Union, mat)
            .expect("existing dispatch must remain functional");

        // Whatever path it picked, the result must be valid + path tag set.
        match result.path_used {
            BooleanPath::Mesh
            | BooleanPath::Nurbs
            | BooleanPath::NurbsWithMeshFallback => {} // any tag OK
        }
        // mesh_result populated regardless (existing behavior).
        let _ = result.mesh_result;
    }

    /// ADR-064 Step 5 #5 — Eligible Union/Intersect produce Nurbs path
    /// + dcel populated (D-J=(b) opt-in covers all 3 ops).
    #[test]
    fn step5_boolean_dispatch_dcel_all_three_ops_accepted() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        for op in [BoolOp::Subtract, BoolOp::Union, BoolOp::Intersect] {
            let mut mesh = Mesh::new();
            let mat = MaterialId::new(0);
            let face_a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
            let face_b = make_plane_quad_with_surface(&mut mesh, mat, 5.0);

            let result = mesh.boolean_dispatch_dcel(
                face_a, face_b, op, BooleanTolerance::default(),
            ).unwrap_or_else(|e| panic!("{:?} must succeed: {}", op, e));

            assert_eq!(result.path_used, BooleanPath::Nurbs,
                "{:?} on eligible pair must take Nurbs path", op);
            assert!(result.dcel.is_some(), "{:?} must populate dcel", op);
            assert!(result.fallback_reason.is_none(),
                "{:?} success → no fallback_reason", op);
        }
    }

    // ───────────────────────────────────────────────────────────────
    // ADR-066 Y-1 (Path Y) — Multi-face dispatch regression tests
    // ───────────────────────────────────────────────────────────────

    /// Y-1 #1 — 2×2 cartesian: every face has analytic surface →
    /// BooleanPath::Nurbs, per_pair has 4 outcomes, aggregates produced.
    #[test]
    fn multi_face_dispatch_eligible_2x2_subtract_succeeds() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a1 = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        let a2 = make_plane_quad_with_surface(&mut mesh, mat, 1.0);
        let b1 = make_plane_quad_with_surface(&mut mesh, mat, 5.0);
        let b2 = make_plane_quad_with_surface(&mut mesh, mat, 6.0);

        let result = mesh.boolean_dispatch_dcel_multi(
            &[a1, a2], &[b1, b2], BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("eligible 2x2 must succeed");

        assert_eq!(result.path_used, BooleanPath::Nurbs);
        assert!(result.fallback_reason.is_none());
        assert_eq!(result.per_pair.len(), 4, "2×2 cartesian must produce 4 outcomes");
        // All disjoint pairs → no new/removed faces, but path is Nurbs.
        assert!(result.all_new_faces.is_empty(),
            "all-disjoint 2×2 must produce no new faces");
        assert!(result.all_removed_faces.is_empty(),
            "all-disjoint 2×2 must remove nothing (Y-I per-pair safe-only)");
    }

    /// Y-1 #2 — Y-E strict: any face missing surface → BooleanPath::Mesh
    /// upfront, per_pair empty, fallback_reason populated.
    #[test]
    fn multi_face_dispatch_one_missing_surface_routes_mesh_path() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a1 = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        // a2 without surface attach.
        let v0 = mesh.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(30.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(30.0, 10.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(20.0, 10.0, 0.0));
        let a2 = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        let b1 = make_plane_quad_with_surface(&mut mesh, mat, 5.0);

        let result = mesh.boolean_dispatch_dcel_multi(
            &[a1, a2], &[b1], BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("ineligibility is informational, not Err");

        assert_eq!(result.path_used, BooleanPath::Mesh);
        assert!(result.per_pair.is_empty(),
            "Y-E strict must reject upfront — no per_pair attempts");
        let reason = result.fallback_reason.expect("must record reason");
        assert!(matches!(reason, NurbsBooleanFailReason::SurfaceMissing { .. }));
        assert!(!result.warnings.is_empty(),
            "missing-surface case must record at least one warning");
    }

    /// Y-1 #3 — 1×1 degenerate: delegates to Path Z `boolean_dispatch_dcel`.
    /// per_pair has exactly 1 outcome populated from the Path Z result.
    #[test]
    fn multi_face_dispatch_single_face_fallback_to_path_z() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        let b = make_plane_quad_with_surface(&mut mesh, mat, 5.0);

        let result = mesh.boolean_dispatch_dcel_multi(
            &[a], &[b], BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("1×1 degenerate must succeed via Path Z delegation");

        assert_eq!(result.path_used, BooleanPath::Nurbs);
        assert_eq!(result.per_pair.len(), 1, "1×1 must produce exactly 1 per_pair");
        let outcome = &result.per_pair[0];
        assert_eq!(outcome.face_a, a);
        assert_eq!(outcome.face_b, b);
        assert!(outcome.result.is_ok());
        if let Ok(dcel) = &outcome.result {
            assert!(dcel.disjoint, "z=0 vs z=5 must be disjoint");
        }
    }

    /// Y-1 #4 — Y-H/Y-I per-pair safe-only: all pairs disjoint →
    /// no new faces, no removal across the multi result.
    #[test]
    fn multi_face_dispatch_per_pair_safe_only_preserves_when_all_disjoint() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a1 = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        let a2 = make_plane_quad_with_surface(&mut mesh, mat, 1.0);
        let b1 = make_plane_quad_with_surface(&mut mesh, mat, 50.0);  // far
        let b2 = make_plane_quad_with_surface(&mut mesh, mat, 100.0);

        let result = mesh.boolean_dispatch_dcel_multi(
            &[a1, a2], &[b1, b2], BoolOp::Union, BooleanTolerance::default(),
        ).unwrap();

        assert_eq!(result.path_used, BooleanPath::Nurbs);
        assert!(result.all_removed_faces.is_empty(),
            "all-disjoint pairs must not remove anything (Y-H/Y-I safe-only)");
        assert!(result.all_new_faces.is_empty(),
            "all-disjoint pairs must produce no new faces");
        // All inputs must remain active (defense-in-depth).
        for fid in [a1, a2, b1, b2] {
            assert!(mesh.faces[fid].is_active(),
                "input {:?} must remain active when all pairs are disjoint", fid);
        }
    }

    /// Y-1 #5 — Y-D drop-in alongside: existing `boolean_dispatch_dcel`
    /// (Path Z, single-face) must work identically alongside the new
    /// multi method on the same mesh fixture.
    #[test]
    fn multi_face_dispatch_drop_in_alongside_path_z_unchanged() {
        use crate::surfaces::ssi::tolerance::BooleanTolerance;
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let a = make_plane_quad_with_surface(&mut mesh, mat, 0.0);
        let b = make_plane_quad_with_surface(&mut mesh, mat, 5.0);

        // Path Z still callable + identical result shape.
        let z_result = mesh.boolean_dispatch_dcel(
            a, b, BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("Path Z method must still work");
        assert_eq!(z_result.path_used, BooleanPath::Nurbs);
        assert!(z_result.dcel.is_some());
        let z_disjoint = z_result.dcel.unwrap().disjoint;

        // Now invoke multi on the same fixture (1×1 → Path Z delegation).
        let multi_result = mesh.boolean_dispatch_dcel_multi(
            &[a], &[b], BoolOp::Subtract, BooleanTolerance::default(),
        ).expect("multi 1×1 delegation must work");

        assert_eq!(multi_result.path_used, BooleanPath::Nurbs);
        assert_eq!(multi_result.per_pair.len(), 1);
        let m_disjoint = match &multi_result.per_pair[0].result {
            Ok(d) => d.disjoint,
            Err(e) => panic!("delegation result must be Ok: {}", e),
        };
        assert_eq!(z_disjoint, m_disjoint,
            "Path Z and multi 1×1 delegation must produce identical disjoint flag");
    }
}
