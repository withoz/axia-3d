import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pickingRouter, type ViewportPickerLike } from './PickingRouter';
import { telemetry } from './telemetry';

function mockViewport(): ViewportPickerLike & {
  pick: ReturnType<typeof vi.fn>;
  pickEdge: ReturnType<typeof vi.fn>;
  pickEdgeOrFace: ReturnType<typeof vi.fn>;
} {
  return {
    pick: vi.fn().mockReturnValue(null),
    pickEdge: vi.fn().mockReturnValue(null),
    pickEdgeOrFace: vi.fn().mockReturnValue(null),
  };
}

describe('PickingRouter — ADR-012 §4 단일 진입점', () => {
  beforeEach(() => { telemetry.reset(); });

  it('routes face query to viewport.pick', () => {
    const vp = mockViewport();
    const hit = { object: {} as any, distance: 0, point: { x: 0, y: 0, z: 0 } as any };
    vp.pick.mockReturnValue(hit);
    const r = pickingRouter.route({ kind: 'face', x: 10, y: 20, viewport: vp });
    expect(vp.pick).toHaveBeenCalledWith(10, 20);
    expect(r).toEqual({ kind: 'face', hit });
  });

  it('routes edge query to viewport.pickEdge', () => {
    const vp = mockViewport();
    const hit = { object: {} as any, distance: 0, index: 4 };
    vp.pickEdge.mockReturnValue(hit);
    const r = pickingRouter.route({ kind: 'edge', x: 5, y: 5, viewport: vp });
    expect(vp.pickEdge).toHaveBeenCalledWith(5, 5);
    expect(r).toEqual({ kind: 'edge', hit });
  });

  it('routes edgeOrFace and unwraps the discriminated result', () => {
    const vp = mockViewport();
    const edgeHit = { object: {} as any, distance: 0, index: 2 };
    vp.pickEdgeOrFace.mockReturnValue({ type: 'edge', hit: edgeHit });
    const r = pickingRouter.route({ kind: 'edgeOrFace', x: 0, y: 0, viewport: vp });
    expect(r).toEqual({ kind: 'edge', hit: edgeHit, via: 'edgeOrFace' });
  });

  it('forwards preferEdgeWithinPx to pickEdgeOrFace', () => {
    const vp = mockViewport();
    pickingRouter.route({
      kind: 'edgeOrFace', x: 10, y: 20,
      viewport: vp, preferEdgeWithinPx: 12,
    });
    expect(vp.pickEdgeOrFace).toHaveBeenCalledWith(10, 20, 12);
  });

  it('returns null when picker returns null', () => {
    const vp = mockViewport();
    expect(pickingRouter.route({ kind: 'face', x: 0, y: 0, viewport: vp })).toBe(null);
    expect(pickingRouter.route({ kind: 'edge', x: 0, y: 0, viewport: vp })).toBe(null);
    expect(pickingRouter.route({ kind: 'edgeOrFace', x: 0, y: 0, viewport: vp })).toBe(null);
  });

  it('records elapsed time under picking.* budget keys', () => {
    const vp = mockViewport();
    // Slow picker that exceeds picking.face budget (8ms).
    vp.pick.mockImplementation(() => {
      const end = performance.now() + 12;
      while (performance.now() < end) {/* burn */}
      return null;
    });
    pickingRouter.route({ kind: 'face', x: 0, y: 0, viewport: vp });
    const violations = telemetry.violationsByKey('picking.face');
    expect(violations.length).toBe(1);
    expect(violations[0].elapsed).toBeGreaterThan(8);
  });

  it('edgeOrFace routes via picking.face budget (mixed bias)', () => {
    const vp = mockViewport();
    vp.pickEdgeOrFace.mockImplementation(() => {
      const end = performance.now() + 12;
      while (performance.now() < end) {/* burn */}
      return null;
    });
    pickingRouter.route({ kind: 'edgeOrFace', x: 0, y: 0, viewport: vp });
    expect(telemetry.violationsByKey('picking.face').length).toBe(1);
    expect(telemetry.violationsByKey('picking.edge').length).toBe(0);
  });
});
