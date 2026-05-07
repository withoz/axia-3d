/**
 * Regression tests for occtTessellate (ADR-083 T-β).
 *
 * Mock-based unit tests covering:
 * 1. tessellateShape happy path — single face → 1 FaceTessellation with
 *    positions / normals / indices buffers
 * 2. tessellateShape multi-face — 2 faces → stable index 0/1 + W-δ 답습
 * 3. graceful failure modes — null inputs / BRepMesh missing / Triangulation
 *    null per face
 *
 * Real-runtime 검증은 T-δ Playwright (browser env, BRepMesh + WASM 실 동작).
 */

import { describe, it, expect } from 'vitest';
import { tessellateShape } from './occtTessellate';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────
// Mock helpers — minimal OCCT API shape
// ────────────────────────────────────────────────────────────────────────

function mockPnt(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

function mockDir(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

function mockTriangle(v1: number, v2: number, v3: number) {
  return {
    Value: (i: number) => (i === 1 ? v1 : i === 2 ? v2 : v3),
  };
}

/**
 * Build a mock Poly_Triangulation with given nodes + triangles.
 * @param nodes - Array of [x, y, z]
 * @param triangles - Array of [v1, v2, v3] (1-based vertex indices)
 * @param normals - Optional vertex normals (HasNormals = true if provided)
 */
function mockTriangulation(
  nodes: Array<[number, number, number]>,
  triangles: Array<[number, number, number]>,
  normals?: Array<[number, number, number]>,
) {
  return {
    NbNodes: () => nodes.length,
    NbTriangles: () => triangles.length,
    Node: (i: number) => mockPnt(...nodes[i - 1]),
    Triangle: (i: number) => mockTriangle(...triangles[i - 1]),
    HasNormals: () => !!normals,
    Normal: (i: number) =>
      normals ? mockDir(...normals[i - 1]) : null,
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
 *   - BRepMesh_IncrementalMesh_2 ctor is no-op (mesh assumed pre-applied)
 *   - TopExp_Explorer iterates given faces (TopAbs_FACE)
 *   - TopLoc_Location_1 ctor is no-op
 *   - BRep_Tool.Triangulation returns the mocked triangulation per face
 *
 * Each face fixture: `{ tri }` where `tri` is a mocked Poly_Triangulation
 * (or null to simulate Triangulation null).
 */
function mockOcctWithFaces(
  faces: Array<{ tri: any | null }>,
) {
  const TopAbs_FACE = 4;
  const TopAbs_SHAPE = 8;

  const TopExp_Explorer_2 = function (this: any, _shape: any, kind: number, _toAvoid: number) {
    const items = kind === TopAbs_FACE ? faces : [];
    Object.assign(this, mockIter(items));
  } as any;

  const TopLoc_Location_1 = function (this: any) { /* identity */ } as any;

  const BRepMesh_IncrementalMesh_2 = function (this: any) { /* in-place no-op */ } as any;

  return {
    TopAbs_ShapeEnum: { TopAbs_FACE, TopAbs_SHAPE },
    TopExp_Explorer_2,
    TopLoc_Location_1,
    BRepMesh_IncrementalMesh_2,
    BRep_Tool: {
      Triangulation: (face: any, _location: any) => {
        if (face.tri === null) {
          return { IsNull: () => true, get: () => null };
        }
        return { IsNull: () => false, get: () => face.tri };
      },
      // promoteSurface 가 사용 — empty (face 의 surface dispatch 실패 → tessellation 만 보존)
      Surface_2: (_face: any) => ({ IsNull: () => true, get: () => null }),
    },
    BRepTools: {
      // promoteSurface 의 uvBounds 호출 silent (no-op)
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
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('ADR-083 T-β — occtTessellate', () => {
  it('null occt or shape → graceful warning, empty faces', () => {
    const r1 = tessellateShape(null, {});
    expect(r1.faces).toEqual([]);
    expect(r1.warnings.some(w => w.includes('null'))).toBe(true);

    const r2 = tessellateShape({}, null);
    expect(r2.faces).toEqual([]);
    expect(r2.warnings.some(w => w.includes('null'))).toBe(true);
  });

  it('happy path — single face → 1 FaceTessellation with buffers (W-δ stable index 0)', () => {
    // Single triangular face — 3 vertices, 1 triangle
    const tri = mockTriangulation(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 2, 3]],  // 1-based → expected output 0/1/2
    );
    const occt = mockOcctWithFaces([{ tri }]);

    const r = tessellateShape(occt, {} /* shape */);
    expect(r.faces).toHaveLength(1);
    const face = r.faces[0];

    // Stable index (W-δ 답습)
    expect(face.index).toBe(0);

    // Positions (3 vertices × 3 floats = 9)
    expect(face.positions.length).toBe(9);
    expect(face.positions[0]).toBe(0); // v1 X
    expect(face.positions[3]).toBe(1); // v2 X
    expect(face.positions[6]).toBe(0); // v3 X
    expect(face.positions[7]).toBe(1); // v3 Y

    // Indices (1 triangle × 3 = 3, OCCT 1-based → 0-based)
    expect(face.indices.length).toBe(3);
    expect(face.indices[0]).toBe(0);
    expect(face.indices[1]).toBe(1);
    expect(face.indices[2]).toBe(2);

    // Normals (no HasNormals → zero-filled)
    expect(face.normals.length).toBe(9);
    expect(face.normals[0]).toBe(0);
  });

  it('happy path — face with HasNormals=true → normals populated', () => {
    const tri = mockTriangulation(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 2, 3]],
      [[0, 0, 1], [0, 0, 1], [0, 0, 1]],  // up-normal
    );
    const occt = mockOcctWithFaces([{ tri }]);

    const r = tessellateShape(occt, {});
    expect(r.faces).toHaveLength(1);
    const face = r.faces[0];

    // Normals populated (3 × 3 = 9 floats, all (0,0,1))
    expect(face.normals.length).toBe(9);
    for (let i = 0; i < 3; i++) {
      expect(face.normals[i * 3 + 2]).toBe(1);  // Z=1
    }
  });

  it('multi-face — 2 faces → stable indices 0/1 (W-δ 답습)', () => {
    const tri1 = mockTriangulation(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 2, 3]],
    );
    const tri2 = mockTriangulation(
      [[0, 0, 1], [1, 0, 1], [0, 1, 1]],
      [[1, 2, 3]],
    );
    const occt = mockOcctWithFaces([{ tri: tri1 }, { tri: tri2 }]);

    const r = tessellateShape(occt, {});
    expect(r.faces).toHaveLength(2);
    expect(r.faces[0].index).toBe(0);
    expect(r.faces[1].index).toBe(1);

    // Face 1 at z=0, face 2 at z=1
    expect(r.faces[0].positions[2]).toBe(0);  // first vertex Z
    expect(r.faces[1].positions[2]).toBe(1);
  });

  it('per-face Triangulation null → face-level warning, others continue (P21.7)', () => {
    const tri1 = mockTriangulation(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 2, 3]],
    );
    // face 2 has null triangulation
    const occt = mockOcctWithFaces([{ tri: tri1 }, { tri: null }]);

    const r = tessellateShape(occt, {});
    // Only face[0] tessellated
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].index).toBe(0);
    // face[1] warning prefixed (W-δ 답습)
    expect(r.warnings.some(w => w.startsWith('face[1]'))).toBe(true);
  });

  it('BRepMesh ctor missing → global warning, no faces', () => {
    const occt: any = {
      // BRepMesh_IncrementalMesh_2 missing
      TopAbs_ShapeEnum: { TopAbs_FACE: 4, TopAbs_SHAPE: 8 },
    };
    const r = tessellateShape(occt, {});
    expect(r.faces).toEqual([]);
    expect(r.warnings.some(w => w.includes('BRepMesh'))).toBe(true);
  });

  it('TessellateOptions overrides apply (lineDeflection / angleDeflection custom)', () => {
    // Custom options — lineDeflection 0.5 (coarser), angleDeflection 0.1 (finer)
    let capturedLineDef = 0;
    let capturedAngleDef = 0;
    const tri = mockTriangulation(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 2, 3]],
    );
    const occt: any = {
      TopAbs_ShapeEnum: { TopAbs_FACE: 4, TopAbs_SHAPE: 8 },
      TopExp_Explorer_2: function (this: any) {
        Object.assign(this, mockIter([{ tri }]));
      },
      TopLoc_Location_1: function (this: any) { /* identity */ },
      BRepMesh_IncrementalMesh_2: function (
        this: any,
        _shape: any,
        lineDef: number,
        _isRelative: boolean,
        angleDef: number,
        _isInParallel: boolean,
      ) {
        capturedLineDef = lineDef;
        capturedAngleDef = angleDef;
      },
      BRep_Tool: {
        Triangulation: () => ({ IsNull: () => false, get: () => tri }),
        Surface_2: () => ({ IsNull: () => true, get: () => null }),
      },
      BRepTools: {
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
      },
    };

    const r = tessellateShape(occt, {}, { lineDeflection: 0.5, angleDeflection: 0.1 });
    expect(r.faces).toHaveLength(1);
    expect(capturedLineDef).toBe(0.5);
    expect(capturedAngleDef).toBe(0.1);
  });

  it('default options match ADR-083 L1 (lineDeflection 0.1mm, angleDeflection 0.5 rad)', () => {
    let capturedLineDef = 0;
    let capturedAngleDef = 0;
    const tri = mockTriangulation([[0, 0, 0]], []);
    const occt: any = {
      TopAbs_ShapeEnum: { TopAbs_FACE: 4, TopAbs_SHAPE: 8 },
      TopExp_Explorer_2: function (this: any) {
        Object.assign(this, mockIter([]));
      },
      TopLoc_Location_1: function (this: any) { /* identity */ },
      BRepMesh_IncrementalMesh_2: function (
        this: any,
        _shape: any,
        lineDef: number,
        _isRelative: boolean,
        angleDef: number,
      ) {
        capturedLineDef = lineDef;
        capturedAngleDef = angleDef;
      },
      BRep_Tool: { Triangulation: () => ({ IsNull: () => true }) },
    };
    void tri;

    tessellateShape(occt, {});
    expect(capturedLineDef).toBe(0.1);
    expect(capturedAngleDef).toBe(0.5);
  });
});
