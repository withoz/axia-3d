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
   *
   * 2026-04-27 — 선택이 비어 있고 cursor 가 정점 위에 있으면 (snap endpoint
   * 등) 그 단일 정점을 target 으로 사용 가능 (`resolveTargetWithPoint`).
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

  /**
   * Vertex pick 폴백: 선택이 비어 있을 때 cursor 의 snapped 좌표가 활성
   * 정점 위에 있으면 그 단일 정점을 target 으로 반환.
   *
   * `point` 는 ToolManager 가 snap 으로 이미 정확한 vertex 좌표로 보정
   * 했으므로 작은 tol (1mm) 로 충분.
   */
  private resolveTargetWithPoint(point: THREE.Vector3): Target | null {
    const t = this.resolveTarget();
    if (t) return t;
    const vid = this.ctx.bridge.findVertexIdAt(point.x, point.y, point.z, 1.0);
    if (vid < 0) return null;
    debugLog(`[Move] Vertex pick → vid=${vid}`);
    return { kind: 'verts', ids: [vid], edgeCount: 0 };
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

  onMouseDown(_e: MouseEvent, point: THREE.Vector3 | null): void {
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

    // 2026-04-27 — CAD-style 2-click move (사용자 요청).
    //   1st click: 객체 + 기준점 캡처
    //   mousemove: 미리보기 이동
    //   2nd click: 도착점 확정.
    //   mouseup 은 끝나지 않음 (드래그 모드 폐기).
    if (this.transformActive) {
      // 2nd click → COMMIT.
      debugLog('[Move] CAD-style commit (2nd click)');
      this.transformActive = false;
      this.transformStartPt = null;
      this.target = null;
      this.transformLastDelta.set(0, 0, 0);
      this.ctx.dimLabel.clear();
      return;
    }

    if (!point) return;

    // 선택이 있으면 그것, 없으면 cursor 위치의 정점을 target 으로 (vertex pick).
    const t = this.resolveTargetWithPoint(point);
    if (!t) {
      Toast.info('이동할 면/에지를 선택하거나 정점을 클릭하세요', 2000);
      return;
    }

    this.target = t;
    this.transformStartPt = point.clone();  // 기준점 (base point)
    this.transformActive = true;
    this.transformLastDelta.set(0, 0, 0);
    const label = t.kind === 'faces' ? `${t.ids.length} faces` : `${t.edgeCount} edges (${t.ids.length} verts)`;
    debugLog(`[Move] Base point captured, ${label} — move cursor + click to commit`);
    Toast.info('도착점을 클릭하세요 (Esc: 취소)', 2500);
  }

  onMouseMove(_e: MouseEvent, point: THREE.Vector3 | null): void {
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

  onMouseUp(_e: MouseEvent): void {
    // 2026-04-27 — CAD-style 2-click move 에서는 mouseup 에서 종료 안 함.
    //   첫 click 후 cursor 이동 → 두 번째 click 으로 commit.
    //   placement mode (paste/duplicate) 와 동일.
    // 즉 NO-OP. 호환성만 유지.
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
