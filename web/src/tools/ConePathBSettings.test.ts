/**
 * ADR-104 β-2-ζ — ConePathBSettings regression coverage.
 *
 * 1:1 mirror of SpherePathBSettings.test.ts (β-1-ζ pattern).
 * 사용자 결재 2026-05-17.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ConePathBSettings — ADR-104 β-2-ζ', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default ON (β-2-ζ initial activation, ADR-094 / ADR-113 답습)', async () => {
    const m = await import('./ConePathBSettings');
    expect(m.getConePathBMode()).toBe(true);
  });

  it('localStorage "true" → mode ON (matches default)', async () => {
    localStorage.setItem('axia:cone-path-b-mode', 'true');
    const m = await import('./ConePathBSettings');
    expect(m.getConePathBMode()).toBe(true);
  });

  it('localStorage "false" → mode OFF (explicit OFF preference 보존)', async () => {
    localStorage.setItem('axia:cone-path-b-mode', 'false');
    const m = await import('./ConePathBSettings');
    expect(m.getConePathBMode()).toBe(false);
  });

  it('setConePathBMode persists to localStorage', async () => {
    const m = await import('./ConePathBSettings');
    m.setConePathBMode(false);
    expect(localStorage.getItem('axia:cone-path-b-mode')).toBe('false');
    m.setConePathBMode(true);
    expect(localStorage.getItem('axia:cone-path-b-mode')).toBe('true');
  });

  it('onConePathBModeChange fires on actual change only', async () => {
    const m = await import('./ConePathBSettings');
    const cb = vi.fn();
    const unsubscribe = m.onConePathBModeChange(cb);

    m.setConePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);

    m.setConePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setConePathBMode(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setConePathBMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
