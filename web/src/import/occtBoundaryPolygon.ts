/**
 * OCCT face → outer boundary polygon extraction (ADR-086 O-δ).
 *
 * STEP/IGES face 의 outer wire 를 BRepTools_WireExplorer 로 ordered
 * 순회 + 각 edge 의 Polygon3D polyline 을 concat → single boundary
 * polygon (Float64Array xyz × N). Caller (StepIgesImporter integration)
 * 가 `bridge.injectExternalFace*` 입력으로 사용.
 *
 * **Pre-condition**: shape 가 이미 `BRepMesh_IncrementalMesh` 적용됨
 * (T-β tessellateShape 호출 후). Polygon3D 가 mesh 결과의 부산물.
 *
 * ## Algorithm
 *
 * 1. `BRepTools.OuterWire(face)` → outer wire
 * 2. `BRepTools_WireExplorer(wire, face)` → ordered edges (orientation
 *    aware)
 * 3. 각 edge → `BRep_Tool.Polygon3D(edge, location)` → polyline points
 * 4. Edge orientation 처리: REVERSED 시 polyline 역순
 * 5. 인접 edge 의 shared vertex dedup (edge N 의 끝 == edge N+1 의 시작)
 * 6. 결과: closed polygon (first point != last point — ADR-086 contract)
 *
 * ## ADR-007 winding
 *
 * 본 함수는 wire 순회 순서대로 polygon 을 구성. orientation 정합은
 * caller (`bridge.injectExternalFace*` 가 호출하는 `add_face_with_holes`)
 * 가 자동 정합 (ADR-007 Invariant 2 — surface_normal_hint 기준 winding
 * 자동 reverse).
 *
 * ## Failure modes (P21.7 답습)
 *
 * - face null → empty polygon + warning
 * - OuterWire 추출 실패 → empty polygon + warning
 * - Polygon3D null per edge → 부분 polygon (skip edge) + warning
 * - 결과 polygon < 3 vertices → empty + warning (caller invalid)
 */

import { debugLog, debugWarn } from '../utils/debug';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Boundary polygon 추출 결과. */
export interface BoundaryPolygonResult {
  /** Outer boundary points (`xyz × N`). Empty (length 0) on failure. */
  positions: Float32Array;
  /** Per-face warnings (P21.7 답습). */
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers (wrapper version-tolerant — ADR-035 P20.7)
// ────────────────────────────────────────────────────────────────────────

function makeWireExplorer(occt: any, wire: any, face: any): any {
  const Ctor = occt?.BRepTools_WireExplorer_2
    ?? occt?.BRepTools_WireExplorer_1
    ?? occt?.BRepTools_WireExplorer;
  if (!Ctor) return null;
  try {
    return new Ctor(wire, face);
  } catch {
    try {
      return new Ctor(wire);
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

/** Get OuterWire of a face (graceful — fallback to first wire). */
function getOuterWire(occt: any, face: any): any {
  // BRepTools.OuterWire is static method
  const fn = occt?.BRepTools?.OuterWire ?? occt?.BRepTools?.OuterWire_1;
  if (!fn) return null;
  try {
    return fn.call(occt.BRepTools, face);
  } catch {
    return null;
  }
}

/** Extract Polygon3D polyline points from edge. */
function extractEdgePolyline(occt: any, edge: any, location: any): [number, number, number][] | null {
  try {
    const handle = occt?.BRep_Tool?.Polygon3D?.(edge, location);
    if (!handle || handle.IsNull?.()) return null;
    const polygon = handle.get?.() ?? handle;

    const nNodes: number = polygon.NbNodes?.() ?? 0;
    if (nNodes < 2) return null;

    const points: [number, number, number][] = [];
    const nodes = polygon.Nodes?.();
    if (!nodes) return null;
    const lo: number = nodes.Lower?.() ?? 1;
    const hi: number = nodes.Upper?.() ?? nNodes;
    for (let i = lo; i <= hi; i++) {
      const p = nodes.Value?.(i);
      if (!p) return null;
      points.push([p.X(), p.Y(), p.Z()]);
    }
    return points;
  } catch {
    return null;
  }
}

/**
 * Get edge orientation flag (TopAbs_REVERSED → reverse polyline).
 *
 * Edge 의 `Orientation()` returns TopAbs_FORWARD (0) | TopAbs_REVERSED (1) |
 * TopAbs_INTERNAL (2) | TopAbs_EXTERNAL (3).
 */
function isEdgeReversed(edge: any): boolean {
  try {
    const orient = edge.Orientation?.();
    return orient === 1;  // TopAbs_REVERSED
  } catch {
    return false;
  }
}

/** Distance between two 3D points (squared, no sqrt). */
function distSq(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/** Vertex dedup tolerance (squared) — LOCKED #5 spatial hash 1.5μm. */
const DEDUP_TOL_SQ = (1.5e-3) * (1.5e-3);  // 1.5μm² in mm units

/**
 * Extract outer boundary polygon for a single TopoDS_Face.
 *
 * @param occt - opencascade.js runtime instance
 * @param face - TopoDS_Face
 * @returns `{ positions, warnings }` — positions empty if extraction failed
 */
export function extractFaceBoundary(
  occt: unknown,
  face: unknown,
): BoundaryPolygonResult {
  const result: BoundaryPolygonResult = {
    positions: new Float32Array(0),
    warnings: [],
  };

  if (!occt || !face) {
    result.warnings.push('extractFaceBoundary: occt or face is null');
    return result;
  }

  const o = occt as any;

  // Step 1 — get outer wire
  const wire = getOuterWire(o, face);
  if (!wire) {
    result.warnings.push('extractFaceBoundary: OuterWire null');
    return result;
  }

  // Step 2 — wire explorer (ordered edges)
  const exp = makeWireExplorer(o, wire, face);
  if (!exp) {
    result.warnings.push('extractFaceBoundary: BRepTools_WireExplorer ctor unavailable');
    return result;
  }

  const location = makeIdentityLocation(o);
  if (!location) {
    result.warnings.push('extractFaceBoundary: TopLoc_Location ctor unavailable');
    return result;
  }

  // Step 3-5 — iterate edges + concat polylines + dedup shared vertices
  const polygon: [number, number, number][] = [];
  let edgeIdx = 0;

  try {
    while (exp.More?.()) {
      const edge = exp.Current?.();
      if (edge) {
        const polyline = extractEdgePolyline(o, edge, location);
        if (polyline && polyline.length >= 2) {
          // Edge orientation: REVERSED → reverse polyline order
          const ordered = isEdgeReversed(edge) ? [...polyline].reverse() : polyline;

          if (polygon.length === 0) {
            // First edge — push all points
            for (const p of ordered) polygon.push(p);
          } else {
            // Subsequent edges — first point should match last polygon point.
            // If close enough (< DEDUP_TOL_SQ), skip first point (dedup).
            // If not, append all (gap — non-manifold case, log warning).
            const lastPoint = polygon[polygon.length - 1];
            const firstNew = ordered[0];
            if (distSq(lastPoint, firstNew) < DEDUP_TOL_SQ) {
              // Dedup: skip first (shared vertex)
              for (let i = 1; i < ordered.length; i++) polygon.push(ordered[i]);
            } else {
              result.warnings.push(
                `edge[${edgeIdx}]: gap from previous edge (non-manifold wire?), ` +
                `dist² = ${distSq(lastPoint, firstNew).toExponential(3)}`,
              );
              for (const p of ordered) polygon.push(p);
            }
          }
        } else {
          result.warnings.push(`edge[${edgeIdx}]: Polygon3D missing or insufficient nodes`);
        }
      }
      edgeIdx++;
      exp.Next?.();
    }
  } catch (e) {
    result.warnings.push(`extractFaceBoundary wire iteration: ${String(e)}`);
  }

  // Closure: last point of last edge == first point of first edge (closed loop).
  // ADR-086 contract — first point != last (caller assumes implicit closure).
  // 만약 같으면 마지막 vertex 제거.
  if (polygon.length >= 2) {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (distSq(first, last) < DEDUP_TOL_SQ) {
      polygon.pop();
    }
  }

  if (polygon.length < 3) {
    result.warnings.push(
      `extractFaceBoundary: result polygon has only ${polygon.length} vertices (< 3 minimum)`,
    );
    return result;
  }

  // Pack to Float32Array (xyz × N flat)
  const positions = new Float32Array(polygon.length * 3);
  for (let i = 0; i < polygon.length; i++) {
    const off = i * 3;
    positions[off] = polygon[i][0];
    positions[off + 1] = polygon[i][1];
    positions[off + 2] = polygon[i][2];
  }
  result.positions = positions;

  debugLog(
    `[extractFaceBoundary] polygon ${polygon.length} verts, ` +
    `${result.warnings.length} warning(s)`,
  );
  if (result.warnings.length > 0) {
    debugWarn(`[extractFaceBoundary] warnings:`, result.warnings.slice(0, 3));
  }

  return result;
}
