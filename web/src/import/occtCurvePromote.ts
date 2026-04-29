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

function identifyCurveKind(_occt: unknown, _edgeHandle: unknown): OcctCurveKind {
  // TODO: BRep_Tool::Curve(edge, first, last) → Handle_Geom_Curve
  //       → DynamicType().get_type_name() 으로 분기
  //
  // OCCT.js 패턴 (참고):
  //   const first = { current: 0 }; const last = { current: 0 };  // 출력 파라미터
  //   const curveH = occt.BRep_Tool.Curve_2(edgeHandle, first, last);
  //   if (!curveH || curveH.IsNull?.()) return 'Unsupported';
  //   const curve = curveH.get?.() ?? curveH;
  //   const typ = curve.DynamicType();
  //   const name = typ.get_type_name?.() ?? typ.Name?.();
  //   switch (name) { case 'Geom_Line': return 'Line'; ... }
  //
  // BSpline rational 분기는 promoteBSpline 안에서 처리 (kind dispatch 시
  // 'BSpline' 으로 통합 후 IsRational 검사로 실제 매핑 결정).
  return 'Unsupported';
}

function promoteLine(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Handle_Geom_Line::DownCast → Position()->Location() + Direction()
  //       + trim range [u_first, u_last] 의 endpoint evaluate
  //       parameterRange = [first, last] 보존
  return { kind: 'Tessellate', reason: 'promoteLine not yet wired' };
}

function promoteCircle(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Handle_Geom_Circle::DownCast → Axis() + Radius()
  //       trim range == 2π (±ε) 검증 후 Circle, 아니면 Arc 로 분기
  return { kind: 'Tessellate', reason: 'promoteCircle not yet wired' };
}

function promoteArc(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Geom_TrimmedCurve(Geom_Circle, t1, t2) → Arc { startAngle, endAngle }
  //       OCCT angle convention (radian) 그대로
  //       parameterRange = [t1, t2]
  return { kind: 'Tessellate', reason: 'promoteArc not yet wired' };
}

function promoteBezier(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Handle_Geom_BezierCurve::DownCast → Poles() (NCollection_Array1)
  //       NCollection_Array1 인덱스 base = 1 (LowerCol/UpperCol).
  //       row-major direct copy.
  return { kind: 'Tessellate', reason: 'promoteBezier not yet wired' };
}

function promoteBSpline(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Handle_Geom_BSplineCurve::DownCast
  //       IsRational() 체크 → false 면 BSpline 매핑, true 면 promoteNurbs 위임
  //       Poles() / KnotSequence() / Degree() 직접 복사
  //       KnotSequence (expanded) vs Knots+Multiplicities (compact) 차이 주의 —
  //       우리 AnalyticCurve::BSpline 은 expanded 형식 사용.
  return { kind: 'Tessellate', reason: 'promoteBSpline not yet wired' };
}

function promoteNurbs(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Geom_BSplineCurve (rational=true) → Weights() + Poles() + KnotSequence()
  //       weights/poles dimension 일치 검증 (mismatch 시 warning + Tessellate)
  return { kind: 'Tessellate', reason: 'promoteNurbs not yet wired' };
}

function promoteEllipse(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Piegl & Tiller A7.1 — 9 control point rational quadratic NURBS
  //       weights = [1, √2/2, 1, √2/2, 1, √2/2, 1, √2/2, 1]
  //       knots = [0, 0, 0, 1/4, 1/4, 1/2, 1/2, 3/4, 3/4, 1, 1, 1]
  //       정확도 1e-9 mm 검증 (occtConicConverter 별도 모듈)
  return { kind: 'Tessellate', reason: 'promoteEllipse (Piegl A7.1) not yet wired' };
}

function promoteParabola(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Piegl & Tiller A7.4 — 3 control point quadratic Bezier (non-rational)
  return { kind: 'Tessellate', reason: 'promoteParabola (Piegl A7.4) not yet wired' };
}

function promoteHyperbola(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: Piegl & Tiller A7.5 — rational quadratic NURBS, weights involve cosh/sinh
  return { kind: 'Tessellate', reason: 'promoteHyperbola (Piegl A7.5) not yet wired' };
}

function promoteOffsetCurve(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: basis curve promote → 샘플 evaluate → Hoschek-style fitting
  //       tolerance ≤ 1e-3 mm 검증, 실패 시 Tessellate + warning
  return { kind: 'Tessellate', reason: 'promoteOffsetCurve fitting not yet wired' };
}

function promoteTrimmedCurve(_occt: unknown, _edgeHandle: unknown, _warnings: string[]): CurvePromotion {
  // TODO: BasisCurve() 매핑 + sub-range 적용 (parameterRange 보존)
  //       기존 promote* 호출 후 결과의 parameterRange 만 trim 으로 교체
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
