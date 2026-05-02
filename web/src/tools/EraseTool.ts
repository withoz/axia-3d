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
/** ADR-016 §2 Path B — hole edge 위 hover 시 "re-synthesize" amber 색상. */
const RESYNTH_PREVIEW_COLOR = 0xffb84d;

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
  /** ADR-016 §2 hint dedup — only show toast once per hovered hole edge. */
  private lastHintedHoleEdge: number | null = null;

  /**
   * ADR-039 P24.2 stickiness — 같은 hover 상태면 overlay rebuild skip.
   *
   * Key 형식: "kind:id:flagMask" (e.g. "edge:42:1" = edge 42, amber preview).
   * BVH 의 1px jitter 로 같은 owner 가 다시 hit 되면 overlay 재생성 비용
   * 절감 + 시각적 안정 (깜빡임 차단).
   */
  private lastHoverKey: string | null = null;

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

    // ADR-019 Phase 1 — Erase 파이프라인 표준화 (2026-04-29).
    //
    // 정책 (ADR-019 Decision Summary):
    //   "Erase는 깨고, 다시 만든다."
    //
    //   default (Shift 없음):
    //     Edge 클릭 → erase_edge_resynthesize (Path B, re-resolve 표준)
    //     Face 직접 클릭 → 그 face 만 cascade 삭제 (사용자 명시 의도)
    //   cascadeOnly (Shift 누름):
    //     모두 batch cascade — face/edge 모두 명시 삭제
    //
    //   기존 cyan "merge 가능" fast-path 폐기 (ADR-019 Phase 3 hover 정리).
    //   ADR-016 §2 Path B 의 hole-edge 분기는 erase_edge_resynthesize 내부에
    //   유지 — 같은 함수가 hole / interior / sibling 모든 케이스 처리.
    const cascadeOnly = this.cascadeOnly;
    const tol = getMergeTolerance();
    const resynthAvail = typeof this.ctx.bridge.eraseEdgeResynthesize === 'function';

    // Path B 통일 — default 모드의 모든 edge 가 re-resolve 표준 거침.
    //   각 호출이 자체 transaction (다중 edge 시 undo N 번 — 향후 개선 후보).
    const resynthSummary = { newFaces: 0, removedFaces: 0 };
    const edgesForBatch: number[] = [];
    if (!cascadeOnly && resynthAvail) {
      for (const eid of edges) {
        const r = this.ctx.bridge.eraseEdgeResynthesize(eid, false);
        if (r.ok) {
          resynthSummary.newFaces += r.newFaces;
          resynthSummary.removedFaces += r.removedFaces;
        } else {
          // Path B 실패 시 batch path 로 fallback (구 동작 보존)
          edgesForBatch.push(eid);
        }
      }
    } else {
      edgesForBatch.push(...edges);
    }

    // Single Rust undo transaction — face 직접 클릭 + Path B 실패한 edge 처리.
    const res = (faces.length > 0 || edgesForBatch.length > 0)
      ? this.ctx.bridge.batchEraseEdgesWithMerge(faces, edgesForBatch, tol, cascadeOnly)
      : null;

    let mergedCount = 0;
    let cascadedFaces = faces.length;
    let cascadedEdges = edgesForBatch.length;
    let synthesizedCount = resynthSummary.newFaces;
    let desolidifiedCount = 0;
    let ok = true;

    if (res) {
      mergedCount = res.merged;
      cascadedEdges = res.cascadedEdges;
      cascadedFaces = res.cascadedFaces;
      synthesizedCount += res.synthesized;
      desolidifiedCount = res.desolidified;
    } else if (edgesForBatch.length > 0 || faces.length > 0) {
      // Older WASM without batchEraseEdgesWithMerge — fall back to previous logic.
      const edgesToCascade: number[] = [];
      for (const edgeId of edgesForBatch) {
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
      const total = cascadedFaces + cascadedEdges + mergedCount;
      debugLog(`[Erase] ${mergedCount} merged, ${cascadedFaces} faces, ${cascadedEdges} edges cascaded`
        + (cascadeOnly ? ' (shift: cascade-only)' : ''));

      // Debug aid: if user asked for merge but some edges cascaded, log why.
      if (!cascadeOnly && cascadedEdges > 0 && edges.length > 0) {
        const reason = this.ctx.bridge.lastMergeFailureReason();
        if (reason) {
          debugLog(`[Erase] first merge failure: ${reason} (tol=${tol}°)`);
        }
      }
      if (total > 1 || mergedCount > 0 || synthesizedCount > 0) {
        const parts: string[] = [];
        if (mergedCount > 0) parts.push(`${mergedCount}개 면 통합`);
        if (synthesizedCount > 0) parts.push(`${synthesizedCount}개 면 자동 생성`);
        if (cascadedFaces > 0) parts.push(`${cascadedFaces}개 면 삭제`);
        if (cascadedEdges > 0) parts.push(`${cascadedEdges}개 엣지 삭제`);
        if (cascadeOnly) parts.push('(Shift: 강제 삭제)');
        Toast.info(parts.join(', '), 2500);
      }

      // Phase C (ADR-008 Axiom 5): dedicated notice when a solid volume
      // lost its closed-ness as a result of this erase. Separate toast so
      // the user sees the semantic shift (solid → surface) independently
      // from the numeric per-entity summary above.
      if (desolidifiedCount > 0) {
        const label = desolidifiedCount === 1
          ? '솔리드 1개가 서피스로 전환됨 (닫힌 볼륨 해체)'
          : `솔리드 ${desolidifiedCount}개가 서피스로 전환됨 (닫힌 볼륨 해체)`;
        Toast.warning(label, 3500);
      }

      // 2026-04-27 — SOFT fallback 정책 폐기. 이제 merge 실패 시 cascade
      //   (엣지 + 인접 면) 가 default 라 "엣지는 사라졌는데 면이 그대로"
      //   상태가 발생하지 않음. softened > 0 은 explicit Soften Edges
      //   명령 경로에서만 발생하므로 Erase 도구는 별도 안내 없음.
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
    // ADR-039 P24.3 — tool 변경 시 hover stickiness state clear.
    this.lastHoverKey = null;
    this.lastHintedHoleEdge = null;
  }

  // ════════════════════════════════════════════════
  // Accumulation (드래그 중 face/edge 수집)
  // ════════════════════════════════════════════════

  private tryAccumulate(e: MouseEvent): void {
    // Edge/Face 지능형 우선순위 — 사용자 보고 (2026-04-27) 에 따라 12px 로
    // 상향. 지우개는 엣지 작업이 잦아 엣지 우선이 자연스러움.
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY, 18);
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
    // Edge/Face 지능형 우선순위 호버 — Select/Erase 모두 12px 동일 정책
    // (commit 시점과 hover 시점 동작 일치 보장).
    const picked = this.ctx.viewport.pickEdgeOrFace(e.clientX, e.clientY, 18);

    if (picked?.type === 'edge' && picked.hit.index != null && this.ctx.edgeMap) {
      const segIndex = Math.floor(picked.hit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      const showAmber = !e.shiftKey && edgeId != null;

      // ADR-039 P24.2 stickiness — 같은 (edgeId, amber state) 면 skip.
      // 다른 face 의 hover 가 남아있을 수 있으니 removeFaceHover 는 항상 호출.
      const key = `edge:${edgeId ?? -1}:${showAmber ? 1 : 0}`;
      this.removeFaceHover();
      if (key === this.lastHoverKey) return;
      this.lastHoverKey = key;

      // ADR-037 P22.5 / ADR-039 P24 — owner ID promote.
      // showEdgeHover 가 edgeId 의 모든 segment 를 강조 → 곡선 (circle 등)
      // 도 한 덩어리로 보임.
      this.showEdgeHover(edgeId ?? null, segIndex, false, showAmber);
      return;
    }
    // 다른 edge 또는 비-edge 로 이동 시 hint dedup 리셋.
    this.lastHintedHoleEdge = null;

    if (picked?.type === 'face' && picked.hit.faceIndex != null && picked.hit.faceIndex >= 0) {
      const fid = this.ctx.getFaceId(picked.hit.faceIndex);
      if (fid >= 0) {
        // ADR-039 P24.2 stickiness — 같은 face 면 rebuild skip.
        const key = `face:${fid}:0`;
        this.removeEdgeHover();
        if (key === this.lastHoverKey) return;
        this.lastHoverKey = key;
        this.showFaceHover(fid);
        return;
      }
    }

    // 어떤 것도 hit 안 됨 — 이전 hover state clear.
    if (this.lastHoverKey !== null) {
      this.removeFaceHover();
      this.removeEdgeHover();
      this.lastHoverKey = null;
    }
  }

  /**
   * Edge hover highlight — ADR-037 P22.5 / ADR-039 P24 적용.
   *
   * 이전 (segment 단위): `showEdgeHover(segIndex, ...)` 가 1개 segment 만
   * 빨갛게 강조 → 곡선 (circle 64-segment 등) hover 시 1/64 만 보임 →
   * "조각조각" 인지 발생.
   *
   * 이후 (owner ID 단위): edgeId 를 받아 그 EdgeId 의 **모든 segment** 를
   * 단일 LineSegments 로 강조. ADR-037 P22.5 의 균일 promotion 시각 적용.
   *
   * @param edgeId — 강조할 owner EdgeId (raw u32). null = 강조 해제만.
   * @param seedSegIndex — 호환용 fallback (edgeMap 미연결 시 단일 segment).
   */
  private showEdgeHover(
    edgeId: number | null,
    seedSegIndex: number,
    willMerge: boolean = false,
    willResynth: boolean = false,
  ): void {
    this.removeEdgeHover();
    const edgeLines = this.ctx.bridge.getEdgeLines();
    if (!edgeLines) return;

    // P22.5 — edgeId 가 valid 면 그 EdgeId 의 모든 segment 수집.
    // edgeMap 미연결 (legacy) 또는 edgeId null 시 seedSegIndex 만 강조.
    const edgeMap = this.ctx.edgeMap;
    const segIndices: number[] = [];
    if (edgeId != null && edgeMap && edgeMap.length > 0) {
      for (let s = 0; s < edgeMap.length; s++) {
        if (edgeMap[s] === edgeId) segIndices.push(s);
      }
    }
    if (segIndices.length === 0) {
      // Fallback: seed segment 만 (edgeMap 없거나 매칭 0)
      if (seedSegIndex < 0) return;
      segIndices.push(seedSegIndex);
    }

    // 모든 segment 의 두 vertex 를 단일 buffer 에 모음 (LineSegments 형식).
    const positions = new Float32Array(segIndices.length * 6);
    let writeIdx = 0;
    for (const seg of segIndices) {
      const base = seg * 6;
      if (base + 5 >= edgeLines.length) continue;
      positions[writeIdx]     = edgeLines[base];
      positions[writeIdx + 1] = edgeLines[base + 1];
      positions[writeIdx + 2] = edgeLines[base + 2];
      positions[writeIdx + 3] = edgeLines[base + 3];
      positions[writeIdx + 4] = edgeLines[base + 4];
      positions[writeIdx + 5] = edgeLines[base + 5];
      writeIdx += 6;
    }
    if (writeIdx === 0) return;
    // Trim if some segments were OOB
    const final = writeIdx === positions.length ? positions : positions.slice(0, writeIdx);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(final, 3));

    const color = willMerge ? MERGE_PREVIEW_COLOR
      : willResynth ? RESYNTH_PREVIEW_COLOR
      : ERASE_COLOR;
    const mat = new THREE.LineBasicMaterial({
      color, linewidth: 2, depthTest: false,
    });
    // ADR-039 P24: LineSegments (was Line) — 여러 disconnected segment 지원.
    this.edgeHoverHighlight = new THREE.LineSegments(geo, mat) as unknown as THREE.Line;
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
