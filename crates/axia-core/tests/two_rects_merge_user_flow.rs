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

/// Axiom 7 (ADR-008) + ADR-021 P7: RECT 을 기존 RECT 위에 **겹치게**
/// 그리면 면이 sub-face 로 쪼개져야 한다. Phase B/C 이후로 endpoint-on-edge
/// case 도 처리됨 — split_edge 패스 + ADR-021 component-based promote 로 해결.
#[test]
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

/// Phase E (ADR-008 Axiom 7 확장) — outer rect drawn AFTER inner rect(s).
/// The outer rect completely encloses the inner(s) with NO shared edges.
/// Expected: outer face IS created (overlapping with inner faces), and all
/// inner faces remain intact. Previously this was rejected by the D
/// resolver's "encloses existing face" filter; now allowed when all cycle
/// edges are newly drawn.
#[test]
fn outer_rect_enclosing_inner_rects_creates_overlapping_faces() {
    let mut scene = Scene::default();

    // Two inner rects, non-overlapping, far from each other.
    scene.execute(Command::DrawRect {
        center: DVec3::new(-300.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 200.0,
        height: 200.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(300.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 200.0,
        height: 200.0,
    });
    let inner_faces = scene.mesh.face_count();
    assert_eq!(inner_faces, 2, "two inner rects → 2 faces");

    // Outer rect enclosing both with no shared edges.
    let outer = scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 2000.0,
        height: 1000.0,
    });
    assert!(matches!(outer, CommandResult::EntityCreated(_)),
        "outer rect command must succeed");

    // 3 faces total: 2 inner + 1 outer.
    assert_eq!(scene.mesh.face_count(), 3,
        "outer face must synthesize alongside inner (ADR-008 Axiom 7)");
}

/// ADR-008 B1 — small RECT drawn INSIDE a larger existing face should
/// split into sub-face: inner RECT stays as its own face, the bigger
/// face becomes a ring with the inner cycle as a hole loop.
#[test]
fn inner_rect_inside_bigger_face_creates_subface_with_hole() {
    let mut scene = Scene::default();

    // Big face first — a 1000×1000 rectangle at origin.
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    assert_eq!(scene.mesh.face_count(), 1, "big face → 1 face");

    // Small RECT fully inside.
    let inner = scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 200.0,
        height: 200.0,
    });
    assert!(matches!(inner, CommandResult::EntityCreated(_)),
        "inner rect command succeeds");

    // After B1 promotion: big face stays (as ring with hole) + inner sub-face.
    assert_eq!(scene.mesh.face_count(), 2,
        "B1: 1 outer ring (with hole) + 1 inner sub-face");

    // Find the inner face and verify the other face has one hole.
    let faces: Vec<_> = scene.mesh.faces.iter()
        .filter(|(_, f)| f.is_active())
        .map(|(id, _)| id)
        .collect();
    assert_eq!(faces.len(), 2);
    let mut has_ring = false;
    let mut has_inner = false;
    for fid in faces {
        let face = scene.mesh.faces.get(fid).unwrap();
        let outer_verts = scene.mesh.collect_loop_verts(face.outer().start).unwrap();
        if outer_verts.len() == 4 {
            if !face.inners().is_empty() {
                has_ring = true;
            } else {
                has_inner = true;
            }
        }
    }
    assert!(has_ring, "big face must have become a ring with a hole");
    assert!(has_inner, "inner sub-face must exist on its own");
}

/// ADR-008 Axiom 7 / M1 Mixed-Cycle Split — partial-overlap case.
///
/// Big 1000×1000 RECT at origin. Small 400×200 RECT centered at (400,0,0)
/// spans x∈[200,600], z∈[-100,100] — half inside big, half outside.
///
/// Expected after Step 4.9:
///   • Big gets split by the chain of free edges that crosses it
///     (overlap area 60,000).
///   • Outside portion of small (20,000) is a separate face.
///   • Material of the overlap portion = small RECT's material
///     (new-rect-wins decision).
#[test]
fn partial_overlap_rect_splits_big_face() {
    let mut scene = Scene::default();

    // Big rect
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });
    assert_eq!(scene.mesh.face_count(), 1, "big rect creates 1 face");

    // Small rect, centered off-axis so only half overlaps
    scene.execute(Command::DrawRect {
        center: DVec3::new(400.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 400.0,
        height: 200.0,
    });

    // Expected: big is subdivided into 2 pieces (L-shape outer + 200×300
    //   overlap inner), plus the 100×200 outside portion of small. Total 3
    //   active faces. (mesh.face_count() may include stale slots — count
    //   actives directly.)
    let active = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    assert_eq!(active, 3,
        "partial overlap must split big into 2 + outside portion of small; got {} active faces", active);

    // Verify total area: big (1,000,000) + outside portion (20,000) = 1,020,000
    let mut total_area = 0.0;
    for (_, f) in scene.mesh.faces.iter() {
        if !f.is_active() { continue; }
        let verts = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
        if verts.len() < 3 { continue; }
        let pts: Vec<DVec3> = verts.iter()
            .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
            .collect();
        let mut a = DVec3::ZERO;
        for i in 1..pts.len()-1 {
            a += (pts[i] - pts[0]).cross(pts[i+1] - pts[0]);
        }
        total_area += a.length() * 0.5;
    }
    // Allow rounding tolerance: 1,020,000 ± 1.0
    assert!((total_area - 1_020_000.0).abs() < 1.0,
        "total face area should be 1,020,000 (1M big + 20K outside); got {:.1}", total_area);
}

/// ADR-008 Axiom 7 / M1 — 1-corner-in partial overlap (regression for
/// 2026-04-24 bug where overlap quad was dissolved by 4.55 because the
/// centroid-only containment check misclassified the L-shape wrap).
///
/// Two 2000×1000 rectangles on the XY plane, B shifted by (400,300).
/// Only ONE corner of B lies inside A. Expected: 3 active faces.
#[test]
fn m1_one_corner_in_xy_plane_three_faces() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 2000.0, height: 1000.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(400.0, 300.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 2000.0, height: 1000.0,
    });
    let active = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    assert_eq!(active, 3, "1-corner-in XY must produce 3 faces (A-L + overlap + B-wrap); got {}", active);
}

/// Same as above on XZ plane (normal Y, up Z) — orientation-independence.
#[test]
fn m1_one_corner_in_xz_plane_three_faces() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 2000.0, height: 1000.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(400.0, 0.0, 300.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 2000.0, height: 1000.0,
    });
    let active = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    assert_eq!(active, 3, "1-corner-in XZ must produce 3 faces; got {}", active);
}

/// ADR-008 Axiom 7 / M1 — RECT that crosses a face boundary TWICE and
/// extends through the face's interior. A long skinny RECT drawn across
/// big rect, entering and exiting both at the left and right edges.
#[test]
fn rect_edges_cross_face_boundary_twice() {
    let mut scene = Scene::default();

    // Big 1000×1000 at origin
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0,
        height: 1000.0,
    });

    // Very wide skinny RECT: 2000 wide × 200 tall, centered at origin.
    // Left edge at x=-1000, right edge at x=+1000 — BOTH outside big
    // (which is at x=±500). So the big's left and right boundaries get
    // crossed TWICE by the skinny's horizontal edges at z=±100.
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 2000.0,
        height: 200.0,
    });

    // Expected pieces (all on the same plane):
    //   • Big's area above z=100 (1,000 × 400 = 400,000)
    //   • Big's area below z=-100 (400,000)
    //   • Overlap strip inside big at z∈[-100,100] (1,000 × 200 = 200,000)
    //   • Left wing of skinny outside big (500 × 200 = 100,000)
    //   • Right wing of skinny outside big (500 × 200 = 100,000)
    // Total area = 400,000 + 400,000 + 200,000 + 100,000 + 100,000 = 1,200,000
    // (big's 1,000,000 + skinny's 2,000×200 = 400,000 − overlap 200,000 = 1,200,000)
    let active = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    assert!(active >= 3,
        "crossing-twice layout must produce ≥3 active faces; got {}", active);

    let mut total_area = 0.0;
    for (_, f) in scene.mesh.faces.iter() {
        if !f.is_active() { continue; }
        let verts = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
        if verts.len() < 3 { continue; }
        let pts: Vec<DVec3> = verts.iter()
            .filter_map(|&v| scene.mesh.vertex_pos(v).ok())
            .collect();
        let mut a = DVec3::ZERO;
        for i in 1..pts.len()-1 {
            a += (pts[i] - pts[0]).cross(pts[i+1] - pts[0]);
        }
        total_area += a.length() * 0.5;
    }
    assert!((total_area - 1_200_000.0).abs() < 10.0,
        "expected 1,200,000 (big 1M + skinny 400K − overlap 200K); got {:.1}", total_area);
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
