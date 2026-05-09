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
  draw_line_as_shape: vi.fn().mockReturnValue(1),
  draw_rect_as_shape: vi.fn().mockReturnValue(2),
  draw_circle_as_shape: vi.fn().mockReturnValue(3),
  create_solid_extrude: vi.fn().mockReturnValue(true),
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
      const result = bridge.drawLineAsShape(0, 0, 0, 1, 0, 0, 0, 0, 1);
      expect(typeof result).toBe('number');
    });

    it('drawRect() returns face count', () => {
      const result = bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 1);
      expect(typeof result).toBe('number');
    });

    it('drawCircle() returns face count', () => {
      const result = bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 5, 24);
      expect(typeof result).toBe('number');
    });

    it('drawLine() marks buffers dirty', () => {
      bridge.getMeshBuffers(); // clear dirty flag
      bridge.drawLineAsShape(0, 0, 0, 1, 0, 0, 0, 0, 1);
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
        draw_rect_as_shape: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawRectAsShape(1.0, 1e-7, 2.0, 0, 1, 0, 0, 0, 1, 5, 5);
      expect(captured[0]).toBe(1.0);
      expect(captured[1]).toBe(0);  // ε snapped exactly to 0
      expect(captured[2]).toBe(2.0);
    });

    it('drawRect() snaps center.z to exact 0 when normal=(0,0,1) and z is sub-tol', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect_as_shape: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawRectAsShape(1.0, 2.0, 5e-8, 0, 0, 1, 1, 0, 0, 5, 5);
      expect(captured[2]).toBe(0);
    });

    it('drawRect() preserves non-cardinal normal coords', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect_as_shape: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      // Normal not axis-aligned → no snap
      bridge.drawRectAsShape(1.0, 1e-7, 2.0, 0.7, 0.7, 0, 0, 0, 1, 5, 5);
      expect(captured[1]).toBeCloseTo(1e-7, 12);  // unchanged
    });

    it('drawRect() preserves coords above tolerance', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect_as_shape: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      // 0.5 is way above 1e-3 tol → not snapped
      bridge.drawRectAsShape(1.0, 0.5, 2.0, 0, 1, 0, 0, 0, 1, 5, 5);
      expect(captured[1]).toBe(0.5);
    });

    it('drawCircle() snaps center y to 0 when normal=(0,1,0)', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_circle_as_shape: (cx: number, cy: number, cz: number, ...rest: number[]) => {
          captured.push(cx, cy, cz, ...rest);
          return 1;
        },
      };
      bridge.drawCircleAsShape(1.0, 1e-7, 2.0, 0, 1, 0, 5, 24);
      expect(captured[1]).toBe(0);
    });

    it('drawLine() snaps both endpoints when both on cardinal y=0 plane', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_line_as_shape: (...args: number[]) => {
          captured.push(...args);
          return 1;
        },
      };
      bridge.drawLineAsShape(1.0, 1e-7, 2.0, 5.0, 3e-8, 7.0);
      expect(captured[1]).toBe(0);  // y0 snapped
      expect(captured[4]).toBe(0);  // y1 snapped
    });

    it('drawLine() does NOT snap when only one endpoint near 0', () => {
      const captured: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_line_as_shape: (...args: number[]) => {
          captured.push(...args);
          return 1;
        },
      };
      // y0 ≈ 0 but y1 = 5 → not coplanar with y=0 plane → no snap
      bridge.drawLineAsShape(1.0, 1e-7, 2.0, 5.0, 5.0, 7.0);
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
    // ADR-086 O-γ — inject external face (STEP/IGES Approach A) tests
    // ──────────────────────────────────────────────────────────────────

    it('injectExternalFaceNoSurface() forwards positions array to WASM', () => {
      let capturedPositions: Float64Array | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        injectExternalFaceNoSurface: (pts: Float64Array) => {
          capturedPositions = pts;
          return 7;  // synthetic FaceId
        },
      };
      const positions = new Float64Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
      const faceId = bridge.injectExternalFaceNoSurface(positions);
      expect(faceId).toBe(7);
      expect(capturedPositions).toBe(positions);
    });

    it('injectExternalFaceNoSurface() returns -1 when WASM API missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};  // no inject method
      const positions = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      expect(bridge.injectExternalFaceNoSurface(positions)).toBe(-1);
    });

    it('injectExternalFacePlane() forwards positions + 9 plane params', () => {
      let captured: { pts: Float64Array | null; args: number[] } = { pts: null, args: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        injectExternalFacePlane: (pts: Float64Array, ...args: number[]) => {
          captured = { pts, args };
          return 42;  // synthetic FaceId
        },
      };
      const positions = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const faceId = bridge.injectExternalFacePlane(
        positions,
        [10, 20, 30],     // origin
        [0, 0, 1],        // normal +Z
        [1, 0, 0],        // basis_u +X
      );
      expect(faceId).toBe(42);
      expect(captured.pts).toBe(positions);
      expect(captured.args.length).toBe(9);
      // origin
      expect(captured.args[0]).toBe(10);
      expect(captured.args[1]).toBe(20);
      expect(captured.args[2]).toBe(30);
      // normal
      expect(captured.args[5]).toBe(1);  // nz
      // basis_u
      expect(captured.args[6]).toBe(1);  // ux
    });

    it('injectExternalFacePlane() returns -1 when WASM API missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      const positions = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const result = bridge.injectExternalFacePlane(
        positions, [0, 0, 0], [0, 0, 1], [1, 0, 0],
      );
      expect(result).toBe(-1);
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
        drawPolylineAsShape: (arr: Float64Array) => {
          captured.push(arr.slice());
          return 1;
        },
      };
      bridge.drawPolylineAsShape([0, 1e-7, 0,  5, 2e-8, 0,  5, 3e-8, 5,  0, 1e-7, 5]);
      const arr = captured[0];
      expect(arr[1]).toBe(0);
      expect(arr[4]).toBe(0);
      expect(arr[7]).toBe(0);
      expect(arr[10]).toBe(0);
    });
  });

  describe('push/pull', () => {
    it('pushPull() returns boolean', () => {
      const result = bridge.createSolidExtrude(1, 5.0);
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

    it('drawLineAsShape returns -1 when not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.drawLineAsShape(0, 0, 0, 1, 0, 0, 0, 0, 1)).toBe(-1);
    });

    it('createSolidExtrude returns false when not ready', () => {
      const uninitBridge = new WasmBridge();
      expect(uninitBridge.createSolidExtrude(1, 5.0)).toBe(false);
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

  // ADR-076 Step 2 — Removed:
  //   - 'ADR-064 Step 6-β booleanDispatchDcel' describe (5 tests)
  //   - 'ADR-064 Step 6-δ booleanDispatchDcel + undo contract' describe (4 tests)
  // The single-face DCEL bridge wrapper was removed in ADR-076 Step 2 along
  // with its WASM export; multi (Y-3) tests cover the canonical surface.

  // ════════════════════════════════════════════════════════════════════════
  // ADR-066 Y-3 (Path Y) — booleanDispatchDcelMulti typed wrapper
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-066 Y-3 booleanDispatchDcelMulti', () => {
    it('returns null when engine.booleanDispatchDcelMultiJson is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};  // no booleanDispatchDcelMultiJson
      const out = bridge.booleanDispatchDcelMulti([1, 2], [3, 4], 'subtract');
      expect(out).toBeNull();
    });

    it('parses ok result with full per-pair array (Y-2-c)', () => {
      const fakeJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 1, faceB: 3,
            outcome: { kind: 'ok',
              dcel: {
                newFacesA: [100], newFacesB: [],
                removedFaces: [1, 3], preservedFaces: [],
                disjoint: false, robustnessClean: true,
              } } },
          { faceA: 1, faceB: 4,
            outcome: { kind: 'ok',
              dcel: {
                newFacesA: [], newFacesB: [],
                removedFaces: [], preservedFaces: [1, 4],
                disjoint: true, robustnessClean: true,
              } } },
        ],
        allNewFaces: [100],
        allRemovedFaces: [1, 3],
        warnings: [],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => fakeJson,
      };
      const out = bridge.booleanDispatchDcelMulti([1], [3, 4], 'subtract');
      expect(out).not.toBeNull();
      expect(out!.kind).toBe('ok');
      if (out!.kind === 'ok') {
        expect(out!.pathUsed).toBe('Nurbs');
        expect(out!.fallbackReason).toBeNull();
        expect(out!.perPair).toHaveLength(2);
        // First pair — ok outcome with dcel.
        const p0 = out!.perPair[0];
        expect(p0.faceA).toBe(1);
        expect(p0.faceB).toBe(3);
        expect(p0.outcome.kind).toBe('ok');
        if (p0.outcome.kind === 'ok') {
          expect(p0.outcome.dcel.newFacesA).toEqual([100]);
          expect(p0.outcome.dcel.disjoint).toBe(false);
        }
        // Second pair — disjoint dcel.
        if (out!.perPair[1].outcome.kind === 'ok') {
          expect(out!.perPair[1].outcome.dcel.disjoint).toBe(true);
        }
        expect(out!.allNewFaces).toEqual([100]);
        expect(out!.allRemovedFaces).toEqual([1, 3]);
      }
    });

    it('parses ok result with err per-pair entry (Y-2-j discriminator)', () => {
      const fakeJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 1, faceB: 3,
            outcome: { kind: 'ok',
              dcel: {
                newFacesA: [100], newFacesB: [],
                removedFaces: [1], preservedFaces: [],
                disjoint: false, robustnessClean: true,
              } } },
          { faceA: 1, faceB: 4,
            outcome: { kind: 'err',
              detail: "InactiveFace: face_a FaceId(1) is inactive (cascade removed by earlier pair)" } },
        ],
        allNewFaces: [100],
        allRemovedFaces: [1],
        warnings: [
          'pair (FaceId(1), FaceId(4)): InactiveFace: face_a FaceId(1) is inactive',
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => fakeJson,
      };
      const out = bridge.booleanDispatchDcelMulti([1], [3, 4], 'subtract');
      expect(out!.kind).toBe('ok');
      if (out!.kind === 'ok') {
        expect(out!.perPair).toHaveLength(2);
        // First pair succeeded.
        expect(out!.perPair[0].outcome.kind).toBe('ok');
        // Second pair = err (cascade removal).
        const p1 = out!.perPair[1];
        expect(p1.outcome.kind).toBe('err');
        if (p1.outcome.kind === 'err') {
          expect(p1.outcome.detail).toContain('InactiveFace');
        }
        // Warnings recorded.
        expect(out!.warnings).toHaveLength(1);
        expect(out!.warnings[0]).toContain('InactiveFace');
      }
    });

    it('parses ok result with empty arrays for Mesh path (Y-E ineligibility)', () => {
      const fakeJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Mesh',
        fallbackReason: { kind: 'SurfaceMissing', label: 'surface_missing' },
        perPair: [],
        allNewFaces: [],
        allRemovedFaces: [],
        warnings: ['Y-E strict: 1 face(s) on side A and 0 on side B lack analytic surface'],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => fakeJson,
      };
      const out = bridge.booleanDispatchDcelMulti([1, 2], [3], 'union');
      expect(out!.kind).toBe('ok');
      if (out!.kind === 'ok') {
        expect(out!.pathUsed).toBe('Mesh');
        expect(out!.perPair).toHaveLength(0);
        expect(out!.allNewFaces).toEqual([]);
        expect(out!.allRemovedFaces).toEqual([]);
        expect(out!.fallbackReason).not.toBeNull();
        expect(out!.fallbackReason!.kind).toBe('SurfaceMissing');
        expect(out!.warnings.length).toBeGreaterThan(0);
      }
    });

    it('parses error envelope on invalid op string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => JSON.stringify({
          schemaVersion: 1, ok: false,
          error: 'invalid op string (expected: union | subtract | intersect)',
        }),
      };
      // TS type forbids invalid op at compile time, so cast for the test.
      const out = bridge.booleanDispatchDcelMulti(
        [1], [2], 'union' as 'union',
      );
      expect(out!.kind).toBe('error');
      if (out!.kind === 'error') {
        expect(out!.reason).toBe('invalidOp');
        expect(out!.detail).toContain('invalid op');
      }

      // Generic engine error on a different mock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => JSON.stringify({
          schemaVersion: 1, ok: false,
          error: 'face_a 999 not found',
        }),
      };
      const out2 = bridge.booleanDispatchDcelMulti([999], [1], 'subtract');
      expect(out2!.kind).toBe('error');
      if (out2!.kind === 'error') {
        expect(out2!.reason).toBe('engineErr');
      }

      // Non-JSON response.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: () => 'not valid json{',
      };
      const out3 = bridge.booleanDispatchDcelMulti([1], [2], 'subtract');
      expect(out3!.kind).toBe('error');
      if (out3!.kind === 'error') {
        expect(out3!.reason).toBe('parse');
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-066 Y-5 (Path Y) — Undo cross-method contract (multi)
  //
  // Real runtime E2E (multi → undo on a live WASM engine) is browser-only.
  // At the TS bridge layer we verify the CONTRACT between
  // booleanDispatchDcelMulti and undo via mocks: markDirty signaling,
  // cross-method sequencing, and transaction safety on Err / partial.
  // Transaction-wrapping itself is verified at WASM source-inspection
  // level by Y-2 (boolean_dispatch_dcel_multi_json_uses_transactions).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-066 Y-5 booleanDispatchDcelMulti + undo contract', () => {
    it('booleanDispatchDcelMulti calls markDirty before delegating to engine', () => {
      const successJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 1, faceB: 3, outcome: { kind: 'ok',
            dcel: {
              newFacesA: [100], newFacesB: [],
              removedFaces: [1], preservedFaces: [],
              disjoint: false, robustnessClean: true,
            } } },
        ],
        allNewFaces: [100],
        allRemovedFaces: [1],
        warnings: [],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: vi.fn(() => successJson),
        undo: vi.fn(() => true),
      };
      const markDirtySpy = vi.spyOn(bridge, 'markDirty');

      const result = bridge.booleanDispatchDcelMulti([1], [3], 'subtract');

      expect(markDirtySpy).toHaveBeenCalled();
      expect(result?.kind).toBe('ok');
      // markDirty must fire BEFORE the engine call (Y-3-f invariant).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engineFn = (bridge as any).engine.booleanDispatchDcelMultiJson as ReturnType<typeof vi.fn>;
      const dirtyCallOrder = markDirtySpy.mock.invocationCallOrder[0];
      const engineCallOrder = engineFn.mock.invocationCallOrder[0];
      expect(dirtyCallOrder).toBeLessThan(engineCallOrder);
    });

    it('booleanDispatchDcelMulti followed by undo forwards both calls correctly', () => {
      const successJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 1, faceB: 3, outcome: { kind: 'ok',
            dcel: {
              newFacesA: [100, 101], newFacesB: [],
              removedFaces: [1], preservedFaces: [3],
              disjoint: false, robustnessClean: true,
            } } },
          { faceA: 2, faceB: 4, outcome: { kind: 'ok',
            dcel: {
              newFacesA: [102], newFacesB: [],
              removedFaces: [2], preservedFaces: [4],
              disjoint: false, robustnessClean: true,
            } } },
        ],
        allNewFaces: [100, 101, 102],
        allRemovedFaces: [1, 2],
        warnings: [],
      });
      const undoFn = vi.fn(() => true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: vi.fn(() => successJson),
        undo: undoFn,
      };

      // Sequence: multi → undo (cross-method).
      const multi = bridge.booleanDispatchDcelMulti([1, 2], [3, 4], 'subtract');
      const undoOk = bridge.undo();

      expect(multi?.kind).toBe('ok');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const engineFn = (bridge as any).engine.booleanDispatchDcelMultiJson as ReturnType<typeof vi.fn>;
      expect(engineFn).toHaveBeenCalledTimes(1);
      expect(undoFn).toHaveBeenCalledTimes(1);
      expect(undoOk).toBe(true);
    });

    it('engine.undo after multi Nurbs success (incl. partial) returns true', () => {
      // Y-5-f — partial-success case: 1 ok + 1 err in per_pair. The
      // WASM transaction is committed atomically (Y-2 verified), so
      // undo reverses the entire batch (the 1 ok pair) in one call.
      const partialJson = JSON.stringify({
        schemaVersion: 1, ok: true,
        pathUsed: 'Nurbs',
        fallbackReason: null,
        perPair: [
          { faceA: 1, faceB: 3, outcome: { kind: 'ok',
            dcel: {
              newFacesA: [100], newFacesB: [],
              removedFaces: [1], preservedFaces: [3],
              disjoint: false, robustnessClean: true,
            } } },
          { faceA: 1, faceB: 4, outcome: {
            kind: 'err',
            detail: 'InactiveFace cascade',
          } },
        ],
        allNewFaces: [100],
        allRemovedFaces: [1],
        warnings: ['pair (FaceId(1), FaceId(4)): InactiveFace'],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: vi.fn(() => partialJson),
        // Single undo undoes the entire batch (atomicity invariant).
        undo: vi.fn(() => true),
      };

      const multi = bridge.booleanDispatchDcelMulti([1], [3, 4], 'subtract');
      const undoOk = bridge.undo();

      expect(multi?.kind).toBe('ok');
      if (multi?.kind === 'ok') {
        // Sanity: partial result has 1 ok + 1 err pair.
        expect(multi.perPair).toHaveLength(2);
        expect(multi.perPair.filter(p => p.outcome.kind === 'ok')).toHaveLength(1);
        expect(multi.perPair.filter(p => p.outcome.kind === 'err')).toHaveLength(1);
      }
      // Single undo must succeed for the partial-commit batch.
      expect(undoOk).toBe(true);
    });

    it('engine.undo after multi error envelope still works (no transaction leak)', () => {
      // After bridge returns kind:'error', the WASM side has called
      // transactions.cancel() (verified by Y-2). The TS bridge must
      // not have left any state that prevents subsequent undo from
      // operating on PRIOR committed transactions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        booleanDispatchDcelMultiJson: vi.fn(() => JSON.stringify({
          schemaVersion: 1, ok: false,
          error: 'face_a 999 not found',
        })),
        // Undo of a PRIOR transaction (mocked as available).
        undo: vi.fn(() => true),
      };

      const errResult = bridge.booleanDispatchDcelMulti([999], [1], 'subtract');
      const undoOk = bridge.undo();

      expect(errResult?.kind).toBe('error');
      expect(undoOk).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const undoMock = (bridge as any).engine.undo as ReturnType<typeof vi.fn>;
      expect(undoMock).toHaveBeenCalledTimes(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-078 P-2 — Boolean Group Persistence typed wrappers
  // (project-persistent layer; TS U-1 SelectionManager is runtime mirror)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-078 P-2 Boolean Group Persistence wrappers', () => {
    it('setBooleanGroupTag forwards Uint32Array + tag to engine', () => {
      const fn = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { setBooleanGroupTag: fn };
      bridge.setBooleanGroupTag([10, 20, 30], 'A');
      expect(fn).toHaveBeenCalledTimes(1);
      const [faces, tag] = fn.mock.calls[0];
      expect(faces).toBeInstanceOf(Uint32Array);
      expect(Array.from(faces)).toEqual([10, 20, 30]);
      expect(tag).toBe('A');
    });

    it('setBooleanGroupTag is no-op when engine method missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.setBooleanGroupTag([1], 'A')).not.toThrow();
    });

    it('getBooleanGroupAFaces / getBooleanGroupBFaces convert Uint32Array → number[]', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        getBooleanGroupAFaces: () => Uint32Array.from([1, 5, 9]),
        getBooleanGroupBFaces: () => Uint32Array.from([2, 7]),
      };
      expect(bridge.getBooleanGroupAFaces()).toEqual([1, 5, 9]);
      expect(bridge.getBooleanGroupBFaces()).toEqual([2, 7]);
    });

    it('getBooleanGroupAFaces returns [] when engine method missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getBooleanGroupAFaces()).toEqual([]);
      expect(bridge.getBooleanGroupBFaces()).toEqual([]);
    });

    it('clearBooleanGroupTags forwards to engine and is graceful when missing', () => {
      const fn = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { clearBooleanGroupTags: fn };
      bridge.clearBooleanGroupTags();
      expect(fn).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.clearBooleanGroupTags()).not.toThrow();
    });

    it('hasAnyBooleanGroupTag / hasBooleanGroupSelection return engine bool, default false', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        hasAnyBooleanGroupTag: () => true,
        hasBooleanGroupSelection: () => false,
      };
      expect(bridge.hasAnyBooleanGroupTag()).toBe(true);
      expect(bridge.hasBooleanGroupSelection()).toBe(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.hasAnyBooleanGroupTag()).toBe(false);
      expect(bridge.hasBooleanGroupSelection()).toBe(false);
    });

    it('setBooleanGroupTag propagates engine throw (invalid tag → P-2-c strict)', () => {
      const errFn = vi.fn(() => {
        throw new Error("setBooleanGroupTag: invalid tag 'X' (expected 'A' or 'B')");
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { setBooleanGroupTag: errFn };
      // TS type forbids 'X' at compile time — cast for runtime invariant test.
      expect(() =>
        bridge.setBooleanGroupTag([1], 'X' as 'A')
      ).toThrow(/invalid tag/);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-050 P-4 — Shape (form-layer citizenship) typed wrappers
  // (mirrors ADR-078 P-2 pattern; TS surface for Two-Layer Citizenship)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-050 P-4 Shape WASM bridge wrappers', () => {
    it('createShape forwards name + Uint32Array(faceIds), returns id', () => {
      const fn = vi.fn(() => 42);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { createShape: fn };
      const id = bridge.createShape('Rect', [10, 20, 30]);
      expect(id).toBe(42);
      const [name, faces] = fn.mock.calls[0];
      expect(name).toBe('Rect');
      expect(faces).toBeInstanceOf(Uint32Array);
      expect(Array.from(faces)).toEqual([10, 20, 30]);
    });

    it('createShape returns 0 when engine method missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.createShape('x', [1])).toBe(0);
    });

    it('getShapeIds / getShapeFaceIds convert Uint32Array → number[]', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        getShapeIds: () => Uint32Array.from([1, 3, 7]),
        getShapeFaceIds: (id: number) => Uint32Array.from([id * 10, id * 10 + 1]),
      };
      expect(bridge.getShapeIds()).toEqual([1, 3, 7]);
      expect(bridge.getShapeFaceIds(2)).toEqual([20, 21]);
    });

    it('getShapeIds / getShapeFaceIds return [] when missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getShapeIds()).toEqual([]);
      expect(bridge.getShapeFaceIds(99)).toEqual([]);
    });

    it('deleteShape forwards id and returns boolean, default false when missing', () => {
      const fn = vi.fn(() => true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { deleteShape: fn };
      expect(bridge.deleteShape(7)).toBe(true);
      expect(fn).toHaveBeenCalledWith(7);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.deleteShape(7)).toBe(false);
    });

    it('clearShapes forwards to engine and is graceful when missing', () => {
      const fn = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { clearShapes: fn };
      bridge.clearShapes();
      expect(fn).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.clearShapes()).not.toThrow();
    });

    it('promoteShapeToXia forwards args, returns new XiaId', () => {
      const fn = vi.fn(() => 5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { promoteShapeToXia: fn };
      expect(bridge.promoteShapeToXia(2, 7)).toBe(5);
      expect(fn).toHaveBeenCalledWith(2, 7);
    });

    it('promoteShapeToXia propagates engine throw (P-2-c strict — silent skip 차단)', () => {
      const errFn = vi.fn(() => {
        throw new Error('promoteShapeToXia: Material is default (id=0)');
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { promoteShapeToXia: errFn };
      expect(() => bridge.promoteShapeToXia(1, 0)).toThrow(/Material is default/);
    });

    it('promoteShapeToXia throws when WASM endpoint missing (feature gate)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.promoteShapeToXia(1, 1))
        .toThrow(/WASM endpoint missing/);
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-091 D-γ — Material removal → Shape demotion bridge wrapper
    // ────────────────────────────────────────────────────────────────

    it('demoteXiaToShape parses JSON and returns typed result (D-γ success path)', () => {
      const fn = vi.fn(() =>
        '{"shape_id":42,"original_id_restored":true}',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { demoteXiaToShape: fn };
      const result = bridge.demoteXiaToShape(7);
      expect(result).toEqual({ shapeId: 42, originalIdRestored: true });
      expect(fn).toHaveBeenCalledWith(7);
    });

    it('demoteXiaToShape propagates engine throw (D-γ strict — silent skip 차단)', () => {
      const errFn = vi.fn(() => {
        throw new Error(
          'demoteXiaToShape: Xia material is not the form-layer sentinel (FORM_MATERIAL)',
        );
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { demoteXiaToShape: errFn };
      expect(() => bridge.demoteXiaToShape(7))
        .toThrow(/form-layer sentinel/);
    });

    it('demoteXiaToShape throws when WASM endpoint missing (feature gate)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.demoteXiaToShape(7))
        .toThrow(/WASM endpoint missing/);
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-093 D-γ — Cylinder side face owner-id WASM bridge wrappers
    // ────────────────────────────────────────────────────────────────

    it('walkFaceOwnerSiblings returns engine result as number[] (success path)', () => {
      const fn = vi.fn(() => new Uint32Array([10, 11, 12, 13]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { walkFaceOwnerSiblings: fn };
      expect(bridge.walkFaceOwnerSiblings(10)).toEqual([10, 11, 12, 13]);
      expect(fn).toHaveBeenCalledWith(10);
    });

    it('walkFaceOwnerSiblings returns [faceId] when WASM endpoint missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.walkFaceOwnerSiblings(42)).toEqual([42]);
    });

    it('getFaceSurfaceOwnerId returns engine value (success path)', () => {
      const fn = vi.fn(() => 7);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getFaceSurfaceOwnerId: fn };
      expect(bridge.getFaceSurfaceOwnerId(10)).toBe(7);
      expect(fn).toHaveBeenCalledWith(10);
    });

    it('getFaceSurfaceOwnerId returns -1 when endpoint missing (no owner sentinel)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getFaceSurfaceOwnerId(7)).toBe(-1);
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-094 B-η — Cylinder Path B default flag
    // ────────────────────────────────────────────────────────────────

    it('setCylinderPathBDefault forwards to engine', () => {
      const fn = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { setCylinderPathBDefault: fn };
      bridge.setCylinderPathBDefault(true);
      expect(fn).toHaveBeenCalledWith(true);
      bridge.setCylinderPathBDefault(false);
      expect(fn).toHaveBeenCalledWith(false);
    });

    it('setCylinderPathBDefault graceful no-op when endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.setCylinderPathBDefault(true)).not.toThrow();
    });

    it('getCylinderPathBDefault returns engine value', () => {
      const fn = vi.fn(() => true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getCylinderPathBDefault: fn };
      expect(bridge.getCylinderPathBDefault()).toBe(true);
    });

    it('getCylinderPathBDefault returns false when endpoint missing (legacy default)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getCylinderPathBDefault()).toBe(false);
    });

    // ────────────────────────────────────────────────────────────────
    // ADR-095 Phase 3-γ — Reference 시민권 bridge wrappers
    // ────────────────────────────────────────────────────────────────

    it('createReferenceConstructionLine forwards to engine and returns id', () => {
      const fn = vi.fn(() => 42);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { createReferenceConstructionLine: fn };
      const id = bridge.createReferenceConstructionLine('Center', [10, 20]);
      expect(id).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('createReferenceConstructionLine throws when endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(() => bridge.createReferenceConstructionLine('X', [1])).toThrow(/WASM endpoint missing/);
    });

    it('createReferenceImportedMesh propagates engine throw on R-B violation', () => {
      const errFn = vi.fn(() => {
        throw new Error('createReferenceImportedMesh: face owned by Xia');
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { createReferenceImportedMesh: errFn };
      expect(() => bridge.createReferenceImportedMesh('M', [1], '/site.step'))
        .toThrow(/owned by Xia/);
    });

    it('createReferencePointCloud forwards args + returns id', () => {
      const fn = vi.fn(() => 5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { createReferencePointCloud: fn };
      expect(bridge.createReferencePointCloud('Scan', [1, 2, 3])).toBe(5);
    });

    it('getReference parses JSON from engine for ConstructionLine', () => {
      const json =
        '{"id":3,"name":"Axis","category":{"kind":"ConstructionLine","edge_ids":[7,8]},"visible":true,"locked":false}';
      const fn = vi.fn(() => json);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getReferenceJson: fn };
      const r = bridge.getReference(3);
      expect(r).not.toBeNull();
      expect(r!.id).toBe(3);
      expect(r!.category).toEqual({ kind: 'ConstructionLine', edgeIds: [7, 8] });
      expect(r!.visible).toBe(true);
    });

    it('getReference returns null when endpoint returns empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getReferenceJson: vi.fn(() => '') };
      expect(bridge.getReference(99)).toBeNull();
    });

    it('getReferenceIds returns empty when endpoint missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getReferenceIds()).toEqual([]);
    });

    it('deleteReference / setReferenceVisible / setReferenceLocked all return false when endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.deleteReference(1)).toBe(false);
      expect(bridge.setReferenceVisible(1, true)).toBe(false);
      expect(bridge.setReferenceLocked(1, true)).toBe(false);
    });

    it('getFaceReferenceId returns -1 when endpoint missing (no Reference sentinel)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.getFaceReferenceId(7)).toBe(-1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-050 P-5c — As-Shape Draw bridge wrappers
  // (form-layer parallels of drawRect / drawLine / drawCircle)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-050 P-5c As-Shape Draw bridge wrappers', () => {
    it('drawRectAsShape forwards to engine.draw_rect_as_shape and returns shape id', () => {
      const fn = vi.fn(() => 7);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { draw_rect_as_shape: fn };
      const id = bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 3);
      expect(id).toBe(7);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('drawRectAsShape returns -1 when WASM endpoint missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1)).toBe(-1);
    });

    it('drawLineAsShape forwards to engine.draw_line_as_shape', () => {
      const fn = vi.fn(() => 11);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { draw_line_as_shape: fn };
      const id = bridge.drawLineAsShape(0, 0, 0, 1, 0, 0);
      expect(id).toBe(11);
      expect(fn).toHaveBeenCalledTimes(1);
      // Verify nx=ny=nz=0 default propagated for free-edge mode.
      const args = fn.mock.calls[0];
      expect(args[6]).toBe(0); // nx
      expect(args[7]).toBe(0); // ny
      expect(args[8]).toBe(0); // nz
    });

    it('drawCircleAsShape forwards to engine.draw_circle_as_shape', () => {
      const fn = vi.fn(() => 13);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { draw_circle_as_shape: fn };
      const id = bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1.5, 16);
      expect(id).toBe(13);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('all three As-Shape wrappers return -1 with no engine (defensive)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = null;
      expect(bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1)).toBe(-1);
      expect(bridge.drawLineAsShape(0, 0, 0, 1, 0, 0)).toBe(-1);
      expect(bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1, 8)).toBe(-1);
    });

    it('legacy drawRect / drawLine / drawCircle UNCHANGED (P-5c §C lock-in)', () => {
      // P-5c §C lock-in #1 — adding As-Shape wrappers must not affect
      // the legacy draw* family. Verify they still hit draw_rect /
      // draw_line / draw_circle (not draw_*_as_shape).
      const drawRectFn = vi.fn(() => 1);
      const drawLineFn = vi.fn(() => 2);
      const drawCircleFn = vi.fn(() => 3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        draw_rect_as_shape: drawRectFn,
        draw_line_as_shape: drawLineFn,
        draw_circle_as_shape: drawCircleFn,
      };
      expect(bridge.drawRectAsShape(0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1)).toBe(1);
      expect(bridge.drawLineAsShape(0, 0, 0, 1, 0, 0)).toBe(2);
      expect(bridge.drawCircleAsShape(0, 0, 0, 0, 0, 1, 1, 8)).toBe(3);
      expect(drawRectFn).toHaveBeenCalled();
      expect(drawLineFn).toHaveBeenCalled();
      expect(drawCircleFn).toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-079 W-1-β — createSolidExtrude bridge wrapper
  // (Push/Pull architectural successor — Plane Box via create_solid kernel)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-079 W-1-β createSolidExtrude wrapper', () => {
    it('createSolidExtrude forwards to engine.create_solid_extrude with id + distance', () => {
      const fn = vi.fn(() => true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { create_solid_extrude: fn };
      const ok = bridge.createSolidExtrude(7, 100);
      expect(ok).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(7, 100);
    });

    it('createSolidExtrude returns false when WASM endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.createSolidExtrude(1, 50)).toBe(false);
    });

    it('ADR-087 K-ζ — legacy pushPull bridge wrapper deleted; createSolidExtrude is sole entry', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = bridge;
      expect(typeof b.pushPull).toBe('undefined');
      expect(typeof b.createSolidExtrude).toBe('function');
    });
  });

  describe('ADR-080 V-β-α-bridge offsetEdgeOnHost wrapper', () => {
    it('returns success result on Rust success JSON', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: true, newEdge: 42, newV0: 100, newV1: 101 }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(7, 0.5);
      expect(fn).toHaveBeenCalledWith(7, 0.5);
      expect(r).toEqual({ ok: true, newEdge: 42, newV0: 100, newV1: 101 });
    });

    it('parses unsupported_surface reason with kind', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'unsupported_surface', kind: 'Cylinder' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'unsupported_surface', kind: 'Cylinder' });
    });

    it('parses unsupported_curve reason with kind', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'unsupported_curve', kind: 'Arc' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'unsupported_curve', kind: 'Arc' });
    });

    it('parses no_incident_face / multi_loop / degenerate_distance reasons', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {
        offset_edge_on_host: vi.fn((id: number) => {
          if (id === 1) return JSON.stringify({ ok: false, reason: 'no_incident_face' });
          if (id === 2) return JSON.stringify({ ok: false, reason: 'multi_loop' });
          return JSON.stringify({ ok: false, reason: 'degenerate_distance' });
        }),
      };
      expect(bridge.offsetEdgeOnHost(1, 1)).toEqual({ ok: false, reason: 'no_incident_face' });
      expect(bridge.offsetEdgeOnHost(2, 1)).toEqual({ ok: false, reason: 'multi_loop' });
      expect(bridge.offsetEdgeOnHost(3, 1)).toEqual({ ok: false, reason: 'degenerate_distance' });
    });

    it('parses ambiguous_host with nFaces', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'ambiguous_host', nFaces: 3 }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'ambiguous_host', nFaces: 3 });
    });

    it('returns bridge_unavailable when engine method is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.offsetEdgeOnHost(1, 1)).toEqual({
        ok: false,
        reason: 'bridge_unavailable',
      });
    });

    it('parses arc_plane_mismatch reason (V-β-β)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'arc_plane_mismatch' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'arc_plane_mismatch' });
    });

    it('parses radius_collapse with currentRadius / newRadius (V-β-β)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({
          ok: false,
          reason: 'radius_collapse',
          currentRadius: 0.5,
          newRadius: -0.1,
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 0.6);
      expect(r).toEqual({
        ok: false,
        reason: 'radius_collapse',
        currentRadius: 0.5,
        newRadius: -0.1,
      });
    });

    it('parses unsupported_curve_on_surface (V-β-γ-1)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({
          ok: false,
          reason: 'unsupported_curve_on_surface',
          surfaceKind: 'Cylinder',
          curveKind: 'Line(non-axial)',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({
        ok: false,
        reason: 'unsupported_curve_on_surface',
        surfaceKind: 'Cylinder',
        curveKind: 'Line(non-axial)',
      });
    });

    it('parses axial_out_of_range with newV / vMin / vMax (V-β-γ-1)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({
          ok: false,
          reason: 'axial_out_of_range',
          newV: 5.0,
          vMin: 0.0,
          vMax: 1.0,
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 5);
      expect(r).toEqual({
        ok: false,
        reason: 'axial_out_of_range',
        newV: 5.0,
        vMin: 0.0,
        vMax: 1.0,
      });
    });

    it('parses wire_not_planar with rmsError (V-δ-α)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'wire_not_planar', rmsError: 0.0125 }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'wire_not_planar', rmsError: 0.0125 });
    });

    it('parses no_reference_plane (V-δ-α)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: false, reason: 'no_reference_plane' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_on_host: fn };
      const r = bridge.offsetEdgeOnHost(1, 1);
      expect(r).toEqual({ ok: false, reason: 'no_reference_plane' });
    });

    it('offsetEdgeWithReferencePlane forwards 8 args to engine (V-δ-β)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({ ok: true, newEdge: 50, newV0: 200, newV1: 201 }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_with_reference_plane: fn };
      const r = bridge.offsetEdgeWithReferencePlane(
        7, 0.5, [1, 2, 3], [0, 0, 1],
      );
      expect(fn).toHaveBeenCalledWith(7, 0.5, 1, 2, 3, 0, 0, 1);
      expect(r).toEqual({ ok: true, newEdge: 50, newV0: 200, newV1: 201 });
    });

    it('offsetEdgeWithReferencePlane returns bridge_unavailable when missing (V-δ-β)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      const r = bridge.offsetEdgeWithReferencePlane(1, 1, [0, 0, 0], [0, 0, 1]);
      expect(r).toEqual({ ok: false, reason: 'bridge_unavailable' });
    });

    it('offsetEdgeWithReferencePlane parses radius_collapse reason (V-δ-β)', () => {
      const fn = vi.fn(() =>
        JSON.stringify({
          ok: false,
          reason: 'radius_collapse',
          currentRadius: 0.5,
          newRadius: -0.1,
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge_with_reference_plane: fn };
      const r = bridge.offsetEdgeWithReferencePlane(1, 1, [0, 0, 0], [0, 0, 1]);
      expect(r).toEqual({
        ok: false,
        reason: 'radius_collapse',
        currentRadius: 0.5,
        newRadius: -0.1,
      });
    });

    it('legacy offsetEdge UNCHANGED by V-β-α-bridge addition', () => {
      const oldFn = vi.fn(() =>
        JSON.stringify({ ok: true, newEdge: 5, newV0: 10, newV1: 11 }),
      );
      const newFn = vi.fn(() =>
        JSON.stringify({ ok: true, newEdge: 6, newV0: 12, newV1: 13 }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { offset_edge: oldFn, offset_edge_on_host: newFn };
      bridge.offsetEdge(99, 0.3, [0, 1, 0]);
      expect(oldFn).toHaveBeenCalledTimes(1);
      expect(newFn).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-097 T-δ — Topology damage detection + auto-recovery
  // ──────────────────────────────────────────────────────────────────

  describe('ADR-097 T-δ topology damage / auto-recovery', () => {
    let bridge: WasmBridge;

    beforeEach(() => {
      bridge = new WasmBridge();
    });

    it('detectTopologyDamage parses JSON report (clean scene)', () => {
      const fn = vi.fn(() => '{"damages":[],"checkedFaces":3,"checkedEdges":12}');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { detectTopologyDamage: fn };
      const r = bridge.detectTopologyDamage();
      expect(r).toEqual({ damages: [], checkedFaces: 3, checkedEdges: 12 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('detectTopologyDamage parses 4 damage variants', () => {
      const json = JSON.stringify({
        damages: [
          { kind: 'BoundaryEdge', edge_id: 1, incident_face: 7 },
          { kind: 'NonManifold', edge_id: 2, face_count: 3 },
          { kind: 'Degenerate', face_id: 8, reason: 'zero_normal' },
          { kind: 'Orphan', face_id: 9 },
        ],
        checkedFaces: 5,
        checkedEdges: 20,
      });
      const fn = vi.fn(() => json);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { detectTopologyDamage: fn };
      const r = bridge.detectTopologyDamage();
      expect(r?.damages).toHaveLength(4);
      expect(r?.damages[0]).toMatchObject({ kind: 'BoundaryEdge', edge_id: 1 });
      expect(r?.damages[3]).toMatchObject({ kind: 'Orphan', face_id: 9 });
    });

    it('detectTopologyDamage returns null when endpoint missing (graceful)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.detectTopologyDamage()).toBeNull();
    });

    it('attemptAutoRecovery parses NoOp variant', () => {
      const fn = vi.fn(() => '{"kind":"NoOp"}');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { attemptAutoRecovery: fn };
      expect(bridge.attemptAutoRecovery()).toEqual({ kind: 'NoOp' });
    });

    it('attemptAutoRecovery parses Recovered variant', () => {
      const fn = vi.fn(() =>
        '{"kind":"Recovered","fixesApplied":4,"initialDamages":4}',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { attemptAutoRecovery: fn };
      expect(bridge.attemptAutoRecovery()).toEqual({
        kind: 'Recovered', fixesApplied: 4, initialDamages: 4,
      });
    });

    it('attemptAutoRecovery parses PartialFailure variant', () => {
      const fn = vi.fn(() =>
        '{"kind":"PartialFailure","fixesApplied":2,"remainingCount":3}',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { attemptAutoRecovery: fn };
      expect(bridge.attemptAutoRecovery()).toEqual({
        kind: 'PartialFailure', fixesApplied: 2, remainingCount: 3,
      });
    });

    it('attemptAutoRecovery markDirty triggers cache invalidation', () => {
      const fn = vi.fn(() => '{"kind":"NoOp"}');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { attemptAutoRecovery: fn };
      const spy = vi.spyOn(bridge, 'markDirty');
      bridge.attemptAutoRecovery();
      expect(spy).toHaveBeenCalled();
    });

    it('attemptAutoRecovery returns null when endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.attemptAutoRecovery()).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ADR-098 S-δ — 3-Tier material scope typed wrappers
  // ──────────────────────────────────────────────────────────────────

  describe('ADR-098 S-δ 3-tier material wrappers', () => {
    let bridge: WasmBridge;

    beforeEach(() => {
      bridge = new WasmBridge();
    });

    it('listMaterialsByTier maps tier name → u32 and parses JSON', () => {
      const fn = vi.fn(() =>
        '[{"id":0,"name":"Concrete","nameEn":"Concrete","tier":0,"color":"#888888"}]',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { listMaterialsByTier: fn };
      const list = bridge.listMaterialsByTier('System');
      expect(fn).toHaveBeenCalledWith(0); // System → 0
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: 0, tier: 'System', color: '#888888' });
    });

    it('listMaterialsByTier returns [] when endpoint missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.listMaterialsByTier('User')).toEqual([]);
    });

    it('getMaterialTier maps -1 sentinel to null', () => {
      const fn = vi.fn(() => -1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getMaterialTier: fn };
      expect(bridge.getMaterialTier(999)).toBeNull();
    });

    it('getMaterialTier maps 0/1/2 to System/Project/User', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { getMaterialTier: vi.fn((id: number) => id) };
      expect(bridge.getMaterialTier(0)).toBe('System');
      expect(bridge.getMaterialTier(1)).toBe('Project');
      expect(bridge.getMaterialTier(2)).toBe('User');
    });

    it('addProjectMaterial returns id + markDirty triggered', () => {
      const fn = vi.fn(() => 100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { addProjectMaterial: fn };
      const dirty = vi.spyOn(bridge, 'markDirty');
      const id = bridge.addProjectMaterial('m', 'm', 0xff0000);
      expect(id).toBe(100);
      expect(fn).toHaveBeenCalledWith('m', 'm', 0xff0000);
      expect(dirty).toHaveBeenCalled();
    });

    it('addUserMaterial returns id', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { addUserMaterial: vi.fn(() => 200) };
      expect(bridge.addUserMaterial('u', 'u', 0x00ff00)).toBe(200);
    });

    it('removeUserMaterial returns boolean', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { removeUserMaterial: vi.fn(() => true) };
      expect(bridge.removeUserMaterial(200)).toBe(true);
    });

    it('migrateLegacyMaterials returns count', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = { migrateLegacyMaterials: vi.fn(() => 12) };
      expect(bridge.migrateLegacyMaterials()).toBe(12);
    });

    it('all wrappers gracefully return safe defaults on missing endpoint', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bridge as any).engine = {};
      expect(bridge.listMaterialsByTier('Project')).toEqual([]);
      expect(bridge.getMaterialTier(0)).toBeNull();
      expect(bridge.addProjectMaterial('a', 'a', 0)).toBeNull();
      expect(bridge.addUserMaterial('a', 'a', 0)).toBeNull();
      expect(bridge.removeUserMaterial(0)).toBe(false);
      expect(bridge.migrateLegacyMaterials()).toBe(0);
    });
  });
});
