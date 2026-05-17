/**
 * ADR-104 β-3-ζ — TorusPathBSettings regression coverage.
 *
 * 1:1 mirror of SpherePathBSettings / ConePathBSettings tests.
 * 사용자 결재 2026-05-17.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TorusPathBSettings — ADR-104 β-3-ζ', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default ON (β-3-ζ initial activation)', async () => {
    const m = await import('./TorusPathBSettings');
    expect(m.getTorusPathBMode()).toBe(true);
  });

  it('localStorage "true" → mode ON (matches default)', async () => {
    localStorage.setItem('axia:torus-path-b-mode', 'true');
    const m = await import('./TorusPathBSettings');
    expect(m.getTorusPathBMode()).toBe(true);
  });

  it('localStorage "false" → mode OFF (explicit OFF preference 보존)', async () => {
    localStorage.setItem('axia:torus-path-b-mode', 'false');
    const m = await import('./TorusPathBSettings');
    expect(m.getTorusPathBMode()).toBe(false);
  });

  it('setTorusPathBMode persists to localStorage', async () => {
    const m = await import('./TorusPathBSettings');
    m.setTorusPathBMode(false);
    expect(localStorage.getItem('axia:torus-path-b-mode')).toBe('false');
    m.setTorusPathBMode(true);
    expect(localStorage.getItem('axia:torus-path-b-mode')).toBe('true');
  });

  it('onTorusPathBModeChange fires on actual change only', async () => {
    const m = await import('./TorusPathBSettings');
    const cb = vi.fn();
    const unsubscribe = m.onTorusPathBModeChange(cb);

    m.setTorusPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);

    m.setTorusPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setTorusPathBMode(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setTorusPathBMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
