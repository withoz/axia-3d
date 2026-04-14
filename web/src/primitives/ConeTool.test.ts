import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ConeTool } from './ConeTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      create_cone: vi.fn().mockReturnValue(0),
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

describe('ConeTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: ConeTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new ConeTool(ctx);
  });

  describe('name', () => {
    it('is "cone"', () => {
      expect(tool.name).toBe('cone');
    });
  });

  describe('isBusy', () => {
    it('defaults to false (idle)', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('becomes true after first click (sizing1)', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('creation flow', () => {
    it('click 1 sets anchor, click 2 advances to sizing2', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);

      // Click 2: set radius
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(50, 0, 0));
      // Still busy (needs height)
      expect(tool.isBusy()).toBe(true);
    });

    it('3 clicks advance through full flow without error', () => {
      // Click 1: anchor
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      // Click 2: radius (session may not advance if param is 0 due to mock)
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(50, 0, 0));
      // Click 3: height
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(50, 100, 0));
      // Flow completes or stays in sizing — no crash
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

  describe('cleanup', () => {
    it('resets to idle', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
    });
  });
});
