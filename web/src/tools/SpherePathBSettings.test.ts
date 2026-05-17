/**
 * ADR-104 β-1-ζ — SpherePathBSettings regression coverage.
 *
 * 1:1 mirror of CylinderPathBSettings.test.ts (ADR-094 B-η pattern).
 * 사용자 결재 2026-05-17.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SpherePathBSettings — ADR-104 β-1-ζ', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default ON (β-1-ζ initial activation, ADR-094 답습)', async () => {
    const m = await import('./SpherePathBSettings');
    expect(m.getSpherePathBMode()).toBe(true);
  });

  it('localStorage "true" → mode ON (matches default)', async () => {
    localStorage.setItem('axia:sphere-path-b-mode', 'true');
    const m = await import('./SpherePathBSettings');
    expect(m.getSpherePathBMode()).toBe(true);
  });

  it('localStorage "false" → mode OFF (explicit OFF preference 보존)', async () => {
    localStorage.setItem('axia:sphere-path-b-mode', 'false');
    const m = await import('./SpherePathBSettings');
    expect(m.getSpherePathBMode()).toBe(false);
  });

  it('setSpherePathBMode persists to localStorage', async () => {
    const m = await import('./SpherePathBSettings');
    m.setSpherePathBMode(false);
    expect(localStorage.getItem('axia:sphere-path-b-mode')).toBe('false');
    m.setSpherePathBMode(true);
    expect(localStorage.getItem('axia:sphere-path-b-mode')).toBe('true');
  });

  it('onSpherePathBModeChange fires on actual change only', async () => {
    const m = await import('./SpherePathBSettings');
    const cb = vi.fn();
    const unsubscribe = m.onSpherePathBModeChange(cb);

    m.setSpherePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);

    // No-op when value unchanged.
    m.setSpherePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setSpherePathBMode(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setSpherePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
