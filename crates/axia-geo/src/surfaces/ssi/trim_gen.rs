//! SSI Stage 2 (Phase G) — convert SSI results to surface-local TrimCurve2D.
//!
//! After `intersect_bspline_pair` produces `SurfaceIntersection` chains
//! with global `uv_a` / `uv_b` sequences, this module projects them into
//! each surface's parameter space as `TrimCurve2D::Line` polylines.
//!
//! For closed chains, builds matching `TrimLoop` pairs (one per surface).
//! Open chains stay as bare polyline `Vec<TrimCurve2D>`.

use super::SurfaceIntersection;
use super::super::trim::{TrimCurve2D, TrimLoop};

/// Convert a single SSI chain to two polylines of `TrimCurve2D::Line`s
/// — one in surface A's parameter space, one in surface B's.
///
/// Each segment connects consecutive `uv_a` (resp. `uv_b`) points.
/// If the chain has fewer than 2 points, returns empty vectors.
pub fn ssi_to_polyline(
    intersection: &SurfaceIntersection,
) -> (Vec<TrimCurve2D>, Vec<TrimCurve2D>) {
    let n = intersection.points.len();
    if n < 2 {
        return (Vec::new(), Vec::new());
    }
    let mut a_segs = Vec::with_capacity(n - 1);
    let mut b_segs = Vec::with_capacity(n - 1);
    for i in 0..n - 1 {
        let (ua, va) = intersection.uv_a[i];
        let (ua_next, va_next) = intersection.uv_a[i + 1];
        a_segs.push(TrimCurve2D::Line {
            a: [ua, va],
            b: [ua_next, va_next],
        });
        let (ub, vb) = intersection.uv_b[i];
        let (ub_next, vb_next) = intersection.uv_b[i + 1];
        b_segs.push(TrimCurve2D::Line {
            a: [ub, vb],
            b: [ub_next, vb_next],
        });
    }
    (a_segs, b_segs)
}

/// Convert a closed SSI chain to a matched pair of `TrimLoop`s.
///
/// Returns `None` if the chain is not closed.
/// `is_outer` flag is forwarded to both loops.
pub fn ssi_to_trim_loops(
    intersection: &SurfaceIntersection,
    is_outer: bool,
) -> Option<(TrimLoop, TrimLoop)> {
    if !intersection.closed {
        return None;
    }
    let (a_segs, b_segs) = ssi_to_polyline(intersection);
    if a_segs.is_empty() {
        return None;
    }
    Some((
        TrimLoop { curves: a_segs, is_outer },
        TrimLoop { curves: b_segs, is_outer },
    ))
}

/// Convert a list of intersections (e.g. all chains from
/// `intersect_bspline_pair`) into per-surface trim collections.
///
/// Returns `(loops_a, loops_b, polylines_a, polylines_b)` where:
/// - `loops_a/b`: closed chain pairs as TrimLoops
/// - `polylines_a/b`: open chains as bare segment lists (one per chain)
pub fn ssi_batch_to_trim(
    intersections: &[SurfaceIntersection],
    is_outer: bool,
) -> (Vec<TrimLoop>, Vec<TrimLoop>, Vec<Vec<TrimCurve2D>>, Vec<Vec<TrimCurve2D>>) {
    let mut loops_a = Vec::new();
    let mut loops_b = Vec::new();
    let mut polys_a = Vec::new();
    let mut polys_b = Vec::new();
    for inter in intersections {
        if inter.closed {
            if let Some((la, lb)) = ssi_to_trim_loops(inter, is_outer) {
                loops_a.push(la);
                loops_b.push(lb);
            }
        } else {
            let (pa, pb) = ssi_to_polyline(inter);
            if !pa.is_empty() {
                polys_a.push(pa);
                polys_b.push(pb);
            }
        }
    }
    (loops_a, loops_b, polys_a, polys_b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    fn make_chain(points: Vec<DVec3>, uv_pairs: Vec<((f64, f64), (f64, f64))>, closed: bool)
        -> SurfaceIntersection
    {
        let uv_a: Vec<(f64, f64)> = uv_pairs.iter().map(|(a, _)| *a).collect();
        let uv_b: Vec<(f64, f64)> = uv_pairs.iter().map(|(_, b)| *b).collect();
        SurfaceIntersection {
            points, uv_a, uv_b, closed, tangent_warning: false,
        }
    }

    #[test]
    fn polyline_empty_for_short_chain() {
        let inter = make_chain(
            vec![DVec3::ZERO],
            vec![((0.0, 0.0), (0.0, 0.0))],
            false,
        );
        let (a, b) = ssi_to_polyline(&inter);
        assert!(a.is_empty() && b.is_empty());
    }

    #[test]
    fn polyline_three_points_yields_two_segments() {
        let inter = make_chain(
            vec![DVec3::ZERO, DVec3::X, DVec3::Y],
            vec![
                ((0.0, 0.0), (0.5, 0.5)),
                ((0.5, 0.5), (0.6, 0.4)),
                ((1.0, 1.0), (0.7, 0.3)),
            ],
            false,
        );
        let (a, b) = ssi_to_polyline(&inter);
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 2);
        match &a[0] {
            TrimCurve2D::Line { a: pa, b: pb } => {
                assert_eq!(*pa, [0.0, 0.0]);
                assert_eq!(*pb, [0.5, 0.5]);
            }
            _ => panic!("expected Line"),
        }
        match &b[1] {
            TrimCurve2D::Line { a: pa, b: pb } => {
                assert_eq!(*pa, [0.6, 0.4]);
                assert_eq!(*pb, [0.7, 0.3]);
            }
            _ => panic!("expected Line"),
        }
    }

    #[test]
    fn trim_loops_only_for_closed_chains() {
        let open_chain = make_chain(
            vec![DVec3::ZERO, DVec3::X, DVec3::Y],
            vec![
                ((0.0, 0.0), (0.0, 0.0)),
                ((0.5, 0.5), (0.5, 0.5)),
                ((1.0, 1.0), (1.0, 1.0)),
            ],
            false,
        );
        assert!(ssi_to_trim_loops(&open_chain, true).is_none());

        let closed_chain = make_chain(
            vec![DVec3::ZERO, DVec3::X, DVec3::Y, DVec3::ZERO],
            vec![
                ((0.0, 0.0), (0.0, 0.0)),
                ((0.5, 0.0), (0.5, 0.0)),
                ((0.0, 0.5), (0.0, 0.5)),
                ((0.0, 0.0), (0.0, 0.0)),
            ],
            true,
        );
        let (la, lb) = ssi_to_trim_loops(&closed_chain, true).unwrap();
        assert_eq!(la.curves.len(), 3);
        assert_eq!(lb.curves.len(), 3);
        assert!(la.is_outer);
        assert!(lb.is_outer);
    }

    #[test]
    fn batch_separates_closed_and_open() {
        let closed = make_chain(
            vec![DVec3::ZERO, DVec3::X, DVec3::Y, DVec3::ZERO],
            vec![
                ((0.0, 0.0), (0.0, 0.0)),
                ((0.5, 0.0), (0.5, 0.0)),
                ((0.0, 0.5), (0.0, 0.5)),
                ((0.0, 0.0), (0.0, 0.0)),
            ],
            true,
        );
        let open = make_chain(
            vec![DVec3::ZERO, DVec3::X],
            vec![((0.0, 0.0), (0.5, 0.5)), ((1.0, 0.0), (1.0, 1.0))],
            false,
        );
        let (la, lb, pa, pb) = ssi_batch_to_trim(&[closed, open], false);
        assert_eq!(la.len(), 1);
        assert_eq!(lb.len(), 1);
        assert_eq!(pa.len(), 1);
        assert_eq!(pb.len(), 1);
        assert!(!la[0].is_outer);
    }
}
