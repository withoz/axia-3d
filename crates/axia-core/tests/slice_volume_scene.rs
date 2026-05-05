//! Scene-level Slice (Plane Cut) integration test — verifies XIA
//! ownership transitions: original XIA keeps the above half, new XIA
//! is created for the below half.

use axia_core::scene::Scene;
use axia_geo::operations::slice::SlicePlane;
use glam::DVec3;

fn build_cube_scene() -> (Scene, axia_core::xia::XiaId) {
    let mut scene = Scene::default();
    let mat = axia_core::FORM_MATERIAL;
    let h = 500.0;
    let v000 = scene.mesh.add_vertex(DVec3::new(-h, -h, -h));
    let v100 = scene.mesh.add_vertex(DVec3::new( h, -h, -h));
    let v110 = scene.mesh.add_vertex(DVec3::new( h,  h, -h));
    let v010 = scene.mesh.add_vertex(DVec3::new(-h,  h, -h));
    let v001 = scene.mesh.add_vertex(DVec3::new(-h, -h,  h));
    let v101 = scene.mesh.add_vertex(DVec3::new( h, -h,  h));
    let v111 = scene.mesh.add_vertex(DVec3::new( h,  h,  h));
    let v011 = scene.mesh.add_vertex(DVec3::new(-h,  h,  h));

    let bottom = scene.mesh.add_face(&[v000, v010, v110, v100], mat).unwrap();
    let top    = scene.mesh.add_face(&[v001, v101, v111, v011], mat).unwrap();
    let front  = scene.mesh.add_face(&[v000, v100, v101, v001], mat).unwrap();
    let back   = scene.mesh.add_face(&[v010, v011, v111, v110], mat).unwrap();
    let left   = scene.mesh.add_face(&[v000, v001, v011, v010], mat).unwrap();
    let right  = scene.mesh.add_face(&[v100, v110, v111, v101], mat).unwrap();

    let face_ids = vec![bottom, top, front, back, left, right];
    let xia_id = scene.create_xia_with_faces("Cube".to_string(), DVec3::ZERO, face_ids);
    (scene, xia_id)
}

#[test]
fn scene_slice_creates_two_xias() {
    let (mut scene, original_xia) = build_cube_scene();
    let face_ids: Vec<_> = scene.xias[&original_xia].face_ids.clone();

    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let new_xia = scene.slice_volume_by_plane(&face_ids, plane).expect("slice succeeds");

    // Two XIAs now: original (above) + new (below).
    assert_ne!(original_xia, new_xia);
    let above = scene.xias.get(&original_xia).expect("original survives");
    let below = scene.xias.get(&new_xia).expect("new xia exists");

    // Each half: 5 wall sub-faces + 1 cap = 6 faces.
    assert_eq!(above.face_ids.len(), 6, "above XIA should have 6 faces");
    assert_eq!(below.face_ids.len(), 6, "below XIA should have 6 faces");

    // Naming.
    assert_eq!(below.name, "Cube_below");

    // No face_to_xia drift: every face in either XIA must reverse-map back.
    for &f in &above.face_ids {
        assert_eq!(scene.get_xia_for_face(f).as_ref(), Some(&original_xia));
    }
    for &f in &below.face_ids {
        assert_eq!(scene.get_xia_for_face(f).as_ref(), Some(&new_xia));
    }
    // Above and below disjoint.
    let above_set: std::collections::HashSet<_> = above.face_ids.iter().copied().collect();
    let below_set: std::collections::HashSet<_> = below.face_ids.iter().copied().collect();
    assert!(above_set.is_disjoint(&below_set), "halves must be disjoint");
}

#[test]
fn scene_slice_supports_undo() {
    let (mut scene, original_xia) = build_cube_scene();
    let face_ids: Vec<_> = scene.xias[&original_xia].face_ids.clone();
    let face_count_before = scene.mesh.face_count();
    let xia_count_before = scene.xias.len();

    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let _ = scene.slice_volume_by_plane(&face_ids, plane).expect("slice ok");

    // Undo via Scene API (mirrors exec path).
    let undone = scene.execute(axia_core::commands::Command::Undo);
    matches!(undone, axia_core::commands::CommandResult::MeshUpdated);

    // After undo, scene should be restored to original face/XIA count.
    assert_eq!(scene.xias.len(), xia_count_before, "undo restores XIA count");
    let face_count_after_undo = scene.mesh.face_count();
    assert_eq!(face_count_after_undo, face_count_before, "undo restores face count");
}

#[test]
fn scene_slice_rejects_multi_xia_input() {
    let (mut scene, _xia_a) = build_cube_scene();
    // Add a second cube as a separate XIA.
    let mat = axia_core::FORM_MATERIAL;
    let cy = 2000.0;
    let v0 = scene.mesh.add_vertex(DVec3::new(0.0, cy, 0.0));
    let v1 = scene.mesh.add_vertex(DVec3::new(100.0, cy, 0.0));
    let v2 = scene.mesh.add_vertex(DVec3::new(100.0, cy + 100.0, 0.0));
    let v3 = scene.mesh.add_vertex(DVec3::new(0.0, cy + 100.0, 0.0));
    let f_other = scene.mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
    let _xia_b = scene.create_xia_with_faces("OtherSheet".into(), DVec3::ZERO, vec![f_other]);

    // Mix faces from both XIAs — must error.
    let mut mixed: Vec<_> = scene.xias.values().next().unwrap().face_ids.clone();
    mixed.push(f_other);
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let res = scene.slice_volume_by_plane(&mixed, plane);
    assert!(res.is_err(), "mixed-XIA input must error");
}
