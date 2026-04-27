import { describe, it, expect, beforeEach, vi } from 'vitest';
import { telemetry, BUDGETS, installTelemetryGlobal } from './telemetry';

describe('telemetry — ADR-012 Latency Budget instrumentation', () => {
  beforeEach(() => {
    telemetry.reset();
    // jsdom has window
    delete (window as any).__AXIA_TELEMETRY;
    delete (window as any).__AXIA_TELEMETRY_RESET;
    delete (window as any).__AXIA_TELEMETRY_TICK;
    delete (window as any).__AXIA_TELEMETRY_FRAME_START;
    delete (window as any).__AXIA_TELEMETRY_FRAME_END;
    delete (window as any).__AXIA_TELEMETRY_RECORD;
    (window as any).__AXIA_DEBUG = true;  // expose live snapshot
  });

  describe('BUDGETS', () => {
    it('defines hover/click/commit/heavy in ms', () => {
      expect(BUDGETS.hover).toBe(16);
      expect(BUDGETS.click).toBe(33);
      expect(BUDGETS.commit).toBe(100);
      expect(BUDGETS.heavy).toBe(500);
    });

    it('defines internal task budgets ≤ user-input budgets', () => {
      // Internal tasks must fit inside one frame.
      expect(BUDGETS.smoothNormals).toBeLessThanOrEqual(BUDGETS.click);
      expect(BUDGETS.snapRebuild).toBeLessThanOrEqual(BUDGETS.click);
    });
  });

  describe('measure() / record()', () => {
    it('does not record when within budget', () => {
      telemetry.measure('hover', () => { /* fast */ });
      const snap = telemetry.snapshot();
      expect(snap.budgetViolations).toHaveLength(0);
      expect(snap.tasksObserved).toBe(1);
    });

    it('records a violation when over budget', () => {
      telemetry.record('hover', 50); // 50 > 16
      const snap = telemetry.snapshot();
      expect(snap.budgetViolations).toHaveLength(1);
      expect(snap.budgetViolations[0].key).toBe('hover');
      expect(snap.budgetViolations[0].elapsed).toBe(50);
      expect(snap.budgetViolations[0].budget).toBe(16);
    });

    it('largestTask tracks the worst observed', () => {
      telemetry.record('commit', 120);
      telemetry.record('hover', 200);
      telemetry.record('snapRebuild', 18);
      const snap = telemetry.snapshot();
      expect(snap.largestTask?.elapsed).toBe(200);
      expect(snap.largestTask?.key).toBe('hover');
    });

    it('measure() returns the wrapped function value', () => {
      const v = telemetry.measure('hover', () => 42);
      expect(v).toBe(42);
    });

    it('measure() still records on thrown error', () => {
      expect(() => {
        telemetry.measure('hover', () => { throw new Error('x'); });
      }).toThrow();
      expect(telemetry.snapshot().tasksObserved).toBe(1);
    });
  });

  describe('rAF chain depth', () => {
    it('starts at 0, increments on enter, decrements on exit', () => {
      expect(telemetry.snapshot().rafChainDepth).toBe(0);
      telemetry.enterRaf();
      expect(telemetry.snapshot().rafChainDepth).toBe(1);
      telemetry.exitRaf();
      expect(telemetry.snapshot().rafChainDepth).toBe(0);
    });

    it('maxRafChainDepth tracks worst depth seen (chain detection)', () => {
      telemetry.enterRaf();
      telemetry.enterRaf();  // chain depth 2 — bug indicator
      telemetry.exitRaf();
      telemetry.exitRaf();
      expect(telemetry.snapshot().maxRafChainDepth).toBe(2);
    });
  });

  describe('frame timing + crossings', () => {
    it('records frame elapsed time + crossings per frame', async () => {
      telemetry.startFrame();
      telemetry.recordCrossing();
      telemetry.recordCrossing();
      await new Promise(r => setTimeout(r, 5));
      telemetry.endFrame();
      const snap = telemetry.snapshot();
      expect(snap.framesObserved).toBe(1);
      expect(snap.avgFrameTime).toBeGreaterThan(0);
      expect(snap.avgCrossingsPerFrame).toBeGreaterThanOrEqual(2);
    });

    it('crossingsThisFrame resets at endFrame', () => {
      telemetry.startFrame();
      telemetry.recordCrossing();
      telemetry.endFrame();
      expect(telemetry.snapshot().crossingsThisFrame).toBe(0);
    });
  });

  describe('frame crossing limit (ADR-012 §3)', () => {
    it('records a violation when crossings/frame > 4', () => {
      telemetry.startFrame();
      for (let i = 0; i < 5; i++) telemetry.recordCrossing();
      telemetry.endFrame();
      const violations = telemetry.violationsByKey('wasmCall');
      expect(violations.length).toBe(1);
      expect(violations[0].elapsed).toBe(5);  // crossings count
      expect(violations[0].budget).toBe(4);   // CROSSING_PER_FRAME_LIMIT
    });

    it('no violation when crossings ≤ 4', () => {
      telemetry.startFrame();
      for (let i = 0; i < 4; i++) telemetry.recordCrossing();
      telemetry.endFrame();
      expect(telemetry.violationsByKey('wasmCall').length).toBe(0);
    });

    it('crossings reset between frames (no carry-over)', () => {
      telemetry.startFrame();
      for (let i = 0; i < 5; i++) telemetry.recordCrossing();
      telemetry.endFrame();
      telemetry.startFrame();
      telemetry.recordCrossing();
      telemetry.endFrame();
      // First frame violated (5), second frame clean (1)
      expect(telemetry.violationsByKey('wasmCall').length).toBe(1);
    });
  });

  describe('bounded collections (ADR-013 §2)', () => {
    it('violations ring buffer caps at 1000', () => {
      for (let i = 0; i < 1500; i++) telemetry.record('hover', 100);
      expect(telemetry.snapshot().budgetViolations.length).toBe(1000);
    });
  });

  describe('violationsByKey filter', () => {
    it('returns only violations for given key', () => {
      telemetry.record('hover', 50);
      telemetry.record('commit', 200);
      telemetry.record('hover', 30);
      expect(telemetry.violationsByKey('hover').length).toBe(2);
      expect(telemetry.violationsByKey('commit').length).toBe(1);
    });
  });

  describe('reset()', () => {
    it('clears all counters', () => {
      telemetry.record('hover', 50);
      telemetry.startFrame();
      telemetry.recordCrossing();
      telemetry.enterRaf();
      telemetry.reset();
      const s = telemetry.snapshot();
      expect(s.budgetViolations).toHaveLength(0);
      expect(s.tasksObserved).toBe(0);
      expect(s.framesObserved).toBe(0);
      expect(s.rafChainDepth).toBe(0);
      expect(s.crossingsThisFrame).toBe(0);
      expect(s.largestTask).toBe(null);
    });
  });

  describe('installTelemetryGlobal', () => {
    it('installs window.__AXIA_TELEMETRY_TICK / FRAME_START / FRAME_END / RECORD', () => {
      installTelemetryGlobal();
      expect(typeof (window as any).__AXIA_TELEMETRY_TICK).toBe('function');
      expect(typeof (window as any).__AXIA_TELEMETRY_FRAME_START).toBe('function');
      expect(typeof (window as any).__AXIA_TELEMETRY_FRAME_END).toBe('function');
      expect(typeof (window as any).__AXIA_TELEMETRY_RECORD).toBe('function');
    });

    it('window.__AXIA_TELEMETRY getter returns current snapshot when DEBUG=true', () => {
      installTelemetryGlobal();
      telemetry.record('hover', 50);
      const snap = (window as any).__AXIA_TELEMETRY;
      expect(snap.budgetViolations.length).toBe(1);
    });

    it('TICK increments crossing count', () => {
      installTelemetryGlobal();
      telemetry.startFrame();
      (window as any).__AXIA_TELEMETRY_TICK();
      (window as any).__AXIA_TELEMETRY_TICK();
      expect(telemetry.snapshot().crossingsThisFrame).toBe(2);
    });

    it('RECORD validates key against BUDGETS (unknown silently ignored)', () => {
      installTelemetryGlobal();
      (window as any).__AXIA_TELEMETRY_RECORD('hover', 50);
      (window as any).__AXIA_TELEMETRY_RECORD('zzzunknown', 50);
      expect(telemetry.snapshot().budgetViolations.length).toBe(1);
    });

    it('TELEMETRY_RESET clears state', () => {
      installTelemetryGlobal();
      telemetry.record('hover', 50);
      (window as any).__AXIA_TELEMETRY_RESET();
      expect(telemetry.snapshot().budgetViolations.length).toBe(0);
    });

    it('snapshot includes a hint when DEBUG is off', () => {
      installTelemetryGlobal();
      (window as any).__AXIA_DEBUG = false;
      const snap = (window as any).__AXIA_TELEMETRY as any;
      expect(snap.hint).toBeTruthy();
      expect(snap.hint).toContain('__AXIA_DEBUG');
    });
  });
});
