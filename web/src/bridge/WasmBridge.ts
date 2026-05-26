/**
 * WASM Bridge — Initializes and wraps the Rust AxiaEngine.
 * Includes performance optimizations with buffer caching.
 */

import * as THREE from 'three';
import init, { AxiaEngine } from '../wasm/axia_wasm';
import { Toast } from '../ui/Toast';
import { debugLog } from '../utils/debug';
import type { LayeredChannels, TextureInfo } from '../materials/MaterialLibrary';
import type { LayeredChannelName } from '../viewport/LayeredMaterialBinding';

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

// ═══ ADR-100 R-δ Material Removal Recovery types ═════════════════════
export interface OrphanMaterialEntry {
  xiaId: number;
  staleMaterialId: number;
  faceCount: number;
}

export interface OrphanMaterialReport {
  affectedXias: OrphanMaterialEntry[];
}

export type MaterialRecoveryOutcome =
  | { kind: 'NoOp' }
  | { kind: 'Recovered'; affectedXias: number; facesDemoted: number; facesFallback: number }
  | { kind: 'PartialFailure'; affectedXias: number; remainingOrphans: number };

export type MaterialRemovalResult =
  | { ok: true; removedId: number; recovery: MaterialRecoveryOutcome }
  | { ok: false; error: string };

// ═══ ADR-098 S-γ 3-Tier Material types ═══════════════════════════════
export type MaterialTier = 'System' | 'Project' | 'User';

export interface ScopedMaterialInfo {
  id: number;
  name: string;
  nameEn: string;
  tier: MaterialTier;
  color: string; // "#rrggbb"
}

const TIER_FROM_U32: Record<number, MaterialTier> = {
  0: 'System',
  1: 'Project',
  2: 'User',
};

const TIER_TO_U32: Record<MaterialTier, number> = {
  System: 0,
  Project: 1,
  User: 2,
};

// ═══ ADR-097 T-δ Topology Damage / Auto-Recovery types ═══════════════
export type TopologyDamageKind =
  | { kind: 'BoundaryEdge'; edge_id: number; incident_face: number }
  | { kind: 'NonManifold'; edge_id: number; face_count: number }
  | { kind: 'Degenerate'; face_id: number; reason: string }
  | { kind: 'Orphan'; face_id: number };

export interface TopologyDamageReport {
  damages: TopologyDamageKind[];
  checkedFaces: number;
  checkedEdges: number;
}

export type RecoveryOutcome =
  | { kind: 'NoOp' }
  | { kind: 'Recovered'; fixesApplied: number; initialDamages: number }
  | { kind: 'PartialFailure'; fixesApplied: number; remainingCount: number };

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
  // computeGroundProjectedShadows removed 2026-05-16 (shadow system → ADR-106)
  edgeAngleThreshold?(): number;
  setEdgeAngleThreshold?(deg: number): void;
  // ADR-135 β — Distance-based LOD chord_tol
  renderChordTol?(): number;
  setRenderChordTol?(tol: number): void;
  lodChordTol?(cameraDistance: number): number;

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
  // ADR-139 B-β-2: auto Step 4.99 closed cycle face synthesis toggle
  setAutoFaceSynthesisOnDraw?(enabled: boolean): void;
  getAutoFaceSynthesisOnDraw?(): boolean;
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
  // ADR-040 Stage 2 — analytic ray-to-edge distance
  edgeRayDistance?(
    edgeId: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
  ): Float64Array;
  // ADR-076 Step 2 — Removed `nurbsBoolean?` (ADR-027 Phase G3, legacy
  // probe) and `booleanDispatchDcelJson?` (ADR-064 Step 6-α, single).
  // Both became unreachable after ADR-076 Step 1 removed BooleanHandler
  // call sites. Multi (`booleanDispatchDcelMultiJson?`) handles all
  // production cases — Y-1 1×1 degenerate delegates to the Rust
  // `Mesh::boolean_dispatch_dcel` impl internally (Rust impl preserved).
  // ADR-066 Y-2 — Multi-face DCEL Boolean dispatch (Path Y)
  booleanDispatchDcelMultiJson?(
    facesA: Uint32Array, facesB: Uint32Array, op: string, tolGeometric: number,
  ): string;
  // ADR-078 P-2 — Boolean Group Persistence (typed methods, no JSON)
  setBooleanGroupTag?(faceIds: Uint32Array, tag: string): void;
  getBooleanGroupAFaces?(): Uint32Array;
  getBooleanGroupBFaces?(): Uint32Array;
  clearBooleanGroupTags?(): void;
  hasAnyBooleanGroupTag?(): boolean;
  hasBooleanGroupSelection?(): boolean;
  // ADR-050 P-4 — Shape (form-layer citizenship) typed methods
  createShape?(name: string, faceIds: Uint32Array): number;
  getShapeIds?(): Uint32Array;
  getShapeFaceIds?(shapeId: number): Uint32Array;
  deleteShape?(shapeId: number): boolean;
  clearShapes?(): void;
  promoteShapeToXia?(shapeId: number, materialId: number): number;
  demoteXiaToShape?(xiaId: number): string;
  // ADR-145 β-2 — Circle annulus 명시 promote
  promoteCirclesToAnnulus?(outerFaceId: number, innerFaceId: number): void;
  // ADR-148 β-3 — Point-Localized BoundaryTool (returns face_id)
  boundaryFromPoint?(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    planeDist: number,
    searchRadiusMm: number,
  ): number;
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
  // ADR-088 Phase 1 — curve_owner_id grouping (LOCKED #15 P22.5)
  getEdgeCurveOwnerId?(edgeId: number): number;
  getEdgesByCurveOwner?(ownerId: number): Uint32Array;
  walkFaceOwnerSiblings?(faceId: number): Uint32Array;
  getFaceSurfaceOwnerId?(faceId: number): number;
  setCylinderPathBDefault?(on: boolean): void;
  getCylinderPathBDefault?(): boolean;
  // ADR-104 β-1-ζ — Sphere Path B default flag
  setSpherePathBDefault?(on: boolean): void;
  getSpherePathBDefault?(): boolean;
  // ADR-104 β-2-ζ — Cone Path B default flag
  setConePathBDefault?(on: boolean): void;
  getConePathBDefault?(): boolean;
  // ADR-104 β-3 — Torus Path B kernel-native + default flag
  createTorus?(cx: number, cy: number, cz: number, majorRadius: number, minorRadius: number): number;
  setTorusPathBDefault?(on: boolean): void;
  getTorusPathBDefault?(): boolean;
  // ADR-097 T-δ — Topology damage detection + recovery
  detectTopologyDamage?(): string;
  attemptAutoRecovery?(): string;
  // ADR-098 S-γ — 3-Tier material scope
  listMaterialsByTier?(tier: number): string;
  getMaterialTier?(materialId: number): number;
  addProjectMaterial?(name: string, nameEn: string, color: number): number;
  addUserMaterial?(name: string, nameEn: string, color: number): number;
  removeUserMaterial?(materialId: number): boolean;
  migrateLegacyMaterials?(): number;
  // ADR-100 R-γ — Material removal recovery
  detectOrphanMaterialAssignments?(): string;
  attemptMaterialRemovalRecovery?(): string;
  removeProjectMaterial?(materialId: number): string;
  // ADR-099 L-γ — Layered material 4-PBR channels
  getLayeredChannels?(materialId: number): string;
  setLayeredChannel?(
    materialId: number,
    channel: string,
    dataUrl: string,
    projection: number,
    scale: number,
    rotationOrNan: number,
    label: string,
  ): boolean;
  clearLayeredChannel?(materialId: number, channel: string): boolean;
  migrateLegacyTextureToLayered?(): number;
  hasLayeredMaterial?(materialId: number): boolean;
  // ADR-095 Phase 3-γ — Reference citizenship
  createReferenceConstructionLine?(name: string, edgeIds: Uint32Array): number;
  createReferenceImportedMesh?(name: string, faceIds: Uint32Array, sourcePath?: string): number;
  createReferencePointCloud?(name: string, vertIds: Uint32Array): number;
  getReferenceIds?(): Uint32Array;
  getReferenceJson?(id: number): string;
  deleteReference?(id: number): boolean;
  setReferenceVisible?(id: number, visible: boolean): boolean;
  setReferenceLocked?(id: number, locked: boolean): boolean;
  getFaceReferenceId?(faceId: number): number;
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
  // ADR-140 β — Surface-aware normal evaluation at world position
  faceSurfaceNormalAtPos?(faceId: number, x: number, y: number, z: number): Float64Array;
  // ADR-086 O-γ — Inject external face (STEP/IGES Approach A)
  injectExternalFaceNoSurface?(positionsXyz: Float64Array): number;
  injectExternalFacePlane?(...args: number[]): number;
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

  // ADR-087 K-ζ — `drawLine` / `drawPolyline` legacy bridge wrappers 폐기.
  // `drawLineAsShape` / `drawPolylineAsShape` 가 단일 entry.

  /**
   * ADR-087 K-γ — form-mode polyline. drawPolyline 의 kernel-aware 변형:
   * 각 segment 가 `Command::DrawLineAsShape` 로 실행되어 결과 face (closing
   * loop 합성 시) 에 AnalyticSurface::Plane 자동 attach.
   *
   * 호출자: DrawFreehandTool (ADR-087 K-ε kernel-aware only path), DrawPolylineTool
   * (향후).
   *
   * @param points 평탄화 [x0,y0,z0,x1,y1,z1,…] 배열 (3 의 배수)
   * @param normal optional plane hint — 닫힌 loop face 합성 시 Plane attach.
   *               undefined 또는 zero vector → free-edge planar pipeline 의
   *               default 추론 (best-fit).
   */
  drawPolylineAsShape(
    points: Float64Array | number[],
    normal?: { x: number; y: number; z: number },
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    const arr = points instanceof Float64Array ? points : new Float64Array(points);
    snapPolylineCardinal(arr);
    const nx = normal?.x ?? 0;
    const ny = normal?.y ?? 0;
    const nz = normal?.z ?? 0;
    const fn = (this.engine as unknown as {
      drawPolylineAsShape?: (
        points: Float64Array, nx: number, ny: number, nz: number,
      ) => number;
    }).drawPolylineAsShape;
    if (!fn) return -1;
    return fn.call(this.engine, arr, nx, ny, nz);
  }

  // ADR-087 K-ζ — `drawRect` / `drawCircle` legacy bridge wrappers 폐기.
  // `drawRectAsShape` / `drawCircleAsShape` 가 단일 entry.

  // ════════════════════════════════════════════════════════════════════════
  // ADR-050 P-5c — As-Shape Draw bridge wrappers.
  //
  // Form-layer (Shape) variants of the existing draw* family. Returned
  // value is `ShapeId.raw()` on success or -1 on error. The TS layer
  // can distinguish the two by which method was called — there is no
  // ambient discriminator on the number itself.
  //
  // ADR-026 P12 (Cardinal Plane SSOT) snap is applied identically to
  // the legacy variants, so geometric correctness is invariant across
  // form/property paths.
  //
  // Returns -1 when:
  // - WASM engine missing
  // - WASM endpoint missing (legacy build, fail-soft)
  // - underlying exec_draw_*_as_shape returned an error / wrong variant
  // ════════════════════════════════════════════════════════════════════════

  /**
   * ADR-050 P-5c — Draw a rectangle as a form-layer Shape.
   *
   * Returns ShapeId.raw() on success, -1 on error. Unlike `drawRect`
   * (legacy), this does NOT create a Xia or populate `face_to_xia`;
   * the result is a form citizen (no material). Promotion to Xia is
   * user-driven via `promoteShapeToXia` (ADR-050 P-4).
   */
  drawRectAsShape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    width: number, height: number,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).draw_rect_as_shape;
    if (!fn) return -1;
    this.markDirty();
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    return fn.call(this.engine, cx, cy, cz, nx, ny, nz, ux, uy, uz, width, height);
  }

  /**
   * ADR-050 P-5c — Draw a line as a form-layer Shape.
   *
   * Same dual-mode as `drawLine` (face-closing → face_ids set; free-edge
   * → standalone_edge_id set). Pass `nx=ny=nz=0` for free-edge mode.
   */
  drawLineAsShape(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    nx = 0, ny = 0, nz = 0,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).draw_line_as_shape;
    if (!fn) return -1;
    this.markDirty();
    [x0, y0, z0, x1, y1, z1] = snapCoplanarCardinal6(x0, y0, z0, x1, y1, z1);
    return fn.call(this.engine, x0, y0, z0, x1, y1, z1, nx, ny, nz);
  }

  /**
   * ADR-050 P-5c — Draw a circle as a form-layer Shape.
   *
   * The Arc-curve attachments on the resulting edges (ADR-028) are
   * preserved automatically since they're mesh-level state.
   */
  drawCircleAsShape(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).draw_circle_as_shape;
    if (!fn) return -1;
    this.markDirty();
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    return fn.call(this.engine, cx, cy, cz, nx, ny, nz, radius, segments);
  }

  /**
   * ADR-089 Phase 2 (A-ζ-4) — Draw circle as TRUE kernel-native closed
   * curve. **메타-원칙 #14 의 deepest realization**: 1 anchor vert +
   * 1 self-loop edge with Circle curve + 1 closed-curve face.
   *
   * Drop-in alongside `drawCircleAsShape` (24-segment polygon). No
   * `segments` parameter — analytic curve = formula 1개.
   * Returns ShapeId.raw() on success, -1 on error.
   *
   * Caller (현재): DevTools 직접 호출 또는 향후 DrawCircleTool 의
   * kernel-native flag (A-λ).
   */
  drawCircleAsCurve(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).drawCircleAsCurve;
    if (!fn) return -1;
    this.markDirty();
    [cx, cy, cz] = snapCardinalCenter(cx, cy, cz, nx, ny, nz);
    return fn.call(this.engine, cx, cy, cz, nx, ny, nz, radius);
  }

  /**
   * ADR-089 A-ω-γ — Atomic closed Bezier creation with curve attach.
   *
   * `controlPts` flat: 3·n floats. `controlPts[0..3]` and `controlPts
   * [last 3]` must be approximately equal (closure check). Creates 1
   * anchor + 1 self-loop edge with `AnalyticCurve::Bezier` + 1 face
   * with Plane surface attached (best-fit plane normal).
   *
   * Returns shape_id on success, -1 on error.
   */
  drawClosedBezierAsCurve(
    controlPts: Float64Array | number[],
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).drawClosedBezierAsCurve;
    if (!fn) return -1;
    this.markDirty();
    const flat = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    return fn.call(this.engine, flat);
  }

  /**
   * ADR-089 A-Α-γ — Atomic closed BSpline creation with curve attach.
   *
   * Caller passes flat control points + knots vector + degree.
   * `controlPts[0]` and `controlPts[last]` must be approximately equal
   * (clamped knots closure). Periodic knot vector deferred to future ADR.
   *
   * Returns shape_id on success, -1 on error.
   */
  drawClosedBSplineAsCurve(
    controlPts: Float64Array | number[],
    knots: Float64Array | number[],
    degree: number,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).drawClosedBSplineAsCurve;
    if (!fn) return -1;
    this.markDirty();
    const ctrlFlat = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    const knotsFlat = knots instanceof Float64Array
      ? knots : new Float64Array(knots);
    return fn.call(this.engine, ctrlFlat, knotsFlat, degree);
  }

  /**
   * ADR-089 A-Β-γ — Atomic closed NURBS creation (rational BSpline +
   * weights). All weights must be > 0. control_pts[0] ≈ control_pts
   * [last] (clamped knots closure). Returns shape_id, -1 on error.
   */
  drawClosedNURBSAsCurve(
    controlPts: Float64Array | number[],
    weights: Float64Array | number[],
    knots: Float64Array | number[],
    degree: number,
  ): number {
    if (!this.engine) return -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).drawClosedNURBSAsCurve;
    if (!fn) return -1;
    this.markDirty();
    const ctrlFlat = controlPts instanceof Float64Array
      ? controlPts : new Float64Array(controlPts);
    const weightsFlat = weights instanceof Float64Array
      ? weights : new Float64Array(weights);
    const knotsFlat = knots instanceof Float64Array
      ? knots : new Float64Array(knots);
    return fn.call(this.engine, ctrlFlat, weightsFlat, knotsFlat, degree);
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
   * ADR-040 Stage 2 — Analytic ray ↔ edge distance.
   *
   * For an edge with an attached AnalyticCurve, returns the perpendicular
   * distance (mm) from the cursor ray line to the closest point on the
   * curve, plus that point. Returns `null` when:
   *   - edge has no analytic curve (plain LINE without curve attachment)
   *   - WASM engine missing
   *   - Newton diverged (caller should fall back to polyline BVH per P25.4)
   *
   * `rayDir` MUST be unit length — caller's responsibility to normalise.
   */
  edgeRayDistance(
    edgeId: number,
    rayOrigin: { x: number; y: number; z: number },
    rayDir: { x: number; y: number; z: number },
  ): { distance: number; point: { x: number; y: number; z: number }; t: number } | null {
    if (!this.engine || !this.engine.edgeRayDistance) return null;
    const result = this.engine.edgeRayDistance(
      edgeId,
      rayOrigin.x, rayOrigin.y, rayOrigin.z,
      rayDir.x, rayDir.y, rayDir.z,
    );
    const arr = result instanceof Float64Array
      ? result
      : new Float64Array(result as number[]);
    if (arr.length !== 5) return null;
    return {
      distance: arr[0]!,
      point: { x: arr[1]!, y: arr[2]!, z: arr[3]! },
      t: arr[4]!,
    };
  }

  // ADR-076 Step 2 — Removed:
  // - WasmBridge.nurbsBoolean() (legacy ADR-027 Phase G3 probe)
  // - WasmBridge.booleanDispatchDcel() (single-face Path Z, ADR-064 Step 6-β)
  // Both wrappers became unreachable when ADR-076 Step 1 deleted the
  // BooleanHandler call sites. Y-1 1×1 degenerate handles the same case
  // via Path Z internally (multi delegates to Mesh::boolean_dispatch_dcel
  // in Rust — preserved). The corresponding WASM exports
  // (booleanDispatchDcelJson / nurbsBoolean) and TS types
  // (NurbsBooleanResult, BooleanDispatchDcelResult) also removed.

  /**
   * ADR-066 Y-3 (Path Y) — Multi-face DCEL Boolean dispatch wrapper.
   *
   * Routes through `Mesh::boolean_dispatch_dcel_multi` (Y-1) which
   * iterates the cartesian product `facesA × facesB` and accumulates
   * per-pair outcomes plus aggregate `allNewFaces` / `allRemovedFaces`.
   *
   * Per Y-E strict: ANY face missing surface or unsupported kind →
   * `pathUsed: 'Mesh'` upfront with `perPair`/aggregates empty +
   * `fallbackReason` populated. Caller decides next step (no auto
   * mesh fallback).
   *
   * @param facesA, facesB — face IDs (multi-face per Y-1; 1×1 delegates
   *   to Path Z `boolean_dispatch_dcel` internally)
   * @param op — Boolean operation
   * @param tolGeometric — geometric tolerance in mm (default 1e-3 per
   *   ADR-064 D-AD / Y-3-i)
   *
   * @returns
   * - `null` — WASM not loaded or `booleanDispatchDcelMultiJson` not exposed
   * - `{ kind: 'ok', pathUsed, perPair, allNewFaces, allRemovedFaces,
   *      warnings, ... }` — engine succeeded
   * - `{ kind: 'error', reason, detail }` — invalidOp / engineErr / parse
   */
  booleanDispatchDcelMulti(
    facesA: number[],
    facesB: number[],
    op: 'union' | 'subtract' | 'intersect',
    tolGeometric: number = 1e-3,
  ): BooleanDispatchDcelMultiResult | null {
    if (!this.engine || !this.engine.booleanDispatchDcelMultiJson) return null;
    // Y-3-f markDirty — topology will change on Nurbs path success.
    this.markDirty();
    // Y-3-j: number[] in / Uint32Array out (wasm-bindgen marshalling).
    const json = this.engine.booleanDispatchDcelMultiJson(
      Uint32Array.from(facesA),
      Uint32Array.from(facesB),
      op,
      tolGeometric,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { kind: 'error', reason: 'parse', detail: 'engine returned non-JSON' };
    }
    const env = parsed as {
      ok?: boolean; error?: string;
      pathUsed?: string;
      fallbackReason?: BooleanDispatchFallbackReason | null;
      perPair?: PerPairDcelEntry[];
      allNewFaces?: number[];
      allRemovedFaces?: number[];
      warnings?: string[];
    };
    if (env.ok === false) {
      const detail = env.error ?? 'unknown engine error';
      const reason: BooleanDispatchDcelErrorReason =
        detail.includes('invalid op') ? 'invalidOp' : 'engineErr';
      return { kind: 'error', reason, detail };
    }
    if (env.ok === true && typeof env.pathUsed === 'string') {
      return {
        kind: 'ok',
        pathUsed: env.pathUsed as BooleanDispatchPath,
        fallbackReason: env.fallbackReason ?? null,
        perPair: env.perPair ?? [],
        allNewFaces: env.allNewFaces ?? [],
        allRemovedFaces: env.allRemovedFaces ?? [],
        warnings: env.warnings ?? [],
      };
    }
    return {
      kind: 'error', reason: 'parse',
      detail: 'engine response missing required fields',
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-078 P-2 — Boolean Group Persistence typed wrappers
  //
  // Rust `Scene::boolean_group_tags` (P-1) 의 typed surface. TS U-1
  // SelectionManager (runtime UI state) 와 별도 — 본 wrappers 는
  // *project-persistent* group state 를 다룸. P-3 (별도) 가 두 storage
  // 동기화 (load 시 SelectionManager 갱신).
  //
  // Per ADR-078 §B P-2 lock-ins:
  // - P-2-h tag: 'A' | 'B' literal (TS U-1 SelectionManager 와 일관)
  // - P-2-d number[] → Uint32Array (wasm-bindgen marshalling)
  // - P-2-c invalid tag → throws (Rust Err<JsValue> propagates)
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-078 P-2 — Tag faces as Boolean Group A or B (project-persistent).
   * @throws if WASM exports the engine's Err (e.g., invalid tag).
   */
  setBooleanGroupTag(faceIds: number[], tag: 'A' | 'B'): void {
    if (!this.engine || !this.engine.setBooleanGroupTag) return;
    this.markDirty();
    this.engine.setBooleanGroupTag(Uint32Array.from(faceIds), tag);
  }

  /**
   * ADR-078 P-2 — Returns face IDs tagged Group A (sorted ascending).
   * Empty array if engine unavailable.
   */
  getBooleanGroupAFaces(): number[] {
    if (!this.engine || !this.engine.getBooleanGroupAFaces) return [];
    return Array.from(this.engine.getBooleanGroupAFaces());
  }

  /**
   * ADR-078 P-2 — Returns face IDs tagged Group B (sorted ascending).
   */
  getBooleanGroupBFaces(): number[] {
    if (!this.engine || !this.engine.getBooleanGroupBFaces) return [];
    return Array.from(this.engine.getBooleanGroupBFaces());
  }

  /**
   * ADR-078 P-2 — Clear all Boolean group tags (project-persistent).
   */
  clearBooleanGroupTags(): void {
    if (!this.engine || !this.engine.clearBooleanGroupTags) return;
    this.markDirty();
    this.engine.clearBooleanGroupTags();
  }

  /**
   * ADR-078 P-2 — True iff at least one face has a Boolean group tag.
   * Used by UI for Clear-menu visibility (mirror of TS U-2 `hasAnyGroupTag`).
   */
  hasAnyBooleanGroupTag(): boolean {
    if (!this.engine || !this.engine.hasAnyBooleanGroupTag) return false;
    return this.engine.hasAnyBooleanGroupTag();
  }

  /**
   * ADR-078 P-2 — True iff BOTH Group A and Group B have ≥1 tagged face.
   * Used by routing decisions (mirror of TS U-3 `hasGroupSelection`).
   */
  hasBooleanGroupSelection(): boolean {
    if (!this.engine || !this.engine.hasBooleanGroupSelection) return false;
    return this.engine.hasBooleanGroupSelection();
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-050 P-4 — Shape (form-layer citizenship) typed wrappers.
  //
  // Per ADR-050 §B P-4 lock-ins (mirroring ADR-078 P-2):
  //   - number[] in / out (TS-side ergonomic — Uint32Array conversion
  //     happens at the bridge boundary)
  //   - Graceful no-op when WASM doesn't expose the endpoint (legacy
  //     build / older snapshot)
  //   - markDirty() invalidates buffer cache on all mutators
  //   - promoteShapeToXia THROWS on validation failure (strict — silent
  //     skip 차단). Caller should surround with try/catch and surface
  //     PromoteError text to UI Toast.
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-050 P-4 — Create a new form-layer Shape. Returns the new
   * ShapeId, or 0 if the bridge endpoint is missing (legacy build).
   *
   * The Shape has no material (form layer) — `promoteShapeToXia` is
   * the gateway to property layer (Xia) once material is assigned and
   * 4-condition check passes (재질 / 부피 / 닫힘 / manifold).
   */
  createShape(name: string, faceIds: number[]): number {
    if (!this.engine || !this.engine.createShape) return 0;
    this.markDirty();
    return this.engine.createShape(name, Uint32Array.from(faceIds));
  }

  /**
   * ADR-050 P-4 — All currently stored Shape IDs (sorted ascending).
   * Returns empty array on missing endpoint.
   */
  getShapeIds(): number[] {
    if (!this.engine || !this.engine.getShapeIds) return [];
    return Array.from(this.engine.getShapeIds());
  }

  /**
   * ADR-050 P-4 — Face IDs owned by a given Shape. Empty if the
   * Shape doesn't exist (graceful — caller may have stale ID).
   */
  getShapeFaceIds(shapeId: number): number[] {
    if (!this.engine || !this.engine.getShapeFaceIds) return [];
    return Array.from(this.engine.getShapeFaceIds(shapeId));
  }

  /**
   * ADR-050 P-4 — Delete a Shape. Returns true if deleted, false if
   * the Shape didn't exist or the endpoint is missing.
   */
  deleteShape(shapeId: number): boolean {
    if (!this.engine || !this.engine.deleteShape) return false;
    this.markDirty();
    return this.engine.deleteShape(shapeId);
  }

  /**
   * ADR-050 P-4 — Clear all Shapes. No-op on missing endpoint.
   */
  clearShapes(): void {
    if (!this.engine || !this.engine.clearShapes) return;
    this.markDirty();
    this.engine.clearShapes();
  }

  /**
   * ADR-050 P-4 — Promote a Shape to a Xia via 4-condition validation.
   *
   * On success: returns the new XiaId.
   * On failure: throws (strict — silent skip 차단, P-2-c lock-in 답습).
   *   Caller wraps in try/catch and surfaces error text to Toast.
   *
   * Throws if the WASM endpoint is missing (legacy build) — this is
   * a feature gate, not graceful no-op, since the caller is asking
   * for a state transition that requires the endpoint.
   */
  promoteShapeToXia(shapeId: number, materialId: number): number {
    if (!this.engine || !this.engine.promoteShapeToXia) {
      throw new Error('promoteShapeToXia: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    return this.engine.promoteShapeToXia(shapeId, materialId);
  }

  /**
   * ADR-091 D-γ — Demote a Xia back to a Shape (form layer) when its
   * material has been reverted to the form-layer sentinel
   * (`FORM_MATERIAL`, MaterialId::new(0)).
   *
   * On success: returns `{ shapeId, originalIdRestored }` where
   *   - `shapeId` is the resulting form-layer ID (original restored if
   *     `originalIdRestored === true`, otherwise freshly allocated)
   *   - `originalIdRestored` is true iff the Xia was originally
   *     promoted from a Shape and that ShapeId was reused
   *
   * Throws (strict — D-γ lock-in answering D-A=a):
   *   - WASM endpoint missing (legacy build) — feature gate, not
   *     graceful no-op
   *   - Xia not found
   *   - Material is not the FORM_MATERIAL sentinel — caller must
   *     clear the material first via Inspector
   *
   * Caller wraps in try/catch and surfaces DemoteError text to Toast.
   */
  demoteXiaToShape(xiaId: number): { shapeId: number; originalIdRestored: boolean } {
    if (!this.engine || !this.engine.demoteXiaToShape) {
      throw new Error('demoteXiaToShape: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    const json = this.engine.demoteXiaToShape(xiaId);
    const parsed = JSON.parse(json) as { shape_id: number; original_id_restored: boolean };
    return {
      shapeId: parsed.shape_id,
      originalIdRestored: parsed.original_id_restored,
    };
  }

  /**
   * ADR-145 β-3 — Promote two coplanar Circle faces (outer + inner) to an
   * annulus (outer with inner hole).
   *
   * **사용자 명시 trigger only** (메타-원칙 #16) — 휴리스틱 자동 detect
   * 안 됨. 우클릭 ContextMenu "annulus 만들기" 후 호출 (β-4 pending).
   *
   * WASM endpoint: `promoteCirclesToAnnulus(outerFaceId, innerFaceId)`
   *   - Returns `void` on success (silent promote OK)
   *   - Throws on failure (AnnulusError Display, e.g. "promoteCirclesToAnnulus:
   *     inner Circle not fully contained in outer Circle ...")
   *
   * Throws (strict — silent skip 차단, ADR-091 D-γ pattern 답습):
   *   - WASM endpoint missing (legacy build) — feature gate, not graceful no-op
   *   - InactiveFace — outer 또는 inner not found / inactive
   *   - NotCircleFace — 둘 다 closed-curve Circle face 아님
   *   - NotCoplanar — 다른 평면 (LOCKED #5 1.5μm tolerance)
   *   - InnerNotContained — inner Circle 이 outer 안 contained 안 됨
   *
   * Caller wraps in try/catch and surfaces error text to Toast.
   *
   * Transaction-wrapped (Engine layer, axia-wasm) — Undo restores the
   * pre-promote state (inner face active + outer face 0 holes).
   *
   * @param outerFaceId - The larger Circle face (will become the annulus outer)
   * @param innerFaceId - The smaller Circle face (will become the annulus hole)
   */
  promoteCirclesToAnnulus(outerFaceId: number, innerFaceId: number): void {
    if (!this.engine || !this.engine.promoteCirclesToAnnulus) {
      throw new Error('promoteCirclesToAnnulus: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    this.engine.promoteCirclesToAnnulus(outerFaceId, innerFaceId);
  }

  /**
   * ADR-148 β-3 — Point-Localized BoundaryTool TS wrapper.
   *
   * CAD 표준 BOUNDARY 명령 equivalent — 사용자가 영역 내부의 한 점을
   * 클릭하면 그 점을 둘러싼 가장 작은 boundary loop 검출 → face 합성.
   *
   * **사용자 명시 trigger only** (메타-원칙 #16) — 휴리스틱 자동
   * activation 0. UI BoundaryTool (β-4, Ctrl+B) 클릭 후 호출.
   *
   * Engine API: `axia_geo::operations::boundary::boundary_from_point`
   * (β-1 skeleton, PR #184 + β-2 algorithm, PR #185).
   *
   * @param px - World-space X
   * @param py - World-space Y
   * @param pz - World-space Z
   * @param nx - Plane normal X
   * @param ny - Plane normal Y
   * @param nz - Plane normal Z
   * @param planeDist - Plane equation `normal · p = dist` (signed)
   * @param searchRadiusMm - BVH/linear scan radius (mm). ≤0 → default 1000mm
   * @returns face_id of synthesized boundary face
   * @throws Error on validation failure:
   *   - "boundaryFromPoint: PointNotOnPlane (distance Nmm)"
   *   - "boundaryFromPoint: NoOrphanEdgesInRadius (radius Rmm)"
   *   - "boundaryFromPoint: NoEnclosingCycle"
   *   - "boundaryFromPoint: CycleAlreadyFaced (face N)"
   *
   * Caller wraps in try/catch and surfaces error text to Toast.
   *
   * Transaction-wrapped (Engine layer, axia-wasm) — Undo restores the
   * pre-synthesis state.
   */
  boundaryFromPoint(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    planeDist: number,
    searchRadiusMm: number,
  ): number {
    if (!this.engine || !this.engine.boundaryFromPoint) {
      throw new Error('boundaryFromPoint: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    return this.engine.boundaryFromPoint(
      px, py, pz, nx, ny, nz, planeDist, searchRadiusMm,
    );
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
   * ADR-088 Phase 1 (S-δ) — Read curve owner group ID for an edge
   * (LOCKED #15 P22.5 enforcement support).
   *
   * Returns:
   * - `>= 0`: edge belongs to an analytic curve group (e.g., one of N
   *   segments of a Circle). Use `getEdgesByCurveOwner` to fetch all
   *   segments sharing this id.
   * - `-1`: edge is single-segment (no group), or invalid/inactive.
   *
   * Caller (SelectTool walk): if owner_id >= 0, promote selection to all
   * segments of the same logical analytic curve.
   */
  getEdgeCurveOwnerId(edgeId: number): number {
    if (!this.engine) return -1;
    const fn = this.engine.getEdgeCurveOwnerId;
    if (!fn) return -1;
    return fn.call(this.engine, edgeId);
  }

  /**
   * ADR-088 Phase 1 (S-δ) — Get all active edges sharing a curve owner
   * group ID (LOCKED #15 P22.5).
   *
   * Returns empty array if no edges match (defensive against stale id
   * after undo / erase / cascade). Use after `getEdgeCurveOwnerId`
   * returns >= 0.
   */
  getEdgesByCurveOwner(ownerId: number): number[] {
    if (!this.engine) return [];
    const fn = this.engine.getEdgesByCurveOwner;
    if (!fn) return [];
    const result = fn.call(this.engine, ownerId);
    return Array.from(result);
  }

  /**
   * ADR-093 D-γ — Walk face owner-siblings (Cylinder side group).
   *
   * Selection-layer entry point: given a clicked face, returns all
   * active faces sharing its `surface_owner_id`. If the face has no
   * owner-id, returns just `[faceId]` (single-face selection unchanged
   * — additive only per Lock-in D-D).
   *
   * Graceful fallback when WASM endpoint missing (legacy build): returns
   * `[faceId]` so SelectTool degrades to single-face selection without
   * throw.
   */
  walkFaceOwnerSiblings(faceId: number): number[] {
    if (!this.engine) return [faceId];
    const fn = this.engine.walkFaceOwnerSiblings;
    if (!fn) return [faceId];
    const result = fn.call(this.engine, faceId);
    return Array.from(result);
  }

  /**
   * ADR-093 D-γ — Read the surface owner-id of a face.
   *
   * Returns -1 if face has no owner-id (standalone) OR is missing /
   * inactive OR endpoint unavailable. Mirrors `getEdgeCurveOwnerId`
   * from ADR-088.
   */
  getFaceSurfaceOwnerId(faceId: number): number {
    if (!this.engine) return -1;
    const fn = this.engine.getFaceSurfaceOwnerId;
    if (!fn) return -1;
    return fn.call(this.engine, faceId);
  }

  /**
   * ADR-094 B-η — Set the Path B cylinder default.
   *
   * `true` = closed-curve cylinder profile produces 3 face / 2 edge /
   * 2 vert annulus (산업 CAD parity, ~98% 메모리 절감).
   * `false` = legacy Path A (25 face polygon strip).
   *
   * Call once at app init based on user preference (localStorage
   * `axia:cylinder-path-b-mode`). ADR-049 P-5e-α 답습 패턴.
   *
   * Graceful no-op when WASM endpoint missing (legacy build).
   */
  setCylinderPathBDefault(on: boolean): void {
    if (!this.engine) return;
    const fn = this.engine.setCylinderPathBDefault;
    if (!fn) return;
    fn.call(this.engine, on);
  }

  /**
   * ADR-094 B-η — Read the Path B cylinder default flag.
   * Returns false on missing endpoint (legacy default).
   */
  getCylinderPathBDefault(): boolean {
    if (!this.engine) return false;
    const fn = this.engine.getCylinderPathBDefault;
    if (!fn) return false;
    return fn.call(this.engine);
  }

  /**
   * ADR-104 β-1-ζ — Set the Path B sphere default flag.
   *
   * `true` = `create_sphere` 가 kernel-native 2 hemisphere / 1 equator
   * edge / 1 vert canonical 로 분기 (산업 CAD parity, 99%+ 메모리 절감).
   * `false` = legacy Path A (289 face default polygonal mesh).
   *
   * Call once at app init based on user preference (localStorage
   * `axia:sphere-path-b-mode`). ADR-049 P-5e-α / ADR-094 B-η 답습 패턴.
   *
   * Graceful no-op when WASM endpoint missing (legacy build).
   */
  setSpherePathBDefault(on: boolean): void {
    if (!this.engine) return;
    const fn = this.engine.setSpherePathBDefault;
    if (!fn) return;
    fn.call(this.engine, on);
  }

  /**
   * ADR-104 β-1-ζ — Read the Path B sphere default flag.
   * Returns false on missing endpoint (legacy default).
   */
  getSpherePathBDefault(): boolean {
    if (!this.engine) return false;
    const fn = this.engine.getSpherePathBDefault;
    if (!fn) return false;
    return fn.call(this.engine);
  }

  /**
   * ADR-104 β-2-ζ — Set the Path B cone default flag.
   *
   * `true` = `create_cone` 가 kernel-native 2 face / 1 edge / 1 vert
   * canonical 로 분기 (산업 CAD parity, ~92% 메모리 절감).
   * `false` = legacy Path A (~25 face polygonal cone).
   *
   * Call once at app init based on user preference (localStorage
   * `axia:cone-path-b-mode`). ADR-049 P-5e-α / ADR-094 B-η / ADR-113
   * 답습 패턴. Graceful no-op when WASM endpoint missing.
   */
  setConePathBDefault(on: boolean): void {
    if (!this.engine) return;
    const fn = this.engine.setConePathBDefault;
    if (!fn) return;
    fn.call(this.engine, on);
  }

  /**
   * ADR-104 β-2-ζ — Read the Path B cone default flag.
   * Returns false on missing endpoint (legacy default).
   */
  getConePathBDefault(): boolean {
    if (!this.engine) return false;
    const fn = this.engine.getConePathBDefault;
    if (!fn) return false;
    return fn.call(this.engine);
  }

  /**
   * ADR-104 β-3-β — Create torus (Path B kernel-native, Q3 revision).
   *
   * 1 face / 1 edge / 1 vert canonical (sphere/cone self-loop pattern
   * 답습). ~99.7% memory reduction vs hypothetical Path A polygonal
   * torus (no Path A baseline exists — kernel-native from day 1).
   *
   * Returns the FaceId of the single torus surface, or `-1` on error.
   */
  create_torus(
    cx: number, cy: number, cz: number,
    majorRadius: number, minorRadius: number,
  ): number {
    if (!this.engine || !this.engine.createTorus) return -1;
    this.markDirty();
    return this.engine.createTorus(cx, cy, cz, majorRadius, minorRadius);
  }

  /**
   * ADR-104 β-3-ζ — Set the Path B torus default flag.
   *
   * Note: Torus has no Path A polygonal baseline. Flag exists for
   * pattern consistency with sphere/cone. Graceful no-op when WASM
   * endpoint missing.
   */
  setTorusPathBDefault(on: boolean): void {
    if (!this.engine) return;
    const fn = this.engine.setTorusPathBDefault;
    if (!fn) return;
    fn.call(this.engine, on);
  }

  /**
   * ADR-104 β-3-ζ — Read the Path B torus default flag.
   * Returns false on missing endpoint.
   */
  getTorusPathBDefault(): boolean {
    if (!this.engine) return false;
    const fn = this.engine.getTorusPathBDefault;
    if (!fn) return false;
    return fn.call(this.engine);
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-097 T-δ — Topology damage detection + recovery
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-097 T-γ — Detect topology damage. Parses JSON from engine.
   * Returns null on missing endpoint (graceful — legacy build).
   */
  detectTopologyDamage(): TopologyDamageReport | null {
    if (!this.engine || !this.engine.detectTopologyDamage) return null;
    const json = this.engine.detectTopologyDamage();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      return {
        damages: parsed.damages,
        checkedFaces: parsed.checkedFaces,
        checkedEdges: parsed.checkedEdges,
      };
    } catch {
      return null;
    }
  }

  /**
   * ADR-097 T-γ — Attempt auto-recovery dispatcher. Returns parsed
   * RecoveryOutcome union. null on missing endpoint.
   */
  attemptAutoRecovery(): RecoveryOutcome | null {
    if (!this.engine || !this.engine.attemptAutoRecovery) return null;
    this.markDirty();
    const json = this.engine.attemptAutoRecovery();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      switch (parsed.kind) {
        case 'NoOp':
          return { kind: 'NoOp' };
        case 'Recovered':
          return {
            kind: 'Recovered',
            fixesApplied: parsed.fixesApplied,
            initialDamages: parsed.initialDamages,
          };
        case 'PartialFailure':
          return {
            kind: 'PartialFailure',
            fixesApplied: parsed.fixesApplied,
            remainingCount: parsed.remainingCount,
          };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-095 Phase 3-γ — Reference 시민권 (Two-Layer Phase 3) bridge
  //
  // 3 categories: ConstructionLine / ImportedMesh / PointCloud.
  // Mutual exclusive geometry ownership 강제 — Form/Property 충돌 시
  // strict throw (silent skip 차단).
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-095 Phase 3-γ — Create a ConstructionLine Reference.
   *
   * Returns the new ReferenceId on success. Throws if endpoint missing
   * (feature gate) or R-B violation (edge already in Reference — engine
   * propagates JS Error with rejection reason).
   */
  createReferenceConstructionLine(name: string, edgeIds: number[]): number {
    if (!this.engine || !this.engine.createReferenceConstructionLine) {
      throw new Error('createReferenceConstructionLine: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    return this.engine.createReferenceConstructionLine(name, Uint32Array.from(edgeIds));
  }

  /**
   * ADR-095 Phase 3-γ — Create an ImportedMesh Reference.
   * Throws on R-B violation (face owned by Form/Property).
   */
  createReferenceImportedMesh(
    name: string, faceIds: number[], sourcePath?: string,
  ): number {
    if (!this.engine || !this.engine.createReferenceImportedMesh) {
      throw new Error('createReferenceImportedMesh: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    return this.engine.createReferenceImportedMesh(
      name, Uint32Array.from(faceIds), sourcePath,
    );
  }

  /**
   * ADR-095 Phase 3-γ — Create a PointCloud Reference.
   * Throws on R-B violation.
   */
  createReferencePointCloud(name: string, vertIds: number[]): number {
    if (!this.engine || !this.engine.createReferencePointCloud) {
      throw new Error('createReferencePointCloud: WASM endpoint missing (rebuild required)');
    }
    this.markDirty();
    return this.engine.createReferencePointCloud(name, Uint32Array.from(vertIds));
  }

  /**
   * ADR-095 Phase 3-γ — All currently-stored Reference IDs (sorted
   * ascending). Returns empty array on missing endpoint.
   */
  getReferenceIds(): number[] {
    if (!this.engine || !this.engine.getReferenceIds) return [];
    return Array.from(this.engine.getReferenceIds());
  }

  /**
   * ADR-095 Phase 3-γ — Read a Reference by id, parsed from JSON.
   * Returns null if id missing or endpoint unavailable.
   */
  getReference(id: number): {
    id: number;
    name: string;
    category:
      | { kind: 'ConstructionLine'; edgeIds: number[] }
      | { kind: 'ImportedMesh'; faceIds: number[]; sourcePath: string | null }
      | { kind: 'PointCloud'; vertIds: number[] };
    visible: boolean;
    locked: boolean;
  } | null {
    if (!this.engine || !this.engine.getReferenceJson) return null;
    const json = this.engine.getReferenceJson(id);
    if (!json) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      const cat = parsed.category;
      let category;
      if (cat.kind === 'ConstructionLine') {
        category = { kind: 'ConstructionLine' as const, edgeIds: cat.edge_ids };
      } else if (cat.kind === 'ImportedMesh') {
        category = {
          kind: 'ImportedMesh' as const,
          faceIds: cat.face_ids,
          sourcePath: cat.source_path,
        };
      } else if (cat.kind === 'PointCloud') {
        category = { kind: 'PointCloud' as const, vertIds: cat.vert_ids };
      } else {
        return null;
      }
      return {
        id: parsed.id,
        name: parsed.name,
        category,
        visible: parsed.visible,
        locked: parsed.locked,
      };
    } catch {
      return null;
    }
  }

  /**
   * ADR-095 Phase 3-γ — Delete a Reference. Returns false on missing
   * endpoint or non-existent id.
   */
  deleteReference(id: number): boolean {
    if (!this.engine || !this.engine.deleteReference) return false;
    this.markDirty();
    return this.engine.deleteReference(id);
  }

  /**
   * ADR-095 Phase 3-γ — Toggle Reference visibility. Returns false on
   * missing endpoint or non-existent id.
   */
  setReferenceVisible(id: number, visible: boolean): boolean {
    if (!this.engine || !this.engine.setReferenceVisible) return false;
    this.markDirty();
    return this.engine.setReferenceVisible(id, visible);
  }

  /**
   * ADR-095 Phase 3-γ — Toggle Reference locked. Returns false on
   * missing endpoint or non-existent id.
   */
  setReferenceLocked(id: number, locked: boolean): boolean {
    if (!this.engine || !this.engine.setReferenceLocked) return false;
    this.markDirty();
    return this.engine.setReferenceLocked(id, locked);
  }

  /**
   * ADR-095 Phase 3-γ — Reverse lookup: get Reference ID owning a face.
   * Returns -1 if face is not part of any Reference (or endpoint missing).
   */
  getFaceReferenceId(faceId: number): number {
    if (!this.engine || !this.engine.getFaceReferenceId) return -1;
    return this.engine.getFaceReferenceId(faceId);
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

  /**
   * Surface-aware normal evaluation at world position (ADR-140 γ).
   *
   * Forwards to WASM `faceSurfaceNormalAtPos` export (ADR-140 β, PR #147).
   * Enables surface-aware `getDrawPlane(faceId, hitPoint)` — the tool
   * input layer 1:1 mirror of ADR-038 P23 surface-aware normals (render
   * layer). Cylinder/Sphere/Cone/Torus/NURBS surface 위 사용자 click 의
   * tangent plane evaluation (chord fallback 회피).
   *
   * Returns `null` in the following cases (graceful failure):
   * - Engine is unavailable (`this.engine == null`)
   * - WASM export missing (legacy build / mock — defensive guard)
   * - Face has no analytic surface (`face_surface(fid) == None`)
   * - Surface evaluation at position is degenerate (e.g., cone apex,
   *   zero-normal — Rust filters via `length_squared() < 1e-20`)
   * - WASM returns malformed length (defensive — must be exactly 3)
   *
   * @param faceId - axia FaceId
   * @param x, y, z - World position (typically a raycast hit point on the face)
   * @returns Unit normal `[nx, ny, nz]` (Float64Array of length 3), or
   *   `null` on any failure mode above
   */
  faceSurfaceNormalAtPos(
    faceId: number,
    x: number,
    y: number,
    z: number,
  ): Float64Array | null {
    if (!this.engine) return null;
    const fn = (this.engine as unknown as {
      faceSurfaceNormalAtPos?: (id: number, x: number, y: number, z: number) => Float64Array;
    }).faceSurfaceNormalAtPos;
    if (!fn) return null;
    const result = fn.call(this.engine, faceId, x, y, z);
    if (!result || result.length === 0) return null;
    if (result.length !== 3) return null;  // defensive — Rust always returns 0 or 3
    return result instanceof Float64Array ? result : new Float64Array(result as number[]);
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADR-086 O-γ — Inject External Face (STEP/IGES Approach A)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Caller (StepIgesImporter integration, O-δ) 가 BRep traversal 의
  // stable index → axia FaceId map 에 결과를 저장. Return -1 on error.

  /**
   * Inject an external face boundary into axia DCEL — no analytic surface.
   *
   * 사용 시나리오: STEP face 의 surface 가 promoteSurface 에서 Tessellate
   * fallback 으로 떨어진 경우 (W-3-ε deferred / unsupported).
   *
   * @param positionsXyz - Flat outer boundary points (`xyz × N`, N>=3).
   *   First point != last (loop closure implicit).
   * @returns FaceId.raw() on success, -1 on error.
   */
  injectExternalFaceNoSurface(positionsXyz: Float64Array): number {
    if (!this.engine) return -1;
    const fn = (this.engine as unknown as {
      injectExternalFaceNoSurface?: (pts: Float64Array) => number;
    }).injectExternalFaceNoSurface;
    if (!fn) return -1;
    this.markDirty();
    return fn.call(this.engine, positionsXyz);
  }

  /**
   * Inject an external face boundary into axia DCEL — with Plane surface.
   *
   * 사용 시나리오: STEP face 의 surface 가 promoteSurface 에서 Plane variant
   * 로 promote 된 경우 (W-γ direct mapping 5 중 가장 흔함).
   *
   * @param positionsXyz - Flat outer boundary points (`xyz × N`, N>=3).
   * @param origin - Plane origin
   * @param normal - Plane normal direction
   * @param basisU - Plane reference U direction
   * @returns FaceId.raw() on success, -1 on error.
   */
  injectExternalFacePlane(
    positionsXyz: Float64Array,
    origin: [number, number, number],
    normal: [number, number, number],
    basisU: [number, number, number],
  ): number {
    if (!this.engine) return -1;
    const fn = (this.engine as unknown as {
      injectExternalFacePlane?: (...args: number[]) => number;
    }).injectExternalFacePlane;
    if (!fn) return -1;
    this.markDirty();
    // WASM signature: (positions, ox, oy, oz, nx, ny, nz, ux, uy, uz)
    // wasm-bindgen Float64Array 인자는 first positional — rest 는 numbers
    // 우회: spread 형태로 호출 (wasm-bindgen 의 ...args[number] 시그니처 답습)
    // ADR-099 follow-up: TS strict-mode cast safety — `as unknown` first
    // (wasm-bindgen `(...args: number[]) => number` ↔ our typed signature
    // don't overlap directly, but the runtime call IS the typed signature).
    return (fn as unknown as (
      pts: Float64Array,
      ox: number, oy: number, oz: number,
      nx: number, ny: number, nz: number,
      ux: number, uy: number, uz: number,
    ) => number).call(
      this.engine,
      positionsXyz,
      origin[0], origin[1], origin[2],
      normal[0], normal[1], normal[2],
      basisU[0], basisU[1], basisU[2],
    );
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

  // ADR-087 K-ζ — `pushPull` legacy bridge wrapper 폐기.
  // `createSolidExtrude` 가 단일 entry (Q3 fallback Rust 측 자동).

  /**
   * ADR-079 W-1-β — Surface-native solid extrusion (Push/Pull successor).
   *
   * Routes through `Command::CreateSolid` with `CreateSolidMode::Extrude`.
   * Plane all-Line profile → Box solid (W-1-α active). Other profiles
   * (curved / NURBS / non-Plane) auto-fall-back to legacy `push_pull`
   * per ADR-079 Q3 lock-in — caller still sees true on overall success.
   *
   * Drop-in replacement signature for `pushPull(faceId, dist)`.
   */
  createSolidExtrude(faceId: number, distance: number): boolean {
    if (!this.engine) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this.engine as any).create_solid_extrude;
    if (!fn) return false;
    this.markDirty();
    return fn.call(this.engine, faceId, distance);
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
    const ok = this.engine.undo();
    // Constraints are part of the scene snapshot — undo may have rolled
    // back constraint additions/removals. Refresh subscribers.
    if (ok) this._emitConstraintsChanged();
    return ok;
  }

  redo(): boolean {
    if (!this.engine) return false;
    this.markDirty();
    const ok = this.engine.redo();
    if (ok) this._emitConstraintsChanged();
    return ok;
  }

  /**
   * ADR-021 P7 + ADR-025 P11 — user-triggered "Resynthesize Faces".
   *
   * Sweeps free orphan edges for closed cycles and synthesizes a face for
   * each. Returns the engine's report so the UI can show different Toast
   * messages for "completed N faces" vs "100ms budget hit; re-run for rest".
   *
   * Use case: previous edits left a closed line skeleton without an
   * associated face (visible as wireframe only). Triggering this gives
   * the user a manual "fix it" button without redrawing.
   */
  resynthesizeOrphanFaces(): { created: number; abortedByTimeBudget: boolean; elapsedMs: number } {
    const fallback = { created: 0, abortedByTimeBudget: false, elapsedMs: 0 };
    const e = this.engine as { resynthesizeOrphanFaces?: () => string | number } | null;
    if (!e?.resynthesizeOrphanFaces) return fallback;
    try {
      const raw = e.resynthesizeOrphanFaces();
      // Backward-compat: older WASM returned u32 (count).
      if (typeof raw === 'number') {
        if (raw > 0) this.bufferCache.dirty = true;
        return { created: raw, abortedByTimeBudget: false, elapsedMs: 0 };
      }
      const parsed = JSON.parse(raw) as { created: number; abortedByTimeBudget: boolean; elapsedMs: number };
      if (parsed.created > 0) this.bufferCache.dirty = true;
      return parsed;
    } catch (err) {
      console.error('[WasmBridge] resynthesizeOrphanFaces failed:', err);
      return fallback;
    }
  }

  /**
   * UX 2026-05-02 — free (face-less) edges for distinct rendering.
   *
   * Returns flat `[x0,y0,z0, x1,y1,z1, ...]` Float32Array of edges that
   * don't bound any active face. The Viewport renders them with a
   * distinct dashed style so users see "line, not face boundary".
   * Empty array when no free edges or older WASM without the method.
   */
  getFreeEdgeSegments(): Float32Array {
    const e = this.engine as { getFreeEdgeSegments?: () => Float32Array } | null;
    if (!e?.getFreeEdgeSegments) return new Float32Array(0);
    try {
      return e.getFreeEdgeSegments();
    } catch {
      return new Float32Array(0);
    }
  }

  /**
   * ADR-047 R-track — non-manifold edge endpoints for visual overlay.
   *
   * Returns flat `[x0,y0,z0, x1,y1,z1, ...]` Float32Array with 2 endpoints
   * × 3 coords per non-manifold edge (edge shared by ≥3 active faces, the
   * intentional ADR-021 P7 stacked-inner artifact). The Viewport renders
   * these as a distinct outline so users perceive the overlapping faces
   * clearly instead of mistaking them for "missing face / wireframe only".
   *
   * Returns empty array when WASM doesn't expose the method (older
   * engines) or there are no such edges. Safe to call every frame —
   * underlying scan is O(active edges).
   */
  getNonManifoldEdgeSegments(): Float32Array {
    const e = this.engine as { getNonManifoldEdgeSegments?: () => Float32Array } | null;
    if (!e?.getNonManifoldEdgeSegments) return new Float32Array(0);
    try {
      return e.getNonManifoldEdgeSegments();
    } catch {
      return new Float32Array(0);
    }
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
   *  Coplanar edges (angle ≤ EDGE_VISIBILITY_ANGLE_DEG) are automatically
   *  hidden. ADR-038 P23 / LOCKED #16 / LOCKED #40 §L7 smooth-group hide
   *  도 적용 — 두 인접 face 가 같은 곡면 surface 인스턴스 (Cylinder /
   *  Sphere / Cone / Torus) 면 angle threshold 무시하고 edge hide.
   *
   *  Returns flat [x0,y0,z0, x1,y1,z1, ...] for THREE.LineSegments.
   *
   *  Return value semantics (ADR-112 β-c, 사용자 결재 2026-05-17):
   *    - `Float32Array` (non-empty)  — engine produced visible edges
   *    - `Float32Array(0)` (length 0) — engine 명시 empty (smooth-group
   *      hide 의 의도된 결과, e.g. sphere-only scene). Viewport 는 빈
   *      edges 로 정상 처리하고 EdgesGeometry fallback 금지.
   *    - `null` — engine 미사용 (WASM 미빌드, legacy fallback,
   *      throw). Viewport 가 EdgesGeometry fallback 으로 재계산.
   *
   *  사후 차이의 가치: sphere-only scene 의 edges sub-step 비용
   *  584ms → ~0ms (5-sphere 기준, 메타-원칙 #11 Heavy 500ms budget 정합). */
  getEdgeLines(): Float32Array | null {
    if (!this.engine) return null;
    if (!this.bufferCache.dirty && this.bufferCache.edgeLines) {
      return this.bufferCache.edgeLines;
    }
    try {
      const lines = this.engine.get_edge_lines?.();
      if (lines === undefined || lines === null) {
        // WASM doesn't expose get_edge_lines — legacy fallback
        return null;
      }
      // engine 명시 결과 — empty 도 valid (smooth-group hide 의도)
      this.bufferCache.edgeLines = lines;
      return lines;
    } catch {
      return null; // WASM throw — fallback to EdgesGeometry
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

  // ─── ADR-135 β — Distance-based LOD chord_tol ───
  // Viewport computes camera distance + calls these wrappers on
  // camera change to push the LOD-aware chord tolerance to engine.
  // Near rendering (cam ≤ 100mm) unchanged (0.02mm baseline preserved);
  // far rendering automatically coarser (0.2mm at 1m, 1.0mm cap at 5m+).
  //
  // Triangle reduction example (r=1000mm sphere):
  //   Near: ~2,000,000 tris (LOCKED #40 baseline)
  //   Mid (1m):  ~200,000 tris (10× reduction)
  //   Far (5m+): ~40,000 tris (50× reduction)

  /** Current render chord tolerance (mm). Default 0.02 (LOCKED #40 §L1). */
  renderChordTol(): number {
    if (!this.engine?.renderChordTol) return 0.02;
    try { return this.engine.renderChordTol(); }
    catch { return 0.02; }
  }

  /** Set render chord tolerance (mm). Clamped to [0.001, 10.0] in WASM.
   *  Change triggers cache_dirty + topology_changed → next syncMesh
   *  full rebuild with new tolerance.
   *  Idempotent: setting same value (within 1μm) is no-op. */
  setRenderChordTol(tol: number): void {
    if (!this.engine?.setRenderChordTol) return;
    try { this.engine.setRenderChordTol(tol); }
    catch (e) { this.recordBridgeError('setRenderChordTol', e); }
  }

  /** Compute LOD chord_tol for given camera distance (mm). Pure
   *  function — does NOT modify engine state. Use to push via
   *  `setRenderChordTol(bridge.lodChordTol(distance))`.
   *  Formula: base 0.02 * max(1, dist/100), capped at 1.0. */
  lodChordTol(cameraDistance: number): number {
    if (!this.engine?.lodChordTol) {
      // Mirror formula in TS for graceful fallback when WASM stub missing
      const base = 0.02;
      const lodFactor = Math.max(1, cameraDistance / 100);
      return Math.min(1.0, base * lodFactor);
    }
    try { return this.engine.lodChordTol(cameraDistance); }
    catch { return 0.02; }
  }

  // computeGroundProjectedShadows method removed 2026-05-16
  // (shadow system deferred to ADR-106)

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
      const id = this.engine.addEdgeConstraint(kind, edgeAVa, edgeAVb, edgeBVa, edgeBVb);
      this._emitConstraintsChanged();
      return id;
    } catch (e) {
      console.error('[WasmBridge] addEdgeConstraint failed:', e);
      return 0;
    }
  }

  addDistanceConstraint(vA: number, vB: number, distance: number): number {
    if (!this.engine?.addDistanceConstraint) return 0;
    this.markDirty();
    try {
      const id = this.engine.addDistanceConstraint(vA, vB, distance);
      this._emitConstraintsChanged();
      return id;
    } catch (e) {
      console.error('[WasmBridge] addDistanceConstraint failed:', e);
      return 0;
    }
  }

  removeConstraint(id: number): boolean {
    if (!this.engine?.removeConstraint) return false;
    this.markDirty();
    try {
      const ok = this.engine.removeConstraint(id);
      if (ok) this._emitConstraintsChanged();
      return ok;
    }
    catch (e) { console.error('[WasmBridge] removeConstraint failed:', e); return false; }
  }

  /** Once-flag for listConstraints failures — avoid console flood when
   *  RAF tick repeatedly hits the same wasm-bindgen reentrancy guard. */
  private _listConstraintsFailedOnce = false;

  /**
   * Event-driven constraint cache invalidation.
   *
   * Subscribers (ConstraintVisual / ConstraintPanel) get notified when
   * the constraint set may have changed (add/remove/toggle/resolve/undo).
   * The frame loop NEVER calls listConstraints directly; it consumes the
   * cached snapshot. This eliminates the per-frame WASM borrow that was
   * racing with mutating calls and causing wasm-bindgen reentrancy panics
   * ("recursive use of an object detected").
   *
   * Pattern: "Snapshot once, render forever until invalidated".
   */
  private _constraintsChangedListeners = new Set<() => void>();
  onConstraintsChanged(cb: () => void): () => void {
    this._constraintsChangedListeners.add(cb);
    return () => { this._constraintsChangedListeners.delete(cb); };
  }
  private _emitConstraintsChanged(): void {
    for (const cb of this._constraintsChangedListeners) {
      try { cb(); } catch (e) { console.error('[WasmBridge] constraint listener error:', e); }
    }
  }

  listConstraints(): Array<{ id: number; kind: string; active: boolean; value?: number; refs: unknown[] }> {
    if (!this.engine?.listConstraints) return [];
    try {
      const json = this.engine.listConstraints();
      const result = JSON.parse(json);
      this._listConstraintsFailedOnce = false; // reset on success
      return result;
    } catch (e) {
      // Spam guard — log first failure only, suppress identical follow-ups.
      // Each animation frame can re-fail, producing 60+ identical errors/sec.
      if (!this._listConstraintsFailedOnce) {
        console.error('[WasmBridge] listConstraints failed (suppressing repeats):', e);
        this._listConstraintsFailedOnce = true;
      }
      return [];
    }
  }

  resolveAllConstraints(): number {
    if (!this.engine?.resolveAllConstraints) return 0;
    this.markDirty();
    try {
      const n = this.engine.resolveAllConstraints();
      if (n > 0) this._emitConstraintsChanged();
      return n;
    }
    catch (e) { console.error('[WasmBridge] resolveAllConstraints failed:', e); return 0; }
  }

  setConstraintActive(id: number, active: boolean): boolean {
    if (!this.engine?.setConstraintActive) return false;
    try {
      const ok = this.engine.setConstraintActive(id, active);
      if (ok) this._emitConstraintsChanged();
      return ok;
    }
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
      if (result) {
        Toast.success('프로젝트 불러오기 성공');
        // Imported snapshot has its own constraint set — invalidate cache.
        this._emitConstraintsChanged();
      }
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

  /**
   * ADR-080 V-β-α-bridge — Edge offset using the host face's surface as
   * reference (no caller-supplied plane normal). Wraps `Mesh::offset_edge_
   * on_host_face` (V-β-α). Returns a tagged-union result so callers
   * dispatch on `reason` for forward-defer cases (Cylinder/Sphere/Cone
   * /Torus host, Arc/Circle/NURBS curve, free wire, multi-loop, etc.).
   *
   * Caller (OffsetTool) is responsible for surfacing reason-specific
   * Toast messages.
   */
  /**
   * ADR-080 V-δ-β — Edge offset with caller-supplied reference plane.
   * Escape hatch when V-δ-α (host face / wire planarity) fails:
   * single-edge wire, collinear wire, or non-planar wire. Caller (e.g.,
   * OffsetTool with active sketch session — V-δ-γ) supplies plane
   * origin + normal explicitly.
   *
   * Reuses `OffsetEdgeOnHostResult` tagged-union; free-wire-specific
   * reasons (no_reference_plane / wire_not_planar) do NOT appear here
   * since caller provided plane.
   */
  offsetEdgeWithReferencePlane(
    edgeId: number,
    dist: number,
    origin: [number, number, number],
    normal: [number, number, number],
  ): OffsetEdgeOnHostResult {
    if (!this.engine) return { ok: false, reason: 'bridge_unavailable' };
    this.markDirty();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (this.engine as any).offset_edge_with_reference_plane;
      if (!fn) return { ok: false, reason: 'bridge_unavailable' };
      const json: string = fn.call(
        this.engine,
        edgeId,
        dist,
        origin[0], origin[1], origin[2],
        normal[0], normal[1], normal[2],
      );
      const parsed = JSON.parse(json);
      if (parsed.ok === true) {
        return {
          ok: true,
          newEdge: parsed.newEdge,
          newV0: parsed.newV0,
          newV1: parsed.newV1,
        };
      }
      switch (parsed.reason) {
        case 'unsupported_curve':
          return { ok: false, reason: 'unsupported_curve', kind: parsed.kind ?? 'Unknown' };
        case 'degenerate_distance':
          return { ok: false, reason: 'degenerate_distance' };
        case 'arc_plane_mismatch':
          return { ok: false, reason: 'arc_plane_mismatch' };
        case 'radius_collapse':
          return {
            ok: false,
            reason: 'radius_collapse',
            currentRadius: Number(parsed.currentRadius ?? 0),
            newRadius: Number(parsed.newRadius ?? 0),
          };
        case 'edge_parallel_to_normal':
          // Map to existing tagged-union variant 'other' with stable message.
          return { ok: false, reason: 'other', message: 'edge_parallel_to_normal' };
        default:
          return { ok: false, reason: 'other', message: String(parsed.message ?? parsed.reason ?? 'unknown') };
      }
    } catch (e) {
      console.error('[WasmBridge] offsetEdgeWithReferencePlane failed:', e);
      return { ok: false, reason: 'other', message: String(e) };
    }
  }

  offsetEdgeOnHost(edgeId: number, dist: number): OffsetEdgeOnHostResult {
    if (!this.engine) return { ok: false, reason: 'bridge_unavailable' };
    this.markDirty();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (this.engine as any).offset_edge_on_host;
      if (!fn) return { ok: false, reason: 'bridge_unavailable' };
      const json: string = fn.call(this.engine, edgeId, dist);
      const parsed = JSON.parse(json);
      // Trust the WASM-side reason vocabulary. Any unknown reason is
      // mapped to 'other' so the type stays well-formed.
      if (parsed.ok === true) {
        return {
          ok: true,
          newEdge: parsed.newEdge,
          newV0: parsed.newV0,
          newV1: parsed.newV1,
        };
      }
      switch (parsed.reason) {
        case 'unsupported_surface':
          return { ok: false, reason: 'unsupported_surface', kind: parsed.kind ?? 'Unknown' };
        case 'unsupported_curve':
          return { ok: false, reason: 'unsupported_curve', kind: parsed.kind ?? 'Unknown' };
        case 'no_incident_face':
          return { ok: false, reason: 'no_incident_face' };
        case 'ambiguous_host':
          return { ok: false, reason: 'ambiguous_host', nFaces: parsed.nFaces ?? 0 };
        case 'multi_loop':
          return { ok: false, reason: 'multi_loop' };
        case 'degenerate_distance':
          return { ok: false, reason: 'degenerate_distance' };
        case 'arc_plane_mismatch':
          return { ok: false, reason: 'arc_plane_mismatch' };
        case 'radius_collapse':
          return {
            ok: false,
            reason: 'radius_collapse',
            currentRadius: Number(parsed.currentRadius ?? 0),
            newRadius: Number(parsed.newRadius ?? 0),
          };
        case 'unsupported_curve_on_surface':
          return {
            ok: false,
            reason: 'unsupported_curve_on_surface',
            surfaceKind: String(parsed.surfaceKind ?? 'Unknown'),
            curveKind: String(parsed.curveKind ?? 'Unknown'),
          };
        case 'axial_out_of_range':
          return {
            ok: false,
            reason: 'axial_out_of_range',
            newV: Number(parsed.newV ?? 0),
            vMin: Number(parsed.vMin ?? 0),
            vMax: Number(parsed.vMax ?? 0),
          };
        case 'wire_not_planar':
          return {
            ok: false,
            reason: 'wire_not_planar',
            rmsError: Number(parsed.rmsError ?? 0),
          };
        case 'no_reference_plane':
          return { ok: false, reason: 'no_reference_plane' };
        default:
          return { ok: false, reason: 'other', message: String(parsed.message ?? parsed.reason ?? 'unknown') };
      }
    } catch (e) {
      console.error('[WasmBridge] offsetEdgeOnHost failed:', e);
      return { ok: false, reason: 'other', message: String(e) };
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

  // ════════════════════════════════════════════════════════════════════
  // ADR-098 S-δ — 3-Tier material scope typed wrappers
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-098 S-γ — List materials in a specific tier.
   * Returns parsed array; empty array on missing endpoint or invalid tier.
   */
  listMaterialsByTier(tier: MaterialTier): ScopedMaterialInfo[] {
    if (!this.engine?.listMaterialsByTier) return [];
    try {
      const tierU32 = TIER_TO_U32[tier];
      const json = this.engine.listMaterialsByTier(tierU32);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any[];
      return parsed.map((m) => ({
        id: m.id,
        name: m.name,
        nameEn: m.nameEn,
        tier: TIER_FROM_U32[m.tier] ?? 'Project',
        color: m.color,
      }));
    } catch {
      return [];
    }
  }

  /**
   * ADR-098 S-γ — Lookup tier of an existing material.
   * Returns null when material missing or endpoint absent.
   */
  getMaterialTier(materialId: number): MaterialTier | null {
    if (!this.engine?.getMaterialTier) return null;
    try {
      const v = this.engine.getMaterialTier(materialId);
      if (v < 0) return null;
      return TIER_FROM_U32[v] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * ADR-098 S-γ — Add a Project-tier material.
   * Returns new MaterialId, or null on missing endpoint.
   */
  addProjectMaterial(name: string, nameEn: string, color: number): number | null {
    if (!this.engine?.addProjectMaterial) return null;
    this.markDirty();
    try {
      return this.engine.addProjectMaterial(name, nameEn, color);
    } catch {
      return null;
    }
  }

  /**
   * ADR-098 S-γ — Add a User-tier material (opt-in library).
   * Returns new MaterialId, or null on missing endpoint.
   */
  addUserMaterial(name: string, nameEn: string, color: number): number | null {
    if (!this.engine?.addUserMaterial) return null;
    this.markDirty();
    try {
      return this.engine.addUserMaterial(name, nameEn, color);
    } catch {
      return null;
    }
  }

  /**
   * ADR-098 S-γ — Remove a User-tier material.
   * S-G safety: only User tier removable through this endpoint.
   */
  removeUserMaterial(materialId: number): boolean {
    if (!this.engine?.removeUserMaterial) return false;
    this.markDirty();
    try {
      return this.engine.removeUserMaterial(materialId);
    } catch {
      return false;
    }
  }

  /**
   * ADR-098 S-γ — Force migration of legacy materials (id-range heuristic).
   * Returns count migrated, or 0 on missing endpoint.
   */
  migrateLegacyMaterials(): number {
    if (!this.engine?.migrateLegacyMaterials) return 0;
    try {
      return this.engine.migrateLegacyMaterials();
    } catch {
      return 0;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-100 R-δ — Material Removal Recovery typed wrappers
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-100 R-γ — Detect orphan material assignments.
   * Returns null on missing endpoint.
   */
  detectOrphanMaterialAssignments(): OrphanMaterialReport | null {
    if (!this.engine?.detectOrphanMaterialAssignments) return null;
    try {
      const json = this.engine.detectOrphanMaterialAssignments();
      return JSON.parse(json) as OrphanMaterialReport;
    } catch {
      return null;
    }
  }

  /**
   * ADR-100 R-γ — Attempt material removal recovery (3-tier cascade).
   * Returns null on missing endpoint; markDirty on call (mutates scene).
   */
  attemptMaterialRemovalRecovery(): MaterialRecoveryOutcome | null {
    if (!this.engine?.attemptMaterialRemovalRecovery) return null;
    this.markDirty();
    try {
      const json = this.engine.attemptMaterialRemovalRecovery();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      switch (parsed.kind) {
        case 'NoOp':
          return { kind: 'NoOp' };
        case 'Recovered':
          return {
            kind: 'Recovered',
            affectedXias: parsed.affectedXias,
            facesDemoted: parsed.facesDemoted,
            facesFallback: parsed.facesFallback,
          };
        case 'PartialFailure':
          return {
            kind: 'PartialFailure',
            affectedXias: parsed.affectedXias,
            remainingOrphans: parsed.remainingOrphans,
          };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * ADR-100 R-γ — Remove a Project-tier material with auto-recovery.
   * Returns null on missing endpoint, ok-envelope on success/error.
   */
  removeProjectMaterial(materialId: number): MaterialRemovalResult | null {
    if (!this.engine?.removeProjectMaterial) return null;
    this.markDirty();
    try {
      const json = this.engine.removeProjectMaterial(materialId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      if (parsed.ok === true) {
        return {
          ok: true,
          removedId: parsed.removedId,
          recovery: parsed.recovery as MaterialRecoveryOutcome,
        };
      }
      return { ok: false, error: parsed.error ?? 'unknown' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ADR-099 L-ζ — Layered Material 4-PBR Channels typed wrappers
  // ════════════════════════════════════════════════════════════════════

  /**
   * ADR-099 L-γ — Read layered channels of a material.
   * Returns:
   *   - `null` on endpoint missing or material missing (engine returns
   *     `{hasLayered:false}` which we surface as `null` for ergonomic
   *     caller flow — match the Rust `Option<LayeredChannels>` shape).
   *   - Parsed `LayeredChannels` interface when populated.
   */
  getLayeredChannels(materialId: number): LayeredChannels | null {
    if (!this.engine?.getLayeredChannels) return null;
    try {
      const json = this.engine.getLayeredChannels(materialId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(json) as any;
      if (!parsed.hasLayered) return null;
      // Engine emits per-channel `{ dataUrl, projection, scale, rotation,
      // label }` (rotation/label may be null). Convert null → undefined
      // for TS optional ergonomics.
      const toInfo = (ch: unknown): TextureInfo | undefined => {
        if (!ch || typeof ch !== 'object') return undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = ch as any;
        return {
          dataUrl: c.dataUrl,
          projection: c.projection,
          scale: c.scale,
          rotation: c.rotation ?? undefined,
          label: c.label ?? undefined,
        };
      };
      const channels = parsed.channels ?? {};
      return {
        albedo: toInfo(channels.albedo),
        normal: toInfo(channels.normal),
        roughness: toInfo(channels.roughness),
        metallic: toInfo(channels.metallic),
      };
    } catch {
      return null;
    }
  }

  /**
   * ADR-099 L-γ — Set one channel of a material's layered payload.
   * Caller passes a `TextureInfo` — wrapper flattens to the WASM
   * signature (NaN sentinel for None rotation, empty string for None
   * label). Returns true on success, false on validation error.
   */
  setLayeredChannel(
    materialId: number,
    channel: LayeredChannelName,
    info: TextureInfo,
  ): boolean {
    if (!this.engine?.setLayeredChannel) return false;
    this.markDirty();
    const projectionU32 =
      info.projection === 'box' ? 1 :
      info.projection === 'cylindrical' ? 2 : 0;
    try {
      return this.engine.setLayeredChannel(
        materialId, channel, info.dataUrl,
        projectionU32, info.scale,
        info.rotation ?? NaN,
        info.label ?? '',
      );
    } catch {
      return false;
    }
  }

  /**
   * ADR-099 L-γ — Clear one channel of a material's layered payload.
   * Idempotent — clearing the last populated channel resets the
   * `layered` wrapper to None on engine side.
   */
  clearLayeredChannel(materialId: number, channel: LayeredChannelName): boolean {
    if (!this.engine?.clearLayeredChannel) return false;
    this.markDirty();
    try {
      return this.engine.clearLayeredChannel(materialId, channel);
    } catch {
      return false;
    }
  }

  /**
   * ADR-099 L-γ — Bulk normalize empty layered payloads.
   * Returns count migrated, or 0 on missing endpoint.
   */
  migrateLegacyTextureToLayered(): number {
    if (!this.engine?.migrateLegacyTextureToLayered) return 0;
    try {
      return this.engine.migrateLegacyTextureToLayered();
    } catch {
      return 0;
    }
  }

  /**
   * ADR-099 L-γ — Quick existence check. True iff material has at
   * least one populated layered channel.
   */
  hasLayeredMaterial(materialId: number): boolean {
    if (!this.engine?.hasLayeredMaterial) return false;
    try {
      return this.engine.hasLayeredMaterial(materialId);
    } catch {
      return false;
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

  /** Phase 2 — auto-intersect on draw 토글.
   *  ADR-139 B-β-1 (2026-05-18): default `false`. 메타-원칙 #16 자동화
   *  antipattern 폐기. Legacy `true` 사용자 명시 opt-in 보존. */
  setAutoIntersectOnDraw(enabled: boolean): void {
    this.engine?.setAutoIntersectOnDraw?.(enabled);
  }

  getAutoIntersectOnDraw(): boolean {
    // ADR-139 B-β-1: default fallback OFF
    return this.engine?.getAutoIntersectOnDraw?.() ?? false;
  }

  /** **ADR-139 B-β-2 (2026-05-18)** — auto Step 4.99 closed cycle face
   *  synthesis 토글. Default `false`. 메타-원칙 #16 자동화 antipattern
   *  폐기. Legacy `true` 사용자 명시 opt-in 보존. */
  setAutoFaceSynthesisOnDraw(enabled: boolean): void {
    this.engine?.setAutoFaceSynthesisOnDraw?.(enabled);
  }

  getAutoFaceSynthesisOnDraw(): boolean {
    // ADR-139 B-β-2: default fallback OFF
    return this.engine?.getAutoFaceSynthesisOnDraw?.() ?? false;
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

/**
 * ADR-080 V-β-α-bridge — Result of `WasmBridge.offsetEdgeOnHost`.
 *
 * Tagged-union shape that lets OffsetTool dispatch on `reason` for
 * friendly Toast messages without parsing free-form strings.
 */
export type OffsetEdgeOnHostResult =
  | { ok: true; newEdge: number; newV0: number; newV1: number }
  | { ok: false; reason: 'unsupported_surface'; kind: string }
  | { ok: false; reason: 'unsupported_curve'; kind: string }
  | { ok: false; reason: 'no_incident_face' }
  | { ok: false; reason: 'ambiguous_host'; nFaces: number }
  | { ok: false; reason: 'multi_loop' }
  | { ok: false; reason: 'degenerate_distance' }
  | { ok: false; reason: 'arc_plane_mismatch' }
  | { ok: false; reason: 'radius_collapse'; currentRadius: number; newRadius: number }
  | { ok: false; reason: 'unsupported_curve_on_surface'; surfaceKind: string; curveKind: string }
  | { ok: false; reason: 'axial_out_of_range'; newV: number; vMin: number; vMax: number }
  | { ok: false; reason: 'wire_not_planar'; rmsError: number }
  | { ok: false; reason: 'no_reference_plane' }
  | { ok: false; reason: 'other'; message: string }
  | { ok: false; reason: 'bridge_unavailable' };

export interface BooleanResult {
  ok: boolean;
  error?: string;
  op?: string;
  resultFaces?: number[];
  newVerts?: number;
  totalVerts?: number;
  totalFaces?: number;
}

// ADR-076 Step 2 — Removed `NurbsBooleanResult` (ADR-027 Phase G3
// legacy probe envelope) and `BooleanDispatchDcelResult` (ADR-064
// Step 6-β single-face envelope). Both became unused after the
// corresponding wrappers were removed. Shared types
// (BooleanDispatchPath / BooleanDispatchFallbackKind /
// BooleanDispatchFallbackReason / BooleanDispatchDcel /
// BooleanDispatchDcelErrorReason) are PRESERVED — multi
// (BooleanDispatchDcelMultiResult) reuses them via PerPairDcelOutcome.

/**
 * Path used by the Boolean dispatcher (single OR multi face). Shared
 * between ADR-064 Path Z (Rust impl preserved, internal-only after
 * ADR-076 Step 2) and ADR-066 Path Y (multi-face dispatch wrapper).
 */
export type BooleanDispatchPath = 'Mesh' | 'Nurbs' | 'NurbsWithMeshFallback';

export type BooleanDispatchFallbackKind =
  | 'SurfaceMissing'
  | 'MultipleFacesNotSupported'
  | 'UnsupportedSurfaceKind'
  | 'TrimLoopsNotSupported'
  | 'NurbsCoreError'
  | 'SsiNotClean';

export interface BooleanDispatchFallbackReason {
  kind: BooleanDispatchFallbackKind;
  label: string;
}

/**
 * Sub-object describing the actual DCEL face deltas. Present when
 * `pathUsed === 'Nurbs'`; null when `pathUsed === 'Mesh'` (eligibility
 * was rejected — caller decides whether to invoke the mesh path).
 *
 * Even when present, all four arrays may be empty:
 *   - `disjoint: true` → no intersection, all empty (D-F=(c))
 *   - SSI non-empty but no closed loops → all empty (D-H safe-only)
 */
export interface BooleanDispatchDcel {
  newFacesA: number[];
  newFacesB: number[];
  removedFaces: number[];
  preservedFaces: number[];
  disjoint: boolean;
  robustnessClean: boolean;
}

export type BooleanDispatchDcelErrorReason =
  | 'invalidOp'
  | 'engineErr'
  | 'parse';

/**
 * ADR-066 Y-3 (Path Y) — Multi-face DCEL dispatch result types.
 *
 * Mirrors the JSON envelope produced by Y-2 `booleanDispatchDcelMultiJson`
 * WASM export. Per Y-2-c full per-pair serialization + Y-2-j discriminated
 * outcome `kind`, every (a, b) pair is captured as `ok` (with embedded
 * dcel object) or `err` (with detail string).
 */
export type PerPairDcelOutcome =
  | { kind: 'ok'; dcel: BooleanDispatchDcel }
  | { kind: 'err'; detail: string };

export interface PerPairDcelEntry {
  faceA: number;
  faceB: number;
  outcome: PerPairDcelOutcome;
}

/**
 * Top-level multi-face dispatch result envelope.
 *
 * - `pathUsed: 'Nurbs'` — Y-E eligibility passed; `perPair` has N×M
 *   outcomes; `allNewFaces` / `allRemovedFaces` are sorted-unique
 *   aggregates across successful pairs.
 * - `pathUsed: 'Mesh'` — Y-E rejected upfront (any face missing surface
 *   or unsupported kind); `perPair`/aggregates all empty;
 *   `fallbackReason` populated. Caller decides next step (no auto
 *   mesh fallback per Y-D / Y-3 design).
 *
 * `warnings: string[]` records Y-H=(c) skip-and-warn entries (per-pair
 * Err details, surface conversion warnings, etc.).
 */
export type BooleanDispatchDcelMultiResult =
  | {
      kind: 'ok';
      pathUsed: BooleanDispatchPath;
      fallbackReason: BooleanDispatchFallbackReason | null;
      perPair: PerPairDcelEntry[];
      allNewFaces: number[];
      allRemovedFaces: number[];
      warnings: string[];
    }
  | {
      kind: 'error';
      reason: BooleanDispatchDcelErrorReason;
      detail: string;
    };

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
