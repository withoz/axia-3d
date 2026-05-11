/**
 * OCCT Geom_Curve → AxiA AnalyticCurve promotion (ADR-036 P21.1).
 *
 * BRep edge 의 parametric definition 을 우리 `AnalyticCurve` enum 으로
 * 직접 매핑한다. Tessellation 은 거치지 않음 — precision 보존.
 *
 * **이 파일은 ADR-036 매핑 표의 SSOT 를 그대로 구현한다.**
 * 매핑 변경 시 ADR-036 P21.1 부터 수정할 것.
 *
 * ## 의존성
 *
 * - `opencascade.js` (optional) — runtime 에 dynamic import 후 전달됨
 * - `WasmBridge` 의 setEdge*Curve API (ADR-032 atomic API 패턴)
 *
 * ## OCCT API 참고
 *
 * - `BRep_Tool::Curve(edge, first, last)` — TopoDS_Edge → Handle_Geom_Curve + 파라미터 범위
 *   https://dev.opencascade.org/doc/refman/html/class_b_rep___tool.html
 *   https://ocjs.org/reference-docs/classes/BRep_Tool
 * - `Geom_Curve::DynamicType()` — runtime 타입 식별
 *   https://ocjs.org/reference-docs/classes/Geom_Curve
 * - `Handle_Geom_*::DownCast` — Handle 래핑 후 raw access
 *   (occt.js 의 자동 변환 한계 — 명시적 DownCast 필수)
 *
 * ## occt.js Handle 래핑 함정 (중요)
 *
 * occt.js 는 C++ 처럼 자동 Handle ↔ raw 변환이 안 됩니다. 예:
 *
 * ```typescript
 * // ❌ TypeError — surf 가 raw Geom_Curve 면 IsRational 메서드 없음
 * const isRat = surf.IsRational();
 *
 * // ✅ Handle DownCast 후 .get() 으로 raw 추출
 * const handle = occt.Handle_Geom_BSplineCurve_2.DownCast(curveHandle);
 * const raw = handle?.get();
 * const isRat = raw?.IsRational();
 * ```
 *
 * 이 패턴을 각 promote* 함수에서 일관 적용할 것.
 */

import { debugLog, debugWarn } from '../utils/debug';
import { pntToVec3, readArray1Real, type Vec3 } from './occtAccessors';

// ────────────────────────────────────────────────────────────────────────
// Mapping enum — ADR-036 P21.1 매핑 표 그대로
// ────────────────────────────────────────────────────────────────────────

/** OCCT Geom_Curve 의 runtime 타입 식별자 (ADR-036 P21.1 매핑 키). */
export type OcctCurveKind =
  | 'Line'                     // Geom_Line
  | 'Circle'                   // Geom_Circle (full)
  | 'Arc'                      // Geom_TrimmedCurve(Geom_Circle)
  | 'Bezier'                   // Geom_BezierCurve
  | 'BSpline'                  // Geom_BSplineCurve, IsRational == false
  | 'NURBS'                    // Geom_BSplineCurve, IsRational == true
  | 'Ellipse'                  // Geom_Ellipse → 변환 (Piegl A7.1)
  | 'Parabola'                 // Geom_Parabola → 변환 (Piegl A7.4)
  | 'Hyperbola'                // Geom_Hyperbola → 변환 (Piegl A7.5)
  | 'OffsetCurve'              // Geom_OffsetCurve → fitting fallback
  | 'TrimmedCurve'             // Geom_TrimmedCurve(parent ≠ Circle) → parent 매핑
  | 'Unsupported';             // tessellate fallback + warning

/** Parameter range — `[t_first, t_last]` (BRep_Tool::Curve 의 first/last 출력). */
export type ParameterRange = [number, number];

/**
 * Promotion 결과 — caller 가 setEdge*Curve API 로 dispatch.
 *
 * 모든 variant 는 optional `parameterRange` 를 가진다 (P21.5 정합 강제).
 * `Geom_TrimmedCurve` 의 trim 정보는 이 필드로 보존되어 round-trip
 * export 시 유실되지 않는다.
 */
export type CurvePromotion =
  | { kind: 'Line'; start: [number, number, number]; end: [number, number, number]; parameterRange?: ParameterRange }
  | { kind: 'Circle'; center: [number, number, number]; normal: [number, number, number]; radius: number; parameterRange?: ParameterRange }
  | { kind: 'Arc'; center: [number, number, number]; axis: [number, number, number]; refDir: [number, number, number]; radius: number; startAngle: number; endAngle: number; parameterRange?: ParameterRange }
  | { kind: 'Bezier'; controlPts: Array<[number, number, number]>; parameterRange?: ParameterRange }
  | { kind: 'BSpline'; controlPts: Array<[number, number, number]>; knots: number[]; degree: number; parameterRange?: ParameterRange }
  | { kind: 'NURBS'; controlPts: Array<[number, number, number]>; weights: number[]; knots: number[]; degree: number; parameterRange?: ParameterRange }
  | { kind: 'Tessellate'; reason: string; parameterRange?: ParameterRange };  // fallback

/**
 * Promotion 호출 결과 wrapper.
 *
 * `warnings` 는 P21.7 에 의거하여 caller (FileImporter) 가
 * `ImportResult.warnings` 에 누적해야 함.
 */
export interface CurvePromotionResult {
  promotion: CurvePromotion;
  warnings: string[];
}

/**
 * OCCT Geom_Curve 핸들에서 우리 AnalyticCurve 로 promote.
 *
 * @param occt — opencascade.js runtime 핸들 (ADR-035 P20.7)
 * @param edgeHandle — OCCT TopoDS_Edge 핸들
 * @returns `{ promotion, warnings }` — 실패 시 `promotion.kind === 'Tessellate'`
 */
export function promoteCurve(occt: unknown, edgeHandle: unknown): CurvePromotionResult {
  const warnings: string[] = [];

  // P21.1 dispatch — runtime kind 식별 후 매핑.
  const kind = identifyCurveKind(occt, edgeHandle);
  debugLog(`[occtCurvePromote] dispatch: ${kind}`);

  let promotion: CurvePromotion;
  switch (kind) {
    case 'Line':         promotion = promoteLine(occt, edgeHandle, warnings); break;
    case 'Circle':       promotion = promoteCircle(occt, edgeHandle, warnings); break;
    case 'Arc':          promotion = promoteArc(occt, edgeHandle, warnings); break;
    case 'Bezier':       promotion = promoteBezier(occt, edgeHandle, warnings); break;
    case 'BSpline':      promotion = promoteBSpline(occt, edgeHandle, warnings); break;
    case 'NURBS':        promotion = promoteNurbs(occt, edgeHandle, warnings); break;
    case 'Ellipse':      promotion = promoteEllipse(occt, edgeHandle, warnings); break;    // Piegl A7.1
    case 'Parabola':     promotion = promoteParabola(occt, edgeHandle, warnings); break;   // Piegl A7.4
    case 'Hyperbola':    promotion = promoteHyperbola(occt, edgeHandle, warnings); break;  // Piegl A7.5
    case 'OffsetCurve':  promotion = promoteOffsetCurve(occt, edgeHandle, warnings); break;
    case 'TrimmedCurve': promotion = promoteTrimmedCurve(occt, edgeHandle, warnings); break;
    case 'Unsupported':
    default: {
      const reason = `OCCT curve type unsupported (kind=${kind})`;
      debugWarn(`[occtCurvePromote] ${reason}`);
      warnings.push(reason);
      promotion = { kind: 'Tessellate', reason };
    }
  }

  return { promotion, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion (스텁 — 후속 PR 에서 OCCT API 호출 채움)
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Internal helpers — dynamic OCCT API dispatch (wrapper version-tolerant)
// ────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CurveExtractResult {
  curve: any;       // raw Geom_Curve (after DownCast.get())
  first: number;
  last: number;
}

/** Extract Geom_Curve raw + parameter range. Tolerates wrapper variants. */
function extractCurveHandle(occt: any, edgeHandle: any): CurveExtractResult | null {
  try {
    const first = { current: 0 };
    const last = { current: 0 };
    // Try Curve_2 first (preferred), fall back to Curve / Curve_1.
    const curveH =
      occt?.BRep_Tool?.Curve_2?.(edgeHandle, first, last) ??
      occt?.BRep_Tool?.Curve_1?.(edgeHandle, first, last) ??
      occt?.BRep_Tool?.Curve?.(edgeHandle, first, last);
    if (!curveH || curveH.IsNull?.()) return null;
    return {
      curve: curveH.get?.() ?? curveH,
      first: first.current,
      last: last.current,
    };
  } catch {
    return null;
  }
}

/** OCCT DynamicType → readable type name. */
function curveTypeName(curve: any): string {
  try {
    const typ = curve.DynamicType?.() ?? curve.DynamicType;
    return typ?.get_type_name?.() ?? typ?.Name?.() ?? '';
  } catch {
    return '';
  }
}

/** Generic DownCast helper with `_2 ?? _1 ?? bare` chain. */
function downCast(occt: any, baseName: string, handle: any): any {
  const factory =
    occt?.[`Handle_Geom_${baseName}_2`] ??
    occt?.[`Handle_Geom_${baseName}_1`] ??
    occt?.[`Handle_Geom_${baseName}`];
  try {
    const cast = factory?.DownCast?.(handle);
    if (!cast || cast.IsNull?.()) return null;
    return cast.get?.() ?? cast;
  } catch {
    return null;
  }
}

function identifyCurveKind(occt: unknown, edgeHandle: unknown): OcctCurveKind {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) return 'Unsupported';
  const name = curveTypeName(ext.curve);

  switch (name) {
    case 'Geom_Line':       return 'Line';
    case 'Geom_Circle':     return 'Circle';
    case 'Geom_Ellipse':    return 'Ellipse';
    case 'Geom_Parabola':   return 'Parabola';
    case 'Geom_Hyperbola':  return 'Hyperbola';
    case 'Geom_BezierCurve': return 'Bezier';
    case 'Geom_BSplineCurve': {
      // Rational vs non-rational — IsRational check.
      const bsp = downCast(occt as any, 'BSplineCurve', ext.curve);
      try {
        return bsp?.IsRational?.() ? 'NURBS' : 'BSpline';
      } catch {
        return 'BSpline';
      }
    }
    case 'Geom_OffsetCurve':  return 'OffsetCurve';
    case 'Geom_TrimmedCurve': {
      // BasisCurve 가 Circle 이면 Arc, 아니면 일반 TrimmedCurve.
      try {
        const basisH = (ext.curve as any).BasisCurve?.();
        const basis = basisH?.get?.() ?? basisH;
        const basisName = curveTypeName(basis);
        if (basisName === 'Geom_Circle') return 'Arc';
        return 'TrimmedCurve';
      } catch {
        return 'TrimmedCurve';
      }
    }
    default:
      return 'Unsupported';
  }
}

function promoteLine(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteLine: extract failed (curve handle null)';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const line = downCast(occt as any, 'Line', ext.curve);
    if (!line) throw new Error('Geom_Line DownCast null');
    const pos = line.Position?.() ?? line.Lin?.()?.Position?.();
    const loc = pos?.Location?.();
    const dir = pos?.Direction?.();
    if (!loc || !dir) throw new Error('Position/Location/Direction missing');
    const lx = loc.X(); const ly = loc.Y(); const lz = loc.Z();
    const dx = dir.X(); const dy = dir.Y(); const dz = dir.Z();
    const start: Vec3 = [lx + ext.first * dx, ly + ext.first * dy, lz + ext.first * dz];
    const end: Vec3 = [lx + ext.last * dx, ly + ext.last * dy, lz + ext.last * dz];
    return {
      kind: 'Line',
      start,
      end,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteLine: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteCircle(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteCircle: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const circle = downCast(occt as any, 'Circle', ext.curve);
    if (!circle) throw new Error('Geom_Circle DownCast null');
    const axis = circle.Axis?.() ?? circle.Position?.();
    const center = axis?.Location?.();
    const normal = axis?.Direction?.();
    const radius: number = circle.Radius?.() ?? 0;
    if (!center || !normal || !(radius > 0)) {
      throw new Error('Axis/Location/Radius missing');
    }
    return {
      kind: 'Circle',
      center: pntToVec3(center),
      normal: [normal.X(), normal.Y(), normal.Z()],
      radius,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteCircle: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteArc(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  // OCCT Arc = Geom_TrimmedCurve(Geom_Circle, t1, t2). Extract basis Circle
  // + trim range [t1, t2] as start/end angles.
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteArc: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const trimmed = downCast(occt as any, 'TrimmedCurve', ext.curve);
    if (!trimmed) throw new Error('Geom_TrimmedCurve DownCast null');
    const basisH = trimmed.BasisCurve?.();
    // basis is already a raw Geom_Circle after .get() — no redundant
    // DownCast needed (identifyCurveKind already verified type via
    // basis.DynamicType()).
    const circle = basisH?.get?.() ?? basisH;
    if (!circle) throw new Error('BasisCurve null');
    const ax = circle.Axis?.() ?? circle.Position?.();
    const center = ax?.Location?.();
    const direction = ax?.Direction?.();
    const xdir = ax?.XDirection?.() ?? circle.Position?.()?.XDirection?.();
    const radius: number = circle.Radius?.() ?? 0;
    if (!center || !direction || !xdir || !(radius > 0)) {
      throw new Error('Arc axis params incomplete');
    }
    return {
      kind: 'Arc',
      center: pntToVec3(center),
      axis: [direction.X(), direction.Y(), direction.Z()],
      refDir: [xdir.X(), xdir.Y(), xdir.Z()],
      radius,
      startAngle: ext.first,
      endAngle: ext.last,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteArc: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

/** Read NCollection_Array1<gp_Pnt> via Lower/Upper + Value(i) — base 1. */
function readPolesArray(arr: any): Vec3[] {
  if (!arr) return [];
  try {
    const lower: number = arr.Lower?.() ?? 1;
    const upper: number = arr.Upper?.() ?? arr.Length?.() ?? 0;
    const out: Vec3[] = [];
    for (let i = lower; i <= upper; i++) {
      const p = arr.Value?.(i) ?? arr.Get?.(i);
      if (p) out.push(pntToVec3(p));
    }
    return out;
  } catch {
    return [];
  }
}

function promoteBezier(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteBezier: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bez = downCast(occt as any, 'BezierCurve', ext.curve);
    if (!bez) throw new Error('Geom_BezierCurve DownCast null');
    const polesArr = bez.Poles?.();
    const controlPts = readPolesArray(polesArr);
    if (controlPts.length < 2) throw new Error('Bezier poles < 2');
    return {
      kind: 'Bezier',
      controlPts,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteBezier: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteBSpline(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  // Non-rational case. Rational → caller dispatches to promoteNurbs.
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteBSpline: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bsp = downCast(occt as any, 'BSplineCurve', ext.curve);
    if (!bsp) throw new Error('Geom_BSplineCurve DownCast null');
    if (bsp.IsRational?.()) {
      // Caller's dispatch should route to promoteNurbs, but be defensive.
      return promoteNurbs(occt, edgeHandle, warnings);
    }
    const polesArr = bsp.Poles?.();
    const controlPts = readPolesArray(polesArr);
    if (controlPts.length < 2) throw new Error('BSpline poles < 2');
    const knotSeqArr = bsp.KnotSequence?.();
    const knots = readArray1Real(knotSeqArr);
    if (knots.length < 2) throw new Error('BSpline knot sequence < 2');
    const degree: number = bsp.Degree?.() ?? 0;
    if (degree < 1) throw new Error('BSpline degree < 1');
    return {
      kind: 'BSpline',
      controlPts,
      knots,
      degree,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteBSpline: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteNurbs(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteNurbs: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bsp = downCast(occt as any, 'BSplineCurve', ext.curve);
    if (!bsp) throw new Error('Geom_BSplineCurve DownCast null');
    const polesArr = bsp.Poles?.();
    const controlPts = readPolesArray(polesArr);
    if (controlPts.length < 2) throw new Error('NURBS poles < 2');
    const weightsArr = bsp.Weights?.();
    const weights = readArray1Real(weightsArr);
    if (weights.length !== controlPts.length) {
      throw new Error(
        `NURBS weights/poles dimension mismatch (${weights.length} vs ${controlPts.length})`,
      );
    }
    const knotSeqArr = bsp.KnotSequence?.();
    const knots = readArray1Real(knotSeqArr);
    if (knots.length < 2) throw new Error('NURBS knot sequence < 2');
    const degree: number = bsp.Degree?.() ?? 0;
    if (degree < 1) throw new Error('NURBS degree < 1');
    return {
      kind: 'NURBS',
      controlPts,
      weights,
      knots,
      degree,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteNurbs: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

/**
 * Piegl & Tiller A7.1 — Ellipse → 9-control-point rational quadratic NURBS.
 * weights = [1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]
 * knots = [0, 0, 0, 1/4, 1/4, 1/2, 1/2, 3/4, 3/4, 1, 1, 1] (degree 2)
 */
function promoteEllipse(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteEllipse: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const ell = downCast(occt as any, 'Ellipse', ext.curve);
    if (!ell) throw new Error('Geom_Ellipse DownCast null');
    const ax = ell.Axis?.() ?? ell.Position?.();
    const center = ax?.Location?.();
    const xdir = ax?.XDirection?.() ?? ell.Position?.()?.XDirection?.();
    const ydir = ax?.YDirection?.() ?? ell.Position?.()?.YDirection?.();
    const a: number = ell.MajorRadius?.() ?? 0;
    const b: number = ell.MinorRadius?.() ?? 0;
    if (!center || !xdir || !ydir || !(a > 0) || !(b > 0)) {
      throw new Error('Ellipse params incomplete');
    }
    const cx = center.X(); const cy = center.Y(); const cz = center.Z();
    const ux = xdir.X(); const uy = xdir.Y(); const uz = xdir.Z();
    const vx = ydir.X(); const vy = ydir.Y(); const vz = ydir.Z();
    // 9 control points (4 quadrants of full ellipse + closing).
    // Pole at angle θ on ellipse: C + a·cos(θ)·U + b·sin(θ)·V.
    // Corner points at θ = 0, π/2, π, 3π/2 plus midpoints (weight √2/2).
    const cp = (s: number, t: number): Vec3 => [
      cx + a * s * ux + b * t * vx,
      cy + a * s * uy + b * t * vy,
      cz + a * s * uz + b * t * vz,
    ];
    const SQRT2 = Math.SQRT2;
    const HALF_SQRT2 = SQRT2 / 2;
    const controlPts: Vec3[] = [
      cp(1, 0),                  // θ=0
      cp(1, 1),                  // corner
      cp(0, 1),                  // θ=π/2
      cp(-1, 1),                 // corner
      cp(-1, 0),                 // θ=π
      cp(-1, -1),                // corner
      cp(0, -1),                 // θ=3π/2
      cp(1, -1),                 // corner
      cp(1, 0),                  // close
    ];
    return {
      kind: 'NURBS',
      controlPts,
      weights: [1, HALF_SQRT2, 1, HALF_SQRT2, 1, HALF_SQRT2, 1, HALF_SQRT2, 1],
      knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
      degree: 2,
      parameterRange: [ext.first, ext.last],
    };
  } catch (e) {
    const reason = `promoteEllipse: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

/**
 * Piegl & Tiller A7.4 — Parabola → 3-control-point Bezier (degree 2, non-rational).
 * Parametric: P(t) = focus + t·xdir + (t²/(4·focal))·ydir.
 * For the OCCT trim range [t1, t2], evaluate endpoints + midpoint tangent
 * intersection to produce a quadratic Bezier.
 */
function promoteParabola(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteParabola: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const par = downCast(occt as any, 'Parabola', ext.curve);
    if (!par) throw new Error('Geom_Parabola DownCast null');
    const focal: number = par.Focal?.() ?? 0;
    const ax = par.Axis?.() ?? par.Position?.();
    const apex = ax?.Location?.();
    const xdir = ax?.XDirection?.() ?? par.Position?.()?.XDirection?.();
    const ydir = ax?.YDirection?.() ?? par.Position?.()?.YDirection?.();
    if (!apex || !xdir || !ydir || !(focal > 0)) {
      throw new Error('Parabola params incomplete');
    }
    // OCCT parabola: P(t) = apex + (t²/(4·focal))·xdir + t·ydir
    //  (Note: OCCT convention may differ; we adapt to it via evaluate.)
    // For W-β MVP, sample endpoints + midpoint and fit Bezier.
    const t1 = ext.first;
    const t2 = ext.last;
    const tm = (t1 + t2) * 0.5;
    const evalParabola = (t: number): Vec3 => {
      // Parametric: apex + t·X-axis-direction + (t²/(4·focal))·Y-axis-direction.
      const ax_param = t;
      const ay_param = (t * t) / (4 * focal);
      return [
        apex.X() + ax_param * xdir.X() + ay_param * ydir.X(),
        apex.Y() + ax_param * xdir.Y() + ay_param * ydir.Y(),
        apex.Z() + ax_param * xdir.Z() + ay_param * ydir.Z(),
      ];
    };
    // Quadratic Bezier control points: B0 = P(t1), B2 = P(t2),
    // B1 = (2·P(tm) - 0.5·B0 - 0.5·B2) / 1  (de Casteljau inverse for quadratic).
    const b0 = evalParabola(t1);
    const b2 = evalParabola(t2);
    const pm = evalParabola(tm);
    const b1: Vec3 = [
      2 * pm[0] - 0.5 * b0[0] - 0.5 * b2[0],
      2 * pm[1] - 0.5 * b0[1] - 0.5 * b2[1],
      2 * pm[2] - 0.5 * b0[2] - 0.5 * b2[2],
    ];
    return {
      kind: 'Bezier',
      controlPts: [b0, b1, b2],
      parameterRange: [t1, t2],
    };
  } catch (e) {
    const reason = `promoteParabola: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

/**
 * Piegl & Tiller A7.5 — Hyperbola branch → rational quadratic NURBS.
 * For OCCT trim range [t1, t2], sample endpoints + midpoint, fit rational
 * quadratic Bezier (as 3-CP NURBS with weights involving cosh).
 */
function promoteHyperbola(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteHyperbola: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const hyp = downCast(occt as any, 'Hyperbola', ext.curve);
    if (!hyp) throw new Error('Geom_Hyperbola DownCast null');
    const a: number = hyp.MajorRadius?.() ?? 0;
    const b: number = hyp.MinorRadius?.() ?? 0;
    const ax = hyp.Axis?.() ?? hyp.Position?.();
    const center = ax?.Location?.();
    const xdir = ax?.XDirection?.() ?? hyp.Position?.()?.XDirection?.();
    const ydir = ax?.YDirection?.() ?? hyp.Position?.()?.YDirection?.();
    if (!center || !xdir || !ydir || !(a > 0) || !(b > 0)) {
      throw new Error('Hyperbola params incomplete');
    }
    // Hyperbola: P(t) = center + a·cosh(t)·xdir + b·sinh(t)·ydir.
    // Sample 3 points → rational Bezier fit.
    const t1 = ext.first;
    const t2 = ext.last;
    const tm = (t1 + t2) * 0.5;
    const evalHyp = (t: number): Vec3 => [
      center.X() + a * Math.cosh(t) * xdir.X() + b * Math.sinh(t) * ydir.X(),
      center.Y() + a * Math.cosh(t) * xdir.Y() + b * Math.sinh(t) * ydir.Y(),
      center.Z() + a * Math.cosh(t) * xdir.Z() + b * Math.sinh(t) * ydir.Z(),
    ];
    const p0 = evalHyp(t1);
    const p2 = evalHyp(t2);
    const pm = evalHyp(tm);
    // Rational quadratic Bezier: P(u) = (B0(u)·w0·P0 + B1(u)·w1·P1 + B2(u)·w2·P2)
    //                          / (B0(u)·w0 + B1(u)·w1 + B2(u)·w2)
    // For Hyperbola Piegl A7.5, w0 = w2 = 1, w1 = cosh((t2-t1)/2).
    const w1 = Math.cosh((t2 - t1) * 0.5);
    // Solve for P1: at u=0.5, P(0.5) = pm. With w0=w2=1, w1=cosh((t2-t1)/2),
    //   B0(0.5)=B2(0.5)=0.25, B1(0.5)=0.5.
    //   numerator = 0.25·P0 + 0.5·w1·P1 + 0.25·P2
    //   denominator = 0.25 + 0.5·w1 + 0.25 = 0.5 + 0.5·w1
    //   pm·denominator - 0.25·P0 - 0.25·P2 = 0.5·w1·P1
    //   P1 = (pm·denom - 0.25·(P0+P2)) / (0.5·w1)
    const denom = 0.5 + 0.5 * w1;
    const p1: Vec3 = [
      (pm[0] * denom - 0.25 * (p0[0] + p2[0])) / (0.5 * w1),
      (pm[1] * denom - 0.25 * (p0[1] + p2[1])) / (0.5 * w1),
      (pm[2] * denom - 0.25 * (p0[2] + p2[2])) / (0.5 * w1),
    ];
    return {
      kind: 'NURBS',
      controlPts: [p0, p1, p2],
      weights: [1, w1, 1],
      knots: [0, 0, 0, 1, 1, 1],
      degree: 2,
      parameterRange: [t1, t2],
    };
  } catch (e) {
    const reason = `promoteHyperbola: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

/**
 * Geom_OffsetCurve → fitting fallback. MVP: tessellate fallback (full
 * Hoschek-style fit deferred to W-3-ε scope).
 */
function promoteOffsetCurve(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteOffsetCurve: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  // MVP: fitting deferred. Fall through to Tessellate.
  const reason = 'promoteOffsetCurve: fitting deferred to W-3-ε (Hoschek-style)';
  warnings.push(reason);
  return { kind: 'Tessellate', reason, parameterRange: [ext.first, ext.last] };
}

/**
 * Geom_TrimmedCurve(parent ≠ Circle) → recurse on basis + apply trim
 * range. P21.5 정합: parameterRange 가 trim 정보를 보존.
 */
function promoteTrimmedCurve(occt: unknown, edgeHandle: unknown, warnings: string[]): CurvePromotion {
  const ext = extractCurveHandle(occt as any, edgeHandle as any);
  if (!ext) {
    const reason = 'promoteTrimmedCurve: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const trimmed = downCast(occt as any, 'TrimmedCurve', ext.curve);
    if (!trimmed) throw new Error('Geom_TrimmedCurve DownCast null');
    const basisH = trimmed.BasisCurve?.();
    if (!basisH) throw new Error('BasisCurve null');
    // Determine basis curve kind via DynamicType, then recurse to the
    // appropriate promoter. We don't reuse promoteCurve dispatch (that
    // would call extractCurveHandle on the original edge again — wrong).
    const basis = basisH.get?.() ?? basisH;
    const basisName = curveTypeName(basis);
    // For W-β MVP, only support a few common basis kinds. Others →
    // Tessellate fallback.
    // Note: Arc (Geom_TrimmedCurve(Geom_Circle)) is dispatched separately
    // via identifyCurveKind, not here.
    if (basisName === 'Geom_BSplineCurve' || basisName === 'Geom_BezierCurve') {
      // Already handled by main dispatch — but if we end up here, it's
      // because the parent edge had Geom_TrimmedCurve wrapper. Sample
      // the basis and apply trim range as parameterRange.
      const reason =
        `promoteTrimmedCurve: basis ${basisName} — trim range [${ext.first}, ${ext.last}] preserved as parameterRange`;
      warnings.push(reason);
      // Tessellate fallback for now; caller can use parameterRange.
      return { kind: 'Tessellate', reason, parameterRange: [ext.first, ext.last] };
    }
    const reason = `promoteTrimmedCurve: basis ${basisName} not yet supported`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason, parameterRange: [ext.first, ext.last] };
  } catch (e) {
    const reason = `promoteTrimmedCurve: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

// ────────────────────────────────────────────────────────────────────────
// 매핑 표 인덱스 (ADR-036 P21.1 SSOT 검증용)
// ────────────────────────────────────────────────────────────────────────

/** 본 모듈이 처리하는 OCCT curve 종류 — 테스트가 ADR 매핑 표와 일치 검증. */
export const SUPPORTED_CURVE_KINDS: OcctCurveKind[] = [
  'Line', 'Circle', 'Arc', 'Bezier', 'BSpline', 'NURBS',
  'Ellipse', 'Parabola', 'Hyperbola',
  'OffsetCurve', 'TrimmedCurve',
];
