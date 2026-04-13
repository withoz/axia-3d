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
    default: vi.fn().mockResolvedValue(undefined),
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
});
