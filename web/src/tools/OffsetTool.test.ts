import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { OffsetTool } from './OffsetTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      offsetFace: vi.fn().mockReturnValue({ ok: true, innerFace: 10 }),
      offsetEdge: vi.fn().mockReturnValue({ ok: true, newEdge: 20 }),
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      getFaceNormal: vi.fn().mockReturnValue(new Float32Array([0, 1, 0])),
      getEdgeLines: vi.fn().mockReturnValue(null),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      pick: vi.fn().mockReturnValue(null),
      pickEdge: vi.fn().mockReturnValue(null),
      renderer: {
        domElement: {
          style: { cursor: '' },
          getBoundingClientRect: () => ({
            left: 0, top: 0, width: 800, height: 600,
          }),
        },
      },
    },
    selection: {
      handleClick: vi.fn(),
      clearSelection: vi.fn(),
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('10.0 mm') },
    getFaceId: vi.fn().mockReturnValue(-1),
    getSelectedFaces: vi.fn().mockReturnValue([]),
    getGroundPoint: vi.fn().mockReturnValue(null),
    extractFaceBoundary: vi.fn().mockReturnValue([]),
    pickBox: null,
    edgeMap: null,
  } as any;
}

describe('OffsetTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: OffsetTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new OffsetTool(ctx);
  });

  describe('name', () => {
    it('is "offset"', () => {
      expect(tool.name).toBe('offset');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onActivate', () => {
    it('sets cursor to none', () => {
      tool.onActivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('none');
    });
  });

  describe('onDeactivate', () => {
    it('restores cursor and resets state', () => {
      tool.onActivate();
      tool.onDeactivate();
      expect(ctx.viewport.renderer.domElement.style.cursor).toBe('');
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('onMouseDown - phase 0 (object selection)', () => {
    it('does nothing when no face or edge hit', () => {
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });

    it('selects face and enters phase 1', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 2,
        point: new THREE.Vector3(10, 0, 10),
      });
      ctx.getFaceId.mockReturnValue(5);

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
      expect(ctx.selection.handleClick).toHaveBeenCalledWith(5, false, false);
    });

    it('falls back to selected face', () => {
      ctx.viewport.pick.mockReturnValue(null);
      ctx.getSelectedFaces.mockReturnValue([3]);
      ctx.bridge.facesCentroid.mockReturnValue(new THREE.Vector3(0, 0, 0));

      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);
    });
  });

  describe('onKeyDown', () => {
    it('Escape cancels', () => {
      // Enter phase 1
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when idle', () => {
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('applyVCBValue', () => {
    it('stores distance when in phase 0', () => {
      tool.applyVCBValue(25);
      // Should not throw, stores for later use
      expect(tool.isBusy()).toBe(false);
    });

    it('applies face offset when in phase 1 with face selected', () => {
      // Select face
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(3);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(true);

      // Apply VCB
      tool.applyVCBValue(50);
      expect(ctx.bridge.offsetFace).toHaveBeenCalledWith(3, 50);
      expect(ctx.syncMesh).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('resets all state', () => {
      ctx.viewport.pick.mockReturnValue({
        faceIndex: 0,
        point: new THREE.Vector3(0, 0, 0),
      });
      ctx.getFaceId.mockReturnValue(1);
      tool.onMouseDown({ clientX: 100, clientY: 100 } as MouseEvent, null);

      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
      expect(ctx.selection.clearSelection).toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('does nothing in phase 0 without pickBox', () => {
      tool.onMouseMove({ clientX: 200, clientY: 200 } as MouseEvent, null);
      // Should not throw
    });
  });
});
