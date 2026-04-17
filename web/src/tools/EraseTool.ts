/**
 * Erase Tool — delete faces and edges on click
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

export class EraseTool implements ITool {
  readonly name = 'erase';

  private ctx: ToolContext;
  private eraseHoverHighlight: THREE.Line | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[EraseTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    // 1) Try face first
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.faceIndex != null && hit.faceIndex >= 0) {
      const fid = this.ctx.getFaceId(hit.faceIndex);
      if (fid >= 0) {
        const ok = this.ctx.bridge.deleteFace(fid);
        this.ctx.selection.clearSelection();
        this.ctx.syncMesh();
        if (ok) {
          debugLog('[Erase] Deleted face:', fid);
        } else {
          Toast.error('면 삭제 실패');
        }
        return;
      }
    }

    // 2) Try edge
    const edgeHit = this.ctx.viewport.pickEdge(e.clientX, e.clientY);
    if (edgeHit && edgeHit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(edgeHit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      if (edgeId != null) {
        // deleteEdgeCascade로 삭제 → 함께 없어진 face 수 반환
        const cascaded = this.ctx.bridge.deleteEdgeCascade(edgeId);
        if (cascaded >= 0) {
          this.ctx.syncMesh();
          // Bug #3: cascade 발생 시 사용자에게 알림 (SketchUp 호환 동작)
          if (cascaded > 0) {
            Toast.info(`엣지와 인접 면 ${cascaded}개가 함께 삭제됨`, 2500);
          }
          debugLog('[Erase] Deleted edge:', edgeId, 'cascaded faces:', cascaded);
        } else {
          Toast.error('엣지 삭제 실패');
        }
        return;
      }
    }
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    // Edge hover highlight
    const edgeHit = this.ctx.viewport.pickEdge(e.clientX, e.clientY);
    if (edgeHit && edgeHit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(edgeHit.index / 2);
      this.showEraseHover(segIndex);
    } else {
      this.removeEraseHover();
    }

    // Face hover (use selection highlight)
    const faceHit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (faceHit && faceHit.faceIndex != null && faceHit.faceIndex >= 0) {
      const fid = this.ctx.getFaceId(faceHit.faceIndex);
      if (fid >= 0) {
        this.ctx.selection.handleClick(fid, false, false);
      }
    } else if (!edgeHit) {
      this.ctx.selection.clearSelection();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  isBusy(): boolean {
    return false; // Erase is not a "busy" tool
  }

  cleanup(): void {
    this.removeEraseHover();
    this.ctx.selection.clearSelection();
  }

  private removeEraseHover(): void {
    if (this.eraseHoverHighlight) {
      this.eraseHoverHighlight.geometry.dispose();
      (this.eraseHoverHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.eraseHoverHighlight);
      this.eraseHoverHighlight = null;
    }
  }

  private showEraseHover(segIndex: number): void {
    this.removeEraseHover();
    const edgeLines = this.ctx.bridge.getEdgeLines();
    if (!edgeLines) return;

    const base = segIndex * 6;
    if (base + 5 >= edgeLines.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([
        edgeLines[base], edgeLines[base+1], edgeLines[base+2],
        edgeLines[base+3], edgeLines[base+4], edgeLines[base+5],
      ]), 3
    ));
    const mat = new THREE.LineBasicMaterial({
      color: 0xff4444, linewidth: 2, depthTest: false,
    });
    this.eraseHoverHighlight = new THREE.Line(geo, mat);
    this.eraseHoverHighlight.renderOrder = 998;
    this.ctx.viewport.scene.add(this.eraseHoverHighlight);
  }
}
