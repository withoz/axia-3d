//! Polygon geometry utilities — ported from FreeDesignX buildragon.
//!
//! 3D 평면 polygon 에 대한 엄밀한 containment / interior-point 판정 유틸.
//! `dissolve_containing_faces` 등 "outer face 가 inner face 를 감싸는가" 판정
//! 이 centroid-only 휴리스틱으로 오판되는 것을 바로잡기 위해 추가.
//!
//! 핵심:
//!   - `face_unit_normal` — Newell's method
//!   - `strict_interior_point_3d` — ear-clipping 기반 엄밀 내부점
//!   - `point_in_polygon_winding` — winding-angle 기반 (boundary 포함/엄밀 분기)
//!   - `polygon_contains_polygon` — inner 의 모든 vertex + 내부점이 outer 안

use glam::DVec3;

/// 폴리곤 법선 (Newell's method + 정규화). 퇴화 폴리곤이면 None.
pub fn face_unit_normal(poly: &[DVec3]) -> Option<DVec3> {
    if poly.len() < 3 { return None; }
    let mut n = DVec3::ZERO;
    for i in 0..poly.len() {
        n += poly[i].cross(poly[(i + 1) % poly.len()]);
    }
    let len = n.length();
    if len < 1e-10 { return None; }
    Some(n / len)
}

/// Triangle abc 의 엄밀 내부(엣지/꼭짓점 제외) 에 p 가 있는가.
///
/// - 퇴화 삼각형(면적≈0)이면 false
/// - p 가 엣지/꼭짓점 위면 false
/// - 투영 없이 3D 벡터 연산만 사용
pub fn point_in_triangle_strict(p: DVec3, a: DVec3, b: DVec3, c: DVec3, eps: f64) -> bool {
    let n = (b - a).cross(c - a);
    let area2 = n.length();
    if area2 < eps { return false; }
    let n = n / area2;

    let ab = b - a; let ap = p - a;
    let bc = c - b; let bp = p - b;
    let ca = a - c; let cp = p - c;

    let s1 = n.dot(ab.cross(ap));
    let s2 = n.dot(bc.cross(bp));
    let s3 = n.dot(ca.cross(cp));

    (s1 > eps) && (s2 > eps) && (s3 > eps)
}

/// 단순 다각형(볼록/오목, 단일 평면) 에서 엄밀 내부점 하나 반환.
/// ear-clipping: 귀 하나 찾아 그 내심 반환.
///
/// 항상 엄밀 내부점을 보장 (centroid 처럼 오목 시 외부로 떨어지지 않음).
pub fn strict_interior_point_3d(poly: &[DVec3]) -> Option<DVec3> {
    const PLANE_EPS: f64 = 1e-12;
    const INSIDE_EPS: f64 = 1e-12;

    if poly.len() < 3 { return None; }

    // Newell 법선
    let mut n = DVec3::ZERO;
    for i in 0..poly.len() {
        n += poly[i].cross(poly[(i + 1) % poly.len()]);
    }
    let n_len = n.length();
    if n_len < PLANE_EPS { return None; }
    let n = n / n_len;

    let tri_area = |a: DVec3, b: DVec3, c: DVec3| (b - a).cross(c - a).length() * 0.5;

    let is_convex = |a: DVec3, b: DVec3, c: DVec3| -> bool {
        let e1 = c - b;
        let e0 = a - b;
        n.dot(e1.cross(e0)) > INSIDE_EPS
    };

    let incenter = |a: DVec3, b: DVec3, c: DVec3| -> DVec3 {
        let la = (b - c).length();
        let lb = (c - a).length();
        let lc = (a - b).length();
        let sum = la + lb + lc;
        (a * la + b * lb + c * lc) / sum
    };

    let m = poly.len();
    for j in 0..m {
        let i0 = (j + m - 1) % m;
        let i1 = j;
        let i2 = (j + 1) % m;

        let a = poly[i0];
        let b = poly[i1];
        let c = poly[i2];

        if tri_area(a, b, c) < PLANE_EPS { continue; }
        if !is_convex(a, b, c) { continue; }

        // 다른 정점이 이 삼각형 안에 있으면 귀 아님
        let mut any_inside = false;
        for k in 0..m {
            if k == i0 || k == i1 || k == i2 { continue; }
            let p = poly[k];
            let plane_dist = (p - a).dot(n).abs();
            if plane_dist > 1e-9 { continue; }
            if point_in_triangle_strict(p, a, b, c, INSIDE_EPS) {
                any_inside = true;
                break;
            }
        }
        if any_inside { continue; }

        return Some(incenter(a, b, c));
    }

    None
}

/// winding-angle 기반 point-in-polygon. `include_boundary=true` 면 경계 위도 true.
pub fn point_in_polygon_winding(
    p: DVec3,
    poly: &[DVec3],
    n: DVec3,
    edge_eps: f64,
    angle_tol: f64,
    include_boundary: bool,
) -> bool {
    if poly.len() < 3 { return false; }

    // 경계 근접 검사
    let on_seg = |a: DVec3, b: DVec3, q: DVec3| -> bool {
        let ab = b - a;
        let ab2 = ab.length_squared();
        if ab2 == 0.0 { return (q - a).length() <= edge_eps; }
        let mut t = (q - a).dot(ab) / ab2;
        if t < 0.0 { t = 0.0; } else if t > 1.0 { t = 1.0; }
        let c = a + ab * t;
        (q - c).length() <= edge_eps
    };
    for i in 0..poly.len() {
        if on_seg(poly[i], poly[(i + 1) % poly.len()], p) {
            return include_boundary;
        }
    }

    // winding angle 합
    let mut sum = 0.0f64;
    for i in 0..poly.len() {
        let u_raw = poly[i] - p;
        let v_raw = poly[(i + 1) % poly.len()] - p;
        let u_len = u_raw.length();
        let v_len = v_raw.length();
        if u_len <= edge_eps || v_len <= edge_eps {
            // 꼭짓점 근접 → 경계로 간주
            return include_boundary;
        }
        let u = u_raw / u_len;
        let v = v_raw / v_len;
        let sin_signed = n.dot(u.cross(v));
        let mut cosv = u.dot(v);
        if cosv > 1.0 { cosv = 1.0; }
        if cosv < -1.0 { cosv = -1.0; }
        sum += sin_signed.atan2(cosv);
    }
    (sum.abs() - std::f64::consts::TAU).abs() <= angle_tol
}

/// 공면 polygon 용 2D projection 기저.
/// poly 의 첫 edge 방향을 e1, normal × e1 을 e2 로 설정.
/// `project`(p) 로 2D 좌표, `lift`(x,y) 로 3D 복원.
#[derive(Debug, Clone, Copy)]
pub struct PlaneBasis {
    pub origin: DVec3,
    pub e1: DVec3,
    pub e2: DVec3,
    pub normal: DVec3,
}

impl PlaneBasis {
    pub fn from_polygon(poly: &[DVec3]) -> Option<Self> {
        if poly.len() < 3 { return None; }
        let normal = face_unit_normal(poly)?;
        let origin = poly[0];
        // 첫 non-degenerate edge
        let mut e1 = DVec3::ZERO;
        for i in 1..poly.len() {
            let v = poly[i] - origin;
            if v.length_squared() > 1e-12 {
                e1 = v.normalize();
                break;
            }
        }
        if e1.length_squared() < 0.5 { return None; }
        let e2 = normal.cross(e1).normalize_or_zero();
        if e2.length_squared() < 0.5 { return None; }
        Some(Self { origin, e1, e2, normal })
    }

    pub fn project(&self, p: DVec3) -> (f64, f64) {
        let v = p - self.origin;
        (v.dot(self.e1), v.dot(self.e2))
    }

    pub fn lift(&self, x: f64, y: f64) -> DVec3 {
        self.origin + self.e1 * x + self.e2 * y
    }
}

/// 두 볼록 공면 polygon 의 intersection polygon 반환 (Sutherland-Hodgman).
///
/// 전제:
///   - 두 polygon 이 거의 같은 평면
///   - `subject` 는 볼록, `clip` 은 볼록 (S-H 가정)
///
/// 반환:
///   - `None` — 완전 비교차 (intersection 비어있음)
///   - `Some(verts)` — 교차 polygon 의 2D 꼭짓점 (CCW, basis 2D 좌표)
///
/// L-shape 등 비볼록 입력에선 결과가 부정확할 수 있음 (→ Weiler-Atherton
/// 필요 신호). 현재 5-rect chain 오류는 모두 rect × rect 볼록 케이스.
pub fn sutherland_hodgman(subject_2d: &[(f64, f64)], clip_2d: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    if subject_2d.len() < 3 || clip_2d.len() < 3 { return None; }

    // clip polygon 의 에지 기준으로 half-plane clip 반복
    let mut output = subject_2d.to_vec();

    for i in 0..clip_2d.len() {
        if output.is_empty() { return None; }
        let input = std::mem::take(&mut output);

        let a = clip_2d[i];
        let b = clip_2d[(i + 1) % clip_2d.len()];
        let edge = (b.0 - a.0, b.1 - a.1);
        // CCW clip polygon: interior is to the LEFT of edge a→b.
        // 2D left test: cross(b-a, p-a) > 0.
        let is_inside = |p: (f64, f64)| -> f64 {
            edge.0 * (p.1 - a.1) - edge.1 * (p.0 - a.0)
        };
        // intersection of segment (s,e) with line a-b
        let line_intersect = |s: (f64, f64), e: (f64, f64)| -> Option<(f64, f64)> {
            let d1 = (e.0 - s.0, e.1 - s.1);
            let denom = d1.0 * edge.1 - d1.1 * edge.0;
            if denom.abs() < 1e-14 { return None; }
            let t = ((a.0 - s.0) * edge.1 - (a.1 - s.1) * edge.0) / denom;
            Some((s.0 + d1.0 * t, s.1 + d1.1 * t))
        };

        for j in 0..input.len() {
            let current = input[j];
            let prev = input[(j + input.len() - 1) % input.len()];
            let cur_in = is_inside(current);
            let prev_in = is_inside(prev);
            // CCW clip: inside → cross >= 0. Use > -eps for numerical robustness.
            const EPS: f64 = -1e-9;
            if cur_in >= EPS {
                if prev_in < EPS {
                    if let Some(p) = line_intersect(prev, current) { output.push(p); }
                }
                output.push(current);
            } else if prev_in >= EPS {
                if let Some(p) = line_intersect(prev, current) { output.push(p); }
            }
        }
    }

    // 동일 점 dedup
    if output.len() < 3 { return None; }
    let mut dedup = Vec::with_capacity(output.len());
    for p in &output {
        if let Some(last) = dedup.last() {
            let d: (f64, f64) = (p.0 - (last as &(f64,f64)).0, p.1 - (last as &(f64,f64)).1);
            if d.0.abs() < 1e-6 && d.1.abs() < 1e-6 { continue; }
        }
        dedup.push(*p);
    }
    // 마지막-첫 동일성
    if dedup.len() >= 2 {
        let first = dedup[0];
        let last = *dedup.last().unwrap();
        if (first.0 - last.0).abs() < 1e-6 && (first.1 - last.1).abs() < 1e-6 {
            dedup.pop();
        }
    }
    if dedup.len() < 3 { return None; }

    // 면적이 거의 0 이면 degenerate intersection 으로 간주
    let mut area2 = 0.0;
    for i in 0..dedup.len() {
        let (x1, y1) = dedup[i];
        let (x2, y2) = dedup[(i + 1) % dedup.len()];
        area2 += x1 * y2 - x2 * y1;
    }
    if area2.abs() < 1e-3 { return None; }

    Some(dedup)
}

/// 두 공면 (convex) polygon 의 union polygon 반환.
/// Sutherland-Hodgman 은 intersection 만 직접 지원하므로 union 은
///   A ∪ B = A + (B - A) 의 boundary 합성으로 구현.
/// 두 polygon 이 완전히 분리된 경우 None (호출자가 별도 처리).
/// 하나가 다른 하나를 완전히 포함하면 큰 쪽 반환.
///
/// 알고리즘 (convex 가정):
///   1. A vertices 중 B 외부에 있는 것들 + B vertices 중 A 외부에 있는 것들
///   2. boundary intersection 점들
///   3. CCW order 로 정렬 (centroid 기준 atan2)
pub fn convex_union_2d(a: &[(f64, f64)], b: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    if a.len() < 3 || b.len() < 3 { return None; }
    let inter = sutherland_hodgman(a, b);
    if inter.is_none() {
        // No overlap — union is two disjoint polygons. Caller must
        //   handle this case separately; return None to signal.
        return None;
    }

    // Helper: is point strictly inside (or on boundary of) the polygon?
    let inside = |pt: (f64, f64), poly: &[(f64, f64)]| -> bool {
        let mut sum = 0.0_f64;
        for i in 0..poly.len() {
            let (ax, ay) = poly[i];
            let (bx, by) = poly[(i + 1) % poly.len()];
            let ux = ax - pt.0; let uy = ay - pt.1;
            let vx = bx - pt.0; let vy = by - pt.1;
            let ulen = (ux*ux + uy*uy).sqrt();
            let vlen = (vx*vx + vy*vy).sqrt();
            if ulen < 1e-9 || vlen < 1e-9 { return true; }
            let cross = ux*vy - uy*vx;
            let dot = ux*vx + uy*vy;
            let mut a = (cross / (ulen*vlen)).atan2(dot / (ulen*vlen));
            if a > std::f64::consts::PI { a -= 2.0 * std::f64::consts::PI; }
            if a < -std::f64::consts::PI { a += 2.0 * std::f64::consts::PI; }
            sum += a;
        }
        (sum.abs() - std::f64::consts::TAU).abs() < 1e-3
    };

    let mut points: Vec<(f64, f64)> = Vec::new();
    for &p in a { if !inside(p, b) { points.push(p); } }
    for &p in b { if !inside(p, a) { points.push(p); } }
    // Edge-edge intersections — collect all crossing points.
    let segs = |poly: &[(f64, f64)]| -> Vec<((f64,f64),(f64,f64))> {
        (0..poly.len()).map(|i| (poly[i], poly[(i+1)%poly.len()])).collect()
    };
    let segments_a = segs(a);
    let segments_b = segs(b);
    for &(p1, p2) in &segments_a {
        for &(p3, p4) in &segments_b {
            // 2D segment-segment intersection
            let d1 = (p2.0 - p1.0, p2.1 - p1.1);
            let d2 = (p4.0 - p3.0, p4.1 - p3.1);
            let denom = d1.0 * d2.1 - d1.1 * d2.0;
            if denom.abs() < 1e-9 { continue; }
            let t = ((p3.0 - p1.0) * d2.1 - (p3.1 - p1.1) * d2.0) / denom;
            let s = ((p3.0 - p1.0) * d1.1 - (p3.1 - p1.1) * d1.0) / denom;
            if t >= -1e-9 && t <= 1.0 + 1e-9 && s >= -1e-9 && s <= 1.0 + 1e-9 {
                points.push((p1.0 + d1.0 * t, p1.1 + d1.1 * t));
            }
        }
    }

    if points.len() < 3 { return None; }

    // Centroid + sort CCW
    let cx: f64 = points.iter().map(|p| p.0).sum::<f64>() / points.len() as f64;
    let cy: f64 = points.iter().map(|p| p.1).sum::<f64>() / points.len() as f64;
    points.sort_by(|p, q| {
        let ap = (p.1 - cy).atan2(p.0 - cx);
        let aq = (q.1 - cy).atan2(q.0 - cx);
        ap.partial_cmp(&aq).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Dedup near-duplicates
    let mut dedup: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for p in points {
        if let Some(last) = dedup.last() {
            if (p.0 - last.0).abs() < 1e-6 && (p.1 - last.1).abs() < 1e-6 { continue; }
        }
        dedup.push(p);
    }
    if dedup.len() < 3 { return None; }
    Some(dedup)
}

/// 두 공면 polygon 의 difference (a − b) — convex 가정.
///
/// Sutherland-Hodgman 으로 a ∩ b 계산 후 a 의 corners 에서 그 영역을
/// "subtract" 한다. 결과가 non-convex / multi-piece 일 수 있어 본 구현은
/// **convex a, convex b, 단일 piece 결과** 만 반환 (그 외엔 None).
///
/// 즉 이 MVP 는 b 가 a 의 corner 를 자르는 형태에서만 유효. 더 복잡한
/// 케이스는 Greiner-Hormann 으로 향후 확장.
pub fn convex_difference_2d(a: &[(f64, f64)], b: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    if a.len() < 3 || b.len() < 3 { return None; }
    let inter = sutherland_hodgman(a, b)?;
    // a − b = a 의 boundary 를 따라 가다, b 안으로 들어가는 지점에서
    //   intersection polygon 의 boundary 를 (반대 방향으로) 따라 빠져나옴.
    // MVP: a vertices outside b + boundary intersection points → CCW sort.
    let inside = |pt: (f64, f64), poly: &[(f64, f64)]| -> bool {
        let mut sum = 0.0_f64;
        for i in 0..poly.len() {
            let (ax, ay) = poly[i];
            let (bx, by) = poly[(i + 1) % poly.len()];
            let ux = ax - pt.0; let uy = ay - pt.1;
            let vx = bx - pt.0; let vy = by - pt.1;
            let ulen = (ux*ux + uy*uy).sqrt();
            let vlen = (vx*vx + vy*vy).sqrt();
            if ulen < 1e-9 || vlen < 1e-9 { return false; } // boundary excluded
            let cross = ux*vy - uy*vx;
            let dot = ux*vx + uy*vy;
            let mut ang = (cross / (ulen*vlen)).atan2(dot / (ulen*vlen));
            if ang > std::f64::consts::PI { ang -= 2.0 * std::f64::consts::PI; }
            if ang < -std::f64::consts::PI { ang += 2.0 * std::f64::consts::PI; }
            sum += ang;
        }
        (sum.abs() - std::f64::consts::TAU).abs() < 1e-3
    };

    let mut points: Vec<(f64, f64)> = Vec::new();
    for &p in a { if !inside(p, b) { points.push(p); } }
    // Boundary intersections (same as in convex_union_2d).
    let segments_a: Vec<_> = (0..a.len()).map(|i| (a[i], a[(i+1)%a.len()])).collect();
    let segments_b: Vec<_> = (0..b.len()).map(|i| (b[i], b[(i+1)%b.len()])).collect();
    for &(p1, p2) in &segments_a {
        for &(p3, p4) in &segments_b {
            let d1 = (p2.0 - p1.0, p2.1 - p1.1);
            let d2 = (p4.0 - p3.0, p4.1 - p3.1);
            let denom = d1.0 * d2.1 - d1.1 * d2.0;
            if denom.abs() < 1e-9 { continue; }
            let t = ((p3.0 - p1.0) * d2.1 - (p3.1 - p1.1) * d2.0) / denom;
            let s = ((p3.0 - p1.0) * d1.1 - (p3.1 - p1.1) * d1.0) / denom;
            if t >= -1e-9 && t <= 1.0 + 1e-9 && s >= -1e-9 && s <= 1.0 + 1e-9 {
                points.push((p1.0 + d1.0 * t, p1.1 + d1.1 * t));
            }
        }
    }

    if points.len() < 3 { return None; }

    // CCW sort by centroid (works for convex result piece; non-convex →
    //   incorrect topology, caller's responsibility to detect).
    let cx: f64 = points.iter().map(|p| p.0).sum::<f64>() / points.len() as f64;
    let cy: f64 = points.iter().map(|p| p.1).sum::<f64>() / points.len() as f64;
    points.sort_by(|p, q| {
        let ap = (p.1 - cy).atan2(p.0 - cx);
        let aq = (q.1 - cy).atan2(q.0 - cx);
        ap.partial_cmp(&aq).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut dedup: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for p in points {
        if let Some(last) = dedup.last() {
            if (p.0 - last.0).abs() < 1e-6 && (p.1 - last.1).abs() < 1e-6 { continue; }
        }
        dedup.push(p);
    }
    if dedup.len() < 3 { return None; }
    let _ = inter; // kept for diagnostic / future GH expansion
    Some(dedup)
}

/// outer 폴리곤이 inner 폴리곤을 완전 포함하는가?
///
/// 조건:
///   1. 두 폴리곤이 거의 같은 평면
///   2. inner 의 모든 vertex 가 outer 내부 또는 경계
///   3. inner 의 엄밀 내부점이 outer 엄밀 내부 (모든 vertex 가 경계에만 있는 경우 배제)
///
/// FreeDesignX 의 `is_including_polygon_and_shared_vertex_count_strict` 포팅.
/// edge-edge 교차 검사는 생략 (AXiA 3D 의 용도: dissolve_containing_faces 에서
/// 교차 검사는 다른 경로로 보장됨).
pub fn polygon_contains_polygon(outer: &[DVec3], inner: &[DVec3]) -> bool {
    const EDGE_EPS: f64 = 1e-3;
    const ANG_TOL: f64 = 1e-6;

    if outer.len() < 3 || inner.len() < 3 { return false; }

    let n_outer = match face_unit_normal(outer) {
        Some(n) => n,
        None => return false,
    };

    // 모든 inner vertex 가 outer 내부/경계에 있어야 함
    for &p in inner {
        if !point_in_polygon_winding(p, outer, n_outer, EDGE_EPS, ANG_TOL, true) {
            return false;
        }
    }

    // inner 의 엄밀 내부점이 outer 엄밀 내부여야 함
    let witness = match strict_interior_point_3d(inner) {
        Some(p) => p,
        None => return false,
    };
    point_in_polygon_winding(witness, outer, n_outer, EDGE_EPS, ANG_TOL, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_contains_smaller_square_inside() {
        let outer = vec![
            DVec3::new(-10.0, -10.0, 0.0),
            DVec3::new( 10.0, -10.0, 0.0),
            DVec3::new( 10.0,  10.0, 0.0),
            DVec3::new(-10.0,  10.0, 0.0),
        ];
        let inner = vec![
            DVec3::new(-2.0, -2.0, 0.0),
            DVec3::new( 2.0, -2.0, 0.0),
            DVec3::new( 2.0,  2.0, 0.0),
            DVec3::new(-2.0,  2.0, 0.0),
        ];
        assert!(polygon_contains_polygon(&outer, &inner));
    }

    #[test]
    fn square_does_not_contain_offset_square() {
        let outer = vec![
            DVec3::new(-10.0, -10.0, 0.0),
            DVec3::new( 10.0, -10.0, 0.0),
            DVec3::new( 10.0,  10.0, 0.0),
            DVec3::new(-10.0,  10.0, 0.0),
        ];
        // inner 가 outer 경계를 넘어감
        let inner = vec![
            DVec3::new( 5.0,  5.0, 0.0),
            DVec3::new(15.0,  5.0, 0.0),
            DVec3::new(15.0, 15.0, 0.0),
            DVec3::new( 5.0, 15.0, 0.0),
        ];
        assert!(!polygon_contains_polygon(&outer, &inner));
    }

    /// 가장 중요한 회귀 케이스: L자 wrap 면은 overlap quad 를 "담지 않는다".
    /// 오늘 `437a5ea` fix 가 타겟한 케이스.
    #[test]
    fn l_shape_does_not_contain_overlap_quad() {
        // L-shape: 구멍 난 큰 정사각형의 경로
        //   ┌───┐
        //   │   │
        //   │   └─┐
        //   │     │
        //   └─────┘
        // 구멍 위치에 overlap quad 이 있음. L-shape centroid 는 구멍 내부로
        // 떨어질 수 있으므로 centroid-only 테스트는 오판함.
        let l_shape = vec![
            DVec3::new(-10.0, -10.0, 0.0),
            DVec3::new( 10.0, -10.0, 0.0),
            DVec3::new( 10.0,  0.0, 0.0),
            DVec3::new(  0.0,  0.0, 0.0),
            DVec3::new(  0.0, 10.0, 0.0),
            DVec3::new(-10.0, 10.0, 0.0),
        ];
        // overlap quad: X=0..10, Y=0..10 (L-shape 의 구멍 영역)
        let overlap = vec![
            DVec3::new( 0.0,  0.0, 0.0),
            DVec3::new(10.0,  0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new( 0.0, 10.0, 0.0),
        ];
        // L-shape 은 overlap 을 포함하지 않는다 (공유 정점 2 개로 붙어있을 뿐)
        assert!(!polygon_contains_polygon(&l_shape, &overlap),
            "L-shape wrap must NOT be classified as containing the overlap quad");
    }

    #[test]
    fn sutherland_hodgman_simple_overlap() {
        // subject (0..4)×(0..4) , clip (2..6)×(2..6) → intersection (2..4)×(2..4)
        let subject = vec![(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)];
        let clip = vec![(2.0, 2.0), (6.0, 2.0), (6.0, 6.0), (2.0, 6.0)];
        let out = sutherland_hodgman(&subject, &clip).expect("overlap exists");
        assert_eq!(out.len(), 4, "intersection should be a quad");
        // area = 2 × 2 = 4
        let mut area2 = 0.0;
        for i in 0..out.len() {
            let (x1, y1) = out[i];
            let (x2, y2) = out[(i + 1) % out.len()];
            area2 += x1 * y2 - x2 * y1;
        }
        assert!((area2.abs() * 0.5 - 4.0).abs() < 1e-6);
    }

    #[test]
    fn sutherland_hodgman_disjoint() {
        let subject = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        let clip = vec![(2.0, 2.0), (3.0, 2.0), (3.0, 3.0), (2.0, 3.0)];
        assert!(sutherland_hodgman(&subject, &clip).is_none());
    }

    #[test]
    fn sutherland_hodgman_full_contains() {
        // subject (0..10)×(0..10), clip (2..4)×(2..4) — clip fully inside subject
        // intersection = clip itself
        let subject = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let clip = vec![(2.0, 2.0), (4.0, 2.0), (4.0, 4.0), (2.0, 4.0)];
        let out = sutherland_hodgman(&subject, &clip).expect("overlap");
        // area == 4
        let mut area2 = 0.0;
        for i in 0..out.len() {
            let (x1, y1) = out[i];
            let (x2, y2) = out[(i + 1) % out.len()];
            area2 += x1 * y2 - x2 * y1;
        }
        assert!((area2.abs() * 0.5 - 4.0).abs() < 1e-6);
    }

    #[test]
    fn plane_basis_roundtrip() {
        let poly = vec![
            DVec3::new(1.0, 2.0, 3.0),
            DVec3::new(5.0, 2.0, 3.0),
            DVec3::new(5.0, 6.0, 3.0),
            DVec3::new(1.0, 6.0, 3.0),
        ];
        let basis = PlaneBasis::from_polygon(&poly).unwrap();
        for &p in &poly {
            let (x, y) = basis.project(p);
            let back = basis.lift(x, y);
            assert!((p - back).length() < 1e-9, "roundtrip mismatch {:?} vs {:?}", p, back);
        }
    }

    #[test]
    fn strict_interior_works_for_concave() {
        // L-shape 의 엄밀 내부점은 L-shape 안에 있어야 함 (centroid 는
        // 바깥으로 떨어질 수 있음)
        let l_shape = vec![
            DVec3::new(-10.0, -10.0, 0.0),
            DVec3::new( 10.0, -10.0, 0.0),
            DVec3::new( 10.0,   0.0, 0.0),
            DVec3::new(  0.0,   0.0, 0.0),
            DVec3::new(  0.0,  10.0, 0.0),
            DVec3::new(-10.0,  10.0, 0.0),
        ];
        let p = strict_interior_point_3d(&l_shape).expect("ear exists");
        // p 가 실제로 L-shape 엄밀 내부인지 검증
        let n = face_unit_normal(&l_shape).unwrap();
        assert!(point_in_polygon_winding(p, &l_shape, n, 1e-6, 1e-6, false),
            "strict_interior_point_3d should return a point strictly inside");
    }
}
