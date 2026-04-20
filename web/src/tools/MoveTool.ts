/**
 * Move Tool — translate selected faces
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

type Target =
  | { kind: 'faces'; ids: number[] }
  | { kind: 'verts'; ids: number[]; edgeCount: number };

export class MoveTool implements ITool {
  readonly name = 'move';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformLastDelta: THREE.Vector3 = new THREE.Vector3();
  private target: Target | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[MoveTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  /**
   * 현재 선택을 Move 대상으로 변환.
   * 우선순위: 면 → 에지(정점으로 변환) → null.
   */
  private resolveTarget(): Target | null {
    const faces = this.ctx.getSelectedFaces();
    if (faces.length > 0) return { kind: 'faces', ids: faces };

    const edges = this.ctx.selection.getSelectedEdges();
    if (edges.length === 0) return null;

    // 에지 → 정점 ID 집합 (중복 제거)
    const vertSet = new Set<number>();
    for (const eid of edges) {
      const eps = this.ctx.bridge.getEdgeEndpoints(eid);
      if (eps.length === 2) {
        vertSet.add(eps[0]);
        vertSet.add(eps[1]);
      }
    }
    if (vertSet.size === 0) return null;
    return { kind: 'verts', ids: Array.from(vertSet), edgeCount: edges.length };
  }

  private translate(t: Target, dx: number, dy: number, dz: number): void {
    if (t.kind === 'faces') {
      this.ctx.bridge.translateFaces(t.ids, dx, dy, dz);
    } else {
      this.ctx.bridge.translateVerts(t.ids, dx, dy, dz);
    }
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.transformActive) return;

    const t = this.resolveTarget();
    if (!t) {
      // #13: 빈 선택 시 사용자 안내
      Toast.info('이동할 면 또는 에지를 먼저 선택하세요', 2000);
      return;
    }
    if (!point) return;

    this.target = t;
    this.transformStartPt = point.clone();
    this.transformActive = true;
    this.transformLastDelta.set(0, 0, 0);
    const label = t.kind === 'faces' ? `${t.ids.length} faces` : `${t.edgeCount} edges (${t.ids.length} verts)`;
    debugLog(`[Move] Start drag, ${label}`);
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.target || !point) return;

    const totalDelta = new THREE.Vector3().subVectors(point, this.transformStartPt);

    // #1: Axis lock을 드래그에도 반영 (이전엔 VCB만 반영)
    const axis = this.ctx.axisLock || this.ctx.inferredAxis;
    if (axis === 'x') { totalDelta.y = 0; totalDelta.z = 0; }
    else if (axis === 'y') { totalDelta.x = 0; totalDelta.z = 0; }
    else if (axis === 'z') { totalDelta.x = 0; totalDelta.y = 0; }

    const incDelta = new THREE.Vector3().subVectors(totalDelta, this.transformLastDelta);

    // #7: 0.1mm 임계값을 0.01mm로 낮춤 (정밀 조정 반영)
    if (incDelta.lengthSq() > 1e-4) {
      this.translate(this.target, incDelta.x, incDelta.y, incDelta.z);
      this.transformLastDelta.copy(totalDelta);
      this.ctx.syncMesh();

      const dist = totalDelta.length();
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.transformStartPt.clone(), to: point.clone(),
          text: this.ctx.units.format(dist) + (axis ? ` · ${axis.toUpperCase()}축` : ''),
          color: '#ffd43b' },
      ]);
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.transformActive) {
      debugLog('[Move] End drag');
      this.transformActive = false;
      this.transformStartPt = null;
      this.target = null;
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
    const t = this.resolveTarget();
    if (!t) {
      Toast.info('이동할 면 또는 에지를 먼저 선택하세요', 2000);
      return;
    }
    let dx = 0, dy = 0, dz = 0;
    const axis = this.ctx.axisLock || this.ctx.inferredAxis;
    if (axis === 'x') dx = value;
    else if (axis === 'y') dy = value;
    else if (axis === 'z') dz = value;
    else dx = value;
    this.translate(t, dx, dy, dz);
    debugLog(`[VCB/Move] Applied: (${dx},${dy},${dz}) → ${t.kind}`);
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.target = null;
    this.transformLastDelta.set(0, 0, 0);
    this.ctx.dimLabel.clear();
  }
}
