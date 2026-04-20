import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as THREE from 'three';
import { RotateTool } from './RotateTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../ui/Toast', () => ({
  Toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function mockToolContext() {
  return {
    bridge: {
      facesCentroid: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
      rotateFaces: vi.fn(),
      rotateVerts: vi.fn(),
      getEdgeEndpoints: vi.fn().mockReturnValue([] as number[]),
      getVertexPos: vi.fn().mockReturnValue([0, 0, 0] as [number, number, number]),
    },
    viewport: {
      activeCamera: new THREE.PerspectiveCamera(),
    },
    selection: {
      getSelectedEdges: vi.fn().mockReturnValue([]),
    },
    getSelectedFaces: vi.fn().mockReturnValue([1, 2, 3]),
    syncMesh: vi.fn(),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    snap: { setReferencePoint: vi.fn() },
    axisLock: null as string | null,
    inferredAxis: null as string | null,
  } as any;
}

describe('RotateTool (CAD 3-click style)', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: RotateTool;

  beforeEach(() => {
    ctx = mockToolContext();
    tool = new RotateTool(ctx);
  });

  describe('name', () => {
    it('is "rotate"', () => {
      expect(tool.name).toBe('rotate');
    });
  });

  describe('isBusy', () => {
    it('defaults to false', () => {
      expect(tool.isBusy()).toBe(false);
    });

    it('is true after onActivate when faces selected', () => {
      tool.onActivate();
      expect(tool.isBusy()).toBe(true);
    });

    it('stays false when activating without selection', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([]);
      tool.onActivate();
      expect(tool.isBusy()).toBe(false);
    });
  });

  describe('edge rotation', () => {
    beforeEach(() => {
      ctx.getSelectedFaces.mockReturnValue([]);
      ctx.selection.getSelectedEdges.mockReturnValue([10, 20]);
      ctx.bridge.getEdgeEndpoints.mockImplementation((eid: number) => {
        if (eid === 10) return [1, 2];
        if (eid === 20) return [2, 3];
        return [];
      });
    });

    it('activates with edge-only selection', () => {
      tool.onActivate();
      expect(tool.isBusy()).toBe(true);
    });

    it('drag rotates verts (not faces)', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      expect(ctx.bridge.rotateVerts).toHaveBeenCalled();
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
      const vertIds = (ctx.bridge.rotateVerts as Mock).mock.calls[0][0].slice().sort();
      expect(vertIds).toEqual([1, 2, 3]); // dedup
    });

    it('legacy VCB rotates verts around their centroid', () => {
      ctx.bridge.getVertexPos.mockImplementation((v: number) => {
        if (v === 1) return [0, 0, 0];
        if (v === 2) return [6, 0, 0];
        if (v === 3) return [0, 0, 6];
        return null;
      });
      tool.applyVCBValue(45);
      expect(ctx.bridge.rotateVerts).toHaveBeenCalled();
      const call = (ctx.bridge.rotateVerts as Mock).mock.calls[0];
      // centroid ≈ (2, 0, 2)
      expect(call[1]).toBeCloseTo(2, 1);
      expect(call[3]).toBeCloseTo(2, 1);
      expect(call[7]).toBe(45); // angle
    });
  });

  describe('CAD 3-click flow', () => {
    it('pick-base → pick-reference → pick-target sequence', () => {
      tool.onActivate(); // pick-base phase
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0)); // base
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0)); // reference
      // Now in pick-target — mouseMove applies rotation
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10)); // 90°
      expect(ctx.bridge.rotateFaces).toHaveBeenCalled();
      expect(ctx.syncMesh).toHaveBeenCalled();
    });

    it('3rd click commits and returns to idle', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      expect(tool.isBusy()).toBe(false);
    });

    it('does nothing when point is null', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, null);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('applyVCBValue', () => {
    it('legacy path — rotates around centroid when idle', () => {
      tool.applyVCBValue(45);
      expect(ctx.bridge.rotateFaces).toHaveBeenCalledWith(
        [1, 2, 3], 0, 0, 0, 0, 1, 0, 45
      );
    });

    it('CAD path — applies angle when in pick-target phase', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).toHaveBeenCalled();
      expect(tool.isBusy()).toBe(false); // cleanup after VCB
    });

    it('does nothing when no faces selected in idle', () => {
      ctx.getSelectedFaces.mockReturnValue([]);
      tool.applyVCBValue(90);
      expect(ctx.bridge.rotateFaces).not.toHaveBeenCalled();
    });
  });

  describe('Axis switching (X/Y/Z keys)', () => {
    it('default axis is Y', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      const calls = (ctx.bridge.rotateFaces as Mock).mock.calls;
      // rotateFaces(selected, cx,cy,cz, ax,ay,az, angle)
      // Y축: ay=1
      expect(calls[0][5]).toBe(1); // ay
      expect(calls[0][4]).toBe(0); // ax
      expect(calls[0][6]).toBe(0); // az
    });

    it('X key switches to X axis', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onKeyDown({ key: 'x', preventDefault: () => {} } as any);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 10, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      const calls = (ctx.bridge.rotateFaces as Mock).mock.calls;
      expect(calls[0][4]).toBe(1); // ax
      expect(calls[0][5]).toBe(0); // ay
      expect(calls[0][6]).toBe(0); // az
    });

    it('Z key switches to Z axis', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onKeyDown({ key: 'Z', preventDefault: () => {} } as any);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 10, 0));
      const calls = (ctx.bridge.rotateFaces as Mock).mock.calls;
      expect(calls[0][4]).toBe(0); // ax
      expect(calls[0][5]).toBe(0); // ay
      expect(calls[0][6]).toBe(1); // az
    });

    it('axis switch during pick-target rewinds preview', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10)); // 90° Y
      // 축 전환 → Y축 역방향 -90° 적용된 후 새 축 적용
      tool.onKeyDown({ key: 'X', preventDefault: () => {} } as any);
      const calls = (ctx.bridge.rotateFaces as Mock).mock.calls;
      // 최소 2번 호출 (preview 1 + rewind 1)
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // rewind 호출은 이전 축(Y)에 대한 음수 각도
      const rewind = calls[1];
      expect(rewind[5]).toBe(1); // ay — 이전 Y축
      expect(rewind[7]).toBeCloseTo(-90, 0); // -90°
    });

    it('Ctrl+X does not switch axis (respects modifier)', () => {
      tool.onActivate();
      tool.onKeyDown({ key: 'X', ctrlKey: true, preventDefault: () => {} } as any);
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(10, 0, 0));
      tool.onMouseMove({} as MouseEvent, new THREE.Vector3(0, 0, 10));
      const calls = (ctx.bridge.rotateFaces as Mock).mock.calls;
      expect(calls[0][5]).toBe(1); // still Y
    });
  });

  describe('Escape', () => {
    it('cleans up from any phase', () => {
      tool.onActivate();
      tool.onMouseDown({} as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);
      expect(tool.isBusy()).toBe(false);
    });
  });
});
