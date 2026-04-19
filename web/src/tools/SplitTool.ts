/**
 * Split Tool — hover + click 기반 엣지 분할 도구.
 *
 * UX:
 *  - 마우스를 엣지 위에 올리면 해당 엣지가 파란색으로 강조.
 *  - snap이 있으면 snap 점(midpoint 등)을 사용, 아니면 엣지 위 최단 투영점 사용.
 *  - 초록 원형 마커가 분할 예상 위치를 미리보기.
 *  - 클릭 시 해당 위치에서 edge split 실행.
 *  - ESC로 도구 종료 동작은 ToolManager가 관리(select로 복귀).
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

const HOVER_COLOR = 0x3498db;
const MARKER_COLOR = 0x2ecc71;

export class SplitTool implements ITool {
  readonly name = 'split';
  // snap을 사용 — midpoint/endpoint 등 SnapManager 결과를 엣지 투영 전에 고려.
  readonly wantsSnap = true;

  private ctx: ToolContext;
  private hoverEdgeId: number | null = null;
  private hoverLine: THREE.Line | null = null;
  private marker: THREE.Mesh | null = null;
  /** 현재 호버된 엣지 위의 분할 예정 위치. 클릭 시 splitEdge 호출. */
  private splitPoint: THREE.Vector3 | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = 'crosshair';
    debugLog('[SplitTool] Activated');
  }

  onDeactivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = '';
    this.clearHover();
    this.clearMarker();
    this.hoverEdgeId = null;
    this.splitPoint = null;
  }

  onMouseMove(e: MouseEvent, snapPoint: THREE.Vector3 | null): void {
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY);

    if (!picked || picked.type !== 'edge' || picked.hit.index == null || !this.ctx.edgeMap) {
      this.clearHover();
      this.clearMarker();
      this.hoverEdgeId = null;
      this.splitPoint = null;
      return;
    }

    const segIdx = picked.hit.index;
    const edgeId = this.ctx.edgeMap[segIdx];
    if (edgeId === undefined) return;

    // 엣지 엔드포인트 조회
    const eps = this.ctx.bridge.getEdgeEndpoints(edgeId);
    if (eps.length !== 2) return;
    const p0arr = this.ctx.bridge.getVertexPos(eps[0]);
    const p1arr = this.ctx.bridge.getVertexPos(eps[1]);
    if (!p0arr || !p1arr) return;
    const p0 = new THREE.Vector3(p0arr[0], p0arr[1], p0arr[2]);
    const p1 = new THREE.Vector3(p1arr[0], p1arr[1], p1arr[2]);

    // Snap 포인트가 있으면 그것을 엣지 위에 투영 (endpoint 매우 가까우면 제외)
    const source = snapPoint ?? picked.hit.point;
    const projected = this.projectOntoSegment(source, p0, p1);

    // Endpoint clamp: t<0.02 or t>0.98 rejects split near endpoints
    const d = new THREE.Vector3().subVectors(p1, p0);
    const t = d.lengthSq() > 0 ? new THREE.Vector3().subVectors(projected, p0).dot(d) / d.lengthSq() : 0.5;

    this.hoverEdgeId = edgeId;
    this.splitPoint = projected;

    this.updateHoverLine(p0, p1);
    this.updateMarker(projected, t >= 0.02 && t <= 0.98);
  }

  onMouseDown(_e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (this.hoverEdgeId === null || !this.splitPoint) {
      Toast.warning('엣지 위에서 클릭하세요');
      return;
    }
    const p = this.splitPoint;
    const newVid = this.ctx.bridge.splitEdge(this.hoverEdgeId, p.x, p.y, p.z);
    if (newVid >= 0) {
      this.ctx.selection.clearSelection();
      this.ctx.syncMesh();
      Toast.info(`엣지 분할 → 새 vertex ${newVid}`, 1500);
      debugLog(`[SplitTool] split edge=${this.hoverEdgeId} at (${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) → vert ${newVid}`);
    } else {
      const err = this.ctx.bridge.lastError();
      Toast.error(err || '엣지 분할 실패 (끝점 근처거나 내부 오류)', 2500);
    }
    // Hover state 갱신을 위해 clear
    this.clearHover();
    this.clearMarker();
    this.hoverEdgeId = null;
    this.splitPoint = null;
  }

  isBusy(): boolean {
    return false; // 매 클릭 단발 동작 — busy 상태 없음
  }

  cleanup(): void {
    this.clearHover();
    this.clearMarker();
  }

  // ───────────────────────────────────────────

  private projectOntoSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    const ab = new THREE.Vector3().subVectors(b, a);
    const len2 = ab.lengthSq();
    if (len2 < 1e-12) return a.clone();
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
    return a.clone().add(ab.multiplyScalar(t));
  }

  private updateHoverLine(p0: THREE.Vector3, p1: THREE.Vector3): void {
    if (!this.hoverLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: HOVER_COLOR, linewidth: 3, depthTest: false, transparent: true, opacity: 0.9,
      });
      this.hoverLine = new THREE.Line(geo, mat);
      this.hoverLine.renderOrder = 999;
      this.ctx.viewport.scene.add(this.hoverLine);
    }
    const pos = this.hoverLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, p0.x, p0.y, p0.z);
    pos.setXYZ(1, p1.x, p1.y, p1.z);
    pos.needsUpdate = true;
    (this.hoverLine.geometry as THREE.BufferGeometry).computeBoundingSphere();
  }

  private updateMarker(p: THREE.Vector3, valid: boolean): void {
    if (!this.marker) {
      const geo = new THREE.SphereGeometry(1, 12, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: MARKER_COLOR, depthTest: false, transparent: true, opacity: 0.9,
      });
      this.marker = new THREE.Mesh(geo, mat);
      this.marker.renderOrder = 1000;
      this.ctx.viewport.scene.add(this.marker);
    }
    // 카메라 거리에 비례한 크기 (약 6px 상당)
    const cam = this.ctx.viewport.activeCamera as THREE.PerspectiveCamera;
    const dist = cam.position.distanceTo(p);
    const r = Math.max(2, dist * 0.008);
    this.marker.scale.setScalar(r);
    this.marker.position.copy(p);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(
      valid ? MARKER_COLOR : 0xff6b6b,
    );
    this.marker.visible = true;
  }

  private clearHover(): void {
    if (this.hoverLine) {
      this.ctx.viewport.scene.remove(this.hoverLine);
      this.hoverLine.geometry.dispose();
      (this.hoverLine.material as THREE.Material).dispose();
      this.hoverLine = null;
    }
  }

  private clearMarker(): void {
    if (this.marker) {
      this.ctx.viewport.scene.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
      this.marker = null;
    }
  }
}
