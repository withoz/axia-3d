/**
 * Draw Line Tool — State Machine based line drawing
 *
 * State Machine:
 *   Idle ──(ToolSelected)──→ Armed ──(1st Click)──→ Drawing
 *     ↑                        │                      │
 *     │                   (Esc)│              (MouseMove: preview)
 *     │                        │                      │
 *     │                        ↓              (2nd Click)
 *     │                      Idle                     │
 *     │                                               ↓
 *     │                                           Confirmed
 *     │                                               │
 *     │              ┌────────────────────────────────┘
 *     │              │ (continuous: end → next start)
 *     │              ↓
 *     │           Drawing  ←── 연속 그리기 (SketchUp style)
 *     │              │
 *     │         (Esc/RightClick)
 *     └──────────────┘
 *
 * Design: Viewport events and engine creation are fully separated.
 *         The engine is only called at the Confirmed stage.
 */

import * as THREE from 'three';
import { ITool, ToolContext } from './ITool';
import { debugLog } from '../utils/debug';
import { Toast } from '../ui/Toast';

// ═══════════════════════════════════════════════════
//  State & Event Definitions
// ═══════════════════════════════════════════════════

export enum LineDrawState {
  Idle,       // 대기 — 다른 도구 사용 가능
  Armed,      // 시작점 대기 — "라인 그리기 모드에 들어온 상태"
  Drawing,    // 마우스 이동 중 — 시작점 확정, 끝점 후보 미리보기
  Confirmed,  // 라인 확정 — 엔진 호출 후 즉시 Drawing으로 복귀 (연속) 또는 Idle
}

export enum LineDrawEvent {
  ToolSelected,
  MouseMove,
  LeftClick,
  RightClick,
  Escape,
}

// ═══════════════════════════════════════════════════
//  DrawLineTool Implementation
// ═══════════════════════════════════════════════════

export class DrawLineTool implements ITool {
  readonly name = 'line';

  private ctx: ToolContext;
  private state: LineDrawState = LineDrawState.Idle;

  // Geometry state
  private startPoint: THREE.Vector3 | null = null;
  private previewEnd: THREE.Vector3 | null = null;

  // Face Split — track which face is being drawn on
  private startFaceId: number = -1;
  private endFaceId: number = -1;
  /** 현재 마우스 커서가 올라간 face ID (mousemove 갱신). -1 = 허공. */
  private hoverFaceId: number = -1;

  // Chain tracking — first point of continuous drawing chain (for loop close detection)
  private chainStartPoint: THREE.Vector3 | null = null;

  // Three.js preview objects
  private linePreview: THREE.Line | null = null;
  private startDot: THREE.Points | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  // ═══════════════════════════════════════════════════
  //  ITool Interface
  // ═══════════════════════════════════════════════════

  onActivate(): void {
    this.handle(LineDrawEvent.ToolSelected);
    debugLog('[DrawLineTool] Activated');
  }

  onDeactivate(): void {
    this.handle(LineDrawEvent.Escape);
  }

  onMouseDown(e: MouseEvent, point: THREE.Vector3 | null): void {
    if (e.button === 2) {
      // Right click → cancel/stop continuous
      this.handle(LineDrawEvent.RightClick);
      return;
    }
    if (e.button !== 0) return;

    // ─── Face detection for Face Split ───
    // Capture which face (if any) was clicked before dispatching to state machine
    const pickedFaceId = this.pickFaceAtMouse(e);

    if (this.state === LineDrawState.Armed) {
      // First click: remember face for potential face split
      this.startFaceId = pickedFaceId;
      this.endFaceId = -1;
      if (pickedFaceId >= 0) {
        debugLog(`[FaceSplit] 1st click on face ${pickedFaceId}`);
      }
    } else if (this.state === LineDrawState.Drawing) {
      // Second+ click: remember end face
      this.endFaceId = pickedFaceId;
      if (pickedFaceId >= 0) {
        debugLog(`[FaceSplit] 2nd click on face ${pickedFaceId} (start was ${this.startFaceId})`);
      }
    }

    // Check loop close first (higher priority than regular snap)
    const loopClosePoint = this.checkLoopClose(e);
    if (loopClosePoint) {
      this.handle(LineDrawEvent.LeftClick, loopClosePoint);
      return;
    }

    // Compute precise click point with snap and axis inference
    const clickPoint = this.computeClickPoint(e, point);
    if (!clickPoint) return;

    this.handle(LineDrawEvent.LeftClick, clickPoint);
  }

  onMouseMove(e: MouseEvent, point: THREE.Vector3 | null): void {
    // 면 분할 프리뷰용: 현재 hover face 추적 (drawing 중일 때만 의미 있음)
    if (this.state === LineDrawState.Drawing) {
      this.hoverFaceId = this.pickFaceAtMouse(e);
    } else {
      this.hoverFaceId = -1;
    }

    // Check for loop close proximity (snap to chain start point)
    const loopClosePoint = this.checkLoopClose(e);
    if (loopClosePoint) {
      this.handle(LineDrawEvent.MouseMove, loopClosePoint);
      return;
    }

    // Compute preview point with snap and axis inference
    const movePoint = this.computeMovePoint(e, point);
    this.handle(LineDrawEvent.MouseMove, movePoint);
  }

  onMouseUp(_e: MouseEvent): void {
    // Line tool uses click-click, not drag — no action on mouse up
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.handle(LineDrawEvent.Escape);
    }
  }

  applyVCBValue(value: number): void {
    if (this.state !== LineDrawState.Drawing || !this.startPoint) return;

    // ── Bug 2 fix: NaN/Infinity/0 가드 ──
    if (!Number.isFinite(value) || value === 0) {
      Toast.warning('유효한 길이를 입력하세요', 2000);
      return;
    }

    // Use current axis (locked or inferred) to determine direction
    const axis = this.ctx.axisLock || this.ctx.inferredAxis;
    let dir = new THREE.Vector3(1, 0, 0);
    if (axis === 'y') dir.set(0, 1, 0);
    else if (axis === 'z') dir.set(0, 0, 1);
    else if (axis === 'free' || !axis) {
      // ── Bug 1 fix: free 축일 때 X축 강제 대신 현재 preview 방향 사용 ──
      // 마우스가 가리키는 방향(또는 스냅 방향)을 유지.
      if (this.previewEnd) {
        const delta = this.previewEnd.clone().sub(this.startPoint);
        if (delta.lengthSq() > 1e-6) {
          dir = delta.normalize();
        }
        // (delta가 ≈0이면 X축 fallback — 마우스를 움직이지 않고 VCB만 친 경우)
      }
    }

    const endPt = this.startPoint.clone().add(dir.multiplyScalar(value));
    debugLog(`[VCB/Line] Length=${value} axis=${axis} dir=(${dir.x.toFixed(2)},${dir.y.toFixed(2)},${dir.z.toFixed(2)})`);

    // Commit via state machine
    this.handle(LineDrawEvent.LeftClick, endPt);
  }

  isBusy(): boolean {
    return this.state === LineDrawState.Drawing;
  }

  cleanup(): void {
    this.transitionTo(LineDrawState.Idle);
  }

  // ═══════════════════════════════════════════════════
  //  State Machine — Core
  // ═══════════════════════════════════════════════════

  /**
   * Central event handler — all state transitions go through here.
   * This is the ONLY place where state changes happen.
   */
  private handle(event: LineDrawEvent, point?: THREE.Vector3 | null): void {
    switch (this.state) {

      // ─── Idle: waiting for tool activation ───
      case LineDrawState.Idle:
        if (event === LineDrawEvent.ToolSelected) {
          this.transitionTo(LineDrawState.Armed);
        }
        break;

      // ─── Armed: tool active, waiting for first click ───
      case LineDrawState.Armed:
        if (event === LineDrawEvent.LeftClick && point) {
          this.startPoint = point.clone();
          // Track chain origin for loop close detection
          if (!this.chainStartPoint) {
            this.chainStartPoint = point.clone();
          }
          this.ctx.snap.setReferencePoint(point);
          this.ctx.axisLock = null;
          this.ctx.inferredAxis = 'free';
          this.showStartDot(point);
          this.transitionTo(LineDrawState.Drawing);
        } else if (event === LineDrawEvent.Escape || event === LineDrawEvent.RightClick) {
          // Bug 6 fix: Armed에서 RightClick도 Escape와 동일하게 Idle로 종료
          this.transitionTo(LineDrawState.Idle);
        }
        break;

      // ─── Drawing: start point set, previewing end point ───
      case LineDrawState.Drawing:
        if (event === LineDrawEvent.MouseMove) {
          this.previewEnd = point ? point.clone() : null;
          this.updatePreview();
        } else if (event === LineDrawEvent.LeftClick && point) {
          this.previewEnd = point.clone();
          this.transitionTo(LineDrawState.Confirmed);
          // Confirmed is transient — immediately re-enter Drawing (continuous)
        } else if (event === LineDrawEvent.Escape || event === LineDrawEvent.RightClick) {
          this.transitionTo(LineDrawState.Idle);
        }
        break;

      // ─── Confirmed: should not receive events (transient state) ───
      case LineDrawState.Confirmed:
        // Confirmed is processed synchronously in transitionTo, no events expected
        break;
    }
  }

  /**
   * Execute state transition with entry/exit actions.
   * All side effects (engine calls, visual updates) happen here.
   */
  private transitionTo(newState: LineDrawState): void {
    const oldState = this.state;
    debugLog(`[Line] ${LineDrawState[oldState]} → ${LineDrawState[newState]}`);

    // ─── Exit actions ───
    switch (oldState) {
      case LineDrawState.Drawing:
        // Clean up preview when leaving Drawing
        if (newState !== LineDrawState.Confirmed) {
          this.removeLinePreview();
          this.removeStartDot();
          this.ctx.clearAxisGuide();
          this.ctx.dimLabel.clear();
        }
        break;
    }

    // ─── Set new state ───
    this.state = newState;

    // ─── Entry actions ───
    switch (newState) {
      case LineDrawState.Idle:
        this.startPoint = null;
        this.previewEnd = null;
        this.chainStartPoint = null;
        this.startFaceId = -1;
        this.endFaceId = -1;
        this.hoverFaceId = -1;
        this.removeLinePreview();
        this.removeStartDot();
        this.ctx.clearAxisGuide();
        this.ctx.dimLabel.clear();
        this.ctx.snap.setReferencePoint(null);
        this.ctx.axisLock = null;
        this.ctx.inferredAxis = 'free';
        break;

      case LineDrawState.Armed:
        // Ready for first click — cursor could change here
        this.ctx.snap.setReferencePoint(null);
        break;

      case LineDrawState.Drawing:
        // Preview will be updated by MouseMove events
        break;

      case LineDrawState.Confirmed: {
        // *** Engine call happens ONLY here ***
        const faceCreated = this.commitLine();
        if (faceCreated) {
          // Face auto-created from closed loop or face split → stop continuous drawing
          this.removeLinePreview();
          this.removeStartDot();
          this.startPoint = null;
          this.previewEnd = null;
          this.chainStartPoint = null;
          this.startFaceId = -1;
          this.endFaceId = -1;
          this.hoverFaceId = -1;
          this.ctx.clearAxisGuide();
          this.ctx.dimLabel.clear();
          this.ctx.axisLock = null;
          this.ctx.snap.setReferencePoint(null);
          this.state = LineDrawState.Armed;
          debugLog('[Line] Loop closed / face split → returning to Armed');
        } else {
          // Continuous drawing: end → next start → back to Drawing
          this.continuousReenter();
        }
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════
  //  Engine Interaction — ONLY called from Confirmed
  // ═══════════════════════════════════════════════════

  /**
   * Commit the line to the WASM engine.
   * This is the ONLY place where the engine is called.
   * Returns true if a face was auto-created (closed loop detected or face split).
   */
  private commitLine(): boolean {
    if (!this.startPoint || !this.previewEnd) return false;

    const len = this.startPoint.distanceTo(this.previewEnd);
    if (len <= 1) return false; // Too short, ignore

    // ─── Face Split path ───
    // If both start and end are on the same existing face → split that face
    if (this.startFaceId >= 0 && this.startFaceId === this.endFaceId) {
      return this.tryFaceSplit(this.startFaceId, this.startPoint, this.previewEnd, len);
    }

    // Log why face split was NOT triggered (for debugging)
    if (this.startFaceId >= 0 || this.endFaceId >= 0) {
      debugLog(`[FaceSplit] Not triggered: startFace=${this.startFaceId}, endFace=${this.endFaceId} (need same face ≥ 0)`);
    }

    // ─── Regular draw line path ───
    const facesBefore = this.ctx.bridge.faceCount();

    this.ctx.bridge.drawLine(
      this.startPoint.x, this.startPoint.y, this.startPoint.z,
      this.previewEnd.x, this.previewEnd.y, this.previewEnd.z,
    );

    const facesAfter = this.ctx.bridge.faceCount();
    const faceCreated = facesAfter > facesBefore;

    if (faceCreated) {
      debugLog(`[Line] Closed loop → face created! (${len.toFixed(2)} mm)`);
    } else {
      debugLog(`[Line] Created: ${len.toFixed(2)} mm`);
    }

    this.ctx.syncMesh();
    return faceCreated;
  }

  /**
   * Attempt to split a face by drawing a line across it.
   * Called when both start and end points are on the same face.
   * Returns true if split succeeded (face was divided → stop continuous drawing).
   *
   * UX 개선 (2026-04-17):
   * - 실패 시 Toast 알림 (이전엔 debugLog만)
   * - 성공 시 결과 face 중 하나를 자동 선택 → 바로 Push/Pull 가능
   */
  private tryFaceSplit(faceId: number, start: THREE.Vector3, end: THREE.Vector3, len: number): boolean {
    try {
      debugLog(`[FaceSplit] Attempting: face=${faceId}, start=(${start.x.toFixed(2)},${start.y.toFixed(2)},${start.z.toFixed(2)}), end=(${end.x.toFixed(2)},${end.y.toFixed(2)},${end.z.toFixed(2)}), len=${len.toFixed(2)}`);

      const resultJson = this.ctx.bridge.splitFaceByLine(
        faceId,
        [start.x, start.y, start.z],
        [end.x, end.y, end.z],
      );

      // Empty string means WASM method not available (older WASM build)
      if (!resultJson) {
        debugLog(`[FaceSplit] WASM splitFaceByLine not available — falling back to drawLine`);
        return this.fallbackDrawLine(start, end, len);
      }

      const result = JSON.parse(resultJson);

      if (result.error) {
        // ADR-003 가드, 인접 정점 거부 등 → 사용자에게 원인 전달
        debugLog(`[FaceSplit] Engine error: ${result.error} — falling back to drawLine`);
        // 친절 메시지는 원인+해결책을 한 줄에 담기에 조금 더 긴 표시 시간 허용
        Toast.warning(
          `면 분할 실패: ${this.friendlyErrorMessage(result.error)} — 일반 선으로 그립니다`,
          4500,
        );
        return this.fallbackDrawLine(start, end, len);
      }

      const newFaces: number[] = Array.isArray(result.faces) ? result.faces : [];
      debugLog(`[FaceSplit] Success! face=${faceId} → [${newFaces}] (+${result.verts?.length || 0} verts, +${result.edges || 0} edges)`);

      this.ctx.syncMesh();

      // ⑫ 자동 선택: end 좌표에 가장 가까운 centroid를 가진 sub-face 선택 (Bug 5 fix)
      // 사용자가 마지막으로 가리킨 쪽 면이 선택되어 즉시 Push/Pull 가능.
      if (newFaces.length > 0) {
        let pickedFace = newFaces[0];
        if (newFaces.length > 1) {
          // bridge.facesCentroid 사용 — 없으면 첫 번째 fallback
          let bestDist = Infinity;
          for (const fid of newFaces) {
            try {
              const c = this.ctx.bridge.facesCentroid([fid]);
              if (c) {
                const d = c.distanceToSquared(end);
                if (d < bestDist) {
                  bestDist = d;
                  pickedFace = fid;
                }
              }
            } catch { /* centroid 미지원 — 넘어감 */ }
          }
        }
        this.ctx.selection.clearSelection();
        this.ctx.selection.selectFaces([pickedFace]);
        debugLog(`[FaceSplit] Auto-selected sub-face ${pickedFace} (closest to end)`);
      }

      Toast.info(`면이 ${newFaces.length}개로 분할됨`, 1800);
      return true; // Face was split → stop continuous and return to Armed

    } catch (err) {
      debugLog(`[FaceSplit] Exception: ${err} — falling back to drawLine`);
      Toast.error(`면 분할 중 오류: ${err}`, 3000);
      return this.fallbackDrawLine(start, end, len);
    }
  }

  /**
   * Rust 에러 메시지를 사용자 친화 한국어로 변환.
   * "원인 + 해결 방법"을 한 줄에 담아 사용자가 다음 액션을 즉시 이해하도록 함.
   */
  private friendlyErrorMessage(err: string): string {
    // 길이 관련
    if (err.includes('degenerate') || err.includes('EPSILON')) {
      return '분할선이 너무 짧습니다 (시작점과 끝점을 더 떨어뜨리세요)';
    }
    // 인접 정점 — 사용자 관점에서 왜/어떻게
    if (err.includes('adjacent')) {
      return '이미 이어진 모서리 위의 두 점은 분할에 사용할 수 없습니다 — 반대쪽 모서리나 면 안쪽을 끝점으로 하세요';
    }
    // 수치 이상
    if (err.includes('finite')) {
      return '분할 좌표가 유효하지 않습니다 (NaN/Infinity) — 스냅을 확인하세요';
    }
    // 대상 면 사라짐
    if (err.includes('not found')) {
      return '대상 면을 찾을 수 없습니다 (이미 삭제되었거나 선택 해제됨)';
    }
    // 같은 정점 중복
    if (err.includes('same vertex')) {
      return '시작점과 끝점이 같은 정점입니다';
    }
    // 내부 점 해석 실패
    if (err.includes('Could not resolve')) {
      return '분할선 위치를 경계에서 찾지 못했습니다 — 면 가장자리 근처에서 다시 시도하세요';
    }
    // 경계 정점 없음
    if (err.includes('boundary')) {
      return '면 경계 위에 분할 끝점을 놓아주세요';
    }
    return err; // 원본 유지 (예상 못 한 에러)
  }

  /**
   * Fallback: regular drawLine when face split fails or is unavailable.
   */
  private fallbackDrawLine(start: THREE.Vector3, end: THREE.Vector3, len: number): boolean {
    const facesBefore = this.ctx.bridge.faceCount();

    this.ctx.bridge.drawLine(
      start.x, start.y, start.z,
      end.x, end.y, end.z,
    );

    const facesAfter = this.ctx.bridge.faceCount();
    const faceCreated = facesAfter > facesBefore;

    if (faceCreated) {
      debugLog(`[Line] Closed loop → face created! (${len.toFixed(2)} mm)`);
    } else {
      debugLog(`[Line] Created: ${len.toFixed(2)} mm`);
    }

    this.ctx.syncMesh();
    return faceCreated;
  }

  /**
   * After commit, re-enter Drawing for continuous line drawing.
   * End point becomes next start point (SketchUp style).
   */
  private continuousReenter(): void {
    if (this.previewEnd) {
      this.startPoint = this.previewEnd.clone();
      this.previewEnd = null;
      // Carry over endFaceId as next startFaceId (continuous drawing on same face)
      this.startFaceId = this.endFaceId;
      this.endFaceId = -1;
      this.removeLinePreview();
      this.ctx.clearAxisGuide();
      this.ctx.dimLabel.clear();
      this.ctx.axisLock = null;
      this.ctx.snap.setReferencePoint(this.startPoint);
      this.showStartDot(this.startPoint);
      this.state = LineDrawState.Drawing;
      debugLog(`[Line] Confirmed → Drawing (continuous)`);
    } else {
      this.transitionTo(LineDrawState.Idle);
    }
  }

  // ═══════════════════════════════════════════════════
  //  Face Detection (for Face Split)
  // ═══════════════════════════════════════════════════

  /**
   * Raycast to detect which face (if any) is under the mouse cursor.
   * Returns DCEL FaceId (≥0) or -1 if no face hit.
   */
  private pickFaceAtMouse(e: MouseEvent): number {
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.faceIndex != null) {
      const faceId = this.ctx.getFaceId(hit.faceIndex);
      return faceId >= 0 ? faceId : -1;
    }
    return -1;
  }

  // ═══════════════════════════════════════════════════
  //  Point Computation (Snap + Axis Inference)
  // ═══════════════════════════════════════════════════

  /**
   * Compute precise click point: snap > axis inference > raw point
   */
  private computeClickPoint(e: MouseEvent, fallback: THREE.Vector3 | null): THREE.Vector3 | null {
    if (this.state === LineDrawState.Armed) {
      // First click: try snap first, then fallback
      const rawPt = this.ctx.get3DPoint(e);
      const snapPt = this.ctx.getSnappedPoint(e, rawPt, true);
      // Snap fires → use exact snap position (f64 precision)
      if (snapPt) return snapPt;
      return rawPt ?? fallback;
    }

    if (this.state === LineDrawState.Drawing && this.startPoint) {
      // Second+ click: snap > axis inference > raw
      const rawPt = this.ctx.get3DPoint(e);
      const snapPt = this.ctx.getSnappedPoint(e, rawPt, true);
      // Snap fires → always use it (exact coordinate match for loop close)
      if (snapPt) return snapPt;

      const inferred = this.ctx.getAxisInferredPoint(e, this.startPoint);
      return inferred ? inferred.point : (rawPt ?? fallback);
    }

    return fallback;
  }

  /**
   * Compute preview point during mouse move: snap > axis inference
   */
  private computeMovePoint(e: MouseEvent, fallback: THREE.Vector3 | null): THREE.Vector3 | null {
    if (this.state !== LineDrawState.Drawing || !this.startPoint) {
      return fallback;
    }

    const rawPt = this.ctx.get3DPoint(e);
    const snapPt = this.ctx.getSnappedPoint(e, rawPt);

    // Snap fires → always use exact snap position
    if (snapPt) {
      this.ctx.inferredAxis = 'free';
      return snapPt;
    }

    const inferred = this.ctx.getAxisInferredPoint(e, this.startPoint);
    if (inferred) {
      this.ctx.inferredAxis = inferred.axis;
      return inferred.point;
    }

    return rawPt ?? fallback;
  }

  /**
   * Check if mouse is near the chain start point (loop close).
   * Returns the exact chainStartPoint if within screen pixel threshold,
   * and sets a loopClose snap override for visual feedback.
   */
  private checkLoopClose(e: MouseEvent): THREE.Vector3 | null {
    if (this.state !== LineDrawState.Drawing || !this.chainStartPoint || !this.startPoint) {
      return null;
    }

    // Need at least 2 segments to form a loop (startPoint ≠ chainStartPoint)
    if (this.startPoint.distanceTo(this.chainStartPoint) < 1) {
      return null; // Still on first segment — no loop possible
    }

    // Project chainStartPoint to screen space
    const camera = this.ctx.viewport.activeCamera;
    const container = this.ctx.viewport.container;
    if (!camera || !container) return null;

    const projected = this.chainStartPoint.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) return null; // Behind camera

    const rect = container.getBoundingClientRect();
    const screenX = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    const screenY = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;

    // Screen distance from mouse to chain start
    const dx = e.clientX - screenX;
    const dy = e.clientY - screenY;
    const screenDist = Math.sqrt(dx * dx + dy * dy);

    const LOOP_CLOSE_THRESHOLD_PX = 15;
    if (screenDist > LOOP_CLOSE_THRESHOLD_PX) return null;

    // Show loop close visual feedback (green filled circle)
    this.ctx.snapVisual.update({
      type: 'loopClose',
      position: this.chainStartPoint.clone(),
      screenPos: new THREE.Vector2(screenX, screenY),
      distance: screenDist,
    }, this.ctx.viewport.activeCamera);

    return this.chainStartPoint.clone();
  }

  // ═══════════════════════════════════════════════════
  //  Visual Preview — Three.js objects
  // ═══════════════════════════════════════════════════

  /**
   * Update the line preview and dimension label.
   * Called every mouse move while in Drawing state.
   */
  private updatePreview(): void {
    if (!this.startPoint || !this.previewEnd) {
      this.removeLinePreview();
      return;
    }

    const axis = this.ctx.inferredAxis;
    const axisColors: Record<string, number> = {
      x: 0xff3333, y: 0x3388ff, z: 0x33cc33, free: 0x74c0fc,
    };
    const axisColorStr: Record<string, string> = {
      x: '#ff3333', y: '#3388ff', z: '#33cc33', free: '#74c0fc',
    };
    const axisNames: Record<string, string> = {
      x: 'X축', y: 'Y축(높이)', z: 'Z축', free: '',
    };

    // ──── 분할 예정 감지 ────────────────────────────────────────
    // startFaceId가 유효하고 현재 같은 face 위라면 두 번째 클릭 시 face split 발생.
    // 사용자에게 시각적으로 "이 선은 면을 자른다" 신호를 보라색으로 전달.
    const willSplit =
      this.startFaceId >= 0 && this.hoverFaceId === this.startFaceId;

    const SPLIT_COLOR = 0xa855f7;     // 보라 — 분할 예정
    const SPLIT_COLOR_STR = '#a855f7';
    const lineColor = willSplit ? SPLIT_COLOR : axisColors[axis];
    const lineColorStr = willSplit ? SPLIT_COLOR_STR : axisColorStr[axis];

    // Preview line
    this.renderLinePreview(this.startPoint, this.previewEnd, lineColor, willSplit);

    // Axis guide
    this.ctx.updateAxisGuide(this.startPoint, axis, this.previewEnd);

    // Dimension label
    const len = this.startPoint.distanceTo(this.previewEnd);
    if (len > 0.1) {
      const baseLabel = axisNames[axis]
        ? `${axisNames[axis]} ${this.ctx.units.format(len)}`
        : this.ctx.units.format(len);
      // 분할 예정이면 라벨 앞에 표시기 추가
      const label = willSplit ? `\u2702 ${baseLabel}` : baseLabel;
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.startPoint.clone(), to: this.previewEnd.clone(), text: label, color: lineColorStr },
      ]);
    }
  }

  /**
   * Render the temporary line preview in 3D.
   * When `dashed` is true, renders as a dashed line (used for "will split" preview).
   */
  private renderLinePreview(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    dashed: boolean = false,
  ): void {
    this.removeLinePreview();

    // Bug 4 fix: Y축 고정 오프셋 제거 — 수직 벽 위 프리뷰가 벽 속에 파묻히던 문제 해결.
    // 대신 depthTest: false + 높은 renderOrder로 항상 최상위 렌더.
    const points = [start.clone(), end.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    if (dashed) {
      // 분할 예정 — 점선 + 보라색으로 "이 선은 면을 자른다" 신호
      const mat = new THREE.LineDashedMaterial({
        color,
        linewidth: 1,
        dashSize: 80,   // mm 단위 (씬 스케일에 맞춤)
        gapSize: 40,
        depthTest: false,
      });
      this.linePreview = new THREE.Line(geo, mat);
      this.linePreview.computeLineDistances(); // LineDashedMaterial 필수
      this.linePreview.renderOrder = 1001;
      this.ctx.viewport.scene.add(this.linePreview);
      return;
    }
    const mat = new THREE.LineBasicMaterial({
      color,
      linewidth: 1,
      depthTest: false,
    });
    this.linePreview = new THREE.Line(geo, mat);
    this.linePreview.renderOrder = 1001;
    this.ctx.viewport.scene.add(this.linePreview);
  }

  /**
   * Show a dot at the start point for visual feedback.
   */
  private showStartDot(point: THREE.Vector3): void {
    this.removeStartDot();

    // Bug 4 fix: Y축 고정 오프셋 제거 (depthTest:false로 항상 보이게 함)
    const geo = new THREE.BufferGeometry().setFromPoints([point.clone()]);
    const mat = new THREE.PointsMaterial({
      color: 0x22b8cf,
      size: 8,
      sizeAttenuation: false,
      depthTest: false,
    });
    this.startDot = new THREE.Points(geo, mat);
    this.startDot.renderOrder = 1000;
    this.ctx.viewport.scene.add(this.startDot);
  }

  private removeLinePreview(): void {
    if (this.linePreview) {
      this.ctx.viewport.scene.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
      this.linePreview = null;
    }
  }

  private removeStartDot(): void {
    if (this.startDot) {
      this.ctx.viewport.scene.remove(this.startDot);
      this.startDot.geometry.dispose();
      (this.startDot.material as THREE.Material).dispose();
      this.startDot = null;
    }
  }

  // ═══════════════════════════════════════════════════
  //  Public State Query (for debugging / UI)
  // ═══════════════════════════════════════════════════

  /** Current state machine state (for debugging or status bar) */
  getState(): LineDrawState {
    return this.state;
  }

  /** Current state name as string */
  getStateName(): string {
    return LineDrawState[this.state];
  }
}
