/**
 * ADR-098 S-ε — AssetLibraryUserTierSettings regression coverage.
 * Mirrors AutoTopologyRecoverySettings.test (ADR-097 T-ε) — Default
 * OFF (S-E lock-in, opt-in for User tier 활성).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AssetLibraryUserTierSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default OFF (S-E — opt-in for User tier)', async () => {
    const m = await import('./AssetLibraryUserTierSettings');
    expect(m.getAssetLibraryUserTierMode()).toBe(false);
  });

  it('localStorage "true" → ON (explicit ON preference 보존)', async () => {
    localStorage.setItem('axia:asset-library-user-tier', 'true');
    const m = await import('./AssetLibraryUserTierSettings');
    expect(m.getAssetLibraryUserTierMode()).toBe(true);
  });

  it('localStorage "false" → OFF (matches default)', async () => {
    localStorage.setItem('axia:asset-library-user-tier', 'false');
    const m = await import('./AssetLibraryUserTierSettings');
    expect(m.getAssetLibraryUserTierMode()).toBe(false);
  });

  it('setAssetLibraryUserTierMode persists to localStorage', async () => {
    const m = await import('./AssetLibraryUserTierSettings');
    m.setAssetLibraryUserTierMode(true);
    expect(localStorage.getItem('axia:asset-library-user-tier')).toBe('true');
    m.setAssetLibraryUserTierMode(false);
    expect(localStorage.getItem('axia:asset-library-user-tier')).toBe('false');
  });

  it('onAssetLibraryUserTierModeChange fires on actual change only', async () => {
    const m = await import('./AssetLibraryUserTierSettings');
    const cb = vi.fn();
    const unsubscribe = m.onAssetLibraryUserTierModeChange(cb);

    m.setAssetLibraryUserTierMode(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    m.setAssetLibraryUserTierMode(true);
    expect(cb).toHaveBeenCalledTimes(1); // no-op

    m.setAssetLibraryUserTierMode(false);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setAssetLibraryUserTierMode(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
