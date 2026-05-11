/**
 * OCCT face wires → AxiA TrimLoop / TrimCurve2D promotion (ADR-081 W-ε,
 * ADR-036 P21.3).
 *
 * BRep face 의 boundary wires 를 2D parameter-space trim loop 로 변환.
 * 각 wire 의 edge 별 PCurve (Geom2d_Curve) 를 우리 `TrimCurve2D` enum 으로
 * 직접 매핑 — 실제 surface 의 (u, v) parameter space 에서 trim 을 정의.
 *
 * ## Rust enum 정합 (axia-geo `surfaces/trim.rs`)
 *
 * `TrimCurve2D` enum 4 variants (1:1 매핑):
 * - `Line { a, b }`
 * - `Arc { center, radius, start_angle, end_angle }`
 * - `Bezier { control_pts }`
 * - `BSpline { control_pts, knots, degree }` (non-rational only)
 *
 * `TrimLoop { curves, is_outer }` — outer boundary CCW (`is_outer=true`),
 * inner holes CW (`is_outer=false`).
 *
 * ## OCCT API 참고
 *
 * - `BRep_Tool::CurveOnSurface(edge, face, first, last)` — Handle_Geom2d_Curve
 *   https://dev.opencascade.org/doc/refman/html/class_b_rep___tool.html
 * - `BRepTools::OuterWire(face)` — outer wire 식별
 * - `TopExp_Explorer(face, TopAbs_WIRE)` — face 의 모든 wire 순회
 * - `BRepTools_WireExplorer(wire, face)` — wire 의 ordered edges
 *
 * ## occt.js Handle 래핑 함정
 *
 * Geom2d_Curve 는 Geom_Curve 와 동일 패턴:
 * - `DynamicType().get_type_name()` → 'Geom2d_Line' / 'Geom2d_Circle' / ...
 * - `Handle_Geom2d_*::DownCast(handle)?.get()` 로 raw access
 *
 * ## P21.3 lock-in
 *
 * - **Direct mapping 4종**: Line / Circle (full → Arc 0..2π) / Arc /
 *   Bezier / BSpline (non-rational)
 * - **Deferred** (W-3-ε): Geom2d_Ellipse / Geom2d_Hyperbola /
 *   Geom2d_Parabola / rational BSpline (NURBS curves on surface)
 * - **Tessellate fallback**: 모든 unsupported case → warning 누적
 */

import { debugLog, debugWarn } from '../utils/debug';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────
// TrimCurve2D / TrimLoop types — Rust mirror
// ────────────────────────────────────────────────────────────────────────

/** 2D parameter-space curve (Rust `TrimCurve2D` 1:1). */
export type TrimCurve2D =
  | { kind: 'Line'; a: [number, number]; b: [number, number] }
  | {
      kind: 'Arc';
      center: [number, number];
      radius: number;
      startAngle: number;
      endAngle: number;
    }
  | { kind: 'Bezier'; controlPts: Array<[number, number]> }
  | {
      kind: 'BSpline';
      controlPts: Array<[number, number]>;
      knots: number[];
      degree: number;
    }
  | { kind: 'Tessellate'; reason: string };

/**
 * One closed boundary loop of trim curves in (u, v) parameter space.
 *
 * - `is_outer = true` — outer boundary (CCW)
 * - `is_outer = false` — inner hole (CW)
 */
export interface TrimLoop {
  curves: TrimCurve2D[];
  isOuter: boolean;
}

/**
 * Promotion 결과 — caller (W-η) 가 SurfacePromotion.trimLoops 로 attach.
 *
 * `warnings` 는 P21.7 답습 — fatal 아닌 누적.
 */
export interface TrimPromotionResult {
  loops: TrimLoop[];
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers — wrapper version-tolerant
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

/** Read a 2D pole array via Pole/Value(i) (1-based, gp_Pnt2d). */
function read2dPolesArray(arr: any): Array<[number, number]> {
  if (!arr) return [];
  try {
    const lo: number = arr.Lower?.() ?? 1;
    const hi: number = arr.Upper?.() ?? 0;
    const pts: Array<[number, number]> = [];
    for (let i = lo; i <= hi; i++) {
      const p = arr.Value?.(i);
      if (!p) return [];
      pts.push([p.X(), p.Y()]);
    }
    return pts;
  } catch {
    return [];
  }
}

/** Read NCollection_Array1<Real> via Value(i) (1-based). */
function read1dRealArray(arr: any): number[] {
  if (!arr) return [];
  try {
    const lo: number = arr.Lower?.() ?? 1;
    const hi: number = arr.Upper?.() ?? 0;
    const vals: number[] = [];
    for (let i = lo; i <= hi; i++) {
      vals.push(Number(arr.Value?.(i) ?? 0));
    }
    return vals;
  } catch {
    return [];
  }
}

function downCast2d(occt: any, baseName: string, handle: any): any {
  const factory =
    occt?.[`Handle_Geom2d_${baseName}_2`] ??
    occt?.[`Handle_Geom2d_${baseName}_1`] ??
    occt?.[`Handle_Geom2d_${baseName}`];
  try {
    const cast = factory?.DownCast?.(handle);
    if (!cast || cast.IsNull?.()) return null;
    return cast.get?.() ?? cast;
  } catch {
    return null;
  }
}

function curve2dTypeName(curve: any): string {
  try {
    const typ = curve.DynamicType?.() ?? curve.DynamicType;
    return typ?.get_type_name?.() ?? typ?.Name?.() ?? '';
  } catch {
    return '';
  }
}

// ────────────────────────────────────────────────────────────────────────
// PCurve dispatch — Geom2d_Curve → TrimCurve2D
// ────────────────────────────────────────────────────────────────────────

/** Promote a single 2D PCurve handle to TrimCurve2D + first/last range. */
function promotePCurve(
  occt: any,
  curveHandle: any,
  first: number,
  last: number,
  warnings: string[],
): TrimCurve2D {
  if (!curveHandle || curveHandle.IsNull?.()) {
    const reason = 'PCurve handle null';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  const raw = curveHandle.get?.() ?? curveHandle;
  const name = curve2dTypeName(raw);

  try {
    switch (name) {
      case 'Geom2d_Line': {
        const line = downCast2d(occt, 'Line', curveHandle) ?? raw;
        const ax = line?.Position?.() ?? line?.Lin2d?.()?.Position?.();
        const loc = ax?.Location?.();
        const dir = ax?.Direction?.();
        if (!loc || !dir) throw new Error('Line2d Position missing');
        const ax_x = loc.X(); const ax_y = loc.Y();
        const dx = dir.X(); const dy = dir.Y();
        // OCCT 2d Line is parameterised by arc length along direction —
        // [first, last] gives the trim window.
        return {
          kind: 'Line',
          a: [ax_x + dx * first, ax_y + dy * first],
          b: [ax_x + dx * last, ax_y + dy * last],
        };
      }
      case 'Geom2d_Circle': {
        const circ = downCast2d(occt, 'Circle', curveHandle) ?? raw;
        const r: number = circ?.Radius?.() ?? 0;
        const ax = circ?.Axis?.() ?? circ?.Position?.();
        const loc = ax?.Location?.();
        if (!loc || !(r > 0)) throw new Error('Circle2d params');
        const cx = loc.X(); const cy = loc.Y();
        // Geom2d_Circle 의 parameter = angle (radians). first/last 가 trim
        // 시작/끝 angle. 0..2π 면 full circle.
        return {
          kind: 'Arc',
          center: [cx, cy],
          radius: r,
          startAngle: first,
          endAngle: last,
        };
      }
      case 'Geom2d_BezierCurve': {
        const bez = downCast2d(occt, 'BezierCurve', curveHandle) ?? raw;
        const poles = read2dPolesArray(bez?.Poles?.());
        if (poles.length < 2) throw new Error('Bezier2d poles < 2');
        return { kind: 'Bezier', controlPts: poles };
      }
      case 'Geom2d_BSplineCurve': {
        const bs = downCast2d(occt, 'BSplineCurve', curveHandle) ?? raw;
        // Skip rational — TrimCurve2D enum 에 NURBS 없음 (Rust 정합).
        if (bs?.IsRational?.()) {
          const reason = 'rational BSpline2d (NURBS) not supported in trim';
          warnings.push(reason);
          return { kind: 'Tessellate', reason };
        }
        const poles = read2dPolesArray(bs?.Poles?.());
        const knots = read1dRealArray(bs?.KnotSequence_1?.() ?? bs?.KnotSequence?.());
        const degree: number = bs?.Degree?.() ?? 0;
        if (poles.length < 2 || degree < 1) throw new Error('BSpline2d params');
        if (knots.length !== poles.length + degree + 1) {
          throw new Error(`BSpline2d knot mismatch: ${knots.length} vs ${poles.length + degree + 1}`);
        }
        return { kind: 'BSpline', controlPts: poles, knots, degree };
      }
      case 'Geom2d_TrimmedCurve': {
        // Recurse on basis curve with its own trim range
        const trim = downCast2d(occt, 'TrimmedCurve', curveHandle) ?? raw;
        const basisH = trim?.BasisCurve?.();
        if (!basisH || basisH.IsNull?.()) throw new Error('TrimmedCurve basis null');
        const tFirst: number = trim?.FirstParameter?.() ?? first;
        const tLast: number = trim?.LastParameter?.() ?? last;
        return promotePCurve(occt, basisH, tFirst, tLast, warnings);
      }
      default: {
        const reason = `Geom2d type unsupported: ${name}`;
        warnings.push(reason);
        return { kind: 'Tessellate', reason };
      }
    }
  } catch (e) {
    const reason = `PCurve ${name}: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public API — promoteTrimLoops
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract trim loops from a TopoDS_Face by walking its wires + PCurves.
 *
 * **Algorithm** (ADR-036 P21.3):
 * 1. `TopExp_Explorer(face, TopAbs_WIRE)` 로 모든 wire 순회
 * 2. `BRepTools::OuterWire(face)` 로 outer wire 식별
 * 3. 각 wire 별 `BRepTools_WireExplorer` 로 ordered edge 추출
 * 4. 각 edge 별 `BRep_Tool::CurveOnSurface(edge, face, first, last)` 로
 *    PCurve handle + parameter range 추출
 * 5. `promotePCurve(curveHandle, first, last)` → TrimCurve2D
 * 6. wire 의 모든 curve 를 `TrimLoop { curves, isOuter }` 로 packing
 *
 * **Stable order** (ADR-037 P22.7): outer wire 가 항상 `loops[0]`.
 *
 * @param occt — opencascade.js runtime
 * @param faceHandle — TopoDS_Face
 * @returns `{ loops, warnings }` — face 가 wire 없으면 `{ loops: [], … }`
 */
export function promoteTrimLoops(occt: unknown, faceHandle: unknown): TrimPromotionResult {
  const result: TrimPromotionResult = { loops: [], warnings: [] };
  if (!occt || !faceHandle) {
    result.warnings.push('promoteTrimLoops: occt or face is null');
    return result;
  }

  const o = occt as any;
  const TopAbs_WIRE = getTopAbs(o, 'TopAbs_WIRE', 5);
  const TopAbs_SHAPE = getTopAbs(o, 'TopAbs_SHAPE', 8);

  // outer wire 식별 (graceful fallback — 첫 wire)
  let outerWire: any = null;
  try {
    outerWire = o?.BRepTools?.OuterWire?.(faceHandle)
      ?? o?.BRepTools?.OuterWire_1?.(faceHandle);
  } catch {
    // ignore; first-wire heuristic 사용
  }

  const wireExp = makeExplorer(o, faceHandle, TopAbs_WIRE, TopAbs_SHAPE);
  if (!wireExp) {
    result.warnings.push('promoteTrimLoops: wire explorer unavailable');
    return result;
  }

  let wireIdx = 0;
  try {
    while (wireExp.More?.()) {
      const wire = wireExp.Current?.();
      if (wire) {
        const isOuter = outerWire ? sameShape(wire, outerWire) : (wireIdx === 0);
        const loop = collectWirePCurves(o, wire, faceHandle, wireIdx, result.warnings);
        loop.isOuter = isOuter;
        result.loops.push(loop);
      }
      wireIdx++;
      wireExp.Next?.();
    }
  } catch (e) {
    result.warnings.push(`promoteTrimLoops wire iteration: ${String(e)}`);
  }

  // outer wire 가 첫 번째가 아닐 경우 정렬 (P22.7 stable order)
  if (result.loops.length > 1) {
    const outerIdx = result.loops.findIndex(l => l.isOuter);
    if (outerIdx > 0) {
      const [outer] = result.loops.splice(outerIdx, 1);
      result.loops.unshift(outer);
    }
  }

  debugLog(`[promoteTrimLoops] ${result.loops.length} loop(s)`);
  if (result.warnings.length > 0) {
    debugWarn(`[promoteTrimLoops] ${result.warnings.length} warning(s)`);
  }

  return result;
}

/** Walk a wire's ordered edges, extracting each edge's PCurve. */
function collectWirePCurves(
  occt: any,
  wire: any,
  face: any,
  wireIdx: number,
  warnings: string[],
): TrimLoop {
  const curves: TrimCurve2D[] = [];
  const wireExp = makeWireExplorer(occt, wire, face);
  if (!wireExp) {
    warnings.push(`wire[${wireIdx}]: BRepTools_WireExplorer unavailable`);
    return { curves, isOuter: false };
  }

  let edgeIdx = 0;
  try {
    while (wireExp.More?.()) {
      const edge = wireExp.Current?.();
      if (edge) {
        const f = { current: 0 };
        const l = { current: 0 };
        const curveHandle =
          occt?.BRep_Tool?.CurveOnSurface_2?.(edge, face, f, l)
          ?? occt?.BRep_Tool?.CurveOnSurface_1?.(edge, face, f, l)
          ?? occt?.BRep_Tool?.CurveOnSurface?.(edge, face, f, l);
        if (!curveHandle || curveHandle.IsNull?.()) {
          warnings.push(`wire[${wireIdx}].edge[${edgeIdx}]: PCurve missing`);
          curves.push({ kind: 'Tessellate', reason: 'PCurve missing' });
        } else {
          const localWarnings: string[] = [];
          const c = promotePCurve(occt, curveHandle, f.current, l.current, localWarnings);
          curves.push(c);
          for (const w of localWarnings) {
            warnings.push(`wire[${wireIdx}].edge[${edgeIdx}]: ${w}`);
          }
        }
      }
      edgeIdx++;
      wireExp.Next?.();
    }
  } catch (e) {
    warnings.push(`wire[${wireIdx}] edge iteration: ${String(e)}`);
  }

  return { curves, isOuter: false }; // caller sets isOuter
}

/**
 * Identity equality on TopoDS_Shape. occt.js 의 `IsSame` / `IsEqual` 가
 * 표준이지만 binding 차이 흡수.
 */
function sameShape(a: any, b: any): boolean {
  if (a === b) return true;
  try {
    if (typeof a.IsSame === 'function') return !!a.IsSame(b);
    if (typeof a.IsEqual === 'function') return !!a.IsEqual(b);
  } catch {
    // fallthrough
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Helper — synthetic rectangular trim loop from uvBounds
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a synthetic rectangular trim loop from uvBounds.
 *
 * Used for `RectangularTrimmedSurface` 의 fast-path: PCurve 추출 없이
 * `[u_min, u_max] × [v_min, v_max]` 4 line segments (CCW outer) 로 직접 생성.
 *
 * @param uvBounds — `[u_min, u_max, v_min, v_max]`
 * @returns 4-segment outer trim loop
 */
export function rectangularTrimLoop(uvBounds: [number, number, number, number]): TrimLoop {
  const [u0, u1, v0, v1] = uvBounds;
  return {
    curves: [
      { kind: 'Line', a: [u0, v0], b: [u1, v0] },
      { kind: 'Line', a: [u1, v0], b: [u1, v1] },
      { kind: 'Line', a: [u1, v1], b: [u0, v1] },
      { kind: 'Line', a: [u0, v1], b: [u0, v0] },
    ],
    isOuter: true,
  };
}
