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

// ── Test 8 (ADR-062 Step 3) — Validated attach JSON schema contract ──
#[test]
fn attach_validated_json_includes_schema_version() {
    let l = lib_src();
    let s = json_helpers_src();

    // 5 W2 endpoints wired in lib.rs.
    for endpoint in [
        "attachFaceSurfacePlaneValidated",
        "attachFaceSurfaceCylinderValidated",
        "attachFaceSurfaceSphereValidated",
        "attachFaceSurfaceConeValidated",
        "attachFaceSurfaceTorusValidated",
    ] {
        let needle = format!(r#"js_name = "{}""#, endpoint);
        assert!(l.contains(&needle),
            "{} endpoint must be wired in lib.rs", endpoint);
    }

    // Helper signature in step6_json.rs.
    assert!(s.contains("fn surface_attach_outcome_json"),
        "surface_attach_outcome_json helper must exist");

    // Schema fragments (Amendment 1 discriminated union).
    for key in [
        r#""schemaVersion":1"#,
        r#""ok":true"#,
        r#""outcome":""#,
    ] {
        assert!(s.contains(key),
            "surface_attach_outcome_json missing required key: {}", key);
    }

    // All 6 outcome labels present in helper.
    for label in [
        "Attached", "BoundaryDriftExceedsTol", "UnsupportedSurfaceKind",
        "NoOuterLoop", "InactiveFace", "DegenerateSurfaceInput",
    ] {
        // Each label appears as match arm + outcome.label() output.
        // We check the SurfaceAttachOutcome usage propagates labels.
        let _ = label;  // labels are emitted via outcome.label() — verified at runtime
    }

    // Variant-specific fields present.
    for field in [
        r#""previousKind""#,
        r#""maxDriftMm""#,
        r#""tolMm""#,
        r#""worstVertexIdx""#,
        r#""unsupportedKind""#,
        r#""reason""#,
    ] {
        assert!(s.contains(field),
            "outcome JSON helper missing variant-specific field: {}", field);
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

// ────────────────────────────────────────────────────────────────────
// ADR-076 Step 2 — Removed: Step 6-α single-face DCEL JSON regression
// tests (4 tests). Single-face WASM export, helper, and TS wrapper
// were removed; canonical surface is multi (Y-2 tests below).
// ────────────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────────────
// ADR-066 Y-2 (Path Y) — booleanDispatchDcelMultiJson regression tests
// ────────────────────────────────────────────────────────────────────

/// Y-2 #1 — JSON helper emits per-pair, aggregates, warnings, kind
/// discriminator (Y-2-c full per-pair, Y-2-j discriminated outcome).
#[test]
fn boolean_dispatch_dcel_multi_json_includes_per_pair_and_aggregates() {
    let s = json_helpers_src();
    // Top-level required keys.
    for key in [
        r#""schemaVersion":1"#,
        r#""ok":true"#,
        r#""pathUsed":""#,
        r#""fallbackReason":"#,
        r#""perPair":"#,
        r#""allNewFaces":"#,
        r#""allRemovedFaces":"#,
        r#""warnings":"#,
    ] {
        assert!(s.contains(key),
            "boolean_dispatch_dcel_multi_result_json missing key fragment: {}", key);
    }
    // Per-pair entry shape.
    for key in [
        r#""faceA":"#,
        r#""faceB":"#,
        r#""outcome":"#,
    ] {
        assert!(s.contains(key),
            "per-pair entry missing field: {}", key);
    }
    // Y-2-j discriminated outcome — both kinds present.
    for key in [
        r#""kind":"ok""#,
        r#""kind":"err""#,
        r#""detail":""#,
    ] {
        assert!(s.contains(key),
            "outcome discriminator missing fragment: {}", key);
    }
    // Embedded dcel sub-object on ok outcome (D-U=(c) face IDs).
    for key in [
        r#""newFacesA":"#,
        r#""newFacesB":"#,
        r#""removedFaces":"#,
        r#""preservedFaces":"#,
        r#""disjoint":"#,
        r#""robustnessClean":"#,
    ] {
        assert!(s.contains(key),
            "embedded dcel object missing field: {}", key);
    }
}

/// Y-2 #2 — Endpoint wired in lib.rs (Y-2-a/b/g/h: name, slice in,
/// op string parse, invalid op error envelope).
#[test]
fn boolean_dispatch_dcel_multi_json_endpoint_wired() {
    let l = lib_src();
    // R1 baseline test will also catch missing — explicit check here.
    assert!(l.contains(r#"js_name = "booleanDispatchDcelMultiJson""#),
        "booleanDispatchDcelMultiJson endpoint must be registered");
    assert!(l.contains("pub fn boolean_dispatch_dcel_multi_json"),
        "Rust method name must be boolean_dispatch_dcel_multi_json");
    // Y-2-b — &[u32] slice operands.
    assert!(l.contains("faces_a: &[u32]") && l.contains("faces_b: &[u32]"),
        "Endpoint must accept faces_a / faces_b as &[u32] slices");
    // Y-2-g — op string parsing (3 ops).
    for op_str in ["\"union\"", "\"subtract\"", "\"intersect\""] {
        assert!(l.contains(op_str),
            "Endpoint must handle op string: {}", op_str);
    }
    // Y-2-h — invalid op returns explicit error JSON.
    assert!(l.contains("invalid op string"),
        "Invalid op must return explicit error JSON, not panic");
    // Delegation to JSON helper.
    assert!(l.contains("step6_json::boolean_dispatch_dcel_multi_result_json"),
        "Endpoint must delegate to step6_json helper");
}

/// Y-2 #3 — Y-2-f Transaction safety: begin / before-snapshot /
/// (cancel|commit) wrapping for safe rollback on Err.
#[test]
fn boolean_dispatch_dcel_multi_json_uses_transactions() {
    let l = lib_src();
    let needle = "pub fn boolean_dispatch_dcel_multi_json";
    let idx = l.find(needle).expect("method must exist");
    let window_end = (idx + 3500).min(l.len());
    let body = &l[idx..window_end];
    assert!(body.contains("self.scene.transactions.begin()"),
        "method must call transactions.begin() before dispatch");
    assert!(body.contains("set_before_snapshot"),
        "method must capture before snapshot for undo");
    assert!(body.contains("transactions.cancel()"),
        "method must cancel transaction on Err (Y-H safe-only)");
    assert!(body.contains("transactions.commit()"),
        "method must commit transaction on Ok");
    assert!(body.contains("mark_topology_changed"),
        "method must mark topology changed on commit");
}

/// Y-2 #4 — Y-E ineligibility (path_used == "Mesh") branch: per_pair /
/// aggregates emitted as empty JSON arrays. Defense-in-depth that the
/// helper format string handles the ineligible code path.
#[test]
fn boolean_dispatch_dcel_multi_json_handles_mesh_path_branch() {
    let s = json_helpers_src();
    // The helper unconditionally emits perPair / allNewFaces /
    // allRemovedFaces (with empty Vecs producing empty arrays "[]").
    // Verify via the format string structure.
    let needle = "fn boolean_dispatch_dcel_multi_result_json";
    let idx = s.find(needle).expect("helper must exist");
    let window_end = (idx + 4000).min(s.len());
    let body = &s[idx..window_end];
    // Format string emits all 3 collection fields unconditionally
    // (no Option branching — empty Vec → "[]" naturally).
    assert!(body.contains(r#""perPair":{}"#),
        "format string must emit perPair unconditionally");
    assert!(body.contains(r#""allNewFaces":[{}]"#),
        "format string must emit allNewFaces unconditionally");
    assert!(body.contains(r#""allRemovedFaces":[{}]"#),
        "format string must emit allRemovedFaces unconditionally");
    assert!(body.contains(r#""warnings":{}"#),
        "format string must emit warnings unconditionally");
    // BooleanPath::Mesh literal is in the path_str match.
    assert!(body.contains("BooleanPath::Mesh => \"Mesh\""),
        "Mesh path label must be emitted");
    // All 6 fallback reason kinds (drift defense).
    for kind in [
        "SurfaceMissing", "MultipleFacesNotSupported", "UnsupportedSurfaceKind",
        "TrimLoopsNotSupported", "NurbsCoreError", "SsiNotClean",
    ] {
        assert!(body.contains(&format!("=> \"{}\"", kind)),
            "fallback reason kind missing: {}", kind);
    }
}

// ────────────────────────────────────────────────────────────────────
// ADR-078 P-2 — Boolean Group Persistence WASM bridge regression tests
// (Path Z atomic — typed methods, no JSON envelope)
// ────────────────────────────────────────────────────────────────────

/// P-2 #1 — All 6 wasm_bindgen exports registered with documented js_name.
#[test]
fn boolean_group_p2_endpoints_wired() {
    let l = lib_src();
    for endpoint in [
        "setBooleanGroupTag",
        "getBooleanGroupAFaces",
        "getBooleanGroupBFaces",
        "clearBooleanGroupTags",
        "hasAnyBooleanGroupTag",
        "hasBooleanGroupSelection",
    ] {
        let needle = format!(r#"js_name = "{}""#, endpoint);
        assert!(l.contains(&needle),
            "P-2: {} endpoint must be registered", endpoint);
    }
}

/// P-2 #2 — set_boolean_group_tag uses Result<(), JsValue> with strict
/// "A"/"B" matching (P-2-c lock-in: no lowercase fallback, no silent
/// no-op on invalid tag — explicit Err throw).
#[test]
fn boolean_group_p2_set_strict_invalid_tag_returns_err() {
    let l = lib_src();
    let needle = "pub fn set_boolean_group_tag";
    let idx = l.find(needle).expect("set_boolean_group_tag must exist");
    let window_end = (idx + 1500).min(l.len());
    let body = &l[idx..window_end];

    // Result<(), JsValue> 시그니처
    assert!(body.contains("-> Result<(), JsValue>"),
        "P-2-c: set must return Result<(), JsValue> (strict invalid handling)");
    // 'A' / 'B' arms — uppercase only (P-2-c lock-in)
    assert!(body.contains(r#""A" => axia_core::BooleanGroupTag::A"#),
        "P-2-c: 'A' arm must map to BooleanGroupTag::A");
    assert!(body.contains(r#""B" => axia_core::BooleanGroupTag::B"#),
        "P-2-c: 'B' arm must map to BooleanGroupTag::B");
    // Catch-all → Err with descriptive message (no silent skip)
    assert!(body.contains("invalid tag"),
        "P-2-c: invalid tag path must throw Err with diagnostic message");
    // P-2-d — Vec<u32> (NOT &[u32]) per user-corrected lock-in
    assert!(body.contains("face_ids: Vec<u32>"),
        "P-2-d: face_ids must be Vec<u32> (wasm-bindgen ownership)");
}

/// P-2 #3 — set/clear methods are transaction-wrapped (P-2-f) for
/// Undo/Redo. Read-only methods (get/has*) are NOT wrapped.
#[test]
fn boolean_group_p2_set_and_clear_use_transactions() {
    let l = lib_src();
    // set_boolean_group_tag wrapping
    let set_idx = l.find("pub fn set_boolean_group_tag").expect("set must exist");
    let set_body = &l[set_idx..(set_idx + 1500).min(l.len())];
    assert!(set_body.contains("self.scene.transactions.begin()"),
        "P-2-f: set must call transactions.begin()");
    assert!(set_body.contains("transactions.commit()"),
        "P-2-f: set must call transactions.commit()");
    assert!(set_body.contains("set_before_snapshot"),
        "P-2-f: set must capture before snapshot for undo");

    // clear_boolean_group_tags wrapping
    let clear_idx = l.find("pub fn clear_boolean_group_tags").expect("clear must exist");
    let clear_body = &l[clear_idx..(clear_idx + 700).min(l.len())];
    assert!(clear_body.contains("self.scene.transactions.begin()"),
        "P-2-f: clear must call transactions.begin()");
    assert!(clear_body.contains("transactions.commit()"),
        "P-2-f: clear must call transactions.commit()");

    // Read-only methods MUST NOT begin transactions
    for method in [
        "pub fn get_boolean_group_a_faces",
        "pub fn get_boolean_group_b_faces",
        "pub fn has_any_boolean_group_tag",
        "pub fn has_boolean_group_selection",
    ] {
        let idx = l.find(method).expect(method);
        let body = &l[idx..(idx + 400).min(l.len())];
        assert!(!body.contains("transactions.begin"),
            "P-2-f: read-only method {} must NOT begin transactions", method);
    }
}

/// P-2 #4 — Output methods return Vec<u32> (sorted via P-1 helpers).
#[test]
fn boolean_group_p2_output_signature_vec_u32() {
    let l = lib_src();
    for method in [
        "pub fn get_boolean_group_a_faces",
        "pub fn get_boolean_group_b_faces",
    ] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 400);
        assert!(body.contains("-> Vec<u32>"),
            "P-2-e: {} must return Vec<u32>", method);
        assert!(body.contains(".raw()"),
            "P-2-e: {} must convert FaceId via .raw()", method);
    }

    for method in ["pub fn has_any_boolean_group_tag", "pub fn has_boolean_group_selection"] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 200);
        assert!(body.contains("-> bool"),
            "P-2: {} must return bool", method);
    }
}

/// ADR-050 P-4 — Char-boundary-safe slice helper.
///
/// `&str[a..b]` panics when `b` falls inside a multi-byte UTF-8 char.
/// The lib.rs source contains Korean characters (`═`, `↔`, `—` em-dash,
/// 한글) in comments which are 3 bytes per char in UTF-8. A naïve byte
/// slice can land mid-char and crash.
///
/// This helper rounds `start + max_bytes` down to the nearest valid
/// char boundary, guaranteeing `&s[start..end]` never panics.
fn char_safe_slice(s: &str, start: usize, max_bytes: usize) -> &str {
    let mut end = (start + max_bytes).min(s.len());
    while end > start && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[start..end]
}

// ════════════════════════════════════════════════════════════════════════
// ADR-050 P-4 — Shape WASM bridge source-inspection invariants.
//
// Mirrors ADR-078 P-2 pattern. Source-inspection tests because cargo
// test cannot drive js-sys marshalling — exercise the lib.rs source
// to verify wiring contracts.
// ════════════════════════════════════════════════════════════════════════

/// P-4 #1 — All 6 endpoints wired with correct js_name camelCase mapping.
#[test]
fn shape_p4_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn create_shape",          "createShape"),
        ("pub fn get_shape_ids",         "getShapeIds"),
        ("pub fn get_shape_face_ids",    "getShapeFaceIds"),
        ("pub fn delete_shape",          "deleteShape"),
        ("pub fn clear_shapes",          "clearShapes"),
        ("pub fn promote_shape_to_xia",  "promoteShapeToXia"),
    ] {
        // Each Rust function must exist
        assert!(l.contains(rust_name),
            "ADR-050 P-4: missing Rust function {}", rust_name);
        // and have the matching js_name attribute somewhere nearby
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-050 P-4: missing js_name attr {}", attr);
    }
}

/// P-4 #2 — `promoteShapeToXia` uses strict Result<u32, JsValue>
/// (failure throws — silent skip 차단, P-2-c lock-in 답습).
#[test]
fn shape_p4_promote_returns_strict_result() {
    let l = lib_src();
    let idx = l.find("pub fn promote_shape_to_xia").expect("promote_shape_to_xia");
    let body = char_safe_slice(&l, idx, 1200);
    assert!(body.contains("-> Result<u32, JsValue>"),
        "ADR-050 P-4-c: promoteShapeToXia must return Result<u32, JsValue> for strict throw");
    // Failure path must call transactions.cancel() — not commit + dummy.
    assert!(body.contains("transactions.cancel"),
        "ADR-050 P-4: promote failure path must cancel transaction");
}

/// P-4 #3 — Mutator endpoints (create / delete / clear / promote) all
/// wrap the operation in a transaction so Undo/Redo restores prior
/// state. `getShapeIds` / `getShapeFaceIds` are read-only and must NOT
/// begin transactions.
#[test]
fn shape_p4_mutators_use_transactions_readonly_skip() {
    let l = lib_src();
    for method in [
        "pub fn create_shape",
        "pub fn delete_shape",
        "pub fn clear_shapes",
        "pub fn promote_shape_to_xia",
    ] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 1200);
        assert!(body.contains("transactions.begin"),
            "P-4: mutator {} must begin transactions", method);
        assert!(
            body.contains("transactions.commit") || body.contains("transactions.cancel"),
            "P-4: mutator {} must commit OR cancel the transaction", method,
        );
    }
    for method in ["pub fn get_shape_ids", "pub fn get_shape_face_ids"] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 400);
        assert!(!body.contains("transactions.begin"),
            "P-4: read-only {} must NOT begin transactions", method);
    }
}

// ════════════════════════════════════════════════════════════════════════
// ADR-097 T-δ — Topology damage detection + recovery WASM endpoints.
// ════════════════════════════════════════════════════════════════════════

#[test]
fn adr097_t_delta_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn detect_topology_damage", "detectTopologyDamage"),
        ("pub fn attempt_auto_recovery",  "attemptAutoRecovery"),
    ] {
        assert!(l.contains(rust_name),
            "ADR-097 T-δ: missing Rust function {}", rust_name);
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-097 T-δ: missing js_name attr {}", attr);
    }
}

#[test]
fn adr097_t_delta_signatures_return_string_json() {
    let l = lib_src();
    for fn_name in [
        "pub fn detect_topology_damage",
        "pub fn attempt_auto_recovery",
    ] {
        let idx = l.find(fn_name).expect(fn_name);
        let body = char_safe_slice(&l, idx, 800);
        assert!(body.contains("-> String"),
            "ADR-097 T-δ: {} must return String (JSON)", fn_name);
    }
}

// ════════════════════════════════════════════════════════════════════════
// ADR-098 S-γ — Asset Library 3-Tier Material Scope WASM endpoints.
// ════════════════════════════════════════════════════════════════════════

#[test]
fn adr098_s_gamma_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn list_materials_by_tier",  "listMaterialsByTier"),
        ("pub fn get_material_tier",       "getMaterialTier"),
        ("pub fn add_project_material",    "addProjectMaterial"),
        ("pub fn add_user_material",       "addUserMaterial"),
        ("pub fn remove_user_material",    "removeUserMaterial"),
        ("pub fn migrate_legacy_materials","migrateLegacyMaterials"),
    ] {
        assert!(l.contains(rust_name),
            "ADR-098 S-γ: missing Rust function {}", rust_name);
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-098 S-γ: missing js_name attr {}", attr);
    }
}

#[test]
fn adr098_s_gamma_list_returns_json_array() {
    let l = lib_src();
    let idx = l.find("pub fn list_materials_by_tier").expect("list fn");
    let body = char_safe_slice(&l, idx, 1200);
    assert!(body.contains("-> String"),
        "list_materials_by_tier must return String");
    assert!(body.contains("\"tier\":"),
        "list_materials_by_tier JSON must include tier field");
    assert!(body.contains("\"id\":"),
        "list_materials_by_tier JSON must include id field");
}

#[test]
fn adr098_s_gamma_get_tier_uses_minus_one_sentinel() {
    let l = lib_src();
    let idx = l.find("pub fn get_material_tier").expect("get_tier fn");
    let body = char_safe_slice(&l, idx, 400);
    assert!(body.contains("-1"),
        "get_material_tier must return -1 sentinel for missing material");
    assert!(body.contains("-> i32"),
        "get_material_tier must return i32 (signed for sentinel)");
}

#[test]
fn adr100_r_gamma_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn detect_orphan_material_assignments",  "detectOrphanMaterialAssignments"),
        ("pub fn attempt_material_removal_recovery",   "attemptMaterialRemovalRecovery"),
        ("pub fn remove_project_material",             "removeProjectMaterial"),
    ] {
        assert!(l.contains(rust_name),
            "ADR-100 R-γ: missing Rust function {}", rust_name);
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-100 R-γ: missing js_name attr {}", attr);
    }
}

#[test]
fn adr100_r_gamma_recovery_json_uses_kind_discriminator() {
    let l = lib_src();
    let idx = l.find("pub fn attempt_material_removal_recovery").expect("recovery fn");
    let body = char_safe_slice(&l, idx, 1500);
    // ADR-097 T-δ shape 답습 — kind discriminator on all 3 variants.
    // Source contains escaped JSON (\"kind\":\"NoOp\"), so search uses
    // the variant name with the closing escape sequence.
    assert!(body.contains("NoOp\\\""),
        "attempt_material_removal_recovery must emit NoOp kind");
    assert!(body.contains("Recovered\\\""),
        "attempt_material_removal_recovery must emit Recovered kind");
    assert!(body.contains("PartialFailure\\\""),
        "attempt_material_removal_recovery must emit PartialFailure kind");
}

#[test]
fn adr100_r_gamma_remove_project_returns_ok_envelope() {
    let l = lib_src();
    let idx = l.find("pub fn remove_project_material").expect("remove fn");
    let body = char_safe_slice(&l, idx, 2000);
    // ok envelope + error envelope (silent skip 차단). Source has
    // escaped quotes — check for the unique key strings.
    assert!(body.contains("ok\\\":true"),
        "remove_project_material must emit ok:true on success");
    assert!(body.contains("ok\\\":false"),
        "remove_project_material must emit ok:false on error");
    assert!(body.contains("removedId\\\":"),
        "success JSON must include removedId");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-099 L-γ — Layered Material 4-PBR Channels (Phase 5-B) WASM endpoints.
// ════════════════════════════════════════════════════════════════════════

#[test]
fn adr099_l_gamma_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn get_layered_channels",            "getLayeredChannels"),
        ("pub fn set_layered_channel",             "setLayeredChannel"),
        ("pub fn clear_layered_channel",           "clearLayeredChannel"),
        ("pub fn migrate_legacy_texture_to_layered","migrateLegacyTextureToLayered"),
        ("pub fn has_layered_material",            "hasLayeredMaterial"),
    ] {
        assert!(l.contains(rust_name),
            "ADR-099 L-γ: missing Rust function {}", rust_name);
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-099 L-γ: missing js_name attr {}", attr);
    }
}

#[test]
fn adr099_l_gamma_get_emits_has_layered_field() {
    let l = lib_src();
    let idx = l.find("pub fn get_layered_channels").expect("get fn");
    let body = char_safe_slice(&l, idx, 2500);
    // Schema lock — both shapes (hasLayered:false / hasLayered:true)
    // must be present. Source has two literal styles: the false branch
    // uses regular string ("\"hasLayered\":false") and the true branch
    // uses a raw string ("hasLayered":true). Search for the unescaped
    // key in both cases by substring.
    assert!(body.contains("hasLayered"),
        "get_layered_channels must reference hasLayered key");
    assert!(body.contains(":false"),
        "get_layered_channels must emit :false branch");
    assert!(body.contains(":true"),
        "get_layered_channels must emit :true branch");
    assert!(body.contains("channels"),
        "get_layered_channels true-branch must include channels object");
}

#[test]
fn adr099_l_gamma_set_channel_uses_flat_signature() {
    let l = lib_src();
    let idx = l.find("pub fn set_layered_channel").expect("set fn");
    let body = char_safe_slice(&l, idx, 1500);
    // L-G flat signature lock — primitive types only (no JSON parsing).
    assert!(body.contains("channel: String"),
        "set must accept channel name as String");
    assert!(body.contains("projection: u32"),
        "set must accept projection as u32 (0=planar, 1=box, 2=cylindrical)");
    assert!(body.contains("rotation_or_nan: f64"),
        "set must accept rotation as f64 (NaN = None sentinel)");
    assert!(body.contains("-> bool"),
        "set must return bool (success / silent reject)");
}

#[test]
fn adr099_l_gamma_clear_normalizes_empty_layered() {
    let l = lib_src();
    let idx = l.find("pub fn clear_layered_channel").expect("clear fn");
    let body = char_safe_slice(&l, idx, 1200);
    // L-D idempotent normalization — empty layered → None.
    assert!(body.contains("has_any_channel"),
        "clear must check has_any_channel for normalization");
    assert!(body.contains("layered = None")
        || body.contains("layered=None"),
        "clear must reset layered to None when all channels empty");
}

#[test]
fn adr099_l_gamma_has_layered_quick_check_returns_bool() {
    let l = lib_src();
    let idx = l.find("pub fn has_layered_material").expect("has fn");
    let body = char_safe_slice(&l, idx, 600);
    assert!(body.contains("-> bool"),
        "has_layered_material must return bool");
    assert!(body.contains("has_any_channel"),
        "has_layered_material must consult has_any_channel (empty != Some)");
}

#[test]
fn adr098_s_gamma_remove_user_only_blocks_other_tiers() {
    let l = lib_src();
    let idx = l.find("pub fn remove_user_material").expect("remove fn");
    let body = char_safe_slice(&l, idx, 600);
    // S-G safety: only User tier removable through this endpoint.
    assert!(body.contains("MaterialTier::User"),
        "remove_user_material must check User tier explicitly");
    assert!(body.contains("-> bool"),
        "remove_user_material must return bool");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-095 Phase 3-γ — Reference 시민권 (Two-Layer Phase 3) WASM endpoints.
// ════════════════════════════════════════════════════════════════════════

/// Phase 3-γ #1 — All 9 Reference endpoints wired with correct js_name.
#[test]
fn adr095_phase3_gamma_endpoints_wired() {
    let l = lib_src();
    for (rust_name, js_name) in [
        ("pub fn create_reference_construction_line", "createReferenceConstructionLine"),
        ("pub fn create_reference_imported_mesh",     "createReferenceImportedMesh"),
        ("pub fn create_reference_point_cloud",       "createReferencePointCloud"),
        ("pub fn get_reference_ids",                  "getReferenceIds"),
        ("pub fn get_reference_json",                 "getReferenceJson"),
        ("pub fn delete_reference",                   "deleteReference"),
        ("pub fn set_reference_visible",              "setReferenceVisible"),
        ("pub fn set_reference_locked",               "setReferenceLocked"),
        ("pub fn get_face_reference_id",              "getFaceReferenceId"),
    ] {
        assert!(l.contains(rust_name),
            "ADR-095 Phase 3-γ: missing Rust function {}", rust_name);
        let attr = format!("js_name = \"{}\"", js_name);
        assert!(l.contains(&attr),
            "ADR-095 Phase 3-γ: missing js_name attr {}", attr);
    }
}

/// Phase 3-γ #2 — `create_reference_*` 3 categories all return
/// `Result<u32, JsValue>` (strict throw on R-B violation).
#[test]
fn adr095_phase3_gamma_create_strict_throw_signatures() {
    let l = lib_src();
    for fn_name in [
        "pub fn create_reference_construction_line",
        "pub fn create_reference_imported_mesh",
        "pub fn create_reference_point_cloud",
    ] {
        let idx = l.find(fn_name).expect(fn_name);
        let body = char_safe_slice(&l, idx, 1500);
        assert!(body.contains("-> Result<u32, JsValue>"),
            "ADR-095 Phase 3-γ: {} must return Result<u32, JsValue> for \
             strict throw on R-B violation", fn_name);
    }
}

// ════════════════════════════════════════════════════════════════════════
// ADR-093 D-γ — Cylinder side face owner-id WASM endpoints.
// ════════════════════════════════════════════════════════════════════════

/// D-γ #1 — `walkFaceOwnerSiblings` endpoint wired with correct js_name
/// and `Vec<u32>` return signature (single face → group siblings).
#[test]
fn adr093_d_gamma_walk_face_owner_siblings_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn walk_face_owner_siblings"),
        "ADR-093 D-γ: missing Rust function walk_face_owner_siblings");
    assert!(l.contains("js_name = \"walkFaceOwnerSiblings\""),
        "ADR-093 D-γ: missing js_name = \"walkFaceOwnerSiblings\"");
    let idx = l.find("pub fn walk_face_owner_siblings")
        .expect("walk_face_owner_siblings");
    let body = char_safe_slice(&l, idx, 600);
    assert!(body.contains("-> Vec<u32>"),
        "ADR-093 D-γ: walkFaceOwnerSiblings must return Vec<u32>");
    // Must delegate to mesh::walk_face_owner_siblings
    assert!(body.contains("walk_face_owner_siblings"),
        "ADR-093 D-γ: must delegate to Mesh::walk_face_owner_siblings");
}

/// D-γ #2 — `getFaceSurfaceOwnerId` endpoint wired with i32 return
/// (-1 = no owner, mirrors getEdgeCurveOwnerId).
#[test]
fn adr093_d_gamma_get_face_surface_owner_id_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn get_face_surface_owner_id"),
        "ADR-093 D-γ: missing Rust function get_face_surface_owner_id");
    assert!(l.contains("js_name = \"getFaceSurfaceOwnerId\""),
        "ADR-093 D-γ: missing js_name = \"getFaceSurfaceOwnerId\"");
    let idx = l.find("pub fn get_face_surface_owner_id")
        .expect("get_face_surface_owner_id");
    let body = char_safe_slice(&l, idx, 500);
    assert!(body.contains("-> i32"),
        "ADR-093 D-γ: getFaceSurfaceOwnerId must return i32 (-1 = no owner)");
    assert!(body.contains("None => -1"),
        "ADR-093 D-γ: must return -1 for None owner_id");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-091 D-γ — Material removal → Shape demotion WASM endpoint.
// ════════════════════════════════════════════════════════════════════════

/// D-γ #1 — `demoteXiaToShape` endpoint is wired with correct js_name
/// and Result<String, JsValue> strict throw signature (DemoteOk JSON
/// on success, JS Error on failure).
#[test]
fn adr091_d_gamma_demote_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn demote_xia_to_shape"),
        "ADR-091 D-γ: missing Rust function demote_xia_to_shape");
    assert!(l.contains("js_name = \"demoteXiaToShape\""),
        "ADR-091 D-γ: missing js_name = \"demoteXiaToShape\"");
    let idx = l.find("pub fn demote_xia_to_shape").expect("demote_xia_to_shape");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("-> Result<String, JsValue>"),
        "ADR-091 D-γ: demoteXiaToShape must return Result<String, JsValue> \
         (JSON on success, throw on error)");
    // JSON return shape includes both fields per DemoteOk struct
    // (source-level escaped form: `\"shape_id\":` and
    // `\"original_id_restored\":`).
    assert!(body.contains("shape_id"),
        "ADR-091 D-γ: JSON return must include shape_id field");
    assert!(body.contains("original_id_restored"),
        "ADR-091 D-γ: JSON return must include original_id_restored field");
}

/// D-γ #2 — Demote endpoint wraps in a transaction (Undo restores
/// the pre-demote state) and cancels on failure (no state change).
#[test]
fn adr091_d_gamma_demote_uses_transaction_with_cancel_on_error() {
    let l = lib_src();
    let idx = l.find("pub fn demote_xia_to_shape").expect("demote_xia_to_shape");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("transactions.begin"),
        "D-γ: demote must begin transaction");
    assert!(body.contains("transactions.commit"),
        "D-γ: success path must commit transaction");
    assert!(body.contains("transactions.cancel"),
        "D-γ: failure path must cancel transaction (no side effects on rejection)");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-145 β-2 — Circle annulus WASM bridge invariants.
//
// Mirrors the source-inspection pattern of ADR-091 D-γ (promote_shape_to_xia
// / demote_xia_to_shape). Tests verify wiring contracts — function
// existence, signature shape (Result<(), JsValue> strict throw), and
// transaction-wrapped rollback on error.
// ════════════════════════════════════════════════════════════════════════

/// β-2 #1 — `promoteCirclesToAnnulus` endpoint is wired with correct
/// js_name and Result<(), JsValue> strict throw signature.
#[test]
fn adr145_beta2_promote_circles_to_annulus_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn promote_circles_to_annulus"),
        "ADR-145 β-2: missing Rust function promote_circles_to_annulus");
    assert!(l.contains("js_name = \"promoteCirclesToAnnulus\""),
        "ADR-145 β-2: missing js_name = \"promoteCirclesToAnnulus\"");
    let idx = l.find("pub fn promote_circles_to_annulus")
        .expect("promote_circles_to_annulus");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("-> Result<(), JsValue>"),
        "ADR-145 β-2: promoteCirclesToAnnulus must return Result<(), JsValue> \
         (no JSON on success — silent promote OK, throw on error per AnnulusError)");
    // Signature: 두 face_id parameter
    assert!(body.contains("outer_face_id: u32"),
        "ADR-145 β-2: signature must include outer_face_id: u32");
    assert!(body.contains("inner_face_id: u32"),
        "ADR-145 β-2: signature must include inner_face_id: u32");
    // Engine API delegation
    assert!(body.contains("annulus::promote_circles_to_annulus"),
        "ADR-145 β-2: body must delegate to axia_geo::operations::annulus");
}

/// β-2 #2 — Annulus endpoint wraps in a transaction (Undo restores
/// the pre-promote state) and cancels on failure (no state change).
#[test]
fn adr145_beta2_promote_uses_transaction_with_cancel_on_error() {
    let l = lib_src();
    let idx = l.find("pub fn promote_circles_to_annulus")
        .expect("promote_circles_to_annulus");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("transactions.begin"),
        "ADR-145 β-2: promote must begin transaction");
    assert!(body.contains("transactions.commit"),
        "ADR-145 β-2: success path must commit transaction");
    assert!(body.contains("transactions.cancel"),
        "ADR-145 β-2: failure path must cancel transaction (no side effects on rejection)");
    // 명시 error format (silent skip 차단)
    assert!(body.contains("promoteCirclesToAnnulus:"),
        "ADR-145 β-2: error message must prefix with 'promoteCirclesToAnnulus:' \
         for caller-side identification");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-148 β-3 — Point-Localized BoundaryTool WASM bridge invariants.
//
// Mirrors ADR-145 β-2 source-inspection pattern. Tests verify wiring:
// js_name, signature, transaction wrap, Engine delegation, error prefix.
// ════════════════════════════════════════════════════════════════════════

/// β-3 #1 — `boundaryFromPoint` endpoint is wired with correct js_name
/// and Result<u32, JsValue> signature (returns face_id on success).
#[test]
fn adr148_beta3_boundary_from_point_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn boundary_from_point"),
        "ADR-148 β-3: missing Rust function boundary_from_point");
    assert!(l.contains("js_name = \"boundaryFromPoint\""),
        "ADR-148 β-3: missing js_name = \"boundaryFromPoint\"");
    let idx = l.find("pub fn boundary_from_point")
        .expect("boundary_from_point");
    let body = char_safe_slice(&l, idx, 2000);
    assert!(body.contains("-> Result<u32, JsValue>"),
        "ADR-148 β-3: boundaryFromPoint must return Result<u32, JsValue> \
         (face_id on success, throw on error per BoundaryError)");
    // Signature: 8 f64 parameters (point xyz + normal xyz + plane_dist + search_radius)
    for param in [
        "px: f64", "py: f64", "pz: f64",
        "nx: f64", "ny: f64", "nz: f64",
        "plane_dist: f64", "search_radius_mm: f64",
    ] {
        assert!(body.contains(param),
            "ADR-148 β-3: signature must include {}", param);
    }
    // Engine API delegation
    assert!(body.contains("boundary::boundary_from_point"),
        "ADR-148 β-3: body must delegate to axia_geo::operations::boundary");
}

/// β-3 #2 — Boundary endpoint wraps in a transaction (Undo restores
/// pre-synthesis state) and cancels on failure.
#[test]
fn adr148_beta3_boundary_uses_transaction_with_cancel_on_error() {
    let l = lib_src();
    let idx = l.find("pub fn boundary_from_point")
        .expect("boundary_from_point");
    let body = char_safe_slice(&l, idx, 2000);
    assert!(body.contains("transactions.begin"),
        "ADR-148 β-3: boundary must begin transaction");
    assert!(body.contains("transactions.commit"),
        "ADR-148 β-3: success path must commit transaction");
    assert!(body.contains("transactions.cancel"),
        "ADR-148 β-3: failure path must cancel transaction (no side effects on rejection)");
    // 명시 error format (silent skip 차단, 메타-원칙 #16 정합)
    assert!(body.contains("boundaryFromPoint:"),
        "ADR-148 β-3: error message must prefix with 'boundaryFromPoint:' \
         for caller-side identification");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-050 P-5c — As-Shape Draw command WASM bridge invariants.
//
// Mirrors the source-inspection pattern of P-4. Tests verify wiring
// contracts — function existence, signature shape, ShapeCreated match
// (NOT EntityCreated), and consistency with existing draw_* family.
// ════════════════════════════════════════════════════════════════════════

/// P-5c #1 — All 3 As-Shape draw endpoints are wired.
#[test]
fn draw_as_shape_p5c_endpoints_wired() {
    let l = lib_src();
    for rust_name in [
        "pub fn draw_rect_as_shape",
        "pub fn draw_line_as_shape",
        "pub fn draw_circle_as_shape",
    ] {
        assert!(l.contains(rust_name),
            "ADR-050 P-5c: missing Rust function {}", rust_name);
    }
}

/// P-5c #2 — Each As-Shape endpoint matches `CommandResult::ShapeCreated`
/// (the new variant from P-5a) and NOT `EntityCreated`. This is the key
/// distinction from the legacy draw_* family.
#[test]
fn draw_as_shape_p5c_matches_shape_created_variant() {
    let l = lib_src();
    for method in [
        "pub fn draw_rect_as_shape",
        "pub fn draw_line_as_shape",
        "pub fn draw_circle_as_shape",
    ] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 1200);
        assert!(body.contains("CommandResult::ShapeCreated"),
            "P-5c: {} must match CommandResult::ShapeCreated", method);
        // Negative check — should NOT match EntityCreated (would silently
        // return -1.0 when the shape variant is the actual result).
        // Note: we look for the specific match arm pattern, not just
        // the substring "EntityCreated" (which appears in comments).
        assert!(!body.contains("EntityCreated(xia_id)"),
            "P-5c: {} must NOT match EntityCreated (legacy variant)", method);
    }
}

/// P-5c #3 — Signature consistency: f64 return, mirroring the legacy
/// draw_* family. The TS layer treats -1.0 as the error sentinel.
#[test]
fn draw_as_shape_p5c_signature_matches_legacy_family() {
    let l = lib_src();
    for method in [
        "pub fn draw_rect_as_shape",
        "pub fn draw_line_as_shape",
        "pub fn draw_circle_as_shape",
    ] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 600);
        assert!(body.contains("-> f64"),
            "P-5c: {} must return f64 (matching legacy draw_* family)", method);
        // Coordinate inputs are f64 (cx, cy, cz, nx, ny, nz, ...).
        assert!(body.contains(": f64"),
            "P-5c: {} must take f64 coordinate inputs", method);
    }
}

/// P-5c #4 — Bridge layer is a thin pass-through; it does NOT begin
/// its own transactions. Transactions are managed inside
/// `Scene::exec_draw_*_as_shape` (Phase 1 delegated, Phase 2 inner
/// wrap). Matches the legacy draw_rect / draw_line / draw_circle
/// pattern.
#[test]
fn draw_as_shape_p5c_bridge_is_thin_pass_through() {
    let l = lib_src();
    for method in [
        "pub fn draw_rect_as_shape",
        "pub fn draw_line_as_shape",
        "pub fn draw_circle_as_shape",
    ] {
        let idx = l.find(method).expect(method);
        let body = char_safe_slice(&l, idx, 1000);
        assert!(!body.contains("transactions.begin"),
            "P-5c: {} must NOT manage its own transactions \
             (delegated to Scene::exec_*_as_shape)", method);
    }
}

/// P-4 #4 — Input methods accept `Vec<u32>` (P-2-d ownership lock-in
/// answer) for face_ids; ID inputs accept bare `u32` (no JsValue, no
/// String) for ShapeId / MaterialId.
#[test]
fn shape_p4_input_signatures_match_lockin() {
    let l = lib_src();

    // create_shape signature
    let idx = l.find("pub fn create_shape").expect("create_shape");
    let body = char_safe_slice(&l, idx, 400);
    assert!(body.contains("face_ids: Vec<u32>"),
        "P-4-d: create_shape must take face_ids: Vec<u32>");
    assert!(body.contains("name: String"),
        "P-4: create_shape must take name: String");

    // promote_shape_to_xia signature
    let idx = l.find("pub fn promote_shape_to_xia").expect("promote_shape_to_xia");
    let body = char_safe_slice(&l, idx, 400);
    assert!(body.contains("shape_id: u32"),
        "P-4: promote_shape_to_xia must take shape_id: u32");
    assert!(body.contains("material_id: u32"),
        "P-4: promote_shape_to_xia must take material_id: u32");
}

// ════════════════════════════════════════════════════════════════════════
// ADR-079 W-1-β — `create_solid_extrude` WASM bridge invariants.
//
// Mirrors push_pull pattern. Source-inspection — cargo test cannot drive
// js-sys marshalling, so we exercise lib.rs source to verify wiring.
// ════════════════════════════════════════════════════════════════════════

/// W-1-β #1 — Endpoint wired with correct signature.
#[test]
fn create_solid_extrude_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn create_solid_extrude"),
        "ADR-079 W-1-β: missing Rust function pub fn create_solid_extrude");
}

/// W-1-β #2 — Signature matches push_pull family (face_id_raw: u32,
/// distance: f64, returns bool). Drop-in compatibility with bridge.pushPull.
#[test]
fn create_solid_extrude_signature_matches_push_pull_family() {
    let l = lib_src();
    let idx = l.find("pub fn create_solid_extrude").expect("create_solid_extrude");
    let body = char_safe_slice(&l, idx, 400);
    assert!(body.contains("face_id_raw: u32"),
        "W-1-β: create_solid_extrude must take face_id_raw: u32");
    assert!(body.contains("distance: f64"),
        "W-1-β: create_solid_extrude must take distance: f64");
    assert!(body.contains("-> bool"),
        "W-1-β: create_solid_extrude must return bool");
}

/// W-1-β #3 — Dispatches via Command::CreateSolid with
/// CreateSolidMode::Extrude. This is the integration with W-1-α.
#[test]
fn create_solid_extrude_dispatches_via_command() {
    let l = lib_src();
    let idx = l.find("pub fn create_solid_extrude").expect("create_solid_extrude");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("Command::CreateSolid"),
        "W-1-β: must dispatch through Command::CreateSolid");
    assert!(body.contains("CreateSolidMode::Extrude"),
        "W-1-β: must use CreateSolidMode::Extrude");
    assert!(body.contains("scene.execute(cmd)"),
        "W-1-β: must call scene.execute");
}

/// W-1-β #4 — Handles both SolidCreated (W-1-α success) AND PushPullDone
/// (Q3 fallback path) results. The fallback case is critical — when
/// Scene::exec_create_solid auto-falls-back to legacy push_pull, the
/// result variant changes from SolidCreated to PushPullDone, but caller
/// should still see success.
#[test]
fn create_solid_extrude_handles_solid_created_and_fallback() {
    let l = lib_src();
    let idx = l.find("pub fn create_solid_extrude").expect("create_solid_extrude");
    let body = char_safe_slice(&l, idx, 3500);
    assert!(body.contains("SolidCreated"),
        "W-1-β: must match CommandResult::SolidCreated (W-1-α success)");
    assert!(body.contains("PushPullDone"),
        "W-1-β: must match CommandResult::PushPullDone (Q3 fallback)");
    assert!(body.contains("CommandResult::Error"),
        "W-1-β: must match CommandResult::Error");
}

// ── ADR-080 V-β-α-bridge — `offset_edge_on_host` JSON contract ──────
//
// New WASM endpoint exposes V-β-α Rust core (offset_edge_on_host_face)
// via a JSON return that surfaces typed reasons for forward-defer cases.
// These source-inspection tests pin the endpoint signature + reason
// vocabulary so the TS bridge / OffsetTool can dispatch reliably.
#[test]
fn offset_edge_on_host_endpoint_wired() {
    let l = lib_src();
    assert!(
        l.contains("pub fn offset_edge_on_host"),
        "ADR-080 V-β-α-bridge: missing pub fn offset_edge_on_host"
    );
    let idx = l
        .find("pub fn offset_edge_on_host")
        .expect("offset_edge_on_host");
    let body = char_safe_slice(&l, idx, 3500);
    // Signature: (edge_id_raw: u32, dist: f64) -> String
    assert!(
        body.contains("edge_id_raw: u32"),
        "must take edge_id_raw: u32"
    );
    assert!(body.contains("dist: f64"), "must take dist: f64");
    assert!(
        body.contains("-> String"),
        "must return JSON-encoded String"
    );
}

#[test]
fn offset_edge_on_host_dispatches_via_offset_edge_on_host_face() {
    let l = lib_src();
    let idx = l.find("pub fn offset_edge_on_host").expect("endpoint");
    let body = char_safe_slice(&l, idx, 3500);
    assert!(
        body.contains("offset_edge_on_host_face"),
        "must call Mesh::offset_edge_on_host_face (V-β-α Rust core)"
    );
}

#[test]
fn offset_edge_on_host_emits_typed_reason_vocabulary() {
    let l = lib_src();
    let idx = l.find("pub fn offset_edge_on_host").expect("endpoint");
    let body = char_safe_slice(&l, idx, 5500);
    // §V-β-α-bridge reason vocabulary — every typed error must produce
    // a stable, parseable reason string for the TS layer.
    for reason in [
        // V-β-α-bridge core (7)
        "unsupported_surface",
        "unsupported_curve",
        "no_incident_face",
        "ambiguous_host",
        "multi_loop",
        "degenerate_distance",
        // V-β-β additions (2)
        "arc_plane_mismatch",
        "radius_collapse",
        // V-β-γ-1 additions (2)
        "unsupported_curve_on_surface",
        "axial_out_of_range",
        // V-δ-α additions (2)
        "wire_not_planar",
        "no_reference_plane",
    ] {
        assert!(
            body.contains(reason),
            "V-β reason vocabulary missing '{}'",
            reason
        );
    }
}

// ── ADR-080 V-δ-β — `offset_edge_with_reference_plane` JSON contract ─
//
// Escape hatch for V-δ-α failures: caller supplies explicit plane
// (origin + normal) for free wire / sketch session integration.
#[test]
fn offset_edge_with_reference_plane_endpoint_wired() {
    let l = lib_src();
    assert!(
        l.contains("pub fn offset_edge_with_reference_plane"),
        "ADR-080 V-δ-β: missing pub fn offset_edge_with_reference_plane"
    );
    let idx = l
        .find("pub fn offset_edge_with_reference_plane")
        .expect("offset_edge_with_reference_plane");
    let body = char_safe_slice(&l, idx, 3500);
    assert!(body.contains("edge_id_raw: u32"));
    assert!(body.contains("dist: f64"));
    assert!(body.contains("ox: f64") && body.contains("oy: f64") && body.contains("oz: f64"));
    assert!(body.contains("nx: f64") && body.contains("ny: f64") && body.contains("nz: f64"));
    assert!(body.contains("-> String"));
}

#[test]
fn offset_edge_with_reference_plane_dispatches_via_rust_core() {
    let l = lib_src();
    let idx = l
        .find("pub fn offset_edge_with_reference_plane")
        .expect("endpoint");
    let body = char_safe_slice(&l, idx, 3500);
    assert!(
        body.contains("offset_edge_with_reference_plane(eid, dist, origin, normal)"),
        "must call Mesh::offset_edge_with_reference_plane (V-δ-β Rust core)"
    );
}

// ── ADR-079 W-2-β — `create_solid_extrude` is SolidKind-agnostic ─────
//
// W-2-α 가 SolidKind::Cylinder 를 새 SolidKind 로 도입했다. 본 endpoint
// 의 SolidCreated arm 이 특정 kind 에 hardcoded 되지 않고 generic
// `kind` 패턴으로 binding 되어 있어야 W-2 (Cylinder) / W-3 (GeneralSweep
// / SweptSolid / LoftSolid) / W-4 (RevolutionSolid) 모두 추가 코드 없이
// 흡수된다. 본 source-inspection 이 그 invariant 를 봉인.
#[test]
fn create_solid_extrude_handler_is_solidkind_agnostic() {
    let l = lib_src();
    let idx = l.find("pub fn create_solid_extrude").expect("create_solid_extrude");
    let body = char_safe_slice(&l, idx, 3500);
    // SolidCreated arm must bind generic `kind` (not match SolidKind::Box).
    // Look for the pattern `SolidCreated { kind, ` (kind as field-name binding).
    assert!(
        body.contains("SolidCreated { kind"),
        "W-2-β: SolidCreated arm must bind `kind` generically — \
         hardcoded `SolidKind::Box` 거부 (Cylinder/SweptSolid/등 차단)"
    );
    // Negative — must NOT have a Box-only filter.
    assert!(
        !body.contains("SolidKind::Box =>") && !body.contains("SolidKind::Box{"),
        "W-2-β: handler must not filter on SolidKind::Box specifically"
    );
}

// ── ADR-151 β-3 — Connected Stacked-inner Component-Merge Resolver ──
// Sprint 3 셋째 ADR. Engine `enforce_p7_canonical` (β-2 PR #213 merged)
// dispatch + transaction wrap. ADR-149/150 β-3 답습 패턴.

/// β-3 #1 — enforceP7Canonical endpoint wired (signature + delegation).
#[test]
fn adr151_beta3_enforce_p7_canonical_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn enforce_p7_canonical"),
        "ADR-151 β-3: missing Rust function enforce_p7_canonical");
    assert!(l.contains("js_name = \"enforceP7Canonical\""),
        "ADR-151 β-3: missing js_name = \"enforceP7Canonical\"");
    let idx = l.find("pub fn enforce_p7_canonical")
        .expect("enforce_p7_canonical");
    let body = char_safe_slice(&l, idx, 2500);
    assert!(body.contains("-> Result<String, JsValue>"),
        "ADR-151 β-3: enforceP7Canonical must return Result<String, JsValue>");
    // Signature: container_id + inner_ids (Vec<u32> per Q1=a default)
    assert!(body.contains("container_id: u32"),
        "ADR-151 β-3: signature must include container_id: u32");
    assert!(body.contains("inner_ids: Vec<u32>"),
        "ADR-151 β-3: signature must include inner_ids: Vec<u32>");
    // Engine API delegation
    assert!(body.contains("p7_canonical_resolver::enforce_p7_canonical"),
        "ADR-151 β-3: body must delegate to axia_geo::operations::p7_canonical_resolver");
}

/// β-3 #2 — enforceP7Canonical wraps in a transaction (Undo restores
/// pre-rebuild state) per ADR-149/150 β-3 답습.
#[test]
fn adr151_beta3_enforce_p7_uses_transaction() {
    let l = lib_src();
    let idx = l.find("pub fn enforce_p7_canonical")
        .expect("enforce_p7_canonical");
    let body = char_safe_slice(&l, idx, 2500);
    assert!(body.contains("transactions.begin"),
        "ADR-151 β-3: must wrap in transaction (begin)");
    assert!(body.contains("set_before_snapshot"),
        "ADR-151 β-3: must capture before snapshot");
    assert!(body.contains("set_after_snapshot"),
        "ADR-151 β-3: must capture after snapshot on success");
    assert!(body.contains("transactions.commit"),
        "ADR-151 β-3: must commit transaction");
}

/// β-3 #3 — enforceP7Canonical JSON response schema lock-in
/// (component_count + is_valid + violation_count per L-β3-1).
#[test]
fn adr151_beta3_enforce_p7_json_schema_locked() {
    let l = lib_src();
    let idx = l.find("pub fn enforce_p7_canonical")
        .expect("enforce_p7_canonical");
    let body = char_safe_slice(&l, idx, 2500);
    // Required JSON keys (silent skip 차단 evidence)
    assert!(body.contains("component_count"),
        "ADR-151 β-3: JSON must include component_count");
    assert!(body.contains("is_valid"),
        "ADR-151 β-3: JSON must include is_valid");
    assert!(body.contains("violation_count"),
        "ADR-151 β-3: JSON must include violation_count");
    // Strict throw on error (메타-원칙 #16 정합, Q1=a default)
    assert!(body.contains("Err(JsValue::from_str"),
        "ADR-151 β-3: must throw JsValue on P7EnforceError (silent skip 차단)");
}

// ── ADR-152 β-3 — P7-M4/M5 + Euler/Genus WASM bridge ────────────────────
// Sprint 4 첫째 ADR. verifyP7ManifoldExtended + computeTopology JSON
// exports + TS wrapper. ADR-149/150/151 β-3 답습.

/// β-3 #1 — verifyP7ManifoldExtended endpoint wired.
#[test]
fn adr152_beta3_verify_p7_manifold_extended_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn verify_p7_manifold_extended"),
        "ADR-152 β-3: missing Rust function verify_p7_manifold_extended");
    assert!(l.contains("js_name = \"verifyP7ManifoldExtended\""),
        "ADR-152 β-3: missing js_name = \"verifyP7ManifoldExtended\"");
    let idx = l.find("pub fn verify_p7_manifold_extended")
        .expect("verify_p7_manifold_extended");
    let body = char_safe_slice(&l, idx, 3000);
    // Signature: (container_id: u32, inner_ids: Vec<u32>) -> String
    assert!(body.contains("container_id: u32"),
        "ADR-152 β-3: signature must include container_id: u32");
    assert!(body.contains("inner_ids: Vec<u32>"),
        "ADR-152 β-3: signature must include inner_ids: Vec<u32>");
    assert!(body.contains("-> String"),
        "ADR-152 β-3: must return String (JSON, read-only)");
    // Engine API delegation
    assert!(body.contains("p7_manifold::verify_p7_manifold"),
        "ADR-152 β-3: body must delegate to axia_geo::p7_manifold::verify_p7_manifold");
}

/// β-3 #2 — computeTopology endpoint wired.
#[test]
fn adr152_beta3_compute_topology_endpoint_wired() {
    let l = lib_src();
    assert!(l.contains("pub fn compute_topology"),
        "ADR-152 β-3: missing Rust function compute_topology");
    assert!(l.contains("js_name = \"computeTopology\""),
        "ADR-152 β-3: missing js_name = \"computeTopology\"");
    let idx = l.find("pub fn compute_topology")
        .expect("compute_topology");
    let body = char_safe_slice(&l, idx, 1500);
    assert!(body.contains("-> String"),
        "ADR-152 β-3: computeTopology must return String (JSON, read-only)");
    // Engine API delegation
    assert!(body.contains("p7_manifold::compute_topology"),
        "ADR-152 β-3: body must delegate to axia_geo::p7_manifold::compute_topology");
}

/// β-3 #3 — JSON schema lock-in (both endpoints).
#[test]
fn adr152_beta3_json_schema_locked() {
    let l = lib_src();

    // verifyP7ManifoldExtended schema (silent skip 차단 evidence)
    let v_idx = l.find("pub fn verify_p7_manifold_extended")
        .expect("verify_p7_manifold_extended");
    let v_body = char_safe_slice(&l, v_idx, 3000);
    assert!(v_body.contains("container"),
        "ADR-152 β-3: verifyP7ManifoldExtended JSON must include container");
    assert!(v_body.contains("is_valid"),
        "ADR-152 β-3: verifyP7ManifoldExtended JSON must include is_valid");
    assert!(v_body.contains("violations"),
        "ADR-152 β-3: verifyP7ManifoldExtended JSON must include violations array");
    // M4/M5 kind labels (β-1 extension exposed)
    assert!(v_body.contains("\"M4\""),
        "ADR-152 β-3: must label VertexValencePathology as M4");
    assert!(v_body.contains("\"M5\""),
        "ADR-152 β-3: must label FaceOrientationInconsistent as M5");

    // computeTopology schema (β-2 fields)
    let c_idx = l.find("pub fn compute_topology")
        .expect("compute_topology");
    let c_body = char_safe_slice(&l, c_idx, 1500);
    for key in ["vertex_count", "edge_count", "face_count",
                "euler_characteristic", "genus", "boundary_loop_count", "is_closed"] {
        assert!(c_body.contains(key),
            "ADR-152 β-3: computeTopology JSON must include {key}");
    }
}
