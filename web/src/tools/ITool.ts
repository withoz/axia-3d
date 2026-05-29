/**
 * Tool Interface — Every tool in AXiA must implement this interface.
 * Provides a consistent API for the ToolManager to dispatch events.
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { SnapManager } from '../snap/SnapManager';
import { SnapVisual } from '../snap/SnapVisual';
import { SelectionManager } from './SelectionManager';
import { DimensionLabel } from '../ui/DimensionLabel';
import { UnitSystem } from '../units/UnitSystem';
import { PickBox } from '../ui/PickBox';

/**
 * Shared context available to all tools.
 * Tools receive this on construction and can access all shared state and helpers.
 */
export interface ToolContext {
  viewport: Viewport;
  bridge: WasmBridge;
  snap: SnapManager;
  snapVisual: SnapVisual;
  selection: SelectionManager;
  dimLabel: DimensionLabel;
  units: UnitSystem;
  faceMap: Uint32Array;
  edgeMap: Uint32Array | null;
  syncMesh: () => void;
  getSnappedPoint: (e: MouseEvent, rawGround: THREE.Vector3 | null, consume?: boolean) => THREE.Vector3 | null;
  getGroundPoint: (e: MouseEvent) => THREE.Vector3 | null;
  getSelectedFaces: () => number[];
  inferredAxis: 'x' | 'y' | 'z' | 'free';
  axisLock: 'x' | 'y' | 'z' | 'free' | null;

  // ═══ Extended methods (previously accessed via `as any`) ═══
  /** Convert triangle faceIndex to Rust FaceId */
  getFaceId: (faceIndex: number) => number;
  /** Extract face boundary vertices */
  extractFaceBoundary: (faceId: number) => THREE.Vector3[];
  /** Get 3D point from mouse event (raycast to ground/mesh) */
  get3DPoint: (e: MouseEvent) => THREE.Vector3 | null;
  /** Get axis-inferred point relative to an origin */
  getAxisInferredPoint: (e: MouseEvent, origin: THREE.Vector3) => { point: THREE.Vector3; axis: 'x' | 'y' | 'z' | 'free' } | null;
  /** Update visual axis guide line */
  updateAxisGuide: (origin: THREE.Vector3, axis: 'x' | 'y' | 'z' | 'free', endPt: THREE.Vector3) => void;
  /** Clear the axis guide line */
  clearAxisGuide: () => void;
  /** Optional pickbox for CAD cursor (used by OffsetTool) */
  pickBox?: PickBox | null;

  /**
   * Detect the drawing plane from a mouse event.
   * If clicking on an existing face → returns that face's DCEL normal and computed up vector.
   * If clicking empty space → returns default ground plane (Y-up).
   * Used by Rect/Circle tools to draw on arbitrary planes.
   */
  getDrawPlane: (e: MouseEvent) => DrawPlaneInfo;

  /**
   * Get a camera ray from a mouse event.
   * Used by tools to intersect custom planes (e.g., drawing plane for Rect/Circle).
   */
  getRay: (e: MouseEvent) => THREE.Raycaster;

  /**
   * ADR-080 V-δ-γ — Active sketch session plane info, if any.
   * Returns `null` when no sketch is active.
   * Used by OffsetTool to provide a reference plane for free wire offset
   * when V-δ-α (wire planarity) fails (single edge, collinear, non-planar).
   */
  getSketchInfo: () => { origin: THREE.Vector3; normal: THREE.Vector3 } | null;

  /**
   * ADR-164 β-2 — Sticky Last Drawn Plane writer.
   *
   * Called by Draw tools (Rect/Circle/Line/Arc/Bezier/Freehand) *after*
   * successful face synthesis to remember the plane for the next draw
   * commit. `getDrawPlane()` priority #3 (β-3 wiring) will use this as
   * fallback when cursor is NOT on a face.
   *
   * Q1=a default per ADR-164 §2 — face 합성 *성공* 후만 호출 (실패 시 skip).
   * Q3=a default — `source` 분리 ('face' | 'view' | 'sketch') for β-3
   * Status display.
   *
   * Optional in interface — test mocks 호환. Real ToolManager 가 항상
   * 제공.
   */
  setLastDrawnPlane?: (plane: {
    origin: THREE.Vector3;
    normal: THREE.Vector3;
    up: THREE.Vector3;
    source?: 'face' | 'view' | 'sketch';
  }) => void;

  /**
   * ADR-166 β-2 — Plane lock activation hook (called by Draw tools on
   * first_click when no lock active). Strong cross-tool plane lock
   * preserved until explicit release (Ctrl+Shift+P / view change /
   * sketch enter/exit / Esc — L-166-2).
   *
   * **Idempotent**: ToolManager.lockPlane is a no-op when already
   * locked. Draw tools may call unconditionally without checking, but
   * `isPlaneLocked()` predicate is provided for explicit guard.
   *
   * Optional in interface — test mocks 호환. Real ToolManager 가 항상
   * 제공.
   */
  lockPlane?: (plane: {
    origin: THREE.Vector3;
    normal: THREE.Vector3;
    up: THREE.Vector3;
    source?: 'first_click' | 'sketch' | 'manual';
  }) => void;

  /**
   * ADR-166 β-2 — Predicate for plane lock state. Draw tools use this
   * to guard `lockPlane()` calls (avoid redundant idempotent no-ops in
   * test environments where lockPlane may not be mocked).
   *
   * Optional in interface — test mocks 호환.
   */
  isPlaneLocked?: () => boolean;

  /**
   * ADR-170 β-2 — normalizeDrawInput SSOT (Phase 1 of Phase 1-4).
   *
   * Single chokepoint for input normalization. Applies 5-step routine:
   *   1. Cardinal axis force      (LOCKED #63 + #7)
   *   2. Face plane projection    (LOCKED #69 ADR-168, PR #248 흡수)
   *   3. Vertex_at silent dedup   (LOCKED #5 1.5μm spatial-hash)
   *   4. 10mm short-circuit       (axia-sketch pattern 1)
   *   5. Plane lock validation    (LOCKED #67 ADR-166 soft lock)
   *
   * Migration recipe for Draw tools (DrawLineTool / RECT / CIRCLE / Polygon /
   * Bezier / Arc / Freehand):
   *
   * ```typescript
   * onMouseDown(e: MouseEvent, ctx: ToolContext) {
   *   const raw = ctx.get3DPoint(e);
   *   if (!raw) return;
   *
   *   const normalized = ctx.normalizeDrawInput?.(raw, {
   *     faceId: hitFaceId,        // optional, from raycast
   *     chainStart: this.firstPt, // optional, for 10mm short-circuit
   *   });
   *
   *   const pt = normalized?.point ?? raw;
   *   if (normalized?.skipReason === 'DegenerateBelowEpsilon') {
   *     Toast.warning('너무 짧은 선 (10mm 미만)');
   *     return;
   *   }
   *
   *   // ... use pt for commit
   * }
   * ```
   *
   * Returns `NormalizedDrawInput` typed envelope:
   *   - `point` — normalized 3D point
   *   - `vertId?` — existing vertex if dedup matched
   *   - `faceId?` — passed-through face context
   *   - `skipReason?` — typed enum if input below absorption threshold
   *
   * Optional in interface — test mocks 호환. Real ToolManager 가 항상
   * 제공.
   */
  normalizeDrawInput?: (
    rawPoint: THREE.Vector3,
    context?: {
      viewMode?: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | '3d';
      faceId?: number;
      targetNormal?: THREE.Vector3;
      chainStart?: THREE.Vector3;
      sketchPlane?: { origin: THREE.Vector3; normal: THREE.Vector3; up?: THREE.Vector3 };
    },
  ) => {
    point: THREE.Vector3;
    vertId?: number;
    faceId?: number;
    skipReason?: 'DegenerateBelowEpsilon' | 'DriftBeyondTolerance' | 'VertexCollapse';
  };
}

/** Drawing plane information for Rect/Circle tools */
export interface DrawPlaneInfo {
  /** Plane normal (unit vector) */
  normal: THREE.Vector3;
  /** Up direction on the plane (unit vector, perpendicular to normal) */
  up: THREE.Vector3;
  /** Right direction on the plane (cross(up, normal), unit vector) */
  right: THREE.Vector3;
  /** Whether this came from an existing face (true) or default plane (false) */
  onFace: boolean;
  /**
   * ADR-140 δ — Surface-aware tangent plane origin (raycast hit point on
   * the curved surface). Set only when `surfaceKind >= 2` AND the
   * `faceSurfaceNormalAtPos` bridge call succeeded. `undefined` for kind ≤ 1
   * (Plane/None) — backward-compatible with all legacy callers.
   *
   * Background: Surface-aware tangent plane is anchored at the hit point P
   * with normal evaluated via `AnalyticSurface::normal_at_world_pos(P)`.
   * Cylinder/Sphere/Cone/Torus/NURBS surface 위 사용자 click 의 정확한
   * tangent plane (chord substitute 회피).
   */
  origin?: THREE.Vector3;
  /**
   * ADR-140 δ — Surface kind from `faceSurfaceKind` (0=None, 1=Plane,
   * 2=Cylinder, 3=Sphere, 4=Cone, 5=Torus, 6=BezierPatch, 7=BSplineSurface,
   * 8=NURBSSurface). `undefined` when not on a face (default ground plane
   * or sketch mode). Caller may use this to dispatch surface-aware tool
   * behavior (e.g., tangent visualization, dimension labels).
   */
  surfaceKind?: number;
}

/**
 * Interface that every tool must implement.
 * The ToolManager will call these methods in response to user input.
 */
export interface ITool {
  /** Tool name (e.g., 'select', 'line', 'rect', 'circle', 'pushpull', 'move', 'rotate', 'scale', 'offset', 'erase') */
  readonly name: string;

  /**
   * Whether this tool wants snap computation on mousemove.
   * Default: `true` (snap runs, point passed to onMouseMove is snap-adjusted).
   * `false` = tool doesn't use snap (e.g. Select, Erase) — skip expensive
   * findSnap traversal and clear SnapVisual markers for a clean UI.
   */
  readonly wantsSnap?: boolean;

  /** Called when tool becomes active (setTool was called) */
  onActivate?(): void;

  /** Called when tool becomes inactive (different tool activated or ToolManager destroyed) */
  onDeactivate?(): void;

  /** Called on mouse down with 3D point (snapped or raw) */
  onMouseDown?(e: MouseEvent, point: THREE.Vector3 | null): void;

  /** Called on mouse move with 3D point for previewing */
  onMouseMove?(e: MouseEvent, point: THREE.Vector3 | null): void;

  /** Called on mouse up */
  onMouseUp?(e: MouseEvent): void;

  /** Called on keyboard key down (for axis lock, esc to cancel, etc.) */
  onKeyDown?(e: KeyboardEvent): void;

  /** Apply VCB input. Optional 2~3 values (rect width/height, scale x/y/z, etc.) */
  applyVCBValue?(value: number, value2?: number, value3?: number): void;

  /** Check if tool is in the middle of an operation (drawing, dragging, etc.) */
  isBusy(): boolean;

  /** Optional cleanup when tool is destroyed */
  cleanup?(): void;

  /**
   * ADR-047 P32 — Vertex positions to EXCLUDE from endpoint snap.
   *
   * Tools with chain-state (DrawLine pending polyline, DrawPolygon, etc.)
   * return their pending vertices (excluding the auto-close start) so the
   * SnapManager doesn't pull the cursor onto a vertex already in the chain
   * — that would make the engine bail at face synthesis with a duplicate-
   * vertex error.
   *
   * Returning `[]` or omitting the method = no exclusion (default).
   */
  getExcludedSnapPoints?(): THREE.Vector3[];
}
