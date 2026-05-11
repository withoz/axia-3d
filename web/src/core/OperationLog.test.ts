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

  // ── Phase 2 — Dependency graph ──
  it('record stores inputs/outputs (default empty)', () => {
    const e = log.record('fillet-edge', 'a', '1');
    expect(e.inputs).toEqual([]);
    expect(e.outputs).toEqual([]);
    const e2 = log.record('thicken-faces', 'b', '50',
      { inputs: [10, 20], outputs: [100, 101] });
    expect(e2.inputs).toEqual([10, 20]);
    expect(e2.outputs).toEqual([100, 101]);
  });

  it('getDependents finds direct successors via output → input intersection', () => {
    const a = log.record('thicken-faces', 'a', '10',
      { inputs: [1], outputs: [2, 3] });
    const b = log.record('fillet-edge', 'b', '5',
      { inputs: [3], outputs: [4] });
    const _c = log.record('subdivide', 'c', '2',
      { inputs: [99], outputs: [100] }); // unrelated
    const dep = log.getDependents(a.id);
    expect(dep.map(e => e.id)).toEqual([b.id]);
  });

  it('getCascadeChain returns transitive closure', () => {
    const a = log.record('thicken-faces', 'a', '10',
      { inputs: [1], outputs: [2] });
    const b = log.record('fillet-edge', 'b', '5',
      { inputs: [2], outputs: [3] });
    const c = log.record('chamfer-edge', 'c', '1',
      { inputs: [3], outputs: [4] });
    const chain = log.getCascadeChain(a.id);
    expect(chain.map(e => e.id)).toEqual([b.id, c.id]);
  });

  it('findUpstream finds predecessors via input → output intersection', () => {
    const a = log.record('thicken-faces', 'a', '10',
      { inputs: [1], outputs: [2] });
    const b = log.record('fillet-edge', 'b', '5',
      { inputs: [2], outputs: [3] });
    expect(log.findUpstream(b.id).map(e => e.id)).toEqual([a.id]);
    expect(log.findUpstream(a.id)).toEqual([]);
  });

  it('getDependents handles multiple branches', () => {
    const a = log.record('thicken-faces', 'a', '10',
      { inputs: [1], outputs: [2, 3] });
    const b = log.record('fillet-edge', 'b', '5',
      { inputs: [2], outputs: [10] });
    const c = log.record('chamfer-edge', 'c', '1',
      { inputs: [3], outputs: [11] });
    const dep = log.getDependents(a.id);
    expect(dep.map(e => e.id).sort()).toEqual([b.id, c.id].sort());
  });
});
