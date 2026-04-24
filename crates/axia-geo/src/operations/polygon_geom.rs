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
