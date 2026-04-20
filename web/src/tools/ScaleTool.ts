/**
 * Scale Tool — uniform scale of selected faces from centroid
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

export class ScaleTool implements ITool {
  readonly name = 'scale';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;
  /** 매 프레임 이전 ratio — incremental scale 적용용 (Phase 1 #4) */
  private lastAppliedRatio: number = 1.0;

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
    if (selected.length === 0) {
      // #13: 빈 선택 Toast
      Toast.info('크기 조정할 면을 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.ctx.bridge.facesCentroid(selected);
    if (centroid && point) {
      this.transformCentroid = centroid;
      this.transformStartPt = point.clone();
      this.transformActive = true;
      this.lastAppliedRatio = 1.0;
      debugLog(`[Scale] Start drag, ${selected.length} faces, centroid=`,
        centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid || !point) return;

    const centroid = this.transformCentroid;
    const startDist = this.transformStartPt.distanceTo(centroid);
    const currentDist = point.distanceTo(centroid);

    // #10: startDist 임계값 1mm → 0.01mm 완화. 0이면 division 방지만.
    if (startDist > 0.01) {
      const targetRatio = currentDist / startDist;
      // #4: 실시간 프리뷰 — incremental scale 적용.
      // 누적 ratio vs 이전 ratio의 델타만큼만 추가 적용.
      const incRatio = targetRatio / this.lastAppliedRatio;
      if (Math.abs(incRatio - 1.0) > 0.001) {
        const selected = this.ctx.getSelectedFaces();
        this.ctx.bridge.scaleFaces(selected,
          centroid.x, centroid.y, centroid.z,
          incRatio, incRatio, incRatio,
        );
        this.lastAppliedRatio = targetRatio;
        this.ctx.syncMesh();
      }
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: centroid.clone(), to: point.clone(),
          text: `×${targetRatio.toFixed(2)}`, color: '#51cf66' },
      ]);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.transformActive) {
      debugLog('[Scale] End drag, final ratio=', this.lastAppliedRatio.toFixed(3));
      this.transformActive = false;
      this.transformStartPt = null;
      this.transformCentroid = null;
      this.lastAppliedRatio = 1.0;
      this.ctx.dimLabel.clear();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  applyVCBValue(value: number, value2?: number, value3?: number): void {
    // Phase 3 #5+#12: 비균일 + 음수 scale 지원
    //   단일 값: uniform (예: 2 → ×2×2×2)
    //   두/세 값: 비균일 (VCB에서 "2,1,1" 형식)
    //   음수: mirror (예: -1,1,1 → X축 거울)
    const selected = this.ctx.getSelectedFaces();
    if (selected.length === 0) {
      Toast.info('크기 조정할 면을 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.ctx.bridge.facesCentroid(selected);
    if (!centroid) return;
    const sx = value;
    const sy = value2 !== undefined ? value2 : value;
    const sz = value3 !== undefined ? value3 : value;
    if (sx === 0 || sy === 0 || sz === 0) {
      Toast.warning('스케일 값이 0이면 면이 퇴화됩니다 (거부)', 3000);
      return;
    }
    this.ctx.bridge.scaleFaces(selected,
      centroid.x, centroid.y, centroid.z,
      sx, sy, sz);
    debugLog(`[VCB/Scale] Applied: (${sx}, ${sy}, ${sz})`);
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.lastAppliedRatio = 1.0;
    this.ctx.dimLabel.clear();
  }
}
