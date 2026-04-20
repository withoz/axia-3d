import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { RotateTool } from './RotateTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      rotateFaces: vi.fn(),
    },
    viewport: {
      activeCamera: new THREE.PerspectiveCamera(),
    },
    getSelectedFaces: vi.fn().mockReturnValue([1, 2, 3]),
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    snap: { setReferencePoint: vi.fn() },
    axisLock: null as string | null,
    inferredAxis: null as string | null,
  } as any;
}

describe('RotateTool (CAD 3-click style)', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: RotateTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new RotateTool(ctx);
  });

  describe('name', () => {
    it('is "rotate"', () => {
      expect(tool.name).toBe('rotate');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('is true after onActivate when faces selected', () => {
      tool.onActivate();
      expect(tool.isBusy()).toBe(true);
    });

    it('stays false when activating without selection', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.onActivate();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('CAD 3-click flow', () => {
    it('pick-base → pick-reference → pick-target sequence', () => {
      tool.onActivate(); // pick-base phase
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0)); // base
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0)); // reference
      // Now in pick-target — mouseMove applies rotation
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10)); // 90°
      expect(ctx.bridge.rotateFaces).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('3rd click commits and returns to idle', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when point is null', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, null);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('applyVCBValue', () => {
    it('legacy path — rotates around centroid when idle', () => {
      tool.applyVCBValue(45);
      expect(ctx.bridge.rotateFaces).toHaveBeenCalledWith(
        [1, 2, 3], 0, 0, 0, 0, 1, 0, 45
      );
    });

    it('CAD path — applies angle when in pick-target phase', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false); // cleanup after VCB
    });

    it('does nothing when no faces selected in idle', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('Escape', () => {
    it('cleans up from any phase', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });
});
