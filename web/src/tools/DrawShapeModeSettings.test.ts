import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDrawShapeMode,
  setDrawShapeMode,
  onDrawShapeModeChange,
} from './DrawShapeModeSettings';

describe('ADR-050 P-5d / P-5e-α — DrawShapeModeSettings module', () => {
  // ADR-050 P-5e-α — default flipped to `true`. Tests now reset to
  // `false` between cases for parity with the legacy-Xia tests that
  // expect that default state. Module-level default is verified in
  // its own dedicated test below.
  beforeEach(() => {
    setDrawShapeMode(false);
  });

  afterEach(() => {
    // Reset across test files — keep `false` so legacy-path tests
    // (DrawRectTool / DrawLineTool / DrawCircleTool) without explicit
    // mode setup continue to exercise the legacy bridge.drawRect path.
    setDrawShapeMode(false);
  });

  it('module-level default is true (ADR-050 P-5e-α flip)', async () => {
    // Re-import the module fresh to read the load-time default
    // (the beforeEach has already mutated the singleton state).
    // We use `vi.resetModules()` + dynamic import to bypass the
    // cached singleton. localStorage is empty so the load-time
    // path takes the `let current = true` branch.
    const { vi } = await import('vitest');
    vi.resetModules();
    try {
      localStorage.removeItem('axia:draw-shape-mode');
    } catch { /* ignore */ }
    const fresh = await import('./DrawShapeModeSettings');
    expect(fresh.getDrawShapeMode()).toBe(true);
  });

  it('setDrawShapeMode(true) updates getDrawShapeMode (round-trip)', () => {
    setDrawShapeMode(true);
    expect(getDrawShapeMode()).toBe(true);
    setDrawShapeMode(false);
    expect(getDrawShapeMode()).toBe(false);
  });

  it('setDrawShapeMode notifies registered listeners on change', () => {
    const cb = vi.fn();
    onDrawShapeModeChange(cb);

    setDrawShapeMode(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    setDrawShapeMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('setDrawShapeMode is no-op when value unchanged (no listener fire)', () => {
    setDrawShapeMode(true);
    const cb = vi.fn();
    onDrawShapeModeChange(cb);

    // Already true — calling again must NOT fire listener.
    setDrawShapeMode(true);
    expect(cb).not.toHaveBeenCalled();
  });

  it('onDrawShapeModeChange returns unregister function', () => {
    const cb = vi.fn();
    const unregister = onDrawShapeModeChange(cb);

    setDrawShapeMode(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unregister();
    setDrawShapeMode(false);
    expect(cb).toHaveBeenCalledTimes(1); // listener removed, no extra call
  });
});
