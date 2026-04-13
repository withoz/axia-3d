/**
 * Rotate Tool — rotate selected faces around centroid on XZ plane
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class RotateTool implements ITool {
  readonly name = 'rotate';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;
  private transformStartAngle: number = 0;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[RotateTool] Activated');
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

        const dx = point.x - centroid.x;
        const dz = point.z - centroid.z;
        this.transformStartAngle = Math.atan2(dz, dx);

        debugLog(`[Rotate] Start drag, ${selected.length} faces, centroid=`,
          centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
      }
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid || !point) return;

    const selected = this.ctx.getSelectedFaces();
    const centroid = this.transformCentroid;

    const dx = point.x - centroid.x;
    const dz = point.z - centroid.z;
    const currentAngle = Math.atan2(dz, dx);
    const angleDiff = (currentAngle - this.transformStartAngle) * (180 / Math.PI);

    if (Math.abs(angleDiff) > 0.1) {
      this.ctx.bridge.rotateFaces(selected,
        centroid.x, centroid.y, centroid.z,
        0, 1, 0,
        angleDiff,
      );
      this.transformStartAngle = currentAngle;
      this.ctx.syncMesh();

      const newCentroid = this.ctx.bridge.facesCentroid(selected);
      if (newCentroid) this.transformCentroid = newCentroid;

      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: centroid.clone(), to: point.clone(),
          text: `${angleDiff.toFixed(1)}°`, color: '#da77f2' },
      ]);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.transformActive) {
      debugLog('[Rotate] End drag');
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
        this.ctx.bridge.rotateFaces(selected,
          centroid.x, centroid.y, centroid.z,
          0, 1, 0, value);
        debugLog(`[VCB/Rotate] Applied: ${value}° Y-axis`);
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
