/**
 * OCCT BRepMesh tessellation → Three.js BufferGeometry data (ADR-083 T-β).
 *
 * BRep face 를 OCCT 의 industry-standard `BRepMesh_IncrementalMesh` 로
 * tessellate 한 후 face 별 Poly_Triangulation 을 추출해 vertex /
 * normal / index buffer (Float32Array / Uint32Array) 로 변환.
 *
 * **본 모듈 scope** (T-β): face mesh data 추출까지. Three.js Mesh / Group
 * 생성은 T-γ (caller).
 *
 * ## OCCT API 참고
 *
 * - `BRepMesh_IncrementalMesh_2(shape, lineDeflection, isRelative,
 *   angleDeflection, isInParallel)` — in-place mesh on shape's faces
 * - `BRep_Tool.Triangulation(face, location)` → Handle_Poly_Triangulation
 * - `Poly_Triangulation`:
 *   * `NbNodes()` / `Node(i)` (1-based, gp_Pnt)
 *   * `NbTriangles()` / `Triangle(i)` (1-based, Poly_Triangle)
 *   * `HasNormals()` / `Normal(i)` (1-based, gp_Dir)
 * - `Poly_Triangle.Value(1|2|3)` → vertex index (1-based)
 *
 * ## occt.js wrapper version-tolerant
 *
 * `_2 ?? _1 ?? bare` chain 일관 적용 (ADR-035 P20.7).
 *
 * ## ADR-083 §3.2 lock-ins
 *
 * - lineDeflection default 0.1 mm (industrial visual quality)
 * - angleDeflection default 0.5 rad (~28.6°)
 * - Per-face data 추출 — caller 가 axia FaceId 로 매핑 (W-δ stable index
 *   답습)
 * - 실패 시 face-level warnings 누적 (P21.7 답습), empty mesh 도 valid
 */

import { promoteSurface, type SurfacePromotion } from './occtSurfacePromote';
import { extractFaceBoundary } from './occtBoundaryPolygon';
import { debugLog, debugWarn } from '../utils/debug';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Per-edge polyline buffer — Three.js LineSegments BufferGeometry 직접
 * 입력 가능한 형식 (ADR-084 E-β).
 *
 * `index` 는 W-δ traversal 의 stable edge index 와 동기화 (caller 가
 * axia EdgeId 로 매핑, ADR-037 P22.7).
 */
export interface EdgeTessellation {
  /** 0-based traversal index (W-δ 답습). */
  index: number;
  /** Polyline node positions (xyz × N). */
  positions: Float32Array;
  /**
   * LineSegments pair indices (2 × (N-1)). Each pair `[i, i+1]` 는 한
   * line segment. Three.js `LineSegments` + indexed `BufferGeometry`
   * 직접 입력. Empty (positions 길이 < 2) 시 length 0.
   */
  indices: Uint32Array;
}

/** Edge tessellation 호출 결과. */
export interface EdgesTessellateResult {
  edges: EdgeTessellation[];
  warnings: string[];
}

/**
 * Per-face tessellation buffers — Three.js BufferGeometry 직접 입력
 * 가능한 형식.
 *
 * `index` 는 W-δ traversal 의 stable index 와 동기화 (caller 가 axia
 * FaceId 로 매핑, ADR-037 P22.7).
 */
export interface FaceTessellation {
  /** 0-based traversal index (W-δ 답습). */
  index: number;
  /** Vertex positions (xyz × N). */
  positions: Float32Array;
  /** Vertex normals (xyz × N). HasNormals false 면 zero-filled (caller 가 computeVertexNormals 호출 가능). */
  normals: Float32Array;
  /** Triangle indices (3 × M, 0-based — OCCT 의 1-based 에서 변환). */
  indices: Uint32Array;
  /** Optional analytic surface promotion (W-γ 답습) — caller 가 setFaceSurface* 으로 attach. */
  surface?: SurfacePromotion;
  /**
   * ADR-086 O-δ — Outer boundary polygon for axia DCEL injection
   * (`bridge.injectExternalFace*`). Empty (length 0) if extraction
   * failed (graceful, P21.7).
   */
  boundaryPolygon?: Float32Array;
}

/** Tessellation 호출 결과. */
export interface TessellateResult {
  faces: FaceTessellation[];
  warnings: string[];
}

/** Tessellation 옵션 (사용자 default = ADR-083 §3.2 lock-ins). */
export interface TessellateOptions {
  /** Chord tolerance (단위: shape 단위 — STEP 은 mm). default 0.1. */
  lineDeflection?: number;
  /** Angle tolerance (radians). default 0.5. */
  angleDeflection?: number;
  /** Relative deflection 모드 (default false — absolute units). */
  isRelative?: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function getTopAbs(occt: any, name: string, fallback: number): number {
  const v = occt?.TopAbs_ShapeEnum?.[name];
  return typeof v === 'number' ? v : fallback;
}

function makeExplorer(occt: any, shape: any, kind: number, toAvoid: number): any {
  const Ctor = occt?.TopExp_Explorer_2 ?? occt?.TopExp_Explorer_1 ?? occt?.TopExp_Explorer;
  if (!Ctor) return null;
  try {
    return new Ctor(shape, kind, toAvoid);
  } catch {
    try {
      return new Ctor(shape, kind);
    } catch {
      return null;
    }
  }
}

function makeIdentityLocation(occt: any): any {
  const Ctor = occt?.TopLoc_Location_1 ?? occt?.TopLoc_Location;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function applyMesh(
  occt: any,
  shape: any,
  options: Required<TessellateOptions>,
): { ok: boolean; error?: string } {
  // BRepMesh_IncrementalMesh_2(shape, lineDeflection, isRelative, angleDeflection, isInParallel)
  const Ctor = occt?.BRepMesh_IncrementalMesh_2
    ?? occt?.BRepMesh_IncrementalMesh_3
    ?? occt?.BRepMesh_IncrementalMesh;
  if (!Ctor) return { ok: false, error: 'BRepMesh_IncrementalMesh ctor missing' };
  try {
    // _2 signature 우선 — 5-arg 명시적 lock-in
    const mesher = new Ctor(
      shape,
      options.lineDeflection,
      options.isRelative,
      options.angleDeflection,
      false /* isInParallel — single-threaded for browser deterministic */,
    );
    // Mesh 결과는 in-place — 반환 값은 mesher 객체. delete() 호출은
    // 자동 GC 가 (Emscripten finalizer) 처리.
    void mesher;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `BRepMesh_IncrementalMesh: ${String(e)}` };
  }
}

/** Extract Triangulation handle from face + identity-location. */
function extractTriangulation(
  occt: any,
  face: any,
  location: any,
): { tri: any | null; error?: string } {
  try {
    // BRep_Tool.Triangulation(face, location) — static method
    const handle = occt?.BRep_Tool?.Triangulation?.(face, location);
    if (!handle || handle.IsNull?.()) {
      return { tri: null, error: 'Triangulation handle null (BRepMesh 결과 부재)' };
    }
    const tri = handle.get?.() ?? handle;
    return { tri };
  } catch (e) {
    return { tri: null, error: `Triangulation extract: ${String(e)}` };
  }
}

/**
 * Convert one Poly_Triangulation to Float32Array / Uint32Array buffers.
 *
 * - positions: vertex × 3 floats
 * - normals: vertex × 3 floats (HasNormals 면 evaluate, 아니면 zero)
 * - indices: triangle × 3 uint (OCCT 1-based → 0-based 변환)
 */
function convertTriangulation(tri: any): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const nNodes: number = tri.NbNodes?.() ?? 0;
  const nTris: number = tri.NbTriangles?.() ?? 0;

  const positions = new Float32Array(nNodes * 3);
  const normals = new Float32Array(nNodes * 3);
  const indices = new Uint32Array(nTris * 3);

  // Vertices
  for (let i = 1; i <= nNodes; i++) {
    const p = tri.Node?.(i);
    if (!p) continue;
    const off = (i - 1) * 3;
    positions[off] = p.X();
    positions[off + 1] = p.Y();
    positions[off + 2] = p.Z();
  }

  // Normals (optional)
  if (tri.HasNormals?.()) {
    for (let i = 1; i <= nNodes; i++) {
      try {
        const n = tri.Normal?.(i);
        if (!n) continue;
        const off = (i - 1) * 3;
        normals[off] = n.X();
        normals[off + 1] = n.Y();
        normals[off + 2] = n.Z();
      } catch {
        // Normal(i) 실패 시 zero (caller 의 computeVertexNormals 가 fallback)
      }
    }
  }

  // Triangles (OCCT 1-based → 0-based)
  for (let i = 1; i <= nTris; i++) {
    const t = tri.Triangle?.(i);
    if (!t) continue;
    const off = (i - 1) * 3;
    // Poly_Triangle.Value(1|2|3) — vertex index (1-based)
    const v1: number = t.Value?.(1) ?? 1;
    const v2: number = t.Value?.(2) ?? 1;
    const v3: number = t.Value?.(3) ?? 1;
    indices[off] = v1 - 1;
    indices[off + 1] = v2 - 1;
    indices[off + 2] = v3 - 1;
  }

  return { positions, normals, indices };
}

// ────────────────────────────────────────────────────────────────────────
// Public API — tessellateShape
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<TessellateOptions> = {
  lineDeflection: 0.1,    // ADR-083 L1: 0.1 mm 산업 표준 visual quality
  angleDeflection: 0.5,   // ADR-083 L1: 0.5 rad (~28.6°)
  isRelative: false,      // absolute units
};

/**
 * Tessellate a TopoDS_Shape and extract per-face mesh buffers.
 *
 * **Algorithm**:
 * 1. `BRepMesh_IncrementalMesh_2(shape, lineDef, false, angleDef, false)` —
 *    in-place mesh on all faces
 * 2. `TopExp_Explorer(shape, TopAbs_FACE)` 로 face 순회 (W-δ 답습)
 * 3. 각 face 에 대해 `BRep_Tool.Triangulation(face, location)` 추출
 * 4. Poly_Triangulation → Float32Array / Uint32Array buffers
 * 5. Stable index (W-δ 답습) 와 옵션으로 surface promotion 결합
 *
 * **Failure modes** (P21.7 답습):
 * - BRepMesh_IncrementalMesh ctor 실패 → 전역 warning, faces=[]
 * - Per-face Triangulation null → face-level warning, skip
 * - 빈 face mesh (NbNodes=0 / NbTriangles=0) 도 valid output
 *
 * @param occt — opencascade.js runtime instance (initOpenCascade 결과)
 * @param shape — TopoDS_Shape (compound / shell / solid / face)
 * @param options — tessellation tolerance (default ADR-083 L1)
 * @returns `{ faces, warnings }` — per-face tessellation 결과
 */
export function tessellateShape(
  occt: unknown,
  shape: unknown,
  options?: TessellateOptions,
): TessellateResult {
  const result: TessellateResult = { faces: [], warnings: [] };

  if (!occt || !shape) {
    result.warnings.push('tessellateShape: occt or shape is null');
    return result;
  }

  const o = occt as any;
  const opts: Required<TessellateOptions> = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  // Step 1 — apply BRepMesh in-place
  const meshRes = applyMesh(o, shape, opts);
  if (!meshRes.ok) {
    result.warnings.push(meshRes.error ?? 'BRepMesh failed');
    return result;
  }
  debugLog(
    `[tessellateShape] BRepMesh applied: lineDef=${opts.lineDeflection}, ` +
    `angleDef=${opts.angleDeflection}`,
  );

  // Step 2 — face traversal (W-δ stable index 답습)
  const TopAbs_FACE = getTopAbs(o, 'TopAbs_FACE', 4);
  const TopAbs_SHAPE = getTopAbs(o, 'TopAbs_SHAPE', 8);
  const exp = makeExplorer(o, shape, TopAbs_FACE, TopAbs_SHAPE);
  if (!exp) {
    result.warnings.push('tessellateShape: TopExp_Explorer unavailable');
    return result;
  }

  const location = makeIdentityLocation(o);
  if (!location) {
    result.warnings.push('tessellateShape: TopLoc_Location ctor unavailable');
    return result;
  }

  let faceIdx = 0;
  try {
    while (exp.More?.()) {
      const face = exp.Current?.();
      if (face) {
        // Step 3 — extract Triangulation
        const triRes = extractTriangulation(o, face, location);
        if (triRes.tri) {
          // Step 4 — convert to buffers
          try {
            const buffers = convertTriangulation(triRes.tri);

            // Step 5 — combine with surface promotion (optional, W-γ 답습)
            let surface: SurfacePromotion | undefined;
            try {
              const promo = promoteSurface(o, face);
              surface = promo.promotion;
              for (const w of promo.warnings) {
                result.warnings.push(`face[${faceIdx}].surface: ${w}`);
              }
            } catch {
              // surface promotion 실패는 fatal 아님 — tessellation 만 보존
            }

            // Step 6 — ADR-086 O-δ — extract outer boundary polygon for
            // axia DCEL injection. Failure 는 graceful (warnings 누적).
            let boundaryPolygon: Float32Array | undefined;
            try {
              const boundary = extractFaceBoundary(o, face);
              if (boundary.positions.length > 0) {
                boundaryPolygon = boundary.positions;
              }
              for (const w of boundary.warnings) {
                result.warnings.push(`face[${faceIdx}].boundary: ${w}`);
              }
            } catch (e) {
              result.warnings.push(`face[${faceIdx}] boundary extract: ${String(e)}`);
            }

            result.faces.push({
              index: faceIdx,
              positions: buffers.positions,
              normals: buffers.normals,
              indices: buffers.indices,
              surface,
              boundaryPolygon,
            });
          } catch (e) {
            result.warnings.push(`face[${faceIdx}] convert: ${String(e)}`);
          }
        } else {
          result.warnings.push(
            `face[${faceIdx}]: ${triRes.error ?? 'Triangulation null'}`,
          );
        }
      }
      faceIdx++;
      exp.Next?.();
    }
  } catch (e) {
    result.warnings.push(`tessellateShape face iteration: ${String(e)}`);
  }

  debugLog(
    `[tessellateShape] ${result.faces.length} faces tessellated, ` +
    `${result.warnings.length} warning(s)`,
  );
  if (result.warnings.length > 0) {
    debugWarn(`[tessellateShape] warnings:`, result.warnings.slice(0, 3));
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// ADR-084 E-β — tessellateEdges (BRep edge polyline 추출)
// ────────────────────────────────────────────────────────────────────────

/** Extract Polygon3D handle from edge + identity-location. */
function extractPolygon3D(
  occt: any,
  edge: any,
  location: any,
): { polygon: any | null; error?: string } {
  try {
    // BRep_Tool.Polygon3D(edge, location) — static method
    const handle = occt?.BRep_Tool?.Polygon3D?.(edge, location);
    if (!handle || handle.IsNull?.()) {
      return { polygon: null, error: 'Polygon3D handle null (BRepMesh 결과 부재 또는 edge 미tessellate)' };
    }
    const polygon = handle.get?.() ?? handle;
    return { polygon };
  } catch (e) {
    return { polygon: null, error: `Polygon3D extract: ${String(e)}` };
  }
}

/**
 * Convert one Poly_Polygon3D to Float32Array positions + LineSegments
 * pair indices (Uint32Array).
 *
 * Polyline of N nodes → N-1 line segments → 2*(N-1) indices.
 */
function convertPolygon3D(polygon: any): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const nNodes: number = polygon.NbNodes?.() ?? 0;
  if (nNodes < 2) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }

  // Nodes 추출 — TColgp_Array1OfPnt (1-based)
  const positions = new Float32Array(nNodes * 3);
  try {
    const nodes = polygon.Nodes?.();
    if (nodes) {
      const lo: number = nodes.Lower?.() ?? 1;
      const hi: number = nodes.Upper?.() ?? nNodes;
      for (let i = lo; i <= hi; i++) {
        const p = nodes.Value?.(i);
        if (!p) continue;
        const off = (i - lo) * 3;
        positions[off] = p.X();
        positions[off + 1] = p.Y();
        positions[off + 2] = p.Z();
      }
    }
  } catch {
    // Fall back to per-node accessor (graceful)
  }

  // LineSegments pair indices: [0,1, 1,2, ..., N-2,N-1]
  const indices = new Uint32Array((nNodes - 1) * 2);
  for (let i = 0; i < nNodes - 1; i++) {
    indices[i * 2] = i;
    indices[i * 2 + 1] = i + 1;
  }

  return { positions, indices };
}

/**
 * Extract per-edge polylines from a TopoDS_Shape (ADR-084 E-β).
 *
 * **Pre-condition**: shape 가 이미 `BRepMesh_IncrementalMesh` 적용됨
 * (예: tessellateShape() 호출 후). Polygon3D 가 mesh 결과의 부산물 —
 * mesh 미적용 시 모든 edge 가 null Polygon3D 반환.
 *
 * **Algorithm**:
 * 1. `TopExp_Explorer(shape, TopAbs_EDGE)` 로 edge 순회 (W-δ 답습)
 * 2. 각 edge → `BRep_Tool.Polygon3D(edge, location)` → Handle_Poly_Polygon3D
 * 3. polygon.Nodes() → TColgp_Array1OfPnt → Float32Array (xyz × N)
 * 4. LineSegments pair indices (2 × (N-1))
 * 5. Stable index (W-δ 답습)
 *
 * **Failure modes** (P21.7 답습):
 * - Polygon3D null → edge-level warning, skip
 * - Empty polyline (NbNodes<2) → empty buffers, valid output
 *
 * @param occt - opencascade.js runtime instance
 * @param shape - TopoDS_Shape (BRepMesh 적용 완료 가정)
 * @returns `{ edges, warnings }` — per-edge polyline 결과
 */
export function tessellateEdges(
  occt: unknown,
  shape: unknown,
): EdgesTessellateResult {
  const result: EdgesTessellateResult = { edges: [], warnings: [] };

  if (!occt || !shape) {
    result.warnings.push('tessellateEdges: occt or shape is null');
    return result;
  }

  const o = occt as any;
  const TopAbs_EDGE = getTopAbs(o, 'TopAbs_EDGE', 6);
  const TopAbs_SHAPE = getTopAbs(o, 'TopAbs_SHAPE', 8);
  const exp = makeExplorer(o, shape, TopAbs_EDGE, TopAbs_SHAPE);
  if (!exp) {
    result.warnings.push('tessellateEdges: TopExp_Explorer unavailable');
    return result;
  }

  const location = makeIdentityLocation(o);
  if (!location) {
    result.warnings.push('tessellateEdges: TopLoc_Location ctor unavailable');
    return result;
  }

  let edgeIdx = 0;
  try {
    while (exp.More?.()) {
      const edge = exp.Current?.();
      if (edge) {
        const polyRes = extractPolygon3D(o, edge, location);
        if (polyRes.polygon) {
          try {
            const buffers = convertPolygon3D(polyRes.polygon);
            // Skip empty polylines (NbNodes < 2)
            if (buffers.positions.length === 0) {
              result.warnings.push(`edge[${edgeIdx}]: empty polyline (NbNodes<2)`);
            } else {
              result.edges.push({
                index: edgeIdx,
                positions: buffers.positions,
                indices: buffers.indices,
              });
            }
          } catch (e) {
            result.warnings.push(`edge[${edgeIdx}] convert: ${String(e)}`);
          }
        } else {
          result.warnings.push(
            `edge[${edgeIdx}]: ${polyRes.error ?? 'Polygon3D null'}`,
          );
        }
      }
      edgeIdx++;
      exp.Next?.();
    }
  } catch (e) {
    result.warnings.push(`tessellateEdges edge iteration: ${String(e)}`);
  }

  debugLog(
    `[tessellateEdges] ${result.edges.length} edges tessellated, ` +
    `${result.warnings.length} warning(s)`,
  );
  if (result.warnings.length > 0) {
    debugWarn(`[tessellateEdges] warnings:`, result.warnings.slice(0, 3));
  }

  return result;
}
