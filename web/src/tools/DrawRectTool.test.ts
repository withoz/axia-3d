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
      // ADR-DrawRectTool-rewrite (2026-05-18): cardinal-plane strict
      //   invariant uses viewport.viewMode (not getDrawPlane face-hit) —
      //   the rewrite's core change. State entry (isBusy + reference point)
      //   remains the canonical user-facing contract.
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
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

  // ════════════════════════════════════════════════════════════════════════
  // ADR-178 — Face-aware drawing plane (LOCKED #63 amendment)
  // 사용자 결재 2026-06-01: "rect는 입체면에 작성이 안됌"
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-178 face-aware drawing plane', () => {
    const mkEvent = () => ({ clientX: 100, clientY: 100 } as MouseEvent);

    it('face hit (cardinal +Z at z=200) → face plane, zeroValue=200 (NOT ground 0)', () => {
      ctx.viewport.pick = vi.fn().mockReturnValue({
        faceIndex: 7,
        point: new THREE.Vector3(-60, -60, 200),
      });
      ctx.getFaceId = vi.fn().mockReturnValue(7);
      ctx.bridge.getFaceNormal = vi.fn().mockReturnValue([0, 0, 1]);

      const plane = (tool as any).resolveFacePlane(mkEvent());
      expect(plane).not.toBeNull();
      expect(plane.zeroValue).toBeCloseTo(200);     // on the box top, NOT z=0 ground
      expect(plane.forceCardinal).toBe(true);        // cardinal-aligned face
      expect(plane.zeroAxis).toBe('z');
      expect(plane.normal.z).toBeCloseTo(1);
      expect(ctx.bridge.getFaceNormal).toHaveBeenCalledWith(7);
    });

    it('no face hit → returns null (→ cardinal ground fallback, LOCKED #63 preserved)', () => {
      ctx.viewport.pick = vi.fn().mockReturnValue(null);
      const plane = (tool as any).resolveFacePlane(mkEvent());
      expect(plane).toBeNull();
    });

    it('slanted (non-cardinal) face → forceCardinal false (trusts ray projection)', () => {
      ctx.viewport.pick = vi.fn().mockReturnValue({
        faceIndex: 3,
        point: new THREE.Vector3(10, 5, 3),
      });
      ctx.getFaceId = vi.fn().mockReturnValue(3);
      const n = new THREE.Vector3(0.7, 0, 0.7).normalize();
      ctx.bridge.getFaceNormal = vi.fn().mockReturnValue([n.x, n.y, n.z]);

      const plane = (tool as any).resolveFacePlane(mkEvent());
      expect(plane).not.toBeNull();
      expect(plane.forceCardinal).toBe(false);       // no cardinal axis force
    });

    it('sketch mode → returns null (sketch plane precedence preserved)', () => {
      ctx.getSketchInfo = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1),
        origin: new THREE.Vector3(),
      });
      ctx.viewport.pick = vi.fn().mockReturnValue({
        faceIndex: 7,
        point: new THREE.Vector3(0, 0, 200),
      });
      const plane = (tool as any).resolveFacePlane(mkEvent());
      expect(plane).toBeNull();
    });

    it('degenerate face normal → returns null (no crash, → ground fallback)', () => {
      ctx.viewport.pick = vi.fn().mockReturnValue({
        faceIndex: 7,
        point: new THREE.Vector3(0, 0, 200),
      });
      ctx.getFaceId = vi.fn().mockReturnValue(7);
      ctx.bridge.getFaceNormal = vi.fn().mockReturnValue([0, 0, 0]); // degenerate
      const plane = (tool as any).resolveFacePlane(mkEvent());
      expect(plane).toBeNull();
    });
  });
});
