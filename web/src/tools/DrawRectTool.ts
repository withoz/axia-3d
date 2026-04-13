/**
 * Draw Rectangle Tool — SketchUp style rectangle drawing (click → move → click)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';

export class DrawRectTool implements ITool {
  readonly name = 'rect';

  private ctx: ToolContext;
  private rectStart: THREE.Vector3 | null = null;
  private rectPreview: THREE.Mesh | null = null;

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
      // First click: set start point
      this.rectStart = point.clone();
      this.ctx.snap.setReferencePoint(point);
    } else {
      // Second click: create rectangle
      if (point) {
        const center = new THREE.Vector3().addVectors(this.rectStart, point).multiplyScalar(0.5);
        const size = new THREE.Vector3().subVectors(point, this.rectStart);
        const width = Math.abs(size.x);
        const height = Math.abs(size.z);

        if (width > 1 && height > 1) {
          this.ctx.bridge.drawRect(
            center.x, center.y, center.z,
            0, 1, 0,
            0, 0, 1,
            width, height,
          );
          console.log('[Rect] Created 3D:', `${width.toFixed(2)} x ${height.toFixed(2)}`);
          this.ctx.syncMesh();
        }
      }
      this.cleanup();
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.rectStart || !point) {
      this.removeRectPreview();
      return;
    }

    this.updateRectPreview(this.rectStart, point);

    const w = Math.abs(point.x - this.rectStart.x);
    const h = Math.abs(point.z - this.rectStart.z);
    if (w > 0.001 || h > 0.001) {
      const s = this.rectStart;
      const minX = Math.min(s.x, point.x);
      const maxX = Math.max(s.x, point.x);
      const minZ = Math.min(s.z, point.z);
      const maxZ = Math.max(s.z, point.z);

      const gap = Math.max(w, h) * 0.08 + 100;
      const y = this.rectStart.y;

      const dimLines: any[] = [
        { from: new THREE.Vector3(minX, y, maxZ + gap), to: new THREE.Vector3(maxX, y, maxZ + gap), text: this.ctx.units.format(w), color: '#ff6b6b' },
        { from: new THREE.Vector3(minX - gap, y, minZ), to: new THREE.Vector3(minX - gap, y, maxZ), text: this.ctx.units.format(h), color: '#51cf66' },
      ];
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, dimLines);
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
    const cx = origin.x + w / 2;
    const cz = origin.z + h / 2;
    this.ctx.bridge.drawRect(cx, origin.y, cz, 0, 1, 0, 0, 0, 1, w, h);
    console.log(`[VCB/Rect] ${w}×${h}`);
    this.cleanup();
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.rectStart !== null;
  }

  cleanup(): void {
    this.rectStart = null;
    this.removeRectPreview();
    this.ctx.dimLabel.clear();
    this.ctx.snap.setReferencePoint(null);
  }

  private removeRectPreview(): void {
    if (this.rectPreview) {
      this.ctx.viewport.scene.remove(this.rectPreview);
      this.rectPreview.geometry.dispose();
      if (this.rectPreview.material instanceof THREE.Material) {
        this.rectPreview.material.dispose();
      }
      this.rectPreview = null;
    }
  }

  private updateRectPreview(start: THREE.Vector3, end: THREE.Vector3): void {
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.z - start.z);
    if (w < 0.001 || h < 0.001) return;

    this.removeRectPreview();

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    this.rectPreview = new THREE.Mesh(geo, mat);
    this.rectPreview.rotation.x = -Math.PI / 2;
    this.rectPreview.position.set(center.x, center.y + 0.5, center.z);
    this.ctx.viewport.scene.add(this.rectPreview);
  }
}
