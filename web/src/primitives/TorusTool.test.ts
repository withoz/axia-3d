import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { TorusTool } from './TorusTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      create_torus: vi.fn().mockReturnValue(0),
      getConnectedFaces: vi.fn().mockReturnValue([0]),
      createGroup: vi.fn().mockReturnValue(1),
      undo: vi.fn(),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
    },
    syncMesh: vi.fn(),
    selection: {
      clearSelection: vi.fn(),
      selectFaces: vi.fn(),
    },
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('100mm') },
    getGroundPoint: vi.fn().mockReturnValue(null),
    snap: {
      setReferencePoint: vi.fn(),
      getSnap: vi.fn().mockReturnValue(null),
    },
  } as any;
}

describe('TorusTool — ADR-115/116 Path B primitive UI', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: TorusTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new TorusTool(ctx);
  });

  describe('name', () => {
    it('is "torus"', () => {
      expect(tool.name).toBe('torus');
    });
  });

  describe('isBusy', () => {
    it('defaults to false (idle)', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('becomes true after first click (sizing1)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('creation flow (3-click: anchor → major → minor)', () => {
    it('sizing2 after second click (torus requires both major + minor)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      // After 2nd click, must be sizing2 (minor radius)
      expect((tool as any).session.state).toBe('sizing2');
    });

    it('full 3-click flow creates torus + auto-groups', () => {
      // Click 1: anchor
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      // Move sets major radius = 100
      tool.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));
      // Click 2: confirm major → sizing2
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      // Move sets minor radius = 30 (distance from anchor along axis or just any < major)
      // Note: BasePrimitiveTool computes minor via axis dot product from anchor.
      // For unit test, manually set the param to bypass geometry math.
      (tool as any).session.params.height = 30;
      // Click 3: confirm minor → done → commit
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 30));

      expect(ctx.bridge.create_torus).toHaveBeenCalledWith(0, 0, 0, 100, 30);
      // Auto-group called
      expect(ctx.bridge.createGroup).toHaveBeenCalled();
    });
  });

  describe('engine validation (minor >= major rejection)', () => {
    it('does NOT call WASM when minor_radius >= major_radius', () => {
      // Set up full session with invalid radii (minor >= major)
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent, new THREE.Vector3(50, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(50, 0, 0));
      // Force minor (height) ≥ major (radius)
      (tool as any).session.params.height = 60;
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 60));

      // Tool-side guard rejects before WASM call.
      expect(ctx.bridge.create_torus).not.toHaveBeenCalled();
    });
  });

  describe('onActivate / onDeactivate', () => {
    it('activate does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('deactivate cleans up', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onDeactivate();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cancels and returns to idle', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape', preventDefault: vi.fn() } as any);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('ADR-116 ζ — graceful no-op when bridge.create_torus missing', () => {
    it('does not throw when WASM endpoint missing (legacy build)', () => {
      ctx.bridge.create_torus = undefined as any;
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseMove({ clientX: 0, clientY: 0 } as MouseEvent, new THREE.Vector3(50, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(50, 0, 0));
      (tool as any).session.params.height = 20;
      expect(() => {
        tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 20));
      }).not.toThrow();
    });
  });
});
