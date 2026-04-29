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
 * ## 미구현 (별도 PR scope)
 *
 * 본 commit 은 dispatch 시그니처와 매핑 enum 만 고정. 실제 OCCT API
 * 호출 (`Handle_Geom_Line::DownCast` 등) 은 OCCT.js 가 실제 환경에서
 * 통합되는 후속 PR 에서 채워진다.
 */

import { debugLog, debugWarn } from '../utils/debug';

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

/** Promotion 결과 — caller 가 setEdge*Curve API 로 dispatch. */
export type CurvePromotion =
  | { kind: 'Line'; start: [number, number, number]; end: [number, number, number] }
  | { kind: 'Circle'; center: [number, number, number]; normal: [number, number, number]; radius: number }
  | { kind: 'Arc'; center: [number, number, number]; axis: [number, number, number]; refDir: [number, number, number]; radius: number; startAngle: number; endAngle: number }
  | { kind: 'Bezier'; controlPts: Array<[number, number, number]> }
  | { kind: 'BSpline'; controlPts: Array<[number, number, number]>; knots: number[]; degree: number }
  | { kind: 'NURBS'; controlPts: Array<[number, number, number]>; weights: number[]; knots: number[]; degree: number }
  | { kind: 'Tessellate'; reason: string };  // fallback

/**
 * OCCT Geom_Curve 핸들에서 우리 AnalyticCurve 로 promote.
 *
 * @param occt — opencascade.js runtime 핸들 (ADR-035 P20.7)
 * @param edgeHandle — OCCT TopoDS_Edge 핸들
 * @returns 매핑된 CurvePromotion. 실패 시 `{ kind: 'Tessellate', reason }`.
 */
export function promoteCurve(occt: unknown, edgeHandle: unknown): CurvePromotion {
  // P21.1 dispatch — runtime kind 식별 후 매핑.
  const kind = identifyCurveKind(occt, edgeHandle);
  debugLog(`[occtCurvePromote] dispatch: ${kind}`);

  switch (kind) {
    case 'Line':         return promoteLine(occt, edgeHandle);
    case 'Circle':       return promoteCircle(occt, edgeHandle);
    case 'Arc':          return promoteArc(occt, edgeHandle);
    case 'Bezier':       return promoteBezier(occt, edgeHandle);
    case 'BSpline':      return promoteBSpline(occt, edgeHandle);
    case 'NURBS':        return promoteNurbs(occt, edgeHandle);
    case 'Ellipse':      return promoteEllipse(occt, edgeHandle);    // Piegl A7.1
    case 'Parabola':     return promoteParabola(occt, edgeHandle);   // Piegl A7.4
    case 'Hyperbola':    return promoteHyperbola(occt, edgeHandle);  // Piegl A7.5
    case 'OffsetCurve':  return promoteOffsetCurve(occt, edgeHandle);
    case 'TrimmedCurve': return promoteTrimmedCurve(occt, edgeHandle);
    case 'Unsupported':
    default:
      debugWarn(`[occtCurvePromote] unsupported curve kind, tessellate fallback`);
      return { kind: 'Tessellate', reason: `OCCT curve type unsupported (kind=${kind})` };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-kind promotion (스텁 — 후속 PR 에서 OCCT API 호출 채움)
// ────────────────────────────────────────────────────────────────────────

function identifyCurveKind(_occt: unknown, _edgeHandle: unknown): OcctCurveKind {
  // TODO: BRep_Tool::Curve(edge, first, last) → Handle_Geom_Curve
  //       → DynamicType().Name() 으로 분기
  // 현재는 스텁 — OCCT.js 통합 후속 PR 에서 실제 dispatch 작성.
  return 'Unsupported';
}

function promoteLine(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Handle_Geom_Line::DownCast → Position()->Location() + Direction()
  //       + trim range [u_first, u_last] 의 endpoint evaluate
  return { kind: 'Tessellate', reason: 'promoteLine not yet wired' };
}

function promoteCircle(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Handle_Geom_Circle::DownCast → Axis() + Radius()
  //       trim range == 2π 검증 후 Circle, 아니면 Arc 로 분기
  return { kind: 'Tessellate', reason: 'promoteCircle not yet wired' };
}

function promoteArc(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Geom_TrimmedCurve(Geom_Circle, t1, t2) → Arc { startAngle, endAngle }
  //       OCCT angle convention (radian) 그대로
  return { kind: 'Tessellate', reason: 'promoteArc not yet wired' };
}

function promoteBezier(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Handle_Geom_BezierCurve::DownCast → Poles() (NCollection_Array1)
  //       → Array<[x,y,z]> 직접 복사
  return { kind: 'Tessellate', reason: 'promoteBezier not yet wired' };
}

function promoteBSpline(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Handle_Geom_BSplineCurve::DownCast
  //       IsRational() 체크 → false 면 BSpline, true 면 promoteNurbs 위임
  //       Poles() / KnotSequence() / Degree() 직접 복사
  return { kind: 'Tessellate', reason: 'promoteBSpline not yet wired' };
}

function promoteNurbs(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Geom_BSplineCurve (rational=true) → Weights() + Poles() + KnotSequence()
  return { kind: 'Tessellate', reason: 'promoteNurbs not yet wired' };
}

function promoteEllipse(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Piegl & Tiller A7.1 — 9 control point rational quadratic NURBS
  //       weights = [1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]
  //       knots = [0, 0, 0, 1/4, 1/4, 1/2, 1/2, 3/4, 3/4, 1, 1, 1]
  //       정확도 1e-9 mm 검증
  return { kind: 'Tessellate', reason: 'promoteEllipse (Piegl A7.1) not yet wired' };
}

function promoteParabola(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Piegl & Tiller A7.4 — 3 control point quadratic Bezier (non-rational)
  return { kind: 'Tessellate', reason: 'promoteParabola (Piegl A7.4) not yet wired' };
}

function promoteHyperbola(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: Piegl & Tiller A7.5 — rational quadratic NURBS, weights involve cosh/sinh
  return { kind: 'Tessellate', reason: 'promoteHyperbola (Piegl A7.5) not yet wired' };
}

function promoteOffsetCurve(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: basis curve promote → 샘플 evaluate → Hoschek-style fitting
  //       tolerance ≤ 1e-3 mm 검증, 실패 시 Tessellate
  return { kind: 'Tessellate', reason: 'promoteOffsetCurve fitting not yet wired' };
}

function promoteTrimmedCurve(_occt: unknown, _edgeHandle: unknown): CurvePromotion {
  // TODO: BasisCurve() 매핑 + sub-range 적용 (parameter_range 검증)
  return { kind: 'Tessellate', reason: 'promoteTrimmedCurve not yet wired' };
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
