import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawLineTool } from './DrawLineTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), show: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      drawLine: vi.fn().mockReturnValue(0),
      faceCount: vi.fn().mockReturnValue(0),
      splitFaceByLine: vi.fn().mockReturnValue('{"faces":[10,11],"verts":[5],"edges":1}'),
      pointInFace: vi.fn().mockReturnValue(false),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        },
      },
      pick: vi.fn().mockReturnValue(null),
      container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    },
    selection: {
      clearSelection: vi.fn(),
      selectFaces: vi.fn(),
    },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('100mm') },
    snap: {
      setReferencePoint: vi.fn(),
      getSnap: vi.fn().mockReturnValue(null),
      saveSnapConfig: vi.fn().mockReturnValue(new Set()),
      restoreSnapConfig: vi.fn(),
      applyFaceCreationPreset: vi.fn(),
    },
    snapVisual: { update: vi.fn(), clear: vi.fn() },
    clearAxisGuide: vi.fn(),
    updateAxisGuide: vi.fn(),
    getSelectedFaces: vi.fn().mockReturnValue([]),
    getFaceId: vi.fn().mockReturnValue(-1),
    get3DPoint: vi.fn(),
    getGroundPoint: vi.fn(),
    getSnappedPoint: vi.fn().mockReturnValue(null),
    getAxisInferredPoint: vi.fn().mockReturnValue(null),
    axisLock: null as string | null,
    inferredAxis: 'free' as string | null,
    faceMap: new Uint32Array([0, 1, 2]),
  } as any;
}

describe('DrawLineTool', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: DrawLineTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new DrawLineTool(ctx);
  });

  describe('name', () => {
    it('is "line"', () => {
      expect(tool.name).toBe('line');
    });
  });

  describe('state machine', () => {
    it('starts in Idle', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('onActivate transitions Idle → Armed', () => {
      tool.onActivate();
      expect(tool.isBusy()).toBe(false); // Armed is not busy
    });

    it('first click transitions Armed → Drawing', () => {
      tool.onActivate(); // → Armed
      // Simulate click with button=0
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 0));
      expect(tool.isBusy()).toBe(true); // Drawing
    });

    it('Escape from Armed → Idle', () => {
      tool.onActivate();
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });

    it('Escape from Drawing → Idle', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3());
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('line creation', () => {
    it('second click creates line via bridge', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));

      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(0, 0, 0, 100, 0, 0, 0, 1, 0);
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('continuous mode: stays in Drawing after confirm', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));
      // After confirm, should be back in Drawing (continuous)
      expect(tool.isBusy()).toBe(true);
    });

    it('ignores very short lines (< 1 unit)', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0.5, 0, 0));
      expect(ctx.bridge.drawLine).not.toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('does nothing when not in Drawing state', () => {
      tool.onActivate(); // Armed
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(50, 0, 0));
      // No preview updates in Armed state
    });
  });

  describe('right click', () => {
    it('cancels drawing', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3());
      expect(tool.isBusy()).toBe(true);

      tool.onMouseDown({ button: 2 } as MouseEvent, null);
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('applyVCBValue', () => {
    it('creates line along x axis by default', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.applyVCBValue(500);
      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(0, 0, 0, 500, 0, 0, 0, 1, 0);
    });

    it('does nothing when not in Drawing state', () => {
      tool.applyVCBValue(500);
      expect(ctx.bridge.drawLine).not.toHaveBeenCalled();
    });
  });

  describe('face split', () => {
    it('calls splitFaceByLine when both clicks are on the same face', () => {
      // Setup: viewport.pick returns a face, getFaceId returns the same face ID
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2, point: new THREE.Vector3(50, 0, 50) });
      ctx.getFaceId.mockReturnValue(7);

      tool.onActivate(); // → Armed
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      // Now in Drawing, startFaceId=7

      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));
      // endFaceId=7, same as startFaceId → should call splitFaceByLine

      expect(ctx.bridge.splitFaceByLine).toHaveBeenCalledWith(
        7,
        [10, 0, 10],
        [90, 0, 90],
      );
      expect(ctx.bridge.drawLine).not.toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('falls back to drawLine when face split returns error', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(7);
      ctx.bridge.splitFaceByLine.mockReturnValue('{"error":"no boundary intersection"}');

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      // splitFaceByLine was called but returned error → fallback to drawLine
      expect(ctx.bridge.splitFaceByLine).toHaveBeenCalled();
      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(10, 0, 10, 90, 0, 90, 0, 1, 0);
    });

    it('falls back to drawLine when splitFaceByLine throws', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(7);
      ctx.bridge.splitFaceByLine.mockImplementation(() => { throw new Error('not available'); });

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(10, 0, 10, 90, 0, 90, 0, 1, 0);
    });

    it('uses regular drawLine when start and end are on different faces', () => {
      let callCount = 0;
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 7 : 8; // Different face IDs
      });

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      expect(ctx.bridge.splitFaceByLine).not.toHaveBeenCalled();
      expect(ctx.bridge.drawLine).toHaveBeenCalled();
    });

    it('uses regular drawLine when clicking on empty space (no face)', () => {
      ctx.viewport.pick.mockReturnValue(null); // No face hit

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      expect(ctx.bridge.splitFaceByLine).not.toHaveBeenCalled();
      expect(ctx.bridge.drawLine).toHaveBeenCalled();
    });

    it('returns to Armed after successful face split', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(7);

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      // Face split succeeded → should NOT be in Drawing (continuous) mode
      expect(tool.isBusy()).toBe(false); // Armed, not Drawing
      expect(tool.getStateName()).toBe('Armed');
    });
  });

  describe('cleanup', () => {
    it('transitions to Idle', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3());
      tool.cleanup();
      expect(tool.isBusy()).toBe(false);
    });
  });
});
