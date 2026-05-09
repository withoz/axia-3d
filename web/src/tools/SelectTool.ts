/**
 * Select Tool — face/edge selection with drag-select box (SketchUp style)
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { pickingRouter } from '../core/PickingRouter';

/**
 * Hover target — ADR-039 P24.1 tagged union.
 *
 * `EdgeId | FaceId` 둘 다 number 라 컴파일 타임 구분이 안 됨 → kind
 * discriminator 강제. switch case exhaustive check 가능.
 */
export type HoverTarget =
  | { kind: 'edge'; id: number }
  | { kind: 'face'; id: number }
  | null;

/**
 * P24.2 stickiness invariant helper — 두 hover target 의 owner 가
 * 같은지 비교. 둘 다 null 도 same.
 */
export function sameHoverOwner(a: HoverTarget, b: HoverTarget): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && a.id === b.id;
}

export class SelectTool implements ITool {
  readonly name = 'select';
  // Select uses pickEdgeOrFace (BVH raycast); snap markers are visual noise here.
  readonly wantsSnap = false;

  private ctx: ToolContext;
  private dragSelectStart: { x: number; y: number } | null = null;
  private dragSelectBox: HTMLDivElement | null = null;
  private isDragSelecting: boolean = false;
  /** mousedown 시점의 modifier 상태 — performBoxSelect / 빈클릭 해제 로직이 사용 */
  private dragModifiers: { shift: boolean; ctrl: boolean; alt: boolean } = { shift: false, ctrl: false, alt: false };

  // Multi-click detection (double/triple) — face
  private clickCount: number = 0;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClickFaceId: number = -1;
  // Multi-click — edge (double-click ⇒ chain selection)
  private edgeClickCount: number = 0;
  private edgeClickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClickEdgeId: number = -1;
  private readonly MULTI_CLICK_DELAY = 400; // ms

  /**
   * ADR-039 P24 — 현재 hover target.
   *
   * mousemove → pickEdgeOrFace → promote → setHoverTarget 으로 갱신.
   */
  private hovered: HoverTarget = null;

  /**
   * P24 Stage 3 — hover state 변경 시 발화하는 listener 목록.
   * Three.js 렌더 (Viewport) / UI overlay 등이 구독.
   *
   * ADR-039 P24.2 stickiness 자동 적용 — 동일 owner 일 때는 호출 안 됨.
   */
  private hoverListeners: Array<(target: HoverTarget) => void> = [];

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  /**
   * Hover state 변경 listener 등록. 반환된 함수 호출 시 unsubscribe.
   * Render layer (Viewport) 가 mount 시 등록 + unmount 시 해제.
   */
  public onHoverChange(listener: (target: HoverTarget) => void): () => void {
    this.hoverListeners.push(listener);
    return () => {
      const idx = this.hoverListeners.indexOf(listener);
      if (idx >= 0) this.hoverListeners.splice(idx, 1);
    };
  }

  /**
   * Hover target 갱신 (ADR-039 P24.2 stickiness 적용).
   *
   * 같은 owner 면 no-op — BVH 1px jitter 자연 흡수. 시각 갱신도 skip.
   * Owner 변경 시에만 hoverListeners 발화.
   *
   * @returns true = state 변경됨 + listener 발화, false = no-op
   */
  private setHoverTarget(next: HoverTarget): boolean {
    if (sameHoverOwner(next, this.hovered)) return false;
    this.hovered = next;
    // Stage 3 — 시각 layer 통지 (P24.2 stickiness 통과한 경우만).
    for (const listener of this.hoverListeners) {
      try { listener(next); }
      catch (e) { /* defensive — listener error 가 다른 listener 막지 않음 */
        debugLog('[SelectTool] hover listener threw:', e);
      }
    }
    return true;
  }

  /** Test 용 / debug 용 — 현재 hover state 조회. */
  public getHoverTarget(): HoverTarget {
    return this.hovered;
  }

  /**
   * P24.3 — Tool 변경 / mouseleave / ESC 시 hover clear.
   * 외부 (ToolManager / Viewport) 가 호출.
   */
  public clearHover(): void {
    this.setHoverTarget(null);
  }

  onActivate(): void {
    debugLog('[SelectTool] Activated');
  }

  onDeactivate(): void {
    this.cleanup();
  }

  onMouseDown(e: MouseEvent, _point: THREE.Vector3 | null): void {
    // ADR-012 §4 — picking 은 PickingRouter 단일 진입점 통과.
    //   매 query 의 elapsed 가 자동으로 'picking.face' budget(8ms) 에 기록.
    // 사용자 보고 (2026-04-27): "엣지라인이 우선으로 잡혀야 합니다 (지우개·선택)".
    //   기본 5px → 12px 로 상향. 커서 근방의 엣지가 hit 가능하면 면보다
    //   엣지를 우선 선택. 면 중앙 클릭은 여전히 face 로 정확히 잡힘.
    const r = pickingRouter.route({
      kind: 'edgeOrFace',
      x: e.clientX, y: e.clientY,
      viewport: this.ctx.viewport,
      preferEdgeWithinPx: 18,
    });
    // 기존 코드 호환을 위해 pickEdgeOrFace 형식의 객체로 정규화.
    const picked = r ? { type: r.kind, hit: r.hit } : null;

    if (picked?.type === 'edge' && picked.hit.index != null && this.ctx.edgeMap) {
      // ── 엣지 선택 경로 ──
      const segIndex = Math.floor(picked.hit.index / 2);
      const edgeId = this.ctx.edgeMap[segIndex];
      if (edgeId == null) return;

      // 엣지에서도 multi-click 추적 (double-click → 체인 선택).
      // 먼저 면 multi-click 만 끊고 (전체 reset 하면 자기 자신도 리셋됨),
      // 그 다음 엣지 카운터를 갱신.
      this.clickCount = 0;
      this.lastClickFaceId = -1;
      if (this.clickTimer) { clearTimeout(this.clickTimer); this.clickTimer = null; }
      if (edgeId === this.lastClickEdgeId) {
        this.edgeClickCount++;
      } else {
        this.edgeClickCount = 1;
        this.lastClickEdgeId = edgeId;
      }
      if (this.edgeClickTimer) clearTimeout(this.edgeClickTimer);
      this.edgeClickTimer = setTimeout(() => {
        this.edgeClickCount = 0;
        this.lastClickEdgeId = -1;
      }, this.MULTI_CLICK_DELAY);

      // 2026-04-27 — 3-단계 클릭 의미 (사용자 요청):
      //   1-click: 엣지 자체만
      //   2-click: 엣지 + 인접 면 (직접 관련)
      //   3-click: 엣지 chain / 또는 인접 면 의 XIA (구성 전체)
      if (this.edgeClickCount >= 3) {
        // Triple-click — 구성 전체 (XIA / 체인).
        //   인접 면이 있으면 그 면이 속한 XIA 전체 (selectAll).
        //   없으면 (standalone polyline edge) → collectEdgeChain.
        const adjFaces = (this.ctx.selection as unknown as {
          computeAdjacentFaces?: (eid: number) => number[];
        }).computeAdjacentFaces?.(edgeId) ?? [];
        if (adjFaces.length > 0) {
          this.ctx.selection.selectAll(adjFaces[0], e.shiftKey, e.ctrlKey, !!e.altKey);
          debugLog(`[SelectTool] Triple-click edge → selectAll on adjacent face ${adjFaces[0]}`);
        } else {
          const chain = this.ctx.bridge.collectEdgeChain(edgeId);
          if (chain.length === 0) {
            this.ctx.selection.handleEdgeClick(edgeId, e.shiftKey, e.ctrlKey, !!e.altKey);
          } else {
            this.ctx.selection.handleEdgeClick(chain[0], e.shiftKey, e.ctrlKey, !!e.altKey);
            if (e.altKey) {
              for (let i = 1; i < chain.length; i++) {
                this.ctx.selection.handleEdgeClick(chain[i], false, false, true);
              }
            } else {
              for (let i = 1; i < chain.length; i++) {
                this.ctx.selection.handleEdgeClick(chain[i], true, false, false);
              }
            }
            debugLog(`[SelectTool] Triple-click edge → chain ${chain.length} edges`);
          }
        }
        this.edgeClickCount = 0;
        this.lastClickEdgeId = -1;
      } else if (this.edgeClickCount === 2) {
        // Double-click — 엣지 + 인접 면.
        debugLog(`[SelectTool] Double-click edge → edge + adjacent faces`);
        this.ctx.selection.selectEdgeWithFaces(edgeId, e.shiftKey, e.ctrlKey, !!e.altKey);
      } else {
        // Single-click — ADR-088 Phase 1 (S-δ) curve_owner_id walk.
        // LOCKED #15 (ADR-037 P22.5): "Edge.curve = Some(...) 인 edge 의
        // N segments 모두 동일 EdgeId 로 promote." DCEL representation 은
        // N 개 분리 edges 이지만 logical curve 는 단일 entity → 한 클릭
        // 으로 group 전체 선택.
        const ownerId = this.ctx.bridge.getEdgeCurveOwnerId(edgeId);
        if (ownerId >= 0) {
          const groupEdges = this.ctx.bridge.getEdgesByCurveOwner(ownerId);
          if (groupEdges.length > 1) {
            // Multi-segment curve: first edge with caller's modifiers,
            // remaining as additive (same selection state).
            this.ctx.selection.handleEdgeClick(groupEdges[0], e.shiftKey, e.ctrlKey, !!e.altKey);
            for (let i = 1; i < groupEdges.length; i++) {
              this.ctx.selection.handleEdgeClick(groupEdges[i], true, false, false);
            }
            debugLog(
              `[SelectTool] ADR-088 curve_owner walk: ${groupEdges.length} segments selected (owner=${ownerId})`,
            );
          } else {
            // Single-segment group (degenerate) or stale id — fall back.
            this.ctx.selection.handleEdgeClick(edgeId, e.shiftKey, e.ctrlKey, !!e.altKey);
          }
        } else {
          // No owner_id (single segment, e.g., DrawLine) — direct selection.
          this.ctx.selection.handleEdgeClick(edgeId, e.shiftKey, e.ctrlKey, !!e.altKey);
        }
      }
      return;
    }

    if (picked?.type === 'face' && picked.hit.faceIndex != null) {
      // ── Face 선택 경로 ──
      const hit = picked.hit;
      // faceIndex null/undefined는 위 조건에서 이미 배제됨 — non-null assertion.
      const fid = this.ctx.getFaceId(hit.faceIndex!);
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
        // Triple-click 전체 XIA 선택 — Shift=추가, Alt=빼기, Ctrl=토글.
        debugLog('[SelectTool] Triple-click → selectAll from face', fid);
        this.ctx.selection.selectAll(fid, e.shiftKey, e.ctrlKey, !!e.altKey);
        this.clickCount = 0;
        this.lastClickFaceId = -1;
      } else if (this.clickCount === 2) {
        // Double-click 면 + 인접 엣지.
        debugLog('[SelectTool] Double-click → face + adjacent edges', fid);
        this.ctx.selection.selectFaceWithEdges(fid, e.shiftKey, e.ctrlKey, !!e.altKey);
      } else {
        // Single-click — ADR-093 D-δ surface_owner_id walk (B-MVP).
        // LOCKED #15 ADR-037 P22.5 의 Face owner-id 자연 확장. Cylinder
        // side 의 N quad faces 가 동일 surface_owner_id 공유 → 한 클릭
        // 으로 group 전체 선택. None owner / fallback 시 기존 단일 face
        // 동작 보존 (additive only per Lock-in D-D).
        //
        // Defensive: bridge mock in older test fixtures may lack the
        // ADR-093 methods → fall through to legacy single-face select.
        const ownerId = typeof this.ctx.bridge.getFaceSurfaceOwnerId === 'function'
          ? this.ctx.bridge.getFaceSurfaceOwnerId(fid)
          : -1;
        if (ownerId >= 0
            && typeof this.ctx.bridge.walkFaceOwnerSiblings === 'function') {
          const groupFaces = this.ctx.bridge.walkFaceOwnerSiblings(fid);
          if (groupFaces.length > 1) {
            // Multi-face surface group: first face with caller's modifiers,
            // remaining as additive (mirror ADR-088 curve_owner walk).
            this.ctx.selection.handleClick(
              groupFaces[0], e.shiftKey, e.ctrlKey, !!e.altKey,
            );
            for (let i = 1; i < groupFaces.length; i++) {
              this.ctx.selection.handleClick(groupFaces[i], true, false, false);
            }
            debugLog(
              `[SelectTool] ADR-093 surface_owner walk: ${groupFaces.length} faces selected (owner=${ownerId})`,
            );
          } else {
            // Single-face group (degenerate / stale id) — fall back.
            this.ctx.selection.handleClick(fid, e.shiftKey, e.ctrlKey, !!e.altKey);
          }
        } else {
          // No owner_id (standalone face, e.g., DrawRect / non-cylinder)
          // — direct selection (legacy behavior).
          this.ctx.selection.handleClick(fid, e.shiftKey, e.ctrlKey, !!e.altKey);
        }
      }
      return;
    }

    // ── 빈 공간 → drag-select 시작 + multi-click 리셋 ──
    this.resetMultiClickState();
    this.dragSelectStart = { x: e.clientX, y: e.clientY };
    this.dragModifiers = { shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey };
    this.isDragSelecting = false;
  }

  /** Bug 4+8 fix: multi-click 추적 상태를 완전 초기화 */
  private resetMultiClickState(): void {
    this.clickCount = 0;
    this.lastClickFaceId = -1;
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
    this.edgeClickCount = 0;
    this.lastClickEdgeId = -1;
    if (this.edgeClickTimer) {
      clearTimeout(this.edgeClickTimer);
      this.edgeClickTimer = null;
    }
  }

  onMouseMove(e: MouseEvent, _point: THREE.Vector3 | null): void {
    if (this.dragSelectStart) {
      // P24.3 — drag 중에는 hover state freeze (재계산 안 함).
      const dx = e.clientX - this.dragSelectStart.x;
      const dy = e.clientY - this.dragSelectStart.y;
      if (!this.isDragSelecting && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        // 5px movement threshold → start actual drag-select
        this.isDragSelecting = true;
        // Drag 시작 — hover clear (시각 일관성).
        this.setHoverTarget(null);
        // Shift/Alt/Ctrl 드래그는 기존 선택 유지하며 누적/빼기/토글.
        if (!this.dragModifiers.shift && !this.dragModifiers.ctrl && !this.dragModifiers.alt) {
          this.ctx.selection.clearSelection();
        }
        this.createDragSelectBox();
      }
      if (this.isDragSelecting) {
        this.updateDragSelectBox(
          this.dragSelectStart.x, this.dragSelectStart.y,
          e.clientX, e.clientY
        );
      }
      return;
    }

    // ADR-039 P24 — Hover Pick → Promote.
    // Drag 가 아닐 때만 hover 갱신. 결과를 즉시 owner ID 로 promote 후
    // tagged union (HoverTarget) 으로 저장. P24.2 stickiness 자동 적용
    // (setHoverTarget 안에서 sameOwner 비교).
    const newHover = this.computeHoverTarget(e);
    this.setHoverTarget(newHover);
  }

  /**
   * mousemove → raw hit → owner ID promote → HoverTarget.
   *
   * P24.4 — `pickEdgeOrFace` 의 edge/face 우선순위 그대로 사용.
   * P22.5 (ADR-037) — promotion 결과는 항상 owner ID.
   *
   * @returns HoverTarget 또는 null (raycast miss / promote 실패)
   */
  private computeHoverTarget(e: MouseEvent): HoverTarget {
    const rect = this.ctx.viewport.container.getBoundingClientRect?.()
      ?? this.ctx.viewport.renderer?.domElement?.getBoundingClientRect?.();
    if (!rect) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const picked = this.ctx.viewport.pickEdgeOrFace?.(x, y);
    if (!picked) return null;

    if (picked.type === 'edge'
        && (picked.hit as { index?: number }).index != null
        && this.ctx.edgeMap) {
      const rawIdx = (picked.hit as { index: number }).index;
      const segIdx = Math.floor(rawIdx / 2);
      if (segIdx < 0 || segIdx >= this.ctx.edgeMap.length) return null;
      const edgeId = this.ctx.edgeMap[segIdx];

      // ADR-040 P25 plumbing — refine hover with analytic distance for
      // edges that carry an AnalyticCurve. If the cursor is OUTSIDE the
      // 12px screen-space threshold of the *true* curve, drop the hit
      // (BVH false-positive on the polyline). On Newton failure or
      // missing curve, fall back silently to the polyline result (P25.4).
      const refineFn = this.ctx.viewport.refineEdgeHoverWithAnalytic;
      if (typeof refineFn === 'function' && this.ctx.bridge) {
        try {
          const refined = refineFn.call(
            this.ctx.viewport,
            this.ctx.bridge,
            edgeId,
            e.clientX,
            e.clientY,
          );
          if (refined && !refined.within) {
            return null;
          }
        } catch {
          // engine may not support edgeRayDistance — fall through
        }
      }

      return { kind: 'edge', id: edgeId };
    }

    if (picked.type === 'face'
        && (picked.hit as { faceIndex?: number }).faceIndex != null) {
      const triIdx = (picked.hit as { faceIndex: number }).faceIndex;
      const fid = this.ctx.getFaceId?.(triIdx);
      if (typeof fid !== 'number') return null;
      return { kind: 'face', id: fid };
    }

    return null;
  }

  onMouseUp(e: MouseEvent): void {
    if (this.dragSelectStart) {
      if (this.isDragSelecting) {
        this.performBoxSelect(
          this.dragSelectStart.x, this.dragSelectStart.y,
          e.clientX, e.clientY,
          this.dragModifiers.shift,
          this.dragModifiers.ctrl,
          this.dragModifiers.alt,
        );
        this.removeDragSelectBox();
      } else {
        // Shift/Alt/Ctrl 눌린 빈 클릭은 선택 유지.
        if (!this.dragModifiers.shift && !this.dragModifiers.ctrl && !this.dragModifiers.alt) {
          this.ctx.selection.clearSelection();
        }
      }
      this.dragSelectStart = null;
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // SketchUp/AutoCAD 관습:
      //   - 드래그 박스 진행 중이면 박스만 취소 (선택 유지)
      //   - 그 외에는 현재 선택 전체 해제
      const wasDragging = this.isDragSelecting || this.dragSelectStart !== null;
      this.cleanup();
      if (!wasDragging) {
        this.ctx.selection.clearSelection();
      }
    }
  }

  isBusy(): boolean {
    return this.isDragSelecting;
  }

  cleanup(): void {
    this.removeDragSelectBox();
    // Bug 8 fix: multi-click 추적 상태 + 타이머 초기화 (tool 전환 시 누수 방지)
    this.resetMultiClickState();
    this.dragModifiers = { shift: false, ctrl: false, alt: false };
    // ADR-039 P24.3 — tool 변경 / cleanup 시 hover clear.
    this.setHoverTarget(null);
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

  private performBoxSelect(
    startX: number, startY: number, endX: number, endY: number,
    shiftKey: boolean = false, ctrlKey: boolean = false, altKey: boolean = false,
  ): void {
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

    // ── Apply selection (modifier 존중) ──
    //   plain drag: 기존 선택 대체 (onMouseMove가 이미 clearSelection 호출함)
    //   shift drag: 기존 선택에 박스 내용 **추가**
    //   alt   drag: 박스 내용 **빼기**
    //   ctrl  drag: 박스 내용 **토글**
    if (altKey) {
      for (const fid of selectedFaces) {
        this.ctx.selection.handleClick(fid, false, false, true);
      }
      for (const eid of selectedEdges) {
        this.ctx.selection.handleEdgeClick(eid, false, false, true);
      }
    } else if (ctrlKey) {
      for (const fid of selectedFaces) {
        this.ctx.selection.handleClick(fid, false, true, false);
      }
      for (const eid of selectedEdges) {
        this.ctx.selection.handleEdgeClick(eid, false, true, false);
      }
    } else {
      // shift drag 또는 plain drag (이미 clear 됨) — 추가 동작.
      for (const fid of selectedFaces) {
        this.ctx.selection.handleClick(fid, true, false, false);
      }
      for (const eid of selectedEdges) {
        this.ctx.selection.handleEdgeClick(eid, true, false, false);
      }
    }
    void shiftKey; // 시그니처에 유지 (향후 확장용)
  }
}
