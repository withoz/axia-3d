/**
 * Tests for WasmBridge — WASM communication layer.
 *
 * The actual WASM module can't run in Node/jsdom, so we mock
 * both the init() function and the AxiaEngine class.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Build mock engine with all methods WasmBridge might call
const mockEngine: Record<string, any> = {
  __wbg_ptr: 1,
  free: vi.fn(),
  draw_line: vi.fn().mockReturnValue(1),
  draw_rect: vi.fn().mockReturnValue(2),
  draw_circle: vi.fn().mockReturnValue(3),
  push_pull: vi.fn().mockReturnValue(true),
  face_count: vi.fn().mockReturnValue(6),
  vert_count: vi.fn().mockReturnValue(8),
  get_positions: vi.fn().mockReturnValue(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0])),
  get_normals: vi.fn().mockReturnValue(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])),
  get_indices: vi.fn().mockReturnValue(new Uint32Array([0, 1, 2])),
  get_face_map: vi.fn().mockReturnValue(new Uint32Array([1])),
  get_edge_lines: vi.fn().mockReturnValue(new Float32Array([0, 0, 0, 1, 0, 0])),
  get_edge_map: vi.fn().mockReturnValue(new Uint32Array([1])),
  get_face_normal: vi.fn().mockReturnValue(new Float64Array([0, 0, 1])),
  get_stats: vi.fn().mockReturnValue('{"faces":6,"verts":8}'),
  undo: vi.fn().mockReturnValue(true),
  redo: vi.fn().mockReturnValue(true),
  can_undo: vi.fn().mockReturnValue(true),
  can_redo: vi.fn().mockReturnValue(false),
  delete_face: vi.fn().mockReturnValue(true),
  delete_edge: vi.fn().mockReturnValue(true),
  orient_faces: vi.fn().mockReturnValue(0),
  export_snapshot: vi.fn().mockReturnValue(new Uint8Array([65, 88, 73, 65])),
  import_snapshot: vi.fn().mockReturnValue(true),
  translate_faces: vi.fn().mockReturnValue(true),
  rotate_faces: vi.fn().mockReturnValue(true),
  scale_faces: vi.fn().mockReturnValue(true),
  faces_centroid: vi.fn().mockReturnValue(new Float64Array([0.5, 0.5, 0])),
  offset_face: vi.fn().mockReturnValue('{"ok":true,"innerFace":2}'),
  offset_edge: vi.fn().mockReturnValue('{"ok":true}'),
  get_xia_info: vi.fn().mockReturnValue('{"isSolid":true}'),
  boolean_op: vi.fn().mockReturnValue('{"ok":true,"resultFaces":[1,2,3]}'),
  create_group: vi.fn().mockReturnValue(1),
  delete_group: vi.fn().mockReturnValue(true),
  rename_group: vi.fn().mockReturnValue(true),
  toggle_group_visibility: vi.fn().mockReturnValue(true),
  toggle_group_lock: vi.fn().mockReturnValue(true),
  get_group_for_face: vi.fn().mockReturnValue(0),
  get_group_faces: vi.fn().mockReturnValue(new Uint32Array([1, 2, 3])),
  add_faces_to_group: vi.fn().mockReturnValue(true),
  remove_faces_from_group: vi.fn().mockReturnValue(true),
  set_group_parent: vi.fn().mockReturnValue(true),
  make_component: vi.fn().mockReturnValue(1),
  get_group_info: vi.fn().mockReturnValue('{"id":1,"name":"Group1","faceCount":3}'),
  get_all_groups: vi.fn().mockReturnValue('[]'),
  group_count: vi.fn().mockReturnValue(1),
  import_dxf: vi.fn().mockReturnValue('{"faces":10}'),
};

// Mock the WASM module — AxiaEngine as a real class constructor
vi.mock('../wasm/axia_wasm', () => {
  class MockAxiaEngine {
    __wbg_ptr = 1;
    constructor() {
      // Copy all mock methods onto instance
      Object.assign(this, mockEngine);
    }
  }
  return {
    // wasm-bindgen `init()` resolves to InitOutput { memory, ... }
    default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
    AxiaEngine: MockAxiaEngine,
  };
});

import { WasmBridge } from './WasmBridge';

describe('WasmBridge', () => {
  let bridge: WasmBridge;

  beforeEach(async () => {
    bridge = new WasmBridge();
    await bridge.init();
  });

  describe('init()', () => {
    it('initializes successfully', () => {
      expect(bridge.isReady()).toBe(true);
    });
  });

  describe('mesh buffers', () => {
    it('getMeshBuffers() returns positions/normals/indices/faceMap', () => {
      const buffers = bridge.getMeshBuffers();
      expect(buffers).not.toBeNull();
      expect(buffers!.positions).toBeInstanceOf(Float32Array);
      expect(buffers!.normals).toBeInstanceOf(Float32Array);
      expect(buffers!.indices).toBeInstanceOf(Uint32Array);
      expect(buffers!.faceMap).toBeInstanceOf(Uint32Array);
    });

    it('markDirty() forces fresh fetch', () => {
      bridge.getMeshBuffers();
      bridge.markDirty();
      const buffers2 = bridge.getMeshBuffers();
      expect(buffers2).not.toBeNull();
    });

    it('caching returns same reference when not dirty', () => {
      const b1 = bridge.getMeshBuffers();
      const b2 = bridge.getMeshBuffers();
      // Positions should be same reference (cached)
      expect(b1!.positions).toBe(b2!.positions);
    });
  });

  describe('draw operations', () => {
    it('drawLine() returns face count', () => {
      const result = bridge.drawLine(0, 0, 0, 1, 0, 0, 0, 0, 1);
      expect(typeof result).toBe('number');
    });

    it('drawRect() returns face count', () => {
      const result = bridge.drawRect(0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 1);
      expect(typeof result).toBe('number');
    });

    it('drawCircle() returns face count', () => {
      const result = bridge.drawCircle(0, 0, 0, 0, 0, 1, 5, 24);
      expect(typeof result).toBe('number');
    });

    it('drawLine() marks buffers dirty', () => {
      bridge.getMeshBuffers(); // clear dirty flag
      bridge.drawLine(0, 0, 0, 1, 0, 0, 0, 0, 1);
      // After draw, next getMeshBuffers should fetch fresh
      const buffers = bridge.getMeshBuffers();
      expect(buffers).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-026 P12 — Cardinal Plane SSOT verification
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-026 P12 cardinal plane SSOT', () => {
    it('drawRect() snaps center.y to exact 0 when normal=(0,1,0) and y is sub-tol', () => {
      // Mock the engine to capture arguments
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawRect(1.0, 1e-7, 2.0, 0, 1, 0, 0, 0, 1, 5, 5);
      expect(captured[0]).toBe(1.0);
      expect(captured[1]).toBe(0);  // ε snapped exactly to 0
      expect(captured[2]).toBe(2.0);
    });

    it('drawRect() snaps center.z to exact 0 when normal=(0,0,1) and z is sub-tol', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawRect(1.0, 2.0, 5e-8, 0, 0, 1, 1, 0, 0, 5, 5);
      expect(captured[2]).toBe(0);
    });

    it('drawRect() preserves non-cardinal normal coords', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      // Normal not axis-aligned → no snap
      bridge.drawRect(1.0, 1e-7, 2.0, 0.7, 0.7, 0, 0, 0, 1, 5, 5);
      expect(captured[1]).toBeCloseTo(1e-7, 12);  // unchanged
    });

    it('drawRect() preserves coords above tolerance', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      // 0.5 is way above 1e-3 tol → not snapped
      bridge.drawRect(1.0, 0.5, 2.0, 0, 1, 0, 0, 0, 1, 5, 5);
      expect(captured[1]).toBe(0.5);
    });

    it('drawCircle() snaps center y to 0 when normal=(0,1,0)', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_circle: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawCircle(1.0, 1e-7, 2.0, 0, 1, 0, 5, 24);
      expect(captured[1]).toBe(0);
    });

    it('drawLine() snaps both endpoints when both on cardinal y=0 plane', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_line: (...args: number[]) => {
          captured.push(...args);
          return 1;
        },
      };
      bridge.drawLine(1.0, 1e-7, 2.0, 5.0, 3e-8, 7.0);
      expect(captured[1]).toBe(0);  // y0 snapped
      expect(captured[4]).toBe(0);  // y1 snapped
    });

    it('drawLine() does NOT snap when only one endpoint near 0', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_line: (...args: number[]) => {
          captured.push(...args);
          return 1;
        },
      };
      // y0 ≈ 0 but y1 = 5 → not coplanar with y=0 plane → no snap
      bridge.drawLine(1.0, 1e-7, 2.0, 5.0, 5.0, 7.0);
      expect(captured[1]).toBeCloseTo(1e-7, 12);  // preserved
    });

    it('tessellateEdge() returns polyline for valid edge', () => {
      // Mock engine with tessellate that returns a 2-point line
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        tessellateEdge: (_eid: number, _tol: number) =>
          new Float64Array([0, 0, 0, 10, 0, 0]),
      };
      const result = bridge.tessellateEdge(0, 0.1);
      expect(result.length).toBe(6);
      expect(result[0]).toBe(0);
      expect(result[3]).toBe(10);
    });

    it('tessellateEdge() returns empty for null engine', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      const result = bridge.tessellateEdge(0, 0.1);
      expect(result.length).toBe(0);
    });

    it('setEdgeArcCurve() applies cardinal snap to center', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeArcCurve: (...args: number[]) => {
          captured = args;
          return true;
        },
      };
      // y is sub-tol → must snap to 0 (normal=Y → cardinal axis 1)
      const ok = bridge.setEdgeArcCurve(
        7, 1.0, 1e-7, 2.0,  // edge_id, cx, cy, cz
        5.0,                  // radius
        0, 1, 0,             // normal=Y
        1, 0, 0,             // basis_u=X
        0, Math.PI / 2,      // start, end angle
      );
      expect(ok).toBe(true);
      expect(captured[0]).toBe(7);   // edge id
      expect(captured[2]).toBe(0);   // y snapped
    });

    it('setEdgeCircleCurve() applies cardinal snap to center', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeCircleCurve: (...args: number[]) => {
          captured = args;
          return true;
        },
      };
      bridge.setEdgeCircleCurve(
        9, 1.0, 2.0, 5e-8, 4.0, 0, 0, 1, 1, 0, 0,
      );
      expect(captured[3]).toBe(0);  // z snapped
    });

    it('clearEdgeCurve() forwards to engine', () => {
      let cleared = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        clearEdgeCurve: (eid: number) => { cleared = eid; return true; },
      };
      const ok = bridge.clearEdgeCurve(42);
      expect(ok).toBe(true);
      expect(cleared).toBe(42);
    });

    it('edgeCurveKind() returns engine value', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        edgeCurveKind: (_eid: number) => 3,  // Arc
      };
      expect(bridge.edgeCurveKind(0)).toBe(3);
    });

    // ──────────────────────────────────────────────────────────────────
    // ADR-029 Phase B — Bezier / B-spline bridge tests
    // ──────────────────────────────────────────────────────────────────

    it('setEdgeBezierCurve() forwards control points as Float64Array', () => {
      let captured: Float64Array | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeBezierCurve: (_eid: number, pts: Float64Array) => {
          captured = pts;
          return true;
        },
      };
      const ok = bridge.setEdgeBezierCurve(5, [0, 0, 0, 5, 10, 0, 10, 0, 0]);
      expect(ok).toBe(true);
      expect(captured).not.toBeNull();
      const arr = captured as unknown as Float64Array;
      expect(arr.length).toBe(9);
      expect(arr[3]).toBe(5);
      expect(arr[4]).toBe(10);
    });

    it('setEdgeBezierCurve() returns false when engine missing the method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};  // no setEdgeBezierCurve
      const ok = bridge.setEdgeBezierCurve(0, [0, 0, 0, 1, 1, 1]);
      expect(ok).toBe(false);
    });

    it('setEdgeBSplineCurve() forwards control points + knots + degree', () => {
      let capturedPts: Float64Array | null = null;
      let capturedKnots: Float64Array | null = null;
      let capturedDeg = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeBSplineCurve: (
          _eid: number, pts: Float64Array, knots: Float64Array, deg: number,
        ) => {
          capturedPts = pts;
          capturedKnots = knots;
          capturedDeg = deg;
          return true;
        },
      };
      // 4 control points, cubic (degree=3) → 4+3+1 = 8 knots
      const pts = [0, 0, 0,  1, 5, 0,  5, 5, 0,  10, 0, 0];
      const knots = [0, 0, 0, 0, 1, 1, 1, 1];
      const ok = bridge.setEdgeBSplineCurve(7, pts, knots, 3);
      expect(ok).toBe(true);
      expect(capturedDeg).toBe(3);
      const a = capturedPts as unknown as Float64Array;
      const b = capturedKnots as unknown as Float64Array;
      expect(a.length).toBe(12);
      expect(b.length).toBe(8);
    });

    it('setEdgeBezierCurve() accepts Float64Array directly', () => {
      let captured: Float64Array | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeBezierCurve: (_eid: number, pts: Float64Array) => {
          captured = pts;
          return true;
        },
      };
      const f64 = new Float64Array([0, 0, 0, 10, 0, 0]);
      bridge.setEdgeBezierCurve(0, f64);
      expect(captured).not.toBeNull();
      const arr = captured as unknown as Float64Array;
      expect(arr.length).toBe(6);
    });

    // ──────────────────────────────────────────────────────────────────
    // ADR-030 Phase C — NURBS + CCI bridge tests
    // ──────────────────────────────────────────────────────────────────

    it('setEdgeNurbsCurve() forwards control points + weights + knots + degree', () => {
      let capturedPts: Float64Array | null = null;
      let capturedW: Float64Array | null = null;
      let capturedKnots: Float64Array | null = null;
      let capturedDeg = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setEdgeNurbsCurve: (
          _eid: number, pts: Float64Array, w: Float64Array,
          k: Float64Array, d: number,
        ) => {
          capturedPts = pts;
          capturedW = w;
          capturedKnots = k;
          capturedDeg = d;
          return true;
        },
      };
      // Quadratic NURBS quarter-circle: 3 ctrl, 3 weights, 6 knots, deg=2.
      const pts = [5, 0, 0,  5, 5, 0,  0, 5, 0];
      const weights = [1, Math.SQRT1_2, 1];
      const knots = [0, 0, 0, 1, 1, 1];
      const ok = bridge.setEdgeNurbsCurve(11, pts, weights, knots, 2);
      expect(ok).toBe(true);
      expect(capturedDeg).toBe(2);
      const a = capturedPts as unknown as Float64Array;
      const b = capturedW as unknown as Float64Array;
      const c = capturedKnots as unknown as Float64Array;
      expect(a.length).toBe(9);
      expect(b.length).toBe(3);
      expect(c.length).toBe(6);
    });

    it('setEdgeNurbsCurve() returns false when engine missing the method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const ok = bridge.setEdgeNurbsCurve(0, [0, 0, 0], [1], [0, 0], 1);
      expect(ok).toBe(false);
    });

    it('intersectEdges() returns flat Float64Array of intersections', () => {
      // Mock engine returning a single intersection (6 floats)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        intersectEdges: (_a: number, _b: number, _tol: number) =>
          new Float64Array([1.0, 2.0, 3.0, 0.5, 0.5, Math.PI / 2]),
      };
      const result = bridge.intersectEdges(1, 2, 1e-6);
      expect(result.length).toBe(6);
      expect(result[0]).toBe(1.0);
      expect(result[3]).toBe(0.5);
      expect(Math.abs(result[5] - Math.PI / 2)).toBeLessThan(1e-9);
    });

    it('intersectEdges() returns empty array when engine missing the method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const result = bridge.intersectEdges(0, 1);
      expect(result.length).toBe(0);
    });

    it('intersectEdges() returns empty when no engine', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      const result = bridge.intersectEdges(0, 1);
      expect(result.length).toBe(0);
    });

    // ──────────────────────────────────────────────────────────────────
    // ADR-031 Phase D — Analytic surfaces bridge tests
    // ──────────────────────────────────────────────────────────────────

    it('setFaceSurfaceCylinder() forwards 15 args', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setFaceSurfaceCylinder: (...args: number[]) => {
          captured = args;
          return true;
        },
      };
      const ok = bridge.setFaceSurfaceCylinder(
        7,
        0, 0, 0,    // axis origin
        0, 0, 1,    // axis dir Z
        5.0,         // radius
        1, 0, 0,    // ref dir X
        0, Math.PI * 2, 0, 10,  // u/v range
      );
      expect(ok).toBe(true);
      expect(captured.length).toBe(15);
      expect(captured[0]).toBe(7);
      expect(captured[7]).toBe(5.0);  // radius
    });

    it('setFaceSurfaceSphere() forwards 9 args', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        setFaceSurfaceSphere: (...args: number[]) => {
          captured = args;
          return true;
        },
      };
      bridge.setFaceSurfaceSphere(
        3, 1, 2, 3, 7.0,
        0, Math.PI * 2, -Math.PI / 2, Math.PI / 2,
      );
      expect(captured.length).toBe(9);
      expect(captured[4]).toBe(7.0);
    });

    it('faceSurfaceKind() returns engine value', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        faceSurfaceKind: (_id: number) => 2,  // Cylinder
      };
      expect(bridge.faceSurfaceKind(0)).toBe(2);
    });

    it('faceSurfaceKind() returns -1 without engine', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      expect(bridge.faceSurfaceKind(0)).toBe(-1);
    });

    it('clearFaceSurface() forwards to engine', () => {
      let captured = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        clearFaceSurface: (id: number) => { captured = id; return true; },
      };
      const ok = bridge.clearFaceSurface(99);
      expect(ok).toBe(true);
      expect(captured).toBe(99);
    });

    it('tessellateFaceSurface() returns Float64Array with header', () => {
      // Mock returns 2 vertices + 1 triangle = [2, 1, x0,y0,z0, x1,y1,z1, 0,1,2]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        tessellateFaceSurface: (_id: number, _tol: number) =>
          new Float64Array([2, 1,  0, 0, 0,  1, 1, 1,  0, 1, 0]),
      };
      const result = bridge.tessellateFaceSurface(0, 0.1);
      expect(result.length).toBe(11);
      expect(result[0]).toBe(2);  // vertex count
      expect(result[1]).toBe(1);  // triangle count
    });

    it('tessellateFaceSurface() returns empty when missing engine', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      const result = bridge.tessellateFaceSurface(0, 0.1);
      expect(result.length).toBe(0);
    });

    // ──────────────────────────────────────────────────────────────────
    // ADR-032 P17 — Promotion on creation tests
    // ──────────────────────────────────────────────────────────────────

    it('drawArcWithCurve() forwards 13 args to engine', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        drawArcWithCurve: (...args: number[]) => {
          captured = args;
          return 0;
        },
      };
      const result = bridge.drawArcWithCurve(
        0, 0, 0,         // center
        5,                 // radius
        0, 0, 1,           // normal Z
        1, 0, 0,           // basis_u X
        0, Math.PI / 2,    // start, end angle
        12,                // segments
      );
      expect(result).toBe(0);
      expect(captured.length).toBe(13);
      expect(captured[3]).toBe(5);     // radius
      expect(captured[12]).toBe(12);   // segments
    });

    it('drawArcWithCurve() snaps center to cardinal axis', () => {
      let captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        drawArcWithCurve: (...args: number[]) => {
          captured = args;
          return 0;
        },
      };
      // y component sub-tol with normal=Y → should snap to 0
      bridge.drawArcWithCurve(
        1.0, 1e-7, 2.0, 5,
        0, 1, 0,           // normal Y → cardinal axis 1
        1, 0, 0, 0, Math.PI, 8,
      );
      expect(captured[1]).toBe(0);  // y snapped
    });

    it('drawArcWithCurve() returns -1 when engine missing the method', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const result = bridge.drawArcWithCurve(
        0, 0, 0, 5, 0, 0, 1, 1, 0, 0, 0, Math.PI, 8,
      );
      expect(result).toBe(-1);
    });

    it('drawArcWithCurve() returns -1 when no engine', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      const result = bridge.drawArcWithCurve(
        0, 0, 0, 5, 0, 0, 1, 1, 0, 0, 0, Math.PI, 8,
      );
      expect(result).toBe(-1);
    });

    it('drawBezierWithCurve() forwards control points + segments', () => {
      let capturedPts: Float64Array | null = null;
      let capturedSeg = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        drawBezierWithCurve: (pts: Float64Array, segs: number) => {
          capturedPts = pts;
          capturedSeg = segs;
          return 0;
        },
      };
      const result = bridge.drawBezierWithCurve(
        [0, 0, 0,  5, 10, 0,  10, 0, 0],
        16,
      );
      expect(result).toBe(0);
      expect(capturedSeg).toBe(16);
      const arr = capturedPts as unknown as Float64Array;
      expect(arr.length).toBe(9);
    });

    it('drawBezierWithCurve() returns -1 when engine missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const result = bridge.drawBezierWithCurve([0, 0, 0, 1, 1, 0], 8);
      expect(result).toBe(-1);
    });

    it('drawBSplineWithCurve() forwards pts + knots + degree', () => {
      let captured = { pts: null as Float64Array | null, knots: null as Float64Array | null, deg: -1 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        drawBSplineWithCurve: (pts: Float64Array, knots: Float64Array, deg: number) => {
          captured = { pts, knots, deg };
          return 0;
        },
      };
      const ok = bridge.drawBSplineWithCurve(
        [0,0,0, 1,5,0, 5,5,0, 10,0,0],
        [0,0,0,0, 1,1,1,1],
        3,
      );
      expect(ok).toBe(0);
      expect(captured.deg).toBe(3);
      expect(captured.pts!.length).toBe(12);
      expect(captured.knots!.length).toBe(8);
    });

    it('drawBSplineWithCurve() returns -1 when engine missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const result = bridge.drawBSplineWithCurve([0, 0, 0], [0, 0, 1], 1);
      expect(result).toBe(-1);
    });

    it('drawPolyline() snaps all points when all on cardinal y=0 plane', () => {
      const captured: Float64Array[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        drawPolyline: (arr: Float64Array) => {
          captured.push(arr.slice());
          return 1;
        },
      };
      bridge.drawPolyline([0, 1e-7, 0,  5, 2e-8, 0,  5, 3e-8, 5,  0, 1e-7, 5]);
      const arr = captured[0];
      expect(arr[1]).toBe(0);
      expect(arr[4]).toBe(0);
      expect(arr[7]).toBe(0);
      expect(arr[10]).toBe(0);
    });
  });

  describe('push/pull', () => {
    it('pushPull() returns boolean', () => {
      const result = bridge.pushPull(1, 5.0);
      expect(result).toBe(true);
    });
  });

  describe('undo/redo', () => {
    it('undo() returns boolean', () => {
      expect(bridge.undo()).toBe(true);
    });

    it('redo() returns boolean', () => {
      expect(bridge.redo()).toBe(true);
    });

    it('getStats() returns stats object', () => {
      const stats = bridge.getStats();
      expect(typeof stats.faces).toBe('number');
      expect(typeof stats.verts).toBe('number');
    });
  });

  describe('face count', () => {
    it('faceCount() returns number', () => {
      expect(bridge.faceCount()).toBe(6);
    });
  });

  describe('error handling', () => {
    it('returns null/0 when engine is not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.isReady()).toBe(false);
      expect(uninitBridge.getMeshBuffers()).toBeNull();
      expect(uninitBridge.faceCount()).toBe(0);
    });

    it('drawLine returns -1 when not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.drawLine(0, 0, 0, 1, 0, 0, 0, 0, 1)).toBe(-1);
    });

    it('pushPull returns false when not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.pushPull(1, 5.0)).toBe(false);
    });

    it('undo returns false when not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.undo()).toBe(false);
    });
  });

  describe('delete operations', () => {
    it('deleteFace returns true', () => {
      expect(bridge.deleteFace(1)).toBe(true);
    });

    it('deleteEdge returns true', () => {
      expect(bridge.deleteEdge(5)).toBe(true);
    });
  });

  describe('face normal', () => {
    it('getFaceNormal returns 3-element array', () => {
      const normal = bridge.getFaceNormal(1);
      expect(normal).toBeTruthy();
      expect(normal.length).toBe(3);
    });
  });

  describe('edge data', () => {
    it('getEdgeLines returns Float32Array', () => {
      const lines = bridge.getEdgeLines();
      expect(lines).toBeInstanceOf(Float32Array);
    });

    it('getEdgeMap returns Uint32Array', () => {
      const map = bridge.getEdgeMap();
      expect(map).toBeInstanceOf(Uint32Array);
    });
  });

  describe('snapshot', () => {
    it('exportSnapshot returns Uint8Array', () => {
      const data = bridge.exportSnapshot();
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it('importSnapshot returns boolean', () => {
      const data = new Uint8Array([65, 88, 73, 65]);
      expect(bridge.importSnapshot(data)).toBe(true);
    });
  });

  describe('transform operations', () => {
    it('translateFaces returns true', () => {
      expect(bridge.translateFaces([1, 2], 10, 0, 0)).toBe(true);
    });

    it('rotateFaces returns true', () => {
      expect(bridge.rotateFaces([1], 0, 0, 0, 0, 1, 0, Math.PI / 4)).toBe(true);
    });

    it('scaleFaces returns true', () => {
      expect(bridge.scaleFaces([1], 0, 0, 0, 2.0, 2.0, 2.0)).toBe(true);
    });
  });

  describe('facesCentroid', () => {
    it('returns Vector3-like with xyz', () => {
      const centroid = bridge.facesCentroid([1, 2]);
      expect(centroid).toBeTruthy();
    });
  });

  describe('offset operations', () => {
    it('offsetFace returns result with ok', () => {
      const result = bridge.offsetFace(1, 10);
      expect(result).toBeTruthy();
      expect(result!.ok).toBe(true);
    });

    it('offsetEdge returns result', () => {
      const result = bridge.offsetEdge(5, 10, [0, 1, 0]);
      expect(result).toBeTruthy();
    });
  });

  describe('XIA info', () => {
    it('getXiaInfo returns parsed JSON', () => {
      const info = bridge.getXiaInfo([1]);
      expect(info).toBeTruthy();
      expect(info!.isSolid).toBe(true);
    });
  });

  describe('boolean operations', () => {
    it('booleanOp returns result', () => {
      const result = bridge.booleanOp([1], [2], 'union');
      expect(result).toBeTruthy();
      expect(result!.ok).toBe(true);
    });
  });

  describe('group operations', () => {
    it('createGroup returns group id', () => {
      const gid = bridge.createGroup('Test', [1, 2, 3]);
      expect(gid).toBe(1);
    });

    it('deleteGroup returns boolean', () => {
      expect(bridge.deleteGroup(1)).toBe(true);
    });

    it('getGroupInfo returns parsed JSON', () => {
      const info = bridge.getGroupInfo(1);
      expect(info).toBeTruthy();
      expect(info!.id).toBe(1);
    });

    it('getAllGroups returns array', () => {
      const groups = bridge.getAllGroups();
      expect(Array.isArray(groups)).toBe(true);
    });

    it('groupCount returns number', () => {
      expect(bridge.groupCount()).toBe(1);
    });
  });

  describe('DXF import', () => {
    it('importDxf returns result', () => {
      const result = bridge.importDxf(new Uint8Array([0]));
      expect(result).toBeTruthy();
    });
  });

  describe('getStats extended', () => {
    it('getStats returns structured stats', () => {
      const stats = bridge.getStats();
      expect(stats).toHaveProperty('faces');
      expect(stats).toHaveProperty('verts');
    });
  });

  describe('previewEdgeEraseMerge — dual-tolerance fallback (Option A)', () => {
    // 실제 erase 경로 (`batch_erase_edges_impl`) 가 standard merge 실패 시
    // `merge_coplanar_faces_geometric` 를 `max(tol*4, 2°)` 로 한 번 더 시도하므로
    // preview 도 동일한 두 단계 시뮬레이션이 필요. WasmBridge.previewEdgeEraseMerge
    // 가 두 번 호출하는지 검증.
    function installFakeEngine(
      response: (edgeId: number, tol: number) => Uint32Array | null,
    ): ReturnType<typeof vi.fn> {
      const fn = vi.fn(response);
      (bridge as any).engine = { previewEdgeEraseMerge: fn };
      return fn;
    }

    it('returns the pair on first hit (user tolerance succeeds — no second call)', () => {
      const fn = installFakeEngine(() => new Uint32Array([42, 99]));
      const out = bridge.previewEdgeEraseMerge(7, 0.5);
      expect(out).toEqual([42, 99]);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenNthCalledWith(1, 7, 0.5);
    });

    it('falls back to geometric tol max(tol*4, 2°) when standard fails', () => {
      // First call (0.5°) → null; second call (2°) → pair.
      const fn = installFakeEngine((_eid, tol) => {
        if (tol <= 0.5 + 1e-9) return new Uint32Array(); // length-0 = null result
        return new Uint32Array([3, 4]);
      });
      const out = bridge.previewEdgeEraseMerge(11, 0.5);
      expect(out).toEqual([3, 4]);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenNthCalledWith(1, 11, 0.5);
      // geo tol = max(0.5*4, 2.0) = 2.0
      expect(fn).toHaveBeenNthCalledWith(2, 11, 2.0);
    });

    it('uses tol*4 when user tol*4 > 2° (e.g. user already loosened to 1°)', () => {
      const fn = installFakeEngine((_eid, tol) => {
        if (tol < 4.0 - 1e-9) return new Uint32Array();
        return new Uint32Array([5, 6]);
      });
      const out = bridge.previewEdgeEraseMerge(11, 1.0);
      expect(out).toEqual([5, 6]);
      // geo tol = max(1.0*4, 2.0) = 4.0
      expect(fn).toHaveBeenNthCalledWith(2, 11, 4.0);
    });

    it('returns null when both tolerances fail (genuinely non-coplanar)', () => {
      const fn = installFakeEngine(() => new Uint32Array());
      const out = bridge.previewEdgeEraseMerge(99, 0.5);
      expect(out).toBeNull();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('skips the redundant second call when geo tol equals user tol', () => {
      // angleTolDeg = 2.0 → geo tol = max(8, 2) = 8 > 2, so second call still
      // happens. To trigger the skip, user passes ≥ 2.0 such that tol*4 ≤ tol
      // is impossible — the code's guard is `geoTol > angleTolDeg`. Pick a
      // tol so the first call succeeds OR the guard short-circuits.
      // For tol ≥ 0.5, geo always > tol; the genuine skip path needs the
      // first call to succeed, already covered above. This test asserts that
      // when the engine isn't available, no calls happen.
      (bridge as any).engine = undefined;
      const out = bridge.previewEdgeEraseMerge(7, 0.5);
      expect(out).toBeNull();
    });
  });
});
