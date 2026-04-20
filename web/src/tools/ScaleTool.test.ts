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
    it('applies real-time scale and updates dim label during drag (Phase 1 #4)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      // 실시간 프리뷰: scaleFaces 즉시 호출
      expect(ctx.bridge.scaleFaces).toHaveBeenCalledWith(
        [1, 2], 0, 0, 0, 2, 2, 2
      );
      expect(ctx.dimLabel.update).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('applies incremental scale on subsequent moves', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0)); // ×2
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(30, 0, 0)); // target ×3 (×2 이미 적용됨)
      // 2번째 호출은 incremental ×1.5
      const calls = (ctx.bridge.scaleFaces as any).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[1][4]).toBeCloseTo(1.5, 2);
    });

    it('does nothing when not active', () => {
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
    });
  });

  describe('onMouseUp', () => {
    it('ends drag and clears state', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(20, 0, 0));
      tool.onMouseUp({} as MouseEvent);
      expect(tool.isBusy()).toBe(false);
      expect(ctx.dimLabel.clear).toHaveBeenCalled();
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
