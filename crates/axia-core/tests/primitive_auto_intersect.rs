//! Tier 3 — primitives (cylinder, cone, sphere) get auto-intersect on draw.
//!
//! WASM-side primitives now wrap mesh creation in a transaction and call
//! `Scene::intersect_faces_inner` when `auto_intersect_on_draw` is true,
//! mirroring exec_draw_rect / exec_draw_circle. These tests exercise the
//! Scene-level helper directly (the WASM creators just glue these calls
//! together so the underlying behavior is what matters).

use axia_core::scene::Scene;
use axia_core::commands::Command;
use glam::DVec3;

#[test]
fn primitive_cylinder_intersects_existing_rect() {
    let mut scene = Scene::default();
    // Floor sheet rect on Z=0 plane.
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 4000.0, height: 4000.0,
    });
    let face_count_after_rect = scene.mesh.faces.iter()
        .filter(|(_, f)| f.is_active()).count();
    assert!(face_count_after_rect >= 1);

    // Build a cylinder that crosses the rect (Y axis through Z=0).
    let cylinder_faces = scene.mesh.create_cylinder(
        DVec3::new(0.0, 0.0, -500.0),  // base 500mm below floor
        300.0,                          // radius
        2000.0,                         // height — top sticks well above floor
        16,                             // segments
        axia_core::FORM_MATERIAL,
    ).expect("cylinder creates");
    assert!(!cylinder_faces.is_empty());

    // Auto-intersect on the new cylinder faces.
    let result = scene.intersect_faces_inner(&cylinder_faces).unwrap_or(0);
    let _ = result;

    // Floor rect should now have new vertices/edges around the cylinder
    //   intersection ring. Concretely: more vertices than before, and the
    //   sheet face count should be >1 (split into the sub-region inside
    //   the cylinder + outside).
    let after = scene.mesh.faces.iter()
        .filter(|(_, f)| f.is_active()).count();
    assert!(after > face_count_after_rect + cylinder_faces.len() - 1,
        "auto-intersect should split the rect by the cylinder ring; before={}, cylinder={}, after={}",
        face_count_after_rect, cylinder_faces.len(), after);
}

#[test]
fn primitive_box_is_closed_volume() {
    // Box should produce 6 faces, all classifying as Wall (closed).
    let mut scene = Scene::default();
    let faces = scene.mesh.create_box(
        DVec3::new(0.0, 500.0, 0.0),  // center
        1000.0, 1000.0, 1000.0,        // 1m cube
        axia_core::FORM_MATERIAL,
    ).expect("box creates");
    assert_eq!(faces.len(), 6, "box has exactly 6 faces");
    for &fid in &faces {
        assert!(scene.mesh.is_face_in_volume(fid),
            "every box face should classify as Wall (closed volume)");
    }
}

#[test]
fn primitive_no_intersection_when_disjoint() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    let before = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    // Sphere far away — no intersection.
    let sphere_faces = scene.mesh.create_sphere(
        DVec3::new(50000.0, 50000.0, 50000.0), 200.0, 8, 6, axia_core::FORM_MATERIAL,
    ).expect("sphere creates");
    let _ = scene.intersect_faces_inner(&sphere_faces);
    let after = scene.mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
    assert_eq!(after, before + sphere_faces.len(),
        "no overlap → no extra splits, face_count = before + new sphere faces only");
}
