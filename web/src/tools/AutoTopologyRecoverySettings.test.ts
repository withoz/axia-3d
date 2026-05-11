/**
 * ADR-097 T-ε — AutoTopologyRecoverySettings regression coverage.
 * Mirrors AutoReferenceImportSettings.test (ADR-096) pattern, but
 * default is OFF (T-A=a — explicit opt-in for self-modifying ops).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AutoTopologyRecoverySettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default OFF (T-ε §B-T-J — self-modifying op safety)', async () => {
    const m = await import('./AutoTopologyRecoverySettings');
    expect(m.getAutoTopologyRecoveryMode()).toBe(false);
  });

  it('localStorage "false" → OFF (matches default)', async () => {
    localStorage.setItem('axia:auto-topology-recovery', 'false');
    const m = await import('./AutoTopologyRecoverySettings');
    expect(m.getAutoTopologyRecoveryMode()).toBe(false);
  });

  it('localStorage "true" → ON (explicit ON preference 보존)', async () => {
    localStorage.setItem('axia:auto-topology-recovery', 'true');
    const m = await import('./AutoTopologyRecoverySettings');
    expect(m.getAutoTopologyRecoveryMode()).toBe(true);
  });

  it('setAutoTopologyRecoveryMode persists to localStorage', async () => {
    const m = await import('./AutoTopologyRecoverySettings');
    m.setAutoTopologyRecoveryMode(true);
    expect(localStorage.getItem('axia:auto-topology-recovery')).toBe('true');
    m.setAutoTopologyRecoveryMode(false);
    expect(localStorage.getItem('axia:auto-topology-recovery')).toBe('false');
  });

  it('onAutoTopologyRecoveryModeChange fires on actual change only', async () => {
    const m = await import('./AutoTopologyRecoverySettings');
    const cb = vi.fn();
    const unsubscribe = m.onAutoTopologyRecoveryModeChange(cb);

    m.setAutoTopologyRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    m.setAutoTopologyRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(1); // no-op

    m.setAutoTopologyRecoveryMode(false);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setAutoTopologyRecoveryMode(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
