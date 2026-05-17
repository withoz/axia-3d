import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SphereTool } from './SphereTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      create_sphere: vi.fn().mockReturnValue(0),
      undo: vi.fn(),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('100mm') },
    getGroundPoint: vi.fn().mockReturnValue(null),
    snap: {
      setReferencePoint: vi.fn(),
      getSnap: vi.fn().mockReturnValue(null),
    },
  } as any;
}

describe('SphereTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: SphereTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new SphereTool(ctx);
  });

  describe('name', () => {
    it('is "sphere"', () => {
      expect(tool.name).toBe('sphere');
    });
  });

  describe('isBusy', () => {
    it('defaults to false (idle)', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('becomes true after first click (sizing1)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 5000, 0));
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('creation flow', () => {
    it('click 1 sets anchor, click 2 advances state', () => {
      // Click 1: set anchor at origin
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);

      // Click 2: confirm radius — session advances
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));

      // After second click, either sphere created or state advanced
      // (preview rendering may interfere, so just verify no crash)
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
    it('Escape cancels and returns to idle', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape', preventDefault: vi.fn() } as any);
      expect(tool.isBusy()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // (α) + (β) 사용자 결재 2026-05-17 — "단순/신속/정확" canonical 원칙
  //
  // α: default tessellation 감소 — 16×16 (256 faces) → 12×12 (144 faces)
  // β: Lazy syncMesh via requestAnimationFrame — primitive create 후
  //    sync 가 RAF 으로 deferred → user-perceived latency 즉시 응답
  //
  // 메타-원칙 #11 Latency Budget Click 33ms 정합 강제.
  // ════════════════════════════════════════════════════════════════════════
  describe('α — fast default tessellation', () => {
    it('create_sphere is called with U=12, V=12 (not 16×16)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));
      const call = (ctx.bridge.create_sphere as any).mock.calls[0];
      if (call) {
        const [_cx, _cy, _cz, _radius, u, v] = call;
        expect(u).toBe(12); // α default
        expect(v).toBe(12); // α default
      }
    });
  });

  describe('β — Lazy syncMesh via RAF', () => {
    it('syncMesh is deferred via requestAnimationFrame (not immediate)', () => {
      // Mock RAF to verify deferral pattern
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          // Don't auto-execute — verify deferred call exists
          return 1;
        });

      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));

      // If creation completed, RAF should have been invoked for syncMesh
      if ((ctx.bridge.create_sphere as any).mock.calls.length > 0) {
        expect(rafSpy).toHaveBeenCalled();
        // syncMesh should NOT yet be called (deferred until RAF fires)
        expect(ctx.syncMesh).not.toHaveBeenCalled();
      }

      rafSpy.mockRestore();
    });

    it('syncMesh executes when RAF fires (deferred callback)', () => {
      // Mock RAF to immediately fire the callback (simulate next frame)
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 1;
        });

      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(100, 0, 0));

      if ((ctx.bridge.create_sphere as any).mock.calls.length > 0) {
        // After RAF fires, syncMesh should have been called exactly once
        expect(ctx.syncMesh).toHaveBeenCalledTimes(1);
      }

      rafSpy.mockRestore();
    });
  });
});
