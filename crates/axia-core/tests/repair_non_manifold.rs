//! Scene-level non-manifold repair — XIA-aware. Two cubes share a face,
//! repair separates them topologically while preserving each XIA's body.

use axia_core::scene::Scene;
use glam::DVec3;

fn build_two_touching_cubes(scene: &mut Scene) -> (axia_core::xia::XiaId, axia_core::xia::XiaId) {
    let mat = axia_core::FORM_MATERIAL;
    // Cube A: x ∈ [0, 1000]
    let a000 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let a100 = scene.mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
    let a110 = scene.mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
    let a010 = scene.mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
    let a001 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
    let a101 = scene.mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
    let a111 = scene.mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
    let a011 = scene.mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
    let af = vec![
        scene.mesh.add_face(&[a000, a010, a110, a100], mat).unwrap(),
        scene.mesh.add_face(&[a001, a101, a111, a011], mat).unwrap(),
        scene.mesh.add_face(&[a000, a100, a101, a001], mat).unwrap(),
        scene.mesh.add_face(&[a010, a011, a111, a110], mat).unwrap(),
        scene.mesh.add_face(&[a000, a001, a011, a010], mat).unwrap(),
        scene.mesh.add_face(&[a100, a110, a111, a101], mat).unwrap(),
    ];
    let xa = scene.create_xia_with_faces("CubeA".into(), DVec3::new(500.0, 500.0, 500.0), af);

    // Cube B: x ∈ [1000, 2000] — reuses A's x=1000 face's verts.
    let b200 = scene.mesh.add_vertex(DVec3::new(2000.0, 0.0, 0.0));
    let b210 = scene.mesh.add_vertex(DVec3::new(2000.0, 1000.0, 0.0));
    let b201 = scene.mesh.add_vertex(DVec3::new(2000.0, 0.0, 1000.0));
    let b211 = scene.mesh.add_vertex(DVec3::new(2000.0, 1000.0, 1000.0));
    let bf = vec![
        scene.mesh.add_face(&[a100, a110, b210, b200], mat).unwrap(),
        scene.mesh.add_face(&[a101, b201, b211, a111], mat).unwrap(),
        scene.mesh.add_face(&[a100, b200, b201, a101], mat).unwrap(),
        scene.mesh.add_face(&[a110, a111, b211, b210], mat).unwrap(),
        scene.mesh.add_face(&[b200, b210, b211, b201], mat).unwrap(),
        scene.mesh.add_face(&[a100, a101, a111, a110], mat).unwrap(),
    ];
    let xb = scene.create_xia_with_faces("CubeB".into(), DVec3::new(1500.0, 500.0, 500.0), bf);
    (xa, xb)
}

#[test]
fn repair_clears_non_manifold_edges_on_two_touching_cubes() {
    let mut scene = Scene::default();
    let (xa, xb) = build_two_touching_cubes(&mut scene);

    // Pre-condition: 4 non-manifold edges (boundary of shared face).
    let bad = scene.mesh.find_non_manifold_edges();
    assert_eq!(bad.len(), 4);
    assert!(!scene.mesh.verify_face_invariants().is_valid());

    let report = scene.repair_non_manifold_edges();
    assert!(report.is_clean(), "repair report: {}", report.summary());
    assert!(report.faces_detached >= 1);

    // Post-condition: zero non-manifold edges, ADR-007 valid.
    let after = scene.mesh.find_non_manifold_edges();
    assert!(after.is_empty(), "{} non-manifold edges remain", after.len());
    let inv = scene.mesh.verify_face_invariants();
    assert!(inv.is_valid(), "ADR-007 still violated:\n{}", inv.summary());

    // XIAs preserved with same face counts (each cube still has 6 faces).
    let xa_count = scene.xias[&xa].face_ids.len();
    let xb_count = scene.xias[&xb].face_ids.len();
    assert_eq!(xa_count, 6, "CubeA face count drifted: {}", xa_count);
    assert_eq!(xb_count, 6, "CubeB face count drifted: {}", xb_count);

    // face_to_xia consistent — every XIA face reverse-maps correctly.
    for &f in &scene.xias[&xa].face_ids {
        assert_eq!(scene.get_xia_for_face(f), Some(xa));
    }
    for &f in &scene.xias[&xb].face_ids {
        assert_eq!(scene.get_xia_for_face(f), Some(xb));
    }
}

#[test]
fn strict_export_auto_repairs_then_succeeds() {
    let mut scene = Scene::default();
    let _ = build_two_touching_cubes(&mut scene);
    // Strict export should silently auto-repair and succeed.
    let bytes = scene.export_versioned_snapshot_strict()
        .expect("strict export should auto-repair non-manifold edges");
    assert!(!bytes.is_empty());
    // After export the scene should be clean.
    assert!(scene.mesh.find_non_manifold_edges().is_empty());
}

#[test]
fn repair_is_noop_on_clean_scene() {
    let mut scene = Scene::default();
    let mat = axia_core::FORM_MATERIAL;
    // Single cube — no non-manifold edges.
    let v0 = scene.mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = scene.mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
    let v2 = scene.mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
    let v3 = scene.mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
    let _ = scene.mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

    let report = scene.repair_non_manifold_edges();
    assert_eq!(report.edges_examined, 0);
    assert_eq!(report.faces_detached, 0);
    assert_eq!(report.vertices_created, 0);
}
