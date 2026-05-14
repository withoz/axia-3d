//! AxiA 3D auto-intersect on draw acceptance tests.

use glam::DVec3;
use axia_core::{Command, CommandResult, Scene};

fn extract_entity(r: CommandResult) -> axia_core::xia::XiaId {
    match r {
        CommandResult::EntityCreated(id) => id,
        other => panic!("expected EntityCreated, got {other:?}"),
    }
}

#[test]
fn default_flag_is_enabled() {
    let scene = Scene::new();
    assert!(scene.auto_intersect_on_draw);
}

#[test]
fn small_rect_inside_big_triggers_hole_injection() {
    let mut scene = Scene::new();
    extract_entity(scene.execute(Command::DrawRect {
        center: DVec3::ZERO,
        normal: DVec3::Y,
        up: DVec3::Z,
        width: 10.0,
        height: 10.0,
    }));
    let count_before = scene.mesh.face_count();
    extract_entity(scene.execute(Command::DrawRect {
        center: DVec3::ZERO,
        normal: DVec3::Y,
        up: DVec3::Z,
        width: 2.0,
        height: 2.0,
    }));
    assert_eq!(
        scene.mesh.face_count(),
        count_before + 1,
        "big 재생성 + small → +1"
    );
    let any_holed = scene
        .mesh
        .faces
        .iter()
        .any(|(_, f)| f.is_active() && !f.inners().is_empty());
    assert!(any_holed, "최소 한 face 가 hole 보유");
}

#[test]
fn disabling_flag_skips_intersection() {
    let mut scene = Scene::new();
    scene.auto_intersect_on_draw = false;
    extract_entity(scene.execute(Command::DrawRect {
        center: DVec3::ZERO,
        normal: DVec3::Y,
        up: DVec3::Z,
        width: 10.0,
        height: 10.0,
    }));
    extract_entity(scene.execute(Command::DrawRect {
        center: DVec3::ZERO,
        normal: DVec3::Y,
        up: DVec3::Z,
        width: 2.0,
        height: 2.0,
    }));
    let holed = scene
        .mesh
        .faces
        .iter()
        .filter(|(_, f)| f.is_active() && !f.inners().is_empty())
        .count();
    assert_eq!(holed, 0, "flag=false → skip");
    assert_eq!(scene.mesh.face_count(), 2);
}
