/**
 * Erase Tool — delete faces and edges
 *
 * UX (2026-04-17 개선):
 * - **단일 클릭**: 해당 face 또는 edge 삭제
 * - **드래그**: 마우스가 지나간 모든 face/edge를 누적 → mouseup 시 한 번에 삭제
 *   (단일 undo 트랜잭션)
 * - **호버**: face는 빨간 반투명 overlay, edge는 빨간 선으로 강조
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';
import { getMergeTolerance } from './MergeSettings';

/** 호버/삭제 예정 표시 색상 — cascade(= face도 사라지는) 모드 */
const ERASE_COLOR = 0xff4444;
/** "이 엣지를 지우면 두 coplanar 면이 병합됩니다" 미리보기 색상. */
const MERGE_PREVIEW_COLOR = 0x4dd2ff;

/**
 * Erase 도구 전용 원형 커서 (SVG 데이터 URL).
 * Offset 도구의 PickBox와 동일한 반지름(r=5, stroke 1.5px) — 12×12 viewBox.
 * 순수 빨간 outline — 채움 없음, 중앙 점 없음.
 * 핫스팟(6, 6) = 중앙. 시스템 `crosshair` 폴백.
 */
const ERASE_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">' +
  '<circle cx="6" cy="6" r="5" fill="none" stroke="#ff4444" stroke-width="1.5"/>' +
  '</svg>';
const ERASE_CURSOR =
  `url("data:image/svg+xml;utf8,${encodeURIComponent(ERASE_CURSOR_SVG)}") 6 6, crosshair`;

export class EraseTool implements ITool {
  readonly name = 'erase';
  // Erase is a pick-to-delete flow (edge/face picks via raycast); no snap needed.
  readonly wantsSnap = false;

  private ctx: ToolContext;

  // Drag accumulation state
  private dragActive = false;
  private accumulatedFaces = new Set<number>();
  private accumulatedEdges = new Set<number>();
  /** Shift held at mousedown → skip auto-merge, go straight to cascade. */
  private cascadeOnly = false;

  // Visual feedback
  private edgeHoverHighlight: THREE.Line | null = null;
  private faceHoverHighlight: THREE.Mesh | null = null;
  /** Persistent red overlay for faces accumulated during a drag. */
  private dragFaceOverlay: THREE.Mesh | null = null;
  /** Persistent red overlay for edges accumulated during a drag. */
  private dragEdgeOverlay: THREE.LineSegments | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  onActivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = ERASE_CURSOR;
    debugLog('[EraseTool] Activated');
  }

  onDeactivate(): void {
    const canvas = this.ctx.viewport.renderer.domElement;
    canvas.style.cursor = '';
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, _point: THREE.Vector3 | null): void {
    this.dragActive = true;
    // Shift at mousedown locks the gesture into cascade-only mode — useful
    // when the user wants to keep a bounding edge visible instead of letting
    // the two adjacent coplanar faces silently merge.
    this.cascadeOnly = e.shiftKey === true;
    this.accumulatedFaces.clear();
    this.accumulatedEdges.clear();
    this.clearDragOverlays();
    this.tryAccumulate(e);
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (this.dragActive) {
      // 드래그 중: 지나가는 모든 항목 누적
      this.tryAccumulate(e);
      this.refreshDragOverlays();
      return;
    }

    // 일반 호버: 빨간 강조 (face/edge)
    this.updateHoverVisuals(e);
  }

  onMouseUp(_e: MouseEvent): void {
    if (!this.dragActive) return;
    this.dragActive = false;

    const faces = [...this.accumulatedFaces];
    const edges = [...this.accumulatedEdges];

    // Clear overlays regardless of outcome
    this.clearDragOverlays();

    if (faces.length === 0 && edges.length === 0) {
      return; // 빈 클릭 — 아무것도 할 일 없음
    }

    // 2026-04-24: Non-destructive by default.
    //   · Coplanar faces within tolerance → merge (two faces → one).
    //   · Non-coplanar faces → edge becomes SOFT (hidden, faces stay).
    //     User intent "remove this line" honored without destroying geometry.
    //   · Shift at mousedown → force cascade-delete (legacy destructive path).
    // Single Rust undo transaction — one Ctrl+Z restores all.
    const tol = getMergeTolerance();
    const cascadeOnly = this.cascadeOnly;
    const res = this.ctx.bridge.batchEraseEdgesSoftFallback(faces, edges, tol, cascadeOnly);

    let mergedCount = 0;
    let cascadedFaces = faces.length;
    let cascadedEdges = edges.length;
    let softenedCount = 0;
    let ok = true;

    if (res) {
      mergedCount = res.merged;
      cascadedEdges = res.cascadedEdges;
      cascadedFaces = res.cascadedFaces;
      softenedCount = res.softened;
    } else {
      // Older WASM without batchEraseEdgesWithMerge — fall back to previous logic.
      const edgesToCascade: number[] = [];
      for (const edgeId of edges) {
        const result = cascadeOnly ? -1 : this.ctx.bridge.mergeFacesByEdge(edgeId, tol);
        if (result >= 0) mergedCount++;
        else edgesToCascade.push(edgeId);
      }
      if (faces.length > 0 || edgesToCascade.length > 0) {
        ok = this.ctx.bridge.batchDelete(faces, edgesToCascade);
      }
      cascadedEdges = edgesToCascade.length;
      cascadedFaces = faces.length;
    }

    if (ok) {
      this.ctx.selection.clearSelection();
      this.ctx.syncMesh();
      const total = cascadedFaces + cascadedEdges + mergedCount + softenedCount;
      debugLog(`[Erase] ${mergedCount} merged, ${cascadedFaces} faces, ${cascadedEdges} edges cascaded`
        + (cascadeOnly ? ' (shift: cascade-only)' : ''));

      // Debug aid: if user asked for merge but some edges cascaded, log why.
      if (!cascadeOnly && cascadedEdges > 0 && edges.length > 0) {
        const reason = this.ctx.bridge.lastMergeFailureReason();
        if (reason) {
          debugLog(`[Erase] first merge failure: ${reason} (tol=${tol}°)`);
        }
      }
      if (total > 1 || mergedCount > 0 || softenedCount > 0) {
        const parts: string[] = [];
        if (mergedCount > 0) parts.push(`${mergedCount}개 면 통합`);
        if (softenedCount > 0) parts.push(`${softenedCount}개 엣지 숨김 (면 유지)`);
        if (cascadedFaces > 0) parts.push(`${cascadedFaces}개 면 삭제`);
        if (cascadedEdges > 0) parts.push(`${cascadedEdges}개 엣지 삭제`);
        if (cascadeOnly) parts.push('(Shift: 강제 삭제)');
        Toast.info(parts.join(', '), 2500);
      }
    } else {
      Toast.error('삭제에 실패했습니다');
    }

    this.accumulatedFaces.clear();
    this.accumulatedEdges.clear();
    this.cascadeOnly = false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // 드래그 취소 — 누적된 것들 버리기
      if (this.dragActive) {
        this.dragActive = false;
        this.accumulatedFaces.clear();
        this.accumulatedEdges.clear();
        this.clearDragOverlays();
        debugLog('[Erase] Drag cancelled by Escape');
      } else {
        this.cleanup();
      }
    }
  }

  isBusy(): boolean {
    return this.dragActive;
  }

  cleanup(): void {
    this.removeEdgeHover();
    this.removeFaceHover();
    this.clearDragOverlays();
    this.ctx.selection.clearSelection();
    this.dragActive = false;
    this.accumulatedFaces.clear();
    this.accumulatedEdges.clear();
  }

  // ════════════════════════════════════════════════
  // Accumulation (드래그 중 face/edge 수집)
  // ════════════════════════════════════════════════

  private tryAccumulate(e: MouseEvent): void {
    // Edge/Face 지능형 우선순위 — 커서 5px 이내 엣지는 엣지 우선, 그 외 면
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY);
    if (!picked) return;

    if (picked.type === 'edge' && picked.hit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(picked.hit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      if (edgeId != null && !this.accumulatedEdges.has(edgeId)) {
        this.accumulatedEdges.add(edgeId);
      }
      return;
    }

    if (picked.type === 'face' && picked.hit.faceIndex != null && picked.hit.faceIndex >= 0) {
      const fid = this.ctx.getFaceId(picked.hit.faceIndex);
      if (fid >= 0 && !this.accumulatedFaces.has(fid)) {
        this.accumulatedFaces.add(fid);
      }
    }
  }

  // ════════════════════════════════════════════════
  // Hover visuals (드래그 아닐 때 강조)
  // ════════════════════════════════════════════════

  private updateHoverVisuals(e: MouseEvent): void {
    // Edge/Face 지능형 우선순위 호버 — SelectTool과 동일 규칙으로 일관성 확보
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY);

    if (picked?.type === 'edge' && picked.hit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(picked.hit.index / 2);
      // 이 엣지를 지우면 양옆 coplanar 면이 병합될지 미리 확인.
      // Shift는 cascade-only 모드이므로 preview 비활성.
      const edgeId = this.ctx.edgeMap[segIndex];
      const mergePair = (!e.shiftKey && edgeId != null)
        ? this.ctx.bridge.previewEdgeEraseMerge(edgeId, getMergeTolerance())
        : null;
      this.showEdgeHover(segIndex, mergePair != null);
      if (mergePair) {
        this.showMergePreviewFaces(mergePair);
      } else {
        this.removeFaceHover();
      }
      return;
    }

    if (picked?.type === 'face' && picked.hit.faceIndex != null && picked.hit.faceIndex >= 0) {
      const fid = this.ctx.getFaceId(picked.hit.faceIndex);
      if (fid >= 0) {
        this.showFaceHover(fid);
        this.removeEdgeHover();
        return;
      }
    }

    // 어떤 것도 hit 안 됨
    this.removeFaceHover();
    this.removeEdgeHover();
  }

  private showEdgeHover(segIndex: number, willMerge: boolean = false): void {
    this.removeEdgeHover();
    const edgeLines = this.ctx.bridge.getEdgeLines();
    if (!edgeLines) return;

    const base = segIndex * 6;
    if (base + 5 >= edgeLines.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([
        edgeLines[base], edgeLines[base + 1], edgeLines[base + 2],
        edgeLines[base + 3], edgeLines[base + 4], edgeLines[base + 5],
      ]), 3
    ));
    const mat = new THREE.LineBasicMaterial({
      color: willMerge ? MERGE_PREVIEW_COLOR : ERASE_COLOR,
      linewidth: 2, depthTest: false,
    });
    this.edgeHoverHighlight = new THREE.Line(geo, mat);
    this.edgeHoverHighlight.renderOrder = 998;
    this.ctx.viewport.scene.add(this.edgeHoverHighlight);
  }

  /**
   * "Will merge" 미리보기 — 두 coplanar 면을 옅은 파란색으로 tint해서
   * 이 엣지를 지우면 둘이 하나로 합쳐진다는 사실을 사용자에게 알린다.
   */
  private showMergePreviewFaces(faceIds: [number, number]): void {
    this.removeFaceHover();
    const mesh = this.buildFacesOverlay([...faceIds], 0.28, MERGE_PREVIEW_COLOR);
    if (!mesh) return;
    this.faceHoverHighlight = mesh;
    this.ctx.viewport.scene.add(mesh);
  }

  private removeEdgeHover(): void {
    if (this.edgeHoverHighlight) {
      this.edgeHoverHighlight.geometry.dispose();
      (this.edgeHoverHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.edgeHoverHighlight);
      this.edgeHoverHighlight = null;
    }
  }

  private showFaceHover(faceId: number): void {
    this.removeFaceHover();
    const mesh = this.buildFacesOverlay([faceId], 0.45);
    if (!mesh) return;
    this.faceHoverHighlight = mesh;
    this.ctx.viewport.scene.add(mesh);
  }

  private removeFaceHover(): void {
    if (this.faceHoverHighlight) {
      this.faceHoverHighlight.geometry.dispose();
      (this.faceHoverHighlight.material as THREE.Material).dispose();
      this.ctx.viewport.scene.remove(this.faceHoverHighlight);
      this.faceHoverHighlight = null;
    }
  }

  // ════════════════════════════════════════════════
  // Drag overlay (누적된 face/edge를 지속 표시)
  // ════════════════════════════════════════════════

  private refreshDragOverlays(): void {
    // 면 overlay 갱신
    this.disposeObject(this.dragFaceOverlay);
    this.dragFaceOverlay = null;
    if (this.accumulatedFaces.size > 0) {
      const mesh = this.buildFacesOverlay([...this.accumulatedFaces], 0.55);
      if (mesh) {
        this.dragFaceOverlay = mesh;
        this.ctx.viewport.scene.add(mesh);
      }
    }

    // 엣지 overlay 갱신
    this.disposeObject(this.dragEdgeOverlay);
    this.dragEdgeOverlay = null;
    if (this.accumulatedEdges.size > 0) {
      const lines = this.buildEdgesOverlay([...this.accumulatedEdges]);
      if (lines) {
        this.dragEdgeOverlay = lines;
        this.ctx.viewport.scene.add(lines);
      }
    }

    // 드래그 중에는 단일 호버 overlay 숨김 (중복 방지)
    this.removeFaceHover();
    this.removeEdgeHover();
  }

  private clearDragOverlays(): void {
    this.disposeObject(this.dragFaceOverlay);
    this.dragFaceOverlay = null;
    this.disposeObject(this.dragEdgeOverlay);
    this.dragEdgeOverlay = null;
  }

  private disposeObject(obj: THREE.Object3D | null): void {
    if (!obj) return;
    if ((obj as any).geometry) (obj as any).geometry.dispose();
    if ((obj as any).material) (obj as any).material.dispose();
    this.ctx.viewport.scene.remove(obj);
  }

  // ════════════════════════════════════════════════
  // Overlay geometry builders
  // ════════════════════════════════════════════════

  /**
   * 주어진 faceIds의 삼각형들을 모아 빨간 반투명 Mesh로 반환.
   * faceMap을 역참조하여 현재 렌더 버퍼에서 해당 face의 트라이앵글만 추출.
   */
  private buildFacesOverlay(faceIds: number[], opacity: number, color: number = ERASE_COLOR): THREE.Mesh | null {
    const buffers = this.ctx.bridge.getMeshBuffers();
    if (!buffers) return null;
    const { positions, indices, faceMap } = buffers;
    const targetSet = new Set(faceIds);

    const triPositions: number[] = [];
    for (let tri = 0; tri < faceMap.length; tri++) {
      if (!targetSet.has(faceMap[tri])) continue;
      const base = tri * 3;
      const i0 = indices[base];
      const i1 = indices[base + 1];
      const i2 = indices[base + 2];
      triPositions.push(
        positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2],
        positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2],
        positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2],
      );
    }

    if (triPositions.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triPositions), 3));
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 999;
    return mesh;
  }

  /** edgeIds에 해당하는 선분들을 모아 빨간 LineSegments로 반환. */
  private buildEdgesOverlay(edgeIds: number[]): THREE.LineSegments | null {
    const edgeLines = this.ctx.bridge.getEdgeLines();
    const edgeMap = this.ctx.edgeMap;
    if (!edgeLines || !edgeMap) return null;
    const targetSet = new Set(edgeIds);

    const pts: number[] = [];
    for (let seg = 0; seg < edgeMap.length; seg++) {
      if (!targetSet.has(edgeMap[seg])) continue;
      const base = seg * 6;
      if (base + 5 >= edgeLines.length) continue;
      pts.push(
        edgeLines[base], edgeLines[base + 1], edgeLines[base + 2],
        edgeLines[base + 3], edgeLines[base + 4], edgeLines[base + 5],
      );
    }
    if (pts.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: ERASE_COLOR, linewidth: 2, depthTest: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 1000;
    return lines;
  }
}
