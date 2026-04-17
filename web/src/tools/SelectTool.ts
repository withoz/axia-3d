/**
 * Select Tool — face/edge selection with drag-select box (SketchUp style)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';

export class SelectTool implements ITool {
  readonly name = 'select';

  private ctx: ToolContext;
  private dragSelectStart: { x: number; y: number } | null = null;
  private dragSelectBox: HTMLDivElement | null = null;
  private isDragSelecting: boolean = false;

  // Multi-click detection (double/triple)
  private clickCount: number = 0;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClickFaceId: number = -1;
  private readonly MULTI_CLICK_DELAY = 400; // ms

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    debugLog('[SelectTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    // Edge/Face 지능형 우선순위 픽 (커서에서 5px 이내 엣지 → edge 우선, 그 외 → face)
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY);

    if (picked?.type === 'edge' && picked.hit.index != null && this.ctx.edgeMap) {
      // ── 엣지 선택 경로 ──
      const segIndex = Math.floor(picked.hit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      if (edgeId != null) {
        this.ctx.selection.handleEdgeClick(edgeId, e.shiftKey, e.ctrlKey);
      }
      return;
    }

    if (picked?.type === 'face' && picked.hit.faceIndex != null) {
      // ── Face 선택 경로 (기존 multi-click 로직 유지) ──
      const hit = picked.hit;
      const fid = this.ctx.getFaceId(hit.faceIndex);
      debugLog('[HIT] faceId=', fid, 'triIndex=', hit.faceIndex);

      // Multi-click detection
      if (fid === this.lastClickFaceId) {
        this.clickCount++;
      } else {
        this.clickCount = 1;
        this.lastClickFaceId = fid;
      }

      if (this.clickTimer) clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => {
        this.clickCount = 0;
        this.lastClickFaceId = -1;
      }, this.MULTI_CLICK_DELAY);

      if (this.clickCount >= 3) {
        debugLog('[SelectTool] Triple-click → selectAll from face', fid);
        this.ctx.selection.selectAll(fid);
        this.clickCount = 0;
        this.lastClickFaceId = -1;
      } else if (this.clickCount === 2) {
        debugLog('[SelectTool] Double-click → face + adjacent edges', fid);
        this.ctx.selection.handleClick(fid, false, false);
        this.ctx.selection.selectAdjacentEdges(fid);
      } else {
        this.ctx.selection.handleClick(fid, e.shiftKey, e.ctrlKey);
      }
      return;
    }

    // ── 빈 공간 → drag-select 시작 + multi-click 리셋 ──
    this.clickCount = 0;
    this.lastClickFaceId = -1;
    this.dragSelectStart = { x: e.clientX, y: e.clientY };
    this.isDragSelecting = false;
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (this.dragSelectStart) {
      const dx = e.clientX - this.dragSelectStart.x;
      const dy = e.clientY - this.dragSelectStart.y;
      if (!this.isDragSelecting && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        // 5px movement threshold → start actual drag-select
        this.isDragSelecting = true;
        this.ctx.selection.clearSelection();
        this.createDragSelectBox();
      }
      if (this.isDragSelecting) {
        this.updateDragSelectBox(
          this.dragSelectStart.x, this.dragSelectStart.y,
          e.clientX, e.clientY
        );
      }
    }
  }

  onMouseUp(e: MouseEvent): void {
    if (this.dragSelectStart) {
      if (this.isDragSelecting) {
        this.performBoxSelect(
          this.dragSelectStart.x, this.dragSelectStart.y,
          e.clientX, e.clientY
        );
        this.removeDragSelectBox();
      } else {
        // No drag, just empty space click → deselect
        this.ctx.selection.clearSelection();
      }
      this.dragSelectStart = null;
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  isBusy(): boolean {
    return this.isDragSelecting;
  }

  cleanup(): void {
    this.removeDragSelectBox();
  }

  private createDragSelectBox(): void {
    if (this.dragSelectBox) return;
    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.pointerEvents = 'none';
    box.style.zIndex = '1000';
    box.style.border = '1px dashed #2196f3';
    box.style.background = 'rgba(33, 150, 243, 0.08)';
    this.ctx.viewport.container.appendChild(box);
    this.dragSelectBox = box;
  }

  private updateDragSelectBox(startX: number, startY: number, curX: number, curY: number): void {
    if (!this.dragSelectBox) return;
    const containerRect = this.ctx.viewport.container.getBoundingClientRect();
    const sx = startX - containerRect.left;
    const sy = startY - containerRect.top;
    const cx = curX - containerRect.left;
    const cy = curY - containerRect.top;

    const left = Math.min(sx, cx);
    const top = Math.min(sy, cy);
    const width = Math.abs(cx - sx);
    const height = Math.abs(cy - sy);

    // SketchUp style: left→right = window (blue), right→left = crossing (green)
    const isWindowSelect = cx >= sx;
    if (isWindowSelect) {
      this.dragSelectBox.style.border = '1px solid #2196f3';
      this.dragSelectBox.style.background = 'rgba(33, 150, 243, 0.1)';
    } else {
      this.dragSelectBox.style.border = '1px dashed #4caf50';
      this.dragSelectBox.style.background = 'rgba(76, 175, 80, 0.1)';
    }

    this.dragSelectBox.style.left = left + 'px';
    this.dragSelectBox.style.top = top + 'px';
    this.dragSelectBox.style.width = width + 'px';
    this.dragSelectBox.style.height = height + 'px';
  }

  private removeDragSelectBox(): void {
    if (this.dragSelectBox) {
      this.dragSelectBox.remove();
      this.dragSelectBox = null;
    }
    this.isDragSelecting = false;
    this.dragSelectStart = null;
  }

  private performBoxSelect(startX: number, startY: number, endX: number, endY: number): void {
    const camera = this.ctx.viewport.activeCamera;
    const canvas = this.ctx.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    const isWindowSelect = endX >= startX;

    const boxLeft = Math.min(startX, endX);
    const boxRight = Math.max(startX, endX);
    const boxTop = Math.min(startY, endY);
    const boxBottom = Math.max(startY, endY);

    const toScreen = (pos: THREE.Vector3): { x: number; y: number } | null => {
      const v = pos.clone().project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return {
        x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    };

    const inBox = (sx: number, sy: number) =>
      sx >= boxLeft && sx <= boxRight && sy >= boxTop && sy <= boxBottom;

    // Face selection
    const selectedFaces = new Set<number>();
    const buffers = this.ctx.bridge.getMeshBuffers();
    if (buffers && this.ctx.faceMap.length > 0 && buffers.positions.length > 0) {
      const positions = buffers.positions;
      const indices = buffers.indices;

      const faceScreenPts = new Map<number, { x: number; y: number }[]>();

      for (let tri = 0; tri < this.ctx.faceMap.length; tri++) {
        const fid = this.ctx.faceMap[tri];
        const base = tri * 3;
        if (base + 2 >= indices.length) continue;

        if (!faceScreenPts.has(fid)) faceScreenPts.set(fid, []);
        const pts = faceScreenPts.get(fid)!;

        for (let j = 0; j < 3; j++) {
          const idx = indices[base + j];
          const v = new THREE.Vector3(
            positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]
          );
          const sp = toScreen(v);
          if (sp) pts.push(sp);
        }
      }

      for (const [fid, pts] of faceScreenPts) {
        if (pts.length === 0) continue;
        if (isWindowSelect) {
          if (pts.every(p => inBox(p.x, p.y))) {
            selectedFaces.add(fid);
          }
        } else {
          if (pts.some(p => inBox(p.x, p.y))) {
            selectedFaces.add(fid);
          }
        }
      }
    }

    // Edge selection
    const selectedEdges = new Set<number>();
    const edgeLines = this.ctx.bridge.getEdgeLines();
    if (edgeLines && this.ctx.edgeMap) {
      for (let i = 0; i < this.ctx.edgeMap.length; i++) {
        const base = i * 6;
        if (base + 5 >= edgeLines.length) continue;

        const pA = toScreen(new THREE.Vector3(edgeLines[base], edgeLines[base+1], edgeLines[base+2]));
        const pB = toScreen(new THREE.Vector3(edgeLines[base+3], edgeLines[base+4], edgeLines[base+5]));
        if (!pA || !pB) continue;

        if (isWindowSelect) {
          if (inBox(pA.x, pA.y) && inBox(pB.x, pB.y)) {
            selectedEdges.add(this.ctx.edgeMap[i]);
          }
        } else {
          if (inBox(pA.x, pA.y) || inBox(pB.x, pB.y)) {
            selectedEdges.add(this.ctx.edgeMap[i]);
          }
        }
      }
    }

    // Apply selection
    this.ctx.selection.clearSelection();
    for (const fid of selectedFaces) {
      this.ctx.selection.handleClick(fid, true, false);
    }
    for (const eid of selectedEdges) {
      this.ctx.selection.handleEdgeClick(eid, true, false);
    }
  }
}
