import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { __resetCommandCatalog, getCommandCatalog } from '../commands/CommandCatalog';

describe('CommandPalette', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    __resetCommandCatalog();
    const catalog = getCommandCatalog();
    catalog.register({ id: 'tool-line',     group: 'draw',   label: '선 (Line)',         short: 'L',     shortcut: 'L', isMode: true, execute: vi.fn() });
    catalog.register({ id: 'tool-rect',     group: 'draw',   label: '사각형 (Rectangle)', short: 'R',     shortcut: 'R', isMode: true, execute: vi.fn() });
    catalog.register({ id: 'tool-pushpull', group: 'modify', label: 'Push/Pull',         short: 'P',     shortcut: 'P', isMode: true, execute: vi.fn() });
    catalog.register({ id: 'undo',          group: 'edit',   label: '되돌리기 (Undo)',     short: 'Undo', shortcut: 'Ctrl+Z', execute: vi.fn() });
  });

  it('show() injects overlay; hide() removes it', () => {
    const p = new CommandPalette();
    p.show();
    expect(document.querySelector('.cmd-palette-overlay')).toBeTruthy();
    expect(document.querySelector('.cmd-palette-input')).toBeTruthy();
    p.hide();
    expect(document.querySelector('.cmd-palette-overlay')).toBeFalsy();
  });

  it('toggle() opens then closes', () => {
    const p = new CommandPalette();
    p.toggle();
    expect(document.querySelector('.cmd-palette-overlay')).toBeTruthy();
    p.toggle();
    expect(document.querySelector('.cmd-palette-overlay')).toBeFalsy();
  });

  it('renders all commands when input is empty', () => {
    const p = new CommandPalette();
    p.show();
    const rows = document.querySelectorAll('.cmd-palette-row');
    expect(rows.length).toBe(4); // all four registered
  });

  it('filters rows when typing', () => {
    const p = new CommandPalette();
    p.show();
    const input = document.querySelector('.cmd-palette-input') as HTMLInputElement;
    input.value = 'push';
    input.dispatchEvent(new Event('input'));
    const rows = document.querySelectorAll('.cmd-palette-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const labels = Array.from(rows).map(r => r.textContent);
    expect(labels.some(l => l && l.includes('Push/Pull'))).toBe(true);
  });

  it('clicking a row executes the command', () => {
    const fn = vi.fn();
    getCommandCatalog().register({
      id: 'go-fast', group: 'edit', label: 'GoFast', execute: fn,
    });
    const p = new CommandPalette();
    p.show();
    const input = document.querySelector('.cmd-palette-input') as HTMLInputElement;
    input.value = 'GoFast';
    input.dispatchEvent(new Event('input'));
    const row = document.querySelector('.cmd-palette-row') as HTMLElement;
    expect(row).toBeTruthy();
    row.click();
    expect(fn).toHaveBeenCalledOnce();
    // After running the palette closes itself.
    expect(document.querySelector('.cmd-palette-overlay')).toBeFalsy();
  });

  it('Esc closes the palette', () => {
    const p = new CommandPalette();
    p.show();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(e);
    expect(document.querySelector('.cmd-palette-overlay')).toBeFalsy();
  });

  it('shows "no match" when query has no results', () => {
    const p = new CommandPalette();
    p.show();
    const input = document.querySelector('.cmd-palette-input') as HTMLInputElement;
    input.value = 'zzznonsensezzzqwerty';
    input.dispatchEvent(new Event('input'));
    const empty = document.querySelector('.cmd-palette-empty');
    expect(empty?.textContent).toContain('일치하는 명령이 없습니다');
  });
});
