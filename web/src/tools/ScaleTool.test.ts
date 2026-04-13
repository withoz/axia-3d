import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ScaleTool } from './ScaleTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      scaleFaces: vi.fn(),
    },
    viewport: {
      activeCamera: new THREE.PerspectiveCamera(),
    },
    getSelectedFaces: vi.fn().mockReturnValue([1, 2]),
    get3DPoint: vi.fn(),
    syncMesh: vi.fn(),
    dimLabel: {
      update: vi.fn(),
      clear: vi.fn(),
    },
  } as any;
}

describe('ScaleTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: ScaleTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new ScaleTool(ctx);
  });

  describe('name', () => {
    it('is "scale"', () => {
      expect(tool.name).toBe('scale');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown', () => {
    it('starts scaling when faces selected', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      expect(tool.isBusy()).toBe(true);
    });

    it('does nothing when no faces selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseMove', () => {
    it('updates dimension label during drag', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      expect(ctx.dimLabel.update).toHaveBeenCalled();
    });

    it('does nothing when not active', () => {
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      expect(ctx.dimLabel.update).not.toHaveBeenCalled();
    });
  });

  describe('onMouseUp', () => {
    it('applies scale on mouse up', () => {
      // Start at distance 10 from centroid
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));

      // End at distance 20 from centroid (scale 2x)
      ctx.get3DPoint.mockReturnValue(new THREE.Vector3(20, 0, 0));
      tool.onMouseUp({} as MouseEvent);

      expect(ctx.bridge.scaleFaces).toHaveBeenCalledWith(
        [1, 2], 0, 0, 0, 2, 2, 2
      );
      expect(ctx.syncMesh).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });

    it('skips scale if ratio near 1.0', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      ctx.get3DPoint.mockReturnValue(new THREE.Vector3(10.005, 0, 0));
      tool.onMouseUp({} as MouseEvent);

      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
    });

    it('does nothing if get3DPoint returns null', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      ctx.get3DPoint.mockReturnValue(null);
      tool.onMouseUp({} as MouseEvent);

      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('applyVCBValue', () => {
    it('scales uniformly', () => {
      tool.applyVCBValue(2.5);
      expect(ctx.bridge.scaleFaces).toHaveBeenCalledWith(
        [1, 2], 0, 0, 0, 2.5, 2.5, 2.5
      );
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when no faces selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.applyVCBValue(2);
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
    });

    it('does nothing when centroid is null', () => {
      ctx.bridge.facesCentroid.mockReturnValue(null);
      tool.applyVCBValue(2);
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('Escape cleans up', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });
});
