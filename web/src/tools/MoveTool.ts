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

  /** Click-to-place mode — entered via startPlacement() (clipboard paste/
   *  duplicate). First mousemove captures anchor, subsequent mousemoves
   *  translate target, first click commits, Esc cancels (via undo).
   *  Distinguishes from normal drag flow which needs explicit mousedown to
   *  begin dragging. */
  private placementMode: boolean = false;

  /** Optional reference point on the placed geometry (e.g. bbox min corner)
   *  — on the first mousemove this point is translated to sit exactly at
   *  the cursor, so subsequent motion keeps this corner glued to the
   *  pointer. Without refPoint, first mousemove just captures the anchor
   *  and the object moves relatively (legacy behavior). */
  private placementRefPoint: THREE.Vector3 | null = null;

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

  /**
   * Enter click-to-place mode after clipboard paste/duplicate.
   * The given faces are treated as "floating" — cursor movement translates
   * them, first click commits, Esc cancels (via engine undo).
   *
   * UX contract (SketchUp/AutoCAD paste style):
   *   T+0  paste creates copies at tiny offset (0.1mm, topology safe)
   *   T+1  startPlacement(faceIds, refPoint) → 즉시 커서 tracking 시작
   *   T+2  사용자가 마우스 이동 →
   *          - refPoint 있음: 복제본의 해당 corner가 커서에 "붙어" 이동
   *            (첫 move에서 refPoint→cursor로 snap, 이후 커서 따라다님)
   *          - refPoint 없음: 첫 이동의 좌표가 anchor, 이후 delta translate
   *   T+3  클릭 → placement 종료, 객체가 그 위치에 확정
   *   Esc  engine.undo → 복사본 삭제
   */
  startPlacement(faceIds: number[], refPoint?: THREE.Vector3): void {
    if (faceIds.length === 0) return;
    this.placementMode = true;
    this.target = { kind: 'faces', ids: faceIds.slice() };
    this.transformActive = true;
    this.transformStartPt = null;  // set on first mousemove
    this.transformLastDelta.set(0, 0, 0);
    this.placementRefPoint = refPoint ? refPoint.clone() : null;
    Toast.info(
      refPoint
        ? '📐 복제본의 corner가 커서에 붙어 이동 → 클릭해 고정, Esc 취소'
        : '마우스로 위치 조정 → 클릭해 고정, Esc 취소',
      3500,
    );
    debugLog(`[Move] startPlacement: ${faceIds.length} faces, refPt=${refPoint?.toArray()}`);
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    // Placement mode commit: first click finalizes position.
    if (this.placementMode) {
      debugLog('[Move] Placement committed');
      this.placementMode = false;
      this.placementRefPoint = null;
      this.transformActive = false;
      this.transformStartPt = null;
      this.target = null;
      this.transformLastDelta.set(0, 0, 0);
      this.ctx.dimLabel.clear();
      return;
    }

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
    // Placement mode: first mousemove captures the anchor (no mousedown needed).
    if (this.placementMode && point && !this.transformStartPt) {
      if (this.placementRefPoint && this.target) {
        // refPoint가 주어진 경우: 해당 corner를 cursor로 snap.
        // target을 (cursor - refPoint)만큼 translate해서 refPoint가 cursor에 있게 만듦.
        const initialOffset = point.clone().sub(this.placementRefPoint);
        this.translate(this.target, initialOffset.x, initialOffset.y, initialOffset.z);
        this.ctx.syncMesh();
        // refPoint를 현재 cursor 위치로 갱신 (다음 move 델타 계산용).
        this.placementRefPoint = point.clone();
      }
      this.transformStartPt = point.clone();
      return;
    }
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
    // Placement mode doesn't react to mouseup — commit happens on mousedown.
    if (this.placementMode) return;
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
      // Placement mode cancel: undo the paste via engine, then exit mode.
      if (this.placementMode) {
        this.ctx.bridge.undo();
        this.ctx.syncMesh();
        Toast.info('복제/붙여넣기 취소', 2000);
        debugLog('[Move] Placement cancelled via Esc');
      }
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
    return this.transformActive || this.placementMode;
  }

  cleanup(): void {
    this.transformActive = false;
    this.placementMode = false;
    this.placementRefPoint = null;
    this.transformStartPt = null;
    this.target = null;
    this.transformLastDelta.set(0, 0, 0);
    this.ctx.dimLabel.clear();
  }
}
