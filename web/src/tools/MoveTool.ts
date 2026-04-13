/**
 * Move Tool — translate selected faces
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class MoveTool implements ITool {
  readonly name = 'move';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;
  private transformLastDelta: THREE.Vector3 = new THREE.Vector3();

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[MoveTool] Activated');
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
        this.transformLastDelta.set(0, 0, 0);
        debugLog(`[Move] Start drag, ${selected.length} faces, centroid=`,
          centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
      }
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid || !point) return;

    const selected = this.ctx.getSelectedFaces();
    const totalDelta = new THREE.Vector3().subVectors(point, this.transformStartPt);
    const incDelta = new THREE.Vector3().subVectors(totalDelta, this.transformLastDelta);

    if (incDelta.length() > 0.1) {
      this.ctx.bridge.translateFaces(selected, incDelta.x, incDelta.y, incDelta.z);
      this.transformLastDelta.copy(totalDelta);
      this.ctx.syncMesh();

      const dist = totalDelta.length();
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.transformStartPt.clone(), to: point.clone(),
          text: this.ctx.units.format(dist), color: '#ffd43b' },
      ]);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.transformActive) {
      debugLog('[Move] End drag');
      this.transformActive = false;
      this.transformStartPt = null;
      this.transformCentroid = null;
      this.transformLastDelta.set(0, 0, 0);
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
      let dx = 0, dy = 0, dz = 0;
      const axis = this.ctx.axisLock || this.ctx.inferredAxis;
      if (axis === 'x') dx = value;
      else if (axis === 'y') dy = value;
      else if (axis === 'z') dz = value;
      else dx = value;
      this.ctx.bridge.translateFaces(selected, dx, dy, dz);
      debugLog(`[VCB/Move] Applied: (${dx},${dy},${dz})`);
      this.ctx.syncMesh();
    }
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.transformLastDelta.set(0, 0, 0);
    this.ctx.dimLabel.clear();
  }
}
