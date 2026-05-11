/**
 * ADR-094 B-η — CylinderPathBSettings regression coverage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CylinderPathBSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default ON (B-θ post-retrospective)', async () => {
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(true);
  });

  it('localStorage "true" → mode ON (matches default)', async () => {
    localStorage.setItem('axia:cylinder-path-b-mode', 'true');
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(true);
  });

  it('localStorage "false" → mode OFF (explicit OFF preference 보존)', async () => {
    localStorage.setItem('axia:cylinder-path-b-mode', 'false');
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(false);
  });

  it('setCylinderPathBMode persists to localStorage', async () => {
    // Default = true (B-θ post-retrospective). Start by toggling to
    // false to exercise the persistence path.
    const m = await import('./CylinderPathBSettings');
    m.setCylinderPathBMode(false);
    expect(localStorage.getItem('axia:cylinder-path-b-mode')).toBe('false');
    m.setCylinderPathBMode(true);
    expect(localStorage.getItem('axia:cylinder-path-b-mode')).toBe('true');
  });

  it('onCylinderPathBModeChange fires on actual change only', async () => {
    // Default true → first toggle is to false.
    const m = await import('./CylinderPathBSettings');
    const cb = vi.fn();
    const unsubscribe = m.onCylinderPathBModeChange(cb);

    m.setCylinderPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);

    // No-op when value unchanged.
    m.setCylinderPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setCylinderPathBMode(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setCylinderPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
