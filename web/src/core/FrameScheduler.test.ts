import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { frameScheduler } from './FrameScheduler';
import { telemetry } from './telemetry';

describe('FrameScheduler — ADR-012 §2 rAF 체인 깊이 ≤ 1 보장', () => {
  beforeEach(() => {
    frameScheduler.setSyncMode(true);  // run synchronously for tests
    telemetry.reset();
  });
  afterEach(() => {
    frameScheduler.setSyncMode(false);
  });

  it('runs scheduled task synchronously in sync mode', () => {
    const fn = vi.fn();
    frameScheduler.schedule('smoothNormals', fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(frameScheduler.size).toBe(0);
  });

  it('dedup: same key replaces previous task (latest wins)', () => {
    frameScheduler.setSyncMode(false);
    const a = vi.fn(), b = vi.fn();
    frameScheduler.schedule('smoothNormals', a);
    frameScheduler.schedule('smoothNormals', b);
    // Only `b` should run when flushed.
    frameScheduler.flushNow();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('different keys run independently', () => {
    frameScheduler.setSyncMode(false);
    const a = vi.fn(), b = vi.fn();
    frameScheduler.schedule('smoothNormals', a);
    frameScheduler.schedule('snapRebuild', b);
    expect(frameScheduler.size).toBe(2);
    frameScheduler.flushNow();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('cancel() removes pending task', () => {
    frameScheduler.setSyncMode(false);
    const fn = vi.fn();
    frameScheduler.schedule('smoothNormals', fn);
    expect(frameScheduler.has('smoothNormals')).toBe(true);
    frameScheduler.cancel('smoothNormals');
    expect(frameScheduler.has('smoothNormals')).toBe(false);
    frameScheduler.flushNow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('captures task elapsed time into telemetry', () => {
    frameScheduler.setSyncMode(false);
    // Slow task that exceeds smoothNormals budget (16ms).
    const slow = () => {
      const end = performance.now() + 25;
      while (performance.now() < end) { /* burn */ }
    };
    frameScheduler.schedule('smoothNormals', slow);
    frameScheduler.flushNow();
    const violations = telemetry.violationsByKey('smoothNormals');
    expect(violations.length).toBe(1);
    expect(violations[0].elapsed).toBeGreaterThan(16);
  });

  it('rAF chain depth incremented during flush', () => {
    frameScheduler.setSyncMode(false);
    let depthSeen = 0;
    frameScheduler.schedule('smoothNormals', () => {
      depthSeen = telemetry.snapshot().rafChainDepth;
    });
    frameScheduler.flushNow();
    expect(depthSeen).toBe(1);
    expect(telemetry.snapshot().rafChainDepth).toBe(0); // released after
    expect(telemetry.snapshot().maxRafChainDepth).toBe(1);
  });

  it('chain depth stays ≤ 1 even when a task schedules another', () => {
    frameScheduler.setSyncMode(false);
    let depthInChild = 0;
    frameScheduler.schedule('smoothNormals', () => {
      // A task scheduling another task — must NOT immediately recurse.
      // The new task goes into queue and runs in NEXT rAF (depth back to 0
      // in between). Here we just record the depth at this point.
      depthInChild = telemetry.snapshot().rafChainDepth;
      frameScheduler.schedule('snapRebuild', () => {
        // This will be scheduled for next rAF by the scheduler.
      });
    });
    frameScheduler.flushNow();
    // child task hasn't run yet — it's in the queue for the next rAF.
    expect(depthInChild).toBe(1);
    expect(telemetry.snapshot().maxRafChainDepth).toBe(1);
    // Drain the next rAF
    frameScheduler.flushNow();
    expect(telemetry.snapshot().maxRafChainDepth).toBe(1);
  });

  it('errors in tasks are caught and logged', () => {
    frameScheduler.setSyncMode(false);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    frameScheduler.schedule('smoothNormals', () => { throw new Error('boom'); });
    frameScheduler.flushNow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('flushNow with empty queue is a no-op', () => {
    expect(() => frameScheduler.flushNow()).not.toThrow();
  });
});
