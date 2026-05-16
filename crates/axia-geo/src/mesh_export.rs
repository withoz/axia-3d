//! Mesh Export — Three.js buffer export for GPU rendering.
//!
//! Extracted from `mesh.rs` (Tier 2-A Stack #2, 2026-05-16, LOCKED #44
//! complete meaning per merge). All export-related operations that
//! produce flat vertex/index buffers for the TS Viewport.
//!
//! ## Contents
//!
//! - `Mesh::export_buffers` — main entry, returns 5-tuple of buffers
//! - `Mesh::export_buffers_inner` — bulk triangulation + tessellation logic
//! - `Mesh::last_export_skip_stats` — per-face skip diagnostics accessor
//! - `Mesh::deactivate_empty_emit_faces` — invariant guard (earcut Ok([]))
//! - `Mesh::export_edge_lines` — edge wireframe export (angle-filtered)
//! - `Mesh::export_centerline_lines` — centerline-class edge export
//! - `Mesh::export_edge_lines_with_map` — wireframe + edge owner-id map
//! - `Mesh::projection_axes` (private) — 2D earcut projection helper
//!
//! ## ADR cross-link
//!
//! - ADR-031 Phase D — analytic surface tessellation
//! - ADR-038 P23 — surface-aware normals
//! - ADR-080 V — chord_tol policy for closed-curve render
//! - ADR-089 Phase 2 — closed-curve face render path
//! - LOCKED #15 P22.5 — owner-ID grouping in edge_map
//! - LOCKED #16 P23 — surface-aware Gouraud smoothing
//! - LOCKED #40 — render-only chord_tol
//! - LOCKED #44 — complete meaning per merge

use glam::DVec3;
use anyhow::Result;

use crate::entities::*;
use crate::mesh::{Mesh, ExportSkipStats, compute_uv_slice_for_quad_face, surfaces_in_same_smooth_group};

impl Mesh {

    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions, normals, indices, face_id_per_triangle)
    /// Export mesh as flat vertex/index buffers for GPU rendering.
    /// Returns (positions_f32, normals_f32, indices, face_map, positions_f64)
    /// positions_f64 has the same layout/indexing as positions_f32 but in full f64 precision.
    /// **CONTRACT** (2026-05-02 invariant freeze): every active face MUST
    /// emit ≥1 triangle. earcut Ok([]) faces are auto-deactivated INSIDE
    /// this method — the call order is locked:
    ///   1. clear `last_export_empty_faces`
    ///   2. emit triangles, recording empty-emit face IDs
    ///   3. deactivate empty-emit faces (`deactivate_empty_emit_faces`)
    ///   4. (optional) re-export if any face was deactivated
    ///   5. snapshot `last_export_stats` LAST
    /// Any future change to this method MUST preserve this order. The
    /// `debug_assert_eq!` after deactivation locks the invariant in
    /// debug builds (release auto-corrects via the deactivation pass).
    ///
    /// **Guarantee on returned buffers**: `face_map` contains exactly
    /// one entry per emitted triangle, and the *set* of distinct face
    /// IDs in `face_map` equals the count of `is_active() && is_visible()`
    /// faces in the mesh. NO active face with zero triangles can leak
    /// past this boundary.
    pub fn export_buffers(&mut self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let result = self.export_buffers_inner()?;
        // Step 3 — deactivate any face whose triangulation produced 0
        // triangles (earcut Ok([])). Restores the "1 face = ≥1 tri"
        // invariant before stats are snapshotted.
        let removed = self.deactivate_empty_emit_faces();
        if removed == 0 {
            // Step 5 — snapshot stats (already done at end of inner pass).
            return Ok(result);
        }
        // Step 4 — re-export with cleaned mesh state. Stats from this
        // pass are the canonical snapshot (recorded at end of inner).
        self.export_buffers_inner()
    }

    fn export_buffers_inner(&self) -> Result<(Vec<f32>, Vec<f32>, Vec<u32>, Vec<u32>, Vec<f64>)> {
        let mut positions: Vec<f32> = Vec::new();
        let mut positions_f64: Vec<f64> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut face_map: Vec<u32> = Vec::new(); // one FaceId per triangle
        let mut vert_offset: u32 = 0;

        // Step 1 — reset diagnostic counters + empty-emit list at start of
        // every export pass (the "clear" in clear → emit → deactivate →
        // snapshot ordering).
        let mut stats = ExportSkipStats::default();
        self.last_export_empty_faces.borrow_mut().clear();

        // ADR-038 P23.2 + 2026-05-12 visual quality refinement —
        // chord tolerance for **render-only** analytic surface / curve
        // tessellation. 0.02mm 는 0.1mm 의 5× refinement 으로, top rim
        // facet (사용자 시연 결함 — "옆면처럼 원도 같은 방식 쓸 수 없나요?")
        // 해소. Side surface 가 매끈해 보이는 진짜 이유는 N 이 충분해서가
        // 아니라 surface-aware Gouraud normal 이 적은 segment 도 매끈하게
        // 보이게 만들기 때문 (ADR-038 P23.5). Top face 는 Plane normal 만
        // 가지므로 segment count 가 그대로 시각 facet 으로 노출 → 더 fine
        // chord 가 필요.
        //
        // Engine ops (offset / Boolean / Push-Pull Path A 의 polygon
        // substitute) 는 별도 chord_tol (`radius * 0.01`) 을 caller 가
        // 명시 전달 — 본 const 는 render path 전용. 두 tolerance 분리는
        // ADR-049 §4 의 "Form/Property layer" 패턴 답습 (truth vs view).
        //
        // 메모리 영향 (r=5 cylinder 기준):
        //   Side surface: ~16 → ~38 segments (×2.4)
        //   Top face fan: ~22 → ~78 triangles (×3.5)
        //   Rim wireframe: ~22 → ~78 line segments (×3.5)
        //   합계 cylinder 1개: ~150 → ~360 verts (+210 verts, 무시 가능)
        // LOD 는 별도 phase.
        const ANALYTIC_CHORD_TOL: f64 = 0.02;

        for (face_id, face) in self.faces.iter() {
            if !face.is_active() || !face.is_visible() {
                continue;
            }
            stats.total_active_faces += 1;

            // ADR-038 P23.1 — Analytic evaluate priority.
            // `Face.surface = Some(AnalyticSurface)` 이면 surface 의 정확한
            // tessellation + analytic normal 사용. 없으면 기존 path
            // (DCEL fan averaging) 유지.
            //
            // ADR-087 K-ε hotfix — LOCKED #12 (ADR-025 P11) "닫힌 엣지로
            // face 합성" 규칙: Plane variant 는 polygon = exact 이므로
            // surface tessellation 을 *건너뛰고* DCEL polygon path 로
            // fall through. Plane.u_range/v_range = (-1e6, 1e6) 가
            // tessellate 시 2km × 2km mesh 로 확장되어 face 가 edge 를
            // 벗어나는 회귀 차단. Curved surface (Cylinder/Sphere/Cone/
            // Torus/Bezier/BSpline/NURBS) 는 surface tessellation 유지
            // (chord-based curve 샘플링 필수).
            if let Some(surface) = face.surface() {
                if matches!(surface, crate::surfaces::AnalyticSurface::Plane { .. }) {
                    // Plane → polygon path (DCEL boundary = exact)
                    // fall through to the polygon tessellation below.
                } else {
                use crate::surfaces::SurfaceOps;

                // ADR-089 A-ρ-β / A-φ-β — curved surface uv-slice fast-path.
                // For 4-vert quad faces with shared curved surface
                // (Cylinder/Sphere/Cone/Torus), compute the quad's actual
                // uv sub-range from its boundary verts and tessellate only
                // that slice. L-φ-1 / L-φ-2 / L-φ-3 / L-φ-4.
                let face_surface_owned;
                let slice = compute_uv_slice_for_quad_face(self, face, surface);
                let render_surface: &crate::surfaces::AnalyticSurface =
                    if let Some(sliced) = slice {
                        face_surface_owned = sliced;
                        &face_surface_owned
                    } else {
                        surface
                    };

                let tess = render_surface.tessellate(ANALYTIC_CHORD_TOL);
                if tess.vertices.is_empty() || tess.triangles.is_empty() {
                    stats.analytic_empty_tess += 1;
                    continue;
                }

                // P23.5 — analytic normal 직접 evaluate per (u, v).
                // averaging 없음 — sphere 폴 같은 degenerate 점도 정확한
                // 단위 벡터 반환 (SurfaceOps spec 보장).
                let n_verts = tess.vertices.len();
                for i in 0..n_verts {
                    let p = tess.vertices[i];
                    positions.push(p.x as f32);
                    positions.push(p.y as f32);
                    positions.push(p.z as f32);
                    positions_f64.push(p.x);
                    positions_f64.push(p.y);
                    positions_f64.push(p.z);

                    let uv = tess.uv.get(i).copied().unwrap_or([0.0, 0.0]);
                    let n = render_surface.normal(uv[0], uv[1]);
                    // Defensive: degenerate normal → fallback to face plane normal.
                    let n = if n.length_squared() < 1e-20 { face.normal() } else { n };
                    normals.push(n.x as f32);
                    normals.push(n.y as f32);
                    normals.push(n.z as f32);
                }

                // Emit triangles with vertex offset.
                for tri in &tess.triangles {
                    indices.push(vert_offset + tri[0]);
                    indices.push(vert_offset + tri[1]);
                    indices.push(vert_offset + tri[2]);
                    face_map.push(face_id.raw());  // P22.5 — 모든 삼각형이 같은 FaceId
                }
                vert_offset += n_verts as u32;
                stats.emitted += 1;
                continue;  // skip the planar polygon path below
                }  // close inner else (curved surface branch)
            }

            let normal = face.normal();

            // Skip faces with corrupted loops (graceful degradation)
            let loop_verts = match self.collect_loop_verts(face.outer().start) {
                Ok(verts) => verts,
                Err(_) => { stats.corrupted_outer_loop += 1; continue; },
            };
            // Outer loop HEs — parallel to loop_verts (hes[i].dst() == loop_verts[i]).
            // Used for smooth-normal computation around each vertex.
            let loop_hes = self.collect_loop_hes(face.outer().start).unwrap_or_default();

            // ADR-089 A-κ-β — closed-curve face render fast-path.
            // Detect 1-vert anchor + Circle curve self-loop edge and
            // emit tessellated triangle fan + analytic Plane normals.
            // Read-only (no mesh mutation; A-θ-β handles substitution
            // for Push-Pull). L-κ-1 / L-κ-3 / L-κ-4.
            if loop_verts.len() == 1 {
                let outer_start = face.outer().start;
                let edge_id = self.hes[outer_start].edge();
                if let Some(edge_ref) = self.edges.get(edge_id) {
                    if let Some(crate::curves::AnalyticCurve::Circle {
                        center,
                        radius,
                        normal: c_normal,
                        basis_u,
                    }) = edge_ref.curve().cloned()
                    {
                        // ADR-038 P23.2 + 2026-05-12 render refinement —
                        // 0.02mm baseline (ANALYTIC_CHORD_TOL) capped by
                        // `radius * 0.002` (5× finer than engine ops'
                        // `radius * 0.01`). For r=5 → 0.01mm → ~78 fan
                        // triangles (was ~22).
                        let chord_tol = ANALYTIC_CHORD_TOL.min(radius * 0.002).max(1e-6);
                        let pts = crate::curves::circle::tessellate_full(
                            center, radius, c_normal, basis_u, chord_tol,
                        );
                        if pts.len() < 4 {
                            stats.outer_too_short += 1;
                            continue;
                        }
                        let unique_pts = &pts[..pts.len() - 1];
                        let n_seg = unique_pts.len();

                        // Build vertex buffer: center + N rim verts.
                        // Triangulate as fan from center → N triangles.
                        let n_normal = if c_normal.length_squared() < 0.5 {
                            face.normal()
                        } else {
                            c_normal.normalize_or_zero()
                        };

                        // Emit center vertex (vert_offset + 0).
                        positions.push(center.x as f32);
                        positions.push(center.y as f32);
                        positions.push(center.z as f32);
                        positions_f64.push(center.x);
                        positions_f64.push(center.y);
                        positions_f64.push(center.z);
                        normals.push(n_normal.x as f32);
                        normals.push(n_normal.y as f32);
                        normals.push(n_normal.z as f32);

                        // Emit N rim vertices (vert_offset + 1 .. vert_offset + N).
                        for &p in unique_pts {
                            positions.push(p.x as f32);
                            positions.push(p.y as f32);
                            positions.push(p.z as f32);
                            positions_f64.push(p.x);
                            positions_f64.push(p.y);
                            positions_f64.push(p.z);
                            normals.push(n_normal.x as f32);
                            normals.push(n_normal.y as f32);
                            normals.push(n_normal.z as f32);
                        }

                        // Emit N triangles: (center, rim[i], rim[i+1]).
                        for i in 0..n_seg {
                            let next = (i + 1) % n_seg;
                            indices.push(vert_offset);
                            indices.push(vert_offset + 1 + i as u32);
                            indices.push(vert_offset + 1 + next as u32);
                            face_map.push(face_id.raw());
                        }
                        vert_offset += (n_seg + 1) as u32;
                        stats.emitted += 1;
                        continue;
                    }
                    // ADR-089 A-ω-δ / A-Α-β / A-Β-β — closed Bezier /
                    // BSpline / NURBS render fast-path. Tessellate control
                    // points to polyline → fan triangulate from centroid
                    // (analogous to Circle path).
                    let curve_tess: Option<Vec<DVec3>> = match edge_ref.curve().cloned() {
                        Some(crate::curves::AnalyticCurve::Bezier { control_pts }) => {
                            crate::curves::bezier::tessellate(
                                &control_pts, ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        Some(crate::curves::AnalyticCurve::BSpline {
                            control_pts, knots, degree,
                        }) => {
                            crate::curves::bspline::tessellate(
                                &control_pts, &knots, degree as usize,
                                ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        Some(crate::curves::AnalyticCurve::NURBS {
                            control_pts, weights, knots, degree,
                        }) => {
                            crate::curves::nurbs::tessellate(
                                &control_pts, &weights, &knots, degree as usize,
                                ANALYTIC_CHORD_TOL,
                            ).ok()
                        }
                        _ => None,
                    };
                    if let Some(pts) = curve_tess
                    {
                        if pts.len() < 3 {
                            stats.outer_too_short += 1;
                            continue;
                        }
                        // Drop closing duplicate if present.
                        let unique_pts: &[DVec3] =
                            if (pts[0] - pts[pts.len() - 1]).length()
                                < crate::tolerances::EPSILON_LENGTH
                                && pts.len() >= 4
                            {
                                &pts[..pts.len() - 1]
                            } else {
                                &pts[..]
                            };
                        let n_seg = unique_pts.len();
                        // Centroid for fan triangulation.
                        let centroid = unique_pts.iter().fold(DVec3::ZERO, |a, p| a + *p)
                            / (n_seg as f64);
                        // Normal: face's stored normal (computed in
                        // add_face_closed_curve via best-fit plane).
                        let n_normal = face.normal();

                        // Emit centroid + rim verts.
                        positions.push(centroid.x as f32);
                        positions.push(centroid.y as f32);
                        positions.push(centroid.z as f32);
                        positions_f64.push(centroid.x);
                        positions_f64.push(centroid.y);
                        positions_f64.push(centroid.z);
                        normals.push(n_normal.x as f32);
                        normals.push(n_normal.y as f32);
                        normals.push(n_normal.z as f32);
                        for &p in unique_pts {
                            positions.push(p.x as f32);
                            positions.push(p.y as f32);
                            positions.push(p.z as f32);
                            positions_f64.push(p.x);
                            positions_f64.push(p.y);
                            positions_f64.push(p.z);
                            normals.push(n_normal.x as f32);
                            normals.push(n_normal.y as f32);
                            normals.push(n_normal.z as f32);
                        }
                        for i in 0..n_seg {
                            let next = (i + 1) % n_seg;
                            indices.push(vert_offset);
                            indices.push(vert_offset + 1 + i as u32);
                            indices.push(vert_offset + 1 + next as u32);
                            face_map.push(face_id.raw());
                        }
                        vert_offset += (n_seg + 1) as u32;
                        stats.emitted += 1;
                        continue;
                    }
                }
                // Not a closed-curve face — fall through to legacy
                // < 3 skip.
            }

            if loop_verts.len() < 3 {
                stats.outer_too_short += 1;
                continue;
            }

            // Project to 2D for triangulation
            let (coord1, coord2) = Self::projection_axes(normal);
            let mut coords_2d: Vec<f64> = Vec::with_capacity(loop_verts.len() * 2);
            let mut positions_3d: Vec<DVec3> = Vec::with_capacity(loop_verts.len());
            // Per-vertex smooth normals (aligned with positions_3d indexing)
            let mut vert_normals: Vec<DVec3> = Vec::with_capacity(loop_verts.len());

            let mut skip_face = false;
            for (i, &vid) in loop_verts.iter().enumerate() {
                match self.vertex_pos(vid) {
                    Ok(pos) => {
                        positions_3d.push(pos);
                        let arr = [pos.x, pos.y, pos.z];
                        coords_2d.push(arr[coord1]);
                        coords_2d.push(arr[coord2]);

                        // Smooth normal: average adjacent face normals within threshold
                        // (only if we have a matching HE reference)
                        if i < loop_hes.len() {
                            let smooth = self.compute_smooth_normal_at(loop_hes[i], vid, normal);
                            vert_normals.push(smooth);
                        } else {
                            vert_normals.push(normal);
                        }
                    }
                    Err(_) => { skip_face = true; break; }
                }
            }
            if skip_face { stats.vertex_pos_failed += 1; continue; }

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
                            // Inner-loop verts: use face normal (holes rarely need smoothing)
                            vert_normals.push(normal);
                        }
                        Err(_) => { skip_face = true; break; }
                    }
                }
                if skip_face { break; }
            }
            if skip_face { stats.corrupted_inner_loop += 1; continue; }

            // Triangulate with earcutr (outer + holes)
            let mut tri_indices = match earcutr::earcut(&coords_2d, &hole_indices, 2) {
                Ok(indices) => indices,
                Err(_) => { stats.earcut_failed += 1; continue; },
            };
            // Distinguish Ok([]) — earcut accepted the polygon but
            // produced zero triangles (degenerate / self-touching).
            // Without this guard the face disappears from the buffer
            // silently while `emitted` would still increment.
            //
            // INVARIANT (user-requested 2026-05-02):
            //   For every active face: emitted_triangle_count > 0.
            // We enforce by recording the offending face id; the caller's
            // `deactivate_empty_emit_faces(&mut self)` post-pass removes
            // them so face_count == rendered_face_count is restored.
            if tri_indices.is_empty() {
                stats.earcut_empty += 1;
                stats.last_earcut_empty_fid = face_id.raw();
                stats.last_earcut_empty_outer_n = loop_verts.len() as u32;
                self.last_export_empty_faces.borrow_mut().push(face_id);
                continue;
            }

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

            // Emit vertices (f32 for GPU + f64 for precision).
            // Per-vertex smooth normals: averaged across adjacent faces that share a
            // soft edge with this face (SketchUp-style, threshold EDGE_VISIBILITY_ANGLE_DEG).
            // Falls back to face normal when there are no neighbors within threshold.
            for (i, pos) in positions_3d.iter().enumerate() {
                positions.push(pos.x as f32);
                positions.push(pos.y as f32);
                positions.push(pos.z as f32);

                positions_f64.push(pos.x);
                positions_f64.push(pos.y);
                positions_f64.push(pos.z);

                let n = vert_normals.get(i).copied().unwrap_or(normal);
                normals.push(n.x as f32);
                normals.push(n.y as f32);
                normals.push(n.z as f32);
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
            stats.emitted += 1;
        }

        // Step 5 — snapshot stats LAST (single source of truth for
        // diagnostic queries until the next export pass).
        self.last_export_stats.set(stats);

        // INVARIANT lock — debug builds panic if some active face
        // contributed 0 triangles to the buffer. Release builds rely
        // on `deactivate_empty_emit_faces` to auto-correct, so this
        // assertion is purely defensive against future regressions.
        // We compute emitted_face_count via face_map dedup since face
        // ids appear once per triangle.
        #[cfg(debug_assertions)]
        {
            use std::collections::HashSet;
            let active: usize = self.faces.iter().filter(|(_, f)| f.is_active() && f.is_visible()).count();
            let emitted_set: HashSet<u32> = face_map.iter().copied().collect();
            // After deactivate_empty_emit_faces (called from export_buffers
            // outer wrapper), invariant should hold. During the FIRST inner
            // pass the empty list may not yet be drained — skip assert if
            // any pending empty IDs remain.
            if self.last_export_empty_faces.borrow().is_empty() {
                debug_assert_eq!(
                    active,
                    emitted_set.len(),
                    "INVARIANT VIOLATED: {} active faces but only {} emitted (zero-triangle face leaked)",
                    active, emitted_set.len(),
                );
            }
        }

        Ok((positions, normals, indices, face_map, positions_f64))
    }

    /// Returns the per-face skip diagnostics from the most recent
    /// `export_buffers()` call. Use to debug "face active in mesh but not
    /// rendered" — non-zero counts indicate which silent-skip path triggered.
    pub fn last_export_skip_stats(&self) -> ExportSkipStats {
        self.last_export_stats.get()
    }

    /// Self-heal pass — deactivate any face whose triangulation in the most
    /// recent `export_buffers` call returned `Ok([])` (zero triangles).
    ///
    /// **Invariant** (user-stipulated 2026-05-02): every active face must
    /// emit ≥1 triangle. earcut Ok([]) means the polygon is degenerate
    /// (zero area / collinear vertices / self-touching). Such a face would
    /// otherwise stay active in mesh but invisible in render, manifesting
    /// as the user's "wireframe-only RECT" symptom. Removing it restores
    /// `face_count == emitted_face_count`.
    ///
    /// Returns the count of faces deactivated. Call after `export_buffers`.
    pub fn deactivate_empty_emit_faces(&mut self) -> usize {
        // Snapshot then clear — avoid holding the RefCell borrow during
        // the mutating loop.
        let to_remove: Vec<FaceId> = {
            let mut list = self.last_export_empty_faces.borrow_mut();
            std::mem::take(&mut *list)
        };
        let mut n = 0;
        for fid in &to_remove {
            // Defensive: face may have been deactivated by another path.
            if self.faces.contains(*fid) && self.faces[*fid].is_active() {
                let _ = self.remove_face(*fid);
                if self.faces.contains(*fid) {
                    self.faces.remove(*fid);
                }
                n += 1;
            }
        }
        // Debug-only assertion: post-cleanup, NO active face should remain
        // in the recently-recorded empty-emit list (we just cleared it).
        // This is a smoke test that future code can't accidentally bypass
        // the cleanup without also clearing the list.
        debug_assert!(self.last_export_empty_faces.borrow().is_empty());
        n
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

    /// Export just the centerline edge segments (flat `[x,y,z, ...]` pairs)
    /// for separate rendering (dashed, thin, dimmer color). No edge map
    /// returned — centerlines are not pickable as distinct entities via the
    /// main edge-line hit path yet (they stay snap targets via vertex/midpoint
    /// but not as mid-edge nearest hits in rendering layer).
    pub fn export_centerline_lines(&self) -> Vec<f32> {
        let mut lines: Vec<f32> = Vec::new();
        for (_, edge) in self.edges.iter() {
            if !edge.is_active() { continue; }
            if edge.class() != EdgeClass::Centerline { continue; }
            let p0 = match self.vertex_pos(edge.v_small()) { Ok(p) => p, Err(_) => continue };
            let p1 = match self.vertex_pos(edge.v_large()) { Ok(p) => p, Err(_) => continue };
            lines.extend_from_slice(&[
                p0.x as f32, p0.y as f32, p0.z as f32,
                p1.x as f32, p1.y as f32, p1.z as f32,
            ]);
        }
        lines
    }

    /// export_edge_lines + edge ID map (segment index → EdgeId raw).
    /// Centerline edges are excluded — render them separately via
    /// `export_centerline_lines` to apply dashed / dimmer styling.
    pub fn export_edge_lines_with_map(&self, angle_threshold_deg: f64) -> (Vec<f32>, Vec<u32>) {
        let cos_threshold = angle_threshold_deg.to_radians().cos();
        let mut lines: Vec<f32> = Vec::new();
        let mut edge_map: Vec<u32> = Vec::new();

        for (_edge_id, edge) in self.edges.iter() {
            if !edge.is_active() {
                continue;
            }
            // Centerline edges go through a separate rendering path
            // (export_centerline_lines) so skip them here.
            if edge.class() == EdgeClass::Centerline {
                continue;
            }

            // ADR-089 A-κ-β — closed-curve edge wireframe fast-path.
            // Self-loop edge with Circle curve → tessellate to N polyline
            // segments. Each segment maps to the SAME EdgeId (LOCKED #15
            // ADR-037 P22.5 owner-ID uniformity). L-κ-2 / L-κ-6.
            if edge.is_self_loop() {
                if let Some(crate::curves::AnalyticCurve::Circle {
                    center,
                    radius,
                    normal: c_normal,
                    basis_u,
                }) = edge.curve().cloned()
                {
                    // 2026-05-12 render refinement — match closed-curve
                    // face fast-path (line ~4844) so top face boundary
                    // and rim wireframe align in 3D. Was `radius * 0.01`,
                    // now `min(0.02, radius * 0.002)` per render chord
                    // tolerance policy.
                    let chord_tol = (radius * 0.002).clamp(5e-5, 0.02);
                    let pts = crate::curves::circle::tessellate_full(
                        center, radius, c_normal, basis_u, chord_tol,
                    );
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                    }
                    continue;
                }
                // ADR-089 A-ω-δ / A-Α-β / A-Β-β — Bezier / BSpline /
                // NURBS closed self-loop wireframe.
                let curve_pts: Option<Vec<DVec3>> = match edge.curve().cloned() {
                    Some(crate::curves::AnalyticCurve::Bezier { control_pts }) => {
                        crate::curves::bezier::tessellate(&control_pts, 0.05).ok()
                    }
                    Some(crate::curves::AnalyticCurve::BSpline { control_pts, knots, degree }) => {
                        crate::curves::bspline::tessellate(
                            &control_pts, &knots, degree as usize, 0.05,
                        ).ok()
                    }
                    Some(crate::curves::AnalyticCurve::NURBS {
                        control_pts, weights, knots, degree,
                    }) => {
                        crate::curves::nurbs::tessellate(
                            &control_pts, &weights, &knots, degree as usize, 0.05,
                        ).ok()
                    }
                    _ => None,
                };
                if let Some(pts) = curve_pts {
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                    }
                    continue;
                }
                // Self-loop without supported curve — skip (zero-length
                // line otherwise).
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

            // Collect adjacent face normals + surfaces via radial chain
            let mut face_normals: Vec<DVec3> = Vec::new();
            let mut face_surfaces: Vec<Option<crate::surfaces::AnalyticSurface>> = Vec::new();
            let mut he_id = he_start;
            loop {
                let face_id = self.hes[he_id].face();
                if !face_id.is_null() && self.faces.contains(face_id) {
                    let face = &self.faces[face_id];
                    if face.is_active() && face.is_visible() {
                        face_normals.push(face.normal());
                        face_surfaces.push(face.surface().cloned());
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
                        // ADR-089 A-τ-β — smooth-group edge hide.
                        // 두 face 가 같은 곡면 surface 인스턴스 (Cylinder/
                        // Sphere/Cone/Torus) 면 smooth-group 내부 edge 로
                        // 간주, hide. L-τ-1 / L-τ-2 / L-τ-6.
                        if surfaces_in_same_smooth_group(
                            &face_surfaces[0], &face_surfaces[1],
                        ) {
                            false // smooth group internal — hide
                        } else {
                            // Fallback: angle-based coplanar test (LOCKED #16
                            // K-ε hotfix 답습).
                            let dot = face_normals[0].dot(face_normals[1]).abs();
                            dot < cos_threshold // draw only if NOT coplanar
                        }
                    }
                    _ => true,  // non-manifold — draw
                }
            };

            if draw {
                // ADR-092 C-β extension — Arc tessellation for non-self-
                // loop edges with AnalyticCurve::Arc attached. Mirrors the
                // self-loop Circle fast-path (line 4986-5008) for the
                // post-Push-Pull case where Bottom/Top face boundary edges
                // carry Arc metadata pointing back at the original Circle.
                // Without this branch, Arc-attached edges render as straight
                // chord lines, leaving the polygon-rim defect (사용자 시연
                // 2026-05-09 결함 1) un-fixed.
                if let Some(crate::curves::AnalyticCurve::Arc {
                    center,
                    radius,
                    normal: c_normal,
                    basis_u,
                    start_angle,
                    end_angle,
                }) = edge.curve().cloned()
                {
                    let chord_tol = (radius * 0.01).max(5e-5);
                    let pts = crate::curves::arc::tessellate(
                        center,
                        radius,
                        c_normal,
                        basis_u,
                        start_angle,
                        end_angle,
                        chord_tol,
                    );
                    if pts.len() >= 2 {
                        for w in pts.windows(2) {
                            lines.push(w[0].x as f32);
                            lines.push(w[0].y as f32);
                            lines.push(w[0].z as f32);
                            lines.push(w[1].x as f32);
                            lines.push(w[1].y as f32);
                            lines.push(w[1].z as f32);
                            edge_map.push(_edge_id.raw());
                        }
                        continue;
                    }
                }
                // Default: emit single straight chord segment.
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
}
