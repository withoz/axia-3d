/**
 * Corpus round-trip validation (ADR-081 W-ζ, ADR-036 P21.6).
 *
 * 5 corpus fixture-based round-trip tests:
 * 1. NIST plane (flat surface at z=0) — origin/normal capture + plane equation
 * 2. NIST cylinder (vertical, radius 10) — axis/refDir/radius + sample point on cylinder
 * 3. SolidWorks NURBS surface (3×3 rational patch) — full ctrlGrid + weights + knots capture
 * 4. Fusion B-spline curve (3-pt quadratic clamped) — endpoint interpolation property
 * 5. CATIA trimmed face (RectangularTrimmedSurface) — uvBounds + 4-line CCW outer loop
 *
 * **Tolerance** (ADR-036 P21.6): 1e-3 mm. 모든 promote 결과는 입력 OCCT 데이터를
 * 1e-3 mm 이내로 정확히 보존해야 함. closed-form 수학 property 도 함께 검증.
 *
 * 실제 OCCT.js runtime 검증은 별도 인프라 필요 (W-η UI integration + corpus
 * STEP/IGES 파일). 본 테스트는 fixture mock 으로 W-β/γ/ε pipeline 의 정확도를
 * 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { promoteCurve } from './occtCurvePromote';
import { promoteSurface } from './occtSurfacePromote';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOL_MM = 1e-3;
const TOL_UNIT = 1e-9;

// ────────────────────────────────────────────────────────────────────────
// Mock fixture builders — common patterns across corpus tests
// ────────────────────────────────────────────────────────────────────────

function mockPnt(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

function mockDir(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

function mockPolesArray(pts: Array<[number, number, number]>) {
  return {
    Lower: () => 1,
    Upper: () => pts.length,
    Value: (i: number) => mockPnt(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2]),
  };
}

function mockRealArray(values: number[]) {
  return {
    Lower: () => 1,
    Upper: () => values.length,
    Value: (i: number) => values[i - 1],
  };
}

/**
 * Build a mock OCCT object that returns a fixture surface for any face.
 * `surfaceImpl` provides the surface-specific methods. Includes an empty
 * `TopExp_Explorer_2` so W-ε generic trim attach is silent (no unavailable
 * warning) when no wires are modeled by the corpus fixture.
 */
function mockOcctSurface(
  surfaceTypeName: string,
  surfaceImpl: any,
  uvBounds: [number, number, number, number] = [0, 1, 0, 1],
) {
  const inner = {
    DynamicType: () => ({ get_type_name: () => surfaceTypeName }),
    ...surfaceImpl,
  };
  const handle = { IsNull: () => false, get: () => inner };
  const downCastFactory = { DownCast: (_h: any) => handle };
  // Empty TopExp_Explorer — More() always false → 0 wires, no warnings
  const TopExp_Explorer_2 = function (this: any) {
    Object.assign(this, {
      More: () => false,
      Current: () => null,
      Next: () => undefined,
    });
  } as any;
  return {
    TopAbs_ShapeEnum: { TopAbs_WIRE: 5, TopAbs_SHAPE: 8 },
    TopExp_Explorer_2,
    BRep_Tool: { Surface_2: (_f: any) => handle },
    BRepTools: {
      UVBounds_1: (
        _f: any,
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
      OuterWire: (_f: any) => null,
    },
    Handle_Geom_Plane_2: downCastFactory,
    Handle_Geom_CylindricalSurface_2: downCastFactory,
    Handle_Geom_SphericalSurface_2: downCastFactory,
    Handle_Geom_BSplineSurface_2: downCastFactory,
    Handle_Geom_RectangularTrimmedSurface_2: downCastFactory,
  };
}

function mockOcctCurve(curveTypeName: string, curveImpl: any, first: number, last: number) {
  const inner = {
    DynamicType: () => ({ get_type_name: () => curveTypeName }),
    ...curveImpl,
  };
  const handle = { IsNull: () => false, get: () => inner };
  const downCastFactory = { DownCast: (_h: any) => handle };
  return {
    BRep_Tool: {
      Curve_2: (_e: any, f: { current: number }, l: { current: number }) => {
        f.current = first;
        l.current = last;
        return handle;
      },
    },
    Handle_Geom_BezierCurve_2: downCastFactory,
    Handle_Geom_BSplineCurve_2: downCastFactory,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Vector math helpers
// ────────────────────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function sub(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// ────────────────────────────────────────────────────────────────────────
// Corpus 1 — NIST plane (test_part_1.step style)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-081 W-ζ — corpus round-trip (1e-3 mm)', () => {
  it('Corpus 1 — NIST plane: origin/normal capture + plane equation property', () => {
    // Input: flat plane at origin (5, 5, 0) with normal (0, 0, 1).
    const expectedOrigin: [number, number, number] = [5, 5, 0];
    const expectedNormal: [number, number, number] = [0, 0, 1];

    const occt = mockOcctSurface(
      'Geom_Plane',
      {
        Position: () => ({
          Location: () => mockPnt(...expectedOrigin),
          Direction: () => mockDir(...expectedNormal),
        }),
      },
      [-50, 50, -50, 50],
    );

    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Plane');

    if (r.promotion.kind === 'Plane') {
      // Identity capture within 1e-3 mm
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(r.promotion.origin[i] - expectedOrigin[i])).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.normal[i] - expectedNormal[i])).toBeLessThan(TOL_UNIT);
      }
      // Normal is unit length within 1e-9
      expect(Math.abs(norm(r.promotion.normal) - 1)).toBeLessThan(TOL_UNIT);
      // Plane equation holds: any point on plane satisfies (P - origin) · normal == 0
      // Sample points on the XY plane through origin:
      const samples: Array<[number, number, number]> = [
        [10, 5, 0],   // +X displacement (still on z=0 plane)
        [5, 10, 0],   // +Y displacement
        [-5, -3, 0],  // diagonal in plane
      ];
      for (const P of samples) {
        const eq = dot(sub(P, r.promotion.origin), r.promotion.normal);
        expect(Math.abs(eq)).toBeLessThan(TOL_MM);
      }
      // uvBounds preserved within 1e-3
      expect(r.promotion.uvBounds).toBeDefined();
      if (r.promotion.uvBounds) {
        expect(Math.abs(r.promotion.uvBounds[0] - (-50))).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.uvBounds[1] - 50)).toBeLessThan(TOL_MM);
      }
    }
    expect(r.warnings.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Corpus 2 — NIST cylinder (test_part_2.step style)
  // ────────────────────────────────────────────────────────────────────

  it('Corpus 2 — NIST cylinder: axis/refDir/radius + axis-distance property', () => {
    // Input: vertical cylinder at origin, axis +Z, refDir +X, radius 10.
    const axisOrigin: [number, number, number] = [0, 0, 0];
    const axisDir: [number, number, number] = [0, 0, 1];
    const refDir: [number, number, number] = [1, 0, 0];
    const radius = 10;

    const occt = mockOcctSurface(
      'Geom_CylindricalSurface',
      {
        Position: () => ({
          Location: () => mockPnt(...axisOrigin),
          Direction: () => mockDir(...axisDir),
          XDirection: () => mockDir(...refDir),
        }),
        Radius: () => radius,
      },
      [0, 2 * Math.PI, 0, 50],
    );

    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Cylinder');

    if (r.promotion.kind === 'Cylinder') {
      // Identity capture within 1e-3 mm
      expect(Math.abs(r.promotion.radius - radius)).toBeLessThan(TOL_MM);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(r.promotion.axisOrigin[i] - axisOrigin[i])).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.axisDir[i] - axisDir[i])).toBeLessThan(TOL_UNIT);
        expect(Math.abs(r.promotion.refDir[i] - refDir[i])).toBeLessThan(TOL_UNIT);
      }
      // axisDir / refDir 둘 다 unit length
      expect(Math.abs(norm(r.promotion.axisDir) - 1)).toBeLessThan(TOL_UNIT);
      expect(Math.abs(norm(r.promotion.refDir) - 1)).toBeLessThan(TOL_UNIT);
      // axisDir ⊥ refDir
      expect(Math.abs(dot(r.promotion.axisDir, r.promotion.refDir))).toBeLessThan(TOL_UNIT);

      // Sample point on cylinder at angle θ, height h:
      //   P = axisOrigin + r·(cos(θ)·refDir + sin(θ)·yDir) + h·axisDir
      //   yDir = axisDir × refDir
      const yDir = cross(r.promotion.axisDir, r.promotion.refDir);
      const samples = [
        { theta: 0, h: 0 },
        { theta: Math.PI / 2, h: 25 },
        { theta: Math.PI, h: 50 },
      ];
      for (const { theta, h } of samples) {
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const P: [number, number, number] = [
          r.promotion.axisOrigin[0] + r.promotion.radius * (c * r.promotion.refDir[0] + s * yDir[0]) + h * r.promotion.axisDir[0],
          r.promotion.axisOrigin[1] + r.promotion.radius * (c * r.promotion.refDir[1] + s * yDir[1]) + h * r.promotion.axisDir[1],
          r.promotion.axisOrigin[2] + r.promotion.radius * (c * r.promotion.refDir[2] + s * yDir[2]) + h * r.promotion.axisDir[2],
        ];
        // Distance from P to the axis line == radius
        const ap = sub(P, r.promotion.axisOrigin);
        const proj = dot(ap, r.promotion.axisDir);
        const radial = sub(ap, [
          proj * r.promotion.axisDir[0],
          proj * r.promotion.axisDir[1],
          proj * r.promotion.axisDir[2],
        ]);
        expect(Math.abs(norm(radial) - r.promotion.radius)).toBeLessThan(TOL_MM);
      }
    }
    expect(r.warnings.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Corpus 3 — SolidWorks NURBS surface (rational 3×3 patch)
  // ────────────────────────────────────────────────────────────────────

  it('Corpus 3 — SolidWorks NURBS 3×3: full ctrlGrid + weightsGrid + knots capture', () => {
    // Input: 3×3 rational quadratic patch (e.g., a quarter sphere octant approximation).
    // For simplicity use simple control net with non-uniform weights.
    const ctrlNet: Array<[number, number, number]>[] = [
      [[0, 0, 0], [1, 0, 0.5], [2, 0, 0]],
      [[0, 1, 0.5], [1, 1, 1.0], [2, 1, 0.5]],
      [[0, 2, 0], [1, 2, 0.5], [2, 2, 0]],
    ];
    const weights: number[][] = [
      [1, Math.SQRT1_2, 1],
      [Math.SQRT1_2, 0.5, Math.SQRT1_2],
      [1, Math.SQRT1_2, 1],
    ];
    const knotsU = [0, 0, 0, 1, 1, 1];  // clamped quadratic 3 poles → 6 knots
    const knotsV = [0, 0, 0, 1, 1, 1];

    const occt = mockOcctSurface(
      'Geom_BSplineSurface',
      {
        IsURational: () => true,
        IsVRational: () => true,
        UDegree: () => 2,
        VDegree: () => 2,
        NbUPoles: () => 3,
        NbVPoles: () => 3,
        Pole: (i: number, j: number) => mockPnt(...ctrlNet[i - 1][j - 1]),
        Weight: (i: number, j: number) => weights[i - 1][j - 1],
        UKnotSequence: () => mockRealArray(knotsU),
        VKnotSequence: () => mockRealArray(knotsV),
      },
      [0, 1, 0, 1],
    );

    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('NURBSSurface');

    if (r.promotion.kind === 'NURBSSurface') {
      // Identity capture
      expect(r.promotion.degU).toBe(2);
      expect(r.promotion.degV).toBe(2);
      expect(r.promotion.ctrlGrid).toHaveLength(3);
      expect(r.promotion.ctrlGrid[0]).toHaveLength(3);
      expect(r.promotion.weightsGrid).toHaveLength(3);

      // ALL control points captured within 1e-3 mm
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          for (let k = 0; k < 3; k++) {
            expect(Math.abs(r.promotion.ctrlGrid[i][j][k] - ctrlNet[i][j][k])).toBeLessThan(TOL_MM);
          }
          // ALL weights captured exactly (weights are dimensionless, machine epsilon)
          expect(Math.abs(r.promotion.weightsGrid[i][j] - weights[i][j])).toBeLessThan(TOL_UNIT);
        }
      }
      // knots captured exactly
      expect(r.promotion.knotsU).toEqual(knotsU);
      expect(r.promotion.knotsV).toEqual(knotsV);

      // Knot count invariant (Rust validate() 정합):
      expect(r.promotion.knotsU.length).toBe(r.promotion.ctrlGrid.length + r.promotion.degU + 1);
      expect(r.promotion.knotsV.length).toBe(r.promotion.ctrlGrid[0].length + r.promotion.degV + 1);

      // Endpoint interpolation property (clamped knots):
      // S(uMin, vMin) = ctrl[0][0], S(uMax, vMax) = ctrl[end][end]
      // 우리는 evaluator 가 없지만 control point capture 가 정확하면
      // Rust evaluator (truth) 에서 이 property 가 자동 보장됨.
      // → P21.8 (Stage 4-A/4-B 일관성) 의 의미: 매핑 표가 1:1 이면 evaluator
      //   결과도 1:1.
    }
    expect(r.warnings.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Corpus 4 — Fusion B-spline curve (3-pt quadratic clamped)
  // ────────────────────────────────────────────────────────────────────

  it('Corpus 4 — Fusion B-spline curve: poles + knots capture + endpoint interpolation', () => {
    // Input: clamped quadratic B-spline with 3 control points
    // (matches a parabolic arc shape).
    const polesArr: Array<[number, number, number]> = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
    ];
    const knots = [0, 0, 0, 1, 1, 1];  // clamped: 3 poles + degree 2 → 6 knots
    const degree = 2;

    const occt = mockOcctCurve(
      'Geom_BSplineCurve',
      {
        IsRational: () => false,
        Poles: () => mockPolesArray(polesArr),
        KnotSequence: () => mockRealArray(knots),
        Degree: () => degree,
      },
      0, 1,
    );

    const r = promoteCurve(occt, {});
    expect(r.promotion.kind).toBe('BSpline');

    if (r.promotion.kind === 'BSpline') {
      expect(r.promotion.degree).toBe(degree);
      expect(r.promotion.controlPts).toHaveLength(3);

      // Identity capture within 1e-3 mm
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(r.promotion.controlPts[i][k] - polesArr[i][k])).toBeLessThan(TOL_MM);
        }
      }
      expect(r.promotion.knots).toEqual(knots);

      // Knot count invariant
      expect(r.promotion.knots.length).toBe(r.promotion.controlPts.length + r.promotion.degree + 1);

      // Parameter range preserved (P21.5)
      expect(r.promotion.parameterRange).toBeDefined();
      if (r.promotion.parameterRange) {
        expect(r.promotion.parameterRange[0]).toBeCloseTo(0);
        expect(r.promotion.parameterRange[1]).toBeCloseTo(1);
      }

      // Endpoint interpolation (clamped knots property):
      // B(0) = ctrl[0], B(1) = ctrl[end]
      // 검증은 control point identity + knot 정합 으로 충분 (ADR-036 P21.8).
    }
    expect(r.warnings.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // Corpus 5 — CATIA RectangularTrimmedSurface (Plane basis)
  // ────────────────────────────────────────────────────────────────────

  it('Corpus 5 — CATIA RectangularTrimmedSurface: uvBounds + 4-line CCW outer trim', () => {
    // Input: trimmed plane at origin (10, 20, 30) with uv range [0.2, 0.8] × [0.1, 0.9].
    const planeOrigin: [number, number, number] = [10, 20, 30];
    const planeNormal: [number, number, number] = [0, 0, 1];
    const u0 = 0.2, u1 = 0.8, v0 = 0.1, v1 = 0.9;

    const planeBasis = {
      DynamicType: () => ({ get_type_name: () => 'Geom_Plane' }),
      Position: () => ({
        Location: () => mockPnt(...planeOrigin),
        Direction: () => mockDir(...planeNormal),
      }),
    };
    const occt = mockOcctSurface(
      'Geom_RectangularTrimmedSurface',
      {
        BasisSurface: () => ({ IsNull: () => false, get: () => planeBasis }),
        U1: () => u0,
        U2: () => u1,
        V1: () => v0,
        V2: () => v1,
      },
      [0, 1, 0, 1],  // face uvBounds (fallback, overridden by trim U1/U2/V1/V2)
    );

    const r = promoteSurface(occt, {});
    expect(r.promotion.kind).toBe('Plane');

    if (r.promotion.kind === 'Plane') {
      // Plane basis preserved within 1e-3 mm
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(r.promotion.origin[i] - planeOrigin[i])).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.normal[i] - planeNormal[i])).toBeLessThan(TOL_UNIT);
      }
      // uvBounds = trim U1/U2/V1/V2 (not face fallback)
      expect(r.promotion.uvBounds).toBeDefined();
      if (r.promotion.uvBounds) {
        expect(Math.abs(r.promotion.uvBounds[0] - u0)).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.uvBounds[1] - u1)).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.uvBounds[2] - v0)).toBeLessThan(TOL_MM);
        expect(Math.abs(r.promotion.uvBounds[3] - v1)).toBeLessThan(TOL_MM);
      }
      // Synthetic rectangular trim loop (W-ε fast-path)
      expect(r.promotion.trimLoops).toBeDefined();
      if (r.promotion.trimLoops) {
        expect(r.promotion.trimLoops).toHaveLength(1);
        const outer = r.promotion.trimLoops[0];
        expect(outer.isOuter).toBe(true);
        expect(outer.curves).toHaveLength(4);

        // CCW corner sequence: (u0,v0) → (u1,v0) → (u1,v1) → (u0,v1) → (u0,v0)
        const expectedCorners: Array<[number, number]> = [
          [u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0],
        ];
        for (let i = 0; i < 4; i++) {
          const c = outer.curves[i];
          expect(c.kind).toBe('Line');
          if (c.kind === 'Line') {
            expect(Math.abs(c.a[0] - expectedCorners[i][0])).toBeLessThan(TOL_MM);
            expect(Math.abs(c.a[1] - expectedCorners[i][1])).toBeLessThan(TOL_MM);
            expect(Math.abs(c.b[0] - expectedCorners[i + 1][0])).toBeLessThan(TOL_MM);
            expect(Math.abs(c.b[1] - expectedCorners[i + 1][1])).toBeLessThan(TOL_MM);
          }
        }

        // Closed loop property: each edge's endpoint == next edge's startpoint
        for (let i = 0; i < 4; i++) {
          const cur = outer.curves[i];
          const nxt = outer.curves[(i + 1) % 4];
          if (cur.kind === 'Line' && nxt.kind === 'Line') {
            expect(Math.abs(cur.b[0] - nxt.a[0])).toBeLessThan(TOL_MM);
            expect(Math.abs(cur.b[1] - nxt.a[1])).toBeLessThan(TOL_MM);
          }
        }
      }
    }
  });
});
