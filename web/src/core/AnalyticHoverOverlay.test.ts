/**
 * AnalyticHoverOverlay — ADR-070 Phase 1 Path Y C pilot regression.
 *
 * 5 invariants per ADR-070 §3.2:
 *   1. analytic_hover_overlay_renders_surface_kind_on_face_hover
 *   2. analytic_hover_overlay_renders_curve_kind_on_edge_hover
 *   3. analytic_hover_overlay_disabled_when_toggle_off
 *   4. analytic_hover_overlay_pointer_events_none
 *   5. analytic_hover_overlay_throttles_wasm_calls
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnalyticHoverOverlay,
  ANALYTIC_HOVER_OVERLAY_LS_KEY,
  type AnalyticHoverOverlayBridge,
} from './AnalyticHoverOverlay';

beforeEach(() => {
  try { localStorage.removeItem(ANALYTIC_HOVER_OVERLAY_LS_KEY); } catch {}
});

function makeStubBridge(opts: {
  faceJson?: Record<number, string | null>;
  edgeJson?: Record<number, string | null>;
  callsCounter?: { face: number; edge: number };
} = {}): AnalyticHoverOverlayBridge {
  return {
    getFaceSurfaceJson: (faceId: number) => {
      if (opts.callsCounter) opts.callsCounter.face++;
      return opts.faceJson?.[faceId] ?? null;
    },
    getEdgeCurveJson: (edgeId: number) => {
      if (opts.callsCounter) opts.callsCounter.edge++;
      return opts.edgeJson?.[edgeId] ?? null;
    },
  };
}

describe('ADR-070 §B/§C — AnalyticHoverOverlay', () => {
  it('analytic_hover_overlay_renders_surface_kind_on_face_hover', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bridge = makeStubBridge({
      faceJson: {
        7: JSON.stringify({
          schemaVersion: 1, kind: 'Cylinder',
          axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], radius: 5.0,
          refDir: [1, 0, 0], uRange: [0, 6.28], vRange: [0, 10],
        }),
      },
    });
    const overlay = new AnalyticHoverOverlay(container, bridge);
    overlay.setEnabled(true);
    overlay.update({ target: { kind: 'face', id: 7 }, screenX: 100, screenY: 200 });
    overlay.flushForTest();

    const tip = container.querySelector('.aho-tooltip') as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.style.display).toBe('block');
    expect(tip.innerHTML).toContain('Face 7');
    expect(tip.innerHTML).toContain('Cylinder');
    expect(tip.innerHTML).toContain('r=5');

    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_renders_curve_kind_on_edge_hover', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bridge = makeStubBridge({
      edgeJson: {
        42: JSON.stringify({
          schemaVersion: 1, kind: 'Circle',
          center: [1, 2, 3], radius: 4.5,
          normal: [0, 0, 1], basisU: [1, 0, 0],
        }),
      },
    });
    const overlay = new AnalyticHoverOverlay(container, bridge);
    overlay.setEnabled(true);
    overlay.update({ target: { kind: 'edge', id: 42 }, screenX: 50, screenY: 80 });
    overlay.flushForTest();

    const tip = container.querySelector('.aho-tooltip') as HTMLElement;
    expect(tip.style.display).toBe('block');
    expect(tip.innerHTML).toContain('Edge 42');
    expect(tip.innerHTML).toContain('Circle');
    expect(tip.innerHTML).toContain('r=4.5');

    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_disabled_when_toggle_off', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bridge = makeStubBridge({
      faceJson: { 1: JSON.stringify({ schemaVersion: 1, kind: 'Plane' }) },
    });
    const overlay = new AnalyticHoverOverlay(container, bridge);

    expect(overlay.isEnabled()).toBe(false);  // default off
    overlay.update({ target: { kind: 'face', id: 1 }, screenX: 0, screenY: 0 });
    overlay.flushForTest();

    const tip = container.querySelector('.aho-tooltip') as HTMLElement;
    expect(tip.style.display).toBe('none');

    // Now enable.
    overlay.setEnabled(true);
    expect(overlay.isEnabled()).toBe(true);
    overlay.update({ target: { kind: 'face', id: 1 }, screenX: 0, screenY: 0 });
    overlay.flushForTest();
    expect(tip.style.display).toBe('block');

    // Persist toggle in localStorage.
    expect(localStorage.getItem(ANALYTIC_HOVER_OVERLAY_LS_KEY)).toBe('1');

    // Disable again — overlay must hide immediately.
    overlay.setEnabled(false);
    expect(tip.style.display).toBe('none');
    expect(localStorage.getItem(ANALYTIC_HOVER_OVERLAY_LS_KEY)).toBe('0');

    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_pointer_events_none', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const overlay = new AnalyticHoverOverlay(container, makeStubBridge());
    const tip = container.querySelector('.aho-tooltip') as HTMLElement;
    expect(tip.style.pointerEvents).toBe('none');
    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_throttles_wasm_calls', () => {
    // Multiple update() calls between rafs MUST coalesce into a single
    // bridge invocation per render cycle.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const counter = { face: 0, edge: 0 };
    const bridge = makeStubBridge({
      faceJson: { 1: JSON.stringify({ schemaVersion: 1, kind: 'Plane' }) },
      callsCounter: counter,
    });
    const overlay = new AnalyticHoverOverlay(container, bridge);
    overlay.setEnabled(true);

    // 5 rapid updates → 1 flush via raf-coalesce.
    for (let i = 0; i < 5; i++) {
      overlay.update({ target: { kind: 'face', id: 1 }, screenX: i, screenY: i });
    }
    overlay.flushForTest();

    expect(counter.face, 'multiple updates → single bridge call (debounce)').toBe(1);
    expect(counter.edge).toBe(0);

    // Same target — no re-fetch.
    overlay.update({ target: { kind: 'face', id: 1 }, screenX: 100, screenY: 100 });
    overlay.flushForTest();
    expect(counter.face, 'same target → no extra fetch').toBe(1);

    // Different face → new fetch.
    overlay.update({ target: { kind: 'face', id: 2 }, screenX: 100, screenY: 100 });
    overlay.flushForTest();
    expect(counter.face).toBe(2);

    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_handles_polygon_face_no_surface', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const overlay = new AnalyticHoverOverlay(container, makeStubBridge({}));
    overlay.setEnabled(true);
    overlay.update({ target: { kind: 'face', id: 1 }, screenX: 0, screenY: 0 });
    overlay.flushForTest();

    const tip = container.querySelector('.aho-tooltip') as HTMLElement;
    expect(tip.style.display).toBe('block');
    expect(tip.innerHTML).toContain('Face 1');
    expect(tip.innerHTML).toContain('polygon');  // no surface attached

    overlay.dispose();
    container.remove();
  });

  it('analytic_hover_overlay_persists_state_across_instances', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const first = new AnalyticHoverOverlay(container, makeStubBridge());
    first.setEnabled(true);
    first.dispose();

    // New instance — should inherit toggle from localStorage.
    const second = new AnalyticHoverOverlay(container, makeStubBridge());
    expect(second.isEnabled()).toBe(true);
    second.dispose();
    container.remove();
  });
});
