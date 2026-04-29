//! Line — straight segment between two mesh vertices (Phase A).
//!
//! Parametric form: `P(t) = A + (B - A) · t`, with `t ∈ [0, 1]`.
//! `P(0) = A`, `P(1) = B`.

use anyhow::Result;
use glam::DVec3;

use crate::entities::id::VertId;
use crate::mesh::Mesh;

/// Evaluate a line at parameter `t ∈ [0, 1]`.
pub fn evaluate(start: VertId, end: VertId, t: f64, mesh: &Mesh) -> Result<DVec3> {
    let a = mesh.vertex_pos(start)?;
    let b = mesh.vertex_pos(end)?;
    Ok(a + (b - a) * t)
}

/// Tangent vector — constant `B - A`.
/// Note: NOT unit-length (matches NURBS convention where derivative
/// magnitude has meaning for arc-length parameterization).
pub fn derivative(start: VertId, end: VertId, mesh: &Mesh) -> Result<DVec3> {
    let a = mesh.vertex_pos(start)?;
    let b = mesh.vertex_pos(end)?;
    Ok(b - a)
}

/// Tessellate a line — trivially returns `[A, B]`.
pub fn tessellate(start: VertId, end: VertId, mesh: &Mesh) -> Result<Vec<DVec3>> {
    let a = mesh.vertex_pos(start)?;
    let b = mesh.vertex_pos(end)?;
    Ok(vec![a, b])
}

/// Arc length — Euclidean distance.
pub fn arc_length(start: VertId, end: VertId, mesh: &Mesh) -> Result<f64> {
    let a = mesh.vertex_pos(start)?;
    let b = mesh.vertex_pos(end)?;
    Ok((b - a).length())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_line() -> (Mesh, VertId, VertId) {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        (mesh, a, b)
    }

    #[test]
    fn line_evaluate_endpoints() {
        let (mesh, a, b) = setup_line();
        let p0 = evaluate(a, b, 0.0, &mesh).unwrap();
        let p1 = evaluate(a, b, 1.0, &mesh).unwrap();
        assert!((p0 - DVec3::ZERO).length() < 1e-12);
        assert!((p1 - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn line_evaluate_midpoint() {
        let (mesh, a, b) = setup_line();
        let p = evaluate(a, b, 0.5, &mesh).unwrap();
        assert!((p - DVec3::new(5.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn line_evaluate_extrapolation() {
        let (mesh, a, b) = setup_line();
        // t outside [0, 1] → extrapolation (allowed for analytic eval)
        let p = evaluate(a, b, 2.0, &mesh).unwrap();
        assert!((p - DVec3::new(20.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn line_derivative_constant() {
        let (mesh, a, b) = setup_line();
        let d = derivative(a, b, &mesh).unwrap();
        assert!((d - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn line_tessellate_two_points() {
        let (mesh, a, b) = setup_line();
        let pts = tessellate(a, b, &mesh).unwrap();
        assert_eq!(pts.len(), 2);
        assert!((pts[0] - DVec3::ZERO).length() < 1e-12);
        assert!((pts[1] - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-12);
    }

    #[test]
    fn line_arc_length_euclidean() {
        let (mesh, a, b) = setup_line();
        let len = arc_length(a, b, &mesh).unwrap();
        assert!((len - 10.0).abs() < 1e-12);
    }

    #[test]
    fn line_arc_length_diagonal() {
        let mut mesh = Mesh::new();
        let a = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let b = mesh.add_vertex(DVec3::new(3.0, 4.0, 0.0));
        let len = arc_length(a, b, &mesh).unwrap();
        assert!((len - 5.0).abs() < 1e-12);
    }
}
