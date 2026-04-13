//! Boolean 연산용 기하 프리미티브
//!
//! - Plane: 평면 정의 및 점/선분 교차
//! - Triangle-Triangle 교차
//! - Point-in-Solid 판정 (ray casting)

use glam::DVec3;

/// 무한 평면: normal · p = dist
#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub normal: DVec3,
    pub dist: f64,
}

/// 선분-평면 교차 결과
#[derive(Clone, Copy, Debug)]
pub enum PlaneHit {
    /// 교차점 (t: 0..1 파라미터, point: 교차 좌표)
    Hit { t: f64, point: DVec3 },
    /// 선분이 평면 위에 놓임 (coplanar)
    Coplanar,
    /// 교차 없음 (같은 쪽)
    None,
}

/// 점이 평면 기준으로 어느 쪽인지
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Front,  // normal 방향
    Back,   // 반대
    On,     // 평면 위
}

const EPS: f64 = 1e-7;

impl Plane {
    /// Face의 정점 + 법선으로 평면 생성
    pub fn from_point_normal(point: DVec3, normal: DVec3) -> Self {
        let n = normal.normalize();
        Self { normal: n, dist: n.dot(point) }
    }

    /// 삼각형 3점으로 평면 생성
    pub fn from_triangle(a: DVec3, b: DVec3, c: DVec3) -> Option<Self> {
        let n = (b - a).cross(c - a);
        let len = n.length();
        if len < EPS { return None; }
        let n = n / len;
        Some(Self { normal: n, dist: n.dot(a) })
    }

    /// 부호 거리 (양수 = Front, 음수 = Back)
    #[inline]
    pub fn signed_distance(&self, p: DVec3) -> f64 {
        self.normal.dot(p) - self.dist
    }

    /// 점의 위치 분류
    #[inline]
    pub fn classify(&self, p: DVec3) -> Side {
        let d = self.signed_distance(p);
        if d > EPS { Side::Front }
        else if d < -EPS { Side::Back }
        else { Side::On }
    }

    /// 선분 (a→b)과 평면의 교차
    pub fn intersect_segment(&self, a: DVec3, b: DVec3) -> PlaneHit {
        let da = self.signed_distance(a);
        let db = self.signed_distance(b);

        // 둘 다 평면 위
        if da.abs() < EPS && db.abs() < EPS {
            return PlaneHit::Coplanar;
        }

        let denom = da - db;
        if denom.abs() < EPS {
            // 평행 (같은 쪽)
            return PlaneHit::None;
        }

        let t = da / denom;
        if t < -EPS || t > 1.0 + EPS {
            return PlaneHit::None;
        }

        let t_clamped = t.clamp(0.0, 1.0);
        let point = a + (b - a) * t_clamped;
        PlaneHit::Hit { t: t_clamped, point }
    }
}

/// 삼각형-삼각형 교차선분 계산 (Möller method 간소화)
///
/// 두 삼각형이 교차하면 교차선분의 양 끝점을 반환.
/// 교차하지 않으면 None.
pub fn triangle_triangle_intersection(
    a0: DVec3, a1: DVec3, a2: DVec3,
    b0: DVec3, b1: DVec3, b2: DVec3,
) -> Option<(DVec3, DVec3)> {
    // A의 평면으로 B 분류
    let plane_a = Plane::from_triangle(a0, a1, a2)?;
    let sb0 = plane_a.classify(b0);
    let sb1 = plane_a.classify(b1);
    let sb2 = plane_a.classify(b2);

    // B가 A 평면 한쪽에만 → 교차 없음
    if sb0 == sb1 && sb1 == sb2 && sb0 != Side::On {
        return None;
    }

    // B의 평면으로 A 분류
    let plane_b = Plane::from_triangle(b0, b1, b2)?;
    let sa0 = plane_b.classify(a0);
    let sa1 = plane_b.classify(a1);
    let sa2 = plane_b.classify(a2);

    if sa0 == sa1 && sa1 == sa2 && sa0 != Side::On {
        return None;
    }

    // 교차선 방향
    let dir = plane_a.normal.cross(plane_b.normal);
    if dir.length() < EPS {
        // 평면이 평행 → coplanar or no intersection
        return None;
    }

    // 각 삼각형이 교차선과 만나는 구간을 구한다
    let seg_a = clip_triangle_to_line(a0, a1, a2, &plane_b, dir)?;
    let seg_b = clip_triangle_to_line(b0, b1, b2, &plane_a, dir)?;

    // 두 구간의 겹침 (overlap)
    let (min_a, max_a) = if seg_a.0 <= seg_a.1 { seg_a } else { (seg_a.1, seg_a.0) };
    let (min_b, max_b) = if seg_b.0 <= seg_b.1 { seg_b } else { (seg_b.1, seg_b.0) };

    let start = min_a.max(min_b);
    let end = max_a.min(max_b);

    if start > end + EPS {
        return None;
    }

    // 교차선 위의 기준점 계산
    let origin = line_origin(plane_a, plane_b, dir);
    let d = dir.normalize();

    Some((origin + d * start, origin + d * end))
}

/// 삼각형의 교차선 위 투영 구간 [t_min, t_max]
fn clip_triangle_to_line(
    v0: DVec3, v1: DVec3, v2: DVec3,
    plane: &Plane, dir: DVec3,
) -> Option<(f64, f64)> {
    let d0 = plane.signed_distance(v0);
    let d1 = plane.signed_distance(v1);
    let d2 = plane.signed_distance(v2);
    let d = dir.normalize();

    let mut params: Vec<f64> = Vec::with_capacity(2);

    // 각 에지에서 교차점 수집
    let edges = [(v0, v1, d0, d1), (v1, v2, d1, d2), (v2, v0, d2, d0)];
    for &(va, vb, da, db) in &edges {
        if (da > EPS && db < -EPS) || (da < -EPS && db > EPS) {
            let t = da / (da - db);
            let p = va + (vb - va) * t;
            let param = d.dot(p);
            params.push(param);
        } else if da.abs() <= EPS {
            let param = d.dot(va);
            params.push(param);
        }
    }

    if params.len() < 2 {
        return None;
    }

    Some((params[0], params[1]))
}

/// 두 평면의 교차선 위 기준점
fn line_origin(p1: Plane, p2: Plane, dir: DVec3) -> DVec3 {
    // 두 평면의 교차선 위 점: 최소자승법으로 구함
    let n1 = p1.normal;
    let n2 = p2.normal;
    let d1 = p1.dist;
    let d2 = p2.dist;

    let det = dir.length_squared();
    if det < EPS * EPS {
        return DVec3::ZERO;
    }

    // origin = (d1 * (n2 × dir) + d2 * (dir × n1)) / |dir|²
    let origin = (n2.cross(dir) * d1 + dir.cross(n1) * d2) / det;
    origin
}

/// Ray casting으로 점이 솔리드 내부인지 판정 (3-ray majority vote)
///
/// 단일 ray는 에지/꼭짓점 정확히 관통 시 중복 카운트 문제가 있으므로
/// 3개의 비정렬 방향으로 투표하여 안정성 확보.
///
/// 반환: true = 내부, false = 외부
pub fn point_in_solid(
    triangles: &[(DVec3, DVec3, DVec3)],
    point: DVec3,
) -> bool {
    // 3개의 비축정렬(non-axis-aligned) ray 방향
    let rays = [
        DVec3::new(1.0, 0.0577, 0.0331),
        DVec3::new(0.0247, 1.0, 0.0613),
        DVec3::new(0.0371, 0.0519, 1.0),
    ];

    let mut votes = 0u32;
    for ray_dir in &rays {
        let mut crossings = 0u32;
        for &(v0, v1, v2) in triangles {
            if ray_hits_triangle(point, *ray_dir, v0, v1, v2) {
                crossings += 1;
            }
        }
        if crossings % 2 == 1 {
            votes += 1;
        }
    }

    votes >= 2 // 과반수
}

/// Möller–Trumbore ray-triangle 교차 판정
fn ray_hits_triangle(
    origin: DVec3, dir: DVec3,
    v0: DVec3, v1: DVec3, v2: DVec3,
) -> bool {
    let e1 = v1 - v0;
    let e2 = v2 - v0;
    let h = dir.cross(e2);
    let a = e1.dot(h);

    if a.abs() < EPS {
        return false; // ray 평행
    }

    let f = 1.0 / a;
    let s = origin - v0;
    let u = f * s.dot(h);
    if !(0.0..=1.0).contains(&u) {
        return false;
    }

    let q = s.cross(e1);
    let v = f * dir.dot(q);
    if v < 0.0 || u + v > 1.0 {
        return false;
    }

    let t = f * e2.dot(q);
    t > EPS // ray 양의 방향만
}

// ═══════════════════════════════════════════════════════════════════
// 2D projection & polygon utilities for Face Split
// ═══════════════════════════════════════════════════════════════════

/// 2D point (projected from 3D face)
#[derive(Clone, Copy, Debug)]
pub struct Pt2 {
    pub x: f64,
    pub y: f64,
}

impl Pt2 {
    pub fn new(x: f64, y: f64) -> Self { Self { x, y } }

    /// Squared distance
    pub fn dist2(&self, o: &Pt2) -> f64 {
        (self.x - o.x).powi(2) + (self.y - o.y).powi(2)
    }
}

/// Project a 3D point onto 2D by dropping the dominant axis of the normal.
/// Returns (u, v) local axes and projects using them.
pub fn project_to_2d(points: &[DVec3], normal: DVec3) -> (Vec<Pt2>, DVec3, DVec3, DVec3) {
    let abs_n = DVec3::new(normal.x.abs(), normal.y.abs(), normal.z.abs());

    // Choose the axis most aligned with normal to drop
    let (u_axis, v_axis) = if abs_n.x >= abs_n.y && abs_n.x >= abs_n.z {
        // Drop X → use Y, Z
        let u = DVec3::Y;
        let v = normal.cross(u).normalize();
        let u = v.cross(normal).normalize();
        (u, v)
    } else if abs_n.y >= abs_n.x && abs_n.y >= abs_n.z {
        // Drop Y → use X, Z
        let u = DVec3::X;
        let v = normal.cross(u).normalize();
        let u = v.cross(normal).normalize();
        (u, v)
    } else {
        // Drop Z → use X, Y
        let u = DVec3::X;
        let v = normal.cross(u).normalize();
        let u = v.cross(normal).normalize();
        (u, v)
    };

    let origin = if points.is_empty() { DVec3::ZERO } else { points[0] };
    let pts: Vec<Pt2> = points.iter().map(|p| {
        let d = *p - origin;
        Pt2::new(u_axis.dot(d), v_axis.dot(d))
    }).collect();

    (pts, u_axis, v_axis, origin)
}

/// Un-project a 2D point back to 3D using the stored axes and origin.
pub fn unproject_to_3d(pt: Pt2, u_axis: DVec3, v_axis: DVec3, origin: DVec3) -> DVec3 {
    origin + u_axis * pt.x + v_axis * pt.y
}

/// Intersect segment (a→b) with segment (c→d) in 2D.
/// Returns parameter t along (a→b) if intersection exists within both segments.
pub fn segment_segment_2d(a: Pt2, b: Pt2, c: Pt2, d: Pt2) -> Option<(f64, f64, Pt2)> {
    let dx1 = b.x - a.x;
    let dy1 = b.y - a.y;
    let dx2 = d.x - c.x;
    let dy2 = d.y - c.y;

    let denom = dx1 * dy2 - dy1 * dx2;
    if denom.abs() < 1e-12 {
        return None; // parallel
    }

    let t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
    let u = ((c.x - a.x) * dy1 - (c.y - a.y) * dx1) / denom;

    if t >= -EPS && t <= 1.0 + EPS && u >= -EPS && u <= 1.0 + EPS {
        let pt = Pt2::new(a.x + dx1 * t, a.y + dy1 * t);
        Some((t, u, pt))
    } else {
        None
    }
}

/// Check if a 2D point is inside a 2D polygon (simple ray casting).
pub fn point_in_polygon_2d(pt: &Pt2, poly: &[Pt2]) -> bool {
    let n = poly.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let pi = &poly[i];
        let pj = &poly[j];
        if ((pi.y > pt.y) != (pj.y > pt.y))
            && (pt.x < (pj.x - pi.x) * (pt.y - pi.y) / (pj.y - pi.y) + pi.x)
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Compute signed area of a 2D polygon (positive = CCW).
pub fn polygon_signed_area_2d(poly: &[Pt2]) -> f64 {
    let n = poly.len();
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += poly[i].x * poly[j].y;
        area -= poly[j].x * poly[i].y;
    }
    area * 0.5
}

/// Compute centroid of a 2D polygon.
pub fn polygon_centroid_2d(poly: &[Pt2]) -> Pt2 {
    let n = poly.len();
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in poly {
        cx += p.x;
        cy += p.y;
    }
    Pt2::new(cx / n as f64, cy / n as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plane_classify() {
        let p = Plane::from_point_normal(DVec3::ZERO, DVec3::Y);
        assert_eq!(p.classify(DVec3::new(0.0, 1.0, 0.0)), Side::Front);
        assert_eq!(p.classify(DVec3::new(0.0, -1.0, 0.0)), Side::Back);
        assert_eq!(p.classify(DVec3::new(5.0, 0.0, 3.0)), Side::On);
    }

    #[test]
    fn plane_segment_hit() {
        let p = Plane::from_point_normal(DVec3::ZERO, DVec3::Y);
        let a = DVec3::new(0.0, -1.0, 0.0);
        let b = DVec3::new(0.0, 1.0, 0.0);
        match p.intersect_segment(a, b) {
            PlaneHit::Hit { t, point } => {
                assert!((t - 0.5).abs() < 1e-6);
                assert!(point.length() < 1e-6);
            }
            _ => panic!("expected hit"),
        }
    }

    #[test]
    fn ray_triangle_hit() {
        let origin = DVec3::new(0.25, 0.25, -1.0);
        let dir = DVec3::new(0.0, 0.0, 1.0);
        let v0 = DVec3::ZERO;
        let v1 = DVec3::new(1.0, 0.0, 0.0);
        let v2 = DVec3::new(0.0, 1.0, 0.0);
        assert!(ray_hits_triangle(origin, dir, v0, v1, v2));
    }

    #[test]
    fn ray_triangle_miss() {
        let origin = DVec3::new(2.0, 2.0, -1.0);
        let dir = DVec3::new(0.0, 0.0, 1.0);
        let v0 = DVec3::ZERO;
        let v1 = DVec3::new(1.0, 0.0, 0.0);
        let v2 = DVec3::new(0.0, 1.0, 0.0);
        assert!(!ray_hits_triangle(origin, dir, v0, v1, v2));
    }

    #[test]
    fn tri_tri_intersection_basic() {
        // XY 평면 삼각형 vs XZ 평면 삼각형
        let a0 = DVec3::new(-1.0, 0.0, 0.0);
        let a1 = DVec3::new(1.0, 0.0, 0.0);
        let a2 = DVec3::new(0.0, 1.0, 0.0);

        let b0 = DVec3::new(-1.0, 0.5, -1.0);
        let b1 = DVec3::new(1.0, 0.5, -1.0);
        let b2 = DVec3::new(0.0, 0.5, 1.0);

        let result = triangle_triangle_intersection(a0, a1, a2, b0, b1, b2);
        assert!(result.is_some(), "should intersect");
    }

    #[test]
    fn tri_tri_no_intersection() {
        // 떨어진 두 삼각형
        let a0 = DVec3::new(0.0, 0.0, 0.0);
        let a1 = DVec3::new(1.0, 0.0, 0.0);
        let a2 = DVec3::new(0.0, 1.0, 0.0);

        let b0 = DVec3::new(0.0, 0.0, 5.0);
        let b1 = DVec3::new(1.0, 0.0, 5.0);
        let b2 = DVec3::new(0.0, 1.0, 5.0);

        let result = triangle_triangle_intersection(a0, a1, a2, b0, b1, b2);
        assert!(result.is_none(), "should not intersect");
    }

    #[test]
    fn point_in_solid_cube() {
        // 단위 큐브 (6면 = 12 삼각형)
        let tris = unit_cube_triangles();
        assert!(point_in_solid(&tris, DVec3::new(0.5, 0.5, 0.5)), "center inside");
        assert!(!point_in_solid(&tris, DVec3::new(2.0, 0.5, 0.5)), "outside +X");
        assert!(!point_in_solid(&tris, DVec3::new(0.5, -1.0, 0.5)), "outside -Y");
    }

    fn unit_cube_triangles() -> Vec<(DVec3, DVec3, DVec3)> {
        let v = [
            DVec3::new(0.0, 0.0, 0.0), // 0
            DVec3::new(1.0, 0.0, 0.0), // 1
            DVec3::new(1.0, 1.0, 0.0), // 2
            DVec3::new(0.0, 1.0, 0.0), // 3
            DVec3::new(0.0, 0.0, 1.0), // 4
            DVec3::new(1.0, 0.0, 1.0), // 5
            DVec3::new(1.0, 1.0, 1.0), // 6
            DVec3::new(0.0, 1.0, 1.0), // 7
        ];
        // 6 faces × 2 triangles (CCW outward normals)
        vec![
            // -Z face (0,3,2), (0,2,1)
            (v[0], v[3], v[2]), (v[0], v[2], v[1]),
            // +Z face (4,5,6), (4,6,7)
            (v[4], v[5], v[6]), (v[4], v[6], v[7]),
            // -Y face (0,1,5), (0,5,4)
            (v[0], v[1], v[5]), (v[0], v[5], v[4]),
            // +Y face (3,7,6), (3,6,2)
            (v[3], v[7], v[6]), (v[3], v[6], v[2]),
            // -X face (0,4,7), (0,7,3)
            (v[0], v[4], v[7]), (v[0], v[7], v[3]),
            // +X face (1,2,6), (1,6,5)
            (v[1], v[2], v[6]), (v[1], v[6], v[5]),
        ]
    }
}
