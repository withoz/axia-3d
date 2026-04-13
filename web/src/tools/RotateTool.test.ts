import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { RotateTool } from './RotateTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

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
    dimLabel: {
      update: vi.fn(),
      clear: vi.fn(),
    },
  } as any;
}

describe('RotateTool', () => {
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
  });

  describe('onMouseDown', () => {
    it('starts rotation when faces selected', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      expect(tool.isBusy()).toBe(true);
    });

    it('does nothing when no faces selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when point is null', () => {
      tool.onMouseDown({} as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseMove', () => {
    it('rotates faces during drag', () => {
      // Start at (10, 0, 0) relative to centroid at origin
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));

      // Move to a different angle (0, 0, 10) = 90 degrees on XZ plane
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));

      expect(ctx.bridge.rotateFaces).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when not active', () => {
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(10, 0, 10));
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('onMouseUp', () => {
    it('ends rotation', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseUp({} as MouseEvent);
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
    });
  });

  describe('applyVCBValue', () => {
    it('rotates around Y axis', () => {
      tool.applyVCBValue(45);
      expect(ctx.bridge.rotateFaces).toHaveBeenCalledWith(
        [1, 2, 3], 0, 0, 0, 0, 1, 0, 45
      );
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('does nothing when no faces selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });

    it('does nothing when centroid is null', () => {
      ctx.bridge.facesCentroid.mockReturnValue(null);
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('Escape cleans up', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });
});
