/**
 * OCCT Geom_Surface → AxiA AnalyticSurface promotion (ADR-036 P21.2).
 *
 * BRep face 의 parametric definition 을 우리 `AnalyticSurface` enum 으로
 * 직접 매핑한다. Tessellation 은 fallback 일 뿐 — precision 보존.
 *
 * **이 파일은 ADR-036 매핑 표의 SSOT 를 그대로 구현한다.**
 * 매핑 변경 시 ADR-036 P21.2 부터 수정할 것.
 *
 * ## 미구현 (별도 PR scope)
 *
 * 본 commit 은 dispatch 시그니처와 매핑 enum 만 고정. 실제 OCCT API
 * 호출 (`Handle_Geom_Plane::DownCast` 등) 은 OCCT.js 가 실제 환경에서
 * 통합되는 후속 PR 에서 채워진다.
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

/** Promotion 결과 — caller 가 setFaceSurface* WASM API 로 dispatch. */
export type SurfacePromotion =
  | { kind: 'Plane'; origin: [number, number, number]; normal: [number, number, number] }
  | { kind: 'Cylinder'; axisOrigin: [number, number, number]; axisDir: [number, number, number]; refDir: [number, number, number]; radius: number }
  | { kind: 'Sphere'; center: [number, number, number]; radius: number }
  | { kind: 'Cone'; apex: [number, number, number]; axisDir: [number, number, number]; halfAngle: number }
  | { kind: 'Torus'; center: [number, number, number]; axis: [number, number, number]; majorRadius: number; minorRadius: number }
  | { kind: 'BezierPatch'; ctrlGrid: Array<Array<[number, number, number]>> }
  | {
      kind: 'BSplineSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
    }
  | {
      kind: 'NURBSSurface';
      ctrlGrid: Array<Array<[number, number, number]>>;
      weightsGrid: number[][];
      knotsU: number[]; knotsV: number[];
      degU: number; degV: number;
    }
  | { kind: 'Tessellate'; reason: string };

/**
 * OCCT Geom_Surface 핸들에서 우리 AnalyticSurface 로 promote.
 *
 * @param occt — opencascade.js runtime 핸들 (ADR-035 P20.7)
 * @param faceHandle — OCCT TopoDS_Face 핸들
 * @returns 매핑된 SurfacePromotion. 실패 시 `{ kind: 'Tessellate', reason }`.
 */
export function promoteSurface(occt: unknown, faceHandle: unknown): SurfacePromotion {
  const kind = identifySurfaceKind(occt, faceHandle);
  debugLog(`[occtSurfacePromote] dispatch: ${kind}`);

  switch (kind) {
    case 'Plane':                     return promotePlane(occt, faceHandle);
    case 'Cylinder':                  return promoteCylinder(occt, faceHandle);
    case 'Sphere':                    return promoteSphere(occt, faceHandle);
    case 'Cone':                      return promoteCone(occt, faceHandle);
    case 'Torus':                     return promoteTorus(occt, faceHandle);
    case 'BezierSurface':             return promoteBezierSurface(occt, faceHandle);
    case 'BSplineSurface':            return promoteBSplineSurface(occt, faceHandle);
    case 'NURBSSurface':              return promoteNurbsSurface(occt, faceHandle);
    case 'SurfaceOfRevolution':       return promoteSurfaceOfRevolution(occt, faceHandle);
    case 'SurfaceOfLinearExtrusion':  return promoteSurfaceOfLinearExtrusion(occt, faceHandle);
    case 'OffsetSurface':             return promoteOffsetSurface(occt, faceHandle);
    case 'RectangularTrimmedSurface': return promoteRectangularTrimmedSurface(occt, faceHandle);
    case 'Unsupported':
    default:
      debugWarn(`[occtSurfacePromote] unsupported surface kind, tessellate fallback`);
      return { kind: 'Tessellate', reason: `OCCT surface type unsupported (kind=${kind})` };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion (스텁 — 후속 PR 에서 OCCT API 호출 채움)
// ────────────────────────────────────────────────────────────────────────

function identifySurfaceKind(_occt: unknown, _faceHandle: unknown): OcctSurfaceKind {
  // TODO: BRep_Tool::Surface(face) → Handle_Geom_Surface
  //       → DynamicType().Name() 으로 분기
  return 'Unsupported';
}

function promotePlane(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Handle_Geom_Plane::DownCast → Pln().Location() + Axis().Direction()
  return { kind: 'Tessellate', reason: 'promotePlane not yet wired' };
}

function promoteCylinder(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_CylindricalSurface → Position() (Ax3) → Location/Axis/XDirection
  //       + Radius()
  return { kind: 'Tessellate', reason: 'promoteCylinder not yet wired' };
}

function promoteSphere(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_SphericalSurface → Position().Location() + Radius()
  return { kind: 'Tessellate', reason: 'promoteSphere not yet wired' };
}

function promoteCone(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_ConicalSurface → Apex 계산 (base + (-radius/tan(half_angle)) · axis)
  return { kind: 'Tessellate', reason: 'promoteCone not yet wired' };
}

function promoteTorus(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_ToroidalSurface → Position() + MajorRadius() + MinorRadius()
  return { kind: 'Tessellate', reason: 'promoteTorus not yet wired' };
}

function promoteBezierSurface(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_BezierSurface → Poles() (NCollection_Array2) → row-major copy
  return { kind: 'Tessellate', reason: 'promoteBezierSurface not yet wired' };
}

function promoteBSplineSurface(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_BSplineSurface (non-rational) → Poles() + UKnotSequence() +
  //       VKnotSequence() + UDegree() + VDegree()
  return { kind: 'Tessellate', reason: 'promoteBSplineSurface not yet wired' };
}

function promoteNurbsSurface(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Geom_BSplineSurface (rational) → + Weights() (NCollection_Array2)
  return { kind: 'Tessellate', reason: 'promoteNurbsSurface not yet wired' };
}

function promoteSurfaceOfRevolution(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Piegl & Tiller A8.1 — basis curve 승격 후 회전 → tensor NURBS surface
  //       (full revolution = degree 2 rational with 9 ctrl pts in v)
  return { kind: 'Tessellate', reason: 'promoteSurfaceOfRevolution (Piegl A8.1) not yet wired' };
}

function promoteSurfaceOfLinearExtrusion(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: Piegl & Tiller A8.2 — basis curve × line direction tensor product
  //       (degree 1 in extrusion direction)
  return { kind: 'Tessellate', reason: 'promoteSurfaceOfLinearExtrusion (Piegl A8.2) not yet wired' };
}

function promoteOffsetSurface(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: basis surface promote → control net 샘플 + Hoschek/Lasser fitting
  //       tolerance ≤ 1e-3 mm 검증
  return { kind: 'Tessellate', reason: 'promoteOffsetSurface fitting not yet wired' };
}

function promoteRectangularTrimmedSurface(_occt: unknown, _faceHandle: unknown): SurfacePromotion {
  // TODO: BasisSurface() 매핑 + uv_bounds clip → trim_loops 동기화
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
