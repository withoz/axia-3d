/**
 * Tool Interface — Every tool in AXiA must implement this interface.
 * Provides a consistent API for the ToolManager to dispatch events.
 */

import * as THREE from 'three';
import { Viewport } from '../viewport/Viewport';
import { WasmBridge } from '../bridge/WasmBridge';
import { SnapManager, SnapPoint } from '../snap/SnapManager';
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
}

/**
 * Interface that every tool must implement.
 * The ToolManager will call these methods in response to user input.
 */
export interface ITool {
  /** Tool name (e.g., 'select', 'line', 'rect', 'circle', 'pushpull', 'move', 'rotate', 'scale', 'offset', 'erase') */
  readonly name: string;

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

  /** Apply VCB (Value Control Box) input — exact number from user or second dimension */
  applyVCBValue?(value: number, value2?: number): void;

  /** Check if tool is in the middle of an operation (drawing, dragging, etc.) */
  isBusy(): boolean;

  /** Optional cleanup when tool is destroyed */
  cleanup?(): void;
}
