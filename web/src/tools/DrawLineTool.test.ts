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
      drawLineAsShape: vi.fn().mockReturnValue(0),
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
      findNearestEndpoint: vi.fn().mockReturnValue(null),
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
    // ADR-140 ε-1: DrawLineTool now uses ctx.getDrawPlane SSOT for face-hit
    // drawing plane. Default returns legacy-equivalent DCEL fallback (no
    // surface-aware origin). Tests override .mockReturnValue as needed.
    getDrawPlane: vi.fn().mockReturnValue({
      normal: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(0, 1, 0),
      right: new THREE.Vector3(1, 0, 0),
      onFace: false,
    }),
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

      // ADR-103-δ-1 (Z-up): default plane normal = +Z (XY ground).
      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalledWith(0, 0, 0, 100, 0, 0, 0, 0, 1);
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
      expect(ctx.bridge.drawLineAsShape).not.toHaveBeenCalled();
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
      // ADR-103-δ-1 (Z-up): default plane normal = +Z.
      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalledWith(0, 0, 0, 500, 0, 0, 0, 0, 1);
    });

    it('does nothing when not in Drawing state', () => {
      tool.applyVCBValue(500);
      expect(ctx.bridge.drawLineAsShape).not.toHaveBeenCalled();
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
      expect(ctx.bridge.drawLineAsShape).not.toHaveBeenCalled();
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
      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalledWith(10, 0, 10, 90, 0, 90, 0, 0, 1);
    });

    it('falls back to drawLine when splitFaceByLine throws', () => {
      ctx.viewport.pick.mockReturnValue({ faceIndex: 2 });
      ctx.getFaceId.mockReturnValue(7);
      ctx.bridge.splitFaceByLine.mockImplementation(() => { throw new Error('not available'); });

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalledWith(10, 0, 10, 90, 0, 90, 0, 0, 1);
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
      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalled();
    });

    it('uses regular drawLine when clicking on empty space (no face)', () => {
      ctx.viewport.pick.mockReturnValue(null); // No face hit

      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(10, 0, 10));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(90, 0, 90));

      expect(ctx.bridge.splitFaceByLine).not.toHaveBeenCalled();
      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalled();
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

  // ADR-047 P32 — Chain self-touch prevention.
  // The DrawLineTool exposes its pending chain points (excluding chainStart)
  // so SnapManager can drop them from endpoint-snap candidates.
  describe('getExcludedSnapPoints (ADR-047 P32)', () => {
    it('returns empty when no chain is active', () => {
      expect(tool.getExcludedSnapPoints()).toEqual([]);
    });

    it('returns empty for a fresh chain with only chainStart', () => {
      tool.onActivate();
      // First click → chainStart set, chainPoints = [start]. No mid yet.
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      expect(tool.getExcludedSnapPoints()).toEqual([]);
    });

    it('excludes mid-waypoints but NOT chainStart after multiple clicks', () => {
      tool.onActivate();
      // P0 = chainStart
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      // P1 = first mid (commits the segment P0→P1, chainPoints becomes [P0, P1])
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));
      // P2 = second mid → chainPoints [P0, P1, P2]
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(100, 0, 100));

      const excluded = tool.getExcludedSnapPoints();

      // chainStart (P0) must NOT be excluded — needed for loop-close.
      const includesStart = excluded.some(p => p.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-3);
      expect(includesStart).toBe(false);

      // P1 and P2 (mid waypoints) MUST be excluded.
      const includesP1 = excluded.some(p => p.distanceTo(new THREE.Vector3(100, 0, 0)) < 1e-3);
      const includesP2 = excluded.some(p => p.distanceTo(new THREE.Vector3(100, 0, 100)) < 1e-3);
      expect(includesP1).toBe(true);
      expect(includesP2).toBe(true);
    });

    it('returns clones (mutating result must not affect chain state)', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(50, 0, 0));

      const excluded1 = tool.getExcludedSnapPoints();
      if (excluded1.length > 0) excluded1[0].set(9999, 9999, 9999);
      const excluded2 = tool.getExcludedSnapPoints();

      // Second call must yield original positions, untouched by mutation above.
      if (excluded2.length > 0) {
        expect(excluded2[0].x).not.toBe(9999);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-087 K-ε — kernel-aware drawLineAsShape only path.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-087 K-ε kernel-aware dispatch', () => {
    it('always calls bridge.drawLineAsShape (Plane attach on face path)', () => {
      tool.onActivate();
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(0, 0, 0));
      tool.onMouseDown({ button: 0 } as MouseEvent, new THREE.Vector3(100, 0, 0));

      expect(ctx.bridge.drawLineAsShape).toHaveBeenCalledTimes(1);
      expect(ctx.bridge.drawLine).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-140 ε-1 — DrawLineTool surface-aware drawing plane integration
  // (140-δ getDrawPlane SSOT 통합 — face-hit branch 가 ctx.getDrawPlane
  //  결과 사용. Cylinder/Sphere surface 위 사용자 click 의 정확한 tangent
  //  plane chord substitute 회피.)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-140 ε-1 — surface-aware drawing plane integration', () => {
    // Mock event helper — same coords as elsewhere in this file
    function mockEvent(): MouseEvent {
      return { clientX: 100, clientY: 100 } as MouseEvent;
    }

    // Build a face hit with world point + face normal (Three.js shape).
    // Note: hit.object intentionally omitted to skip the matrixWorld transform
    // path in the defensive fallback branch (Three.js mock has no Matrix4).
    // This is sound because:
    //   - tests 1, 2 use dp.onFace:true → defensive branch never entered
    //   - test 3 uses dp.onFace:false → defensive branch entered, but
    //     `if (hit.object && hit.object.matrixWorld)` evaluates false →
    //     skips matrixWorld transform → worldNormal = hit.face.normal directly
    function mockFaceHit(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
      return {
        faceIndex: 0,
        point: new THREE.Vector3(point.x, point.y, point.z),
        face: { normal: new THREE.Vector3(normal.x, normal.y, normal.z) },
      };
    }

    it('uses ctx.getDrawPlane SSOT when face is hit (Plane kind ≤ 1 — DCEL legacy equivalent)', () => {
      ctx.viewport.pick.mockReturnValue(mockFaceHit({ x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }));
      ctx.getDrawPlane.mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1),  // DCEL face normal (Plane)
        up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0),
        onFace: true,
        surfaceKind: 1,  // Plane — no surface-aware origin
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tool as any).establishDrawingPlane(mockEvent());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tool as any).drawingPlane as THREE.Plane;
      expect(plane).toBeDefined();
      // SSOT dispatch consulted exactly once for face-hit branch
      expect(ctx.getDrawPlane).toHaveBeenCalledTimes(1);
      // Plane normal = DCEL face normal (Z-up)
      expect(plane.normal.z).toBeCloseTo(1, 6);
      // Legacy fallback origin = hit.point (no surface-aware origin for kind ≤ 1)
      // Plane equation: n·x + d = 0 → for normal=(0,0,1), origin=(1,2,0): d = -(0*1 + 0*2 + 1*0) = 0
      expect(plane.constant).toBeCloseTo(0, 6);
    });

    it('uses surface-aware tangent plane when getDrawPlane returns origin (Cylinder kind ≥ 2)', () => {
      // Hit on Cylinder surface at world (5, 0, 0) — radial normal +X
      ctx.viewport.pick.mockReturnValue(mockFaceHit({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
      ctx.getDrawPlane.mockReturnValue({
        normal: new THREE.Vector3(1, 0, 0),  // Surface-aware radial normal
        up: new THREE.Vector3(0, 0, 1),
        right: new THREE.Vector3(0, 1, 0),
        onFace: true,
        origin: new THREE.Vector3(5, 0, 0),  // ADR-140 δ surface-aware tangent origin
        surfaceKind: 2,  // Cylinder
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tool as any).establishDrawingPlane(mockEvent());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tool as any).drawingPlane as THREE.Plane;
      expect(plane).toBeDefined();
      // Surface-aware normal (radial)
      expect(plane.normal.x).toBeCloseTo(1, 6);
      // Surface-aware origin (hit point P on cylinder)
      // Plane equation: n·x + d = 0 → for normal=(1,0,0), origin=(5,0,0): d = -5
      expect(plane.constant).toBeCloseTo(-5, 6);
    });

    it('falls back to legacy hit.face.normal when getDrawPlane returns onFace=false (defensive)', () => {
      // Pathological case: viewport hit OK, but getDrawPlane fails to recognize face
      // (e.g. mid-syncMesh stale state, no axia FaceId). Should not throw.
      ctx.viewport.pick.mockReturnValue(mockFaceHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }));
      ctx.getDrawPlane.mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1),  // Default ground plane (Z-up)
        up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0),
        onFace: false,  // ← getDrawPlane failed to recognize face
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tool as any).establishDrawingPlane(mockEvent());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tool as any).drawingPlane as THREE.Plane;
      expect(plane).toBeDefined();
      // Defensive: legacy hit.face.normal used (matrixWorld is identity in mock → +Y)
      expect(plane.normal.y).toBeCloseTo(1, 6);
    });

    it('does not call ctx.getDrawPlane in no-face workplane fallback (existing path unchanged)', () => {
      // Empty space click (pick returns null) — should use workplane logic only
      ctx.viewport.pick.mockReturnValue(null);
      ctx.get3DPoint.mockReturnValue(new THREE.Vector3(0, 0, 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tool as any).establishDrawingPlane(mockEvent());

      // ADR-140 ε-1 face-hit branch NOT entered → getDrawPlane never called
      expect(ctx.getDrawPlane).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plane = (tool as any).drawingPlane as THREE.Plane;
      expect(plane).toBeDefined();
    });
  });
});
