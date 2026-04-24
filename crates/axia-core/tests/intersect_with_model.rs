//! Phase 1 — "Intersect with Model" tests.
//!
//! 선택된 face 와 씬의 나머지 face 사이의 3D 교차선을 edge 로 생성하는지
//! 확인한다. 분류(inside/outside) 는 하지 않음 — 모든 sub-face 유지.

use axia_core::scene::Scene;
use axia_core::commands::Command;
use glam::DVec3;

fn total_face_area(scene: &Scene) -> f64 {
    let mut total = 0.0_f64;
    for (_, f) in scene.mesh.faces.iter() {
        if !f.is_active() { continue; }
        let verts = scene.mesh.collect_loop_verts(f.outer().start).unwrap_or_default();
        let pts: Vec<DVec3> = verts.iter().filter_map(|&v| scene.mesh.vertex_pos(v).ok()).collect();
        if pts.len() < 3 { continue; }
        let mut a = DVec3::ZERO;
        for i in 1..pts.len()-1 {
            a += (pts[i] - pts[0]).cross(pts[i+1] - pts[0]);
        }
        total += a.length() * 0.5;
    }
    total
}

/// 3D 비공면 교차 — 수평 사각형과 수직 사각형이 교차.
/// 교차선을 따라 양 face 가 split 되어야 함.
///
/// draw_rect 의 M1 post-process 가 두 rect 를 건드리지 않도록 Mesh::add_face
/// 로 직접 2 개 face 를 만든 후 intersect_faces_with_scene 호출.
#[test]
fn two_rects_cross_in_3d_split_both() {
    let mut scene = Scene::default();
    let m = scene.default_material;

    // A: XY 평면 (Z=0) 1000×1000 centered (0,0,0)
    let a = [
        scene.mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0)),
        scene.mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0)),
        scene.mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0)),
        scene.mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0)),
    ];
    scene.mesh.add_face(&a, m).unwrap();

    // B: XZ 평면 (Y=0) 600×400 centered (0,0,100) — A 를 X=-300..300, Y=0, Z=0 에서 관통
    let b = [
        scene.mesh.add_vertex(DVec3::new(-300.0, 0.0, -100.0)),
        scene.mesh.add_vertex(DVec3::new( 300.0, 0.0, -100.0)),
        scene.mesh.add_vertex(DVec3::new( 300.0, 0.0,  300.0)),
        scene.mesh.add_vertex(DVec3::new(-300.0, 0.0,  300.0)),
    ];
    scene.mesh.add_face(&b, m).unwrap();

    let before = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(before, 2, "pre-intersect: should have 2 faces (non-coplanar)");

    let selected: Vec<_> = scene.mesh.faces.iter()
        .filter(|(_,f)| f.is_active())
        .map(|(id,_)| id)
        .take(1)
        .collect();
    scene.intersect_faces_with_scene(&selected).unwrap();

    let after = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert!(after >= 3,
        "after intersect: at least one face must be split; got {}", after);

    // 면적 보존: A (1,000,000) + B (240,000) = 1,240,000
    let area = total_face_area(&scene);
    assert!((area - 1_240_000.0).abs() < 10.0,
        "area preserved after intersect-split; got {}", area);
}

/// Coplanar 선택 (같은 평면 위 2 rect) — 교차 = boundary 겹침.
/// `intersect_faces_with_model` 는 coplanar 도 detect_coplanar_faces 를 타지
/// 않고 tri-tri 로만 검사. Coplanar tri-tri 는 segment 로 reduce 되므로
/// 경계 겹침은 split 되지 않는 것이 기대 동작. (Coplanar 분할은 M1 이 담당.)
#[test]
fn coplanar_rects_no_extra_split_from_intersect() {
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
    // 이미 M1 이 coplanar partial overlap 을 3 face 로 분할.
    let before = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(before, 3);
    let area_before = total_face_area(&scene);

    // Intersect 호출 — coplanar 는 추가 split 생성하지 않아야 함.
    let selected: Vec<_> = scene.mesh.faces.iter()
        .filter(|(_,f)| f.is_active())
        .map(|(id,_)| id)
        .collect();
    scene.intersect_faces_with_scene(&selected).unwrap();

    let after = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(after, before, "coplanar: no extra split from intersect; got {} → {}", before, after);
    let area_after = total_face_area(&scene);
    assert!((area_before - area_after).abs() < 1.0,
        "area should be preserved; {} → {}", area_before, area_after);
}

/// 교차 없음 (서로 멀리 떨어진 face) — 변화 없음.
#[test]
fn no_intersection_no_change() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(10000.0, 10000.0, 10000.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 500.0, height: 500.0,
    });
    let before = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    let selected: Vec<_> = scene.mesh.faces.iter()
        .filter(|(_,f)| f.is_active())
        .map(|(id,_)| id)
        .take(1)
        .collect();
    scene.intersect_faces_with_scene(&selected).unwrap();
    let after = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(before, after, "no intersection → no change");
}

/// Undo 검증 — intersect 후 Ctrl+Z 로 원상 복구.
#[test]
fn intersect_undo_restores_scene() {
    let mut scene = Scene::default();
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0, height: 1000.0,
    });
    let before = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    let selected: Vec<_> = scene.mesh.faces.iter()
        .filter(|(_,f)| f.is_active())
        .map(|(id,_)| id)
        .take(1)
        .collect();
    scene.intersect_faces_with_scene(&selected).unwrap();
    let mid = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert!(mid > before, "intersect must split faces; {} → {}", before, mid);

    scene.execute(Command::Undo);
    let after = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(after, before,
        "undo restores original face count; {} (pre) → {} (post-intersect) → {} (undo)",
        before, mid, after);
}
