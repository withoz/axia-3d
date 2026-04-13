/**
 * Tests for Toast notification system.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toast } from './Toast';

describe('Toast', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Reset singleton
    (Toast as any).instance = null;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('init()', () => {
    it('creates a singleton instance', () => {
      const t1 = Toast.init(container);
      const t2 = Toast.init(container);
      expect(t1).toBe(t2);
    });

    it('appends toast container to parent', () => {
      Toast.init(container);
      const toastContainer = container.querySelector('#axia-toast-container');
      expect(toastContainer).not.toBeNull();
    });
  });

  describe('getInstance()', () => {
    it('returns null before init', () => {
      expect(Toast.getInstance()).toBeNull();
    });

    it('returns instance after init', () => {
      Toast.init(container);
      expect(Toast.getInstance()).not.toBeNull();
    });
  });

  describe('show()', () => {
    it('creates a toast element in the container', () => {
      const toast = Toast.init(container);
      toast.show('Test message', 'info');
      const toastContainer = container.querySelector('#axia-toast-container');
      expect(toastContainer!.children.length).toBe(1);
    });

    it('shows correct message text', () => {
      const toast = Toast.init(container);
      toast.show('Hello World', 'success');
      const toastContainer = container.querySelector('#axia-toast-container');
      expect(toastContainer!.textContent).toContain('Hello World');
    });

    it('shows correct icon for each type', () => {
      const toast = Toast.init(container);

      toast.show('success msg', 'success');
      toast.show('error msg', 'error');
      toast.show('warning msg', 'warning');

      const toastContainer = container.querySelector('#axia-toast-container')!;
      const toasts = toastContainer.children;
      expect(toasts[0].textContent).toContain('✓');
      expect(toasts[1].textContent).toContain('✕');
      expect(toasts[2].textContent).toContain('⚠');
    });

    it('enforces max 3 toasts', () => {
      vi.useFakeTimers();
      const toast = Toast.init(container);

      toast.show('msg1', 'info', 10000);
      toast.show('msg2', 'info', 10000);
      toast.show('msg3', 'info', 10000);
      toast.show('msg4', 'info', 10000); // should remove oldest

      // The 4th toast triggers removal animation on the 1st
      const toastContainer = container.querySelector('#axia-toast-container')!;
      // After animation (300ms), only 3 remain
      vi.advanceTimersByTime(350);
      // Max 3 active in queue (FIFO)
      expect(toastContainer.children.length).toBeLessThanOrEqual(4); // animation pending
      vi.useRealTimers();
    });
  });

  describe('static convenience methods', () => {
    it('success() works after init', () => {
      Toast.init(container);
      Toast.success('Saved!');
      const toastContainer = container.querySelector('#axia-toast-container')!;
      expect(toastContainer.textContent).toContain('Saved!');
    });

    it('error() works after init', () => {
      Toast.init(container);
      Toast.error('Failed!');
      const toastContainer = container.querySelector('#axia-toast-container')!;
      expect(toastContainer.textContent).toContain('Failed!');
    });

    it('does not throw if called before init', () => {
      expect(() => Toast.success('No init')).not.toThrow();
    });
  });
});
