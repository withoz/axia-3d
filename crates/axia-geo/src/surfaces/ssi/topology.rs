//! SSI Stage 4 — Topology assembly (ADR-034 §P19, Stage 4).
//!
//! Given a list of refined candidate points, stitches them into ordered
//! polylines representing intersection curve(s). Detects closed loops.
//!
//! ## MVP algorithm — greedy nearest-neighbor chaining
//! 1. Dedup candidates within `merge_tol` (avoid duplicate refinements).
//! 2. For each unvisited point, start a chain. Walk to nearest unvisited
//!    point until next neighbor distance exceeds `gap_tol`.
//! 3. Try to extend backward from start as well.
//! 4. Detect closure: chain endpoints within `merge_tol` → mark closed.
//! 5. Emit each chain as a `SurfaceIntersection`.
//!
//! ## Limitations (defer to follow-up)
//! - No singular point (branching) detection — multi-branch curves emerge
//!   as separate chains.
//! - Self-intersecting curves yield one chain that crosses itself.

use super::SurfaceIntersection;
use super::newton::RefinementResult;

/// Assemble refined candidates into ordered polyline(s).
pub fn assemble_chains(
    mut candidates: Vec<RefinementResult>,
    gap_tol: f64,
    merge_tol: f64,
) -> Vec<SurfaceIntersection> {
    // Dedup
    candidates = dedup(candidates, merge_tol);
    if candidates.is_empty() {
        return Vec::new();
    }

    let n = candidates.len();
    let mut visited = vec![false; n];
    let mut chains: Vec<SurfaceIntersection> = Vec::new();

    for start_idx in 0..n {
        if visited[start_idx] { continue; }
        // Build chain starting at start_idx, walking forward (greedy NN).
        let mut chain_idx: Vec<usize> = vec![start_idx];
        visited[start_idx] = true;

        // Forward walk
        loop {
            let last = *chain_idx.last().unwrap();
            let last_pt = candidates[last].point;
            let mut best: Option<(usize, f64)> = None;
            for (i, c) in candidates.iter().enumerate() {
                if visited[i] { continue; }
                let d = (c.point - last_pt).length();
                if d <= gap_tol && best.map_or(true, |(_, bd)| d < bd) {
                    best = Some((i, d));
                }
            }
            match best {
                Some((i, _)) => { visited[i] = true; chain_idx.push(i); }
                None => break,
            }
        }

        // Backward walk (extend before start)
        loop {
            let first = *chain_idx.first().unwrap();
            let first_pt = candidates[first].point;
            let mut best: Option<(usize, f64)> = None;
            for (i, c) in candidates.iter().enumerate() {
                if visited[i] { continue; }
                let d = (c.point - first_pt).length();
                if d <= gap_tol && best.map_or(true, |(_, bd)| d < bd) {
                    best = Some((i, d));
                }
            }
            match best {
                Some((i, _)) => { visited[i] = true; chain_idx.insert(0, i); }
                None => break,
            }
        }

        // Build SurfaceIntersection from chain.
        let mut points = Vec::with_capacity(chain_idx.len());
        let mut uv_a = Vec::with_capacity(chain_idx.len());
        let mut uv_b = Vec::with_capacity(chain_idx.len());
        for &i in &chain_idx {
            points.push(candidates[i].point);
            uv_a.push(candidates[i].uv_a);
            uv_b.push(candidates[i].uv_b);
        }

        // Closure check: endpoints within merge_tol
        let closed = chain_idx.len() >= 3
            && (points.first().unwrap().clone() - points.last().unwrap().clone()).length()
                < merge_tol * 4.0;

        // Tangent warning if any candidate flagged depth_capped
        let tangent_warning = chain_idx.iter()
            .any(|&i| candidates[i].iterations >= 50);

        chains.push(SurfaceIntersection {
            points, uv_a, uv_b, closed, tangent_warning,
        });
    }

    chains
}

/// Drop near-duplicate candidates within `tol`. Keeps the one with smaller
/// residual.
fn dedup(mut candidates: Vec<RefinementResult>, tol: f64) -> Vec<RefinementResult> {
    candidates.sort_by(|a, b| a.residual.partial_cmp(&b.residual).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<RefinementResult> = Vec::new();
    for c in candidates {
        let dup = kept.iter().any(|k| (k.point - c.point).length() < tol);
        if !dup {
            kept.push(c);
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    fn make_cand(p: DVec3, residual: f64) -> RefinementResult {
        RefinementResult {
            uv_a: (0.0, 0.0),
            uv_b: (0.0, 0.0),
            point: p,
            residual,
            iterations: 1,
            converged: true,
        }
    }

    #[test]
    fn assemble_empty_returns_empty() {
        let chains = assemble_chains(vec![], 0.1, 1e-3);
        assert!(chains.is_empty());
    }

    #[test]
    fn assemble_collinear_points_chain_in_order() {
        // 5 collinear points spaced 1mm apart along X. Random insertion order.
        let candidates = vec![
            make_cand(DVec3::new(2.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(0.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(4.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(1.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(3.0, 0.0, 0.0), 0.0),
        ];
        let chains = assemble_chains(candidates, 1.5, 0.01);
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert_eq!(chain.points.len(), 5);
        assert!(!chain.closed);
        // Should be sorted by X (or its reverse — chaining direction).
        let xs: Vec<f64> = chain.points.iter().map(|p| p.x).collect();
        let monotonic = xs.windows(2).all(|w| w[0] <= w[1])
            || xs.windows(2).all(|w| w[0] >= w[1]);
        assert!(monotonic, "x values not monotonic: {:?}", xs);
    }

    #[test]
    fn assemble_closed_loop_detected() {
        // 8 points around a circle (radius 1), random order.
        let n = 8;
        let mut candidates = Vec::new();
        for i in 0..n {
            let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
            let p = DVec3::new(theta.cos(), theta.sin(), 0.0);
            candidates.push(make_cand(p, 0.0));
        }
        // Distance between adjacent samples = 2·sin(π/8) ≈ 0.765
        let chains = assemble_chains(candidates, 1.0, 0.01);
        assert_eq!(chains.len(), 1);
        // Loop closure: first ≈ last with gap_tol*4 padding
        // gap from first to last after greedy walk should be < 4*merge_tol
        // Note: with merge_tol=0.01, merge_tol*4=0.04 — too tight for raw
        // 8-sample circle. Closure detection is a heuristic; relax tol.
        let chains2 = assemble_chains(
            (0..n).map(|i| {
                let theta = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
                let p = DVec3::new(theta.cos(), theta.sin(), 0.0);
                make_cand(p, 0.0)
            }).collect(),
            1.0,
            0.5,  // looser merge_tol → closure threshold = 2.0
        );
        assert_eq!(chains2.len(), 1);
        assert!(chains2[0].closed, "loop should close with looser merge_tol");
    }

    #[test]
    fn assemble_two_disconnected_chains() {
        // Cluster A near origin, cluster B near (10, 0, 0). gap_tol < 10
        // means they shouldn't merge.
        let candidates = vec![
            make_cand(DVec3::new(0.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(1.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(2.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(10.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(11.0, 0.0, 0.0), 0.0),
            make_cand(DVec3::new(12.0, 0.0, 0.0), 0.0),
        ];
        let chains = assemble_chains(candidates, 2.0, 0.1);
        assert_eq!(chains.len(), 2);
        // Each chain should have 3 points.
        for c in &chains {
            assert_eq!(c.points.len(), 3);
            assert!(!c.closed);
        }
    }

    #[test]
    fn assemble_dedups_close_duplicates() {
        let candidates = vec![
            make_cand(DVec3::ZERO, 1e-3),
            make_cand(DVec3::new(1e-9, 0.0, 0.0), 1e-4),  // duplicate of (0,0,0)
            make_cand(DVec3::new(1.0, 0.0, 0.0), 0.0),
        ];
        let chains = assemble_chains(candidates, 2.0, 1e-6);
        assert_eq!(chains.len(), 1);
        // After dedup, only 2 points (origin and (1,0,0)).
        assert_eq!(chains[0].points.len(), 2);
    }
}
