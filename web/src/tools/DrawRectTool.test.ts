import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawRectTool } from './DrawRectTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      drawRect: vi.fn().mockReturnValue(0),
      drawRectAsShape: vi.fn().mockReturnValue(0),
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

describe('DrawRectTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: DrawRectTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new DrawRectTool(ctx);
  });

  describe('name', () => {
    it('is "rect"', () => {
      expect(tool.name).toBe('rect');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown - first click', () => {
    it('sets start point and enters busy state', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
      expect(ctx.getDrawPlane).toHaveBeenCalled();
      expect(ctx.snap.setReferencePoint).toHaveBeenCalled();
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
  // ADR-087 K-ε — kernel-aware drawRectAsShape only path.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-087 K-ε kernel-aware dispatch', () => {
    it('VCB path always calls bridge.drawRectAsShape (Plane attach)', () => {
      tool.applyVCBValue(100, 200);

      expect(ctx.bridge.drawRectAsShape).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.drawRect).not.toHaveBeenCalled();
    });
  });
});
