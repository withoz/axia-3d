/**
 * Command Palette — Ctrl+K (or Ctrl+Shift+P) overlay that lets the user
 * search and run any registered command in one keystroke.
 *
 * This is the "single visible surface" of the CommandCatalog. Toolbar,
 * menu and keyboard shortcuts continue to work as before; the palette
 * is an additional access path that proves the catalog is a real source
 * of truth — every command shows up here automatically.
 *
 * UX (FreeDesignX-inspired flat / dark style):
 *   - Centered modal, ~480px wide, dark background, subtle shadow.
 *   - Search input at top with placeholder "명령 검색…".
 *   - Results below: rows of (icon · label · group badge · shortcut).
 *   - ↑/↓ to navigate, Enter to run, Esc to close.
 *   - Fuzzy match against label, id, group, shortcut.
 */

import { getCommandCatalog, type CommandDef } from '../commands/CommandCatalog';

const STYLE_ID = 'cmd-palette-style';
const ROOT_ID = 'cmd-palette-root';

const CSS = `
.cmd-palette-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.cmd-palette-box {
  background: #1f2128; color: #e8e8ec;
  width: min(520px, 92vw);
  max-height: 70vh; display: flex; flex-direction: column;
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255,255,255,0.04) inset;
  overflow: hidden;
}
.cmd-palette-input {
  background: transparent;
  border: none; outline: none;
  color: #e8e8ec;
  font-size: 15px; line-height: 1.4;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.cmd-palette-input::placeholder { color: rgba(255,255,255,0.35); }
.cmd-palette-list {
  list-style: none; padding: 6px 0; margin: 0;
  overflow-y: auto;
  max-height: calc(70vh - 56px);
}
.cmd-palette-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; cursor: pointer;
  font-size: 13px;
}
.cmd-palette-row.active {
  background: rgba(58, 151, 255, 0.18);
  box-shadow: inset 2px 0 0 #3a97ff;
}
.cmd-palette-row:hover { background: rgba(255,255,255,0.04); }
.cmd-palette-label { flex: 1; }
.cmd-palette-group {
  font-size: 10px; opacity: 0.55;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.05);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.cmd-palette-shortcut {
  font-size: 11px; opacity: 0.65; font-family: ui-monospace, monospace;
}
.cmd-palette-empty {
  padding: 16px; text-align: center; color: rgba(255,255,255,0.45);
}
`;

export class CommandPalette {
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLUListElement | null = null;
  private results: CommandDef[] = [];
  private activeIdx = 0;
  private boundKeydown = this.onKeydown.bind(this);
  private boundDocClick = this.onDocClick.bind(this);

  constructor() { this.injectStyle(); }

  show(): void {
    if (this.root) return;
    this.build();
    setTimeout(() => this.input?.focus(), 0);
  }

  hide(): void {
    if (!this.root) return;
    document.removeEventListener('keydown', this.boundKeydown, true);
    document.removeEventListener('mousedown', this.boundDocClick, true);
    this.root.remove();
    this.root = null;
    this.input = null;
    this.list = null;
    this.results = [];
  }

  toggle(): void { this.root ? this.hide() : this.show(); }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private build(): void {
    const overlay = document.createElement('div');
    overlay.id = ROOT_ID;
    overlay.className = 'cmd-palette-overlay';

    const box = document.createElement('div');
    box.className = 'cmd-palette-box';

    const input = document.createElement('input');
    input.className = 'cmd-palette-input';
    input.placeholder = '명령 검색… (예: line, push, 단면, undo)';
    input.addEventListener('input', () => this.refresh());
    this.input = input;

    const list = document.createElement('ul');
    list.className = 'cmd-palette-list';
    list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li.cmd-palette-row') as HTMLElement | null;
      if (!li) return;
      const idx = Number(li.dataset.idx ?? -1);
      if (idx >= 0) this.run(idx);
    });
    this.list = list;

    box.appendChild(input);
    box.appendChild(list);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.root = overlay;

    document.addEventListener('keydown', this.boundKeydown, true);
    document.addEventListener('mousedown', this.boundDocClick, true);

    this.refresh();
  }

  private onDocClick(e: MouseEvent): void {
    if (!this.root) return;
    if (e.target === this.root) this.hide();
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.root) return;
    if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.activeIdx >= 0 && this.activeIdx < this.results.length) this.run(this.activeIdx);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.activeIdx = Math.min(this.activeIdx + 1, this.results.length - 1);
      this.renderRows();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIdx = Math.max(this.activeIdx - 1, 0);
      this.renderRows();
      return;
    }
  }

  private refresh(): void {
    const query = (this.input?.value ?? '').trim().toLowerCase();
    const all = getCommandCatalog().list();
    const ranked: Array<{ cmd: CommandDef; score: number }> = [];

    for (const cmd of all) {
      const score = score_match(cmd, query);
      if (score >= 0) ranked.push({ cmd, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    this.results = ranked.slice(0, 60).map(r => r.cmd);
    this.activeIdx = 0;
    this.renderRows();
  }

  private renderRows(): void {
    if (!this.list) return;
    if (this.results.length === 0) {
      this.list.innerHTML = '<li class="cmd-palette-empty">일치하는 명령이 없습니다</li>';
      return;
    }
    this.list.innerHTML = '';
    for (let i = 0; i < this.results.length; ++i) {
      const cmd = this.results[i];
      const li = document.createElement('li');
      li.className = 'cmd-palette-row' + (i === this.activeIdx ? ' active' : '');
      li.dataset.idx = String(i);
      li.innerHTML = `
        <span class="cmd-palette-label">${escape(cmd.label)}</span>
        <span class="cmd-palette-group">${escape(cmd.group)}</span>
        ${cmd.shortcut ? `<span class="cmd-palette-shortcut">${escape(cmd.shortcut)}</span>` : ''}
      `;
      this.list.appendChild(li);
    }
    // Scroll the active row into view (jsdom doesn't implement scrollIntoView).
    const active = this.list.querySelector('.cmd-palette-row.active') as HTMLElement | null;
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  private run(idx: number): void {
    const cmd = this.results[idx];
    this.hide();
    if (cmd) getCommandCatalog().execute(cmd.id);
  }
}

// ── Scoring ────────────────────────────────────────────────────────

function score_match(cmd: CommandDef, q: string): number {
  if (!q) return 1; // empty query → all commands, default order
  const hay = `${cmd.label} ${cmd.id} ${cmd.group} ${cmd.shortcut ?? ''}`.toLowerCase();
  if (!containsAll(hay, q)) return -1;
  // Higher score = better match.
  let s = 0;
  if (cmd.id.toLowerCase().startsWith(q)) s += 100;
  if (cmd.label.toLowerCase().includes(q)) s += 50;
  if (cmd.shortcut?.toLowerCase() === q) s += 200;
  // Prefer toolbar / mode commands slightly so common things rise to top.
  if (cmd.toolbar) s += 5;
  if (cmd.isMode) s += 3;
  // Light penalty for very long labels (more specific actions are usually
  // shorter — keeps "Line" above "선 + … + …" buried items).
  s -= Math.min(20, cmd.label.length / 3);
  return s;
}

function containsAll(hay: string, needle: string): boolean {
  // Character-order subsequence match (loose) for fuzzy filtering.
  let i = 0;
  for (const ch of needle) {
    const idx = hay.indexOf(ch, i);
    if (idx < 0) return false;
    i = idx + 1;
  }
  return true;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

// ── Singleton + key binding ────────────────────────────────────────

let _palette: CommandPalette | null = null;
export function getCommandPalette(): CommandPalette {
  if (!_palette) _palette = new CommandPalette();
  return _palette;
}

/** Wire Ctrl+K / Ctrl+Shift+P to open the palette. Returns teardown. */
export function bindCommandPaletteHotkey(): () => void {
  const handler = (e: KeyboardEvent) => {
    const isOpen = (e.ctrlKey || e.metaKey) && (
      (e.key === 'k' || e.key === 'K') ||
      (e.shiftKey && (e.key === 'p' || e.key === 'P'))
    );
    if (isOpen) {
      e.preventDefault();
      getCommandPalette().toggle();
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
