/**
 * ADR-135 β — Distance-based LOD chord_tol bridge wrapper tests.
 *
 * Tests the TS wrapper layer (WasmBridge.{renderChordTol, setRenderChordTol,
 * lodChordTol}). Mocks the engine to verify bridge behavior + fallback
 * graceful path (when WASM stub missing).
 *
 * Cross-link:
 *   - ADR-135 § (β implementation)
 *   - ADR-134 §5.2 (Path A — Distance-based LOD chord_tol)
 *   - LOCKED #40 §L1 (baseline 0.02 mm preserved for near rendering)
 */

import { describe, it, expect, vi } from 'vitest';
import { WasmBridge } from './WasmBridge';

interface MinimalEngine {
  renderChordTol?: () => number;
  setRenderChordTol?: (tol: number) => void;
  lodChordTol?: (cameraDistance: number) => number;
}

function mockBridge(engine: MinimalEngine): WasmBridge {
  const bridge = new WasmBridge();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bridge as any).engine = engine;
  return bridge;
}

describe('ADR-135 β — Distance-based LOD chord_tol bridge wrappers', () => {
  describe('lodChordTol formula', () => {
    it('returns 0.02 (DEFAULT) for camera distance ≤ 100mm (near rendering preserved)', () => {
      const engineCalls: number[] = [];
      const bridge = mockBridge({
        lodChordTol: (d: number) => {
          engineCalls.push(d);
          // Use the real engine formula (mirror of axia_geo)
          const base = 0.02;
          const lodFactor = Math.max(1, d / 100);
          return Math.min(1.0, base * lodFactor);
        },
      });
      expect(bridge.lodChordTol(0)).toBeCloseTo(0.02);
      expect(bridge.lodChordTol(50)).toBeCloseTo(0.02);
      expect(bridge.lodChordTol(100)).toBeCloseTo(0.02);
      expect(engineCalls.length).toBe(3);
    });

    it('scales proportionally for mid camera (500mm → 0.10, 1m → 0.20)', () => {
      const bridge = mockBridge({
        lodChordTol: (d: number) => {
          const base = 0.02;
          const lodFactor = Math.max(1, d / 100);
          return Math.min(1.0, base * lodFactor);
        },
      });
      expect(bridge.lodChordTol(500)).toBeCloseTo(0.10, 5);
      expect(bridge.lodChordTol(1000)).toBeCloseTo(0.20, 5);
      expect(bridge.lodChordTol(2000)).toBeCloseTo(0.40, 5);
    });

    it('caps at 1.0 mm for far camera (5m+)', () => {
      const bridge = mockBridge({
        lodChordTol: (d: number) => {
          const base = 0.02;
          const lodFactor = Math.max(1, d / 100);
          return Math.min(1.0, base * lodFactor);
        },
      });
      expect(bridge.lodChordTol(5000)).toBeCloseTo(1.0, 5);
      expect(bridge.lodChordTol(10000)).toBeCloseTo(1.0);
      expect(bridge.lodChordTol(100000)).toBeCloseTo(1.0);
    });

    it('graceful fallback uses same TS formula when engine stub missing', () => {
      // No engine method set → fallback to TS-side formula mirror
      const bridge = mockBridge({});
      expect(bridge.lodChordTol(0)).toBeCloseTo(0.02);
      expect(bridge.lodChordTol(1000)).toBeCloseTo(0.20, 5);
      expect(bridge.lodChordTol(5000)).toBeCloseTo(1.0, 5);
    });

    it('graceful fallback when engine.lodChordTol throws', () => {
      const bridge = mockBridge({
        lodChordTol: () => {
          throw new Error('synthetic');
        },
      });
      // Returns 0.02 fallback on error
      expect(bridge.lodChordTol(100)).toBe(0.02);
    });
  });

  describe('renderChordTol getter', () => {
    it('returns engine value when available', () => {
      const bridge = mockBridge({
        renderChordTol: () => 0.25,
      });
      expect(bridge.renderChordTol()).toBeCloseTo(0.25);
    });

    it('returns 0.02 default when engine stub missing', () => {
      const bridge = mockBridge({});
      expect(bridge.renderChordTol()).toBe(0.02);
    });

    it('returns 0.02 default when engine throws', () => {
      const bridge = mockBridge({
        renderChordTol: () => {
          throw new Error('synthetic');
        },
      });
      expect(bridge.renderChordTol()).toBe(0.02);
    });
  });

  describe('setRenderChordTol setter', () => {
    it('forwards to engine.setRenderChordTol', () => {
      const calls: number[] = [];
      const bridge = mockBridge({
        setRenderChordTol: (tol: number) => {
          calls.push(tol);
        },
      });
      bridge.setRenderChordTol(0.25);
      expect(calls).toEqual([0.25]);
    });

    it('silent no-op when engine stub missing', () => {
      const bridge = mockBridge({});
      expect(() => bridge.setRenderChordTol(0.25)).not.toThrow();
    });

    it('records error but does not throw when engine throws', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const bridge = mockBridge({
        setRenderChordTol: () => {
          throw new Error('synthetic engine fail');
        },
      });
      expect(() => bridge.setRenderChordTol(0.25)).not.toThrow();
      consoleErrorSpy.mockRestore();
    });
  });
});
