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

// ════════════════════════════════════════════════════════════════════
// ADR-081 W-β — occtCurvePromote 11 본체 (mock-based unit tests)
// ════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mock gp_Pnt-like point with X/Y/Z accessors. */
function mockPnt(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

/** Mock NCollection_Array1<gp_Pnt> with Lower/Upper/Value(i) (1-based). */
function mockPolesArray(pts: Array<[number, number, number]>) {
  return {
    Lower: () => 1,
    Upper: () => pts.length,
    Value: (i: number) => mockPnt(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2]),
  };
}

/** Mock NCollection_Array1<Real> with Lower/Upper/Value(i) (1-based). */
function mockRealArray(values: number[]) {
  return {
    Lower: () => 1,
    Upper: () => values.length,
    Value: (i: number) => values[i - 1],
  };
}

/**
 * Build a mock OCCT object that returns a given curve handle for any edge.
 * Curve type identified by `curveTypeName` (Geom_Line / Geom_Circle / etc).
 * `curveImpl` provides the curve-specific methods (Position, Axis, etc).
 */
function mockOcctWithCurve(curveTypeName: string, curveImpl: any, first: number, last: number) {
  const innerCurve = {
    DynamicType: () => ({ get_type_name: () => curveTypeName }),
    ...curveImpl,
  };
  const curveHandle = {
    IsNull: () => false,
    get: () => innerCurve,
  };
  const downCastFactory = { DownCast: (_h: any) => curveHandle };
  return {
    BRep_Tool: {
      Curve_2: (_e: any, f: { current: number }, l: { current: number }) => {
        f.current = first;
        l.current = last;
        return curveHandle;
      },
    },
    Handle_Geom_Line_2: downCastFactory,
    Handle_Geom_Circle_2: downCastFactory,
    Handle_Geom_TrimmedCurve_2: downCastFactory,
    Handle_Geom_BezierCurve_2: downCastFactory,
    Handle_Geom_BSplineCurve_2: downCastFactory,
    Handle_Geom_Ellipse_2: downCastFactory,
    Handle_Geom_Parabola_2: downCastFactory,
    Handle_Geom_Hyperbola_2: downCastFactory,
  };
}

describe('ADR-081 W-β — occtCurvePromote 11 본체', () => {
  it('promoteLine: 직선 → Line { start, end, parameterRange }', () => {
    const occt = mockOcctWithCurve(
      'Geom_Line',
      {
        Position: () => ({
          Location: () => mockPnt(1, 2, 3),
          Direction: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
        }),
      },
      0, 5,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Line');
    if (r.promotion.kind === 'Line') {
      expect(r.promotion.start).toEqual([1, 2, 3]);
      expect(r.promotion.end).toEqual([6, 2, 3]);
      expect(r.promotion.parameterRange).toEqual([0, 5]);
    }
  });

  it('promoteCircle: 원 → Circle { center, normal, radius }', () => {
    const occt = mockOcctWithCurve(
      'Geom_Circle',
      {
        Axis: () => ({
          Location: () => mockPnt(0, 0, 0),
          Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
        }),
        Radius: () => 5,
      },
      0, 2 * Math.PI,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Circle');
    if (r.promotion.kind === 'Circle') {
      expect(r.promotion.center).toEqual([0, 0, 0]);
      expect(r.promotion.normal).toEqual([0, 0, 1]);
      expect(r.promotion.radius).toBe(5);
    }
  });

  it('promoteArc: TrimmedCurve(Circle) → Arc { startAngle, endAngle }', () => {
    const circleBasis = {
      DynamicType: () => ({ get_type_name: () => 'Geom_Circle' }),
      Axis: () => ({
        Location: () => mockPnt(0, 0, 0),
        Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
        XDirection: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
      }),
      Radius: () => 3,
    };
    const occt = mockOcctWithCurve(
      'Geom_TrimmedCurve',
      {
        BasisCurve: () => ({ get: () => circleBasis }),
      },
      0, Math.PI / 2,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Arc');
    if (r.promotion.kind === 'Arc') {
      expect(r.promotion.center).toEqual([0, 0, 0]);
      expect(r.promotion.radius).toBe(3);
      expect(r.promotion.startAngle).toBe(0);
      expect(r.promotion.endAngle).toBeCloseTo(Math.PI / 2);
    }
  });

  it('promoteBezier: 베지어 → Bezier { controlPts, parameterRange }', () => {
    const occt = mockOcctWithCurve(
      'Geom_BezierCurve',
      {
        Poles: () => mockPolesArray([[0, 0, 0], [1, 1, 0], [2, 0, 0]]),
      },
      0, 1,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Bezier');
    if (r.promotion.kind === 'Bezier') {
      expect(r.promotion.controlPts.length).toBe(3);
      expect(r.promotion.controlPts[1]).toEqual([1, 1, 0]);
    }
  });

  it('promoteBSpline (non-rational): BSpline → BSpline { controlPts, knots, degree }', () => {
    const occt = mockOcctWithCurve(
      'Geom_BSplineCurve',
      {
        IsRational: () => false,
        Poles: () => mockPolesArray([[0, 0, 0], [1, 0, 0], [2, 0, 0]]),
        KnotSequence: () => mockRealArray([0, 0, 0.5, 1, 1]),
        Degree: () => 2,
      },
      0, 1,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('BSpline');
    if (r.promotion.kind === 'BSpline') {
      expect(r.promotion.degree).toBe(2);
      expect(r.promotion.controlPts.length).toBe(3);
    }
  });

  it('promoteNurbs (rational BSpline): NURBS → { controlPts, weights, knots, degree }', () => {
    const occt = mockOcctWithCurve(
      'Geom_BSplineCurve',
      {
        IsRational: () => true,
        Poles: () => mockPolesArray([[0, 0, 0], [1, 0, 0], [2, 0, 0]]),
        Weights: () => mockRealArray([1, 0.7, 1]),
        KnotSequence: () => mockRealArray([0, 0, 0.5, 1, 1]),
        Degree: () => 2,
      },
      0, 1,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('NURBS');
    if (r.promotion.kind === 'NURBS') {
      expect(r.promotion.weights).toEqual([1, 0.7, 1]);
      expect(r.promotion.degree).toBe(2);
    }
  });

  it('promoteEllipse: Ellipse → 9-CP rational quadratic NURBS (Piegl A7.1)', () => {
    const occt = mockOcctWithCurve(
      'Geom_Ellipse',
      {
        Axis: () => ({
          Location: () => mockPnt(0, 0, 0),
          XDirection: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
          YDirection: () => ({ X: () => 0, Y: () => 1, Z: () => 0 }),
        }),
        MajorRadius: () => 3,
        MinorRadius: () => 2,
      },
      0, 2 * Math.PI,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('NURBS');
    if (r.promotion.kind === 'NURBS') {
      expect(r.promotion.controlPts.length).toBe(9);
      expect(r.promotion.weights.length).toBe(9);
      expect(r.promotion.degree).toBe(2);
      expect(r.promotion.weights[0]).toBe(1);
      expect(r.promotion.weights[1]).toBeCloseTo(Math.SQRT2 / 2);
    }
  });

  it('promoteParabola: Parabola → 3-CP quadratic Bezier (Piegl A7.4)', () => {
    const occt = mockOcctWithCurve(
      'Geom_Parabola',
      {
        Focal: () => 1,
        Axis: () => ({
          Location: () => mockPnt(0, 0, 0),
          XDirection: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
          YDirection: () => ({ X: () => 0, Y: () => 1, Z: () => 0 }),
        }),
      },
      -1, 1,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Bezier');
    if (r.promotion.kind === 'Bezier') {
      expect(r.promotion.controlPts.length).toBe(3);
    }
  });

  it('promoteHyperbola: Hyperbola → rational quadratic NURBS (Piegl A7.5)', () => {
    const occt = mockOcctWithCurve(
      'Geom_Hyperbola',
      {
        MajorRadius: () => 1,
        MinorRadius: () => 1,
        Axis: () => ({
          Location: () => mockPnt(0, 0, 0),
          XDirection: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
          YDirection: () => ({ X: () => 0, Y: () => 1, Z: () => 0 }),
        }),
      },
      -0.5, 0.5,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('NURBS');
    if (r.promotion.kind === 'NURBS') {
      expect(r.promotion.controlPts.length).toBe(3);
      expect(r.promotion.weights.length).toBe(3);
      expect(r.promotion.weights[0]).toBe(1);
      expect(r.promotion.weights[2]).toBe(1);
      expect(r.promotion.weights[1]).toBeGreaterThan(1);
    }
  });

  it('promoteOffsetCurve: Tessellate fallback + W-3-ε deferred warning', () => {
    const occt = mockOcctWithCurve('Geom_OffsetCurve', {}, 0, 1);
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('W-3-ε'))).toBe(true);
  });

  it('promoteTrimmedCurve (non-Circle basis): Tessellate + parameterRange 보존', () => {
    const bsplineBasis = {
      DynamicType: () => ({ get_type_name: () => 'Geom_BSplineCurve' }),
    };
    const occt = mockOcctWithCurve(
      'Geom_TrimmedCurve',
      {
        BasisCurve: () => ({ get: () => bsplineBasis }),
      },
      0.2, 0.8,
    );
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.promotion.parameterRange).toEqual([0.2, 0.8]);
  });

  it('Unsupported curve type → Tessellate fallback + warning', () => {
    const occt = mockOcctWithCurve('Geom_SomeFutureType', {}, 0, 1);
    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// ADR-081 W-γ — occtSurfacePromote 12 본체 (mock-based unit tests)
// ════════════════════════════════════════════════════════════════════

/** Mock NCollection_Array2<Real> with Lower/Upper/Value(i,j) (1-based). */
function mockReal2DArray(values: number[][]) {
  const nU = values.length;
  const nV = values[0]?.length ?? 0;
  return {
    LowerRow: () => 1,
    UpperRow: () => nU,
    LowerCol: () => 1,
    UpperCol: () => nV,
    Value: (i: number, j: number) => values[i - 1][j - 1],
  };
}

/**
 * Build a mock OCCT object that returns a given surface handle for any face.
 * Surface type identified by `surfaceTypeName` (Geom_Plane / Geom_BSplineSurface / etc).
 * `surfaceImpl` provides the surface-specific methods (Position, Pole(i,j), etc).
 */
function mockOcctWithSurface(
  surfaceTypeName: string,
  surfaceImpl: any,
  uvBounds: [number, number, number, number] = [0, 1, 0, 1],
) {
  const innerSurface = {
    DynamicType: () => ({ get_type_name: () => surfaceTypeName }),
    ...surfaceImpl,
  };
  const surfaceHandle = {
    IsNull: () => false,
    get: () => innerSurface,
  };
  const downCastFactory = { DownCast: (_h: any) => surfaceHandle };
  return {
    BRep_Tool: {
      Surface_2: (_face: any) => surfaceHandle,
    },
    BRepTools: {
      UVBounds_1: (
        _face: any,
        u1: { current: number },
        u2: { current: number },
        v1: { current: number },
        v2: { current: number },
      ) => {
        u1.current = uvBounds[0];
        u2.current = uvBounds[1];
        v1.current = uvBounds[2];
        v2.current = uvBounds[3];
        return true;
      },
    },
    Handle_Geom_Plane_2: downCastFactory,
    Handle_Geom_CylindricalSurface_2: downCastFactory,
    Handle_Geom_SphericalSurface_2: downCastFactory,
    Handle_Geom_ConicalSurface_2: downCastFactory,
    Handle_Geom_ToroidalSurface_2: downCastFactory,
    Handle_Geom_BezierSurface_2: downCastFactory,
    Handle_Geom_BSplineSurface_2: downCastFactory,
    Handle_Geom_SurfaceOfRevolution_2: downCastFactory,
    Handle_Geom_SurfaceOfLinearExtrusion_2: downCastFactory,
    Handle_Geom_OffsetSurface_2: downCastFactory,
    Handle_Geom_RectangularTrimmedSurface_2: downCastFactory,
  };
}

describe('ADR-081 W-γ — occtSurfacePromote 12 본체', () => {
  it('promotePlane: 평면 → Plane { origin, normal, uvBounds }', () => {
    const occt = mockOcctWithSurface(
      'Geom_Plane',
      {
        Position: () => ({
          Location: () => mockPnt(1, 2, 3),
          Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
        }),
      },
      [0, 10, 0, 10],
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Plane');
    if (r.promotion.kind === 'Plane') {
      expect(r.promotion.origin).toEqual([1, 2, 3]);
      expect(r.promotion.normal).toEqual([0, 0, 1]);
      expect(r.promotion.uvBounds).toEqual([0, 10, 0, 10]);
    }
  });

  it('promoteCylinder: 원통 → Cylinder { axisOrigin, axisDir, refDir, radius }', () => {
    const occt = mockOcctWithSurface(
      'Geom_CylindricalSurface',
      {
        Position: () => ({
          Location: () => mockPnt(0, 0, 0),
          Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
          XDirection: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
        }),
        Radius: () => 5,
      },
      [0, 2 * Math.PI, 0, 10],
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Cylinder');
    if (r.promotion.kind === 'Cylinder') {
      expect(r.promotion.axisOrigin).toEqual([0, 0, 0]);
      expect(r.promotion.axisDir).toEqual([0, 0, 1]);
      expect(r.promotion.refDir).toEqual([1, 0, 0]);
      expect(r.promotion.radius).toBe(5);
    }
  });

  it('promoteSphere: 구 → Sphere { center, radius }', () => {
    const occt = mockOcctWithSurface(
      'Geom_SphericalSurface',
      {
        Position: () => ({
          Location: () => mockPnt(0, 0, 0),
        }),
        Radius: () => 4,
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Sphere');
    if (r.promotion.kind === 'Sphere') {
      expect(r.promotion.center).toEqual([0, 0, 0]);
      expect(r.promotion.radius).toBe(4);
    }
  });

  it('promoteCone: 원뿔 → Cone { apex, axisDir, halfAngle } (apex = base - (R/tan α)·axis)', () => {
    // RefRadius = 1, halfAngle = π/4 → apexOffset = 1/tan(π/4) = 1.
    // base = (0, 0, 0), axis = (0, 0, 1) → apex = (0, 0, -1).
    const occt = mockOcctWithSurface(
      'Geom_ConicalSurface',
      {
        Position: () => ({
          Location: () => mockPnt(0, 0, 0),
          Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
        }),
        RefRadius: () => 1,
        SemiAngle: () => Math.PI / 4,
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Cone');
    if (r.promotion.kind === 'Cone') {
      expect(r.promotion.apex[0]).toBeCloseTo(0);
      expect(r.promotion.apex[1]).toBeCloseTo(0);
      expect(r.promotion.apex[2]).toBeCloseTo(-1);
      expect(r.promotion.axisDir).toEqual([0, 0, 1]);
      expect(r.promotion.halfAngle).toBeCloseTo(Math.PI / 4);
    }
  });

  it('promoteTorus: 토러스 → Torus { center, axis, majorRadius, minorRadius }', () => {
    const occt = mockOcctWithSurface(
      'Geom_ToroidalSurface',
      {
        Position: () => ({
          Location: () => mockPnt(1, 1, 1),
          Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
        }),
        MajorRadius: () => 5,
        MinorRadius: () => 1,
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Torus');
    if (r.promotion.kind === 'Torus') {
      expect(r.promotion.center).toEqual([1, 1, 1]);
      expect(r.promotion.axis).toEqual([0, 0, 1]);
      expect(r.promotion.majorRadius).toBe(5);
      expect(r.promotion.minorRadius).toBe(1);
    }
  });

  it('promoteBezierSurface: 베지어 패치 → BezierPatch { ctrlGrid }', () => {
    // 2×2 patch
    const occt = mockOcctWithSurface(
      'Geom_BezierSurface',
      {
        NbUPoles: () => 2,
        NbVPoles: () => 2,
        Pole: (i: number, j: number) => mockPnt(i - 1, j - 1, 0),
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('BezierPatch');
    if (r.promotion.kind === 'BezierPatch') {
      expect(r.promotion.ctrlGrid.length).toBe(2);
      expect(r.promotion.ctrlGrid[0].length).toBe(2);
      expect(r.promotion.ctrlGrid[0][0]).toEqual([0, 0, 0]);
      expect(r.promotion.ctrlGrid[1][1]).toEqual([1, 1, 0]);
    }
  });

  it('promoteBSplineSurface (non-rational): BSpline → { ctrlGrid, knotsU/V, degU/V }', () => {
    const occt = mockOcctWithSurface(
      'Geom_BSplineSurface',
      {
        IsURational: () => false,
        IsVRational: () => false,
        UDegree: () => 1,
        VDegree: () => 1,
        NbUPoles: () => 2,
        NbVPoles: () => 2,
        Pole: (i: number, j: number) => mockPnt(i - 1, j - 1, 0),
        UKnotSequence: () => mockRealArray([0, 0, 1, 1]),
        VKnotSequence: () => mockRealArray([0, 0, 1, 1]),
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('BSplineSurface');
    if (r.promotion.kind === 'BSplineSurface') {
      expect(r.promotion.degU).toBe(1);
      expect(r.promotion.degV).toBe(1);
      expect(r.promotion.ctrlGrid.length).toBe(2);
      expect(r.promotion.knotsU).toEqual([0, 0, 1, 1]);
      expect(r.promotion.knotsV).toEqual([0, 0, 1, 1]);
    }
  });

  it('promoteNurbsSurface (rational BSpline): NURBS → { ctrlGrid, weightsGrid, knots, deg }', () => {
    const occt = mockOcctWithSurface(
      'Geom_BSplineSurface',
      {
        IsURational: () => true,
        IsVRational: () => false,
        UDegree: () => 1,
        VDegree: () => 1,
        NbUPoles: () => 2,
        NbVPoles: () => 2,
        Pole: (i: number, j: number) => mockPnt(i - 1, j - 1, 0),
        Weight: (i: number, j: number) => (i === 1 && j === 1 ? 0.5 : 1),
        UKnotSequence: () => mockRealArray([0, 0, 1, 1]),
        VKnotSequence: () => mockRealArray([0, 0, 1, 1]),
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('NURBSSurface');
    if (r.promotion.kind === 'NURBSSurface') {
      expect(r.promotion.weightsGrid[0][0]).toBe(0.5);
      expect(r.promotion.weightsGrid[1][1]).toBe(1);
      expect(r.promotion.degU).toBe(1);
    }
  });

  it('promoteSurfaceOfRevolution: W-3-ε deferred → Tessellate + warning', () => {
    const occt = mockOcctWithSurface('Geom_SurfaceOfRevolution', {});
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('Piegl A8.1'))).toBe(true);
  });

  it('promoteSurfaceOfLinearExtrusion: W-3-ε deferred → Tessellate + warning', () => {
    const occt = mockOcctWithSurface('Geom_SurfaceOfLinearExtrusion', {});
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('Piegl A8.2'))).toBe(true);
  });

  it('promoteOffsetSurface: W-3-ε deferred → Tessellate + warning', () => {
    const occt = mockOcctWithSurface('Geom_OffsetSurface', {});
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('OffsetSurface'))).toBe(true);
  });

  it('promoteRectangularTrimmedSurface (Plane basis): BasisSurface 매핑 + uvBounds clip', () => {
    // Trim 의 U1/U2/V1/V2 를 trim 영역으로 사용. basis = Plane.
    const planeBasis = {
      DynamicType: () => ({ get_type_name: () => 'Geom_Plane' }),
      Position: () => ({
        Location: () => mockPnt(0, 0, 0),
        Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
      }),
    };
    const occt = mockOcctWithSurface(
      'Geom_RectangularTrimmedSurface',
      {
        BasisSurface: () => ({ IsNull: () => false, get: () => planeBasis }),
        U1: () => 0.1,
        U2: () => 0.9,
        V1: () => 0.2,
        V2: () => 0.8,
      },
    );
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Plane');
    if (r.promotion.kind === 'Plane') {
      expect(r.promotion.uvBounds).toEqual([0.1, 0.9, 0.2, 0.8]);
    }
  });

  it('Unsupported surface type → Tessellate fallback + warning', () => {
    const occt = mockOcctWithSurface('Geom_SomeFutureType', {});
    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Tessellate');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
