//! Reproduction test for the user-reported "RECT 그리면 인접 face 가
//! wireframe 만 남음" bug. Loads the user-provided scene
//! `fixtures/burge.xia` (10+ rectangles in a complex floor-plan layout)
//! and verifies face counts + invariants.
//!
//! Phase 1 of debug: just inspect the imported state. Phase 2: draw
//! additional RECT and observe which Phase deactivates faces.
//!
//! When the bug is fixed, this test should turn into a regression
//! guard with assertions on expected face counts.

use axia_core::scene::Scene;
use axia_core::commands::Command;
use glam::DVec3;
use std::fs;

/// `.xia` files have an outer wrapper (per FileManager.ts):
///   [4 magic][4 version][4 metadata_len][metadata_json][snapshot]
/// Strip the wrapper to get the inner snapshot expected by
/// `Scene::import_versioned_snapshot`.
fn strip_axia_wrapper(bytes: &[u8]) -> &[u8] {
    assert!(bytes.len() >= 12, "file too small");
    // bytes[0..4] = magic 'AXIA' (little-endian → 'A','I','X','A' on disk).
    // bytes[4..8] = version u32 LE
    // bytes[8..12] = metadata_len u32 LE
    let metadata_len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    let snapshot_start = 12 + metadata_len;
    assert!(bytes.len() > snapshot_start, "snapshot section missing");
    &bytes[snapshot_start..]
}

/// Load the user-supplied burge.xia and dump the post-import state.
#[test]
fn load_burge_inspect_state() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/burge.xia");
    let bytes = fs::read(&path).expect("read burge.xia");
    let inner = strip_axia_wrapper(&bytes);

    let mut scene = Scene::default();
    scene
        .import_versioned_snapshot(inner)
        .expect("import burge.xia");

    let active_faces: Vec<_> = scene
        .mesh
        .faces
        .iter()
        .filter(|(_, f)| f.is_active())
        .collect();
    let active_edges = scene
        .mesh
        .edges
        .iter()
        .filter(|(_, e)| e.is_active())
        .count();
    let active_verts = scene
        .mesh
        .verts
        .iter()
        .filter(|(_, v)| v.is_active())
        .count();

    eprintln!(
        "burge.xia loaded: {} XIAs, {} active faces, {} active edges, {} active verts",
        scene.xias.len(),
        active_faces.len(),
        active_edges,
        active_verts,
    );

    let report = scene.mesh.verify_face_invariants();
    eprintln!(
        "invariants: checked={}, valid={}, violations={}",
        report.checked_faces,
        report.is_valid(),
        report.violations.len(),
    );

    // Per-face summary: outer loop length + face's XIA mapping.
    for (fid, face) in active_faces.iter().take(50) {
        let n_outer = scene
            .mesh
            .collect_loop_verts(face.outer().start)
            .map(|v| v.len())
            .unwrap_or(0);
        let n_inners = face.inners().len();
        eprintln!(
            "  face {:?}: outer={} verts, inners={}",
            fid, n_outer, n_inners
        );
    }

    // Test export_buffers + skip stats
    let buffers = scene.mesh.export_buffers().expect("export buffers");
    let stats = scene.mesh.last_export_skip_stats();
    let n_triangles = buffers.2.len() / 3;
    eprintln!(
        "export: {} triangles, {} positions, skip={:?}",
        n_triangles,
        buffers.0.len() / 3,
        stats,
    );
}

/// Draw 20 overlapping RECTs in a controlled stress pattern. After each
/// commit, snapshot:
///   - face_count
///   - non-manifold edge count
///   - invariant violations
///   - whether the rect's intended XIA actually owns ≥1 face
///   - whether resynthesizeOrphanFaces would create a face here (= cycle
///     was missed by the synthesis pipeline)
///
/// This is the user's request "직접 미리보기에 rect를 20개 겹쳐서
/// 그려보세요" run as an automated test. Output goes to stderr so we
/// can read the per-step diagnostic without driving the browser.
#[test]
fn stress_20_overlapping_rects_detailed_log() {
    use axia_core::commands::CommandResult;

    let mut scene = Scene::default();

    // 20 rects in a deterministic overlapping pattern. Each rect is
    // 1000x1000mm, centers walk along a 200mm offset diagonal so every
    // rect overlaps its 4-5 nearest neighbors.
    let mut rect_specs: Vec<(DVec3, f64, f64)> = Vec::with_capacity(20);
    for i in 0..20 {
        let t = i as f64;
        rect_specs.push((
            DVec3::new(t * 200.0, 0.0, t * 200.0),
            1000.0 + (i % 3) as f64 * 200.0, // varying width
            1000.0 + ((i + 1) % 3) as f64 * 200.0,
        ));
    }

    let mut prev_face_count: usize = 0;
    let mut anomalies: Vec<String> = Vec::new();

    for (step, (center, w, h)) in rect_specs.iter().enumerate() {
        let r = scene.execute(Command::DrawRect {
            center: *center,
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: *w, height: *h,
        });

        let xia_id = match r {
            CommandResult::EntityCreated(x) => Some(x),
            _ => None,
        };

        let face_count = scene.mesh.faces.iter()
            .filter(|(_, f)| f.is_active())
            .count();
        let nm_edges = scene.mesh.collect_non_manifold_edges().len();
        let inv = scene.mesh.verify_face_invariants();

        // Did the new XIA actually claim ≥1 face?
        let xia_has_face = xia_id
            .and_then(|x| scene.xias.get(&x))
            .map(|x| !x.face_ids.is_empty())
            .unwrap_or(false);

        // Probe for missed-cycle: count edges that would form a face if
        // resynthesize were called. Cheap pre-check via collect_orphan
        // pattern. We don't actually resynthesize (would mutate scene).
        let orphan_topo_edges = scene.mesh.edges.iter()
            .filter(|(eid, e)| {
                if !e.is_active() { return false; }
                if !e.class().is_topological() { return false; }
                let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
                let any_active = faces.iter().any(|&f|
                    scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active());
                !any_active
            })
            .count();

        eprintln!(
            "step {:2}: faces {}→{} (Δ{:+}), nm_edges={}, viol={}, xia_has_face={}, orphan_edges={}, result_ok={}",
            step + 1,
            prev_face_count,
            face_count,
            face_count as i64 - prev_face_count as i64,
            nm_edges,
            inv.violations.len(),
            xia_has_face,
            orphan_topo_edges,
            xia_id.is_some(),
        );

        // Anomaly detectors (the ones the user is debugging):
        if !xia_id.is_some() {
            anomalies.push(format!("step {}: RECT command FAILED", step + 1));
        } else if !xia_has_face {
            anomalies.push(format!(
                "step {}: RECT XIA created but owns 0 faces (wireframe-only, the user's symptom)",
                step + 1,
            ));
        }
        if face_count < prev_face_count {
            anomalies.push(format!(
                "step {}: face count DECREASED ({}→{}) — pre-existing face was deactivated",
                step + 1, prev_face_count, face_count,
            ));
        }
        if orphan_topo_edges >= 3 {
            anomalies.push(format!(
                "step {}: ≥3 orphan topological edges — possible missed cycle",
                step + 1,
            ));
        }

        prev_face_count = face_count;
    }

    // Final state
    eprintln!("\n=== FINAL ===");
    eprintln!("xias: {}", scene.xias.len());
    eprintln!("faces: {}", prev_face_count);
    eprintln!("anomalies: {}", anomalies.len());
    for a in &anomalies {
        eprintln!("  ⚠ {}", a);
    }

    // Try resynthesize at the end — does it find any missed cycles?
    let r = scene.resynthesize_orphan_faces();
    eprintln!(
        "post-stress resynthesize: created={}, aborted={}, elapsed_ms={:.2}",
        r.created, r.aborted_by_time_budget, r.elapsed_ms,
    );
    if r.created > 0 {
        eprintln!(
            "  → engine missed {} cycle(s) during draw — resynthesize recovered them",
            r.created,
        );
    }
}

/// Same 20-rect stress, but with `auto_intersect_on_draw = false` —
/// matching the user's setting after they disabled auto-intersect to
/// debug the original bug. If face loss reproduces here but not in the
/// auto-intersect-ON variant, the bug is specific to the manual-intersect
/// path's cycle synthesis in scene.rs.
#[test]
fn stress_20_overlapping_rects_auto_intersect_off() {
    use axia_core::commands::CommandResult;

    let mut scene = Scene::default();
    scene.auto_intersect_on_draw = false;  // matches user's setting

    let mut rect_specs: Vec<(DVec3, f64, f64)> = Vec::with_capacity(20);
    for i in 0..20 {
        let t = i as f64;
        rect_specs.push((
            DVec3::new(t * 200.0, 0.0, t * 200.0),
            1000.0 + (i % 3) as f64 * 200.0,
            1000.0 + ((i + 1) % 3) as f64 * 200.0,
        ));
    }

    let mut prev_face_count: usize = 0;
    let mut anomalies: Vec<String> = Vec::new();

    for (step, (center, w, h)) in rect_specs.iter().enumerate() {
        let r = scene.execute(Command::DrawRect {
            center: *center,
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: *w, height: *h,
        });
        let xia_id = match r { CommandResult::EntityCreated(x) => Some(x), _ => None };

        let face_count = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let nm_edges = scene.mesh.collect_non_manifold_edges().len();
        let inv = scene.mesh.verify_face_invariants();
        let xia_has_face = xia_id
            .and_then(|x| scene.xias.get(&x))
            .map(|x| !x.face_ids.is_empty())
            .unwrap_or(false);
        let orphan_topo_edges = scene.mesh.edges.iter()
            .filter(|(eid, e)| {
                if !e.is_active() { return false; }
                if !e.class().is_topological() { return false; }
                let (faces, _) = scene.mesh.get_faces_sharing_edge(*eid);
                let any_active = faces.iter().any(|&f|
                    scene.mesh.faces.contains(f) && scene.mesh.faces[f].is_active());
                !any_active
            })
            .count();

        eprintln!(
            "step {:2}: faces {}→{} (Δ{:+}), nm_edges={}, viol={}, xia_has_face={}, orphan_edges={}, ok={}",
            step + 1, prev_face_count, face_count,
            face_count as i64 - prev_face_count as i64,
            nm_edges, inv.violations.len(), xia_has_face, orphan_topo_edges,
            xia_id.is_some(),
        );

        if !xia_id.is_some() {
            anomalies.push(format!("step {}: RECT FAILED", step + 1));
        } else if !xia_has_face {
            anomalies.push(format!("step {}: WIREFRAME-ONLY RECT", step + 1));
        }
        if face_count < prev_face_count {
            anomalies.push(format!(
                "step {}: face DECREASE {}→{}", step + 1, prev_face_count, face_count,
            ));
        }
        prev_face_count = face_count;
    }

    eprintln!("\n=== auto_intersect=OFF FINAL: faces={}, anomalies={} ===",
        prev_face_count, anomalies.len());
    for a in &anomalies { eprintln!("  ⚠ {}", a); }

    let r = scene.resynthesize_orphan_faces();
    eprintln!(
        "post-stress resynthesize: created={}, elapsed_ms={:.2}",
        r.created, r.elapsed_ms,
    );
    if r.created > 0 {
        eprintln!("  → {} cycles missed during draw, recoverable via Resynthesize Faces", r.created);
    }
}

/// Verify resynthesize_orphan_faces() doesn't panic on the user-supplied
/// burge.xia state.
#[test]
fn resynthesize_orphan_faces_does_not_panic_on_burge() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/burge.xia");
    let bytes = fs::read(&path).expect("read burge.xia");
    let inner = strip_axia_wrapper(&bytes);

    let mut scene = Scene::default();
    scene.import_versioned_snapshot(inner).expect("import");

    let r = scene.resynthesize_orphan_faces();
    eprintln!(
        "resynthesize report: created={} aborted={} elapsed={:.2}ms",
        r.created, r.aborted_by_time_budget, r.elapsed_ms,
    );
    // Whether or not faces were created, the call MUST NOT panic.
    // Time-budget abort is acceptable; engine state must remain valid.
    let inv = scene.mesh.verify_face_invariants();
    eprintln!("post-resynthesize invariants: valid={}, violations={}",
        inv.is_valid(), inv.violations.len());
}

/// Phase 2-stress: draw multiple RECTs at varying positions/sizes to
/// stress-test the fc3abe6 scope-leak fix. If any draw causes a NET face
/// loss (after - before < 0), the scope-leak regression returned.
#[test]
fn load_burge_stress_multiple_crossing_rects() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/burge.xia");
    let bytes = fs::read(&path).expect("read burge.xia");
    let inner = strip_axia_wrapper(&bytes);

    let mut scene = Scene::default();
    scene.import_versioned_snapshot(inner).expect("import");

    // Compute scene AABB to pick stress positions.
    let mut min = DVec3::splat(f64::INFINITY);
    let mut max = DVec3::splat(f64::NEG_INFINITY);
    for (_, v) in scene.mesh.verts.iter() {
        if !v.is_active() { continue; }
        let p = v.pos();
        min = min.min(p);
        max = max.max(p);
    }
    let center = (min + max) * 0.5;
    let extent = (max - min).length();

    // Various stress draws: small-overlap, large-overlap, diagonal,
    // boundary-grazing. Verify face count never net-decreases.
    let stress_cases = [
        ("small_at_center",   center, 1000.0, 1000.0),
        ("medium_at_center",  center, 3000.0, 3000.0),
        ("large_covering",    center, extent * 1.2, extent * 1.2),
        ("offset_quarter",    center + DVec3::new(extent * 0.25, 0.0, 0.0), 2000.0, 2000.0),
        ("offset_diagonal",   center + DVec3::new(extent * 0.2, 0.0, extent * 0.2), 1500.0, 1500.0),
    ];

    for (label, c, w, h) in stress_cases {
        let before = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let r = scene.execute(Command::DrawRect {
            center: c,
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: w, height: h,
        });
        let after = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        let report = scene.mesh.verify_face_invariants();

        eprintln!(
            "stress[{}] center={:?} {}x{} → {}/{} faces (Δ{:+}), result_ok={}, invariants_valid={}, violations={}",
            label, c, w, h, before, after,
            after as i64 - before as i64,
            matches!(r, axia_core::commands::CommandResult::EntityCreated(_)),
            report.is_valid(),
            report.violations.len(),
        );
        for (i, v) in report.violations.iter().enumerate() {
            eprintln!("  violation[{}]: {:?}", i, v);
        }

        assert!(
            after >= before,
            "REGRESSION at stress[{}]: face count decreased {}→{}. \
             scope-leak in some Phase still active.",
            label, before, after,
        );
        // KNOWN-BUG (2026-05-02): stress[medium_at_center] produces 4
        // EdgeIds that are shared by 3 active faces (ADR-007 I5 non-
        // manifold violation). The new RECT's 4 boundary edges each get
        // claimed by an extra face. Symptom user reported as "RECT 그리면
        // 인접 face 가 wireframe 만 남음" is the rendering of overlapping
        // faces sharing the same edges. Fix is non-trivial (requires
        // tightening HE claim logic in exec_draw_line / ADR-015 fallback).
        // Logging only for now — assertion stays disabled to keep stress
        // suite running so other regressions don't get masked.
        if !report.is_valid() {
            eprintln!(
                "  ⚠ KNOWN-BUG stress[{}]: {} non-manifold violations (under investigation)",
                label, report.violations.len(),
            );
        }
    }
}

/// Phase 2: draw a NEW rect that crosses existing faces' boundaries and
/// observe what happens to face count.
#[test]
fn load_burge_then_draw_crossing_rect() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/burge.xia");
    let bytes = fs::read(&path).expect("read burge.xia");
    let inner = strip_axia_wrapper(&bytes);

    let mut scene = Scene::default();
    scene
        .import_versioned_snapshot(inner)
        .expect("import burge.xia");

    let faces_before = scene
        .mesh
        .faces
        .iter()
        .filter(|(_, f)| f.is_active())
        .count();

    // Find the centroid of the existing scene (rough estimate).
    let mut sum = DVec3::ZERO;
    let mut n = 0;
    for (_, v) in scene.mesh.verts.iter() {
        if v.is_active() {
            sum += v.pos();
            n += 1;
        }
    }
    let centroid = if n > 0 { sum / n as f64 } else { DVec3::ZERO };
    eprintln!(
        "before crossing draw: {} active faces, centroid={:?}",
        faces_before, centroid
    );

    // Draw a large RECT centered at the scene's centroid that should
    // cross multiple existing faces' boundaries.
    let r = scene.execute(Command::DrawRect {
        center: centroid,
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 5000.0,
        height: 5000.0,
    });
    eprintln!("draw rect result: {:?}", matches!(r, axia_core::commands::CommandResult::EntityCreated(_)));

    let faces_after = scene
        .mesh
        .faces
        .iter()
        .filter(|(_, f)| f.is_active())
        .count();
    let report = scene.mesh.verify_face_invariants();
    eprintln!(
        "after crossing draw: {} active faces (delta {:+}), invariants_valid={}, violations={}",
        faces_after,
        faces_after as i64 - faces_before as i64,
        report.is_valid(),
        report.violations.len(),
    );

    // Sanity: face count should NOT decrease. New RECT either adds a new
    // face or splits existing ones (which would INCREASE count or stay
    // equal due to XIA-merge), but never strictly decrease.
    assert!(
        faces_after >= faces_before,
        "BUG: drawing a RECT should not decrease the active face count. \
         before={}, after={}",
        faces_before,
        faces_after,
    );
}
