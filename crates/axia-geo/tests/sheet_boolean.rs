//! Tier 4 B-5 — Sheet 2D Boolean tests.
//!
//! Two coplanar Sheet rectangles, perform union/subtract/intersect.

use axia_geo::mesh::Mesh;
use axia_geo::MaterialId;
use glam::DVec3;

fn add_rect(mesh: &mut Mesh, m: MaterialId, x0: f64, y0: f64, x1: f64, y1: f64) -> axia_geo::FaceId {
    let v0 = mesh.add_vertex(DVec3::new(x0, y0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(x1, y0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(x1, y1, 0.0));
    let v3 = mesh.add_vertex(DVec3::new(x0, y1, 0.0));
    mesh.add_face(&[v0, v1, v2, v3], m).unwrap()
}

#[test]
fn sheet_intersect_overlapping_rects() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 1000.0, 1000.0);
    let b = add_rect(&mut mesh, m, 500.0, 500.0, 1500.0, 1500.0);

    let result = mesh.sheet_boolean(a, b, "intersect", m).expect("intersect should succeed");
    assert!(mesh.faces.contains(result));
    assert!(mesh.faces[result].is_active());
    // Both originals should be removed.
    assert!(!mesh.faces.contains(a) || !mesh.faces[a].is_active());
    assert!(!mesh.faces.contains(b) || !mesh.faces[b].is_active());
}

#[test]
fn sheet_union_overlapping_rects() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 1000.0, 1000.0);
    let b = add_rect(&mut mesh, m, 500.0, 500.0, 1500.0, 1500.0);

    let result = mesh.sheet_boolean(a, b, "union", m).expect("union should succeed");
    assert!(mesh.faces.contains(result));
}

#[test]
fn sheet_subtract_overlapping_rects() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 1000.0, 1000.0);
    let b = add_rect(&mut mesh, m, 500.0, 500.0, 1500.0, 1500.0);

    let result = mesh.sheet_boolean(a, b, "subtract", m).expect("subtract should succeed");
    assert!(mesh.faces.contains(result));
}

#[test]
fn sheet_intersect_disjoint_rects_fails() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 100.0, 100.0);
    let b = add_rect(&mut mesh, m, 500.0, 500.0, 600.0, 600.0);

    let result = mesh.sheet_boolean(a, b, "intersect", m);
    assert!(result.is_err(), "disjoint intersect must error");
}

#[test]
fn sheet_boolean_rejects_non_coplanar() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 1000.0, 1000.0);
    // Tilted rect: not coplanar with z=0 plane
    let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
    let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
    let v2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
    let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
    let b = mesh.add_face(&[v0, v1, v2, v3], m).unwrap();

    let result = mesh.sheet_boolean(a, b, "intersect", m);
    assert!(result.is_err(), "non-coplanar must error");
}

#[test]
fn sheet_boolean_unknown_op_errors() {
    let mut mesh = Mesh::new();
    let m = MaterialId::new(0);
    let a = add_rect(&mut mesh, m, 0.0, 0.0, 1000.0, 1000.0);
    let b = add_rect(&mut mesh, m, 500.0, 500.0, 1500.0, 1500.0);

    let result = mesh.sheet_boolean(a, b, "xor", m);
    assert!(result.is_err());
}
