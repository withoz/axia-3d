/**
 * Draw Line Tool — SketchUp style line drawing (click → move → click, continuous)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class DrawLineTool implements ITool {
  readonly name = 'line';

  private ctx: ToolContext;
  private lineStart: THREE.Vector3 | null = null;
  private linePreview: THREE.Line | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[DrawLineTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;

    if (!this.lineStart) {
      // First click: set start point
      this.lineStart = point.clone();
      this.ctx.snap.setReferencePoint(point);
      this.ctx.axisLock = null;
      this.ctx.inferredAxis = 'free';
    } else {
      // Second click: create line → end point becomes next start point (continuous)
      const rawPt = this.ctx.getGroundPoint(e);
      const snapPt = this.ctx.getSnappedPoint(e, rawPt, true);
      let pt: THREE.Vector3 | null = null;

      if (snapPt && rawPt && snapPt.distanceTo(rawPt) > 0.01) {
        pt = snapPt;
      } else {
        const inferred = this.ctx.getAxisInferredPoint(e, this.lineStart);
        pt = inferred ? inferred.point : null;
      }

      if (pt) {
        const len = this.lineStart.distanceTo(pt);
        if (len > 1) {
          this.ctx.bridge.drawLine(
            this.lineStart.x, this.lineStart.y, this.lineStart.z,
            pt.x, pt.y, pt.z,
          );
          debugLog('[Line] Created 3D:', len.toFixed(2), 'mm');
          this.ctx.syncMesh();
        }
      }

      // Continuous drawing: end point becomes next start point
      this.lineStart = pt ? pt.clone() : null;
      this.removeLinePreview();
      this.ctx.clearAxisGuide();
      this.ctx.dimLabel.clear();
      this.ctx.axisLock = null;

      if (this.lineStart) {
        this.ctx.snap.setReferencePoint(this.lineStart);
      }
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.lineStart || !point) {
      this.removeLinePreview();
      return;
    }

    // Check snap first
    const rawPt = this.ctx.getGroundPoint(e);
    const snapPt = this.ctx.getSnappedPoint(e, rawPt);

    let pt: THREE.Vector3 | null = null;
    let axis: 'x' | 'y' | 'z' | 'free' = 'free';

    if (snapPt && rawPt && snapPt.distanceTo(rawPt) > 0.01) {
      pt = snapPt;
      axis = 'free';
    } else {
      const inferred = this.ctx.getAxisInferredPoint(e, this.lineStart);
      if (inferred) {
        pt = inferred.point;
        axis = inferred.axis;
      }
    }

    this.ctx.inferredAxis = axis;

    if (pt) {
      const axisColors: Record<string, number> = { x: 0xff3333, y: 0x3388ff, z: 0x33cc33, free: 0x74c0fc };
      const axisColorStr: Record<string, string> = { x: '#ff3333', y: '#3388ff', z: '#33cc33', free: '#74c0fc' };
      const axisNames: Record<string, string> = { x: 'X축', y: 'Y축(높이)', z: 'Z축', free: '' };

      this.updateLinePreview(this.lineStart, pt, axisColors[axis]);
      this.ctx.updateAxisGuide(this.lineStart, axis, pt);

      const len = this.lineStart.distanceTo(pt);
      if (len > 0.1) {
        const label = axisNames[axis] ? `${axisNames[axis]} ${this.ctx.units.format(len)}` : this.ctx.units.format(len);
        this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
          { from: this.lineStart.clone(), to: pt.clone(), text: label, color: axisColorStr[axis] },
        ]);
      }
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    if (!this.lineStart) return;

    const axis = this.ctx.axisLock || this.ctx.inferredAxis;
    let dir = new THREE.Vector3(1, 0, 0);
    if (axis === 'y') dir.set(0, 1, 0);
    else if (axis === 'z') dir.set(0, 0, 1);

    const endPt = this.lineStart.clone().add(dir.multiplyScalar(value));
    this.ctx.bridge.drawLine(
      this.lineStart.x, this.lineStart.y, this.lineStart.z,
      endPt.x, endPt.y, endPt.z,
    );
    debugLog(`[VCB/Line] Length=${value} axis=${axis}`);
    this.lineStart = endPt.clone();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.lineStart !== null;
  }

  cleanup(): void {
    this.lineStart = null;
    this.removeLinePreview();
    this.ctx.clearAxisGuide();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  private removeLinePreview(): void {
    if (this.linePreview) {
      this.ctx.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
      this.linePreview = null;
    }
  }

  private updateLinePreview(start: THREE.Vector3, end: THREE.Vector3, color: number = 0x333366): void {
    this.removeLinePreview();

    const points = [
      start.clone(),
      end.clone(),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color,
      fog: false,
      depthTest: true,
      depthWrite: false,
      linewidth: 1,
    });
    this.linePreview = new THREE.Line(geo, mat);
    this.linePreview.renderOrder = 10;
    // 라인 스케일을 증가하여 WebGL 1px 제한 극복
    this.linePreview.scale.set(3, 3, 1);
    this.ctx.viewport.scene.add(this.linePreview);
  }
}
