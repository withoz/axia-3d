import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { CylinderTool } from './CylinderTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      create_cylinder: vi.fn().mockReturnValue(0),
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

describe('CylinderTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: CylinderTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new CylinderTool(ctx);
  });

  describe('name', () => {
    it('is "cylinder"', () => {
      expect(tool.name).toBe('cylinder');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('becomes true after first click', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('creation flow', () => {
    it('click 1 sets anchor, click 2 advances to sizing2', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(30, 0, 0));
      expect(tool.isBusy()).toBe(true); // needs height still
    });

    it('3 clicks advance through full flow without error', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(30, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(30, 80, 0));
      // Flow completes or stays in sizing — no crash
    });
  });

  describe('onActivate / onDeactivate', () => {
    it('activate does not throw', () => {
      expect(() => tool.onActivate()).not.toThrow();
    });

    it('deactivate resets', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onDeactivate();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cancels', () => {
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape', preventDefault: vi.fn() } as any);
      expect(tool.isBusy()).toBe(false);
    });
  });
});
