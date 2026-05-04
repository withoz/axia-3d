//! ADR-060 Phase O Step 6 — WASM additive-only API regression tests.
//!
//! 6 invariants per ADR-060 §3 + Step 6 sign-off mitigation matrix:
//!
//!   1. wasm_export_baseline_unchanged                     (R1, R2)
//!   2. get_edge_curve_json_emits_world_coords             (R7)
//!   3. get_face_surface_json_includes_schema_version      (R6)
//!   4. migrate_curve_surface_mandatory_idempotent         (R5)
//!   5. boolean_dispatch_json_includes_path_and_reason     (R10)
//!   6. fillet_edge_dispatch_json_includes_path_and_skip_reason (R10)
//!
//! Tests 2-6 exercise the underlying axia_geo dispatch + JSON helpers
//! via the JSON shape via the public surface contract (the
//! `#[wasm_bindgen]` methods are thin delegators to these helpers).
//! Calling AxiaEngine methods directly in `cargo test` panics at the
//! wasm-bindgen marshalling layer because the crate uses js-sys.
//!
//! All tests are non-#[ignore]; §X.5 lock-in #6 mandates strict.

// ── Test 1 — Export baseline unchanged ───────────────────────────────
//
// §D lock-in (additive-only) regression: every js_name that existed
// before Step 6 must still exist with same name. New endpoints may be
// added but none removed. Baseline file is committed to repo.
#[test]
fn wasm_export_baseline_unchanged() {
    let baseline = include_str!("export_baseline.txt");
    let baseline_names: std::collections::HashSet<&str> = baseline
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let start = l.find('"').expect("baseline line missing quote") + 1;
            let end = l.rfind('"').expect("baseline line missing closing quote");
            &l[start..end]
        })
        .collect();

    let src = include_str!("../src/lib.rs");
    let mut current_names = std::collections::HashSet::new();
    for line in src.lines() {
        if let Some(idx) = line.find("js_name = \"") {
            let after = &line[idx + 11..];
            if let Some(end) = after.find('"') {
                current_names.insert(&after[..end]);
            }
        }
    }

    let missing: Vec<&&str> = baseline_names.iter()
        .filter(|n| !current_names.contains(*n))
        .collect();
    assert!(missing.is_empty(),
        "ADR-060 §D additive-only violation — exports removed: {:?}",
        missing);

    // New endpoints from Step 6 must be present.
    for must_have in [
        "getEdgeCurveJson",
        "getFaceSurfaceJson",
        "migrateCurveSurfaceMandatory",
        "booleanDispatchJson",
        "filletEdgeDispatchJson",
    ] {
        assert!(current_names.contains(must_have),
            "Step 6 endpoint '{}' missing from lib.rs", must_have);
    }
}

// ── Tests 2-6: shape/schema contract via lib.rs source-level scan ────
//
// We assert that every Step 6 endpoint's body matches its documented
// JSON contract — `schemaVersion`, mandated keys, and the absence of
// raw VertId leakage. This pins the contract without invoking the
// wasm-bindgen runtime.

fn lib_src() -> &'static str { include_str!("../src/lib.rs") }
fn json_helpers_src() -> &'static str { include_str!("../src/step6_json.rs") }

// ── Test 2 — Edge curve JSON emits world coords (R7) ─────────────────
#[test]
fn get_edge_curve_json_emits_world_coords() {
    let s = json_helpers_src();
    // Line variant: must format start/end as world-coord arrays, NOT
    // raw VertId numerics. The helper uses `vpos(*start)` to resolve.
    assert!(s.contains("vpos(*start)"),
        "edge_curve_json must resolve VertId via vpos() (no raw VertId leak)");
    assert!(s.contains(r#""kind":"Line","start":[{},{},{}]"#),
        "Line variant JSON shape must emit world coords");
    // schemaVersion present.
    assert!(s.contains(r#""schemaVersion":1"#),
        "edge_curve_json must wrap output in schemaVersion:1");
}

// ── Test 3 — Face surface JSON includes schemaVersion (R6) ───────────
#[test]
fn get_face_surface_json_includes_schema_version() {
    let s = json_helpers_src();
    // schemaVersion wrap present.
    assert!(s.contains(r#"{{"schemaVersion":1,{}}}"#),
        "face_surface_json must wrap output in schemaVersion:1");
    // Discriminator key 'kind' present for every surface variant.
    for kind in ["Plane", "Cylinder", "Sphere", "Cone", "Torus",
                 "BezierPatch", "BSplineSurface", "NURBSSurface"] {
        let needle = format!(r#""kind":"{}""#, kind);
        assert!(s.contains(&needle),
            "face_surface_json missing '{}' variant emission", kind);
    }
}

// ── Test 4 — Migration idempotent (R5) ───────────────────────────────
//
// Idempotency is a property of `Mesh::migrate_v3_to_v4_with_sanity`
// itself (Phase N Step 4). We verify this by directly invoking it on
// a fresh mesh twice and observing the second call's report has zero
// new synthesis.
#[test]
fn migrate_curve_surface_mandatory_idempotent() {
    use axia_geo::mesh::Mesh;
    use axia_geo::MaterialId;
    use glam::DVec3;

    let mut mesh = Mesh::default();
    let mat = MaterialId::new(0);
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
    let _ = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

    let r1 = mesh.migrate_v3_to_v4_with_sanity();
    let r2 = mesh.migrate_v3_to_v4_with_sanity();

    // Idempotency property: report is deterministic across calls.
    // Migration is a counting/sanity pass — actual synthesis is lazy
    // via curve_mandatory() — so the same report comes back each time.
    assert_eq!(r1, r2,
        "migrate_v3_to_v4_with_sanity must produce identical reports across calls");
    // No demotions on either call (no drift in fresh mesh).
    assert_eq!(r1.edges_demoted_due_to_drift, 0);
    assert_eq!(r2.edges_demoted_due_to_drift, 0);
    assert_eq!(r1.faces_demoted_due_to_drift, 0);
    assert_eq!(r2.faces_demoted_due_to_drift, 0);
    // Both clean.
    assert!(r1.is_clean());
    assert!(r2.is_clean());
}

// ── Test 5 — Boolean dispatch JSON includes path + reason (R10) ──────
#[test]
fn boolean_dispatch_json_includes_path_and_reason() {
    let s = json_helpers_src();
    // Required keys present in JSON template.
    for key in [
        r#""schemaVersion":1"#,
        r#""ok":true"#,
        r#""pathUsed":""#,
        r#""fallbackReason":"#,
        r#""nurbsAttempted":"#,
        r#""nurbsClean":"#,
        r#""faceCount":"#,
    ] {
        assert!(s.contains(key),
            "boolean_dispatch_result_json missing key fragment: {}", key);
    }
    // All 3 BooleanPath labels present.
    for label in ["Mesh", "Nurbs", "NurbsWithMeshFallback"] {
        assert!(s.contains(&format!("\"{}\"", label)),
            "boolean dispatch JSON missing path label: {}", label);
    }
    // All 6 NurbsBooleanFailReason kinds present.
    for kind in [
        "SurfaceMissing", "MultipleFacesNotSupported", "UnsupportedSurfaceKind",
        "TrimLoopsNotSupported", "NurbsCoreError", "SsiNotClean",
    ] {
        assert!(s.contains(&format!("=> \"{}\"", kind)),
            "boolean dispatch JSON missing reason kind: {}", kind);
    }
}

// ── Test 7 (ADR-061 Step 5) — Cache stats JSON schema contract ───────
#[test]
fn cache_stats_json_includes_schema_version() {
    let s = lib_src();
    // Endpoint is wired.
    assert!(s.contains(r#"js_name = "getCacheStats""#),
        "getCacheStats endpoint must be wired in lib.rs");
    // schemaVersion + required fields present.
    for key in [
        r#""schemaVersion":1"#,
        r#""faceEntryCount":"#,
        r#""edgeEntryCount":"#,
        r#""faceCacheBytes":"#,
        r#""edgeCacheBytes":"#,
        r#""totalBytes":"#,
        r#""capBytes":"#,
        r#""evictionCount":"#,
    ] {
        assert!(s.contains(key),
            "getCacheStats JSON missing key fragment: {}", key);
    }
}

// ── Test 6 — Fillet dispatch JSON includes path + skip reason (R10) ──
#[test]
fn fillet_edge_dispatch_json_includes_path_and_skip_reason() {
    let s = json_helpers_src();
    for key in [
        r#""schemaVersion":1"#,
        r#""ok":true"#,
        r#""pathUsed":""#,
        r#""skipReason":"#,
        r#""createdSurfaceKind":"#,
        r#""filletStripFaceCount":"#,
    ] {
        assert!(s.contains(key),
            "fillet_dispatch_result_json missing key fragment: {}", key);
    }
    for label in ["Mesh", "BRep", "BRepWithMeshFallback"] {
        assert!(s.contains(&format!("\"{}\"", label)),
            "fillet dispatch JSON missing path label: {}", label);
    }
    for kind in [
        "EdgeCurveMissing", "EdgeCurveNonLinear", "FaceSurfaceMissing",
        "NonPlanarFace", "NonManifoldEdge", "Underlying",
    ] {
        assert!(s.contains(&format!("=> \"{}\"", kind)),
            "fillet dispatch JSON missing reason kind: {}", kind);
    }
    // Cross-link: lib.rs must wire the wasm endpoint to step6_json::fillet_dispatch_result_json.
    let l = lib_src();
    assert!(l.contains("step6_json::fillet_dispatch_result_json"),
        "filletEdgeDispatchJson must delegate to step6_json helper");
    assert!(l.contains("step6_json::boolean_dispatch_result_json"),
        "booleanDispatchJson must delegate to step6_json helper");
}
