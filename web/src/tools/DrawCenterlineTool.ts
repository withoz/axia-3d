/**
 * DrawCenterlineTool — 중심선(참조 축) 그리기.
 *
 * DrawLineTool의 단순화된 2-click 버전:
 *   - 1st click → 시작점 확정, 미리보기 표시
 *   - mousemove → 끝점 후보 따라가는 고스트 라인
 *   - 2nd click → bridge.drawCenterline() 호출 → 한 번에 commit
 *   - Esc → 현재 시작점 취소
 *
 * 중심선은 교차해도 분절되지 않고 face synthesis에도 참여하지 않음
 * (Rust Scene::exec_draw_centerline이 topology pipeline을 건너뜀).
 *
 * 연속 그리기를 지원하지 않아 복잡한 상태머신 불필요 — 건축 축 그리기
 * 시나리오는 일반적으로 각 축이 독립(X1/X2/X3/Y1/Y2...)이라 단발 커밋이 자연스럽다.
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { Toast } from '../ui/Toast';
import { debugLog } from '../utils/debug';

export class DrawCenterlineTool implements ITool {
  readonly name = 'centerline';
  readonly wantsSnap = true;

  private ctx: ToolContext;
  private startPt: THREE.Vector3 | null = null;
  private ghost: THREE.Line | null = null;

  constructor(ctx: ToolContext) { this.ctx = ctx; }

  onActivate(): void {
    debugLog('[CenterlineTool] Activated');
    Toast.info('📐 중심선 — 두 점 클릭 (교차해도 분절되지 않음, face 합성 제외). Esc 취소.', 4500);
  }

  onDeactivate(): void { this.cleanup(); }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!point) return;
    if (this.startPt === null) {
      this.startPt = point.clone();
      debugLog('[CenterlineTool] start', point);
      return;
    }
    // 2nd click → commit
    const start = this.startPt;
    const end = point.clone();
    if (start.distanceTo(end) < 0.1) {
      Toast.warning('시작점과 끝점이 같음 — 다시 클릭하세요', 2500);
      return;
    }
    const eid = this.ctx.bridge.drawCenterline(
      [start.x, start.y, start.z],
      [end.x, end.y, end.z],
    );
    if (eid >= 0) {
      this.ctx.syncMesh();
      debugLog(`[CenterlineTool] committed edge ${eid}`);
    } else {
      Toast.error('중심선 생성 실패 — ' + this.ctx.bridge.lastError(), 3000);
    }
    this.reset();
  }

  onMouseMove(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.startPt || !point) { this.clearGhost(); return; }
    this.updateGhost(this.startPt, point);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.reset();
  }

  isBusy(): boolean { return this.startPt !== null; }

  cleanup(): void { this.reset(); }

  private reset(): void {
    this.startPt = null;
    this.clearGhost();
  }

  private updateGhost(a: THREE.Vector3, b: THREE.Vector3): void {
    const scene = this.ctx.viewport.scene;
    if (!this.ghost) {
      const geom = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
      const mat = new THREE.LineDashedMaterial({
        color: 0x808090,
        dashSize: 120,
        gapSize: 60,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      });
      this.ghost = new THREE.Line(geom, mat);
      this.ghost.computeLineDistances();
      this.ghost.renderOrder = 1001;
      scene.add(this.ghost);
    } else {
      const positions = (this.ghost.geometry as THREE.BufferGeometry)
        .getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, a.x, a.y, a.z);
      positions.setXYZ(1, b.x, b.y, b.z);
      positions.needsUpdate = true;
      this.ghost.computeLineDistances();
      (this.ghost.geometry as THREE.BufferGeometry).computeBoundingSphere();
    }
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    const scene = this.ctx.viewport.scene;
    scene.remove(this.ghost);
    this.ghost.geometry.dispose();
    (this.ghost.material as THREE.Material).dispose();
    this.ghost = null;
  }
}
