//! End-to-end reproduction of user's workflow:
//!   1. Draw Rect A via Scene::execute(Command::DrawRect)
//!   2. Draw Rect B adjacent via Scene::execute(Command::DrawRect)
//!   3. Expect they share a DCEL edge → standard merge should succeed.
//!
//! If this test passes, the issue is NOT in the engine and must be on
//! the TypeScript/UI side (snap drift, ContextMenu dispatch, etc.).
//! If this test fails, there's a real Rust-level bug.
//!
//! Run: `cargo test --test two_rects_merge_user_flow -- --nocapture`

use axia_core::scene::Scene;
use axia_core::commands::{Command, CommandResult};
use glam::DVec3;

#[test]
fn two_adjacent_rects_share_edge_through_scene_api() {
    let mut scene = Scene::default();

    // Rect A: center (500, 0, 500), 1000×1000 on XZ plane (+Y normal, +Z up).
    let a_result = scene.execute(Command::DrawRect {
        center: DVec3::new(500.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    let xia_a = match a_result {
        CommandResult::EntityCreated(id) => id,
        other => panic!("Rect A draw failed: {:?}", other),
    };

    // Rect B: center (1500, 0, 500) — adjacent along x=1000 line.
    let b_result = scene.execute(Command::DrawRect {
        center: DVec3::new(1500.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    let xia_b = match b_result {
        CommandResult::EntityCreated(id) => id,
        other => panic!("Rect B draw failed: {:?}", other),
    };

    eprintln!("XIA A: {:?}, XIA B: {:?}", xia_a, xia_b);
    eprintln!("Total XIAs: {}", scene.xias.len());
    for (id, xia) in scene.xias.iter() {
        eprintln!("  XIA {}: name={:?} face_ids={:?} standalone_edge={:?}",
                  id, xia.name, xia.face_ids, xia.standalone_edge_id);
    }
    eprintln!("Total faces: {}", scene.mesh.face_count());

    // Collect face IDs.
    let face_a = scene.xias.get(&xia_a).unwrap().face_ids[0];
    let face_b = scene.xias.get(&xia_b).unwrap().face_ids[0];
    eprintln!("Face A: {:?}, Face B: {:?}", face_a, face_b);

    // Mesh diagnostics
    let verts_a = scene.mesh.collect_loop_verts(
        scene.mesh.faces.get(face_a).unwrap().outer().start,
    ).unwrap();
    let verts_b = scene.mesh.collect_loop_verts(
        scene.mesh.faces.get(face_b).unwrap().outer().start,
    ).unwrap();
    eprintln!("Rect A vertex IDs: {:?}", verts_a);
    eprintln!("Rect B vertex IDs: {:?}", verts_b);

    // Shared vertices
    let va_set: std::collections::HashSet<_> = verts_a.iter().copied().collect();
    let shared: Vec<_> = verts_b.iter().filter(|v| va_set.contains(v)).copied().collect();
    eprintln!("Shared vertex IDs: {:?}", shared);

    assert_eq!(shared.len(), 2,
        "🔴 Two adjacent rects should share exactly 2 vertices; got {}", shared.len());

    // Shared DCEL edge
    let shared_edge = scene.mesh.find_shared_edge_between_faces(face_a, face_b);
    eprintln!("Shared DCEL edge: {:?}", shared_edge);
    assert!(shared_edge.is_some(),
        "🔴 Two adjacent rects should share a DCEL edge");

    // Now merge through the standard mesh API (what Ctrl+M does)
    let merge_result = scene.mesh.merge_faces_by_edge_with_tolerance(
        shared_edge.unwrap(), 1.0,
    );
    eprintln!("merge_faces_by_edge result: {:?}", merge_result);
    assert!(merge_result.is_ok(),
        "🔴 Shared-edge merge should succeed, got: {:?}", merge_result.err());

    // Verify the result is one merged face
    let merged_fid = merge_result.unwrap();
    let merged_verts = scene.mesh.collect_loop_verts(
        scene.mesh.faces.get(merged_fid).unwrap().outer().start,
    ).unwrap();
    eprintln!("Merged face vertex count: {}", merged_verts.len());
    assert_eq!(merged_verts.len(), 4,
        "Merged face should be 4-vertex rect (2000×1000), got {}", merged_verts.len());

    eprintln!("✅ Engine-level 2-rect adjacent merge works.");
}

#[test]
fn two_rects_with_snap_drift_fail_standard_merge() {
    // 🔑 Reproduce likely user situation: rect B's corners are CLOSE but NOT
    // EXACTLY matching rect A's corners (by ~50μm, well outside the 1.5μm
    // spatial hash dedup). Standard merge should FAIL.
    let mut scene = Scene::default();

    scene.execute(Command::DrawRect {
        center: DVec3::new(500.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });

    // Slight drift on center: x = 1500 + 0.05mm, z = 500 + 0.03mm.
    // Corners end up drifted: (1000.05, 0.03) instead of (1000, 0), etc.
    scene.execute(Command::DrawRect {
        center: DVec3::new(1500.05, 0.0, 500.03),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });

    let face_a = scene.xias.values().next().map(|x| x.face_ids[0]).unwrap();
    let face_b = scene.xias.values().nth(1).map(|x| x.face_ids[0]).unwrap();

    let shared = scene.mesh.find_shared_edge_between_faces(face_a, face_b);
    eprintln!("With 50μm drift, shared edge: {:?}", shared);

    // Should be None — the 50μm drift breaks spatial-hash dedup.
    assert!(shared.is_none(),
        "50μm drift should prevent edge sharing (current behaviour)");

    // Now test that geometric merge RECOVERS:
    let gm_result = scene.mesh.merge_coplanar_faces_geometric(face_a, face_b, 2.0);
    eprintln!("Geometric merge with drift: {:?}", gm_result);
    assert!(gm_result.is_ok(),
        "🔴 Geometric merge should recover drifted rects, got: {:?}",
        gm_result.err());
    eprintln!("✅ Geometric merge recovers from snap drift.");
}

/// Axiom 2 (RECT == 4 LINE): RECT drawn via DrawRect command must produce
/// the same face count as 4 manually drawn LINEs forming the same rectangle.
#[test]
fn rect_equivalent_to_4_lines() {
    // Via RECT command.
    let mut rect_scene = Scene::default();
    rect_scene.execute(Command::DrawRect {
        center: DVec3::new(500.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });

    // Via 4 separate LINE commands.
    let mut line_scene = Scene::default();
    let corners = [
        DVec3::new(0.0, 0.0, 0.0),
        DVec3::new(0.0, 0.0, 1000.0),
        DVec3::new(1000.0, 0.0, 1000.0),
        DVec3::new(1000.0, 0.0, 0.0),
    ];
    for i in 0..4 {
        line_scene.execute(Command::DrawLine {
            start: corners[i],
            end: corners[(i + 1) % 4],
            surface_normal: None,
        });
    }

    assert_eq!(rect_scene.mesh.face_count(), line_scene.mesh.face_count(),
        "RECT face count must match 4-LINE equivalent");
    assert_eq!(rect_scene.mesh.vert_count(), line_scene.mesh.vert_count(),
        "RECT vert count must match 4-LINE equivalent");
    assert_eq!(rect_scene.mesh.edge_count(), line_scene.mesh.edge_count(),
        "RECT edge count must match 4-LINE equivalent");
}

/// Axiom 7 (future — Phase B/expansion): RECT 을 기존 RECT 위에 **겹치게**
/// 그리면 면이 sub-face 로 쪼개져야 한다. Current LINE pipeline handles this
/// only when the new segment CROSSES existing edges (`find_line_crossings`);
/// endpoint-on-edge cases need an additional split_edge pass that is not yet
/// wired. Marked #[ignore] until Phase B enables it.
#[test]
#[ignore = "Phase B — requires endpoint-on-edge split, not yet implemented"]
fn overlapping_rect_splits_into_subfaces() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(500.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(1000.0, 0.0, 500.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    assert!(scene.mesh.face_count() >= 3,
        "Overlapping rects should split (Axiom 7)");
}

/// Axiom 4 (Q4): 독립 RECT 그리기 → 1 face + 4 edges.
#[test]
fn single_rect_produces_one_face() {
    let mut scene = Scene::default();
    let result = scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 500.0,
    });
    assert!(matches!(result, CommandResult::EntityCreated(_)));
    assert_eq!(scene.mesh.face_count(), 1, "single rect → 1 face");
    // 4 edges, 4 vertices
    assert_eq!(scene.mesh.vert_count(), 4);
    assert_eq!(scene.mesh.edge_count(), 4);
}
