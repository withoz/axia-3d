import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandInput, CommandHandler } from './CommandInput';

// Stub debugLog
vi.mock('../utils/debug', () => ({ debugLog: vi.fn() }));

describe('CommandInput', () => {
  let cmd: CommandInput;

  beforeEach(() => {
    // Clean up previous DOM artifacts
    document.getElementById('command-input-panel')?.remove();
    document.getElementById('command-input-styles')?.remove();
    cmd = new CommandInput();
  });

  describe('show / hide / toggle', () => {
    it('starts hidden', () => {
      expect(cmd.isOpen()).toBe(false);
    });

    it('show makes it visible', () => {
      cmd.show();
      expect(cmd.isOpen()).toBe(true);
      const panel = document.getElementById('command-input-panel');
      expect(panel?.classList.contains('visible')).toBe(true);
    });

    it('hide makes it invisible', () => {
      cmd.show();
      cmd.hide();
      expect(cmd.isOpen()).toBe(false);
    });

    it('toggle switches state', () => {
      cmd.toggle();
      expect(cmd.isOpen()).toBe(true);
      cmd.toggle();
      expect(cmd.isOpen()).toBe(false);
    });
  });

  describe('registerHandler', () => {
    it('registers a handler by name', () => {
      const handler: CommandHandler = {
        name: 'LINE',
        aliases: ['l'],
        execute: vi.fn(),
        help: 'Draw a line',
      };
      cmd.registerHandler(handler);

      // Internal verification: trigger the command through the input
      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      expect(input).toBeDefined();
    });

    it('handler is callable via alias', () => {
      const executeFn = vi.fn();
      cmd.registerHandler({
        name: 'RECT',
        aliases: ['r', 'rectangle'],
        execute: executeFn,
        help: 'Draw a rectangle',
      });

      // Simulate typing 'r 50 100' and pressing Enter
      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'r 50 100';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(executeFn).toHaveBeenCalledWith(['50', '100']);
    });

    it('handler is callable via name (case-insensitive)', () => {
      const executeFn = vi.fn();
      cmd.registerHandler({
        name: 'CIRCLE',
        aliases: ['c'],
        execute: executeFn,
        help: 'Draw a circle',
      });

      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'circle 25';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(executeFn).toHaveBeenCalledWith(['25']);
    });
  });

  describe('command execution', () => {
    it('unknown command shows error', () => {
      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'unknown_cmd';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toContain('알 수 없는 명령');
      expect(output.classList.contains('error')).toBe(true);
    });

    it('empty input does nothing', () => {
      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const output = document.querySelector('.command-output') as HTMLElement;
      // Output should remain empty (cleared on show)
      expect(output.textContent).toBe('');
    });

    it('successful command shows success message', () => {
      cmd.registerHandler({
        name: 'TEST',
        aliases: ['t'],
        execute: vi.fn(),
        help: 'Test command',
      });

      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'test';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toContain('실행됨');
      expect(output.classList.contains('success')).toBe(true);
    });

    it('handler error shows error message', () => {
      cmd.registerHandler({
        name: 'FAIL',
        aliases: [],
        execute: () => { throw new Error('test error'); },
        help: 'Always fails',
      });

      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'fail';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toContain('test error');
      expect(output.classList.contains('error')).toBe(true);
    });

    it('input is cleared after Enter', () => {
      cmd.registerHandler({
        name: 'NOP',
        aliases: [],
        execute: vi.fn(),
        help: 'No-op',
      });

      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.value = 'nop';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(input.value).toBe('');
    });
  });

  describe('keyboard navigation', () => {
    it('Escape hides the panel', () => {
      cmd.show();
      expect(cmd.isOpen()).toBe(true);

      const input = document.querySelector('.command-input-field') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(cmd.isOpen()).toBe(false);
    });

    it('ArrowUp/ArrowDown navigates history', () => {
      cmd.registerHandler({
        name: 'A',
        aliases: [],
        execute: vi.fn(),
        help: '',
      });

      cmd.show();
      const input = document.querySelector('.command-input-field') as HTMLInputElement;

      // Execute two commands to build history
      input.value = 'a first';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.value = 'a second';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // ArrowUp → should show last command
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(input.value).toBe('a second');

      // ArrowUp again → first command
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(input.value).toBe('a first');

      // ArrowDown → back to second
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(input.value).toBe('a second');

      // ArrowDown again → empty (past end)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(input.value).toBe('');
    });
  });

  describe('print methods', () => {
    it('printError sets error class', () => {
      cmd.show();
      cmd.printError('Something failed');
      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toBe('Something failed');
      expect(output.className).toContain('error');
    });

    it('printSuccess sets success class', () => {
      cmd.show();
      cmd.printSuccess('Done');
      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toBe('Done');
      expect(output.className).toContain('success');
    });

    it('printInfo sets info class', () => {
      cmd.show();
      cmd.printInfo('Hint text');
      const output = document.querySelector('.command-output') as HTMLElement;
      expect(output.textContent).toBe('Hint text');
      expect(output.className).toContain('info');
    });
  });

  describe('DOM creation', () => {
    it('creates panel element in DOM', () => {
      const panel = document.getElementById('command-input-panel');
      expect(panel).not.toBeNull();
    });

    it('creates styles element', () => {
      const styles = document.getElementById('command-input-styles');
      expect(styles).not.toBeNull();
    });

    it('panel has input field and output area', () => {
      const input = document.querySelector('.command-input-field');
      const output = document.querySelector('.command-output');
      expect(input).not.toBeNull();
      expect(output).not.toBeNull();
    });
  });
});
