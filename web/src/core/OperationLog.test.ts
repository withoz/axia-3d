import { describe, it, expect, beforeEach } from 'vitest';
import { OperationLog } from './OperationLog';

describe('OperationLog', () => {
  let log: OperationLog;
  beforeEach(() => { log = new OperationLog(5); });

  it('records entries with unique ids and timestamps', () => {
    const a = log.record('fillet-edge', '모깎기 50mm', '50');
    const b = log.record('thicken-faces', '두께 200mm', '200');
    expect(a.id).not.toBe(b.id);
    expect(a.kind).toBe('fillet-edge');
    expect(b.displayName).toContain('200');
    expect(log.getAll().length).toBe(2);
  });

  it('enforces cap (oldest evicted)', () => {
    for (let i = 0; i < 10; i++) {
      log.record('subdivide', `#${i}`, '');
    }
    expect(log.getAll().length).toBe(5);
    // Oldest surviving is #5
    expect(log.getAll()[0].displayName).toBe('#5');
  });

  it('notifies listeners on record and clear', () => {
    let calls = 0;
    const off = log.onChange(() => { calls++; });
    log.record('fillet-edge', 'a', '1');
    log.record('fillet-edge', 'b', '2');
    expect(calls).toBe(2);
    log.clear();
    expect(calls).toBe(3);
    off();
    log.record('fillet-edge', 'c', '3');
    expect(calls).toBe(3); // unsubscribed
  });

  it('getById returns matching entry or undefined', () => {
    const e = log.record('array-linear', 'linear', 'x');
    expect(log.getById(e.id)?.kind).toBe('array-linear');
    expect(log.getById(99999)).toBeUndefined();
  });

  it('clear empties the log', () => {
    log.record('fillet-edge', 'a', '1');
    log.clear();
    expect(log.getAll().length).toBe(0);
  });
});
