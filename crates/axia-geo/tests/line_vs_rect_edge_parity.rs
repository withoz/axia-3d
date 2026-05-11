//! Edge parity test — LINE 명령과 RECT 명령으로 생성된 edge 가 동일한 flag/속성을 갖는지 검증.
//!
//! 사용자가 "LINE과 RECT의 엣지 성격이 다르다"고 지적. 본 테스트로 topology·
//! flag·class·렌더 판정 결과가 실제로 같은지 점검하고, 차이점이 있다면
//! 정확히 어느 측면인지 로그로 노출.
//!
//! Run: `cargo test --test line_vs_rect_edge_parity -- --nocapture`

use axia_geo::entities::{HeFlags, EdgeClass, MaterialId};
use axia_geo::mesh::Mesh;
use glam::DVec3;

#[test]
fn two_adjacent_rects_share_dcel_edge() {
    // 🔑 Critical test for user's scenario.
    //
    // "삼각형라인그로 그려서 면생성하고 인접면 통합은 되는데, rect로 그려서
    //  인접면 통합은 안됩니다."
    //
    // User reports that TWO RECTs drawn adjacent do NOT share a DCEL edge,
    // so `try_merge_adjacent_faces` can't find them. Verify.
    let mut m = Mesh::new();

    // Rect 1: corner at (0,0,0), size 1000×1000 on XZ plane.
    let (f1, _) = m.draw_rectangle(
        DVec3::new(500.0, 0.0, 500.0),
        DVec3::new(0.0, 1.0, 0.0),   // normal +Y
        DVec3::new(0.0, 0.0, 1.0),   // up = +Z (like DrawRectTool passes plane.up)
        1000.0, 1000.0, MaterialId::new(0),
    ).unwrap();

    // Rect 2: corner at (1000,0,0), same size, ADJACENT to rect 1 along x=1000.
    let (f2, _) = m.draw_rectangle(
        DVec3::new(1500.0, 0.0, 500.0),
        DVec3::new(0.0, 1.0, 0.0),
        DVec3::new(0.0, 0.0, 1.0),
        1000.0, 1000.0, MaterialId::new(0),
    ).unwrap();

    // Dump both face vertex positions for diagnostic.
    let verts1_ids = m.collect_loop_verts(m.faces.get(f1).unwrap().outer().start).unwrap();
    let verts2_ids = m.collect_loop_verts(m.faces.get(f2).unwrap().outer().start).unwrap();
    let v1_pos: Vec<DVec3> = verts1_ids.iter().map(|&v| m.vertex_pos(v).unwrap()).collect();
    let v2_pos: Vec<DVec3> = verts2_ids.iter().map(|&v| m.vertex_pos(v).unwrap()).collect();
    eprintln!("Rect 1 vertices (ids):  {:?}", verts1_ids);
    eprintln!("Rect 1 positions: {:?}", v1_pos);
    eprintln!("Rect 2 vertices (ids):  {:?}", verts2_ids);
    eprintln!("Rect 2 positions: {:?}", v2_pos);

    // Are any of Rect 2's vertex IDs in Rect 1's vertex set?
    let v1_set: std::collections::HashSet<_> = verts1_ids.iter().copied().collect();
    let shared_vids: Vec<_> = verts2_ids.iter().filter(|v| v1_set.contains(v)).copied().collect();
    eprintln!("Shared VertIds between rect1 & rect2: {:?}", shared_vids);

    // Do the two faces share a DCEL edge?
    let shared_edge = m.find_shared_edge_between_faces(f1, f2);
    eprintln!("find_shared_edge_between_faces: {:?}", shared_edge);

    assert!(
        shared_edge.is_some(),
        "🔴 BUG: Two adjacent rects should share a DCEL edge, but don't. \
         This prevents merge. Shared verts: {:?}",
        shared_vids,
    );
}

#[test]
fn line_edge_and_rect_edge_have_equivalent_flags() {
    let mut m1 = Mesh::new();
    // Horizontal line from (0,0,0) to (1000,0,0).
    let (_va, _vb, line_eid) = m1.draw_line(
        DVec3::new(0.0, 0.0, 0.0),
        DVec3::new(1000.0, 0.0, 0.0),
    ).unwrap();
    m1.mark_edge_hard(line_eid);

    let mut m2 = Mesh::new();
    // Rect with a side from (0,0,0) to (1000,0,0).
    let (rect_fid, _verts) = m2.draw_rectangle(
        DVec3::new(500.0, 0.0, 500.0),   // center
        DVec3::new(0.0, 1.0, 0.0),        // normal +Y
        DVec3::new(1.0, 0.0, 0.0),        // up
        1000.0, 1000.0, MaterialId::new(0),
    ).unwrap();
    // mark hard on all 4 boundary edges (as exec_draw_rect does)
    let rect_edges = m2.face_outer_edges(rect_fid).unwrap();
    for &eid in &rect_edges { m2.mark_edge_hard(eid); }

    // Pick one rect edge to compare against the line edge.
    let rect_sample_eid = rect_edges[0];

    // ── 1. Flag comparison ────────────────────────────────────
    let line_edge = m1.edges.get(line_eid).unwrap();
    let rect_edge = m2.edges.get(rect_sample_eid).unwrap();

    // ── Class
    assert_eq!(line_edge.class(), EdgeClass::Geometry,
        "LINE edge class should be Geometry");
    assert_eq!(rect_edge.class(), EdgeClass::Geometry,
        "RECT edge class should be Geometry");

    // ── Active state
    assert!(line_edge.is_active(), "LINE edge must be active");
    assert!(rect_edge.is_active(), "RECT edge must be active");

    // ── Half-edge flags
    let line_he = line_edge.any_he();
    let rect_he = rect_edge.any_he();
    let line_flags = m1.hes[line_he].flags();
    let rect_flags = m2.hes[rect_he].flags();

    eprintln!("LINE edge HE flags: {:?}", line_flags);
    eprintln!("RECT edge HE flags: {:?}", rect_flags);

    assert!(line_flags.contains(HeFlags::HARD),
        "LINE edge should have HARD flag after mark_edge_hard");
    assert!(rect_flags.contains(HeFlags::HARD),
        "RECT edge should have HARD flag after mark_edge_hard");

    // Neither should have SOFT or SOFTEN_COPLANAR initially.
    assert!(!line_flags.contains(HeFlags::SOFT),
        "LINE edge should NOT have SOFT flag initially");
    assert!(!rect_flags.contains(HeFlags::SOFT),
        "RECT edge should NOT have SOFT flag initially");

    // ── Second HE
    let line_he2 = m1.hes[line_he].next_rad();
    let rect_he2 = m2.hes[rect_he].next_rad();
    let line_flags2 = m1.hes[line_he2].flags();
    let rect_flags2 = m2.hes[rect_he2].flags();
    eprintln!("LINE edge HE2 flags: {:?}", line_flags2);
    eprintln!("RECT edge HE2 flags: {:?}", rect_flags2);

    // Both halves should share HARD (mark_edge_hard walks radial chain).
    assert!(line_flags2.contains(HeFlags::HARD));
    assert!(rect_flags2.contains(HeFlags::HARD));
}

#[test]
fn line_and_rect_render_decisions_match_when_isolated() {
    // When rendered in isolation (no neighboring faces), both should draw.
    let mut m1 = Mesh::new();
    let (_, _, line_eid) = m1.draw_line(
        DVec3::new(0.0, 0.0, 0.0),
        DVec3::new(1000.0, 0.0, 0.0),
    ).unwrap();
    m1.mark_edge_hard(line_eid);

    let mut m2 = Mesh::new();
    let (rect_fid, _) = m2.draw_rectangle(
        DVec3::new(500.0, 0.0, 500.0),
        DVec3::new(0.0, 1.0, 0.0),
        DVec3::new(1.0, 0.0, 0.0),
        1000.0, 1000.0, MaterialId::new(0),
    ).unwrap();
    for &eid in &m2.face_outer_edges(rect_fid).unwrap() {
        m2.mark_edge_hard(eid);
    }

    let (line_lines, _) = m1.export_edge_lines_with_map(0.5);
    let (rect_lines, _) = m2.export_edge_lines_with_map(0.5);

    // line_lines should contain 1 segment = 6 floats (p0.x,y,z, p1.x,y,z).
    assert_eq!(line_lines.len(), 6, "LINE should export 1 segment");
    // rect_lines should contain 4 segments = 24 floats.
    assert_eq!(rect_lines.len(), 24, "RECT should export 4 boundary segments");
}

#[test]
fn line_and_rect_edge_same_behavior_under_soft_mark() {
    // After mark_edge_soft, both should be hidden identically.
    let mut m1 = Mesh::new();
    let (_, _, line_eid) = m1.draw_line(
        DVec3::new(0.0, 0.0, 0.0),
        DVec3::new(1000.0, 0.0, 0.0),
    ).unwrap();
    m1.mark_edge_hard(line_eid);
    m1.mark_edge_soft(line_eid);

    let mut m2 = Mesh::new();
    let (rect_fid, _) = m2.draw_rectangle(
        DVec3::new(500.0, 0.0, 500.0),
        DVec3::new(0.0, 1.0, 0.0),
        DVec3::new(1.0, 0.0, 0.0),
        1000.0, 1000.0, MaterialId::new(0),
    ).unwrap();
    let rect_edges = m2.face_outer_edges(rect_fid).unwrap();
    for &eid in &rect_edges { m2.mark_edge_hard(eid); }
    m2.mark_edge_soft(rect_edges[0]);

    // Both should have SOFT + ~HARD now.
    let line_he = m1.edges.get(line_eid).unwrap().any_he();
    let rect_he = m2.edges.get(rect_edges[0]).unwrap().any_he();
    let line_flags = m1.hes[line_he].flags();
    let rect_flags = m2.hes[rect_he].flags();

    assert!(line_flags.contains(HeFlags::SOFT), "LINE: SOFT set after mark_edge_soft");
    assert!(rect_flags.contains(HeFlags::SOFT), "RECT: SOFT set after mark_edge_soft");
    assert!(!line_flags.contains(HeFlags::HARD), "LINE: HARD cleared");
    assert!(!rect_flags.contains(HeFlags::HARD), "RECT: HARD cleared");

    // Render: LINE should export 0 segments, RECT should export 3 (4 - softened).
    let (line_lines, _) = m1.export_edge_lines_with_map(0.5);
    let (rect_lines, _) = m2.export_edge_lines_with_map(0.5);
    assert_eq!(line_lines.len(), 0, "softened LINE should not render");
    assert_eq!(rect_lines.len(), 18,
        "rect: 3 of 4 edges render (one softened). Got {} floats.",
        rect_lines.len());
}
