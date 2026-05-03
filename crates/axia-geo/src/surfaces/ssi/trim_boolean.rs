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
// Step 2 Boolean Traversal — TrimLoop pair operations
// ────────────────────────────────────────────────────────────────────
//
// MVP scope (this commit): polygon (Line-only loops) Boolean via
// classical Greiner-Hormann on tessellated polylines + curve-aware
// intersection registry from above. Bezier/Arc loops use sampling
// fallback at the trim_geom::tessellate_loop level.
//
// Per §7.1.2 (Entry/Exit = offset-point inside test) — implemented
// directly via point_in_trim_loop on tessellated form.
//
// Per §7.1.1 Coincident matrix:
//   | op       | same_dir = true  | same_dir = false |
//   | Union    | keep one         | discard both     |
//   | Subtract | discard          | keep one (flip)  |
//   | Intersect| keep one         | discard          |
//
// MVP path: collinear coincident segments are detected at the polyline
// level and merged before the GH walk. This preserves the spec contract
// without requiring full curve-level Coincident handling (deferred to
// Step 4 Robustness).

use super::super::trim::TrimLoop;
use super::trim_geom::{point_in_trim_loop, tessellate_loop, trim_loop_signed_area};

/// Boolean operation on two trim loops in the same UV space.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrimBoolOp { Union, Intersect, Subtract }

/// Compute `op(a, b)` on the polyline approximation of two trim loops.
/// Returns one or more output loops (Subtract may produce N pieces if
/// b cuts a in multiple disconnected regions).
///
/// MVP scope (per ADR-055 Amendment §7.1.1 #3):
///   - Disjoint pairs handled by inclusion test (no intersection).
///   - Crossing intersections fully handled by GH walk.
///   - **Coincident segments**: detected at intersection-collection
///     stage; if any are present the function returns Err via a
///     conservative empty result + diagnostic. The Coincident matrix
///     handling lands in Step 4 (Robustness) per the user-locked plan.
///   - Tangent intersections: treated as Crossing fall-through (one
///     pass through at the touch point).
///
/// `is_outer` of result loops: derived from signed area of the result
/// polyline (CCW → outer, CW → hole), per critical-fix #5.
pub fn trim_loop_boolean(
    a: &TrimLoop, b: &TrimLoop, op: TrimBoolOp, tol: f64,
) -> Vec<TrimLoop> {
    let pa = ensure_ccw_polyline(a, tol);
    let pb = ensure_ccw_polyline(b, tol);
    if pa.len() < 3 || pb.len() < 3 { return Vec::new(); }

    // Disjoint path: use inclusion test on a representative vertex.
    let probe_a_in_b = point_in_polygon(pa[0], &pb);
    let probe_b_in_a = point_in_polygon(pb[0], &pa);
    if !any_segment_intersection(&pa, &pb, tol) {
        return disjoint_result(a, b, probe_a_in_b, probe_b_in_a, op);
    }

    // Coincident pre-pass detection (critical-fix #3, option B = fail-fast)
    if has_coincident_polyline_overlap(&pa, &pb, tol) {
        // Step 4 will replace this with the keep/discard/flip matrix.
        // For now return empty + caller-visible warning to avoid silent
        // wrong results.
        eprintln!("[ADR-055 §7.1.1] trim_loop_boolean: coincident overlap \
                   detected — returning empty result (matrix handling lands \
                   in Step 4 Robustness).");
        return Vec::new();
    }

    let result = greiner_hormann(&pa, &pb, op, tol);
    result.into_iter()
        .map(|poly| {
            // Critical-fix #5: derive is_outer from signed area
            let is_outer = signed_area_polygon(&poly) > 0.0;
            polyline_to_trim_loop(poly, is_outer)
        })
        .collect()
}

/// Convenience wrappers.
pub fn trim_loop_union(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop> {
    trim_loop_boolean(a, b, TrimBoolOp::Union, tol)
}
pub fn trim_loop_intersect(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop> {
    trim_loop_boolean(a, b, TrimBoolOp::Intersect, tol)
}
pub fn trim_loop_subtract(a: &TrimLoop, b: &TrimLoop, tol: f64) -> Vec<TrimLoop> {
    trim_loop_boolean(a, b, TrimBoolOp::Subtract, tol)
}

// ── Helpers ──────────────────────────────────────────────────────────

fn ensure_ccw_polyline(loop_: &TrimLoop, tol: f64) -> Vec<[f64; 2]> {
    // Pure-line loops: use original corner vertices (much cleaner GH walk).
    let all_lines = loop_.curves.iter().all(|c| matches!(c, TrimCurve2D::Line { .. }));
    let mut poly: Vec<[f64; 2]> = if all_lines {
        loop_.curves.iter().map(|c| match c {
            TrimCurve2D::Line { a, .. } => *a,
            _ => unreachable!(),
        }).collect()
    } else {
        tessellate_loop(loop_, tol)
    };
    // Drop trailing duplicate of first point (some tessellators emit it)
    if poly.len() >= 2 {
        let last = *poly.last().unwrap();
        if (last[0] - poly[0][0]).abs() < tol && (last[1] - poly[0][1]).abs() < tol {
            poly.pop();
        }
    }
    if signed_area_polygon(&poly) < 0.0 { poly.reverse(); }
    poly
}

fn signed_area_polygon(p: &[[f64; 2]]) -> f64 {
    if p.len() < 3 { return 0.0; }
    let mut s = 0.0_f64;
    for i in 0..p.len() {
        let j = (i + 1) % p.len();
        s += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    s * 0.5
}

fn point_in_polygon(p: [f64; 2], poly: &[[f64; 2]]) -> bool {
    if poly.len() < 3 { return false; }
    let n = poly.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if (yi > p[1]) != (yj > p[1]) {
            let x_cross = (xj - xi) * (p[1] - yi) / (yj - yi + 1e-30) + xi;
            if p[0] < x_cross { inside = !inside; }
        }
        j = i;
    }
    inside
}

/// Cheap pre-check: any segment of pa intersect any segment of pb?
fn any_segment_intersection(pa: &[[f64; 2]], pb: &[[f64; 2]], tol: f64) -> bool {
    for i in 0..pa.len() {
        let a0 = pa[i]; let a1 = pa[(i + 1) % pa.len()];
        for j in 0..pb.len() {
            let b0 = pb[j]; let b1 = pb[(j + 1) % pb.len()];
            if !line_line(a0, a1, b0, b1, tol).is_empty() { return true; }
        }
    }
    false
}

/// Critical-fix #3: detect ANY Coincident-kind intersection in the
/// segment-pair scan. If found, the GH walk is unsafe (the matrix
/// handling lives in Step 4) and the caller must bail.
fn has_coincident_polyline_overlap(pa: &[[f64; 2]], pb: &[[f64; 2]], tol: f64) -> bool {
    for i in 0..pa.len() {
        let a0 = pa[i]; let a1 = pa[(i + 1) % pa.len()];
        for j in 0..pb.len() {
            let b0 = pb[j]; let b1 = pb[(j + 1) % pb.len()];
            for ix in line_line(a0, a1, b0, b1, tol) {
                if matches!(ix.kind, IntersectionKind::Coincident { .. }) {
                    return true;
                }
            }
        }
    }
    false
}

fn polyline_to_trim_loop(poly: Vec<[f64; 2]>, is_outer: bool) -> TrimLoop {
    let n = poly.len();
    let mut curves = Vec::with_capacity(n);
    for i in 0..n {
        curves.push(TrimCurve2D::Line {
            a: poly[i],
            b: poly[(i + 1) % n],
        });
    }
    TrimLoop { curves, is_outer }
}

fn disjoint_result(
    a: &TrimLoop, b: &TrimLoop,
    a_in_b: bool, b_in_a: bool,
    op: TrimBoolOp,
) -> Vec<TrimLoop> {
    use TrimBoolOp::*;
    match op {
        Union => {
            if a_in_b { vec![b.clone()] }
            else if b_in_a { vec![a.clone()] }
            else { vec![a.clone(), b.clone()] }
        }
        Intersect => {
            if a_in_b { vec![a.clone()] }
            else if b_in_a { vec![b.clone()] }
            else { Vec::new() }
        }
        Subtract => {
            if b_in_a { vec![a.clone(), reverse_for_hole(b)] } // a with b as hole
            else if a_in_b { Vec::new() }                       // a fully inside b
            else { vec![a.clone()] }                            // disjoint
        }
    }
}

fn reverse_for_hole(b: &TrimLoop) -> TrimLoop {
    use super::trim_geom::reverse_trim_loop;
    let mut hole = reverse_trim_loop(b.clone());
    hole.is_outer = false;
    hole
}

// ── Greiner-Hormann on polygons ──────────────────────────────────────
//
// Simplified form: build a labeled list of vertices for each polygon
// where intersection vertices are inserted in parameter order. Each
// intersection vertex is tagged as Entry / Exit on each polygon by the
// inside-test of the midpoint of the *next* edge segment (post-intersection).

#[derive(Clone, Copy, Debug, PartialEq)]
enum NodeKind { Original, Intersection { other_idx: usize } }

#[derive(Clone, Debug)]
struct GhNode {
    p: [f64; 2],
    kind: NodeKind,
    /// Entry into the OTHER polygon? (None for non-intersection vertices)
    entry: Option<bool>,
    /// Has this intersection node been visited during result walk?
    visited: bool,
}

fn build_gh_lists(
    pa: &[[f64; 2]], pb: &[[f64; 2]], tol: f64,
) -> (Vec<GhNode>, Vec<GhNode>) {
    // Per-edge intersection collection (with parameter on each edge for sort)
    let na = pa.len();
    let nb = pb.len();

    // Per-edge intersection bins, each entry: (t_a, t_b, pos)
    let mut bins_a: Vec<Vec<(f64, f64, [f64; 2])>> = vec![Vec::new(); na];
    let mut bins_b: Vec<Vec<(f64, f64, [f64; 2])>> = vec![Vec::new(); nb];

    for i in 0..na {
        let a0 = pa[i]; let a1 = pa[(i + 1) % na];
        for j in 0..nb {
            let b0 = pb[j]; let b1 = pb[(j + 1) % nb];
            for ix in line_line(a0, a1, b0, b1, tol) {
                // Skip Coincident intervals — MVP polygon GH treats overlapping
                // edges as boundary (no intersection insertion). Step 4 will
                // re-introduce via the matrix.
                match ix.kind {
                    IntersectionKind::Coincident { .. } => continue,
                    _ => {}
                }
                bins_a[i].push((ix.t_a, ix.t_b, ix.point));
                bins_b[j].push((ix.t_b, ix.t_a, ix.point));
            }
        }
    }

    // Build interleaved A list
    let mut a_nodes: Vec<GhNode> = Vec::with_capacity(na * 2);
    let mut a_edge_starts: Vec<usize> = Vec::with_capacity(na);
    for i in 0..na {
        a_edge_starts.push(a_nodes.len());
        a_nodes.push(GhNode { p: pa[i], kind: NodeKind::Original, entry: None, visited: false });
        let mut bin = bins_a[i].clone();
        bin.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        for (_, _, pos) in bin {
            a_nodes.push(GhNode {
                p: pos,
                kind: NodeKind::Intersection { other_idx: 0 }, // patched below
                entry: None, visited: false,
            });
        }
    }

    // Build interleaved B list
    let mut b_nodes: Vec<GhNode> = Vec::with_capacity(nb * 2);
    let mut b_edge_starts: Vec<usize> = Vec::with_capacity(nb);
    for j in 0..nb {
        b_edge_starts.push(b_nodes.len());
        b_nodes.push(GhNode { p: pb[j], kind: NodeKind::Original, entry: None, visited: false });
        let mut bin = bins_b[j].clone();
        bin.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        for (_, _, pos) in bin {
            b_nodes.push(GhNode {
                p: pos,
                kind: NodeKind::Intersection { other_idx: 0 },
                entry: None, visited: false,
            });
        }
    }

    // Cross-link intersection nodes by spatial match (since both lists
    // were built from the same intersection set, every intersection in
    // A must have a counterpart in B at the same XY).
    for ai in 0..a_nodes.len() {
        if matches!(a_nodes[ai].kind, NodeKind::Intersection { .. }) {
            // Find matching B index
            let mut best_bi = 0;
            let mut best_dist = f64::INFINITY;
            for bi in 0..b_nodes.len() {
                if !matches!(b_nodes[bi].kind, NodeKind::Intersection { .. }) { continue; }
                let dx = a_nodes[ai].p[0] - b_nodes[bi].p[0];
                let dy = a_nodes[ai].p[1] - b_nodes[bi].p[1];
                let d2 = dx * dx + dy * dy;
                if d2 < best_dist {
                    best_dist = d2;
                    best_bi = bi;
                }
            }
            a_nodes[ai].kind = NodeKind::Intersection { other_idx: best_bi };
        }
    }
    for bi in 0..b_nodes.len() {
        if matches!(b_nodes[bi].kind, NodeKind::Intersection { .. }) {
            let mut best_ai = 0;
            let mut best_dist = f64::INFINITY;
            for ai in 0..a_nodes.len() {
                if !matches!(a_nodes[ai].kind, NodeKind::Intersection { .. }) { continue; }
                let dx = b_nodes[bi].p[0] - a_nodes[ai].p[0];
                let dy = b_nodes[bi].p[1] - a_nodes[ai].p[1];
                let d2 = dx * dx + dy * dy;
                if d2 < best_dist {
                    best_dist = d2;
                    best_ai = ai;
                }
            }
            b_nodes[bi].kind = NodeKind::Intersection { other_idx: best_ai };
        }
    }

    // Per §7.1.2: Entry/Exit via offset-point inside test.
    // For each intersection in A, take the midpoint to NEXT node in A list
    // and test inside polygon B. If inside → this intersection is Entry
    // (we are entering B's interior).
    classify_entry_exit(&mut a_nodes, pb);
    classify_entry_exit(&mut b_nodes, pa);

    let _ = (a_edge_starts, b_edge_starts);
    (a_nodes, b_nodes)
}

/// Critical-fix #4 + ADR-055 §7.1.2: use **eps-offset point** along
/// the edge AFTER the intersection (rather than midpoint to next node)
/// for inside test. This is robust at boundaries and short segments.
///
/// `entry == Some(true)` means the polygon-side is ENTERING the
/// other polygon's interior at this intersection.
fn classify_entry_exit(nodes: &mut [GhNode], other_polygon: &[[f64; 2]]) {
    let n = nodes.len();
    for i in 0..n {
        if !matches!(nodes[i].kind, NodeKind::Intersection { .. }) { continue; }
        let next = (i + 1) % n;
        // Direction unit vector from this intersection toward next vertex
        let dx = nodes[next].p[0] - nodes[i].p[0];
        let dy = nodes[next].p[1] - nodes[i].p[1];
        let len = (dx * dx + dy * dy).sqrt();
        // eps offset = small fraction of edge length, capped at a sane
        // absolute value. Robust to short edges (no division blow-up).
        let eps = (len * 1e-3).max(1e-9).min(1e-4);
        let probe = if len < 1e-30 {
            // Degenerate: fall back to the next vertex itself
            nodes[next].p
        } else {
            [nodes[i].p[0] + dx / len * eps,
             nodes[i].p[1] + dy / len * eps]
        };
        nodes[i].entry = Some(point_in_polygon(probe, other_polygon));
    }
}

/// Walk the labeled lists per Boolean rule and produce result polygons.
fn greiner_hormann(
    pa: &[[f64; 2]], pb: &[[f64; 2]], op: TrimBoolOp, tol: f64,
) -> Vec<Vec<[f64; 2]>> {
    let (mut a, mut b) = build_gh_lists(pa, pb, tol);

    // No intersections at all → inclusion-based outcome handled by caller
    let any_a_ix = a.iter().any(|n| matches!(n.kind, NodeKind::Intersection { .. }));
    if !any_a_ix { return Vec::new(); }

    // For each operation, choose start condition + direction switch rule.
    //
    // Standard GH (Union/Intersect/Subtract) traversal:
    //   Intersect: start at A entry, follow A until exit, jump to B,
    //              follow B until next exit, jump back to A, repeat.
    //   Union:     start at A exit, follow A until entry, jump to B,
    //              follow B until next entry, jump back to A, repeat.
    //   Subtract:  start at A entry-into-B, follow A until exit, jump
    //              to B and follow REVERSE direction (B traversal flipped).
    //
    // MVP simplification: since point_in_polygon and offset-test give us
    // exact entry classification on both lists, we can use a unified rule:
    //   Build result by walking each unvisited intersection start:
    //     - Intersect:  begin where A is Entry, alternate sides, take the
    //                   intersection's "inside" segments only.
    //     - Union:      begin where A is Exit, alternate sides, take the
    //                   "outside" segments only.
    //     - Subtract:   begin where A is Entry, walk A forward, jump to B
    //                   and walk BACKWARD, alternate.

    let mut results: Vec<Vec<[f64; 2]>> = Vec::new();

    // Critical-fix #1 (op-conditional jump):
    //
    // Standard Greiner-Hormann: at each intersection, jump if the
    // CURRENT entry flag matches the operation's "stay on this side"
    // rule. We accumulate segments that are in the result region.
    //
    //   Intersect: result region = A ∩ B. Walk A while inside B; walk
    //              B while inside A. So:
    //                A.Entry  → we've just entered B's interior.
    //                          continue on A (don't jump).
    //                A.Exit   → we're about to leave B. JUMP to B and
    //                          continue tracing along B's boundary
    //                          inside A.
    //
    //   Union:     result region = A ∪ B. Walk A while OUTSIDE B; walk
    //              B while OUTSIDE A.
    //                A.Entry  → about to enter B. JUMP to B (B is now
    //                          outside our growing union of A's outside).
    //                A.Exit   → leaving B's interior, continue on A.
    //
    //   Subtract:  result region = A \ B. Walk A while OUTSIDE B; walk
    //              B while INSIDE A but in REVERSE direction (so the
    //              hole boundary is CW relative to A's CCW outer).
    //                A.Entry  → about to enter B. JUMP to B (reverse).
    //                A.Exit   → leaving B, continue on A.
    //
    // → Translate: jump when (Intersect: Exit), (Union: Entry),
    //             (Subtract: Entry). On B side, the same flags apply
    //             from B's perspective — for Subtract, we walk B in
    //             REVERSE so a B.Entry-into-A becomes a "leaving the
    //             hole region" — jump back at B.Exit-from-A in reverse.
    //
    // Start condition aligns with first step of forward walk:
    //   - Intersect / Subtract: start at A.Entry (we'll keep walking A
    //                            until A.Exit triggers jump).
    //   - Union: start at A.Exit (we'll keep walking A until A.Entry
    //            triggers jump).
    let start_kind = match op {
        TrimBoolOp::Intersect => true,    // A.Entry — interior of B reached
        TrimBoolOp::Subtract  => true,    // A.Entry — about to leave A∖B
        TrimBoolOp::Union     => false,   // A.Exit — outside of B reached
    };
    let b_forward = !matches!(op, TrimBoolOp::Subtract);

    loop {
        // Find next unvisited start candidate matching the start_kind
        let start_opt = (0..a.len()).find(|&i|
            matches!(a[i].kind, NodeKind::Intersection { .. })
            && !a[i].visited
            && a[i].entry == Some(start_kind));
        let Some(start) = start_opt else { break; };

        let mut poly: Vec<[f64; 2]> = vec![a[start].p];
        // Note: we do NOT mark start as visited yet — we use the
        // termination condition `on_a && idx == start && a[idx].visited`
        // (critical-fix #2) to detect the full circuit. We mark visited
        // AFTER the first step away.
        let start_visited_on_completion = true;

        let mut on_a = true;
        let mut idx = start;
        let mut just_started = true;

        let mut steps = 0usize;
        let max_steps = (a.len() + b.len()) * 4;

        loop {
            steps += 1;
            if steps > max_steps { break; }

            // STEP first
            let len = if on_a { a.len() } else { b.len() };
            let direction_forward = on_a || b_forward;
            idx = if direction_forward {
                (idx + 1) % len
            } else {
                (idx + len - 1) % len
            };

            // After the very first step, mark the start node as visited
            // so the termination condition can fire on the next return.
            if just_started {
                a[start].visited = start_visited_on_completion;
                just_started = false;
            }

            // Read node
            let (p, is_ix, entry_flag, other_idx_opt, already_visited) = if on_a {
                let n = &a[idx];
                let ix = matches!(n.kind, NodeKind::Intersection { .. });
                (n.p, ix, n.entry,
                 if let NodeKind::Intersection { other_idx } = n.kind { Some(other_idx) } else { None },
                 n.visited)
            } else {
                let n = &b[idx];
                let ix = matches!(n.kind, NodeKind::Intersection { .. });
                (n.p, ix, n.entry,
                 if let NodeKind::Intersection { other_idx } = n.kind { Some(other_idx) } else { None },
                 n.visited)
            };

            // Critical-fix #2: terminate when same intersection on A side
            // is reached AND it was previously visited (full circuit done).
            // User-recommended hardening (A): require poly.len() > 2 so
            // we never break on a degenerate 1-2 vertex result. Even if
            // we did, the bottom `if poly.len() >= 3` filter would drop
            // it — but the explicit guard makes diagnostics cleaner.
            if on_a && idx == start && already_visited && poly.len() > 2 {
                break;
            }

            // Append (dedup last)
            if (poly.last().unwrap()[0] - p[0]).abs() > tol ||
               (poly.last().unwrap()[1] - p[1]).abs() > tol
            {
                poly.push(p);
            }

            if is_ix {
                if on_a { a[idx].visited = true; } else { b[idx].visited = true; }

                // Critical-fix #1: jump only when op-condition matches
                // entry/exit state at this intersection.
                let should_jump = match op {
                    TrimBoolOp::Intersect => entry_flag == Some(false), // jump on Exit
                    TrimBoolOp::Union     => entry_flag == Some(true),  // jump on Entry
                    TrimBoolOp::Subtract  => entry_flag == Some(true),  // jump on Entry
                };
                if should_jump && !already_visited {
                    if let Some(other) = other_idx_opt {
                        on_a = !on_a;
                        idx = other;
                        // ─── LOCK-IN: post-jump termination guard ───
                        // This post-jump termination is REQUIRED to
                        // prevent stepping past the start intersection
                        // when a jump immediately closes the loop. It
                        // complements the visited-based full-circuit
                        // termination above.
                        //
                        // ADR-055 Amendment lock-in (사용자 결정,
                        // 2026-05-04 review): this guard is verified
                        // correct against:
                        //   ✅ §7.1.2 jump rule (op-conditional)
                        //   ✅ "start 통과 오염" 차단
                        //   ✅ Step 4 Coincident matrix 교체 후에도 유효
                        //
                        // Removing this triggers wrong-area regression
                        // in intersect_overlapping_squares (12.5 vs 25)
                        // — see commit 35fe799 history.
                        if on_a && idx == start && poly.len() > 2 { break; }
                    }
                }
                // If already visited (we've revisited this intersection
                // via a different path), step past without jumping —
                // walk continues until termination via critical-fix #2.
            }
        }

        if poly.len() >= 3 { results.push(poly); }
    }

    results
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

    // ── Step 2 Boolean Traversal regressions (9, §7.3 #2) ──

    fn ccw_square(x: f64, y: f64, side: f64) -> TrimLoop {
        let pts = [[x, y], [x + side, y], [x + side, y + side], [x, y + side]];
        let curves = (0..4).map(|i| TrimCurve2D::Line {
            a: pts[i], b: pts[(i + 1) % 4],
        }).collect();
        TrimLoop { curves, is_outer: true }
    }

    fn loop_area(l: &TrimLoop) -> f64 {
        super::super::trim_geom::trim_loop_signed_area(l, 1e-3)
    }

    /// Intersect: disjoint → empty.
    #[test]
    fn intersect_disjoint_returns_empty() {
        let a = ccw_square(0.0, 0.0, 5.0);
        let b = ccw_square(10.0, 10.0, 5.0);
        let r = trim_loop_intersect(&a, &b, 1e-9);
        assert!(r.is_empty(), "disjoint intersect must be empty, got {:?}", r);
    }

    /// Intersect: nested (b ⊂ a) → returns b.
    #[test]
    fn intersect_nested_returns_inner() {
        let a = ccw_square(0.0, 0.0, 10.0);
        let b = ccw_square(2.0, 2.0, 4.0);
        let r = trim_loop_intersect(&a, &b, 1e-6);
        assert_eq!(r.len(), 1, "nested intersect should be 1 loop");
        assert!((loop_area(&r[0]) - 16.0).abs() < 0.5, "area ≈ b's 16, got {}", loop_area(&r[0]));
    }

    /// Intersect: overlapping squares → smaller inner square.
    #[test]
    fn intersect_overlapping_squares() {
        let a = ccw_square(0.0, 0.0, 10.0);
        let b = ccw_square(5.0, 5.0, 10.0);
        let r = trim_loop_intersect(&a, &b, 1e-6);
        assert_eq!(r.len(), 1, "overlapping intersect should be 1 loop");
        // Overlap rectangle [5,5]-[10,10] = 5×5 = 25
        let area = loop_area(&r[0]);
        assert!((area - 25.0).abs() < 0.5, "overlap area should ≈ 25, got {}", area);
    }

    /// Union: disjoint → 2 loops.
    #[test]
    fn union_disjoint_returns_both() {
        let a = ccw_square(0.0, 0.0, 5.0);
        let b = ccw_square(10.0, 10.0, 5.0);
        let r = trim_loop_union(&a, &b, 1e-9);
        assert_eq!(r.len(), 2, "disjoint union returns both");
    }

    /// Union: nested → returns outer.
    #[test]
    fn union_nested_returns_outer() {
        let a = ccw_square(0.0, 0.0, 10.0);
        let b = ccw_square(2.0, 2.0, 4.0);
        let r = trim_loop_union(&a, &b, 1e-6);
        assert_eq!(r.len(), 1, "nested union returns single outer");
        assert!((loop_area(&r[0]) - 100.0).abs() < 0.5);
    }

    /// Union: overlapping squares → single combined region.
    #[test]
    fn union_overlapping_squares() {
        let a = ccw_square(0.0, 0.0, 10.0);
        let b = ccw_square(5.0, 5.0, 10.0);
        let r = trim_loop_union(&a, &b, 1e-6);
        assert_eq!(r.len(), 1, "overlapping union → 1 loop");
        // |A ∪ B| = |A| + |B| - |A ∩ B| = 100 + 100 - 25 = 175
        let area = loop_area(&r[0]);
        assert!((area - 175.0).abs() < 1.0,
            "union area should ≈ 175, got {}", area);
    }

    /// Subtract: disjoint → returns a unchanged.
    #[test]
    fn subtract_disjoint_returns_a() {
        let a = ccw_square(0.0, 0.0, 5.0);
        let b = ccw_square(10.0, 10.0, 5.0);
        let r = trim_loop_subtract(&a, &b, 1e-9);
        assert_eq!(r.len(), 1);
        assert!((loop_area(&r[0]) - 25.0).abs() < 1e-9);
    }

    /// Subtract: a fully inside b → empty.
    #[test]
    fn subtract_a_inside_b_returns_empty() {
        let a = ccw_square(2.0, 2.0, 4.0);
        let b = ccw_square(0.0, 0.0, 10.0);
        let r = trim_loop_subtract(&a, &b, 1e-6);
        assert!(r.is_empty(), "a ⊂ b ⇒ a \\ b is empty");
    }

    /// Subtract: b inside a → a with b as hole (2 loops: outer + reversed inner).
    #[test]
    fn subtract_b_inside_a_creates_hole() {
        let a = ccw_square(0.0, 0.0, 10.0);
        let b = ccw_square(3.0, 3.0, 4.0);
        let r = trim_loop_subtract(&a, &b, 1e-6);
        assert_eq!(r.len(), 2, "result = outer a + hole (reversed b)");
        // First = a (outer), second = reversed b (CW hole)
        assert!(r[0].is_outer);
        assert!(!r[1].is_outer);
        // Hole signed area should be NEGATIVE (CW)
        let hole_area = loop_area(&r[1]);
        assert!(hole_area < 0.0, "hole area should be < 0, got {}", hole_area);
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
