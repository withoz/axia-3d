/**
 * Regression tests for occtTrimPromote (ADR-081 W-ε, ADR-036 P21.3).
 *
 * Mock-based unit tests covering:
 * 1. RectangularTrimmedSurface — uvBounds → 4-line synthetic outer loop
 * 2. General TrimmedSurface — single wire of PCurves (Line/Bezier mix)
 * 3. Nested trim — outer wire + inner hole wire (is_outer flag)
 * + Supplementary: BSpline2D PCurve / unsupported PCurve / null inputs
 */

import { describe, it, expect } from 'vitest';
import {
  promoteTrimLoops,
  rectangularTrimLoop,
  type TrimLoop,
} from './occtTrimPromote';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────────────

function mockPnt2d(x: number, y: number) {
  return { X: () => x, Y: () => y };
}

function mock2dPolesArray(pts: Array<[number, number]>) {
  return {
    Lower: () => 1,
    Upper: () => pts.length,
    Value: (i: number) => mockPnt2d(pts[i - 1][0], pts[i - 1][1]),
  };
}

function mockRealArr(values: number[]) {
  return {
    Lower: () => 1,
    Upper: () => values.length,
    Value: (i: number) => values[i - 1],
  };
}

/** Iterator over a fixed array via More/Current/Next. */
function mockIter(items: any[]) {
  let i = 0;
  return {
    More: () => i < items.length,
    Current: () => items[i],
    Next: () => { i++; },
  };
}

/**
 * Build a mock OCCT object whose:
 *   - TopExp_Explorer iterates the given wires (kind === TopAbs_WIRE)
 *   - BRepTools_WireExplorer iterates a wire's edges
 *   - BRep_Tool.CurveOnSurface returns the edge's PCurve handle
 *   - BRepTools.OuterWire returns the marked outer wire (or null)
 *
 * Each wire: `{ edges: [{ handle, first, last, name }, ...] }`
 * Each edge has its own pre-built `handle` whose `.get()` returns a 2d curve
 * with `DynamicType.get_type_name()` matching `name`.
 */
function mockOcctWithWires(
  wires: Array<{ edges: Array<{ handle: any; first: number; last: number }>; isOuter?: boolean }>,
) {
  const TopAbs_WIRE = 5;
  const TopAbs_SHAPE = 8;

  // Find outer wire object (or null)
  const outer = wires.find(w => w.isOuter) ?? null;

  // TopExp_Explorer constructor
  const TopExp_Explorer_2 = function (this: any, _shape: any, kind: number, _toAvoid: number) {
    const items = kind === TopAbs_WIRE ? wires : [];
    Object.assign(this, mockIter(items));
  } as any;

  // BRepTools_WireExplorer constructor — pulls edges from the wire object
  const BRepTools_WireExplorer_2 = function (this: any, wire: any, _face: any) {
    Object.assign(this, mockIter(wire.edges ?? []));
  } as any;

  // Build every Handle_Geom2d_*_2 factory pointing to the handle inspected at runtime.
  // Since DownCast resolves through the SAME handle the caller passed in, we
  // make DownCast just return its argument (the edge's curve handle).
  const downCastIdentity = { DownCast: (h: any) => h };

  return {
    TopAbs_ShapeEnum: { TopAbs_WIRE, TopAbs_SHAPE },
    TopExp_Explorer_2,
    BRepTools_WireExplorer_2,
    BRepTools: {
      OuterWire: (_face: any) => outer,
    },
    BRep_Tool: {
      CurveOnSurface_2: (
        edge: any,
        _face: any,
        f: { current: number },
        l: { current: number },
      ) => {
        f.current = edge.first;
        l.current = edge.last;
        return edge.handle;
      },
    },
    Handle_Geom2d_Line_2: downCastIdentity,
    Handle_Geom2d_Circle_2: downCastIdentity,
    Handle_Geom2d_BezierCurve_2: downCastIdentity,
    Handle_Geom2d_BSplineCurve_2: downCastIdentity,
    Handle_Geom2d_TrimmedCurve_2: downCastIdentity,
  };
}

/** Make a 2d curve handle with the given DynamicType name + impl methods. */
function mkCurve2dHandle(name: string, impl: any) {
  const raw = {
    DynamicType: () => ({ get_type_name: () => name }),
    ...impl,
  };
  return { IsNull: () => false, get: () => raw };
}

// ────────────────────────────────────────────────────────────────────────
// rectangularTrimLoop helper tests
// ────────────────────────────────────────────────────────────────────────

describe('ADR-081 W-ε — rectangularTrimLoop helper', () => {
  it('builds 4 CCW line segments from uvBounds', () => {
    const loop: TrimLoop = rectangularTrimLoop([0, 1, 0, 1]);
    expect(loop.isOuter).toBe(true);
    expect(loop.curves).toHaveLength(4);
    // CCW: bottom (u0,v0)→(u1,v0); right (u1,v0)→(u1,v1); top (u1,v1)→(u0,v1); left (u0,v1)→(u0,v0)
    expect(loop.curves[0]).toEqual({ kind: 'Line', a: [0, 0], b: [1, 0] });
    expect(loop.curves[1]).toEqual({ kind: 'Line', a: [1, 0], b: [1, 1] });
    expect(loop.curves[2]).toEqual({ kind: 'Line', a: [1, 1], b: [0, 1] });
    expect(loop.curves[3]).toEqual({ kind: 'Line', a: [0, 1], b: [0, 0] });
  });

  it('preserves arbitrary uv ranges', () => {
    const loop = rectangularTrimLoop([0.2, 0.8, 0.1, 0.9]);
    expect(loop.curves[0].kind === 'Line' && loop.curves[0].a).toEqual([0.2, 0.1]);
    expect(loop.curves[2].kind === 'Line' && loop.curves[2].b).toEqual([0.2, 0.9]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// promoteTrimLoops — face wire iteration tests
// ────────────────────────────────────────────────────────────────────────

describe('ADR-081 W-ε — promoteTrimLoops', () => {
  it('null occt or face → graceful warning, empty loops', () => {
    const r1 = promoteTrimLoops(null, {});
    expect(r1.loops).toEqual([]);
    expect(r1.warnings.some(w => w.includes('null'))).toBe(true);

    const r2 = promoteTrimLoops({}, null);
    expect(r2.loops).toEqual([]);
    expect(r2.warnings.some(w => w.includes('null'))).toBe(true);
  });

  it('face with no wires → empty loops, no warnings', () => {
    const occt = mockOcctWithWires([]);
    const r = promoteTrimLoops(occt, {});
    expect(r.loops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('single wire of 3 line edges → 1 outer loop with 3 Line curves', () => {
    const lineHandle = (x1: number, y1: number, dx: number, dy: number) =>
      mkCurve2dHandle('Geom2d_Line', {
        Position: () => ({
          Location: () => mockPnt2d(x1, y1),
          Direction: () => ({ X: () => dx, Y: () => dy }),
        }),
      });

    const wire = {
      edges: [
        { handle: lineHandle(0, 0, 1, 0), first: 0, last: 1 },
        { handle: lineHandle(1, 0, 0, 1), first: 0, last: 1 },
        { handle: lineHandle(1, 1, -1, -1), first: 0, last: Math.SQRT2 },
      ],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    expect(r.loops).toHaveLength(1);
    expect(r.loops[0].isOuter).toBe(true);
    expect(r.loops[0].curves).toHaveLength(3);
    r.loops[0].curves.forEach(c => expect(c.kind).toBe('Line'));
    const c0 = r.loops[0].curves[0];
    if (c0.kind === 'Line') {
      expect(c0.a).toEqual([0, 0]);
      expect(c0.b).toEqual([1, 0]);
    }
  });

  it('outer + inner wire → 2 loops, outer first, isOuter flags correct', () => {
    const lineH = (x1: number, y1: number, dx: number, dy: number) =>
      mkCurve2dHandle('Geom2d_Line', {
        Position: () => ({
          Location: () => mockPnt2d(x1, y1),
          Direction: () => ({ X: () => dx, Y: () => dy }),
        }),
      });

    const outerWire = {
      edges: [{ handle: lineH(0, 0, 1, 0), first: 0, last: 1 }],
      isOuter: true,
    };
    const innerWire = {
      edges: [{ handle: lineH(0.3, 0.3, 1, 0), first: 0, last: 0.4 }],
      isOuter: false,
    };

    // Inner wire 가 먼저 (TopExp_Explorer order) 인 경우에도 outer 가 [0]
    // 으로 정렬되는지 검증.
    const occt = mockOcctWithWires([innerWire, outerWire]);
    const r = promoteTrimLoops(occt, {});

    expect(r.loops).toHaveLength(2);
    expect(r.loops[0].isOuter).toBe(true);
    expect(r.loops[1].isOuter).toBe(false);
    // outer 의 curve 가 (0,0)→(1,0) 인지 확인 (정렬 후에도 데이터 보존)
    const c0 = r.loops[0].curves[0];
    if (c0.kind === 'Line') {
      expect(c0.a).toEqual([0, 0]);
      expect(c0.b).toEqual([1, 0]);
    }
  });

  it('Geom2d_Circle PCurve → Arc { startAngle, endAngle }', () => {
    const circHandle = mkCurve2dHandle('Geom2d_Circle', {
      Axis: () => ({ Location: () => mockPnt2d(0.5, 0.5) }),
      Radius: () => 0.25,
    });
    const wire = {
      edges: [{ handle: circHandle, first: 0, last: 2 * Math.PI }],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    expect(r.loops[0].curves[0].kind).toBe('Arc');
    const c = r.loops[0].curves[0];
    if (c.kind === 'Arc') {
      expect(c.center).toEqual([0.5, 0.5]);
      expect(c.radius).toBe(0.25);
      expect(c.startAngle).toBe(0);
      expect(c.endAngle).toBeCloseTo(2 * Math.PI);
    }
  });

  it('Geom2d_BezierCurve PCurve → Bezier { controlPts }', () => {
    const bezHandle = mkCurve2dHandle('Geom2d_BezierCurve', {
      Poles: () => mock2dPolesArray([[0, 0], [0.5, 1], [1, 0]]),
    });
    const wire = {
      edges: [{ handle: bezHandle, first: 0, last: 1 }],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    const c = r.loops[0].curves[0];
    expect(c.kind).toBe('Bezier');
    if (c.kind === 'Bezier') {
      expect(c.controlPts).toHaveLength(3);
      expect(c.controlPts[1]).toEqual([0.5, 1]);
    }
  });

  it('Geom2d_BSplineCurve (non-rational) PCurve → BSpline', () => {
    const bsHandle = mkCurve2dHandle('Geom2d_BSplineCurve', {
      IsRational: () => false,
      Poles: () => mock2dPolesArray([[0, 0], [0.5, 0.3], [1, 0]]),
      // 3 poles + degree 2 → need 3+2+1 = 6 knots (clamped)
      KnotSequence: () => mockRealArr([0, 0, 0, 1, 1, 1]),
      Degree: () => 2,
    });
    const wire = {
      edges: [{ handle: bsHandle, first: 0, last: 1 }],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    const c = r.loops[0].curves[0];
    expect(c.kind).toBe('BSpline');
    if (c.kind === 'BSpline') {
      expect(c.degree).toBe(2);
      expect(c.controlPts).toHaveLength(3);
      expect(c.knots).toEqual([0, 0, 0, 1, 1, 1]);
    }
  });

  it('Geom2d_BSplineCurve rational (NURBS) → Tessellate + warning', () => {
    const bsHandle = mkCurve2dHandle('Geom2d_BSplineCurve', {
      IsRational: () => true,
      Poles: () => mock2dPolesArray([[0, 0], [0.5, 0.3], [1, 0]]),
    });
    const wire = {
      edges: [{ handle: bsHandle, first: 0, last: 1 }],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    const c = r.loops[0].curves[0];
    expect(c.kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('rational'))).toBe(true);
  });

  it('Unsupported PCurve type → Tessellate + warning, loop continues', () => {
    const ellipseHandle = mkCurve2dHandle('Geom2d_Ellipse', {});
    const lineHandle = mkCurve2dHandle('Geom2d_Line', {
      Position: () => ({
        Location: () => mockPnt2d(0, 0),
        Direction: () => ({ X: () => 1, Y: () => 0 }),
      }),
    });
    const wire = {
      edges: [
        { handle: ellipseHandle, first: 0, last: 1 },
        { handle: lineHandle, first: 0, last: 1 },
      ],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    const r = promoteTrimLoops(occt, {});

    expect(r.loops[0].curves).toHaveLength(2);
    expect(r.loops[0].curves[0].kind).toBe('Tessellate');
    expect(r.loops[0].curves[1].kind).toBe('Line');
    expect(r.warnings.some(w => w.includes('Geom2d_Ellipse'))).toBe(true);
  });

  it('PCurve handle null → Tessellate + warning prefixed with edge index', () => {
    const wire = {
      edges: [
        { handle: { IsNull: () => true }, first: 0, last: 1 },
      ],
      isOuter: true,
    };
    const occt = mockOcctWithWires([wire]);
    // Override CurveOnSurface to return the null handle
    occt.BRep_Tool.CurveOnSurface_2 = (
      edge: any,
      _face: any,
      f: { current: number },
      l: { current: number },
    ) => {
      f.current = edge.first;
      l.current = edge.last;
      return edge.handle;
    };

    const r = promoteTrimLoops(occt, {});
    expect(r.loops[0].curves).toHaveLength(1);
    expect(r.loops[0].curves[0].kind).toBe('Tessellate');
    expect(r.warnings.some(w => w.includes('wire[0].edge[0]'))).toBe(true);
  });
});
