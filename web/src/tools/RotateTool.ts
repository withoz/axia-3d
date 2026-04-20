/**
 * Rotate Tool — rotate selected faces around centroid on XZ plane
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

export class RotateTool implements ITool {
  readonly name = 'rotate';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;
  private transformStartAngle: number = 0;
  /** 누적 회전 각도 (radian) — 180° wrap 감지용 (Phase 2 #2) */
  private totalAngleRad: number = 0;
  /** 회전 축 — axisLock 기반 (Phase 2 #3). 기본 Y */
  private rotationAxis: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[RotateTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  /** axisLock에 따라 회전축 선택 — 기본 Y (이전 하드코딩 제거) */
  private resolveRotationAxis(): { x: number; y: number; z: number } {
    const ax = this.ctx.axisLock || this.ctx.inferredAxis;
    if (ax === 'x') return { x: 1, y: 0, z: 0 };
    if (ax === 'z') return { x: 0, y: 0, z: 1 };
    // default or 'y'
    return { x: 0, y: 1, z: 0 };
  }

  /** 회전축 기준 평면에서의 각도 계산 (point → centroid 벡터를 평면 투영) */
  private angleInRotationPlane(p: THREE.Vector3, centroid: THREE.Vector3): number {
    const ax = this.rotationAxis;
    // 축별로 해당 평면(2축) 좌표 사용
    if (ax.x === 1) {
      // X축 회전 → YZ 평면 — atan2(dz, dy) (X축 주변 CCW 양의 방향)
      return Math.atan2(p.z - centroid.z, p.y - centroid.y);
    }
    if (ax.z === 1) {
      // Z축 회전 → XY 평면
      return Math.atan2(p.y - centroid.y, p.x - centroid.x);
    }
    // Y축 (기본) — XZ 평면
    return Math.atan2(p.z - centroid.z, p.x - centroid.x);
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.transformActive) return;

    const selected = this.ctx.getSelectedFaces();
    if (selected.length === 0) {
      // #13: 빈 선택 Toast
      Toast.info('회전할 면을 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.ctx.bridge.facesCentroid(selected);
    if (centroid && point) {
      this.transformCentroid = centroid;
      this.transformStartPt = point.clone();
      this.transformActive = true;
      this.totalAngleRad = 0;
      // #3: 회전축 결정
      this.rotationAxis = this.resolveRotationAxis();
      this.transformStartAngle = this.angleInRotationPlane(point, centroid);

      debugLog(`[Rotate] Start drag, ${selected.length} faces, axis=`,
        this.rotationAxis, 'centroid=',
        centroid.x.toFixed(1), centroid.y.toFixed(1), centroid.z.toFixed(1));
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid || !point) return;

    const selected = this.ctx.getSelectedFaces();
    const centroid = this.transformCentroid;

    const currentAngle = this.angleInRotationPlane(point, centroid);
    // #2: atan2 경계(±π) wrap 감지 — angleDiff를 [-π, π] 범위로 정규화
    let deltaRad = currentAngle - this.transformStartAngle;
    while (deltaRad > Math.PI) deltaRad -= 2 * Math.PI;
    while (deltaRad < -Math.PI) deltaRad += 2 * Math.PI;

    const deltaDeg = deltaRad * (180 / Math.PI);

    if (Math.abs(deltaDeg) > 0.1) {
      const ax = this.rotationAxis;
      this.ctx.bridge.rotateFaces(selected,
        centroid.x, centroid.y, centroid.z,
        ax.x, ax.y, ax.z,
        deltaDeg,
      );
      this.transformStartAngle = currentAngle;
      this.totalAngleRad += deltaRad;
      this.ctx.syncMesh();

      // #9: Y축 회전은 centroid 불변 → 재계산 생략. 다른 축도 centroid 유지 가능
      // (전체 회전이라 centroid 자체는 이동 안 함)

      const totalDeg = this.totalAngleRad * (180 / Math.PI);
      const axLabel = ax.x === 1 ? 'X' : ax.z === 1 ? 'Z' : 'Y';
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: centroid.clone(), to: point.clone(),
          text: `${totalDeg.toFixed(1)}° · ${axLabel}축`, color: '#da77f2' },
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
    if (selected.length === 0) {
      Toast.info('회전할 면을 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.ctx.bridge.facesCentroid(selected);
    if (!centroid) return;
    // #3: axisLock 반영 (이전엔 Y축 고정)
    const ax = this.resolveRotationAxis();
    this.ctx.bridge.rotateFaces(selected,
      centroid.x, centroid.y, centroid.z,
      ax.x, ax.y, ax.z, value);
    const axLabel = ax.x === 1 ? 'X' : ax.z === 1 ? 'Z' : 'Y';
    debugLog(`[VCB/Rotate] Applied: ${value}° ${axLabel}-axis`);
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.totalAngleRad = 0;
    this.ctx.dimLabel.clear();
  }
}
