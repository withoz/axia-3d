/**
 * Draw Circle Tool — Supports drawing on any plane (ground, face, Z-axis wall, etc.)
 *
 * Flow:
 *   1st click → detect drawing plane (face normal or ground) + set center
 *   mouse move → ray ∩ drawing plane → preview circle
 *   2nd click → ray ∩ drawing plane → commit circle to engine
 *
 * After the first click establishes a plane, ALL subsequent mouse positions
 * are computed by intersecting the camera ray with that plane. This ensures
 * the radius point always lies on the drawing plane regardless of where the
 * mouse is pointing in 3D space.
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { debugLog } from '../utils/debug';
import { getDrawCurveMode } from './DrawCurveSettings';

/** Max distance from center to prevent runaway geometry when ray grazes the plane */
const MAX_DRAW_DISTANCE = 50000;

export class DrawCircleTool implements ITool {
  readonly name = 'circle';

  private ctx: ToolContext;
  private circleCenter: THREE.Vector3 | null = null;
  private circlePreview: THREE.Line | null = null;
  private circleFill: THREE.Mesh | null = null;

  // Drawing plane (detected at first click)
  private plane: DrawPlaneInfo | null = null;
  private drawPlane3: THREE.Plane | null = null; // Three.js Plane for ray intersection

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[DrawCircleTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.circleCenter) {
      // ═══ First click: detect drawing plane + set center ═══
      if (!point) return;
      this.plane = this.ctx.getDrawPlane(e);
      this.circleCenter = point.clone();

      // 2026-04-28 — 바닥면 (default cardinal plane) 에서 z/y/x 좌표 정확히 0.
      //   Mouse picking 의 ray-plane intersection ε 오차 흡수.
      if (!this.plane.onFace) {
        const n = this.plane.normal;
        if (Math.abs(n.x) > 0.999) this.circleCenter.x = 0;
        else if (Math.abs(n.y) > 0.999) this.circleCenter.y = 0;
        else if (Math.abs(n.z) > 0.999) this.circleCenter.z = 0;
      }

      // Build Three.js Plane from normal + coplanar point for future ray intersections
      this.drawPlane3 = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.plane.normal, this.circleCenter,
      );

      this.ctx.snap.setReferencePoint(point);
    } else {
      // ═══ Second click: intersect ray with drawing plane → create circle ═══
      const planePoint = this.getPointOnDrawPlane(e);
      if (!planePoint || !this.plane) {
        this.cleanup();
        return;
      }

      const radius = this.circleCenter.distanceTo(planePoint);
      if (radius > 1) {
        const n = this.plane.normal;
        // ADR-089 A-λ-β — DrawCurveSettings flag check.
        // Curve mode (opt-in): kernel-native closed-curve face
        // (1 vert + 1 self-loop edge with AnalyticCurve::Circle).
        // Legacy mode (default): 24-segment polygon Shape (ADR-087 K-ε).
        if (getDrawCurveMode()) {
          this.ctx.bridge.drawCircleAsCurve(
            this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
            n.x, n.y, n.z,
            radius,
          );
          debugLog(`[Circle/Curve] Kernel-native R=${radius.toFixed(2)} on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
        } else {
          this.ctx.bridge.drawCircleAsShape(
            this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
            n.x, n.y, n.z,
            radius, 24,
          );
          debugLog(`[Circle] Created on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}): R=${radius.toFixed(2)}`);
        }
        // ADR-164 β-2 — Sticky last drawn plane (Q1=a face 합성 성공 후).
        this.ctx.setLastDrawnPlane?.({
          origin: this.circleCenter,
          normal: n,
          up: this.plane.up,
          source: 'view',
        });
        this.ctx.syncMesh();
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.circleCenter || !this.plane) {
      this.removePreview();
      return;
    }

    // Always use drawing plane intersection (not raw 3D point)
    const planePoint = this.getPointOnDrawPlane(e);
    if (!planePoint) {
      this.removePreview();
      return;
    }

    const radius = this.circleCenter.distanceTo(planePoint);
    if (radius > 0.1) {
      this.updatePreview(this.circleCenter, radius);

      // Dimension label: from center to current point on plane
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.circleCenter.clone(), to: planePoint, text: 'R ' + this.ctx.units.format(radius), color: '#da77f2' },
      ]);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    if (!this.circleCenter) return;

    // ADR-103-δ-1 (Z-up): fallback plane = XY ground (Z=0), normal +Z.
    const plane = this.plane || {
      normal: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      onFace: false,
    };

    const n = plane.normal;
    // ADR-089 A-λ-β — DrawCurveSettings flag check (VCB path).
    if (getDrawCurveMode()) {
      this.ctx.bridge.drawCircleAsCurve(
        this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
        n.x, n.y, n.z,
        value,
      );
      debugLog(`[VCB/Circle/Curve] Kernel-native R=${value} on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
    } else {
      this.ctx.bridge.drawCircleAsShape(
        this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
        n.x, n.y, n.z,
        value, 24,
      );
      debugLog(`[VCB/Circle] R=${value} on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
    }
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.circleCenter !== null;
  }

  cleanup(): void {
    this.circleCenter = null;
    this.plane = null;
    this.drawPlane3 = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  // ═══════════════════════════════════════════════════
  //  Drawing Plane Ray Intersection
  // ═══════════════════════════════════════════════════

  /**
   * Get a point on the drawing plane by intersecting the camera ray with it.
   * Returns null if the ray is nearly parallel to the plane (grazing angle)
   * or if the intersection is too far from the center point.
   */
  private getPointOnDrawPlane(e: MouseEvent): THREE.Vector3 | null {
    if (!this.drawPlane3 || !this.circleCenter) return null;

    // First check snap — if there's a snap point, project it onto the plane
    const rawPt = this.ctx.get3DPoint(e);
    const snapped = this.ctx.getSnappedPoint(e, rawPt);
    let result: THREE.Vector3 | null = null;
    if (snapped) {
      result = this.projectOntoPlane(snapped);
    } else {
      // No snap — intersect camera ray with drawing plane
      const ray = this.ctx.getRay(e);
      const target = new THREE.Vector3();
      const hit = ray.ray.intersectPlane(this.drawPlane3, target);
      if (!hit) return null;
      const dist = target.distanceTo(this.circleCenter);
      if (dist > MAX_DRAW_DISTANCE) return null;
      result = target;
    }
    if (!result) return null;

    // 2026-04-29 — 사용자 요청: 바닥면 cardinal plane 에서 normal-axis 좌표를
    //   circleCenter 의 같은 좌표 (정확히 0) 로 강제. f32 ray-plane intersection
    //   ε 오차 차단.
    if (this.plane && !this.plane.onFace) {
      const n = this.plane.normal;
      if (Math.abs(n.x) > 0.999) result.x = this.circleCenter.x;
      else if (Math.abs(n.y) > 0.999) result.y = this.circleCenter.y;
      else if (Math.abs(n.z) > 0.999) result.z = this.circleCenter.z;
    }
    return result;
  }

  /**
   * Project a 3D point onto the drawing plane (along the plane normal).
   */
  private projectOntoPlane(point: THREE.Vector3): THREE.Vector3 {
    if (!this.drawPlane3) return point.clone();
    const projected = point.clone();
    const dist = this.drawPlane3.distanceToPoint(projected);
    projected.addScaledVector(this.drawPlane3.normal, -dist);
    return projected;
  }

  // ═══════════════════════════════════════════════════
  //  Preview Rendering
  // ═══════════════════════════════════════════════════

  private updatePreview(center: THREE.Vector3, radius: number): void {
    this.removePreview();
    if (!this.plane) return;

    const n = this.plane.normal;
    const r = this.plane.right;
    const u = this.plane.up;
    const segments = 48;

    // ── Circle outline on the detected plane ──
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push(
        center.clone()
          .addScaledVector(r, cos * radius)
          .addScaledVector(u, sin * radius)
          .addScaledVector(n, 0.5),
      );
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xda77f2, linewidth: 1 });
    this.circlePreview = new THREE.Line(lineGeo, lineMat);
    this.circlePreview.renderOrder = 999;
    this.ctx.viewport.scene.add(this.circlePreview);

    // ── Semi-transparent fill ──
    const fillGeo = new THREE.CircleGeometry(radius, segments);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xda77f2,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.circleFill = new THREE.Mesh(fillGeo, fillMat);

    // Rotate CircleGeometry (default normal = +Z) to match drawing plane normal
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, n);
    this.circleFill.quaternion.copy(quat);

    // Offset slightly along normal to prevent z-fighting
    const offset = center.clone().addScaledVector(n, 0.5);
    this.circleFill.position.copy(offset);
    this.circleFill.renderOrder = 998;
    this.ctx.viewport.scene.add(this.circleFill);
  }

  private removePreview(): void {
    if (this.circlePreview) {
      this.ctx.viewport.scene.remove(this.circlePreview);
      this.circlePreview.geometry.dispose();
      (this.circlePreview.material as THREE.Material).dispose();
      this.circlePreview = null;
    }
    if (this.circleFill) {
      this.ctx.viewport.scene.remove(this.circleFill);
      this.circleFill.geometry.dispose();
      (this.circleFill.material as THREE.Material).dispose();
      this.circleFill = null;
    }
  }
}
