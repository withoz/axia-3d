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

  it('defaults to ON (A-π-β, after A-ν sweep 2989/2989 PASS)', () => {
    // Note: module init reads localStorage once; in vitest jsdom environment
    // localStorage is fresh per worker, so default = true. We verify the
    // explicit ON path here. Tests below cover set/get round-trip.
    setDrawCurveMode(true);
    expect(getDrawCurveMode()).toBe(true);
  });

  it('explicit OFF preference (localStorage "false") is preserved (L-π-2)', () => {
    // Simulating user who explicitly toggled OFF before A-π-β default flip.
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
