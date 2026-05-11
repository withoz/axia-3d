import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawCircleTool } from './DrawCircleTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      drawCircle: vi.fn().mockReturnValue(0),
      drawCircleAsShape: vi.fn().mockReturnValue(0),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({
            left: 0, top: 0, right: 800, bottom: 600,
            width: 800, height: 600,
          }),
        },
      },
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('100mm') },
    snap: {
      setReferencePoint: vi.fn(),
    },
    getDrawPlane: vi.fn().mockReturnValue({
      normal: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 0, 1),
      origin: new THREE.Vector3(0, 0, 0),
    }),
  } as any;
}

describe('DrawCircleTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: DrawCircleTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new DrawCircleTool(ctx);
  });

  describe('name', () => {
    it('is "circle"', () => {
      expect(tool.name).toBe('circle');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown - first click', () => {
    it('sets center point', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 10));
      expect(tool.isBusy()).toBe(true);
      expect(ctx.getDrawPlane).toHaveBeenCalled();
    });

    it('does nothing when point is null', () => {
      tool.onMouseDown({} as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
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
    it('Escape cancels drawing', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('resets state', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-087 K-ε / ADR-089 A-π-β — VCB dispatch (default ON, explicit OFF preserved)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-089 A-π-β VCB dispatch (default ON)', () => {
    beforeEach(() => {
      // Provide both kernel-aware methods on bridge mock
      ctx.bridge.drawCircleAsCurve = vi.fn().mockReturnValue(0);
    });

    it('VCB default path calls bridge.drawCircleAsCurve (kernel-native)', async () => {
      const { setDrawCurveMode } = await import('./DrawCurveSettings');
      setDrawCurveMode(true); // explicit ON (default after A-π-β)

      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.applyVCBValue(50);

      expect(ctx.bridge.drawCircleAsCurve).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.drawCircleAsShape).not.toHaveBeenCalled();
    });

    it('VCB explicit OFF path calls bridge.drawCircleAsShape (legacy ADR-087 K-ε)', async () => {
      const { setDrawCurveMode } = await import('./DrawCurveSettings');
      setDrawCurveMode(false); // L-π-2 — explicit OFF preference

      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.applyVCBValue(50);

      expect(ctx.bridge.drawCircleAsShape).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.drawCircleAsCurve).not.toHaveBeenCalled();
      expect(ctx.bridge.drawCircle).not.toHaveBeenCalled();
    });
  });
});
