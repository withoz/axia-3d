//! ADR-094 Path B helpers — Multi-loop face schema + render hints.
//!
//! Extracted from `mesh.rs` (Tier 2-A Stack #3, 2026-05-16, LOCKED #44
//! complete meaning per merge). All ADR-094 Path B "additive prep"
//! helpers grouped — multi-loop schema (Mesh-level Map per ADR-091
//! §E L1), Cylinder Path B default flag, and SOFT render flag for
//! curved-surface tessellation chord rings.
//!
//! ## Contents
//!
//! - `Mesh::set_face_boundary_loops` — multi-loop schema setter
//! - `Mesh::clear_face_boundary_loops` — schema clear
//! - `Mesh::face_boundary_loops` — effective loops getter (multi-loop OR legacy)
//! - `Mesh::face_has_multi_loop_schema` — Path B dispatch query
//! - `Mesh::set_cylinder_path_b_default` — ADR-094 B-η production flag
//! - `Mesh::cylinder_path_b_default` — flag reader
//! - `Mesh::set_sphere_path_b_default` — ADR-104 β-1-ζ production flag
//! - `Mesh::sphere_path_b_default` — flag reader
//! - `Mesh::set_cone_path_b_default` — ADR-104 β-2-ζ production flag
//! - `Mesh::cone_path_b_default` — flag reader
//! - `Mesh::set_torus_path_b_default` — ADR-104 β-3-ζ production flag
//! - `Mesh::torus_path_b_default` — flag reader
//! - `Mesh::mark_face_outer_soft` — SOFT flag on outer loop HEs (render hint)
//!
//! ## ADR cross-link
//!
//! - ADR-094 B-γ-prep — face_to_boundary_loops Mesh-level Map
//! - ADR-094 B-η — Cylinder Path B-full production default
//! - ADR-091 §E L1 — Mesh-level Map canonical (struct field 추가 0)
//! - LOCKED #44 — complete meaning per merge

use anyhow::Result;

use crate::entities::*;
use crate::mesh::Mesh;

impl Mesh {
    // ════════════════════════════════════════════════════════════════
    // ADR-094 B-γ-prep — Multi-loop face schema (Path B-full additive
    // prep phase).
    //
    // Mesh-level map (per ADR-091 §E L1 canonical) carries the new
    // `Vec<LoopRef>` representation alongside the legacy `Face::outer +
    // inners` schema. During prep, both coexist — set explicitly via
    // `set_face_boundary_loops`. B-η flip migrates canonical ops.
    // ════════════════════════════════════════════════════════════════

    /// ADR-094 B-γ-prep — Set the multi-loop boundary representation
    /// for a face.
    ///
    /// Additive: `Face::outer + inners`는 변경되지 않음 — caller 가
    /// 동시에 `face.outer / inners` 갱신 책임 지지 않음. B-η flip 후
    /// canonical 표현은 본 map (effective getter `face_boundary_loops`).
    ///
    /// Returns `false` if face is missing or inactive. Empty `loops`
    /// vector → equivalent to `clear` (defensive: explicit None for
    /// "go back to legacy" 의미는 별도 `clear_face_boundary_loops`).
    pub fn set_face_boundary_loops(
        &mut self,
        face_id: FaceId,
        loops: Vec<LoopRef>,
    ) -> bool {
        let face_active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !face_active {
            return false;
        }
        if loops.is_empty() {
            self.face_to_boundary_loops.remove(&face_id);
        } else {
            self.face_to_boundary_loops.insert(face_id, loops);
        }
        true
    }

    /// ADR-094 B-γ-prep — Clear the multi-loop schema for a face,
    /// returning to legacy `Face::outer + inners`. Returns true if an
    /// entry was removed.
    pub fn clear_face_boundary_loops(&mut self, face_id: FaceId) -> bool {
        self.face_to_boundary_loops.remove(&face_id).is_some()
    }

    /// ADR-094 B-γ-prep — Effective boundary loops getter.
    ///
    /// **Multi-loop schema 우선**: `face_to_boundary_loops` 에 entry 가
    /// 있으면 그 `Vec<LoopRef>` 반환 (Path B 표현). 없으면 legacy 폴백
    /// — `[face.outer]` + `face.inners` 결합한 vec 반환.
    ///
    /// Returns empty vec if face is missing or inactive.
    ///
    /// **Prep phase 사용 패턴**:
    /// - Render / Boolean / Push-Pull ops 가 점진 migration 시 본
    ///   getter 호출 → coexist 안전
    /// - B-η flip 시 ops 가 `face.outer` / `face.inners` 직접 read 를
    ///   본 effective getter 로 전환
    pub fn face_boundary_loops(&self, face_id: FaceId) -> Vec<LoopRef> {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return Vec::new(); }

        if let Some(loops) = self.face_to_boundary_loops.get(&face_id) {
            return loops.clone();
        }

        // Legacy fallback: outer + inners.
        let face = &self.faces[face_id];
        let mut loops = Vec::with_capacity(1 + face.inners().len());
        loops.push(face.outer());
        loops.extend_from_slice(face.inners());
        loops
    }

    /// ADR-094 B-η — Set the Path B cylinder default. See field doc on
    /// `Mesh::cylinder_path_b_default` for semantics.
    ///
    /// Production layer should call this once at startup (after reading
    /// localStorage `axia:cylinder-path-b-mode`). Test layer may toggle
    /// per-test as needed.
    pub fn set_cylinder_path_b_default(&mut self, on: bool) {
        self.cylinder_path_b_default = on;
    }

    /// ADR-094 B-η — Read the Path B cylinder default flag.
    pub fn cylinder_path_b_default(&self) -> bool {
        self.cylinder_path_b_default
    }

    /// ADR-104 β-1-ζ — Set the Path B sphere default. See field doc on
    /// `Mesh::sphere_path_b_default` for semantics.
    ///
    /// Production layer should call this once at startup (after reading
    /// localStorage `axia:sphere-path-b-mode`). Test layer may toggle
    /// per-test as needed. Mirrors `set_cylinder_path_b_default`
    /// pattern (ADR-094 B-η canonical).
    pub fn set_sphere_path_b_default(&mut self, on: bool) {
        self.sphere_path_b_default = on;
    }

    /// ADR-104 β-1-ζ — Read the Path B sphere default flag.
    pub fn sphere_path_b_default(&self) -> bool {
        self.sphere_path_b_default
    }

    /// ADR-104 β-2-ζ — Set the Path B cone default. See field doc on
    /// `Mesh::cone_path_b_default` for semantics.
    ///
    /// Production layer should call this once at startup (after reading
    /// localStorage `axia:cone-path-b-mode`). Test layer may toggle
    /// per-test as needed. Mirrors `set_sphere_path_b_default` /
    /// `set_cylinder_path_b_default` patterns.
    pub fn set_cone_path_b_default(&mut self, on: bool) {
        self.cone_path_b_default = on;
    }

    /// ADR-104 β-2-ζ — Read the Path B cone default flag.
    pub fn cone_path_b_default(&self) -> bool {
        self.cone_path_b_default
    }

    /// ADR-104 β-3-ζ — Set the Path B torus default. See field doc on
    /// `Mesh::torus_path_b_default` for semantics.
    ///
    /// Production layer should call this once at startup (after reading
    /// localStorage `axia:torus-path-b-mode`). Test layer may toggle
    /// per-test as needed. Mirrors `set_cone_path_b_default` /
    /// `set_sphere_path_b_default` / `set_cylinder_path_b_default` patterns.
    ///
    /// **Note**: Torus has no Path A polygonal baseline (kernel-native only
    /// from day 1). Flag exists for pattern consistency + future Path A
    /// dispatch hook.
    pub fn set_torus_path_b_default(&mut self, on: bool) {
        self.torus_path_b_default = on;
    }

    /// ADR-104 β-3-ζ — Read the Path B torus default flag.
    pub fn torus_path_b_default(&self) -> bool {
        self.torus_path_b_default
    }

    /// ADR-094 B-γ-prep — Distinguishes Path B multi-loop schema vs
    /// legacy `Face::outer + inners`.
    ///
    /// Returns `true` iff the face has an explicit entry in
    /// `face_to_boundary_loops` (Path B canonical). Used by Render /
    /// Boolean / Push-Pull dispatch to route additive prep code paths.
    ///
    /// Returns `false` if face is missing/inactive (treated as legacy
    /// for defensive consistency).
    pub fn face_has_multi_loop_schema(&self, face_id: FaceId) -> bool {
        let active = self.faces.get(face_id)
            .map(|f| f.is_active())
            .unwrap_or(false);
        if !active { return false; }
        self.face_to_boundary_loops.contains_key(&face_id)
    }

    /// Mark all half-edges in a face's outer loop as SOFT on both sides (twin too).
    ///
    /// Used by primitive creation (cylinder/cone caps) to suppress rendering of
    /// the tessellation chord ring so curved surfaces appear truly smooth.
    /// The underlying topology is unchanged — only the render filter is affected.
    pub fn mark_face_outer_soft(&mut self, face_id: FaceId) -> Result<()> {
        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;
        let start = face.outer().start;
        if start.is_null() { return Ok(()); }
        let hes = self.collect_loop_hes(start)?;
        for &he_id in &hes {
            if let Some(h) = self.hes.get_mut(he_id) {
                let mut f = h.flags();
                f.insert(HeFlags::SOFT);
                h.set_flags(f);
            }
            // twin on same edge (manifold: next_rad)
            let twin = self.hes.get(he_id).map(|h| h.next_rad()).unwrap_or_default();
            if !twin.is_null() && twin != he_id {
                if let Some(h) = self.hes.get_mut(twin) {
                    let mut f = h.flags();
                    f.insert(HeFlags::SOFT);
                    h.set_flags(f);
                }
            }
        }
        Ok(())
    }
}
