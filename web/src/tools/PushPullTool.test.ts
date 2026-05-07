import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { PushPullTool } from './PushPullTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn(), debugWarn: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      pushPull: vi.fn().mockReturnValue(true),
      createSolidExtrude: vi.fn().mockReturnValue(true),
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 5, 0)),
      getFaceNormal: vi.fn().mockReturnValue(new Float32Array([0, 1, 0])),
      engine: {
        push_pull_smooth_group_seamless: vi.fn().mockReturnValue(true),
      },
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      pick: vi.fn().mockReturnValue(null),
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({
            left: 0, top: 0, width: 800, height: 600,
          }),
        },
      },
    },
    selection: {
      handleClick: vi.fn(),
      clearSelection: vi.fn(),
      getSmoothGroup: vi.fn().mockReturnValue([]),
      selectFaces: vi.fn(),
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    snap: {
      findAlignedDistance: vi.fn().mockReturnValue(null),
    },
    snapVisual: {
      update: vi.fn(),
      clear: vi.fn(),
    },
    units: { format: vi.fn().mockReturnValue('10.0 mm') },
    getFaceId: vi.fn().mockReturnValue(-1),
    getSelectedFaces: vi.fn().mockReturnValue([]),
    extractFaceBoundary: vi.fn().mockReturnValue([]),
  } as any;
}

describe('PushPullTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: PushPullTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new PushPullTool(ctx);
  });

  describe('name', () => {
    it('is "pushpull"', () => {
      expect(tool.name).toBe('pushpull');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onActivate / onDeactivate', () => {
    it('activate does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('deactivate cleans up', () => {
      tool.onDeactivate();
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });

  describe('onMouseDown - phase 1 (face selection)', () => {
    it('does nothing when no face hit', () => {
      ctx.viewport.pick.mockReturnValue(null);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });

    it('selects face from viewport pick', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 2,
        point: new THREE.Vector3(10, 5, 10),
      });
      ctx.getFaceId.mockReturnValue(5);

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false);
    });

    it('falls back to selected face when pick misses', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.getSelectedFaces.mockReturnValue([3]);
      ctx.bridge.facesCentroid.mockReturnValue(new THREE.Vector3(0, 10, 0));

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });

    it('detects smooth group', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 2,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(5);
      ctx.selection.getSmoothGroup.mockReturnValue([5, 6, 7]);

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cancels active push/pull', () => {
      // Start a session
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when not active', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('applyVCBValue', () => {
    it('applies push/pull via VCB on selected face', () => {
      ctx.getSelectedFaces.mockReturnValue([5]);

      tool.applyVCBValue(100);

      // ADR-087 K-ε — kernel-aware createSolidExtrude only path.
      expect(ctx.bridge.createSolidExtrude).toHaveBeenCalledWith(5, 100);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when no face selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);

      tool.applyVCBValue(100);
      expect(ctx.bridge.createSolidExtrude).not.toHaveBeenCalled();
    });

    it('cleans up after VCB apply', () => {
      ctx.getSelectedFaces.mockReturnValue([3]);
      tool.applyVCBValue(50);
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('resets all state', () => {
      // Start a session
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('does nothing when not active', () => {
      tool.onMouseMove({ clientX: 200, clientY: 200 } as MouseEvent, null);
      // Should not throw
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-087 K-ε — kernel-aware createSolidExtrude only path (Q3 fallback
  // to push_pull is now Rust-side, not exposed to TS).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-087 K-ε kernel-aware dispatch', () => {
    it('always calls bridge.createSolidExtrude (single face)', () => {
      ctx.getSelectedFaces.mockReturnValue([7]);
      tool.applyVCBValue(150);

      expect(ctx.bridge.createSolidExtrude).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.createSolidExtrude).toHaveBeenCalledWith(7, 150);
      expect(ctx.bridge.pushPull).not.toHaveBeenCalled();
    });

    it('smooth group fallback → createSolidExtrude per-face', () => {
      // Force smooth-group fallback path: seamless returns false.
      ctx.bridge.engine.push_pull_smooth_group_seamless.mockReturnValue(false);

      ctx.getSelectedFaces.mockReturnValue([3]);
      tool.applyVCBValue(50);

      expect(ctx.bridge.createSolidExtrude).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.createSolidExtrude).toHaveBeenCalledWith(3, 50);
      expect(ctx.bridge.pushPull).not.toHaveBeenCalled();
    });
  });
});
