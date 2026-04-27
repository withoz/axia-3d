import { describe, it, expect, beforeEach } from 'vitest';
import { memoryBudget, BoundedLRU, MEMORY_BUDGETS, installMemoryGlobal } from './memory';

describe('memoryBudget — ADR-013 §1', () => {
  beforeEach(() => {
    // Reset by re-creating samplers map via private trick — easier: run all
    // tests serially and clean known keys.
    for (const key of memoryBudget.registeredAreas()) {
      // force re-register with zero sampler so subsequent tests see 0.
      memoryBudget.registerSampler(key, () => 0);
    }
  });

  it('snapshot returns bytes/mb/pct/tier per registered area', () => {
    memoryBudget.registerSampler('rust',     () => 50 * 1024 * 1024);  // 50 MB (target)
    memoryBudget.registerSampler('geometry', () => 90 * 1024 * 1024);  // 90 MB (target+)
    memoryBudget.registerSampler('bvh',      () => 50 * 1024 * 1024);  // 50 MB (soft+)
    const s = memoryBudget.snapshot();
    expect(s.mb.rust).toBeCloseTo(50, 0);
    expect(s.mb.geometry).toBeCloseTo(90, 0);
    expect(s.tier.rust).toBe('ok');
    expect(s.tier.geometry).toBe('target+');
    expect(s.tier.bvh).toBe('soft+');
  });

  it('isOverHardLimit detects hard tier', () => {
    memoryBudget.registerSampler('rust', () => 200 * 1024 * 1024); // way over hard
    expect(memoryBudget.isOverHardLimit()).toBe(true);
    expect(memoryBudget.isOverSoftLimit()).toBe(true);
  });

  it('areasOverSoft lists violators', () => {
    memoryBudget.registerSampler('rust', () => 100 * 1024 * 1024);  // soft+
    memoryBudget.registerSampler('bvh',  () => 0);                  // ok
    const a = memoryBudget.areasOverSoft();
    expect(a).toContain('rust');
    expect(a).not.toContain('bvh');
  });

  it('totalMb sums all areas', () => {
    memoryBudget.registerSampler('rust',     () => 50 * 1024 * 1024);
    memoryBudget.registerSampler('geometry', () => 80 * 1024 * 1024);
    const s = memoryBudget.snapshot();
    expect(s.totalMb).toBeCloseTo(130, 0);
  });

  it('handles sampler that throws (returns 0)', () => {
    memoryBudget.registerSampler('rust', () => { throw new Error('boom'); });
    const s = memoryBudget.snapshot();
    expect(s.bytes.rust).toBe(0);
  });

  it('MEMORY_BUDGETS has expected areas', () => {
    expect(MEMORY_BUDGETS.rust).toBeDefined();
    expect(MEMORY_BUDGETS.geometry).toBeDefined();
    expect(MEMORY_BUDGETS.bvh).toBeDefined();
    expect(MEMORY_BUDGETS.snapCache).toBeDefined();
    expect(MEMORY_BUDGETS.history).toBeDefined();
    expect(MEMORY_BUDGETS.undo).toBeDefined();
    // hard > soft > target
    for (const v of Object.values(MEMORY_BUDGETS)) {
      expect(v.hard).toBeGreaterThan(v.soft);
      expect(v.soft).toBeGreaterThan(v.target);
    }
  });

  it('installMemoryGlobal exposes window.__AXIA_MEMORY getter', () => {
    (window as any).__AXIA_DEBUG = true;
    delete (window as any).__AXIA_MEMORY;
    installMemoryGlobal();
    const snap = (window as any).__AXIA_MEMORY;
    expect(snap).toBeDefined();
    expect(typeof snap.totalMb).toBe('number');
  });

  it('window.__AXIA_MEMORY shows hint when DEBUG=false', () => {
    (window as any).__AXIA_DEBUG = false;
    installMemoryGlobal();
    const snap = (window as any).__AXIA_MEMORY as any;
    expect(snap.hint).toContain('__AXIA_DEBUG');
  });
});

describe('BoundedLRU — ADR-013 §2 bounded collection helper', () => {
  it('caps at the given size, evicting least-recently-used', () => {
    const c = new BoundedLRU<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.size).toBe(3);
    c.set('d', 4);  // a evicted
    expect(c.size).toBe(3);
    expect(c.has('a')).toBe(false);
    expect(c.has('d')).toBe(true);
  });

  it('get() promotes entry to most-recent', () => {
    const c = new BoundedLRU<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    c.get('a');           // a is now most-recent; b is oldest
    c.set('d', 4);        // b evicted
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });

  it('set() with existing key reorders + replaces value', () => {
    const c = new BoundedLRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.set('a', 99);       // replace + promote
    expect(c.get('a')).toBe(99);
  });

  it('clear() empties the cache', () => {
    const c = new BoundedLRU<string, number>(5);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('throws if cap < 1', () => {
    expect(() => new BoundedLRU<string, number>(0)).toThrow();
  });

  it('reports capacity', () => {
    const c = new BoundedLRU<string, number>(7);
    expect(c.capacity).toBe(7);
  });
});
