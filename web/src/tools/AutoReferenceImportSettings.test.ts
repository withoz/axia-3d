/**
 * ADR-096 M-β — AutoReferenceImportSettings regression coverage.
 * Mirrors CylinderPathBSettings.test (ADR-094) pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AutoReferenceImportSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('default ON (M-L3 — ADR-095 §1.2 사용자 facing 활성)', async () => {
    const m = await import('./AutoReferenceImportSettings');
    expect(m.getAutoReferenceImportMode()).toBe(true);
  });

  it('localStorage "true" → ON (matches default)', async () => {
    localStorage.setItem('axia:auto-reference-import', 'true');
    const m = await import('./AutoReferenceImportSettings');
    expect(m.getAutoReferenceImportMode()).toBe(true);
  });

  it('localStorage "false" → OFF (explicit OFF preference 보존)', async () => {
    localStorage.setItem('axia:auto-reference-import', 'false');
    const m = await import('./AutoReferenceImportSettings');
    expect(m.getAutoReferenceImportMode()).toBe(false);
  });

  it('setAutoReferenceImportMode persists to localStorage', async () => {
    // Default true → first toggle is to false.
    const m = await import('./AutoReferenceImportSettings');
    m.setAutoReferenceImportMode(false);
    expect(localStorage.getItem('axia:auto-reference-import')).toBe('false');
    m.setAutoReferenceImportMode(true);
    expect(localStorage.getItem('axia:auto-reference-import')).toBe('true');
  });

  it('onAutoReferenceImportModeChange fires on actual change only', async () => {
    const m = await import('./AutoReferenceImportSettings');
    const cb = vi.fn();
    const unsubscribe = m.onAutoReferenceImportModeChange(cb);

    m.setAutoReferenceImportMode(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);

    // No-op when value unchanged.
    m.setAutoReferenceImportMode(false);
    expect(cb).toHaveBeenCalledTimes(1);

    m.setAutoReferenceImportMode(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    m.setAutoReferenceImportMode(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
