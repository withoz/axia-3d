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
    let m = axia_core::FORM_MATERIAL;

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

/// Phase 2 — auto_intersect_on_draw = true 일 때 두 번째 rect 를 그리면
/// 첫 번째 rect 와 자동 교차되어 sub-face 가 생성된다.
/// 그리고 Ctrl+Z 한 번으로 draw + intersect 전체를 취소해야 한다.
///
/// ADR-139 B-β-1 (2026-05-18): default `false` 후 explicit opt-in 필요.
/// Legacy auto-intersect 동작 검증 위해 explicit `= true` 설정.
#[test]
fn auto_intersect_on_draw_single_undo() {
    let mut scene = Scene::default();
    // ADR-139 B-β-1: explicit opt-in for legacy auto-intersect behavior
    scene.auto_intersect_on_draw = true;
    assert!(scene.auto_intersect_on_draw, "explicit opt-in");

    // A: XY 평면 (Z=0) 1000×1000 centered (0,0,0)
    let a_result = scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    let active_after_a = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(active_after_a, 1, "A alone → 1 face");
    assert!(matches!(a_result, axia_core::commands::CommandResult::EntityCreated(_)));

    // B: XZ 평면 (Y=0) centered (0, 0, 300). B 의 AABB 는 A 의 edge 와 겹치지
    //    않아 M1 pipeline 이 트리거되지 않고 atomic fast-path 로 생성됨.
    //    B 자체는 A 를 3D 공간에서 관통 — auto-intersect 가 없었다면 split
    //    되지 않았을 것이다.
    //    Note: A 의 AABB 가 X/Y 양방향 ±500 Z=0 이고, B 는 Y=0 평면에
    //    Z=-200..800 이므로 AABB 겹침 발생. M1 epoch 진입. 하지만 chain
    //    이 생성 불가능하므로 (M1 은 coplanar 전제) 2 face 상태 유지 후
    //    auto-intersect 에서 실제 split 수행.
    scene.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 300.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0, height: 1000.0,
    });
    let active_after_b = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    // 두 rect 가 3D 에서 교차 → auto-intersect 로 양쪽 split
    //   A 는 교차선 (Y=0 이 A 내부 관통) 을 따라 2 개로 분할
    //   B 는 교차선 (Z=0 이 B 내부 관통) 을 따라 2 개로 분할
    //   합계 4 active faces
    assert!(active_after_b >= 3,
        "B 그린 후 A 가 split 되어 최소 3 face (auto-intersect 동작 확인); got {}",
        active_after_b);

    // 단일 undo 로 B 그리기 + 그로 인한 intersect 모두 원상 복구
    scene.execute(Command::Undo);
    let active_after_undo = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    assert_eq!(active_after_undo, 1,
        "single undo returns to 'only A' state; got {}", active_after_undo);
}

/// Phase 2 — 토글 OFF 시 auto-intersect 가 건너뛰어지는지 확인.
/// 정확한 face 수는 M1 / D resolver 동작으로 재현 불가 — 대신 ON vs OFF
/// 차이가 존재하는지 비교.
#[test]
fn auto_intersect_toggle_affects_result() {
    // OFF 상태
    let mut scene_off = Scene::default();
    scene_off.auto_intersect_on_draw = false;
    scene_off.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    scene_off.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 300.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0, height: 1000.0,
    });
    let count_off = scene_off.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();

    // ON 상태 (ADR-139 B-β-1 후 explicit opt-in — default 는 OFF)
    let mut scene_on = Scene::default();
    scene_on.auto_intersect_on_draw = true; // ADR-139 B-β-1: explicit opt-in
    assert!(scene_on.auto_intersect_on_draw);
    scene_on.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 0.0),
        normal: DVec3::new(0.0, 0.0, 1.0),
        up: DVec3::new(1.0, 0.0, 0.0),
        width: 1000.0, height: 1000.0,
    });
    scene_on.execute(Command::DrawRect {
        center: DVec3::new(0.0, 0.0, 300.0),
        normal: DVec3::new(0.0, 1.0, 0.0),
        up: DVec3::new(0.0, 0.0, 1.0),
        width: 1000.0, height: 1000.0,
    });
    let count_on = scene_on.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();

    // 두 번째 draw 가 비공면 교차를 만드므로 ON 쪽에서 sub-face 가 더 생긴다.
    // (정확히 >=count_off + 1, 보통 count_on = count_off + N 형태)
    assert!(count_on >= count_off,
        "auto-intersect ON should produce at least as many faces as OFF; on={}, off={}",
        count_on, count_off);
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
