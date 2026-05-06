//! Offset Operation — face 경계를 안쪽/바깥쪽으로 일정 거리만큼 이동.
//!
//! 건축 모델링에서 벽 두께, 창문 틀 등을 만들 때 필수적인 기능.
//! SketchUp의 Offset 도구와 동일한 개념.
//!
//! 알고리즘:
//! 1. face의 외곽 loop vertex를 수집
//! 2. face 법선 평면에서 각 변을 inward/outward로 offset
//! 3. 인접 offset 선분의 교점 → 새 polygon
//! 4. offset face + 원본↔offset 사이 strip face 생성

use glam::DVec3;
use anyhow::{Result, bail};

use crate::mesh::Mesh;
use crate::{FaceId, EdgeId, VertId};
use crate::curves::AnalyticCurve;
use crate::surfaces::AnalyticSurface;

/// Offset 결과
#[derive(Debug)]
pub struct OffsetResult {
    /// 새로 생성된 inner(offset) face
    pub inner_face: FaceId,
    /// 원본↔offset 사이 strip face 목록
    pub strip_faces: Vec<FaceId>,
    /// 원본 face (그대로 유지 — offset 방향에 따라 outer 또는 삭제)
    pub original_face: FaceId,
}

/// Line Offset 결과
#[derive(Debug)]
pub struct OffsetEdgeResult {
    /// 새로 생성된 평행 edge의 두 정점
    pub new_v0: VertId,
    pub new_v1: VertId,
    /// 새 edge ID
    pub new_edge: EdgeId,
}

/// ADR-080 V-β-α — Typed errors for `offset_edge_on_host_face`.
///
/// Categorized so that callers (Bridge / OffsetTool / future MCP surface)
/// can dispatch on the failure mode without string parsing. Variants
/// `UnsupportedHostSurface` and `UnsupportedCurveKind` are explicit
/// "not yet" markers — they signal V-β-β / V-β-γ / W-3 work, not bugs.
#[derive(Debug, thiserror::Error)]
pub enum OffsetEdgeError {
    #[error("offset_edge: edge {0:?} not found")]
    EdgeNotFound(EdgeId),
    #[error("offset_edge: edge {0:?} is inactive")]
    EdgeInactive(EdgeId),
    #[error("offset_edge: distance {0} below epsilon")]
    DegenerateDistance(f64),
    /// No active incident face — free wire. V-δ scope.
    #[error("offset_edge: edge has no incident active face (free wire — V-δ scope)")]
    NoIncidentFace,
    /// 2+ incident faces with conflicting host surfaces.
    #[error("offset_edge: ambiguous host face — {n_faces} candidates with conflicting surfaces")]
    AmbiguousHostFace { n_faces: usize },
    /// Host face has hole loops (ADR-016 Q2 / ADR-080 L8).
    #[error("offset_edge: host face {0:?} has hole loops (multi-loop face rejected)")]
    MultiLoopHostFace(FaceId),
    /// Host surface is not yet supported (Cylinder/Sphere/Cone/Torus → V-β-γ scope).
    #[error("offset_edge: host surface kind {kind} not yet supported (V-β-γ scope)")]
    UnsupportedHostSurface { kind: &'static str },
    /// Curve kind not yet supported in V-β-α (Arc/Circle → V-β-β; Bezier/etc → W-3).
    #[error("offset_edge: curve kind {kind} not yet supported in V-β-α")]
    UnsupportedCurveKind { kind: &'static str },
    /// Edge direction parallel to host normal — perpendicular offset undefined.
    #[error("offset_edge: edge direction parallel to host face normal")]
    EdgeParallelToNormal,
    /// Host face has no analytic surface attached (W-2 / Phase N invariant violated).
    #[error("offset_edge: host face {0:?} has no analytic surface attached")]
    NoHostSurface(FaceId),
    /// Arc/Circle plane is not coplanar with host face plane (V-β-β).
    /// arc.normal ∦ face.normal, or arc.center off the host plane.
    #[error("offset_edge: arc/circle plane mismatches host face plane (V-β-β)")]
    ArcPlaneMismatch,
    /// Offset would collapse the arc/circle radius to ≤ 0.
    #[error("offset_edge: arc/circle radius would collapse to {new_r} (current {current_r}, dist {dist})")]
    RadiusCollapse { current_r: f64, new_r: f64, dist: f64 },
    /// Curved host surface in V-β-γ scope, but the curve type doesn't
    /// fit the surface's natural offset semantics (e.g., helical line on
    /// cylinder, off-axis arc).
    #[error("offset_edge: curve {curve_kind} cannot be offset on {surface_kind} host")]
    UnsupportedCurveOnSurface {
        surface_kind: &'static str,
        curve_kind: &'static str,
    },
    /// New axial position falls outside the host surface's v_range.
    #[error("offset_edge: new axial position {new_v} outside host v_range [{v_min}, {v_max}]")]
    AxialOutOfRange { new_v: f64, v_min: f64, v_max: f64 },
}

impl Mesh {
    // ════════════════════════════════════════════════════════════════
    // Line (Edge) Offset
    // ════════════════════════════════════════════════════════════════

    /// edge를 평면 위에서 dist만큼 평행 이동하여 새 edge를 만들고,
    /// 원본 + 새 edge를 연결하여 사각형 face를 생성.
    ///
    /// - `edge_id`: offset할 원본 edge
    /// - `dist`: 오프셋 거리 (양수 = edge 방향 × 법선의 cross 방향, 음수 = 반대)
    /// - `plane_normal`: 참조 평면의 법선 (보통 Y-up = (0,1,0))
    /// - `material`: 생성될 face의 재질
    ///
    /// 결과: 새 edge + 사각형 face
    pub fn offset_edge(
        &mut self,
        edge_id: EdgeId,
        dist: f64,
        plane_normal: DVec3,
    ) -> Result<OffsetEdgeResult> {
        if dist.abs() < 1e-6 {
            bail!("Offset distance too small");
        }

        let edge = self.edges.get(edge_id)
            .ok_or_else(|| anyhow::anyhow!("Edge {:?} not found", edge_id))?;

        if !edge.is_active() {
            bail!("Edge {:?} is not active", edge_id);
        }

        let v0 = edge.v_small();
        let v1 = edge.v_large();
        let p0 = self.vertex_pos(v0)?;
        let p1 = self.vertex_pos(v1)?;

        // offset 방향 계산: edge 방향 × 평면 법선
        let edge_dir = (p1 - p0).normalize();
        let fn_norm = plane_normal.normalize();
        let offset_dir = edge_dir.cross(fn_norm).normalize();

        if offset_dir.length() < 1e-6 {
            bail!("Edge is parallel to plane normal, cannot determine offset direction");
        }

        // 새 정점 생성 (평행 복사만 — 면은 만들지 않음, CAD 스타일)
        let new_p0 = p0 + offset_dir * dist;
        let new_p1 = p1 + offset_dir * dist;
        let new_v0 = self.add_vertex(new_p0);
        let new_v1 = self.add_vertex(new_p1);

        // 새 edge만 생성 (선의 평행 복사)
        let (new_edge, _) = self.add_edge(new_v0, new_v1)?;

        Ok(OffsetEdgeResult {
            new_v0,
            new_v1,
            new_edge,
        })
    }

    /// ADR-080 V-β-α — Edge offset using host face's surface as reference.
    ///
    /// Replaces the legacy `offset_edge(edge, dist, plane_normal)` callers'
    /// need to pass `plane_normal` themselves. The host face is auto-resolved
    /// from the edge's incident faces:
    ///   - 1 active incident face → that face is the host.
    ///   - 2+ incident faces all sharing the same Plane (coplanar within
    ///     EPSILON_LENGTH) → either plane is fine; pick first.
    ///   - 0 → `NoIncidentFace` (V-δ scope).
    ///   - 2+ with conflicting surfaces → `AmbiguousHostFace`.
    ///
    /// Curve kind dispatch (§V2-C):
    ///   - `None` (synthesized line) or `AnalyticCurve::Line` → perpendicular
    ///     offset using face normal × edge_dir (existing semantics, but
    ///     normal source = face surface, not caller).
    ///   - `Arc` / `Circle` / Bezier / B-spline / NURBS → `UnsupportedCurveKind`
    ///     (V-β-β / W-3 scope).
    ///
    /// Host surface scope (§V2-D):
    ///   - Plane → fully supported.
    ///   - Cylinder / Sphere / Cone / Torus → `UnsupportedHostSurface`
    ///     (V-β-γ scope).
    ///   - NURBS-class → `UnsupportedHostSurface` (W-3 scope).
    ///
    /// Multi-loop guard (§V2-H, ADR-016 Q2 / ADR-080 L8):
    ///   - Host face with hole loops → `MultiLoopHostFace`.
    ///
    /// Output (§V2-E): same `OffsetEdgeResult` as legacy `offset_edge`.
    /// Returns the typed `OffsetEdgeError` on failure for caller dispatch.
    pub fn offset_edge_on_host_face(
        &mut self,
        edge_id: EdgeId,
        dist: f64,
    ) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
        if dist.abs() < 1e-6 {
            return Err(OffsetEdgeError::DegenerateDistance(dist));
        }

        let edge = self
            .edges
            .get(edge_id)
            .ok_or(OffsetEdgeError::EdgeNotFound(edge_id))?;
        if !edge.is_active() {
            return Err(OffsetEdgeError::EdgeInactive(edge_id));
        }
        let v0 = edge.v_small();
        let v1 = edge.v_large();
        let edge_curve = edge.curve().cloned();

        // §V2-C — Curve kind dispatch.
        // V-β-α: Line + None.    V-β-β: Arc + Circle.
        // Bezier/B-spline/NURBS still defer (W-3 / V-β-δ scope).
        match &edge_curve {
            None
            | Some(AnalyticCurve::Line { .. })
            | Some(AnalyticCurve::Arc { .. })
            | Some(AnalyticCurve::Circle { .. }) => {
                // OK — fall through to dispatch by kind below.
            }
            Some(c) => {
                let kind = match c {
                    AnalyticCurve::Bezier { .. } => "Bezier",
                    AnalyticCurve::BSpline { .. } => "BSpline",
                    AnalyticCurve::NURBS { .. } => "NURBS",
                    _ => unreachable!(),
                };
                return Err(OffsetEdgeError::UnsupportedCurveKind { kind });
            }
        }

        // §V2-B — Host face resolution.
        let (incident_faces, _hes) = self.get_faces_sharing_edge(edge_id);
        let host = match incident_faces.len() {
            0 => return Err(OffsetEdgeError::NoIncidentFace),
            1 => incident_faces[0],
            _n => {
                // Pick first; verify all share the same surface kind/instance
                // (within EPSILON_LENGTH for Plane). Else AmbiguousHostFace.
                let first = incident_faces[0];
                let first_surface = self
                    .faces
                    .get(first)
                    .and_then(|f| f.surface().cloned());
                let mut all_match = true;
                for &fid in &incident_faces[1..] {
                    let other = self.faces.get(fid).and_then(|f| f.surface().cloned());
                    if !surfaces_equivalent(&first_surface, &other) {
                        all_match = false;
                        break;
                    }
                }
                if !all_match {
                    return Err(OffsetEdgeError::AmbiguousHostFace {
                        n_faces: incident_faces.len(),
                    });
                }
                first
            }
        };

        // §V2-H — Multi-loop guard.
        let host_face = self
            .faces
            .get(host)
            .ok_or(OffsetEdgeError::EdgeNotFound(edge_id))?;
        if !host_face.inners().is_empty() {
            return Err(OffsetEdgeError::MultiLoopHostFace(host));
        }

        // §V2-D — Host surface dispatch.
        // V-β-α/β: Plane.   V-β-γ-1: Cylinder.
        // Sphere/Cone/Torus → V-β-γ-2/3/4 (still UnsupportedHostSurface).
        let host_surface = host_face
            .surface()
            .cloned()
            .ok_or(OffsetEdgeError::NoHostSurface(host))?;
        let host_normal = match &host_surface {
            AnalyticSurface::Plane { normal, .. } => normal.normalize_or_zero(),
            AnalyticSurface::Cylinder { .. } => {
                // V-β-γ-1: dispatch to cylinder-specific offset path.
                return self.offset_edge_on_cylinder(
                    edge_id,
                    v0,
                    v1,
                    edge_curve,
                    &host_surface,
                    dist,
                );
            }
            AnalyticSurface::Sphere { .. } => {
                // V-β-γ-2: dispatch to sphere-specific offset path.
                return self.offset_edge_on_sphere(
                    edge_id,
                    v0,
                    v1,
                    edge_curve,
                    &host_surface,
                    dist,
                );
            }
            AnalyticSurface::Cone { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Cone" });
            }
            AnalyticSurface::Torus { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "Torus" });
            }
            AnalyticSurface::BezierPatch { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "BezierPatch" });
            }
            AnalyticSurface::BSplineSurface { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "BSplineSurface" });
            }
            AnalyticSurface::NURBSSurface { .. } => {
                return Err(OffsetEdgeError::UnsupportedHostSurface { kind: "NURBSSurface" });
            }
        };
        if host_normal.length_squared() < 0.5 {
            return Err(OffsetEdgeError::NoHostSurface(host));
        }

        // §V2-β — Arc / Circle dispatch (V-β-β: analytic radius offset).
        match &edge_curve {
            Some(AnalyticCurve::Arc {
                center,
                radius,
                normal,
                basis_u,
                start_angle,
                end_angle,
            }) => {
                return self.offset_arc_on_plane(
                    edge_id,
                    *center,
                    *radius,
                    *normal,
                    *basis_u,
                    Some((*start_angle, *end_angle)),
                    host_normal,
                    dist,
                );
            }
            Some(AnalyticCurve::Circle {
                center,
                radius,
                normal,
                basis_u,
            }) => {
                return self.offset_arc_on_plane(
                    edge_id,
                    *center,
                    *radius,
                    *normal,
                    *basis_u,
                    None,
                    host_normal,
                    dist,
                );
            }
            _ => {} // Line / None — fall through.
        }

        // §V2-C continued — Line perpendicular offset on Plane.
        let p0 = self
            .vertex_pos(v0)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
        let p1 = self
            .vertex_pos(v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
        let edge_vec = p1 - p0;
        if edge_vec.length_squared() < 1e-12 {
            return Err(OffsetEdgeError::DegenerateDistance(0.0));
        }
        let edge_dir = edge_vec.normalize();
        let offset_dir = edge_dir.cross(host_normal);
        if offset_dir.length_squared() < 1e-12 {
            return Err(OffsetEdgeError::EdgeParallelToNormal);
        }
        let offset_dir = offset_dir.normalize();

        let new_p0 = p0 + offset_dir * dist;
        let new_p1 = p1 + offset_dir * dist;
        let new_v0 = self.add_vertex(new_p0);
        let new_v1 = self.add_vertex(new_p1);
        let (new_edge, _) = self
            .add_edge(new_v0, new_v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

        Ok(OffsetEdgeResult {
            new_v0,
            new_v1,
            new_edge,
        })
    }

    /// ADR-080 V-β-β — Analytic in-plane offset for Arc / Circle on a
    /// Plane host face.
    ///
    /// Math: every point on the curve P = C + r·(cos(θ)·u + sin(θ)·v)
    /// (where v = normal × basis_u). Offset along the radial direction
    /// in the plane ⇒ P' = C + (r ± dist)·(cos(θ)·u + sin(θ)·v). The
    /// result is the same arc family with new radius `r ± dist`.
    ///
    /// Sign convention (§V2-β-A): positive `dist` always means the right
    /// side of the curve's tangent direction (consistent with Line). At
    /// θ_mid: tangent_dir × host_normal · radial_dir gives ±1; multiply
    /// by `dist` to get signed Δr.
    ///
    /// Sanity (§V2-β-B): arc plane (`normal`) must be parallel to host
    /// face normal AND arc center must lie on the host plane (within
    /// EPSILON_LENGTH). Else `ArcPlaneMismatch`.
    ///
    /// Collapse guard (§V2-β-C): new radius ≤ EPSILON_LENGTH ⇒
    /// `RadiusCollapse`.
    #[allow(clippy::too_many_arguments)]
    fn offset_arc_on_plane(
        &mut self,
        edge_id: EdgeId,
        center: DVec3,
        radius: f64,
        arc_normal: DVec3,
        basis_u: DVec3,
        angles: Option<(f64, f64)>,
        host_normal: DVec3,
        dist: f64,
    ) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
        let tol = crate::tolerances::EPSILON_LENGTH;
        let arc_n_unit = arc_normal.normalize_or_zero();
        let host_n_unit = host_normal.normalize_or_zero();

        // §V2-β-B — sanity: arc plane ‖ host plane.
        if arc_n_unit.dot(host_n_unit).abs() < 0.999 {
            return Err(OffsetEdgeError::ArcPlaneMismatch);
        }
        // basis_u must be in-plane (perpendicular to arc normal).
        let basis_u_unit = basis_u.normalize_or_zero();
        if basis_u_unit.dot(arc_n_unit).abs() > 0.001 {
            return Err(OffsetEdgeError::ArcPlaneMismatch);
        }

        // Sign of dist: positive = right-side of tangent (consistent with
        // Line offset). At θ_mid:
        //   tangent_dir = -sin(θ_mid)·u + cos(θ_mid)·v  (v = n × u)
        //   right_side  = tangent_dir × host_normal
        //   radial_dir  = cos(θ_mid)·u + sin(θ_mid)·v
        //   sign = sign(right_side · radial_dir)
        let basis_v = arc_n_unit.cross(basis_u_unit);
        let theta_mid = match angles {
            Some((s, e)) => (s + e) * 0.5,
            None => 0.0, // Circle — pick θ=0, sign convention irrelevant by symmetry
        };
        let tangent =
            -theta_mid.sin() * basis_u_unit + theta_mid.cos() * basis_v;
        let right_side = tangent.cross(host_n_unit);
        let radial =
            theta_mid.cos() * basis_u_unit + theta_mid.sin() * basis_v;
        let sign = if right_side.dot(radial) > 0.0 { 1.0 } else { -1.0 };

        let new_radius = radius + sign * dist;
        if new_radius <= tol {
            return Err(OffsetEdgeError::RadiusCollapse {
                current_r: radius,
                new_r: new_radius,
                dist,
            });
        }

        // Compute new endpoint positions.
        let (theta_start, theta_end) = match angles {
            Some((s, e)) => (s, e),
            None => (0.0, std::f64::consts::TAU),
        };
        let pt = |theta: f64| -> DVec3 {
            center + new_radius * (theta.cos() * basis_u_unit + theta.sin() * basis_v)
        };
        let new_p0 = pt(theta_start);
        // For Circle the new edge endpoints are both at θ=0 (degenerate);
        // we still create two distinct verts at the same location to keep
        // DCEL invariants. Practically circles are stored as N sub-arcs,
        // so this branch is only exercised by synthetic single-Circle edges.
        let new_p1 = if angles.is_some() {
            pt(theta_end)
        } else {
            // Circle: use a slightly-different param to give DCEL a 2nd vert.
            // Caller is expected to immediately treat this as a closed loop.
            pt(theta_end - 1e-6)
        };

        let new_v0 = self.add_vertex(new_p0);
        let new_v1 = self.add_vertex(new_p1);
        let (new_edge, _) = self
            .add_edge(new_v0, new_v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

        // Attach the new analytic curve to the new edge.
        let new_curve = match angles {
            Some(_) => AnalyticCurve::Arc {
                center,
                radius: new_radius,
                normal: arc_normal,
                basis_u,
                start_angle: theta_start,
                end_angle: theta_end,
            },
            None => AnalyticCurve::Circle {
                center,
                radius: new_radius,
                normal: arc_normal,
                basis_u,
            },
        };
        if let Some(e) = self.edges.get_mut(new_edge) {
            e.set_curve(Some(new_curve));
        }

        Ok(OffsetEdgeResult {
            new_v0,
            new_v1,
            new_edge,
        })
    }

    /// ADR-080 V-β-γ-1 — Edge offset on a Cylinder host face.
    ///
    /// Two analytic dispatch paths matching the cylinder's natural
    /// curve types:
    ///
    /// 1. **Axial Line** (edge parallel to `cyl.axis_dir`, on cylinder
    ///    surface): offset = angular shift around axis. `Δu = sign·dist /
    ///    radius`, where sign comes from `(edge_dir · axis_dir).signum()`
    ///    so positive `dist` consistently means right-side of edge.
    ///
    /// 2. **Latitude Arc/Circle** (center on axis, normal ‖ axis_dir,
    ///    radius == cylinder.radius): offset = axial shift along
    ///    cylinder axis. `Δv = sign·dist`, sign from
    ///    `(tangent × surface_normal · axis_dir).signum()`.
    ///
    /// Other curve types (helical line, off-axis arc, NURBS, etc.)
    /// return `UnsupportedCurveOnSurface`. Out-of-v_range result returns
    /// `AxialOutOfRange`.
    fn offset_edge_on_cylinder(
        &mut self,
        edge_id: EdgeId,
        v0: VertId,
        v1: VertId,
        edge_curve: Option<AnalyticCurve>,
        host_surface: &AnalyticSurface,
        dist: f64,
    ) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
        let tol = crate::tolerances::EPSILON_LENGTH;
        let (axis_origin, axis_dir, radius, ref_dir, _u_range, v_range) = match host_surface {
            AnalyticSurface::Cylinder {
                axis_origin,
                axis_dir,
                radius,
                ref_dir,
                u_range,
                v_range,
            } => (
                *axis_origin,
                axis_dir.normalize_or_zero(),
                *radius,
                ref_dir.normalize_or_zero(),
                *u_range,
                *v_range,
            ),
            _ => unreachable!("offset_edge_on_cylinder dispatched with non-Cylinder host"),
        };
        if axis_dir.length_squared() < 0.5 || ref_dir.length_squared() < 0.5 {
            return Err(OffsetEdgeError::NoHostSurface(FaceId::new(0)));
        }
        let basis_v = axis_dir.cross(ref_dir);

        let p0 = self
            .vertex_pos(v0)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
        let p1 = self
            .vertex_pos(v1)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

        // ── Latitude Arc / Circle path ─────────────────────────────────
        if let Some(curve) = &edge_curve {
            let (arc_center, arc_radius, arc_normal, basis_u_arc, angles) = match curve {
                AnalyticCurve::Arc {
                    center,
                    radius,
                    normal,
                    basis_u,
                    start_angle,
                    end_angle,
                } => (*center, *radius, *normal, *basis_u, Some((*start_angle, *end_angle))),
                AnalyticCurve::Circle {
                    center,
                    radius,
                    normal,
                    basis_u,
                } => (*center, *radius, *normal, *basis_u, None),
                AnalyticCurve::Line { .. } => {
                    // fall through to line path below
                    return offset_axial_line_on_cylinder(
                        self, edge_id, p0, p1, axis_origin, axis_dir, radius,
                        ref_dir, basis_v, v_range, dist, tol,
                    );
                }
                _ => {
                    let kind = match curve {
                        AnalyticCurve::Bezier { .. } => "Bezier",
                        AnalyticCurve::BSpline { .. } => "BSpline",
                        AnalyticCurve::NURBS { .. } => "NURBS",
                        _ => unreachable!(),
                    };
                    return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                        surface_kind: "Cylinder",
                        curve_kind: kind,
                    });
                }
            };

            // Latitude ring sanity:
            //   - arc center on axis
            //   - arc.normal ‖ axis_dir
            //   - arc.radius == cylinder.radius
            let from_axis = arc_center - axis_origin;
            let v_arc = from_axis.dot(axis_dir);
            let center_off_axis = (from_axis - v_arc * axis_dir).length();
            let arc_n_unit = arc_normal.normalize_or_zero();
            let normal_match = arc_n_unit.dot(axis_dir).abs() > 0.999;
            let radius_match = (arc_radius - radius).abs() < tol;
            if center_off_axis > tol || !normal_match || !radius_match {
                return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                    surface_kind: "Cylinder",
                    curve_kind: if angles.is_some() { "Arc(off-cylinder)" } else { "Circle(off-cylinder)" },
                });
            }

            // Sign of axial shift: tangent at midpoint × surface_normal
            // projected onto axis_dir.
            let theta_mid = match angles {
                Some((s, e)) => (s + e) * 0.5,
                None => 0.0,
            };
            let basis_u_unit = basis_u_arc.normalize_or_zero();
            let basis_v_arc = arc_n_unit.cross(basis_u_unit);
            let tangent =
                -theta_mid.sin() * basis_u_unit + theta_mid.cos() * basis_v_arc;
            // Surface normal at p_mid (radial outward on cylinder).
            let p_mid = arc_center
                + arc_radius * (theta_mid.cos() * basis_u_unit + theta_mid.sin() * basis_v_arc);
            let radial_at_p = (p_mid - axis_origin) - ((p_mid - axis_origin).dot(axis_dir)) * axis_dir;
            if radial_at_p.length_squared() < tol * tol {
                return Err(OffsetEdgeError::EdgeParallelToNormal);
            }
            let n_at_p = radial_at_p.normalize();
            let right_side = tangent.cross(n_at_p);
            let axial_sign = if right_side.dot(axis_dir) > 0.0 { 1.0 } else { -1.0 };
            let delta_v = axial_sign * dist;
            let new_v_axial = v_arc + delta_v;
            if new_v_axial < v_range.0 - tol || new_v_axial > v_range.1 + tol {
                return Err(OffsetEdgeError::AxialOutOfRange {
                    new_v: new_v_axial,
                    v_min: v_range.0,
                    v_max: v_range.1,
                });
            }

            // New arc — center shifted along axis, radius preserved.
            let new_center = arc_center + delta_v * axis_dir;
            let pt = |theta: f64| -> DVec3 {
                new_center + arc_radius * (theta.cos() * basis_u_unit + theta.sin() * basis_v_arc)
            };
            let (new_p0, new_p1) = match angles {
                Some((s, e)) => (pt(s), pt(e)),
                None => (pt(0.0), pt(std::f64::consts::TAU - 1e-6)),
            };
            let new_v0_id = self.add_vertex(new_p0);
            let new_v1_id = self.add_vertex(new_p1);
            let (new_edge, _) = self
                .add_edge(new_v0_id, new_v1_id)
                .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;
            let new_curve = match angles {
                Some((s, e)) => AnalyticCurve::Arc {
                    center: new_center,
                    radius: arc_radius,
                    normal: arc_normal,
                    basis_u: basis_u_arc,
                    start_angle: s,
                    end_angle: e,
                },
                None => AnalyticCurve::Circle {
                    center: new_center,
                    radius: arc_radius,
                    normal: arc_normal,
                    basis_u: basis_u_arc,
                },
            };
            if let Some(e) = self.edges.get_mut(new_edge) {
                e.set_curve(Some(new_curve));
            }
            return Ok(OffsetEdgeResult {
                new_v0: new_v0_id,
                new_v1: new_v1_id,
                new_edge,
            });
        }

        // ── Axial Line path (curve = None) ────────────────────────────
        offset_axial_line_on_cylinder(
            self, edge_id, p0, p1, axis_origin, axis_dir, radius,
            ref_dir, basis_v, v_range, dist, tol,
        )
    }

    /// ADR-080 V-β-γ-2 — Edge offset on a Sphere host face.
    ///
    /// Only Arc/Circle curves are accepted (small circles on sphere,
    /// great-circle as the special case d = 0). Line/None curves are
    /// rejected — a 3D Line segment isn't naturally on a sphere
    /// surface (chord interpretation is ambiguous).
    ///
    /// **Math**: Arc with center C_arc, radius r_arc, normal n_arc lies
    /// on sphere (center C_s, radius R) iff (a) n_arc parallel to
    /// d_vec = C_arc - C_s, AND (b) r² + d² = R² (where d = |d_vec|).
    /// Co-latitude φ = atan2(r, d) ∈ [0, π/2] for arc above sphere
    /// center along d_vec.
    ///
    /// Geodesic offset by `dist`: Δφ = sign·dist/R, where sign comes
    /// from `(tangent × surface_normal · ∂P/∂φ)`.
    ///   - new_d = R·cos(new_φ),  new_r = R·sin(new_φ)
    ///   - new_center = C_s + new_d · polar_axis_unit
    ///   - new_normal preserves arc orientation
    fn offset_edge_on_sphere(
        &mut self,
        edge_id: EdgeId,
        _v0: VertId,
        _v1: VertId,
        edge_curve: Option<AnalyticCurve>,
        host_surface: &AnalyticSurface,
        dist: f64,
    ) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
        let tol = crate::tolerances::EPSILON_LENGTH;
        let (sphere_center, sphere_radius) = match host_surface {
            AnalyticSurface::Sphere { center, radius, .. } => (*center, *radius),
            _ => unreachable!("offset_edge_on_sphere dispatched with non-Sphere host"),
        };

        // V-β-γ-2: Line/None curves rejected on Sphere — chord ambiguity.
        let curve = match &edge_curve {
            Some(AnalyticCurve::Arc { .. }) | Some(AnalyticCurve::Circle { .. }) => {
                edge_curve.unwrap()
            }
            None | Some(AnalyticCurve::Line { .. }) => {
                return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                    surface_kind: "Sphere",
                    curve_kind: "Line",
                });
            }
            Some(c) => {
                let kind = match c {
                    AnalyticCurve::Bezier { .. } => "Bezier",
                    AnalyticCurve::BSpline { .. } => "BSpline",
                    AnalyticCurve::NURBS { .. } => "NURBS",
                    _ => unreachable!(),
                };
                return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                    surface_kind: "Sphere",
                    curve_kind: kind,
                });
            }
        };

        let (arc_center, arc_radius, arc_normal, basis_u_arc, angles) = match &curve {
            AnalyticCurve::Arc {
                center,
                radius,
                normal,
                basis_u,
                start_angle,
                end_angle,
            } => (
                *center,
                *radius,
                *normal,
                *basis_u,
                Some((*start_angle, *end_angle)),
            ),
            AnalyticCurve::Circle {
                center,
                radius,
                normal,
                basis_u,
            } => (*center, *radius, *normal, *basis_u, None),
            _ => unreachable!(),
        };

        // §V2-γ2-B Sanity:
        //   1. arc center → sphere center direction (d_vec)
        //   2. arc.normal parallel to d_vec (or arc is a great circle: d = 0,
        //      then any normal in tangent plane is OK)
        //   3. r² + d² ≈ R²  (arc lies on sphere)
        let d_vec = arc_center - sphere_center;
        let d = d_vec.length();
        let polar_axis = if d > tol {
            d_vec / d
        } else {
            // Great circle — use arc's own normal as polar axis.
            arc_normal.normalize_or_zero()
        };
        let arc_n_unit = arc_normal.normalize_or_zero();
        // For non-degenerate d, arc.normal must be ‖ d_vec.
        if d > tol && arc_n_unit.dot(polar_axis).abs() < 0.999 {
            return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Sphere",
                curve_kind: if angles.is_some() {
                    "Arc(off-sphere)"
                } else {
                    "Circle(off-sphere)"
                },
            });
        }
        // Sphere invariant: r² + d² ≈ R².
        let invariant_lhs = arc_radius * arc_radius + d * d;
        let invariant_rhs = sphere_radius * sphere_radius;
        if (invariant_lhs - invariant_rhs).abs() > tol * sphere_radius.max(1.0) {
            return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Sphere",
                curve_kind: if angles.is_some() {
                    "Arc(off-sphere)"
                } else {
                    "Circle(off-sphere)"
                },
            });
        }

        // Co-latitude φ ∈ [0, π].
        // arc center axial component: d_along_polar = d_vec · polar_axis
        // (signed; positive = above sphere center along polar_axis).
        let d_signed = d_vec.dot(polar_axis); // = ±d
        let phi = arc_radius.atan2(d_signed); // ∈ (0, π) for non-degenerate

        // Sign of φ-change: tangent at θ_mid × surface_normal · ∂P/∂φ.
        let theta_mid = match angles {
            Some((s, e)) => (s + e) * 0.5,
            None => 0.0,
        };
        let basis_u_unit = basis_u_arc.normalize_or_zero();
        let basis_v_arc = polar_axis.cross(basis_u_unit);
        let p_mid = arc_center
            + arc_radius
                * (theta_mid.cos() * basis_u_unit + theta_mid.sin() * basis_v_arc);
        let tangent =
            -theta_mid.sin() * basis_u_unit + theta_mid.cos() * basis_v_arc;
        let surf_normal = (p_mid - sphere_center).normalize_or_zero();
        let right_side = tangent.cross(surf_normal);
        // ∂P/∂φ at midpoint:
        //   dP/dφ = R·(-sin(φ)·polar_axis + cos(φ)·(cos(θ_mid)·u + sin(θ_mid)·v))
        let dp_dphi = sphere_radius
            * (-phi.sin() * polar_axis
                + phi.cos() * (theta_mid.cos() * basis_u_unit + theta_mid.sin() * basis_v_arc));
        let phi_sign = if right_side.dot(dp_dphi) > 0.0 { 1.0 } else { -1.0 };

        if sphere_radius <= tol {
            return Err(OffsetEdgeError::DegenerateDistance(sphere_radius));
        }
        let delta_phi = phi_sign * dist / sphere_radius;
        let new_phi = phi + delta_phi;

        // Collapse guard: new_phi must be in (0, π) — else arc passes
        // through pole / wraps around. AxialOutOfRange semantics reused.
        let pole_eps = 1e-6;
        if new_phi < pole_eps || new_phi > std::f64::consts::PI - pole_eps {
            return Err(OffsetEdgeError::AxialOutOfRange {
                new_v: new_phi,
                v_min: pole_eps,
                v_max: std::f64::consts::PI - pole_eps,
            });
        }

        let new_d = sphere_radius * new_phi.cos();
        let new_r = sphere_radius * new_phi.sin();
        let new_center = sphere_center + new_d * polar_axis;

        // Build new endpoints.
        let new_basis_v = polar_axis.cross(basis_u_unit);
        let pt = |theta: f64| -> DVec3 {
            new_center + new_r * (theta.cos() * basis_u_unit + theta.sin() * new_basis_v)
        };
        let (new_p0, new_p1) = match angles {
            Some((s, e)) => (pt(s), pt(e)),
            None => (pt(0.0), pt(std::f64::consts::TAU - 1e-6)),
        };
        let new_v0_id = self.add_vertex(new_p0);
        let new_v1_id = self.add_vertex(new_p1);
        let (new_edge, _) = self
            .add_edge(new_v0_id, new_v1_id)
            .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

        let new_curve = match angles {
            Some((s, e)) => AnalyticCurve::Arc {
                center: new_center,
                radius: new_r,
                normal: polar_axis,
                basis_u: basis_u_arc,
                start_angle: s,
                end_angle: e,
            },
            None => AnalyticCurve::Circle {
                center: new_center,
                radius: new_r,
                normal: polar_axis,
                basis_u: basis_u_arc,
            },
        };
        if let Some(e) = self.edges.get_mut(new_edge) {
            e.set_curve(Some(new_curve));
        }

        Ok(OffsetEdgeResult {
            new_v0: new_v0_id,
            new_v1: new_v1_id,
            new_edge,
        })
    }

    /// face_id의 경계를 dist만큼 오프셋.
    /// dist > 0: 안쪽 (inset), dist < 0: 바깥쪽 (outset)
    ///
    /// 결과: 원본 face를 inner face + strip faces로 분할.
    /// 인접 face와의 edge 연결이 보존됨.
    pub fn offset_face(
        &mut self,
        face_id: FaceId,
        dist: f64,
    ) -> Result<OffsetResult> {
        if dist.abs() < 1e-6 {
            bail!("Offset distance too small");
        }

        let face = self.faces.get(face_id)
            .ok_or_else(|| anyhow::anyhow!("Face {:?} not found", face_id))?;

        if !face.is_active() {
            bail!("Face {:?} is not active", face_id);
        }

        let normal = face.normal();
        let material = face.material();
        let start_he = face.outer().start;

        // 1) 외곽 루프 정점 수집 (CCW 순서)
        let loop_vids = self.collect_loop_verts(start_he)?;
        let n = loop_vids.len();
        if n < 3 {
            bail!("Face has fewer than 3 vertices");
        }

        // 정점 좌표 수집
        let positions: Vec<DVec3> = loop_vids.iter()
            .map(|&vid| self.vertex_pos(vid))
            .collect::<Result<Vec<_>>>()?;

        // 2) 각 변의 inward normal 계산 (face 법선 기준)
        //    edge direction × face normal → inward pointing
        let offset_positions = compute_offset_polygon(&positions, normal, dist)?;

        if offset_positions.len() != n {
            bail!("Offset polygon vertex count mismatch");
        }

        // 3) 원본 face 삭제 — soft remove: face만 제거, half-edge face 참조만 해제
        //    next/prev는 보존하여 인접 face의 topology가 깨지지 않도록 함
        self.soft_remove_face(face_id)?;

        // 4) offset polygon의 정점 생성
        let offset_vids: Vec<_> = offset_positions.iter()
            .map(|&pos| self.add_vertex(pos))
            .collect();

        // 5) offset face 생성 (동일 winding)
        let inner_face = self.add_face(&offset_vids, material)?;

        // 6) 2026-04-27 — 사용자 요청: "offset 명령시 offset 된 라인과 모서리선이
        //    연결되면 안됨. 모서리 연결선을 지워서 완성".
        //
        //    이전: N 개 strip quad 를 만들어 inset 과 outer boundary 사이를 채움
        //    → 모서리에서 quad 끼리 만나는 corner-connector 엣지가 보임.
        //
        //    새로운 방식: 단일 frame face 를 multi-loop 으로 생성.
        //      outer loop = 원본 boundary
        //      inner hole = offset polygon (winding 반대 — hole 규약)
        //    → corner connector 엣지 없음. inner_face 와 frame 이 함께 원래
        //      면 영역을 덮음.
        //
        //    Inset (dist > 0): hole 은 outer 와 같은 CCW (자동 hole 처리에서
        //      add_face_with_holes 가 내부 winding 을 적절히 정규화).
        //    Outset (dist < 0): outer 가 offset polygon, 원본은 hole. → 두
        //      loop 의 역할이 바뀜.
        let (frame_outer, frame_hole): (Vec<VertId>, Vec<VertId>) = if dist > 0.0 {
            (loop_vids.to_vec(), offset_vids.clone())
        } else {
            (offset_vids.clone(), loop_vids.to_vec())
        };
        let frame_face = self.add_face_with_holes(
            &frame_outer,
            &[&frame_hole],
            material,
        )?;
        // strip_faces 는 이제 frame_face 하나로 대체. 호환성 위해 vec 에 담아 반환.
        let strip_faces = vec![frame_face];

        // ADR-007 — offset 후 invariants 검증
        self.debug_verify_invariants();

        Ok(OffsetResult {
            inner_face,
            strip_faces,
            original_face: face_id,
        })
    }

    /// Face만 storage에서 제거하되, half-edge의 face 참조만 NULL로 설정.
    /// next/prev/radial 연결은 보존하여 인접 face topology가 깨지지 않음.
    /// add_face가 find_halfedge에서 face==NULL인 free HE를 찾아 재사용할 수 있게 함.
    pub fn soft_remove_face(&mut self, face_id: FaceId) -> Result<()> {
        if !self.faces.contains(face_id) {
            bail!("Face {:?} not found for soft removal", face_id);
        }

        // Outer loop: face 참조만 해제 (next/prev 보존)
        let outer_start = self.faces[face_id].outer().start;
        if !outer_start.is_null() {
            if let Ok(hes) = self.collect_loop_hes(outer_start) {
                for he_id in hes {
                    if let Some(he) = self.hes.get_mut(he_id) {
                        he.set_face(FaceId::NULL);
                        // next/prev는 보존! (인접 face에서 edge를 통해 참조할 수 있음)
                    }
                }
            }
        }

        // Inner loops (holes)
        let inners: Vec<_> = self.faces[face_id].inners().to_vec();
        for inner_ref in inners {
            if !inner_ref.start.is_null() {
                if let Ok(hes) = self.collect_loop_hes(inner_ref.start) {
                    for he_id in hes {
                        if let Some(he) = self.hes.get_mut(he_id) {
                            he.set_face(FaceId::NULL);
                        }
                    }
                }
            }
        }

        // Face storage에서 제거
        self.faces.remove(face_id);
        Ok(())
    }
}

/// ADR-080 V-β-γ-1 — Axial line on cylinder offset (free helper to keep
/// `offset_edge_on_cylinder` body manageable). Verifies that the line
/// is axis-parallel and on the cylinder surface, then computes an
/// angular offset Δu = sign·dist/radius.
#[allow(clippy::too_many_arguments)]
fn offset_axial_line_on_cylinder(
    mesh: &mut Mesh,
    edge_id: EdgeId,
    p0: DVec3,
    p1: DVec3,
    axis_origin: DVec3,
    axis_dir: DVec3,
    radius: f64,
    ref_dir: DVec3,
    basis_v: DVec3,
    _v_range: (f64, f64),
    dist: f64,
    tol: f64,
) -> std::result::Result<OffsetEdgeResult, OffsetEdgeError> {
    let edge_vec = p1 - p0;
    if edge_vec.length_squared() < 1e-12 {
        return Err(OffsetEdgeError::DegenerateDistance(0.0));
    }
    let edge_dir = edge_vec.normalize();

    // Must be parallel to cylinder axis.
    let axis_alignment = edge_dir.dot(axis_dir);
    if axis_alignment.abs() < 0.999 {
        return Err(OffsetEdgeError::UnsupportedCurveOnSurface {
            surface_kind: "Cylinder",
            curve_kind: "Line(non-axial)",
        });
    }

    // Both endpoints on the cylinder surface (radius check).
    let radial_check = |p: DVec3| -> Option<(f64, f64)> {
        let from_axis = p - axis_origin;
        let v_axial = from_axis.dot(axis_dir);
        let radial = from_axis - v_axial * axis_dir;
        let r_actual = radial.length();
        if (r_actual - radius).abs() > 1e-3 {
            None
        } else {
            // u = atan2(radial · basis_v, radial · ref_dir)
            let u = radial.dot(basis_v).atan2(radial.dot(ref_dir));
            Some((u, v_axial))
        }
    };
    let (u0, v0_axial) = radial_check(p0).ok_or(OffsetEdgeError::UnsupportedCurveOnSurface {
        surface_kind: "Cylinder",
        curve_kind: "Line(off-cylinder)",
    })?;
    let (_u1, v1_axial) = radial_check(p1).ok_or(OffsetEdgeError::UnsupportedCurveOnSurface {
        surface_kind: "Cylinder",
        curve_kind: "Line(off-cylinder)",
    })?;

    // Sign: edge_dir = ±axis_dir → +1 / -1.
    let dir_sign = axis_alignment.signum();
    if radius <= tol {
        return Err(OffsetEdgeError::DegenerateDistance(radius));
    }
    let delta_u = dir_sign * dist / radius;
    let new_u = u0 + delta_u;

    // New endpoint positions: same v_axial, new u.
    let radial_new = new_u.cos() * ref_dir + new_u.sin() * basis_v;
    let new_p0 = axis_origin + v0_axial * axis_dir + radius * radial_new;
    let new_p1 = axis_origin + v1_axial * axis_dir + radius * radial_new;

    let new_v0_id = mesh.add_vertex(new_p0);
    let new_v1_id = mesh.add_vertex(new_p1);
    let (new_edge, _) = mesh
        .add_edge(new_v0_id, new_v1_id)
        .map_err(|_| OffsetEdgeError::EdgeNotFound(edge_id))?;

    Ok(OffsetEdgeResult {
        new_v0: new_v0_id,
        new_v1: new_v1_id,
        new_edge,
    })
}

/// ADR-080 §V2-B helper — Are two surfaces "equivalent" for host
/// resolution purposes? In V-β-α we only support Plane host, so
/// equivalence = same Plane (origin + normal coplanar within
/// EPSILON_LENGTH). Other surface kinds are forwarded but only ever
/// reach `UnsupportedHostSurface`, so equivalence for them is whether
/// they're the same kind.
fn surfaces_equivalent(
    a: &Option<AnalyticSurface>,
    b: &Option<AnalyticSurface>,
) -> bool {
    let tol = crate::tolerances::EPSILON_LENGTH;
    match (a, b) {
        (None, None) => true,
        (Some(s_a), Some(s_b)) => match (s_a, s_b) {
            (
                AnalyticSurface::Plane {
                    origin: oa,
                    normal: na,
                    ..
                },
                AnalyticSurface::Plane {
                    origin: ob,
                    normal: nb,
                    ..
                },
            ) => {
                let normal_match =
                    na.normalize_or_zero().dot(nb.normalize_or_zero()).abs() > 0.999;
                // Coplanarity: project (ob - oa) onto na — should be ~0.
                let off_plane = (*ob - *oa).dot(na.normalize_or_zero()).abs();
                normal_match && off_plane < tol
            }
            (
                AnalyticSurface::Sphere {
                    center: ca,
                    radius: ra,
                    ..
                },
                AnalyticSurface::Sphere {
                    center: cb,
                    radius: rb,
                    ..
                },
            ) => {
                (*ca - *cb).length() < tol && (ra - rb).abs() < tol
            }
            (
                AnalyticSurface::Cylinder {
                    axis_origin: oa,
                    axis_dir: aa,
                    radius: ra,
                    ref_dir: ua,
                    ..
                },
                AnalyticSurface::Cylinder {
                    axis_origin: ob,
                    axis_dir: ab,
                    radius: rb,
                    ref_dir: ub,
                    ..
                },
            ) => {
                // Same axis line (origin difference parallel to axis) +
                // same radius + ref_dir parallel.
                let axis_match =
                    aa.normalize_or_zero().dot(ab.normalize_or_zero()).abs() > 0.999;
                let origin_off_axis = ((*ob - *oa)
                    - (*ob - *oa).dot(aa.normalize_or_zero()) * aa.normalize_or_zero())
                .length();
                let radius_match = (ra - rb).abs() < tol;
                let ref_match =
                    ua.normalize_or_zero().dot(ub.normalize_or_zero()).abs() > 0.999;
                axis_match && origin_off_axis < tol && radius_match && ref_match
            }
            _ => std::mem::discriminant(s_a) == std::mem::discriminant(s_b),
        },
        _ => false,
    }
}

/// 2D(평면 투영) 오프셋 폴리곤 계산.
///
/// 각 변을 face 법선 기준으로 inward 방향으로 dist만큼 이동하고,
/// 인접 이동 선분의 교점을 구함.
fn compute_offset_polygon(
    positions: &[DVec3],
    face_normal: DVec3,
    dist: f64,
) -> Result<Vec<DVec3>> {
    let n = positions.len();
    if n < 3 {
        bail!("Need at least 3 positions");
    }

    let fn_norm = face_normal.normalize();

    // 각 변에 대한 offset 선분 (이동된 직선)
    // edge[i]: positions[i] → positions[(i+1)%n]
    // inward normal: edge_dir × face_normal (normalized)
    struct OffsetLine {
        point: DVec3,   // offset 된 직선 위의 한 점
        dir: DVec3,     // 직선 방향 (= 원본 edge 방향)
    }

    let mut offset_lines: Vec<OffsetLine> = Vec::with_capacity(n);

    for i in 0..n {
        let j = (i + 1) % n;
        let edge_dir = (positions[j] - positions[i]).normalize();

        // inward normal: edge × face_normal
        // dist > 0 → inset (안쪽), dist < 0 → outset (바깥쪽)
        let inward = edge_dir.cross(fn_norm).normalize();

        // offset point: 원본 edge를 inward 방향으로 dist만큼 이동
        let offset_pt = positions[i] + inward * dist;

        offset_lines.push(OffsetLine {
            point: offset_pt,
            dir: edge_dir,
        });
    }

    // 인접 offset 직선의 교점 구하기
    // line[i]와 line[(i+n-1)%n]의 교점 → offset_positions[i]
    let mut result = Vec::with_capacity(n);

    for i in 0..n {
        let prev = (i + n - 1) % n;

        let p1 = offset_lines[prev].point;
        let d1 = offset_lines[prev].dir;
        let p2 = offset_lines[i].point;
        let d2 = offset_lines[i].dir;

        // 3D에서 두 직선의 교점 (같은 평면 위에 있으므로)
        // p1 + t*d1 = p2 + s*d2
        // → (p2 - p1) = t*d1 - s*d2
        // 외적 방법: t = ((p2-p1) × d2) · (d1 × d2) / |d1 × d2|²
        let cross_d = d1.cross(d2);
        let denom = cross_d.length_squared();

        if denom < 1e-12 {
            // 평행한 변 → 원본 offset point 사용
            result.push(offset_lines[i].point);
        } else {
            let dp = p2 - p1;
            let t = dp.cross(d2).dot(cross_d) / denom;
            let intersection = p1 + d1 * t;
            result.push(intersection);
        }
    }

    Ok(result)
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MaterialId;

    fn make_square_face(mesh: &mut Mesh, size: f64) -> FaceId {
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(size, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(size, 0.0, size));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, size));
        mesh.add_face(&[v0, v1, v2, v3], MaterialId::new(0)).unwrap()
    }

    #[test]
    fn test_offset_inset() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        let faces_before = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_before, 1);

        let result = mesh.offset_face(fid, 100.0).unwrap();

        // 2026-04-27 — frame face (multi-loop with hole) + inner = 2 faces.
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 2); // 1 inner + 1 frame (with hole)

        // strip_faces 는 이제 [frame_face] 하나만 (호환 vec).
        assert_eq!(result.strip_faces.len(), 1);

        // inner face 존재
        assert!(mesh.faces.get(result.inner_face).is_some());
    }

    #[test]
    fn test_offset_outset() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        let result = mesh.offset_face(fid, -100.0).unwrap();

        // outset 도 동일 — frame + inner.
        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 2);
        assert_eq!(result.strip_faces.len(), 1);
    }

    #[test]
    fn test_offset_triangle() {
        let mut mesh = Mesh::new();
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(500.0, 0.0, 866.0));
        let fid = mesh.add_face(&[v0, v1, v2], MaterialId::new(0)).unwrap();

        let result = mesh.offset_face(fid, 50.0).unwrap();

        let faces_after = mesh.faces.iter().filter(|(_, f)| f.is_active()).count();
        assert_eq!(faces_after, 2); // 1 inner + 1 frame
        assert_eq!(result.strip_faces.len(), 1);
    }

    #[test]
    fn test_offset_zero_distance() {
        let mut mesh = Mesh::new();
        let fid = make_square_face(&mut mesh, 1000.0);

        // 거리 0은 에러
        assert!(mesh.offset_face(fid, 0.0).is_err());
    }

    #[test]
    fn test_offset_polygon_geometry() {
        // 1000x1000 정사각형을 100 inset → 내부 800x800
        let positions = vec![
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 1000.0),
            DVec3::new(0.0, 0.0, 1000.0),
        ];
        let normal = DVec3::new(0.0, 1.0, 0.0);

        let result = compute_offset_polygon(&positions, normal, 100.0).unwrap();
        assert_eq!(result.len(), 4);

        // 각 꼭짓점이 100만큼 안으로 이동했는지 확인
        let eps = 1.0;
        assert!((result[0].x - 100.0).abs() < eps, "got {}", result[0].x);
        assert!((result[0].z - 100.0).abs() < eps, "got {}", result[0].z);
        assert!((result[1].x - 900.0).abs() < eps, "got {}", result[1].x);
        assert!((result[1].z - 100.0).abs() < eps, "got {}", result[1].z);
        assert!((result[2].x - 900.0).abs() < eps, "got {}", result[2].x);
        assert!((result[2].z - 900.0).abs() < eps, "got {}", result[2].z);
        assert!((result[3].x - 100.0).abs() < eps, "got {}", result[3].x);
        assert!((result[3].z - 900.0).abs() < eps, "got {}", result[3].z);
    }

    #[test]
    fn test_offset_on_box_top() {
        // 박스 생성 후 top face에 offset → side wall과 분리되지 않아야 함
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);

        // Ground rect
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1000.0, 0.0, 1000.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1000.0));
        let base = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();

        // Push/Pull → box
        let pp = mesh.push_pull(base, 500.0, mat).unwrap();
        let face_count_after_pp = mesh.face_count();
        assert_eq!(face_count_after_pp, 6); // closed box

        // Offset top face
        let _result = mesh.offset_face(pp.top_face, 100.0).unwrap();

        // box 6면 - top(삭제) + inner + frame(with hole) = 7면
        let face_count_after_offset = mesh.face_count();
        assert_eq!(face_count_after_offset, 7); // 5 original sides + 1 inner + 1 frame

        // 모든 face가 렌더링 가능한지 (export_buffers가 크래시하지 않는지)
        let buffers = mesh.export_buffers();
        assert!(buffers.is_ok());
    }

    // ════════════════════════════════════════════════════════════════
    // Line (Edge) Offset Tests
    // ════════════════════════════════════════════════════════════════

    #[test]
    fn test_offset_edge_basic() {
        let mut mesh = Mesh::new();

        // X축 위의 선분: (0,0,0) → (1000,0,0)
        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        assert_eq!(mesh.edge_count(), 1);
        assert_eq!(mesh.face_count(), 0);

        // Y-up 평면에서 평행 복사
        let result = mesh.offset_edge(edge_id, 100.0, DVec3::Y).unwrap();

        // 면은 만들지 않음 (선만 복사)
        assert_eq!(mesh.face_count(), 0);
        // edge 2개 (원본 + 복사)
        assert_eq!(mesh.edge_count(), 2);

        // 새 정점 위치 확인
        let new_p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let new_p1 = mesh.vertex_pos(result.new_v1).unwrap();

        assert!((new_p0.y).abs() < 1.0, "Y should stay on plane, got {}", new_p0.y);
        assert!((new_p1.y).abs() < 1.0, "Y should stay on plane, got {}", new_p1.y);

        let dist_0 = (new_p0 - DVec3::new(0.0, 0.0, 0.0)).length();
        let dist_1 = (new_p1 - DVec3::new(1000.0, 0.0, 0.0)).length();
        assert!((dist_0 - 100.0).abs() < 1.0, "Offset distance should be ~100, got {}", dist_0);
        assert!((dist_1 - 100.0).abs() < 1.0, "Offset distance should be ~100, got {}", dist_1);
    }

    #[test]
    fn test_offset_edge_negative() {
        let mut mesh = Mesh::new();

        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        // 반대 방향 offset — 면 없이 선만
        let _result = mesh.offset_edge(edge_id, -100.0, DVec3::Y).unwrap();
        assert_eq!(mesh.face_count(), 0);
        assert_eq!(mesh.edge_count(), 2);
    }

    #[test]
    fn test_offset_edge_zero_distance() {
        let mut mesh = Mesh::new();

        let (_v0, _v1, edge_id) = mesh.draw_line(
            DVec3::ZERO,
            DVec3::new(1000.0, 0.0, 0.0),
        ).unwrap();

        // 거리 0 → 에러
        assert!(mesh.offset_edge(edge_id, 0.0, DVec3::Y).is_err());
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-080 V-β-α — offset_edge_on_host_face (Line + Plane host)
    // ════════════════════════════════════════════════════════════════

    /// Helper: build a Plane-surfaced unit square face on z=0, normal +Z.
    /// Returns (face_id, [v00, v10, v11, v01]) so callers can pick edges.
    fn build_unit_square_plane(mesh: &mut Mesh) -> (FaceId, [VertId; 4]) {
        let mat = MaterialId::new(0);
        let v00 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        (face, [v00, v10, v11, v01])
    }

    fn find_edge_between(mesh: &Mesh, a: VertId, b: VertId) -> EdgeId {
        for (eid, e) in mesh.edges.iter() {
            if !e.is_active() {
                continue;
            }
            let pair = (e.v_small(), e.v_large());
            if pair == (a, b) || pair == (b, a) {
                return eid;
            }
        }
        panic!("edge between {a:?} and {b:?} not found");
    }

    #[test]
    fn line_on_plane_host_offset_creates_parallel_edge() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        // Bottom edge: v00 → v10 (along +X), face normal +Z.
        // offset_dir = edge_dir × normal = +X × +Z = -Y.
        // dist = 0.3 → new line at y = -0.3 (outside square).
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.3)
            .expect("offset OK");

        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let p1 = mesh.vertex_pos(result.new_v1).unwrap();
        // Both at y = -0.3, z = 0, with x = 0 and x = 1 (in some order).
        assert!((p0.y - (-0.3)).abs() < 1e-9);
        assert!((p1.y - (-0.3)).abs() < 1e-9);
        assert!(p0.z.abs() < 1e-9 && p1.z.abs() < 1e-9);
        let xs = [p0.x, p1.x];
        let mut sorted = xs;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((sorted[0] - 0.0).abs() < 1e-9);
        assert!((sorted[1] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn line_on_plane_host_uses_face_normal_not_caller_arg() {
        // Compare offset using V-β-α API vs legacy with explicit DVec3::Y
        // (wrong normal). New API should follow face's +Z, not Y.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .expect("offset OK");

        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        // With face normal = +Z and edge along +X, offset_dir = -Y.
        // If the API mistakenly used +Y as normal, offset_dir would be +Z
        // (out of plane) — the y-coord would be 0 instead of -0.5.
        assert!(
            (p0.y - (-0.5)).abs() < 1e-9,
            "offset must use face's +Z normal, got y = {}",
            p0.y
        );
        assert!(p0.z.abs() < 1e-9, "z must remain 0 (in-plane)");
    }

    #[test]
    fn line_offset_on_hole_face_rejected() {
        // Build a frame face (square with inner hole) — multi-loop face.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let outer = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(10.0, 0.0, 10.0)),
            mesh.add_vertex(DVec3::new(0.0, 0.0, 10.0)),
        ];
        let inner = [
            mesh.add_vertex(DVec3::new(3.0, 0.0, 3.0)),
            mesh.add_vertex(DVec3::new(7.0, 0.0, 3.0)),
            mesh.add_vertex(DVec3::new(7.0, 0.0, 7.0)),
            mesh.add_vertex(DVec3::new(3.0, 0.0, 7.0)),
        ];
        let face = mesh
            .add_face_with_holes(&outer, &[&inner], mat)
            .expect("frame face");
        mesh.faces[face].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 10.0),
            v_range: (0.0, 10.0),
        }));
        let edge = find_edge_between(&mesh, outer[0], outer[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .err()
            .expect("must reject multi-loop");
        assert!(matches!(err, OffsetEdgeError::MultiLoopHostFace(_)));
    }

    #[test]
    fn line_offset_on_cone_host_returns_unsupported() {
        // V-β-γ-1/2 activated Cylinder/Sphere; Cone/Torus still defer to
        // V-β-γ-3/4. Re-target this regression to Cone host.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let vs = [
            mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)),
            mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0)),
            mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0)),
        ];
        let face = mesh.add_face(&vs, mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Cone {
            apex: DVec3::ZERO,
            axis_dir: DVec3::Z,
            half_angle: std::f64::consts::FRAC_PI_4,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.1, 1.0),
        }));
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 0.3)
            .err()
            .expect("must defer cone host");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedHostSurface { kind: "Cone" }
        ));
    }

    #[test]
    fn line_offset_no_incident_face_returns_no_incident() {
        let mut mesh = Mesh::new();
        let (_v0, _v1, edge_id) = mesh
            .draw_line(DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0))
            .unwrap();
        let err = mesh
            .offset_edge_on_host_face(edge_id, 0.5)
            .err()
            .expect("must reject free wire");
        assert!(matches!(err, OffsetEdgeError::NoIncidentFace));
    }

    #[test]
    fn line_offset_ambiguous_host_face_rejected() {
        // Two faces sharing an edge but with conflicting Plane normals.
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        let v0 = mesh.add_vertex(DVec3::new(0.0, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(1.0, 1.0, 0.0));
        let v3 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v4 = mesh.add_vertex(DVec3::new(0.0, 0.0, 1.0));
        let v5 = mesh.add_vertex(DVec3::new(1.0, 0.0, 1.0));

        // f1 in z=0 plane, normal +Z.
        let f1 = mesh.add_face(&[v0, v1, v2, v3], mat).unwrap();
        mesh.faces[f1].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));
        // f2 in y=0 plane (sharing edge v0-v1), normal +Y. Conflicting.
        let f2 = mesh.add_face(&[v0, v4, v5, v1], mat).unwrap();
        mesh.faces[f2].set_surface(Some(AnalyticSurface::Plane {
            origin: DVec3::ZERO,
            normal: DVec3::Y,
            basis_u: DVec3::X,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }));

        let shared = find_edge_between(&mesh, v0, v1);
        let err = mesh
            .offset_edge_on_host_face(shared, 0.3)
            .err()
            .expect("must reject ambiguous");
        assert!(matches!(err, OffsetEdgeError::AmbiguousHostFace { .. }));
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-080 V-β-β — Arc / Circle on Plane host (analytic radius offset)
    // ════════════════════════════════════════════════════════════════

    /// Helper — attach an Arc curve to `edge` lying on a unit-square Plane
    /// face, then return the radius+center for downstream sanity.
    fn attach_arc_to_edge(
        mesh: &mut Mesh,
        edge: EdgeId,
        center: DVec3,
        radius: f64,
        start: f64,
        end: f64,
    ) {
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center,
            radius,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: start,
            end_angle: end,
        }));
    }

    #[test]
    fn arc_on_plane_host_offset_changes_radius_and_attaches_new_curve() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Arc with center (0.5, 0, 0) → radius 0.5 → endpoints at (0,0,0)
        // and (1,0,0). Plane is z=0 with +Z normal.
        attach_arc_to_edge(&mut mesh, edge, DVec3::new(0.5, 0.0, 0.0), 0.5,
            std::f64::consts::PI, std::f64::consts::TAU);

        let result = mesh
            .offset_edge_on_host_face(edge, 0.2)
            .expect("arc offset OK");

        // New edge must have an Arc curve with new radius.
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge must have curve attached");
        match new_curve {
            AnalyticCurve::Arc { radius, center, .. } => {
                // radius is 0.5 ± 0.2 — sign chosen by tangent × host_normal
                // vs radial. Either ≈ 0.7 or ≈ 0.3, both > 0 (no collapse).
                assert!(
                    (radius - 0.7).abs() < 1e-9 || (radius - 0.3).abs() < 1e-9,
                    "radius must be 0.7 or 0.3, got {radius}"
                );
                // Center preserved.
                assert!((center - DVec3::new(0.5, 0.0, 0.0)).length() < 1e-9);
            }
            _ => panic!("new curve must be Arc"),
        }
    }

    #[test]
    fn arc_offset_inward_decreases_radius() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        attach_arc_to_edge(&mut mesh, edge, DVec3::new(0.5, 0.0, 0.0), 0.5,
            std::f64::consts::PI, std::f64::consts::TAU);

        // Pick a sign that brings the radius down.
        let r_plus = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .ok()
            .and_then(|r| mesh.edges.get(r.new_edge).and_then(|e| e.curve().cloned()))
            .and_then(|c| match c {
                AnalyticCurve::Arc { radius, .. } => Some(radius),
                _ => None,
            })
            .expect("first offset OK");
        let r_minus = mesh
            .offset_edge_on_host_face(edge, -0.1)
            .ok()
            .and_then(|r| mesh.edges.get(r.new_edge).and_then(|e| e.curve().cloned()))
            .and_then(|c| match c {
                AnalyticCurve::Arc { radius, .. } => Some(radius),
                _ => None,
            })
            .expect("second offset OK");
        // The two signs must yield 0.6 and 0.4.
        let mut both = [r_plus, r_minus];
        both.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((both[0] - 0.4).abs() < 1e-9);
        assert!((both[1] - 0.6).abs() < 1e-9);
    }

    #[test]
    fn arc_offset_collapse_radius_rejected() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        attach_arc_to_edge(&mut mesh, edge, DVec3::new(0.5, 0.0, 0.0), 0.5,
            std::f64::consts::PI, std::f64::consts::TAU);

        // Try both signs with a magnitude > 0.5; one of them must collapse.
        let err1 = mesh.offset_edge_on_host_face(edge, 0.6).err();
        let err2 = mesh.offset_edge_on_host_face(edge, -0.6).err();
        let collapse_seen = matches!(err1, Some(OffsetEdgeError::RadiusCollapse { .. }))
            || matches!(err2, Some(OffsetEdgeError::RadiusCollapse { .. }));
        assert!(
            collapse_seen,
            "one sign must trigger RadiusCollapse, got {:?} / {:?}",
            err1, err2
        );
    }

    #[test]
    fn arc_in_orthogonal_plane_rejected() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Arc with normal +X — perpendicular to host face's +Z normal.
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.5, 0.0, 0.0),
            radius: 0.5,
            normal: DVec3::X, // wrong plane
            basis_u: DVec3::Y,
            start_angle: 0.0,
            end_angle: std::f64::consts::PI,
        }));

        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must reject mismatched plane");
        assert!(matches!(err, OffsetEdgeError::ArcPlaneMismatch));
    }

    #[test]
    fn circle_on_plane_host_offset_changes_radius() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(0.5, 0.0, 0.0),
            radius: 0.5,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));

        let result = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .expect("circle offset OK");
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge must have curve");
        match new_curve {
            AnalyticCurve::Circle { radius, center, .. } => {
                assert!(
                    (radius - 0.6).abs() < 1e-9 || (radius - 0.4).abs() < 1e-9,
                    "circle new radius must be 0.6 or 0.4, got {radius}"
                );
                assert!((center - DVec3::new(0.5, 0.0, 0.0)).length() < 1e-9);
            }
            _ => panic!("must remain Circle"),
        }
    }

    #[test]
    fn arc_endpoints_on_new_radius() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Quarter arc: center (0,0,0), radius 1, θ ∈ [0, π/2].
        // endpoints: (1,0,0) at θ=0 and (0,1,0) at θ=π/2.
        attach_arc_to_edge(&mut mesh, edge, DVec3::ZERO, 1.0,
            0.0, std::f64::consts::FRAC_PI_2);

        let result = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .expect("offset OK");
        let new_r = match mesh.edges.get(result.new_edge).and_then(|e| e.curve()) {
            Some(AnalyticCurve::Arc { radius, .. }) => *radius,
            _ => panic!("new curve must be Arc"),
        };
        // Verify endpoints lie on circle of new_r about origin.
        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let p1 = mesh.vertex_pos(result.new_v1).unwrap();
        assert!(
            (p0.length() - new_r).abs() < 1e-9,
            "p0 distance from origin = {}, expected {new_r}",
            p0.length()
        );
        assert!(
            (p1.length() - new_r).abs() < 1e-9,
            "p1 distance from origin = {}, expected {new_r}",
            p1.length()
        );
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-080 V-β-γ-1 — Edge offset on Cylinder host
    // ════════════════════════════════════════════════════════════════

    /// Helper — build a "cylinder panel" face. Just creates a single quad
    /// face whose surface is the desired Cylinder; vertex positions are
    /// placed on the cylinder for radius_check sanity.
    fn build_cylinder_panel(
        mesh: &mut Mesh,
        radius: f64,
        v_min: f64,
        v_max: f64,
        u_min: f64,
        u_max: f64,
    ) -> (FaceId, [VertId; 4]) {
        let mat = MaterialId::new(0);
        let on_cyl = |u: f64, v: f64| {
            DVec3::new(radius * u.cos(), radius * u.sin(), v)
        };
        let v00 = mesh.add_vertex(on_cyl(u_min, v_min));
        let v10 = mesh.add_vertex(on_cyl(u_max, v_min));
        let v11 = mesh.add_vertex(on_cyl(u_max, v_max));
        let v01 = mesh.add_vertex(on_cyl(u_min, v_max));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (v_min - 10.0, v_max + 10.0),
        }));
        (face, [v00, v10, v11, v01])
    }

    #[test]
    fn cylinder_axial_line_offset_changes_angular_position() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_cylinder_panel(&mut mesh, 1.0, 0.0, 2.0, 0.0, 1.0);
        // Edge v00 → v01 (between u_min, v=0..2) is axial. Should offset
        // angularly by Δu = dist / radius.
        let edge = find_edge_between(&mesh, vs[0], vs[3]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .expect("axial offset OK");

        // New endpoints at same z as originals (axial line — endpoints differ
        // only in angle now).
        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        let p1 = mesh.vertex_pos(result.new_v1).unwrap();
        // Both at radius 1.0 from axis (cylinder preserved).
        assert!((p0.x * p0.x + p0.y * p0.y).sqrt() - 1.0 < 1e-9);
        assert!((p1.x * p1.x + p1.y * p1.y).sqrt() - 1.0 < 1e-9);
        // Original u was 0 (cos=1, sin=0). Δu = 0.5 / 1.0 = 0.5 rad.
        // Expected angle: original ± 0.5 (sign depends on edge direction).
        let u_new = p0.y.atan2(p0.x);
        assert!(
            (u_new - 0.5).abs() < 1e-9 || (u_new - (-0.5)).abs() < 1e-9,
            "new u must be ±0.5 rad, got {u_new}"
        );
        // Same z values
        let z_orig0 = mesh.vertex_pos(vs[0]).unwrap().z;
        let z_orig1 = mesh.vertex_pos(vs[3]).unwrap().z;
        let z_set: Vec<f64> = vec![z_orig0, z_orig1];
        for new_z in [p0.z, p1.z] {
            assert!(
                z_set.iter().any(|z| (z - new_z).abs() < 1e-9),
                "new z must match an original z, got {new_z}"
            );
        }
    }

    #[test]
    fn cylinder_offset_preserves_cylinder_radius() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_cylinder_panel(&mut mesh, 2.5, 0.0, 1.0, 0.0, 0.5);
        let edge = find_edge_between(&mesh, vs[0], vs[3]);
        let result = mesh
            .offset_edge_on_host_face(edge, 0.3)
            .expect("offset OK");
        // After axial-line offset, new endpoints should still be at radius 2.5.
        for v_id in [result.new_v0, result.new_v1] {
            let p = mesh.vertex_pos(v_id).unwrap();
            let r = (p.x * p.x + p.y * p.y).sqrt();
            assert!(
                (r - 2.5).abs() < 1e-9,
                "cylinder radius must be preserved; got {r} (expected 2.5)"
            );
        }
    }

    #[test]
    fn cylinder_helical_line_rejected() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Build cylinder face but with a non-axial edge.
        let v00 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0)); // u=0, v=0
        let v10 = mesh.add_vertex(DVec3::new(0.0, 1.0, 1.0)); // u=π/2, v=1 — helical
        let v11 = mesh.add_vertex(DVec3::new(-1.0, 0.0, 2.0));
        let v01 = mesh.add_vertex(DVec3::new(0.0, -1.0, 1.0));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-10.0, 10.0),
        }));
        let edge = find_edge_between(&mesh, v00, v10);
        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must reject helical");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Cylinder",
                curve_kind: "Line(non-axial)"
            }
        ));
    }

    #[test]
    fn cylinder_latitude_arc_offset_shifts_axial_position() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_cylinder_panel(&mut mesh, 1.0, 0.0, 2.0, 0.0, 1.0);
        // Bottom edge v00 → v10 is at v=0, varying u — this is a latitude
        // ring segment. Attach the Arc curve.
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.0, 0.0, 0.0), // on axis at v=0
            radius: 1.0,
            normal: DVec3::Z, // ‖ axis_dir
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: 1.0,
        }));

        let result = mesh
            .offset_edge_on_host_face(edge, 0.5)
            .expect("latitude arc offset OK");
        // New arc center should be shifted along axis by ±0.5.
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge has curve");
        match new_curve {
            AnalyticCurve::Arc { center, radius, .. } => {
                assert!(
                    (center.z - 0.5).abs() < 1e-9 || (center.z - (-0.5)).abs() < 1e-9,
                    "axial shift must be ±0.5; got z = {}",
                    center.z
                );
                // Radius preserved (cylinder doesn't change radius).
                assert!((radius - 1.0).abs() < 1e-9);
                // Center stays on axis (x = y = 0).
                assert!(center.x.abs() < 1e-9 && center.y.abs() < 1e-9);
            }
            _ => panic!("must remain Arc"),
        }
    }

    #[test]
    fn cylinder_off_axis_arc_rejected() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_cylinder_panel(&mut mesh, 1.0, 0.0, 2.0, 0.0, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Arc with center NOT on cylinder axis.
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.5, 0.0, 0.0), // off-axis
            radius: 0.5,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: 1.0,
        }));
        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must reject off-axis arc");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Cylinder",
                curve_kind: "Arc(off-cylinder)"
            }
        ));
    }

    #[test]
    fn cylinder_axial_out_of_range_rejected() {
        let mut mesh = Mesh::new();
        let mat = MaterialId::new(0);
        // Build a cylinder panel with tight v_range so the offset goes out.
        let v00 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.0));
        let v10 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.0));
        let v11 = mesh.add_vertex(DVec3::new(0.0, 1.0, 0.5));
        let v01 = mesh.add_vertex(DVec3::new(1.0, 0.0, 0.5));
        let face = mesh.add_face(&[v00, v10, v11, v01], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Cylinder {
            axis_origin: DVec3::ZERO,
            axis_dir: DVec3::Z,
            radius: 1.0,
            ref_dir: DVec3::X,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (0.0, 0.5), // tight range
        }));
        let edge = find_edge_between(&mesh, v00, v10);
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        }));
        // Try offsets in both signs — at least one must go out of [0, 0.5].
        let err1 = mesh.offset_edge_on_host_face(edge, 1.0).err();
        let err2 = mesh.offset_edge_on_host_face(edge, -1.0).err();
        let oor_seen = matches!(err1, Some(OffsetEdgeError::AxialOutOfRange { .. }))
            || matches!(err2, Some(OffsetEdgeError::AxialOutOfRange { .. }));
        assert!(
            oor_seen,
            "one sign must trigger AxialOutOfRange, got {:?} / {:?}",
            err1, err2
        );
    }

    // ════════════════════════════════════════════════════════════════
    // ADR-080 V-β-γ-2 — Edge offset on Sphere host
    // ════════════════════════════════════════════════════════════════

    /// Helper — build a triangular face with Sphere surface attached.
    /// Vertices are placed on the sphere for radius_check sanity.
    fn build_sphere_panel(mesh: &mut Mesh, radius: f64) -> (FaceId, [VertId; 3]) {
        let mat = MaterialId::new(0);
        // 3 verts on sphere of given radius.
        let v0 = mesh.add_vertex(DVec3::new(radius, 0.0, 0.0));
        let v1 = mesh.add_vertex(DVec3::new(0.0, radius, 0.0));
        let v2 = mesh.add_vertex(DVec3::new(0.0, 0.0, radius));
        let face = mesh.add_face(&[v0, v1, v2], mat).unwrap();
        mesh.faces[face].set_surface(Some(AnalyticSurface::Sphere {
            center: DVec3::ZERO,
            radius,
            u_range: (0.0, std::f64::consts::TAU),
            v_range: (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
        }));
        (face, [v0, v1, v2])
    }

    #[test]
    fn sphere_great_circle_arc_offset_changes_latitude() {
        // Great circle: arc center == sphere center, radius = sphere radius.
        // Offset should produce a small circle at new latitude.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Great circle in xy-plane: center=origin, radius=1, normal=+Z.
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::ZERO,
            radius: 1.0,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        }));

        let result = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .expect("great-circle offset OK");
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge has curve");
        match new_curve {
            AnalyticCurve::Arc { center, radius, .. } => {
                // Sphere invariant: r² + d² ≈ R² = 1.
                let d = center.length();
                let invariant = radius * radius + d * d;
                assert!(
                    (invariant - 1.0).abs() < 1e-6,
                    "sphere invariant r²+d² = {invariant}, expected 1.0 (r={radius}, d={d})"
                );
                // Offset moves arc off equator → d > 0, radius < 1.
                assert!(d > 1e-6, "great circle should move off equator (d > 0)");
                assert!(radius < 1.0 - 1e-6, "small circle radius < sphere radius");
            }
            _ => panic!("must remain Arc"),
        }
    }

    #[test]
    fn sphere_small_circle_arc_offset_shifts_to_new_latitude() {
        // Small circle at latitude φ=π/3 on unit sphere:
        //   d = cos(π/3) = 0.5, r = sin(π/3) ≈ 0.866
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let phi = std::f64::consts::FRAC_PI_3;
        let d = phi.cos();
        let r = phi.sin();
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.0, 0.0, d),
            radius: r,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        }));
        let result = mesh
            .offset_edge_on_host_face(edge, 0.05)
            .expect("small circle offset OK");
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge has curve");
        match new_curve {
            AnalyticCurve::Arc { center, radius, .. } => {
                // Sphere invariant.
                let new_d = center.length();
                let invariant = radius * radius + new_d * new_d;
                assert!(
                    (invariant - 1.0).abs() < 1e-6,
                    "sphere invariant violated: r²+d² = {invariant}"
                );
                // φ shifted by ±0.05/1.0 = ±0.05 rad. New d = cos(φ ± 0.05).
                let expected_d_plus = (phi + 0.05).cos();
                let expected_d_minus = (phi - 0.05).cos();
                assert!(
                    (new_d - expected_d_plus).abs() < 1e-6
                        || (new_d - expected_d_minus).abs() < 1e-6,
                    "new d {new_d} should be one of {expected_d_plus} / {expected_d_minus}"
                );
            }
            _ => panic!("must remain Arc"),
        }
    }

    #[test]
    fn sphere_off_sphere_arc_rejected() {
        // Arc with parameters that violate r² + d² = R²
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // r=0.3, d=0.3 → r²+d²=0.18, but R²=1. Way off sphere.
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.0, 0.0, 0.3),
            radius: 0.3,
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        }));
        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must reject off-sphere arc");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Sphere",
                curve_kind: "Arc(off-sphere)"
            }
        ));
    }

    #[test]
    fn sphere_line_curve_rejected() {
        // Line/None on sphere: 3D chord — rejected (chord ambiguity).
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // No curve attached → treated as Line/None.
        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("must reject line on sphere");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveOnSurface {
                surface_kind: "Sphere",
                curve_kind: "Line"
            }
        ));
    }

    #[test]
    fn sphere_arc_collapse_at_pole_rejected() {
        // Small circle near pole, large offset that would push past pole.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 1.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // Latitude φ=π/12 (close to pole), r = sin(π/12) ≈ 0.259.
        let phi = std::f64::consts::PI / 12.0;
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Arc {
            center: DVec3::new(0.0, 0.0, phi.cos()),
            radius: phi.sin(),
            normal: DVec3::Z,
            basis_u: DVec3::X,
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
        }));
        // dist large enough to push φ past 0 (pole) — try both signs.
        let err1 = mesh.offset_edge_on_host_face(edge, 0.5).err();
        let err2 = mesh.offset_edge_on_host_face(edge, -0.5).err();
        let pole_seen = matches!(err1, Some(OffsetEdgeError::AxialOutOfRange { .. }))
            || matches!(err2, Some(OffsetEdgeError::AxialOutOfRange { .. }));
        assert!(
            pole_seen,
            "one sign must trigger pole collapse, got {:?} / {:?}",
            err1, err2
        );
    }

    #[test]
    fn sphere_circle_curve_offset_changes_radius() {
        // Full Circle on sphere — small circle at some latitude.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_sphere_panel(&mut mesh, 2.0);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        // φ = π/4 → d = √2, r = √2.
        let half_sqrt2 = std::f64::consts::SQRT_2;
        mesh.edges[edge].set_curve(Some(AnalyticCurve::Circle {
            center: DVec3::new(0.0, 0.0, half_sqrt2),
            radius: half_sqrt2,
            normal: DVec3::Z,
            basis_u: DVec3::X,
        }));
        let result = mesh
            .offset_edge_on_host_face(edge, 0.2)
            .expect("circle offset OK");
        let new_curve = mesh
            .edges
            .get(result.new_edge)
            .and_then(|e| e.curve())
            .cloned()
            .expect("new edge has curve");
        match new_curve {
            AnalyticCurve::Circle { center, radius, .. } => {
                // Sphere invariant for R=2.
                let d = center.length();
                let invariant = radius * radius + d * d;
                assert!(
                    (invariant - 4.0).abs() < 1e-5,
                    "sphere R=2 invariant: r²+d² = {invariant}, expected 4"
                );
            }
            _ => panic!("must remain Circle"),
        }
    }

    #[test]
    fn bezier_curve_offset_still_unsupported() {
        // V-β-β activated Arc/Circle, but Bezier remains W-3 scope.
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let bez = AnalyticCurve::Bezier {
            control_pts: vec![
                DVec3::ZERO,
                DVec3::new(0.5, 0.5, 0.0),
                DVec3::new(1.0, 0.0, 0.0),
            ],
        };
        mesh.edges[edge].set_curve(Some(bez));
        let err = mesh
            .offset_edge_on_host_face(edge, 0.1)
            .err()
            .expect("bezier deferred");
        assert!(matches!(
            err,
            OffsetEdgeError::UnsupportedCurveKind { kind: "Bezier" }
        ));
    }

    #[test]
    fn legacy_offset_edge_signature_unchanged() {
        // Regression — legacy `offset_edge(edge, dist, plane_normal)` still
        // exists and works for Line edges (free wire here).
        let mut mesh = Mesh::new();
        let (_v0, _v1, edge_id) = mesh
            .draw_line(DVec3::ZERO, DVec3::new(1.0, 0.0, 0.0))
            .unwrap();
        let result = mesh
            .offset_edge(edge_id, 0.5, DVec3::Y)
            .expect("legacy API still works");
        let p0 = mesh.vertex_pos(result.new_v0).unwrap();
        // edge_dir +X × normal +Y = +Z, so new pos has z = 0.5.
        assert!((p0.z - 0.5).abs() < 1e-9);
    }

    #[test]
    fn line_offset_degenerate_distance_rejected() {
        let mut mesh = Mesh::new();
        let (_face, vs) = build_unit_square_plane(&mut mesh);
        let edge = find_edge_between(&mesh, vs[0], vs[1]);
        let err = mesh
            .offset_edge_on_host_face(edge, 1e-9)
            .err()
            .expect("must reject zero dist");
        assert!(matches!(err, OffsetEdgeError::DegenerateDistance(_)));
    }
}
