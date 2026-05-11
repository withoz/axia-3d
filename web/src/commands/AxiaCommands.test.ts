import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __resetCommandCatalog, getCommandCatalog } from './CommandCatalog';
import { registerAxiaCommands } from './AxiaCommands';

function mockToolManager() {
  return {
    setTool: vi.fn(),
    executeAction: vi.fn(),
    _currentTool: 'select',
  } as unknown as Parameters<typeof registerAxiaCommands>[0]['toolManager'];
}

describe('AxiaCommands registration', () => {
  beforeEach(() => { __resetCommandCatalog(); });

  it('registers a sizable set of commands without collisions', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    expect(catalog.size()).toBeGreaterThan(80);
    // Spot-check a few well-known commands.
    for (const id of [
      'tool-select', 'tool-line', 'tool-rect', 'tool-pushpull',
      'undo', 'redo', 'bool-union', 'bool-subtract', 'bool-intersect',
      'sketch-start-auto', 'mesh-repair',
      'tool-slice', 'tool-box',
    ]) {
      expect(catalog.has(id), `expected ${id} registered`).toBe(true);
    }
  });

  it('every toolbar entry has a non-empty short label', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    for (const c of catalog.list({ toolbar: true })) {
      expect(c.short, `toolbar command ${c.id} missing short label`).toBeTruthy();
    }
  });

  it('tool-* commands isMode=true and route to setTool', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    const cmd = catalog.get('tool-line')!;
    expect(cmd.isMode).toBe(true);
    expect(cmd.toolName).toBe('line');
    cmd.execute();
    expect(tm.setTool).toHaveBeenCalledWith('line');
  });

  it('action commands route to executeAction', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    const cmd = catalog.get('subdivide')!;
    cmd.execute();
    expect(tm.executeAction).toHaveBeenCalledWith('subdivide');
  });

  it('active() returns true for current tool', () => {
    const tm = mockToolManager();
    (tm as unknown as { _currentTool: string })._currentTool = 'line';
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    expect(catalog.get('tool-line')!.active!()).toBe(true);
    expect(catalog.get('tool-select')!.active!()).toBe(false);
  });

  it('shortcut metadata is populated for primary commands', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    expect(catalog.get('tool-line')?.shortcut).toBe('L');
    expect(catalog.get('undo')?.shortcut).toBe('Ctrl+Z');
    expect(catalog.get('sketch-start-auto')?.shortcut).toBe('⇧S');
  });

  it('toolbarGroups contains the major sections', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    const groups = catalog.toolbarGroups();
    for (const sec of ['select', 'draw', 'primitive', 'modify', 'boolean', 'edit']) {
      expect(groups.has(sec), `missing toolbar section ${sec}`).toBe(true);
      expect(groups.get(sec)!.length).toBeGreaterThan(0);
    }
  });

  it('group breakdown — every command has one of the known groups', () => {
    const tm = mockToolManager();
    registerAxiaCommands({ toolManager: tm });
    const catalog = getCommandCatalog();
    const known = new Set<string>([
      'file', 'edit', 'select', 'draw', 'primitive', 'modify', 'boolean',
      'sketch', 'group', 'measure', 'view', 'snap', 'repair',
      'export', 'import', 'help',
    ]);
    for (const c of catalog.list()) {
      expect(known.has(c.group), `unknown group ${c.group} on ${c.id}`).toBe(true);
    }
  });
});
