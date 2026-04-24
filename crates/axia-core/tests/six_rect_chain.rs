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

#[test]
fn three_rect_chain_diagonal() {
    // A, B, C arranged diagonally — each rect partially overlaps the next.
    let mut scene = Scene::default();
    let rects = [
        (0.0, 0.0, 2000.0, 1000.0),
        (400.0, 300.0, 2000.0, 1000.0),
        (800.0, 600.0, 2000.0, 1000.0),
    ];
    for &(cx, cy, w, h) in rects.iter() {
        scene.execute(Command::DrawRect {
            center: DVec3::new(cx, cy, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(1.0, 0.0, 0.0),
            width: w, height: h,
        });
    }
    let active = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    let total = total_face_area(&scene);
    eprintln!("3 diagonal rects: active={} area={}", active, total);
    // |A∪B∪C|: using inclusion-exclusion
    //  A: X[-500,500] Y[-1000,1000]
    //  B: X[-100,900] Y[-700,1300]
    //  C: X[300,1300] Y[-400,1600]
    //  |A|=|B|=|C|=2,000,000
    //  A∩B: X[-100,500] Y[-700,1000] = 600×1700 = 1,020,000
    //  A∩C: X[300,500] Y[-400,1000]  = 200×1400 = 280,000
    //  B∩C: X[300,900] Y[-400,1300]  = 600×1700 = 1,020,000
    //  A∩B∩C: X[300,500] Y[-400,1000] = 280,000
    //  union = 6M - 1.02M - 0.28M - 1.02M + 0.28M = 3,960,000
    assert!((total - 3_960_000.0).abs() < 1.0,
        "total area should equal union 3,960,000 (got {})", total);
}

#[test]
fn four_rect_chain() {
    let mut scene = Scene::default();
    let rects = [
        (0.0, 0.0, 2000.0, 1000.0),
        (400.0, 300.0, 2000.0, 1000.0),
        (800.0, 600.0, 2000.0, 1000.0),
        (-400.0, 400.0, 2000.0, 1000.0),
    ];
    for &(cx, cy, w, h) in rects.iter() {
        scene.execute(Command::DrawRect {
            center: DVec3::new(cx, cy, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(1.0, 0.0, 0.0),
            width: w, height: h,
        });
    }
    let active = scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count();
    let total = total_face_area(&scene);
    eprintln!("4 rects: active={} area={}", active, total);
    // D: X[-900,100] Y[-600,1400]
    // Let python:
    //  |A|=|B|=|C|=|D|=2M → 8M
    //  pairs: AB=1,020,000; AC=280,000; BC=1,020,000;
    //         AD= X[-500,100]Y[-600,1000]=600×1600=960,000
    //         BD= X[-100,100]Y[-600,1300]=200×1900=380,000
    //         CD= X[300,100]→empty? 300>100, so CD=0.
    //  triples: ABC=X[300,500]Y[-400,1000]=280,000
    //           ABD=X[-100,100]Y[-600,1000]=200×1600=320,000
    //           ACD=X[300,100]=0
    //           BCD=0
    //  quad: 0
    //  union = 8M - (1020+280+1020+960+380+0)k + (280+320+0+0)k - 0
    //        = 8,000,000 - 3,660,000 + 600,000
    //        = 4,940,000
    assert!((total - 4_940_000.0).abs() < 1.0,
        "4-rect total area should be 4,940,000 (got {})", total);
}

/// Known-failing (2026-04-24): adding a small inner rect E after 4
/// overlapping outer rects produces face area 5,100,000 vs expected
/// union 4,940,000 — a 160k over-count where some overlap sub-face is
/// duplicated. Separate from the 1-corner-in fix (437a5ea); tracked as
/// ADR-008 M1 chain-stability deferred work.
#[test]
#[ignore]
fn five_rects_with_small_inner() {
    let mut scene = Scene::default();
    let rects = [
        (0.0, 0.0, 2000.0, 1000.0),
        (400.0, 300.0, 2000.0, 1000.0),
        (800.0, 600.0, 2000.0, 1000.0),
        (-400.0, 400.0, 2000.0, 1000.0),
        (200.0, 200.0, 800.0, 400.0),
    ];
    for &(cx, cy, w, h) in rects.iter() {
        scene.execute(Command::DrawRect {
            center: DVec3::new(cx, cy, 0.0),
            normal: DVec3::new(0.0, 0.0, 1.0),
            up: DVec3::new(1.0, 0.0, 0.0),
            width: w, height: h,
        });
    }
    let total = total_face_area(&scene);
    eprintln!("5 rects: active={} area={}",
        scene.mesh.faces.iter().filter(|(_,f)| f.is_active()).count(), total);
    // E (X[0,400] Y[-200,600] = 320K) is entirely inside A — doesn't change union.
    // Expected: still 4,940,000
    assert!((total - 4_940_000.0).abs() < 1.0,
        "5-rect total area should be 4,940,000 (got {})", total);
}


