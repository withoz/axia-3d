/**
 * OCCT.js wrapper-compatible accessor helpers (ADR-036 P21).
 *
 * occt.js 의 Array1 / Array2 / gp_Pnt 접근 패턴은 wrapper 빌드마다
 * 미묘하게 다르다 (`.Value()` vs `.Get()` vs `[i]`, `_1` vs `_2`
 * suffix overload 등). 본 모듈은 다형 접근 헬퍼로 그 차이를 흡수.
 *
 * **promote* 모듈은 직접 OCCT 메서드를 부르지 말고 본 헬퍼를 거칠 것.**
 * 그래야 occt.js 버전 업데이트 시 영향 1곳에 국한.
 *
 * ## 핵심 footgun 회피 (검토자 의견 반영, 2026-04-30)
 *
 * - **NCollection_Array2 인덱스 base** — `Pole(i,j)` / `Weight(i,j)`
 *   직접 accessor 사용으로 LowerRow/UpperRow 검증 우회
 * - **wrapper Array1 접근 차이** — `readArray1Real` 가 Lower/Upper /
 *   Length / Value / Get / `[i]` 6 패턴 모두 흡수
 * - **Method overload (_1, _2 suffix)** — caller 가 `_2 ?? _1 ?? bare`
 *   chain 사용
 *
 * ## 미구현
 *
 * 본 commit 은 helper 시그니처 + Tessellate fallback 동작 검증만. 실제
 * OCCT 통합 시 helper 본체는 그대로 활용 — caller (promote*) 만 OCCT
 * 호출 코드를 채우면 됨.
 */

/** 3D vector — `[x, y, z]` (occtCurvePromote/SurfacePromote 와 동일 형식). */
export type Vec3 = [number, number, number];

/**
 * `gp_Pnt` 핸들 → Vec3.
 *
 * occt.js 의 `gp_Pnt.X() / Y() / Z()` 메서드를 직접 호출. wrapper 별
 * 차이 없음 (gp_Pnt 는 안정 API).
 */
export function pntToVec3(pnt: { X: () => number; Y: () => number; Z: () => number }): Vec3 {
  return [pnt.X(), pnt.Y(), pnt.Z()];
}

/**
 * OCCT Array1 핸들 (TColStd_Array1OfReal 등) → number[].
 *
 * 다형 접근:
 * - `Lower()` / `Upper()` 선호 (OCCT 표준, 대부분 1-based)
 * - 없으면 `Length()` 사용 (1-based 가정)
 * - 값 접근: `Value(i)` → `Get(i)` → `[i]` 우선순위
 *
 * 빈 배열 / null 입력은 `[]` 반환.
 */
export function readArray1Real(arr: unknown): number[] {
  if (!arr) return [];
  const a = arr as {
    Lower?: () => number;
    Upper?: () => number;
    Length?: () => number;
    Value?: (i: number) => number;
    Get?: (i: number) => number;
    [index: number]: number;
  };
  const lo = typeof a.Lower === 'function' ? a.Lower() : 1;
  const hi = typeof a.Upper === 'function'
    ? a.Upper()
    : typeof a.Length === 'function' ? a.Length() : 0;
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const v: number = typeof a.Value === 'function' ? a.Value(i)
      : typeof a.Get === 'function' ? a.Get(i)
      : a[i];
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

/**
 * BRepTools::UVBounds(face) — face 의 (u_min, u_max, v_min, v_max).
 *
 * occt.js 패턴 (참고):
 * ```typescript
 * const u1 = { current: 0 }, u2 = { current: 0 };
 * const v1 = { current: 0 }, v2 = { current: 0 };
 * occt.BRepTools.UVBounds_1(face, u1, u2, v1, v2);
 * return [u1.current, u2.current, v1.current, v2.current];
 * ```
 *
 * 실패 시 `undefined` 반환 — caller 는 uvBounds 미보존으로 처리.
 *
 * **현재 스텁** — OCCT.js 통합 후속 PR 에서 본체 작성.
 */
export function readUvBounds(_occt: unknown, _face: unknown): [number, number, number, number] | undefined {
  // TODO: occt.BRepTools.UVBounds_1(face, u1, u2, v1, v2) — out parameter
  //       wrapper convention 확인 후 구현.
  return undefined;
}

/**
 * BRep_Tool::Curve(edge, first, last) — edge 의 underlying curve handle
 * + parameter range.
 *
 * occt.js 패턴 (참고):
 * ```typescript
 * const first = { current: 0 }, last = { current: 0 };
 * const curveH = occt.BRep_Tool.Curve_2(edge, first, last)
 *             ?? occt.BRep_Tool.Curve_1?.(edge, first, last);
 * return { curveH, parameterRange: [first.current, last.current] };
 * ```
 *
 * **현재 스텁** — OCCT.js 통합 후속 PR.
 */
export function readEdgeCurve(_occt: unknown, _edge: unknown):
  { curveH: unknown; parameterRange: [number, number] } | undefined
{
  return undefined;
}

/**
 * BRep_Tool::Surface(face) — face 의 underlying surface handle.
 *
 * occt.js 패턴 (참고):
 * ```typescript
 * const surfH = occt.BRep_Tool.Surface_2?.(face)
 *            ?? occt.BRep_Tool.Surface_1?.(face)
 *            ?? occt.BRep_Tool.Surface?.(face);
 * if (!surfH || surfH.IsNull?.()) return undefined;
 * return surfH;
 * ```
 *
 * **현재 스텁** — OCCT.js 통합 후속 PR.
 */
export function readFaceSurface(_occt: unknown, _face: unknown): unknown {
  return undefined;
}

/**
 * Handle::DownCast 를 통한 raw 추출.
 *
 * occt.js 의 자동 Handle ↔ raw 변환 한계 우회.
 *
 * 사용:
 * ```typescript
 * const bs = downCastTo(occt, 'Handle_Geom_BSplineSurface_2', surfHandle);
 * if (bs) bs.IsURational();  // raw 메서드 호출
 * ```
 *
 * @returns DownCast 성공 시 raw 객체, 실패 시 `undefined`
 */
export function downCastTo(occt: unknown, handleClass: string, handle: unknown): unknown {
  if (!handle) return undefined;
  const o = occt as Record<string, unknown> | null;
  if (!o) return undefined;
  const cls = o[handleClass] as { DownCast?: (h: unknown) => { get?: () => unknown; IsNull?: () => boolean } } | undefined;
  if (!cls?.DownCast) return undefined;
  const wrapped = cls.DownCast(handle);
  if (!wrapped || wrapped.IsNull?.()) return undefined;
  return wrapped.get?.() ?? wrapped;
}
