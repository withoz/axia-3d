/**
 * Draw Rectangle Tool — Supports drawing on any plane (ground, face, Z-axis wall, etc.)
 *
 * Flow:
 *   1st click → detect drawing plane (face normal or ground) + set start point
 *   mouse move → preview rectangle on detected plane
 *   2nd click → commit rectangle to engine
 *
 * The drawing plane is determined by what's under the cursor at the first click:
 *   - On an existing face → use that face's DCEL normal
 *   - On empty space → use default ground plane (Y-up, XZ plane)
 */

import * as THREE from 'three';
import { ITool, ToolContext, DrawPlaneInfo } from './ITool';

export class DrawRectTool implements ITool {
  readonly name = 'rect';

  private ctx: ToolContext;
  private rectStart: THREE.Vector3 | null = null;
  private rectPreview: THREE.Mesh | null = null;
  private rectOutline: THREE.LineLoop | null = null;

  // Drawing plane (detected at first click)
  private plane: DrawPlaneInfo | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    console.log('[DrawRectTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;

    if (!this.rectStart) {
      // ═══ First click: detect drawing plane + set start point ═══
      this.plane = this.ctx.getDrawPlane(e);
      this.rectStart = point.clone();
      this.ctx.snap.setReferencePoint(point);
    } else {
      // ═══ Second click: create rectangle on the detected plane ═══
      if (point && this.plane) {
        const { width, height } = this.computeLocalSize(this.rectStart, point);

        if (Math.abs(width) > 1 && Math.abs(height) > 1) {
          const center = this.computeCenter(this.rectStart, point);
          const n = this.plane.normal;
          const u = this.plane.up;

          this.ctx.bridge.drawRect(
            center.x, center.y, center.z,
            n.x, n.y, n.z,
            u.x, u.y, u.z,
            Math.abs(width), Math.abs(height),
          );
          console.log(`[Rect] Created on plane (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}): ${Math.abs(width).toFixed(2)} x ${Math.abs(height).toFixed(2)}`);
          this.ctx.syncMesh();
        }
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.rectStart || !point || !this.plane) {
      this.removePreview();
      return;
    }

    const { width, height } = this.computeLocalSize(this.rectStart, point);
    const absW = Math.abs(width);
    const absH = Math.abs(height);

    if (absW < 0.001 && absH < 0.001) return;

    // Update preview mesh on the detected plane
    this.updatePreview(this.rectStart, point, absW, absH);

    // Dimension labels
    if (absW > 0.1 || absH > 0.1) {
      this.updateDimLabels(this.rectStart, point, absW, absH);
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
    const plane = this.plane || {
      normal: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      onFace: false,
    };

    // Center = origin + right*(w/2) + up*(h/2)
    const center = origin.clone()
      .addScaledVector(plane.right, w / 2)
      .addScaledVector(plane.up, h / 2);

    this.ctx.bridge.drawRect(
      center.x, center.y, center.z,
      plane.normal.x, plane.normal.y, plane.normal.z,
      plane.up.x, plane.up.y, plane.up.z,
      w, h,
    );
    console.log(`[VCB/Rect] ${w}×${h}`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.rectStart !== null;
  }

  cleanup(): void {
    this.rectStart = null;
    this.plane = null;
    this.removePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
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
    const n = this.plane.normal;
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
