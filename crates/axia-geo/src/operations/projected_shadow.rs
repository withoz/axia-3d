//! Projected Shadow — Sun-facing face들을 multi-plane receiver에 투영.
//!
//! ## Phase 2.4 — Multi-receiver + Sutherland-Hodgman clipping (2026-04-23)
//!
//! 이전 Phase 2.3까지는 ground(y=0) 단일 receiver만 처리해서 박스 위에 올려놓은
//! 객체의 그림자가 박스 윗면에 떨어지지 않고 박스를 통과해 지면에 생성됐다.
//! Phase 2.4에서:
//!
//! 1) `collect_top_receivers()` — `normal.y > 0.7`인 모든 active face를 수평
//!    receiver로 수집 (ground y=0은 항상 포함, 무한 범위로 표시).
//! 2) 각 sun-facing caster face를 각 receiver 평면에 투영 후 receiver
//!    outline(2D XZ)에 Sutherland-Hodgman 클리핑.
//! 3) 결과 polygon을 fan triangulate해 receiver y + 0.5mm 높이로 emit.
//!
//! ### Clipping 라이선스
//! Sutherland-Hodgman은 1974년 Sutherland & Hodgman 공개 알고리즘으로 특허
//! 없음. 본 구현은 교과서 pseudo-code 기반의 clean-room 작성. 외부 라이브러리
//! 의존 없음.
//!
//! ### 제약 (현재)
//! - Receiver outline은 convex로 가정 (대부분의 top face: 박스 top, 테이블,
//!   바닥 슬래브가 convex라 실용적으로 충분). concave receiver는 나중에
//!   triangulation 후 각 triangle에 대해 clip하도록 확장.
//! - Caster는 receiver "위"에 있을 때만 투영 (min_y > receiver_y + eps).
//!   Caster가 receiver 평면을 관통할 경우 skip — 일반적 씬에서 드문 경우.
//! - 각 caster는 가능한 모든 receiver에 중첩 투영됨. MinEquation blending이
//!   per-pixel min으로 균일 darkness 유지. 박스 top 뒤에 가려진 ground 그림자는
//!   보이지 않으므로 overdraw는 시각적으로 무해.

use glam::DVec3;

use crate::mesh::Mesh;

/// 수평 receiver 평면 정보.
/// `outline`: 비어있으면 무한 범위 (ground), 아니면 2D XZ outline (CCW from above).
struct Receiver {
    y: f64,
    outline: Vec<(f64, f64)>,  // empty = infinite ground
}

impl Mesh {
    /// Compute projected shadow triangles on all top-facing receivers.
    /// Returns flat buffer of triangle vertices (9 f32 per tri). Each triangle's
    /// y coordinate is set to the receiver plane + small epsilon (0.5mm) to
    /// avoid z-fight with the receiver surface.
    ///
    /// Backwards-compatible name retained; algorithm now multi-receiver.
    pub fn compute_ground_projected_shadows(&self, sun_dir: DVec3) -> Vec<f32> {
        let mut out = Vec::new();
        if sun_dir.y > -1e-4 {
            return out;
        }

        const SF_EPS: f64 = 0.001;
        const MIN_HEIGHT: f64 = 1.0;   // caster가 이보다 낮으면 무시
        const RECV_EPS: f64 = 0.5;     // receiver 위 몇 mm 띄워 z-fight 회피
        const UP_THRESHOLD: f64 = 0.7; // top-face 판정 (normal.y > this)

        // 1) Collect receivers — always include ground (infinite outline=[]).
        let mut receivers: Vec<Receiver> = vec![Receiver { y: 0.0, outline: vec![] }];

        for (_fid, face) in self.faces.iter() {
            if !face.is_active() { continue; }
            let n = face.normal();
            if n.y < UP_THRESHOLD { continue; }

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

            // 평균 y를 receiver plane으로 사용 (top face는 대체로 coplanar)
            let avg_y: f64 = verts_3d.iter().map(|v| v.y).sum::<f64>() / verts_3d.len() as f64;
            if avg_y < MIN_HEIGHT { continue; }  // ground 근처는 ground receiver가 담당

            let mut outline: Vec<(f64, f64)> = verts_3d.iter().map(|v| (v.x, v.z)).collect();
            // 2D clip 알고리즘은 CCW 가정. 필요 시 뒤집음.
            if signed_area_2d(&outline) < 0.0 {
                outline.reverse();
            }
            receivers.push(Receiver { y: avg_y, outline });
        }

        // 2) For each sun-facing caster, project to each receiver strictly below.
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

            let caster_min_y = caster_3d.iter().map(|v| v.y).fold(f64::INFINITY, f64::min);
            if caster_min_y <= MIN_HEIGHT && receivers.len() == 1 { continue; }

            for recv in &receivers {
                // Caster must be strictly above receiver to cast onto it.
                if caster_min_y <= recv.y + 0.1 { continue; }

                // Project caster vertices onto plane y = recv.y
                let projected: Vec<(f64, f64)> = caster_3d.iter().map(|v| {
                    let t = (recv.y - v.y) / sun_dir.y;
                    (v.x + sun_dir.x * t, v.z + sun_dir.z * t)
                }).collect();

                // Clip against receiver outline (empty outline = ground, no clip).
                let clipped = if recv.outline.is_empty() {
                    projected
                } else {
                    sutherland_hodgman(&projected, &recv.outline)
                };
                if clipped.len() < 3 { continue; }

                let y_out = (recv.y + RECV_EPS) as f32;
                let (x0, z0) = clipped[0];
                for i in 1..clipped.len() - 1 {
                    let (x1, z1) = clipped[i];
                    let (x2, z2) = clipped[i + 1];
                    out.push(x0 as f32); out.push(y_out); out.push(z0 as f32);
                    out.push(x1 as f32); out.push(y_out); out.push(z1 as f32);
                    out.push(x2 as f32); out.push(y_out); out.push(z2 as f32);
                }
            }
        }

        out
    }
}

// ═══════════════════════════════════════════════════════════════════
// Sutherland-Hodgman 2D polygon clipping (public-domain algorithm).
// Sutherland, I.E. & Hodgman, G.W. (1974). "Reentrant Polygon Clipping".
// Communications of the ACM. No patents; clean-room Rust implementation.
// ═══════════════════════════════════════════════════════════════════

/// Clip `subject` polygon against `clip` polygon (assumed CCW, convex).
/// Returns the clipped polygon (possibly empty if fully outside).
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

/// 2D: point P on the left (inside) of directed edge S→E for a CCW polygon.
fn is_inside_ccw(p: (f64, f64), s: (f64, f64), e: (f64, f64)) -> bool {
    let cross = (e.0 - s.0) * (p.1 - s.1) - (e.1 - s.1) * (p.0 - s.0);
    cross >= 0.0
}

/// 2D line segment intersection. None if parallel within tolerance.
fn line_intersect(
    p1: (f64, f64), p2: (f64, f64),
    s: (f64, f64),  e: (f64, f64),
) -> Option<(f64, f64)> {
    let dx1 = p2.0 - p1.0;
    let dy1 = p2.1 - p1.1;
    let dx2 = e.0 - s.0;
    let dy2 = e.1 - s.1;
    let denom = dx1 * dy2 - dy1 * dx2;
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = ((s.0 - p1.0) * dy2 - (s.1 - p1.1) * dx2) / denom;
    Some((p1.0 + t * dx1, p1.1 + t * dy1))
}

/// Shoelace signed area. Positive = CCW in a standard right-handed 2D frame.
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
        // 4-vertex polygon → fan tri (2 triangles) → 2 * 9 = 18 floats
        assert_eq!(tris.len(), 18);
        // All projected y should be ~0.5 (RECV_EPS)
        for i in 0..6 {
            let y = tris[i * 3 + 1];
            assert!(y > 0.0 && y < 1.0, "y should be small positive (RECV_EPS=0.5), got {y}");
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
        assert!(sum_x < -1000.0, "shadow must be shifted toward -X, got sum_x={sum_x}");
    }

    #[test]
    fn vertical_face_not_projected() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 1000.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        mesh.add_face_with_holes(&[v0, v1, v2, v3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(tris.is_empty(), "vertical face (normal.y≈0) should not cast");
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
        assert!(tris.is_empty(), "ground-level face should not cast on itself");
    }

    // ─── Sutherland-Hodgman unit tests ────────────────────────────────

    #[test]
    fn sh_unit_square_clip_fully_contained() {
        // Subject square inside larger clip square → subject returned.
        let clip = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];  // CCW
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
        // Subject shifted so half is outside +X side.
        let subject = vec![(5.0, 2.0), (15.0, 2.0), (15.0, 8.0), (5.0, 8.0)];
        let out = sutherland_hodgman(&subject, &clip);
        // Should be clipped to (5,2)-(10,2)-(10,8)-(5,8)
        assert!(out.len() >= 4, "expected 4+ vertices, got {}", out.len());
        assert!(out.iter().any(|p| (p.0 - 10.0).abs() < 1e-6), "must contain x=10 clip edge");
    }

    // ─── Multi-receiver integration ───────────────────────────────────

    #[test]
    fn shadow_on_top_of_box_clips_correctly() {
        // Box top at y=500 (1000x1000 square), cat-like face at y=1500 above it.
        let mut mesh = Mesh::new();

        // Box TOP face: CCW from above.
        // Box TOP face — CCW from above = +Y normal (z increases first, then x).
        let t0 = mesh.add_vertex(DVec3::new(0.0,    500.0, 0.0));
        let t1 = mesh.add_vertex(DVec3::new(0.0,    500.0, 1000.0));
        let t2 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 1000.0));
        let t3 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 0.0));
        mesh.add_face_with_holes(&[t0, t1, t2, t3], &[], MaterialId::new(0)).unwrap();

        // Small square CASTER floating at y=1500, above box center.
        // CCW from above = +Y normal = (z increases first, then x).
        let c0 = mesh.add_vertex(DVec3::new(400.0, 1500.0, 400.0));
        let c1 = mesh.add_vertex(DVec3::new(400.0, 1500.0, 600.0));
        let c2 = mesh.add_vertex(DVec3::new(600.0, 1500.0, 600.0));
        let c3 = mesh.add_vertex(DVec3::new(600.0, 1500.0, 400.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        assert!(!tris.is_empty(), "must produce shadow triangles");

        // Expect triangles at y≈0.5 (ground receiver) AND y≈500.5 (box top).
        let ys: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 1]).collect();
        let has_ground = ys.iter().any(|y| (y - 0.5).abs() < 0.01);
        let has_box_top = ys.iter().any(|y| (y - 500.5).abs() < 0.01);
        assert!(has_ground, "ground receiver must get some shadow (box top also casts onto ground)");
        assert!(has_box_top, "box top must be a receiver for the caster above it");
    }

    #[test]
    fn caster_below_box_top_does_not_project_onto_box_top() {
        // Caster at y=200 (below box top at y=500). Should only go to ground,
        // not to box top.
        let mut mesh = Mesh::new();

        // Box TOP face — CCW from above = +Y normal (z increases first, then x).
        let t0 = mesh.add_vertex(DVec3::new(0.0,    500.0, 0.0));
        let t1 = mesh.add_vertex(DVec3::new(0.0,    500.0, 1000.0));
        let t2 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 1000.0));
        let t3 = mesh.add_vertex(DVec3::new(1000.0, 500.0, 0.0));
        mesh.add_face_with_holes(&[t0, t1, t2, t3], &[], MaterialId::new(0)).unwrap();

        // Low caster outside box (CCW from above = +Y normal).
        let c0 = mesh.add_vertex(DVec3::new(2000.0, 200.0, 2000.0));
        let c1 = mesh.add_vertex(DVec3::new(2000.0, 200.0, 2200.0));
        let c2 = mesh.add_vertex(DVec3::new(2200.0, 200.0, 2200.0));
        let c3 = mesh.add_vertex(DVec3::new(2200.0, 200.0, 2000.0));
        mesh.add_face_with_holes(&[c0, c1, c2, c3], &[], MaterialId::new(0)).unwrap();

        let sun_dir = DVec3::new(0.0, -1.0, 0.0);
        let tris = mesh.compute_ground_projected_shadows(sun_dir);
        let ys: Vec<f32> = (0..tris.len() / 3).map(|i| tris[i * 3 + 1]).collect();
        let has_box_top = ys.iter().any(|y| (y - 500.5).abs() < 0.01);
        assert!(!has_box_top, "caster below box must not project onto box top");
    }
}
