//! Slice (Plane Cut) — volume splitting tests.
//!
//! Build a closed cube, slice it with various planes, verify that:
//! - Both resulting halves are closed Wall solids
//! - Cap face count matches expected loops
//! - All resulting faces classify as Wall (is_face_in_volume == true)
//! - Cut loops have the right vertex count

use axia_geo::mesh::Mesh;
use axia_geo::MaterialId;
use axia_geo::operations::slice::SlicePlane;
use glam::DVec3;

/// Build a unit cube of side `s` centered at origin. Returns the 6 face ids.
fn make_cube(mesh: &mut Mesh, m: MaterialId, s: f64) -> [axia_geo::FaceId; 6] {
    let h = s * 0.5;
    let v000 = mesh.add_vertex(DVec3::new(-h, -h, -h));
    let v100 = mesh.add_vertex(DVec3::new( h, -h, -h));
    let v110 = mesh.add_vertex(DVec3::new( h,  h, -h));
    let v010 = mesh.add_vertex(DVec3::new(-h,  h, -h));
    let v001 = mesh.add_vertex(DVec3::new(-h, -h,  h));
    let v101 = mesh.add_vertex(DVec3::new( h, -h,  h));
    let v111 = mesh.add_vertex(DVec3::new( h,  h,  h));
    let v011 = mesh.add_vertex(DVec3::new(-h,  h,  h));

    // CCW from outside.
    let bottom = mesh.add_face(&[v000, v010, v110, v100], m).unwrap(); // -Y? actually -Z
    let top    = mesh.add_face(&[v001, v101, v111, v011], m).unwrap();
    let front  = mesh.add_face(&[v000, v100, v101, v001], m).unwrap();
    let back   = mesh.add_face(&[v010, v011, v111, v110], m).unwrap();
    let left   = mesh.add_face(&[v000, v001, v011, v010], m).unwrap();
    let right  = mesh.add_face(&[v100, v110, v111, v101], m).unwrap();

    [bottom, top, front, back, left, right]
}

#[test]
fn slice_cube_horizontally_through_middle() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);

    // Sanity: cube starts as a closed Wall solid.
    let info = mesh.face_set_manifold_info(&faces);
    assert!(info.is_closed_solid, "cube should be closed initially");

    // Cut at z=0 (XY plane).
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let result = mesh.slice_volume_by_plane(&faces, plane, m).expect("slice should succeed");

    // Expectations:
    // - 4 side walls were each crossed → each split into 2 sub-faces → 8 wall sub-faces.
    // - top wall stays as-is in above; bottom wall stays in below.
    // - 1 cut loop, 2 cap faces (above + below).
    assert_eq!(result.cut_loops.len(), 1, "single cut loop expected");
    assert_eq!(result.cut_loops[0].len(), 4, "cut loop should be a quad (4 verts)");
    assert_eq!(result.cap_above.len(), 1);
    assert_eq!(result.cap_below.len(), 1);
    // 4 split walls (above subface) + 1 top  = 5
    assert_eq!(result.above_walls.len(), 5);
    // 4 split walls (below subface) + 1 bottom = 5
    assert_eq!(result.below_walls.len(), 5);

    // Both halves must form closed Wall solids.
    let above_set: Vec<_> = result.above_walls.iter().chain(result.cap_above.iter()).copied().collect();
    let below_set: Vec<_> = result.below_walls.iter().chain(result.cap_below.iter()).copied().collect();
    assert!(mesh.face_set_manifold_info(&above_set).is_closed_solid,
        "above half must be a closed solid");
    assert!(mesh.face_set_manifold_info(&below_set).is_closed_solid,
        "below half must be a closed solid");

    // Every face in both halves must classify as Wall (in volume).
    for &fid in above_set.iter().chain(below_set.iter()) {
        assert!(mesh.is_face_in_volume(fid),
            "face {:?} after slice must be a Wall", fid);
    }
}

#[test]
fn slice_cube_diagonally() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);

    // Tilted plane through origin: normal = normalize(1, 1, 1).
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::new(1.0, 1.0, 1.0)).unwrap();
    let result = mesh.slice_volume_by_plane(&faces, plane, m).expect("diagonal slice ok");

    // Cut loop should be a hexagon (6 verts) for unit cube cut by (1,1,1) plane through origin.
    assert_eq!(result.cut_loops.len(), 1);
    assert_eq!(result.cut_loops[0].len(), 6, "diagonal cut should produce hexagon");
    assert_eq!(result.cap_above.len(), 1);
    assert_eq!(result.cap_below.len(), 1);

    // Verify closure on both halves.
    let above_set: Vec<_> = result.above_walls.iter().chain(result.cap_above.iter()).copied().collect();
    let below_set: Vec<_> = result.below_walls.iter().chain(result.cap_below.iter()).copied().collect();
    assert!(mesh.face_set_manifold_info(&above_set).is_closed_solid);
    assert!(mesh.face_set_manifold_info(&below_set).is_closed_solid);
}

#[test]
fn slice_cube_with_plane_off_center() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);

    // Off-center horizontal cut at z = 200.
    let plane = SlicePlane::new(DVec3::new(0.0, 0.0, 200.0), DVec3::Z).unwrap();
    let result = mesh.slice_volume_by_plane(&faces, plane, m).expect("off-center slice ok");

    assert_eq!(result.cut_loops.len(), 1);
    assert_eq!(result.cut_loops[0].len(), 4);
    assert_eq!(result.above_walls.len(), 5);
    assert_eq!(result.below_walls.len(), 5);

    let above_set: Vec<_> = result.above_walls.iter().chain(result.cap_above.iter()).copied().collect();
    let below_set: Vec<_> = result.below_walls.iter().chain(result.cap_below.iter()).copied().collect();
    assert!(mesh.face_set_manifold_info(&above_set).is_closed_solid);
    assert!(mesh.face_set_manifold_info(&below_set).is_closed_solid);
}

#[test]
fn slice_with_non_intersecting_plane_errors() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);

    // Plane far above the cube — no crossing.
    let plane = SlicePlane::new(DVec3::new(0.0, 0.0, 5000.0), DVec3::Z).unwrap();
    let res = mesh.slice_volume_by_plane(&faces, plane, m);
    assert!(res.is_err(), "non-intersecting plane should error");
}

#[test]
fn slice_with_face_on_plane_errors() {
    // If the plane coincides exactly with the cube's top face, that face
    // sits entirely on the plane → bail.
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);
    // Top is at z = 500.
    let plane = SlicePlane::new(DVec3::new(0.0, 0.0, 500.0), DVec3::Z).unwrap();
    let res = mesh.slice_volume_by_plane(&faces, plane, m);
    assert!(res.is_err(), "face-on-plane case should error in MVP");
}

#[test]
fn slice_rejects_inactive_face() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);
    let _ = mesh.remove_face(faces[0]);
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let res = mesh.slice_volume_by_plane(&faces, plane, m);
    assert!(res.is_err(), "inactive face should error");
}

#[test]
fn slice_global_invariants_must_pass() {
    // ADR-007 I5: every edge must be incident to ≤ 2 active faces.
    // After slicing, the two halves must be topologically independent —
    // no edge should be shared by both above and below halves.
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 1000.0);
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let _ = mesh.slice_volume_by_plane(&faces, plane, m).unwrap();

    let report = mesh.verify_face_invariants();
    assert!(
        report.is_valid(),
        "ADR-007 invariants must hold after slice — violations:\n{}",
        report.summary()
    );
}

#[test]
fn slice_invariants_preserved() {
    // Verify ADR-007 normal cache invariant: after slicing, cached normals
    // match topology (no stale cache).
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let faces = make_cube(&mut mesh, m, 500.0);
    let plane = SlicePlane::new(DVec3::ZERO, DVec3::Z).unwrap();
    let result = mesh.slice_volume_by_plane(&faces, plane, m).unwrap();

    // After reconcile, calling reconcile again should be a no-op.
    let drift = mesh.reconcile_face_normals();
    assert_eq!(drift, 0, "after slice, reconcile should be no-op (drift=0)");

    // Cap face normals must oppose each other.
    let cap_a_normal = mesh.faces[result.cap_above[0]].normal();
    let cap_b_normal = mesh.faces[result.cap_below[0]].normal();
    let dot = cap_a_normal.dot(cap_b_normal);
    assert!(dot < -0.99,
        "cap_above and cap_below normals should be anti-parallel (dot={})", dot);
}
