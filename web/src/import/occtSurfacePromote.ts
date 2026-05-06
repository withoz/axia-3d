/**
 * OCCT Geom_Surface → AxiA AnalyticSurface promotion (ADR-036 P21.2).
 *
 * BRep face 의 parametric definition 을 우리 `AnalyticSurface` enum 으로
 * 직접 매핑한다. Tessellation 은 fallback 일 뿐 — precision 보존.
 *
 * **이 파일은 ADR-036 매핑 표의 SSOT 를 그대로 구현한다.**
 * 매핑 변경 시 ADR-036 P21.2 부터 수정할 것.
 *
 * ## OCCT API 참고
 *
 * - `BRep_Tool::Surface(face)` — TopoDS_Face → Handle_Geom_Surface
 *   https://dev.opencascade.org/doc/refman/html/class_b_rep___tool.html
 *   https://ocjs.org/reference-docs/classes/BRep_Tool
 * - `Geom_Surface::DynamicType()` — runtime 타입 식별
 *   https://ocjs.org/reference-docs/classes/Geom_Surface
 * - `Geom_BSplineSurface::IsURational / IsVRational / Poles / Weights / UKnotSequence`
 *   https://ocjs.org/reference-docs/classes/Geom_BSplineSurface
 * - `Handle_Geom_*::DownCast` — Handle 래핑 후 raw access
 *
 * ## occt.js Handle 래핑 함정 (중요, github issue 보고됨)
 *
 * occt.js 는 C++ 처럼 자동 Handle ↔ raw 변환이 안 됩니다. 예:
 *
 * ```typescript
 * // ❌ TypeError — surf 가 raw Geom_Surface 면 IsURational 메서드 없음
 * const isRat = surf.IsURational();
 *
 * // ✅ Handle DownCast 후 .get() 으로 raw 추출
 * const handle = occt.Handle_Geom_BSplineSurface_2.DownCast(surfHandle);
 * const raw = handle?.get();
 * const isRat = raw?.IsURational() || raw?.IsVRational();
 * ```
 *
 * 이 패턴을 각 promote* 함수에서 일관 적용할 것.
 *
 * ## NCollection_Array2 인덱스 함정
 *
 * Poles / Weights 는 NCollection_Array2 (1-based) 임:
 * - `LowerRow()` = 1, `UpperRow()` = NbUPoles
 * - `LowerCol()` = 1, `UpperCol()` = NbVPoles
 * - 우리 ctrlGrid 는 0-based row-major (`grid[i][j]`, i = u-index, j = v-index)
 *   → ADR-036 P21.2 의 "row-major copy" 정합 강제
 */

import { debugLog, debugWarn } from '../utils/debug';
import { pntToVec3, readArray1Real, type Vec3 } from './occtAccessors';
import {
  promoteTrimLoops,
  rectangularTrimLoop,
  type TrimLoop,
} from './occtTrimPromote';

// ────────────────────────────────────────────────────────────────────────
// Mapping enum — ADR-036 P21.2 매핑 표 그대로
// ────────────────────────────────────────────────────────────────────────

/** OCCT Geom_Surface 의 runtime 타입 식별자 (ADR-036 P21.2 매핑 키). */
export type OcctSurfaceKind =
  | 'Plane'                       // Geom_Plane
  | 'Cylinder'                    // Geom_CylindricalSurface
  | 'Sphere'                      // Geom_SphericalSurface
  | 'Cone'                        // Geom_ConicalSurface
  | 'Torus'                       // Geom_ToroidalSurface
  | 'BezierSurface'               // Geom_BezierSurface
  | 'BSplineSurface'              // Geom_BSplineSurface, IsURational==false && IsVRational==false
  | 'NURBSSurface'                // Geom_BSplineSurface, IsURational || IsVRational
  | 'SurfaceOfRevolution'         // Geom_SurfaceOfRevolution → 변환 (Piegl A8.1)
  | 'SurfaceOfLinearExtrusion'    // Geom_SurfaceOfLinearExtrusion → 변환 (Piegl A8.2)
  | 'OffsetSurface'               // Geom_OffsetSurface → fitting fallback
  | 'RectangularTrimmedSurface'   // parent 매핑 + uv_bounds clip
  | 'Unsupported';                // tessellate fallback + warning

/** UV bounds — `[u_min, u_max, v_min, v_max]` (parent 의 parameter range clip). */
export type UvBounds = [number, number, number, number];

/**
 * Promotion 결과 — caller 가 setFaceSurface* WASM API 로 dispatch.
 *
 * 모든 variant 는 optional `uvBounds` 를 가진다 (P21.2 RectangularTrimmedSurface
 * 정합 + Phase G2 trim_loops 동기화 강제). Trim 정보는 이 필드로 보존되어
 * round-trip export 시 유실되지 않는다.
 *
 * `trimLoops?` (W-ε, ADR-036 P21.3) — 모든 variant 에 optional. NURBS-class
 * face 의 PCurve 기반 trim 또는 RectangularTrimmedSurface 의 uvBounds 합성
 * trim. 비어 있으면 `uvBounds` 단독 (rectangular outer) 으로 해석.
 */
export type SurfacePromotion =
  | { kind: 'Plane'; origin: [number, number, number]; normal: [number, number, number]; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | { kind: 'Cylinder'; axisOrigin: [number, number, number]; axisDir: [number, number, number]; refDir: [number, number, number]; radius: number; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | { kind: 'Sphere'; center: [number, number, number]; radius: number; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | { kind: 'Cone'; apex: [number, number, number]; axisDir: [number, number, number]; halfAngle: number; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | { kind: 'Torus'; center: [number, number, number]; axis: [number, number, number]; majorRadius: number; minorRadius: number; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | { kind: 'BezierPatch'; ctrlGrid: Array<Array<[number, number, number]>>; uvBounds?: UvBounds; trimLoops?: TrimLoop[] }
  | {
      kind: 'BSplineSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
      uvBounds?: UvBounds;
      trimLoops?: TrimLoop[];
    }
  | {
      kind: 'NURBSSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      weightsGrid: number[][];
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
      uvBounds?: UvBounds;
      trimLoops?: TrimLoop[];
    }
  | { kind: 'Tessellate'; reason: string; uvBounds?: UvBounds; trimLoops?: TrimLoop[] };

/**
 * Promotion 호출 결과 wrapper.
 *
 * `warnings` 는 P21.7 에 의거하여 caller (FileImporter) 가
 * `ImportResult.warnings` 에 누적해야 함.
 */
export interface SurfacePromotionResult {
  promotion: SurfacePromotion;
  warnings: string[];
}

/**
 * OCCT Geom_Surface 핸들에서 우리 AnalyticSurface 로 promote.
 *
 * @param occt — opencascade.js runtime 핸들 (ADR-035 P20.7)
 * @param faceHandle — OCCT TopoDS_Face 핸들
 * @returns `{ promotion, warnings }` — 실패 시 `promotion.kind === 'Tessellate'`
 */
export function promoteSurface(occt: unknown, faceHandle: unknown): SurfacePromotionResult {
  const warnings: string[] = [];
  const kind = identifySurfaceKind(occt, faceHandle);
  debugLog(`[occtSurfacePromote] dispatch: ${kind}`);

  let promotion: SurfacePromotion;
  switch (kind) {
    case 'Plane':                     promotion = promotePlane(occt, faceHandle, warnings); break;
    case 'Cylinder':                  promotion = promoteCylinder(occt, faceHandle, warnings); break;
    case 'Sphere':                    promotion = promoteSphere(occt, faceHandle, warnings); break;
    case 'Cone':                      promotion = promoteCone(occt, faceHandle, warnings); break;
    case 'Torus':                     promotion = promoteTorus(occt, faceHandle, warnings); break;
    case 'BezierSurface':             promotion = promoteBezierSurface(occt, faceHandle, warnings); break;
    case 'BSplineSurface':            promotion = promoteBSplineSurface(occt, faceHandle, warnings); break;
    case 'NURBSSurface':              promotion = promoteNurbsSurface(occt, faceHandle, warnings); break;
    case 'SurfaceOfRevolution':       promotion = promoteSurfaceOfRevolution(occt, faceHandle, warnings); break;
    case 'SurfaceOfLinearExtrusion':  promotion = promoteSurfaceOfLinearExtrusion(occt, faceHandle, warnings); break;
    case 'OffsetSurface':             promotion = promoteOffsetSurface(occt, faceHandle, warnings); break;
    case 'RectangularTrimmedSurface': promotion = promoteRectangularTrimmedSurface(occt, faceHandle, warnings); break;
    case 'Unsupported':
    default: {
      const reason = `OCCT surface type unsupported (kind=${kind})`;
      debugWarn(`[occtSurfacePromote] ${reason}`);
      warnings.push(reason);
      promotion = { kind: 'Tessellate', reason };
    }
  }

  // W-ε — trim loops attachment (ADR-036 P21.3).
  // RectangularTrimmedSurface 는 uvBounds 기반 합성 loop 가 이미 attach됨
  // (`promoteRectangularTrimmedSurface` 내부). 그 외 face 는 PCurve 추출 시도.
  if (promotion.kind !== 'Tessellate' && !promotion.trimLoops) {
    const trim = promoteTrimLoops(occt, faceHandle);
    if (trim.loops.length > 0) {
      promotion.trimLoops = trim.loops;
    }
    for (const w of trim.warnings) warnings.push(w);
  }

  return { promotion, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// identifySurfaceKind — DynamicType dispatch
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// Internal helpers — dynamic OCCT API dispatch (wrapper version-tolerant)
// ────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SurfaceExtractResult {
  surface: any;        // raw Geom_Surface (after .get())
  surfaceHandle: any;  // original Handle for DownCast usage
  uvBounds?: UvBounds;
}

/** Extract Geom_Surface raw + handle + uvBounds (BRepTools::UVBounds). */
function extractSurfaceHandle(occt: any, faceHandle: any): SurfaceExtractResult | null {
  try {
    const surfH =
      occt?.BRep_Tool?.Surface_2?.(faceHandle) ??
      occt?.BRep_Tool?.Surface_1?.(faceHandle) ??
      occt?.BRep_Tool?.Surface?.(faceHandle);
    if (!surfH || surfH.IsNull?.()) return null;
    const surface = surfH.get?.() ?? surfH;
    let uvBounds: UvBounds | undefined;
    try {
      const u1 = { current: 0 }; const u2 = { current: 0 };
      const v1 = { current: 0 }; const v2 = { current: 0 };
      const ok =
        occt?.BRepTools?.UVBounds_1?.(faceHandle, u1, u2, v1, v2) ??
        occt?.BRepTools?.UVBounds?.(faceHandle, u1, u2, v1, v2);
      if (ok !== false) uvBounds = [u1.current, u2.current, v1.current, v2.current];
    } catch {
      // uvBounds optional
    }
    return { surface, surfaceHandle: surfH, uvBounds };
  } catch {
    return null;
  }
}

function surfaceTypeName(surface: any): string {
  try {
    const typ = surface.DynamicType?.() ?? surface.DynamicType;
    return typ?.get_type_name?.() ?? typ?.Name?.() ?? '';
  } catch {
    return '';
  }
}

function downCastSurface(occt: any, baseName: string, handle: any): any {
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

function identifySurfaceKind(occt: unknown, faceHandle: unknown): OcctSurfaceKind {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) return 'Unsupported';
  const name = surfaceTypeName(ext.surface);

  switch (name) {
    case 'Geom_Plane':                     return 'Plane';
    case 'Geom_CylindricalSurface':        return 'Cylinder';
    case 'Geom_SphericalSurface':          return 'Sphere';
    case 'Geom_ConicalSurface':            return 'Cone';
    case 'Geom_ToroidalSurface':           return 'Torus';
    case 'Geom_BezierSurface':             return 'BezierSurface';
    case 'Geom_BSplineSurface': {
      const bs = downCastSurface(occt as any, 'BSplineSurface', ext.surfaceHandle);
      try {
        const isRat = bs?.IsURational?.() || bs?.IsVRational?.();
        return isRat ? 'NURBSSurface' : 'BSplineSurface';
      } catch {
        return 'BSplineSurface';
      }
    }
    case 'Geom_SurfaceOfRevolution':       return 'SurfaceOfRevolution';
    case 'Geom_SurfaceOfLinearExtrusion':  return 'SurfaceOfLinearExtrusion';
    case 'Geom_OffsetSurface':             return 'OffsetSurface';
    case 'Geom_RectangularTrimmedSurface': return 'RectangularTrimmedSurface';
    default:                               return 'Unsupported';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — direct mapping (1~5)
// ────────────────────────────────────────────────────────────────────────

function promotePlane(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promotePlane: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const plane = downCastSurface(occt as any, 'Plane', ext.surfaceHandle);
    if (!plane) throw new Error('Geom_Plane DownCast null');
    const ax = plane.Position?.() ?? plane.Pln?.()?.Position?.();
    const loc = ax?.Location?.();
    const dir = ax?.Direction?.() ?? ax?.Axis?.()?.Direction?.();
    if (!loc || !dir) throw new Error('Plane Position/Location/Direction missing');
    return {
      kind: 'Plane',
      origin: pntToVec3(loc),
      normal: [dir.X(), dir.Y(), dir.Z()],
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promotePlane: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteCylinder(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteCylinder: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const cyl = downCastSurface(occt as any, 'CylindricalSurface', ext.surfaceHandle);
    if (!cyl) throw new Error('Geom_CylindricalSurface DownCast null');
    const ax = cyl.Position?.();
    const loc = ax?.Location?.();
    const dir = ax?.Direction?.();
    const xdir = ax?.XDirection?.();
    const radius: number = cyl.Radius?.() ?? 0;
    if (!loc || !dir || !xdir || !(radius > 0)) {
      throw new Error('Cylinder params incomplete');
    }
    return {
      kind: 'Cylinder',
      axisOrigin: pntToVec3(loc),
      axisDir: [dir.X(), dir.Y(), dir.Z()],
      refDir: [xdir.X(), xdir.Y(), xdir.Z()],
      radius,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteCylinder: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteSphere(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteSphere: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const sph = downCastSurface(occt as any, 'SphericalSurface', ext.surfaceHandle);
    if (!sph) throw new Error('Geom_SphericalSurface DownCast null');
    const ax = sph.Position?.();
    const loc = ax?.Location?.();
    const radius: number = sph.Radius?.() ?? 0;
    if (!loc || !(radius > 0)) throw new Error('Sphere params incomplete');
    return {
      kind: 'Sphere',
      center: pntToVec3(loc),
      radius,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteSphere: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteCone(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteCone: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const cone = downCastSurface(occt as any, 'ConicalSurface', ext.surfaceHandle);
    if (!cone) throw new Error('Geom_ConicalSurface DownCast null');
    const ax = cone.Position?.();
    const loc = ax?.Location?.();
    const dir = ax?.Direction?.();
    const refRadius: number = cone.RefRadius?.() ?? 0;
    const halfAngle: number = cone.SemiAngle?.() ?? 0;
    if (!loc || !dir || !(refRadius > 0) || !(halfAngle > 0)) {
      throw new Error('Cone params incomplete');
    }
    // OCCT cone base (RefRadius) → AxiA apex via: apex = base - (RefRadius / tan(α)) · axis.
    const apexOffset = refRadius / Math.tan(halfAngle);
    const apex: Vec3 = [
      loc.X() - apexOffset * dir.X(),
      loc.Y() - apexOffset * dir.Y(),
      loc.Z() - apexOffset * dir.Z(),
    ];
    return {
      kind: 'Cone',
      apex,
      axisDir: [dir.X(), dir.Y(), dir.Z()],
      halfAngle,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteCone: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteTorus(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteTorus: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const tor = downCastSurface(occt as any, 'ToroidalSurface', ext.surfaceHandle);
    if (!tor) throw new Error('Geom_ToroidalSurface DownCast null');
    const ax = tor.Position?.();
    const loc = ax?.Location?.();
    const dir = ax?.Direction?.();
    const major: number = tor.MajorRadius?.() ?? 0;
    const minor: number = tor.MinorRadius?.() ?? 0;
    if (!loc || !dir || !(major > 0) || !(minor > 0)) {
      throw new Error('Torus params incomplete');
    }
    return {
      kind: 'Torus',
      center: pntToVec3(loc),
      axis: [dir.X(), dir.Y(), dir.Z()],
      majorRadius: major,
      minorRadius: minor,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteTorus: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — Bezier / BSpline / NURBS (데이터 추출 스켈레톤)
// ────────────────────────────────────────────────────────────────────────

/** Read NCollection_Array2 via Pole(i, j) accessor — base 1, row-major 0-based. */
function readPolesGrid(surface: any, nU: number, nV: number): Vec3[][] {
  const grid: Vec3[][] = [];
  for (let i = 1; i <= nU; i++) {
    const row: Vec3[] = [];
    for (let j = 1; j <= nV; j++) {
      const p = surface.Pole?.(i, j);
      if (!p) return [];
      row.push(pntToVec3(p));
    }
    grid.push(row);
  }
  return grid;
}

/** Read NCollection_Array2 via Weight(i, j) accessor — base 1, row-major 0-based. */
function readWeightsGrid(surface: any, nU: number, nV: number): number[][] {
  const grid: number[][] = [];
  for (let i = 1; i <= nU; i++) {
    const row: number[] = [];
    for (let j = 1; j <= nV; j++) {
      const wt = surface.Weight?.(i, j);
      if (wt === undefined || wt === null) return [];
      row.push(Number(wt));
    }
    grid.push(row);
  }
  return grid;
}

function promoteBezierSurface(occt: unknown, faceHandle: unknown, warnings: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteBezierSurface: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bez = downCastSurface(occt as any, 'BezierSurface', ext.surfaceHandle);
    if (!bez) throw new Error('Geom_BezierSurface DownCast null');
    const nU: number = bez.NbUPoles?.() ?? 0;
    const nV: number = bez.NbVPoles?.() ?? 0;
    if (nU < 2 || nV < 2) throw new Error(`Bezier patch poles ${nU}×${nV} < 2×2`);
    const ctrlGrid = readPolesGrid(bez, nU, nV);
    if (ctrlGrid.length === 0) throw new Error('Pole(i,j) access failed');
    return {
      kind: 'BezierPatch',
      ctrlGrid,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteBezierSurface: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteBSplineSurface(occt: unknown, faceHandle: unknown, warnings: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteBSplineSurface: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bs = downCastSurface(occt as any, 'BSplineSurface', ext.surfaceHandle);
    if (!bs) throw new Error('Geom_BSplineSurface DownCast null');

    // Defensive cross-route — identify 가 rational 을 놓친 경우
    const isRat = !!(bs.IsURational?.() || bs.IsVRational?.());
    if (isRat) {
      warnings.push('BSplineSurface unexpectedly rational → routing to promoteNurbsSurface');
      return promoteNurbsSurface(occt, faceHandle, warnings);
    }

    const degU: number = bs.UDegree?.() ?? 0;
    const degV: number = bs.VDegree?.() ?? 0;
    const nU: number = bs.NbUPoles?.() ?? 0;
    const nV: number = bs.NbVPoles?.() ?? 0;
    if (degU < 1 || degV < 1 || nU < 2 || nV < 2) {
      throw new Error(`BSpline params incomplete: deg=${degU}×${degV}, nPoles=${nU}×${nV}`);
    }

    const ctrlGrid = readPolesGrid(bs, nU, nV);
    if (ctrlGrid.length === 0) throw new Error('Pole(i,j) access failed');

    const knotsU = readArray1Real(bs.UKnotSequence_1?.() ?? bs.UKnotSequence?.());
    const knotsV = readArray1Real(bs.VKnotSequence_1?.() ?? bs.VKnotSequence?.());

    if (knotsU.length !== nU + degU + 1) {
      throw new Error(`knotsU length ${knotsU.length} ≠ ${nU + degU + 1}`);
    }
    if (knotsV.length !== nV + degV + 1) {
      throw new Error(`knotsV length ${knotsV.length} ≠ ${nV + degV + 1}`);
    }

    return {
      kind: 'BSplineSurface',
      ctrlGrid,
      knotsU,
      knotsV,
      degU,
      degV,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteBSplineSurface: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

function promoteNurbsSurface(occt: unknown, faceHandle: unknown, warnings: string[]): SurfacePromotion {
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteNurbsSurface: extract failed';
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const bs = downCastSurface(occt as any, 'BSplineSurface', ext.surfaceHandle);
    if (!bs) throw new Error('Geom_BSplineSurface DownCast null');

    // Defensive cross-route — identify 가 non-rational 을 잘못 분류한 경우
    const isRat = !!(bs.IsURational?.() || bs.IsVRational?.());
    if (!isRat) {
      warnings.push('NURBSSurface unexpectedly non-rational → routing to promoteBSplineSurface');
      return promoteBSplineSurface(occt, faceHandle, warnings);
    }

    const degU: number = bs.UDegree?.() ?? 0;
    const degV: number = bs.VDegree?.() ?? 0;
    const nU: number = bs.NbUPoles?.() ?? 0;
    const nV: number = bs.NbVPoles?.() ?? 0;
    if (degU < 1 || degV < 1 || nU < 2 || nV < 2) {
      throw new Error(`NURBS params incomplete: deg=${degU}×${degV}, nPoles=${nU}×${nV}`);
    }

    const ctrlGrid = readPolesGrid(bs, nU, nV);
    if (ctrlGrid.length === 0) throw new Error('Pole(i,j) access failed');

    const weightsGrid = readWeightsGrid(bs, nU, nV);
    if (weightsGrid.length === 0) throw new Error('Weight(i,j) access failed');

    const knotsU = readArray1Real(bs.UKnotSequence_1?.() ?? bs.UKnotSequence?.());
    const knotsV = readArray1Real(bs.VKnotSequence_1?.() ?? bs.VKnotSequence?.());

    if (knotsU.length !== nU + degU + 1 || knotsV.length !== nV + degV + 1) {
      throw new Error(
        `NURBS knot count mismatch: U=${knotsU.length}/${nU + degU + 1}, V=${knotsV.length}/${nV + degV + 1}`,
      );
    }

    return {
      kind: 'NURBSSurface',
      ctrlGrid,
      weightsGrid,
      knotsU,
      knotsV,
      degU,
      degV,
      uvBounds: ext.uvBounds,
    };
  } catch (e) {
    const reason = `promoteNurbsSurface: ${String(e)}`;
    warnings.push(reason);
    return { kind: 'Tessellate', reason };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — sweep / fitting / trim
// ────────────────────────────────────────────────────────────────────────

function promoteSurfaceOfRevolution(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  // W-3-ε deferred — Piegl & Tiller A8.1 (basis curve × axis → tensor NURBS) 별도 sub-step.
  // MVP 는 graceful Tessellate fallback (P21.7 정책).
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  const reason = 'promoteSurfaceOfRevolution (Piegl A8.1) deferred — Tessellate fallback';
  w.push(reason);
  return { kind: 'Tessellate', reason, uvBounds: ext?.uvBounds };
}

function promoteSurfaceOfLinearExtrusion(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  // W-3-ε deferred — Piegl & Tiller A8.2 (basis curve × line direction tensor product).
  // MVP 는 graceful Tessellate fallback (P21.7).
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  const reason = 'promoteSurfaceOfLinearExtrusion (Piegl A8.2) deferred — Tessellate fallback';
  w.push(reason);
  return { kind: 'Tessellate', reason, uvBounds: ext?.uvBounds };
}

function promoteOffsetSurface(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  // W-3-ε deferred — basis surface promote + Hoschek/Lasser fitting.
  // MVP 는 graceful Tessellate fallback (P21.7).
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  const reason = 'promoteOffsetSurface fitting deferred — Tessellate fallback';
  w.push(reason);
  return { kind: 'Tessellate', reason, uvBounds: ext?.uvBounds };
}

function promoteRectangularTrimmedSurface(occt: unknown, faceHandle: unknown, w: string[]): SurfacePromotion {
  // BasisSurface() 매핑 — 우리 promotion 의 uvBounds 를 trim 영역으로 교체.
  // identifySurfaceKind 가 한 번 더 BasisSurface 위에서 dispatch 되도록 caller wrapping
  // 은 안 함 (recursion 방지). 대신 trim 의 uvBounds (BRepTools::UVBounds) 만 사용하고
  // BasisSurface 의 type 은 RectangularTrimmedSurface DownCast 후 재dispatch.
  const ext = extractSurfaceHandle(occt as any, faceHandle as any);
  if (!ext) {
    const reason = 'promoteRectangularTrimmedSurface: extract failed';
    w.push(reason);
    return { kind: 'Tessellate', reason };
  }
  try {
    const trimmed = downCastSurface(occt as any, 'RectangularTrimmedSurface', ext.surfaceHandle);
    if (!trimmed) throw new Error('Geom_RectangularTrimmedSurface DownCast null');

    // BasisSurface() 는 Handle_Geom_Surface 반환.
    const basisH = trimmed.BasisSurface?.();
    if (!basisH || basisH.IsNull?.()) {
      throw new Error('BasisSurface null');
    }
    const basis = basisH.get?.() ?? basisH;
    const basisName = surfaceTypeName(basis);
    debugLog(`[promoteRectangularTrimmedSurface] basis=${basisName}`);

    // Trim uvBounds (parameter range) 우선 → ext.uvBounds (face) 로 fallback.
    let trimUv: UvBounds | undefined = ext.uvBounds;
    try {
      const u1: number = trimmed.U1?.() ?? Number.NaN;
      const u2: number = trimmed.U2?.() ?? Number.NaN;
      const v1: number = trimmed.V1?.() ?? Number.NaN;
      const v2: number = trimmed.V2?.() ?? Number.NaN;
      if (Number.isFinite(u1) && Number.isFinite(u2) && Number.isFinite(v1) && Number.isFinite(v2)) {
        trimUv = [u1, u2, v1, v2];
      }
    } catch {
      // fallback to ext.uvBounds
    }

    // BasisSurface 위에서 dispatch — 동일 face 가 아닌 BRep_Tool path 가 아니므로
    // direct identify by name on basis. occt.js JS proxy 는 raw object 의 derived
    // methods 를 prototype 으로 노출하므로 별도 DownCast 없이 raw `basis` 사용.
    // (실제 OCCT C++ 에서는 DownCast 가 필요하지만, occt.js 1.x 의 JS 바인딩에서는
    // 모든 매서드가 노출됨. 만약 W-ζ 코퍼스 검증 시 실패 발견되면 DownCast 추가.)
    //
    // W-ε — RectangularTrimmedSurface 는 fast-path 로 uvBounds 기반 합성
    // rectangular trim loop 사용 (PCurve 추출 회피). 상위 `promoteSurface`
    // 의 generic trim attach 가 이 값을 보존 (이미 `trimLoops` 가 set 되어 있어
    // overwrite 안 됨).
    const synthLoop = trimUv ? [rectangularTrimLoop(trimUv)] : undefined;
    switch (basisName) {
      case 'Geom_Plane': {
        const ax = basis.Position?.();
        const loc = ax?.Location?.();
        const dir = ax?.Direction?.();
        if (!loc || !dir) throw new Error('Plane params missing');
        return {
          kind: 'Plane',
          origin: pntToVec3(loc),
          normal: [dir.X(), dir.Y(), dir.Z()],
          uvBounds: trimUv,
          trimLoops: synthLoop,
        };
      }
      case 'Geom_CylindricalSurface': {
        const ax = basis.Position?.();
        const loc = ax?.Location?.();
        const dir = ax?.Direction?.();
        const xdir = ax?.XDirection?.();
        const radius: number = basis.Radius?.() ?? 0;
        if (!loc || !dir || !xdir || !(radius > 0)) throw new Error('Cylinder params');
        return {
          kind: 'Cylinder',
          axisOrigin: pntToVec3(loc),
          axisDir: [dir.X(), dir.Y(), dir.Z()],
          refDir: [xdir.X(), xdir.Y(), xdir.Z()],
          radius,
          uvBounds: trimUv,
          trimLoops: synthLoop,
        };
      }
      // 그 외 basis type 은 trim 표현 의미가 약하거나 W-3-ε deferred 영역.
      // Tessellate fallback 으로 graceful 처리, trimUv 는 보존.
      default:
        throw new Error(`unsupported trim basis: ${basisName}`);
    }
  } catch (e) {
    const reason = `promoteRectangularTrimmedSurface: ${String(e)}`;
    w.push(reason);
    return { kind: 'Tessellate', reason, uvBounds: ext.uvBounds };
  }
}

// ────────────────────────────────────────────────────────────────────────
// 매핑 표 인덱스 (ADR-036 P21.2 SSOT 검증용)
// ────────────────────────────────────────────────────────────────────────

/** 본 모듈이 처리하는 OCCT surface 종류 — 테스트가 ADR 매핑 표와 일치 검증. */
export const SUPPORTED_SURFACE_KINDS: OcctSurfaceKind[] = [
  'Plane', 'Cylinder', 'Sphere', 'Cone', 'Torus',
  'BezierSurface', 'BSplineSurface', 'NURBSSurface',
  'SurfaceOfRevolution', 'SurfaceOfLinearExtrusion',
  'OffsetSurface', 'RectangularTrimmedSurface',
];
