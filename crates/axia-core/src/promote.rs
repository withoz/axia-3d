//! ADR-050 Phase 1.A — Shape → Xia Promote API (validation only).
//!
//! v3.2 명제 4 strict 4-condition validation. The full type split
//! (separate `Shape` vs `Xia` Rust types) is deferred to Phase 1.B; this
//! Phase 1.A delivers the validation API on the existing `Xia` type so
//! that the user-facing semantics (재질 부여 트리거 → 4조건 검사 →
//! 승격) work end-to-end while the type rename lands incrementally.
//!
//! 4 conditions (ADR-049 §4 Q1, ADR-050 §2.2):
//!   1. Material — must be a non-default material (caller-supplied).
//!   2. Volume   — Volumetric: enclosed volume > 0 (closed solid).
//!                 Linear:     length > 0 + cross-section area > 0.
//!   3. Watertight — face set forms a closed 2-manifold (or Linear: a
//!                   single non-degenerate edge).
//!   4. Manifold — `verify_face_invariants` reports zero violations on
//!                 the XIA's owned faces (ADR-051 P7 prerequisite).
//!
//! Failure cases produce `PromoteError` so callers can surface diagnostic
//! to UI (Toast / Inspector). On success, the existing Xia is mutated
//! in-place: material assigned + `promoted = true` flag set, preserving
//! all face_ids and other state.
//!
//! Phase 1.B (separate PR) will introduce the `Shape` type and rename
//! call sites — this module is its prerequisite.

use crate::xia::XiaId;
use axia_geo::{EdgeId, FaceId, Mesh, MaterialId};

/// Promotion classification for a XIA candidate (ADR-050 §2.1.2 XiaKind).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum XiaKind {
    /// 3D closed solid with positive enclosed volume.
    Volumetric { volume: f64 },
    /// 1D linear element (standalone edge) with positive length.
    /// `cross_section_area` is currently always 1.0 — Phase 2 will derive
    /// it from material profile metadata.
    Linear { length: f64, cross_section_area: f64 },
}

/// Ordered failure modes for promotion APIs. Order matches §2.2
/// validation sequence (1→2→3→4).
#[derive(Clone, Debug, PartialEq)]
pub enum PromoteError {
    /// XIA id not present in the scene.
    XiaNotFound,
    /// ADR-050 P-2 — Shape id not present in the scene.
    /// (Used by `Scene::promote_shape_to_xia`.)
    ShapeNotFound,
    /// XIA owns no geometry (face_ids empty AND no standalone edge).
    NoGeometry,
    /// Caller-supplied material is the default sentinel (id == 0).
    /// ADR-050 §2.1.2 Q4 — default_material is deprecated.
    InvalidMaterial,
    /// Closed-solid path: enclosed volume ≤ 0 (degenerate or open).
    ZeroVolume,
    /// Linear path: edge length ≤ 0 or cross-section area ≤ 0.
    ZeroDimension,
    /// Volumetric XIA: face set is not a closed 2-manifold (boundary
    /// edges present, or fewer than 4 faces).
    NotWatertight { boundary_edges: usize, face_count: usize },
    /// ADR-007 invariants on owned faces (or globally) report violations.
    /// Bridge to ADR-051 — meaningful only after P7 canonical lands.
    NotManifold { violations: usize },
}

impl std::fmt::Display for PromoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::XiaNotFound => write!(f, "XIA not found"),
            Self::ShapeNotFound => write!(f, "Shape not found"),
            Self::NoGeometry => write!(f, "XIA has no geometry"),
            Self::InvalidMaterial => write!(f, "Material is default (id=0); ADR-050 forbids default_material as a promotion trigger"),
            Self::ZeroVolume => write!(f, "Volumetric XIA has zero or negative enclosed volume"),
            Self::ZeroDimension => write!(f, "Linear XIA has zero or negative length / cross-section"),
            Self::NotWatertight { boundary_edges, face_count } => write!(
                f, "Face set is not watertight: {} boundary edges across {} faces",
                boundary_edges, face_count,
            ),
            Self::NotManifold { violations } => write!(
                f, "Manifold invariants violated: {} edges (run ADR-051 P7 audit)",
                violations,
            ),
        }
    }
}

impl std::error::Error for PromoteError {}

/// ADR-091 D-β — Failure modes for `Scene::demote_xia_to_shape`.
///
/// Reverse of promotion: a Xia is demoted back to a Shape when its
/// material reverts to `FORM_MATERIAL` (the form-layer sentinel).
/// Demotion preserves topology (face_ids unchanged) and restores the
/// original ShapeId when available (Lock-in D-D=b).
#[derive(Clone, Debug, PartialEq)]
pub enum DemoteError {
    /// Xia id not present in the scene.
    XiaNotFound,
    /// Xia's current material is not the form-layer sentinel
    /// (`FORM_MATERIAL`). ADR-091 D-A=a — demotion trigger requires
    /// the user to have already cleared the material.
    MaterialNotFormSentinel,
    /// Restoration of `original_shape_id` would collide with an
    /// already-present Shape (defensive — shouldn't happen in normal
    /// flow because Phase 1 P-2-c preserves the Shape after promote,
    /// but kept as a safety net).
    ShapeIdConflict { existing: crate::ShapeId },
}

impl std::fmt::Display for DemoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::XiaNotFound => write!(f, "XIA not found"),
            Self::MaterialNotFormSentinel => write!(
                f, "Xia material is not the form-layer sentinel \
                    (FORM_MATERIAL); demotion requires the material \
                    to be cleared first"
            ),
            Self::ShapeIdConflict { existing } => write!(
                f, "Restoration of original ShapeId would collide with \
                    an existing Shape ({:?})", existing
            ),
        }
    }
}

impl std::error::Error for DemoteError {}

/// ADR-091 D-β — Successful demotion outcome. The Xia has been removed
/// from `Scene.xias` and a Shape (with the same `face_ids`) is present
/// in `Scene.shapes`. The returned `ShapeId` is either the original
/// (if `original_shape_id` was Some) or a freshly-allocated id.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DemoteOk {
    /// ShapeId of the resulting form-layer citizen.
    pub shape_id: crate::ShapeId,
    /// True iff the original ShapeId was restored (round-trip).
    pub original_id_restored: bool,
}

/// Successful promotion outcome. The XIA's stored material has been
/// updated and (if Phase 1.B has landed) `promoted` flag set.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PromoteOk {
    pub xia_id: XiaId,
    pub kind: XiaKind,
}

/// Compute volume of a face-id set via signed-tetrahedron sum (same
/// formulation as `Mesh::mesh_volume` but scoped). Result is divided by
/// 6 and absolute-valued — caller should pre-check via
/// `is_face_set_closed_solid` to ensure the sum is meaningful.
pub fn face_set_volume(mesh: &Mesh, face_ids: &[axia_geo::FaceId]) -> f64 {
    let mut total = 0.0_f64;
    for &fid in face_ids {
        let Some(face) = mesh.faces.get(fid) else { continue };
        if !face.is_active() { continue; }
        let start = face.outer().start;
        if start.is_null() { continue; }
        let verts = match mesh.collect_loop_verts(start) {
            Ok(v) => v, Err(_) => continue,
        };
        if verts.len() < 3 { continue; }
        let p0 = match mesh.vertex_pos(verts[0]) { Ok(p) => p, Err(_) => continue };
        for i in 1..verts.len() - 1 {
            let pa = match mesh.vertex_pos(verts[i])     { Ok(p) => p, Err(_) => continue };
            let pb = match mesh.vertex_pos(verts[i + 1]) { Ok(p) => p, Err(_) => continue };
            total += p0.dot(pa.cross(pb));
        }
    }
    (total / 6.0).abs()
}

/// Helper: validate the supplied material id is non-default.
pub fn material_is_assigned(material: MaterialId) -> bool {
    material.raw() != 0
}

/// ADR-050 P-2 — Shared 4-condition validation kernel.
///
/// Both `Scene::promote_xia_with_validation` (XiaId path, Phase 1.A)
/// and `Scene::promote_shape_to_xia` (ShapeId path, P-2) reuse this
/// helper. The validation order matches ADR-050 §2.2:
///
/// 1. Geometry exists (face_ids OR standalone_edge)
/// 2. Material non-default (`material_is_assigned`)
/// 3. Kind branch:
///    - Linear (face_ids empty + standalone): length > 0
///    - Volumetric (face_ids non-empty): watertight + volume > 0
/// 4. Mesh-wide manifold invariants OK
///
/// The helper is **side-effect free** — it inspects mesh + face_ids +
/// standalone but does NOT mutate scene / xias / face_to_xia. Callers
/// own the storage mutation on success.
///
/// Returns `XiaKind` on success (Volumetric or Linear with metrics).
pub fn validate_promotion(
    mesh: &Mesh,
    face_ids: &[FaceId],
    standalone: Option<EdgeId>,
    material: MaterialId,
) -> Result<XiaKind, PromoteError> {
    // Condition 0 (precondition): geometry must exist.
    if face_ids.is_empty() && standalone.is_none() {
        return Err(PromoteError::NoGeometry);
    }

    // Condition 1: material non-default (ADR-050 §2.1.2 Q4).
    if !material_is_assigned(material) {
        return Err(PromoteError::InvalidMaterial);
    }

    // Branch: Linear (standalone edge, no faces) vs Volumetric (faces).
    let kind = if face_ids.is_empty() {
        // Linear path
        let eid = standalone.expect("checked above");
        let edge = mesh.edges.get(eid).ok_or(PromoteError::ZeroDimension)?;
        if !edge.is_active() {
            return Err(PromoteError::ZeroDimension);
        }
        let pa = mesh
            .vertex_pos(edge.v_small())
            .map_err(|_| PromoteError::ZeroDimension)?;
        let pb = mesh
            .vertex_pos(edge.v_large())
            .map_err(|_| PromoteError::ZeroDimension)?;
        let length = (pb - pa).length();
        // Phase 2 will derive cross_section from material profile;
        // current MVP uses 1.0 as a sentinel — only `length > 0` is
        // strictly enforced here.
        let cross_section_area = 1.0;
        if length <= 0.0 {
            return Err(PromoteError::ZeroDimension);
        }
        XiaKind::Linear { length, cross_section_area }
    } else {
        // Volumetric path: requires watertight closed solid
        let info = mesh.face_set_manifold_info(face_ids);
        if !info.is_closed_solid {
            return Err(PromoteError::NotWatertight {
                boundary_edges: info.boundary_edge_count,
                face_count: info.face_count,
            });
        }
        // Condition 2: enclosed volume > 0
        let volume = face_set_volume(mesh, face_ids);
        if volume <= 0.0 {
            return Err(PromoteError::ZeroVolume);
        }
        XiaKind::Volumetric { volume }
    };

    // Condition 4: ADR-007 / ADR-051 manifold invariants on the mesh.
    // We check globally — a XIA cannot be "manifold" while the mesh
    // it lives in is broken. Tighter per-XIA scoping is a Phase 2
    // optimization.
    let report = mesh.verify_face_invariants();
    if !report.is_valid() {
        return Err(PromoteError::NotManifold {
            violations: report.violations.len(),
        });
    }

    Ok(kind)
}
