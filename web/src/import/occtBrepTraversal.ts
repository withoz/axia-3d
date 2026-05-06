/**
 * OCCT TopoDS_Shape → AxiA face/edge promotion (ADR-081 W-δ).
 *
 * BRep 의 face / edge 를 `TopExp_Explorer` 로 순회하면서 각각의
 * `Geom_Surface` / `Geom_Curve` 를 `promoteSurface` / `promoteCurve`
 * (W-β / W-γ) 로 활성화. 결과는 stable index 가 부여된 `PromotedFace` /
 * `PromotedEdge` 배열 + 누적 warnings.
 *
 * ## ADR-037 P22.7 (Pick → Promote owner ID) 정합
 *
 * `PromotedFace.index` / `PromotedEdge.index` 는 stable 0-based traversal
 * order. caller (FileImporter / WasmBridge) 가 import 직후 metadata
 * rebuild 단계에서 axia FaceId / EdgeId 로 매핑한다. raw OCCT TopoDS_*
 * pointer 는 절대 selection state 에 저장하지 않는다.
 *
 * ## OCCT API 참고
 *
 * - `TopExp_Explorer` — shape sub-iterator
 *   https://dev.opencascade.org/doc/refman/html/class_top_exp___explorer.html
 *   https://ocjs.org/reference-docs/classes/TopExp_Explorer
 * - `TopAbs_ShapeEnum` — face/edge/vertex enum
 *   - `TopAbs_FACE = 4`, `TopAbs_EDGE = 6`, `TopAbs_SHAPE = 8` (sentinel)
 *
 * ## occt.js wrapper version-tolerant
 *
 * - `TopExp_Explorer_2(shape, kind, toAvoid)` 가 표준이지만, `_1` /
 *   bare 형태도 흡수. enum 값은 `TopAbs_ShapeEnum.TopAbs_FACE` 또는
 *   integer literal fallback (ADR-035 P20.7 패턴).
 */

import { promoteCurve, type CurvePromotion } from './occtCurvePromote';
import { promoteSurface, type SurfacePromotion } from './occtSurfacePromote';
import { debugLog, debugWarn } from '../utils/debug';

/**
 * Promoted face — stable traversal index + AnalyticSurface mapping.
 *
 * `index` 는 0-based traversal order (`TopExp_Explorer` 순회 순서).
 * caller 가 axia FaceId 로 매핑 (P22.7).
 */
export interface PromotedFace {
  index: number;
  surface: SurfacePromotion;
}

/**
 * Promoted edge — stable traversal index + AnalyticCurve mapping.
 *
 * `index` 는 0-based traversal order. caller 가 axia EdgeId 로 매핑.
 */
export interface PromotedEdge {
  index: number;
  curve: CurvePromotion;
}

/**
 * Full BRep traversal result.
 *
 * `warnings` 는 P21.7 (ADR-036) 답습 — fatal 아닌 누적. caller 가
 * `ImportResult.warnings` 에 합쳐서 사용자에게 노출.
 */
export interface BRepTraversalResult {
  faces: PromotedFace[];
  edges: PromotedEdge[];
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers — wrapper version-tolerant
// ────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Read TopAbs_ShapeEnum value with integer fallback (OCCT C++ enum). */
function getTopAbs(occt: any, name: string, fallback: number): number {
  const v = occt?.TopAbs_ShapeEnum?.[name];
  return typeof v === 'number' ? v : fallback;
}

/**
 * Construct `TopExp_Explorer` (wrapper version-tolerant).
 *
 * occt.js v2 typical: `new oc.TopExp_Explorer_2(shape, kind, toAvoid)`.
 * Fallback to `_1` / bare for older/newer wrapper builds.
 */
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

// ────────────────────────────────────────────────────────────────────────
// Public API — traverseBrep
// ────────────────────────────────────────────────────────────────────────

/**
 * Iterate a TopoDS_Shape using TopExp_Explorer:
 *
 * 1. **Faces** — every `TopAbs_FACE` sub-shape → `promoteSurface` →
 *    `PromotedFace { index, surface }`
 * 2. **Edges** — every `TopAbs_EDGE` sub-shape → `promoteCurve` →
 *    `PromotedEdge { index, curve }`
 * 3. **Warnings** — per-promote warnings + global iteration warnings 누적
 *
 * **Stable index policy** (ADR-037 P22.7): index 는 traversal 순서로
 * 0-based 단조 증가. promote 가 `Tessellate` fallback 으로 떨어지더라도
 * index 는 동일하게 부여 — caller 의 owner-ID mapping 이 traversal
 * order 와 일치.
 *
 * @param occt — opencascade.js runtime instance
 * @param shape — TopoDS_Shape (compound / shell / solid / face)
 * @returns 누적된 traversal 결과. occt 또는 shape 가 null 이면
 *   `{ faces: [], edges: [], warnings: [...] }` graceful 반환.
 */
export function traverseBrep(occt: unknown, shape: unknown): BRepTraversalResult {
  const result: BRepTraversalResult = { faces: [], edges: [], warnings: [] };

  if (!occt || !shape) {
    result.warnings.push('traverseBrep: occt or shape is null');
    return result;
  }

  const o = occt as any;
  const TopAbs_FACE = getTopAbs(o, 'TopAbs_FACE', 4);
  const TopAbs_EDGE = getTopAbs(o, 'TopAbs_EDGE', 6);
  const TopAbs_SHAPE = getTopAbs(o, 'TopAbs_SHAPE', 8);

  // ── Face traversal ──
  const faceExp = makeExplorer(o, shape, TopAbs_FACE, TopAbs_SHAPE);
  if (!faceExp) {
    result.warnings.push('traverseBrep: TopExp_Explorer for faces unavailable');
  } else {
    let faceIdx = 0;
    try {
      while (faceExp.More?.()) {
        const face = faceExp.Current?.();
        if (face) {
          const { promotion, warnings } = promoteSurface(o, face);
          result.faces.push({ index: faceIdx, surface: promotion });
          for (const w of warnings) result.warnings.push(`face[${faceIdx}]: ${w}`);
        } else {
          result.warnings.push(`face[${faceIdx}]: Current() returned null`);
        }
        faceIdx++;
        faceExp.Next?.();
      }
    } catch (e) {
      result.warnings.push(`traverseBrep face iteration: ${String(e)}`);
    }
    debugLog(`[traverseBrep] traversed ${faceIdx} faces`);
  }

  // ── Edge traversal ──
  const edgeExp = makeExplorer(o, shape, TopAbs_EDGE, TopAbs_SHAPE);
  if (!edgeExp) {
    result.warnings.push('traverseBrep: TopExp_Explorer for edges unavailable');
  } else {
    let edgeIdx = 0;
    try {
      while (edgeExp.More?.()) {
        const edge = edgeExp.Current?.();
        if (edge) {
          const { promotion, warnings } = promoteCurve(o, edge);
          result.edges.push({ index: edgeIdx, curve: promotion });
          for (const w of warnings) result.warnings.push(`edge[${edgeIdx}]: ${w}`);
        } else {
          result.warnings.push(`edge[${edgeIdx}]: Current() returned null`);
        }
        edgeIdx++;
        edgeExp.Next?.();
      }
    } catch (e) {
      result.warnings.push(`traverseBrep edge iteration: ${String(e)}`);
    }
    debugLog(`[traverseBrep] traversed ${edgeIdx} edges`);
  }

  if (result.warnings.length > 0) {
    debugWarn(`[traverseBrep] ${result.warnings.length} warning(s) accumulated`);
  }

  return result;
}
