/**
 * Draw Rectangle Tool — Supports drawing on any plane (ground, face, Z-axis wall, etc.)
 *
 * Flow:
 *   1st click → detect drawing plane (face normal or ground) + set start point
 *   mouse move → ray ∩ drawing plane → preview rectangle
 *   2nd click → ray ∩ drawing plane → commit rectangle to engine
 *
 * After the first click establishes a plane, ALL subsequent mouse positions
 * are computed by intersecting the camera ray with that plane. This ensures
 * the second point always lies on the drawing plane regardless of where the
 * mouse is pointing in 3D space.
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';
import { debugLog } from '../utils/debug';

/** Max distance from first click to prevent runaway geometry when ray grazes the plane */
const MAX_DRAW_DISTANCE = 50000;

export class DrawRectTool implements ITool {
  readonly name = 'rect';

  private ctx: ToolContext;
  private rectStart: THREE.Vector3 | null = null;
  private rectPreview: THREE.Mesh | null = null;
  private rectOutline: THREE.LineLoop | null = null;

  // Drawing plane (detected at first click)
  private plane: DrawPlaneInfo | null = null;
  private drawPlane3: THREE.Plane | null = null; // Three.js Plane for ray intersection

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[DrawRectTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.rectStart) {
      // ═══ First click: detect drawing plane + set start point ═══
      if (!point) return;
      this.plane = this.ctx.getDrawPlane(e);
      this.rectStart = point.clone();

      // 2026-04-28 — 사용자 요청: 바닥면에 그릴 때 z=0 정확히.
      //   Default cardinal plane (onFace=false) 인 경우 picked point 의
      //   normal-axis 좌표를 정확히 0 으로 snap.
      //   - 3D/Top/Bottom 뷰: floor = Three.js y=0 (= 사용자 z=0)
      //   - Front/Back 뷰: wall = Three.js z=0 (= 사용자 y=0)
      //   - Right/Left 뷰: wall = Three.js x=0
      //   Mouse picking 의 ray-plane intersection 정밀도 한계로 ε 오차가
      //   있으면 모든 후속 RECT 가 ε 만큼 떨어진 위치에 그려짐.
      if (!this.plane.onFace) {
        const n = this.plane.normal;
        if (Math.abs(n.x) > 0.999) this.rectStart.x = 0;
        else if (Math.abs(n.y) > 0.999) this.rectStart.y = 0;
        else if (Math.abs(n.z) > 0.999) this.rectStart.z = 0;
      }

      // Build Three.js Plane from normal + coplanar point for future ray intersections
      this.drawPlane3 = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.plane.normal, this.rectStart,
      );

      this.ctx.snap.setReferencePoint(point);
    } else {
      // ═══ Second click: intersect ray with drawing plane → create rect ═══
      const planePoint = this.getPointOnDrawPlane(e);
      if (!planePoint || !this.plane) {
        this.cleanup();
        return;
      }

      const { width, height } = this.computeLocalSize(this.rectStart, planePoint);

      if (Math.abs(width) > 1 && Math.abs(height) > 1) {
        const center = this.computeCenter(this.rectStart, planePoint);
        const n = this.plane.normal;
        const u = this.plane.up;

        // ADR-087 K-ε — kernel-aware drawRectAsShape only path.
        this.ctx.bridge.drawRectAsShape(
          center.x, center.y, center.z,
          n.x, n.y, n.z,
          u.x, u.y, u.z,
          Math.abs(width), Math.abs(height),
        );
        debugLog(`[Rect] Created on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}): ${Math.abs(width).toFixed(2)} x ${Math.abs(height).toFixed(2)}`);
        this.ctx.syncMesh();
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (!this.rectStart || !this.plane) {
      this.removePreview();
      return;
    }

    // Always use drawing plane intersection (not raw 3D point)
    const planePoint = this.getPointOnDrawPlane(e);
    if (!planePoint) {
      this.removePreview();
      return;
    }

    const { width, height } = this.computeLocalSize(this.rectStart, planePoint);
    const absW = Math.abs(width);
    const absH = Math.abs(height);

    if (absW < 0.001 && absH < 0.001) return;

    // Update preview mesh on the detected plane
    this.updatePreview(this.rectStart, planePoint, absW, absH);

    // Dimension labels
    if (absW > 0.1 || absH > 0.1) {
      this.updateDimLabels(this.rectStart, planePoint, absW, absH);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number, value2?: number): void {
    const w = value;
    const h = value2 != null ? value2 : value;
    const origin = this.rectStart || new THREE.Vector3(0, 0, 0);
    // ADR-103-δ-1 (Z-up): fallback plane = XY ground (Z=0), normal +Z.
    const plane = this.plane || {
      normal: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      onFace: false,
    };

    // Center = origin + right*(w/2) + up*(h/2)
    const center = origin.clone()
      .addScaledVector(plane.right, w / 2)
      .addScaledVector(plane.up, h / 2);

    // ADR-087 K-ε — kernel-aware drawRectAsShape only path.
    this.ctx.bridge.drawRectAsShape(
      center.x, center.y, center.z,
      plane.normal.x, plane.normal.y, plane.normal.z,
      plane.up.x, plane.up.y, plane.up.z,
      w, h,
    );
    debugLog(`[VCB/Rect] ${w}×${h}`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.rectStart !== null;
  }

  cleanup(): void {
    this.rectStart = null;
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
   * or if the intersection is too far from the start point.
   */
  private getPointOnDrawPlane(e: MouseEvent): THREE.Vector3 | null {
    if (!this.drawPlane3 || !this.rectStart) return null;

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
      if (!hit) return null; // Ray parallel to plane
      // Guard against grazing angles producing points far away
      const dist = target.distanceTo(this.rectStart);
      if (dist > MAX_DRAW_DISTANCE) return null;
      result = target;
    }
    if (!result) return null;

    // 2026-04-29 — 사용자 요청: 바닥면 (default cardinal plane) 에서 그릴 때
    //   ray-plane intersection 의 f32 정밀도 한계로 ε 오차가 발생할 수 있음.
    //   첫 클릭 (rectStart) 은 이미 axis=0 으로 snap 됐고 plane 이 그 점을
    //   지나가므로, 결과 point 의 normal-axis 좌표를 rectStart 의 같은 좌표
    //   (정확히 0) 로 강제. mouse picking ε 오차 → 엔진 단계 z 정밀도 손실 차단.
    if (this.plane && !this.plane.onFace) {
      const n = this.plane.normal;
      if (Math.abs(n.x) > 0.999) result.x = this.rectStart.x;
      else if (Math.abs(n.y) > 0.999) result.y = this.rectStart.y;
      else if (Math.abs(n.z) > 0.999) result.z = this.rectStart.z;
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
  //  Local Coordinate Computation
  // ═══════════════════════════════════════════════════

  /**
   * Project the delta between two 3D points onto the drawing plane's local axes.
   * Returns signed width (along right) and height (along up).
   */
  private computeLocalSize(start: THREE.Vector3, end: THREE.Vector3): { width: number; height: number } {
    if (!this.plane) return { width: 0, height: 0 };

    const delta = new THREE.Vector3().subVectors(end, start);
    const width = delta.dot(this.plane.right);
    const height = delta.dot(this.plane.up);
    return { width, height };
  }

  /**
   * Compute rectangle center from start/end on the drawing plane.
   */
  private computeCenter(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
    if (!this.plane) {
      return new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    }

    const { width, height } = this.computeLocalSize(start, end);
    return start.clone()
      .addScaledVector(this.plane.right, width / 2)
      .addScaledVector(this.plane.up, height / 2);
  }

  // ═══════════════════════════════════════════════════
  //  Preview Rendering
  // ═══════════════════════════════════════════════════

  private updatePreview(start: THREE.Vector3, end: THREE.Vector3, absW: number, absH: number): void {
    this.removePreview();
    if (!this.plane || absW < 0.001 || absH < 0.001) return;

    const center = this.computeCenter(start, end);
    const n = this.plane.normal;

    // ── Filled preview (semi-transparent) ──
    const geo = new THREE.PlaneGeometry(absW, absH);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rectPreview = new THREE.Mesh(geo, mat);

    // Rotate PlaneGeometry (default normal = +Z) to match drawing plane normal
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, n);
    this.rectPreview.quaternion.copy(quat);

    // Offset slightly along normal to prevent z-fighting
    const offset = center.clone().addScaledVector(n, 0.5);
    this.rectPreview.position.copy(offset);
    this.rectPreview.renderOrder = 998;
    this.ctx.viewport.scene.add(this.rectPreview);

    // ── Outline (wireframe border) ──
    const { width, height } = this.computeLocalSize(start, end);
    const r = this.plane.right;
    const u = this.plane.up;
    const hw = width / 2;
    const hh = height / 2;

    const corners = [
      center.clone().addScaledVector(r, -hw).addScaledVector(u, -hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r,  hw).addScaledVector(u, -hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r,  hw).addScaledVector(u,  hh).addScaledVector(n, 0.5),
      center.clone().addScaledVector(r, -hw).addScaledVector(u,  hh).addScaledVector(n, 0.5),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(corners);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2266dd, linewidth: 1 });
    this.rectOutline = new THREE.LineLoop(lineGeo, lineMat);
    this.rectOutline.renderOrder = 999;
    this.ctx.viewport.scene.add(this.rectOutline);
  }

  private updateDimLabels(start: THREE.Vector3, end: THREE.Vector3, absW: number, absH: number): void {
    if (!this.plane) return;

    const center = this.computeCenter(start, end);
    const { width, height } = this.computeLocalSize(start, end);
    const r = this.plane.right;
    const u = this.plane.up;
    const hw = width / 2;
    const hh = height / 2;

    // Width dimension line: along right axis at the far up edge
    const gap = Math.max(absW, absH) * 0.08 + 50;
    const wFrom = center.clone().addScaledVector(r, -hw).addScaledVector(u, hh).addScaledVector(u, Math.sign(height) * gap / absH * Math.abs(hh) || gap);
    const wTo   = center.clone().addScaledVector(r,  hw).addScaledVector(u, hh).addScaledVector(u, Math.sign(height) * gap / absH * Math.abs(hh) || gap);

    // Height dimension line: along up axis at the far right edge
    const hFrom = center.clone().addScaledVector(r, hw).addScaledVector(u, -hh).addScaledVector(r, Math.sign(width) * gap / absW * Math.abs(hw) || gap);
    const hTo   = center.clone().addScaledVector(r, hw).addScaledVector(u,  hh).addScaledVector(r, Math.sign(width) * gap / absW * Math.abs(hw) || gap);

    this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
      { from: wFrom, to: wTo, text: this.ctx.units.format(absW), color: '#ff6b6b' },
      { from: hFrom, to: hTo, text: this.ctx.units.format(absH), color: '#51cf66' },
    ]);
  }

  private removePreview(): void {
    if (this.rectPreview) {
      this.ctx.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry.dispose();
      (this.rectPreview.material as THREE.Material).dispose();
      this.rectPreview = null;
    }
    if (this.rectOutline) {
      this.ctx.viewport.scene.remove(this.rectOutline);
      this.rectOutline.geometry.dispose();
      (this.rectOutline.material as THREE.Material).dispose();
      this.rectOutline = null;
    }
  }
}
