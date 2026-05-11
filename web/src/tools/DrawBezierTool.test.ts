import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { DrawBezierTool } from './DrawBezierTool';

vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

function mockToolContext() {
  return {
    bridge: {
      drawBezierWithCurve: vi.fn().mockReturnValue(0),
      drawClosedBezierAsCurve: vi.fn().mockReturnValue(1),
      drawPolylineAsShape: vi.fn().mockReturnValue(0),
    },
    viewport: {
      scene: { add: vi.fn(), remove: vi.fn() },
      activeCamera: new THREE.PerspectiveCamera(),
    },
    snap: {
      setReferencePoint: vi.fn(),
      getSnappedPoint: vi.fn().mockReturnValue(null),
    },
    syncMesh: vi.fn(),
    getDrawPlane: vi.fn().mockReturnValue({
      normal: new THREE.Vector3(0, 0, 1),
      onFace: false,
    }),
    get3DPoint: vi.fn(),
    getSnappedPoint: vi.fn().mockReturnValue(null),
    getRay: vi.fn().mockReturnValue({
      ray: {
        intersectPlane: vi.fn().mockReturnValue(null),
      },
    }),
    dimLabel: { update: vi.fn(), clear: vi.fn() },
    units: { format: vi.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('DrawBezierTool (ADR-089 A-ψ-β closure detection)', () => {
  let ctx: ReturnType<typeof mockToolContext>;
  let tool: DrawBezierTool;

  beforeEach(async () => {
    ctx = mockToolContext();
    tool = new DrawBezierTool(ctx);
    // Default OFF — explicit test sets ON via setDrawCurveMode
    const { setDrawCurveMode } = await import('./DrawCurveSettings');
    setDrawCurveMode(true); // baseline ON for this test file
  });

  /** Helper — invoke tool flow with 4 control points using direct push.
   *  Skips full mouse event simulation; instead, pre-populates the tool's
   *  internal points array and calls a private "commit" via the public flow. */
  function commitWith4Points(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
    // Mock onMouseDown calls — points are appended via getPointOnDrawPlane
    // path. Since getPointOnDrawPlane requires drawPlane3, we directly
    // populate state via reflection:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).plane = { normal: new THREE.Vector3(0, 0, 1) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).drawPlane3 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).points = [p0, p1, p2, p3];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool as any).commit();
  }

  it('open Bezier (P3 far from P0) → drawBezierWithCurve (legacy path)', () => {
    commitWith4Points(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(50, 0, 0),
      new THREE.Vector3(100, 50, 0),
      new THREE.Vector3(150, 100, 0), // far from P0
    );
    expect(ctx.bridge.drawBezierWithCurve).toHaveBeenCalledTimes(1);
    expect(ctx.bridge.drawClosedBezierAsCurve).not.toHaveBeenCalled();
  });

  it('closed Bezier (P3 ≈ P0 within EPSILON) → drawClosedBezierAsCurve', () => {
    const p0 = new THREE.Vector3(100, 200, 0);
    commitWith4Points(
      p0.clone(),
      new THREE.Vector3(150, 200, 0),
      new THREE.Vector3(150, 250, 0),
      p0.clone(), // exact P0
    );
    expect(ctx.bridge.drawClosedBezierAsCurve).toHaveBeenCalledTimes(1);
    expect(ctx.bridge.drawBezierWithCurve).not.toHaveBeenCalled();
    // Verify control points: 5 points (P0, P1, P2, P3, P0), 15 floats
    const callArg = ctx.bridge.drawClosedBezierAsCurve.mock.calls[0][0];
    expect(callArg.length).toBe(15);
    // First and last should be exact P0
    expect(callArg[0]).toBeCloseTo(100); expect(callArg[1]).toBeCloseTo(200);
    expect(callArg[12]).toBeCloseTo(100); expect(callArg[13]).toBeCloseTo(200);
  });

  it('drawCurveMode OFF → always drawBezierWithCurve regardless of closure', async () => {
    const { setDrawCurveMode } = await import('./DrawCurveSettings');
    setDrawCurveMode(false);
    const p0 = new THREE.Vector3(0, 0, 0);
    commitWith4Points(
      p0.clone(),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(10, 10, 0),
      p0.clone(), // would be closed but flag OFF
    );
    expect(ctx.bridge.drawBezierWithCurve).toHaveBeenCalledTimes(1);
    expect(ctx.bridge.drawClosedBezierAsCurve).not.toHaveBeenCalled();
  });
});
