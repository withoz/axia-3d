/**
 * Draw Circle Tool — SketchUp style circle drawing (click center → move → click for radius)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';

export class DrawCircleTool implements ITool {
  readonly name = 'circle';

  private ctx: ToolContext;
  private circleCenter: THREE.Vector3 | null = null;
  private circlePreview: THREE.Line | null = null;

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
      // First click: set center point
      this.circleCenter = point.clone();
      this.ctx.snap.setReferencePoint(point);
    } else {
      // Second click: create circle
      const radius = this.circleCenter.distanceTo(point);
      if (radius > 1) {
        this.ctx.bridge.drawCircle(
          this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
          0, 1, 0,
          radius, 24,
        );
        console.log('[Circle] Created 3D: R', radius.toFixed(2), 'mm');
        this.ctx.syncMesh();
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.circleCenter || !point) {
      this.removeCirclePreview();
      return;
    }

    const radius = this.circleCenter.distanceTo(point);
    if (radius > 0.1) {
      this.updateCirclePreview(this.circleCenter, radius);
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.circleCenter.clone(), to: point.clone(), text: 'R ' + this.ctx.units.format(radius), color: '#da77f2' },
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

    this.ctx.bridge.drawCircle(
      this.circleCenter.x, this.circleCenter.y, this.circleCenter.z,
      0, 1, 0,
      value, 24,
    );
    console.log(`[VCB/Circle] R=${value}`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.circleCenter !== null;
  }

  cleanup(): void {
    this.circleCenter = null;
    this.removeCirclePreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  private removeCirclePreview(): void {
    if (this.circlePreview) {
      this.ctx.viewport.scene.remove(this.circlePreview);
      this.circlePreview.geometry.dispose();
      (this.circlePreview.material as THREE.Material).dispose();
      this.circlePreview = null;
    }
  }

  private updateCirclePreview(center: THREE.Vector3, radius: number): void {
    this.removeCirclePreview();

    const segments = 48;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + 0.5,
        center.z + Math.sin(angle) * radius,
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xda77f2, linewidth: 1 });
    this.circlePreview = new THREE.Line(geo, mat);
    this.ctx.viewport.scene.add(this.circlePreview);
  }
}
