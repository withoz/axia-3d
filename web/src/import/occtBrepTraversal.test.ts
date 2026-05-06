/**
 * Regression tests for occtBrepTraversal (ADR-081 W-δ).
 *
 * 5 mock-based unit tests covering:
 * 1. Empty shape — graceful 0/0/0 return
 * 2. Face count + index promotion (multiple faces, stable order)
 * 3. Edge count + index promotion (multiple edges)
 * 4. Smoke — mixed face + edge round-trip
 * 5. Warnings collection — Tessellate fallback warnings prefixed with index
 *
 * 모든 테스트는 mock OCCT object (TopExp_Explorer + per-face/edge surface/curve
 * stub) 로 동작. 실제 OCCT runtime 검증은 W-ζ 코퍼스 단계.
 */

import { describe, it, expect } from 'vitest';
import { traverseBrep } from './occtBrepTraversal';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mock gp_Pnt-like point. */
function mockPnt(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

/**
 * Build a mock TopExp_Explorer that iterates a fixed array.
 *
 * `currentValueProvider(i)` returns the value of `Current()` at step i.
 * `More()` returns true while i < items.length.
 */
function mockExplorer(items: any[]): any {
  let i = 0;
  return {
    More: () => i < items.length,
    Current: () => items[i],
    Next: () => { i++; },
  };
}

/**
 * Build a mock OCCT object with stage-aware TopExp_Explorer:
 * the constructor inspects `kind` arg and returns face or edge iterator.
 */
function mockOcctWithShape(faces: any[], edges: any[]) {
  const TopAbs_FACE = 4;
  const TopAbs_EDGE = 6;
  // TopExp_Explorer_2 — version-tolerant primary path used by makeExplorer
  const TopExp_Explorer_2 = function (this: any, _shape: any, kind: number, _toAvoid: number) {
    const exp = mockExplorer(kind === TopAbs_FACE ? faces : kind === TopAbs_EDGE ? edges : []);
    Object.assign(this, exp);
  } as any;

  return {
    TopAbs_ShapeEnum: { TopAbs_FACE: 4, TopAbs_EDGE: 6, TopAbs_SHAPE: 8 },
    TopExp_Explorer_2,
  };
}

/** Shape of a face that promotes to a Plane. */
function makePlaneFace(occtBase: any, x: number, y: number, z: number) {
  const planeSurface = {
    DynamicType: () => ({ get_type_name: () => 'Geom_Plane' }),
    Position: () => ({
      Location: () => mockPnt(x, y, z),
      Direction: () => ({ X: () => 0, Y: () => 0, Z: () => 1 }),
    }),
  };
  const surfaceHandle = { IsNull: () => false, get: () => planeSurface };
  const downCastFactory = { DownCast: (_h: any) => surfaceHandle };

  // Inject per-face surface dispatch shims into shared occt
  occtBase.BRep_Tool = occtBase.BRep_Tool ?? { Surface_2: (_face: any) => surfaceHandle };
  occtBase.BRepTools = occtBase.BRepTools ?? {
    UVBounds_1: (
      _face: any,
      u1: { current: number },
      u2: { current: number },
      v1: { current: number },
      v2: { current: number },
    ) => {
      u1.current = 0; u2.current = 1; v1.current = 0; v2.current = 1;
      return true;
    },
  };
  occtBase.Handle_Geom_Plane_2 = occtBase.Handle_Geom_Plane_2 ?? downCastFactory;

  // The face token itself is just an opaque marker — Surface_2 returns the same
  // surfaceHandle for any face (sufficient for index test). For independent
  // surface per face, replace Surface_2 to inspect the token.
  return { faceToken: 'plane', _surface: planeSurface };
}

/** Shape of an edge that promotes to a Line. */
function makeLineEdge(occtBase: any) {
  const lineCurve = {
    DynamicType: () => ({ get_type_name: () => 'Geom_Line' }),
    Position: () => ({
      Location: () => mockPnt(0, 0, 0),
      Direction: () => ({ X: () => 1, Y: () => 0, Z: () => 0 }),
    }),
  };
  const curveHandle = { IsNull: () => false, get: () => lineCurve };
  const downCastFactory = { DownCast: (_h: any) => curveHandle };

  occtBase.BRep_Tool = occtBase.BRep_Tool ?? {};
  occtBase.BRep_Tool.Curve_2 = occtBase.BRep_Tool.Curve_2 ?? ((
    _edge: any,
    f: { current: number },
    l: { current: number },
  ) => {
    f.current = 0; l.current = 1; return curveHandle;
  });
  occtBase.Handle_Geom_Line_2 = occtBase.Handle_Geom_Line_2 ?? downCastFactory;
  occtBase.Handle_Geom_TrimmedCurve_2 = occtBase.Handle_Geom_TrimmedCurve_2 ?? downCastFactory;

  return { edgeToken: 'line', _curve: lineCurve };
}

describe('ADR-081 W-δ — occtBrepTraversal', () => {
  it('null occt or shape → graceful warning, no faces/edges', () => {
    const r1 = traverseBrep(null, {});
    expect(r1.faces).toEqual([]);
    expect(r1.edges).toEqual([]);
    expect(r1.warnings.some(w => w.includes('null'))).toBe(true);

    const r2 = traverseBrep({}, null);
    expect(r2.faces).toEqual([]);
    expect(r2.edges).toEqual([]);
    expect(r2.warnings.some(w => w.includes('null'))).toBe(true);
  });

  it('empty shape (no faces, no edges) → 0/0/0 result', () => {
    const occt = mockOcctWithShape([], []);
    const r = traverseBrep(occt, {});
    expect(r.faces).toHaveLength(0);
    expect(r.edges).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('face count + stable index promotion (3 plane faces)', () => {
    const occt = mockOcctWithShape([], []);
    const f0 = makePlaneFace(occt, 0, 0, 0);
    const f1 = makePlaneFace(occt, 1, 0, 0);
    const f2 = makePlaneFace(occt, 2, 0, 0);
    // Re-bind explorer with the 3 face tokens
    Object.assign(occt, mockOcctWithShape([f0, f1, f2], []));
    // Re-attach the surface helpers (overwritten by reassign)
    makePlaneFace(occt, 0, 0, 0);

    const r = traverseBrep(occt, {});
    expect(r.faces).toHaveLength(3);
    expect(r.faces[0].index).toBe(0);
    expect(r.faces[1].index).toBe(1);
    expect(r.faces[2].index).toBe(2);
    // All 3 promote to Plane
    r.faces.forEach(pf => expect(pf.surface.kind).toBe('Plane'));
    expect(r.edges).toHaveLength(0);
  });

  it('edge count + stable index promotion (2 line edges)', () => {
    const occt = mockOcctWithShape([], []);
    const e0 = makeLineEdge(occt);
    const e1 = makeLineEdge(occt);
    Object.assign(occt, mockOcctWithShape([], [e0, e1]));
    makeLineEdge(occt);

    const r = traverseBrep(occt, {});
    expect(r.edges).toHaveLength(2);
    expect(r.edges[0].index).toBe(0);
    expect(r.edges[1].index).toBe(1);
    r.edges.forEach(pe => expect(pe.curve.kind).toBe('Line'));
    expect(r.faces).toHaveLength(0);
  });

  it('smoke: mixed face + edge → both populated independently', () => {
    const occt = mockOcctWithShape([], []);
    const f0 = makePlaneFace(occt, 0, 0, 0);
    const e0 = makeLineEdge(occt);
    Object.assign(occt, mockOcctWithShape([f0], [e0]));
    makePlaneFace(occt, 0, 0, 0);
    makeLineEdge(occt);

    const r = traverseBrep(occt, {});
    expect(r.faces).toHaveLength(1);
    expect(r.edges).toHaveLength(1);
    expect(r.faces[0].surface.kind).toBe('Plane');
    expect(r.edges[0].curve.kind).toBe('Line');
    expect(r.warnings).toHaveLength(0);
  });

  it('warnings collection — Tessellate fallback warnings prefixed with index', () => {
    // Provide a face whose DynamicType is unknown → identifySurfaceKind →
    // Unsupported → Tessellate + warning.
    const occt = mockOcctWithShape([], []);
    const unknownSurface = {
      DynamicType: () => ({ get_type_name: () => 'Geom_FutureType' }),
    };
    const surfaceHandle = { IsNull: () => false, get: () => unknownSurface };
    occt.BRep_Tool = { Surface_2: (_f: any) => surfaceHandle };
    occt.BRepTools = {
      UVBounds_1: (
        _f: any,
        u1: { current: number },
        u2: { current: number },
        v1: { current: number },
        v2: { current: number },
      ) => {
        u1.current = 0; u2.current = 1; v1.current = 0; v2.current = 1;
        return true;
      },
    };

    const facesArr = [{ token: 'unknown' }];
    Object.assign(occt, mockOcctWithShape(facesArr, []));
    occt.BRep_Tool = { Surface_2: (_f: any) => surfaceHandle };
    occt.BRepTools = {
      UVBounds_1: (
        _f: any,
        u1: { current: number },
        u2: { current: number },
        v1: { current: number },
        v2: { current: number },
      ) => {
        u1.current = 0; u2.current = 1; v1.current = 0; v2.current = 1;
        return true;
      },
    };

    const r = traverseBrep(occt, {});
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].surface.kind).toBe('Tessellate');
    expect(r.warnings.length).toBeGreaterThan(0);
    // Warnings are prefixed with 'face[N]:' for stable owner-ID mapping
    expect(r.warnings.some(w => w.startsWith('face[0]:'))).toBe(true);
  });

  it('TopExp_Explorer integer-fallback enum (no TopAbs_ShapeEnum field)', () => {
    // Older wrapper without TopAbs_ShapeEnum object — fallback to int literals.
    const TopExp_Explorer_2 = function (this: any, _shape: any, kind: number, _toAvoid: number) {
      // kind 4 (TopAbs_FACE) returns 1 face, kind 6 (TopAbs_EDGE) returns 0
      const items = kind === 4 ? [{ token: 'plane' }] : [];
      const exp = mockExplorer(items);
      Object.assign(this, exp);
    } as any;
    const occt: any = { TopExp_Explorer_2 };
    makePlaneFace(occt, 0, 0, 0);

    const r = traverseBrep(occt, {});
    expect(r.faces).toHaveLength(1);
    expect(r.edges).toHaveLength(0);
  });
});
