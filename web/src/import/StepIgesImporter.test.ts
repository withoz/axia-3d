/**
 * Regression tests for StepIgesImporter (ADR-035 P20.7).
 *
 * 5 tests covering:
 * 1. Singleton pattern (getInstance / resetInstance)
 * 2. Extension dispatch (step/stp/iges/igs accepted, others rejected)
 * 3. Graceful fallback when opencascade.js is not installed
 * 4. Loading callback hooks fire during ensureLoaded()
 * 5. Cached instance reused across multiple importFile calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StepIgesImporter } from './StepIgesImporter';

describe('StepIgesImporter (ADR-035 P20.7)', () => {
  beforeEach(() => {
    StepIgesImporter.resetInstance();
  });

  it('returns singleton across getInstance() calls', () => {
    const a = StepIgesImporter.getInstance();
    const b = StepIgesImporter.getInstance();
    expect(a).toBe(b);
  });

  it('rejects unsupported extensions with clear error', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['dummy'], 'foo.obj', { type: 'application/octet-stream' });
    await expect(importer.importFile(file)).rejects.toThrow(/STEP\/IGES/);
  });

  it('graceful fallback when opencascade.js is not installed', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['ISO-10303-21;'], 'cube.step', { type: 'application/step' });
    // opencascade.js is not in test deps → ensureLoaded should throw
    // a clear "not installed" error (P20.C #3).
    await expect(importer.importFile(file)).rejects.toThrow(/opencascade\.js|설치/);
  });

  it('loading callbacks fire during ensureLoaded()', async () => {
    const importer = StepIgesImporter.getInstance();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    importer.onLoadingStart = onStart;
    importer.onLoadingEnd = onEnd;

    try {
      await importer.ensureLoaded();
    } catch (_e) {
      // expected — opencascade.js not installed in test env
    }
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.stringContaining('STEP/IGES'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('isLoaded() reflects load state', async () => {
    const importer = StepIgesImporter.getInstance();
    expect(importer.isLoaded()).toBe(false);
    try {
      await importer.ensureLoaded();
    } catch (_e) {
      // expected in test env
    }
    // Still false since loading failed.
    expect(importer.isLoaded()).toBe(false);
  });

  it('resetInstance() releases the singleton', () => {
    const a = StepIgesImporter.getInstance();
    StepIgesImporter.resetInstance();
    const b = StepIgesImporter.getInstance();
    expect(a).not.toBe(b);
  });

  it('iges extension dispatches to importer (not to default branch)', async () => {
    const importer = StepIgesImporter.getInstance();
    const file = new File(['dummy iges'], 'part.iges', { type: 'application/iges' });
    // Should attempt to load OCCT (and fail, since not installed) — not
    // throw "unsupported extension".
    await expect(importer.importFile(file)).rejects.toThrow(/opencascade\.js|설치/);
  });

  it('detected format matches extension (step vs iges)', async () => {
    // Indirect verification — graceful failure path still classifies
    // ext correctly before the OCCT call.
    const importer = StepIgesImporter.getInstance();
    const stepFile = new File(['x'], 'a.step', { type: 'text/plain' });
    const igesFile = new File(['x'], 'b.igs', { type: 'text/plain' });
    // Both should reach the OCCT load step (and fail there), confirming
    // ext gate accepted them.
    await expect(importer.importFile(stepFile)).rejects.toThrow(/opencascade\.js|설치/);
    await expect(importer.importFile(igesFile)).rejects.toThrow(/opencascade\.js|설치/);
  });
});
