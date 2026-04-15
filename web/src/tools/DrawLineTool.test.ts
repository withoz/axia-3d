import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawLineTool, LineDrawState } from './DrawLineTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      drawLine: vi.fn().mockReturnValue(0),
      faceCount: vi.fn().mockReturnValue(0),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        },
      },
    },
    selection: { clearSelection: vi.fn() },
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn().mockReturnValue('100mm') },
    snap: {
      setReferencePoint: vi.fn(),
      getSnap: vi.fn().mockReturnValue(null),
    },
    clearAxisGuide: vi.fn(),
    getSelectedFaces: vi.fn().mockReturnValue([]),
    get3DPoint: vi.fn(),
    getGroundPoint: vi.fn(),
    getSnappedPoint: vi.fn().mockReturnValue(null),
    getAxisInferredPoint: vi.fn().mockReturnValue(null),
    axisLock: null as string | null,
    inferredAxis: 'free' as string | null,
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

      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(0, 0, 0, 100, 0, 0);
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
      expect(ctx.bridge.drawLine).toHaveBeenCalledWith(0, 0, 0, 500, 0, 0);
    });

    it('does nothing when not in Drawing state', () => {
      tool.applyVCBValue(500);
      expect(ctx.bridge.drawLine).not.toHaveBeenCalled();
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
