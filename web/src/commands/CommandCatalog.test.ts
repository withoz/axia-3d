import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CommandCatalog, getCommandCatalog, __resetCommandCatalog,
  resolveCommandId,
} from './CommandCatalog';

describe('CommandCatalog', () => {
  let catalog: CommandCatalog;
  beforeEach(() => { catalog = new CommandCatalog(); });

  it('register / get / has', () => {
    const fn = vi.fn();
    catalog.register({
      id: 'tool-line', group: 'draw', label: '선', execute: fn,
    });
    expect(catalog.has('tool-line')).toBe(true);
    expect(catalog.get('tool-line')?.label).toBe('선');
  });

  it('overwrites duplicate id and warns', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    catalog.register({ id: 'x', group: 'edit', label: 'a', execute: () => {} });
    catalog.register({ id: 'x', group: 'edit', label: 'b', execute: () => {} });
    expect(catalog.get('x')?.label).toBe('b');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('list filters by group and toolbar', () => {
    catalog.register({ id: 'a', group: 'draw',   label: 'A', execute: () => {}, toolbar: true  });
    catalog.register({ id: 'b', group: 'draw',   label: 'B', execute: () => {}, toolbar: false });
    catalog.register({ id: 'c', group: 'modify', label: 'C', execute: () => {}, toolbar: true  });
    expect(catalog.list({ group: 'draw' }).map(c => c.id)).toEqual(['a', 'b']);
    expect(catalog.list({ toolbar: true }).map(c => c.id)).toEqual(['a', 'c']);
    expect(catalog.list({ group: 'modify', toolbar: true }).map(c => c.id)).toEqual(['c']);
  });

  it('toolbarGroups groups commands by toolbarSection (or group fallback)', () => {
    catalog.register({ id: 'a', group: 'draw', label: 'A', execute: () => {}, toolbar: true });
    catalog.register({ id: 'b', group: 'modify', label: 'B', execute: () => {}, toolbar: true,
      toolbarSection: 'draw' });
    catalog.register({ id: 'c', group: 'modify', label: 'C', execute: () => {}, toolbar: true });
    const g = catalog.toolbarGroups();
    expect(g.get('draw')?.map(c => c.id)).toEqual(['a', 'b']);
    expect(g.get('modify')?.map(c => c.id)).toEqual(['c']);
  });

  it('execute returns true and runs command', () => {
    const fn = vi.fn();
    catalog.register({ id: 'go', group: 'edit', label: 'go', execute: fn });
    expect(catalog.execute('go')).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('execute returns false for unknown id', () => {
    expect(catalog.execute('ghost')).toBe(false);
  });

  it('execute respects enabled() guard (returns true but does not run)', () => {
    const fn = vi.fn();
    catalog.register({
      id: 'g', group: 'edit', label: 'g',
      enabled: () => false, execute: fn,
    });
    expect(catalog.execute('g')).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('catches errors in execute() and logs them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    catalog.register({
      id: 'bad', group: 'edit', label: 'bad',
      execute: () => { throw new Error('boom'); },
    });
    expect(catalog.execute('bad')).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('onChange listener fires on register and clear', () => {
    const fn = vi.fn();
    catalog.onChange(fn);
    catalog.register({ id: 'a', group: 'edit', label: 'a', execute: () => {} });
    expect(fn).toHaveBeenCalledTimes(1);
    catalog.clear();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('singleton getCommandCatalog stays consistent', () => {
    __resetCommandCatalog();
    const a = getCommandCatalog();
    const b = getCommandCatalog();
    expect(a).toBe(b);
  });
});

describe('resolveCommandId', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds data-action on the target', () => {
    const el = document.createElement('div');
    el.setAttribute('data-action', 'undo');
    expect(resolveCommandId(el)).toBe('undo');
  });

  it('finds data-tool on the target and prefixes with tool-', () => {
    const el = document.createElement('button');
    el.setAttribute('data-tool', 'line');
    expect(resolveCommandId(el)).toBe('tool-line');
  });

  it('walks up the DOM tree to find the attribute', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-action', 'fillet-edge');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(resolveCommandId(inner)).toBe('fillet-edge');
  });

  it('returns null when no attribute is found', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(resolveCommandId(el)).toBe(null);
  });

  it('data-action wins over data-tool when both present on same element', () => {
    const el = document.createElement('div');
    el.setAttribute('data-action', 'group');
    el.setAttribute('data-tool', 'line');
    expect(resolveCommandId(el)).toBe('group');
  });
});
