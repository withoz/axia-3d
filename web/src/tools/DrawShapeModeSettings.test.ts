import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDrawShapeMode,
  setDrawShapeMode,
  onDrawShapeModeChange,
} from './DrawShapeModeSettings';

describe('ADR-050 P-5d — DrawShapeModeSettings module', () => {
  beforeEach(() => {
    // Cross-test isolation — each test starts with default false.
    setDrawShapeMode(false);
  });

  afterEach(() => {
    // Reset to default for the next file's tests.
    setDrawShapeMode(false);
  });

  it('default value is false (legacy Xia path)', () => {
    expect(getDrawShapeMode()).toBe(false);
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
