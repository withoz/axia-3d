/**
 * Draw Arc Tool — 3-point arc (Phase I2, 2026-04-20).
 *
 * Flow:
 *   1st click → start point + detect drawing plane
 *   mouse move → preview chord (straight line)
 *   2nd click → end point
 *   mouse move → preview arc passing through cursor (bulge)
 *   3rd click → commit arc as tessellated polyline to DCEL
 *
 * Storage: Arc 원본은 Curve layer(TS)에 기록, DCEL에는 tessellated edges.
 * 재편집 시 원본 메타데이터로 재생성 가능 (I6 단계).
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { debugLog } from '../utils/debug';
import { arcFrom3Points, tessellateCurve } from '../curves/Curve';
import { getCurveRegistry } from '../curves/CurveRegistry';

export class DrawArcTool implements ITool {
  readonly name = 'arc';

  private ctx: ToolContext;
  private startPoint: THREE.Vector3 | null = null;
  private endPoint: THREE.Vector3 | null = null;
  private plane: DrawPlaneInfo | null = null;
  private drawPlane3: THREE.Plane | null = null;

  private previewLine: THREE.Line | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[DrawArcTool] Activated — 1st: 시작점, 2nd: 끝점, 3rd: 경유점');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.startPoint) {
      // ═══ 1st click: 시작점 + plane 결정 ═══
      if (!point) return;
      this.plane = this.ctx.getDrawPlane(e);
      this.startPoint = point.clone();
      this.drawPlane3 = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.plane.normal, this.startPoint,
      );
      this.ctx.snap.setReferencePoint(point);
      // ADR-166 β-2 — first_click plane lock (idempotent, L-166-2).
      this.ctx.lockPlane?.({
        origin: this.startPoint,
        normal: this.plane.normal,
        up: this.plane.up,
        source: 'first_click',
      });
      return;
    }

    if (!this.endPoint) {
      // ═══ 2nd click: 끝점 ═══
      const p = this.getPointOnDrawPlane(e);
      if (!p || !this.plane) { this.cleanup(); return; }
      if (p.distanceTo(this.startPoint) < 1) return; // 너무 짧으면 무시
      this.endPoint = p.clone();
      this.ctx.snap.setReferencePoint(p);
      return;
    }

    // ═══ 3rd click: 경유점 → arc 생성 ═══
    const through = this.getPointOnDrawPlane(e);
    if (!through || !this.plane) { this.cleanup(); return; }
    this.commitArc(this.startPoint, this.endPoint, through);
    this.cleanup();
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.startPoint || !this.plane) return;

    const p = this.getPointOnDrawPlane(e);
    if (!p) return;

    if (!this.endPoint) {
      // 1→2 단계: 직선 preview
      this.updateChordPreview(this.startPoint, p);
    } else {
      // 2→3 단계: arc preview
      this.updateArcPreview(this.startPoint, this.endPoint, p);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // 단계별 취소 — 전체 취소
      this.cleanup();
    }
  }

  applyVCBValue(_value: number): void {
    // Arc는 VCB 입력 현재 지원 안 함 (향후 라디우스/각도 입력 가능)
  }

  isBusy(): boolean {
    return this.startPoint !== null;
  }

  cleanup(): void {
    this.startPoint = null;
    this.endPoint = null;
    this.plane = null;
    this.drawPlane3 = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  // ═══════════════════════════════════════════════════
  //  Arc commit
  // ═══════════════════════════════════════════════════

  private commitArc(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const arc = arcFrom3Points(a, b, c, 32);
    if (!arc) {
      debugLog('[DrawArcTool] 3 points collinear — arc cannot be defined');
      return;
    }

    // Curve layer에 등록 (display / edit 용)
    getCurveRegistry().add(arc);

    // ADR-032 P17 — Promote on creation: drawArcWithCurve atomic API
    // attaches AnalyticCurve::Arc to each segment edge.
    const segments = arc.segments ?? 32;
    const ok = this.ctx.bridge.drawArcWithCurve(
      arc.center[0], arc.center[1], arc.center[2],
      arc.radius,
      arc.planeNormal[0], arc.planeNormal[1], arc.planeNormal[2],
      arc.xAxis[0], arc.xAxis[1], arc.xAxis[2],
      arc.startAngle, arc.endAngle,
      segments,
    );

    if (ok < 0) {
      // Fallback to plain polyline if engine missing the promote API.
      const pts = tessellateCurve(arc);
      const flat = new Float64Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) {
        flat[i * 3]     = pts[i].x;
        flat[i * 3 + 1] = pts[i].y;
        flat[i * 3 + 2] = pts[i].z;
      }
      // ADR-087 K-ζ — kernel-aware drawPolylineAsShape only.
      this.ctx.bridge.drawPolylineAsShape(flat);
    }

    // ADR-164 β-2 — Sticky last drawn plane (arc plane = planeNormal + xAxis).
    const arcNormal = new THREE.Vector3(arc.planeNormal[0], arc.planeNormal[1], arc.planeNormal[2]);
    const arcUp = new THREE.Vector3(arc.xAxis[0], arc.xAxis[1], arc.xAxis[2]);
    const arcOrigin = new THREE.Vector3(arc.center[0], arc.center[1], arc.center[2]);
    this.ctx.setLastDrawnPlane?.({
      origin: arcOrigin,
      normal: arcNormal,
      up: arcUp,
      source: 'view',
    });

    this.ctx.syncMesh();
    debugLog(
      `[Arc] R=${arc.radius.toFixed(2)} angle=${((arc.endAngle - arc.startAngle) * 180 / Math.PI).toFixed(1)}°` +
      ` (${segments} segments, analytic Arc attached)`
    );
  }

  // ═══════════════════════════════════════════════════
  //  Plane ray intersection (shared logic with DrawCircleTool)
  // ═══════════════════════════════════════════════════

  private getPointOnDrawPlane(e: MouseEvent): THREE.Vector3 | null {
    if (!this.drawPlane3 || !this.startPoint) return null;
    const rawPt = this.ctx.get3DPoint(e);
    const snapped = this.ctx.getSnappedPoint(e, rawPt);
    if (snapped) return this.projectOntoPlane(snapped);

    const ray = this.ctx.getRay(e);
    const target = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(this.drawPlane3, target);
    if (!hit) return null;
    if (target.distanceTo(this.startPoint) > 50000) return null;
    return target;
  }

  private projectOntoPlane(p: THREE.Vector3): THREE.Vector3 {
    if (!this.drawPlane3) return p.clone();
    const projected = p.clone();
    const dist = this.drawPlane3.distanceToPoint(projected);
    projected.addScaledVector(this.drawPlane3.normal, -dist);
    return projected;
  }

  // ═══════════════════════════════════════════════════
  //  Preview
  // ═══════════════════════════════════════════════════

  private updateChordPreview(a: THREE.Vector3, b: THREE.Vector3): void {
    this.removePreview();
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: 0xda77f2 });
    this.previewLine = new THREE.Line(geo, mat);
    this.previewLine.renderOrder = 999;
    this.ctx.viewport.scene.add(this.previewLine);
  }

  private updateArcPreview(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    this.removePreview();
    const arc = arcFrom3Points(a, b, c, 24);
    if (!arc) {
      // Fallback: 직선
      this.updateChordPreview(a, b);
      return;
    }
    const pts = tessellateCurve(arc);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xda77f2, linewidth: 2 });
    this.previewLine = new THREE.Line(geo, mat);
    this.previewLine.renderOrder = 999;
    this.ctx.viewport.scene.add(this.previewLine);

    // 반지름 dim label
    const center = new THREE.Vector3(...arc.center);
    this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
      { from: center, to: a, text: 'R ' + this.ctx.units.format(arc.radius), color: '#da77f2' },
    ]);
  }

  private removePreview(): void {
    if (this.previewLine) {
      this.ctx.viewport.scene.remove(this.previewLine);
      (this.previewLine.geometry as THREE.BufferGeometry).dispose();
      (this.previewLine.material as THREE.Material).dispose();
      this.previewLine = null;
    }
  }
}
