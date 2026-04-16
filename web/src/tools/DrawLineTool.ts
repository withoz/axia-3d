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

    // Use current axis (locked or inferred) to determine direction
    const axis = this.ctx.axisLock || this.ctx.inferredAxis;
    let dir = new THREE.Vector3(1, 0, 0);
    if (axis === 'y') dir.set(0, 1, 0);
    else if (axis === 'z') dir.set(0, 0, 1);

    const endPt = this.startPoint.clone().add(dir.multiplyScalar(value));
    debugLog(`[VCB/Line] Length=${value} axis=${axis}`);

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
        } else if (event === LineDrawEvent.Escape) {
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
          // Face auto-created from closed loop → stop continuous drawing
          this.removeLinePreview();
          this.removeStartDot();
          this.startPoint = null;
          this.previewEnd = null;
          this.chainStartPoint = null;
          this.ctx.clearAxisGuide();
          this.ctx.dimLabel.clear();
          this.ctx.axisLock = null;
          this.ctx.snap.setReferencePoint(null);
          this.state = LineDrawState.Armed;
          debugLog('[Line] Loop closed → returning to Armed');
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
   * Returns true if a face was auto-created (closed loop detected).
   */
  private commitLine(): boolean {
    if (!this.startPoint || !this.previewEnd) return false;

    const len = this.startPoint.distanceTo(this.previewEnd);
    if (len <= 1) return false; // Too short, ignore

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
   * After commit, re-enter Drawing for continuous line drawing.
   * End point becomes next start point (SketchUp style).
   */
  private continuousReenter(): void {
    if (this.previewEnd) {
      this.startPoint = this.previewEnd.clone();
      this.previewEnd = null;
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

    // Preview line
    this.renderLinePreview(this.startPoint, this.previewEnd, axisColors[axis]);

    // Axis guide
    this.ctx.updateAxisGuide(this.startPoint, axis, this.previewEnd);

    // Dimension label
    const len = this.startPoint.distanceTo(this.previewEnd);
    if (len > 0.1) {
      const label = axisNames[axis]
        ? `${axisNames[axis]} ${this.ctx.units.format(len)}`
        : this.ctx.units.format(len);
      this.ctx.dimLabel.update(this.ctx.viewport.activeCamera, [
        { from: this.startPoint.clone(), to: this.previewEnd.clone(), text: label, color: axisColorStr[axis] },
      ]);
    }
  }

  /**
   * Render the temporary line preview in 3D.
   */
  private renderLinePreview(start: THREE.Vector3, end: THREE.Vector3, color: number): void {
    this.removeLinePreview();

    const offset = 0.5; // Y offset to prevent z-fighting with ground
    const points = [
      new THREE.Vector3(start.x, start.y + offset, start.z),
      new THREE.Vector3(end.x, end.y + offset, end.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color,
      linewidth: 1,
      depthTest: true,
    });
    this.linePreview = new THREE.Line(geo, mat);
    this.linePreview.renderOrder = 999;
    this.ctx.viewport.scene.add(this.linePreview);
  }

  /**
   * Show a dot at the start point for visual feedback.
   */
  private showStartDot(point: THREE.Vector3): void {
    this.removeStartDot();

    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(point.x, point.y + 0.5, point.z),
    ]);
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
