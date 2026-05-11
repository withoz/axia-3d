/**
 * Regression tests for occtBoundaryPolygon (ADR-086 O-δ).
 *
 * Mock-based unit tests covering:
 * 1. null occt/face → graceful warning
 * 2. happy path — single edge wire (4 nodes) → 4-vertex polygon
 * 3. multi-edge wire — 4 edges of square → 8 nodes (with shared dedup)
 * 4. closed loop — last vertex == first vertex → auto-pop
 * 5. edge orientation REVERSED → polyline 역순
 * 6. graceful failures — OuterWire null, WireExplorer ctor missing,
 *    Polygon3D null per edge
 */

import { describe, it, expect } from 'vitest';
import { extractFaceBoundary } from './occtBoundaryPolygon';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mockPnt(x: number, y: number, z: number) {
  return { X: () => x, Y: () => y, Z: () => z };
}

function mockPolyArrayPnt(pts: Array<[number, number, number]>) {
  return {
    Lower: () => 1,
    Upper: () => pts.length,
    Value: (i: number) => mockPnt(...pts[i - 1]),
  };
}

function mockPolygon3D(nodes: Array<[number, number, number]>) {
  return {
    NbNodes: () => nodes.length,
    Nodes: () => mockPolyArrayPnt(nodes),
  };
}

/**
 * Build a mock OCCT object whose:
 *   - BRepTools.OuterWire returns the mock wire
 *   - BRepTools_WireExplorer iterates given edges in order
 *   - BRep_Tool.Polygon3D returns the mocked polygon per edge
 *
 * Each edge: `{ poly, reversed? }`
 */
function mockOcctWithWire(edges: Array<{ poly: any; reversed?: boolean }>) {
  const wire = { kind: 'wire' };

  const BRepTools_WireExplorer_2 = function (this: any, _wire: any, _face: any) {
    let i = 0;
    Object.assign(this, {
      More: () => i < edges.length,
      Current: () => {
        const e = edges[i];
        // Wrap edge with Orientation method
        return {
          poly: e.poly,
          Orientation: () => (e.reversed ? 1 : 0),
        };
      },
      Next: () => { i++; },
    });
  } as any;

  return {
    BRepTools: {
      OuterWire: (_face: any) => wire,
    },
    BRepTools_WireExplorer_2,
    TopLoc_Location_1: function (this: any) { /* identity */ } as any,
    BRep_Tool: {
      Polygon3D: (edge: any) => {
        if (edge.poly === null) return { IsNull: () => true, get: () => null };
        return { IsNull: () => false, get: () => edge.poly };
      },
    },
  };
}

describe('ADR-086 O-δ — extractFaceBoundary', () => {
  it('null occt or face → graceful warning, empty result', () => {
    const r1 = extractFaceBoundary(null, {});
    expect(r1.positions.length).toBe(0);
    expect(r1.warnings.some((w) => w.includes('null'))).toBe(true);

    const r2 = extractFaceBoundary({}, null);
    expect(r2.positions.length).toBe(0);
    expect(r2.warnings.some((w) => w.includes('null'))).toBe(true);
  });

  it('happy path — single edge wire (4 nodes) → 4-vertex polygon', () => {
    const occt = mockOcctWithWire([
      { poly: mockPolygon3D([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]) },
    ]);
    const r = extractFaceBoundary(occt, {});
    expect(r.warnings.length).toBe(0);
    // 4 vertices × 3 = 12 floats
    expect(r.positions.length).toBe(12);
    expect(r.positions[0]).toBe(0);   // v0 X
    expect(r.positions[3]).toBe(10);  // v1 X
    expect(r.positions[6]).toBe(10);  // v2 X
    expect(r.positions[9]).toBe(0);   // v3 X
  });

  it('multi-edge wire — 4 edges of square → 4 vertices with dedup', () => {
    // 4 edges, each with 2 nodes (start/end vertices)
    // Edge endpoints share with neighboring edges (CW square: 5,5 → 15,5 → 15,15 → 5,15 → 5,5)
    const occt = mockOcctWithWire([
      { poly: mockPolygon3D([[5, 5, 0], [15, 5, 0]]) },     // bottom
      { poly: mockPolygon3D([[15, 5, 0], [15, 15, 0]]) },   // right
      { poly: mockPolygon3D([[15, 15, 0], [5, 15, 0]]) },   // top
      { poly: mockPolygon3D([[5, 15, 0], [5, 5, 0]]) },     // left (closes loop)
    ]);
    const r = extractFaceBoundary(occt, {});
    expect(r.warnings.length).toBe(0);
    // 8 unique vertices? Actually:
    // edge 0 → [v1, v2] (2 nodes)
    // edge 1 → [v2, v3] (shared v2 dedup → +1)
    // edge 2 → [v3, v4] (shared v3 dedup → +1)
    // edge 3 → [v4, v1] (shared v4 dedup → +1, closure dedup pops v1)
    // = 2 + 1 + 1 + 1 - 1 (closure) = 4 vertices
    expect(r.positions.length).toBe(12);  // 4 × 3
    expect(r.positions[0]).toBe(5);   // v0 X
    expect(r.positions[3]).toBe(15);  // v1 X
    expect(r.positions[6]).toBe(15);  // v2 X
    expect(r.positions[9]).toBe(5);   // v3 X
  });

  it('closed loop — last vertex == first → auto-pop closure', () => {
    // Single edge with closed polyline (last == first explicit)
    const occt = mockOcctWithWire([
      {
        poly: mockPolygon3D([
          [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0],  // closed
        ]),
      },
    ]);
    const r = extractFaceBoundary(occt, {});
    // 4 unique vertices (last == first → popped)
    expect(r.positions.length).toBe(12);
  });

  it('edge orientation REVERSED → polyline reversed', () => {
    // Single edge with REVERSED orientation
    const occt = mockOcctWithWire([
      {
        poly: mockPolygon3D([[0, 0, 0], [10, 0, 0], [10, 10, 0]]),
        reversed: true,
      },
    ]);
    const r = extractFaceBoundary(occt, {});
    expect(r.positions.length).toBe(9);  // 3 × 3
    // Reversed order: (10,10,0), (10,0,0), (0,0,0)
    expect(r.positions[0]).toBe(10);  // v0 X
    expect(r.positions[1]).toBe(10);  // v0 Y
    expect(r.positions[6]).toBe(0);   // v2 X (was first)
    expect(r.positions[7]).toBe(0);   // v2 Y
  });

  it('OuterWire null → graceful warning, empty result', () => {
    const occt = {
      BRepTools: { OuterWire: () => null },
    };
    const r = extractFaceBoundary(occt, {});
    expect(r.positions.length).toBe(0);
    expect(r.warnings.some((w) => w.includes('OuterWire'))).toBe(true);
  });

  it('per-edge Polygon3D null → warning + skip, others continue', () => {
    const occt = mockOcctWithWire([
      { poly: mockPolygon3D([[0, 0, 0], [10, 0, 0]]) },
      { poly: null },
      { poly: mockPolygon3D([[10, 0, 0], [10, 10, 0]]) },
      { poly: mockPolygon3D([[10, 10, 0], [0, 0, 0]]) },
    ]);
    const r = extractFaceBoundary(occt, {});
    // edge[1] skipped → 3 valid edges. Polygon: (0,0)→(10,0)→(10,10)→(0,0)
    // Last == first → closure pop → 3 vertices
    expect(r.positions.length).toBe(9);  // 3 × 3
    expect(r.warnings.some((w) => w.includes('edge[1]'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Polygon3D missing'))).toBe(true);
  });

  it('result polygon < 3 vertices → empty + warning', () => {
    // Only 2 nodes from a single short edge
    const occt = mockOcctWithWire([
      { poly: mockPolygon3D([[0, 0, 0], [1, 0, 0]]) },
    ]);
    const r = extractFaceBoundary(occt, {});
    // 2 vertices < 3 minimum
    expect(r.positions.length).toBe(0);
    expect(r.warnings.some((w) => w.includes('< 3 minimum'))).toBe(true);
  });
});
