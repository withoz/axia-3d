import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evictionPolicy, installEvictionGlobal } from './eviction';
import { memoryBudget } from './memory';

describe('EvictionPolicy — ADR-013 §3', () => {
  beforeEach(() => {
    evictionPolicy.reset();
    // Reset memory samplers to safe defaults
    for (const a of memoryBudget.registeredAreas()) {
      memoryBudget.registerSampler(a, () => 0);
    }
  });

  it('register handlers in priority order', () => {
    evictionPolicy.register('z', 5, () => 0);
    evictionPolicy.register('a', 1, () => 0);
    evictionPolicy.register('m', 3, () => 0);
    expect(evictionPolicy.registeredAreas()).toEqual(['a', 'm', 'z']);
  });

  it('re-registering same area replaces (not duplicates)', () => {
    evictionPolicy.register('snap', 1, () => 0);
    evictionPolicy.register('snap', 2, () => 0);
    expect(evictionPolicy.size).toBe(1);
  });

  it('runIfNeeded — does nothing when memory is fine', () => {
    const fn = vi.fn(() => 1000);
    evictionPolicy.register('snap', 1, fn);
    const r = evictionPolicy.runIfNeeded();
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('none');
    expect(fn).not.toHaveBeenCalled();
  });

  it('runIfNeeded with force=true runs all handlers', () => {
    const a = vi.fn(() => 100);
    const b = vi.fn(() => 200);
    evictionPolicy.register('snap', 1, a);
    evictionPolicy.register('bvh',  2, b);
    const r = evictionPolicy.runIfNeeded({ force: true });
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe('manual');
    expect(r.bytesFreed).toBe(300);
    expect(r.areasEvicted).toEqual(['snap', 'bvh']);
  });

  it('soft-limit triggers eviction; stops when below threshold', () => {
    // Simulate memory: bvh over soft (40), drops below after evict
    let bvhBytes = 50 * 1024 * 1024; // 50MB > soft 40
    memoryBudget.registerSampler('bvh', () => bvhBytes);
    evictionPolicy.register('snap', 1, () => 0);  // does nothing
    evictionPolicy.register('bvh',  2, () => {
      const freed = bvhBytes;
      bvhBytes = 0;
      return freed;
    });
    evictionPolicy.register('history', 3, () => 0);

    const r = evictionPolicy.runIfNeeded();
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe('soft');
    // snap ran first (no-op, returns 0 → not in areasEvicted)
    // bvh ran second, freed memory, then we drop below soft → stop
    expect(r.areasEvicted).toEqual(['bvh']);
    expect(r.bytesFreed).toBeGreaterThan(0);
  });

  it('hard-limit runs all handlers regardless of midway recovery', () => {
    // memory persistently over hard
    memoryBudget.registerSampler('bvh', () => 100 * 1024 * 1024);  // way over hard 60

    const a = vi.fn(() => 1000);
    const b = vi.fn(() => 2000);
    const c = vi.fn(() => 3000);
    evictionPolicy.register('snap', 1, a);
    evictionPolicy.register('bvh',  2, b);
    evictionPolicy.register('history', 3, c);

    const r = evictionPolicy.runIfNeeded();
    expect(r.reason).toBe('hard');
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(c).toHaveBeenCalled();
  });

  it('evict handler error does not break the loop', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    memoryBudget.registerSampler('bvh', () => 100 * 1024 * 1024);
    evictionPolicy.register('bad',  1, () => { throw new Error('x'); });
    evictionPolicy.register('good', 2, () => 100);
    const r = evictionPolicy.runIfNeeded();
    expect(r.areasEvicted).toContain('good');
    spy.mockRestore();
  });

  it('unregister removes a handler', () => {
    evictionPolicy.register('a', 1, () => 0);
    evictionPolicy.register('b', 2, () => 0);
    evictionPolicy.unregister('a');
    expect(evictionPolicy.registeredAreas()).toEqual(['b']);
  });

  it('installEvictionGlobal exposes window.__AXIA_EVICT', () => {
    delete (window as any).__AXIA_EVICT;
    installEvictionGlobal();
    expect(typeof (window as any).__AXIA_EVICT).toBe('function');
  });
});
