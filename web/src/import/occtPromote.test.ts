/**
 * Regression tests for occtCurvePromote / occtSurfacePromote (ADR-036).
 *
 * 본 테스트는 매핑 표 SSOT 가 ADR-036 P21.1 / P21.2 와 정확히 일치하는지
 * 검증한다. ADR 갱신 시 이 테스트가 깨지면 매핑 표가 표류 (drift) 한 것.
 *
 * 실제 OCCT API 호출 검증은 OCCT.js 통합 후속 PR 에서 추가 (현 commit 은
 * scaffolding 만 — 모든 promote 호출은 `Tessellate` fallback 으로 떨어짐).
 */

import { describe, it, expect } from 'vitest';
import {
  promoteCurve,
  SUPPORTED_CURVE_KINDS,
  type OcctCurveKind,
  type CurvePromotion,
} from './occtCurvePromote';
import {
  promoteSurface,
  SUPPORTED_SURFACE_KINDS,
  type OcctSurfaceKind,
  type SurfacePromotion,
} from './occtSurfacePromote';

describe('occtCurvePromote — ADR-036 P21.1 매핑 SSOT', () => {
  it('SUPPORTED_CURVE_KINDS 가 ADR-036 P21.1 의 11 항목과 일치', () => {
    // P21.1 표 (OCCT type → AnalyticCurve variant) 의 11 행:
    // Line, Circle, Arc, Bezier, BSpline, NURBS,
    // Ellipse, Parabola, Hyperbola, OffsetCurve, TrimmedCurve
    const expected: OcctCurveKind[] = [
      'Line', 'Circle', 'Arc', 'Bezier', 'BSpline', 'NURBS',
      'Ellipse', 'Parabola', 'Hyperbola',
      'OffsetCurve', 'TrimmedCurve',
    ];
    expect(SUPPORTED_CURVE_KINDS).toEqual(expected);
    expect(SUPPORTED_CURVE_KINDS).toHaveLength(11);
  });

  it('promoteCurve 는 wrapper { promotion, warnings } 반환 (스텁 단계)', () => {
    const result = promoteCurve(null, null);
    expect(result).toHaveProperty('promotion');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.promotion.kind).toBe('Tessellate');
    if (result.promotion.kind === 'Tessellate') {
      expect(result.promotion.reason).toContain('unsupported');
    }
  });

  it('promoteCurve 의 warnings 는 항상 배열 (Tessellate fallback 시에도 누적)', () => {
    const result = promoteCurve(null, null);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(typeof result.warnings[0]).toBe('string');
  });

  it('CurvePromotion 의 모든 variant 가 ADR-036 의 AnalyticCurve enum 과 매칭', () => {
    // 컴파일 타임에 결정되는 부분 — 본 it 는 enum coverage 의 sanity check.
    const variants: Array<CurvePromotion['kind']> = [
      'Line', 'Circle', 'Arc', 'Bezier', 'BSpline', 'NURBS', 'Tessellate',
    ];
    // Tessellate 는 fallback 이라 Curve enum 에는 없음. 나머지 6 + Tessellate.
    expect(variants).toContain('Line');
    expect(variants).toContain('NURBS');
    expect(variants).toContain('Tessellate');
  });

  it('Conic 변환 (Ellipse / Parabola / Hyperbola) 는 SUPPORTED 에 포함', () => {
    expect(SUPPORTED_CURVE_KINDS).toContain('Ellipse');
    expect(SUPPORTED_CURVE_KINDS).toContain('Parabola');
    expect(SUPPORTED_CURVE_KINDS).toContain('Hyperbola');
  });

  it('Fitting fallback (OffsetCurve) 는 SUPPORTED 에 포함', () => {
    expect(SUPPORTED_CURVE_KINDS).toContain('OffsetCurve');
  });
});

describe('occtSurfacePromote — ADR-036 P21.2 매핑 SSOT', () => {
  it('SUPPORTED_SURFACE_KINDS 가 ADR-036 P21.2 의 12 항목과 일치', () => {
    // P21.2 표 (OCCT type → AnalyticSurface variant) 의 12 행:
    // Plane, Cylinder, Sphere, Cone, Torus,
    // BezierSurface, BSplineSurface, NURBSSurface,
    // SurfaceOfRevolution, SurfaceOfLinearExtrusion,
    // OffsetSurface, RectangularTrimmedSurface
    const expected: OcctSurfaceKind[] = [
      'Plane', 'Cylinder', 'Sphere', 'Cone', 'Torus',
      'BezierSurface', 'BSplineSurface', 'NURBSSurface',
      'SurfaceOfRevolution', 'SurfaceOfLinearExtrusion',
      'OffsetSurface', 'RectangularTrimmedSurface',
    ];
    expect(SUPPORTED_SURFACE_KINDS).toEqual(expected);
    expect(SUPPORTED_SURFACE_KINDS).toHaveLength(12);
  });

  it('promoteSurface 는 wrapper { promotion, warnings } 반환 (스텁 단계)', () => {
    const result = promoteSurface(null, null);
    expect(result).toHaveProperty('promotion');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.promotion.kind).toBe('Tessellate');
    if (result.promotion.kind === 'Tessellate') {
      expect(result.promotion.reason).toContain('unsupported');
    }
  });

  it('promoteSurface 의 warnings 는 항상 배열 (Tessellate fallback 시에도 누적)', () => {
    const result = promoteSurface(null, null);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(typeof result.warnings[0]).toBe('string');
  });

  it('SurfacePromotion 의 모든 direct mapping variant 포함', () => {
    const variants: Array<SurfacePromotion['kind']> = [
      'Plane', 'Cylinder', 'Sphere', 'Cone', 'Torus',
      'BezierPatch', 'BSplineSurface', 'NURBSSurface',
      'Tessellate',
    ];
    expect(variants).toContain('Plane');
    expect(variants).toContain('NURBSSurface');
    expect(variants).toContain('Tessellate');
  });

  it('Sweep 변환 (Revolution / Extrusion) 는 SUPPORTED 에 포함', () => {
    expect(SUPPORTED_SURFACE_KINDS).toContain('SurfaceOfRevolution');
    expect(SUPPORTED_SURFACE_KINDS).toContain('SurfaceOfLinearExtrusion');
  });

  it('Trim 변환 (RectangularTrimmedSurface) 는 SUPPORTED 에 포함', () => {
    expect(SUPPORTED_SURFACE_KINDS).toContain('RectangularTrimmedSurface');
  });

  it('Fitting fallback (OffsetSurface) 는 SUPPORTED 에 포함', () => {
    expect(SUPPORTED_SURFACE_KINDS).toContain('OffsetSurface');
  });
});

describe('Optional 필드 — uvBounds / parameterRange / warnings (P21.5, P21.7)', () => {
  it('CurvePromotion 의 모든 variant 는 parameterRange 를 carry 가능', () => {
    // Compile-time: 각 variant 가 optional parameterRange 필드를 받을 수 있는지
    // 컴파일러가 검증. 본 it 는 runtime 의미 없음 — TypeScript type-check 가 핵심.
    const samples: CurvePromotion[] = [
      { kind: 'Line', start: [0, 0, 0], end: [1, 0, 0], parameterRange: [0, 1] },
      { kind: 'Circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 5, parameterRange: [0, 2 * Math.PI] },
      { kind: 'NURBS', controlPts: [[0,0,0]], weights: [1], knots: [0, 0, 1, 1], degree: 1, parameterRange: [0, 1] },
      { kind: 'Tessellate', reason: 'r', parameterRange: [0, 1] },
    ];
    expect(samples.length).toBe(4);
    samples.forEach(s => expect(s.parameterRange).toBeDefined());
  });

  it('SurfacePromotion 의 모든 variant 는 uvBounds 를 carry 가능', () => {
    const samples: SurfacePromotion[] = [
      { kind: 'Plane', origin: [0,0,0], normal: [0,0,1], uvBounds: [0, 1, 0, 1] },
      { kind: 'BezierPatch', ctrlGrid: [[[0,0,0]]], uvBounds: [0, 0.5, 0, 1] },
      { kind: 'NURBSSurface', ctrlGrid: [[[0,0,0]]], weightsGrid: [[1]], knotsU: [0,0,1,1], knotsV: [0,0,1,1], degU: 1, degV: 1, uvBounds: [0.1, 0.9, 0.2, 0.8] },
      { kind: 'Tessellate', reason: 'r', uvBounds: [0, 1, 0, 1] },
    ];
    expect(samples.length).toBe(4);
    samples.forEach(s => expect(s.uvBounds).toBeDefined());
  });
});

describe('ADR-036 cross-link 검증', () => {
  it('Curve 11 + Surface 12 = 23 mapping rows (ADR-036 P21.1+P21.2)', () => {
    expect(SUPPORTED_CURVE_KINDS.length + SUPPORTED_SURFACE_KINDS.length).toBe(23);
  });

  it('각 매핑 표에 Unsupported 는 SUPPORTED 에서 제외 (fallback 별도 처리)', () => {
    expect(SUPPORTED_CURVE_KINDS as string[]).not.toContain('Unsupported');
    expect(SUPPORTED_SURFACE_KINDS as string[]).not.toContain('Unsupported');
  });
});
