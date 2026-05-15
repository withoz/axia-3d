//! DXF File Import — 엔티티를 DCEL 메시로 변환
//!
//! 지원 엔티티:
//!   LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, 3DFACE, SOLID,
//!   ELLIPSE, SPLINE (선형 근사), POINT

use glam::DVec3;
use anyhow::Result;
use std::io::Cursor;

use crate::scene::Scene;
use axia_geo::{MaterialId, FaceId};

/// DXF 가져오기 결과 통계
#[derive(Clone, Debug, Default)]
pub struct DxfImportStats {
    pub lines: usize,
    pub polylines: usize,
    pub circles: usize,
    pub arcs: usize,
    pub faces_3d: usize,
    pub solids: usize,
    pub points: usize,
    pub ellipses: usize,
    pub splines: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

impl std::fmt::Display for DxfImportStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "DXF: {} lines, {} polylines, {} circles, {} arcs, {} 3dfaces, \
             {} solids, {} ellipses, {} splines ({} skipped, {} errors)",
            self.lines, self.polylines, self.circles, self.arcs,
            self.faces_3d, self.solids, self.ellipses,
            self.splines, self.skipped, self.errors.len()
        )
    }
}

/// DXF 좌표 → AXiA 좌표 변환.
/// ADR-103-ζ (Z-up): AXiA 가 DXF 와 동일 Z-up convention 으로 마이그레이션됨.
/// 이전: `(x, z, -y)` 회전 (Z-up → Y-up). 이후: identity (no rotation).
/// DXF 와 AXiA 모두 X=right, Y=forward, Z=up → 직접 매핑.
#[inline]
fn cv(x: f64, y: f64, z: f64) -> DVec3 {
    DVec3::new(x, y, z)
}

impl Scene {
    /// DXF 파일 바이트를 파싱하여 씬에 추가
    pub fn import_dxf(&mut self, data: &[u8]) -> Result<DxfImportStats> {
        let mut cursor = Cursor::new(data);
        let drawing = dxf::Drawing::load(&mut cursor)?;
        let mut stats = DxfImportStats::default();
        let mat = crate::FORM_MATERIAL;

        self.transactions.begin();
        self.transactions.set_before_snapshot(self.scene_snapshot());

        for entity in drawing.entities() {
            // face 수 비교로 새로 생성된 face 추적
            let faces_before: std::collections::HashSet<FaceId> =
                self.mesh.faces.iter().map(|(k, _)| k).collect();
            let entity_name = Self::dxf_entity_name(&entity.specific);
            let entity_position = Self::dxf_entity_position(&entity.specific);

            self.import_single_entity(&entity.specific, mat, &mut stats);

            // 새로 생성된 face가 있으면 XIA 생성
            let new_faces: Vec<FaceId> = self.mesh.faces.iter()
                .map(|(k, _)| k)
                .filter(|k| !faces_before.contains(k))
                .collect();
            if !new_faces.is_empty() {
                // State is computed from face_ids.len() — no explicit state needed
                self.create_xia_with_faces(entity_name, entity_position, new_faces);
            }
        }

        self.transactions.set_after_snapshot(self.scene_snapshot());
        self.transactions.commit();

        Ok(stats)
    }

    /// DXF 엔티티 타입명
    fn dxf_entity_name(specific: &dxf::entities::EntityType) -> String {
        use dxf::entities::EntityType;
        match specific {
            EntityType::Line(_) => "DXF-Line".into(),
            EntityType::LwPolyline(_) => "DXF-Polyline".into(),
            EntityType::Polyline(_) => "DXF-Polyline".into(),
            EntityType::Circle(_) => "DXF-Circle".into(),
            EntityType::Arc(_) => "DXF-Arc".into(),
            EntityType::Face3D(_) => "DXF-3DFace".into(),
            EntityType::Solid(_) => "DXF-Solid".into(),
            EntityType::Ellipse(_) => "DXF-Ellipse".into(),
            EntityType::Spline(_) => "DXF-Spline".into(),
            EntityType::ModelPoint(_) => "DXF-Point".into(),
            _ => "DXF-Entity".into(),
        }
    }

    /// DXF 엔티티의 대표 위치
    fn dxf_entity_position(specific: &dxf::entities::EntityType) -> DVec3 {
        use dxf::entities::EntityType;
        match specific {
            EntityType::Line(l) => cv(l.p1.x, l.p1.y, l.p1.z),
            EntityType::Circle(c) => cv(c.center.x, c.center.y, c.center.z),
            EntityType::Arc(a) => cv(a.center.x, a.center.y, a.center.z),
            EntityType::Ellipse(e) => cv(e.center.x, e.center.y, e.center.z),
            EntityType::Face3D(f) => cv(f.first_corner.x, f.first_corner.y, f.first_corner.z),
            EntityType::Solid(s) => cv(s.first_corner.x, s.first_corner.y, s.first_corner.z),
            EntityType::LwPolyline(lw) => {
                if let Some(v) = lw.vertices.first() { cv(v.x, v.y, 0.0) } else { DVec3::ZERO }
            }
            EntityType::Polyline(pl) => {
                if let Some(v) = pl.vertices().next() {
                    cv(v.location.x, v.location.y, v.location.z)
                } else { DVec3::ZERO }
            }
            _ => DVec3::ZERO,
        }
    }

    fn import_single_entity(
        &mut self,
        specific: &dxf::entities::EntityType,
        mat: MaterialId,
        stats: &mut DxfImportStats,
    ) {
        use dxf::entities::EntityType;

        match specific {
            // ── LINE ────────────────────────────────
            EntityType::Line(line) => {
                let p0 = cv(line.p1.x, line.p1.y, line.p1.z);
                let p1 = cv(line.p2.x, line.p2.y, line.p2.z);
                if (p1 - p0).length() > 1e-7 {
                    if let Err(e) = self.mesh.draw_line(p0, p1) {
                        stats.errors.push(format!("LINE: {}", e));
                    } else {
                        stats.lines += 1;
                    }
                }
            }

            // ── LWPOLYLINE (2D 폴리라인 — 가장 흔함) ──
            EntityType::LwPolyline(lwp) => {
                let verts: Vec<DVec3> =
                    lwp.vertices.iter().map(|v| cv(v.x, v.y, 0.0)).collect();

                if verts.len() >= 2 {
                    for pair in verts.windows(2) {
                        let _ = self.mesh.draw_line(pair[0], pair[1]);
                    }
                    // ✅ DXF 플래그 기반 닫힘 판별 (flags bit 0)
                    if lwp.is_closed() && verts.len() >= 3 {
                        let _ = self.mesh.draw_line(*verts.last().unwrap(), verts[0]);
                        self.try_create_face_oriented(&verts, mat);
                    }
                    stats.polylines += 1;
                }
            }

            // ── Polyline (R12 이전 호환) ────────────
            EntityType::Polyline(pl) => {
                let verts: Vec<DVec3> = pl.vertices()
                    .map(|v| cv(v.location.x, v.location.y, v.location.z))
                    .collect();

                if verts.len() >= 2 {
                    for pair in verts.windows(2) {
                        let _ = self.mesh.draw_line(pair[0], pair[1]);
                    }
                    // ✅ DXF 플래그 기반 닫힘 판별 (flags bit 0)
                    if pl.is_closed() && verts.len() >= 3 {
                        let _ = self.mesh.draw_line(*verts.last().unwrap(), verts[0]);
                        self.try_create_face_oriented(&verts, mat);
                    }
                    stats.polylines += 1;
                }
            }

            // ── CIRCLE ──────────────────────────────
            // NOTE: DXF OCS normal은 world normal로 취급 (XY-plane 가정).
            //       임의 기울어진 3D 원은 OCS→WCS 변환 필요 — MVP 이후 구현.
            EntityType::Circle(circle) => {
                let center = cv(circle.center.x, circle.center.y, circle.center.z);
                let normal = cv(circle.normal.x, circle.normal.y, circle.normal.z);
                let radius = circle.radius;

                if radius > 1e-7 {
                    let segments = Self::circle_segments(radius);
                    if let Err(e) = self.mesh.draw_circle(center, normal, radius, segments, mat) {
                        stats.errors.push(format!("CIRCLE: {}", e));
                    } else {
                        stats.circles += 1;
                    }
                }
            }

            // ── ARC ─────────────────────────────────
            // NOTE: DXF OCS normal은 world normal로 취급 (XY-plane 가정).
            EntityType::Arc(arc) => {
                let center = cv(arc.center.x, arc.center.y, arc.center.z);
                let normal = cv(arc.normal.x, arc.normal.y, arc.normal.z);
                let radius = arc.radius;
                let start_angle = arc.start_angle.to_radians();
                let end_angle = arc.end_angle.to_radians();

                if radius > 1e-7 {
                    let points = Self::arc_to_points(center, normal, radius, start_angle, end_angle);
                    for pair in points.windows(2) {
                        let _ = self.mesh.draw_line(pair[0], pair[1]);
                    }
                    stats.arcs += 1;
                }
            }

            // ── 3DFACE ─────────────────────────────
            EntityType::Face3D(f) => {
                let p0 = cv(f.first_corner.x, f.first_corner.y, f.first_corner.z);
                let p1 = cv(f.second_corner.x, f.second_corner.y, f.second_corner.z);
                let p2 = cv(f.third_corner.x, f.third_corner.y, f.third_corner.z);
                let p3 = cv(f.fourth_corner.x, f.fourth_corner.y, f.fourth_corner.z);

                if (p2 - p3).length() < 1e-7 {
                    self.try_create_face_oriented(&[p0, p1, p2], mat);
                } else {
                    self.try_create_face_oriented(&[p0, p1, p2, p3], mat);
                }
                stats.faces_3d += 1;
            }

            // ── SOLID (2D 솔리드) ───────────────────
            EntityType::Solid(s) => {
                let p0 = cv(s.first_corner.x, s.first_corner.y, s.first_corner.z);
                let p1 = cv(s.second_corner.x, s.second_corner.y, s.second_corner.z);
                let p2 = cv(s.third_corner.x, s.third_corner.y, s.third_corner.z);
                let p3 = cv(s.fourth_corner.x, s.fourth_corner.y, s.fourth_corner.z);

                if (p2 - p3).length() < 1e-7 {
                    self.try_create_face_oriented(&[p0, p1, p2], mat);
                } else {
                    // DXF SOLID 표준 순서: 0,1,3,2 (bowtie correction)
                    self.try_create_face_oriented(&[p0, p1, p3, p2], mat);
                }
                stats.solids += 1;
            }

            // ── ELLIPSE ─────────────────────────────
            EntityType::Ellipse(ellipse) => {
                let center = cv(ellipse.center.x, ellipse.center.y, ellipse.center.z);
                let major_end = DVec3::new(
                    ellipse.major_axis.x,
                    ellipse.major_axis.z,
                    -ellipse.major_axis.y,
                );
                let normal = cv(ellipse.normal.x, ellipse.normal.y, ellipse.normal.z);
                let minor_ratio = ellipse.minor_axis_ratio;
                let start_param = ellipse.start_parameter;
                let end_param = ellipse.end_parameter;

                let points = Self::ellipse_to_points(
                    center, major_end, normal, minor_ratio,
                    start_param, end_param,
                );

                let is_full = (end_param - start_param - std::f64::consts::TAU).abs() < 0.01;

                if points.len() >= 2 {
                    for pair in points.windows(2) {
                        let _ = self.mesh.draw_line(pair[0], pair[1]);
                    }
                    if is_full && points.len() >= 3 {
                        let _ = self.mesh.draw_line(*points.last().unwrap(), points[0]);
                        self.try_create_face_oriented(&points, mat);
                    }
                }
                stats.ellipses += 1;
            }

            // ── SPLINE (선형 근사) ──────────────────
            // NOTE: fit_points = 보간 지점, control_points = B-spline 제어점.
            //       현재는 선형 보간만 수행. 실제 곡선 평가는 MVP 이후 구현.
            EntityType::Spline(spline) => {
                let points: Vec<DVec3> = if !spline.fit_points.is_empty() {
                    spline.fit_points.iter()
                        .map(|p| cv(p.x, p.y, p.z))
                        .collect()
                } else {
                    spline.control_points.iter()
                        .map(|p| cv(p.x, p.y, p.z))
                        .collect()
                };

                if points.len() >= 2 {
                    for pair in points.windows(2) {
                        let _ = self.mesh.draw_line(pair[0], pair[1]);
                    }
                    stats.splines += 1;
                }
            }

            // ── POINT ───────────────────────────────
            EntityType::ModelPoint(_) => {
                stats.points += 1;
            }

            _ => stats.skipped += 1,
        }
    }

    // ─────────────────────────────────────────────
    // ✅ 안정화된 Face 생성 헬퍼
    // ─────────────────────────────────────────────

    /// Face 생성 — 중복 정점 제거 + 면적 검증 + winding 보정
    fn try_create_face_oriented(&mut self, points: &[DVec3], material: MaterialId) {
        if points.len() < 3 { return; }

        // 1) 연속 중복 제거
        let mut clean: Vec<DVec3> = Vec::with_capacity(points.len());
        for &p in points {
            if clean.last().map_or(true, |q: &DVec3| (p - *q).length() > 1e-6) {
                clean.push(p);
            }
        }
        // 첫-끝 중복 제거
        if clean.len() > 1 {
            if (clean[0] - *clean.last().unwrap()).length() <= 1e-6 {
                clean.pop();
            }
        }
        if clean.len() < 3 { return; }

        // 2) 면적 체크 — degenerate/collinear 방지 (3D Newell 방식)
        let normal = polygon_newell_normal(&clean);
        if normal.length() < 1e-8 { return; }

        // 3) Winding 보정: Newell normal이 Y+ 방향이 되도록
        if normal.y < 0.0 {
            clean.reverse();
        }

        let vids: Vec<_> = clean.iter()
            .map(|&p| self.mesh.add_vertex(p))
            .collect();
        let _ = self.mesh.add_face(&vids, material);
    }

    // ─────────────────────────────────────────────
    // 기하 헬퍼
    // ─────────────────────────────────────────────

    fn circle_segments(radius: f64) -> u32 {
        if radius < 10.0 { 24 }
        else if radius < 100.0 { 36 }
        else if radius < 1000.0 { 48 }
        else { 72 }
    }

    fn arc_to_points(
        center: DVec3, normal: DVec3, radius: f64,
        start_angle: f64, end_angle: f64,
    ) -> Vec<DVec3> {
        let n = normal.normalize();
        let arbitrary = if n.y.abs() < 0.9 { DVec3::Y } else { DVec3::X };
        let u = n.cross(arbitrary).normalize();
        let v = n.cross(u).normalize();

        let mut span = end_angle - start_angle;
        if span <= 0.0 { span += std::f64::consts::TAU; }

        let segs = ((span / std::f64::consts::TAU) * 36.0).ceil().max(3.0) as usize;
        let step = span / segs as f64;

        (0..=segs)
            .map(|i| {
                let a = start_angle + step * i as f64;
                center + u * (radius * a.cos()) + v * (radius * a.sin())
            })
            .collect()
    }

    fn ellipse_to_points(
        center: DVec3, major_axis: DVec3, normal: DVec3,
        minor_ratio: f64, start_param: f64, end_param: f64,
    ) -> Vec<DVec3> {
        let n = normal.normalize();
        let major_len = major_axis.length();
        if major_len < 1e-10 { return Vec::new(); }

        let u = major_axis / major_len;
        let v = n.cross(u).normalize();
        let minor_len = major_len * minor_ratio;

        let mut span = end_param - start_param;
        if span <= 0.0 { span += std::f64::consts::TAU; }

        let segs = ((span / std::f64::consts::TAU) * 48.0).ceil().max(3.0) as usize;
        let step = span / segs as f64;

        (0..=segs)
            .map(|i| {
                let t = start_param + step * i as f64;
                center + u * (major_len * t.cos()) + v * (minor_len * t.sin())
            })
            .collect()
    }
}

// ─── 모듈 수준 헬퍼 ─────────────────────────────────────

/// Newell's method — 임의 3D polygon의 법선 벡터 계산
/// (XZ 투영과 달리 기울어진 면도 정확)
fn polygon_newell_normal(pts: &[DVec3]) -> DVec3 {
    let mut n = DVec3::ZERO;
    let len = pts.len();
    for i in 0..len {
        let cur = pts[i];
        let next = pts[(i + 1) % len];
        n.x += (cur.y - next.y) * (cur.z + next.z);
        n.y += (cur.z - next.z) * (cur.x + next.x);
        n.z += (cur.x - next.x) * (cur.y + next.y);
    }
    n
}
