/**
 * Draw Circle Tool — Supports drawing on any plane (ground, face, Z-axis wall, etc.)
 *
 * Flow:
 *   1st click → detect drawing plane (face normal or ground) + set center
 *   mouse move → preview circle on detected plane
 *   2nd click → commit circle to engine
 *
 * The drawing plane is determined by what's under the cursor at the first click:
 *   - On an existing face → use that face's DCEL normal
 *   - On empty space → use default ground plane (Y-up, XZ plane)
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';

export class DrawCircleTool implements ITool {
  readonly name = 'circle';

  private ctx: ToolContext;
  private circleCenter: THREE.Vector3 | null = null;
  private circlePreview: THREE.Line | null = null;
  private circleFill: THREE.Mesh | null = null;

  // Drawing plane (detected at first click)
  private plane: DrawPlaneInfo | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    console.log('[DrawCircleTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;

    if (!this.circleCenter) {
      // ═══ First click: detect drawing plane + set center ═══
      this.plane = this.ctx.getDrawPlane(e);
      this.circleCenter = point.clone();
      this.ctx.snap.setReferencePoint(point);
    } else {
      // ═══ Second click: create circle on the detected plane ═══
      const radius = this.computeRadius(this.circleCenter, point);
      if (radius > 1 && this.plane) {
        const n = this.plane.normal;
        this.ctx.bridge.drawCircle(
          this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
          n.x, n.y, n.z,
          radius, 24,
        );
        console.log(`[Circle] Created on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}): R=${radius.toFixed(2)}`);
        this.ctx.syncMesh();
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.circleCenter || !point || !this.plane) {
      this.removePreview();
      return;
    }

    const radius = this.computeRadius(this.circleCenter, point);
    if (radius > 0.1) {
      this.updatePreview(this.circleCenter, radius);

      // Dimension label: from center to current point
      const labelEnd = this.computeRadiusEndPoint(this.circleCenter, point, radius);
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.circleCenter.clone(), to: labelEnd, text: 'R ' + this.ctx.units.format(radius), color: '#da77f2' },
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

    const plane = this.plane || {
      normal: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      onFace: false,
    };

    const n = plane.normal;
    this.ctx.bridge.drawCircle(
      this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
      n.x, n.y, n.z,
      value, 24,
    );
    console.log(`[VCB/Circle] R=${value} on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.circleCenter !== null;
  }

  cleanup(): void {
    this.circleCenter = null;
    this.plane = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  // ═══════════════════════════════════════════════════
  //  Radius Computation
  // ═══════════════════════════════════════════════════

  /**
   * Compute the radius by projecting the delta onto the drawing plane.
   * This ensures mouse movement along the plane normal doesn't affect radius.
   */
  private computeRadius(center: THREE.Vector3, point: THREE.Vector3): number {
    if (!this.plane) return center.distanceTo(point);

    const delta = new THREE.Vector3().subVectors(point, center);
    // Project delta onto the plane (remove normal component)
    const normalComponent = delta.dot(this.plane.normal);
    const projected = delta.clone().addScaledVector(this.plane.normal, -normalComponent);
    return projected.length();
  }

  /**
   * Compute the end point for the radius dimension label,
   * projected onto the drawing plane from center toward current mouse point.
   */
  private computeRadiusEndPoint(center: THREE.Vector3, point: THREE.Vector3, radius: number): THREE.Vector3 {
    if (!this.plane) return point.clone();

    const delta = new THREE.Vector3().subVectors(point, center);
    const normalComponent = delta.dot(this.plane.normal);
    const projected = delta.clone().addScaledVector(this.plane.normal, -normalComponent);
    const len = projected.length();
    if (len < 0.001) {
      // Mouse is directly above/below center — use plane's right as fallback
      return center.clone().addScaledVector(this.plane.right, radius);
    }
    projected.normalize().multiplyScalar(radius);
    return center.clone().add(projected);
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
      // Point = center + cos*right*radius + sin*up*radius + small normal offset
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
