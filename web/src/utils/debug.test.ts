/**
 * Tests for debug logging utility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDebug, debugLog, debugWarn } from './debug';

describe('debug utility', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete (window as any).__AXIA_DEBUG;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('isDebug()', () => {
    it('returns false when __AXIA_DEBUG is not set', () => {
      expect(isDebug()).toBe(false);
    });

    it('returns true when __AXIA_DEBUG is true', () => {
      window.__AXIA_DEBUG = true;
      expect(isDebug()).toBe(true);
    });

    it('returns false when __AXIA_DEBUG is false', () => {
      window.__AXIA_DEBUG = false;
      expect(isDebug()).toBe(false);
    });
  });

  describe('debugLog()', () => {
    it('does not output when debug is off', () => {
      debugLog('test message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('outputs when debug is on', () => {
      window.__AXIA_DEBUG = true;
      debugLog('hello', 42);
      expect(consoleSpy).toHaveBeenCalledWith('hello', 42);
    });

    it('passes multiple arguments', () => {
      window.__AXIA_DEBUG = true;
      debugLog('a', 'b', 'c');
      expect(consoleSpy).toHaveBeenCalledWith('a', 'b', 'c');
    });
  });

  describe('debugWarn()', () => {
    it('does not output when debug is off', () => {
      debugWarn('test warning');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('outputs when debug is on', () => {
      window.__AXIA_DEBUG = true;
      debugWarn('warning!');
      expect(warnSpy).toHaveBeenCalledWith('warning!');
    });
  });
});
