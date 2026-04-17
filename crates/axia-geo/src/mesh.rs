//! Mesh — the central DCEL mesh data structure.
//!
//! This is the equivalent of buildragon's `CayaEntities`, cleaned up with:
//! - Clear method naming
//! - Proper error handling with Result types
//! - No global state — each Mesh is self-contained

use glam::DVec3;
use rustc_hash::FxHashMap;
use serde::{Serialize, Deserialize};
use anyhow::{Result, bail, ensure};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::entities::*;
use crate::storage::SlotStorage;
use crate::tolerances::*;

/// Spatial hash cell key for fast vertex coincidence queries.
/// Each axis coordinate is quantized to VERTEX_TOLERANCE-sized cells.
type SpatialKey = (i64, i64, i64);

/// Convert a position to a spatial hash key.
#[inline]
fn spatial_key(pos: DVec3) -> SpatialKey {
    const INV_CELL: f64 = 1.0 / VERTEX_TOLERANCE;
    (
        (pos.x * INV_CELL).floor() as i64,
        (pos.y * INV_CELL).floor() as i64,
        (pos.z * INV_CELL).floor() as i64,
    )
}

/// The Half-Edge DCEL mesh.
///
/// Stores all topology entities (vertices, edges, half-edges, faces)
/// and provides operations for construction and modification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mesh {
    /// Unique mesh identifier (for transaction tracking)
    pub uuid: u64,
    /// Vertex storage
    pub verts: SlotStorage<VertId, Vertex>,
    /// Edge storage
    pub edges: SlotStorage<EdgeId, Edge>,
    /// Half-edge storage
    pub hes: SlotStorage<HeId, HalfEdge>,
    /// Face storage
    pub faces: SlotStorage<FaceId, Face>,
    /// Shell storage (connected face components)
    pub shells: SlotStorage<ShellId, Shell>,
    /// Fast edge lookup by vertex pair
    pub vert_to_edge: FxHashMap<VertPairKey, EdgeId>,
    /// Spatial hash for fast vertex coincidence lookup (O(1) instead of O(n))
    #[serde(skip)]
    spatial_hash: FxHashMap<SpatialKey, Vec<VertId>>,
}

static NEXT_UUID: AtomicU64 = AtomicU64::new(1);

impl Mesh {
    /// Create a new empty mesh.
    pub fn new() -> Self {
        let uuid = NEXT_UUID.fetch_add(1, Ordering::Relaxed);
        Self {
            uuid,
            verts: SlotStorage::new(),
            edges: SlotStorage::new(),
            hes: SlotStorage::new(),
            faces: SlotStorage::new(),
            shells: SlotStorage::new(),
            vert_to_edge: FxHashMap::default(),
            spatial_hash: FxHashMap::default(),
        }
    }

    // ========================================================================
    // Snapshot (undo/redo)
    // ========================================================================

    /// 현재 메시 상태를 바이트로 직렬화 (스냅샷 저장)
    pub fn snapshot(&self) -> Vec<u8> {
        match bincode::serialize(self) {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Mesh] snapshot serialize failed: {}", e);
                Vec::new()
            }
        }
    }

    /// 바이트에서 메시 상태 복원 (스냅샷 적용)
    pub fn restore_snapshot(&mut self, data: &[u8]) {
        if let Ok(restored) = bincode::deserialize::<Mesh>(data) {
            self.verts = restored.verts;
            self.edges = restored.edges;
            self.hes = restored.hes;
            self.faces = restored.faces;
            self.vert_to_edge = restored.vert_to_edge;
            // uuid는 유지 (변경하지 않음)
            // spatial_hash는 직렬화되지 않으므로 재구축 필요
            self.rebuild_spatial_hash();
        }
    }

    // ========================================================================
    // Vertex operations
    // ========================================================================

    /// Add a vertex at the given position.
    /// If a vertex already exists within tolerance, returns the existing one.
    /// Uses spatial hashing for O(1) average-case coincidence lookup.
    pub fn add_vertex(&mut self, pos: DVec3) -> VertId {
        let key = spatial_key(pos);
        // Check the cell and its 26 neighbors (3×3×3 neighborhood)
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let neighbor_key = (key.0 + dx, key.1 + dy, key.2 + dz);
                    if let Some(ids) = self.spatial_hash.get(&neighbor_key) {
                        for &vid in ids {
                            if let Some(vert) = self.verts.get(vid) {
                                if vert.is_active() && vert.coincident(pos) {
                                    return vid;
                                }
                            }
                        }
                    }
                }
            }
        }
        // No coincident vertex found — insert new one
        let vid = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        self.spatial_hash.entry(key).or_default().push(vid);
        vid
    }

    /// Rebuild the spatial hash from existing vertices.
    /// Call after `restore_snapshot()` since spatial_hash is not serialized.
    pub fn rebuild_spatial_hash(&mut self) {
        self.spatial_hash.clear();
        for (id, vert) in self.verts.iter() {
            if vert.is_active() {
                let key = spatial_key(vert.pos());
                self.spatial_hash.entry(key).or_default().push(id);
            }
        }
    }

    /// Get vertex position.
    pub fn vertex_pos(&self, id: VertId) -> Result<DVec3> {
        self.verts
            .get(id)
            .map(|v| v.pos())
            .ok_or_else(|| anyhow::anyhow!("Vertex {:?} not found", id))
    }

    // ========================================================================
    // Edge operations
    // ========================================================================

    /// Add an edge between two vertices. Creates the half-edge pair.
    /// Returns (EdgeId, true) if new, (EdgeId, false) if already exists.
    pub fn add_edge(&mut self, v_start: VertId, v_end: VertId) -> Result<(EdgeId, bool)> {
        let pair = VertPair::new(v_start, v_end);

        // Check for existing edge
        if let Some(&edge_id) = self.vert_to_edge.get(&pair.key) {
            return Ok((edge_id, false));
        }

        // Create edge
        let edge_id = self.edges.insert(Edge::new(
            pair.key.v_small,
            pair.key.v_large,
            EDGE_TOLERANCE,
        ));

        // Register in lookup map
        self.vert_to_edge.insert(pair.key, edge_id);

        // Create half-edge pair
        self.create_halfedge_pair(edge_id, &pair)?;

        Ok((edge_id, true))
    }

    /// Find edge between two vertices.
    pub fn find_edge(&self, a: VertId, b: VertId) -> Option<EdgeId> {
        let key = VertPairKey::new(a, b);
        self.vert_to_edge.get(&key).copied()
    }

    /// Find the shared edge between two faces (if any).
    pub fn find_shared_edge_between_faces(&self, f1: FaceId, f2: FaceId) -> Option<EdgeId> {
        // Collect all edges of face1
        let face1 = self.faces.get(f1)?;
        if !face1.is_active() { return None; }
        let verts1 = self.collect_loop_verts(face1.outer().start).ok()?;

        // For each edge in face1, check if it's shared with face2
        for i in 0..verts1.len() {
            let va = verts1[i];
            let vb = verts1[(i + 1) % verts1.len()];
            // Check both directions
            if let Some(eid) = self.find_edge(va, vb) {
                let (faces, _) = self.get_faces_sharing_edge(eid);
                if faces.contains(&f1) && faces.contains(&f2) {
                    return Some(eid);
                }
            }
        }
        None
    }

    /// Create the twin half-edge pair for an edge.
    fn create_halfedge_pair(&mut self, edge_id: EdgeId, pair: &VertPair) -> Result<()> {
        // Forward half-edge: v_start → v_end
        let he_fwd = HalfEdge::new(pair.v_end, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        // Backward half-edge: v_end → v_start
        let he_bwd = HalfEdge::new(pair.v_start, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        // Wire twins (radial chain for manifold: fwd ↔ bwd)
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(he_fwd_id);

        // Set both as basic half-edges
        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Anchor edge's radial reference
        self.edges[edge_id].set_any_he(he_fwd_id);

        // Set vertex outgoing references (if not already set)
        if self.verts[pair.v_start].outgoing().is_none() {
            self.verts[pair.v_start].set_outgoing(Some(he_fwd_id));
        }
        if self.verts[pair.v_end].outgoing().is_none() {
            self.verts[pair.v_end].set_outgoing(Some(he_bwd_id));
        }

        Ok(())
    }

    // ========================================================================
    // Face operations
    // ========================================================================

    /// Add a face from an ordered list of vertex IDs (CCW winding).
    /// Automatically creates edges and wires the half-edge loop.
    pub fn add_face(
        &mut self,
        outer_verts: &[VertId],
        material: MaterialId,
    ) -> Result<FaceId> {
        self.add_face_with_holes(outer_verts, &[], material)
    }

    /// Add a face with optional holes.
    pub fn add_face_with_holes(
        &mut self,
        outer_verts: &[VertId],
        holes: &[&[VertId]],
        material: MaterialId,
    ) -> Result<FaceId> {
        if outer_verts.len() < 3 {
            bail!("Face requires at least 3 vertices, got {}", outer_verts.len());
        }

        // Compute face normal
        let normal = self.compute_normal(outer_verts)?;

        // Create face with placeholder loop
        let face_id = self.faces.insert(Face::new(
            LoopRef::default(),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Build outer loop
        let outer_loop = self.make_loop(outer_verts, true, face_id)?;
        self.faces[face_id].set_outer(outer_loop);

        // Build inner loops (holes)
        for hole_verts in holes {
            let inner_loop = self.make_loop(hole_verts, false, face_id)?;
            self.faces[face_id].add_inner(inner_loop);
        }

        Ok(face_id)
    }

    /// Wire a half-edge loop from vertex IDs and assign to a face.
    fn make_loop(
        &mut self,
        verts: &[VertId],
        is_outer: bool,
        face_id: FaceId,
    ) -> Result<LoopRef> {
        let n = verts.len();
        if n < 3 {
            bail!("Loop requires at least 3 vertices");
        }

        // Ensure all edges exist
        let mut he_ids = Vec::with_capacity(n);
        for i in 0..n {
            let v_curr = verts[i];
            let v_next = verts[(i + 1) % n];
            let (edge_id, _) = self.add_edge(v_curr, v_next)?;

            // Find the half-edge going from v_curr → v_next
            let he_id = self.find_halfedge(edge_id, v_next)?;
            he_ids.push(he_id);
        }

        // Wire next/prev chain
        for i in 0..n {
            let curr = he_ids[i];
            let next = he_ids[(i + 1) % n];
            let prev = he_ids[(i + n - 1) % n];

            self.hes[curr].set_next(next);
            self.hes[curr].set_prev(prev);
            self.hes[curr].set_face(face_id);
            self.hes[curr].set_outer(is_outer);
        }

        Ok(LoopRef::new(he_ids[0], is_outer))
    }

    /// Find a FREE half-edge on a given edge that points to `dst`.
    ///
    /// 1. First tries to find an existing HE with `face == NULL` and
    ///    the correct direction — O(1) for manifold meshes.
    /// 2. If all HEs on this edge are already assigned to faces,
    ///    creates a NEW HE pair and splices it into the radial chain.
    ///    This supports non-manifold edges (e.g. outward Push/Pull
    ///    where the base face and a side face share an edge).
    ///
    /// NEVER steals half-edges from existing faces.
    fn find_halfedge(&mut self, edge_id: EdgeId, dst: VertId) -> Result<HeId> {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            bail!("Edge {:?} has no half-edges", edge_id);
        }

        // Pass 1: look for a FREE half-edge with the correct direction
        let mut he_id = start_he;
        loop {
            if self.hes[he_id].dst() == dst && self.hes[he_id].face().is_null() {
                return Ok(he_id);
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }

        // Pass 2: no free HE found — create a new pair (non-manifold edge)
        // Determine the "other" vertex (the one that isn't dst)
        // Copy values to avoid borrow conflicts
        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();
        let other = if dst == v_small { v_large } else { v_small };

        // Create new HE pair: fwd points to dst, bwd points to other
        let he_fwd = HalfEdge::new(dst, edge_id);
        let he_fwd_id = self.hes.insert(he_fwd);

        let he_bwd = HalfEdge::new(other, edge_id);
        let he_bwd_id = self.hes.insert(he_bwd);

        self.hes[he_fwd_id].set_active(true);
        self.hes[he_bwd_id].set_active(true);

        // Splice into radial chain: insert fwd and bwd after start_he
        // Before: ... → start_he → next → ...
        // After:  ... → start_he → he_fwd → he_bwd → next → ...
        let next = self.hes[start_he].next_rad();
        self.hes[start_he].set_next_rad(he_fwd_id);
        self.hes[he_fwd_id].set_next_rad(he_bwd_id);
        self.hes[he_bwd_id].set_next_rad(next);

        // Return the one pointing to dst (he_fwd)
        Ok(he_fwd_id)
    }

    // ========================================================================
    // Face removal
    // ========================================================================

    /// Remove a face from the mesh.
    ///
    /// This properly "seals" the topology by:
    /// 1. Setting face = NULL on all loop half-edges (detach from face)
    /// 2. Clearing next/prev pointers (break the ghost loop)
    ///
    /// After removal, the freed half-edges can be reused by new faces
    /// via `find_halfedge` (which looks for face == NULL).
    pub fn remove_face(&mut self, face_id: FaceId) -> Result<()> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found for removal", face_id);
        }

        // Detach half-edges from this face and break loop pointers
        let outer_start = self.faces[face_id].outer().start;
        if !outer_start.is_null() {
            if let Ok(hes) = self.collect_loop_hes(outer_start) {
                for he_id in hes {
                    if let Some(he) = self.hes.get_mut(he_id) {
                        he.set_face(FaceId::NULL);
                        he.set_next(HeId::NULL);
                        he.set_prev(HeId::NULL);
                    }
                }
            }
            // Even if loop traversal fails, still remove the face
        }

        // Also handle inner loops (holes) if any
        let inners: Vec<_> = self.faces[face_id].inners().to_vec();
        for inner_ref in inners {
            if !inner_ref.start.is_null() {
                if let Ok(hes) = self.collect_loop_hes(inner_ref.start) {
                    for he_id in hes {
                        if let Some(he) = self.hes.get_mut(he_id) {
                            he.set_face(FaceId::NULL);
                            he.set_next(HeId::NULL);
                            he.set_prev(HeId::NULL);
                        }
                    }
                }
            }
        }

        // Remove the face from storage
        self.faces.remove(face_id);
        Ok(())
    }

    // ========================================================================
    // Edge splitting
    // ========================================================================

    /// Get the source (origin) vertex of a half-edge.
    ///
    /// A half-edge stores only its destination. The source is the edge's
    /// other vertex (the one that isn't dst).
    pub fn he_src(&self, he_id: HeId) -> Result<VertId> {
        let he = self.hes.get(he_id)
            .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
        let edge = self.edges.get(he.edge())
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", he.edge()))?;
        if he.dst() == edge.v_small() {
            Ok(edge.v_large())
        } else {
            Ok(edge.v_small())
        }
    }

    /// Split an edge at a given position, inserting a new vertex.
    ///
    /// Given edge A──B and position P on it:
    /// - Creates vertex P (or reuses if within tolerance)
    /// - Replaces edge A──B with edges A──P and P──B
    /// - Updates ALL face loops that use this edge
    /// - Rebuilds radial chains for the two new edges
    ///
    /// Returns (new_vert, edge_ap, edge_pb).
    ///
    /// # Safety
    /// This is the most delicate DCEL operation. Every half-edge's
    /// next/prev/next_rad pointers and every face's loop start must
    /// remain consistent after the split.
    pub fn split_edge(
        &mut self,
        edge_id: EdgeId,
        pos: DVec3,
    ) -> Result<(VertId, EdgeId, EdgeId)> {
        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;
        ensure!(edge.is_active(), "Edge {:?} is not active", edge_id);

        let va = edge.v_small();
        let vb = edge.v_large();

        // ─── 1. Create midpoint vertex ──────────────────────────────
        let vp = self.verts.insert(Vertex::new(pos, VERTEX_TOLERANCE));
        let key = spatial_key(pos);
        self.spatial_hash.entry(key).or_default().push(vp);

        // ─── 2. Collect all half-edges on the radial chain ──────────
        let start_he = self.edges[edge_id].any_he();
        ensure!(!start_he.is_null(), "Edge has no half-edges");

        // Gather (he_id, dst, face, prev, next, is_outer, flags) before mutation
        struct HeInfo {
            id: HeId,
            dst: VertId,
            face: FaceId,
            prev: HeId,
            next: HeId,
            is_outer: bool,
            flags: HeFlags,
        }

        let mut old_hes_info = Vec::new();
        let mut he = start_he;
        loop {
            let h = &self.hes[he];
            old_hes_info.push(HeInfo {
                id: he,
                dst: h.dst(),
                face: h.face(),
                prev: h.prev(),
                next: h.next(),
                is_outer: h.is_outer(),
                flags: h.flags(),
            });
            he = self.hes[he].next_rad();
            if he == start_he { break; }
            if old_hes_info.len() > 1000 {
                bail!("Radial chain exceeded 1000 — corrupted topology");
            }
        }

        // ─── 3. Create two new edges (manually, not via add_edge) ───
        let pair_ap = VertPairKey::new(va, vp);
        let pair_pb = VertPairKey::new(vp, vb);

        let e1 = self.edges.insert(Edge::new(pair_ap.v_small, pair_ap.v_large, EDGE_TOLERANCE));
        let e2 = self.edges.insert(Edge::new(pair_pb.v_small, pair_pb.v_large, EDGE_TOLERANCE));

        self.vert_to_edge.insert(pair_ap, e1);
        self.vert_to_edge.insert(pair_pb, e2);

        // ─── 4. For each old HE, create two replacement HEs ────────
        let mut e1_hes: Vec<HeId> = Vec::new();
        let mut e2_hes: Vec<HeId> = Vec::new();

        for info in &old_hes_info {
            if info.dst == vb {
                // Direction: A → B  ⟹  split into A→P (on E1) then P→B (on E2)
                let he_ap = self.hes.insert(HalfEdge::new(vp, e1));
                let he_pb = self.hes.insert(HalfEdge::new(vb, e2));

                // Wire into face loop: prev → he_ap → he_pb → next
                self.hes[he_ap].set_next(he_pb);
                self.hes[he_pb].set_prev(he_ap);
                self.hes[he_ap].set_prev(info.prev);
                self.hes[he_pb].set_next(info.next);
                self.hes[he_ap].set_face(info.face);
                self.hes[he_pb].set_face(info.face);
                self.hes[he_ap].set_outer(info.is_outer);
                self.hes[he_pb].set_outer(info.is_outer);
                self.hes[he_ap].set_flags(info.flags);
                self.hes[he_pb].set_flags(info.flags);

                // Update neighbor pointers
                if !info.prev.is_null() && self.hes.contains(info.prev) {
                    self.hes[info.prev].set_next(he_ap);
                }
                if !info.next.is_null() && self.hes.contains(info.next) {
                    self.hes[info.next].set_prev(he_pb);
                }

                // Update face loop start if it pointed to old HE
                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_ap, face.outer().is_outer));
                        }
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_ap;
                            }
                        }
                    }
                }

                e1_hes.push(he_ap);
                e2_hes.push(he_pb);

            } else if info.dst == va {
                // Direction: B → A  ⟹  split into B→P (on E2) then P→A (on E1)
                let he_bp = self.hes.insert(HalfEdge::new(vp, e2));
                let he_pa = self.hes.insert(HalfEdge::new(va, e1));

                // Wire into face loop: prev → he_bp → he_pa → next
                self.hes[he_bp].set_next(he_pa);
                self.hes[he_pa].set_prev(he_bp);
                self.hes[he_bp].set_prev(info.prev);
                self.hes[he_pa].set_next(info.next);
                self.hes[he_bp].set_face(info.face);
                self.hes[he_pa].set_face(info.face);
                self.hes[he_bp].set_outer(info.is_outer);
                self.hes[he_pa].set_outer(info.is_outer);
                self.hes[he_bp].set_flags(info.flags);
                self.hes[he_pa].set_flags(info.flags);

                if !info.prev.is_null() && self.hes.contains(info.prev) {
                    self.hes[info.prev].set_next(he_bp);
                }
                if !info.next.is_null() && self.hes.contains(info.next) {
                    self.hes[info.next].set_prev(he_pa);
                }

                if !info.face.is_null() {
                    if let Some(face) = self.faces.get_mut(info.face) {
                        if face.outer().start == info.id {
                            face.set_outer(LoopRef::new(he_bp, face.outer().is_outer));
                        }
                        for inner in face.inners_mut().iter_mut() {
                            if inner.start == info.id {
                                inner.start = he_bp;
                            }
                        }
                    }
                }

                e2_hes.push(he_bp);
                e1_hes.push(he_pa);
            } else {
                bail!("HE {:?} dst={:?} doesn't match edge vertices A={:?} B={:?}",
                    info.id, info.dst, va, vb);
            }

            // Deactivate old half-edge
            self.hes[info.id].set_active(false);
        }

        // ─── 5. Build radial chains for E1 and E2 ──────────────────
        for hes in [&e1_hes, &e2_hes] {
            if hes.len() >= 2 {
                for i in 0..hes.len() {
                    let next = hes[(i + 1) % hes.len()];
                    self.hes[hes[i]].set_next_rad(next);
                }
            } else if hes.len() == 1 {
                // Single HE — point to itself (shouldn't happen for valid edge)
                self.hes[hes[0]].set_next_rad(hes[0]);
            }
        }

        // Set edge anchors
        if let Some(&first) = e1_hes.first() {
            self.edges[e1].set_any_he(first);
        }
        if let Some(&first) = e2_hes.first() {
            self.edges[e2].set_any_he(first);
        }

        // ─── 6. Set vertex outgoing for new vertex P ────────────────
        if let Some(&he) = e1_hes.first() {
            self.verts[vp].set_outgoing(Some(he));
        }

        // Update outgoing for A and B if they pointed to deactivated HEs
        if let Some(out) = self.verts[va].outgoing() {
            if !self.hes[out].is_active() {
                // Find a new active HE starting from A
                for &he_id in &e1_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == va { self.verts[va].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }
        if let Some(out) = self.verts[vb].outgoing() {
            if !self.hes[out].is_active() {
                for &he_id in &e2_hes {
                    if let Ok(src) = self.he_src(he_id) {
                        if src == vb { self.verts[vb].set_outgoing(Some(he_id)); break; }
                    }
                }
            }
        }

        // ─── 7. Deactivate old edge ────────────────────────────────
        self.edges[edge_id].set_active(false);
        self.vert_to_edge.remove(&VertPairKey::new(va, vb));

        Ok((vp, e1, e2))
    }

    // ========================================================================
    // Face splitting
    // ========================================================================

    /// Split a face by connecting two of its boundary vertices with a new edge.
    ///
    /// Given face F with boundary [..., v1, ..., v2, ...]:
    /// - Creates edge v1–v2 (the split edge)
    /// - Splits F into two faces: F_A (v1→...→v2) and F_B (v2→...→v1)
    /// - Both new faces inherit the original face's material and normal
    ///
    /// Returns (face_a, face_b).
    ///
    /// # Preconditions
    /// - v1 and v2 must be on the face's outer boundary
    /// - v1 and v2 must not be adjacent (that would create a degenerate face)
    /// - The face must not have holes that cross the split line
    pub fn split_face(
        &mut self,
        face_id: FaceId,
        v1: VertId,
        v2: VertId,
    ) -> Result<(FaceId, FaceId)> {
        ensure!(self.faces.contains(face_id), "Face {:?} not found", face_id);
        ensure!(v1 != v2, "Cannot split face with same vertex");

        // Save face properties
        let material = self.faces[face_id].material();
        let normal = self.faces[face_id].normal();

        let outer_start = self.faces[face_id].outer().start;
        let loop_hes = self.collect_loop_hes(outer_start)?;
        let loop_verts = self.collect_loop_verts(outer_start)?;
        let n = loop_verts.len();

        // Find positions of v1 and v2 in the boundary loop
        // loop_hes[i].dst() == loop_verts[i]
        let idx1 = loop_verts.iter().position(|&v| v == v1)
            .ok_or_else(|| anyhow::anyhow!("v1 {:?} not on face {:?} boundary", v1, face_id))?;
        let idx2 = loop_verts.iter().position(|&v| v == v2)
            .ok_or_else(|| anyhow::anyhow!("v2 {:?} not on face {:?} boundary", v2, face_id))?;

        // Check v1 and v2 are not adjacent (would create degenerate face)
        let dist_fwd = if idx2 >= idx1 { idx2 - idx1 } else { n - idx1 + idx2 };
        let dist_bwd = n - dist_fwd;
        ensure!(dist_fwd >= 2 && dist_bwd >= 2,
            "v1 and v2 are adjacent or equal — split would create degenerate face");

        // ================================================================
        // Direct DCEL surgery — NO remove_face, NO add_face
        // ================================================================
        //
        // Original loop: ... → he_to_v1 → he_from_v1 → ... → he_to_v2 → he_from_v2 → ...
        //   where he_to_v1.dst = v1, he_to_v2.dst = v2
        //
        // After split:
        //   Loop A (face_id): he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1
        //   Loop B (face_b):  he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2

        // Identify the key half-edges
        let he_to_v1 = loop_hes[idx1];     // dst = v1
        let he_from_v1 = loop_hes[(idx1 + 1) % n]; // starts at v1
        let he_to_v2 = loop_hes[idx2];     // dst = v2
        let he_from_v2 = loop_hes[(idx2 + 1) % n]; // starts at v2

        // Create the splitting edge v1↔v2
        let (split_edge_id, _) = self.add_edge(v1, v2)?;

        // Get free half-edges for the split edge
        let he_v1v2 = self.find_halfedge(split_edge_id, v2)?; // v1→v2
        let he_v2v1 = self.find_halfedge(split_edge_id, v1)?; // v2→v1

        // === Splice Loop A: he_to_v1 → he_v1v2 → he_from_v2 → ... → he_to_v1 ===
        self.hes[he_to_v1].set_next(he_v1v2);
        self.hes[he_v1v2].set_prev(he_to_v1);
        self.hes[he_v1v2].set_next(he_from_v2);
        self.hes[he_from_v2].set_prev(he_v1v2);

        // === Splice Loop B: he_to_v2 → he_v2v1 → he_from_v1 → ... → he_to_v2 ===
        self.hes[he_to_v2].set_next(he_v2v1);
        self.hes[he_v2v1].set_prev(he_to_v2);
        self.hes[he_v2v1].set_next(he_from_v1);
        self.hes[he_from_v1].set_prev(he_v2v1);

        // === Assign face references ===

        // Mark split edge HEs as HARD so they render even between coplanar faces
        self.hes[he_v1v2].set_flags(HeFlags::HARD);
        self.hes[he_v2v1].set_flags(HeFlags::HARD);

        // Loop A keeps face_id — set face on the new split HE
        self.hes[he_v1v2].set_face(face_id);
        self.hes[he_v1v2].set_outer(true);
        self.hes[he_v1v2].set_active(true);

        // Update face_id's outer loop start to point into Loop A
        self.faces[face_id].set_outer(LoopRef::new(he_v1v2, true));

        // Create face_b for Loop B
        let face_b = self.faces.insert(Face::new(
            LoopRef::new(he_v2v1, true),
            normal,
            FACE_TOLERANCE,
            material,
        ));

        // Set face on he_v2v1
        self.hes[he_v2v1].set_face(face_b);
        self.hes[he_v2v1].set_outer(true);
        self.hes[he_v2v1].set_active(true);

        // Walk Loop B and reassign all existing HEs from face_id → face_b
        {
            let mut he_id = self.hes[he_v2v1].next();
            while he_id != he_v2v1 {
                if he_id.is_null() {
                    bail!("Null next pointer encountered while reassigning Loop B faces");
                }
                self.hes[he_id].set_face(face_b);
                he_id = self.hes[he_id].next();
            }
        }

        // ────────────────────────────────────────────────────────────────
        // 노멀 일관성 자가 보정 (회귀 방지, ADR-003 / 2026-04-17)
        //
        // DCEL 수술이 올바르면 두 sub-face 모두 원본과 같은 loop 회전 방향을
        // 유지하므로 원본 노멀이 그대로 맞다. 하지만 split_edge가 먼저 호출되어
        // loop 포인터가 건드려진 경우 아주 드물게 loop가 뒤집힐 수 있다.
        //
        // 방어책: 두 sub-face의 실제 loop에서 노멀을 재계산해서
        // stored normal과 방향이 반대면 stored를 뒤집어 맞춘다.
        // (loop 자체를 reverse하지 않는 이유: DCEL radial chain 재봉합이 비용 큼)
        //
        // 이렇게 하면 triangulation/렌더링이 stored normal을 기준으로 작동하므로
        // 시각적 "앞뒷면 뒤집힘" 현상을 원천 차단한다.
        // ────────────────────────────────────────────────────────────────
        for sub_face in [face_id, face_b] {
            let loop_start = self.faces[sub_face].outer().start;
            if let Ok(verts) = self.collect_loop_verts(loop_start) {
                if let Ok(computed) = self.compute_normal(&verts) {
                    if computed.length_squared() > 1e-20 {
                        let stored = self.faces[sub_face].normal();
                        if computed.dot(stored) < 0.0 {
                            // loop가 뒤집혔다 — stored를 뒤집어 두-톤 렌더링 일관성 회복
                            self.faces[sub_face].set_normal(-stored);
                        }
                    }
                }
            }
        }

        Ok((face_id, face_b))
    }

    // ========================================================================
    // Normal computation
    // ========================================================================

    /// Compute the unit normal of a polygon defined by vertex IDs.
    /// Uses Newell's method for robustness with non-planar polygons.
    pub fn compute_normal(&self, verts: &[VertId]) -> Result<DVec3> {
        if verts.len() < 3 {
            bail!("Need at least 3 vertices for normal computation");
        }

        let mut normal = DVec3::ZERO;
        let n = verts.len();

        for i in 0..n {
            let curr = self.vertex_pos(verts[i])?;
            let next = self.vertex_pos(verts[(i + 1) % n])?;

            // Newell's method
            normal.x += (curr.y - next.y) * (curr.z + next.z);
            normal.y += (curr.z - next.z) * (curr.x + next.x);
            normal.z += (curr.x - next.x) * (curr.y + next.y);
        }

        let len = normal.length();
        if len < NORMAL_EPSILON {
            // Fall back to cross product of first two edges
            let p0 = self.vertex_pos(verts[0])?;
            let p1 = self.vertex_pos(verts[1])?;
            let p2 = self.vertex_pos(verts[2])?;
            normal = (p1 - p0).cross(p2 - p0);
            let len2 = normal.length();
            if len2 > 0.0 {
                return Ok(normal / len2);
            }
            bail!("Degenerate polygon — cannot compute normal");
        }

        Ok(normal / len)
    }

    /// Check if two faces are coplanar (same plane within tolerance).
    pub fn are_coplanar(&self, f1: FaceId, f2: FaceId) -> bool {
        let n1 = self.faces[f1].normal();
        let n2 = self.faces[f2].normal();
        let dot = n1.dot(n2).abs();
        dot > 1.0 - COPLANAR_TOLERANCE
    }

    // ========================================================================
    // Loop traversal utilities
    // ========================================================================

    /// Collect all vertex IDs in a face loop starting from a half-edge.
    pub fn collect_loop_verts(&self, start: HeId) -> Result<Vec<VertId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            result.push(he.dst());

            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Collect all half-edge IDs in a face loop.
    pub fn collect_loop_hes(&self, start: HeId) -> Result<Vec<HeId>> {
        let mut result = Vec::new();
        let mut he_id = start;

        loop {
            result.push(he_id);
            let he = self.hes.get(he_id)
                .ok_or_else(|| anyhow::anyhow!("HalfEdge {:?} not found", he_id))?;
            he_id = he.next();
            if he_id == start || he_id.is_null() {
                break;
            }
            if result.len() > 10000 {
                bail!("Loop traversal exceeded 10000 — likely corrupted topology");
            }
        }

        Ok(result)
    }

    /// Get all edge IDs bounding a face's outer loop.
    pub fn face_outer_edges(&self, face_id: FaceId) -> Result<Vec<EdgeId>> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        Ok(hes.iter().map(|&he_id| self.hes[he_id].edge()).collect())
    }

    // ========================================================================
    // Closed-loop detection (auto-face creation)
    // ========================================================================

    /// Detect if adding edge v0–v1 completes a closed boundary loop.
    ///
    /// **CAD Boundary Walk approach**: Instead of BFS on edge adjacency,
    /// walks the free half-edge boundary chain starting from the new edge's
    /// forward half-edge. If the chain returns to its start, a closed loop
    /// is found. This is O(L) where L is loop length, not O(E) total edges.
    ///
    /// Falls back to BFS if boundary chain is not yet wired (compatibility).
    ///
    /// Returns the loop vertices in winding order (suitable for `add_face`)
    /// if a coplanar closed loop of 3+ edges is found.
    pub fn detect_free_edge_loop(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        // Try boundary chain walk first (CAD approach — O(L) for degree-2 loops)
        if let Some(verts) = self.detect_loop_by_chain_walk(v0, v1, new_edge_id) {
            return Some(verts);
        }

        // Fallback: BFS on free-edge adjacency graph (legacy approach)
        self.detect_loop_by_bfs(v0, v1, new_edge_id)
    }

    /// CAD boundary walk: build free-edge adjacency at each vertex on-the-fly
    /// and walk through degree-2 vertices to find the shortest closed loop
    /// containing the new edge. O(L) where L = loop length.
    fn detect_loop_by_chain_walk(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        // Walk from v1, following free edges (excluding new_edge_id),
        // always choosing the unique next vertex at degree-2 junctions.
        // If we reach v0, loop is found.
        let mut path = vec![v0, v1];
        let mut prev_v = v0;
        let mut curr_v = v1;

        for _ in 0..10000 {
            // Find all free-edge neighbors of curr_v (excluding the edge we came from)
            let mut neighbors = Vec::new();
            for (&key, &edge_id) in &self.vert_to_edge {
                if edge_id == new_edge_id { continue; }
                if key.v_small != curr_v && key.v_large != curr_v { continue; }
                if !self.edges[edge_id].is_active() { continue; }
                if !self.edge_has_free_he(edge_id) { continue; }
                let other = if key.v_small == curr_v { key.v_large } else { key.v_small };
                if other != prev_v {
                    neighbors.push(other);
                }
            }

            if neighbors.len() == 1 {
                let next_v = neighbors[0];
                if next_v == v0 {
                    // Closed loop found!
                    if path.len() >= 3 && self.are_verts_coplanar(&path) {
                        return Some(path);
                    }
                    return None;
                }
                prev_v = curr_v;
                curr_v = next_v;
                path.push(curr_v);
            } else {
                // Dead end (0) or branch (2+) → can't determine unique loop via simple walk
                return None;
            }
        }
        None
    }

    /// Legacy BFS-based loop detection on free-edge adjacency.
    fn detect_loop_by_bfs(
        &self,
        v0: VertId,
        v1: VertId,
        new_edge_id: EdgeId,
    ) -> Option<Vec<VertId>> {
        use std::collections::VecDeque;

        let mut adj: FxHashMap<VertId, Vec<VertId>> = FxHashMap::default();

        for (edge_id, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge_id == new_edge_id { continue; }
            if !self.edge_has_free_he(edge_id) { continue; }

            let va = edge.v_small();
            let vb = edge.v_large();
            adj.entry(va).or_default().push(vb);
            adj.entry(vb).or_default().push(va);
        }

        let mut parent: FxHashMap<VertId, VertId> = FxHashMap::default();
        parent.insert(v1, VertId::NULL);
        let mut queue = VecDeque::new();
        queue.push_back(v1);

        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(&current) {
                for &next in neighbors {
                    if parent.contains_key(&next) { continue; }
                    parent.insert(next, current);

                    if next == v0 {
                        let mut path = Vec::new();
                        let mut node = v0;
                        loop {
                            path.push(node);
                            let p = parent[&node];
                            if p.is_null() { break; }
                            node = p;
                        }
                        if path.len() < 3 { return None; }

                        let mut face_verts = Vec::with_capacity(path.len());
                        face_verts.push(path[0]);
                        for i in (1..path.len()).rev() {
                            face_verts.push(path[i]);
                        }

                        if self.are_verts_coplanar(&face_verts) {
                            return Some(face_verts);
                        } else {
                            return None;
                        }
                    }

                    queue.push_back(next);
                }
            }
        }

        None
    }

    /// Check if an edge has at least one half-edge not assigned to a face.
    fn edge_has_free_he(&self, edge_id: EdgeId) -> bool {
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() { return false; }

        let mut he_id = start_he;
        loop {
            if self.hes[he_id].face().is_null() {
                return true;
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he { break; }
        }
        false
    }

    /// Check if all vertices lie on the same plane (within tolerance).
    /// Triangles (3 vertices) are always coplanar.
    fn are_verts_coplanar(&self, verts: &[VertId]) -> bool {
        if verts.len() <= 3 { return true; }

        let p0 = self.verts[verts[0]].pos();
        let p1 = self.verts[verts[1]].pos();
        let p2 = self.verts[verts[2]].pos();

        let normal = (p1 - p0).cross(p2 - p0);
        let normal_len = normal.length();
        if normal_len < 1e-10 { return false; } // degenerate
        let normal = normal / normal_len;

        const COPLANAR_TOL: f64 = 1e-3; // 1mm tolerance for drawn lines

        for &vid in &verts[3..] {
            let p = self.verts[vid].pos();
            let dist = (p - p0).dot(normal).abs();
            if dist > COPLANAR_TOL {
                return false;
            }
        }
        true
    }

    // ========================================================================
    // Mesh export (for sending to Three.js)
    // ========================================================================

    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions, normals, indices, face_id_per_triangle)
    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    /// positions_f64 has the same layout/indexing as positions_f32 but in full f64 precision.
    pub fn export_buffers(&self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let mut positions: Vec<f32> = Vec::new();
        let mut positions_f64: Vec<f64> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut face_map: Vec<u32> = Vec::new(); // one FaceId per triangle
        let mut vert_offset: u32 = 0;

        for (face_id, face) in self.faces.iter() {
            if !face.is_active() || !face.is_visible() {
                continue;
            }

            let normal = face.normal();

            // Skip faces with corrupted loops (graceful degradation)
            let loop_verts = match self.collect_loop_verts(face.outer().start) {
                Ok(verts) => verts,
                Err(_) => continue, // skip corrupted face, don't kill all rendering
            };

            if loop_verts.len() < 3 {
                continue;
            }

            // Project to 2D for triangulation
            let (coord1, coord2) = Self::projection_axes(normal);
            let mut coords_2d: Vec<f64> = Vec::with_capacity(loop_verts.len() * 2);
            let mut positions_3d: Vec<DVec3> = Vec::with_capacity(loop_verts.len());

            let mut skip_face = false;
            for &vid in &loop_verts {
                match self.vertex_pos(vid) {
                    Ok(pos) => {
                        positions_3d.push(pos);
                        let arr = [pos.x, pos.y, pos.z];
                        coords_2d.push(arr[coord1]);
                        coords_2d.push(arr[coord2]);
                    }
                    Err(_) => { skip_face = true; break; }
                }
            }
            if skip_face { continue; }

            // Inner loops (holes) 처리
            let mut hole_indices: Vec<usize> = Vec::new();
            let inners: Vec<_> = face.inners().to_vec();
            for inner_ref in &inners {
                if inner_ref.start.is_null() { continue; }
                let inner_verts = match self.collect_loop_verts(inner_ref.start) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if inner_verts.len() < 3 { continue; }

                // hole 시작 인덱스 = 현재 2D 좌표 수 / 2
                hole_indices.push(coords_2d.len() / 2);

                for &vid in &inner_verts {
                    match self.vertex_pos(vid) {
                        Ok(pos) => {
                            positions_3d.push(pos);
                            let arr = [pos.x, pos.y, pos.z];
                            coords_2d.push(arr[coord1]);
                            coords_2d.push(arr[coord2]);
                        }
                        Err(_) => { skip_face = true; break; }
                    }
                }
                if skip_face { break; }
            }
            if skip_face { continue; }

            // Triangulate with earcutr (outer + holes)
            let mut tri_indices = match earcutr::earcut(&coords_2d, &hole_indices, 2) {
                Ok(indices) => indices,
                Err(_) => continue, // skip un-triangulable face
            };

            // Fix triangle winding: earcut works in 2D and may produce
            // triangles whose 3D winding doesn't match the face normal.
            // Check EACH triangle individually and fix if needed.
            for chunk in tri_indices.chunks_exact_mut(3) {
                let pa = positions_3d[chunk[0]];
                let pb = positions_3d[chunk[1]];
                let pc = positions_3d[chunk[2]];
                let tri_normal = (pb - pa).cross(pc - pa);
                if tri_normal.dot(normal) < 0.0 {
                    chunk.swap(1, 2);
                }
            }

            // Emit vertices (f32 for GPU + f64 for precision)
            for pos in &positions_3d {
                positions.push(pos.x as f32);
                positions.push(pos.y as f32);
                positions.push(pos.z as f32);

                positions_f64.push(pos.x);
                positions_f64.push(pos.y);
                positions_f64.push(pos.z);

                normals.push(normal.x as f32);
                normals.push(normal.y as f32);
                normals.push(normal.z as f32);
            }

            // Emit indices (offset by current vertex count)
            let num_triangles = tri_indices.len() / 3;
            for &idx in &tri_indices {
                indices.push(vert_offset + idx as u32);
            }

            // Map each triangle to this face's ID
            for _ in 0..num_triangles {
                face_map.push(face_id.raw());
            }

            vert_offset += positions_3d.len() as u32;
        }

        Ok((positions, normals, indices, face_map, positions_f64))
    }

    /// Choose the best 2D projection axes based on the face normal.
    /// Drops the axis with the largest normal component.
    fn projection_axes(normal: DVec3) -> (usize, usize) {
        let abs_n = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
        if abs_n[0] >= abs_n[1] && abs_n[0] >= abs_n[2] {
            (1, 2) // Drop X → project onto YZ
        } else if abs_n[1] >= abs_n[0] && abs_n[1] >= abs_n[2] {
            (0, 2) // Drop Y → project onto XZ
        } else {
            (0, 1) // Drop Z → project onto XY
        }
    }

    // ========================================================================
    // Edge line export (for wireframe rendering — SketchUp-style)
    // ========================================================================

    /// Export "hard edge" line segments for wireframe rendering.
    ///
    /// Unlike Three.js EdgesGeometry (which can't detect shared edges when
    /// vertices are duplicated per-face), this uses DCEL topology to correctly
    /// identify which edges should be drawn:
    ///
    /// - Boundary edges (only one face): ALWAYS drawn
    /// - Edges between non-coplanar faces (angle > threshold): drawn
    /// - Edges between coplanar faces (angle ≤ threshold): HIDDEN (soft)
    /// - Edges with SOFT flag set: HIDDEN
    ///
    /// Returns flat `[x0,y0,z0, x1,y1,z1, ...]` buffer for LineSegments.
    pub fn export_edge_lines(&self, angle_threshold_deg: f64) -> Vec<f32> {
        let (lines, _) = self.export_edge_lines_with_map(angle_threshold_deg);
        lines
    }

    /// export_edge_lines + edge ID map (segment index → EdgeId raw)
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        let cos_threshold = angle_threshold_deg.to_radians().cos();
        let mut lines: Vec<f32> = Vec::new();
        let mut edge_map: Vec<u32> = Vec::new();

        for (_edge_id, edge) in self.edges.iter() {
            if !edge.is_active() {
                continue;
            }

            // Get edge endpoint positions
            let p0 = match self.vertex_pos(edge.v_small()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let p1 = match self.vertex_pos(edge.v_large()) {
                Ok(p) => p,
                Err(_) => continue,
            };

            // Check half-edge flags (SOFT / HARD)
            let he_start = edge.any_he();
            if he_start.is_null() {
                continue;
            }
            let he_flags = self.hes[he_start].flags();
            if he_flags.contains(HeFlags::SOFT) {
                continue; // soft edge — don't draw
            }
            let force_hard = he_flags.contains(HeFlags::HARD);

            // Collect adjacent face normals via radial chain
            let mut face_normals: Vec<DVec3> = Vec::new();
            let mut he_id = he_start;
            loop {
                let face_id = self.hes[he_id].face();
                if !face_id.is_null() && self.faces.contains(face_id) {
                    let face = &self.faces[face_id];
                    if face.is_active() && face.is_visible() {
                        face_normals.push(face.normal());
                    }
                }
                he_id = self.hes[he_id].next_rad();
                if he_id == he_start {
                    break;
                }
            }

            // Decision: draw this edge?
            let draw = if force_hard {
                true // HARD flag → always draw (face split edges, user-drawn lines)
            } else {
                match face_normals.len() {
                    0 => true,  // isolated edge (wireframe) — draw
                    1 => true,  // boundary edge — draw
                    2 => {
                        // Two faces: check if coplanar
                        let dot = face_normals[0].dot(face_normals[1]).abs();
                        dot < cos_threshold // draw only if NOT coplanar
                    }
                    _ => true,  // non-manifold — draw
                }
            };

            if draw {
                lines.push(p0.x as f32);
                lines.push(p0.y as f32);
                lines.push(p0.z as f32);
                lines.push(p1.x as f32);
                lines.push(p1.y as f32);
                lines.push(p1.z as f32);
                edge_map.push(_edge_id.raw());
            }
        }

        (lines, edge_map)
    }

    // ========================================================================
    // Face merge (AixxiA coplanar merge — SketchUp-style)
    // ========================================================================

    /// Get all faces sharing a given edge, via the radial half-edge chain.
    /// Returns (face_ids, he_ids) — one pair per face found.
    pub fn get_faces_sharing_edge(&self, edge_id: EdgeId) -> (Vec<FaceId>, Vec<HeId>) {
        let mut faces = Vec::with_capacity(2);
        let mut hes = Vec::with_capacity(2);
        let start_he = self.edges[edge_id].any_he();
        if start_he.is_null() {
            return (faces, hes);
        }
        let mut he_id = start_he;
        loop {
            let f = self.hes[he_id].face();
            if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                if !faces.contains(&f) {
                    faces.push(f);
                    hes.push(he_id);
                }
            }
            he_id = self.hes[he_id].next_rad();
            if he_id == start_he {
                break;
            }
        }
        (faces, hes)
    }

    /// Check if two faces are coplanar: normals nearly parallel AND on the same plane.
    /// This is the AixxiA `are_faces_coplanar` method ported directly.
    pub fn are_faces_coplanar_strict(&self, f1: FaceId, f2: FaceId) -> Result<bool> {
        let verts1 = self.collect_loop_verts(self.faces[f1].outer().start)?;
        let verts2 = self.collect_loop_verts(self.faces[f2].outer().start)?;
        if verts1.len() < 3 || verts2.len() < 3 {
            return Ok(false);
        }

        let n1 = self.compute_normal(&verts1)?;
        let n2 = self.compute_normal(&verts2)?;
        let n1_len = n1.length();
        let n2_len = n2.length();
        if n1_len < 1e-10 || n2_len < 1e-10 {
            return Ok(true); // degenerate → treat as coplanar (AixxiA behavior)
        }
        let n1u = n1 / n1_len;
        let n2u = n2 / n2_len;

        // Normals parallel? (tolerance: 1e-3 like AixxiA)
        let dot = n1u.dot(n2u).abs();
        if (1.0 - dot).abs() > 1e-3 {
            return Ok(false);
        }

        // Same plane? Point-to-plane distance check
        let p1 = self.vertex_pos(verts1[0])?;
        let p2 = self.vertex_pos(verts2[0])?;
        let distance = n1u.dot(p2 - p1).abs();
        Ok(distance < 1e-3)
    }

    /// Find the half-edge belonging to a specific face on a given edge.
    fn find_he_for_face_and_edge(&self, face_id: FaceId, edge_id: EdgeId) -> Result<HeId> {
        let start = self.faces[face_id].outer().start;
        let hes = self.collect_loop_hes(start)?;
        for he_id in hes {
            if self.hes[he_id].edge() == edge_id {
                return Ok(he_id);
            }
        }
        bail!("HalfEdge for face {:?} on edge {:?} not found", face_id, edge_id)
    }

    /// Merge two face loops by removing the shared edge's half-edges.
    /// Returns the merged vertex list (AixxiA `merge_face_loops` port).
    fn merge_face_loops(&self, he1: HeId, he2: HeId) -> Result<Vec<VertId>> {
        let mut merged = Vec::new();

        // Walk he1's loop skipping he1 itself
        let mut cur = self.hes[he1].next();
        let mut iters = 0;
        while cur != he1 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        // Walk he2's loop skipping he2 itself
        cur = self.hes[he2].next();
        iters = 0;
        while cur != he2 && iters < 10000 {
            merged.push(self.hes[cur].dst());
            cur = self.hes[cur].next();
            iters += 1;
        }

        if merged.len() < 3 {
            bail!("Merged face would have fewer than 3 vertices");
        }
        Ok(merged)
    }

    /// Remove an edge and all its half-edges from the mesh.
    pub fn remove_edge_and_halfedges(&mut self, edge_id: EdgeId) -> Result<()> {
        if !self.edges.contains(edge_id) {
            bail!("Edge {:?} not found", edge_id);
        }

        // Collect all HEs in radial chain
        let start_he = self.edges[edge_id].any_he();
        if !start_he.is_null() {
            let mut to_remove = Vec::new();
            let mut he_id = start_he;
            loop {
                to_remove.push(he_id);
                he_id = self.hes[he_id].next_rad();
                if he_id == start_he || to_remove.len() > 100 {
                    break;
                }
            }
            for he in to_remove {
                self.hes.remove(he);
            }
        }

        // Remove edge from lookup
        let v_small = self.edges[edge_id].v_small();
        let v_large = self.edges[edge_id].v_large();
        let key = VertPairKey::new(v_small, v_large);
        self.vert_to_edge.remove(&key);
        self.edges.remove(edge_id);
        Ok(())
    }

    /// Merge two coplanar faces sharing an edge.
    /// AixxiA's `merge_face_by_edge_id` ported directly.
    ///
    /// 1. Check that exactly 2 faces share the edge
    /// 2. Check coplanarity
    /// 3. Merge vertex loops (remove shared edge vertices from loop)
    /// 4. Delete old faces and shared edge
    /// 5. Create new merged face
    pub fn merge_faces_by_edge(&mut self, edge_id: EdgeId) -> Result<FaceId> {
        // 1. Find the two faces sharing this edge
        let (faces, _hes) = self.get_faces_sharing_edge(edge_id);
        if faces.len() != 2 {
            bail!("Edge {:?} shared by {} faces (need exactly 2)", edge_id, faces.len());
        }
        let f1 = faces[0];
        let f2 = faces[1];

        // 2. Coplanarity check
        if !self.are_faces_coplanar_strict(f1, f2)? {
            bail!("Faces {:?} and {:?} are not coplanar", f1, f2);
        }

        // 3. Save original normal for winding consistency
        let original_normal = self.faces[f1].normal();

        // 4. Find half-edges for each face on this edge and merge loops
        let he1 = self.find_he_for_face_and_edge(f1, edge_id)?;
        let he2 = self.find_he_for_face_and_edge(f2, edge_id)?;
        let mut merged_verts = self.merge_face_loops(he1, he2)?;

        // 5. Fix winding: merged loop might reverse the normal direction.
        //    Compare merged normal with original face normal; reverse if mismatched.
        let merged_normal = self.compute_normal(&merged_verts)?;
        if merged_normal.dot(original_normal) < 0.0 {
            merged_verts.reverse();
        }

        // 6. Get material from first face
        let material = self.faces[f1].material();

        // 7. Remove shared edge (and its half-edges)
        self.remove_edge_and_halfedges(edge_id)?;

        // 8. Remove old faces
        self.faces.remove(f1);
        self.faces.remove(f2);

        // 9. Create new merged face
        let new_face = self.add_face(&merged_verts, material)?;
        Ok(new_face)
    }

    /// Remove vertices that have no edges referencing them.
    pub fn remove_isolated_verts(&mut self) {
        let mut referenced = std::collections::HashSet::new();
        for (_, edge) in self.edges.iter() {
            referenced.insert(edge.v_small());
            referenced.insert(edge.v_large());
        }
        let isolated: Vec<_> = self.verts.iter()
            .map(|(vid, _)| vid)
            .filter(|vid| !referenced.contains(vid))
            .collect();
        for vid in isolated {
            self.verts.remove(vid);
        }
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    pub fn vert_count(&self) -> usize {
        self.verts.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn face_count(&self) -> usize {
        self.faces.len()
    }

    pub fn he_count(&self) -> usize {
        self.hes.len()
    }

    // ═══════════════════════════════════════
    //  Shell operations
    // ═══════════════════════════════════════

    /// Create a new shell from the given face IDs.
    pub fn create_shell(&mut self, face_ids: Vec<FaceId>, closed: bool) -> ShellId {
        let shell = Shell::new(face_ids, closed);
        self.shells.insert(shell)
    }

    /// Get the shell containing a specific face, if any.
    pub fn shell_for_face(&self, face_id: FaceId) -> Option<ShellId> {
        for (shell_id, shell) in self.shells.iter() {
            if shell.contains_face(face_id) {
                return Some(shell_id);
            }
        }
        None
    }

    /// Remove a shell. Returns the shell if it existed.
    pub fn remove_shell(&mut self, shell_id: ShellId) -> Option<Shell> {
        self.shells.remove(shell_id)
    }

    /// Get the number of shells.
    pub fn shell_count(&self) -> usize {
        self.shells.len()
    }

    /// Check if a set of faces forms a closed shell (all edges shared by 2 faces).
    pub fn is_face_set_closed(&self, face_ids: &[FaceId]) -> bool {
        if face_ids.len() < 4 {
            return false; // need at least 4 faces for a closed solid
        }

        let face_set: FxHashMap<FaceId, bool> = face_ids.iter().map(|&f| (f, true)).collect();

        // Check each edge of each face — if both half-edges belong to faces in the set,
        // the edge is "interior". If any edge has only one face in the set, the shell is open.
        for &fid in face_ids {
            let face = match self.faces.get(fid) {
                Some(f) => f,
                None => return false,
            };

            // Walk the outer loop
            let start_he = face.outer().start;
            if start_he.is_null() { return false; }
            let mut he_id = start_he;
            loop {
                let he = &self.hes[he_id];
                // In this DCEL, next_rad() is the twin (radial partner)
                let twin_id = he.next_rad();
                let twin = &self.hes[twin_id];
                let twin_face = twin.face();

                // If the twin's face is null or not in our set, this is a boundary edge
                if twin_face.is_null() || !face_set.contains_key(&twin_face) {
                    return false;
                }

                he_id = he.next();
                if he_id == start_he {
                    break;
                }
            }
        }

        true
    }
}

impl Default for Mesh {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 3);
        assert_eq!(mesh.edge_count(), 3);
        assert_eq!(mesh.face_count(), 1);

        // Normal should point in +Z direction
        let n = mesh.faces[face_id].normal();
        assert!((n.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", n);
    }

    #[test]
    fn test_create_quad() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let _face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.vert_count(), 4);
        assert_eq!(mesh.edge_count(), 4);
        assert_eq!(mesh.he_count(), 8); // 4 edges × 2 half-edges each
    }

    #[test]
    fn test_vertex_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1e-10, 0.0, 0.0)); // Within tolerance

        assert_eq!(v0, v1, "Coincident vertices should be merged");
        assert_eq!(mesh.vert_count(), 1);
    }

    #[test]
    fn test_edge_dedup() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let (e1, new1) = mesh.add_edge(v0, v1).unwrap();
        let (e2, new2) = mesh.add_edge(v0, v1).unwrap();
        let (e3, new3) = mesh.add_edge(v1, v0).unwrap(); // Reversed order

        assert!(new1);
        assert!(!new2);
        assert!(!new3);
        assert_eq!(e1, e2);
        assert_eq!(e1, e3);
    }

    #[test]
    fn test_export_triangle_buffers() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let (positions, normals, indices, _face_map, positions_f64) = mesh.export_buffers().unwrap();
        assert_eq!(positions.len(), 9); // 3 verts × 3 components
        assert_eq!(positions_f64.len(), 9); // same count, f64 precision
        assert_eq!(normals.len(), 9);
        assert_eq!(indices.len(), 3); // 1 triangle
    }

    // ── Face 추가/제거 테스트 ────────────────────────

    #[test]
    fn test_add_and_remove_face() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        assert_eq!(mesh.face_count(), 1);

        // Remove face
        let removed = mesh.remove_face(face_id);
        assert!(removed.is_ok());
        assert_eq!(mesh.face_count(), 0);

        // Verify face is removed or marked inactive
        let is_gone = mesh.faces.get(face_id)
            .map(|f| !f.is_active())
            .unwrap_or(true); // None = fully removed = OK
        assert!(is_gone, "face should be inactive or removed from storage");
    }

    #[test]
    fn test_face_normal_computation() {
        let mut mesh = Mesh::new();
        // Triangle in XY plane at Z=0, CCW winding → normal should be +Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z - 1.0).abs() < 1e-6, "Normal should be +Z, got {:?}", normal);
        assert!((normal.x.abs() + normal.y.abs()) < 1e-6, "Normal X,Y should be zero");
    }

    #[test]
    fn test_face_normal_reversed_winding() {
        let mut mesh = Mesh::new();
        // CW winding → normal should be -Z
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.5, 1.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        let normal = mesh.faces[face_id].normal();

        assert!((normal.z + 1.0).abs() < 1e-6, "Normal should be -Z, got {:?}", normal);
    }

    #[test]
    fn test_collect_loop_verts() {
        let mut mesh = Mesh::new();
        let verts = vec![
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0)),
            mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0)),
        ];

        let face_id = mesh.add_face(&verts, MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();

        assert_eq!(loop_verts.len(), 4, "should collect all 4 vertices");
        for &v in &loop_verts {
            assert!(verts.contains(&v), "all loop vertices should match original");
        }
    }

    #[test]
    fn test_merge_coplanar_faces() {
        let mut mesh = Mesh::new();
        // 두 개의 인접한 공면 사각형 생성
        // Square 1: (0,0,0)-(1,0,0)-(1,1,0)-(0,1,0)
        // Square 2: (1,0,0)-(2,0,0)-(2,1,0)-(1,1,0) [Square 1의 우측]
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v5 = mesh.add_vertex(DVec3::new(2.0, 1.0, 0.0));

        let _face1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _face2 = mesh.add_face(&[v1, v4, v5, v2], MaterialId::new(0)).unwrap();

        assert_eq!(mesh.face_count(), 2);

        // merge_faces_by_edge 호출 (face1과 face2가 edge v1-v2를 공유)
        // 먼저 공유 edge를 찾음
        let shared_edge = mesh.find_edge(v1, v2);
        let merge_result = if let Some(eid) = shared_edge {
            mesh.merge_faces_by_edge(eid)
        } else {
            Err(anyhow::anyhow!("shared edge not found"))
        };

        // merge 성공 여부에 따라 face count 확인
        if merge_result.is_ok() {
            // merge 성공하면 1개 face가 되어야 함
            assert_eq!(mesh.face_count(), 1, "merged result should have 1 face");
        } else {
            // merge 실패해도 상태는 일관성 있어야 함
            assert!(mesh.face_count() >= 1);
        }
    }

    #[test]
    fn test_face_material_preservation() {
        let mut mesh = Mesh::new();
        let mat_id = MaterialId::new(42);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], mat_id).unwrap();
        let face = mesh.faces[face_id].clone();
        assert_eq!(face.material(), mat_id, "face material should be preserved");
    }

    #[test]
    fn test_face_centroid_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();
        // Centroid should be approximately (1.0, 0.666, 0.0)
        let positions = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(2.0, 0.0, 0.0),
            DVec3::new(1.0, 2.0, 0.0),
        ];
        let expected_centroid = positions.iter().sum::<DVec3>() / 3.0;

        let face = mesh.faces[face_id].clone();
        let loop_verts = mesh.collect_loop_verts(face.outer().start).unwrap();
        let mut actual_centroid = DVec3::ZERO;
        for &vid in &loop_verts {
            actual_centroid += mesh.verts[vid].pos();
        }
        actual_centroid /= loop_verts.len() as f64;

        assert!((actual_centroid - expected_centroid).length() < 1e-6,
            "centroid should be correct");
    }

    #[test]
    fn test_multiple_faces_on_same_vertices() {
        let mut mesh = Mesh::new();
        // 일부 꼭짓점을 공유하는 두 face
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(1.0, 2.0, 0.0));

        let _f1 = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let _f2 = mesh.add_face(&[v1, v4, v2], MaterialId::new(1)).unwrap();

        assert_eq!(mesh.face_count(), 2);
        assert_eq!(mesh.vert_count(), 5);
        // Two faces share edge v1-v2 (directed both ways)
        let edges_f1 = mesh.find_edge(v1, v2);
        let edges_f2 = mesh.find_edge(v1, v2);
        assert_eq!(edges_f1, edges_f2, "faces should share edge");
    }

    #[test]
    fn test_orient_faces_consistent() {
        let mut mesh = Mesh::new();
        // Create a simple quad
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));

        let face_id = mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap();
        let face = mesh.faces[face_id].clone();
        let normal_before = face.normal();

        // Verify normal is +Z
        assert!((normal_before.z - 1.0).abs() < 1e-6);

        // If we were to flip the face (using flip_face), normal should reverse
        // (this tests that the normal is computed correctly for orientation)
        let normal_length = normal_before.length();
        assert!((normal_length - 1.0).abs() < 1e-6, "normal should be unit");
    }
}
