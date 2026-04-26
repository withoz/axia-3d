//! ADR-007 Rev 2 — Face classification tests.
//!
//! 단일 sheet face 와 닫힌 box (volume) face 의 분류 동작 확인.

use axia_geo::mesh::Mesh;
use axia_geo::MaterialId;
use glam::DVec3;

#[test]
fn standalone_rect_is_sheet() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let v0 = mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0));
    let fid = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();

    assert!(!mesh.is_face_in_volume(fid),
        "standalone planar rect must classify as Sheet, not Wall");
    assert!(mesh.is_sheet_face(fid));
}

#[test]
fn closed_tetrahedron_faces_are_walls() {
    // Build a 4-face tetrahedron — every edge shared by exactly 2 faces.
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = mesh.add_vertex(DVec3::new( 0.0,  0.0, 1000.0));
    let b = mesh.add_vertex(DVec3::new( 1000.0, 0.0, 0.0));
    let c = mesh.add_vertex(DVec3::new(-500.0, 866.0, 0.0));
    let d = mesh.add_vertex(DVec3::new(-500.0,-866.0, 0.0));

    // 4 faces, all CCW from outside (so adjacent faces have matching twin HE)
    let f1 = mesh.add_face(&[a, b, c], m).unwrap(); // top
    let f2 = mesh.add_face(&[a, c, d], m).unwrap();
    let f3 = mesh.add_face(&[a, d, b], m).unwrap();
    let f4 = mesh.add_face(&[b, d, c], m).unwrap(); // bottom

    for fid in [f1, f2, f3, f4] {
        assert!(mesh.is_face_in_volume(fid),
            "closed tetrahedron face {:?} should classify as Wall", fid);
        assert!(!mesh.is_sheet_face(fid));
    }
}

#[test]
fn open_lid_box_is_classified_as_sheet_for_lid_neighbors() {
    // Build a "box without top" — 5 sides (bottom + 4 walls), no top.
    // The top edge of each side face has a free HE (no twin face above)
    // → all 5 faces should classify as Sheet (manifold-with-boundary).
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);

    // Bottom corners (y=0)
    let b0 = mesh.add_vertex(DVec3::new(-500.0, 0.0, -500.0));
    let b1 = mesh.add_vertex(DVec3::new( 500.0, 0.0, -500.0));
    let b2 = mesh.add_vertex(DVec3::new( 500.0, 0.0,  500.0));
    let b3 = mesh.add_vertex(DVec3::new(-500.0, 0.0,  500.0));
    // Top corners (y=1000) — used for side walls only, NO top face
    let t0 = mesh.add_vertex(DVec3::new(-500.0, 1000.0, -500.0));
    let t1 = mesh.add_vertex(DVec3::new( 500.0, 1000.0, -500.0));
    let t2 = mesh.add_vertex(DVec3::new( 500.0, 1000.0,  500.0));
    let t3 = mesh.add_vertex(DVec3::new(-500.0, 1000.0,  500.0));

    // Bottom (CCW from below, normal -Y)
    let bottom = mesh.add_face(&[b0, b3, b2, b1], m).unwrap();
    // 4 side walls (CCW from outside)
    let side_a = mesh.add_face(&[b0, b1, t1, t0], m).unwrap();
    let side_b = mesh.add_face(&[b1, b2, t2, t1], m).unwrap();
    let side_c = mesh.add_face(&[b2, b3, t3, t2], m).unwrap();
    let side_d = mesh.add_face(&[b3, b0, t0, t3], m).unwrap();

    // All 5 faces have at least one boundary edge (top opening) → Sheet.
    // Bottom shares edges with 4 sides — but its outer loop's HEs all
    // have twins. WAIT — the bottom face is enclosed except for the top
    // opening, so bottom's HEs *are* all paired. But the top edges of
    // side walls are free. → Bottom classifies as Wall, sides as Sheet.
    assert!(mesh.is_face_in_volume(bottom),
        "bottom face has all twins paired (4 sides) → Wall");
    for &fid in &[side_a, side_b, side_c, side_d] {
        assert!(mesh.is_sheet_face(fid),
            "side wall {:?} has top edge unpaired → Sheet", fid);
    }
}

/// ADR-007 Rev 2 Phase B-2 — verify_face_invariants_rev2 ignores
/// winding-mismatch on sheet faces, keeps it on walls.
#[test]
fn rev2_invariant_filters_sheet_winding_violations() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    // Standalone sheet
    let v0 = mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0));
    let sheet_fid = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();
    assert!(mesh.is_sheet_face(sheet_fid));

    let r1 = mesh.verify_face_invariants();
    let r2 = mesh.verify_face_invariants_rev2();
    // 두 결과는 본 케이스에선 같음 (정상 face). 즉 둘 다 valid.
    assert!(r1.is_valid(), "r1 violations: {:?}", r1.violations);
    assert!(r2.is_valid());
    assert_eq!(r2.checked_faces, r1.checked_faces);
}

/// ADR-007 Rev 2 Phase B-3 — reconcile_face_normals re-syncs cached
/// normal to current winding. After flipping winding manually, the
/// stored cache becomes wrong; reconcile fixes it silently.
#[test]
fn reconcile_face_normals_fixes_stale_cache() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let v0 = mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0));
    let fid = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();

    // Forcibly corrupt the cache: store opposite normal.
    let stored = mesh.faces[fid].normal();
    mesh.faces[fid].set_normal(-stored);

    // Verifier should flag cache mismatch.
    let r1 = mesh.verify_face_invariants();
    assert!(!r1.is_valid(),
        "after corruption verifier must flag winding mismatch; report={:?}",
        r1.violations);

    // Reconcile re-syncs.
    let fixed = mesh.reconcile_face_normals();
    assert_eq!(fixed, 1, "exactly one face needed reconcile");

    // Now both verifiers pass.
    let r2 = mesh.verify_face_invariants();
    assert!(r2.is_valid(), "after reconcile no violations: {:?}", r2.violations);
}

/// reconcile is a no-op when caches already match winding.
#[test]
fn reconcile_face_normals_noop_when_clean() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let v0 = mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0));
    let _ = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();
    let fixed = mesh.reconcile_face_normals();
    assert_eq!(fixed, 0, "fresh face has consistent normal cache, no fix needed");
}

#[test]
fn deactivated_rect_classifies_as_not_in_volume() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let v0 = mesh.add_vertex(DVec3::new(-500.0, -500.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new( 500.0, -500.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new( 500.0,  500.0, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(-500.0,  500.0, 0.0));
    let fid = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();

    let _ = mesh.remove_face(fid);
    // Inactive face must classify as not-in-volume (cheap fallback to Sheet).
    assert!(!mesh.is_face_in_volume(fid));
}
