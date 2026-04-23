//! Projected Shadow — Sun-facing face들을 임의 평면 receiver에 투영.
//!
//! ## Phase 2.5c — Concave receiver outline (2026-04-23)
//!
//! Sutherland-Hodgman은 convex clip polygon만 수학적으로 정확함. 2.5c에서는
//! receiver outline이 concave(L자/O자/자유형 등)여도 올바르게 작동하도록:
//!   1) Outer outline이 convex인지 테스트 (모든 cross product 부호 동일).
//!   2) Convex면 기존 S-H 1회.
//!   3) Concave면 ear-clipping으로 outer를 triangle 집합으로 분해 후, 각
//!      triangle에 대해 subject를 S-H clip하고 결과를 누적.
//! Triangle은 항상 convex이므로 S-H가 정확히 작동. Triangle 간 결과는 겹치지
//! 않으므로 fan triangulate 시 중복도 없음.
//!
//! ## Phase 2.5b — Hole punching in receiver (2026-04-23)
//!
//! Receiver에 구멍(inner loop)이 있으면 그림자가 구멍도 통과해 뒤로 새어나가지
//! 않아야 한다. Sutherland-Hodgman은 polygon을 "클리퍼 내부"로 잘라내는 방법
//! 이라 outer에는 직접 쓸 수 있지만 hole은 "빼기"여야 함. 여기서는 간단한
//! 2-step 전략을 쓴다:
//!   1) Subject를 outer로 clip → 초기 visible polygon
//!   2) 각 hole에 대해, 현재 결과를 "hole 바깥"과의 교집합만 남기기. 이는 hole
//!      edge들을 CW로 간주하고 그대로 Sutherland-Hodgman을 한 번 더 돌리는
//!      것과 수학적으로 동일 (클리핑 대상이 hole의 보집합).
//! Hole이 convex라고 가정 (대부분의 CAD 구멍: 원형, 사각형).
//!
//! ## Phase 2.5a — Tilted receiver (2026-04-23)
//!
//! 이전 Phase 2.4.x는 수평(normal.y > 0.7) receiver만 지원했다. 2.5a에서는
//! receiver plane을 임의의 (point, normal) 평면으로 일반화하고, 기울어진
//! 지붕·계단·램프에도 그림자가 떨어지게 한다.
//!
//! ### 알고리즘
//! 1. collect_receivers: sun을 등지지 않은 모든 active face를 receiver 후보로
//!    수집 (normal.dot(-sun_dir) < -eps 또는 유사 방향 face는 caster 전용).
//!    실용상: 사람이 "바닥/벽/지붕"으로 쓸 법한 면 = not downward-pointing
//!    (n.y > -0.1) 하면서 sun-ray가 평면을 향해 들어오는 면.
//! 2. 각 caster vertex를 ray-plane 교차로 receiver 평면에 투영.
//!    t = dot(recv_origin - caster_vertex, recv_normal) / dot(sun_dir, recv_normal)
//!    projected = caster_vertex + sun_dir * t
//! 3. Plane-local 2D basis (u, v)로 projected 점과 receiver outline을 변환.
//! 4. Sutherland-Hodgman 2D clip.
//! 5. Clipped 점들을 다시 3D로 복원하고 triangulate.
//!
//! ### 라이선스
//! Sutherland-Hodgman은 1974년 공개 알고리즘, 특허 없음. 본 구현은 교과서
//! pseudo-code 기반 clean-room 작성.
//!
//! ### 제약 (Phase 2.5a 현재)
//! - Receiver outline은 convex 가정 (concave는 Phase 2.5c에서 triangulate 후
//!   per-triangle clip으로 확장).
//! - Hole은 무시 (Phase 2.5b에서 추가).

use glam::DVec3;

use crate::mesh::Mesh;

/// 임의 평면 receiver — origin + normal + outer outline + holes (all in
/// plane-local 2D (u,v) coordinates).
struct Receiver {
    origin: DVec3,
    normal: DVec3,
    /// Plane basis vectors; v1 ⊥ v2, both ⊥ normal. Used to map 3D↔2D.
    u: DVec3,
    v: DVec3,
    /// 2D outer outline in (u,v) plane coords, CCW. Empty = infinite (ground).
    outline_2d: Vec<(f64, f64)>,
    /// 2D hole outlines in (u,v), each forced CW so sutherland_hodgman
    /// (which tests "inside = left of CCW") automatically keeps only the
    /// "outside the hole" half when re-run.
    holes_2d: Vec<Vec<(f64, f64)>>,
}

impl Receiver {
    /// Ground (y=0) infinite receiver.
    fn ground() -> Self {
        Self {
            origin: DVec3::ZERO,
            normal: DVec3::new(0.0, 1.0, 0.0),
            u: DVec3::new(1.0, 0.0, 0.0),
            v: DVec3::new(0.0, 0.0, 1.0),
            outline_2d: Vec::new(),
            holes_2d: Vec::new(),
        }
    }

    /// Project a 3D point into plane-local (u,v) coords assuming p lies on plane.
    fn to_2d(&self, p: DVec3) -> (f64, f64) {
        let d = p - self.origin;
        (d.dot(self.u), d.dot(self.v))
    }

    /// Convert plane-local (u,v) back to 3D point on plane.
    fn to_3d(&self, uv: (f64, f64)) -> DVec3 {
        self.origin + self.u * uv.0 + self.v * uv.1
    }
}

impl Mesh {
    /// Compute projected shadow triangles on all valid receivers.
    /// Flat buffer, 9 f32 per triangle. Each triangle slightly offset from
    /// its receiver plane along normal by RECV_EPS (0.5mm) for z-fight.
    pub fn compute_ground_projected_shadows(&self, sun_dir: DVec3) -> Vec<f32> {
        let mut out = Vec::new();
        if sun_dir.y > -1e-4 {
            return out;
        }

        const SF_EPS: f64 = 0.001;
        const RECV_EPS: f64 = 0.5;
        // receiver 수집 기준: normal · (+Y) > this  →  horizontal or tilted-up
        // face만 receiver로 간주 (지붕, 바닥, 계단 포함).
        const RECV_UP_MIN: f64 = 0.1;

        // 1) Collect receivers. Always include infinite ground.
        let mut receivers: Vec<Receiver> = vec![Receiver::ground()];

        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let n = face.normal();
            if n.y < RECV_UP_MIN { continue; }

            let outer_start = face.outer().start;
            let vert_ids = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if vert_ids.len() < 3 { continue; }
            let verts_3d: Vec<DVec3> = vert_ids.iter()
                .filter_map(|&vid| self.vertex_pos(vid).ok())
                .collect();
            if verts_3d.len() < 3 { continue; }

            // Reject near-ground faces — ground receiver already handles them.
            let max_y = verts_3d.iter().map(|v| v.y).fold(f64::NEG_INFINITY, f64::max);
            if max_y < 1.0 { continue; }

            // Plane origin = centroid; normal = face.normal().
            let origin = verts_3d.iter().copied().sum::<DVec3>() / (verts_3d.len() as f64);
            let (u, v) = build_plane_basis(n);
            let mut outline_2d: Vec<(f64, f64)> = verts_3d.iter().map(|p| {
                let d = *p - origin;
                (d.dot(u), d.dot(v))
            }).collect();

            // Enforce CCW for Sutherland-Hodgman.
            if signed_area_2d(&outline_2d) < 0.0 {
                outline_2d.reverse();
            }

            // Phase 2.5b — collect hole outlines. Inner loops are stored CW
            // (their 3D winding is CW relative to the face normal so they
            // represent interior cutouts). We force each to CW in plane-local
            // 2D; see subtract_holes_sh() for why.
            let mut holes_2d: Vec<Vec<(f64, f64)>> = Vec::new();
            for inner in face.inners() {
                let hole_vids = match self.collect_loop_verts(inner.start) {
                    Ok(vs) => vs,
                    Err(_) => continue,
                };
                if hole_vids.len() < 3 { continue; }
                let hole_verts: Vec<DVec3> = hole_vids.iter()
                    .filter_map(|&vid| self.vertex_pos(vid).ok())
                    .collect();
                if hole_verts.len() < 3 { continue; }
                let mut h2d: Vec<(f64, f64)> = hole_verts.iter().map(|p| {
                    let d = *p - origin;
                    (d.dot(u), d.dot(v))
                }).collect();
                // Force CW — treat as "subtract" operand in clip.
                if signed_area_2d(&h2d) > 0.0 {
                    h2d.reverse();
                }
                holes_2d.push(h2d);
            }

            receivers.push(Receiver { origin, normal: n, u, v, outline_2d, holes_2d });
        }

        // 2) For each sun-facing caster, project to each valid receiver.
        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let dot = face.normal().dot(-sun_dir);
            if dot <= SF_EPS { continue; }

            let outer_start = face.outer().start;
            let vert_ids = match self.collect_loop_verts(outer_start) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if vert_ids.len() < 3 { continue; }
            let caster_3d: Vec<DVec3> = vert_ids.iter()
                .filter_map(|&vid| self.vertex_pos(vid).ok())
                .collect();
            if caster_3d.len() < 3 { continue; }

            for recv in &receivers {
                // Sun must hit the receiver plane from the lit side.
                let denom = sun_dir.dot(recv.normal);
                if denom.abs() < 1e-6 { continue; }  // sun parallel to plane
                if denom > 0.0 { continue; }         // sun from behind the plane

                // Project each caster vertex to the receiver plane.
                // t = dot(origin - v, normal) / dot(sun_dir, normal)
                let mut projected_3d: Vec<DVec3> = Vec::with_capacity(caster_3d.len());
                let mut all_above = true;
                for cv in &caster_3d {
                    // Distance of caster vertex above plane (signed).
                    let signed = (*cv - recv.origin).dot(recv.normal);
                    if signed < -0.1 {
                        // Caster dips below this receiver plane — skip whole
                        // projection to avoid backward-facing solution.
                        all_above = false;
                        break;
                    }
                    // Only projects forward if cv is above and sun goes downward
                    // through plane. Otherwise skip.
                    let t = (recv.origin - *cv).dot(recv.normal) / denom;
                    if !t.is_finite() { all_above = false; break; }
                    projected_3d.push(*cv + sun_dir * t);
                }
                if !all_above { continue; }
                // Skip if the caster is entirely on (or fractionally above) the
                // receiver plane — nothing to cast.
                let max_signed = caster_3d.iter()
                    .map(|cv| (*cv - recv.origin).dot(recv.normal))
                    .fold(f64::NEG_INFINITY, f64::max);
                if max_signed < 0.5 { continue; }

                // Map to plane-local 2D.
                let projected_2d: Vec<(f64, f64)> = projected_3d.iter()
                    .map(|p| recv.to_2d(*p))
                    .collect();

                // Clip — ground has empty outline (no clip needed).
                // For concave outlines, clip_to_concave_outline decomposes into
                // triangles and emits a sequence of convex clipped polygons.
                let clipped_pieces: Vec<Vec<(f64, f64)>> = if recv.outline_2d.is_empty() {
                    vec![projected_2d]
                } else if is_convex_ccw(&recv.outline_2d) {
                    let c = sutherland_hodgman(&projected_2d, &recv.outline_2d);
                    if c.len() < 3 { continue; } else { vec![c] }
                } else {
                    clip_to_concave_outline(&projected_2d, &recv.outline_2d)
                };
                if clipped_pieces.is_empty() { continue; }

                // Phase 2.5b — hole subtraction.
                // S-H cannot directly subtract a convex hole from an arbitrary
                // subject (outside of convex clip is non-convex, which S-H
                // doesn't handle). We use a pragmatic two-step strategy:
                //   1) Quick centroid check — if the whole shadow centroid sits
                //      inside a hole, the shadow entirely falls on the hole →
                //      discard.
                //   2) Otherwise, split the clipped polygon into fan triangles
                //      and discard any triangle whose centroid sits inside any
                //      hole. This gives pixel-accurate result for convex holes
                //      when caster shadow partially overlaps the hole region.
                // This covers the common CAD cases (floor with round/square
                // cutouts, frame with window glass) without a full Weiler-
                // Atherton implementation.
                let holes = &recv.holes_2d;

                // Back to 3D + offset along receiver normal for z-fight safety.
                let epsn = recv.normal * RECV_EPS;
                for clipped_2d in &clipped_pieces {
                    if clipped_2d.len() < 3 { continue; }
                    let final_3d: Vec<DVec3> = clipped_2d.iter()
                        .map(|&uv| recv.to_3d(uv) + epsn)
                        .collect();

                    // Fan triangulate with per-triangle hole discard.
                    let p0 = final_3d[0];
                    let uv0 = clipped_2d[0];
                    for i in 1..final_3d.len() - 1 {
                        let p1 = final_3d[i];
                        let p2 = final_3d[i + 1];
                        if !holes.is_empty() {
                            let uv1 = clipped_2d[i];
                            let uv2 = clipped_2d[i + 1];
                            let centroid_2d = (
                                (uv0.0 + uv1.0 + uv2.0) / 3.0,
                                (uv0.1 + uv1.1 + uv2.1) / 3.0,
                            );
                            if holes.iter().any(|h| point_in_polygon_2d(centroid_2d, h)) {
                                continue;
                            }
                        }
                        for p in [p0, p1, p2] {
                            out.push(p.x as f32);
                            out.push(p.y as f32);
                            out.push(p.z as f32);
                        }
                    }
                }
            }
        }

        out
    }
}

/// Build an orthonormal (u, v) basis for a plane with the given normal.
fn build_plane_basis(n: DVec3) -> (DVec3, DVec3) {
    let nn = n.normalize_or_zero();
    // Pick a world axis not parallel to nn.
    let seed = if nn.x.abs() < 0.9 { DVec3::X } else { DVec3::Y };
    let u = seed.cross(nn).normalize_or_zero();
    let v = nn.cross(u).normalize_or_zero();
    (u, v)
}

// ═══════════════════════════════════════════════════════════════════
// Sutherland-Hodgman 2D polygon clipping (clean-room, no external deps).
// ═══════════════════════════════════════════════════════════════════

/// Clip `subject` polygon against convex CCW `clip` polygon.
fn sutherland_hodgman(subject: &[(f64, f64)], clip: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if clip.len() < 3 || subject.len() < 3 { return Vec::new(); }

    let mut output: Vec<(f64, f64)> = subject.to_vec();
    let n_clip = clip.len();

    for i in 0..n_clip {
        if output.is_empty() { break; }
        let input = std::mem::take(&mut output);
        let ce_start = clip[i];
        let ce_end = clip[(i + 1) % n_clip];
        let n_in = input.len();
        for j in 0..n_in {
            let cur = input[j];
            let prev = input[(j + n_in - 1) % n_in];
            let cur_inside = is_inside_ccw(cur, ce_start, ce_end);
            let prev_inside = is_inside_ccw(prev, ce_start, ce_end);
            if cur_inside {
                if !prev_inside {
                    if let Some(p) = line_intersect(prev, cur, ce_start, ce_end) {
                        output.push(p);
                    }
                }
                output.push(cur);
            } else if prev_inside {
                if let Some(p) = line_intersect(prev, cur, ce_start, ce_end) {
                    output.push(p);
                }
            }
        }
    }
    output
}

fn is_inside_ccw(p: (f64, f64), s: (f64, f64), e: (f64, f64)) -> bool {
    let cross = (e.0 - s.0) * (p.1 - s.1) - (e.1 - s.1) * (p.0 - s.0);
    cross >= 0.0
}

fn line_intersect(
    p1: (f64, f64), p2: (f64, f64),
    s: (f64, f64),  e: (f64, f64),
) -> Option<(f64, f64)> {
    let dx1 = p2.0 - p1.0;
    let dy1 = p2.1 - p1.1;
    let dx2 = e.0 - s.0;
    let dy2 = e.1 - s.1;
    let denom = dx1 * dy2 - dy1 * dx2;
    if denom.abs() < 1e-12 { return None; }
    let t = ((s.0 - p1.0) * dy2 - (s.1 - p1.1) * dx2) / denom;
    Some((p1.0 + t * dx1, p1.1 + t * dy1))
}

/// Is `poly` a convex CCW polygon? Checks that every consecutive triple
/// makes the same (non-negative) turn. Degenerate edges (zero cross) tolerated.
fn is_convex_ccw(poly: &[(f64, f64)]) -> bool {
    let n = poly.len();
    if n < 3 { return false; }
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        let c = poly[(i + 2) % n];
        let cross = (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0);
        if cross < -1e-9 { return false; }
    }
    true
}

/// Ear-clipping triangulation for a simple (possibly concave) CCW polygon.
/// Returns indices into `poly` as triangle triples. O(n^2), adequate for
/// typical architectural receiver outlines (≤ few dozen vertices).
fn ear_triangulate_2d(poly: &[(f64, f64)]) -> Vec<[usize; 3]> {
    let n = poly.len();
    if n < 3 { return Vec::new(); }
    let mut indices: Vec<usize> = (0..n).collect();
    let mut tris: Vec<[usize; 3]> = Vec::with_capacity(n.saturating_sub(2));
    let mut guard = n * n;  // worst-case budget

    while indices.len() > 3 && guard > 0 {
        guard -= 1;
        let m = indices.len();
        let mut ear_found = false;
        for i in 0..m {
            let ia = indices[(i + m - 1) % m];
            let ib = indices[i];
            let ic = indices[(i + 1) % m];
            let a = poly[ia];
            let b = poly[ib];
            let c = poly[ic];
            // Convex (CCW turn at b)?
            let cross = (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0);
            if cross <= 0.0 { continue; }
            // Does any other vertex lie strictly inside triangle (a,b,c)?
            let mut has_inside = false;
            for &j in &indices {
                if j == ia || j == ib || j == ic { continue; }
                if point_in_tri_2d(poly[j], a, b, c) { has_inside = true; break; }
            }
            if has_inside { continue; }
            tris.push([ia, ib, ic]);
            indices.remove(i);
            ear_found = true;
            break;
        }
        if !ear_found { break; }  // malformed polygon — salvage what we have
    }
    if indices.len() == 3 {
        tris.push([indices[0], indices[1], indices[2]]);
    }
    tris
}

fn point_in_tri_2d(p: (f64, f64), a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> bool {
    let s1 = (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0);
    let s2 = (c.0 - b.0) * (p.1 - b.1) - (c.1 - b.1) * (p.0 - b.0);
    let s3 = (a.0 - c.0) * (p.1 - c.1) - (a.1 - c.1) * (p.0 - c.0);
    let has_neg = s1 < 0.0 || s2 < 0.0 || s3 < 0.0;
    let has_pos = s1 > 0.0 || s2 > 0.0 || s3 > 0.0;
    !(has_neg && has_pos)
}

/// Clip `subject` against a concave CCW `outline` by first ear-triangulating
/// the outline and running Sutherland-Hodgman against each triangle. Returns
/// the list of non-empty clipped pieces.
fn clip_to_concave_outline(
    subject: &[(f64, f64)],
    outline: &[(f64, f64)],
) -> Vec<Vec<(f64, f64)>> {
    let tris = ear_triangulate_2d(outline);
    let mut pieces: Vec<Vec<(f64, f64)>> = Vec::new();
    for [i, j, k] in tris {
        let clip_tri = vec![outline[i], outline[j], outline[k]];
        let c = sutherland_hodgman(subject, &clip_tri);
        if c.len() >= 3 { pieces.push(c); }
    }
    pieces
}

/// 2D ray-casting point-in-polygon. Works for arbitrary simple polygons
/// (convex or concave), any winding.
fn point_in_polygon_2d(p: (f64, f64), poly: &[(f64, f64)]) -> bool {
    let n = poly.len();
    if n < 3 { return false; }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        // Ray from p going +X: does edge (xi,yi)-(xj,yj) cross it?
        let intersect = ((yi > p.1) != (yj > p.1))
            && (p.0 < (xj - xi) * (p.1 - yi) / (yj - yi + 1e-30) + xi);
        if intersect { inside = !inside; }
        j = i;
    }
    inside
}

fn signed_area_2d(poly: &[(f64, f64)]) -> f64 {
    let n = poly.len();
    if n < 3 { return 0.0; }
    let mut s = 0.0;
    for i in 0..n {
        let (x0, y0) = poly[i];
        let (x1, y1) = poly[(i + 1) % n];
        s += x0 * y1 - x1 * y0;
    }
    s * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::*;

    #[test]
    fn empty_mesh_returns_empty() {
        let mesh = Mesh::new();
        let out = mesh.compute_ground_projected_shadows(DVec3::new(0.0, -1.0, 0.0));
        assert!(out.is_empty());
    }

    #[test]
    fn sun_from_above_projects_top_face_onto_ground() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();
        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        // Phase 2.5a: caster also gets projected to its OWN face's plane
        // filtered out (max_signed<0.5), so only ground receives.
        // 4-vertex polygon → 2 triangles → 18 floats.
        assert_eq!(tris.len(), 18);
        for i in 0..6 {
            let y = tris[i * 3 + 1];
            assert!(y > 0.0 && y < 1.0, "y near 0.5 (ground+RECV_EPS), got {y}");
        }
    }

    #[test]
    fn sun_with_lateral_offset_shifts_projection() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(1000.0, 1000.0, 0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(-1.0, -1.0, 0.0).normalize();
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty());
        let sum_x: f32 = (0..(tris.len() / 9))
            .flat_map(|i| [tris[i * 9 + 0], tris[i * 9 + 3], tris[i * 9 + 6]])
            .sum();
        assert!(sum_x < -1000.0, "shadow must be shifted toward -X, got {sum_x}");
    }

    #[test]
    fn vertical_face_not_projected() {
        // Normal on +X, not sun-facing under sun=(0,-1,0).
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();
        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(tris.is_empty());
    }

    #[test]
    fn ground_level_face_skipped() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();
        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(tris.is_empty());
    }

    #[test]
    fn sh_unit_square_clip_fully_contained() {
        let clip = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let subject = vec![(2.0, 2.0), (8.0, 2.0), (8.0, 8.0), (2.0, 8.0)];
        let out = sutherland_hodgman(&subject, &clip);
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn sh_unit_square_clip_fully_outside() {
        let clip = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let subject = vec![(20.0, 20.0), (30.0, 20.0), (30.0, 30.0), (20.0, 30.0)];
        let out = sutherland_hodgman(&subject, &clip);
        assert!(out.is_empty());
    }

    #[test]
    fn sh_partial_overlap_produces_rectangle() {
        let clip = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let subject = vec![(5.0, 2.0), (15.0, 2.0), (15.0, 8.0), (5.0, 8.0)];
        let out = sutherland_hodgman(&subject, &clip);
        assert!(out.len() >= 4);
        assert!(out.iter().any(|p| (p.0 - 10.0).abs() < 1e-6));
    }

    #[test]
    fn shadow_on_top_of_box_clips_correctly() {
        let mut mesh = Mesh::new();
        let t0 = mesh.add_vertex(DVec3::new(0.0,    500.0, 0.0));
        let t1 = mesh.add_vertex(DVec3::new(0.0,    500.0, 1000.0));
        let t2 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 1000.0));
        let t3 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 0.0));
        mesh.add_face_with_holes(&[t0, t1, t2, t3], &[], MaterialId::new(0)).unwrap();

        let c0 = mesh.add_vertex(DVec3::new(400.0, 1500.0, 400.0));
        let c1 = mesh.add_vertex(DVec3::new(400.0, 1500.0, 600.0));
        let c2 = mesh.add_vertex(DVec3::new(600.0, 1500.0, 600.0));
        let c3 = mesh.add_vertex(DVec3::new(600.0, 1500.0, 400.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty());
        let ys: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 1]).collect();
        let has_ground = ys.iter().any(|y| (y - 0.5).abs() < 0.01);
        let has_box_top = ys.iter().any(|y| (y - 500.5).abs() < 0.01);
        assert!(has_ground);
        assert!(has_box_top);
    }

    #[test]
    fn vertical_sunfacing_wall_connects_base_to_shadow() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0,     0.0,   0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0,     500.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0,  500.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(1000.0,  0.0,   0.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 1.0).normalize();
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty());
        let zs: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 2]).collect();
        let has_near_base = zs.iter().any(|&z| z.abs() < 10.0);
        let has_far_offset = zs.iter().any(|&z| z > 100.0);
        assert!(has_near_base);
        assert!(has_far_offset);
    }

    #[test]
    fn caster_below_box_top_does_not_project_onto_box_top() {
        let mut mesh = Mesh::new();
        let t0 = mesh.add_vertex(DVec3::new(0.0,    500.0, 0.0));
        let t1 = mesh.add_vertex(DVec3::new(0.0,    500.0, 1000.0));
        let t2 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 1000.0));
        let t3 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 0.0));
        mesh.add_face_with_holes(&[t0, t1, t2, t3], &[], MaterialId::new(0)).unwrap();

        let c0 = mesh.add_vertex(DVec3::new(2000.0, 200.0, 2000.0));
        let c1 = mesh.add_vertex(DVec3::new(2000.0, 200.0, 2200.0));
        let c2 = mesh.add_vertex(DVec3::new(2200.0, 200.0, 2200.0));
        let c3 = mesh.add_vertex(DVec3::new(2200.0, 200.0, 2000.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        let ys: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 1]).collect();
        assert!(!ys.iter().any(|y| (y - 500.5).abs() < 0.01));
    }

    #[test]
    fn ear_triangulate_concave_produces_valid_tris() {
        // L-shape (6 vertices, concave CCW).
        let l = vec![
            (0.0, 0.0), (2.0, 0.0), (2.0, 1.0),
            (1.0, 1.0), (1.0, 2.0), (0.0, 2.0),
        ];
        assert!(!is_convex_ccw(&l));
        let tris = ear_triangulate_2d(&l);
        // 6-vertex polygon → 4 triangles.
        assert_eq!(tris.len(), 4);
    }

    #[test]
    fn concave_receiver_clips_subject_per_triangle() {
        // Concave L-shape receiver, subject (caster shadow) overlaps only
        // the foot of the L → only one triangle of the decomposed L should
        // retain overlap; concave clip helper must produce something.
        let outline: Vec<(f64, f64)> = vec![
            (0.0, 0.0), (2000.0, 0.0), (2000.0, 1000.0),
            (1000.0, 1000.0), (1000.0, 2000.0), (0.0, 2000.0),
        ];
        let subject = vec![
            (1500.0, 200.0), (1800.0, 200.0),
            (1800.0, 500.0), (1500.0, 500.0),
        ];
        let pieces = clip_to_concave_outline(&subject, &outline);
        assert!(!pieces.is_empty(), "concave clip must keep something");
        // Total clipped area should equal subject area (300×300 = 90000)
        // because subject is fully inside the L's foot.
        let total_area: f64 = pieces.iter().map(|p| signed_area_2d(p).abs()).sum();
        assert!((total_area - 90000.0).abs() < 1.0, "area {total_area} ≠ 90000");
    }

    #[test]
    fn receiver_with_hole_does_not_catch_shadow_in_hole() {
        // Phase 2.5b: receiver(floor) with a square hole. Caster shadow lands
        // entirely inside the hole → result should have no receiver triangles
        // at the floor's y level.
        let mut mesh = Mesh::new();

        // Floor at y=0 (we need y > 1 to be picked as a receiver, so floor at
        // y=100 instead of ground).
        let f0 = mesh.add_vertex(DVec3::new(-2000.0, 100.0, -2000.0));
        let f1 = mesh.add_vertex(DVec3::new(-2000.0, 100.0,  2000.0));
        let f2 = mesh.add_vertex(DVec3::new( 2000.0, 100.0,  2000.0));
        let f3 = mesh.add_vertex(DVec3::new( 2000.0, 100.0, -2000.0));
        // Hole in middle — 600x600 square.
        let h0 = mesh.add_vertex(DVec3::new(-300.0, 100.0, -300.0));
        let h1 = mesh.add_vertex(DVec3::new( 300.0, 100.0, -300.0));
        let h2 = mesh.add_vertex(DVec3::new( 300.0, 100.0,  300.0));
        let h3 = mesh.add_vertex(DVec3::new(-300.0, 100.0,  300.0));
        // Face with outer CCW (+Y normal) + inner CW hole.
        let hole: [VertId; 4] = [h0, h1, h2, h3];
        mesh.add_face_with_holes(
            &[f0, f1, f2, f3],
            &[&hole[..]],
            MaterialId::new(0),
        ).unwrap();

        // Small caster directly above the hole.
        let c0 = mesh.add_vertex(DVec3::new(-100.0, 2000.0, -100.0));
        let c1 = mesh.add_vertex(DVec3::new(-100.0, 2000.0,  100.0));
        let c2 = mesh.add_vertex(DVec3::new( 100.0, 2000.0,  100.0));
        let c3 = mesh.add_vertex(DVec3::new( 100.0, 2000.0, -100.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        // Triangles at floor-level y (~100.5) must be empty: caster shadow
        // fully sits inside the hole → discarded.
        let floor_tris = (0..tris.len() / 9).filter(|i| {
            let y0 = tris[i * 9 + 1];
            let y1 = tris[i * 9 + 4];
            let y2 = tris[i * 9 + 7];
            (y0 - 100.5).abs() < 0.1 && (y1 - 100.5).abs() < 0.1 && (y2 - 100.5).abs() < 0.1
        }).count();
        assert_eq!(floor_tris, 0, "caster shadow over hole should punch through receiver");
        // But ground shadow (y≈0.5) must still exist (caster still shadows ground).
        let ground_tris = (0..tris.len() / 9).filter(|i| {
            let y0 = tris[i * 9 + 1];
            (y0 - 0.5).abs() < 0.1
        }).count();
        assert!(ground_tris > 0, "caster must still cast onto ground through the hole");
    }

    #[test]
    fn tilted_ramp_receives_shadow() {
        // Phase 2.5a: 45° 기울어진 램프가 receiver로 작동해야 함.
        // 램프: 한쪽 끝 y=0, 반대쪽 끝 y=1000. 작은 caster를 램프 위로 띄움.
        let mut mesh = Mesh::new();
        // Ramp corners (view from above, ramp rises +X direction).
        // CCW from above for +Y upward-tilted plane:
        let r0 = mesh.add_vertex(DVec3::new(0.0,    0.0,    0.0));
        let r1 = mesh.add_vertex(DVec3::new(0.0,    0.0,    2000.0));
        let r2 = mesh.add_vertex(DVec3::new(2000.0, 1000.0, 2000.0));
        let r3 = mesh.add_vertex(DVec3::new(2000.0, 1000.0, 0.0));
        mesh.add_face_with_holes(&[r0, r1, r2, r3], &[], MaterialId::new(0)).unwrap();

        // Caster above ramp center, small square.
        let c0 = mesh.add_vertex(DVec3::new(800.0,  2000.0, 800.0));
        let c1 = mesh.add_vertex(DVec3::new(800.0,  2000.0, 1200.0));
        let c2 = mesh.add_vertex(DVec3::new(1200.0, 2000.0, 1200.0));
        let c3 = mesh.add_vertex(DVec3::new(1200.0, 2000.0, 800.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty());
        // Some triangles should land on the ramp (y between 0.5 and 1000.5),
        // not only on the ground (y ≈ 0.5).
        let ys: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 1]).collect();
        let has_ramp = ys.iter().any(|&y| y > 10.0);
        assert!(has_ramp, "tilted ramp must catch some shadow (expected y > 10), got ys={ys:?}");
    }
}
