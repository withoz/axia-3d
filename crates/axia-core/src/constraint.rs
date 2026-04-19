//! Constraint Solver Level 2 — persistent constraint graph with local solver.
//!
//! Level 1 (`ConstraintCommands` in TS) applies geometric adjustments once.
//! Level 2 stores constraints in the scene, resolves them automatically after
//! vertex transforms, and persists through save/load + undo/redo.
//!
//! ## Design
//! - Constraints reference entities by **VertId pairs** (edges = 2 verts).
//!   This is more stable than `EdgeId` across edge splits/merges.
//! - Each constraint has a clear **driver / driven** role:
//!   - `refs[0]` = reference (driver)
//!   - `refs[1]` = adjusted (driven)
//!   When a driver vertex moves, the driven entity is re-solved.
//! - Solver is **local per-constraint**, not iterative global.
//!   Multiple interacting constraints may not converge; users get a one-shot
//!   re-application by transform.
//! - Topology changes (vert deletion etc.) detected by `is_ref_valid`:
//!   invalid references cause `active = false`, not outright removal.

use serde::{Deserialize, Serialize};
use glam::DVec3;
use axia_geo::{Mesh, VertId};

/// Stable identifier for a constraint (u32).
pub type ConstraintId = u32;

/// Constraint kind discriminator.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConstraintKind {
    /// Two edges parallel (same direction up to sign).
    Parallel,
    /// Two edges perpendicular in their common plane.
    Perpendicular,
    /// Two edges collinear (parallel + on same infinite line).
    Collinear,
    /// Two vertices at fixed 3D distance.
    Distance,
}

/// Reference to an entity participating in a constraint.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ConstraintRef {
    /// Edge identified by its two endpoint vertices.
    Edge { v_a: VertId, v_b: VertId },
    /// Single vertex.
    Vertex(VertId),
}

impl ConstraintRef {
    /// Return true if all referenced vertices exist in `mesh`.
    pub fn is_valid(&self, mesh: &Mesh) -> bool {
        match self {
            Self::Edge { v_a, v_b } =>
                mesh.verts.contains(*v_a) && mesh.verts.contains(*v_b),
            Self::Vertex(v) => mesh.verts.contains(*v),
        }
    }

    /// Collect the vertices involved (flattened).
    pub fn verts(&self) -> Vec<VertId> {
        match self {
            Self::Edge { v_a, v_b } => vec![*v_a, *v_b],
            Self::Vertex(v) => vec![*v],
        }
    }
}

/// A persistent geometric constraint between two entities.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Constraint {
    pub id: ConstraintId,
    pub kind: ConstraintKind,
    /// refs[0] = driver (reference), refs[1] = driven (adjusted)
    pub refs: Vec<ConstraintRef>,
    /// Target value — currently only used by `Distance`.
    pub value: Option<f64>,
    /// Deactivated constraints are kept in the graph but not solved.
    pub active: bool,
}

/// Container for all constraints in a scene.
/// Keeps ordered list + auto-increment id generator.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConstraintGraph {
    items: Vec<Constraint>,
    next_id: ConstraintId,
}

impl ConstraintGraph {
    pub fn new() -> Self {
        Self { items: Vec::new(), next_id: 1 }
    }

    pub fn add(&mut self, kind: ConstraintKind, refs: Vec<ConstraintRef>, value: Option<f64>) -> ConstraintId {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.items.push(Constraint { id, kind, refs, value, active: true });
        id
    }

    pub fn remove(&mut self, id: ConstraintId) -> bool {
        let pos = self.items.iter().position(|c| c.id == id);
        if let Some(i) = pos { self.items.remove(i); true } else { false }
    }

    pub fn set_active(&mut self, id: ConstraintId, active: bool) -> bool {
        if let Some(c) = self.items.iter_mut().find(|c| c.id == id) {
            c.active = active;
            true
        } else { false }
    }

    pub fn clear(&mut self) { self.items.clear(); self.next_id = 1; }

    pub fn get(&self, id: ConstraintId) -> Option<&Constraint> {
        self.items.iter().find(|c| c.id == id)
    }

    pub fn iter(&self) -> std::slice::Iter<'_, Constraint> { self.items.iter() }
    pub fn len(&self) -> usize { self.items.len() }
    pub fn is_empty(&self) -> bool { self.items.is_empty() }

    /// Constraint references containing `vid` — used to find which constraints
    /// need re-solving when `vid` moves.
    pub fn constraints_touching(&self, vid: VertId) -> Vec<ConstraintId> {
        self.items.iter()
            .filter(|c| c.active && c.refs.iter().any(|r| r.verts().contains(&vid)))
            .map(|c| c.id)
            .collect()
    }

    /// Deactivate any constraint whose refs are invalid (referenced vert deleted).
    pub fn prune_invalid(&mut self, mesh: &Mesh) -> usize {
        let mut count = 0;
        for c in self.items.iter_mut() {
            if c.active && c.refs.iter().any(|r| !r.is_valid(mesh)) {
                c.active = false;
                count += 1;
            }
        }
        count
    }
}

/// Local per-constraint solver — applies geometric adjustment to satisfy the
/// constraint. Returns `true` if anything moved.
///
/// Uses the same math as Level 1 (`ConstraintCommands`) but operates on `Mesh`
/// directly. Driver/driven distinction: `refs[0]` is fixed, `refs[1]` is moved.
pub fn resolve_constraint(mesh: &mut Mesh, c: &Constraint) -> bool {
    if !c.active { return false; }
    if c.refs.iter().any(|r| !r.is_valid(mesh)) { return false; }

    match c.kind {
        ConstraintKind::Parallel | ConstraintKind::Perpendicular | ConstraintKind::Collinear => {
            if c.refs.len() != 2 { return false; }
            let (a_va, a_vb) = match &c.refs[0] {
                ConstraintRef::Edge { v_a, v_b } => (*v_a, *v_b),
                _ => return false,
            };
            let (b_va, b_vb) = match &c.refs[1] {
                ConstraintRef::Edge { v_a, v_b } => (*v_a, *v_b),
                _ => return false,
            };
            resolve_edge_pair(mesh, (a_va, a_vb), (b_va, b_vb), c.kind)
        }
        ConstraintKind::Distance => {
            if c.refs.len() != 2 { return false; }
            let (v_a, v_b) = match (&c.refs[0], &c.refs[1]) {
                (ConstraintRef::Vertex(a), ConstraintRef::Vertex(b)) => (*a, *b),
                _ => return false,
            };
            let target = match c.value {
                Some(d) if d.is_finite() && d > 0.0 => d,
                _ => return false,
            };
            resolve_distance(mesh, v_a, v_b, target)
        }
    }
}

/// Resolve parallel/perpendicular/collinear between edges A (driver) and B (driven).
fn resolve_edge_pair(
    mesh: &mut Mesh,
    (a_va, a_vb): (VertId, VertId),
    (b_va, b_vb): (VertId, VertId),
    kind: ConstraintKind,
) -> bool {
    let pa0 = mesh.vertex_pos(a_va).ok();
    let pa1 = mesh.vertex_pos(a_vb).ok();
    let pb0 = mesh.vertex_pos(b_va).ok();
    let pb1 = mesh.vertex_pos(b_vb).ok();
    let (pa0, pa1, pb0, pb1) = match (pa0, pa1, pb0, pb1) {
        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
        _ => return false,
    };

    let dir_a = (pa1 - pa0).try_normalize().unwrap_or(DVec3::X);
    let dir_b_raw = pb1 - pb0;
    let dir_b = dir_b_raw.try_normalize().unwrap_or(DVec3::X);
    let b_mid = (pb0 + pb1) * 0.5;

    // Compute target direction for edge B
    let target_dir = match kind {
        ConstraintKind::Parallel | ConstraintKind::Collinear => dir_a,
        ConstraintKind::Perpendicular => {
            let plane_normal = dir_a.cross(dir_b);
            if plane_normal.length_squared() < 1e-12 { return false; }
            let plane_n = plane_normal.normalize();
            let mut t = plane_n.cross(dir_a).normalize();
            if t.dot(dir_b) < 0.0 { t = -t; }
            t
        }
        ConstraintKind::Distance => return false,
    };

    // Rotation: dir_b → target_dir around b_mid
    let dot = dir_b.dot(target_dir).clamp(-1.0, 1.0);
    let mut moved = false;
    if (dot - 1.0).abs() > 1e-9 {
        let (axis, angle) = if (dot + 1.0).abs() < 1e-9 {
            // antipodal: pick arbitrary perpendicular axis
            let arbitrary = if dir_b.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
            (dir_b.cross(arbitrary).normalize(), std::f64::consts::PI)
        } else {
            let a = dir_b.cross(target_dir);
            if a.length_squared() < 1e-18 { return false; }
            (a.normalize(), dot.acos())
        };
        let _ = mesh.rotate_verts(&[b_va, b_vb], b_mid, axis, angle);
        moved = true;
    }

    // Collinear: additionally translate B's midpoint onto line A
    if matches!(kind, ConstraintKind::Collinear) {
        let mid_a = (pa0 + pa1) * 0.5;
        // Re-fetch b_mid after potential rotation
        let pb0_new = mesh.vertex_pos(b_va).unwrap_or(pb0);
        let pb1_new = mesh.vertex_pos(b_vb).unwrap_or(pb1);
        let b_mid_new = (pb0_new + pb1_new) * 0.5;
        let delta = b_mid_new - mid_a;
        let proj = dir_a * delta.dot(dir_a);
        let target_mid = mid_a + proj;
        let shift = target_mid - b_mid_new;
        if shift.length_squared() > 1e-18 {
            let _ = mesh.translate_verts(&[b_va, b_vb], shift);
            moved = true;
        }
    }

    moved
}

/// Resolve distance: move v_b along (v_a → v_b) direction to achieve target distance from v_a.
fn resolve_distance(mesh: &mut Mesh, v_a: VertId, v_b: VertId, target: f64) -> bool {
    let pa = match mesh.vertex_pos(v_a) { Ok(p) => p, Err(_) => return false };
    let pb = match mesh.vertex_pos(v_b) { Ok(p) => p, Err(_) => return false };
    let d = pb - pa;
    let len = d.length();
    if len < 1e-9 { return false; } // can't determine direction
    let dir = d / len;
    let new_pb = pa + dir * target;
    let shift = new_pb - pb;
    if shift.length_squared() < 1e-18 { return false; }
    let _ = mesh.translate_verts(&[v_b], shift);
    true
}

/// Resolve every active constraint once.
/// Returns the number of constraints that actually moved anything.
pub fn resolve_all(mesh: &mut Mesh, graph: &ConstraintGraph) -> usize {
    let mut count = 0;
    for c in graph.iter() {
        if resolve_constraint(mesh, c) { count += 1; }
    }
    count
}
