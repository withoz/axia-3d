import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceContainer } from './ServiceContainer';

// Stub debugLog to avoid side effects
vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  it('register + get: basic registration and retrieval', () => {
    const svc = { name: 'bridge' };
    container.register('bridge', svc);
    expect(container.get('bridge')).toBe(svc);
  });

  it('get throws on missing key', () => {
    expect(() => container.get('nonexistent')).toThrowError(/Service not found/);
  });

  it('has returns true for registered, false for missing', () => {
    container.register('viewport', {});
    expect(container.has('viewport')).toBe(true);
    expect(container.has('missing')).toBe(false);
  });

  it('tryGet returns undefined for missing key', () => {
    expect(container.tryGet('missing')).toBeUndefined();
  });

  it('tryGet returns service when registered', () => {
    const svc = { id: 1 };
    container.register('svc', svc);
    expect(container.tryGet('svc')).toBe(svc);
  });

  it('freeze prevents further registration', () => {
    container.freeze();
    expect(() => container.register('x', {})).toThrowError(/frozen/);
  });

  it('unfreeze allows registration after freeze', () => {
    container.freeze();
    container.unfreeze();
    const svc = { ok: true };
    container.register('x', svc);
    expect(container.get('x')).toBe(svc);
  });

  it('overwrite logs console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    container.register('dup', { v: 1 });
    container.register('dup', { v: 2 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Overwriting')
    );
    expect(container.get<{ v: number }>('dup').v).toBe(2);
    warnSpy.mockRestore();
  });

  it('unregister removes a service', () => {
    container.register('temp', {});
    expect(container.has('temp')).toBe(true);
    container.unregister('temp');
    expect(container.has('temp')).toBe(false);
  });

  it('clear removes all services', () => {
    container.register('a', 1);
    container.register('b', 2);
    container.register('c', 3);
    container.clear();
    expect(container.size()).toBe(0);
    expect(container.has('a')).toBe(false);
  });

  it('keys returns registered key names', () => {
    container.register('alpha', 1);
    container.register('beta', 2);
    expect(container.keys()).toEqual(['alpha', 'beta']);
  });

  it('size returns the number of registered services', () => {
    expect(container.size()).toBe(0);
    container.register('one', 1);
    expect(container.size()).toBe(1);
    container.register('two', 2);
    expect(container.size()).toBe(2);
  });
});
