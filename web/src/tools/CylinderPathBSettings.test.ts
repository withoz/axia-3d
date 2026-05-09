/**
 * ADR-094 B-η — CylinderPathBSettings regression coverage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CylinderPathBSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default OFF (B-η — 시연 게이트 통과 전)', async () => {
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(false);
  });

  it('localStorage "true" → mode ON', async () => {
    localStorage.setItem('axia:cylinder-path-b-mode', 'true');
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(true);
  });

  it('localStorage "false" → mode OFF (default semantics)', async () => {
    localStorage.setItem('axia:cylinder-path-b-mode', 'false');
    const m = await import('./CylinderPathBSettings');
    expect(m.getCylinderPathBMode()).toBe(false);
  });

  it('setCylinderPathBMode persists to localStorage', async () => {
    const m = await import('./CylinderPathBSettings');
    m.setCylinderPathBMode(true);
    expect(localStorage.getItem('axia:cylinder-path-b-mode')).toBe('true');
    m.setCylinderPathBMode(false);
    expect(localStorage.getItem('axia:cylinder-path-b-mode')).toBe('false');
  });

  it('onCylinderPathBModeChange fires on actual change only', async () => {
    const m = await import('./CylinderPathBSettings');
    const cb = vi.fn();
    const unsubscribe = m.onCylinderPathBModeChange(cb);

    m.setCylinderPathBMode(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    // No-op when value unchanged.
    m.setCylinderPathBMode(true);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setCylinderPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setCylinderPathBMode(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
