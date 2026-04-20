/**
 * WASM Bridge — Initializes and wraps the Rust AxiaEngine.
 * Includes performance optimizations with buffer caching.
 */

import * as THREE from 'three';
import init, { AxiaEngine } from '../wasm/axia_wasm';
import { Toast } from '../ui/Toast';
import { debugLog } from '../utils/debug';

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
  // Edge/geometry queries
  get_edge_lines?(): Float32Array;
  get_edge_map?(): Uint32Array;
  getSnapVerticesF64?(): Float64Array;
  getPositionsF64?(): Float64Array;
  delete_edge?(edgeId: number): boolean;
  batch_delete?(faceIds: Uint32Array, edgeIds: Uint32Array): boolean;
  // Constraint Solver Level 1 (vertex-level ops + edge/vertex queries)
  translateVerts?(vertIds: Uint32Array, dx: number, dy: number, dz: number): boolean;
  rotateVerts?(vertIds: Uint32Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number, angleDeg: number): boolean;
  getEdgeEndpoints?(edgeId: number): Uint32Array;
  getVertexPos?(vertId: number): Float64Array;
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
  // Face merge (coplanar face combine)
  mergeFacesByEdge?(edgeId: number): number;
  tryMergeAdjacentFaces?(faceIds: Uint32Array): number;
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
  // Delta Buffer Export
  getDirtyFaceBuffers?(): WasmDeltaBuffers | undefined;
  getCacheVersion?(): number;
  get_dirty_face_count?(): number;
};

export class WasmBridge {
  public engine: AxiaEngineExtended | null = null;

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

  async init(): Promise<void> {
    try {
      await init();
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

  /** Mark buffers as dirty (call after any topology-changing operation) */
  markDirty(): void {
    this.bufferCache.dirty = true;
  }

  drawLine(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    nx = 0, ny = 0, nz = 0,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    return this.engine.draw_line(x0, y0, z0, x1, y1, z1, nx, ny, nz);
  }

  drawRect(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    ux: number, uy: number, uz: number,
    width: number, height: number,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    return this.engine.draw_rect(cx, cy, cz, nx, ny, nz, ux, uy, uz, width, height);
  }

  drawCircle(
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    radius: number, segments: number,
  ): number {
    if (!this.engine) return -1;
    this.markDirty();
    return this.engine.draw_circle(cx, cy, cz, nx, ny, nz, radius, segments);
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
    if (!this.engine) return '';
    try {
      return this.engine.lastError?.() ?? '';
    } catch {
      return '';
    }
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
    this.bufferCache = { positions, positionsF64: positionsF64 ?? null, normals, indices, faceMap, edgeLines: null, edgeMap: null, dirty: false };
    return { positions, normals, indices, faceMap, positionsF64 };
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
   * Merge two coplanar faces that share the given edge into one face.
   * Returns the merged FaceId on success (>= 0), or -1 on failure
   * (with lastError set — e.g. "not coplanar", "shares multiple edges").
   * Single undo step.
   */
  mergeFacesByEdge(edgeId: number): number {
    if (!this.engine) return -1;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        mergeFacesByEdge?(edgeId: number): number;
      };
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
  tryMergeAdjacentFaces(faceIds: number[]): number {
    if (!this.engine) return 0;
    this.markDirty();
    try {
      const eng = this.engine as AxiaEngineExtended & {
        tryMergeAdjacentFaces?(ids: Uint32Array): number;
      };
      return eng.tryMergeAdjacentFaces?.(new Uint32Array(faceIds)) ?? 0;
    } catch (e) {
      console.error('[WasmBridge] tryMergeAdjacentFaces failed:', e);
      return 0;
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
