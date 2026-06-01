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
  // ADR-181 — Unified face-aware drawing plane via getDrawPlane SSOT
  // 사용자 결재 2026-06-01: "서클은 되는데 rect는 안됩니다. 서클과 차이점을
  //   검토하세요." → DrawRect 가 DrawCircle 과 동일한 getDrawPlane 사용.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-181 getDrawPlane SSOT (face-aware, like DrawCircleTool)', () => {
    const mkEvent = () => ({ clientX: 100, clientY: 100 } as MouseEvent);

    it('face hit (cardinal +Z at z=200) → face plane, zeroValue=200 (NOT ground 0)', () => {
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0), onFace: true,
      });
      const point = new THREE.Vector3(-60, -60, 200);
      const plane = (tool as any).resolvePlane(mkEvent(), point);
      expect(plane.zeroValue).toBeCloseTo(200);     // on the box top, NOT z=0 ground
      expect(plane.forceCardinal).toBe(true);        // cardinal-aligned face
      expect(plane.zeroAxis).toBe('z');
      expect(plane.normal.z).toBeCloseTo(1);
      expect(plane.isFace).toBe(true);               // on-face preview flag (amber)
    });

    it('cardinal +X wall face → zeroValue=100, zeroAxis=x, isFace=true', () => {
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1),
        right: new THREE.Vector3(0, 1, 0), onFace: true,
      });
      const plane = (tool as any).resolvePlane(mkEvent(), new THREE.Vector3(100, 5, 5));
      expect(plane.zeroValue).toBeCloseTo(100);
      expect(plane.zeroAxis).toBe('x');
      expect(plane.forceCardinal).toBe(true);
      expect(plane.isFace).toBe(true);
    });

    it('LOCKED #63 — ground (no face) forces z=0 despite drifted click point', () => {
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0), onFace: false,   // empty ground
      });
      // click point drifted to z=0.37 — must be forced to exactly 0.
      const plane = (tool as any).resolvePlane(mkEvent(), new THREE.Vector3(10, 20, 0.37));
      expect(plane.zeroValue).toBe(0);          // LOCKED #63 z=0 invariant
      expect(plane.forceCardinal).toBe(true);
      expect(plane.isFace).toBe(false);          // ground → blue preview
    });

    it('plane-lock (dp.origin set, onFace false) → zeroValue from origin', () => {
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1),
        right: new THREE.Vector3(0, 1, 0), onFace: false,
        origin: new THREE.Vector3(100, 0, 0),   // ADR-166 lock / ADR-140 surface
      });
      const plane = (tool as any).resolvePlane(mkEvent(), new THREE.Vector3(100, 7, 7));
      expect(plane.zeroValue).toBeCloseTo(100);  // from origin, NOT forced to 0
      expect(plane.zeroAxis).toBe('x');
    });

    it('sketch mode → offset preserved (NOT forced to 0)', () => {
      ctx.getSketchInfo = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1), origin: new THREE.Vector3(0, 0, 50),
      });
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0), onFace: false,
      });
      const plane = (tool as any).resolvePlane(mkEvent(), new THREE.Vector3(10, 20, 50));
      expect(plane.isSketch).toBe(true);
      expect(plane.zeroValue).toBeCloseTo(50);   // sketch offset preserved
    });

    it('slanted (non-cardinal) face → forceCardinal false (trusts ray projection)', () => {
      const n = new THREE.Vector3(0.7, 0, 0.7).normalize();
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: n, up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize(),
        onFace: true,
      });
      const plane = (tool as any).resolvePlane(mkEvent(), new THREE.Vector3(10, 5, 3));
      expect(plane.forceCardinal).toBe(false);   // no cardinal axis force
      expect(plane.isFace).toBe(true);
    });

    it('null point but face under cursor → falls back to viewport.pick for offset', () => {
      ctx.getDrawPlane = vi.fn().mockReturnValue({
        normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0), onFace: true,
      });
      ctx.viewport.pick = vi.fn().mockReturnValue({ point: new THREE.Vector3(0, 0, 200) });
      const plane = (tool as any).resolvePlane(mkEvent(), null);
      expect(plane.zeroValue).toBeCloseTo(200);  // recovered from pick
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-179 — projection precision (resolveCardinalPlane + projectClickToCardinalPlane)
  //   — methods unchanged by ADR-181, retained.
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-179 projection precision (retained under ADR-181)', () => {
    it('cardinal ground plane has no isFace flag (blue preview)', () => {
      ctx.viewport = { ...ctx.viewport, viewMode: 'top' };
      const plane = (tool as any).resolveCardinalPlane();
      expect(plane.isFace).toBeFalsy();   // ground → not a face → blue preview
    });

    it('2nd corner on coplanar face → exact pick hit (no grazing blowup)', () => {
      const plane = {
        normal: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0), zeroAxis: 'z', zeroValue: 200,
        isSketch: false, forceCardinal: true, isFace: true,
      };
      // ray∩plane would shoot far (grazing); pick hit is the precise in-plane point.
      ctx.getRay = vi.fn().mockReturnValue({
        ray: { intersectPlane: (_p: unknown, t: THREE.Vector3) => { t.set(9999, 0, 200); return t; } },
      });
      ctx.viewport.pick = vi.fn().mockReturnValue({ point: new THREE.Vector3(40, 40, 200) });
      const pt = (tool as any).projectClickToCardinalPlane({ clientX: 1, clientY: 1 }, null, plane);
      expect(pt.x).toBeCloseTo(40);   // exact pick hit, NOT 9999 grazing
      expect(pt.y).toBeCloseTo(40);
      expect(pt.z).toBeCloseTo(200);
    });

    it('2nd corner over off-plane face → falls through to ray∩plane (extension)', () => {
      const plane = {
        normal: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0), zeroAxis: 'z', zeroValue: 200,
        isSketch: false, forceCardinal: true, isFace: true,
      };
      ctx.getRay = vi.fn().mockReturnValue({
        ray: { intersectPlane: (_p: unknown, t: THREE.Vector3) => { t.set(300, 0, 200); return t; } },
      });
      // pick hits a DIFFERENT face (z=0, not coplanar with z=200) → rejected.
      ctx.viewport.pick = vi.fn().mockReturnValue({ point: new THREE.Vector3(0, 0, 0) });
      const pt = (tool as any).projectClickToCardinalPlane({ clientX: 1, clientY: 1 }, null, plane);
      expect(pt.x).toBeCloseTo(300);   // ray∩plane extension, off-plane pick rejected
      expect(pt.z).toBeCloseTo(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADR-184 — Negative cardinal normal faces (-X/-Y/-Z) draw on the correct face
  // 사용자 결재 2026-06-01: "-y 면에 안그려짐" — 음의 normal 면에서 rect 가
  //   반대편(+) 면으로 점프하던 forceCardinalAxis 부호 버그 차단.
  //   (사용자 관찰: "서클은 양면 다 됨, 사각형은 한쪽만" — Circle 은 실제 좌표
  //   사용, Rect 는 부호 거리 zeroValue 를 좌표로 잘못 강제했음.)
  // ════════════════════════════════════════════════════════════════════════
  describe('ADR-184 negative cardinal normal faces', () => {
    function mkPlane(normal: THREE.Vector3, zeroAxis: string, zeroValue: number) {
      return {
        normal, right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1),
        zeroAxis, zeroValue, isSketch: false, forceCardinal: true, isFace: true,
      };
    }

    it('forceCardinalAxis: -Y face (zeroValue +100, normal -Y) → pt.y = -100 (NOT +100)', () => {
      // The -Y face lives at y=-100; its signed offset normal·p = (-1)(-100)=+100.
      const plane = mkPlane(new THREE.Vector3(0, -1, 0), 'y', 100);
      const pt = new THREE.Vector3(40, 999, 60);
      (tool as any).forceCardinalAxis(pt, plane);
      expect(pt.y).toBeCloseTo(-100);   // recovered coordinate, NOT the +100 offset
    });

    it('forceCardinalAxis: -X face → pt.x = -100', () => {
      const plane = mkPlane(new THREE.Vector3(-1, 0, 0), 'x', 100);
      const pt = new THREE.Vector3(999, 5, 5);
      (tool as any).forceCardinalAxis(pt, plane);
      expect(pt.x).toBeCloseTo(-100);
    });

    it('forceCardinalAxis: -Z face → pt.z = -50', () => {
      const plane = mkPlane(new THREE.Vector3(0, 0, -1), 'z', 50);
      const pt = new THREE.Vector3(5, 5, 999);
      (tool as any).forceCardinalAxis(pt, plane);
      expect(pt.z).toBeCloseTo(-50);
    });

    it('forceCardinalAxis: +Y face (positive normal) still → pt.y = +100 (regression)', () => {
      const plane = mkPlane(new THREE.Vector3(0, 1, 0), 'y', 100);
      const pt = new THREE.Vector3(40, 999, 60);
      (tool as any).forceCardinalAxis(pt, plane);
      expect(pt.y).toBeCloseTo(100);
    });

    it('forceCardinalAxis: ground z=0 (zeroValue 0) → pt.z = 0 (LOCKED #63)', () => {
      const plane = mkPlane(new THREE.Vector3(0, 0, 1), 'z', 0);
      const pt = new THREE.Vector3(10, 20, 0.37);
      (tool as any).forceCardinalAxis(pt, plane);
      expect(pt.z).toBe(0);
    });

    it('projectClickToCardinalPlane on -Y face → 2nd corner lands at y=-100 (end-to-end)', () => {
      const plane = mkPlane(new THREE.Vector3(0, -1, 0), 'y', 100);
      // getRay must exist to pass the guard; the coplanar pick path ignores its result.
      ctx.getRay = vi.fn().mockReturnValue({
        ray: { intersectPlane: (_p: unknown, t: THREE.Vector3) => { t.set(9999, 0, 0); return t; } },
      });
      // cursor over the -Y face: pick hit at y=-100, coplanar (|normal·hit - zeroValue| = 0).
      ctx.viewport.pick = vi.fn().mockReturnValue({ point: new THREE.Vector3(40, -100, 130) });
      const pt = (tool as any).projectClickToCardinalPlane({ clientX: 1, clientY: 1 }, null, plane);
      expect(pt.y).toBeCloseTo(-100);   // on the -Y face, NOT the +Y face (+100)
      expect(pt.x).toBeCloseTo(40);
      expect(pt.z).toBeCloseTo(130);
    });
  });
});
