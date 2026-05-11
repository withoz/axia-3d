/**
 * Command Catalog — single source of truth for every user-facing command.
 *
 * Problem before this module existed:
 *   - MenuBar.ts had 127 `case 'X':` handlers
 *   - index.html had 151 `data-action` attributes
 *   - KeyboardShortcuts.ts had its own bindings
 *   - ToolManagerRefactored.executeAction had yet another dispatch
 *   Adding a new command meant editing 3+ files; no one place described
 *   the full catalogue of commands, their groups, shortcuts, or icons.
 *
 * Solution:
 *   Each command is declared once via `register({ id, label, group, ... })`
 *   together with its `execute` callback. Any UI surface (toolbar, menu,
 *   keyboard, command-line) consults the catalog instead of duplicating
 *   the dispatch logic.
 *
 * Migration strategy:
 *   - The catalog co-exists with the existing dispatchers.
 *   - `bindGlobalClickHandler()` attaches a delegated `[data-action]`
 *     listener to <body>: a click first tries the catalog, then falls
 *     through to the legacy MenuBar / ToolManager paths if not registered.
 *   - This lets us migrate commands incrementally without breaking the
 *     existing UI.
 */

export type CommandGroup =
  | 'file' | 'edit' | 'select'
  | 'draw' | 'primitive' | 'modify' | 'boolean'
  | 'sketch' | 'group' | 'measure'
  | 'view' | 'snap' | 'repair'
  | 'export' | 'import' | 'help';

export interface CommandDef {
  /** Stable, kebab-case id, identical to legacy `data-action` attribute. */
  id: string;
  group: CommandGroup;
  /** Long Korean label (with English in parens) — appears in menu rows. */
  label: string;
  /** Short label for icon-only contexts (toolbar tooltip preview). */
  short?: string;
  /** Keyboard shortcut text, e.g. "L", "Ctrl+S", "Shift+S". For display. */
  shortcut?: string;
  /** Tooltip / status-bar description. */
  description?: string;
  /** Inline SVG path data (24×24 viewBox), or undefined to render label only. */
  iconSvg?: string;
  /** True ⇒ this command activates a tool mode (radio-style). */
  isMode?: boolean;
  /** If isMode, the underlying tool name (matched against ToolManager._currentTool). */
  toolName?: string;
  /** Show on the main toolbar. */
  toolbar?: boolean;
  /** Optional toolbar-section override (default = group). Use to split a
   *  group across multiple toolbar sections without changing the catalog. */
  toolbarSection?: string;
  /** Visibility / disabled / active getters (called at render time). */
  enabled?: () => boolean;
  active?: () => boolean;
  /** The action body. Sync only — async work happens inside via promises. */
  execute: () => void;
}

export class CommandCatalog {
  private commands = new Map<string, CommandDef>();
  private listeners: Array<() => void> = [];

  register(cmd: CommandDef): void {
    if (this.commands.has(cmd.id)) {
      console.warn(`[CommandCatalog] duplicate id "${cmd.id}" — overwriting`);
    }
    this.commands.set(cmd.id, cmd);
    this.notify();
  }

  registerMany(cmds: CommandDef[]): void {
    for (const c of cmds) this.commands.set(c.id, c);
    this.notify();
  }

  has(id: string): boolean { return this.commands.has(id); }
  get(id: string): CommandDef | undefined { return this.commands.get(id); }

  /** All commands, optionally filtered. Stable insertion order preserved. */
  list(filter?: { group?: CommandGroup; toolbar?: boolean }): CommandDef[] {
    const out: CommandDef[] = [];
    for (const cmd of this.commands.values()) {
      if (filter?.group && cmd.group !== filter.group) continue;
      if (filter?.toolbar !== undefined && !!cmd.toolbar !== filter.toolbar) continue;
      out.push(cmd);
    }
    return out;
  }

  /** All toolbar commands grouped by toolbarSection (or group as fallback). */
  toolbarGroups(): Map<string, CommandDef[]> {
    const groups = new Map<string, CommandDef[]>();
    for (const cmd of this.commands.values()) {
      if (!cmd.toolbar) continue;
      const key = cmd.toolbarSection ?? cmd.group;
      const arr = groups.get(key) ?? [];
      arr.push(cmd);
      groups.set(key, arr);
    }
    return groups;
  }

  /** Single-point dispatch — used by all UI surfaces. Returns true if the
   *  command was found and executed (false ⇒ caller should fall through). */
  execute(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    if (cmd.enabled && !cmd.enabled()) return true; // found but disabled — silently ignored
    try {
      cmd.execute();
    } catch (e) {
      console.error(`[CommandCatalog] execute("${id}") failed:`, e);
    }
    return true;
  }

  /** Subscribe to catalog changes (e.g. toolbar re-render after register). */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  clear(): void { this.commands.clear(); this.notify(); }

  size(): number { return this.commands.size; }

  private notify(): void { for (const fn of this.listeners) fn(); }
}

let _singleton: CommandCatalog | null = null;
export function getCommandCatalog(): CommandCatalog {
  if (!_singleton) _singleton = new CommandCatalog();
  return _singleton;
}
/** Test-only — reset the singleton (vitest beforeEach). */
export function __resetCommandCatalog(): void { _singleton = null; }

/**
 * Walk up from `el` until we find an element with either `data-action`
 * or `data-tool`. Returns the resolved command id (`tool-<name>` for
 * `data-tool="name"`) or null.
 */
export function resolveCommandId(el: HTMLElement | null): string | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const action = cur.getAttribute?.('data-action');
    if (action) return action;
    const tool = cur.getAttribute?.('data-tool');
    if (tool) return `tool-${tool}`;
    if (cur === document.body) break;
    cur = cur.parentElement;
  }
  return null;
}
