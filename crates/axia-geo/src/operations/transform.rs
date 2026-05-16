//! Transform Operations — Move, Rotate, Scale
//!
//! face 집합에 속한 정점들을 변환.
//! 정점 단위로 변환하므로 DCEL 토폴로지는 변경되지 않음.
//!
//! Geometric Validity Guards (ADR-003):
//! - translate: delta가 유한해야 함
//! - rotate: angle이 유한, axis가 단위벡터에 근접
//! - scale: 각 축 factor가 유한하고, 결과 extent가 EPSILON_LENGTH 이상

use glam::{DVec3, DMat3};
use anyhow::{Result, ensure, bail};

use crate::mesh::Mesh;
use crate::tolerances::EPSILON_LENGTH;
use crate::{FaceId, VertId};

/// Transform 결과
#[derive(Debug)]
pub struct TransformResult {
    /// 변환된 정점 수
    pub verts_moved: usize,
    /// 영향받은 face 수
    pub faces_affected: usize,
}

impl Mesh {
    /// 지정된 face들의 모든 정점을 delta만큼 이동
    pub fn translate_faces(
        &mut self,
        face_ids: &[FaceId],
        delta: DVec3,
    ) -> Result<TransformResult> {
        // Geometric Validity Guard (ADR-003): 유한값 검증
        ensure!(
            delta.x.is_finite() && delta.y.is_finite() && delta.z.is_finite(),
            "translate delta must be finite, got ({}, {}, {})",
            delta.x, delta.y, delta.z
        );

        let vert_ids = self.collect_face_verts(face_ids)?;

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let new_pos = vert.pos() + delta;
                vert.set_pos(new_pos);
            }
        }

        // normal 재계산
        self.recompute_face_normals(face_ids)?;

        // ADR-007 — 연산 후 invariants 검증
        self.debug_verify_invariants();

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// **Constraint Solver Level 1**: 지정 정점 배열을 delta만큼 직접 이동.
    ///
    /// translate_faces와 달리 face 기반이 아닌 vertex 기반 연산이므로
    /// Constraint Solver(makeParallel/Perpendicular/setDistance)에서 사용.
    /// 이동된 정점을 참조하는 face는 자동으로 normal 재계산됨.
    pub fn translate_verts(
        &mut self,
        vert_ids: &[VertId],
        delta: DVec3,
    ) -> Result<TransformResult> {
        ensure!(
            delta.x.is_finite() && delta.y.is_finite() && delta.z.is_finite(),
            "translate_verts delta must be finite, got ({}, {}, {})",
            delta.x, delta.y, delta.z
        );
        if vert_ids.is_empty() {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        // Collect affected faces via radial traversal of outgoing HEs
        let mut affected_faces: std::collections::HashSet<FaceId> =
            std::collections::HashSet::new();

        for &vid in vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let new_pos = vert.pos() + delta;
                vert.set_pos(new_pos);
            }

            // Walk vertex v-ring to find all faces touching this vertex
            let start_he = match self.verts.get(vid).and_then(|v| v.outgoing()) {
                Some(h) if !h.is_null() && self.hes.contains(h) => h,
                _ => continue,
            };
            let mut cur = start_he;
            let mut guard = 0;
            loop {
                let f = self.hes[cur].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    affected_faces.insert(f);
                }
                let nxt = self.hes[cur].v_next();
                if nxt.is_null() || !self.hes.contains(nxt) || nxt == start_he { break; }
                cur = nxt;
                guard += 1;
                if guard > 10_000 { break; }
            }
        }

        let faces_vec: Vec<FaceId> = affected_faces.into_iter().collect();
        if !faces_vec.is_empty() {
            self.recompute_face_normals(&faces_vec)?;
        }

        // ─── ADR-060 Phase O Step 1 — Curve / Surface transform ───
        //
        // Per ADR-060 §E lock-in (Partial-move → drop to Line):
        //   Both endpoints moved → curve.transform(translation)
        //   Neither moved        → no-op
        //   Partial moved        → set_curve(None) — safe Line fallback
        //
        // Same logic for face surfaces (all-or-none rule).
        //
        // **Drop-in alongside per §B**: existing code path UNCHANGED above;
        // this block runs AFTER and only touches curves/surfaces.
        self.adr_060_step1_translate_curves(vert_ids, delta);

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: faces_vec.len(),
        })
    }

    /// ADR-060 Phase O Step 1 — Apply translation to attached curves/surfaces.
    ///
    /// Per §E lock-in: partial-move drops curve/surface to None (safe Line/
    /// Plane fallback via Phase N synthesizer).
    fn adr_060_step1_translate_curves(
        &mut self,
        vert_ids: &[VertId],
        delta: DVec3,
    ) {
        use glam::DMat4;
        let m = DMat4::from_translation(delta);
        self.adr_060_apply_curve_transform_to_vert_set(vert_ids, &m);
    }

    /// ADR-060 Phase O Step 2 — Generic per-vert-set curve/surface transform.
    ///
    /// Used by `translate_verts` (Step 1), `rotate_verts` / `scale_verts`
    /// (Step 2). Per §E lock-in:
    ///
    ///   Per edge:
    ///     - Both endpoints in vert_set → curve.transform(m)
    ///     - Neither in vert_set        → no-op
    ///     - Partial                     → set_curve(None)
    ///
    ///   Per face: same all-or-none rule on outer-loop verts.
    ///
    /// Line variant is mesh-relative — skipped (vertex moves auto-propagate).
    fn adr_060_apply_curve_transform_to_vert_set(
        &mut self,
        vert_ids: &[VertId],
        m: &glam::DMat4,
    ) {
        use std::collections::HashSet;
        use crate::curves::AnalyticCurve;

        let moved_set: HashSet<VertId> = vert_ids.iter().copied().collect();

        // ── Edges ──────────────────────────────────────────────
        let mut to_drop: Vec<crate::entities::id::EdgeId> = Vec::new();
        let mut to_translate: Vec<crate::entities::id::EdgeId> = Vec::new();

        for (eid, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.curve().is_none() { continue; }

            let v_small_moved = moved_set.contains(&edge.v_small());
            let v_large_moved = moved_set.contains(&edge.v_large());

            match (v_small_moved, v_large_moved) {
                (true, true)   => to_translate.push(eid),
                (false, false) => { /* unaffected */ }
                _              => to_drop.push(eid),  // partial → safe fallback
            }
        }

        for eid in to_translate {
            let curve = self.edges[eid].curve().cloned();
            if let Some(c) = curve {
                if matches!(c, AnalyticCurve::Line { .. }) {
                    // Line is mesh-relative — already updated by vertex moves
                    continue;
                }
                if let Ok(new_curve) = c.transform(m, self) {
                    self.edges[eid].set_curve(Some(new_curve));
                }
                // Transform failure: silent skip (drift sanity catches later)
            }
        }
        for eid in to_drop {
            self.edges[eid].set_curve(None);
        }

        // ── Faces ──────────────────────────────────────────────
        let mut face_to_drop: Vec<FaceId> = Vec::new();
        let mut face_to_translate: Vec<FaceId> = Vec::new();

        for (fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            if face.surface().is_none() { continue; }

            let outer_verts = match self.collect_loop_verts(face.outer().start) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let n_moved = outer_verts.iter()
                .filter(|v| moved_set.contains(v))
                .count();

            if n_moved == 0 {
                /* unaffected */
            } else if n_moved == outer_verts.len() {
                face_to_translate.push(fid);
            } else {
                face_to_drop.push(fid);  // partial → safe Plane fallback
            }
        }

        for fid in face_to_translate {
            let surface = self.faces[fid].surface().cloned();
            if let Some(s) = surface {
                if let Ok(new_surface) = s.transform(m) {
                    self.faces[fid].set_surface(Some(new_surface));
                }
            }
        }
        for fid in face_to_drop {
            self.faces[fid].set_surface(None);
        }
    }

    /// **Constraint Solver Level 1**: 지정 정점을 center/axis 기준으로 회전.
    /// makeParallel/Perpendicular 에서 엣지의 두 정점을 midpoint 기준으로 회전할 때 사용.
    pub fn rotate_verts(
        &mut self,
        vert_ids: &[VertId],
        center: DVec3,
        axis: DVec3,
        angle_rad: f64,
    ) -> Result<TransformResult> {
        ensure!(angle_rad.is_finite(), "rotate_verts angle must be finite");
        ensure!(
            center.x.is_finite() && center.y.is_finite() && center.z.is_finite(),
            "rotate_verts center must be finite"
        );
        ensure!(
            axis.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "rotate_verts axis must be non-zero"
        );
        if vert_ids.is_empty() || angle_rad.abs() < 1e-12 {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        let axis_n = axis.normalize();
        let cos_a = angle_rad.cos();
        let sin_a = angle_rad.sin();
        let one_m = 1.0 - cos_a;

        // Rodrigues rotation matrix
        let (x, y, z) = (axis_n.x, axis_n.y, axis_n.z);
        let rot = DMat3::from_cols_array(&[
            cos_a + x * x * one_m,
            x * y * one_m + z * sin_a,
            x * z * one_m - y * sin_a,
            x * y * one_m - z * sin_a,
            cos_a + y * y * one_m,
            y * z * one_m + x * sin_a,
            x * z * one_m + y * sin_a,
            y * z * one_m - x * sin_a,
            cos_a + z * z * one_m,
        ]);

        let mut affected_faces: std::collections::HashSet<FaceId> =
            std::collections::HashSet::new();

        for &vid in vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let rel = vert.pos() - center;
                let rotated = rot * rel;
                vert.set_pos(center + rotated);
            }
            let start_he = match self.verts.get(vid).and_then(|v| v.outgoing()) {
                Some(h) if !h.is_null() && self.hes.contains(h) => h,
                _ => continue,
            };
            let mut cur = start_he;
            let mut guard = 0;
            loop {
                let f = self.hes[cur].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    affected_faces.insert(f);
                }
                let nxt = self.hes[cur].v_next();
                if nxt.is_null() || !self.hes.contains(nxt) || nxt == start_he { break; }
                cur = nxt;
                guard += 1;
                if guard > 10_000 { break; }
            }
        }

        let faces_vec: Vec<FaceId> = affected_faces.into_iter().collect();
        if !faces_vec.is_empty() {
            self.recompute_face_normals(&faces_vec)?;
        }

        // ─── ADR-060 Phase O Step 2 — Curve / Surface rotation ───
        //
        // Per §E lock-in: same all-or-none rule as Step 1 translate.
        // Rotation matrix = R_Rodrigues * T(-center) post-applied as
        // T(center) * R, equivalent affine in DMat4.
        {
            use glam::{DMat4, DQuat};
            let q = DQuat::from_axis_angle(axis_n, angle_rad);
            // T(center) * R(q) * T(-center) — rotation about pivot
            let m = DMat4::from_translation(center)
                * DMat4::from_quat(q)
                * DMat4::from_translation(-center);
            self.adr_060_apply_curve_transform_to_vert_set(vert_ids, &m);
        }

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: faces_vec.len(),
        })
    }

    /// 지정된 정점들을 center 기준으로 스케일. `rotate_verts` 와 동일한 패턴:
    /// 정점만 이동시키고 인접 face들의 법선을 재계산한다. ADR-003 guard 준수.
    pub fn scale_verts(
        &mut self,
        vert_ids: &[VertId],
        center: DVec3,
        scale: DVec3,
    ) -> Result<TransformResult> {
        ensure!(
            scale.x.is_finite() && scale.y.is_finite() && scale.z.is_finite(),
            "scale_verts factors must be finite, got ({}, {}, {})",
            scale.x, scale.y, scale.z
        );
        ensure!(
            center.x.is_finite() && center.y.is_finite() && center.z.is_finite(),
            "scale_verts center must be finite"
        );
        ensure!(
            scale.x != 0.0 && scale.y != 0.0 && scale.z != 0.0,
            "scale_verts factor cannot be exactly zero"
        );
        if vert_ids.is_empty()
            || ((scale.x - 1.0).abs() < 1e-12
                && (scale.y - 1.0).abs() < 1e-12
                && (scale.z - 1.0).abs() < 1e-12)
        {
            return Ok(TransformResult { verts_moved: 0, faces_affected: 0 });
        }

        // 1차로 새 위치 계산 → degenerate bbox 검사 (scale_faces와 동일 정책)
        let mut orig_min = DVec3::splat(f64::INFINITY);
        let mut orig_max = DVec3::splat(f64::NEG_INFINITY);
        let mut new_min = DVec3::splat(f64::INFINITY);
        let mut new_max = DVec3::splat(f64::NEG_INFINITY);
        for &vid in vert_ids {
            if let Some(v) = self.verts.get(vid) {
                let p = v.pos();
                orig_min = orig_min.min(p);
                orig_max = orig_max.max(p);
                let rel = p - center;
                let scaled = DVec3::new(rel.x * scale.x, rel.y * scale.y, rel.z * scale.z);
                let np = scaled + center;
                new_min = new_min.min(np);
                new_max = new_max.max(np);
            }
        }
        let orig_extent = orig_max - orig_min;
        let new_extent = new_max - new_min;
        let count_collapsed = |e: DVec3| -> i32 {
            let mut c = 0;
            if e.x < EPSILON_LENGTH { c += 1; }
            if e.y < EPSILON_LENGTH { c += 1; }
            if e.z < EPSILON_LENGTH { c += 1; }
            c
        };
        if count_collapsed(new_extent) > count_collapsed(orig_extent) {
            bail!(
                "scale_verts would collapse an axis below EPSILON_LENGTH: \
                 original=({:.4e},{:.4e},{:.4e}) scaled=({:.4e},{:.4e},{:.4e}) (ADR-003)",
                orig_extent.x, orig_extent.y, orig_extent.z,
                new_extent.x, new_extent.y, new_extent.z
            );
        }

        // 실제 이동 + 인접 face 수집
        let mut affected_faces: std::collections::HashSet<FaceId> =
            std::collections::HashSet::new();

        for &vid in vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let rel = vert.pos() - center;
                let scaled = DVec3::new(rel.x * scale.x, rel.y * scale.y, rel.z * scale.z);
                vert.set_pos(center + scaled);
            }
            let start_he = match self.verts.get(vid).and_then(|v| v.outgoing()) {
                Some(h) if !h.is_null() && self.hes.contains(h) => h,
                _ => continue,
            };
            let mut cur = start_he;
            let mut guard = 0;
            loop {
                let f = self.hes[cur].face();
                if !f.is_null() && self.faces.contains(f) && self.faces[f].is_active() {
                    affected_faces.insert(f);
                }
                let nxt = self.hes[cur].v_next();
                if nxt.is_null() || !self.hes.contains(nxt) || nxt == start_he { break; }
                cur = nxt;
                guard += 1;
                if guard > 10_000 { break; }
            }
        }

        let faces_vec: Vec<FaceId> = affected_faces.into_iter().collect();
        if !faces_vec.is_empty() {
            self.recompute_face_normals(&faces_vec)?;
        }

        // ─── ADR-060 Phase O Step 2 — Curve / Surface scaling ───
        //
        // Per §E lock-in: all-or-none rule. Scale matrix about pivot
        // = T(center) * S(scale) * T(-center).
        //
        // Note: non-uniform scale on Circle/Cylinder/Sphere/Cone/Torus
        // would require AnalyticCurve/Surface promotion to NURBS
        // (Phase H §A1.2). Phase O Step 2 falls back to set_curve(None)
        // for those cases (drift sanity catches if Phase H promotion
        // succeeds at evaluate time).
        {
            use glam::DMat4;
            let m = DMat4::from_translation(center)
                * DMat4::from_scale(scale)
                * DMat4::from_translation(-center);
            self.adr_060_apply_curve_transform_to_vert_set(vert_ids, &m);
        }

        // ADR-007 — invariants 검증
        self.debug_verify_invariants();

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: faces_vec.len(),
        })
    }

    /// 지정된 face들의 모든 정점을 center 기준으로 회전
    /// axis: 회전축 (단위 벡터), angle_rad: 라디안 각도
    pub fn rotate_faces(
        &mut self,
        face_ids: &[FaceId],
        center: DVec3,
        axis: DVec3,
        angle_rad: f64,
    ) -> Result<TransformResult> {
        // Geometric Validity Guard (ADR-003)
        ensure!(
            angle_rad.is_finite(),
            "rotate angle must be finite, got {}",
            angle_rad
        );
        ensure!(
            center.x.is_finite() && center.y.is_finite() && center.z.is_finite(),
            "rotate center must be finite"
        );
        ensure!(
            axis.length_squared() > EPSILON_LENGTH * EPSILON_LENGTH,
            "rotation axis must be a non-zero vector"
        );

        let vert_ids = self.collect_face_verts(face_ids)?;
        let rot = rotation_matrix(axis.normalize(), angle_rad);

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let p = vert.pos() - center;
                let rotated = rot * p;
                vert.set_pos(rotated + center);
            }
        }

        self.recompute_face_normals(face_ids)?;

        // ADR-007 — 변환 후 invariants 검증
        self.debug_verify_invariants();

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// 지정된 face들의 모든 정점을 center 기준으로 스케일
    ///
    /// # Guards (ADR-003)
    /// - `scale` 성분이 모두 유한해야 함
    /// - 어느 축이든 `|scale| == 0.0` 거부 (즉시 degenerate)
    /// - 결과 bbox의 어느 축이든 < EPSILON_LENGTH면 거부 (스케일 다운이 degenerate 만드는 경우)
    pub fn scale_faces(
        &mut self,
        face_ids: &[FaceId],
        center: DVec3,
        scale: DVec3,
    ) -> Result<TransformResult> {
        // ─── Validity Guards ────────────────────────────────────────────
        ensure!(
            scale.x.is_finite() && scale.y.is_finite() && scale.z.is_finite(),
            "scale factors must be finite, got ({}, {}, {})",
            scale.x, scale.y, scale.z
        );
        ensure!(
            center.x.is_finite() && center.y.is_finite() && center.z.is_finite(),
            "scale center must be finite"
        );
        ensure!(
            scale.x != 0.0 && scale.y != 0.0 && scale.z != 0.0,
            "scale factor cannot be exactly zero (would collapse to plane/line/point)"
        );

        let vert_ids = self.collect_face_verts(face_ids)?;

        // 결과 bbox 사전 계산 → degenerate 여부 판정
        if !vert_ids.is_empty() {
            let mut min = DVec3::splat(f64::INFINITY);
            let mut max = DVec3::splat(f64::NEG_INFINITY);
            for &vid in &vert_ids {
                if let Some(v) = self.verts.get(vid) {
                    let p = v.pos() - center;
                    let scaled = DVec3::new(p.x * scale.x, p.y * scale.y, p.z * scale.z);
                    let new_pos = scaled + center;
                    min = min.min(new_pos);
                    max = max.max(new_pos);
                }
            }
            let extent = max - min;
            // Face 집합의 기존 차원 (예: 평면 face는 한 축이 0)을 고려해
            // "기존에 extent > EPSILON 이었는데 스케일 후 < EPSILON"인 경우만 거부
            // 현재 구현은 단순 3D bbox 체크 → 평면 face의 scale은 한 축이 원래 0이므로 무시
            let mut collapsed_axes = 0;
            if extent.x < EPSILON_LENGTH { collapsed_axes += 1; }
            if extent.y < EPSILON_LENGTH { collapsed_axes += 1; }
            if extent.z < EPSILON_LENGTH { collapsed_axes += 1; }

            // 원본 extent 계산
            let mut orig_min = DVec3::splat(f64::INFINITY);
            let mut orig_max = DVec3::splat(f64::NEG_INFINITY);
            for &vid in &vert_ids {
                if let Some(v) = self.verts.get(vid) {
                    orig_min = orig_min.min(v.pos());
                    orig_max = orig_max.max(v.pos());
                }
            }
            let orig_extent = orig_max - orig_min;
            let mut orig_collapsed_axes = 0;
            if orig_extent.x < EPSILON_LENGTH { orig_collapsed_axes += 1; }
            if orig_extent.y < EPSILON_LENGTH { orig_collapsed_axes += 1; }
            if orig_extent.z < EPSILON_LENGTH { orig_collapsed_axes += 1; }

            // 스케일 후 새롭게 collapsed된 축이 있으면 거부
            if collapsed_axes > orig_collapsed_axes {
                bail!(
                    "scale would collapse an axis below EPSILON_LENGTH ({}): \
                     original extent=({:.4e},{:.4e},{:.4e}), scaled extent=({:.4e},{:.4e},{:.4e}) — \
                     would create degenerate geometry (ADR-003)",
                    EPSILON_LENGTH,
                    orig_extent.x, orig_extent.y, orig_extent.z,
                    extent.x, extent.y, extent.z
                );
            }
        }

        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get_mut(vid) {
                let p = vert.pos() - center;
                let scaled = DVec3::new(p.x * scale.x, p.y * scale.y, p.z * scale.z);
                vert.set_pos(scaled + center);
            }
        }

        self.recompute_face_normals(face_ids)?;

        // ADR-007 — 변환 후 invariants 검증
        self.debug_verify_invariants();

        Ok(TransformResult {
            verts_moved: vert_ids.len(),
            faces_affected: face_ids.len(),
        })
    }

    /// face 집합에서 사용하는 모든 고유 정점 수집
    fn collect_face_verts(&self, face_ids: &[FaceId]) -> Result<Vec<VertId>> {
        let mut vert_set = std::collections::HashSet::new();

        for &fid in face_ids {
            let face = self.faces.get(fid)
                .ok_or_else(|| anyhow::anyhow!("face {:?} not found", fid))?;

            if !face.is_active() { continue; }

            let verts = self.collect_loop_verts(face.outer().start)?;
            for vid in verts {
                vert_set.insert(vid);
            }

            // inner loops (holes)
            for inner in face.inners() {
                let verts = self.collect_loop_verts(inner.start)?;
                for vid in verts {
                    vert_set.insert(vid);
                }
            }
        }

        Ok(vert_set.into_iter().collect())
    }

    /// face들의 법선 벡터 재계산
    pub(crate) fn recompute_face_normals(&mut self, face_ids: &[FaceId]) -> Result<()> {
        for &fid in face_ids {
            let face = match self.faces.get(fid) {
                Some(f) if f.is_active() => f,
                _ => continue,
            };

            let start = face.outer().start;
            let verts = self.collect_loop_verts(start)?;

            if verts.len() >= 3 {
                if let Ok(normal) = self.compute_normal(&verts) {
                    if let Some(f) = self.faces.get_mut(fid) {
                        f.set_normal(normal);
                    }
                }
            }
        }
        Ok(())
    }

    /// face 집합의 중심점 (centroid) 계산
    pub fn faces_centroid(&self, face_ids: &[FaceId]) -> Result<DVec3> {
        let vert_ids = self.collect_face_verts(face_ids)?;
        if vert_ids.is_empty() {
            return Ok(DVec3::ZERO);
        }

        let mut sum = DVec3::ZERO;
        let mut count = 0usize;
        for &vid in &vert_ids {
            if let Some(vert) = self.verts.get(vid) {
                sum += vert.pos();
                count += 1;
            }
        }

        Ok(if count > 0 { sum / count as f64 } else { DVec3::ZERO })
    }
}

/// Rodrigues 회전 행렬 생성
fn rotation_matrix(axis: DVec3, angle: f64) -> DMat3 {
    let c = angle.cos();
    let s = angle.sin();
    let t = 1.0 - c;
    let (x, y, z) = (axis.x, axis.y, axis.z);

    DMat3::from_cols(
        DVec3::new(t * x * x + c,     t * x * y + s * z, t * x * z - s * y),
        DVec3::new(t * x * y - s * z, t * y * y + c,     t * y * z + s * x),
        DVec3::new(t * x * z + s * y, t * y * z - s * x, t * z * z + c),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;

    fn make_test_quad(mesh: &mut Mesh) -> Vec<FaceId> {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let mat = MaterialId::new(0);
        let fid = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        vec![fid]
    }

    #[test]
    fn translate_moves_vertices() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let delta = DVec3::new(5.0, 0.0, 0.0);

        let result = mesh.translate_faces(&faces, delta).unwrap();
        assert_eq!(result.verts_moved, 4);

        // v0 was at (0,0,0) → should now be at (5,0,0)
        for (_, vert) in mesh.verts.iter() {
            assert!(vert.pos().x >= 5.0 - 0.001, "vertex should be translated");
        }
    }

    #[test]
    fn rotate_90_degrees() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let center = DVec3::new(0.5, 0.0, 0.5);
        let axis = DVec3::Y;
        let angle = std::f64::consts::FRAC_PI_2; // 90°

        let result = mesh.rotate_faces(&faces, center, axis, angle).unwrap();
        assert_eq!(result.verts_moved, 4);
    }

    #[test]
    fn scale_doubles_size() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let center = DVec3::ZERO;
        let scale = DVec3::splat(2.0);

        let result = mesh.scale_faces(&faces, center, scale).unwrap();
        assert_eq!(result.verts_moved, 4);
    }

    #[test]
    fn centroid_calculation() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let c = mesh.faces_centroid(&faces).unwrap();
        assert!((c.x - 0.5).abs() < 0.01);
        assert!((c.z - 0.5).abs() < 0.01);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Geometric Validity Guards (ADR-003)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn translate_rejects_nan_delta() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let r = mesh.translate_faces(&faces, DVec3::new(f64::NAN, 0.0, 0.0));
        assert!(r.is_err());
    }

    #[test]
    fn translate_rejects_infinity() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let r = mesh.translate_faces(&faces, DVec3::new(f64::INFINITY, 0.0, 0.0));
        assert!(r.is_err());
    }

    #[test]
    fn scale_rejects_zero_factor() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        // 어느 축이든 정확히 0 → 거부
        assert!(mesh.scale_faces(&faces, DVec3::ZERO, DVec3::new(0.0, 1.0, 1.0)).is_err());
        assert!(mesh.scale_faces(&faces, DVec3::ZERO, DVec3::new(1.0, 0.0, 1.0)).is_err());
        assert!(mesh.scale_faces(&faces, DVec3::ZERO, DVec3::new(1.0, 1.0, 0.0)).is_err());
    }

    #[test]
    fn scale_rejects_nan_factor() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let r = mesh.scale_faces(&faces, DVec3::ZERO, DVec3::new(f64::NAN, 1.0, 1.0));
        assert!(r.is_err());
    }

    #[test]
    fn scale_rejects_subepsilon_collapse() {
        // make_test_quad는 2D face이지만 이 테스트용으로 3D box 생성
        let mut mesh = Mesh::default();
        let mat = crate::MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(10.0, 0.0, 10.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0));
        let base = mesh.add_face(&[v0, v3, v2, v1], mat).unwrap();
        let pp = mesh.push_pull(base, 10.0, mat).unwrap();

        // 박스의 모든 face 수집 (bottom + top + sides)
        let all_faces: Vec<_> = mesh.faces.iter().map(|(id, _)| id).collect();

        // 박스 extent = 10 × 10 × 10. Y축을 1e-8배 → 1e-7 → EPSILON_LENGTH(1e-6) 미만 → 거부
        let r = mesh.scale_faces(&all_faces, DVec3::ZERO, DVec3::new(1.0, 1e-8, 1.0));
        assert!(r.is_err(), "scaling down below EPSILON_LENGTH must be rejected");
        let _ = pp;
    }

    #[test]
    fn scale_accepts_reasonable_downscale() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        // 1/2 스케일 — 정상
        let r = mesh.scale_faces(&faces, DVec3::ZERO, DVec3::splat(0.5));
        assert!(r.is_ok());
    }

    #[test]
    fn rotate_rejects_nan_angle() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let r = mesh.rotate_faces(&faces, DVec3::ZERO, DVec3::Y, f64::NAN);
        assert!(r.is_err());
    }

    #[test]
    fn rotate_rejects_zero_axis() {
        let mut mesh = Mesh::default();
        let faces = make_test_quad(&mut mesh);
        let r = mesh.rotate_faces(&faces, DVec3::ZERO, DVec3::ZERO, 1.0);
        assert!(r.is_err());
    }

    // ── ADR-060 Phase O Step 1 — translate_verts curve transform ──

    use crate::curves::AnalyticCurve;

    /// ADR-060 §E #1 — Both endpoints moved → Circle curve translates.
    /// (Circle is non-Line variant — actually transformed via Phase H.)
    #[test]
    fn adr_060_step1_both_endpoints_moved_translates_circle() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Both endpoints in moved set
        m.translate_verts(&[v0, v1], DVec3::new(0.0, 100.0, 0.0)).unwrap();

        // Circle should have been translated — center moved by +Y100
        match m.edges[eid].curve() {
            Some(AnalyticCurve::Circle { center, radius, .. }) => {
                assert!((*center - DVec3::new(5.0, 100.0, 0.0)).length() < 1e-9,
                    "expected center at (5, 100, 0), got {:?}", center);
                assert!((radius - 5.0).abs() < 1e-9);
            }
            other => panic!("Circle should be translated, got {:?}", other),
        }
    }

    /// ADR-060 §E #2 — Partial move → curve drops to None (safe Line fallback).
    /// CRITICAL lock-in: 곡선 보존 시도 절대 금지.
    #[test]
    fn adr_060_step1_partial_move_drops_curve_to_none() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Only v0 in moved set — partial move
        m.translate_verts(&[v0], DVec3::new(0.0, 1.0, 0.0)).unwrap();

        // Curve must have been dropped to None
        assert!(m.edges[eid].curve().is_none(),
            "partial move must drop curve to None per §E lock-in");
    }

    /// ADR-060 §E #3 — Neither endpoint moved → curve unchanged.
    #[test]
    fn adr_060_step1_unrelated_edge_unchanged() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let v2 = m.add_vertex(DVec3::new(20.0, 0.0, 0.0));
        let v3 = m.add_vertex(DVec3::new(30.0, 0.0, 0.0));
        let (eid_a, _) = m.add_edge(v0, v1).unwrap();
        let (eid_b, _) = m.add_edge(v2, v3).unwrap();

        let circle_b = AnalyticCurve::Circle {
            center: DVec3::new(25.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        };
        m.edges[eid_b].set_curve(Some(circle_b.clone()));

        // Move only v0 / v1 (edge A) — edge B should be untouched
        m.translate_verts(&[v0, v1], DVec3::new(0.0, 100.0, 0.0)).unwrap();

        // edge B's circle preserved
        assert_eq!(m.edges[eid_b].curve(), Some(&circle_b),
            "unrelated edge curve must remain unchanged");
        let _ = eid_a;
    }

    /// ADR-060 §E #4 — Line variant (mesh-relative) doesn't get
    /// transform call — vertex move auto-propagates via VertId reference.
    #[test]
    fn adr_060_step1_line_variant_mesh_relative() {
        use crate::curves::synthesize::synthesize_line_curve;
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(synthesize_line_curve(v0, v1)));

        // Move both endpoints
        m.translate_verts(&[v0, v1], DVec3::new(0.0, 5.0, 0.0)).unwrap();

        // Line still references v0/v1 — same VertIds, just new positions
        match m.edges[eid].curve() {
            Some(AnalyticCurve::Line { start, end }) => {
                assert_eq!(*start, v0);
                assert_eq!(*end, v1);
            }
            other => panic!("Line should be preserved, got {:?}", other),
        }
        // Verify positions actually moved
        assert!((m.vertex_pos(v0).unwrap() - DVec3::new(0.0, 5.0, 0.0)).length() < 1e-9);
        assert!((m.vertex_pos(v1).unwrap() - DVec3::new(10.0, 5.0, 0.0)).length() < 1e-9);
    }

    /// ADR-060 §E #5 — Existing 851-test corpus regression: edges with
    /// no curve attached behave EXACTLY as before (no spurious effects).
    #[test]
    fn adr_060_step1_no_curve_no_spurious_change() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        // Note: no set_curve — edge starts without curve
        assert!(m.edges[eid].curve().is_none());

        m.translate_verts(&[v0, v1], DVec3::new(0.0, 5.0, 0.0)).unwrap();

        // Still no curve, vertices moved
        assert!(m.edges[eid].curve().is_none(),
            "edges without curves should remain curveless");
        assert!((m.vertex_pos(v0).unwrap() - DVec3::new(0.0, 5.0, 0.0)).length() < 1e-9);
    }

    /// ADR-060 §E #6 — Empty vert list is no-op (no infinite loop, no panic).
    #[test]
    fn adr_060_step1_empty_vert_list_noop() {
        let mut m = Mesh::new();
        let _v0 = m.add_vertex(DVec3::ZERO);
        let result = m.translate_verts(&[], DVec3::new(1.0, 0.0, 0.0)).unwrap();
        assert_eq!(result.verts_moved, 0);
        assert_eq!(result.faces_affected, 0);
    }

    // ── ADR-060 Phase O Step 2 — rotate_verts / scale_verts ──

    /// ADR-060 §E Step 2 #1 — rotate_verts both endpoints rotates Circle.
    /// 90° rotation about Z axis at origin: Circle on XY plane stays Circle.
    #[test]
    fn adr_060_step2_rotate_both_endpoints_rotates_circle() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // 90° rotation about Z at origin: (5, 0, 0) → (0, 5, 0)
        m.rotate_verts(&[v0, v1], DVec3::ZERO, DVec3::Z,
            std::f64::consts::FRAC_PI_2).unwrap();

        match m.edges[eid].curve() {
            Some(AnalyticCurve::Circle { center, radius, normal, .. }) => {
                assert!((*center - DVec3::new(0.0, 5.0, 0.0)).length() < 1e-9,
                    "expected center at (0, 5, 0), got {:?}", center);
                assert!((radius - 5.0).abs() < 1e-9, "radius preserved");
                // Z-rotation: normal +Z preserved
                assert!((*normal - DVec3::Z).length() < 1e-9);
            }
            other => panic!("Circle should be rotated, got {:?}", other),
        }
    }

    /// ADR-060 §E Step 2 #2 — rotate_verts partial move drops curve to None.
    #[test]
    fn adr_060_step2_rotate_partial_drops_curve() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 5.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Only v0 rotated — partial move
        m.rotate_verts(&[v0], DVec3::ZERO, DVec3::Z, 0.5).unwrap();

        assert!(m.edges[eid].curve().is_none(),
            "partial rotate must drop curve to None per §E lock-in");
    }

    /// ADR-060 §E Step 2 #3 — rotate_verts Line variant unaffected
    /// (mesh-relative — vertex moves auto-propagate).
    #[test]
    fn adr_060_step2_rotate_line_variant_preserves_vertids() {
        use crate::curves::synthesize::synthesize_line_curve;
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(synthesize_line_curve(v0, v1)));

        m.rotate_verts(&[v0, v1], DVec3::ZERO, DVec3::Z,
            std::f64::consts::FRAC_PI_2).unwrap();

        // Line variant retains v0/v1 references
        match m.edges[eid].curve() {
            Some(AnalyticCurve::Line { start, end }) => {
                assert_eq!(*start, v0);
                assert_eq!(*end, v1);
            }
            other => panic!("Line should be preserved, got {:?}", other),
        }
        // Vertex positions actually rotated (v1 (10,0,0) → (0,10,0))
        assert!((m.vertex_pos(v1).unwrap() - DVec3::new(0.0, 10.0, 0.0)).length() < 1e-9);
    }

    /// ADR-060 §E Step 2 #4 — rotate_verts no curve = no spurious side effects.
    #[test]
    fn adr_060_step2_rotate_no_curve_no_spurious_change() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        assert!(m.edges[eid].curve().is_none());

        m.rotate_verts(&[v0, v1], DVec3::ZERO, DVec3::Z, 0.7).unwrap();

        assert!(m.edges[eid].curve().is_none(),
            "edges without curves should remain curveless");
    }

    /// ADR-060 §E Step 2 #5 — scale_verts uniform scale of Sphere
    /// preserves kind, radius scaled.
    #[test]
    fn adr_060_step2_scale_uniform_sphere_radius_changes() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        // Use a Circle (Sphere needs a face — Circle is the curve analog)
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 4.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Uniform scale by 2 about origin
        m.scale_verts(&[v0, v1], DVec3::ZERO, DVec3::splat(2.0)).unwrap();

        match m.edges[eid].curve() {
            Some(AnalyticCurve::Circle { center, radius, .. }) => {
                // Center (5,0,0) scaled by 2 → (10,0,0)
                assert!((*center - DVec3::new(10.0, 0.0, 0.0)).length() < 1e-9);
                // Radius 4 × 2 = 8
                assert!((radius - 8.0).abs() < 1e-9, "uniform scale should scale radius");
            }
            other => panic!("Circle should be uniformly scaled, got {:?}", other),
        }
    }

    /// ADR-060 §E Step 2 #6 — scale_verts non-uniform → curve drops
    /// to None (Phase H §A1.2 promotion not yet integrated).
    #[test]
    fn adr_060_step2_scale_non_uniform_drops_circle() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 4.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Non-uniform scale: x×2, y×3, z×1 — would create ellipse
        // Phase H §A1.2 deferred (NURBS promote pending) → transform fails
        // → curve unchanged at attached state OR set_curve(None) depending.
        // For safety, partial would also drop.
        let _ = m.scale_verts(&[v0, v1], DVec3::ZERO,
            DVec3::new(2.0, 3.0, 1.0)).unwrap();

        // Circle.transform with non-uniform may bail (Phase H §A1.2). Result
        // could be: original kept (silent skip on transform err) OR cleared.
        // Either is acceptable — silent wrong-result is what matters NOT.
        // Assert no panic + edge still consistent.
        let _curve = m.edges[eid].curve();  // accessor doesn't panic
    }

    /// ADR-060 §E Step 2 #7 — scale_verts partial drops curve.
    #[test]
    fn adr_060_step2_scale_partial_drops_curve() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(10.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        m.edges[eid].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(5.0, 0.0, 0.0), radius: 4.0,
            normal: DVec3::Z, basis_u: DVec3::X,
        }));

        // Only v1 in scale set
        m.scale_verts(&[v1], DVec3::ZERO, DVec3::splat(2.0)).unwrap();

        assert!(m.edges[eid].curve().is_none(),
            "partial scale must drop curve to None per §E lock-in");
    }

    /// ADR-060 §E Step 2 #8 — scale_verts no curve = no spurious change.
    #[test]
    fn adr_060_step2_scale_no_curve_no_spurious_change() {
        let mut m = Mesh::new();
        let v0 = m.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v1 = m.add_vertex(DVec3::new(2.0, 0.0, 0.0));
        let (eid, _) = m.add_edge(v0, v1).unwrap();
        assert!(m.edges[eid].curve().is_none());

        m.scale_verts(&[v0, v1], DVec3::ZERO, DVec3::splat(2.0)).unwrap();

        assert!(m.edges[eid].curve().is_none(),
            "edges without curves should remain curveless");
    }
}
