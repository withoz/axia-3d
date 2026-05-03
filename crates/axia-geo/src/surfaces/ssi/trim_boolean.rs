//! ADR-055 Phase J Step 2 — 2D Trim Loop Boolean (Greiner-Hormann curve-aware).
//!
//! ## Skeleton scope (this commit)
//!
//! Per ADR-055 Amendment 1 §7.3, this commit lands the **intersection
//! registry** + **curve-pair intersection dispatcher** only. The actual
//! Boolean traversal (intersect/union/subtract on TrimLoop pairs) lands
//! in the next commit, gated on the 3 intersection-kind regressions
//! passing here.
//!
//! ## Intersection Registry contract (§7.1.1)
//!
//! ```rust
//! Intersection2D {
//!   point,    // crossing/tangent: the single point
//!             // coincident:       segment START (use t1_a/t1_b for END)
//!   t_a,      // crossing/tangent: parameter on a
//!             // coincident:       overlap start parameter on a
//!   t_b,      // ditto on b
//!   kind,     // Crossing / Tangent / Coincident{t1_a,t1_b,same_dir}
//! }
//! ```
//!
//! ## Coincident分절 매트릭스 (§7.1.1, locked):
//!
//! | op       | same_direction = true  | same_direction = false |
//! |----------|------------------------|------------------------|
//! | Union    | 한쪽만 유지              | 둘 다 폐기 (구멍 생성) |
//! | Subtract | 폐기 (boundary cancel) | 한쪽 유지 (orient flip)|
//! | Intersect| 한쪽만 유지              | 폐기                    |
//!
//! Implementation lands in Step 2 Boolean Traversal commit.
//!
//! ## Processing order (§7.1.3, locked):
//!
//! Coincident → Tangent → Crossing — Crossing is the fall-through
//! "general case" path with the simplest code.

use super::super::trim::TrimCurve2D;

// ────────────────────────────────────────────────────────────────────
// Intersection Registry (ADR-055 Amendment 1 §7.1.1 — locked contract)
// ────────────────────────────────────────────────────────────────────

/// One intersection event between two `TrimCurve2D` segments.
///
/// For `Crossing` and `Tangent`: `point` / `t_a` / `t_b` describe a
/// single intersection point.
///
/// For `Coincident`: the two curves overlap on a parameter range
/// `[t_a, kind.t1_a]` on curve A and `[t_b, kind.t1_b]` on curve B.
/// `point` is the *start* of the overlap on A (use evaluation for end).
#[derive(Clone, Debug, PartialEq)]
pub struct Intersection2D {
    pub point: [f64; 2],
    pub t_a: f64,
    pub t_b: f64,
    pub kind: IntersectionKind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum IntersectionKind {
    /// Two curves cross transversally. Standard Greiner-Hormann case.
    Crossing,
    /// Two curves touch at a single point but do not cross
    /// (e.g., parallel lines meeting at endpoints, or true tangent
    /// contact between an arc and a line).
    Tangent,
    /// Two curves coincide over a parameter range. Required for the
    /// 6-cell op × direction matrix (§7.1.1).
    Coincident {
        /// End of overlap on curve A (t_a < t1_a).
        t1_a: f64,
        /// End of overlap on curve B. May be < t_b if `same_direction == false`.
        t1_b: f64,
        /// Whether the two curves traverse the overlap region in the
        /// same parametric direction.
        same_direction: bool,
    },
}

// ────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────

/// Compute all intersections between two trim curves. Curves are
/// classified by variant and dispatched to the appropriate analytic
/// or sampling routine.
///
/// `tol` is geometric distance tolerance (in parameter-space units).
pub fn intersect_trim_curves(
    a: &TrimCurve2D,
    b: &TrimCurve2D,
    tol: f64,
) -> Vec<Intersection2D> {
    use TrimCurve2D::*;
    match (a, b) {
        (Line { a: a0, b: a1 }, Line { a: b0, b: b1 }) =>
            line_line(*a0, *a1, *b0, *b1, tol),

        (Line { a: la, b: lb }, Arc { center, radius, start_angle, end_angle }) =>
            line_arc(*la, *lb, *center, *radius, *start_angle, *end_angle, tol, false),
        (Arc { center, radius, start_angle, end_angle }, Line { a: la, b: lb }) =>
            line_arc(*la, *lb, *center, *radius, *start_angle, *end_angle, tol, true),

        (Arc { center: ca, radius: ra, start_angle: sa, end_angle: ea },
         Arc { center: cb, radius: rb, start_angle: sb, end_angle: eb }) =>
            arc_arc(*ca, *ra, *sa, *ea, *cb, *rb, *sb, *eb, tol),

        // Bezier / BSpline / mixed: sampling fallback (Step 4 will refine)
        _ => sampling_fallback(a, b, tol),
    }
}

// ────────────────────────────────────────────────────────────────────
// Line ∩ Line
// ────────────────────────────────────────────────────────────────────

/// Solve  P1 + t·(P2-P1) = P3 + s·(P4-P3)  for (t, s) ∈ [0, 1]².
///
/// Classification (per §7.1.3 Coincident → Tangent → Crossing):
///   * If lines collinear AND segments overlap → **Coincident**
///   * If lines parallel but disjoint            → no intersection
///   * If lines intersect at a single point with t/s ∈ [-tol, 1+tol]:
///     - Both interior (away from endpoints) → Crossing
///     - One/both at endpoints + zero crossing → Tangent
///     - Otherwise (true crossing)            → Crossing
fn line_line(
    p1: [f64; 2], p2: [f64; 2],
    p3: [f64; 2], p4: [f64; 2],
    tol: f64,
) -> Vec<Intersection2D> {
    let d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    let d2 = [p4[0] - p3[0], p4[1] - p3[1]];

    // Cross product (z-component) of direction vectors
    let cross = d1[0] * d2[1] - d1[1] * d2[0];

    if cross.abs() < tol * tol {
        // Parallel — check collinearity
        let r = [p3[0] - p1[0], p3[1] - p1[1]];
        let r_cross_d1 = r[0] * d1[1] - r[1] * d1[0];
        if r_cross_d1.abs() > tol {
            return Vec::new(); // parallel disjoint
        }
        // Collinear — find overlap on parameter line
        let len_sq = d1[0] * d1[0] + d1[1] * d1[1];
        if len_sq < tol * tol {
            return Vec::new(); // degenerate first segment
        }
        // Project p3 and p4 onto p1->p2 parameter
        let t3 = (r[0] * d1[0] + r[1] * d1[1]) / len_sq;
        let t4_vec = [p4[0] - p1[0], p4[1] - p1[1]];
        let t4 = (t4_vec[0] * d1[0] + t4_vec[1] * d1[1]) / len_sq;
        let (t_lo_other, t_hi_other) = if t3 <= t4 { (t3, t4) } else { (t4, t3) };
        let same_direction = t3 < t4;

        // Overlap with [0, 1] on a
        let t_overlap_lo = t_lo_other.max(0.0);
        let t_overlap_hi = t_hi_other.min(1.0);
        if t_overlap_hi < t_overlap_lo - tol {
            return Vec::new(); // no overlap
        }
        if (t_overlap_hi - t_overlap_lo).abs() < tol {
            // Single point touch — Tangent (parallel-collinear-meeting)
            let p = [p1[0] + d1[0] * t_overlap_lo, p1[1] + d1[1] * t_overlap_lo];
            // Map t on b
            let len_b_sq = d2[0] * d2[0] + d2[1] * d2[1];
            let r_b = [p[0] - p3[0], p[1] - p3[1]];
            let s = if len_b_sq > tol * tol {
                (r_b[0] * d2[0] + r_b[1] * d2[1]) / len_b_sq
            } else { 0.0 };
            return vec![Intersection2D {
                point: p, t_a: t_overlap_lo, t_b: s,
                kind: IntersectionKind::Tangent,
            }];
        }

        // True overlap — Coincident
        let p_start = [p1[0] + d1[0] * t_overlap_lo, p1[1] + d1[1] * t_overlap_lo];
        let p_end   = [p1[0] + d1[0] * t_overlap_hi, p1[1] + d1[1] * t_overlap_hi];
        let len_b_sq = d2[0] * d2[0] + d2[1] * d2[1];
        let map_to_b = |p: [f64; 2]| -> f64 {
            if len_b_sq < tol * tol { return 0.0; }
            let r_b = [p[0] - p3[0], p[1] - p3[1]];
            (r_b[0] * d2[0] + r_b[1] * d2[1]) / len_b_sq
        };
        let s_start = map_to_b(p_start);
        let s_end   = map_to_b(p_end);
        return vec![Intersection2D {
            point: p_start,
            t_a: t_overlap_lo,
            t_b: s_start,
            kind: IntersectionKind::Coincident {
                t1_a: t_overlap_hi,
                t1_b: s_end,
                same_direction,
            },
        }];
    }

    // Standard 2x2 system
    let r = [p3[0] - p1[0], p3[1] - p1[1]];
    let t = (r[0] * d2[1] - r[1] * d2[0]) / cross;
    let s = (r[0] * d1[1] - r[1] * d1[0]) / cross;

    // Range check (allow tol slack so endpoint touches register as Tangent)
    if t < -tol || t > 1.0 + tol || s < -tol || s > 1.0 + tol {
        return Vec::new();
    }

    let point = [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
    // Endpoint-touch detection — Tangent if either curve is at extremum
    let endpoint_a = t.abs() < tol || (t - 1.0).abs() < tol;
    let endpoint_b = s.abs() < tol || (s - 1.0).abs() < tol;
    let kind = if endpoint_a && endpoint_b {
        IntersectionKind::Tangent
    } else {
        IntersectionKind::Crossing
    };

    vec![Intersection2D { point, t_a: t.clamp(0.0, 1.0), t_b: s.clamp(0.0, 1.0), kind }]
}

// ────────────────────────────────────────────────────────────────────
// Line ∩ Arc — substitute parametric line into circle, solve quadratic
// ────────────────────────────────────────────────────────────────────

fn line_arc(
    la: [f64; 2], lb: [f64; 2],
    center: [f64; 2], radius: f64,
    start_angle: f64, end_angle: f64,
    tol: f64,
    swap: bool,
) -> Vec<Intersection2D> {
    // Line: P(t) = la + t*(lb - la), t ∈ [0, 1]
    // Circle: |P - C|² = r²
    let dx = lb[0] - la[0];
    let dy = lb[1] - la[1];
    let fx = la[0] - center[0];
    let fy = la[1] - center[1];

    let aa = dx * dx + dy * dy;
    let bb = 2.0 * (fx * dx + fy * dy);
    let cc = fx * fx + fy * fy - radius * radius;
    let disc = bb * bb - 4.0 * aa * cc;

    if aa < tol * tol {
        return Vec::new(); // degenerate line
    }

    let mut out = Vec::new();
    if disc < -tol * tol {
        // No real intersection
        return out;
    } else if disc.abs() <= tol * tol {
        // One real root → Tangent
        let t = -bb / (2.0 * aa);
        if t >= -tol && t <= 1.0 + tol {
            let p = [la[0] + dx * t, la[1] + dy * t];
            let angle = (p[1] - center[1]).atan2(p[0] - center[0]);
            if angle_in_arc_range(angle, start_angle, end_angle, tol) {
                let t_b = arc_param_for_angle(angle, start_angle, end_angle);
                out.push(make_intersection(p, t.clamp(0.0, 1.0), t_b,
                    IntersectionKind::Tangent, swap));
            }
        }
        return out;
    }

    // Two real roots → potentially two Crossings
    let sqrt_disc = disc.sqrt();
    for &sign in &[-1.0_f64, 1.0_f64] {
        let t = (-bb + sign * sqrt_disc) / (2.0 * aa);
        if t < -tol || t > 1.0 + tol { continue; }
        let p = [la[0] + dx * t, la[1] + dy * t];
        let angle = (p[1] - center[1]).atan2(p[0] - center[0]);
        if !angle_in_arc_range(angle, start_angle, end_angle, tol) { continue; }
        let t_b = arc_param_for_angle(angle, start_angle, end_angle);
        let endpoint_a = t.abs() < tol || (t - 1.0).abs() < tol;
        let endpoint_b = t_b.abs() < tol || (t_b - 1.0).abs() < tol;
        let kind = if endpoint_a && endpoint_b {
            IntersectionKind::Tangent
        } else {
            IntersectionKind::Crossing
        };
        out.push(make_intersection(p, t.clamp(0.0, 1.0), t_b, kind, swap));
    }
    out
}

// ────────────────────────────────────────────────────────────────────
// Arc ∩ Arc — classic two-circle intersection + range check
// ────────────────────────────────────────────────────────────────────

fn arc_arc(
    ca: [f64; 2], ra: f64, sa: f64, ea: f64,
    cb: [f64; 2], rb: f64, sb: f64, eb: f64,
    tol: f64,
) -> Vec<Intersection2D> {
    let dx = cb[0] - ca[0];
    let dy = cb[1] - ca[1];
    let d_sq = dx * dx + dy * dy;
    let d = d_sq.sqrt();

    // Coincident circles (concentric + same radius) — overlap on full arc range
    if d < tol && (ra - rb).abs() < tol {
        // Find angular overlap of [sa, ea] with [sb, eb]
        let lo = sa.max(sb);
        let hi = ea.min(eb);
        if hi <= lo + tol { return Vec::new(); }
        let mid_angle = (lo + hi) * 0.5;
        let p = [ca[0] + ra * mid_angle.cos(), ca[1] + ra * mid_angle.sin()];
        // Map angles back to per-arc parameters
        let t_a_start = arc_param_for_angle(lo, sa, ea);
        let t_a_end   = arc_param_for_angle(hi, sa, ea);
        let t_b_start = arc_param_for_angle(lo, sb, eb);
        let t_b_end   = arc_param_for_angle(hi, sb, eb);
        let same_direction = (ea - sa).signum() == (eb - sb).signum();
        return vec![Intersection2D {
            point: [ca[0] + ra * lo.cos(), ca[1] + ra * lo.sin()],
            t_a: t_a_start, t_b: t_b_start,
            kind: IntersectionKind::Coincident {
                t1_a: t_a_end, t1_b: t_b_end, same_direction,
            },
        }];
    }

    // Disjoint or one inside other
    if d > ra + rb + tol || d < (ra - rb).abs() - tol {
        return Vec::new();
    }

    // Tangent (single touch)
    if (d - (ra + rb)).abs() < tol || (d - (ra - rb).abs()).abs() < tol {
        let mid = [ca[0] + dx * (ra / d), ca[1] + dy * (ra / d)];
        let angle_a = (mid[1] - ca[1]).atan2(mid[0] - ca[0]);
        let angle_b = (mid[1] - cb[1]).atan2(mid[0] - cb[0]);
        let in_a = angle_in_arc_range(angle_a, sa, ea, tol);
        let in_b = angle_in_arc_range(angle_b, sb, eb, tol);
        if !in_a || !in_b { return Vec::new(); }
        let t_a = arc_param_for_angle(angle_a, sa, ea);
        let t_b = arc_param_for_angle(angle_b, sb, eb);
        return vec![Intersection2D {
            point: mid, t_a, t_b,
            kind: IntersectionKind::Tangent,
        }];
    }

    // Two intersection points
    let a_proj = (d_sq + ra * ra - rb * rb) / (2.0 * d);
    let h_sq = (ra * ra - a_proj * a_proj).max(0.0);
    let h = h_sq.sqrt();
    let mid_x = ca[0] + a_proj * dx / d;
    let mid_y = ca[1] + a_proj * dy / d;
    let perp_x = -dy / d * h;
    let perp_y = dx / d * h;

    let mut out = Vec::new();
    for &sign in &[-1.0_f64, 1.0_f64] {
        let p = [mid_x + sign * perp_x, mid_y + sign * perp_y];
        let angle_a = (p[1] - ca[1]).atan2(p[0] - ca[0]);
        let angle_b = (p[1] - cb[1]).atan2(p[0] - cb[0]);
        if !angle_in_arc_range(angle_a, sa, ea, tol) { continue; }
        if !angle_in_arc_range(angle_b, sb, eb, tol) { continue; }
        let t_a = arc_param_for_angle(angle_a, sa, ea);
        let t_b = arc_param_for_angle(angle_b, sb, eb);
        out.push(Intersection2D {
            point: p, t_a, t_b, kind: IntersectionKind::Crossing,
        });
    }
    out
}

// ────────────────────────────────────────────────────────────────────
// Bezier / BSpline / mixed — sampling fallback
// ────────────────────────────────────────────────────────────────────

/// Rough segment-segment intersection on tessellated polylines.
/// Step 4 (SSI Robustness) and Phase L (Advanced) will replace with
/// proper Bezier subdivision / Newton iteration. For now, sampling +
/// line_line per polyline-segment pair is sufficient for boundary
/// detection on typical trim Bezier loops.
fn sampling_fallback(a: &TrimCurve2D, b: &TrimCurve2D, tol: f64) -> Vec<Intersection2D> {
    const SAMPLES: usize = 32;
    let pts_a = a.tessellate(SAMPLES);
    let pts_b = b.tessellate(SAMPLES);
    let mut out = Vec::new();
    for ia in 0..pts_a.len() - 1 {
        for ib in 0..pts_b.len() - 1 {
            let ix = line_line(pts_a[ia], pts_a[ia + 1],
                               pts_b[ib], pts_b[ib + 1], tol);
            for mut hit in ix {
                // Map polyline-segment parameter back to global curve param
                hit.t_a = (ia as f64 + hit.t_a) / (pts_a.len() - 1) as f64;
                hit.t_b = (ib as f64 + hit.t_b) / (pts_b.len() - 1) as f64;
                out.push(hit);
            }
        }
    }
    out
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/// True if `angle` (atan2 result, in [-π, π]) lies within [s, e] arc range.
/// Handles wrap-around cases (e > 2π, e < s, etc.).
fn angle_in_arc_range(angle: f64, s: f64, e: f64, tol: f64) -> bool {
    let two_pi = std::f64::consts::TAU;
    let lo = s.min(e);
    let hi = s.max(e);
    // Normalize angle into the same lap as lo
    let mut a = angle;
    while a < lo - tol { a += two_pi; }
    while a > hi + tol { a -= two_pi; }
    a >= lo - tol && a <= hi + tol
}

/// Map an angle into the arc's parameter range [0, 1].
fn arc_param_for_angle(angle: f64, s: f64, e: f64) -> f64 {
    let span = e - s;
    if span.abs() < 1e-12 { return 0.0; }
    let two_pi = std::f64::consts::TAU;
    let mut diff = angle - s;
    while diff < 0.0 - 1e-9 { diff += two_pi; }
    while diff > span + 1e-9 { diff -= two_pi; }
    (diff / span).clamp(0.0, 1.0)
}

fn make_intersection(point: [f64; 2], t_line: f64, t_arc: f64,
                     kind: IntersectionKind, swap: bool) -> Intersection2D {
    if swap {
        Intersection2D { point, t_a: t_arc, t_b: t_line, kind }
    } else {
        Intersection2D { point, t_a: t_line, t_b: t_arc, kind }
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests — Step 2 Skeleton (3 회귀, ADR-055 Amendment 1 §7.3 #1)
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-055 §7.3 #1 — Crossing case (two lines crossing at right angle).
    #[test]
    fn crossing_two_lines_x_pattern() {
        let a = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 10.0] };
        let b = TrimCurve2D::Line { a: [0.0, 10.0], b: [10.0, 0.0] };
        let hits = intersect_trim_curves(&a, &b, 1e-9);
        assert_eq!(hits.len(), 1, "X pattern should have one crossing");
        let ix = &hits[0];
        assert_eq!(ix.kind, IntersectionKind::Crossing);
        assert!((ix.point[0] - 5.0).abs() < 1e-9);
        assert!((ix.point[1] - 5.0).abs() < 1e-9);
        assert!((ix.t_a - 0.5).abs() < 1e-9);
        assert!((ix.t_b - 0.5).abs() < 1e-9);
    }

    /// ADR-055 §7.3 #1 — Tangent case (line tangent to arc circle).
    #[test]
    fn tangent_line_touching_arc() {
        // Arc: full circle radius 5 at origin
        let arc = TrimCurve2D::Arc {
            center: [0.0, 0.0], radius: 5.0,
            start_angle: 0.0, end_angle: std::f64::consts::TAU,
        };
        // Horizontal line y=5 tangent to top of circle
        let line = TrimCurve2D::Line { a: [-10.0, 5.0], b: [10.0, 5.0] };
        let hits = intersect_trim_curves(&line, &arc, 1e-6);
        assert_eq!(hits.len(), 1, "tangent line should touch at one point");
        assert_eq!(hits[0].kind, IntersectionKind::Tangent);
        // Tangent point at (0, 5)
        assert!((hits[0].point[0]).abs() < 1e-6);
        assert!((hits[0].point[1] - 5.0).abs() < 1e-6);
    }

    /// ADR-055 §7.3 #1 — Coincident case (overlapping collinear lines).
    /// Validates that overlap interval is preserved (not collapsed to point).
    #[test]
    fn coincident_overlapping_collinear_lines() {
        // Line a: from (0, 0) to (10, 0)
        let a = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 0.0] };
        // Line b: from (4, 0) to (14, 0) — overlaps with a on [4, 10]
        let b = TrimCurve2D::Line { a: [4.0, 0.0], b: [14.0, 0.0] };
        let hits = intersect_trim_curves(&a, &b, 1e-9);
        assert_eq!(hits.len(), 1, "should produce one Coincident interval");
        let ix = &hits[0];
        match &ix.kind {
            IntersectionKind::Coincident { t1_a, t1_b, same_direction } => {
                assert!(*same_direction, "both lines run in +x direction");
                // t_a starts at 4/10 = 0.4, t1_a ends at 10/10 = 1.0
                assert!((ix.t_a - 0.4).abs() < 1e-9, "t_a should be 0.4, got {}", ix.t_a);
                assert!((*t1_a - 1.0).abs() < 1e-9, "t1_a should be 1.0, got {}", t1_a);
                // t_b starts at 0/10 = 0 (point (4,0) is at start of b)
                // t1_b ends at 6/10 = 0.6 (point (10, 0) is 6 along b)
                assert!((ix.t_b).abs() < 1e-9, "t_b should be 0, got {}", ix.t_b);
                assert!((*t1_b - 0.6).abs() < 1e-9, "t1_b should be 0.6, got {}", t1_b);
            }
            other => panic!("expected Coincident, got {:?}", other),
        }
    }

    /// Bonus regression: opposite-direction Coincident detection.
    #[test]
    fn coincident_opposite_direction_flag() {
        let a = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 0.0] };
        // b runs from (10, 0) to (0, 0) — opposite direction, full overlap
        let b = TrimCurve2D::Line { a: [10.0, 0.0], b: [0.0, 0.0] };
        let hits = intersect_trim_curves(&a, &b, 1e-9);
        assert_eq!(hits.len(), 1);
        match &hits[0].kind {
            IntersectionKind::Coincident { same_direction, .. } => {
                assert!(!same_direction, "reversed b should set same_direction = false");
            }
            other => panic!("expected Coincident, got {:?}", other),
        }
    }

    /// Bonus: parallel disjoint lines produce no intersection.
    #[test]
    fn parallel_disjoint_no_intersection() {
        let a = TrimCurve2D::Line { a: [0.0, 0.0], b: [10.0, 0.0] };
        let b = TrimCurve2D::Line { a: [0.0, 5.0], b: [10.0, 5.0] };
        let hits = intersect_trim_curves(&a, &b, 1e-9);
        assert!(hits.is_empty());
    }

    /// Bonus: arc ∩ arc — two circles intersecting at two points.
    #[test]
    fn arc_arc_two_crossing_points() {
        // Two unit circles, centers 1 unit apart on x-axis
        let a = TrimCurve2D::Arc {
            center: [0.0, 0.0], radius: 1.0,
            start_angle: 0.0, end_angle: std::f64::consts::TAU,
        };
        let b = TrimCurve2D::Arc {
            center: [1.0, 0.0], radius: 1.0,
            start_angle: 0.0, end_angle: std::f64::consts::TAU,
        };
        let hits = intersect_trim_curves(&a, &b, 1e-9);
        assert_eq!(hits.len(), 2, "two unit circles 1-apart cross at 2 points");
        for h in &hits {
            assert_eq!(h.kind, IntersectionKind::Crossing);
            // Both crossings at x = 0.5, y = ±√(0.75)
            assert!((h.point[0] - 0.5).abs() < 1e-9);
            assert!((h.point[1].abs() - 0.75_f64.sqrt()).abs() < 1e-9);
        }
    }

    /// Bonus: line ∩ arc — secant produces 2 Crossings.
    #[test]
    fn line_arc_secant_two_crossings() {
        // Horizontal line y=2 cuts unit circle at (±√(21)/5·... wait no)
        // Circle radius 5 at origin; line y=3 secant
        let arc = TrimCurve2D::Arc {
            center: [0.0, 0.0], radius: 5.0,
            start_angle: 0.0, end_angle: std::f64::consts::TAU,
        };
        let line = TrimCurve2D::Line { a: [-10.0, 3.0], b: [10.0, 3.0] };
        let hits = intersect_trim_curves(&line, &arc, 1e-6);
        assert_eq!(hits.len(), 2, "secant should cross circle at 2 points");
        for h in &hits {
            assert!((h.point[0].abs() - 4.0).abs() < 1e-6,
                "x should be ±4 (3² + 4² = 5²), got {}", h.point[0]);
            assert!((h.point[1] - 3.0).abs() < 1e-6);
        }
    }
}
