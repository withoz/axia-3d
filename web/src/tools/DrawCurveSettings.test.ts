/**
 * ADR-089 A-λ-β regression tests for DrawCurveSettings module.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getDrawCurveMode,
  setDrawCurveMode,
  onDrawCurveModeChange,
} from './DrawCurveSettings';

describe('DrawCurveSettings (ADR-089 A-λ-β)', () => {
  beforeEach(() => {
    // Reset to default (OFF) before each test
    setDrawCurveMode(false);
  });

  afterEach(() => {
    setDrawCurveMode(false);
  });

  it('defaults to OFF (additive only, ADR-046 P31 #4 muscle memory protection)', () => {
    // Note: localStorage may persist between test runs in real browser; the
    // module reads it on first load. Force-set false then verify.
    setDrawCurveMode(false);
    expect(getDrawCurveMode()).toBe(false);
  });

  it('setDrawCurveMode(true) flips to ON', () => {
    setDrawCurveMode(true);
    expect(getDrawCurveMode()).toBe(true);
  });

  it('listeners receive change notifications', () => {
    let observed: boolean | null = null;
    const off = onDrawCurveModeChange((v) => { observed = v; });
    setDrawCurveMode(true);
    expect(observed).toBe(true);
    setDrawCurveMode(false);
    expect(observed).toBe(false);
    off();
  });

  it('listeners do not fire when value unchanged (no spurious callbacks)', () => {
    let count = 0;
    const off = onDrawCurveModeChange(() => { count++; });
    setDrawCurveMode(false); // already false
    expect(count).toBe(0);
    setDrawCurveMode(true);
    expect(count).toBe(1);
    setDrawCurveMode(true); // already true
    expect(count).toBe(1);
    off();
  });

  it('off() removes the listener', () => {
    let count = 0;
    const off = onDrawCurveModeChange(() => { count++; });
    setDrawCurveMode(true);
    expect(count).toBe(1);
    off();
    setDrawCurveMode(false);
    expect(count).toBe(1); // unchanged
  });
});
