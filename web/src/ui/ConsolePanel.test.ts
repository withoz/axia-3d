import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConsolePanel } from './ConsolePanel';

describe('ConsolePanel', () => {
  let panel: ConsolePanel;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  let origInfo: typeof console.info;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Snapshot console methods so install/uninstall doesn't leak between tests.
    origError = console.error;
    origWarn = console.warn;
    origInfo = console.info;
    panel = new ConsolePanel({ autoOpenOnError: false });
  });

  afterEach(() => {
    panel.uninstall();
    console.error = origError;
    console.warn = origWarn;
    console.info = origInfo;
  });

  describe('install / uninstall', () => {
    it('mounts a DOM element on install', () => {
      panel.install();
      expect(document.getElementById('axia-console-panel')).toBeTruthy();
    });

    it('removes DOM on uninstall', () => {
      panel.install();
      panel.uninstall();
      expect(document.getElementById('axia-console-panel')).toBeFalsy();
    });

    it('install is idempotent', () => {
      panel.install();
      panel.install();
      // Only one element should exist
      expect(document.querySelectorAll('#axia-console-panel').length).toBe(1);
    });
  });

  describe('console hooks', () => {
    it('captures console.error after install', () => {
      panel.install();
      console.error('boom');
      const entries = panel.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
      expect(entries[0].message).toBe('boom');
    });

    it('captures console.warn after install', () => {
      panel.install();
      console.warn('ouch');
      expect(panel.getEntries()[0].level).toBe('warn');
    });

    it('captures console.info after install', () => {
      panel.install();
      console.info('hi');
      expect(panel.getEntries()[0].level).toBe('info');
    });

    it('does NOT capture console.log (intentional — debugLog noise filter)', () => {
      panel.install();
      console.log('chatty');
      expect(panel.getEntries()).toHaveLength(0);
    });

    it('passes through to original console (DevTools still works)', () => {
      const realErr = vi.fn();
      console.error = realErr;
      panel.install();
      console.error('forwarded');
      expect(realErr).toHaveBeenCalledWith('forwarded');
    });
  });

  describe('global error capture', () => {
    it('captures window.error events', () => {
      panel.install();
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'global boom',
          filename: 'foo.ts',
          lineno: 42,
        }),
      );
      const entries = panel.getEntries();
      const entry = entries.find((e) => e.source === 'window.error');
      expect(entry?.message).toContain('global boom');
      expect(entry?.message).toContain('foo.ts:42');
    });

    it('captures unhandledrejection events', () => {
      panel.install();
      const event = new Event('unhandledrejection') as PromiseRejectionEvent;
      Object.defineProperty(event, 'reason', { value: new Error('oops') });
      window.dispatchEvent(event);
      const entry = panel.getEntries().find((e) => e.source === 'unhandledrejection');
      expect(entry?.message).toContain('Unhandled promise');
      expect(entry?.message).toContain('oops');
    });
  });

  describe('LRU buffer', () => {
    it('evicts oldest entries beyond maxEntries', () => {
      const small = new ConsolePanel({ maxEntries: 5, autoOpenOnError: false });
      small.install();
      try {
        for (let i = 0; i < 10; i++) console.error(`err-${i}`);
        const entries = small.getEntries();
        expect(entries).toHaveLength(5);
        expect(entries[0].message).toBe('err-5');
        expect(entries[4].message).toBe('err-9');
      } finally {
        small.uninstall();
      }
    });
  });

  describe('autoOpenOnError', () => {
    it('opens panel body on first error when enabled', () => {
      const auto = new ConsolePanel({ autoOpenOnError: true });
      auto.install();
      try {
        console.error('boom');
        const root = document.getElementById('axia-console-panel');
        const body = root?.querySelector('button + div') as HTMLElement | null;
        // Body should be visible (display: flex, not none)
        expect(body?.style.display).toBe('flex');
      } finally {
        auto.uninstall();
      }
    });

    it('does NOT open when disabled', () => {
      panel.install();
      console.error('boom');
      const root = document.getElementById('axia-console-panel');
      const body = root?.querySelector('button + div') as HTMLElement | null;
      expect(body?.style.display).toBe('none');
    });
  });

  describe('formatting + clipboard', () => {
    it('formatAsText emits one line per entry', () => {
      panel.install();
      console.error('a');
      console.warn('b');
      const text = panel.formatAsText();
      const lines = text.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('ERROR');
      expect(lines[0]).toContain('a');
      expect(lines[1]).toContain('WARN');
      expect(lines[1]).toContain('b');
    });

    it('clear() empties entries', () => {
      panel.install();
      console.error('x');
      panel.clear();
      expect(panel.getEntries()).toHaveLength(0);
    });
  });

  describe('Programmatic push', () => {
    it('push() adds entry without going through console', () => {
      panel.install();
      panel.push('error', 'manual', 'integrity-test');
      const entry = panel.getEntries()[0];
      expect(entry.message).toBe('manual');
      expect(entry.source).toBe('integrity-test');
    });
  });

  describe('object stringification', () => {
    it('Error objects are formatted as Name: message', () => {
      panel.install();
      console.error(new TypeError('bad type'));
      expect(panel.getEntries()[0].message).toContain('TypeError: bad type');
    });

    it('plain objects are JSON.stringified', () => {
      panel.install();
      console.error({ ok: false, code: 7 });
      const msg = panel.getEntries()[0].message;
      expect(msg).toContain('"ok":false');
      expect(msg).toContain('"code":7');
    });
  });
});
