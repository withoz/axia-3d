//! ADR-060 Phase O Step 6 — JSON serializers (pure helpers).
//!
//! Extracted out of the `#[wasm_bindgen]` methods so unit tests can
//! exercise them without going through wasm-bindgen marshalling
//! (which panics in `cargo test` because the crate uses `js-sys`).
//!
//! All public items here are `pub(crate)` and consumed by `lib.rs`.

use axia_geo::mesh::SurfaceAttachOutcome;
use axia_geo::operations::boolean_dispatch::{
    BooleanDispatchDcelMultiResult, BooleanDispatchDcelResult,
    BooleanDispatchResult, BooleanPath, NurbsBooleanFailReason,
};
use axia_geo::operations::fillet_dispatch::{
    FilletDispatchResult, FilletDispatchSkipReason, FilletPath,
};
use axia_geo::surfaces::AnalyticSurface;
use axia_geo::{AnalyticCurve, EdgeId, FaceId, mesh::Mesh, mesh_migration::MigrationReport};

/// `getEdgeCurveJson` body — returns `"null"` if edge missing/inactive
/// or has no curve attached. Otherwise `{"schemaVersion":1,...}`.
pub(crate) fn edge_curve_json(mesh: &Mesh, edge_id: EdgeId) -> String {
    let edge = match mesh.edges.get(edge_id) {
        Some(e) if e.is_active() => e,
        _ => return "null".to_string(),
    };
    let curve = match edge.curve() {
        Some(c) => c,
        None => return "null".to_string(),
    };
    let vpos = |vid: axia_geo::VertId| -> [f64; 3] {
        mesh.verts.get(vid)
            .map(|v| { let p = v.pos(); [p.x, p.y, p.z] })
            .unwrap_or([0.0, 0.0, 0.0])
    };
    let body = match curve {
        AnalyticCurve::Line { start, end } => {
            let s = vpos(*start); let e = vpos(*end);
            format!(
                r#""kind":"Line","start":[{},{},{}],"end":[{},{},{}]"#,
                s[0], s[1], s[2], e[0], e[1], e[2],
            )
        }
        AnalyticCurve::Circle { center, radius, normal, basis_u } => format!(
            r#""kind":"Circle","center":[{},{},{}],"radius":{},"normal":[{},{},{}],"basisU":[{},{},{}]"#,
            center.x, center.y, center.z, radius,
            normal.x, normal.y, normal.z,
            basis_u.x, basis_u.y, basis_u.z,
        ),
        AnalyticCurve::Arc { center, radius, normal, basis_u, start_angle, end_angle } => format!(
            r#""kind":"Arc","center":[{},{},{}],"radius":{},"normal":[{},{},{}],"basisU":[{},{},{}],"startAngle":{},"endAngle":{}"#,
            center.x, center.y, center.z, radius,
            normal.x, normal.y, normal.z,
            basis_u.x, basis_u.y, basis_u.z,
            start_angle, end_angle,
        ),
        AnalyticCurve::Bezier { control_pts } => {
            let pts: Vec<String> = control_pts.iter()
                .map(|p| format!("[{},{},{}]", p.x, p.y, p.z))
                .collect();
            format!(r#""kind":"Bezier","controlPts":[{}]"#, pts.join(","))
        }
        AnalyticCurve::BSpline { control_pts, knots, degree } => {
            let pts: Vec<String> = control_pts.iter()
                .map(|p| format!("[{},{},{}]", p.x, p.y, p.z))
                .collect();
            let ks: Vec<String> = knots.iter().map(|k| k.to_string()).collect();
            format!(
                r#""kind":"BSpline","controlPts":[{}],"knots":[{}],"degree":{}"#,
                pts.join(","), ks.join(","), degree,
            )
        }
        AnalyticCurve::NURBS { control_pts, weights, knots, degree } => {
            let pts: Vec<String> = control_pts.iter()
                .map(|p| format!("[{},{},{}]", p.x, p.y, p.z))
                .collect();
            let ws: Vec<String> = weights.iter().map(|w| w.to_string()).collect();
            let ks: Vec<String> = knots.iter().map(|k| k.to_string()).collect();
            format!(
                r#""kind":"NURBS","controlPts":[{}],"weights":[{}],"knots":[{}],"degree":{}"#,
                pts.join(","), ws.join(","), ks.join(","), degree,
            )
        }
    };
    format!(r#"{{"schemaVersion":1,{}}}"#, body)
}

/// `getFaceSurfaceJson` body — `"null"` for missing/inactive/no-surface,
/// otherwise `{"schemaVersion":1,...}`.
pub(crate) fn face_surface_json(mesh: &Mesh, face_id: FaceId) -> String {
    let face = match mesh.faces.get(face_id) {
        Some(f) if f.is_active() => f,
        _ => return "null".to_string(),
    };
    let surface = match face.surface() {
        Some(s) => s,
        None => return "null".to_string(),
    };
    let body = match surface {
        AnalyticSurface::Plane { origin, normal, basis_u, u_range, v_range } => format!(
            r#""kind":"Plane","origin":[{},{},{}],"normal":[{},{},{}],"basisU":[{},{},{}],"uRange":[{},{}],"vRange":[{},{}]"#,
            origin.x, origin.y, origin.z,
            normal.x, normal.y, normal.z,
            basis_u.x, basis_u.y, basis_u.z,
            u_range.0, u_range.1, v_range.0, v_range.1,
        ),
        AnalyticSurface::Cylinder { axis_origin, axis_dir, radius, ref_dir, u_range, v_range } => format!(
            r#""kind":"Cylinder","axisOrigin":[{},{},{}],"axisDir":[{},{},{}],"radius":{},"refDir":[{},{},{}],"uRange":[{},{}],"vRange":[{},{}]"#,
            axis_origin.x, axis_origin.y, axis_origin.z,
            axis_dir.x, axis_dir.y, axis_dir.z, radius,
            ref_dir.x, ref_dir.y, ref_dir.z,
            u_range.0, u_range.1, v_range.0, v_range.1,
        ),
        AnalyticSurface::Sphere { center, radius, u_range, v_range } => format!(
            r#""kind":"Sphere","center":[{},{},{}],"radius":{},"uRange":[{},{}],"vRange":[{},{}]"#,
            center.x, center.y, center.z, radius,
            u_range.0, u_range.1, v_range.0, v_range.1,
        ),
        AnalyticSurface::Cone { apex, axis_dir, half_angle, ref_dir, u_range, v_range } => format!(
            r#""kind":"Cone","apex":[{},{},{}],"axisDir":[{},{},{}],"halfAngle":{},"refDir":[{},{},{}],"uRange":[{},{}],"vRange":[{},{}]"#,
            apex.x, apex.y, apex.z,
            axis_dir.x, axis_dir.y, axis_dir.z, half_angle,
            ref_dir.x, ref_dir.y, ref_dir.z,
            u_range.0, u_range.1, v_range.0, v_range.1,
        ),
        AnalyticSurface::Torus { center, axis_dir, ref_dir, major_radius, minor_radius, u_range, v_range } => format!(
            r#""kind":"Torus","center":[{},{},{}],"axisDir":[{},{},{}],"refDir":[{},{},{}],"majorRadius":{},"minorRadius":{},"uRange":[{},{}],"vRange":[{},{}]"#,
            center.x, center.y, center.z,
            axis_dir.x, axis_dir.y, axis_dir.z,
            ref_dir.x, ref_dir.y, ref_dir.z,
            major_radius, minor_radius,
            u_range.0, u_range.1, v_range.0, v_range.1,
        ),
        AnalyticSurface::BezierPatch { ctrl_grid } => {
            let n_u = ctrl_grid.len();
            let n_v = ctrl_grid.first().map(|r| r.len()).unwrap_or(0);
            format!(r#""kind":"BezierPatch","nU":{},"nV":{}"#, n_u, n_v)
        }
        AnalyticSurface::BSplineSurface { ctrl_grid, deg_u, deg_v, .. } => {
            let n_u = ctrl_grid.len();
            let n_v = ctrl_grid.first().map(|r| r.len()).unwrap_or(0);
            format!(
                r#""kind":"BSplineSurface","nU":{},"nV":{},"degU":{},"degV":{}"#,
                n_u, n_v, deg_u, deg_v,
            )
        }
        AnalyticSurface::NURBSSurface { ctrl_grid, deg_u, deg_v, trim_loops, .. } => {
            let n_u = ctrl_grid.len();
            let n_v = ctrl_grid.first().map(|r| r.len()).unwrap_or(0);
            format!(
                r#""kind":"NURBSSurface","nU":{},"nV":{},"degU":{},"degV":{},"trimLoopCount":{}"#,
                n_u, n_v, deg_u, deg_v, trim_loops.len(),
            )
        }
    };
    format!(r#"{{"schemaVersion":1,{}}}"#, body)
}

pub(crate) fn migration_report_json(report: &MigrationReport) -> String {
    format!(
        r#"{{"schemaVersion":1,"ok":true,"edgesPromotedWithCurve":{},"edgesSynthesizedAsLine":{},"edgesDemotedDueToDrift":{},"facesPromotedWithSurface":{},"facesSynthesizedAsPlane":{},"facesDemotedDueToDrift":{},"isClean":{}}}"#,
        report.edges_promoted_with_curve,
        report.edges_synthesized_as_line,
        report.edges_demoted_due_to_drift,
        report.faces_promoted_with_surface,
        report.faces_synthesized_as_plane,
        report.faces_demoted_due_to_drift,
        report.is_clean(),
    )
}

pub(crate) fn boolean_dispatch_result_json(result: &BooleanDispatchResult) -> String {
    let path_str = match result.path_used {
        BooleanPath::Mesh => "Mesh",
        BooleanPath::Nurbs => "Nurbs",
        BooleanPath::NurbsWithMeshFallback => "NurbsWithMeshFallback",
    };
    let fallback_json = match &result.fallback_reason {
        None => "null".to_string(),
        Some(r) => {
            let kind = match r {
                NurbsBooleanFailReason::SurfaceMissing { .. } => "SurfaceMissing",
                NurbsBooleanFailReason::MultipleFacesNotSupported { .. } => "MultipleFacesNotSupported",
                NurbsBooleanFailReason::UnsupportedSurfaceKind { .. } => "UnsupportedSurfaceKind",
                NurbsBooleanFailReason::TrimLoopsNotSupported { .. } => "TrimLoopsNotSupported",
                NurbsBooleanFailReason::NurbsCoreError(_) => "NurbsCoreError",
                NurbsBooleanFailReason::SsiNotClean { .. } => "SsiNotClean",
            };
            format!(r#"{{"kind":"{}","label":"{}"}}"#, kind, r.short_label())
        }
    };
    format!(
        r#"{{"schemaVersion":1,"ok":true,"pathUsed":"{}","fallbackReason":{},"nurbsAttempted":{},"nurbsClean":{},"faceCount":{}}}"#,
        path_str,
        fallback_json,
        result.nurbs_diagnostic.attempted,
        result.nurbs_diagnostic.robustness_clean,
        result.mesh_result.faces.len(),
    )
}

/// ADR-064 Step 6-α — Serialize `BooleanDispatchDcelResult` to JSON.
///
/// Schema (D-U=(c) — face IDs included for selection / undo tracking):
/// ```json
/// {
///   "schemaVersion": 1, "ok": true,
///   "pathUsed": "Mesh"|"Nurbs"|"NurbsWithMeshFallback",
///   "fallbackReason": { "kind": "...", "label": "..." } | null,
///   "dcel": {
///     "newFacesA": [u32, ...],
///     "newFacesB": [u32, ...],
///     "removedFaces": [u32, ...],
///     "preservedFaces": [u32, ...],
///     "disjoint": bool,
///     "robustnessClean": bool
///   } | null,
///   "nurbsAttempted": bool,
///   "nurbsClean": bool,
///   "intersectionChainCount": u32
/// }
/// ```
///
/// `dcel` is null when `pathUsed == "Mesh"` (eligibility rejected,
/// no DCEL produced — caller responsibility per D-K).
pub(crate) fn boolean_dispatch_dcel_result_json(
    result: &BooleanDispatchDcelResult,
) -> String {
    let path_str = match result.path_used {
        BooleanPath::Mesh => "Mesh",
        BooleanPath::Nurbs => "Nurbs",
        BooleanPath::NurbsWithMeshFallback => "NurbsWithMeshFallback",
    };
    let fallback_json = match &result.fallback_reason {
        None => "null".to_string(),
        Some(r) => {
            let kind = match r {
                NurbsBooleanFailReason::SurfaceMissing { .. } => "SurfaceMissing",
                NurbsBooleanFailReason::MultipleFacesNotSupported { .. } => "MultipleFacesNotSupported",
                NurbsBooleanFailReason::UnsupportedSurfaceKind { .. } => "UnsupportedSurfaceKind",
                NurbsBooleanFailReason::TrimLoopsNotSupported { .. } => "TrimLoopsNotSupported",
                NurbsBooleanFailReason::NurbsCoreError(_) => "NurbsCoreError",
                NurbsBooleanFailReason::SsiNotClean { .. } => "SsiNotClean",
            };
            format!(r#"{{"kind":"{}","label":"{}"}}"#, kind, r.short_label())
        }
    };
    let dcel_json = match &result.dcel {
        None => "null".to_string(),
        Some(d) => {
            let join_ids = |ids: &[FaceId]| -> String {
                ids.iter()
                    .map(|f| f.raw().to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            };
            format!(
                r#"{{"newFacesA":[{}],"newFacesB":[{}],"removedFaces":[{}],"preservedFaces":[{}],"disjoint":{},"robustnessClean":{}}}"#,
                join_ids(&d.new_faces_a),
                join_ids(&d.new_faces_b),
                join_ids(&d.removed_faces),
                join_ids(&d.preserved_faces),
                d.disjoint,
                d.robustness.is_clean(),
            )
        }
    };
    format!(
        r#"{{"schemaVersion":1,"ok":true,"pathUsed":"{}","fallbackReason":{},"dcel":{},"nurbsAttempted":{},"nurbsClean":{},"intersectionChainCount":{}}}"#,
        path_str,
        fallback_json,
        dcel_json,
        result.nurbs_diagnostic.attempted,
        result.nurbs_diagnostic.robustness_clean,
        result.nurbs_diagnostic.intersection_chain_count,
    )
}

/// ADR-066 Y-2 — Serialize `BooleanDispatchDcelMultiResult` to JSON.
///
/// Schema (Y-2-c full per-pair, Y-2-j discriminated `kind`):
/// ```json
/// {
///   "schemaVersion": 1, "ok": true,
///   "pathUsed": "Nurbs"|"Mesh",
///   "fallbackReason": { "kind": "...", "label": "..." } | null,
///   "perPair": [
///     { "faceA": u32, "faceB": u32,
///       "outcome": { "kind": "ok", "dcel": {...} }
///                 | { "kind": "err", "detail": "..." } },
///     ...
///   ],
///   "allNewFaces": [u32, ...],
///   "allRemovedFaces": [u32, ...],
///   "warnings": [string, ...]
/// }
/// ```
///
/// `pathUsed === "Mesh"` ⇒ `perPair` / `allNewFaces` / `allRemovedFaces`
/// all empty arrays (Y-E strict eligibility rejected upfront).
pub(crate) fn boolean_dispatch_dcel_multi_result_json(
    result: &BooleanDispatchDcelMultiResult,
) -> String {
    let path_str = match result.path_used {
        BooleanPath::Mesh => "Mesh",
        BooleanPath::Nurbs => "Nurbs",
        BooleanPath::NurbsWithMeshFallback => "NurbsWithMeshFallback",
    };
    let fallback_json = match &result.fallback_reason {
        None => "null".to_string(),
        Some(r) => {
            let kind = match r {
                NurbsBooleanFailReason::SurfaceMissing { .. } => "SurfaceMissing",
                NurbsBooleanFailReason::MultipleFacesNotSupported { .. } => "MultipleFacesNotSupported",
                NurbsBooleanFailReason::UnsupportedSurfaceKind { .. } => "UnsupportedSurfaceKind",
                NurbsBooleanFailReason::TrimLoopsNotSupported { .. } => "TrimLoopsNotSupported",
                NurbsBooleanFailReason::NurbsCoreError(_) => "NurbsCoreError",
                NurbsBooleanFailReason::SsiNotClean { .. } => "SsiNotClean",
            };
            format!(r#"{{"kind":"{}","label":"{}"}}"#, kind, r.short_label())
        }
    };

    let join_ids = |ids: &[FaceId]| -> String {
        ids.iter()
            .map(|f| f.raw().to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    let escape = |s: &str| -> String {
        // Minimal JSON string escape (quotes + backslash + control).
        let mut out = String::with_capacity(s.len());
        for c in s.chars() {
            match c {
                '"'  => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                c => out.push(c),
            }
        }
        out
    };

    // Build perPair array.
    let per_pair_items: Vec<String> = result.per_pair.iter().map(|p| {
        let outcome = match &p.result {
            Ok(d) => format!(
                r#"{{"kind":"ok","dcel":{{"newFacesA":[{}],"newFacesB":[{}],"removedFaces":[{}],"preservedFaces":[{}],"disjoint":{},"robustnessClean":{}}}}}"#,
                join_ids(&d.new_faces_a),
                join_ids(&d.new_faces_b),
                join_ids(&d.removed_faces),
                join_ids(&d.preserved_faces),
                d.disjoint,
                d.robustness.is_clean(),
            ),
            Err(detail) => format!(
                r#"{{"kind":"err","detail":"{}"}}"#,
                escape(detail),
            ),
        };
        format!(
            r#"{{"faceA":{},"faceB":{},"outcome":{}}}"#,
            p.face_a.raw(), p.face_b.raw(), outcome,
        )
    }).collect();
    let per_pair_json = format!("[{}]", per_pair_items.join(","));

    // Build warnings array.
    let warning_items: Vec<String> = result.warnings.iter()
        .map(|w| format!(r#""{}""#, escape(w)))
        .collect();
    let warnings_json = format!("[{}]", warning_items.join(","));

    format!(
        r#"{{"schemaVersion":1,"ok":true,"pathUsed":"{}","fallbackReason":{},"perPair":{},"allNewFaces":[{}],"allRemovedFaces":[{}],"warnings":{}}}"#,
        path_str,
        fallback_json,
        per_pair_json,
        join_ids(&result.all_new_faces),
        join_ids(&result.all_removed_faces),
        warnings_json,
    )
}

pub(crate) fn fillet_dispatch_result_json(result: &FilletDispatchResult) -> String {
    let path_str = match result.path_used {
        FilletPath::Mesh => "Mesh",
        FilletPath::BRep => "BRep",
        FilletPath::BRepWithMeshFallback => "BRepWithMeshFallback",
    };
    let skip_json = match &result.skip_reason {
        None => "null".to_string(),
        Some(r) => {
            let kind = match r {
                FilletDispatchSkipReason::EdgeCurveMissing => "EdgeCurveMissing",
                FilletDispatchSkipReason::EdgeCurveNonLinear { .. } => "EdgeCurveNonLinear",
                FilletDispatchSkipReason::FaceSurfaceMissing { .. } => "FaceSurfaceMissing",
                FilletDispatchSkipReason::NonPlanarFace { .. } => "NonPlanarFace",
                FilletDispatchSkipReason::NonManifoldEdge { .. } => "NonManifoldEdge",
                FilletDispatchSkipReason::Underlying(_) => "Underlying",
            };
            format!(r#"{{"kind":"{}","label":"{}"}}"#, kind, r.short_label())
        }
    };
    let surface_kind = match &result.created_surface {
        None => "null".to_string(),
        Some(_) => r#""Cylinder""#.to_string(),
    };
    let strip_count = result.mesh_result
        .as_ref()
        .map(|mr| mr.fillet_faces.len())
        .unwrap_or(0);
    format!(
        r#"{{"schemaVersion":1,"ok":true,"pathUsed":"{}","skipReason":{},"createdSurfaceKind":{},"filletStripFaceCount":{}}}"#,
        path_str, skip_json, surface_kind, strip_count,
    )
}

/// ADR-062 Phase L₂ Path Z Step 3 — Serialize SurfaceAttachOutcome
/// to JSON per Amendment 1 schema (discriminated via `outcome` key).
///
/// All variants share `schemaVersion: 1` + `ok: true` + `outcome: "..."`.
/// Variant-specific fields are emitted only for relevant outcomes:
///   - Attached: `previousKind` (string | null)
///   - BoundaryDriftExceedsTol: `maxDriftMm`, `tolMm`, `worstVertexIdx`
///   - UnsupportedSurfaceKind: `unsupportedKind`
///   - DegenerateSurfaceInput: `reason`
///   - NoOuterLoop / InactiveFace: outcome key alone
pub(crate) fn surface_attach_outcome_json(outcome: &SurfaceAttachOutcome) -> String {
    let label = outcome.label();
    let extras: String = match outcome {
        SurfaceAttachOutcome::Attached { previous_kind } => {
            let prev = match previous_kind {
                Some(k) => format!(r#""{}""#, k),
                None => "null".to_string(),
            };
            format!(r#","previousKind":{}"#, prev)
        }
        SurfaceAttachOutcome::BoundaryDriftExceedsTol {
            max_drift_mm, tol_mm, worst_vertex_idx,
        } => format!(
            r#","maxDriftMm":{},"tolMm":{},"worstVertexIdx":{}"#,
            max_drift_mm, tol_mm, worst_vertex_idx,
        ),
        SurfaceAttachOutcome::UnsupportedSurfaceKind { kind } => {
            format!(r#","unsupportedKind":"{}""#, kind)
        }
        SurfaceAttachOutcome::DegenerateSurfaceInput { reason } => {
            // reason is a static string from degeneracy_reason() — no JSON-unsafe chars expected.
            format!(r#","reason":"{}""#, reason)
        }
        SurfaceAttachOutcome::NoOuterLoop | SurfaceAttachOutcome::InactiveFace => String::new(),
    };
    format!(
        r#"{{"schemaVersion":1,"ok":true,"outcome":"{}"{}}}"#,
        label, extras,
    )
}
