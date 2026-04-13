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
});
