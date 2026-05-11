//! ADR-009 Orphan Face Recovery
//!
//! Classifies faces that are active in the mesh but not assigned to any XIA
//! into connected components, and (optionally) creates Recovered XIAs for
//! each component so the semantic layer stays complete.
//!
//! Current user-facing scenarios where orphans appear:
//! - Opening a V1 `.axia` file (format did not serialise XIAs)
//! - Legacy bug residue in long-running sessions
//!
//! All operations preserve mesh topology — recovery is a pure metadata add
//! on the XIA side. Safety guarantees per ADR-009:
//! - face_count unchanged
//! - total face area unchanged (kein geometry mutation)
//! - every recovery wrapped in a single undo frame
//! - invariant failure → auto rollback

use std::collections::{HashMap, HashSet, VecDeque};

use axia_geo::{FaceId, MaterialId};
use glam::DVec3;
use serde::{Deserialize, Serialize};

use crate::scene::Scene;
use crate::xia::XiaId;

/// How a connected orphan component relates to the existing XIAs.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", content = "xias")]
pub enum OrphanCategory {
    /// No DCEL-adjacent face belongs to any XIA.
    C1Pure,
    /// Exactly one XIA adjoins this component.
    C2Neighbor(XiaId),
    /// Two or more distinct XIAs adjoin — user must choose.
    C3Bridge(Vec<XiaId>),
}

/// Description of one connected component of orphan faces.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OrphanComponent {
    /// Index into OrphanReport.components. Stable within one report.
    pub id: usize,
    /// FaceId.raw() values for every face in this component.
    pub faces: Vec<u32>,
    pub face_count: usize,
    pub aabb_min: [f64; 3],
    pub aabb_max: [f64; 3],
    pub centroid: [f64; 3],
    /// Sum of face area — for UX hint.
    pub area_sum: f64,
    pub category: OrphanCategory,
    /// Default name produced by ADR-009 naming rule.
    /// "Recovered-{id} ({face_count})"
    pub suggested_name: String,
}

/// Full classifier output. Produced by `Scene::classify_orphans`. Pure read.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OrphanReport {
    pub components: Vec<OrphanComponent>,
    pub total_orphans: usize,
    pub c1_count: usize,
    pub c2_count: usize,
    pub c3_count: usize,
    /// face_count(mesh) at classification time — for caller sanity check.
    pub face_count_snapshot: usize,
}

/// What the caller wants applied. Mirrors the Smart-Auto policy:
/// auto_c1 / auto_c2 = on by default; c3 must be explicit (pick_for_c3).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RecoveryPlan {
    /// Apply recovery for every C1 component in the report.
    pub apply_c1: bool,
    /// Apply recovery for every C2 component (absorb into the single
    /// neighbour XIA).
    pub apply_c2: bool,
    /// Per-component C3 decisions: `(component_id, target_xia_or_none)`.
    /// None = create new "Recovered" XIA for that C3 component.
    /// Not present = skip that C3 component.
    pub c3_decisions: Vec<(usize, Option<XiaId>)>,
}

/// Summary of what `apply_orphan_recovery` did.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RecoveryResult {
    /// Newly-created XIA ids (for C1 and for C3 decisions that chose "new").
    pub xias_created: Vec<XiaId>,
    /// Faces folded into existing XIAs (C2 path + C3 pick-target).
    pub faces_absorbed: usize,
    /// Faces placed into new Recovered XIAs.
    pub faces_in_new_xias: usize,
    /// face_count before and after — should always match.
    pub face_count_before: usize,
    pub face_count_after: usize,
    /// True iff every face is now assigned to exactly one XIA.
    pub all_faces_owned: bool,
    /// Non-empty on failure. Failure also triggers an auto rollback.
    pub error: Option<String>,
}

impl Scene {
    /// Build an OrphanReport without mutating the scene.
    pub fn classify_orphans(&self) -> OrphanReport {
        let mut report = OrphanReport {
            components: Vec::new(),
            total_orphans: 0,
            c1_count: 0,
            c2_count: 0,
            c3_count: 0,
            face_count_snapshot: self.mesh.face_count(),
        };

        // Collect every active face id (orphan or not) once.
        let mut all_active: Vec<FaceId> = Vec::new();
        for (fid, face) in self.mesh.faces.iter() {
            if face.is_active() {
                all_active.push(fid);
            }
        }

        // BFS to build connected components across ALL active faces.
        // Each component is then classified as C1/C2/C3 based on how many
        // XIAs its members belong to.
        let mut visited: HashSet<FaceId> = HashSet::new();
        let mut comp_id_counter = 0;

        for &seed in &all_active {
            if visited.contains(&seed) { continue; }
            let comp = self.bfs_component(seed, &mut visited);

            // Which XIAs own faces in this component?
            let mut comp_xias: HashSet<XiaId> = HashSet::new();
            let mut comp_orphans: Vec<FaceId> = Vec::new();
            for &f in &comp {
                match self.face_to_xia.get(&f) {
                    Some(&xid) => { comp_xias.insert(xid); }
                    None => { comp_orphans.push(f); }
                }
            }

            if comp_orphans.is_empty() {
                // Component is fully owned → nothing to recover, skip.
                continue;
            }

            // Determine category from the XIA set size.
            let category = match comp_xias.len() {
                0 => OrphanCategory::C1Pure,
                1 => OrphanCategory::C2Neighbor(*comp_xias.iter().next().unwrap()),
                _ => {
                    let mut xias: Vec<XiaId> = comp_xias.into_iter().collect();
                    xias.sort();
                    OrphanCategory::C3Bridge(xias)
                }
            };

            // AABB, centroid, area for the ORPHAN subset (the part we will
            // actually recover).
            let (aabb_min, aabb_max, centroid, area_sum) =
                self.measure_faces(&comp_orphans);

            let component_id = comp_id_counter;
            comp_id_counter += 1;

            let suggested_name = format!(
                "Recovered-{} ({})",
                component_id + 1,
                comp_orphans.len(),
            );

            match category {
                OrphanCategory::C1Pure => report.c1_count += 1,
                OrphanCategory::C2Neighbor(_) => report.c2_count += 1,
                OrphanCategory::C3Bridge(_) => report.c3_count += 1,
            }
            report.total_orphans += comp_orphans.len();

            report.components.push(OrphanComponent {
                id: component_id,
                faces: comp_orphans.iter().map(|f| f.raw()).collect(),
                face_count: comp_orphans.len(),
                aabb_min: aabb_min.to_array(),
                aabb_max: aabb_max.to_array(),
                centroid: centroid.to_array(),
                area_sum,
                category,
                suggested_name,
            });
        }

        report
    }

    /// BFS from `seed` across DCEL radial-edge adjacencies. Marks visited.
    fn bfs_component(
        &self,
        seed: FaceId,
        visited: &mut HashSet<FaceId>,
    ) -> Vec<FaceId> {
        let mut out = Vec::new();
        let mut q: VecDeque<FaceId> = VecDeque::new();
        visited.insert(seed);
        q.push_back(seed);

        while let Some(fid) = q.pop_front() {
            out.push(fid);
            let face = match self.mesh.faces.get(fid) {
                Some(f) if f.is_active() => f,
                _ => continue,
            };
            let start = face.outer().start;
            if start.is_null() { continue; }

            // Walk outer loop HEs; for each, traverse radial ring to find
            // neighbour faces through every shared edge (manifold or not).
            let mut he = start;
            loop {
                let mut rad = self.mesh.hes[he].next_rad();
                while rad != he {
                    let f2 = self.mesh.hes[rad].face();
                    if !f2.is_null() && !visited.contains(&f2)
                        && self.mesh.faces.contains(f2)
                        && self.mesh.faces[f2].is_active()
                    {
                        visited.insert(f2);
                        q.push_back(f2);
                    }
                    rad = self.mesh.hes[rad].next_rad();
                }
                he = self.mesh.hes[he].next();
                if he == start { break; }
            }

            // Inner loops (holes) too — same scan.
            for inner in face.inners() {
                let istart = inner.start;
                if istart.is_null() { continue; }
                let mut ihe = istart;
                loop {
                    let mut rad = self.mesh.hes[ihe].next_rad();
                    while rad != ihe {
                        let f2 = self.mesh.hes[rad].face();
                        if !f2.is_null() && !visited.contains(&f2)
                            && self.mesh.faces.contains(f2)
                            && self.mesh.faces[f2].is_active()
                        {
                            visited.insert(f2);
                            q.push_back(f2);
                        }
                        rad = self.mesh.hes[rad].next_rad();
                    }
                    ihe = self.mesh.hes[ihe].next();
                    if ihe == istart { break; }
                }
            }
        }

        out
    }

    /// Compute AABB, centroid, area sum for a face subset.
    fn measure_faces(&self, faces: &[FaceId]) -> (DVec3, DVec3, DVec3, f64) {
        let mut mn = DVec3::splat(f64::INFINITY);
        let mut mx = DVec3::splat(f64::NEG_INFINITY);
        let mut area_sum = 0.0_f64;

        for &fid in faces {
            let face = match self.mesh.faces.get(fid) {
                Some(f) => f, None => continue,
            };
            let Ok(verts) = self.mesh.collect_loop_verts(face.outer().start) else { continue };
            if verts.is_empty() { continue; }
            let pts: Vec<DVec3> = verts.iter()
                .filter_map(|&v| self.mesh.vertex_pos(v).ok())
                .collect();
            for p in &pts {
                mn = mn.min(*p);
                mx = mx.max(*p);
            }
            if pts.len() >= 3 {
                let mut a_vec = DVec3::ZERO;
                for i in 1..pts.len() - 1 {
                    a_vec += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0]);
                }
                area_sum += a_vec.length() * 0.5;
            }
        }

        let centroid = (mn + mx) * 0.5;
        (mn, mx, centroid, area_sum)
    }

    /// Apply the plan. Transactional — on any invariant failure the whole
    /// thing rolls back and `RecoveryResult.error` is populated.
    pub fn apply_orphan_recovery(&mut self, plan: &RecoveryPlan) -> RecoveryResult {
        let mut result = RecoveryResult::default();
        result.face_count_before = self.mesh.face_count();

        // Re-classify fresh so component ids match exactly what we act on.
        let report = self.classify_orphans();
        let _ = report.components.len(); // avoid unused warn when result has no components

        // Save full snapshot for rollback.
        let before = self.scene_snapshot();

        // Index C3 decisions by component id.
        let c3_map: HashMap<usize, Option<XiaId>> =
            plan.c3_decisions.iter().copied().collect();

        let mut apply_err: Option<String> = None;

        for comp in &report.components {
            let faces: Vec<FaceId> = comp.faces.iter().map(|&r| FaceId::new(r)).collect();

            match &comp.category {
                OrphanCategory::C1Pure if plan.apply_c1 => {
                    let pos = DVec3::from_array(comp.centroid);
                    let xid = self.create_xia_with_faces(
                        comp.suggested_name.clone(),
                        pos,
                        faces.clone(),
                    );
                    result.xias_created.push(xid);
                    result.faces_in_new_xias += faces.len();
                }
                OrphanCategory::C2Neighbor(xia) if plan.apply_c2 => {
                    // Absorb faces into the existing XIA.
                    if self.absorb_faces_into_xia(*xia, &faces) {
                        result.faces_absorbed += faces.len();
                    } else {
                        apply_err = Some(format!(
                            "C2 absorb failed for component {} → XIA {}",
                            comp.id, xia,
                        ));
                        break;
                    }
                }
                OrphanCategory::C3Bridge(_) => {
                    match c3_map.get(&comp.id) {
                        Some(None) => {
                            // User said "create new XIA for this".
                            let pos = DVec3::from_array(comp.centroid);
                            let xid = self.create_xia_with_faces(
                                comp.suggested_name.clone(),
                                pos,
                                faces.clone(),
                            );
                            result.xias_created.push(xid);
                            result.faces_in_new_xias += faces.len();
                        }
                        Some(Some(target_xia)) => {
                            if self.absorb_faces_into_xia(*target_xia, &faces) {
                                result.faces_absorbed += faces.len();
                            } else {
                                apply_err = Some(format!(
                                    "C3 absorb failed for component {} → XIA {}",
                                    comp.id, target_xia,
                                ));
                                break;
                            }
                        }
                        None => { /* user chose to skip this one */ }
                    }
                }
                _ => { /* matching branch disabled by plan flags */ }
            }
        }

        // Post-check — every recovered face must now own a XIA, and face
        // count must match.
        result.face_count_after = self.mesh.face_count();
        result.all_faces_owned =
            self.face_to_xia.len() == result.face_count_after;

        if apply_err.is_none() && result.face_count_after != result.face_count_before {
            apply_err = Some(format!(
                "face_count drift {} → {}",
                result.face_count_before, result.face_count_after,
            ));
        }

        if let Some(e) = apply_err {
            // Rollback.
            self.restore_scene_snapshot(&before);
            result.error = Some(e);
            result.xias_created.clear();
            result.faces_absorbed = 0;
            result.faces_in_new_xias = 0;
            result.face_count_after = self.mesh.face_count();
            result.all_faces_owned =
                self.face_to_xia.len() == result.face_count_after;
        }

        result
    }

    /// Preview mode — runs the plan then restores the pre-plan snapshot.
    /// Returned result reflects what WOULD have happened. Scene is
    /// bit-identical to before the call on success or failure.
    pub fn preview_orphan_recovery(&mut self, plan: &RecoveryPlan) -> RecoveryResult {
        let before = self.scene_snapshot();
        let result = self.apply_orphan_recovery(plan);
        // Always roll back, even on success.
        self.restore_scene_snapshot(&before);
        result
    }

    /// Internal helper — add `faces` to XIA's face_ids and update the
    /// reverse index. Returns false if the target XIA no longer exists.
    fn absorb_faces_into_xia(&mut self, xia_id: XiaId, faces: &[FaceId]) -> bool {
        if !self.xias.contains_key(&xia_id) { return false; }
        if let Some(xia) = self.xias.get_mut(&xia_id) {
            for &f in faces {
                if !xia.face_ids.contains(&f) {
                    xia.face_ids.push(f);
                }
            }
        }
        for &f in faces {
            self.face_to_xia.insert(f, xia_id);
        }
        true
    }
}

// Use MaterialId to silence unused-import warning while we compile against
//   the public API surface (future recovery may want to preserve material).
#[allow(dead_code)]
fn _material_hint(_m: MaterialId) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{Command, CommandResult};

    fn make_rect(scene: &mut Scene, cx: f64, cz: f64) -> XiaId {
        // ADR-087 K-ζ — Use legacy Command::DrawRect (internal-only) so
        // orphan_recovery tests retain their Xia-layer contract.
        let r = scene.execute(Command::DrawRect {
            center: DVec3::new(cx, 0.0, cz),
            normal: DVec3::new(0.0, 1.0, 0.0),
            up: DVec3::new(0.0, 0.0, 1.0),
            width: 400.0, height: 400.0,
        });
        match r {
            CommandResult::EntityCreated(id) => id,
            other => panic!("draw_rect failed: {:?}", other),
        }
    }

    #[test]
    fn classify_empty_scene_returns_empty_report() {
        let scene = Scene::default();
        let report = scene.classify_orphans();
        assert_eq!(report.total_orphans, 0);
        assert_eq!(report.components.len(), 0);
    }

    #[test]
    fn classify_detects_c1_orphan_component() {
        let mut scene = Scene::default();
        let _xia = make_rect(&mut scene, 0.0, 0.0);
        // Forcibly orphan the face by removing the face_to_xia entry.
        let face = scene.mesh.faces.iter()
            .find(|(_, f)| f.is_active())
            .map(|(fid, _)| fid)
            .expect("at least one face");
        scene.face_to_xia.remove(&face);
        if let Some(&xid) = scene.xias.keys().next().cloned().as_ref() {
            if let Some(x) = scene.xias.get_mut(&xid) {
                x.face_ids.retain(|&f| f != face);
            }
        }

        let report = scene.classify_orphans();
        assert_eq!(report.total_orphans, 1);
        assert_eq!(report.c1_count, 1);
        assert_eq!(report.components.len(), 1);
        assert!(matches!(report.components[0].category, OrphanCategory::C1Pure));
    }

    #[test]
    fn apply_c1_recovery_restores_face_ownership() {
        let mut scene = Scene::default();
        let xid = make_rect(&mut scene, 0.0, 0.0);
        // Orphan the rect.
        let faces: Vec<FaceId> = scene.xias.get(&xid).unwrap().face_ids.clone();
        for f in &faces { scene.face_to_xia.remove(f); }
        scene.xias.remove(&xid);

        let fc = scene.mesh.face_count();
        assert!(scene.face_to_xia.len() < fc, "orphan state confirmed");

        let plan = RecoveryPlan { apply_c1: true, apply_c2: true, c3_decisions: vec![] };
        let result = scene.apply_orphan_recovery(&plan);

        assert!(result.error.is_none(), "recovery should succeed: {:?}", result.error);
        assert_eq!(result.face_count_before, fc);
        assert_eq!(result.face_count_after, fc);
        assert!(result.all_faces_owned, "every face must own a XIA");
        assert!(!result.xias_created.is_empty(), "a new XIA should have been created");
    }

    #[test]
    fn preview_leaves_scene_unchanged() {
        let mut scene = Scene::default();
        let xid = make_rect(&mut scene, 0.0, 0.0);
        let faces: Vec<FaceId> = scene.xias.get(&xid).unwrap().face_ids.clone();
        for f in &faces { scene.face_to_xia.remove(f); }
        scene.xias.remove(&xid);

        let snapshot_before = scene.scene_snapshot();
        let plan = RecoveryPlan { apply_c1: true, apply_c2: true, c3_decisions: vec![] };
        let result = scene.preview_orphan_recovery(&plan);

        assert!(result.error.is_none());
        assert!(!result.xias_created.is_empty(), "preview reports as-if-applied");

        let snapshot_after = scene.scene_snapshot();
        assert_eq!(snapshot_before, snapshot_after,
            "preview must roll back to the exact prior state");
    }
}
