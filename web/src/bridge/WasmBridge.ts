/**
 * WASM Bridge — Initializes and wraps the Rust AxiaEngine.
 * Includes performance optimizations with buffer caching.
 */

import * as THREE from 'three';
import init, { AxiaEngine } from '../wasm/axia_wasm';
import { Toast } from '../ui/Toast';
import { debugLog } from '../utils/debug';

// ════════════════════════════════════════════════════════════════════════
// ADR-026 P12 — Cardinal Plane SSOT (Single Source of Truth)
// ════════════════════════════════════════════════════════════════════════
//
// 정책: 모든 draw* API 호출의 좌표는 normal 이 cardinal axis (±X / ±Y / ±Z) 일 때
// 해당 axis 좌표가 정확히 0 으로 강제된다. f32 ray-plane intersection 의
// ε 정밀도 손실 (보통 1e-7 ~ 1e-5) 을 엔진 단계 이전에 차단하여 후속 작업
// (face merge, push/pull, intersection) 의 누적 오차 방지.
//
// SSOT 위치: bridge 계층 — 모든 도구 (DrawRect/Line/Circle/Polyline) 가 이 경로를
// 통과하므로, 도구별 수동 snap 누락 위험 제거.
//
// LOCKED #7 의 적용 범위 확장 (도구 → 모든 호출 경로).

const CARDINAL_THRESHOLD = 0.999;
const CARDINAL_SNAP_TOL = 1e-3;  // 1μm — engine 1.5μm spatial-hash 미만

/** Returns the cardinal axis index (0=x, 1=y, 2=z) if normal is axis-aligned, else -1. */
function cardinalAxis(nx: number, ny: number, nz: number): number {
  if (Math.abs(nx) > CARDINAL_THRESHOLD) return 0;
  if (Math.abs(ny) > CARDINAL_THRESHOLD) return 1;
  if (Math.abs(nz) > CARDINAL_THRESHOLD) return 2;
  return -1;
}

/** Snap rect/circle center's normal-axis coord to 0 (within tol). */
function snapCardinalCenter(
  cx: number, cy: number, cz: number,
  nx: number, ny: number, nz: number,
): [number, number, number] {
  const axis = cardinalAxis(nx, ny, nz);
  if (axis === 0 && Math.abs(cx) < CARDINAL_SNAP_TOL) cx = 0;
  else if (axis === 1 && Math.abs(cy) < CARDINAL_SNAP_TOL) cy = 0;
  else if (axis === 2 && Math.abs(cz) < CARDINAL_SNAP_TOL) cz = 0;
  return [cx, cy, cz];
}

/** Snap line endpoints if both share the same cardinal axis = 0 plane. */
function snapCoplanarCardinal6(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): [number, number, number, number, number, number] {
  // X plane
  if (Math.abs(x0) < CARDINAL_SNAP_TOL && Math.abs(x1) < CARDINAL_SNAP_TOL) {
    x0 = 0; x1 = 0;
  }
  if (Math.abs(y0) < CARDINAL_SNAP_TOL && Math.abs(y1) < CARDINAL_SNAP_TOL) {
    y0 = 0; y1 = 0;
  }
  if (Math.abs(z0) < CARDINAL_SNAP_TOL && Math.abs(z1) < CARDINAL_SNAP_TOL) {
    z0 = 0; z1 = 0;
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Snap polyline points if all share the same cardinal axis = 0 plane. */
function snapPolylineCardinal(arr: Float64Array): void {
  if (arr.length < 6 || arr.length % 3 !== 0) return;
  // Check each axis independently — if all points have |coord| < tol, snap to 0.
  for (let axis = 0; axis < 3; axis++) {
    let allNear = true;
    for (let i = axis; i < arr.length; i += 3) {
      if (Math.abs(arr[i]) >= CARDINAL_SNAP_TOL) { allNear = false; break; }
    }
    if (allNear) {
      for (let i = axis; i < arr.length; i += 3) arr[i] = 0;
    }
  }
}

// ═══ ADR-009 Orphan Recovery types ════════════════════════════════════
export type OrphanCategory =
  | { kind: 'C1Pure' }
  | { kind: 'C2Neighbor'; xias: number }
  | { kind: 'C3Bridge'; xias: number[] };

export interface OrphanComponent {
  id: number;
  faces: number[];
  face_count: number;
  aabb_min: [number, number, number];
  aabb_max: [number, number, number];
  centroid: [number, number, number];
  area_sum: number;
  category: OrphanCategory;
  suggested_name: string;
}

export interface OrphanReport {
  components: OrphanComponent[];
  total_orphans: number;
  c1_count: number;
  c2_count: number;
  c3_count: number;
  face_count_snapshot: number;
}

export interface OrphanRecoveryPlan {
  apply_c1: boolean;
  apply_c2: boolean;
  /** Per-component C3 choices: [component_id, target_xia_or_null] */
  c3_decisions: Array<[number, number | null]>;
}

export interface OrphanRecoveryResult {
  xias_created: number[];
  faces_absorbed: number;
  faces_in_new_xias: number;
  face_count_before: number;
  face_count_after: number;
  all_faces_owned: boolean;
  error: string | null;
}

export interface MeshBuffers {
  positions: Float32Array;
  positionsF64?: Float64Array;  // CAD-grade f64 positions (same layout as positions)
  normals: Float32Array;
  indices: Uint32Array;
  faceMap: Uint32Array; // triangle index → Rust FaceId
}

/**
 * Delta buffers for incremental mesh updates (Phase 1 Optimization).
 * Only contains geometry for faces that changed since last export.
 */
/**
 * Delta buffers for incremental mesh updates.
 *
 * Two modes based on `topologyChanged`:
 * - **true**: Topology was modified (draw/push_pull/delete/boolean/offset).
 *   Other fields are empty. Caller must do a full rebuild via getMeshBuffers().
 * - **false**: Only positions changed (translate/rotate/scale).
 *   `faceVertOffsets[i]` / `faceVertCounts[i]` tell where in the FULL buffer
 *   to patch. `positions` / `normals` contain the new data packed contiguously.
 */
export interface DeltaBuffers {
  topologyChanged: boolean;     // true → full rebuild needed
  modifiedFaceIds: Uint32Array; // Which faces changed (empty if topologyChanged)
  positions: Float32Array;      // New vertex positions for dirty faces (packed)
  normals: Float32Array;        // New vertex normals for dirty faces (packed)
  faceVertOffsets: Uint32Array;  // Vertex offset in full buffer per face
  faceVertCounts: Uint32Array;   // Number of vertices per face
  cacheVersion: number;          // Monotonic counter for validation
}

/**
 * Extended engine type for safe access to optional WASM-provided methods.
 * All IDs are now u32 (number) — no bigint mismatch.
 * Methods marked optional (?) may not exist in older WASM builds.
 */
interface WasmDeltaBuffers {
  isTopologyChanged(): boolean;
  getModifiedFaceIds(): Uint32Array;
  getPositions(): Float32Array;
  getNormals(): Float32Array;
  getFaceVertOffsets(): Uint32Array;
  getFaceVertCounts(): Uint32Array;
  getCacheVersion(): number;
}

type AxiaEngineExtended = AxiaEngine & {
  // Error reporting — last failed op's message (ADR-003)
  lastError?(): string;
  // ADR-038 P23.3 — edge visibility angle SSOT (Rust 의 진실, default 20.1°)
  getEdgeVisibilityAngleDeg?(): number;
  // ADR-038 P23.4 — face 가 analytic surface 를 가지는지 (smoothNormals skip 판단용)
  faceHasAnalyticSurface?(faceIdRaw: number): boolean;
  // Edge/geometry queries
  get_edge_lines?(): Float32Array;
  get_edge_map?(): Uint32Array;
  getSnapVerticesF64?(): Float64Array;
  getPositionsF64?(): Float64Array;
  delete_edge?(edgeId: number): boolean;
  batch_delete?(faceIds: Uint32Array, edgeIds: Uint32Array): boolean;
  batchEraseEdgesWithMerge?(
    faceIds: Uint32Array,
    edgeIds: Uint32Array,
    angleTolDeg: number,
    cascadeOnly: boolean,
  ): Int32Array;
  /** 2026-04-24: non-destructive variant. merge 실패 → edge soften (hidden). */
  batchEraseEdgesSoftFallback?(
    faceIds: Uint32Array,
    edgeIds: Uint32Array,
    angleTolDeg: number,
    cascadeOnly: boolean,
  ): Int32Array;
  previewEdgeEraseMerge?(edgeId: number, angleTolDeg: number): Uint32Array;
  /** ADR-016 §2 — true ⇔ edge is on a face's hole boundary loop. */
  edgeIsHoleBoundary?(edgeId: number): boolean;
  /** ADR-016 §2 (Path B) — Erase + Re-synthesize. Returns JSON. */
  eraseEdgeResynthesize?(edgeId: number, cleanupDangling: boolean): string;
  lastMergeFailureReason?(): string;
  /** ADR-009 Orphan recovery */
  classifyOrphans?(): string;
  applyOrphanRecovery?(planJson: string, dryRun: boolean): string;
  /** Phase D (ADR-008 Axiom 9 row 3): non-coplanar forced merge via SOFT
   *  edges. Hides interior edges between the selected faces so the group
   *  reads as one continuous surface; topology is preserved. Returns the
   *  count of edges softened. */
  softenInternalEdges?(faceIds: Uint32Array): number;
  // Constraint Solver Level 1 (vertex-level ops + edge/vertex queries)
  translateVerts?(vertIds: Uint32Array, dx: number, dy: number, dz: number): boolean;
  rotateVerts?(vertIds: Uint32Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, angleDeg: number): boolean;
  scaleVerts?(vertIds: Uint32Array, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): boolean;
  mirrorFaces?(
    faceIds: Uint32Array,
    ox: number, oy: number, oz: number,
    nx: number, ny: number, nz: number,
  ): Uint32Array;
  revolveProfile?(
    profileFlat: Float64Array,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    segments: number,
  ): Uint32Array;
  loftSections?(
    sectionsFlat: Float64Array,
    sectionSize: number,
    closedSections: boolean,
  ): Uint32Array;
  sweepProfileAlongPath?(
    profileFlat: Float64Array,
    pathFlat: Float64Array,
    closedProfile: boolean,
  ): Uint32Array;
  subdivideCatmullClark?(): number;
  filletEdge?(edgeId: number, radius: number, segments: number): number;
  getFaceVertices?(faceId: number): Uint32Array;
  arrayLinearFaces?(
    faceIds: Uint32Array,
    count: number,
    dx: number, dy: number, dz: number,
  ): Uint32Array;
  arrayRadialFaces?(
    faceIds: Uint32Array,
    count: number,
    ox: number, oy: number, oz: number,
    ax: number, ay: number, az: number,
    totalAngleRad: number,
  ): Uint32Array;
  faceArea?(faceId: number): number;
  edgeLength?(edgeId: number): number;
  meshVolume?(): number;
  bendVerts?(
    vertIds: Uint32Array,
    axX: number, axY: number, axZ: number,
    dirX: number, dirY: number, dirZ: number,
    ox: number, oy: number, oz: number,
    angleDeg: number,
    lengthLimit: number,
  ): boolean;
  twistVerts?(
    vertIds: Uint32Array,
    ox: number, oy: number, oz: number,
    ax: number, ay: number, az: number,
    degreesPerUnit: number,
  ): boolean;
  taperVerts?(
    vertIds: Uint32Array,
    ox: number, oy: number, oz: number,
    ax: number, ay: number, az: number,
    startScale: number,
    endScale: number,
    length: number,
  ): boolean;
  getEdgeEndpoints?(edgeId: number): Uint32Array;
  collectEdgeChain?(edgeId: number): Uint32Array;
  drawCenterline?(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): number;
  edgeClass?(edgeId: number): number;
  setEdgeClass?(edgeId: number, classRaw: number): boolean;
  getCenterlineLines?(): Float32Array;
  getVertexPos?(vertId: number): Float64Array;
  findVertexIdAt?(x: number, y: number, z: number, tol: number): number;
  splitEdge?(edgeId: number, px: number, py: number, pz: number): number;
  // Constraint Solver Level 2 (persistent graph)
  addEdgeConstraint?(kind: string, eaVa: number, eaVb: number, ebVa: number, ebVb: number): number;
  addDistanceConstraint?(vA: number, vB: number, distance: number): number;
  removeConstraint?(id: number): boolean;
  listConstraints?(): string;
  resolveAllConstraints?(): number;
  setConstraintActive?(id: number, active: boolean): boolean;
  constraintCount?(): number;
  // Level 3 iterative solver
  resolveConstraintsIterative?(maxIter: number, tolerance: number): string;
  maxConstraintResidual?(): number;
  // XIA face list (B3)
  getXiaFaceIds?(xiaId: number): Uint32Array;

  // Phase H — Import Normalizer (ADR-007 Barrier)
  normalizeForImport?(optionsJson: string): string;
  verifyInvariants?(): string;
  findNonManifoldEdges?(): string;
  repairNonManifoldEdges?(): string;
  verifyOutwardNormals?(): string;
  exportSnapshotStrict?(): Uint8Array;
  synthesizeFacesFromFreeEdges?(): number;
  countFreeEdges?(): number;
  meshManifoldInfo?(): string;
  computeGroundProjectedShadows?(sx: number, sy: number, sz: number): Float32Array;
  edgeAngleThreshold?(): number;
  setEdgeAngleThreshold?(deg: number): void;

  // Face merge (coplanar face combine)
  mergeFacesByEdge?(edgeId: number): number;
  mergeFacesByEdgeTol?(edgeId: number, angleTolDeg: number): number;
  /** Phase F — C1 비인접 포함 병합 (outer가 inner를 hole로 흡수) */
  mergeCoplanarContaining?(outerFaceId: number, innerFaceId: number, angleTolDeg: number): number;
  /** 2026-04-24 — 크기 다른 coplanar 면들의 geometric merge */
  mergeCoplanarFacesGeometric?(f1: number, f2: number, angleTolDeg: number): number;
  tryMergeAdjacentFaces?(faceIds: Uint32Array): number;
  tryMergeAdjacentFacesTol?(faceIds: Uint32Array, angleTolDeg: number): number;
  /** Dry-run — returns JSON {total, mergeable, nonCoplanar, ambiguous, estMergesAfterCascade} */
  analyzeMergeCandidates?(faceIds: Uint32Array): string;
  analyzeMergeCandidatesTol?(faceIds: Uint32Array, angleTolDeg: number): string;
  get_connected_faces?(seedFaceId: number): Uint32Array;
  // Snapshot / Import
  export_snapshot?(): Uint8Array;
  import_snapshot?(data: Uint8Array): boolean;
  import_dxf?(data: Uint8Array): string;
  // Transform operations
  translate_faces?(ids: Uint32Array, dx: number, dy: number, dz: number): boolean;
  rotate_faces?(ids: Uint32Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, angleDeg: number): boolean;
  scale_faces?(ids: Uint32Array, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): boolean;
  faces_centroid?(ids: Uint32Array): Float32Array | Float64Array;
  // Offset
  offset_face?(faceId: number, dist: number): string;
  offset_edge?(edgeId: number, dist: number, nx: number, ny: number, nz: number): string;
  // XIA
  get_xia_info?(ids: Uint32Array): string;
  get_xia_face?(xia_id: number): number;
  get_xia_for_face?(face_id_raw: number): number;
  is_face_locked?(face_id_raw: number): boolean;
  // Boolean
  boolean_op?(a: Uint32Array, b: Uint32Array, op: string): string;
  sheetBoolean?(a: number, b: number, op: string): string;
  drawPolyline?(points: Float64Array): number;
  getPositionsPtr?(): number;
  getPositionsLen?(): number;
  getNormalsPtr?(): number;
  getNormalsLen?(): number;
  getIndicesPtr?(): number;
  getIndicesLen?(): number;
  getFaceMapPtr?(): number;
  getFaceMapLen?(): number;
  /** WASM linear memory — wasm-bindgen exposes this as `memory`. */
  memory?: WebAssembly.Memory;
  sliceVolumeByPlane?(faceIds: Uint32Array,
    ox: number, oy: number, oz: number,
    nx: number, ny: number, nz: number): string;
  getXiaFaceIds?(xiaId: number): Uint32Array;
  intersectWithModel?(faceIds: Uint32Array): string;
  isFaceInVolume?(faceIdRaw: number): boolean;
  getFaceVolumeFlags?(): Uint8Array;
  setAutoIntersectOnDraw?(enabled: boolean): void;
  getAutoIntersectOnDraw?(): boolean;
  // Group / Component
  create_group?(name: string, faceIds: Uint32Array): number;
  delete_group?(groupId: number): boolean;
  rename_group?(groupId: number, newName: string): boolean;
  toggle_group_visibility?(groupId: number): boolean;
  toggle_group_lock?(groupId: number): boolean;
  get_group_for_face?(faceIdRaw: number): number;
  get_group_faces?(groupId: number): Uint32Array;
  add_faces_to_group?(groupId: number, faceIds: Uint32Array): boolean;
  remove_faces_from_group?(groupId: number, faceIds: Uint32Array): boolean;
  set_group_parent?(childId: number, parentId: number): boolean;
  make_component?(groupId: number, name: string): number;
  get_group_info?(groupId: number): string;
  get_all_groups?(): string;
  group_count?(): number;
  // ADR-028 Phase A — Analytic Edge Curve API
  tessellateEdge?(edgeId: number, chordTol: number): Float64Array;
  setEdgeArcCurve?(
    edgeId: number,
    cx: number, cy: number, cz: number,
    radius: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    startAngle: number, endAngle: number,
  ): boolean;
  setEdgeCircleCurve?(
    edgeId: number,
    cx: number, cy: number, cz: number,
    radius: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
  ): boolean;
  clearEdgeCurve?(edgeId: number): boolean;
  edgeCurveKind?(edgeId: number): number;
  // ADR-029 Phase B — Free-form curves
  setEdgeBezierCurve?(edgeId: number, controlPts: Float64Array): boolean;
  setEdgeBSplineCurve?(
    edgeId: number,
    controlPts: Float64Array,
    knots: Float64Array,
    degree: number,
  ): boolean;
  // ADR-030 Phase C — NURBS + CCI
  setEdgeNurbsCurve?(
    edgeId: number,
    controlPts: Float64Array,
    weights: Float64Array,
    knots: Float64Array,
    degree: number,
  ): boolean;
  intersectEdges?(edgeIdA: number, edgeIdB: number, tol: number): Float64Array;
  // ADR-032 P17 — Promote on creation
  drawArcWithCurve?(...args: number[]): number;
  drawBezierWithCurve?(controlPts: Float64Array, segments: number): number;
  drawBSplineWithCurve?(controlPts: Float64Array, knots: Float64Array, degree: number): number;
  // ADR-031 Phase D — Analytic surfaces
  setFaceSurfacePlane?(...args: number[]): boolean;
  setFaceSurfaceCylinder?(...args: number[]): boolean;
  setFaceSurfaceSphere?(...args: number[]): boolean;
  setFaceSurfaceCone?(...args: number[]): boolean;
  setFaceSurfaceTorus?(...args: number[]): boolean;
  clearFaceSurface?(faceId: number): boolean;
  faceSurfaceKind?(faceId: number): number;
  tessellateFaceSurface?(faceId: number, chordTol: number): Float64Array;
  // Material operations
  assign_material?(faceIds: Uint32Array, materialIdRaw: number): boolean;
  remove_material?(faceIds: Uint32Array): boolean;
  get_face_material?(faceIdRaw: number): number;
  get_all_materials?(): string;
  // Face Split — draw line on face to subdivide
  splitFaceByLine?(faceId: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): string;
  pointInFace?(faceId: number, x: number, y: number, z: number): boolean;
  // Smooth Group Push-Pull
  push_pull_smooth_group_seamless?(faceIds: Uint32Array, distance: number): boolean;
  // Primitive shapes
  create_cylinder?(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number;
  create_cone?(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number;
  create_sphere?(cx: number, cy: number, cz: number, radius: number, u_segments: number, v_segments: number): number;
  create_box?(cx: number, cy: number, cz: number, width: number, height: number, depth: number): number;
  // Delta Buffer Export
  getDirtyFaceBuffers?(): WasmDeltaBuffers | undefined;
  getCacheVersion?(): number;
  get_dirty_face_count?(): number;
};

export class WasmBridge {
  /**
   * Edge visibility angle threshold (도) — Rust SSOT mirror (ADR-038 P23.3).
   *
   * Rust `axia_geo::tolerances::EDGE_VISIBILITY_ANGLE_DEG` 와 동일 값.
   * Bridge instance 가 없는 위치 (예: Viewport.ts 의 정적 mesh build 단계)
   * 에서 사용. 두 값이 어긋나면 hard/soft edge 판정이 두 layer 에서 어긋나
   * 회귀 테스트 (P23.7 #4) 가 깨짐.
   */
  public static readonly EDGE_VISIBILITY_ANGLE_DEG = 20.1;

  public engine: AxiaEngineExtended | null = null;

  /**
   * Sticky error from a thrown JS-side exception inside a bridge wrapper.
   * `engine.lastError()` only tracks Rust-side failures; thrown exceptions
   * (panic, type errors, binding mismatches) used to be swallowed by the
   * `try { ... } catch { console.error(...) }` blocks with the user seeing
   * nothing. We stash the message here so `lastError()` can report it too.
   */
  private _bridgeSideError: string = '';

  /** Cached mesh buffer management to avoid redundant WASM→JS copies */
  private bufferCache: {
    positions: Float32Array | null;
    positionsF64: Float64Array | null;
    normals: Float32Array | null;
    indices: Uint32Array | null;
    faceMap: Uint32Array | null;
    edgeLines: Float32Array | null;
    edgeMap: Uint32Array | null;
    dirty: boolean;
  } = { positions: null, positionsF64: null, normals: null, indices: null, faceMap: null, edgeLines: null, edgeMap: null, dirty: true };

  /** WASM linear memory — captured on init().
   *  Used by zero-copy buffer access (ADR-013 §4). null if WASM init failed. */
  private wasmMemory: WebAssembly.Memory | null = null;

  async init(): Promise<void> {
    try {
      const wasmExports = await init();
      this.wasmMemory = wasmExports.memory;
      this.engine = new AxiaEngine() as unknown as AxiaEngineExtended;
      debugLog('[WasmBridge] ✓ Engine initialized.');
    } catch (e) {
      console.warn('[WasmBridge] ⚠ WASM initialization failed (will use basic mode):', e);
      // Allow app to continue without WASM - Three.js rendering still works
      // WASM is optional for Sphere tool which uses simple THREE.IcosahedronGeometry
      debugLog('[WasmBridge] Continuing with basic Three.js mode...');
    }
  }

  isReady(): boolean {
    return this.engine !== null;
  }

  /** Mark buffers as dirty (call after any topology-changing operation).
   *  Also bumps the WASM-crossing counter for ADR-012 telemetry —
   *  every mutating call into Rust passes through here. */
  markDirty(): void {
    this.bufferCache.dirty = true;
    // Lazy import to avoid circular dep at module load.
    // Cost is one map lookup when telemetry module already loaded.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = (window as unknown as { __AXIA_TELEMETRY_TICK?: () => void });
      t.__AXIA_TELEMETRY_TICK?.();
    } catch { /* ignore — telemetry not installed */ }
  }

  drawLine(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    nx = 0, ny = 0, nz = 0,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    // ADR-026 P12 — Cardinal Plane SSOT: 두 endpoint 가 동일 cardinal plane 위면
    // 정확한 axis-0 좌표로 강제. (양쪽 endpoint 가 같은 normal-axis 값을 가질 때만.)
    [x0, y0, z0, x1, y1, z1] = snapCoplanarCardinal6(x0, y0, z0, x1, y1, z1);
    return this.engine.draw_line(x0, y0, z0, x1, y1, z1, nx, ny, nz);
  }

  /** ADR-012 §3 BatchCommand — N개 연속 line 을 단일 WASM crossing 에
   *  묶는다. `points` 는 [x0,y0,z0, x1,y1,z1, …] 평탄화 배열.
   *  Arc / Bezier / Freehand 등 tessellated curve 에서 사용.
   *  단일 transaction 이라 Ctrl+Z 한 번으로 전체 polyline undo. */
  drawPolyline(points: Float64Array | number[]): number {
    if (!this.engine) return -1;
    this.markDirty();
    const arr = points instanceof Float64Array ? points : new Float64Array(points);
    // ADR-026 P12 — 모든 point 가 같은 cardinal plane 위면 정확히 axis-0 강제.
    snapPolylineCardinal(arr);
    const fn = (this.engine as unknown as {
      drawPolyline?: (points: Float64Array) => number;
    }).drawPolyline;
    if (!fn) return -1;
    return fn.call(this.engine, arr);
  }

  drawRect(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    width: number, height: number,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    // ADR-026 P12 — Cardinal Plane SSOT: normal 이 cardinal axis 면 center 의
    // 해당 axis 좌표를 정확히 0 으로 강제 (ε 정밀도 손실 차단).
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    return this.engine.draw_rect(cx, cy, cz, nx, ny, nz, ux, uy, uz, width, height);
  }

  drawCircle(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    return this.engine.draw_circle(cx, cy, cz, nx, ny, nz, radius, segments);
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADR-028 Phase A — Analytic Edge Curve API
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Tessellate an edge into a polyline with chord-error ≤ `chordTol` (mm).
   * For straight edges → 2 endpoints. For curved edges → adaptive sampling.
   * Returns Float64Array of shape `[x0,y0,z0, x1,y1,z1, ...]`.
   */
  tessellateEdge(edgeId: number, chordTol: number): Float64Array {
    if (!this.engine) return new Float64Array(0);
    const flat = this.engine.tessellateEdge(edgeId, chordTol);
    return flat instanceof Float64Array ? flat : new Float64Array(flat as number[]);
  }

  /**
   * Set an Arc curve on an existing edge. Returns true if successful.
   * Bridge-level cardinal snap (ADR-026) applies to (cx, cy, cz).
   */
  setEdgeArcCurve(
    edgeId: number,
    cx: number, cy: number, cz: number,
    radius: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    startAngle: number, endAngle: number,
  ): boolean {
    if (!this.engine) return false;
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    this.markDirty();
    return this.engine.setEdgeArcCurve(
      edgeId, cx, cy, cz, radius,
      nx, ny, nz, ux, uy, uz,
      startAngle, endAngle,
    );
  }

  /** Set a full Circle curve on an existing edge. */
  setEdgeCircleCurve(
    edgeId: number,
    cx: number, cy: number, cz: number,
    radius: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
  ): boolean {
    if (!this.engine) return false;
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    this.markDirty();
    return this.engine.setEdgeCircleCurve(
      edgeId, cx, cy, cz, radius, nx, ny, nz, ux, uy, uz,
    );
  }

  /** Clear any curve from an edge (revert to straight line). */
  clearEdgeCurve(edgeId: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    return this.engine.clearEdgeCurve(edgeId);
  }

  /**
   * Curve kind on an edge: 0 = straight, 1 = Line variant, 2 = Circle,
   * 3 = Arc, 4 = Bezier (Phase B), 5 = BSpline (Phase B), -1 invalid.
   */
  edgeCurveKind(edgeId: number): number {
    if (!this.engine) return -1;
    return this.engine.edgeCurveKind(edgeId);
  }

  /**
   * ADR-032 P17 — Atomic arc drawing with analytic curve promotion.
   * Draws N tessellated segments + attaches AnalyticCurve::Arc to each.
   * Returns 0 on success, -1 on error.
   */
  drawArcWithCurve(
    cx: number, cy: number, cz: number,
    radius: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    startAngle: number, endAngle: number,
    segments: number,
  ): number {
    if (!this.engine) return -1;
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    this.markDirty();
    const fn = (this.engine as unknown as {
      drawArcWithCurve?: (...args: number[]) => number;
    }).drawArcWithCurve;
    return fn ? fn.call(this.engine,
      cx, cy, cz, radius, nx, ny, nz, ux, uy, uz,
      startAngle, endAngle, segments,
    ) : -1;
  }

  /**
   * ADR-032 P17 — Atomic Bezier drawing with curve promotion.
   * `controlPts` flat: 3·(n+1) floats. `segments` is a hint; engine uses
   * adaptive tessellation. Returns 0 on success, -1 on error.
   */
  drawBezierWithCurve(
    controlPts: Float64Array | number[],
    segments: number,
  ): number {
    if (!this.engine) return -1;
    const ptsArr = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    this.markDirty();
    const fn = (this.engine as unknown as {
      drawBezierWithCurve?: (pts: Float64Array, segs: number) => number;
    }).drawBezierWithCurve;
    return fn ? fn.call(this.engine, ptsArr, segments) : -1;
  }

  /**
   * ADR-032 P17 — Atomic B-spline drawing with curve promotion.
   * `knots` length must equal `(controlPts.length / 3) + degree + 1`.
   */
  drawBSplineWithCurve(
    controlPts: Float64Array | number[],
    knots: Float64Array | number[],
    degree: number,
  ): number {
    if (!this.engine) return -1;
    const ptsArr = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    const knotsArr = knots instanceof Float64Array
      ? knots : new Float64Array(knots);
    this.markDirty();
    const fn = (this.engine as unknown as {
      drawBSplineWithCurve?: (pts: Float64Array, knots: Float64Array, deg: number) => number;
    }).drawBSplineWithCurve;
    return fn ? fn.call(this.engine, ptsArr, knotsArr, degree) : -1;
  }

  /**
   * ADR-029 Phase B — Set a Bezier curve on an existing edge.
   * `controlPts` is a flat array `[x0,y0,z0, x1,y1,z1, ...]` of n+1 points
   * (need ≥ 2 for degree-1 line-equivalent).
   */
  setEdgeBezierCurve(edgeId: number, controlPts: Float64Array | number[]): boolean {
    if (!this.engine) return false;
    const arr = controlPts instanceof Float64Array
      ? controlPts
      : new Float64Array(controlPts);
    this.markDirty();
    const fn = (this.engine as unknown as {
      setEdgeBezierCurve?: (eid: number, pts: Float64Array) => boolean;
    }).setEdgeBezierCurve;
    return fn ? fn.call(this.engine, edgeId, arr) : false;
  }

  /**
   * ADR-029 Phase B — Set a B-spline curve on an existing edge.
   * `controlPts` flat as for Bezier; `knots` length must equal
   * `(controlPts.length / 3) + degree + 1` and be non-decreasing.
   */
  setEdgeBSplineCurve(
    edgeId: number,
    controlPts: Float64Array | number[],
    knots: Float64Array | number[],
    degree: number,
  ): boolean {
    if (!this.engine) return false;
    const ptsArr = controlPts instanceof Float64Array
      ? controlPts
      : new Float64Array(controlPts);
    const knotsArr = knots instanceof Float64Array
      ? knots
      : new Float64Array(knots);
    this.markDirty();
    const fn = (this.engine as unknown as {
      setEdgeBSplineCurve?:
        (eid: number, pts: Float64Array, knots: Float64Array, degree: number) => boolean;
    }).setEdgeBSplineCurve;
    return fn ? fn.call(this.engine, edgeId, ptsArr, knotsArr, degree) : false;
  }

  /**
   * ADR-030 Phase C — Set a NURBS curve on an existing edge.
   * Rational B-spline: `weights` (one per control point, all > 0) makes
   * conics (circle/ellipse) representable exactly.
   */
  setEdgeNurbsCurve(
    edgeId: number,
    controlPts: Float64Array | number[],
    weights: Float64Array | number[],
    knots: Float64Array | number[],
    degree: number,
  ): boolean {
    if (!this.engine) return false;
    const ptsArr = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    const wArr = weights instanceof Float64Array
      ? weights : new Float64Array(weights);
    const knotsArr = knots instanceof Float64Array
      ? knots : new Float64Array(knots);
    this.markDirty();
    const fn = (this.engine as unknown as {
      setEdgeNurbsCurve?: (
        eid: number, pts: Float64Array, w: Float64Array,
        k: Float64Array, d: number,
      ) => boolean;
    }).setEdgeNurbsCurve;
    return fn ? fn.call(this.engine, edgeId, ptsArr, wArr, knotsArr, degree) : false;
  }

  /**
   * ADR-030 Phase C — Compute curve-curve intersections between two edges.
   * Returns `Float64Array` of shape 6·N: `[x, y, z, t1, t2, angle, ...]`.
   * Edges without an analytic curve are treated as straight line segments.
   */
  intersectEdges(edgeIdA: number, edgeIdB: number, tol = 1e-6): Float64Array {
    if (!this.engine) return new Float64Array(0);
    const fn = (this.engine as unknown as {
      intersectEdges?: (a: number, b: number, t: number) => Float64Array;
    }).intersectEdges;
    if (!fn) return new Float64Array(0);
    const result = fn.call(this.engine, edgeIdA, edgeIdB, tol);
    return result instanceof Float64Array ? result : new Float64Array(result as number[]);
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADR-031 Phase D — Analytic Surface API
  // ════════════════════════════════════════════════════════════════════════

  /** Set a Cylinder surface on a face. */
  setFaceSurfaceCylinder(
    faceId: number,
    axisOriginX: number, axisOriginY: number, axisOriginZ: number,
    axisDirX: number, axisDirY: number, axisDirZ: number,
    radius: number,
    refDirX: number, refDirY: number, refDirZ: number,
    uMin: number, uMax: number, vMin: number, vMax: number,
  ): boolean {
    if (!this.engine) return false;
    this.markDirty();
    const fn = (this.engine as unknown as {
      setFaceSurfaceCylinder?: (...args: number[]) => boolean;
    }).setFaceSurfaceCylinder;
    return fn ? fn.call(this.engine,
      faceId, axisOriginX, axisOriginY, axisOriginZ,
      axisDirX, axisDirY, axisDirZ, radius,
      refDirX, refDirY, refDirZ, uMin, uMax, vMin, vMax,
    ) : false;
  }

  /** Set a Sphere surface on a face. */
  setFaceSurfaceSphere(
    faceId: number,
    cx: number, cy: number, cz: number, radius: number,
    uMin: number, uMax: number, vMin: number, vMax: number,
  ): boolean {
    if (!this.engine) return false;
    this.markDirty();
    const fn = (this.engine as unknown as {
      setFaceSurfaceSphere?: (...args: number[]) => boolean;
    }).setFaceSurfaceSphere;
    return fn ? fn.call(this.engine, faceId, cx, cy, cz, radius, uMin, uMax, vMin, vMax) : false;
  }

  /** Clear any surface from a face (revert to polygon). */
  clearFaceSurface(faceId: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    const fn = (this.engine as unknown as {
      clearFaceSurface?: (id: number) => boolean;
    }).clearFaceSurface;
    return fn ? fn.call(this.engine, faceId) : false;
  }

  /**
   * Surface kind: 0 = none, 1 = Plane, 2 = Cylinder, 3 = Sphere,
   * 4 = Cone, 5 = Torus, -1 = invalid.
   */
  faceSurfaceKind(faceId: number): number {
    if (!this.engine) return -1;
    const fn = (this.engine as unknown as {
      faceSurfaceKind?: (id: number) => number;
    }).faceSurfaceKind;
    return fn ? fn.call(this.engine, faceId) : -1;
  }

  /**
   * Tessellate a face's analytic surface. Returns `Float64Array` with header
   * `[v_count, t_count, vx0, vy0, vz0, ..., t0a, t0b, t0c, ...]`. Empty
   * array if no surface.
   */
  tessellateFaceSurface(faceId: number, chordTol: number): Float64Array {
    if (!this.engine) return new Float64Array(0);
    const fn = (this.engine as unknown as {
      tessellateFaceSurface?: (id: number, tol: number) => Float64Array;
    }).tessellateFaceSurface;
    if (!fn) return new Float64Array(0);
    const result = fn.call(this.engine, faceId, chordTol);
    return result instanceof Float64Array ? result : new Float64Array(result as number[]);
  }

  /** Get the first face ID owned by a XIA entity (drawRect returns XIA ID, pushPull needs face ID) */
  getXiaFace(xiaId: number): number {
    if (!this.engine) return -1;
    if (this.engine.get_xia_face) {
      const raw = this.engine.get_xia_face(xiaId);
      return raw === 0xFFFFFFFF ? -1 : raw;  // u32::MAX → -1
    }
    // Fallback: assume xia_id == face_id (legacy behavior)
    return xiaId;
  }

  /** Split a face by drawing a line across it.
   *  Both endpoints should be on the face's boundary.
   *  Returns the JSON result string, or empty string on failure.
   */
  splitFaceByLine(faceId: number, start: [number, number, number], end: [number, number, number]): string {
    if (!this.engine?.splitFaceByLine) return '';
    this.markDirty();
    return this.engine.splitFaceByLine(faceId, start[0], start[1], start[2], end[0], end[1], end[2]);
  }

  /** Test if a 3D point is inside a face's boundary (on its plane). */
  pointInFace(faceId: number, point: [number, number, number]): boolean {
    if (!this.engine?.pointInFace) return false;
    return this.engine.pointInFace(faceId, point[0], point[1], point[2]);
  }

  /** Push/Pull: dist > 0 = extrude outward, dist < 0 = recess inward */
  pushPull(faceId: number, dist: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    return this.engine.push_pull(faceId, dist);
  }

  /**
   * WASM 엔진의 마지막 실패 메시지 반환. 성공 이력만 있으면 빈 문자열.
   * 연산이 false를 반환했을 때 이 값으로 Toast/UI 피드백 표시 (ADR-003).
   */
  lastError(): string {
    // Engine-side error (Rust bail → console_error → set_error) takes
    // precedence; bridge-side sticky message only surfaces when the
    // engine has nothing to say (e.g. the engine never got called
    // because the JS wrapper threw first).
    if (this.engine) {
      try {
        const msg = this.engine.lastError?.() ?? '';
        if (msg && msg.trim().length > 0) return msg;
      } catch {
        /* fall through to bridge-side */
      }
    }
    return this._bridgeSideError;
  }

  /**
   * Record a JS-side exception inside a bridge wrapper. Called from the
   * `catch (e) { … }` blocks in the individual WASM-call wrappers so that
   * the next `lastError()` / `Toast.fromBridgeError()` can surface it.
   */
  private recordBridgeError(op: string, e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this._bridgeSideError = `${op}: ${msg}`;
    console.error(`[WasmBridge] ${op} failed:`, e);
  }

  /**
   * Clear any sticky bridge-side error. Call at the start of a wrapper
   * that's about to make a fresh engine call so the error only reflects
   * the MOST RECENT operation.
   */
  private clearBridgeError(): void {
    this._bridgeSideError = '';
  }

  undo(): boolean {
    if (!this.engine) return false;
    this.markDirty();
    return this.engine.undo();
  }

  redo(): boolean {
    if (!this.engine) return false;
    this.markDirty();
    return this.engine.redo();
  }

  getMeshBuffers(): MeshBuffers | null {
    if (!this.engine) return null;
    if (!this.bufferCache.dirty && this.bufferCache.positions) {
      return {
        positions: this.bufferCache.positions,
        positionsF64: this.bufferCache.positionsF64 ?? undefined,
        normals: this.bufferCache.normals!,
        indices: this.bufferCache.indices!,
        faceMap: this.bufferCache.faceMap!,
      };
    }
    const positions = this.engine.get_positions();
    const normals = this.engine.get_normals();
    const indices = this.engine.get_indices();
    const faceMap = this.engine.get_face_map();
    if (positions.length === 0) return null;
    // Fetch f64 positions for CAD-grade precision
    const positionsF64 = this.engine.getPositionsF64?.();
    // ADR-013 §4 — Vec<f32>.clone() then wasm-bindgen→Float32Array copy.
    // Record bytes copied across the boundary for telemetry.
    const w = window as unknown as { __AXIA_TELEMETRY_COPY?: (bytes: number) => void };
    const totalBytes =
      (positions?.byteLength ?? 0) +
      (normals?.byteLength ?? 0) +
      (indices?.byteLength ?? 0) +
      (faceMap?.byteLength ?? 0) +
      (positionsF64?.byteLength ?? 0);
    w.__AXIA_TELEMETRY_COPY?.(totalBytes);
    this.bufferCache = { positions, positionsF64: positionsF64 ?? null, normals, indices, faceMap, edgeLines: null, edgeMap: null, dirty: false };
    return { positions, normals, indices, faceMap, positionsF64 };
  }

  /** ADR-013 §4 zero-copy mesh buffers.
   *
   *  Returns Float32Array / Uint32Array views directly onto the WASM
   *  linear memory — no JS-side copy. Each call re-fetches ptr+len so
   *  WASM heap growth is handled transparently.
   *
   *  CAVEAT: views are ONLY valid until the next mutating WASM call
   *  (anything that may resize the memory). Caller must consume the
   *  data immediately and not retain references across mutations.
   *  Returns null if the engine isn't loaded or buffers are empty.
   *
   *  Used by the new fast path in syncMesh; the legacy
   *  `getMeshBuffers()` (which copies) is kept for callers that need
   *  to retain the data.
   */
  getMeshBuffersZeroCopy(): {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    faceMap: Uint32Array;
  } | null {
    const eng = this.engine;
    if (!eng?.getPositionsPtr || !eng.getPositionsLen) return null;
    if (!this.wasmMemory) return null;
    const posLen = eng.getPositionsLen();
    if (posLen === 0) return null;
    // Re-fetch each ptr after each rebuild_cache (in WASM impl) — heap
    // growth invalidates earlier ptrs.
    const buffer = this.wasmMemory.buffer;
    const positions = new Float32Array(buffer, eng.getPositionsPtr(), posLen);
    const normals   = new Float32Array(buffer, eng.getNormalsPtr!(),   eng.getNormalsLen!());
    const indices   = new Uint32Array (buffer, eng.getIndicesPtr!(),   eng.getIndicesLen!());
    const faceMap   = new Uint32Array (buffer, eng.getFaceMapPtr!(),   eng.getFaceMapLen!());
    // Telemetry — view creation, no copy. No bytes counted (intentional).
    return { positions, normals, indices, faceMap };
  }

  /** Get CAD-grade f64 vertex positions (Float64Array).
   *  Same layout as positions (flat [x,y,z,...]) but without f32 truncation.
   *  Returns null if engine not available.
   */
  getPositionsF64(): Float64Array | null {
    if (!this.engine) return null;
    try {
      return this.engine.getPositionsF64?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Get delta buffers from WASM (Phase 1 Optimization).
   *  Returns null if nothing changed.
   *  If topologyChanged=true, caller must do full rebuild.
   *  If topologyChanged=false, caller can patch in-place using offsets.
   */
  getDeltaBuffers(): DeltaBuffers | null {
    if (!this.engine) return null;

    try {
      const delta = this.engine.getDirtyFaceBuffers?.();
      if (!delta) return null;  // No changes

      return {
        topologyChanged: delta.isTopologyChanged(),
        modifiedFaceIds: delta.getModifiedFaceIds(),
        positions: delta.getPositions(),
        normals: delta.getNormals(),
        faceVertOffsets: delta.getFaceVertOffsets(),
        faceVertCounts: delta.getFaceVertCounts(),
        cacheVersion: delta.getCacheVersion(),
      };
    } catch (e) {
      console.warn('[WasmBridge] getDeltaBuffers failed:', e);
      return null;
    }
  }

  /** Apply a position-only delta to existing Three.js geometry.
   *  Patches vertex positions and normals in-place using face offset info.
   *  Only valid when delta.topologyChanged === false.
   *
   *  @returns true if patch succeeded, false if full rebuild needed
   */
  static applyDeltaToGeometry(
    geometry: THREE.BufferGeometry,
    delta: DeltaBuffers
  ): boolean {
    if (delta.topologyChanged) return false;

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;

    if (!posAttr || !normAttr) {
      return false;
    }

    const posArray = posAttr.array as Float32Array;
    const normArray = normAttr.array as Float32Array;

    // Each face's data is packed contiguously in delta.positions/normals.
    // faceVertOffsets[i] = where this face starts in the FULL buffer (vertex index)
    // faceVertCounts[i] = how many vertices this face has
    let srcOffset = 0; // float offset into delta.positions/normals

    for (let i = 0; i < delta.modifiedFaceIds.length; i++) {
      const vertStart = delta.faceVertOffsets[i]; // vertex index in full buffer
      const vertCount = delta.faceVertCounts[i];  // number of vertices
      const floatCount = vertCount * 3;           // number of floats
      const dstOffset = vertStart * 3;            // float offset in full buffer

      // Bounds check
      if (dstOffset + floatCount > posArray.length) {
        return false; // Buffer size mismatch — need full rebuild
      }
      if (srcOffset + floatCount > delta.positions.length) {
        return false; // Delta data truncated
      }

      // Patch positions
      posArray.set(
        delta.positions.subarray(srcOffset, srcOffset + floatCount),
        dstOffset,
      );

      // Patch normals
      normArray.set(
        delta.normals.subarray(srcOffset, srcOffset + floatCount),
        dstOffset,
      );

      srcOffset += floatCount;
    }

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    return true;
  }

  /** Get hard edge line segments from DCEL topology.
   *  Coplanar edges (angle ≤ 15°) are automatically hidden.
   *  Returns flat [x0,y0,z0, x1,y1,z1, ...] for THREE.LineSegments.
   *  Returns null if WASM doesn't have this method yet (graceful fallback). */
  getEdgeLines(): Float32Array | null {
    if (!this.engine) return null;
    if (!this.bufferCache.dirty && this.bufferCache.edgeLines) {
      return this.bufferCache.edgeLines;
    }
    try {
      const lines = this.engine.get_edge_lines?.();
      if (lines && lines.length > 0) {
        this.bufferCache.edgeLines = lines;
        return lines;
      }
      return null;
    } catch {
      return null; // WASM not rebuilt yet — fallback to EdgesGeometry
    }
  }

  /** Get unique vertex positions in f64 precision for snap system.
   *  Returns flat [x0,y0,z0, x1,y1,z1, ...] as Float64Array.
   *  These are the exact coordinates stored in the DCEL — no f32 truncation. */
  getSnapVerticesF64(): Float64Array | null {
    if (!this.engine) return null;
    try {
      return this.engine.getSnapVerticesF64?.() ?? null;
    } catch {
      return null;
    }
  }

  getFaceNormal(faceId: number): [number, number, number] {
    if (!this.engine) return [0, 0, 0];
    const arr = this.engine.get_face_normal(faceId);
    return [arr[0], arr[1], arr[2]];
  }

  /**
   * Face 가 analytic surface (Plane/Cylinder/Sphere/Cone/Torus/NURBS) 를
   * 가지고 있는지 (ADR-038 P23.4).
   *
   * `true` 인 face 의 vertex normal 은 Three.js smoothNormals 가 덮어쓰지
   * 않아야 함 (Rust 의 analytic evaluate 결과 유지).
   *
   * WASM 미연결 / face 무효 시 `false` 반환.
   */
  faceHasAnalyticSurface(faceId: number): boolean {
    if (!this.engine?.faceHasAnalyticSurface) return false;
    try {
      return this.engine.faceHasAnalyticSurface(faceId);
    } catch {
      return false;
    }
  }

  /**
   * Edge visibility angle threshold (도) — Rust SSOT 반영 (ADR-038 P23.3).
   *
   * Three.js Viewport.smoothNormals 와 Mesh::compute_smooth_normal_at 의
   * hard/soft edge 판정이 두 layer 에서 일치하도록 본 값 사용.
   *
   * @returns Rust EDGE_VISIBILITY_ANGLE_DEG 값 (현재 20.1°). WASM 미연결 시
   *          fallback 20.1° 반환 (drift 차단 — never 30).
   */
  getEdgeVisibilityAngleDeg(): number {
    if (this.engine?.getEdgeVisibilityAngleDeg) {
      try {
        return this.engine.getEdgeVisibilityAngleDeg();
      } catch {
        // fall through to fallback
      }
    }
    // Fallback to Rust default (mirror constant — must match tolerances.rs:106)
    return WasmBridge.EDGE_VISIBILITY_ANGLE_DEG;
  }

  deleteFace(faceId: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    return this.engine.delete_face(faceId);
  }

  deleteEdge(edgeId: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    try {
      return this.engine.delete_edge?.(edgeId) ?? false;
    } catch (e) {
      console.error('[WasmBridge] deleteEdge failed:', e);
      return false;
    }
  }

  /**
   * Edge 삭제 + 인접 face cascade 카운트 반환.
   * 반환값 >= 0: 삭제된 face 수, -1: 실패.
   * UI는 이 값을 "N개 면도 함께 삭제됨" 토스트에 사용.
   */
  deleteEdgeCascade(edgeId: number): number {
    if (!this.engine) return -1;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        deleteEdgeCascade?(edgeId: number): number;
      };
      return eng.deleteEdgeCascade?.(edgeId) ?? -1;
    } catch (e) {
      console.error('[WasmBridge] deleteEdgeCascade failed:', e);
      return -1;
    }
  }

  /** Batch delete faces and edges in a single undo transaction */
  batchDelete(faceIds: number[], edgeIds: number[]): boolean {
    if (!this.engine?.batch_delete) return false;
    this.markDirty();
    try {
      const faces = new Uint32Array(faceIds);
      const edges = new Uint32Array(edgeIds);
      return this.engine.batch_delete(faces, edges);
    } catch (e) {
      console.error('[WasmBridge] batchDelete failed:', e);
      return false;
    }
  }

  /**
   * Diagnostic — first merge failure reason from the most recent
   * `batchEraseEdgesWithMerge` call. Empty string if none.
   */
  lastMergeFailureReason(): string {
    if (!this.engine?.lastMergeFailureReason) return '';
    try { return this.engine.lastMergeFailureReason() ?? ''; }
    catch { return ''; }
  }

  // ═══ ADR-009 Orphan Recovery ═══════════════════════════════════════
  /** Read-only classifier. Returns null if the WASM build doesn't expose it. */
  classifyOrphans(): OrphanReport | null {
    if (!this.engine?.classifyOrphans) return null;
    try {
      const json = this.engine.classifyOrphans();
      if (!json) return null;
      return JSON.parse(json) as OrphanReport;
    } catch (e) {
      this.recordBridgeError('classifyOrphans', e);
      return null;
    }
  }

  /** Apply or preview the recovery plan. `dryRun=true` rolls back. */
  applyOrphanRecovery(
    plan: OrphanRecoveryPlan,
    dryRun: boolean,
  ): OrphanRecoveryResult | null {
    if (!this.engine?.applyOrphanRecovery) return null;
    if (!dryRun) this.markDirty();
    try {
      const json = this.engine.applyOrphanRecovery(JSON.stringify(plan), dryRun);
      if (!json) return null;
      return JSON.parse(json) as OrphanRecoveryResult;
    } catch (e) {
      this.recordBridgeError('applyOrphanRecovery', e);
      return null;
    }
  }

  /**
   * Dry-run hover helper for the Erase tool — "would erasing this edge
   * merge two faces, or cascade-delete them?"
   *
   * Returns the two face IDs that would merge, or `null` if erase would
   * cascade (non-coplanar / not shared by exactly 2 / WASM unavailable).
   *
   * 2026-04-27 — false-negative 제거 (Option A):
   *   실제 erase 경로 (`batch_erase_edges_impl`) 는 standard merge 가
   *   실패하면 `merge_coplanar_faces_geometric` 를 `max(tol*4, 2°)` 로 한 번
   *   더 시도한다. 이전엔 preview 가 user tolerance 한 번만 봐서, 작은 면의
   *   normal precision 흔들림으로 0.5° 안엔 안 들어가지만 실제로는 geometric
   *   fallback 으로 합성되는 케이스가 cyan 으로 표시되지 않았다.
   *
   *   해결: WASM `previewEdgeEraseMerge` 가 이미 angle tol 을 인자로 받으므로
   *   JS-side 에서 두 번 호출 (user tol → 실패 시 geo tol). 두 호출 모두
   *   순수 dry-run (mutation 없음) 이라 안전.
   *
   *   동등성 한계: geometric fallback 의 polygon-rebuild 경로 (C-slit /
   *   다중 공유 엣지) 까지는 시뮬레이션하지 않음 — 그건 별도 분석/구현 필요.
   */
  previewEdgeEraseMerge(edgeId: number, angleTolDeg = 0.5): [number, number] | null {
    if (!this.engine?.previewEdgeEraseMerge) return null;
    try {
      // 1) Standard merge tolerance — user setting (default 0.5°).
      const first = this.engine.previewEdgeEraseMerge(edgeId, angleTolDeg);
      if (first && first.length === 2) {
        return [first[0], first[1]];
      }
      // 2) Geometric fallback tolerance — must match batch_erase_edges_impl
      //    `let geo_tol = (angle_tol_deg * 4.0).max(2.0);` (lib.rs:2212).
      const geoTol = Math.max(angleTolDeg * 4, 2.0);
      if (geoTol > angleTolDeg) {
        const second = this.engine.previewEdgeEraseMerge(edgeId, geoTol);
        if (second && second.length === 2) {
          return [second[0], second[1]];
        }
      }
      return null;
    } catch (e) {
      console.error('[WasmBridge] previewEdgeEraseMerge failed:', e);
      return null;
    }
  }

  /**
   * ADR-016 §2 — true ⇔ this edge is on a face's hole boundary loop.
   * EraseTool uses this on hover to show an explicit-op hint toast
   * instead of the generic cascade-red preview.
   */
  edgeIsHoleBoundary(edgeId: number): boolean {
    if (!this.engine?.edgeIsHoleBoundary) return false;
    try {
      return this.engine.edgeIsHoleBoundary(edgeId);
    } catch (e) {
      console.error('[WasmBridge] edgeIsHoleBoundary failed:', e);
      return false;
    }
  }

  /**
   * ADR-016 §2 (Path B) — Erase + Re-synthesize.
   * "바운더리가 깨지면 새 boundary 찾아서 새 면 생성" 정책 구현.
   * 인접 face soft-remove → edge 제거 → free-edge resolver → new face.
   *
   * @param edgeId — target edge id
   * @param cleanupDangling — if true, removes orphan wires after re-synth
   *   (default false — SketchUp 식 wire 보존)
   * @returns parsed result `{ ok, removedFaces, newFaces, cleanedEdges, cleanedVerts, error? }`
   */
  eraseEdgeResynthesize(edgeId: number, cleanupDangling = false): {
    ok: boolean;
    removedFaces: number;
    newFaces: number;
    cleanedEdges: number;
    cleanedVerts: number;
    error?: string;
  } {
    const fail = { ok: false, removedFaces: 0, newFaces: 0, cleanedEdges: 0, cleanedVerts: 0 };
    if (!this.engine?.eraseEdgeResynthesize) {
      return { ...fail, error: 'WASM method unavailable' };
    }
    try {
      this.markDirty();
      const json = this.engine.eraseEdgeResynthesize(edgeId, cleanupDangling);
      return JSON.parse(json);
    } catch (e) {
      console.error('[WasmBridge] eraseEdgeResynthesize failed:', e);
      return { ...fail, error: String(e) };
    }
  }

  /**
   * Erase tool primary path — atomic merge-or-cascade for many edges + faces
   * in a single undo transaction.
   *
   * Returns `[merged, cascadedFaces, cascadedEdges]`. If the WASM method
   * is unavailable (older binding), caller should fall back to the old
   * per-edge merge loop.
   */
  batchEraseEdgesWithMerge(
    faceIds: number[],
    edgeIds: number[],
    angleTolDeg: number,
    cascadeOnly: boolean,
  ): { merged: number; cascadedFaces: number; cascadedEdges: number; softened: number; synthesized: number; desolidified: number } | null {
    if (!this.engine?.batchEraseEdgesWithMerge) return null;
    this.markDirty();
    try {
      const out = this.engine.batchEraseEdgesWithMerge(
        new Uint32Array(faceIds),
        new Uint32Array(edgeIds),
        angleTolDeg,
        cascadeOnly,
      );
      return {
        merged: out[0] ?? 0,
        cascadedFaces: out[1] ?? 0,
        cascadedEdges: out[2] ?? 0,
        softened: out[3] ?? 0,
        synthesized: out[4] ?? 0,
        desolidified: out[5] ?? 0,
      };
    } catch (e) {
      this.recordBridgeError('batchEraseEdgesWithMerge', e);
      return null;
    }
  }

  /** Phase D (ADR-008 Axiom 9 row 3): non-coplanar forced merge.
   *  Marks edges interior to `faceIds` as SOFT (hidden in render, topology
   *  intact). Returns the number of edges softened, or 0 if the selected
   *  faces share no interior edge (caller should Toast). */
  softenInternalEdges(faceIds: number[]): number {
    if (!this.engine?.softenInternalEdges) return 0;
    this.markDirty();
    try {
      return this.engine.softenInternalEdges(new Uint32Array(faceIds));
    } catch (e) {
      this.recordBridgeError('softenInternalEdges', e);
      return 0;
    }
  }

  /** 2026-04-24: non-destructive default. Merge 실패 → edge SOFT로 숨김. */
  batchEraseEdgesSoftFallback(
    faceIds: number[],
    edgeIds: number[],
    angleTolDeg: number,
    cascadeOnly: boolean,
  ): { merged: number; cascadedFaces: number; cascadedEdges: number; softened: number; synthesized: number; desolidified: number } | null {
    if (!this.engine?.batchEraseEdgesSoftFallback) {
      // Fallback to the legacy destructive path if new API not available.
      return this.batchEraseEdgesWithMerge(faceIds, edgeIds, angleTolDeg, cascadeOnly);
    }
    this.markDirty();
    try {
      const out = this.engine.batchEraseEdgesSoftFallback(
        new Uint32Array(faceIds),
        new Uint32Array(edgeIds),
        angleTolDeg,
        cascadeOnly,
      );
      return {
        merged: out[0] ?? 0,
        cascadedFaces: out[1] ?? 0,
        cascadedEdges: out[2] ?? 0,
        softened: out[3] ?? 0,
        synthesized: out[4] ?? 0,
        desolidified: out[5] ?? 0,
      };
    } catch (e) {
      this.recordBridgeError('batchEraseEdgesSoftFallback', e);
      return null;
    }
  }

  /**
   * Merge two coplanar faces that share the given edge into one face.
   * Returns the merged FaceId on success (>= 0), or -1 on failure
   * (with lastError set — e.g. "not coplanar", "shares multiple edges").
   * Single undo step.
   */
  /**
   * Phase F — 비인접 coplanar 포함 병합 (C1).
   * outer face 안에 완전히 들어있는 inner face를 hole로 흡수.
   * 반환: 병합된 face ID, 실패 시 -1 (lastError 참조).
   */
  mergeCoplanarContaining(outerFaceId: number, innerFaceId: number, angleTolDeg = 0.5): number {
    if (!this.engine) return -1;
    this.markDirty();
    try {
      return this.engine.mergeCoplanarContaining?.(outerFaceId, innerFaceId, angleTolDeg) ?? -1;
    } catch (e) {
      console.error('[WasmBridge] mergeCoplanarContaining failed:', e);
      return -1;
    }
  }

  /** 2026-04-24 — geometric merge for two coplanar faces (different sizes OK). */
  mergeCoplanarFacesGeometric(f1: number, f2: number, angleTolDeg = 1.0): number {
    if (!this.engine) return -1;
    this.markDirty();
    try {
      return this.engine.mergeCoplanarFacesGeometric?.(f1, f2, angleTolDeg) ?? -1;
    } catch (e) {
      console.error('[WasmBridge] mergeCoplanarFacesGeometric failed:', e);
      return -1;
    }
  }

  /**
   * Phase H — Import Normalizer (ADR-007 Barrier).
   * 외부 import된 mesh 데이터를 AXiA 네이티브 규칙에 맞춰 정리.
   * 반환: {degenerateRemoved, windingFlipped, normalsRecomputed,
   *         isolatedVertsRemoved, remainingViolations}
   */
  normalizeForImport(opts?: {
    remove_degenerate?: boolean;
    normalize_winding?: boolean;
    recompute_normals?: boolean;
    remove_isolated_verts?: boolean;
  }): {
    degenerateRemoved: number;
    windingFlipped: number;
    normalsRecomputed: number;
    isolatedVertsRemoved: number;
    remainingViolations: number;
  } {
    const empty = {
      degenerateRemoved: 0, windingFlipped: 0, normalsRecomputed: 0,
      isolatedVertsRemoved: 0, remainingViolations: 0,
    };
    if (!this.engine?.normalizeForImport) return empty;
    this.markDirty();
    try {
      const json = opts ? JSON.stringify(opts) : '';
      const result = this.engine.normalizeForImport(json);
      return JSON.parse(result);
    } catch (e) {
      console.error('[WasmBridge] normalizeForImport failed:', e);
      return empty;
    }
  }

  /**
   * Phase H5 — 자유 엣지를 감지해 face로 전환 (사용자 수동 호출).
   * 2D DXF 도면 import 후 평면도 → 면 생성에 사용.
   * 반환: 생성된 face 수.
   */
  synthesizeFacesFromFreeEdges(): number {
    if (!this.engine?.synthesizeFacesFromFreeEdges) return 0;
    this.markDirty();
    try {
      return this.engine.synthesizeFacesFromFreeEdges();
    } catch (e) {
      console.error('[WasmBridge] synthesizeFacesFromFreeEdges failed:', e);
      return 0;
    }
  }

  /** Phase H5 — 자유 엣지 개수만 카운트 (mesh 불변). UI 프리뷰용. */
  countFreeEdges(): number {
    if (!this.engine?.countFreeEdges) return 0;
    try {
      return this.engine.countFreeEdges();
    } catch (e) {
      console.error('[WasmBridge] countFreeEdges failed:', e);
      return 0;
    }
  }

  /** 엣지 가시성 임계 각도(도) 조회. */
  edgeAngleThreshold(): number {
    if (!this.engine?.edgeAngleThreshold) return 15;
    try { return this.engine.edgeAngleThreshold(); }
    catch { return 15; }
  }

  /** 엣지 가시성 임계 각도(도) 설정. 작을수록 더 많은 엣지 표시.
   *  호출 후 caller는 syncMesh를 트리거해 화면 갱신해야 함.
   *  Range: [1.0, 89.0] (WASM 측에서 clamp). */
  setEdgeAngleThreshold(deg: number): void {
    if (!this.engine?.setEdgeAngleThreshold) return;
    try { this.engine.setEdgeAngleThreshold(deg); this.markDirty(); }
    catch (e) { this.recordBridgeError('setEdgeAngleThreshold', e); }
  }

  /** 태양 방향으로 ground(y=0)에 투영된 shadow triangles (flat buffer).
   *  각 9 float = 1 triangle (3 vertex × {x, y=0, z}).
   *  빈 mesh 또는 sun_dir 유효하지 않으면 empty.
   *  Viewport의 projected shadow layer에서 BufferGeometry로 직접 렌더. */
  computeGroundProjectedShadows(sunX: number, sunY: number, sunZ: number): Float32Array | null {
    if (!this.engine?.computeGroundProjectedShadows) return null;
    try {
      const out = this.engine.computeGroundProjectedShadows(sunX, sunY, sunZ);
      return out && out.length > 0 ? out : null;
    } catch (e) {
      this.recordBridgeError('computeGroundProjectedShadows', e);
      return null;
    }
  }

  /** 전역 mesh manifold 분석 — 닫힌 솔리드 여부와 boundary/non-manifold edge 수.
   *  Solidify 액션이 before/after 리포트에 사용.
   */
  meshManifoldInfo(): {
    faceCount: number;
    interiorEdgeCount: number;
    boundaryEdgeCount: number;
    nonManifoldEdgeCount: number;
    isClosedSolid: boolean;
  } {
    const empty = {
      faceCount: 0, interiorEdgeCount: 0, boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0, isClosedSolid: false,
    };
    if (!this.engine?.meshManifoldInfo) return empty;
    try {
      const json = this.engine.meshManifoldInfo();
      if (!json) return empty;
      const raw = JSON.parse(json);
      return {
        faceCount: raw.face_count ?? 0,
        interiorEdgeCount: raw.interior_edge_count ?? 0,
        boundaryEdgeCount: raw.boundary_edge_count ?? 0,
        nonManifoldEdgeCount: raw.non_manifold_edge_count ?? 0,
        isClosedSolid: raw.is_closed_solid ?? false,
      };
    } catch (e) {
      this.recordBridgeError('meshManifoldInfo', e);
      return empty;
    }
  }

  /** ADR-007 invariant 검증 — 현재 mesh 상태 리포트. */
  verifyInvariants(): {
    checkedFaces: number;
    valid: boolean;
    violationCount: number;
    violations: string[];
  } {
    const empty = { checkedFaces: 0, valid: true, violationCount: 0, violations: [] };
    if (!this.engine?.verifyInvariants) return empty;
    try {
      return JSON.parse(this.engine.verifyInvariants());
    } catch (e) {
      console.error('[WasmBridge] verifyInvariants failed:', e);
      return empty;
    }
  }

  /**
   * ADR-007 원칙 1 확장 — 닫힌 solid에서 face normal이 outward 향하는지.
   * 열린 surface면 isClosedSolid=false (건강한 상태 OK).
   */
  verifyOutwardNormals(): {
    isClosedSolid: boolean;
    checkedFaces: number;
    inwardCount: number;
    inwardFaces: number[];
  } {
    const empty = { isClosedSolid: false, checkedFaces: 0, inwardCount: 0, inwardFaces: [] };
    if (!this.engine?.verifyOutwardNormals) return empty;
    try {
      return JSON.parse(this.engine.verifyOutwardNormals());
    } catch (e) {
      console.error('[WasmBridge] verifyOutwardNormals failed:', e);
      return empty;
    }
  }

  mergeFacesByEdge(edgeId: number, angleTolDeg = 0.5): number {
    if (!this.engine) return -1;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        mergeFacesByEdge?(edgeId: number): number;
        mergeFacesByEdgeTol?(edgeId: number, tol: number): number;
      };
      if (eng.mergeFacesByEdgeTol) {
        return eng.mergeFacesByEdgeTol(edgeId, angleTolDeg);
      }
      return eng.mergeFacesByEdge?.(edgeId) ?? -1;
    } catch (e) {
      console.error('[WasmBridge] mergeFacesByEdge failed:', e);
      return -1;
    }
  }

  /**
   * Iteratively merge adjacent coplanar faces within the selection.
   * Returns the number of merges performed (0 if nothing merged).
   * Single undo step.
   */
  tryMergeAdjacentFaces(faceIds: number[], angleTolDeg = 0.5): number {
    if (!this.engine) return 0;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        tryMergeAdjacentFaces?(ids: Uint32Array): number;
        tryMergeAdjacentFacesTol?(ids: Uint32Array, tol: number): number;
      };
      // Prefer tolerance-aware variant if available; fallback to strict.
      if (eng.tryMergeAdjacentFacesTol && angleTolDeg !== 0.5) {
        return eng.tryMergeAdjacentFacesTol(new Uint32Array(faceIds), angleTolDeg);
      }
      if (eng.tryMergeAdjacentFacesTol) {
        return eng.tryMergeAdjacentFacesTol(new Uint32Array(faceIds), angleTolDeg);
      }
      return eng.tryMergeAdjacentFaces?.(new Uint32Array(faceIds)) ?? 0;
    } catch (e) {
      console.error('[WasmBridge] tryMergeAdjacentFaces failed:', e);
      return 0;
    }
  }

  /**
   * Dry-run merge analysis (mesh 불변).
   * 반환 객체:
   *   total     — 엣지를 공유하는 면 쌍 총 개수
   *   mergeable — coplanar + 공유 엣지 1개인 쌍 (실제 병합 가능)
   *   nonCoplanar — 엣지 공유하나 평면 불일치
   *   ambiguous — 2+ 엣지 공유 (C-slit 등)
   *   estMergesAfterCascade — 예상 최대 병합 횟수
   */
  analyzeMergeCandidates(faceIds: number[], angleTolDeg = 0.5): {
    total: number;
    mergeable: number;
    nonCoplanar: number;
    ambiguous: number;
    estMergesAfterCascade: number;
  } {
    const empty = { total: 0, mergeable: 0, nonCoplanar: 0, ambiguous: 0, estMergesAfterCascade: 0 };
    if (!this.engine) return empty;
    try {
      const eng = this.engine as AxiaEngineExtended & {
        analyzeMergeCandidates?(ids: Uint32Array): string;
        analyzeMergeCandidatesTol?(ids: Uint32Array, tol: number): string;
      };
      const json = eng.analyzeMergeCandidatesTol
        ? eng.analyzeMergeCandidatesTol(new Uint32Array(faceIds), angleTolDeg)
        : eng.analyzeMergeCandidates?.(new Uint32Array(faceIds));
      if (!json) return empty;
      return JSON.parse(json);
    } catch (e) {
      console.error('[WasmBridge] analyzeMergeCandidates failed:', e);
      return empty;
    }
  }

  /**
   * Constraint Solver Level 1: vertex 배열을 delta만큼 이동 (단일 undo).
   */
  translateVerts(vertIds: number[], dx: number, dy: number, dz: number): boolean {
    if (!this.engine?.translateVerts) return false;
    this.markDirty();
    try {
      return this.engine.translateVerts(new Uint32Array(vertIds), dx, dy, dz);
    } catch (e) {
      console.error('[WasmBridge] translateVerts failed:', e);
      return false;
    }
  }

  /** Constraint Solver Level 1: vertex 배열을 center/axis/angle로 회전 (단일 undo). */
  rotateVerts(
    vertIds: number[],
    cx: number, cy: number, cz: number,
    ax: number, ay: number, az: number,
    angleDeg: number,
  ): boolean {
    if (!this.engine?.rotateVerts) return false;
    this.markDirty();
    try {
      return this.engine.rotateVerts(
        new Uint32Array(vertIds),
        cx, cy, cz, ax, ay, az, angleDeg,
      );
    } catch (e) {
      console.error('[WasmBridge] rotateVerts failed:', e);
      return false;
    }
  }

  /** vertex 배열을 center 기준으로 (sx,sy,sz) 스케일 (단일 undo). */
  scaleVerts(
    vertIds: number[],
    cx: number, cy: number, cz: number,
    sx: number, sy: number, sz: number,
  ): boolean {
    if (!this.engine?.scaleVerts) return false;
    this.markDirty();
    try {
      return this.engine.scaleVerts(
        new Uint32Array(vertIds),
        cx, cy, cz, sx, sy, sz,
      );
    } catch (e) {
      console.error('[WasmBridge] scaleVerts failed:', e);
      return false;
    }
  }

  /**
   * 지정 face들을 plane (origin, normal)에 대해 미러링하여 새 face 생성.
   * 원본은 유지되고 mirrored copy가 별도 geometry로 추가됨. 새 face ID 목록
   * 반환 (빈 배열 = 실패, lastError 조회).
   */
  mirrorFaces(
    faceIds: number[],
    ox: number, oy: number, oz: number,
    nx: number, ny: number, nz: number,
  ): number[] {
    if (!this.engine?.mirrorFaces) return [];
    this.markDirty();
    try {
      const out = this.engine.mirrorFaces(
        new Uint32Array(faceIds),
        ox, oy, oz, nx, ny, nz,
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('mirrorFaces', e);
      return [];
    }
  }

  /**
   * N개의 cross-section을 이어붙여 loft 표면 생성.
   * `sections` — 모든 section의 point를 연결한 flat 배열 (각 point=3 float).
   * `sectionSize` — section당 point 개수 (모든 section 동일해야 함).
   * `closedSections` — section이 닫힌 ring인지 (true면 마지막↔첫 point 연결).
   */
  loftSections(
    sections: number[],
    sectionSize: number,
    closedSections: boolean,
  ): number[] {
    if (!this.engine?.loftSections) return [];
    this.markDirty();
    try {
      const out = this.engine.loftSections(
        new Float64Array(sections),
        sectionSize,
        closedSections,
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('loftSections', e);
      return [];
    }
  }

  /**
   * Query helpers for the Measure tool — pure read, no mutation.
   */
  faceArea(faceId: number): number {
    return this.engine?.faceArea?.(faceId) ?? 0;
  }
  edgeLength(edgeId: number): number {
    return this.engine?.edgeLength?.(edgeId) ?? 0;
  }
  meshVolume(): number {
    return this.engine?.meshVolume?.() ?? 0;
  }

  /**
   * Linear array — create `count` translated copies of the given faces.
   * Returns the new FaceId list, empty on failure (lastError set).
   */
  arrayLinearFaces(
    faceIds: number[],
    count: number,
    offset: [number, number, number],
  ): number[] {
    if (!this.engine?.arrayLinearFaces) return [];
    this.markDirty();
    try {
      const out = this.engine.arrayLinearFaces(
        new Uint32Array(faceIds),
        count,
        offset[0], offset[1], offset[2],
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('arrayLinearFaces', e);
      return [];
    }
  }

  /**
   * Radial array — rotate `count` copies of the given faces around an axis.
   * Returns the new FaceId list, empty on failure (lastError set).
   */
  arrayRadialFaces(
    faceIds: number[],
    count: number,
    origin: [number, number, number],
    axis: [number, number, number],
    totalAngleRad: number,
  ): number[] {
    if (!this.engine?.arrayRadialFaces) return [];
    this.markDirty();
    try {
      const out = this.engine.arrayRadialFaces(
        new Uint32Array(faceIds),
        count,
        origin[0], origin[1], origin[2],
        axis[0], axis[1], axis[2],
        totalAngleRad,
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('arrayRadialFaces', e);
      return [];
    }
  }

  /**
   * Get outer-loop vertex IDs of a face in walk order. Empty array on
   * error / missing face. Used by deformers to gather the vertex set
   * from a face selection.
   */
  getFaceVertices(faceId: number): number[] {
    if (!this.engine?.getFaceVertices) return [];
    try {
      const out = this.engine.getFaceVertices(faceId);
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('getFaceVertices', e);
      return [];
    }
  }

  /**
   * Bend vertices around `bendAxis` through `origin`. Rotation angle
   * ramps 0 → angleDeg as t (projected distance along bendDir) goes
   * from 0 to lengthLimit. Returns false on failure (lastError set).
   */
  bendVerts(
    vertIds: number[],
    bendAxis: [number, number, number],
    bendDir: [number, number, number],
    origin: [number, number, number],
    angleDeg: number,
    lengthLimit: number,
  ): boolean {
    if (!this.engine?.bendVerts) return false;
    this.markDirty();
    try {
      return this.engine.bendVerts(
        new Uint32Array(vertIds),
        bendAxis[0], bendAxis[1], bendAxis[2],
        bendDir[0], bendDir[1], bendDir[2],
        origin[0], origin[1], origin[2],
        angleDeg, lengthLimit,
      );
    } catch (e) {
      this.recordBridgeError('bendVerts', e);
      return false;
    }
  }

  /**
   * Twist vertices around `(axisOrigin, axisDir)`. `degreesPerUnit` is
   * the twist rate per mm along the axis.
   */
  twistVertsDeform(
    vertIds: number[],
    axisOrigin: [number, number, number],
    axisDir: [number, number, number],
    degreesPerUnit: number,
  ): boolean {
    if (!this.engine?.twistVerts) return false;
    this.markDirty();
    try {
      return this.engine.twistVerts(
        new Uint32Array(vertIds),
        axisOrigin[0], axisOrigin[1], axisOrigin[2],
        axisDir[0], axisDir[1], axisDir[2],
        degreesPerUnit,
      );
    } catch (e) {
      this.recordBridgeError('twistVerts', e);
      return false;
    }
  }

  /**
   * Taper vertices along `(axisOrigin, axisDir)` from startScale at t=0
   * to endScale at t=length.
   */
  taperVerts(
    vertIds: number[],
    axisOrigin: [number, number, number],
    axisDir: [number, number, number],
    startScale: number,
    endScale: number,
    length: number,
  ): boolean {
    if (!this.engine?.taperVerts) return false;
    this.markDirty();
    try {
      return this.engine.taperVerts(
        new Uint32Array(vertIds),
        axisOrigin[0], axisOrigin[1], axisOrigin[2],
        axisDir[0], axisDir[1], axisDir[2],
        startScale, endScale, length,
      );
    } catch (e) {
      this.recordBridgeError('taperVerts', e);
      return false;
    }
  }

  /**
   * 엣지를 지정 radius의 원호 표면으로 둥글게 블렌드 (Fillet).
   * segments만큼의 quad로 fillet strip 생성. 반환: 새 fillet face 수,
   * 실패 시 -1 (lastError() 참조).
   */
  filletEdge(edgeId: number, radius: number, segments = 8): number {
    if (!this.engine?.filletEdge) return -1;
    this.markDirty();
    try {
      return this.engine.filletEdge(edgeId, radius, segments);
    } catch (e) {
      this.recordBridgeError('filletEdge', e);
      return -1;
    }
  }

  /**
   * Catmull-Clark 1 step smoothing — 전체 mesh에 적용.
   * 매 호출마다 face 수가 크게 증가 (N각형 → N개 quad). 여러 번 호출하면
   * 점점 매끄러워짐. 반환: 생성된 새 face 수, 실패 시 -1.
   */
  subdivideCatmullClark(): number {
    if (!this.engine?.subdivideCatmullClark) return -1;
    this.markDirty();
    try {
      return this.engine.subdivideCatmullClark();
    } catch (e) {
      this.recordBridgeError('subdivideCatmullClark', e);
      return -1;
    }
  }

  /**
   * 2D profile을 3D path 따라 sweep. profile은 local XY 평면 (z=0).
   * path는 world 공간 폴리라인. closed_profile=true면 tube, false면 strip.
   */
  sweepProfileAlongPath(
    profile: number[],
    path: number[],
    closedProfile: boolean,
  ): number[] {
    if (!this.engine?.sweepProfileAlongPath) return [];
    this.markDirty();
    try {
      const out = this.engine.sweepProfileAlongPath(
        new Float64Array(profile),
        new Float64Array(path),
        closedProfile,
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('sweepProfileAlongPath', e);
      return [];
    }
  }

  /**
   * 2D 프로파일(3N 길이 flat 배열 [x,y,z, x,y,z, …])을 axis (origin, dir)
   * 기준으로 회전시켜 surface of revolution 생성. 새 FaceId 목록 반환.
   */
  revolveProfile(
    profile: number[],
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    segments: number,
  ): number[] {
    if (!this.engine?.revolveProfile) return [];
    this.markDirty();
    try {
      const out = this.engine.revolveProfile(
        new Float64Array(profile),
        ox, oy, oz, dx, dy, dz, segments,
      );
      return out ? Array.from(out) : [];
    } catch (e) {
      this.recordBridgeError('revolveProfile', e);
      return [];
    }
  }

  /** Edge의 두 끝점 VertId 반환 ([v_small, v_large]); 실패 시 빈 배열. */
  getEdgeEndpoints(edgeId: number): number[] {
    if (!this.engine?.getEdgeEndpoints) return [];
    try {
      const arr = this.engine.getEdgeEndpoints(edgeId);
      return arr ? Array.from(arr) : [];
    } catch (e) {
      console.error('[WasmBridge] getEdgeEndpoints failed:', e);
      return [];
    }
  }

  /**
   * Polyline chain containing the given edge — edges reachable by walking
   * through degree-2 vertices. Stops at junctions (≥3 incident edges) or
   * dead ends (1 incident edge). Always includes the seed edge.
   * Empty array if edge missing/inactive.
   */
  collectEdgeChain(edgeId: number): number[] {
    if (!this.engine?.collectEdgeChain) return [edgeId];
    try {
      const arr = this.engine.collectEdgeChain(edgeId);
      return arr ? Array.from(arr) : [edgeId];
    } catch (e) {
      this.recordBridgeError('collectEdgeChain', e);
      return [edgeId];
    }
  }

  /**
   * 중심선 그리기 — 기존 엣지와 교차해도 어느 쪽도 분절 안 되며,
   * face synthesis에도 참여하지 않음. 평면도/축 그리기 용.
   * 성공 시 새 edge id, 실패 시 -1.
   */
  drawCenterline(start: [number, number, number], end: [number, number, number]): number {
    if (!this.engine?.drawCenterline) return -1;
    this.markDirty();
    try {
      return this.engine.drawCenterline(
        start[0], start[1], start[2],
        end[0], end[1], end[2],
      );
    } catch (e) {
      this.recordBridgeError('drawCenterline', e);
      return -1;
    }
  }

  /** Edge semantic class: 0 = Geometry, 1 = Centerline. Missing/inactive → 0. */
  edgeClass(edgeId: number): number {
    if (!this.engine?.edgeClass) return 0;
    try { return this.engine.edgeClass(edgeId); }
    catch { return 0; }
  }

  /** 기존 엣지의 class를 변경. Geometry→Centerline 시 face를 감싸는 엣지는 거부. */
  setEdgeClass(edgeId: number, classRaw: 0 | 1): boolean {
    if (!this.engine?.setEdgeClass) return false;
    this.markDirty();
    try { return this.engine.setEdgeClass(edgeId, classRaw); }
    catch (e) { this.recordBridgeError('setEdgeClass', e); return false; }
  }

  /** Centerline 전용 edge line segments (flat [x,y,z, x,y,z, ...] pair 단위).
   *  Viewport가 dashed LineMaterial로 별도 렌더. 비어있으면 빈 배열. */
  getCenterlineLines(): Float32Array | null {
    if (!this.engine?.getCenterlineLines) return null;
    try {
      const arr = this.engine.getCenterlineLines();
      return arr && arr.length > 0 ? arr : null;
    } catch (e) {
      this.recordBridgeError('getCenterlineLines', e);
      return null;
    }
  }

  /**
   * Edge를 지정 위치에서 split — 새 vertex 생성하고 edge를 2개로 나눔.
   * 성공 시 새 vertex id, 실패 시 -1.
   * 단일 undo 스텝.
   */
  splitEdge(edgeId: number, px: number, py: number, pz: number): number {
    if (!this.engine?.splitEdge) return -1;
    this.markDirty();
    try {
      return this.engine.splitEdge(edgeId, px, py, pz);
    } catch (e) {
      console.error('[WasmBridge] splitEdge failed:', e);
      return -1;
    }
  }

  /** Vertex 위치 [x, y, z] 반환; 실패 시 null. */
  getVertexPos(vertId: number): [number, number, number] | null {
    if (!this.engine?.getVertexPos) return null;
    try {
      const arr = this.engine.getVertexPos(vertId);
      if (!arr || arr.length < 3) return null;
      return [arr[0], arr[1], arr[2]];
    } catch (e) {
      console.error('[WasmBridge] getVertexPos failed:', e);
      return null;
    }
  }

  /** 주어진 world 좌표에서 `tol` 거리 안의 가장 가까운 활성 vertex 의 VertId.
   *  없으면 -1. Move tool 의 vertex pick 경로에서 사용. */
  findVertexIdAt(x: number, y: number, z: number, tol: number): number {
    if (!this.engine?.findVertexIdAt) return -1;
    try {
      return this.engine.findVertexIdAt(x, y, z, tol);
    } catch (e) {
      console.error('[WasmBridge] findVertexIdAt failed:', e);
      return -1;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Constraint Solver Level 2 (persistent graph)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add edge-based constraint (parallel/perpendicular/collinear) between
   * two edges specified by vertex pairs. Returns constraint ID (>=1) or 0 on failure.
   * Constraint is applied immediately (first-time solve).
   */
  addEdgeConstraint(
    kind: 'parallel' | 'perpendicular' | 'collinear',
    edgeAVa: number, edgeAVb: number,
    edgeBVa: number, edgeBVb: number,
  ): number {
    if (!this.engine?.addEdgeConstraint) return 0;
    this.markDirty();
    try {
      return this.engine.addEdgeConstraint(kind, edgeAVa, edgeAVb, edgeBVa, edgeBVb);
    } catch (e) {
      console.error('[WasmBridge] addEdgeConstraint failed:', e);
      return 0;
    }
  }

  addDistanceConstraint(vA: number, vB: number, distance: number): number {
    if (!this.engine?.addDistanceConstraint) return 0;
    this.markDirty();
    try {
      return this.engine.addDistanceConstraint(vA, vB, distance);
    } catch (e) {
      console.error('[WasmBridge] addDistanceConstraint failed:', e);
      return 0;
    }
  }

  removeConstraint(id: number): boolean {
    if (!this.engine?.removeConstraint) return false;
    this.markDirty();
    try { return this.engine.removeConstraint(id); }
    catch (e) { console.error('[WasmBridge] removeConstraint failed:', e); return false; }
  }

  listConstraints(): Array<{ id: number; kind: string; active: boolean; value?: number; refs: unknown[] }> {
    if (!this.engine?.listConstraints) return [];
    try {
      const json = this.engine.listConstraints();
      return JSON.parse(json);
    } catch (e) {
      console.error('[WasmBridge] listConstraints failed:', e);
      return [];
    }
  }

  resolveAllConstraints(): number {
    if (!this.engine?.resolveAllConstraints) return 0;
    this.markDirty();
    try { return this.engine.resolveAllConstraints(); }
    catch (e) { console.error('[WasmBridge] resolveAllConstraints failed:', e); return 0; }
  }

  setConstraintActive(id: number, active: boolean): boolean {
    if (!this.engine?.setConstraintActive) return false;
    try { return this.engine.setConstraintActive(id, active); }
    catch (e) { console.error('[WasmBridge] setConstraintActive failed:', e); return false; }
  }

  constraintCount(): number {
    if (!this.engine?.constraintCount) return 0;
    try { return this.engine.constraintCount(); }
    catch { return 0; }
  }

  /**
   * Level 3: iterative XPBD-style constraint solve.
   * Returns { converged, iterations, finalResidual, initialResidual, overConstrained }.
   * Default maxIter=50, tolerance=1e-5.
   */
  resolveConstraintsIterative(maxIter = 50, tolerance = 1e-5): {
    converged: boolean;
    iterations: number;
    finalResidual: number;
    initialResidual: number;
    overConstrained: boolean;
  } | null {
    if (!this.engine?.resolveConstraintsIterative) return null;
    this.markDirty();
    try {
      const json = this.engine.resolveConstraintsIterative(maxIter, tolerance);
      return JSON.parse(json);
    } catch (e) {
      console.error('[WasmBridge] resolveConstraintsIterative failed:', e);
      return null;
    }
  }

  /** Level 3: max residual across active constraints (no mutation). */
  maxConstraintResidual(): number {
    if (!this.engine?.maxConstraintResidual) return 0;
    try { return this.engine.maxConstraintResidual(); }
    catch { return 0; }
  }

  /**
   * Flip (reverse) the orientation of the given faces.
   * Locked faces are silently skipped by the engine.
   * Returns the number of faces actually flipped.
   * All changes are a single undo step.
   */
  flipFaces(faceIds: number[]): number {
    if (!this.engine) return 0;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        flipFaces?(ids: Uint32Array): number;
      };
      return eng.flipFaces?.(new Uint32Array(faceIds)) ?? 0;
    } catch (e) {
      console.error('[WasmBridge] flipFaces failed:', e);
      return 0;
    }
  }

  /** DCEL topology BFS: seedFace에서 edge를 공유하는 모든 연결된 face 반환 */
  getConnectedFaces(seedFaceId: number): number[] {
    if (!this.engine?.get_connected_faces) return [];
    try {
      const result = this.engine.get_connected_faces(seedFaceId);
      return Array.from(result);
    } catch (e) {
      console.error('[WasmBridge] getConnectedFaces failed:', e);
      return [];
    }
  }

  faceCount(): number {
    if (!this.engine) return 0;
    return this.engine.face_count();
  }

  // ════════════════════════════════════════════════
  // Project Save/Load (.axia)
  // ════════════════════════════════════════════════

  /** 메시 데이터를 바이너리 스냅샷으로 내보내기 */
  exportSnapshot(): Uint8Array | null {
    if (!this.engine) return null;
    try {
      const result = this.engine.export_snapshot?.();
      if (result) Toast.success('프로젝트 내보내기 성공');
      return result ?? null;
    } catch (e) {
      console.error('[WasmBridge] exportSnapshot failed:', e);
      Toast.error('프로젝트 내보내기 실패');
      return null;
    }
  }

  /** 바이너리 스냅샷으로부터 메시 복원 */
  importSnapshot(data: Uint8Array): boolean {
    if (!this.engine) return false;
    this.markDirty();
    try {
      const result = this.engine.import_snapshot?.(data) ?? false;
      if (result) Toast.success('프로젝트 불러오기 성공');
      return result;
    } catch (e) {
      console.error('[WasmBridge] importSnapshot failed:', e);
      Toast.error('프로젝트 불러오기 실패');
      return false;
    }
  }

  getStats(): { verts: number; edges: number; faces: number; groups: number; components: number; canUndo: boolean; canRedo: boolean } {
    if (!this.engine) return { verts: 0, edges: 0, faces: 0, groups: 0, components: 0, canUndo: false, canRedo: false };
    try {
      return JSON.parse(this.engine.get_stats());
    } catch {
      return { verts: 0, edges: 0, faces: 0, groups: 0, components: 0, canUndo: false, canRedo: false };
    }
  }

  // ════════════════════════════════════════════════
  // DXF Import (Rust DCEL 변환)
  // ════════════════════════════════════════════════

  /** DXF 파일을 Rust 엔진에서 파싱하여 DCEL 메시로 변환 */
  importDxf(data: Uint8Array): DxfImportResult | null {
    if (!this.engine) return null;
    this.markDirty();
    try {
      const json = this.engine.import_dxf?.(data);
      if (!json) return null;
      const result = JSON.parse(json) as DxfImportResult;
      if (result.ok) {
        Toast.success(`DXF 불러오기 성공: ${result.totalFaces ?? 0}개 면`);
      } else {
        Toast.error(`DXF 불러오기 실패: ${result.error ?? '알 수 없는 오류'}`);
      }
      return result;
    } catch (e) {
      console.error('[WasmBridge] importDxf failed:', e);
      Toast.error('DXF 파일 파싱 실패');
      return null;
    }
  }

  // ════════════════════════════════════════════════
  // Boolean Operations
  // ════════════════════════════════════════════════

  /** Boolean 연산: Union / Subtract / Intersect
   *  facesA, facesB: Rust FaceId 배열
   *  op: 'union' | 'subtract' | 'intersect'
   */
  // ════════════════════════════════════════════════
  // Transform Operations (Move / Rotate / Scale)
  // ════════════════════════════════════════════════

  /** 선택된 face들의 정점을 (dx, dy, dz)만큼 이동 */
  translateFaces(faceIds: number[], dx: number, dy: number, dz: number): boolean {
    if (!this.engine) return false;
    this.markDirty();
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.translate_faces?.(ids, dx, dy, dz) ?? false;
    } catch (e) {
      console.error('[WasmBridge] translateFaces failed:', e);
      Toast.warning('이동 실행 실패');
      return false;
    }
  }

  /** 선택된 face들의 정점을 center 기준으로 회전
   *  axis: 회전축, angleDeg: 도(degree) 단위 */
  rotateFaces(
    faceIds: number[],
    cx: number, cy: number, cz: number,
    ax: number, ay: number, az: number,
    angleDeg: number,
  ): boolean {
    if (!this.engine) return false;
    this.markDirty();
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.rotate_faces?.(ids, cx, cy, cz, ax, ay, az, angleDeg) ?? false;
    } catch (e) {
      console.error('[WasmBridge] rotateFaces failed:', e);
      Toast.warning('회전 실행 실패');
      return false;
    }
  }

  /** 선택된 face들의 정점을 center 기준으로 스케일 */
  scaleFaces(
    faceIds: number[],
    cx: number, cy: number, cz: number,
    sx: number, sy: number, sz: number,
  ): boolean {
    if (!this.engine) return false;
    this.markDirty();
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.scale_faces?.(ids, cx, cy, cz, sx, sy, sz) ?? false;
    } catch (e) {
      console.error('[WasmBridge] scaleFaces failed:', e);
      Toast.warning('스케일 실행 실패');
      return false;
    }
  }

  /** 선택된 face들의 중심점 (centroid) */
  facesCentroid(faceIds: number[]): THREE.Vector3 | null {
    if (!this.engine) return null;
    try {
      const ids = new Uint32Array(faceIds);
      const arr = this.engine.faces_centroid?.(ids);
      if (!arr || arr.length < 3) return null;
      return new THREE.Vector3(arr[0], arr[1], arr[2]);
    } catch (e) {
      console.error('[WasmBridge] facesCentroid failed:', e);
      return null;
    }
  }

  // ════════════════════════════════════════════════
  // Offset Operation
  // ════════════════════════════════════════════════

  /** face의 경계를 dist만큼 안쪽(+)/바깥쪽(-)으로 오프셋
   *  결과: innerFace + stripFaces 생성 */
  offsetFace(faceId: number, dist: number): OffsetResult | null {
    if (!this.engine) return null;
    this.markDirty();
    try {
      const json = this.engine.offset_face?.(faceId, dist);
      if (!json) return null;
      const result = JSON.parse(json) as OffsetResult;
      if (!result.ok) {
        Toast.warning(`Offset 실패: ${result.error ?? '알 수 없는 오류'}`);
      }
      return result;
    } catch (e) {
      console.error('[WasmBridge] offsetFace failed:', e);
      Toast.warning('Offset 실행 실패');
      return null;
    }
  }

  /** Edge(line)를 평행 offset → 새 edge + 사각형 face 생성 */
  offsetEdge(edgeId: number, dist: number, planeNormal: [number, number, number]): OffsetEdgeResult | null {
    if (!this.engine) return null;
    this.markDirty();
    try {
      const json = this.engine.offset_edge?.(edgeId, dist, planeNormal[0], planeNormal[1], planeNormal[2]);
      if (!json) return null;
      const result = JSON.parse(json) as OffsetEdgeResult;
      if (!result.ok) {
        Toast.warning(`Edge Offset 실패: ${result.error ?? '알 수 없는 오류'}`);
      }
      return result;
    } catch (e) {
      console.error('[WasmBridge] offsetEdge failed:', e);
      Toast.warning('Edge Offset 실행 실패');
      return null;
    }
  }

  /** Edge line segment index → EdgeId map (edge picking용) */
  getEdgeMap(): Uint32Array | null {
    if (!this.engine) return null;
    if (!this.bufferCache.dirty && this.bufferCache.edgeMap) {
      return this.bufferCache.edgeMap;
    }
    try {
      const map = this.engine.get_edge_map?.();
      if (map && map.length > 0) {
        this.bufferCache.edgeMap = map;
        return map;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ════════════════════════════════════════════════
  // XIA Inspector
  // ════════════════════════════════════════════════

  /** 선택된 face들의 XIA 속성 정보 (기하학적 + 물리적) */
  getXiaInfo(faceIds: number[]): XiaInfo | null {
    if (!this.engine) return null;
    try {
      const ids = new Uint32Array(faceIds);
      const json = this.engine.get_xia_info?.(ids);
      if (!json) return null;
      return JSON.parse(json) as XiaInfo;
    } catch (e) {
      console.error('[WasmBridge] getXiaInfo failed:', e);
      return null;
    }
  }

  // ════════════════════════════════════════════════
  // Group / Component Operations
  // ════════════════════════════════════════════════

  /** 선택된 face들을 그룹으로 생성. 반환: groupId (0이면 실패) */
  createGroup(name: string, faceIds: number[]): number {
    if (!this.engine) return 0;
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.create_group?.(name, ids) ?? 0;
    } catch (e) {
      console.error('[WasmBridge] createGroup failed:', e);
      return 0;
    }
  }

  /** 그룹 해제 */
  deleteGroup(groupId: number): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.delete_group?.(groupId) ?? false;
    } catch (e) {
      console.error('[WasmBridge] deleteGroup failed:', e);
      return false;
    }
  }

  /** 그룹 이름 변경 */
  renameGroup(groupId: number, newName: string): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.rename_group?.(groupId, newName) ?? false;
    } catch (e) {
      console.error('[WasmBridge] renameGroup failed:', e);
      return false;
    }
  }

  /** 그룹 가시성 토글 */
  toggleGroupVisibility(groupId: number): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.toggle_group_visibility?.(groupId) ?? false;
    } catch (e) {
      console.error('[WasmBridge] toggleGroupVisibility failed:', e);
      return false;
    }
  }

  /** face가 잠긴 그룹에 속하는지 확인 */
  isFaceLocked(faceId: number): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.is_face_locked?.(faceId) ?? false;
    } catch {
      return false;
    }
  }

  /** face가 속한 XIA ID 조회 (O(1) 역인덱스, 없으면 -1) */
  /**
   * XIA가 소유한 모든 face ID 반환 (B3 — 그룹 병합 지원).
   */
  getXiaFaceIds(xiaId: number): number[] {
    if (!this.engine) return [];
    try {
      const ids = this.engine.getXiaFaceIds?.(xiaId);
      return ids ? Array.from(ids) : [];
    } catch (e) {
      console.error('[WasmBridge] getXiaFaceIds failed:', e);
      return [];
    }
  }

  getXiaForFace(faceId: number): number {
    if (!this.engine) return -1;
    try {
      const result = this.engine.get_xia_for_face?.(faceId);
      // u32::MAX (4294967295) 이면 없음
      return (result === undefined || result >= 0xFFFFFFFF) ? -1 : result;
    } catch {
      return -1;
    }
  }

  /** 그룹 잠금 토글 */
  toggleGroupLock(groupId: number): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.toggle_group_lock?.(groupId) ?? false;
    } catch (e) {
      console.error('[WasmBridge] toggleGroupLock failed:', e);
      return false;
    }
  }

  /** face가 속한 그룹 ID 조회 (0이면 그룹 없음) */
  getGroupForFace(faceId: number): number {
    if (!this.engine) return 0;
    try {
      return this.engine.get_group_for_face?.(faceId) ?? 0;
    } catch {
      return 0;
    }
  }

  /** 그룹의 모든 face ID (재귀) */
  getGroupFaces(groupId: number): number[] {
    if (!this.engine) return [];
    try {
      const arr = this.engine.get_group_faces?.(groupId);
      return arr ? Array.from(arr) : [];
    } catch {
      return [];
    }
  }

  /** 그룹에 face 추가 */
  addFacesToGroup(groupId: number, faceIds: number[]): boolean {
    if (!this.engine) return false;
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.add_faces_to_group?.(groupId, ids) ?? false;
    } catch {
      return false;
    }
  }

  /** 그룹에서 face 제거 */
  removeFacesFromGroup(groupId: number, faceIds: number[]): boolean {
    if (!this.engine) return false;
    try {
      const ids = new Uint32Array(faceIds);
      return this.engine.remove_faces_from_group?.(groupId, ids) ?? false;
    } catch {
      return false;
    }
  }

  /** 중첩 그룹 설정 (parentId=0이면 루트로) */
  setGroupParent(childId: number, parentId: number): boolean {
    if (!this.engine) return false;
    try {
      return this.engine.set_group_parent?.(childId, parentId) ?? false;
    } catch {
      return false;
    }
  }

  /** 그룹을 컴포넌트로 변환. 반환: defId (0이면 실패) */
  makeComponent(groupId: number, name: string): number {
    if (!this.engine) return 0;
    try {
      return this.engine.make_component?.(groupId, name) ?? 0;
    } catch (e) {
      console.error('[WasmBridge] makeComponent failed:', e);
      return 0;
    }
  }

  /** 그룹 정보 JSON */
  getGroupInfo(groupId: number): GroupInfo | null {
    if (!this.engine) return null;
    try {
      const json = this.engine.get_group_info?.(groupId);
      if (!json) return null;
      return JSON.parse(json) as GroupInfo;
    } catch {
      return null;
    }
  }

  /** 전체 그룹 트리 */
  getAllGroups(): GroupInfo[] {
    if (!this.engine) return [];
    try {
      const json = this.engine.get_all_groups?.();
      if (!json) return [];
      return JSON.parse(json) as GroupInfo[];
    } catch {
      return [];
    }
  }

  /** 그룹 수 */
  groupCount(): number {
    if (!this.engine) return 0;
    try {
      return this.engine.group_count?.() ?? 0;
    } catch {
      return 0;
    }
  }

  // ═══════════════════════════════════════
  //  Material 연산 (Disconnection ① 해결)
  // ═══════════════════════════════════════

  /** 면에 재질 할당 → Rust scene.execute(AssignMaterial) → XIA 자동 승격 */
  assignMaterial(faceIds: Uint32Array, materialIdRaw: number): boolean {
    if (!this.engine?.assign_material) return false;
    this.markDirty();
    try {
      return this.engine.assign_material(faceIds, materialIdRaw);
    } catch (e) {
      console.error('[WasmBridge] assignMaterial failed:', e);
      return false;
    }
  }

  /** 면에서 재질 제거 → Rust scene.execute(RemoveMaterial) → XIA 자동 강등 */
  removeMaterial(faceIds: Uint32Array): boolean {
    if (!this.engine?.remove_material) return false;
    this.markDirty();
    try {
      return this.engine.remove_material(faceIds);
    } catch (e) {
      console.error('[WasmBridge] removeMaterial failed:', e);
      return false;
    }
  }

  /** 면의 재질 ID 조회 (0 = 기본/미할당) */
  getFaceMaterial(faceId: number): number {
    if (!this.engine?.get_face_material) return 0;
    try {
      return this.engine.get_face_material(faceId);
    } catch {
      return 0;
    }
  }

  /** 전체 재질 할당 상태 조회 (JSON) */
  getAllMaterials(): string | null {
    if (!this.engine?.get_all_materials) return null;
    try {
      return this.engine.get_all_materials();
    } catch {
      return null;
    }
  }

  booleanOp(facesA: number[], facesB: number[], op: 'union' | 'subtract' | 'intersect'): BooleanResult | null {
    if (!this.engine) return null;
    this.markDirty();
    try {
      const a = new Uint32Array(facesA);
      const b = new Uint32Array(facesB);
      const json = this.engine.boolean_op?.(a, b, op);
      if (!json) return null;
      const result = JSON.parse(json) as BooleanResult;
      if (!result.ok) {
        Toast.error(`Boolean ${op} 실패: ${result.error ?? '알 수 없는 오류'}`);
      } else {
        Toast.success(`Boolean ${op} 성공`);
      }
      return result;
    } catch (e) {
      console.error('[WasmBridge] booleanOp failed:', e);
      Toast.error(`Boolean 연산 실패: ${String(e)}`);
      return null;
    }
  }

  /** Tier 4 B-5 — Sheet 2D Boolean.
   *  두 coplanar Sheet face에 대해 union/subtract/intersect 수행.
   *  반환: 성공 시 새로 생성된 face id, 실패 시 null. */
  sheetBoolean(a: number, b: number, op: 'union' | 'subtract' | 'intersect'): number | null {
    if (!this.engine?.sheetBoolean) return null;
    this.markDirty();
    try {
      const json = this.engine.sheetBoolean(a, b, op);
      const res = JSON.parse(json) as { ok: boolean; resultFace?: number; error?: string };
      if (!res.ok) {
        Toast.error(`Sheet ${op} 실패: ${res.error ?? '알 수 없는 오류'}`);
        return null;
      }
      Toast.success(`Sheet ${op} 성공`);
      return res.resultFace ?? null;
    } catch (e) {
      console.error('[WasmBridge] sheetBoolean failed:', e);
      Toast.error(`Sheet 연산 실패: ${String(e)}`);
      return null;
    }
  }

  /** ADR-007 Rev 2 — face 가 닫힌 볼륨의 일원(Wall)인지 stand-alone
   *  sheet 인지 판정. */
  isFaceInVolume(faceIdRaw: number): boolean {
    return this.engine?.isFaceInVolume?.(faceIdRaw) ?? false;
  }

  /** ADR-007 Rev 2 — 모든 active face 의 분류 비트 array.
   *  index = FaceId raw, value = 1 (Wall) | 0 (Sheet 또는 inactive).
   *  Viewport 가 sheet/wall 분리 렌더 시 사용. */
  getFaceVolumeFlags(): Uint8Array | null {
    if (!this.engine) return null;
    try {
      const flags = this.engine.getFaceVolumeFlags?.();
      return flags instanceof Uint8Array ? flags : null;
    } catch (e) {
      console.warn('[WasmBridge] getFaceVolumeFlags failed:', e);
      return null;
    }
  }

  /** Phase 2 — auto-intersect on draw 토글 (기본 true). */
  setAutoIntersectOnDraw(enabled: boolean): void {
    this.engine?.setAutoIntersectOnDraw?.(enabled);
  }

  getAutoIntersectOnDraw(): boolean {
    return this.engine?.getAutoIntersectOnDraw?.() ?? true;
  }

  /**
   * "Intersect with Model" — SketchUp 스타일 수동 교차선 생성.
   * 선택한 face 와 나머지 active face 사이의 3D 교차선을 edge 로 변환.
   * inside/outside 분류 없이 모든 sub-face 를 유지.
   *
   * @param faceIds 교차 검사할 face ID 배열
   * @returns 성공 시 {ok:true, resultFaces:N, totalFaces:M}
   */
  intersectWithModel(faceIds: number[]): { ok: boolean; resultFaces?: number; totalFaces?: number; error?: string } | null {
    if (!this.engine) return null;
    if (faceIds.length === 0) return { ok: false, error: 'no faces selected' };
    this.markDirty();
    try {
      const arr = new Uint32Array(faceIds);
      const json = this.engine.intersectWithModel?.(arr);
      if (!json) return { ok: false, error: 'WASM method unavailable' };
      return JSON.parse(json);
    } catch (e) {
      console.error('[WasmBridge] intersectWithModel failed:', e);
      return { ok: false, error: String(e) };
    }
  }

  // ═══════════════════════════════════════
  //  Primitive Shapes (Cylinder, Cone, Sphere)
  // ═══════════════════════════════════════

  /** Create a cylinder primitive. Returns base face ID for Push/Pull operations. */
  create_cylinder(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number {
    if (!this.engine?.create_cylinder) return -1;
    this.markDirty();
    try {
      return this.engine.create_cylinder(cx, cy, cz, radius, height, segments);
    } catch (e) {
      console.error('[WasmBridge] create_cylinder failed:', e);
      return -1;
    }
  }

  /** Create a cone primitive. Returns base face ID for Push/Pull operations. */
  create_cone(cx: number, cy: number, cz: number, radius: number, height: number, segments: number): number {
    if (!this.engine?.create_cone) return -1;
    this.markDirty();
    try {
      return this.engine.create_cone(cx, cy, cz, radius, height, segments);
    } catch (e) {
      console.error('[WasmBridge] create_cone failed:', e);
      return -1;
    }
  }

  /** Create a sphere primitive. Returns a face ID for Push/Pull operations. */
  create_sphere(cx: number, cy: number, cz: number, radius: number, u_segments: number, v_segments: number): number {
    if (!this.engine?.create_sphere) return -1;
    this.markDirty();
    try {
      return this.engine.create_sphere(cx, cy, cz, radius, u_segments, v_segments);
    } catch (e) {
      console.error('[WasmBridge] create_sphere failed:', e);
      return -1;
    }
  }

  /** Create an axis-aligned box primitive (closed cuboid).
   *  Returns a face ID for Push/Pull operations. Auto-intersects with the
   *  rest of the scene when auto_intersect_on_draw is enabled. */
  create_box(cx: number, cy: number, cz: number, width: number, height: number, depth: number): number {
    if (!this.engine?.create_box) return -1;
    this.markDirty();
    try {
      return this.engine.create_box(cx, cy, cz, width, height, depth);
    } catch (e) {
      console.error('[WasmBridge] create_box failed:', e);
      return -1;
    }
  }
}

export interface OffsetResult {
  ok: boolean;
  error?: string;
  innerFace?: number;
  stripFaces?: number[];
  totalFaces?: number;
  totalVerts?: number;
}

export interface OffsetEdgeResult {
  ok: boolean;
  error?: string;
  newEdge?: number;
  newV0?: number;
  newV1?: number;
}

export interface BooleanResult {
  ok: boolean;
  error?: string;
  op?: string;
  resultFaces?: number[];
  newVerts?: number;
  totalVerts?: number;
  totalFaces?: number;
}

export interface XiaInfo {
  empty: boolean;
  isSolid?: boolean;
  /** Edges with only 1 incident face — open boundary holes */
  boundaryEdges?: number;
  /** Edges with 3+ incident faces — T-junction / self-intersection defects */
  nonManifoldEdges?: number;
  /** Edges with exactly 2 incident faces — manifold interior edges */
  interiorEdges?: number;
  shapeType?: string;
  faceCount?: number;
  vertCount?: number;
  edgeCount?: number;
  snapPoints?: number;
  minX?: number; minY?: number; minZ?: number;
  maxX?: number; maxY?: number; maxZ?: number;
  length?: number;  // mm
  width?: number;   // mm
  height?: number;  // mm
  surfaceArea?: number; // mm²
  volume?: number;      // mm³
}

export interface GroupInfo {
  id: number;
  name: string;
  faceCount: number;
  faceIds: number[];
  parent: number | null;
  children: number[];
  visible: boolean;
  locked: boolean;
  isComponent: boolean;
  error?: string;
}

export interface DxfImportResult {
  ok: boolean;
  error?: string;
  lines?: number;
  polylines?: number;
  circles?: number;
  arcs?: number;
  faces3d?: number;
  solids?: number;
  points?: number;
  ellipses?: number;
  splines?: number;
  inserts?: number;
  skipped?: number;
  errors?: number;
  totalVerts?: number;
  totalFaces?: number;
}
