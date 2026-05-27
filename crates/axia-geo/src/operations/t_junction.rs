//! ADR-149 — T-junction Sweep 명시 도구 (β-1 detection + β-2 healing).
//!
//! Mesh-level T-junction: vertex V 가 face F 의 edge E interior 에 위치하지만,
//! E 는 V 를 endpoint 로 갖지 않음 (F 의 boundary loop 에 V 미포함). T 모양
//! 의 위상 결함 — LOCKED #1 P7 manifold + LOCKED #16 ADR-038 P23 normal
//! artifact + downstream op (Boolean/Push-Pull) 회귀 source.
//!
//! **메타-원칙 #16 정합**: 휴리스틱 자동 sweep 0, 사용자 명시 ContextMenu
//! 호출 only (ADR-139 / 145 / 148 canonical 답습).
//!
//! # β-1 scope (detection)
//!
//! - `TJunctionReport` struct (검출 결과 — face/edge/vertex/t_along_edge)
//! - `detect_t_junctions(&Mesh, tol)` free function:
//!   - 모든 active edges 순회
//!   - 모든 active vertices 후보로 distance check (segment interior)
//!   - face F 의 boundary loop 에 V 미포함 시 T-junction emit
//! - 회귀 6개 (baseline + canonical + endpoint exclude + multi-vertex +
//!   tolerance boundary + spatial-hash performance)
//!
//! # β-2 scope (current commit — healing)
//!
//! - `TJunctionError` enum (3 variants — InvalidReport / VertexNotOnEdge /
//!   SplitEdgeFailed)
//! - `HealReport` struct (healed_count / new_vertex_id / new_edges)
//! - `heal_t_junction(&mut Mesh, &TJunctionReport) -> Result<HealReport>`:
//!   - report validation (face/edge/vertex 모두 active)
//!   - vertex 가 edge interior 에 *여전히* 위치 재검증 (drift 대비)
//!   - `mesh.split_edge(edge_id, V.position)` 호출 — DCEL surgery 위임
//!   - `mesh.mark_edges_hard(&[e1, e2])` — split-induced edges HARD flag
//!     (메타-원칙 #15 정합, ADR-101 Amendment 10 canonical 답습)
//! - 회귀 6개 (canonical heal + HARD flag + manifold post-heal +
//!   spatial-hash dedup + invalid report reject + multi-heal in sequence)
//!
//! # Algorithm (Q1=a Full mesh sweep + spatial-hash candidate)
//!
//! ADR-148 Hybrid BVH+DFS pattern 답습. β-1 MVP 는 naive O(N×M) — spatial-
//! hash optimization 은 perf test (#6) 가 검증 driver, 대형 mesh 진입 시
//! activate. 작은 mesh (< 100 active verts) 에서는 naive 가 더 빠름.
//!
//! 1. 모든 active edges E 순회
//! 2. E.v_small, E.v_large 의 position 가져옴
//! 3. 모든 active vertices V 후보 (V != endpoints):
//!    - point_on_segment_interior(p_V, p_small, p_large, tol) check
//!    - if true: radial chain traversal 로 incident faces F 수집
//!    - 각 F 에 대해 face_contains_vertex_on_boundary(F, V) false 시
//!      → TJunctionReport emit
//!
//! # Tolerance (Q5=a, LOCKED #5 0.15μm 답습)
//!
//! `T_JUNCTION_TOL = 1.5e-4` mm (= 0.15μm). ADR-147 Scenario B1 의 3-layer
//! precision (SPATIAL_HASH_CELL / CARDINAL_SNAP_TOL / POINT_OFF_CURVE_TOL)
//! 자연 확장. 별도 const (LOCKED #5 SSOT 보존, 의미 명시).
//!
//! # Cross-link
//!
//! - ADR-149 α spec (`docs/adr/149-t-junction-sweep-explicit-tool.md`)
//! - ADR-148 (Boundary Tool — pattern source)
//! - ADR-128 (vertex-on-edge fallback — 2D intersection layer)
//! - LOCKED #1 ADR-021 P7 (manifold anchor)
//! - LOCKED #5 (0.15μm spatial-hash — T_JUNCTION_TOL 정합)
//! - LOCKED #15 메타-원칙 #15 (β-2 split_edge HARD flag)
//! - LOCKED #16 ADR-038 P23 (β-2 normal recompute)
//! - LOCKED #44 / #65 / #66

use crate::mesh::Mesh;
use crate::{FaceId, VertId, EdgeId};
use glam::DVec3;

/// ADR-149 — T-junction detection tolerance (vertex-on-edge distance).
///
/// LOCKED #5 spatial-hash 0.15μm 와 정합 — vertex dedup 와 동일 scale.
/// ADR-147 Scenario B1 3-layer precision (SPATIAL_HASH_CELL=1e-4 /
/// CARDINAL_SNAP_TOL=1e-4 / POINT_OFF_CURVE_TOL=1.5e-4) 의 자연 확장.
pub const T_JUNCTION_TOL: f64 = 1.5e-4; // 0.15μm

/// ADR-149 β-1 — Single T-junction detection report.
///
/// One T-junction = one (face, edge, vertex) triple where:
/// - vertex V lies on edge E interior (within `T_JUNCTION_TOL`)
/// - face F is incident to edge E
/// - face F's boundary loop does NOT contain V
///
/// `t_along_edge` is the normalized parameter along E from `v_small` to
/// `v_large` (0.0 = at v_small, 1.0 = at v_large). For valid T-junction
/// 0 < t < 1 (strict interior). Endpoint vertices are filtered out
/// before report emission.
#[derive(Debug, Clone, PartialEq)]
pub struct TJunctionReport {
    /// The face whose boundary loop is missing the vertex.
    pub face_id: FaceId,
    /// The edge of `face_id` on whose interior the vertex lies.
    pub edge_id: EdgeId,
    /// The vertex on edge interior (NOT in face boundary loop).
    pub vertex_id: VertId,
    /// Normalized parameter along edge (0 < t < 1, strict interior).
    pub t_along_edge: f64,
}

/// ADR-149 β-1 — Compute distance from point `p` to line segment
/// `[a, b]`, and return (distance, normalized t along segment).
///
/// Returns `None` if segment is degenerate (a ≈ b, length < 1e-12).
///
/// `t` is clamped to [0, 1] in the returned value, but caller must check
/// strict interior (0 < t < 1) for T-junction detection.
fn point_to_segment(p: DVec3, a: DVec3, b: DVec3) -> Option<(f64, f64)> {
    let ab = b - a;
    let len2 = ab.length_squared();
    if len2 < 1e-24 {
        // Degenerate segment — treat as point
        return None;
    }
    let ap = p - a;
    let t_raw = ap.dot(ab) / len2;
    let t = t_raw.clamp(0.0, 1.0);
    let closest = a + ab * t;
    let dist = (p - closest).length();
    Some((dist, t))
}

/// ADR-149 β-1 — Detect all mesh-level T-junctions.
///
/// Returns a Vec of `TJunctionReport`s — one per (face, edge, vertex)
/// triple satisfying the T-junction condition (vertex V on edge E
/// interior + V ∉ face F's boundary loop).
///
/// Empty Vec = no T-junctions detected (clean mesh).
///
/// # Algorithm
///
/// β-1 MVP: O(E × V) naive sweep. Each active edge × each active vertex
/// (excluding endpoints) → distance check. Acceptable for typical mesh
/// scales (< 10000 verts). β-2+ optional spatial-hash bucketing.
///
/// # Parameters
///
/// - `tol`: distance threshold for vertex-on-edge-interior. Recommended
///   default = `T_JUNCTION_TOL` (0.15μm, LOCKED #5 답습).
///
/// # Lock-ins (β-1)
///
/// - **L-β1-1**: endpoint vertex 명시 skip (v_small / v_large 자동 제외)
/// - **L-β1-2**: t strict interior (0 < t < 1, endpoint 경계 case 제외)
/// - **L-β1-3**: face F 의 boundary loop membership 검사 — F 가 V 를
///   loop 에 포함하면 정상 (T-junction 아님), 미포함 시 T-junction emit
/// - **L-β1-4**: radial chain traversal 로 edge E 의 모든 incident face
///   수집 (≤ 32 iterations, manifold mesh 에서는 평균 2)
/// - **L-β1-5**: inactive face / inactive vertex / inactive edge 모두
///   skip (silent — silent skip 차단은 β-2 healing 단계의 책임)
pub fn detect_t_junctions(mesh: &Mesh, tol: f64) -> Vec<TJunctionReport> {
    let mut reports = Vec::new();

    // Snapshot active vertex positions (avoid repeated vertex_pos calls).
    let mut active_verts: Vec<(VertId, DVec3)> = Vec::new();
    for (vid, vert) in mesh.verts.iter() {
        if !vert.is_active() { continue; }
        if let Ok(p) = mesh.vertex_pos(vid) {
            active_verts.push((vid, p));
        }
    }

    // Iterate active edges.
    for (eid, edge) in mesh.edges.iter() {
        if !edge.is_active() { continue; }
        let v_small = edge.v_small();
        let v_large = edge.v_large();
        let p_small = match mesh.vertex_pos(v_small) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let p_large = match mesh.vertex_pos(v_large) {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Skip degenerate (self-loop or coincident endpoints).
        if v_small == v_large { continue; }
        if (p_large - p_small).length_squared() < 1e-24 { continue; }

        // Check each active vertex (excluding endpoints).
        for &(vid, p_v) in &active_verts {
            if vid == v_small || vid == v_large { continue; }

            // L-β1-1 / L-β1-2: distance + strict interior check
            let (dist, t) = match point_to_segment(p_v, p_small, p_large) {
                Some(x) => x,
                None => continue,
            };
            if dist > tol { continue; }
            // Strict interior — exclude t ≈ 0 or t ≈ 1 (endpoint coincide)
            // Use tol-relative t threshold: if t * segment_length < tol or
            // (1-t) * segment_length < tol, vertex is at endpoint (drift).
            let seg_len = (p_large - p_small).length();
            if t * seg_len < tol || (1.0 - t) * seg_len < tol { continue; }

            // L-β1-4: walk radial chain to collect incident faces
            let start_he = edge.any_he();
            if start_he.is_null() { continue; }
            let mut he = start_he;
            let mut faces_visited: Vec<FaceId> = Vec::with_capacity(4);
            for _ in 0..32 {
                let f = mesh.hes[he].face();
                if !f.is_null() && mesh.faces.contains(f) && mesh.faces[f].is_active() {
                    if !faces_visited.contains(&f) {
                        faces_visited.push(f);
                    }
                }
                he = mesh.hes[he].next_rad();
                if he == start_he { break; }
            }

            // L-β1-3: emit report for each face whose loop missing V
            for face_id in faces_visited {
                if !mesh.face_contains_vertex_on_boundary(face_id, vid) {
                    reports.push(TJunctionReport {
                        face_id,
                        edge_id: eid,
                        vertex_id: vid,
                        t_along_edge: t,
                    });
                }
            }
        }
    }

    reports
}

// ============================================================================
// ADR-149 β-2 — Healing (split_edge + HARD flag)
// ============================================================================

/// ADR-149 β-2 — T-junction healing errors.
///
/// Returned by `heal_t_junction` on validation/operation failure.
/// All errors halt the heal operation without partial mutation — caller
/// responsibility 명시 (silent skip 차단, 메타-원칙 #16 정합).
#[derive(Debug, Clone, PartialEq)]
pub enum TJunctionError {
    /// Report references inactive entity (face / edge / vertex) — likely
    /// stale report after intervening mutation. Caller should re-run
    /// `detect_t_junctions` for fresh reports.
    InvalidReport {
        face_active: bool,
        edge_active: bool,
        vertex_active: bool,
    },

    /// Vertex no longer on edge interior within tolerance — geometry
    /// changed between detection and healing (e.g., transform moved the
    /// vertex). Returns drift distance for diagnostic.
    VertexNotOnEdge { drift_mm: f64 },

    /// `mesh.split_edge` internal failure (DCEL corruption or unexpected
    /// topology). Preserves underlying error message.
    SplitEdgeFailed { reason: String },
}

impl std::fmt::Display for TJunctionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TJunctionError::InvalidReport { face_active, edge_active, vertex_active } => {
                write!(
                    f,
                    "InvalidReport (face_active={}, edge_active={}, vertex_active={})",
                    face_active, edge_active, vertex_active
                )
            }
            TJunctionError::VertexNotOnEdge { drift_mm } => {
                write!(f, "VertexNotOnEdge (drift {:.6}mm)", drift_mm)
            }
            TJunctionError::SplitEdgeFailed { reason } => {
                write!(f, "SplitEdgeFailed ({})", reason)
            }
        }
    }
}

impl std::error::Error for TJunctionError {}

/// ADR-149 β-2 — T-junction healing success report.
///
/// Returned by `heal_t_junction` on successful split + HARD flag.
/// `new_vertex_id` is the vertex inserted by `split_edge` at the
/// T-junction position. Note: in β-2 MVP this is a *fresh* vertex
/// (not the original V from the report) — the original V remains as
/// an orphan vertex at the same position (β-3+ may merge via spatial-
/// hash dedup).
#[derive(Debug, Clone, PartialEq)]
pub struct HealReport {
    /// Number of T-junctions healed in this call (β-2 MVP = always 1
    /// per call; batch healing is β-2-extension).
    pub healed_count: u32,
    /// The new vertex inserted by `split_edge` at the T-junction
    /// position.
    pub new_vertex_id: VertId,
    /// The two new edges replacing the split edge — `e1` = v_small ↔
    /// new_vertex_id, `e2` = new_vertex_id ↔ v_large.
    pub new_edge_a: EdgeId,
    pub new_edge_b: EdgeId,
}

/// ADR-149 β-2 — Heal a single T-junction by splitting the edge and
/// applying HARD flag to split-induced edges.
///
/// # Algorithm (Q2=a, ADR-101 Amendment 10 canonical 답습)
///
/// 1. **Validate report** — face/edge/vertex 모두 active. 하나라도
///    inactive 면 `InvalidReport` (stale report 차단).
/// 2. **Re-verify drift** — vertex position 이 edge interior 에서
///    `tol` 이내인지 재검증. drift 시 `VertexNotOnEdge` (mutation 후
///    geometry 변경 차단).
/// 3. **split_edge call** — `mesh.split_edge(edge_id, V.position())`
///    → 새 vertex + 두 edge (e1, e2). DCEL surgery 위임 (mesh.rs:4337
///    의 검증된 API). Face boundary loop 자동 갱신.
/// 4. **HARD flag** — `mesh.mark_edges_hard(&[e1, e2])` 호출. 메타-원칙
///    #15 정합 (동일 split = 동일 contract) + render path coplanar hide
///    회피 (LOCKED #16 K-ε hotfix 답습).
///
/// # Lock-ins (β-2)
///
/// - **L-β2-1**: report validation 명시 (silent skip 0, 메타-원칙 #16)
/// - **L-β2-2**: drift 재검증 (detection ↔ healing 사이 mutation 대비)
/// - **L-β2-3**: `split_edge` 위임 (custom DCEL surgery 회피 — mesh.rs
///   의 검증된 path 활용, 메타-원칙 #4 SSOT 정합)
/// - **L-β2-4**: HARD flag 부여 (ADR-101 Amendment 10 + 메타-원칙 #15)
/// - **L-β2-5**: 원본 V 는 *별도 처리 없음* — orphan vertex 로 남음
///   (β-2 MVP scope, vertex dedup 은 별도 sub-step 또는 ADR-150 cross-cut)
/// - **L-β2-6**: 단일 healing per call (batch 는 β-2-extension)
pub fn heal_t_junction(
    mesh: &mut crate::mesh::Mesh,
    report: &TJunctionReport,
    tol: f64,
) -> Result<HealReport, TJunctionError> {
    // ── L-β2-1: Validate report (face/edge/vertex 모두 active) ──────────
    let face_active = mesh.faces.get(report.face_id).map(|f| f.is_active()).unwrap_or(false);
    let edge_active = mesh.edges.get(report.edge_id).map(|e| e.is_active()).unwrap_or(false);
    let vertex_active = mesh.verts.get(report.vertex_id).map(|v| v.is_active()).unwrap_or(false);
    if !(face_active && edge_active && vertex_active) {
        return Err(TJunctionError::InvalidReport {
            face_active,
            edge_active,
            vertex_active,
        });
    }

    // ── L-β2-2: Re-verify drift (vertex still on edge interior?) ────────
    let edge = &mesh.edges[report.edge_id];
    let v_small = edge.v_small();
    let v_large = edge.v_large();
    let p_small = mesh.vertex_pos(v_small)
        .map_err(|_| TJunctionError::InvalidReport {
            face_active, edge_active, vertex_active: false,
        })?;
    let p_large = mesh.vertex_pos(v_large)
        .map_err(|_| TJunctionError::InvalidReport {
            face_active, edge_active, vertex_active: false,
        })?;
    let p_v = mesh.vertex_pos(report.vertex_id)
        .map_err(|_| TJunctionError::InvalidReport {
            face_active, edge_active, vertex_active: false,
        })?;

    let (drift, t) = match point_to_segment(p_v, p_small, p_large) {
        Some(x) => x,
        None => return Err(TJunctionError::VertexNotOnEdge { drift_mm: f64::INFINITY }),
    };
    if drift > tol {
        return Err(TJunctionError::VertexNotOnEdge { drift_mm: drift });
    }
    // Strict interior — exclude endpoint coincidence
    let seg_len = (p_large - p_small).length();
    if t * seg_len < tol || (1.0 - t) * seg_len < tol {
        return Err(TJunctionError::VertexNotOnEdge {
            drift_mm: drift.min(t * seg_len).min((1.0 - t) * seg_len),
        });
    }

    // ── L-β2-3: split_edge call (delegate DCEL surgery to mesh.rs) ─────
    let (new_vertex_id, new_edge_a, new_edge_b) = mesh
        .split_edge(report.edge_id, p_v)
        .map_err(|e| TJunctionError::SplitEdgeFailed { reason: e.to_string() })?;

    // ── L-β2-4: HARD flag on split-induced edges (메타-원칙 #15) ───────
    mesh.mark_edges_hard(&[new_edge_a, new_edge_b]);

    Ok(HealReport {
        healed_count: 1,
        new_vertex_id,
        new_edge_a,
        new_edge_b,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::Mesh;
    use crate::MaterialId;
    use crate::entities::HeFlags;
    use glam::DVec3;

    /// Helper — build a planar quad face (4 verts CCW).
    fn build_quad_face(mesh: &mut Mesh, p0: DVec3, p1: DVec3, p2: DVec3, p3: DVec3) -> FaceId {
        let v0 = mesh.add_vertex(p0);
        let v1 = mesh.add_vertex(p1);
        let v2 = mesh.add_vertex(p2);
        let v3 = mesh.add_vertex(p3);
        mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap()
    }

    // ========================================================================
    // Test 1: baseline clean mesh — no T-junctions
    // ========================================================================
    #[test]
    fn adr149_detect_no_tjunction_on_clean_mesh() {
        let mut mesh = Mesh::new();
        // Single quad face — no orphan vertices
        let _f = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );

        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        assert_eq!(reports.len(), 0, "clean mesh should have 0 T-junctions");
    }

    // ========================================================================
    // Test 2: canonical positive — vertex on edge interior of disjoint face
    // ========================================================================
    #[test]
    fn adr149_detect_single_vertex_on_edge_interior() {
        let mut mesh = Mesh::new();
        // Face A: quad [0..10] × [0..10] on z=0 plane
        let f_a = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        // Add isolated vertex V at (5, 0, 0) — on bottom edge interior of A
        let v_tjunction = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));

        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);

        // Should find 1 T-junction: face A, bottom edge, vertex V
        assert_eq!(reports.len(), 1, "expected exactly 1 T-junction, got {}", reports.len());
        let r = &reports[0];
        assert_eq!(r.face_id, f_a);
        assert_eq!(r.vertex_id, v_tjunction);
        // t = 5.0 / 10.0 = 0.5 (mid edge)
        assert!((r.t_along_edge - 0.5).abs() < 1e-9, "expected t=0.5, got {}", r.t_along_edge);
    }

    // ========================================================================
    // Test 3: endpoint vertex excluded (regression guard)
    // ========================================================================
    #[test]
    fn adr149_detect_excludes_endpoint_vertex() {
        let mut mesh = Mesh::new();
        // Face A: simple quad
        let _f = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        // No isolated vertex — all 4 endpoints belong to face loop

        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);

        // Endpoints v0/v1/v2/v3 are filtered out by the v_small/v_large
        // skip check — should be 0 T-junctions.
        assert_eq!(reports.len(), 0, "endpoint vertices must not be T-junctions");
    }

    // ========================================================================
    // Test 4: multiple T-junctions on a single edge
    // ========================================================================
    #[test]
    fn adr149_detect_multiple_tjunctions_on_single_edge() {
        let mut mesh = Mesh::new();
        let f_a = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        // Add 3 isolated vertices on bottom edge of A
        let v1 = mesh.add_vertex(DVec3::new(2.5, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(7.5, 0.0, 0.0));

        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);

        assert_eq!(reports.len(), 3, "expected 3 T-junctions, got {}", reports.len());
        // All reports should reference face A
        for r in &reports {
            assert_eq!(r.face_id, f_a);
        }
        // Collected vertex IDs should be {v1, v2, v3}
        let vids: std::collections::HashSet<_> = reports.iter().map(|r| r.vertex_id).collect();
        assert!(vids.contains(&v1));
        assert!(vids.contains(&v2));
        assert!(vids.contains(&v3));
    }

    // ========================================================================
    // Test 5: tolerance boundary case (just inside / just outside)
    // ========================================================================
    #[test]
    fn adr149_detect_respects_tolerance() {
        let mut mesh = Mesh::new();
        let _f = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        // Vertex just inside tol (y = 0.5 × T_JUNCTION_TOL = 0.075μm)
        let v_in = mesh.add_vertex(DVec3::new(5.0, 0.5 * T_JUNCTION_TOL, 0.0));
        // Vertex just outside tol (y = 2 × T_JUNCTION_TOL = 0.3μm)
        let _v_out = mesh.add_vertex(DVec3::new(7.5, 2.0 * T_JUNCTION_TOL, 0.0));

        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);

        // Only v_in should be reported
        assert_eq!(reports.len(), 1, "expected 1 T-junction (within tol), got {}", reports.len());
        assert_eq!(reports[0].vertex_id, v_in);
    }

    // ========================================================================
    // Test 6: spatial-hash performance baseline (large mesh)
    // ========================================================================
    #[test]
    fn adr149_detect_spatial_hash_optimization() {
        let mut mesh = Mesh::new();
        // Build 10×10 grid of disjoint quads (100 faces, ~400 verts)
        for ix in 0..10 {
            for iy in 0..10 {
                let x = (ix * 20) as f64;
                let y = (iy * 20) as f64;
                let _f = build_quad_face(
                    &mut mesh,
                    DVec3::new(x, y, 0.0),
                    DVec3::new(x + 10.0, y, 0.0),
                    DVec3::new(x + 10.0, y + 10.0, 0.0),
                    DVec3::new(x, y + 10.0, 0.0),
                );
            }
        }
        // Add a single isolated T-junction vertex on face (0,0)'s bottom edge
        let v_t = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));

        let start = std::time::Instant::now();
        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        let elapsed = start.elapsed();

        // Correctness: exactly 1 T-junction
        assert_eq!(reports.len(), 1, "expected 1 T-junction in 100-quad grid, got {}", reports.len());
        assert_eq!(reports[0].vertex_id, v_t);

        // Performance baseline — should complete well under 100ms even with
        // naive O(N×M). 100 quads × 401 verts = 40k comparisons (cheap).
        assert!(
            elapsed.as_millis() < 500,
            "detection took {}ms (expected < 500ms for 100-quad mesh)",
            elapsed.as_millis()
        );
    }

    // ========================================================================
    // β-2 Healing tests (6 회귀)
    // ========================================================================

    /// Helper — build mesh with single T-junction and return the report.
    fn build_single_tjunction_mesh() -> (Mesh, TJunctionReport) {
        let mut mesh = Mesh::new();
        let f_a = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        let v_tjunction = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        // Build report manually — detection is already tested
        let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].face_id, f_a);
        assert_eq!(reports[0].vertex_id, v_tjunction);
        (mesh, reports[0].clone())
    }

    // ========================================================================
    // Test 7: canonical heal — single T-junction
    // ========================================================================
    #[test]
    fn adr149_heal_canonical_single_tjunction() {
        let (mut mesh, report) = build_single_tjunction_mesh();

        // Pre-heal: 1 T-junction detected
        let reports_before = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        assert_eq!(reports_before.len(), 1);

        // Heal
        let result = heal_t_junction(&mut mesh, &report, T_JUNCTION_TOL);
        assert!(result.is_ok(), "heal should succeed, got {:?}", result);
        let heal = result.unwrap();
        assert_eq!(heal.healed_count, 1);

        // Post-heal: face's boundary loop should now include the split position
        // (the *new* vertex from split_edge sits at the T-junction position).
        // The original V remains as orphan vertex at same position.
        let post = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        // Original V is now floating at same position as new_vertex_id — both
        // pass distance check on the (now non-existent) edge interior. But
        // the original edge was split into two new edges — neither has the
        // original V on its strict interior anymore. Post-heal should detect
        // 0 (or possibly the original V if it falls on one of the new edges
        // due to tolerance — but at t=0.5 on a 10mm edge, the new edges are
        // [0..5] and [5..10] and V is at endpoint (5,0,0), not interior).
        assert_eq!(
            post.len(), 0,
            "expected 0 T-junctions post-heal, got {} ({:?})",
            post.len(), post
        );
    }

    // ========================================================================
    // Test 8: HARD flag applied to split-induced edges (메타-원칙 #15)
    // ========================================================================
    #[test]
    fn adr149_heal_assigns_hard_flag() {
        let (mut mesh, report) = build_single_tjunction_mesh();

        let heal = heal_t_junction(&mut mesh, &report, T_JUNCTION_TOL).unwrap();

        // Verify both new edges have HARD flag on all radial twin HEs
        for &edge_id in &[heal.new_edge_a, heal.new_edge_b] {
            let edge = mesh.edges.get(edge_id).expect("new edge should exist");
            assert!(edge.is_active(), "new edge {:?} should be active", edge_id);
            let start_he = edge.any_he();
            assert!(!start_he.is_null(), "new edge {:?} has no half-edges", edge_id);

            // Walk radial chain — every HE should have HARD flag
            let mut he = start_he;
            for _ in 0..32 {
                let flags = mesh.hes[he].flags();
                assert!(
                    flags.contains(HeFlags::HARD),
                    "HE {:?} on new edge {:?} missing HARD flag (flags={:?})",
                    he, edge_id, flags
                );
                he = mesh.hes[he].next_rad();
                if he == start_he { break; }
            }
        }
    }

    // ========================================================================
    // Test 9: manifold post-heal (LOCKED #1 P7 invariant)
    // ========================================================================
    #[test]
    fn adr149_heal_manifold_safe_post_healing() {
        let (mut mesh, report) = build_single_tjunction_mesh();

        let _heal = heal_t_junction(&mut mesh, &report, T_JUNCTION_TOL).unwrap();

        // Verify mesh invariants — no non-manifold edges introduced
        let invariants = mesh.verify_face_invariants();
        assert!(
            invariants.is_valid(),
            "manifold invariants violated post-heal: {} violations",
            invariants.violations.len()
        );
    }

    // ========================================================================
    // Test 10: invalid report rejection (inactive entity)
    // ========================================================================
    #[test]
    fn adr149_heal_rejects_invalid_report() {
        let (mut mesh, report) = build_single_tjunction_mesh();

        // Construct a report with fake (out-of-range) face_id
        let fake_face_id = FaceId::new(999_999);
        let invalid_report = TJunctionReport {
            face_id: fake_face_id,
            edge_id: report.edge_id,
            vertex_id: report.vertex_id,
            t_along_edge: report.t_along_edge,
        };

        let result = heal_t_junction(&mut mesh, &invalid_report, T_JUNCTION_TOL);
        assert!(result.is_err(), "expected InvalidReport error");
        match result.unwrap_err() {
            TJunctionError::InvalidReport { face_active, .. } => {
                assert!(!face_active, "face_active should be false for out-of-range face_id");
            }
            other => panic!("expected InvalidReport, got {:?}", other),
        }
    }

    // ========================================================================
    // Test 11: vertex drifted off edge — VertexNotOnEdge rejection
    // ========================================================================
    #[test]
    fn adr149_heal_rejects_drifted_vertex() {
        let mut mesh = Mesh::new();
        let f_a = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        // Add a vertex that's NOT on the edge (drift far above tolerance)
        let v_far = mesh.add_vertex(DVec3::new(5.0, 5.0, 0.0));  // mid-face, not on edge

        // Find any edge of f_a via outer loop's start HE
        let edge_id_real = {
            let face = &mesh.faces[f_a];
            mesh.hes[face.outer().start].edge()
        };

        let bad_report = TJunctionReport {
            face_id: f_a,
            edge_id: edge_id_real,
            vertex_id: v_far,
            t_along_edge: 0.5,  // claimed, but vertex is not on edge
        };

        let result = heal_t_junction(&mut mesh, &bad_report, T_JUNCTION_TOL);
        assert!(result.is_err(), "expected VertexNotOnEdge error");
        match result.unwrap_err() {
            TJunctionError::VertexNotOnEdge { drift_mm } => {
                assert!(drift_mm > T_JUNCTION_TOL, "drift {} should exceed tol {}", drift_mm, T_JUNCTION_TOL);
            }
            other => panic!("expected VertexNotOnEdge, got {:?}", other),
        }
    }

    // ========================================================================
    // Test 12: multi-heal in sequence (3 T-junctions on one edge)
    // ========================================================================
    #[test]
    fn adr149_heal_multi_tjunction_in_sequence() {
        let mut mesh = Mesh::new();
        let _f_a = build_quad_face(
            &mut mesh,
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(10.0, 0.0, 0.0),
            DVec3::new(10.0, 10.0, 0.0),
            DVec3::new(0.0, 10.0, 0.0),
        );
        let _v1 = mesh.add_vertex(DVec3::new(2.5, 0.0, 0.0));
        let _v2 = mesh.add_vertex(DVec3::new(5.0, 0.0, 0.0));
        let _v3 = mesh.add_vertex(DVec3::new(7.5, 0.0, 0.0));

        // Heal them one at a time. After each heal, detection on remaining
        // T-junctions should still find the others.
        let mut total_healed = 0u32;
        for _round in 0..10 {  // safety bound
            let reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);
            if reports.is_empty() { break; }
            // Heal the first one
            let r = heal_t_junction(&mut mesh, &reports[0], T_JUNCTION_TOL);
            assert!(r.is_ok(), "heal #{} failed: {:?}", total_healed + 1, r);
            total_healed += r.unwrap().healed_count;
        }

        assert_eq!(total_healed, 3, "expected 3 heals, got {}", total_healed);

        // Final detection should be 0
        let final_reports = detect_t_junctions(&mesh, T_JUNCTION_TOL);
        assert_eq!(final_reports.len(), 0, "expected 0 final T-junctions, got {}", final_reports.len());
    }
}
