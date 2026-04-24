/**
 * Scale Tool — uniform scale of selected faces from centroid
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

type Target =
  | { kind: 'faces'; ids: number[] }
  | { kind: 'verts'; ids: number[]; edgeCount: number };

export class ScaleTool implements ITool {
  readonly name = 'scale';

  private ctx: ToolContext;
  private transformActive: boolean = false;
  private transformStartPt: THREE.Vector3 | null = null;
  private transformCentroid: THREE.Vector3 | null = null;
  private target: Target | null = null;
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

  private resolveTarget(): Target | null {
    const faces = this.ctx.getSelectedFaces();
    if (faces.length > 0) return { kind: 'faces', ids: faces };
    const edges = this.ctx.selection.getSelectedEdges();
    if (edges.length === 0) return null;
    const vertSet = new Set<number>();
    for (const eid of edges) {
      const eps = this.ctx.bridge.getEdgeEndpoints(eid);
      if (eps.length === 2) { vertSet.add(eps[0]); vertSet.add(eps[1]); }
    }
    if (vertSet.size === 0) return null;
    return { kind: 'verts', ids: Array.from(vertSet), edgeCount: edges.length };
  }

  private targetCentroid(t: Target): THREE.Vector3 | null {
    if (t.kind === 'faces') return this.ctx.bridge.facesCentroid(t.ids);
    const sum = new THREE.Vector3();
    let n = 0;
    for (const v of t.ids) {
      const p = this.ctx.bridge.getVertexPos(v);
      if (p) { sum.x += p[0]; sum.y += p[1]; sum.z += p[2]; n++; }
    }
    return n > 0 ? sum.multiplyScalar(1 / n) : null;
  }

  /**
   * 대상에 비균일 스케일 적용. Faces는 scaleFaces, Verts는 scaleVerts —
   * 양쪽 모두 단일 WASM 호출 + 단일 undo 트랜잭션.
   */
  private scale(t: Target, cx: number, cy: number, cz: number,
                sx: number, sy: number, sz: number): void {
    if (t.kind === 'faces') {
      this.ctx.bridge.scaleFaces(t.ids, cx, cy, cz, sx, sy, sz);
    } else {
      this.ctx.bridge.scaleVerts(t.ids, cx, cy, cz, sx, sy, sz);
    }
  }

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.transformActive) return;

    const t = this.resolveTarget();
    if (!t) {
      // #13: 빈 선택 Toast
      Toast.info('크기 조정할 면 또는 에지를 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.targetCentroid(t);
    if (centroid && point) {
      this.target = t;
      this.transformCentroid = centroid;
      this.transformStartPt = point.clone();
      this.transformActive = true;
      this.lastAppliedRatio = 1.0;
      const label = t.kind === 'faces' ? `${t.ids.length} faces` : `${t.edgeCount} edges`;
      debugLog(`[Scale] Start drag, ${label}`);
    }
  }

  onMouseMove(_e: MouseEvent, point: THREE.Vector3 | null): void {
    if (!this.transformActive || !this.transformStartPt || !this.transformCentroid
        || !this.target || !point) return;

    const centroid = this.transformCentroid;
    const startDist = this.transformStartPt.distanceTo(centroid);
    const currentDist = point.distanceTo(centroid);

    // #10: startDist 임계값 1mm → 0.01mm 완화. 0이면 division 방지만.
    if (startDist > 0.01) {
      const targetRatio = currentDist / startDist;
      // #4: 실시간 프리뷰 — incremental scale 적용.
      const incRatio = targetRatio / this.lastAppliedRatio;
      if (Math.abs(incRatio - 1.0) > 0.001) {
        this.scale(this.target,
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

  onMouseUp(_e: MouseEvent): void {
    if (this.transformActive) {
      debugLog('[Scale] End drag, final ratio=', this.lastAppliedRatio.toFixed(3));
      this.transformActive = false;
      this.transformStartPt = null;
      this.transformCentroid = null;
      this.target = null;
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
    const t = this.resolveTarget();
    if (!t) {
      Toast.info('크기 조정할 면 또는 에지를 먼저 선택하세요', 2000);
      return;
    }
    const centroid = this.targetCentroid(t);
    if (!centroid) return;
    const sx = value;
    const sy = value2 !== undefined ? value2 : value;
    const sz = value3 !== undefined ? value3 : value;
    if (sx === 0 || sy === 0 || sz === 0) {
      Toast.warning('스케일 값이 0이면 면이 퇴화됩니다 (거부)', 3000);
      return;
    }
    this.scale(t, centroid.x, centroid.y, centroid.z, sx, sy, sz);
    debugLog(`[VCB/Scale] Applied: (${sx}, ${sy}, ${sz}) → ${t.kind}`);
    this.ctx.syncMesh();
  }

  isBusy(): boolean {
    return this.transformActive;
  }

  cleanup(): void {
    this.transformActive = false;
    this.transformStartPt = null;
    this.transformCentroid = null;
    this.target = null;
    this.lastAppliedRatio = 1.0;
    this.ctx.dimLabel.clear();
  }
}
