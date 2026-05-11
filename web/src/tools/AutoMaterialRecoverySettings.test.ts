/**
 * ADR-100 R-ε — AutoMaterialRecoverySettings regression coverage.
 * ADR-097 T-ε AutoTopologyRecoverySettings 1:1 mirror — Default OFF
 * (R-E lock-in, opt-in for self-modifying material ops).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AutoMaterialRecoverySettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default OFF (R-E — self-modifying op safety, ADR-097 T-ε 답습)', async () => {
    const m = await import('./AutoMaterialRecoverySettings');
    expect(m.getAutoMaterialRecoveryMode()).toBe(false);
  });

  it('localStorage "false" → OFF (matches default)', async () => {
    localStorage.setItem('axia:auto-material-recovery', 'false');
    const m = await import('./AutoMaterialRecoverySettings');
    expect(m.getAutoMaterialRecoveryMode()).toBe(false);
  });

  it('localStorage "true" → ON (explicit ON preference 보존)', async () => {
    localStorage.setItem('axia:auto-material-recovery', 'true');
    const m = await import('./AutoMaterialRecoverySettings');
    expect(m.getAutoMaterialRecoveryMode()).toBe(true);
  });

  it('setAutoMaterialRecoveryMode persists to localStorage', async () => {
    const m = await import('./AutoMaterialRecoverySettings');
    m.setAutoMaterialRecoveryMode(true);
    expect(localStorage.getItem('axia:auto-material-recovery')).toBe('true');
    m.setAutoMaterialRecoveryMode(false);
    expect(localStorage.getItem('axia:auto-material-recovery')).toBe('false');
  });

  it('onAutoMaterialRecoveryModeChange fires on actual change only', async () => {
    const m = await import('./AutoMaterialRecoverySettings');
    const cb = vi.fn();
    const unsubscribe = m.onAutoMaterialRecoveryModeChange(cb);

    m.setAutoMaterialRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    m.setAutoMaterialRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(1); // no-op

    m.setAutoMaterialRecoveryMode(false);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setAutoMaterialRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
