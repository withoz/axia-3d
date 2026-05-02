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
//  Geometry helper: 2D segment-segment intersection
// ═══════════════════════════════════════════════════

/** Returns true if open segments AB and CD properly intersect (excluding shared endpoints). */
function segmentsIntersect2D(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  // Strict crossing (sign flips on both) — we skip collinear overlap cases
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

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
  /** All committed waypoints of the current chain (Phase 1: B1 — close to any) */
  private chainPoints: THREE.Vector3[] = [];
  /** Last loop-close target type (for Toast/UI differentiation) */
  private lastCloseKind: 'chain-start' | 'chain-mid' | 'free' | null = null;
  /**
   * Drawing plane locked on first click.
   * Subsequent clicks/moves project the mouse ray onto THIS plane instead of
   * viewport's pick-then-workplane fallback, so a continuous chain stays
   * coplanar even when the mouse passes over other faces.
   * Snap overrides this (snap point used verbatim). Shift key lets the user
   * temporarily bypass plane-lock for 3D paths.
   */
  private drawingPlane: THREE.Plane | null = null;

  // Three.js preview objects
  private linePreview: THREE.Line | null = null;
  private startDot: THREE.Points | null = null;

  // Snap 프리셋 교체 시 원상복구를 위한 이전 설정 저장
  private _savedSnapModes: Set<import('../snap/SnapManager').SnapType> | null = null;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  // ═══════════════════════════════════════════════════
  //  ITool Interface
  // ═══════════════════════════════════════════════════

  onActivate(): void {
    // Line 도구 진입 시 face-creation 최적 snap 프리셋 적용.
    // 기존 snap 설정은 onDeactivate에서 원복.
    this._savedSnapModes = this.ctx.snap.saveSnapConfig();
    this.ctx.snap.applyFaceCreationPreset();

    this.handle(LineDrawEvent.ToolSelected);
    debugLog('[DrawLineTool] Activated (face-creation snap preset applied)');
  }

  onDeactivate(): void {
    this.handle(LineDrawEvent.Escape);
    // Snap 원상복구
    if (this._savedSnapModes) {
      this.ctx.snap.restoreSnapConfig(this._savedSnapModes);
      this._savedSnapModes = null;
    }
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
      // Lock the drawing plane based on this click (pick hit or workplane)
      this.establishDrawingPlane(e);
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
    // Shift 여부는 각 mouse 이벤트의 e.shiftKey로 직접 읽음 (키업 훅 불필요)
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

  /**
   * ADR-047 P32 — Chain-pending vertices excluded from endpoint snap.
   *
   * Returns all chain waypoints EXCEPT chainStart (which must remain
   * snappable so the user can close the loop back to where they began).
   * Without this, SnapManager would pull the cursor onto a vertex
   * already in the pending chain → face synthesis bails with a duplicate-
   * vertex error → silent face-creation failure.
   */
  getExcludedSnapPoints(): THREE.Vector3[] {
    if (this.chainPoints.length <= 1) return [];
    // chainPoints[0] = chainStart (keep snappable for loopClose).
    // chainPoints[1..] = mid-waypoints (exclude).
    return this.chainPoints.slice(1).map(p => p.clone());
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
            this.chainPoints = [point.clone()];
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
        this.chainPoints = [];
        this.lastCloseKind = null;
        this._lastIntersectionWarn = null;
        this.drawingPlane = null;
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
          this.chainPoints = [];
          this.lastCloseKind = null;
          this._lastIntersectionWarn = null;
          this.drawingPlane = null;
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

    // Task 5: Split vs loop-close precedence
    // 규칙: loop close(chainStart/waypoint/free endpoint 근접)가 가장 우선.
    //       같은 면 위 split은 그 다음. 둘 다 조건 충족 시 loopClose 우선.
    const isLoopClose = this.lastCloseKind !== null;

    if (isLoopClose) {
      // Task 2 / B2: 평면성 검사 — 닫힌 루프가 실제로 같은 평면인가?
      const allPts = [...this.chainPoints, this.previewEnd];
      const planar = this.isChainPlanar(allPts);
      if (!planar) {
        Toast.warning('비평면 루프 — 면이 자동 생성되지 않을 수 있습니다', 2500);
      }
      if (this.startFaceId >= 0 && this.startFaceId === this.endFaceId) {
        debugLog('[Line] Both loop-close and same-face conditions met — loop-close wins');
        Toast.info('루프 닫기 실행 (면 분할이 아닌 새 경계 생성)', 1800);
      }
      // Fall through to regular drawLine path — WASM's closed-loop detection
      // will auto-create the face when applicable.
    }

    // ─── Face Split path ───
    // Only when NOT closing a loop (loop close takes precedence per Task 5).
    if (!isLoopClose && this.startFaceId >= 0 && this.startFaceId === this.endFaceId) {
      return this.tryFaceSplit(this.startFaceId, this.startPoint, this.previewEnd, len);
    }

    if (this.startFaceId >= 0 || this.endFaceId >= 0) {
      debugLog(`[FaceSplit] Not triggered: startFace=${this.startFaceId}, endFace=${this.endFaceId} (need same face ≥ 0)`);
    }

    // ─── Regular draw line path ───
    const facesBefore = this.ctx.bridge.faceCount();

    // 그리기 평면의 normal을 hint로 전달 — WASM이 면 생성 시 winding을
    // 맞춰 일관된 방향으로 normal이 나오도록 함 (CW/CCW 드로잉 상관없이).
    const n = this.drawingPlane?.normal;
    this.ctx.bridge.drawLine(
      this.startPoint.x, this.startPoint.y, this.startPoint.z,
      this.previewEnd.x, this.previewEnd.y, this.previewEnd.z,
      n?.x ?? 0, n?.y ?? 0, n?.z ?? 0,
    );

    const facesAfter = this.ctx.bridge.faceCount();
    const faceCreated = facesAfter > facesBefore;

    if (faceCreated) {
      debugLog(`[Line] Closed loop → face created! (${len.toFixed(2)} mm, kind=${this.lastCloseKind})`);
      Toast.info('루프 닫힘 — 면 생성됨', 1800);
    } else if (isLoopClose) {
      // Loop close fired but face wasn't created (likely non-planar or self-intersect)
      Toast.warning('루프 닫힘 — 면 생성 실패 (비평면 또는 자체교차)', 2500);
      debugLog(`[Line] Loop close attempted but no face created (kind=${this.lastCloseKind})`);
    } else {
      debugLog(`[Line] Created: ${len.toFixed(2)} mm`);
    }

    this.ctx.syncMesh();
    return faceCreated;
  }

  /**
   * Check if all chain points lie within tolerance of a common plane.
   * Uses PCA-like best-fit: plane normal = cross product of two largest chords.
   * Returns true if every point is within 1mm of that plane.
   */
  private isChainPlanar(pts: THREE.Vector3[]): boolean {
    if (pts.length < 4) return true; // 3 or fewer pts are always coplanar
    const origin = pts[0];
    // Find the two longest chords emanating from origin for best basis
    const vecs = pts.slice(1).map(p => p.clone().sub(origin));
    vecs.sort((a, b) => b.lengthSq() - a.lengthSq());
    const u = vecs[0].clone().normalize();
    let v: THREE.Vector3 | null = null;
    for (let i = 1; i < vecs.length; i++) {
      const cand = vecs[i].clone();
      const proj = u.clone().multiplyScalar(cand.dot(u));
      const ortho = cand.sub(proj);
      if (ortho.lengthSq() > 0.01) { v = ortho.normalize(); break; }
    }
    if (!v) return true; // colinear → planar by definition
    const normal = u.clone().cross(v).normalize();
    const d = normal.dot(origin);
    for (const p of pts) {
      if (Math.abs(normal.dot(p) - d) > 1.0) return false; // 1mm tolerance
    }
    return true;
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

    const n = this.drawingPlane?.normal;
    this.ctx.bridge.drawLine(
      start.x, start.y, start.z,
      end.x, end.y, end.z,
      n?.x ?? 0, n?.y ?? 0, n?.z ?? 0,
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
      // Phase 1: append committed point to chain for loop closure candidacy
      this.chainPoints.push(this.previewEnd.clone());
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
   * Lock the drawing plane based on the first click's context.
   *
   *  - 클릭이 face 위에 있으면 **그 face의 plane**으로 고정
   *  - 그렇지 않으면 현재 view mode의 **workplane** (XZ / XY / YZ)으로 고정
   *
   * 이후 연속 체인의 모든 점은 이 plane에 투영돼 체인이 coplanar 유지.
   * Snap이 발동하면 snap point가 우선 (plane 무시).
   */
  private establishDrawingPlane(e: MouseEvent): void {
    const hit = this.ctx.viewport.pick(e.clientX, e.clientY);
    if (hit && hit.point && hit.face) {
      // Use face-pick: world-space normal from the mesh's world matrix
      const worldNormal = hit.face.normal.clone();
      if (hit.object && hit.object.matrixWorld) {
        // Transform local normal to world (rotation only — no translation)
        const m = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        worldNormal.applyMatrix3(m).normalize();
      }
      this.drawingPlane = new THREE.Plane()
        .setFromNormalAndCoplanarPoint(worldNormal, hit.point.clone());
      debugLog('[Line] Drawing plane locked from face pick, normal=',
        worldNormal.toArray().map(v => v.toFixed(3)));
    } else {
      // Fall back to view-based workplane through the computed click point
      const vm = (this.ctx.viewport as { viewMode?: string }).viewMode ?? '3d';
      let normal: THREE.Vector3;
      switch (vm) {
        case 'front': case 'back':  normal = new THREE.Vector3(0, 0, 1); break;
        case 'right': case 'left':  normal = new THREE.Vector3(1, 0, 0); break;
        default:                    normal = new THREE.Vector3(0, 1, 0); break;
      }
      const pt = this.ctx.get3DPoint(e) ?? new THREE.Vector3();
      // 2026-04-28 — 바닥면 (default cardinal plane) 좌표 정확히 0 으로 snap.
      if (Math.abs(normal.x) > 0.999) pt.x = 0;
      else if (Math.abs(normal.y) > 0.999) pt.y = 0;
      else if (Math.abs(normal.z) > 0.999) pt.z = 0;
      this.drawingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pt);
      debugLog('[Line] Drawing plane locked to workplane, normal=',
        normal.toArray());
    }
  }

  /**
   * Cast a ray from the mouse and intersect with the locked drawing plane.
   * Returns null if no plane is locked or ray is parallel.
   */
  private projectOntoDrawingPlane(e: MouseEvent): THREE.Vector3 | null {
    if (!this.drawingPlane) return null;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
    const canvas = this.ctx.viewport.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.ctx.viewport.activeCamera);
    const hit = new THREE.Vector3();
    const result = ray.ray.intersectPlane(this.drawingPlane, hit);
    if (!result) return null;
    // Guard against NaN in degenerate camera/plane configurations
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y) || !Number.isFinite(result.z)) {
      return null;
    }

    // 2026-04-29 — 사용자 요청: 바닥면 cardinal plane 에서 그릴 때 normal-axis
    //   좌표를 정확히 0 으로 강제 (f32 ray-plane intersection ε 오차 차단).
    const n = this.drawingPlane.normal;
    if (Math.abs(n.x) > 0.999 && Math.abs(this.drawingPlane.constant) < 1e-3) result.x = 0;
    else if (Math.abs(n.y) > 0.999 && Math.abs(this.drawingPlane.constant) < 1e-3) result.y = 0;
    else if (Math.abs(n.z) > 0.999 && Math.abs(this.drawingPlane.constant) < 1e-3) result.z = 0;
    return result;
  }

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
      // Second+ click: snap > axis inference > drawing-plane projection > raw
      // Snap fires → always use it (exact coordinate match for loop close)
      const rawPt = this.ctx.get3DPoint(e);
      const snapPt = this.ctx.getSnappedPoint(e, rawPt, true);
      if (snapPt) return snapPt;

      const inferred = this.ctx.getAxisInferredPoint(e, this.startPoint);
      if (inferred) return inferred.point;

      // Drawing plane projection keeps the chain coplanar with the first click
      if (!e.shiftKey) {
        const planePt = this.projectOntoDrawingPlane(e);
        if (planePt) return planePt;
      }
      return rawPt ?? fallback;
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

    // Drawing plane projection — keeps chain coplanar with first click's plane.
    // Shift bypass lets the user draw 3D paths that cross planes.
    if (!e.shiftKey) {
      const planePt = this.projectOntoDrawingPlane(e);
      if (planePt) return planePt;
    }
    return rawPt ?? fallback;
  }

  /**
   * Check if mouse is near a valid loop-close target.
   *
   * Phase 1 (2026-04-17) 확장:
   * - B1: chainStartPoint뿐 아니라 **모든 committed waypoint + 외부 free endpoint** 후보
   * - B6: 체인이 최소 2개 커밋된 segment를 가져야 (3 segment polygon 최소)
   * - B3: 자체 교차 검사 (preview 색상으로 경고)
   *
   * Precedence: chain-start > chain-mid > free (external).
   */
  private checkLoopClose(e: MouseEvent): THREE.Vector3 | null {
    this.lastCloseKind = null;
    if (this.state !== LineDrawState.Drawing || !this.startPoint) return null;

    // B6: 최소 2 committed segment 필요 (chain에 2+ 점)
    if (this.chainPoints.length < 2) return null;

    const camera = this.ctx.viewport.activeCamera;
    const container = this.ctx.viewport.container;
    if (!camera || !container) return null;
    const rect = container.getBoundingClientRect();

    const project = (p: THREE.Vector3): { sx: number; sy: number } | null => {
      const v = p.clone().project(camera);
      if (v.z < -1 || v.z > 1) return null;
      return {
        sx: (v.x * 0.5 + 0.5) * rect.width + rect.left,
        sy: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      };
    };

    const THRESHOLD = 15;

    type Candidate = {
      point: THREE.Vector3;
      sx: number;
      sy: number;
      dist: number;
      kind: 'chain-start' | 'chain-mid' | 'free';
      priority: number;
    };
    const candidates: Candidate[] = [];
    const consider = (p: THREE.Vector3, kind: Candidate['kind'], priority: number) => {
      const s = project(p);
      if (!s) return;
      const d = Math.sqrt((e.clientX - s.sx) ** 2 + (e.clientY - s.sy) ** 2);
      if (d <= THRESHOLD) candidates.push({ point: p, sx: s.sx, sy: s.sy, dist: d, kind, priority });
    };

    // Chain start (highest priority)
    if (this.chainStartPoint) consider(this.chainStartPoint, 'chain-start', 0);

    // Chain mid-waypoints (for figure-8 / sub-loops) — skip first (= chainStart) and last (= startPoint)
    for (let i = 1; i < this.chainPoints.length - 1; i++) {
      consider(this.chainPoints[i], 'chain-mid', 1);
    }

    // External free endpoint via existing snap infra
    const ext = this.ctx.snap.findNearestEndpoint(
      e.clientX, e.clientY,
      this.ctx.viewport.activeCamera,
      this.ctx.viewport.renderer.domElement,
      THRESHOLD,
    );
    if (ext?.position) {
      // Skip if this endpoint coincides with current startPoint (would be zero-length segment)
      if (!this.startPoint || ext.position.distanceTo(this.startPoint) > 0.1) {
        consider(ext.position, 'free', 2);
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.priority !== b.priority
      ? a.priority - b.priority
      : a.dist - b.dist);
    const best = candidates[0];
    this.lastCloseKind = best.kind;

    // B3: self-intersection pre-check — preview segment startPoint → best.point
    //     against all prior chain segments (excluding immediate adjacent).
    const wouldIntersect = this.checkChainSelfIntersection(this.startPoint, best.point);

    // Visual feedback
    this.ctx.snapVisual.update({
      type: 'loopClose',
      position: best.point.clone(),
      screenPos: new THREE.Vector2(best.sx, best.sy),
      distance: best.dist,
    }, this.ctx.viewport.activeCamera);

    if (wouldIntersect) {
      // 단순 경고 toast (렌더 프레임마다 spam 방지 — 같은 상태면 재출력 안 함)
      if (this._lastIntersectionWarn !== 'shown') {
        Toast.warning('⚠ 닫힘 세그먼트가 기존 체인과 교차합니다', 1500);
        this._lastIntersectionWarn = 'shown';
      }
    } else {
      this._lastIntersectionWarn = null;
    }

    return best.point.clone();
  }

  private _lastIntersectionWarn: string | null = null;

  /**
   * Project closing segment + existing chain into the chain's best-fit 2D plane
   * and run segment-segment intersection tests. True if any non-adjacent pair crosses.
   * (Phase 1 best-effort — uses chain centroid + first chord as local basis.)
   */
  private checkChainSelfIntersection(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const pts = [...this.chainPoints, this.startPoint!];
    if (pts.length < 3) return false;
    // Build 2D basis from first chord
    const origin = pts[0];
    const e1 = pts[1].clone().sub(origin).normalize();
    // Find e2 via cross with average normal of points (or first non-collinear)
    let e2: THREE.Vector3 | null = null;
    for (let i = 2; i < pts.length; i++) {
      const cand = pts[i].clone().sub(origin);
      const proj = e1.clone().multiplyScalar(cand.dot(e1));
      const ortho = cand.sub(proj);
      if (ortho.lengthSq() > 0.01) { e2 = ortho.normalize(); break; }
    }
    if (!e2) return false; // colinear chain
    const project2D = (p: THREE.Vector3): [number, number] => {
      const d = p.clone().sub(origin);
      return [d.dot(e1), d.dot(e2!)];
    };
    // Segments: chain pts pairs (excluding last→closing is the new one under test)
    const segs2D: [number, number, number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = project2D(pts[i]);
      const [bx, by] = project2D(pts[i + 1]);
      segs2D.push([ax, ay, bx, by]);
    }
    const [cx1, cy1] = project2D(from);
    const [cx2, cy2] = project2D(to);
    // Test closing seg against all non-adjacent prior segs
    // Closing seg is from pts[last]=startPoint to to — so pts.length-2..last is adjacent
    // Also the closing point (to) may coincide with pts[0] or some waypoint, sharing endpoint.
    for (let i = 0; i < segs2D.length - 1; i++) {
      const [ax, ay, bx, by] = segs2D[i];
      if (segmentsIntersect2D(cx1, cy1, cx2, cy2, ax, ay, bx, by)) return true;
    }
    return false;
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
