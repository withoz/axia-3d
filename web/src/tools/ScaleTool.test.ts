import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ScaleTool } from './ScaleTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      scaleFaces: vi.fn(),
      translateVerts: vi.fn(),
      getEdgeEndpoints: vi.fn().mockReturnValue([] as number[]),
      getVertexPos: vi.fn().mockReturnValue([0, 0, 0] as [number, number, number]),
    },
    viewport: {
      activeCamera: new THREE.PerspectiveCamera(),
    },
    selection: {
      getSelectedEdges: vi.fn().mockReturnValue([]),
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

    it('does nothing when nothing selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
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

    it('does nothing when nothing selected', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      tool.applyVCBValue(2);
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
      expect(ctx.bridge.translateVerts).not.toHaveBeenCalled();
    });

    it('does nothing when centroid is null', () => {
      ctx.bridge.facesCentroid.mockReturnValue(null);
      tool.applyVCBValue(2);
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
    });
  });

  describe('edge scaling', () => {
    beforeEach(() => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10, 20]);
      ctx.bridge.getEdgeEndpoints.mockImplementation((eid: number) => {
        if (eid === 10) return [1, 2];
        if (eid === 20) return [2, 3];
        return [];
      });
      ctx.bridge.getVertexPos.mockImplementation((v: number) => {
        if (v === 1) return [0, 0, 0];
        if (v === 2) return [10, 0, 0];
        if (v === 3) return [0, 0, 10];
        return null;
      });
    });

    it('VCB ×2 from centroid moves each vert via translateVerts', () => {
      // centroid ≈ (10/3, 0, 10/3)
      tool.applyVCBValue(2);
      expect(ctx.bridge.scaleFaces).not.toHaveBeenCalled();
      // Each vert gets its own translateVerts call
      const calls = (ctx.bridge.translateVerts as any).mock.calls;
      expect(calls.length).toBe(3);
      // For vert 1 at (0,0,0), delta = (0-10/3)*(2-1) = -10/3
      const call1 = calls.find((c: any[]) => c[0][0] === 1)!;
      expect(call1[1]).toBeCloseTo(-10 / 3, 2);
    });

    it('scale 1.0 skips zero-delta calls', () => {
      tool.applyVCBValue(1);
      expect(ctx.bridge.translateVerts).not.toHaveBeenCalled();
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
