/**
 * DrawPolygonTool — VCB + form-mode dispatch coverage.
 *
 * ADR-087 K-β: form-mode 활성 시 `bridge.drawCircleAsShape` (Plane attach
 * 자동 부착) 라우팅, 비활성 시 legacy `bridge.drawCircle`. polygon 은
 * N-gon = circle with N segments — 동일 dispatch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawPolygonTool } from './DrawPolygonTool';

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

describe('DrawPolygonTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: DrawPolygonTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new DrawPolygonTool(ctx);
    // Bypass onActivate prompt by setting sides via reflection.
    (tool as any).sides = 6;
  });

  describe('name', () => {
    it('is "polygon"', () => {
      expect(tool.name).toBe('polygon');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-087 K-ε — kernel-aware drawCircleAsShape only path (Polygon = N-gon).
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-087 K-ε kernel-aware dispatch', () => {
    it('VCB path always calls bridge.drawCircleAsShape (Plane attach)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.applyVCBValue(50);

      expect(ctx.bridge.drawCircleAsShape).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.drawCircle).not.toHaveBeenCalled();
      // Polygon uses N segments.
      const args = ctx.bridge.drawCircleAsShape.mock.calls[0];
      expect(args[7]).toBe(6); // sides
    });

    it('different sides (N=8 octagon) preserved through dispatch', () => {
      (tool as any).sides = 8; // octagon
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.applyVCBValue(100);

      expect(ctx.bridge.drawCircleAsShape).toHaveBeenCalledTimes(1);
      const args = ctx.bridge.drawCircleAsShape.mock.calls[0];
      expect(args[7]).toBe(8);
    });
  });
});
