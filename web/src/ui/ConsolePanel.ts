/**
 * ConsolePanel — in-UI console output viewer.
 *
 * Captures `console.error / .warn / .log / .info` and displays the most
 * recent entries in a floating overlay so users can report issues
 * without opening browser DevTools.
 *
 * Design:
 *   - Bottom-right floating panel (doesn't block viewport)
 *   - Collapsed by default; auto-opens on first error
 *   - Color-coded: red (error) / orange (warn) / gray (log/info)
 *   - "Copy all" + "Clear" buttons for bug reporting
 *   - Filters by level
 *
 * Forms part of ADR-045 D5 (Debug Panel) — minimal first cut. The full
 * Debug Panel adds audit log + invariant viz + analytic hover overlay
 * + Tier 3 Danger Zone in a later PR.
 */

export type ConsoleLevel = 'error' | 'warn' | 'log' | 'info';

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: number;
  source?: string;
}

export interface ConsolePanelOptions {
  /** Maximum entries to keep in memory (LRU). Default 200. */
  maxEntries?: number;
  /** Show panel automatically on first error. Default true. */
  autoOpenOnError?: boolean;
  /** DOM element id; default 'axia-console-panel'. */
  elementId?: string;
}

export class ConsolePanel {
  private entries: ConsoleEntry[] = [];
  private readonly maxEntries: number;
  private readonly autoOpenOnError: boolean;
  private readonly elementId: string;

  private root: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private badgeEl: HTMLSpanElement | null = null;
  private isExpanded = false;
  private filter: 'all' | ConsoleLevel = 'all';

  /** Original console methods kept so the real DevTools console still works. */
  private origConsole: {
    error: typeof console.error;
    warn: typeof console.warn;
    log: typeof console.log;
    info: typeof console.info;
  };
  private installed = false;

  constructor(opts: ConsolePanelOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.autoOpenOnError = opts.autoOpenOnError ?? true;
    this.elementId = opts.elementId ?? 'axia-console-panel';

    this.origConsole = {
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      log: console.log.bind(console),
      info: console.info.bind(console),
    };
  }

  /** Install console hooks + render DOM. Call once at app startup. */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    // Snapshot CURRENT console (not constructor-time) so vitest spies
    // installed between construction and install() are honored.
    this.origConsole = {
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      log: console.log.bind(console),
      info: console.info.bind(console),
    };

    this.buildDom();
    this.captureGlobalErrors();
    this.installConsoleHooks();
  }

  /** Restore original console + remove DOM. */
  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;

    console.error = this.origConsole.error;
    console.warn = this.origConsole.warn;
    console.log = this.origConsole.log;
    console.info = this.origConsole.info;

    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }

  /** Programmatic API — add an entry without going through console.* */
  push(level: ConsoleLevel, message: string, source?: string): void {
    const entry: ConsoleEntry = { level, message, timestamp: Date.now(), source };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.renderEntry(entry);
    this.updateBadge();

    if (level === 'error' && this.autoOpenOnError && !this.isExpanded) {
      this.expand();
    }
  }

  /** Snapshot current entries — useful for tests and bug reports. */
  getEntries(): readonly ConsoleEntry[] {
    return this.entries;
  }

  /** Format all entries as a single text block (for clipboard). */
  formatAsText(): string {
    return this.entries
      .map((e) => {
        const t = new Date(e.timestamp).toISOString();
        const src = e.source ? ` [${e.source}]` : '';
        return `${t} ${e.level.toUpperCase()}${src}: ${e.message}`;
      })
      .join('\n');
  }

  clear(): void {
    this.entries = [];
    if (this.listEl) this.listEl.innerHTML = '';
    this.updateBadge();
  }

  // ────────────────────────────────────────────────────────────────
  //  Internal
  // ────────────────────────────────────────────────────────────────

  private installConsoleHooks(): void {
    console.error = (...args: unknown[]): void => {
      this.origConsole.error(...args);
      this.push('error', this.stringifyArgs(args), 'console');
    };
    console.warn = (...args: unknown[]): void => {
      this.origConsole.warn(...args);
      this.push('warn', this.stringifyArgs(args), 'console');
    };
    // info — captured but quieter than log
    console.info = (...args: unknown[]): void => {
      this.origConsole.info(...args);
      this.push('info', this.stringifyArgs(args), 'console');
    };
    // NOTE: We intentionally do NOT hook console.log — the codebase uses
    // debugLog() (gated by window.__AXIA_DEBUG) for verbose tracing, and
    // hooking console.log would flood the panel with internal noise.
  }

  private captureGlobalErrors(): void {
    window.addEventListener('error', (e: ErrorEvent) => {
      const msg = e.error?.message || e.message || 'Unknown error';
      const where = e.filename ? ` (${e.filename}:${e.lineno})` : '';
      this.push('error', `${msg}${where}`, 'window.error');
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
      this.push('error', `Unhandled promise: ${reason}`, 'unhandledrejection');
    });
  }

  private stringifyArgs(args: unknown[]): string {
    return args
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  }

  private buildDom(): void {
    if (document.getElementById(this.elementId)) return;

    const root = document.createElement('div');
    root.id = this.elementId;
    root.setAttribute('role', 'log');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-label', 'Console output');
    root.style.cssText = [
      'position: fixed',
      'right: 12px',
      'bottom: 32px',
      'z-index: 99999',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 12px',
      'color: #e8e8e8',
      'pointer-events: auto',
      'user-select: none',
    ].join(';');

    // Collapsed pill button (header)
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.setAttribute('aria-label', '콘솔 열기/닫기');
    pill.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 6px',
      'padding: 6px 10px',
      'background: rgba(20, 20, 28, 0.92)',
      'border: 1px solid #444',
      'border-radius: 16px',
      'cursor: pointer',
      'color: inherit',
      'font: inherit',
      'box-shadow: 0 4px 12px rgba(0,0,0,0.4)',
    ].join(';');
    pill.innerHTML = `<span style="opacity:0.7">📟 콘솔</span>`;

    const badge = document.createElement('span');
    badge.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'min-width: 18px',
      'padding: 0 6px',
      'height: 18px',
      'background: #6c757d',
      'border-radius: 9px',
      'font-size: 11px',
      'font-weight: 600',
    ].join(';');
    badge.textContent = '0';
    pill.appendChild(badge);

    pill.addEventListener('click', () => {
      this.isExpanded ? this.collapse() : this.expand();
    });

    // Body (hidden when collapsed)
    const body = document.createElement('div');
    body.style.cssText = [
      'flex-direction: column',
      'width: 480px',
      'max-height: 360px',
      'margin-top: 6px',
      'background: rgba(20, 20, 28, 0.96)',
      'border: 1px solid #444',
      'border-radius: 8px',
      'overflow: hidden',
      'box-shadow: 0 8px 24px rgba(0,0,0,0.5)',
    ].join(';');
    // Set display separately — some JSDOM versions return '' from
    // cssText-set display, breaking visibility regression tests.
    body.style.display = 'none';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = [
      'display: flex',
      'gap: 6px',
      'padding: 6px 8px',
      'border-bottom: 1px solid #333',
      'background: rgba(255,255,255,0.03)',
    ].join(';');

    const filterButtons: Array<{ key: 'all' | ConsoleLevel; label: string }> = [
      { key: 'all', label: '전체' },
      { key: 'error', label: '오류' },
      { key: 'warn', label: '경고' },
      { key: 'info', label: '정보' },
    ];
    for (const fb of filterButtons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = fb.label;
      btn.dataset.filter = fb.key;
      btn.style.cssText = [
        'padding: 3px 8px',
        'background: transparent',
        'border: 1px solid #555',
        'border-radius: 4px',
        'color: inherit',
        'font: inherit',
        'cursor: pointer',
      ].join(';');
      btn.addEventListener('click', () => {
        this.filter = fb.key;
        this.applyFilter();
        toolbar
          .querySelectorAll<HTMLButtonElement>('[data-filter]')
          .forEach((b) => {
            b.style.background =
              b.dataset.filter === this.filter ? 'rgba(116, 192, 252, 0.25)' : 'transparent';
          });
      });
      toolbar.appendChild(btn);
    }
    // Initial highlight
    (toolbar.querySelector('[data-filter="all"]') as HTMLButtonElement).style.background =
      'rgba(116, 192, 252, 0.25)';

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    toolbar.appendChild(spacer);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '복사';
    copyBtn.title = '버그 리포트용 — 모든 항목 클립보드로';
    copyBtn.style.cssText = [
      'padding: 3px 8px',
      'background: transparent',
      'border: 1px solid #555',
      'border-radius: 4px',
      'color: inherit',
      'font: inherit',
      'cursor: pointer',
    ].join(';');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.formatAsText());
        copyBtn.textContent = '복사됨 ✓';
        setTimeout(() => (copyBtn.textContent = '복사'), 1500);
      } catch {
        copyBtn.textContent = '복사 실패';
        setTimeout(() => (copyBtn.textContent = '복사'), 1500);
      }
    });
    toolbar.appendChild(copyBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '지우기';
    clearBtn.style.cssText = copyBtn.style.cssText;
    clearBtn.addEventListener('click', () => this.clear());
    toolbar.appendChild(clearBtn);

    body.appendChild(toolbar);

    // Scrollable list
    const list = document.createElement('div');
    list.style.cssText = [
      'flex: 1',
      'overflow-y: auto',
      'padding: 4px 0',
      'font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      'font-size: 11px',
      'line-height: 1.4',
      'user-select: text',
    ].join(';');
    body.appendChild(list);

    root.appendChild(pill);
    root.appendChild(body);
    document.body.appendChild(root);

    this.root = root;
    this.listEl = list;
    this.badgeEl = badge;

    // Store body reference on root via dataset for expand/collapse
    (root as unknown as { _body: HTMLElement })._body = body;
  }

  private renderEntry(entry: ConsoleEntry): void {
    if (!this.listEl) return;
    if (this.filter !== 'all' && entry.level !== this.filter) return;

    const row = document.createElement('div');
    row.dataset.level = entry.level;
    row.style.cssText = [
      'padding: 3px 10px',
      'border-bottom: 1px solid rgba(255,255,255,0.04)',
      'word-break: break-word',
      'white-space: pre-wrap',
    ].join(';');

    const colors: Record<ConsoleLevel, string> = {
      error: '#ff6b6b',
      warn: '#ffa94d',
      info: '#74c0fc',
      log: '#adb5bd',
    };
    row.style.color = colors[entry.level];

    const t = new Date(entry.timestamp);
    const ts = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;
    const prefix = `[${ts}]`;
    row.textContent = `${prefix} ${entry.message}`;

    this.listEl.appendChild(row);
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private applyFilter(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    for (const e of this.entries) this.renderEntry(e);
  }

  private updateBadge(): void {
    if (!this.badgeEl) return;
    const errorCount = this.entries.filter((e) => e.level === 'error').length;
    const warnCount = this.entries.filter((e) => e.level === 'warn').length;
    if (errorCount > 0) {
      this.badgeEl.textContent = String(errorCount);
      this.badgeEl.style.background = '#e03131';
    } else if (warnCount > 0) {
      this.badgeEl.textContent = String(warnCount);
      this.badgeEl.style.background = '#fd7e14';
    } else {
      this.badgeEl.textContent = String(this.entries.length);
      this.badgeEl.style.background = '#6c757d';
    }
  }

  private expand(): void {
    if (!this.root) return;
    const body = (this.root as unknown as { _body: HTMLElement })._body;
    body.style.display = 'flex';
    this.isExpanded = true;
  }

  private collapse(): void {
    if (!this.root) return;
    const body = (this.root as unknown as { _body: HTMLElement })._body;
    body.style.display = 'none';
    this.isExpanded = false;
  }
}

// Singleton accessor — most apps want one console panel.
let _instance: ConsolePanel | null = null;

export function getConsolePanel(): ConsolePanel {
  if (!_instance) {
    _instance = new ConsolePanel();
  }
  return _instance;
}
