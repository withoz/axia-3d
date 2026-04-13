/**
 * Scale Tool — uniform scale of selected faces from centroid
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class ScaleTool implements ITool {
  readonly name = 'scale';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[ScaleTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.transformActive) return;

    const selected = this.ctx.getSelectedFaces();
    if (selected.length > 0) {
      const centroid = this.ctx.bridge.facesCentroid(selected);
      if (centroid && point) {
        this.transformCentroid = centroid;
        this.transformStartPt = point.clone();
        this.transformActive = true;

        debugLog(`[Scale] Start drag, ${selected.length} faces, centroid=`,
          centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
      }
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid || !point) return;

    const centroid = this.transformCentroid;
    const startDist = this.transformStartPt.distanceTo(centroid);
    const currentDist = point.distanceTo(centroid);

    if (startDist > 1) {
      const ratio = currentDist / startDist;
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: centroid.clone(), to: point.clone(),
          text: `×${ratio.toFixed(2)}`, color: '#51cf66' },
      ]);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.transformActive && this.transformStartPt && this.transformCentroid) {
      const pt = this.ctx.get3DPoint(e);
      if (pt) {
        const centroid = this.transformCentroid;
        const startDist = this.transformStartPt.distanceTo(centroid);
        const currentDist = pt.distanceTo(centroid);
        if (startDist > 1) {
          const ratio = currentDist / startDist;
          if (Math.abs(ratio - 1.0) > 0.01) {
            const selected = this.ctx.getSelectedFaces();
            this.ctx.bridge.scaleFaces(selected,
              centroid.x, centroid.y, centroid.z,
              ratio, ratio, ratio,
            );
            debugLog(`[Scale] Applied ×${ratio.toFixed(3)}`);
            this.ctx.syncMesh();
          }
        }
      }

      console.log('[Scale] End drag');
      this.transformActive = false;
      this.transformStartPt = null;
      this.transformCentroid = null;
      this.ctx.dimLabel.clear();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number): void {
    const selected = this.ctx.getSelectedFaces();
    if (selected.length > 0) {
      const centroid = this.ctx.bridge.facesCentroid(selected);
      if (centroid) {
        this.ctx.bridge.scaleFaces(selected,
          centroid.x, centroid.y, centroid.z,
          value, value, value);
        console.log(`[VCB/Scale] Applied: ×${value}`);
        this.ctx.syncMesh();
      }
    }
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.ctx.dimLabel.clear();
  }
}
