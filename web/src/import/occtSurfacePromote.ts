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
 */
export type SurfacePromotion =
  | { kind: 'Plane'; origin: [number, number, number]; normal: [number, number, number]; uvBounds?: UvBounds }
  | { kind: 'Cylinder'; axisOrigin: [number, number, number]; axisDir: [number, number, number]; refDir: [number, number, number]; radius: number; uvBounds?: UvBounds }
  | { kind: 'Sphere'; center: [number, number, number]; radius: number; uvBounds?: UvBounds }
  | { kind: 'Cone'; apex: [number, number, number]; axisDir: [number, number, number]; halfAngle: number; uvBounds?: UvBounds }
  | { kind: 'Torus'; center: [number, number, number]; axis: [number, number, number]; majorRadius: number; minorRadius: number; uvBounds?: UvBounds }
  | { kind: 'BezierPatch'; ctrlGrid: Array<Array<[number, number, number]>>; uvBounds?: UvBounds }
  | {
      kind: 'BSplineSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
      uvBounds?: UvBounds;
    }
  | {
      kind: 'NURBSSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      weightsGrid: number[][];
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
      uvBounds?: UvBounds;
    }
  | { kind: 'Tessellate'; reason: string; uvBounds?: UvBounds };

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

  return { promotion, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// identifySurfaceKind — DynamicType dispatch
// ────────────────────────────────────────────────────────────────────────

function identifySurfaceKind(_occt: unknown, _faceHandle: unknown): OcctSurfaceKind {
  // TODO: BRep_Tool::Surface(face) → Handle_Geom_Surface → DynamicType
  //
  // OCCT.js 패턴 (참고):
  //   const surfH = occt.BRep_Tool.Surface_2(faceHandle);
  //   if (!surfH || surfH.IsNull?.()) return 'Unsupported';
  //   const surf = surfH.get?.() ?? surfH;
  //   const typ = surf.DynamicType();
  //   const name = typ.get_type_name?.() ?? typ.Name?.();
  //   switch (name) {
  //     case 'Geom_Plane':                     return 'Plane';
  //     case 'Geom_CylindricalSurface':        return 'Cylinder';
  //     case 'Geom_SphericalSurface':          return 'Sphere';
  //     case 'Geom_ConicalSurface':            return 'Cone';
  //     case 'Geom_ToroidalSurface':           return 'Torus';
  //     case 'Geom_BezierSurface':             return 'BezierSurface';
  //     case 'Geom_BSplineSurface': {
  //       // rational 분기 — Handle DownCast 후 IsURational/IsVRational
  //       const bsHandle = occt.Handle_Geom_BSplineSurface_2.DownCast(surfH);
  //       const bs = bsHandle?.get();
  //       const isRat = bs?.IsURational() || bs?.IsVRational();
  //       return isRat ? 'NURBSSurface' : 'BSplineSurface';
  //     }
  //     case 'Geom_SurfaceOfRevolution':       return 'SurfaceOfRevolution';
  //     case 'Geom_SurfaceOfLinearExtrusion':  return 'SurfaceOfLinearExtrusion';
  //     case 'Geom_OffsetSurface':             return 'OffsetSurface';
  //     case 'Geom_RectangularTrimmedSurface': return 'RectangularTrimmedSurface';
  //     default:                               return 'Unsupported';
  //   }
  return 'Unsupported';
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — direct mapping (1~5)
// ────────────────────────────────────────────────────────────────────────

function promotePlane(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Handle_Geom_Plane::DownCast → Pln().Location() + Axis().Direction()
  //       BRepTools::UVBounds(face, umin, umax, vmin, vmax) → uvBounds
  return { kind: 'Tessellate', reason: 'promotePlane not yet wired' };
}

function promoteCylinder(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Geom_CylindricalSurface → Position() (gp_Ax3) → Location/Axis/XDirection
  //       + Radius()
  return { kind: 'Tessellate', reason: 'promoteCylinder not yet wired' };
}

function promoteSphere(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Geom_SphericalSurface → Position().Location() + Radius()
  return { kind: 'Tessellate', reason: 'promoteSphere not yet wired' };
}

function promoteCone(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Geom_ConicalSurface → Apex 계산:
  //       OCCT 의 base 는 cone 의 ref circle, RefRadius() 와 SemiAngle() 사용
  //       apex = base + (-RefRadius / tan(SemiAngle)) · axis
  return { kind: 'Tessellate', reason: 'promoteCone not yet wired' };
}

function promoteTorus(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Geom_ToroidalSurface → Position() + MajorRadius() + MinorRadius()
  return { kind: 'Tessellate', reason: 'promoteTorus not yet wired' };
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — Bezier / BSpline / NURBS (데이터 추출 스켈레톤)
// ────────────────────────────────────────────────────────────────────────

function promoteBezierSurface(_occt: unknown, _faceHandle: unknown, warnings: string[]): SurfacePromotion {
  // TODO (구체 스켈레톤):
  //   const surfH = occt.BRep_Tool.Surface_2(faceHandle);
  //   const bezH = occt.Handle_Geom_BezierSurface_2.DownCast(surfH);
  //   const bez = bezH?.get();
  //   if (!bez) { warnings.push('BezierSurface DownCast failed'); return Tessellate; }
  //
  //   const nU = bez.NbUPoles();  // u-direction control point count
  //   const nV = bez.NbVPoles();  // v-direction
  //   const poles = bez.Poles();  // NCollection_Array2<gp_Pnt>, 1-based
  //
  //   const ctrlGrid: Array<Array<[number, number, number]>> = [];
  //   for (let i = 1; i <= nU; i++) {  // OCCT 1-based
  //     const row: Array<[number, number, number]> = [];
  //     for (let j = 1; j <= nV; j++) {
  //       const p = poles.Value(i, j);  // gp_Pnt
  //       row.push([p.X(), p.Y(), p.Z()]);
  //     }
  //     ctrlGrid.push(row);  // 0-based row-major: ctrlGrid[i-1][j-1]
  //   }
  //
  //   // BRepTools::UVBounds → uvBounds
  //   return { kind: 'BezierPatch', ctrlGrid, uvBounds };
  void warnings;  // suppress unused
  return { kind: 'Tessellate', reason: 'promoteBezierSurface not yet wired' };
}

function promoteBSplineSurface(_occt: unknown, _faceHandle: unknown, warnings: string[]): SurfacePromotion {
  // TODO (구체 스켈레톤 — non-rational 만):
  //   const surfH = occt.BRep_Tool.Surface_2(faceHandle);
  //   const bsH = occt.Handle_Geom_BSplineSurface_2.DownCast(surfH);
  //   const bs = bsH?.get();
  //   if (!bs) { warnings.push('BSplineSurface DownCast failed'); return Tessellate; }
  //
  //   // Rational 재검증 (identify 단계와 일관 보장 — 동시 변경 시 footgun 차단)
  //   if (bs.IsURational() || bs.IsVRational()) {
  //     warnings.push('BSplineSurface unexpectedly rational; routing to promoteNurbsSurface');
  //     return promoteNurbsSurface(occt, faceHandle, warnings);
  //   }
  //
  //   const degU = bs.UDegree();
  //   const degV = bs.VDegree();
  //   const nU = bs.NbUPoles();
  //   const nV = bs.NbVPoles();
  //   const poles = bs.Poles();  // NCollection_Array2<gp_Pnt>, 1-based
  //
  //   // ctrlGrid: row-major (i = u-index, j = v-index), 0-based
  //   const ctrlGrid: Array<Array<[number, number, number]>> = [];
  //   for (let i = 1; i <= nU; i++) {
  //     const row: Array<[number, number, number]> = [];
  //     for (let j = 1; j <= nV; j++) {
  //       const p = poles.Value(i, j);
  //       row.push([p.X(), p.Y(), p.Z()]);
  //     }
  //     ctrlGrid.push(row);
  //   }
  //
  //   // KnotSequence (expanded — 우리 AnalyticSurface 가 사용하는 형식):
  //   //   - bs.UKnotSequence() / bs.VKnotSequence() returns TColStd_Array1<Real>
  //   //   - 1-based; length = nU + degU + 1 (clamped) for u
  //   const uSeq = bs.UKnotSequence();
  //   const vSeq = bs.VKnotSequence();
  //   const knotsU: number[] = [];
  //   for (let i = uSeq.Lower(); i <= uSeq.Upper(); i++) knotsU.push(uSeq.Value(i));
  //   const knotsV: number[] = [];
  //   for (let i = vSeq.Lower(); i <= vSeq.Upper(); i++) knotsV.push(vSeq.Value(i));
  //
  //   // Validate counts (Rust validate() 와 동일 invariant):
  //   if (knotsU.length !== nU + degU + 1) {
  //     warnings.push(`knotsU length mismatch: ${knotsU.length} vs ${nU + degU + 1}`);
  //     return { kind: 'Tessellate', reason: 'BSpline knot count mismatch' };
  //   }
  //   if (knotsV.length !== nV + degV + 1) {
  //     warnings.push(`knotsV length mismatch: ${knotsV.length} vs ${nV + degV + 1}`);
  //     return { kind: 'Tessellate', reason: 'BSpline knot count mismatch' };
  //   }
  //
  //   // BRepTools::UVBounds(face, umin, umax, vmin, vmax) → uvBounds
  //   return { kind: 'BSplineSurface', ctrlGrid, knotsU, knotsV, degU, degV, uvBounds };
  void warnings;
  return { kind: 'Tessellate', reason: 'promoteBSplineSurface not yet wired' };
}

function promoteNurbsSurface(_occt: unknown, _faceHandle: unknown, warnings: string[]): SurfacePromotion {
  // TODO (구체 스켈레톤 — rational):
  //   const surfH = occt.BRep_Tool.Surface_2(faceHandle);
  //   const bsH = occt.Handle_Geom_BSplineSurface_2.DownCast(surfH);
  //   const bs = bsH?.get();
  //   if (!bs) { warnings.push('NURBSSurface DownCast failed'); return Tessellate; }
  //
  //   const degU = bs.UDegree();
  //   const degV = bs.VDegree();
  //   const nU = bs.NbUPoles();
  //   const nV = bs.NbVPoles();
  //   const poles = bs.Poles();   // NCollection_Array2<gp_Pnt>, 1-based
  //
  //   // Weights — note: occt.js 의 Weights() 는 NULL 반환 가능
  //   //   (non-rational 면 weights 없음). 본 함수는 rational 만 호출되어야 함.
  //   const weightsArr = bs.Weights();
  //   if (!weightsArr || weightsArr.IsNull?.()) {
  //     warnings.push('NURBSSurface called on non-rational BSplineSurface');
  //     return { kind: 'Tessellate', reason: 'no weights array' };
  //   }
  //
  //   // Dimension 일치 검증 (P21.7 footgun):
  //   //   weights array2 size 가 (nU, nV) 와 일치해야 함.
  //   if (weightsArr.LowerRow() !== 1 || weightsArr.UpperRow() !== nU
  //    || weightsArr.LowerCol() !== 1 || weightsArr.UpperCol() !== nV) {
  //     warnings.push(`Weights dimension ${[weightsArr.LowerRow(), weightsArr.UpperRow(),
  //                    weightsArr.LowerCol(), weightsArr.UpperCol()]} != (1..${nU}, 1..${nV})`);
  //     return { kind: 'Tessellate', reason: 'Weights/Poles dimension mismatch' };
  //   }
  //
  //   const ctrlGrid: Array<Array<[number, number, number]>> = [];
  //   const weightsGrid: number[][] = [];
  //   for (let i = 1; i <= nU; i++) {
  //     const row: Array<[number, number, number]> = [];
  //     const wRow: number[] = [];
  //     for (let j = 1; j <= nV; j++) {
  //       const p = poles.Value(i, j);
  //       row.push([p.X(), p.Y(), p.Z()]);
  //       wRow.push(weightsArr.Value(i, j));
  //     }
  //     ctrlGrid.push(row);
  //     weightsGrid.push(wRow);
  //   }
  //
  //   // KnotSequence (expanded)
  //   const uSeq = bs.UKnotSequence();
  //   const vSeq = bs.VKnotSequence();
  //   const knotsU: number[] = [];
  //   for (let i = uSeq.Lower(); i <= uSeq.Upper(); i++) knotsU.push(uSeq.Value(i));
  //   const knotsV: number[] = [];
  //   for (let i = vSeq.Lower(); i <= vSeq.Upper(); i++) knotsV.push(vSeq.Value(i));
  //
  //   if (knotsU.length !== nU + degU + 1 || knotsV.length !== nV + degV + 1) {
  //     warnings.push('NURBS knot count mismatch');
  //     return { kind: 'Tessellate', reason: 'NURBS knot count mismatch' };
  //   }
  //
  //   // BRepTools::UVBounds → uvBounds
  //   return { kind: 'NURBSSurface', ctrlGrid, weightsGrid, knotsU, knotsV, degU, degV, uvBounds };
  void warnings;
  return { kind: 'Tessellate', reason: 'promoteNurbsSurface not yet wired' };
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion — sweep / fitting / trim
// ────────────────────────────────────────────────────────────────────────

function promoteSurfaceOfRevolution(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Piegl & Tiller A8.1 — basis curve 승격 후 회전 → tensor NURBS surface
  //       (full revolution = degree 2 rational with 9 ctrl pts in v)
  //       occtSweepConverter.ts 별도 모듈 위임 권장
  return { kind: 'Tessellate', reason: 'promoteSurfaceOfRevolution (Piegl A8.1) not yet wired' };
}

function promoteSurfaceOfLinearExtrusion(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: Piegl & Tiller A8.2 — basis curve × line direction tensor product
  //       (degree 1 in extrusion direction)
  return { kind: 'Tessellate', reason: 'promoteSurfaceOfLinearExtrusion (Piegl A8.2) not yet wired' };
}

function promoteOffsetSurface(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: basis surface promote → control net 샘플 + Hoschek/Lasser fitting
  //       tolerance ≤ 1e-3 mm 검증, 실패 시 Tessellate + warning
  return { kind: 'Tessellate', reason: 'promoteOffsetSurface fitting not yet wired' };
}

function promoteRectangularTrimmedSurface(_occt: unknown, _faceHandle: unknown, _w: string[]): SurfacePromotion {
  // TODO: BasisSurface() 매핑 + uv_bounds clip
  //       parent promoteSurface 결과의 uvBounds 만 trim 으로 교체
  //       trim_loops 동기화는 caller 책임 (Phase G2 trim_gen 와 결합)
  return { kind: 'Tessellate', reason: 'promoteRectangularTrimmedSurface not yet wired' };
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
